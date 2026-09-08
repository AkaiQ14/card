const params = new URLSearchParams(window.location.search);
const gameID = params.get("game") || localStorage.getItem("gameID");

const p1 = localStorage.getItem("player1") || "player1";
const p2 = localStorage.getItem("player2") || "player2";
const totalRounds = localStorage.getItem("totalRounds") || "3";

const socket = io();
socket.emit("joinGame", { gameID, role: "host" }); // join room for timer sync

const CARD_ROUTE_PREFIX = window.location.pathname.startsWith("/anime/") ? "/anime" : "";

async function getQG14ShareOrigin() {
  try {
    const r = await fetch(`/api/desktop-info?t=${Date.now()}`, { cache: "no-store" });
    const info = r.ok ? await r.json() : null;
    const value = String(info?.shareOrigin || "").trim().replace(/\/$/, "");
    if (value && /^https:\/\//i.test(value)) return value;

    if (info?.desktop) return "";
    return window.location.origin;
  } catch {
    return "";
  }
}

function isQG14LocalOrigin(value) {
  try {
    const u = new URL(String(value || ""));
    return /^(?:localhost|127\.0\.0\.1|::1)$/i.test(u.hostname);
  } catch {
    return true;
  }
}

function showTunnelNotReady() {
  alert("رابط اللاعبين العالمي غير جاهز بعد. تأكد من اتصال Cloudflare Tunnel ثم حاول النسخ مرة أخرى.");
}


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

function imageKeyFromUrl(url) {
  try {
    const pathname = new URL(String(url || ""), window.location.origin).pathname;
    const marker = "/images/";
    const markerIndex = pathname.toLowerCase().lastIndexOf(marker);
    if (markerIndex < 0) return "";

    const relativePath = pathname.slice(markerIndex + marker.length);
    const separatorIndex = relativePath.indexOf("/");
    if (separatorIndex <= 0) return "";

    const folder = decodeURIComponent(relativePath.slice(0, separatorIndex)).toLowerCase();
    const filename = decodeURIComponent(relativePath.slice(separatorIndex + 1));
    return folder && filename ? `${folder}/${filename}` : "";
  } catch {
    return "";
  }
}

// === Copy global Cloudflare Tunnel links (with per-player token) ===
async function buildWinnerRemoteLink(who) {
  const isP1 = who === "player1";
  const playerName = isP1 ? p1 : p2;
  const opponentName = isP1 ? p2 : p1;
  const oppAbs = getAbilityTextsLS(isP1 ? "player2Abilities" : "player1Abilities").join("|");

  try {
    const remote = await fetch("/api/remote-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route: `${CARD_ROUTE_PREFIX}/host-winner/pick.html`,
        gameID,
        playerKey: who,
        playerName,
        query: { rounds: totalRounds, opp: opponentName, oppabs: oppAbs },
      }),
    });
    if (remote.ok) {
      const data = await remote.json();
      if (data?.url) return String(data.url);
    }
  } catch {}

  const shareOrigin = await getQG14ShareOrigin();
  if (!shareOrigin || isQG14LocalOrigin(shareOrigin)) {
    throw new Error("player_tunnel_not_ready");
  }
  const baseURL = `${shareOrigin}${CARD_ROUTE_PREFIX}/host-winner/pick.html`;
  return `${baseURL}?game=${encodeURIComponent(gameID || "")}` +
    `&player=${encodeURIComponent(who)}&name=${encodeURIComponent(playerName)}` +
    `&rounds=${encodeURIComponent(totalRounds)}&opp=${encodeURIComponent(opponentName)}` +
    `&oppabs=${encodeURIComponent(oppAbs)}`;
}

async function copyWinnerLink(who) {
  try {
    const url = await buildWinnerRemoteLink(who);
    if (!url || isQG14LocalOrigin(url)) {
      showTunnelNotReady();
      return;
    }
    await navigator.clipboard.writeText(url);
  } catch {
    showTunnelNotReady();
  }
}

copyP1.onclick = () => copyWinnerLink("player1");
copyP2.onclick = () => copyWinnerLink("player2");

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
    const exclude = Array.from(
      new Set((ordered || []).map(imageKeyFromUrl).filter(Boolean))
    );
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
