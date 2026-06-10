<!--
  内置技能。名称和描述在代码中注册于
  packages/opencode/src/skill/index.ts（参见 CUSTOMIZE_OPENCODE_SKILL_NAME
  和 CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION）。以下正文即为
  技能的内容。
-->

# 自定义 opencode

opencode 严格验证自己的配置，并在字段错误时拒绝启动。以下结构涵盖了常见配置面，但它们只是**摘要，而非权威来源**。

## 完整模式参考

每个配置选项的权威列表——包含字段类型、枚举、默认值和描述——位于已发布的 JSON Schema 中：

**<https://opencode.ai/config.json>**

如果此技能未记录某个字段，或者你在编写配置前需要确认确切结构，**请获取该 URL 并直接阅读 schema**，而不是猜测。opencode 在配置无效时会硬失败，因此错误结构的代价就是启动失败。

此外，每个 `opencode.json` 都应声明
`"$schema": "https://opencode.ai/config.json"`，以便用户的编辑器在输入时捕获错误。

## 应用更改

配置在 opencode 启动时加载一次，不支持热重载。保存对 `opencode.json`、agent 文件、技能、插件或任何其他配置文件的更改后，**告知用户退出并重启 opencode** 以使更改生效。正在运行的会话将继续使用已加载的配置。

## 文件存放位置

| 范围                         | 路径                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 项目配置                      | `./opencode.json`, `./opencode.jsonc`, 或 `.opencode/opencode.json`（opencode 从 cwd 向上遍历到工作树根目录）                |
| 全局配置                      | `~/.config/opencode/opencode.json`（不是 `~/.opencode/`）                                                                     |
| 项目 agent                    | `.opencode/agent/<name>.md` 或 `.opencode/agents/<name>.md`                                                                   |
| 全局 agent                    | `~/.config/opencode/agent(s)/<name>.md`                                                                                       |
| 项目技能                      | `.opencode/skill(s)/<name>/SKILL.md`                                                                                          |
| 全局技能                      | `~/.config/opencode/skill(s)/<name>/SKILL.md`                                                                                 |
| 外部技能（自动加载）          | `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`                                                        |

来自各范围的配置会进行深度合并。项目配置覆盖全局配置。`opencode.json` 中未知的顶级键会被拒绝并报 `ConfigInvalidError`。

## opencode.json

所有字段都是可选的。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "username": "string",
  "model": "provider/model-id",
  "small_model": "provider/model-id",
  "default_agent": "agent-name",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "share": "manual" | "auto" | "disabled",
  "autoupdate": true | false | "notify",
  "snapshot": true,
  "instructions": ["AGENTS.md", "docs/style.md"],

  "skills": {
    "paths": [".opencode/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "agent": {
    "my-agent": {
      "model": "anthropic/claude-sonnet-4-6",
      "mode": "subagent",
      "description": "...",
      "permission": { "edit": "deny" }
    }
  },

  "command": {
    "deploy": { "description": "...", "prompt": "..." }
  },

  "provider": {
    "anthropic": { "options": { "apiKey": "..." } }
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "env": {}
    },
    "remote-thing": {
      "type": "remote",
      "url": "https://...",
      "headers": { "Authorization": "Bearer ..." }
    }
  },

  "plugin": [
    "opencode-gemini-auth",
    "opencode-foo@1.2.3",
    "./local-plugin.ts",
    ["opencode-bar", { "option": "value" }]
  ],

  "permission": {
    "edit": "deny",
    "bash": { "git *": "allow", "*": "ask" }
  },

  "formatter": false,
  "lsp": false,

  "experimental": {
    "primary_tools": ["edit"],
    "mcp_timeout": 30000
  },

  "tool_output": { "max_lines": 200, "max_bytes": 8192 },

  "compaction": { "auto": true, "tail_turns": 15 }
}
```

值得明确指出的事项：

- `model` 始终带有提供商前缀：`"anthropic/claude-sonnet-4-6"`。
- `skills` 是一个包含 `paths` 和/或 `urls` 的对象，不是数组。
- `agent` 是一个以 agent 名称为键的对象，不是数组。
- `plugin` 是字符串或 `[name, options]` 元组的数组，不是对象。
- `mcp[name].command` 是字符串数组，绝不是一个单一字符串。`type` 是必需的。
- `permission` 要么是字符串动作，要么是以工具名称为键的对象。

## 技能

opencode 的技能加载器会在技能目录内扫描 `**/SKILL.md`。文件必须确切命名为 `SKILL.md`，并位于以技能命名的自己的文件夹中：

```
.opencode/skills/my-skill/SKILL.md
```

Frontmatter：

```markdown
---
name: my-skill
description: 一句话概括此技能的作用以及何时触发它。将用户可能说的字面关键词或文件名前置。
---

