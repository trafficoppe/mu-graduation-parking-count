/**
 * auth.js  (ใหม่ในเวอร์ชัน 1.2.0)
 * การลงชื่อเข้าใช้ด้วยบัญชี Google บนหน้าเว็บ (Google Identity Services)
 *
 * ============================================================================
 * หลักการด้านความปลอดภัยที่ไฟล์นี้ยึดถือ
 * ============================================================================
 * 1. ID Token เก็บไว้ใน "หน่วยความจำของหน้าเว็บ" เท่านั้น
 *    ไม่เก็บใน localStorage / sessionStorage / cookie / URL
 *    ปิดแท็บหรือรีเฟรชแล้ว token จะหายไป และจะลงชื่อเข้าใช้ใหม่อัตโนมัติ
 *    ผ่านกลไก auto_select ของ Google (ถ้าผู้ใช้เคยอนุญาตไว้)
 *
 * 2. ข้อมูลชื่อ/อีเมลที่แสดงบนหน้าจอ มาจากการถอด payload ของ token
 *    เพื่อ "แสดงผล" เท่านั้น ระบบไม่เคยใช้ค่านี้ตัดสินสิทธิ์ใด ๆ
 *    ฝั่งเซิร์ฟเวอร์ตรวจลายเซ็นของ token เองทุกครั้ง และใช้ค่าจากที่นั่นเป็นหลัก
 *
 * 3. ไม่มีการ log ค่า token และไม่แสดง token บนหน้าจอ
 *
 * 4. Client ID มาจากระบบหลังบ้าน (action getAuthConfig) จึงตั้งค่าที่เดียว
 *    ผู้ดูแลไม่ต้องแก้ไฟล์บน GitHub เมื่อเปลี่ยน Client ID
 */
