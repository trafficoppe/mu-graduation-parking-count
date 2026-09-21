/**
 * api.js
 * ชั้นเชื่อมต่อ Google Apps Script Web App จาก GitHub Pages
 *
 * ทำไมต้องออกแบบพิเศษ:
 *  Google Apps Script Web App ไม่ตอบ preflight (OPTIONS) และกำหนด CORS header เองไม่ได้
 *  ดังนั้นคำขอที่ทำให้เกิด preflight (เช่น Content-Type: application/json,
 *  custom header, PUT/PATCH/DELETE) จะล้มเหลวเสมอในทุกเบราว์เซอร์
 *
 * วิธีที่ใช้จริงในระบบนี้ (ทดสอบแล้วกับ Chrome Desktop/Android, Safari iOS, Edge):
 *  - อ่านข้อมูล  : fetch GET (simple request) -> ถ้าล้มเหลวใช้ JSONP
 *  - เขียนข้อมูล : fetch POST ที่ Content-Type = "text/plain;charset=utf-8"
 *                 (นับเป็น simple request จึงไม่เกิด preflight)
 *                 -> ถ้าล้มเหลวใช้ JSONP GET ที่ส่ง payload มาใน query string
 *  - ทุกคำขอเขียนมี requestId (Idempotency Key) จึงส่งซ้ำได้โดยข้อมูลไม่ซ้ำ
 *
 * ============================================================================
 * กฎเพิ่มเติมของเวอร์ชัน 1.2.0 (การยืนยันตัวตนด้วย Google)
 * ============================================================================
 * คำขอแบ่งเป็นสองกลุ่มที่ใช้ "ช่องทางคนละแบบ" อย่างเคร่งครัด
 *
 *   1) คำขออ่านข้อมูลสาธารณะ (ไม่ต้องลงชื่อเข้าใช้)
 *      GET ธรรมดา -> ถ้าล้มเหลวจึงใช้ JSONP เป็นช่องทางสำรอง  (เหมือนเดิม)
 *
 *   2) คำขอที่ต้องยืนยันตัวตน (บันทึกข้อมูล และทุกคำสั่งของผู้ดูแลระบบ)
 *      POST (Content-Type: text/plain) เท่านั้น **ห้ามใช้ JSONP เด็ดขาด**
 *      เพราะ JSONP ส่งข้อมูลผ่าน query string ซึ่งจะทำให้ ID Token ไปปรากฏใน
 *      URL, log ของพร็อกซี, ประวัติเบราว์เซอร์ และ header Referer
 *      หาก POST ล้มเหลว ระบบจะแจ้งข้อผิดพลาดตรง ๆ ไม่มีการถอยไปใช้ JSONP
 */
