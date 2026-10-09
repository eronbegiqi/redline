import {
  describe,
  elementId,
  placementOf,
  redescribe,
} from "@/content/describe"
import {
  onSuppressFlush,
  settleStyleAttr,
  styleAttrBefore,
  suppress,
} from "@/content/guard"
import type { Recorder } from "@/shared/recorder"
import type { ChangeBody, Descriptor, Placement } from "@/shared/types"

// Turns DOM mutations that did not come from us (DevTools, mostly) into NewChanges. Records are delivered
// in batches AFTER the DOM already reached its final state, so every "before/after" is rebuilt from
// MutationRecord.oldValue and sibling pointers instead of reading the live DOM.

let observer: MutationObserver | null = null
let offFlush: (() => void) | null = null

/** Start capturing DevTools-origin DOM edits into `rec` (origin: "devtools"). `ignore(node)` true => skip (our own UI). */
export function startObserving(
  rec: Recorder,
  ignore: (n: Node) => boolean
): void {
  const root = document.documentElement
  if (observer || !root) return
  const skip = (n: Node) => ignore(n) || inOurEditor(n)
  const mo = new MutationObserver((records) => {
    try {
      handleBatch({ rec, ignore: skip, ...analyse(records, skip) }, records)
    } catch {
      // never throw into the page
    }
  })
  mo.observe(root, {
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
    childList: true,
    subtree: true,
  })
  observer = mo
  // Our own edits are drained here, before the observer ever gets to deliver them.
  offFlush = onSuppressFlush(() => void mo.takeRecords())
}

export function stopObserving(): void {
  origins = new WeakMap()
  observer?.disconnect()
  offFlush?.()
  observer = offFlush = null
}

// ---------------------------------------------------------------------------------------------------------

/** First/last thing that happened to an element within one batch, and the record that started it. */
interface Net {
  first: "add" | "remove"
  last: "add" | "remove"
  at: MutationRecord
}

interface Ctx {
  rec: Recorder
  ignore: (n: Node) => boolean
  /** Value an attribute / text node had AFTER each attributes+characterData record. */
  after: Map<MutationRecord, string | null>
  nets: Map<Node, Net>
  /** Elements that did not exist at batch start and are still in the document. */
  inserted: Element[]
  /** What each touched element looked like at batch start (first record per attribute / text node wins). */
  was: Map<Element, Was>
  /** The batch, in order: the nested-delete revert replays the childList records before the one that removed the ancestor. */
  records: MutationRecord[]
}

interface Was {
  attrs: Map<string, string | null>
  /** Own text before the batch (see describe.ts ownText), when a text node of the element changed. */
  text?: string
}

const SKIPPED_ATTRS = new Set(["contenteditable", "spellcheck"]) // toggled by our own in-page text editor

/** Precompute what a one-pass walk over the records can't know: "value after" and each element's net fate. */
function analyse(records: MutationRecord[], ignore: (n: Node) => boolean) {
  // oldValue is the value BEFORE a record, so the value AFTER it is the next record's oldValue on the
  // same node+attribute, or the live value when it was the last one.
  const after = new Map<MutationRecord, string | null>()
  const later = new Map<Node, Map<string, string | null>>()
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.type === "childList") continue
    const key =
      r.type === "attributes"
        ? `${r.attributeNamespace}|${r.attributeName}`
        : "#data"
    let m = later.get(r.target)
    if (!m) later.set(r.target, (m = new Map()))
    const live =
      r.type === "attributes"
        ? (r.target as Element).getAttribute(r.attributeName!)
        : (r.target as CharacterData).data
    after.set(r, m.has(key) ? (m.get(key) as string | null) : live)
    m.set(key, r.oldValue)
  }

  const nets = new Map<Node, Net>()
  const note = (n: Node, kind: Net["first"], at: MutationRecord) => {
    if (n.nodeType !== 1 || ignore(n)) return
    const e = nets.get(n)
    if (e) e.last = kind
    else nets.set(n, { first: kind, last: kind, at })
  }
  for (const r of records) {
    if (r.type !== "childList" || ignore(r.target)) continue
    r.removedNodes.forEach((n) => note(n, "remove", r))
    r.addedNodes.forEach((n) => note(n, "add", r))
  }
  const inserted = [...nets]
    .filter(([n, e]) => e.first === "add" && e.last === "add" && n.isConnected)
    .map(([n]) => n as Element)
  return { after, nets, inserted, was: wasOf(records, ignore), records }
}

