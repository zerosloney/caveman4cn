#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats (CodeBuddy build).
// Reads CodeBuddy session transcripts (JSONL under ~/.codebuddy/projects/) and
// sums token usage from model records (payload.usage). No AI estimation; real receipts.
//
// Exported: computeStats(opts) -> { turns, input, output, baseline, saved, pct, found }
//           formatStats(stats)   -> string
//
// Used by caveman-mode-tracker.js (UserPromptSubmit hook). Designed to require
// zero npm deps and tolerate missing/partial logs. CodeBuddy's transcript record
// schema is not publicly documented, so usage extraction is defensive: it tries
// the zcode-compatible shape (`type === "model_complete"` + `payload.usage`),
// then falls back to any record carrying a top-level `usage` object.

const fs = require('fs');
const path = require('path');
const { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } = require('./caveman-config');

// CodeBuddy's primary transcript location (documented contract):
//   ~/.codebuddy/projects/<encoded-project>/<uuid>.jsonl
// Probe several candidate roots so stats keep working if CodeBuddy
// relocates transcripts in a future update. First root that exists wins.
function candidateRoots() {
  const base = process.env.HOME || process.env.USERPROFILE || '.';
  return [
    path.join(base, '.codebuddy', 'projects'),
    path.join(base, '.codebuddy', 'sessions'),
    path.join(base, '.codebuddy', 'logs'),
    path.join(base, '.codebuddy', 'transcripts'),
    path.join(base, '.codebuddy', 'history'),
    path.join(base, '.codebuddy'),
  ];
}

// Per-agent data dir: ~/.caveman/codebuddy/
const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

// Empirical caveman compression vs verbose baseline. README promises ~65%.
// Used only for the *baseline* estimate line — input/output come from real logs.
const BASELINE_OUTPUT_MULTIPLIER = 2.86; // verbose ≈ 2.86x caveman output

/**
 * Find the "current" session transcript: the most recently modified non-empty
 * .jsonl across all candidate roots. Empty (just-created) session files are
 * skipped so /caveman-stats reports the last real conversation, not a 0-byte stub.
 */
function findCurrentTranscript() {
  let best = null;
  for (const root of candidateRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const full = path.join(root, e.name);
      try {
        const stat = fs.statSync(full);
        // Skip empty files — freshly-created session stubs with no usage records.
        if (stat.size === 0) continue;
        if (!best || stat.mtimeMs > best.mtime) best = { full, mtime: stat.mtimeMs };
      } catch {}
    }
  }
  return best ? best.full : null;
}

/**
 * Enumerate all .jsonl transcripts. If projectDir omitted, walks ALL candidate
 * roots (lifetime view).
 */
function listTranscripts(projectDir) {
  const out = [];
  const roots = projectDir ? [projectDir] : candidateRoots();
  try {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
      }
    };
    for (const r of roots) walk(r);
  } catch {}
  return out;
}

/**
 * Extract a normalized {inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}
 * usage object from a parsed JSONL record. Defensive: tries several shapes.
 *
 * CodeBuddy's verified schema (observed in real transcripts): usage lives on
 * `function_call` records under `providerData.rawUsage` with OpenAI-style field
 * names (prompt_tokens / completion_tokens). We also keep fallbacks for the
 * zcode/Claude shapes in case CodeBuddy changes or mirrors them.
 *
 *   1. { type: "function_call", providerData: { rawUsage: { prompt_tokens, completion_tokens, ... } } }  (CodeBuddy verified)
 *   2. { type: "model_complete", payload: { usage: { inputTokens, outputTokens, ... } } }                 (zcode-compat)
 *   3. { type: "assistant", message: { usage: {...} } }                                                  (Claude-compat)
 *   4. { usage: {...} } / { payload: { usage: {...} } }                                                  (top-level / wrapped)
 *   5. { type: "assistant", usageMetadata: { promptTokenCount, candidatesTokenCount, ... } }             (Gemini-style)
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
  // Gemini / Qwen Code style: top-level usageMetadata (promptTokenCount, ...).
  if (rec.usageMetadata) candidates.push(rec.usageMetadata);

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
    // OpenAI-style fields (prompt_tokens/completion_tokens) — CodeBuddy's shape.
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
    // Gemini / Qwen Code style (usageMetadata):
    //   promptTokenCount, candidatesTokenCount, cachedContentTokenCount, ...
    if (u.promptTokenCount != null || u.candidatesTokenCount != null) {
      return {
        inputTokens: u.promptTokenCount || 0,
        outputTokens: u.candidatesTokenCount || 0,
        cacheReadTokens: u.cachedContentTokenCount || 0,
        cacheWriteTokens: 0,
      };
    }
  }
  return null;
}

/**
 * Sum token usage across one or more transcript files.
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
  // turns = distinct model calls. CodeBuddy records carry no turnId, so fall
  // back to the request count (one usage-bearing record per model call).
  turns = seenTurns.size || totals.requests;
  return { totals, turns };
}

/**
 * Compute the caveman savings view.
 * opts.transcript — restrict to one transcript file (default: current session)
 * opts.lifetime   — union all transcripts across projects (default: false)
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
