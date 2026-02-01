// --- Game state (safe defaults) ---
const roundCount = parseInt(localStorage.getItem("roundCount") || localStorage.getItem("totalRounds") || "5", 10);
const startingHP = parseInt(localStorage.getItem("totalRounds") || "5", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1"; // right column
const player2 = localStorage.getItem("player2") || "لاعب 2"; // left column
const picks    = JSON.parse(localStorage.getItem("picks") || "{}");
let round      = parseInt(localStorage.getItem("currentRound") || "0", 10);

// Scores init/persist
let scores = JSON.parse(localStorage.getItem("scores") || "{}");
if (!Number.isFinite(scores?.[player1])) scores[player1] = startingHP;
if (!Number.isFinite(scores?.[player2])) scores[player2] = startingHP;

const roundTitle = document.getElementById("roundTitle");

// Ability storage keys
const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";
const NOTES_KEY = (name) => `notes:${name}`;

// ===== socket =====
const gameID = localStorage.getItem("gameID");
const socket = typeof io !== "undefined" ? io() : null;

/* 🔑 ensure this page's socket is IN the room */
function joinRoomReliably() {
  if (!socket || !gameID) return;
  socket.emit("joinGame", { gameID, role: "host" });
  socket.emit("hostWatchAbilityRequests", { gameID });
}
if (socket) {
  socket.on("connect", () => {
    joinRoomReliably();
    setTimeout(joinRoomReliably, 500);
    setTimeout(joinRoomReliably, 1500);
    setTimeout(joinRoomReliably, 3000);
  });
}


// ===== Host Chat Inbox (receives from order page) =====
const hostChatToggle    = document.getElementById("hostChatToggle");
const hostChatBody      = document.getElementById("hostChatBody");
const hostChatHistory   = document.getElementById("hostChatHistory");
const hostChatStatus    = document.getElementById("hostChatStatus");
// (Reply UI is optional; we keep it hidden-safe if not used)
const hostChatReplyInput = document.getElementById("hostChatReplyInput");
const hostChatReplySend  = document.getElementById("hostChatReplySend");

function hostChatAppend({ from, text, ts, self=false }) {
  if (!hostChatHistory) return;
  const row = document.createElement("div");
  row.className = "flex " + (self ? "justify-end" : "justify-start");
  const bubble = document.createElement("div");
  bubble.className =
    "max-w-[85%] px-3 py-2 rounded-lg border " +
    (self
      ? "bg-yellow-500/90 text-black border-yellow-400"
      : "bg-white/10 text-white border-yellow-700/50");
  const time = ts ? new Date(ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "";
  bubble.textContent = (from ? `${from}: ` : "") + text + (time ? `  •  ${time}` : "");
  row.appendChild(bubble);
  hostChatHistory.appendChild(row);
  hostChatHistory.scrollTop = hostChatHistory.scrollHeight;
}

if (hostChatToggle && hostChatBody) {
  hostChatToggle.addEventListener("click", () => {
    const hidden = hostChatBody.classList.toggle("hidden");
    hostChatToggle.textContent = hidden ? "إظهار" : "إخفاء";
  });
}

// Listen for player messages
if (socket) {
  socket.on("playerChat", (payload = {}) => {
    const { gameID: g, playerName, message, ts } = payload;
    if (g && gameID && g !== gameID) return;
    if (!message) return;
    hostChatAppend({ from: playerName || "لاعب", text: String(message), ts: ts || Date.now(), self: false });
    if (hostChatStatus) {
      hostChatStatus.textContent = "📩 وصلت رسالة جديدة";
      setTimeout(() => { if (hostChatStatus) hostChatStatus.textContent = ""; }, 1500);
    }
  });
}

// Optional: host reply back to players (requires server relay)
function sendHostReply() {
  if (!socket || !gameID) return;
  const msg = String(hostChatReplyInput?.value || "").trim();
  if (!msg) return;
  socket.emit("hostChat", { gameID, message: msg });
  hostChatAppend({ from: "المضيف", text: msg, ts: Date.now(), self: true });
  if (hostChatReplyInput) hostChatReplyInput.value = "";
}
if (hostChatReplySend) hostChatReplySend.addEventListener("click", sendHostReply);
if (hostChatReplyInput) hostChatReplyInput.addEventListener("keydown", (e)=>{ if (e.key==="Enter"){ e.preventDefault(); sendHostReply(); }});

// ========= Toast =========
function showToast(message, actions = [], closeOverride = null) {
  const wrap = document.createElement("div");
  wrap.className =
    "fixed left-1/2 -translate-x-1/2 bottom-6 z-50 " +
    "bg-[#222] text-white border-2 border-yellow-500 shadow-xl " +
    "rounded-xl px-4 py-3 max-w-[90vw] w-[520px]";
  const msg = document.createElement("div");
  msg.className = "mb-3 leading-relaxed";
  msg.textContent = message;
  wrap.appendChild(msg);
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "flex gap-2 justify-end";
    actions.forEach(a => {
      const b = document.createElement("button");
      b.textContent = a.label;
      b.className = "px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 font-bold";
      b.onclick = () => { a.onClick?.(); document.body.removeChild(wrap); };
      row.appendChild(b);
    });
    const closeBtn = document.createElement("button");
    if (closeOverride?.label) {
      closeBtn.textContent = closeOverride.label;
      closeBtn.onclick = () => { closeOverride.onClick?.(); document.body.removeChild(wrap); };
    } else {
      closeBtn.textContent = "إغلاق";
      closeBtn.onclick = () => document.body.removeChild(wrap);
    }
    closeBtn.className = "px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 font-bold";
    row.appendChild(closeBtn);
    wrap.appendChild(row);
  }
  document.body.appendChild(wrap);
  if (!actions.length) setTimeout(() => wrap.remove(), 1800);
}

// ===== Helpers =====
function loadAbilities(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]") || []; } catch { return []; }
}
function saveAbilities(key, arr) { localStorage.setItem(key, JSON.stringify(arr || [])); }
function normalizeAbilityList(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map(a => {
    if (typeof a === "string") return { text: a.trim(), used: false };
    if (a && typeof a === "object") return { text: String(a.text || "").trim(), used: !!a.used };
    return null;
  }).filter(Boolean).filter(a => a.text);
}
function syncServerAbilities(){
  if (!socket || !gameID) return;
  const abilities = { [player1]: loadAbilities(P1_ABILITIES_KEY), [player2]: loadAbilities(P2_ABILITIES_KEY) };
  socket.emit("setAbilities", { gameID, abilities });
}

