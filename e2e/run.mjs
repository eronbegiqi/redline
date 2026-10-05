// End-to-end suite: the REAL built extension in Playwright's Chromium. `npm run test:e2e`.
// E2E_SKIP_BUILD=1 reuses dist/; `node e2e/run.mjs 3 7` runs only scenarios 3 and 7.
import { build, bundleReactFixture, launch, packageExtension, startServer, Suite } from "./lib.mjs"
import { register } from "./scenarios.mjs"

if (!process.env.E2E_SKIP_BUILD) build()
await bundleReactFixture()
const server = await startServer()
const { ctx, sw } = await launch(packageExtension())
const suite = new Suite()
register(suite)

let ok = false
try {
  ok = await suite.run({ ctx, sw, origin: server.origin }, process.argv.length > 2 ? process.argv.slice(2) : undefined)
} finally {
  await ctx.close().catch(() => {})
  server.close()
}
const n = suite.results.length
const failed = suite.results.filter((r) => r.status === "FAIL").length
console.log(`\n${n - failed}/${n} scenarios passed`)
process.exit(ok && n ? 0 : 1)
