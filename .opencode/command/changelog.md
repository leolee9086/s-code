---
model: opencode/gpt-5.4
---

根据下方的结构化 changelog 输入创建 `UPCOMING_CHANGELOG.md`。
如果 `UPCOMING_CHANGELOG.md` 已存在，完全忽略其当前内容。
不要保留、合并或重用现有文件中的文本。

输入已经包含了上次非草稿发布以来的确切提交范围。
提交已经被过滤为与发布相关的包，并按发布章节分组。
不要抓取 GitHub 发布、PR 或构建你自己的提交列表。
输入可能还包含 `## Community Contributors Input` 章节。

在写入任何条目之前，使用 `git show --stat --format='' <hash>` 或 `git show --format='' <hash>` 检查真实的 diff，以便理解实际的代码变更（而不仅仅是提交消息，它们可能有误导性）。
在决定归属时，不要使用 `git log` 或作者元数据。

规则：

- 按以下顺序编写最终文件的发布章节：`## Core`、`## TUI`、`## Desktop`、`## SDK`、`## Extensions`
- 只包含至少有一条值得注意的条目的章节
- 在每个发布章节内，将 bug 修复归到 `### Bugfixes` 下
- 当章节同时有 bug 修复时，将其他值得注意的条目放在 `### Improvements` 下
- 省略空的子章节
- 每个保留的提交写一个条目
- 跳过完全内部、CI、测试、重构或非面向用户的提交
- 每个条目以大写字母开头
- 优先描述用户看到的变化，而不是内部代码变化
- 不要复制原始的提交前缀如 `fix:` 或 `feat:`，或尾部的 PR 编号如 `(#123)`
- 社区贡献归属是确定性的：仅保留来自 changelog 输入的已有 `(@username)` 后缀
- 如果输入条目没有 `(@username)` 后缀，不要添加
- 永远不要从 `git show`、提交作者、名称或邮箱地址添加新的 `(@username)` 后缀
- 如果没有值得注意的条目且没有贡献者块，则写 `No notable changes.`
- 如果没有值得注意的条目但有贡献者块，则省略所有发布章节，仅返回贡献者块
- 如果输入包含 `## Community Contributors Input`，将该标题下的块逐字追加到最终文件末尾
- 不要添加、删除、重写或重新排序该块中的贡献者名称或提交标题
- 不要从主摘要条目中衍生感谢章节
- 最终文件中不要包含 `## Community Contributors Input` 标题
- 用最少的文字表达清楚 — 用户会快速浏览 changelog，所以要精确

**重要的是，changelog 是面向用户（至少有一定技术背景）的，他们可能使用 TUI、Desktop、SDK、插件等。要透彻理解可能不立即显现的连锁影响。例如，一个包升级看似内部改动但可能修复了一个 bug。或者一次重构可能稳定了某个竞态条件，从而修复了用户的 bug。PR 标题/正文 + 提交消息会给你作者的上
下文，通常包含结果而不仅仅是技术细节。**

<changelog_input>

!`bun script/raw-changelog.ts $ARGUMENTS`

</changelog_input>
