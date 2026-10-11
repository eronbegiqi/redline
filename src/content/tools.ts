import { describe, elementId, placementOf } from "@/content/describe"
import { setStyle } from "@/content/edit"
import { isLegalContainer } from "@/content/drag"
import { settleStyleAttr, styleAttrBefore, suppress } from "@/content/guard"
import type { Recorder } from "@/shared/recorder"
import type { Mode, Tool } from "@/shared/types"

// Figma-style tools. Mode "position": drag an element to offset it (position:relative + left/top).
// Mode "draw": drag a rectangle on the page to insert a new absolutely positioned element there.
// Same rules as the other layers: page events are swallowed while active, DOM writes go through suppress()/edit.ts,
// nothing throws into the page.

export interface ToolsOptions {
  root: ShadowRoot
  isOurs: (n: EventTarget | Node | null) => boolean
  rec: Recorder
  /** Select this element in the controller + refresh the panel (after a positioning or a draw). */
  onSelect: (el: Element) => void
  /** The selection, for arrow-key nudging. */
  getSelected: () => Element | null
  /** A draw finished: the controller returns to Select mode. */
  onDrawn: () => void
}
export interface ToolsApi {
  setMode(mode: Mode): void
  setTool(tool: Tool): void
  destroy(): void
}

const THRESHOLD = 4
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
  "selectstart",
  "dragstart",
] as const

const px = (n: number) => `${Math.round(n)}px`
const FILL = "rgb(229, 231, 235)"
const BAND =
  "position:fixed;box-sizing:border-box;pointer-events:none;border:1.5px dashed #5b4bff;background:rgba(91,75,255,.1)"

interface Base {
  /** Computed position was static, so position:relative is added with the first offset. */
  wasStatic: boolean
  left: number
  top: number
}
const readBase = (el: Element): Base => {
  const cs = getComputedStyle(el)
  // shortcut: an element placed with right/bottom only (left/top auto) is moved with left/top anyway; use the fields to fix it.
  return {
    wasStatic: cs.position === "static",
    left: parseFloat(cs.left) || 0,
    top: parseFloat(cs.top) || 0,
  }
}

/** Offset `el` by (dx, dy) from `base` as recorded style changes. */
function commitOffset(
  rec: Recorder,
  el: Element,
  base: Base,
  dx: number,
  dy: number
) {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  if (base.wasStatic) setStyle(rec, el, "position", "relative")
  if (Math.abs(dx) >= 1) setStyle(rec, el, "left", px(base.left + dx))
  if (Math.abs(dy) >= 1) setStyle(rec, el, "top", px(base.top + dy))
}

