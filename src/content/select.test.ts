import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"
import { Recorder } from "@/shared/recorder"
import { startObserving, stopObserving } from "./observe"
import {
  clipRect,
  createSelector,
  inertAt,
  isTextLeaf,
  labelFor,
  nextSize,
  type SelectorApi,
} from "./select"

// jsdom has no layout, so boxes/handles/resize drags are verified in real Chromium (see the select-layer
// harness notes in the PR). Here: the pure helpers plus the event wiring that does not need geometry.

describe("nextSize", () => {
  const start = { w: 200, h: 100 }
  const both = { x: true, y: true }
  it("changes only the dragged axes", () => {
    expect(nextSize(start, 30, 99, { x: true, y: false }, false)).toEqual({
      w: 230,
      h: 100,
    })
    expect(nextSize(start, 99, 20, { x: false, y: true }, false)).toEqual({
      w: 200,
      h: 120,
    })
  })
  it("clamps dragged axes to the minimum but never touches an undragged one", () => {
    expect(nextSize(start, -500, -500, both, false)).toEqual({ w: 8, h: 8 })
    expect(
      nextSize({ w: 200, h: 4 }, 10, 0, { x: true, y: false }, false)
    ).toEqual({ w: 210, h: 4 })
  })
  it("keeps the aspect ratio on the corner with shift (larger relative change wins)", () => {
    expect(nextSize(start, 100, 0, both, true)).toEqual({ w: 300, h: 150 })
    expect(nextSize(start, 0, 100, both, true)).toEqual({ w: 400, h: 200 })
  })
  it("ignores shift on an edge handle", () => {
    expect(nextSize(start, 50, 50, { x: true, y: false }, true)).toEqual({
      w: 250,
      h: 100,
    })
  })
})

