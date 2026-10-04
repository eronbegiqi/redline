import { afterEach, describe, expect, it, vi } from "vitest"
import { redescribe } from "@/content/describe"
import {
  cleanFile,
  fiberToHint,
  onProbe,
  probeElement,
  register,
  stackFrame,
  svelteToHint,
  vueToHint,
} from "@/content/probe-main"

// Importing probe-main registered its listener on jsdom's document (same as the injected IIFE would).

// Named functions so `fn.name` is what React would see.
function Hero() {}
function CtaButton() {}
function App() {}
function Card() {}
function Page() {}
const anonymous = (() => () => {})()
function lower() {}
function Fragment() {}
function Dialog() {}
function Extra1() {}
function Extra2() {}
function Extra3() {}

/** A dev-build fiber. `owner`/`ret` are the fibers it links to. */
const fiber = (type: unknown, extra: Record<string, unknown> = {}) => ({
  type,
  _debugOwner: null,
  _debugSource: null,
  return: null,
  ...extra,
})

describe("cleanFile", () => {
  it.each([
    ["http://localhost:5173/src/Hero.tsx?t=1712345678", "src/Hero.tsx"],
    ["http://localhost:5173/src/Hero.tsx?v=abc123&t=9#frag", "src/Hero.tsx"],
    ["http://localhost:5173/@fs/Users/me/proj/src/Hero.tsx?t=1", "/Users/me/proj/src/Hero.tsx"],
    ["/@fs/Users/me/proj/src/Hero.tsx", "/Users/me/proj/src/Hero.tsx"],
    ["webpack-internal:///(app-pages-browser)/./src/app/page.tsx", "src/app/page.tsx"],
    ["webpack://_N_E/./src/app/page.tsx?abcd", "src/app/page.tsx"],
    ["file:///Users/me/proj/src/Hero.tsx", "/Users/me/proj/src/Hero.tsx"],
    ["/Users/me/proj/src/Hero.tsx", "/Users/me/proj/src/Hero.tsx"], // already a filesystem path: untouched
    ["src/Hero.tsx", "src/Hero.tsx"],
  ])("%s -> %s", (raw, want) => expect(cleanFile(raw)).toBe(want))
})

describe("stackFrame (React 19 _debugStack)", () => {
  const vite = [
    "Error: react-stack-top-frame",
    "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=3f2a1b:250:41)",
    "    at CtaButton (http://localhost:5173/src/components/CtaButton.tsx?t=1712345678:42:7)",
    "    at Object.react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=3f2a1b:18567:20)",
    "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=3f2a1b:4206:22)",
  ].join("\n")

  it("skips node_modules and react-dom frames, strips ?t= and the origin", () => {
    expect(stackFrame(vite)).toEqual({ file: "src/components/CtaButton.tsx", line: 42, column: 7 })
  })

  it("keeps a Vite /@fs/ file outside the root as an absolute path", () => {
    const s = "Error\n    at jsxDEV (http://x/node_modules/react/jsx-dev-runtime.js:1:1)\n    at Hero (http://localhost:5173/@fs/Users/me/mono/ui/Hero.tsx?t=5:10:3)"
    expect(stackFrame(s)).toEqual({ file: "/Users/me/mono/ui/Hero.tsx", line: 10, column: 3 })
  })

  it("parses webpack-internal frames whose url contains parentheses", () => {
    const s = [
      "Error: react-stack-top-frame",
      "    at jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js:323:30)",
      "    at Home (webpack-internal:///(app-pages-browser)/./src/app/page.tsx:12:88)",
    ].join("\n")
    expect(stackFrame(s)).toEqual({ file: "src/app/page.tsx", line: 12, column: 88 })
  })

  it("handles anonymous, async and new frames, skips <anonymous> and eval frames", () => {
    const s = [
      "Error",
      "    at new Promise (<anonymous>)",
      "    at eval (eval at <anonymous> (http://x/a.js:1:1), <anonymous>:1:1)",
      "    at async load (http://localhost:3000/src/a.ts:3:9)",
    ].join("\n")
    expect(stackFrame(s)).toEqual({ file: "src/a.ts", line: 3, column: 9 })
    expect(stackFrame("Error\n    at http://localhost:3000/src/b.ts:7:2")).toEqual({ file: "src/b.ts", line: 7, column: 2 })
  })

  it("returns undefined when every frame is library code, or the input is not a stack", () => {
    expect(
      stackFrame("Error\n    at jsxDEV (http://x/node_modules/react/jsx-dev-runtime.js:1:1)\n    at f (http://x/node_modules/react-dom/x.js:2:2)"),
    ).toBeUndefined()
    expect(stackFrame(undefined)).toBeUndefined()
    expect(stackFrame(42)).toBeUndefined()
    expect(stackFrame("")).toBeUndefined()
    expect(stackFrame("no frames here")).toBeUndefined()
  })
})

