/**
 * 收集所有 Drizzle 表定义，供运行时 schema 校验使用。
 *
 * 每次新增 Drizzle 表时只需在此文件加一行 re-export，
 * 即可自动参与启动时的表结构兼容性检测。
 */

export { SessionTable, MessageTable, PartTable, TodoTable, SessionMessageTable } from "../session/sql"
export { ProjectTable } from "../project/sql"
export { PermissionTable } from "../permission/sql"
export { SessionShareTable } from "../share/sql"
export { EventSequenceTable, EventTable } from "../event/sql"
export { DataMigrationTable } from "../data-migration.sql"
export { WorkspaceTable } from "../control-plane/workspace.sql"
export { AccountTable, AccountStateTable, ControlAccountTable } from "../account/sql"
