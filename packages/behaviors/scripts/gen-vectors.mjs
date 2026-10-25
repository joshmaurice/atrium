// Generator for tests/fixtures/behavior-vectors.json (scripting-4b-2 F1).
// Run from packages/behaviors: node scripts/gen-vectors.mjs
import { writeFileSync } from 'node:fs'
import { templateGraph } from '../src/templates.js'
import { behaviorCheck } from '../src/behavior-spec.js'
import { validateInteractivityGraph } from '@khronosgroup/gltf-interactivity-engine'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const clone = (v) => JSON.parse(JSON.stringify(v))
const to = (node, socket = 'in') => ({ node, socket })

const tpl = (id, params) => templateGraph(id, params, { ownId: OWN })

const accepted = []
const refused = []
const addOk = (name, value) => accepted.push({ name, value })
const addBad = (name, code, value) => refused.push({ name, code, value })

// --- the five templates' canonical outputs (nine variants) -------------------
const visHide = tpl('select-visibility', { target: TGT, action: 'hide' })
const visShow = tpl('select-visibility', { target: TGT, action: 'show' })
const visToggle = tpl('select-visibility', { target: TGT, action: 'toggle' })
const animPlay = tpl('select-animation', { target: TGT, clip: 'Idle', action: 'play', loop: true })
const animStop = tpl('select-animation', { target: TGT, clip: 'Idle', action: 'stop', loop: false })
const animSelf = tpl('select-animation', { target: OWN, clip: 'Idle', action: 'play', loop: true })
const prox = tpl('proximity-animation', { target: TGT, clip: 'Walk', loop: true, radius: 3 })
const light = tpl('select-light', { target: TGT, intensity: 2.5 })
const interval = tpl('interval-animation', { target: TGT, clip: 'Idle', loop: true, seconds: 30 })
// The degenerate self-target: nodeMap is [own] and the pointer's `[n]` literal
// is 0. A hard-coded 1 would be out of range here and F1 would refuse the
// template's own output.
const visSelf = tpl('select-visibility', { target: OWN, action: 'toggle' })

addOk('template: select-visibility hide', visHide)
addOk('template: select-visibility show', visShow)
addOk('template: select-visibility toggle', visToggle)
addOk('template: select-animation play', animPlay)
addOk('template: select-animation stop', animStop)
addOk('template: select-animation on its own node', animSelf)
addOk('template: proximity-animation', prox)
addOk('template: select-light', light)
addOk('template: interval-animation', interval)
addOk('template: select-visibility on its own node', visSelf)

