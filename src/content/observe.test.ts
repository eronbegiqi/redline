import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  duplicateEl,
  hideEl,
  removeEl,
  setStyle,
  setText,
} from "@/content/edit"
import { suppress } from "@/content/guard"
import { startObserving, stopObserving } from "@/content/observe"
import type { Recorder } from "@/shared/recorder"
import type { Change, NewChange } from "@/shared/types"

// Deterministic stand-ins for describe.ts. `selector` says whether the element was in the document when
// describe() ran; `classes` is read live so class tests prove the observer corrects them.
vi.mock("@/content/describe", () => {
  const ids = new WeakMap<Element, string>()
  let n = 0
  const desc = (el: Element) => ({
    selector: `${el.isConnected ? "dom" : "detached"}:${el.localName}${el.id ? "#" + el.id : ""}`,
    tag: el.localName,
    classes: [...el.classList],
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

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

let host: HTMLElement
let changes: NewChange[]
let rec: Recorder
const ignore = (n: Node) => n === host || host.contains(n)

function makeRec(sink: NewChange[], throwOnFirst = false) {
  let first = true
  return {
    record: (nc: NewChange) => {
      if (throwOnFirst && first) {
        first = false
        throw new Error("boom")
      }
      sink.push(nc)
      return null as Change | null
    },
  } as unknown as Recorder
}

/** Wait for delivery, return what was recorded, and forget it. */
async function drain() {
  await tick()
  return changes.splice(0)
}

const html = (s: string) => {
  const root = document.getElementById("root")!
  root.innerHTML = s
  return root
}
const $ = <T extends Element = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = `<div id="root"></div>`
  host = document.createElement("div")
  host.setAttribute("data-redline-host", "")
  document.documentElement.appendChild(host)
  changes = []
  rec = makeRec(changes)
})

afterEach(() => {
  stopObserving()
  host.remove()
})

const start = () => startObserving(rec, ignore)

describe("style attribute", () => {
  it("records an added property with before: null", async () => {
    html(`<p>x</p>`)
    start()
    $("p").style.color = "red"
    const [c, ...rest] = await drain()
    expect(rest).toHaveLength(0)
    expect(c).toMatchObject({
      kind: "style",
      prop: "color",
      before: null,
      after: "red",
      origin: "devtools",
    })
    expect(c.el).toMatch(/^e\d+$/)
    expect(c.target.selector).toBe("dom:p")
  })

  it("records changed and removed properties as separate changes", async () => {
    html(`<p style="color: red; margin-top: 4px">x</p>`)
    start()
    $("p").style.color = "blue"
    $("p").style.removeProperty("margin-top")
    const out = await drain()
    expect(
      out.map((c) => c.kind === "style" && [c.prop, c.before, c.after])
    ).toEqual([
      ["color", "red", "blue"],
      ["margin-top", "4px", null],
    ])
  })

  it("chains records in one batch: each change's before is the previous change's after", async () => {
    html(`<p>x</p>`)
    start()
    const p = $("p")
    p.style.color = "red"
    p.style.color = "blue"
    p.style.backgroundColor = "yellow"
    p.style.color = ""
    const out = await drain()
    expect(
      out.map((c) => c.kind === "style" && [c.prop, c.before, c.after])
    ).toEqual([
      ["color", null, "red"],
      ["color", "red", "blue"],
      ["background-color", null, "yellow"],
      ["color", "blue", null],
    ])
    // Reverting newest -> oldest returns to the original inline style, silently.
    for (const c of [...out].reverse()) c.revert!()
    expect(p.style.length).toBe(0)
    expect(p.hasAttribute("style")).toBe(false) // the page never had one
    expect(await drain()).toHaveLength(0)
  })

  it("keeps !important in the recorded values and notices a priority-only change", async () => {
    html(`<p style="color: red">x</p>`)
    start()
    // (jsdom's style.setProperty(.., "important") doesn't reach the attribute, so write the attribute; Chromium covers the API.)
    $("p").setAttribute("style", "color: red !important")
    const [c] = await drain()
    expect(c).toMatchObject({
      kind: "style",
      prop: "color",
      before: "red",
      after: "red !important",
    })
    c.revert!()
    expect($("p").style.getPropertyPriority("color")).toBe("")
    expect($("p").style.getPropertyValue("color")).toBe("red")
  })

  it("revert restores an old declaration (value + priority) or removes the property, without being re-recorded", async () => {
    html(`<p style="color: red !important">x</p>`)
    start()
    const p = $("p")
    p.style.setProperty("color", "blue")
    p.style.setProperty("margin-top", "9px")
    const out = await drain()
    expect(out).toHaveLength(2)
    for (const c of [...out].reverse()) c.revert!()
    expect(p.style.getPropertyValue("color")).toBe("red")
    expect(p.style.getPropertyPriority("color")).toBe("important")
    expect(p.style.getPropertyValue("margin-top")).toBe("")
    expect(await drain()).toHaveLength(0)
  })

  it("ignores a style write that changes nothing", async () => {
    html(`<p style="color: red">x</p>`)
    start()
    $("p").setAttribute("style", "color:red")
    expect(await drain()).toHaveLength(0)
  })
})

describe("class attribute", () => {
  it("records added/removed tokens and puts the ORIGINAL classes in the descriptor", async () => {
    html(`<p class="a b">x</p>`)
    start()
    const p = $("p")
    p.classList.remove("a")
    p.classList.add("c")
    const out = await drain()
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      kind: "class",
      added: [],
      removed: ["a"],
      origin: "devtools",
    })
    expect(out[1]).toMatchObject({ kind: "class", added: ["c"], removed: [] })
    expect(out[0].target.classes).toEqual(["a", "b"]) // not the live ["b", "c"]
    expect(out[1].target.classes).toEqual(["b"]) // state before THIS edit
  })

  it("does not touch the page DOM to work out the original classes", async () => {
    html(`<p class="a">x</p>`)
    start()
    const seen: string[] = []
    new MutationObserver((rs) =>
      rs.forEach((r) => seen.push(String(r.oldValue)))
    ).observe($("p"), {
      attributes: true,
      attributeOldValue: true,
    })
    $("p").classList.add("b")
    await tick()
    expect(seen).toEqual(["a"]) // only the page's own edit, no undo/redo noise
  })

  it("caps descriptor classes at 8", async () => {
    html(`<p class="1 2 3 4 5 6 7 8 9 10">x</p>`)
    start()
    $("p").classList.add("z")
    const [c] = await drain()
    expect(c.target.classes).toHaveLength(8)
  })

  it("ignores a reorder / whitespace-only rewrite", async () => {
    html(`<p class="a b">x</p>`)
    start()
    $("p").className = "  b   a "
    expect(await drain()).toHaveLength(0)
  })

  it("revert undoes just this change's tokens, silently", async () => {
    html(`<p class="a b">x</p>`)
    start()
    const p = $("p")
    p.classList.remove("a")
    p.classList.add("c")
    const out = await drain()
    for (const c of [...out].reverse()) c.revert!()
    expect([...p.classList].sort()).toEqual(["a", "b"])
    expect(await drain()).toHaveLength(0)
  })

  it("revert of a class added to a class-less element removes the empty attribute again", async () => {
    html(`<p>x</p>`)
    start()
    $("p").classList.add("k")
    const [c] = await drain()
    c.revert!()
    expect($("p").hasAttribute("class")).toBe(false)
  })

  it("records removing the whole attribute", async () => {
    html(`<p class="a b">x</p>`)
    start()
    $("p").removeAttribute("class")
    const [c] = await drain()
    expect(c).toMatchObject({ kind: "class", added: [], removed: ["a", "b"] })
    c.revert!()
    expect($("p").className).toBe("a b")
  })
})

