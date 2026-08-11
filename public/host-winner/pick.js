const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0;

// Each of the 20 boxes independently has a 10% chance
// to receive a legendary card. The ratio remains unchanged even with
// the full-card rotation system.
const LEGENDARY_CHANCE = 0.1;

const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const gameID = localStorage.getItem("gameID") || "default";
const PICK_SESSION_KEY =
  `pickStarted:v2:${String(gameID)}`;

let currentPlayer = parseInt(localStorage.getItem("currentPlayer") || "1", 10);

// ===== FIX: منع تخطي اللاعب الأول =====
const gameStarted = localStorage.getItem(PICK_SESSION_KEY);
const isNewPickSession = !gameStarted;
if (!gameStarted) {
  localStorage.setItem(PICK_SESSION_KEY, "true");
  localStorage.setItem("currentPlayer", "1");
  currentPlayer = 1;
}
if (currentPlayer !== 1 && currentPlayer !== 2) {
  localStorage.setItem("currentPlayer", "1");
  currentPlayer = 1;
}
// =========================================

const instruction = document.getElementById("instruction");
const boxGrid = document.getElementById("boxGrid");
const confirmBtn = document.getElementById("confirmBtn");
const selectionCountEl = document.getElementById("selectionCount");
const selectionTargetEl = document.getElementById("selectionTarget");

// Modal elements (optional if exists)
const tacticModal = document.getElementById("tacticModal");
const tacticSelectEl = document.getElementById("tacticSelect");
const tacticPicker = document.getElementById("tacticPicker");
const tacticPickerTrigger = document.getElementById("tacticPickerTrigger");
const tacticPickerText = document.getElementById("tacticPickerText");
const tacticPickerMenu = document.getElementById("tacticPickerMenu");

const BOARD_SIZE = 20;

if (selectionTargetEl) {
  selectionTargetEl.textContent = String(roundCount);
}

let imageMap = {};      // 1..20 -> {folder, filename, key, fullPath}
let selectedBoxes = []; // indices

const BOARD_STORAGE_VERSION = 2;

// ===== Full-card rotation =====
// Keeps a persistent shuffled cycle for every category so all cards in that
// category get a turn before a new cycle begins. This does NOT change the
// 20-box board size or LEGENDARY_CHANCE.
const ROTATION_STORAGE_VERSION = 1;

function rotationKey(folder) {
  return `card_rotation_v3_${String(folder)}`;
}

function createRotationState(folder, cards) {
  const unique = uniqueCards(cards);
  const cardsByKey = new Map(
    unique.map(card => [cardIdentity(card), card])
  );
  const actualKeys = Array.from(cardsByKey.keys());

  let stored = null;
  try {
    stored = JSON.parse(
      localStorage.getItem(rotationKey(folder)) || "null"
    );
  } catch {
    stored = null;
  }

  let order = [];
  let cursor = 0;

  if (
    stored &&
    stored.version === ROTATION_STORAGE_VERSION &&
    Array.isArray(stored.order) &&
    Number.isInteger(stored.cursor)
  ) {
    const actualSet = new Set(actualKeys);
    const rawOrder = stored.order
      .map(key => String(key || "").trim().toLowerCase())
      .filter(Boolean);
    const rawCursor = Math.max(0, Math.min(stored.cursor, rawOrder.length));

    const consumed = Array.from(new Set(
      rawOrder.slice(0, rawCursor).filter(key => actualSet.has(key))
    ));
    const consumedSet = new Set(consumed);
    const remaining = Array.from(new Set(
      rawOrder
        .slice(rawCursor)
        .filter(key => actualSet.has(key) && !consumedSet.has(key))
    ));
    const known = new Set([...consumed, ...remaining]);

    // Newly-added cards join the not-yet-used portion of the current cycle.
    const added = actualKeys.filter(key => !known.has(key));
    shuffleInPlace(added);
    remaining.push(...added);
    shuffleInPlace(remaining);

    order = [...consumed, ...remaining];
    cursor = consumed.length;
  } else {
    order = shuffleInPlace([...actualKeys]);
    cursor = 0;
  }

  // If the previous cycle is complete, start a fresh full-card cycle.
  if (cursor >= order.length && actualKeys.length) {
    order = shuffleInPlace([...actualKeys]);
    cursor = 0;
  }

  return { folder, cardsByKey, order, cursor };
}

