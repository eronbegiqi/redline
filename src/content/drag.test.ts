import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  axisOf,
  computePlacement,
  createDragger,
  edgeSpeed,
  isLegalContainer,
  lineFor,
  nearestChild,
  type DraggerApi,
  type Rect,
} from "@/content/drag"
import { Recorder } from "@/shared/recorder"

const R = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
})

describe("computePlacement", () => {
  const rect = R(100, 200, 100, 40)
  const at = (x: number, y: number, axis: "x" | "y", container = true) =>
    computePlacement({ rect, x, y, axis, container })

  it("y axis: outer 30% is before/after, middle is inside", () => {
    expect(at(150, 200, "y")).toBe("before")
    expect(at(150, 211, "y")).toBe("before") // 11/40 = 27.5%
    expect(at(150, 220, "y")).toBe("inside")
    expect(at(150, 228, "y")).toBe("inside") // exactly 70%
    expect(at(150, 229, "y")).toBe("after") // 72.5%
    expect(at(150, 239.9, "y")).toBe("after")
  })

  it("x axis reads the horizontal position only", () => {
    expect(at(110, 220, "x")).toBe("before")
    expect(at(150, 205, "x")).toBe("inside") // y is irrelevant
    expect(at(150, 239, "x")).toBe("inside")
    expect(at(190, 220, "x")).toBe("after")
  })

  it("the 30% / 70% boundaries belong to the middle", () => {
    const r = R(0, 0, 100, 100)
    expect(
      computePlacement({ rect: r, x: 0, y: 30, axis: "y", container: true })
    ).toBe("inside")
    expect(
      computePlacement({ rect: r, x: 0, y: 29.99, axis: "y", container: true })
    ).toBe("before")
    expect(
      computePlacement({ rect: r, x: 0, y: 70, axis: "y", container: true })
    ).toBe("inside")
    expect(
      computePlacement({ rect: r, x: 0, y: 70.01, axis: "y", container: true })
    ).toBe("after")
  })

  it("a target that cannot hold children never yields inside: the nearer half decides", () => {
    expect(at(150, 210, "y", false)).toBe("before")
    expect(at(150, 219, "y", false)).toBe("before") // just above centre
    expect(at(150, 220, "y", false)).toBe("after") // centre rounds to after
    expect(at(150, 228, "y", false)).toBe("after")
    expect(at(100, 220, "x", false)).toBe("before")
    expect(at(199, 220, "x", false)).toBe("after")
  })

  it("pointer slightly outside the rect still resolves to the nearest side", () => {
    expect(at(150, 150, "y")).toBe("before")
    expect(at(150, 400, "y")).toBe("after")
    expect(at(0, 220, "x")).toBe("before")
    expect(at(999, 220, "x")).toBe("after")
  })

  it("zero-size rect does not produce NaN: falls to the centre rule", () => {
    const z = R(5, 5, 0, 0)
    expect(
      computePlacement({ rect: z, x: 5, y: 5, axis: "y", container: true })
    ).toBe("inside")
    expect(
      computePlacement({ rect: z, x: 5, y: 5, axis: "x", container: false })
    ).toBe("after")
  })
})

describe("isLegalContainer", () => {
  it.each([
    "img",
    "input",
    "br",
    "hr",
    "video",
    "canvas",
    "textarea",
    "select",
    "iframe",
  ])("%s cannot receive children", (tag) => {
    expect(isLegalContainer(document.createElement(tag))).toBe(false)
  })
  it("svg cannot, div/ul/li/button/p can", () => {
    expect(
      isLegalContainer(
        document.createElementNS("http://www.w3.org/2000/svg", "svg")
      )
    ).toBe(false)
    for (const t of ["div", "ul", "li", "button", "p", "section", "span"])
      expect(isLegalContainer(document.createElement(t))).toBe(true)
  })
})

