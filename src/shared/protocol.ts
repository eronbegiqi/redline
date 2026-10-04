import type { Mode, PanelState } from "./types"

// Transport: the content script creates a MessageChannel, posts port2 to the panel iframe
// (targetOrigin = the extension origin, see content/frame.ts), then both sides talk over the
// ports with these plain-object messages. Never use window.postMessage for anything else.

/** content -> panel */
export type ToPanel = { type: "state"; state: PanelState }

/** panel -> content */
export type ToContent =
  /** Panel mounted; content replies with a "state" message. */
  | { type: "ready" }
  | { type: "setMode"; mode: Mode }
  | { type: "setRecording"; on: boolean }
  /** value "" removes the inline property. Applies to the current selection. */
  | { type: "setStyle"; prop: string; value: string }
  /** Replaces text of a text-leaf selection. */
  | { type: "setText"; text: string }
  | { type: "action"; action: "delete" | "hide" | "duplicate" | "parent" | "child" | "deselect" }
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
