# caveman-help

速查卡。一次性，不切换模式。

## 它做什么

打印一张 cheat sheet，涵盖所有 caveman 模式、兄弟技能、停用触发、以及如何通过环境变量或配置文件设置默认模式。一次性显示——不切换活动模式、不写 flag 文件、不持久化任何东西。忘了 slash 命令时使用。

## 如何调用

```
/caveman-help
```

也会在 "caveman help"、"what caveman commands"、"how do I use caveman" 时触发。

## 示例输出

```
Modes:
  /caveman              full (default)
  /caveman lite         lighter
  /caveman ultra        extreme
  /caveman wenyan       classical Chinese

Skills:
  /caveman-commit       terse Conventional Commits
  /caveman-review       one-line PR comments
  /caveman-stats        session token savings

Deactivate:
  "stop caveman" or "normal mode"
```

## 一次性命令后恢复

`/caveman-commit`、`/caveman-review`、`/caveman-compress` 是一次性命令——它们临时切换到各自的工作模式，完成后**自动恢复你之前的散文模式**（如 full/ultra）。无需手动切回，状态暂存在 `~/.caveman-active.prev`，下一个普通提问即恢复。

## 另见

- [`SKILL.md`](./SKILL.md) —— 完整参考卡
- [Caveman README](../../README.md) —— 仓库总览
