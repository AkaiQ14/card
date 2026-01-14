// public/host-strategic/pick.js

const roundCount  = parseInt(localStorage.getItem("totalRounds") || "3", 10);
const animeList   = JSON.parse(localStorage.getItem("animeList") || "[]");
const player1     = localStorage.getItem("player1");
const player2     = localStorage.getItem("player2");
let currentPlayer = parseInt(localStorage.getItem("currentPlayer") || "1", 10);

const instruction = document.getElementById("instruction");
const boxGrid     = document.getElementById("boxGrid");
const confirmBtn  = document.getElementById("confirmBtn");

let imageMap = {};
let selectedBoxes = [];
const gameID = localStorage.getItem("gameID");
const socket = io();

const usedImages = new Set();
const BOARD_SIZE = 20;

// Per-box legendary probability (10%)
const LEGENDARY_RATE = Math.max(
  0,
  Math.min(1, parseFloat(localStorage.getItem("legendaryRate") || "0.10"))
);

const playerName = currentPlayer === 1 ? player1 : player2;
instruction.textContent = `اللاعب ${playerName} اختر ${roundCount} بطاقات`;

// ---------- helpers ----------
function loadUsed() {
  const arr = JSON.parse(localStorage.getItem("gameUsedImages") || "[]");
  return new Set(arr.map(String));
}
function saveUsed(keys) {
  const prev = JSON.parse(localStorage.getItem("gameUsedImages") || "[]");
  const merged = [...new Set([...prev, ...keys.map(String)])];
  localStorage.setItem("gameUsedImages", JSON.stringify(merged));
}
function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

async function loadAndRender() {
  try {
    const usedGlobally = loadUsed();

    const [legendaryFiles, normalFiles] = await Promise.all([
      fetchFolderList("legendary").catch(() => []),
      fetchFolderList("normal").catch(() => []),
    ]);

    let legendaryPool = legendaryFiles
      .map((f) => ({ folder: "legendary", filename: f, key: `legendary/${f}` }))
      .filter((it) => !usedGlobally.has(it.key));

    let normalPool = normalFiles
      .map((f) => ({ folder: "normal", filename: f, key: `normal/${f}` }))
      .filter((it) => !usedGlobally.has(it.key));

    if (legendaryPool.length + normalPool.length < BOARD_SIZE) {
      boxGrid.innerHTML = `<p class="text-red-500 text-lg">لا توجد صور كافية للاختيار.</p>`;
      return;
    }

    // Per-box roll for legendary
    const combined = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const wantLegendary = Math.random() < LEGENDARY_RATE;
      let chosen = null;

      if (wantLegendary) {
        chosen = popRandom(legendaryPool);
        if (!chosen) chosen = popRandom(normalPool);
      } else {
        chosen = popRandom(normalPool);
        if (!chosen) chosen = popRandom(legendaryPool);
      }

      if (!chosen) {
        const union = [...legendaryPool, ...normalPool];
        chosen = popRandom(union);
        if (!chosen) break;
        if (chosen.folder === "legendary") {
          legendaryPool = legendaryPool.filter(x => x.key !== chosen.key);
        } else {
          normalPool = normalPool.filter(x => x.key !== chosen.key);
        }
      }

      combined.push(chosen);
    }

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
    console.error("loadAndRender failed:", err);
    boxGrid.innerHTML = `<p class="text-red-500 text-lg">خطأ أثناء تحميل الصور.</p>`;
  }
}

function renderBoxes() {
  boxGrid.innerHTML = "";
  selectedBoxes = [];
  confirmBtn.classList.add("hidden");

  for (let i = 1; i <= BOARD_SIZE; i++) {
    if (!imageMap[i]) continue;

    const btn = document.createElement("button");
    btn.textContent = i;
    btn.dataset.index = i;
    btn.className = `
      px-6 py-4 rounded bg-amber-400 text-black text-xl font-bold
      hover:bg-yellow-400 hover:ring-4 hover:ring-yellow-300
    `;
    btn.onclick = () => toggleBox(i, btn);
    boxGrid.appendChild(btn);
  }
}

function toggleBox(index, btn) {
  if (selectedBoxes.includes(index)) {
    selectedBoxes = selectedBoxes.filter((n) => n !== index);
    btn.classList.remove("ring-4", "ring-yellow-400", "bg-[#B8860B]");
    btn.classList.add("bg-amber-400");
  } else {
    if (selectedBoxes.length >= roundCount) return;
    selectedBoxes.push(index);
    btn.classList.remove("bg-amber-400");
    btn.classList.add("ring-4", "ring-yellow-400", "bg-[#B8860B]");
  }
  confirmBtn.classList.toggle("hidden", selectedBoxes.length !== roundCount);
}

function confirmSelection() {
  if (selectedBoxes.length !== roundCount) {
    alert("اختر العدد الصحيح من البطاقات.");
    return;
  }

  const picks = selectedBoxes.map((i) => imageMap[i]?.fullPath).filter(Boolean);
  const keys  = selectedBoxes.map((i) => imageMap[i]?.key).filter(Boolean);

  keys.forEach((k) => usedImages.add(k));
  saveUsed(keys);

  const playerKey = currentPlayer === 1 ? "player1" : "player2";

  socket.emit("playerSubmitPicks", {
    gameID,
    playerName,
    playerKey,
    picks
  });

  if (currentPlayer === 1) {
    localStorage.setItem("currentPlayer", "2");
    location.reload();
  } else {
    localStorage.removeItem("currentPlayer");
    window.location.href = "wait.html";
  }
}

function randomSelect() {
  // مسح الاختيارات السابقة
  selectedBoxes = [];

  // إزالة التأثير من كل الأزرار
  document.querySelectorAll("#boxGrid button").forEach(btn => {
    btn.classList.remove("ring-4", "ring-yellow-400", "bg-[#B8860B]");
    btn.classList.add("bg-amber-400");
  });

  // جميع الأرقام المتاحة
  const available = Object.keys(imageMap).map(Number);

  // خلط عشوائي
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  // اختيار العدد المطلوب
  selectedBoxes = available.slice(0, roundCount);

  // تفعيلها بصريًا
  selectedBoxes.forEach(index => {
    const btn = document.querySelector(
      `#boxGrid button[data-index="${index}"]`
    );
    if (btn) {
      btn.classList.remove("bg-amber-400");
      btn.classList.add("ring-4", "ring-yellow-400", "bg-[#B8860B]");
    }
  });

  // إظهار زر التأكيد
  confirmBtn.classList.remove("hidden");
}

window.randomSelect = randomSelect;


window.confirmSelection = confirmSelection;
