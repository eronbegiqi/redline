import type { Descriptor, Placement } from "@/shared/types"

// STUB - owned by the "describe + probe" agent. See docs/SPEC.md "Describe + probe".

/** Session-stable id for an element ("e1", "e2", ...). Same element -> same id for the page's lifetime. */
export function elementId(_el: Element): string {
  throw new Error("not implemented")
}
/** Reverse lookup (weak refs). Null if unknown or garbage collected. */
export function elementById(_id: string): Element | null {
  throw new Error("not implemented")
}
/** Descriptor captured the FIRST time this element is described, then cached (so it reflects the original position). */
export function describe(_el: Element): Descriptor {
  throw new Error("not implemented")
}
/** Fresh descriptor of the element as it is right now (does not touch the describe() cache). */
export function redescribe(_el: Element): Descriptor {
  throw new Error("not implemented")
}
/** Current placement of `el` inside its parent (parent described fresh). */
export function placementOf(_el: Element): Placement {
  throw new Error("not implemented")
}
/** Unique CSS selector for `el` right now. querySelectorAll(result) must return exactly [el]. */
export function selectorFor(_el: Element): string {
  throw new Error("not implemented")
}
