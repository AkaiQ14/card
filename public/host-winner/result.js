// --- Game state ---
const roundCount  = parseInt(localStorage.getItem("roundCount") || localStorage.getItem("totalRounds"));
const startingHP  = parseInt(localStorage.getItem("totalRounds"));

const player1 = localStorage.getItem("player1") || "لاعب 1"; // logical Player 1 (will render on RIGHT)
const player2 = localStorage.getItem("player2") || "لاعب 2"; // logical Player 2 (will render on LEFT)
const picks   = JSON.parse(localStorage.getItem("picks") || "{}");
let round     = parseInt(localStorage.getItem("currentRound") || "0");

// Scores init/persist
let scores = JSON.parse(localStorage.getItem("scores") || "{}");
if (Object.keys(scores).length === 0 || round === 0) {
  scores[player1] = startingHP;
  scores[player2] = startingHP;
}

const roundTitle = document.getElementById("roundTitle");

// Ability storage keys
const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";

// Notes storage key helper
const NOTES_KEY = (name) => `notes:${name}`;

// ===== socket + room join =====
const gameID = localStorage.getItem("gameID");
const socket = typeof io !== "undefined" ? io() : null;

function safeJoinRoom(){
  if (!socket || !gameID) return;
  socket.emit("joinGame", { gameID, role: "host" });
}
if (socket) {
  socket.on("connect", safeJoinRoom);
  // a couple of retries in case of slow room middleware
  setTimeout(safeJoinRoom, 300);
  setTimeout(safeJoinRoom, 1000);
}

