# 权限系统

## 权限模型

```
工具调用 → ctx.ask({ permission, patterns, always, metadata })
  → Permission.Service.ask()
    → evaluate(permission, pattern, ruleset, approved)
      → 按 ruleset 顺序查找匹配的 rule
        → "allow" → 通过
        → "deny" → 抛 DeniedError
        → 未匹配 → "ask"（等待用户确认）
```

### Rule

```ts
type Rule = {
  permission: string    // 工具名或分类（edit, read, shell, external_directory...）
  pattern: string       // glob 匹配（文件路径或 agent 名）
  action: "allow" | "deny" | "ask"
}
```

### 评估流程

1. 遍历 `ruleset`（agent 权限 + session 权限的合并）
2. 按 `findLast` 找匹配项（后注册的优先级高）
3. 匹配规则：`Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)`
4. 未匹配任何规则 → 默认 `"ask"`
5. `"allow"` → 静默通过
6. `"deny"` → 工具执行被拦截
7. `"ask"` → 发布 `Permission.Asked` 事件，等待用户回复

### 权限来源

```ts
// Agent 权限（agent.ts）
const defaults = { "*": "allow", external_directory: { "*": "ask" }, doom_loop: "ask", ... }
const user = Permission.fromConfig(cfg.permission ?? {})
agents[name].permission = Permission.merge(defaults, user)

// Session 权限（运行时动态合并）
ruleset = Permission.merge(agent.permission, session.permission ?? [])
```

### "always" 模式

用户选择 "always allow" → 将 pattern 加入 `approved` 列表 → 后续匹配 `approved` 优先通过。

## 工具禁用

```ts
// permission/index.ts:disabled()
// 检查 ruleset 中是否有 deny all 版的 edit/write/apply_patch
// 返回应禁用的工具集合
function disabled(tools, ruleset) {
  return tools.filter(tool => {
    const permission = ["edit","write","apply_patch"].includes(tool) ? "edit" : tool
    const rule = ruleset.findLast(r => Wildcard.match(permission, r.permission))
    return rule?.pattern === "*" && rule.action === "deny"
  })
}
```

## Agent 权限示例

```ts
// build agent（默认）：大多数工具 allow，read *.env ask，external_directory ask
// plan agent：edit/* deny，read 正常，external_directory plans/ allow
// explore agent（已移除）：仅 grep/glob/list/bash/webfetch/websearch/read allow，其余 deny
```
