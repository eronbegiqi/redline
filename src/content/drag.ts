import { describe, elementId, placementOf } from "@/content/describe"
import { suppress } from "@/content/guard"
import type { Recorder } from "@/shared/recorder"

// Drag & drop layer. See docs/SPEC.md "Drag layer". The DOM is only written on drop (no live preview):
// during a drag we draw a dimmed source, a chip and a drop indicator in `root`, all pointer-events:none.

export interface DraggerOptions {
  root: ShadowRoot
  isOurs: (n: EventTarget | Node | null) => boolean
  rec: Recorder
  /** Called after a successful drop (element already moved, change recorded) so the controller can select it + refresh the panel. */
  onMoved: (el: Element) => void
}
export interface DraggerApi {
  /** Active only in Mode "move". When inactive, no listeners may swallow page events. */
  setActive(on: boolean): void
  destroy(): void
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested; no DOM reads except where noted)

export type Axis = "x" | "y"
export type Side = "before" | "after" | "inside"
/** DOMRect satisfies this. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const EDGE_ZONE = 0.3
const NON_CONTAINERS = new Set(["img", "input", "br", "hr", "video", "canvas", "svg", "textarea", "select", "iframe"])

export const isLegalContainer = (el: Element): boolean => !NON_CONTAINERS.has(el.localName)

/**
 * Where a drop at (x, y) lands relative to `rect`: the outer 30% along the parent's main axis is
 * before/after, the middle is "inside" when the target may hold children (else the nearer half decides).
 */
export function computePlacement(i: { rect: Rect; x: number; y: number; axis: Axis; container: boolean }): Side {
  const size = i.axis === "x" ? i.rect.width : i.rect.height
  const t = size > 0 ? ((i.axis === "x" ? i.x - i.rect.left : i.y - i.rect.top) / size) : 0.5
  if (t < EDGE_ZONE) return "before"
  if (t > 1 - EDGE_ZONE) return "after"
  return i.container ? "inside" : t < 0.5 ? "before" : "after"
}

/**
 * Pointer is over a container's own bare area (padding/gap), not over a child: pick the slot between
 * its children. Nearest rect wins (2D, so wrapped rows work); the half of it the pointer is on picks the side.
 */
export function nearestChild(rects: Rect[], x: number, y: number, axis: Axis): { index: number; side: "before" | "after" } | null {
  let best = -1
  let bestD = Infinity
  rects.forEach((r, i) => {
    const dx = Math.max(r.left - x, 0, x - (r.left + r.width))
    const dy = Math.max(r.top - y, 0, y - (r.top + r.height))
    if (dx * dx + dy * dy < bestD) {
      bestD = dx * dx + dy * dy
      best = i
    }
  })
  if (best < 0) return null
  const r = rects[best]
  const mid = axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2
  return { index: best, side: (axis === "x" ? x : y) < mid ? "before" : "after" }
}

const LINE = 3

/** The indicator line for "before/after `anchor`", centred in the gap to `neighbour` when it sits on that side of the same line. */
export function lineFor(anchor: Rect, side: "before" | "after", axis: Axis, neighbour?: Rect | null): Rect {
  const y = axis === "y"
  const edge = y ? anchor.top + (side === "after" ? anchor.height : 0) : anchor.left + (side === "after" ? anchor.width : 0)
  let pos = edge
  if (neighbour) {
    const nEdge = y
      ? neighbour.top + (side === "before" ? neighbour.height : 0)
      : neighbour.left + (side === "before" ? neighbour.width : 0)
    // overlap on the other axis = same row/column; otherwise the neighbour is on a different line (wrapped flex/grid)
    const sameLine = y
      ? neighbour.left < anchor.left + anchor.width && anchor.left < neighbour.left + neighbour.width
      : neighbour.top < anchor.top + anchor.height && anchor.top < neighbour.top + neighbour.height
    if (sameLine && (side === "before" ? nEdge <= edge : nEdge >= edge)) pos = (edge + nEdge) / 2
  }
  return y
    ? { left: anchor.left, top: pos - LINE / 2, width: anchor.width, height: LINE }
    : { left: pos - LINE / 2, top: anchor.top, width: LINE, height: anchor.height }
}

