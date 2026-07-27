#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats.
// Reads ZCode session logs (JSONL transcripts) and sums token usage from
// `model_request` records (payload.usage). No AI estimation; real receipts.
//
// Exported: computeStats(opts) -> { turns, input, output, baseline, saved, pct }
//           formatStats(stats, opts) -> string
//
// Used by caveman-mode-tracker.js (UserPromptSubmit hook) and reusable for a
// future CLI/statusline badge. Designed to require zero npm deps and tolerate
// missing/partial logs.

const fs = require('fs');
const path = require('path');
const { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } = require('./caveman-config');

const AGENTS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.zcode',
  'cli',
  'agents'
);

// Per-agent data dir: ~/.caveman/zcode/
const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

// Empirical caveman compression vs verbose baseline. README promises ~65%.
// Used only for the *baseline* estimate line — input/output come from real logs.
const BASELINE_OUTPUT_MULTIPLIER = 2.86; // verbose ≈ 2.86x caveman output

/**
 * Find the directory for the "current" session: the most recently modified
 * sess_XXX dir under ~/.zcode/cli/agents. Each such dir holds one or more
 * agent_XXX subdirs, each with its own transcript.jsonl; we union all of them.
 */
function findCurrentSessionDir() {
  try {
    const entries = fs
      .readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^sess_/.test(e.name))
      .map((e) => {
        const full = path.join(AGENTS_DIR, e.name);
        try {
          return { name: e.name, full, mtime: fs.statSync(full).mtimeMs };
        } catch {
          return { name: e.name, full, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0] ? entries[0].full : null;
  } catch {
    return null;
  }
}

/**
 * Enumerate transcript.jsonl files for a session dir. If sessionDir omitted,
 * walks ALL sess_* dirs (lifetime view).
 */
function listTranscripts(sessionDir) {
  const root = sessionDir || AGENTS_DIR;
  const out = [];
  try {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === 'transcript.jsonl') out.push(full);
      }
    };
    walk(root);
  } catch {}
  return out;
}

/**
 * Sum token usage across one or more transcript files.
 * Reads each line, parses JSON, picks type==="model_complete" records (the
 * records that carry payload.usage), sums payload.usage.{inputTokens,...}.
 * Falls back to a top-level `usage` field for forward-compat.
 */
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
      if (rec.type !== 'model_complete') continue;
      const usage =
        (rec.payload && rec.payload.usage) ||
        rec.usage ||
        null;
      if (!usage) continue;
      totals.input += usage.inputTokens || 0;
      totals.output += usage.outputTokens || 0;
      totals.cacheRead += usage.cacheReadTokens || 0;
      totals.cacheWrite += usage.cacheWriteTokens || 0;
      totals.requests += 1;
      if (rec.turnId) seenTurns.add(rec.turnId);
    }
  }
  turns = seenTurns.size;
  return { totals, turns };
}

/**
 * Compute the caveman savings view.
 * opts.sessionDir — restrict to one session dir (default: current session)
 * opts.lifetime   — union all sessions (default: false)
 */
function computeStats(opts = {}) {
  const lifetime = !!opts.lifetime;
  const dir = lifetime ? null : opts.sessionDir || findCurrentSessionDir();
  const files = listTranscripts(dir);
  if (!files.length) {
    return {
      turns: 0,
      input: 0,
      output: 0,
      baseline: 0,
      saved: 0,
      pct: 0,
      requests: 0,
      cacheRead: 0,
      cacheWrite: 0,
      lifetime,
      found: false,
    };
  }
  const { totals, turns } = sumUsage(files);

  // Baseline = what output would have been without caveman compression.
  // Real input stays the same; only output is compressed by caveman style.
  const baselineOutput = Math.round(totals.output * BASELINE_OUTPUT_MULTIPLIER);
  const saved = Math.max(0, baselineOutput - totals.output);
  const pct = baselineOutput > 0 ? Math.round((saved / baselineOutput) * 100) : 0;

  return {
    turns,
    input: totals.input,
    output: totals.output,
    baseline: baselineOutput,
    saved,
    pct,
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
 * Human-readable block matching README example:
 *   Session: 47 turns
 *   Input:   12,304 tokens
 *   Output:  3,891 tokens (caveman)
 *   Baseline: 11,247 tokens (estimated without caveman)
 *   Saved:    7,356 tokens (~65%)
 */
function formatStats(stats) {
  if (!stats.found) {
    return 'No session log found yet. Run a few turns, then /caveman-stats again.';
  }
  const scope = stats.lifetime ? 'Lifetime' : 'Session';
  return [
    `${scope}: ${fmt(stats.turns)} turns`,
    `Input:    ${fmt(stats.input)} tokens`,
    `Output:   ${fmt(stats.output)} tokens (caveman)`,
    `Baseline: ${fmt(stats.baseline)} tokens (estimated without caveman)`,
    `Saved:    ${fmt(stats.saved)} tokens (~${stats.pct}%)`,
  ].join('\n');
}

/**
 * Persist lifetime savings so a statusline badge can read it later.
 * Called opportunistically; failures are silent.
 */
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
    // Lifetime = max(prev, current lifetime compute) to stay monotonic.
    const lifetimeSaved = stats.lifetime
      ? Math.max(prev.lifetimeSaved || 0, stats.saved)
      : Math.max(prev.lifetimeSaved || 0, stats.saved);
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
      pct: stats.pct || 0,
      requests: stats.requests || 0,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload));
  } catch {}
}

module.exports = {
  AGENTS_DIR,
  DATA_DIR,
  computeStats,
  formatStats,
  writeLifetimeBadge,
  writeSessionSnapshot,
  findCurrentSessionDir,
  listTranscripts,
};

// CLI entry: `node caveman-stats.js [--lifetime]`
if (require.main === module) {
  const lifetime = process.argv.includes('--lifetime');
  const stats = computeStats({ lifetime });
  process.stdout.write(formatStats(stats) + '\n');
}
