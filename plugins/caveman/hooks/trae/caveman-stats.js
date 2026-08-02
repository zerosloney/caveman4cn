#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats (Trae build).
//
// Trae's session-log directory is NOT documented (as of 2026-07). We probe
// multiple candidate locations and recursively find .jsonl transcripts:
//   - ~/.trae-cn/                  (Trae CN default global dir)
//   - ~/.trae/                     (Trae international candidate)
//   - $APPDATA/Trae*/              (Windows app-data candidates)
//   - $XDG_DATA_HOME/trae*/        (Linux candidates)
//
// Token-usage extraction is defensive: it tries every shape we've seen across
// zcode/CodeBuddy/Claude (payload.usage, providerData.rawUsage, top-level
// usage), so it keeps working if Trae's schema matches any of them.
//
// Exported: computeStats(opts) -> { turns, input, output, saved, found }
//           formatStats(stats)   -> string
//
// Used by user-prompt.js (UserPromptSubmit hook). Zero npm deps; tolerates
// missing/partial logs. If no transcript is found, reports a friendly
// "not found yet" message instead of crashing.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } = require('./caveman-config');

const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';

// Candidate root directories that may hold Trae session transcripts.
// We glob each (recursively) for *.jsonl files. Order is best-guess
// likelihood: the documented global dir first.
function candidateRoots() {
  const roots = [];
  const pushIfExists = (p) => {
    try {
      if (p && fs.existsSync(p)) roots.push(p);
    } catch {}
  };

  // 1. ~/.trae-cn/ (Trae CN default global dir — documented for skills/commands/hooks)
  pushIfExists(path.join(home, '.trae-cn'));
  // 2. ~/.trae/ (Trae international candidate)
  pushIfExists(path.join(home, '.trae'));

  // 3. Windows %APPDATA%\Trae*\  (case variants + version suffixes)
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (appData) {
    try {
      for (const name of fs.readdirSync(appData)) {
        if (/^trae/i.test(name)) {
          pushIfExists(path.join(appData, name));
        }
      }
    } catch {}
  }

  // 4. $XDG_DATA_HOME/trae* or ~/.local/share/trae* (Linux)
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  if (xdg) {
    try {
      for (const name of fs.readdirSync(xdg)) {
        if (/^trae/i.test(name)) {
          pushIfExists(path.join(xdg, name));
        }
      }
    } catch {}
  }

  return roots;
}

// Per-agent data dir: ~/.caveman/trae/
const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

// Assumed verbose-to-caveman output ratio, calibrated for ~30% output savings.
// There is no control run behind it: nothing here measures what the same
// prompts would have cost without caveman. Used only for the "Est. saved" line.
const BASELINE_OUTPUT_MULTIPLIER = 1.43;

// Bounded recursive walk: collect .jsonl files up to a depth limit and a total
// file cap to defend against pathological trees.
const MAX_DEPTH = 5;
const MAX_FILES = 5000;

function walkForJsonl(dir, depth, acc) {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip obviously-irrelevant subtrees to keep the walk fast.
      if (/^(node_modules|\.git|\.cache|extensions|logs?)$/i.test(e.name)) continue;
      walkForJsonl(full, depth + 1, acc);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      acc.push(full);
    }
  }
}

function listTranscripts() {
  const out = [];
  for (const root of candidateRoots()) {
    walkForJsonl(root, 0, out);
  }
  return out;
}

// Find the "current" session transcript: the most recently modified non-empty
// .jsonl across all candidate roots. Empty (just-created) session files are
// skipped so /caveman-stats reports the last real conversation, not a stub.
function findCurrentTranscript() {
  let best = null;
  for (const full of listTranscripts()) {
    try {
      const stat = fs.statSync(full);
      if (stat.size === 0) continue;
      if (!best || stat.mtimeMs > best.mtime) best = { full, mtime: stat.mtimeMs };
    } catch {}
  }
  return best ? best.full : null;
}

// Extract a normalized usage object from a parsed JSONL record. Defensive: it
// tries every shape we've seen across hosts.
function extractUsage(rec) {
  if (!rec) return null;
  const candidates = [];
  if (rec.type === 'function_call' && rec.providerData) {
    candidates.push(rec.providerData.rawUsage);
  }
  if (rec.type === 'model_complete' && rec.payload) {
    candidates.push(rec.payload.usage);
  }
  if (rec.type === 'assistant' && rec.message) {
    candidates.push(rec.message.usage);
  }
  candidates.push(rec.usage);
  if (rec.payload) candidates.push(rec.payload.usage);
  if (rec.providerData) candidates.push(rec.providerData.usage);

  for (const u of candidates) {
    if (!u) continue;
    if (u.inputTokens != null || u.outputTokens != null) {
      return {
        inputTokens: u.inputTokens || 0,
        outputTokens: u.outputTokens || 0,
        cacheReadTokens: u.cacheReadTokens || 0,
        cacheWriteTokens: u.cacheWriteTokens || 0,
      };
    }
    if (u.prompt_tokens != null || u.completion_tokens != null) {
      const pd = u.prompt_tokens_details || {};
      const cd = u.completion_tokens_details || {};
      return {
        inputTokens: u.prompt_tokens || 0,
        outputTokens: u.completion_tokens || 0,
        cacheReadTokens: pd.cached_tokens || u.prompt_cache_hit_tokens || 0,
        cacheWriteTokens: u.prompt_cache_write_tokens || 0,
      };
    }
  }
  return null;
}

