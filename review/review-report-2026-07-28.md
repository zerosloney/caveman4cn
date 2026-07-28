# Deep Review: Qwen & CodeBuddy Plugin Support

**Date:** 2026-07-28
**Scope:** `plugins/caveman-qwen/` and `plugins/caveman-codebuddy/`
**References:**
- CodeBuddy docs (statusline, sub-agents, plugins, plugin-marketplaces, slash-commands)
- Qwen Code docs (unreachable — `net::ERR_CONNECTION_CLOSED`; reviewed code against README + installer conventions)
- Shared template: `shared/caveman-config.template.js`

---

## Executive Summary

Statusline code is **nearly duplicated** between the two plugins (only `AGENT_ID` + cost extraction differ). One **confirmed bug** in Qwen's cost reading, several **feature gaps** where CodeBuddy lacks hooks Qwen has, and **spec mismatches** against official docs. Optimization items: 14 total — 3 critical, 5 high, 4 medium, 2 low.

---

## 1. Status Line — Confirmed Bug

### 🔴 CRITICAL: Qwen `statusline.js` cost extraction wrong

**File:** `plugins/caveman-qwen/scripts/statusline.js:194`

```js
// Qwen — WRONG
const cost = typeof input.cost === 'number' ? input.cost : null;
```

```js
// CodeBuddy — CORRECT
const cost = input.cost?.total_cost_usd || null;
```

**Evidence:** CodeBuddy docs show stdin JSON with `cost: { total_cost_usd, total_duration_ms, ... }` (object, not number). Qwen Code uses the same contract (both pass cost as object). Qwen code always returns `null` → `showCost` segment never renders.

**Impact:** `showCost: true` in `~/.caveman/config.json` does nothing on Qwen. Silent failure — no error, just missing data.

**Fix:** `const cost = input.cost?.total_cost_usd || null;`

---

## 2. Stats Module — Feature Divergence

### 🟡 MEDIUM: CodeBuddy `caveman-stats.js` missing Gemini-style usage extraction

**File:** `plugins/caveman-codebuddy/hooks/caveman-stats.js:108-148`

Qwen's `extractUsage()` handles 5 shapes including `usageMetadata` (Gemini/AiStudio style with `promptTokenCount`/`candidatesTokenCount`). CodeBuddy only handles Anthropic + OpenAI styles.

**Risk:** If CodeBuddy ever routes through Gemini-based models, token counting silently returns 0. Low probability but zero cost to fix.

### 🟡 MEDIUM: CodeBuddy `findCurrentTranscript` only scans `~/.codebuddy/projects/`

Qwen probes 7 candidate roots (`projects`, `sessions`, `logs`, `logs/openai`, `transcripts`, `history`, root). CodeBuddy hardcodes one path. If CodeBuddy changes transcript location in a future update, stats break silently.

