/**
 * ทดสอบ "พฤติกรรมจริง" ของระเบียนตลอดชีวิตการใช้งาน (headless)
 * รัน:  node tests/lifecycle.test.mjs
 *
 * จุดที่ตั้งใจตรวจสอบ:
 *   1. เปิดเซิร์ฟเวอร์บน DB ชั่วคราว → ได้ข้อมูลตัวอย่างครบ (ไม่แตะ data/cmr.sqlite จริง)
 *   2. สร้างระเบียน → มี activity "สร้างระเบียน", created_at = updated_at
 *   3. คอมเมนต์ → activity ถูกต่อท้าย และ updated_at ขยับขึ้นจริง
 *   4. เปลี่ยนสถานะ → values.status เปลี่ยน + มี activity บันทึก "A → B"
 *   5. แก้ไขฟิลด์ → activity ระบุชื่อฟิลด์ (ภาษาไทย) ที่ถูกแก้
 *   6. เพิ่มฟิลด์เองใน schema → บันทึกค่าลงฟิลด์ใหม่ได้และอ่านกลับครบ
 *   7. ลบระเบียน → หายจากลิสต์ และ GET ตอบ 404
 *   8. "รีสตาร์ทเซิร์ฟเวอร์" → ข้อมูลยังอยู่ครบ (พิสูจน์ว่าลง SQLite จริง ไม่ใช่หน่วยความจำ)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3998;
const DB_REL = "data/lifecycle-test.sqlite";
const DB_ABS = path.join(ROOT, DB_REL);
const B = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
let AUTH = ""; // session cookie ของ admin
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};

async function call(method, p, body) {
  const res = await fetch(B + p, {
    method,
    headers: { "Content-Type": "application/json", ...(AUTH ? { Cookie: AUTH } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}

/** สมัคร admin (คนแรกของ DB ชั่วคราว) และเก็บ session */
async function loginAsAdmin() {
  const res = await fetch(B + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "boss", display_name: "นายเจ้าของ", password: "secret123" })
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error("สมัคร admin ไม่สำเร็จ: " + res.status + " " + JSON.stringify(data));
  AUTH = (res.headers.get("set-cookie") || "").split(";")[0];
  return data.user;
}

function startServer() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), CMR_DB_FILE: DB_REL },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    await sleep(120);
    try {
      const r = await call("GET", "/api/health");
      if (r.code === 200) return true;
    } catch { /* ยังไม่พร้อม */ }
  }
  return false;
}

const stop = (child) => { try { child.kill(); } catch { /* noop */ } };

/* เคลียร์ DB ชั่วคราวของรอบก่อนหน้า */
for (const f of [DB_ABS, DB_ABS + "-wal", DB_ABS + "-shm"]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}

console.log("เริ่มทดสอบ lifecycle (DB ชั่วคราว " + DB_REL + ") …");
let server = startServer();
let keepAliveId = null;

