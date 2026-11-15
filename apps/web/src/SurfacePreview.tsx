import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  Scene, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import type { CylindricalTerrainManifest, GeographicImageryLayer } from '@lunar-lense/contracts'
import {
  concurrent, imageryPatch, previewSite, previewTimestamp, sampleTerrain, skyDirection, surfaceGrid,
} from './surface-geometry'
import type { ImageryPatch, SurfaceSnapshot } from './surface-geometry'
import './surface-preview.css'

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Surface data could not load (${response.status}).`)
  return response.json() as Promise<T>
}

async function terrain(patch: ImageryPatch, signal: AbortSignal) {
  const base = `${import.meta.env.BASE_URL}terrain/`
  const manifest = await json<CylindricalTerrainManifest>(`${base}manifest.json`, signal)
  if (manifest.projection !== 'simple-cylindrical' || manifest.encoding !== 'float32-le') {
    throw new Error('The Marius Hills terrain is unavailable.')
  }
  const column = (lon: number) => (lon - manifest.westDeg) * manifest.pixelsPerDegree - 0.5
  const row = (lat: number) => (manifest.northDeg - lat) * manifest.pixelsPerDegree - 0.5
  const keys: string[] = []
  for (let y = Math.floor(Math.floor(row(patch.northDeg)) / manifest.tileSize);
    y <= Math.floor((Math.floor(row(patch.southDeg)) + 1) / manifest.tileSize); y++) {
    for (let x = Math.floor(Math.floor(column(patch.westDeg)) / manifest.tileSize);
      x <= Math.floor((Math.floor(column(patch.eastDeg)) + 1) / manifest.tileSize); x++) {
      keys.push(`${x}-${y}.bin`)
    }
  }
  const tiles = new Map<string, DataView>()
  await concurrent(keys, async key => {
    signal.throwIfAborted()
    if (!manifest.tiles[key]) throw new Error('The surface preview extends beyond prepared terrain.')
    const response = await fetch(`${base}${key}`, { signal })
    if (!response.ok) throw new Error('A lunar terrain tile could not load.')
    const buffer = await response.arrayBuffer()
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
      .map(value => value.toString(16).padStart(2, '0')).join('')
    if (buffer.byteLength !== manifest.tileSize ** 2 * 4 || hash !== manifest.tiles[key]) {
      throw new Error('A lunar terrain tile failed its integrity check.')
    }
    tiles.set(key, new DataView(buffer))
  })
  signal.throwIfAborted()
  return surfaceGrid(patch, manifest.referenceRadiusM, (lat, lon) => sampleTerrain(manifest, tiles, lat, lon))
}

function SurfaceScene() {
  const hostRef = useRef<HTMLDivElement>(null)
  const bearingRef = useRef<HTMLSpanElement>(null)
  const earthLabelRef = useRef<HTMLSpanElement>(null)
  const resetRef = useRef(() => {})
  const [status, setStatus] = useState<string | null>('Loading lunar terrain...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const abort = new AbortController()
    let disposed = false
    const resources: { dispose(): void }[] = []
    const cleanup: (() => void)[] = []
    const keep = <T extends { dispose(): void }>(resource: T): T => { resources.push(resource); return resource }

    const start = async () => {
      const [snapshot, layer] = await Promise.all([
        json<SurfaceSnapshot>(`${import.meta.env.BASE_URL}moon/surface-preview.json`, abort.signal),
        json<GeographicImageryLayer>('/api/imagery/layers/wac-global', abort.signal),
      ])
      if (snapshot.timestamp !== previewTimestamp || snapshot.latitudeDeg !== previewSite.latitudeDeg
        || snapshot.longitudeDeg !== previewSite.longitudeDeg || snapshot.eyeHeightM !== previewSite.eyeHeightM) {
        throw new Error('The fixed surface snapshot does not match this site.')
      }
      const patch = imageryPatch(layer)
      const grid = await terrain(patch, abort.signal)
      if (Math.abs(grid.groundM - snapshot.groundElevationM) > 0.01) {
        throw new Error('The surface terrain does not match the captured observer height.')
      }
      if (disposed) return

      const renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
      keep({ dispose() { renderer.dispose(); renderer.forceContextLoss() } })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
      renderer.setClearColor(0x000000)
      renderer.autoClear = false
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFSoftShadowMap
      const canvas = renderer.domElement
      canvas.tabIndex = 0
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', 'View from the Moon at Marius Hills. Drag or use arrow keys to look around. Position and time are fixed.')
      host.appendChild(canvas)
      cleanup.push(() => canvas.remove())

      const scene = new Scene()
      const sky = new Scene()
      const camera = new PerspectiveCamera(58, 1, 0.2, 180000)
      camera.position.set(0, previewSite.eyeHeightM, 0)
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
      const material = keep(new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }))
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
        keep(new MeshStandardMaterial({ roughness: 1 })),
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
      let pitch = Math.min(22, snapshot.positions.earth.elevationDeg / 2)
      const labelPosition = new Vector3()
      const render = () => {
        if (disposed) return
        camera.lookAt(camera.position.clone().add(new Vector3(...skyDirection(yaw, pitch))))
        skyCamera.quaternion.copy(camera.quaternion)
        renderer.clear()
        renderer.render(sky, skyCamera)
        renderer.clearDepth()
        renderer.render(scene, camera)
        if (bearingRef.current) {
          const bearing = (yaw % 360 + 360) % 360
          const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]
          bearingRef.current.textContent = `${Math.round(bearing).toString().padStart(3, '0')}° ${compass}`
        }
        const label = earthLabelRef.current
        if (label) {
          labelPosition.copy(earth.position).project(skyCamera)
          label.hidden = labelPosition.z > 1 || Math.abs(labelPosition.x) > 0.95 || Math.abs(labelPosition.y) > 0.9
          label.style.left = `${(labelPosition.x + 1) * 50}%`
          label.style.top = `${(1 - labelPosition.y) * 50}%`
        }
      }
      resetRef.current = () => {
        yaw = snapshot.positions.earth.azimuthDeg - 12
        pitch = Math.min(22, snapshot.positions.earth.elevationDeg / 2)
        render()
      }
      const resize = () => {
        if (disposed || !host.clientWidth || !host.clientHeight) return
        camera.aspect = skyCamera.aspect = host.clientWidth / host.clientHeight
        camera.updateProjectionMatrix()
        skyCamera.updateProjectionMatrix()
        renderer.setSize(host.clientWidth, host.clientHeight)
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
        if (event.key === 'Home') { resetRef.current(); return }
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
        const url = layer.tileUrlTemplate.replace('{z}', String(patch.z)).replace('{x}', String(x)).replace('{y}', String(y))
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
      resetRef.current = () => {}
      for (const dispose of cleanup) dispose()
      for (const resource of resources.reverse()) resource.dispose()
    }
  }, [])

  return (
    <>
      <div className="surface-canvas" ref={hostRef} />
      <div className="surface-hud" aria-hidden="true">
        <span className="surface-site">Marius Hills <span>14° N / 57° W</span></span>
        <span className="surface-bearing" ref={bearingRef}>Looking toward Earth</span>
      </div>
      <span ref={earthLabelRef} className="surface-earth-label" hidden>Earth</span>
      {status && <div className="surface-loading" role="status"><span />{status}</div>}
      {error && <p className="surface-error" role="alert">{error}</p>}
      <div className="surface-controls">
        <span>Drag to look around <span className="surface-keyboard-hint">or use arrow keys</span></span>
        <button type="button" onClick={() => resetRef.current()}>Look toward Earth</button>
      </div>
    </>
  )
}

export default function SurfacePreview() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { root: section.closest('.flow-viewport'), rootMargin: '150px' })
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={sectionRef} className="surface-preview">
      <div className="surface-heading">
        <div><p className="surface-eyebrow">Surface preview</p><h2 id="surface-title">A view from the Moon.</h2></div>
        <p>03 Dec 2026 <span>12:00 UTC</span><span>2 m above the ground</span></p>
      </div>
      <div className="surface-window">
        {visible ? <SurfaceScene key={version} /> : <p className="surface-loading">Preparing the surface view...</p>}
      </div>
      <div className="surface-caption">
        <p>Fixed position and time. NASA terrain and photographic imagery.</p>
        <button type="button" onClick={() => setVersion(value => value + 1)}>Reload view</button>
      </div>
    </div>
  )
}
