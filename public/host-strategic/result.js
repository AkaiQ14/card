
// ===== QG14 robust local media path resolver =====
function resolveQG14MediaUrl(value) {
  if (!value) return value;
  const raw = String(value).trim();
  if (!raw || /^(?:data:|blob:|https?:\/\/)/i.test(raw)) return raw;
  let clean = raw.replace(/\\/g, "/");
  const suffixMatch = clean.match(/([?#].*)$/);
  const suffix = suffixMatch ? suffixMatch[1] : "";
  if (suffix) clean = clean.slice(0, -suffix.length);
  try { clean = decodeURIComponent(clean); } catch {}
  const lower = clean.toLowerCase();
  const animeIndex = lower.lastIndexOf("/anime/images/");
  const normalIndex = lower.lastIndexOf("/images/");
  if (animeIndex >= 0) clean = clean.slice(animeIndex);
  else if (normalIndex >= 0) clean = clean.slice(normalIndex);
  else {
    clean = clean.replace(/^\.{0,2}\/+/, "").replace(/^public\//i, "");
    if (/^(?:anime\/)?images\//i.test(clean)) clean = "/" + clean;
    else return raw;
  }
  clean = clean.replace(/\/{2,}/g, "/");
  if (location.pathname.startsWith("/anime/") && clean.startsWith("/images/")) clean = "/anime" + clean;
  return clean + suffix;
}

// --- Game state (safe defaults) ---
const roundCount = parseInt(localStorage.getItem("roundCount") || localStorage.getItem("totalRounds") || "5", 10);
const startingHP = parseInt(localStorage.getItem("totalRounds") || "5", 10);
const player1 = localStorage.getItem("player1") || "لاعب 1"; // right column
const player2 = localStorage.getItem("player2") || "لاعب 2"; // left column
const picks    = JSON.parse(localStorage.getItem("picks") || "{}");
let round      = parseInt(localStorage.getItem("currentRound") || "0", 10);

// Scores init/persist
let scores = JSON.parse(localStorage.getItem("scores") || "{}");
if (!Number.isFinite(scores?.[player1])) scores[player1] = startingHP;
if (!Number.isFinite(scores?.[player2])) scores[player2] = startingHP;

// ======================================================
// Recap (latest result reached in each round)
// ======================================================
const ROUND_START_SCORES_KEY = "roundStartScores";
const ROUND_RECAP_STATE_KEY =
  "roundRecapStates:" +
  (
    localStorage.getItem("gameID") ||
    `${player1}:${player2}:${roundCount}`
  );
const ROUND_RECAP_NOTES_KEY =
  ROUND_RECAP_STATE_KEY.replace(
    "roundRecapStates:",
    "roundRecapNotes:"
  );
const ROUND_RECAP_SCORES_KEY =
  ROUND_RECAP_STATE_KEY.replace(
    "roundRecapStates:",
    "roundRecapScores:"
  );

function loadRoundStartScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUND_START_SCORES_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveRoundStartScores(obj) {
  localStorage.setItem(ROUND_START_SCORES_KEY, JSON.stringify(obj));
}

function loadRoundRecapStates() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(
        ROUND_RECAP_STATE_KEY
      ) || "{}"
    );

    return raw && typeof raw === "object"
      ? raw
      : {};
  } catch {
    return {};
  }
}

function saveRoundRecapStates(obj) {
  localStorage.setItem(
    ROUND_RECAP_STATE_KEY,
    JSON.stringify(obj || {})
  );
}

function loadRoundRecapNotes() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(
        ROUND_RECAP_NOTES_KEY
      ) || "{}"
    );

    return raw && typeof raw === "object"
      ? raw
      : {};
  } catch {
    return {};
  }
}

function saveRoundRecapNotes(obj) {
  localStorage.setItem(
    ROUND_RECAP_NOTES_KEY,
    JSON.stringify(obj || {})
  );
}

function loadRoundRecapScores() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(
        ROUND_RECAP_SCORES_KEY
      ) || "{}"
    );

    return raw && typeof raw === "object"
      ? raw
      : {};
  } catch {
    return {};
  }
}

function saveRoundRecapScores(obj) {
  localStorage.setItem(
    ROUND_RECAP_SCORES_KEY,
    JSON.stringify(obj || {})
  );
}

// The start of the next round is the final result reached in the
// previous round. Fall back to the round's own starting result when
// older saved data does not include the following round.
function getRecapRoundScores(all, roundIndex) {
  return (
    all[String(roundIndex + 1)] ||
    all[String(roundIndex)] ||
    null
  );
}

function normalizeRoundScores(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const readFiniteScore = keys => {
    for (const key of keys) {
      if (
        !Object.prototype.hasOwnProperty.call(
          data,
          key
        )
      ) {
        continue;
      }

      const value = data[key];
      if (value === null || value === "") {
        continue;
      }

      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }

    return null;
  };

  // Fixed keys are used by the new version. Player-name keys keep
  // all previously saved recap results compatible.
  const p1Score = readFiniteScore([
    "p1",
    player1,
    "player1"
  ]);

  const p2Score = readFiniteScore([
    "p2",
    player2,
    "player2"
  ]);

  if (
    !Number.isFinite(p1Score) ||
    !Number.isFinite(p2Score)
  ) {
    return null;
  }

  return {
    p1: p1Score,
    p2: p2Score
  };
}

// Saves the latest confirmed result for this round. Confirming the
// same recap round again replaces only that round's previous result.
function saveRoundScoresForRecap(roundIndex) {
  const all = loadRoundRecapScores();

  const p1Score = Number(scores[player1]);
  const p2Score = Number(scores[player2]);

  if (
    !Number.isFinite(p1Score) ||
    !Number.isFinite(p2Score)
  ) {
    return;
  }

  all[String(roundIndex)] = {
    p1: p1Score,
    p2: p2Score
  };

  saveRoundRecapScores(all);
}

function getRoundScoresForRecap(
  roundIndex,
  roundStartScores,
  savedScores = null
) {
  const key = String(roundIndex);
  const latest =
    savedScores ||
    loadRoundRecapScores();

  const saved =
    normalizeRoundScores(latest[key]);

  if (saved) {
    return saved;
  }

  // Compatibility with the immediately previous recap version.
  const previousState =
    loadRoundRecapStates()[key];

  const previous =
    normalizeRoundScores(
      previousState?.scores
    );

  if (previous) {
    return previous;
  }

  return normalizeRoundScores(
    getRecapRoundScores(
      roundStartScores,
      roundIndex
    )
  );
}

// Records the score each player had the moment a round began.
// Only writes once per round so later health changes never overwrite it.
function recordRoundStartIfNeeded(roundIndex) {
  const all = loadRoundStartScores();
  const key = String(roundIndex);

  if (!all[key]) {
    all[key] = {
      [player1]: scores[player1],
      [player2]: scores[player2]
    };
    saveRoundStartScores(all);
  }
}

// Capture the current round's starting values (handles fresh game start
// and page reloads mid-round without overwriting an existing snapshot).
recordRoundStartIfNeeded(round);

const roundTitle = document.getElementById("roundTitle");

// Replace abilities headings with player names
try {
  const t1 = document.getElementById("p1AbilitiesTitle");
  const t2 = document.getElementById("p2AbilitiesTitle");
  if (t1) t1.textContent = player1;
  if (t2) t2.textContent = player2;
} catch {}

// Ability storage keys
const P1_ABILITIES_KEY = "player1Abilities";
const P2_ABILITIES_KEY = "player2Abilities";
const ABILITIES_MASTER_KEY = "abilitiesMasterList";
const NOTES_KEY = (name) => `notes:${name}`;

// ======================================================
// Notes normalize
// ======================================================
function normalizeNotes(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/^\n+/, "");
}

function ensureSecondLine(text) {
  return normalizeNotes(text);
}

function getRecapRoundNotes(all, roundIndex) {
  const data = all[String(roundIndex)];

  return (
    data &&
    typeof data.notes === "object"
  )
    ? data.notes
    : null;
}

// Saves only the visible notes for the confirmed round. It does not
// change scores or any other round state.
function saveRoundNotesForRecap(roundIndex) {
  const all = loadRoundRecapNotes();

  const p1Textarea =
    findNotesTextarea(player1);

  const p2Textarea =
    findNotesTextarea(player2);

  all[String(roundIndex)] = {
    [player1]: normalizeNotes(
      p1Textarea
        ? p1Textarea.value
        : localStorage.getItem(
            NOTES_KEY(player1)
          ) || ""
    ),

    [player2]: normalizeNotes(
      p2Textarea
        ? p2Textarea.value
        : localStorage.getItem(
            NOTES_KEY(player2)
          ) || ""
    )
  };

  saveRoundRecapNotes(all);
}

function getRoundNotesForRecap(roundIndex) {
  const key = String(roundIndex);
  const notes = loadRoundRecapNotes();

  if (
    notes[key] &&
    typeof notes[key] === "object"
  ) {
    return notes[key];
  }

  // Compatibility with snapshots created by the earlier version.
  const previousState =
    loadRoundRecapStates()[key];

  if (
    previousState &&
    typeof previousState.notes === "object"
  ) {
    return previousState.notes;
  }

  return (
    getRecapRoundNotes(
      loadRoundStartScores(),
      roundIndex
    ) ||
    {}
  );
}

// ======================================================
// Socket
// ======================================================
const gameID = localStorage.getItem("gameID");
const socket = typeof io !== "undefined" ? io() : null;

const RESULT_CARD_SCOPE =
  window.location.pathname.startsWith("/anime/")
    ? "anime"
    : "all";

const RESULT_CARD_ASSET_PREFIX =
  RESULT_CARD_SCOPE === "anime"
    ? "/anime"
    : "";

const GOLDEN_LEGENDARY_CHANCE = 0.10;
const GOLDEN_STATE_KEY =
  `goldenRoundState:v1:${RESULT_CARD_SCOPE}:${String(gameID || "default")}`;

function loadGoldenState() {
  try {
    const data = JSON.parse(
      localStorage.getItem(GOLDEN_STATE_KEY) || "null"
    );

    if (
      !data ||
      typeof data !== "object" ||
      data.scope !== RESULT_CARD_SCOPE ||
      String(data.gameID || "") !== String(gameID || "")
    ) {
      return {
        active: false,
        number: 0,
        cards: {},
        usedKeys: []
      };
    }

    return {
      active: !!data.active,
      number: Math.max(0, Number(data.number) || 0),
      cards: data.cards && typeof data.cards === "object"
        ? data.cards
        : {},
      usedKeys: Array.isArray(data.usedKeys)
        ? data.usedKeys.map(v => String(v || "").toLowerCase()).filter(Boolean)
        : []
    };
  } catch {
    return {
      active: false,
      number: 0,
      cards: {},
      usedKeys: []
    };
  }
}

let goldenState = loadGoldenState();
let goldenRulesMode = "initial";

function saveGoldenState() {
  localStorage.setItem(
    GOLDEN_STATE_KEY,
    JSON.stringify({
      active: !!goldenState.active,
      number: Math.max(0, Number(goldenState.number) || 0),
      cards: goldenState.cards || {},
      usedKeys: Array.from(
        new Set(
          (Array.isArray(goldenState.usedKeys) ? goldenState.usedKeys : [])
            .map(v => String(v || "").toLowerCase())
            .filter(Boolean)
        )
      ),
      scope: RESULT_CARD_SCOPE,
      gameID: String(gameID || ""),
      updatedAt: Date.now()
    })
  );
}