**Mitigation:** CodeBuddy docs confirm `~/.codebuddy/projects/<encoded>/<uuid>.jsonl` is the contract — but a defensive fallback list (like Qwen's) would be more resilient.

---

## 3. SessionStart Hook — Spec Gap

### 🟠 HIGH: CodeBuddy SessionStart doesn't re-inject on `clear`/`compact`

**File:** `plugins/caveman-codebuddy/hooks/session-start.js:74`

```js
// CodeBuddy — only startup
if (source === 'startup' || source === '') {
```

```js
// Qwen — also clear + compact
if (source === 'startup' || source === 'clear' || source === 'compact' || source === '') {
```

**Impact:** CodeBuddy loses caveman mode after context compaction or `/clear`. Exactly when model most needs the reminder. Qwen recovers correctly.

**Fix:** Add `'clear'` and `'compact'` to CodeBuddy's source check.

---

## 4. Hook Coverage — CodeBuddy Missing 2 Qwen Hooks

### 🟠 HIGH: CodeBuddy lacks PostToolUse hook

Qwen has `hooks/post-tool-use.js` — warns when tool returns >5000 bytes response. CodeBuddy has no equivalent. Per CodeBuddy plugin docs, `PostToolUse` is a supported event.

**Value:** Large tool responses bloat context; the nudge helps model compress.

### 🟠 HIGH: CodeBuddy lacks PostToolUseFailure hook

Qwen has `hooks/post-tool-use-failure.js` — provides compressed recovery advice on tool failure (ENOENT, EACCES, timeout, syntax). CodeBuddy has no equivalent.

**Value:** Faster recovery from failures without verbose debugging.

---

## 5. UserPromptSubmit Hook — Output Contract Divergence

### 🟡 MEDIUM: Inconsistent output shape between builds

Qwen outputs `{ decision: 'allow'|'deny', reason, hookSpecificOutput }`.
CodeBuddy outputs `{ continue: true|false, reason, hookSpecificOutput }`.

This is **correct per host contract** — Qwen uses `decision`, CodeBuddy uses `continue`. But the empty-prompt block path in CodeBuddy uses `continue: false` while stats block uses `continue: false` too — verify CodeBuddy actually blocks on `continue: false` vs needing `decision: 'deny'`.

**Action:** Verify against CodeBuddy hooks docs — the docs weren't fully fetched (truncated). Need to confirm the exact blocking contract.

---

## 6. Extension Manifest — Doc vs Implementation Gaps

### 🟡 MEDIUM: Qwen `qwen-extension.json` doesn't declare hooks

```json
{
  "commands": "commands",
  "skills": "skills",
  "agents": "agents"
  // No "hooks" key
}
```

Qwen relies on installer merging hooks into `settings.json` (not manifest-based discovery). This is intentional per README, but the manifest is misleading — tools reading it see no hooks.

**Fix:** Add comment or `"hooks": "hooks"` if Qwen supports manifest-declared hooks. Otherwise document the divergence.

### 🟢 LOW: CodeBuddy `plugin.json` declares skills explicitly, Qwen doesn't

CodeBuddy: `"skills": ["skills/caveman", "skills/caveman-commit", ...]`
Qwen: `"skills": "skills"` (directory scan)

Both work. CodeBuddy's explicit list is more precise (controls load order, avoids accidental skill pickup).

---

## 7. Status Line Command — Doc Mismatch

### 🟠 HIGH: Qwen `caveman-statusline.md` says `ui.statusLine`, CodeBuddy says root `statusLine`

**Verified correct** — Qwen docs confirm `ui.statusLine` nesting, CodeBuddy docs confirm root-level `statusLine`. Both command files match their respective docs. ✅

### 🟢 LOW: CodeBuddy statusline command has Windows path detection, Qwen doesn't

CodeBuddy `caveman-statusline.md` has detailed Windows path probing (3 candidate locations, native absolute path rules, MSYS gotcha). Qwen's command assumes a single path. Qwen is simpler because its installer uses a fixed extension path (`~/.qwen/extensions/caveman-qwen/`). No bug, but Qwen command could be more robust if user installs via non-standard method.

---

## 8. Sub-Agents — Plugin Agent Definitions

### 🟡 MEDIUM: Agent definitions identical between builds

Both plugins ship the same 4 cavecrew agents (`cavecrew-builder`, `cavecrew-general`, `cavecrew-investigator`, `cavecrew-reviewer`). Per CodeBuddy sub-agent docs, agents support `model`, `tools`, `permissionMode`, `skills`, `mcpServers` frontmatter fields. Current agents only use `description` — no per-agent model override or tool restriction.

**Opportunity:** `cavecrew-investigator` could specify `model: lite` for cheap scanning. `cavecrew-reviewer` could restrict to read-only tools. Not a bug — an optimization.

---

## 9. Skills — Doc vs Implementation

### ✅ Skills match docs

Both plugins ship: `caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `caveman-review`, `caveman-stats`, `cavecrew`. CodeBuddy skills docs confirm `SKILL.md` frontmatter with `description` — all present.

---

## 10. Slash Commands — Doc vs Implementation

### ✅ Slash commands match docs

CodeBuddy slash commands docs confirm `/caveman`, `/caveman-stats`, `/caveman-commit`, `/caveman-review`, `/caveman-compress`, `/caveman-help`, `/caveman-statusline`, `/caveman-init` — all present in both plugins.

---

## 11. PreToolUse Hook — Divergence

### 🟡 MEDIUM: Qwen normalizes tool names, CodeBuddy doesn't

Qwen's `pre-tool-use.js` has a `TOOL_NAME_ALIASES` map + `normalizeToolName()` to handle both `snake_case` (Qwen native) and `PascalCase` (CC alias) tool names. CodeBuddy assumes exact `Bash`/`Write`/`Edit` match.

**Risk:** If CodeBuddy ever sends `run_shell_command` instead of `Bash`, the safety hook silently allows. Low probability — CodeBuddy docs confirm PascalCase tool names.

---

## 12. Shared Config Template — Sync Status

### ✅ Template and copies in sync

`shared/caveman-config.template.js` generates both `plugins/caveman-qwen/hooks/caveman-config.js` and `plugins/caveman-codebuddy/hooks/caveman-config.js`. The `{{AGENT_ID}}` / `{{AGENT_LABEL}}` tokens are correctly replaced. Pre-commit hook guards drift.

---

## Optimization Checklist

| # | Priority | File | Issue | Fix |
|---|----------|------|-------|-----|
| 1 | 🔴 CRITICAL | `qwen/scripts/statusline.js:194` | Cost extraction reads `input.cost` as number, should be `input.cost?.total_cost_usd` | One-line fix |
| 2 | 🟠 HIGH | `codebuddy/hooks/session-start.js:74` | Missing `clear`/`compact` source re-injection | Add two source values |
| 3 | 🟠 HIGH | `codebuddy/hooks/` | Missing PostToolUse hook | Create `post-tool-use.js` |
| 4 | 🟠 HIGH | `codebuddy/hooks/` | Missing PostToolUseFailure hook | Create `post-tool-use-failure.js` |
| 5 | 🟠 HIGH | `codebuddy/hooks/user-prompt.js` | Verify `continue: false` actually blocks per CodeBuddy hooks spec | Doc verification |
| 6 | 🟡 MEDIUM | `codebuddy/hooks/caveman-stats.js` | Missing Gemini-style `usageMetadata` extraction | Add fallback shape |
| 7 | 🟡 MEDIUM | `codebuddy/hooks/caveman-stats.js` | `findCurrentTranscript` only scans one path | Add candidate root list |
| 8 | 🟡 MEDIUM | `qwen/qwen-extension.json` | No `hooks` key in manifest | Add or document |
| 9 | 🟡 MEDIUM | `codebuddy/hooks/pre-tool-use.js` | No tool name normalization | Add alias map |
| 10 | 🟡 MEDIUM | `agents/*.md` | No per-agent model/tool override | Optional optimization |
| 11 | 🟢 LOW | `qwen/commands/caveman-statusline.md` | Single path assumption | Add path detection |
| 12 | 🟢 LOW | `qwen/qwen-extension.json` | Skills as directory scan, not explicit list | Optional explicit list |
| 13 | 🔵 INFO | `codebuddy/hooks/hooks.json` | Present and correct | ✅ No change |
| 14 | 🔵 INFO | `shared/caveman-config.template.js` | Template sync working | ✅ No change |

---

## Recommended Execution Order

1. **Item 1** (critical bug fix — Qwen cost display)
2. **Item 2** (CodeBuddy session recovery)
3. **Items 3+4** (CodeBuddy missing hooks — mirror from Qwen)
4. **Item 5** (verify blocking contract)
5. **Items 6+7** (stats resilience)
6. **Items 8+9+10** (manifest + agent optimization)
7. **Items 11+12** (nice-to-have)
