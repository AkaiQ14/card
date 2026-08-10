// public/host-winner/start.js
const socket = io({
  transports: ["websocket"],
  upgrade: false
});
let createdGameID = null;

socket.on("diagEvent", ({ message }) =>
  console.log("📊 Server diag:", message),
);

socket.emit("createGame");
socket.on("gameCreated", (gameID) => {
  createdGameID = gameID;
  localStorage.setItem("gameID", gameID);
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
    return true;
  } catch (e) {
    console.warn("[abilities] fetch failed:", e.message);
    renderAbilityList();
    return false;
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
  const count = document.getElementById("abilityCount");

  if (count) {
    count.textContent = `${list.length} قدرة`;
  }

  ul.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "ability-empty";
    empty.textContent = "لا توجد قدرات في القائمة حاليًا.";
    ul.appendChild(empty);
    return;
  }

  list.forEach((text, idx) => {
    const li = document.createElement("li");
    li.className = "ability-row";

    const number = document.createElement("span");
    number.className = "ability-index";
    number.textContent = String(idx + 1);

    const span = document.createElement("span");
    span.textContent = text;
    span.className = "ability-text";

    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "✕";
    del.title = "حذف القدرة";
    del.setAttribute("aria-label", `حذف القدرة ${text}`);
    del.className = "ability-delete";
    del.onclick = async () => {
      const arr = loadMasterAbilities();
      if (arr.length <= 6) {
        alert("لا يمكن حذف المزيد، يجب أن تبقى ٦ قدرات على الأقل.");
        return;
      }
      const ok = confirm(`هل تريد حذف القدرة التالية نهائيًا من القائمة؟\n\n"${text}"`);
      if (!ok) return;
      try {
        del.disabled = true;
        await deleteAbilityOnServer(idx);
      } catch (e) {
        console.error(e);
        alert("تعذر حذف القدرة من الملف.");
      } finally {
        del.disabled = false;
      }
    };

    li.appendChild(number);
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
    await addAbilityOnServer(val);
    input.value = "";
    setDealStatus("تمت إضافة القدرة إلى القائمة.", "success");
  } catch (e) {
    console.error(e);
    alert("تعذر حفظ القدرة الجديدة.");
  }
}

async function resetAbilitiesToDefault() {
  setDealStatus("جارٍ تحديث قائمة القدرات...");
  const ok = await fetchServerAbilities();
  setDealStatus(
    ok ? "تم تحديث قائمة القدرات." : "تعذر تحديث القائمة من الخادم.",
    ok ? "success" : "error"
  );
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

function setDealStatus(message, type = "") {
  const status = document.getElementById("dealStatus");
  if (!status) return;

  status.textContent = message || "";
  status.classList.remove("is-success", "is-error");

  if (type === "success") status.classList.add("is-success");
  if (type === "error") status.classList.add("is-error");
}

function dealAbilitiesToPlayers() {
  const master = loadMasterAbilities();
  const unique = Array.from(new Set(master));

  if (unique.length < 6) {
    setDealStatus("يجب أن تحتوي القائمة على ٦ قدرات على الأقل.", "error");
    return false;
  }

  const pickedForP1 = sampleUnique(unique, 3);
  const remaining = unique.filter((x) => !pickedForP1.includes(x));
  const pickedForP2 = sampleUnique(remaining, 3);

  const wrap = (arr) => arr.map((text) => ({ text, used: false }));
  localStorage.setItem(P1_ABILITIES_KEY, JSON.stringify(wrap(pickedForP1)));
  localStorage.setItem(P2_ABILITIES_KEY, JSON.stringify(wrap(pickedForP2)));

  setDealStatus("تم توزيع القدرات بنجاح.", "success");
  return true;
}

/* ========= MODAL (abilities result + start) ========= */
function openAbilitiesModalFromStorage() {
  const modal = document.getElementById("abilitiesModal");
  if (!modal) return;

  const p1Name = (localStorage.getItem("player1") || "اللاعب 1").trim();
  const p2Name = (localStorage.getItem("player2") || "اللاعب 2").trim();

  const p1Abs = JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");
  const p2Abs = JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");

  const mP1Name = document.getElementById("modalP1Name");
  const mP2Name = document.getElementById("modalP2Name");
  const mP1List = document.getElementById("modalP1Abilities");
  const mP2List = document.getElementById("modalP2Abilities");

  if (mP1Name) mP1Name.textContent = p1Name || "اللاعب 1";
  if (mP2Name) mP2Name.textContent = p2Name || "اللاعب 2";

  renderModalAbilityList(mP1List, p1Abs);
  renderModalAbilityList(mP2List, p2Abs);

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function renderModalAbilityList(container, abilities) {
  if (!container) return;

  container.innerHTML = "";

  (Array.isArray(abilities) ? abilities : []).forEach((ability, index) => {
    const item = document.createElement("li");
    item.className = "modal-ability-item";

    const number = document.createElement("span");
    number.className = "modal-ability-number";
    number.textContent = `${index + 1}.`;

    const text = document.createElement("span");
    text.textContent = String(ability?.text || "");

    item.appendChild(number);
    item.appendChild(text);
    container.appendChild(item);
  });
}

function closeAbilitiesModal() {
  const modal = document.getElementById("abilitiesModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

(function wireAbilitiesModal() {
  const backdrop = document.getElementById("abilitiesModalBackdrop");
  const closeBtn = document.getElementById("closeAbilitiesModal");
  const modalStartBtn = document.getElementById("modalStartBtn");

  if (backdrop) backdrop.addEventListener("click", closeAbilitiesModal);
  if (closeBtn) closeBtn.addEventListener("click", closeAbilitiesModal);

  if (modalStartBtn) {
    modalStartBtn.addEventListener("click", () => {
      startGame();
      closeAbilitiesModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("abilitiesModal");
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeAbilitiesModal();
    }
  });
})();

// ——— send meta (mode + count) to server ———
function sendGameMeta() {
  const gameID = localStorage.getItem("gameID") || createdGameID;
  if (!gameID) return;
  const count = !!document.getElementById("countLeaderboard")?.checked;

  localStorage.setItem("countInLeaderboard", String(count));

  socket.emit("setGameMeta", {
    gameID,
    mode: "winner",
    countLeaderboard: count,
  });
  console.log("[meta] setGameMeta sent:", { gameID, mode: "winner", count });
}

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "countLeaderboard") sendGameMeta();
});

/* ========= Flow ========= */
function updateStepIndicators(activeStep) {
  const setup = document.getElementById("setupStepIndicator");
  const abilities = document.getElementById("abilitiesStepIndicator");

  if (setup) {
    setup.classList.toggle("is-active", activeStep === 1);
    setup.classList.toggle("is-complete", activeStep === 2);
  }

  if (abilities) {
    abilities.classList.toggle("is-active", activeStep === 2);
  }
}

function showSetupPhase() {
  const inputPhase = document.getElementById("inputPhase");
  const animePhase = document.getElementById("animePhase");

  if (animePhase) animePhase.classList.add("hidden");
  if (inputPhase) {
    inputPhase.classList.remove("hidden");
    inputPhase.classList.add("phase-enter");
  }

  updateStepIndicators(1);
}

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

  ["globalUsed","picks","scores","currentRound",P1_ABILITIES_KEY,P2_ABILITIES_KEY].forEach((k) => localStorage.removeItem(k));

  const inputPhase = document.getElementById("inputPhase");
  const animePhase = document.getElementById("animePhase");

  inputPhase.classList.add("hidden");
  animePhase.classList.remove("hidden");
  animePhase.classList.add("phase-enter");
  updateStepIndicators(2);

  const select = document.getElementById("singleAnimeSelect");
  if (select) {
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "rarities";
    opt.textContent = "Rarities (Normal + Legendary)";
    opt.selected = true;
    select.appendChild(opt);
  }

  fetchServerAbilities();
  setDealStatus("");

  document.getElementById("addAbilityBtn").onclick = addAbilityFromInput;
  document.getElementById("resetAbilitiesBtn").onclick = resetAbilitiesToDefault;

  // ✅ Deal -> deal abilities then open MODAL
  document.getElementById("dealAbilitiesBtn").onclick = () => {
    const ok = dealAbilitiesToPlayers();
    if (ok) openAbilitiesModalFromStorage();
  };

  sendGameMeta();
}

function initRoundCountPicker() {
  const picker = document.getElementById("roundCountPicker");
  const trigger = document.getElementById("roundCountTrigger");
  const menu = document.getElementById("roundCountMenu");
  const valueInput = document.getElementById("roundCount");
  const text = document.getElementById("roundCountText");

  if (!picker || !trigger || !menu || !valueInput || !text) return;

  const items = Array.from(menu.querySelectorAll(".result-category-item"));

  const closePicker = () => {
    menu.classList.add("hidden");
    trigger.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  };

  const openPicker = () => {
    menu.classList.remove("hidden");
    trigger.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    const selected = menu.querySelector(".result-category-item.is-selected");
    if (selected) selected.focus({ preventScroll: true });
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("hidden")) openPicker();
    else closePicker();
  });

  items.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      valueInput.value = item.dataset.value || "";
      text.textContent = item.textContent.trim();

      items.forEach((option) => {
        const isSelected = option === item;
        option.classList.toggle("is-selected", isSelected);
        option.setAttribute("aria-selected", String(isSelected));
      });

      closePicker();
      trigger.focus();
    });
  });

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) closePicker();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.classList.contains("hidden")) {
      closePicker();
      trigger.focus();
    }
  });
}

