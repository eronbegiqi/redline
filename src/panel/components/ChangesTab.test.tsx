import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ChangesTab, type Prompt } from "@/panel/components/ChangesTab"
import { createMockStore } from "@/panel/dev-mock"
import type { ToContent } from "@/shared/protocol"
import type { PanelState } from "@/shared/types"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Radix ScrollArea needs it; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

let root: Root | undefined
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function mount(state: PanelState, prompt: Prompt = { text: "# prompt" }) {
  const send = vi.fn<(m: ToContent) => void>()
  const onNoteChange = vi.fn()
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  act(() =>
    root!.render(
      <TooltipProvider>
        <ChangesTab state={state} send={send} note="" onNoteChange={onNoteChange} prompt={prompt} />
      </TooltipProvider>
    )
  )
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name)
  const click = (el: Element | undefined) => act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  return { send, onNoteChange, button, click }
}

const sample = () => createMockStore(null).get().state!

describe("ChangesTab", () => {
  it("shows an empty state and no controls without changes", () => {
    const { button } = mount({ ...sample(), changes: [] })
    expect(host.textContent).toContain("No changes yet")
    expect(button("Revert all")).toBeUndefined()
  })

  it("renders one row per change with selector, summary and a DevTools badge only for devtools origin", () => {
    const state = sample()
    mount(state)
    const rows = host.querySelectorAll('[data-slot="item"]')
    expect(rows).toHaveLength(state.changes.length)
    expect(rows[0].textContent).toContain("background-color: rgb(0, 0, 0) → rgb(59, 130, 246)")
    const badges = [...host.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent)
    expect(badges).toEqual(state.changes.filter((c) => c.origin === "devtools").map(() => "DevTools"))
  })

  it("row revert button sends the change id", () => {
    const { send, button, click } = mount(sample())
    click(button("Revert this change"))
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "revert", id: "c1" })
  })

  it("Revert all needs a second, explicit confirmation", () => {
    const state = sample()
    const { send, button, click } = mount(state)
    click(button("Revert all"))
    expect(send).not.toHaveBeenCalled()
    expect(host.textContent).toContain(`Revert all ${state.changes.length} changes?`)

    click(button("Cancel"))
    expect(host.textContent).not.toContain("changes?")
    expect(send).not.toHaveBeenCalled()

    click(button("Revert all"))
    click(button("Revert all")) // the destructive confirm button replaces the trigger
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "revertAll" })
    expect(host.textContent).not.toContain("changes?")
  })

  it("preview shows the prompt, or the exporter's error instead of throwing", () => {
    const open = (prompt: Prompt) => {
      const { button, click } = mount(sample(), prompt)
      click(button("Preview prompt"))
      return host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt preview"]')?.value
    }
    expect(open({ text: "# the prompt" })).toBe("# the prompt")
    act(() => root?.unmount())
    host.remove()
    expect(open({ error: "not implemented" })).toBe("Preview unavailable: not implemented")
  })
})
