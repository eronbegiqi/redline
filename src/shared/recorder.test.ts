import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Recorder } from "./recorder"
import type { Change, Descriptor, NewChange } from "./types"

const d = (selector: string, extra: Partial<Descriptor> = {}): Descriptor => ({
  selector,
  tag: "div",
  classes: [],
  ...extra,
})
const base = (el: string) => ({
  el,
  target: d(`#${el}`),
  origin: "panel" as const,
})

const style = (
  el: string,
  prop: string,
  before: string | null,
  after: string | null,
  revert?: () => void
): NewChange => ({
  ...base(el),
  kind: "style",
  prop,
  before,
  after,
  revert,
})
const text = (
  el: string,
  before: string,
  after: string,
  textNode = 0,
  revert?: () => void
): NewChange => ({
  ...base(el),
  kind: "text",
  textNode,
  before,
  after,
  revert,
})
const attr = (
  el: string,
  name: string,
  before: string | null,
  after: string | null,
  revert?: () => void
): NewChange => ({
  ...base(el),
  kind: "attr",
  name,
  before,
  after,
  revert,
})
const cls = (
  el: string,
  added: string[],
  removed: string[],
  revert?: () => void
): NewChange => ({
  ...base(el),
  kind: "class",
  added,
  removed,
  revert,
})
const move = (
  el: string,
  fromParent: string,
  fromIdx: number,
  toParent: string,
  toIdx: number,
  revert?: () => void
): NewChange => ({
  ...base(el),
  kind: "move",
  from: { parent: d(fromParent), index: fromIdx },
  to: { parent: d(toParent), index: toIdx },
  revert,
})
const del = (el: string, revert?: () => void): NewChange => ({
  ...base(el),
  kind: "delete",
  revert,
})
const ins = (el: string, revert?: () => void): NewChange => ({
  ...base(el),
  kind: "insert",
  placement: { parent: d("ul.list"), index: 4 },
  html: "<li>x</li>",
  revert,
})

/** A revert that appends its label to `log`. */
const rv = (log: string[], label: string) => () => {
  log.push(label)
}

function hasFunction(v: unknown): boolean {
  if (typeof v === "function") return true
  if (v && typeof v === "object") return Object.values(v).some(hasFunction)
  return false
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("ids", () => {
  it("numbers entries c1, c2, ... and never reuses an id, even after cancels and reverts", () => {
    const rec = new Recorder()
    expect(rec.record(style("e1", "color", "a", "b"))?.id).toBe("c1")
    expect(rec.record(text("e2", "x", "y"))?.id).toBe("c2")
    expect(rec.record(style("e1", "color", "b", "a"))).toBeNull() // cancels c1
    expect(rec.record(attr("e3", "href", "/a", "/b"))?.id).toBe("c3")
    rec.revert("c3")
    expect(rec.record(attr("e3", "href", "/a", "/b"))?.id).toBe("c4")
  })

  it("a change that is a no-op from the start does not consume an id", () => {
    const rec = new Recorder()
    expect(rec.record(style("e1", "color", "red", "RED"))).toBeNull()
    expect(rec.record(style("e1", "color", "red", "blue"))?.id).toBe("c1")
  })

  it("keeps the id (and position) of an entry across merges", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b"))
    rec.record(text("e2", "x", "y"))
    const merged = rec.record(style("e1", "color", "b", "c"))
    expect(merged?.id).toBe("c1")
    expect(rec.list().map((c) => c.id)).toEqual(["c1", "c2"])
  })

  it("stamps `at` on creation and moves it forward on merge", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b"))
    rec.record(text("e2", "x", "y"))
    vi.setSystemTime(5_000)
    rec.record(style("e1", "color", "b", "c"))
    const [c1, c2] = rec.list()
    expect(c1.at).toBe(5_000)
    expect(c2.at).toBe(1_000)
  })
})

