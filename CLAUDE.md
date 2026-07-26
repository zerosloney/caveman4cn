# CLAUDE.md — caveman-zcode

Caveman makes zCode respond in compressed caveman-style prose. Cuts 65% output tokens (measured), full technical accuracy. Ships as a zCode plugin.

## File structure

```
caveman-zcode/
├── plugins/caveman/         # zCode plugin (distribution)
│   ├── .zcode-plugin/       # zCode plugin manifest
│   ├── skills/              # Skill definitions (mirrored from root skills/)
│   ├── commands/            # Slash command definitions
│   ├── agents/              # Sub-agent definitions
│   └── hooks/               # Hook scripts
├── scripts/install-zcode.js # zCode installer
├── skills/                  # Source of truth for all skills
│   ├── caveman/             # Core caveman behavior
│   ├── caveman-commit/      # Commit message format
│   ├── caveman-review/      # Code review format
│   ├── caveman-compress/    # File compression
│   ├── caveman-help/        # Quick reference card
│   ├── caveman-stats/       # Token statistics
│   └── cavecrew/            # Sub-agent decision guide
├── AGENTS.md                # Auto-discovery (zCode reads this)
├── README.md                # Product front door
├── INSTALL.md               # Install instructions
└── package.json             # Project metadata
```

## Key rules

- Edit `skills/<name>/SKILL.md` for behavior changes. Never edit synced copies under `plugins/caveman/skills/`.
- `plugins/caveman/` is the distribution copy. Source of truth is `skills/<name>/SKILL.md`.
- README is the product front door. Optimize for non-technical readers.
- Install commands in INSTALL.md must be accurate.
- Benchmark numbers must be real. Never fabricate.

## Skills

Each skill has a human-facing `README.md` and LLM-facing `SKILL.md`. Don't merge them.

### Intensity levels

Defined in `skills/caveman/SKILL.md`. Six levels: `lite`, `full` (default), `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`. Persists until changed or session ends.

### Auto-clarity rule

Caveman drops to normal prose for: security warnings, irreversible action confirmations, multi-step sequences where fragment ambiguity risks misread, user confused or repeating question. Resumes after.

### caveman-compress

Sub-skill in `skills/caveman-compress/SKILL.md`. Takes file path, compresses prose to caveman style, writes to original path, saves backup at `<filename>.original.md`. Requires Python 3.10+.

### caveman-commit / caveman-review

Independent skills. caveman-commit: Conventional Commits, ≤50 char subject. caveman-review: one-line comments in `L<line>: <severity> <problem>. <fix>.` format.