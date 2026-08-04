#!/usr/bin/env node
// caveman-stats.js — shared aggregator for /caveman-stats (Reasonix build).
//
// Reasonix does not publicly document where it writes session transcripts.
// This module probes several candidate locations under ~/.reasonix/ and falls
// back gracefully (returns { found:false }) when nothing is found, so
// /caveman-stats never errors — it just reports "no log found yet".
//
// When a log IS found, usage extraction is defensive: it tries Anthropic-style
// fields (inputTokens/outputTokens), then OpenAI-style (prompt_tokens /
// completion_tokens), across several record shapes so it keeps working if
// Reasonix changes its transcript schema.
//
// Exported: computeStats(opts) -> { turns, input, output, saved, found }
//           formatStats(stats)   -> string
//
// Used by user-prompt.js (UserPromptSubmit hook). Designed to require zero npm
// deps and tolerate missing/partial logs.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';

// Candidate transcript roots Reasonix might use. The first that exists wins.
// Reasonix does not publicly document its transcript path. Guesses are based on:
//   - Claude-Code-style layout (Reasonix CLI derives from that architecture):
//     ~/.reasonix/projects/<encoded-project>/<id>.jsonl
//   - common alternative names (sessions/logs/transcripts/history)
// Order: most likely layouts first.
function candidateRoots() {
  return [
    path.join(homeDir, '.reasonix', 'projects'),
    path.join(homeDir, '.reasonix', 'sessions'),
    path.join(homeDir, '.reasonix', 'logs'),
    path.join(homeDir, '.reasonix', 'transcripts'),
    path.join(homeDir, '.reasonix', 'history'),
    path.join(homeDir, '.reasonix'),
  ];
}

// Per-agent data dir: ~/.caveman/reasonix/
const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

const BASELINE_OUTPUT_MULTIPLIER = 1.43;

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

function walkUsageRecords(node, visitor, depth) {
  if (depth > 16) return;
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const v of node) walkUsageRecords(v, visitor, depth + 1);
    return;
  }

  const u = extractUsage(node);
  if (u) {
    visitor(node, u);
    return;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkUsageRecords(v, visitor, depth + 1);
  }
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
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      walkUsageRecords(parsed, account, 0);
    } else {
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
  turns = seenTurns.size || totals.requests;
  return { totals, turns };
}

/**
 * Compute the caveman savings view.
 * opts.cwd      — Reasonix passes the project cwd; reserved for future scoping.
 * opts.lifetime — union all transcripts across all candidate roots (default: false)
 */
function computeStats(opts = {}) {
  const lifetime = !!opts.lifetime;
  let files;
  if (lifetime) {
    files = listTranscripts();
  } else {
    files = [findCurrentTranscript()].filter(Boolean);
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

function formatStats(stats) {
  if (!stats.found) {
    return 'No Reasonix session log found yet.\n' +
      'Probed ~/.reasonix/{projects,sessions,logs,transcripts,history}/ but found no\n' +
      'usage records. Run a few turns to populate the log, then /caveman-stats again.';
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
