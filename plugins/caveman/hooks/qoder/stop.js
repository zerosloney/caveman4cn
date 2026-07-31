#!/usr/bin/env node
// caveman — Qoder Stop hook
// Checks output quality when caveman mode is active.
// If the model is about to end with verbose output in caveman mode,
// blocks to allow correction. Max 3 consecutive blocks.
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, last_assistant_message, ... }
//   - stdout: JSON. Stop may request continuation via exit code 2 (block)
//     with the reason on stderr; the host surfaces stderr and re-prompts the
//     model. Exit 0 + {} ends the turn.

const path = require('path');
const fs = require('fs');
const { getAgentDataDir, getAgentCounterFile, getAgentFlagPath } = require('./caveman-config');
const { computeStats, writeSessionSnapshot, writeLifetimeBadge } = require('./caveman-stats');

const COUNTER_FILE = getAgentCounterFile();

function getBlockCount() {
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      return parseInt(fs.readFileSync(COUNTER_FILE, 'utf-8').trim(), 10) || 0;
    }
  } catch {}
  return 0;
}

function incrementBlockCount() {
  try {
    const dir = getAgentDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const count = getBlockCount() + 1;
    fs.writeFileSync(COUNTER_FILE, String(count));
    return count;
  } catch {
    return 1;
  }
}

function resetBlockCount() {
  try {
    if (fs.existsSync(COUNTER_FILE)) fs.unlinkSync(COUNTER_FILE);
  } catch {}
}

function isCavemanActive() {
  try {
    return fs.existsSync(getAgentFlagPath());
  } catch {
    return false;
  }
}

// Near-real-time stats snapshot for the statusline. Computes the current
// session's token usage and persists it, and refreshes the lifetime badge.
// Wrapped in try/catch so stats failures never affect the Stop decision.
function recordSnapshot() {
  try {
    const session = computeStats({ lifetime: false });
    if (session.found) writeSessionSnapshot(session);
    const lifetime = computeStats({ lifetime: true });
    writeLifetimeBadge(lifetime);
  } catch {
    // Best-effort — snapshot is refreshed on the next Stop anyway.
  }
}

// Strip fenced and inline code so technical content isn't miscounted as filler.
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`\n]*`/g, ' ');        // inline code
}

// Check if the last assistant message violates caveman rules
function checkVerbosity(message) {
  if (!message) return null;

  const prose = stripCode(message);
  const lines = prose.split('\n');

  // Pure pleasantries only — always caveman-killable fluff.
  // Weak hedges (just/simply/actually/...) deliberately NOT counted: they
  // appear in legitimate technical prose and caused false-positive blocks.
  const fillerStems = ['sure', 'certain', 'of course', 'happy to (help|assist)', 'i\'?d (suggest|recommend)', 'i (suggest|recommend)', 'my pleasure', 'glad to'];
  const fillerCount = fillerStems.reduce((sum, stem) => {
    const regex = new RegExp(`\\b${stem}\\w*\\b`, 'gi');
    const matches = prose.match(regex);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const wordCount = prose.split(/\s+/).filter(Boolean).length;
  const totalLines = lines.filter(Boolean).length;

  if (fillerCount > 3 && wordCount > 100) {
    return `[caveman] ${fillerCount} filler words across ${wordCount} words. Caveman mode requires brevity: drop filler and pleasantries, lead with the conclusion.`;
  }

  if (wordCount > 300 && totalLines > 20) {
    return `[caveman] Output too long (${wordCount} words, ${totalLines} lines). Compress to bullet points, one conclusion per line.`;
  }

  return null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const lastMessage = input.last_assistant_message || '';

  // Record a near-real-time session snapshot + update the lifetime badge so
  // the statusline reflects the latest turn's token usage. Best-effort: any
  // failure here must NOT alter the Stop decision.
  recordSnapshot();

  if (!isCavemanActive()) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const issue = checkVerbosity(lastMessage);
  if (issue) {
    const blockCount = incrementBlockCount();
    if (blockCount >= 3) {
      process.stderr.write(`[caveman] Stop: max blocks (3) reached, forcing through\n`);
      resetBlockCount();
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Block / request continuation: exit 2 + reason on stderr.
    process.stderr.write(`[caveman] Stop: blocked (${blockCount}/3) — ${issue}\n`);
    process.stdout.write(JSON.stringify({}));
    process.exit(2);
  }

  resetBlockCount();
  process.stderr.write('[caveman] Stop: output quality OK\n');
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] Stop error: ${err.message}\n`);
  // Never trap the user on a Stop hook error — allow the turn to end.
  process.stdout.write(JSON.stringify({}));
});
