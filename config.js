/**
 * config.js
 * ค่าตั้งค่าของ Frontend (ไฟล์นี้เป็นสาธารณะ — ห้ามใส่ข้อมูลลับใด ๆ)
 *
 * สิ่งเดียวที่ต้องแก้ก่อนใช้งานจริงคือ API_URL
 * ให้นำ Web App URL ของ Google Apps Script (ลงท้ายด้วย /exec) มาวางแทนค่าด้านล่าง
 *
 * หมายเหตุเวอร์ชัน 1.2.0:
 *   Google OAuth Client ID **ไม่ได้อยู่ในไฟล์นี้** โดยตั้งใจ
 *   หน้าเว็บจะขอค่านั้นจากระบบหลังบ้านเอง (action getAuthConfig)
 *   ผู้ดูแลจึงตั้งค่าที่เดียวคือใน Apps Script -> setupAuthentication()
 *   และไม่ต้องแก้ไฟล์บน GitHub อีกเมื่อเปลี่ยน Client ID
 */
var APP_CONFIG = {
  // ตัวอย่าง: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxx/exec"
API_URL: "https://script.google.com/macros/s/AKfycbzlJwPufZeg2Iu5leXB7sgJsSeMgL0QKVwGRZ3mO8DDY6CDfd61izD1gzLJM6lWELCH/exec",

  DEFAULT_YEAR: 2569,
  APP_VERSION: "1.2.0",

  // เวลาที่รอคำตอบจากเซิร์ฟเวอร์ (มิลลิวินาที)
  REQUEST_TIMEOUT_MS: 30000,
  JSONP_TIMEOUT_MS: 30000,

  // ระยะเวลารีเฟรช Dashboard อัตโนมัติ (มิลลิวินาที) — 0 = ปิด
  DASHBOARD_AUTO_REFRESH_MS: 60000,

  // ระยะเวลาตรวจสอบว่า "วันงานใดเปิดให้บันทึกแล้ว" ซ้ำ (มิลลิวินาที) — 0 = ปิด
  // ทำให้รายการวันงานเปลี่ยนตามเวลาจริงโดยผู้ใช้ไม่ต้องโหลดหน้าใหม่
  RECORD_STATUS_REFRESH_MS: 60000,

  // ชื่อหน่วยงานที่แสดงบนหน้าเว็บ (แก้ได้ตามหน่วยงาน)
  ORG_NAME: "งานจราจรและความปลอดภัย กองกายภาพและสิ่งแวดล้อม มหาวิทยาลัยมหิดล",

  // key ของ localStorage (เก็บเฉพาะข้อมูลผู้กรอกเมื่อผู้ใช้ยินยอมเท่านั้น)
  // เก็บเฉพาะชื่อและเบอร์โทรเมื่อผู้ใช้ยินยอม — ไม่เคยเก็บอีเมลหรือ token ใด ๆ
  STORAGE_KEYS: {
    RECORDER: "gpvcs.recorder.v1",
    DEVICE_ID: "gpvcs.deviceId.v1",
    CONTINUOUS: "gpvcs.continuous.v1",
    PENDING: "gpvcs.pendingQueue.v1"
  }
};
