const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const {
  readLeaderboardFromFirebase,
  writeLeaderboardToFirebase,
  readAbilitiesFromFirebase,
  writeAbilitiesToFirebase,
} = require("./firebase-service");
const { createUpdateService } = require("./updater-service");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== Configuration ======
const PORT = process.env.PORT || 3000;

// In packaged builds, public assets live in resources/public. Do not create
// a junction/symlink inside Program Files; use the real public root directly.
const PUBLIC_ROOT = process.env.QG14_PUBLIC_ROOT || path.join(__dirname, "public");

// ===== Legendary Rate Controller =====
function getLegendaryRate() {
  const base = parseFloat(process.env.LEGENDARY_RATE || "0.1");

  if (isNaN(base)) return 0.1;

  return Math.max(0, Math.min(1, base));
}

function normalizeCardScope(scope) {
  return String(scope || "").toLowerCase() === "anime" ? "anime" : "all";
}

function getCardAssets(scope) {
  const cardScope = normalizeCardScope(scope);
  const scopeDirectory = cardScope === "anime" ? "anime" : "";
  const urlPrefix = cardScope === "anime" ? "/anime" : "";

  return {
    cardScope,
    imageRoot: path.join(PUBLIC_ROOT, scopeDirectory, "images"),
    imageUrlBase: `${urlPrefix}/images`,
  };
}


// GitHub updater service. desktop-main.js sets the QG14_* environment before
// loading index.js, so the packaged desktop build gets the real writable roots.
const updateService = createUpdateService({
  owner: process.env.QG14_UPDATE_OWNER || "AkaiQ14",
  repo: process.env.QG14_UPDATE_REPO || "card",
  branch: process.env.QG14_UPDATE_BRANCH || "main",
  appVersion: process.env.QG14_APP_VERSION || "1.0.0",
  statePath: process.env.QG14_ASSET_STATE_PATH,
  directPublicRoot: process.env.QG14_DIRECT_PUBLIC_ROOT,
  directRuntimeRoot: process.env.QG14_DIRECT_RUNTIME_ROOT,
  directDefaultsRoot: process.env.QG14_DIRECT_DEFAULTS_ROOT,
  deletionStatePath: process.env.QG14_UPDATE_DELETIONS_PATH,
  allowAssetApply: String(process.env.QG14_ALLOW_ASSET_UPDATE || "false").toLowerCase() === "true",
  buildKind: process.env.QG14_BUILD_KIND || "development",
});

// Tell Express it's behind Render's proxy (so req.secure & secure cookies work)
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ===== Server-side IP allowlist + exempt paths + socket toggle =====
const ALLOWED_IPV4S = (process.env.ALLOWED_IPV4S || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const EXEMPT_PATHS = (process.env.EXEMPT_PATHS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// If true, sockets skip IP gating (lets public pages use sockets)
const SOCKET_ALLOW_PUBLIC = String(process.env.SOCKET_ALLOW_PUBLIC || "false").toLowerCase() === "true";

// Basic matcher: supports exact match and prefix* (single wildcard at end)
function pathMatchesPattern(urlPath, pattern) {
  if (!pattern) return false;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return urlPath.startsWith(prefix);
  }
  return urlPath === pattern;
}
function isExempt(req) {
  const urlPath = req.path || req.originalUrl || "/";
  return EXEMPT_PATHS.some(p => pathMatchesPattern(urlPath, p));
}
function getClientIPv4(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const fallback = (req.ip || req.socket?.remoteAddress || "").trim();
  const ip = (xff || fallback).replace(/^::ffff:/, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : "";
}

const FORBIDDEN_HTML = `
<!doctype html><meta charset="utf-8">
<title>Forbidden</title>
<style>
  html,body{height:100%;margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Cairo',sans-serif;background:#111827;color:#fff}
  .wrap{display:flex;align-items:center;justify-content:center;height:100%}
  .card{background:rgba(0,0,0,.5);border-radius:12px;padding:28px;text-align:center;max-width:560px}
  h1{margin:0 0 8px;font-size:22px}
</style>
<div class="wrap"><div class="card">
  <div style="font-size:56px;margin-bottom:14px">🚫</div>
  <h1>غير مصرح لك بالوصول</h1>
  <p>هذا الموقع متاح فقط للمضيفين المصرح لهم.</p>
</div></div>`;

function ipAllowlist(req, res, next) {
  if (isExempt(req)) return next(); // public path
  if (ALLOWED_IPV4S.length === 0) return next(); // open if no list configured

  const ip = getClientIPv4(req);
  const ok = ip && ALLOWED_IPV4S.includes(ip);
  if (!ok) {
    console.warn("[ip-block] denied", { ip, path: req.originalUrl });
    res.status(403).send(FORBIDDEN_HTML);
    return;
  }
  next();
}

// ===== Abilities storage (Local files + Firebase backup) =====
const ABILITIES_PATH = process.env.ABILITIES_PATH || path.join(__dirname, "abilities.json");

function ensureAbilitiesFile() {
  try {
    if (!fs.existsSync(ABILITIES_PATH)) {
      fs.writeFileSync(
        ABILITIES_PATH,
        JSON.stringify({ abilities: [] }, null, 2),
        "utf8"
      );
      console.log("[abilities] Created empty abilities.json");
    }
  } catch (e) {
    console.error("[abilities] init failed:", e.message);
  }
}

// قراءة من الملف المحلي (المصدر الرئيسي)
function readAbilitiesFile() {
  ensureAbilitiesFile();
  try {
    const exists = fs.existsSync(ABILITIES_PATH);
    if (!exists) return [];

    const raw = fs.readFileSync(ABILITIES_PATH, "utf8");
    let json;
    try { json = JSON.parse(raw); } catch { return []; }
    const arr = Array.isArray(json?.abilities) ? json.abilities : [];
    return arr.map(s => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ✨ Push files to private GitHub repo (Render env vars)
async function githubUpsertFile({ content, message, pathRel }) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const pathRelFinal = pathRel || process.env.GITHUB_FILE_PATH || "leaderboard.json";

  if (!token || !owner || !repo) {
    console.warn("[github] Missing env vars; skipping GitHub sync.");
    return;
  }

  const encodedPath = String(pathRelFinal)
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

  // 1) Get current file sha (if exists)
  let sha = null;
  try {
    const r = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "qg14-card-clash",
      },
    });
    if (r.ok) {
      const json = await r.json();
      sha = json.sha || null;
    }
  } catch (e) {
    console.warn("[github] get sha failed:", e.message);
  }

  // 2) Create/Update file
  const body = {
    message: message || `Update ${pathRelFinal} at ${new Date().toISOString()}`,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiBase, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "qg14-card-clash",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[github] ❌ PUT failed:", res.status, text);
  } else {
    const json = await res.json().catch(() => ({}));
    console.log("[github] ✅ Success! Commit SHA:", json.commit?.sha);
  }
}

async function writeAbilitiesFile(arr) {
  try {
    const clean = arr.map(s => String(s).trim()).filter(Boolean);
    const jsonStr = JSON.stringify({ abilities: clean }, null, 2);

    // حفظ في الملف المحلي (المصدر الرئيسي)
    fs.writeFileSync(ABILITIES_PATH, jsonStr, "utf8");

    // حفظ في Firebase كنسخة احتياطية (async - لا يمنع العمل إذا فشل)
    writeAbilitiesToFirebase(clean).catch((e) => {
      console.warn("[firebase] Failed to backup abilities to Firebase:", e.message);
    });

    return clean;
  } catch (e) {
    console.error("[abilities] write failed:", e.message);
    return null;
  }
}

// Ensure the abilities file exists at boot
ensureAbilitiesFile();

// ===== Leaderboard (Local files + Firebase backup) =====
const LEADERBOARD_PATH = path.join(__dirname, "leaderboard.json");

// قراءة من الملف المحلي (المصدر الرئيسي)
function readLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_PATH, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object" && json.players) return json;
  } catch {}
  return { players: {} };
}

