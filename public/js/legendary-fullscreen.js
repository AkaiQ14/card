(() => {
  "use strict";

  const FEATURE_ID = "legendaryFullscreenFx";
  const VIDEO_ID = "legendaryFullscreenVideo";
  const STYLE_ID = "legendaryFullscreenStyles";
  const REPLAY_LEFT_ID = "legendaryFullscreenReplayLeft";
  const REPLAY_RIGHT_ID = "legendaryFullscreenReplayRight";
  const CHECK_INTERVAL_MS = 500;
  const THANOS_STEM = "thanos";
  const THANOS_HIDDEN_CLASS = "legendary-thanos-awaiting-fullscreen";

  const state = {
    effectsLoaded: false,
    effectsByStem: new Map(),
    lastSignature: "",
    currentRoundKey: "",
    currentMatches: { left: null, right: null },
    queue: [],
    queueToken: 0,
    manualPlayback: false,
    currentAutoMatch: null,
    thanosCompleted: new Set(),
    thanosFinishTimer: null,
    thanosHardReleaseTimer: null,
    thanosFinishToken: 0,
    heldCards: new Map(),
    syncScheduled: false,
  };

  function isAnimeScope() {
    return window.location.pathname.startsWith("/anime/");
  }

  function normalizePath(value) {
    if (!value) return "";
    try {
      return decodeURIComponent(new URL(String(value), window.location.href).pathname)
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/");
    } catch {
      try {
        return decodeURIComponent(String(value))
          .split(/[?#]/, 1)[0]
          .replace(/\\/g, "/")
          .replace(/\/{2,}/g, "/");
      } catch {
        return String(value)
          .split(/[?#]/, 1)[0]
          .replace(/\\/g, "/")
          .replace(/\/{2,}/g, "/");
      }
    }
  }

  function stemFromFilename(filename) {
    return String(filename || "")
      .replace(/\.[^.]+$/, "")
      .trim()
      .toLowerCase();
  }

  function legendaryCardInfo(url) {
    const path = normalizePath(url);
    if (!path) return null;

    // Works for both:
    // /images/legendary/X.ext
    // /anime/images/legendary/X.ext
    const match = path.match(/\/images\/legendary\/([^/]+)$/i);
    if (!match) return null;

    const filename = match[1];
    const stem = stemFromFilename(filename);
    if (!stem) return null;

    return { url, path, filename, stem };
  }

  function readGameState() {
    const player1 = localStorage.getItem("player1") || "لاعب 1";
    const player2 = localStorage.getItem("player2") || "لاعب 2";
    const round = Math.max(0, parseInt(localStorage.getItem("currentRound") || "0", 10) || 0);

    let picks = {};
    try {
      const parsed = JSON.parse(localStorage.getItem("picks") || "{}");
      if (parsed && typeof parsed === "object") picks = parsed;
    } catch {}

    return {
      player1,
      player2,
      round,
      leftUrl: Array.isArray(picks[player2]) ? picks[player2][round] : null,
      rightUrl: Array.isArray(picks[player1]) ? picks[player1][round] : null,
    };
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${FEATURE_ID} {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: none;
        overflow: hidden;
        pointer-events: none;
        background: transparent;
      }
      #${FEATURE_ID}.is-active { display: block; }
      #${VIDEO_ID} {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        background: transparent;
        opacity: 1;
      }
      .legendary-fullscreen-replay {
        position: fixed !important;
        /* Same stacking layer as the normal replay/sound buttons.
           The fullscreen overlay (z-index: 9999) stays above it. */
        z-index: 1200 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        background: #dc2626 !important;
        border-color: #ef4444 !important;
        color: #fff !important;
        min-height: 42px;
        white-space: nowrap;
      }
      .legendary-fullscreen-replay.is-visible {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .legendary-fullscreen-replay:hover {
        background: #b91c1c !important;
      }
      .${THANOS_HIDDEN_CLASS} {
        visibility: hidden !important;
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    ensureStyles();

    let overlay = document.getElementById(FEATURE_ID);
    let video = document.getElementById(VIDEO_ID);

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = FEATURE_ID;
      overlay.setAttribute("aria-hidden", "true");

      video = document.createElement("video");
      video.id = VIDEO_ID;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";

      overlay.appendChild(video);
      document.body.appendChild(overlay);
    }

    return { overlay, video };
  }

  function soundButton(side) {
    return document.getElementById(side === "left" ? "sfxReplayLeft" : "sfxReplayRight");
  }

  function replayButtonId(side) {
    return side === "left" ? REPLAY_LEFT_ID : REPLAY_RIGHT_ID;
  }

  function ensureReplayButton(side) {
    let button = document.getElementById(replayButtonId(side));
    if (button) return button;

    button = document.createElement("button");
    button.id = replayButtonId(side);
    button.type = "button";
    button.className = "btn-gold px-4 py-2 text-sm flex items-center gap-2 shadow-none legendary-fullscreen-replay";
    button.textContent = "إعادة";
    button.setAttribute("aria-hidden", "true");
    button.dataset.side = side;
    button.addEventListener("click", () => replayForSide(side));
    document.body.appendChild(button);
    return button;
  }

  function positionReplayButton(side) {
    const button = ensureReplayButton(side);
    const sound = soundButton(side);
    if (!button || !sound) return;

    const rect = sound.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    button.style.left = `${Math.round(rect.left)}px`;
    button.style.right = "auto";
    button.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
    button.style.width = `${Math.round(rect.width)}px`;
  }

  function setReplayVisible(side, visible) {
    const button = ensureReplayButton(side);
    if (!button) return;

    if (visible) {
      button.classList.add("is-visible");
      button.setAttribute("aria-hidden", "false");
      positionReplayButton(side);
    } else {
      button.classList.remove("is-visible");
      button.setAttribute("aria-hidden", "true");
    }
  }

  function sideRoot(side) {
    const vsRow = document.getElementById("vsRow");
    if (!vsRow) return null;
    const children = Array.from(vsRow.children || []);
    if (!children.length) return null;
    return side === "left" ? children[0] : children[children.length - 1];
  }

  function cardUrlForSide(game, side) {
    return side === "left" ? game?.leftUrl : game?.rightUrl;
  }

  function thanosRoundKey(game, side, cardInfo) {
    return `${game?.round ?? 0}|${side}|${String(cardInfo?.path || cardInfo?.url || "")}`;
  }

  function revealMediaElement(media) {
    if (!media) return;
    media.classList.remove(THANOS_HIDDEN_CLASS);
    media.style.visibility = "";
    media.style.opacity = "";
    media.style.pointerEvents = "";
    media.dataset.legendaryFullscreenRevealComplete = "1";
  }

  function holdCard(media, cardUrl, side) {
    const card = legendaryCardInfo(cardUrl);
    if (!media || !card || card.stem !== THANOS_STEM) return false;

    const game = readGameState();
    const roundKey = thanosRoundKey(game, side, card);

    media.dataset.legendaryFullscreenDelayed = THANOS_STEM;
    media.dataset.legendaryFullscreenSide = side || "";
    media.dataset.legendaryFullscreenRoundKey = roundKey;

    // If this exact Thanos round already finished, a re-render must NOT hide it again.
    if (state.thanosCompleted.has(roundKey)) {
      revealMediaElement(media);
      state.heldCards.delete(side);
      return true;
    }

    media.classList.add(THANOS_HIDDEN_CLASS);
    media.style.visibility = "hidden";
    media.style.opacity = "0";
    media.style.pointerEvents = "none";

    // Keep the exact DOM element. Do not search for it again after the 61s clip.
    state.heldCards.set(side, { media, side, card, roundKey });
    return true;
  }

  function releaseHeldCard(side, expectedStem = THANOS_STEM) {
    const held = state.heldCards.get(side);
    if (!held || held.card?.stem !== expectedStem) return false;

    state.thanosCompleted.add(held.roundKey);
    revealMediaElement(held.media);
    state.heldCards.delete(side);
    return true;
  }

  function releaseAllHeldThanos() {
    ["left", "right"].forEach((side) => releaseHeldCard(side, THANOS_STEM));
  }

  function scheduleSync() {
    if (state.syncScheduled) return;
    state.syncScheduled = true;

    requestAnimationFrame(() => {
      state.syncScheduled = false;
      sync();
    });
  }

  // Public bridge used by result.js. The fullscreen manager owns the exact
  // element reference from creation until release, so the card cannot get lost
  // because of DOM re-renders/querySelector timing.
  window.LegendaryFullscreen = Object.assign(window.LegendaryFullscreen || {}, {
    holdCard,
    releaseCard: releaseHeldCard,
    releaseAllThanos: releaseAllHeldThanos,
    refresh: scheduleSync,
  });

  function cardMediaElement(side, cardInfo) {
    const root = sideRoot(side);
    if (!root) return null;

    // result.js marks Thanos BEFORE inserting it into the page. Prefer that
    // explicit marker instead of guessing from currentSrc/render timing.
    const delayed = root.querySelector('[data-legendary-fullscreen-delayed="thanos"]');
    if (delayed) return delayed;

    const media = Array.from(root.querySelectorAll("video, img"));
    if (!media.length) return null;

    const target = normalizePath(cardInfo?.url || cardInfo?.path || "").toLowerCase();
    if (target) {
      const exact = media.find((el) => {
        const src = normalizePath(el.currentSrc || el.getAttribute("src") || el.src || "").toLowerCase();
        return src === target;
      });
      if (exact) return exact;
    }

    return media[0] || null;
  }

  function clearThanosHiddenOnSide(side) {
    // Prefer the exact element reference registered by result.js.
    if (releaseHeldCard(side, THANOS_STEM)) return;

    const root = sideRoot(side);
    if (!root) return;
    root.querySelectorAll(`.${THANOS_HIDDEN_CLASS}, [data-legendary-fullscreen-delayed="thanos"]`).forEach((el) => {
      revealMediaElement(el);
    });
  }

  function setThanosCardHidden(side, cardInfo, hidden) {
    if (!cardInfo || cardInfo.stem !== THANOS_STEM) {
      clearThanosHiddenOnSide(side);
      return;
    }

    if (!hidden) {
      if (releaseHeldCard(side, THANOS_STEM)) return;
      const media = cardMediaElement(side, cardInfo);
      revealMediaElement(media);
      return;
    }

    // If result.js already registered the exact element, keep that element hidden.
    const held = state.heldCards.get(side);
    if (held?.media) {
      held.media.classList.add(THANOS_HIDDEN_CLASS);
      held.media.style.visibility = "hidden";
      held.media.style.opacity = "0";
      held.media.style.pointerEvents = "none";
      return;
    }

    // Fallback for older result.js versions.
    const media = cardMediaElement(side, cardInfo);
    if (media) holdCard(media, cardInfo.url || cardInfo.path, side);
  }

  // Runs even before the fullscreen file list has finished loading.
  // Because the MutationObserver fires before the next paint, this keeps
  // Thanos from flashing briefly underneath the transparent fullscreen clip.
  function preHidePendingThanosCards() {
    const game = readGameState();

    ["left", "right"].forEach((side) => {
      const card = legendaryCardInfo(cardUrlForSide(game, side));
      if (!card || card.stem !== THANOS_STEM) {
        clearThanosHiddenOnSide(side);
        return;
      }

      const key = thanosRoundKey(game, side, card);
      setThanosCardHidden(side, card, !state.thanosCompleted.has(key));
    });
  }

  function revealThanosMatch(match) {
    if (!match?.card || match.card.stem !== THANOS_STEM) return;

    // Primary path: release the exact element saved when result.js created it.
    if (releaseHeldCard(match.side, THANOS_STEM)) return;

    // Fallback for a legacy page that did not register the element reference.
    const game = readGameState();
    const key = thanosRoundKey(game, match.side, match.card);
    state.thanosCompleted.add(key);
    const media = cardMediaElement(match.side, match.card);
    revealMediaElement(media);
  }

  function syncThanosVisibility(game, left, right) {
    const bySide = { left, right };

    ["left", "right"].forEach((side) => {
      const card = legendaryCardInfo(cardUrlForSide(game, side));
      if (!card || card.stem !== THANOS_STEM) {
        clearThanosHiddenOnSide(side);
        return;
      }

      const key = thanosRoundKey(game, side, card);
      const hasFullscreen = !!bySide[side]?.effect;
      const shouldHide = hasFullscreen && !state.thanosCompleted.has(key);
      setThanosCardHidden(side, card, shouldHide);
    });
  }

  function clearThanosFinishWatch() {
    state.thanosFinishToken += 1;
    if (state.thanosFinishTimer) {
      clearTimeout(state.thanosFinishTimer);
      state.thanosFinishTimer = null;
    }
    if (state.thanosHardReleaseTimer) {
      clearTimeout(state.thanosHardReleaseTimer);
      state.thanosHardReleaseTimer = null;
    }
  }

  function finishAutomaticEffect(match, { forceStop = false } = {}) {
    if (!match || state.manualPlayback || state.currentAutoMatch !== match) return false;

    clearThanosFinishWatch();

    // Reveal Thanos before we clear the active auto-match reference.
    revealThanosMatch(match);
    state.currentAutoMatch = null;

    const { overlay, video } = ensureOverlay();
    if (forceStop) {
      try { video.pause(); } catch {}
    }
    overlay.classList.remove("is-active");
    overlay.setAttribute("aria-hidden", "true");

    if (state.queue.length) {
      const token = state.queueToken;
      playNextQueuedEffect(token);
    }
    return true;
  }

  function armThanosFinishWatch(match) {
    clearThanosFinishWatch();
    if (!match?.card || match.card.stem !== THANOS_STEM || state.manualPlayback) return;

    const { video } = ensureOverlay();
    const watchToken = state.thanosFinishToken;

    const check = () => {
      if (
        watchToken !== state.thanosFinishToken ||
        state.manualPlayback ||
        state.currentAutoMatch !== match
      ) return;

      const current = Number(video.currentTime) || 0;
      const duration = Number(video.duration);
      const hasDuration = Number.isFinite(duration) && duration > 0;

      // Normal path: use the real duration when the browser exposes it.
      // Fallback path: Thanos' fullscreen clip is 1:01, so 60.9s is
      // considered its visual end if the browser fails to dispatch `ended`.
      const reachedVisualEnd = hasDuration
        ? current >= Math.max(0, duration - 0.10)
        : current >= 60.90;

      if (video.ended || reachedVisualEnd) {
        // A tiny delay ensures the final fullscreen frame has actually passed
        // before the hidden Thanos card is revealed underneath it.
        state.thanosFinishTimer = setTimeout(() => {
          if (
            watchToken !== state.thanosFinishToken ||
            state.manualPlayback ||
            state.currentAutoMatch !== match
          ) return;
          finishAutomaticEffect(match, { forceStop: true });
        }, 140);
        return;
      }

      // Check near the end frequently, but avoid a heavy interval for the
      // whole 61-second clip.
      let delay = 500;
      if (hasDuration) {
        const remainingMs = Math.max(0, (duration - current) * 1000);
        delay = Math.max(120, Math.min(750, remainingMs > 3000 ? 750 : 200));
      } else if (current >= 58) {
        delay = 180;
      }
      state.thanosFinishTimer = setTimeout(check, delay);
    };

    // Start only after playback has begun. currentTime makes this immune to
    // initial buffering and avoids revealing the card too early.
    state.thanosFinishTimer = setTimeout(check, 250);

    // Absolute safety net for Thanos. The known fullscreen clip is ~1:01.
    // This timer does NOT search the DOM and does NOT depend on media events;
    // it releases the exact card element held in memory. It starts from the
    // video's `playing` state, so normal initial loading time is not counted.
    const armHardRelease = () => {
      if (
        watchToken !== state.thanosFinishToken ||
        state.manualPlayback ||
        state.currentAutoMatch !== match
      ) return;

      if (state.thanosHardReleaseTimer) {
        clearTimeout(state.thanosHardReleaseTimer);
      }

      state.thanosHardReleaseTimer = setTimeout(() => {
        if (
          watchToken !== state.thanosFinishToken ||
          state.manualPlayback ||
          state.currentAutoMatch !== match
        ) return;
        finishAutomaticEffect(match, { forceStop: true });
      }, 62000);
    };

    if (!video.paused && (Number(video.currentTime) || 0) > 0) {
      armHardRelease();
    } else {
      video.addEventListener("playing", armHardRelease, { once: true });
    }
  }

  function stopOverlay() {
    clearThanosFinishWatch();
    const { overlay, video } = ensureOverlay();
    try {
      video.pause();
      video.currentTime = 0;
    } catch {}
    overlay.classList.remove("is-active");
    overlay.setAttribute("aria-hidden", "true");
  }

  function playEffect(effect, { manual = false } = {}) {
    if (!effect || !effect.url) return false;

    const { overlay, video } = ensureOverlay();
    state.manualPlayback = manual;

    try {
      video.pause();
      video.currentTime = 0;
    } catch {}

    if (video.getAttribute("src") !== effect.url) {
      video.src = effect.url;
    }

    overlay.classList.add("is-active");
    overlay.setAttribute("aria-hidden", "false");

    const promise = video.play();

    // Arm the Thanos completion watcher immediately. It reads currentTime, so
    // buffering does not count toward the 1:01 clip duration. This also works
    // in browsers where HTMLMediaElement.play() does not return a Promise.
    if (!manual && state.currentAutoMatch) {
      armThanosFinishWatch(state.currentAutoMatch);
    }

    if (promise && typeof promise.then === "function") {
      promise.catch(() => {
        overlay.classList.remove("is-active");
        overlay.setAttribute("aria-hidden", "true");

        // Never leave Thanos hidden if autoplay is blocked or the clip fails.
        if (!manual && state.currentAutoMatch) {
          revealThanosMatch(state.currentAutoMatch);
          state.currentAutoMatch = null;
          if (state.queue.length) {
            const token = state.queueToken;
            playNextQueuedEffect(token);
          }
        }
      });
    }

    return true;
  }

  function playNextQueuedEffect(token) {
    if (token !== state.queueToken) return;

    clearThanosFinishWatch();
    const next = state.queue.shift();
    if (!next) {
      state.currentAutoMatch = null;
      stopOverlay();
      return;
    }

    state.currentAutoMatch = next;
    state.manualPlayback = false;
    playEffect(next.effect, { manual: false });
  }

  function startAutomaticQueue(matches, signature) {
    state.queueToken += 1;
    const token = state.queueToken;
    state.queue = matches.slice();
    state.currentAutoMatch = null;
    state.lastSignature = signature;
    playNextQueuedEffect(token);
  }

  function replayCardSound(side) {
    if (window.WebmSfx && typeof window.WebmSfx.replaySide === "function") {
      if (window.WebmSfx.replaySide(side)) return;
    }

    const sound = soundButton(side);
    if (sound) sound.click();
  }

  function replayForSide(side) {
    const current = state.currentMatches[side];
    if (!current || !current.effect) return;

    clearThanosFinishWatch();
    state.queueToken += 1;
    state.queue = [];
    state.currentAutoMatch = null;
    playEffect(current.effect, { manual: true });
    replayCardSound(side);
  }

  function matchingEffect(cardInfo) {
    if (!cardInfo) return null;
    return state.effectsByStem.get(cardInfo.stem) || null;
  }

  function currentMatches() {
    const game = readGameState();
    const leftCard = legendaryCardInfo(game.leftUrl);
    const rightCard = legendaryCardInfo(game.rightUrl);

    const leftEffect = matchingEffect(leftCard);
    const rightEffect = matchingEffect(rightCard);

    const left = leftCard && leftEffect
      ? { side: "left", card: leftCard, effect: leftEffect }
      : null;

    const right = rightCard && rightEffect
      ? { side: "right", card: rightCard, effect: rightEffect }
      : null;

    return { game, left, right };
  }

  function sync() {
    preHidePendingThanosCards();
    if (!state.effectsLoaded) return;

    const { game, left, right } = currentMatches();
    state.currentMatches.left = left;
    state.currentMatches.right = right;
    syncThanosVisibility(game, left, right);

    setReplayVisible("left", !!left);
    setReplayVisible("right", !!right);

    if (left) positionReplayButton("left");
    if (right) positionReplayButton("right");

    const roundKey = `${game.round}|${String(game.leftUrl || "")}|${String(game.rightUrl || "")}`;
    const matches = [left, right].filter(Boolean);
    const signature = `${roundKey}|${matches.map((m) => `${m.side}:${m.effect.url}`).join("|")}`;

    if (!matches.length) {
      if (state.currentRoundKey !== roundKey || state.lastSignature) {
        state.queueToken += 1;
        state.queue = [];
        state.currentAutoMatch = null;
        state.lastSignature = "";
        stopOverlay();
      }
      state.currentRoundKey = roundKey;
      return;
    }

    state.currentRoundKey = roundKey;
    if (state.lastSignature === signature) return;

    startAutomaticQueue(matches, signature);
  }

  async function loadEffects() {
    const scope = isAnimeScope() ? "anime" : "all";

    try {
      const response = await fetch(`/list-fullscreen?scope=${encodeURIComponent(scope)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      const files = Array.isArray(payload) ? payload : payload?.files;

      state.effectsByStem.clear();
      (Array.isArray(files) ? files : []).forEach((file) => {
        const name = typeof file === "string" ? file : file?.name;
        const url = typeof file === "string"
          ? `/images/fullscreen/${encodeURIComponent(file)}`
          : file?.url;
        const stem = stemFromFilename(typeof file === "string" ? file : (file?.stem || name));

        if (!stem || !url || state.effectsByStem.has(stem)) return;
        state.effectsByStem.set(stem, { name, stem, url });
      });
    } catch (error) {
      console.warn("[legendary-fullscreen] Could not load fullscreen list:", error?.message || error);
      state.effectsByStem.clear();
    }

    state.effectsLoaded = true;
    sync();
  }

  function init() {
    ensureOverlay();
    ensureReplayButton("left");
    ensureReplayButton("right");

    const { video } = ensureOverlay();
    if (!video.dataset.legendaryFullscreenWired) {
      video.dataset.legendaryFullscreenWired = "1";
      video.addEventListener("ended", () => {
        const finishedAutoMatch = !state.manualPlayback ? state.currentAutoMatch : null;
        if (finishedAutoMatch) {
          finishAutomaticEffect(finishedAutoMatch);
          return;
        }

        const overlay = document.getElementById(FEATURE_ID);
        if (overlay) {
          overlay.classList.remove("is-active");
          overlay.setAttribute("aria-hidden", "true");
        }
      });

      video.addEventListener("timeupdate", () => {
        const match = !state.manualPlayback ? state.currentAutoMatch : null;
        if (!match?.card || match.card.stem !== THANOS_STEM) return;

        const duration = Number(video.duration);
        const current = Number(video.currentTime) || 0;
        const reachedEnd = Number.isFinite(duration) && duration > 0
          ? current >= Math.max(0, duration - 0.08)
          : current >= 60.92;

        if (reachedEnd) {
          // This catches browsers/WebM files that visually finish but do not
          // reliably emit `ended` at 1:01.
          setTimeout(() => {
            if (!state.manualPlayback && state.currentAutoMatch === match) {
              finishAutomaticEffect(match, { forceStop: true });
            }
          }, 120);
        }
      });

      video.addEventListener("error", () => {
        clearThanosFinishWatch();
        const failedAutoMatch = !state.manualPlayback ? state.currentAutoMatch : null;
        if (failedAutoMatch) {
          // A missing/broken fullscreen clip must never leave Thanos hidden.
          revealThanosMatch(failedAutoMatch);
          state.currentAutoMatch = null;
        }

        const overlay = document.getElementById(FEATURE_ID);
        if (overlay) {
          overlay.classList.remove("is-active");
          overlay.setAttribute("aria-hidden", "true");
        }

        if (!state.manualPlayback && state.queue.length) {
          const token = state.queueToken;
          playNextQueuedEffect(token);
        }
      });
    }

    const overlay = document.getElementById(FEATURE_ID);
    if (overlay && !overlay.dataset.thanosReleaseObserved) {
      overlay.dataset.thanosReleaseObserved = "1";
      const overlayObserver = new MutationObserver(() => {
        // If automatic Thanos playback has been finalized and the overlay is no
        // longer active, make sure no held Thanos card can remain invisible.
        if (overlay.classList.contains("is-active")) return;
        if (state.manualPlayback) return;
        if (state.currentAutoMatch?.card?.stem === THANOS_STEM) return;
        releaseAllHeldThanos();
      });
      overlayObserver.observe(overlay, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
    }

    const vsRow = document.getElementById("vsRow");
    if (vsRow && !vsRow.dataset.legendaryFullscreenObserved) {
      vsRow.dataset.legendaryFullscreenObserved = "1";
      const observer = new MutationObserver(() => {
        // IMPORTANT: watch DOM structure only. Watching attributes here caused
        // an infinite loop because hiding Thanos changes style/class attributes,
        // which retriggered this observer continuously.
        scheduleSync();
      });
      observer.observe(vsRow, { childList: true, subtree: true });
    }

    window.addEventListener("resize", () => {
      if (state.currentMatches.left) positionReplayButton("left");
      if (state.currentMatches.right) positionReplayButton("right");
    });

    preHidePendingThanosCards();

    // Keeps the feature in sync even if a mode updates the round without
    // producing a mutation that our observer can see.
    setInterval(sync, CHECK_INTERVAL_MS);

    loadEffects();
  }

  init();
})();