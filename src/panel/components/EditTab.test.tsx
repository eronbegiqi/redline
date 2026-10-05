import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ToContent } from "@/shared/protocol"
import {
  STYLE_PROPS,
  type ElementInfo,
  type PanelState,
  type StyleProp,
} from "@/shared/types"

import { EditTab } from "./EditTab"

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const baseStyles = Object.fromEntries(
  STYLE_PROPS.map((p) => [p, "0px"])
) as Record<StyleProp, string>
Object.assign(baseStyles, {
  color: "rgb(17, 24, 39)",
  "background-color": "rgba(0, 0, 0, 0)",
  "font-size": "16px",
  "font-weight": "600",
  "line-height": "24px",
  "letter-spacing": "normal",
  "text-align": "start",
  display: "block",
  opacity: "1",
  "border-style": "none",
  "border-color": "rgb(0, 0, 0)",
  "padding-top": "8px",
  "padding-right": "16px",
  "padding-bottom": "8px",
  "padding-left": "16px",
})

function info(
  over: Partial<ElementInfo> = {},
  styles: Partial<Record<StyleProp, string>> = {}
): ElementInfo {
  return {
    el: "e1",
    descriptor: {
      selector: "main > a",
      tag: "a",
      id: "cta",
      classes: ["btn"],
      text: "Get started",
      source: {
        framework: "react",
        component: "HeroCta",
        file: "src/Hero.tsx",
        line: 42,
      },
    },
    rect: { x: 0, y: 0, width: 132.5, height: 40 },
    isTextLeaf: true,
    text: "Get started",
    hasParent: true,
    hasChild: false,
    canDelete: true,
    ...over,
    styles: { ...baseStyles, ...styles },
  }
}

const state = (
  selection: ElementInfo | null,
  mode: PanelState["mode"] = "select"
): PanelState => ({
  mode,
  recording: false,
  selection,
  changes: [],
  page: {
    url: "http://localhost/",
    title: "t",
    viewport: { width: 1, height: 1 },
  },
})

let container: HTMLDivElement
let root: Root
let sent: ToContent[]
const send = (m: ToContent) => void sent.push(m)

const render = (s: PanelState) =>
  act(() => root.render(<EditTab state={s} send={send} />))

beforeEach(() => {
  sent = []
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const field = <T extends HTMLElement = HTMLInputElement>(name: string) => {
  const el =
    container.querySelector<T>(`[aria-label="${name}"]`) ??
    container.querySelector<T>(`[id="${labelFor(name)}"]`)
  if (!el) throw new Error(`no field "${name}"`)
  return el
}
function labelFor(text: string) {
  const l = [...container.querySelectorAll("label")].find(
    (x) => x.textContent === text
  )
  return l?.getAttribute("for") ?? ""
}
const button = (name: string) => {
  const b = [...container.querySelectorAll("button")].find(
    (x) =>
      x.getAttribute("aria-label") === name || x.textContent?.trim() === name
  )
  if (!b) throw new Error(`no button "${name}"`)
  return b
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
  act(
    () =>
      void el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
          ...init,
        })
      )
  )
// React's onBlur listens to focusout
const blur = (el: HTMLElement) =>
  act(
    () => void el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  )
const style = (prop: string, value: string, el = "e1"): ToContent => ({
  type: "setStyle",
  el,
  prop,
  value,
})