describe("fiberToHint", () => {
  it("React <=18: _debugSource of the host fiber + component chain via the owner links", () => {
    const app = fiber(App)
    const hero = fiber(Hero, { _debugOwner: app, return: app })
    const cta = fiber(CtaButton, { _debugOwner: hero, return: hero })
    const host = fiber("button", {
      _debugOwner: cta,
      return: cta,
      _debugSource: { fileName: "/Users/me/proj/src/Hero.tsx", lineNumber: 42, columnNumber: 9 },
    })
    expect(fiberToHint(host)).toEqual({
      framework: "react",
      component: "CtaButton",
      chain: ["CtaButton", "Hero", "App"],
      file: "/Users/me/proj/src/Hero.tsx",
      line: 42,
      column: 9,
    })
  })

  it("prefers the owner (whose render made the element) over the parent when they differ", () => {
    // <Card><p/></Card> written inside Page: p's parent is Card, its owner (and source file) is Page.
    const page = fiber(Page)
    const card = fiber(Card, { _debugOwner: page, return: page })
    const p = fiber("p", { _debugOwner: page, return: card, _debugSource: { fileName: "/p/Page.tsx", lineNumber: 3 } })
    expect(fiberToHint(p)).toMatchObject({ component: "Page", chain: ["Page"], file: "/p/Page.tsx", line: 3 })
  })

  it("falls back to the return chain when there is no owner", () => {
    const app = fiber(App)
    const hero = fiber(Hero, { return: app })
    const host = fiber("div", { return: hero })
    expect(fiberToHint(host)).toMatchObject({ component: "Hero", chain: ["Hero", "App"] })
    expect(fiberToHint(host)?.file).toBeUndefined()
  })

  it("React 19: parses the first user frame of _debugStack, no _debugSource", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:41)",
      "    at Hero (http://localhost:5173/src/Hero.tsx?t=1712:21:5)",
      "    at Object.react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1:1:1)",
    ].join("\n")
    const app = fiber(App)
    const hero = fiber(Hero, { _debugOwner: app })
    const host = fiber("section", { _debugOwner: hero, _debugStack: { stack } })
    expect(fiberToHint(host)).toEqual({
      framework: "react",
      component: "Hero",
      chain: ["Hero", "App"],
      file: "src/Hero.tsx",
      line: 21,
      column: 5,
    })
  })

  it("React 19: owners may be server ComponentInfo objects ({name})", () => {
    const host = fiber("div", { _debugOwner: { name: "ServerPage", env: "Server", owner: null } })
    expect(fiberToHint(host)).toMatchObject({ component: "ServerPage" })
  })

  it("names forwardRef / memo wrappers (displayName, render fn, inner type)", () => {
    const fwd = { $$typeof: Symbol.for("react.forward_ref"), render: function Input() {} }
    const fwdNamed = { $$typeof: Symbol.for("react.forward_ref"), render: () => null, displayName: "Button" }
    const memo = { $$typeof: Symbol.for("react.memo"), type: Card }
    const o3 = fiber(memo)
    const o2 = fiber(fwdNamed, { _debugOwner: o3 })
    const o1 = fiber(fwd, { _debugOwner: o2 })
    expect(fiberToHint(fiber("div", { _debugOwner: o1 }))?.chain).toEqual(["Input", "Button", "Card"])
  })

  it("skips anonymous, lowercase and Fragment owners, collapses repeats, caps at 4", () => {
    let o = fiber(Extra3)
    for (const t of [Extra2, Extra1, Hero, Hero, anonymous, lower, Fragment, "div", Dialog, App]) o = fiber(t, { _debugOwner: o })
    expect(fiberToHint(fiber("i", { _debugOwner: o }))?.chain).toEqual(["App", "Dialog", "Hero", "Extra1"])
  })

  it("returns only the chain when there is no location (dev build without jsx-source)", () => {
    const hint = fiberToHint(fiber("div", { _debugOwner: fiber(Hero) }))
    expect(hint).toEqual({ framework: "react", component: "Hero", chain: ["Hero"] })
  })

  it("returns only the location when no component qualifies", () => {
    const hint = fiberToHint(fiber("div", { _debugSource: { fileName: "/a/main.tsx", lineNumber: 1, columnNumber: 1 } }))
    expect(hint).toMatchObject({ framework: "react", file: "/a/main.tsx", line: 1 })
    expect(hint?.component).toBeUndefined()
    expect(hint?.chain).toBeUndefined()
  })

  it("production build (no _debugOwner key, no location): minified names are not worth reporting", () => {
    const min = function Ze() {}
    const host = { type: "div", return: { type: min, return: null } } // no _debugOwner key at all
    expect(fiberToHint(host)).toBeNull()
  })

  it("nothing found -> null; non-objects -> null", () => {
    expect(fiberToHint(fiber("div"))).toBeNull()
    for (const v of [null, undefined, 0, "x", true]) expect(fiberToHint(v)).toBeNull()
  })

  it("survives cycles and junk in _debugSource", () => {
    const a: Record<string, unknown> = fiber(Hero)
    a._debugOwner = a
    a.return = a
    expect(fiberToHint(fiber("div", { _debugOwner: a }))?.chain).toEqual(["Hero"])
    const junk = fiber("div", { _debugSource: { fileName: 5, lineNumber: "7" } })
    expect(fiberToHint(junk)).toBeNull()
  })
})

