// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-animation-panel.test.js — scripting-4a step 5 (Z7's pure half).
//
// No DOM and no three.js — `apps/client` tests cannot have them. The panel's
// logic is pure, so every status text, every enabled/disabled control, the exact
// value Play and Stop write, and the L7 rule (a late answer for a model that is
// no longer selected touches nothing) are all tested with plain values.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  panelState, animationStatusText, playValue, stopValue, createAnimationControls,
  MODEL_ANIMATION_FIELD,
} from '../src/model-animation-panel.js'

const CLIPS = ['Survey', 'Walk', 'Run']
const status = (state, clips = CLIPS) => ({ state, clips })
const PLAYING = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 1_700_000_000_000 }

// ===========================================================================
// The texts
// ===========================================================================

describe('panelState — the status texts (Z7)', () => {
  test('every state has its line', () => {
    assert.equal(animationStatusText('stopped'), 'Stopped')
    assert.equal(animationStatusText('playing'), 'Playing')
    assert.equal(animationStatusText('ended'), 'Played')
    assert.equal(animationStatusText('loading'), 'Animations: loading')
    assert.equal(animationStatusText('no-clips'), 'No animations')
    assert.equal(animationStatusText('clip-missing', 'Nope'), "Clip 'Nope' not found in this model")
  })

  test('a model with no clips says so, and offers nothing', () => {
    const panel = panelState({ status: status('no-clips', []), value: null })
    assert.equal(panel.text, 'No animations')
    assert.equal(panel.playEnabled, false)
    assert.equal(panel.stopEnabled, false)
    assert.equal(panel.clipEnabled, false)
  })

  test('a loading model says so, and offers nothing', () => {
    const panel = panelState({ status: status('loading', []), value: PLAYING })
    assert.equal(panel.text, 'Animations: loading')
    assert.equal(panel.playEnabled, false)
    assert.equal(panel.stopEnabled, false)
  })

  test('a saved clip the model does not have names it, and offers a way out (V6)', () => {
    const panel = panelState({
      status: status('clip-missing'), value: { ...PLAYING, clip: 'Gallop' },
    })
    assert.equal(panel.text, "Clip 'Gallop' not found in this model")
    assert.equal(panel.playEnabled, true, 'V6: a playable clip is shown, so Play is offered')
    assert.equal(panel.clip, 'Survey', 'and the select shows the first playable clip')
    assert.equal(panel.stopEnabled, true, 'Stop is offered too — it writes null')
    assert.equal(panel.clipEnabled, true, 'and the owner can pick another clip')
  })

  test('V6: clip-missing with NOTHING playable still offers Stop, and no Play', () => {
    const panel = panelState({ status: status('clip-missing', []), value: PLAYING })
    assert.equal(panel.clip, null, 'there is no clip to show')
    assert.equal(panel.playEnabled, false, 'nothing can be played')
    assert.equal(panel.stopEnabled, true, 'but the missing clip can still be cleared')
  })

  test('an ended clip says Played', () => {
    const panel = panelState({ status: status('ended'), value: PLAYING })
    assert.equal(panel.text, 'Played')
  })
})

describe('panelState — which control is offered (L7)', () => {
  const cases = [
    ['stopped', { playEnabled: true,  stopEnabled: false }],
    ['playing', { playEnabled: false, stopEnabled: true }],
    ['ended',   { playEnabled: true,  stopEnabled: true }],
    // V6/R2 (a) — the one state L7 is amended for.
    ['clip-missing', { playEnabled: true, stopEnabled: true }],
    ['loading', { playEnabled: false, stopEnabled: false }],
    // F-L12 item 3 (scripting-4a, taken by 4b-2) — a model with NO clips but a
    // saved PLAYING value still offers Stop: it is the only way out.
    ['no-clips', { playEnabled: false, stopEnabled: true }],
  ]
  for (const [state, expected] of cases) {
    test(`${state}: play=${expected.playEnabled} stop=${expected.stopEnabled}`, () => {
      const clips = state === 'loading' || state === 'no-clips' ? [] : CLIPS
      const panel = panelState({ status: status(state, clips), value: PLAYING })
      assert.equal(panel.playEnabled, expected.playEnabled, 'Play')
      assert.equal(panel.stopEnabled, expected.stopEnabled, 'Stop')
      assert.equal(panel.loopEnabled, clips.length > 0, 'Loop')
    })
  }

  test('a write in flight disables every control for that node', () => {
    const panel = panelState({ status: status('stopped'), value: null, waiting: true })
    assert.equal(panel.playEnabled, false)
    assert.equal(panel.stopEnabled, false)
    assert.equal(panel.clipEnabled, false)
    assert.equal(panel.loopEnabled, false)
  })
})

