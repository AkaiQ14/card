// ========== Extract Parameters ==========
const params = new URLSearchParams(window.location.search);
const playerParam = params.get("player");
const gameID = params.get("game");
const playerName = params.get("name");
let currentPlayer = playerParam === "player2" ? 2 : 1;

const instruction = document.getElementById("instruction");
const grid = document.getElementById("cardGrid");
const continueBtn = document.getElementById("continueBtn");
const okBtn = document.getElementById("okBtn");
const orderCounter = document.getElementById("orderCounter");
const orderCountEl = document.getElementById("orderCount");
const orderTotalEl = document.getElementById("orderTotal");

// Abilities (self)
const abilitiesWrap = document.getElementById("playerAbilities");
const abilityStatus = document.getElementById("abilityStatus");

// Opponent abilities (view-only)
const oppPanel = document.getElementById("opponentAbilitiesPanel");
const oppWrap  = document.getElementById("opponentAbilities");

// ====== Timer (read-only) ======
const playerCountdownEl = document.getElementById("playerCountdown");
const timerWrap = document.getElementById("timerWrap");
function hideTimer() { if (timerWrap) timerWrap.classList.add("hidden"); }

const DUR_TWO_MIN = 120;
const DUR_THIRTY = 30;

let t_durationSec = DUR_TWO_MIN;
let t_remaining = t_durationSec;
let t_running = false;
let t_startedAt = null;
let t_interval = null;