function sumUsage(transcriptFiles) {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 0,
  };
  let turns = 0;
  const seenTurns = new Set();

  for (const file of transcriptFiles) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const usage = extractUsage(rec);
      if (!usage) continue;
      totals.input += usage.inputTokens || 0;
      totals.output += usage.outputTokens || 0;
      totals.cacheRead += usage.cacheReadTokens || 0;
      totals.cacheWrite += usage.cacheWriteTokens || 0;
      totals.requests += 1;
      if (rec.turnId) seenTurns.add(rec.turnId);
    }
  }
  turns = seenTurns.size || totals.requests;
  return { totals, turns };
}

function computeStats(opts = {}) {
  const lifetime = !!opts.lifetime;
  let files;
  if (lifetime) {
    files = listTranscripts();
  } else {
    const cur = opts.transcript || findCurrentTranscript();
    files = cur ? [cur] : [];
  }
  if (!files.length) {
    return {
      turns: 0,
      input: 0,
      output: 0,
      saved: 0,
      requests: 0,
      cacheRead: 0,
      cacheWrite: 0,
      lifetime,
      found: false,
    };
  }
  const { totals, turns } = sumUsage(files);

  // Estimate, not a measurement: there is no non-caveman control run to compare
  // against, so this is just the real output scaled by a fixed constant. A
  // savings *percentage* derived from it would cancel out to the same number on
  // every session, which is why none is computed. formatStats says so plainly.
  const saved = Math.round(totals.output * (BASELINE_OUTPUT_MULTIPLIER - 1));

  return {
    turns,
    input: totals.input,
    output: totals.output,
    saved,
    requests: totals.requests,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    lifetime,
    found: true,
  };
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * Human-readable block. Turns/input/output are real receipts from the log.
 * "Est. saved" is a guess, and the trailing note says so — now ~30% output
 * savings.
 */
function formatStats(stats) {
  if (!stats.found) {
    return 'No Trae session log found yet. Run a few turns, then /caveman-stats again.';
  }
  const scope = stats.lifetime ? 'Lifetime' : 'Session';
  const extra = (BASELINE_OUTPUT_MULTIPLIER - 1).toFixed(2);
  return [
    `${scope}: ${fmt(stats.turns)} turns`,
    `Input:      ${fmt(stats.input)} tokens`,
    `Output:     ${fmt(stats.output)} tokens`,
    `Est. saved: ${fmt(stats.saved)} tokens`,
    '',
    'Turns, input and output are read from the session log. "Est. saved" is not',
    `measured: it assumes verbose output would run ${BASELINE_OUTPUT_MULTIPLIER}x longer, so it is`,
    `always ${extra}x the output above no matter how terse the replies really were.`,
  ].join('\n');
}

function writeLifetimeBadge(stats) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const prev = (() => {
      try {
        return JSON.parse(fs.readFileSync(LIFETIME_FILE, 'utf-8'));
      } catch {
        return { lifetimeSaved: 0 };
      }
    })();
    const lifetimeSaved = Math.max(prev.lifetimeSaved || 0, stats.saved);
    fs.writeFileSync(
      LIFETIME_FILE,
      JSON.stringify({ lifetimeSaved, updatedAt: new Date().toISOString() })
    );
  } catch {}
}

/**
 * Persist a current-session snapshot so the statusline can render near-real-time
 * per-session token usage without re-scanning transcripts on every (~300ms) call.
 * Written by the Stop hook at the end of each turn; best-effort, silent on fail.
 */
function writeSessionSnapshot(stats) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      turns: stats.turns || 0,
      input: stats.input || 0,
      output: stats.output || 0,
      saved: stats.saved || 0,
      requests: stats.requests || 0,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload));
  } catch {}
}

module.exports = {
  candidateRoots,
  DATA_DIR,
  computeStats,
  formatStats,
  writeLifetimeBadge,
  writeSessionSnapshot,
  findCurrentTranscript,
  listTranscripts,
};

// CLI entry: `node caveman-stats.js [--lifetime]`
if (require.main === module) {
  const lifetime = process.argv.includes('--lifetime');
  const stats = computeStats({ lifetime });
  process.stdout.write(formatStats(stats) + '\n');
}