const SCROLL_ZONE = 40
const SCROLL_MAX = 16 // px per frame at the very edge

/** Signed px/frame to scroll when `pos` is within 40px of `min` (negative) or `max` (positive); 0 elsewhere. Speeds up toward the edge. */
export function edgeSpeed(pos: number, min: number, max: number): number {
  if (pos < min + SCROLL_ZONE) return -Math.ceil(Math.min(1, (min + SCROLL_ZONE - pos) / SCROLL_ZONE) * SCROLL_MAX)
  if (pos > max - SCROLL_ZONE) return Math.ceil(Math.min(1, (pos - (max - SCROLL_ZONE)) / SCROLL_ZONE) * SCROLL_MAX)
  return 0
}

// ---------------------------------------------------------------------------------------------
// DOM helpers

/** `children` can be shadowed on forms (<input name="children">), so read it from the prototype like describe.ts does. */
const kidsOf = (p: Element): Element[] => {
  const get = Object.getOwnPropertyDescriptor(Element.prototype, "children")?.get
  return Array.from(get ? get.call(p) : p.children)
}

/** Occupies layout space: not display:none / zero-sized, not absolute/fixed. `r` = c's rect, passed in so callers read it once. */
function inFlow(c: Element, r: Rect): boolean {
  if (!r.width && !r.height) return false
  const pos = getComputedStyle(c).position
  return pos !== "absolute" && pos !== "fixed"
}

/**
 * Main axis of `parent`'s children. Flex: by direction (spec). Anything else (block, grid, floats, inline runs):
 * x when the first two in-flow children share a line, else y.
 */
export function axisOf(parent: Element): Axis {
  const cs = getComputedStyle(parent)
  if (cs.display.includes("flex")) return cs.getPropertyValue("flex-direction").startsWith("column") ? "y" : "x"
  const two: DOMRect[] = []
  for (const c of kidsOf(parent)) {
    const r = c.getBoundingClientRect()
    if (inFlow(c, r)) two.push(r)
    if (two.length === 2) return two[0].top < two[1].bottom && two[1].top < two[0].bottom ? "x" : "y"
  }
  return "y"
}

/** Inner SVG nodes (path, g, ...) can't be moved to or from HTML containers: treat the whole <svg> as the element. */
function outerSvg(el: Element): Element {
  let s = (el as SVGElement).ownerSVGElement
  while (s?.ownerSVGElement) s = s.ownerSVGElement
  return s ?? el
}

/** Nearest ancestor-or-self of `n` that is a child of `parent`. */
function atLevelOf(n: Element, parent: Element | null): Element | null {
  for (let c: Element | null = n; c; c = c.parentElement) if (c.parentElement === parent) return c
  return null
}

const hasOwnText = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === 3 && !!n.nodeValue?.trim())

interface Drop {
  parent: Element
  ref: Node | null
  /** Exactly one of these is drawn. */
  line?: Rect
  box?: Rect
}

function around(anchor: Element, side: "before" | "after", axis: Axis): Drop {
  const nb = side === "before" ? anchor.previousElementSibling : anchor.nextElementSibling
  return {
    parent: anchor.parentNode as Element,
    ref: side === "before" ? anchor : anchor.nextSibling,
    line: lineFor(anchor.getBoundingClientRect(), side, axis, nb?.getBoundingClientRect()),
  }
}

