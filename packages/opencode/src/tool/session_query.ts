import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Database } from "bun:sqlite"
import path from "path"
import os from "os"

const SCHEMA_HINT = `可用表:
- session: id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url, summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
- message: id, session_id, role, data, time_created (从 session_schema 继承)
- part: id, message_id, session_id, type, data, time_created (从 session_schema 继承)`

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: `只读 SQL 查询，仅允许 SELECT / PRAGMA / EXPLAIN。${SCHEMA_HINT}`,
  }),
  channel: Schema.String.annotate({ description: "目标数据库 channel：latest(全局版)、dev(源码模式)、local(自构建)" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("dev"))),
})

function resolveDataDir(): string {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(xdgData, "opencode")
}

function validateReadOnly(sql: string): void {
  const trimmed = sql.trimStart()
  const keyword = trimmed.split(/\s/)[0]?.toUpperCase()
  if (!keyword) throw new Error("空查询")
  if (!["SELECT", "PRAGMA", "EXPLAIN", "WITH"].includes(keyword)) {
    throw new Error(`不允许 ${keyword} 操作，仅支持 SELECT / PRAGMA / EXPLAIN / WITH`)
  }
}

export const SessionQueryTool = Tool.define(
  "session_query",
  Effect.gen(function* () {
    return {
      description: `对 opencode session 数据库执行只读 SQL 查询。${SCHEMA_HINT}`,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          validateReadOnly(params.query)

          const base = resolveDataDir()
          const channel = params.channel
          const file = channel === "latest"
            ? path.join(base, "opencode.db")
            : path.join(base, `opencode-${channel}.db`)

          const exists = yield* Effect.promise(() => Bun.file(file).exists())
          if (!exists) {
            return { output: `数据库不存在: ${file}`, title: "session-query", metadata: {} }
          }

          const result = yield* Effect.try({
            try: () => {
              const db = new Database(file, { readonly: true })
              try {
                const rows = db.query(params.query).all() as Record<string, unknown>[]
                if (rows.length === 0) return "查询完成，无结果"
                const header = Object.keys(rows[0]).join(" | ")
                const separator = Object.keys(rows[0]).map(() => "---").join(" | ")
                const body = rows.map(r => Object.values(r).map(v => {
                  if (v === null || v === undefined) return ""
                  const s = typeof v === "object" ? JSON.stringify(v) : String(v)
                  return s.length > 120 ? s.slice(0, 117) + "..." : s
                }).join(" | "))
                return `行数: ${rows.length}\n\n| ${header} |\n| ${separator} |\n| ${body.join(" |\n| ")} |`
              } finally {
                db.close()
              }
            },
            catch: (e: any) => `查询错误: ${e.message}`,
          })

          return {
            output: result,
            title: `session-query (${channel})`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