describe('the values Play and Stop write (L7)', () => {
  test('Play writes the whole value with startedAt 0 — the server stamps it', () => {
    assert.deepEqual(playValue({ clip: 'Walk', loop: true }),
      { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 })
    assert.deepEqual(playValue({ clip: 'Run' }),
      { clip: 'Run', playing: true, loop: false, speed: 1, startedAt: 0 })
    assert.equal(playValue({ clip: 'Run' }).startedAt, 0)
  })

  test('Stop writes null', () => {
    assert.equal(stopValue(), null)
  })

  test('the leaf the controls write is extras.atrium.animation', () => {
    assert.equal(MODEL_ANIMATION_FIELD, 'extras.atrium.animation')
  })
})

// ===========================================================================
// The controls: one write at a time, per node (L7)
// ===========================================================================

function makeControls({ statuses = new Map() } = {}) {
  const writes = []
  const errors = []
  const panels = []
  const clears = []
  let line = ''
  let seq = 100
  const nodes = new Map()
  const state = { selected: null }

  const node = (name, animation = null) => {
    const created = { name, extras: { atrium: { model: { url: `https://h/${name}.glb` }, ...(animation !== null ? { animation } : {}) } } }
    nodes.set(name, created)
    // The first node made is the selection, so a test can drive the controls
    // without a separate select() call.
    if (state.selected === null) state.selected = created
    return created
  }

  const controls = createAnimationControls({
    deps: {
      selected: () => state.selected,
      status: (name) => statuses.get(name) ?? status('loading', []),
      write: (name, value) => { writes.push({ name, value }); return ++seq },
      render: (panel) => panels.push(panel),
      showError: (text) => { line = text || ''; errors.push(text) },
      // V8 — the edit error line itself, so a test can see it cleared.
      clearError: () => { line = ''; clears.push(true) },
    },
  })

  return {
    controls, writes, errors, panels, nodes, node, clears,
    get errorLine() { return line },
    select(name) { state.selected = nodes.get(name) ?? null; controls.refresh() },
    set(name, value) { nodes.get(name).extras.atrium.animation = value },
    get lastPanel() { return panels.at(-1) },
  }
}

test('Z7: Play sends the value for the selected node and disables it until the answer', () => {
  const h = makeControls({ statuses: new Map([['Fox', status('playing')]]) })
  h.node('Fox', null)
  h.set('Fox', PLAYING)
  h.controls.refresh()

  const seq = h.controls.play()
  assert.equal(typeof seq, 'number')
  assert.deepEqual(h.writes.at(-1), { name: 'Fox', value: playValue({ clip: 'Walk', loop: true }) })
  assert.equal(h.lastPanel.waiting, true, 'the row shows the wait')
  assert.equal(h.lastPanel.playEnabled, false, 'and the controls are disabled')
  assert.equal(h.lastPanel.stopEnabled, false)

  h.controls.onAccepted(seq)
  assert.equal(h.lastPanel.waiting, false, 'the answer re-enables them')
})

test('Z7: a second write for the same node is refused while one is in flight', () => {
  const h = makeControls({ statuses: new Map([['Fox', status('playing')]]) })
  h.node('Fox', PLAYING)
  h.controls.refresh()
  assert.equal(typeof h.controls.play(), 'number')
  const before = h.writes.length
  assert.equal(h.controls.stop(), null, 'no second write while the first is unanswered')
  assert.equal(h.writes.length, before)
})

