// public/host-strategic/start.js

const socket = io();
let createdGameID = null;

socket.on("diagEvent", ({ message }) =>
  console.log("📊 Server diag:", message)
);

socket.emit("createGame");

socket.on("gameCreated", (gameID) => {
  createdGameID = gameID;
  localStorage.setItem("gameID", gameID);
  sendGameMeta();
});


/* =================== CONSTANTS =================== */

const ABILITIES_MASTER_KEY = "abilitiesMasterList";

const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";


/* =================== GAME META =================== */

function sendGameMeta() {
  const gameID =
    localStorage.getItem("gameID") || createdGameID;

  if (!gameID) return;

  const count =
    !!document.getElementById("countLeaderboard")?.checked;

  localStorage.setItem(
    "countInLeaderboard",
    String(count)
  );

  socket.emit("setGameMeta", {
    gameID,
    mode: "strategic",
    countLeaderboard: count,
  });
}

document.addEventListener("change", (e) => {
  if (e.target?.id === "countLeaderboard") {
    sendGameMeta();
  }
});


/* =================== LOCAL STORAGE =================== */

function loadMasterAbilities() {
  try {
    const raw =
      localStorage.getItem(ABILITIES_MASTER_KEY);

    const arr = raw ? JSON.parse(raw) : [];

    return Array.isArray(arr) ? arr : [];

  } catch {
    return [];
  }
}

function saveMasterAbilities(list) {
  const clean = list
    .map((s) => String(s).trim())
    .filter(Boolean);

  localStorage.setItem(
    ABILITIES_MASTER_KEY,
    JSON.stringify(clean)
  );

  return clean;
}


/* =================== FETCH ABILITIES =================== */

async function fetchServerAbilities() {
  try {
    const r = await fetch("../abilities.json");

    const data = await r.json();

    const list = Array.isArray(data?.abilities)
      ? data.abilities
      : [];

    saveMasterAbilities(list);

    renderAbilityList();

    console.log("Loaded abilities:", list.length);

  } catch (e) {
    console.warn("[abilities]", e.message);
    renderAbilityList();
  }
}


/* =================== SERVER ACTIONS =================== */

