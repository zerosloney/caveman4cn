#!/usr/bin/env node
// caveman-install.js — Qwen Code install helper for /caveman-install command.
// Merges caveman hooks + ui.statusLine into ~/.qwen/settings.json.

const path = require('path');
const { mergeCavemanIntoSettings } = require('../scripts/install-qwen');

function main() {
  try {
    mergeCavemanIntoSettings(false);
    console.log('✅ Caveman hooks and statusLine merged into Qwen Code settings.');
    console.log('   Restart Qwen Code or run /extensions to reload.');
  } catch (err) {
    console.error('❌ Failed to merge caveman settings:', err.message);
    process.exit(1);
  }
}

main();