describe("vueToHint", () => {
  it("Vue 3: type.__file, name || __name, chain via parent", () => {
    const root = { type: { name: "App", __file: "/p/src/App.vue" }, parent: null }
    const mid = { type: { __name: "Layout", __file: "/p/src/Layout.vue" }, parent: root }
    const leaf = { type: { __name: "Hero", __file: "/p/src/Hero.vue" }, parent: mid }
    expect(vueToHint(leaf)).toEqual({
      framework: "vue",
      component: "Hero",
      chain: ["Hero", "Layout", "App"],
      file: "/p/src/Hero.vue",
    })
  })

  it("Vue 3: skips anonymous components, uses only the nearest component's file, caps at 4", () => {
    const names = ["A", "B", "C", "D", "E"]
    let vm: Record<string, unknown> | null = null
    for (const n of names) vm = { type: { name: n, __file: `/${n}.vue` }, parent: vm }
    vm = { type: {}, parent: vm } // nearest instance is anonymous
    const hint = vueToHint(vm)
    expect(hint?.chain).toEqual(["E", "D", "C", "B"])
    expect(hint?.file).toBeUndefined() // the anonymous nearest instance has none; E's file would mislead
  })

  it("Vue 3: functional component (type is a function)", () => {
    function FnComp() {}
    expect(vueToHint({ type: FnComp, parent: null })).toEqual({ framework: "vue", component: "FnComp", chain: ["FnComp"] })
  })

  it("Vue 2: $options.name / __file, chain via $parent", () => {
    const root = { $options: { name: "App" }, $parent: undefined }
    const vm = { $options: { name: "TodoItem", __file: "src/TodoItem.vue" }, $parent: root }
    expect(vueToHint(vm)).toEqual({
      framework: "vue",
      component: "TodoItem",
      chain: ["TodoItem", "App"],
      file: "src/TodoItem.vue",
    })
  })

  it("nothing useful -> null; cycles terminate", () => {
    expect(vueToHint({ type: {}, parent: null })).toBeNull()
    expect(vueToHint(null)).toBeNull()
    expect(vueToHint(42)).toBeNull()
    const loop: Record<string, unknown> = { type: { name: "Loop" } }
    loop.parent = loop
    expect(vueToHint(loop)?.chain).toEqual(["Loop"])
  })
})

