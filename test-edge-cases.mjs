import { createWorldRegistry } from './packages/server/src/world-registry.js'
import { createServer } from 'node:http'
import { createDb } from './packages/server/src/db.js'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

const tempDir = mkdtempSync(join(tmpdir(), 'atrium-edge-test-'))
const dbPath = join(tempDir, 'test.db')
const db = createDb(dbPath)
const FIXTURE_PATH = join('tests', 'fixtures', 'space.gltf')

async function testPath(port, path, shouldSucceed, description) {
  return new Promise((resolve) => {
    const httpServer = createServer()
    httpServer.listen(port)
    const reg = createWorldRegistry({ httpServer, db })
    
    // Need to import the fixture path correctly
    import('./packages/server/src/world.js').then(async ({ createWorld }) => {
      const world = await createWorld(FIXTURE_PATH)
      await world.resolveExternalReferences()
      await reg.registerWorld('default', FIXTURE_PATH, null)
      
      let upgraded = false
      let error = null
      
      const ws = new WebSocket(`ws://localhost:${port}${path}`)
      ws.on('open', () => { upgraded = true })
      ws.on('error', (e) => { error = e })
      
      await new Promise(r => setTimeout(r, 500))
      
      if (upgraded) {
        ws.close()
      }
      
      reg.close()
      httpServer.close()
      
      const passed = shouldSucceed ? upgraded : !upgraded
      console.log(`${passed ? 'PASS' : 'FAIL'} ${description}`)
      console.log(`  Path: ${path}`)
      console.log(`  Upgraded: ${upgraded}, Expected: ${shouldSucceed}`)
      if (error) console.log(`  Error: ${error.message}`)
      console.log('')
      
      resolve(passed)
    })
  })
}

async function runTests() {
  console.log('=== Edge case tests for resolveWorldId ===\n')
  
  const tests = [
    // Basic cases
    { port: 9100, path: '/', shouldSucceed: true, desc: 'Bare root /' },
    { port: 9101, path: '/apps/client', shouldSucceed: true, desc: '/apps/client (no trailing slash)' },
    { port: 9102, path: '/apps/client/', shouldSucceed: true, desc: '/apps/client/ (with trailing slash)' },
    
    // Case sensitivity
    { port: 9103, path: '/apps/CLIENT', shouldSucceed: false, desc: '/apps/CLIENT (uppercase - should fail)' },
    { port: 9104, path: '/Apps/Client', shouldSucceed: false, desc: '/Apps/Client (mixed case - should fail)' },
    
    // Subpaths - should NOT match
    { port: 9105, path: '/apps/client/foo', shouldSucceed: false, desc: '/apps/client/foo (subpath - should fail)' },
    { port: 9106, path: '/apps/client/sub/path', shouldSucceed: false, desc: '/apps/client/sub/path (deep subpath - should fail)' },
    { port: 9107, path: '/apps/client/', shouldSucceed: true, desc: '/apps/client/ again (regression check)' },
    
    // Query strings (should be stripped by URL parser)
    { port: 9108, path: '/apps/client?foo=bar', shouldSucceed: true, desc: '/apps/client?foo=bar (query string)' },
    { port: 9109, path: '/?foo=bar', shouldSucceed: true, desc: '/?foo=bar (root with query)' },
    
    // Unknown paths
    { port: 9110, path: '/unknown', shouldSucceed: false, desc: '/unknown (unknown path)' },
    { port: 9111, path: '/home/test', shouldSucceed: false, desc: '/home/test (future route - returns null)' },
    { port: 9112, path: '/public/test', shouldSucceed: false, desc: '/public/test (future route - returns null)' },
    { port: 9113, path: '/ws/myworld', shouldSucceed: false, desc: '/ws/myworld (reserved - needs world registered)' },
  ]
  
  let passed = 0
  let failed = 0
  
  for (const t of tests) {
    const result = await testPath(t.port, t.path, t.shouldSucceed, t.desc)
    if (result) passed++
    else failed++
  }
  
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`)
  
  // Cleanup
  import('node:fs/promises').then(fs => fs.rm(tempDir, { recursive: true, force: true }))
  
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(console.error)