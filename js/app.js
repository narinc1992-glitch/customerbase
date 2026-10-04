/* ============================================================
   CMR Base — แอปหลัก (router + views)
   ============================================================ */

let store = null;
let state = {
  schema: null,
  records: [],
  user: null,
  route: { name: "dashboard" },
  view: localStorage.getItem("cmr_view") || "list",
  search: "",
  filters: { status: "", owner: "" },
  sort: { key: "__updated", dir: "desc" },
  dragId: null
};

const $ = (sel, root) => (root || document).querySelector(sel);

/* ================= boot ================= */
async function boot() {
  showLoading();
  try {
    store = await detectStore();
    updateStorageBadge();
    /* โหมด API: ต้องรู้ตัวผู้ใช้ก่อน เพราะ endpoint ข้อมูลถูกคุมด้วยสิทธิ์ */
    if (store.kind === "api") state.user = await Auth.me();
    if (store.kind !== "api" || state.user) await loadData();
  } catch (e) {
    console.error(e);
    toast("เปิดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  hideLoading();
  bindSidebar();
  window.addEventListener("hashchange", route);
  window.addEventListener("cmr:unauthorized", () => {
    if (!state.user) return;
    state.user = null;
    state.schema = null;
    state.records = [];
    toast("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "error");
    go("#/login");
  });
  route();
}

/** โหลด schema + ระเบียน (เรียกหลัง login สำเร็จด้วย) */
async function loadData() {
  const db = await store.init();
  state.schema = db.schema;
  state.records = db.records;
}

function updateStorageBadge() {
  const badge = $("#storage-badge");
  const label = $("#storage-label");
  if (!store) return;
  badge.classList.remove("api", "local");
  badge.classList.add(store.kind);
  label.textContent = store.kind === "api" ? "API + SQLite" : "localStorage";
  badge.title = store.label;
}

async function reload() {
  state.schema = await store.getSchema();
  state.records = await store.listRecords();
}

function bindSidebar() {
  $("#btn-export-side").addEventListener("click", exportCsv);
  $("#btn-import-side").addEventListener("click", () => $("#csv-file-input").click());
  $("#btn-logout").addEventListener("click", async () => {
    await Auth.logout();
    state.user = null;
    state.schema = null;
    state.records = [];
    toast("ออกจากระบบแล้ว", "success");
    go("#/login");
  });
  $("#btn-reset").addEventListener("click", async () => {
    const ok = await confirmDialog(
      "การดำเนินการนี้จะลบข้อมูลทั้งหมดและแทนที่ด้วยข้อมูลตัวอย่าง ดำเนินการต่อหรือไม่?",
      { danger: true, okText: "ล้างและเติมข้อมูลตัวอย่าง" }
    );
    if (!ok) return;
    showLoading();
    await store.reset();
    await reload();
    hideLoading();
    toast("เติมข้อมูลตัวอย่างเรียบร้อย", "success");
    route();
  });

  const fileInput = $("#csv-file-input");
  fileInput.addEventListener("change", async () => {
    if (fileInput.files && fileInput.files[0]) await handleCsvFile(fileInput.files[0]);
    fileInput.value = "";
  });
}

/* ================= router ================= */
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "dashboard" };
  if (parts[0] === "records") return { name: "records" };
  if (parts[0] === "pipeline") return { name: "pipeline" };
  if (parts[0] === "record" && parts[1]) return { name: "detail", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "form") return { name: "form", id: parts[1] === "new" ? null : decodeURIComponent(parts[1]) };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "users") return { name: "users" };
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "register") return { name: "register" };
  return { name: "dashboard" };
}

/* ================= สิทธิ์ฝั่ง UI ================= */
function perms() {
  /* โหมด localStorage ไม่มีเซิร์ฟเวอร์ → ใช้งานได้เต็มรูปแบบ (ยกเว้นจัดการผู้ใช้) */
  if (store && store.kind === "local") {
    return {
      loggedIn: true, role: "admin", offline: true, isAdmin: true, canWrite: true,
      canExport: true, canImport: true, canManageFields: true,
      canManageUsers: false, canReset: true
    };
  }
  return { offline: false, ...Auth.perms(state.user) };
}

function isAuthRoute() {
  return state.route.name === "login" || state.route.name === "register";
}

/** สิทธิ์แก้ไข/ลบรายระเบียน (ตรงกับฝั่งเซิร์ฟเวอร์, โหมดออฟไลน์ให้เต็มสิทธิ์) */
function canEditUI(rec) {
  if (store && store.kind === "local") return true;
  return perms().canWrite && Auth.canEditRecord(rec, state.user);
}
function canDeleteUI(rec) {
  if (store && store.kind === "local") return true;
  return perms().canWrite && Auth.canDeleteRecord(rec, state.user);
}

function route() {
  state.route = parseRoute();
  const p = perms();
  const apiMode = !!store && store.kind === "api";

  /* --- ยามหน้า Login/Register --- */
  if (apiMode && !p.loggedIn && !isAuthRoute()) { go("#/login"); return; }
  if (apiMode && p.loggedIn && isAuthRoute()) { go("#/dashboard"); return; }

  /* --- ยามสิทธิ์ --- */
  if (state.route.name === "users" && !p.canManageUsers) { toast("ต้องเป็นผู้ดูแลระบบ", "error"); go("#/dashboard"); return; }
  if (state.route.name === "settings" && !p.canManageFields) { toast("ต้องเป็นผู้ดูแลระบบเท่านั้น", "error"); go("#/dashboard"); return; }
  if (state.route.name === "form" && !p.canWrite) { toast("บัญชีผู้ชม (viewer) เพิ่ม/แก้ไขไม่ได้", "error"); go("#/records"); return; }

  document.querySelectorAll(".nav-item").forEach((el) => {
    const map = { detail: "records", form: "records" };
    const key = map[state.route.name] || state.route.name;
    el.classList.toggle("active", el.dataset.route === key);
  });
  updateChrome();
  render();
}

/** อัปเดตส่วนที่อยู่นอก area ที่ render ใหม่ (nav, กล่องผู้ใช้, ปุ่ม sidebar) */
function updateChrome() {
  const p = perms();
  const apiMode = !!store && store.kind === "api";

  const navUsers = $("#nav-users");
  if (navUsers) navUsers.hidden = !(apiMode && p.canManageUsers);
  const navSettings = $("#nav-settings");
  if (navSettings) navSettings.hidden = !p.canManageFields;

  const userBox = $("#user-box");
  if (userBox) {
    userBox.hidden = !apiMode;
    if (apiMode && state.user) {
      $("#user-name").textContent = state.user.display_name;
      $("#user-role").textContent = state.user.role_label;
      $("#user-role").className = "role-pill role-" + state.user.role;
      $("#user-avatar").textContent = initials(state.user.display_name);
    }
  }

  const imp = $("#btn-import-side");
  if (imp) imp.hidden = !p.canImport;
  const rst = $("#btn-reset");
  if (rst) rst.hidden = !p.canReset;
}

