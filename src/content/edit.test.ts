import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  duplicateEl,
  hideEl,
  readStyles,
  recordText,
  removeEl,
  setStyle,
  setText,
} from "@/content/edit"
import type { Recorder } from "@/shared/recorder"
import { STYLE_PROPS, type NewChange } from "@/shared/types"

// Deterministic stand-ins for describe.ts. The selector says whether the element was in the document at the
// moment describe() ran, which is how we assert "describe BEFORE the DOM write".
vi.mock("@/content/describe", () => {
  const ids = new WeakMap<Element, string>()
  let n = 0
  const desc = (el: Element) => ({
    selector: `${el.isConnected ? "dom" : "detached"}:${el.localName}${el.id ? "#" + el.id : ""}`,
    tag: el.localName,
    classes: [...el.classList],
    text: [...el.childNodes]
      .filter((c) => c.nodeType === 3)
      .map((c) => (c as Text).data)
      .join("")
      .trim(),
  })
  return {
    elementId: (el: Element) => {
      if (!ids.has(el)) ids.set(el, `e${++n}`)
      return ids.get(el)
    },
    describe: desc,
    redescribe: desc,
    placementOf: (el: Element) => ({
      parent: desc(el.parentElement!),
      index: [...el.parentElement!.children].indexOf(el),
    }),
  }
})

function fakeRec() {
  const changes: NewChange[] = []
  const rec = {
    record: (nc: NewChange) => {
      changes.push(nc)
      return null
    },
  } as unknown as Recorder
  return { rec, changes }
}

const html = (s: string) => {
  document.body.innerHTML = s
  return document.body
}

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

describe("readStyles", () => {
  it("returns every STYLE_PROPS key with computed values", () => {
    const el = html(
      `<p style="color: red; font-size: 20px">x</p>`
    ).firstElementChild!
    const s = readStyles(el)
    expect(Object.keys(s)).toEqual([...STYLE_PROPS])
    expect(s.color).toMatch(/^(red|rgb\(255, 0, 0\))$/)
    expect(s["font-size"]).toBe("20px")
  })

  it("gives empty strings for an element that can't be styled", () => {
    const s = readStyles(document.createElement("div")) // detached
    expect(Object.keys(s)).toHaveLength(STYLE_PROPS.length)
    for (const v of Object.values(s)) expect(typeof v).toBe("string")
  })
})