function t_fmt(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function t_render() { playerCountdownEl.textContent = t_fmt(Math.max(0, t_remaining)); }
function t_stopInterval() { if (t_interval) clearInterval(t_interval); t_interval = null; t_running = false; }
function t_startInterval() {
  if (t_interval || t_remaining <= 0) return;
  t_running = true;
  t_interval = setInterval(() => {
    t_remaining -= 1;
    if (t_remaining <= 0) { t_remaining = 0; t_render(); t_stopInterval(); return; }
    t_render();
  }, 1000);
}

instruction.innerText = `اللاعب ${playerName} رتب بطاقاتك`;

// ======= Page-level hardening against casual downloads =======
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && ["s","S","p","P"].includes(e.key)) {
    e.preventDefault();
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

// ====== Socket ======
const socket = io();
// ===== Chat (player -> host) =====
const chatHistory = document.getElementById("chatHistory");
const chatInput   = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatus  = document.getElementById("chatStatus");

function chatAppend({ from, text, ts, self=false }) {
  if (!chatHistory) return;
  const row = document.createElement("div");
  row.className = `chat-row ${self ? "is-self" : "is-host"}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  const time = ts ? new Date(ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "";
  bubble.textContent = (from ? `${from}: ` : "") + text + (time ? `  •  ${time}` : "");
  row.appendChild(bubble);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function sendChat() {
  if (!socket || !gameID || !playerName) return;
  const msg = String(chatInput?.value || "").trim();
  if (!msg) return;
  socket.emit("playerChat", { gameID, playerName, message: msg });
  chatAppend({ from: playerName, text: msg, ts: Date.now(), self: true });
  if (chatInput) chatInput.value = "";
  if (chatStatus) chatStatus.textContent = "تم الإرسال ✅";
  setTimeout(() => { if (chatStatus) chatStatus.textContent = ""; }, 1200);
}

if (chatSendBtn) chatSendBtn.addEventListener("click", sendChat);
if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendChat(); }
  });
}
// Optional: show connection status
if (socket && chatStatus) {
  socket.on("connect", () => { chatStatus.textContent = "متصل ✅"; setTimeout(()=>chatStatus.textContent="", 800); });
  socket.on("disconnect", () => { chatStatus.textContent = "غير متصل ❌"; });
}

// Receive host replies (optional)
socket.on("hostChat", (payload = {}) => {
  const { gameID: g, message, ts } = payload;
  if (g && gameID && g !== gameID) return;
  if (!message) return;
  chatAppend({ from: "المضيف", text: String(message), ts: ts || Date.now(), self: false });
});


socket.emit("joinGame", { gameID, role: "player" });

// Ask host for latest timer state
socket.emit("timerRequestState", { gameID });

// React to host broadcasts
socket.on("timerSetDuration", ({ gameID: g, durationSec }) => {
  if (g && g !== gameID) return;
  if (t_running) return;
  t_durationSec = Number(durationSec || t_durationSec);
  t_remaining = t_durationSec;
  t_render();
});
socket.on("timerStart", ({ gameID: g, durationSec, startedAt, remainingSec }) => {
  if (g && g !== gameID) return;
  t_stopInterval();
  t_durationSec = Number(durationSec || t_durationSec);
  if (Number.isInteger(remainingSec)) {
    t_remaining = remainingSec;
  } else if (startedAt) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    t_remaining = Math.max(0, t_durationSec - elapsed);
  } else {
    t_remaining = t_durationSec;
  }
  t_render();
  if (t_remaining > 0) t_startInterval();
});
socket.on("timerPause", ({ gameID: g, remainingSec }) => {
  if (g && g !== gameID) return;
  t_stopInterval();
  if (Number.isInteger(remainingSec)) t_remaining = remainingSec;
  t_render();
});
socket.on("timerFinished", ({ gameID: g }) => {
  if (g && g !== gameID) return;
  t_stopInterval();
  t_remaining = 0;
  t_render();
  playerCountdownEl.parentElement.classList.add("animate-pulse");
  setTimeout(() => playerCountdownEl.parentElement.classList.remove("animate-pulse"), 1500);
});
// Fallback snapshot
socket.on("timerState", ({ gameID: g, state, durationSec, remainingSec, startedAt }) => {
  if (g && g !== gameID) return;
  t_durationSec = Number(durationSec || t_durationSec);
  if (state === "running") {
    const elapsed = Math.floor((Date.now() - (startedAt || Date.now())) / 1000);
    t_remaining = Number.isInteger(remainingSec) ? remainingSec : Math.max(0, t_durationSec - elapsed);
    t_render(); if (t_remaining > 0) { t_stopInterval(); t_startInterval(); }
  } else if (state === "finished") {
    t_stopInterval(); t_remaining = 0; t_render();
  } else {
    t_stopInterval(); t_remaining = Number.isInteger(remainingSec) ? remainingSec : t_durationSec; t_render();
  }
});

// ================== (rest of the file) ==================

// Optional local mirrors, isolated per game so cards from an older
// match can never appear in the current match.
const GAME_LOCAL_SUFFIX =
  `${String(gameID || "default")}:${String(playerParam || "player1")}`;
const PICKS_LOCAL_KEY =
  `strategicPicks:${GAME_LOCAL_SUFFIX}`;
const ORDER_LOCAL_KEY =
  `strategicOrdered:${GAME_LOCAL_SUFFIX}`;
const OK_ACTIVE_KEY   = `${playerParam}:okActive`;

// Default OK to active if not set yet
if (localStorage.getItem(OK_ACTIVE_KEY) === null) {
  localStorage.setItem(OK_ACTIVE_KEY, "1");
}

let picks = [];
let submittedOrder = null;

// ===== Ability state =====
let myAbilities = [];
const tempUsed = new Set();
const pendingRequests = new Map();

/* ================== Helpers ================== */
function createMedia(url, className, onClick) {
  const isWebm = /\.webm(\?|#|$)/i.test(url);
  if (isWebm) {
    const vid = document.createElement("video");
    vid.src = url;
    vid.autoplay = true; vid.loop = true; vid.muted = true; vid.playsInline = true;
    vid.controls = false;                              // no controls UI
    vid.disablePictureInPicture = true;                // no PiP
    vid.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback");
    vid.setAttribute("preload", "metadata");
    vid.oncontextmenu = (e) => e.preventDefault();
    vid.draggable = false;
    vid.className = className;
    if (onClick) vid.onclick = onClick;
    return vid;
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.className = className;
    img.oncontextmenu = (e) => e.preventDefault();
    img.draggable = false;
    if (onClick) img.onclick = onClick;
    return img;
  }
}

// Normalize to [{text, used}]
function normalizeAbilityList(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map(a => {
    if (typeof a === "string") return { text: a.trim(), used: false };
    if (a && typeof a === "object") return { text: String(a.text || "").trim(), used: !!a.used };
    return null;
  }).filter(Boolean).filter(a => a.text);
}

function uniqueCardUrls(list) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(list) ? list : []) {
    const url = String(value || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }

  return result;
}

function isExactOrderForPicks(ordered, pickList) {
  const cleanOrder = uniqueCardUrls(ordered);
  const cleanPicks = uniqueCardUrls(pickList);

  return (
    cleanPicks.length > 0 &&
    cleanOrder.length === cleanPicks.length &&
    cleanOrder.every(url => cleanPicks.includes(url))
  );
}

function hideOpponentPanel() {
  if (oppPanel) {
    oppPanel.classList.add("hidden");
    oppWrap.innerHTML = "";
  }
}

function renderBadges(container, abilities, { clickable = false, onClick } = {}) {
  container.innerHTML = "";
  const list = Array.isArray(abilities) ? abilities : [];
  list.forEach(ab => {
    const isUsed = !!ab.used;
    const el = document.createElement(clickable ? "button" : "span");
    el.textContent = ab.text;
    el.className = [
      "ability-badge",
      clickable ? "my-ability" : "opponent-ability",
      isUsed ? "is-used" : ""
    ].filter(Boolean).join(" ");
    if (clickable) {
      if (isUsed) { el.disabled = true; el.setAttribute("aria-disabled", "true"); }
      else if (onClick) { el.onclick = () => onClick(ab.text); }
    }
    container.appendChild(el);
  });
}

/* ============ Unique-number dropdown logic ============ */
function buildOptions(select, N, forbiddenSet, currentValue) {
  select.innerHTML = "";
  const def = document.createElement("option"); def.value = ""; def.textContent = "-- الترتيب --"; select.appendChild(def);
  for (let i = 1; i <= N; i++) {
    if (!forbiddenSet.has(String(i)) || String(i) === String(currentValue)) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = i; select.appendChild(opt);
    }
  }
  if (currentValue && Array.from(select.options).some(o => o.value === String(currentValue))) {
    select.value = String(currentValue);
  } else {
    select.value = "";
  }
}
function snapshotChosen(selects) {
  const values = selects.map(s => s.value || "");
  const chosenSet = new Set(values.filter(Boolean));
  return { chosenSet, values };
}
function refreshAllSelects(selects, N) {
  const { chosenSet, values } = snapshotChosen(selects);
  selects.forEach((sel, idx) => buildOptions(sel, N, chosenSet, values[idx]));
  const allChosen = values.filter(Boolean).length === N && chosenSet.size === N;
  if (orderCountEl) orderCountEl.textContent = String(values.filter(Boolean).length);
  if (orderTotalEl) orderTotalEl.textContent = String(N);
  if (orderCounter) orderCounter.classList.toggle("is-complete", allChosen);
  continueBtn.classList.toggle("hidden", !allChosen);
}

/* ================== Load picks + existing order ================== */
socket.emit("getOrderData", { gameID, playerName });
socket.on("orderData", ({ picks: serverPicks = [], ordered = null }) => {
  const cleanServerPicks = uniqueCardUrls(serverPicks);

  if (cleanServerPicks.length) {
    picks = cleanServerPicks;
    try { localStorage.setItem(PICKS_LOCAL_KEY, JSON.stringify(picks)); } catch {}
  } else {
    const localPicks = JSON.parse(localStorage.getItem(PICKS_LOCAL_KEY) || "[]");
    picks = uniqueCardUrls(localPicks);
  }

  submittedOrder = isExactOrderForPicks(ordered, picks)
    ? uniqueCardUrls(ordered)
    : null;
  try {
    if (submittedOrder) localStorage.setItem(ORDER_LOCAL_KEY, JSON.stringify(submittedOrder));
    else localStorage.removeItem(ORDER_LOCAL_KEY);
  } catch {}

  if (!picks.length) {
    grid.innerHTML = `<p class="text-red-500 text-lg">لم يتم العثور على بطاقات لهذا اللاعب.</p>`;
    return;
  }

  if (submittedOrder && submittedOrder.length === picks.length) {
    hideOpponentPanel(); hideTimer();
    renderCards(submittedOrder, submittedOrder);
    if (okBtn) {
      okBtn.classList.remove("hidden");
      const active = localStorage.getItem(OK_ACTIVE_KEY) === "1";
      setOkUi(active, false); // reflect stored state, don't emit on load
    }
  } else {
    renderCards(picks, null);
    if (okBtn) okBtn.classList.add("hidden");
  }
});

/* ================== Abilities (self) ================== */
(function renderAbilitiesFromUrlParam() {
  const absParam = params.get("abs");
  if (!absParam) {
    abilityStatus.textContent = "بانتظار مزامنة القدرات من المستضيف…";
    return;
  }
  const list = absParam.split("|").map(s => s.trim()).filter(Boolean)
    .map(text => ({ text, used: false }));
  myAbilities = list.slice();
  renderBadges(abilitiesWrap, myAbilities, { clickable: true, onClick: requestUseAbility });
  abilityStatus.textContent = "اضغط على القدرة لطلب استخدامها. سيتم إشعار المستضيف.";
})();
socket.emit("requestAbilities", { gameID, playerName });

/* ================== Opponent abilities (view-only) ================== */
socket.emit("getPlayers", { gameID });
socket.on("players", (names = []) => {
  const two = Array.isArray(names) ? names : [];
  const opponent = two.find(n => n && n !== playerName) || null;
  if (opponent) socket.emit("requestAbilities", { gameID, playerName: opponent });
});

// Abilities router
socket.on("receiveAbilities", ({ abilities, player }) => {
  const list = normalizeAbilityList(abilities);
  if (player === playerName || !player) {
    myAbilities = list.map(a => ({ ...a, used: a.used || tempUsed.has(a.text) }));
    renderBadges(abilitiesWrap, myAbilities, { clickable: true, onClick: requestUseAbility });
    abilityStatus.textContent = myAbilities.length
      ? "اضغط على القدرة لطلب استخدامها. سيتم إشعار المستضيف."
      : "لا توجد قدرات متاحة حالياً.";
    return;
  }
  if (submittedOrder && submittedOrder.length === picks.length) { hideOpponentPanel(); return; }
  renderBadges(oppWrap, list, { clickable: false });
});

function requestUseAbility(abilityText) {
  abilityStatus.textContent = "تم إرسال طلب استخدام القدرة…";
  const requestId = `${playerName}:${Date.now()}`;
  tempUsed.add(abilityText);
  pendingRequests.set(requestId, abilityText);
  myAbilities = (myAbilities || []).map(a => a.text === abilityText ? { ...a, used: true } : a);
  renderBadges(abilitiesWrap, myAbilities, { clickable: true, onClick: requestUseAbility });
  socket.emit("requestUseAbility", { gameID, playerName, abilityText, requestId });
}

socket.on("abilityRequestResult", ({ requestId, ok, reason }) => {
  const abilityText = pendingRequests.get(requestId);
  if (abilityText) pendingRequests.delete(requestId);

  if (!ok) {
    if (abilityText) {
      tempUsed.delete(abilityText);
      myAbilities = (myAbilities || []).map(a => a.text === abilityText ? { ...a, used: false } : a);
    }
    renderBadges(abilitiesWrap, myAbilities, { clickable: true, onClick: requestUseAbility });
    socket.emit("requestAbilities", { gameID, playerName });

    if (reason === "already_used") abilityStatus.textContent = "❌ القدرة تم استخدامها بالفعل. اطلب قدرة أخرى.";
    else if (reason === "ability_not_found") abilityStatus.textContent = "❌ القدرة غير معروفة لدى المستضيف.";
    else abilityStatus.textContent = "❌ تعذر تنفيذ الطلب.";
  } else {
    abilityStatus.textContent = "✅ تم قبول الطلب من المستضيف.";
  }
});

/* ================== Cards UI ================== */
function renderCards(pickList, lockedOrder = null) {
  grid.innerHTML = "";
  const display = (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length) ? lockedOrder : pickList;
  const selects = [];
  const isLocked = Array.isArray(lockedOrder) && lockedOrder.length === pickList.length;
  if (orderTotalEl) orderTotalEl.textContent = String(pickList.length);
  if (orderCountEl) orderCountEl.textContent = String(isLocked ? pickList.length : 0);
  if (orderCounter) orderCounter.classList.toggle("is-complete", isLocked);
  display.forEach((url) => {
    const wrapper = document.createElement("div");
    wrapper.className = `order-card${isLocked ? " is-locked" : ""}`;

    // Media + shield wrapper (prevents right-click/drag and hides URL affordances)
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "nosave";
    const media = createMedia(url, "order-card-media");
    const shield = document.createElement("div");
    shield.className = "shield";
    mediaWrap.appendChild(media);
    mediaWrap.appendChild(shield);

    const selectLabel = document.createElement("span");
    selectLabel.className = "select-label";
    selectLabel.textContent = isLocked ? "ترتيب البطاقة" : "اختر ترتيب البطاقة";

    const select = document.createElement("select");
    select.className = "order-select orderSelect";
    const def = document.createElement("option"); def.value = ""; def.textContent = "-- الترتيب --"; select.appendChild(def);

    if (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length) {
      const orderIndex = lockedOrder.findIndex(u => u === url);
      if (orderIndex >= 0) {
        const opt = document.createElement("option");
        opt.value = String(orderIndex + 1);
        opt.textContent = String(orderIndex + 1);
        select.appendChild(opt);
        select.value = String(orderIndex + 1);
        select.disabled = true;
      }
    }

    wrapper.appendChild(mediaWrap);
    wrapper.appendChild(selectLabel);
    wrapper.appendChild(select);
    grid.appendChild(wrapper);
    selects.push(select);
  });

  if (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length) {
    continueBtn.classList.add("hidden");
  } else {
    refreshAllSelects(selects, pickList.length);
    selects.forEach(sel => sel.addEventListener("change", () => refreshAllSelects(selects, pickList.length)));
    continueBtn.classList.add("hidden");
    continueBtn.disabled = false;
    continueBtn.textContent = "متابعة وإرسال الترتيب";
  }
}

/* ================== Submit Ordered Picks ================== */
function submitPicks() {
  if (!picks.length) return;
  if (Array.isArray(submittedOrder) && submittedOrder.length === picks.length) return;

  if (new Set(picks).size !== picks.length) {
    alert("تعذر المتابعة: توجد بطاقة متكررة ضمن اختيارات اللاعب.");
    return;
  }

  const dropdowns = document.querySelectorAll(".orderSelect");
  const values = dropdowns.length ? Array.from(dropdowns).map((s) => parseInt(s.value, 10)) : [];
  const inRange = values.every(v => Number.isInteger(v) && v >= 1 && v <= picks.length);
  if (!inRange || new Set(values).size !== picks.length) {
    alert("يرجى ترتيب كل البطاقات بدون تكرار وضمن النطاق الصحيح.");
    return;
  }

  const ordered = new Array(picks.length);
  for (let i = 0; i < values.length; i++) {
    const orderIndex = values[i] - 1;
    ordered[orderIndex] = picks[i];
  }

  if (
    ordered.some(url => !url) ||
    new Set(ordered).size !== ordered.length
  ) {
    alert("تعذر المتابعة: ترتيب البطاقات غير صالح أو يحتوي على تكرار.");
    return;
  }

  socket.emit("submitOrder", { gameID, playerName, ordered });
  try { localStorage.setItem(ORDER_LOCAL_KEY, JSON.stringify(ordered)); } catch {}
  submittedOrder = ordered.slice();
  hideOpponentPanel(); hideTimer();

  // Show OK and set it to "تمام" (green) by default
  if (okBtn) {
    okBtn.classList.remove("hidden");
    setOkUi(false, true); // show "تمام" (inactive on host)
    localStorage.setItem(OK_ACTIVE_KEY, "0");
  }

  renderCards(submittedOrder, submittedOrder);
  setTimeout(() => { location.replace(location.href); }, 300);
}

/* === Reset OK to active when host starts a new round === */
socket.on("startRound", ({ round }) => {
  // reset to "تمام" (green) each new round
  localStorage.setItem(OK_ACTIVE_KEY, "0");
  if (okBtn && !okBtn.classList.contains("hidden")) {
    setOkUi(false, true); // show "تمام" and notify host it's inactive
  }
});

/* ================== Toggle OK to host (activate/deactivate) ================== */
function setOkUi(active, emitChange = true) {
  if (!okBtn) return;
  const side = (playerParam === "player1") ? "right" : "left";

  if (active) {
    // ✅ OK is active on host — show "إلغاء تمام" so player can cancel
    okBtn.textContent = "إلغاء تمام";
    okBtn.classList.add("is-cancel");
  } else {
    // ❌ OK is not active — show "تمام" (green) to allow activating
    okBtn.textContent = "تمام";
    okBtn.classList.remove("is-cancel");
  }

  if (emitChange) {
    socket.emit("playerOk", { gameID, playerName, side, active });
    localStorage.setItem(OK_ACTIVE_KEY, active ? "1" : "0");
  }
}

function togglePlayerOk() {
  const current = localStorage.getItem(OK_ACTIVE_KEY) === "1";
  setOkUi(!current, true);
}

window.submitPicks = submitPicks;
window.togglePlayerOk = togglePlayerOk;

// Keep my abilities fresh if host re-syncs
socket.on("diagEvent", () => {
  tempUsed.clear();
  pendingRequests.clear();
  socket.emit("requestAbilities", { gameID, playerName });
});

/* =========================================================================
   REPLACED: open in new tab  →  TOGGLE EMBEDDED IFRAME INSIDE ORDER PAGE
   ========================================================================= */
(function(){ 
  const btn  = document.getElementById("openPlayerViewBtn");
  const wrap = document.getElementById("embeddedPlayerWrap");
  const frame = document.getElementById("embeddedPlayerFrame");

  if (btn && wrap && frame) {
    btn.addEventListener("click", () => {
      // Build same URL that used to open in new tab
      const url = `${location.origin}/host-strategic/player-view.html?game=${encodeURIComponent(gameID||"")}&name=${encodeURIComponent(playerName||"")}`;

      if (wrap.classList.contains("hidden")) {
        // show + load
        frame.src = url;
        wrap.classList.remove("hidden");
        btn.textContent = "إخفاء الجولة المباشرة";
      } else {
        // hide + unload
        frame.src = "";
        wrap.classList.add("hidden");
        btn.textContent = "عرض الجولة المباشرة";
      }
    });
  }
})();