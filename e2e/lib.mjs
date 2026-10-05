// Harness for the real-extension e2e suite: build, packaged copy with host_permissions, fixture server,
// Playwright chromium with the extension loaded, injection exactly like background.ts, panel helpers.
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { build as esbuild } from "esbuild"
import { chromium } from "playwright"

const here = dirname(fileURLToPath(import.meta.url))
export const root = join(here, "..")
export const OUT = join(here, "out")
mkdirSync(OUT, { recursive: true })

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" }
// Fixtures that must be served with extra headers.
const HEADERS = {
  "/csp.html": {
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'none'",
  },
}
// Built assets that are not files on disk (react fixture bundle).
export const virtual = new Map()

/** The React 19 fixture, bundled in development mode (component names + debug info survive). */
export async function bundleReactFixture() {
  const r = await esbuild({
    entryPoints: [join(here, "fixtures", "react-app.jsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    jsxDev: true,
    minify: false,
    sourcemap: false,
    nodePaths: [join(root, "node_modules")],
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
  })
  virtual.set("/react-app.js", r.outputFiles[0].text)
}

export function build() {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" })
}

/** dist/ copied to a temp dir with <all_urls>: activeTab cannot be granted programmatically. */
export function packageExtension() {
  const dir = mkdtempSync(join(tmpdir(), "redline-ext-"))
  cpSync(join(root, "dist"), dir, { recursive: true })
  const p = join(dir, "manifest.json")
  const m = JSON.parse(readFileSync(p, "utf8"))
  m.host_permissions = ["<all_urls>"]
  writeFileSync(p, JSON.stringify(m))
  return dir
}

export async function startServer() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname
    const body = virtual.get(path)
    let data = body
    if (data === undefined) {
      try {
        data = readFileSync(join(here, "fixtures", normalize(path).replace(/^(\.\.[/\\])+/, "")))
      } catch {
        res.writeHead(404).end("not found")
        return
      }
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "text/plain", ...HEADERS[path] })
    res.end(data)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return { origin: `http://localhost:${server.address().port}`, close: () => server.close() }
}

export async function launch(extDir) {
  const profile = mkdtempSync(join(tmpdir(), "redline-profile-"))
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium", // bundled Chromium (new headless); branded Chrome ignores --load-extension
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  })
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"))
  return { ctx, sw }
}

/** The same two chrome.scripting.executeScript calls as src/background.ts, run in the extension's service worker. */
export async function inject(env, page) {
  const u = new URL(page.url())
  const pattern = `${u.origin}${u.pathname}*`
  await env.sw.evaluate(async (pattern) => {
    const [tab] = await chrome.tabs.query({ url: pattern })
    if (!tab) throw new Error("no tab for " + pattern)
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["probe.js"] })
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
  }, pattern)
}

const panelFrame = (page) => page.frames().find((f) => f.url().startsWith("chrome-extension://"))

/** Waits for the panel iframe and for the handshake (the header is only rendered once a state arrived). */
export async function panelOf(page) {
  const t0 = Date.now()
  while (!panelFrame(page)) {
    if (Date.now() - t0 > 10000) throw new Error("panel frame never appeared")
    await page.waitForTimeout(50)
  }
  const f = panelFrame(page)
  await f.getByText("Redline", { exact: true }).first().waitFor({ timeout: 10000 })
  return f
}

// The panel shows a first-run walkthrough once per profile (localStorage on the extension origin).
export const tourDialog = (panel) => panel.getByRole("dialog", { name: "Redline walkthrough" })
let tourSeen = false
export const markTourSeen = () => (tourSeen = true)

/** Fresh page on a fixture, extension injected, panel connected. `tour: true` leaves the first-run walkthrough alone. */
export async function open(env, path = "/basic.html", { inject: doInject = true, colorScheme, tour = false } = {}) {
  const page = await env.ctx.newPage()
  if (colorScheme) await page.emulateMedia({ colorScheme })
  await page.goto(env.origin + path)
  if (!doInject) return { page }
  await inject(env, page)
  const panel = await panelOf(page)
  if (!tour && !tourSeen) {
    const dlg = tourDialog(panel)
    if (await dlg.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
      await panel.getByRole("button", { name: "Skip" }).click()
      await dlg.waitFor({ state: "hidden" })
    }
    tourSeen = true
  }
  return { page, panel }
}