function render() {
  const main = $("#main");
  fill(main);
  document.body.classList.toggle("auth-mode", isAuthRoute());
  switch (state.route.name) {
    case "login": main.append(viewLogin()); break;
    case "register": main.append(viewRegister()); break;
    case "dashboard": main.append(viewDashboard()); break;
    case "records":
      main.append(viewRecords());
      renderRecordsBody();
      break;
    case "pipeline": main.append(viewPipeline()); break;
    case "detail": main.append(viewDetail(state.route.id)); break;
    case "form": main.append(viewForm(state.route.id)); break;
    case "settings": main.append(viewSettings()); break;
    case "users": main.append(viewUsers()); break;
    default: main.append(viewDashboard());
  }
  window.scrollTo({ top: 0 });
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ================= shared bits ================= */
function topbar({ title, sub, right = [], left = [] }) {
  return h("div", { class: "topbar" },
    left,
    h("div", {},
      h("h1", {}, title),
      sub ? h("p", { class: "sub" }, sub) : null
    ),
    h("div", { class: "topbar-spacer" }),
    right
  );
}

function fieldByKey(key) {
  return (state.schema.fields || []).find((f) => f.key === key);
}

function statusOptions() {
  const f = state.schema.fields.find((f) => f.type === "status");
  return (f && f.options) || [];
}

function optionsFor(key) {
  const f = fieldByKey(key);
  return (f && f.options) || [];
}

function displayValue(field, value) {
  if (value === "" || value === null || value === undefined) return h("span", { class: "muted" }, "—");
  switch (field.type) {
    case "number":
      return fmtNumber(value);
    case "status":
      return statusPill(value, state.schema);
    case "select":
      return h("span", { class: "pill s-other" }, String(value));
    case "checkbox":
      return Array.isArray(value)
        ? h("span", {}, value.map((v) => h("span", { class: "tag" }, v)))
        : h("span", { class: "muted" }, "—");
    case "email":
      return h("a", { href: "mailto:" + value, onclick: (e) => e.stopPropagation() }, String(value));
    case "url": {
      const href = /^https?:/i.test(value) ? value : "https://" + value;
      return h("a", { href: href, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, String(value));
    }
    case "phone":
      return h("a", { href: "tel:" + String(value).replace(/\s/g, ""), onclick: (e) => e.stopPropagation() }, String(value));
    case "date":
      return fmtDate(value);
    default:
      return String(value);
  }
}

function recordTitle(rec) {
  const f = state.schema.fields.find((x) => x.key === "company") || state.schema.fields[0];
  return rec.values[f.key] || "(ไม่มีชื่อ)";
}

/* ================= filtering ================= */
function visibleRecords() {
  const q = state.search.trim().toLowerCase();
  let list = state.records.filter((rec) => {
    if (state.filters.status && rec.values.status !== state.filters.status) return false;
    if (state.filters.owner && rec.values.owner !== state.filters.owner) return false;
    if (q) {
      const hay = Object.entries(rec.values)
        .map(([k, v]) => Array.isArray(v) ? v.join(" ") : String(v ?? ""))
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { key, dir } = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let va, vb;
    if (key === "__updated") { va = a.updated_at; vb = b.updated_at; }
    else { va = a.values[key]; vb = b.values[key]; }
    if (typeof va === "number" || typeof vb === "number") {
      const na = Number(va) || 0, nb = Number(vb) || 0;
      return (na - nb) * mult;
    }
    if (Array.isArray(va)) va = va.join(",");
    if (Array.isArray(vb)) vb = vb.join(",");
    return String(va || "").localeCompare(String(vb || ""), "th") * mult;
  });
  return list;
}

/* ================= dashboard ================= */
function viewDashboard() {
  const recs = state.records;
  const wonStatuses = ["ปิดการขาย", "ลูกค้าประจำ"];
  const valueOf = (r) => Number(r.values.deal_value) || 0;
  const totalValue = recs.reduce((s, r) => s + valueOf(r), 0);
  const wonValue = recs.filter((r) => wonStatuses.includes(r.values.status)).reduce((s, r) => s + valueOf(r), 0);
  const today = new Date().toISOString().slice(0, 10);
  const soon = recs.filter((r) => r.values.next_followup && r.values.next_followup >= today)
    .sort((a, b) => a.values.next_followup.localeCompare(b.values.next_followup));

  const kpis = h("div", { class: "kpi-grid" },
    kpi("ลูกค้าทั้งหมด", fmtNumber(recs.length), "ระเบียนในระบบ", ""),
    kpi("มูลค่าดีลรวม", fmtMoney(totalValue), "ทุกสถานะ", "cyan"),
    kpi("ดีลที่ปิดแล้ว", fmtMoney(wonValue), recs.filter((r) => wonStatuses.includes(r.values.status)).length + " ราย", "green"),
    kpi("นัดหมายที่จะถึง", fmtNumber(soon.length), "ภายใน 90 วัน", "amber")
  );

  /* จำนวนตามสถานะ */
  const byStatus = statusOptions().map((s) => {
    const rows = recs.filter((r) => r.values.status === s);
    return { label: s, count: rows.length, value: rows.reduce((sum, r) => sum + valueOf(r), 0) };
  });
  const maxCount = Math.max(1, ...byStatus.map((b) => b.count));

  const statusCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "สถิติตามสถานะ"),
    h("div", { class: "card-body" },
      byStatus.map((b) => h("div", { class: "bar-row" },
        h("div", { class: "bar-label" }, b.label),
        h("div", { class: "bar-track" },
          h("div", { class: "bar-fill", style: { width: (b.count / maxCount * 100) + "%" } })),
        h("div", { class: "bar-value" }, b.count)
      )),
      h("div", { class: "small muted mt16" },
        "มูลค่าดีลรวมตามสถานะ: " + byStatus.map((b) => `${b.label} ${fmtMoney(b.value)}`).join(" · "))
    )
  );

  /* ตามผู้รับผิดชอบ */
  const owners = optionsFor("owner");
  const ownerRows = owners.map((o) => {
    const rows = recs.filter((r) => r.values.owner === o);
    return h("div", { class: "list-item" },
      h("div", { class: "avatar" }, initials(o)),
      h("div", { class: "li-main" },
        h("div", { class: "li-title" }, o),
        h("div", { class: "li-sub" }, rows.length + " ราย · " + fmtMoney(rows.reduce((s, r) => s + valueOf(r), 0)))
      )
    );
  });

  const ownerCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "งานของแต่ละคน"),
    h("div", { class: "card-body" }, ownerRows.length ? ownerRows : h("p", { class: "muted mb0" }, "ยังไม่มีข้อมูล"))
  );

  /* อัปเดตล่าสุด */
  const recent = [...recs].sort((a, b) => b.updated_at - a.updated_at).slice(0, 7);
  const recentCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "อัปเดตล่าสุด"),
    h("div", { class: "card-body" },
      recent.map((r) => h("div", { class: "list-item", style: { cursor: "pointer" }, onclick: () => go("#/record/" + r.id) },
        h("div", { class: "avatar" }, initials(r.values.contact_name || recordTitle(r))),
        h("div", { class: "li-main" },
          h("div", { class: "li-title" }, recordTitle(r)),
          h("div", { class: "li-sub" }, relTime(r.updated_at) + " · " + (r.values.owner || "ไม่ระบุผู้รับผิดชอบ"))
        ),
        statusPill(r.values.status, state.schema)
      ))
    )
  );

  /* นัดหมายถัดไป */
  const followCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "นัดหมายครั้งถัดไป"),
    h("div", { class: "card-body" },
      soon.length
        ? soon.slice(0, 7).map((r) => h("div", { class: "list-item", style: { cursor: "pointer" }, onclick: () => go("#/record/" + r.id) },
            h("div", { class: "li-main" },
              h("div", { class: "li-title" }, recordTitle(r)),
              h("div", { class: "li-sub" }, "ติดตาม " + fmtDate(r.values.next_followup))
            ),
            h("span", { class: "pill s-other" }, r.values.priority || "—")
          ))
        : h("p", { class: "muted mb0" }, "ยังไม่มีนัดหมายที่กำหนด")
    )
  );

  return h("div", {},
    topbar({
      title: "แดชบอร์ด",
      sub: "ภาพรวมข้อมูลลูกค้า · อัปเดต " + fmtDateTime(Date.now()),
      right: [
        perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
      ]
    }),
    h("div", { class: "page" },
      kpis,
      h("div", { class: "dash-grid" },
        h("div", {}, statusCard, h("div", { class: "mt16" }, recentCard)),
        h("div", {}, ownerCard, h("div", { class: "mt16" }, followCard))
      )
    )
  );
}