// --- boundaries that are legal ----------------------------------------------
{
  const v = clone(animPlay); v.animations[0].clip = 'c'.repeat(300)
  addOk('boundary: clip 300 characters', v)
}
{
  const v = clone(animPlay); v.graph.nodes[1].values.speed = { type: 2, value: [0.1] }
  addOk('boundary: speed 0.1', v)
}
{
  const v = clone(animPlay); v.graph.nodes[1].values.speed = { type: 2, value: [10] }
  addOk('boundary: speed 10', v)
}
{
  const v = clone(prox); v.proximity.radius = 0.5
  addOk('boundary: radius 0.5', v)
}
{
  const v = clone(prox); v.proximity.radius = 50
  addOk('boundary: radius 50', v)
}
{
  const v = clone(interval); v.interval.seconds = 1
  addOk('boundary: seconds 1', v)
}
{
  const v = clone(interval); v.interval.seconds = 3600
  addOk('boundary: seconds 3600', v)
}
{
  const v = clone(animPlay)
  v.targets = Array.from({ length: 16 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
  addOk('boundary: targets 16', v)
}
{
  const v = clone(animPlay)
  v.nodeMap = [OWN, ...Array.from({ length: 15 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)]
  addOk('boundary: nodeMap 16', v)
}
{
  const v = clone(animPlay)
  v.animations = Array.from({ length: 8 }, () => ({ object: TGT, clip: 'Idle', loop: true }))
  addOk('boundary: animations 8', v)
}
// The operator's note (2026-10-25), item 3: the two accepted boundaries that ARE
// reachable. 64 graph nodes must pass the validator with a forward-only DAG.
{
  const v = clone(visHide)
  v.graph.declarations = [
    { op: 'event/onSelect', extension: 'KHR_node_selectability' },
    { op: 'debug/log' },
  ]
  const nodes = [{ ...clone(v.graph.nodes[0]), declaration: 0, flows: { out: to(1) } }]
  for (let i = 1; i <= 63; i++) {
    nodes.push({
      declaration: 1,
      configuration: { message: { value: ['hi'] }, severity: { value: [0] } },
      ...(i < 63 ? { flows: { out: to(i + 1) } } : {}),
    })
  }
  v.graph.nodes = nodes
  addOk('boundary: 64 graph nodes', v)
}
{
  // 16 types: the four the templates use keep their indices, and the rest are
  // `custom` signatures — the validator refuses DUPLICATE builtin signatures,
  // but repeated `custom` ones are allowed (operator's note, item 3).
  const v = clone(animPlay)
  v.graph.types = [...v.graph.types, ...Array.from({ length: 12 }, () => ({ signature: 'custom' }))]
  addOk('boundary: 16 types', v)
}

// --- refusals ----------------------------------------------------------------
addBad('kind: js', 'behavior-kind', { ...clone(animPlay), kind: 'js' })
addBad('origin: import', 'behavior-origin', { ...clone(animPlay), origin: 'https://example.invalid/g.json' })
addBad('enabled: a string', 'behavior-enabled', { ...clone(animPlay), enabled: 'yes' })
addBad('an unknown top-level key', 'behavior-type', { ...clone(animPlay), extra: 1 })
addBad('the value is not an object', 'behavior-type', 42)

{
  // The size rule runs before the template rule, so an over-long clip in
  // template.params is the cheapest legal-keyed value past the byte cap.
  const v = clone(animPlay)
  v.template.params.clip = 'x'.repeat(20000)
  addBad('bytes past 16,384', 'behavior-bytes', v)
}
{
  const v = clone(animPlay); v.graph.variables = []
  addBad('variables: []', 'behavior-size', v)
}
{
  const v = clone(animPlay); v.graph.events = []
  addBad('events: []', 'behavior-size', v)
}
{
  const v = clone(animPlay)
  v.graph.nodes = Array.from({ length: 65 }, () => ({ declaration: 0 }))
  addBad('65 graph nodes', 'behavior-size', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations = Array.from({ length: 33 }, () => ({ op: 'debug/log' }))
  addBad('33 declarations', 'behavior-size', v)
}
{
  const v = clone(animPlay)
  v.graph.types = Array.from({ length: 17 }, () => ({ signature: 'float' }))
  addBad('17 types', 'behavior-size', v)
}
{
  const v = clone(prox)
  v.graph.events = Array.from({ length: 9 }, () => ({ id: 'atrium/enter' }))
  addBad('9 declared events', 'behavior-size', v)
}
{
  const v = clone(animPlay)
  v.nodeMap = [OWN, ...Array.from({ length: 16 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)]
  addBad('nodeMap 17', 'behavior-map', v)
}
{
  const v = clone(animPlay); v.nodeMap = []
  addBad('nodeMap empty', 'behavior-map', v)
}
{
  const v = clone(animPlay)
  v.nodeMap = [TGT, OWN]
  addBad('nodeMap[0] is not the own id', 'behavior-map', v)
}
{
  const v = clone(animPlay); v.nodeMap = [OWN, OWN]
  addBad('nodeMap repeats an id', 'behavior-map', v)
}
{
  const v = clone(animPlay)
  v.targets = Array.from({ length: 17 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
  addBad('targets 17', 'behavior-map', v)
}
{
  const v = clone(animPlay); v.targets = [TGT, TGT]
  addBad('targets repeats an id', 'behavior-map', v)
}
{
  const v = clone(animPlay); v.targets = ['not-a-uuid']
  addBad('targets entry is not an object id', 'behavior-map', v)
}
{
  const v = clone(animPlay)
  v.animations = Array.from({ length: 9 }, () => ({ object: TGT, clip: 'Idle', loop: true }))
  addBad('animations 9', 'behavior-animations', v)
}
{
  const v = clone(animPlay); v.animations = []
  addBad('an animation op with an empty table', 'behavior-animations', v)
}
{
  const v = clone(animPlay); v.animations[0].clip = 'c'.repeat(301)
  addBad('clip 301 characters', 'behavior-animations', v)
}
{
  const v = clone(animPlay); v.animations[0].loop = 'yes'
  addBad('animations loop is not a boolean', 'behavior-animations', v)
}
{
  const v = clone(prox); v.proximity.radius = 0.49
  addBad('radius 0.49', 'behavior-proximity', v)
}
{
  const v = clone(prox); v.proximity.radius = 50.1
  addBad('radius 50.1', 'behavior-proximity', v)
}
{
  const v = clone(prox); delete v.proximity
  addBad('atrium/enter declared without proximity', 'behavior-proximity', v)
}
{
  const v = clone(animPlay); v.proximity = { radius: 3 }
  addBad('proximity without an atrium/enter event', 'behavior-proximity', v)
}
{
  const v = clone(interval); v.interval.seconds = 0
  addBad('interval seconds 0', 'behavior-interval', v)
}
{
  const v = clone(interval); v.interval.seconds = 3601
  addBad('interval seconds 3601', 'behavior-interval', v)
}
{
  const v = clone(interval); delete v.interval
  addBad('atrium/interval declared without interval', 'behavior-interval', v)
}
{
  const v = clone(animPlay); v.interval = { seconds: 30 }
  addBad('interval without an atrium/interval event', 'behavior-interval', v)
}
{
  const v = clone(animPlay); v.graph.nodes[1].values.speed = { type: 2, value: [0.09] }
  addBad('speed 0.09', 'behavior-literal', v)
}
{
  const v = clone(animPlay); v.graph.nodes[1].values.speed = { type: 2, value: [10.1] }
  addBad('speed 10.1', 'behavior-literal', v)
}
{
  const v = clone(animPlay)
  v.graph.nodes[1].values.animation = { type: 3, value: ['/animations/1'] }
  addBad('an animation index past the table', 'behavior-literal', v)
}
{
  const v = clone(animPlay)
  v.graph.nodes[1].values.animation = { node: 0, socket: 'value' }
  addBad('an animation reference that is not a literal', 'behavior-literal', v)
}
{
  const v = clone(visHide)
  v.graph.nodes[1].configuration.pointer = { value: ['/nodes/{n}/extensions/KHR_node_visibility/visible'] }
  addBad('a {n} pointer (a ref socket)', 'behavior-pointer', v)
}
{
  const v = clone(visHide)
  v.graph.nodes[1].values.n = { node: 0, socket: 'value' }
  addBad('a socket-connected pointer index', 'behavior-pointer', v)
}
{
  const v = clone(visHide)
  v.graph.nodes[1].values.n = { type: 1, value: [2] }
  addBad('a pointer index at nodeMap.length', 'behavior-pointer', v)
}
{
  const v = clone(visHide)
  v.graph.nodes[1].configuration.pointer = { value: ['/nodes/[n]/matrix'] }
  addBad('a pointer outside the allowlist', 'behavior-pointer', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'flow/while' }
  v.graph.nodes[0].declaration = 0
  addBad('flow/while', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'event/onStart' }
  v.graph.nodes[0].declaration = 0
  addBad('event/onStart', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'event/onTick' }
  v.graph.nodes[0].declaration = 0
  addBad('event/onTick', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'flow/setDelay' }
  v.graph.nodes[0].declaration = 0
  addBad('flow/setDelay', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'pointer/interpolate' }
  v.graph.nodes[0].declaration = 0
  addBad('pointer/interpolate', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations[0] = { op: 'event/onSelect' }
  addBad('a bare event/onSelect, without its extension', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.nodes[0].configuration.nodeIndex = { type: 1, value: [1] }
  addBad('event/onSelect configured on another node index', 'behavior-op', v)
}
{
  const v = clone(animPlay)
  v.graph.declarations = [{ op: 'debug/log' }, { op: 'debug/log' }]
  addBad('two declarations of one (op, extension)', 'behavior-op', v)
}
{
  const v = clone(prox); v.graph.events[0] = { id: 'atrium/hover' }
  addBad('an event id outside the three', 'behavior-event', v)
}
{
  const v = clone(prox); v.graph.events[0] = { id: 'atrium/enter', values: { a: 1 } }
  addBad('an event entry that carries values', 'behavior-event', v)
}
{
  // A graph that passes every F1 rule and is refused by the validator: F1 does
  // not police `node.declaration` indices, the validator does. This is the
  // vector that pins "the validator is the gate, not the loader".
  const v = clone(animPlay)
  v.graph.nodes[1].declaration = 99
  addBad('a node whose declaration index is out of range', 'behavior-graph', v)
}
{
  // The back-edge case, with allowed ops only: a flow from a later node to an
  // earlier one. It passes every F1 rule and is refused by the validator with
  // "output flow must point to a later node". This replaces r1's
  // sequence -> sequence case (flow/sequence is not in F-L4).
  const v = clone(visHide)
  v.graph.declarations = [{ op: 'debug/log' }]
  const logNode = (flows) => ({
    declaration: 0,
    configuration: { message: { value: ['hi'] }, severity: { value: [0] } },
    ...(flows ? { flows } : {}),
  })
  v.graph.nodes = [logNode({ out: to(1) }), logNode({ out: to(2) }), logNode({ out: to(1) })]
  addBad('a back edge (a flow to an earlier node)', 'behavior-graph', v)
}
{
  const v = clone(animPlay); v.graph = 'not an object'
  addBad('the graph is not an object', 'behavior-graph', v)
}
{
  const v = clone(animPlay); v.template = { id: 'no-such-template', params: { target: TGT } }
  addBad('an unknown template id', 'behavior-template', v)
}
{
  const v = clone(animPlay); v.template.params = { target: TGT, bogus: 1 }
  addBad('template params with an extra key', 'behavior-template', v)
}
{
  const v = clone(animPlay); v.template.params = { target: 'not-a-uuid', action: 'play', clip: 'Idle', loop: true }
  addBad('a template target that is not an object id', 'behavior-template', v)
}
{
  const v = clone(animPlay); v.template.params = { target: TGT, action: 'dance', clip: 'Idle', loop: true }
  addBad('a template action outside its enum', 'behavior-template', v)
}
{
  const v = clone(interval); v.template.params = { target: TGT, clip: 'Idle', loop: true, seconds: 1.5 }
  addBad('template params seconds that are not an integer', 'behavior-template', v)
}
{
  const v = clone(animPlay); v.interval = undefined
  void v
}
// The depth vector: three levels of nesting inside a literal's value array.
{
  const v = clone(animPlay)
  v.graph.nodes[1].values.n = { type: 1, value: [{ x: { y: 1 } }] }
  addBad('a value nested past depth 8', 'behavior-type', v)
}

// --- the __proto__ vector ----------------------------------------------------
// A computed key in an object literal creates an OWN property named __proto__
// (a plain `__proto__:` literal would set the prototype), and JSON.stringify
// emits own enumerable keys, so this vector round-trips through the fixture.
{
  const v = clone(animPlay)
  v.template.params = { ['__proto__']: { x: 1 }, target: TGT, action: 'play', clip: 'Idle', loop: true }
  addBad('a __proto__ key inside template.params', 'behavior-type', v)
}

const fixture = {
  description:
    'F1 vectors for extras.atrium.behavior (scripting-4b-2). Read by the client copy ' +
    '(packages/behaviors/src/behavior-spec.js) and by the server copy ' +
    '(packages/server/src/send-policy.js), so the two cannot drift. `ownId` is the ' +
    'behaviour node\'s own object id; every accepted value must pass the rule AND ' +
    'validateInteractivityGraph, and every refused value must return the named code.',
  ownId: OWN,
  targetId: TGT,
  accepted,
  refused,
}

// Self-check before writing: every accepted value must pass F1 and the validator,
// every refused one must return exactly its named code.
let bad = 0
for (const { name, value } of accepted) {
  const problem = behaviorCheck(value, { ownId: OWN }).problem
  if (problem) { console.log(`ACCEPTED but refused (${problem}): ${name}`); bad++ }
  try { validateInteractivityGraph(value.graph) } catch (e) {
    console.log(`ACCEPTED but the validator refused it: ${name} — ${e.message}`); bad++
  }
}
for (const { name, code, value } of refused) {
  const problem = behaviorCheck(value, { ownId: OWN }).problem
  if (problem !== code) { console.log(`REFUSED ${name}: expected ${code}, got ${problem}`); bad++ }
}
if (bad > 0) { console.log(`${bad} PROBLEMS — fixture NOT written`); process.exit(1) }

// The __proto__ vector must survive the round trip: the written text carries the
// key, and JSON.parse reads it back as an own property.
const text = JSON.stringify(fixture, null, 2) + '\n'
if (!text.includes('"__proto__"')) { console.log('the __proto__ vector did not serialize'); process.exit(1) }
writeFileSync(new URL('../../../tests/fixtures/behavior-vectors.json', import.meta.url), text)
console.log(`wrote tests/fixtures/behavior-vectors.json: ${accepted.length} accepted, ${refused.length} refused`)
