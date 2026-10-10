import { elementById } from "@/content/describe"
import type { Marker } from "@/shared/protocol"

// Numbered pins on the page for elements the user commented on. Lives in the frame's shadow root, never takes pointer events.
// shortcut: repositioned on scroll/resize/state pushes only, not on layout shifts; upgrade to a rAF loop if pins lag animated pages.

const PIN =
  "position:absolute;width:18px;height:18px;border-radius:9px;background:#5b4bff;color:#fff;" +
  "font:600 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.4)"

export interface MarkersApi {
  set(items: Marker[]): void
  refresh(): void
  setVisible(v: boolean): void
  destroy(): void
}

export function createMarkers(
  root: ShadowRoot,
  isOurs: (n: Node) => boolean
): MarkersApi {
  const layer = document.createElement("div")
  layer.setAttribute("aria-hidden", "true")
  layer.style.cssText =
    "position:fixed;inset:0;overflow:hidden;pointer-events:none"
  root.append(layer)
  let items: Marker[] = []
  let raf = 0

  const resolve = (m: Marker): Element | null => {
    let el = m.el ? elementById(m.el) : null
    if (!el?.isConnected) {
      try {
        el = document.querySelector(m.selector)
      } catch {
        el = null
      }
    }
    return el?.isConnected && !isOurs(el) ? el : null
  }

  const draw = () => {
    raf = 0
    layer.replaceChildren(
      ...items.flatMap((m) => {
        const r = resolve(m)?.getBoundingClientRect()
        if (!r || (!r.width && !r.height)) return []
        if (r.bottom < 0 || r.top > innerHeight) return []
        if (r.right < 0 || r.left > innerWidth) return []
        const pin = document.createElement("div")
        pin.style.cssText = `${PIN};left:${Math.min(Math.max(r.right - 9, 0), innerWidth - 18)}px;top:${Math.min(Math.max(r.top - 9, 0), innerHeight - 18)}px`
        pin.textContent = String(m.n)
        return [pin]
      })
    )
  }
  const refresh = () => void (raf ||= requestAnimationFrame(draw))
  addEventListener("scroll", refresh, { capture: true, passive: true })
  addEventListener("resize", refresh)

  return {
    set(next) {
      items = next
      refresh()
    },
    refresh,
    setVisible: (v) => void (layer.hidden = !v),
    destroy() {
      cancelAnimationFrame(raf)
      removeEventListener("scroll", refresh, { capture: true })
      removeEventListener("resize", refresh)
      layer.remove()
    },
  }
}
