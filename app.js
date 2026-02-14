const API_URL = "https://script.google.com/macros/s/AKfycbz0i13iUMQk5FF1WIQUL9Ha_GUBy3ox3FsLxOiA5ol31_r_8BiYTeNrYlGoF_YxX2N8/exec";
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
  }
  currentRouteLabel.textContent = currentRoute ? String(currentRoute) : "-";

  renderRouteTiles(routes);
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

      currentRoute = routeNum;
      currentRouteLabel.textContent = String(currentRoute);

      routesGrid.querySelectorAll(".routeTile").forEach(x => x.classList.remove("selected"));
      tile.classList.add("selected");

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

  const data = await callApi({ key: API_KEY, action: "init", day: selectedDay });

  if (data.status !== "ok") throw new Error(data.message || "Init failed");

  applyDashboard(data.dashboard, data.cleaned);
  showApp();

  setStatus(`Ready. Queue: ${queue.length} (offline supported)`);
  setTimeout(() => input.focus(), 50);

  // spróbuj od razu wysłać co już jest w kolejce
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
    showDayPicker();
    setStatus("Select day");
  });
}

// ====== ROUTE NAV (Prev/Next only among active) ======
btnPrevRoute.addEventListener("click", () => {
  if (!activeRoutes.length || currentRoute == null) return;
  const idx = activeRoutes.indexOf(currentRoute);
  const prev = idx <= 0 ? activeRoutes[activeRoutes.length - 1] : activeRoutes[idx - 1];
  currentRoute = prev;
  currentRouteLabel.textContent = String(currentRoute);
  setStatus(`Route selected: ${currentRoute}`);
  refreshSelectedTile();
  setTimeout(() => input.focus(), 50);
});

btnNextRoute.addEventListener("click", () => {
  if (!activeRoutes.length || currentRoute == null) return;
  const idx = activeRoutes.indexOf(currentRoute);
  const next = idx >= activeRoutes.length - 1 ? activeRoutes[0] : activeRoutes[idx + 1];
  currentRoute = next;
  currentRouteLabel.textContent = String(currentRoute);
  setStatus(`Route selected: ${currentRoute}`);
  refreshSelectedTile();
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
  setStatus(`OK: ${code} (route ${currentRoute})  queued: ${queue.length}`);

  kickSend();
}

input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  const raw = input.value;
  input.value = "";

  const code = normalizeGB(raw);
  if (!code) {
    setStatus(`Invalid format: ${String(raw || "").trim()}`);
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
      // Wysyłamy tylko dla wybranego dnia (żeby nie mieszać dni)
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
      if (acked.size === 0) {
        // nic nie potwierdził -> nie usuwamy nic, próbujemy później
        throw new Error("No ACK from backend");
      }

      // usuń z kolejki tylko to co ACK
      const before = queue.length;
      queue = queue.filter(x => !acked.has(x.id));
      saveQueue();

      const removed = before - queue.length;
      const savedCount = Number(data.savedCount || 0);
      const dupCount = Number(data.dupCount || 0);
      const invalidCount = Number(data.invalidCount || 0);
      const noRouteCount = Number(data.noRouteCount || 0);

      setStatus(`Synced: removed ${removed} | saved ${savedCount} | dup ${dupCount} | invalid ${invalidCount} | queue ${queue.length}`);

      // odśwież dashboard po udanej paczce
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

// co 5s próbuj wysłać, ale worker sam pilnuje, żeby nie robić równoległych requestów
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
  });
} else {
  showDayPicker();
  setStatus("Select day");
}
