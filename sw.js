/**
 * sw.js — Service Worker
 *
 * หลักการสำคัญด้านความถูกต้องของข้อมูล:
 *  - แคชเฉพาะไฟล์หน้าเว็บ (HTML/CSS/JS/ไอคอน) เท่านั้น เพื่อให้เปิดหน้าเว็บได้เร็ว
 *  - ห้ามแคชหรือ intercept คำขอไปยัง Google Apps Script เด็ดขาด
 *    เพราะจะทำให้ผู้ใช้เห็นข้อมูลเก่า หรือเกิดการส่งข้อมูลซ้ำโดยไม่ตั้งใจ
 *  - ห้ามแคชคำขอไปยัง accounts.google.com (ระบบลงชื่อเข้าใช้) ด้วยเหตุผลเดียวกัน
 *    โค้ดด้านล่างข้ามทุกคำขอที่ไม่ใช่โดเมนของเว็บนี้อยู่แล้ว
 *  - ไม่มี Background Sync / Offline Queue ในเวอร์ชันนี้
 *    ระบบเลือกแจ้งเตือนผู้ใช้ให้กดบันทึกใหม่เมื่อมีสัญญาณ ซึ่งปลอดภัยกว่าการคิวอัตโนมัติ
 */
var CACHE_NAME = 'gpvcs-shell-v1.3.0';
var SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './utils.js',
  './auth.js',
  './api.js',
  './app.js',
  './dashboard.js',
  './admin.js',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function () {
      return self.skipWaiting();
    }).catch(function (e) {
      console.warn('[sw] precache failed', e);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // เฉพาะ GET เท่านั้น และต้องเป็นไฟล์ของเว็บไซต์นี้
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // ห้ามแตะคำขอที่ไปยัง Apps Script หรือโดเมนอื่นใด
  if (url.origin !== self.location.origin) return;

  // Network-first สำหรับไฟล์ของเว็บ เพื่อให้ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, copy);
        }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
