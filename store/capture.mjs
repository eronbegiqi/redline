// Captures the Chrome Web Store assets with the REAL built extension in Playwright's Chromium.
//   npm run screenshots        (builds first; STORE_SKIP_BUILD=1 reuses dist/)
// Output: store/screenshots/*.png  (1280x800 screenshots, 440x280 small tile, 1400x560 marquee)
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { build, center, launch, markTourSeen, open, packageExtension, panelOf, root, startServer, tab, tourDialog, virtual } from "../e2e/lib.mjs"

const OUT = join(root, "store/screenshots")
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) })

if (!process.env.STORE_SKIP_BUILD) build()
virtual.set("/demo.html", readFileSync(join(root, "store/demo.html")))
const server = await startServer()
const { ctx, sw } = await launch(packageExtension())
const env = { ctx, sw, origin: server.origin }

const settle = (page) => page.waitForTimeout(450)

/** Click a mode toggle and wait until it is really the active one (the first click can race the panel's first render). */
async function setMode(panel, name) {
  const r = panel.getByRole("radio", { name })
  for (let i = 0; i < 5 && (await r.getAttribute("aria-checked")) !== "true"; i++) {
    await r.click()
    await panel.waitForTimeout(250)
  }
  if ((await r.getAttribute("aria-checked")) !== "true") throw new Error(`mode "${name}" never became active`)
}

// Grab and drop on the card's left padding so the whole card (not the text inside it) is the element in play.
async function drag(page, from, to, { release }) {
  const a = await center(page, from)
  const b = await center(page, to)
  const sx = a.box.x + 10
  const tx = b.box.x + 10 // left-edge zone of the target: "drop before"
  await page.mouse.move(sx, a.y)
  await page.mouse.down()
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(sx + ((tx - sx) * i) / 24, a.y + ((b.y - a.y) * i) / 24)
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(200)
  if (!release) return
  await page.mouse.up()
  await settle(page)
}

// Park the pointer over the panel header: no hover outline on the page, no hover state in the panel.
const park = (page) => page.mouse.move(962, 167)

