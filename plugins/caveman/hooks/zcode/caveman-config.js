#!/usr/bin/env node
// caveman — shared configuration resolver (ZCode build)
//
// ⚠️ TEMPLATE FILE — do not edit plugin copies directly.
// This is the single source of truth. Run `npm run sync:shared` to regenerate
// plugins/caveman/hooks/<id>/caveman-config.js from this template.
//
// Resolution order for default mode:
//   1. CAVEMAN_DEFAULT_MODE environment variable
//   2. Repo-local config (checked-in, per-project default):
//      - <cwd>/.caveman/config.json
//      - <cwd>/.caveman.json
//      Walks up from process.cwd() to the nearest ancestor containing one of
//      these (stops at filesystem root). Lets a team pin a project's default
//      mode without polluting every contributor's user-level config or env.
//   3. User config file defaultMode field:
//      - $XDG_CONFIG_HOME/caveman/config.json (any platform, if set)
//      - %APPDATA%\caveman\config.json (Windows)
//      - ~/.config/caveman/config.json (macOS / Linux fallback)
//   4. 'full'
//
// Ported from upstream src/hooks/caveman-config.js. Symlink-safe flag IO,
// size caps, VALID_MODES whitelist. On Windows, uid checks are unavailable
// — falls back to verifying the resolved path lives under the user's home
// directory.

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress'
];


// ── Per-agent data isolation ─────────────────────────────────────────────────
// Each coding agent (zcode/codebuddy/qwen/qoder/trae) keeps its own state under
// ~/.caveman/<agent>/ so multiple agents running on the same machine never
// clobber each other's mode flag, mode-log, or lifetime-saved badge. The agent
// id is hardcoded per build — every plugin copy knows which agent it belongs to.
const AGENT_ID = 'zcode';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || '.';
}

// Root caveman data dir (shared across agents for config.json only).
function getCavemanRoot() {
  return process.env.ZCODE_PLUGIN_DATA || path.join(homeDir(), '.caveman');
}

// Per-agent data dir: ~/.caveman/<agent>/
function getAgentDataDir() {
  return path.join(getCavemanRoot(), AGENT_ID);
}

function getAgentFlagPath() {
  return path.join(getAgentDataDir(), 'active');
}

function getAgentPrevFlagPath() {
  return path.join(getAgentDataDir(), 'active.prev');
}

function getAgentModeLogPath() {
  return path.join(getAgentDataDir(), 'mode-log.jsonl');
}

function getAgentLifetimeFile() {
  return path.join(getAgentDataDir(), 'lifetime-saved.json');
}

function getAgentSnapshotFile() {
  return path.join(getAgentDataDir(), 'session-snapshot.json');
}

function getAgentCounterFile() {
  return path.join(getAgentDataDir(), 'caveman-stop-counter');
}

// One-time migration from the legacy flat layout (~/.caveman-active,
// ~/.caveman/lifetime-saved.json) into this agent's subdirectory. Idempotent:
// skips any file that already exists in the agent dir. Leaves the legacy files
// in place so other agents can still migrate from them on their first run.
// Best-effort, silent on failure.
function migrateLegacyFiles() {
  try {
    const dir = getAgentDataDir();
    fs.mkdirSync(dir, { recursive: true });

    // 1. Mode flag: ~/.caveman-active -> <agent>/active
    const legacyFlag = path.join(homeDir(), '.caveman-active');
    const newFlag = getAgentFlagPath();
    if (!fs.existsSync(newFlag)) {
      try {
        const st = fs.lstatSync(legacyFlag);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 64) {
          const raw = fs.readFileSync(legacyFlag, 'utf-8').trim().toLowerCase();
          if (VALID_MODES.includes(raw)) safeWriteFlag(newFlag, raw);
        }
      } catch { /* legacy flag absent — nothing to migrate */ }
    }

    // 2. Previous-mode flag: ~/.caveman-active.prev -> <agent>/active.prev
    const legacyPrev = path.join(homeDir(), '.caveman-active.prev');
    const newPrev = getAgentPrevFlagPath();
    if (!fs.existsSync(newPrev)) {
      try {
        const st = fs.lstatSync(legacyPrev);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 64) {
          const raw = fs.readFileSync(legacyPrev, 'utf-8').trim().toLowerCase();
          if (VALID_MODES.includes(raw)) safeWriteFlag(newPrev, raw);
        }
      } catch { /* absent — skip */ }
    }

    // 3. Lifetime savings: ~/.caveman/lifetime-saved.json -> <agent>/lifetime-saved.json
    //    Take max() with any existing value, since the legacy file may have
    //    accumulated savings from multiple agents before isolation.
    const legacyLifetime = path.join(getCavemanRoot(), 'lifetime-saved.json');
    try {
      const legacyRaw = fs.readFileSync(legacyLifetime, 'utf-8');
      const legacy = JSON.parse(legacyRaw);
      if (legacy && typeof legacy.lifetimeSaved === 'number') {
        let prev = 0;
        try {
          const cur = JSON.parse(fs.readFileSync(getAgentLifetimeFile(), 'utf-8'));
          if (cur && typeof cur.lifetimeSaved === 'number') prev = cur.lifetimeSaved;
        } catch { /* no existing agent file */ }
        const merged = Math.max(prev, legacy.lifetimeSaved);
        if (merged > 0) {
          fs.writeFileSync(
            getAgentLifetimeFile(),
            JSON.stringify({ lifetimeSaved: merged, updatedAt: new Date().toISOString() })
          );
        }
      }
    } catch { /* legacy lifetime file absent or invalid — skip */ }

    // 4. Mode-transition log: ~/.caveman-mode-log.jsonl -> <agent>/mode-log.jsonl
    //    Append-only; copy if the agent log doesn't exist yet.
    const legacyLog = path.join(homeDir(), '.caveman-mode-log.jsonl');
    const newLog = getAgentModeLogPath();
    if (!fs.existsSync(newLog)) {
      try {
        const raw = fs.readFileSync(legacyLog, 'utf-8');
        if (raw.trim()) {
          appendFlag(newLog, raw.trim());
        }
      } catch { /* absent — skip */ }
    }
  } catch {
    // Migration is best-effort; never block session start.
  }
}


