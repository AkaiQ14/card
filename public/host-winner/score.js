const player1 = localStorage.getItem("player1") || "لاعب 1";
const player2 = localStorage.getItem("player2") || "لاعب 2";
const scores  = JSON.parse(localStorage.getItem("scores") || "{}");

const score1 = parseInt(scores[player1]) || 0;
const score2 = parseInt(scores[player2]) || 0;

const scoreBox = document.getElementById("scoreBox");

// ===== Beautiful Success Modal =====
function showSuccessModal(playerName) {
  // إنشاء overlay
  const overlay = document.createElement("div");
  overlay.id = "successModalOverlay";
  overlay.className = "fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 transition-opacity duration-300";
  overlay.style.backdropFilter = "blur(4px)";
  
  // إنشاء البطاقة
  const modal = document.createElement("div");
  modal.className = "bg-[#4B0E1F] border-4 border-[#FFD700] rounded-2xl p-8 max-w-md w-11/12 mx-4 shadow-2xl transform transition-all duration-300 scale-0 modal-enter";
  modal.style.boxShadow = "0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(255,215,0,0.3), inset 0 0 0 1px rgba(255,215,0,0.2)";
  
  modal.innerHTML = `
    <div class="text-center space-y-6">
      <!-- أيقونة النجاح -->
      <div class="flex justify-center">
        <div class="w-20 h-20 bg-[#0b6e3f] border-4 border-[#FFD700] rounded-full flex items-center justify-center icon-bounce">
          <span class="text-5xl">✅</span>
        </div>
      </div>
      
      <!-- العنوان -->
      <h2 class="text-3xl font-bold text-[#FFD700] text-shadow-lg" style="text-shadow: 0 0 10px rgba(255,215,0,0.5);">
        تمت الإضافة بنجاح!
      </h2>
      
      <!-- الرسالة -->
      <p class="text-xl text-white">
        تمت إضافة نقطة لـ
      </p>
      <p class="text-2xl font-bold text-[#FFD700] bg-[#6d1a2e] border-2 border-[#FFD700] rounded-lg px-6 py-3 inline-block">
        ${playerName}
      </p>
      
      <!-- زر الإغلاق -->
      <button 
        onclick="closeSuccessModal()"
        class="bg-[#0b6e3f] hover:bg-[#14824c] border-3 border-[#FFD700] text-[#FFD700] font-bold px-8 py-3 rounded-xl text-lg transition-all duration-200 transform hover:scale-105 active:scale-95"
        style="box-shadow: 0 4px 0 rgba(0,0,0,0.3);"
      >
        موافق
      </button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // تأثير الظهور
  setTimeout(() => {
    overlay.style.opacity = "1";
    modal.style.transform = "scale(1)";
    modal.classList.add("modal-enter");
  }, 10);
  
  // إغلاق عند الضغط على overlay
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeSuccessModal();
    }
  });
  
  // إغلاق عند الضغط على ESC
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeSuccessModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function closeSuccessModal() {
  const overlay = document.getElementById("successModalOverlay");
  if (overlay) {
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
    }, 300);
  }
}

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
    showErrorModal("❌ هذه المباراة غير مُحتسبة في لوحة المتصدرين.");
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
      showErrorModal("تحتاج لتسجيل الدخول لإضافة النقاط (افتح /login ثم عُد).");
      btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
      return;
    }

    if (!res.ok) {
      showErrorModal("حدث خطأ أثناء تحديث النقاط.");
      btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
      return;
    }

    // عرض رسالة النجاح الجميلة
    showSuccessModal(playerName);
    btn && (btn.disabled = true, btn.textContent = "🎯 تمت الإضافة");
  } catch (e) {
    console.error(e);
    showErrorModal("⚠️ فشل الاتصال بالخادم.");
    btn && (btn.disabled = false, btn.textContent = "➕ أضف نقطة للفائز");
  }
}

// ===== Error Modal =====
function showErrorModal(message) {
  // إنشاء overlay
  const overlay = document.createElement("div");
  overlay.id = "errorModalOverlay";
  overlay.className = "fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 transition-opacity duration-300";
  overlay.style.backdropFilter = "blur(4px)";
  
  // إنشاء البطاقة
  const modal = document.createElement("div");
  modal.className = "bg-[#4B0E1F] border-4 border-red-500 rounded-2xl p-8 max-w-md w-11/12 mx-4 shadow-2xl transform transition-all duration-300 scale-0 modal-enter";
  modal.style.boxShadow = "0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(239,68,68,0.3), inset 0 0 0 1px rgba(239,68,68,0.2)";
  
  modal.innerHTML = `
    <div class="text-center space-y-6">
      <!-- أيقونة الخطأ -->
      <div class="flex justify-center">
        <div class="w-20 h-20 bg-red-600 border-4 border-red-400 rounded-full flex items-center justify-center">
          <span class="text-5xl">❌</span>
        </div>
      </div>
      
      <!-- العنوان -->
      <h2 class="text-3xl font-bold text-red-400">
        حدث خطأ
      </h2>
      
      <!-- الرسالة -->
      <p class="text-xl text-white">
        ${message}
      </p>
      
      <!-- زر الإغلاق -->
      <button 
        onclick="closeErrorModal()"
        class="bg-red-600 hover:bg-red-700 border-3 border-red-400 text-white font-bold px-8 py-3 rounded-xl text-lg transition-all duration-200 transform hover:scale-105 active:scale-95"
        style="box-shadow: 0 4px 0 rgba(0,0,0,0.3);"
      >
        موافق
      </button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // تأثير الظهور
  setTimeout(() => {
    overlay.style.opacity = "1";
    modal.style.transform = "scale(1)";
    modal.classList.add("modal-enter");
  }, 10);
  
  // إغلاق عند الضغط على overlay
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeErrorModal();
    }
  });
  
  // إغلاق عند الضغط على ESC
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeErrorModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function closeErrorModal() {
  const overlay = document.getElementById("errorModalOverlay");
  if (overlay) {
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
    }, 300);
  }
}
