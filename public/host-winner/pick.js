// public/host-winner/pick.js
const params = new URLSearchParams(window.location.search);
const gameID = params.get("game");
const playerKey = params.get("player");
const playerName = params.get("name");
const opponentName = params.get("opp") || "";
const oppAbsParam = params.get("oppabs") || "";
const roundCount = parseInt(params.get("rounds") || "3");

if (!gameID || !playerKey || !playerName) {
  alert("الرابط غير صالح.");
  location.href = "/";
}

const socket = io();
const instruction = document.getElementById("instruction");
const boxGrid = document.getElementById("boxGrid");
const confirmBtn = document.getElementById("confirmBtn");
const modal = document.getElementById("imageModal");
const modalOptions = document.getElementById("modalOptions");

// Read-only abilities UI refs (you)
const abilitiesWrap = document.getElementById("playerAbilities");
const abilityHint = document.getElementById("abilityHint");

// Opponent panel refs
const oppAbilitiesWrap = document.getElementById("oppAbilities");
const oppHint = document.getElementById("oppHint");

// Selected images panel refs
const selectedGrid = document.getElementById("selectedGrid");
const selectedCountEl = document.getElementById("selectedCount");
const selectedTotalEl = document.getElementById("selectedTotal");
if (selectedTotalEl) selectedTotalEl.textContent = String(roundCount);

instruction.textContent = `اللاعب ${playerName} اختر ${roundCount} بطاقة`;

let animeList = [];
let allUniqueImages = [];
let picks = [];
let boxOptions = {};
let currentModalBox = null;

// Pools
let legendaryPoolAll = [];
let normalPoolAll = [];

// Exclusions from Player 1
let excludedKeys = new Set();

// Tracking
let usedFullPaths = new Set();
let reservedFullPaths = new Set();

// Legendary % per-option (not global, not per-box guarantee)
const LEGENDARY_RATE = Math.max(0, Math.min(1, parseFloat(localStorage.getItem("legendaryRate") || "0.10")));

/* ========= Persistent keys ========= */
const optKeyFor = (boxIndex) => `pickOptions:${gameID}:${playerName}:box-${boxIndex}`;
const PENDING_KEY = `pendingBox:${gameID}:${playerName}`;

/* ========= Helpers ========= */
function saveBoxOptions(boxIndex, options) {
  try { localStorage.setItem(optKeyFor(boxIndex), JSON.stringify(options.map(o => o.fullPath))); } catch {}
}
function loadBoxOptions(boxIndex) {
  try {
    const raw = localStorage.getItem(optKeyFor(boxIndex));
    if (!raw) return null;
    const paths = JSON.parse(raw);
    if (!Array.isArray(paths) || !paths.length) return null;
    const map = new Map(allUniqueImages.map(o => [o.fullPath, o]));
    const rebuilt = paths.map(fp => map.get(fp)).filter(Boolean);
    return rebuilt.length ? rebuilt : null;
  } catch { return null; }
}
function clearBoxOptions(boxIndex) { try { localStorage.removeItem(optKeyFor(boxIndex)); } catch {} }
function getPendingBox() { try { const raw = localStorage.getItem(PENDING_KEY); return raw ? parseInt(raw) : null; } catch { return null; } }
function setPendingBox(i) { try { localStorage.setItem(PENDING_KEY, String(i)); } catch {} }
function clearPendingBox() { try { localStorage.removeItem(PENDING_KEY); } catch {} }

function normTexts(arr) {
  return (Array.isArray(arr) ? arr : []).map(a => (typeof a === "string" ? a : a?.text || "")).filter(Boolean);
}
function renderPills(el, list, {gold=false} = {}) {
  if (!el) return;
  el.innerHTML = "";
  normTexts(list).forEach(text => {
    const pill = document.createElement("span");
    pill.textContent = text;
    pill.className = gold
      ? "px-3 py-1 rounded-lg font-bold border border-yellow-500 bg-yellow-400 text-black select-none"
      : "px-3 py-1 rounded-lg font-bold border border-yellow-700 bg-gray-500/30 text-yellow-200 select-none";
    pill.setAttribute("aria-disabled","true");
    pill.style.pointerEvents = "none";
    el.appendChild(pill);
  });
}

