/**
 * app.js
 * ตรรกะหลักของหน้าบันทึกข้อมูล + การนำทาง + สถานะร่วมของทั้งระบบ
 *
 * หลักการสำคัญของเวอร์ชันนี้:
 *  - รายการปีและวันงานทั้งหมดมาจากระบบหลังบ้าน ไม่มีการ hard-code ปีหรือวันที่ในไฟล์นี้
 *  - "บันทึกได้หรือไม่" ตัดสินโดยเซิร์ฟเวอร์เสมอ (ฟิลด์ canRecord / isOpenNow)
 *    หน้าเว็บเพียงซ่อนหรือปิดปุ่มเพื่อให้ผู้ใช้ไม่สับสน แต่ไม่ใช่ตัวตัดสิน
 *  - เวลาที่ใช้ตัดสินคือเวลาของเซิร์ฟเวอร์ ไม่ใช่นาฬิกาของเครื่องผู้ใช้
 *
 * เวอร์ชัน 1.2.0:
 *  - ผู้ใช้ต้องลงชื่อเข้าใช้ด้วยบัญชี Google ก่อนบันทึกข้อมูล (ดู auth.js)
 *  - ไม่มีช่องกรอกอีเมลอีกต่อไป — อีเมลมาจากบัญชีที่ยืนยันแล้วเท่านั้น
 *  - ปุ่มปีจะถูกปิดใช้งานก็ต่อเมื่อ "สถานะปี = ปิดรับข้อมูล" เท่านั้น
 *    การที่ยังไม่มีวันงานเปิดรับ ไม่ทำให้ปีนั้นกดไม่ได้ (แก้ semantic จาก 1.1.0)
 */
