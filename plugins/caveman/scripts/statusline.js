#!/usr/bin/env node
// statusline.js — Caveman mode status line (host-agnostic: CodeBuddy / Qwen / ...).
//
// Host contract (statusLine command in settings.json):
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
//   - Current caveman mode via ~/.caveman/<agent>/active
//   - Lifetime token savings via ~/.caveman/<agent>/lifetime-saved.json
//   - Session snapshot via ~/.caveman/<agent>/session-snapshot.json (written by Stop hook)
//   - User display preferences via ~/.caveman/config.json (statusline section)
//   - Git branch via `git -C <cwd> branch --show-current`
//   - Working directory basename from stdin's cwd field
//   - Cost from stdin's cost.total_cost_usd (object, defensive, may be absent)
//   - Context window from stdin's context_window/metrics (defensive, may be absent)
//
// Agent-isolated: each host (codebuddy/qwen/qoder/trae/zcode) writes its state
// under ~/.caveman/<agent>/ so multiple agents on the same machine never clobber
// each other. This shared script discovers the live agent at runtime instead of
// assuming one (the old hardcoded 'qwen' made CodeBuddy's state invisible).
// Tolerates missing files, non-git directories, and malformed stdin.
// Any error → output empty string (host displays nothing, not broken).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const MAX_INPUT_BYTES = 1024 * 1024;

// ── Agent identity (discovered at runtime) ──────────────────────────────────
// The caveman plugin ships per-agent hook dirs (codebuddy/qwen/qoder/trae/zcode)
// that each write state under ~/.caveman/<agent>/. This shared statusline script
// must find which agent is live rather than assuming one.
const KNOWN_AGENTS = ['codebuddy', 'qwen', 'qoder', 'trae', 'zcode'];

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const cavemanRoot = path.join(homeDir, '.caveman');

function detectAgentId() {
  // 1) Explicit override — handy for testing or custom hosts.
  if (process.env.CAVEMAN_AGENT) return process.env.CAVEMAN_AGENT;

  // 2) Host env hints (CodeBuddy sets these for its CLI session).
  if (process.env.CODEBUDDY_TMUX_SESSION !== undefined ||
      process.env.CODEBUDDY_INSTANCE_META_PURPOSE !== undefined) {
    return 'codebuddy';
  }

  // 3) Whichever agent has a live `active` flag on disk wins.
  for (const id of KNOWN_AGENTS) {
    try {
      if (fs.statSync(path.join(cavemanRoot, id, 'active')).isFile()) return id;
    } catch { /* not present */ }
  }

  // 4) Fallback to the historical default.
  return 'qwen';
}

const AGENT_ID = detectAgentId();

// ── Paths ───────────────────────────────────────────────────────────────────

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

/** Round to an integer 0-100, or null if not a finite number. */
function clampPct(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Remaining context percentage. Host payloads differ:
 *   - Claude Code: context_window is a number, metrics.total_tokens is the usage.
 *   - CodeBuddy: context_window is an object with context_window_size,
 *     total_input_tokens, current_usage and pre-computed *_percentage fields.
 * Returns null when the host sends neither shape.
 */
function getRemainingContextPct(ctx, usedTokens) {
  if (ctx == null) return null;

  if (typeof ctx === 'object') {
    if (typeof ctx.remaining_percentage === 'number') {
      return clampPct(ctx.remaining_percentage);
    }
    if (typeof ctx.used_percentage === 'number') {
      return clampPct(100 - ctx.used_percentage);
    }
    const size = ctx.context_window_size;
    const used = ctx.current_usage?.input_tokens ?? ctx.total_input_tokens;
    if (typeof size === 'number' && size > 0 && typeof used === 'number') {
      return clampPct((1 - used / size) * 100);
    }
    return null;
  }

  if (typeof ctx === 'number' && ctx > 0 && typeof usedTokens === 'number') {
    return clampPct((1 - usedTokens / ctx) * 100);
  }
  return null;
}

/**
 * Live input/output token counts from the host payload. CodeBuddy puts session
 * totals on the context_window object; the per-turn numbers live under
 * current_usage. Returns null when the host sends neither.
 */
function getLiveTokens(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const input = ctx.total_input_tokens ?? ctx.current_usage?.input_tokens;
  const output = ctx.total_output_tokens ?? ctx.current_usage?.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (input === 0 && output === 0) return null;
  return { input, output };
}

/** Format a millisecond duration as "1h2m", "12m3s" or "45s". */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
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
    showDuration: prefs.showDuration === true,
    showLines: prefs.showLines === true,
    modeColor: prefs.modeColor || C.green,
    dirColor: prefs.dirColor || C.blue,
    gitColor: prefs.gitColor || C.green,
    savingsColor: prefs.savingsColor || C.yellow,
    modelColor: prefs.modelColor || C.cyan,
    sessionTokensColor: prefs.sessionTokensColor || C.magenta,
    sessionSavedColor: prefs.sessionSavedColor || C.green,
    costColor: prefs.costColor || C.yellow,
    contextColor: prefs.contextColor || C.cyan,
    durationColor: prefs.durationColor || C.gray,
    linesColor: prefs.linesColor || C.green,
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
  const ctxRaw = input.context_window ?? input.metrics?.context_window ?? null;
  const ctxRemainingPct = getRemainingContextPct(ctxRaw, input.metrics?.total_tokens);
  const liveTokens = getLiveTokens(ctxRaw);
  const durationMs = input.cost?.total_duration_ms;
  const linesAdded = input.cost?.total_lines_added || 0;
  const linesRemoved = input.cost?.total_lines_removed || 0;

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

  if (prefs.showSessionTokens) {
    // Prefer the host's live counts — the snapshot is only written by the Stop
    // hook, so it stays at zero for the whole of the first session.
    const tokens = liveTokens || snapshot;
    const inShort = formatShort(tokens?.input);
    const outShort = formatShort(tokens?.output);
    if (inShort && outShort) {
      parts.push(`${prefs.sessionTokensColor}📊 ${inShort}→${outShort}${C.reset}`);
    }
  }

  if (prefs.showSessionSaved && snapshot) {
    // Token count only — no percentage. snapshot.pct is derived from a fixed
    // BASELINE_OUTPUT_MULTIPLIER, so it algebraically reduces to the same
    // constant on every session and carries no information.
    const savedShort = formatShort(snapshot.saved);
    if (savedShort) {
      parts.push(`${prefs.sessionSavedColor}💡 ${savedShort}${C.reset}`);
    }
  }

  if (prefs.showCost && cost != null && cost > 0) {
    // Up to 4 decimal places, trim trailing zeros but keep at least one digit
    // after the decimal point (so $5.00 → "5.0", not "5" — a bare integer
    // looks like a token count, not money).
    const costStr = cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
    parts.push(`${prefs.costColor}💲 ${costStr}${C.reset}`);
  }

  if (prefs.showDuration) {
    const dur = formatDuration(durationMs);
    if (dur) parts.push(`${prefs.durationColor}⏱ ${dur}${C.reset}`);
  }

  if (prefs.showLines && (linesAdded > 0 || linesRemoved > 0)) {
    parts.push(`${prefs.linesColor}📝 +${linesAdded}/-${linesRemoved}${C.reset}`);
  }

  if (prefs.showContext && ctxRemainingPct != null) {
    parts.push(`${prefs.contextColor}📉 ${ctxRemainingPct}%${C.reset}`);
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
