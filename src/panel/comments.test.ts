import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  isPlaceholder,
  loadComments,
  placeholderEl,
  saveComments,
} from "./comments"

const c = (selector: string, text: string) => ({
  el: "e9",
  target: { selector, tag: "div", classes: [] },
  text,
})

describe("saved comments", () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      get length() {
        return m.size
      },
    })
  })

  it("round-trips per page and ignores query/hash", () => {
    saveComments("http://x.test/a?q=1#h", [c("main > p", "shorter")])
    const back = loadComments("http://x.test/a")
    expect(back).toEqual([
      { ...c("main > p", "shorter"), el: placeholderEl("main > p") },
    ])
    expect(isPlaceholder(back[0].el)).toBe(true)
    expect(loadComments("http://x.test/b")).toEqual([])
  })

  it("removes the entry when the list is empty and survives junk", () => {
    saveComments("http://x.test/", [c("p", "t")])
    saveComments("http://x.test/", [])
    expect(localStorage.length).toBe(0)
    localStorage.setItem("redline:comments:http://x.test/", "{nope")
    expect(loadComments("http://x.test/")).toEqual([])
  })
})