function createMedia(url, className, playSfx = false) {
  const isWebm = /\.webm(\?|#|$)/i.test(url || "");
  if (isWebm) {
    const v = document.createElement("video");
    v.src = url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    v.className = className;
    if (playSfx && window.WebmSfx) window.WebmSfx.attachToMedia(v, url);
    return v;
  } else {
    const img = document.createElement("img");
    img.src = url; img.className = className; return img;
  }
}

function abilityRow(ab, onToggle) {
  const row = document.createElement("button");
  row.className =
    "w-full text-center px-4 py-2.5 rounded-lg font-bold text-base " +
    (ab.used
      ? "bg-yellow-700 text-black/90 border border-yellow-800"
      : "bg-yellow-400 hover:bg-yellow-300 text-black border border-yellow-500");
  row.textContent = ab.text;
  row.onclick = onToggle;
  return row;
}

// Fixed-height abilities pane rendering
function renderAbilities(storageKey, container) {
  const abilities = loadAbilities(storageKey);
  container.innerHTML = "";
  if (!abilities.length) {
    const p = document.createElement("p");
    p.className = "opacity-70 text-sm"; p.textContent = "لا توجد قدرات";
    container.appendChild(p);
    return;
  }
  abilities.forEach((ab, idx) => {
    const btn = abilityRow(ab, () => {
      const current = loadAbilities(storageKey); if (!current[idx]) return;
      current[idx].used = !current[idx].used; saveAbilities(storageKey, current);
      renderAbilities(storageKey, container); syncServerAbilities(); broadcast();
    });
    container.appendChild(btn);
  });
}

// previous & VS
function getPreviousUrls(name) {
  const arr = Array.isArray(picks?.[name]) ? picks[name] : [];
  return arr.filter((_, i) => i < round);
}
function renderPrevGrid(container, urls) {
  container.innerHTML = "";
  urls.forEach(src => {
    const cell = document.createElement("div"); cell.className = "w-24 h-32 rounded-md overflow-hidden";
    const m = createMedia(src, "w-full h-full object-contain"); cell.appendChild(m); container.appendChild(cell);
  });
}

// ======== Player-View snapshot sync (host→viewers) ========
let okState = { left:{active:false,playerName:null}, right:{active:false,playerName:null} };
function buildSnapshot() {
  return {
    player1, player2,
    round, roundCount,
    scores,
    ok: okState,
    abilities: { [player1]: loadAbilities(P1_ABILITIES_KEY), [player2]: loadAbilities(P2_ABILITIES_KEY) },
    currentLeftUrl:  picks?.[player2]?.[round],
    currentRightUrl: picks?.[player1]?.[round],
    prevLeft:  getPreviousUrls(player2),
    prevRight: getPreviousUrls(player1),
    notes: {
      [player1]: localStorage.getItem(NOTES_KEY(player1)) || "",
      [player2]: localStorage.getItem(NOTES_KEY(player2)) || ""
    }
  };
}
function broadcast() { if (socket && gameID) socket.emit("resultSnapshot", { gameID, snapshot: buildSnapshot() }); }
if (socket) socket.on("requestResultSnapshot", () => broadcast());

// ======== VS Row ========
function renderVsRow() {
  if (window.WebmSfx && typeof window.WebmSfx === "object") {
    try { if (!window.WebmSfx.perSide) window.WebmSfx.perSide = { left: [], right: [] };
      window.WebmSfx.perSide.left = []; window.WebmSfx.perSide.right = []; } catch {}
  }
  const vsRow = document.getElementById("vsRow"); vsRow.innerHTML = "";
  vsRow.className = "flex justify-center items-center gap-6 md:gap-8 flex-wrap";

  // ✅ Notes quick category +/- helper (writes into notes box)
  const NOTE_CATEGORIES = [
    "عناصر",
    "سلاح",
    "غير حي",
    "ساحر",
    "حيوان",
    "فضائي",
    "بشري",
    "ماء",
    "نار",
    "ثلج",
    "برق",
    "ارض",
    "بطل",
    "شرير",
    "دفاع",
    "هجوم",
    "زعيم",
    "مجموعة",
    "تراكم"
  ];

  // ===== NEW: per-player quick counters + last selected persistence =====
  const NOTE_STATE_KEY = (player) => `noteState:${player}`;
  const QUICK_COUNTS_KEY = (player) => `quickCounts:${player}`;

  function loadNoteState(player) {
    try { return JSON.parse(localStorage.getItem(NOTE_STATE_KEY(player)) || "{}") || {}; }
    catch { return {}; }
  }
  function saveNoteState(player, state) {
    localStorage.setItem(NOTE_STATE_KEY(player), JSON.stringify(state || {}));
  }

  function loadQuickCounts(player) {
    try { return JSON.parse(localStorage.getItem(QUICK_COUNTS_KEY(player)) || "{}") || {}; }
    catch { return {}; }
  }
  function saveQuickCounts(player, obj) {
    localStorage.setItem(QUICK_COUNTS_KEY(player), JSON.stringify(obj || {}));
  }

  // rebuild textarea: quick lines first + keep any manual notes below

  function applyDelta(player, cat, delta) {
    const key = NOTES_KEY(player);
    const base = String(localStorage.getItem(key) || "").replace(/\r/g, "");
    const lines = base.split("\n").filter(Boolean);

    let found = false;
    const nextLines = [];

    for (let line of lines) {
      const m = line.match(/^([+\-])(\d+)\s+(.*)$/);
      if (m && m[3] === cat) {
        const cur = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
        const next = cur + delta;

        if (next !== 0) {
          const sign = next > 0 ? "+" : "-";
          nextLines.push(`${sign}${Math.abs(next)} ${cat}`);
        }
        found = true;
      } else {
        nextLines.push(line); // ✅ لا نلمس باقي السطور
      }
    }

    // لو ما كان موجود أصلاً
    if (!found && delta !== 0) {
      const sign = delta > 0 ? "+" : "-";
      nextLines.unshift(`${sign}${Math.abs(delta)} ${cat}`);
    }

    const result = nextLines.join("\n");
    localStorage.setItem(key, result);
    return result;
  }



  function removeNegativeLine(player, cat) {
    const key = NOTES_KEY(player);
    const base = String(localStorage.getItem(key) || "");

    const cleaned = base
      .split("\n")
      .filter(line => {
        const t = line.trim();
        // احذف فقط السطر: -رقم <اسم الفئة>
        return !new RegExp(`^-[ ]*\\d+[ ]+${cat}$`).test(t);
      })
      .join("\n")
      .trim();

    localStorage.setItem(key, cleaned);
    return cleaned;
  }

  // Find the notes textarea for a given player name (without rebuilding the VS row)
  function findNotesTextarea(playerName) {
    const all = Array.from(document.querySelectorAll('textarea[data-player]'));
    return all.find(t => t.dataset.player === playerName) || null;
  }

  const side = (name, mediaUrl, pos /* 'left' | 'right' */) => {
    const wrap = document.createElement("div"); wrap.className = "flex flex-col items-center";
    const label = document.createElement("div"); label.className = "text-yellow-300 font-extrabold text-xl mb-2"; label.textContent = name;
    const card = document.createElement("div"); card.className = "w-80 md:w-96 h-[26rem] md:h-[30rem] overflow-hidden flex items-center justify-center";
    const media = createMedia(mediaUrl, "w-full h-full object-contain", true); card.appendChild(media);

    // 🔊 map correctly: left = player2, right = player1
    if (window.WebmSfx && /\.webm(\?|#|$)/i.test(mediaUrl || "")) {
      if (typeof window.WebmSfx.markSide === "function") window.WebmSfx.markSide(pos, mediaUrl);
    }

    // Notes + quick category selector (+/-)
    const notesWrap = document.createElement("div");
    notesWrap.className = "mt-3 w-80 md:w-96";

    const controls = document.createElement("div");
    controls.className = "mb-2 flex items-center gap-2";

    const catSelect = document.createElement("select");
    const targetSelect = document.createElement("select");
    targetSelect.className =
      "bg-transparent text-white border-2 border-yellow-600 rounded-lg px-2 py-2 text-sm";

    [
      { value: "self", label: "لك" },
      { value: "enemy", label: "للخصم" },
      { value: "both", label: "للكل" }
    ].forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      opt.style.background = "#3a0b18";
      targetSelect.appendChild(opt);
    });

    catSelect.className = "flex-1 bg-transparent text-white border-2 border-yellow-600 rounded-lg px-2 py-2 text-sm";
    NOTE_CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      opt.style.background = "#3a0b18"; // improves readability in some browsers
      catSelect.appendChild(opt);
    });

    const amountWrap = document.createElement("div");
    amountWrap.className = "amount-wrap";

    const amount = document.createElement("input");
    amount.type = "number";
    amount.value = "1";
    amount.min = "1";
    amount.max = "99";

    const arrows = document.createElement("div");
    arrows.className = "amount-arrows";

    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "▲";

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "▼";

    const clamp = () => {
      let n = parseInt(amount.value || "1", 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 99) n = 99;
      amount.value = n;
    };

    up.onclick = () => { amount.value++; clamp(); };
    down.onclick = () => { amount.value--; clamp(); };
    amount.addEventListener("input", clamp);

    arrows.appendChild(up);
    arrows.appendChild(down);

    amountWrap.appendChild(amount);
    amountWrap.appendChild(arrows);

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "btn-gold btn-ico btn-inc w-10 h-10";
    btnPlus.innerHTML = "<span class='text-2xl leading-none'>+</span>";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "btn-gold btn-ico btn-dec w-10 h-10";
    btnMinus.innerHTML = "<span class='text-2xl leading-none'>−</span>";

    const notes = document.createElement("textarea");
    notes.className = "w-full h-24 bg-transparent text-white border-2 border-yellow-600 rounded-lg p-3 placeholder:opacity-70 overflow-y-auto no-scrollbar";
    notes.placeholder = "ملاحظات";
    notes.value = localStorage.getItem(NOTES_KEY(name)) || "";
    notes.addEventListener("input", () => { localStorage.setItem(NOTES_KEY(name), notes.value); broadcast(); });

    // Tag textarea so we can update it without re-rendering (prevents .webm restart)
    notes.dataset.player = name;
    notes.dataset.side = pos;

    // ✅ restore last selected state for THIS player side (cat/target/amount)
    const st = loadNoteState(name);
    if (st && typeof st === "object") {
      if (st.cat && NOTE_CATEGORIES.includes(st.cat)) catSelect.value = st.cat;
      if (st.target) targetSelect.value = st.target;
      if (st.amount) amount.value = String(st.amount);
    }
    clamp();

    // ✅ keep saving selections so they don't reset after renderVsRow()
    catSelect.addEventListener("change", () => saveNoteState(name, { ...loadNoteState(name), cat: catSelect.value }));
    targetSelect.addEventListener("change", () => saveNoteState(name, { ...loadNoteState(name), target: targetSelect.value }));
    amount.addEventListener("input", () => saveNoteState(name, { ...loadNoteState(name), amount: amount.value }));

    const readAmount = () => {
      const n = parseInt(String(amount.value || "1"), 10);
      if (!Number.isFinite(n) || n <= 0) return 1;
      return Math.min(99, n);
    };

    // ✅ NEW: arithmetic counter +/- (no duplicate lines; decreases remove)
    const adjustCounter = (sign) => {
      const cat = String(catSelect.value || "").trim();
      if (!cat) return;

      const n = readAmount();
      const delta = sign === "+" ? n : -n;
      const target = targetSelect.value;

      // persist last-used selection for this player side
      saveNoteState(name, { cat: catSelect.value, target: targetSelect.value, amount: amount.value });

      const selfPlayer  = name;
      const enemyPlayer = pos === "left" ? player1 : player2;

      const updateOne = (playerName) => {
        const txt = applyDelta(playerName, cat, delta);

        // ✅ update any existing textarea in-place (no re-render -> no .webm restart)
        const ta = findNotesTextarea(playerName);
        if (ta) ta.value = txt;
      };

      if (target === "self") {
        updateOne(selfPlayer);
      } else if (target === "enemy") {
        updateOne(enemyPlayer);
      } else if (target === "both") {
        updateOne(selfPlayer);
        updateOne(enemyPlayer);
      }

      // ✅ Only broadcast state; do NOT rebuild the VS row (rebuilding restarts webm)
      broadcast();
    };

    btnPlus.addEventListener("click", () => adjustCounter("+"));
    btnMinus.addEventListener("click", () => adjustCounter("-"));

    controls.appendChild(catSelect);
    controls.appendChild(targetSelect);
    controls.appendChild(amountWrap);
    controls.appendChild(btnMinus);
    controls.appendChild(btnPlus);
    notesWrap.appendChild(controls);
    notesWrap.appendChild(notes);

    wrap.appendChild(label); wrap.appendChild(card); wrap.appendChild(notesWrap); return wrap;
  };

  const left  = side(player2, picks?.[player2]?.[round], "left");
  const right = side(player1, picks?.[player1]?.[round], "right");
  const vs = document.createElement("div"); vs.className = "self-center flex items-center justify-center";
  vs.innerHTML = `<div class="text-yellow-400 font-extrabold text-5xl mx-2 leading-none">VS</div>`;
  vsRow.appendChild(left); vsRow.appendChild(vs); vsRow.appendChild(right);

  // relabel replay buttons correctly
  const leftBtn  = document.getElementById("sfxReplayLeft");
  const rightBtn = document.getElementById("sfxReplayRight");
  if (leftBtn)  leftBtn.textContent  = `🔊 ${player2}`;
  if (rightBtn) rightBtn.textContent = `🔊 ${player1}`;

  broadcast();
}

