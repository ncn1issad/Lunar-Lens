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
  const [playing, setPlaying] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
  const playbackRef = useRef({ selected, onSelect })
  const value = draft ?? selected
  const colors = useMemo(() => visibilityGradient(positions), [positions])

  useEffect(() => { playbackRef.current = { selected, onSelect } }, [selected, onSelect])

  useEffect(() => {
    if (!playing || start === end) return
    const from = playbackRef.current.selected
    const started = performance.now()
    // Use elapsed time so expensive terrain renders cannot slow down playback.
    const timer = setInterval(() => {
      const elapsed = performance.now() - started
      const time = Math.min(end, start + Math.floor((from - start + elapsed * (end - start) / 60000) / 1000) * 1000)
      if (time !== playbackRef.current.selected) playbackRef.current.onSelect(time)
      if (time === end) setPlaying(false)
    }, 100)
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', pauseWhenHidden)
    }
  }, [playing, start, end])

  useEffect(() => {
    hideTimer.current = setTimeout(() => setIntroVisible(false), 3000)
    return () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current) }
  }, [])

  return (
    <div className="surface-timeline-overlay" data-intro-visible={introVisible} data-scrubbing={draft !== null} data-playing={playing}
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
        <div className="surface-timeline-controls">
          <button type="button" className="surface-timeline-play" disabled={start === end}
            aria-label={playing ? 'Pause timeline' : 'Play timeline'}
            title={start === end ? 'Submit a new time range to play the timeline.' : playing ? 'Pause timeline' : 'Play timeline. A full pass takes 60 seconds.'}
            onClick={() => {
              if (!playing && selected >= end) onSelect(start)
              setPlaying(value => !value)
            }}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {playing ? <path d="M6 5h4v14H6zm8 0h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <div className="surface-timeline-track" style={{ '--surface-colors': colors } as CSSProperties}>
            <input id="surface-time" type="range" min={0} max={(end - start) / 1000} step={1}
              value={(value - start) / 1000} disabled={start === end} aria-valuetext={surfaceTimeLabel(value)}
              title={start === end ? 'Submit a new time range to explore the timeline.' : 'Click to select a time. Drag and release to update the view.'}
              onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return
                setPlaying(false)
                dragging.current = true
                setDraft(selected)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onChange={event => {
                const time = start + Number(event.currentTarget.value) * 1000
                setPlaying(false)
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
    </div>
  )
}