describe("merge table", () => {
  type Row = [
    name: string,
    first: NewChange,
    second: NewChange,
    expected: Partial<Change> | null,
  ]

  const rows: Row[] = [
    // style: before = first.before, after = last.after, cancels when equal (trim + case-insensitive, null == null)
    [
      "style: before from first, after from last",
      style("e1", "color", "a", "b"),
      style("e1", "color", "b", "c"),
      { kind: "style", before: "a", after: "c" },
    ],
    [
      "style: back to the original cancels",
      style("e1", "color", "a", "b"),
      style("e1", "color", "b", "a"),
      null,
    ],
    [
      "style: cancel ignores case and outer whitespace",
      style("e1", "color", "red", "blue"),
      style("e1", "color", "blue", "  RED "),
      null,
    ],
    [
      "style: unset -> set -> removed cancels (null == null)",
      style("e1", "color", null, "red"),
      style("e1", "color", "red", null),
      null,
    ],
    [
      "style: unset -> set -> other keeps before null",
      style("e1", "color", null, "red"),
      style("e1", "color", "red", "blue"),
      { before: null, after: "blue" },
    ],
    [
      "style: set -> other -> removed keeps after null",
      style("e1", "color", "red", "blue"),
      style("e1", "color", "blue", null),
      { before: "red", after: null },
    ],
    [
      "style: inner whitespace is significant",
      style("e1", "margin", "0 4px", "1px"),
      style("e1", "margin", "1px", "0  4px"),
      { before: "0 4px", after: "0  4px" },
    ],

    // text: strict equality
    [
      "text: before from first, after from last",
      text("e1", "Hello", "Hi"),
      text("e1", "Hi", "Hey"),
      { kind: "text", before: "Hello", after: "Hey" },
    ],
    [
      "text: back to the original cancels",
      text("e1", "Hello", "Hi"),
      text("e1", "Hi", "Hello"),
      null,
    ],
    [
      "text: case differences are real edits",
      text("e1", "Hello", "Hi"),
      text("e1", "Hi", "hello"),
      { before: "Hello", after: "hello" },
    ],

    // attr: strict equality (values like href / data-state are case-sensitive), null == null
    [
      "attr: before from first, after from last",
      attr("e1", "href", "/a", "/b"),
      attr("e1", "href", "/b", "/c"),
      { kind: "attr", before: "/a", after: "/c" },
    ],
    [
      "attr: back to the original cancels",
      attr("e1", "href", "/a", "/b"),
      attr("e1", "href", "/b", "/a"),
      null,
    ],
    [
      "attr: absent -> set -> removed cancels",
      attr("e1", "title", null, "x"),
      attr("e1", "title", "x", null),
      null,
    ],
    [
      "attr: case differences are real edits",
      attr("e1", "data-state", "Open", "closed"),
      attr("e1", "data-state", "closed", "open"),
      { before: "Open", after: "open" },
    ],

    // class: net added / removed sets
    [
      "class: add then remove cancels",
      cls("e1", ["a"], []),
      cls("e1", [], ["a"]),
      null,
    ],
    [
      "class: remove then add cancels",
      cls("e1", [], ["a"]),
      cls("e1", ["a"], []),
      null,
    ],
    [
      "class: adds accumulate",
      cls("e1", ["a"], []),
      cls("e1", ["b"], []),
      { kind: "class", added: ["a", "b"], removed: [] },
    ],
    [
      "class: removes accumulate",
      cls("e1", [], ["x"]),
      cls("e1", [], ["y"]),
      { added: [], removed: ["x", "y"] },
    ],
    [
      "class: add many, remove one",
      cls("e1", ["a", "b"], []),
      cls("e1", [], ["a"]),
      { added: ["b"], removed: [] },
    ],
    [
      "class: mixed net",
      cls("e1", ["a"], ["b"]),
      cls("e1", ["c"], ["a"]),
      { added: ["c"], removed: ["b"] },
    ],
    [
      "class: adding the same class twice dedupes",
      cls("e1", ["a"], []),
      cls("e1", ["a"], []),
      { added: ["a"], removed: [] },
    ],
    [
      "class: partial cancel leaves the rest",
      cls("e1", ["a"], ["b"]),
      cls("e1", [], ["a"]),
      { added: [], removed: ["b"] },
    ],

    // move: from = first.from, to = last.to, cancels when back at the original parent selector + index
    [
      "move: from first, to last",
      move("e1", "ul.a", 3, "ul.a", 1),
      move("e1", "ul.a", 1, "ul.b", 0),
      {
        kind: "move",
        from: { parent: d("ul.a"), index: 3 },
        to: { parent: d("ul.b"), index: 0 },
      },
    ],
    [
      "move: back home cancels",
      move("e1", "ul.a", 3, "ul.b", 0),
      move("e1", "ul.b", 0, "ul.a", 3),
      null,
    ],
    [
      "move: same parent, other index is not home",
      move("e1", "ul.a", 3, "ul.a", 1),
      move("e1", "ul.a", 1, "ul.a", 2),
      {
        from: { parent: d("ul.a"), index: 3 },
        to: { parent: d("ul.a"), index: 2 },
      },
    ],
    [
      "move: same index, other parent is not home",
      move("e1", "ul.a", 3, "ul.b", 0),
      move("e1", "ul.b", 0, "ul.b", 3),
      {
        from: { parent: d("ul.a"), index: 3 },
        to: { parent: d("ul.b"), index: 3 },
      },
    ],
  ]

  it.each(rows)("%s", (_name, first, second, expected) => {
    const rec = new Recorder()
    const a = rec.record(first)
    expect(a).not.toBeNull()
    const b = rec.record(second)
    if (expected === null) {
      expect(b).toBeNull()
      expect(rec.list()).toEqual([])
    } else {
      expect(b).toMatchObject({ ...expected, id: a!.id })
      expect(rec.list()).toHaveLength(1)
      expect(rec.list()[0]).toMatchObject({ ...expected, id: a!.id })
    }
  })

  it("keeps the first target and origin when merging", () => {
    const rec = new Recorder()
    rec.record({
      ...style("e1", "color", "a", "b"),
      target: d("#first"),
      origin: "panel",
    })
    rec.record({
      ...style("e1", "color", "b", "c"),
      target: d("#second"),
      origin: "devtools",
    })
    expect(rec.list()[0]).toMatchObject({
      target: { selector: "#first" },
      origin: "panel",
      before: "a",
      after: "c",
    })
  })

  it("collapses 10 successive style edits into one entry and reverts them newest to oldest", () => {
    const rec = new Recorder()
    const log: string[] = []
    for (let i = 1; i <= 10; i++) {
      const before = i === 1 ? "rgb(0, 0, 0)" : `v${i - 1}`
      rec.record(style("e1", "color", before, `v${i}`, rv(log, `r${i}`)))
    }
    expect(rec.list()).toHaveLength(1)
    expect(rec.list()[0]).toMatchObject({
      id: "c1",
      prop: "color",
      before: "rgb(0, 0, 0)",
      after: "v10",
    })
    rec.revert("c1")
    expect(log).toEqual([
      "r10",
      "r9",
      "r8",
      "r7",
      "r6",
      "r5",
      "r4",
      "r3",
      "r2",
      "r1",
    ])
    expect(rec.list()).toEqual([])
  })

  it("edit then undo-to-original cancels without running any revert", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "red", "blue", rv(log, "r1")))
    rec.record(style("e1", "color", "blue", "green", rv(log, "r2")))
    expect(
      rec.record(style("e1", "color", "green", "red", rv(log, "r3")))
    ).toBeNull()
    expect(rec.list()).toEqual([])
    expect(log).toEqual([])
  })

  it("a revert recorded with a cancelling merge is discarded too, and the key starts fresh afterwards", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "red", "blue", rv(log, "old")))
    rec.record(style("e1", "color", "blue", "red", rv(log, "cancel")))
    const again = rec.record(
      style("e1", "color", "red", "green", rv(log, "new"))
    )
    expect(again).toMatchObject({ id: "c2", before: "red", after: "green" })
    rec.revert("c2")
    expect(log).toEqual(["new"])
  })

  it.each<[string, NewChange, NewChange]>([
    [
      "other element",
      style("e1", "color", "a", "b"),
      style("e2", "color", "b", "c"),
    ],
    [
      "other style prop",
      style("e1", "color", "a", "b"),
      style("e1", "background-color", "b", "c"),
    ],
    ["other text node", text("e1", "a", "b", 0), text("e1", "b", "c", 1)],
    [
      "other attribute",
      attr("e1", "href", "a", "b"),
      attr("e1", "title", "b", "c"),
    ],
    ["other element (class)", cls("e1", ["a"], []), cls("e2", ["b"], [])],
    [
      "other element (move)",
      move("e1", "ul", 0, "ul", 1),
      move("e2", "ul", 1, "ul", 2),
    ],
    [
      "style vs attr of the same name",
      style("e1", "color", "a", "b"),
      attr("e1", "color", "a", "b"),
    ],
    ["delete never merges", del("e1"), del("e1")],
    ["insert never merges", ins("e1"), ins("e1")],
  ])("does not merge: %s", (_name, first, second) => {
    const rec = new Recorder()
    rec.record(first)
    rec.record(second)
    expect(rec.list().map((c) => c.id)).toEqual(["c1", "c2"])
  })

  it.each<[string, NewChange]>([
    ["style", style("e1", "color", "red", " RED")],
    ["style unset -> unset", style("e1", "color", null, null)],
    ["text", text("e1", "same", "same")],
    ["attr", attr("e1", "href", "/a", "/a")],
    ["attr null -> null", attr("e1", "href", null, null)],
    ["class", cls("e1", [], [])],
    ["move", move("e1", "ul.a", 2, "ul.a", 2)],
  ])("a fresh no-op returns null and leaves no entry: %s", (_name, nc) => {
    const rec = new Recorder()
    expect(rec.record(nc)).toBeNull()
    expect(rec.list()).toEqual([])
  })

  it("returns the merged entry and a text node keeps its own merge key", () => {
    const rec = new Recorder()
    rec.record(text("e1", "a", "b", 0))
    rec.record(text("e1", "x", "y", 2))
    const merged = rec.record(text("e1", "b", "c", 0))
    expect(merged).toMatchObject({
      id: "c1",
      textNode: 0,
      before: "a",
      after: "c",
    })
    expect(rec.list()).toHaveLength(2)
  })
})

