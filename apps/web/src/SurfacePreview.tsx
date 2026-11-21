import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  Scene, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import type { GeographicImageryLayer } from '@lunar-lense/contracts'
import {
  concurrent, imageryPatch, skyDirection,
} from './surface-geometry'
import type { SurfaceSnapshot } from './surface-geometry'
import { locationLabel, normalizeLongitude } from './planning-location'
import { plannedTerrain } from './surface-terrain'
import type { SurfacePlan } from './surface-plan'
import { surfaceSnapshotAt } from './surface-plan'
import SurfaceTimeline from './SurfaceTimeline'
import { surfaceIndicatorPosition } from './surface-indicators'
import './surface-preview.css'

// A faint 5% gray keeps unlit terrain and Earth's night side visible.
const nightFillColor = 0x0d0d0d

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Surface data could not load (${response.status}).`)
  return response.json() as Promise<T>
}

function SurfaceScene({ snapshot, selected }: { snapshot: SurfaceSnapshot; selected: SurfaceSnapshot }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const indicatorsRef = useRef<SVGSVGElement>(null)
  const selectedRef = useRef(selected)
  const updateTimeRef = useRef<(value: SurfaceSnapshot) => void>(() => {})
  const [status, setStatus] = useState<string | null>('Loading lunar terrain...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    selectedRef.current = selected
    updateTimeRef.current(selected)
  }, [selected])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const abort = new AbortController()
    let disposed = false
    const resources: { dispose(): void }[] = []
    const cleanup: (() => void)[] = []
    const keep = <T extends { dispose(): void }>(resource: T): T => { resources.push(resource); return resource }

    const start = async () => {
      const layer = await json<GeographicImageryLayer>('/api/imagery/layers/wac-global', abort.signal)
      const patch = imageryPatch(layer, snapshot)
      const grid = await plannedTerrain(patch, snapshot, import.meta.env.BASE_URL, abort.signal)
      if (Math.abs(grid.groundM - snapshot.groundElevationM) > 0.01) {
        throw new Error('The surface terrain does not match the observer height.')
      }
      if (disposed) return

      const renderer = new WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true })
      keep({ dispose() { renderer.dispose(); renderer.forceContextLoss() } })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
      renderer.setClearColor(0x000000, 0)
      renderer.autoClear = false
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFSoftShadowMap
      const canvas = renderer.domElement
      canvas.tabIndex = 0
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `View from the Moon at ${locationLabel({ latitude: snapshot.latitudeDeg, longitude: normalizeLongitude(snapshot.longitudeDeg) })}, ${snapshot.timestamp}. Drag or use arrow keys to look around.`)
      host.appendChild(canvas)
      cleanup.push(() => canvas.remove())

      const scene = new Scene()
      const sky = new Scene()
      const camera = new PerspectiveCamera(58, 1, 0.2, 180000)
      camera.position.set(0, snapshot.eyeHeightM, 0)
      const skyCamera = new PerspectiveCamera(58, 1, 0.1, 5000)
      const geometry = keep(new BufferGeometry())
      geometry.setAttribute('position', new BufferAttribute(grid.positions, 3))
      geometry.setAttribute('uv', new BufferAttribute(grid.uvs, 2))
      geometry.setIndex(new BufferAttribute(grid.indices, 1))
      geometry.computeVertexNormals()

      const atlas = document.createElement('canvas')
      atlas.width = (patch.maxX - patch.minX + 1) * layer.tileSize
      atlas.height = (patch.maxY - patch.minY + 1) * layer.tileSize
      const context = atlas.getContext('2d')
      if (!context) throw new Error('The surface imagery canvas is unavailable.')
      context.fillStyle = '#888888'
      context.fillRect(0, 0, atlas.width, atlas.height)
      const texture = keep(new CanvasTexture(atlas))
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy())
      const material = keep(new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, emissive: nightFillColor }))
      const ground = new Mesh(geometry, material)
      ground.castShadow = true
      ground.receiveShadow = true
      scene.add(ground)
      scene.add(new AmbientLight(0xffffff, 0.22))
      const sunDirection = new Vector3(...skyDirection(snapshot.positions.sun.azimuthDeg, snapshot.positions.sun.elevationDeg))
      const light = new DirectionalLight(0xffffff, 3)
      light.position.copy(sunDirection).multiplyScalar(60000)
      light.castShadow = true
      light.shadow.mapSize.set(2048, 2048)
      light.shadow.camera.left = light.shadow.camera.bottom = -24000
      light.shadow.camera.right = light.shadow.camera.top = 24000
      light.shadow.camera.near = 100
      light.shadow.camera.far = 120000
      light.shadow.camera.updateProjectionMatrix()
      light.shadow.normalBias = 3
      light.shadow.autoUpdate = false
      light.shadow.needsUpdate = true
      scene.add(light)
      cleanup.push(() => light.shadow.map?.dispose())

      const earthDirection = new Vector3(...skyDirection(snapshot.positions.earth.azimuthDeg, snapshot.positions.earth.elevationDeg))
      const earth = new Mesh(
        keep(new SphereGeometry(1000 * 6378.137 / snapshot.positions.earth.distanceKm, 64, 32)),
        keep(new MeshStandardMaterial({ roughness: 1, emissive: nightFillColor })),
      )
      earth.position.copy(earthDirection).multiplyScalar(1000)
      earth.rotation.z = 23.44 * Math.PI / 180
      sky.add(earth)
      sky.add(new AmbientLight(0xffffff, 0.025))
      const earthLight = new DirectionalLight(0xffffff, 3)
      earthLight.position.copy(earth.position).addScaledVector(sunDirection, 10000)
      earthLight.target = earth
      sky.add(earthLight)
      const sun = new Mesh(
        keep(new SphereGeometry(1000 * 695700 / snapshot.positions.sun.distanceKm, 24, 16)),
        keep(new MeshBasicMaterial({ color: 0xfff8ec })),
      )
      sun.position.copy(sunDirection).multiplyScalar(1000)
      sky.add(sun)

      let yaw = snapshot.positions.earth.azimuthDeg - 12
      let pitch = 0
      const markers = [...indicatorsRef.current!.querySelectorAll<SVGGElement>('[data-body]')]
      const markerDirection = new Vector3()
      const updateIndicators = () => {
        const width = host.clientWidth, height = host.clientHeight
        if (!width || !height) return
        indicatorsRef.current!.setAttribute('viewBox', `0 0 ${width} ${height}`)
        const positions = [earthDirection, sunDirection].map(direction => {
          markerDirection.copy(direction).applyQuaternion(skyCamera.quaternion.clone().invert())
          return surfaceIndicatorPosition(markerDirection.toArray(), width, height, skyCamera.fov)
        })
        positions.forEach((position, index) => {
          const marker = markers[index]!
          const { x, y, offscreen, angle } = position
          const other = positions[1 - index]!
          const crowded = index === 1 && Math.abs(x - other.x) < 120 && Math.abs(y - other.y) < 72
          const horizontal = x > width - 124 ? -1 : 1
          const vertical = y < 84 ? 1 : -1
          const elbow = crowded ? 62 : 34
          marker.removeAttribute('visibility')
          marker.setAttribute('transform', `translate(${x} ${y})`)
          marker.setAttribute('data-offscreen', String(offscreen))
          marker.setAttribute('aria-label', `${index === 0 ? 'Earth' : 'Sun'}${offscreen ? ', off screen' : ''}`)
          marker.querySelector('.surface-indicator-line')!.setAttribute('d', `M0 0 L${horizontal * 20} ${vertical * elbow} H${horizontal * 104}`)
          const label = marker.querySelector('text')!
          label.setAttribute('x', String(horizontal * 28))
          label.setAttribute('y', String(vertical * elbow + 17))
          label.setAttribute('text-anchor', horizontal === 1 ? 'start' : 'end')
          marker.querySelector('.surface-indicator-arrow')!.setAttribute('transform', `rotate(${angle})`)
        })
      }
      const render = () => {
        if (disposed) return
        camera.lookAt(camera.position.clone().add(new Vector3(...skyDirection(yaw, pitch))))
        skyCamera.quaternion.copy(camera.quaternion)
        renderer.clear()
        renderer.render(sky, skyCamera)
        renderer.clearDepth()
        renderer.render(scene, camera)
        updateIndicators()
      }
      const resetView = () => {
        yaw = selectedRef.current.positions.earth.azimuthDeg
        pitch = Math.max(-65, Math.min(80, selectedRef.current.positions.earth.elevationDeg))
        render()
      }
      updateTimeRef.current = current => {
        sunDirection.set(...skyDirection(current.positions.sun.azimuthDeg, current.positions.sun.elevationDeg))
        earthDirection.set(...skyDirection(current.positions.earth.azimuthDeg, current.positions.earth.elevationDeg))
        sun.position.copy(sunDirection).multiplyScalar(1000)
        earth.position.copy(earthDirection).multiplyScalar(1000)
        earth.scale.setScalar(snapshot.positions.earth.distanceKm / current.positions.earth.distanceKm)
        sun.scale.setScalar(snapshot.positions.sun.distanceKm / current.positions.sun.distanceKm)
        light.position.copy(sunDirection).multiplyScalar(60000)
        light.shadow.needsUpdate = true
        earthLight.position.copy(earth.position).addScaledVector(sunDirection, 10000)
        canvas.setAttribute('aria-label', `View from the Moon at ${locationLabel({ latitude: snapshot.latitudeDeg, longitude: normalizeLongitude(snapshot.longitudeDeg) })}, ${current.timestamp}. Drag or use arrow keys to look around.`)
        render()
      }
      updateTimeRef.current(selectedRef.current)
      const resize = () => {
        if (disposed || !host.clientWidth || !host.clientHeight) return
        camera.aspect = skyCamera.aspect = host.clientWidth / host.clientHeight
        camera.updateProjectionMatrix()
        skyCamera.updateProjectionMatrix()
        renderer.setSize(host.clientWidth, host.clientHeight, false)
        render()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(host)
      cleanup.push(() => observer.disconnect())

      let drag: { id: number; x: number; y: number } | null = null
      const down = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0) return
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
        canvas.setPointerCapture(event.pointerId)
        canvas.focus({ preventScroll: true })
      }
      const move = (event: PointerEvent) => {
        if (!drag || drag.id !== event.pointerId) return
        yaw -= (event.clientX - drag.x) * 0.11
        pitch = Math.max(-65, Math.min(80, pitch + (event.clientY - drag.y) * 0.11))
        drag.x = event.clientX
        drag.y = event.clientY
        render()
      }
      const up = () => { drag = null }
      const key = (event: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Home') { resetView(); return }
        yaw += event.key === 'ArrowRight' ? 3 : event.key === 'ArrowLeft' ? -3 : 0
        pitch = Math.max(-65, Math.min(80, pitch + (event.key === 'ArrowUp' ? 3 : event.key === 'ArrowDown' ? -3 : 0)))
        render()
      }
      canvas.addEventListener('pointerdown', down)
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
      canvas.addEventListener('pointercancel', up)
      canvas.addEventListener('keydown', key)
      cleanup.push(() => {
        canvas.removeEventListener('pointerdown', down)
        canvas.removeEventListener('pointermove', move)
        canvas.removeEventListener('pointerup', up)
        canvas.removeEventListener('pointercancel', up)
        canvas.removeEventListener('keydown', key)
      })
      resize()
      const earthTexture = keep(new TextureLoader().load(`${import.meta.env.BASE_URL}moon/earth.jpg`, render))
      earthTexture.colorSpace = SRGBColorSpace
      earth.material.map = earthTexture
      earth.material.needsUpdate = true

      const tiles: { x: number; y: number }[] = []
      for (let y = patch.minY; y <= patch.maxY; y++) {
        for (let x = patch.minX; x <= patch.maxX; x++) tiles.push({ x, y })
      }
      let completed = 0
      setStatus(`Loading surface imagery, 0 / ${tiles.length}`)
      await concurrent(tiles, async ({ x, y }) => {
        abort.signal.throwIfAborted()
        const columns = layer.levelZeroColumns * 2 ** patch.z
        const url = layer.tileUrlTemplate.replace('{z}', String(patch.z))
          .replace('{x}', String(((x % columns) + columns) % columns)).replace('{y}', String(y))
        const response = await fetch(url, { signal: abort.signal })
        if (!response.ok) throw new Error(`Moon imagery could not load (${response.status}).`)
        const bitmap = await createImageBitmap(await response.blob())
        if (disposed || abort.signal.aborted) { bitmap.close(); return }
        context.drawImage(bitmap, (x - patch.minX) * layer.tileSize, (y - patch.minY) * layer.tileSize)
        bitmap.close()
        texture.needsUpdate = true
        setStatus(`Loading surface imagery, ${++completed} / ${tiles.length}`)
        render()
      })
      if (!disposed) setStatus(null)
    }

    void start().catch(reason => {
      if (!disposed) {
        setError(reason instanceof Error ? reason.message : 'The surface view could not load.')
        setStatus(null)
        abort.abort()
      }
    })
    return () => {
      disposed = true
      abort.abort()
      updateTimeRef.current = () => {}
      for (const dispose of cleanup) dispose()
      for (const resource of resources.reverse()) resource.dispose()
    }
  }, [snapshot])

  return (
    <>
      <div className="surface-canvas" ref={hostRef} />
      <svg className="surface-indicators" ref={indicatorsRef} aria-label="Sun and Earth directions">
        {(['earth', 'sun'] as const).map(body => (
          <g key={body} className={`surface-indicator surface-indicator-${body}`} data-body={body} visibility="hidden" role="img">
            <path className="surface-indicator-line" />
            <circle className="surface-indicator-dot" r="2.5" />
            <path className="surface-indicator-arrow" d="M-7 -4 L0 0 L-7 4" />
            <text>{body === 'earth' ? 'Earth' : 'Sun'}</text>
          </g>
        ))}
      </svg>
      {status && <div className="surface-loading" role="status" aria-label={status}><span /></div>}
      {error && <p className="surface-error" role="alert">{error}</p>}
    </>
  )
}

export default function SurfacePreview({ plan, active }: { plan: SurfacePlan; active: boolean }) {
  const [nearTop, setNearTop] = useState(false)
  const [time, setTime] = useState(() => Date.parse(plan.snapshot.timestamp))
  const selected = useMemo(() => surfaceSnapshotAt(plan, time), [plan, time])

  return (
    <div className="surface-view surface-window"
      onPointerMove={event => {
        if (event.buttons !== 0) return
        setNearTop(event.clientY - event.currentTarget.getBoundingClientRect().top <= 96)
      }}
      onPointerLeave={() => setNearTop(false)}>
      <a className={`surface-back-to-planner${nearTop ? ' is-visible' : ''}`} href="#planner" aria-label="Back to planner">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Planner</span>
      </a>
      <SurfaceScene snapshot={plan.snapshot} selected={selected} />
      <SurfaceTimeline key={active ? 'active' : 'inactive'} positions={plan.positions} selected={time} onSelect={setTime} />
    </div>
  )
}