describe("labelFor", () => {
  const el = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as Element
  }
  it("tag#id.classes, at most two classes", () => {
    expect(labelFor(el('<button id="cta" class="a b c">x</button>'))).toBe(
      "button#cta.a.b"
    )
    expect(labelFor(el("<p>x</p>"))).toBe("p")
  })
  it("caps the length", () => {
    const long = labelFor(el(`<div class="${"x".repeat(80)}"></div>`))
    expect(long.length).toBe(40)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("isTextLeaf", () => {
  const el = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as Element
  }
  it("accepts text-only elements", () => {
    expect(isTextLeaf(el("<h1>Hello</h1>"))).toBe(true)
    expect(isTextLeaf(el("<button>Go</button>"))).toBe(true)
  })
  it("rejects mixed content, empty text, replaced elements and form fields", () => {
    expect(isTextLeaf(el("<p>a <b>b</b></p>"))).toBe(false)
    expect(isTextLeaf(el("<p>   </p>"))).toBe(false)
    expect(isTextLeaf(el("<img>"))).toBe(false)
    expect(isTextLeaf(el("<textarea>hi</textarea>"))).toBe(false)
  })
  it("rejects an element with a comment child (setText would drop it)", () => {
    expect(isTextLeaf(el("<p>a<!-- c --></p>"))).toBe(false)
  })
})

describe("createSelector wiring", () => {
  let host: HTMLElement
  let root: ShadowRoot
  let rec: Recorder
  let sel: SelectorApi
  let onSelect: Mock<(el: Element | null) => void>
  let onChanged: Mock<() => void>
  let pageClick: Mock<(e: Event) => void>
  let btn: HTMLElement

  const fire = (type: string, target: Element, init: EventInit = {}) => {
    const e = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    })
    target.dispatchEvent(e)
    return e
  }
  const click = (target: Element) => {
    for (const t of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ])
      fire(t, target)
  }
  const key = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    ;(document.activeElement ?? document.body).dispatchEvent(e)
    return e
  }

  beforeEach(() => {
    document.body.innerHTML =
      '<button id="b">Go</button><h1 id="h">Hello</h1><p id="m">a <b>b</b></p>'
    btn = document.getElementById("b")!
    host = document.createElement("div")
    root = host.attachShadow({ mode: "closed" })
    document.documentElement.append(host)
    rec = new Recorder()
    onSelect = vi.fn()
    onChanged = vi.fn()
    pageClick = vi.fn()
    document.addEventListener("click", pageClick)
    btn.addEventListener("click", pageClick)
    sel = createSelector({
      root,
      isOurs: (n) =>
        !!n && (n === host || (n as Node).getRootNode?.() === root),
      rec,
      onSelect,
      onChanged,
    })
  })
  afterEach(() => {
    sel.destroy()
    document.removeEventListener("click", pageClick)
    host.remove()
  })

  it("selects on pointerdown and hides the whole click from the page", () => {
    click(btn)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(btn)
    expect(pageClick).not.toHaveBeenCalled()
  })

  it("cancels the default action of click (links, submits)", () => {
    expect(fire("click", btn).defaultPrevented).toBe(true)
    expect(fire("submit", btn).defaultPrevented).toBe(true)
    // pointerdown stays uncancelled: cancelling it would also cancel the mousedown whose default we want to stop
    expect(fire("pointerdown", btn).defaultPrevented).toBe(false)
    expect(fire("mousedown", btn).defaultPrevented).toBe(true)
  })

  it("notifies once for repeated clicks on the same element; empty space deselects", () => {
    click(btn)
    click(btn)
    expect(onSelect).toHaveBeenCalledTimes(1)
    click(document.body)
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("does not touch events aimed at our own UI", () => {
    const ours = document.createElement("div")
    root.append(ours)
    const spy = vi.fn()
    window.addEventListener("click", spy)
    click(ours)
    window.removeEventListener("click", spy)
    expect(onSelect).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
  })

  it("select() draws without calling onSelect, Esc deselects through onSelect", () => {
    sel.select(btn)
    expect(onSelect).not.toHaveBeenCalled()
    const e = key("Escape")
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(e.defaultPrevented).toBe(true)
  })

  it("Esc with nothing selected is left to the page", () => {
    expect(key("Escape").defaultPrevented).toBe(false)
  })

  it("move/browse mode swallow nothing; select mode again does", () => {
    for (const m of ["move", "browse"] as const) {
      sel.setMode(m)
      click(btn)
      expect(pageClick).toHaveBeenCalledTimes(2) // the button's own listener + the document's
      pageClick.mockClear()
      expect(onSelect).not.toHaveBeenCalled()
    }
    sel.setMode("select")
    click(btn)
    expect(pageClick).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("a throwing onSelect never escapes into the page", () => {
    onSelect.mockImplementation(() => {
      throw new Error("controller bug")
    })
    expect(() => click(btn)).not.toThrow()
  })

  it("dblclick on a text leaf edits: Enter commits one text change, Shift+Enter does not", () => {
    const h = document.getElementById("h")!
    click(h)
    fire("dblclick", h)
    expect(h.getAttribute("contenteditable")).toBe("plaintext-only")
    h.firstChild!.nodeValue = "Hello there" // what the browser does while typing
    expect(key("Enter", { shiftKey: true }).defaultPrevented).toBe(false)
    expect(h.hasAttribute("contenteditable")).toBe(true)
    key("Enter")
    expect(h.hasAttribute("contenteditable")).toBe(false)
    expect(rec.list()).toMatchObject([
      {
        kind: "text",
        before: "Hello",
        after: "Hello there",
        target: { text: "Hello" },
      },
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("Esc cancels the edit and puts the very same text node back", () => {
    const h = document.getElementById("h")!
    const original = h.firstChild!
    fire("dblclick", h)
    h.firstChild!.nodeValue = "typed"
    h.replaceChildren(document.createTextNode("typed more")) // the browser may also replace nodes
    key("Escape")
    expect(h.textContent).toBe("Hello")
    expect(h.firstChild).toBe(original)
    expect(h.hasAttribute("contenteditable")).toBe(false)
    expect(rec.list()).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("restores a previous contenteditable value and records nothing for an unchanged edit", () => {
    const h = document.getElementById("h")!
    h.setAttribute("contenteditable", "false")
    fire("dblclick", h)
    key("Enter")
    expect(h.getAttribute("contenteditable")).toBe("false")
    expect(rec.list()).toEqual([])
  })

  it("dblclick on mixed content does nothing", () => {
    const m = document.getElementById("m")!
    fire("dblclick", m)
    expect(m.hasAttribute("contenteditable")).toBe(false)
  })

  it("while editing, clicks inside the element are hidden from the page but not cancelled; mousedown stays cancellable by the browser", () => {
    const h = document.getElementById("h")!
    const seen = vi.fn()
    h.addEventListener("mousedown", seen)
    h.addEventListener("click", seen)
    fire("dblclick", h)
    expect(fire("mousedown", h).defaultPrevented).toBe(false)
    expect(fire("click", h).defaultPrevented).toBe(true)
    expect(seen).not.toHaveBeenCalled()
  })

  it("marks the element data-redline-editing while editing and removes the marker on commit, cancel and destroy", () => {
    const h = document.getElementById("h")!
    fire("dblclick", h)
    expect(h.hasAttribute("data-redline-editing")).toBe(true)
    key("Enter")
    expect(h.hasAttribute("data-redline-editing")).toBe(false)
    fire("dblclick", h)
    key("Escape")
    expect(h.hasAttribute("data-redline-editing")).toBe(false)
    fire("dblclick", h)
    sel.destroy()
    expect(h.hasAttribute("data-redline-editing")).toBe(false)
  })

  it("typing in the in-page editor is not ALSO recorded by the DevTools observer (recording on)", async () => {
    const devtools = new Recorder()
    startObserving(devtools, (n) => n === host || host.contains(n))
    try {
      const h = document.getElementById("h")!
      fire("dblclick", h)
      h.firstChild!.nodeValue = "Hel"
      h.textContent = "Typed" // the browser may replace the node
      h.append(document.createElement("br"))
      await new Promise<void>((r) => setTimeout(r, 0))
      key("Enter")
      await new Promise<void>((r) => setTimeout(r, 0))
      expect(devtools.list()).toEqual([])
      expect(rec.list()).toMatchObject([{ kind: "text", origin: "panel" }])
    } finally {
      stopObserving()
    }
  })

  it("destroy removes the overlay and every listener", () => {
    expect(root.querySelector(".layer")).not.toBeNull()
    sel.destroy()
    expect(root.querySelector(".layer")).toBeNull()
    click(btn)
    expect(pageClick).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
    expect(() => {
      sel.destroy()
      sel.select(btn)
      sel.setMode("select")
      sel.refresh()
    }).not.toThrow()
  })

  it("destroy mid-edit cancels it", () => {
    const h = document.getElementById("h")!
    fire("dblclick", h)
    h.firstChild!.nodeValue = "half typed"
    sel.destroy()
    expect(h.textContent).toBe("Hello")
    expect(h.hasAttribute("contenteditable")).toBe(false)
  })
})

// jsdom has no layout: give elements the geometry a browser would report. Real-Chromium checks cover the integration.
const box = (
  el: Element,
  l: number,
  t: number,
  w: number,
  h: number,
  client = { w, h }
) => {
  el.getBoundingClientRect = () =>
    ({
      left: l,
      top: t,
      right: l + w,
      bottom: t + h,
      width: w,
      height: h,
      x: l,
      y: t,
      toJSON() {},
    }) as DOMRect
  Object.defineProperty(el, "clientWidth", {
    value: client.w,
    configurable: true,
  })
  Object.defineProperty(el, "clientHeight", {
    value: client.h,
    configurable: true,
  })
}

describe("clipRect", () => {
  const setup = (inner = "") => {
    document.body.innerHTML = `<div id="s" style="overflow-y:auto;overflow-x:hidden"><div id="w">${inner}<p id="t">x</p></div></div>`
    return {
      s: document.getElementById("s")!,
      t: document.getElementById("t")!,
    }
  }
  it("is null when no ancestor clips", () => {
    document.body.innerHTML = "<div><p id='t'>x</p></div>"
    expect(clipRect(document.getElementById("t")!)).toBeNull()
  })
  it("is the scroller's padding box (inside border and scrollbar)", () => {
    const { s, t } = setup()
    box(s, 100, 50, 210, 110, { w: 200, h: 100 })
    Object.defineProperty(s, "clientLeft", { value: 3, configurable: true })
    Object.defineProperty(s, "clientTop", { value: 4, configurable: true })
    expect(clipRect(t)).toEqual({ l: 103, t: 54, r: 303, b: 154 })
  })
  it("intersects nested clipping ancestors", () => {
    document.body.innerHTML = `<div id="a" style="overflow-x:hidden;overflow-y:hidden"><div id="b" style="overflow-x:hidden;overflow-y:hidden"><p id="t">x</p></div></div>`
    box(document.getElementById("a")!, 0, 0, 100, 100)
    box(document.getElementById("b")!, 50, 20, 100, 100)
    expect(clipRect(document.getElementById("t")!)).toEqual({
      l: 50,
      t: 20,
      r: 100,
      b: 100,
    })
  })
  it("a fixed element is not clipped; an absolute one skips non-positioned clippers only", () => {
    document.body.innerHTML = `<div id="s" style="overflow-x:hidden;overflow-y:hidden"><p id="f" style="position:fixed">x</p><p id="a" style="position:absolute">y</p></div>`
    const s = document.getElementById("s")!
    box(s, 0, 0, 10, 10)
    expect(clipRect(document.getElementById("f")!)).toBeNull()
    expect(clipRect(document.getElementById("a")!)).toBeNull()
    s.style.position = "relative"
    expect(clipRect(document.getElementById("a")!)).toEqual({
      l: 0,
      t: 0,
      r: 10,
      b: 10,
    })
  })
})

describe("inertAt", () => {
  it("returns the innermost inert descendant under the point, and only when the hit element contains the inert root", () => {
    document.body.innerHTML = `<main id="m"><div id="i" inert><p id="p1">a</p><p id="p2">b</p></div></main><aside id="modal"></aside>`
    const g = (id: string) => document.getElementById(id)!
    box(g("i"), 0, 0, 100, 100)
    box(g("p1"), 0, 0, 100, 20)
    box(g("p2"), 0, 20, 100, 20)
    expect(inertAt(g("m"), 10, 30)).toBe(g("p2"))
    expect(inertAt(g("m"), 10, 5)).toBe(g("p1"))
    expect(inertAt(g("m"), 10, 90)).toBe(g("i")) // inside the root, over no child
    expect(inertAt(g("m"), 200, 5)).toBeNull() // outside the root
    expect(inertAt(g("modal"), 10, 5)).toBeNull() // a modal drawn over the inert page
    expect(inertAt(null, 0, 0)).toBeNull()
  })
})
