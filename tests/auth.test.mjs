/**
 * ทดสอบระบบ Login/Register + สิทธิ์ผู้ใช้ (admin / member / viewer)
 * รัน:  node tests/auth.test.mjs
 * ใช้ฐานข้อมูลชั่วคราว data/auth-test.sqlite และพอร์ต 3997 แล้วปิดเอง
 *
 * ครอบคลุม:
 *  - บัญชีแรก = admin อัตโนมัติ, บัญชีถัดไป = member
 *  - ยังไม่ login / รหัสผ่านผิด /  logout → 401
 *  - viewer อ่านได้อย่างเดียว (เขียนทุกอย่าง = 403)
 *  - member เพิ่มได้, แก้ไข/ลบได้เฉพาะของตัวเอง (หรือที่เป็น "ผู้รับผิดชอบ")
 *  - admin ทำได้ทุกอย่าง + จัดการผู้ใช้ได้
 *  - กฎเซฟ: ลบตัวเองไม่ได้, ถอด admin คนสุดท้ายไม่ได้, ระงับบัญชี = เด้งออกทันที
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3997;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB_REL = "data/auth-test.sqlite";
const DB_ABS = path.join(ROOT, DB_REL);
const B = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};

async function raw(method, p, body, cookie = "") {
  const noBody = method === "GET" || method === "HEAD" || body === undefined;
  const res = await fetch(B + p, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: noBody ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}

async function register(username, display_name, password = "secret123") {
  return raw("POST", "/api/auth/register", { username, display_name, password });
}

for (const f of [DB_ABS, DB_ABS + "-wal", DB_ABS + "-shm"]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}

console.log("เริ่มทดสอบระบบผู้ใช้และสิทธิ์ …");
const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), CMR_DB_FILE: DB_REL },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

let adminCookie = "", memberCookie = "", member2Cookie = "", viewerCookie = "";
let adminId = "", memberId = "", member2Id = "", viewerId = "";

try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(120);
    try { if ((await raw("GET", "/api/health")).code === 200) { ready = true; break; } } catch { /* ยังไม่พร้อม */ }
  }
  if (!ready) throw new Error("เซิร์ฟเวอร์ไม่ยอมเปิดพอร์ต");

  /* ---------- สมัคร / เข้าสู่ระบบ ---------- */
  let r = await register("boss", "นายเจ้าของ");
  adminCookie = r.cookie; adminId = r.json.user.id;
  ok("บัญชีแรกได้สิทธิ์ admin", r.code === 201 && r.json.user.role === "admin" && r.json.first_admin === true);
  ok("ได้ session cookie (httpOnly)", adminCookie.startsWith("cmr_session="));

  r = await register("member1", "สมชาย ขายเก่ง");
  memberCookie = r.cookie; memberId = r.json.user.id;
  ok("บัญชีที่สองได้สิทธิ์ member อัตโนมัติ", r.code === 201 && r.json.user.role === "member" && r.json.first_admin === false);

  r = await register("member1", "ชื่อซ้ำ");
  ok("ชื่อผู้ใช้ซ้ำถูกปฏิเสธ (409)", r.code === 409);

  r = await register("bad pw", "รหัสสั้น", "123");
  ok("รหัสผ่านสั้นกว่า 6 ตัวถูกปฏิเสธ (400)", r.code === 400);

  r = await raw("POST", "/api/auth/login", { username: "member1", password: "wrong-pass" });
  ok("รหัสผ่านผิด → 401", r.code === 401);

  r = await raw("POST", "/api/auth/login", { username: "member1", password: "secret123" });
  memberCookie = r.cookie;
  ok("เข้าสู่ระบบสำเร็จด้วยรหัสที่ถูกต้อง", r.code === 200 && r.json.user.username === "member1");

  r = await raw("POST", "/api/auth/login", { username: "boss", password: "secret123" });
  adminCookie = r.cookie;
  ok("admin เข้าสู่ระบบได้", r.code === 200 && r.json.user.role === "admin");

  /* สร้างผู้ใช้เพิ่ม: member2 และ viewer ผ่าน endpoint ของ admin */
  r = await raw("POST", "/api/users", { username: "member2", display_name: "สมหญิง การตลาด", password: "secret123", role: "member" }, adminCookie);
  member2Cookie = r.cookie || ""; member2Id = r.json.user.id;
  if (!member2Cookie) {
    const lg = await raw("POST", "/api/auth/login", { username: "member2", password: "secret123" });
    member2Cookie = lg.cookie;
  }
  ok("admin เพิ่มผู้ใช้ใหม่ได้ (201)", r.code === 201 && r.json.user.role === "member");

  r = await raw("POST", "/api/users", { username: "viewer1", display_name: "ผู้ชม อย่างเดียว", password: "secret123", role: "viewer" }, adminCookie);
  viewerId = r.json.user.id;
  const lgv = await raw("POST", "/api/auth/login", { username: "viewer1", password: "secret123" });
  viewerCookie = lgv.cookie;
  ok("admin สร้างบัญชี viewer ได้", r.code === 201 && r.json.user.role === "viewer" && !!viewerCookie);

  r = await raw("GET", "/api/users", {}, memberCookie);
  ok("member เรียกดูรายชื่อผู้ใช้ไม่ได้ (403)", r.code === 403);
  r = await raw("GET", "/api/users", {}, adminCookie);
  ok("admin เรียกดูรายชื่อผู้ใช้ได้", r.code === 200 && Array.isArray(r.json) && r.json.length === 4);

  /* ---------- ยังไม่ login ---------- */
  r = await raw("GET", "/api/records");
  ok("GET /api/records โดยไม่ login → 401", r.code === 401);
  r = await raw("GET", "/api/app");
  ok("GET /api/app โดยไม่ login → 401", r.code === 401);
  r = await raw("POST", "/api/records", { values: { company: "x" } });
  ok("POST /api/records โดยไม่ login → 401", r.code === 401);
  r = await raw("GET", "/api/auth/setup");
  ok("/api/auth/setup เปิดให้เรียกได้โดยไม่ login", r.code === 200 && r.json.has_users === true);

  /* ---------- viewer: อ่านอย่างเดียว ---------- */
  r = await raw("GET", "/api/records", {}, viewerCookie);
  ok("viewer อ่านรายการได้", r.code === 200 && Array.isArray(r.json) && r.json.length === 16);
  r = await raw("POST", "/api/records", { values: { customer_code: "V-1", company: " viewer สร้าง" } }, viewerCookie);
  ok("viewer เพิ่มระเบียนไม่ได้ (403)", r.code === 403);
  r = await raw("PUT", "/api/app", { schema: { fields: [{ key: "x", label: "x" }] } }, viewerCookie);
  ok("viewer แก้ไข schema ไม่ได้ (403)", r.code === 403);
  r = await raw("POST", "/api/reset", {}, viewerCookie);
  ok("viewer รีเซ็ตข้อมูลไม่ได้ (403)", r.code === 403);

  /* ---------- member: เพิ่มได้, จัดการของตัวเอง ---------- */
  r = await raw("POST", "/api/records", {
    values: { customer_code: "M-1", company: "บริษัทของสมชาย", status: "Lead" }
  }, memberCookie);
  const memberRec = r.json;
  ok("member เพิ่มระเบียนได้ (201)", r.code === 201 && !!memberRec.id);
  ok("บันทึกผู้สร้าง = member", memberRec.creator_id === memberId && memberRec.creator_name === "สมชาย ขายเก่ง");
  ok("ผู้รับผิดชอบถูกตั้งให้อัตโนมัติเป็นคนสร้าง", memberRec.values.owner === "สมชาย ขายเก่ง");

  r = await raw("PUT", `/api/records/${memberRec.id}`, { values: { deal_value: 5000 } }, memberCookie);
  ok("member แก้ไขระเบียนของตัวเองได้", r.code === 200 && r.json.values.deal_value === 5000);

  r = await raw("PUT", `/api/records/${memberRec.id}`, { values: { deal_value: 9 } }, member2Cookie);
  ok("member2 แก้ไขระเบียนของ member1 ไม่ได้ (403)", r.code === 403);
  r = await raw("DELETE", `/api/records/${memberRec.id}`, undefined, member2Cookie);
  ok("member2 ลบระเบียนของ member1 ไม่ได้ (403)", r.code === 403);
  r = await raw("POST", `/api/records/${memberRec.id}/status`, { status: "เสนอราคา" }, member2Cookie);
  ok("member2 เปลี่ยนสถานะระเบียนของคนอื่นไม่ได้ (403)", r.code === 403);
  r = await raw("POST", `/api/records/${memberRec.id}/comments`, { text: "แอบคอมเมนต์" }, member2Cookie);
  ok("member2 คอมเมนต์ระเบียนคนอื่นได้ (บันทึกเป็นหมายเหตุ)", r.code === 200);

  /* member ที่ถูกตั้งเป็น "ผู้รับผิดชอบ" แก้ไขระเบียนนั้นได้ */
  r = await raw("POST", "/api/records", {
    values: { customer_code: "A-1", company: "ของโอนงาน", owner: "สมหญิง การตลาด" }
  }, adminCookie);
  const handedOff = r.json;
  r = await raw("PUT", `/api/records/${handedOff.id}`, { values: { deal_value: 777 } }, member2Cookie);
  ok("member แก้ไขระเบียนที่ตัวเองเป็น 'ผู้รับผิดชอบ' ได้", r.code === 200 && r.json.values.deal_value === 777);

  r = await raw("PUT", "/api/app", { schema: { fields: [{ key: "x", label: "x" }] } }, memberCookie);
  ok("member แก้ไข schema ไม่ได้ (403)", r.code === 403);
  r = await raw("POST", "/api/reset", {}, memberCookie);
  ok("member รีเซ็ตข้อมูลไม่ได้ (403)", r.code === 403);
  r = await raw("POST", "/api/users", { username: "hacker", display_name: "x", password: "secret123" }, memberCookie);
  ok("member เพิ่มผู้ใช้ไม่ได้ (403)", r.code === 403);

  /* ---------- admin: ทำได้ทุกอย่าง ---------- */
  r = await raw("PUT", `/api/records/${memberRec.id}`, { values: { priority: "สูง" } }, adminCookie);
  ok("admin แก้ไขระเบียนของคนอื่นได้", r.code === 200 && r.json.values.priority === "สูง");
  r = await raw("DELETE", `/api/records/${handedOff.id}`, undefined, adminCookie);
  ok("admin ลบระเบียนของคนอื่นได้", r.code === 200);

  /* ---------- จัดการผู้ใช้ ---------- */
  r = await raw("PATCH", `/api/users/${member2Id}`, { role: "viewer" }, adminCookie);
  ok("admin เปลี่ยนบทบาทเป็น viewer ได้", r.code === 200 && r.json.user.role === "viewer");
  r = await raw("POST", "/api/records", { values: { company: "หลังถูกลดบทบาท" } }, member2Cookie);
  ok("พอเปลี่ยนเป็น viewer แล้วเขียนไม่ได้ทันที (403)", r.code === 403);
  r = await raw("PATCH", `/api/users/${member2Id}`, { role: "member" }, adminCookie);
  ok("เปลี่ยนบทบาทกลับเป็น member ได้", r.code === 200 && r.json.user.role === "member");

  r = await raw("PATCH", `/api/users/${adminId}`, { role: "member" }, adminCookie);
  ok("ถอด admin คนสุดท้ายไม่ได้ (400)", r.code === 400);

  r = await raw("DELETE", `/api/users/${adminId}`, undefined, adminCookie);
  ok("ลบบัญชีตัวเองไม่ได้ (400)", r.code === 400);

  r = await raw("PATCH", `/api/users/${viewerId}`, { active: false }, adminCookie);
  ok("ระงับบัญชี viewer ได้", r.code === 200 && r.json.user.active === false);
  r = await raw("GET", "/api/records", {}, viewerCookie);
  ok("บัญชีที่ถูกระงับถูกเด้งออกทันที (401)", r.code === 401);

  r = await raw("PATCH", `/api/users/${viewerId}`, { active: true, password: "newpass456" }, adminCookie);
  ok("เปิดใช้งาน + รีเซ็ตรหัสผ่านได้", r.code === 200 && r.json.user.active === true);
  r = await raw("POST", "/api/auth/login", { username: "viewer1", password: "secret123" });
  ok("รหัสผ่านเดิมใช้ไม่ได้หลังรีเซ็ต (401)", r.code === 401);
  r = await raw("POST", "/api/auth/login", { username: "viewer1", password: "newpass456" });
  ok("รหัสผ่านใหม่ใช้ได้", r.code === 200);

  /* ---------- logout ---------- */
  r = await raw("POST", "/api/auth/logout", {}, memberCookie);
  ok("logout สำเร็จ", r.code === 200);
  r = await raw("GET", "/api/records", {}, memberCookie);
  ok("cookie เดิมใช้ไม่ได้หลัง logout (401)", r.code === 401);
} catch (e) {
  failed++;
  console.error("✗ เกิดข้อผิดพลาด: " + (e && e.stack ? e.stack : e));
} finally {
  try { server.stdout?.destroy(); server.stderr?.destroy(); } catch { /* noop */ }
  server.kill();
  await sleep(300);
  for (const f of [DB_ABS, DB_ABS + "-wal", DB_ABS + "-shm"]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}

console.log(`\nผลลัพธ์: ผ่าน ${passed} · ไม่ผ่าน ${failed}`);
setTimeout(() => process.exit(failed ? 1 : 0), 250);
