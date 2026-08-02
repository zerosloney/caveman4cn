// caveman-stats.ts — Cline SDK Plugin token statistics
//
// Tracks token usage via SDK hooks (AgentUsage events) and persists
// session/lifetime stats to ~/.caveman/cline/.

import * as fs from 'fs';
import {
  getAgentDataDir, getAgentLifetimeFile, getAgentSnapshotFile
} from './caveman-config';

// Assumed verbose-to-caveman output ratio for "Est. saved" calculation.
// Not measured — implies ~30% output savings: (1.43-1)/1.43 ≈ 0.30.
const BASELINE_OUTPUT_MULTIPLIER = 1.43;

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

export interface SessionStats {
  turns: number;
  input: number;
  output: number;
  saved: number;
  requests: number;
  cacheRead: number;
  cacheWrite: number;
  lifetime: boolean;
  found: boolean;
}

// In-memory session accumulator
let sessionUsage = {
  turns: 0,
  input: 0,
  output: 0,
  requests: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function recordUsage(usage: UsageRecord): void {
  sessionUsage.turns++;
  sessionUsage.input += usage.inputTokens || 0;
  sessionUsage.output += usage.outputTokens || 0;
  sessionUsage.requests++;
  sessionUsage.cacheRead += usage.cacheReadTokens || 0;
  sessionUsage.cacheWrite += usage.cacheWriteTokens || 0;
}

export function resetSession(): void {
  sessionUsage = {
    turns: 0,
    input: 0,
    output: 0,
    requests: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export function computeStats(lifetime: boolean = false): SessionStats {
  if (lifetime) {
    // Read lifetime data from file
    try {
      const lifetimeFile = getAgentLifetimeFile();
      if (fs.existsSync(lifetimeFile)) {
        const data = JSON.parse(fs.readFileSync(lifetimeFile, 'utf8'));
        const saved = data.lifetimeSaved || 0;
        return {
          turns: data.lifetimeTurns || 0,
          input: data.lifetimeInput || 0,
          output: data.lifetimeOutput || 0,
          saved,
          requests: data.lifetimeRequests || 0,
          cacheRead: 0,
          cacheWrite: 0,
          lifetime: true,
          found: true,
        };
      }
    } catch {
      // Fall through
    }
    return {
      turns: 0, input: 0, output: 0, saved: 0,
      requests: 0, cacheRead: 0, cacheWrite: 0,
      lifetime: true, found: false,
    };
  }

  // Session stats
  if (sessionUsage.turns === 0) {
    return {
      turns: 0, input: 0, output: 0, saved: 0,
      requests: 0, cacheRead: 0, cacheWrite: 0,
      lifetime: false, found: false,
    };
  }

  const saved = Math.round(sessionUsage.output * (BASELINE_OUTPUT_MULTIPLIER - 1));
  return {
    turns: sessionUsage.turns,
    input: sessionUsage.input,
    output: sessionUsage.output,
    saved,
    requests: sessionUsage.requests,
    cacheRead: sessionUsage.cacheRead,
    cacheWrite: sessionUsage.cacheWrite,
    lifetime: false,
    found: true,
  };
}

function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US');
}

export function formatStats(stats: SessionStats): string {
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
    'Turns, input and output are tracked via Cline SDK hooks. "Est. saved" is not',
    `measured: it assumes verbose output would run ${BASELINE_OUTPUT_MULTIPLIER}x longer, so it is`,
    `always ${extra}x the output above no matter how terse the replies really were.`,
  ].join('\n');
}

export function writeLifetimeBadge(): void {
  try {
    const dataDir = getAgentDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const lifetimeFile = getAgentLifetimeFile();
    let prev = { lifetimeSaved: 0, lifetimeTurns: 0, lifetimeInput: 0, lifetimeOutput: 0, lifetimeRequests: 0 };
    try {
      if (fs.existsSync(lifetimeFile)) {
        prev = JSON.parse(fs.readFileSync(lifetimeFile, 'utf8'));
      }
    } catch { /* use defaults */ }

    const stats = computeStats(false);
    const lifetimeSaved = Math.max(prev.lifetimeSaved || 0, stats.saved);
    const lifetimeTurns = (prev.lifetimeTurns || 0) + stats.turns;
    const lifetimeInput = (prev.lifetimeInput || 0) + stats.input;
    const lifetimeOutput = (prev.lifetimeOutput || 0) + stats.output;
    const lifetimeRequests = (prev.lifetimeRequests || 0) + stats.requests;

    fs.writeFileSync(
      lifetimeFile,
      JSON.stringify({
        lifetimeSaved,
        lifetimeTurns,
        lifetimeInput,
        lifetimeOutput,
        lifetimeRequests,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {
    // Silent fail
  }
}

export function writeSessionSnapshot(): void {
  try {
    const dataDir = getAgentDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const stats = computeStats(false);
    const payload = {
      turns: stats.turns,
      input: stats.input,
      output: stats.output,
      saved: stats.saved,
      requests: stats.requests,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(getAgentSnapshotFile(), JSON.stringify(payload));
  } catch {
    // Silent fail
  }
}
