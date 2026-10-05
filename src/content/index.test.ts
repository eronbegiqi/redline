import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ToContent, ToPanel } from "@/shared/protocol"
import { STYLE_PROPS, type PanelState } from "@/shared/types"

// Frame, selector, dragger and observer are other modules' business: fake them and drive the controller.
const h = vi.hoisted(() => {
  const host = document.createElement("div")
  const root = host.attachShadow({ mode: "open" })
  const frame = {
    host,
    root,
    post: vi.fn(),
    onMessage: vi.fn(),
    moveBy: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
  }
  const selector = {
    setMode: vi.fn(),
    select: vi.fn(),
    refresh: vi.fn(),
    destroy: vi.fn(),
  }
  const dragger = { setActive: vi.fn(), destroy: vi.fn() }
  return {
    frame,
    selector,
    dragger,
    createFrame: vi.fn(() => frame),
    createSelector: vi.fn<(o: unknown) => typeof selector>(() => selector),
    createDragger: vi.fn<(o: unknown) => typeof dragger>(() => dragger),
    startObserving: vi.fn(),
    stopObserving: vi.fn(),
  }
})
vi.mock("@/content/frame", () => ({ createFrame: h.createFrame }))
vi.mock("@/content/select", () => ({ createSelector: h.createSelector }))
vi.mock("@/content/drag", () => ({ createDragger: h.createDragger }))
vi.mock("@/content/observe", () => ({
  startObserving: h.startObserving,
  stopObserving: h.stopObserving,
}))

type G = typeof globalThis & {
  __redline?: { toggle(): void; destroy(): void }
}
const g = globalThis as G

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const send = (m: ToContent) => {
  const handler = h.frame.onMessage.mock.calls[0][0] as (m: ToContent) => void
  handler(m)
}
const posts = () => h.frame.post.mock.calls.map((c) => c[0] as ToPanel)
const last = (): PanelState => posts().at(-1)!.state
const selectorOpts = () =>
  h.createSelector.mock.calls[0][0] as {
    isOurs: (x: unknown) => boolean
    onSelect: (el: Element | null) => void
    onChanged: () => void
  }
const select = async (el: Element | null) => {
  selectorOpts().onSelect(el)
  await tick()
}
/** Id of what the panel currently shows as selected (what its edit messages carry). */
const selId = () => last().selection!.el
/** Id of any element, from the describe instance the controller under test uses. */
const idOf = async (el: Element) =>
  (await import("@/content/describe")).elementId(el)
const style = (el: string, prop: string, value: string): ToContent => ({
  type: "setStyle",
  el,
  prop,
  value,
})
const act = (
  el: string,
  action: Extract<ToContent, { type: "action" }>["action"]
): ToContent => ({ type: "action", el, action })

async function boot() {
  vi.resetModules()
  await import("@/content/index")
  return g.__redline!
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createSelector.mockImplementation(() => h.selector)
  document.title = "Fixture"
  document.body.innerHTML = `
    <main id="app">
      <h1 id="t">Hello</h1>
      <ul id="list"><li id="a">One</li><li id="b">Two</li></ul>
      <div id="box"><span id="inner">x</span><em id="inner2">y</em></div>
    </main>`
})

// Instances listen on the shared window: leaking one into the next test would double every push.
afterEach(() => {
  g.__redline?.destroy()
  delete g.__redline
})

