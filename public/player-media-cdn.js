(() => {
  "use strict";

  // QG14 media is served directly from jsDelivr. The game/backend may still
  // live behind Cloudflare Tunnel, but PNG/WEBM/MP4 never need to pass through
  // the host PC unless the CDN copy is missing.
  const REPO = "AkaiQ14/card";
  const VERSION = "main"; // Pin this to a release tag (e.g. v1.0.8) for production.
  const CDN_ROOT = `https://cdn.jsdelivr.net/gh/${REPO}@${VERSION}/public`;
  const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/${VERSION}/public`;

  const state = new WeakMap();

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function normalizeSlashes(value) {
    return String(value || "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  }

  function encodePath(pathname) {
    return String(pathname || "")
      .split("/")
      .map((part, i) => (i === 0 && part === "") ? "" : encodeURIComponent(safeDecode(part)))
      .join("/");
  }

  function extractAsset(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return null;

    let pathname = "";
    let suffix = "";
    try {
      const u = new URL(raw.replace(/\\/g, "/"), location.href);
      pathname = u.pathname || "";
      suffix = (u.search || "") + (u.hash || "");
    } catch {
      let plain = raw.replace(/\\/g, "/");
      const m = plain.match(/([?#].*)$/);
      if (m) { suffix = m[1]; plain = plain.slice(0, -suffix.length); }
      pathname = plain;
    }

    pathname = normalizeSlashes(pathname);
    let lower = pathname.toLowerCase();

    let idx = lower.lastIndexOf("/public/anime/images/");
    if (idx >= 0) pathname = pathname.slice(idx + "/public".length);
    else {
      idx = lower.lastIndexOf("/public/images/");
      if (idx >= 0) pathname = pathname.slice(idx + "/public".length);
    }

    pathname = normalizeSlashes(pathname);
    lower = pathname.toLowerCase();

    const animeIndex = lower.lastIndexOf("/anime/images/");
    if (animeIndex >= 0) pathname = pathname.slice(animeIndex);
    else {
      const imagesIndex = lower.lastIndexOf("/images/");
      if (imagesIndex >= 0) pathname = pathname.slice(imagesIndex);
      else return null;
    }

    pathname = normalizeSlashes(pathname);
    if (!pathname.startsWith("/")) pathname = "/" + pathname;

    if (location.pathname.startsWith("/anime/") && pathname.startsWith("/images/")) {
      pathname = "/anime" + pathname;
    }

    return { path: pathname, encodedPath: encodePath(pathname), suffix };
  }

  function url(value, options = {}) {
    const asset = extractAsset(value);
    if (!asset) return String(value || "");
    if (options.local) return asset.path + asset.suffix;
    return CDN_ROOT + asset.encodedPath + asset.suffix;
  }

  function rawUrl(value) {
    const asset = extractAsset(value);
    return asset ? RAW_ROOT + asset.encodedPath + asset.suffix : String(value || "");
  }

  function manifestUrl(scope) {
    const name = String(scope || "").toLowerCase() === "anime"
      ? "anime/media-manifest.json"
      : "media-manifest.json";
    return `${CDN_ROOT}/${name}`;
  }

  function installLocalFallback(el, originalValue) {
    const cdn = url(originalValue);
    const local = url(originalValue, { local: true });
    if (!cdn || !local || cdn === local) return;

    let info = state.get(el);
    if (!info) {
      info = { tried: false, original: String(originalValue || "") };
      state.set(el, info);
      el.addEventListener("error", () => {
        const current = state.get(el);
        if (!current || current.tried) return;
        current.tried = true;
        try { el.src = local; } catch {}
      }, { once: true });
    }
    try { el.src = cdn; } catch {}
  }

  // Optional compatibility layer: old code may still assign /images/... directly.
  // We rewrite it once to CDN and only fall back to the local URL after a CDN error.
  function patchSrcProperty(proto) {
    if (!proto) return;
    const d = Object.getOwnPropertyDescriptor(proto, "src");
    if (!d || typeof d.set !== "function" || !d.configurable) return;
    const nativeSet = d.set;
    const nativeGet = d.get;
    Object.defineProperty(proto, "src", {
      configurable: d.configurable,
      enumerable: d.enumerable,
      get: nativeGet ? function () { return nativeGet.call(this); } : undefined,
      set: function (value) {
        const asset = extractAsset(value);
        if (!asset || /^https?:\/\//i.test(String(value || ""))) {
          nativeSet.call(this, value);
          return;
        }
        const cdn = url(value);
        const local = asset.path + asset.suffix;
        nativeSet.call(this, cdn);
        let info = state.get(this);
        if (!info) {
          info = { tried: false };
          state.set(this, info);
          this.addEventListener("error", () => {
            const current = state.get(this);
            if (!current || current.tried) return;
            current.tried = true;
            nativeSet.call(this, local);
            try { if (this instanceof HTMLMediaElement) this.load(); } catch {}
          }, { once: true });
        }
      }
    });
  }

  patchSrcProperty(typeof HTMLImageElement !== "undefined" ? HTMLImageElement.prototype : null);
  patchSrcProperty(typeof HTMLMediaElement !== "undefined" ? HTMLMediaElement.prototype : null);
  patchSrcProperty(typeof HTMLSourceElement !== "undefined" ? HTMLSourceElement.prototype : null);

  window.QG14PlayerMedia = Object.freeze({
    enabled: true,
    repo: REPO,
    version: VERSION,
    mode: "jsdelivr-direct",
    url,
    rawUrl,
    manifestUrl,
    asset: extractAsset,
    cdnRoot: CDN_ROOT,
  });

  console.info(`[QG14 Media] direct jsDelivr CDN (${REPO}@${VERSION})`);
})();
