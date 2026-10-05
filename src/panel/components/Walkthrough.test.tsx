import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { Walkthrough, hasSeenWalkthrough } from "./Walkthrough"

let root: Root | undefined
let host: HTMLElement

// Node's own experimental localStorage shadows jsdom's and has no methods without a backing file.
function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    clear: () => m.clear(),
  }
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage())
})

function mount(onClose: () => void) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Walkthrough onClose={onClose} />))
}

const button = (name: RegExp) =>
  [...host.querySelectorAll("button")].find((b) =>
    name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")
  ) as HTMLButtonElement
const click = (name: RegExp) => act(() => button(name).click())

describe("Walkthrough", () => {
  it("steps through, then closes and remembers it was seen", () => {
    const onClose = vi.fn()
    mount(onClose)
    expect(hasSeenWalkthrough()).toBe(false)
    expect(host.textContent).toContain("Select anything")
    click(/next/i)
    expect(host.textContent).toContain("Tweak it")
    click(/back/i)
    expect(host.textContent).toContain("Select anything")
    click(/step 4/i)
    click(/start editing/i)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hasSeenWalkthrough()).toBe(true)
  })

  it("Escape dismisses and remembers", () => {
    const onClose = vi.fn()
    mount(onClose)
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hasSeenWalkthrough()).toBe(true)
  })

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(hasSeenWalkthrough()).toBe(false)
    const onClose = vi.fn()
    mount(onClose)
    click(/skip/i)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
