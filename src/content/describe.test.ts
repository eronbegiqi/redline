import { afterEach, beforeEach, describe as suite, expect, it, vi } from "vitest"
import { describe, elementById, elementId, placementOf, redescribe, sanitizeHint, selectorFor } from "@/content/describe"

// jsdom has no CSS.escape; this is the CSSOM spec algorithm so `#1abc` & co. take the real code path.
function cssEscape(value: string): string {
  const s = String(value)
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const digit = c >= 0x30 && c <= 0x39
    if (c === 0) out += "�"
    else if ((c >= 1 && c <= 0x1f) || c === 0x7f || (i === 0 && digit) || (i === 1 && digit && s.charCodeAt(0) === 0x2d))
      out += `\\${c.toString(16)} `
    else if (i === 0 && s.length === 1 && c === 0x2d) out += "\\" + s[i]
    else if (c >= 0x80 || c === 0x2d || c === 0x5f || digit || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))
      out += s[i]
    else out += "\\" + s[i]
  }
  return out
}

/** Installs (or hides) CSS.escape for the tests of the enclosing suite. */
function cssEscapeIs(present: boolean) {
  beforeEach(() => {
    vi.stubGlobal("CSS", present ? { escape: cssEscape } : undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html")
const $ = <T extends Element = Element>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`fixture is missing ${sel}`)
  return el
}

/** The postcondition, for EVERY element under `root` (plus root's own subtree docs, e.g. template content). */
function expectUniqueEverywhere(root: Document | DocumentFragment | ShadowRoot): number {
  const bad: string[] = []
  const all = root.querySelectorAll("*")
  for (const el of all) {
    const sel = selectorFor(el)
    let found: ArrayLike<Element>
    try {
      found = (el.getRootNode() as ParentNode).querySelectorAll(sel)
    } catch (e) {
      bad.push(`<${el.localName}> selector "${sel}" is invalid: ${e}`)
      continue
    }
    if (found.length !== 1 || found[0] !== el) bad.push(`<${el.localName}> "${sel}" matched ${found.length}`)
  }
  expect(bad).toEqual([])
  return all.length
}

const deep = (n: number, leaf = "<p>leaf</p>") => "<div>".repeat(n) + leaf + "</div>".repeat(n)

const DOCS: Record<string, () => Document> = {
  "duplicate and awkward ids": () =>
    parse(`<html id="root"><body id="b">
      <div id="dup"><span id="dup">a</span></div><p id="dup">x</p>
      <div id="has space">1</div><div id="a:b">2</div><div id="1abc">3</div><div id="-1x">4</div><div id="-">5</div>
      <div id="ünï">6</div><div id='q"uo&#39;te'>7</div><div id="back\\slash">8</div><div id="">empty</div>
      <div id="x.y#z">9</div><div id="a[b]">10</div><div id="line&#10;break">11</div><div id="solo"><i>1</i><i>2</i></div>
      <ul id="list"><li id="a">a</li><li>b</li><li>c</li></ul></body></html>`),
  "duplicate and awkward data-testid/test/cy": () =>
    parse(`<button data-testid="save">1</button><button data-testid="save">2</button>
      <i data-test="only">x</i><b data-cy="only">y</b><u data-testid="both" data-cy="both">z</u><u data-testid="both">w</u>
      <span data-testid='we"ird\\v]alue'>q</span><span data-testid="line&#10;break">n</span><span data-testid="">empty</span>
      <section data-testid="hero"><div><p>a</p><p>b</p></div></section><section><div><p>a</p><p>b</p></div></section>`),
  "svg, math, foreignObject": () =>
    parse(`<svg viewBox="0 0 10 10"><g><path d="M0 0"/><path d="M1 1"/><circle r="1"/></g><g><path/></g>
      <foreignObject><div><p>hi</p><p>there</p></div></foreignObject><a href="#"><text>t</text></a></svg>
      <svg><svg><rect/></svg></svg><math><mrow><mi>x</mi><mi>y</mi></mrow></math><div><a href="#">html a</a></div>`),
  "tables": () =>
    parse(`<table><caption>c</caption><colgroup><col><col></colgroup><thead><tr><th>h</th><th>h</th></tr></thead>
      <tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>
      <table><tr><td>second table</td></tr></table>`),
  "only children and deep nesting": () => parse(deep(60) + `<main>${deep(25, "<span></span><span></span>")}</main>`),
  "special class names (never part of a selector)": () =>
    parse(`<div class="a:b w-1/2 [&>*]:p-1 hover:bg-[#fff] 1x \\ &quot;"><p class="x.y">1</p><p class="x.y">2</p></div>
      <div class="a:b w-1/2 [&>*]:p-1 hover:bg-[#fff] 1x \\ &quot;"><p class="x.y">3</p></div>`),
  "forms and exotic tags": () =>
    parse(`<form id="f"><input name="id"><input name="children"><input name="parentNode"><input name="className">
      <button>go</button></form><form><input name="id"><select><option>1<option>2</select></form>
      <my-el><my-el></my-el><my-el></my-el></my-el><x:y><x:y></x:y></x:y><custom-ünï></custom-ünï>`),
  "flat list and mixed inline content": () =>
    parse(
      `<ul>${"<li>x</li>".repeat(40)}</ul><p>text<b>bold</b> text<b>again</b><br><br><i>i</i><!--c-->tail</p><hr><hr><img><img>`,
    ),
}

// Namespace-mixed siblings can only be built through the DOM API, not the parser.
function mixedNamespaces(): Document {
  const doc = parse("<div id='m'></div>")
  const m = $(doc, "#m")
  const html = "http://www.w3.org/1999/xhtml"
  const svg = "http://www.w3.org/2000/svg"
  for (const [ns, name] of [
    [html, "a"], [svg, "a"], [html, "a"], [svg, "a"], ["urn:x", "item"], ["urn:x", "item"], ["urn:y", "item"],
  ] as const) m.append(doc.createElementNS(ns, name))
  return doc
}

for (const withCssEscape of [true, false]) {
  suite(`selectorFor postcondition (CSS.escape ${withCssEscape ? "present" : "missing, as in jsdom"})`, () => {
    cssEscapeIs(withCssEscape)

    for (const [name, make] of Object.entries(DOCS)) {
      it(`querySelectorAll(selectorFor(el)) is exactly [el] for every element: ${name}`, () => {
        expect(expectUniqueEverywhere(make())).toBeGreaterThan(3)
      })
    }

    it("holds for mixed-namespace siblings", () => {
      expectUniqueEverywhere(mixedNamespaces())
    })

    it("holds inside <template> content and open shadow roots (their own scope)", () => {
      const doc = parse(`<template id="t"><div><span>1</span><span>2</span></div></template><div id="host"></div>`)
      expectUniqueEverywhere($<HTMLTemplateElement>(doc, "#t").content)
      const root = $(doc, "#host").attachShadow({ mode: "open" })
      root.innerHTML = `<p>a</p><p>b</p><div id="in"><b></b></div>`
      expectUniqueEverywhere(root)
    })
  })
}

suite("selectorFor shape", () => {
  cssEscapeIs(true)

  it("prefers a unique #id, escaped", () => {
    const doc = parse(`<div id="1abc"></div><div id="a:b c"></div><div id="plain"></div>`)
    expect(selectorFor($(doc, "#plain"))).toBe("#plain")
    expect(selectorFor($(doc, '[id="1abc"]'))).toBe("#\\31 abc")
    expect(selectorFor($(doc, '[id="a:b c"]'))).toBe("#a\\:b\\ c")
  })

  it("skips duplicate ids and falls back to a path", () => {
    const doc = parse(`<div><i id="d"></i></div><div><i id="d"></i></div>`)
    const sel = selectorFor($(doc, "div:nth-of-type(2) > i"))
    expect(sel).not.toContain("#d")
    expect(doc.querySelectorAll(sel)).toHaveLength(1)
  })

  it("uses data-testid / data-test / data-cy when unique, quoting hostile values", () => {
    const doc = parse(
      `<b data-testid="one"></b><b data-testid="dup"></b><b data-testid="dup"></b><i data-test="t"></i><u data-cy="c"></u>
       <s data-testid='a"b\\c'></s>`,
    )
    expect(selectorFor($(doc, "b"))).toBe('[data-testid="one"]')
    expect(selectorFor($(doc, "i"))).toBe('[data-test="t"]')
    expect(selectorFor($(doc, "u"))).toBe('[data-cy="c"]')
    expect(selectorFor($(doc, "s"))).toBe('[data-testid="a\\"b\\\\c"]')
    expect(selectorFor(doc.querySelectorAll("b")[1])).not.toContain("data-testid")
  })

  it("never puts classes in the selector, and omits nth-of-type for only children", () => {
    const doc = parse(`<main class="a b"><ul class="list"><li class="x">1</li><li class="x">2</li></ul></main>`)
    expect(selectorFor($(doc, "li:nth-of-type(2)"))).toBe("main > ul > li:nth-of-type(2)")
    expect(selectorFor($(doc, "ul"))).toBe("body > main > ul")
    expect(selectorFor($(doc, "ul"))).not.toContain(".")
  })

  it("returns a readable path: the last 3 segments, never fewer than needed to be unique", () => {
    const doc = parse(`<div><ul><li>1</li><li>2</li></ul><ul><li>3</li><li>4</li></ul></div>`)
    // the shortest unique suffix would be "ul:nth-of-type(2) > li:nth-of-type(2)": we add one level of context
    expect(selectorFor(doc.querySelectorAll("li")[3])).toBe("div > ul:nth-of-type(2) > li:nth-of-type(2)")
    // needs 4 segments to be unique: more than the usual 3, and exactly as many as necessary
    const wide = parse(
      `<div><section><article><p>1</p></article></section><section><article><p>2</p></article></section></div>` +
        `<div><section><article><p>3</p></article></section></div>`,
    )
    const ps = wide.querySelectorAll("p")
    expect(selectorFor(ps[0])).toBe("div:nth-of-type(1) > section:nth-of-type(1) > article > p")
    expect(wide.querySelectorAll(selectorFor(ps[0]))).toHaveLength(1)
  })

  it("keeps an anchored path whole up to 6 segments, else the last 3", () => {
    const doc = parse(`<div id="app"><a><b><i><u><s><em>x</em></s></u></i></b></a></div>`)
    expect(selectorFor($(doc, "i"))).toBe("#app > a > b > i")
    expect(selectorFor($(doc, "u"))).toBe("#app > a > b > i > u")
    expect(selectorFor($(doc, "s"))).toBe("#app > a > b > i > u > s")
    expect(selectorFor($(doc, "em"))).toBe("u > s > em") // 7 segments from the anchor: too long
  })

  it("includes ancestors that carry an anchor attribute in the path", () => {
    const doc = parse(`<main data-testid="page"><ul><li>a</li><li>b</li></ul></main>`)
    expect(selectorFor(doc.querySelectorAll("li")[1])).toBe('[data-testid="page"] > ul > li:nth-of-type(2)')
  })

  it("climbs to the nearest unique anchor ancestor", () => {
    const doc = parse(
      `<section id="hero"><div><p>a</p><p>b</p></div></section><section><div><p>a</p><p>b</p></div></section>`,
    )
    expect(selectorFor(doc.querySelectorAll("p")[1])).toBe("#hero > div > p:nth-of-type(2)")
  })

  it("handles <html> and <body>", () => {
    const doc = parse("<p>x</p>")
    expect(selectorFor(doc.documentElement)).toBe("html")
    expect(selectorFor(doc.body)).toBe("body")
  })

  it("never throws, even for a detached element", () => {
    const el = document.createElement("div")
    el.innerHTML = "<p></p><p></p>"
    expect(() => selectorFor(el.lastElementChild!)).not.toThrow()
    expect(selectorFor(el.lastElementChild!)).toBe("div > p:nth-of-type(2)")
    expect(selectorFor(document.createElement("em"))).toBe("em")
  })

  it("reflects the DOM as it is now, not as it was", () => {
    const doc = parse(`<ul><li>a</li><li>b</li></ul>`)
    const second = doc.querySelectorAll("li")[1]
    expect(selectorFor(second)).toBe("body > ul > li:nth-of-type(2)")
    second.before(doc.createElement("li"))
    expect(selectorFor(second)).toBe("body > ul > li:nth-of-type(3)")
  })
})

suite("elementId / elementById", () => {
  it("is stable per element and unique across elements", () => {
    const a = document.createElement("div")
    const b = document.createElement("div")
    expect(elementId(a)).toMatch(/^e\d+$/)
    expect(elementId(a)).toBe(elementId(a))
    expect(elementId(b)).not.toBe(elementId(a))
  })

  it("resolves back to the element, null when unknown", () => {
    const el = document.createElement("span")
    expect(elementById(elementId(el))).toBe(el)
    expect(elementById("e999999")).toBeNull()
    expect(elementById("nope")).toBeNull()
  })
})

suite("describe / redescribe", () => {
  cssEscapeIs(true)

  const mount = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as HTMLElement
  }

  it("captures tag, id, classes, own text, whitelisted attrs", () => {
    const el = mount(
      `<a id="go" class="btn primary" href="/x" data-testid="cta" data-secret="no" aria-label="Go" title="t" onclick="x()">
         Get   started <b>bold</b>
         now</a>`,
    )
    expect(describe(el)).toEqual({
      selector: "#go",
      tag: "a",
      id: "go",
      classes: ["btn", "primary"],
      text: "Get started now",
      attrs: { "data-testid": "cta", href: "/x", "aria-label": "Go", title: "t" },
    })
  })

  it("omits empty optional fields", () => {
    const d = describe(mount("<div></div>"))
    expect(d).toEqual({ selector: "body > div", tag: "div", classes: [] })
    expect("id" in d || "text" in d || "attrs" in d || "source" in d).toBe(false)
  })

  it("caps classes at 8, text at 80, attribute values at 120", () => {
    const el = mount(
      `<p class="${"c1 c2 c3 c4 c5 c6 c7 c8 c9 c10"}" title="${"t".repeat(300)}">${"é".repeat(200)}</p>`,
    )
    const d = describe(el)
    expect(d.classes).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"])
    expect(d.text).toHaveLength(80)
    expect(d.attrs?.title).toHaveLength(120)
  })

  it("does not split a surrogate pair when cutting text", () => {
    const d = describe(mount(`<p>${"a".repeat(79)}😀</p>`))
    expect(d.text).toBe("a".repeat(79))
  })

  it("reads the id attribute, not a clobbered el.id", () => {
    const form = mount(`<form id="f"><input name="id"></form>`)
    Object.defineProperty(form, "id", { value: document.createElement("input") }) // what a browser does for <input name=id>
    expect(describe(form).id).toBe("f")
  })

  it("describe() is first-touch cached, redescribe() is fresh", () => {
    const el = mount(`<div class="one">hi</div>`)
    const first = describe(el)
    el.className = "two"
    el.textContent = "changed"
    expect(describe(el)).toBe(first)
    expect(describe(el).classes).toEqual(["one"])
    expect(redescribe(el).classes).toEqual(["two"])
    expect(redescribe(el).text).toBe("changed")
    expect(describe(el).classes).toEqual(["one"]) // redescribe left the cache alone
  })

  it("works for svg elements (className is not a string there)", () => {
    document.body.innerHTML = `<svg><path class="p q" d="M0 0"/></svg>`
    expect(describe(document.querySelector("path")!).classes).toEqual(["p", "q"])
  })

  it("never throws on a node that falls apart", () => {
    const el = mount(`<div></div>`)
    Object.defineProperty(el, "getAttribute", { value: () => { throw new Error("boom") } })
    expect(describe(el).tag).toBe("div")
  })
})

suite("placementOf", () => {
  cssEscapeIs(true)

  it("reports index among element children (text/comments ignored) and the following sibling", () => {
    document.body.innerHTML = `<ul class="l">text<li id="a">a</li><!--c-->text<li id="b">b</li><li id="c">c</li></ul>`
    const p = placementOf(document.getElementById("b")!)
    expect(p.index).toBe(1)
    expect(p.parent).toMatchObject({ tag: "ul", classes: ["l"] })
    expect(p.before).toMatchObject({ tag: "li", id: "c" })
    expect(placementOf(document.getElementById("c")!).before).toBeUndefined()
    expect(placementOf(document.getElementById("a")!).index).toBe(0)
  })

  it("describes the parent fresh, not from the first-touch cache", () => {
    document.body.innerHTML = `<div class="old"><i></i></div>`
    const div = document.querySelector("div")!
    describe(div)
    div.className = "new"
    expect(placementOf(div.firstElementChild!).parent.classes).toEqual(["new"])
  })

  it("survives <html> (parent is the document) and detached elements", () => {
    const html = placementOf(document.documentElement)
    expect(html.index).toBe(0)
    expect(html.parent.tag).toBe("#document")
    const loose = document.createElement("div")
    expect(placementOf(loose)).toMatchObject({ index: 0, parent: { selector: "", tag: "" } })
  })
})

suite("probe protocol (content side)", () => {
  let off: (() => void) | undefined
  const answer = (fn: (target: Element | null) => string | null) => {
    const handler = () => {
      const result = fn(document.querySelector("[data-redline-probe]"))
      if (result !== null) document.documentElement.setAttribute("data-redline-result", result)
    }
    document.addEventListener("redline:probe", handler)
    off = () => document.removeEventListener("redline:probe", handler)
  }
  afterEach(() => {
    off?.()
    off = undefined
    document.documentElement.removeAttribute("data-redline-result")
  })
  const leftovers = () => [
    document.querySelectorAll("[data-redline-probe]").length,
    document.documentElement.hasAttribute("data-redline-result"),
  ]

  it("marks the target for the MAIN-world listener, reads its answer, and removes BOTH attributes", () => {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div>`
    const seen: (string | null)[] = []
    answer((t) => {
      seen.push(t?.id ?? null)
      return JSON.stringify({ framework: "react", component: "Hero", file: "src/Hero.tsx", line: 4 })
    })
    const d = redescribe(document.getElementById("b")!)
    expect(seen).toEqual(["b"])
    expect(d.source).toEqual({ framework: "react", component: "Hero", file: "src/Hero.tsx", line: 4 })
    expect(leftovers()).toEqual([0, false])
  })

  it("probes <html> too and still cleans up", () => {
    answer(() => JSON.stringify({ framework: "vue", component: "App" }))
    expect(redescribe(document.documentElement).source).toEqual({ framework: "vue", component: "App" })
    expect(leftovers()).toEqual([0, false])
  })

  it("no listener installed -> no source, nothing left behind", () => {
    document.body.innerHTML = `<div></div>`
    expect(redescribe(document.querySelector("div")!).source).toBeUndefined()
    expect(leftovers()).toEqual([0, false])
  })

  it("ignores a result planted before the probe ran", () => {
    document.body.innerHTML = `<div></div>`
    document.documentElement.setAttribute("data-redline-result", JSON.stringify({ framework: "react", component: "Planted" }))
    expect(redescribe(document.querySelector("div")!).source).toBeUndefined()
    expect(leftovers()).toEqual([0, false])
  })

  it.each([
    ["invalid JSON", "{nope"],
    ["null", "null"],
    ["a string", '"react"'],
    ["unknown framework", JSON.stringify({ framework: "angular" })],
    ["a non-object", "42"],
  ])("ignores %s", (_name, raw) => {
    document.body.innerHTML = `<div></div>`
    answer(() => raw)
    expect(() => redescribe(document.querySelector("div")!)).not.toThrow()
    expect(redescribe(document.querySelector("div")!).source).toBeUndefined()
    expect(leftovers()).toEqual([0, false])
  })

  it("only touches data-redline* attributes (the observer relies on that to ignore us)", () => {
    document.body.innerHTML = `<div id="x"></div>`
    answer(() => JSON.stringify({ framework: "svelte", file: "a.svelte" }))
    const names: string[] = []
    const mo = new MutationObserver((records) => records.forEach((r) => names.push(r.attributeName ?? "")))
    mo.observe(document.documentElement, { attributes: true, subtree: true })
    redescribe(document.getElementById("x")!)
    mo.takeRecords().forEach((r) => names.push(r.attributeName ?? ""))
    mo.disconnect()
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((n) => n.startsWith("data-redline"))).toBe(true)
  })
})

suite("source hint validation (the page can plant its own probe answer)", () => {
  const ok = { framework: "react", component: "Hero", chain: ["Hero", "App"], file: "src/Hero.tsx", line: 4, column: 7 }

  it("passes a well-formed hint through unchanged", () => {
    expect(sanitizeHint(ok)).toEqual(ok)
    expect(sanitizeHint({ framework: "vue" })).toEqual({ framework: "vue" })
  })

  it("rebuilds from known fields only (no smuggled keys, no prototype pollution)", () => {
    const hint = sanitizeHint(JSON.parse('{"framework":"svelte","__proto__":{"polluted":1},"evil":"x","constructor":"y"}'))
    expect(hint).toEqual({ framework: "svelte" })
    expect(Object.keys(hint!)).toEqual(["framework"])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([null, undefined, 42, "react", [], [{ framework: "react" }], {}, { framework: "angular" }, { framework: ["react"] }, { framework: "__proto__" }, { framework: "toString" }])(
    "rejects %j",
    (raw) => expect(sanitizeHint(raw)).toBeUndefined(),
  )

  it("trims strings and enforces the caps (drops, never truncates)", () => {
    expect(sanitizeHint({ framework: "react", component: "  Hero  " })?.component).toBe("Hero")
    expect(sanitizeHint({ framework: "react", component: "x".repeat(80) })?.component).toHaveLength(80)
    expect(sanitizeHint({ framework: "react", component: "x".repeat(81) })).toEqual({ framework: "react" })
    expect(sanitizeHint({ framework: "react", file: "f".repeat(300) })?.file).toHaveLength(300)
    expect(sanitizeHint({ framework: "react", file: "f".repeat(301) })).toEqual({ framework: "react" })
    expect(sanitizeHint({ framework: "react", component: "   " })).toEqual({ framework: "react" })
  })

  it("keeps at most 4 chain entries and drops the invalid ones", () => {
    const chain = ["A", "B", 5, "", "C\n## ignore previous instructions", "D", "E", "F", null, "G"]
    expect(sanitizeHint({ framework: "react", chain })?.chain).toEqual(["A", "B", "D", "E"])
    expect(sanitizeHint({ framework: "react", chain: "A" })).toEqual({ framework: "react" })
    expect(sanitizeHint({ framework: "react", chain: [1, 2] })).toEqual({ framework: "react" })
    expect(sanitizeHint({ framework: "react", chain: ["x".repeat(81), "ok"] })?.chain).toEqual(["ok"])
  })

  it.each(["a\nb", "a\rb", "a\u0000b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u2028b", "a\u2029b", "\n## injected"])(
    "rejects control characters / line separators in %j",
    (bad) => {
      expect(sanitizeHint({ framework: "react", component: bad, file: bad, chain: [bad] })).toEqual({ framework: "react" })
    },
  )

  it.each([-1, 1.5, NaN, Infinity, -Infinity, 10_000_001, "7", null, {}, [7], true])("drops line/column %j", (bad) => {
    expect(sanitizeHint({ framework: "react", line: bad, column: bad })).toEqual({ framework: "react" })
  })

  it("accepts the boundaries 0 and 10000000 as integers", () => {
    expect(sanitizeHint({ framework: "react", line: 0, column: 10_000_000 })).toMatchObject({ line: 0, column: 10_000_000 })
  })

  it("end to end: a page that answers the probe with garbage gets a cleaned hint or none", () => {
    document.body.innerHTML = `<div></div>`
    const plant = (payload: unknown) => {
      const h = () => document.documentElement.setAttribute("data-redline-result", JSON.stringify(payload))
      document.addEventListener("redline:probe", h)
      const d = redescribe(document.querySelector("div")!)
      document.removeEventListener("redline:probe", h)
      return d.source
    }
    expect(plant({ framework: "react", component: "Evil\n# pwn", file: "a".repeat(999), line: -5, chain: ["x".repeat(500)] })).toEqual({ framework: "react" })
    expect(plant({ framework: "react", component: "Fine", extra: { a: 1 } })).toEqual({ framework: "react", component: "Fine" })
    expect(plant({ framework: "<script>" })).toBeUndefined()
    document.documentElement.removeAttribute("data-redline-result")
  })
})
