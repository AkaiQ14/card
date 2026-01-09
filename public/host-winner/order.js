const params = new URLSearchParams(window.location.search);
const gameID = params.get("game");
const playerKey = params.get("player"); // e.g., "player1"
const playerName = params.get("name");

const instruction = document.getElementById("instruction");
const grid = document.getElementById("cardGrid");
const continueBtn = document.getElementById("continueBtn");

// OK / Tamam
const okBtn = document.getElementById("okBtn");
// Persist per-player OK state locally
const OK_ACTIVE_KEY = `${playerKey}:okActive`;
if (localStorage.getItem(OK_ACTIVE_KEY) === null) {
  localStorage.setItem(OK_ACTIVE_KEY, "0"); // default: not active
}

// Abilities UI
const abilitiesWrap = document.getElementById("playerAbilities");
const abilityStatus = document.getElementById("abilityStatus");

// Opponent (view only)
const oppPanel = document.getElementById("opponentAbilitiesPanel");
const oppWrap  = document.getElementById("opponentAbilities");

instruction.innerText = `اللاعب ${playerName} رتب بطاقاتك`;

const socket = io();

// Optional local mirrors
const PICKS_LOCAL_KEY = `${playerKey}Picks`;
const ORDER_LOCAL_KEY = `${playerKey}Ordered`;

let picks = [];            // array of image urls
let submittedOrder = null; // array of image urls if already submitted

let opponentName = null;

// ===== Ability state (new) =====
let myAbilities = [];                 // authoritative objects: { text, used }
const tempUsed = new Set();           // optimistic local "used" flags by text
const pendingRequests = new Map();    // requestId -> abilityText

// ---------- Helpers ----------
function createMedia(url, className) {
  const isWebm = /\.webm(\?|#|$)/i.test(url);
  if (isWebm) {
    const vid = document.createElement("video");
    vid.src = url;
    vid.autoplay = true;
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.className = className;
    return vid;
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.className = className;
    return img;
  }
}

// Normalize to [{text, used}]
function normalizeAbilityList(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .map(a => {
      if (typeof a === "string") return { text: a.trim(), used: false };
      if (a && typeof a === "object") {
        return { text: String(a.text || "").trim(), used: !!a.used };
      }
      return null;
    })
    .filter(Boolean)
    .filter(a => a.text);
}

// Readonly chips (opponent)
function renderReadonlyBadges(container, list) {
  container.innerHTML = "";
  (list || []).forEach(ab => {
    const text = typeof ab === "string" ? ab : ab?.text || "";
    if (!text) return;
    const pill = document.createElement("span");
    pill.textContent = text;
    pill.className = "px-3 py-1 rounded-lg font-bold border border-gray-500 bg-gray-400/70 text-black select-none";
    container.appendChild(pill);
  });
}

function hideOpponentPanel() {
  if (oppPanel) {
    oppPanel.classList.add("hidden");
    oppWrap.innerHTML = "";
  }
}

// Clickable chips for self, honoring "used"
function renderMyBadges(container, abilities) {
  container.innerHTML = "";
  const list = Array.isArray(abilities) ? abilities : [];

  list.forEach(ab => {
    const isUsed = !!ab.used;
    const btn = document.createElement("button");
    btn.textContent = ab.text;
    btn.className =
      "px-3 py-1 rounded-lg font-bold border " +
      (isUsed
        ? "bg-gray-500/60 text-black/60 border-gray-600 cursor-not-allowed"
        : "bg-yellow-400 hover:bg-yellow-300 text-black border-yellow-500");

    if (isUsed) {
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    } else {
      btn.onclick = () => requestUseAbility(ab.text);
    }

    container.appendChild(btn);
  });
}

/* ============ منطق إخفاء الأرقام المختارة من باقي القوائم ============ */
function buildOptions(select, N, forbiddenSet, currentValue) {
  // أعد كتابة الخيارات مع استثناء الأرقام المختارة في قوائم أخرى (ما عدا الرقم الحالي لهذه القائمة)
  select.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "-- الترتيب --";
  select.appendChild(def);

  for (let i = 1; i <= N; i++) {
    if (!forbiddenSet.has(String(i)) || String(i) === String(currentValue)) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      select.appendChild(opt);
    }
  }

  // حافظ على القيمة الحالية إن كانت متاحة، وإلا أفرغ الاختيار
  if (currentValue && Array.from(select.options).some(o => o.value === String(currentValue))) {
    select.value = String(currentValue);
  } else {
    select.value = "";
  }
}

