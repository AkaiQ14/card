// public/host-strategic/pick.js
const randomSound = new Audio("/sounds/random.mp3");
randomSound.volume = 1.0; // اختياري (0.0 – 1.0)

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
const LEGENDARY_RATE = 0.1; // 10% لكل خانة

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
      const rollLegendary = Math.random() < LEGENDARY_RATE;

      let chosen;

      if (rollLegendary) {
        // 10% → legendary
        chosen = popRandom(legendaryPool);

        // لو legendary خلص، اسحب normal بدلها
        if (!chosen) {
          chosen = popRandom(normalPool);
        }
      } else {
        // 90% → normal
        chosen = popRandom(normalPool);

        // لو normal خلص، اسحب legendary بدلها
        if (!chosen) {
          chosen = popRandom(legendaryPool);
        }
      }

      // أمان إضافي (نادرًا يُستخدم)
      if (!chosen) break;

      combined.push(chosen);
    }

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

    btn.innerHTML = `
      <div style="
        position:relative;
        width:100%;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
      ">

        <!-- الشعار الجديد -->
        <img src="../images/qg144.png"
     style="
       width:100px;
       height:100px;
       object-fit:contain;
     "
     alt="logo">


        <!-- الرقم -->
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

    btn.onmouseenter = () => btn.style.transform = "scale(1.05)";
    btn.onmouseleave = () => btn.style.transform = "scale(1)";

    btn.onclick = () => toggleBox(i, btn);

    boxGrid.appendChild(btn);

  }
}

function toggleBox(index, btn) {
  if (selectedBoxes.includes(index)) {

    // إلغاء التحديد
    selectedBoxes = selectedBoxes.filter((n) => n !== index);

    btn.style.filter = "none";
    btn.style.transform = "scale(1)";

  } else {

    if (selectedBoxes.length >= roundCount) return;

    selectedBoxes.push(index);

    // تحديد على شكل الشعار نفسه
    btn.style.filter = `
      drop-shadow(0 0 6px gold)
      drop-shadow(0 0 12px rgba(255,215,0,0.8))
      drop-shadow(0 0 20px rgba(255,165,0,0.6))
    `;

    btn.style.transform = "scale(1.08)";
  }

  confirmBtn.classList.toggle("hidden", selectedBoxes.length !== roundCount);
}


function randomSelect() {
  // 🔊 تشغيل الصوت
  randomSound.currentTime = 0;
  randomSound.play().catch(() => {});

  // فك أي اختيار سابق
  document.querySelectorAll("#boxGrid button").forEach(btn => {
    const index = Number(btn.dataset.index);
    if (selectedBoxes.includes(index)) {
      toggleBox(index, btn);
    }
  });

  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);

  while (selectedBoxes.length < roundCount && indices.length) {
    const r = Math.floor(Math.random() * indices.length);
    const index = indices.splice(r, 1)[0];

    const btn = document.querySelector(
      `#boxGrid button[data-index="${index}"]`
    );
    if (btn) toggleBox(index, btn);
  }
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

window.confirmSelection = confirmSelection;
window.randomSelect = randomSelect;