describe("other attributes", () => {
  it("records add / change / remove with before/after and a working revert", async () => {
    html(`<a href="/a">x</a>`)
    start()
    const a = $("a")
    a.setAttribute("title", "t1")
    a.setAttribute("href", "/b")
    const first = await drain()
    expect(
      first.map((c) => c.kind === "attr" && [c.name, c.before, c.after])
    ).toEqual([
      ["title", null, "t1"],
      ["href", "/a", "/b"],
    ])
    a.removeAttribute("title")
    const [removed] = await drain()
    expect(removed).toMatchObject({
      kind: "attr",
      name: "title",
      before: "t1",
      after: null,
    })

    removed.revert!()
    expect(a.getAttribute("title")).toBe("t1")
    first[1].revert!()
    expect(a.getAttribute("href")).toBe("/a")
    first[0].revert!()
    expect(a.hasAttribute("title")).toBe(false)
    expect(await drain()).toHaveLength(0)
  })

  it("chains attribute records in a batch", async () => {
    html(`<a>x</a>`)
    start()
    const a = $("a")
    a.setAttribute("title", "a")
    a.setAttribute("title", "b")
    a.setAttribute("title", "c")
    const out = await drain()
    expect(out.map((c) => c.kind === "attr" && [c.before, c.after])).toEqual([
      [null, "a"],
      ["a", "b"],
      ["b", "c"],
    ])
  })

  it("skips data-redline*, contenteditable, spellcheck and namespaced attributes", async () => {
    html(`<p>x</p><svg><use></use></svg>`)
    start()
    const p = $("p")
    p.setAttribute("data-redline-probe", "1")
    p.removeAttribute("data-redline-probe")
    p.setAttribute("data-redline-anything", "x")
    p.setAttribute("contenteditable", "plaintext-only")
    p.setAttribute("spellcheck", "false")
    $("use").setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#a")
    expect(await drain()).toHaveLength(0)
    p.setAttribute("data-other", "1") // a normal data attribute still counts
    expect(await drain()).toHaveLength(1)
  })

  it("skips a set to the same value", async () => {
    html(`<a title="t">x</a>`)
    start()
    $("a").setAttribute("title", "t")
    expect(await drain()).toHaveLength(0)
  })
})