describe("injection", () => {
  it("builds once and a second injection only toggles", async () => {
    await boot()
    expect(h.createFrame).toHaveBeenCalledTimes(1)
    expect(h.selector.setMode).toHaveBeenCalledWith("select")
    expect(h.dragger.setActive).toHaveBeenCalledWith(false)

    vi.resetModules()
    await import("@/content/index") // the same injection again
    expect(h.createFrame).toHaveBeenCalledTimes(1)
    expect(h.frame.hide).toHaveBeenCalledTimes(1)

    vi.resetModules()
    await import("@/content/index")
    expect(h.frame.show).toHaveBeenCalledTimes(1)
  })

  it("cleans up and does not register itself when construction fails", async () => {
    h.createSelector.mockImplementation(() => {
      throw new Error("not implemented")
    })
    vi.resetModules()
    await expect(import("@/content/index")).rejects.toThrow("not implemented")
    expect(h.frame.destroy).toHaveBeenCalled()
    expect(g.__redline).toBeUndefined()
  })

  it("hands the select/drag layers an isOurs that sees through the shadow root", async () => {
    await boot()
    const { isOurs } = selectorOpts()
    const inner = document.createElement("i")
    h.frame.root.append(inner)
    expect(isOurs(h.frame.host)).toBe(true)
    expect(isOurs(inner)).toBe(true)
    expect(isOurs($("#t"))).toBe(false)
    expect(isOurs(null)).toBe(false)
    expect(isOurs(window)).toBe(false)
  })
})

describe("state", () => {
  it("answers ready immediately with the initial state", async () => {
    await boot()
    expect(h.frame.post).not.toHaveBeenCalled()
    send({ type: "ready" })
    expect(h.frame.post).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject({
      mode: "select",
      recording: false,
      selection: null,
      changes: [],
      page: { url: location.href, title: "Fixture" },
    })
    expect(last().page.viewport.width).toBe(innerWidth)
  })

  it("describes the selection without sending nodes", async () => {
    await boot()
    await select($("#t"))
    const sel = last().selection!
    expect(sel).toMatchObject({
      descriptor: { tag: "h1", id: "t" },
      isTextLeaf: true,
      text: "Hello",
      hasParent: true,
      hasChild: false,
      canDelete: true,
    })
    expect(Object.keys(sel.styles)).toEqual([...STYLE_PROPS])
    expect(sel.rect).toEqual(
      expect.objectContaining({ width: expect.any(Number) })
    )
    expect(() => structuredClone(last())).not.toThrow()
  })

  it("flags containers, <body> and <html> correctly", async () => {
    await boot()
    await select($("#box"))
    expect(last().selection).toMatchObject({
      isTextLeaf: false,
      text: "",
      hasChild: true,
    })
    await select(document.body)
    expect(last().selection).toMatchObject({
      canDelete: false,
      hasParent: true,
    })
    await select(document.documentElement)
    expect(last().selection).toMatchObject({
      canDelete: false,
      hasParent: false,
    })
  })

  it("coalesces a burst into one state message", async () => {
    await boot()
    await select($("#t"))
    const el = selId()
    h.frame.post.mockClear()
    send(style(el, "color", "red"))
    send(style(el, "color", "blue"))
    selectorOpts().onChanged()
    await tick()
    expect(h.frame.post).toHaveBeenCalledTimes(1)
    expect(last().changes).toHaveLength(1)
  })

  it("keeps working when the selection removed from the DOM is detected", async () => {
    await boot()
    await select($("#a"))
    $("#a").remove()
    await vi.waitFor(() => expect(last().selection).toBeNull())
    expect(h.selector.select).toHaveBeenLastCalledWith(null)
  })

  it("pushes on window resize and stops after destroy", async () => {
    const r = await boot()
    window.dispatchEvent(new Event("resize"))
    await tick()
    expect(h.frame.post).toHaveBeenCalledTimes(1)
    r.destroy()
    h.frame.post.mockClear()
    window.dispatchEvent(new Event("resize"))
    await tick()
    expect(h.frame.post).not.toHaveBeenCalled()
  })
})

