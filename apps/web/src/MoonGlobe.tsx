import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { animateMoonState, getHomeMoonState } from './home-moon'
import { frameMoonInViewport } from './moon-viewport'
import { locationFromPoint, locationNormal } from './planning-location'
import type { LunarLocation } from './planning-location'

interface MoonGlobeProps {
  live?: boolean
  framingRef?: RefObject<HTMLDivElement | null>
  zoomEnabled?: boolean
  previewTime?: number | null
  location?: LunarLocation | null
  selectable?: boolean
  onLocationChange?: (location: LunarLocation) => void
}

export default function MoonGlobe({ live = false, framingRef, zoomEnabled = true, previewTime = null,
  location = null, selectable = false, onLocationChange }: MoonGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const previewTimeRef = useRef(previewTime)
  const refreshTimeRef = useRef<(() => void) | null>(null)
  const selectionRef = useRef({ location, selectable, onLocationChange })
  const refreshSelectionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    selectionRef.current = { location, selectable, onLocationChange }
    refreshSelectionRef.current?.()
  }, [location, selectable, onLocationChange])

  useEffect(() => {
    previewTimeRef.current = previewTime
    refreshTimeRef.current?.()
  }, [previewTime])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- Report external WebGL initialization failure.
      setError('This browser could not start the 3D Moon. WebGL is required.')
      return
    }

    let disposed = false
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.setAttribute('role', 'img')
    renderer.domElement.setAttribute(
      'aria-label',
      zoomEnabled ? '3D Moon. Drag to rotate. Scroll or pinch to zoom.' : '3D Moon. Drag to rotate.',
    )
    container.appendChild(renderer.domElement)

    const scene = new Scene()
    // Orthographic projection represents the distant Earth view of the Moon.
    const camera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100)
    camera.position.set(0, 0, 4.3)

    const geometry = new SphereGeometry(1, 128, 64)
    const material = live ? new MeshLambertMaterial() : new MeshBasicMaterial()
    const moon = new Mesh(geometry, material)
    // The map's central meridian faces the camera, with lunar north up.
    moon.rotation.y = -Math.PI / 2
    moon.visible = false
    scene.add(moon)

    const marker = new Group()
    const markerMaterial = new MeshBasicMaterial({ color: 0xf38ba8, side: DoubleSide })
    const dotGeometry = new SphereGeometry(0.011, 16, 12)
    const ringGeometry = new RingGeometry(0.023, 0.028, 48)
    const dot = new Mesh(dotGeometry, markerMaterial)
    const ring = new Mesh(ringGeometry, markerMaterial)
    marker.add(dot, ring)
    moon.add(marker)
    marker.visible = false

    const sunlight = new DirectionalLight(0xffffff, Math.PI)
    if (live) {
      scene.add(sunlight)
      // Presentation fill reveals the night-side texture without moving the terminator.
      scene.add(new AmbientLight(0xffffff, 0.16875))
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableZoom = zoomEnabled
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.6
    controls.minZoom = 0.5
    controls.maxZoom = 20

    const render = () => renderer.render(scene, camera)
    let cameraTarget: Vector3 | null = null
    const updateSelection = () => {
      const selection = selectionRef.current
      renderer.domElement.setAttribute('aria-label', selection.selectable
        ? '3D Moon. Click to select a location. Drag to rotate.'
        : zoomEnabled ? '3D Moon. Drag to rotate. Scroll or pinch to zoom.' : '3D Moon. Drag to rotate.')
      marker.visible = !!selection.location && selection.selectable
      if (selection.selectable && selection.location) {
        const normal = locationNormal(selection.location)
        dot.position.copy(normal).multiplyScalar(1.012)
        ring.position.copy(normal).multiplyScalar(1.008)
        ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
        cameraTarget = normal.applyQuaternion(moon.quaternion).normalize()
      } else {
        cameraTarget = new Vector3(0, 0, 1)
      }
      render()
    }
    refreshSelectionRef.current = updateSelection
    let displayedState: ReturnType<typeof getHomeMoonState> | null = null
    let targetState: ReturnType<typeof getHomeMoonState> | null = null
    const applyState = () => {
      if (!displayedState) return
      moon.quaternion.copy(displayedState.orientation)
      sunlight.position.copy(displayedState.sunDirection).multiplyScalar(10)
    }
    const updateTime = () => {
      if (!live) return
      const state = getHomeMoonState(new Date(previewTimeRef.current ?? Date.now()))
      targetState = state
      if (!displayedState || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        displayedState = { orientation: state.orientation.clone(), sunDirection: state.sunDirection.clone() }
        applyState()
        render()
      }
    }
    refreshTimeRef.current = updateTime
    updateTime()
    updateSelection()
    // Refresh the browser clock each minute, and immediately on tab return.
    // Camera controls stay independent so refreshes preserve the user's view.
    const clockTimer = live ? window.setInterval(updateTime, 60_000) : undefined
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateTime()
    }
    if (live) document.addEventListener('visibilitychange', onVisibilityChange)
    controls.addEventListener('change', render)
    // Both date previews and drag rotation settle without redrawing idle frames.
    let lastFrame = performance.now()
    let syncFraming = () => {}
    renderer.setAnimationLoop(() => {
      const now = performance.now()
      const elapsed = now - lastFrame
      lastFrame = now
      syncFraming()
      controls.update()
      if (cameraTarget) {
        const direction = camera.position.clone().normalize()
        if (direction.angleTo(cameraTarget) < 0.0001 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          camera.position.copy(cameraTarget).multiplyScalar(4.3)
          cameraTarget = null
        } else {
          const rotation = new Quaternion().setFromUnitVectors(direction, cameraTarget)
          rotation.slerp(new Quaternion(), Math.exp(-Math.min(elapsed, 64) / 200))
          camera.position.applyQuaternion(rotation)
        }
        controls.update()
        render()
      }
      if (displayedState && targetState && animateMoonState(displayedState, targetState, elapsed)) {
        applyState()
        render()
      }
    })

    const stopCameraFlight = () => { cameraTarget = null }
    controls.addEventListener('start', stopCameraFlight)
    const canvas = renderer.domElement
    const raycaster = new Raycaster()
    let press: { id: number; x: number; y: number; moved: boolean } | null = null
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }
    const pointerMove = (event: PointerEvent) => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true
    }
    const pointerUp = (event: PointerEvent) => {
      const down = press
      press = null
      if (!down || down.id !== event.pointerId || down.moved || !selectionRef.current.selectable || !moon.visible) return
      const rect = canvas.getBoundingClientRect()
      raycaster.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
        1 - (event.clientY - rect.top) / rect.height * 2), camera)
      moon.updateWorldMatrix(true, false)
      const hit = raycaster.intersectObject(moon, false)[0]
      if (hit) selectionRef.current.onLocationChange?.(locationFromPoint(moon.worldToLocal(hit.point.clone())))
    }
    const pointerCancel = () => { press = null }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerCancel)

    const texture = new TextureLoader().load(
      `${import.meta.env.BASE_URL}moon/color.jpg`,
      () => {
        if (disposed) return
        moon.visible = true
        render()
      },
      undefined,
      () => {
        if (!disposed) setError('The Moon texture could not load. Please reload.')
      },
    )
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    material.map = texture

    let renderedWidth = 0
    let renderedHeight = 0
    let renderedFrame: { x: number; y: number; width: number; height: number; centered: boolean } | null = null
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container
      if (!width || !height) return
      const viewport = container.getBoundingClientRect()
      const frame = framingRef?.current?.getBoundingClientRect() ?? viewport
      if (!frame.width || !frame.height) return
      const nextFrame = {
        x: frame.left - viewport.left,
        y: frame.top - viewport.top,
        width: frame.width,
        height: frame.height,
        centered: selectionRef.current.selectable,
      }
      if (width === renderedWidth && height === renderedHeight && renderedFrame
        && nextFrame.x === renderedFrame.x && nextFrame.y === renderedFrame.y
        && nextFrame.width === renderedFrame.width && nextFrame.height === renderedFrame.height
        && nextFrame.centered === renderedFrame.centered) return
      renderedFrame = nextFrame
      frameMoonInViewport(camera, width, height, nextFrame, nextFrame.centered)
      if (width !== renderedWidth || height !== renderedHeight) {
        renderer.setSize(width, height)
        renderedWidth = width
        renderedHeight = height
      }
      render()
    }
    // CSS can move a frame without changing its size, which ResizeObserver misses.
    syncFraming = resize
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    if (framingRef?.current) observer.observe(framingRef.current)
    window.addEventListener('scroll', resize, { passive: true })
    resize()

    return () => {
      disposed = true
      refreshTimeRef.current = null
      refreshSelectionRef.current = null
      window.clearInterval(clockTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
      window.removeEventListener('scroll', resize)
      renderer.setAnimationLoop(null)
      controls.removeEventListener('change', render)
      controls.removeEventListener('start', stopCameraFlight)
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
      controls.dispose()
      dotGeometry.dispose()
      ringGeometry.dispose()
      markerMaterial.dispose()
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [live, framingRef, zoomEnabled])

  return (
    <div ref={containerRef} className={`moon-view${selectable ? ' is-selectable' : ''}`} role="group" aria-label="Moon globe">
      {error && <p className="moon-error" role="alert">{error}</p>}
    </div>
  )
}
