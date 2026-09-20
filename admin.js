/**
 * admin.js
 * ส่วนผู้ดูแลระบบ: ประวัติการบันทึก, จัดการลานจอด, จัดการวันงาน, จัดการปี, ตรวจสอบระบบ
 *
 * ข้อจำกัดด้านความปลอดภัยที่ต้องทราบ:
 *  - รหัสผู้ดูแลเป็น Shared Secret เก็บไว้ใน sessionStorage เท่านั้น (ปิดแท็บแล้วหาย)
 *  - ไม่เก็บใน localStorage และไม่ส่งไปที่ใดนอกจาก Web App ของหน่วยงานเอง
 *  - การตรวจสิทธิ์จริงเกิดที่ฝั่ง Backend ทุกครั้ง
 */
var Admin = (function () {
  'use strict';

  var $ = Utils.$;
  var TOKEN_KEY = 'gpvcs.adminToken.session';
  var initialized = false;
  var historyData = null;

  function getToken() {
    try { return window.sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) window.sessionStorage.setItem(TOKEN_KEY, t);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  /** เรียก API ฝั่งผู้ดูแล (แนบ token อัตโนมัติ) */
  function adminCall(action, params) {
    var p = Object.assign({}, params || {});
    p.adminToken = getToken();
    return Api.call(action, p).catch(function (err) {
      if (err.errorCode === 'UNAUTHORIZED') {
        setToken('');
        showLogin();
        Utils.toast(err.message || 'กรุณาเข้าสู่ระบบผู้ดูแลอีกครั้ง', 'error');
      }
      throw err;
    });
  }

  function showLogin() {
    $('#admin-login-card').classList.remove('hidden');
    $('#admin-panel').classList.add('hidden');
  }
  function showPanel() {
    $('#admin-login-card').classList.add('hidden');
    $('#admin-panel').classList.remove('hidden');
  }

  function onEnter() {
    if (!initialized) { bind(); initialized = true; }
    if (!Api.isConfigured()) {
      showLogin();
      showAdminError('ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ');
      return;
    }
    if (getToken()) {
      showPanel();
      App.renderYearOptions();
      switchTab('history');
    } else {
      showLogin();
    }
  }

  /* ---------------- login ---------------- */
  function login() {
    if (!Api.isConfigured()) {
      showAdminError('ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ');
      return;
    }
    var token = $('#a-token').value.trim();
    if (!token) {
      showAdminError('กรุณากรอกรหัสผู้ดูแลระบบ');
      return;
    }
    App.showLoading(true);
    Api.call('adminLogin', { adminToken: token })
      .then(function () {
        setToken(token);
        $('#a-token').value = '';
        $('#admin-error').classList.add('hidden');
        showPanel();
        App.renderYearOptions();
        Utils.toast('เข้าสู่ระบบผู้ดูแลสำเร็จ', 'success');
        switchTab('history');
      })
      .catch(function (err) { showAdminError(Api.friendlyMessage(err)); })
      .then(function () { App.showLoading(false); });
  }

  function showAdminError(msg) {
    var box = $('#admin-error');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function logout() {
    setToken('');
    showLogin();
    Utils.toast('ออกจากระบบผู้ดูแลแล้ว', 'info');
  }

  /* ---------------- tabs ---------------- */
  function switchTab(name) {
    Utils.$$('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    Utils.$$('.admin-tab').forEach(function (t) { t.classList.add('hidden'); });
    var tab = $('#tab-' + name);
    if (tab) tab.classList.remove('hidden');

    if (name === 'history') initHistoryFilters();
    if (name === 'parking') loadParking();
    if (name === 'events') loadEvents();
    if (name === 'year') initYearTab();
  }

  /* ---------------- ประวัติการบันทึก ---------------- */
  var historyFiltersReady = false;
  function initHistoryFilters() {
    if (historyFiltersReady) return;
    historyFiltersReady = true;
    var year = Number($('#h-year').value) || App.state.currentYear;
    Dashboard.fillEvents($('#h-event'), year, true).catch(function (e) {
      console.warn('[admin events]', e);
    });
    loadParkingOptions(year);
  }

  function loadParkingOptions(year) {
    return adminCall('getAdminParkingLots', { yearBE: year }).then(function (res) {
      var pSel = $('#h-parking');
      var zSel = $('#h-zone');
      pSel.innerHTML = '<option value="">ทุกลาน</option>';
      zSel.innerHTML = '<option value="">ทุกโซน</option>';
      var zones = {};
      (res.lots || []).forEach(function (l) {
        var o = document.createElement('option');
        o.value = l.parkingId;
        o.textContent = l.parkingNo + ' · ' + l.parkingName +
          (l.status !== 'Active' ? ' (ยกเลิกแล้ว)' : '');
        pSel.appendChild(o);
        zones[l.zone] = true;
      });
      Object.keys(zones).forEach(function (z) {
        var o = document.createElement('option');
        o.value = z; o.textContent = z === 'ไม่กำกับโซน' ? z : 'Zone ' + z;
        zSel.appendChild(o);
      });
    }).catch(function (err) { console.warn('[admin parking options]', err); });
  }

  function searchHistory() {
    var params = {
      yearBE: Number($('#h-year').value),
      eventId: $('#h-event').value,
      parkingId: $('#h-parking').value,
      zone: $('#h-zone').value,
      recorder: $('#h-recorder').value.trim(),
      dateFrom: $('#h-date-from').value,
      dateTo: $('#h-date-to').value,
      timeFrom: $('#h-time-from').value,
      timeTo: $('#h-time-to').value,
      limit: 1000
    };
    App.showLoading(true);
    return adminCall('getHistory', params)
      .then(function (res) {
        historyData = res;
        $('#history-meta').textContent =
          'พบ ' + Utils.formatNumber(res.total) + ' รายการ · แสดง ' +
          Utils.formatNumber(res.returned) + ' รายการล่าสุด';
        renderHistory(res.items);
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  function renderHistory(items) {
    var tbody = $('#history-table tbody');
    tbody.innerHTML = '';
    if (!items.length) {
      var tr = document.createElement('tr');
      var td = Utils.el('td', 'empty-row', 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก');
      td.colSpan = 8; tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    items.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(Utils.el('td', '', r.recordId));
      tr.appendChild(Utils.el('td', '', Utils.formatShortDateTime(r.serverTimestamp)));
      var tdLot = document.createElement('td');
      tdLot.appendChild(Utils.el('span', 'lot-no', r.parkingNo));
      tdLot.appendChild(document.createTextNode(r.parkingName));
      tr.appendChild(tdLot);
      tr.appendChild(Utils.el('td', 'num', Utils.formatNumber(r.vehicleCount)));
      tr.appendChild(Utils.el('td', '', r.recorderName));
      tr.appendChild(Utils.el('td', '', r.email));
      tr.appendChild(Utils.el('td', '', r.phone || '—'));
      tr.appendChild(Utils.el('td', '', r.note || '—'));
      tbody.appendChild(tr);
    });
  }

  function exportHistory() {
    if (!historyData || !historyData.items.length) {
      Utils.toast('ยังไม่มีข้อมูลสำหรับส่งออก กรุณากดค้นหาก่อน', 'warn');
      return;
    }
    var headers = ['RecordID', 'RequestID', 'ปี', 'วันงาน', 'วันที่งาน', 'รหัสลาน', 'ลำดับลาน',
      'ชื่อลาน', 'โซน', 'ความจุ', 'จำนวนรถ', 'การใช้พื้นที่ (%)', 'สถานะ',
      'ผู้บันทึก', 'เบอร์โทร', 'อีเมล', 'เวลาเครื่องผู้ใช้', 'เวลาระบบ', 'หมายเหตุ', 'ช่องทาง'];
    var rows = historyData.items.map(function (r) {
      return [r.recordId, r.requestId, r.yearBE, r.eventName, r.eventDate, r.parkingId,
        r.parkingNo, r.parkingName, r.zone, r.capacity, r.vehicleCount, r.occupancyPercent,
        r.capacityStatus, r.recorderName, r.phone, r.email, r.clientTimestamp,
        r.serverTimestamp, r.note, r.source];
    });
    Utils.downloadCsv('history_' + historyData.yearBE + '.csv', Utils.toCsv(headers, rows));
  }

  /* ---------------- จัดการลานจอด ---------------- */
  function loadParking() {
    var year = Number($('#p-year').value) || App.state.currentYear;
    App.showLoading(true);
    return adminCall('getAdminParkingLots', { yearBE: year })
      .then(function (res) {
        renderParking(res.lots || [], year);
        fillDayConfigOptions(res.lots || [], year);
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  /** เติมตัวเลือกของแผงตั้งค่าเฉพาะวันงาน */
  function fillDayConfigOptions(lots, year) {
    var pSel = $('#dc-parking');
    var current = pSel.value;
    pSel.innerHTML = '';
    lots.filter(function (l) { return l.status === 'Active'; }).forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.parkingId;
      o.textContent = l.parkingNo + ' · ' + l.parkingName;
      pSel.appendChild(o);
    });
    if (current) pSel.value = current;
    Dashboard.fillEvents($('#dc-event'), year, false).catch(function (e) {
      console.warn('[day config events]', e);
    });
  }

  function saveDayConfig() {
    var year = Number($('#p-year').value) || App.state.currentYear;
    var eventId = $('#dc-event').value;
    var parkingId = $('#dc-parking').value;
    var cap = $('#dc-capacity').value.trim();

    if (!eventId) { Utils.toast('กรุณาเลือกวันงาน', 'error'); return; }
    if (!parkingId) { Utils.toast('กรุณาเลือกลานจอด', 'error'); return; }
    if (cap && !Utils.isInteger(cap)) {
      Utils.toast('ความจุเฉพาะวันต้องเป็นตัวเลขจำนวนเต็ม', 'error');
      $('#dc-capacity').focus();
      return;
    }

    App.showLoading(true);
    adminCall('setParkingDayConfig', {
      yearBE: year,
      eventId: eventId,
      parkingId: parkingId,
      isOpen: $('#dc-open').value,
      capacityOverride: cap,
      note: $('#dc-note').value.trim()
    }).then(function () {
      Utils.toast('บันทึกการตั้งค่าเฉพาะวันงานเรียบร้อย', 'success');
      $('#dc-capacity').value = '';
      $('#dc-note').value = '';
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function renderParking(lots, year) {
    var tbody = $('#parking-table tbody');
    tbody.innerHTML = '';
    if (!lots.length) {
      var tr0 = document.createElement('tr');
      var td0 = Utils.el('td', 'empty-row', 'ยังไม่มีลานจอดในปีนี้');
      td0.colSpan = 7; tr0.appendChild(td0); tbody.appendChild(tr0);
      return;
    }
    lots.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.appendChild(Utils.el('td', 'num', l.parkingNo));
      tr.appendChild(Utils.el('td', '', l.parkingId));
      tr.appendChild(Utils.el('td', '', l.parkingName));
      tr.appendChild(Utils.el('td', '', l.zone));
      tr.appendChild(Utils.el('td', 'num', Utils.formatNumber(l.capacity)));

      var tdSt = document.createElement('td');
      tdSt.appendChild(Utils.el('span', 'badge ' + (l.status === 'Active' ? 'st-normal' : 'st-none'),
        l.status === 'Active' ? 'ใช้งาน' : 'ยกเลิก'));
      tr.appendChild(tdSt);

      var tdAct = document.createElement('td');
      var actions = Utils.el('div', 'row-actions');

      var btnEdit = Utils.el('button', 'btn btn-secondary btn-sm', 'แก้ไข');
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', function () { editParking(l, year); });
      actions.appendChild(btnEdit);

      var isActive = l.status === 'Active';
      var btnToggle = Utils.el('button',
        'btn btn-sm ' + (isActive ? 'btn-danger' : 'btn-secondary'),
        isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน');
      btnToggle.type = 'button';
      btnToggle.addEventListener('click', function () { toggleParking(l, year, isActive); });
      actions.appendChild(btnToggle);

      tdAct.appendChild(actions);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  }

  function editParking(lot, year) {
    var name = window.prompt('ชื่อลานจอด', lot.parkingName);
    if (name === null) return;
    var zone = window.prompt('โซน (เช่น A, D, E หรือ ไม่กำกับโซน)', lot.zone);
    if (zone === null) return;
    var cap = window.prompt('ความจุ (คัน)', String(lot.capacity));
    if (cap === null) return;
    if (!Utils.isInteger(cap)) { Utils.toast('ความจุต้องเป็นตัวเลขจำนวนเต็ม', 'error'); return; }

    App.showLoading(true);
    adminCall('updateParking', {
      yearBE: year, parkingId: lot.parkingId,
      parkingName: name.trim(), defaultZone: zone.trim(), capacity: cap
    }).then(function () {
      Utils.toast('แก้ไขข้อมูลลานจอดเรียบร้อย (มีผลเฉพาะปี ' + year + ')', 'success');
      loadParking();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function toggleParking(lot, year, isActive) {
    var confirmText = isActive
      ? 'ยืนยันปิดใช้งานลาน "' + lot.parkingName + '" ในปี ' + year + '?\n' +
        'ข้อมูลเดิมจะยังคงอยู่ครบถ้วน เพียงแต่จะไม่แสดงในแบบฟอร์มบันทึก'
      : 'ยืนยันเปิดใช้งานลาน "' + lot.parkingName + '" ในปี ' + year + '?';
    if (!window.confirm(confirmText)) return;

    App.showLoading(true);
    adminCall(isActive ? 'deactivateParking' : 'activateParking', {
      yearBE: year, parkingId: lot.parkingId
    }).then(function () {
      Utils.toast('อัปเดตสถานะลานจอดเรียบร้อย', 'success');
      loadParking();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function addParking() {
    var year = Number($('#p-year').value) || App.state.currentYear;
    var name = $('#np-name').value.trim();
    var zone = $('#np-zone').value.trim() || 'ไม่กำกับโซน';
    var cap = $('#np-capacity').value.trim();

    if (!name) { Utils.toast('กรุณากรอกชื่อลานจอด', 'error'); $('#np-name').focus(); return; }
    if (!Utils.isInteger(cap)) {
      Utils.toast('ความจุต้องเป็นตัวเลขจำนวนเต็ม', 'error'); $('#np-capacity').focus(); return;
    }

    App.showLoading(true);
    adminCall('addParking', {
      yearBE: year, parkingName: name, defaultZone: zone, capacity: cap
    }).then(function (res) {
      Utils.toast('เพิ่มลานจอดลำดับที่ ' + res.parkingNo + ' เรียบร้อย', 'success');
      $('#np-name').value = ''; $('#np-zone').value = ''; $('#np-capacity').value = '';
      loadParking();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  /* ---------------- จัดการวันงาน ---------------- */
  function loadEvents() {
    var year = Number($('#e-year').value) || App.state.currentYear;
    App.showLoading(true);
    return Api.call('getEventDays', { yearBE: year })
      .then(function (res) { renderEvents(res.events || [], year); })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  function renderEvents(events, year) {
    var tbody = $('#events-table tbody');
    tbody.innerHTML = '';
    if (!events.length) {
      var tr0 = document.createElement('tr');
      var td0 = Utils.el('td', 'empty-row', 'ยังไม่มีวันงานในปีนี้');
      td0.colSpan = 5; tr0.appendChild(td0); tbody.appendChild(tr0);
      return;
    }
    events.forEach(function (ev) {
      var tr = document.createElement('tr');
      tr.appendChild(Utils.el('td', '', ev.eventId));
      tr.appendChild(Utils.el('td', '', ev.eventName));
      tr.appendChild(Utils.el('td', '', ev.eventDate
        ? Utils.formatThaiDate(ev.eventDate) + ' (' + ev.eventDate + ')'
        : 'ยังไม่กำหนดวันที่'));
      tr.appendChild(Utils.el('td', '', ev.status === 'Active' ? 'ใช้งาน' : 'ปิด'));

      var tdAct = document.createElement('td');
      var btn = Utils.el('button', 'btn btn-secondary btn-sm', 'แก้ไข');
      btn.type = 'button';
      btn.addEventListener('click', function () { editEvent(ev, year); });
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  }

  function editEvent(ev, year) {
    var name = window.prompt('ชื่อวันงาน', ev.eventName);
    if (name === null) return;
    var date = window.prompt('วันที่ (รูปแบบ YYYY-MM-DD ค.ศ.)', ev.eventDate || '');
    if (date === null) return;
    date = date.trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Utils.toast('รูปแบบวันที่ต้องเป็น YYYY-MM-DD', 'error');
      return;
    }
    App.showLoading(true);
    adminCall('updateEventDay', {
      yearBE: year, eventId: ev.eventId, eventName: name.trim(), eventDate: date
    }).then(function () {
      Utils.toast('แก้ไขวันงานเรียบร้อย', 'success');
      loadEvents();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function addEvent() {
    var year = Number($('#e-year').value) || App.state.currentYear;
    var id = $('#ne-id').value.trim().toUpperCase();
    var name = $('#ne-name').value.trim();
    var date = $('#ne-date').value;

    if (!id) { Utils.toast('กรุณากรอกรหัสวันงาน เช่น DAY04', 'error'); return; }
    if (!name) { Utils.toast('กรุณากรอกชื่อวันงาน', 'error'); return; }
    if (!date) { Utils.toast('กรุณาเลือกวันที่', 'error'); return; }

    App.showLoading(true);
    adminCall('addEventDay', {
      yearBE: year, eventId: id, eventName: name, eventDate: date
    }).then(function () {
      Utils.toast('เพิ่มวันงานเรียบร้อย', 'success');
      $('#ne-id').value = ''; $('#ne-name').value = ''; $('#ne-date').value = '';
      loadEvents();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  /* ---------------- จัดการปี ---------------- */
  function initYearTab() {
    App.renderYearOptions();
    $('#y-active').value = String(App.state.activeYear);
    $('#y-source').value = String(App.state.activeYear);
  }

  function createYear() {
    var target = $('#y-target').value.trim();
    if (!Utils.isInteger(target)) {
      Utils.toast('กรุณากรอกปี พ.ศ. เป็นตัวเลข เช่น 2570', 'error'); return;
    }
    var source = $('#y-source').value;
    var copyEvents = $('#y-copy-events').checked;

    if (!window.confirm('ยืนยันสร้างปี ' + target +
      (source ? ' โดยคัดลอกลานจอดจากปี ' + source : '') + '?\n' +
      'ข้อมูลของปีเดิมจะไม่ถูกแก้ไขใด ๆ')) return;

    App.showLoading(true);
    adminCall('createYear', {
      targetYearBE: target, sourceYearBE: source, copyEvents: copyEvents ? 'true' : 'false'
    }).then(function (res) {
      Utils.toast(res.message || 'สร้างปีใหม่เรียบร้อย', 'success');
      return App.bootstrap(App.state.currentYear, null);
    }).then(function () {
      App.renderYearOptions();
      initYearTab();
    }).catch(function (err) {
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function setActiveYear() {
    var y = $('#y-active').value;
    if (!y) return;
    if (!window.confirm('ตั้งให้ปี ' + y + ' เป็นปีที่ใช้งานของระบบ?')) return;

    App.showLoading(true);
    adminCall('setActiveYear', { yearBE: y })
      .then(function (res) {
        Utils.toast(res.message || 'ตั้งปีที่ใช้งานเรียบร้อย', 'success');
        return App.bootstrap(Number(y), null);
      })
      .then(function () { App.renderYearOptions(); initYearTab(); })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  /* ---------------- ระบบ ---------------- */
  function runHealth() {
    App.showLoading(true);
    Api.health().then(function (h) {
      $('#health-output').textContent = JSON.stringify(h, null, 2);
      Utils.toast('ตรวจสอบระบบเรียบร้อย', 'success');
      App.checkHealth();
    }).catch(function (err) {
      $('#health-output').textContent = 'ไม่สามารถเชื่อมต่อระบบได้: ' + Api.friendlyMessage(err);
      Utils.toast(Api.friendlyMessage(err), 'error');
    }).then(function () { App.showLoading(false); });
  }

  function rebuild() {
    var year = Number($('#h-year').value) || App.state.currentYear;
    if (!window.confirm('สร้างสรุปข้อมูล (SUMMARY) ของปี ' + year + ' ใหม่?\n' +
      'ข้อมูลดิบ (RECORDS) จะไม่ถูกแก้ไข')) return;
    App.showLoading(true);
    adminCall('rebuildSummary', { yearBE: year })
      .then(function (res) {
        Utils.toast('สร้างสรุปข้อมูลใหม่แล้ว ' + res.rows + ' แถว', 'success');
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  function loadAudit() {
    App.showLoading(true);
    adminCall('getAuditLog', { limit: 200 })
      .then(function (res) {
        var tbody = $('#audit-table tbody');
        tbody.innerHTML = '';
        if (!res.items.length) {
          var tr0 = document.createElement('tr');
          var td0 = Utils.el('td', 'empty-row', 'ยังไม่มีบันทึกการเปลี่ยนแปลง');
          td0.colSpan = 5; tr0.appendChild(td0); tbody.appendChild(tr0);
          return;
        }
        res.items.forEach(function (a) {
          var tr = document.createElement('tr');
          tr.appendChild(Utils.el('td', '', Utils.formatShortDateTime(a.timestamp)));
          tr.appendChild(Utils.el('td', '', a.action));
          tr.appendChild(Utils.el('td', '', a.yearBE));
          tr.appendChild(Utils.el('td', '', a.targetType + ' ' + a.targetId));
          tr.appendChild(Utils.el('td', '', a.actorEmail || a.actorName || '—'));
          tbody.appendChild(tr);
        });
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  /* ---------------- bind ---------------- */
  function bind() {
    $('#btn-admin-login').addEventListener('click', login);
    $('#a-token').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); login(); }
    });
    $('#btn-admin-logout').addEventListener('click', logout);

    Utils.$$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    $('#btn-history-search').addEventListener('click', searchHistory);
    $('#btn-export-history').addEventListener('click', exportHistory);
    $('#h-year').addEventListener('change', function () {
      var y = Number($('#h-year').value);
      Dashboard.fillEvents($('#h-event'), y, true).catch(function (e) {
        console.warn('[admin events]', e);
      });
      loadParkingOptions(y);
    });

    $('#btn-parking-refresh').addEventListener('click', loadParking);
    $('#btn-add-parking').addEventListener('click', addParking);
    $('#btn-day-config').addEventListener('click', saveDayConfig);
    $('#p-year').addEventListener('change', loadParking);

    $('#btn-events-refresh').addEventListener('click', loadEvents);
    $('#btn-add-event').addEventListener('click', addEvent);
    $('#e-year').addEventListener('change', loadEvents);

    $('#btn-create-year').addEventListener('click', createYear);
    $('#btn-set-active-year').addEventListener('click', setActiveYear);

    $('#btn-health').addEventListener('click', runHealth);
    $('#btn-rebuild').addEventListener('click', rebuild);
    $('#btn-audit').addEventListener('click', loadAudit);
  }

  return { onEnter: onEnter };
})();