function kpi(label, value, sub, tone) {
  return h("div", { class: "kpi " + tone },
    h("div", { class: "k-label" }, label),
    h("div", { class: "k-value" }, value),
    h("div", { class: "k-sub" }, sub)
  );
}

/* ================= records list / grid ================= */
function viewRecords() {
  const controls = h("div", { class: "row" },
    h("div", { class: "search-box" },
      h("input", {
        type: "search", placeholder: "ค้นหาลูกค้า, อีเมล, เบอร์โทร…",
        value: state.search,
        oninput: debounce((e) => { state.search = e.target.value; renderRecordsBody(); }, 200)
      })
    ),
    selectControl(state.filters.status, ["ทุกสถานะ", ...statusOptions()], (v) => {
      state.filters.status = v === "ทุกสถานะ" ? "" : v; renderRecordsBody();
    }),
    selectControl(state.filters.owner, ["ผู้รับผิดชอบทั้งหมด", ...optionsFor("owner")], (v) => {
      state.filters.owner = v.startsWith("ผู้รับผิดชอบ") ? "" : v; renderRecordsBody();
    }),
    h("div", { class: "seg" },
      h("button", { class: state.view === "list" ? "active" : "", onclick: () => setView("list") }, "รายการ"),
      h("button", { class: state.view === "grid" ? "active" : "", onclick: () => setView("grid") }, "การ์ด")
    )
  );

  return h("div", {},
    topbar({
      title: "รายชื่อลูกค้า",
      right: [
        controls,
        h("button", { class: "btn", onclick: exportCsv }, "ส่งออก CSV"),
        perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
      ]
    }),
    h("div", { class: "page" },
      h("div", { id: "records-body" })
    )
  );
}

function setView(v) {
  state.view = v;
  localStorage.setItem("cmr_view", v);
  render();
}

function selectControl(value, options, onChange) {
  const sel = h("select", { class: "control", onchange: (e) => onChange(e.target.value) },
    options.map((o) => h("option", { value: o }, o))
  );
  sel.value = value || options[0];
  return sel;
}

function renderRecordsBody() {
  const root = $("#records-body");
  if (!root) return;
  fill(root);

  const list = visibleRecords();
  const filtering = state.search || state.filters.status || state.filters.owner;

  root.append(h("div", { class: "row spread", style: { marginBottom: "10px" } },
    h("div", { class: "muted small" },
      `แสดง ${list.length} จาก ${state.records.length} ระเบียน`),
    filtering
      ? h("button", {
          class: "btn sm",
          onclick: () => { state.search = ""; state.filters = { status: "", owner: "" }; render(); }
        }, "ล้างตัวกรอง")
      : null
  ));

  if (!list.length) {
    root.append(h("div", { class: "card empty" },
      h("div", { class: "e-ico" }, "🔍"),
      h("h3", {}, filtering ? "ไม่พบระเบียนที่ค้นหา" : "ยังไม่มีระเบียนลูกค้า"),
      h("p", {}, filtering ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "เริ่มต้นด้วยการเพิ่มระเบียนแรก หรือนำเข้าจากไฟล์ CSV"),
      perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
    ));
    return;
  }

  if (state.view === "grid") root.append(renderGrid(list));
  else root.append(renderTable(list));
}

function tableColumns() {
  return [
    ...state.schema.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, field: f })),
    { key: "__updated", label: "อัปเดตล่าสุด", type: "system" }
  ];
}

function renderTable(list) {
  const cols = tableColumns();
  const wrap = h("div", { class: "card table-wrap" });
  const table = h("table", { class: "data" });

  const thead = h("thead", {}, h("tr", {},
    cols.map((c) => {
      const active = state.sort.key === c.key;
      return h("th", {
        onclick: () => {
          if (active) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
          else state.sort = { key: c.key, dir: "asc" };
          renderRecordsBody();
        }
      }, c.label, active ? h("span", { class: "arrow" }, state.sort.dir === "asc" ? " ▲" : " ▼") : null);
    })
  ));

  const tbody = h("tbody", {},
    list.map((rec) => h("tr", { onclick: () => go("#/record/" + rec.id) },
      cols.map((c) => {
        if (c.key === "__updated") {
          return h("td", { class: "muted small" }, relTime(rec.updated_at));
        }
        const isPrimary = c.key === "company";
        const inner = h("span", { class: "cell" }, displayValue(c.field, rec.values[c.key]));
        return h("td", { class: (c.type === "number" ? "num " : "") + (isPrimary ? "primary-cell" : "") }, inner);
      })
    ))
  );

  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderGrid(list) {
  return h("div", { class: "grid-view" },
    list.map((rec) => h("div", { class: "record-card", onclick: () => go("#/record/" + rec.id) },
      h("div", { class: "rc-title" }, recordTitle(rec)),
      h("div", { class: "rc-code" }, rec.values.customer_code || rec.id),
      h("div", { class: "row", style: { marginBottom: "6px" } }, statusPill(rec.values.status, state.schema)),
      h("div", { class: "rc-row" }, h("span", {}, "ผู้รับผิดชอบ"), h("b", {}, rec.values.owner || "—")),
      h("div", { class: "rc-row" }, h("span", {}, "มูลค่าดีล"), h("b", {}, fmtMoney(rec.values.deal_value))),
      h("div", { class: "rc-row" }, h("span", {}, "นัดครั้งถัดไป"), h("b", {}, rec.values.next_followup ? fmtDate(rec.values.next_followup) : "—"))
    ))
  );
}

/* ================= pipeline (kanban) ================= */
function viewPipeline() {
  const cols = statusOptions();
  const list = visibleRecords();

  const board = h("div", { class: "kanban" },
    cols.map((s) => {
      const rows = list.filter((r) => r.values.status === s);
      const body = h("div", { class: "kanban-col-body", dataset: { status: s } });
      rows.forEach((rec) => body.append(kanbanCard(rec)));

      const col = h("div", { class: "kanban-col" },
        h("div", { class: "kanban-col-head" },
          h("span", {}, statusPill(s, state.schema)),
          h("span", { class: "count" }, rows.length)
        ),
        body
      );

      body.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-active"); });
      body.addEventListener("dragleave", () => col.classList.remove("drop-active"));
      body.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drop-active");
        const id = state.dragId;
        if (!id) return;
        const rec = state.records.find((r) => r.id === id);
        if (!rec || rec.values.status === s) return;
        try {
          showLoading();
          await store.setStatus(id, s);
          await reload();
          hideLoading();
          toast(`ย้าย "${recordTitle(rec)}" ไปที่สถานะ ${s}`, "success");
          render();
        } catch (err) {
          hideLoading();
          toast("บันทึกไม่สำเร็จ: " + err.message, "error");
        }
      });

      return col;
    })
  );

  return h("div", {},
    topbar({
      title: "ขั้นตอนการขาย",
      sub: "ลากการ์ดไปมาระหว่างคอลัมน์เพื่อเปลี่ยนสถานะ (ลากได้เฉพาะเมื่อใช้ร่วมกับเซิร์ฟเวอร์หรือเบราว์เซอร์เครื่องเดียว)",
      right: [
        perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
      ]
    }),
    h("div", { class: "page" }, board)
  );
}

