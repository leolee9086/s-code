import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Database } from "bun:sqlite"
import path from "path"
import os from "os"
import { readdirSync } from "fs"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "session.id 或 message.id。查 session 时返回该 session 的所有消息；查 message 时返回单条消息。",
  }),
  channel: Schema.String.annotate({ description: "latest / dev / local，不传则查所有 channel" })
    .pipe(Schema.optional),
})

function resolveDataDir(): string {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(xdgData, "opencode")
}

function openDb(file: string): Database {
  return new Database(file, { readonly: true })
}

type DbChannels = Array<{ channel: string; file: string }>

function dbChannels(base: string, only?: string): DbChannels {
  const all: DbChannels = []
  try {
    const glob = new Bun.Glob("opencode*.db")
    const dir = readdirSync(base)
    for (const f of dir) {
      if (!glob.match(f) || f.endsWith("-shm") || f.endsWith("-wal")) continue
      const channel = f.replace(/^opencode-?/, "").replace(/\.db$/, "") || "latest"
      all.push({ channel, file: path.join(base, f) })
    }
  } catch {}
  if (only) return all.filter(c => c.channel === only)
  return all.sort((a, b) => a.channel.localeCompare(b.channel))
}

function formatSession(row: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push(`session: ${row.id}`)
  lines.push(`  title: ${row.title ?? ""}`)
  lines.push(`  agent: ${row.agent ?? ""}`)
  lines.push(`  model: ${typeof row.model === "object" ? JSON.stringify(row.model) : row.model ?? ""}`)
  lines.push(`  directory: ${row.directory ?? ""}`)
  lines.push(`  created: ${row.time_created ? new Date(Number(row.time_created)).toISOString() : ""}`)
  lines.push(`  cost: ${row.cost ?? 0}`)
  lines.push(`  tokens: ${row.tokens_input ?? 0} in / ${row.tokens_output ?? 0} out`)
  if (row.slug) lines.push(`  slug: ${row.slug}`)
  if (row.time_archived) lines.push(`  archived: ${new Date(Number(row.time_archived)).toISOString()}`)
  return lines.join("\n")
}

export const SessionMessageReadTool = Tool.define(
  "session_message_read",
  Effect.gen(function* () {
    return {
      description: "按 session.id 或 message.id 读取完整内容，无长度截断。返回 JSON 格式的完整消息数据。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const base = resolveDataDir()
          const dbs = dbChannels(base, params.channel)
          if (dbs.length === 0) return { output: "没有找到可用的数据库", title: "session-message-read", metadata: {} }

          const id = params.id
          const outputLines: string[] = []

          for (const { channel, file } of dbs) {
            if (!Bun.file(file).exists()) continue
            const db = openDb(file)
            try {
              // 先判断 id 是 session 还是 message
              const sessionRow = db.query("SELECT * FROM session WHERE id = ?").get(id) as Record<string, unknown> | undefined

              if (sessionRow) {
                outputLines.push(`=== ${channel} ===`)
                outputLines.push(formatSession(sessionRow))
                outputLines.push("")

                const msgRows = db.query(
                  "SELECT id, role, data, time_created FROM message WHERE session_id = ? ORDER BY time_created"
                ).all(id) as Record<string, unknown>[]

                if (msgRows.length === 0) {
                  outputLines.push("  (无消息)")
                } else {
                  outputLines.push(`  messages (${msgRows.length}):`)
                  for (const m of msgRows) {
                    const data = m.data ? (typeof m.data === "string" ? m.data : JSON.stringify(m.data)) : "{}"
                    const role = m.role ?? "?"
                    const msgId = String(m.id ?? "")
                    outputLines.push(`    [${msgId.slice(0, 8)}] ${role}: ${data}`)
                  }
                }
                continue
              }

              // message.id
              const msgRow = db.query(
                "SELECT m.*, s.title as session_title, s.agent as session_agent FROM message m LEFT JOIN session s ON m.session_id = s.id WHERE m.id = ?"
              ).get(id) as Record<string, unknown> | undefined

              if (msgRow) {
                outputLines.push(`=== ${channel} ===`)
                outputLines.push(`message: ${msgRow.id}`)
                outputLines.push(`  session: ${msgRow.session_id} (${msgRow.session_title ?? ""})`)
                outputLines.push(`  role: ${msgRow.role ?? ""}`)
                outputLines.push(`  time: ${msgRow.time_created ? new Date(Number(msgRow.time_created)).toISOString() : ""}`)
                outputLines.push(`  data:`)
                const data = msgRow.data ? (typeof msgRow.data === "string" ? msgRow.data : JSON.stringify(msgRow.data, null, 2)) : ""
                outputLines.push(data)
                continue
              }

            } finally {
              db.close()
            }
          }

          if (outputLines.length === 0) {
            return { output: `未找到 id=${id} 的 session 或 message`, title: "session-message-read", metadata: {} }
          }

          return {
            output: outputLines.join("\n"),
            title: `session-message-read (${id.slice(0, 12)}...)`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
