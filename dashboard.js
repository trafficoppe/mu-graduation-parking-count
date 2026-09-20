/**
 * dashboard.js
 * หน้า "ข้อมูลล่าสุด" และ "แดชบอร์ด"
 *
 * กฎสำคัญ: ยอดรวมทั้งหมดมาจาก Record ล่าสุดของแต่ละลานเท่านั้น (คำนวณที่ Backend)
 * หน้านี้ทำหน้าที่แสดงผล ไม่คำนวณยอดรวมซ้ำจาก transaction ทั้งหมด
 */
var Dashboard = (function () {
  'use strict';

  var $ = Utils.$;
  var latestData = null;
  var dashData = null;
  var trendData = null;
  var latestInit = false;
  var dashInit = false;
  var autoTimer = null;

  /* ---------- helper: เติมตัวเลือกวันงาน ---------- */
  function fillEvents(selectEl, year, includeAll) {
    return Api.call('getEventDays', { yearBE: year }).then(function (res) {
      var events = res.events || [];
      var current = selectEl.value;
      selectEl.innerHTML = '';
      if (includeAll) {
        var all = document.createElement('option');
        all.value = ''; all.textContent = 'ทุกวันงาน';
        selectEl.appendChild(all);
      }
      events.forEach(function (ev) {
        var o = document.createElement('option');
        o.value = ev.eventId;
        o.textContent = ev.eventName + ' (' + Utils.formatThaiDate(ev.eventDate) + ')';
        selectEl.appendChild(o);
      });
      if (current && Array.prototype.some.call(selectEl.options, function (o) { return o.value === current; })) {
        selectEl.value = current;
      } else if (!includeAll && events.length) {
        var appEv = App.currentEvent();
        selectEl.value = (appEv && events.some(function (e) { return e.eventId === appEv.eventId; }))
          ? appEv.eventId : events[0].eventId;
      }
      return events;
    });
  }

  /* ============================================================
   * หน้า "ข้อมูลล่าสุด"
   * ============================================================ */
  function onEnterLatest() {
    if (!Api.isConfigured()) {
      $('#latest-meta').textContent =
        'ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ';
      return;
    }
    if (!latestInit) {
      latestInit = true;
      App.renderYearOptions();
      $('#l-year').value = String(App.state.currentYear);
      $('#btn-latest-refresh').addEventListener('click', loadLatest);
      $('#l-year').addEventListener('change', function () {
        fillEvents($('#l-event'), Number($('#l-year').value), false).then(loadLatest);
      });
      $('#l-event').addEventListener('change', loadLatest);
      $('#l-search').addEventListener('input', Utils.debounce(renderLatestTable, 150));
      $('#btn-export-latest').addEventListener('click', exportLatestCsv);
      fillEvents($('#l-event'), Number($('#l-year').value), false).then(loadLatest);
    } else if (!latestData) {
      loadLatest();
    }
  }

  function loadLatest() {
    var year = Number($('#l-year').value);
    var eventId = $('#l-event').value;
    if (!eventId) {
      $('#latest-meta').textContent = 'ยังไม่มีข้อมูลวันงานของปีนี้';
      $('#latest-table tbody').innerHTML = '';
      return Promise.resolve();
    }
    App.showLoading(true);
    return Api.call('getLatestSnapshot', { yearBE: year, eventId: eventId })
      .then(function (res) {
        latestData = res;
        var reported = res.items.filter(function (i) { return i.hasData; }).length;
        $('#latest-meta').textContent =
          res.event.eventName + ' · ' + Utils.formatThaiDate(res.event.eventDate) +
          ' · รายงานแล้ว ' + reported + ' จาก ' + res.items.length + ' ลาน' +
          ' · ข้อมูล ณ ' + Utils.formatShortDateTime(res.generatedAt);
        renderLatestTable();
      })
      .catch(function (err) { Utils.toast(Api.friendlyMessage(err), 'error'); })
      .then(function () { App.showLoading(false); });
  }

  function renderLatestTable() {
    var tbody = $('#latest-table tbody');
    tbody.innerHTML = '';
    if (!latestData) return;
    var q = $('#l-search').value.trim().toLowerCase();

    var items = latestData.items.filter(function (i) {
      if (!q) return true;
      return (i.parkingNo + ' ' + i.parkingName + ' ' + i.zone).toLowerCase().indexOf(q) >= 0;
    });

    if (items.length === 0) {
      var tr = document.createElement('tr');
      var td = Utils.el('td', 'empty-row', 'ไม่พบข้อมูลที่ตรงกับคำค้นหา');
      td.colSpan = 5;
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }

    items.forEach(function (i) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      var no = Utils.el('span', 'lot-no', i.parkingNo);
      tdName.appendChild(no);
      tdName.appendChild(document.createTextNode(i.parkingName));
      if (i.zone && i.zone !== 'ไม่กำกับโซน') {
        tdName.appendChild(Utils.el('div', 'hint', 'Zone ' + i.zone));
      }
      tr.appendChild(tdName);

      tr.appendChild(numCell(Utils.formatNumber(i.capacity)));
      tr.appendChild(numCell(i.hasData ? Utils.formatNumber(i.vehicleCount) : '—'));

      var tdPct = document.createElement('td');
      tdPct.className = 'num';
      if (i.hasData) {
        tdPct.appendChild(Utils.el('span', 'badge ' + Utils.statusClass(i.capacityStatus),
          Utils.formatPercent(i.occupancyPercent)));
      } else {
        tdPct.appendChild(Utils.el('span', 'badge st-none', 'ยังไม่มีข้อมูล'));
      }
      tr.appendChild(tdPct);

      var tdTime = Utils.el('td', '', i.hasData ? Utils.formatShortDateTime(i.lastUpdate) : '—');
      if (i.recordCount > 1) {
        tdTime.appendChild(Utils.el('div', 'hint', 'บันทึกแล้ว ' + i.recordCount + ' ครั้ง'));
      }
      tr.appendChild(tdTime);

      tbody.appendChild(tr);
    });
  }

  function numCell(text) {
    var td = Utils.el('td', 'num', text);
    return td;
  }

  function exportLatestCsv() {
    if (!latestData) { Utils.toast('ยังไม่มีข้อมูลสำหรับส่งออก', 'warn'); return; }
    var headers = ['ลำดับ', 'รหัสลาน', 'ชื่อลาน', 'โซน', 'ความจุ', 'จำนวนรถล่าสุด',
      'การใช้พื้นที่ (%)', 'สถานะ', 'อัปเดตล่าสุด', 'จำนวนครั้งที่บันทึก'];
    var rows = latestData.items.map(function (i) {
      return [i.parkingNo, i.parkingId, i.parkingName, i.zone, i.capacity,
        i.hasData ? i.vehicleCount : '', i.hasData ? i.occupancyPercent : '',
        i.hasData ? i.capacityStatus : 'ยังไม่มีข้อมูล', i.lastUpdate, i.recordCount];
    });
    Utils.downloadCsv('latest_' + latestData.yearBE + '_' + latestData.event.eventId + '.csv',
      Utils.toCsv(headers, rows));
  }

  /* ============================================================
   * หน้า "แดชบอร์ด"
   * ============================================================ */
  function onEnterDashboard() {
    if (!Api.isConfigured()) {
      $('#dash-meta').textContent =
        'ระบบยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน กรุณาติดต่อผู้ดูแลระบบ';
      return;
    }
    if (!dashInit) {
      dashInit = true;
      App.renderYearOptions();
      $('#d-year').value = String(App.state.currentYear);
      $('#btn-dash-refresh').addEventListener('click', loadDashboard);
      $('#d-year').addEventListener('change', function () {
        fillEvents($('#d-event'), Number($('#d-year').value), false).then(loadDashboard);
      });
      $('#d-event').addEventListener('change', loadDashboard);
      $('#d-zone').addEventListener('change', loadDashboard);
      $('#d-parking').addEventListener('change', loadDashboard);
      $('#d-interval').addEventListener('change', loadTrend);
      $('#btn-export-dash').addEventListener('click', exportDashCsv);
      fillEvents($('#d-event'), Number($('#d-year').value), false).then(loadDashboard);
    } else {
      loadDashboard();
    }
    startAutoRefresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (!APP_CONFIG.DASHBOARD_AUTO_REFRESH_MS) return;
    autoTimer = setInterval(function () {
      var view = $('#view-dashboard');
      if (view && view.classList.contains('active') && navigator.onLine !== false) {
        loadDashboard(true);
      } else {
        stopAutoRefresh();
      }
    }, APP_CONFIG.DASHBOARD_AUTO_REFRESH_MS);
  }
  function stopAutoRefresh() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  function loadDashboard(silent) {
    var year = Number($('#d-year').value);
    var eventId = $('#d-event').value;
    if (!eventId) {
      $('#dash-meta').textContent = 'ยังไม่มีข้อมูลวันงานของปีนี้';
      return Promise.resolve();
    }
    if (!silent) App.showLoading(true);

    var params = { yearBE: year, eventId: eventId };
    if ($('#d-zone').value) params.zone = $('#d-zone').value;
    if ($('#d-parking').value) params.parkingId = $('#d-parking').value;

    return Api.call('getDashboardSummary', params)
      .then(function (res) {
        dashData = res;
        renderKpi(res);
        renderDashTable(res);
        renderRanking(res);
        renderZoneTable(res);
        renderNotReported(res);
        fillZoneAndParkingFilters(res);
        $('#dash-meta').textContent =
          res.event.eventName + ' · ' + Utils.formatThaiDate(res.event.eventDate) +
          ' · ข้อมูล ณ ' + Utils.formatShortDateTime(res.generatedAt);
        return loadTrend();
      })
      .catch(function (err) {
        if (!silent) Utils.toast(Api.friendlyMessage(err), 'error');
        console.warn('[dashboard]', err);
      })
      .then(function () { if (!silent) App.showLoading(false); });
  }

  function fillZoneAndParkingFilters(res) {
    var zoneSel = $('#d-zone');
    if (zoneSel.options.length <= 1 && res.zoneSummary) {
      res.zoneSummary.forEach(function (z) {
        var o = document.createElement('option');
        o.value = z.zone; o.textContent = z.zone === 'ไม่กำกับโซน' ? z.zone : 'Zone ' + z.zone;
        zoneSel.appendChild(o);
      });
    }
    var pSel = $('#d-parking');
    if (pSel.options.length <= 1 && res.table) {
      res.table.forEach(function (r) {
        var o = document.createElement('option');
        o.value = r.parkingId; o.textContent = r.parkingNo + ' · ' + r.parkingName;
        pSel.appendChild(o);
      });
    }
  }

  function kpiCard(label, value, sub, alert) {
    var box = Utils.el('div', 'kpi' + (alert ? ' alert-kpi' : ''));
    box.appendChild(Utils.el('div', 'k-label', label));
    box.appendChild(Utils.el('div', 'k-value', value));
    if (sub) box.appendChild(Utils.el('div', 'k-sub', sub));
    return box;
  }

  function renderKpi(res) {
    var k = res.kpi;
    var grid = $('#kpi-grid');
    grid.innerHTML = '';
    grid.appendChild(kpiCard('ลานจอดทั้งหมด', Utils.formatNumber(k.totalLots), 'ลานที่เปิดใช้งานวันนี้'));
    grid.appendChild(kpiCard('รายงานข้อมูลแล้ว', Utils.formatNumber(k.reportedLots),
      'จากทั้งหมด ' + k.totalLots + ' ลาน'));
    grid.appendChild(kpiCard('ยังไม่รายงาน', Utils.formatNumber(k.notReportedLots),
      'ต้องติดตาม', k.notReportedLots > 0));
    grid.appendChild(kpiCard('จำนวนรถยนต์รวม', Utils.formatNumber(k.totalVehicles),
      'จากข้อมูลล่าสุดของแต่ละลาน'));
    grid.appendChild(kpiCard('ความจุรวม', Utils.formatNumber(k.totalCapacity), 'คัน'));
    grid.appendChild(kpiCard('อัตราการใช้พื้นที่รวม', Utils.formatPercent(k.overallOccupancyPercent),
      'เฉพาะลานที่เลือก'));
    grid.appendChild(kpiCard('ลานที่เต็ม/เกินความจุ', Utils.formatNumber(k.fullLots),
      'ตั้งแต่ 100% ขึ้นไป', k.fullLots > 0));
    grid.appendChild(kpiCard('จำนวนรายการบันทึก', Utils.formatNumber(k.totalRecords),
      'ทุกรอบเวลาในวันงานนี้'));
  }

  function renderDashTable(res) {
    var tbody = $('#dash-table tbody');
    tbody.innerHTML = '';
    if (!res.table.length) {
      var tr = document.createElement('tr');
      var td = Utils.el('td', 'empty-row', 'ไม่พบลานจอดตามเงื่อนไขที่เลือก');
      td.colSpan = 7; tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    res.table.forEach(function (r) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.appendChild(Utils.el('span', 'lot-no', r.parkingNo));
      tdName.appendChild(document.createTextNode(r.parkingName));
      tr.appendChild(tdName);

      tr.appendChild(Utils.el('td', '', r.zone));
      tr.appendChild(numCell(Utils.formatNumber(r.capacity)));
      tr.appendChild(numCell(r.hasData ? Utils.formatNumber(r.vehicleCount) : '—'));
      tr.appendChild(numCell(r.hasData ? Utils.formatPercent(r.occupancyPercent) : '—'));

      var tdTime = Utils.el('td', '', r.hasData ? Utils.formatShortDateTime(r.lastUpdate) : '—');
      if (r.recordCount > 1) tdTime.appendChild(Utils.el('div', 'hint', r.recordCount + ' ครั้ง'));
      tr.appendChild(tdTime);

      var tdSt = document.createElement('td');
      tdSt.appendChild(Utils.el('span', 'badge ' + Utils.statusClass(r.capacityStatus),
        r.capacityStatus));
      tr.appendChild(tdSt);

      tbody.appendChild(tr);
    });
  }

  function renderRanking(res) {
    function fill(listEl, items, valueFn) {
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.appendChild(Utils.el('li', '', 'ยังไม่มีข้อมูล'));
        return;
      }
      items.forEach(function (r) {
        var li = document.createElement('li');
        li.appendChild(document.createTextNode(r.parkingNo + ' · ' + r.parkingName));
        li.appendChild(Utils.el('span', 'val', valueFn(r)));
        listEl.appendChild(li);
      });
    }
    fill($('#rank-count'), res.rankingByCount, function (r) {
      return Utils.formatNumber(r.vehicleCount) + ' คัน';
    });
    fill($('#rank-util'), res.rankingByUtilization, function (r) {
      return Utils.formatPercent(r.occupancyPercent);
    });
  }

  function renderZoneTable(res) {
    var tbody = $('#zone-table tbody');
    tbody.innerHTML = '';
    res.zoneSummary.forEach(function (z) {
      var tr = document.createElement('tr');
      tr.appendChild(Utils.el('td', '', z.zone === 'ไม่กำกับโซน' ? z.zone : 'Zone ' + z.zone));
      tr.appendChild(numCell(Utils.formatNumber(z.lots)));
      tr.appendChild(numCell(Utils.formatNumber(z.reported)));
      tr.appendChild(numCell(Utils.formatNumber(z.capacity)));
      tr.appendChild(numCell(Utils.formatNumber(z.vehicleCount)));
      tr.appendChild(numCell(Utils.formatPercent(z.occupancyPercent)));
      tbody.appendChild(tr);
    });
  }

  function renderNotReported(res) {
    var ul = $('#not-reported');
    ul.innerHTML = '';
    if (!res.notReported.length) {
      ul.appendChild(Utils.el('li', 'none', 'ทุกลานรายงานข้อมูลครบแล้ว'));
      return;
    }
    res.notReported.forEach(function (p) {
      ul.appendChild(Utils.el('li', '', p.parkingNo + ' · ' + p.parkingName));
    });
  }

  function loadTrend() {
    if (!dashData) return Promise.resolve();
    var params = {
      yearBE: dashData.yearBE,
      eventId: dashData.event.eventId,
      intervalMinutes: $('#d-interval').value
    };
    if ($('#d-zone').value) params.zone = $('#d-zone').value;
    if ($('#d-parking').value) params.parkingId = $('#d-parking').value;

    return Api.call('getTimeTrend', params).then(function (res) {
      trendData = res;
      renderTrend(res);
    }).catch(function (err) {
      console.warn('[trend]', err);
      $('#trend-chart').innerHTML = '';
      $('#trend-chart').appendChild(
        Utils.el('p', 'trend-empty', 'ไม่สามารถโหลดข้อมูลแนวโน้มได้ในขณะนี้'));
    });
  }

  function renderTrend(res) {
    var box = $('#trend-chart');
    box.innerHTML = '';
    if (!res.points || res.points.length === 0) {
      box.appendChild(Utils.el('p', 'trend-empty', 'ยังไม่มีข้อมูลเพียงพอสำหรับแสดงแนวโน้ม'));
      return;
    }
    var max = 0;
    res.points.forEach(function (p) { if (p.vehicleCount > max) max = p.vehicleCount; });
    if (max <= 0) max = 1;

    res.points.forEach(function (p) {
      var col = Utils.el('div', 'trend-bar');
      col.appendChild(Utils.el('div', 'bar-value', Utils.formatNumber(p.vehicleCount)));
      var bar = Utils.el('div', 'bar');
      bar.style.height = Math.max(4, Math.round(p.vehicleCount / max * 120)) + 'px';
      bar.setAttribute('title', p.timeLabel + ' · ' + p.vehicleCount + ' คัน · ' +
        p.lotsIncluded + ' ลาน');
      col.appendChild(bar);
      col.appendChild(Utils.el('div', 'bar-label', p.timeLabel));
      col.appendChild(Utils.el('div', 'bar-sub', p.lotsIncluded + ' ลาน'));
      box.appendChild(col);
    });
  }

  function exportDashCsv() {
    if (!dashData) { Utils.toast('ยังไม่มีข้อมูลสำหรับส่งออก', 'warn'); return; }
    var headers = ['ลำดับ', 'รหัสลาน', 'ชื่อลาน', 'โซน', 'ความจุ', 'จำนวนรถล่าสุด',
      'การใช้พื้นที่ (%)', 'สถานะ', 'อัปเดตล่าสุด', 'จำนวนครั้งที่บันทึก'];
    var rows = dashData.table.map(function (r) {
      return [r.parkingNo, r.parkingId, r.parkingName, r.zone, r.capacity,
        r.hasData ? r.vehicleCount : '', r.hasData ? r.occupancyPercent : '',
        r.capacityStatus, r.lastUpdate, r.recordCount];
    });
    Utils.downloadCsv('dashboard_' + dashData.yearBE + '_' + dashData.event.eventId + '.csv',
      Utils.toCsv(headers, rows));
  }

  return {
    onEnterLatest: onEnterLatest,
    onEnterDashboard: onEnterDashboard,
    fillEvents: fillEvents
  };
})();