var App = (function () {
  'use strict';

  var state = {
    config: null,
    years: [],            // [{yearBE, status, canRecord, reason, openEventCount, ...}]
    activeYear: APP_CONFIG.DEFAULT_YEAR,
    currentYear: APP_CONFIG.DEFAULT_YEAR,
    events: [],           // วันงานของปีที่เลือก (มีฟิลด์ isOpenNow / windowState)
    lots: [],
    selectedLot: null,
    recordWindow: null,
    authConfig: null,
    identity: null,
    serverTime: '',
    requestId: null,
    submitting: false,
    submitAttempt: false,   // true เฉพาะช่วงที่ผู้ใช้เพิ่งกดปุ่มบันทึก (ใช้ตัดสินใจเด้ง popup)
    ready: false
  };

  var $ = Utils.$;
  var statusTimer = null;
  var authStarted = false;

  /* ================= การนำทางระหว่างหน้า ================= */
  function switchView(name) {
    Utils.$$('.view').forEach(function (v) { v.classList.remove('active'); });
    var view = $('#view-' + name);
    if (view) view.classList.add('active');
    Utils.$$('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'record') startStatusRefresh();
    else stopStatusRefresh();

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
      applyBootstrap(res);
      if (res.warning) Utils.toast(res.warning, 'warn');
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

  function applyBootstrap(res) {
    state.config = res.config || {};
    state.years = res.years || [];
    if (state.years.length === 0 && res.config && res.config.years) {
      // เผื่อ Backend รุ่นเก่าที่ยังไม่ส่งรายการปีแบบละเอียด
      state.years = res.config.years.map(function (y) {
        return { yearBE: y, status: 'Active', isActive: true, selectable: true,
                 disabledReason: '', canRecord: true, hasOpenEvent: true,
                 windowSummary: '', reason: '',
                 isActiveYear: y === res.config.activeYear, openEventCount: 1, eventCount: 1 };
      });
    }
    state.activeYear = (res.config && res.config.activeYear) || res.yearBE;
    state.currentYear = res.yearBE;
    state.events = res.events || [];
    state.lots = res.lots || [];
    state.recordWindow = res.recordWindow || null;
    state.authConfig = res.auth || null;
    state.serverTime = res.serverTime || '';
    state.ready = true;

    // เริ่มระบบลงชื่อเข้าใช้ด้วย Client ID ที่ได้จากระบบหลังบ้าน (ตั้งค่าที่เดียว)
    if (!authStarted && res.auth) {
      authStarted = true;
      Auth.init(res.auth.clientId || '');
    }

    if (res.config) {
      if (res.config.orgName) $('#footer-org').textContent = res.config.orgName;
      $('#footer-version').textContent = 'v' + (res.config.appVersion || APP_CONFIG.APP_VERSION);
    }

    $('#f-year').value = String(state.currentYear);
    renderYearButtons();
    renderYearOptions();
    renderEventButtons(res.defaultEventId);
    updateHeaderEvent();
    renderLotList('');
    updateSelectionCard();
  }

  /** เติมตัวเลือกปีให้ช่อง select ของหน้าอื่น ๆ (หน้าบันทึกใช้ปุ่มแทน) */
  function renderYearOptions() {
    var years = state.years.map(function (y) { return y.yearBE; });
    if (years.length === 0) years = [state.currentYear];

    var targets = ['#l-year', '#d-year', '#h-year', '#p-year', '#e-year', '#y-source', '#y-active'];
    targets.forEach(function (sel) {
      var node = $(sel);
      if (!node) return;
      var current = node.value;
      node.innerHTML = '';
      years.forEach(function (y) {
        var opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + (y === state.activeYear ? ' (ปีที่ใช้งาน)' : '');
        node.appendChild(opt);
      });
      node.value = (current && years.indexOf(Number(current)) >= 0)
        ? current : String(state.currentYear);
    });
  }

  /* ================= ปุ่มเลือกปี ================= */
  function renderYearButtons() {
    var box = $('#year-buttons');
    box.innerHTML = '';

    if (!state.years.length) {
      box.appendChild(Utils.el('p', 'choice-empty', 'ยังไม่มีข้อมูลปีในระบบ กรุณาติดต่อผู้ดูแลระบบ'));
      $('#year-hint').textContent = '';
      return;
    }

    state.years.forEach(function (y) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn' + (y.yearBE === state.currentYear ? ' selected' : '');
      btn.setAttribute('data-year', String(y.yearBE));
      btn.setAttribute('aria-pressed', y.yearBE === state.currentYear ? 'true' : 'false');

      var main = Utils.el('span', 'cb-main', y.yearBE);
      btn.appendChild(main);

      // ข้อความประกอบใต้เลขปี: บอกสถานะช่วงเวลาของปีนั้น
      var subText = y.windowSummary || y.reason || '';
      btn.appendChild(Utils.el('span', 'cb-sub', subText));

      // *** ปุ่มปีจะกดไม่ได้ก็ต่อเมื่อ "สถานะปี = ปิดรับข้อมูล" เท่านั้น ***
      // การที่วันนี้ยังไม่มีวันงานเปิดรับ ไม่ได้แปลว่าปีนั้นใช้งานไม่ได้
      var selectable = (y.selectable !== undefined) ? y.selectable : (y.status === 'Active');
      if (!selectable) {
        btn.disabled = true;
        btn.title = 'ปี ' + y.yearBE + ': ' + (y.disabledReason || 'ปิดรับข้อมูลแล้ว');
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.addEventListener('click', function () { selectYear(y.yearBE); });
      }
      box.appendChild(btn);
    });

    var selectableYears = state.years.filter(function (y) {
      return (y.selectable !== undefined) ? y.selectable : (y.status === 'Active');
    });
    var hint = $('#year-hint');
    if (selectableYears.length === 0) {
      hint.textContent = 'ขณะนี้ไม่มีปีที่เปิดรับข้อมูล กรุณาติดต่อผู้ดูแลระบบ';
      hint.className = 'hint warn';
    } else {
      hint.textContent = 'ปุ่มสีจางคือปีที่ผู้ดูแลระบบปิดรับข้อมูลแล้ว';
      hint.className = 'hint';
    }
  }

  function selectYear(yearBE) {
    if (Number(yearBE) === Number(state.currentYear)) return;
    $('#f-year').value = String(yearBE);
    clearSelectedLot();
    bootstrap(Number(yearBE), '').catch(function () {});
  }

  /* ================= ปุ่มเลือกวันงาน ================= */
  /** แสดงเฉพาะวันงานที่เซิร์ฟเวอร์ระบุว่าบันทึกได้ ณ ขณะนี้ */
  function openEvents() {
    return state.events.filter(function (e) { return e.isOpenNow; });
  }

  function renderEventButtons(preferredId) {
    var box = $('#event-buttons');
    box.innerHTML = '';
    var open = openEvents();

    if (open.length === 0) {
      var msg = 'ขณะนี้ไม่มีวันงานที่เปิดให้บันทึกข้อมูล';
      var upcoming = state.events.filter(function (e) { return e.windowState === 'BEFORE'; });
      if (upcoming.length) {
        msg = 'ยังไม่ถึงช่วงเวลาบันทึก ระบบจะเปิดให้บันทึก ' +
          upcoming[0].eventName + ' ตั้งแต่ ' + formatWindowTime(upcoming[0].opensAt) + ' เป็นต้นไป';
      } else if (state.events.length) {
        msg = 'พ้นช่วงเวลาบันทึกของทุกวันงานในปีนี้แล้ว';
      }
      box.appendChild(Utils.el('p', 'choice-empty', msg));
      $('#f-event').value = '';
      $('#f-event-date').textContent = '—';
      updateSubmitAvailability();
      return;
    }

    var chosen = '';
    if (preferredId && open.some(function (e) { return e.eventId === preferredId; })) {
      chosen = preferredId;
    } else if ($('#f-event').value &&
               open.some(function (e) { return e.eventId === $('#f-event').value; })) {
      chosen = $('#f-event').value;
    } else {
      chosen = open[0].eventId;
    }

    open.forEach(function (ev) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn' + (ev.eventId === chosen ? ' selected' : '');
      btn.setAttribute('data-event', ev.eventId);
      btn.setAttribute('aria-pressed', ev.eventId === chosen ? 'true' : 'false');
      btn.appendChild(Utils.el('span', 'cb-main', ev.eventName));
      btn.appendChild(Utils.el('span', 'cb-sub', Utils.formatThaiDate(ev.eventDate) +
        ' · ปิดรับ ' + formatWindowTime(ev.closesAt)));
      btn.addEventListener('click', function () { selectEvent(ev.eventId); });
      box.appendChild(btn);
    });

    if ($('#f-event').value !== chosen) {
      $('#f-event').value = chosen;
      reloadLots();
    } else {
      $('#f-event').value = chosen;
    }
    updateEventDate();
    updateSubmitAvailability();
  }

  function selectEvent(eventId) {
    if ($('#f-event').value === eventId) return;
    $('#f-event').value = eventId;
    Utils.$$('#event-buttons .choice-btn').forEach(function (b) {
      var on = b.getAttribute('data-event') === eventId;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateEventDate();
    updateHeaderEvent();
    updateSelectionCard();
    reloadLots();
  }

  /** 'YYYY-MM-DD HH:mm' -> 'HH:mm น.' หรือ 'D เดือน ปี HH:mm น.' เมื่อคนละวัน */
  function formatWindowTime(ts) {
    if (!ts) return '-';
    var d = String(ts).substring(0, 10);
    var t = String(ts).substring(11, 16);
    var ev = currentEvent();
    if (ev && ev.eventDate === d) return t + ' น.';
    return Utils.formatThaiDate(d) + ' ' + t + ' น.';
  }

  function currentEvent() {
    var id = $('#f-event').value;
    if (!id) return null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].eventId === id) return state.events[i];
    }
    return null;
  }

  function updateEventDate() {
    var ev = currentEvent();
    if (!ev) { $('#f-event-date').textContent = '—'; return; }
    $('#f-event-date').textContent =
      'วันที่ ' + Utils.formatThaiDate(ev.eventDate) +
      ' · เปิดรับข้อมูลถึง ' + formatWindowTime(ev.closesAt);
  }

  function updateHeaderEvent() {
    var ev = currentEvent();
    $('#header-event').textContent = ev
      ? ev.eventName + ' · ' + Utils.formatThaiDate(ev.eventDate)
      : 'ยังไม่มีวันงานที่เปิดให้บันทึก';
  }

  /** เปิด/ปิดปุ่มบันทึกตามความพร้อมของปีและวันงาน */
  function updateSubmitAvailability() {
    var btn = $('#btn-submit');
    // ============================================================
    // เวอร์ชัน 1.2.2 — ปุ่ม "บันทึกข้อมูล" ต้องกดได้เสมอ
    // ============================================================
    // เดิมปุ่มถูกปิด (disabled) เมื่อยังไม่ได้ลงชื่อเข้าใช้ หรือยังไม่มีวันงานเปิด
    // ทำให้ผู้ใช้กดแล้วไม่มีอะไรเกิดขึ้น และไม่รู้ว่าทำไมบันทึกไม่ได้
    //
    // ตอนนี้ปุ่มจะถูกปิดเฉพาะ "ระหว่างกำลังส่งข้อมูลจริง" เท่านั้น (กันกดซ้ำ)
    // เหตุผลอื่น ๆ ทั้งหมดจะอธิบายด้วย popup ตอนที่ผู้ใช้กด
    btn.disabled = !!state.submitting;

    var hasEvent = !!currentEvent();
    var signedIn = Auth.isSignedIn();
    btn.title = !signedIn ? 'กดปุ่มเพื่อดูขั้นตอนการลงชื่อเข้าใช้ด้วยบัญชี Google'
      : (!hasEvent ? 'ขณะนี้ยังไม่มีวันงานที่เปิดให้บันทึก — กดปุ่มเพื่อดูรายละเอียด' : '');
  }

  /* ================= การลงชื่อเข้าใช้ด้วย Google ================= */

  /** เติมชื่อจากบัญชี Google ให้อัตโนมัติ (ผู้ใช้แก้ไขเองได้เสมอ) */
  function prefillNameFromGoogle(force) {
    var st = Auth.getState();
    if (!st.profile || !st.profile.name) return;
    var field = $('#f-name');
    if (force || !field.value.trim()) field.value = st.profile.name;
  }

  /** อัปเดตการ์ดสถานะการลงชื่อเข้าใช้ */
  function renderAuthState(st) {
    var signedOut = $('#auth-signed-out');
    var signedIn = $('#auth-signed-in');
    var errBox = $('#auth-error');
    var hint = $('#auth-hint');

    if (st.signedIn && st.profile) {
      signedOut.classList.add('hidden');
      signedIn.classList.remove('hidden');
      $('#auth-name').textContent = st.profile.name || '(ไม่มีชื่อในบัญชี)';
      $('#auth-email').textContent = st.profile.email || '';
      $('#auth-role').textContent =
        'ระบบจะบันทึกบัญชีนี้เป็นผู้บันทึกข้อมูลทุกครั้งที่กดบันทึก';
      prefillNameFromGoogle(false);
    } else {
      signedOut.classList.remove('hidden');
      signedIn.classList.add('hidden');
      if (!st.configured) {
        hint.textContent = '';
        errBox.textContent = st.error ||
          'ระบบยังไม่ได้ตั้งค่าการลงชื่อเข้าใช้ด้วย Google กรุณาติดต่อผู้ดูแลระบบ';
        errBox.classList.remove('hidden');
      } else if (st.error) {
        hint.textContent = '';
        errBox.textContent = st.error;
        errBox.classList.remove('hidden');
      } else {
        errBox.classList.add('hidden');
        hint.textContent = st.ready
          ? 'กดปุ่มด้านบนเพื่อลงชื่อเข้าใช้ด้วยบัญชี Google'
          : 'กำลังเตรียมระบบลงชื่อเข้าใช้...';
      }
    }
    updateSubmitAvailability();
    if (typeof Admin !== 'undefined' && Admin.onAuthChange) Admin.onAuthChange(st);
  }

  /* ================= การ์ดสรุป "กำลังบันทึกลานใด" ================= */
  function updateSelectionCard() {
    var card = $('#selection-card');
    var lot = state.selectedLot;
    var ev = currentEvent();

    $('#sel-day').textContent = ev
      ? 'วันงาน: ' + ev.eventName + ' · ' + Utils.formatThaiDate(ev.eventDate) +
        ' · ปี ' + state.currentYear
      : 'ยังไม่มีวันงานที่เปิดให้บันทึก';

    if (!lot) {
      card.classList.add('is-empty');
      $('#sel-empty').classList.remove('hidden');
      $('#sel-detail').classList.add('hidden');
      return;
    }
    card.classList.remove('is-empty');
    $('#sel-empty').classList.add('hidden');
    $('#sel-detail').classList.remove('hidden');
    $('#sel-no').textContent = lot.parkingNo;
    $('#sel-name').textContent = lot.parkingName;
    $('#sel-meta').textContent =
      (lot.zone && lot.zone !== 'ไม่กำกับโซน' ? 'Zone ' + lot.zone : 'ไม่กำกับโซน') +
      ' · ความจุ ' + Utils.formatNumber(lot.effectiveCapacity) + ' คัน';
  }

  /** โหลดรายการลานจอดใหม่เมื่อเปลี่ยนปี/วันงาน */
  function reloadLots() {
    var year = Number($('#f-year').value) || state.currentYear;
    var eventId = $('#f-event').value;
    if (!eventId) { state.lots = []; renderLotList(''); return Promise.resolve(); }
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

  /* ================= รายการลานจอด: dropdown + ค้นหา ================= */
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
    filtered = state.lots.filter(function (l) { return matchLot(l, query); });
    activeIndex = -1;

    if (state.lots.length === 0) {
      box.appendChild(Utils.el('li', 'empty', 'ยังไม่มีรายการลานจอดในปี/วันงานที่เลือก'));
      return;
    }
    if (filtered.length === 0) {
      box.appendChild(Utils.el('li', 'empty', 'ไม่พบลานจอดที่ตรงกับคำค้นหา'));
      return;
    }

    var selectedId = $('#f-parking-id').value;
    filtered.forEach(function (lot, idx) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(idx));
      li.setAttribute('id', 'lot-opt-' + idx);
      li.setAttribute('aria-selected', lot.parkingId === selectedId ? 'true' : 'false');
      if (lot.parkingId === selectedId) li.classList.add('selected-item');

      li.appendChild(Utils.el('span', 'no', lot.parkingNo));
      li.appendChild(Utils.el('span', 'name', lot.parkingName));   // ชื่อเต็ม ไม่ตัดทอน
      li.appendChild(Utils.el('span', 'zone',
        (lot.zone && lot.zone !== 'ไม่กำกับโซน' ? 'Zone ' + lot.zone : 'ไม่กำกับโซน') +
        ' · ' + Utils.formatNumber(lot.effectiveCapacity) + ' คัน'));

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
    $('#parking-toggle').setAttribute('aria-expanded', 'true');
  }
  function closeList() {
    $('#parking-listbox').classList.add('hidden');
    $('#f-parking-search').setAttribute('aria-expanded', 'false');
    $('#parking-toggle').setAttribute('aria-expanded', 'false');
  }
  function isListOpen() {
    return !$('#parking-listbox').classList.contains('hidden');
  }

  /** ปุ่มลูกศร: เปิดดูรายการทั้งหมด (ล้างคำค้นหาเพื่อให้เห็นครบทุกลาน) */
  function toggleList() {
    if (isListOpen()) { closeList(); return; }
    renderLotList('');
    openList();
    $('#f-parking-search').focus();
  }

  function selectLot(lot) {
    state.selectedLot = lot;
    $('#f-parking-id').value = lot.parkingId;
    $('#f-parking-search').value = lot.parkingNo + ' · ' + lot.parkingName;
    $('#f-parking-search').classList.remove('invalid');
    $('#parking-clear').classList.remove('hidden');
    closeList();
    updateSelectionCard();
    checkCapacityWarning();
    $('#f-count').focus();
  }

  function clearSelectedLot() {
    state.selectedLot = null;
    $('#f-parking-id').value = '';
    $('#f-parking-search').value = '';
    $('#parking-clear').classList.add('hidden');
    $('#capacity-warning').textContent = '';
    updateSelectionCard();
  }

  function moveActive(delta) {
    if (filtered.length === 0) return;
    activeIndex += delta;
    if (activeIndex < 0) activeIndex = filtered.length - 1;
    if (activeIndex >= filtered.length) activeIndex = 0;
    Utils.$$('#parking-listbox li').forEach(function (li, i) {
      li.classList.toggle('active', i === activeIndex);
      if (i === activeIndex && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
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
      warnBox.textContent = 'คิดเป็นการใช้พื้นที่ ' + (count / cap * 100).toFixed(2) + '% ของความจุ';
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
        if (f.focus) f.focus();
        if (f.scrollIntoView) f.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    // เวอร์ชัน 1.2.2: ถ้าผู้ใช้เพิ่งกดปุ่ม "บันทึกข้อมูล" ให้เด้ง popup อธิบายเหตุผลด้วย
    // เพื่อไม่ให้เกิดอาการ "กดแล้วเงียบ ไม่รู้ว่าทำไมบันทึกไม่ได้"
    // ข้อความที่แสดงเป็นข้อความสำหรับผู้ใช้เท่านั้น ไม่มี token / ความลับ / stack trace
    if (state.submitAttempt) {
      try { window.alert(message); } catch (e) {}
    }
  }

  function clearFormError() {
    $('#form-error').classList.add('hidden');
    Utils.$$('.input.invalid').forEach(function (i) { i.classList.remove('invalid'); });
  }

  function validateForm() {
    clearFormError();

    // ---------- ลำดับที่ 1: ระบบลงชื่อเข้าใช้พร้อมใช้งานหรือยัง ----------
    var authState = Auth.getState();
    if (!authState.configured) {
      showFormError('ระบบลงชื่อเข้าใช้ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ');
      return null;
    }
    if (!authState.ready) {
      showFormError('ระบบกำลังเตรียมการลงชื่อเข้าใช้ด้วย Google กรุณารอสักครู่แล้วกดบันทึกอีกครั้ง');
      return null;
    }

    // ---------- ลำดับที่ 2: ต้องลงชื่อเข้าใช้ และการลงชื่อต้องยังไม่หมดอายุ ----------
    // (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้นอยู่แล้ว — ตรงนี้เพื่อให้ผู้ใช้รู้เหตุผลทันที)
    var wasSignedIn = Auth.isSignedIn();
    if (!Auth.getToken()) {   // getToken() จะล้างสถานะให้เองถ้าหมดอายุแล้ว
      showFormError(wasSignedIn
        ? 'การลงชื่อเข้าใช้หมดอายุ กรุณาลงชื่อเข้าใช้ด้วย Google อีกครั้ง'
        : 'กรุณาลงชื่อเข้าใช้ด้วย Google ก่อนบันทึกข้อมูล');
      Auth.promptSignIn();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    }

    // ---------- ลำดับที่ 3: ต้องมีวันงานที่เปิดให้บันทึก ----------
    var ev = currentEvent();
    if (!ev) {
      showFormError('ขณะนี้ยังไม่มีวันงานที่เปิดให้บันทึกข้อมูล กรุณาตรวจสอบวันและเวลา หรือติดต่อผู้ดูแลระบบ');
      return null;
    }
    if (!ev.isOpenNow) {
      showFormError('วันงานที่เลือกอยู่นอกช่วงเวลาที่เปิดให้บันทึกแล้ว กรุณาเลือกวันงานที่ระบบเปิดให้บันทึก');
      return null;
    }

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
    if (!on) updateSubmitAvailability();
  }

  /** ข้อความยืนยันก่อนบันทึก — ย้ำลานและวันงานเพื่อกันการบันทึกผิด */
  function buildConfirmMessage(payload, overCapacity) {
    var lot = state.selectedLot;
    var ev = currentEvent();
    var lines = [
      'ยืนยันการบันทึกข้อมูล',
      '',
      'ลานจอด:  ' + lot.parkingNo + ' — ' + lot.parkingName,
      'โซน:      ' + (lot.zone || 'ไม่กำกับโซน'),
      'วันงาน:   ' + ev.eventName + ' (' + Utils.formatThaiDate(ev.eventDate) + ')',
      'จำนวนรถ: ' + Utils.formatNumber(payload.vehicleCount) + ' คัน'
    ];
    if (overCapacity) {
      lines.push('');
      lines.push('⚠ จำนวนรถมากกว่าความจุที่กำหนดไว้ (' +
        Utils.formatNumber(lot.effectiveCapacity) + ' คัน)');
      lines.push('กรุณาตรวจสอบให้แน่ใจก่อนกดตกลง');
    }
    lines.push('');
    lines.push('กด "ตกลง" เพื่อบันทึก หรือ "ยกเลิก" เพื่อกลับไปแก้ไข');
    return lines.join('\n');
  }

  function handleSubmit(e) {
    if (e) e.preventDefault();

    // กรณีที่ 7: กำลังส่งข้อมูลอยู่จริง — ปุ่มถูกปิดไว้แล้ว กันกดซ้ำ/ดับเบิลคลิก
    if (state.submitting) return;

    // ตั้งแต่จุดนี้ไป ทุกข้อความที่ส่งผ่าน showFormError จะเด้ง popup ให้ผู้ใช้เห็นด้วย
    state.submitAttempt = true;

    if (!Api.isConfigured()) {
      showFormError('ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ');
      state.submitAttempt = false;
      return;
    }
    if (navigator.onLine === false) {
      showFormError('ขณะนี้อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบสัญญาณแล้วกดบันทึกอีกครั้ง');
      state.submitAttempt = false;
      return;
    }

    var payload = validateForm();
    if (!payload) { state.submitAttempt = false; return; }

    var overCapacity = checkCapacityWarning();
    if (!window.confirm(buildConfirmMessage(payload, overCapacity))) {
      if (overCapacity) $('#f-count').focus();
      state.submitAttempt = false;
      return;
    }
    if (overCapacity) payload.confirmOverCapacity = true;

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
        state.requestId = Utils.uuid();   // requestId ใหม่สำหรับรายการถัดไป
      })
      .catch(function (err) {
        var msg = Api.friendlyMessage(err);
        var field = null;
        if (err.errors && err.errors.length) {
          var map = {
            vehicleCount: '#f-count', recorderName: '#f-name',
            phone: '#f-phone', parkingId: '#f-parking-search'
          };
          field = map[err.errors[0].field] || null;
          msg = err.errors[0].message;
        }
        showFormError(msg, field);
        Utils.toast(msg, 'error');
        // ช่วงเวลาปิดหรือปีถูกปิดระหว่างใช้งาน -> รีเฟรชรายการให้ตรงกับความจริง
        if (err.errorCode === 'WINDOW_CLOSED' || err.errorCode === 'YEAR_INACTIVE') {
          refreshRecordingStatus();
        }
      })
      .then(function () {
        setSubmitting(false);
        state.submitAttempt = false;
      });
  }

  function saveRecorderIfWanted(payload) {
    if ($('#f-remember').checked) {
      // เก็บเฉพาะชื่อและเบอร์โทร — อีเมลมาจากบัญชี Google จึงไม่ต้องเก็บ
      Utils.setJson(APP_CONFIG.STORAGE_KEYS.RECORDER, {
        name: payload.recorderName, phone: payload.phone
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
      row.appendChild(Utils.el('dt', '', label));
      row.appendChild(Utils.el('dd', big ? 'big' : '', value));
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
    $('#selection-card').classList.add('hidden');
    $('#success-card').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextEntry() {
    $('#success-card').classList.add('hidden');
    $('#form-card').classList.remove('hidden');
    $('#selection-card').classList.remove('hidden');
    clearFormError();

    var continuous = $('#f-continuous').checked;
    $('#f-count').value = '';
    $('#f-note').value = '';
    $('#capacity-warning').textContent = '';

    // ทั้งสองโหมดจะล้างลานจอดเสมอ เพื่อให้เลือกลานถัดไปได้ทันที
    clearSelectedLot();

    if (!continuous && !$('#f-remember').checked) {
      // โหมดปกติ และไม่ได้เลือกให้จำข้อมูลผู้กรอก -> ล้างข้อมูลผู้กรอกด้วย
      // (ชื่อจะถูกเติมกลับจากบัญชี Google ให้อัตโนมัติ)
      $('#f-phone').value = '';
      prefillNameFromGoogle(true);
    }
    // โหมดบันทึกต่อเนื่อง: คงปี วันงาน ชื่อ เบอร์โทร และอีเมลไว้ทั้งหมด

    state.requestId = Utils.uuid();
    $('#f-parking-search').focus();
  }

  /* ================= รีเฟรชสถานะการเปิดรับข้อมูลตามเวลาจริง ================= */
  function refreshRecordingStatus() {
    if (!Api.isConfigured() || navigator.onLine === false) return Promise.resolve();
    return Api.call('getRecordingStatus', { yearBE: state.currentYear })
      .then(function (res) {
        state.years = res.years || state.years;
        state.serverTime = res.serverTime || state.serverTime;

        var currentStillOpen = false;
        var yearInfo = state.years.filter(function (y) {
          return Number(y.yearBE) === Number(state.currentYear);
        })[0];

        if (Number(res.yearBE) === Number(state.currentYear)) {
          state.events = res.events || state.events;
          currentStillOpen = (res.openEventIds || []).indexOf($('#f-event').value) >= 0;
        }
        renderYearButtons();

        var stillSelectable = !yearInfo ||
          ((yearInfo.selectable !== undefined) ? yearInfo.selectable : yearInfo.status === 'Active');
        if (!stillSelectable) {
          // ผู้ดูแลปิดรับข้อมูลของปีนี้ระหว่างที่ผู้ใช้เปิดหน้าอยู่
          renderEventButtons('');
          updateHeaderEvent();
          updateSelectionCard();
          return;
        }
        renderEventButtons(currentStillOpen ? $('#f-event').value : '');
        updateHeaderEvent();
        updateSelectionCard();
      })
      .catch(function (err) { console.warn('[recordingStatus]', err); });
  }

  function startStatusRefresh() {
    stopStatusRefresh();
    if (!APP_CONFIG.RECORD_STATUS_REFRESH_MS) return;
    statusTimer = setInterval(function () {
      var view = $('#view-record');
      if (view && view.classList.contains('active') && !state.submitting) {
        refreshRecordingStatus();
      }
    }, APP_CONFIG.RECORD_STATUS_REFRESH_MS);
  }
  function stopStatusRefresh() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  }

  /* ================= ข้อมูลผู้กรอกที่จำไว้ ================= */
  function restoreRecorder() {
    var saved = Utils.getJson(APP_CONFIG.STORAGE_KEYS.RECORDER, null);
    if (saved) {
      $('#f-name').value = saved.name || '';
      $('#f-phone').value = saved.phone || '';
      $('#f-remember').checked = true;
    }
    if (Utils.safeGet(APP_CONFIG.STORAGE_KEYS.CONTINUOUS) === '1') {
      $('#f-continuous').checked = true;
    }
  }

  /* ================= การผูก event ================= */
  function bindEvents() {
    Auth.renderButton($('#gsi-button'));
    Auth.onChange(renderAuthState);
    $('#btn-signout').addEventListener('click', function () {
      Auth.signOut();
      Utils.toast('ออกจากระบบแล้ว', 'info');
    });

    Utils.$$('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-view'));
      });
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
        updateSelectionCard();
      }
      renderLotList(search.value.trim());
      openList();
    }, 120));
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); openList(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') {
        if (isListOpen()) {
          e.preventDefault();
          var idx = activeIndex >= 0 ? activeIndex : 0;
          if (filtered[idx]) selectLot(filtered[idx]);
        }
      } else if (e.key === 'Escape') { closeList(); }
    });
    search.addEventListener('blur', function () { setTimeout(closeList, 150); });

    $('#parking-toggle').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('#parking-toggle').addEventListener('click', toggleList);

    $('#parking-clear').addEventListener('click', function () {
      clearSelectedLot();
      renderLotList('');
      $('#f-parking-search').focus();
    });

    $('#f-count').addEventListener('input', function () {
      var v = this.value.replace(/[^\d]/g, '');   // อนุญาตเฉพาะตัวเลข
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
      refreshRecordingStatus();
    });
    window.addEventListener('offline', function () {
      setConnStatus('error', 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต');
      Utils.toast('ไม่ได้เชื่อมต่ออินเทอร์เน็ต ข้อมูลจะยังไม่ถูกบันทึกจนกว่าจะเชื่อมต่อได้', 'warn');
    });

    // กลับมาที่หน้าเว็บอีกครั้ง (เช่น ปลดล็อกหน้าจอ) ให้ตรวจสถานะใหม่ทันที
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && $('#view-record').classList.contains('active')) {
        refreshRecordingStatus();
      }
    });
  }

  /* ================= เริ่มต้นระบบ ================= */
  function init() {
    $('#footer-org').textContent = APP_CONFIG.ORG_NAME;
    $('#footer-version').textContent = 'v' + APP_CONFIG.APP_VERSION;
    state.requestId = Utils.uuid();

    bindEvents();
    restoreRecorder();
    updateSelectionCard();
    renderAuthState(Auth.getState());

    if (!Api.isConfigured()) {
      $('#setup-warning').classList.remove('hidden');
      setConnStatus('error', 'ยังไม่ได้ตั้งค่าระบบ');
      // ไม่ปิดปุ่มบันทึก — ถ้าผู้ใช้กด ระบบจะเด้ง popup อธิบายว่ายังไม่ได้ตั้งค่า
      $('#year-hint').textContent = 'ยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน';
      return;
    }

    checkHealth();
    bootstrap(null, null)
      .then(function () { startStatusRefresh(); })
      .catch(function () { /* แสดง error แล้วใน bootstrap */ });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    state: state,
    switchView: switchView,
    showLoading: showLoading,
    bootstrap: bootstrap,
    renderYearOptions: renderYearOptions,
    refreshRecordingStatus: refreshRecordingStatus,
    checkHealth: checkHealth,
    currentEvent: currentEvent,
    renderAuthState: renderAuthState,
    updateSubmitAvailability: updateSubmitAvailability
  };
})();