function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'caveman');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'caveman'
    );
  }
  return path.join(os.homedir(), '.config', 'caveman');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

// Walk up from `start` looking for a repo-local caveman config. Returns the
// absolute path of the first match, or null. Stops at the filesystem root.
// Candidates per dir (first wins): .caveman/config.json, .caveman.json.
// Bounded to 64 levels to defend against symlink cycles on pathological mounts.
function findRepoConfigPath(start) {
  try {
    let dir = path.resolve(start || process.cwd());
    const candidates = ['.caveman/config.json', '.caveman.json'];
    for (let i = 0; i < 64; i++) {
      for (const rel of candidates) {
        const p = path.join(dir, rel);
        try {
          const st = fs.lstatSync(p);
          if (st.isSymbolicLink() || !st.isFile()) continue;
          return p;
        } catch (e) {
          // not present, try next candidate
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch (e) {
    // Defensive: any cwd / fs failure → no repo config
  }
  return null;
}

function readModeFromConfigFile(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (config && config.defaultMode &&
        VALID_MODES.includes(String(config.defaultMode).toLowerCase())) {
      return String(config.defaultMode).toLowerCase();
    }
  } catch (e) {
    // Missing / unreadable / invalid JSON → caller falls through
  }
  return null;
}

function getDefaultMode() {
  // 1. Environment variable (highest priority)
  const envMode = process.env.CAVEMAN_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }

  // 2. Repo-local config (checked-in, per-project default)
  const repoConfigPath = findRepoConfigPath(process.cwd());
  if (repoConfigPath) {
    const repoMode = readModeFromConfigFile(repoConfigPath);
    if (repoMode) return repoMode;
  }

  // 3. User config file
  const userMode = readModeFromConfigFile(getConfigPath());
  if (userMode) return userMode;

  // 4. Default
  return 'full';
}

// Symlink-safe flag file write.
// Uses O_NOFOLLOW where available, writes atomically via temp + rename with
// 0600 permissions. Protects against local attackers replacing the predictable
// flag path (~/.caveman-active) with a symlink to clobber other files.
//
// When the parent directory is itself a symlink (legitimate pattern: home dir
// symlinked to another drive), resolves through to the real path and verifies
// it lives under the user's home directory.
//
// The flag file itself must never be a symlink (that's the actual clobber vector).
//
// Set CAVEMAN_DEBUG=1 to emit stderr diagnostics when flag writes are refused.
// Silent-fails on any filesystem error — the flag is best-effort.
function safeWriteFlag(flagPath, content) {
  const debug = process.env.CAVEMAN_DEBUG === '1';
  try {
    const flagDir = path.dirname(flagPath);
    fs.mkdirSync(flagDir, { recursive: true });

    // When the parent directory is a symlink, resolve it and verify it's
    // under the user's home directory.
    let realFlagDir;
    try {
      const lstat = fs.lstatSync(flagDir);
      if (lstat.isSymbolicLink()) {
        realFlagDir = fs.realpathSync(flagDir);
        const realStat = fs.statSync(realFlagDir);
        if (!realStat.isDirectory()) {
          if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${realFlagDir} is not a directory\n`);
          return;
        }
        // Verify resolved path is under home directory
        const home = os.homedir();
        const normalizedReal = path.resolve(realFlagDir).toLowerCase();
        const normalizedHome = path.resolve(home).toLowerCase();
        if (!normalizedReal.startsWith(normalizedHome + path.sep) &&
            normalizedReal !== normalizedHome) {
          if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${normalizedReal} is outside home directory ${normalizedHome}\n`);
          return;
        }
      } else {
        realFlagDir = flagDir;
      }
    } catch (e) {
      return;
    }

    // The flag file itself must never be a symlink
    const realFlagPath = path.join(realFlagDir, path.basename(flagPath));
    try {
      if (fs.lstatSync(realFlagPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const tempPath = path.join(realFlagDir, `.caveman-active.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realFlagPath);
  } catch (e) {
    // Silent fail — flag is best-effort
  }
}

// Symlink-safe, size-capped, whitelist-validated flag file read.
// Symmetric with safeWriteFlag: refuses symlinks at the target, caps the read,
// and rejects anything that isn't a known mode. Returns null on any anomaly.
const MAX_FLAG_BYTES = 64;

function readFlag(flagPath) {
  try {
    let st;
    try {
      st = fs.lstatSync(flagPath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_FLAG_BYTES) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd;
    let out;
    try {
      fd = fs.openSync(flagPath, flags);
      const buf = Buffer.alloc(MAX_FLAG_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0);
      out = buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const raw = out.trim().toLowerCase();
    if (!VALID_MODES.includes(raw)) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

// Symlink-safe append. Same parent-dir + symlink-target rules as safeWriteFlag,
// but opens with O_APPEND so concurrent writers from different sessions don't
// clobber each other. Used for the mode transition log.
// Silent-fails on any filesystem error.
function appendFlag(filePath, line) {
  const debug = process.env.CAVEMAN_DEBUG === '1';
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    let realDir;
    try {
      const lstat = fs.lstatSync(dir);
      if (lstat.isSymbolicLink()) {
        realDir = fs.realpathSync(dir);
        const realStat = fs.statSync(realDir);
        if (!realStat.isDirectory()) return;
        const home = os.homedir();
        const normalized = path.resolve(realDir).toLowerCase();
        const normalizedHome = path.resolve(home).toLowerCase();
        if (!normalized.startsWith(normalizedHome + path.sep) && normalized !== normalizedHome) return;
      } else {
        realDir = dir;
      }
    } catch (e) {
      return;
    }

    const realPath = path.join(realDir, path.basename(filePath));
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(realPath, flags, 0o600);
      fs.writeSync(fd, String(line).replace(/\n$/, '') + '\n');
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (e) {
    // Silent fail — history is best-effort
  }
}

// Mode-transition log (#601). Whenever the active-mode flag actually changes,
// append {ts, mode, prev} to <agent>/mode-log.jsonl so caveman-stats can
// attribute output tokens to the mode that was active when each message was
// generated. mode/prev are a VALID_MODES string or null (null = caveman off).
// No-op when the mode is unchanged; best-effort like all flag IO.
function recordModeChange(newMode) {
  try {
    const flagPath = getAgentFlagPath();
    const current = readFlag(flagPath);
    const next = newMode || null;
    if ((current || null) === next) return;
    appendFlag(
      getAgentModeLogPath(),
      JSON.stringify({ ts: Date.now(), mode: next, prev: current || null })
    );
  } catch (e) {
    // Silent fail — the log is best-effort
  }
}

// Symlink-safe history read. Returns lines (untrimmed) or empty array on any
// anomaly. Caller is responsible for parsing JSON.
function readHistory(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd;
    let raw;
    try {
      fd = fs.openSync(filePath, flags);
      raw = fs.readFileSync(fd, 'utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return raw.split('\n').filter(line => line.trim());
  } catch (e) {
    return [];
  }
}

module.exports = {
  getDefaultMode, getConfigDir, getConfigPath, findRepoConfigPath,
  VALID_MODES, safeWriteFlag, readFlag, appendFlag, readHistory,
  recordModeChange,
  AGENT_ID, homeDir, getCavemanRoot, getAgentDataDir,
  getAgentFlagPath, getAgentPrevFlagPath, getAgentModeLogPath,
  getAgentLifetimeFile, getAgentSnapshotFile, getAgentCounterFile,
  migrateLegacyFiles
};