function clearGoldenState() {
  goldenState = {
    active: false,
    number: 0,
    cards: {},
    usedKeys: []
  };
  localStorage.removeItem(GOLDEN_STATE_KEY);
}

function isGoldenRoundActive() {
  return !!goldenState.active;
}

function getGoldenRoundIndex() {
  return roundCount + Math.max(0, Number(goldenState.number || 1) - 1);
}

function getCurrentCardUrl(name) {
  if (isGoldenRoundActive()) {
    return goldenState.cards?.[name] || null;
  }

  return picks?.[name]?.[round] || null;
}

if (
  goldenState.active &&
  goldenState.number > 0 &&
  goldenState.cards?.[player1] &&
  goldenState.cards?.[player2]
) {
  round = getGoldenRoundIndex();
  localStorage.setItem("currentRound", String(round));
}

function goldenRandomUnit() {
  try {
    if (window.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
  } catch {}

  return Math.random();
}

function goldenRandomIndex(length) {
  if (!Number.isFinite(length) || length <= 0) return -1;
  return Math.floor(goldenRandomUnit() * length);
}

function isGoldenMediaFile(value) {
  return /\.(png|jpg|jpeg|webp|gif|avif|bmp|svg|apng|webm|mp4|ogg)$/i.test(
    String(value || "")
  );
}

function normalizeGoldenListEntry(folder, entry) {
  if (typeof entry === "string") {
    const filename = entry.trim();
    if (!filename || !isGoldenMediaFile(filename)) return null;

    return {
      folder,
      filename,
      key: `${folder}/${filename}`.toLowerCase(),
      url: `${RESULT_CARD_ASSET_PREFIX}/images/${folder}/${encodeURIComponent(filename)}`
    };
  }

  if (!entry || typeof entry !== "object") return null;

  const filename = String(
    entry.filename ||
    entry.name ||
    entry.file ||
    ""
  ).trim();

  const explicitUrl = String(
    entry.url ||
    entry.fullPath ||
    entry.path ||
    ""
  ).trim();

  if (filename && isGoldenMediaFile(filename)) {
    return {
      folder,
      filename,
      key: `${folder}/${filename}`.toLowerCase(),
      url: explicitUrl
        ? resolveQG14MediaUrl(explicitUrl)
        : `${RESULT_CARD_ASSET_PREFIX}/images/${folder}/${encodeURIComponent(filename)}`
    };
  }

  if (explicitUrl && isGoldenMediaFile(explicitUrl)) {
    let clean = explicitUrl;
    try {
      clean = decodeURIComponent(
        new URL(explicitUrl, window.location.href).pathname
      );
    } catch {
      try { clean = decodeURIComponent(explicitUrl); } catch {}
    }

    const match = clean.match(
      /\/images\/(normal|legendary)\/([^/?#]+)$/i
    );

    if (!match) return null;

    return {
      folder: match[1].toLowerCase(),
      filename: match[2],
      key: `${match[1]}/${match[2]}`.toLowerCase(),
      url: resolveQG14MediaUrl(explicitUrl)
    };
  }

  return null;
}

function uniqueGoldenCards(cards) {
  const seen = new Set();
  const out = [];

  for (const card of Array.isArray(cards) ? cards : []) {
    const key = String(card?.key || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }

  return out;
}

async function fetchGoldenFolder(folder) {
  const url =
    `/list-images/${encodeURIComponent(folder)}` +
    `?scope=${encodeURIComponent(RESULT_CARD_SCOPE)}` +
    `&_golden=${Date.now()}`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`تعذر تحميل كروت ${folder}`);
  }

  const payload = await response.json();
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.files)
      ? payload.files
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return uniqueGoldenCards(
    list
      .map(entry => normalizeGoldenListEntry(folder, entry))
      .filter(Boolean)
  );
}

function goldenIdentityFromUrl(value) {
  if (!value) return "";

  let clean = String(value);
  try {
    clean = decodeURIComponent(
      new URL(clean, window.location.href).pathname
    );
  } catch {
    try { clean = decodeURIComponent(clean); } catch {}
    clean = clean.split(/[?#]/, 1)[0];
  }

  clean = clean.replace(/\\/g, "/");
  const match = clean.match(
    /\/images\/(normal|legendary)\/(.+)$/i
  );

  return match
    ? `${match[1]}/${match[2]}`.toLowerCase()
    : clean.toLowerCase();
}

function getNormalMatchCardKeys() {
  const keys = new Set();

  [player1, player2].forEach(name => {
    const list = Array.isArray(picks?.[name])
      ? picks[name]
      : [];

    list.forEach(url => {
      const key = goldenIdentityFromUrl(url);
      if (key) keys.add(key);
    });
  });

  return keys;
}

function chooseGoldenCard(
  preferredFolder,
  pools,
  sameRoundBlocked,
  strongBlocked
) {
  const fallbackFolder =
    preferredFolder === "legendary"
      ? "normal"
      : "legendary";

  const tryFolder = folder => {
    const pool = Array.isArray(pools?.[folder])
      ? pools[folder]
      : [];

    if (!pool.length) return null;

    // First: preserve rarity and prefer a card that did not appear in the
    // normal match or an earlier golden round.
    let candidates = pool.filter(card =>
      !sameRoundBlocked.has(card.key) &&
      !strongBlocked.has(card.key)
    );

    // Second: preserve rarity even if all fresh cards of that rarity were used.
    if (!candidates.length) {
      candidates = pool.filter(card =>
        !sameRoundBlocked.has(card.key)
      );
    }

    if (!candidates.length) return null;

    return candidates[goldenRandomIndex(candidates.length)] || null;
  };

  return (
    tryFolder(preferredFolder) ||
    tryFolder(fallbackFolder)
  );
}

async function generateGoldenCards() {
  const [legendary, normal] = await Promise.all([
    fetchGoldenFolder("legendary"),
    fetchGoldenFolder("normal")
  ]);

  if (!legendary.length && !normal.length) {
    throw new Error("لا توجد كروت متاحة للجولة الذهبية.");
  }

  const pools = { legendary, normal };
  const sameRoundBlocked = new Set();

  const strongBlocked = getNormalMatchCardKeys();
  (goldenState.usedKeys || []).forEach(key =>
    strongBlocked.add(String(key || "").toLowerCase())
  );

  const rollFolder = () =>
    goldenRandomUnit() < GOLDEN_LEGENDARY_CHANCE
      ? "legendary"
      : "normal";

  const p2Card = chooseGoldenCard(
    rollFolder(),
    pools,
    sameRoundBlocked,
    strongBlocked
  );

  if (!p2Card) {
    throw new Error("تعذر اختيار كرت عشوائي للاعب الثاني.");
  }

  sameRoundBlocked.add(p2Card.key);

  const p1Card = chooseGoldenCard(
    rollFolder(),
    pools,
    sameRoundBlocked,
    strongBlocked
  );

  if (!p1Card) {
    throw new Error("تعذر اختيار كرت عشوائي مختلف للاعب الأول.");
  }

  return {
    [player1]: p1Card,
    [player2]: p2Card
  };
}

function openGoldenTieDecisionModal() {
  const modal = document.getElementById("goldenTieDecisionModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeGoldenTieDecisionModal() {
  const modal = document.getElementById("goldenTieDecisionModal");
  if (!modal) return;

  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function openGoldenRulesModal(mode = "initial") {
  goldenRulesMode = mode === "repeat"
    ? "repeat"
    : "initial";

  const modal = document.getElementById("goldenRulesModal");
  const title = document.getElementById("goldenRulesTitle");
  const hint = document.getElementById("goldenRulesHint");
  const continueBtn = document.getElementById("goldenContinueBtn");

  if (title) {
    title.textContent =
      goldenRulesMode === "repeat"
        ? "تعادلت الجولة الذهبية"
        : "الجولة الذهبية";
  }

  if (hint) {
    hint.textContent =
      goldenRulesMode === "repeat"
        ? "سيتم لعب جولة ذهبية جديدة بكرتين عشوائيين جديدين حتى يفوز أحد الطرفين."
        : "";
  }

  if (continueBtn) {
    continueBtn.disabled = false;
    continueBtn.textContent = "متابعة";
    continueBtn.classList.remove("opacity-60", "cursor-wait");
  }

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
}

function closeGoldenRulesModal() {
  const modal = document.getElementById("goldenRulesModal");
  if (!modal) return;

  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function chooseGoldenRound() {
  closeGoldenTieDecisionModal();
  openGoldenRulesModal("initial");
}

function goldenRulesBack() {
  closeGoldenRulesModal();

  if (goldenRulesMode === "initial") {
    openGoldenTieDecisionModal();
  }
}

async function continueGoldenRound() {
  const continueBtn = document.getElementById("goldenContinueBtn");

  try {
    if (continueBtn) {
      continueBtn.disabled = true;
      continueBtn.textContent = "جاري تجهيز الكروت...";
      continueBtn.classList.add("opacity-60", "cursor-wait");
    }

    const pair = await generateGoldenCards();

    goldenState.active = true;
    goldenState.number =
      Math.max(0, Number(goldenState.number) || 0) + 1;

    goldenState.cards = {
      [player1]: pair[player1].url,
      [player2]: pair[player2].url
    };

    goldenState.usedKeys = Array.from(
      new Set([
        ...(goldenState.usedKeys || []),
        pair[player1].key,
        pair[player2].key
      ])
    );

    round = getGoldenRoundIndex();

    localStorage.setItem(
      "currentRound",
      String(round)
    );

    localStorage.setItem(
      "scores",
      JSON.stringify(scores)
    );

    saveGoldenState();

    try {
      if (
        window.WebmSfx &&
        window.WebmSfx._resetForNewRound
      ) {
        window.WebmSfx._resetForNewRound();
      }
    } catch {}

    closeGoldenRulesModal();
    closeGoldenTieDecisionModal();

    try {
      socket?.emit("startRound", {
        gameID,
        round,
        goldenRound: true,
        goldenRoundNumber: goldenState.number
      });
    } catch {}

    renderRound();

  } catch (error) {
    console.error("[golden-round]", error);

    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.textContent = "متابعة";
      continueBtn.classList.remove("opacity-60", "cursor-wait");
    }

    showToast(
      error?.message ||
      "تعذر تجهيز كروت الجولة الذهبية."
    );
  }
}

function finishResultMatch(winner, isTie = false) {
  try {
    if (socket && gameID) {
      socket.emit(
        "gameOver",
        {
          gameID,
          scores: {
            [player1]: scores[player1],
            [player2]: scores[player2]
          },
          winner: winner || null,
          isTie: !!isTie,
          roundCount,
          goldenRounds: Math.max(0, Number(goldenState.number) || 0)
        }
      );

      socket.emit(
        "submitFinalScores",
        {
          gameID,
          scores: {
            [player1]: scores[player1],
            [player2]: scores[player2]
          }
        }
      );
    }
  } catch {}

  clearGoldenState();

  localStorage.removeItem(
    NOTES_KEY(player1)
  );

  localStorage.removeItem(
    NOTES_KEY(player2)
  );

  location.href =
    "score.html";
}

function endMatchAsTie() {
  closeGoldenTieDecisionModal();
  closeGoldenRulesModal();
  finishResultMatch(null, true);
}

window.chooseGoldenRound = chooseGoldenRound;
window.goldenRulesBack = goldenRulesBack;
window.continueGoldenRound = continueGoldenRound;
window.endMatchAsTie = endMatchAsTie;

function joinRoomReliably() {
  if (!socket || !gameID) return;

  socket.emit("joinGame", {
    gameID,
    role: "host"
  });

  socket.emit("hostWatchAbilityRequests", {
    gameID
  });
}

if (socket) {
  socket.on("connect", () => {
    joinRoomReliably();
    setTimeout(joinRoomReliably, 500);
    setTimeout(joinRoomReliably, 1500);
    setTimeout(joinRoomReliably, 3000);
  });
}

// ======================================================
// Host Chat Inbox
// ======================================================
const hostChatPanel     = document.getElementById("hostChatPanel");
const chatMainToggle    = document.getElementById("chatMainToggle");
const chatUnreadBadge   = document.getElementById("chatUnreadBadge");
const chatToggleLabel   = document.getElementById("chatToggleLabel");
const chatCloseBtn      = document.getElementById("chatCloseBtn");
const hostChatBody      = document.getElementById("hostChatBody");
const hostChatHistory   = document.getElementById("hostChatHistory");
const hostChatStatus    = document.getElementById("hostChatStatus");
const hostChatReplyInput = document.getElementById("hostChatReplyInput");
const hostChatReplySend  = document.getElementById("hostChatReplySend");

function hostChatAppend({ from, text, ts, self = false }) {
  if (!hostChatHistory) return;

  const row = document.createElement("div");
  row.className = "flex " + (self ? "justify-end" : "justify-start");

  const bubble = document.createElement("div");

  bubble.className =
    "max-w-[85%] px-3 py-2 rounded-lg border " +
    (
      self
        ? "bg-yellow-500/90 text-black border-yellow-400"
        : "bg-white/10 text-white border-yellow-700/50"
    );

  const time = ts
    ? new Date(ts).toLocaleTimeString("ar", {
        hour: "2-digit",
        minute: "2-digit"
      })
    : "";

  bubble.textContent =
    (from ? `${from}: ` : "") +
    text +
    (time ? `  •  ${time}` : "");

  row.appendChild(bubble);
  hostChatHistory.appendChild(row);

  hostChatHistory.scrollTop = hostChatHistory.scrollHeight;
}

// ======================================================
// Chat toggle
// ======================================================
let _unreadCount = 0;

function updateChatToggleUI() {
  if (!chatMainToggle) return;

  const isOpen =
    hostChatPanel &&
    !hostChatPanel.classList.contains("hidden");

  if (chatToggleLabel) {
    chatToggleLabel.textContent = isOpen
      ? "إخفاء"
      : "CHAT";
  }

  if (chatUnreadBadge) {
    if (!isOpen && _unreadCount > 0) {
      chatUnreadBadge.textContent = String(_unreadCount);
      chatUnreadBadge.classList.remove("hidden");
    } else {
      chatUnreadBadge.classList.add("hidden");
      chatUnreadBadge.textContent = "0";
    }
  }
}

function openChatPanel() {
  if (!hostChatPanel) return;

  hostChatPanel.classList.remove("hidden");
  _unreadCount = 0;

  updateChatToggleUI();

  try {
    if (hostChatHistory) {
      hostChatHistory.scrollTop =
        hostChatHistory.scrollHeight;
    }
  } catch {}
}

function closeChatPanel() {
  if (!hostChatPanel) return;

  hostChatPanel.classList.add("hidden");
  updateChatToggleUI();
}

if (chatMainToggle && hostChatPanel) {
  chatMainToggle.addEventListener("click", () => {
    const willOpen =
      hostChatPanel.classList.contains("hidden");

    if (willOpen) {
      openChatPanel();
    } else {
      closeChatPanel();
    }
  });
}

if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", closeChatPanel);
}

updateChatToggleUI();

// ======================================================
// Player messages
// ======================================================
if (socket) {
  socket.on("playerChat", (payload = {}) => {
    const {
      gameID: g,
      playerName,
      message,
      ts
    } = payload;

    if (g && gameID && g !== gameID) return;
    if (!message) return;

    hostChatAppend({
      from: playerName || "لاعب",
      text: String(message),
      ts: ts || Date.now(),
      self: false
    });

    if (
      hostChatPanel &&
      hostChatPanel.classList.contains("hidden")
    ) {
      _unreadCount = (_unreadCount || 0) + 1;
      updateChatToggleUI();
    } else {
      _unreadCount = 0;
      updateChatToggleUI();
    }

    if (hostChatStatus) {
      hostChatStatus.textContent = "📩 وصلت رسالة جديدة";

      setTimeout(() => {
        if (hostChatStatus) {
          hostChatStatus.textContent = "";
        }
      }, 1500);
    }
  });
}

// ======================================================
// Host reply
// ======================================================
function sendHostReply() {
  if (!socket || !gameID) return;

  const msg =
    String(hostChatReplyInput?.value || "").trim();

  if (!msg) return;

  socket.emit("hostChat", {
    gameID,
    message: msg
  });

  hostChatAppend({
    from: "المضيف",
    text: msg,
    ts: Date.now(),
    self: true
  });

  if (hostChatReplyInput) {
    hostChatReplyInput.value = "";
  }
}

if (hostChatReplySend) {
  hostChatReplySend.addEventListener(
    "click",
    sendHostReply
  );
}

if (hostChatReplyInput) {
  hostChatReplyInput.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendHostReply();
      }
    }
  );
}

// ======================================================
// Toast
// ======================================================
function showToast(message, actions = [], closeOverride = null) {
  const wrap = document.createElement("div");

  wrap.className =
    "fixed left-1/2 -translate-x-1/2 bottom-6 z-50 " +
    "bg-[#222] text-white border-2 border-yellow-500 shadow-xl " +
    "rounded-xl px-4 py-3 max-w-[90vw] w-[520px]";

  const msg = document.createElement("div");

  msg.className = "mb-3 leading-relaxed";
  msg.textContent = message;

  wrap.appendChild(msg);

  if (actions.length) {
    const row = document.createElement("div");

    row.className =
      "flex gap-2 justify-end";

    actions.forEach(a => {
      const b = document.createElement("button");

      b.textContent = a.label;

      b.className =
        "px-3 py-1 rounded bg-emerald-600 " +
        "hover:bg-emerald-700 font-bold";

      b.onclick = () => {
        a.onClick?.();
        wrap.remove();
      };

      row.appendChild(b);
    });

    const closeBtn = document.createElement("button");

    if (closeOverride?.label) {
      closeBtn.textContent =
        closeOverride.label;

      closeBtn.onclick = () => {
        closeOverride.onClick?.();
        wrap.remove();
      };
    } else {
      closeBtn.textContent = "إغلاق";
      closeBtn.onclick = () => wrap.remove();
    }

    closeBtn.className =
      "px-3 py-1 rounded bg-rose-600 " +
      "hover:bg-rose-700 font-bold";

    row.appendChild(closeBtn);
    wrap.appendChild(row);
  }

  document.body.appendChild(wrap);

  if (!actions.length) {
    setTimeout(() => wrap.remove(), 1800);
  }
}

// ======================================================
// Helpers
// ======================================================
function loadAbilities(key) {
  try {
    return JSON.parse(
      localStorage.getItem(key) || "[]"
    ) || [];
  } catch {
    return [];
  }
}

function saveAbilities(key, arr) {
  localStorage.setItem(
    key,
    JSON.stringify(arr || [])
  );
}

function normalizeAbilityList(arr) {
  const list = Array.isArray(arr) ? arr : [];

  return list
    .map(a => {
      if (typeof a === "string") {
        return {
          text: a.trim(),
          used: false
        };
      }

      if (a && typeof a === "object") {
        return {
          text: String(a.text || "").trim(),
          used: !!a.used
        };
      }

      return null;
    })
    .filter(Boolean)
    .filter(a => a.text);
}

function syncServerAbilities() {
  if (!socket || !gameID) return;

  const abilities = {
    [player1]: loadAbilities(P1_ABILITIES_KEY),
    [player2]: loadAbilities(P2_ABILITIES_KEY)
  };

  socket.emit("setAbilities", {
    gameID,
    abilities
  });
}

// ======================================================
// Media
// ======================================================
function createMedia(url, className, playSfx = false) {
  const mediaUrl = resolveQG14MediaUrl(url);
  const isWebm = /\.webm(\?|#|$)/i.test(mediaUrl || "");
  if (isWebm) {
    const v = document.createElement("video");
    v.src = mediaUrl; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    v.preload = "auto";
    v.className = className;
    if (playSfx && window.WebmSfx) window.WebmSfx.attachToMedia(v, mediaUrl);
    return v;
  } else {
    const img = document.createElement("img");
    img.src = mediaUrl; img.className = className; img.decoding = "async"; return img;
  }
}

// ======================================================
// Ability row
// ======================================================
function abilityRow(ab, onToggle) {
  const row = document.createElement("button");

  row.className =
    "w-full text-center px-4 py-2.5 rounded-lg " +
    "font-bold text-base " +
    (
      ab.used
        ? "bg-yellow-700 text-black/90 border border-yellow-800"
        : "bg-yellow-400 hover:bg-yellow-300 text-black border border-yellow-500"
    );

  row.textContent = ab.text;
  row.onclick = onToggle;

  return row;
}

// ======================================================
// Render abilities
// ======================================================
function renderAbilities(storageKey, container) {
  if (!container) return;

  const abilities =
    loadAbilities(storageKey);

  container.innerHTML = "";

  if (!abilities.length) {
    const p = document.createElement("p");

    p.className = "opacity-70 text-sm";
    p.textContent = "لا توجد قدرات";

    container.appendChild(p);

    return;
  }

  abilities.forEach((ab, idx) => {
    const btn = abilityRow(ab, () => {
      const current =
        loadAbilities(storageKey);

      if (!current[idx]) return;

      current[idx].used =
        !current[idx].used;

      saveAbilities(
        storageKey,
        current
      );

      renderAbilities(
        storageKey,
        container
      );

      syncServerAbilities();
      broadcast();
    });

    container.appendChild(btn);
  });
}

// ======================================================
// Previous & VS
// ======================================================
function getPreviousUrls(name) {
  const arr =
    Array.isArray(picks?.[name])
      ? picks[name]
      : [];

  return arr.filter(
    (_, i) => i < round
  );
}

function renderPrevGrid(container, urls) {
  if (!container) return;

  container.innerHTML = "";

  urls.forEach(src => {
    const cell =
      document.createElement("div");

    cell.className =
      "w-24 h-32 rounded-md overflow-hidden";

    const m =
      createMedia(
        src,
        "w-full h-full object-contain"
      );

    cell.appendChild(m);
    container.appendChild(cell);
  });
}

// ======================================================
// Snapshot
// ======================================================
let okState = {
  left: {
    active: false,
    playerName: null
  },
  right: {
    active: false,
    playerName: null
  }
};

function buildSnapshot() {
  return {
    player1,
    player2,
    round,
    roundCount,
    scores,

    ok: okState,

    abilities: {
      [player1]:
        loadAbilities(P1_ABILITIES_KEY),

      [player2]:
        loadAbilities(P2_ABILITIES_KEY)
    },

    currentLeftUrl:
      getCurrentCardUrl(player2),

    currentRightUrl:
      getCurrentCardUrl(player1),

    goldenRound: isGoldenRoundActive(),
    goldenRoundNumber:
      isGoldenRoundActive()
        ? Math.max(1, Number(goldenState.number) || 1)
        : 0,

    prevLeft:
      getPreviousUrls(player2),

    prevRight:
      getPreviousUrls(player1),

    notes: {
      [player1]:
        normalizeNotes(
          localStorage.getItem(
            NOTES_KEY(player1)
          ) || ""
        ),

      [player2]:
        normalizeNotes(
          localStorage.getItem(
            NOTES_KEY(player2)
          ) || ""
        )
    }
  };
}

function broadcast() {
  if (
    socket &&
    gameID
  ) {
    socket.emit(
      "resultSnapshot",
      {
        gameID,
        snapshot: buildSnapshot()
      }
    );
  }
}

if (socket) {
  socket.on(
    "requestResultSnapshot",
    () => broadcast()
  );
}

// ======================================================
// Recap modal (shows the latest result reached in each past round)
// ======================================================
function openRecapModal() {
  renderRecapList();

  const modal = document.getElementById("recapModal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
}

function closeRecapModal() {
  const modal = document.getElementById("recapModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

// Jumps back to a past round and restores its latest result (health)
// and the latest notes written during that round.
function goToRecapRound(i) {
  const all = loadRoundStartScores();
  const savedScores = loadRoundRecapScores();
  const data = getRoundScoresForRecap(
    i,
    all,
    savedScores
  );
  const roundNotes = getRoundNotesForRecap(i);
  if (!data) return;

  round = i;

  localStorage.setItem(
    "currentRound",
    String(round)
  );

  scores[player1] = data.p1;
  scores[player2] = data.p2;

  localStorage.setItem(
    "scores",
    JSON.stringify(scores)
  );

  const p1Textarea =
    findNotesTextarea(player1);

  const p2Textarea =
    findNotesTextarea(player2);

  // Delete the current notes from both the visible boxes and storage.
  if (p1Textarea) p1Textarea.value = "";
  if (p2Textarea) p2Textarea.value = "";

  localStorage.removeItem(
    NOTES_KEY(player1)
  );

  localStorage.removeItem(
    NOTES_KEY(player2)
  );

  const restoredP1Notes =
    normalizeNotes(
      roundNotes[player1] || ""
    );

  const restoredP2Notes =
    normalizeNotes(
      roundNotes[player2] || ""
    );

  // Restore only the notes that belong to the selected round.
  localStorage.setItem(
    NOTES_KEY(player1),
    restoredP1Notes
  );

  localStorage.setItem(
    NOTES_KEY(player2),
    restoredP2Notes
  );

  if (p1Textarea) {
    p1Textarea.value = restoredP1Notes;
  }

  if (p2Textarea) {
    p2Textarea.value = restoredP2Notes;
  }

  try {
    if (
      window.WebmSfx &&
      window.WebmSfx._resetForNewRound
    ) {
      window.WebmSfx._resetForNewRound();
    }
  } catch {}

  closeRecapModal();
  renderRound();
}

function renderRecapList() {
  const list = document.getElementById("recapList");
  if (!list) return;

  list.innerHTML = "";

  const all = loadRoundStartScores();
  const savedScores = loadRoundRecapScores();

  const playedRounds = [];
  for (let i = 0; i < round; i++) {
    if (
      getRoundScoresForRecap(
        i,
        all,
        savedScores
      )
    ) {
      playedRounds.push(i);
    }
  }

  if (!playedRounds.length) {
    const empty = document.createElement("p");
    empty.className =
      "text-center text-sm text-yellow-100/70 py-4";
    empty.textContent =
      "لا توجد جولات سابقة بعد";
    list.appendChild(empty);
    return;
  }

  playedRounds.forEach(i => {
    const data = getRoundScoresForRecap(
      i,
      all,
      savedScores
    );

    const row = document.createElement("div");
    row.className =
      "rounded-xl border-2 border-yellow-600 bg-black/25 p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-yellow-400 hover:bg-black/35 transition";
    row.title = "اضغط للذهاب لهذه الجولة";
    row.onclick = () => goToRecapRound(i);

    const title = document.createElement("div");
    title.className =
      "font-extrabold text-yellow-300 text-sm";
    title.textContent =
      `الجولة ${i + 1}`;

    const scoresWrap = document.createElement("div");
    scoresWrap.className =
      "flex items-center gap-3";

    const p2Chip = document.createElement("div");
    p2Chip.className = "text-center";
    p2Chip.innerHTML =
      `<div class="text-[11px] opacity-80 mb-1">${player2}</div>` +
      `<div class="chip-gold" style="min-width:60px;padding:6px 14px;font-size:1rem;">${data.p2}</div>`;

    const p1Chip = document.createElement("div");
    p1Chip.className = "text-center";
    p1Chip.innerHTML =
      `<div class="text-[11px] opacity-80 mb-1">${player1}</div>` +
      `<div class="chip-gold" style="min-width:60px;padding:6px 14px;font-size:1rem;">${data.p1}</div>`;

    scoresWrap.appendChild(p2Chip);
    scoresWrap.appendChild(p1Chip);

    row.appendChild(title);
    row.appendChild(scoresWrap);
    list.appendChild(row);
  });
}

window.openRecapModal = openRecapModal;
window.closeRecapModal = closeRecapModal;
window.goToRecapRound = goToRecapRound;

// ======================================================
// CUSTOM CATEGORIES
// ======================================================

const NOTE_CATEGORIES_DEFAULT = [
  "عناصر",
  "سلاح",
  "غير حي",
  "ساحر",
  "حيوان",
  "فضائي",
  "بشري",
  "ماء",
  "نار",
  "ثلج",
  "برق",
  "ارض",
  "بطل",
  "شرير",
  "دفاع",
  "هجوم",
  "زعيم",
  "مجموعة",
  "تراكم"
];

const CUSTOM_NOTE_CATEGORIES_KEY =
  "resultCustomNoteCategories";

function loadCustomNoteCategories() {
  try {
    const raw =
      JSON.parse(
        localStorage.getItem(
          CUSTOM_NOTE_CATEGORIES_KEY
        ) || "[]"
      );

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(v =>
        String(v || "").trim()
      )
      .filter(Boolean);

  } catch {
    return [];
  }
}

function saveCustomNoteCategories(list) {
  const clean = [
    ...new Set(
      (
        Array.isArray(list)
          ? list
          : []
      )
        .map(v =>
          String(v || "").trim()
        )
        .filter(Boolean)
    )
  ];

  localStorage.setItem(
    CUSTOM_NOTE_CATEGORIES_KEY,
    JSON.stringify(clean)
  );

  return clean;
}

function getNoteCategories() {
  return [
    ...NOTE_CATEGORIES_DEFAULT,
    ...loadCustomNoteCategories()
  ];
}

// ======================================================
// Per-player state
// ======================================================
const NOTE_STATE_KEY =
  player => `noteState:${player}`;

const QUICK_COUNTS_KEY =
  player => `quickCounts:${player}`;

function loadNoteState(player) {
  try {
    return JSON.parse(
      localStorage.getItem(
        NOTE_STATE_KEY(player)
      ) || "{}"
    ) || {};
  } catch {
    return {};
  }
}

function saveNoteState(player, state) {
  localStorage.setItem(
    NOTE_STATE_KEY(player),
    JSON.stringify(state || {})
  );
}

function loadQuickCounts(player) {
  try {
    return JSON.parse(
      localStorage.getItem(
        QUICK_COUNTS_KEY(player)
      ) || "{}"
    ) || {};
  } catch {
    return {};
  }
}

function saveQuickCounts(player, obj) {
  localStorage.setItem(
    QUICK_COUNTS_KEY(player),
    JSON.stringify(obj || {})
  );
}

// ======================================================
// Apply counter
// ======================================================
function applyDelta(player, cat, delta) {
  const key =
    NOTES_KEY(player);

  const base =
    normalizeNotes(
      localStorage.getItem(key) || ""
    );

  const lines =
    base
      .split("\n")
      .filter(Boolean);

  let found = false;

  const nextLines = [];

  for (let line of lines) {
    const m =
      line.match(
        /^([+\-])(\d+)\s+(.*)$/
      );

    if (
      m &&
      m[3] === cat
    ) {
      const cur =
        (
          m[1] === "-"
            ? -1
            : 1
        ) *
        parseInt(
          m[2],
          10
        );

      const next =
        cur + delta;

      if (next !== 0) {
        const sign =
          next > 0
            ? "+"
            : "-";

        nextLines.push(
          `${sign}${Math.abs(next)} ${cat}`
        );
      }

      found = true;

    } else {
      nextLines.push(line);
    }
  }

  if (
    !found &&
    delta !== 0
  ) {
    const sign =
      delta > 0
        ? "+"
        : "-";

    const newLine =
      `${sign}${Math.abs(delta)} ${cat}`;

    let insertAt = 0;

    for (
      let i = 0;
      i < nextLines.length;
      i++
    ) {
      if (
        /^[+\-]\d+\s+/.test(
          nextLines[i].trim()
        )
      ) {
        insertAt = i + 1;
      } else {
        break;
      }
    }

    nextLines.splice(
      insertAt,
      0,
      newLine
    );
  }

  const result =
    nextLines.join("\n");

  localStorage.setItem(
    key,
    normalizeNotes(result)
  );

  return normalizeNotes(result);
}

// ======================================================
// Remove negative line
// ======================================================
function removeNegativeLine(player, cat) {
  const key =
    NOTES_KEY(player);

  const base =
    normalizeNotes(
      localStorage.getItem(key) || ""
    );

  const escapedCat =
    String(cat).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const cleaned =
    base
      .split("\n")
      .filter(line => {
        const t = line.trim();

        return !new RegExp(
          `^-[ ]*\\d+[ ]+${escapedCat}$`
        ).test(t);
      })
      .join("\n")
      .trim();

  localStorage.setItem(
    key,
    normalizeNotes(cleaned)
  );

  return normalizeNotes(cleaned);
}

// ======================================================
// Find notes textarea
// ======================================================
function findNotesTextarea(playerName) {
  const all =
    Array.from(
      document.querySelectorAll(
        "textarea[data-player]"
      )
    );

  return all.find(
    t =>
      t.dataset.player ===
      playerName
  ) || null;
}

// ======================================================
// Glass Category Picker
// ======================================================
function createCategoryPicker(
  name,
  onSelect
) {
  const picker =
    document.createElement("div");

  picker.className =
    "result-category-picker";

  const button =
    document.createElement("button");

  button.type = "button";

  button.className =
    "result-category-trigger";

  button.setAttribute(
    "aria-haspopup",
    "listbox"
  );

  button.setAttribute(
    "aria-expanded",
    "false"
  );

  const buttonText =
    document.createElement("span");

  buttonText.className =
    "result-category-trigger-text";

  buttonText.textContent =
    "اختر الفئة";

  const chevron =
    document.createElement("span");

  chevron.className =
    "result-category-chevron";

  chevron.textContent = "⌄";

  button.appendChild(
    buttonText
  );

  button.appendChild(
    chevron
  );

  const menu =
    document.createElement("div");

  menu.className =
    "result-category-menu hidden";

  menu.setAttribute(
    "role",
    "listbox"
  );

  let selected =
    "";

  function close() {
    menu.classList.add(
      "hidden"
    );

    button.setAttribute(
      "aria-expanded",
      "false"
    );

    button.classList.remove(
      "is-open"
    );
  }

  function open() {
    render();

    menu.classList.remove(
      "hidden"
    );

    menu.scrollTop = 0;

    button.setAttribute(
      "aria-expanded",
      "true"
    );

    button.classList.add(
      "is-open"
    );
  }

  function choose(category) {
    selected =
      String(
        category || ""
      ).trim();

    buttonText.textContent =
      selected ||
      "اختر الفئة";

    close();

    onSelect(selected);
  }

  function render() {
    menu.innerHTML = "";

    getNoteCategories()
      .forEach(category => {
        const item =
          document.createElement(
            "button"
          );

        item.type = "button";

        item.className =
          "result-category-item";

        item.textContent =
          category;

        item.setAttribute(
          "role",
          "option"
        );

        if (
          category ===
          selected
        ) {
          item.style.color =
            "#FFD700";

          item.style.background =
            "rgba(255,215,0,.12)";
        }

        item.onclick =
          (e) => {
            e.stopPropagation();

            choose(category);
          };

        menu.appendChild(
          item
        );
      });

    // ==================================================
    // إضافة المزيد
    // ==================================================
    const addMore =
      document.createElement(
        "button"
      );

    addMore.type = "button";

    addMore.className =
      "result-category-add";

    addMore.innerHTML =
      "<span>＋</span><span>إضافة المزيد</span>";

    addMore.onclick =
      (e) => {
        e.stopPropagation();

        close();

        openAddCategoryDialog();
      };

    menu.appendChild(
      addMore
    );
  }

  function openAddCategoryDialog() {
    const overlay =
      document.createElement(
        "div"
      );

    overlay.className =
      "result-add-category-overlay";

    const modal =
      document.createElement(
        "div"
      );

    modal.className =
      "result-add-category-modal";

    const title =
      document.createElement(
        "div"
      );

    title.className =
      "result-add-category-title";

    title.textContent =
      "إضافة فئة جديدة";

    const hint =
      document.createElement(
        "p"
      );

    hint.className =
      "result-add-category-hint";

    hint.textContent =
      "أضف فئة جديدة وستبقى محفوظة حتى بعد تحديث الصفحة وإغلاقها.";

    const input =
      document.createElement(
        "input"
      );

    input.type = "text";

    input.className =
      "result-add-category-input";

    input.placeholder =
      "مثال: أسطوري";

    input.maxLength = 40;

    input.autocomplete =
      "off";

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "result-add-category-actions";

    const cancel =
      document.createElement(
        "button"
      );

    cancel.type = "button";

    cancel.className =
      "result-add-category-cancel";

    cancel.textContent =
      "إلغاء";

    const add =
      document.createElement(
        "button"
      );

    add.type = "button";

    add.className =
      "result-add-category-confirm";

    add.textContent =
      "إضافة";

    function closeDialog() {
      overlay.remove();
    }

    cancel.onclick =
      closeDialog;

    overlay.addEventListener(
      "click",
      e => {
        if (
          e.target ===
          overlay
        ) {
          closeDialog();
        }
      }
    );

    function submit() {
      const value =
        String(
          input.value || ""
        ).trim();

      if (!value) {
        input.focus();
        return;
      }

      const defaults =
        NOTE_CATEGORIES_DEFAULT;

      const custom =
        loadCustomNoteCategories();

      if (
        defaults.includes(
          value
        ) ||
        custom.includes(
          value
        )
      ) {
        choose(value);
        closeDialog();
        return;
      }

      saveCustomNoteCategories([
        ...custom,
        value
      ]);

      selected = value;

      buttonText.textContent =
        value;

      saveNoteState(
        name,
        {
          ...loadNoteState(name),
          cat: value
        }
      );

      showToast(
        `✅ تمت إضافة الفئة «${value}» وحفظها.`
      );

      closeDialog();
    }

    add.onclick =
      submit;

    input.addEventListener(
      "keydown",
      e => {
        if (
          e.key ===
          "Enter"
        ) {
          e.preventDefault();
          submit();

        } else if (
          e.key ===
          "Escape"
        ) {
          closeDialog();
        }
      }
    );

    actions.appendChild(
      cancel
    );

    actions.appendChild(
      add
    );

    modal.appendChild(
      title
    );

    modal.appendChild(
      hint
    );

    modal.appendChild(
      input
    );

    modal.appendChild(
      actions
    );

    overlay.appendChild(
      modal
    );

    document.body.appendChild(
      overlay
    );

    requestAnimationFrame(
      () => input.focus()
    );
  }

  button.onclick =
    e => {
      e.stopPropagation();

      const isOpen =
        !menu.classList.contains(
          "hidden"
        );

      if (isOpen) {
        close();
      } else {
        open();
      }
    };

  document.addEventListener(
    "click",
    e => {
      if (
        !picker.contains(
          e.target
        )
      ) {
        close();
      }
    }
  );

  picker.appendChild(
    button
  );

  picker.appendChild(
    menu
  );

  render();

  return {
    element: picker,

    setValue(value) {
      selected =
        String(
          value || ""
        ).trim();

      buttonText.textContent =
        selected ||
        "اختر الفئة";
    },

    getValue() {
      return selected;
    }
  };
}

// ======================================================
// VS Row
// ======================================================

// ===== Thanos: keep the legendary card hidden until its fullscreen clip finishes =====
function isThanosLegendaryCardUrl(url) {
  if (!url) return false;
  let clean = String(url);
  try {
    clean = decodeURIComponent(new URL(clean, window.location.href).pathname);
  } catch {
    try { clean = decodeURIComponent(clean); } catch {}
    clean = clean.split(/[?#]/, 1)[0];
  }
  clean = clean.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  return /\/images\/legendary\/thanos\.[^/]+$/.test(clean);
}

function prepareThanosCardForFullscreen(media, mediaUrl, side) {
  if (!media || !isThanosLegendaryCardUrl(mediaUrl)) return;

  // Preferred path: give the fullscreen manager the EXACT card element now.
  // It will release this same element when Thanos' automatic clip finishes.
  if (
    window.LegendaryFullscreen &&
    typeof window.LegendaryFullscreen.holdCard === "function"
  ) {
    window.LegendaryFullscreen.holdCard(media, mediaUrl, side);
    return;
  }

  // Fail-open fallback: if the fullscreen manager is unavailable, do NOT hide
  // the card. A broken/blocked helper must never leave Thanos invisible.
  console.warn("[legendary-fullscreen] Manager unavailable; showing Thanos normally.");
}

function renderVsRow() {
  if (
    window.WebmSfx &&
    typeof window.WebmSfx === "object"
  ) {
    try {
      if (
        !window.WebmSfx.perSide
      ) {
        window.WebmSfx.perSide = {
          left: [],
          right: []
        };
      }

      window.WebmSfx.perSide.left = [];
      window.WebmSfx.perSide.right = [];

    } catch {}
  }

  const vsRow =
    document.getElementById(
      "vsRow"
    );

  if (!vsRow) return;

  vsRow.innerHTML = "";

  vsRow.className =
    "flex justify-center items-center gap-6 md:gap-8 flex-wrap";

  const side =
    (
      name,
      mediaUrl,
      pos
    ) => {

      const wrap =
        document.createElement(
          "div"
        );

      wrap.className =
        "flex flex-col items-center";

      const label =
        document.createElement(
          "div"
        );

      label.className =
        "text-yellow-300 font-extrabold text-xl mb-2";

      label.textContent =
        name;

      const card =
        document.createElement(
          "div"
        );

      card.className =
        "w-80 md:w-96 h-[26rem] md:h-[30rem] overflow-hidden flex items-center justify-center";

      const media =
        createMedia(
          mediaUrl,
          "w-full h-full object-contain",
          true
        );

      prepareThanosCardForFullscreen(media, resolveQG14MediaUrl(mediaUrl), pos);

      card.appendChild(
        media
      );

      // Webm side
      if (
        window.WebmSfx &&
        /\.webm(\?|#|$)/i.test(
          mediaUrl || ""
        )
      ) {
        if (
          typeof window.WebmSfx.markSide ===
          "function"
        ) {
          window.WebmSfx.markSide(
            pos,
            mediaUrl
          );
        }
      }

      // ==================================================
      // Notes
      // ==================================================
      const notesWrap =
        document.createElement(
          "div"
        );

      notesWrap.className =
        "mt-3 w-80 md:w-96";

      const controls =
        document.createElement(
          "div"
        );

      controls.className =
        "mb-2 flex items-center gap-2";

      // ==================================================
      // Category picker
      // ==================================================
      const categoryPicker =
        createCategoryPicker(
          name,
          category => {
            saveNoteState(
              name,
              {
                ...loadNoteState(name),
                cat: category
              }
            );
          }
        );

      // ==================================================
      // Target
      // ==================================================
      const targetSelect =
        document.createElement(
          "select"
        );

      targetSelect.className =
        "bg-transparent text-white border-2 border-yellow-600 rounded-lg px-2 py-2 text-sm";

      [
        {
          value: "self",
          label: "لك"
        },
        {
          value: "enemy",
          label: "للخصم"
        },
        {
          value: "both",
          label: "للكل"
        }
      ].forEach(o => {
        const opt =
          document.createElement(
            "option"
          );

        opt.value =
          o.value;

        opt.textContent =
          o.label;

        opt.style.background =
          "#3a0b18";

        targetSelect.appendChild(
          opt
        );
      });

      // ==================================================
      // Amount
      // ==================================================
      const amountWrap =
        document.createElement(
          "div"
        );

      amountWrap.className =
        "amount-wrap";

      const amount =
        document.createElement(
          "input"
        );

      amount.type =
        "number";

      amount.value =
        "1";

      amount.min =
        "1";

      amount.max =
        "99";

      const arrows =
        document.createElement(
          "div"
        );

      arrows.className =
        "amount-arrows";

      const up =
        document.createElement(
          "button"
        );

      up.type =
        "button";

      up.textContent =
        "▲";

      const down =
        document.createElement(
          "button"
        );

      down.type =
        "button";

      down.textContent =
        "▼";

      const clamp =
        () => {
          let n =
            parseInt(
              amount.value || "1",
              10
            );

          if (
            !Number.isFinite(n) ||
            n < 1
          ) {
            n = 1;
          }

          if (
            n > 99
          ) {
            n = 99;
          }

          amount.value =
            n;
        };

      up.onclick =
        () => {
          amount.value++;
          clamp();
        };

      down.onclick =
        () => {
          amount.value--;
          clamp();
        };

      amount.addEventListener(
        "input",
        clamp
      );

      arrows.appendChild(
        up
      );

      arrows.appendChild(
        down
      );

      amountWrap.appendChild(
        amount
      );

      amountWrap.appendChild(
        arrows
      );

      // ==================================================
      // Plus / Minus
      // ==================================================
      const btnPlus =
        document.createElement(
          "button"
        );

      btnPlus.type =
        "button";

      btnPlus.className =
        "btn-gold btn-ico btn-inc w-10 h-10";

      btnPlus.innerHTML =
        "<span class='text-2xl leading-none'>+</span>";

      const btnMinus =
        document.createElement(
          "button"
        );

      btnMinus.type =
        "button";

      btnMinus.className =
        "btn-gold btn-ico btn-dec w-10 h-10";

      btnMinus.innerHTML =
        "<span class='text-2xl leading-none'>−</span>";

      // ==================================================
      // Notes textarea
      // ==================================================
      const notes =
        document.createElement(
          "textarea"
        );

      notes.className =
        "w-full h-24 bg-transparent text-white border-2 border-yellow-600 rounded-lg p-3 placeholder:opacity-70 overflow-y-auto no-scrollbar";

      notes.placeholder =
        "ملاحظات";

      notes.value =
        normalizeNotes(
          localStorage.getItem(
            NOTES_KEY(name)
          ) || ""
        );

      notes.addEventListener(
        "input",
        () => {
          localStorage.setItem(
            NOTES_KEY(name),
            normalizeNotes(
              notes.value
            )
          );

          broadcast();
        }
      );

      notes.dataset.player =
        name;

      notes.dataset.side =
        pos;

      // ==================================================
      // Restore state
      // ==================================================
      const st =
        loadNoteState(name);

      if (
        st &&
        typeof st === "object"
      ) {

        if (
          st.cat &&
          getNoteCategories().includes(
            st.cat
          )
        ) {
          categoryPicker.setValue(
            st.cat
          );
        }

        if (
          st.target
        ) {
          targetSelect.value =
            st.target;
        }

        if (
          st.amount
        ) {
          amount.value =
            String(
              st.amount
            );
        }
      }

      clamp();

      targetSelect.addEventListener(
        "change",
        () => {
          saveNoteState(
            name,
            {
              ...loadNoteState(name),
              target:
                targetSelect.value
            }
          );
        }
      );

      amount.addEventListener(
        "input",
        () => {
          saveNoteState(
            name,
            {
              ...loadNoteState(name),
              amount:
                amount.value
            }
          );
        }
      );

      // ==================================================
      // Read amount
      // ==================================================
      const readAmount =
        () => {
          const n =
            parseInt(
              String(
                amount.value || "1"
              ),
              10
            );

          if (
            !Number.isFinite(n) ||
            n <= 0
          ) {
            return 1;
          }

          return Math.min(
            99,
            n
          );
        };

      // ==================================================
      // Counter
      // ==================================================
      const adjustCounter =
        sign => {

          const cat =
            String(
              categoryPicker.getValue() || ""
            ).trim();

          if (!cat) {
            showToast(
              "⚠️ اختر الفئة أولاً."
            );

            return;
          }

          const n =
            readAmount();

          const delta =
            sign === "+"
              ? n
              : -n;

          const target =
            targetSelect.value;

          saveNoteState(
            name,
            {
              cat,
              target,
              amount:
                amount.value
            }
          );

          const selfPlayer =
            name;

          const enemyPlayer =
            pos === "left"
              ? player1
              : player2;

          const updateOne =
            playerName => {

              const txt =
                applyDelta(
                  playerName,
                  cat,
                  delta
                );

              const ta =
                findNotesTextarea(
                  playerName
                );

              if (ta) {
                ta.value =
                  normalizeNotes(
                    txt
                  );
              }
            };

          if (
            target ===
            "self"
          ) {
            updateOne(
              selfPlayer
            );

          } else if (
            target ===
            "enemy"
          ) {
            updateOne(
              enemyPlayer
            );

          } else if (
            target ===
            "both"
          ) {
            updateOne(
              selfPlayer
            );

            updateOne(
              enemyPlayer
            );
          }

          broadcast();
        };

      btnPlus.addEventListener(
        "click",
        () =>
          adjustCounter("+")
      );

      btnMinus.addEventListener(
        "click",
        () =>
          adjustCounter("-")
      );

      // ==================================================
      // Controls order
      // ==================================================
      controls.appendChild(
        categoryPicker.element
      );

      controls.appendChild(
        targetSelect
      );

      controls.appendChild(
        amountWrap
      );

      controls.appendChild(
        btnMinus
      );

      controls.appendChild(
        btnPlus
      );

      notesWrap.appendChild(
        controls
      );

      notesWrap.appendChild(
        notes
      );

      wrap.appendChild(
        label
      );

      wrap.appendChild(
        card
      );

      wrap.appendChild(
        notesWrap
      );

      return wrap;
    };

  const left =
    side(
      player2,
      getCurrentCardUrl(player2),
      "left"
    );

  const right =
    side(
      player1,
      getCurrentCardUrl(player1),
      "right"
    );

  const vs =
    document.createElement(
      "div"
    );

  vs.className =
    "self-center flex items-center justify-center";

  vs.innerHTML =
    `<div class="text-yellow-400 font-extrabold text-5xl mx-2 leading-none">VS</div>`;

  vsRow.appendChild(
    left
  );

  vsRow.appendChild(
    vs
  );

  vsRow.appendChild(
    right
  );

  // Replay buttons
  const leftBtn =
    document.getElementById(
      "sfxReplayLeft"
    );

  const rightBtn =
    document.getElementById(
      "sfxReplayRight"
    );

  if (leftBtn) {
    leftBtn.textContent =
      `🔊 ${player2}`;
  }

  if (rightBtn) {
    rightBtn.textContent =
      `🔊 ${player1}`;
  }

  broadcast();
}

// ======================================================
// Health & OK badges
// ======================================================
function wireHealthControls(
  name,
  decBtn,
  incBtn,
  label
) {
  if (
    !decBtn ||
    !incBtn ||
    !label
  ) return;

  const clamp =
    n =>
      Math.max(
        0,
        Math.min(
          startingHP,
          n
        )
      );

  const refresh =
    () => {
      label.textContent =
        String(
          scores[name]
        );
    };

  decBtn.onclick =
    () => {
      scores[name] =
        clamp(
          (scores[name] ??
            startingHP) - 1
        );

      refresh();

      localStorage.setItem(
        "scores",
        JSON.stringify(scores)
      );

      broadcast();
    };

  incBtn.onclick =
    () => {
      scores[name] =
        clamp(
          (scores[name] ??
            startingHP) + 1
        );

      refresh();

      localStorage.setItem(
        "scores",
        JSON.stringify(scores)
      );

      broadcast();
    };

  refresh();
}

function showOkBadge(side) {
  const el =
    side === "left"
      ? document.getElementById(
          "p2OkAlert"
        )
      : document.getElementById(
          "p1OkAlert"
        );

  if (!el) return;

  el.textContent =
    "تمام";

  el.classList.remove(
    "hidden"
  );
}

function hideOkBadge(side) {
  const el =
    side === "left"
      ? document.getElementById(
          "p2OkAlert"
        )
      : document.getElementById(
          "p1OkAlert"
        );

  if (el) {
    el.classList.add(
      "hidden"
    );
  }
}

function resetOkBadges() {
  hideOkBadge("left");
  hideOkBadge("right");
}

// ======================================================
// Render page
// ======================================================
function renderRound() {
  if (roundTitle) {
    if (isGoldenRoundActive()) {
      roundTitle.textContent =
        goldenState.number > 1
          ? `الجولة الذهبية ${goldenState.number}`
          : "الجولة الذهبية";
    } else {
      roundTitle.textContent =
        `الجولة ${round + 1}`;
    }
  }

  const confirmResultBtn =
    document.getElementById("confirmResultBtn");

  if (confirmResultBtn) {
    confirmResultBtn.textContent =
      isGoldenRoundActive()
        ? "تأكيد الجولة"
        : "تأكيد النتيجة";
  }

  renderVsRow();

  renderAbilities(
    P2_ABILITIES_KEY,
    document.getElementById(
      "p2Abilities"
    )
  );

  renderAbilities(
    P1_ABILITIES_KEY,
    document.getElementById(
      "p1Abilities"
    )
  );

  renderPrevGrid(
    document.getElementById(
      "prevLeftGrid"
    ),
    getPreviousUrls(
      player2
    )
  );

  renderPrevGrid(
    document.getElementById(
      "prevRightGrid"
    ),
    getPreviousUrls(
      player1
    )
  );

  wireHealthControls(
    player2,
    document.getElementById(
      "p2Dec"
    ),
    document.getElementById(
      "p2Inc"
    ),
    document.getElementById(
      "p2Health"
    )
  );

  wireHealthControls(
    player1,
    document.getElementById(
      "p1Dec"
    ),
    document.getElementById(
      "p1Inc"
    ),
    document.getElementById(
      "p1Health"
    )
  );

  resetOkBadges();

  syncServerAbilities();

  broadcast();
}

// ======================================================
// Next round / confirm
// ======================================================
function goToRound(newIndex) {
  const maxIndex =
    Math.max(
      0,
      Math.min(
        roundCount - 1,
        newIndex
      )
    );

  round =
    maxIndex;

  localStorage.setItem(
    "currentRound",
    String(round)
  );

  recordRoundStartIfNeeded(round);

  try {
    if (
      window.WebmSfx &&
      window.WebmSfx._resetForNewRound
    ) {
      window.WebmSfx._resetForNewRound();
    }
  } catch {}

  renderRound();
}

function confirmWinner() {
  localStorage.setItem(
    "scores",
    JSON.stringify(scores)
  );

  // Golden rounds are sudden-death tie breakers. They are not part of the
  // normal configured round count and never return to Pick.
  if (isGoldenRoundActive()) {
    socket?.emit(
      "confirmRoundResult",
      {
        gameID,
        round,
        goldenRound: true,
        goldenRoundNumber: goldenState.number,
        snapshot:
          buildSnapshot()
      }
    );

    const p1Score =
      Number(scores[player1] ?? 0);

    const p2Score =
      Number(scores[player2] ?? 0);

    if (p1Score > p2Score) {
      finishResultMatch(player1, false);
      return;
    }

    if (p2Score > p1Score) {
      finishResultMatch(player2, false);
      return;
    }

    // Still tied: another golden round is mandatory.
    openGoldenRulesModal("repeat");
    return;
  }

  saveRoundScoresForRecap(round);
  saveRoundNotesForRecap(round);

  const next =
    round + 1;

  const gameOver =
    next >= roundCount ||
    scores[player1] === 0 ||
    scores[player2] === 0;

  socket?.emit(
    "confirmRoundResult",
    {
      gameID,
      round,
      snapshot:
        buildSnapshot()
    }
  );

  if (gameOver) {
    const p1Score =
      Number(scores[player1] ?? 0);

    const p2Score =
      Number(scores[player2] ?? 0);

    if (p1Score === p2Score) {
      // Do not finish automatically. The host chooses draw or Golden Round.
      openGoldenTieDecisionModal();
      return;
    }

    finishResultMatch(
      p1Score > p2Score
        ? player1
        : player2,
      false
    );

    return;
  }

  try {
    if (
      socket &&
      gameID
    ) {
      socket.emit(
        "startRound",
        {
          gameID,
          round: next
        }
      );
    }
  } catch {}

  goToRound(
    next
  );
}

window.confirmWinner =
  confirmWinner;

// ======================================================
// Transfer modal
// ======================================================
function openTransferModal(
  fromKey
) {
  const fromName =
    fromKey === P1_ABILITIES_KEY
      ? player1
      : player2;

  const toName =
    fromKey === P1_ABILITIES_KEY
      ? player2
      : player1;

  const list =
    loadAbilities(
      fromKey
    );

  const modal =
    document.getElementById(
      "transferModal"
    );

  const grid =
    document.getElementById(
      "abilityGrid"
    );

  const title =
    document.getElementById(
      "transferTitle"
    );

  if (!modal || !grid || !title) {
    return;
  }

  title.textContent =
    `اختر القدرة المراد نقلها إلى ${toName}`;

  const toKey =
    fromKey === P1_ABILITIES_KEY
      ? P2_ABILITIES_KEY
      : P1_ABILITIES_KEY;

  grid.innerHTML = "";

  if (!list.length) {

    const p =
      document.createElement(
        "p"
      );

    p.className =
      "text-yellow-200 text-center py-2";

    p.textContent =
      "لا توجد قدرات لنقلها.";

    grid.appendChild(
      p
    );

  } else {

    normalizeAbilityList(
      list
    ).forEach(
      (ab, idx) => {

        const btn =
          document.createElement(
            "button"
          );

        btn.className =
          "w-full text-center px-3 py-2 rounded-lg border-2 border-yellow-500 bg-[#7b2131] hover:bg-[#8b2a3a] font-bold";

        btn.textContent =
          ab.text +
          (
            ab.used
              ? " (مستخدمة)"
              : ""
          );

        btn.onclick =
          () => {

            const sender =
              normalizeAbilityList(
                loadAbilities(
                  fromKey
                )
              );

            const moved =
              sender.splice(
                idx,
                1
              )[0];

            if (!moved) return;

            saveAbilities(
              fromKey,
              sender
            );

            const receiver =
              normalizeAbilityList(
                loadAbilities(
                  toKey
                )
              );

            receiver.push({
              text:
                moved.text,

              used:
                !!moved.used
            });

            saveAbilities(
              toKey,
              receiver
            );

            closeTransferModal();

            renderAbilities(
              P2_ABILITIES_KEY,
              document.getElementById(
                "p2Abilities"
              )
            );

            renderAbilities(
              P1_ABILITIES_KEY,
              document.getElementById(
                "p1Abilities"
              )
            );

            syncServerAbilities();

            broadcast();

            showToast(
              `✅ تم نقل «${moved.text}» إلى ${toName}`
            );
          };

        grid.appendChild(
          btn
        );
      }
    );
  }

  modal.classList.remove(
    "hidden"
  );

  modal.classList.add(
    "flex"
  );
}

function closeTransferModal() {
  const modal =
    document.getElementById(
      "transferModal"
    );

  if (!modal) return;

  modal.classList.add(
    "hidden"
  );

  modal.classList.remove(
    "flex"
  );
}

window.openTransferModal =
  openTransferModal;

window.closeTransferModal =
  closeTransferModal;

// ======================================================
// Swap ability
// ======================================================
let _swapTargetKey =
  null;

let _swapTargetLabel =
  "";

function loadMasterAbilities() {
  try {
    const raw =
      localStorage.getItem(
        ABILITIES_MASTER_KEY
      );

    const arr =
      raw
        ? JSON.parse(raw)
        : [];

    return Array.isArray(arr)
      ? arr
          .map(s =>
            String(s).trim()
          )
          .filter(Boolean)
      : [];

  } catch {
    return [];
  }
}

// ======================================================
// Import abilities from start (current battle only)
// ======================================================
let _importTargetKey =
  null;

const _importSelected =
  new Set();

function getUniqueMasterAbilities() {
  return Array.from(
    new Set(
      loadMasterAbilities()
    )
  );
}

function getImportableAbilities() {
  if (!_importTargetKey) {
    return [];
  }

  const owned =
    new Set(
      normalizeAbilityList(
        loadAbilities(
          _importTargetKey
        )
      ).map(ab => ab.text)
    );

  return getUniqueMasterAbilities()
    .filter(text => !owned.has(text));
}

function updateImportSelectionUi() {
  const count =
    document.getElementById(
      "importSelectedCount"
    );

  const selectAllBtn =
    document.getElementById(
      "importSelectAllBtn"
    );

  const importable =
    getImportableAbilities();

  if (count) {
    count.textContent =
      `تم تحديد ${_importSelected.size}`;
  }

  if (selectAllBtn) {
    const allSelected =
      importable.length > 0 &&
      importable.every(text =>
        _importSelected.has(text)
      );

    selectAllBtn.textContent =
      allSelected
        ? "إلغاء التحديد"
        : "تحديد الكل";

    selectAllBtn.disabled =
      importable.length === 0;
  }
}

function renderImportAbilityGrid() {
  const grid =
    document.getElementById(
      "importAbilityGrid"
    );

  if (!grid) return;

  grid.innerHTML = "";

  const master =
    getUniqueMasterAbilities();

  const owned =
    new Set(
      normalizeAbilityList(
        loadAbilities(
          _importTargetKey
        )
      ).map(ab => ab.text)
    );

  if (!master.length) {
    const empty =
      document.createElement("p");

    empty.className =
      "text-yellow-200 text-center py-5";

    empty.textContent =
      "لا توجد قدرات محفوظة من صفحة البداية.";

    grid.appendChild(empty);
    updateImportSelectionUi();
    return;
  }

  master.forEach(text => {
    const alreadyOwned =
      owned.has(text);

    const selected =
      _importSelected.has(text);

    const option =
      document.createElement("button");

    option.type = "button";
    option.className =
      "import-ability-option" +
      (selected ? " is-selected" : "");

    option.disabled =
      alreadyOwned;

    option.setAttribute(
      "aria-pressed",
      String(selected)
    );

    const check =
      document.createElement("span");

    check.className =
      "import-ability-check";

    check.textContent =
      alreadyOwned
        ? "✓"
        : selected
          ? "✓"
          : "";

    const label =
      document.createElement("span");

    label.className =
      "min-w-0 flex-1";

    label.textContent =
      alreadyOwned
        ? `${text} — موجودة لدى اللاعب`
        : text;

    option.appendChild(check);
    option.appendChild(label);

    option.addEventListener(
      "click",
      () => {
        if (_importSelected.has(text)) {
          _importSelected.delete(text);
          option.classList.remove(
            "is-selected"
          );
          option.setAttribute(
            "aria-pressed",
            "false"
          );
          check.textContent = "";
        } else {
          _importSelected.add(text);
          option.classList.add(
            "is-selected"
          );
          option.setAttribute(
            "aria-pressed",
            "true"
          );
          check.textContent = "✓";
        }

        updateImportSelectionUi();
      }
    );

    grid.appendChild(option);
  });

  updateImportSelectionUi();
}

function openImportAbilityModal(
  targetKey
) {
  if (
    targetKey !== P1_ABILITIES_KEY &&
    targetKey !== P2_ABILITIES_KEY
  ) {
    return;
  }

  _importTargetKey =
    targetKey;

  _importSelected.clear();

  const targetName =
    targetKey === P1_ABILITIES_KEY
      ? player1
      : player2;

  const modal =
    document.getElementById(
      "importAbilityModal"
    );

  const title =
    document.getElementById(
      "importAbilityTitle"
    );

  if (!modal) return;

  if (title) {
    title.textContent =
      `استيراد قدرات للمعركة لدى ${targetName}`;
  }

  renderImportAbilityGrid();

  modal.classList.remove(
    "hidden"
  );

  modal.classList.add(
    "flex"
  );
}

function closeImportAbilityModal() {
  const modal =
    document.getElementById(
      "importAbilityModal"
    );

  if (modal) {
    modal.classList.add(
      "hidden"
    );

    modal.classList.remove(
      "flex"
    );
  }

  _importSelected.clear();
  _importTargetKey = null;
}

function toggleImportSelectAll() {
  const importable =
    getImportableAbilities();

  const allSelected =
    importable.length > 0 &&
    importable.every(text =>
      _importSelected.has(text)
    );

  _importSelected.clear();

  if (!allSelected) {
    importable.forEach(text =>
      _importSelected.add(text)
    );
  }

  renderImportAbilityGrid();
}

function confirmImportAbilities() {
  if (!_importTargetKey) return;

  const selected =
    getUniqueMasterAbilities()
      .filter(text =>
        _importSelected.has(text)
      );

  if (!selected.length) {
    showToast(
      "اختر قدرة واحدة على الأقل للاستيراد."
    );
    return;
  }

  const current =
    normalizeAbilityList(
      loadAbilities(
        _importTargetKey
      )
    );

  const existing =
    new Set(
      current.map(ab => ab.text)
    );

  const imported =
    selected.filter(text =>
      !existing.has(text)
    );

  if (!imported.length) {
    showToast(
      "جميع القدرات المحددة موجودة لدى اللاعب بالفعل."
    );
    renderImportAbilityGrid();
    return;
  }

  imported.forEach(text => {
    current.push({
      text,
      used: false
    });
  });

  saveAbilities(
    _importTargetKey,
    current
  );

  renderAbilities(
    P2_ABILITIES_KEY,
    document.getElementById(
      "p2Abilities"
    )
  );

  renderAbilities(
    P1_ABILITIES_KEY,
    document.getElementById(
      "p1Abilities"
    )
  );

  syncServerAbilities();
  broadcast();

  showToast(
    imported.length === 1
      ? `✅ تم استيراد «${imported[0]}» للمعركة الحالية.`
      : `✅ تم استيراد ${imported.length} قدرات للمعركة الحالية.`
  );

  closeImportAbilityModal();
}

window.openImportAbilityModal =
  openImportAbilityModal;

window.closeImportAbilityModal =
  closeImportAbilityModal;

window.toggleImportSelectAll =
  toggleImportSelectAll;

window.confirmImportAbilities =
  confirmImportAbilities;

function openSwapAbilityModal(
  targetKey
) {
  _swapTargetKey =
    targetKey;

  const targetName =
    targetKey ===
    P1_ABILITIES_KEY
      ? player1
      : player2;

  _swapTargetLabel =
    targetName ||
    "اللاعب";

  const modal =
    document.getElementById(
      "swapAbilityModal"
    );

  const grid =
    document.getElementById(
      "swapAbilityGrid"
    );

  const title =
    document.getElementById(
      "swapAbilityTitle"
    );

  if (
    !modal ||
    !grid ||
    !title
  ) {
    return;
  }

  title.textContent =
    `تبديل قدرة لدى ${_swapTargetLabel}`;

  grid.innerHTML = "";

  const list =
    normalizeAbilityList(
      loadAbilities(
        _swapTargetKey
      )
    );

  if (!list.length) {

    const p =
      document.createElement(
        "p"
      );

    p.className =
      "text-yellow-200 text-center py-2";

    p.textContent =
      "لا توجد قدرات لتبديلها.";

    grid.appendChild(
      p
    );

  } else {

    list.forEach(
      (ab, idx) => {

        const btn =
          document.createElement(
            "button"
          );

        btn.className =
          "w-full text-center px-3 py-2 rounded-lg border-2 border-yellow-500 bg-[#7b2131] hover:bg-[#8b2a3a] font-bold";

        btn.textContent =
          ab.text +
          (
            ab.used
              ? " (مستعملة)"
              : ""
          );

        btn.onclick =
          () =>
            doSwapAbility(
              idx
            );

        grid.appendChild(
          btn
        );
      }
    );
  }

  modal.classList.remove(
    "hidden"
  );

  modal.classList.add(
    "flex"
  );
}

function closeSwapAbilityModal() {
  const modal =
    document.getElementById(
      "swapAbilityModal"
    );

  if (!modal) return;

  modal.classList.add(
    "hidden"
  );

  modal.classList.remove(
    "flex"
  );
}

// ======================================================
// Swap pick
// ======================================================
let _swapIndex =
  null;

function openSwapPickModal(
  index
) {
  _swapIndex =
    index;

  const current =
    normalizeAbilityList(
      loadAbilities(
        _swapTargetKey
      )
    );

  const oldText =
    current[index]?.text ||
    "";

  const modal =
    document.getElementById(
      "swapPickModal"
    );

  const grid =
    document.getElementById(
      "swapPickGrid"
    );

  const title =
    document.getElementById(
      "swapPickTitle"
    );

  const hint =
    document.getElementById(
      "swapPickHint"
    );

  if (
    !modal ||
    !grid ||
    !title
  ) {
    return;
  }

  title.textContent =
    `اختر القدرة الجديدة لدى ${_swapTargetLabel}`;

  if (hint) {
    hint.textContent =
      oldText
        ? `سيتم استبدال «${oldText}»`
        : "";
  }

  grid.innerHTML = "";

  const master =
    loadMasterAbilities();

  if (!master.length) {

    const p =
      document.createElement(
        "p"
      );

    p.className =
      "text-yellow-200 text-center py-2";

    p.textContent =
      "⚠️ لا توجد قائمة قدرات جاهزة (افتح صفحة البداية start قبل المباراة).";

    grid.appendChild(
      p
    );

  } else {

    const p1 =
      new Set(
        normalizeAbilityList(
          loadAbilities(
            P1_ABILITIES_KEY
          )
        ).map(
          a => a.text
        )
      );

    const p2 =
      new Set(
        normalizeAbilityList(
          loadAbilities(
            P2_ABILITIES_KEY
          )
        ).map(
          a => a.text
        )
      );

    const owned =
      new Set([
        ...p1,
        ...p2
      ]);

    master.forEach(
      text => {

        const btn =
          document.createElement(
            "button"
          );

        const isSame =
          text === oldText;

        const isOwned =
          owned.has(text) &&
          !isSame;

        btn.className =
          "w-full text-center px-3 py-2 rounded-lg border-2 border-yellow-500 bg-[#7b2131] hover:bg-[#8b2a3a] font-bold transition";

        btn.textContent =
          text;

        if (isSame) {

          btn.className +=
            " opacity-40 cursor-not-allowed";

          btn.disabled =
            true;

          btn.title =
            "هذه نفس القدرة الحالية";

        } else if (
          isOwned
        ) {

          const tag =
            document.createElement(
              "span"
            );

          tag.className =
            "ml-2 inline-block text-[10px] px-2 py-[2px] rounded-full bg-black/30 border border-yellow-400/40";

          tag.textContent =
            "موجودة بالفعل";

          btn.appendChild(
            tag
          );
        }

        btn.onclick =
          () =>
            confirmSwapPick(
              text
            );

        grid.appendChild(
          btn
        );
      }
    );
  }

  modal.classList.remove(
    "hidden"
  );

  modal.classList.add(
    "flex"
  );
}

function closeSwapPickModal() {
  const modal =
    document.getElementById(
      "swapPickModal"
    );

  if (!modal) return;

  modal.classList.add(
    "hidden"
  );

  modal.classList.remove(
    "flex"
  );
}

function confirmSwapPick(
  newText
) {
  if (
    !_swapTargetKey ||
    _swapIndex === null
  ) {
    return;
  }

  const current =
    normalizeAbilityList(
      loadAbilities(
        _swapTargetKey
      )
    );

  if (
    !current[_swapIndex]
  ) {
    return;
  }

  const oldText =
    current[_swapIndex].text;

  if (
    !newText ||
    newText === oldText
  ) {
    return;
  }

  current[_swapIndex] = {
    text: newText,
    used: false
  };

  saveAbilities(
    _swapTargetKey,
    current
  );

  renderAbilities(
    P2_ABILITIES_KEY,
    document.getElementById(
      "p2Abilities"
    )
  );

  renderAbilities(
    P1_ABILITIES_KEY,
    document.getElementById(
      "p1Abilities"
    )
  );

  syncServerAbilities();
  broadcast();

  showToast(
    `🔁 تم تبديل «${oldText}» إلى «${newText}» لدى ${_swapTargetLabel}`
  );

  closeSwapPickModal();
  closeSwapAbilityModal();
}

function doSwapAbility(
  index
) {
  if (!_swapTargetKey) {
    return;
  }

  const current =
    normalizeAbilityList(
      loadAbilities(
        _swapTargetKey
      )
    );

  if (
    !current[index]
  ) {
    return;
  }

  openSwapPickModal(
    index
  );
}

window.openSwapPickModal =
  openSwapPickModal;

window.closeSwapPickModal =
  closeSwapPickModal;

window.openSwapAbilityModal =
  openSwapAbilityModal;

window.closeSwapAbilityModal =
  closeSwapAbilityModal;

// ======================================================
// Abilities persistence
// ======================================================
async function persistAbilityToServer(
  text
) {
  try {

    if (
      !text ||
      !text.trim()
    ) {
      return;
    }

    const r =
      await fetch(
        "/api/abilities/add",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              text:
                text.trim()
            })
        }
      );

    if (!r.ok) {

      const t =
        await r.text()
          .catch(
            () => ""
          );

      console.warn(
        "[abilities] server persist failed:",
        r.status,
        t
      );

      showToast(
        "⚠️ لم يتم الحفظ في السيرفر (سيتم حفظها محليًا فقط)."
      );
    }

  } catch (e) {

    console.warn(
      "[abilities] persist error:",
      e
    );

    showToast(
      "⚠️ خطأ أثناء الحفظ في السيرفر."
    );
  }
}

// ======================================================
// Quick Add Ability
// ======================================================
let _addTargetKey =
  null;

function openAddAbilityModal(
  targetKey
) {
  _addTargetKey =
    targetKey;

  const targetName =
    targetKey ===
    P1_ABILITIES_KEY
      ? player1
      : player2;

  const modal =
    document.getElementById(
      "addAbilityModal"
    );

  const input =
    document.getElementById(
      "addAbilityInput"
    );

  if (
    !modal ||
    !input
  ) {
    return;
  }

  input.value =
    "\n";

  input.placeholder =
    `اكتب نص قدرة لإضافتها لـ ${targetName}…`;

  modal.classList.remove(
    "hidden"
  );

  modal.classList.add(
    "flex"
  );

  setTimeout(
    () => {
      input.focus();

      try {
        input.setSelectionRange(
          1,
          1
        );
      } catch {}
    },
    0
  );
}

function closeAddAbilityModal() {
  const modal =
    document.getElementById(
      "addAbilityModal"
    );

  if (!modal) {
    return;
  }

  modal.classList.add(
    "hidden"
  );

  modal.classList.remove(
    "flex"
  );

  _addTargetKey =
    null;
}

async function confirmAddAbility() {
  const input =
    document.getElementById(
      "addAbilityInput"
    );

  if (
    !_addTargetKey ||
    !input
  ) {
    return;
  }

  const raw =
    String(
      input.value || ""
    )
      .replace(
        /\r/g,
        ""
      )
      .replace(
        /^\s*\n/,
        ""
      );

  const lines =
    raw
      .split("\n")
      .map(
        s => s.trim()
      )
      .filter(Boolean);

  if (!lines.length) {
    input.focus();
    return;
  }

  const list =
    normalizeAbilityList(
      loadAbilities(
        _addTargetKey
      )
    );

  lines.forEach(
    text => {
      list.push({
        text,
        used: false
      });
    }
  );

  saveAbilities(
    _addTargetKey,
    list
  );

  if (
    _addTargetKey ===
    P1_ABILITIES_KEY
  ) {

    renderAbilities(
      P1_ABILITIES_KEY,
      document.getElementById(
        "p1Abilities"
      )
    );

  } else {

    renderAbilities(
      P2_ABILITIES_KEY,
      document.getElementById(
        "p2Abilities"
      )
    );
  }

  syncServerAbilities();
  broadcast();

  for (
    const t of lines
  ) {
    await persistAbilityToServer(
      t
    );
  }

  if (
    lines.length === 1
  ) {

    showToast(
      `✅ تمت إضافة «${lines[0]}».`
    );

  } else {

    showToast(
      `✅ تمت إضافة ${lines.length} قدرات.`
    );
  }

  closeAddAbilityModal();
}

window.openAddAbilityModal =
  openAddAbilityModal;

window.closeAddAbilityModal =
  closeAddAbilityModal;

window.confirmAddAbility =
  confirmAddAbility;

// ======================================================
// Ability requests + OK alerts
// ======================================================
if (
  socket &&
  gameID
) {

  socket.on(
    "abilityRequested",
    handleRequest
  );

  socket.on(
    "requestUseAbility",
    handleRequest
  );

  function handleRequest({
    playerName,
    abilityText,
    requestId
  }) {

    const key =
      playerName === player1
        ? P1_ABILITIES_KEY
        : P2_ABILITIES_KEY;

    const list =
      normalizeAbilityList(
        loadAbilities(
          key
        )
      );

    const index =
      list.findIndex(
        a =>
          a.text ===
          abilityText
      );

    if (
      index === -1 ||
      list[index].used
    ) {

      socket.emit(
        "abilityRequestResult",
        {
          gameID,
          requestId,
          ok: false,

          reason:
            index === -1
              ? "ability_not_found"
              : "already_used"
        }
      );

      return;
    }

    showToast(
      `❗ ${playerName} يطلب استخدام القدرة: «${abilityText}»`,
      [
        {
          label:
            "استعمال",

          onClick:
            () => {

              const cur =
                normalizeAbilityList(
                  loadAbilities(
                    key
                  )
                );

              if (!cur[index]) {
                return;
              }

              cur[index].used =
                true;

              saveAbilities(
                key,
                cur
              );

              renderAbilities(
                P2_ABILITIES_KEY,
                document.getElementById(
                  "p2Abilities"
                )
              );

              renderAbilities(
                P1_ABILITIES_KEY,
                document.getElementById(
                  "p1Abilities"
                )
              );

              syncServerAbilities();

              broadcast();

              socket.emit(
                "abilityRequestResult",
                {
                  gameID,
                  requestId,
                  ok: true
                }
              );
            }
        }
      ],
      {
        label:
          "رفض",

        onClick:
          () =>
            socket.emit(
              "abilityRequestResult",
              {
                gameID,
                requestId,
                ok: false,
                reason:
                  "rejected"
              }
            )
      }
    );
  }

  // ==================================================
  // OK badges
  // ==================================================
  socket.on(
    "playerOk",
    (payload = {}) => {

      const {
        gameID: g,
        playerName,
        side
      } = payload;

      const active =
        Object.prototype.hasOwnProperty.call(
          payload,
          "active"
        )
          ? !!payload.active
          : true;

      if (
        g &&
        gameID &&
        g !== gameID
      ) {
        return;
      }

      if (
        side === "left"
      ) {
        okState.left = {
          active,
          playerName
        };
      }

      if (
        side === "right"
      ) {
        okState.right = {
          active,
          playerName
        };
      }

      if (
        active === false
      ) {
        hideOkBadge(
          side
        );
      } else {
        showOkBadge(
          side,
          playerName
        );
      }

      broadcast();
    }
  );
}

// ======================================================
// Initial render
// ======================================================
renderRound();