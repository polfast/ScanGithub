const API_URL = "https://script.google.com/macros/s/AKfycbyi1VhhGC8PnokdZEN1jJz_nK9CvR7XWhi4iT6XxsIbjOPBDvGe_mWbTprGy-9tjQJR/exec"; // wkleisz swój
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

// === Wysyłka co 5 sekund ===
async function flushQueue() {
  if (queue.length === 0) return;

  // bierzemy paczkę max np. 100 rekordów na raz
  const batch = queue.slice(0, 100);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY
      },
      body: JSON.stringify({
        device: navigator.userAgent,
        batch
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // usuń wysłane z kolejki
    queue = queue.slice(batch.length);
    setStatus(`Synced ${batch.length}. Remaining: ${queue.length}. Server: ${data.status}`);
  } catch (err) {
    setStatus(`Sync failed (will retry): ${err.message}. Queued: ${queue.length}`);
    // nic nie usuwamy — spróbuje za kolejne 5s
  }
}
setInterval(flushQueue, 5000);