describe("empty and card states", () => {
  it("shows the empty state without a selection", () => {
    render(state(null))
    expect(container.textContent).toContain("Click anything on the page")
    expect(container.textContent).toContain("Pick an element")
  })

  it("tells the user to switch mode when not in select mode", () => {
    render(state(null, "browse"))
    expect(container.textContent).toContain("Switch to Select mode")
  })

  it("renders the element card with tag, id, classes, source hint and size", () => {
    render(state(info()))
    const text = container.textContent ?? ""
    for (const s of [
      "Get started",
      "main > a",
      "#cta",
      ".btn",
      "React · HeroCta",
      "133 × 40",
    ])
      expect(text).toContain(s)
  })

  it("only shows the Text field for text leaves", () => {
    render(state(info()))
    expect(container.querySelector("textarea")).not.toBeNull()
    render(state(info({ isTextLeaf: false, text: "" })))
    expect(container.querySelector("textarea")).toBeNull()
  })

  it("sends actions and disables them for html/body", () => {
    render(state(info()))
    for (const n of ["Select parent", "Duplicate", "Hide", "Delete"])
      act(() => button(n).click())
    expect(sent).toEqual([
      { type: "action", el: "e1", action: "parent" },
      { type: "action", el: "e1", action: "duplicate" },
      { type: "action", el: "e1", action: "hide" },
      { type: "action", el: "e1", action: "delete" },
    ])
    expect(button("Select first child").disabled).toBe(true)

    render(state(info({ canDelete: false, hasParent: false })))
    for (const n of ["Select parent", "Duplicate", "Hide", "Delete"])
      expect(button(n).disabled).toBe(true)
  })

  it("leaves a text field that was cut at 2000 chars read-only so it can't be overwritten with the cut copy", () => {
    render(state(info({ text: "x".repeat(2000) })))
    expect(container.querySelector("textarea")!.disabled).toBe(true)
  })
})

describe("length fields", () => {
  const size = () => field("Size")

  it("shows the computed value", () => {
    render(state(info()))
    expect(size().value).toBe("16px")
  })

  it("commits a bare number as px on Enter, once", () => {
    render(state(info()))
    type(size(), "20")
    expect(sent).toEqual([])
    key(size(), "Enter")
    expect(sent).toEqual([style("font-size", "20px")])
    key(size(), "Enter")
    blur(size())
    expect(sent).toHaveLength(1)
    expect(size().value).toBe("20px")
  })

  it("commits on blur", () => {
    render(state(info()))
    type(size(), "1.5rem")
    blur(size())
    expect(sent).toEqual([style("font-size", "1.5rem")])
  })

  it("sends nothing when the committed value equals the current one", () => {
    render(state(info()))
    for (const v of ["16", "16px", " 16PX "]) {
      type(size(), v)
      key(size(), "Enter")
    }
    expect(sent).toEqual([])
    expect(size().value).toBe("16px")
  })

  it("ignores an empty commit (we can't know whether an inline value exists) and restores the value", () => {
    render(state(info()))
    type(size(), "")
    key(size(), "Enter")
    expect(sent).toEqual([])
    expect(size().value).toBe("16px")
  })

  it("Escape reverts the draft", () => {
    render(state(info()))
    type(size(), "99")
    key(size(), "Escape")
    blur(size())
    expect(sent).toEqual([])
    expect(size().value).toBe("16px")
  })

  it("steps with ArrowUp/Down, Shift x10, Alt x0.1, from the pending value on fast repeats", () => {
    render(state(info()))
    key(size(), "ArrowUp")
    key(size(), "ArrowUp", { shiftKey: true })
    key(size(), "ArrowDown", { altKey: true })
    expect(sent).toEqual([
      style("font-size", "17px"),
      style("font-size", "27px"),
      style("font-size", "26.9px"),
    ])
  })

  it("steps line-height unitless and letter-spacing from `normal`", () => {
    render(state(info({}, { "line-height": "1.5" })))
    key(field("Line height"), "ArrowUp")
    key(field("Letter spacing"), "ArrowUp")
    expect(sent).toEqual([
      style("line-height", "1.6"),
      style("letter-spacing", "0.1px"),
    ])
  })

  it("keeps a bare line-height number unitless", () => {
    render(state(info()))
    type(field("Line height"), "1.4")
    key(field("Line height"), "Enter")
    expect(sent).toEqual([style("line-height", "1.4")])
  })
})