describe("edits", () => {
  it("setStyle applies to the selection, records it and refreshes the overlay", async () => {
    await boot()
    await select($("#t"))
    h.selector.refresh.mockClear()
    send(style(selId(), "color", "red"))
    await tick()
    expect($("#t").style.getPropertyValue("color")).toBe("red")
    expect(last().changes).toMatchObject([
      { kind: "style", prop: "color", after: "red", origin: "panel" },
    ])
    expect(h.selector.refresh).toHaveBeenCalled()
  })

  it("setStyle for an id nobody knows does nothing", async () => {
    await boot()
    send(style("e99999", "color", "red"))
    send({ type: "setText", el: "e99999", text: "x" })
    send(act("e99999", "delete"))
    await tick()
    expect(h.frame.post).not.toHaveBeenCalled()
    send({ type: "ready" })
    expect(last().changes).toEqual([])
  })

  it("setText replaces a text leaf but never wipes a container", async () => {
    await boot()
    await select($("#t"))
    send({ type: "setText", el: selId(), text: "Bye" })
    expect($("#t").textContent).toBe("Bye")
    await select($("#box"))
    send({ type: "setText", el: selId(), text: "oops" })
    expect($("#box").children).toHaveLength(2)
    await tick()
    expect(last().changes).toMatchObject([
      { kind: "text", before: "Hello", after: "Bye" },
    ])
  })

  it("parent / child / deselect move the selection", async () => {
    await boot()
    await select($("#box"))
    send(act(selId(), "child"))
    expect(h.selector.select).toHaveBeenLastCalledWith($("#inner"))
    await tick() // the panel learns the new selection (and its id) from the next state
    send(act(selId(), "parent"))
    expect(h.selector.select).toHaveBeenLastCalledWith($("#box"))
    await tick()
    expect(last().selection?.descriptor.id).toBe("box")
    send(act(selId(), "deselect"))
    await tick()
    expect(last().selection).toBeNull()
    expect(h.selector.select).toHaveBeenLastCalledWith(null)
  })

  it("child skips our own host", async () => {
    await boot()
    document.documentElement.append(h.frame.host)
    const html = document.documentElement
    await select(html)
    send(act(selId(), "child"))
    expect(h.selector.select).toHaveBeenLastCalledWith(document.head)
    h.frame.host.remove()
  })

  it("delete removes the element and selects its parent", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "delete"))
    await tick()
    expect($("#a")).toBeNull()
    expect(last().selection?.descriptor.id).toBe("list")
    expect(last().changes).toMatchObject([{ kind: "delete" }])
  })

  it("refuses to delete <body>", async () => {
    await boot()
    await select(document.body)
    send(act(selId(), "delete"))
    await tick()
    expect(document.body.isConnected).toBe(true)
    expect(last().changes).toEqual([])
  })

  it("refuses to hide or duplicate <html> and <body> too, as the panel's disabled buttons promise", async () => {
    await boot()
    for (const root of [document.body, document.documentElement]) {
      await select(root)
      expect(last().selection?.canDelete).toBe(false)
      send(act(selId(), "hide"))
      send(act(selId(), "duplicate"))
      await tick()
      expect(last().changes).toEqual([])
      expect(root.getAttribute("style")).toBeNull()
    }
    expect(document.querySelectorAll("body")).toHaveLength(1)
  })

  it("canDelete / hasParent follow what the actions can really do for a shadow-root child", async () => {
    await boot()
    const shadow = $("#box").attachShadow({ mode: "open" })
    const span = document.createElement("span")
    span.textContent = "in shadow"
    shadow.append(span)
    await select(span)
    expect(last().selection).toMatchObject({
      canDelete: true,
      hasParent: false,
    })
    send(act(selId(), "parent")) // nothing to select
    send(act(selId(), "delete"))
    await tick()
    expect(span.isConnected).toBe(false)
    expect(last().changes).toMatchObject([{ kind: "delete" }])
    expect(last().selection).toBeNull() // no parent element to fall back to
  })

  it("hide records display:none and keeps the selection", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "hide"))
    await tick()
    expect($("#a").style.getPropertyValue("display")).toBe("none")
    expect(last().changes).toMatchObject([
      { kind: "style", prop: "display", after: "none" },
    ])
    expect(last().selection?.descriptor.id).toBe("a")
  })

  it("duplicate inserts a clone and selects it", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "duplicate"))
    await tick()
    const clone = $("#a").nextElementSibling!
    expect(clone.tagName).toBe("LI")
    expect(h.selector.select).toHaveBeenLastCalledWith(clone)
    expect(last().changes).toMatchObject([{ kind: "insert" }])
    expect(last().selection?.el).not.toBeUndefined()
  })

  it("a drop selects the moved element", async () => {
    await boot()
    const opts = h.createDragger.mock.calls[0][0] as {
      onMoved: (el: Element) => void
    }
    opts.onMoved($("#b"))
    await tick()
    expect(h.selector.select).toHaveBeenLastCalledWith($("#b"))
    expect(last().selection?.descriptor.id).toBe("b")
  })
})