export function createTools(opts: ToolsOptions): ToolsApi {
  const { root, isOurs, rec } = opts
  let mode: Mode = "select"
  let tool: Tool = "box"
  let offs: Array<() => void> = []

  // position mode
  let pos: {
    el: HTMLElement
    id: number
    x0: number
    y0: number
    base: Base
    saved: Record<"position" | "left" | "top", [string, string]>
    prevAttr: string | null
    dx: number
    dy: number
    live: boolean
  } | null = null
  // draw mode
  let draw: {
    id: number
    x0: number
    y0: number
    x: number
    y: number
    container: Element
    band: HTMLElement
  } | null = null

  const swallow = (e: Event) => {
    if (isOurs(e.target)) return false
    e.preventDefault()
    e.stopImmediatePropagation()
    return true
  }

  const target = (e: Event): Element | null => {
    const t = (e.composedPath?.()[0] ?? e.target) as Node | null
    const el = t && t.nodeType === 1 ? (t as Element) : null
    return el && !isOurs(el) ? el : null
  }

  // ---- position -------------------------------------------------------------------------------

  function restore(p: NonNullable<typeof pos>) {
    suppress(() => {
      for (const [k, [v, pr]] of Object.entries(p.saved))
        if (v) p.el.style.setProperty(k, v, pr)
        else p.el.style.removeProperty(k)
      settleStyleAttr(p.el, p.prevAttr)
    })
  }
  function endPosition(commit: boolean) {
    const p = pos
    pos = null
    if (!p) return
    if (p.live) restore(p)
    if (commit) commitOffset(rec, p.el, p.base, p.dx, p.dy)
    if (p.live) opts.onSelect(p.el)
  }

  /** Nudge the selection with the arrow keys: 1px, 10px with Shift. Each press is one recorded edit (the Recorder merges them). */
  function nudge(el: Element, dx: number, dy: number) {
    commitOffset(rec, el, readBase(el), dx, dy)
    opts.onSelect(el)
  }

  // ---- draw -----------------------------------------------------------------------------------

  function endDraw(commit: boolean) {
    const d = draw
    draw = null
    if (!d) return
    d.band.remove()
    if (commit) create(d)
  }

  function create(d: NonNullable<typeof draw>) {
    const x = Math.min(d.x0, d.x)
    const y = Math.min(d.y0, d.y)
    const w = Math.abs(d.x - d.x0)
    const h = Math.abs(d.y - d.y0)
    const dragged = w >= THRESHOLD || h >= THRESHOLD
    const doc = document
    const el = doc.createElement(
      tool === "box" ? "div" : tool === "text" ? "p" : "button"
    )
    if (tool === "text") el.textContent = "Text"
    if (tool === "button") el.textContent = "Button"
    const cr = d.container.getBoundingClientRect()
    const box = d.container as HTMLElement
    const css = [
      "position:absolute",
      `left:${px(x - cr.left - box.clientLeft + box.scrollLeft)}`,
      `top:${px(y - cr.top - box.clientTop + box.scrollTop)}`,
    ]
    if (tool === "box") {
      css.push(
        `width:${px(dragged ? w : 120)}`,
        `height:${px(dragged ? h : 80)}`,
        `background-color:${FILL}`
      )
    } else if (dragged) css.push(`width:${px(w)}`)
    el.setAttribute("style", css.join(";"))

    // The container must be positioned for left/top to mean "where it was drawn": that is a recorded edit of its own.
    if (getComputedStyle(d.container).position === "static")
      setStyle(rec, d.container, "position", "relative")
    const container = d.container
    suppress(() => container.append(el))
    rec.record({
      kind: "insert",
      el: elementId(el),
      target: describe(el),
      placement: placementOf(el),
      html: el.outerHTML.slice(0, 2000),
      origin: "panel",
      revert: () => suppress(() => el.remove()),
    })
    opts.onSelect(el)
    opts.onDrawn()
  }

  // ---- listeners ------------------------------------------------------------------------------

  function on<K extends keyof WindowEventMap>(
    type: K,
    fn: (e: WindowEventMap[K]) => void
  ) {
    const h = (e: WindowEventMap[K]) => {
      try {
        fn(e)
      } catch {
        // never throw into the page
      }
    }
    window.addEventListener(type, h, { capture: true })
    offs.push(() => window.removeEventListener(type, h, { capture: true }))
  }

  function attach() {
    on("pointerdown", (e) => {
      if (isOurs(e.target)) return
      swallow(e)
      ;(root.activeElement as HTMLElement | null)?.blur() // focus must come back to the page for Esc / arrows
      if (pos || draw || !e.isPrimary || e.button !== 0) return
      const t = target(e)
      if (!t) return
      if (mode === "position") {
        if (t === document.documentElement || t === document.body) return
        const el = t as HTMLElement
        describe(el) // first-touch descriptor before anything changes
        const keep = (p: string): [string, string] => [
          el.style.getPropertyValue(p),
          el.style.getPropertyPriority(p),
        ]
        pos = {
          el,
          id: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          base: readBase(el),
          saved: {
            position: keep("position"),
            left: keep("left"),
            top: keep("top"),
          },
          prevAttr: styleAttrBefore(el),
          dx: 0,
          dy: 0,
          live: false,
        }
        opts.onSelect(el)
      } else if (mode === "draw") {
        // A leaf (img, input, ...) cannot hold children: draw into its parent.
        let c: Element | null =
          t === document.documentElement ? document.body : t
        while (c && !isLegalContainer(c)) c = c.parentElement
        if (!c) return
        const band = document.createElement("div")
        band.style.cssText = BAND
        band.hidden = true
        root.append(band)
        draw = {
          id: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          x: e.clientX,
          y: e.clientY,
          container: c,
          band,
        }
      }
    })

    on("pointermove", (e) => {
      const p = pos
      if (p && e.pointerId === p.id) {
        swallow(e)
        if (e.buttons === 0) return endPosition(true)
        let dx = e.clientX - p.x0
        let dy = e.clientY - p.y0
        if (!p.live && Math.hypot(dx, dy) < THRESHOLD) return
        if (e.shiftKey && Math.abs(dx) > Math.abs(dy)) dy = 0
        else if (e.shiftKey) dx = 0
        p.live = true
        p.dx = dx
        p.dy = dy
        // Live preview only: endPosition puts the originals back and records the edit once.
        suppress(() => {
          const st = p.el.style
          if (p.base.wasStatic)
            st.setProperty("position", "relative", "important")
          st.setProperty("left", px(p.base.left + dx), "important")
          st.setProperty("top", px(p.base.top + dy), "important")
        })
        return
      }
      const d = draw
      if (d && e.pointerId === d.id) {
        swallow(e)
        if (e.buttons === 0) return endDraw(false)
        d.x = e.clientX
        d.y = e.clientY
        d.band.hidden = false
        d.band.style.left = `${Math.min(d.x0, d.x)}px`
        d.band.style.top = `${Math.min(d.y0, d.y)}px`
        d.band.style.width = `${Math.abs(d.x - d.x0)}px`
        d.band.style.height = `${Math.abs(d.y - d.y0)}px`
      }
    })

    on("pointerup", (e) => {
      swallow(e) // every pointerdown was swallowed: the page must not see a lone pointerup
      if (pos && e.pointerId === pos.id) endPosition(true)
      else if (draw && e.pointerId === draw.id) {
        draw.x = e.clientX
        draw.y = e.clientY
        endDraw(true)
      }
    })
    on("pointercancel", () => {
      endPosition(false)
      endDraw(false)
    })

    // Last: swallow() stops propagation, so the handlers above must be registered before these.
    for (const t of SWALLOWED) on(t, swallow)

    on("keydown", (e) => {
      if (isOurs(e.target) || e.isComposing) return
      if (e.key === "Escape" && (pos || draw)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        endPosition(false)
        endDraw(false)
        return
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const a = arrows[e.key]
      const el = opts.getSelected()
      if (!a || !el || mode !== "position" || pos) return
      // Typing in a page field must keep its caret keys.
      const t = e.target as HTMLElement | null
      if (
        t?.isContentEditable ||
        /^(input|textarea|select)$/i.test(t?.localName ?? "")
      )
        return
      e.preventDefault()
      e.stopImmediatePropagation()
      const k = e.shiftKey ? 10 : 1
      nudge(el, a[0] * k, a[1] * k)
    })
  }

  function detach() {
    endPosition(false)
    endDraw(false)
    for (const off of offs) off()
    offs = []
  }

  return {
    setMode(next) {
      const was = mode === "position" || mode === "draw"
      const is = next === "position" || next === "draw"
      mode = next
      if (is && !was) attach()
      else if (!is && was) detach()
      else if (is) {
        endPosition(false)
        endDraw(false)
      }
    },
    setTool: (t) => void (tool = t),
    destroy() {
      detach()
      mode = "browse"
    },
  }
}