describe("nearestChild", () => {
  const col = [R(0, 0, 100, 40), R(0, 50, 100, 40), R(0, 100, 100, 40)]
  it("empty list -> null", () => expect(nearestChild([], 0, 0, "y")).toBeNull())
  it("pointer in the gap picks the closer neighbour, side by midpoint", () => {
    expect(nearestChild(col, 50, 44, "y")).toEqual({ index: 0, side: "after" }) // 4px under #0, 6px above #1
    expect(nearestChild(col, 50, 47, "y")).toEqual({ index: 1, side: "before" })
  })
  it("before the first / after the last child", () => {
    expect(nearestChild(col, 50, -20, "y")).toEqual({
      index: 0,
      side: "before",
    })
    expect(nearestChild(col, 50, 500, "y")).toEqual({ index: 2, side: "after" })
  })
  it("x axis", () => {
    const row = [R(0, 0, 50, 50), R(60, 0, 50, 50)]
    expect(nearestChild(row, 54, 25, "x")).toEqual({ index: 0, side: "after" })
    expect(nearestChild(row, 58, 25, "x")).toEqual({ index: 1, side: "before" })
  })
  it("wrapped rows: 2D distance, not just the main axis", () => {
    const wrap = [R(0, 0, 50, 50), R(60, 0, 50, 50), R(0, 60, 50, 50)]
    // under the second row's only card, right of its midpoint: that card (not row 1's cards, which are further away)
    expect(nearestChild(wrap, 45, 130, "x")).toEqual({
      index: 2,
      side: "after",
    })
    // right of row 1 (gap above row 2's empty right side): row-1 last card
    expect(nearestChild(wrap, 130, 20, "x")).toEqual({
      index: 1,
      side: "after",
    })
  })
  it("ties resolve to the earlier child", () => {
    expect(
      nearestChild([R(0, 0, 10, 10), R(30, 0, 10, 10)], 20, 5, "x")?.index
    ).toBe(0)
  })
})

describe("lineFor", () => {
  const a = R(10, 100, 200, 40) // bottom edge 140
  it("y axis, no neighbour: on the anchor edge, spanning its width", () => {
    expect(lineFor(a, "before", "y")).toEqual({
      left: 10,
      top: 98.5,
      width: 200,
      height: 3,
    })
    expect(lineFor(a, "after", "y")).toEqual({
      left: 10,
      top: 138.5,
      width: 200,
      height: 3,
    })
  })
  it("centres in the gap to the neighbour", () => {
    expect(lineFor(a, "after", "y", R(10, 150, 200, 40)).top).toBe(143.5) // gap 140..150 -> 145
    expect(lineFor(a, "before", "y", R(10, 50, 200, 40)).top).toBe(93.5) // gap 90..100 -> 95
  })
  it("x axis", () => {
    const b = R(100, 10, 80, 60)
    expect(lineFor(b, "before", "x")).toEqual({
      left: 98.5,
      top: 10,
      width: 3,
      height: 60,
    })
    expect(lineFor(b, "after", "x", R(200, 10, 80, 60))).toEqual({
      left: 188.5,
      top: 10,
      width: 3,
      height: 60,
    }) // gap 180..200 -> 190
  })
  it("ignores a neighbour on another line or on the wrong side", () => {
    expect(
      lineFor(R(0, 0, 50, 50), "before", "x", R(300, 60, 50, 50)).left
    ).toBe(-1.5) // wrapped row: edge, not midpoint
    expect(lineFor(R(0, 0, 50, 50), "after", "x", R(30, 0, 50, 50)).left).toBe(
      48.5
    ) // overlapping: n edge 30 < 50
    expect(lineFor(a, "after", "y", R(500, 150, 10, 10)).top).toBe(138.5) // no horizontal overlap
  })
})

