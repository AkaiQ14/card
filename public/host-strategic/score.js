const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const scores  = JSON.parse(localStorage.getItem("scores") || "{}");

const score1 = parseInt(scores[player1]) || 0;
const score2 = parseInt(scores[player2]) || 0;

const scoreBox = document.getElementById("scoreBox");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createFeedbackModal({ type = "success", title, messageHtml }) {
  const current = document.querySelector(".feedback-overlay");
  if (current) current.remove();

  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.id = type === "error" ? "errorModalOverlay" : "successModalOverlay";

  const modal = document.createElement("div");
  modal.className = `feedback-modal ${type === "error" ? "error" : "success"}`;
  modal.innerHTML = `
    <h2 class="feedback-title">${escapeHtml(title)}</h2>
    <p class="feedback-text">${messageHtml}</p>
    <div class="feedback-actions">
      <button type="button" class="score-btn ${type === "error" ? "score-btn-primary" : "score-btn-gold"}">
        موافق
      </button>
    </div>
  `;

  const close = () => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 200);
  };

  modal.querySelector("button")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const escHandler = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    modal.classList.add("is-visible");
  });

  return close;
}

function showSuccessModal(playerName) {
  window.__closeSuccessModal = createFeedbackModal({
    type: "success",
    title: "تمت الإضافة بنجاح",
    messageHtml: `تمت إضافة نقطة لـ <span class="feedback-player">${escapeHtml(playerName)}</span>`
  });
}

function closeSuccessModal() {
  if (typeof window.__closeSuccessModal === "function") {
    window.__closeSuccessModal();
    window.__closeSuccessModal = null;
    return;
  }

  const overlay = document.getElementById("successModalOverlay");
  if (overlay) overlay.remove();
}

let winner = null;
if (score1 > score2) winner = player1;
else if (score2 > score1) winner = player2;

function renderFinalScore() {
  if (!scoreBox) return;

  scoreBox.innerHTML = `
    <div class="scoreboard-wrap" aria-label="لوحة النتيجة النهائية">
      <img class="scoreboard-image" src="../images/SCOREBOARD.png" alt="QG14 Card Clash Scoreboard" />
      <div class="scoreboard-name left" title="${escapeHtml(player2)}">${escapeHtml(player2)}</div>
      <div class="scoreboard-result" aria-label="${score2} مقابل ${score1}">
        <span>${score2}</span>
        <span class="score-separator">-</span>
        <span>${score1}</span>
      </div>
      <div class="scoreboard-name right" title="${escapeHtml(player1)}">${escapeHtml(player1)}</div>
    </div>

    <div class="result-panel">
      <p class="score-heading winner-label">
        ${winner
          ? `الفائز هو ${escapeHtml(winner)}`
          : "تعادل بين اللاعبين"}
      </p>
      <div id="scoreActions" class="score-actions"></div>
    </div>
  `;

  const actions = document.getElementById("scoreActions");
  if (!actions) return;

  if (winner) {
    const addBtn = document.createElement("button");
    addBtn.id = "addPointBtn";
    addBtn.type = "button";
    addBtn.className = "score-btn score-btn-gold";
    addBtn.textContent = "أضف نقطة للفائز";
    addBtn.addEventListener("click", () => addPoint(winner));
    actions.appendChild(addBtn);
  }

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "score-btn score-btn-primary";
  playBtn.textContent = "بدء لعبة جديدة";
  playBtn.addEventListener("click", playAgain);
  actions.appendChild(playBtn);
}

renderFinalScore();

function playAgain() {
  const p1 = localStorage.getItem("player1");
  const p2 = localStorage.getItem("player2");

  [
    // مفاتيح اللعبة العامة
    "gameUsedImages","globalUsed","picks","scores","currentRound","round",
    "player1Picks","player2Picks","player1Filenames","player2Filenames",
    "player1Animes","player2Animes","usedImages","animeList","gameID",

    // مفاتيح الملاحظات والإضافات الحسابية (RESET كامل)
    p1 && `notes:${p1}`,
    p2 && `notes:${p2}`,
    p1 && `notesManual:${p1}`,
    p2 && `notesManual:${p2}`,
    p1 && `quickCounts:${p1}`,
    p2 && `quickCounts:${p2}`,
    p1 && `noteState:${p1}`,
    p2 && `noteState:${p2}`
  ].filter(Boolean).forEach(k => localStorage.removeItem(k));

  location.href = "start.html";
}

// === Add 1 tournament point to winner (leaderboard) ===
async function addPoint(playerName) {
  const btn = document.getElementById("addPointBtn");

  // 1) Was this game marked as counted?
  const isCounted = localStorage.getItem("countInLeaderboard") === "true";
  if (!isCounted) {
    showErrorModal("هذه المباراة غير مُحتسبة في لوحة المتصدرين.");
    return;
  }

  // 2) Call backend (must be logged in)
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جارٍ الإضافة...";
    }

    const res = await fetch("/api/leaderboard/award", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: playerName, delta: 1 })
    });

    if (res.status === 401) {
      showErrorModal("تحتاج لتسجيل الدخول لإضافة النقاط (افتح /login ثم عُد).");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "أضف نقطة للفائز";
      }
      return;
    }

    if (!res.ok) {
      showErrorModal("حدث خطأ أثناء تحديث النقاط.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "أضف نقطة للفائز";
      }
      return;
    }

    showSuccessModal(playerName);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "تمت الإضافة";
    }
  } catch (e) {
    console.error(e);
    showErrorModal("فشل الاتصال بالخادم.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "أضف نقطة للفائز";
    }
  }
}

function showErrorModal(message) {
  window.__closeErrorModal = createFeedbackModal({
    type: "error",
    title: "حدث خطأ",
    messageHtml: escapeHtml(message)
  });
}

function closeErrorModal() {
  if (typeof window.__closeErrorModal === "function") {
    window.__closeErrorModal();
    window.__closeErrorModal = null;
    return;
  }

  const overlay = document.getElementById("errorModalOverlay");
  if (overlay) overlay.remove();
}