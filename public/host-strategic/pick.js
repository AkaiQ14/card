const CARD_SCOPE = window.location.pathname.startsWith("/anime/") ? "anime" : "all";
const CARD_ASSET_PREFIX = CARD_SCOPE === "anime" ? "/anime" : "";
const randomSound = new Audio(`${CARD_ASSET_PREFIX}/sounds/random.mp3`);
randomSound.volume = 1.0;

// Each of the 20 boxes independently keeps the original 10% chance
// to receive a legendary card.
const LEGENDARY_CHANCE = 0.1;
const BOARD_SIZE = 20;
const DISTRIBUTION_VERSION = 5;
const BOARD_STORAGE_VERSION = 5;

const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const gameID = localStorage.getItem("gameID") || "default";
const PICK_SESSION_KEY = `pickStarted:v5:${CARD_SCOPE}:${String(gameID)}`;

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
// Persistent fair rotation + previous-match soft exclusion
// =====================================================
// Rotation is intentionally NOT tied to a day or a game. It persists in
// localStorage until every card in a rarity has had its turn, then reshuffles.
// CARD_SCOPE is part of every persistent key so /anime and /all never interfere.
function scopeToken() {
  return CARD_SCOPE === "anime" ? "anime" : "all";
}

function usedCardsKey() {
  return `distributed_cards_v5_${scopeToken()}_${String(gameID)}`;
}

// Stable 20-card board per player: refresh never changes a generated board.
function boardKey(playerNumber = currentPlayer) {
  return `random_board_v5_${scopeToken()}_${String(gameID)}_p${playerNumber}`;
}

function rotationKey(folder) {
  return `card_rotation_v5_${scopeToken()}_${String(folder)}`;
}

// Only the immediately previous completed match for this scope is remembered.
function lastMatchKey() {
  return `last_match_played_v5_${scopeToken()}`;
}

function currentMatchPicksKey() {
  return `match_played_picks_v5_${scopeToken()}_${String(gameID)}`;
}

if (isNewPickSession) {
  localStorage.removeItem(usedCardsKey());
  localStorage.removeItem(boardKey(1));
  localStorage.removeItem(boardKey(2));
  localStorage.removeItem(currentMatchPicksKey());
}

// Remove obsolete session flags from older versions.
localStorage.removeItem("pickStarted");

// Keep persistent v5 rotations/last-match data, but remove stale per-game data
// and all older rotation formats (including the old daily v4 rotation).
function purgeOldGameStorage(currentID) {
  const id = String(currentID);
  const scope = scopeToken();
  const currentBoardPrefix = `random_board_v5_${scope}_${id}_p`;
  const currentUsedKey = `distributed_cards_v5_${scope}_${id}`;
  const currentPickSessionKey = `pickStarted:v5:${scope}:${id}`;
  const currentPlayedKey = `match_played_picks_v5_${scope}_${id}`;

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

    // Legacy transient/deck keys and all v4 daily-rotation keys.
    if (
      k.startsWith("deck_legendary_") ||
      k.startsWith("deck_legendary_pos_") ||
      k.startsWith("deck_normal_") ||
      k.startsWith("deck_normal_pos_") ||
      k.startsWith("current_board_") ||
      k.startsWith("distributed_cards_v2_") ||
      k.startsWith("random_board_v2_") ||
      k.startsWith("pickStarted:v2:") ||
      k.startsWith("distributed_cards_v4_") ||
      k.startsWith("random_board_v4_") ||
      k.startsWith("pickStarted:v4:") ||
      k.startsWith("match_played_picks_v4_") ||
      k.startsWith("card_rotation_v4_") ||
      k.startsWith("last_match_played_v4_")
    ) {
      localStorage.removeItem(k);
      continue;
    }

    // v5 game-scoped data is temporary. Keep only the current game.
    if (k.startsWith(`distributed_cards_v5_${scope}_`) && k !== currentUsedKey) {
      localStorage.removeItem(k);
      continue;
    }

    if (k.startsWith(`random_board_v5_${scope}_`) && !k.startsWith(currentBoardPrefix)) {
      localStorage.removeItem(k);
      continue;
    }

    if (k.startsWith(`pickStarted:v5:${scope}:`) && k !== currentPickSessionKey) {
      localStorage.removeItem(k);
      continue;
    }

    if (k.startsWith(`match_played_picks_v5_${scope}_`) && k !== currentPlayedKey) {
      localStorage.removeItem(k);
    }

    // IMPORTANT: never purge card_rotation_v5_* or last_match_played_v5_* here.
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
  const res = await fetch(
    `/list-images/${encodeURIComponent(folder)}?scope=${encodeURIComponent(CARD_SCOPE)}`
  );
  if (!res.ok) throw new Error(`Failed to list ${folder}`);
  return res.json();
}

