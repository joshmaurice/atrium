// GR3: step 4 (the cycle) before step 5 (the bounds). A chain of 6 under a
// top-level node, moved into its own deepest part: a cycle AND (if counted) 13 generations.
const root = process.argv[2]
const { createWorld } = await import(root + '/packages/server/src/world.js')
const { parentChangeProblem } = await import(root + '/packages/server/src/session.js')
const world = await createWorld(root + '/tests/fixtures/space.gltf')
let d = { name: 'c-0' }; const top = d
for (let i = 1; i <= 6; i++) { const n = { name: `c-${i}` }; d.children = [n]; d = n }
world.som.scene.addChild(world.som.ingestNode(top))
const r = parentChangeProblem(world.som.getNodeByName('c-0'), 'c-6', world, new Set())
console.log(root, '→', r)
