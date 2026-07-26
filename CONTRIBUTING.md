# Contributing to caveman-zcode

## Quick orientation

This repo distributes caveman skills to zCode as a plugin. All skills live in `skills/` and are mirrored to `plugins/caveman/skills/` for zCode distribution.

## What to edit

| Change | File |
|--------|------|
| Caveman behavior | `skills/caveman/SKILL.md` |
| Commit message format | `skills/caveman-commit/SKILL.md` |
| Code review format | `skills/caveman-review/SKILL.md` |
| Compress logic | `skills/caveman-compress/SKILL.md` |
| Quick reference card | `skills/caveman-help/SKILL.md` |
| Token stats | `skills/caveman-stats/SKILL.md` |
| Cavecrew decision guide | `skills/cavecrew/SKILL.md` |
| zCode installer | `scripts/install-zcode.js` |

## Build

Edit `skills/<name>/SKILL.md`, then mirror to `plugins/caveman/skills/<name>/SKILL.md`.

## Code style

- Hooks must silent-fail on filesystem errors
- Symlink-safe flag writes
- Edit skills/ sources, not plugins/caveman/skills/ copies