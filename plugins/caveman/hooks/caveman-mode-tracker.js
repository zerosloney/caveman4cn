#!/usr/bin/env node
// caveman-mode-tracker.js — ZCode UserPromptSubmit hook.
// Intercepts `/caveman-stats` and returns the formatted token report directly,
// blocking the model from running. The user sees real numbers immediately.
//
// Contract (matches skills/caveman-stats/SKILL.md):
//   prompt "/caveman-stats"            -> current-session stats
//   prompt "/caveman-stats --lifetime" -> all-session stats
//   prompt "/caveman-stats --share"    -> one-line tweetable summary
//   any other prompt                   -> pass through unchanged
//
// We never block non-stats prompts. For stats prompts we emit:
//   { continue: false, reason: <formatted block>, ... }
// so the host displays the reason and stops (no model call).

const path = require('path');
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
  const share = /\s--share\b/i.test(prompt);

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

  process.stderr.write(
    `[caveman] mode-tracker: /caveman-stats (${lifetime ? 'lifetime' : 'session'})\n`
  );

  const output = {
    continue: false,
    reason: body,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'UserPromptSubmit',
      additionalContext: body,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] mode-tracker error: ${err.message}\n`);
  // Never trap the user on hook error — pass through.
  process.stdout.write(JSON.stringify({}));
});