async function addAbilityOnServer(text) {
  const r = await fetch("/api/abilities/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!r.ok) throw new Error("add failed");

  const data = await r.json();

  const list = Array.isArray(data?.abilities)
    ? data.abilities
    : [];

  saveMasterAbilities(list);

  renderAbilityList();
}

async function deleteAbilityOnServer(index) {
  const r = await fetch(
    `/api/abilities/${index}`,
    { method: "DELETE" }
  );

  if (!r.ok) throw new Error("delete failed");

  const data = await r.json();

  const list = Array.isArray(data?.abilities)
    ? data.abilities
    : [];

  saveMasterAbilities(list);

  renderAbilityList();
}


/* =================== RENDER LIST =================== */

function renderAbilityList() {
  const ul =
    document.getElementById("abilityList");

  if (!ul) return;

  const list = loadMasterAbilities();

  ul.innerHTML = "";

  list.forEach((text, idx) => {

    const li = document.createElement("li");

    li.className =
      "flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1";

    const span =
      document.createElement("span");

    span.textContent = text;

    span.className = "opacity-90";


    const del =
      document.createElement("button");

    del.textContent = "✕";

    del.className =
      "px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700";

    del.onclick = async () => {

      const arr = loadMasterAbilities();

      if (arr.length <= 6) {
        alert("يجب بقاء ٦ قدرات على الأقل");
        return;
      }

      if (!confirm(`حذف:\n${text}?`)) return;

      try {
        await deleteAbilityOnServer(idx);
      } catch {
        alert("تعذر الحذف");
      }
    };

    li.append(span, del);

    ul.appendChild(li);
  });
}


/* =================== ADD / RESET =================== */

async function addAbilityFromInput() {
  const input =
    document.getElementById("newAbilityInput");

  const val = input.value.trim();

  if (!val) return;

  try {
    await addAbilityOnServer(val);
    input.value = "";
  } catch {
    alert("فشل الحفظ");
  }
}

function resetAbilitiesToDefault() {
  fetchServerAbilities();
}


/* =================== DEALING =================== */

function sampleUnique(arr, count) {
  const a = arr.slice();

  for (let i = 0; i < count; i++) {

    const j =
      i + Math.floor(Math.random() * (a.length - i));

    [a[i], a[j]] = [a[j], a[i]];
  }

  return a.slice(0, count);
}


/* ====== DEAL + MODAL ====== */

function dealAbilitiesToPlayers() {

  const master = loadMasterAbilities();

  const unique = [...new Set(master)];

  if (unique.length < 6) {
    document.getElementById("dealStatus").textContent =
      "يجب وجود ٦ قدرات على الأقل";
    return;
  }


  const p1 = sampleUnique(unique, 3);

  const rest =
    unique.filter((x) => !p1.includes(x));

  const p2 = sampleUnique(rest, 3);


  // Save
  localStorage.setItem(
    P1_ABILITIES_KEY,
    JSON.stringify(p1.map(t => ({ text: t })))
  );

  localStorage.setItem(
    P2_ABILITIES_KEY,
    JSON.stringify(p2.map(t => ({ text: t })))
  );


  // Show Modal
  openAbilitiesModal(p1, p2);
}


/* =================== MODAL =================== */

function openAbilitiesModal(p1, p2) {

  const modal =
    document.getElementById("abilitiesModal");

  modal.classList.remove("hidden");
  modal.classList.add("flex");


  // Names
  document.getElementById("modalP1Name").textContent =
    localStorage.getItem("player1");

  document.getElementById("modalP2Name").textContent =
    localStorage.getItem("player2");


  // Lists
  document.getElementById("modalP1Abilities").innerHTML =
    p1.map(a => `<li>${a}</li>`).join("");

  document.getElementById("modalP2Abilities").innerHTML =
    p2.map(a => `<li>${a}</li>`).join("");
}


function closeAbilitiesModal() {

  const modal =
    document.getElementById("abilitiesModal");

  modal.classList.add("hidden");
  modal.classList.remove("flex");
}


/* =================== FLOW =================== */

function showAnimeDropdowns() {

  const p1 =
    document.getElementById("p1").value.trim();

  const p2 =
    document.getElementById("p2").value.trim();

  const round =
    parseInt(document.getElementById("roundCount").value);


  if (!p1 || !p2 || !round) {
    alert("املأ جميع الحقول");
    return;
  }


  localStorage.setItem("player1", p1);
  localStorage.setItem("player2", p2);
  localStorage.setItem("totalRounds", round);


  [
    "usedImages",
    "player1Picks",
    "player2Picks",
    "currentPlayer",
    P1_ABILITIES_KEY,
    P2_ABILITIES_KEY
  ].forEach(k =>
    localStorage.removeItem(k)
  );


  document.getElementById("inputPhase")
    .classList.add("hidden");

  document.getElementById("animePhase")
    .classList.remove("hidden");

  // Hide main logo in anime phase
  const logo = document.getElementById("mainLogo");
  if (logo) logo.classList.add("hidden");


  const select =
    document.getElementById("singleAnimeSelect");

  select.innerHTML = "";

  const opt =
    document.createElement("option");

  opt.value = "rarities";
  opt.textContent = "Rarities";

  select.appendChild(opt);


  fetchServerAbilities();


  document.getElementById("addAbilityBtn").onclick =
    addAbilityFromInput;

  document.getElementById("resetAbilitiesBtn").onclick =
    resetAbilitiesToDefault;

  document.getElementById("dealAbilitiesBtn").onclick =
    dealAbilitiesToPlayers;


  document.getElementById("closeAbilitiesModal").onclick =
    closeAbilitiesModal;

  document.getElementById("confirmAbilitiesBtn").onclick =
    closeAbilitiesModal;
}


/* =================== START GAME =================== */

function startGame() {

  const p1 =
    JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");

  const p2 =
    JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");

  if (p1.length !== 3 || p2.length !== 3) {
    alert("وزع القدرات أولاً");
    return;
  }


  const round =
    parseInt(localStorage.getItem("totalRounds"));

  const anime =
    document.getElementById("singleAnimeSelect").value;

  const gameID =
    localStorage.getItem("gameID");

  const player1 =
    localStorage.getItem("player1");

  const player2 =
    localStorage.getItem("player2");


  const animeList =
    Array(round).fill(anime);


  socket.emit("setGameMeta", {
    gameID,
    mode: "strategic"
  });

  socket.emit("manualAddPlayers", {
    gameID,
    playerNames: [player1, player2]
  });

  socket.emit("setAnimeList", {
    gameID,
    animeList
  });

  socket.emit("setAbilities", {
    gameID,
    abilities: {
      [player1]: p1.map(a => a.text),
      [player2]: p2.map(a => a.text),
    }
  });


  window.location.href = "pick.html";
}


/* =================== EXPORT =================== */

window.showAnimeDropdowns = showAnimeDropdowns;
window.startGame = startGame;

// ===== Modal Continue Button =====

document.addEventListener("DOMContentLoaded", () => {

  const confirmBtn = document.getElementById("confirmAbilitiesBtn");

  if (confirmBtn) {
    confirmBtn.onclick = () => {

      // تأكد أن القدرات موزعة
      const p1 = JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");
      const p2 = JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");

      if (p1.length !== 3 || p2.length !== 3) {
        alert("يجب توزيع القدرات أولاً.");
        return;
      }

      // اغلاق النافذة
      document.getElementById("abilitiesModal").classList.add("hidden");

      // الانتقال للصفحة التالية
      window.location.href = "pick.html";
    };
  }

});
