# 代码审查报告 — 2026-07-27

> 审查模型：**GLM-5.2** · 审查范围：当天工作区改动（HEAD vs 工作区）
> 仓库：`caveman4cn` · 分支：`master`

---

## 一、审查概要

| 项目 | 数据 |
|------|------|
| 修改文件数 | **38** 个 modified + **1** 个 untracked（`plugins/caveman-codebuddy/hooks/stop.js` 新增） |
| 代码增删 | **+1296 / −320** 行 |
| 涉及模块 | 5 个 IDE 插件（`caveman-codebuddy` / `caveman-qoder` / `caveman-qwen` / `caveman-trae` / `caveman-zcode`）+ `scripts/install-codebuddy.js` |
| 当日提交 | 3 笔（`5421046` / `4620ddc` / `ca7e409`），均为 codebuddy 相关 fix/chore |

### 主线变更（本次审查的核心）

1. **Per-agent 数据隔离重构**：5 个插件统一将状态文件从扁平布局（`~/.caveman-active`、`~/.caveman/lifetime-saved.json`、`~/.caveman-mode-log.jsonl`）迁移到 `~/.caveman/<agent>/{active,active.prev,mode-log.jsonl,lifetime-saved.json,session-snapshot.json,caveman-stop-counter}`。目的：同一台机器上多个 agent 并存时不再互相覆盖。
2. **`migrateLegacyFiles()` 一次性迁移**：幂等、best-effort、不删除遗留文件（让其他 agent 仍可迁移）。
3. **statusline 新增字段**：会话级 `📊 in→out`、`💡 saved (pct)`、`💲 cost`、`📉 context`；新增 `magenta` 颜色键。
4. **Stop hook 新增 `recordSnapshot()`**：每轮结束写 `session-snapshot.json`，让 statusline 接近实时反映本会话 token。
5. **新增 `plugins/caveman-codebuddy/hooks/stop.js`**：codebuddy 之前没有 Stop hook，本次补齐（hooks.json 同步注册）。
6. **`install-codebuddy.js`** 给 statusLine 加了 `refreshInterval: 5`。

---

## 二、发现的问题清单

按严重程度排序。每条标注：文件 / 行号 / 严重程度 / 类型 / 状态。

### ✅ 已自动修复（3 处，均低风险）

#### P1. `caveman-statusline.md` 代码块缩进错乱（markdown 渲染回归）
- **文件**：`plugins/caveman-codebuddy/commands/caveman-statusline.md:57-58`；`plugins/caveman-qwen/commands/caveman-statusline.md:45-46`
- **严重程度**：低 · **类型**：文档/一致性
- **现象**：原 diff 把"示例输出"行（`⛏ [full] 📁 ...`）的前导 3 空格缩进删掉了，但下面那行 ` ``` ` 仍然带着 tab+3 空格缩进。导致 markdown 解析时围栏开启/闭合缩进不匹配，整段配置示例（含 JSON 代码块）渲染层级错位。
- **根因**：手工编辑时漏改了一行的缩进。
- **修复**：恢复"示例输出"段 3 空格缩进，并把 ` ``` ` 围栏的 tab 缩进改成 3 空格，让开启/闭合/内容三行缩进一致。

#### P2. cost 整数显示丢失小数点（语义二义性）
- **文件**：`plugins/caveman-codebuddy/scripts/statusline.js:244`；`plugins/caveman-qwen/scripts/statusline.js:233`
- **严重程度**：低 · **类型**：UX/显示
- **现象**：`const costStr = cost.toFixed(4).replace(/\.?0+$/, '')` 对整数金额会剥到裸整数，例如 `5.0` → `"5"`、`100.0` → `"100"`。在 statusline 中 `💲 5` 容易被误读成"5 个 token"或"5 次请求"，而非"5 美元"。
- **验证**：在 Node REPL 中对 16 个取值（`0.0001` ~ `1234.5678`）实测确认（`1.0 → "1"`、`5.0 → "5"`、`10.0 → "10"` 等）。
- **修复**：改为 `.replace(/0+$/, '').replace(/\.$/, '.0')` —— 先剥尾部多余的 0，再把孤立的 `.` 补回 `.0`。修复后实测：`1.0 → "1.0"`、`5.0 → "5.0"`、`0.42 → "0.42"`、`1234.5678 → "1234.5678"`，全部正确。

