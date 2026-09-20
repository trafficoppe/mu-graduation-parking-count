/**
 * config.js
 * ค่าตั้งค่าของ Frontend (ไฟล์นี้เป็นสาธารณะ — ห้ามใส่ข้อมูลลับใด ๆ)
 *
 * สิ่งเดียวที่ต้องแก้ก่อนใช้งานจริงคือ API_URL
 * ให้นำ Web App URL ของ Google Apps Script (ลงท้ายด้วย /exec) มาวางแทนค่าด้านล่าง
 */
var APP_CONFIG = {
  // ตัวอย่าง: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxx/exec"
  API_URL: "REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL",

  DEFAULT_YEAR: 2569,
  APP_VERSION: "1.0.0",

  // เวลาที่รอคำตอบจากเซิร์ฟเวอร์ (มิลลิวินาที)
  REQUEST_TIMEOUT_MS: 30000,
  JSONP_TIMEOUT_MS: 30000,

  // ระยะเวลารีเฟรช Dashboard อัตโนมัติ (มิลลิวินาที) — 0 = ปิด
  DASHBOARD_AUTO_REFRESH_MS: 60000,

  // ชื่อหน่วยงานที่แสดงบนหน้าเว็บ (แก้ได้ตามหน่วยงาน)
  ORG_NAME: "งานจราจรและความปลอดภัย กองกายภาพและสิ่งแวดล้อม มหาวิทยาลัยมหิดล",

  // key ของ localStorage (เก็บเฉพาะข้อมูลผู้กรอกเมื่อผู้ใช้ยินยอมเท่านั้น)
  STORAGE_KEYS: {
    RECORDER: "gpvcs.recorder.v1",
    DEVICE_ID: "gpvcs.deviceId.v1",
    CONTINUOUS: "gpvcs.continuous.v1",
    PENDING: "gpvcs.pendingQueue.v1"
  }
};
