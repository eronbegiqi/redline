import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createFrame, type Frame } from "@/content/frame"

const ID = "abc123"
const ORIGIN = `chrome-extension://${ID}`
// Like use_dynamic_url: the URL's host is an alias, the real origin is chrome.runtime.id.
const ALIAS = "chrome-extension://dynamic-alias-guid"
let frame: Frame | null = null

beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: { id: ID, getURL: (p: string) => `${ALIAS}/${p}` },
  })
  Object.defineProperty(window, "innerWidth", {
    value: 1000,
    configurable: true,
  })
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  })
})
afterEach(() => {
  frame?.destroy()
  frame = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

const make = () => (frame = createFrame())
const iframeOf = (f: Frame) => f.root.querySelector("iframe")!
const box = (f: Frame) => {
  const s = iframeOf(f).style
  return {
    x: parseFloat(s.left),
    y: parseFloat(s.top),
    w: parseFloat(s.width),
    h: parseFloat(s.height),
  }
}

/** Fires `load` with a fake contentWindow and hands back what the frame posted to it. */
function handshake(f: Frame) {
  const postMessage = vi.fn()
  const el = iframeOf(f)
  Object.defineProperty(el, "contentWindow", {
    value: { postMessage },
    configurable: true,
  })
  el.dispatchEvent(new Event("load"))
  return postMessage
}

describe("createFrame", () => {
  it("appends a closed-shadow host to <html> with the panel iframe inside", () => {
    const f = make()
    expect(f.host.parentElement).toBe(document.documentElement)
    expect(f.host.hasAttribute("data-redline-host")).toBe(true)
    expect(f.host.shadowRoot).toBeNull() // closed: the page cannot reach in
    const el = iframeOf(f)
    expect(el.getAttribute("src")).toBe(`${ALIAS}/panel.html`)
    expect(el.getAttribute("allow")).toBe(`clipboard-write ${ORIGIN}`)
  })

  it("sits bottom-right at 360 x min(640, vh - 32) with a 16px margin", () => {
    const f = make()
    expect(box(f)).toEqual({
      x: 1000 - 16 - 360,
      y: 800 - 16 - 640,
      w: 360,
      h: 640,
    })
  })

  it("shrinks on a short or narrow viewport", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      configurable: true,
    })
    Object.defineProperty(window, "innerWidth", {
      value: 300,
      configurable: true,
    })
    const f = make()
    expect(box(f)).toEqual({ x: 16, y: 16, w: 268, h: 468 })
  })

  it("removes a host left behind by an orphaned content script", () => {
    const stale = document.createElement("div")
    stale.setAttribute("data-redline-host", "")
    document.documentElement.append(stale)
    const f = make()
    expect(document.querySelectorAll("[data-redline-host]")).toHaveLength(1)
    expect(stale.isConnected).toBe(false)
    expect(f.host.isConnected).toBe(true)
  })

  it("show/hide toggle display without removing anything", () => {
    const f = make()
    f.hide()
    expect(f.host.style.getPropertyValue("display")).toBe("none")
    expect(f.host.isConnected).toBe(true)
    f.show()
    expect(f.host.style.getPropertyValue("display")).toBe("block")
  })

  it("destroy removes the host and the resize listener", () => {
    const f = make()
    const el = iframeOf(f)
    f.moveBy(-100, -100)
    f.destroy()
    expect(f.host.isConnected).toBe(false)
    const before = el.style.left
    Object.defineProperty(window, "innerWidth", {
      value: 400,
      configurable: true,
    })
    window.dispatchEvent(new Event("resize"))
    expect(el.style.left).toBe(before)
    f.destroy() // twice is fine
  })
})

