import type { ToContent } from "@/shared/protocol"
import type { PanelState } from "@/shared/types"

/** Props every tab/section component receives. */
export interface TabProps {
  state: PanelState
  send: (m: ToContent) => void
}