describe("re-sync", () => {
  const size = () => field("Size")

  it("follows value changes from outside", () => {
    render(state(info()))
    render(state(info({}, { "font-size": "22px" })))
    expect(size().value).toBe("22px")
  })

  it("shows what was committed until the page echoes, then falls back to the real value if it was rejected", () => {
    render(state(info()))
    type(size(), "foo")
    key(size(), "Enter")
    expect(size().value).toBe("foo")
    render(state(info())) // new push, value unchanged: the page dropped "foo"
    expect(size().value).toBe("16px")
  })

  it("does not fight typing when a state push arrives mid-edit", () => {
    render(state(info()))
    type(size(), "2")
    render(state(info({}, { "font-size": "18px" })))
    expect(size().value).toBe("2")
    key(size(), "Enter")
    expect(sent).toEqual([style("font-size", "2px")])
  })

  it("resets every field when the selection changes and commits the old draft to the OLD element", () => {
    render(state(info()))
    type(size(), "99")
    render(state(info({ el: "e2" }, { "font-size": "12px" })))
    expect(size().value).toBe("12px")
    blur(size())
    // The page swallows the click that picks the next element, so the input never blurred: the draft is flushed
    // on the way out, addressed to e1, and nothing at all goes to e2.
    expect(sent).toEqual([style("font-size", "99px", "e1")])
  })

  it("sends nothing on a selection change when nothing was typed", () => {
    render(state(info()))
    render(state(info({ el: "e2" }, { "font-size": "12px" })))
    expect(sent).toEqual([])
  })

  it("flushes a draft when the selection is cleared or the tab goes away", () => {
    render(state(info()))
    type(size(), "30")
    render(state(null))
    expect(sent).toEqual([style("font-size", "30px")])

    sent = []
    render(state(info()))
    type(size(), "31")
    act(() => root.unmount())
    expect(sent).toEqual([style("font-size", "31px")])
    root = createRoot(container)
  })

  it("flushes an uncommitted padding side with the old id when linked", () => {
    render(state(info()))
    type(field("Padding top"), "4")
    render(state(info({ el: "e2" })))
    expect(sent.every((m) => "el" in m && m.el === "e1")).toBe(true)
    expect(sent.length).toBeGreaterThan(0)
  })
})

describe("padding / margin sides", () => {
  it("starts linked when all four sides match and writes every side", () => {
    render(
      state(
        info(
          {},
          {
            "margin-top": "4px",
            "margin-right": "4px",
            "margin-bottom": "4px",
            "margin-left": "4px",
          }
        )
      )
    )
    expect(button("Link all margin sides").getAttribute("aria-pressed")).toBe(
      "true"
    )
    type(field("Margin top"), "10")
    key(field("Margin top"), "Enter")
    expect(sent).toEqual(
      ["top", "right", "bottom", "left"].map((s) =>
        style(`margin-${s}`, "10px")
      )
    )
  })

  it("starts unlinked when sides differ and writes only the edited side", () => {
    render(state(info()))
    expect(button("Link all padding sides").getAttribute("aria-pressed")).toBe(
      "false"
    )
    type(field("Padding left"), "2")
    key(field("Padding left"), "Enter")
    expect(sent).toEqual([style("padding-left", "2px")])
  })

  it("linking applies the next edit to all sides, and skips sides that already match", () => {
    render(
      state(
        info(
          {},
          {
            "padding-top": "8px",
            "padding-right": "8px",
            "padding-bottom": "8px",
            "padding-left": "6px",
          }
        )
      )
    )
    act(() => button("Link all padding sides").click())
    type(field("Padding top"), "8")
    key(field("Padding top"), "Enter")
    expect(sent).toEqual([style("padding-left", "8px")])
  })
})

describe("colour fields", () => {
  const colour = () => field("Colour")

  it("shows hex for computed rgb()/rgba() and `transparent` for the default", () => {
    // The Appearance group (Slider inside) is closed by default; Radix's Slider needs ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    render(
      state(
        info(
          {},
          {
            color: "rgba(59, 130, 246, 0.5)",
            "background-color": "rgba(0, 0, 0, 0)",
          }
        )
      )
    )
    expect(colour().value).toBe("#3b82f680")
    act(() => button("Appearance").click())
    expect(field("Background").value).toBe("transparent")
    vi.unstubAllGlobals()
  })

  it("normalises typed colours to #rrggbb / #rrggbbaa", () => {
    render(state(info()))
    for (const v of ["#FF0000", "rgba(0, 0, 0, 0.5)"]) {
      type(colour(), v)
      key(colour(), "Enter")
    }
    expect(sent).toEqual([
      style("color", "#ff0000"),
      style("color", "#00000080"),
    ])
  })

  it("sends nothing for another spelling of the current colour", () => {
    render(state(info()))
    for (const v of [
      "#111827",
      "#111827FF",
      "rgb(17 24 39)",
      "rgb(17, 24, 39)",
    ]) {
      type(colour(), v)
      key(colour(), "Enter")
    }
    expect(sent).toEqual([])
  })

  it("passes named / unsupported colours through as typed", () => {
    render(state(info()))
    type(colour(), "  RebeccaPurple ")
    key(colour(), "Enter")
    type(colour(), "var(--Brand)")
    key(colour(), "Enter")
    expect(sent).toEqual([
      style("color", "RebeccaPurple"),
      style("color", "var(--Brand)"),
    ])
  })

  it("shows unsupported computed colours verbatim", () => {
    render(state(info({}, { color: "color(display-p3 1 0 0)" })))
    expect(colour().value).toBe("color(display-p3 1 0 0)")
  })
})

