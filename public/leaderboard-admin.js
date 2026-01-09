let ALL_PLAYERS = []; // cache for filtering

async function fetchAll() {
  const res = await fetch("/api/leaderboard/all");
  const data = await res.json();
  return Array.isArray(data.players) ? data.players : [];
}

// Normalizes Arabic (drops tashkeel & tatweel) so search is forgiving
function normalizeArabic(s) {
  return (s || "")
    .toString()
    .trim()
    .replace(/[\u064B-\u0652]/g, "") // harakat
    .replace(/\u0640/g, ""); // tatweel
}

// Case-insensitive-ish includes for Arabic/Latin
function nameMatches(playerName, query) {
  if (!query) return true;
  const a = normalizeArabic(playerName).toLowerCase();
  const b = normalizeArabic(query).toLowerCase();
  return a.includes(b);
}

function cssId(name) {
  return name.replace(/\s+/g, "_").replace(/[^_\w\u0600-\u06FF]/g, "");
}
function encode(s) {
  return encodeURIComponent(s);
}
function decode(s) {
  return decodeURIComponent(s);
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ===== Sorting =====
let SORT = { key: "points", dir: "desc" }; // default: highest points first

function applySort(list) {
  const key = SORT.key;
  const dir = SORT.dir === "asc" ? 1 : -1;

  return list.slice().sort((a, b) => {
    if (key === "name") {
      return a.name.localeCompare(b.name, "ar") * dir;
    }
    const A = +a[key] || 0;
    const B = +b[key] || 0;
    if (A === B) {
      return a.name.localeCompare(b.name, "ar");
    }
    return (A - B) * dir;
  });
}

function updateSortUI() {
  document.querySelectorAll(".sort-indicator").forEach((el) => {
    const k = el.getAttribute("data-key");
    if (k === SORT.key) {
      el.textContent = SORT.dir === "asc" ? " ▲" : " ▼";
      el.classList.add("text-white");
    } else {
      el.textContent = "";
      el.classList.remove("text-white");
    }
  });
}

async function render() {
  // fetch & cache once, then render filtered view
  ALL_PLAYERS = await fetchAll();
  applyFilter(); // uses current input value
}

function renderRows(list) {
  const tbody = document.getElementById("rows");
  const count = document.getElementById("resultCount");
  tbody.innerHTML = "";

  const sorted = applySort(list);
  updateSortUI();

  sorted.forEach((p, i) => {
    const id = cssId(p.name);
    const tr = document.createElement("tr");
    tr.dataset.player = p.name; // used by Save All
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="font-semibold">${p.name}</td>
      <td><input type="number" id="games-${id}"  value="${p.games}"  class="w-20 text-black rounded px-1" /></td>
      <td><input type="number" id="wins-${id}"   value="${p.wins}"   class="w-20 text-black rounded px-1" /></td>
      <td><input type="number" id="losses-${id}" value="${p.losses}" class="w-20 text-black rounded px-1" /></td>
      <td>${p.winRate}%</td>
      <td id="pts-${id}">${p.points}</td>
      <td class="space-x-2 space-x-reverse">
        <button class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700" data-delta="1"  data-player="${encode(p.name)}">+1 نقطة</button>
        <button class="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700"    data-delta="-1" data-player="${encode(p.name)}">-1</button>
        <button class="px-2 py-1 rounded bg-gray-600 hover:bg-gray-700" data-delete="${encode(p.name)}">🗑️ حذف</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // update result count
  if (count) {
    count.textContent =
      list.length === ALL_PLAYERS.length
        ? `الكل: ${list.length}`
        : `النتائج: ${list.length} / ${ALL_PLAYERS.length}`;
  }

  // Re-attach handlers (because rows are rebuilt)
  tbody.querySelectorAll("button[data-delta]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = decode(btn.getAttribute("data-player"));
      const delta = parseInt(btn.getAttribute("data-delta"), 10);
      try {
        const res = await fetch("/api/leaderboard/award", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: name, delta }),
        });
        const json = await res.json();
        if (!json.ok) return alert("فشل: " + (json.error || "خطأ"));
        document.getElementById("pts-" + cssId(name)).textContent = json.points;
      } catch (e) {
        alert("تعذر الاتصال بالخادم.");
      }
    });
  });

  tbody.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = decode(btn.getAttribute("data-delete"));
      if (!confirm("هل تريد حذف " + name + " من اللوحة؟")) return;
      try {
        const res = await fetch("/api/leaderboard/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: name }),
        });
        const json = await res.json();
        if (!json.ok) return alert("فشل الحذف: " + (json.error || "خطأ"));
        render(); // refetch + reapply filter
      } catch (e) {
        alert("تعذر الاتصال بالخادم.");
      }
    });
  });
}

// Filtering (called after initial fetch and on input)
function applyFilter() {
  const q = document.getElementById("searchInput")?.value || "";
  const filtered = ALL_PLAYERS.filter((p) => nameMatches(p.name, q));
  renderRows(filtered);
}

// Save All handler (unchanged)
document.getElementById("saveAllBtn").addEventListener("click", async () => {
  try {
    const rows = Array.from(document.querySelectorAll("#rows tr[data-player]"));
    const payload = rows.map((tr) => {
      const name = tr.dataset.player;
      return {
        player: name,
        games: toInt(document.getElementById("games-" + cssId(name)).value),
        wins: toInt(document.getElementById("wins-" + cssId(name)).value),
        losses: toInt(document.getElementById("losses-" + cssId(name)).value),
      };
    });

    const res = await fetch("/api/leaderboard/batchUpdate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    const json = await res.json();
    if (!json.ok) return alert("فشل الحفظ: " + (json.error || "خطأ"));
    alert("✅ تم حفظ جميع التعديلات");
    render();
  } catch (e) {
    alert("تعذر الاتصال بالخادم.");
  }
});

// Add player (unchanged)
document.getElementById("addBtn").addEventListener("click", async () => {
  const input = document.getElementById("newPlayer");
  const name = (input.value || "").trim();
  if (!name) return;
  await fetch("/api/leaderboard/award", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: name, delta: 0 }),
  });
  input.value = "";
  render();
});

// --- Search wiring (debounced input + clear button) ---
const searchInput = document.getElementById("searchInput");
const clearSearch = document.getElementById("clearSearch");

let t;
if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(applyFilter, 150); // small debounce
  });
}
if (clearSearch) {
  clearSearch.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    applyFilter();
    searchInput?.focus();
  });
}

// Header sort buttons
document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-key");
    if (SORT.key === key) {
      SORT.dir = SORT.dir === "asc" ? "desc" : "asc"; // toggle
    } else {
      SORT.key = key;
      SORT.dir = key === "name" ? "asc" : "desc"; // sensible defaults
    }
    applyFilter(); // re-render with current filter + sort
  });
});

// Initial load
render();
