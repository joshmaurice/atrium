import { createWorldRegistry } from './src/world-registry.js';
import { createServer } from 'node:http';
import { createDb } from './src/db.js';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { dirname } from 'node:path';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../../tests/fixtures/space.gltf');
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-edge-test-'));
const dbPath = join(tempDir, 'test.db');
const db = createDb(dbPath);

async function testPath(path, expected) {
  const httpServer = createServer();
  const port = 9100 + Math.floor(Math.random() * 1000);
  httpServer.listen(port);
  const reg = createWorldRegistry({ httpServer, db });
  await reg.registerWorld('default', FIXTURE_PATH, null);
  
  const ws = new WebSocket('ws://localhost:' + port + path);
  
  let upgraded = false;
  let error = null;
  ws.on('open', () => { upgraded = true; });
  ws.on('error', (e) => { error = e; });
  
  await new Promise(r => setTimeout(r, 500));
  
  ws.close();
  await new Promise(r => setTimeout(r, 100));
  reg.close();
  httpServer.close();
  
  const result = upgraded ? 'UPGRADED' : 'REJECTED';
  const status = result === expected ? '✓' : '✗';
  console.log(status + ' ' + path + ' -> ' + result + ' (expected ' + expected + ')');
}

async function run() {
  console.log('Testing edge cases for /apps/client routing:');
  await testPath('/apps/client', 'UPGRADED');
  await testPath('/apps/client/', 'UPGRADED');
  await testPath('/apps/client?query=1', 'UPGRADED');
  await testPath('/apps/client/?query=1', 'UPGRADED');
  await testPath('/apps/client/subpath', 'REJECTED');
  await testPath('/apps/CLIENT', 'REJECTED');
  await testPath('/APPS/CLIENT', 'REJECTED');
  await testPath('/apps/client/foo/bar', 'REJECTED');
  console.log('Done');
}

run();