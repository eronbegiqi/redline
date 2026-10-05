import { afterEach, describe, expect, it, vi } from "vitest"

import { copyText, createHostStore } from "@/panel/bridge"
import { createMockStore } from "@/panel/dev-mock"
import type { PanelState } from "@/shared/types"

const state = createMockStore("empty").get().state as PanelState

/** A stand-in for `window` whose "message" events carry whatever data/ports we choose. */
function fakeWindow() {
  const target = new EventTarget()
  const parent = {}
  const post = (data: unknown, port?: MessagePort, source: unknown = parent) =>
    target.dispatchEvent(
      Object.assign(new Event("message"), {
        data,
        ports: port ? [port] : [],
        source,
      })
    )
  return { win: target, post, parent }
}

const channels: MessageChannel[] = []
function channel() {
  const ch = new MessageChannel()
  channels.push(ch)
  return ch
}
afterEach(() => {
  channels.splice(0).forEach((c) => (c.port1.close(), c.port2.close()))
})

describe("createHostStore", () => {
  it("stays disconnected and send is a no-op until init arrives", () => {
    const { win, parent } = fakeWindow()
    const store = createHostStore(win, parent)
    expect(store.get()).toEqual({ state: null, connected: false })
    expect(() => store.send({ type: "close" })).not.toThrow()
  })

  it("answers init with ready, then exposes pushed state and forwards send()", async () => {
    const { win, post, parent } = fakeWindow()
    const ch = channel()
    const got: unknown[] = []
    ch.port1.onmessage = (e) => got.push(e.data)
    const store = createHostStore(win, parent)
    const onChange = vi.fn()
    store.subscribe(onChange)

    post({ redline: "init" }, ch.port2)
    expect(store.get().connected).toBe(true)
    await vi.waitFor(() => expect(got).toEqual([{ type: "ready" }]))

    ch.port1.postMessage({ type: "state", state })
    await vi.waitFor(() => expect(store.get().state).toEqual(state))
    expect(onChange).toHaveBeenCalled()

    store.send({ type: "setStyle", el: "e1", prop: "color", value: "red" })
    await vi.waitFor(() =>
      expect(got).toContainEqual({
        type: "setStyle",
        el: "e1",
        prop: "color",
        value: "red",
      })
    )
  })

  it("keeps the same snapshot object until something changes", () => {
    const { win, parent } = fakeWindow()
    const store = createHostStore(win, parent)
    expect(store.get()).toBe(store.get())
  })

  it("ignores messages that are not init or carry no port", () => {
    const { win, post, parent } = fakeWindow()
    const store = createHostStore(win, parent)
    post({ redline: "init" }) // no port
    post({ something: "else" }, channel().port2)
    post(null, channel().port2)
    expect(store.get().connected).toBe(false)
  })

  it("accepts the first init only", async () => {
    const { win, post, parent } = fakeWindow()
    const first = channel()
    const second = channel()
    const store = createHostStore(win, parent)
    post({ redline: "init" }, first.port2)
    post({ redline: "init" }, second.port2)

    second.port1.postMessage({ type: "state", state })
    first.port1.postMessage({
      type: "state",
      state: { ...state, mode: "browse" },
    })
    await vi.waitFor(() => expect(store.get().state?.mode).toBe("browse"))
    await new Promise((r) => setTimeout(r, 20))
    expect(store.get().state?.mode).toBe("browse")
  })
})

describe("createHostStore: init source", () => {
  it("ignores an init that does not come from the embedding window, and still accepts the real one after", async () => {
    const { win, post, parent } = fakeWindow()
    const store = createHostStore(win, parent)
    const evil = channel()
    post({ redline: "init" }, evil.port2, {}) // another window
    post({ redline: "init" }, evil.port2, null)
    expect(store.get().connected).toBe(false)

    const real = channel()
    post({ redline: "init" }, real.port2)
    expect(store.get().connected).toBe(true)
    real.port1.postMessage({ type: "state", state })
    await vi.waitFor(() => expect(store.get().state).toEqual(state))
  })
})

describe("copyText", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original)
    else Reflect.deleteProperty(navigator, "clipboard")
    Reflect.deleteProperty(document, "execCommand")
  })

  it("uses the async clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    expect(await copyText("hi")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hi")
  })

  it("falls back to execCommand and cleans up its textarea", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      configurable: true,
    })
    const exec = vi.fn(() => true)
    Object.defineProperty(document, "execCommand", {
      value: exec,
      configurable: true,
    })
    expect(await copyText("hi")).toBe(true)
    expect(exec).toHaveBeenCalledWith("copy")
    expect(document.querySelector("textarea")).toBeNull()
  })

  it("reports failure instead of throwing when nothing works", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    expect(await copyText("hi")).toBe(false)
  })
})
