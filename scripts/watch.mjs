// Rebuild dist/ whenever src/ changes, so testing is: save, refresh the tab, click the Redline icon.
// Unpacked extensions are read from disk on every injection, so no reload on chrome://extensions is needed
// (only after changing src/background.ts or the manifest). Skips tsc: run `npm run typecheck` separately.
import { spawn } from "node:child_process"
import { watch } from "node:fs"

let running = false
let again = false
let timer

function build() {
  if (running) return void (again = true)
  running = true
  const t = Date.now()
  const p = spawn("sh", ["-c", "vite build && node build-ext.mjs"], {
    stdio: ["ignore", "ignore", "inherit"],
  })
  p.on("close", (code) => {
    running = false
    const at = new Date().toLocaleTimeString()
    console.log(
      code === 0
        ? `[${at}] built in ${Date.now() - t}ms. Refresh the tab, click the Redline icon.`
        : `[${at}] build FAILED (see above)`
    )
    if (again) {
      again = false
      build()
    }
  })
}

for (const path of ["src", "panel.html"])
  watch(path, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(build, 300)
  })
console.log("Watching src/ ...")
build()
