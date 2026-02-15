const API_URL = "https://script.google.com/macros/s/AKfycbyMha-a_LBuZDPBSr5OU3kGm1HZYARiJWngJnS1l7GocwEvClIRdK0Ql5YAgBposVjm/exec";
const API_KEY = "0123456789";

// ====== SCAN QUEUE (PERSISTENT) ======
const QUEUE_KEY = "gb_queue_v2";
let queue = loadQueue(); // [{id, ts, code, day, route}]
let lastCode = "";
let lastAt = 0;
let isSending = false;

// ====== APP STATE ======
let selectedDay = localStorage.getItem("gb_day") || "";
let activeRoutes = [];      // array of route numbers (sorted)
let currentRoute = null;    // number
let lastRoutesPayload = []; // keep latest tiles data for rendering selection

// ====== Warehouse UI counters (per route session) ======
// NEW: invalid scan counter resets on route/day change
let invalidScans = 0;
// NEW: session actual counter (instant feedback for operator)
let sessionActual = 0;

// ====== DOM ======
const el = (id) => document.getElementById(id);

const dayPicker = el("dayPicker");
const app = el("app");

const dayLabel = el("dayLabel");
const btnChangeDay = el("btnChangeDay");

const pctCompleted = el("pctCompleted");
const completedRoutesEl = el("completedRoutes");
const activeRoutesEl = el("activeRoutes");
const totalActualEl = el("totalActual");
const totalPlannedEl = el("totalPlanned");
const dashMsg = el("dashMsg");

const routesGrid = el("routesGrid");
const btnPrevRoute = el("btnPrevRoute");
const btnNextRoute = el("btnNextRoute");
const btnCurrentRoute = el("btnCurrentRoute");
const currentRouteLabel = el("currentRouteLabel");

const input = el("scanInput");
const statusEl = el("status");
const listEl = el("lastScans");

// NEW: warehouse header elements (from updated index.html)
const routeHeaderDay = el("routeHeaderDay");
const routeHeaderRoute = el("routeHeaderRoute");
const routePlannedEl = el("routePlanned");
const routeActualEl = el("routeActual");
const invalidCountEl = el("invalidCount");

// ====== UTILS ======
function nowIso() { return new Date().toISOString(); }
function setStatus(msg) { statusEl.textContent = msg; }

function addToUI(item) {
  const li = document.createElement("li");
  li.textContent = `${item.ts}  ${item.code}  (route ${item.route})`;
  listEl.prepend(li);
  while (listEl.children.length > 20) listEl.removeChild(listEl.lastChild);
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// GB format: GB + 9 cyfr + opcjonalnie (litera + cyfra)
function normalizeGB(code) {
  const s = String(code || "").trim().toUpperCase();
  if (!s) return "";
  if (!/^GB\d{9}([A-Z]\d)?$/.test(s)) return "";
  return s;
}

// anti-double-scan (np. odbicie skanera)
function dedupeImmediate(code) {
  const t = Date.now();
  if (code === lastCode && (t - lastAt) < 700) return true;
  lastCode = code;
  lastAt = t;
  return false;
}

// Fokus zawsze w polu (żeby skaner zawsze “wpadał” tam)
function keepFocus() {
  if (document.activeElement !== input) input.focus();
}
setInterval(keepFocus, 500);
document.addEventListener("click", keepFocus);

// Helper: GET with timeout (iOS-safe)
async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(id);
  }
}