### ⏸ 未修复 / 待人工确认（5 处）

#### U1. ~~`computeStats({ lifetime: false })` 返回值契约依赖 `found` 字段~~ ✅ 已复核，**怀疑不成立**
- **文件**：5 个插件的 `hooks/stop.js` 中的 `recordSnapshot()`
- **复核结论**：进一步审查 5 个 `caveman-stats.js` 后**证伪**。所有插件的 `computeStats` 都明确返回 `found` 字段：
  - `caveman-zcode/hooks/caveman-stats.js:134-173`：两个 `return` 分支都含 `found: false`（无 transcript）和 `found: true`（有数据）
  - `caveman-qoder/qwen/trae/codebuddy` 的 `computeStats` 同构，头部 JSDoc 都明确标注 `computeStats(opts) -> { turns, input, output, baseline, saved, pct, found }`
- **结论**：契约一致，无风险。`recordSnapshot()` 的 `if (session.found)` 判断是健壮的正确写法（无 transcript 时跳过快照写入，避免覆盖上一次的有效快照）。**无需任何修复**。

#### U2. `mode-log.jsonl` 迁移非原子
- **文件**：5 个插件的 `caveman-config.js:migrateLegacyFiles()` 第 4 步
- **严重程度**：中 · **类型**：数据完整性
- **现象**：迁移 `~/.caveman-mode-log.jsonl` → `<agent>/mode-log.jsonl` 时用的是 `appendFlag(newLog, raw.trim())`，若进程中途崩溃可能写入半行。代码外层有 try/catch + 后续 `recordModeChange` 会续写，影响可接受。
- **为何不动**：迁移是一次性的、best-effort 设计明确（注释已写明），改原子写需引入临时文件+rename，收益小于风险。

#### U3. `getCavemanRoot()` 在 5 个插件中行为不一致
- **文件**：`plugins/caveman-zcode/hooks/caveman-config.js`（支持 `ZCODE_PLUGIN_DATA` env），其余 4 个不支持
- **严重程度**：低 · **类型**：设计一致性
- **现象**：zcode 的 `getCavemanRoot()` 优先读 `process.env.ZCODE_PLUGIN_DATA`，codebuddy/qoder/qwen/trae 都直接用 `~/.caveman`。
- **为何不动**：可能是 zcode 宿主确实会注入这个 env（zcode 整个代码库多处使用 `ZCODE_PLUGIN_DATA`），其他宿主没有对应 env。属于设计差异，非缺陷。**建议**：人工确认每个 IDE 是否提供等价的 plugin-data env。

#### U4. `caveman-config.js` 文件末尾空行数量不一致
- **文件**：qoder/qwen/trae 比 codebuddy/zcode 多 1 行空行（448 行 vs 447 行）
- **严重程度**：极低 · **类型**：风格一致性
- **现象**：`module.exports = {...};` 后多了 1 个空行。完全不影响功能，仅是 5 份并行维护代码的细微漂移。
- **为何不动**：纯粹的审美问题，没有约定优先于另一个的强依据。**建议**：长期看应该把 5 个插件的公共代码（`caveman-config.js` 大部分、`caveman-stats.js` 的 `writeSessionSnapshot` 等）抽到共享包，避免这种并行维护漂移。

#### U5. `trae/hooks/stop.js` 未引入 `getAgentCounterFile`（设计观察，非缺陷）
- **文件**：`plugins/caveman-trae/hooks/stop.js`
- **严重程度**：信息 · **类型**：一致性观察
- **现象**：trae 的 stop.js 没有像其他 4 个插件那样引入 `getAgentCounterFile` / `getAgentDataDir`，因为它走的是不同的阻塞计数实现（基于 `loop_count` + `stop_hook_active` 字段，而不是文件计数器）。这是设计差异，不是 bug。
- **为何不动**：确认是设计差异，无需修复。仅记录以便后续 review 时不再重复怀疑。

