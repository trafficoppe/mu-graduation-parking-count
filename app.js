/**
 * app.js
 * ตรรกะหลักของหน้าบันทึกข้อมูล + การนำทาง + สถานะร่วมของทั้งระบบ
 */
var App = (function () {
  'use strict';

  var state = {
    config: null,
    years: [],
    activeYear: APP_CONFIG.DEFAULT_YEAR,
    currentYear: APP_CONFIG.DEFAULT_YEAR,
    events: [],
    lots: [],
    selectedLot: null,
    requestId: null,
    submitting: false,
    ready: false
  };

  var $ = Utils.$;

  /* ================= การนำทางระหว่างหน้า ================= */
  function switchView(name) {
    Utils.$$('.view').forEach(function (v) { v.classList.remove('active'); });
    var view = $('#view-' + name);
    if (view) view.classList.add('active');
    Utils.$$('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'latest') Dashboard.onEnterLatest();
    if (name === 'dashboard') Dashboard.onEnterDashboard();
    if (name === 'admin') Admin.onEnter();
  }

  /* ================= Loading / สถานะการเชื่อมต่อ ================= */
  var loadingCount = 0;
  function showLoading(on) {
    loadingCount += on ? 1 : -1;
    if (loadingCount < 0) loadingCount = 0;
    $('#loading-overlay').classList.toggle('hidden', loadingCount === 0);
  }

  function setConnStatus(kind, text) {
    var badge = $('#conn-status');
    badge.className = 'status-badge ' + kind;
    $('#conn-text').textContent = text;
  }

  function checkHealth() {
    if (!Api.isConfigured()) {
      setConnStatus('error', 'ยังไม่ได้ตั้งค่าระบบ');
      return Promise.resolve(null);
    }
    setConnStatus('checking', 'กำลังตรวจสอบการเชื่อมต่อ');
    return Api.health().then(function (h) {
      if (h.spreadsheetConnected) {
        setConnStatus('ok', 'เชื่อมต่อระบบแล้ว');
      } else {
        setConnStatus('error', 'ระบบหลังบ้านยังไม่พร้อม');
      }
      return h;
    }).catch(function (err) {
      setConnStatus('error', 'เชื่อมต่อระบบไม่ได้');
      console.warn('[health]', err);
      return null;
    });
  }

  /* ================= โหลดข้อมูลตั้งต้น ================= */
  function bootstrap(year, eventId) {
    showLoading(true);
    var params = {};
    if (year) params.yearBE = year;
    if (eventId) params.eventId = eventId;

    return Api.call('getBootstrap', params).then(function (res) {
      state.config = res.config || {};
      state.years = (res.config && res.config.years && res.config.years.length)
        ? res.config.years : [res.yearBE];
      state.activeYear = (res.config && res.config.activeYear) || res.yearBE;
      state.currentYear = res.yearBE;
      state.events = res.events || [];
      state.lots = res.lots || [];
      state.ready = true;

      if (res.config) {
        if (res.config.orgName) {
          $('#footer-org').textContent = res.config.orgName;
        }
        $('#footer-version').textContent = 'v' + (res.config.appVersion || APP_CONFIG.APP_VERSION);
      }

      renderYearOptions();
      renderEventOptions(res.defaultEventId);
      updateHeaderEvent();
      renderLotList('');

      if (res.warning) {
        Utils.toast(res.warning, 'warn');
      }
      return res;
    }).catch(function (err) {
      var msg = Api.friendlyMessage(err);
      Utils.toast(msg, 'error');
      showFormError(msg);
      throw err;
    }).then(function (r) {
      showLoading(false);
      return r;
    }, function (e) {
      showLoading(false);
      throw e;
    });
  }

  function renderYearOptions() {
    var targets = ['#f-year', '#l-year', '#d-year', '#h-year', '#p-year', '#e-year',
                   '#y-source', '#y-active'];
    targets.forEach(function (sel) {
      var node = $(sel);
      if (!node) return;
      var current = node.value;
      node.innerHTML = '';
      state.years.forEach(function (y) {
        var opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + (y === state.activeYear ? ' (ปีที่ใช้งาน)' : '');
        node.appendChild(opt);
      });
      node.value = current && state.years.indexOf(Number(current)) >= 0
        ? current : String(state.currentYear);
    });
  }

  function renderEventOptions(defaultEventId) {
    var sel = $('#f-event');
    sel.innerHTML = '';
    if (state.events.length === 0) {
      var o = document.createElement('option');
      o.value = '';
      o.textContent = 'ยังไม่มีข้อมูลวันงานในปีนี้';
      sel.appendChild(o);
      $('#f-event-date').textContent = '—';
      return;
    }
    state.events.forEach(function (ev) {
      var opt = document.createElement('option');
      opt.value = ev.eventId;
      opt.textContent = ev.eventName;
      sel.appendChild(opt);
    });
    sel.value = defaultEventId || state.events[0].eventId;
    updateEventDate();
  }

  function currentEvent() {
    var id = $('#f-event').value;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].eventId === id) return state.events[i];
    }
    return null;
  }

  function updateEventDate() {
    var ev = currentEvent();
    $('#f-event-date').textContent = ev
      ? 'วันที่ ' + Utils.formatThaiDate(ev.eventDate)
      : '—';
  }

  function updateHeaderEvent() {
    var ev = currentEvent();
    $('#header-event').textContent = ev
      ? ev.eventName + ' · ' + Utils.formatThaiDate(ev.eventDate)
      : 'ยังไม่มีข้อมูลวันงาน';
    $('#header-sub').textContent =
      'ช่วงงานพิธีพระราชทานปริญญาบัตร ประจำปี ' + state.currentYear;
  }

  /** โหลดรายการลานจอดใหม่เมื่อเปลี่ยนปี/วันงาน */
  function reloadLots() {
    var year = Number($('#f-year').value) || state.currentYear;
    var eventId = $('#f-event').value;
    showLoading(true);
    return Api.call('getParkingLots', { yearBE: year, eventId: eventId })
      .then(function (res) {
        state.lots = res.lots || [];
        clearSelectedLot();
        renderLotList('');
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { showLoading(false); });
  }

  /* ================= Searchable dropdown ของลานจอด ================= */
  var activeIndex = -1;
  var filtered = [];

  /**
   * รวมคำว่า "zone" / "โซน" เข้ากับรหัสโซนที่ตามมา เพื่อให้ค้นหา "Zone E" ได้ตรงตัว
   * (ถ้าปล่อยให้ "zone" กับ "e" เป็นคนละคำ ตัวอักษร e จะไปตรงกับคำว่า zone เองทุกแถว)
   */
  function normalizeSearch(s) {
    return String(s === null || s === undefined ? '' : s)
      .toLowerCase()
      .replace(/(zone|โซน)\s+/g, '$1');
  }

  function matchLot(lot, q) {
    if (!q) return true;
    var terms = normalizeSearch(q).split(/\s+/).filter(Boolean);
    var zone = lot.zone || '';
    // ใส่คำว่า zone/โซน เฉพาะลานที่มีรหัสโซนจริง ลานที่ไม่กำกับโซนจะไม่ถูกค้นเจอด้วยคำว่า zone
    var zonePart = (zone && zone !== 'ไม่กำกับโซน')
      ? ('zone' + zone + ' โซน' + zone + ' ' + zone)
      : zone;
    var hay = normalizeSearch(lot.parkingNo + ' ' + lot.parkingName + ' ' + zonePart);
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  }

  function renderLotList(query) {
    var box = $('#parking-listbox');
    box.innerHTML = '';
    filtered = state.lots.filter(function (l) { return matchLot(l, query); }).slice(0, 60);
    activeIndex = -1;

    if (state.lots.length === 0) {
      var li0 = Utils.el('li', 'empty', 'ยังไม่มีรายการลานจอดในปี/วันงานที่เลือก');
      box.appendChild(li0);
      return;
    }
    if (filtered.length === 0) {
      var li = Utils.el('li', 'empty', 'ไม่พบลานจอดที่ตรงกับคำค้นหา');
      box.appendChild(li);
      return;
    }

    filtered.forEach(function (lot, idx) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(idx));
      li.setAttribute('id', 'lot-opt-' + idx);

      var no = Utils.el('span', 'no', lot.parkingNo);
      var name = Utils.el('span', 'name', lot.parkingName);
      var zone = Utils.el('span', 'zone',
        (lot.zone && lot.zone !== 'ไม่กำกับโซน' ? 'Zone ' + lot.zone : 'ไม่กำกับโซน') +
        ' · ' + Utils.formatNumber(lot.effectiveCapacity) + ' คัน');

      li.appendChild(no); li.appendChild(name); li.appendChild(zone);
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selectLot(lot);
      });
      box.appendChild(li);
    });
  }

  function openList() {
    $('#parking-listbox').classList.remove('hidden');
    $('#f-parking-search').setAttribute('aria-expanded', 'true');
  }
  function closeList() {
    $('#parking-listbox').classList.add('hidden');
    $('#f-parking-search').setAttribute('aria-expanded', 'false');
  }

  function selectLot(lot) {
    state.selectedLot = lot;
    $('#f-parking-id').value = lot.parkingId;
    $('#f-parking-search').value = lot.parkingNo + ' · ' + lot.parkingName;
    $('#f-parking-search').classList.remove('invalid');
    $('#parking-clear').classList.remove('hidden');
    closeList();

    var info = $('#parking-info');
    info.innerHTML = '';
    info.appendChild(Utils.el('div', 'pname', lot.parkingName));
    info.appendChild(Utils.el('div', 'pmeta',
      'ลำดับที่ ' + lot.parkingNo +
      ' · ' + (lot.zone && lot.zone !== 'ไม่กำกับโซน' ? 'Zone ' + lot.zone : 'ไม่กำกับโซน') +
      ' · ความจุ ' + Utils.formatNumber(lot.effectiveCapacity) + ' คัน'));
    info.classList.remove('hidden');
    checkCapacityWarning();
    $('#f-count').focus();
  }

  function clearSelectedLot() {
    state.selectedLot = null;
    $('#f-parking-id').value = '';
    $('#f-parking-search').value = '';
    $('#parking-info').classList.add('hidden');
    $('#parking-clear').classList.add('hidden');
    $('#capacity-warning').textContent = '';
  }

  function moveActive(delta) {
    if (filtered.length === 0) return;
    activeIndex += delta;
    if (activeIndex < 0) activeIndex = filtered.length - 1;
    if (activeIndex >= filtered.length) activeIndex = 0;
    Utils.$$('#parking-listbox li').forEach(function (li, i) {
      li.classList.toggle('active', i === activeIndex);
      if (i === activeIndex && li.scrollIntoView) {
        li.scrollIntoView({ block: 'nearest' });
      }
    });
    $('#f-parking-search').setAttribute('aria-activedescendant', 'lot-opt-' + activeIndex);
  }

  /* ================= การตรวจสอบจำนวนรถ / ความจุ ================= */
  function checkCapacityWarning() {
    var warnBox = $('#capacity-warning');
    var lot = state.selectedLot;
    var raw = $('#f-count').value.trim();
    if (!lot || !Utils.isInteger(raw)) {
      warnBox.textContent = '';
      warnBox.className = 'hint';
      return false;
    }
    var count = parseInt(raw, 10);
    var cap = lot.effectiveCapacity;
    if (cap > 0 && count > cap) {
      warnBox.textContent = 'จำนวนรถมากกว่าความจุที่กำหนด (' +
        Utils.formatNumber(cap) + ' คัน) กรุณาตรวจสอบข้อมูล';
      warnBox.className = 'hint warn';
      return true;
    }
    if (cap > 0) {
      var pct = (count / cap * 100).toFixed(2);
      warnBox.textContent = 'คิดเป็นการใช้พื้นที่ ' + pct + '% ของความจุ';
      warnBox.className = 'hint';
    } else {
      warnBox.textContent = '';
      warnBox.className = 'hint';
    }
    return false;
  }

  /* ================= การบันทึกข้อมูล ================= */
  function showFormError(message, fieldId) {
    var box = $('#form-error');
    box.innerHTML = '';
    box.appendChild(Utils.el('strong', '', message));
    box.classList.remove('hidden');
    if (fieldId) {
      var f = $(fieldId);
      if (f) {
        f.classList.add('invalid');
        f.focus();
        if (f.scrollIntoView) f.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function clearFormError() {
    $('#form-error').classList.add('hidden');
    Utils.$$('.input.invalid').forEach(function (i) { i.classList.remove('invalid'); });
  }

  function validateForm() {
    clearFormError();

    var ev = currentEvent();
    if (!ev) { showFormError('ยังไม่มีข้อมูลวันงาน กรุณาติดต่อผู้ดูแลระบบ', '#f-event'); return null; }

    if (!state.selectedLot || !$('#f-parking-id').value) {
      showFormError('กรุณาเลือกลานจอดรถ', '#f-parking-search'); return null;
    }

    var countRaw = $('#f-count').value.trim();
    if (countRaw === '') {
      showFormError('กรุณากรอกจำนวนรถยนต์ที่ตรวจนับได้', '#f-count'); return null;
    }
    if (!Utils.isInteger(countRaw)) {
      showFormError('จำนวนรถยนต์ต้องเป็นตัวเลขจำนวนเต็มเท่านั้น (ไม่มีจุดทศนิยมหรือตัวอักษร)', '#f-count');
      return null;
    }
    var count = parseInt(countRaw, 10);
    if (count < 0) { showFormError('จำนวนรถยนต์ต้องไม่ติดลบ', '#f-count'); return null; }

    var name = $('#f-name').value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      showFormError('กรุณากรอกชื่อ-นามสกุลผู้บันทึก', '#f-name'); return null;
    }

    var email = $('#f-email').value.trim().toLowerCase();
    if (!email) { showFormError('กรุณากรอกอีเมล', '#f-email'); return null; }
    if (!Utils.isValidEmail(email)) {
      showFormError('รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', '#f-email'); return null;
    }

    var phoneRaw = $('#f-phone').value.trim();
    var phone = '';
    if (phoneRaw) {
      phone = Utils.normalizePhone(phoneRaw);
      if (phone === null) {
        showFormError('รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องเป็นเบอร์ไทย 10 หลัก)', '#f-phone');
        return null;
      }
    }

    return {
      yearBE: Number($('#f-year').value) || state.currentYear,
      eventId: ev.eventId,
      parkingId: $('#f-parking-id').value,
      vehicleCount: count,
      recorderName: name,
      email: email,
      phone: phone,
      note: $('#f-note').value.trim(),
      clientTimestamp: Utils.clientTimestamp(),
      source: 'WEB',
      requestId: state.requestId
    };
  }

  function setSubmitting(on) {
    state.submitting = on;
    var btn = $('#btn-submit');
    btn.disabled = on;
    btn.textContent = on ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูล';
  }

  function handleSubmit(e) {
    if (e) e.preventDefault();
    if (state.submitting) return;

    if (!Api.isConfigured()) {
      showFormError('ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ');
      return;
    }
    if (navigator.onLine === false) {
      showFormError('ขณะนี้อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบสัญญาณแล้วกดบันทึกอีกครั้ง');
      return;
    }

    var payload = validateForm();
    if (!payload) return;

    // เกินความจุ: เตือนและให้ยืนยันก่อน (ไม่บล็อก)
    if (checkCapacityWarning()) {
      var cap = state.selectedLot.effectiveCapacity;
      var ok = window.confirm(
        'จำนวนรถที่กรอก (' + Utils.formatNumber(payload.vehicleCount) + ' คัน) ' +
        'มากกว่าความจุที่กำหนดไว้ (' + Utils.formatNumber(cap) + ' คัน)\n\n' +
        'กรุณาตรวจสอบข้อมูลอีกครั้ง หากถูกต้องแล้วกด "ตกลง" เพื่อบันทึก');
      if (!ok) { $('#f-count').focus(); return; }
      payload.confirmOverCapacity = true;
    }

    setSubmitting(true);
    Api.call('submitRecord', payload)
      .then(function (res) {
        saveRecorderIfWanted(payload);
        showSuccess(res, payload);
        if (res.duplicated) {
          Utils.toast('รายการนี้เคยบันทึกไว้แล้ว ระบบไม่บันทึกซ้ำ', 'warn');
        } else {
          Utils.toast('บันทึกข้อมูลสำเร็จ', 'success');
        }
        // requestId ใหม่สำหรับรายการถัดไป
        state.requestId = Utils.uuid();
      })
      .catch(function (err) {
        var msg = Api.friendlyMessage(err);
        var field = null;
        if (err.errors && err.errors.length) {
          var map = {
            vehicleCount: '#f-count', recorderName: '#f-name', email: '#f-email',
            phone: '#f-phone', eventId: '#f-event', parkingId: '#f-parking-search'
          };
          field = map[err.errors[0].field] || null;
          msg = err.errors[0].message;
        }
        showFormError(msg, field);
        Utils.toast(msg, 'error');
      })
      .then(function () { setSubmitting(false); });
  }

  function saveRecorderIfWanted(payload) {
    if ($('#f-remember').checked) {
      Utils.setJson(APP_CONFIG.STORAGE_KEYS.RECORDER, {
        name: payload.recorderName, phone: payload.phone, email: payload.email
      });
    } else {
      Utils.safeRemove(APP_CONFIG.STORAGE_KEYS.RECORDER);
    }
    Utils.safeSet(APP_CONFIG.STORAGE_KEYS.CONTINUOUS, $('#f-continuous').checked ? '1' : '0');
  }

  function showSuccess(res, payload) {
    var rec = res.record || {};
    var ev = currentEvent();
    var list = $('#success-list');
    list.innerHTML = '';

    function addRow(label, value, big) {
      var row = document.createElement('div');
      var dt = Utils.el('dt', '', label);
      var dd = Utils.el('dd', big ? 'big' : '', value);
      row.appendChild(dt); row.appendChild(dd);
      list.appendChild(row);
    }

    addRow('ลานจอด', 'P' + (rec.parkingNo || '') + ' ' + (rec.parkingName || ''));
    addRow('จำนวนรถ', Utils.formatNumber(rec.vehicleCount) + ' คัน', true);
    addRow('การใช้พื้นที่', Utils.formatPercent(rec.occupancyPercent) +
      ' (' + (rec.capacityStatus || '-') + ')');
    addRow('วันงาน', (ev ? ev.eventName + ' · ' : '') +
      Utils.formatThaiDate(rec.eventDate || (ev && ev.eventDate)));
    addRow('เวลาที่บันทึก', Utils.formatThaiTime(rec.serverTimestamp));
    addRow('ผู้บันทึก', rec.recorderName || payload.recorderName);
    addRow('รหัสรายการ', rec.recordId || res.recordId || '-');

    $('#form-card').classList.add('hidden');
    $('#success-card').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextEntry() {
    $('#success-card').classList.add('hidden');
    $('#form-card').classList.remove('hidden');
    clearFormError();

    var continuous = $('#f-continuous').checked;
    $('#f-count').value = '';
    $('#f-note').value = '';
    $('#capacity-warning').textContent = '';

    // ทั้งสองโหมดจะล้างลานจอดเสมอ เพื่อให้เลือกลานถัดไปได้ทันที
    clearSelectedLot();

    if (!continuous && !$('#f-remember').checked) {
      // โหมดปกติ และไม่ได้เลือกให้จำข้อมูลผู้กรอก -> ล้างข้อมูลผู้กรอกด้วย
      $('#f-name').value = '';
      $('#f-phone').value = '';
      $('#f-email').value = '';
    }
    // โหมดบันทึกต่อเนื่อง: คงปี วันงาน ชื่อ เบอร์โทร และอีเมลไว้ทั้งหมด

    state.requestId = Utils.uuid();
    $('#f-parking-search').focus();
  }

  /* ================= ข้อมูลผู้กรอกที่จำไว้ ================= */
  function restoreRecorder() {
    var saved = Utils.getJson(APP_CONFIG.STORAGE_KEYS.RECORDER, null);
    if (saved) {
      $('#f-name').value = saved.name || '';
      $('#f-phone').value = saved.phone || '';
      $('#f-email').value = saved.email || '';
      $('#f-remember').checked = true;
    }
    if (Utils.safeGet(APP_CONFIG.STORAGE_KEYS.CONTINUOUS) === '1') {
      $('#f-continuous').checked = true;
    }
  }

  /* ================= การผูก event ================= */
  function bindEvents() {
    Utils.$$('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-view'));
      });
    });

    $('#f-event').addEventListener('change', function () {
      updateEventDate();
      updateHeaderEvent();
      reloadLots();
    });

    $('#f-year').addEventListener('change', function () {
      var y = Number($('#f-year').value);
      bootstrap(y, '').catch(function () {});
    });

    var search = $('#f-parking-search');
    search.addEventListener('focus', function () {
      renderLotList(state.selectedLot ? '' : search.value.trim());
      openList();
    });
    search.addEventListener('input', Utils.debounce(function () {
      if (state.selectedLot) {
        // ผู้ใช้พิมพ์ทับค่าที่เลือกไว้ = เริ่มเลือกใหม่
        state.selectedLot = null;
        $('#f-parking-id').value = '';
        $('#parking-info').classList.add('hidden');
      }
      renderLotList(search.value.trim());
      openList();
    }, 120));
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); openList(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') {
        if (!$('#parking-listbox').classList.contains('hidden')) {
          e.preventDefault();
          var idx = activeIndex >= 0 ? activeIndex : 0;
          if (filtered[idx]) selectLot(filtered[idx]);
        }
      } else if (e.key === 'Escape') { closeList(); }
    });
    search.addEventListener('blur', function () {
      setTimeout(closeList, 150);
    });
    $('#parking-clear').addEventListener('click', function () {
      clearSelectedLot();
      renderLotList('');
      $('#f-parking-search').focus();
    });

    $('#f-count').addEventListener('input', function () {
      // อนุญาตเฉพาะตัวเลข
      var v = this.value.replace(/[^\d]/g, '');
      if (v !== this.value) this.value = v;
      checkCapacityWarning();
    });

    $('#record-form').addEventListener('submit', handleSubmit);
    $('#btn-next').addEventListener('click', nextEntry);
    $('#btn-view-latest').addEventListener('click', function () {
      nextEntry();
      switchView('latest');
    });

    $('#f-remember').addEventListener('change', function () {
      if (!this.checked) Utils.safeRemove(APP_CONFIG.STORAGE_KEYS.RECORDER);
    });

    window.addEventListener('online', function () {
      Utils.toast('กลับมาเชื่อมต่ออินเทอร์เน็ตแล้ว', 'success');
      checkHealth();
    });
    window.addEventListener('offline', function () {
      setConnStatus('error', 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต');
      Utils.toast('ไม่ได้เชื่อมต่ออินเทอร์เน็ต ข้อมูลจะยังไม่ถูกบันทึกจนกว่าจะเชื่อมต่อได้', 'warn');
    });
  }

  /* ================= เริ่มต้นระบบ ================= */
  function init() {
    $('#footer-org').textContent = APP_CONFIG.ORG_NAME;
    $('#footer-version').textContent = 'v' + APP_CONFIG.APP_VERSION;
    state.requestId = Utils.uuid();

    bindEvents();
    restoreRecorder();

    if (!Api.isConfigured()) {
      $('#setup-warning').classList.remove('hidden');
      setConnStatus('error', 'ยังไม่ได้ตั้งค่าระบบ');
      $('#btn-submit').disabled = true;
      return;
    }

    checkHealth();
    bootstrap(null, null).catch(function () { /* แสดง error แล้วใน bootstrap */ });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    state: state,
    switchView: switchView,
    showLoading: showLoading,
    bootstrap: bootstrap,
    renderYearOptions: renderYearOptions,
    checkHealth: checkHealth,
    currentEvent: currentEvent
  };
})();
