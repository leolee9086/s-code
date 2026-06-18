import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-proxy-toggle"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const state = createMemo(() => props.api.state.session.proxy_state(props.session_id))

  const enabled = createMemo(() => state()?.decision === "enabled")

  const toggle = () => {
    // 通过 HTTP API 在服务器进程执行 toggle，状态变更经 SSE 推送回 TUI
    void props.api.client.tui.proxyToggle({ sessionID: props.session_id }).catch(() => {})
  }

  return (
    <box flexDirection="row" gap={1} onMouseUp={toggle}>
      <text
        flexShrink={0}
        style={{
          fg: enabled() ? theme().success : theme().textMuted,
        }}
      >
        {enabled() ? "●" : "○"}
      </text>
      <text fg={theme().text}>
        <b>使用系统代理</b>
      </text>
      <Show when={enabled() && state()?.proxyUrl}>
        <text fg={theme().textMuted}>{state()?.proxyUrl}</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 140,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