function snapshotChosen(selects) {
  const values = selects.map(s => s.value || "");
  const chosenSet = new Set(values.filter(Boolean)); // الأرقام المختارة فعلاً
  return { chosenSet, values };
}

function refreshAllSelects(selects, N) {
  const { chosenSet, values } = snapshotChosen(selects);
  selects.forEach((sel, idx) => buildOptions(sel, N, chosenSet, values[idx]));
  const allChosen = values.filter(Boolean).length === N && chosenSet.size === N;
  continueBtn.classList.toggle("hidden", !allChosen);
}

// ---------- Ask server for our picks + existing order ----------
socket.emit("getOrderData", { gameID, playerName });

socket.on("orderData", ({ picks: serverPicks = [], ordered = null }) => {
  if (Array.isArray(serverPicks) && serverPicks.length) {
    picks = serverPicks.slice();
    try { localStorage.setItem(PICKS_LOCAL_KEY, JSON.stringify(picks)); } catch {}
  } else {
    const localPicks = JSON.parse(localStorage.getItem(PICKS_LOCAL_KEY) || "[]");
    picks = Array.isArray(localPicks) ? localPicks : [];
  }

  submittedOrder = Array.isArray(ordered) && ordered.length ? ordered.slice() : null;
  try {
    if (submittedOrder) {
      localStorage.setItem(ORDER_LOCAL_KEY, JSON.stringify(submittedOrder));
    } else {
      localStorage.removeItem(ORDER_LOCAL_KEY);
    }
  } catch {}

  if (!picks.length) {
    grid.innerHTML = `<p class="text-red-500 text-lg">لم يتم العثور على بطاقات لهذا اللاعب.</p>`;
    return;
  }

  if (submittedOrder && submittedOrder.length === picks.length) {
    hideOpponentPanel();
    renderCards(submittedOrder, submittedOrder);

    // Show OK toggle after order is locked
    if (okBtn) {
      okBtn.classList.remove("hidden");
      const active = localStorage.getItem(OK_ACTIVE_KEY) === "1";
      setOkUi(active, false); // reflect saved state, don't emit
    }
    // ensure continue is hidden
    continueBtn.classList.add("hidden");
  } else {
    renderCards(picks, null);
    if (okBtn) okBtn.classList.add("hidden");
  }
});

// ---------- Render cards + dropdowns ----------
function renderCards(pickList, lockedOrder = null) {
  grid.innerHTML = "";

  const display = (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length)
    ? lockedOrder
    : pickList;

  const selects = [];

  display.forEach((url) => {
    const container = document.createElement("div");
    container.className = "flex flex-col items-center space-y-2";

    const media = createMedia(url, "w-36 h-48 object-contain rounded shadow");

    const select = document.createElement("select");
    select.className = "w-24 p-1 rounded bg-gray-800 text-white text-center text-lg orderSelect";

    // خيار افتراضي مبدئي (سيُعاد بناؤه عند التحديث)
    const defaultOption = new Option("-- الترتيب --", "");
    select.appendChild(defaultOption);

    if (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length) {
      // حالة الطلب مقفل: عيّن الرقم المناسب وعطّل القائمة
      const orderIndex = lockedOrder.findIndex(u => u === url);
      if (orderIndex >= 0) {
        const opt = new Option(String(orderIndex + 1), String(orderIndex + 1));
        select.appendChild(opt);
        select.value = String(orderIndex + 1);
        select.disabled = true;
      }
    }

    container.appendChild(media);
    container.appendChild(select);
    grid.appendChild(container);
    selects.push(select);
  });

  if (Array.isArray(lockedOrder) && lockedOrder.length === pickList.length) {
    // الطلب مقفل: اخفِ زر المتابعة
    continueBtn.classList.add("hidden");
  } else {
    // أبني الخيارات لكل قائمة مع منع التكرار + حدّث عند أي تغيير
    refreshAllSelects(selects, pickList.length);
    selects.forEach(sel => sel.addEventListener("change", () => {
      refreshAllSelects(selects, pickList.length);
    }));

    // يبقى زر المتابعة مخفيًا إلى أن تكتمل كل الاختيارات بدون تكرار
    continueBtn.classList.add("hidden");
    continueBtn.disabled = false;
    continueBtn.textContent = "متابعة";
  }
}

