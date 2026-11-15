// A page has 360px of quiet scrolling on either side of its navigation target.
// The browser still scrolls throughout these holds; only the scene stands still.
export const PAGE_HOLD = 360
export const SECTION_LINK_SECONDS = 2.4

export function planningScrollLayout(height: number, count: number) {
  const transition = Math.max(720, height * 1.4)
  const stride = PAGE_HOLD * 2 + transition
  const targets = Array.from({ length: count }, (_, index) => index * stride)
  const transitions = targets.slice(1).map((target, index) => ({
    start: targets[index] + PAGE_HOLD,
    end: target - PAGE_HOLD,
  }))
  const distance = (targets.at(-1) ?? 0) + PAGE_HOLD
  return { targets, transitions, distance }
}

export type PlanningScrollLayout = ReturnType<typeof planningScrollLayout>

export function resizePlanningScroll(top: number, before: PlanningScrollLayout, after: PlanningScrollLayout) {
  const index = before.transitions.findIndex(({ start, end }) => top > start && top < end)
  if (index >= 0) {
    const previous = before.transitions[index]
    const next = after.transitions[index]
    return next.start + (top - previous.start) / (previous.end - previous.start) * (next.end - next.start)
  }
  const page = before.targets.reduce((nearest, target, index) =>
    Math.abs(target - top) < Math.abs(before.targets[nearest] - top) ? index : nearest, 0)
  return Math.max(0, Math.min(after.distance, after.targets[page] + top - before.targets[page]))
}

// Only settle the last few pixels of a transition. Never pull someone out of
// a hold or send them to another page because of trackpad momentum.
export function settlePlanningScroll(top: number, layout: PlanningScrollLayout) {
  for (const { start, end } of layout.transitions) {
    if (top <= start || top >= end) continue
    const threshold = Math.min(72, (end - start) * 0.15)
    if (top - start < threshold) return start
    if (end - top < threshold) return end
  }
  return top
}