describe("delete", () => {
  it.each<[string, () => NewChange]>([
    ["style", () => style("e1", "color", "a", "b")],
    ["text", () => text("e1", "a", "b")],
    ["attr", () => attr("e1", "href", "/a", "/b")],
    ["class", () => cls("e1", ["a"], [])],
    ["move", () => move("e1", "ul", 0, "ul", 2)],
  ])(
    "absorbs an earlier %s entry for the same element but not other elements'",
    (_name, make) => {
      const rec = new Recorder()
      rec.record(style("e2", "color", "a", "b"))
      rec.record(make())
      const out = rec.record(del("e1"))
      expect(out).toMatchObject({ kind: "delete", el: "e1", id: "c3" })
      expect(rec.list().map((c) => [c.id, c.el, c.kind])).toEqual([
        ["c1", "e2", "style"],
        ["c3", "e1", "delete"],
      ])
    }
  )

  it("restores the element first, then runs absorbed reverts newest to oldest across entries", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "style#1")))
    rec.record(cls("e1", ["x"], [], rv(log, "class")))
    rec.record(style("e1", "color", "b", "c", rv(log, "style#2"))) // merges into the first entry
    rec.record(text("e2", "p", "q", 0, rv(log, "other element")))
    const out = rec.record(del("e1", rv(log, "restore element")))
    expect(rec.list().map((c) => c.kind)).toEqual(["text", "delete"])
    rec.revert(out!.id)
    expect(log).toEqual(["restore element", "style#2", "class", "style#1"])
    expect(rec.list().map((c) => c.el)).toEqual(["e2"]) // nothing else touched
  })

  it("revertAll runs the delete (and what it absorbed) in global newest-first order", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "e1 style")))
    rec.record(text("e2", "p", "q", 0, rv(log, "e2 text")))
    rec.record(del("e1", rv(log, "e1 delete")))
    rec.revertAll()
    expect(log).toEqual(["e1 delete", "e2 text", "e1 style"])
  })

  it("deleting an element created this session removes the insert and its edits, returns null, runs no reverts", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b"))
    rec.record(ins("e5", rv(log, "insert")))
    rec.record(style("e5", "color", "a", "b", rv(log, "style")))
    rec.record(move("e5", "ul.list", 4, "ul.list", 0, rv(log, "move")))
    expect(rec.record(del("e5", rv(log, "delete")))).toBeNull()
    expect(rec.list().map((c) => c.el)).toEqual(["e1"])
    expect(log).toEqual([])
    expect(rec.record(text("e9", "a", "b"))?.id).toBe("c5") // the cancelled delete used no id
  })

  it("deleting a different element than the inserted one is an ordinary delete", () => {
    const rec = new Recorder()
    rec.record(ins("e5"))
    expect(rec.record(del("e6"))).toMatchObject({ kind: "delete", el: "e6" })
    expect(rec.list().map((c) => c.kind)).toEqual(["insert", "delete"])
  })

  it("a later edit to the same element after its delete is a normal entry", () => {
    const rec = new Recorder()
    rec.record(del("e1"))
    expect(rec.record(style("e1", "color", "a", "b"))).toMatchObject({
      id: "c2",
      kind: "style",
    })
  })
})

