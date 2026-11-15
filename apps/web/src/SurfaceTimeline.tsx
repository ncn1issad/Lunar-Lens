import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TimelinePositions } from '@lunar-lense/contracts'
import { visibilityGradient } from './surface-timeline'

function surfaceTimeLabel(time: number): string {
  return new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

export default function SurfaceTimeline({ positions, selected, onSelect }: {
  positions: TimelinePositions; selected: number; onSelect: (time: number) => void
}) {
  const start = Date.parse(positions.earth[0]!.timestamp), end = Date.parse(positions.earth.at(-1)!.timestamp)
  const [draft, setDraft] = useState<number | null>(null)
  const [introVisible, setIntroVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
  const value = draft ?? selected
  const colors = useMemo(() => visibilityGradient(positions), [positions])

  useEffect(() => {
    hideTimer.current = setTimeout(() => setIntroVisible(false), 3000)
    return () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current) }
  }, [])

  return (
    <div className="surface-timeline-overlay" data-intro-visible={introVisible} data-scrubbing={draft !== null}
      onPointerDownCapture={event => {
        if (event.pointerType !== 'touch') return
        setIntroVisible(true)
        if (hideTimer.current !== null) clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => setIntroVisible(false), 3000)
      }}>
      <div className="surface-timeline">
        <div className="surface-timeline-heading">
          <label htmlFor="surface-time">Surface time</label>
          <output htmlFor="surface-time">{surfaceTimeLabel(value)}</output>
        </div>
        <div className="surface-timeline-track" style={{ '--surface-colors': colors } as CSSProperties}>
          <input id="surface-time" type="range" min={0} max={(end - start) / 1000} step={1}
            value={(value - start) / 1000} disabled={start === end} aria-valuetext={surfaceTimeLabel(value)}
            title={start === end ? 'Submit a new time range to explore the timeline.' : 'Click to select a time. Drag and release to update the view.'}
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return
              dragging.current = true
              setDraft(selected)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onChange={event => {
              const time = start + Number(event.currentTarget.value) * 1000
              if (dragging.current) setDraft(time)
              else onSelect(time)
            }}
            onPointerUp={event => {
              if (!dragging.current) return
              dragging.current = false
              setDraft(null)
              onSelect(start + Number(event.currentTarget.value) * 1000)
            }}
            onPointerCancel={() => { dragging.current = false; setDraft(null) }}
            onLostPointerCapture={() => { dragging.current = false; setDraft(null) }}
          />
        </div>
      </div>
    </div>
  )
}