function kanbanCard(rec) {
  const card = h("div", { class: "kanban-card", draggable: "true", onclick: () => go("#/record/" + rec.id) },
    h("div", { class: "kc-title" }, recordTitle(rec)),
    h("div", { class: "kc-meta" },
      h("span", {}, rec.values.owner || "—"),
      h("span", { class: "kc-value" }, fmtMoney(rec.values.deal_value))
    ),
    h("div", { class: "kc-meta" },
      h("span", {}, rec.values.customer_code || ""),
      h("span", {}, rec.values.next_followup ? "นัด " + fmtDate(rec.values.next_followup) : "")
    )
  );
  card.addEventListener("dragstart", (e) => {
    state.dragId = rec.id;
    card.classList.add("dragging");
    try { e.dataTransfer.setData("text/plain", rec.id); e.dataTransfer.effectAllowed = "move"; } catch (err) { /* noop */ }
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    state.dragId = null;
  });
  return card;
}

/* ================= detail ================= */
function viewDetail(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) {
    return h("div", { class: "page" },
      h("div", { class: "card empty" },
        h("div", { class: "e-ico" }, "❓"),
        h("h3", {}, "ไม่พบระเบียนนี้"),
        h("p", {}, "ระเบียนอาจถูกลบไปแล้ว"),
        h("button", { class: "btn primary", onclick: () => go("#/records") }, "กลับไปที่รายชื่อ")
      )
    );
  }

  const head = topbar({
    left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "← กลับ")],
    title: recordTitle(rec),
    sub: (rec.values.customer_code ? rec.values.customer_code + " · " : "") + "อัปเดต " + fmtDateTime(rec.updated_at),
    right: [
      h("div", { class: "row" },
        canEditUI(rec) ? (() => {
          const sel = h("select", {
            class: "control",
            onchange: async (e) => {
              const v = e.target.value;
              if (!v || v === rec.values.status) return;
              try {
                showLoading();
                await store.setStatus(rec.id, v);
                await reload();
                hideLoading();
                toast("เปลี่ยนสถานะแล้ว", "success");
                render();
              } catch (err) { hideLoading(); toast(err.message, "error"); }
            }
          }, statusOptions().map((s) => h("option", { value: s }, s)));
          sel.value = rec.values.status || "";
          return sel;
        })() : null,
        canEditUI(rec) ? h("button", { class: "btn", onclick: () => go("#/form/" + rec.id) }, "แก้ไข") : null,
        canDeleteUI(rec) ? h("button", {
          class: "btn danger",
          onclick: async () => {
            const ok = await confirmDialog(`ต้องการลบระเบียน "${recordTitle(rec)}" ใช่หรือไม่?`, { danger: true, okText: "ลบ" });
            if (!ok) return;
            try {
              await store.deleteRecord(rec.id);
              await reload();
              toast("ลบระเบียนแล้ว", "success");
              go("#/records");
            } catch (err) { toast(err.message, "error"); }
          }
        }, "ลบ") : null
      )
    ]
  });

  const fieldsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลลูกค้า"),
    h("div", { class: "card-body" },
      h("div", { class: "fields-grid" },
        state.schema.fields.map((f) => h("div", { class: "field-row" },
          h("div", { class: "f-label" }, f.label),
          h("div", { class: "f-value" + (isEmpty(rec.values[f.key]) ? " empty" : "") },
            isEmpty(rec.values[f.key]) ? "—" : displayValue(f, rec.values[f.key]))
        ))
      )
    )
  );

  /* timeline */
  const timeline = h("div", { class: "timeline" });
  const renderTimeline = () => {
    fill(timeline);
    const acts = [...(rec.activities || [])].sort((a, b) => b.at - a.at);
    if (!acts.length) timeline.append(h("p", { class: "muted mb0" }, "ยังไม่มีกิจกรรม"));
    acts.forEach((a) => {
      const isComment = a.type === "comment";
      timeline.append(h("div", { class: "tl-item" + (isComment ? "" : " system") },
        h("div", { class: "avatar" }, isComment ? initials(a.author) : "•"),
        h("div", { class: "tl-body" },
          h("div", { class: "tl-head" },
            h("span", {}, h("strong", {}, a.author || "ระบบ"), " ", a.text),
            h("span", {}, fmtDateTime(a.at))
          )
        )
      ));
    });
  };
  renderTimeline();

  const ta = h("textarea", { placeholder: "พิมพ์ความคิดเห็นหรือบันทึกการติดต่อ…" });
  const activityCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ความเคลื่อนไหว & บันทึก"),
    h("div", { class: "card-body" },
      timeline,
      perms().canWrite ? h("div", { class: "comment-box" },
        ta,
        h("button", {
          class: "btn primary",
          onclick: async () => {
            const text = ta.value.trim();
            if (!text) return toast("พิมพ์ข้อความก่อนส่ง", "error");
            try {
              await store.addComment(rec.id, text);
              await reload();
              const fresh = state.records.find((r) => r.id === rec.id);
              if (fresh) rec.activities = fresh.activities;
              ta.value = "";
              renderTimeline();
              toast("บันทึกความคิดเห็นแล้ว", "success");
            } catch (err) { toast(err.message, "error"); }
          }
        }, "ส่ง")
      ) : h("p", { class: "muted small mb0" }, "บัญชีผู้ชม (viewer) อ่านอย่างเดียว ไม่สามารถเพิ่มความคิดเห็นได้")
    )
  );

  return h("div", {},
    head,
    h("div", { class: "page" },
      h("div", { class: "dash-grid" },
        h("div", {}, fieldsCard, h("div", { class: "mt16" }, activityCard)),
        h("div", {}, h("div", { class: "card" },
          h("div", { class: "card-head" }, "ข้อมูลโดยย่อ"),
          h("div", { class: "card-body" },
            summaryLine("สถานะ", statusPill(rec.values.status, state.schema)),
            summaryLine("ผู้รับผิดชอบ", rec.values.owner || "—"),
            summaryLine("มูลค่าดีล", fmtMoney(rec.values.deal_value)),
            summaryLine("ความสำคัญ", rec.values.priority || "—"),
            summaryLine("นัดครั้งถัดไป", rec.values.next_followup ? fmtDate(rec.values.next_followup) : "—"),
            summaryLine("แหล่งที่มา", rec.values.source || "—"),
            summaryLine("สร้างโดย", rec.creator_name || "ระบบ"),
            summaryLine("สร้างเมื่อ", fmtDateTime(rec.created_at)),
            summaryLine("ระเบียน ID", h("span", { class: "mono small" }, rec.id))
          )
        ))
      )
    )
  );
}