describe("revert", () => {
  it("runs reverts newest to oldest (merged entry) and drops only that entry", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "r1")))
    rec.record(text("e2", "x", "y", 0, rv(log, "other")))
    rec.record(style("e1", "color", "b", "c", rv(log, "r2")))
    rec.record(style("e1", "color", "c", "d", rv(log, "r3")))
    rec.revert("c1")
    expect(log).toEqual(["r3", "r2", "r1"])
    expect(rec.list().map((c) => c.id)).toEqual(["c2"])
  })

  it("runs both reverts of a merged class entry", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(cls("e1", ["a"], [], rv(log, "add a")))
    rec.record(cls("e1", [], ["b"], rv(log, "remove b")))
    rec.revert("c1")
    expect(log).toEqual(["remove b", "add a"])
  })

  it("is a no-op for unknown ids and for an id that was already reverted", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "r")))
    rec.revert("nope")
    expect(rec.list()).toHaveLength(1)
    rec.revert("c1")
    rec.revert("c1")
    expect(log).toEqual(["r"])
  })

  it("drops an entry that has no revert function", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b"))
    expect(() => rec.revert("c1")).not.toThrow()
    expect(rec.list()).toEqual([])
  })

  it("a throwing revert does not stop the others, and the entry is still dropped", () => {
    const rec = new Recorder()
    const log: string[] = []
    const n = vi.fn()
    rec.record(style("e1", "color", "a", "b", rv(log, "r1")))
    rec.record(
      style("e1", "color", "b", "c", () => {
        throw new Error("boom")
      })
    )
    rec.record(style("e1", "color", "c", "d", rv(log, "r3")))
    rec.subscribe(n)
    expect(() => rec.revert("c1")).not.toThrow()
    expect(log).toEqual(["r3", "r1"])
    expect(rec.list()).toEqual([])
    expect(n).toHaveBeenCalledTimes(1)
  })
})