describe("text", () => {
  it("records a characterData edit against the parent element with the text node's index", async () => {
    html(`<p><b>x</b>hello</p>`)
    start()
    ;($("p").lastChild as Text).data = "bye"
    const [c] = await drain()
    expect(c).toMatchObject({
      kind: "text",
      textNode: 1,
      before: "hello",
      after: "bye",
      origin: "devtools",
    })
    expect(c.target.selector).toBe("dom:p")
    c.revert!()
    expect($("p").lastChild!.textContent).toBe("hello")
    expect(await drain()).toHaveLength(0)
  })

  it("chains characterData records", async () => {
    html(`<p>hello</p>`)
    start()
    const t = $("p").firstChild as Text
    t.data = "a"
    t.data = "ab"
    const out = await drain()
    expect(out.map((c) => c.kind === "text" && [c.before, c.after])).toEqual([
      ["hello", "a"],
      ["a", "ab"],
    ])
    for (const c of [...out].reverse()) c.revert!()
    expect(t.data).toBe("hello")
  })

  it("records a replaced text node (textContent =) and restores the very same node on revert", async () => {
    html(`<p>hello</p>`)
    start()
    const old = $("p").firstChild!
    $("p").textContent = "world"
    const [c, ...rest] = await drain()
    expect(rest).toHaveLength(0)
    expect(c).toMatchObject({
      kind: "text",
      textNode: 0,
      before: "hello",
      after: "world",
      origin: "devtools",
    })
    c.revert!()
    expect($("p").firstChild).toBe(old)
    expect($("p").childNodes).toHaveLength(1)
    expect(await drain()).toHaveLength(0)
  })

  it("records clearing text, and text appearing in an empty element", async () => {
    html(`<p>hello</p><i></i>`)
    start()
    const old = $("p").firstChild!
    $("p").textContent = ""
    $("i").textContent = "new"
    const [cleared, appeared] = await drain()
    expect(cleared).toMatchObject({ kind: "text", before: "hello", after: "" })
    expect(appeared).toMatchObject({
      kind: "text",
      before: "",
      after: "new",
      textNode: 0,
    })
    cleared.revert!()
    expect($("p").firstChild).toBe(old)
    appeared.revert!()
    expect($("i").childNodes).toHaveLength(0)
  })

  it("ignores whitespace-only churn and comments", async () => {
    html(`<p> \n </p>`)
    start()
    $("p").textContent = "\n\t"
    $("p").appendChild(document.createComment("c")).textContent = "d"
    expect(await drain()).toHaveLength(0)
  })

  it("skips text typed inside a contenteditable (the in-page editor records that itself)", async () => {
    html(`<p contenteditable="plaintext-only">hello</p><p id="plain">y</p>`)
    start()
    ;($("p").firstChild as Text).data = "typing"
    $("p").textContent = "typed"
    expect(await drain()).toHaveLength(0)
    ;($("#plain").firstChild as Text).data = "z"
    expect(await drain()).toHaveLength(1)
  })

  it("does not treat contenteditable=false as an editing host", async () => {
    html(`<p contenteditable="false">hello</p>`)
    start()
    ;($("p").firstChild as Text).data = "bye"
    expect(await drain()).toHaveLength(1)
  })
})