test('Z7: a rejection shows the reason in the edit error line', () => {
  const h = makeControls({ statuses: new Map([['Fox', status('stopped')]]) })
  h.node('Fox', PLAYING)
  h.controls.refresh()
  const seq = h.controls.play()

  h.controls.onRejected(seq, 'extras.atrium.animation is only allowed on a model node')
  assert.deepEqual(h.errors, ['extras.atrium.animation is only allowed on a model node'])
  assert.equal(h.controls.waiting, 0, 'and the wait is over')
  assert.equal(h.lastPanel.playEnabled, true, 'the controls come back')
})

test('Z7: a late answer for a model that is no longer selected touches nothing on the new one', () => {
  const statuses = new Map([['Fox', status('playing')], ['Chair', status('stopped')]])
  const h = makeControls({ statuses })
  h.node('Fox', PLAYING)
  h.node('Chair', null)
  h.select('Fox')
  const seq = h.controls.play()
  assert.equal(h.lastPanel.waiting, true, 'Fox waits')

  // The owner selects another model while the answer is out.
  h.select('Chair')
  assert.equal(h.lastPanel.waiting, false, 'Chair was never waiting on Fox’s write')
  assert.equal(h.lastPanel.playEnabled, true, 'and its controls are live')

  const panels = h.panels.length
  h.controls.onRejected(seq, 'refused')
  assert.deepEqual(h.errors, [], 'no error is shown against the new selection')
  assert.equal(h.lastPanel.playEnabled, true, 'and nothing was re-enabled or disabled on it')
  assert.ok(h.panels.length > panels, 'it did re-render, for the new selection')
  assert.equal(h.lastPanel.state, 'stopped', 'still Chair’s own state')

  // The answer still applied to its OWN node, through the SOM.
  h.select('Fox')
  assert.equal(h.lastPanel.waiting, false, 'Fox’s wait is over')
})

test('Z7: an unknown answer ends the wait with nothing else changed', () => {
  const h = makeControls()
  h.node('Fox', PLAYING)
  h.controls.refresh()
  const seq = h.controls.stop()
  assert.equal(h.controls.onUnknown(seq), true)
  assert.equal(h.controls.waiting, 0)
  assert.deepEqual(h.errors, [])
})

test('Z7: a seq the controls do not own is ignored', () => {
  const h = makeControls()
  h.node('Fox', PLAYING)
  h.controls.refresh()
  assert.equal(h.controls.onAccepted(4242), false)
  assert.equal(h.controls.onRejected(4242, 'x'), false)
  assert.equal(h.controls.onUnknown(4242), false)
  assert.deepEqual(h.errors, [])
})

test('Z7: a clip change while playing writes a new playing value; while stopped it only remembers', () => {
  const statuses = new Map([['Fox', status('playing')]])
  const h = makeControls({ statuses })
  h.node('Fox', PLAYING)
  h.controls.refresh()

  const seq = h.controls.change('Run')
  assert.equal(typeof seq, 'number', 'playing: the change is a write')
  assert.deepEqual(h.writes.at(-1).value, playValue({ clip: 'Run', loop: true }), 'and the server re-stamps it')

  h.controls.onAccepted(seq)
  statuses.set('Fox', status('stopped'))
  h.set('Fox', { ...PLAYING, playing: false, clip: 'Run', loop: true })
  h.controls.refresh()
  const before = h.writes.length
  assert.equal(h.controls.change('Survey'), null, 'stopped: nothing is sent')
  assert.equal(h.writes.length, before)
  assert.equal(h.lastPanel.clip, 'Survey', 'but the choice is remembered for Play')

  const playSeq = h.controls.play()
  assert.deepEqual(h.writes.at(-1).value, playValue({ clip: 'Survey', loop: true }))
  h.controls.onAccepted(playSeq)
})

