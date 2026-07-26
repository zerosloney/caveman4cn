# Contributing to caveman4cn

This repo is a **dual-host marketplace** (`master0071`): one set of skills, shipped to two hosts — ZCode and CodeBuddy. All skills live in `skills/` (source of truth) and are mirrored into both plugin distributions.

## Quick orientation

| Change | File |
|--------|------|
| Caveman behavior | `skills/caveman/SKILL.md` |
| Commit message format | `skills/caveman-commit/SKILL.md` |
| Code review format | `skills/caveman-review/SKILL.md` |
| Compress logic | `skills/caveman-compress/SKILL.md` |
| Quick reference card | `skills/caveman-help/SKILL.md` |
| Token stats | `skills/caveman-stats/SKILL.md` |
| Cavecrew decision guide | `skills/cavecrew/SKILL.md` |
| ZCode installer | `scripts/install-zcode.js` |
| CodeBuddy installer | `scripts/install-codebuddy.js` |

## Build

Edit `skills/<name>/SKILL.md`, then mirror to **both** plugin distributions:

1. `plugins/caveman-zcode/skills/<name>/SKILL.md` (ZCode)
2. `plugins/caveman-codebuddy/skills/<name>/SKILL.md` (CodeBuddy)

### Mirror rules

- **5 of 7 skills are byte-identical across `skills/`, `plugins/caveman-zcode/skills/`, and `plugins/caveman-codebuddy/skills/`**: caveman, caveman-commit, caveman-compress, caveman-review, cavecrew. Edit once, copy to both.
- **`caveman-help`** diverges per host: the docs URL in the body points to the host-specific repo (`caveman-zcode` vs `caveman-codebuddy`). Mirror the body but keep the URL correct per host.
- **`caveman-stats`** diverges per host: the body points at host-specific hook paths and transcript locations (`~/.zcode/cli/agents/` vs `~/.codebuddy/projects/`). Mirror the structure but keep the paths correct per host.

### Hooks

Hook scripts are **host-specific** (different env vars, event schemas, command-vs-process type). They are not shared — edit the copy under the relevant `plugins/<host>/hooks/`:

- ZCode: `plugins/caveman-zcode/hooks/*.js` (uses `${ZCODE_PLUGIN_ROOT}`, `type: "process"`, `timeoutMs`)
- CodeBuddy: `plugins/caveman-codebuddy/hooks/*.js` (uses `${CODEBUDDY_PLUGIN_ROOT}`, `type: "command"`, `timeout` in seconds)

When porting a hook from one host to the other, adapt the schema fields — do not copy verbatim.

### Commands and agents

Commands (`plugins/<host>/commands/*.md`) and agents (`plugins/<host>/agents/*.md`) are host-specific frontmatter. Keep the two hosts in sync on content, but respect each host's frontmatter conventions.

## Code style

- Hooks must silent-fail (pass through) on filesystem errors — never trap the user. Exception: `pre-tool-use.js` fails **closed** (deny) on any error, since a broken safety guard is worse than a false block.
- Symlink-safe flag writes.
- Edit `skills/` sources, not `plugins/*/skills/` copies.

## Verifying changes

```bash
# Syntax-check all hook scripts
node -c plugins/caveman-codebuddy/hooks/*.js
node -c plugins/caveman-zcode/hooks/*.js

# Validate JSON configs
node -e "['.codebuddy-plugin/marketplace.json','marketplace.json','plugins/caveman-codebuddy/.codebuddy-plugin/plugin.json','plugins/caveman-zcode/.zcode-plugin/plugin.json','plugins/caveman-codebuddy/hooks/hooks.json','plugins/caveman-zcode/hooks/hooks.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('all JSON valid')"

# Simulate a hook
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | node plugins/caveman-codebuddy/hooks/caveman-mode-tracker.js
```