describe("undo", () => {
  it("reverts the most recent entry", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "first")))
    rec.record(text("e2", "x", "y", 0, rv(log, "second")))
    rec.undo()
    expect(log).toEqual(["second"])
    expect(rec.list().map((c) => c.id)).toEqual(["c1"])
    rec.undo()
    expect(log).toEqual(["second", "first"])
    expect(rec.list()).toEqual([])
  })

  it("treats an entry as most recent when it was just merged into", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "e1 a")))
    rec.record(text("e2", "x", "y", 0, rv(log, "e2")))
    rec.record(style("e1", "color", "b", "c", rv(log, "e1 b")))
    rec.undo()
    expect(log).toEqual(["e1 b", "e1 a"])
    expect(rec.list().map((c) => c.id)).toEqual(["c2"])
  })

  it("is a no-op on an empty log", () => {
    const rec = new Recorder()
    expect(() => rec.undo()).not.toThrow()
  })
})

describe("revertAll", () => {
  it("runs every revert in global newest-first order (merges included) and clears the log", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "1")))
    rec.record(text("e2", "x", "y", 0, rv(log, "2")))
    rec.record(style("e1", "color", "b", "c", rv(log, "3")))
    rec.record(del("e3", rv(log, "4")))
    rec.revertAll()
    expect(log).toEqual(["4", "3", "2", "1"])
    expect(rec.list()).toEqual([])
  })

  it("keeps going when a revert throws", () => {
    const rec = new Recorder()
    const log: string[] = []
    rec.record(style("e1", "color", "a", "b", rv(log, "1")))
    rec.record(
      text("e2", "x", "y", 0, () => {
        throw new Error("boom")
      })
    )
    rec.record(attr("e3", "href", "/a", "/b", rv(log, "3")))
    expect(() => rec.revertAll()).not.toThrow()
    expect(log).toEqual(["3", "1"])
    expect(rec.list()).toEqual([])
  })

  it("ids keep counting after a revertAll", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b"))
    rec.revertAll()
    expect(rec.record(style("e1", "color", "a", "b"))?.id).toBe("c2")
  })
})