describe("edgeSpeed", () => {
  it("is 0 away from the edges and exactly at the 40px boundary", () => {
    expect(edgeSpeed(300, 0, 800)).toBe(0)
    expect(edgeSpeed(40, 0, 800)).toBe(0)
    expect(edgeSpeed(760, 0, 800)).toBe(0)
  })
  it("negative near the top, positive near the bottom", () => {
    expect(edgeSpeed(39, 0, 800)).toBeLessThan(0)
    expect(edgeSpeed(761, 0, 800)).toBeGreaterThan(0)
  })
  it("speeds up toward the edge and is capped", () => {
    expect(Math.abs(edgeSpeed(5, 0, 800))).toBeGreaterThan(
      Math.abs(edgeSpeed(30, 0, 800))
    )
    expect(edgeSpeed(0, 0, 800)).toBe(-16)
    expect(edgeSpeed(-500, 0, 800)).toBe(-16)
    expect(edgeSpeed(800, 0, 800)).toBe(16)
    expect(edgeSpeed(5000, 0, 800)).toBe(16)
  })
  it("works for an offset scroller range", () => {
    expect(edgeSpeed(210, 200, 400)).toBeLessThan(0)
    expect(edgeSpeed(300, 200, 400)).toBe(0)
    expect(edgeSpeed(395, 200, 400)).toBeGreaterThan(0)
  })
})

describe("axisOf (computed style)", () => {
  const parentWith = (style: string) => {
    const p = document.createElement("div")
    p.setAttribute("style", style)
    document.body.append(p)
    return p
  }
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("flex row, row-reverse and the default direction -> x; column(-reverse) -> y", () => {
    expect(axisOf(parentWith("display:flex"))).toBe("x")
    expect(axisOf(parentWith("display:flex;flex-direction:row"))).toBe("x")
    expect(axisOf(parentWith("display:flex;flex-direction:row-reverse"))).toBe(
      "x"
    )
    expect(axisOf(parentWith("display:inline-flex"))).toBe("x")
    expect(axisOf(parentWith("display:flex;flex-direction:column"))).toBe("y")
    expect(
      axisOf(parentWith("display:flex;flex-direction:column-reverse"))
    ).toBe("y")
  })

  it("block with nothing measurable (no layout) -> y", () => {
    expect(axisOf(parentWith("display:block"))).toBe("y")
  })

  it("non-flex parents: x when the first two in-flow children share a line (grid, floats), y when stacked", () => {
    const rects = new Map<Element, Rect>()
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const r = rects.get(this) ?? R(0, 0, 0, 0)
        return {
          ...r,
          right: r.left + r.width,
          bottom: r.top + r.height,
          x: r.left,
          y: r.top,
          toJSON() {},
        } as DOMRect
      }
    )
    const grid = parentWith("display:grid")
    const [a, b, c] = [1, 2, 3].map(() =>
      grid.appendChild(document.createElement("div"))
    )
    rects
      .set(a, R(0, 0, 100, 50))
      .set(b, R(110, 0, 100, 50))
      .set(c, R(0, 60, 100, 50))
    expect(axisOf(grid)).toBe("x")

    rects.set(b, R(0, 60, 100, 50)) // stacked
    expect(axisOf(grid)).toBe("y")

    rects.set(a, R(0, 0, 0, 0)) // display:none first child is skipped; b, c now stacked
    rects.set(c, R(0, 120, 100, 50))
    expect(axisOf(grid)).toBe("y")

    rects.set(c, R(110, 60, 100, 50)) // b and c on the same line
    expect(axisOf(grid)).toBe("x")
  })

  it("absolutely positioned children do not count as a line mate", () => {
    const rects = new Map<Element, Rect>()
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const r = rects.get(this) ?? R(0, 0, 0, 0)
        return {
          ...r,
          right: r.left + r.width,
          bottom: r.top + r.height,
          x: r.left,
          y: r.top,
          toJSON() {},
        } as DOMRect
      }
    )
    const p = parentWith("display:block")
    const a = p.appendChild(document.createElement("div"))
    const badge = p.appendChild(document.createElement("div"))
    const b = p.appendChild(document.createElement("div"))
    badge.setAttribute("style", "position:absolute")
    rects
      .set(a, R(0, 0, 100, 50))
      .set(badge, R(80, 0, 20, 20))
      .set(b, R(0, 50, 100, 50))
    expect(axisOf(p)).toBe("y")
  })
})

