import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PAGE_HOLD, planningScrollLayout, resizePlanningScroll, settlePlanningScroll } from '../src/planning-scroll'

test('page targets leave three typical wheel notches of stillness in both directions', () => {
  for (const height of [400, 720, 1400]) {
    const layout = planningScrollLayout(height, 4)
    for (const [index, transition] of layout.transitions.entries()) {
      assert.equal(transition.start - layout.targets[index], PAGE_HOLD)
      assert.equal(layout.targets[index + 1] - transition.end, PAGE_HOLD)
    }
    assert.equal(layout.distance - layout.targets[3], PAGE_HOLD)
  }
})

test('adding Surface does not change earlier page targets', () => {
  assert.deepEqual(planningScrollLayout(720, 3).targets.slice(0, 2), planningScrollLayout(720, 2).targets)
})

test('resize preserves a partial transition and the remaining distance inside a hold', () => {
  const before = planningScrollLayout(720, 4)
  const after = planningScrollLayout(1000, 4)
  for (const [index, transition] of before.transitions.entries()) {
    const fraction = 0.3
    const top = transition.start + (transition.end - transition.start) * fraction
    const next = after.transitions[index]
    assert.equal(resizePlanningScroll(top, before, after), next.start + (next.end - next.start) * fraction)
  }
  assert.equal(resizePlanningScroll(before.targets[1] + 120, before, after), after.targets[1] + 120)
})

test('gentle settling only finishes a nearby transition, never moves within a hold', () => {
  const layout = planningScrollLayout(720, 4)
  for (const { start, end } of layout.transitions) {
    assert.equal(settlePlanningScroll(start + 20, layout), start)
    assert.equal(settlePlanningScroll(end - 20, layout), end)
    assert.equal(settlePlanningScroll((start + end) / 2, layout), (start + end) / 2)
    for (const top of [start - 120, start, end, end + 120]) assert.equal(settlePlanningScroll(top, layout), top)
  }
})