# My Skill

（技能正文使用 markdown：指令、示例、参考资料）
```

- `name` 是必需的，小写连字符分隔，最多 64 个字符，并与文件夹名称匹配。
- `description` 实际上是必需的：没有描述的技能会被过滤掉，永远不会暴露给模型。既要覆盖技能的功能（_what_），也要覆盖何时使用（_when_）。以第三人称撰写（"当...时使用"，而不是"我帮助..."）。将具体的触发关键词和文件名前置；如果技能在相邻主题上应保持安静，请使用"仅当...时使用"进行限制。
- 可选：`license`、`compatibility`、`metadata`（字符串-字符串映射）。

通过 `skills.paths`（递归扫描 `**/SKILL.md`）和 `skills.urls`（每个 URL 提供技能列表）从非默认位置注册技能。

## Agents

有两种定义 agent 的方式。对于非平凡的情况，使用文件形式。

### 内联（在 `opencode.json` 中）

```json
{
  "agent": {
    "my-reviewer": {
      "description": "审查 PR 的样式违规。",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permission": { "edit": "deny", "bash": "ask" },
      "prompt": "你是一位严格的 PR 审查者..."
    }
  }
}
```

### 文件

```
.opencode/agent/my-reviewer.md      或     .opencode/agents/my-reviewer.md
```

```markdown
---
description: 审查 PR 的样式违规。
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

你是一位严格的 PR 审查者。专注于...
```

文件正文成为 agent 的 `prompt`。不要在 frontmatter 中同时放置 `prompt:`。

`mode` 是 `"primary"`、`"subagent"`、`"all"` 之一。

允许的顶级 frontmatter 字段：`name, model, variant, description, mode,
hidden, color, steps, options, permission, disable, temperature, top_p`。任何未知字段会被静默路由到 `options`。

要禁用内置 agent：`agent: { build: { disable: true } }`，或在文件中使用 frontmatter 的 `disable: true`。

`default_agent` 必须指向一个非隐藏的、primary-mode 的 agent。

### 内置 agents

opencode 内置了 `build`、`plan`、`general`、`explore`。隐藏的内部 agents：`compaction`、`title`、`summary`。要覆盖内置字段，在 `agent: { <名称>: { ... } }` 中定义相同的键。

## 插件

`plugin:` 是一个数组。每个条目是以下之一：

```json
"plugin": [
  "opencode-gemini-auth",            // npm 规范，最新版
  "opencode-foo@1.2.3",              // npm 规范，固定版本
  "./local-plugin.ts",               // 文件路径，相对于声明配置
  "file:///abs/path/plugin.js",      // 文件 URL
  ["opencode-bar", { "key": "val" }] // 带选项的元组形式
]
```

自动发现的插件（无需配置条目）：`.opencode/plugin/` 或 `.opencode/plugins/` 中的任何 `*.ts` 或 `*.js` 文件。

插件模块导出 `default`（或任何命名导出）类型为 `Plugin = (input: PluginInput, options?) => Promise<Hooks>`。导出是一个函数，而不是普通对象字面量，并且该函数返回一个对象（如果无需注册任何内容，则返回 `{}`）。

```ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client, project, directory, $ }) => {
  return {
    config: (cfg) => {
      // cfg 是实时的合并配置；在此处变更字段。
    },
    "tool.execute.before": async (input, output) => {
      // 在工具运行前变更 output.args
    },
  }
}) satisfies Plugin
```

Hook 接口（原地变更 `output`；返回 `void`）：

- `event(input)`：每个总线事件
- `config(cfg)`：初始化时使用合并后的配置调用一次
- `chat.message`、`chat.params`、`chat.headers`
- `tool.execute.before`、`tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `shell.env`
- `permission.ask`
- `experimental.chat.messages.transform`、`experimental.chat.system.transform`、
  `experimental.session.compacting`、`experimental.compaction.autocontinue`、
  `experimental.text.complete`