/* ===== Abilities (you + opponent) ===== */
// You
socket.emit("requestAbilities", { gameID, playerName });
socket.on("receiveAbilities", ({ abilities }) => {
  if (!abilitiesWrap.dataset.filled) {
    renderPills(abilitiesWrap, abilities, { gold: true });
    abilityHint.textContent = abilities?.length
      ? "يمكنك طلب استخدام القدرات من صفحة ترتيب البطاقات."
      : "لا توجد قدرات محددة لك حتى الآن.";
    abilitiesWrap.dataset.filled = "1";
  }
});

// Opponent (socket by name if present, else URL fallback)
if (opponentName) {
  socket.emit("requestAbilities", { gameID, playerName: opponentName });
  socket.on("receiveAbilities", ({ abilities }) => {
    if (!oppAbilitiesWrap.dataset.filled && Array.isArray(abilities)) {
      renderPills(oppAbilitiesWrap, abilities, { gold: false });
      oppHint.textContent = abilities.length ? "" : "لا توجد قدرات مسجلة للخصم.";
      oppAbilitiesWrap.dataset.filled = "1";
    }
  });
}
if (!oppAbilitiesWrap.dataset.filled && oppAbsParam) {
  const parsed = oppAbsParam.split("|").map(s => s.trim()).filter(Boolean);
  renderPills(oppAbilitiesWrap, parsed, { gold: false });
  oppHint.textContent = parsed.length ? "" : "لا توجد قدرات مسجلة للخصم.";
  oppAbilitiesWrap.dataset.filled = "1";
}