function saveRotationState(state) {
  if (!state) return;

  localStorage.setItem(
    rotationKey(state.folder),
    JSON.stringify({
      version: ROTATION_STORAGE_VERSION,
      order: state.order,
      cursor: state.cursor
    })
  );
}

function drawFromRotation(state, usedKeys) {
  if (!state || !state.cardsByKey.size) return null;

  const allKeys = Array.from(state.cardsByKey.keys());

  // Start a new cycle only after the entire current one has been consumed.
  if (state.cursor >= state.order.length) {
    state.order = shuffleInPlace([...allKeys]);
    state.cursor = 0;
  }

  // Prefer the next card in the cycle. If it is already reserved in this
  // game, move another not-yet-used card forward without losing its turn.
  let foundIndex = -1;
  for (let i = state.cursor; i < state.order.length; i++) {
    const key = state.order[i];
    if (!usedKeys.has(key) && state.cardsByKey.has(key)) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    return null;
  }

  if (foundIndex !== state.cursor) {
    [state.order[state.cursor], state.order[foundIndex]] =
      [state.order[foundIndex], state.order[state.cursor]];
  }

  const key = state.order[state.cursor];
  state.cursor += 1;
  return state.cardsByKey.get(key) || null;
}

function usedCardsKey() {
  return `distributed_cards_v2_${String(gameID)}`;
}

// One stable board per player so refreshing never changes their boxes.
function boardKey(playerNumber = currentPlayer) {
  return `random_board_v2_${String(gameID)}_p${playerNumber}`;
}

if (isNewPickSession) {
  localStorage.removeItem(usedCardsKey());
  localStorage.removeItem(boardKey(1));
  localStorage.removeItem(boardKey(2));
}

// Remove the obsolete global session flag from the old system.
localStorage.removeItem("pickStarted");

// ===== Auto Clean Old Games (Fix Storage Overflow) =====
function purgeOldGameStorage(currentID) {
  const id = String(currentID);

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

    // The old deck/cursor system is no longer used.
    if (
      k.startsWith("deck_legendary_") ||
      k.startsWith("deck_legendary_pos_") ||
      k.startsWith("deck_normal_") ||
      k.startsWith("deck_normal_pos_") ||
      k.startsWith("current_board_")
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("distributed_cards_v2_") &&
      k !== `distributed_cards_v2_${id}`
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("random_board_v2_") &&
      !k.startsWith(`random_board_v2_${id}_p`)
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("pickStarted:v2:") &&
      k !== `pickStarted:v2:${id}`
    ) {
      localStorage.removeItem(k);
    }
  }
}

try {
  purgeOldGameStorage(gameID);
} catch (e) {
  console.warn("Storage cleanup failed:", e);
}
// =====================================================



const socket = io();

const playerName = currentPlayer === 1 ? player1 : player2;
instruction.textContent = `اللاعب ${playerName} اختر ${roundCount} بطاقات`;

// ---------- helpers ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ✅ صور + فيديو
function isMediaFile(f) {
  return /\.(png|jpg|jpeg|webp|gif|avif|bmp|svg|apng|webm|mp4|ogg)$/i.test(String(f));
}

async function fetchFolderList(folder) {
  const res = await fetch(`/list-images/${folder}`);
  if (!res.ok) throw new Error(`Failed to list ${folder}`);
  return res.json();
}

function makeCard(folder, filename) {
  return {
    folder,
    filename,
    key: `${folder}/${filename}`,
    fullPath: `/images/${folder}/${encodeURIComponent(filename)}`
  };
}

function cardIdentity(card) {
  return String(card?.key || card?.fullPath || "")
    .trim()
    .toLowerCase();
}

function uniqueCards(cards) {
  const seen = new Set();
  const result = [];

  for (const card of Array.isArray(cards) ? cards : []) {
    const key = cardIdentity(card);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }

  return result;
}

function loadUsedCardKeys() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(usedCardsKey()) || "[]"
    );

    return new Set(
      (Array.isArray(stored) ? stored : [])
        .map(key => String(key || "").trim().toLowerCase())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function saveUsedCardKeys(usedKeys) {
  localStorage.setItem(
    usedCardsKey(),
    JSON.stringify(Array.from(usedKeys || []))
  );
}

function loadSavedBoard(playerNumber) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(boardKey(playerNumber)) || "null"
    );

    if (
      !stored ||
      stored.version !== BOARD_STORAGE_VERSION ||
      !Array.isArray(stored.cards) ||
      stored.cards.length !== BOARD_SIZE
    ) {
      return null;
    }

    const cards = uniqueCards(stored.cards);
    return cards.length === BOARD_SIZE ? cards : null;
  } catch {
    return null;
  }
}

