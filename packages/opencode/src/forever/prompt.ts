// 动态 Prompt 解析器
//
// 支持从以下源动态获取永续模式的续行提示词：
// - inline: 配置中静态文本
// - file: 本地文件读取
// - http: 通过 HTTP GET 获取
import { Effect } from "effect"
import { existsSync, readFileSync } from "fs"

export type PromptSource = {
  type: string
  command?: string
  args?: string[]
  url?: string
  text?: string
}

/**
 * 解析永续模式的 prompt 源文本，支持 inline/file/http/script 四种类型
 */
export const resolveForeverPrompt = (
  source: PromptSource | undefined,
  defaultText: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    if (!source) return defaultText

    switch (source.type) {
      case "inline":
        return (source.text && source.text.length > 0) ? source.text : defaultText

      case "file": {
        const fp = source.command
        if (!fp) return defaultText
        try {
          if (existsSync(fp)) return readFileSync(fp, "utf-8") || defaultText
        } catch {}
        return defaultText
      }

      case "http": {
        const httpUrl = source.url
        if (!httpUrl) return defaultText
        const text = yield* Effect.tryPromise(() => fetch(httpUrl).then((r) => (r.ok ? r.text() : ""))).pipe(
          Effect.catch(() => Effect.succeed("")),
        )
        return text || defaultText
      }

      default:
        return defaultText
    }
  })

export * as ForeverPrompt from "./prompt"
