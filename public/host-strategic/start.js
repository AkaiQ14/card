// public/host-strategic/start.js
const socket = io();
let createdGameID = null;

socket.on("diagEvent", ({ message }) => console.log("📊 Server diag:", message));

socket.emit("createGame");
socket.on("gameCreated", (gameID) => {
  createdGameID = gameID;
  localStorage.setItem("gameID", gameID);
  sendGameMeta();
});

// Single fixed source now: rarities = normal + legendary
const allAnimeOptions = ["Rarities (Normal + Legendary)"];

/* ========= Abilities: server is source of truth ========= */
const ABILITIES_MASTER_KEY = "abilitiesMasterList"; // local mirror only

const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";

function sendGameMeta() {
  const gameID = localStorage.getItem("gameID") || createdGameID;
  if (!gameID) return;
  const count = !!document.getElementById("countLeaderboard")?.checked;

  localStorage.setItem("countInLeaderboard", String(count));
  socket.emit("setGameMeta", { gameID, mode: "strategic", countLeaderboard: count });
}

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "countLeaderboard") sendGameMeta();
});

// ===== Local mirror helpers =====
function loadMasterAbilities() {
  try {
    const raw = localStorage.getItem(ABILITIES_MASTER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveMasterAbilities(list) {
  const clean = list.map(s => String(s).trim()).filter(Boolean);
  localStorage.setItem(ABILITIES_MASTER_KEY, JSON.stringify(clean));
  return clean;
}

// ===== Server fetchers =====
async function fetchServerAbilities() {
  try {
    const r = await fetch("/api/abilities");
    const data = await r.json();
    const list = Array.isArray(data?.abilities) ? data.abilities : [];
    saveMasterAbilities(list);
    renderAbilityList();
  } catch (e) {
    console.warn("[abilities] fetch failed:", e.message);
    renderAbilityList();
  }
}
async function addAbilityOnServer(text) {
  const r = await fetch("/api/abilities/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!r.ok) throw new Error("add failed");
  const data = await r.json();
  const list = Array.isArray(data?.abilities) ? data.abilities : [];
  saveMasterAbilities(list);
  renderAbilityList();
}
async function deleteAbilityOnServer(index) {
  const r = await fetch(`/api/abilities/${index}`, { method: "DELETE" });
  if (!r.ok) throw new Error("delete failed");
  const data = await r.json();
  const list = Array.isArray(data?.abilities) ? data.abilities : [];
  saveMasterAbilities(list);
  renderAbilityList();
}

// ===== UI list rendering =====
function renderAbilityList() {
  const ul = document.getElementById("abilityList");
  if (!ul) return;
  const list = loadMasterAbilities();
  ul.innerHTML = "";
  list.forEach((text, idx) => {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1";

    const span = document.createElement("span");
    span.textContent = text;
    span.className = "opacity-90";

    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "حذف (يحفظ في الملف)";
    del.className = "px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700";
    del.onclick = async () => {
      const arr = loadMasterAbilities();
      if (arr.length <= 6) {
        alert("لا يمكن حذف المزيد، يجب أن تبقى ٦ قدرات على الأقل.");
        return;
      }
      const ok = confirm(`هل تريد حذف القدرة التالية نهائيًا من القائمة؟\n\n"${text}"`);
      if (!ok) return;
      try {
        await deleteAbilityOnServer(idx);
      } catch (e) {
        console.error(e);
        alert("تعذر حذف القدرة من الملف.");
      }
    };

    li.appendChild(span);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

async function addAbilityFromInput() {
  const input = document.getElementById("newAbilityInput");
  const val = (input?.value || "").trim();
  if (!val) return;
  try {
    await addAbilityOnServer(val); // persists to abilities.json
    input.value = "";
  } catch (e) {
    console.error(e);
    alert("تعذر حفظ القدرة الجديدة.");
  }
}

// read from abilities.json (server)
function resetAbilitiesToDefault() {
  fetchServerAbilities(); // refresh local mirror from file
}

// ===== dealing =====
function sampleUnique(arr, count) {
  const a = arr.slice();
  for (let i = 0; i < Math.min(count, a.length); i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(count, a.length));
}

function dealAbilitiesToPlayers() {
  const master = loadMasterAbilities();
  const unique = Array.from(new Set(master));
  const status = document.getElementById("dealStatus");

  if (unique.length < 6) {
    status.textContent = "يجب أن تحتوي القائمة على ٦ قدرات على الأقل.";
    return;
  }

  const pickedForP1 = sampleUnique(unique, 3);
  const remaining = unique.filter((x) => !pickedForP1.includes(x));
  const pickedForP2 = sampleUnique(remaining, 3);

  const wrap = (arr) => arr.map((text) => ({ text, used: false }));

  localStorage.setItem(P1_ABILITIES_KEY, JSON.stringify(wrap(pickedForP1)));
  localStorage.setItem(P2_ABILITIES_KEY, JSON.stringify(wrap(pickedForP2)));

  document.getElementById("p1AbilitiesPreview").innerHTML = pickedForP1.map((t) => `<li>${t}</li>`).join("");
  document.getElementById("p2AbilitiesPreview").innerHTML = pickedForP2.map((t) => `<li>${t}</li>`).join("");
}

/* ========= Flow ========= */
function showAnimeDropdowns() {
  const p1 = document.getElementById("p1").value.trim();
  const p2 = document.getElementById("p2").value.trim();
  const roundCount = parseInt(document.getElementById("roundCount").value, 10);

  if (!p1 || !p2 || isNaN(roundCount) || roundCount <= 0) {
    alert("الرجاء إدخال جميع الحقول بشكل صحيح.");
    return;
  }

  localStorage.setItem("player1", p1);
  localStorage.setItem("player2", p2);
  localStorage.setItem("totalRounds", roundCount.toString());

  ["usedImages","player1Picks","player2Picks","currentPlayer",P1_ABILITIES_KEY,P2_ABILITIES_KEY].forEach((k) => localStorage.removeItem(k));

  document.getElementById("inputPhase").classList.add("hidden");
  document.getElementById("animePhase").classList.remove("hidden");

  const select = document.getElementById("singleAnimeSelect");
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "rarities";
  option.textContent = "Rarities (Normal + Legendary)";
  select.appendChild(option);
  select.value = "rarities";

  document.getElementById("p1NamePreview").textContent = `${p1} — القدرات`;
  document.getElementById("p2NamePreview").textContent = `${p2} — القدرات`;

  // Abilities UI (server-driven)
  fetchServerAbilities();

  const addBtn = document.getElementById("addAbilityBtn");
  if (addBtn) addBtn.onclick = addAbilityFromInput;

  const resetBtn = document.getElementById("resetAbilitiesBtn");
  if (resetBtn) resetBtn.onclick = resetAbilitiesToDefault;

  const dealBtn = document.getElementById("dealAbilitiesBtn");
  if (dealBtn) dealBtn.onclick = dealAbilitiesToPlayers;
}

function startGame() {
  localStorage.removeItem("gameUsedImages");

  const selectedAnime = document.getElementById("singleAnimeSelect")?.value || "rarities";
  const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
  const countFlag = !!document.getElementById("countLeaderboard")?.checked;

  const p1Abs = JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");
  const p2Abs = JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");
  if (p1Abs.length !== 3 || p2Abs.length !== 3) {
    alert("يجب توزيع ٣ قدرات لكل لاعب قبل بدء اللعبة.");
    return;
  }

  const animeList = Array(roundCount).fill(selectedAnime || "rarities");

  const gameID = localStorage.getItem("gameID");
  const player1 = localStorage.getItem("player1");
  const player2 = localStorage.getItem("player2");

  localStorage.setItem("animeList", JSON.stringify(animeList));
  localStorage.setItem("round", "0");
  localStorage.setItem("usedImages", "[]");
  localStorage.setItem("currentPlayer", "1");
  localStorage.setItem("player1Picks", JSON.stringify([]));
  localStorage.setItem("player2Picks", JSON.stringify([]));
  localStorage.setItem("player1Filenames", JSON.stringify([]));
  localStorage.setItem("player2Filenames", JSON.stringify([]));
  localStorage.setItem("player1Animes", JSON.stringify([]));
  localStorage.setItem("player2Animes", JSON.stringify([]));

  socket.emit("setGameMeta", { gameID, mode: "strategic", countLeaderboard: countFlag });
  socket.emit("manualAddPlayers", { gameID, playerNames: [player1, player2] });
  socket.emit("setAnimeList", { gameID, animeList });

  socket.emit("setAbilities", {
    gameID,
    abilities: {
      [player1]: p1Abs.map(a => a.text),
      [player2]: p2Abs.map(a => a.text),
    },
  });

  const base = `${window.location.origin}/host-strategic/order.html`;
  console.log("Player 1 link:", `${base}?game=${gameID}&player=player1&name=${encodeURIComponent(player1)}`);
  console.log("Player 2 link:", `${base}?game=${gameID}&player=player2&name=${encodeURIComponent(player2)}`);

  window.location.href = "pick.html";
}

// expose for inline handlers
window.showAnimeDropdowns = showAnimeDropdowns;
window.startGame = startGame;
