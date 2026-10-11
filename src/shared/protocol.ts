import type { Mode, PanelState, Tool } from "./types"

// Transport: the content script creates a MessageChannel, posts port2 to the panel iframe
// (targetOrigin = the extension origin, see content/frame.ts), then both sides talk over the
// ports with these plain-object messages. Never use window.postMessage for anything else.

/** A numbered pin to draw on the page. `el` is preferred when known; `selector` finds the element after a reload. */
export interface Marker {
  n: number
  el?: string
  selector: string
}

/** content -> panel */
export type ToPanel = { type: "state"; state: PanelState }

/** panel -> content */
export type ToContent =
  /** Panel mounted; content replies with a "state" message. */
  | { type: "ready" }
  | { type: "setMode"; mode: Mode }
  | { type: "setTool"; tool: Tool }
  | { type: "setRecording"; on: boolean }
  // The three edit messages below carry the id (ElementInfo.el) of the element the edit was made for:
  // a debounced or blur-committed edit can arrive after the selection moved on. Content applies it to THAT
  // element (ignored when unknown or detached); only the selection-changing actions look at the current selection.
  /** value "" removes the inline property. */
  | { type: "setStyle"; el: string; prop: string; value: string }
  /** Replaces text of a text-leaf element. */
  | { type: "setText"; el: string; text: string }
  | {
      type: "action"
      el: string
      action: "delete" | "hide" | "duplicate" | "parent" | "child" | "deselect"
    }
  /** Select an element (by id, else by CSS selector) and scroll it into view. */
  | { type: "select"; el?: string; selector?: string }
  /** Replace the pins drawn for commented elements. */
  | { type: "markers"; items: Marker[] }
  /** Revert (DOM + log) the last entry. */
  | { type: "undo" }
  /** Revert (DOM + log) one entry by Change.id. */
  | { type: "revert"; id: string }
  /** Revert everything and clear the log. */
  | { type: "revertAll" }
  /** Move the floating frame by a screen-space delta (panel header drag). */
  | { type: "moveFrame"; dx: number; dy: number }
  /** Hide the panel + pause editing (edits stay applied on the page, log is kept). */
  | { type: "close" }