// The panel debounces text edits and commits inputs on blur, and the page swallows the click that selects
// another element: so an edit routinely arrives after the selection has moved on.
describe("late messages", () => {
  async function twoSelections() {
    await boot()
    await select($("#a"))
    const a = selId()
    await select($("#b"))
    h.selector.select.mockClear()
    return a
  }

  it("setStyle for the previous element lands on it, not on the new selection", async () => {
    const a = await twoSelections()
    send(style(a, "color", "red"))
    await tick()
    expect($("#a").style.getPropertyValue("color")).toBe("red")
    expect($("#b").style.getPropertyValue("color")).toBe("")
    expect(last().changes).toMatchObject([
      { kind: "style", el: a, prop: "color", after: "red" },
    ])
    expect(last().selection?.descriptor.id).toBe("b")
  })

  it("setText for the previous element lands on it, not on the new selection", async () => {
    const a = await twoSelections()
    send({ type: "setText", el: a, text: "late draft" })
    await tick()
    expect($("#a").textContent).toBe("late draft")
    expect($("#b").textContent).toBe("Two")
    expect(last().changes).toMatchObject([{ kind: "text", el: a }])
    expect(last().selection?.descriptor.id).toBe("b")
  })

  it("hide / duplicate / delete act on the named element and leave the selection alone", async () => {
    const a = await twoSelections()
    send(act(a, "hide"))
    expect($("#a").style.getPropertyValue("display")).toBe("none")
    send(act(a, "duplicate"))
    expect($("#a").nextElementSibling?.tagName).toBe("LI")
    expect($("#a").nextElementSibling?.id).toBe("") // the clone has no id: #b is the one after it
    send(act(a, "delete"))
    await tick()
    expect($("#a")).toBeNull()
    expect(h.selector.select).not.toHaveBeenCalled()
    expect(last().selection?.descriptor.id).toBe("b")
  })

  it("parent / child / deselect for the previous element do not move the selection", async () => {
    const a = await twoSelections()
    send(act(a, "parent"))
    send(act(a, "child"))
    send(act(a, "deselect"))
    await tick()
    expect(h.selector.select).not.toHaveBeenCalled()
    expect(last().selection?.descriptor.id).toBe("b")
  })

  it("deleting a selected element selects its parent, and only then", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "delete"))
    expect(h.selector.select).toHaveBeenLastCalledWith($("#list"))
  })

  it("duplicating a selected element selects the clone, but not when it is not the selection", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "duplicate"))
    const clone = $("#a").nextElementSibling!
    expect(h.selector.select).toHaveBeenLastCalledWith(clone)
    await select($("#t"))
    h.selector.select.mockClear()
    send(act(await idOf($("#a")), "duplicate"))
    expect(h.selector.select).not.toHaveBeenCalled()
    await tick()
    expect(last().selection?.descriptor.id).toBe("t")
  })

  it("a message for an element that left the page is dropped", async () => {
    await boot()
    await select($("#a"))
    const a = selId()
    const li = $("#a")
    li.remove()
    send(style(a, "color", "red"))
    send({ type: "setText", el: a, text: "ghost" })
    send(act(a, "duplicate"))
    await tick()
    expect(li.style.getPropertyValue("color")).toBe("")
    expect(li.textContent).toBe("One")
    expect(last().changes).toEqual([])
    expect(document.querySelectorAll("#list li")).toHaveLength(1)
  })
})

