const params = new URLSearchParams(window.location.search);
const gameID = params.get("game") || localStorage.getItem("gameID");

const p1 = localStorage.getItem("player1") || "player1";
const p2 = localStorage.getItem("player2") || "player2";
const totalRounds = localStorage.getItem("totalRounds") || "3";

const socket = io();
socket.emit("joinGame", { gameID, role: "host" }); // join room for timer sync

const baseURL = `${window.location.origin}/host-winner/pick.html`;

const copyP1 = document.getElementById("copyP1");
const copyP2 = document.getElementById("copyP2");
const statusP1 = document.getElementById("statusP1");
const statusP2 = document.getElementById("statusP2");
const startBtn = document.getElementById("startBtn");
const p2Block = document.getElementById("p2Block");

// ability UI (gold pills, read-only)
const p1Title = document.getElementById("p1Title");
const p2Title = document.getElementById("p2Title");
const p1AbilitiesWrap = document.getElementById("p1Abilities");
const p2AbilitiesWrap = document.getElementById("p2Abilities");

let orders = {};
let p1AbilitiesCache = [];
let p2AbilitiesCache = [];

// Labels
if (copyP1) copyP1.textContent = `نسخ رابط ترتيب البطاقات لـ ${p1}`;
if (copyP2) copyP2.textContent = `نسخ رابط ترتيب البطاقات لـ ${p2}`;
if (statusP1) statusP1.textContent = `✅ تم الاستلام`;
if (statusP2) statusP2.textContent = `✅ تم الاستلام`;
if (p1Title) p1Title.textContent = `${p1} — قدرات (عرض فقط):`;
if (p2Title) p2Title.textContent = `${p2} — قدرات (عرض فقط):`;

// Helpers
function norm(list) {
  return (Array.isArray(list) ? list : [])
    .map(a => (typeof a === "string" ? a : a?.text || ""))
    .filter(Boolean);
}
function renderReadonlyAbilities(el, list) {
  if (!el) return;
  el.innerHTML = "";
  norm(list).forEach(text => {
    const pill = document.createElement("span");
    pill.textContent = text;
    pill.className = "px-3 py-1 rounded-lg font-bold border border-yellow-500 bg-yellow-400 text-black select-none";
    pill.setAttribute("aria-disabled", "true");
    pill.style.pointerEvents = "none";
    el.appendChild(pill);
  });
}
function getAbilityTextsLS(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    return norm(arr);
  } catch { return []; }
}

// === Copy links include opponent name + opponent abilities fallback ===
copyP1.onclick = () => {
  const oppAbs = getAbilityTextsLS("player2Abilities").join("|");
  const url =
    `${baseURL}?game=${gameID}` +
    `&player=player1&name=${encodeURIComponent(p1)}` +
    `&rounds=${totalRounds}` +
    `&opp=${encodeURIComponent(p2)}` +
    `&oppabs=${encodeURIComponent(oppAbs)}`;
  navigator.clipboard.writeText(url);
};

copyP2.onclick = () => {
  const oppAbs = getAbilityTextsLS("player1Abilities").join("|");
  const url =
    `${baseURL}?game=${gameID}` +
    `&player=player2&name=${encodeURIComponent(p2)}` +
    `&rounds=${totalRounds}` +
    `&opp=${encodeURIComponent(p1)}` +
    `&oppabs=${encodeURIComponent(oppAbs)}`;
  navigator.clipboard.writeText(url);
};

// === Abilities (pull from server for both players) ===
socket.emit("requestAbilities", { gameID, playerName: p1 });
socket.emit("requestAbilities", { gameID, playerName: p2 });

socket.on("diagEvent", () => {
  socket.emit("requestAbilities", { gameID, playerName: p1 });
  socket.emit("requestAbilities", { gameID, playerName: p2 });
});

// If your server emits { abilities, player } here, we’ll route by player
socket.on("receiveAbilities", ({ abilities, player }) => {
  const texts = norm(abilities);
  if (player === p1) {
    p1AbilitiesCache = texts;
    renderReadonlyAbilities(p1AbilitiesWrap, texts);
  } else if (player === p2) {
    p2AbilitiesCache = texts;
    renderReadonlyAbilities(p2AbilitiesWrap, texts);
  } else {
    // Fallback: if server doesn't include player name, first response -> p1, second -> p2
    if (!p1AbilitiesCache.length) {
      p1AbilitiesCache = texts;
      renderReadonlyAbilities(p1AbilitiesWrap, texts);
    } else if (!p2AbilitiesCache.length) {
      p2AbilitiesCache = texts;
      renderReadonlyAbilities(p2AbilitiesWrap, texts);
    }
  }
});

// === Orders / exclusions flow ===
socket.emit("watchOrders", { gameID });

