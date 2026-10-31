// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p2-page — p2's two graphs in Chromium (Playwright), through the real adapter
// loaded with an import map, as the app loads it. Run from the repo root.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const ROOT = process.cwd()
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }
const PAGE = `<!doctype html><script type="importmap">{"imports":{
 "@khronosgroup/gltf-interactivity-engine":"/packages/gltf-interactivity-engine/build/index.js",
 "gl-matrix":"/packages/gl-matrix/esm/index.js"}}</script>
<script type="module">
import { createBehaviorEngine } from '/packages/behaviors/src/adapter.js'
import { graph, lit, to, T, makeWorld } from '/packages/behaviors/tests/fake-world.mjs'
const ids = ['00000000-0000-4000-8000-000000000000']
const PSET = (n) => ({ op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: n, socket: 'value' } } })
function bench(nodes, ticks = 300) {
  const world = makeWorld({ ids, descendants: [0] })
  const e = createBehaviorEngine({ graph: graph(nodes), nodeMap: ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  for (let i = 0; i < 20; i++) e.tick()
  let steps = 0; const t0 = performance.now()
  for (let i = 0; i < ticks; i++) { e.tick(); steps += e.steps }
  const ms = performance.now() - t0
  return { usPerStep: +(ms * 1000 / steps).toFixed(3), stepsPerTick: steps / ticks | 0, msPerTick: +(ms / ticks).toFixed(2) }
}
const a = [
  { op: 'event/onTick', flows: { out: to(1) } },
  { op: 'flow/for', values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1500) }, flows: { loopBody: to(4) } },
  { op: 'type/intToFloat', values: { a: { node: 1, socket: 'index' } } },
  { op: 'math/combine3', values: { a: { node: 2, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/sequence', flows: { a: to(5) } }, PSET(3)]
const b = [{ op: 'event/onTick', flows: { out: to(1) } },
  { op: 'flow/for', values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 350) }, flows: { loopBody: to(16) } },
  { op: 'type/intToFloat', values: { a: { node: 1, socket: 'index' } } }]
for (let k = 0; k < 12; k++) b.push({ op: k % 2 ? 'math/mul' : 'math/add', values: { a: { node: b.length - 1, socket: 'value' }, b: lit(T.float, 1.0001) } })
b.push({ op: 'math/combine3', values: { a: { node: b.length - 1, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } })
b.push(PSET(b.length - 1)); b[1].flows.loopBody = to(b.length - 1)
window.result = { flowHeavy: bench(a), mathHeavy: bench(b) }
</script>`
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE) }
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(body) }
  catch { res.writeHead(404); res.end() }
}).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(`http://127.0.0.1:${server.address().port}/`)
await page.waitForFunction(() => window.result, null, { timeout: 60000 })
console.log(JSON.stringify(await page.evaluate(() => window.result)), await browser.version())
await browser.close(); server.close()