/** Per touched element: its attribute values and own text as they were before this batch. */
function wasOf(records: MutationRecord[], ignore: (n: Node) => boolean) {
  const was = new Map<Element, Was>()
  const at = (el: Element) => {
    let w = was.get(el)
    if (!w) was.set(el, (w = { attrs: new Map() }))
    return w
  }
  const data = new Map<CharacterData, string>() // first oldValue per text node
  const gone = new Map<Element, Text[]>()
  const came = new Map<Element, Set<Node>>()
  for (const r of records) {
    if (ignore(r.target)) continue
    if (r.type === "attributes") {
      const n = r.attributeName
      if (!n || r.attributeNamespace || n.startsWith("data-redline")) continue
      const w = at(r.target as Element)
      if (!w.attrs.has(n)) w.attrs.set(n, r.oldValue)
    } else if (r.type === "characterData") {
      if (!data.has(r.target as CharacterData))
        data.set(r.target as CharacterData, r.oldValue ?? "")
    } else if (r.target.nodeType === 1) {
      const p = r.target as Element
      for (const n of r.removedNodes) {
        if (n.nodeType === 3) gone.set(p, [...(gone.get(p) ?? []), n as Text])
      }
      for (const n of r.addedNodes) {
        if (n.nodeType === 3) came.set(p, (came.get(p) ?? new Set()).add(n))
      }
    }
  }
  const parents = new Set<Element>([...gone.keys(), ...came.keys()])
  for (const n of data.keys()) if (n.parentElement) parents.add(n.parentElement)
  for (const p of parents) {
    const parts: string[] = []
    for (const n of p.childNodes) {
      if (n.nodeType !== 3 || came.get(p)?.has(n)) continue
      parts.push(data.has(n as Text) ? data.get(n as Text)! : (n as Text).data)
    }
    for (const n of gone.get(p) ?? []) parts.push(data.get(n) ?? n.data)
    at(p).text = ownText(parts)
  }
  return was
}

/** Same normalisation as describe.ts ownText(): joined with a space, collapsed, trimmed, 80 chars, no split surrogate. */
const ownText = (parts: string[]) =>
  parts
    .map((s) => s + " ")
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[\uD800-\uDBFF]$/, "")

// Attributes describe() copies into Descriptor.attrs (mirror of its whitelist) and the ones its selector may be built from.
const DESCRIBED_ATTRS = new Set([
  "data-testid",
  "aria-label",
  "role",
  "name",
  "type",
  "href",
  "src",
  "alt",
  "placeholder",
  "title",
])
const SELECTOR_ATTRS = ["id", "data-testid", "data-test", "data-cy"]

/**
 * The element's descriptor as it was BEFORE the edits we have seen. describe() is first-touch and the observer sees an
 * element only after DevTools changed it, so text, attributes, classes and the id-based selector are rebuilt from the
 * records' oldValue, on a copy that lives here (the shared describe() cache is not touched).
 */
interface Original {
  d: Descriptor
  text: boolean
  classes: boolean
  attrs: Set<string>
}
let origins = new WeakMap<Element, Original>()

