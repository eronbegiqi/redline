import type { ToContent, ToPanel } from "@/shared/protocol"

// Shadow host + panel iframe + the MessageChannel to it. See docs/SPEC.md "Frame + controller".
// Everything here runs inside someone else's page: never throw, never leave listeners behind.

export interface Frame {
  /** The shadow host element appended to <html>. */
  host: HTMLElement
  root: ShadowRoot
  post(msg: ToPanel): void
  onMessage(cb: (m: ToContent) => void): void
  moveBy(dx: number, dy: number): void
  show(): void
  hide(): void
  destroy(): void
}

const HOST_ATTR = "data-redline-host"
const MARGIN = 16
const WIDTH = 360
const HEIGHT = 640

// The host is the only node page CSS can reach (the rest lives in a closed shadow root), so it is
// !important all the way. Zero-sized: it never intercepts page events; the overlay layers and the
// iframe are position:fixed children.
const HOST_CSS =
  "all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;" +
  "height:0!important;overflow:visible!important;z-index:2147483647!important;display:block!important"

// z-index keeps the panel above the select/drag overlay layers, which are appended after it.
const IFRAME_CSS =
  "position:fixed;z-index:1;box-sizing:border-box;border:1px solid rgba(128,128,128,.45);border-radius:12px;" +
  "box-shadow:0 8px 32px rgba(0,0,0,.28);color-scheme:normal"

/** Size of the area `position:fixed` boxes are laid out in (viewport minus classic scrollbars). */
function viewport() {
  // In quirks mode documentElement.clientHeight is the <html> box, not the viewport: body is.
  const el =
    document.compatMode === "BackCompat"
      ? document.body
      : document.documentElement
  return {
    w: el?.clientWidth || window.innerWidth,
    h: el?.clientHeight || window.innerHeight,
  }
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.round(Math.min(Math.max(n, lo), Math.max(lo, hi)))

export function createFrame(): Frame {
  // Anything already there belongs to an orphaned content script (extension reloaded): its iframe is dead.
  for (const old of document.querySelectorAll(`[${HOST_ATTR}]`)) old.remove()

  const src = chrome.runtime.getURL("panel.html")
  // The manifest uses use_dynamic_url: `src` carries a per-session alias host, but the document that loads has the
  // real extension origin, and postMessage to any other targetOrigin is silently dropped. chrome.runtime.id is that origin.
  const origin = `chrome-extension://${chrome.runtime.id}`

  const host = document.createElement("div")
  host.setAttribute(HOST_ATTR, "")
  host.style.cssText = HOST_CSS
  const root = host.attachShadow({ mode: "closed" })

  const iframe = document.createElement("iframe")
  iframe.src = src
  iframe.title = "Redline"
  iframe.setAttribute("allow", "clipboard-write")
  iframe.style.cssText = IFRAME_CSS

  let port: MessagePort | null = null
  const listeners = new Set<(m: ToContent) => void>()
  /** Where the user dragged the frame to; null = default bottom-right anchor. */
  let pos: { x: number; y: number } | null = null

  // Positioned from the viewport size instead of reading the iframe's box, so it works while hidden
  // and re-clamps in one place (init, drag, window resize).
  function layout() {
    const { w: vw, h: vh } = viewport()
    const w = Math.max(0, Math.min(WIDTH, vw - 2 * MARGIN))
    const h = Math.max(0, Math.min(HEIGHT, vh - 2 * MARGIN))
    const x = pos ? clamp(pos.x, 0, vw - w) : vw - MARGIN - w
    const y = pos ? clamp(pos.y, 0, vh - h) : vh - MARGIN - h
    if (pos) pos = { x, y }
    const s = iframe.style
    s.left = `${x}px`
    s.top = `${y}px`
    s.width = `${w}px`
    s.height = `${h}px`
  }

  // A fresh channel per load: if the iframe ever reloads, the old port is dead and the panel asks again.
  iframe.addEventListener("load", () => {
    try {
      port?.close()
      const ch = new MessageChannel()
      port = ch.port1
      port.onmessage = (e: MessageEvent) => {
        const m = e.data as ToContent | null
        if (!m || typeof m !== "object" || typeof m.type !== "string") return
        for (const cb of [...listeners]) {
          try {
            cb(m)
          } catch (err) {
            console.error("[redline]", err)
          }
        }
      }
      iframe.contentWindow?.postMessage({ redline: "init" }, origin, [ch.port2])
    } catch (err) {
      console.error("[redline]", err)
    }
  })

  window.addEventListener("resize", layout)
  layout()
  root.append(iframe)
  document.documentElement.append(host)

  return {
    host,
    root,
    post(msg) {
      try {
        port?.postMessage(msg)
      } catch (err) {
        console.error("[redline]", err) // DataCloneError: a non-serialisable value slipped into the state
      }
    },
    onMessage(cb) {
      listeners.add(cb)
    },
    moveBy(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
      const cur = pos ?? {
        x: parseFloat(iframe.style.left) || 0,
        y: parseFloat(iframe.style.top) || 0,
      }
      pos = { x: cur.x + dx, y: cur.y + dy }
      layout()
    },
    show() {
      host.style.setProperty("display", "block", "important")
      layout() // the window may have been resized while hidden
    },
    hide() {
      host.style.setProperty("display", "none", "important")
    },
    destroy() {
      window.removeEventListener("resize", layout)
      port?.close()
      port = null
      listeners.clear()
      host.remove()
    },
  }
}
