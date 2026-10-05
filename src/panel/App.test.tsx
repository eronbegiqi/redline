import { act, useSyncExternalStore } from "react"
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

import { App, CONNECT_TIMEOUT_MS } from "@/panel/App"
import { usePanel } from "@/panel/bridge"
import { createMockStore } from "@/panel/dev-mock"
import { buildExport } from "@/shared/export"

// The Edit tab is owned elsewhere and heavy; the shell only has to host it.
vi.mock("@/panel/components/EditTab", () => ({
  EditTab: () => <div>edit tab</div>,
}))
vi.mock("@/shared/export", () => ({ buildExport: vi.fn() }))
// The real bridge loads the dev mock lazily when not embedded; tests use the same mock synchronously.
vi.mock("@/panel/bridge", async (orig) => ({
  ...(await orig<typeof import("@/panel/bridge")>()),
  usePanel: vi.fn(),
}))
const build = vi.mocked(buildExport)

let root: Root | undefined
let host: HTMLElement

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
beforeEach(() => {
  const store = createMockStore(null)
  vi.mocked(usePanel).mockImplementation(() => {
    const { state, connected } = useSyncExternalStore(
      store.subscribe,
      store.get
    )
    return { state, connected, send: store.send }
  })
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})

function mount() {
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  act(() => root!.render(<App />))
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute("aria-label") === name
  )
const click = (el: Element | null | undefined) =>
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
// Radix tabs activate on mousedown, not click.
const openChangesTab = () =>
  act(() =>
    host
      .querySelectorAll("[role=tab]")[1]
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  )

describe("App without a connection", () => {
  it("says it is connecting, then explains what to do after 5s instead of spinning for ever", () => {
    vi.useFakeTimers()
    try {
      host = document.body.appendChild(document.createElement("div"))
      root = createRoot(host)
      vi.mocked(usePanel).mockReturnValue({
        state: null,
        connected: false,
        send: vi.fn(),
      })
      act(() => root!.render(<App />))
      expect(host.textContent).toBe("Connecting to page…")
      act(() => void vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1))
      expect(host.textContent).toBe("Connecting to page…")
      act(() => void vi.advanceTimersByTime(1))
      expect(host.textContent).toBe(
        "Couldn't reach the page. Reload the tab and click the Redline icon again."
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("App shell", () => {
  it("renders header, tabs, and hosts the Edit tab", () => {
    build.mockReturnValue("PROMPT")
    mount()
    expect(host.textContent).toContain("Redline")
    expect(host.textContent).toContain("edit tab")
    expect(host.querySelectorAll("[role=tab]")).toHaveLength(2)
    expect(
      host
        .querySelector("[role=radio][aria-checked=true]")
        ?.getAttribute("aria-label")
    ).toBe("Select & edit")
  })

  it("mode toggle talks to the host and a click on the active mode keeps it selected", () => {
    build.mockReturnValue("PROMPT")
    mount()
    click(button("Drag & drop"))
    expect(
      host
        .querySelector("[role=radio][aria-checked=true]")
        ?.getAttribute("aria-label")
    ).toBe("Drag & drop")
    click(button("Drag & drop"))
    expect(
      host
        .querySelector("[role=radio][aria-checked=true]")
        ?.getAttribute("aria-label")
    ).toBe("Drag & drop")
  })

  it("Copy for AI writes the exporter's text to the clipboard and confirms", async () => {
    build.mockReturnValue("PROMPT")
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    mount()
    await act(async () => click(button("Copy for AI")))
    expect(writeText).toHaveBeenCalledWith("PROMPT")
    expect(button("Copied")).toBeDefined()
  })

  it("passes the trimmed note to the exporter", () => {
    build.mockReturnValue("PROMPT")
    mount()
    openChangesTab()
    const ta = host.querySelector<HTMLTextAreaElement>("#redline-note")!
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(ta, "  use tailwind  ")
      ta.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(build.mock.lastCall?.[1]).toMatchObject({
      note: "use tailwind",
      capturedAt: expect.stringMatching(/^\d{4}-/),
    })
  })

  it("degrades instead of crashing when the exporter throws", () => {
    build.mockImplementation(() => {
      throw new Error("boom")
    })
    mount()
    expect(button("Copy for AI")?.disabled).toBe(true)
    expect(host.textContent).toContain("Could not build the prompt")
  })
})
