#!/usr/bin/env node
// statusline.js — Caveman mode status line for Qwen Code.
//
// Qwen Code contract (statusLine API under ui.statusLine in settings.json):
//   - stdin: JSON with { cwd, workspace.current_dir, model.display_name,
//     session_id, context_window, metrics, cost, ... }
//   - stdout: first line(s) become the status line text. ANSI colors supported
//     (set respectUserColors:true in settings to preserve them).
//   - Called on message/file changes (~300ms debounce); refreshInterval for
//     time-based updates.
//   - Windows note: Qwen runs commands via cmd.exe by default — the installer
//     wraps the command in `node "..."` so this works cross-platform.
//
// Data sources:
//   - Current caveman mode via ~/.caveman/qwen/active
//   - Lifetime token savings via ~/.caveman/qwen/lifetime-saved.json
//   - Session snapshot via ~/.caveman/qwen/session-snapshot.json (written by Stop hook)
//   - User display preferences via ~/.caveman/config.json (statusline section)
//   - Git branch via `git -C <cwd> branch --show-current`
//   - Working directory basename from stdin's cwd field
//   - Cost from stdin's cost.total_cost_usd (object, defensive, may be absent)
//   - Context window from stdin's context_window/metrics (defensive, may be absent)
//
// Agent-isolated: data stored under ~/.caveman/qwen/ so multiple agents running
// on the same machine never share or clobber each other's stats.
// Tolerates missing files, non-git directories, and malformed stdin.
// Any error → output empty string (Qwen Code displays nothing, not broken).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const MAX_INPUT_BYTES = 1024 * 1024;

// ── Agent identity (hardcoded per build) ─────────────────────────────────────
const AGENT_ID = 'qwen';

// ── Paths ───────────────────────────────────────────────────────────────────

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const cavemanRoot = path.join(homeDir, '.caveman');
const agentDir = path.join(cavemanRoot, AGENT_ID);
const flagPath = path.join(agentDir, 'active');
const lifetimeFile = path.join(agentDir, 'lifetime-saved.json');
const snapshotFile = path.join(agentDir, 'session-snapshot.json');
const configFile = path.join(cavemanRoot, 'config.json'); // shared across agents