/**
 * Where would dropping `el` at (x, y) put it? null = nowhere (over itself, its own subtree, our UI, or nothing).
 * Differences from a literal "first non-ours hit" reading, all so ordinary pages stay usable:
 *  - the topmost hit being el/its subtree/our UI means "no target" (otherwise hovering the dragged item targets its parent);
 *  - a hit inside a sibling that looks like el (same tag) targets that sibling (reorder), not whatever text span is under
 *    the pointer. Different-tag siblings are not promoted: for an el under <body>, every deep hit would otherwise
 *    collapse into the enclosing <section> and nothing deeper could ever be targeted;
 *  - the bare area of a non-empty container resolves to the slot between its children instead of its own edge zones.
 */
function resolveDrop(el: Element, x: number, y: number, isOurs: DraggerOptions["isOurs"]): Drop | null {
  const hit = document.elementsFromPoint(x, y)[0]
  if (!hit || isOurs(hit)) return null
  const top = outerSvg(hit)
  if (top === document.documentElement || el.contains(top)) return null
  const sibling = atLevelOf(top, el.parentElement)
  const t = sibling && sibling.localName === el.localName ? sibling : top

  if (t === top && isLegalContainer(t) && !hasOwnText(t)) {
    // ponytail: scans every child per frame (~1.5ms @500, ~10ms @3000 children, measured in Chromium); probe with elementsFromPoint if huge flat lists matter
    const kids: Element[] = []
    const rects: DOMRect[] = []
    for (const c of kidsOf(t)) {
      const r = c !== el ? c.getBoundingClientRect() : null
      if (r && inFlow(c, r)) {
        kids.push(c)
        rects.push(r)
      }
    }
    const axis = axisOf(t)
    const near = nearestChild(rects, x, y, axis)
    if (near) return around(kids[near.index], near.side, axis)
  }

  const parent = t.parentElement
  const container = isLegalContainer(t)
  // <body>'s siblings would live in <html>: it can only receive children.
  const side: Side = t === document.body || !parent ? "inside" : computePlacement({ rect: t.getBoundingClientRect(), x, y, axis: axisOf(parent), container })
  if (side !== "inside") return around(t, side, axisOf(parent!))
  return container ? { parent: t, ref: null, box: t.getBoundingClientRect() } : null
}

/** First element at/after `ref`, ignoring `skip`: what would follow `skip` if it were inserted before `ref`. */
function nextElement(ref: Node | null, skip: Element): Element | null {
  for (let n = ref; n; n = n.nextSibling) if (n !== skip && n.nodeType === 1) return n as Element
  return null
}

function scrollsY(n: Element): boolean {
  return /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight
}

/** Scroll the innermost scroller whose edge the pointer is near, else the page. Returns whether anything moved. */
function autoScroll(x: number, y: number): boolean {
  const vh = window.innerHeight
  for (let n = document.elementFromPoint(x, y); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (!scrollsY(n)) continue
    const r = n.getBoundingClientRect()
    const v = edgeSpeed(y, Math.max(r.top, 0), Math.min(r.bottom, vh))
    const room = v < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1
    if (v && room) {
      n.scrollBy({ top: v, behavior: "instant" })
      return true
    }
  }
  const v = edgeSpeed(y, 0, vh)
  if (!v) return false
  const before = window.scrollY
  window.scrollBy({ top: v, behavior: "instant" })
  return window.scrollY !== before
}

const label = (el: Element): string =>
  el.localName +
  (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => "." + c)
    .join("")

// ---------------------------------------------------------------------------------------------
// Overlay. Neutral/slate + a blue accent with a white halo so it reads on light and dark pages.

interface Layer {
  root: HTMLElement
  dim: HTMLElement
  line: HTMLElement
  box: HTMLElement
  chip: HTMLElement
}

const ACCENT = "#3b82f6"
const NODE = "position:fixed;box-sizing:border-box;pointer-events:none;display:none;"