// ===== Health & OK badges =====
function wireHealthControls(name, decBtn, incBtn, label) {
  const clamp = (n) => Math.max(0, Math.min(startingHP, n));
  const refresh = () => { label.textContent = String(scores[name]); };
  decBtn.onclick = () => { scores[name] = clamp((scores[name] ?? startingHP) - 1); refresh(); localStorage.setItem("scores", JSON.stringify(scores)); broadcast(); };
  incBtn.onclick = () => { scores[name] = clamp((scores[name] ?? startingHP) + 1); refresh(); localStorage.setItem("scores", JSON.stringify(scores)); broadcast(); };
  refresh();
}

function showOkBadge(side) {
  const el = side === "left" ? document.getElementById("p2OkAlert") : document.getElementById("p1OkAlert");
  if (!el) return;
  el.textContent = "تمام";
  el.classList.remove("hidden");
}

function hideOkBadge(side) {
  const el = side === "left" ? document.getElementById("p2OkAlert") : document.getElementById("p1OkAlert");
  if (el) el.classList.add("hidden");
}
function resetOkBadges() { hideOkBadge("left"); hideOkBadge("right"); }

// ===== Render page =====
function renderRound() {
  roundTitle.textContent = `الجولة ${round + 1}`;
  renderVsRow();
  renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
  renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
  renderPrevGrid(document.getElementById("prevLeftGrid"),  getPreviousUrls(player2));
  renderPrevGrid(document.getElementById("prevRightGrid"), getPreviousUrls(player1));

  wireHealthControls(player2, document.getElementById("p2Dec"), document.getElementById("p2Inc"), document.getElementById("p2Health"));
  wireHealthControls(player1, document.getElementById("p1Dec"), document.getElementById("p1Inc"), document.getElementById("p1Health"));

  resetOkBadges();
  syncServerAbilities();
  broadcast();
}

