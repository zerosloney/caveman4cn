// caveman — OMP configuration resolver (oh-my-pi build)
//
// Resolution order for default mode:
//   1. CAVEMAN_DEFAULT_MODE environment variable
//   2. Repo-local config (checked-in, per-project default):
//      - <cwd>/.caveman/config.json
//      - <cwd>/.caveman.json
//      Walks up from process.cwd() to the nearest ancestor containing one of
//      these (stops at filesystem root).
//   3. User config file defaultMode field:
//      - $XDG_CONFIG_HOME/caveman/config.json (any platform, if set)
//      - %APPDATA%\caveman\config.json (Windows)
//      - ~/.config/caveman/config.json (macOS / Linux fallback)
//   4. 'full'
//
// Ported from shared/caveman-config.template.js. Symlink-safe flag IO,
// size caps, VALID_MODES whitelist. On Windows, uid checks are unavailable
// — falls back to verifying the resolved path lives under the user's home
// directory.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const VALID_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress',
] as const;

export type CavemanMode = (typeof VALID_MODES)[number];

// ── Per-agent data isolation ─────────────────────────────────────────────────
// Each coding agent keeps its own state under ~/.caveman/<agent>/ so multiple
// agents running on the same machine never clobber each other's mode flag,
// mode-log, or lifetime-saved badge.
export const AGENT_ID = 'omp';

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '.';
}

/** Root caveman data dir (shared across agents for config.json only). */
function getCavemanRoot(): string {
  return path.join(homeDir(), '.caveman');
}

/** Per-agent data dir: ~/.caveman/<agent>/ */
export function getAgentDataDir(): string {
  return path.join(getCavemanRoot(), AGENT_ID);
}

export function getAgentFlagPath(): string {
  return path.join(getAgentDataDir(), 'active');
}

export function getAgentPrevFlagPath(): string {
  return path.join(getAgentDataDir(), 'active.prev');
}

export function getAgentModeLogPath(): string {
  return path.join(getAgentDataDir(), 'mode-log.jsonl');
}

export function getAgentLifetimeFile(): string {
  return path.join(getAgentDataDir(), 'lifetime-saved.json');
}

export function getAgentSnapshotFile(): string {
  return path.join(getAgentDataDir(), 'session-snapshot.json');
}

export function getAgentCounterFile(): string {
  return path.join(getAgentDataDir(), 'caveman-stop-counter');
}

// ── Migration ────────────────────────────────────────────────────────────────
// One-time migration from the legacy flat layout (~/.caveman-active,
// ~/.caveman/lifetime-saved.json) into this agent's subdirectory. Idempotent:
// skips any file that already exists in the agent dir. Leaves the legacy files
// in place so other agents can still migrate from them on their first run.
// Best-effort, silent on failure.
export function migrateLegacyFiles(): void {
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
          if (VALID_MODES.includes(raw as CavemanMode)) safeWriteFlag(newFlag, raw);
        }
      } catch {
        /* legacy flag absent — nothing to migrate */
      }
    }

    // 2. Previous-mode flag: ~/.caveman-active.prev -> <agent>/active.prev
    const legacyPrev = path.join(homeDir(), '.caveman-active.prev');
    const newPrev = getAgentPrevFlagPath();
    if (!fs.existsSync(newPrev)) {
      try {
        const st = fs.lstatSync(legacyPrev);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 64) {
          const raw = fs.readFileSync(legacyPrev, 'utf-8').trim().toLowerCase();
          if (VALID_MODES.includes(raw as CavemanMode)) safeWriteFlag(newPrev, raw);
        }
      } catch {
        /* absent — skip */
      }
    }

    // 3. Lifetime savings: ~/.caveman/lifetime-saved.json -> <agent>/lifetime-saved.json
    const legacyLifetime = path.join(getCavemanRoot(), 'lifetime-saved.json');
    try {
      const legacyRaw = fs.readFileSync(legacyLifetime, 'utf-8');
      const legacy = JSON.parse(legacyRaw);
      if (legacy && typeof legacy.lifetimeSaved === 'number') {
        let prev = 0;
        try {
          const cur = JSON.parse(fs.readFileSync(getAgentLifetimeFile(), 'utf-8'));
          if (cur && typeof cur.lifetimeSaved === 'number') prev = cur.lifetimeSaved;
        } catch {
          /* no existing agent file */
        }
        const merged = Math.max(prev, legacy.lifetimeSaved);
        if (merged > 0) {
          fs.writeFileSync(
            getAgentLifetimeFile(),
            JSON.stringify({ lifetimeSaved: merged, updatedAt: new Date().toISOString() }),
          );
        }
      }
    } catch {
      /* legacy lifetime file absent or invalid — skip */
    }

    // 4. Mode-transition log: ~/.caveman-mode-log.jsonl -> <agent>/mode-log.jsonl
    const legacyLog = path.join(homeDir(), '.caveman-mode-log.jsonl');
    const newLog = getAgentModeLogPath();
    if (!fs.existsSync(newLog)) {
      try {
        const raw = fs.readFileSync(legacyLog, 'utf-8');
        if (raw.trim()) {
          appendFlag(newLog, raw.trim());
        }
      } catch {
        /* absent — skip */
      }
    }
  } catch {
    // Migration is best-effort; never block session start.
  }
}