try {
  ok("เซิร์ฟเวอร์เปิดพอร์ตได้", await waitReady());

  /* 0. เข้าสู่ระบบ */
  const admin = await loginAsAdmin();
  ok("สมัครสมาชิก (บัญชีแรก = admin) + ได้ session", !!AUTH && admin.role === "admin", JSON.stringify(admin));

  /* 1. fresh DB ถูก seed */
  let r = await call("GET", "/api/records");
  const seeded = r.json;
  ok("seed ข้อมูลตัวอย่าง 16 ระเบียน", Array.isArray(seeded) && seeded.length === 16, "got " + (seeded && seeded.length));
  let app = await call("GET", "/api/app");
  ok("schema เริ่มต้น 17 ฟิลด์", app.json.fields.length === 17, "got " + app.json.fields.length);

  /* 2. สร้างระเบียน */
  r = await call("POST", "/api/records", {
    values: { customer_code: "LC-1", company: "บริษัทไลฟ์ไซเคิล จำกัด", status: "Lead", deal_value: 1000, owner: "สมชาย ใจดี" }
  });
  const rec = r.json;
  ok("POST /api/records สร้างสำเร็จ (201)", r.code === 201 && !!rec.id, "code=" + r.code);
  ok("บันทึกผู้สร้างระเบียน (creator_name)", rec.creator_name === "นายเจ้าของ" && !!rec.creator_id, JSON.stringify({ c: rec.creator_name }));
  ok("activity แรกคือ 'สร้างระเบียน'", rec.activities.length === 1 && rec.activities[0].type === "create");
  ok("created_at = updated_at ตอนสร้าง", rec.created_at === rec.updated_at);
  keepAliveId = rec.id;

  /* 3. คอมเมนต์ → updated_at ขยับ */
  const t0 = rec.updated_at;
  await sleep(1100); // กันค่า millisecond ชนกัน
  r = await call("POST", `/api/records/${rec.id}/comments`, { text: "โทรนัดแล้ว" });
  ok("คอมเมนต์ถูกเพิ่ม", r.code === 200 && r.json.activities.length === 2 && r.json.activities[1].text === "โทรนัดแล้ว");
  ok("updated_at ขยับขึ้นจริงหลังคอมเมนต์", r.json.updated_at > t0, `${t0} -> ${r.json.updated_at}`);

  /* 4. เปลี่ยนสถานะ */
  r = await call("POST", `/api/records/${rec.id}/status`, { status: "กำลังเจรจา" });
  const lastAct = r.json.activities[r.json.activities.length - 1];
  ok("ค่า status เปลี่ยนใน values", r.json.values.status === "กำลังเจรจา");
  ok("มี activity บันทึกการเปลี่ยนสถานะ", lastAct.type === "status" && lastAct.text.includes("Lead → กำลังเจรจา"), lastAct.text);

  /* 5. แก้ไขฟิลด์ → activity ระบุชื่อฟิลด์ภาษาไทย */
  r = await call("PUT", `/api/records/${rec.id}`, { values: { deal_value: 750000, email: "lc@example.com" } });
  const updAct = r.json.activities[r.json.activities.length - 1];
  ok("ค่าที่แก้ถูกบันทึกลง values", r.json.values.deal_value === 750000 && r.json.values.email === "lc@example.com");
  ok("activity ระบุชื่อฟิลด์ที่แก้", updAct.type === "update"
    && updAct.text.includes("มูลค่าดีล (บาท)") && updAct.text.includes("อีเมล"), updAct.text);

  /* 6. เพิ่มฟิลด์ใน schema แล้วใช้งานได้จริง */
  app = await call("GET", "/api/app");
  const schema = app.json;
  schema.fields.push({ key: "zone", label: "โซนขาย", type: "select", options: ["กรุงเทพฯ", "ต่างจังหวัด"], system: false });
  r = await call("PUT", "/api/app", { schema });
  ok("PUT /api/app บันทึกฟิลด์ใหม่", r.code === 200 && r.json.fields.length === 18);

  r = await call("POST", "/api/records", { values: { customer_code: "LC-2", company: "ลูกค้าฟิลด์ใหม่", status: "Lead", zone: "กรุงเทพฯ" } });
  ok("สร้างระเบียนพร้อมฟิลด์ใหม่", r.code === 201 && r.json.values.zone === "กรุงเทพฯ");

  /* 7. ลิสต์รวมและการลบ */
  r = await call("GET", "/api/records");
  ok("ลิสต์มี 18 ระเบียน", r.json.length === 18, "got " + r.json.length);
  ok("ค้นระเบียนจากลิสต์เจอ", r.json.some((x) => x.id === keepAliveId && x.values.company === "บริษัทไลฟ์ไซเคิล จำกัด"));

  r = await call("DELETE", `/api/records/${r.json.find((x) => x.values.customer_code === "LC-2").id}`);
  ok("DELETE สำเร็จ", r.code === 200);
  r = await call("GET", "/api/records");
  ok("หายจากลิสต์หลังลบ", r.json.length === 17, "got " + r.json.length);

  /* 8. รีสตาร์ทเซิร์ฟเวอร์ → ข้อมูลต้องยังอยู่ (พิสูจน์ว่าลง SQLite จริง) */
  stop(server);
  await sleep(500);
  server = startServer();
  ok("รีสตาร์ทแล้วเซิร์ฟเวอร์กลับมา", await waitReady());

  r = await call("GET", `/api/records/${keepAliveId}`);
  ok("ระเบียนหลังรีสตาร์ทมีค่าครบ", r.code === 200
    && r.json.values.deal_value === 750000
    && r.json.values.status === "กำลังเจรจา"
    && r.json.values.email === "lc@example.com",
    JSON.stringify(r.json.values));
  const me = await call("GET", "/api/auth/me");
  ok("เซสชันยังใช้ได้หลังรีสตาร์ท (เก็บลง SQLite จริง)", me.code === 200 && me.json.user && me.json.user.username === "boss");
  ok("ประวัติ activity คงเหลือ 4 รายการ", r.json.activities.length === 4,
    "got " + (r.json.activities && r.json.activities.length));
  ok("activity เรียงเก่า→ใหม่ตามลำดับเวลา",
    r.json.activities.map((a) => a.type).join(",") === "create,comment,status,update",
    r.json.activities.map((a) => a.type).join(","));

  app = await call("GET", "/api/app");
  ok("schema ที่แก้ไว้คงอยู่หลังรีสตาร์ท",
    app.json.fields.length === 18 && app.json.fields.some((f) => f.key === "zone"));

  /* 9. ความถูกต้องของข้อมูลที่บันทึกลงไฟล์จริง */
  ok("ไฟล์ SQLite ถูกสร้างจริง", fs.existsSync(DB_ABS));
} catch (e) {
  failed++;
  console.error("✗ เกิดข้อผิดพลาด: " + (e && e.stack ? e.stack : e));
} finally {
  stop(server);
  await sleep(300);
  for (const f of [DB_ABS, DB_ABS + "-wal", DB_ABS + "-shm"]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}

console.log(`\nผลลัพธ์: ผ่าน ${passed} · ไม่ผ่าน ${failed}`);
setTimeout(() => process.exit(failed ? 1 : 0), 250);
