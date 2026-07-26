#!/usr/bin/env node
// caveman-mode-tracker.js — ZCode UserPromptSubmit hook.
// Intercepts `/caveman-stats` and returns the formatted token report directly,
// blocking the model from running. The user sees real numbers immediately.
//
// Contract (matches skills/caveman-stats/SKILL.md):
//   prompt "/caveman-stats"            -> current-session stats
//   prompt "/caveman-stats --lifetime" -> all-session stats (--all / --since also)
//   prompt "/caveman-stats --share"    -> one-line tweetable summary
//   any other prompt                   -> pass through unchanged
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// To block the model and show the user a message, emit `{}` to stdout and
// exit with code 2 — the host treats exit 2 as a block and surfaces stderr
// (where we write the formatted stats) to the user. Empty stdout + exit 0
// passes through unchanged.

const {
  computeStats,
  formatStats,
  writeLifetimeBadge,
} = require('./caveman-stats.js');

function isStatsPrompt(prompt) {
  const p = (prompt || '').trim();
  // Match the /caveman-stats invocation possibly followed by flags.
  return /^\/caveman-stats(\s|$)/i.test(p);
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Bad stdin — never block, just pass through.
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const prompt = input.prompt || '';

  if (!isStatsPrompt(prompt)) {
    // Not our command — pass through untouched.
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const lifetime =
    /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
  const share = /\s--share\b/.test(prompt);

  const stats = computeStats({ lifetime });
  writeLifetimeBadge(stats);

  let body;
  if (share) {
    // One-line tweetable form.
    if (!stats.found) {
      body = 'No session log found yet.';
    } else {
      const scope = stats.lifetime ? 'Lifetime' : 'Session';
      body = `⛏ ${scope}: ${stats.saved.toLocaleString('en-US')} tokens saved (~${stats.pct}%) via caveman mode`;
    }
  } else {
    body = formatStats(stats);
  }

  // Block the model call; surface the formatted stats via stderr (host shows
  // stderr on exit 2). Stdout stays empty so no schema key can fail validation.
  process.stderr.write(`[caveman] /caveman-stats (${lifetime ? 'lifetime' : 'session'}):\n${body}\n`);
  process.stdout.write(JSON.stringify({}));
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`[caveman] mode-tracker error: ${err.message}\n`);
  // Never trap the user on hook error — pass through.
  process.stdout.write(JSON.stringify({}));
});