try {
  // 05: first-run walkthrough (must be the first panel of this profile)
  {
    const { page, panel } = await open(env, "/demo.html", { tour: true })
    await tourDialog(panel).waitFor()
    await settle(page)
    await shot(page, "05-walkthrough")
    await panel.getByRole("button", { name: "Skip" }).click()
    markTourSeen()
    await page.close()
  }

  // 01: select + edit
  {
    const { page, panel } = await open(env, "/demo.html")
    await page.mouse.click(700, 600) // nothing useful, makes sure focus is on the page
    await panel.getByRole("button", { name: "Close panel" }).isVisible()
    const c = await center(page, "#cta")
    await page.mouse.click(c.x, c.y)
    await settle(page)
    await panel.getByLabel("Text", { exact: true }).fill("Start your free trial")
    await settle(page)
    const set = async (label, v) => {
      const i = panel.getByLabel(label, { exact: true })
      await i.fill(v)
      await i.press("Enter")
      await page.waitForTimeout(150)
    }
    await set("Padding left", "30px")
    await set("Padding right", "30px")
    await panel.getByRole("button", { name: "Spacing" }).click()
    await panel.getByRole("button", { name: "Typography" }).click()
    await panel.getByRole("button", { name: "Appearance" }).click()
    await set("Background", "#2f6bff")
    await set("Radius", "999px")
    // start the scrolled panel at the Text field so no element card is cut in half
    await panel.getByText("Text", { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: "start" }))
    await park(page)
    await settle(page)
    await shot(page, "01-select-and-edit")
    await page.close()
  }

  // 02: drag and drop in progress
  {
    const { page, panel } = await open(env, "/demo.html")
    await setMode(panel, "Drag & drop")
    await settle(page)
    await drag(page, "#card-announce", "#card-plan", { release: false })
    await settle(page)
    await shot(page, "02-drag-and-drop")
    await page.mouse.up()
    await page.close()
  }

  // 03 + 04: Changes tab and prompt preview, with a mix of panel and DevTools edits
  {
    const { page, panel } = await open(env, "/demo.html")
    const set = async (label, v) => {
      const i = panel.getByLabel(label, { exact: true })
      await i.fill(v)
      await i.press("Enter")
      await page.waitForTimeout(150)
    }
    // headline text
    let c = await center(page, "#headline")
    await page.mouse.click(c.x, c.y)
    await settle(page)
    await panel.getByLabel("Text", { exact: true }).fill("Launch day, without the chaos.")
    await settle(page)
    // CTA colour + radius
    c = await center(page, "#cta")
    await page.mouse.click(c.x, c.y)
    await settle(page)
    await panel.getByRole("button", { name: "Typography" }).click()
    await panel.getByRole("button", { name: "Appearance" }).click()
    await set("Background", "#2f6bff")
    await set("Radius", "999px")
    // reorder a card
    await setMode(panel, "Drag & drop")
    await drag(page, "#card-announce", "#card-plan", { release: true })
    // an edit made in Chrome DevTools, over the same protocol DevTools uses
    await setMode(panel, "Select & edit")
    await panel.getByRole("switch", { name: "DevTools" }).click()
    await settle(page)
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("DOM.enable")
    const { root: doc } = await cdp.send("DOM.getDocument")
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: doc.nodeId, selector: ".lead" })
    await cdp.send("DOM.setAttributeValue", { nodeId, name: "style", value: "color: #2f6bff; max-width: 520px" })
    await settle(page)
    await tab(panel, "Changes")
    await park(page)
    await settle(page)
    await shot(page, "03-changes")
    await panel.getByRole("button", { name: "Preview prompt" }).click()
    // scroll the preview to the "Changes" section: that is the interesting part
    await panel.getByLabel("Prompt preview").evaluate((t) => {
      t.scrollTop = (t.value.indexOf("## Changes") / t.value.length) * t.scrollHeight
    })
    await settle(page)
    await shot(page, "04-prompt-preview")
    await page.close()
  }

  // promo tiles: brand copy + a crop of the panel from screenshot 01
  {
    const icon = readFileSync(join(root, "public/icons/icon-128.png")).toString("base64")
    const crop = readFileSync(join(OUT, "01-select-and-edit.png")).toString("base64")
    const tile = (w, h) => `<!doctype html><meta charset=utf-8><style>
      *{box-sizing:border-box;margin:0}
      body{width:${w}px;height:${h}px;overflow:hidden;position:relative;color:#fff;font:600 16px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
        background:radial-gradient(120% 140% at 0% 0%,#3a4cff 0%,#1b1f3a 55%,#10121c 100%)}
      .copy{position:absolute;left:${w * 0.07}px;top:50%;transform:translateY(-50%);width:${w * 0.46}px}
      .brand{display:flex;align-items:center;gap:${h * 0.035}px;font-size:${h * 0.095}px;font-weight:800;letter-spacing:-.02em;margin-bottom:${h * 0.07}px}
      .brand img{width:${h * 0.13}px;height:${h * 0.13}px;border-radius:${h * 0.03}px}
      h1{font-size:${h * 0.115}px;line-height:1.08;letter-spacing:-.025em;font-weight:800}
      p{margin-top:${h * 0.06}px;font-size:${h * 0.055}px;font-weight:500;color:#c9cdf0;line-height:1.35}
      .shot{position:absolute;right:${w * 0.05}px;top:${h * 0.12}px;width:${w * 0.36}px;height:${h * 1.05}px;border-radius:${h * 0.04}px;
        background:url(data:image/png;base64,${crop}) -${904 * (w * 0.36 / 360)}px -${145 * (w * 0.36 / 360)}px / ${1280 * (w * 0.36 / 360)}px auto no-repeat;
        box-shadow:0 ${h * 0.05}px ${h * 0.12}px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.12)}
    </style>
    <div class=copy><div class=brand><img src="data:image/png;base64,${icon}">Redline</div>
      <h1>Edit the page.<br>Hand it to your AI.</h1><p>Visual edits become a ready-to-paste prompt.</p></div><div class=shot></div>`
    const b = await chromium.launch()
    for (const [name, w, h] of [["promo-small-440x280", 440, 280], ["promo-marquee-1400x560", 1400, 560]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } })
      await p.setContent(tile(w, h))
      await p.screenshot({ path: join(OUT, `${name}.png`) })
      await p.close()
    }
    await b.close()
  }
} finally {
  await ctx.close().catch(() => {})
  server.close()
}
console.log("wrote", OUT)
