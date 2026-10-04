import { describe, elementId } from "@/content/describe"
import { recordText, setStyle } from "@/content/edit"
import { suppress } from "@/content/guard"
import type { Recorder } from "@/shared/recorder"
import type { Mode } from "@/shared/types"

// Selection layer. See docs/SPEC.md "Selection layer". Runs inside someone else's page: every
// listener is wrapped so nothing we do can throw into it, and the page is only ever touched via
// edit.ts / guard.suppress (plus the contenteditable attribute while a text edit is open).

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
  /** Programmatic selection (from panel parent/child actions). null clears. Does not call onSelect. */
  select(el: Element | null): void
  /** Re-measure and redraw overlays (call after style edits / scroll). */
  refresh(): void
  /** Remove listeners + overlay nodes. */
  destroy(): void
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

interface Axes {
  x: boolean
  y: boolean
}
interface Size {
  w: number
  h: number
}

const MIN_SIZE = 8

/** Border-box size after dragging by (dx, dy). Only the dragged axes are clamped/changed; shift on the corner keeps the ratio. */
export function nextSize(
  start: Size,
  dx: number,
  dy: number,
  ax: Axes,
  keepRatio: boolean
): Size {
  let w = ax.x ? Math.max(MIN_SIZE, start.w + dx) : start.w
  let h = ax.y ? Math.max(MIN_SIZE, start.h + dy) : start.h
  if (keepRatio && ax.x && ax.y && start.w > 0 && start.h > 0) {
    const k = Math.max(w / start.w, h / start.h)
    w = start.w * k
    h = start.h * k
  }
  return { w, h }
}

/** `tag#id.class.class` (max 2 classes, capped) - the label's identity part. */
export function labelFor(el: Element): string {
  const id = el.getAttribute("id")
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
  const s =
    el.localName +
    (id ? `#${id}` : "") +
    classes
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("")
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

const NOT_EDITABLE = /^(textarea|select|option|script|style)$/

/** Only text inside: safe to make contenteditable and to record as one text change. */
export function isTextLeaf(el: Element): boolean {
  return (
    el instanceof HTMLElement &&
    !NOT_EDITABLE.test(el.localName) &&
    el.childNodes.length > 0 &&
    Array.from(el.childNodes).every((n) => n.nodeType === 3) &&
    !!el.textContent?.trim()
  )
}

// Replaced elements are `display:inline` but do honour width/height; plain inline boxes ignore them.
const REPLACED = /^(img|svg|video|canvas|iframe|embed|object)$/

function resizable(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return false
  if (!("style" in el)) return false
  const d = getComputedStyle(el).display
  return (
    d !== "contents" &&
    d !== "none" &&
    (d !== "inline" || REPLACED.test(el.localName))
  )
}

// ---------------------------------------------------------------------------------------------
// Overlay DOM + CSS

// Ring = accent line (1.5 css px) + white hairline (1 css px), drawn just OUTSIDE the element so it never covers it.
// Both are rounded to whole DEVICE pixels (see sync()) so they stay crisp at DPR 1, 1.25, 2, ...
const TAG_H = 18
const TAG_GAP = 4

// Violet-blue reads on white and on near-black; the white hairline separates it from dark and busy backgrounds.
const CSS = `
.layer{--rl:#5b4bff;--w:1.5px;--ring:2.5px;position:fixed;inset:0;overflow:hidden;pointer-events:none;
  font:500 11px/${TAG_H}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
[hidden]{display:none!important}
.box{position:absolute;left:0;top:0;box-sizing:border-box;border-radius:1px;
  box-shadow:inset 0 0 0 var(--w) var(--rl),inset 0 0 0 var(--ring) rgba(255,255,255,.95)}
.box.hover{background:rgba(91,75,255,.08);
  box-shadow:inset 0 0 0 var(--w) rgba(91,75,255,.7),inset 0 0 0 var(--ring) rgba(255,255,255,.6)}
.tag{position:absolute;left:0;bottom:calc(100% + ${TAG_GAP}px);height:${TAG_H}px;padding:0 6px;
  border-radius:3px;background:var(--rl);color:#fff;white-space:nowrap;
  box-shadow:0 0 0 1px rgba(255,255,255,.9)}
.tag.below{bottom:auto;top:calc(100% + ${TAG_GAP}px)}
.tag.in{bottom:auto;top:6px}
.h{position:absolute;width:16px;height:16px;pointer-events:auto;touch-action:none}
.h::after{content:"";position:absolute;left:4px;top:4px;width:8px;height:8px;box-sizing:border-box;
  background:#fff;border:var(--w) solid var(--rl)}
.h.e{right:-8px;top:calc(50% - 8px)}
.h.s{left:calc(50% - 8px);bottom:-8px}
.h.se{right:-8px;bottom:-8px}
.sel:not(.live) .h,.sel.no-e .h.e,.sel.no-s .h.s{display:none}
.shield{position:fixed;inset:0;z-index:2147483647;pointer-events:auto}
`

const HANDLES: { name: string; ax: Axes; cursor: string }[] = [
  { name: "e", ax: { x: true, y: false }, cursor: "ew-resize" },
  { name: "s", ax: { x: false, y: true }, cursor: "ns-resize" },
  { name: "se", ax: { x: true, y: true }, cursor: "nwse-resize" },
]

/** Constructable stylesheets are exempt from the page's CSP (<style> elements may not be); <style> is the jsdom fallback. */
function injectStyles(root: ShadowRoot): () => void {
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return () => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet)
    }
  } catch {
    const style = document.createElement("style")
    style.textContent = CSS
    root.append(style)
    return () => style.remove()
  }
}