// ===== Next round / confirm =====
function goToRound(newIndex) {
  const maxIndex = Math.max(0, Math.min(roundCount - 1, newIndex));
  round = maxIndex;
  localStorage.setItem("currentRound", String(round));

  try { window.WebmSfx && window.WebmSfx._resetForNewRound && window.WebmSfx._resetForNewRound(); } catch {}

  renderRound();
}
function confirmWinner() {
  localStorage.setItem("scores", JSON.stringify(scores));
  const next = round + 1;
  const gameOver = next >= roundCount || scores[player1] === 0 || scores[player2] === 0;

  socket?.emit("confirmRoundResult", { gameID, round, snapshot: buildSnapshot() });

  if (gameOver) {
    let winner = null;
    let isTie = false;
    if ((scores[player1] ?? 0) > (scores[player2] ?? 0)) winner = player1;
    else if ((scores[player2] ?? 0) > (scores[player1] ?? 0)) winner = player2;
    else isTie = true;

    try {
      if (socket && gameID) {
        socket.emit("gameOver", {
          gameID,
          scores: { [player1]: scores[player1], [player2]: scores[player2] },
          winner,
          isTie,
          roundCount
        });
        socket.emit("submitFinalScores", {
          gameID,
          scores: { [player1]: scores[player1], [player2]: scores[player2] }
        });
      }
    } catch {}

    localStorage.removeItem(NOTES_KEY(player1));
    localStorage.removeItem(NOTES_KEY(player2));
    location.href = "score.html";
  } else {
    try { if (socket && gameID) socket.emit("startRound", { gameID, round: next }); } catch {}
    goToRound(next);
  }
}
window.confirmWinner = confirmWinner;