test('Z7: a Loop change while playing writes; while stopped it only remembers', () => {
  const statuses = new Map([['Fox', status('playing')]])
  const h = makeControls({ statuses })
  h.node('Fox', PLAYING)
  h.controls.refresh()

  const seq = h.controls.setLoop(false)
  assert.equal(typeof seq, 'number')
  assert.deepEqual(h.writes.at(-1).value, playValue({ clip: 'Walk', loop: false }))
  h.controls.onAccepted(seq)

  statuses.set('Fox', status('stopped'))
  h.set('Fox', { ...PLAYING, playing: false, loop: false })
  h.controls.refresh()
  const before = h.writes.length
  assert.equal(h.controls.setLoop(true), null)
  assert.equal(h.writes.length, before)
  assert.equal(h.lastPanel.loop, true, 'remembered in the panel')
})

test('Z7: reset forgets every wait and the remembered choice', () => {
  const h = makeControls({ statuses: new Map([['Fox', status('playing')]]) })
  h.node('Fox', PLAYING)
  h.controls.refresh()
  h.controls.play()
  assert.equal(h.controls.waiting, 1)

  h.controls.reset()
  assert.equal(h.controls.waiting, 0, 'the wait goes with the world')
  assert.equal(h.lastPanel.waiting, false, 'and the row re-renders with no wait on it')
  assert.equal(h.lastPanel.playEnabled, false, 'while the value still says playing')
})

test('Z7: a node that is not a model node renders no row', () => {
  const h = makeControls()
  h.node('Fox', PLAYING)
  h.nodes.set('Plain', { name: 'Plain', extras: {} })
  h.select('Plain')
  assert.equal(h.lastPanel, null)
  h.select('Fox')
  assert.ok(h.lastPanel, 'the selected model node renders')
})

// ===========================================================================
// V2 — Play sends the clip the select shows
// ===========================================================================

test('V2: a model selected while loading plays the clip that arrives with the load', () => {
  const statuses = new Map([['CesiumMan', status('loading', [])]])
  const h = makeControls({ statuses })
  h.node('CesiumMan', null)
  h.controls.refresh()
  assert.equal(h.lastPanel.text, 'Animations: loading')
  assert.equal(h.lastPanel.clip, null, 'nothing to show yet')
  assert.equal(h.lastPanel.playEnabled, false)

  // The instance arrives: V1's onChange reaches the row as a refresh, and the
  // clips are there now. The owner still has not picked anything.
  statuses.set('CesiumMan', status('stopped', ['animation_0']))
  h.controls.refresh()

  assert.equal(h.lastPanel.clip, 'animation_0', 'the select shows the clip that arrived')
  assert.equal(h.lastPanel.playEnabled, true)
  assert.equal(typeof h.controls.play(), 'number', 'and Play is not a silent no-op')
  assert.deepEqual(h.writes.at(-1),
    { name: 'CesiumMan', value: playValue({ clip: 'animation_0' }) },
    'it writes the clip the row shows')
})

test('V2 + F-L12 item 1: a pick lasts only until its own write is answered', () => {
  const statuses = new Map([['Fox', status('stopped')]])   // Survey, Walk, Run
  const h = makeControls({ statuses })
  h.node('Fox', null)
  h.controls.refresh()
  assert.equal(h.controls.change('Run'), null, 'stopped: the pick only remembers')
  assert.equal(h.lastPanel.clip, 'Run')

  h.controls.refresh()
  assert.equal(h.lastPanel.clip, 'Run', 'the pick is kept while it is still offered')

  const seq = h.controls.play()
  assert.deepEqual(h.writes.at(-1).value, playValue({ clip: 'Run' }), 'and Play uses it')
  h.controls.onAccepted(seq)
  h.controls.refresh()
  // scripting-4a item 1 (F-L12, taken by 4b-2) — after ITS OWN write is
  // answered the SAVED value is the truth, so the pick is over and the select
  // falls back to what the value offers (here: the node is still stopped, so
  // the first offered clip). That is what makes the select follow another
  // session's playing value.
  assert.equal(h.lastPanel.clip, 'Survey', 'the pick is over once its write is answered')
})

