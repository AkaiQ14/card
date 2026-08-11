(function () {
  const params = new URLSearchParams(location.search);
  const gameID = params.get("game");

  // Auto-refresh via socket.io
  const socket = io();
  socket.emit("joinGame", { gameID, role: "viewer" });
  socket.emit("requestResultSnapshot", { gameID });

  // ---------- helpers ----------
  function getScale() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 1;
  }

  function createMedia(url, className) {
    const isWebm = /\.webm(\?|#|$)/i.test(url || "");
    if (isWebm) {
      const v = document.createElement("video");
      Object.assign(v, {
        src: url, autoplay: true, loop: true, muted: true, playsInline: true
      });
      v.controls = false;
      v.disablePictureInPicture = true;
      v.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback");
      v.setAttribute("preload", "metadata");
      v.oncontextmenu = (e) => e.preventDefault();
      v.draggable = false;
      v.className = className;
      return v;
    }
    const img = document.createElement("img");
    img.src = url;
    img.className = className;
    img.oncontextmenu = (e) => e.preventDefault();
    img.draggable = false;
    return img;
  }

  function pill(text, used) {
    const row = document.createElement("div");
    row.className =
      "w-full text-center px-3 py-2 rounded-lg font-bold text-sm select-none " +
      (used
        ? "bg-yellow-700 text-black/90 border border-yellow-800"
        : "bg-yellow-400 hover:bg-yellow-300 text-black border border-yellow-500");
    row.textContent = text;
    return row;
  }

  function renderPrevGrid(container, urls) {
    const scale = getScale();
    const w = Math.round(92 * scale) + "px";
    const h = Math.round(124 * scale) + "px";

    container.innerHTML = "";
    (urls || []).forEach((src) => {
      const cell = document.createElement("div");
      cell.style.width = w;
      cell.style.height = h;
      cell.className = "rounded-md overflow-hidden";
      const m = createMedia(src, "w-full h-full object-contain");
      cell.appendChild(m);
      container.appendChild(cell);
    });
  }

  function showOkBadge(which, name) {
    const el = document.getElementById(which === "p1" ? "p1OkAlert" : "p2OkAlert");
    if (!el) return;
    el.textContent = name ? `تمام – ${name}` : "تمام";
    el.classList.remove("hidden");
  }
  function hideOkBadge(which) {
    const el = document.getElementById(which === "p1" ? "p1OkAlert" : "p2OkAlert");
    if (!el) return;
    el.classList.add("hidden");
  }

  // Center VS vertically (spans the image area) and align round title X to VS center
  function centerVSAndRound() {
    const row = document.querySelector(".row-middle");
    const vsCol = document.getElementById("vsCol");
    const p1Media = document.getElementById("p1MediaCard");
    const p2Media = document.getElementById("p2MediaCard");
    if (!(row && vsCol && p1Media && p2Media)) return;

    // VS vertical centering
    const rowRect = row.getBoundingClientRect();
    const m1 = p1Media.getBoundingClientRect();
    const m2 = p2Media.getBoundingClientRect();
    const top = Math.min(m1.top, m2.top);
    const bottom = Math.max(m1.bottom, m2.bottom);
    const mediaHeight = bottom - top;
    const offset = top - rowRect.top;

    vsCol.style.marginTop = offset + "px";
    vsCol.style.height = mediaHeight + "px";
    vsCol.style.display = "flex";
    vsCol.style.alignItems = "center";
    vsCol.style.justifyContent = "center";

    // Round title horizontal centering to VS center
    const page = document.querySelector(".page");
    const roundTitle = document.getElementById("roundTitle");
    if (!(page && roundTitle)) return;

    const vsRect = vsCol.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const vsCenterX = vsRect.left + vsRect.width / 2;
    const pageCenterX = pageRect.left + pageRect.width / 2;
    const deltaX = Math.round(vsCenterX - pageCenterX);
    document.documentElement.style.setProperty("--round-shift-x", `${deltaX}px`);
  }

  // ---------- snapshot render ----------
  function renderSnapshot(s) {
    if (!s) return;

    // Round title: current round only
    const roundTitle = document.getElementById("roundTitle");
    if (roundTitle) roundTitle.textContent = `الجولة ${s.round + 1}`;

    // --- SWAP FIX ---
    // Your backend labels are inverted relative to the layout.
    // We want LEFT column = Player 1, RIGHT column = Player 2.
    // So we map visible left/right names to the opposite snapshot labels.
    const leftName  = s.player2 || "Player 1"; // show P1 on the left
    const rightName = s.player1 || "Player 2"; // show P2 on the right
    // --- end SWAP FIX ---

    // Names
    const p1Name = document.getElementById("p1Name");
    const p2Name = document.getElementById("p2Name");
    if (p1Name) p1Name.textContent = leftName;
    if (p2Name) p2Name.textContent = rightName;

    // Media (already correct: left media card shows currentLeftUrl, right shows currentRightUrl)
    const p1Media = document.getElementById("p1MediaCard");
    const p2Media = document.getElementById("p2MediaCard");
    if (p1Media) {
      p1Media.innerHTML = "";
      p1Media.appendChild(createMedia(s.currentLeftUrl, "w-full h-full object-contain"));
    }
    if (p2Media) {
      p2Media.innerHTML = "";
      p2Media.appendChild(createMedia(s.currentRightUrl, "w-full h-full object-contain"));
    }

    // Notes (bind by the swapped names)
    const p1Notes = document.getElementById("p1Notes");
    const p2Notes = document.getElementById("p2Notes");
    if (p1Notes) p1Notes.value = s.notes?.[leftName]  || "";
    if (p2Notes) p2Notes.value = s.notes?.[rightName] || "";

    // Previous grids (left/right are already correct)
    renderPrevGrid(document.getElementById("prevP1Grid"), s.prevLeft);
    renderPrevGrid(document.getElementById("prevP2Grid"), s.prevRight);

    // Abilities (bind by the swapped names)
    const p1Box = document.getElementById("p1Abilities");
    const p2Box = document.getElementById("p2Abilities");
    if (p1Box) {
      p1Box.innerHTML = "";
      (s.abilities?.[leftName] || []).forEach((a) => p1Box.appendChild(pill(a.text, a.used)));
    }
    if (p2Box) {
      p2Box.innerHTML = "";
      (s.abilities?.[rightName] || []).forEach((a) => p2Box.appendChild(pill(a.text, a.used)));
    }

    // HP chips (bind by the swapped names)
    const p1Health = document.getElementById("p1Health");
    const p2Health = document.getElementById("p2Health");
    if (p1Health) p1Health.textContent = String(s.scores?.[leftName]  ?? 0);
    if (p2Health) p2Health.textContent = String(s.scores?.[rightName] ?? 0);

    // OK badges (already keyed by left/right side, so keep as-is)
    if (s.ok?.left?.active)  showOkBadge("p1", s.ok.left.playerName);  else hideOkBadge("p1");
    if (s.ok?.right?.active) showOkBadge("p2", s.ok.right.playerName); else hideOkBadge("p2");

    // After layout: center VS + align round title X
    requestAnimationFrame(centerVSAndRound);
  }

  // Live updates
  socket.on("resultSnapshot", ({ snapshot }) => renderSnapshot(snapshot));
  socket.on("playerOk", ({ side, playerName, active = true }) => {
    const which = side === "left" ? "p1" : "p2";
    if (active) showOkBadge(which, playerName); else hideOkBadge(which);
  });

  // Keep alignment on resize
  window.addEventListener("resize", centerVSAndRound);

  // Game Over modal
  (function wireGameOverModal() {
    const modal = document.getElementById("gameOverModal");
    const textEl = document.getElementById("gameOverText");
    const closeEl = document.getElementById("gameOverClose");

    function showModal(msg){
      if (textEl) textEl.textContent = msg;
      if (modal){ modal.classList.remove("hidden"); modal.classList.add("flex"); }
    }
    function closeAndExit(){
      try{ window.close(); }catch{}
      setTimeout(() => { try{ window.location.replace("about:blank"); }catch{} }, 200);
    }
    if (closeEl) closeEl.addEventListener("click", closeAndExit);

    // --- Only this handler is changed ---
    socket.on("gameOver", (data = {}) => {
      const { winner, isTie, scores } = data;

      // 1) If tie flag is provided, trust it.
      if (isTie === true) {
        showModal("انتهت المباراة بالتعادل");
        return;
      }

      // 2) If winner provided, show it.
      if (winner) {
        showModal(`الفائز: ${winner}`);
        return;
      }

      // 3) If scores are provided, infer tie/winner using names on screen.
      if (scores) {
        const p1 = document.getElementById("p1Name")?.textContent?.trim();
        const p2 = document.getElementById("p2Name")?.textContent?.trim();
        if (p1 && p2) {
          const a = Number(scores[p1] ?? 0);
          const b = Number(scores[p2] ?? 0);
          showModal(a === b ? "انتهت المباراة بالتعادل" : `الفائز: ${a > b ? p1 : p2}`);
          return;
        }
      }

      // 4) Last resort: use visible score chips on the page.
      const a = Number(document.getElementById("p1Health")?.textContent || 0);
      const b = Number(document.getElementById("p2Health")?.textContent || 0);
      const p1 = document.getElementById("p1Name")?.textContent?.trim() || "Player 1";
      const p2 = document.getElementById("p2Name")?.textContent?.trim() || "Player 2";
      showModal(a === b ? "انتهت المباراة بالتعادل" : `الفائز: ${a > b ? p1 : p2}`);
    });
    // --- end modified handler ---
  })();
})();
