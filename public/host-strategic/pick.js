const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0;

// ================= CONFIG =================
let LEGENDARY_RATE = 0.1; // يبقى فقط لو تحتاجه لاحقًا
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

const BOARD_SIZE = 20; // تبقى 20 اختيار ✅

let imageMap = {};      // index(1..20) -> card meta
let selectedBoxes = []; // selected indices

const gameID = localStorage.getItem("gameID") || "default"; // عندك موجود :contentReference[oaicite:1]{index=1}
const socket = io();

const playerName = currentPlayer === 1 ? player1 : player2;
instruction.textContent = `اللاعب ${playerName} اختر ${roundCount} بطاقات`;

// ==================== Deck storage keys (per game) ====================
function deckKey() { return `deck_all_${String(gameID)}`; }
function deckPosKey() { return `deck_pos_${String(gameID)}`; }

// لوحة 20 الحالية لكل لاعب حتى لو ريفرش
function boardKey() { return `current_board_${String(gameID)}_p${currentPlayer}`; }
// =====================================================================

// ---------- helpers ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isMediaFile(f) {
  return /\.(png|jpg|jpeg|webp|gif|avif|bmp|svg|apng|webm|mp4|ogg)$/i.test(String(f));
}


async function fetchFolderList(folder) {
  const res = await fetch(`/list-images/${folder}`);
  if (!res.ok) throw new Error(`Failed to list ${folder}`);
  return res.json();
}

// ---------- Deck building ----------
async function buildAllCards() {
  const [legendaryFilesRaw, normalFilesRaw] = await Promise.all([
    fetchFolderList("legendary").catch(() => []),
    fetchFolderList("normal").catch(() => []),
  ]);

 const legendaryFiles = legendaryFilesRaw.filter(isMediaFile);
 const normalFiles = normalFilesRaw.filter(isMediaFile);


  const all = [
    ...legendaryFiles.map(f => ({
      folder: "legendary",
      filename: f,
      key: `legendary/${f}`,
      fullPath: `/images/legendary/${encodeURIComponent(f)}`
    })),
    ...normalFiles.map(f => ({
      folder: "normal",
      filename: f,
      key: `normal/${f}`,
      fullPath: `/images/normal/${encodeURIComponent(f)}`
    })),
  ];

  return all;
}

async function ensureDeckReady() {
  // (اختياري) جلب config
  const cfg = await fetch("/api/config").then(r => r.json()).catch(() => null);
  if (cfg && typeof cfg.legendaryRate === "number") LEGENDARY_RATE = cfg.legendaryRate;

  const allCards = await buildAllCards();
  if (!allCards.length) return { ok: false, allCards: [] };

  // نتحقق هل deck الحالي يطابق عدد/مفاتيح الكروت (لو أضفت كروت جديدة)
  const stored = JSON.parse(localStorage.getItem(deckKey()) || "null");
  const storedPos = parseInt(localStorage.getItem(deckPosKey()) || "0", 10);

  // نبني signature بسيط من keys (عشان لو تغيّر المحتوى نعيد بناء deck)
  const keysNow = allCards.map(c => c.key).sort();
  const sigNow = keysNow.join("|");

  let rebuild = true;
  if (stored && Array.isArray(stored.deck) && typeof stored.sig === "string") {
    rebuild = stored.sig !== sigNow || stored.deck.length !== allCards.length;
  }

  if (rebuild) {
    const deck = shuffleInPlace(allCards.slice()); // دورة جديدة تشمل كل الكروت ✅
    localStorage.setItem(deckKey(), JSON.stringify({ sig: sigNow, deck }));
    localStorage.setItem(deckPosKey(), "0");
    return { ok: true, deck, pos: 0, allCards };
  }

  return { ok: true, deck: stored.deck, pos: Number.isFinite(storedPos) ? storedPos : 0, allCards };
}

function drawNextBoardFromDeck(deck, pos) {
  // نسحب 20 كرت متتالين (مع لف + إعادة خلط عند نهاية الدورة)
  const board = [];
  let p = pos;

  while (board.length < BOARD_SIZE) {
    if (p >= deck.length) {
      // انتهت الدورة: نعيد خلط deck ونبدأ من 0
      shuffleInPlace(deck);
      p = 0;
    }
    board.push(deck[p]);
    p++;
  }

  return { board, newPos: p, deck };
}

// ---------- load & render ----------
loadAndRender();

async function loadAndRender() {
  try {
    const ready = await ensureDeckReady();
    if (!ready.ok) {
      boxGrid.innerHTML = `<p class="text-red-500">لا توجد صور كافية.</p>`;
      return;
    }

    let { deck, pos } = ready;

    // لو عندنا لوحة محفوظة لهذا اللاعب (عشان الرفرش)
    const storedBoard = JSON.parse(localStorage.getItem(boardKey()) || "null");

    let boardCards;
    if (storedBoard && Array.isArray(storedBoard) && storedBoard.length === BOARD_SIZE) {
      boardCards = storedBoard;
    } else {
      const drawn = drawNextBoardFromDeck(deck, pos);
      boardCards = drawn.board;

      // حفظ deck بعد احتمال إعادة خلط + حفظ pos الجديد
      localStorage.setItem(deckKey(), JSON.stringify(JSON.parse(localStorage.getItem(deckKey())))); // لا نغير sig
      // ✅ أفضل: نخزن deck نفسه لأننا قد نكون خلطناه عند نهاية الدورة
      const stored = JSON.parse(localStorage.getItem(deckKey()) || "{}");
      stored.deck = deck;
      localStorage.setItem(deckKey(), JSON.stringify(stored));

      localStorage.setItem(deckPosKey(), String(drawn.newPos));

      // نحفظ لوحة هذا اللاعب حتى لو سوّى Refresh
      localStorage.setItem(boardKey(), JSON.stringify(boardCards));
    }

    // بناء imageMap من 1..20
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

// ---------- Random ----------
function randomSelect() {
  randomSound.currentTime = 0;
  randomSound.play().catch(() => {});

  // فك تحديد أي شيء سابق
  document.querySelectorAll("#boxGrid button").forEach(btn => {
    const index = Number(btn.dataset.index);
    if (selectedBoxes.includes(index)) toggleBox(index, btn);
  });

  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);
  shuffleInPlace(indices);

  while (selectedBoxes.length < roundCount && indices.length) {
    const index = indices.pop();
    const btn = document.querySelector(`#boxGrid button[data-index="${index}"]`);
    if (btn) toggleBox(index, btn);
  }
}

// ---------- Confirm ----------
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

  // ✅ بعد التأكيد: نحذف لوحة هذا اللاعب عشان اللي بعده ياخذ 20 جديدة من الـDeck
  localStorage.removeItem(boardKey());

  // انتقال اللاعبين
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