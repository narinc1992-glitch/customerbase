/* ============================================================
   CMR Base — ชั้นเก็บข้อมูลแบบสลับได้ (Storage adapter)
   - ApiStore    : คุยกับ REST API ของ server.js (SQLite)
   - LocalStore : เก็บใน localStorage ของเบราว์เซอร์
   ทั้งสองตัวมี interface เดียวกัน จึงสลับได้โดยไม่ต้องแก้ UI
   ============================================================ */

const STORAGE_KEY = "cmr_db_v1";

function newId(prefix = "rec") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------- Local (localStorage) ---------------- */
function createLocalStore() {
  let db = null;

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) { console.warn("โหลดข้อมูล localStorage ไม่สำเร็จ", e); }
    if (!db || !Array.isArray(db.records) || !db.schema) {
      db = { schema: clone(CMRSeed.DEFAULT_SCHEMA), records: CMRSeed.makeRecords() };
      persist();
    }
    return db;
  }

  return {
    kind: "local",
    label: "localStorage (เบราว์เซอร์)",
    async init() { return load(); },
    async getSchema() { return load().schema; },
    async saveSchema(schema) { db.schema = schema; persist(); return schema; },
    async listRecords() { return load().records; },
    async getRecord(id) { return load().records.find((r) => r.id === id) || null; },
    async createRecord(values) {
      const now = Date.now();
      const rec = {
        id: newId(),
        values,
        created_at: now,
        updated_at: now,
        activities: [{ id: newId("a"), type: "create", text: "สร้างระเบียน", author: "ฉัน", at: now }]
      };
      db.records.unshift(rec);
      persist();
      return rec;
    },
    async updateRecord(id, values) {
      const rec = db.records.find((r) => r.id === id);
      if (!rec) throw new Error("ไม่พบระเบียน " + id);
      const changed = Object.keys(values).filter((k) => JSON.stringify(rec.values[k]) !== JSON.stringify(values[k]));
      rec.values = { ...rec.values, ...values };
      rec.updated_at = Date.now();
      if (changed.length) {
        rec.activities.push({
          id: newId("a"), type: "update",
          text: "แก้ไขฟิลด์: " + changed.map((k) => fieldLabel(db.schema, k)).join(", "),
          author: "ฉัน", at: rec.updated_at
        });
      }
      persist();
      return rec;
    },
    async deleteRecord(id) {
      db.records = db.records.filter((r) => r.id !== id);
      persist();
    },
    async addComment(id, text) {
      const rec = db.records.find((r) => r.id === id);
      if (!rec) throw new Error("ไม่พบระเบียน " + id);
      const at = Date.now();
      rec.activities.push({ id: newId("a"), type: "comment", text, author: "ฉัน", at });
      rec.updated_at = at;
      persist();
      return rec;
    },
    async setStatus(id, status) {
      const rec = db.records.find((r) => r.id === id);
      if (!rec) throw new Error("ไม่พบระเบียน " + id);
      const at = Date.now();
      const old = rec.values.status;
      rec.values.status = status;
      rec.updated_at = at;
      rec.activities.push({
        id: newId("a"), type: "status",
        text: `เปลี่ยนสถานะ: ${old || "—"} → ${status}`, author: "ฉัน", at
      });
      persist();
      return rec;
    },
    async reset() {
      db = { schema: clone(CMRSeed.DEFAULT_SCHEMA), records: CMRSeed.makeRecords() };
      persist();
      return db;
    }
  };
}

/* ---------------- API (server.js + SQLite) ---------------- */
function createApiStore() {
  /* ใช้ apiFetch จาก js/auth.js เพื่อให้ได้ข้อความ error ภาษาไทย
     และถ้าเซิร์ฟเวอร์ตอบ 401 จะสลับไปหน้า Login ให้อัตโนมัติ */
  const req = (method, path, body) => apiFetch(method, path, body);

  return {
    kind: "api",
    label: "REST API + SQLite (เซิร์ฟเวอร์)",
    async init() {
      const [schema, records] = await Promise.all([
        req("GET", "/api/app"),
        req("GET", "/api/records")
      ]);
      return { schema, records };
    },
    async getSchema() { return req("GET", "/api/app"); },
    async saveSchema(schema) { return req("PUT", "/api/app", { schema }); },
    async listRecords() { return req("GET", "/api/records"); },
    async getRecord(id) { return req("GET", "/api/records/" + encodeURIComponent(id)); },
    async createRecord(values) { return req("POST", "/api/records", { values }); },
    async updateRecord(id, values) { return req("PUT", "/api/records/" + encodeURIComponent(id), { values }); },
    async deleteRecord(id) { return req("DELETE", "/api/records/" + encodeURIComponent(id)); },
    async addComment(id, text) { return req("POST", "/api/records/" + encodeURIComponent(id) + "/comments", { text }); },
    async setStatus(id, status) { return req("POST", "/api/records/" + encodeURIComponent(id) + "/status", { status }); },
    async reset() { return req("POST", "/api/reset"); }
  };
}

/* ---------------- เลือก storage อัตโนมัติ ---------------- */
async function detectStore() {
  const forced = new URLSearchParams(location.search).get("storage");
  if (forced === "local") return createLocalStore();
  if (forced === "api") return createApiStore();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("/api/health", { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok) return createApiStore();
    }
  } catch (e) { /* ไม่มีเซิร์ฟเวอร์ → ใช้ localStorage */ }
  return createLocalStore();
}

/* ---------------- helpers ---------------- */
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function fieldLabel(schema, key) {
  const f = (schema.fields || []).find((x) => x.key === key);
  return f ? f.label : key;
}
