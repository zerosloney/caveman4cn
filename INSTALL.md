# 安装 caveman 到 zCode

## 安装方法

```bash
# 从项目目录安装
node scripts/install-zcode.js

# 预览安装内容
node scripts/install-zcode.js --dry-run

# 卸载
node scripts/install-zcode.js --uninstall
```

## 安装过程

`scripts/install-zcode.js` 将 `plugins/caveman/` 目录安装到 zCode 插件系统：

1. 复制插件文件到 `~/.zcode/cli/plugins/cache/zcode-plugins-official/caveman-zcode/0.1.0/`
2. 注册到 `~/.zcode/cli/plugins/marketplaces/zcode-plugins-official/marketplace.json`
3. 创建启用标记在 `~/.zcode/cli/plugins/data/caveman-zcode@zcode-plugins-official/`

安装的文件包括：
- `.zcode-plugin/plugin.json` — 插件清单
- `skills/` — 技能定义
- `commands/` — 斜杠命令
- `agents/` — 子代理定义
- `hooks/` — 钩子脚本

## 使用方法

安装后重启 zCode，在会话中输入：

- `/caveman` — 开启原始人模式（默认 full）
- `/caveman lite` — 轻度压缩
- `/caveman ultra` — 极限压缩
- `/caveman wenyan` — 文言文模式
- `/caveman-commit` — 传统提交信息
- `/caveman-review` — 代码审查
- `/caveman-compress <file>` — 压缩文件
- `/caveman-stats` — Token 统计
- `/caveman-help` — 帮助
- `stop caveman` / `normal mode` — 关闭

## 压缩级别

| 级别 | 效果 |
|------|------|
| `lite` | 去除废话，保持完整句子 |
| `full`（默认） | 省略冠词，使用片段，短同义词 |
| `ultra` | 极限压缩，每句话只出现一次事实 |
| `wenyan-lite` | 半文言文 |
| `wenyan-full` | 文言文输出 |
| `wenyan-ultra` | 极限文言文压缩 |