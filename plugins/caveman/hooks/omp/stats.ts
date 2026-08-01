// caveman — OMP stats aggregator (oh-my-pi build)
//
// Reads OMP session transcripts (JSONL under ~/.omp/agent/sessions/) and
// sums token usage from message entries (usage.input / usage.output).
// No AI estimation; real receipts from the provider.
//
// Exports:
//   computeStats(opts)  -> { turns, input, output, saved, found }
//   formatStats(stats)  -> string
//   writeLifetimeBadge(stats)  -> void
//   writeSessionSnapshot(stats) -> void
//
// Designed for zero npm deps and tolerance of missing/partial logs.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile } from './config';

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = getAgentDataDir();
const LIFETIME_FILE = getAgentLifetimeFile();
const SNAPSHOT_FILE = getAgentSnapshotFile();

/** OMP agent directory (respects PI_CODING_AGENT_DIR). */
function getOmpAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.omp', 'agent');
}

/** OMP sessions root: ~/.omp/agent/sessions/ */
function getSessionsRoot(): string {
  return path.join(getOmpAgentDir(), 'sessions');
}

// ── Baseline ratio ───────────────────────────────────────────────────────────
// Assumed verbose-to-caveman output ratio. Used only for the "Est. saved" line.
// No control run behind it — the number is a rough heuristic.
const BASELINE_OUTPUT_MULTIPLIER = 2.86;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CavemanStats {
  /** Number of assistant turns with usage data. */
  turns: number;
  /** Total input tokens consumed. */
  input: number;
  /** Total output tokens generated. */
  output: number;
  /** Estimated tokens saved (output * (multiplier - 1)). */
  saved: number;
  /** Whether any usage records were found. */
  found: boolean;
}

interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// ── Session discovery ────────────────────────────────────────────────────────

/** List all .jsonl session files under the sessions root. */
function listSessionFiles(): string[] {
  const root = getSessionsRoot();
  try {
    if (!fs.statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }
  const files: string[] = [];
  try {
    for (const dirEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirEntry.isDirectory()) continue;
      const dirPath = path.join(root, dirEntry.name);
      try {
        for (const file of fs.readdirSync(dirPath)) {
          if (file.endsWith('.jsonl')) {
            files.push(path.join(dirPath, file));
          }
        }
      } catch {
        // skip unreadable subdirectories
      }
    }
  } catch {
    // skip unreadable root
  }
  return files;
}

/** Find the most recently modified session file. */
function findCurrentSessionFile(): string | null {
  const files = listSessionFiles();
  if (files.length === 0) return null;
  files.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return files[0];
}

// ── Usage extraction ─────────────────────────────────────────────────────────

/** Extract token usage from a parsed JSONL line if it's a message with usage. */
function extractUsage(rec: Record<string, unknown>): UsageRecord | null {
  // OMP message entry shape: { type: "message", message: { usage: { input, output, cacheRead, cacheWrite } } }
  if (rec.type === 'message' && rec.message && typeof rec.message === 'object') {
    const msg = rec.message as Record<string, unknown>;
    if (msg.usage && typeof msg.usage === 'object') {
      const u = msg.usage as Record<string, unknown>;
      const input = typeof u.input === 'number' ? u.input : 0;
      const output = typeof u.output === 'number' ? u.output : 0;
      const cacheRead = typeof u.cacheRead === 'number' ? u.cacheRead : 0;
      const cacheWrite = typeof u.cacheWrite === 'number' ? u.cacheWrite : 0;
      if (input > 0 || output > 0) {
        return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
      }
    }
  }
  return null;
}

