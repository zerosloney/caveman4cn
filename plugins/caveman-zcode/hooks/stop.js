#!/usr/bin/env node
// caveman — ZCode Stop hook
// Checks output quality when caveman mode is active.
// If the model is about to end with verbose output in caveman mode,
// blocks to allow correction. Max 3 consecutive blocks.
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// Stop may request continuation. The compliant way under the flat schema is
// exit code 2 (block / request continuation) with the reason on stderr; the
// host surfaces stderr and re-prompts the model. Exit 0 + `{}` ends the turn.
// Note: `decision: "block"` is a deprecated Claude-Code-era field — do not use.

const path = require('path');
const fs = require('fs');

const COUNTER_FILE = 'caveman-stop-counter';

function dataDir() {
  return process.env.ZCODE_PLUGIN_DATA || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman');
}

function getBlockCount() {
  try {
    const counterPath = path.join(dataDir(), COUNTER_FILE);
    if (fs.existsSync(counterPath)) {
      return parseInt(fs.readFileSync(counterPath, 'utf-8').trim(), 10) || 0;
    }
  } catch {}
  return 0;
}

function incrementBlockCount() {
  try {
    const dir = dataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const counterPath = path.join(dir, COUNTER_FILE);
    const count = getBlockCount() + 1;
    fs.writeFileSync(counterPath, String(count));
    return count;
  } catch {
    return 1;
  }
}

function resetBlockCount() {
  try {
    const counterPath = path.join(dataDir(), COUNTER_FILE);
    if (fs.existsSync(counterPath)) fs.unlinkSync(counterPath);
  } catch {}
}

function isCavemanActive() {
  try {
    const flagPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman-active');
    return fs.existsSync(flagPath);
  } catch {
    return false;
  }
}

// Strip fenced and inline code so technical content isn't miscounted as filler.
// Code, commands, and string literals often contain words like "just"/"simply"
// that are legitimate there but would be false-positive filler in prose.
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`\n]*`/g, ' ');        // inline code
}

// Check if the last assistant message violates caveman rules
function checkVerbosity(message) {
  if (!message) return null;

  // Measure filler only in prose — code is exempt (see stripCode).
  const prose = stripCode(message);
  const lines = prose.split('\n');

  // Pure pleasantries only — these are always caveman-killable fluff.
  // Weak hedges (just/simply/actually/basically/essentially/i think/it seems)
  // are deliberately NOT counted: they appear in legitimate technical prose
  // ("just works", "simply connected", "actually async", "I think the cause is X")
  // and caused false-positive blocks. The SKILL.md still guides the model to
  // avoid them at generation time; we just don't block on them post-hoc.
  //
  // Matched as stems so conjugations/contractions are caught
  // (sure/surely, certain/certainly, recommend/recommended, etc.).
  const fillerStems = ['sure', 'certain', 'of course', 'happy to (help|assist)', 'i\'?d (suggest|recommend)', 'i (suggest|recommend)', 'my pleasure', 'glad to'];
  const fillerCount = fillerStems.reduce((sum, stem) => {
    const regex = new RegExp(`\\b${stem}\\w*\\b`, 'gi');
    const matches = prose.match(regex);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const wordCount = prose.split(/\s+/).filter(Boolean).length;
  const totalLines = lines.filter(Boolean).length;

  // If caveman mode is active, flag verbose output
  if (fillerCount > 3 && wordCount > 100) {
    return `[caveman] ${fillerCount} filler words across ${wordCount} words. Caveman mode requires brevity: drop filler and pleasantries, lead with the conclusion.`;
  }

  // Long final output in caveman mode
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

  if (!isCavemanActive()) {
    // Caveman not active — allow through
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const issue = checkVerbosity(lastMessage);
  if (issue) {
    const blockCount = incrementBlockCount();
    if (blockCount >= 3) {
      // Max blocks reached, allow through but log warning
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

  // Output looks good — allow end
  resetBlockCount();
  process.stderr.write('[caveman] Stop: output quality OK\n');
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] Stop error: ${err.message}\n`);
  // Never trap the user on a Stop hook error — allow the turn to end.
  process.stdout.write(JSON.stringify({}));
});
