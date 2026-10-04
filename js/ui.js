/* ============================================================
   CMR Base — UI helpers (h, toast, modal, formatting)
   ============================================================ */

/** สร้าง element: h('div', {class:'x', onclick: fn}, child1, child2, ...) */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  const append = (c) => {
    if (c === null || c === undefined || c === false || c === "") return;
    if (Array.isArray(c)) return c.forEach(append);
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  children.forEach(append);
  return el;
}

/** ย่อ element เดิมให้เหลือเฉพาะ children ใหม่ */
function fill(el, ...children) {
  el.textContent = "";
  const append = (c) => {
    if (c === null || c === undefined || c === false || c === "") return;
    if (Array.isArray(c)) return c.forEach(append);
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  children.forEach(append);
  return el;
}

/* ---------- toast ---------- */
function toast(message, type = "") {
  const root = document.getElementById("toast-root");
  const t = h("div", { class: "toast " + type }, message);
  root.append(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateX(20px)";
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

/* ---------- modal ---------- */
function openModal({ title, body, footer, wide }) {
  closeModal();
  const root = document.getElementById("modal-root");
  const box = h("div", { class: "modal" + (wide ? " wide" : "") });
  const backdrop = h("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) closeModal(); } },
    box
  );
  box.append(
    h("div", { class: "modal-head" },
      h("h3", {}, title),
      h("button", { class: "modal-close", onclick: closeModal, "aria-label": "ปิด" }, "×")
    ),
    h("div", { class: "modal-body" }, body)
  );
  if (footer) box.append(h("div", { class: "modal-foot" }, footer));
  root.append(backdrop);
  const onKey = (e) => { if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  backdrop.dataset.keyHandler = "1";
  return box;
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.textContent = "";
}

function confirmDialog(message, { danger = false, okText = "ยืนยัน" } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { closeModal(); resolve(v); };
    openModal({
      title: "ยืนยันการทำรายการ",
      body: h("p", { class: "mb0" }, message),
      footer: [
        h("button", { class: "btn", onclick: () => done(false) }, "ยกเลิก"),
        h("button", { class: "btn " + (danger ? "danger" : "primary"), onclick: () => done(true) }, okText)
      ]
    });
  });
}

/* ---------- formatting ---------- */
function fmtNumber(n) {
  if (n === "" || n === null || n === undefined || isNaN(Number(n))) return "";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
  if (n === "" || n === null || n === undefined || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 }) + " ฿";
}

function fmtDate(v) {
  if (!v) return "";
  const d = typeof v === "number" ? new Date(v) : new Date(v + "T00:00:00");
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "เมื่อครู่";
  if (m < 60) return m + " นาทีที่แล้ว";
  const hr = Math.floor(m / 60);
  if (hr < 24) return hr + " ชั่วโมงที่แล้ว";
  const day = Math.floor(hr / 24);
  if (day < 30) return day + " วันที่แล้ว";
  return fmtDate(ts);
}

function statusClass(status, schema) {
  const known = (window.CMRSeed || {}).STATUS_STYLES || {};
  if (known[status]) return known[status];
  const field = (schema && schema.fields || []).find((f) => f.type === "status");
  const opts = (field && field.options) || [];
  const idx = opts.indexOf(status);
  if (status && idx === -1) return "s-other";
  return "s-other";
}

function statusPill(status, schema) {
  if (!status) return h("span", { class: "muted small" }, "—");
  return h("span", { class: "pill " + statusClass(status, schema) }, status);
}

function initials(name) {
  if (!name) return "?";
  const parts = String(name).replace("คุณ", "").replace("ทพญ.", "").replace("พญ.", "").replace("นางสาว", "").trim().split(/\s+/);
  return (parts[0] ? parts[0][0] : "?") + (parts[1] ? parts[1][0] : "");
}

function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showLoading() {
  if (document.querySelector(".progress-strip")) return;
  document.body.prepend(h("div", { class: "progress-strip" }));
}
function hideLoading() {
  const el = document.querySelector(".progress-strip");
  if (el) el.remove();
}
