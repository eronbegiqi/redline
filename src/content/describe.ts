import type { Descriptor, Placement, SourceHint } from "@/shared/types"

// Element identity, selectors and descriptors. See docs/SPEC.md "Describe + probe".
// Everything here runs inside the host page: it must never throw.

let counter = 0
const ids = new WeakMap<Element, string>()
const refs = new Map<string, WeakRef<Element>>() // ponytail: entries of collected elements linger until looked up
const cache = new WeakMap<Element, Descriptor>()

/** Session-stable id for an element ("e1", "e2", ...). Same element -> same id for the page's lifetime. */
export function elementId(el: Element): string {
  let id = ids.get(el)
  if (!id) {
    id = `e${++counter}`
    ids.set(el, id)
    refs.set(id, new WeakRef(el))
  }
  return id
}

/** Reverse lookup (weak refs). Null if unknown or garbage collected. */
export function elementById(id: string): Element | null {
  const el = refs.get(id)?.deref()
  if (!el) refs.delete(id)
  return el ?? null
}

/** Descriptor captured the FIRST time this element is described, then cached (so it reflects the original position). */
export function describe(el: Element): Descriptor {
  let d = cache.get(el)
  if (!d) cache.set(el, (d = redescribe(el)))
  return d
}

/** Fresh descriptor of the element as it is right now (does not touch the describe() cache). */
export function redescribe(el: Element): Descriptor {
  const d: Descriptor = { selector: selectorFor(el), tag: "", classes: [] }
  try {
    d.tag = el.tagName.toLowerCase()
    // getAttribute, not el.id / el.classList: <input name="id"> inside a <form> shadows form.id.
    const id = el.getAttribute("id")
    if (id) d.id = id
    d.classes = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
    const text = ownText(el)
    if (text) d.text = text
    const attrs = attrsOf(el)
    if (attrs) d.attrs = attrs
    const source = probe(el)
    if (source) d.source = source
  } catch {
    // exotic/clobbered node: keep whatever was collected so far
  }
  return d
}

/** Current placement of `el` inside its parent (parent described fresh). */
export function placementOf(el: Element): Placement {
  const p = el.parentNode
  const sibs = p ? childrenOf(p) : []
  const i = sibs.indexOf(el)
  const next = i < 0 ? undefined : sibs[i + 1]
  // <html> lives in the Document, which has no Descriptor of its own
  const parent: Descriptor =
    p instanceof Element
      ? redescribe(p)
      : { selector: "", tag: (p?.nodeName ?? "").toLowerCase(), classes: [] }
  return next
    ? { parent, index: Math.max(i, 0), before: redescribe(next) }
    : { parent, index: Math.max(i, 0) }
}

// ---------------------------------------------------------------------------------------------
// Descriptor parts

const ATTRS = [
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
]

function ownText(el: Element): string {
  let s = ""
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue + " "
  // the last replace drops a surrogate pair cut in half by slice()
  return s
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[\uD800-\uDBFF]$/, "")
}

function attrsOf(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v) out[a] = v.slice(0, 120)
  }
  return Object.keys(out).length ? out : undefined
}

// ---------------------------------------------------------------------------------------------
// Probe round trip (protocol in SPEC; the other end is probe-main.ts, which cannot share code with us)

const FRAMEWORKS: readonly string[] = ["react", "vue", "svelte"]
const MAX_NAME = 80
const MAX_CHAIN = 4
const MAX_FILE = 300
const MAX_POS = 10_000_000
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

const cleanString = (x: unknown, max: number): string | undefined =>
  typeof x === "string" &&
  !CONTROL.test(x) &&
  x.trim() &&
  x.trim().length <= max
    ? x.trim()
    : undefined
const cleanInt = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_POS
    ? x
    : undefined

/**
 * The probe answer travels through a DOM attribute that the page can also write (it can listen for
 * "redline:probe" itself), so it is untrusted: rebuild a SourceHint from known fields only.
 * Strings with control characters, over-long strings and out-of-range numbers are dropped, not trimmed.
 */
export function sanitizeHint(raw: unknown): SourceHint | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const framework =
    typeof r.framework === "string" && FRAMEWORKS.includes(r.framework)
      ? (r.framework as SourceHint["framework"])
      : undefined
  if (!framework) return undefined
  const hint: SourceHint = { framework }
  const component = cleanString(r.component, MAX_NAME)
  if (component) hint.component = component
  if (Array.isArray(r.chain)) {
    const chain = r.chain
      .map((n) => cleanString(n, MAX_NAME))
      .filter((n): n is string => !!n)
      .slice(0, MAX_CHAIN)
    if (chain.length) hint.chain = chain
  }
  const file = cleanString(r.file, MAX_FILE)
  if (file) hint.file = file
  const line = cleanInt(r.line)
  if (line !== undefined) hint.line = line
  const column = cleanInt(r.column)
  if (column !== undefined) hint.column = column
  return hint
}

function probe(el: Element): SourceHint | undefined {
  const root = document.documentElement
  try {
    root.removeAttribute("data-redline-result") // never trust a stale or page-planted result
    el.setAttribute("data-redline-probe", "1")
    document.dispatchEvent(new CustomEvent("redline:probe")) // runs the MAIN-world listener synchronously
    const raw = root.getAttribute("data-redline-result")
    return raw ? sanitizeHint(JSON.parse(raw)) : undefined
  } catch {
    return undefined
  } finally {
    el.removeAttribute("data-redline-probe")
    root?.removeAttribute("data-redline-result")
  }
}

// ---------------------------------------------------------------------------------------------
// Selectors