async function callApi(payloadObj, timeoutMs = 12000) {
  const payload = encodeURIComponent(JSON.stringify(payloadObj));
  const url = `${API_URL}?payload=${payload}`;
  const res = await fetchWithTimeout(url, timeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? " - " + text : ""}`);
  }
  return await res.json().catch(() => ({ status: "ok" }));
}

// ====== Warehouse UI helpers ======
// NEW: get planned/actual for a route from last dashboard payload
function getRouteInfo(routeNum) {
  const r = (lastRoutesPayload || []).find(x => Number(x.route) === Number(routeNum));
  if (!r) return { planned: "-", actual: "-" };
  return { planned: Number(r.planned ?? "-"), actual: Number(r.actual ?? "-") };
}

// NEW: reset per-route counters and update header
function resetRouteSessionCounters() {
  invalidScans = 0;
  sessionActual = 0;
  updateWarehouseHeader();
}

// NEW: update header UI (day/route/planned/actual/invalid)
function updateWarehouseHeader() {
  if (routeHeaderDay) routeHeaderDay.textContent = selectedDay || "-";
  if (routeHeaderRoute) routeHeaderRoute.textContent = (currentRoute != null) ? String(currentRoute) : "-";

  // planned/actual from backend payload when available
  const info = (currentRoute != null) ? getRouteInfo(currentRoute) : { planned: "-", actual: "-" };

  // planned
  if (routePlannedEl) routePlannedEl.textContent = (info.planned === "-" ? "-" : String(info.planned));

  // actual: show "backend actual + sessionActual" for instant feedback
  // If backend actual is not available, just show sessionActual.
  let baseActual = (info.actual === "-" || Number.isNaN(info.actual)) ? 0 : Number(info.actual);
  const showActual = baseActual + sessionActual;

  if (routeActualEl) routeActualEl.textContent = String(showActual);

  // invalid
  if (invalidCountEl) invalidCountEl.textContent = String(invalidScans);
}

// ====== VIEW SWITCH ======
function showDayPicker() {
  dayPicker.classList.remove("hidden");
  app.classList.add("hidden");
}

function showApp() {
  dayPicker.classList.add("hidden");
  app.classList.remove("hidden");
}

// ====== DASHBOARD RENDER ======
function applyDashboard(dash, cleanedInfo) {
  pctCompleted.textContent = String(dash.percentCompleted || 0);
  completedRoutesEl.textContent = String(dash.completedRoutes || 0);
  activeRoutesEl.textContent = String(dash.activeRoutes || 0);
  totalActualEl.textContent = String(dash.totalActual || 0);
  totalPlannedEl.textContent = String(dash.totalPlanned || 0);

  if (cleanedInfo && cleanedInfo.cleaned) {
    dashMsg.textContent = `Auto-clean done (${cleanedInfo.reason}).`;
  } else if (cleanedInfo && cleanedInfo.reason) {
    dashMsg.textContent = `Auto-clean: ${cleanedInfo.reason}.`;
  } else {
    dashMsg.textContent = "";
  }

  const routes = Array.isArray(dash.routes) ? dash.routes : [];
  lastRoutesPayload = routes;

  activeRoutes = routes.map(r => Number(r.route)).filter(n => Number.isFinite(n));
  activeRoutes.sort((a, b) => a - b);

  if (!currentRoute || !activeRoutes.includes(currentRoute)) {
    currentRoute = activeRoutes.length ? activeRoutes[0] : null;
    // NEW: when auto-select changes route, reset route counters
    resetRouteSessionCounters();
  }

  currentRouteLabel.textContent = currentRoute ? String(currentRoute) : "-";

  renderRouteTiles(routes);

  // NEW: ensure header gets refreshed after dashboard update
  updateWarehouseHeader();
}

function renderRouteTiles(routes) {
  routesGrid.innerHTML = "";

  for (const r of routes) {
    const tile = document.createElement("div");
    tile.className = `card routeTile ${r.status || "in_progress"}`;
    tile.dataset.route = String(r.route);

    if (currentRoute === Number(r.route)) tile.classList.add("selected");

    const diff = Number(r.diff || 0);
    const diffText = diff > 0 ? `(+${diff})` : (diff < 0 ? `(${diff})` : "");

    tile.innerHTML = `
      <div class="routeId">${r.route}</div>
      <div class="routeCount">${r.actual} / ${r.planned} ${diffText}</div>
    `;

    tile.addEventListener("click", () => {
      const routeNum = Number(tile.dataset.route);
      if (!activeRoutes.includes(routeNum)) return;

      // NEW: if changing route, reset per-route counters
      const was = currentRoute;
      currentRoute = routeNum;
      currentRouteLabel.textContent = String(currentRoute);

      routesGrid.querySelectorAll(".routeTile").forEach(x => x.classList.remove("selected"));
      tile.classList.add("selected");

      if (was !== currentRoute) resetRouteSessionCounters();
      else updateWarehouseHeader();

      setStatus(`Route selected: ${currentRoute}`);
      setTimeout(() => input.focus(), 50);
    });

    routesGrid.appendChild(tile);
  }
}

function refreshSelectedTile() {
  routesGrid.querySelectorAll(".routeTile").forEach(tile => {
    tile.classList.toggle("selected", Number(tile.dataset.route) === currentRoute);
  });
}

// ====== DAY PICKER ======
async function initForDay(day) {
  selectedDay = day;
  localStorage.setItem("gb_day", selectedDay);

  dayLabel.textContent = selectedDay;
  setStatus("Loading dashboard...");

  // NEW: reset counters on day change
  resetRouteSessionCounters();
  updateWarehouseHeader();

  const data = await callApi({ key: API_KEY, action: "init", day: selectedDay });

  if (data.status !== "ok") throw new Error(data.message || "Init failed");

  applyDashboard(data.dashboard, data.cleaned);
  showApp();

  setStatus(`Ready. Queue: ${queue.length} (offline supported)`);
  setTimeout(() => input.focus(), 50);

  kickSend();
}

function wireDayButtons() {
  dayPicker.querySelectorAll("button[data-day]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const day = btn.getAttribute("data-day");
      try {
        btn.disabled = true;
        await initForDay(day);
      } catch (err) {
        alert(`Init failed: ${err.message || err}`);
      } finally {
        btn.disabled = false;
      }
    });
  });

  btnChangeDay.addEventListener("click", () => {
    selectedDay = "";
    currentRoute = null;
    activeRoutes = [];
    lastRoutesPayload = [];
    routesGrid.innerHTML = "";

    // NEW: reset counters when leaving app
    resetRouteSessionCounters();
    updateWarehouseHeader();

    showDayPicker();
    setStatus("Select day");
  });
}

// ====== ROUTE NAV (Prev/Next only among active) ======
btnPrevRoute.addEventListener("click", () => {
  if (!activeRoutes.length || currentRoute == null) return;
  const idx = activeRoutes.indexOf(currentRoute);
  const prev = idx <= 0 ? activeRoutes[activeRoutes.length - 1] : activeRoutes[idx - 1];

  const was = currentRoute;
  currentRoute = prev;
  currentRouteLabel.textContent = String(currentRoute);

  setStatus(`Route selected: ${currentRoute}`);
  refreshSelectedTile();

  if (was !== currentRoute) resetRouteSessionCounters();
  else updateWarehouseHeader();

  setTimeout(() => input.focus(), 50);
});

btnNextRoute.addEventListener("click", () => {
  if (!activeRoutes.length || currentRoute == null) return;
  const idx = activeRoutes.indexOf(currentRoute);
  const next = idx >= activeRoutes.length - 1 ? activeRoutes[0] : activeRoutes[idx + 1];

  const was = currentRoute;
  currentRoute = next;
  currentRouteLabel.textContent = String(currentRoute);

  setStatus(`Route selected: ${currentRoute}`);
  refreshSelectedTile();

  if (was !== currentRoute) resetRouteSessionCounters();
  else updateWarehouseHeader();

  setTimeout(() => input.focus(), 50);
});

btnCurrentRoute.addEventListener("click", () => {
  setStatus(`Current route: ${currentRoute || "-"}`);
  setTimeout(() => input.focus(), 50);
});

// ====== SCANNING ======
function enqueue(code) {
  if (!selectedDay) {
    setStatus("Select day first.");
    return;
  }
  if (currentRoute == null) {
    setStatus("No active routes (Planned must be > 0).");
    return;
  }

  const ts = nowIso();
  const item = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2),
    code,
    ts,
    day: selectedDay,
    route: currentRoute
  };

  queue.push(item);
  saveQueue();

  addToUI(item);

  // NEW: instant operator feedback (actual +1 in header)
  sessionActual += 1;
  updateWarehouseHeader();

  setStatus(`OK: ${code} (route ${currentRoute})  queued: ${queue.length}`);

  kickSend();
}

input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  const raw = input.value;
  input.value = "";

  const code = normalizeGB(raw);

  // NEW: invalid scan counter (only invalid format)
  if (!code) {
    invalidScans += 1;
    updateWarehouseHeader();

    const cleaned = String(raw || "").trim();
    setStatus(`Invalid scan (rescan box). Read: ${cleaned || "-"}`);
    return;
  }

  if (dedupeImmediate(code)) {
    setStatus(`Duplicate ignored: ${code}`);
    return;
  }

  enqueue(code);
});

// ====== SYNC WORKER (ACK, single flight) ======
function kickSend() {
  if (!selectedDay) return;
  if (!navigator.onLine) return;
  if (isSending) return;
  if (queue.length === 0) return;
  sendLoop(); // async
}

async function sendLoop() {
  isSending = true;
  try {
    while (navigator.onLine && queue.length > 0 && selectedDay) {
      const dayItems = queue.filter(x => x.day === selectedDay);
      if (dayItems.length === 0) break;

      const batch = dayItems.slice(0, 25);
      const data = await callApi({
        key: API_KEY,
        action: "batchScan",
        day: selectedDay,
        device: navigator.userAgent,
        items: batch.map(x => ({
          id: x.id,
          ts: x.ts,
          code: x.code,
          route: x.route
        }))
      }, 15000);

      if (data.status !== "ok") throw new Error(data.message || "batchScan failed");

      const acked = new Set(Array.isArray(data.ackedIds) ? data.ackedIds : []);
      if (acked.size === 0) throw new Error("No ACK from backend");

      const before = queue.length;
      queue = queue.filter(x => !acked.has(x.id));
      saveQueue();

      const removed = before - queue.length;
      const savedCount = Number(data.savedCount || 0);
      const dupCount = Number(data.dupCount || 0);
      const invalidCount = Number(data.invalidCount || 0);
      const noRouteCount = Number(data.noRouteCount || 0);

      setStatus(`Synced: removed ${removed} | saved ${savedCount} | dup ${dupCount} | invalid ${invalidCount} | queue ${queue.length}`);

      // NEW: after successful send, refresh dashboard to sync planned/actual tiles
      refreshDashboard();
    }
  } catch (err) {
    const msg =
      err.name === "AbortError"
        ? "timeout"
        : (err && err.message) ? err.message : "unknown error";

    setStatus(`Sync failed (retry): ${msg}. Queue: ${queue.length}`);
  } finally {
    isSending = false;
  }
}

setInterval(kickSend, 5000);

window.addEventListener("online", () => {
  setStatus(`Online. Queue: ${queue.length}`);
  kickSend();
});
window.addEventListener("offline", () => {
  setStatus(`Offline mode. Queue: ${queue.length}`);
});

// ====== DASHBOARD refresh every 30s ======
async function refreshDashboard() {
  if (!selectedDay) return;
  try {
    const data = await callApi({ key: API_KEY, action: "dashboard", day: selectedDay });
    if (data.status !== "ok") return;

    const old = currentRoute;
    applyDashboard(data.dashboard, null);

    if (old && activeRoutes.includes(old)) {
      currentRoute = old;
      currentRouteLabel.textContent = String(currentRoute);
      refreshSelectedTile();
    }

    // NEW: refresh header values after dashboard update
    updateWarehouseHeader();
  } catch (_) {
    // silent
  }
}
setInterval(refreshDashboard, 30000);

// ====== BOOT ======
wireDayButtons();

if (selectedDay) {
  initForDay(selectedDay).catch(() => {
    showDayPicker();
    setStatus("Select day");
    updateWarehouseHeader();
  });
} else {
  showDayPicker();
  setStatus("Select day");
  updateWarehouseHeader();
}