function makeCard(folder, filename) {
  return {
    folder,
    filename,
    key: `${folder}/${filename}`,
    fullPath: `${CARD_ASSET_PREFIX}/images/${folder}/${encodeURIComponent(filename)}`
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
// Previous match: ONLY the actually selected/played cards are preferred to be
// skipped in the immediately following match. This is a SOFT exclusion: if it
// would cause a shortage, those cards become eligible automatically instead of
// stopping the game.
// -----------------------------------------------------
function loadPreviousMatchKeys() {
  try {
    const data = JSON.parse(localStorage.getItem(lastMatchKey()) || "null");

    if (
      !data ||
      data.version !== DISTRIBUTION_VERSION ||
      data.scope !== scopeToken() ||
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
      scope: scopeToken(),
      gameID: String(gameID),
      cards,
      savedAt: Date.now()
    })
  );

  localStorage.removeItem(currentMatchPicksKey());
}

// -----------------------------------------------------
// Persistent category rotation
// -----------------------------------------------------
// Rules:
// 1) Every existing card in a rarity is consumed once before that rarity cycles.
// 2) New cards are appended to the still-unconsumed tail, so they join without
//    resetting progress or pushing already-waiting old cards backwards.
// 3) Deleted cards disappear from the state automatically.
// 4) A new cycle starts only after the current cycle is genuinely consumed.
// -----------------------------------------------------
function normalizeRotationState(folder, cards) {
  const pool = uniqueCards(cards);
  const validKeys = pool.map(cardIdentity).filter(Boolean);
  const validSet = new Set(validKeys);

  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(rotationKey(folder)) || "null");
  } catch {}

  if (
    !raw ||
    raw.version !== DISTRIBUTION_VERSION ||
    raw.scope !== scopeToken() ||
    raw.folder !== folder ||
    !Array.isArray(raw.order)
  ) {
    const fresh = {
      version: DISTRIBUTION_VERSION,
      scope: scopeToken(),
      folder,
      order: shuffleInPlace([...validKeys]),
      cursor: 0,
      cycles: 0,
      updatedAt: Date.now()
    };
    localStorage.setItem(rotationKey(folder), JSON.stringify(fresh));
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

  // New cards join AFTER cards that were already waiting in this cycle.
  // This deliberately protects old/unseen cards from being buried by additions.
  const added = shuffleInPlace(
    validKeys.filter(key => !seen.has(key))
  );
  remaining.push(...added);

  const state = {
    version: DISTRIBUTION_VERSION,
    scope: scopeToken(),
    folder,
    order: [...consumed, ...remaining],
    cursor: consumed.length,
    cycles: Math.max(0, Number(raw.cycles) || 0),
    updatedAt: Date.now()
  };

  localStorage.setItem(rotationKey(folder), JSON.stringify(state));
  return state;
}

function saveRotationState(folder, state) {
  state.updatedAt = Date.now();
  localStorage.setItem(rotationKey(folder), JSON.stringify(state));
}

function beginNextRotationCycle(state, validKeys) {
  state.order = shuffleInPlace([...validKeys]);
  state.cursor = 0;
  state.cycles = (Number(state.cycles) || 0) + 1;
}

