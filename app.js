const API_URL = "https://script.google.com/macros/s/AKfycbx_ZRIbI1OCQkHct20zhAEOHvmCTIWJkp29sYgQIayPiDUwW34QqkX_YGk--78LkouD/exec";
const API_KEY = "0123456789"; // taki sam w GAS

let queue = [];
let lastCode = "";
let lastAt = 0;

const input = document.getElementById("scanInput");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("lastScans");

function nowIso() { return new Date().toISOString(); }

function addToUI(item) {
  const li = document.createElement("li");
  li.textContent = `${item.ts}  ${item.code}`;
  listEl.prepend(li);
  while (listEl.children.length > 20) listEl.removeChild(listEl.lastChild);
}

function setStatus(msg) { statusEl.textContent = msg; }

function enqueue(code) {
  const ts = nowIso();
  queue.push({ code, ts });

  addToUI({ code, ts });
  setStatus(`OK: ${code}  (queued: ${queue.length})`);
}

function normalize(code) {
  return String(code || "").trim();
}

function dedupe(code) {
  const t = Date.now();
  if (code === lastCode && (t - lastAt) < 700) return true; // 700ms blokada dubli
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

input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();

  const code = normalize(input.value);
  input.value = "";

  if (!code) return;
  if (dedupe(code)) {
    setStatus(`Duplicate ignored: ${code}`);
    return;
  }

  enqueue(code);
});

// Helper: fetch z timeoutem
async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(id);
  }
}

// === Wysyłka co 5 sekund (GET, bez CORS-preflight) ===
async function flushQueue() {
  if (queue.length === 0) return;

  // mniejsza paczka, bo URL ma limit długości
  const batch = queue.slice(0, 25);

  // payload do URL (GET)
  const payloadObj = {
    key: API_KEY,
    device: navigator.userAgent,
    batch
  };

  const payload = encodeURIComponent(JSON.stringify(payloadObj));
  const url = `${API_URL}?payload=${payload}`;

  try {
    const res = await fetchWithTimeout(url, 12000);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${text ? " - " + text : ""}`);
    }

    const data = await res.json().catch(() => ({ status: "ok" }));

    // usuń wysłane z kolejki
    queue = queue.slice(batch.length);

    setStatus(`Synced ${batch.length}. Remaining: ${queue.length}. Server: ${data.status || "ok"}`);
  } catch (err) {
    const msg =
      err.name === "AbortError"
        ? "timeout"
        : (err && err.message) ? err.message : "unknown error";

    setStatus(`Sync failed (will retry): ${msg}. Queued: ${queue.length}`);
  }
}

setInterval(flushQueue, 5000);
