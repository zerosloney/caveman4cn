#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats (CodeBuddy build).
// Reads CodeBuddy session transcripts (JSONL under ~/.codebuddy/projects/) and
// sums token usage from model records (payload.usage). No AI estimation; real receipts.
//
// Exported: computeStats(opts) -> { turns, input, output, saved, found }
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

// Assumed verbose-to-caveman output ratio, back-derived from the README's "~65%"
// claim. There is no control run behind it: nothing here measures what the same
// prompts would have cost without caveman. Used only for the "Est. saved" line.
const BASELINE_OUTPUT_MULTIPLIER = 2.86;

/**
 * Find the "current" session transcript: the most recently modified .jsonl that
 * actually carries token-usage records.
 *
 * Both guards matter. The scan must recurse, because real transcripts live one
 * level down (~/.codebuddy/projects/<encoded>/<uuid>.jsonl) — a flat readdir of
 * the roots never sees them. And the newest .jsonl is not necessarily a
 * transcript: ~/.codebuddy/history.jsonl is the prompt-history file, is touched
 * on every single prompt, and contains no usage records. Picking it silently
 * zeroed out every per-session stat.
 */
function findCurrentTranscript() {
  const files = [];
  for (const file of listTranscripts()) {
    try {
      const stat = fs.statSync(file);
      if (stat.size === 0) continue;
      files.push({ file, mtime: stat.mtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files) {
    if (hasUsageRecords(file)) return file;
  }
  return null;
}

/** True if a .jsonl file contains at least one token-usage record. */
function hasUsageRecords(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      if (extractUsage(JSON.parse(trimmed))) return true;
    } catch {}
  }
  return false;
}

/**
 * Enumerate all .jsonl transcripts. If projectDir omitted, walks ALL candidate
 * roots (lifetime view).
 */
function listTranscripts(projectDir) {
  // Candidate roots overlap (~/.codebuddy contains ~/.codebuddy/projects), so
  // dedupe by resolved path or lifetime totals would double-count. Each root is
  // walked in its own try/catch: one missing root must not abort the rest.
  const seen = new Set();
  const roots = projectDir ? [projectDir] : candidateRoots();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        try {
          walk(full);
        } catch {}
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        seen.add(path.resolve(full));
      }
    }
  };
  for (const r of roots) {
    try {
      walk(r);
    } catch {}
  }
  return [...seen];
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
    // An explicit transcript is only trusted once it actually carries usage
    // records — early in a session the host's path may point at a file that has
    // not been flushed yet, which would report a bogus zero session.
    let cur = opts.transcript && hasUsageRecords(opts.transcript) ? opts.transcript : null;
    if (!cur) cur = findCurrentTranscript();
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
 * Human-readable block:
 *   Session: 47 turns
 *   Input:      12,304 tokens
 *   Output:     3,891 tokens
 *   Est. saved: 7,237 tokens
 *
 * Turns/input/output are real receipts from the log. "Est. saved" is a guess,
 * and the trailing note says so — the old output claimed a "~65%" savings rate
 * that was algebraically fixed and identical on every session.
 */
function formatStats(stats) {
  if (!stats.found) {
    return 'No session log found yet. Run a few turns, then /caveman-stats again.';
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