describe("subscribe", () => {
  const seed = (rec: Recorder) => {
    rec.record(style("e1", "color", "a", "b"))
    rec.record(text("e1", "x", "y"))
    rec.record(cls("e1", ["k"], []))
  }

  // Each public mutating call that changes the log notifies exactly once, however many entries it touches.
  it.each<[string, (rec: Recorder) => void, (rec: Recorder) => void]>([
    [
      "record: new entry",
      () => {},
      (r) => void r.record(style("e9", "color", "a", "b")),
    ],
    [
      "record: merge",
      seed,
      (r) => void r.record(style("e1", "color", "b", "c")),
    ],
    [
      "record: cancelling merge",
      seed,
      (r) => void r.record(style("e1", "color", "b", "a")),
    ],
    [
      "record: delete absorbing three entries",
      seed,
      (r) => void r.record(del("e1")),
    ],
    [
      "record: delete cancelling an insert",
      (r) => {
        r.record(ins("e5"))
        r.record(style("e5", "color", "a", "b"))
      },
      (r) => void r.record(del("e5")),
    ],
    ["revert", seed, (r) => r.revert("c2")],
    ["undo", seed, (r) => r.undo()],
    ["revertAll over three entries", seed, (r) => r.revertAll()],
  ])("fires once for %s", (_name, setup, act) => {
    const rec = new Recorder()
    setup(rec)
    const n = vi.fn()
    rec.subscribe(n)
    act(rec)
    expect(n).toHaveBeenCalledTimes(1)
  })

  it.each<[string, (rec: Recorder) => void]>([
    [
      "record: fresh no-op",
      (r) => void r.record(style("e1", "color", "a", "A")),
    ],
    ["revert: unknown id", (r) => r.revert("c99")],
    ["undo: empty log", (r) => r.undo()],
    ["revertAll: empty log", (r) => r.revertAll()],
    ["list", (r) => void r.list()],
  ])("does not fire when the log did not change: %s", (_name, act) => {
    const rec = new Recorder()
    const n = vi.fn()
    rec.subscribe(n)
    act(rec)
    expect(n).not.toHaveBeenCalled()
  })

  it("sees the already-updated log", () => {
    const rec = new Recorder()
    const seen: number[] = []
    rec.subscribe(() => seen.push(rec.list().length))
    rec.record(style("e1", "color", "a", "b"))
    rec.record(text("e1", "x", "y"))
    rec.revert("c1")
    rec.revertAll()
    expect(seen).toEqual([1, 2, 1, 0])
  })

  it("unsubscribe stops notifications; the same function subscribed twice gets two handles", () => {
    const rec = new Recorder()
    const n = vi.fn()
    const off1 = rec.subscribe(n)
    const off2 = rec.subscribe(n)
    rec.record(style("e1", "color", "a", "b"))
    expect(n).toHaveBeenCalledTimes(2)
    off1()
    rec.record(style("e1", "color", "b", "c"))
    expect(n).toHaveBeenCalledTimes(3)
    off2()
    off2()
    rec.record(style("e1", "color", "c", "d"))
    expect(n).toHaveBeenCalledTimes(3)
  })

  it("a throwing subscriber neither breaks the call nor starves the others", () => {
    const rec = new Recorder()
    const n = vi.fn()
    rec.subscribe(() => {
      throw new Error("bad listener")
    })
    rec.subscribe(n)
    expect(() => rec.record(style("e1", "color", "a", "b"))).not.toThrow()
    expect(n).toHaveBeenCalledTimes(1)
    expect(rec.list()).toHaveLength(1)
  })

  it("a listener may unsubscribe itself while being notified", () => {
    const rec = new Recorder()
    const n = vi.fn()
    const off = rec.subscribe(() => off())
    rec.subscribe(n)
    rec.record(style("e1", "color", "a", "b"))
    rec.record(style("e1", "color", "b", "c"))
    expect(n).toHaveBeenCalledTimes(2)
  })
})

