/**
 * 数据库表结构兼容性校验。
 *
 * 通过 Drizzle getTableColumns / getTableName 从运行时表定义中
 * 提取期望的 schema，与 sqlite_master 中实际的 DDL 比对。
 *
 * 不依赖 migration 模块，可安全地从主线程（thread.ts）和 Worker 内共同导入。
 */

import { getTableColumns, getTableName } from "drizzle-orm"
import * as Tables from "./schema-tables"

export type SchemaCheckResult = { compatible: true } | { compatible: false; message: string }

/** 运行时收集到的期望表/列 */
function buildExpected(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const seen = new Set<string>()

  for (const val of Object.values(Tables)) {
    // sqliteTable() 返回的对象有 getTableName / getTableColumns 支持
    if (typeof val !== "object" || val === null) continue
    try {
      const name = getTableName(val as any)
      if (seen.has(name)) continue
      seen.add(name)
      const cols = getTableColumns(val as any)
      map.set(name, Object.keys(cols))
    } catch {
      // 非 Drizzle 表对象（如 re-export 的辅助变量），跳过
    }
  }

  return map
}

/** 从 CREATE TABLE DDL 中提取列名 */
export function parseColumns(ddl: string): string[] {
  const cols: string[] = []
  const re = /[`"']?(\w+)[`"']?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\s*/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(ddl)) !== null) {
    cols.push(m[1].toLowerCase())
  }
  return cols
}

/** 比对 sqlite_master 行与期望结构，返回检查结果 */
export function checkSchema(
  rows: Array<{ name: string; sql: string }>,
): SchemaCheckResult {
  // 实际表结构
  const actual = new Map<string, Set<string>>()
  for (const r of rows) {
    const cols = parseColumns(r.sql)
    if (cols.length > 0) actual.set(r.name.toLowerCase(), new Set(cols))
  }

  // 期望表结构（来自 Drizzle 表定义）
  const expected = buildExpected()

  const fatal: string[] = []
  const warnings: string[] = []

  for (const [tableName, expectedCols] of expected) {
    const actualCols = actual.get(tableName)
    if (!actualCols) {
      fatal.push(`missing table: ${tableName}`)
      continue
    }
    for (const col of expectedCols) {
      if (!actualCols.has(col)) {
        fatal.push(`table ${tableName}: missing column \`${col}\``)
      }
    }
    // 多余的列（代码不认但数据库有的）无害，仅警告
    for (const col of actualCols) {
      if (!expectedCols.includes(col)) {
        warnings.push(`table ${tableName}: unexpected column \`${col}\``)
      }
    }
  }

  if (fatal.length > 0) {
    return { compatible: false, message: `Schema mismatch:\n  ${fatal.join("\n  ")}` }
  }
  return { compatible: true }
}
