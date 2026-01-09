const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const scores  = JSON.parse(localStorage.getItem("scores") || "{}");

const score1 = parseInt(scores[player1]) || 0;
const score2 = parseInt(scores[player2]) || 0;

const scoreBox = document.getElementById("scoreBox");

let winner = null;
if (score1 > score2) winner = player1;
else if (score2 > score1) winner = player2;

const addBtnHtml = winner
  ? `<button id="addPointBtn"
        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-lg"
        onclick="addPoint('${winner}')">
        ➕ أضف نقطة للفائز
     </button>`
  : "";

scoreBox.innerHTML = `
  <p>${player1}: ${score1} نقطة صحة</p>
  <p>${player2}: ${score2} نقطة صحة</p>
  <hr class="border-gray-500 my-4 w-1/2 mx-auto" />
  <p class="text-3xl font-bold mt-4">
    ${winner ? `🎉 الفائز هو: ${winner}` : "🤝 تعادل بين اللاعبين!"}
  </p>
  ${addBtnHtml}
`;

function playAgain() {
  [
    "gameUsedImages","globalUsed","picks","scores","currentRound","round",
    "player1Picks","player2Picks","player1Filenames","player2Filenames",
    "player1Animes","player2Animes","usedImages","animeList","gameID"
  ].forEach(k => localStorage.removeItem(k));
  location.href = "start.html";
}

// === Add 1 tournament point to winner (leaderboard) ===
async function addPoint(playerName) {
  const btn = document.getElementById("addPointBtn");

  // 1) Was this game marked as counted?
  const isCounted = localStorage.getItem("countInLeaderboard") === "true";
  if (!isCounted) {
    alert("❌ هذه المباراة غير مُحتسبة في لوحة المتصدرين.");
    return;
  }

  // 2) Call backend (must be logged in)
  try {
    btn && (btn.disabled = true, btn.textContent = "جارٍ الإضافة...");

    const res = await fetch("/api/leaderboard/award", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: playerName, delta: 1 })
    });

    if (res.status === 401) {
      alert("تحتاج لتسجيل الدخول لإضافة النقاط (افتح /login ثم عُد).");
      btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
      return;
    }

    if (!res.ok) {
      alert("حدث خطأ أثناء تحديث النقاط.");
      btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
      return;
    }

    alert(`✅ تمت إضافة نقطة لـ ${playerName}`);
    btn && (btn.disabled = true, btn.textContent = "🎯 تمت الإضافة");
  } catch (e) {
    console.error(e);
    alert("⚠️ فشل الاتصال بالخادم.");
    btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
  }
}
