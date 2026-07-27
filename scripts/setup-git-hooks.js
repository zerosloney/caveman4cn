#!/usr/bin/env node
// setup-git-hooks — install repo-managed git hooks into .git/hooks/.
//
// Why: we keep hook sources under `githooks/` so they're version-controlled,
// but git only runs hooks from `.git/hooks/`. This script bridges the two by
// copying each source hook over the corresponding `.git/hooks/<name>` and
// marking it executable (POSIX) — on Windows, git for Windows honors the
// executable bit via the ACL it sets on copy.
//
// Idempotent: safe to re-run; overwrites stale hook content if the source
// changed. Runs automatically on `npm install` via the `postinstall` script,
// so a fresh clone gets the hooks for free without any per-developer setup.
//
// Marketplace users who never `npm install` never run this — they're consumers,
// not developers, so they don't need the hooks and won't be affected.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'githooks');
const GIT_DIR = path.join(REPO_ROOT, '.git');
const HOOKS_DIR = path.join(GIT_DIR, 'hooks');

const HOOKS = ['pre-commit'];

function main() {
  // Bail out silently when not in a git repo (e.g. installed as npm dep into
  // another project, or unpacked from a tarball). The hooks only make sense
  // inside this repo's working tree.
  if (!fs.existsSync(GIT_DIR)) {
    console.log('[setup-git-hooks] no .git directory — skipping (not a dev clone).');
    return;
  }
  if (!fs.existsSync(SRC_DIR)) {
    console.log(`[setup-git-hooks] no ${path.relative(REPO_ROOT, SRC_DIR)} dir — nothing to install.`);
    return;
  }

  fs.mkdirSync(HOOKS_DIR, { recursive: true });

  let installed = 0;
  for (const name of HOOKS) {
    const src = path.join(SRC_DIR, name);
    const dest = path.join(HOOKS_DIR, name);
    if (!fs.existsSync(src)) continue;

    // Detect unchanged target to skip needless writes (keeps the script quiet
    // on repeat installs).
    let same = false;
    try {
      same = fs.readFileSync(src, 'utf-8') === fs.readFileSync(dest, 'utf-8');
    } catch { /* dest missing */ }

    fs.copyFileSync(src, dest);

    // Mark executable. On Windows this is a no-op for the filesystem, but
    // git-for-windows honors the bit when invoking the hook.
    try { fs.chmodSync(dest, 0o755); } catch { /* best-effort */ }

    console.log(`[setup-git-hooks] ${same ? 'verified' : 'installed'} ${name}`);
    installed++;
  }

  if (installed === 0) {
    console.log('[setup-git-hooks] no hooks found to install.');
  }
}

main();