function originalOf(c: Ctx, el: Element): Descriptor {
  const w = c.was.get(el)
  let o = origins.get(el)
  if (!o) {
    const d = freshDescriptor(el, w)
    o = {
      d: {
        ...d,
        classes: [...d.classes],
        ...(d.attrs ? { attrs: { ...d.attrs } } : {}),
      },
      text: false,
      classes: false,
      attrs: new Set(),
    }
    origins.set(el, o)
  }
  for (const [name, old] of w?.attrs ?? []) {
    if (name === "class") {
      if (!o.classes) o.d.classes = tokens(old).slice(0, 8)
      o.classes = true
    } else if (!o.attrs.has(name)) {
      o.attrs.add(name)
      const attrs = { ...o.d.attrs }
      if (old !== null && DESCRIBED_ATTRS.has(name))
        attrs[name] = old.slice(0, 120)
      else delete attrs[name]
      if (Object.keys(attrs).length) o.d.attrs = attrs
      else delete o.d.attrs
    }
  }
  if (w?.text !== undefined && !o.text) {
    o.text = true
    if (w.text) o.d.text = w.text
    else delete o.d.text
  }
  return o.d
}

/** describe(el) with the id-like attributes put back to their old values for the duration of the call (the selector uses them). */
function freshDescriptor(el: Element, w?: Was): Descriptor {
  const changed = SELECTOR_ATTRS.filter((n) => w?.attrs.has(n))
  if (!changed.length) return describe(el)
  const live = changed.map((n) => el.getAttribute(n))
  const put = (values: (string | null)[]) =>
    suppress(() =>
      changed.forEach((n, i) => {
        const v = values[i]
        if (v === null) el.removeAttribute(n)
        else el.setAttribute(n, v)
      })
    )
  // ponytail: page MutationObservers see this put-back/restore once, only for an edited id/data-testid on first touch.
  put(changed.map((n) => w!.attrs.get(n) ?? null))
  try {
    return describe(el)
  } finally {
    put(live)
  }
}

function handleBatch(c: Ctx, records: MutationRecord[]): void {
  for (const r of records) {
    try {
      if (r.type === "attributes") onAttribute(c, r)
      else if (r.type === "characterData") onCharacterData(c, r)
      else onChildList(c, r)
    } catch {
      // one bad record must not drop the rest of the batch
    }
  }
}

/** Live, not ours, and not inside something this batch created (that is already covered by its `insert`). */
const watched = (c: Ctx, el: Element | null): el is Element =>
  !!el &&
  el.isConnected &&
  !c.ignore(el) &&
  !c.inserted.some((root) => root.contains(el))

/** select.ts marks the element it is editing; typing there is recorded by recordText(), never by us. */
function inOurEditor(n: Node): boolean {
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement
  return !!el?.closest("[data-redline-editing]")
}

/** Any contenteditable host: page-driven typing is not a DevTools edit either. */
const editing = (el: Element) =>
  !!el.closest("[contenteditable]:not([contenteditable=false])")

function push(
  c: Ctx,
  el: Element,
  body: ChangeBody,
  revert: () => void,
  target: Descriptor = originalOf(c, el)
): void {
  try {
    c.rec.record({
      el: elementId(el),
      target,
      origin: "devtools",
      ...body,
      revert,
    })
  } catch {
    // a failing recorder must not break the page or the rest of the batch
  }
}

// --- attributes -----------------------------------------------------------------------------------------

function onAttribute(c: Ctx, r: MutationRecord): void {
  const el = r.target as Element
  const name = r.attributeName
  // Namespaced attributes (xlink:href) can't be read back by local name; not worth the machinery.
  if (
    !name ||
    r.attributeNamespace ||
    name.startsWith("data-redline") ||
    SKIPPED_ATTRS.has(name)
  )
    return
  if (!watched(c, el)) return
  const before = r.oldValue
  const after = c.after.get(r) ?? null
  if (before === after) return
  if (name === "style") return styleChanges(c, el, before, after)
  if (name === "class") return classChange(c, el, before, after)
  const set = (v: string | null) =>
    suppress(() =>
      v === null ? el.removeAttribute(name) : el.setAttribute(name, v)
    )
  push(c, el, { kind: "attr", name, before, after }, () => set(before))
}

interface Decl {
  value: string
  priority: string
}

