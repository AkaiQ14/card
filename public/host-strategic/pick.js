const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0;

// ================= CONFIG =================
let LEGENDARY_RATE = 0.1; // سيتم جلبها من /api/config (من ENV)
// ==========================================

const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";

let currentPlayer = parseInt(localStorage.getItem("currentPlayer") || "1", 10);

// ===== FIX: منع تخطي اللاعب الأول =====
const gameStarted = localStorage.getItem("pickStarted");
if (!gameStarted) {
  localStorage.setItem("pickStarted", "true");
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

// Modal elements (optional if exists)
const tacticModal = document.getElementById("tacticModal");
const tacticSelectEl = document.getElementById("tacticSelect");

const BOARD_SIZE = 20;

let imageMap = {};      // 1..20 -> {folder, filename, key, fullPath}
let selectedBoxes = []; // indices

const gameID = localStorage.getItem("gameID") || "default";

// ===== Auto Clean Old Games (Fix Storage Overflow) =====
function purgeOldGameStorage(currentID) {
  const keep = String(currentID);

  const prefixes = [
    "deck_all_",
    "deck_pos_",
    "current_board_",
  ];

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;

    const matched = prefixes.find(p => key.startsWith(p));
    if (!matched) continue;

    // احتفظ فقط بمفاتيح اللعبة الحالية
    if (!key.includes(keep)) {
      localStorage.removeItem(key);
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

// ==================== Keys (per game) ====================
// Legendary deck
function lDeckKey() { return `deck_legendary_${String(gameID)}`; }
function lPosKey()  { return `deck_legendary_pos_${String(gameID)}`; }
// Normal deck
function nDeckKey() { return `deck_normal_${String(gameID)}`; }
function nPosKey()  { return `deck_normal_pos_${String(gameID)}`; }

// لوحة 20 الحالية لكل لاعب (حتى لو ريفرش)
function boardKey() { return `current_board_${String(gameID)}_p${currentPlayer}`; }
// =========================================================

// ---------- helpers ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

// ---------- load & render ----------
loadAndRender();

async function loadAndRender() {
  try {
    // ✅ جلب النسبة من السيرفر (ENV)
    const cfg = await fetch("/api/config").then(r => r.json()).catch(() => null);
    if (cfg && typeof cfg.legendaryRate === "number") {
      LEGENDARY_RATE = clamp(cfg.legendaryRate, 0, 1);
    }

    // جب كل الملفات
    const [legendaryFilesRaw, normalFilesRaw] = await Promise.all([
      fetchFolderList("legendary").catch(() => []),
      fetchFolderList("normal").catch(() => []),
    ]);

    const legendaryFiles = legendaryFilesRaw.filter(isMediaFile);
    const normalFiles = normalFilesRaw.filter(isMediaFile);

    if (!legendaryFiles.length && !normalFiles.length) {
      boxGrid.innerHTML = `<p class="text-red-500">لا توجد ملفات كروت.</p>`;
      return;
    }

    // نبني deck لكل فئة (يشمل كل ملفاتها) + signature
    const lKeysNow = legendaryFiles.map(f => `legendary/${f}`).sort().join("|");
    const nKeysNow = normalFiles.map(f => `normal/${f}`).sort().join("|");

    // Ensure legendary deck
    let lStored = JSON.parse(localStorage.getItem(lDeckKey()) || "null");
    let lPos = parseInt(localStorage.getItem(lPosKey()) || "0", 10);
    if (!lStored || lStored.sig !== lKeysNow || !Array.isArray(lStored.deck) || lStored.deck.length !== legendaryFiles.length) {
      const lDeck = shuffleInPlace(
        legendaryFiles.map(f => ({
          folder: "legendary",
          filename: f,
          key: `legendary/${f}`,
          fullPath: `/images/legendary/${encodeURIComponent(f)}`
        }))
      );
      lStored = { sig: lKeysNow, deck: lDeck };
      localStorage.setItem(lDeckKey(), JSON.stringify(lStored));
      localStorage.setItem(lPosKey(), "0");
      lPos = 0;
    }

    // Ensure normal deck
    let nStored = JSON.parse(localStorage.getItem(nDeckKey()) || "null");
    let nPos = parseInt(localStorage.getItem(nPosKey()) || "0", 10);
    if (!nStored || nStored.sig !== nKeysNow || !Array.isArray(nStored.deck) || nStored.deck.length !== normalFiles.length) {
      const nDeck = shuffleInPlace(
        normalFiles.map(f => ({
          folder: "normal",
          filename: f,
          key: `normal/${f}`,
          fullPath: `/images/normal/${encodeURIComponent(f)}`
        }))
      );
      nStored = { sig: nKeysNow, deck: nDeck };
      localStorage.setItem(nDeckKey(), JSON.stringify(nStored));
      localStorage.setItem(nPosKey(), "0");
      nPos = 0;
    }

    // لو عندنا لوحة محفوظة لهذا اللاعب (عشان refresh)
    const storedBoard = JSON.parse(localStorage.getItem(boardKey()) || "null");
    let boardCards;

    if (storedBoard && Array.isArray(storedBoard) && storedBoard.length === BOARD_SIZE) {
      boardCards = storedBoard;
    } else {
      // ✅ تحديد عدد legendary من ENV
      const availableLegendary = lStored.deck.length;
      const availableNormal = nStored.deck.length;

      // target legendary
      let L = Math.round(BOARD_SIZE * LEGENDARY_RATE);
      L = clamp(L, 0, Math.min(BOARD_SIZE, availableLegendary));

      // باقي اللوحة normal
      let N = BOARD_SIZE - L;
      if (availableNormal < N) {
        // إذا normal قليل نعوض من legendary إن وجد
        const shortage = N - availableNormal;
        N = availableNormal;
        L = clamp(L + shortage, 0, Math.min(BOARD_SIZE - N, availableLegendary));
      }

      // نسحب من legendary deck
      const drawn = [];
      for (let i = 0; i < L; i++) {
        if (lPos >= lStored.deck.length) {
          shuffleInPlace(lStored.deck);
          lPos = 0;
        }
        drawn.push(lStored.deck[lPos++]);
      }

      // نسحب من normal deck
      for (let i = 0; i < N; i++) {
        if (nPos >= nStored.deck.length) {
          shuffleInPlace(nStored.deck);
          nPos = 0;
        }
        drawn.push(nStored.deck[nPos++]);
      }

      // خلط داخل اللوحة عشان ما تتكتل فئة
      shuffleInPlace(drawn);
      boardCards = drawn;

      // حفظ المؤشرات و الـ decks بعد احتمال إعادة خلط
      localStorage.setItem(lDeckKey(), JSON.stringify(lStored));
      localStorage.setItem(nDeckKey(), JSON.stringify(nStored));
      localStorage.setItem(lPosKey(), String(lPos));
      localStorage.setItem(nPosKey(), String(nPos));

      // حفظ لوحة هذا اللاعب حتى لو سوّى Refresh
      localStorage.setItem(boardKey(), JSON.stringify(boardCards));
    }

    // imageMap 1..20
    imageMap = {};
    for (let i = 1; i <= BOARD_SIZE; i++) {
      imageMap[i] = boardCards[i - 1];
    }

    renderBoxes();

  } catch (err) {
    console.error(err);
    boxGrid.innerHTML = `<p class="text-red-500">خطأ في التحميل</p>`;
  }
}

// ---------- UI ----------
function renderBoxes() {
  boxGrid.innerHTML = "";
  selectedBoxes = [];
  confirmBtn.classList.add("hidden");

  for (let i = 1; i <= BOARD_SIZE; i++) {
    const btn = document.createElement("button");

    btn.innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
        <img src="../images/qg144.png" style="width:100px;height:100px;object-fit:contain;">
        <span style="
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          color:white; font-size:22px; font-weight:900; text-shadow:1px 1px 3px black;
        ">${i}</span>
      </div>
    `;

    btn.dataset.index = i;
    btn.className = `
      width:90px;
      height:90px;
      border:none;
      background:transparent;
      cursor:pointer;
      transition:transform 0.2s;
    `;

    btn.onclick = () => toggleBox(i, btn);
    boxGrid.appendChild(btn);
  }
}

function toggleBox(index, btn) {
  if (selectedBoxes.includes(index)) {
    selectedBoxes = selectedBoxes.filter(n => n !== index);
    btn.style.filter = "none";
    btn.style.transform = "scale(1)";
  } else {
    if (selectedBoxes.length >= roundCount) return;

    selectedBoxes.push(index);
    btn.style.filter = `
      drop-shadow(0 0 6px gold)
      drop-shadow(0 0 12px rgba(255,215,0,0.8))
      drop-shadow(0 0 20px rgba(255,165,0,0.6))
    `;
    btn.style.transform = "scale(1.08)";
  }

  confirmBtn.classList.toggle("hidden", selectedBoxes.length !== roundCount);
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

// Modal controls
function openTacticModal() {
  if (!tacticModal) return; // لو ما فيه مودال
  tacticModal.classList.remove("hidden");
  tacticModal.classList.add("flex");
}

function closeTacticModal() {
  if (!tacticModal) return;
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

function confirmSelection() {
  if (selectedBoxes.length !== roundCount) {
    alert("اختر العدد الصحيح");
    return;
  }

  const picks = selectedBoxes
    .map(i => imageMap[i]?.fullPath)
    .filter(Boolean);

  const playerKey = currentPlayer === 1 ? "player1" : "player2";

  socket.emit("playerSubmitPicks", {
    gameID,
    playerName,
    playerKey,
    picks
  });

  // ✅ بعد التأكيد: نحذف لوحة هذا اللاعب ليأخذ 20 جديدة في المرة القادمة
  localStorage.removeItem(boardKey());

  if (currentPlayer === 1) {
    localStorage.setItem("currentPlayer", "2");
    location.reload();
  } else {
    localStorage.removeItem("currentPlayer");
    localStorage.removeItem("pickStarted");
    location.href = "wait.html";
  }
}

window.confirmSelection = confirmSelection;
window.randomSelect = randomSelect;

// expose tactics
window.openTacticModal = openTacticModal;
window.closeTacticModal = closeTacticModal;
window.applyTactic = applyTactic;