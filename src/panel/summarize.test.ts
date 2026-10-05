import { describe, expect, it } from "vitest"

import { summarize } from "@/panel/summarize"
import type { Change, Descriptor } from "@/shared/types"

const d = (selector: string, extra: Partial<Descriptor> = {}): Descriptor => ({
  selector,
  tag: "ul",
  classes: [],
  ...extra,
})
const base = {
  id: "c1",
  el: "e1",
  target: d("a"),
  origin: "panel",
  at: 0,
} as const

describe("summarize", () => {
  it("style / attr show before → after with unset and removed", () => {
    expect(
      summarize({
        ...base,
        kind: "style",
        prop: "color",
        before: "red",
        after: "blue",
      })
    ).toBe("color: red → blue")
    expect(
      summarize({
        ...base,
        kind: "style",
        prop: "gap",
        before: null,
        after: "8px",
      })
    ).toBe("gap: unset → 8px")
    expect(
      summarize({
        ...base,
        kind: "attr",
        name: "href",
        before: "/a",
        after: null,
      })
    ).toBe("href: /a → removed")
  })

  it("clips long values", () => {
    const long = "x".repeat(100)
    const out = summarize({
      ...base,
      kind: "text",
      textNode: 0,
      before: long,
      after: "short",
    })
    expect(out.length).toBeLessThan(70)
    expect(out).toContain("…")
    expect(out.endsWith('→ "short"')).toBe(true)
  })

  it("class lists additions and removals", () => {
    expect(
      summarize({ ...base, kind: "class", added: ["a", "b"], removed: ["c"] })
    ).toBe("+a +b -c")
  })

  it("move within one parent vs across parents", () => {
    const list = d("main > ul.list", { classes: ["list"] })
    const other = d("aside > ol", { tag: "ol", id: "side" })
    const same: Change = {
      ...base,
      kind: "move",
      from: { parent: list, index: 3 },
      to: { parent: list, index: 1 },
    }
    const across: Change = {
      ...base,
      kind: "move",
      from: { parent: list, index: 3 },
      to: { parent: other, index: 0 },
    }
    expect(summarize(same)).toBe("index 3 → 1 in ul.list")
    expect(summarize(across)).toBe("ul.list[3] → ol#side[0]")
  })

  it("delete and insert", () => {
    expect(summarize({ ...base, kind: "delete" })).toBe("Element removed")
    const placement = { parent: d("ul.list", { classes: ["list"] }), index: 4 }
    expect(
      summarize({ ...base, kind: "insert", placement, html: "<li>" })
    ).toBe("Inserted at index 4 in ul.list")
    expect(
      summarize({
        ...base,
        kind: "insert",
        placement,
        html: "<li>",
        duplicateOf: d("li"),
      })
    ).toBe("Duplicate at index 4 in ul.list")
  })
})