async function writeLeaderboard(data) {
  try {
    const jsonStr = JSON.stringify(data, null, 2);

    // حفظ في الملف المحلي (المصدر الرئيسي)
    fs.writeFileSync(LEADERBOARD_PATH, jsonStr, "utf8");

    // حفظ في Firebase كنسخة احتياطية (async - لا يمنع العمل إذا فشل)
    writeLeaderboardToFirebase(data).catch((e) => {
      console.warn("[firebase] Failed to backup leaderboard to Firebase:", e.message);
    });
  } catch (e) {
    console.error("Failed saving leaderboard:", e.message);
  }
}
function upsertPlayer(lb, name) {
  if (!lb.players[name]) {
    lb.players[name] = {
      games: 0,
      wins: 0,
      losses: 0,
      points: 0,
      updatedAt: null,
    };
  }
  return lb.players[name];
}

// ====== Security headers (Helmet + custom CSP) ======
app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "sameorigin" },
    noSniff: true,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  })
);

// CSP tuned for current setup (Tailwind CDN + ipify endpoints + websockets)
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "'unsafe-inline'"],
      scriptSrcElem: ["'self'", "https://cdn.tailwindcss.com", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "data:"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "data:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'",
        "ws:",
        "wss:",
        "https://api.ipify.org",
        "https://ipv4.icanhazip.com",
        "https://v4.ident.me",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: [],
    },
  })
);

// Permissions-Policy
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), browsing-topics=()"
  );
  next();
});

// HTTPS redirect (Render terminates TLS; defense-in-depth)
app.use((req, res, next) => {
  const xfProto = req.headers["x-forwarded-proto"];
  if (req.secure || xfProto === "https" || req.hostname === "localhost" || req.hostname === "127.0.0.1") {
    return next();
  }
  return res.redirect(301, "https://" + req.headers.host + req.url);
});

// ====== Middleware ======
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Mount IP allowlist BEFORE static and routes
app.use(ipAllowlist);

// Tiny security utility endpoints (optionally exempt)
app.get("/api/security/ping", (req, res) => {
  res.json({ ok: true });
});
app.post("/api/security/verify", (req, res) => {
  const serverSeen = getClientIPv4(req);
  const allowed = ALLOWED_IPV4S.length === 0 || (serverSeen && ALLOWED_IPV4S.includes(serverSeen));
  res.json({
    allowed,
    serverSeenIP: serverSeen || null,
    reason: allowed ? "" : "هذا المحتوى متاح فقط لعناوين IP محددة.",
  });
});

