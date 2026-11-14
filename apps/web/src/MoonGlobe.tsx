import { useEffect, useRef, useState } from 'react'
import {
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getHomeMoonState } from './home-moon'

export default function MoonGlobe({ live = false }: { live?: boolean }) {
  const containerRef = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true })
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- Report external WebGL initialization failure.
      setError('This browser could not start the 3D Moon. WebGL is required.')
      return
    }

    let disposed = false
    renderer.setClearColor(0x000000)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.setAttribute('role', 'img')
    renderer.domElement.setAttribute(
      'aria-label',
      '3D Moon. Drag to rotate. Scroll or pinch to zoom.',
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

    const sunlight = new DirectionalLight(0xffffff, Math.PI)
    if (live) scene.add(sunlight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.6
    controls.minZoom = 0.5
    controls.maxZoom = 3

    const render = () => renderer.render(scene, camera)
    const updateTime = () => {
      if (!live) return
      const state = getHomeMoonState(new Date())
      moon.quaternion.copy(state.orientation)
      sunlight.position.copy(state.sunDirection).multiplyScalar(10)
      render()
    }
    updateTime()
    // Refresh the browser clock each minute, and immediately on tab return.
    // Camera controls stay independent so refreshes preserve the user's view.
    const clockTimer = live ? window.setInterval(updateTime, 60_000) : undefined
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateTime()
    }
    if (live) document.addEventListener('visibilitychange', onVisibilityChange)
    controls.addEventListener('change', render)
    // Controls emit changes while the drag settles; idle frames need no redraw.
    renderer.setAnimationLoop(() => controls.update())

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

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container
      if (!width || !height) return
      const aspect = width / height
      const halfHeight = 1.5 / Math.min(aspect, 1)
      camera.left = -halfHeight * aspect
      camera.right = halfHeight * aspect
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    return () => {
      disposed = true
      window.clearInterval(clockTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.removeEventListener('change', render)
      controls.dispose()
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [live])

  return (
    <main ref={containerRef} className="moon-view" aria-label="Moon globe">
      {error && <p className="moon-error" role="alert">{error}</p>}
    </main>
  )
}