function saveBoard(playerNumber, cards) {
  localStorage.setItem(
    boardKey(playerNumber),
    JSON.stringify({
      version: BOARD_STORAGE_VERSION,
      cards
    })
  );
}

function reserveCards(usedKeys, cards) {
  for (const card of cards) {
    const key = cardIdentity(card);
    if (key) usedKeys.add(key);
  }
}

function buildRandomUniqueBoard(
  legendaryCards,
  normalCards,
  usedKeys
) {
  const legendaryRotation = createRotationState(
    "legendary",
    legendaryCards
  );
  const normalRotation = createRotationState(
    "normal",
    normalCards
  );

  const availableUniqueCount = uniqueCards([
    ...legendaryCards,
    ...normalCards
  ]).filter(card => !usedKeys.has(cardIdentity(card))).length;

  if (availableUniqueCount < BOARD_SIZE) {
    throw new Error(
      "لا توجد بطاقات فريدة كافية لإنشاء 20 خانة دون تكرار."
    );
  }

  const board = [];

  for (let slot = 0; slot < BOARD_SIZE; slot++) {
    // Same existing ratio: every box independently has a 10% legendary roll.
    const wantsLegendary = Math.random() < LEGENDARY_CHANCE;

    const preferredRotation = wantsLegendary
      ? legendaryRotation
      : normalRotation;

    const fallbackRotation = wantsLegendary
      ? normalRotation
      : legendaryRotation;

    let card = drawFromRotation(preferredRotation, usedKeys);

    if (!card) {
      card = drawFromRotation(fallbackRotation, usedKeys);
    }

    if (!card) {
      throw new Error(
        "تعذر إكمال اللوحة دون تكرار البطاقات."
      );
    }

    board.push(card);
    usedKeys.add(cardIdentity(card));
  }

  saveRotationState(legendaryRotation);
  saveRotationState(normalRotation);

  return board;
}

// ---------- load & render ----------
loadAndRender();

async function loadAndRender() {
  try {
    if (roundCount > BOARD_SIZE) {
      throw new Error(
        "عدد الجولات يجب ألا يتجاوز 20 جولة."
      );
    }

    const [legendaryFilesRaw, normalFilesRaw] = await Promise.all([
      fetchFolderList("legendary").catch(() => []),
      fetchFolderList("normal").catch(() => []),
    ]);

    const legendaryCards = uniqueCards(
      legendaryFilesRaw
        .filter(isMediaFile)
        .map(file => makeCard("legendary", file))
    );

    const normalCards = uniqueCards(
      normalFilesRaw
        .filter(isMediaFile)
        .map(file => makeCard("normal", file))
    );

    if (!legendaryCards.length && !normalCards.length) {
      boxGrid.innerHTML =
        `<p class="text-red-500">لا توجد ملفات كروت.</p>`;
      return;
    }

    const usedKeys = loadUsedCardKeys();

    // Reserve a valid board already created for the other player too.
    const otherPlayer = currentPlayer === 1 ? 2 : 1;
    const otherBoard = loadSavedBoard(otherPlayer);
    if (otherBoard) reserveCards(usedKeys, otherBoard);

    const savedBoard = loadSavedBoard(currentPlayer);
    let boardCards;

    if (savedBoard) {
      boardCards = savedBoard;
      reserveCards(usedKeys, boardCards);
    } else {
      const availableUniqueCount = uniqueCards([
        ...legendaryCards,
        ...normalCards
      ]).filter(
        card => !usedKeys.has(cardIdentity(card))
      ).length;

      // When player 1 starts, reserve enough unique media for both
      // 20-card boards so player 2 can never be left without a board.
      const requiredUniqueCount =
        currentPlayer === 1 && !otherBoard
          ? BOARD_SIZE * 2
          : BOARD_SIZE;

      if (availableUniqueCount < requiredUniqueCount) {
        throw new Error(
          `يلزم ${requiredUniqueCount} بطاقة فريدة متاحة لإكمال التوزيع دون تكرار، والمتوفر ${availableUniqueCount} فقط.`
        );
      }

      boardCards = buildRandomUniqueBoard(
        legendaryCards,
        normalCards,
        usedKeys
      );

      reserveCards(usedKeys, boardCards);
      saveBoard(currentPlayer, boardCards);
    }

    saveUsedCardKeys(usedKeys);

    // imageMap 1..20
    imageMap = {};
    for (let i = 1; i <= BOARD_SIZE; i++) {
      imageMap[i] = boardCards[i - 1];
    }

    renderBoxes();

  } catch (err) {
    console.error(err);
    boxGrid.innerHTML = "";
    const errorText = document.createElement("p");
    errorText.className = "text-red-500";
    errorText.textContent =
      err?.message || "خطأ في التحميل";
    boxGrid.appendChild(errorText);
  }
}