describe("setStyle", () => {
  it("uses the computed value as `before` when nothing is inline, and previews with !important", () => {
    document.head.innerHTML = `<style>p { color: blue }</style>`
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: "style",
      prop: "color",
      before: "rgb(0, 0, 255)", // computed form
      after: "red", // plain value, no priority
      origin: "panel",
      el: expect.stringMatching(/^e\d+$/),
    })
    expect(p.style.getPropertyValue("color")).toBe("red")
    expect(p.style.getPropertyPriority("color")).toBe("important")
  })

  it("uses the existing inline value as `before`", () => {
    const p = html(`<p style="color: green">x</p>`)
      .firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    expect(changes[0]).toMatchObject({ before: "green", after: "red" })
  })

  it("describes the element before touching it", () => {
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    expect(changes[0].target.selector).toBe("dom:p")
  })

  it("value '' removes the inline property (after = null) and revert restores value + priority exactly", () => {
    const p = html(`<p style="color: green !important">x</p>`)
      .firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "")
    expect(changes[0]).toMatchObject({
      kind: "style",
      before: "green",
      after: null,
    })
    expect(p.style.getPropertyValue("color")).toBe("")
    changes[0].revert!()
    expect(p.style.getPropertyValue("color")).toBe("green")
    expect(p.style.getPropertyPriority("color")).toBe("important")
  })

  it("revert puts back a previous inline declaration that had NO priority (not !important)", () => {
    const p = html(`<p style="color: green">x</p>`)
      .firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    changes[0].revert!()
    expect(p.style.getPropertyValue("color")).toBe("green")
    expect(p.style.getPropertyPriority("color")).toBe("")
  })

  it("revert removes the property when nothing was inline before", () => {
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    changes[0].revert!()
    expect(p.style.getPropertyValue("color")).toBe("")
    expect(p.hasAttribute("style")).toBe(false) // no style="" left behind
  })

  it("chained edits revert newest to oldest back to the original", () => {
    const p = html(`<p style="color: green">x</p>`)
      .firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red")
    setStyle(rec, p, "color", "blue")
    expect(changes[1]).toMatchObject({ before: "red", after: "blue" })
    changes[1].revert!()
    expect(p.style.getPropertyValue("color")).toBe("red")
    changes[0].revert!()
    expect(p.style.getPropertyValue("color")).toBe("green")
  })

  it("is a no-op when removing a property that was never set inline", () => {
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "")
    expect(changes).toHaveLength(0)
  })

  it("is a no-op when the value equals what is already there (and leaves no inline residue)", () => {
    const p = html(`<p style="color: red">x</p>`)
      .firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "RED ")
    expect(changes).toHaveLength(0)
    expect(p.style.getPropertyPriority("color")).toBe("")
  })

  it("ignores values the browser would reject instead of logging a change that never happened", () => {
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "not a colour")
    expect(changes).toHaveLength(0)
    expect(p.getAttribute("style")).toBeNull()
  })

  it("accepts a typed '!important' suffix without breaking the write", () => {
    const p = html(`<p>x</p>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    setStyle(rec, p, "color", "red !important")
    expect(changes[0]).toMatchObject({ after: "red" })
    expect(p.style.getPropertyValue("color")).toBe("red")
  })

  it("never throws: element without .style, throwing recorder", () => {
    const foreign = document.createElementNS("http://example.com/ns", "x")
    const { rec, changes } = fakeRec()
    expect(() => setStyle(rec, foreign, "color", "red")).not.toThrow()
    expect(changes).toHaveLength(0)
    const p = html(`<p>x</p>`).firstElementChild!
    const bad = {
      record: () => {
        throw new Error("boom")
      },
    } as unknown as Recorder
    expect(() => setStyle(bad, p, "color", "red")).not.toThrow()
  })
})

describe("setText", () => {
  it("replaces textContent and records before/after with textNode 0", () => {
    const p = html(`<p>Hello</p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    setText(rec, p, "World")
    expect(p.textContent).toBe("World")
    expect(changes[0]).toMatchObject({
      kind: "text",
      textNode: 0,
      before: "Hello",
      after: "World",
      origin: "panel",
    })
  })

  it("describes the element before the write (target.text is the ORIGINAL text)", () => {
    const p = html(`<p>Hello</p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    setText(rec, p, "World")
    expect(changes[0].target.text).toBe("Hello")
  })

  it("revert restores the very same child nodes", () => {
    const p = html(`<p>Hi <b>there</b>!</p>`).firstElementChild!
    const before = [...p.childNodes]
    const { rec, changes } = fakeRec()
    setText(rec, p, "Gone")
    expect(p.childNodes).toHaveLength(1)
    changes[0].revert!()
    expect([...p.childNodes]).toEqual(before)
    expect(p.innerHTML).toBe("Hi <b>there</b>!")
  })

  it("revert works for a previously empty element", () => {
    const p = html(`<p></p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    setText(rec, p, "x")
    changes[0].revert!()
    expect(p.childNodes).toHaveLength(0)
  })

  it("is a no-op when the text is unchanged", () => {
    const p = html(`<p>Same</p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    setText(rec, p, "Same")
    expect(changes).toHaveLength(0)
  })
})

describe("recordText", () => {
  it("records without touching the DOM; revert sets textContent back to `before`", () => {
    const p = html(`<p>New</p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    recordText(rec, p, "Old", "New")
    expect(p.textContent).toBe("New")
    expect(changes[0]).toMatchObject({
      kind: "text",
      textNode: 0,
      before: "Old",
      after: "New",
      origin: "panel",
    })
    changes[0].revert!()
    expect(p.textContent).toBe("Old")
  })

  it("is a no-op when nothing changed", () => {
    const p = html(`<p>x</p>`).firstElementChild!
    const { rec, changes } = fakeRec()
    recordText(rec, p, "x", "x")
    expect(changes).toHaveLength(0)
  })
})

describe("removeEl", () => {
  it("removes the element, describes it while still attached, and records a delete", () => {
    const ul = html(
      `<ul><li id="a">a</li><li id="b">b</li></ul>`
    ).firstElementChild!
    const b = ul.querySelector("#b")!
    const { rec, changes } = fakeRec()
    removeEl(rec, b)
    expect(ul.children).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: "delete", origin: "panel" })
    expect(changes[0].target.selector).toBe("dom:li#b")
  })

  it("revert re-inserts at the original position, between other nodes", () => {
    const ul = html(
      `<ul><li>a</li> text <li id="b">b</li> text2 <li>c</li></ul>`
    ).firstElementChild!
    const b = ul.querySelector("#b")!
    const { rec, changes } = fakeRec()
    removeEl(rec, b)
    const without = ul.innerHTML
    expect(without).not.toContain('id="b"')
    changes[0].revert!()
    expect(ul.innerHTML).toBe(
      `<li>a</li> text <li id="b">b</li> text2 <li>c</li>`
    )
  })

  it("revert puts a last child back at the end", () => {
    const ul = html(`<ul><li>a</li><li id="b">b</li></ul>`).firstElementChild!
    const b = ul.querySelector("#b")!
    const { rec, changes } = fakeRec()
    removeEl(rec, b)
    ul.appendChild(document.createElement("li")) // something new lands after the old slot
    changes[0].revert!()
    expect(ul.lastElementChild).toBe(b) // old nextSibling was null => append
  })

  it("falls back to appending when the old next sibling has moved away", () => {
    const root = html(
      `<ul id="u"><li>a</li><li id="b">b</li><li id="c">c</li></ul><ol id="o"></ol>`
    )
    const ul = root.querySelector("#u")!
    const b = ul.querySelector("#b")!
    const c = ul.querySelector("#c")!
    const { rec, changes } = fakeRec()
    removeEl(rec, b)
    root.querySelector("#o")!.appendChild(c) // old nextSibling left the parent
    changes[0].revert!()
    expect(ul.lastElementChild).toBe(b)
  })

  it("is a no-op on <html> and on detached elements, and never throws", () => {
    const { rec, changes } = fakeRec()
    expect(() => removeEl(rec, document.documentElement)).not.toThrow()
    expect(() => removeEl(rec, document.createElement("div"))).not.toThrow()
    expect(changes).toHaveLength(0)
    expect(document.documentElement.isConnected).toBe(true)
  })
})

