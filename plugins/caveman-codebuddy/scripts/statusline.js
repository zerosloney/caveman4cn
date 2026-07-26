#!/usr/bin/env node
// statusline.js — Caveman mode status line for CodeBuddy Code.
//
// CodeBuddy contract (statusLine API):
//   - stdin: JSON with { cwd, model, cost, session_id, workspace, ... }
//   - stdout: first line becomes the status line text. ANSI colors supported.
//   - Called every ~300ms on message changes.
//
// Data sources:
//   - Current caveman mode via ~/.caveman-active (readFlag from caveman-config)
//   - Lifetime token savings via ~/.caveman/lifetime-saved.json
//   - User display preferences via ~/.caveman/config.json (statusline section)
//   - Git branch via `git -C <cwd> branch --show-current`
//   - Working directory basename from stdin's cwd field
//
// Tolerates missing files, non-git directories, and malformed stdin.
// Any error → output empty string (CodeBuddy displays nothing, not broken).

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Paths ───────────────────────────────────────────────────────────────────

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');
const lifetimeFile = path.join(homeDir, '.caveman', 'lifetime-saved.json');
const configFile = path.join(homeDir, '.caveman', 'config.json');

// ── ANSI colors ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
  // Replicate readFlag logic from caveman-config.js inline to avoid
  // relative-require fragility when the script is installed elsewhere.
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

/** Get git branch name for a directory. Returns null if not in a git repo. */
function getGitBranch(cwd) {
  try {
    const out = execSync('git -C "' + cwd + '" branch --show-current 2>/dev/null', {
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

// ── User config ─────────────────────────────────────────────────────────────

/** Load user preferences from ~/.caveman/config.json statusline section. */
function loadUserPrefs() {
  const config = readJson(configFile);
  const prefs = (config && config.statusline) || {};
  return {
    showMode: prefs.showMode !== false,   // default true
    showDir: prefs.showDir !== false,      // default true
    showGit: prefs.showGit !== false,      // default true
    showSavings: prefs.showSavings !== false, // default true
    showModel: prefs.showModel === true,   // default false
    modeColor: prefs.modeColor || C.green,
    dirColor: prefs.dirColor || C.blue,
    gitColor: prefs.gitColor || C.green,
    savingsColor: prefs.savingsColor || C.yellow,
    modelColor: prefs.modelColor || C.cyan,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read stdin JSON from CodeBuddy
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Malformed stdin → show nothing
    process.stdout.write('');
    return;
  }

  // 2. Load user preferences
  const prefs = loadUserPrefs();

  // 3. Gather data
  const mode = getCurrentMode();
  const cwd = input.cwd || input.workspace?.current_dir || '';
  const dirName = cwd ? path.basename(cwd) : '';
  const branch = getGitBranch(cwd);
  const savings = getLifetimeSavings();
  const modelName = input.model?.display_name || input.model?.id || '';

  // 4. Build status line parts
  const parts = [];

  // Mode indicator: ⛏ [mode] or ⛏ [off] (gray)
  if (prefs.showMode) {
    const modeText = mode || 'off';
    const isActive = mode && mode !== 'off';
    const color = isActive ? prefs.modeColor : C.gray;
    parts.push(`${color}⛏ ${modeText}${C.reset}`);
  }

  // Directory: 📁 dirname
  if (prefs.showDir && dirName) {
    parts.push(`${prefs.dirColor}📁 ${dirName}${C.reset}`);
  }

  // Git branch: 🌿 branch
  if (prefs.showGit && branch) {
    parts.push(`${prefs.gitColor}🌿 ${branch}${C.reset}`);
  }

  // Token savings: 💰 12.4k
  if (prefs.showSavings && savings != null && savings > 0) {
    const short = formatShort(Math.round(savings));
    if (short) {
      parts.push(`${prefs.savingsColor}💰 ${short}${C.reset}`);
    }
  }

  // Model name: 🤖 model
  if (prefs.showModel && modelName) {
    parts.push(`${prefs.modelColor}🤖 ${modelName}${C.reset}`);
  }

  // 5. Output
  const line = parts.join('  ');
  process.stdout.write(line + '\n');
}

main().catch(() => {
  // Any unexpected error → output nothing, never break CodeBuddy
  process.stdout.write('');
});