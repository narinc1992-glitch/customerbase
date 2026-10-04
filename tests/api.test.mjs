/**
 * ทดสอบ REST API ของ CMR Base
 * รัน:  node tests/api.test.mjs
 * สคริปต์จะเปิดเซิร์ฟเวอร์ชั่วคราวที่พอร์ต 3999 แล้วปิดเองเมื่อจบ
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3999;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB_REL = "data/api-test.sqlite";
const DB_ABS = path.join(ROOT, DB_REL);
const B = `http://localhost:${PORT}`;
let AUTH = ""; // session cookie ของ admin สำหรับชุดทดสอบนี้
let passed = 0;
let failed = 0;

function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
}

async function call(method, path, body) {
  const res = await fetch(B + path, {
    method,
    headers: { "Content-Type": "application/json", ...(AUTH ? { Cookie: AUTH } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}

/** สร้าง session ของ admin (บัญชีแรกของ DB ชั่วคราว) */
async function loginAsAdmin() {
  const res = await fetch(B + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", display_name: "ผู้ดูแลทดสอบ", password: "secret123" })
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error("สมัคร admin ไม่สำเร็จ: " + res.status + " " + JSON.stringify(data));
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  AUTH = cookie;
  return data.user;
}

/** ส่ง path ดิบ ๆ ให้เซิร์ฟเวอร์โดยไม่ให้ client normalize (ใช้ทดสอบ path traversal) */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: rawPath, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ code: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

console.log("เริ่มทดสอบ API …");
/* ใช้ฐานข้อมูลชั่วคราวเสมอ เพื่อไม่ให้แตะข้อมูลจริง */
for (const f of [DB_ABS, DB_ABS + "-wal", DB_ABS + "-shm"]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}
const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), CMR_DB_FILE: DB_REL },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const r = await call("GET", "/api/health");
      if (r.code === 200) { ready = true; break; }
    } catch { /* ยังไม่พร้อม */ }
  }
  if (!ready) throw new Error("เซิร์ฟเวอร์ไม่ยอมเปิดพอร์ต:\n" + serverLog);

  /* เข้าสู่ระบบเป็น admin ก่อนใช้งาน endpoint ที่เหลือ */
  const admin = await loginAsAdmin();
  ok("สมัครสมาชิก (บัญชีแรก = admin) แล้วได้ session", !!AUTH && admin.role === "admin", JSON.stringify(admin));
  ok("GET /api/auth/me คืนข้อมูลผู้ใช้", (await call("GET", "/api/auth/me")).json.user.username === "admin");

  /* health + static */
  let r = await call("GET", "/api/health");
  ok("GET /api/health", r.code === 200 && r.json.ok === true, r.text);
  const index = await fetch(B + "/");
  ok("GET / (หน้าเว็บ)", index.status === 200 && (await index.text()).includes("CMR Base"));

  /* schema */
  r = await call("GET", "/api/app");
  ok("GET /api/app", r.code === 200 && Array.isArray(r.json.fields) && r.json.fields.length > 5);
  const schema = r.json;
  const beforeCount = schema.fields.length;

  r = await call("PUT", "/api/app", { schema: { ...schema, fields: [...schema.fields, { key: "test_field", label: "ฟิลด์ทดสอบ", type: "text" }] } });
  ok("PUT /api/app เพิ่มฟิลด์", r.code === 200 && r.json.fields.length === beforeCount + 1);
  r = await call("PUT", "/api/app", { schema: { fields: [] } });
  ok("PUT /api/app ปฏิเสธ schema ว่าง (400)", r.code === 400);
  await call("PUT", "/api/app", { schema }); // คืนค่าเดิม

  /* CRUD */
  r = await call("POST", "/api/records", { values: { customer_code: "TEST-1", company: "บริษัททดสอบ จำกัด", status: "Lead", deal_value: 15000, email: "test@example.com" } });
  ok("POST /api/records", r.code === 201 && !!r.json.id && r.json.values.company === "บริษัททดสอบ จำกัด");
  const id = r.json.id;

  r = await call("GET", "/api/records");
  ok("GET /api/records (มีระเบียนใหม่)", r.code === 200 && Array.isArray(r.json) && r.json.some((x) => x.id === id));

  r = await call("PUT", `/api/records/${id}`, { values: { status: "เสนอราคา", deal_value: 25000 } });
  ok("PUT /api/records/:id", r.code === 200 && r.json.values.status === "เสนอราคา" && r.json.values.deal_value === 25000);
  ok("บันทึก activity เมื่อแก้ไข", r.json.activities.some((a) => a.type === "update"));

  r = await call("POST", `/api/records/${id}/comments`, { text: "โทรนัด demo แล้ว" });
  ok("POST comments", r.code === 200 && r.json.activities.some((a) => a.type === "comment" && a.text === "โทรนัด demo แล้ว"));

  r = await call("POST", `/api/records/${id}/status`, { status: "กำลังเจรจา" });
  ok("POST status", r.code === 200 && r.json.values.status === "กำลังเจรจา");

  r = await call("POST", `/api/records/${id}/comments`, { text: "   " });
  ok("ปฏิเสธคอมเมนต์ว่าง (400)", r.code === 400);

  r = await call("GET", `/api/records/${id}`);
  ok("GET /api/records/:id", r.code === 200 && r.json.id === id);

  r = await call("GET", "/api/records/does-not-exist");
  ok("GET ระเบียนที่ไม่มี (404)", r.code === 404);

  r = await call("DELETE", `/api/records/${id}`);
  ok("DELETE /api/records/:id", r.code === 200);
  r = await call("GET", `/api/records/${id}`);
  ok("ลบแล้วหาไม่เจอ (404)", r.code === 404);

  /* static + security */
  const css = await fetch(B + "/css/app.css");
  ok("serve /css/app.css", css.status === 200);
  const seed = await fetch(B + "/shared/seed.js");
  ok("serve /shared/seed.js", seed.status === 200);

  const t1 = await rawGet("/..%2f..%2fetc/passwd");
  ok("ป้องกัน path traversal (encoded ..)", t1.code !== 200, "status=" + t1.code);
  const t2 = await rawGet("/..%2fserver.js");
  ok("ป้องกัน path traversal ขึ้นไดเรกทอรีแม่", t2.code !== 200, "status=" + t2.code);
  const t3 = await rawGet("/%2e%2e/%2e%2e/package.json");
  ok("URL-encoded dot segment ถูก normalize ไม่หลุด ROOT", t3.code === 200 && t3.body.includes("cmr-base"), "status=" + t3.code);

  const bad = await call("GET", "/api/nope");
  ok("route ที่ไม่มี (404)", bad.code === 404);
} catch (e) {
  failed++;
  console.error("✗ เกิดข้อผิดพลาด: " + e.message);
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