describe("the selected element is removed by the page", () => {
  it("never builds the ElementInfo of a detached element", async () => {
    await boot()
    await select($("#a"))
    const li = $("#a")
    const styles = vi.spyOn(window, "getComputedStyle")
    li.remove()
    send({ type: "ready" }) // synchronous: no mutation microtask has run yet
    expect(last().selection).toBeNull()
    expect(styles.mock.calls.map((c) => c[0])).not.toContain(li)
    styles.mockRestore()
  })

  it("close hides the panel and toggle brings it back", async () => {
    const r = await boot()
    await select($("#a"))
    $("#a").remove()
    send({ type: "close" })
    expect(h.frame.hide).toHaveBeenCalledTimes(1)
    expect(h.selector.setMode).toHaveBeenLastCalledWith("browse")
    await tick()
    expect(last()).toMatchObject({ mode: "browse", selection: null })

    r.toggle()
    expect(h.frame.show).toHaveBeenCalledTimes(1)
    await tick()
    expect(last()).toMatchObject({ mode: "select", selection: null })
    r.toggle()
    expect(h.frame.hide).toHaveBeenCalledTimes(2)
  })

  it("close hides the panel even when a layer throws while handling it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const r = await boot()
    await select($("#a"))
    $("#a").remove()
    h.selector.setMode.mockImplementationOnce(() => {
      throw new Error("layer blew up")
    })
    send({ type: "close" })
    expect(h.frame.hide).toHaveBeenCalledTimes(1)
    r.toggle() // visible is false now: this re-opens instead of "closing twice"
    expect(h.frame.show).toHaveBeenCalledTimes(1)
  })

  it("still tells the panel about an edit when the overlay refresh throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    await boot()
    await select($("#t"))
    h.selector.refresh.mockImplementationOnce(() => {
      throw new Error("boom")
    })
    send(style(selId(), "color", "red"))
    await tick()
    expect(last().changes).toHaveLength(1)
  })
})

describe("class count", () => {
  it("reports every class even though the descriptor keeps 8", async () => {
    await boot()
    $("#t").className = "a b c d e f g h i j"
    await select($("#t"))
    expect(last().selection?.descriptor.classes).toHaveLength(8)
    expect(last().selection?.classCount).toBe(10)
  })
})

describe("undo / revert", () => {
  async function twoEdits() {
    await boot()
    await select($("#t"))
    send(style(selId(), "color", "red"))
    send({ type: "setText", el: selId(), text: "Bye" })
    await tick()
  }

  it("undo reverts the newest change in the DOM and the log", async () => {
    await twoEdits()
    send({ type: "undo" })
    await tick()
    expect($("#t").textContent).toBe("Hello")
    expect($("#t").style.getPropertyValue("color")).toBe("red")
    expect(last().changes).toHaveLength(1)
  })

  it("revert by id and revertAll", async () => {
    await twoEdits()
    send({ type: "revert", id: last().changes[0].id })
    await tick()
    expect($("#t").style.getPropertyValue("color")).toBe("")
    send({ type: "revertAll" })
    await tick()
    expect($("#t").textContent).toBe("Hello")
    expect(last().changes).toEqual([])
  })

  it("reverting the duplicate that is selected clears the selection", async () => {
    await boot()
    await select($("#a"))
    send(act(selId(), "duplicate"))
    await tick()
    send({ type: "revertAll" })
    await tick()
    expect(document.querySelectorAll("#list li")).toHaveLength(2)
    expect(last().selection).toBeNull()
  })

  it("an unknown revert id is harmless", async () => {
    await twoEdits()
    send({ type: "revert", id: "nope" })
    await tick()
    expect(last().changes).toHaveLength(2)
  })
})

