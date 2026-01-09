const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bodyParser = require("body-parser");
const helmet = require("helmet");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== Configuration ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "your-secure-secret";
const LEGENDARY_RATE = Math.max(
  0,
  Math.min(1, parseFloat(process.env.LEGENDARY_RATE || "0.10"))
);

// Admin credentials from env (no hard-coded defaults)
const ADMIN_USERNAME = process.env.USERNAME || "";
const ADMIN_PASSWORD = process.env.PASSWORD || "";

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

// ===== Abilities storage (JSON, single source of truth) =====
const ABILITIES_PATH = process.env.ABILITIES_PATH || path.join(__dirname, "abilities.json");
console.log("[abilities] Using path:", ABILITIES_PATH);

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

function writeAbilitiesFile(arr) {
  try {
    const clean = arr.map(s => String(s).trim()).filter(Boolean);
    const jsonStr = JSON.stringify({ abilities: clean }, null, 2);
    fs.writeFileSync(ABILITIES_PATH, jsonStr, "utf8");

    githubUpsertFile({
      content: jsonStr,
      message: `Update abilities.json at ${new Date().toISOString()}`,
      pathRel: process.env.GITHUB_FILE_PATH_ABILITY || "abilities.json",
    }).catch((e) => console.error("[github abilities] sync error:", e.message));

    return clean;
  } catch (e) {
    console.error("[abilities] write failed:", e.message);
    return null;
  }
}

// Ensure the abilities file exists at boot
ensureAbilitiesFile();

// ===== Leaderboard (disk persistence) =====
const LEADERBOARD_PATH = path.join(__dirname, "leaderboard.json");
function readLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_PATH, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object" && json.players) return json;
  } catch {}
  return { players: {} };
}
function writeLeaderboard(data) {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(LEADERBOARD_PATH, jsonStr, "utf8");
    githubUpsertFile({
      content: jsonStr,
      message: `Update leaderboard.json at ${new Date().toISOString()}`,
    }).catch((e) => console.error("[github] sync error:", e.message));
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

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 3600000,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    },
  })
);

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

// Serve static files AFTER ipAllowlist
app.use(express.static(path.join(__dirname, "public")));

// --- Auth helpers ---
function requireAuth(req, res, next) {
  if (req.session?.authenticated && req.session.enteredFromLogin && !req.session.exitedHome) {
    return next();
  }
  res.redirect("/login");
}
function requireApiAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// --- Pages ---
app.get("/leaderboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "leaderboard.html"));
});
app.get("/leaderboard-admin", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "leaderboard-admin.html"));
});

// ====== Abilities REST API ======
app.get("/api/abilities", (req, res) => {
  const list = readAbilitiesFile();
  res.json({ abilities: list });
});
app.post("/api/abilities/add", (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "missing text" });

  const list = readAbilitiesFile();
  list.push(text);
  const saved = writeAbilitiesFile(list);
  if (!saved) return res.status(500).json({ ok: false, error: "write_failed" });
  res.json({ ok: true, abilities: saved });
});
app.delete("/api/abilities/:index", (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const list = readAbilitiesFile();
  if (isNaN(idx) || idx < 0 || idx >= list.length) {
    return res.status(400).json({ ok: false, error: "bad_index" });
  }
  list.splice(idx, 1);
  const saved = writeAbilitiesFile(list);
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

// ====== Auth Routes ======
app.get("/login", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html"))
);

// Login reads credentials from ENV (USERNAME, PASSWORD)
app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(500).json({ success: false, message: "Server credentials not configured." });
  }
  const ok =
    String(username) === String(ADMIN_USERNAME) &&
    String(password) === String(ADMIN_PASSWORD);

  if (ok) {
    req.session.authenticated = true;
    req.session.enteredFromLogin = true;
    req.session.exitedHome = false;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: "Invalid credentials" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});
app.post("/api/exit-home", (req, res) => {
  if (req.session.authenticated) {
    req.session.exitedHome = true;
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false });
  }
});
app.get("/api/check-auth", (req, res) => {
  const auth =
    req.session.authenticated &&
    req.session.enteredFromLogin &&
    !req.session.exitedHome;
  res.status(auth ? 200 : 401).json({ authenticated: !!auth });
});

// ====== Start Page ======
app.get("/", (req, res) => {
  if (
    req.session.authenticated &&
    req.session.enteredFromLogin &&
    !req.session.exitedHome
  ) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    res.redirect("/login");
  }
});

