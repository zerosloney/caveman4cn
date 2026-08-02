// caveman-config.ts — Cline SDK Plugin configuration
//
// Manages caveman mode state for Cline. Data stored in ~/.caveman/cline/
// to keep it isolated from other agents.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const VALID_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress'
] as const;

export type CavemanMode = typeof VALID_MODES[number];

const AGENT_ID = 'cline';

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function getCavemanRoot(): string {
  return path.join(homeDir(), '.caveman');
}

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

// Symlink-safe flag write
export function safeWriteFlag(filePath: string, content: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    let realDir: string;
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
    } catch {
      return;
    }

    const realPath = path.join(realDir, path.basename(filePath));
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(realPath, flags, 0o600);
      fs.writeSync(fd, content + '\n');
      try { fs.fchmodSync(fd, 0o600); } catch { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch {
    // Silent fail
  }
}

export function readFlag(filePath: string): string | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd: number | undefined;
    let content: string;
    try {
      fd = fs.openSync(filePath, flags);
      content = fs.readFileSync(fd, 'utf8').trim();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return VALID_MODES.includes(content as CavemanMode) ? content : null;
  } catch {
    return null;
  }
}

export function getDefaultMode(): string {
  // 1. Environment variable
  const envMode = process.env.CAVEMAN_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode as CavemanMode)) {
    return envMode === 'off' ? 'off' : envMode;
  }

  // 2. User config file
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode)) {
      return config.defaultMode === 'off' ? 'off' : config.defaultMode;
    }
  } catch {
    // No config or invalid
  }

  // 3. Default
  return 'full';
}

export function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'caveman');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'caveman');
  }
  return path.join(os.homedir(), '.config', 'caveman');
}

// Record mode transition to log
export function recordModeChange(newMode: string | null): void {
  try {
    const flagPath = getAgentFlagPath();
    const current = readFlag(flagPath);
    const next = newMode || null;
    if ((current || null) === next) return;

    const dir = getAgentDataDir();
    fs.mkdirSync(dir, { recursive: true });

    const logLine = JSON.stringify({ ts: Date.now(), mode: next, prev: current || null });
    fs.appendFileSync(getAgentModeLogPath(), logLine + '\n');
  } catch {
    // Silent fail
  }
}

export function isCavemanActive(): boolean {
  return readFlag(getAgentFlagPath()) !== null;
}

export function getCurrentMode(): string | null {
  return readFlag(getAgentFlagPath());
}

export function activateMode(mode: string): void {
  safeWriteFlag(getAgentFlagPath(), mode);
  recordModeChange(mode);
}

export function deactivateMode(): void {
  try {
    const flagPath = getAgentFlagPath();
    if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    const prevPath = getAgentPrevFlagPath();
    if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
    recordModeChange(null);
  } catch {
    // Silent fail
  }
}
