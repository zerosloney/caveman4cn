#!/usr/bin/env node
// Optional host installer dispatcher — runs only when explicitly enabled and the
// corresponding host is present.
//
// npm runs package.json scripts via cmd.exe on Windows (and /bin/sh elsewhere), so
// shell-based `test -d ~/.<host>` gating is not portable. This Node dispatcher
// probes each host's conventional config directory with fs.existsSync and spawns
// the matching installer only when the host appears installed. A host that is not
// detected is skipped silently (the user may legitimately have only a subset of
// hosts). An installer that runs but exits non-zero still aborts the whole chain
// (propagated exit code), preserving the original hard-fail contract.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const scriptsDir = __dirname;

// Host probe → installer mapping. Probe directory is the host's conventional
// config root, matching what each install-*.js writes into. Order follows the
// original postinstall chain.
const HOSTS = [
  { name: 'zcode', probe: path.join(home, '.zcode', 'cli', 'plugins'), installer: 'install-zcode.js' },
  { name: 'codebuddy', probe: path.join(home, '.codebuddy', 'plugins'), installer: 'install-codebuddy.js' },
  { name: 'trae', probe: path.join(home, '.trae-cn'), installer: 'install-trae.js' },
  { name: 'qwen', probe: path.join(home, '.qwen'), installer: 'install-qwen.js' },
  { name: 'qoder', probe: path.join(home, '.qoder'), installer: 'install-qoder.js' },
  { name: 'cline', probe: path.join(home, '.cline'), installer: 'install-cline.js' },
  { name: 'reasonix', probe: path.join(home, '.reasonix'), installer: 'install-reasonix.js' },
];

function main() {
  if (!process.argv.includes('--install') && process.env.CAVEMAN_AUTO_INSTALL !== '1') {
    console.log('[postinstall] host installers disabled by default; run an explicit install script to enable a host.');
    return;
  }

  for (const host of HOSTS) {
    if (!fs.existsSync(host.probe)) {
      console.log(`[postinstall] skip ${host.name} — host directory not found (${host.probe})`);
      continue;
    }
    const script = path.join(scriptsDir, host.installer);
    if (!fs.existsSync(script)) {
      // Installer missing from the published bundle — should not happen, but fail
      // loudly rather than silently mask it.
      console.error(`[postinstall] installer for ${host.name} missing: ${script}`);
      process.exit(1);
    }
    console.log(`[postinstall] host detected: ${host.name} — running ${host.installer}`);
    const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`[postinstall] ${host.installer} exited with code ${result.status}`);
      process.exit(result.status == null ? 1 : result.status);
    }
  }
}

main();