const div = (cls: string) => {
  const n = document.createElement("div")
  n.className = cls
  return n
}

interface Box {
  root: HTMLElement
  tag: HTMLElement
  /** Last geometry / label written, so an idle frame writes nothing. */
  key: string
  text: string
  /** `pos|left` last written to the label. */
  tagKey: string
  tagW: number
  /** Where the label currently sits (viewport px), to keep two labels from covering each other. */
  tx: number
  ty: number
  pos: "above" | "below" | "in"
}

function makeBox(cls: string): Box {
  const root = div(`box ${cls}`)
  const tag = div("tag")
  root.hidden = true
  root.append(tag)
  return { root, tag, key: "", text: "", tagKey: "", tagW: 0, tx: 0, ty: 0, pos: "above" }
}

// ---------------------------------------------------------------------------------------------
// Controller

// Swallowed in capture phase while in select mode so the page never sees our clicks.
const SWALLOWED = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "submit",
  "dragstart", // native drag of images/links
]

interface Keep {
  value: string
  priority: string
}
interface Resize {
  el: HTMLElement
  ax: Axes
  x0: number
  y0: number
  /** Border-box size at pointerdown, and the latest one while dragging (viewport px). */
  w0: number
  h0: number
  w: number
  h: number
  /** padding+border to subtract from a border-box size for content-box elements. */
  ex: number
  ey: number
  orig: Record<"width" | "height", Keep>
  hadStyleAttr: boolean
}
interface Editing {
  el: HTMLElement
  before: string
  prevAttr: string | null
  /** Original child nodes with their text, so Esc can put the very same nodes back. */
  saved: [Node, string | null][]
  onBlur: () => void
}

const swallow = (e: Event) => {
  e.stopImmediatePropagation()
  // Cancelling pointerdown would suppress the compat mousedown, and mousedown's default
  // (focus, text selection, native drag) is exactly what we want to cancel.
  if (!e.type.startsWith("pointer")) e.preventDefault()
}

/** Where the event really landed (reaches into open shadow roots, unlike e.target). */
function targetOf(e: Event): Element | null {
  const t = (e.composedPath?.()[0] ?? e.target) as Node | null
  return t && t.nodeType === 1 ? (t as Element) : null
}

