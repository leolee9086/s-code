---
description: "仅升级 AI SDK 依赖的次要/补丁版本"
---

请阅读 @package.json 和 @packages/opencode/package.json。

你的任务是检查 AI SDK 依赖，找出哪些有可以升级的版本（仅次要或补丁版本，不要主版本变更）。

我需要一份报告，列出每个依赖及其可以升级到的版本。
最好能给我每个依赖变更的简要总结和 changelog 链接，或者至少一些参考信息，让我可以看到修复了哪些 bug 或添加了哪些新功能。

考虑为每个依赖使用 subagent 以节省你的上下文窗口。

以下是一些依赖的简短列表（请尽量全面）：

- "ai"
- "@ai-sdk/openai"
- "@ai-sdk/anthropic"
- "@openrouter/ai-sdk-provider"
- 等等

暂不要升级依赖，只需列出所有依赖及其可升级到的版本（仅次要或补丁版本）。

将你的发现写入 ai-sdk-updates.md
