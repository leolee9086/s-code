// 永续模式示例插件 — 回合计数器
//
// 演示 loop.continue 和 loop.inject 的典型用法：
//   - 计数回合数，达到上限后自动退出
//   - 每轮注入递增的续行提示，引导助手逐步完成任务
//
// 安装方式 (opencode.json)：
//   { "plugin_origins": ["src/forever/examples/forever-counter-plugin.ts"] }
//
// 启动方式：
//   > 永续: 完成当前 README 中的所有 TODO 项

import type { Hooks, PluginInput } from "@opencode-ai/plugin"

// 回合上限（可自定义）
const MAX_ROUNDS = 10

// 每轮的指令提示池 — 可替换为你自己的生成策略
const STEP_PROMPTS = [
  "Continue working on the forever mode task. Focus on making incremental progress.",
  "Keep going. Break down the next logical piece of work and implement it.",
  "Progress so far is good. Identify what remains and tackle the highest priority item.",
  "Review what's been done, then continue with the next task.",
  "Halfway checkpoint: verify your work so far, then proceed to the next step.",
  "Continue. If you're stuck, try a different approach or ask for clarification.",
  "You're making progress. Keep pushing forward on the remaining items.",
  "Almost there. Focus on completing the remaining work efficiently.",
  "Finish strong. Wrap up any loose ends and ensure everything works together.",
  "Final round. Complete the task and summarize what was accomplished.",
]

// 插件实例工厂 — 每个工作区调用一次
export default function foreverCounterPlugin(input: PluginInput): Hooks {
  const log = (...args: unknown[]) => {
    // opencode 的插件日志通过 client 输出
    console.log("[forever-counter]", ...args)
  }

  let roundCounter = 0

  return {
    /**
     * loop.continue — 决定是否继续下一轮
     *
     * 返回 shouldContinue: false 时退出永续模式循环。
     * 可用于：
     *   - 回合/预算上限
     *   - 检测到任务完成
     *   - 外部条件不满足
     */
    "loop.continue": async (_input, output) => {
      roundCounter++

      if (roundCounter > MAX_ROUNDS) {
        log(`round #${roundCounter} — max rounds reached, stopping forever mode`)
        output.shouldContinue = false
        output.reason = `Reached max rounds (${MAX_ROUNDS})`
        return
      }

      // 也可以根据 lastFinish 判断：
      // - "stop" → 助手认为完成了，可退出
      // - "tool-calls" → 继续（工具调用结果待返回）
      // - undefined → 继续（流式响应中）
      if (_input.lastFinish === "stop" && _input.round > 3) {
        log(`round #${roundCounter} — assistant signalled stop, exiting`)
        output.shouldContinue = false
        output.reason = "Assistant signalled completion"
        return
      }

      log(`round #${roundCounter} — continuing`)
      output.shouldContinue = true
      output.reason = `Continuing round ${roundCounter}/${MAX_ROUNDS}`
    },

    /**
     * loop.inject — 注入合成用户消息作为下一轮的输入
     *
     * 返回 parts 数组，每个 part 是一条用户消息的文本片段。
     * 空数组 → 不注入（循环不会创建新用户消息）。
     *
     * 可用于：
     *   - 每轮提供不同的指令
     *   - 根据 assistant 输出动态调整下一步提示
     *   - 注入外部数据或状态
     */
    "loop.inject": async (input, output) => {
      const stepIndex = Math.min(input.round, STEP_PROMPTS.length - 1)
      const prompt = STEP_PROMPTS[stepIndex]

      log(`injecting prompt for round #${input.round + 1}: "${prompt.slice(0, 60)}..."`)

      output.parts = [
        {
          type: "text",
          text: prompt,
          synthetic: true,
        },
      ]
    },
  }
}