describe("element removal", () => {
  it("records a delete, described while still in the document, and revert re-inserts at the old slot", async () => {
    html(`<ul><li>a</li> t <li id="b">b</li> t2 <li>c</li></ul>`)
    start()
    const b = $("#b")
    b.remove()
    const [c, ...rest] = await drain()
    expect(rest).toHaveLength(0)
    expect(c).toMatchObject({ kind: "delete", origin: "devtools" })
    expect(c.target.selector).toBe("dom:li#b") // not "detached:..."
    expect(b.isConnected).toBe(false) // the temporary re-attach is undone
    expect($("ul").innerHTML).toBe("<li>a</li> t  t2 <li>c</li>")
    c.revert!()
    expect($("ul").innerHTML).toBe(
      `<li>a</li> t <li id="b">b</li> t2 <li>c</li>`
    )
    expect(await drain()).toHaveLength(0)
  })

  it("re-attaching to describe is invisible to the observer and to us", async () => {
    html(`<ul><li id="b">b</li></ul>`)
    start()
    $("#b").remove()
    await tick()
    expect(changes).toHaveLength(1) // just the delete, no phantom insert/move from the temporary re-attach
  })

  it("records a removed last child and re-appends it", async () => {
    html(`<ul><li>a</li><li id="b">b</li></ul>`)
    start()
    const b = $("#b")
    b.remove()
    const [c] = await drain()
    c.revert!()
    expect($("ul").lastElementChild).toBe(b)
  })

  it("records several siblings removed in one batch; reverting newest first restores order", async () => {
    html(`<ul><li id="a">a</li><li id="b">b</li><li id="c">c</li></ul>`)
    start()
    const [a, b] = [$("#a"), $("#b")]
    a.remove()
    b.remove()
    const out = await drain()
    expect(out.map((c) => c.target.selector)).toEqual(["dom:li#a", "dom:li#b"])
    for (const c of [...out].reverse()) c.revert!()
    expect([...$("ul").children].map((e) => e.id)).toEqual(["a", "b", "c"])
  })

  it("records only the outer delete when a child and then its parent are removed", async () => {
    html(`<div id="o"><ul id="u"><li id="a">a</li></ul></div>`)
    start()
    $("#a").remove()
    $("#u").remove()
    const out = await drain()
    expect(out.map((c) => c.target.selector)).toEqual(["dom:ul#u"])
  })

  it("drops attribute edits made to an element that is removed in the same batch", async () => {
    html(`<ul><li id="a">a</li></ul>`)
    start()
    const a = $("#a")
    a.setAttribute("title", "t")
    a.remove()
    const out = await drain()
    expect(out.map((c) => c.kind)).toEqual(["delete"])
  })

  it("an add then remove of the same new element within a batch is nothing", async () => {
    html(`<ul></ul>`)
    start()
    const li = document.createElement("li")
    $("ul").appendChild(li)
    li.remove()
    expect(await drain()).toHaveLength(0)
  })
})

describe("element insertion", () => {
  it("records an insert with placement and html, revert removes it silently", async () => {
    html(`<ul><li>a</li></ul>`)
    start()
    const li = document.createElement("li")
    li.className = "new"
    li.textContent = "n"
    $("ul").appendChild(li)
    const [c, ...rest] = await drain()
    expect(rest).toHaveLength(0)
    expect(c).toMatchObject({
      kind: "insert",
      origin: "devtools",
      html: '<li class="new">n</li>',
    })
    if (c.kind !== "insert") throw new Error("kind")
    expect(c.placement.index).toBe(1)
    expect(c.target.selector).toBe("dom:li")
    c.revert!()
    expect(li.isConnected).toBe(false)
    expect(await drain()).toHaveLength(0)
  })

  it("truncates html to 2000 chars", async () => {
    html(`<ul></ul>`)
    start()
    const li = document.createElement("li")
    li.textContent = "x".repeat(5000)
    $("ul").appendChild(li)
    const [c] = await drain()
    if (c.kind !== "insert") throw new Error("kind")
    expect(c.html).toHaveLength(2000)
  })

  it("records one insert for a subtree and ignores edits to nodes created in the same batch", async () => {
    html(`<ul></ul>`)
    start()
    const wrap = document.createElement("li")
    $("ul").appendChild(wrap)
    const kid = document.createElement("b")
    wrap.appendChild(kid) // observed now: wrap is in the document
    wrap.setAttribute("title", "x")
    wrap.classList.add("c")
    kid.textContent = "t"
    const out = await drain()
    expect(out.map((c) => c.kind)).toEqual(["insert"])
    expect(out[0].target.selector).toBe("dom:li")
  })

  it("records every top-level node of a multi-node insert", async () => {
    html(`<ul></ul>`)
    start()
    const frag = document.createDocumentFragment()
    frag.append(document.createElement("li"), document.createElement("li"))
    $("ul").appendChild(frag)
    const out = await drain()
    expect(out.map((c) => c.kind)).toEqual(["insert", "insert"])
  })
})