describe("svelteToHint", () => {
  it("Svelte 5 (1-based line, 0-based column): column becomes 1-based, component from the file name", () => {
    const meta = { parent: null, loc: { file: "src/lib/Hero.svelte", line: 12, column: 4 } }
    expect(svelteToHint(meta)).toEqual({
      framework: "svelte",
      component: "Hero",
      file: "src/lib/Hero.svelte",
      line: 12,
      column: 5,
    })
  })

  it("Svelte <=4 (0-based line, marked by `char`): line is shifted to 1-based", () => {
    const meta = { loc: { file: "/p/src/Hero.svelte", line: 11, column: 4, char: 230 } }
    expect(svelteToHint(meta)).toMatchObject({ file: "/p/src/Hero.svelte", line: 12, column: 5, component: "Hero" })
  })

  it("windows paths and file names without .svelte", () => {
    expect(svelteToHint({ loc: { file: "C:\\p\\src\\Nav.svelte", line: 1, column: 0 } })?.component).toBe("Nav")
    expect(svelteToHint({ loc: { file: "src/routes/+page", line: 1, column: 0 } })?.component).toBe("+page")
  })

  it("missing or malformed meta -> null", () => {
    for (const v of [undefined, null, {}, { loc: null }, { loc: { line: 1, column: 1 } }, { loc: { file: "" } }, "x"])
      expect(svelteToHint(v)).toBeNull()
  })

  it("keeps a file even when line/column are junk", () => {
    expect(svelteToHint({ loc: { file: "a.svelte", line: "x", column: null } })).toEqual({
      framework: "svelte",
      component: "a",
      file: "a.svelte",
    })
  })
})

describe("probeElement (reads expandos off real DOM nodes)", () => {
  const el = (html = "<div><b>x</b></div>") => {
    document.body.innerHTML = html
    return document.body.firstElementChild as HTMLElement
  }
  const expando = (e: Element, key: string, value: unknown) => ((e as unknown as Record<string, unknown>)[key] = value)

  it("React: any __reactFiber$<random> key (hand-built object)", () => {
    const e = el()
    expando(e, "__reactFiber$abc123", fiber("div", { _debugOwner: fiber(Hero), _debugSource: { fileName: "/p/Hero.tsx", lineNumber: 3, columnNumber: 2 } }))
    expect(probeElement(e)).toMatchObject({ framework: "react", component: "Hero", file: "/p/Hero.tsx", line: 3 })
  })

  it("also finds non-enumerable keys", () => {
    const e = el()
    Object.defineProperty(e, "__reactFiber$hidden", { value: fiber("div", { _debugOwner: fiber(Hero) }), enumerable: false })
    expect(probeElement(e)).toMatchObject({ component: "Hero" })
  })

  it("Vue 3: __vueParentComponent", () => {
    const e = el()
    expando(e, "__vueParentComponent", { type: { __name: "Hero", __file: "/p/Hero.vue" }, parent: null })
    expect(probeElement(e)).toEqual({ framework: "vue", component: "Hero", chain: ["Hero"], file: "/p/Hero.vue" })
  })

  it("Vue 2: __vue__ on the element or on the nearest ancestor that is a component root", () => {
    const e = el("<section><p><i>x</i></p></section>")
    expando(e, "__vue__", { $options: { name: "Panel" } })
    expect(probeElement(e.querySelector("i")!)).toMatchObject({ framework: "vue", component: "Panel" })
    expect(probeElement(e)).toMatchObject({ component: "Panel" })
  })

  it("Svelte: __svelte_meta", () => {
    const e = el()
    expando(e, "__svelte_meta", { loc: { file: "src/Hero.svelte", line: 5, column: 0 } })
    expect(probeElement(e)).toMatchObject({ framework: "svelte", file: "src/Hero.svelte", line: 5 })
  })

  it("plain element -> null", () => {
    expect(probeElement(el())).toBeNull()
  })

  it("a throwing page getter in one detector does not stop the next one", () => {
    const e = el()
    Object.defineProperty(e, "__vueParentComponent", { get() { throw new Error("hostile getter") } })
    expando(e, "__svelte_meta", { loc: { file: "a.svelte", line: 1, column: 0 } })
    expect(probeElement(e)).toMatchObject({ framework: "svelte" })
  })

  it("a React fiber that yields nothing falls through to the next framework", () => {
    const e = el()
    expando(e, "__reactFiber$x", fiber("div")) // nothing to report
    expando(e, "__vueParentComponent", { type: { name: "V" }, parent: null })
    expect(probeElement(e)).toMatchObject({ framework: "vue" })
  })
})