socket.on("playerOrderSubmitted", ({ playerName, ordered }) => {
  orders[playerName] = ordered;

  if (playerName === p1) {
    showStatus(statusP1);
    // Build composite exclusion keys: "<anime>/<filename>"
    const exclude = (ordered || []).map(url => {
      try {
        const pathname = decodeURIComponent(new URL(url, window.location.origin).pathname);
        const parts = pathname.split("/");
        const anime = String(parts[2] || "").toLowerCase();
        const filename = String(parts[3] || "");
        return `${anime}/${filename}`;
      } catch {
        const parts = String(url || "").split("/");
        const anime = String(parts[2] || "").toLowerCase();
        const filename = String(parts[3] || parts[parts.length - 1] || "");
        return `${anime}/${filename}`;
      }
    });
    socket.emit("storeExclusions", { gameID, exclude });
    p2Block.classList.remove("hidden");
  }

  if (playerName === p2) showStatus(statusP2);

  if (orders[p1] && orders[p2]) startBtn.disabled = false;
});

function showStatus(el) { if (el) el.classList.remove("hidden"); }

startBtn.onclick = () => {
  localStorage.setItem("picks", JSON.stringify({ [p1]: orders[p1], [p2]: orders[p2] }));
  localStorage.setItem("currentRound", "0");
  const roundCount = (orders[p1] || []).length;
  localStorage.setItem("roundCount", String(roundCount));
  localStorage.setItem("scores", JSON.stringify({ [p1]: roundCount, [p2]: roundCount }));
  location.href = "result.html";
};

/* ========= Countdown Timer (click to toggle 2:00 / 0:30) + SYNC BROADCAST =========
   Imported & adapted from host-strategic wait files (UI + logic). */
const countdownEl = document.getElementById("countdown");
const countdownBox = document.getElementById("countdownBox");
const startTimerBtn = document.getElementById("startTimerBtn");
const pauseTimerBtn = document.getElementById("pauseTimerBtn");

// durations (seconds)
const DUR_TWO_MIN = 120;
const DUR_THIRTY = 30;

let durationSec = DUR_TWO_MIN; // current chosen duration (idle)
let remaining = durationSec;   // counts down while running/paused
let isRunning = false;
let countdownInterval = null;
let startedAtMs = null;        // when running: host's wallclock start time (ms)

function fmt(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function renderTime() { countdownEl.textContent = fmt(remaining); }
function setControls() {
  startTimerBtn.disabled = isRunning || remaining <= 0;
  pauseTimerBtn.disabled = !isRunning;
}

function broadcastState() {
  socket.emit("timerState", {
    gameID,
    state: isRunning ? "running" : (remaining === 0 ? "finished" : "paused_or_idle"),
    durationSec,
    remainingSec: remaining,
    startedAt: startedAtMs // null if not running
  });
}

function tick() {
  remaining -= 1;
  if (remaining <= 0) {
    remaining = 0;
    stopInterval();
    renderTime();
    countdownEl.parentElement.classList.add("animate-pulse");
    setTimeout(() => countdownEl.parentElement.classList.remove("animate-pulse"), 1500);
    socket.emit("timerFinished", { gameID });
    broadcastState();
    return;
  }
  renderTime();
}

function startInterval() {
  if (isRunning || remaining <= 0) return;
  isRunning = true;
  startedAtMs = Date.now();
  countdownInterval = setInterval(tick, 1000);
  setControls();
  socket.emit("timerStart", { gameID, durationSec, startedAt: startedAtMs, remainingSec: remaining });
  broadcastState();
}

function stopInterval() {
  if (!isRunning) return;
  clearInterval(countdownInterval);
  countdownInterval = null;
  isRunning = false;
  setControls();
}

function handleStart() { startInterval(); }
function handlePause() {
  stopInterval();
  socket.emit("timerPause", { gameID, remainingSec: remaining });
  broadcastState();
}
function handleToggleDuration() {
  if (isRunning) return;
  durationSec = (durationSec === DUR_TWO_MIN) ? DUR_THIRTY : DUR_TWO_MIN;
  remaining = durationSec;
  countdownBox.classList.add("ring-2", "ring-yellow-500");
  setTimeout(() => countdownBox.classList.remove("ring-2", "ring-yellow-500"), 200);
  renderTime();
  setControls();
  socket.emit("timerSetDuration", { gameID, durationSec });
  broadcastState();
}

// Wire up timer UI
startTimerBtn.addEventListener("click", handleStart);
pauseTimerBtn.addEventListener("click", handlePause);
countdownBox.addEventListener("click", handleToggleDuration);

// Reply to state requests from players (so their UI stays synced invisibly)
socket.on("timerRequestState", () => {
  broadcastState();
});

// Init timer UI
renderTime();
setControls();