describe("modes, recording, close", () => {
  it("wires each mode to the right layer", async () => {
    await boot()
    send({ type: "setMode", mode: "move" })
    expect(h.selector.setMode).toHaveBeenLastCalledWith("move")
    expect(h.dragger.setActive).toHaveBeenLastCalledWith(true)
    send({ type: "setMode", mode: "browse" })
    expect(h.selector.setMode).toHaveBeenLastCalledWith("browse")
    expect(h.dragger.setActive).toHaveBeenLastCalledWith(false)
    send({ type: "setMode", mode: "select" })
    expect(h.dragger.setActive).toHaveBeenLastCalledWith(false)
    await tick()
    expect(last().mode).toBe("select")
  })

  it("ignores an invalid mode", async () => {
    await boot()
    h.selector.setMode.mockClear()
    send({ type: "setMode", mode: "nope" as never })
    expect(h.selector.setMode).not.toHaveBeenCalled()
  })

  it("setRecording starts / stops the observer with an ignore() for our own UI", async () => {
    await boot()
    send({ type: "setRecording", on: true })
    expect(h.startObserving).toHaveBeenCalledTimes(1)
    const ignore = h.startObserving.mock.calls[0][1] as (n: Node) => boolean
    expect(ignore(h.frame.host)).toBe(true)
    expect(ignore($("#t"))).toBe(false)
    await tick()
    expect(last().recording).toBe(true)
    send({ type: "setRecording", on: false })
    expect(h.stopObserving).toHaveBeenCalled()
    await tick()
    expect(last().recording).toBe(false)
  })

  it("close hides, goes to browse and stops the observer; toggle restores everything", async () => {
    const r = await boot()
    send({ type: "setMode", mode: "move" })
    send({ type: "setRecording", on: true })
    h.startObserving.mockClear()
    h.stopObserving.mockClear()

    send({ type: "close" })
    expect(h.frame.hide).toHaveBeenCalledTimes(1)
    expect(h.selector.setMode).toHaveBeenLastCalledWith("browse")
    expect(h.dragger.setActive).toHaveBeenLastCalledWith(false)
    expect(h.stopObserving).toHaveBeenCalled()
    await tick()
    expect(last()).toMatchObject({ mode: "browse", recording: true })

    r.toggle()
    expect(h.frame.show).toHaveBeenCalledTimes(1)
    expect(h.selector.setMode).toHaveBeenLastCalledWith("move")
    expect(h.dragger.setActive).toHaveBeenLastCalledWith(true)
    expect(h.startObserving).toHaveBeenCalledTimes(1)
    await tick()
    expect(last().mode).toBe("move")
  })

  it("does not start the observer on re-open when recording was off", async () => {
    const r = await boot()
    send({ type: "close" })
    r.toggle()
    expect(h.startObserving).not.toHaveBeenCalled()
  })

  it("setRecording while closed does not start the observer until re-open", async () => {
    const r = await boot()
    send({ type: "close" })
    send({ type: "setRecording", on: true })
    expect(h.startObserving).not.toHaveBeenCalled()
    r.toggle()
    expect(h.startObserving).toHaveBeenCalledTimes(1)
  })

  it("toggle while visible closes", async () => {
    const r = await boot()
    r.toggle()
    expect(h.frame.hide).toHaveBeenCalledTimes(1)
  })

  it("moveFrame goes to the frame", async () => {
    await boot()
    send({ type: "moveFrame", dx: 3, dy: -4 })
    expect(h.frame.moveBy).toHaveBeenCalledWith(3, -4)
  })
})

describe("destroy", () => {
  it("tears everything down once and frees the global", async () => {
    const r = await boot()
    await select($("#t"))
    r.destroy()
    expect(h.frame.destroy).toHaveBeenCalledTimes(1)
    expect(h.selector.destroy).toHaveBeenCalledTimes(1)
    expect(h.dragger.destroy).toHaveBeenCalledTimes(1)
    expect(h.stopObserving).toHaveBeenCalled()
    expect(g.__redline).toBeUndefined()

    h.frame.post.mockClear()
    selectorOpts().onSelect($("#a"))
    $("#a").remove()
    await tick()
    expect(h.frame.post).not.toHaveBeenCalled()
  })

  it("a message handler error never escapes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    await boot()
    h.selector.refresh.mockImplementation(() => {
      throw new Error("boom")
    })
    expect(() => send({ type: "undo" })).not.toThrow()
    h.selector.refresh.mockReset()
  })
})
