// public/host-winner/start.js
const socket = io();
let createdGameID = null;

socket.on("diagEvent", ({ message }) =>
  console.log("📊 Server diag:", message),
);

socket.emit("createGame");
socket.on("gameCreated", (gameID) => {
  createdGameID = gameID;
  localStorage.setItem("gameID", gameID);
  // Send meta as early as possible with user’s current checkbox state
  sendGameMeta();
});

// Single virtual source now: rarities = normal + legendary
const allAnimeOptions = ["Rarities (Normal + Legendary)"];

/* ========= Abilities: server is source of truth ========= */
const ABILITIES_MASTER_KEY = "abilitiesMasterList"; // local mirror only
const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";

// ——— abilities local mirror helpers ———
function loadMasterAbilities() {
  try {
    const raw = localStorage.getItem(ABILITIES_MASTER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveMasterAbilities(list) {
  const clean = list.map((s) => String(s).trim()).filter(Boolean);
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
    renderAbilityList(); // fall back to whatever is cached locally
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

// ——— UI list rendering ———
function renderAbilityList() {
  const ul = document.getElementById("abilityList");
  if (!ul) return;
  const list = loadMasterAbilities();
  ul.innerHTML = "";
  list.forEach((text, idx) => {
    const li = document.createElement("li");
    li.className =
      "flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1";
    const span = document.createElement("span");
    span.textContent = text;
    span.className = "opacity-90";

    // delete now persists (server) + confirmation
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

// ——— random dealing ———
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
  document.getElementById("p1AbilitiesPreview").innerHTML = pickedForP1
    .map((t) => `<li>${t}</li>`)
    .join("");
  document.getElementById("p2AbilitiesPreview").innerHTML = pickedForP2
    .map((t) => `<li>${t}</li>`)
    .join("");

  const startBtn = document.getElementById("startBtn");
  const hint = document.getElementById("startHint");
  if (startBtn) startBtn.disabled = false;
  if (hint) hint.textContent = "";
}

// ——— send meta (mode + count) to server ———
function sendGameMeta() {
  const gameID = localStorage.getItem("gameID") || createdGameID;
  if (!gameID) return;
  const count = !!document.getElementById("countLeaderboard")?.checked;

  // persist so result page can read
  localStorage.setItem("countInLeaderboard", String(count));

  socket.emit("setGameMeta", {
    gameID,
    mode: "winner",
    countLeaderboard: count,
  });
  console.log("[meta] setGameMeta sent:", { gameID, mode: "winner", count });
}

// Keep server meta in sync when checkbox changes
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "countLeaderboard") sendGameMeta();
});

/* ========= Flow ========= */
function showAnimeDropdowns() {
  const p1 = document.getElementById("p1").value.trim();
  const p2 = document.getElementById("p2").value.trim();
  const roundCount = parseInt(document.getElementById("roundCount").value);

  if (!p1 || !p2 || isNaN(roundCount) || roundCount <= 0) {
    alert("الرجاء إدخال جميع الحقول بشكل صحيح.");
    return;
  }

  localStorage.setItem("player1", p1);
  localStorage.setItem("player2", p2);
  localStorage.setItem("totalRounds", roundCount.toString());

  [
    "globalUsed",
    "picks",
    "scores",
    "currentRound",
    P1_ABILITIES_KEY,
    P2_ABILITIES_KEY,
  ].forEach((k) => localStorage.removeItem(k));

  document.getElementById("inputPhase").classList.add("hidden");
  document.getElementById("animePhase").classList.remove("hidden");

  const select = document.getElementById("singleAnimeSelect");
  if (select) {
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "rarities";
    opt.textContent = "Rarities (Normal + Legendary)";
    opt.selected = true;
    select.appendChild(opt);
  }

  document.getElementById("p1NamePreview").textContent = p1;
  document.getElementById("p2NamePreview").textContent = p2;

  // Abilities UI (server-driven)
  fetchServerAbilities();

  document.getElementById("addAbilityBtn").onclick = addAbilityFromInput;
  document.getElementById("resetAbilitiesBtn").onclick = resetAbilitiesToDefault;
  document.getElementById("dealAbilitiesBtn").onclick = dealAbilitiesToPlayers;

  sendGameMeta();
}

function startGame() {
  const p1Abs = JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");
  const p2Abs = JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");
  if (!p1Abs.length || !p2Abs.length) {
    alert("يجب توزيع القدرات أولاً قبل البدء.");
    return;
  }

  const anime =
    document.getElementById("singleAnimeSelect").value || "rarities";
  const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
  const animeList = Array(roundCount).fill(anime); // "rarities" repeated

  const gameID = localStorage.getItem("gameID");
  const player1 = localStorage.getItem("player1");
  const player2 = localStorage.getItem("player2");

  localStorage.setItem("animeList", JSON.stringify(animeList));
  localStorage.setItem("round", "0");

  socket.emit("manualAddPlayers", { gameID, playerNames: [player1, player2] });
  socket.emit("setAnimeList", { gameID, animeList });

  // publish abilities to players
  socket.emit("setAbilities", {
    gameID,
    abilities: {
      [player1]: p1Abs.map((a) => a.text),
      [player2]: p2Abs.map((a) => a.text),
    },
  });

  sendGameMeta();

  console.log(
    "Player 1 Link:",
    `${window.location.origin}/host-winner/pick.html?game=${gameID}&player=player1&name=${encodeURIComponent(player1)}&rounds=${roundCount}`,
  );
  console.log(
    "Player 2 Link:",
    `${window.location.origin}/host-winner/pick.html?game=${gameID}&player=player2&name=${encodeURIComponent(player2)}&rounds=${roundCount}`,
  );

  window.location.href = "wait.html";
}

window.showAnimeDropdowns = showAnimeDropdowns;
window.startGame = startGame;