export const center = async (page, sel) => {
  const b = await page.locator(sel).boundingBox()
  if (!b) throw new Error("no box for " + sel)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

export async function clickAt(page, sel, opts = {}) {
  const { x, y } = await center(page, sel)
  await page.mouse.click(x, y, opts)
}

/** Panel tab switch (the Changes tab's accessible name carries the count badge). */
export const tab = (panel, name) => panel.getByRole("tab", { name: new RegExp(`^${name}`) }).click()

/** Rows of the Changes tab as {selector, summary}. */
export async function changeRows(panel) {
  await tab(panel, "Changes")
  await panel.waitForTimeout(100)
  const rows = await panel.locator('[data-slot="item"]').all()
  const out = []
  for (const r of rows) {
    out.push({
      selector: ((await r.locator('[data-slot="item-title"]').getAttribute("title")) ?? "").trim(),
      summary: ((await r.locator('[data-slot="item-description"]').getAttribute("title")) ?? "").trim(),
    })
  }
  return out
}

/** The prompt exactly as "Copy for AI" would copy it, read from the Changes tab's preview. */
export async function previewPrompt(panel) {
  await tab(panel, "Changes")
  const ta = panel.getByLabel("Prompt preview")
  if (!(await ta.isVisible())) await panel.getByRole("button", { name: "Preview prompt" }).click()
  return await ta.inputValue()
}

/**
 * The selection outline drawn in our CLOSED shadow root, as a viewport rect (or null when hidden / absent).
 * Content scripts cannot be asked, but DevTools' DOM domain pierces closed shadow roots.
 */
export async function selectionBox(env, page, cls = "sel") {
  const cdp = await env.ctx.newCDPSession(page)
  try {
    await cdp.send("DOM.enable")
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    let found = null
    const walk = (n) => {
      const a = n.attributes ?? []
      const c = a[a.indexOf("class") + 1]
      if (a.includes("class") && c.split(/\s+/).includes("box") && c.split(/\s+/).includes(cls)) found = { n, hidden: a.includes("hidden") }
      for (const k of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(k)
    }
    walk(root)
    if (!found || found.hidden) return null
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: found.n.nodeId })
    const xs = model.border.filter((_, i) => i % 2 === 0)
    const ys = model.border.filter((_, i) => i % 2 === 1)
    const [l, t, r, b] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    return { l, t, r, b, w: r - l, h: b - t }
  } catch {
    return null
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/** Select an element with a real click in select mode. */
export async function pick(page, sel) {
  await clickAt(page, sel)
  await page.waitForTimeout(150)
}

export async function setField(panel, label, value) {
  const input = panel.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press("Enter")
  await panel.waitForTimeout(150)
}

export const html = (page, sel = "body") => page.locator(sel).evaluate((e) => e.outerHTML)

export async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

// ---- tiny runner -------------------------------------------------------------------------------

export class Suite {
  constructor() {
    this.items = []
    this.results = []
  }
  add(id, name, fn) {
    this.items.push({ id, name, fn })
  }
  async run(env, only) {
    for (const s of this.items) {
      if (only && !only.includes(String(s.id))) continue
      const notes = []
      const ctx = { ...env, note: (m) => notes.push(m), id: s.id }
      let status = "PASS"
      let err = ""
      const t0 = Date.now()
      try {
        await s.fn(ctx)
      } catch (e) {
        status = "FAIL"
        err = String(e?.stack ?? e).split("\n").slice(0, 40).join("\n")
      }
      this.results.push({ ...s, status })
      console.log(`${status} ${s.id}. ${s.name} (${Date.now() - t0}ms)`)
      for (const n of notes) console.log(`     note: ${n}`)
      if (err) console.log(err.replace(/^/gm, "     "))
      for (const p of env.ctx.pages().slice(1)) await p.close().catch(() => {})
    }
    return this.results.every((r) => r.status === "PASS")
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg)
}
export function eq(actual, expected, msg) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual)
  const e = typeof expected === "string" ? expected : JSON.stringify(expected)
  if (a === e) return
  let i = 0
  while (a[i] === e[i]) i++
  const cut = (v) => JSON.stringify(v.slice(Math.max(0, i - 40), i + 80))
  throw new Error(`${msg}: first difference at ${i}: expected ${cut(e)}, got ${cut(a)}`)
}
