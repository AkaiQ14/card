// public/host-strategic/start.js

const socket = io();
let createdGameID = null;

socket.emit("createGame");

socket.on("gameCreated", (gameID) => {
  createdGameID = gameID;
  localStorage.setItem("gameID", gameID);
  sendGameMeta();
});


/* ================= CONSTANTS ================= */

const ABILITIES_MASTER_KEY = "abilitiesMasterList";

const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";


/* ================= GAME META ================= */

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


/* ================= LOCAL STORAGE ================= */

function loadMasterAbilities() {
  try {
    const raw = localStorage.getItem(ABILITIES_MASTER_KEY);
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


/* ================= FETCH ================= */

async function fetchServerAbilities() {

  try {

    const r = await fetch("../abilities.json");
    const data = await r.json();

    const list = Array.isArray(data?.abilities)
      ? data.abilities
      : [];

    saveMasterAbilities(list);
    renderAbilityList();

  } catch {
    renderAbilityList();
  }
}


/* ================= RENDER ================= */

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

    const del = document.createElement("button");

    del.textContent = "✕";
    del.className =
      "px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700";

    del.onclick = () => {

      const arr = loadMasterAbilities();

      if (arr.length <= 6) {
        alert("يجب بقاء ٦ قدرات على الأقل");
        return;
      }

      if (!confirm(`حذف:\n${text}?`)) return;

      arr.splice(idx, 1);
      saveMasterAbilities(arr);
      renderAbilityList();
    };

    li.append(span, del);
    ul.appendChild(li);
  });
}


/* ================= ADD / RESET ================= */

function addAbilityFromInput() {

  const input = document.getElementById("newAbilityInput");

  const val = input.value.trim();

  if (!val) return;

  const list = loadMasterAbilities();

  list.unshift(val);

  saveMasterAbilities(list);
  renderAbilityList();

  input.value = "";
}

function resetAbilitiesToDefault() {

  fetchServerAbilities();
}


/* ================= DEAL ================= */

function shuffle(arr) {

  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {

    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
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

  const shuffled = shuffle(unique);

  const p1 = shuffled.slice(0, 3);
  const p2 = shuffled.slice(3, 6);


  // Save
  localStorage.setItem(
    P1_ABILITIES_KEY,
    JSON.stringify(p1)
  );

  localStorage.setItem(
    P2_ABILITIES_KEY,
    JSON.stringify(p2)
  );


  // Show modal
  showAbilitiesModal(p1, p2);
}


/* ================= MODAL ================= */

function showAbilitiesModal(a1, a2) {

  const modal = document.getElementById("abilitiesModal");
  const box = document.getElementById("modalBox");

  const p1 =
    document.getElementById("p1").value || "اللاعب 1";

  const p2 =
    document.getElementById("p2").value || "اللاعب 2";


  document.getElementById("modalP1Name").textContent = p1;
  document.getElementById("modalP2Name").textContent = p2;


  const list1 = document.getElementById("modalP1List");
  const list2 = document.getElementById("modalP2List");

  list1.innerHTML = "";
  list2.innerHTML = "";


  a1.forEach(x => {

    const li = document.createElement("li");
    li.textContent = "• " + x;
    list1.appendChild(li);
  });

  a2.forEach(x => {

    const li = document.createElement("li");
    li.textContent = "• " + x;
    list2.appendChild(li);
  });


  modal.classList.remove("hidden");

  setTimeout(() => {

    box.classList.remove("scale-90", "opacity-0");
    box.classList.add("scale-100", "opacity-100");

  }, 10);
}


/* ================= FLOW ================= */

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
    P1_ABILITIES_KEY,
    P2_ABILITIES_KEY
  ].forEach(k => localStorage.removeItem(k));


  document.getElementById("inputPhase")
    .classList.add("hidden");

  document.getElementById("animePhase")
    .classList.remove("hidden");


  fetchServerAbilities();


  document.getElementById("addAbilityBtn").onclick =
    addAbilityFromInput;

  document.getElementById("resetAbilitiesBtn").onclick =
    resetAbilitiesToDefault;

  document.getElementById("dealAbilitiesBtn").onclick =
    dealAbilitiesToPlayers;
}


/* ================= START ================= */

document.addEventListener("DOMContentLoaded", () => {

  // زر المتابعة داخل المودال
  document.getElementById("closeModalBtn").onclick = () => {

    window.location.href = "pick.html";
  };
});


/* ================= EXPORT ================= */

window.showAnimeDropdowns = showAnimeDropdowns;