function summaryLine(label, value) {
  return h("div", { class: "field-row" },
    h("div", { class: "f-label" }, label),
    h("div", { class: "f-value" }, value)
  );
}

function isEmpty(v) {
  return v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length);
}

/* ================= form (create / edit) ================= */
function viewForm(id) {
  const editing = !!id;
  const rec = editing ? state.records.find((r) => r.id === id) : null;
  if (editing && !rec) return viewDetail(id);
  if (editing && !canEditUI(rec)) {
    setTimeout(() => toast("คุณไม่มีสิทธิ์แก้ไขระเบียนนี้", "error"), 50);
    return viewDetail(id);
  }

  const values = {};
  state.schema.fields.forEach((f) => {
    let v = rec ? rec.values[f.key] : "";
    if (v === undefined || v === null) v = "";
    if (f.type === "checkbox" && !Array.isArray(v)) v = v ? [v] : [];
    values[f.key] = v;
  });
  if (!editing && !values.status) values.status = "Lead";

  const inputs = {};
  const grid = h("div", { class: "form-grid" },
    state.schema.fields.map((f) => {
      const el = buildInput(f, values[f.key]);
      inputs[f.key] = el;
      const wrap = h("div", { class: "form-field" + (f.type === "longtext" ? " full" : "") },
        h("label", {}, f.label, f.required ? h("span", { class: "req" }, "*") : null),
        el,
        h("div", { class: "err-msg", style: { display: "none" } })
      );
      return wrap;
    })
  );

  const formCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, editing ? "แก้ไขระเบียน" : "เพิ่มระเบียนใหม่"),
    h("div", { class: "card-body" }, grid,
      h("div", { class: "form-actions" },
        h("button", { class: "btn", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: submit }, editing ? "บันทึกการแก้ไข" : "สร้างระเบียน")
      )
    )
  );

  function setError(fieldEl, msg) {
    const input = fieldEl.querySelector("input, select, textarea");
    const err = fieldEl.querySelector(".err-msg");
    if (msg) {
      fieldEl.classList.add("has-err");
      if (input) input.classList.add("err");
      if (err) { err.textContent = msg; err.style.display = "block"; }
    } else {
      if (input) input.classList.remove("err");
      if (err) err.style.display = "none";
    }
  }

  async function submit() {
    const out = {};
    let firstBad = null;

    state.schema.fields.forEach((f) => {
      const fieldEl = inputs[f.key].closest(".form-field");
      let v;
      if (f.type === "checkbox") {
        v = Array.from(fieldEl.querySelectorAll("input:checked")).map((i) => i.value);
      } else {
        v = inputs[f.key].value;
        if (typeof v === "string") v = v.trim();
      }
      let err = "";
      if (f.required && isEmpty(v)) err = "จำเป็นต้องกรอก";
      if (!err && v !== "" && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) err = "รูปแบบอีเมลไม่ถูกต้อง";
      if (!err && v !== "" && f.type === "number" && isNaN(Number(v))) err = "ต้องเป็นตัวเลข";
      setError(fieldEl, err);
      if (err && !firstBad) firstBad = fieldEl;
      if (!err && f.type === "number" && v !== "") v = Number(v);
      out[f.key] = v;
    });

    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      const inp = firstBad.querySelector("input, select, textarea");
      if (inp) inp.focus();
      toast("กรุณาตรวจสอบฟิลด์ที่มีเครื่องหมาย *", "error");
      return;
    }

    try {
      showLoading();
      const saved = editing ? await store.updateRecord(id, out) : await store.createRecord(out);
      await reload();
      hideLoading();
      toast(editing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มระเบียนแล้ว", "success");
      go("#/record/" + saved.id);
    } catch (e) {
      hideLoading();
      toast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  }

  return h("div", {},
    topbar({
      left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "← กลับ")],
      title: editing ? "แก้ไขระเบียน" : "เพิ่มระเบียนใหม่",
      sub: state.schema.name
    }),
    h("div", { class: "page" },
      h("div", { style: { maxWidth: "1100px" } }, formCard)
    )
  );
}

function buildInput(field, value) {
  const common = { id: "f_" + field.key };
  switch (field.type) {
    case "longtext": {
      const el = h("textarea", { ...common, rows: "3" });
      el.value = value || "";
      return el;
    }
    case "select":
    case "status": {
      const el = h("select", { ...common },
        h("option", { value: "" }, "— เลือก —"),
        (field.options || []).map((o) => h("option", { value: o }, o))
      );
      el.value = value || "";
      return el;
    }
    case "checkbox": {
      const checked = Array.isArray(value) ? value : [];
      return h("div", { class: "checks", ...common },
        (field.options || []).map((o) =>
          h("label", {},
            h("input", { type: "checkbox", value: o, checked: checked.includes(o) }), " " + o
          )
        )
      );
    }
    case "number": {
      const el = h("input", { ...common, type: "number", step: "any" });
      el.value = value === 0 ? 0 : (value || "");
      return el;
    }
    case "date": {
      const el = h("input", { ...common, type: "date" });
      el.value = value || "";
      return el;
    }
    case "email": {
      const el = h("input", { ...common, type: "email", placeholder: "name@example.com" });
      el.value = value || "";
      return el;
    }
    case "phone": {
      const el = h("input", { ...common, type: "tel", placeholder: "08X-XXX-XXXX" });
      el.value = value || "";
      return el;
    }
    case "url": {
      const el = h("input", { ...common, type: "url", placeholder: "https://" });
      el.value = value || "";
      return el;
    }
    default: {
      const el = h("input", { ...common, type: "text" });
      el.value = value || "";
      return el;
    }
  }
}

/* ================= field settings ================= */
function viewSettings() {
  const rows = state.schema.fields.map((f, i) => h("div", { class: "field-def-row" },
    h("div", { class: "drag-handle" }, "⠿"),
    h("div", {},
      h("div", { style: { fontWeight: "600" } }, f.label, f.required ? h("span", { class: "req", style: { color: "var(--danger)" } }, " *") : null),
      h("div", { class: "fd-key" }, f.key)
    ),
    h("div", { class: "fd-type" }, (window.CMRSeed.FIELD_TYPES[f.type] || f.type) + ((f.options || []).length ? ` (${f.options.length} ตัวเลือก)` : "")),
    h("div", { class: "fd-type" }, f.system ? "ระบบ" : "กำหนดเอง"),
    h("div", { class: "fd-actions" },
      h("button", { class: "icon-btn", title: "เลื่อนขึ้น", disabled: i === 0 || f.system, onclick: () => moveField(i, -1) }, "↑"),
      h("button", { class: "icon-btn", title: "เลื่อนลง", disabled: i === state.schema.fields.length - 1 || f.system, onclick: () => moveField(i, 1) }, "↓"),
      h("button", { class: "icon-btn", title: "แก้ไข", onclick: () => openFieldModal(f) }, "✎"),
      h("button", { class: "icon-btn danger", title: "ลบ", disabled: f.system, onclick: () => removeField(f) }, "🗑")
    )
  ));

  return h("div", {},
    topbar({
      title: "ตั้งค่าฟิลด์",
      sub: "กำหนดรูปแบบข้อมูลลูกค้าได้เอง เหมือนการตั้งค่า App บน kintone",
      right: [
        h("button", { class: "btn primary", onclick: () => openFieldModal(null) }, "+ เพิ่มฟิลด์")
      ]
    }),
    h("div", { class: "page" },
      h("div", { class: "card" },
        h("div", { class: "card-head" },
          "ฟิลด์ทั้งหมด (" + state.schema.fields.length + ")",
          h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
            "ฟิลด์สถานะใช้เป็นคอลัมน์ของมุมมองขั้นตอนการขาย")
        ),
        rows
      ),
      h("div", { class: "card mt16" },
        h("div", { class: "card-head" }, "การจัดการข้อมูล"),
        h("div", { class: "card-body row" },
          h("button", { class: "btn", onclick: exportCsv }, "ส่งออก CSV ทั้งหมด"),
          perms().canImport ? h("button", { class: "btn", onclick: () => $("#csv-file-input").click() }, "นำเข้า CSV") : null,
          h("button", { class: "btn", onclick: downloadTemplate }, "ดาวน์โหลดแม่แบบ CSV"),
          perms().canReset ? h("button", {
            class: "btn danger",
            onclick: async () => {
              const ok = await confirmDialog("ล้างข้อมูลทั้งหมดแล้วเติมข้อมูลตัวอย่างใหม่?", { danger: true, okText: "ยืนยัน" });
              if (!ok) return;
              await store.reset();
              await reload();
              toast("รีเซ็ตข้อมูลแล้ว", "success");
              route();
            }
          }, "รีเซ็ตข้อมูลตัวอย่าง") : null
        )
      )
    )
  );
}

