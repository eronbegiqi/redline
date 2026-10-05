import { describe, elementId, placementOf } from "@/content/describe"
import { settleStyleAttr, suppress } from "@/content/guard"
import type { Recorder } from "@/shared/recorder"
import { STYLE_PROPS, type StyleProp } from "@/shared/types"

// Panel/in-page driven edits. Every DOM write goes through guard.suppress() so the DevTools observer never
// sees it; every function swallows errors because it runs inside someone else's page.
// describe() is first-touch: always call it BEFORE the DOM write so the descriptor shows the original state.

const norm = (s: string | null) => s?.trim().toLowerCase()
const isRoot = (el: Element) => el === el.ownerDocument.documentElement

/** Computed values for every STYLE_PROPS entry. */
export function readStyles(el: Element): Record<StyleProp, string> {
  let cs: CSSStyleDeclaration | null = null
  try {
    cs = getComputedStyle(el)
  } catch {
    // detached / foreign element: fall through to empty strings
  }
  return Object.fromEntries(
    STYLE_PROPS.map((p) => [p, cs?.getPropertyValue(p) ?? ""])
  ) as Record<StyleProp, string>
}

/** value "" removes the inline property. `before` = inline value if set, else computed value. */
export function setStyle(
  rec: Recorder,
  el: Element,
  prop: string,
  value: string
): void {
  try {
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    const v = value.replace(/\s*!important\s*$/i, "").trim()
    const prevValue = style.getPropertyValue(prop)
    const prevPriority = style.getPropertyPriority(prop)
    const hadInline = prevValue !== ""
    const prevAttr = el.getAttribute("style")
    if (v === "" && !hadInline) return // nothing to remove
    if (v !== "") {
      // The browser silently drops invalid values; don't log a change that never happened.
      const probe = el.ownerDocument.createElement("div").style
      probe.setProperty(prop, v)
      if (probe.getPropertyValue(prop) === "") return
    }
    const before = hadInline
      ? prevValue
      : getComputedStyle(el).getPropertyValue(prop).trim() || null
    const after = v === "" ? null : v
    if (after !== null && norm(before) === norm(after)) return
    const target = describe(el)
    // "important" so the preview beats stylesheet rules; the log keeps the plain value.
    suppress(() =>
      after === null
        ? style.removeProperty(prop)
        : style.setProperty(prop, v, "important")
    )
    rec.record({
      kind: "style",
      el: elementId(el),
      target,
      prop,
      before,
      after,
      origin: "panel",
      revert: () =>
        suppress(() => {
          if (hadInline) style.setProperty(prop, prevValue, prevPriority)
          else style.removeProperty(prop)
          settleStyleAttr(el, prevAttr) // no stray style="" / re-serialised text left behind
        }),
    })
  } catch {
    // never throw into the page
  }
}

/** Replace the text of a text-leaf element (textContent). */
export function setText(rec: Recorder, el: Element, text: string): void {
  try {
    const before = el.textContent ?? ""
    if (before === text) return
    const target = describe(el)
    // Keep the original nodes (not clones) so page/framework references to them survive a revert.
    const saved = Array.from(el.childNodes)
    suppress(() => {
      el.textContent = text
    })
    rec.record({
      kind: "text",
      el: elementId(el),
      target,
      textNode: 0,
      before,
      after: text,
      origin: "panel",
      revert: () => suppress(() => el.replaceChildren(...saved)),
    })
  } catch {
    // never throw into the page
  }
}

/** Record a text edit whose DOM change has ALREADY happened (in-page contenteditable). Revert restores `before`. */
export function recordText(
  rec: Recorder,
  el: Element,
  before: string,
  after: string
): void {
  try {
    if (before === after) return
    rec.record({
      kind: "text",
      el: elementId(el),
      target: describe(el),
      textNode: 0,
      before,
      after,
      origin: "panel",
      revert: () =>
        suppress(() => {
          el.textContent = before
        }),
    })
  } catch {
    // never throw into the page
  }
}

/** Remove the element (kind "delete"); revert re-inserts it at its old position. */
export function removeEl(rec: Recorder, el: Element): void {
  try {
    const parent = el.parentNode
    if (!parent || isRoot(el)) return
    const next = el.nextSibling
    const target = describe(el) // needs the element in the document to build a selector
    suppress(() => parent.removeChild(el))
    rec.record({
      kind: "delete",
      el: elementId(el),
      target,
      origin: "panel",
      revert: () =>
        suppress(() =>
          parent.insertBefore(el, next?.parentNode === parent ? next : null)
        ),
    })
  } catch {
    // never throw into the page
  }
}

/** display:none as a style change. */
export function hideEl(rec: Recorder, el: Element): void {
  if (!isRoot(el)) setStyle(rec, el, "display", "none")
}

/** Insert a deep clone right after `el` (kind "insert" with duplicateOf). Returns the clone (or `el` when nothing was done). */
export function duplicateEl(rec: Recorder, el: Element): Element {
  try {
    const parent = el.parentNode
    if (!parent || isRoot(el)) return el
    const duplicateOf = describe(el)
    const clone = el.cloneNode(true) as Element
    // Duplicate ids are invalid, and a descendant id would shadow the original's for getElementById.
    for (const n of [clone, ...clone.querySelectorAll("[id]")])
      n.removeAttribute("id")
    suppress(() => parent.insertBefore(clone, el.nextSibling))
    rec.record({
      kind: "insert",
      el: elementId(clone),
      target: describe(clone),
      placement: placementOf(clone),
      html: clone.outerHTML.slice(0, 2000),
      duplicateOf,
      origin: "panel",
      revert: () => suppress(() => clone.remove()),
    })
    return clone
  } catch {
    return el
  }
}