// ===== transfer modal =====
function openTransferModal(fromKey, fromName, toName){
  const list  = loadAbilities(fromKey);
  const modal = document.getElementById("transferModal");
  const grid  = document.getElementById("abilityGrid");
  const title = document.getElementById("transferTitle");
  title.textContent = `اختر القدرة المراد نقلها إلى ${toName}`;
  const toKey = (fromKey === P1_ABILITIES_KEY) ? P2_ABILITIES_KEY : P1_ABILITIES_KEY;
  grid.innerHTML = "";
  if (!list.length){
    const p = document.createElement("p"); p.className = "text-yellow-200 text-center py-2"; p.textContent = "لا توجد قدرات لنقلها."; grid.appendChild(p);
  } else {
    normalizeAbilityList(list).forEach((ab, idx)=>{
      const btn = document.createElement("button");
      btn.className = "w-full text-center px-3 py-2 rounded-lg border-2 border-yellow-500 bg-[#7b2131] hover:bg-[#8b2a3a] font-bold";
      btn.textContent = ab.text + (ab.used ? " (مستخدمة)" : "");
      btn.onclick = ()=>{
        const sender = normalizeAbilityList(loadAbilities(fromKey));
        const moved  = sender.splice(idx, 1)[0];
        saveAbilities(fromKey, sender);
        const receiver = normalizeAbilityList(loadAbilities(toKey)); receiver.push({ text: moved.text, used: !!moved.used });
        saveAbilities(toKey, receiver);
        closeTransferModal();
        renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
        renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
        syncServerAbilities();
        broadcast();
        showToast(`✅ تم نقل «${moved.text}» إلى ${toName}`);
      };
      grid.appendChild(btn);
    });
  }
  modal.classList.remove("hidden"); modal.classList.add("flex");
}
function closeTransferModal(){
  const modal = document.getElementById("transferModal");
  modal.classList.add("hidden"); modal.classList.remove("flex");
}
window.openTransferModal = openTransferModal;
window.closeTransferModal = closeTransferModal;