// ── Config resolution ────────────────────────────────────────────────────────

function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'caveman');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'caveman',
    );
  }
  return path.join(os.homedir(), '.config', 'caveman');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/** Walk up from `start` looking for a repo-local caveman config. */
function findRepoConfigPath(start?: string): string | null {
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
        } catch {
          // not present, try next candidate
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    // Defensive: any cwd / fs failure → no repo config
  }
  return null;
}

function readModeFromConfigFile(configPath: string): string | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (
      config &&
      config.defaultMode &&
      VALID_MODES.includes(String(config.defaultMode).toLowerCase() as CavemanMode)
    ) {
      return String(config.defaultMode).toLowerCase();
    }
  } catch {
    // Missing / unreadable / invalid JSON → caller falls through
  }
  return null;
}

export function getDefaultMode(): string {
  // 1. Environment variable (highest priority)
  const envMode = process.env.CAVEMAN_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase() as CavemanMode)) {
    return envMode.toLowerCase();
  }

  // 2. Repo-local config
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

// ── Symlink-safe flag IO ─────────────────────────────────────────────────────

const MAX_FLAG_BYTES = 64;

/** Write mode flag atomically via temp + rename. Symlink-safe. */
export function safeWriteFlag(flagPath: string, content: string): void {
  const debug = process.env.CAVEMAN_DEBUG === '1';
  try {
    const flagDir = path.dirname(flagPath);
    fs.mkdirSync(flagDir, { recursive: true });

    // Resolve symlink parent dir and verify it's under home
    const realFlagDir = resolveRealDir(flagDir, debug);
    if (!realFlagDir) return;

    // The flag file itself must never be a symlink
    const realFlagPath = path.join(realFlagDir, path.basename(flagPath));
    try {
      if (fs.lstatSync(realFlagPath).isSymbolicLink()) return;
    } catch (e: unknown) {
      if (isNodeError(e) && e.code !== 'ENOENT') return;
    }

    const tempPath = path.join(realFlagDir, `.caveman-active.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
      try {
        fs.fchmodSync(fd, 0o600);
      } catch {
        /* best-effort on Windows */
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realFlagPath);
  } catch {
    // Silent fail — flag is best-effort
  }
}

/** Read mode flag. Symlink-safe, size-capped, whitelist-validated. */
export function readFlag(flagPath: string): string | null {
  try {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(flagPath);
    } catch {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_FLAG_BYTES) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd: number | undefined;
    let out: string;
    try {
      fd = fs.openSync(flagPath, flags);
      const buf = Buffer.alloc(MAX_FLAG_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0);
      out = buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const raw = out.trim().toLowerCase();
    if (!VALID_MODES.includes(raw as CavemanMode)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Append a line to a flag file (for mode transition log). */
export function appendFlag(filePath: string, line: string): void {
  const debug = process.env.CAVEMAN_DEBUG === '1';
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const realDir = resolveRealDir(dir, debug);
    if (!realDir) return;

    const realPath = path.join(realDir, path.basename(filePath));
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return;
    } catch (e: unknown) {
      if (isNodeError(e) && e.code !== 'ENOENT') return;
    }

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(realPath, flags, 0o600);
      fs.writeSync(fd, String(line).replace(/\n$/, '') + '\n');
      try {
        fs.fchmodSync(fd, 0o600);
      } catch {
        /* best-effort on Windows */
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch {
    // Silent fail — history is best-effort
  }
}

/** Read history lines from a flag file. */
export function readHistory(filePath: string): string[] {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd: number | undefined;
    let raw: string;
    try {
      fd = fs.openSync(filePath, flags);
      raw = fs.readFileSync(fd, 'utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return raw.split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
}

/** Record a mode transition in the mode log. */
export function recordModeChange(newMode: string | null): void {
  try {
    const flagPath = getAgentFlagPath();
    const current = readFlag(flagPath);
    const next = newMode || null;
    if ((current || null) === next) return;
    appendFlag(
      getAgentModeLogPath(),
      JSON.stringify({ ts: Date.now(), mode: next, prev: current || null }),
    );
  } catch {
    // Silent fail — the log is best-effort
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface NodeError {
  code?: string;
}

function isNodeError(e: unknown): e is NodeError {
  return e instanceof Error && 'code' in e;
}

function resolveRealDir(dir: string, debug: boolean): string | null {
  try {
    const lstat = fs.lstatSync(dir);
    if (lstat.isSymbolicLink()) {
      const realDir = fs.realpathSync(dir);
      const realStat = fs.statSync(realDir);
      if (!realStat.isDirectory()) {
        if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${realDir} is not a directory\n`);
        return null;
      }
      const home = os.homedir();
      const normalizedReal = path.resolve(realDir).toLowerCase();
      const normalizedHome = path.resolve(home).toLowerCase();
      if (!normalizedReal.startsWith(normalizedHome + path.sep) && normalizedReal !== normalizedHome) {
        if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${normalizedReal} is outside home directory ${normalizedHome}\n`);
        return null;
      }
      return realDir;
    }
    return dir;
  } catch {
    return null;
  }
}