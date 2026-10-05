import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ToContent } from "@/shared/protocol"
import type { ElementInfo } from "@/shared/types"

import { EditProvider, useEdit } from "./edit/edit-context"

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const info = (el: string) => ({ el }) as ElementInfo

let container: HTMLDivElement
let root: Root
let sent: ToContent[]
let ctx: ReturnType<typeof useEdit>
let frames: FrameRequestCallback[]

function Probe() {
  const c = useEdit()
  useEffect(() => {
    ctx = c
  })
  return null
}
const render = (el: string) =>
  act(() =>
    root.render(
      <EditProvider info={info(el)} send={(m) => void sent.push(m)}>
        <Probe />
      </EditProvider>
    )
  )
const nextFrame = () =>
  act(() => {
    const run = frames.splice(0)
    run.forEach((f) => f(0))
  })

beforeEach(() => {
  sent = []
  frames = []
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) =>
    frames.push(f)
  )
  vi.stubGlobal(
    "cancelAnimationFrame",
    (id: number) => void (frames[id - 1] = () => {})
  )
  container = document.createElement("div")
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe("EditProvider messages", () => {
  it("addresses every message to the element it was rendered for", () => {
    render("e7")
    act(() => {
      ctx.set("color", "red")
      ctx.setText("hi")
      ctx.act("hide")
    })
    expect(sent).toEqual([
      { type: "setStyle", el: "e7", prop: "color", value: "red" },
      { type: "setText", el: "e7", text: "hi" },
      { type: "action", el: "e7", action: "hide" },
    ])
  })

  it("preview coalesces to one setStyle per property per frame, latest value wins", () => {
    render("e1")
    act(() => {
      for (const v of ["#111", "#222", "#333"]) ctx.preview("color", v)
      for (const v of ["0.9", "0.5"]) ctx.preview("opacity", v)
    })
    expect(sent).toEqual([])
    nextFrame()
    expect(sent).toEqual([
      { type: "setStyle", el: "e1", prop: "color", value: "#333" },
      { type: "setStyle", el: "e1", prop: "opacity", value: "0.5" },
    ])
    nextFrame()
    expect(sent).toHaveLength(2)
  })

  it("set supersedes a queued preview of the same property and sends right away", () => {
    render("e1")
    act(() => {
      ctx.preview("color", "#111")
      ctx.set("color", "#222")
    })
    nextFrame()
    expect(sent).toEqual([
      { type: "setStyle", el: "e1", prop: "color", value: "#222" },
    ])
  })

  it("a queued preview still reaches the OLD element when the selection changes", () => {
    render("e1")
    act(() => ctx.preview("color", "#111"))
    render("e2")
    expect(sent).toEqual([
      { type: "setStyle", el: "e1", prop: "color", value: "#111" },
    ])
    nextFrame()
    expect(sent).toHaveLength(1)
  })
})
