@./skills/caveman/SKILL.md
@./skills/caveman-commit/SKILL.md
@./skills/caveman-review/SKILL.md
@./skills/caveman-compress/SKILL.md
@./skills/caveman-help/SKILL.md
@./skills/caveman-stats/SKILL.md
@./skills/cavecrew/SKILL.md

# currentDate
Today's date is 2026-07-27.

# Code organization

The five IDE plugin builds (`plugins/caveman-{codebuddy,qoder,qwen,trae,zcode}`)
share most of their hook logic. To prevent the copies from drifting, the
shared parts are generated from a single template.

## Shared source files

- **`shared/caveman-config.template.js`** is the single source of truth.
- `plugins/caveman-<id>/hooks/caveman-config.js` is **generated** — never edit
  these directly.
- Run `npm run sync:shared` to regenerate the five plugin copies from the
  template. See `shared/README.md` for the template syntax and safety rails.

## Pre-commit hook

A pre-commit hook (`githooks/pre-commit`, installed by `scripts/setup-git-hooks.js`
on `npm install`) runs sync automatically. If the template and the plugin
copies diverge, the hook regenerates and re-stages the plugin files, then
aborts the commit so you can re-review the diff. The next `git commit` passes.

Bypass with `git commit --no-verify` only if you understand the consequences —
a desynced tree will break one or more plugins at runtime.

## When to extend the shared set

Today only `caveman-config.js` is shared. If you find yourself copy-pasting a
change across multiple `caveman-stats.js` or `stop.js` files, that's the signal
to promote that module into `shared/` using the same template + sync pattern.
