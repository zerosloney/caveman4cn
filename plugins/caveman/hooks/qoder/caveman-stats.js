#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats (Qoder build).
//
// Qoder does not publicly document where it writes session transcripts.
// This module probes several candidate locations under ~/.qoder/ and falls
// back gracefully (returns { found:false }) when nothing is found, so
// /caveman-stats never errors — it just reports "no log found yet".
//
// When a log IS found, usage extraction is defensive: it tries Anthropic-style
// fields (inputTokens/outputTokens), then OpenAI-style (prompt_tokens /
// completion_tokens), across several record shapes so it keeps working if
// Qoder changes its transcript schema.
//
// Exported: computeStats(opts) -> { turns, input, output, baseline, saved, pct, found }
//           formatStats(stats)   -> string
//
// Used by user-prompt.js (UserPromptSubmit hook). Designed to require zero npm
// deps and tolerate missing/partial logs.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';

// Candidate transcript roots Qoder might use. The first that exists wins.
// Qoder does not publicly document its transcript path. Guesses are based on:
//   - Claude-Code-style layout (Qoder CLI derives from that architecture):
//     ~/.qoder/projects/<encoded-project>/<id>.jsonl
//   - common alternative names (sessions/logs/transcripts/history)
// Order: most likely layouts first.
function candidateRoots() {
  return [
    path.join(homeDir, '.qoder', 'projects'),
    path.join(homeDir, '.qoder', 'sessions'),
    path.join(homeDir, '.qoder', 'logs'),
    path.join(homeDir, '.qoder', 'transcripts'),
    path.join(homeDir, '.qoder', 'history'),
    path.join(homeDir, '.qoder'),
  ];
}

// Per-agent data dir: ~/.caveman/qoder/
const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

// Empirical caveman compression vs verbose baseline. README promises ~65%.
// Used only for the *baseline* estimate line — input/output come from real logs.
const BASELINE_OUTPUT_MULTIPLIER = 2.86; // verbose ≈ 2.86x caveman output

/**
 * Enumerate all transcript files across every candidate root that exists.
 * Accepts both .jsonl (line-delimited, Claude-Code-style) and .json
 * (single-blob, e.g. sessions/<ID>.json).
 * Returns [] if no root exists or no matching files are found.
 */
function listTranscripts() {
  const out = [];
  for (const root of candidateRoots()) {
    let st;
    try {
      st = fs.statSync(root);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && (e.name.endsWith('.jsonl') || e.name.endsWith('.json'))) {
          out.push(full);
        }
      }
    };
    walk(root);
  }
  return out;
}

/**
 * Find the "current" session transcript: the most recently modified non-empty
 * .jsonl across all candidate roots. Empty (just-created) session files are
 * skipped so /caveman-stats reports the last real conversation, not a 0-byte stub.
 */
function findCurrentTranscript() {
  let best = null;
  for (const file of listTranscripts()) {
    try {
      const stat = fs.statSync(file);
      if (stat.size === 0) continue;
      if (!best || stat.mtimeMs > best.mtime) best = { full: file, mtime: stat.mtimeMs };
    } catch {}
  }
  return best ? best.full : null;
}

/**
 * Extract a normalized {inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}
 * usage object from a parsed JSONL record. Defensive: tries several shapes.
 *
 *   1. { type: "function_call", providerData: { rawUsage: { prompt_tokens, ... } } }
 *   2. { type: "model_complete", payload: { usage: { inputTokens, ... } } }
 *   3. { type: "assistant", message: { usage: {...} } }
 *   4. { usage: {...} } / { payload: { usage: {...} } } / { providerData: { usage: {...} } }
 */
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
    // Anthropic-style fields (inputTokens/outputTokens).
    if (u.inputTokens != null || u.outputTokens != null) {
      return {
        inputTokens: u.inputTokens || 0,
        outputTokens: u.outputTokens || 0,
        cacheReadTokens: u.cacheReadTokens || 0,
        cacheWriteTokens: u.cacheWriteTokens || 0,
      };
    }
    // OpenAI-style fields (prompt_tokens/completion_tokens).
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

/**
 * Recursively walk a parsed JSON value, calling visitor on every object node
 * that extractUsage can interpret as a usage record. Used for .json transcripts
 * whose schema is unknown — could be an array of turns, a single object with a
 * messages array, a logs wrapper, etc. Bounded depth to defend against cycles.
 *
 * Once a node is recognized as a usage record, its children are NOT recursed —
 * the usage object itself is leaf data (inputTokens/outputTokens), and recursing
 * into it would double-count (the same usage blob matched again as rec.usage).
 */
function walkUsageRecords(node, visitor, depth) {
  if (depth > 16) return;
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const v of node) walkUsageRecords(v, visitor, depth + 1);
    return;
  }

  // Object node: check if it carries a usage record. If so, account it and stop
  // descending (avoids re-counting the usage object's own fields).
  const u = extractUsage(node);
  if (u) {
    visitor(node, u);
    return;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkUsageRecords(v, visitor, depth + 1);
  }
}

/**
 * Sum token usage across one or more transcript files.
 * Handles both .jsonl (line-delimited records) and .json (single blob, possibly
 * nested). Defensive: skips unreadable/unparseable files silently.
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

  const account = (rec, usage) => {
    totals.input += usage.inputTokens || 0;
    totals.output += usage.outputTokens || 0;
    totals.cacheRead += usage.cacheReadTokens || 0;
    totals.cacheWrite += usage.cacheWriteTokens || 0;
    totals.requests += 1;
    if (rec && rec.turnId) seenTurns.add(rec.turnId);
  };

  for (const file of transcriptFiles) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    if (file.endsWith('.json')) {
      // Single-blob transcript (e.g. sessions/<ID>.json). Parse once, then walk
      // the structure for any usage-bearing records.
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      walkUsageRecords(parsed, account, 0);
    } else {
      // .jsonl — line-delimited records.
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
        if (usage) account(rec, usage);
      }
    }
  }
  // turns = distinct model calls. Fall back to the request count when no turnId.
  turns = seenTurns.size || totals.requests;
  return { totals, turns };
}

/**
 * Compute the caveman savings view.
 * opts.transcript — restrict to one transcript file (default: current session)
 * opts.lifetime   — union all transcripts across all candidate roots (default: false)
 */
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
 * Human-readable block matching README example.
 */
function formatStats(stats) {
  if (!stats.found) {
    return 'No Qoder session log found yet.\n' +
      'Probed ~/.qoder/{projects,sessions,logs,transcripts,history}/ and the\n' +
      'transcript_path from the hook input, but found no usage records.\n' +
      'Run a few turns to populate the log, then /caveman-stats again.';
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
    // Lifetime = max(prev, current) to stay monotonic.
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
      pct: stats.pct || 0,
      requests: stats.requests || 0,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload));
  } catch {}
}

module.exports = {
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