// ---------------------------------------------------------------------------------------------
// Flow: real Recorder + real describe, layout/hit-testing mocked (jsdom has none). Real-browser behaviour is
// covered by the Chromium run described in the task report.

describe("createDragger flow (mocked layout)", () => {
  const rects = new Map<Element, Rect>()
  let host: HTMLElement
  let root: ShadowRoot
  let rec: Recorder
  let moved: Element[]
  let dragger: DraggerApi
  let page: { clicks: number; downs: number; ups: number }
  let ac: AbortController

  const isOurs = (n: unknown) => n === host || host.contains(n as Node)
  const $ = (id: string) => document.getElementById(id)!
  const layer = () => root.querySelector('[data-redline-drag="layer"]')
  const part = (p: string) =>
    root.querySelector<HTMLElement>(`[data-redline-drag="${p}"]`)

  function ptr(
    type: string,
    target: Element | Window,
    x: number,
    y: number,
    init: PointerEventInit = {}
  ) {
    const e = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      ...init,
    })
    target.dispatchEvent(e)
    return e
  }
  const key = (k: string) => {
    const e = new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(e)
    return e
  }
  const listIds = () => [...$("l").children].map((c) => c.id).join("")
  /** The mock has no layout engine: after a move, stack the list items in their new DOM order again. */
  const relayout = () => {
    ;[...$("l").children].forEach((c, i) => rects.set(c, R(0, i * 40, 200, 40)))
  }

  beforeEach(() => {
    document.body.innerHTML = `<ul id="l"><li id="a" class="item first">A</li><li id="b">B</li><li id="c">C</li></ul><div id="empty"></div><img id="img" alt="">`
    rects.clear()
    const set = (id: string, ...r: [number, number, number, number]) =>
      rects.set($(id), R(...r))
    set("l", 0, 0, 200, 120)
    set("a", 0, 0, 200, 40)
    set("b", 0, 40, 200, 40)
    set("c", 0, 80, 200, 40)
    set("empty", 0, 200, 200, 100)
    set("img", 0, 400, 50, 50)
    rects.set(document.body, R(0, 0, 1024, 768))
    rects.set(document.documentElement, R(0, 0, 1024, 768))

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const r = rects.get(this) ?? R(0, 0, 0, 0)
        return {
          ...r,
          right: r.left + r.width,
          bottom: r.top + r.height,
          x: r.left,
          y: r.top,
          toJSON() {},
        } as DOMRect
      }
    )
    // deepest element whose rect contains the point first, like the real thing
    const depth = (e: Element): number =>
      e.parentElement ? 1 + depth(e.parentElement) : 0
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) =>
        [...document.querySelectorAll("*"), document.documentElement]
          .filter((e) => {
            const r = rects.get(e)
            return (
              !!r &&
              x >= r.left &&
              x < r.left + r.width &&
              y >= r.top &&
              y < r.top + r.height
            )
          })
          .sort((p, q) => depth(q) - depth(p)),
    })
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => null,
    })

    host = document.createElement("div")
    host.setAttribute("data-redline-host", "")
    document.documentElement.append(host)
    root = host.attachShadow({ mode: "closed" })
    rec = new Recorder()
    moved = []
    page = { clicks: 0, downs: 0, ups: 0 }
    ac = new AbortController()
    const signal = ac.signal
    document.addEventListener("click", () => page.clicks++, { signal })
    document.addEventListener("mousedown", () => page.downs++, { signal })
    document.addEventListener("pointerdown", () => page.downs++, { signal })
    document.addEventListener("mouseup", () => page.ups++, { signal })
    dragger = createDragger({
      root,
      isOurs,
      rec,
      onMoved: (el) => moved.push(el),
    })
  })

  afterEach(() => {
    ac.abort()
    dragger.destroy()
    host.remove()
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  /** pointerdown on `id`, move past the threshold to (x, y). Pointer stays down. */
  function pick(id: string, x: number, y: number) {
    const from = rects.get($(id))!
    ptr("pointerdown", $(id), from.left + 5, from.top + 5)
    ptr("pointermove", $(id), x, y)
  }

  it("is inert until activated: the page sees every event", () => {
    ptr("pointerdown", $("a"), 5, 5)
    ptr("pointermove", $("a"), 50, 100)
    $("a").click()
    expect(page.clicks).toBe(1)
    expect(page.downs).toBeGreaterThan(0)
    expect(layer()).toBeNull()
  })

  it("active: swallows pointer/mouse/click from the page, but lets our own UI through", () => {
    dragger.setActive(true)
    $("a").click()
    $("a").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    )
    $("a").dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    )
    const down = ptr("pointerdown", $("a"), 5, 5)
    expect(page).toEqual({ clicks: 0, downs: 0, ups: 0 })
    expect(down.defaultPrevented).toBe(true)

    host.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
    expect(page.clicks).toBe(1)
  })

  it("does not start before 4px of movement, and a plain click records nothing", () => {
    dragger.setActive(true)
    ptr("pointerdown", $("a"), 5, 5)
    ptr("pointermove", $("a"), 7, 7)
    expect(layer()).toBeNull()
    ptr("pointerup", $("a"), 7, 7)
    expect(rec.list()).toEqual([])
    expect(listIds()).toBe("abc")
  })

  it("html/body pointerdown never starts a drag (but is still swallowed)", () => {
    dragger.setActive(true)
    const e = ptr("pointerdown", document.body, 500, 500)
    ptr("pointermove", document.body, 600, 600)
    expect(layer()).toBeNull()
    expect(e.defaultPrevented).toBe(true)
  })

  it("shows the chip (tag.class), dimmed source and a line indicator; nothing in the page DOM", () => {
    dragger.setActive(true)
    const before = document.body.innerHTML
    pick("a", 50, 114) // bottom zone of c
    expect(layer()).not.toBeNull()
    expect(part("chip")!.textContent).toBe("li.item.first")
    expect(part("dim")!.style.display).toBe("block")
    expect(part("line")!.style.display).toBe("block")
    expect(part("box")!.style.display).toBe("none")
    for (const p of ["layer", "dim", "line", "box", "chip"])
      expect(part(p)!.style.pointerEvents).toBe("none")
    expect(document.body.innerHTML).toBe(before)
  })

  it("reorders down: a -> after c; records from/to; revert restores the exact markup", () => {
    dragger.setActive(true)
    const markup = $("l").outerHTML
    pick("a", 50, 114)
    ptr("pointerup", $("c"), 50, 114)
    expect(listIds()).toBe("bca")
    expect(layer()).toBeNull()
    const [c] = rec.list()
    expect(c.kind).toBe("move")
    if (c.kind !== "move") return
    expect(c.from.index).toBe(0)
    expect(c.to.index).toBe(2)
    expect(c.from.parent.selector).toBe(c.to.parent.selector)
    expect(c.origin).toBe("panel")
    expect(moved).toEqual([$("a")])
    rec.revert(c.id)
    expect($("l").outerHTML).toBe(markup)
    expect(rec.list()).toEqual([])
  })

  it("reorders up: c -> before a", () => {
    dragger.setActive(true)
    const markup = $("l").outerHTML
    pick("c", 50, 4) // top zone of a
    ptr("pointerup", $("a"), 50, 4)
    expect(listIds()).toBe("cab")
    rec.undo()
    expect($("l").outerHTML).toBe(markup)
  })

  it("drop in the gap between items inserts at that slot (nearest child), not at the container edge", () => {
    dragger.setActive(true)
    rects.set($("b"), R(0, 50, 200, 30)) // 10px gap under a: y 40..50
    rects.set($("l"), R(0, 0, 200, 120))
    pick("c", 50, 47) // in the gap, closer to b's top
    expect(part("line")!.style.display).toBe("block")
    ptr("pointerup", $("l"), 50, 47)
    expect(listIds()).toBe("acb")
  })

  it("a hit inside a sibling resolves to that sibling (reorder), not to the span under the pointer", () => {
    $("b").innerHTML = "<span id='s'>B</span>"
    rects.set($("s"), R(0, 40, 30, 40))
    dragger.setActive(true)
    pick("a", 10, 78) // on the span, bottom zone of b
    ptr("pointerup", $("s"), 10, 78)
    expect(listIds()).toBe("bac")
    expect($("s").parentElement).toBe($("b"))
  })

  it("the bare padding of a same-tag sibling is a reorder target too, never 'drop inside' it", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="cards" style="display:flex"><div id="k1"><p id="k1p">x</p></div><div id="k2"><p id="k2p">y</p></div></div>`
    )
    rects.set($("cards"), R(0, 500, 400, 100))
    rects.set($("k1"), R(0, 500, 190, 100))
    rects.set($("k2"), R(210, 500, 190, 100))
    rects.set($("k1p"), R(20, 520, 150, 20))
    rects.set($("k2p"), R(230, 520, 150, 20))
    dragger.setActive(true)
    pick("k2", 5, 550) // k1's left padding: the deepest hit is k1 itself, not its <p>
    expect(part("line")!.style.display).toBe("block")
    expect(part("box")!.style.display).not.toBe("block")
    ptr("pointerup", $("k1"), 5, 550)
    expect([...$("cards").children].map((c) => c.id).join("")).toBe("k2k1")
    expect($("k1p").parentElement).toBe($("k1"))
  })

  it("a hit inside a differently-tagged sibling is NOT promoted: deep targets stay reachable", () => {
    // el = <div#empty> (a child of <body>, like the <ul>). Hovering li#b must target li#b itself, not collapse into the <ul>.
    dragger.setActive(true)
    pick("empty", 50, 76) // lower zone of li#b
    expect(part("line")!.style.display).toBe("block")
    ptr("pointerup", $("b"), 50, 76)
    expect(listIds()).toBe("abemptyc") // landed between b and c, inside the list
  })

  it("a lone pointerup (no matching drag) is swallowed too; our own UI is not", () => {
    dragger.setActive(true)
    const seen: string[] = []
    document.addEventListener("pointerup", () => seen.push("page"), {
      signal: ac.signal,
    })
    ptr("pointerup", $("a"), 5, 5, { pointerId: 9 })
    expect(seen).toEqual([])
    host.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 9,
      })
    )
    expect(seen).toEqual(["page"])
  })

  it("drop into an empty container goes inside, appended", () => {
    dragger.setActive(true)
    pick("a", 100, 250)
    expect(part("box")!.style.display).toBe("block")
    ptr("pointerup", $("empty"), 100, 250)
    expect($("empty").firstElementChild).toBe($("a"))
    const [c] = rec.list()
    if (c.kind !== "move") throw new Error("expected move")
    expect(c.to.parent.selector).toBe("#empty")
    expect(c.from.parent.selector).toBe("#l")
    expect(listIds()).toBe("bc")
    rec.revert(c.id)
    expect(listIds()).toBe("abc")
  })

  it("non-container targets (img) only take before/after", () => {
    dragger.setActive(true)
    pick("a", 25, 425) // centre of the img
    expect(part("box")!.style.display).toBe("none")
    ptr("pointerup", $("img"), 25, 425)
    expect(document.body.children[3]).toBe($("a")) // after img (centre of a non-container rounds to after)
    expect($("img").childNodes.length).toBe(0)
  })

  it("dropping onto itself records nothing and changes nothing", () => {
    dragger.setActive(true)
    const before = document.body.innerHTML
    pick("b", 50, 60)
    expect(part("line")!.style.display).toBe("none")
    expect(part("box")!.style.display).toBe("none")
    ptr("pointerup", $("b"), 50, 60)
    expect(rec.list()).toEqual([])
    expect(moved).toEqual([])
    expect(document.body.innerHTML).toBe(before)
  })

  it("dropping a container onto its own descendant is rejected", () => {
    dragger.setActive(true)
    const before = document.body.innerHTML
    pick("l", 50, 60) // over li#b, inside the dragged ul
    expect(part("line")!.style.display).toBe("none")
    ptr("pointerup", $("b"), 50, 60)
    expect(rec.list()).toEqual([])
    expect(document.body.innerHTML).toBe(before)
  })

  it("dropping where it already is (before its own next sibling) is a no-op: no record, no DOM write", () => {
    dragger.setActive(true)
    const before = document.body.innerHTML
    const writes = vi.fn()
    new MutationObserver(writes).observe(document.body, {
      childList: true,
      subtree: true,
    })
    pick("a", 50, 44) // top zone of b == where a already is
    ptr("pointerup", $("b"), 50, 44)
    expect(rec.list()).toEqual([])
    expect(moved).toEqual([])
    expect(document.body.innerHTML).toBe(before)
    expect(writes).not.toHaveBeenCalled()
  })

  it("a no-op does not disturb whitespace text nodes", () => {
    $("l").innerHTML = "\n  <li id='a'>A</li>\n  <li id='b'>B</li>\n"
    rects.set($("a"), R(0, 0, 200, 40))
    rects.set($("b"), R(0, 40, 200, 40))
    dragger.setActive(true)
    const before = $("l").innerHTML
    pick("a", 50, 44)
    ptr("pointerup", $("b"), 50, 44)
    expect($("l").innerHTML).toBe(before)
  })

  it("revert puts the element back among whitespace text nodes exactly", () => {
    $("l").innerHTML =
      "\n  <li id='a'>A</li>\n  <li id='b'>B</li>\n  <li id='c'>C</li>\n"
    for (const [id, y] of [
      ["a", 0],
      ["b", 40],
      ["c", 80],
    ] as const)
      rects.set($(id), R(0, y, 200, 40))
    dragger.setActive(true)
    const before = $("l").outerHTML
    pick("a", 50, 118)
    ptr("pointerup", $("c"), 50, 118)
    expect(listIds()).toBe("bca")
    expect($("l").outerHTML).not.toBe(before)
    rec.revertAll()
    expect($("l").outerHTML).toBe(before)
  })

  it("Esc mid-drag cancels: overlay gone, DOM untouched, nothing recorded, later pointerup does nothing", () => {
    dragger.setActive(true)
    const before = document.body.innerHTML
    pick("a", 50, 114)
    expect(layer()).not.toBeNull()
    const e = key("Escape")
    expect(e.defaultPrevented).toBe(true)
    expect(layer()).toBeNull()
    ptr("pointermove", $("c"), 50, 100)
    ptr("pointerup", $("c"), 50, 114)
    expect(rec.list()).toEqual([])
    expect(document.body.innerHTML).toBe(before)
  })

  it("pointerdown on the page takes focus back from our panel (real-browser regression: Esc must reach the drag)", () => {
    dragger.setActive(true)
    const input = document.createElement("input")
    root.append(input)
    input.focus()
    expect(root.activeElement).toBe(input)
    ptr("pointerdown", $("a"), 5, 5)
    expect(root.activeElement).toBeNull()
  })

  it("Esc while idle is not swallowed", () => {
    dragger.setActive(true)
    expect(key("Escape").defaultPrevented).toBe(false)
  })

  it("pointerup outside the window cancels", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointerup", document.body, 50, 5000)
    expect(rec.list()).toEqual([])
    expect(listIds()).toBe("abc")
    expect(layer()).toBeNull()
  })

  it("a pointermove with no buttons pressed (lost pointerup) cancels", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointermove", $("c"), 50, 100, { buttons: 0 })
    expect(layer()).toBeNull()
    ptr("pointerup", $("c"), 50, 114)
    expect(rec.list()).toEqual([])
  })

  it("pointercancel and window blur cancel", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointercancel", $("a"), 50, 114)
    expect(layer()).toBeNull()
    pick("a", 50, 114)
    window.dispatchEvent(new Event("blur"))
    expect(layer()).toBeNull()
  })

  it("an element blurring mid-drag does not cancel it", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    $("b").dispatchEvent(new FocusEvent("blur"))
    expect(layer()).not.toBeNull()
  })

  it("ignores a second pointer", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointerup", $("c"), 50, 114, { pointerId: 2 })
    expect(layer()).not.toBeNull()
    expect(rec.list()).toEqual([])
  })

  it("ignores non-primary buttons for starting a drag (but swallows them)", () => {
    dragger.setActive(true)
    const e = ptr("pointerdown", $("a"), 5, 5, { button: 2 })
    ptr("pointermove", $("a"), 50, 100)
    expect(layer()).toBeNull()
    expect(e.defaultPrevented).toBe(true)
  })

  it("setActive(false) mid-drag aborts cleanly and the page gets its events back", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    dragger.setActive(false)
    expect(layer()).toBeNull()
    expect(rec.list()).toEqual([])
    ptr("pointerup", $("c"), 50, 114)
    expect(listIds()).toBe("abc")
    $("a").click()
    expect(page.clicks).toBe(1)
  })

  it("can be re-activated after being deactivated", () => {
    dragger.setActive(true)
    dragger.setActive(false)
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointerup", $("c"), 50, 114)
    expect(listIds()).toBe("bca")
  })

  it("setActive is idempotent: repeated true does not double-register listeners", () => {
    dragger.setActive(true)
    dragger.setActive(true)
    pick("a", 50, 114)
    ptr("pointerup", $("c"), 50, 114)
    expect(rec.list()).toHaveLength(1)
    dragger.setActive(false)
    dragger.setActive(false)
    $("a").click()
    expect(page.clicks).toBe(1)
  })

  it("destroy() mid-drag leaves nothing behind and is safe to call twice; setActive(true) afterwards is ignored", () => {
    dragger.setActive(true)
    pick("a", 50, 114)
    dragger.destroy()
    dragger.destroy()
    expect(root.childNodes.length).toBe(0)
    $("a").click()
    expect(page.clicks).toBe(1)
    dragger.setActive(true)
    $("a").click()
    expect(page.clicks).toBe(2)
  })

  it("never throws into the page when the host callbacks misbehave", () => {
    dragger.destroy()
    dragger = createDragger({
      root,
      isOurs,
      rec,
      onMoved: () => {
        throw new Error("controller bug")
      },
    })
    dragger.setActive(true)
    pick("a", 50, 114)
    expect(() => ptr("pointerup", $("c"), 50, 114)).not.toThrow()
    expect(listIds()).toBe("bca") // the move itself still happened and was recorded
    expect(rec.list()).toHaveLength(1)
  })

  it("moving the same element twice merges, and reverting restores the very first position", () => {
    dragger.setActive(true)
    const markup = $("l").outerHTML
    pick("a", 50, 114)
    ptr("pointerup", $("c"), 50, 114) // b c a
    expect(listIds()).toBe("bca")
    relayout()
    pick("a", 50, 4) // top zone of b (now first)
    ptr("pointerup", $("b"), 50, 4) // a b c again -> cancels out
    expect(rec.list()).toEqual([])
    expect($("l").outerHTML).toBe(markup)
  })
})
