# 配置系统

## 配置加载链

`src/config/config.ts` — `Config.Service`

```
Global config
  ~/.config/opencode/config.json
  ~/.config/opencode/opencode.json
  ~/.config/opencode/opencode.jsonc
  ↓ mergeDeep
Env override (OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT)
  ↓ mergeDeep
Project config
  <project-root>/opencode.jsonc  (优先)
  <project-root>/opencode.json
  ↓ mergeDeep
远程配置 (URL 扩展)
  ↓ mergeDeep
默认值 (代码内定义)
```

### 环境变量覆盖

| 变量 | 效果 |
|------|------|
| `OPENCODE_CONFIG` | 指定配置文件路径 |
| `OPENCODE_CONFIG_DIR` | 指定配置目录 |
| `OPENCODE_CONFIG_CONTENT` | 直接指定 JSON 格式的配置内容 |
| `OPENCODE_PURE=1` | 禁用外部插件 |

## 配置 Schema

定义在 `config.ts` 的 `Info` struct（~60 个字段）：

```ts
export const Info = Schema.Struct({
  $schema?, shell?, logLevel?,
  server?, command?, skills?, reference?,
  watcher?, snapshot?, plugin?, share?,
  disabled_providers?, enabled_providers?,
  model?, small_model?, default_agent?,
  agent?, provider?, mcp?,
  formatter?, lsp?, instructions?,
  permission?, content_filter?,
  tools?, attachment?, enterprise?,
  tool_output?, compaction?,
  experimental?,
  ... deprecated legacy fields
})
```

### 核心字段详解

- `model` — 默认模型（`provider/model` 格式）
- `small_model` — 轻量模型（标题生成等）
- `default_agent` — 默认 agent（必须是 primary agent）
- `agent` — 自定义 agent 配置（name → ConfigAgent.Info）
- `command` — 自定义斜杠命令（name → ConfigCommand.Info）
- `permission` — 权限覆盖规则
- `compaction` — 上下文压缩参数
- `experimental` — 实验特性开关

## 配置加载实现

```ts
loadGlobal()
  → 读取 $schema 写入（空配置时自动添加）
  → 合并 config.json → opencode.json → opencode.jsonc
  → 兼容旧版 TOML config 迁移到 JSON
  → 返回 Info

loadInstanceState(ctx)
  → 读取项目配置文件
  → 解析环境变量引用（ConfigVariable.substitute）
  → 合并全局配置 + 项目配置 + 远程配置
  → 返回完整 Info

get()
  → cached 读取 InstanceState 中的配置
```

### 缓存策略

- 全局配置：`Effect.cachedInvalidateWithTTL`（无限 TTL，显式 invalidate）
- 项目配置：`InstanceState` per-directory 缓存
- `invalidate()` 清除 InstanceState 缓存

## 配置合并

```ts
function mergeConfig(target: Info, source: Info): Info {
  return mergeDeep(target, source)  // remeda deep merge
}
// instructions 字段特殊处理：数组合并去重
```

## JSONC 支持

配置文件使用 `jsonc-parser` 解析，支持注释和尾逗号。

## 配置子模块

`src/config/` 下的 24 个文件：

| 文件 | 内容 |
|------|------|
| `config.ts` | 主 schema + 加载逻辑 + Service |
| `agent.ts` | Agent 配置字段 |
| `command.ts` | 斜杠命令配置 |
| `permission.ts` | 权限配置字段 |
| `provider.ts` | Provider 配置（API key, base URL 等）|
| `mcp.ts` | MCP server 配置 |
| `formatter.ts` | 格式化工具配置 |
| `lsp.ts` | LSP 配置 |
| `server.ts` | 服务端配置 |
| `skills.ts` | Skill 目录配置 |
| `attachment.ts` | 附件处理配置 |
| `content-filter.ts` | 内容过滤规则 |
| `reference.ts` | 代码引用配置 |
| `layout.ts` | @deprecated |
| `markdown.ts` | Markdown 配置解析 |
| `parse.ts` | JSONC/Schema 解析工具 |
| `paths.ts` | 配置文件路径查找 |
| `variable.ts` | 环境变量替换 |
| `error.ts` | 配置错误类型 |
| `managed.ts` | Console 托管配置 |
| `plugin.ts` | 插件规格解析 |
| `model-id.ts` | 模型 ID 解析 |
| `entry-name.ts` | 入口名称工具 |
| `console-state.ts` | Console 状态配置 |