describe("registration and the content-side round trip (one world in jsdom)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-redline-result")
  })
  const mount = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as HTMLElement
  }

  it("register() is idempotent: the module already registered, so a second call adds nothing", () => {
    expect((globalThis as unknown as { __redlineProbe?: boolean }).__redlineProbe).toBe(true)
    expect(register()).toBe(false)
    const e = mount("<div></div>")
    ;(e as unknown as Record<string, unknown>).__svelte_meta = { loc: { file: "a.svelte", line: 1, column: 0 } }
    e.setAttribute("data-redline-probe", "1")
    const write = vi.spyOn(document.documentElement, "setAttribute")
    document.dispatchEvent(new CustomEvent("redline:probe"))
    expect(write.mock.calls.filter(([n]) => n === "data-redline-result")).toHaveLength(1) // one listener, not two
    write.mockRestore()
    e.removeAttribute("data-redline-probe")
  })

  it("does not register (and does not throw) where there is no document", async () => {
    const g = globalThis as unknown as { __redlineProbe?: boolean }
    const before = g.__redlineProbe
    delete g.__redlineProbe
    vi.stubGlobal("document", undefined)
    vi.resetModules()
    try {
      await expect(import("@/content/probe-main")).resolves.toBeDefined()
      expect(g.__redlineProbe).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
      g.__redlineProbe = before
    }
  })

  it("onProbe answers with JSON in data-redline-result for the marked element, and clears it when there is nothing", () => {
    const e = mount("<div></div>")
    ;(e as unknown as Record<string, unknown>).__vueParentComponent = { type: { name: "Hero" }, parent: null }
    e.setAttribute("data-redline-probe", "1")
    onProbe()
    expect(JSON.parse(document.documentElement.getAttribute("data-redline-result")!)).toEqual({
      framework: "vue",
      component: "Hero",
      chain: ["Hero"],
    })
    e.removeAttribute("data-redline-probe")
    document.documentElement.setAttribute("data-redline-result", "stale")
    onProbe() // no marked element any more
    expect(document.documentElement.hasAttribute("data-redline-result")).toBe(false)
  })

  it("describe.redescribe -> event -> probe -> attribute -> SourceHint, and both attributes are gone afterwards", () => {
    const e = mount(`<button id="cta">Go</button>`)
    ;(e as unknown as Record<string, unknown>)["__reactFiber$q1"] = fiber("button", {
      _debugOwner: fiber(CtaButton, { _debugOwner: fiber(App) }),
      _debugSource: { fileName: "/p/src/Hero.tsx", lineNumber: 42, columnNumber: 9 },
    })
    const d = redescribe(e)
    expect(d.source).toEqual({
      framework: "react",
      component: "CtaButton",
      chain: ["CtaButton", "App"],
      file: "/p/src/Hero.tsx",
      line: 42,
      column: 9,
    })
    expect(document.querySelectorAll("[data-redline-probe]")).toHaveLength(0)
    expect(document.documentElement.hasAttribute("data-redline-result")).toBe(false)
  })

  it("an element without framework data gets no source", () => {
    expect(redescribe(mount("<p>x</p>")).source).toBeUndefined()
  })
})