describe("text field", () => {
  const text = () => container.querySelector("textarea")!

  beforeEach(() => vi.useFakeTimers())

  it("debounces 300ms after the last keystroke into a single setText", () => {
    render(state(info()))
    type(text(), "Get started!")
    act(() => void vi.advanceTimersByTime(250))
    type(text(), "Get started!!")
    act(() => void vi.advanceTimersByTime(299))
    expect(sent).toEqual([])
    act(() => void vi.advanceTimersByTime(1))
    expect(sent).toEqual([{ type: "setText", el: "e1", text: "Get started!!" }])
    expect(text().value).toBe("Get started!!")
  })

  it("flushes on blur and doesn't send twice", () => {
    render(state(info()))
    type(text(), "Hi")
    blur(text())
    act(() => void vi.advanceTimersByTime(1000))
    expect(sent).toEqual([{ type: "setText", el: "e1", text: "Hi" }])
  })

  it("sends nothing when the text is unchanged", () => {
    render(state(info()))
    type(text(), "Get started!")
    type(text(), "Get started")
    act(() => void vi.advanceTimersByTime(1000))
    expect(sent).toEqual([])
  })

  it("a pending edit goes to the element it was typed on, once, never to the new selection", () => {
    render(state(info()))
    type(text(), "typed on e1")
    render(state(info({ el: "e2", text: "other" })))
    act(() => void vi.advanceTimersByTime(1000))
    expect(sent).toEqual([{ type: "setText", el: "e1", text: "typed on e1" }])
    expect(text().value).toBe("other")
  })

  it("keeps the draft while state pushes arrive mid-typing", () => {
    render(state(info()))
    type(text(), "Get start")
    render(state(info({ text: "Get startedX" })))
    expect(text().value).toBe("Get start")
  })
})

describe("element card details", () => {
  it("shows the source file:line as visible muted text, with a title", () => {
    render(state(info()))
    const p = container.querySelector<HTMLElement>(
      '[data-slot="element-source"]'
    )!
    expect(p.textContent).toBe("src/Hero.tsx:42")
    expect(p.title).toBe("src/Hero.tsx:42")
  })

  it("shows no source line without a file", () => {
    const i = info()
    i.descriptor = {
      ...i.descriptor,
      source: { framework: "react", component: "X" },
    }
    render(state(i))
    expect(container.querySelector('[data-slot="element-source"]')).toBeNull()
  })

  it("shows +N when the descriptor's class list is capped", () => {
    const i = info({ classCount: 11 })
    i.descriptor = {
      ...i.descriptor,
      classes: Array.from({ length: 8 }, (_, n) => `c${n}`),
    }
    render(state(i))
    expect(container.textContent).toContain("+3")
    render(state(info({ classCount: 1 })))
    expect(container.textContent).not.toContain("+0")
    expect(container.textContent).not.toMatch(/\+\d/)
  })
})

describe("opacity slider", () => {
  it("has an accessible name and value text", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    render(state(info()))
    act(() => button("Appearance").click()) // closed by default
    const thumb = container.querySelector('[role="slider"]')!
    const label = document.getElementById(
      thumb.getAttribute("aria-labelledby")!
    )
    expect(label?.textContent).toBe("Opacity")
    expect(thumb.getAttribute("aria-valuetext")).toBe("100%")
  })

  it("a keyboard step sends the final value once, immediately", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    render(state(info()))
    act(() => button("Appearance").click())
    key(container.querySelector<HTMLElement>('[role="slider"]')!, "ArrowLeft")
    expect(sent).toEqual([style("opacity", "0.99")])
  })
})
