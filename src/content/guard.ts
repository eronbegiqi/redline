// Lets our own DOM edits (applying, reverting) be invisible to the DevTools-edit observer.
// observe.ts registers a flusher that drains + discards pending MutationRecords.

let depth = 0
const flushers = new Set<() => void>()

export function onSuppressFlush(fn: () => void): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

/** Run `fn`; any DOM mutations it causes are discarded by the observer. */
export function suppress<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
    for (const f of flushers) f()
  }
}

export const isSuppressed = () => depth > 0

// The `style` attribute as it was before the first still-live edit of an element. Reverts may run in any order, so the
// attribute can only be put back exactly by the revert that empties the element's inline style, and that one needs the
// ORIGINAL text, not the text before its own edit.
const firstAttr = new WeakMap<Element, string | null>()

/** Call BEFORE an edit writes inline style. `current` = the attribute right now (a DevTools observer passes the record's old value). */
export function styleAttrBefore(el: Element, current: string | null = el.getAttribute("style")): string | null {
  if (!firstAttr.has(el)) firstAttr.set(el, current)
  return firstAttr.get(el)!
}

/**
 * After a revert has put the declarations back, make the `style` attribute itself match the original too.
 * `original` is the attribute's text before our edit (null = there was none). Call inside suppress().
 * - none before and nothing left: drop the attribute. Chrome syncs CSSOM edits (style.removeProperty) to the attribute
 *   lazily, so a plain removeAttribute can be undone a moment later (style="" reappears): reading it first forces the sync.
 * - there was one and the declarations are the same again: put the author's own text back (the CSSOM would re-serialise it).
 */
export function settleStyleAttr(el: Element, original: string | null): void {
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined
  if (!style) return
  if (!style.length) firstAttr.delete(el) // nothing of ours left on it: the next edit starts afresh
  if (original === null) {
    if (style.length) return
    el.getAttribute("style")
    el.removeAttribute("style")
    return
  }
  if (el.getAttribute("style") === original) return
  const scratch = el.ownerDocument.createElement("div").style
  scratch.cssText = original
  if (scratch.cssText === style.cssText) el.setAttribute("style", original)
}