// ====== Serve Image Filenames ======
app.get("/list-images/:folder", (req, res) => {
  const folder = req.params.folder.toLowerCase();
  const folderPath = path.join(__dirname, "public", "images", folder);

  fs.readdir(folderPath, (err, files = []) => {
    if (err) {
      console.error("[diag] Folder read error:", {
        folder,
        folderPath,
        error: err.message,
      });
      return res.status(500).json({ error: "Folder not found" });
    }

    const imageRegex = /\.(png|jpe?g|gif|webm)$/i;
    const images = files.filter((f) => imageRegex.test(f));
    const nonImages = files.filter((f) => !imageRegex.test(f));

    if (!loggedNonImageOnce.has(folder)) {
      loggedNonImageOnce.add(folder);
      console.log(
        `[diag] /list-images/${folder}: total=${files.length}, images=${images.length}, non-images=${nonImages.length}`
      );
      if (nonImages.length) {
        console.log(`[diag] non-image examples (${folder}):`, nonImages.slice(0, 20));
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

app.post("/api/leaderboard/award", (req, res) => {
  const name = String(req.body.player || "").trim();
  const delta = Number.isFinite(+req.body.delta) ? Math.trunc(+req.body.delta) : 1;
  if (!name) return res.status(400).json({ ok: false, error: "missing player" });

  const lb = readLeaderboard();
  const row = upsertPlayer(lb, name);
  row.points = Math.max(0, (row.points || 0) + delta);
  row.updatedAt = new Date().toISOString();
  writeLeaderboard(lb);

  res.json({ ok: true, player: name, points: row.points });
});

app.post("/api/leaderboard/update", requireApiAuth, (req, res) => {
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
  writeLeaderboard(lb);
  res.json({ ok: true });
});

app.post("/api/leaderboard/batchUpdate", requireApiAuth, (req, res) => {
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
  writeLeaderboard(lb);
  res.json({ ok: true, updated });
});

app.post("/api/leaderboard/delete", requireApiAuth, (req, res) => {
  const name = String(req.body.player || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "missing player" });
  const lb = readLeaderboard();
  if (lb.players[name]) {
    delete lb.players[name];
    writeLeaderboard(lb);
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
function getImagePath(anime, filename) {
  return `/images/${anime.toLowerCase()}/${encodeURIComponent(filename)}`;
}

function createNewGame(socket) {
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
    meta: { mode: "winner", countLeaderboard: false },
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
  socket.on("createGame", () => {
    const gameID = createNewGame(socket);
    socket.emit("gameCreated", gameID);
  });

  socket.on("restartGame", ({ gameID }) => {
    if (games[gameID]) safeDeleteGame(gameID);
    const newID = createNewGame(socket);
    socket.emit("gameCreated", newID);
  });

  // meta (mode + count flag)
  socket.on("setGameMeta", ({ gameID, mode, countLeaderboard }) => {
    const game = games[gameID];
    if (!game) return;
    socket.join(gameID);
    const safeMode =
      mode === "manual" || mode === "strategic" || mode === "winner"
        ? mode
        : "winner";
    const shouldCount = safeMode === "manual" ? false : !!countLeaderboard;
    game.meta = { mode: safeMode, countLeaderboard: shouldCount };
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

    player.picks[round] = getImagePath(folderName, fileName);
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
      exclusionMap[gameID] = (picks || []).map((url) => {
        try {
          const pathname = decodeURIComponent(new URL(url, "http://x").pathname);
          const parts = pathname.split("/");
          const anime = String(parts[2] || "").toLowerCase();
          const filename = String(parts[3] || "");
          return `${anime}/${filename}`;
        } catch {
          const parts = (url || "").split("/");
          const anime = String(parts[2] || "").toLowerCase();
          const filename = String(parts[3] || parts[parts.length - 1] || "");
          return `${anime}/${filename}`;
        }
      });
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

  socket.on("hostChooseWinner", ({ gameID, winnerName }) => {
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
            writeLeaderboard(lb);
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

  socket.on("submitFinalScores", ({ gameID, scores }) => {
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

        writeLeaderboard(lb);
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

  // Virtual source: "rarities" pulls from both /normal and /legendary
  if (anime === "rarities") {
    const normalDir = path.join(__dirname, "public", "images", "normal");
    const legendaryDir = path.join(__dirname, "public", "images", "legendary");

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
    let wantLegendary = Math.round(BOARD * LEGENDARY_RATE);
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

    const diagMsg = `[diag][${gameID}] rarities round ${round}: normal=${availableNormal.length}, legendary=${availableLegend.length}, showing=${Object.keys(game.imageMap).length}, legendaryRate=${LEGENDARY_RATE}`;
    console.log(diagMsg);
    pushDiag({
      gameID,
      anime: "rarities",
      round,
      normal: availableNormal.length,
      legendary: availableLegend.length,
      showing: Object.keys(game.imageMap).length,
      legendaryRate: LEGENDARY_RATE,
    });
    if (game.host) io.to(game.host).emit("diagEvent", { message: diagMsg });

    for (const player of Object.values(game.players)) {
      player.picks[round] = null;
    }

    io.to(gameID).emit("startRound", {
      round,
      anime,
      imageMap: game.imageMap,
      players: Object.values(game.players).map((p) => p.name),
    });
    return;
  }

  // === Default (single real folder) ===
  const folderPath = path.join(__dirname, "public", "images", anime);

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
    imageMap: game.imageMap,
    players: Object.values(game.players).map((p) => p.name),
  });
}

server.listen(PORT, () => {
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
  console.log(`[auth] ADMIN_USERNAME configured: ${ADMIN_USERNAME ? "yes" : "no"}`);
});
