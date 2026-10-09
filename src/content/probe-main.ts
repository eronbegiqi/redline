import type { SourceHint } from "@/shared/types"

// Runs in the page's MAIN world (chrome.scripting world:"MAIN", bundled as its own IIFE) because
// framework expandos (`__reactFiber$…`, `__vueParentComponent`, `__svelte_meta`) are invisible from
// the isolated content-script world. Self-contained on purpose: no runtime imports.
// Protocol (see docs/SPEC.md "Describe + probe"; the other end is describe.ts):
//   content sets data-redline-probe on the target and dispatches "redline:probe" on document ->
//   we answer with JSON in <html data-redline-result>. Exposes nothing but the window.__redlineProbe flag.

type Rec = Record<string, unknown>
type Loc = { file: string; line?: number; column?: number }

const rec = (x: unknown): Rec | undefined =>
  x && (typeof x === "object" || typeof x === "function") ? (x as Rec) : undefined
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined)
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)

// ---------------------------------------------------------------------------------------------
// React

/**
 * Bundler URL -> project-ish path. Drops origin, ?query and #hash, file:// and webpack(-internal):// schemes,
 * webpack loader layers like "(app-pages-browser)/", a leading ./ and Vite's /@fs/ (an absolute filesystem path)
 * and /@id/ (a module id) prefixes. Absolute paths stay absolute; a Windows "/C:/x" becomes "C:/x".
 */