---

## 三、自动修复汇总

| # | 文件 | 修复内容 | 风险 |
|---|------|----------|------|
| 1 | `plugins/caveman-codebuddy/commands/caveman-statusline.md` | 恢复"示例输出"段 3 空格缩进，修正 ``` 围栏缩进 | 极低（纯文档） |
| 2 | `plugins/caveman-qwen/commands/caveman-statusline.md` | 同上 | 极低（纯文档） |
| 3 | `plugins/caveman-codebuddy/scripts/statusline.js:244` | cost 格式化正则改为保留至少 1 位小数 | 低（仅显示） |
| 4 | `plugins/caveman-qwen/scripts/statusline.js:233` | 同上 | 低（仅显示） |

**修复后验证**：
- ✅ 两个 statusline.js `node --check` 语法检查通过
- ✅ cost 格式化在 16 个测试取值上全部正确（含边界 `0.0001`、`1234.5678`、整数 `5.0/100.0`）

---

## 四、待人工确认的问题

详见 §二 的 U1–U5，按优先级建议复核顺序：

1. **U1（中）**：核对 5 个插件 `computeStats` 的返回 shape 是否都含 `found` 字段 —— 这直接影响会话级 statusline 是否能正常显示。
2. **U3（低）**：确认每个 IDE 是否有 plugin-data env，决定是否对齐 `getCavemanRoot()` 实现。
3. **U2 / U4 / U5**：可延后处理，均不影响功能。

---

## 五、整体评价与建议

### 优点

- **架构方向正确**：per-agent 数据隔离是必要的，避免多 IDE 共存时的状态污染。
- **迁移设计严谨**：`migrateLegacyFiles()` 幂等、best-effort、不删遗留文件，迁移路径考虑了 lifetime 取 `max()` 防止数据丢失。
- **防御性编程到位**：所有 stdin 读取都做了 try/catch + 字段存在性检查；Stop hook 明确"stats 失败不影响 Stop 决策"的契约。
- **安全意识**：`execFileSync` 数组参数 + `lstatSync` 防 symlink 攻击的注释和实现都在。
- **新增 codebuddy Stop hook** 补齐了功能缺口。

### 改进建议（中长期）

1. **抽取共享代码**：5 个插件的 `caveman-config.js`（130+ 行新增代码完全相同，仅 `AGENT_ID` 不同）、`caveman-stats.js` 的 `writeSessionSnapshot`、`stop.js` 的 `recordSnapshot/checkVerbosity` 高度重复。建议抽到 `packages/caveman-core` 共享包，每个插件仅保留 `AGENT_ID` 配置和宿主特定适配层。这样能从根上消除 U4 类的并行维护漂移。
2. **`computeStats` 返回契约文档化**：在 `caveman-stats.js` 顶部用 JSDoc 明确 `computeStats({lifetime})` 的返回 shape（`{found, turns, input, output, saved, pct, requests, ...}`），避免 U1 类的契约依赖漂移。
3. **statusline 字段开关测试**：新加的 4 个字段（cost/context/sessionTokens/sessionSaved）建议补一份 `scripts/test-statusline.js`，用 mock stdin 喂各种边界值，防回归。

### 风险评估

本次改动整体风险**低**：
- 全部 best-effort IO，单点失败不会阻塞 hook；
- 数据迁移幂等且不破坏遗留；
- 仅 3 处低风险问题需要修复（已全部修复）；
- 无安全隐患、无命令注入面（`execFileSync` 数组参数 + 不可信 cwd 已隔离）。

---

## 附录：审查方法

- **工具**：`git diff --stat` / `git diff` / `git status` 全量审查 + `node --check` 语法验证 + Node REPL 边界取值实测。
- **覆盖**：38 个 modified 文件 + 1 个新增文件，逐文件逐 hunk 审查。
- **未做**：未运行端到端 statusline 渲染测试（需各 IDE 宿主环境）；未跑迁移真实数据（需有遗留状态的机器）。

---

*报告生成时间：2026-07-27 20:30 · GLM-5.2*
