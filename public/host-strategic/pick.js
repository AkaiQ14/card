const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0;

// ================= CONFIG =================
let LEGENDARY_RATE = 0.1; // سيتم جلبها من السيرفر
// ==========================================

const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const animeList = JSON.parse(localStorage.getItem("animeList") || "[]");
const player1 = localStorage.getItem("player1");
const player2 = localStorage.getItem("player2");

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

let imageMap = {};
let selectedBoxes = [];
const gameID = localStorage.getItem("gameID") || "default";
const socket = io();

const BOARD_SIZE = 20;

const playerName = currentPlayer === 1 ? player1 : player2;
instruction.textContent = `اللاعب ${playerName} اختر ${roundCount} بطاقات`;

// ==================== NEW: used images scoped per game ====================
function usedKey() {
  return `gameUsedImages_${String(gameID)}`;
}

function loadUsed() {
  const arr = JSON.parse(localStorage.getItem(usedKey()) || "[]");
  return new Set(arr.map(String));
}

function saveUsed(keys) {
  const prev = JSON.parse(localStorage.getItem(usedKey()) || "[]");
  const merged = [...new Set([...prev, ...keys.map(String)])];
  localStorage.setItem(usedKey(), JSON.stringify(merged));
}

function clearUsed() {
  localStorage.removeItem(usedKey());
}
// ========================================================================

// ---------- helpers ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function popRandom(arr) {
  if (!arr.length) return null;
  const i = Math.floor(Math.random() * arr.length);
  const [x] = arr.splice(i, 1);
  return x;
}

// ---------- load & render ----------
loadAndRender();