var Auth = (function () {
  'use strict';

  var GIS_SRC = 'https://accounts.google.com/gsi/client';

  var state = {
    ready: false,          // โหลดไลบรารีและตั้งค่าเรียบร้อยแล้ว
    clientId: '',
    configured: false,
    signedIn: false,
    profile: null,         // { name, email, picture }  (ใช้แสดงผลเท่านั้น)
    error: ''
  };

  var idToken = null;      // *** เก็บในหน่วยความจำเท่านั้น ***
  var tokenExp = 0;        // เวลาหมดอายุ (epoch วินาที) จาก payload
  var listeners = [];
  var buttonHosts = [];
  /**
   * รายการ token ที่เซิร์ฟเวอร์เพิ่งปฏิเสธ (เก็บไม่เกิน 5 รายการ)
   * ป้องกันกรณี Google ส่ง credential เดิมกลับมาอีกหลังถูกปฏิเสธ
   * ซึ่งจะทำให้หน้าจอสลับไปมาระหว่าง "เข้าสู่ระบบแล้ว" กับ "หมดอายุ" ไม่รู้จบ
   * (เกิดได้เมื่อนาฬิกาของเครื่องผู้ใช้คลาดเคลื่อนจากเวลาจริง)
   */
  var rejectedTokens = [];

  function markRejected(token) {
    if (!token) return;
    rejectedTokens.push(token);
    if (rejectedTokens.length > 5) rejectedTokens.shift();
  }
  function wasRejected(token) {
    return rejectedTokens.indexOf(token) >= 0;
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(getState()); } catch (e) { console.warn('[auth] listener error', e); }
    });
  }

  function getState() {
    return {
      ready: state.ready,
      configured: state.configured,
      signedIn: state.signedIn,
      profile: state.profile ? {
        name: state.profile.name, email: state.profile.email, picture: state.profile.picture
      } : null,
      error: state.error
    };
  }

  /** ถอด payload ของ JWT เพื่อ "แสดงผล" เท่านั้น — ไม่ใช่การตรวจสอบความถูกต้อง */
  function decodePayloadForDisplay(token) {
    try {
      var part = token.split('.')[1];
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = decodeURIComponent(atob(b64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  /** โหลดไลบรารีของ Google (ข้ามถ้ามีอยู่แล้ว) */
  function loadGisLibrary() {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve();
        return;
      }
      var existing = document.querySelector('script[data-gis="1"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('gis-load-failed')); });
        return;
      }
      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute('data-gis', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('gis-load-failed')); };
      document.head.appendChild(s);
    });
  }

  /** Google เรียกกลับมาพร้อม credential (ID Token) */
  function handleCredential(response) {
    if (!response || !response.credential) return;
    var token = response.credential;

    // เคยถูกเซิร์ฟเวอร์ปฏิเสธมาแล้ว — ไม่รับซ้ำ
    if (wasRejected(token)) {
      state.signedIn = false;
      state.profile = null;
      state.error = 'การลงชื่อเข้าใช้นี้ใช้ไม่ได้แล้ว กรุณากดปุ่มลงชื่อเข้าใช้ด้วย Google อีกครั้ง ' +
        '(หากยังไม่สำเร็จ กรุณาตรวจสอบว่าวันที่และเวลาของเครื่องถูกต้อง)';
      console.warn('[auth] credential previously rejected by server');
      notify();
      return;
    }

    var payload = decodePayloadForDisplay(token);

    // ไม่รับ credential ที่หมดอายุแล้วหรืออ่านไม่ออก
    // (ถ้ารับไว้ หน้าเว็บจะแสดงว่า "เข้าสู่ระบบแล้ว" ทั้งที่ใช้งานจริงไม่ได้)
    var exp = (payload && payload.exp) ? Number(payload.exp) : 0;
    if (!payload || !exp || exp - (Date.now() / 1000) <= 60) {
      idToken = null;
      tokenExp = 0;
      state.signedIn = false;
      state.profile = null;
      state.error = 'การลงชื่อเข้าใช้หมดอายุแล้ว กรุณาลงชื่อเข้าใช้อีกครั้ง';
      console.warn('[auth] credential expired or unreadable');
      notify();
      return;
    }

    idToken = token;
    tokenExp = exp;
    state.signedIn = true;
    state.error = '';
    state.profile = payload ? {
      name: payload.name || payload.given_name || '',
      email: payload.email || '',
      picture: payload.picture || ''
    } : null;
    // ไม่ log token — log เฉพาะข้อเท็จจริงว่าลงชื่อเข้าใช้สำเร็จ
    console.log('[auth] signed in');
    notify();
  }

  /**
   * เริ่มระบบลงชื่อเข้าใช้
   * @param clientId Google OAuth Client ID (มาจากระบบหลังบ้าน)
   */
  function init(clientId) {
    state.clientId = String(clientId || '').trim();
    state.configured = !!state.clientId;
    if (!state.configured) {
      state.error = 'ระบบยังไม่ได้ตั้งค่าการลงชื่อเข้าใช้ด้วย Google';
      state.ready = true;
      notify();
      return Promise.resolve(getState());
    }

    return loadGisLibrary().then(function () {
      window.google.accounts.id.initialize({
        client_id: state.clientId,
        callback: handleCredential,
        auto_select: true,              // ลงชื่อเข้าใช้ต่อเนื่องหลังรีเฟรชหน้า
        cancel_on_tap_outside: false,
        use_fedcm_for_prompt: true,
        itp_support: true
      });
      state.ready = true;
      state.error = '';
      notify();
      renderAllButtons();
      try { window.google.accounts.id.prompt(); } catch (e) { /* ผู้ใช้กดปุ่มเองได้ */ }
      return getState();
    }).catch(function (err) {
      state.ready = true;
      state.error = 'ไม่สามารถโหลดระบบลงชื่อเข้าใช้ของ Google ได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต';
      console.warn('[auth] init failed:', err && err.message);
      notify();
      return getState();
    });
  }

  /** วาดปุ่ม "ลงชื่อเข้าใช้ด้วย Google" ลงใน element ที่กำหนด */
  function renderButton(el) {
    if (!el) return;
    if (buttonHosts.indexOf(el) < 0) buttonHosts.push(el);
    drawButton(el);
  }

  function drawButton(el) {
    if (!state.ready || !state.configured) return;
    if (!(window.google && window.google.accounts && window.google.accounts.id)) return;
    el.innerHTML = '';
    try {
      window.google.accounts.id.renderButton(el, {
        type: 'standard', theme: 'filled_blue', size: 'large',
        text: 'signin_with', shape: 'rectangular', logo_alignment: 'left',
        locale: 'th', width: Math.min(Math.max(el.offsetWidth || 280, 220), 400)
      });
    } catch (e) {
      console.warn('[auth] renderButton failed', e);
    }
  }

  function renderAllButtons() {
    buttonHosts.forEach(drawButton);
  }

  /** ขอให้ผู้ใช้ลงชื่อเข้าใช้อีกครั้ง (เช่น เมื่อ token หมดอายุ) */
  function promptSignIn() {
    if (!state.ready || !state.configured) return;
    try {
      window.google.accounts.id.prompt();
    } catch (e) {
      console.warn('[auth] prompt failed', e);
    }
    renderAllButtons();
  }

  /** ออกจากระบบ — ล้างสถานะทั้งหมดในเครื่อง */
  function signOut() {
    idToken = null;
    tokenExp = 0;
    rejectedTokens = [];
    state.signedIn = false;
    state.profile = null;
    state.error = '';
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch (e) { /* ไม่เป็นไร */ }
    console.log('[auth] signed out');
    notify();
    renderAllButtons();
  }

  /** เหลือเวลาอีกกี่วินาทีก่อน token หมดอายุ */
  function secondsLeft() {
    if (!tokenExp) return 0;
    return Math.floor(tokenExp - (Date.now() / 1000));
  }

  /**
   * คืน ID Token สำหรับแนบไปกับคำขอ
   * คืน null ถ้ายังไม่ได้ลงชื่อเข้าใช้ หรือ token ใกล้หมดอายุแล้ว
   * (เผื่อเวลาไว้ 60 วินาที เพื่อไม่ให้ token หมดอายุระหว่างเดินทาง)
   */
  function getToken() {
    if (!idToken) return null;
    if (secondsLeft() <= 60) {
      // หมดอายุแล้วหรือใกล้หมด — ล้างทิ้ง แล้วแจ้งให้ส่วนอื่นรู้
      // (ไม่เรียก promptSignIn() ที่นี่ เพื่อไม่ให้เกิดลูปเมื่อ Google
      //  ส่ง credential เดิมที่หมดอายุกลับมาอีก — ผู้เรียกจะเป็นคนสั่ง prompt เอง)
      idToken = null;
      tokenExp = 0;
      state.signedIn = false;
      state.profile = null;
      state.error = 'การลงชื่อเข้าใช้หมดอายุแล้ว กรุณาลงชื่อเข้าใช้อีกครั้ง';
      notify();
      return null;
    }
    return idToken;
  }

  function isSignedIn() {
    return !!getToken();
  }

  /** ให้ api.js แจ้งกลับมาเมื่อเซิร์ฟเวอร์บอกว่า token ใช้ไม่ได้แล้ว */
  function handleAuthFailure(errorCode) {
    if (errorCode === 'AUTH_EXPIRED' || errorCode === 'AUTH_INVALID' ||
        errorCode === 'AUTH_REQUIRED') {
      markRejected(idToken);            // กัน Google ส่ง credential เดิมกลับมาอีก
      idToken = null;
      tokenExp = 0;
      state.signedIn = false;
      state.profile = null;
      state.error = (errorCode === 'AUTH_EXPIRED')
        ? 'การลงชื่อเข้าใช้หมดอายุแล้ว กรุณาลงชื่อเข้าใช้อีกครั้ง'
        : 'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google อีกครั้ง';
      notify();
      promptSignIn();
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') {
      listeners.push(fn);
      fn(getState());
    }
  }

  return {
    init: init,
    renderButton: renderButton,
    promptSignIn: promptSignIn,
    signOut: signOut,
    getToken: getToken,
    isSignedIn: isSignedIn,
    getState: getState,
    secondsLeft: secondsLeft,
    handleAuthFailure: handleAuthFailure,
    onChange: onChange
  };
})();
