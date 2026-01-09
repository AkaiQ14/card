// public/js/webm-sfx.js
(function () {
  const SFX = {
    map: {},
    audio: new Audio(),
    queue: [],
    playing: false,
    lastEnqueue: { src: "", at: 0 },
    currentRound: [],
    perSide: { left: [], right: [] },
    settings: {
      volume: Math.max(0, Math.min(100, parseInt(localStorage.getItem("sfx:volume") || "60", 10))),
      muted: localStorage.getItem("sfx:muted") === "1",
    },
  };

  SFX.audio.preload = "auto";

  function applySettingsToAudio() {
    SFX.audio.muted = !!SFX.settings.muted;
    SFX.audio.volume = (SFX.settings.volume / 100) * (SFX.settings.muted ? 0 : 1);
  }
  applySettingsToAudio();

  function filenameFrom(url) {
    try {
      const u = new URL(url, location.origin);
      const last = decodeURIComponent(u.pathname.split("/").pop() || "");
      return last.split("?")[0].split("#")[0];
    } catch {
      const parts = String(url || "").split("/");
      const last = parts[parts.length - 1] || "";
      return last.split("?")[0].split("#")[0];
    }
  }

  function soundPathFor(webmUrl) {
    const key = filenameFrom(webmUrl);
    const mapped = SFX.map[key];
    if (mapped) return mapped.startsWith("/") ? mapped : `/sounds/${mapped}`;
    const base = key.replace(/\.webm$/i, "");
    return `/sounds/${base}.mp3`;
  }

  function ensureResumeHook() {
    if (SFX._resumeBound) return;
    SFX._resumeBound = true;
    const resume = () => {
      if (!SFX.playing && SFX.queue.length) playNext();
      window.removeEventListener("click", resume);
      window.removeEventListener("touchstart", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("click", resume, { once: true });
    window.addEventListener("touchstart", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  }

  function enqueue(src) {
    const now = Date.now();
    if (SFX.lastEnqueue.src === src && now - SFX.lastEnqueue.at < 250) return;
    SFX.lastEnqueue = { src, at: now };
    SFX.queue.push(src);
    if (!SFX.playing) playNext();
  }

  function playNext() {
    const src = SFX.queue.shift();
    if (!src) return;
    ensureResumeHook();
    SFX.playing = true;
    applySettingsToAudio();

    if (!SFX.audio.src.endsWith(src)) {
      SFX.audio.src = src;
    } else {
      try { SFX.audio.currentTime = 0; } catch {}
    }

    const finish = () => {
      SFX.playing = false;
      SFX.audio.onended = null;
      SFX.audio.onerror = null;
      try { SFX.audio.pause(); } catch {}
      SFX.audio.src = "";
      playNext();
    };

    SFX.audio.onended = finish;
    SFX.audio.onerror = finish;
    SFX.audio.play().catch(() => { SFX.playing = false; });
  }

  function playFor(webmUrl) {
    if (!/\.webm(\?|#|$)/i.test(webmUrl || "")) return;
    const src = soundPathFor(webmUrl);
    if (!src) return;
    enqueue(src);
  }

  function attachToMedia(el, url) {
    if (!el || String(el.tagName).toLowerCase() !== "video") return;
    const src = soundPathFor(url);
    if (src && !SFX.currentRound.includes(src)) {
      SFX.currentRound.push(src);
    }
    el.addEventListener("play", () => playFor(url), { once: true });
  }

  // mark card for replay button by side
  function markSide(side, url) {
    const src = soundPathFor(url);
    if (src && !SFX.perSide[side].includes(src)) {
      SFX.perSide[side].push(src);
    }
  }

  function wireReplayButton(btn, side) {
    if (!btn || btn._sfxWired) return;
    btn._sfxWired = true;
    btn.addEventListener("click", () => {
      if (!SFX.perSide[side].length) return;
      SFX.perSide[side].forEach((src) => SFX.queue.push(src));
      if (!SFX.playing) playNext();
    });
  }

  function ensureReplayButtons() {
    let leftBtn = document.getElementById("sfxReplayLeft");
    let rightBtn = document.getElementById("sfxReplayRight");

    // Create if missing, but with SWAPPED positions:
    //   leftBtn → right side
    //   rightBtn → left side
    if (!leftBtn) {
      leftBtn = document.createElement("button");
      leftBtn.id = "sfxReplayLeft";
      leftBtn.className =
        "btn-gold fixed bottom-5 right-4 z-[1200] h-12 px-5 text-sm font-extrabold rounded-full";
      leftBtn.textContent = "🔊 لاعب 1";
      document.body.appendChild(leftBtn);
    } else {
      // Force swap position even if it already exists
      leftBtn.className =
        "btn-gold fixed bottom-5 right-4 z-[1200] h-12 px-5 text-sm font-extrabold rounded-full";
    }

    if (!rightBtn) {
      rightBtn = document.createElement("button");
      rightBtn.id = "sfxReplayRight";
      rightBtn.className =
        "btn-gold fixed bottom-5 left-4 z-[1200] h-12 px-5 text-sm font-extrabold rounded-full";
      rightBtn.textContent = "🔊 لاعب 2";
      document.body.appendChild(rightBtn);
    } else {
      // Force swap position even if it already exists
      rightBtn.className =
        "btn-gold fixed bottom-5 left-4 z-[1200] h-12 px-5 text-sm font-extrabold rounded-full";
    }

    wireReplayButton(leftBtn, "left");
    wireReplayButton(rightBtn, "right");
  }

  // volume controls css + code
  function ensureAudioStyles() {
    if (document.getElementById("sfxVolumeStyles")) return;
    const css = `
      .audio-controls { position: fixed; left: 15px; top: 15px; display: flex; flex-direction: column; align-items: center; gap: 10px; z-index: 1300; }
      .audio-toggle { width: 50px; height: 50px; border-radius: 50%; background: linear-gradient(145deg,#511522,#4a1520); border: 2px solid #FFD700; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform .2s ease, box-shadow .2s ease; box-shadow: 0 4px 16px rgba(0,0,0,.35); font-size: 20px; color:#FFD700; }
      .audio-toggle:hover { transform: scale(1.1); box-shadow: 0 8px 20px rgba(243,194,26,.3); }
      .audio-toggle.muted { opacity:.6; }
      .volume-slider-container { display:flex; flex-direction:column; align-items:center; gap:6px; background:rgba(43,10,17,.9); padding:10px; border-radius:10px; border:1px solid #FFD700; min-width:90px; }
      #volumeSlider { width:90px; height:6px; border-radius:3px; background:#2b0a11; outline:none; cursor:pointer; -webkit-appearance:none; direction:ltr; }
      #volumeSlider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#FFD700; box-shadow:0 2px 4px rgba(0,0,0,.3); }
      #volumeSlider::-moz-range-thumb { width:16px; height:16px; border-radius:50%; background:#FFD700; border:none; box-shadow:0 2px 4px rgba(0,0,0,.3); }
      #volumeValue { color:#FFD700; font-size:11px; font-weight:700; font-family:"Cairo",sans-serif; }
    `;
    const style = document.createElement("style");
    style.id = "sfxVolumeStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureAudioControls() {
    if (document.getElementById("volumeSlider")) return;
    ensureAudioStyles();
    const wrap = document.createElement("div");
    wrap.className = "audio-controls";
    wrap.innerHTML = `
      <div class="audio-toggle" id="audioToggle"><span id="audioIcon">🔊</span></div>
      <div class="volume-slider-container">
        <input type="range" id="volumeSlider" min="0" max="100" value="${SFX.settings.volume}">
        <span id="volumeValue">${SFX.settings.volume}%</span>
      </div>
    `;
    document.body.appendChild(wrap);
    const slider = wrap.querySelector("#volumeSlider");
    const value = wrap.querySelector("#volumeValue");
    const toggle = wrap.querySelector("#audioToggle");
    const icon = wrap.querySelector("#audioIcon");

    function refreshIcon() {
      toggle.classList.toggle("muted", !!SFX.settings.muted);
      icon.textContent =
        SFX.settings.muted || SFX.settings.volume === 0
          ? "🔇"
          : SFX.settings.volume < 40
          ? "🔈"
          : SFX.settings.volume < 75
          ? "🔉"
          : "🔊";
      value.textContent = `${SFX.settings.volume}%`;
      slider.value = String(SFX.settings.volume);
    }

    slider.addEventListener("input", (e) => {
      const v = Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)));
      SFX.settings.volume = v;
      SFX.settings.muted = v === 0;
      localStorage.setItem("sfx:volume", String(v));
      localStorage.setItem("sfx:muted", SFX.settings.muted ? "1" : "0");
      applySettingsToAudio();
      refreshIcon();
    });

    toggle.addEventListener("click", () => {
      SFX.settings.muted = !SFX.settings.muted;
      localStorage.setItem("sfx:muted", SFX.settings.muted ? "1" : "0");
      applySettingsToAudio();
      refreshIcon();
    });

    refreshIcon();
  }

  // 🚿 Reset queue + stop current audio when changing rounds
  function resetForNewRound() {
    // stop anything currently playing
    try { SFX.audio.pause(); } catch {}
    SFX.audio.onended = null;
    SFX.audio.onerror = null;
    SFX.audio.src = "";
    SFX.playing = false;

    // clear any queued sounds from the previous round
    SFX.queue.length = 0;

    // clear per-round collections
    SFX.currentRound = [];
    SFX.perSide = { left: [], right: [] };
  }

  window.WebmSfx = {
    attachToMedia,
    markSide,
    setVolume: (p) => { /* unchanged, keep same */ },
    toggleMute: () => { /* unchanged */ },
    _load: () =>
      fetch("/sounds/webm-sfx.json")
        .then((r) => r.json())
        .then((j) => (SFX.map = j || {}))
        .catch(() => (SFX.map = {})),
    _ensureReplayButtons: ensureReplayButtons,
    _ensureAudioControls: ensureAudioControls,
    _resetForNewRound: resetForNewRound, // 👈 new
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.WebmSfx
      ._load()
      .then(() => {
        window.WebmSfx._ensureReplayButtons();
        window.WebmSfx._ensureAudioControls();
      })
      .catch(() => {
        window.WebmSfx._ensureReplayButtons();
        window.WebmSfx._ensureAudioControls();
      });
  });
})();
