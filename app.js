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
 *
 * เวอร์ชัน 1.3.0 — รอบการนับรถ 2 รอบต่อวัน:
 *  - เพิ่มขั้นตอน "เลือกรอบ" และนาฬิกาเวลาระบบ + นับถอยหลัง
 *  - เวลาที่ใช้แสดงผลคือ "เวลาของเซิร์ฟเวอร์" ที่ชดเชยส่วนต่างกับเครื่องผู้ใช้แล้ว
 *    ผู้ใช้แก้นาฬิกาเครื่องตัวเองแล้วหน้าจออาจคลาดเคลื่อนชั่วคราว
 *    แต่ "บันทึกไม่ผ่าน" อยู่ดี เพราะเซิร์ฟเวอร์ตรวจด้วยนาฬิกาของตัวเองทุกครั้ง
 *  - รอบเปลี่ยนเองตามเวลาจริงโดยไม่ต้องรีเฟรชหน้า (เช่น 10:59:59 -> 11:00:00)
 *
 * เวอร์ชัน 1.3.1 — สถานะ "กรอกข้อมูลเรียบร้อยแล้ว" รายลาน:
 *  - สถานะของแต่ละลานมาจากข้อมูลจริงในระบบหลังบ้านเท่านั้น (action getRoundProgress)
 *    ไม่ใช้ localStorage หรือสถานะในเบราว์เซอร์เป็นแหล่งข้อมูลหลักเด็ดขาด
 *  - กุญแจของสถานะคือ วันงาน (EventID) + รอบ (RoundID) + ลานจอด (ParkingID)
 *    คนละวันหรือคนละรอบ จึงเป็นคนละสถานะเสมอ
 *  - เซิร์ฟเวอร์ตรวจซ้ำอีกชั้นทุกครั้งที่กดบันทึก (ERR ALREADY_RECORDED)
 *
 * เวอร์ชัน 1.3.2 — แก้ไขได้เฉพาะเจ้าของรายการ:
 *  - ปุ่มแก้ไขบนหน้าเว็บเป็นเพียง "การแสดงผล" ไม่ใช่การให้สิทธิ์
 *  - สิทธิ์จริงตัดสินที่เซิร์ฟเวอร์ทุกครั้ง โดยเทียบรหัสบัญชี Google (sub)
 *    ที่เซิร์ฟเวอร์ตรวจสอบเอง กับ GoogleSub ที่บันทึกไว้ในแถวเดิม
 *  - หน้าเว็บรู้เพียงว่า "ลานใดเป็นของฉัน" (getMyRoundOwnership)
 *    ไม่เคยรู้ว่าลานอื่นเป็นของใคร จึงไม่มีการเปิดเผยตัวตนผู้อื่น
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
    // ---- เวอร์ชัน 1.3.0: รอบการนับรถ + นาฬิกาเวลาระบบ ----
    rounds: [],              // [{roundId, roundNo, roundName, startTime, endTime, startAt, endAt, state}]
    roundsConfigured: false, // วันงานนี้ตั้งค่ารอบไว้หรือยัง
    selectedRoundId: '',
    serverOffsetMs: 0,       // เวลาเซิร์ฟเวอร์ - เวลาเครื่องผู้ใช้ (มิลลิวินาที)
    serverClockReady: false,
    // ---- เวอร์ชัน 1.3.1: สถานะ "กรอกแล้ว/ยังไม่กรอก" ของทุกลาน ----
    progress: null,          // { eventId, roundId, total, completed, pending, byLot: {ParkingID: {...}} }
    progressLoading: false,
    editMode: false,         // true เมื่อเจ้าหน้าที่ยืนยันขอแก้ไขข้อมูลลานที่บันทึกไว้แล้ว
    editLotId: '',
    // ---- เวอร์ชัน 1.3.2 ----
    ownedLots: {},           // { ParkingID: true } เฉพาะลานที่บัญชีนี้เป็นผู้บันทึก
    ownershipKey: '',        // 'EventID|RoundID' ที่โหลดข้อมูลความเป็นเจ้าของไว้แล้ว
    requestId: null,
    submitting: false,
    submitAttempt: false,   // true เฉพาะช่วงที่ผู้ใช้เพิ่งกดปุ่มบันทึก (ใช้ตัดสินใจเด้ง popup)
    ready: false
  };

  var $ = Utils.$;
  var statusTimer = null;
  var authStarted = false;
  var clockTimer = null;
  var lastTickWall = 0;      // ใช้ตรวจจับว่าผู้ใช้เปลี่ยนนาฬิกาเครื่อง/เครื่องหลับ
  var lastRoundSignature = '';
  var lastProgressKey = '';  // 'EventID|RoundID' ที่โหลดสถานะลานไว้แล้ว
  var lastLotQuery = '';     // คำค้นหาล่าสุดของรายการลาน (ใช้ตอนวาดใหม่)

  /** คีย์บอกว่า "เซสชันนี้บันทึกการลงชื่อเข้าใช้ไปแล้ว" — ใช้กันบันทึกซ้ำเท่านั้น
   *  ไม่ใช่ข้อมูลสิทธิ์ และเซิร์ฟเวอร์มีตัวกันซ้ำของตัวเองอีกชั้นอยู่แล้ว */
  var SIGNIN_LOG_KEY = 'gpvcs.signinLogged.v1';

  /** ข้อความแจ้งเรื่องเบอร์โทรศัพท์ — ใช้ที่เดียวทั้งไฟล์ ให้ตรงกับฝั่งเซิร์ฟเวอร์ */
  var PHONE_MESSAGE =
    'กรุณาตรวจสอบเบอร์โทรศัพท์อีกครั้ง เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก กรุณากรอกข้อมูลใหม่อีกครั้ง';

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
    state.ready = true;

    // เทียบนาฬิกากับเซิร์ฟเวอร์ก่อนเสมอ เพื่อให้รอบและตัวนับถอยหลังถูกต้อง
    syncServerClock(res.serverTime || '');

    // เริ่มระบบลงชื่อเข้าใช้ด้วย Client ID ที่ได้จากระบบหลังบ้าน (ตั้งค่าที่เดียว)
    if (!authStarted && res.auth) {
      authStarted = true;
      Auth.init(res.auth.clientId || '');
    }

    if (res.config) {
      if (res.config.orgName) $('#footer-org').textContent = res.config.orgName;
      $('#footer-version').textContent = 'v' + (res.config.appVersion || APP_CONFIG.APP_VERSION);
      if (res.config.logoUrl) applyLogo(res.config.logoUrl);
    }

    $('#f-year').value = String(state.currentYear);
    renderYearButtons();
    renderYearOptions();
    renderEventButtons(res.defaultEventId);
    updateHeaderEvent();

    // สถานะ "กรอกแล้ว/ยังไม่กรอก" ของทุกลาน มากับ getBootstrap แล้ว (เวอร์ชัน 1.3.1)
    // ตั้งค่าไว้ก่อน เพื่อไม่ให้ยิงคำขอซ้ำอีกรอบตอนวาดปุ่มรอบ
    if (res.roundProgress && res.roundProgress.eventId) {
      lastProgressKey = res.roundProgress.eventId + '|' + (res.roundProgress.roundId || '');
      applyRoundProgress(res.roundProgress);
    } else {
      lastProgressKey = '';
      applyRoundProgress(null);
    }

    // รอบการนับรถของวันงานที่เลือก (มาพร้อม getBootstrap แล้ว ไม่ต้องยิงเพิ่ม)
    if (res.roundStatus && res.roundStatus.eventId &&
        res.roundStatus.eventId === $('#f-event').value) {
      applyRoundStatus(res.roundStatus);
    } else {
      reloadRounds();
    }

    renderLotList('');
    updateSelectionCard();
    startClock();
  }

  /** ขอข้อมูลรอบของวันงานที่เลือกอยู่จากเซิร์ฟเวอร์ */
  function reloadRounds() {
    var eventId = $('#f-event').value;
    if (!eventId || !Api.isConfigured() || navigator.onLine === false) {
      applyRoundStatus(null);
      return Promise.resolve();
    }
    return Api.call('getRoundStatus', { yearBE: state.currentYear, eventId: eventId })
      .then(function (res) {
        syncServerClock(res.serverTime || '');
        applyRoundStatus(res.roundStatus);
      })
      .catch(function (err) {
        console.warn('[rounds]', err);
        applyRoundStatus(null);
      });
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
        // แสดงเป็น "วันที่" ไม่ใช่เวลาระดับระบบ (ผู้ใช้ไม่ต้องรู้เวลาเปิด/ปิดระดับระบบ)
        msg = 'ยังไม่ถึงวันงาน ระบบจะเปิดให้บันทึก' + upcoming[0].eventName +
          ' ในวันที่ ' + Utils.formatThaiDate(upcoming[0].eventDate);
      } else if (state.events.length) {
        msg = 'พ้นช่วงเวลาบันทึกของทุกวันงานในปีนี้แล้ว';
      }
      box.appendChild(Utils.el('p', 'choice-empty', msg));
      $('#f-event').value = '';
      $('#f-event-date').textContent = '—';
      applyRoundStatus(null);
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
      // เวอร์ชัน 1.3.0: ไม่แสดงเวลาปิดระดับระบบ (เช่น 19:00) ให้ผู้ใช้เห็น
      // ผู้ใช้ต้องเห็นเฉพาะเวลาปิดรับของ "รอบ" เท่านั้น (ดูการ์ดรอบในขั้นตอนถัดไป)
      btn.appendChild(Utils.el('span', 'cb-sub', Utils.formatThaiDate(ev.eventDate)));
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
    reloadRounds();
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
    // เวอร์ชัน 1.3.0: แสดงเฉพาะวันที่ ไม่แสดงเวลาปิดระดับระบบ
    // เวลาปิดรับที่ผู้ใช้ต้องรู้คือเวลาปิดของแต่ละรอบ ซึ่งแสดงอยู่ในขั้นตอน "รอบการนับข้อมูล"
    $('#f-event-date').textContent = 'วันที่ ' + Utils.formatThaiDate(ev.eventDate);
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
    var needRound = state.roundsConfigured && !activeRound();
    btn.title = !signedIn ? 'กดปุ่มเพื่อดูขั้นตอนการลงชื่อเข้าใช้ด้วยบัญชี Google'
      : (!hasEvent ? 'ขณะนี้ยังไม่มีวันงานที่เปิดให้บันทึก — กดปุ่มเพื่อดูรายละเอียด'
      : (needRound ? 'ขณะนี้ไม่มีรอบเปิดรับการนับข้อมูล — กดปุ่มเพื่อดูรายละเอียด' : ''));
  }

  /* ==================================================================
     เวอร์ชัน 1.3.0 — นาฬิกาเวลาระบบ, รอบการนับรถ และการนับถอยหลัง
     ==================================================================

     หลักการที่ต้องไม่ลืม:
       1. "เวลาที่ใช้ตัดสินจริง" คือเวลาของเซิร์ฟเวอร์เท่านั้น
          หน้าเว็บเพียงชดเชยส่วนต่างเพื่อแสดงผลและเลือกรอบให้อัตโนมัติ
       2. ทุกครั้งที่กดบันทึก เซิร์ฟเวอร์ตรวจรอบใหม่ทั้งหมดด้วยนาฬิกาของตัวเอง
          การแก้นาฬิกาเครื่องผู้ใช้จึงไม่ช่วยให้บันทึกนอกรอบได้
       3. เวลาเซิร์ฟเวอร์อยู่ในเขตเวลาไทย (Asia/Bangkok) เสมอ
          จึงแปลงเป็นเวลาไทยโดยตรง ไม่ขึ้นกับเขตเวลาของเครื่องผู้ใช้
  */

  /** แปลงเวลาจากเซิร์ฟเวอร์เป็นตัวเลขเวลา (epoch ms) — ถือเป็นเวลาไทยเสมอ */
  function parseServerStamp(v) {
    var m = String(v === null || v === undefined ? '' : v)
      .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0)) - 7 * 3600 * 1000;
  }

  /** ตั้งค่าส่วนต่างระหว่างนาฬิกาเซิร์ฟเวอร์กับนาฬิกาเครื่องผู้ใช้ */
  function syncServerClock(serverTime) {
    var t = parseServerStamp(serverTime);
    if (t === null) return;
    state.serverTime = serverTime;
    state.serverOffsetMs = t - Date.now();
    state.serverClockReady = true;
    lastTickWall = Date.now();
    renderClock();
  }

  /** เวลาปัจจุบันของเซิร์ฟเวอร์ (epoch ms) */
  function serverNow() {
    return Date.now() + state.serverOffsetMs;
  }

  /** แยกส่วนเวลาไทยจาก epoch ms (ไม่พึ่งเขตเวลาของเครื่องผู้ใช้) */
  function bangkokParts(epochMs) {
    var d = new Date(epochMs + 7 * 3600 * 1000);
    return {
      hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(),
      date: d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate())
    };
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }

  /** 'HH:MM:SS' จากจำนวนวินาที (ไม่ติดลบ) */
  function formatDuration(totalSec) {
    var s = Math.max(0, Math.floor(totalSec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return two(h) + ':' + two(m) + ':' + two(sec);
  }

  /** แสดงนาฬิกาเวลาระบบ (อัปเดตทุก 1 วินาที ไม่เรียก API) */
  function renderClock() {
    var box = $('#server-clock');
    if (!box) return;
    if (!state.serverClockReady) { box.textContent = '--:--:--'; return; }
    var p = bangkokParts(serverNow());
    box.textContent = two(p.hh) + ':' + two(p.mm) + ':' + two(p.ss);
  }

  /** คำนวณสถานะรอบจากเวลาเซิร์ฟเวอร์ปัจจุบัน (ใช้กติกาเดียวกับ Backend) */
  function roundStateNow(r) {
    var start = parseServerStamp(r.startAt);
    var end = parseServerStamp(r.endAt);
    if (start === null || end === null) return r.state || 'NO_DATE';
    if (r.status && r.status !== 'Active') return 'INACTIVE';
    var now = serverNow();
    if (now < start) return 'UPCOMING';
    if (now >= end) return 'CLOSED';
    return 'ACTIVE';
  }

  function activeRound() {
    for (var i = 0; i < state.rounds.length; i++) {
      if (roundStateNow(state.rounds[i]) === 'ACTIVE') return state.rounds[i];
    }
    return null;
  }

  function selectedRound() {
    for (var i = 0; i < state.rounds.length; i++) {
      if (state.rounds[i].roundId === state.selectedRoundId) return state.rounds[i];
    }
    return null;
  }

  /** นำข้อมูลรอบจากเซิร์ฟเวอร์มาใช้ */
  function applyRoundStatus(rs) {
    state.rounds = (rs && rs.rounds) ? rs.rounds : [];
    state.roundsConfigured = !!(rs && rs.configured);
    renderRounds();
    lastRoundSignature = state.rounds.map(function (r) {
      return r.roundId + ':' + roundStateNow(r);
    }).join('|');
  }

  var ROUND_STATE_TEXT = {
    ACTIVE: 'กำลังเปิดรับ',
    UPCOMING: 'ยังไม่เริ่ม',
    CLOSED: 'ปิดรับแล้ว',
    INACTIVE: 'ปิดการใช้งาน',
    NO_DATE: 'ยังไม่กำหนดวันที่'
  };

  /**
   * วาดการ์ดรอบทั้งหมด และเลือกรอบที่เปิดอยู่ให้อัตโนมัติ
   * สถานะไม่ได้สื่อด้วย "สี" อย่างเดียว — มีทั้งข้อความกำกับและเครื่องหมายนำหน้า
   */
  function renderRounds() {
    var box = $('#round-buttons');
    var hint = $('#round-hint');
    if (!box) return;
    box.innerHTML = '';

    var ev = currentEvent();
    if (!ev) {
      $('#f-round').value = '';
      state.selectedRoundId = '';
      hint.textContent = 'เลือกวันงานก่อน จึงจะแสดงรอบการนับข้อมูล';
      hint.className = 'hint';
      updateCountdown();
      return;
    }

    if (!state.roundsConfigured || state.rounds.length === 0) {
      // วันงานนี้ยังไม่ได้ตั้งค่ารอบ -> ทำงานเหมือนเวอร์ชันก่อนหน้า
      $('#f-round').value = '';
      state.selectedRoundId = '';
      box.appendChild(Utils.el('p', 'choice-empty',
        'วันงานนี้ยังไม่ได้กำหนดรอบการนับข้อมูล สามารถบันทึกได้ตามปกติ'));
      hint.textContent = '';
      hint.className = 'hint';
      updateCountdown();
      return;
    }

    var act = activeRound();

    // เลือกรอบที่เปิดอยู่ให้อัตโนมัติเสมอ และห้ามค้างอยู่ที่รอบที่ปิดไปแล้ว
    var newSelected = act ? act.roundId : '';
    var roundSelectionChanged = (newSelected !== state.selectedRoundId);
    if (roundSelectionChanged) {
      state.selectedRoundId = newSelected;
      $('#f-round').value = newSelected;
    }

    state.rounds.forEach(function (r) {
      var st = roundStateNow(r);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-btn st-' + st.toLowerCase() +
        (r.roundId === state.selectedRoundId ? ' selected' : '');
      btn.setAttribute('data-round', r.roundId);
      btn.setAttribute('aria-pressed', r.roundId === state.selectedRoundId ? 'true' : 'false');

      btn.appendChild(Utils.el('span', 'rb-name', r.roundName || ('รอบที่ ' + r.roundNo)));
      btn.appendChild(Utils.el('span', 'rb-time', r.startTime + '–' + r.endTime + ' น.'));
      btn.appendChild(Utils.el('span', 'rb-close', 'ปิดรับ ' + r.endTime + ' น.'));

      var badge = Utils.el('span', 'rb-badge', ROUND_STATE_TEXT[st] || st);
      badge.setAttribute('data-state', st);
      btn.appendChild(badge);

      if (st === 'ACTIVE') {
        btn.addEventListener('click', function () {
          state.selectedRoundId = r.roundId;
          $('#f-round').value = r.roundId;
          renderRounds();
        });
      } else {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.title = (r.roundName || '') + ': ' + (ROUND_STATE_TEXT[st] || st);
      }
      box.appendChild(btn);
    });

    if (act) {
      hint.textContent = 'ระบบเลือก' + (act.roundName || 'รอบที่เปิดอยู่') + ' ให้อัตโนมัติแล้ว';
      hint.className = 'hint';
    } else {
      // ยังไม่ถึงรอบแรก = ข้อมูลเชิงบอกเวลา ไม่ใช่คำเตือน
      // ทุกรอบปิดแล้ว = คำเตือนจริง จึงใช้คนละน้ำเสียงกัน
      var next = null;
      for (var k = 0; k < state.rounds.length; k++) {
        if (roundStateNow(state.rounds[k]) === 'UPCOMING') { next = state.rounds[k]; break; }
      }
      if (next) {
        hint.textContent = (next.roundName || 'รอบแรก') + ' จะเปิดให้บันทึกเวลา ' +
          next.startTime + ' น.';
        hint.className = 'hint';
      } else {
        hint.textContent = 'ขณะนี้ไม่มีรอบเปิดรับการนับข้อมูล';
        hint.className = 'hint warn';
      }
    }
    updateCountdown();

    // เวอร์ชัน 1.3.1 — เปลี่ยนรอบเมื่อไร ให้โหลดสถานะลานของรอบนั้นใหม่ทันที
    ensureProgressForContext();
    renderProgressSummary();
    if (roundSelectionChanged) renderLotList(lastLotQuery);
  }

  /** นับถอยหลังของรอบที่เปิดอยู่ (แยกจากนาฬิกาปัจจุบันอย่างชัดเจน) */
  function updateCountdown() {
    var box = $('#countdown-box');
    var label = $('#countdown-label');
    var value = $('#countdown-value');
    if (!box) return;

    if (!state.roundsConfigured || state.rounds.length === 0 || !currentEvent()) {
      box.classList.add('hidden');
      return;
    }

    var act = activeRound();
    if (act) {
      var end = parseServerStamp(act.endAt);
      var left = end === null ? 0 : (end - serverNow()) / 1000;
      box.classList.remove('hidden');
      box.className = 'countdown-box is-open';
      label.textContent = 'ปิดรับใน';
      value.textContent = formatDuration(left);
      return;
    }

    // ยังไม่ถึงรอบแรก -> บอกว่าจะเปิดเมื่อไร (ยังไม่ใช่การปิดรับของวัน)
    var upcoming = null;
    for (var i = 0; i < state.rounds.length; i++) {
      if (roundStateNow(state.rounds[i]) === 'UPCOMING') { upcoming = state.rounds[i]; break; }
    }
    box.classList.remove('hidden');
    if (upcoming) {
      var start = parseServerStamp(upcoming.startAt);
      var wait = start === null ? 0 : (start - serverNow()) / 1000;
      box.className = 'countdown-box is-waiting';
      label.textContent = 'เปิด' + (upcoming.roundName || 'รอบถัดไป') + ' ใน';
      value.textContent = formatDuration(wait);
      return;
    }

    // ทุกรอบปิดหมดแล้ว — ห้ามแสดงเวลาปิดระดับระบบ (19:00) ให้ผู้ใช้เห็น
    box.className = 'countdown-box is-closed';
    label.textContent = 'วันนี้ปิดรับการนับข้อมูลแล้ว';
    value.textContent = '';
  }

  /**
   * เดินนาฬิกาทุก 1 วินาที
   *  - อัปเดตนาฬิกาและตัวนับถอยหลัง
   *  - ถ้าสถานะรอบเปลี่ยน (เช่น 11:00:00) ให้วาดใหม่และเลือกรอบใหม่ทันที
   *    โดยไม่ต้องรีเฟรชหน้าเว็บ
   *  - ถ้าตรวจพบว่านาฬิกาเครื่องกระโดด (ผู้ใช้เปลี่ยนเวลา หรือเครื่องหลับ)
   *    ให้เทียบเวลากับเซิร์ฟเวอร์ใหม่ทันที
   */
  function tick() {
    var wall = Date.now();
    var drift = Math.abs(wall - lastTickWall - 1000);
    lastTickWall = wall;

    renderClock();

    var sig = state.rounds.map(function (r) {
      return r.roundId + ':' + roundStateNow(r);
    }).join('|');
    if (sig !== lastRoundSignature) {
      lastRoundSignature = sig;
      renderRounds();
      updateSubmitAvailability();
    } else {
      updateCountdown();
    }

    // นาฬิกาเครื่องกระโดดเกิน 5 วินาที -> ขอเวลาจากเซิร์ฟเวอร์ใหม่
    if (drift > 5000 && Api.isConfigured() && navigator.onLine !== false) {
      refreshRecordingStatus();
    }
  }

  function startClock() {
    if (clockTimer) return;
    lastTickWall = Date.now();
    clockTimer = setInterval(tick, 1000);
  }

  /* ================= โลโก้หน่วยงาน ================= */
  /**
   * ใช้รูปโลโก้จากระบบหลังบ้าน (ตั้งค่าที่ SYSTEM_CONFIG -> SYS_LOGO_FILE_ID)
   * ถ้าโหลดไม่สำเร็จ (ไฟล์ไม่ได้แชร์สาธารณะ / ออฟไลน์) จะคงสัญลักษณ์เดิมไว้
   * จึงไม่มีทางที่หน้าเว็บจะพังเพราะโลโก้
   */
  function applyLogo(url) {
    var img = $('#brand-logo');
    var fallback = $('#brand-fallback');
    if (!img || !fallback) return;
    var src = String(url || '').trim();
    // รับเฉพาะ http(s) เท่านั้น — ปฏิเสธ javascript:, data:, blob: และสคีมอื่นทั้งหมด
    // ด่านหลักอยู่ที่ Backend (buildLogoUrl_) ซึ่งสร้างได้เพียง
    // https://lh3.googleusercontent.com/d/<รหัสไฟล์> เท่านั้น
    if (!/^https?:\/\//.test(src)) return;

    img.addEventListener('load', function () {
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
      $('#brand-mark').classList.add('has-logo');
    });
    img.addEventListener('error', function () {
      img.classList.add('hidden');
      fallback.classList.remove('hidden');
      console.warn('[logo] โหลดรูปโลโก้ไม่สำเร็จ — ใช้สัญลักษณ์เดิมแทน');
    });
    img.src = src;
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
    // เวอร์ชัน 1.3.2 — เมื่อเพิ่งลงชื่อเข้าใช้สำเร็จ
    if (st.signedIn && st.profile) {
      logSignInOnce();
      loadMyOwnership(true);
    } else {
      // ออกจากระบบ -> ล้างข้อมูลความเป็นเจ้าของและโหมดแก้ไขทันที
      if (Object.keys(state.ownedLots).length) {
        clearOwnership();
        clearEditMode();
        renderLotList(lastLotQuery);
      }
      try { window.sessionStorage.removeItem(SIGNIN_LOG_KEY); } catch (e) {}
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

  /* ==================================================================
     เวอร์ชัน 1.3.1 — สถานะ "กรอกข้อมูลเรียบร้อยแล้ว" ของแต่ละลาน
     ==================================================================

     แหล่งข้อมูล: ระบบหลังบ้านเท่านั้น (action getRoundProgress)
     กุญแจ:       วันงาน (EventID) + รอบ (RoundID) + ลานจอด (ParkingID)

     หน้าเว็บเก็บผลไว้ในหน่วยความจำเพื่อวาดหน้าจอเท่านั้น
     ไม่เคยเก็บลง localStorage และไม่ใช้เป็นตัวตัดสินแทนเซิร์ฟเวอร์
     ทุกครั้งที่กดบันทึก เซิร์ฟเวอร์ตรวจซ้ำด้วยข้อมูลจริงในชีตเสมอ
  */

  /** แปลงผลจากเซิร์ฟเวอร์เป็นรูปแบบที่หน้าจอใช้ */
  function applyRoundProgress(rp) {
    if (!rp || !rp.items) {
      state.progress = null;
    } else {
      var byLot = {};
      rp.items.forEach(function (it) { byLot[it.parkingId] = it; });
      state.progress = {
        eventId: rp.eventId || '',
        roundId: rp.roundId || '',
        total: rp.total || 0,
        completed: rp.completed || 0,
        pending: rp.pending || 0,
        byLot: byLot
      };
    }
    renderProgressSummary();
    renderLotList(lastLotQuery);
  }

  /* ==================================================================
     เวอร์ชัน 1.3.2 — "ลานไหนเป็นของฉัน" และการบันทึกการลงชื่อเข้าใช้
     ==================================================================
     ย้ำ: ข้อมูลนี้ใช้ตัดสินใจ "แสดงผล" เท่านั้น
     สิทธิ์จริงตัดสินที่เซิร์ฟเวอร์ทุกครั้งที่กดบันทึก ปลอมจากหน้าเว็บไม่ได้
  */

  /** ลานนี้บัญชีที่ลงชื่อเข้าใช้อยู่เป็นผู้บันทึกหรือไม่ */
  function isLotOwnedByMe(parkingId) {
    return !!(parkingId && state.ownedLots[parkingId]);
  }

  /** ล้างข้อมูลความเป็นเจ้าของ (ใช้ตอนออกจากระบบ หรือเปลี่ยนวัน/รอบ) */
  function clearOwnership() {
    state.ownedLots = {};
    state.ownershipKey = '';
  }

  /** ขอรายการลานที่บัญชีนี้เป็นผู้บันทึก สำหรับวันงาน+รอบปัจจุบัน */
  function loadMyOwnership(force) {
    var eventId = $('#f-event').value;
    var roundId = state.selectedRoundId || '';
    var key = eventId + '|' + roundId;

    if (!Auth.isSignedIn() || !Auth.getToken() || !progressActive() ||
        !Api.isConfigured() || navigator.onLine === false) {
      clearOwnership();
      renderLotList(lastLotQuery);
      return Promise.resolve();
    }
    if (!force && key === state.ownershipKey) return Promise.resolve();
    state.ownershipKey = key;

    return Api.call('getMyRoundOwnership',
      { yearBE: state.currentYear, eventId: eventId, roundId: roundId })
      .then(function (res) {
        // ทิ้งผลเก่าถ้าผู้ใช้เปลี่ยนวันงาน/รอบระหว่างรอคำตอบ
        if (res.eventId !== $('#f-event').value ||
            String(res.roundId || '') !== String(state.selectedRoundId || '')) return;
        var map = {};
        (res.ownedParkingIds || []).forEach(function (pid) { map[pid] = true; });
        state.ownedLots = map;
        renderLotList(lastLotQuery);
      })
      .catch(function (err) {
        // ถ้าขอไม่สำเร็จ ให้ถือว่า "ไม่รู้ว่าเป็นของใคร" คือไม่แสดงปุ่มแก้ไข
        // ปลอดภัยกว่าการเดาว่าเป็นของผู้ใช้คนนี้
        console.warn('[ownership]', err && err.message);
        state.ownedLots = {};
        state.ownershipKey = '';
        renderLotList(lastLotQuery);
      });
  }

  /**
   * บันทึก "การลงชื่อเข้าใช้สำเร็จ" ลงระบบหลังบ้าน หนึ่งครั้งต่อเซสชันเบราว์เซอร์
   * ตัวกันซ้ำที่แท้จริงอยู่ที่เซิร์ฟเวอร์ ส่วนคีย์ใน sessionStorage เป็นเพียง
   * การลดคำขอที่ไม่จำเป็น ไม่ใช่กลไกความปลอดภัย
   */
  function logSignInOnce() {
    if (!Auth.isSignedIn() || !Auth.getToken() || !Api.isConfigured()) return;
    var already = false;
    try { already = window.sessionStorage.getItem(SIGNIN_LOG_KEY) === '1'; } catch (e) {}
    if (already) return;
    try { window.sessionStorage.setItem(SIGNIN_LOG_KEY, '1'); } catch (e) {}

    Api.call('logSignIn', {}).catch(function (err) {
      // บันทึกไม่สำเร็จต้องไม่กระทบการใช้งาน และต้องให้ลองใหม่ได้ครั้งหน้า
      console.warn('[signin-log]', err && err.message);
      try { window.sessionStorage.removeItem(SIGNIN_LOG_KEY); } catch (e) {}
    });
  }

  /** ข้อมูลสถานะของลานหนึ่ง (null = ไม่มีข้อมูล) */
  function lotProgress(parkingId) {
    if (!state.progress || !parkingId) return null;
    return state.progress.byLot[parkingId] || null;
  }

  /** ลานนี้ "กรอกข้อมูลแล้ว" ในวันงาน+รอบปัจจุบันหรือไม่ */
  function isLotCompleted(parkingId) {
    var p = lotProgress(parkingId);
    return !!(p && p.completed);
  }

  /** ระบบกำลังติดตามสถานะการกรอกอยู่หรือไม่ (ต้องมีรอบที่เลือกไว้) */
  function progressActive() {
    return !!(state.roundsConfigured && state.selectedRoundId);
  }

  /** โหลดสถานะของทุกลานสำหรับวันงาน+รอบปัจจุบัน — คำขอเดียวได้ครบทุกลาน */
  function loadRoundProgress() {
    var eventId = $('#f-event').value;
    var roundId = state.selectedRoundId || '';

    if (!progressActive() || !eventId || !Api.isConfigured() || navigator.onLine === false) {
      applyRoundProgress(null);
      return Promise.resolve();
    }

    state.progressLoading = true;
    renderProgressSummary();

    return Api.call('getRoundProgress',
      { yearBE: state.currentYear, eventId: eventId, roundId: roundId })
      .then(function (res) {
        // ถ้าผู้ใช้เปลี่ยนวันงาน/รอบระหว่างรอคำตอบ ให้ทิ้งผลเก่าไป
        if (res.eventId !== $('#f-event').value ||
            String(res.roundId || '') !== String(state.selectedRoundId || '')) {
          return;
        }
        applyRoundProgress(res);
      })
      .catch(function (err) {
        console.warn('[progress]', err && err.message);
        applyRoundProgress(null);
      })
      .then(function () {
        state.progressLoading = false;
        renderProgressSummary();
      });
  }

  /**
   * โหลดสถานะใหม่ก็ต่อเมื่อ "วันงานหรือรอบเปลี่ยนไปจริง ๆ" เท่านั้น
   * ป้องกันไม่ให้ยิงคำขอซ้ำทุกวินาทีตอนนาฬิกาเดิน และไม่ทำให้หน้าจอกระตุก
   */
  function ensureProgressForContext() {
    var key = $('#f-event').value + '|' + (state.selectedRoundId || '');
    if (key === lastProgressKey) return;
    lastProgressKey = key;
    clearEditMode();
    clearOwnership();
    loadRoundProgress();
    loadMyOwnership(true);
  }

  /** อัปเดตสถานะลานทันทีหลังบันทึกสำเร็จ โดยไม่ต้องรอคำขอใหม่ */
  function markLotCompletedLocally(rec) {
    if (!state.progress || !rec || !rec.parkingId) return;
    var pid = rec.parkingId;
    var wasCompleted = isLotCompleted(pid);
    state.progress.byLot[pid] = {
      parkingId: pid,
      parkingNo: rec.parkingNo,
      completed: true,
      vehicleCount: rec.vehicleCount,
      capacity: rec.capacity,
      occupancyPercent: rec.occupancyPercent,
      capacityStatus: rec.capacityStatus,
      lastUpdate: rec.serverTimestamp
    };
    if (!wasCompleted) {
      state.progress.completed += 1;
      state.progress.pending = Math.max(0, state.progress.pending - 1);
    }
    renderProgressSummary();
    renderLotList(lastLotQuery);
  }

  /** ออกจากโหมดแก้ไขข้อมูลที่บันทึกไว้แล้ว */
  function clearEditMode() {
    state.editMode = false;
    state.editLotId = '';
  }

  /** แถบสรุป: กรอกแล้วกี่ลาน / ยังไม่กรอกกี่ลาน ของวันงาน+รอบที่เลือกอยู่ */
  function renderProgressSummary() {
    var box = $('#progress-summary');
    if (!box) return;

    if (!progressActive()) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    var ev = currentEvent();
    var rd = selectedRound();
    $('#ps-context').textContent =
      (ev ? Utils.formatThaiDate(ev.eventDate) : '') +
      (rd ? ' · ' + (rd.roundName || '') : '');

    var doneBox = $('#ps-done');
    var pendBox = $('#ps-pending');

    if (state.progressLoading && !state.progress) {
      doneBox.textContent = 'กำลังตรวจสอบสถานะ...';
      pendBox.classList.add('hidden');
      box.classList.add('is-loading');
      return;
    }
    box.classList.remove('is-loading');
    pendBox.classList.remove('hidden');

    if (!state.progress) {
      doneBox.textContent = 'ยังไม่ทราบสถานะการกรอก';
      pendBox.classList.add('hidden');
      return;
    }

    doneBox.innerHTML = '';
    doneBox.appendChild(Utils.el('span', 'ps-dot'));
    doneBox.appendChild(document.createTextNode(
      'กรอกแล้ว ' + Utils.formatNumber(state.progress.completed) +
      ' / ' + Utils.formatNumber(state.progress.total) + ' ลาน'));

    pendBox.innerHTML = '';
    pendBox.appendChild(Utils.el('span', 'ps-dot'));
    pendBox.appendChild(document.createTextNode(
      'ยังไม่กรอก ' + Utils.formatNumber(state.progress.pending) + ' ลาน'));
  }

  /**
   * ลานที่บันทึกไปแล้ว — อธิบายให้ผู้ใช้เข้าใจ และเปิดทางให้แก้ไขถ้าตัวเลขผิด
   * (การแก้ไขต้องให้เจ้าหน้าที่ยืนยันเองเท่านั้น คำขอที่เกิดจากการกดซ้ำ
   *  หรือเปิดหลายแท็บจะไม่มีการยืนยันนี้ จึงยังถูกเซิร์ฟเวอร์ปฏิเสธตามปกติ)
   */
  function offerEditCompletedLot(lot) {
    var p = lotProgress(lot.parkingId);
    var lines = [
      'ลานนี้บันทึกข้อมูลเรียบร้อยแล้ว',
      '',
      lot.parkingNo + ' — ' + lot.parkingName
    ];
    if (p) {
      lines.push('จำนวนรถที่บันทึกไว้: ' + Utils.formatNumber(p.vehicleCount) + ' คัน');
      if (p.lastUpdate) lines.push('บันทึกเมื่อ ' + Utils.formatThaiTime(p.lastUpdate));
    }
    lines.push('');
    lines.push('คุณเป็นผู้บันทึกข้อมูลรายการนี้ จึงสามารถแก้ไขได้');
    lines.push('');
    lines.push('หากตัวเลขที่บันทึกไว้ไม่ถูกต้อง กด "ตกลง" เพื่อแก้ไขข้อมูลของลานนี้');

    if (!window.confirm(lines.join('\n'))) return;

    state.editMode = true;
    state.editLotId = lot.parkingId;
    selectLot(lot);
    if (p && p.vehicleCount !== null && p.vehicleCount !== undefined) {
      $('#f-count').value = String(p.vehicleCount);
      checkCapacityWarning();
    }
    Utils.toast('กำลังแก้ไขข้อมูลของ ' + lot.parkingName, 'warn');
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
    lastLotQuery = query || '';
    var box = $('#parking-listbox');
    box.innerHTML = '';
    filtered = state.lots.filter(function (l) { return matchLot(l, lastLotQuery); });
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
    var trackStatus = progressActive();

    filtered.forEach(function (lot, idx) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(idx));
      li.setAttribute('id', 'lot-opt-' + idx);
      li.setAttribute('aria-selected', lot.parkingId === selectedId ? 'true' : 'false');
      if (lot.parkingId === selectedId) li.classList.add('selected-item');

      // ---------------------------------------------------------------
      // โครงบรรทัด (เวอร์ชัน 1.3.2)
      //   บรรทัดที่ 1 : [ลำดับลาน] [ชื่อลาน] [ป้ายสถานะ]
      //   บรรทัดที่ 2 : [จำนวนรถ]  ............ [โซน · ความจุ] [แก้ไขได้]
      //
      // ป้ายสถานะอยู่ "บรรทัดเดียวกับชื่อลาน" ไม่ใช่ใต้ลำดับลาน
      // และลำดับลานยังใช้รูปแบบเดิมทุกสถานะ จึงไม่เกิดลำดับซ้อนที่ชวนสับสน
      // ---------------------------------------------------------------
      var done = trackStatus && isLotCompleted(lot.parkingId);
      var mine = done && isLotOwnedByMe(lot.parkingId);
      var pg = done ? lotProgress(lot.parkingId) : null;

      // ----- บรรทัดที่ 1: ชื่อลาน + ป้ายสถานะ อยู่บรรทัดเดียวกัน -----
      // ป้ายสถานะลอยชิดขวาของบรรทัดแรก และชื่อลานไหลล้อมรอบ
      // จึงได้ทั้ง "อยู่บรรทัดเดียวกับชื่อ" และชื่อลานยังอ่านง่ายเต็มความกว้าง
      var head = Utils.el('span', 'lot-head');
      if (trackStatus) {
        if (done) {
          li.classList.add('lot-done');
          if (mine) li.classList.add('lot-mine');
          li.setAttribute('aria-disabled', 'true');
          var sd = Utils.el('span', 'lot-status status-done');
          sd.appendChild(Utils.el('span', 'st-check', '✓'));
          sd.appendChild(Utils.el('span', 'st-text', 'กรอกข้อมูลเรียบร้อยแล้ว'));
          head.appendChild(sd);
        } else {
          li.classList.add('lot-pending');
          var sp = Utils.el('span', 'lot-status status-pending');
          sp.appendChild(Utils.el('span', 'st-dot'));
          sp.appendChild(Utils.el('span', 'st-text', 'ยังไม่กรอก'));
          head.appendChild(sp);
        }
      }
      head.appendChild(Utils.el('span', 'no', lot.parkingNo));
      head.appendChild(Utils.el('span', 'name', lot.parkingName));   // ชื่อเต็ม ไม่ตัดทอน
      li.appendChild(head);

      // ----- บรรทัดที่ 2: จำนวนรถ · โซน · ความจุ -----
      if (done && pg && pg.vehicleCount !== null && pg.vehicleCount !== undefined) {
        li.appendChild(Utils.el('span', 'st-count',
          Utils.formatNumber(pg.vehicleCount) + ' / ' +
          Utils.formatNumber(pg.capacity) + ' คัน'));
      }

      li.appendChild(Utils.el('span', 'zone',
        (lot.zone && lot.zone !== 'ไม่กำกับโซน' ? 'Zone ' + lot.zone : 'ไม่กำกับโซน') +
        ' · ' + Utils.formatNumber(lot.effectiveCapacity) + ' คัน'));

      // ----- ปุ่มแก้ไข: แสดงเฉพาะเมื่อบัญชีนี้เป็นผู้บันทึกรายการนั้น -----
      // ถ้าไม่ใช่เจ้าของ จะไม่แสดงปุ่มที่ทำให้เข้าใจผิดว่าแก้ได้
      if (mine) {
        var ed = Utils.el('span', 'lot-edit');
        ed.appendChild(Utils.el('span', 'ed-icon', '✎'));
        ed.appendChild(Utils.el('span', '', 'แก้ไขได้'));
        li.appendChild(ed);
      }

      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        chooseLot(lot);
      });
      box.appendChild(li);
    });
  }

  /**
   * เลือกลานจากรายการ — ใช้ร่วมกันทั้งการคลิกและการกด Enter
   * ลานที่บันทึกข้อมูลไปแล้วจะไม่ถูกเลือกเพื่อสร้างรายการใหม่
   */
  function chooseLot(lot) {
    if (progressActive() && isLotCompleted(lot.parkingId)) {
      closeList();

      // ยังไม่ได้ลงชื่อเข้าใช้ — ไม่รู้ว่าเป็นของใคร จึงไม่เปิดทางให้แก้ไข
      if (!Auth.isSignedIn() || !Auth.getToken()) {
        window.alert('ลานนี้บันทึกข้อมูลเรียบร้อยแล้ว\n\n' +
          'กรุณาเลือกลานจอดรถอื่นที่ยังไม่ได้บันทึกข้อมูล\n\n' +
          'หากคุณเป็นผู้บันทึกรายการนี้และต้องการแก้ไข ' +
          'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ก่อน');
        return;
      }

      // ลงชื่อเข้าใช้แล้วแต่ไม่ใช่ผู้บันทึกรายการนี้
      // ไม่เปิดเผยว่าใครเป็นเจ้าของ
      if (!isLotOwnedByMe(lot.parkingId)) {
        window.alert('ลานนี้บันทึกข้อมูลเรียบร้อยแล้ว\n\n' +
          'ข้อมูลลานจอดรถนี้ถูกบันทึกโดยบัญชี Google อื่น ' +
          'คุณไม่มีสิทธิ์แก้ไขข้อมูลรายการนี้\n\n' +
          'กรุณาเลือกลานจอดรถอื่นที่ยังไม่ได้บันทึกข้อมูล');
        return;
      }

      offerEditCompletedLot(lot);
      return;
    }
    selectLot(lot);
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
    // เปลี่ยนไปลานอื่น = ออกจากโหมดแก้ไขทันที
    if (state.editLotId && state.editLotId !== lot.parkingId) clearEditMode();
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
    clearEditMode();
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

    // ---------- ลำดับที่ 4: ต้องมีรอบการนับที่เปิดรับอยู่ ----------
    // (เซิร์ฟเวอร์ตรวจซ้ำด้วยนาฬิกาของตัวเองอยู่แล้ว — ตรงนี้เพื่อให้ผู้ใช้รู้เหตุผลทันที)
    if (state.roundsConfigured) {
      var act = activeRound();
      if (!act) {
        showFormError('ขณะนี้ไม่มีรอบเปิดรับการนับข้อมูล');
        return null;
      }
      if (state.selectedRoundId !== act.roundId) {
        // รอบเปลี่ยนไประหว่างที่ผู้ใช้กรอกข้อมูล -> ปรับให้ตรงกับความจริงก่อน
        state.selectedRoundId = act.roundId;
        $('#f-round').value = act.roundId;
        renderRounds();
        showFormError('รอบการนับข้อมูลเปลี่ยนเป็น' + (act.roundName || 'รอบใหม่') +
          ' แล้ว กรุณาตรวจสอบข้อมูลแล้วกดบันทึกอีกครั้ง');
        return null;
      }
    }

    if (!state.selectedLot || !$('#f-parking-id').value) {
      showFormError('กรุณาเลือกลานจอดรถ', '#f-parking-search'); return null;
    }

    // ---------- ลำดับที่ 5: ลานนี้บันทึกไปแล้วหรือยัง ----------
    // ชั้นนี้เป็นการช่วยผู้ใช้เท่านั้น เซิร์ฟเวอร์ตรวจซ้ำด้วยข้อมูลจริงในชีตเสมอ
    var pid = $('#f-parking-id').value;
    if (progressActive() && isLotCompleted(pid)) {
      if (!isLotOwnedByMe(pid)) {
        // ไม่ใช่เจ้าของ — เซิร์ฟเวอร์ปฏิเสธอยู่แล้ว แต่บอกผู้ใช้ตั้งแต่ตรงนี้
        showFormError('ข้อมูลลานจอดรถนี้ถูกบันทึกโดยบัญชี Google อื่น ' +
          'คุณไม่มีสิทธิ์แก้ไขข้อมูลรายการนี้ ' +
          'กรุณาเลือกลานจอดรถอื่นที่ยังไม่ได้บันทึกข้อมูล', '#f-parking-search');
        return null;
      }
      if (!(state.editMode && state.editLotId === pid)) {
        showFormError('ลานนี้บันทึกข้อมูลเรียบร้อยแล้ว ' +
          'กรุณาเลือกลานจอดรถอื่นที่ยังไม่ได้บันทึกข้อมูล', '#f-parking-search');
        return null;
      }
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

    // เบอร์โทรศัพท์: ไม่บังคับกรอก แต่ถ้ากรอกต้องเป็นตัวเลข 10 หลักพอดี
    // ใช้กติกาเดียวกับฝั่งเซิร์ฟเวอร์ (Utils.normalizePhone -> ^\d{10}$)
    // ไม่แจ้งเตือนระหว่างพิมพ์ จะแจ้งก็ต่อเมื่อกดบันทึกเท่านั้น
    var phoneRaw = $('#f-phone').value.trim();
    var phone = '';
    if (phoneRaw) {
      phone = Utils.normalizePhone(phoneRaw);
      if (phone === null) {
        showFormError(PHONE_MESSAGE, '#f-phone');
        return null;
      }
    }

    return {
      yearBE: Number($('#f-year').value) || state.currentYear,
      eventId: ev.eventId,
      roundId: state.selectedRoundId || '',
      parkingId: $('#f-parking-id').value,
      vehicleCount: count,
      recorderName: name,
      phone: phone,
      note: $('#f-note').value.trim(),
      clientTimestamp: Utils.clientTimestamp(),
      source: 'WEB',
      requestId: state.requestId,
      // true ได้ก็ต่อเมื่อเจ้าหน้าที่กดยืนยันขอแก้ไขข้อมูลลานนี้ด้วยตนเองเท่านั้น
      confirmEdit: !!(state.editMode && state.editLotId === $('#f-parking-id').value)
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
    var isEditing = !!(state.editMode && state.editLotId === payload.parkingId);
    var lines = [
      isEditing ? 'ยืนยันการแก้ไขข้อมูลที่บันทึกไว้แล้ว' : 'ยืนยันการบันทึกข้อมูล',
      '',
      'ลานจอด:  ' + lot.parkingNo + ' — ' + lot.parkingName,
      'โซน:      ' + (lot.zone || 'ไม่กำกับโซน'),
      'วันงาน:   ' + ev.eventName + ' (' + Utils.formatThaiDate(ev.eventDate) + ')'
    ];
    var rd = selectedRound();
    if (rd) lines.push('รอบ:      ' + (rd.roundName || '') + ' (' + rd.startTime + '–' + rd.endTime + ' น.)');
    lines.push('จำนวนรถ: ' + Utils.formatNumber(payload.vehicleCount) + ' คัน');
    if (overCapacity) {
      lines.push('');
      lines.push('⚠ จำนวนรถมากกว่าความจุที่กำหนดไว้ (' +
        Utils.formatNumber(lot.effectiveCapacity) + ' คัน)');
      lines.push('กรุณาตรวจสอบให้แน่ใจก่อนกดตกลง');
    }
    if (isEditing) {
      var prev = lotProgress(payload.parkingId);
      lines.push('');
      lines.push('ข้อมูลเดิมที่บันทึกไว้: ' +
        (prev ? Utils.formatNumber(prev.vehicleCount) + ' คัน' : '-'));
      lines.push('ระบบจะเก็บทั้งข้อมูลเดิมและข้อมูลใหม่ไว้ และถือค่าใหม่เป็นค่าล่าสุด');
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
        // อัปเดตสถานะลานทันที ไม่ต้องให้ผู้ใช้รีเฟรชหน้าเว็บ
        markLotCompletedLocally(res.record || {});
        // บัญชีที่บันทึกคือบัญชีนี้ จึงเป็นเจ้าของรายการนั้นทันที
        if (res.record && res.record.parkingId) {
          state.ownedLots[res.record.parkingId] = true;
          renderLotList(lastLotQuery);
        }
        clearEditMode();
        showSuccess(res, payload);
        if (res.duplicated) {
          Utils.toast('รายการนี้เคยบันทึกไว้แล้ว ระบบไม่บันทึกซ้ำ', 'warn');
        } else {
          var rn = (res.record && res.record.roundName) || '';
          if (res.isEdit) {
            Utils.toast(rn ? ('แก้ไขข้อมูล' + rn + ' เรียบร้อยแล้ว') : 'แก้ไขข้อมูลเรียบร้อยแล้ว',
              'success');
          } else {
            Utils.toast(rn ? ('บันทึกข้อมูล' + rn + ' สำเร็จ') : 'บันทึกข้อมูลสำเร็จ', 'success');
          }
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
        if (err.errorCode === 'WINDOW_CLOSED' || err.errorCode === 'YEAR_INACTIVE' ||
            err.errorCode === 'ROUND_CLOSED' || err.errorCode === 'ROUND_NOT_ACTIVE') {
          refreshRecordingStatus();
        }
        // เซิร์ฟเวอร์บอกว่าลานนี้ถูกบันทึกไปแล้ว (เช่น เจ้าหน้าที่อีกคนบันทึกตัดหน้า)
        // ให้ดึงสถานะจริงมาแสดงทันที เพื่อให้หน้าจอตรงกับข้อมูลในระบบ
        if (err.errorCode === 'ALREADY_RECORDED') {
          clearEditMode();
          loadRoundProgress();
        }
        // เซิร์ฟเวอร์ปฏิเสธเพราะไม่ใช่เจ้าของรายการ (หรือตรวจสิทธิ์ไม่ได้)
        // ให้ออกจากโหมดแก้ไข และซิงก์ทั้งสถานะและสิทธิ์จากของจริงใหม่
        if (err.errorCode === 'EDIT_NOT_OWNER' || err.errorCode === 'EDIT_OWNER_UNKNOWN') {
          clearEditMode();
          loadRoundProgress();
          loadMyOwnership(true);
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

    var roundName = rec.roundName || '';
    var roundNo = Number(rec.roundNo || 0);

    // หัวข้อและข้อความเตือนให้บันทึกรอบถัดไป (ตามข้อกำหนดเวอร์ชัน 1.3.0)
    if (res.isEdit) {
      $('#success-title').textContent = roundName
        ? ('แก้ไขข้อมูล' + roundName + ' เรียบร้อยแล้ว') : 'แก้ไขข้อมูลเรียบร้อยแล้ว';
    } else {
      $('#success-title').textContent = roundName
        ? ('บันทึกข้อมูล' + roundName + ' สำเร็จ') : 'บันทึกข้อมูลสำเร็จ';
    }

    var followup = $('#success-followup');
    var nextRound = null;
    if (roundNo) {
      for (var i = 0; i < state.rounds.length; i++) {
        if (Number(state.rounds[i].roundNo) === roundNo + 1) { nextRound = state.rounds[i]; break; }
      }
    }
    if (nextRound) {
      followup.textContent = 'อย่าลืมบันทึกการนับ' + (nextRound.roundName || 'รอบถัดไป') +
        ' เวลา ' + nextRound.startTime + '–' + nextRound.endTime + ' น.';
      followup.classList.remove('hidden');
    } else {
      followup.textContent = '';
      followup.classList.add('hidden');
    }

    addRow('ลานจอด', 'P' + (rec.parkingNo || '') + ' ' + (rec.parkingName || ''));
    if (roundName) addRow('รอบการนับ', roundName);
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
    return Api.call('getRecordingStatus',
      { yearBE: state.currentYear, eventId: $('#f-event').value,
        roundId: state.selectedRoundId || '' })
      .then(function (res) {
        state.years = res.years || state.years;
        // เทียบนาฬิกากับเซิร์ฟเวอร์ทุกครั้งที่รีเฟรช (ทุก ~60 วินาที)
        syncServerClock(res.serverTime || state.serverTime);

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

        // รอบของวันงานที่กำลังใช้อยู่ (เซิร์ฟเวอร์ส่งมาพร้อมกันแล้ว)
        if (res.roundStatus && res.roundStatus.eventId &&
            res.roundStatus.eventId === $('#f-event').value) {
          applyRoundStatus(res.roundStatus);
        }

        // สถานะลานล่าสุดจากระบบหลังบ้าน — ทำให้เห็นสิ่งที่เจ้าหน้าที่คนอื่นบันทึกไว้ด้วย
        if (res.roundProgress && res.roundProgress.eventId === $('#f-event').value &&
            String(res.roundProgress.roundId || '') === String(state.selectedRoundId || '')) {
          lastProgressKey = res.roundProgress.eventId + '|' + (res.roundProgress.roundId || '');
          applyRoundProgress(res.roundProgress);
        }
        updateSubmitAvailability();
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
          if (filtered[idx]) chooseLot(filtered[idx]);
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

    // เวอร์ชัน 1.3.1 — เบอร์โทรศัพท์: รับเฉพาะตัวเลข ยาวไม่เกิน 10 หลัก
    // ครอบคลุมทั้งการพิมพ์และการวาง (paste) เพราะเหตุการณ์ input เกิดทั้งสองกรณี
    // ไม่แสดงข้อความเตือนระหว่างพิมพ์ เพียงกรองอักขระที่ใช้ไม่ได้ออกเงียบ ๆ
    $('#f-phone').addEventListener('input', function () {
      var v = Utils.digitsOnly10(this.value);
      if (v !== this.value) this.value = v;
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
    renderRounds();
    renderClock();
    renderAuthState(Auth.getState());

    if (!Api.isConfigured()) {
      $('#setup-warning').classList.remove('hidden');
      setConnStatus('error', 'ยังไม่ได้ตั้งค่าระบบ');
      // ไม่ปิดปุ่มบันทึก — ถ้าผู้ใช้กด ระบบจะเด้ง popup อธิบายว่ายังไม่ได้ตั้งค่า
      $('#year-hint').textContent = 'ยังไม่ได้ตั้งค่าที่อยู่ของระบบหลังบ้าน';
      $('#round-hint').textContent = '';
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
    updateSubmitAvailability: updateSubmitAvailability,
    // เวอร์ชัน 1.3.0 — เปิดให้ทดสอบ/ตรวจสอบสถานะรอบจากภายนอกได้
    activeRound: activeRound,
    serverNow: serverNow,
    reloadRounds: reloadRounds,
    // เวอร์ชัน 1.3.2 — สำหรับตรวจสอบสถานะ (ไม่ใช่การให้สิทธิ์)
    isLotOwnedByMe: isLotOwnedByMe,
    loadMyOwnership: loadMyOwnership
  };
})();
