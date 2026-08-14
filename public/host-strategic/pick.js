const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0;

// Each of the 20 boxes independently keeps the original 10% chance
// to receive a legendary card.
const LEGENDARY_CHANCE = 0.1;
const BOARD_SIZE = 20;
const DISTRIBUTION_VERSION = 4;
const BOARD_STORAGE_VERSION = 4;

const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const gameID = localStorage.getItem("gameID") || "default";
const PICK_SESSION_KEY = `pickStarted:v4:${String(gameID)}`;

let currentPlayer = parseInt(localStorage.getItem("currentPlayer") || "1", 10);

// ===== Keep the existing sequential player flow =====
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

const instruction = document.getElementById("instruction");
const boxGrid = document.getElementById("boxGrid");
const confirmBtn = document.getElementById("confirmBtn");
const selectionCountEl = document.getElementById("selectionCount");
const selectionTargetEl = document.getElementById("selectionTarget");

// Modal elements
const tacticModal = document.getElementById("tacticModal");
const tacticSelectEl = document.getElementById("tacticSelect");
const tacticPicker = document.getElementById("tacticPicker");
const tacticPickerTrigger = document.getElementById("tacticPickerTrigger");
const tacticPickerText = document.getElementById("tacticPickerText");
const tacticPickerMenu = document.getElementById("tacticPickerMenu");

if (selectionTargetEl) {
  selectionTargetEl.textContent = String(roundCount);
}

let imageMap = {};      // 1..20 -> {folder, filename, key, fullPath}
let selectedBoxes = []; // indices

// =====================================================
// Daily comprehensive rotation + previous-match exclusion
// =====================================================

function getLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DAILY_KEY = getLocalDayKey();

function usedCardsKey() {
  return `distributed_cards_v4_${String(gameID)}`;
}

// Stable 20-card board per player: refresh never changes a generated board.
function boardKey(playerNumber = currentPlayer) {
  return `random_board_v4_${String(gameID)}_p${playerNumber}`;
}

function dailyRotationKey(folder) {
  return `card_rotation_v4_${String(folder)}_${DAILY_KEY}`;
}

function lastMatchKey() {
  return `last_match_played_v4_${DAILY_KEY}`;
}

function currentMatchPicksKey() {
  return `match_played_picks_v4_${String(gameID)}`;
}

if (isNewPickSession) {
  localStorage.removeItem(usedCardsKey());
  localStorage.removeItem(boardKey(1));
  localStorage.removeItem(boardKey(2));
  localStorage.removeItem(currentMatchPicksKey());
}

// Remove obsolete session flags from older versions.
localStorage.removeItem("pickStarted");

// Keep storage small without deleting today's daily rotation.
function purgeOldGameStorage(currentID) {
  const id = String(currentID);
  const keepDailySuffix = `_${DAILY_KEY}`;

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

    if (
      k.startsWith("deck_legendary_") ||
      k.startsWith("deck_legendary_pos_") ||
      k.startsWith("deck_normal_") ||
      k.startsWith("deck_normal_pos_") ||
      k.startsWith("current_board_") ||
      k.startsWith("distributed_cards_v2_") ||
      k.startsWith("random_board_v2_") ||
      k.startsWith("pickStarted:v2:")
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("distributed_cards_v4_") &&
      k !== `distributed_cards_v4_${id}`
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("random_board_v4_") &&
      !k.startsWith(`random_board_v4_${id}_p`)
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("pickStarted:v4:") &&
      k !== `pickStarted:v4:${id}`
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("match_played_picks_v4_") &&
      k !== `match_played_picks_v4_${id}`
    ) {
      localStorage.removeItem(k);
      continue;
    }

    // Daily rotations automatically reset with a new date.
    if (
      k.startsWith("card_rotation_v4_") &&
      !k.endsWith(keepDailySuffix)
    ) {
      localStorage.removeItem(k);
      continue;
    }

    if (
      k.startsWith("last_match_played_v4_") &&
      k !== lastMatchKey()
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

// Images + video cards
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

function identityFromPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";

  try {
    const decoded = decodeURIComponent(value);
    const match = decoded.match(/\/images\/(normal|legendary)\/(.+)$/i);
    if (match) {
      return `${match[1]}/${match[2]}`.toLowerCase();
    }
  } catch {}

  return value.toLowerCase();
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

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(v => String(v || "").trim())
        .filter(Boolean)
    )
  );
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