// ---------- Submit ----------
continueBtn.onclick = () => {
  if (Array.isArray(submittedOrder) && submittedOrder.length === picks.length) return;

  const selects = Array.from(document.querySelectorAll(".orderSelect"));
  const values = selects.map(s => parseInt(s.value, 10));
  const isValid = values.every(v => Number.isInteger(v) && v >= 1 && v <= picks.length);

  if (!isValid || new Set(values).size !== picks.length) {
    alert("يرجى ترتيب كل البطاقات بدون تكرار وضمن النطاق الصحيح.");
    return;
  }

  const ordered = new Array(picks.length);
  values.forEach((order, i) => {
    ordered[order - 1] = picks[i];
  });

  socket.emit("submitOrder", { gameID, playerName, ordered });
  try { localStorage.setItem(ORDER_LOCAL_KEY, JSON.stringify(ordered)); } catch {}

  submittedOrder = ordered.slice();

  hideOpponentPanel();
  renderCards(submittedOrder, submittedOrder);

  // After submission:
  // 1) Hide "متابعة" (already hidden by renderCards for locked state)
  continueBtn.classList.add("hidden");
  // 2) Reveal OK (default inactive) so player can signal readiness
  if (okBtn) {
    okBtn.classList.remove("hidden");
    setOkUi(false, true);                // send inactive to host
    localStorage.setItem(OK_ACTIVE_KEY, "0");
  }

  setTimeout(() => {
    location.replace(location.href);
  }, 300);
};

// ---------- Abilities (request-to-use for self; read-only for opponent) ----------

// Request mine
socket.emit("requestAbilities", { gameID, playerName });

// Refresh when host updates abilities (server -> viewers)
socket.on("diagEvent", () => {
  // server is authoritative; clear optimistic flags and re-fetch
  tempUsed.clear();
  pendingRequests.clear();
  socket.emit("requestAbilities", { gameID, playerName });
  if (opponentName) socket.emit("requestAbilities", { gameID, playerName: opponentName });
});

// learn opponent name and fetch theirs (view-only)
socket.emit("getPlayers", { gameID });
socket.on("players", (names = []) => {
  const arr = Array.isArray(names) ? names : [];
  opponentName = arr.find(n => n && n !== playerName) || null;
  if (opponentName) {
    socket.emit("requestAbilities", { gameID, playerName: opponentName });
  }
});

// router for abilities: self vs opponent
socket.on("receiveAbilities", ({ abilities, player }) => {
  const list = normalizeAbilityList(abilities || []);

  if (player === playerName || !player) {
    // mine — overlay optimistic tempUsed
    myAbilities = list.map(a => ({ ...a, used: a.used || tempUsed.has(a.text) }));
    renderMyBadges(abilitiesWrap, myAbilities);
    abilityStatus.textContent = myAbilities.length
      ? "اضغط على القدرة لطلب استخدامها. سيتم إشعار المستضيف."
      : "لا توجد قدرات متاحة حالياً.";
    return;
  }

  if (player === opponentName) {
    // hide if already submitted
    if (Array.isArray(submittedOrder) && submittedOrder.length === picks.length) {
      hideOpponentPanel();
      return;
    }
    renderReadonlyBadges(oppWrap, list);
  }
});