/** Sum token usage across one or more session files. */
function sumUsage(sessionFiles: string[]): { turns: number; input: number; output: number } {
  let turns = 0;
  let input = 0;
  let output = 0;

  for (const file of sessionFiles) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed);
          const usage = extractUsage(rec);
          if (usage) {
            turns++;
            input += usage.inputTokens;
            output += usage.outputTokens;
          }
        } catch {
          // skip unparseable lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return { turns, input, output };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ComputeStatsOptions {
  /** Restrict to a single transcript file (default: current session). */
  transcript?: string;
  /** Union all transcripts across all sessions (default: false). */
  lifetime?: boolean;
}

/**
 * Compute caveman savings view.
 * - Default: current session only.
 * - lifetime: union all sessions across all project directories.
 */
export function computeStats(opts: ComputeStatsOptions = {}): CavemanStats {
  let files: string[];

  if (opts.transcript) {
    files = [opts.transcript];
  } else if (opts.lifetime) {
    files = listSessionFiles();
  } else {
    const current = findCurrentSessionFile();
    files = current ? [current] : [];
  }

  if (files.length === 0) {
    return { turns: 0, input: 0, output: 0, saved: 0, found: false };
  }

  const { turns, input, output } = sumUsage(files);
  const saved = Math.round(output * (BASELINE_OUTPUT_MULTIPLIER - 1));

  return { turns, input, output, saved, found: turns > 0 };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * Human-readable stats block.
 */
export function formatStats(stats: CavemanStats): string {
  if (!stats.found) {
    return 'No token usage data found yet. Start a conversation first, then run /caveman-stats again.';
  }

  const lines: string[] = [];
  lines.push(`📊 Caveman Token Stats`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`  Turns:        ${fmt(stats.turns)}`);
  lines.push(`  Input:        ${fmt(stats.input)} tokens`);
  lines.push(`  Output:       ${fmt(stats.output)} tokens`);
  lines.push(`  Est. saved:   ${fmt(stats.saved)} tokens`);

  if (stats.output > 0) {
    const ratio = (stats.saved / stats.output).toFixed(2);
    lines.push(`  Savings rate: ${ratio}x (est.)`);
  }

  return lines.join('\n');
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Persist lifetime savings so a statusline badge can read it later.
 * Stores the max of current and previous lifetime values.
 */
export function writeLifetimeBadge(stats: CavemanStats): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let prev = 0;
    try {
      const cur = JSON.parse(fs.readFileSync(LIFETIME_FILE, 'utf-8'));
      if (cur && typeof cur.lifetimeSaved === 'number') prev = cur.lifetimeSaved;
    } catch {
      // no previous file
    }
    // Use the larger of the new lifetime total and the previous badge value
    const merged = Math.max(prev, stats.saved + prev);
    if (merged > 0) {
      fs.writeFileSync(
        LIFETIME_FILE,
        JSON.stringify({ lifetimeSaved: merged, updatedAt: new Date().toISOString() }),
      );
    }
  } catch {
    // best-effort
  }
}

/**
 * Persist a current-session snapshot so the statusline can render
 * near-real-time per-session token usage. Written at session_stop.
 */
export function writeSessionSnapshot(stats: CavemanStats): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      SNAPSHOT_FILE,
      JSON.stringify({
        turns: stats.turns,
        input: stats.input,
        output: stats.output,
        saved: stats.saved,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // best-effort
  }
}

/**
 * Read the lifetime badge value for statusline display.
 */
export function readLifetimeBadge(): number {
  try {
    const cur = JSON.parse(fs.readFileSync(LIFETIME_FILE, 'utf-8'));
    if (cur && typeof cur.lifetimeSaved === 'number') return cur.lifetimeSaved;
  } catch {
    // no file or invalid
  }
  return 0;
}

/**
 * Read the session snapshot for statusline display.
 */
export function readSessionSnapshot(): CavemanStats | null {
  try {
    const cur = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    if (cur && typeof cur.turns === 'number') {
      return {
        turns: cur.turns,
        input: cur.input || 0,
        output: cur.output || 0,
        saved: cur.saved || 0,
        found: true,
      };
    }
  } catch {
    // no file or invalid
  }
  return null;
}