// -----------------------------------------------------
// Previous match: ONLY the actually selected/played cards
// are excluded from the immediately following match.
// -----------------------------------------------------
function loadPreviousMatchKeys() {
  try {
    const data = JSON.parse(localStorage.getItem(lastMatchKey()) || "null");

    if (
      !data ||
      data.version !== DISTRIBUTION_VERSION ||
      data.day !== DAILY_KEY ||
      String(data.gameID || "") === String(gameID) ||
      !Array.isArray(data.cards)
    ) {
      return new Set();
    }

    return new Set(
      data.cards
        .map(identityFromPath)
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function loadCurrentMatchPlayedPicks() {
  try {
    const data = JSON.parse(
      localStorage.getItem(currentMatchPicksKey()) || "{}"
    );

    return {
      player1: Array.isArray(data?.player1) ? data.player1 : [],
      player2: Array.isArray(data?.player2) ? data.player2 : []
    };
  } catch {
    return { player1: [], player2: [] };
  }
}

function saveCurrentPlayerPicks(playerKey, picks) {
  const state = loadCurrentMatchPlayedPicks();
  state[playerKey] = uniqueStrings(picks);
  localStorage.setItem(currentMatchPicksKey(), JSON.stringify(state));
  return state;
}

function finalizePreviousMatchExclusion(currentMatchState) {
  const cards = uniqueStrings([
    ...(currentMatchState?.player1 || []),
    ...(currentMatchState?.player2 || [])
  ]);

  // Save only when both players have actually submitted their selections.
  if (
    !Array.isArray(currentMatchState?.player1) ||
    !currentMatchState.player1.length ||
    !Array.isArray(currentMatchState?.player2) ||
    !currentMatchState.player2.length
  ) {
    return;
  }

  localStorage.setItem(
    lastMatchKey(),
    JSON.stringify({
      version: DISTRIBUTION_VERSION,
      day: DAILY_KEY,
      gameID: String(gameID),
      cards,
      savedAt: Date.now()
    })
  );

  localStorage.removeItem(currentMatchPicksKey());
}

// -----------------------------------------------------
// Daily category rotation
// Every card in a category is consumed once before that
// category reshuffles, except cards temporarily blocked by
// the previous match/current match. New cards join the
// unconsumed part automatically; deleted cards disappear.
// -----------------------------------------------------
function normalizeRotationState(folder, cards) {
  const pool = uniqueCards(cards);
  const validKeys = pool.map(cardIdentity).filter(Boolean);
  const validSet = new Set(validKeys);

  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(dailyRotationKey(folder)) || "null");
  } catch {}

  if (
    !raw ||
    raw.version !== DISTRIBUTION_VERSION ||
    raw.day !== DAILY_KEY ||
    raw.folder !== folder ||
    !Array.isArray(raw.order)
  ) {
    const fresh = {
      version: DISTRIBUTION_VERSION,
      day: DAILY_KEY,
      folder,
      order: shuffleInPlace([...validKeys]),
      cursor: 0,
      cycles: 0
    };
    localStorage.setItem(dailyRotationKey(folder), JSON.stringify(fresh));
    return fresh;
  }

  const oldOrder = raw.order
    .map(v => String(v || "").trim().toLowerCase())
    .filter(Boolean);
  const oldCursor = Math.max(0, Math.min(Number(raw.cursor) || 0, oldOrder.length));

  const consumed = [];
  const remaining = [];
  const seen = new Set();

  oldOrder.slice(0, oldCursor).forEach(key => {
    if (validSet.has(key) && !seen.has(key)) {
      seen.add(key);
      consumed.push(key);
    }
  });

  oldOrder.slice(oldCursor).forEach(key => {
    if (validSet.has(key) && !seen.has(key)) {
      seen.add(key);
      remaining.push(key);
    }
  });

  // Newly added cards are inserted into the not-yet-consumed portion.
  const added = shuffleInPlace(
    validKeys.filter(key => !seen.has(key))
  );
  remaining.push(...added);

  const state = {
    version: DISTRIBUTION_VERSION,
    day: DAILY_KEY,
    folder,
    order: [...consumed, ...remaining],
    cursor: consumed.length,
    cycles: Math.max(0, Number(raw.cycles) || 0)
  };

  // If a complete category cycle finished, begin a fresh shuffled cycle.
  if (state.cursor >= state.order.length && validKeys.length) {
    state.order = shuffleInPlace([...validKeys]);
    state.cursor = 0;
    state.cycles += 1;
  }

  localStorage.setItem(dailyRotationKey(folder), JSON.stringify(state));
  return state;
}

function saveRotationState(folder, state) {
  localStorage.setItem(dailyRotationKey(folder), JSON.stringify(state));
}

function beginNextRotationCycle(state, validKeys) {
  state.order = shuffleInPlace([...validKeys]);
  state.cursor = 0;
  state.cycles = (Number(state.cycles) || 0) + 1;
}

function drawNextRotatedCard(folder, cards, blockedKeys) {
  const pool = uniqueCards(cards);
  if (!pool.length) return null;

  const byKey = new Map(pool.map(card => [cardIdentity(card), card]));
  const validKeys = Array.from(byKey.keys());
  const blocked = blockedKeys instanceof Set ? blockedKeys : new Set();
  const state = normalizeRotationState(folder, pool);

  const tryCurrentCycle = () => {
    for (let idx = state.cursor; idx < state.order.length; idx++) {
      const key = state.order[idx];
      if (!byKey.has(key) || blocked.has(key)) continue;

      // Move the chosen eligible card to the cursor. Temporarily blocked
      // cards stay in the unconsumed tail so they become available again
      // naturally in the next match.
      [state.order[state.cursor], state.order[idx]] =
        [state.order[idx], state.order[state.cursor]];

      const chosenKey = state.order[state.cursor];
      state.cursor += 1;
      saveRotationState(folder, state);
      return byKey.get(chosenKey) || null;
    }
    return null;
  };

  let card = tryCurrentCycle();
  if (card) return card;

  // All eligible cards in this category's current cycle were consumed.
  // Start the next cycle only if this board still needs a card from it.
  beginNextRotationCycle(state, validKeys);
  saveRotationState(folder, state);

  card = tryCurrentCycle();
  return card;
}

function buildComprehensiveBoard(
  legendaryCards,
  normalCards,
  usedKeys,
  previousMatchKeys
) {
  const board = [];
  const blockedKeys = new Set([
    ...Array.from(usedKeys || []),
    ...Array.from(previousMatchKeys || [])
  ]);

  for (let slot = 0; slot < BOARD_SIZE; slot++) {
    // Preserve the exact existing mechanism: independent 10% roll per slot.
    const wantsLegendary = Math.random() < LEGENDARY_CHANCE;

    let card = wantsLegendary
      ? drawNextRotatedCard("legendary", legendaryCards, blockedKeys)
      : drawNextRotatedCard("normal", normalCards, blockedKeys);

    // Safety fallback only when the requested category has no eligible card.
    // This prevents failures with small/temporarily blocked folders while the
    // primary per-slot legendary probability remains 0.1.
    if (!card) {
      card = wantsLegendary
        ? drawNextRotatedCard("normal", normalCards, blockedKeys)
        : drawNextRotatedCard("legendary", legendaryCards, blockedKeys);
    }

    if (!card) {
      throw new Error(
        "تعذر إكمال اللوحة دون تكرار أو استخدام بطاقات المباراة السابقة."
      );
    }

    const key = cardIdentity(card);
    board.push(card);
    blockedKeys.add(key);
    usedKeys.add(key);
  }

  return board;
}

// ---------- load & render ----------
loadAndRender();

async function loadAndRender() {
  try {
    if (roundCount > BOARD_SIZE) {
      throw new Error("عدد الجولات يجب ألا يتجاوز 20 جولة.");
    }

    const [legendaryFilesRaw, normalFilesRaw] = await Promise.all([
      fetchFolderList("legendary").catch(() => []),
      fetchFolderList("normal").catch(() => [])
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
      boxGrid.innerHTML = `<p class="text-red-500">لا توجد ملفات كروت.</p>`;
      return;
    }

    const previousMatchKeys = loadPreviousMatchKeys();
    const usedKeys = loadUsedCardKeys();

    // Reserve the other player's saved board too, preserving the existing
    // guarantee that the same card never appears for both players in a game.
    const otherPlayer = currentPlayer === 1 ? 2 : 1;
    const otherBoard = loadSavedBoard(otherPlayer);
    if (otherBoard) reserveCards(usedKeys, otherBoard);

    const savedBoard = loadSavedBoard(currentPlayer);
    let boardCards;

    if (savedBoard) {
      boardCards = savedBoard;
      reserveCards(usedKeys, boardCards);
    } else {
      const allUnique = uniqueCards([
        ...legendaryCards,
        ...normalCards
      ]);

      const unavailable = new Set([
        ...Array.from(usedKeys),
        ...Array.from(previousMatchKeys)
      ]);

      const availableUniqueCount = allUnique.filter(
        card => !unavailable.has(cardIdentity(card))
      ).length;

      // Player 1 must leave enough unique cards for player 2's 20 boxes too.
      const requiredUniqueCount =
        currentPlayer === 1 && !otherBoard
          ? BOARD_SIZE * 2
          : BOARD_SIZE;

      if (availableUniqueCount < requiredUniqueCount) {
        throw new Error(
          `يلزم ${requiredUniqueCount} بطاقة فريدة بعد استبعاد بطاقات المباراة السابقة، والمتوفر ${availableUniqueCount} فقط.`
        );
      }

      boardCards = buildComprehensiveBoard(
        legendaryCards,
        normalCards,
        usedKeys,
        previousMatchKeys
      );

      saveBoard(currentPlayer, boardCards);
    }

    saveUsedCardKeys(usedKeys);

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
    errorText.textContent = err?.message || "خطأ في التحميل";
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

  // Record only the cards that were actually selected for play. They become
  // the one-match exclusion set after both players finish this match.
  const matchPlayedState = saveCurrentPlayerPicks(playerKey, picks);

  // The board is removed after submission, while its distributed cards remain
  // reserved for the current game so the two players can never share a card.
  localStorage.removeItem(boardKey(currentPlayer));

  if (currentPlayer === 1) {
    localStorage.setItem("currentPlayer", "2");
    location.reload();
  } else {
    // From the NEXT game only, exclude the cards played in this completed game.
    // The game after that will instead exclude the newer match, so this is not
    // a permanent ban and the daily rotation continues normally.
    finalizePreviousMatchExclusion(matchPlayedState);

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