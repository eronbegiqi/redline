// Bundles the non-React parts of the extension into dist/ (run AFTER `vite build`,
// which empties dist/). Each entry is a self-contained IIFE: content scripts
// injected with chrome.scripting can't be ES modules.
import { build } from "esbuild"
import { resolve } from "node:path"

const root = import.meta.dirname
await build({
  entryPoints: {
    content: "src/content/index.ts",
    probe: "src/content/probe-main.ts",
    background: "src/background.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  alias: { "@": resolve(root, "src") },
  logLevel: "info",
})
