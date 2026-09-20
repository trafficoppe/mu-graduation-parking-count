/**
 * utils.js
 * ฟังก์ชันช่วยเหลือฝั่ง Frontend: DOM, วันที่, การตรวจข้อมูล, localStorage, CSV
 */
var Utils = (function () {
  'use strict';

  var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** '2026-10-03' -> '3 ตุลาคม 2569' */
  function formatThaiDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return isoDate || '-';
    var y = parseInt(isoDate.substring(0, 4), 10);
    var m = parseInt(isoDate.substring(5, 7), 10);
    var d = parseInt(isoDate.substring(8, 10), 10);
    return d + ' ' + THAI_MONTHS[m - 1] + ' ' + (y + 543);
  }

  /** '2026-10-03 10:35:42' -> '10:35:42 น.' */
  function formatThaiTime(ts) {
    if (!ts) return '-';
    var t = String(ts).substring(11, 19);
    return t ? t + ' น.' : '-';
  }

  /** '2026-10-03 10:35:42' -> '3 ต.ค. 2569 10:35' */
  function formatShortDateTime(ts) {
    if (!ts) return '-';
    var s = String(ts);
    var d = s.substring(0, 10), t = s.substring(11, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return s;
    var y = parseInt(d.substring(0, 4), 10) + 543;
    var m = parseInt(d.substring(5, 7), 10);
    var day = parseInt(d.substring(8, 10), 10);
    var shortM = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1];
    return day + ' ' + shortM + ' ' + y + ' ' + t;
  }

  /** เวลาปัจจุบันของเครื่องผู้ใช้ 'yyyy-MM-dd HH:mm:ss' */
  function clientTimestamp() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function formatNumber(n) {
    if (n === null || n === undefined || n === '') return '-';
    return Number(n).toLocaleString('th-TH');
  }

  function formatPercent(p) {
    if (p === null || p === undefined || p === '') return '-';
    return Number(p).toFixed(2) + '%';
  }

  /** สร้าง UUID แบบใช้ได้ทุกเบราว์เซอร์ */
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (e) { /* fallthrough */ }
    }
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint8Array(16);
      window.crypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push(('0' + buf[i].toString(16)).slice(-2));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
    }
    return 'r' + Date.now().toString(36) + Math.random().toString(36).substring(2, 12);
  }

  /** รหัสอุปกรณ์ (ไม่ใช่ข้อมูลส่วนบุคคล ใช้ช่วยจำกัดอัตราการส่งข้อมูล) */
  function getDeviceId() {
    var k = APP_CONFIG.STORAGE_KEYS.DEVICE_ID;
    var v = safeGet(k);
    if (!v) {
      v = uuid();
      safeSet(k, v);
    }
    return v;
  }

  /* ---------- localStorage แบบปลอดภัย ---------- */
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }
  function getJson(key, fallback) {
    var raw = safeGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function setJson(key, obj) {
    try { return safeSet(key, JSON.stringify(obj)); } catch (e) { return false; }
  }

  /* ---------- การตรวจข้อมูล (ตรงกับฝั่ง Backend) ---------- */
  function isValidEmail(email) {
    if (!email) return false;
    return /^[^\s@,;:<>()\[\]\\]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(email).trim());
  }

  function normalizePhone(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    s = s.replace(/[\s\-().]/g, '');
    if (/^\+66\d{9}$/.test(s)) s = '0' + s.substring(3);
    else if (/^66\d{9}$/.test(s)) s = '0' + s.substring(2);
    if (/^0\d{9}$/.test(s)) return s;
    return null;
  }

  function isInteger(v) {
    return /^\d+$/.test(String(v).trim());
  }

  /* ---------- CSV ---------- */
  function toCsv(headers, rows) {
    function cell(v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;   // กัน formula injection ในโปรแกรมตาราง
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [headers.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(cell).join(',')); });
    return lines.join('\r\n');
  }

  function downloadCsv(filename, csvText) {
    var blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(message, type) {
    var box = $('#toast');
    if (!box) return;
    box.textContent = message;
    box.className = 'toast show ' + (type || 'info');
    box.setAttribute('role', 'status');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 4500);
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /** ข้อความสถานะความจุ -> class สี */
  function statusClass(status) {
    switch (status) {
      case 'เต็ม/เกินความจุ': return 'st-full';
      case 'สูง': return 'st-high';
      case 'ปานกลาง': return 'st-medium';
      case 'ปกติ': return 'st-normal';
      default: return 'st-none';
    }
  }

  return {
    $: $, $$: $$, el: el, escapeHtml: escapeHtml,
    formatThaiDate: formatThaiDate, formatThaiTime: formatThaiTime,
    formatShortDateTime: formatShortDateTime, clientTimestamp: clientTimestamp,
    formatNumber: formatNumber, formatPercent: formatPercent,
    uuid: uuid, getDeviceId: getDeviceId,
    safeGet: safeGet, safeSet: safeSet, safeRemove: safeRemove,
    getJson: getJson, setJson: setJson,
    isValidEmail: isValidEmail, normalizePhone: normalizePhone, isInteger: isInteger,
    toCsv: toCsv, downloadCsv: downloadCsv, toast: toast, debounce: debounce,
    statusClass: statusClass
  };
})();