var Api = (function () {
  'use strict';

  var WRITE_ACTIONS = {
    submitRecord: true, addParking: true, updateParking: true,
    deactivateParking: true, activateParking: true, setParkingDayConfig: true,
    addEventDay: true, updateEventDay: true, createYear: true,
    setActiveYear: true, rebuildSummary: true,
    setRecordingWindow: true, setYearStatus: true
  };

  /**
   * คำขอที่ต้องแนบ Google ID Token
   * ต้องตรงกับ ACTION_AUTH ฝั่ง Backend (ระดับ USER และ ADMIN)
   * หมายเหตุ: ฝั่งเซิร์ฟเวอร์เป็นผู้ตัดสินสิทธิ์จริงเสมอ รายการนี้มีไว้เพื่อ
   * เลือกช่องทางส่งข้อมูลให้ถูกต้องเท่านั้น
   */
  var AUTH_ACTIONS = {
    submitRecord: true, getMyIdentity: true,
    getHistory: true, getAuditLog: true, getAdminParkingLots: true,
    addParking: true, updateParking: true, deactivateParking: true,
    activateParking: true, setParkingDayConfig: true, addEventDay: true,
    updateEventDay: true, createYear: true, setActiveYear: true,
    rebuildSummary: true, getRecordingWindow: true, setRecordingWindow: true,
    setYearStatus: true
  };

  var lastTransport = '';

  function isConfigured() {
    return !!APP_CONFIG.API_URL &&
      APP_CONFIG.API_URL.indexOf('REPLACE_WITH') !== 0 &&
      /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(APP_CONFIG.API_URL);
  }

  function requireConfigured() {
    if (!isConfigured()) {
      var e = new Error('ยังไม่ได้ตั้งค่าที่อยู่ของระบบ (API URL) กรุณาติดต่อผู้ดูแลระบบ');
      e.errorCode = 'NOT_CONFIGURED';
      throw e;
    }
  }

  function buildQuery(params) {
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return parts.join('&');
  }

  function apiError(message, code, errors) {
    var e = new Error(message || 'เกิดข้อผิดพลาด');
    e.errorCode = code || 'NETWORK_ERROR';
    if (errors) e.errors = errors;
    return e;
  }

  /* ---------------- JSONP ---------------- */
  var jsonpSeq = 0;
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      var cbName = 'gpvcsCb' + (++jsonpSeq) + '_' + Date.now().toString(36);
      var script = document.createElement('script');
      var timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (data) {
        cleanup();
        resolve(data);
      };

      var q = buildQuery(Object.assign({}, params, { callback: cbName }));
      var url = APP_CONFIG.API_URL + (APP_CONFIG.API_URL.indexOf('?') >= 0 ? '&' : '?') + q;

      if (url.length > 7500) {
        cleanup();
        reject(apiError('ข้อมูลที่ส่งมีขนาดใหญ่เกินไป กรุณาลดความยาวของหมายเหตุ', 'PAYLOAD_TOO_LARGE'));
        return;
      }

      script.src = url;
      script.async = true;
      script.onerror = function () {
        cleanup();
        reject(apiError('ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต', 'NETWORK_ERROR'));
      };

      timer = setTimeout(function () {
        cleanup();
        reject(apiError('ระบบใช้เวลานานเกินกำหนด กรุณาลองใหม่อีกครั้ง', 'TIMEOUT'));
      }, APP_CONFIG.JSONP_TIMEOUT_MS);

      document.head.appendChild(script);
    });
  }

  /* ---------------- fetch helpers ---------------- */
  function fetchWithTimeout(url, options) {
    var controller = null;
    var timer = null;
    options = options || {};
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      options.signal = controller.signal;
    }
    var p = fetch(url, options);
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) {} }
        reject(apiError('ระบบใช้เวลานานเกินกำหนด กรุณาลองใหม่อีกครั้ง', 'TIMEOUT'));
      }, APP_CONFIG.REQUEST_TIMEOUT_MS);
    });
    return Promise.race([p, timeout]).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function fetchGet(params) {
    var url = APP_CONFIG.API_URL + (APP_CONFIG.API_URL.indexOf('?') >= 0 ? '&' : '?') +
      buildQuery(params);
    return fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store'
    }).then(readJson);
  }

  function fetchPost(params) {
    // Content-Type แบบ text/plain = simple request -> ไม่เกิด preflight
    return fetchWithTimeout(APP_CONFIG.API_URL, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(params)
    }).then(readJson);
  }

  function readJson(res) {
    if (!res || !res.ok) {
      throw apiError('ระบบปลายทางตอบกลับผิดปกติ (HTTP ' + (res ? res.status : '0') + ')', 'HTTP_ERROR');
    }
    return res.text().then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // มักเกิดเมื่อ Web App ถูกตั้งค่าสิทธิ์ผิด แล้วคืนหน้า HTML ให้ล็อกอิน
        throw apiError(
          'ไม่สามารถเชื่อมต่อระบบได้ อาจเกิดจากการตั้งค่าสิทธิ์ของระบบหลังบ้าน กรุณาแจ้งผู้ดูแลระบบ',
          'INVALID_RESPONSE');
      }
      return data;
    });
  }

  /* ---------------- core call ---------------- */
  /**
   * เรียก API
   * @param action ชื่อคำสั่ง
   * @param params พารามิเตอร์
   * @returns Promise<object> (คืนเฉพาะกรณี success = true)
   */
  function call(action, params) {
    requireConfigured();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.reject(apiError('ขณะนี้อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต', 'OFFLINE'));
    }

    var payload = Object.assign({}, params || {});
    payload.action = action;
    if (!payload.deviceId) payload.deviceId = Utils.getDeviceId();

    var needsAuth = !!AUTH_ACTIONS[action];
    if (needsAuth) {
      // แนบ token จากหน่วยความจำ (ไม่เคยอ่านจาก localStorage หรือ URL)
      var token = (typeof Auth !== 'undefined') ? Auth.getToken() : null;
      if (!token) {
        return Promise.reject(apiError(
          'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ก่อนดำเนินการ', 'AUTH_REQUIRED'));
      }
      payload.idToken = token;
    }

    var isWrite = !!WRITE_ACTIONS[action];
    var primary = (isWrite || needsAuth)
      ? function () { lastTransport = 'POST'; return fetchPost(payload); }
      : function () { lastTransport = 'GET'; return fetchGet(payload); };

    var fallback = function () {
      lastTransport = 'JSONP';
      if (isWrite) {
        // ส่ง payload ทั้งก้อนใน query เดียว เพื่อให้ Backend ได้ข้อมูลครบเหมือน POST
        return jsonp({ action: action, payload: JSON.stringify(payload) });
      }
      return jsonp(payload);
    };

    var started = Date.now();
    return primary()
      .catch(function (err) {
        console.warn('[API] primary transport failed for "' + action + '":', err && err.message);
        // ไม่ retry กรณีที่ทราบชัดว่าไม่ใช่ปัญหาการเชื่อมต่อ
        if (err && (err.errorCode === 'PAYLOAD_TOO_LARGE')) throw err;
        // *** คำขอที่มี token ห้ามถอยไปใช้ JSONP เด็ดขาด ***
        // เพราะ token จะไปโผล่ใน URL ยอมให้คำขอล้มเหลวไปเลยดีกว่า
        if (needsAuth) {
          throw apiError(
            'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่',
            'NETWORK_ERROR');
        }
        return fallback();
      })
      .then(function (data) {
        var ms = Date.now() - started;
        if (!data || typeof data !== 'object') {
          throw apiError('ระบบตอบกลับข้อมูลไม่ถูกต้อง', 'INVALID_RESPONSE');
        }
        if (data.success === false) {
          console.warn('[API] ' + action + ' -> ' + data.errorCode + ' (' + ms + 'ms)');
          // ถ้าเซิร์ฟเวอร์บอกว่าการลงชื่อเข้าใช้ใช้ไม่ได้แล้ว ให้ล้างสถานะและขอใหม่
          if (typeof Auth !== 'undefined' && data.errorCode) {
            Auth.handleAuthFailure(data.errorCode);
          }
          throw apiError(data.message, data.errorCode, data.errors);
        }
        console.log('[API] ' + action + ' ok via ' + lastTransport + ' (' + ms + 'ms)');
        return data;
      });
  }

  /** ตรวจสุขภาพระบบ */
  function health() {
    return call('health', {});
  }

  /** แปลง error เป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจ */
  function friendlyMessage(err) {
    if (!err) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    var code = err.errorCode || '';
    switch (code) {
      case 'OFFLINE':
        return 'ไม่พบการเชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบสัญญาณแล้วลองใหม่';
      case 'TIMEOUT':
        return 'ระบบใช้เวลาตอบกลับนานเกินไป กรุณาลองใหม่อีกครั้ง';
      case 'NETWORK_ERROR':
      case 'HTTP_ERROR':
        return 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่';
      case 'INVALID_RESPONSE':
      case 'NOT_CONFIGURED':
        return err.message;
      case 'RATE_LIMIT':
        return 'มีการส่งข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
      case 'LOCK_TIMEOUT':
        return 'ขณะนี้มีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้ง';
      case 'AUTH_REQUIRED':
        return err.message || 'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ก่อนดำเนินการ';
      case 'AUTH_EXPIRED':
        return 'การลงชื่อเข้าใช้หมดอายุแล้ว กรุณาลงชื่อเข้าใช้อีกครั้งแล้วลองใหม่';
      case 'AUTH_INVALID':
        return err.message || 'การลงชื่อเข้าใช้ไม่ถูกต้อง กรุณาลงชื่อเข้าใช้ใหม่อีกครั้ง';
      case 'FORBIDDEN':
        return err.message || 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการนี้';
      case 'TOKEN_IN_URL':
        return 'ไม่สามารถส่งข้อมูลการลงชื่อเข้าใช้ด้วยวิธีนี้ได้ กรุณารีเฟรชหน้าเว็บแล้วลองใหม่';
      case 'UNAUTHORIZED':
        return err.message || 'ไม่มีสิทธิ์ดำเนินการนี้';
      case 'VALIDATION_ERROR':
        return err.message || 'กรุณาตรวจสอบข้อมูลอีกครั้ง';
      case 'NOT_SETUP':
      case 'NOT_FOUND':
      case 'CONFLICT':
      case 'DUPLICATE_REQUEST':
        return err.message;
      default:
        return err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
    }
  }

  return {
    call: call,
    health: health,
    isConfigured: isConfigured,
    friendlyMessage: friendlyMessage,
    lastTransport: function () { return lastTransport; }
  };
})();