export function cleanFile(raw: string): string {
  let f = raw.trim().replace(/[?#].*$/, "")
  if (f.startsWith("file://")) f = f.slice(7).replace(/^localhost(?=\/)/i, "")
  else f = f.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*\/?/i, "")
  try {
    f = decodeURIComponent(f) // "%20" in a path, which is how the browser reports it
  } catch {
    // stray % in a file name: keep it raw
  }
  return f
    .replace(/^\([^)]*\)\//, "")
    .replace(/^\/?@fs\//, "/")
    .replace(/^\/?@id\/(?:__x00__)?/, "")
    .replace(/^\/(?=[a-z]:[\\/])/i, "")
    .replace(/^(\.\/)+/, "")
}

// Chrome frames: "at fn (url:1:2)", "at url:1:2", "at async fn (url:1:2)". The optional group
// skips the function name up to the first " (" so webpack urls like "…///(app-pages-browser)/…" survive.
const FRAME = /^\s*at\s+(?:.*?\s\()?(.+?):(\d+):(\d+)\)?\s*$/
const LIBRARY = /node_modules|react-dom|\s|^</ // whitespace/"<anonymous>": eval frames, not a file
// React's element factory. In a single-file dev bundle (esbuild, ...) it lives in the app's own file, so the file test
// cannot tell it from user code: its frame would be reported as the element's source.
const REACT_FN = /^\s*at\s+(?:new\s+)?(?:[\w$]+\.)*(?:jsxDEV(?:Impl)?|jsxsDEV|jsxs?|createElement|cloneElement)\s\(/

/**
 * First frame of a React 19 `_debugStack` that is not React/library code. Positions are those of the
 * served (transformed) file, not source-mapped, so line numbers can drift in TS/JSX dev servers.
 */
export function stackFrame(stack: unknown): Loc | undefined {
  if (typeof stack !== "string") return undefined
  for (const line of stack.split("\n")) {
    const m = REACT_FN.test(line) ? null : FRAME.exec(line)
    if (m && !LIBRARY.test(m[1])) return { file: cleanFile(m[1]), line: +m[2], column: +m[3] }
  }
  return undefined
}

function nameOf(t: unknown): string | undefined {
  const o = rec(t)
  // forwardRef keeps the render fn in `.render`, memo in `.type`; React 19 server owners are plain {name}
  const fn = typeof t === "function" ? o : rec(o?.render ?? o?.type)
  const name = str(o?.displayName) ?? str(fn?.displayName) ?? str(fn?.name) ?? str(o?.name)
  return name && /^[A-Z]/.test(name) && name !== "Fragment" ? name : undefined
}

function ancestry(start: unknown, link: "_debugOwner" | "return"): string[] {
  const out: string[] = []
  for (let n = rec(start), i = 0; n && i < 100 && out.length < 4; n = rec(n[link]), i++) {
    const name = nameOf(n.type ?? n)
    if (name && name !== out.at(-1)) out.push(name)
  }
  return out
}

/** `host fiber` of a DOM element -> hint. Null when nothing useful (or only minified names, i.e. a production build). */
export function fiberToHint(fiber: unknown): SourceHint | null {
  const f = rec(fiber)
  if (!f) return null
  // React <=18 records the JSX site; React 19 only an Error created at it. 1-based line/column both ways.
  const src = rec(f._debugSource)
  const file = str(src?.fileName)
  const loc: Loc | undefined = file
    ? { file: cleanFile(file), line: num(src?.lineNumber), column: num(src?.columnNumber) }
    : stackFrame(rec(f._debugStack)?.stack)
  // The owner chain names the component whose render produced the element, which is the one
  // `loc` points into (children passed through <Card> are owned by the caller, not by Card).
  // Fibers without an owner fall back to the parent chain.
  let chain = ancestry(f._debugOwner, "_debugOwner")
  if (!chain.length) chain = ancestry(f.return, "return")
  // `_debugOwner` exists on dev fibers only; without it and without a location the names are minified noise.
  if (!loc && (!chain.length || !("_debugOwner" in f))) return null
  return { framework: "react", component: chain[0], chain: chain.length ? chain : undefined, ...loc }
}

// ---------------------------------------------------------------------------------------------
// Vue / Svelte

/** Vue 3 internal instance (`type`, `parent`) or Vue 2 vm (`$options`, `$parent`). */
export function vueToHint(vm: unknown): SourceHint | null {
  const opts = (i: Rec | undefined) => rec(i?.$options ?? i?.type)
  const names: string[] = []
  for (let i = rec(vm), n = 0; i && n < 50 && names.length < 4; i = rec(i.$parent ?? i.parent), n++) {
    const name = str(opts(i)?.name) ?? str(opts(i)?.__name)
    if (name && name !== names.at(-1)) names.push(name)
  }
  const rawFile = str(opts(rec(vm))?.__file)
  const file = rawFile && cleanFile(rawFile) // only the nearest component's file: a parent's would mislead
  if (!names.length && !file) return null
  return { framework: "vue", component: names[0], chain: names.length ? names : undefined, file }
}

/** `el.__svelte_meta` -> hint. Svelte <=4 stores a 0-based line (and a `char` field), Svelte 5 a 1-based one; columns are 0-based. */
export function svelteToHint(meta: unknown): SourceHint | null {
  const loc = rec(rec(meta)?.loc)
  const file = str(loc?.file)
  if (!loc || !file) return null
  const line = num(loc.line)
  const column = num(loc.column)
  return {
    framework: "svelte",
    component: file.split(/[\\/]/).pop()?.replace(/\.svelte$/, "") || undefined,
    file: cleanFile(file),
    line: line === undefined ? undefined : line + ("char" in loc ? 1 : 0),
    column: column === undefined ? undefined : column + 1,
  }
}

// ---------------------------------------------------------------------------------------------
// Element -> hint

function reactHint(el: Element): SourceHint | null {
  const key = Object.getOwnPropertyNames(el).find((k) => k.startsWith("__reactFiber$"))
  return key ? fiberToHint((el as unknown as Rec)[key]) : null
}

function vueHint(el: Element): SourceHint | null {
  const v3 = (el as unknown as Rec).__vueParentComponent
  if (v3) return vueToHint(v3)
  // Vue 2 only tags a component's root element, so look outwards for the nearest one
  for (let n: Element | null = el; n; n = n.parentElement) {
    const v2 = (n as unknown as Rec).__vue__
    if (v2) return vueToHint(v2)
  }
  return null
}

const svelteHint = (el: Element) => svelteToHint((el as unknown as Rec).__svelte_meta)

export function probeElement(el: Element): SourceHint | null {
  for (const detect of [reactHint, vueHint, svelteHint]) {
    try {
      const hint = detect(el)
      if (hint) return hint
    } catch {
      // a hostile getter on the page's object must not stop the other detectors
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Wiring

export function onProbe(): void {
  try {
    const el = document.querySelector("[data-redline-probe]")
    const hint = el && probeElement(el)
    const root = document.documentElement
    if (hint) root.setAttribute("data-redline-result", JSON.stringify(hint))
    else root.removeAttribute("data-redline-result")
  } catch {
    // never throw into the page
  }
}

const HOST = "[data-redline-host]"

/**
 * Focus containment (React Aria / HeroUI modals) re-checks `document.activeElement` a frame after focus leaves the
 * dialog and pulls it back, so a panel input could never be typed in. While our host holds focus, report the page
 * element that had it before instead (activeElement is the host: our iframe sits in a closed shadow root).
 * shortcut: the remembered element can be stale if focus was on <body> before the panel was clicked; harmless.
 */
function hideHostFocus() {
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")
  if (!desc?.get) return
  const get = desc.get
  let last: Element | null = null
  const remember = (e: Event) => {
    if (e.target instanceof Element && !e.target.matches(HOST)) last = e.target
  }
  window.addEventListener("focusin", remember, true)
  window.addEventListener("focusout", remember, true)
  Object.defineProperty(Document.prototype, "activeElement", {
    ...desc,
    get(this: Document) {
      const a = get.call(this) as Element | null
      return a?.matches(HOST) && last?.isConnected ? last : a
    },
  })
}

/** Idempotent: a second injection (toolbar clicked again) must not add a second listener. */
export function register(): boolean {
  const g = globalThis as unknown as { __redlineProbe?: boolean }
  if (typeof document === "undefined" || g.__redlineProbe) return false
  g.__redlineProbe = true
  document.addEventListener("redline:probe", onProbe)
  try {
    hideHostFocus()
  } catch {
    // never throw into the page
  }
  return true
}

register()