async function fetchFolderList(folder) {
  const res = await fetch(`/list-images/${folder}`);
  if (!res.ok) throw new Error(`Failed to list ${folder}`);
  return res.json();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/**
 * NEW: توزيع "أشمل":
 * - استبعاد الصور المستخدمة داخل نفس gameID فقط
 * - لو الاستبعاد خلّى الصور غير كافية للوحة: نسوي Reset تلقائي ونبدأ دورة جديدة
 * - نضمن تمثيل legendary حسب النسبة بشكل هدف (target count) بدل رول لكل خانة
 */
async function loadAndRender() {
  try {
    // ================= جلب النسبة من السيرفر =================
    const cfg = await fetch("/api/config")
      .then(r => r.json())
      .catch(() => null);

    if (cfg && typeof cfg.legendaryRate === "number") {
      LEGENDARY_RATE = cfg.legendaryRate;
    }
    console.log("Legendary Rate:", LEGENDARY_RATE);
    // =========================================================

    // قوائم الملفات
    const [legendaryFilesRaw, normalFilesRaw] = await Promise.all([
      fetchFolderList("legendary").catch(() => []),
      fetchFolderList("normal").catch(() => []),
    ]);

    // تجاهل ملفات غير صور (احتياط)
    const isImage = (f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(String(f));
    const legendaryFilesAll = legendaryFilesRaw.filter(isImage);
    const normalFilesAll = normalFilesRaw.filter(isImage);

    // صور مستخدمة لهذه اللعبة فقط
    let used = loadUsed();

    // نبني pool مع الاستبعاد
    const buildPools = () => {
      const legendaryPool = legendaryFilesAll
        .map(f => ({ folder: "legendary", filename: f, key: `legendary/${f}` }))
        .filter(it => !used.has(it.key));

      const normalPool = normalFilesAll
        .map(f => ({ folder: "normal", filename: f, key: `normal/${f}` }))
        .filter(it => !used.has(it.key));

      return { legendaryPool, normalPool };
    };

    let { legendaryPool, normalPool } = buildPools();

    // NEW: لو ما صار فيه صور كافية بسبب تراكم used، نسوي Reset تلقائي
    if (legendaryPool.length + normalPool.length < BOARD_SIZE) {
      console.warn("Not enough images after filtering used. Auto-reset used list for this game cycle.");
      clearUsed();
      used = new Set();
      ({ legendaryPool, normalPool } = buildPools());
    }

    if (legendaryPool.length + normalPool.length < BOARD_SIZE) {
      boxGrid.innerHTML = `<p class="text-red-500">لا توجد صور كافية.</p>`;
      return;
    }

    // NEW: توزيع هدف للـ legendary داخل اللوحة
    // (يقلل حالات عدم ظهور legendary أو ظهورهم نادر جدًا)
    const maxLegendaryPossible = Math.min(legendaryPool.length, BOARD_SIZE);
    const maxNormalPossible = Math.min(normalPool.length, BOARD_SIZE);

    // نحدد target بناءً على النسبة، لكن لا نجبر لو ما فيه كفاية
    let targetLegendary = Math.round(BOARD_SIZE * LEGENDARY_RATE);
    targetLegendary = clamp(targetLegendary, 0, maxLegendaryPossible);

    // لو targetLegendary أخذ مساحة كبيرة وما يكفي normal للباقي، نقلل
    const needNormal = BOARD_SIZE - targetLegendary;
    if (normalPool.length < needNormal) {
      const shortage = needNormal - normalPool.length;
      targetLegendary = clamp(targetLegendary - shortage, 0, maxLegendaryPossible);
    }

    // ونفس الشي بالعكس: لو legendary قليل جدًا، نعوض بالـ normal
    const finalNormalCount = BOARD_SIZE - targetLegendary;

    // نخلط pools ثم نسحب أول N (تغطية أفضل من رول لكل خانة)
    shuffleInPlace(legendaryPool);
    shuffleInPlace(normalPool);

    const combined = [];

    for (let i = 0; i < targetLegendary; i++) {
      const it = legendaryPool[i];
      if (it) combined.push(it);
    }
    for (let i = 0; i < finalNormalCount; i++) {
      const it = normalPool[i];
      if (it) combined.push(it);
    }

    // لو لأي سبب نقصنا (نادر)، نكمل من المتبقي عشوائيًا
    while (combined.length < BOARD_SIZE) {
      const fallback = popRandom(normalPool.slice(finalNormalCount)) || popRandom(legendaryPool.slice(targetLegendary));
      if (!fallback) break;
      combined.push(fallback);
    }

    // خلط نهائي للعرض حتى ما تكون legendary متكتلة
    shuffleInPlace(combined);

    imageMap = {};
    for (let i = 1; i <= combined.length; i++) {
      const img = combined[i - 1];
      imageMap[i] = {
        folder: img.folder,
        filename: img.filename,
        key: img.key,
        fullPath: `/images/${img.folder}/${encodeURIComponent(img.filename)}`
      };
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
    if (!imageMap[i]) continue;

    const btn = document.createElement("button");

    btn.innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
        <img src="../images/qg144.png"
          style="width:100px;height:100px;object-fit:contain;"
        >
        <span style="
          position:absolute;
          inset:0;
          display:flex;
          align-items:center;
          justify-content:center;
          color:white;
          font-size:22px;
          font-weight:900;
          text-shadow:1px 1px 3px black;
        ">
          ${i}
        </span>
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

  document.querySelectorAll("#boxGrid button").forEach(btn => {
    const index = Number(btn.dataset.index);
    if (selectedBoxes.includes(index)) toggleBox(index, btn);
  });

  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);

  while (selectedBoxes.length < roundCount && indices.length) {
    const r = Math.floor(Math.random() * indices.length);
    const index = indices.splice(r, 1)[0];

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

  const keys = selectedBoxes
    .map(i => imageMap[i]?.key)
    .filter(Boolean);

  // حفظ المستخدمين لهذه اللعبة فقط
  saveUsed(keys);

  const playerKey = currentPlayer === 1 ? "player1" : "player2";

  socket.emit("playerSubmitPicks", {
    gameID,
    playerName,
    playerKey,
    picks
  });

  // ===== FIX انتقال اللاعبين =====
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