function parseStyle(el: Element, css: string | null): Map<string, Decl> {
  const out = new Map<string, Decl>()
  if (!css) return out
  const s = el.ownerDocument.createElement("div").style
  s.cssText = css
  for (let i = 0; i < s.length; i++) {
    out.set(s[i], {
      value: s.getPropertyValue(s[i]),
      priority: s.getPropertyPriority(s[i]),
    })
  }
  return out
}

const show = (d?: Decl) =>
  d ? d.value + (d.priority ? " !important" : "") : null

function styleChanges(
  c: Ctx,
  el: Element,
  before: string | null,
  after: string | null
): void {
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined
  if (!style) return
  const a = parseStyle(el, before)
  const b = parseStyle(el, after)
  const target = originalOf(c, el)
  for (const prop of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(prop)
    const y = b.get(prop)
    if (x?.value === y?.value && x?.priority === y?.priority) continue
    const first = styleAttrBefore(el, before)
    const revert = () =>
      suppress(() => {
        if (x) style.setProperty(prop, x.value, x.priority)
        else style.removeProperty(prop)
        // Only the last revert of a multi-property edit finds the declarations equal to `before` again.
        settleStyleAttr(el, first)
      })
    push(
      c,
      el,
      { kind: "style", prop, before: show(x), after: show(y) },
      revert,
      target
    )
  }
}

const tokens = (s: string | null) => (s ?? "").split(/\s+/).filter(Boolean)

function classChange(
  c: Ctx,
  el: Element,
  before: string | null,
  after: string | null
): void {
  const was = tokens(before)
  const is = tokens(after)
  const added = is.filter((t) => !was.includes(t))
  const removed = was.filter((t) => !is.includes(t))
  if (!added.length && !removed.length) return
  // originalOf() hands out the ORIGINAL class list (a patched copy: no undo/redo on the page, so page observers stay quiet).
  const target = originalOf(c, el)
  const revert = () =>
    suppress(() => {
      el.classList.remove(...added)
      el.classList.add(...removed)
      if (before === null && !el.classList.length) el.removeAttribute("class")
    })
  push(c, el, { kind: "class", added, removed }, revert, target)
}

// --- text -----------------------------------------------------------------------------------------------

const indexIn = (parent: Node, child: Node) =>
  Array.prototype.indexOf.call(parent.childNodes, child) as number

function onCharacterData(c: Ctx, r: MutationRecord): void {
  const node = r.target as CharacterData
  const parent = node.parentElement
  if (node.nodeType !== 3 || !watched(c, parent) || editing(parent)) return
  const before = r.oldValue ?? ""
  const after = c.after.get(r) ?? ""
  if (before === after) return
  const revert = () =>
    suppress(() => {
      node.data = before
    })
  push(
    c,
    parent,
    { kind: "text", textNode: indexIn(parent, node), before, after },
    revert
  )
}

/** `el.textContent = "x"` replaces the text node instead of editing it: removed + added Text in one record. */
function onReplacedText(c: Ctx, r: MutationRecord): void {
  const parent = r.target as Element
  const gone = [...r.removedNodes].filter((n) => n.nodeType === 3) as Text[]
  const came = [...r.addedNodes].filter((n) => n.nodeType === 3) as Text[]
  if (!(gone.length || came.length) || !watched(c, parent) || editing(parent))
    return
  for (let i = 0; i < Math.max(gone.length, came.length); i++) {
    const old = gone[i]
    const now = came[i]
    const before = old?.data ?? ""
    const after = now?.data ?? ""
    // before === after is a no-op; both blank is whitespace churn (e.g. "Edit as HTML" reformatting)
    if (before === after || (!before.trim() && !after.trim())) continue
    const at = now
      ? indexIn(parent, now)
      : r.previousSibling
        ? indexIn(parent, r.previousSibling) + 1
        : 0
    const revert = () =>
      suppress(() => {
        now?.remove()
        if (old) parent.insertBefore(old, slot(r, parent))
      })
    push(
      c,
      parent,
      { kind: "text", textNode: Math.max(0, at), before, after },
      revert
    )
  }
}

// --- structure ------------------------------------------------------------------------------------------