type Scope = ParentNode
type Mode = "type" | "child"

/** A readable path that still has to climb at least this far (when the DOM has that many levels). */
const CONTEXT = 3
/** An anchored path (#id > div > ul > li) is kept whole up to this many segments. */
const MAX_ANCHORED = 6

/**
 * Unique CSS selector for `el` right now: querySelectorAll(result) is exactly [el].
 * Order: unique #id / data-testid|test|cy on the element itself; else the `>` path of tag:nth-of-type(n)
 * segments from the nearest unique anchor ancestor (kept whole up to 6 segments); else the last 3 segments,
 * or more when that is the least that is unique. It reads like "main > ul > li:nth-of-type(2)": enough
 * context for a human or an AI, not the shortest string that happens to match once.
 * Classes are deliberately absent: they are volatile.
 */
export function selectorFor(el: Element): string {
  try {
    const scope = scopeOf(el)
    // Detached subtree: nothing to verify against, a root-relative path is the best we can do.
    if (!scope) return segments(el, null, "type").segs.join(" > ")
    return (
      anchor(el, scope) ??
      readable(el, scope, "type") ??
      // the engine counts same-type siblings differently from us (exotic namespaces): nth-child can't disagree
      readable(el, scope, "child") ??
      segments(el, scope, "child").segs.join(" > ")
    )
  } catch {
    return safe(() => el.localName, "*")
  }
}

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f()
  } catch {
    return fallback
  }
}

const esc = (s: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s

const quote = (v: string) =>
  `"${v.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`

function scopeOf(el: Element): Scope | null {
  const root = el.getRootNode()
  return root.nodeType === 9 || root.nodeType === 11
    ? (root as unknown as Scope)
    : null
}

/** Element children of any parent. Forms are [LegacyOverrideBuiltIns]: <input name="children"> shadows form.children. */
function childrenOf(p: ParentNode): Element[] {
  const get = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "children"
  )?.get
  return Array.from(p instanceof Element && get ? get.call(p) : p.children)
}

const isOnly = (scope: Scope, sel: string, el: Element): boolean => {
  try {
    const found = scope.querySelectorAll(sel)
    return found.length === 1 && found[0] === el
  } catch {
    return false // selector the engine rejects (unescapable id, odd tag name, ...)
  }
}

/** `#id` or `[data-testid="x"]` if `node` carries one and it is unique in the scope. */
function anchor(node: Element, scope: Scope): string | null {
  const candidates: string[] = []
  const id = node.getAttribute("id")
  if (id) candidates.push("#" + esc(id))
  for (const a of ["data-testid", "data-test", "data-cy"]) {
    const v = node.getAttribute(a)
    if (v) candidates.push(`[${a}=${quote(v)}]`)
  }
  return candidates.find((c) => isOnly(scope, c, node)) ?? null
}

/** Path segments from the outermost one down to `el`; `anchored` when the outermost one is an #id / data-testid ancestor. */
function segments(
  el: Element,
  scope: Scope | null,
  mode: Mode
): { segs: string[]; anchored: boolean } {
  const out: string[] = []
  let anchored = false
  for (let n: Element | null = el; n; n = n.parentElement) {
    const a = scope && n !== el ? anchor(n, scope) : null
    if (a) {
      out.push(a)
      anchored = true
      break
    }
    out.push(segment(n, mode))
  }
  return { segs: out.reverse(), anchored }
}

function segment(node: Element, mode: Mode): string {
  const parent = node.parentNode
  if (mode === "child") {
    if (!parent) return "*"
    return parent.nodeType === 9
      ? ":root"
      : `*:nth-child(${childrenOf(parent).indexOf(node) + 1})`
  }
  const tag = esc(node.localName)
  if (!parent) return tag
  const same = childrenOf(parent).filter(
    (s) =>
      s.localName === node.localName && s.namespaceURI === node.namespaceURI
  )
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag
}

/** Readable unique path, or null if even the whole path is not unique. */
function readable(el: Element, scope: Scope, mode: Mode): string | null {
  const { segs, anchored } = segments(el, scope, mode)
  const k = uniqueSuffixLength(el, scope, segs)
  if (k === null) return null
  // A unique suffix stays unique when more ancestors are prepended, so any length >= k is safe, in theory:
  // verify anyway (selector engines disagree about :nth-of-type across namespaces) and fall back to the proven k.
  const n =
    anchored && segs.length <= MAX_ANCHORED
      ? segs.length
      : Math.max(k, Math.min(segs.length, CONTEXT))
  let chosen = segs.slice(-n)
  if (chosen.length > k && chosen[0] === "html") chosen = chosen.slice(1) // "html > body > …" adds nothing
  const wanted = chosen.join(" > ")
  return isOnly(scope, wanted, el) ? wanted : segs.slice(-k).join(" > ")
}

/**
 * Length of the shortest unique suffix of the path, or null if even the whole path is not unique.
 * Uniqueness is monotone in the suffix length, so we gallop (1, 2, 4, ...) and then bisect: typical
 * elements cost one or two cheap queries, and a 1000-deep document stays logarithmic.
 */
function uniqueSuffixLength(
  el: Element,
  scope: Scope,
  segs: string[]
): number | null {
  const ok = (k: number) => isOnly(scope, segs.slice(-k).join(" > "), el)
  let lo = 0 // largest length known NOT to be unique
  let hi = 1
  while (!ok(hi)) {
    if (hi >= segs.length) return null
    lo = hi
    hi = Math.min(hi * 2, segs.length)
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return hi
}