export function createSelector(opts: SelectorOptions): SelectorApi {
  const { root, rec, isOurs } = opts
  const ac = new AbortController()
  const { signal } = ac

  let mode: Mode = "select"
  let sel: Element | null = null
  let hoverEl: Element | null = null
  let editing: Editing | null = null
  let drag: Resize | null = null
  let settling = false // true for one task after a resize: the click that ends it must not leak
  let settleTimer = 0
  let raf = 0
  let dead = false

  const layer = div("layer")
  layer.setAttribute("aria-hidden", "true") // decorative: the panel is the accessible UI
  const hoverBox = makeBox("hover")
  const selBox = makeBox("sel")
  selBox.root.classList.add("sel")
  layer.append(hoverBox.root, selBox.root)
  const shield = div("shield")
  shield.hidden = true
  const unstyle = injectStyles(root)
  // Appended (not prepended): the panel iframe has a z-index that keeps it above this layer. The shield
  // is a separate sibling because it must sit above the iframe (a layer is one stacking context).
  root.append(layer, shield)

  const safe = (f: () => void) => {
    try {
      f()
    } catch {
      // a throwing callback of the controller must not kill our loop or the page's event
    }
  }
  const notify = (el: Element | null) => safe(() => opts.onSelect(el))

  // ----- drawing -----------------------------------------------------------------------------

  let dpr = 1
  let ring = 2.5
  /** Re-derive the ring widths when the device pixel ratio changes (zoom, moving to another monitor). */
  function sync() {
    const now = devicePixelRatio || 1
    if (now === dpr && layer.style.getPropertyValue("--w")) return
    dpr = now
    const px = (cssPx: number) => Math.max(1, Math.round(cssPx * dpr)) / dpr
    ring = px(1.5) + px(1)
    layer.style.setProperty("--w", `${px(1.5)}px`)
    layer.style.setProperty("--ring", `${ring}px`)
    hoverBox.key = selBox.key = "" // geometry depends on `ring`
  }

  /** Place `b` around `el`; returns its rect, or null (box hidden) when there is nothing to show. `avoid`: a box whose label this one must not cover. */
  function paint(b: Box, el: Element | null, avoid?: Box): DOMRect | null {
    const r = el?.isConnected ? el.getBoundingClientRect() : null
    if (!el || !r || (!r.width && !r.height)) {
      b.root.hidden = true
      return null
    }
    // ponytail: boxes are not clipped by scrolling ancestors, so an element scrolled out of its container keeps a floating box
    const vw = layer.clientWidth || Infinity // 0 without layout (jsdom)
    const vh = layer.clientHeight || Infinity
    const snap = (v: number) => Math.round(v * dpr) / dpr
    // Clamp into the viewport so an element touching the edge still shows all four sides.
    const x0 = Math.max(0, snap(r.left - ring))
    const y0 = Math.max(0, snap(r.top - ring))
    const x1 = Math.min(vw, snap(r.right + ring))
    const y1 = Math.min(vh, snap(r.bottom + ring))
    if (x1 <= x0 || y1 <= y0) {
      b.root.hidden = true
      return null
    }
    b.root.hidden = false
    const key = `${x0},${y0},${x1 - x0},${y1 - y0}`
    if (key !== b.key) {
      b.key = key
      const s = b.root.style
      s.transform = `translate(${x0}px,${y0}px)`
      s.width = `${x1 - x0}px`
      s.height = `${y1 - y0}px`
    }
    const text = `${labelFor(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`
    if (text !== b.text || !b.tagW) {
      b.text = text
      b.tag.textContent = text
      b.tagW = b.tag.offsetWidth
    }
    // Above the box if it fits, else below, else inside (only for elements that fill the viewport).
    const fits = { above: y0 >= TAG_H + TAG_GAP, below: y1 + TAG_H + TAG_GAP <= vh }
    const at = (pos: Box["pos"]) => {
      b.pos = pos
      // Keep the label inside the viewport when the box starts near the right edge.
      b.tx = x0 + (pos === "in" ? 6 : 0) + Math.min(0, vw - 4 - b.tagW - x0)
      b.ty = pos === "above" ? y0 - TAG_GAP - TAG_H : pos === "below" ? y1 + TAG_GAP : y0 + 6
    }
    at(fits.above ? "above" : fits.below ? "below" : "in")
    if (avoid && !avoid.root.hidden && b.pos !== "in") {
      const clash = b.tx < avoid.tx + avoid.tagW && avoid.tx < b.tx + b.tagW && b.ty < avoid.ty + TAG_H && avoid.ty < b.ty + TAG_H
      const other = b.pos === "above" ? "below" : "above"
      if (clash && fits[other]) at(other)
    }
    const tagKey = `${b.pos}|${b.tx - x0}`
    if (tagKey !== b.tagKey) {
      b.tagKey = tagKey
      b.tag.className = b.pos === "above" ? "tag" : `tag ${b.pos}`
      b.tag.style.left = `${b.tx - x0}px`
    }
    return r
  }

  function draw() {
    if (dead) return
    if (sel && !sel.isConnected) {
      sel = null // first: endEdit/endResize redraw
      endEdit(false)
      endResize(false)
      notify(null)
    }
    if (hoverEl && !hoverEl.isConnected) hoverEl = null
    sync()
    const live = mode === "select"
    const r = paint(selBox, sel)
    paint(hoverBox, live && !editing && !drag && hoverEl !== sel ? hoverEl : null, selBox)
    if (r && sel) {
      const c = selBox.root.classList
      c.toggle("live", live && !editing && resizable(sel))
      c.toggle("no-e", r.height < 24) // handles would sit on top of each other
      c.toggle("no-s", r.width < 24)
    }
  }

  // Tracks the boxes every frame while something is shown: that covers scroll (any container),
  // resize, CSS transitions and the page removing the element, with one mechanism.
  function tick() {
    raf = 0
    draw()
    if (sel || hoverEl) kick()
  }
  function kick() {
    if (!raf && !dead) raf = requestAnimationFrame(tick)
  }

  // ----- selection ---------------------------------------------------------------------------

  function setSel(el: Element | null) {
    sel = el
    draw()
    kick()
  }

  function userSelect(el: Element | null) {
    if (el === sel) return
    setSel(el)
    notify(el)
  }

  /** null for our UI, <html> and <body>. */
  function pickable(t: Element | null): Element | null {
    if (!t || isOurs(t)) return null
    return t === document.documentElement || t === document.body ? null : t
  }

  // ----- text edit ---------------------------------------------------------------------------

  function startEdit(el: HTMLElement) {
    if (editing) return
    describe(el) // first-touch descriptor must hold the ORIGINAL text, so take it before anything changes
    const ed: Editing = {
      el,
      before: el.textContent ?? "",
      prevAttr: el.getAttribute("contenteditable"),
      saved: Array.from(el.childNodes, (n): [Node, string | null] => [n, n.nodeValue]),
      onBlur: () => safe(() => endEdit(true)),
    }
    editing = ed
    suppress(() => el.setAttribute("contenteditable", "plaintext-only"))
    el.addEventListener("blur", ed.onBlur, { signal })
    el.focus({ preventScroll: true })
    getSelection()?.selectAllChildren(el)
    draw()
  }

  function endEdit(commit: boolean) {
    const ed = editing
    if (!ed) return
    editing = null
    ed.el.removeEventListener("blur", ed.onBlur)
    const after = ed.el.textContent ?? ""
    suppress(() => {
      if (!commit) {
        for (const [n, v] of ed.saved) n.nodeValue = v
        ed.el.replaceChildren(...ed.saved.map(([n]) => n))
      }
      if (ed.prevAttr === null) ed.el.removeAttribute("contenteditable")
      else ed.el.setAttribute("contenteditable", ed.prevAttr)
    })
    ed.el.blur()
    if (commit && after !== ed.before) {
      recordText(rec, ed.el, ed.before, after)
      safe(opts.onChanged)
    }
    draw()
  }

  // ----- resize ------------------------------------------------------------------------------

  function startResize(e: PointerEvent, ax: Axes, cursor: string) {
    const el = sel as HTMLElement | null
    if (!el || drag || mode !== "select") return
    describe(el)
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const n = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0
    const content = cs.boxSizing !== "border-box"
    const keep = (p: string): Keep => ({
      value: el.style.getPropertyValue(p),
      priority: el.style.getPropertyPriority(p),
    })
    // ponytail: ignores CSS transforms (a scaled element resizes at the wrong rate); add a rect/offset ratio if needed
    drag = {
      el,
      ax,
      x0: e.clientX,
      y0: e.clientY,
      w0: r.width,
      h0: r.height,
      w: r.width,
      h: r.height,
      ex: content ? n("padding-left") + n("padding-right") + n("border-left-width") + n("border-right-width") : 0,
      ey: content ? n("padding-top") + n("padding-bottom") + n("border-top-width") + n("border-bottom-width") : 0,
      orig: { width: keep("width"), height: keep("height") },
      hadStyleAttr: el.hasAttribute("style"),
    }
    // Covers the page while dragging: keeps the resize cursor and stops page hover effects.
    shield.style.cursor = cursor
    shield.hidden = false
    kick()
  }

  const css = (borderBox: number, extra: number) =>
    `${Math.max(0, Math.round(borderBox - extra))}px`

  function resizeMove(d: Resize, e: PointerEvent) {
    e.stopImmediatePropagation()
    if (!(e.buttons & 1)) return endResize(true) // pointerup was lost (released over DevTools, ...)
    const s = nextSize({ w: d.w0, h: d.h0 }, e.clientX - d.x0, e.clientY - d.y0, d.ax, e.shiftKey)
    d.w = s.w
    d.h = s.h
    // Live preview only; endResize puts the originals back and records once.
    suppress(() => {
      if (d.ax.x) d.el.style.setProperty("width", css(s.w, d.ex), "important")
      if (d.ax.y) d.el.style.setProperty("height", css(s.h, d.ey), "important")
    })
    kick()
  }

  function endResize(commit: boolean) {
    const d = drag
    if (!d) return
    drag = null
    shield.hidden = true
    settling = true
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => (settling = false), 0)
    suppress(() => {
      const st = d.el.style
      for (const p of ["width", "height"] as const) {
        const o = d.orig[p]
        if (o.value) st.setProperty(p, o.value, o.priority)
        else st.removeProperty(p)
      }
      if (!d.hadStyleAttr && !st.length) {
        // Chrome syncs CSSOM edits to the attribute lazily and would re-create style="" after removeAttribute: flush first.
        d.el.getAttribute("style")
        d.el.removeAttribute("style")
      }
    })
    if (commit) {
      // One setStyle per axis that actually changed; the Recorder merges repeated drags into one entry.
      let changed = false
      const apply = (prop: "width" | "height", now: number, was: number, extra: number) => {
        if (Math.abs(now - was) < 0.5) return
        let value = css(now, extra)
        // Dragged back to the size it had before its first drag: reuse that exact string so the Recorder cancels the
        // entry out (computed sizes are fractional, ours are whole px).
        const first = rec.list().find((c) => c.kind === "style" && c.el === elementId(d.el) && c.prop === prop)
        if (first?.kind === "style" && first.before?.endsWith("px") && Math.abs(parseFloat(first.before) - (now - extra)) < 0.5) {
          value = first.before
        }
        setStyle(rec, d.el, prop, value)
        changed = true
      }
      if (d.ax.x) apply("width", d.w, d.w0, d.ex)
      if (d.ax.y) apply("height", d.h, d.h0, d.ey)
      if (changed) safe(opts.onChanged)
    }
    draw()
  }

  for (const { name, ax, cursor } of HANDLES) {
    const h = div(`h ${name}`)
    h.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        safe(() => startResize(e, ax, cursor))
      },
      { signal }
    )
    selBox.root.append(h)
  }

  // ----- window listeners --------------------------------------------------------------------

  const on = (type: string, f: (e: never) => void) =>
    window.addEventListener(type, (e) => safe(() => f(e as never)), { capture: true, signal })

  function onSwallowed(e: MouseEvent) {
    if (mode !== "select") return
    if (e.type === "pointerdown") settling = false // a new gesture, not the tail of the last resize
    if (drag || settling) {
      swallow(e)
      if (drag && e.type === "pointerup") endResize(true)
      return
    }
    const t = targetOf(e)
    if (editing) {
      if (t && editing.el.contains(t)) {
        // Caret placement and word selection are default actions of mouse down/up, so those stay uncancelled; the
        // page just must not see any of it (a button's own click handler would fire on every caret click).
        e.stopImmediatePropagation()
        if (!/^(pointer|mouse|context)/.test(e.type)) e.preventDefault()
        return
      }
      if (e.type === "pointerdown") endEdit(true) // click elsewhere commits
    }
    if (isOurs(e.target)) return // our handles / panel
    swallow(e)
    if (e.type === "pointerdown") {
      // We cancel mousedown, so focus would stay in our panel iframe: take it back for Esc / Enter.
      ;(root.activeElement as HTMLElement | null)?.blur()
      if (e.button === 0 && (e as PointerEvent).isPrimary !== false) userSelect(pickable(t))
    } else if (e.type === "dblclick") {
      const el = pickable(t)
      if (el && isTextLeaf(el)) {
        userSelect(el)
        startEdit(el as HTMLElement)
      }
    }
  }
  for (const type of SWALLOWED) on(type, onSwallowed)

  on("pointermove", (e: PointerEvent) => {
    if (drag) return resizeMove(drag, e)
    if (mode !== "select") return
    hoverEl = pickable(targetOf(e))
    kick()
  })
  on("pointercancel", () => endResize(false))
  // Left the page, or entered our panel (whose events never reach us): drop the hover box.
  on("pointerout", (e: PointerEvent) => {
    if (!e.relatedTarget || isOurs(e.relatedTarget)) {
      hoverEl = null
      kick()
    }
  })

  on("keydown", (e: KeyboardEvent) => {
    if (mode !== "select" || e.isComposing || e.keyCode === 229) return
    if (e.key === "Escape") {
      if (drag) endResize(false)
      else if (editing) endEdit(false)
      else if (sel) userSelect(null)
      else return // nothing of ours to cancel: the page may have a use for it
      swallow(e)
    } else if (e.key === "Enter" && !e.shiftKey && editing) {
      endEdit(true)
      swallow(e)
    } else if (e.key === " " && editing && /^(button|summary)$/.test(editing.el.localName)) {
      // Chrome treats Space in these as "activate" and never inserts the character.
      e.preventDefault()
      document.execCommand("insertText", false, " ")
    }
  })

  return {
    setMode(next) {
      if (dead) return
      mode = next
      if (next !== "select") {
        endEdit(true)
        endResize(false)
        hoverEl = null
      }
      draw()
      kick()
    },
    select(el) {
      if (dead) return
      if (editing && editing.el !== el) endEdit(true)
      setSel(el && !isOurs(el) ? el : null)
    },
    refresh: draw,
    destroy() {
      if (dead) return
      endResize(false)
      endEdit(false)
      dead = true
      ac.abort()
      cancelAnimationFrame(raf)
      clearTimeout(settleTimer)
      layer.remove()
      shield.remove()
      unstyle()
      sel = hoverEl = null
    },
  }
}
