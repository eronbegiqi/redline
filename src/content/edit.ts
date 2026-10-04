import type { Recorder } from "@/shared/recorder"
import type { StyleProp } from "@/shared/types"

// STUB - owned by the "edit + observe" agent. Panel/in-page driven edits. Every function applies the
// DOM change inside guard.suppress(), builds NewChange(s) with revert closures, and calls rec.record().
// See docs/SPEC.md "Edit ops".

/** Computed values for every STYLE_PROPS entry. */
export function readStyles(_el: Element): Record<StyleProp, string> {
  throw new Error("not implemented")
}
/** value "" removes the inline property. `before` = inline value if set, else computed value. */
export function setStyle(_rec: Recorder, _el: Element, _prop: string, _value: string): void {
  throw new Error("not implemented")
}
/** Replace the text of a text-leaf element (textContent). */
export function setText(_rec: Recorder, _el: Element, _text: string): void {
  throw new Error("not implemented")
}
/** Record a text edit whose DOM change has ALREADY happened (in-page contenteditable). Revert restores `before`. */
export function recordText(_rec: Recorder, _el: Element, _before: string, _after: string): void {
  throw new Error("not implemented")
}
/** Remove the element (kind "delete"); revert re-inserts it at its old position. */
export function removeEl(_rec: Recorder, _el: Element): void {
  throw new Error("not implemented")
}
/** display:none as a style change. */
export function hideEl(_rec: Recorder, _el: Element): void {
  throw new Error("not implemented")
}
/** Insert a deep clone right after `el` (kind "insert" with duplicateOf). Returns the clone. */
export function duplicateEl(_rec: Recorder, _el: Element): Element {
  throw new Error("not implemented")
}