/* ===== abilities persistence to server (NEW) ===== */
async function persistAbilityToServer(text) {
  try {
    if (!text || !text.trim()) return;
    const r = await fetch("/api/abilities/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn("[abilities] server persist failed:", r.status, t);
      showToast("⚠️ لم يتم الحفظ في السيرفر (سيتم حفظها محليًا فقط).");
    }
  } catch (e) {
    console.warn("[abilities] persist error:", e);
    showToast("⚠️ خطأ أثناء الحفظ في السيرفر.");
  }
}

// ===== Quick Add Ability modal =====
let _addTargetKey = null;
function openAddAbilityModal(targetKey, playerLabel) {
  _addTargetKey = targetKey;
  const modal = document.getElementById("addAbilityModal");
  const input = document.getElementById("addAbilityInput");
  if (!modal || !input) return;
  input.value = "";
  input.placeholder = `اكتب نص قدرة لإضافتها لـ ${playerLabel}…`;
  modal.classList.remove("hidden"); modal.classList.add("flex");
  setTimeout(() => input.focus(), 0);
}
function closeAddAbilityModal() {
  const modal = document.getElementById("addAbilityModal");
  if (!modal) return;
  modal.classList.add("hidden"); modal.classList.remove("flex");
  _addTargetKey = null;
}
async function confirmAddAbility() {
  const input = document.getElementById("addAbilityInput");
  if (!_addTargetKey || !input) return;
  const text = String(input.value || "").trim();
  if (!text) { input.focus(); return; }

  // ✅ allow duplicates: no local duplicate check
  const list = normalizeAbilityList(loadAbilities(_addTargetKey));
  list.push({ text, used: false });
  saveAbilities(_addTargetKey, list);

  // re-render + sync sockets
  if (_addTargetKey === P1_ABILITIES_KEY) {
    renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
  } else {
    renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
  }
  syncServerAbilities();
  broadcast();

  // persist globally (abilities.json)
  await persistAbilityToServer(text);

  // UX
  showToast(`✅ تمت إضافة «${text}».`);
  closeAddAbilityModal();
}
window.openAddAbilityModal = openAddAbilityModal;
window.closeAddAbilityModal = closeAddAbilityModal;
window.confirmAddAbility  = confirmAddAbility;

