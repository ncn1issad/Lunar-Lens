import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { TimelineResponse } from '@lunar-lense/contracts'
import { resolveLocation } from './planning-location'
import type { LocationDraft } from './planning-location'
import { resolveTimeRange } from './planning-time'
import type { PlanningTimeRange } from './planning-time'

export default function PlanningSubmit({ timeRange, siteDraft, visible, onSuccess }: {
  timeRange: PlanningTimeRange | null
  siteDraft: LocationDraft
  visible: boolean
  onSuccess: (timeline: TimelineResponse) => void
}) {
  const time = timeRange ? resolveTimeRange(timeRange) : null
  const site = resolveLocation(siteDraft)
  const params = time?.value && site.location ? new URLSearchParams({
    start: time.value.start,
    end: time.value.end,
    latitude: String(site.location.latitude),
    longitude: String(site.location.longitude),
    stepMinutes: '60',
  }).toString() : null

  return <TimelineSubmit key={params} params={params} visible={visible} onSuccess={onSuccess} />
}

function TimelineSubmit({ params, visible, onSuccess }: {
  params: string | null
  visible: boolean
  onSuccess: (timeline: TimelineResponse) => void
}) {
  const requestRef = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => { requestRef.current?.abort() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!params || requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/timeline?${params}`, { signal: controller.signal })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message || `The timeline could not load (${response.status}). Try again.`)
      }
      const timeline = await response.json() as TimelineResponse
      if (!controller.signal.aborted) onSuccess(timeline)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'The timeline could not load. Try again.')
      }
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) {
        requestRef.current = null
        setPending(false)
      }
    }
  }

  return (
    <form className="planning-submit" hidden={!visible} onSubmit={submit} aria-label="Submit planning selections" aria-busy={pending}>
      {error && <p id="planning-submit-feedback" className="planning-submit-feedback" role="alert">{error}</p>}
      <button type="submit" className="planning-submit-button" disabled={!params || pending} aria-describedby={error ? 'planning-submit-feedback' : undefined}>
        {pending ? 'Submitting...' : 'Submit'}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  )
}