// ---------- UI ----------
function renderBoxes() {
  boxGrid.innerHTML = "";
  selectedBoxes = [];
  updateSelectionUI();

  for (let i = 1; i <= BOARD_SIZE; i++) {
    const btn = document.createElement("button");
    btn.type = "button";

    btn.innerHTML = `
      <span class="pick-box-visual">
        <img src="../images/qg144.png" class="pick-box-image" alt="" draggable="false">
        <span class="pick-box-number">${i}</span>
      </span>
    `;

    btn.dataset.index = i;
    btn.className = "pick-box";
    btn.setAttribute("aria-label", `اختيار الصندوق رقم ${i}`);

    btn.onclick = () => toggleBox(i, btn);
    boxGrid.appendChild(btn);
  }
}

function updateSelectionUI() {
  if (selectionCountEl) {
    selectionCountEl.textContent = String(selectedBoxes.length);
  }

  confirmBtn.classList.toggle(
    "hidden",
    selectedBoxes.length !== roundCount
  );
}

function toggleBox(index, btn) {
  if (selectedBoxes.includes(index)) {
    selectedBoxes = selectedBoxes.filter(n => n !== index);
    btn.classList.remove("is-selected");
  } else {
    if (selectedBoxes.length >= roundCount) return;

    selectedBoxes.push(index);
    btn.classList.add("is-selected");
  }

  updateSelectionUI();
}

function clearSelectionsUI() {
  document.querySelectorAll("#boxGrid button").forEach(btn => {
    const index = Number(btn.dataset.index);
    if (selectedBoxes.includes(index)) toggleBox(index, btn);
  });
}

function pickFromPool(pool) {
  // pool: array of allowed indices (1..20)
  const uniq = Array.from(new Set(pool)).filter(n => Number.isFinite(n) && n >= 1 && n <= BOARD_SIZE);
  shuffleInPlace(uniq);

  // فك تحديد الحالي
  clearSelectionsUI();

  // إذا ما يكفي، نكمّل من باقي الأرقام
  if (uniq.length < roundCount) {
    const rest = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1).filter(n => !uniq.includes(n));
    shuffleInPlace(rest);
    uniq.push(...rest);
  }

  while (selectedBoxes.length < roundCount && uniq.length) {
    const index = uniq.pop();
    const btn = document.querySelector(`#boxGrid button[data-index="${index}"]`);
    if (btn) toggleBox(index, btn);
  }
}

function randomSelect() {
  randomSound.currentTime = 0;
  randomSound.play().catch(() => {});

  // نفس منطقك الحالي: اختيار من 1..20
  clearSelectionsUI();

  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);
  shuffleInPlace(indices);

  while (selectedBoxes.length < roundCount && indices.length) {
    const index = indices.pop();
    const btn = document.querySelector(`#boxGrid button[data-index="${index}"]`);
    if (btn) toggleBox(index, btn);
  }
}

// ===================== TACTICS =====================
function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function getTacticPool(tacticId) {
  switch (tacticId) {
    case "silver":
      return [1,2,6,7,8,12,13,14,18,19,20];

    case "reverse":
      return [4,5,10,9,8,14,13,12,16,17,18];

    case "visca_lama":
      return [4,5,6,7,8,9,10,11,17,18,14];

    case "range1_11":
      return range(1, 11);

    case "range2_12":
      return range(2, 12);

    case "range3_13":
      return range(3, 13);

    case "range4_14":
      return range(4, 14);

    case "range5_15":
      return range(5, 15);

    case "range6_16":
      return range(6, 16);

    case "range7_17":
      return range(7, 17);

    case "range8_18":
      return range(8, 18);

    case "range9_19":
      return range(9, 19);

    case "range10_20":
      return range(10, 20);

    case "odds_plus_14": {
      const odds = range(1, 20).filter(n => n % 2 === 1);
      if (!odds.includes(14)) odds.push(14);
      return odds;
    }

    case "evens_plus_random": {
      const evens = range(1, 20).filter(n => n % 2 === 0);
      const odds = range(1, 20).filter(n => n % 2 === 1);
      const randomOdd = odds[Math.floor(Math.random() * odds.length)];
      if (Number.isFinite(randomOdd)) evens.push(randomOdd);
      return evens;
    }

    default:
      // fallback
      return range(1, 20);
  }
}