function makeLayer(text: string): Layer {
  const node = (part: string, css: string) => {
    const n = document.createElement("div")
    n.setAttribute("data-redline-drag", part)
    n.style.cssText = NODE + css
    return n
  }
  // no z-index: frame.ts puts the panel iframe at z-index:1 so it stays above overlay layers appended after it
  const root = node("layer", "inset:0;overflow:hidden;display:block;")
  const dim = node("dim", `background:rgba(100,116,139,.5);border:1px dashed ${ACCENT};`)
  const line = node("line", `background:${ACCENT};border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.95);`)
  const box = node(
    "box",
    `border:2px dashed ${ACCENT};border-radius:4px;background:rgba(59,130,246,.14);box-shadow:0 0 0 1px rgba(255,255,255,.9);`
  )
  const chip = node(
    "chip",
    "display:block;left:0;top:0;max-width:260px;padding:3px 8px;border-radius:6px;background:#0f172a;color:#f8fafc;" +
      "border:1px solid rgba(255,255,255,.45);box-shadow:0 4px 12px rgba(0,0,0,.4);font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
  )
  chip.textContent = text
  root.append(dim, line, box, chip)
  return { root, dim, line, box, chip }
}

function show(n: HTMLElement, r?: Rect): void {
  const s = n.style
  if (!r || (r.width <= 0 && r.height <= 0)) {
    s.display = "none"
    return
  }
  s.display = "block"
  s.left = r.left + "px"
  s.top = r.top + "px"
  s.width = r.width + "px"
  s.height = r.height + "px"
}

// ---------------------------------------------------------------------------------------------
// Controller

interface Pending {
  el: Element
  id: number
  x: number
  y: number
}
interface Drag {
  el: Element
  id: number
  x: number
  y: number
  layer: Layer
  drop: Drop | null
  /** Pointer or scroll position changed since the last hit-test. */
  dirty: boolean
  raf: number
}

const THRESHOLD = 4
/** Events the page must not see in move mode (same set as the select layer). */
const SWALLOWED = ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "submit"] as const