function drawNextRotatedCard(
  folder,
  cards,
  hardBlockedKeys,
  softBlockedKeys
) {
  const pool = uniqueCards(cards);
  if (!pool.length) return null;

  const byKey = new Map(pool.map(card => [cardIdentity(card), card]));
  const validKeys = Array.from(byKey.keys());
  const hardBlocked = hardBlockedKeys instanceof Set ? hardBlockedKeys : new Set();
  const softBlocked = softBlockedKeys instanceof Set ? softBlockedKeys : new Set();
  const state = normalizeRotationState(folder, pool);

  const tryCurrentCycle = (respectSoftBlock) => {
    for (let idx = state.cursor; idx < state.order.length; idx++) {
      const key = state.order[idx];
      if (!byKey.has(key) || hardBlocked.has(key)) continue;
      if (respectSoftBlock && softBlocked.has(key)) continue;

      // Move the selected card to the cursor so the consumed prefix remains exact.
      // Skipped cards remain in the tail and therefore keep their turn.
      [state.order[state.cursor], state.order[idx]] =
        [state.order[idx], state.order[state.cursor]];

      const chosenKey = state.order[state.cursor];
      state.cursor += 1;
      saveRotationState(folder, state);
      return byKey.get(chosenKey) || null;
    }
    return null;
  };

  // First preference: preserve previous-match exclusion.
  let card = tryCurrentCycle(true);
  if (card) return card;

  // Soft fallback: keep the requested rarity and allow a previous-match card
  // before distorting the slot's 10%/90% rarity decision.
  card = tryCurrentCycle(false);
  if (card) return card;

  // If unconsumed cards remain but every one is hard-blocked by THIS match,
  // do not start a new cycle. Returning null lets the caller try the other rarity.
  if (state.cursor < state.order.length) {
    return null;
  }

  // The cycle is genuinely complete. Start the next one automatically.
  beginNextRotationCycle(state, validKeys);
  saveRotationState(folder, state);

  card = tryCurrentCycle(true);
  if (card) return card;

  card = tryCurrentCycle(false);
  return card;
}

function buildComprehensiveBoard(
  legendaryCards,
  normalCards,
  usedKeys,
  previousMatchKeys
) {
  const board = [];

  // HARD block = cards already distributed anywhere in this current game.
  // These can never repeat between the two players' 20-box boards.
  const hardBlockedKeys = new Set(Array.from(usedKeys || []));

  // SOFT block = cards actually played in the immediately previous match.
  // Prefer skipping them, but relax this automatically if needed.
  const softBlockedKeys = new Set(Array.from(previousMatchKeys || []));

  for (let slot = 0; slot < BOARD_SIZE; slot++) {
    // Preserve the exact original mechanism: independent 10% roll per slot.
    const wantsLegendary = Math.random() < LEGENDARY_CHANCE;
    const primaryFolder = wantsLegendary ? "legendary" : "normal";
    const primaryCards = wantsLegendary ? legendaryCards : normalCards;
    const fallbackFolder = wantsLegendary ? "normal" : "legendary";
    const fallbackCards = wantsLegendary ? normalCards : legendaryCards;

    let card = drawNextRotatedCard(
      primaryFolder,
      primaryCards,
      hardBlockedKeys,
      softBlockedKeys
    );

    // Only change rarity if the requested rarity has no card available without
    // repeating a card already distributed in the CURRENT game.
    if (!card) {
      card = drawNextRotatedCard(
        fallbackFolder,
        fallbackCards,
        hardBlockedKeys,
        softBlockedKeys
      );
    }

    if (!card) {
      throw new Error(
        "لا توجد بطاقات فريدة كافية لإكمال لوحتي اللاعبين دون تكرار."
      );
    }

    const key = cardIdentity(card);
    board.push(card);
    hardBlockedKeys.add(key);
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

      // Previous-match cards are NOT counted as unavailable here because that
      // exclusion is intentionally soft. Only cards already distributed in this
      // current game are a hard restriction.
      const availableUniqueCount = allUnique.filter(
        card => !usedKeys.has(cardIdentity(card))
      ).length;

      // Player 1 must leave 20 other unique cards for player 2. Player 2 only
      // needs its own remaining 20. This error now means a REAL inventory shortage.
      const requiredUniqueCount =
        currentPlayer === 1 && !otherBoard
          ? BOARD_SIZE * 2
          : BOARD_SIZE;

      if (availableUniqueCount < requiredUniqueCount) {
        throw new Error(
          `عدد الكروت الفريدة غير كافٍ: يلزم ${requiredUniqueCount} والمتوفر ${availableUniqueCount}.`
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