/** Where a node removed by `r` used to sit, as a reference node for insertBefore (null = append). */
function slot(r: MutationRecord, parent: Node): Node | null {
  if (r.nextSibling?.parentNode === parent) return r.nextSibling
  if (r.previousSibling?.parentNode === parent)
    return r.previousSibling.nextSibling
  return null
}

function onChildList(c: Ctx, r: MutationRecord): void {
  if (c.ignore(r.target) || r.target.nodeType !== 1) return
  onReplacedText(c, r)
  // A node's net fate is decided once, at the record that first touched it.
  for (const n of r.removedNodes) {
    const net = c.nets.get(n)
    if (net?.at !== r) continue
    if (net.last === "remove") onDeleted(c, r, n as Element)
    else onMoved(c, r, n as Element)
  }
  for (const n of r.addedNodes) {
    const net = c.nets.get(n)
    if (net?.at === r && net.last === "add") onInserted(c, n as Element)
  }
}

function onDeleted(c: Ctx, r: MutationRecord, el: Element): void {
  const parent = r.target as Element
  // If the parent is gone too, ITS removal is what gets recorded.
  if (el.isConnected || !watched(c, parent)) return
  // describe() builds selectors from the live document, but the node is already out of it: put it back for one call.
  // ponytail: re-attaching re-runs custom-element/iframe lifecycles once; describe an offline snapshot if that bites.
  const target = suppress(() => {
    parent.insertBefore(el, slot(r, parent))
    try {
      return describe(el)
    } finally {
      el.remove()
    }
  })
  // Children removed from `el` earlier in this batch are not recorded on their own (the parent is gone, so its delete
  // subsumes them), but reverting the delete must bring `el` back WITH them: replay those removals backwards.
  const inner = c.records
    .slice(0, c.records.indexOf(r))
    .filter((q) => q.type === "childList" && el.contains(q.target))
    .reverse()
  push(
    c,
    el,
    { kind: "delete" },
    () =>
      suppress(() => {
        parent.insertBefore(el, slot(r, parent))
        for (const q of inner) undoChildList(q)
      }),
    target
  )
}

/** Inverse of one childList record (its added nodes leave, its removed nodes come back where they were). */
function undoChildList(q: MutationRecord): void {
  try {
    for (const n of q.addedNodes)
      if (n.parentNode === q.target) q.target.removeChild(n)
    for (const n of q.removedNodes) q.target.insertBefore(n, slot(q, q.target))
  } catch {
    // the page moved on; best effort
  }
}

/** Placement of `el` at the slot `r` removed it from, without touching the page. */
function oldPlacement(r: MutationRecord, el: Element): Placement | null {
  const parent = r.target as Element
  if (!parent.isConnected) return null
  const ref = slot(r, parent)
  let index = 0
  for (
    let p = ref ? ref.previousSibling : parent.lastChild;
    p;
    p = p.previousSibling
  ) {
    if (p.nodeType === 1 && p !== el) index++
  }
  let next = ref
  while (next && (next.nodeType !== 1 || next === el)) next = next.nextSibling
  return {
    parent: redescribe(parent),
    index,
    ...(next ? { before: redescribe(next as Element) } : {}),
  }
}

function onMoved(c: Ctx, r: MutationRecord, el: Element): void {
  if (!watched(c, el)) return
  const from = oldPlacement(r, el)
  if (!from) return
  const parent = r.target as Element
  push(c, el, { kind: "move", from, to: placementOf(el) }, () =>
    suppress(() => parent.insertBefore(el, slot(r, parent)))
  )
}

function onInserted(c: Ctx, el: Element): void {
  // Appended into something else this batch created: that parent's `insert` already carries it in its html.
  if (
    !el.isConnected ||
    c.inserted.some((root) => root !== el && root.contains(el))
  )
    return
  push(
    c,
    el,
    {
      kind: "insert",
      placement: placementOf(el),
      html: el.outerHTML.slice(0, 2000),
    },
    () => suppress(() => el.remove())
  )
}
