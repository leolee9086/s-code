import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo } from "solid-js"

const id = "internal:sidebar-banned-phrases"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const phrases = createMemo(() => props.api.state.session.banned_phrases(props.session_id))

  const label = (grace: number, maxGrace: number) => {
    if (grace === maxGrace) return ""
    return ` (${grace}/${maxGrace})`
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>禁止词</b>
      </text>
      {phrases().length === 0 ? (
        <text fg={theme().textMuted}>无</text>
      ) : (
        phrases().map(({ phrase, grace, maxGrace }) => (
          <text fg={grace > 0 ? theme().warning : theme().error}>
            {phrase}{label(grace, maxGrace)}
          </text>
        ))
      )}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
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
