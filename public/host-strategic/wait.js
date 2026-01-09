const params = new URLSearchParams(window.location.search);

// ✅ Get gameID from URL or fallback to localStorage
let gameID = params.get("game");
if (!gameID) {
  gameID = localStorage.getItem("gameID");
} else {
  localStorage.setItem("gameID", gameID);
}

// Read player names saved in start phase
const p1 = localStorage.getItem("player1") || "player1";
const p2 = localStorage.getItem("player2") || "player2";
const baseUrl = `${window.location.origin}/host-strategic/order.html`;

document.getElementById("p1NameBox").textContent = `قدرات ${p1}`;
document.getElementById("p2NameBox").textContent = `قدرات ${p2}`;

/* === Helpers to fetch abilities (texts) from host localStorage === */
const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";

function getAbilityObjects(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function getAbilityTexts(key) {
  return getAbilityObjects(key).map(a => a?.text).filter(Boolean);
}

function buildOrderLink({ who }) {
  const abilityTexts =
    who === "player1" ? getAbilityTexts(P1_ABILITIES_KEY) : getAbilityTexts(P2_ABILITIES_KEY);

  // Pack into a single query param `abs` separated by |
  const absParam = encodeURIComponent(abilityTexts.join("|"));

  const name = who === "player1" ? p1 : p2;
  const url =
    `${baseUrl}?game=${encodeURIComponent(gameID || "")}` +
    `&player=${encodeURIComponent(who)}` +
    `&name=${encodeURIComponent(name)}` +
    `&abs=${absParam}`;
  return url;
}

// 🔥 Update UI labels to use actual player names
const copyP1Btn = document.getElementById("copyP1");
const copyP2Btn = document.getElementById("copyP2");
const statusP1El = document.getElementById("statusP1");
const statusP2El = document.getElementById("statusP2");

if (copyP1Btn) copyP1Btn.textContent = `نسخ رابط ترتيب البطاقات لـ ${p1}`;
if (copyP2Btn) copyP2Btn.textContent = `نسخ رابط ترتيب البطاقات لـ ${p2}`;
if (statusP1El) statusP1El.textContent = `✅ تم الاستلام`;
if (statusP2El) statusP2El.textContent = `✅ تم الاستلام`;

// ✅ Copy buttons now include abilities in the URL
copyP1Btn.onclick = () => {
  const url = buildOrderLink({ who: "player1" });
  navigator.clipboard.writeText(url);
};
copyP2Btn.onclick = () => {
  const url = buildOrderLink({ who: "player2" });
  navigator.clipboard.writeText(url);
};

const startBtn = document.getElementById("startBtn");
const socket = io();
socket.emit("joinGame", { gameID, role: "host" }); // join room for timer sync
let orders = {};

socket.emit("watchOrders", { gameID });

socket.on("playerOrderSubmitted", ({ playerName, ordered }) => {
  console.log("Received order from:", playerName);
  orders[playerName] = ordered;
  if (playerName === p1) showStatus("statusP1");
  if (playerName === p2) showStatus("statusP2");
  if (orders[p1] && orders[p2]) {
    startBtn.disabled = false;
  }
});

function showStatus(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

startBtn.onclick = () => {
  localStorage.setItem("picks", JSON.stringify({ [p1]: orders[p1], [p2]: orders[p2] }));
  localStorage.setItem("currentRound", "0");
  const totalRounds = orders[p1].length;
  localStorage.setItem("roundCount", totalRounds.toString());
  localStorage.setItem("scores", JSON.stringify({ [p1]: totalRounds, [p2]: totalRounds }));
  location.href = "result.html";
};

/* ========= Render abilities (read-only) ========= */
function abilityPill(text, used = false) {
  const btn = document.createElement("div");
  btn.className =
    "w-full text-center px-4 py-2.5 rounded-lg font-bold text-base select-none pointer-events-none " +
    (used
      ? "bg-yellow-700 text-black/90 border border-yellow-800"
      : "bg-yellow-400 text-black border border-yellow-500");
  btn.textContent = text;
  btn.setAttribute("aria-disabled", "true");
  return btn;
}

function renderReadonlyAbilities(containerId, storageKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const abilities = getAbilityObjects(storageKey);
  if (!abilities.length) {
    const p = document.createElement("p");
    p.className = "opacity-70 text-sm text-center";
    p.textContent = "لا توجد قدرات";
    container.appendChild(p);
    return;
  }

  abilities.forEach(({ text, used }) => {
    container.appendChild(abilityPill(text, !!used));
  });
}

renderReadonlyAbilities("p1AbilitiesView", P1_ABILITIES_KEY);
renderReadonlyAbilities("p2AbilitiesView", P2_ABILITIES_KEY);

window.addEventListener("focus", () => {
  renderReadonlyAbilities("p1AbilitiesView", P1_ABILITIES_KEY);
  renderReadonlyAbilities("p2AbilitiesView", P2_ABILITIES_KEY);
});

/* ========= Countdown Timer (click to toggle 2:00 / 0:30) + SYNC BROADCAST ========= */
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

// Wire up
startTimerBtn.addEventListener("click", handleStart);
pauseTimerBtn.addEventListener("click", handlePause);
countdownBox.addEventListener("click", handleToggleDuration);

// Reply to state requests from players
socket.on("timerRequestState", () => {
  broadcastState();
});

// Init UI
renderTime();
setControls();