describe("element move", () => {
  it("records remove + re-insert in one batch as a single move with from/to placements", async () => {
    html(`<ul id="u"><li id="a">a</li><li id="b">b</li><li id="c">c</li></ul>`)
    start()
    const a = $("#a")
    $("#u").appendChild(a)
    const out = await drain()
    expect(out).toHaveLength(1)
    const c = out[0]
    if (c.kind !== "move") throw new Error(`kind ${c.kind}`)
    expect(c.origin).toBe("devtools")
    expect(c.from.index).toBe(0)
    expect(c.from.before?.selector).toBe("dom:li#b")
    expect(c.from.parent.selector).toBe("dom:ul#u")
    expect(c.to.index).toBe(2)
    c.revert!()
    expect([...$("#u").children].map((e) => e.id)).toEqual(["a", "b", "c"])
    expect(await drain()).toHaveLength(0)
  })

  it("works across parents", async () => {
    html(`<ul id="u"><li id="a">a</li></ul><ol id="o"><li id="x">x</li></ol>`)
    start()
    const a = $("#a")
    $("#o").insertBefore(a, $("#x"))
    const [c] = await drain()
    if (c.kind !== "move") throw new Error("kind")
    expect(c.from.parent.selector).toBe("dom:ul#u")
    expect(c.from.index).toBe(0)
    expect(c.from.before).toBeUndefined()
    expect(c.to.parent.selector).toBe("dom:ol#o")
    expect(c.to.index).toBe(0)
    c.revert!()
    expect(a.parentElement).toBe($("#u"))
  })

  it("counts the old index correctly when the node moved earlier within the same parent", async () => {
    html(
      `<ul id="u"><li id="a">a</li><li id="n">n</li><li id="b">b</li><li id="c">c</li></ul>`
    )
    start()
    $("#u").insertBefore($("#n"), $("#a"))
    const [c] = await drain()
    if (c.kind !== "move") throw new Error("kind")
    expect(c.from.index).toBe(1)
    expect(c.from.before?.selector).toBe("dom:li#b")
    expect(c.to.index).toBe(0)
  })

  it("treats a node removed and re-added as one move even with other edits in between", async () => {
    html(`<ul id="u"><li id="a">a</li><li id="b">b</li></ul>`)
    start()
    const a = $("#a")
    a.remove()
    $("#b").setAttribute("title", "t")
    $("#u").appendChild(a)
    const out = await drain()
    expect(out.map((c) => c.kind)).toEqual(["move", "attr"]) // ordered by the first thing that happened to each
  })
})

describe("filtering", () => {
  it("skips everything inside nodes for which ignore() is true", async () => {
    html(`<p>x</p>`)
    host.innerHTML = `<span>t</span>`
    start()
    host.setAttribute("style", "color: red")
    host.setAttribute("title", "t")
    host.appendChild(document.createElement("div"))
    host.firstElementChild!.remove()
    ;(host.firstChild as Text | null)?.remove()
    host.remove()
    document.documentElement.appendChild(host)
    expect(await drain()).toHaveLength(0)
  })

  it("passes real page mutations through next to ignored ones", async () => {
    html(`<p>x</p>`)
    start()
    host.setAttribute("title", "ours")
    $("p").setAttribute("title", "theirs")
    const out = await drain()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      kind: "attr",
      name: "title",
      after: "theirs",
    })
  })

  it("emits changes in the order things happened", async () => {
    html(`<p id="a">a</p><p id="b">b</p><p id="c" class="x">c</p>`)
    start()
    $("#a").style.color = "red"
    $("#b").remove()
    $("#c").classList.add("y")
    const out = await drain()
    expect(out.map((c) => c.kind)).toEqual(["style", "delete", "class"])
  })
})

