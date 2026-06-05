declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

/** 运行时数据库渠道 —— 调用时实时求值，反映 --channel CLI 选项的生效值。 */
export function getDatabaseChannel(): string {
  return process.env.OPENCODE_CHANNEL ?? InstallationChannel
}