export function createDragger(opts: DraggerOptions): DraggerApi {
  const { root, isOurs, rec, onMoved } = opts
  let active = false
  let destroyed = false
  let offs: Array<() => void> = []
  let pending: Pending | null = null
  let drag: Drag | null = null

  // Every handler runs inside someone else's page: errors are swallowed, never rethrown.
  function on<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, passive = false): void {
    const h = (e: WindowEventMap[K]) => {
      try {
        fn(e)
      } catch {
        // ignore
      }
    }
    window.addEventListener(type, h, { capture: true, passive })
    offs.push(() => window.removeEventListener(type, h, { capture: true }))
  }

  /** Stop the page from seeing `e`, unless it is aimed at our own UI. */
  function swallow(e: Event): boolean {
    if (isOurs(e.target)) return false
    e.preventDefault()
    e.stopImmediatePropagation()
    return true
  }

  function end(): void {
    pending = null
    if (!drag) return
    cancelAnimationFrame(drag.raf)
    drag.layer.root.remove()
    drag = null
  }

  function paintChip(d: Drag): void {
    const de = document.documentElement
    const c = d.layer.chip
    const x = Math.max(4, Math.min(d.x + 20, de.clientWidth - c.offsetWidth - 4))
    const y = Math.max(4, Math.min(d.y + 24, de.clientHeight - c.offsetHeight - 4))
    c.style.transform = `translate(${x}px,${y}px)`
  }

  function refresh(d: Drag): void {
    d.dirty = false
    d.drop = resolveDrop(d.el, d.x, d.y, isOurs)
    show(d.layer.dim, d.el.getBoundingClientRect())
    show(d.layer.line, d.drop?.line)
    show(d.layer.box, d.drop?.box)
    paintChip(d)
  }

  function tick(): void {
    const d = drag
    if (!d) return
    try {
      if (autoScroll(d.x, d.y)) d.dirty = true
      if (d.dirty) refresh(d)
    } catch {
      // keep the loop alive; the next frame may succeed
    }
    d.raf = requestAnimationFrame(tick)
  }

  function begin(p: Pending, x: number, y: number): void {
    pending = null
    root.append((drag = { el: p.el, id: p.id, x, y, layer: makeLayer(label(p.el)), drop: null, dirty: true, raf: 0 }).layer.root)
    refresh(drag)
    drag.raf = requestAnimationFrame(tick)
  }

  function move(el: Element, drop: Drop): void {
    const fromParent = el.parentNode
    // Same parent and same following element: nothing to do. Checked before writing so a no-op never even shuffles whitespace.
    if (!fromParent || el.contains(drop.parent)) return
    if (drop.parent === fromParent && nextElement(drop.ref, el) === el.nextElementSibling) return
    const fromNext = el.nextSibling
    // describe() is first-touch: it must see the element where it was.
    const target = describe(el)
    const from = placementOf(el)
    try {
      suppress(() => drop.parent.insertBefore(el, drop.ref))
    } catch {
      return // HierarchyRequestError (e.g. a parent that refuses children): nothing was changed
    }
    const to = placementOf(el)
    rec.record({
      kind: "move",
      el: elementId(el),
      target,
      from,
      to,
      origin: "panel",
      revert: () => suppress(() => fromParent.insertBefore(el, fromNext?.parentNode === fromParent ? fromNext : null)),
    })
    onMoved(el)
  }

  function attach(): void {
    on("pointerdown", (e) => {
      if (isOurs(e.target)) return
      swallow(e)
      if (pending || drag || !e.isPrimary || e.button !== 0 || !(e.target instanceof Element)) return
      const el = outerSvg(e.target)
      if (el === document.documentElement || el === document.body) return
      pending = { el, id: e.pointerId, x: e.clientX, y: e.clientY }
    })

    on("pointermove", (e) => {
      const cur = drag ?? pending
      if (!cur || e.pointerId !== cur.id) return
      swallow(e)
      // Button released somewhere we never heard about (outside the window, over a devtools pane...).
      if (e.buttons === 0) return end()
      if (drag) {
        drag.x = e.clientX
        drag.y = e.clientY
        drag.dirty = true
        paintChip(drag)
      } else if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) >= THRESHOLD) {
        begin(pending, e.clientX, e.clientY)
      }
    })

    on("pointerup", (e) => {
      swallow(e) // every pointerdown was swallowed, so the page must not see a lone pointerup either
      const cur = drag ?? pending
      if (!cur || e.pointerId !== cur.id) return
      const d = drag
      end() // before the move: the overlay must be gone by the time describe() and the controller look at the page
      const inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight
      if (!d || !inside) return
      const drop = resolveDrop(d.el, e.clientX, e.clientY, isOurs)
      if (drop) move(d.el, drop)
    })

    on("pointercancel", (e) => {
      if (e.pointerId === (drag ?? pending)?.id) end()
    })

    on("keydown", (e) => {
      if (e.key !== "Escape" || !(drag || pending)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      end()
    })

    // Alt-tab etc: the pointerup will never arrive. (Capture on window also sees every element's blur, hence the target check.)
    on("blur", (e) => {
      if (!(e.target instanceof Node)) end()
    })

    // Native text selection / HTML5 drag of images and links must not start under our drag.
    for (const t of ["selectstart", "dragstart"] as const)
      on(t, (e) => {
        if (drag || pending) e.preventDefault()
      })

    for (const t of SWALLOWED) on(t, swallow)

    // Wheel/scrollbar scrolling and resizes move things under a still pointer.
    for (const t of ["scroll", "resize"] as const)
      on(
        t,
        () => {
          if (drag) drag.dirty = true
        },
        true
      )
  }

  function detach(): void {
    end()
    for (const off of offs) off()
    offs = []
  }

  return {
    setActive(on) {
      if (destroyed || on === active) return
      active = on
      if (on) attach()
      else detach()
    },
    destroy() {
      destroyed = true
      active = false
      detach()
    },
  }
}
