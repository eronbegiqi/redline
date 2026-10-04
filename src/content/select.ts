import type { Recorder } from "@/shared/recorder"
import type { Mode } from "@/shared/types"

// STUB - owned by the "select + resize + text edit" agent. See docs/SPEC.md "Selection layer".
export interface SelectorOptions {
  /** Shadow root of our host; draw all overlay UI here. */
  root: ShadowRoot
  /** True if the event target / node belongs to our own UI (host or its shadow tree). */
  isOurs: (n: EventTarget | Node | null) => boolean
  rec: Recorder
  /** Called when the user selects an element (or null on deselect). */
  onSelect: (el: Element | null) => void
  /** Called after any change the selector made to the selected element (resize, text edit) so the controller can refresh the panel. */
  onChanged: () => void
}
export interface SelectorApi {
  /** "select": hover/click selection + resize handles + dblclick text edit. "move"/"browse": selector is inert (selection box may remain visible). */
  setMode(mode: Mode): void
  /** Programmatic selection (from panel parent/child actions). null clears. */
  select(el: Element | null): void
  /** Re-measure and redraw overlays (call after style edits / scroll). */
  refresh(): void
  /** Remove listeners + overlay nodes. */
  destroy(): void
}
export function createSelector(_opts: SelectorOptions): SelectorApi {
  throw new Error("not implemented")
}