test('V2: an explicit pick that disappears from the list is replaced by the shown clip', () => {
  const statuses = new Map([['Fox', status('stopped')]])
  const h = makeControls({ statuses })
  h.node('Fox', null)
  h.controls.refresh()
  h.controls.change('Run')
  assert.equal(h.lastPanel.clip, 'Run')

  // A different file under the same node: `Run` is not in its list any more.
  statuses.set('Fox', status('stopped', ['Survey', 'Walk']))
  h.controls.refresh()
  assert.equal(h.lastPanel.clip, 'Survey', 'the shown clip replaces the pick')

  const seq = h.controls.play()
  assert.deepEqual(h.writes.at(-1).value, playValue({ clip: 'Survey' }))
  h.controls.onAccepted(seq)
})

test('V2: whenever the row offers Play, play() writes exactly the clip the row shows', () => {
  const cases = [
    ['stopped, no saved value', status('stopped'), null],
    ['stopped, a saved value', status('stopped'), { ...PLAYING, playing: false, clip: 'Walk' }],
    ['ended', status('ended'), PLAYING],
    ['a one-clip model stopped', status('stopped', ['only']), null],
    ['clip-missing, one playable clip', status('clip-missing', ['only']), { ...PLAYING, clip: 'gone' }],
    ['clip-missing, three playable clips', status('clip-missing'), { ...PLAYING, clip: 'gone' }],
  ]
  for (const [label, theStatus, value] of cases) {
    const h = makeControls({ statuses: new Map([['Fox', theStatus]]) })
    h.node('Fox', value)
    h.controls.refresh()
    assert.equal(h.lastPanel.playEnabled, true, `${label}: Play is offered`)
    const seq = h.controls.play()
    assert.equal(typeof seq, 'number', `${label}: play() wrote a value`)
    assert.deepEqual(h.writes.at(-1),
      { name: 'Fox', value: playValue({ clip: h.lastPanel.clip, loop: h.lastPanel.loop }) },
      `${label}: the clip the row shows, and its Loop`)
  }
})

// ===========================================================================
// V6 — clip-missing is not a dead end
// ===========================================================================

test('V6: in clip-missing, Stop clears the saved clip and Play replaces it', () => {
  const statuses = new Map([['CesiumMan', status('clip-missing', ['animation_0'])]])
  const h = makeControls({ statuses })
  h.node('CesiumMan', { ...PLAYING, clip: 'gone' })
  h.controls.refresh()

  assert.equal(h.lastPanel.text, "Clip 'gone' not found in this model")
  assert.equal(h.lastPanel.stopEnabled, true, 'Stop is offered')
  assert.equal(h.lastPanel.clip, 'animation_0', 'and the select shows the playable clip')

  const stopSeq = h.controls.stop()
  assert.deepEqual(h.writes.at(-1), { name: 'CesiumMan', value: null }, 'Stop writes null')
  h.controls.onAccepted(stopSeq)

  const playSeq = h.controls.play()
  assert.deepEqual(h.writes.at(-1),
    { name: 'CesiumMan', value: playValue({ clip: 'animation_0', loop: true }) },
    'and Play writes a new playing value for the shown clip')
  h.controls.onAccepted(playSeq)
})

// ===========================================================================
// V8 — a new write clears the old rejection
// ===========================================================================

test('V8: every write clears the previous rejection’s line as it starts', () => {
  const cases = [
    ['Play', (h) => h.controls.play(), 'stopped'],
    ['Stop', (h) => h.controls.stop(), 'playing'],
    ['a clip change', (h) => h.controls.change('Run'), 'playing'],
    ['a Loop change', (h) => h.controls.setLoop(true), 'playing'],
  ]
  for (const [label, start, state] of cases) {
    const h = makeControls({ statuses: new Map([['Fox', status(state)]]) })
    h.node('Fox', { ...PLAYING, playing: state === 'playing' })
    h.controls.refresh()

    const first = start(h)
    assert.equal(typeof first, 'number', `${label}: the first write goes out`)
    h.controls.onRejected(first, 'stubbed: animation refused')
    assert.equal(h.errorLine, 'stubbed: animation refused', `${label}: the reason is on the line`)

    const second = start(h)
    assert.equal(typeof second, 'number', `${label}: the next write goes out`)
    assert.equal(h.errorLine, '', `${label}: and the line was cleared as it started`)
  }
})