特殊对象形状（非回调）：`tool: { my_tool: { ... } }`、`auth: { ... }`、`provider: { ... }`。

## MCP 服务器

`mcp:` 是一个以服务器名称为键的对象。每个服务器通过 `type` 区分：

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "env": { "BROWSER": "chromium" }
    },
    "github": {
      "type": "remote",
      "url": "https://...",
      "enabled": true,
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }
    },
    "old-server": { "enabled": false }
  }
}
```

`command` 是字符串数组。`type` 是必需的。使用 `enabled: false` 禁用在父配置中继承的服务器。

## 权限

```json
"permission": {
  "edit": "deny",
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

动作：`"allow"`、`"ask"`、`"deny"`。

每个工具的值形式：`"allow"` 简写（视为 `{"*": "allow"}`），或对象 `{ pattern: action }`。在对象内部，**插入顺序很重要**。opencode 评估**最后**匹配的规则，因此将宽泛规则放在前面，狭窄规则放在后面。

`permission: "allow"`（顶层的字符串）是"允许一切"的简写，很少是用户想要的。

已知的权限键：`read, edit, glob, grep, list, bash, task,
external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop,
skill`。其中一些（`todowrite`、
`question`、`webfetch`、`websearch`、`doom_loop`）只接受扁平的动作，不接受按模式的对象。

`external_directory` 模式是文件系统路径（使用 `~/`、绝对路径或像 `~/projects/**` 这样的 glob）。

每个 agent 的 `permission:` 覆盖顶级 `permission:`。计划模式位于 `plan` agent 的权限规则集上（`edit: deny *`）。

## 逃生舱

当用户的配置损坏且 opencode 无法启动时，这些环境变量可以帮助：

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`：跳过项目的本地 `opencode.json`，仅从全局启动。从项目目录运行，opencode 加载，用户编辑损坏的文件，然后不带标志重新启动。
- `OPENCODE_CONFIG=/path/to/file.json`：加载额外的显式配置。
- `OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'`：注入内联 JSON 作为最终的本地作用域合并。
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`：跳过默认插件。
- `OPENCODE_PURE=1`：完全跳过外部插件。
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`、
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`：跳过 `~/.claude/` 和 `~/.agents/` 下的外部技能扫描。

## 提出编辑时

- 在写入之前根据 schema 验证。如果你不确定某个字段的确切形状，或此技能未涵盖该字段，请获取 `https://opencode.ai/config.json` 并阅读 schema，而不是猜测。
- 保留 `$schema` 和用户未要求更改的任何现有字段。
- 对于 agent、技能和插件定义，优先在正确位置创建新文件，而不是将所有内容内联在 `opencode.json` 中。
- 如果用户现有的配置格式错误，请指向上面的环境变量逃生舱，这样他们可以在 opencode 内部编辑而不会破坏会话。
- 保存任何配置更改后，提醒用户退出并重启 opencode——正在运行的会话将继续使用已加载的配置。