describe("list()", () => {
  it("returns plain data: structuredClone-safe, no closures, no revert bookkeeping", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b", () => {}))
    rec.record(text("e2", "x", "y", 0, () => {}))
    rec.record(cls("e3", ["a"], ["b"], () => {}))
    rec.record(move("e4", "ul", 0, "ul", 2, () => {}))
    rec.record(del("e5", () => {}))
    rec.record(ins("e6", () => {}))
    const list = rec.list()
    expect(list).toHaveLength(6)
    expect(() => structuredClone(list)).not.toThrow()
    expect(hasFunction(list)).toBe(false)
    for (const c of list) {
      expect(Object.keys(c)).not.toContain("revert")
      expect(Object.keys(c)).not.toContain("reverts")
    }
    expect(structuredClone(list)).toEqual(list)
  })

  it("carries the full wire shape (id, el, target, origin, at)", () => {
    const rec = new Recorder()
    rec.record({
      ...style("e1", "color", "a", "b"),
      target: d("#e1", { classes: ["x"] }),
      origin: "devtools",
    })
    expect(rec.list()).toEqual([
      {
        id: "c1",
        el: "e1",
        target: d("#e1", { classes: ["x"] }),
        origin: "devtools",
        at: 1_000,
        kind: "style",
        prop: "color",
        before: "a",
        after: "b",
      },
    ])
  })

  it("gives copies: mutating a result changes neither the log nor later results", () => {
    const rec = new Recorder()
    const returned = rec.record(cls("e1", ["a"], []))!
    ;(returned as Extract<Change, { kind: "class" }>).added.push("hacked")
    returned.target.classes.push("hacked")
    const list = rec.list()
    ;(list[0] as Extract<Change, { kind: "class" }>).added.length = 0
    list.length = 0
    expect(rec.list()).toHaveLength(1)
    expect(rec.list()[0]).toMatchObject({
      added: ["a"],
      target: { classes: [] },
    })
  })

  it("is not affected by the producer mutating what it passed in", () => {
    const rec = new Recorder()
    const nc = cls("e1", ["a"], [])
    rec.record(nc)
    ;(nc as Extract<NewChange, { kind: "class" }>).added.push("late")
    nc.target.selector = "#changed"
    expect(rec.list()[0]).toMatchObject({
      added: ["a"],
      target: { selector: "#e1" },
    })
  })

  it("keeps log order (oldest first) with the delete after what it absorbed", () => {
    const rec = new Recorder()
    rec.record(style("e1", "color", "a", "b"))
    rec.record(text("e2", "x", "y"))
    rec.record(del("e1"))
    rec.record(attr("e3", "href", "/a", "/b"))
    expect(rec.list().map((c) => [c.id, c.kind])).toEqual([
      ["c2", "text"],
      ["c3", "delete"],
      ["c4", "attr"],
    ])
  })
})