// ===== toast helper =====
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
    if (closeOverride && closeOverride.label) {
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

// --- Helpers ---
function loadAbilities(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveAbilities(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function syncServerAbilities(){
  if (!socket || !gameID) return;
  const abilities = {
    [player1]: loadAbilities(P1_ABILITIES_KEY),
    [player2]: loadAbilities(P2_ABILITIES_KEY)
  };
  socket.emit("setAbilities", { gameID, abilities });
}

function findAbilityIndexByText(list, text) {
  return list.findIndex(a => (a?.text || "").trim() === text.trim());
}
function isAbilityAvailable(forPlayerName, abilityText) {
  const key = forPlayerName === player1 ? P1_ABILITIES_KEY : P2_ABILITIES_KEY;
  const list = loadAbilities(key);
  const i = findAbilityIndexByText(list, abilityText);
  if (i === -1) return { exists:false, used:true, key, index:-1, list };
  return { exists:true, used: !!list[i].used, key, index:i, list };
}

// media: webm => video
function createMedia(url, className, playSfx = false) {
  const isWebm = /\.webm(\?|#|$)/i.test(url || "");
  if (isWebm) {
    const v = document.createElement("video");
    v.src = url;
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.className = className;
    if (playSfx && window.WebmSfx) {
      window.WebmSfx.attachToMedia(v, url);
    }
    return v;
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.className = className;
    return img;
  }
}

// Ability row (toggle used)
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

/** Ensure only 3 ability buttons are visible; extra ones are scrollable */
function applyThreeItemScroll(container) {
  const items = Array.from(container.children).filter(el => el.tagName === "BUTTON");
  if (items.length <= 3) {
    container.style.maxHeight = "";
    container.style.overflowY = "";
    return;
  }
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const el = items[i];
    const cs = getComputedStyle(el);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    total += el.offsetHeight + mt + mb;
  }
  container.style.maxHeight = Math.ceil(total) + "px";
  container.style.overflowY = "auto";
}

function renderAbilities(storageKey, container) {
  const abilities = loadAbilities(storageKey);
  container.innerHTML = "";
  if (!abilities.length) {
    const p = document.createElement("p");
    p.className = "opacity-70 text-sm";
    p.textContent = "لا توجد قدرات";
    container.appendChild(p);
    container.style.maxHeight = "";
    return;
  }
  abilities.forEach((ab, idx) => {
    const btn = abilityRow(ab, () => {
      const current = loadAbilities(storageKey);
      if (!current[idx]) return;
      current[idx].used = !current[idx].used;
      saveAbilities(storageKey, current);
      renderAbilities(storageKey, container);
      syncServerAbilities();
      broadcastSnapshot(); // <-- update viewers
    });
    container.appendChild(btn);
  });
  applyThreeItemScroll(container);
}

// === server add endpoint ===
async function addAbilityOnServer(text) {
  const r = await fetch("/api/abilities/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!r.ok) throw new Error("add failed");
  const data = await r.json();
  return Array.isArray(data?.abilities) ? data.abilities : [];
}

/* ----- Quick Add Ability Modal ----- */
let addTargetKey = null;
let addTargetName = null;

function openAddAbilityModal(localKey, playerName) {
  addTargetKey = localKey;
  addTargetName = playerName;
  document.getElementById("addAbilityInput").value = "";
  const m = document.getElementById("addAbilityModal");
  m.classList.remove("hidden");
  m.classList.add("flex");
  setTimeout(() => document.getElementById("addAbilityInput").focus(), 0);
}
function closeAddAbilityModal() {
  const m = document.getElementById("addAbilityModal");
  m.classList.add("hidden");
  m.classList.remove("flex");
}
function confirmAddAbility() {
  const input = document.getElementById("addAbilityInput");
  const text = (input.value || "").trim();
  if (!text) return;

  addAbilityOnServer(text)
    .then(() => {
      const arr = loadAbilities(addTargetKey);
      arr.push({ text, used: false });
      saveAbilities(addTargetKey, arr);
      // re-render both sides
      renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
      renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
      syncServerAbilities();
      broadcastSnapshot(); // <-- update viewers
      showToast(`✅ تمت إضافة «${text}» إلى ${addTargetName}`);
      closeAddAbilityModal();
    })
    .catch(() => {
      showToast("تعذر اضافة القدرة.");
    });
}

// Previous cards
function getPreviousUrls(name) {
  const arr = Array.isArray(picks?.[name]) ? picks[name] : [];
  return arr.filter((_, i) => i < round);
}

function renderPrevGrid(container, urls) {
  container.innerHTML = "";
  urls.forEach(src => {
    const cell = document.createElement("div");
    cell.className = "w-24 h-32 rounded-md overflow-hidden";
    const m = createMedia(src, "w-full h-full object-contain");
    cell.appendChild(m);
    container.appendChild(cell);
  });
}

// VS row with names, big cards, notes
function renderVsRow() {
  // Reset per-side SFX lists each round (if provided by webm-sfx.js)
  if (window.WebmSfx) {
    if (!window.WebmSfx.perSide) window.WebmSfx.perSide = { left: [], right: [] };
    window.WebmSfx.perSide.left = [];
    window.WebmSfx.perSide.right = [];
  }

  const vsRow = document.getElementById("vsRow");
  vsRow.innerHTML = "";
  vsRow.className = "flex justify-center items-center gap-6 md:gap-8 flex-wrap";

  const side = (name, mediaUrl, pos /* 'left' | 'right' */) => {
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col items-center";
    const label = document.createElement("div");
    label.className = "text-yellow-300 font-extrabold text-xl mb-2";
    label.textContent = name;

    const card = document.createElement("div");
    card.className = "w-80 md:w-96 h-[26rem] md:h-[30rem] overflow-hidden flex items-center justify-center";
    const media = createMedia(mediaUrl, "w-full h-full object-contain", true);
    card.appendChild(media);

    // Map sounds to their visual sides for replay buttons
    if (window.WebmSfx && /\.webm(\?|#|$)/i.test(mediaUrl || "")) {
      if (typeof window.WebmSfx.markSide === "function") {
        window.WebmSfx.markSide(pos, mediaUrl);
      }
    }

    const notes = document.createElement("textarea");
    notes.className = "mt-3 w-80 md:w-96 h-32 bg-transparent text-white border-2 border-yellow-600 rounded-lg p-3 placeholder:opacity-70 overflow-y-auto no-scrollbar";
    notes.placeholder = "ملاحظات";
    notes.value = localStorage.getItem(NOTES_KEY(name)) || "";
    let notesTimer = null;
    notes.addEventListener("input", () => {
      localStorage.setItem(NOTES_KEY(name), notes.value);
      clearTimeout(notesTimer);
      notesTimer = setTimeout(broadcastSnapshot, 120); // debounce a bit
    });

    wrap.appendChild(label);
    wrap.appendChild(card);
    wrap.appendChild(notes);
    return wrap;
  };

  // ✅ Visual LEFT shows player2, RIGHT shows player1 (to align with replay buttons)
  const left  = side(player2, picks?.[player2]?.[round], "left");
  const right = side(player1, picks?.[player1]?.[round], "right");

  const vs = document.createElement("div");
  vs.className = "self-center flex items-center justify-center";
  vs.innerHTML = `<div class="text-yellow-400 font-extrabold text-5xl mx-2 leading-none">VS</div>`;

  vsRow.appendChild(left);
  vsRow.appendChild(vs);
  vsRow.appendChild(right);
}

// Wire replay buttons once
function wireReplayButtons() {
  const leftBtn  = document.getElementById("sfxReplayLeft");
  const rightBtn = document.getElementById("sfxReplayRight");
  if (!leftBtn || !rightBtn) return;

  // Literal mapping: left button => left side, right button => right side
  leftBtn.onclick = () => {
    if (window.WebmSfx && typeof window.WebmSfx.playSide === "function") {
      window.WebmSfx.playSide("left");
    }
  };
  rightBtn.onclick = () => {
    if (window.WebmSfx && typeof window.WebmSfx.playSide === "function") {
      window.WebmSfx.playSide("right");
    }
  };
}

/* ========= OK state & badges ========= */
let okState = { left: { active:false, playerName:null }, right: { active:false, playerName:null } };

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

// ===== Snapshot builder & broadcaster =====
function buildSnapshot(){
  const snapshot = {
    round,
    player1,
    player2,

    // visual LEFT = player2, RIGHT = player1
    currentLeftUrl:  picks?.[player2]?.[round] || "",
    currentRightUrl: picks?.[player1]?.[round] || "",

    prevLeft:  getPreviousUrls(player2),
    prevRight: getPreviousUrls(player1),

    scores: { ...scores },

    abilities: {
      [player1]: loadAbilities(P1_ABILITIES_KEY),
      [player2]: loadAbilities(P2_ABILITIES_KEY)
    },

    notes: {
      [player1]: localStorage.getItem(NOTES_KEY(player1)) || "",
      [player2]: localStorage.getItem(NOTES_KEY(player2)) || ""
    },

    ok: okState
  };
  return snapshot;
}

function broadcastSnapshot(){
  if (!socket || !gameID) return;
  const snapshot = buildSnapshot();
  socket.emit("resultSnapshot", { gameID, snapshot });
}

// --- Render page ---
function renderRound() {
  roundTitle.textContent = `الجولة ${round + 1}`;

  renderVsRow();

  renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
  renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));

  // Previous cards: LEFT pane shows player2 history, RIGHT pane shows player1 history
  renderPrevGrid(document.getElementById("prevLeftGrid"),  getPreviousUrls(player2));
  renderPrevGrid(document.getElementById("prevRightGrid"), getPreviousUrls(player1));

  wireHealthControls(
    player2,
    document.getElementById("p2Dec"),
    document.getElementById("p2Inc"),
    document.getElementById("p2Health")
  );
  wireHealthControls(
    player1,
    document.getElementById("p1Dec"),
    document.getElementById("p1Inc"),
    document.getElementById("p1Health")
  );

  // Label replay buttons with the player names on those visual sides
  const leftBtn  = document.getElementById("sfxReplayLeft");
  const rightBtn = document.getElementById("sfxReplayRight");
  if (leftBtn)  leftBtn.textContent  = `🔊 ${player2}`;
  if (rightBtn) rightBtn.textContent = `🔊 ${player1}`;
  wireReplayButtons();

  resetOkBadges();   // <— clear per round

  syncServerAbilities();
  broadcastSnapshot(); // initial push
}

function confirmWinner() {
  localStorage.setItem("scores", JSON.stringify(scores));
  round++;
  localStorage.setItem("currentRound", round);

  const over = round >= roundCount || scores[player1] === 0 || scores[player2] === 0;

  if (over) {
    if (socket && gameID) {
      try {
        const a = Number(scores[player1] || 0);
        const b = Number(scores[player2] || 0);
        const payload = a === b
          ? { isTie: true, scores: { ...scores } }
          : { winner: a > b ? player1 : player2, scores: { ...scores } };
        socket.emit("gameOver", { gameID, ...payload });
      } catch {}
    }

    try {
      if (socket && gameID) {
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
    broadcastSnapshot();
    location.reload();
  }
}

/* ===== Transfer modal (click = transfer) ===== */
function openTransferModal(fromKey, fromName, toName){
  const list  = loadAbilities(fromKey);
  const modal = document.getElementById("transferModal");
  const grid  = document.getElementById("abilityGrid");
  const title = document.getElementById("transferTitle");
  title.textContent = `اختر القدرة المراد نقلها إلى ${toName}`;

  const toKey = (fromKey === P1_ABILITIES_KEY) ? P2_ABILITIES_KEY : P1_ABILITIES_KEY;

  grid.innerHTML = "";
  if (!list.length){
    const p = document.createElement("p");
    p.className = "text-yellow-200 text-center py-2";
    p.textContent = "لا توجد قدرات لنقلها.";
    grid.appendChild(p);
  } else {
    list.forEach((ab, idx)=>{
      const btn = document.createElement("button");
      btn.className = "w-full text-center px-3 py-2 rounded-lg border-2 border-yellow-500 bg-[#7b2131] hover:bg-[#8b2a3a] font-bold";
      btn.textContent = ab.text;
      btn.onclick = ()=>{
        const sender = loadAbilities(fromKey);
        const moved  = sender.splice(idx, 1)[0];
        saveAbilities(fromKey, sender);

        const receiver = loadAbilities(toKey);
        receiver.push({ text: moved.text, used: moved.used });
        saveAbilities(toKey, receiver);

        closeTransferModal();
        renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
        renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
        syncServerAbilities();
        broadcastSnapshot();
        showToast(`✅ تم نقل «${moved.text}» إلى ${toName}`);
      };
      grid.appendChild(btn);
    });
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeTransferModal(){
  const modal = document.getElementById("transferModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

// Health controls
function wireHealthControls(name, decBtn, incBtn, label) {
  const clamp = (n) => Math.max(0, Math.min(startingHP, n));
  const refresh = () => { label.textContent = String(scores[name]); };

  decBtn.onclick = () => {
    scores[name] = clamp(scores[name] - 1);
    refresh();
    localStorage.setItem("scores", JSON.stringify(scores));
    broadcastSnapshot();
  };
  incBtn.onclick = () => {
    scores[name] = clamp(scores[name] + 1);
    refresh();
    localStorage.setItem("scores", JSON.stringify(scores));
    broadcastSnapshot();
  };

  refresh();
}

/* ===== Host listens for ability requests (Approve or Refuse) ===== */
if (socket && gameID) {
  socket.emit("hostWatchAbilityRequests", { gameID });

  const handleRequest = ({ playerName, abilityText, requestId }) => {
    const { exists, used, key, index } = isAbilityAvailable(playerName, abilityText);

    if (!exists || used) {
      socket.emit("abilityRequestResult", {
        gameID,
        requestId,
        ok: false,
        reason: exists ? "already_used" : "ability_not_found"
      });
      return;
    }

    showToast(`❗ ${playerName} يطلب استخدام القدرة: «${abilityText}»`, [
      {
        label: "استعمال",
        onClick: () => {
          const current = loadAbilities(key);
          if (!current[index]) return;
          current[index].used = true; // ✅ bugfix (was idx)
          saveAbilities(key, current);
          renderAbilities(P2_ABILITIES_KEY, document.getElementById("p2Abilities"));
          renderAbilities(P1_ABILITIES_KEY, document.getElementById("p1Abilities"));
          syncServerAbilities();
          broadcastSnapshot();
          socket.emit("abilityRequestResult", { gameID, requestId, ok: true });
        }
      }
    ], {
      label: "رفض",
      onClick: () => {
        socket.emit("abilityRequestResult", {
          gameID,
          requestId,
          ok: false,
          reason: "rejected"
        });
      }
    });
  };

  socket.on("abilityRequested", handleRequest);
  socket.on("requestUseAbility", handleRequest);

  socket.on("requestResultSnapshot", () => {
    broadcastSnapshot();
  });

  // ===== Listen for players toggling OK =====
  socket.on("playerOk", (payload = {}) => {
    const { gameID: g, playerName, side } = payload;
    const active = Object.prototype.hasOwnProperty.call(payload, "active") ? !!payload.active : true;
    if (g && g !== gameID) return;
    if (side === "left")  okState.left  = { active, playerName };
    if (side === "right") okState.right = { active, playerName };
    if (active === false) hideOkBadge(side); else showOkBadge(side, playerName);
    broadcastSnapshot();
  });
}

renderRound();
