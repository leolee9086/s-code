import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "202606131435_ensure_session_message_seq",
  up(tx) {
    return Effect.gen(function* () {
      // Check if `seq` column exists on session_message table.
      // Migration 20260603040000 attempted to add it, but some databases
      // may have the migration marked completed without the column.
      const columns = yield* tx.all<{
        name: string
      }>(`SELECT name FROM pragma_table_info('session_message') WHERE name = 'seq'`)
      if (columns.length > 0) return
      // Must use DEFAULT since SQLite requires it for NOT NULL ADD COLUMN on non-empty tables.
      // The seq values will be backfilled by the application on next projection write.
      yield* tx.run(`ALTER TABLE \`session_message\` ADD COLUMN \`seq\` integer NOT NULL DEFAULT 0;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_time_created_id_idx\`;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
