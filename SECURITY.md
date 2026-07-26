# Security Policy

## Supported Versions

This repo only supports the latest stable release of the `master0071` marketplace plugins (`caveman-zcode`, `caveman-codebuddy`) with security patches.

## Reporting a Vulnerability

If you discover a security flaw — such as arbitrary shell execution via a hook, workspace folder escapes, credential hijack via injected prompts, or malicious JSON parsing in the stats hook — **do not open a public issue**. Report it privately by contacting the maintainer via [GitHub's private vulnerability reporting](https://github.com/zerosloney/caveman4cn/security/advisories/new) or email.

## Privacy & Telemetry

**No telemetry. Zero.** There is no analytics, crash reporting, account system, or backend to receive data. Nothing about your code, prompts, or sessions is transmitted anywhere.

### After install: zero network calls

Once a plugin is installed, it makes no network connections. Verifiable by auditing this repo:

- **Skills** (`skills/*/SKILL.md`) are markdown prompts — no executable code, no network.
- **Hooks** (`plugins/caveman-codebuddy/hooks/*.js`, `plugins/caveman-zcode/hooks/*.js`) are local Node scripts. They read and write local files only (session transcripts, the `~/.caveman-active` flag, `~/.caveman/lifetime-saved.json`) and contain no HTTP, fetch, or socket modules.
- **`/caveman-stats`** parses local CodeBuddy/ZCode session JSONL files under `~/.codebuddy/projects/` (or `~/.zcode/cli/agents/`) to display token counts. It uses a hardcoded compression constant (2.86) and transmits nothing.
- **`/caveman-compress`** does local file I/O only — it rewrites one explicitly named local file and creates a `.original.md` backup. No globbing, no shell-out.
- **`/caveman-init`** writes the activation rule into the target repo's `AGENTS.md`. One local file write. No network.
- **`pre-tool-use.js`** (CodeBuddy safety hook) inspects the incoming tool call against a hardcoded denylist of destructive patterns (rm -rf /, system file writes, etc.) and returns allow/deny. It reads stdin, writes stdout, touches nothing on disk.

### At install time: exactly these network requests, nothing else

The only network activity happens when you run an installer or add the marketplace:

- `node scripts/install-codebuddy.js` / `install-zcode.js` copy plugin files into the host's plugin directory and run `codebuddy plugin install` / the ZCode equivalent, which fetches from this repo via GitHub.
- `/plugin marketplace add zerosloney/caveman-codebuddy` (or the zcode variant) clones the repo from GitHub.

No data is uploaded during these steps.

### What stays on your machine

All data is local: skill files, the `~/.caveman-active` mode flag, `~/.caveman/lifetime-saved.json` stats badge, `.original.md` backups. To remove what the installer wrote, run `node scripts/install-codebuddy.js --uninstall` (or the zcode equivalent).

### Enterprise / air-gapped use

After install, the plugin is self-contained and fully functional offline. No license server, no external backend. For air-gapped systems, clone this repo internally and run the installer against the local copy.

## About scanner warnings

- **Snyk "High Risk" on `caveman-compress`:** this skill reads, rewrites, and backs up a user-specified file. In-place file rewriting triggers generic risk scoring. It is a known, intended capability — no hidden network access, no shell execution, only explicitly named files. See `plugins/caveman-codebuddy/skills/caveman-compress/SECURITY.md` for the per-skill breakdown.
- **Hook scripts flagged for subprocess/file-I/O patterns:** the hooks invoke `node` to parse stdin JSON and emit stdout JSON. They do not spawn arbitrary processes, do not read files outside the documented paths, and fail open (SessionStart/UserPromptSubmit) or fail closed (PreToolUse safety guard) on any error.