describe("hideEl", () => {
  it("is setStyle(display, none): computed `before`, plain `after`, revert restores", () => {
    const d = html(`<div>x</div>`).firstElementChild as HTMLElement
    const { rec, changes } = fakeRec()
    hideEl(rec, d)
    expect(changes[0]).toMatchObject({
      kind: "style",
      prop: "display",
      before: "block",
      after: "none",
    })
    expect(d.style.getPropertyValue("display")).toBe("none")
    changes[0].revert!()
    expect(d.style.getPropertyValue("display")).toBe("")
  })

  it("is a no-op on <html>", () => {
    const { rec, changes } = fakeRec()
    hideEl(rec, document.documentElement)
    expect(changes).toHaveLength(0)
    expect(document.documentElement.style.display).toBe("")
  })
})

describe("duplicateEl", () => {
  it("inserts a deep clone right after the element and records an insert", () => {
    const ul = html(
      `<ul><li class="item" id="a">a <b id="inner">x</b></li><li>z</li></ul>`
    ).firstElementChild!
    const a = ul.querySelector("#a")!
    const { rec, changes } = fakeRec()
    const clone = duplicateEl(rec, a)
    expect(clone).not.toBe(a)
    expect(ul.children[1]).toBe(clone)
    expect(ul.children).toHaveLength(3)
    expect(changes).toHaveLength(1)
    const c = changes[0]
    expect(c).toMatchObject({ kind: "insert", origin: "panel" })
    if (c.kind !== "insert") throw new Error("kind")
    expect(c.placement.index).toBe(1)
    expect(c.target.selector).toBe("dom:li") // described after insertion, so it has a real position
    expect(c.duplicateOf).toMatchObject({ selector: "dom:li#a" })
    expect(c.html).toBe(clone.outerHTML)
  })

  it("strips id attributes from the clone and its descendants, but not from the original", () => {
    const ul = html(
      `<ul><li id="a">a <b id="inner">x</b></li></ul>`
    ).firstElementChild!
    const a = ul.querySelector("#a")!
    const { rec } = fakeRec()
    const clone = duplicateEl(rec, a)
    expect(clone.hasAttribute("id")).toBe(false)
    expect(clone.querySelector("[id]")).toBeNull()
    expect(a.id).toBe("a")
    expect(a.querySelector("#inner")).not.toBeNull()
    expect(document.querySelectorAll("#a, #inner")).toHaveLength(2)
  })

  it("revert removes the clone", () => {
    const ul = html(`<ul><li>a</li></ul>`).firstElementChild!
    const { rec, changes } = fakeRec()
    const clone = duplicateEl(rec, ul.firstElementChild!)
    changes[0].revert!()
    expect(ul.children).toHaveLength(1)
    expect(clone.isConnected).toBe(false)
  })

  it("truncates recorded html to 2000 chars", () => {
    const ul = html(`<ul><li>${"x".repeat(5000)}</li></ul>`).firstElementChild!
    const { rec, changes } = fakeRec()
    duplicateEl(rec, ul.firstElementChild!)
    const c = changes[0]
    if (c.kind !== "insert") throw new Error("kind")
    expect(c.html).toHaveLength(2000)
    expect(c.html.startsWith("<li>xxx")).toBe(true)
  })

  it("duplicates the last child (inserts at the end)", () => {
    const ul = html(
      `<ul><li>a</li><li id="last">b</li></ul>`
    ).firstElementChild!
    const { rec } = fakeRec()
    const clone = duplicateEl(rec, ul.lastElementChild!)
    expect(ul.lastElementChild).toBe(clone)
  })

  it("is a no-op on <html> and detached elements: returns the element itself, records nothing", () => {
    const { rec, changes } = fakeRec()
    expect(duplicateEl(rec, document.documentElement)).toBe(
      document.documentElement
    )
    const loose = document.createElement("div")
    expect(duplicateEl(rec, loose)).toBe(loose)
    expect(changes).toHaveLength(0)
  })
})
