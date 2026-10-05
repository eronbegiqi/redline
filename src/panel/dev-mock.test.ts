import { describe, expect, it } from "vitest"

import { createMockStore } from "@/panel/dev-mock"

describe("dev mock", () => {
  it("variants: default has selection + changes, empty has neither, many is long", () => {
    const def = createMockStore(null).get().state!
    expect(def.selection).not.toBeNull()
    expect(def.changes.length).toBeGreaterThan(5)
    const empty = createMockStore("empty").get().state!
    expect([empty.selection, empty.changes]).toEqual([null, []])
    expect(createMockStore("many").get().state!.changes.length).toBe(40)
  })

  it("send mutates state, notifies, and swaps the snapshot object", () => {
    const store = createMockStore(null)
    let calls = 0
    store.subscribe(() => calls++)
    const before = store.get()

    store.send({ type: "setMode", mode: "browse" })
    store.send({ type: "setRecording", on: true })
    expect(store.get()).not.toBe(before)
    expect(store.get().state).toMatchObject({ mode: "browse", recording: true })
    expect(calls).toBe(2)

    const n = store.get().state!.changes.length
    store.send({ type: "revert", id: "c1" })
    expect(store.get().state!.changes).toHaveLength(n - 1)
    store.send({ type: "revertAll" })
    expect(store.get().state!.changes).toEqual([])
  })

  it("edits addressed to another element are ignored", () => {
    const s = createMockStore(null)
    s.send({ type: "revertAll" })
    s.send({ type: "setStyle", el: "e99", prop: "color", value: "red" })
    s.send({ type: "setText", el: "e99", text: "x" })
    s.send({ type: "action", el: "e99", action: "delete" })
    expect(s.get().state!.changes).toEqual([])
    expect(s.get().state!.selection).not.toBeNull()
  })

  it("setStyle merges edits of the same property into one entry", () => {
    const store = createMockStore("empty")
    store.send({ type: "setStyle", el: "e1", prop: "color", value: "red" }) // no selection: ignored
    expect(store.get().state!.changes).toEqual([])

    const s = createMockStore(null)
    s.send({ type: "revertAll" })
    s.send({ type: "setStyle", el: "e1", prop: "color", value: "red" })
    s.send({ type: "setStyle", el: "e1", prop: "color", value: "blue" })
    const [c, ...rest] = s.get().state!.changes
    expect(rest).toEqual([])
    expect(c).toMatchObject({
      kind: "style",
      prop: "color",
      before: "rgb(255, 255, 255)",
      after: "blue",
    })
  })
})
