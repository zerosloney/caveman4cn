---
name: caveman-compress
description: >
  Compress natural language memory files (CLAUDE.md, todos, preferences) into caveman format
  to save input tokens. Preserves all technical substance, code, URLs, and structure.
  Compressed version overwrites the original file. Human-readable backup saved as FILE.original.md.
  Trigger: /caveman-compress FILEPATH or "compress memory file"
  中文触发：用户说"压缩文件""压缩 md""省 token""压缩记忆文件"，或调用 /caveman-compress <文件路径> 时触发。
---

# Caveman Compress

## 用途

把自然语言文件（CLAUDE.md、todos、preferences）压缩成 caveman 语体以削减 input token。压缩版覆盖原文件。人类可读备份保存为 `<filename>.original.md`。

## 触发

`/caveman-compress <filepath>` 或用户要求压缩某个 memory 文件时。

## 流程

1. 压缩脚本位于 `scripts/`（与本 SKILL.md 相邻）。路径未立即可用时，在本 SKILL.md 旁搜索 `scripts/__main__.py`。

2. 在包含本 SKILL.md 的目录下，运行：

python3 -m scripts <absolute_filepath>

3. CLI 会：
- 检测文件类型（不耗 token）
- 调用 Claude 压缩
- 校验输出（不耗 token）
- 出错时：用 Claude 定点修复（仅针对性修复，不重新压缩）
- 最多重试 2 次
- 2 次重试仍失败：向用户报错，原文件保持不动

4. 向用户返回结果

## 压缩规则

### 删除
- 冠词：a, an, the
- 填充词：just, really, basically, actually, simply, essentially, generally
- 客套："sure", "certainly", "of course", "happy to", "I'd recommend"
- 对冲："it might be worth", "you could consider", "it would be good to"
- 冗余措辞："in order to" → "to", "make sure to" → "ensure", "the reason is because" → "because"
- 连接废话："however", "furthermore", "additionally", "in addition"

### 逐字保留（绝不修改）
- 代码块（fenced ``` 和缩进）
- 行内代码（`backtick content`）
- URL 和链接（完整 URL、markdown 链接）
- 文件路径（`/src/components/...`, `./config.yaml`）
- 命令（`npm install`, `git commit`, `docker build`）
- 技术术语（库名、API 名、协议、算法）
- 专有名词（项目名、人名、公司名）
- 日期、版本号、数值
- 环境变量（`$HOME`, `NODE_ENV`）

### 保留结构
- 所有 markdown 标题（保留精确标题文本，压缩下方正文）
- 列表层级（保留嵌套层级）
- 有序列表（保留编号）
- 表格（压缩单元格文本，保留结构）
- markdown 文件的 frontmatter/YAML 头

### 压缩
- 用短同义词："big" 而非 "extensive"，"fix" 而非 "implement a solution for"，"use" 而非 "utilize"
- 片段可用："Run tests before commit" 而非 "You should always run tests before committing"
- 删除 "you should", "make sure to", "remember to" —— 直接陈述动作
- 合并意思重复的条目
- 多个示例展示同一模式时只保留一个

关键规则：
``` ... ``` 内的任何内容必须逐字复制。
不要：
- 删除注释
- 删除空格
- 重排行序
- 缩短命令
- 简化任何东西

行内代码（`...`）必须逐字保留。
不要修改反引号内的任何内容。

如果文件含代码块：
- 把代码块视为只读区域
- 只压缩代码块外的文本
- 不要合并代码块周围的章节

## 模式

Original:
> You should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.

Compressed:
> Run tests before push to main. Catch bugs early, prevent broken prod deploys.

Original:
> The application uses a microservices architecture with the following components. The API gateway handles all incoming requests and routes them to the appropriate service. The authentication service is responsible for managing user sessions and JWT tokens.

Compressed:
> Microservices architecture. API gateway route all requests to services. Auth service manage user sessions + JWT tokens.

## 边界

- 仅压缩自然语言文件（.md, .txt, .typ, .typst, .tex, 无扩展名）
- 绝不修改：.py, .js, .ts, .json, .yaml, .yml, .toml, .env, .lock, .css, .html, .xml, .sql, .sh
- 文件含混合内容（散文 + 代码）时，仅压缩散文部分
- 不确定某段是代码还是散文时，保持不变
- 原文件覆盖前备份为 FILE.original.md
- 绝不压缩 FILE.original.md（跳过它）
