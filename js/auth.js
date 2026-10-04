/* ============================================================
   CMR Base — ระบบผู้ใช้/สิทธิ์ (ฝั่ง client)
   - apiFetch: เรียก REST API พร้อมตรวจ 401 อัตโนมัติ
   - Auth: me / login / register / logout / จัดการผู้ใช้
   - Auth.perms: แปลงบทบาทเป็นสิทธิ์สำหรับใช้ฝั่ง UI
   ============================================================ */

/** เรียก API แล้วแปลง error เป็น exception พร้อม .status
 *  ถ้าเซิร์ฟเวอร์ตอบ 401 จะยิงอีเวนต์ cmr:unauthorized เพื่อเด้งไปหน้า Login */
async function apiFetch(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    const err = new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    err.status = 0;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("cmr:unauthorized"));
    const err = new Error((data && data.error) || "ต้องเข้าสู่ระบบ");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || "คำขอไม่สำเร็จ (HTTP " + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

const Auth = {
  user: null,

  /* ---------- session ---------- */
  async me() {
    try {
      const data = await apiFetch("GET", "/api/auth/me");
      Auth.user = data.user || null;
    } catch (e) {
      if (e.status !== 401) console.warn("โหลดข้อมูลผู้ใช้ไม่สำเร็จ", e);
      Auth.user = null;
    }
    return Auth.user;
  },

  async login(username, password) {
    const data = await apiFetch("POST", "/api/auth/login", { username, password });
    Auth.user = data.user;
    return data.user;
  },

  /** บัญชีแรกที่สมัครจะได้ role = admin อัตโนมัติ */
  async register({ username, display_name, email, password }) {
    const data = await apiFetch("POST", "/api/auth/register", { username, display_name, email, password });
    Auth.user = data.user;
    return data;
  },

  async logout() {
    try { await apiFetch("POST", "/api/auth/logout"); } catch { /* ไม่สำคัญ */ }
    Auth.user = null;
  },

  /* ---------- จัดการผู้ใช้ (admin) ---------- */
  listUsers() { return apiFetch("GET", "/api/users"); },
  createUser(payload) { return apiFetch("POST", "/api/users", payload); },
  updateUser(id, patch) { return apiFetch("PATCH", "/api/users/" + encodeURIComponent(id), patch); },
  deleteUser(id) { return apiFetch("DELETE", "/api/users/" + encodeURIComponent(id)); },

  /* ---------- สิทธิ์ฝั่ง UI (ตรงกับฝั่์เซิร์ฟเวอร์) ---------- */
  perms(user = Auth.user) {
    const u = user || null;
    const isAdmin = !!u && u.role === "admin";
    const canWrite = !!u && u.role !== "viewer";
    return {
      loggedIn: !!u,
      role: u ? u.role : null,
      isAdmin,
      canWrite,              // เพิ่ม/แก้ไข/คอมเมนต์/เปลี่ยนสถานะ
      canExport: !!u,        // ทุกบทบาทดู/ส่งออกได้
      canImport: canWrite,
      canManageFields: isAdmin,
      canManageUsers: isAdmin,
      canReset: isAdmin
    };
  },

  /** member แก้ไขได้เฉพาะระเบียนที่ตัวเองสร้าง หรือเป็น "ผู้รับผิดชอบ" */
  canEditRecord(rec, user = Auth.user) {
    if (!user || !rec) return false;
    if (user.role === "admin") return true;
    if (user.role === "viewer") return false;
    if (rec.creator_id && rec.creator_id === user.id) return true;
    return (rec.values && rec.values.owner) === user.display_name;
  },

  /** ลบได้เฉพาะ admin หรือคนสร้าง */
  canDeleteRecord(rec, user = Auth.user) {
    if (!user || !rec) return false;
    if (user.role === "admin") return true;
    if (user.role === "viewer") return false;
    return !!rec.creator_id && rec.creator_id === user.id;
  }
};