/* ===== Utility helpers for picks UI ===== */
function sampleK(arr, k) {
  const a = arr.slice(); const n = a.length;
  for (let i = 0; i < Math.min(k, n); i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}
function createPreviewMedia(url, className) {
  const isWebm = /\.webm(\?|#|$)/i.test(url);
  if (isWebm) {
    const v = document.createElement("video");
    v.src = url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    v.className = className; v.setAttribute("aria-hidden", "true"); v.style.pointerEvents = "none";
    return v;
  } else {
    const img = document.createElement("img");
    img.src = url; img.className = className; img.alt = "اختيارك"; img.draggable = false;
    return img;
  }
}
function renderSelected() {
  if (!selectedGrid) return;
  selectedGrid.innerHTML = "";
  if (selectedCountEl) selectedCountEl.textContent = String(picks.length);
  if (!picks.length) {
    const p = document.createElement("p");
    p.className = "text-sm opacity-75";
    p.textContent = "لم تقم باختيار أي بطاقة بعد.";
    selectedGrid.appendChild(p);
    return;
  }
  picks.forEach((fullPath) => {
    const card = document.createElement("div");
    card.className = "bg-black/30 border border-yellow-700 rounded-lg p-2 flex items-center justify-center";
    const media = createPreviewMedia(fullPath, "w-full h-36 object-contain rounded");
    card.appendChild(media);
    selectedGrid.appendChild(card);
  });
}
function isBoxResolved(boxIndex) {
  const opts = loadBoxOptions(boxIndex);
  if (!opts || !opts.length) return false;
  const chosen = new Set(picks.map(fp => decodeURIComponent(fp)));
  return opts.some(o => chosen.has(decodeURIComponent(o.fullPath)));
}

/* ===== Restore pick progress ===== */
socket.emit("getPickProgress", { gameID, playerName });
socket.on("pickProgress", ({ picks: serverPicks = [], locked = false }) => {
  if (Array.isArray(serverPicks) && serverPicks.length) {
    picks = serverPicks.slice();
    serverPicks.forEach(fp => usedFullPaths.add(fp));
  }
  if (locked || picks.length === roundCount) {
    clearPendingBox();
    confirmBtn.classList.remove("hidden");
  }
  renderSelected();
});

/* ===== Flow to load images ===== */
socket.emit("getAnimeList", { gameID });

socket.on("animeList", (list) => {
  animeList = list;
  if (playerKey === "player1") loadAndRender();
  else if (playerKey === "player2") waitForExclusionsThenLoad();
});

socket.on("exclusionsData", (arr) => {
  if (playerKey !== "player2") return;
  if (Array.isArray(arr) && arr.length) {
    excludedKeys = new Set(arr.map(String));
    if (allUniqueImages.length === 0) loadAndRender();
  }
});

function waitForExclusionsThenLoad() {
  socket.emit("requestExclusions", { gameID });

  socket.once("exclusionsData", (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) {
      instruction.textContent = "جارٍ التحقق من اختيارات اللاعب الأول...";
      setTimeout(waitForExclusionsThenLoad, 800);
      return;
    }
    excludedKeys = new Set(arr.map(String));
    loadAndRender();
  });

  socket.once("exclusionsNotReady", () => {
    instruction.textContent = "انتظر قليلاً حتى ينتهي اللاعب الأول من اختياراته...";
    setTimeout(waitForExclusionsThenLoad, 800);
  });
}

async function fetchFolderList(folder) {
  const res = await fetch(`/list-images/${folder}?gameID=${gameID}`);
  if (!res.ok) throw new Error(`Failed to list ${folder}`);
  return res.json();
}

async function loadAndRender() {
  const map = new Map();
  legendaryPoolAll = [];
  normalPoolAll = [];

  for (const animeRaw of animeList) {
    const slug = String(animeRaw || "").toLowerCase().replace(/\s+/g, "");

    if (slug === "rarities") {
      const [legendaryFiles, normalFiles] = await Promise.all([
        fetchFolderList("legendary").catch(() => []),
        fetchFolderList("normal").catch(() => []),
      ]);

      legendaryFiles.forEach((file) => {
        const key = `legendary/${file}`;
        if (excludedKeys.has(key)) return;
        const fullPath = `/images/legendary/${file}`;
        if (!map.has(fullPath)) {
          const obj = { folder: "legendary", filename: file, key, fullPath };
          map.set(fullPath, obj);
          legendaryPoolAll.push(obj);
        }
      });
      normalFiles.forEach((file) => {
        const key = `normal/${file}`;
        if (excludedKeys.has(key)) return;
        const fullPath = `/images/normal/${file}`;
        if (!map.has(fullPath)) {
          const obj = { folder: "normal", filename: file, key, fullPath };
          map.set(fullPath, obj);
          normalPoolAll.push(obj);
        }
      });
    } else {
      try {
        const files = await fetchFolderList(slug);
        files.forEach((file) => {
          const key = `${slug}/${file}`;
          if (excludedKeys.has(key)) return;
          const fullPath = `/images/${slug}/${file}`;
          if (!map.has(fullPath)) {
            const obj = { folder: slug, filename: file, key, fullPath };
            map.set(fullPath, obj);
            if (slug === "legendary") legendaryPoolAll.push(obj);
            else if (slug === "normal") normalPoolAll.push(obj);
          }
        });
      } catch (e) {
        console.warn(`فشل تحميل صور: ${slug}`, e);
      }
    }
  }

  allUniqueImages = Array.from(map.values());

  if (allUniqueImages.length < 71) {
    boxGrid.innerHTML = `<p class="text-red-500 text-lg">عدد الصور غير كافٍ لجميع البطاقات.</p>`;
    return;
  }

  renderBoxes();
  renderSelected();
}

function renderBoxes() {
  boxGrid.innerHTML = "";
  for (let i = 1; i <= 20; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.dataset.index = i;
    btn.className = `
      px-6 py-4 rounded bg-amber-400 text-black text-xl font-bold
      hover:bg-yellow-400 hover:ring-4 hover:ring-yellow-300
    `;
    btn.onclick = () => openImageSelection(i);
    boxGrid.appendChild(btn);
  }
}

function createPickableMedia(url, className, onPick) {
  const isWebm = /\.webm(\?|#|$)/i.test(url);
  if (isWebm) {
    const vid = document.createElement("video");
    vid.src = url; vid.autoplay = true; vid.loop = true; vid.muted = true; vid.playsInline = true;
    vid.className = className; vid.onclick = () => onPick(url);
    return vid;
  } else {
    const img = document.createElement("img");
    img.src = url; img.className = className; img.onclick = () => onPick(url);
    return img;
  }
}

/* ===== Independent per-option 10% legendary selection ===== */
function eligibleFrom(poolArray) {
  return poolArray.filter((img) => {
    const fp = decodeURIComponent(img.fullPath);
    return !usedFullPaths.has(fp) && !reservedFullPaths.has(fp);
  });
}
function pickOneFrom(poolArray, takenSet) {
  const elig = eligibleFrom(poolArray).filter(img => !takenSet.has(decodeURIComponent(img.fullPath)));
  if (!elig.length) return null;
  const i = Math.floor(Math.random() * elig.length);
  return elig[i];
}

/**
 * For each of the 3 options inside this box, roll independently:
 *   if (rand < LEGENDARY_RATE) pick from legendary, else from normal.
 * Fallbacks: if chosen pool empty, try the other; then union as last resort.
 * Result: 0..3 legendary options possible. No guarantee a box has any legendary.
 */
function getOptionsForBox_PerOptionRolls() {
  const taken = new Set(); // avoid duplicates within this box
  const opts = [];

  for (let slot = 0; slot < 3; slot++) {
    const preferLegend = Math.random() < LEGENDARY_RATE;

    let pick = preferLegend ? pickOneFrom(legendaryPoolAll, taken)
                            : pickOneFrom(normalPoolAll, taken);

    if (!pick) pick = preferLegend ? pickOneFrom(normalPoolAll, taken)
                                   : pickOneFrom(legendaryPoolAll, taken);

    if (!pick) {
      const union = eligibleFrom([...legendaryPoolAll, ...normalPoolAll])
        .filter(img => !taken.has(decodeURIComponent(img.fullPath)));
      if (union.length) {
        pick = union[Math.floor(Math.random() * union.length)];
      }
    }

    if (pick) {
      opts.push(pick);
      taken.add(decodeURIComponent(pick.fullPath));
    } else {
      // If we truly can't fill this slot, break early.
      break;
    }
  }

  return opts;
}

/* ===== Core modal flow ===== */
function openImageSelection(boxIndex) {
  if (picks.length >= roundCount) { alert("تم اختيار كل البطاقات."); return; }

  const pending = getPendingBox();
  if (pending && pending !== boxIndex && !isBoxResolved(pending)) {
    alert(`يجب اختيار بطاقة من الصندوق رقم ${pending} أولاً قبل اختيار صندوق آخر.`);
    return;
  }

  currentModalBox = boxIndex;

  let options = loadBoxOptions(boxIndex);
  if (!options) {
    // ⬇️ Independent per-option roll @ 10% legendary
    options = getOptionsForBox_PerOptionRolls();
    if (!options.length) { alert("لا توجد صور كافية للاختيار."); return; }
    saveBoxOptions(boxIndex, options);
  }

  setPendingBox(boxIndex);
  boxOptions[boxIndex] = options;

  options.forEach(obj => reservedFullPaths.add(decodeURIComponent(obj.fullPath)));

  modalOptions.innerHTML = "";
  modal.classList.remove("hidden");

  options.forEach((imgObj) => {
    const onPick = (mediaUrl) => {
      const fullPath = decodeURIComponent(new URL(mediaUrl, window.location.origin).pathname);

      if (usedFullPaths.has(fullPath) || picks.includes(fullPath)) {
        closeModalAndRelease(currentModalBox, fullPath);
        return;
      }

      picks.push(fullPath);
      usedFullPaths.add(fullPath);

      socket.emit("savePickProgress", { gameID, playerName, picks });

      clearPendingBox();
      clearBoxOptions(currentModalBox);

      closeModalAndRelease(currentModalBox, fullPath);

      renderSelected();

      if (picks.length === roundCount) {
        confirmBtn.classList.remove("hidden");
      }
    };

    const mediaEl = createPickableMedia(
      imgObj.fullPath,
      "w-32 h-44 rounded cursor-pointer hover:scale-110 transition object-contain",
      onPick
    );

    modalOptions.appendChild(mediaEl);
  });
}

function closeModalAndRelease(boxIndex, pickedFullPath) {
  const opts = boxOptions[boxIndex] || [];
  opts.forEach(o => {
    const fp = decodeURIComponent(o.fullPath);
    if (fp !== pickedFullPath) reservedFullPaths.delete(fp);
  });
  boxOptions[boxIndex] = [];

  modal.classList.add("hidden");
  modalOptions.innerHTML = "";
  currentModalBox = null;
}

confirmBtn.onclick = () => {
  socket.emit("playerSubmitPicks", { gameID, playerName, playerKey, picks });

  localStorage.setItem(`${playerKey}Picks`, JSON.stringify(picks));
  localStorage.setItem("currentPlayer", playerKey);

  window.location.href = `order.html?game=${gameID}&player=${playerKey}&name=${encodeURIComponent(playerName)}`;
};
