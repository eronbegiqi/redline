// Builds the extension and zips dist/ for the Chrome Web Store (manifest.json must sit at the zip root).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" })

run("npm", ["run", "build"])

const { version, description } = JSON.parse(readFileSync(resolve(root, "dist/manifest.json"), "utf8"))
if (description.length > 132) throw new Error(`manifest description is ${description.length} chars; the store allows 132`)

mkdirSync(resolve(root, "release"), { recursive: true })
const zip = resolve(root, `release/redline-${version}.zip`)
rmSync(zip, { force: true })
run("zip", ["-r", "-X", zip, ".", "-x", "*.DS_Store", "-x", "*.map"], resolve(root, "dist"))

console.log(`\n${zip}\n${(statSync(zip).size / 1024).toFixed(0)} KB, version ${version}`)