function closeTacticPicker() {
  if (!tacticPickerMenu || !tacticPickerTrigger) return;

  tacticPickerMenu.classList.add("hidden");
  tacticPickerTrigger.classList.remove("is-open");
  tacticPickerTrigger.setAttribute("aria-expanded", "false");
}

function openTacticPicker() {
  if (!tacticPickerMenu || !tacticPickerTrigger) return;

  tacticPickerMenu.classList.remove("hidden");
  tacticPickerMenu.scrollTop = 0;
  tacticPickerTrigger.classList.add("is-open");
  tacticPickerTrigger.setAttribute("aria-expanded", "true");
}

function initTacticPicker() {
  if (
    !tacticPicker ||
    !tacticPickerTrigger ||
    !tacticPickerText ||
    !tacticPickerMenu ||
    !tacticSelectEl
  ) {
    return;
  }

  const items = Array.from(
    tacticPickerMenu.querySelectorAll(".result-category-item")
  );

  tacticPickerTrigger.addEventListener("click", event => {
    event.stopPropagation();

    if (tacticPickerMenu.classList.contains("hidden")) {
      openTacticPicker();
    } else {
      closeTacticPicker();
    }
  });

  items.forEach(item => {
    item.addEventListener("click", event => {
      event.stopPropagation();

      const value = String(item.dataset.value || "silver");
      tacticSelectEl.value = value;
      tacticPickerText.textContent = item.textContent.trim();

      items.forEach(option => {
        const selected = option === item;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-selected", String(selected));
      });

      closeTacticPicker();
    });
  });

  document.addEventListener("click", event => {
    if (!tacticPicker.contains(event.target)) {
      closeTacticPicker();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeTacticPicker();
    }
  });
}

// Modal controls
function openTacticModal() {
  if (!tacticModal) return; // لو ما فيه مودال
  closeTacticPicker();
  tacticModal.classList.remove("hidden");
  tacticModal.classList.add("flex");
}

function closeTacticModal() {
  if (!tacticModal) return;
  closeTacticPicker();
  tacticModal.classList.add("hidden");
  tacticModal.classList.remove("flex");
}

function applyTactic() {
  const tacticId = tacticSelectEl ? tacticSelectEl.value : "silver";
  const pool = getTacticPool(tacticId);
  pickFromPool(pool);

  closeTacticModal();
}

// ===================================================

initTacticPicker();

function confirmSelection() {
  if (selectedBoxes.length !== roundCount) {
    alert("اختر العدد الصحيح");
    return;
  }

  const picks = selectedBoxes
    .map(i => imageMap[i]?.fullPath)
    .filter(Boolean);

  if (
    picks.length !== roundCount ||
    new Set(picks).size !== picks.length
  ) {
    alert("تعذر تأكيد الاختيارات: توجد بطاقة ناقصة أو متكررة.");
    return;
  }

  const playerKey = currentPlayer === 1 ? "player1" : "player2";

  socket.emit("playerSubmitPicks", {
    gameID,
    playerName,
    playerKey,
    picks
  });

  // The board is removed after submission, while its 20 cards remain
  // reserved for this game so neither player can ever receive them again.
  localStorage.removeItem(boardKey(currentPlayer));

  if (currentPlayer === 1) {
    localStorage.setItem("currentPlayer", "2");
    location.reload();
  } else {
    localStorage.removeItem("currentPlayer");
    localStorage.removeItem(PICK_SESSION_KEY);
    location.href = "wait.html";
  }
}

window.confirmSelection = confirmSelection;
window.randomSelect = randomSelect;

// expose tactics
window.openTacticModal = openTacticModal;
window.closeTacticModal = closeTacticModal;
window.applyTactic = applyTactic;