describe("handshake", () => {
  it("posts {redline:'init'} with one port to the real extension origin (not the dynamic alias)", () => {
    const f = make()
    const post = handshake(f)
    expect(post).toHaveBeenCalledTimes(1)
    const [data, origin, transfer] = post.mock.calls[0]
    expect(data).toEqual({ redline: "init" })
    expect(origin).toBe(ORIGIN)
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBeInstanceOf(MessagePort)
  })

  it("sends state to the panel and forwards its messages, ignoring junk", async () => {
    const f = make()
    const got: unknown[] = []
    f.onMessage((m) => got.push(m))
    const post = handshake(f)
    const panel: MessagePort = post.mock.calls[0][2][0]

    const fromFrame = new Promise((r) => (panel.onmessage = (e) => r(e.data)))
    const state = { mode: "select" } as never
    f.post({ type: "state", state })
    expect(await fromFrame).toEqual({ type: "state", state })

    panel.postMessage({ type: "ready" })
    panel.postMessage("nope")
    panel.postMessage(null)
    panel.postMessage({ type: 5 })
    panel.postMessage({ type: "close" })
    await vi.waitFor(() => expect(got).toHaveLength(2))
    expect(got).toEqual([{ type: "ready" }, { type: "close" }])
    panel.close()
  })

  it("post before the handshake is a silent no-op", () => {
    const f = make()
    expect(() => f.post({ type: "state", state: {} as never })).not.toThrow()
  })

  it("a reload makes a fresh channel and closes the old one", async () => {
    const f = make()
    const got: unknown[] = []
    f.onMessage((m) => got.push(m))
    const first = handshake(f).mock.calls[0][2][0] as MessagePort
    const second = handshake(f).mock.calls[0][2][0] as MessagePort
    expect(second).not.toBe(first)
    second.postMessage({ type: "ready" })
    await vi.waitFor(() => expect(got).toEqual([{ type: "ready" }]))
    first.close()
    second.close()
  })

  it("a throwing listener does not starve the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const f = make()
    const got: unknown[] = []
    f.onMessage(() => {
      throw new Error("boom")
    })
    f.onMessage((m) => got.push(m))
    const panel = handshake(f).mock.calls[0][2][0] as MessagePort
    panel.postMessage({ type: "ready" })
    await vi.waitFor(() => expect(got).toHaveLength(1))
    panel.close()
  })
})

describe("moveBy", () => {
  it("moves by the delta", () => {
    const f = make()
    const b = box(f)
    f.moveBy(-50, -30)
    expect(box(f)).toMatchObject({ x: b.x - 50, y: b.y - 30 })
  })

  it("clamps inside the viewport on every side", () => {
    const f = make()
    f.moveBy(-5000, -5000)
    expect(box(f)).toMatchObject({ x: 0, y: 0 })
    f.moveBy(5000, 5000)
    expect(box(f)).toMatchObject({ x: 1000 - 360, y: 800 - 640 })
  })

  it("ignores non-finite deltas", () => {
    const f = make()
    const b = box(f)
    f.moveBy(NaN, 10)
    f.moveBy(5, Infinity)
    expect(box(f)).toEqual(b)
  })

  it("re-clamps a moved frame when the window shrinks, and keeps it inside", () => {
    const f = make()
    f.moveBy(5000, 5000) // far bottom-right
    Object.defineProperty(window, "innerWidth", {
      value: 600,
      configurable: true,
    })
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      configurable: true,
    })
    window.dispatchEvent(new Event("resize"))
    const b = box(f)
    expect(b).toEqual({ x: 600 - 360, y: 500 - 468, w: 360, h: 468 })
  })

  it("an unmoved frame stays anchored bottom-right across resizes", () => {
    const f = make()
    Object.defineProperty(window, "innerWidth", {
      value: 700,
      configurable: true,
    })
    window.dispatchEvent(new Event("resize"))
    expect(box(f)).toMatchObject({ x: 700 - 16 - 360, y: 800 - 16 - 640 })
  })

  it("re-clamps when shown after a resize while hidden", () => {
    const f = make()
    f.moveBy(5000, 5000)
    f.hide()
    Object.defineProperty(window, "innerWidth", {
      value: 500,
      configurable: true,
    })
    f.show()
    expect(box(f).x).toBe(500 - 360)
  })
})
