// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the 4b-2 pre-brief (Rev 0, 2026-10-24); not product code.
// t6 — the event sources the templates need (onSelect, event/receive, animation/*), the delayed
// self-loop and a synchronous cycle. NOTE: everything here goes through loadBehaveGraph only; the
// validator (r1) refuses the self-loop and the cycle, so items 4 and 5 are facts about the loader.
import { makeEngine } from './host.mjs'
import { graph, lit, to, T } from './g.mjs'
const W = () => ({ nodes: [0, 1, 2].map((i) => ({ translation: [i, 0, 0], rotation: [0,0,0,1], scale: [1,1,1], visible: true, parent: i === 1 ? 0 : undefined })), animations: [{ name: 'a0' }, { name: 'a1' }] })
const setVis = (i, v) => ({ op: 'pointer/set', configuration: { pointer: { value: [`/nodes/${i}/extensions/KHR_node_visibility/visible`] }, type: { value: [T.bool] } }, values: { value: lit(T.bool, v) } })

// (1) event/onSelect on node 0; engine.select(1) (its child) must walk up to node 0's listener.
{ const { engine, deco } = makeEngine({ world: W() })
  const g = graph([{ op: 'event/onSelect', configuration: { nodeIndex: { value: [0] }, stopPropagation: { value: [true] } }, flows: { out: to(1) } }, setVis(0, false)])
  g.events = []
  engine.loadBehaveGraph(g, false); deco.tick()
  console.log('(1) before select: writes', JSON.stringify(deco.writes))
  engine.select(1, 0, undefined, undefined); deco.tick()
  console.log('    select(child 1) -> writes', JSON.stringify(deco.writes), '| selectable:', [...engine.selectableNodesIndices.keys()])
  engine.select(2, 0, undefined, undefined); deco.tick()
  console.log('    select(node 2, unrelated) -> writes', JSON.stringify(deco.writes)) }

// (2) event/receive of a declared custom event id ('atrium/enter'), dispatched by the host.
{ const { engine, deco } = makeEngine({ world: W() })
  const g = graph([{ op: 'event/receive', configuration: { event: { value: [0] } }, flows: { out: to(1) } }, setVis(0, false)], { events: [{ id: 'atrium/enter' }] })
  engine.loadBehaveGraph(g, false); deco.tick()
  engine.dispatchCustomEvent('KHR_INTERACTIVITY:atrium/enter', {}); deco.tick()
  console.log('(2) receive atrium/enter -> writes', JSON.stringify(deco.writes), '| channels:', engine.getCustomEventsNames?.() ?? '(n/a)')
  engine.dispatchCustomEvent('atrium/enter', {}); deco.tick()
  console.log('    un-prefixed dispatch -> writes', JSON.stringify(deco.writes)) }

// (3) animation/start and animation/stop through the decorator hooks, with world.animations.
{ const { engine, deco } = makeEngine({ world: W() })
  const g = graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'animation/start', values: { animation: { type: 4, value: ['/animations/1'] }, startTime: lit(T.float, 0), endTime: lit(T.float, Infinity), speed: lit(T.float, 1) }, flows: { out: to(2) } },
    { op: 'animation/stop', values: { animation: { type: 4, value: ['/animations/0'] } } },
  ])
  g.types.push({ signature: 'ref' })
  let load = 'ok'; try { engine.loadBehaveGraph(g, false) } catch (e) { load = e.message.slice(0, 120) }
  const r = deco.tick()
  console.log('(3) animation ops: load', load, '| tick', JSON.stringify(r), '| anim calls', JSON.stringify(deco.anim)) }

// (3b) animation/start on an index past world.animations -> err, no hook call
{ const { engine, deco } = makeEngine({ world: W() })
  const g = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'animation/start', values: { animation: { type: 4, value: ['/animations/7'] }, startTime: lit(T.float, 0), endTime: lit(T.float, Infinity), speed: lit(T.float, 1) }, flows: { out: to(2), err: to(3) } }, setVis(0, false), setVis(0, true)])
  g.types.push({ signature: 'ref' })
  let load = 'ok'; try { engine.loadBehaveGraph(g, false) } catch (e) { load = e.message.slice(0, 120) }
  deco.tick(); console.log('(3b) animation index 7 of 2: load', load, '| anim calls', JSON.stringify(deco.anim), '| writes', JSON.stringify(deco.writes), '(true = err branch)') }

// (4) "every N seconds": onStart -> setDelay(0.05) --done--> animation/start --out--> setDelay (a delayed loop).
{ const { engine, deco } = makeEngine({ world: W() })
  const g = graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.05) }, flows: { done: to(2) } },
    { op: 'animation/start', values: { animation: { type: 4, value: ['/animations/0'] }, startTime: lit(T.float, 0), endTime: lit(T.float, Infinity), speed: lit(T.float, 1) }, flows: { out: to(1) } },
  ])
  g.types.push({ signature: 'ref' })
  let load = 'ok'; try { engine.loadBehaveGraph(g, false) } catch (e) { load = e.message.slice(0, 120) }
  const t0 = performance.now(); let ticks = 0
  while (performance.now() - t0 < 300) { deco.tick(); ticks++; await new Promise((r) => setTimeout(r, 10)) }
  console.log('(4) delayed self-loop: load', load, '| starts in 300 ms:', deco.anim.filter((a) => a[0] === 'start').length, '| ticks', ticks, '| pending delays', engine.scheduledDelays.filter(Boolean).length)
  engine.dispose(); await new Promise((r) => setTimeout(r, 120)); const n = deco.anim.length; deco.tick(); console.log('    after dispose, 120 ms later: new starts', deco.anim.length - n) }

// (5) a synchronous flow cycle that does NOT go through a delay, for the cycle check: sequence -> sequence.
{ const { engine, deco } = makeEngine({ world: W(), budget: 10000 })
  const g = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/sequence', flows: { a: to(2) } }, { op: 'flow/sequence', flows: { a: to(1) } }])
  let load = 'ok'; try { engine.loadBehaveGraph(g, false) } catch (e) { load = e.message.slice(0, 120) }
  console.log('(5) sync cycle: load', load, '| tick', JSON.stringify(deco.tick())) }
process.exit(0)