// ===== GitHub Update API =====
// The home page calls these endpoints directly. They were previously missing,
// which made "التحقق من التحديثات" return HTTP 404/error even though the
// updater-service itself was present.
app.get("/api/updates/source", (req, res) => {
  const owner = process.env.QG14_UPDATE_OWNER || "AkaiQ14";
  const repo = process.env.QG14_UPDATE_REPO || "card";
  const branch = process.env.QG14_UPDATE_BRANCH || "main";
  res.json({
    ok: true,
    provider: "github",
    owner,
    repo,
    branch,
    api: `https://api.github.com/repos/${owner}/${repo}`,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`,
  });
});

app.get("/api/updates/check", async (req, res) => {
  try {
    const result = await updateService.check();
    res.json(result);
  } catch (err) {
    console.error("[updates] check failed:", err?.stack || err?.message || err);
    res.status(502).json({
      ok: false,
      error: String(err?.message || err || "Update check failed"),
    });
  }
});

app.post("/api/updates/files/apply", async (req, res) => {
  try {
    const result = await updateService.applyFiles();
    res.json(result);
  } catch (err) {
    console.error("[updates] apply failed:", err?.stack || err?.message || err);
    const status = err?.code === "UPDATE_DISABLED" ? 403 : 500;
    res.status(status).json({
      ok: false,
      code: err?.code || "UPDATE_FAILED",
      error: String(err?.message || err || "Update failed"),
    });
  }
});

// Lightweight polling endpoint so the UI can show real progress ("12/84 files")
// instead of a single static message while a large batch downloads.
app.get("/api/updates/files/progress", (req, res) => {
  const progress = typeof updateService.getProgress === "function"
    ? updateService.getProgress()
    : { active: false, phase: "idle", total: 0, done: 0, ok: 0, failed: 0, round: 0, currentPath: "" };
  res.json({ ok: true, ...progress });
});

app.post("/api/updates/restart", (req, res) => {
  if (process.env.QG14_DESKTOP !== "1") {
    return res.status(400).json({ ok: false, error: "Restart is available only in the desktop app." });
  }
  res.json({ ok: true, restarting: true });
  setTimeout(() => process.emit("qg14-update-restart"), 50);
});

// Safe Firebase diagnostic endpoint: never returns credentials or private key data.
// ===== Cloudflare player sharing API =====
// The desktop process starts the Quick Tunnel after the Express server is ready.
// Therefore this endpoint reads QG14_PLAYER_ORIGIN/QG14_SHARE_ORIGIN at request
// time, not only during server startup. This fixes the copy-player-link buttons.
app.post("/api/remote-link", (req, res) => {
  try {
    const origin = String(
      process.env.QG14_PLAYER_ORIGIN || process.env.QG14_SHARE_ORIGIN || ""
    ).trim().replace(/\/$/, "");

    if (!origin || !/^https:\/\//i.test(origin)) {
      return res.status(503).json({
        ok: false,
        code: "PLAYER_TUNNEL_NOT_READY",
        error: "Cloudflare player tunnel is not ready.",
      });
    }

    const route = String(req.body?.route || "").trim();
    if (!route || !route.startsWith("/")) {
      return res.status(400).json({ ok: false, code: "INVALID_ROUTE" });
    }

    const gameID = String(req.body?.gameID || "").trim();
    const playerKey = String(req.body?.playerKey || "").trim();
    const playerName = String(req.body?.playerName || "").trim();
    const query = req.body?.query && typeof req.body.query === "object"
      ? req.body.query
      : {};

    const url = new URL(origin + route);
    if (gameID) url.searchParams.set("game", gameID);
    if (playerKey) url.searchParams.set("player", playerKey);
    if (playerName) url.searchParams.set("name", playerName);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(String(key), String(value));
    }

    res.json({ ok: true, url: url.toString(), origin });
  } catch (err) {
    console.error("[remote-link] failed:", err?.stack || err?.message || err);
    res.status(500).json({
      ok: false,
      code: "REMOTE_LINK_FAILED",
      error: String(err?.message || err || "Remote link failed"),
    });
  }
});

app.get("/api/firebase/status", (req, res) => {
  try {
    const { getFirebaseStatus } = require("./firebase-config");
    res.json({ ok: true, ...getFirebaseStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ===== Public Config API =====
app.get("/api/config", (req, res) => {
  const rateRaw = process.env.LEGENDARY_RATE ?? "0.10";
  const legendaryRate = Math.max(0, Math.min(1, parseFloat(rateRaw)));
  res.json({ legendaryRate: Number.isFinite(legendaryRate) ? legendaryRate : 0.10 });
});



// Serve static files AFTER ipAllowlist
app.use(express.static(PUBLIC_ROOT));

// Authentication/login has been removed. The application homepage is public and
// administrative/game APIs are available without an account.

// --- Pages ---
app.get("/leaderboard", (req, res) => {
  res.sendFile(path.join(PUBLIC_ROOT, "leaderboard.html"));
});
app.get("/leaderboard-admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_ROOT, "leaderboard-admin.html"));
});

// ====== Abilities REST API ======
app.get("/api/abilities", (req, res) => {
  const list = readAbilitiesFile();
  res.json({ abilities: list });
});
app.post("/api/abilities/add", async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "missing text" });

  const list = readAbilitiesFile();
  list.push(text);
  const saved = await writeAbilitiesFile(list);
  if (!saved) return res.status(500).json({ ok: false, error: "write_failed" });
  res.json({ ok: true, abilities: saved });
});
app.delete("/api/abilities/:index", async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const list = readAbilitiesFile();
  if (isNaN(idx) || idx < 0 || idx >= list.length) {
    return res.status(400).json({ ok: false, error: "bad_index" });
  }
  list.splice(idx, 1);
  const saved = await writeAbilitiesFile(list);
  if (!saved) return res.status(500).json({ ok: false, error: "write_failed" });
  res.json({ ok: true, abilities: saved });
});
app.post("/api/abilities/reset-defaults", (req, res) => {
  const defaults = readAbilitiesFile();
  res.json({ ok: true, abilities: defaults });
});

// ====== In-memory Game Storage ======
const games = {};
const exclusionMap = {};

const DIAG_MAX = 200;
const diagEvents = [];
function pushDiag(evt) {
  diagEvents.push({ ts: new Date().toISOString(), ...evt });
  if (diagEvents.length > DIAG_MAX) diagEvents.shift();
}
app.get("/api/diag/rounds", (req, res) => {
  res.json(diagEvents.slice(-100));
});

const loggedNonImageOnce = new Set();

// ====== Start Page ======
// Login/accounts were removed. The application always starts at public/index.html.
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_ROOT, "index.html"));
});

// Legacy safety route: older public pages may still point to /login. Never
// serve a login page; send that obsolete route straight to the public home.
app.get(["/login", "/login/", "/login.html"], (req, res) => {
  res.redirect(302, "/");
});

// ====== Serve Image Filenames ======
app.get("/list-images/:folder", (req, res) => {
  const folder = String(req.params.folder || "").toLowerCase();
  const cardScope = normalizeCardScope(req.query.scope);
  const { imageRoot } = getCardAssets(cardScope);
  const folderPath = path.join(imageRoot, folder);

  if (!folder || folder === "." || folder === ".." || folder.includes("\\")) {
    return res.status(400).json({ error: "Invalid folder" });
  }

  fs.readdir(folderPath, (err, files = []) => {
    if (err) {
      console.error("[diag] Folder read error:", {
        folder,
        cardScope,
        folderPath,
        error: err.message,
      });
      return res.status(500).json({ error: "Folder not found" });
    }

    const imageRegex = /\.(png|jpe?g|gif|webm)$/i;
    const images = files.filter((f) => imageRegex.test(f));
    const nonImages = files.filter((f) => !imageRegex.test(f));

    const logKey = `${cardScope}:${folder}`;
    if (!loggedNonImageOnce.has(logKey)) {
      loggedNonImageOnce.add(logKey);
      console.log(
        `[diag] /list-images/${folder} (${cardScope}): total=${files.length}, images=${images.length}, non-images=${nonImages.length}`
      );
      if (nonImages.length) {
        console.log(
          `[diag] non-image examples (${cardScope}/${folder}):`,
          nonImages.slice(0, 20)
        );
      }
    }

    res.json(images);
  });
});

// ================= Leaderboard APIs =================
app.get("/api/leaderboard/top", (req, res) => {
  const lb = readLeaderboard();
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "20", 10)));
  const rows = Object.entries(lb.players).map(([name, s]) => ({
    name,
    ...s,
    winRate: s.games ? +((s.wins / s.games) * 100).toFixed(1) : 0,
  }));
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.games !== a.games) return b.games - a.games;
    return a.name.localeCompare(b.name, "ar");
  });
  res.json({ top: rows.slice(0, limit) });
});

app.get("/api/leaderboard/bottom", (req, res) => {
  const lb = readLeaderboard();
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "20", 10)));
  const rows = Object.entries(lb.players).map(([name, s]) => ({
    name,
    ...s,
    lossRate: s.games ? +((s.losses / s.games) * 100).toFixed(1) : 0,
  }));
  rows.sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    if (b.lossRate !== a.lossRate) return b.lossRate - a.lossRate;
    if (b.games !== a.games) return b.games - a.games;
    return a.name.localeCompare(b.name, "ar");
  });
  res.json({ bottom: rows.slice(0, limit) });
});

app.get("/api/leaderboard/all", (req, res) => {
  const lb = readLeaderboard();
  const rows = Object.entries(lb.players).map(([name, s]) => ({
    name,
    ...s,
    winRate: s.games ? +((s.wins / s.games) * 100).toFixed(1) : 0,
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  res.json({ players: rows });
});

app.post("/api/leaderboard/award", async (req, res) => {
  const name = String(req.body.player || "").trim();
  const delta = Number.isFinite(+req.body.delta) ? Math.trunc(+req.body.delta) : 1;
  if (!name) return res.status(400).json({ ok: false, error: "missing player" });

  const lb = readLeaderboard();
  const row = upsertPlayer(lb, name);
  row.points = Math.max(0, (row.points || 0) + delta);
  row.updatedAt = new Date().toISOString();
  await writeLeaderboard(lb);

  res.json({ ok: true, player: name, points: row.points });
});

app.post("/api/leaderboard/update", async (req, res) => {
  const name = String(req.body.player || "").trim();
  const games = Number.isFinite(+req.body.games) ? Math.max(0, Math.trunc(+req.body.games)) : 0;
  const wins = Number.isFinite(+req.body.wins) ? Math.max(0, Math.trunc(+req.body.wins)) : 0;
  const losses = Number.isFinite(+req.body.losses) ? Math.max(0, Math.trunc(+req.body.losses)) : 0;
  if (!name) return res.status(400).json({ ok: false, error: "missing player" });
  if (wins + losses > games) return res.status(400).json({ ok: false, error: "wins+losses > games" });

  const lb = readLeaderboard();
  const row = upsertPlayer(lb, name);
  row.games = games;
  row.wins = wins;
  row.losses = losses;
  row.updatedAt = new Date().toISOString();
  await writeLeaderboard(lb);
  res.json({ ok: true });
});

app.post("/api/leaderboard/batchUpdate", async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const lb = readLeaderboard();
  let updated = 0;

  for (const r of rows) {
    const name = String(r.player || "").trim();
    if (!name) continue;
    const games = Number.isFinite(+r.games) ? Math.max(0, Math.trunc(+r.games)) : 0;
    const wins = Number.isFinite(+r.wins) ? Math.max(0, Math.trunc(+r.wins)) : 0;
    const losses = Number.isFinite(+r.losses) ? Math.max(0, Math.trunc(+r.losses)) : 0;
    if (wins + losses > games) continue;

    const row = upsertPlayer(lb, name);
    row.games = games;
    row.wins = wins;
    row.losses = losses;
    row.updatedAt = new Date().toISOString();
    updated++;
  }
  await writeLeaderboard(lb);
  res.json({ ok: true, updated });
});

app.post("/api/leaderboard/delete", async (req, res) => {
  const name = String(req.body.player || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "missing player" });
  const lb = readLeaderboard();
  if (lb.players[name]) {
    delete lb.players[name];
    await writeLeaderboard(lb);
  }
  res.json({ ok: true });
});

// ---- Timer helpers (per game) ----
function ensureTimer(game) {
  if (!game.timer) {
    game.timer = { durationSec: 120, remainingSec: 120, startedAt: null, state: "paused_or_idle" };
  }
  return game.timer;
}
function snapshotTimer(game) {
  const t = ensureTimer(game);
  return {
    durationSec: t.durationSec,
    remainingSec: t.remainingSec,
    startedAt: t.startedAt,
    state: t.state,
  };
}

// ====== Socket.IO Game Logic ======
function getImagePath(cardScope, anime, filename) {
  const { imageUrlBase } = getCardAssets(cardScope);
  return `${imageUrlBase}/${anime.toLowerCase()}/${encodeURIComponent(filename)}`;
}

function imageKeyFromUrl(url) {
  try {
    const pathname = new URL(String(url || ""), "http://local").pathname;
    const marker = "/images/";
    const markerIndex = pathname.toLowerCase().lastIndexOf(marker);
    if (markerIndex < 0) return "";

    const relativePath = pathname.slice(markerIndex + marker.length);
    const separatorIndex = relativePath.indexOf("/");
    if (separatorIndex <= 0) return "";

    const folder = decodeURIComponent(relativePath.slice(0, separatorIndex)).toLowerCase();
    const filename = decodeURIComponent(relativePath.slice(separatorIndex + 1));
    return folder && filename ? `${folder}/${filename}` : "";
  } catch {
    return "";
  }
}

function createNewGame(socket, cardScope = "all") {
  const gameID = uuidv4().slice(0, 5).toUpperCase();
  games[gameID] = {
    host: socket.id,
    round: 0,
    animeList: [],
    players: {},
    scores: {},
    usedImages: new Set(),
    imageMap: {},
    picks: {},
    orders: {},
    abilities: {},
    pickProgress: {},
    picksLocked: {},
    meta: {
      mode: "winner",
      cardScope: normalizeCardScope(cardScope),
      countLeaderboard: false,
    },
    // timer will be created lazily by ensureTimer
  };
  socket.join(gameID);
  exclusionMap[gameID] = [];
  return gameID;
}
function safeDeleteGame(gameID) {
  delete games[gameID];
  delete exclusionMap[gameID];
}

// Block unauthorized Socket.IO connections unless SOCKET_ALLOW_PUBLIC === true
if (!SOCKET_ALLOW_PUBLIC) {
  io.use((socket, next) => {
    if (ALLOWED_IPV4S.length === 0) return next();

    const xff = (socket.handshake.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const addr = (socket.handshake.address || "").trim();
    const ip = (xff || addr).replace(/^::ffff:/, "");
    const ok = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ALLOWED_IPV4S.includes(ip);

    if (!ok) {
      console.warn("[ip-block][socket] denied", { ip });
      return next(new Error("forbidden"));
    }
    next();
  });
}

io.on("connection", (socket) => {
  socket.on("createGame", (payload = {}) => {
    const gameID = createNewGame(socket, payload?.cardScope);
    socket.emit("gameCreated", gameID);
  });

  socket.on("restartGame", (payload = {}) => {
    const { gameID, cardScope } = payload || {};
    if (games[gameID]) safeDeleteGame(gameID);
    const newID = createNewGame(socket, cardScope);
    socket.emit("gameCreated", newID);
  });

  // meta (mode + count flag)
  socket.on("setGameMeta", ({ gameID, mode, cardScope, countLeaderboard } = {}) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    const safeMode =
      mode === "manual" || mode === "strategic" || mode === "winner"
        ? mode
        : "winner";
    const safeCardScope = normalizeCardScope(
      cardScope ?? game.meta?.cardScope
    );
    const shouldCount = safeMode === "manual" ? false : !!countLeaderboard;
    game.meta = {
      mode: safeMode,
      cardScope: safeCardScope,
      countLeaderboard: shouldCount,
    };
  });

  socket.on("manualAddPlayers", ({ gameID, playerNames }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    game.playerList = playerNames;
    playerNames.forEach((name) => {
      const id = uuidv4();
      game.players[id] = { name, picks: [] };
      game.scores[name] = 0;
    });
  });

  socket.on("setAnimeList", ({ gameID, animeList }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    game.animeList = animeList.map((name) => name.toLowerCase());
    startRound(gameID);
  });

  socket.on("getPlayers", ({ gameID }) => {
    const game = games[gameID];
    if (!game) return;
    const names = Object.values(game.players || {}).map(p => p.name);
    socket.emit("players", names);
  });

  // Abilities
  socket.on("setAbilities", ({ gameID, abilities }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    game.abilities = abilities || {};
    io.to(gameID).emit("diagEvent", { message: "Abilities updated." });
  });

  socket.on("requestAbilities", ({ gameID, playerName }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    const list = game.abilities?.[playerName] || [];
    socket.emit("receiveAbilities", { abilities: list, player: playerName });
  });

  socket.on("hostWatchAbilityRequests", ({ gameID }) => {
    if (gameID) socket.join(gameID);
  });

  socket.on(
    "requestUseAbility",
    ({ gameID, playerName, abilityText, requestId }) => {
      if (!gameID) return;
      socket.join(gameID);
      io.to(gameID).emit("abilityRequested", {
        playerName,
        abilityText,
        requestId,
      });
    }
  );

  socket.on("abilityRequestResult", ({ gameID, requestId, ok, reason }) => {
    if (!gameID) return;
    io.to(gameID).emit("abilityRequestResult", { requestId, ok, reason });
  });

  // pick progress
  socket.on("savePickProgress", ({ gameID, playerName, picks }) => {
    const game = games[gameID];
    if (!game) return;
    if (!Array.isArray(picks)) return;
    if (game.picksLocked[playerName]) return;
    game.pickProgress[playerName] = picks.slice();
  });

  socket.on("getPickProgress", ({ gameID, playerName }) => {
    const game = games[gameID];
    if (!game) return;
    const existing = game.pickProgress[playerName] || [];
    const locked = !!game.picksLocked[playerName];
    socket.emit("pickProgress", { playerName, picks: existing, locked });
  });

  // manual pick
  socket.on("hostManualPick", ({ gameID, playerName, number }) => {
    const game = games[gameID];
    socket.join(gameID);
    const round = game?.round;
    const anime = game?.animeList[round];
    const player = Object.values(game?.players || {}).find(
      (p) => p.name === playerName
    );
    let entry = game?.imageMap[number];
    if (!player || !entry) return;

    // When anime === "rarities", entry is "folder/filename"
    let folderName = anime;
    let fileName = entry;
    if (anime === "rarities" && typeof entry === "string" && entry.includes("/")) {
      const [folder, fname] = entry.split("/");
      folderName = folder; // "legendary" | "normal"
      fileName = fname;
    }

    const key = `${folderName}/${fileName}`;
    if (game.usedImages.has(key)) return;

    player.picks[round] = getImagePath(
      game.meta?.cardScope,
      folderName,
      fileName
    );
    game.usedImages.add(key);

    const allPicked = Object.values(game.players).every((p) => p.picks[round]);
    if (allPicked) {
      const roundImages = {};
      for (const p of Object.values(game.players)) {
        roundImages[p.name] = p.picks[round];
      }
      io.to(gameID).emit("roundComplete", { round });
      io.to(game.host).emit("revealRound", { round, images: roundImages });
    }
  });

  socket.on("getAnimeList", ({ gameID }) => {
    const game = games[gameID];
    if (game?.animeList) {
      socket.join(gameID);
      socket.emit("animeList", game.animeList);
    }
  });

  socket.on("playerSubmitPicks", ({ gameID, playerName, playerKey, picks }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    if (game.picksLocked[playerName]) return;

    game.picks[playerName] = picks;
    game.pickProgress[playerName] = picks.slice();
    game.picksLocked[playerName] = true;

    if (playerKey === "player1") {
      exclusionMap[gameID] = Array.from(
        new Set((picks || []).map(imageKeyFromUrl).filter(Boolean))
      );
      io.to(gameID).emit("exclusionsData", exclusionMap[gameID]);
      console.log("[winner][exclusions built]", gameID, exclusionMap[gameID]);
    }
  });

  socket.on("getOrderData", ({ gameID, playerName }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    const picks = game.picks[playerName] || [];
    const ordered = game.orders[playerName] || null;
    socket.emit("orderData", { picks, ordered });
  });

  socket.on("watchOrders", ({ gameID }) => {
    socket.join(gameID);
  });

  socket.on("requestPicks", ({ gameID, playerName }) => {
    const picks = games[gameID]?.picks[playerName];
    socket.join(gameID);
    if (picks) socket.emit("receivePicks", picks);
  });

  socket.on("storeExclusions", ({ gameID, exclude }) => {
    exclusionMap[gameID] = exclude;
    socket.join(gameID);
    io.to(gameID).emit("exclusionsData", exclude);
  });

  socket.on("requestExclusions", ({ gameID }) => {
    const data = exclusionMap[gameID];
    socket.join(gameID);
    if (Array.isArray(data) && data.length) socket.emit("exclusionsData", data);
    else socket.emit("exclusionsNotReady");
  });

  socket.on("submitOrder", ({ gameID, playerName, ordered }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    game.orders[playerName] = ordered;
    io.to(gameID).emit("playerOrderSubmitted", { playerName, ordered });
  });

  socket.on("hostChooseWinner", async ({ gameID, winnerName }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    if (winnerName && winnerName !== "none") {
      game.scores[winnerName] = (game.scores[winnerName] || 0) + 1;
    }

    game.round++;

    const totalRounds =
      Array.isArray(game.animeList) && game.animeList.length > 0
        ? game.animeList.length
        : 5;

    if (game.round >= totalRounds) {
      const scores = game.scores;
      const winner =
        Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      io.to(gameID).emit("gameOver", { scores, winner });

      try {
        const mode = game.meta?.mode || "winner";
        const countFlag = !!game.meta?.countLeaderboard;
        if (mode !== "manual" && countFlag) {
          const lb = readLeaderboard();
          const playerNames = Object.values(game.players).map((p) => p.name);
          if (playerNames.length === 2) {
            const [A, B] = playerNames;
            const aScore = scores[A] || 0;
            const bScore = scores[B] || 0;

            const aRow = upsertPlayer(lb, A);
            const bRow = upsertPlayer(lb, B);

            if (aScore > bScore) {
              aRow.games += 1; bRow.games += 1; aRow.wins += 1; bRow.losses += 1;
            } else if (bScore > aScore) {
              aRow.games += 1; bRow.games += 1; bRow.wins += 1; aRow.losses += 1;
            }
            const now = new Date().toISOString();
            aRow.updatedAt = now; bRow.updatedAt = now;
            await writeLeaderboard(lb);
          }
        }
      } catch (e) {
        console.error("Leaderboard update failed:", e.message);
      }

      safeDeleteGame(gameID);
    } else {
      startRound(gameID);
    }
  });

  socket.on("endGame", ({ gameID }) => {
    if (games[gameID]) {
      io.to(gameID).emit("gameEnded");
      safeDeleteGame(gameID);
    }
  });

  socket.on("submitFinalScores", async ({ gameID, scores }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    try {
      const playerNames = Object.values(game.players).map((p) => p.name);
      if (playerNames.length !== 2) return;

      const [A, B] = playerNames;
      const aScore = Number((scores || {})[A] || 0);
      const bScore = Number((scores || {})[B] || 0);

      io.to(gameID).emit("gameOver", {
        scores: { [A]: aScore, [B]: bScore },
        winner: aScore > bScore ? A : bScore > aScore ? B : null,
      });

      const mode = game.meta?.mode || "winner";
      const countFlag = !!game.meta?.countLeaderboard;

      if (mode !== "manual" && countFlag) {
        const lb = readLeaderboard();
        const aRow = upsertPlayer(lb, A);
        const bRow = upsertPlayer(lb, B);

        if (aScore > bScore) {
          aRow.games += 1; bRow.games += 1; aRow.wins += 1; bRow.losses += 1;
        } else if (bScore > aScore) {
          aRow.games += 1; bRow.games += 1; bRow.wins += 1; aRow.losses += 1;
        }

        const now = new Date().toISOString();
        aRow.updatedAt = now; bRow.updatedAt = now;

        await writeLeaderboard(lb);
        console.log(`[leaderboard] saved result for ${A} vs ${B} (mode=${mode}, counted=${countFlag})`);
      } else {
        console.log(`[leaderboard] skipped (mode=${mode}, counted=${countFlag}) for game ${gameID}`);
      }
    } catch (e) {
      console.error("submitFinalScores failed:", e.message);
    } finally {
      safeDeleteGame(gameID);
    }
  });

  // ==== TIMER EVENTS (host <-> players) ====
  socket.on("timerSetDuration", ({ gameID, durationSec }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    const t = ensureTimer(game);
    if (t.state === "running") return; // don't change while running
    t.durationSec = Number(durationSec) || 120;
    t.remainingSec = t.durationSec;
    t.startedAt = null;
    t.state = "paused_or_idle";

    io.to(gameID).emit("timerSetDuration", { gameID, durationSec: t.durationSec });
    io.to(gameID).emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  socket.on("timerStart", ({ gameID, durationSec, startedAt, remainingSec }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    const t = ensureTimer(game);
    if (Number.isInteger(durationSec)) t.durationSec = durationSec;
    if (Number.isInteger(remainingSec)) {
      t.remainingSec = remainingSec;        // resume
    } else {
      t.remainingSec = t.durationSec;       // fresh start
    }
    t.startedAt = startedAt || Date.now();
    t.state = "running";

    io.to(gameID).emit("timerStart", {
      gameID,
      durationSec: t.durationSec,
      startedAt: t.startedAt,
      remainingSec: t.remainingSec,
    });
    io.to(gameID).emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  socket.on("timerPause", ({ gameID, remainingSec }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    const t = ensureTimer(game);
    if (Number.isInteger(remainingSec)) t.remainingSec = remainingSec;
    t.startedAt = null;
    t.state = "paused_or_idle";

    io.to(gameID).emit("timerPause", { gameID, remainingSec: t.remainingSec });
    io.to(gameID).emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  socket.on("timerFinished", ({ gameID }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    const t = ensureTimer(game);
    t.remainingSec = 0;
    t.startedAt = null;
    t.state = "finished";

    io.to(gameID).emit("timerFinished", { gameID });
    io.to(gameID).emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  // Players ask for current snapshot on load
  socket.on("timerRequestState", ({ gameID }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    socket.emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  // (Optional) accept host's periodic 'timerState' pings to keep server in sync
  socket.on("timerState", ({ gameID, state, durationSec, remainingSec, startedAt }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);

    const t = ensureTimer(game);
    if (Number.isInteger(durationSec)) t.durationSec = durationSec;
    if (Number.isInteger(remainingSec)) t.remainingSec = remainingSec;
    t.startedAt = startedAt ?? t.startedAt;
    if (state) t.state = state;

    io.to(gameID).emit("timerState", { gameID, ...snapshotTimer(game) });
  });

  // Relay "تمام" acknowledgments from players to everyone in the game room
  socket.on("playerOk", (payload = {}) => {
    const { gameID, playerName, side } = payload;
    if (!gameID) return;

    const isActive = Object.prototype.hasOwnProperty.call(payload, "active")
      ? !!payload.active
      : true;

    socket.join(gameID);
    io.to(gameID).emit("playerOk", { gameID, playerName, side, active: isActive });
  });

  // ✅ Relay startRound from host to everyone in the room
  socket.on("startRound", (payload = {}) => {
    const { gameID } = payload || {};
    if (!gameID) return;
    socket.join(gameID);
    io.to(gameID).emit("startRound", payload);
  });


  // ===== Chat relay (order -> result, and optional host reply) =====
  socket.on("playerChat", (payload = {}) => {
    const { gameID, playerName, message } = payload || {};
    if (!gameID || !message) return;
    const clean = String(message).slice(0, 300);
    socket.join(gameID);
    io.to(gameID).emit("playerChat", {
      gameID,
      playerName: String(playerName || "لاعب").slice(0, 40),
      message: clean,
      ts: Date.now()
    });
  });

  socket.on("hostChat", (payload = {}) => {
    const { gameID, message } = payload || {};
    if (!gameID || !message) return;
    const clean = String(message).slice(0, 300);
    socket.join(gameID);
    io.to(gameID).emit("hostChat", { gameID, message: clean, ts: Date.now() });
  });

socket.on("joinGame", ({ gameID }) => {
    if (!gameID) return;
    socket.join(gameID);
  });

  // Relay host result broadcasts and incremental updates to all in the room
  socket.on("resultBroadcast", ({ gameID, snapshot }) => {
    if (!gameID) return;
    io.to(gameID).emit("resultSnapshot", { gameID, ...snapshot });
  });
  // Host broadcasts a full UI snapshot to everyone in the room
  socket.on("resultSnapshot", ({ gameID, snapshot }) => {
    if (!gameID) return;
    socket.join(gameID);
    io.to(gameID).emit("resultSnapshot", { snapshot });
  });
  socket.on("roundChanged", ({ gameID, round }) => {
    if (!gameID) return;
    io.to(gameID).emit("roundChanged", { gameID, round });
  });
  socket.on("scoresUpdated", ({ gameID, scores }) => {
    if (!gameID) return;
    io.to(gameID).emit("scoresUpdated", { gameID, scores });
  });
  socket.on("abilitiesUpdated", ({ gameID, abilities }) => {
    if (!gameID) return;
    io.to(gameID).emit("abilitiesUpdated", { gameID, abilities });
  });
  // Viewers request a fresh snapshot from host
  socket.on("requestResultSnapshot", ({ gameID }) => {
    if (!gameID) return;
    // Tell everyone in the room; the host page will hear this and respond with resultSnapshot
    io.to(gameID).emit("requestResultSnapshot");
  });

});

function startRound(gameID) {
  const game = games[gameID];
  if (!game) return;

  const round = game.round;
  const anime = game.animeList[round];
  const cardScope = normalizeCardScope(game.meta?.cardScope);
  const { imageRoot } = getCardAssets(cardScope);

  // Virtual source: "rarities" pulls from both /normal and /legendary
  if (anime === "rarities") {
    const normalDir = path.join(imageRoot, "normal");
    const legendaryDir = path.join(imageRoot, "legendary");

    let normalFiles = [];
    let legendaryFiles = [];
    try {
      normalFiles = fs
        .readdirSync(normalDir)
        .filter((f) => /\.(png|jpe?g|gif|webm)$/i.test(f));
    } catch (err) {
      console.error("[diag] Image folder read error:", {
        gameID,
        anime: "normal",
        folderPath: normalDir,
        error: err.message,
      });
    }
    try {
      legendaryFiles = fs
        .readdirSync(legendaryDir)
        .filter((f) => /\.(png|jpe?g|gif|webm)$/i.test(f));
    } catch (err) {
      console.error("[diag] Image folder read error:", {
        gameID,
        anime: "legendary",
        folderPath: legendaryDir,
        error: err.message,
      });
    }

    const totalAvailable = normalFiles.length + legendaryFiles.length;
    if (totalAvailable < 2) {
      io.to(gameID).emit("error", "Not enough images left for this round.");
      return;
    }

    const availableNormal = normalFiles.filter(
      (name) => !game.usedImages.has(`normal/${name}`)
    );
    const availableLegend = legendaryFiles.filter(
      (name) => !game.usedImages.has(`legendary/${name}`)
    );

    const BOARD = 20;

const rate = getLegendaryRate(); // من ENV
let wantLegendary = Math.round(BOARD * rate);

wantLegendary = Math.max(0, Math.min(BOARD, wantLegendary));


    const takeLegendary = Math.min(wantLegendary, availableLegend.length);
    let takeNormal = BOARD - takeLegendary;

    if (takeNormal > availableNormal.length) {
      const shortfall = takeNormal - availableNormal.length;
      takeNormal = availableNormal.length;
      const extraL = Math.min(shortfall, availableLegend.length - takeLegendary);
      wantLegendary += extraL;
    }

    function sampleK(arr, k) {
      const a = arr.slice();
      for (let i = 0; i < Math.min(k, a.length); i++) {
        const j = i + Math.floor(Math.random() * (a.length - i));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, Math.min(k, a.length));
    }

    const chosenLegend = sampleK(availableLegend, takeLegendary).map(
      (f) => `legendary/${f}`
    );
    const chosenNormal = sampleK(availableNormal, takeNormal).map(
      (f) => `normal/${f}`
    );

    let combined = [...chosenLegend, ...chosenNormal];
    if (combined.length < BOARD) {
      const remLegend = availableLegend
        .filter((f) => !chosenLegend.includes(`legendary/${f}`))
        .map((f) => `legendary/${f}`);
      const remNormal = availableNormal
        .filter((f) => !chosenNormal.includes(`normal/${f}`))
        .map((f) => `normal/${f}`);
      const remainder = [...remLegend, ...remNormal];
      const need = BOARD - combined.length;
      combined = [...combined, ...sampleK(remainder, need)];
    }

    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    game.imageMap = {};
    combined.slice(0, 20).forEach((entry, idx) => {
      game.imageMap[idx + 1] = entry; // "legendary/xxx.jpg" or "normal/xxx.jpg"
    });

    const diagMsg = `[diag][${gameID}] rarities round ${round}: normal=${availableNormal.length}, legendary=${availableLegend.length}, showing=${Object.keys(game.imageMap).length}, legendaryRate=${getLegendaryRate()}`;
    console.log(diagMsg);
    pushDiag({
      gameID,
      anime: "rarities",
      cardScope,
      round,
      normal: availableNormal.length,
      legendary: availableLegend.length,
      showing: Object.keys(game.imageMap).length,
      legendaryRate: getLegendaryRate(),
    });
    if (game.host) io.to(game.host).emit("diagEvent", { message: diagMsg });

    for (const player of Object.values(game.players)) {
      player.picks[round] = null;
    }

    io.to(gameID).emit("startRound", {
      round,
      anime,
      cardScope,
      imageMap: game.imageMap,
      players: Object.values(game.players).map((p) => p.name),
    });
    return;
  }

  // === Default (single real folder) ===
  const folderPath = path.join(imageRoot, anime);

  let allFilenames = [];
  try {
    allFilenames = fs
      .readdirSync(folderPath)
      .filter((f) => /\.(png|jpe?g|gif|webm)$/i.test(f));
  } catch (err) {
    console.error("[diag] Image folder read error:", {
      gameID,
      anime,
      folderPath,
      error: err.message,
    });
    io.to(gameID).emit("error", "Image folder not found for this round.");
    return;
  }

  const available = allFilenames.filter(
    (name) => !game.usedImages.has(`${anime}/${name}`)
  );
  if (available.length < 2) {
    console.warn(
      `[diag][${gameID}] ${anime} round ${round}: Not enough images left. total=${allFilenames.length}, available=${available.length}`
    );
    io.to(gameID).emit("error", "Not enough images left for this round.");
    return;
  }

  const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 20);
  game.imageMap = {};
  shuffled.forEach((filename, i) => {
    game.imageMap[i + 1] = filename;
  });

  const diagMsg = `[diag][${gameID}] ${anime} round ${round}: total=${allFilenames.length}, available=${available.length}, showing=${shuffled.length}`;
  console.log(diagMsg);
  pushDiag({
    gameID,
    anime,
    cardScope,
    round,
    total: allFilenames.length,
    available: available.length,
    showing: shuffled.length,
  });
  if (game.host) io.to(game.host).emit("diagEvent", { message: diagMsg });

  for (const player of Object.values(game.players)) {
    player.picks[round] = null;
  }

  io.to(gameID).emit("startRound", {
    round,
    anime,
    cardScope,
    imageMap: game.imageMap,
    players: Object.values(game.players).map((p) => p.name),
  });
}

// ===== Initialize data: Restore from Firebase if available =====
async function initializeData() {
  console.log("[init] Checking for data restoration from Firebase...");

  // Firebase is the shared source of truth. Local JSON is only the cache/fallback.
  // The previous code compared timestamps/array lengths and could silently keep
  // stale local data even when Firebase was reachable.
  try {
    try {
      const firebaseLb = await readLeaderboardFromFirebase();
      const localLb = readLeaderboard();
      const firebaseHasData = Object.keys(firebaseLb?.players || {}).length > 0;
      const localHasData = Object.keys(localLb?.players || {}).length > 0;

      if (firebaseHasData) {
        fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(firebaseLb, null, 2), "utf8");
        console.log(`[init] ✅ Restored leaderboard from Firebase (${Object.keys(firebaseLb.players).length} players)`);
      } else if (localHasData) {
        // First-run migration: if Firebase is connected but empty, seed it once
        // from the existing local cache rather than losing the local leaderboard.
        await writeLeaderboardToFirebase(localLb);
        console.log(`[init] ℹ️ Firebase leaderboard is empty; seeded from local (${Object.keys(localLb.players).length} players)`);
      } else {
        console.log("[init] ℹ️ Firebase leaderboard is empty; no local leaderboard data to seed");
      }
    } catch (e) {
      console.warn("[init] ⚠️ Could not restore leaderboard from Firebase:", e.message);
      console.log("[init] ℹ️ Using local leaderboard file");
    }

    try {
      const firebaseAbilities = await readAbilitiesFromFirebase();
      const localAbilities = readAbilitiesFile();

      if (firebaseAbilities.length > 0) {
        fs.writeFileSync(ABILITIES_PATH, JSON.stringify({ abilities: firebaseAbilities }, null, 2), "utf8");
        console.log(`[init] ✅ Restored abilities from Firebase (${firebaseAbilities.length} abilities)`);
      } else if (localAbilities.length > 0) {
        await writeAbilitiesToFirebase(localAbilities);
        console.log(`[init] ℹ️ Firebase abilities are empty; seeded from local (${localAbilities.length} abilities)`);
      } else {
        console.log("[init] ℹ️ Firebase abilities are empty; no local abilities to seed");
      }
    } catch (e) {
      console.warn("[init] ⚠️ Could not restore abilities from Firebase:", e.message);
      console.log("[init] ℹ️ Using local abilities file");
    }

    console.log("[init] ✅ Data initialization complete");
  } catch (e) {
    console.error("[init] ❌ Error during data initialization:", e.message);
    console.warn("[init] ⚠️ Server will continue with local files only");
  }
}

// Start server
server.listen(PORT, async () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  if (ALLOWED_IPV4S.length) {
    console.log("[ip-allowlist] active:", ALLOWED_IPV4S.join(", "));
  } else {
    console.log("[ip-allowlist] NOT configured (service is open to all IPs).");
  }
  if (EXEMPT_PATHS.length) {
    console.log("[ip-exempt-paths]:", EXEMPT_PATHS.join(", "));
  }
  console.log(`[socket] SOCKET_ALLOW_PUBLIC=${SOCKET_ALLOW_PUBLIC}`);
  console.log("[auth] Login/accounts disabled — homepage is public.");

  // Initialize data from Firebase
  await initializeData();
});