(function wireStartPageUi() {
  const backBtn = document.getElementById("backToSetupBtn");
  const abilityInput = document.getElementById("newAbilityInput");

  if (backBtn) {
    backBtn.addEventListener("click", showSetupPhase);
  }

  if (abilityInput) {
    abilityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addAbilityFromInput();
      }
    });
  }

  updateStepIndicators(1);
  initRoundCountPicker();
  renderAbilityList();
})();

function startGame() {
  const p1Abs = JSON.parse(localStorage.getItem(P1_ABILITIES_KEY) || "[]");
  const p2Abs = JSON.parse(localStorage.getItem(P2_ABILITIES_KEY) || "[]");
  if (!p1Abs.length || !p2Abs.length) {
    alert("يجب توزيع القدرات أولاً قبل البدء.");
    return;
  }

  const anime = document.getElementById("singleAnimeSelect").value || "rarities";
  const roundCount = parseInt(localStorage.getItem("totalRounds") || "3", 10);
  const animeList = Array(roundCount).fill(anime);

  const gameID = localStorage.getItem("gameID");
  const player1 = localStorage.getItem("player1");
  const player2 = localStorage.getItem("player2");

  localStorage.setItem("animeList", JSON.stringify(animeList));
  localStorage.setItem("round", "0");

  socket.emit("manualAddPlayers", { gameID, playerNames: [player1, player2] });
  socket.emit("setAnimeList", { gameID, animeList });

  socket.emit("setAbilities", {
    gameID,
    abilities: {
      [player1]: p1Abs.map((a) => a.text),
      [player2]: p2Abs.map((a) => a.text),
    },
  });

  sendGameMeta();
  window.location.href = "pick.html";
}

window.showAnimeDropdowns = showAnimeDropdowns;
window.startGame = startGame;