// ── ANSI colors ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Safely read a JSON file, return null on any failure. */
function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Safely read a text file, return null on any failure. */
function readText(file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Get current caveman mode from the flag file. Returns null if off/absent. */
function getCurrentMode() {
  try {
    const st = fs.lstatSync(flagPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > 64) return null;
    const raw = fs.readFileSync(flagPath, 'utf-8').trim().toLowerCase();
    const VALID_MODES = [
      'off', 'lite', 'full', 'ultra',
      'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
      'commit', 'review', 'compress',
    ];
    if (!VALID_MODES.includes(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Get lifetime token savings from the badge file. Returns null if absent. */
function getLifetimeSavings() {
  const data = readJson(lifetimeFile);
  if (!data || typeof data.lifetimeSaved !== 'number') return null;
  return data.lifetimeSaved;
}

/** Get session snapshot data. Returns null if absent. */
function getSessionSnapshot() {
  return readJson(snapshotFile);
}

/** Get git branch name for a directory. Returns null if not in a git repo. */
function getGitBranch(cwd) {
  if (!cwd) return null;
  try {
    const out = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Format a number in human-readable short form (e.g. 12345 → "12.3k"). */
function formatShort(n) {
  if (n == null || n === 0) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/** Format a percentage string (e.g. 65 → "65%"). Returns null if invalid. */
function formatPct(n) {
  if (n == null || n <= 0) return null;
  return String(Math.round(n)) + '%';
}

// ── User config ─────────────────────────────────────────────────────────────

/** Load user preferences from ~/.caveman/config.json statusline section. */
function loadUserPrefs() {
  const config = readJson(configFile);
  const prefs = (config && config.statusline) || {};
  return {
    showMode: prefs.showMode !== false,
    showDir: prefs.showDir !== false,
    showGit: prefs.showGit !== false,
    showSavings: prefs.showSavings !== false,
    showModel: prefs.showModel === true,
    showSessionTokens: prefs.showSessionTokens !== false,
    showSessionSaved: prefs.showSessionSaved !== false,
    showCost: prefs.showCost === true,
    showContext: prefs.showContext === true,
    modeColor: prefs.modeColor || C.green,
    dirColor: prefs.dirColor || C.blue,
    gitColor: prefs.gitColor || C.green,
    savingsColor: prefs.savingsColor || C.yellow,
    modelColor: prefs.modelColor || C.cyan,
    sessionTokensColor: prefs.sessionTokensColor || C.magenta,
    sessionSavedColor: prefs.sessionSavedColor || C.green,
    costColor: prefs.costColor || C.yellow,
    contextColor: prefs.contextColor || C.cyan,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let raw = '';
  let inputBytes = 0;
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) {
    inputBytes += Buffer.byteLength(chunk, 'utf8');
    if (inputBytes > MAX_INPUT_BYTES) {
      process.stdout.write('');
      return;
    }
    raw += chunk;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write('');
    return;
  }

  const prefs = loadUserPrefs();

  const mode = getCurrentMode();
  const cwd = input.cwd || input.workspace?.current_dir || '';
  const dirName = cwd ? path.basename(cwd) : '';
  const branch = getGitBranch(cwd);
  const savings = getLifetimeSavings();
  const modelName = input.model?.display_name || input.model?.id || '';
  const snapshot = getSessionSnapshot();

  // Cost is an object { total_cost_usd, ... } per the statusline contract.
  const cost = input.cost?.total_cost_usd || null;
  const ctxWindow = input.context_window || input.metrics?.context_window || null;
  const ctxUsed = input.metrics?.total_tokens || null;

  const parts = [];

  if (prefs.showMode) {
    const modeText = mode || 'off';
    const isActive = mode && mode !== 'off';
    const color = isActive ? prefs.modeColor : C.gray;
    parts.push(`${color}⛏ ${modeText}${C.reset}`);
  }

  if (prefs.showDir && dirName) {
    parts.push(`${prefs.dirColor}📁 ${dirName}${C.reset}`);
  }

  if (prefs.showGit && branch) {
    parts.push(`${prefs.gitColor}🌿 ${branch}${C.reset}`);
  }

  if (prefs.showSessionTokens && snapshot) {
    const inShort = formatShort(snapshot.input);
    const outShort = formatShort(snapshot.output);
    if (inShort && outShort) {
      parts.push(`${prefs.sessionTokensColor}📊 ${inShort}→${outShort}${C.reset}`);
    }
  }

  if (prefs.showSessionSaved && snapshot) {
    const savedShort = formatShort(snapshot.saved);
    const pct = formatPct(snapshot.pct);
    if (savedShort) {
      const label = pct ? `${savedShort} (${pct})` : savedShort;
      parts.push(`${prefs.sessionSavedColor}💡 ${label}${C.reset}`);
    }
  }

  if (prefs.showCost && cost != null && cost > 0) {
    // Up to 4 decimal places, trim trailing zeros but keep at least one digit
    // after the decimal point (so $5.00 → "5.0", not "5" — a bare integer
    // looks like a token count, not money).
    const costStr = cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
    parts.push(`${prefs.costColor}💲 ${costStr}${C.reset}`);
  }

  if (prefs.showContext && ctxWindow && ctxUsed != null) {
    const remaining = Math.max(0, Math.round((1 - ctxUsed / ctxWindow) * 100));
    parts.push(`${prefs.contextColor}📉 ${remaining}%${C.reset}`);
  }

  if (prefs.showSavings && savings != null && savings > 0) {
    const short = formatShort(Math.round(savings));
    if (short) {
      parts.push(`${prefs.savingsColor}💰 ${short}${C.reset}`);
    }
  }

  if (prefs.showModel && modelName) {
    parts.push(`${prefs.modelColor}🤖 ${modelName}${C.reset}`);
  }

  const line = parts.join('  ');
  process.stdout.write(line + '\n');
}

main().catch(() => {
  process.stdout.write('');
});