// render self abilities (click-to-request)
function requestUseAbility(abilityText) {
  abilityStatus.textContent = "تم إرسال طلب استخدام القدرة…";
  const requestId = `${playerName}:${Date.now()}`;

  // Optimistic: mark as used locally
  tempUsed.add(abilityText);
  pendingRequests.set(requestId, abilityText);
  myAbilities = (myAbilities || []).map(a =>
    a.text === abilityText ? { ...a, used: true } : a
  );
  renderMyBadges(abilitiesWrap, myAbilities);

  socket.emit("requestUseAbility", { gameID, playerName, abilityText, requestId });
}

socket.on("abilityRequestResult", ({ requestId, ok, reason }) => {
  const abilityText = pendingRequests.get(requestId);
  if (abilityText) pendingRequests.delete(requestId);

  if (!ok) {
    // revert optimistic state for this specific ability (if known)
    if (abilityText) {
      tempUsed.delete(abilityText);
      myAbilities = (myAbilities || []).map(a =>
        a.text === abilityText ? { ...a, used: false } : a
      );
      renderMyBadges(abilitiesWrap, myAbilities);
    }
    // fetch authoritative state in case of races
    socket.emit("requestAbilities", { gameID, playerName });

    if (reason === "already_used") {
      abilityStatus.textContent = "❌ القدرة تم استخدامها بالفعل. اطلب قدرة أخرى.";
    } else if (reason === "ability_not_found") {
      abilityStatus.textContent = "❌ القدرة غير معروفة لدى المستضيف.";
    } else {
      abilityStatus.textContent = "❌ تعذر تنفيذ الطلب.";
    }
  } else {
    // keep dark; host approved and server will sync used:true
    abilityStatus.textContent = "✅ تم قبول الطلب من المستضيف.";
  }
});

// ==== NEW: Toggle the embedded strategic live result view inside this page ====
(function(){
  const btn   = document.getElementById("openPlayerViewBtn");
  const wrap  = document.getElementById("embeddedPlayerWrap");
  const frame = document.getElementById("embeddedPlayerFrame");
  if (!(btn && wrap && frame)) return;

  btn.addEventListener("click", () => {
    // Adjust the path if your folders differ:
    // e.g., "/host-strategic/player-view.html" (same-origin)
    const url =
      `${location.origin}/host-strategic/player-view.html` +
      `?game=${encodeURIComponent(gameID || "")}` +
      `&name=${encodeURIComponent(playerName || "")}`;

    if (wrap.classList.contains("hidden")) {
      frame.src = url;                       // show + load
      wrap.classList.remove("hidden");
      btn.textContent = "إخفاء الجولة المباشرة";
    } else {
      frame.src = "";                        // hide + unload
      wrap.classList.add("hidden");
      btn.textContent = "عرض الجولة المباشرة";
    }
  });
})();

/* ========= OK / Tamam helpers ========= */
function setOkUi(active, emitChange = true) {
  if (!okBtn) return;
  const side = (playerKey === "player1") ? "right" : "left";

  if (active) {
    okBtn.textContent = "إلغاء تمام";
    okBtn.classList.remove("bg-emerald-600", "hover:bg-emerald-700");
    okBtn.classList.add("bg-gray-600", "hover:bg-gray-700");
  } else {
    okBtn.textContent = "تمام";
    okBtn.classList.add("bg-emerald-600", "hover:bg-emerald-700");
    okBtn.classList.remove("bg-gray-600", "hover:bg-gray-700");
  }

  if (emitChange) {
    socket.emit("playerOk", { gameID, playerName, side, active });
    localStorage.setItem(OK_ACTIVE_KEY, active ? "1" : "0");
  }
}

function togglePlayerOk() {
  const current = localStorage.getItem(OK_ACTIVE_KEY) === "1";
  setOkUi(!current, true);
}

if (okBtn) okBtn.addEventListener("click", togglePlayerOk);