// ===== ability requests + OK alerts =====
if (socket && gameID) {
  socket.on("abilityRequested", handleRequest);
  socket.on("requestUseAbility", handleRequest);

  function handleRequest({ playerName, abilityText, requestId }) {
    const key = playerName === player1 ? P1_ABILITIES_KEY : P2_ABILITIES_KEY;
    const list = normalizeAbilityList(loadAbilities(key));
    const index = list.findIndex(a => a.text === abilityText);
    if (index === -1 || list[index].used) {
      socket.emit("abilityRequestResult", { gameID, requestId, ok:false, reason: index === -1 ? "ability_not_found" : "already_used" });
      return;
    }
    showToast(`❗ ${playerName} يطلب استخدام القدرة: «${abilityText}»`, [
      {
        label: "استعمال",
        onClick: () => {
          const cur = normalizeAbilityList(loadAbilities(key));
          if (!cur[index]) return;
          cur[index].used = true; saveAbilities(key, cur);
          renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
          renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
          syncServerAbilities(); broadcast();
          socket.emit("abilityRequestResult", { gameID, requestId, ok: true });
        }
      }
    ], {
      label: "رفض",
      onClick: () => socket.emit("abilityRequestResult", { gameID, requestId, ok:false, reason:"rejected" })
    });
  }

  // OK badges; also remember state for viewers and broadcast
  socket.on("playerOk", (payload = {}) => {
    const { gameID: g, playerName, side } = payload;
    const active = Object.prototype.hasOwnProperty.call(payload, "active")
      ? !!payload.active
      : true; // legacy ON
    if (g && gameID && g !== gameID) return;
    if (side === "left")  okState.left  = { active, playerName };
    if (side === "right") okState.right = { active, playerName };
    if (active === false) hideOkBadge(side); else showOkBadge(side, playerName);
    broadcast();
  });
}

// ===== Initial render =====
renderRound();