async function moveField(index, delta) {
  const fields = state.schema.fields;
  const target = index + delta;
  if (target < 0 || target >= fields.length) return;
  if (fields[index].system || fields[target].system) return;
  [fields[index], fields[target]] = [fields[target], fields[index]];
  await saveSchema();
}

async function removeField(field) {
  const ok = await confirmDialog(`ลบฟิลด์ "${field.label}"? ข้อมูลในฟิลด์นี้จะถูกลบจากทุกระเบียน`, { danger: true, okText: "ลบฟิลด์" });
  if (!ok) return;
  state.schema.fields = state.schema.fields.filter((f) => f.key !== field.key);
  await saveSchema();
}

async function saveSchema() {
  try {
    showLoading();
    state.schema = await store.saveSchema(state.schema);
    await reload();
    hideLoading();
    toast("บันทึกโครงสร้างฟิลด์แล้ว", "success");
    render();
  } catch (e) {
    hideLoading();
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
}

function slugKey(label, existing) {
  const latin = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  let base = latin && /[a-z]/.test(latin) ? latin : "field";
  let key = base;
  let n = 2;
  const taken = new Set(existing.map((f) => f.key));
  while (taken.has(key)) key = base + "_" + n++;
  return key;
}

function openFieldModal(field) {
  const editing = !!field;
  const labelInput = h("input", { type: "text", placeholder: "เช่น ชื่อโครงการ" });
  labelInput.value = editing ? field.label : "";

  const typeSel = h("select", {},
    Object.entries(window.CMRSeed.FIELD_TYPES).map(([k, v]) => h("option", { value: k }, v))
  );
  typeSel.value = editing ? field.type : "text";
  if (editing && field.system) typeSel.disabled = true;

  const optionsArea = h("textarea", {
    rows: "3",
    placeholder: "คั่นด้วยเครื่องหมายจุลภาค เช่น แบรนด์ A, แบรนด์ B"
  });
  optionsArea.value = editing && field.options ? field.options.join(", ") : "";

  const reqWrap = h("label", { style: { display: "flex", gap: "7px", alignItems: "center", fontWeight: "400" } });
  const reqBox = h("input", { type: "checkbox" });
  reqBox.checked = editing ? !!field.required : false;
  reqWrap.append(reqBox, " จำเป็นต้องกรอก (บังคับ)");

  const optionsBlock = h("div", { class: "form-field", style: { display: "none" } },
    h("label", {}, "ตัวเลือก (คั่นด้วย ,)"), optionsArea
  );

  const syncOptions = () => {
    optionsBlock.style.display = ["select", "status", "checkbox"].includes(typeSel.value) ? "block" : "none";
  };
  typeSel.addEventListener("change", syncOptions);
  syncOptions();

  const body = h("div", {},
    h("div", { class: "form-field" }, h("label", {}, "ชื่อฟิลด์"), labelInput),
    h("div", { class: "form-field" }, h("label", {}, "ชนิดข้อมูล"), typeSel),
    optionsBlock,
    h("div", { class: "form-field" }, reqWrap)
  );

  openModal({
    title: editing ? "แก้ไขฟิลด์" : "เพิ่มฟิลด์ใหม่",
    body,
    footer: [
      h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
      h("button", {
        class: "btn primary",
        onclick: async () => {
          const label = labelInput.value.trim();
          if (!label) { toast("กรุณาตั้งชื่อฟิลด์", "error"); labelInput.classList.add("err"); return; }
          const type = typeSel.value;
          const options = optionsArea.value.split(",").map((s) => s.trim()).filter(Boolean);
          if (["select", "status", "checkbox"].includes(type) && !options.length) {
            toast("กรุณาระบุตัวเลือกอย่างน้อย 1 รายการ", "error");
            optionsArea.classList.add("err");
            return;
          }

          if (editing) {
            field.label = label;
            if (!field.system) field.type = type;
            if (["select", "status", "checkbox"].includes(field.type)) field.options = options;
            field.required = reqBox.checked;
          } else {
            state.schema.fields.push({
              key: slugKey(label, state.schema.fields),
              label, type, required: reqBox.checked, system: false,
              options: ["select", "status", "checkbox"].includes(type) ? options : undefined
            });
          }
          closeModal();
          await saveSchema();
        }
      }, "บันทึก")
    ]
  });
}

/* ================= CSV ================= */
function csvRows() {
  const fields = state.schema.fields;
  const header = fields.map((f) => f.label);
  const rows = state.records.map((rec) => fields.map((f) => {
    const v = rec.values[f.key];
    if (Array.isArray(v)) return v.join("|");
    if (v === null || v === undefined) return "";
    return v;
  }));
  return [header, ...rows];
}

function exportCsv() {
  if (!state.records.length) { toast("ยังไม่มีข้อมูลให้ส่งออก", "error"); return; }
  CSV.download("cmr-customers-" + new Date().toISOString().slice(0, 10) + ".csv", CSV.stringify(csvRows()));
  toast("ส่งออก CSV แล้ว (" + state.records.length + " ระเบียน)", "success");
}

function downloadTemplate() {
  const fields = state.schema.fields;
  const sample = fields.map((f) => {
    if (f.type === "status") return (f.options || [])[0] || "";
    if (f.type === "select") return (f.options || [])[0] || "";
    return "";
  });
  CSV.download("cmr-template.csv", CSV.stringify([fields.map((f) => f.label), sample]));
  toast("ดาวน์โหลดแม่แบบแล้ว", "success");
}

async function handleCsvFile(file) {
  try {
    const text = await file.text();
    const rows = CSV.parse(text);
    if (rows.length < 2) { toast("ไฟล์ไม่มีข้อมูล", "error"); return; }

    const header = rows[0].map((s) => String(s).trim());
    const fields = state.schema.fields;
    const mapping = header.map((hLabel) =>
      fields.find((f) => f.label === hLabel) || fields.find((f) => f.key === hLabel) || null
    );
    const matched = mapping.filter(Boolean).length;
    if (!matched) {
      toast("ไม่พบคอลัมน์ที่ตรงกับฟิลด์ในระบบ", "error");
      return;
    }

    const dataRows = rows.slice(1);
    const previewHead = h("thead", {}, h("tr", {},
      mapping.map((f, i) => h("th", {}, f ? f.label + " ✓" : (header[i] || "") + " ✗"))
    ));
    const previewRows = dataRows.slice(0, 5).map((r) =>
      h("tr", {}, r.map((c) => h("td", {}, String(c))))
    );
    const previewBody = h("tbody", {}, previewRows);
    const previewTable = h("table", { class: "data" }, previewHead, previewBody);

    openModal({
      title: "นำเข้า CSV",
      wide: true,
      body: h("div", {},
        h("p", {}, `ไฟล์: ${file.name} · พบ ${dataRows.length} แถวข้อมูล · จับคู่คอลัมน์ได้ ${matched} จาก ${header.length} คอลัมน์`),
        h("div", { class: "table-wrap", style: { maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" } }, previewTable),
        h("p", { class: "small muted" }, "แสดงตัวอย่าง 5 แถวแรก · แถวที่ไม่ครบฟิลด์ที่จำเป็นจะถูกข้าม")
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", {
          class: "btn primary",
          onclick: async () => {
            closeModal();
            await importRows(mapping, dataRows);
          }
        }, "นำเข้า " + dataRows.length + " แถว")
      ]
    });
  } catch (e) {
    toast("อ่านไฟล์ไม่สำเร็จ: " + e.message, "error");
  }
}

async function importRows(mapping, dataRows) {
  const fields = state.schema.fields;
  let ok = 0, skipped = 0;
  showLoading();
  for (const row of dataRows) {
    const values = {};
    let valid = true;
    fields.forEach((f) => { values[f.key] = f.type === "checkbox" ? [] : ""; });
    mapping.forEach((f, i) => {
      if (!f) return;
      let v = (row[i] ?? "").toString().trim();
      if (f.type === "checkbox") v = v ? v.split("|").map((s) => s.trim()).filter(Boolean) : [];
      if (f.type === "number" && v !== "") v = isNaN(Number(v)) ? "" : Number(v);
      values[f.key] = v;
    });
    for (const f of fields) {
      if (f.required && isEmpty(values[f.key])) { valid = false; break; }
    }
    if (!valid) { skipped++; continue; }
    try {
      await store.createRecord(values);
      ok++;
    } catch (e) { skipped++; }
  }
  await reload();
  hideLoading();
  toast(`นำเข้าสำเร็จ ${ok} ระเบียน${skipped ? ` · ข้าม ${skipped} แถว` : ""}`, skipped ? "" : "success");
  route();
}

/* ================= auth views ================= */
function authShell(title, sub, form, footerNote) {
  return h("div", { class: "auth-page" },
    h("div", { class: "auth-card card" },
      h("div", { class: "auth-brand" },
        h("div", { class: "brand-mark" }, "C"),
        h("div", {}, h("strong", {}, "CMR Base"), h("span", {}, "ระบบจัดการลูกค้า"))
      ),
      h("h2", {}, title),
      p2(sub),
      form,
      footerNote ? h("div", { class: "auth-foot" }, footerNote) : null
    )
  );
}

function p2(text) { return h("p", { class: "auth-sub muted" }, text); }

function authField(label, inputEl, hint) {
  return h("div", { class: "form-field" },
    h("label", {}, label), inputEl,
    hint ? h("div", { class: "hint" }, hint) : null
  );
}

function authErrorBox() {
  return h("div", { class: "form-error", hidden: true });
}

function showAuthError(box, msg) {
  box.textContent = msg;
  box.hidden = !msg;
}

function viewLogin() {
  const userInp = h("input", { type: "text", autocomplete: "username", placeholder: "ชื่อผู้ใช้", required: true });
  const passInp = h("input", { type: "password", autocomplete: "current-password", placeholder: "รหัสผ่าน", required: true });
  const err = authErrorBox();
  const submit = h("button", { class: "btn primary block", type: "submit" }, "เข้าสู่ระบบ");

  const form = h("form", { class: "auth-form", onsubmit: async (e) => {
    e.preventDefault();
    showAuthError(err, "");
    if (!userInp.value.trim() || !passInp.value) { showAuthError(err, "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
    submit.disabled = true;
    try {
      state.user = await Auth.login(userInp.value.trim(), passInp.value);
      await loadData();
      toast("เข้าสู่ระบบสำเร็จ สวัสดี " + state.user.display_name, "success");
      go("#/dashboard");
    } catch (ex) {
      showAuthError(err, ex.message);
    } finally {
      submit.disabled = false;
    }
  } },
    authField("ชื่อผู้ใช้", userInp),
    authField("รหัสผ่าน", passInp),
    err,
    submit
  );

  const hint = h("div", { class: "auth-hint", hidden: true });
  apiFetch("GET", "/api/auth/setup").then((s) => {
    if (!s.has_users) {
      hint.hidden = false;
      hint.textContent = "ยังไม่มีผู้ใช้ในระบบ — ไปที่หน้าสมัครสมาชิกเพื่อสร้างบัญชีผู้ดูแลระบบคนแรก";
    }
  }).catch(() => {});

  return authShell("เข้าสู่ระบบ", "กรอกชื่อผู้ใช้และรหัสผ่านเพื่อใช้งานระบบ", form,
    h("div", {}, hint, h("span", {}, "ยังไม่มีบัญชี? "), h("a", { href: "#/register" }, "สมัครสมาชิก")));
}

function viewRegister() {
  const userInp = h("input", { type: "text", autocomplete: "username", placeholder: "a-z, 0-9, . _ - (3–32 ตัว)", required: true });
  const nameInp = h("input", { type: "text", autocomplete: "name", placeholder: "ชื่อ-นามสกุล ที่ต้องการแสดง", required: true });
  const emailInp = h("input", { type: "email", autocomplete: "email", placeholder: "name@example.com (ไม่บังคับ)" });
  const passInp = h("input", { type: "password", autocomplete: "new-password", placeholder: "อย่างน้อย 6 ตัวอักษร", required: true });
  const pass2Inp = h("input", { type: "password", autocomplete: "new-password", placeholder: "พิมพ์รหัสผ่านอีกครั้ง", required: true });
  const err = authErrorBox();
  const submit = h("button", { class: "btn primary block", type: "submit" }, "สมัครสมาชิก");

  const form = h("form", { class: "auth-form", onsubmit: async (e) => {
    e.preventDefault();
    showAuthError(err, "");
    const username = userInp.value.trim().toLowerCase();
    const display_name = nameInp.value.trim();
    const password = passInp.value;

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) { showAuthError(err, "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ความยาว 3–32 ตัว"); return; }
    if (!display_name) { showAuthError(err, "กรุณากรอกชื่อที่แสดง"); return; }
    if (password.length < 6) { showAuthError(err, "รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร"); return; }
    if (password !== pass2Inp.value) { showAuthError(err, "รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }

    submit.disabled = true;
    try {
      const data = await Auth.register({ username, display_name, email: emailInp.value.trim(), password });
      state.user = data.user;
      await loadData();
      toast(data.first_admin
        ? "สมัครสำเร็จ — คุณคือผู้ดูแลระบบคนแรกของระบบ"
        : "สมัครสำเร็จ ยินดีต้อนรับ " + data.user.display_name, "success");
      go("#/dashboard");
    } catch (ex) {
      showAuthError(err, ex.message);
    } finally {
      submit.disabled = false;
    }
  } },
    authField("ชื่อผู้ใช้", userInp),
    authField("ชื่อที่แสดง", nameInp),
    authField("อีเมล", emailInp),
    authField("รหัสผ่าน", passInp, "อย่างน้อย 6 ตัวอักษร"),
    authField("ยืนยันรหัสผ่าน", pass2Inp),
    err,
    submit
  );

  return authShell("สมัครสมาชิก", "บัญชีแรกที่สมัครจะได้สิทธิ์ผู้ดูแลระบบอัตโนมัติ", form,
    h("span", {}, "มีบัญชีอยู่แล้ว? ", h("a", { href: "#/login" }, "เข้าสู่ระบบ")));
}

/* ================= users view (admin) ================= */
function viewUsers() {
  const tableBox = h("div");

  const load = async () => {
    try {
      const users = await Auth.listUsers();
      fill(tableBox, usersTable(users));
    } catch (e) { toast(e.message, "error"); }
  };

  const usersTable = (users) => {
    if (!users.length) return h("div", { class: "empty" }, h("p", {}, "ยังไม่มีผู้ใช้"));
    return h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        ["ชื่อผู้ใช้", "ชื่อที่แสดง", "อีเมล", "บทบาท", "สถานะ", "ระเบียนที่สร้าง", "จัดการ"].map((t) => h("th", {}, t))
      )),
      h("tbody", {}, users.map((u) => {
        const isSelf = state.user && u.id === state.user.id;

        const roleSel = h("select", { class: "control sm", disabled: isSelf, onchange: async (e) => {
          const role = e.target.value;
          try {
            await Auth.updateUser(u.id, { role });
            toast(`เปลี่ยนบทบาท ${u.display_name} → ${ROLE_LABEL_TH[role]}`, "success");
            await load();
          } catch (ex) { toast(ex.message, "error"); e.target.value = u.role; }
        } }, Object.entries(ROLE_LABEL_TH).map(([k, v]) => h("option", { value: k }, v)));
        roleSel.value = u.role;

        return h("tr", {},
          h("td", { class: "primary-cell" }, u.username, isSelf ? h("span", { class: "tag" }, "คุณ") : null),
          h("td", {}, h("div", { class: "row" }, h("div", { class: "avatar" }, initials(u.display_name)), u.display_name)),
          h("td", { class: "muted" }, u.email || "—"),
          h("td", {}, roleSel),
          h("td", {}, h("span", { class: "pill " + (u.active ? "s-won" : "s-lost") }, u.active ? "ใช้งาน" : "ระงับ")),
          h("td", { class: "num" }, u.record_count || 0),
          h("td", {}, h("div", { class: "row" },
            h("button", { class: "btn sm", onclick: () => openPasswordModal(u) }, "รหัสผ่าน"),
            h("button", { class: "btn sm", disabled: isSelf, onclick: async () => {
              try {
                await Auth.updateUser(u.id, { active: !u.active });
                toast(u.active ? "ระงับบัญชีแล้ว (เด้งออกจากระบบทันที)" : "เปิดใช้งานบัญชีแล้ว", "success");
                await load();
              } catch (ex) { toast(ex.message, "error"); }
            } }, u.active ? "ระงับ" : "เปิดใช้งาน"),
            h("button", { class: "btn sm danger", disabled: isSelf, onclick: async () => {
              const ok = await confirmDialog(`ลบบัญชี "${u.display_name}"? ระเบียนที่เคยสร้างจะกลายเป็นของระบบ`, { danger: true, okText: "ลบบัญชี" });
              if (!ok) return;
              try { await Auth.deleteUser(u.id); toast("ลบบัญชีแล้ว", "success"); await load(); }
              catch (ex) { toast(ex.message, "error"); }
            } }, "ลบ")
          ))
        );
      }))
    ));
  };

  const openPasswordModal = (u) => {
    const passInp = h("input", { type: "password", placeholder: "รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร" });
    const err = authErrorBox();
    openModal({
      title: `เปลี่ยนรหัสผ่าน: ${u.display_name}`,
      body: h("div", {},
        h("p", { class: "muted small" }, "การเปลี่ยนรหัสผ่านจะออกจากระบบของผู้ใช้คนนั้นทุกเครื่องทันที"),
        authField("รหัสผ่านใหม่", passInp), err
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: async () => {
          showAuthError(err, "");
          try {
            await Auth.updateUser(u.id, { password: passInp.value });
            closeModal();
            toast("เปลี่ยนรหัสผ่านแล้ว", "success");
          } catch (ex) { showAuthError(err, ex.message); }
        } }, "บันทึกรหัสผ่าน")
      ]
    });
  };

  const openAdd = () => {
    const userInp = h("input", { type: "text", placeholder: "a-z, 0-9, . _ -" });
    const nameInp = h("input", { type: "text", placeholder: "ชื่อ-นามสกุล" });
    const emailInp = h("input", { type: "email", placeholder: "name@example.com" });
    const passInp = h("input", { type: "password", placeholder: "อย่างน้อย 6 ตัวอักษร" });
    const roleSel = h("select", {}, Object.entries(ROLE_LABEL_TH).map(([k, v]) => h("option", { value: k }, v)));
    roleSel.value = "member";
    const err = authErrorBox();

    openModal({
      title: "เพิ่มผู้ใช้ใหม่",
      body: h("div", {},
        authField("ชื่อผู้ใช้", userInp),
        authField("ชื่อที่แสดง", nameInp),
        authField("อีเมล", emailInp),
        authField("รหัสผ่าน", passInp),
        authField("บทบาท", roleSel),
        err
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: async () => {
          showAuthError(err, "");
          try {
            await Auth.createUser({
              username: userInp.value.trim().toLowerCase(),
              display_name: nameInp.value.trim(),
              email: emailInp.value.trim(),
              password: passInp.value,
              role: roleSel.value
            });
            closeModal();
            toast("เพิ่มผู้ใช้แล้ว", "success");
            await load();
          } catch (ex) { showAuthError(err, ex.message); }
        } }, "เพิ่มผู้ใช้")
      ]
    });
  };

  load();

  return h("div", {},
    topbar({
      title: "จัดการผู้ใช้",
      sub: "กำหนดบทบาทและสิทธิ์การเข้าถึงข้อมูลลูกค้า",
      right: [h("button", { class: "btn primary", onclick: openAdd }, "+ เพิ่มผู้ใช้")]
    }),
    h("div", { class: "page" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, "ผู้ใช้ในระบบ",
          h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
            "admin ทำได้ทุกอย่าง · member เพิ่ม/แก้ไขได้ · viewer อ่านอย่างเดียว")),
        tableBox
      )
    )
  );
}

const ROLE_LABEL_TH = { admin: "ผู้ดูแลระบบ", member: "สมาชิก", viewer: "ผู้ชม (อ่านอย่างเดียว)" };

/* ================= start ================= */
let booted = false;
async function bootOnce() { if (booted) return; booted = true; await boot(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootOnce);
else bootOnce();