describe("suppress()", () => {
  it("hides edits made inside it, including ones queued earlier in the same microtask", async () => {
    html(`<p>x</p>`)
    start()
    const p = $("p")
    suppress(() => {
      p.style.color = "red"
      p.classList.add("c")
      p.appendChild(document.createElement("i"))
    })
    await Promise.resolve() // same microtask checkpoint the observer would have used
    await tick()
    expect(changes).toHaveLength(0)
  })

  it("drops only the suppressed edits when a page edit follows in the same task", async () => {
    html(`<p>x</p>`)
    start()
    const p = $("p")
    suppress(() => {
      p.style.color = "red"
    })
    p.setAttribute("title", "page")
    const out = await drain()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: "attr", name: "title" })
  })

  it("nested suppress works", async () => {
    html(`<p>x</p>`)
    start()
    suppress(() => {
      suppress(() => $("p").setAttribute("title", "a"))
      $("p").setAttribute("title", "b")
    })
    expect(await drain()).toHaveLength(0)
  })

  it("hides every edit.ts operation (and its reverts) but they still reach the recorder as panel changes", async () => {
    html(`<ul><li id="a">a</li><li id="b">b</li></ul><p id="p">p</p>`)
    start()
    setStyle(rec, $("#p"), "color", "red")
    setText(rec, $("#p"), "q")
    hideEl(rec, $("#a"))
    const clone = duplicateEl(rec, $("#a"))
    removeEl(rec, $("#b"))
    await tick()
    expect(changes.map((c) => c.origin)).toEqual([
      "panel",
      "panel",
      "panel",
      "panel",
      "panel",
    ])
    expect(changes.map((c) => c.kind)).toEqual([
      "style",
      "text",
      "style",
      "insert",
      "delete",
    ])
    const n = changes.length
    for (const c of [...changes].reverse()) c.revert!()
    await tick()
    expect(changes).toHaveLength(n) // reverts were silent too
    expect(clone.isConnected).toBe(false)
    expect([...$("ul").children].map((e) => e.id)).toEqual(["a", "b"])
    expect($("#a").style.display).toBe("")
    expect($("#p").textContent).toBe("p")
  })
})

describe("lifecycle", () => {
  it("startObserving is idempotent: one observer, one record per mutation", async () => {
    const other: NewChange[] = []
    html(`<p>x</p>`)
    start()
    start()
    startObserving(makeRec(other), ignore) // a second caller must not hijack or duplicate
    $("p").setAttribute("title", "t")
    expect(await drain()).toHaveLength(1)
    expect(other).toHaveLength(0)
  })

  it("stopObserving stops recording, drops pending records, and is safe twice", async () => {
    html(`<p>x</p>`)
    start()
    $("p").setAttribute("title", "pending")
    stopObserving() // before delivery
    expect(() => stopObserving()).not.toThrow()
    $("p").setAttribute("title", "after")
    await tick()
    expect(changes).toHaveLength(0)
  })

  it("stopObserving without start does nothing", () => {
    expect(() => stopObserving()).not.toThrow()
  })

  it("leaves no suppress flusher behind after stop", async () => {
    html(`<p>x</p>`)
    const take = vi.spyOn(MutationObserver.prototype, "takeRecords")
    start()
    suppress(() => {})
    expect(take).toHaveBeenCalledTimes(1)
    stopObserving()
    take.mockClear()
    suppress(() => {})
    expect(take).not.toHaveBeenCalled()
    take.mockRestore()
  })

  it("can be started again after a stop and records into the new recorder", async () => {
    html(`<p>x</p>`)
    start()
    stopObserving()
    const fresh: NewChange[] = []
    startObserving(makeRec(fresh), ignore)
    $("p").setAttribute("title", "t")
    await tick()
    expect(fresh).toHaveLength(1)
    expect(changes).toHaveLength(0)
  })
})

describe("robustness", () => {
  it("a throwing recorder neither breaks the rest of the batch nor leaks into the page", async () => {
    const errors: unknown[] = []
    const onError = (e: Event) => errors.push(e)
    window.addEventListener("error", onError)
    html(`<p>x</p>`)
    rec = makeRec(changes, true)
    start()
    $("p").setAttribute("title", "a")
    $("p").setAttribute("lang", "b")
    const out = await drain()
    window.removeEventListener("error", onError)
    expect(errors).toHaveLength(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: "attr", name: "lang" })
  })

  it("a throwing ignore() does not escape into the page", async () => {
    const errors: unknown[] = []
    const onError = (e: Event) => errors.push(e)
    window.addEventListener("error", onError)
    html(`<p>x</p>`)
    startObserving(rec, () => {
      throw new Error("boom")
    })
    $("p").setAttribute("title", "a")
    await tick()
    window.removeEventListener("error", onError)
    expect(errors).toHaveLength(0)
  })
})
