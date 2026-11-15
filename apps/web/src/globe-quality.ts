/** Keep large maps off the home page and respect smaller devices and GPU limits. */
export function globeTextureSize(maxTextureSize: number, smallScreen: boolean, deviceMemory?: number) {
  if (maxTextureSize < 4096) return 2048
  return maxTextureSize >= 8192 && !smallScreen && (deviceMemory === undefined || deviceMemory > 4) ? 8192 : 4096
}

/** Upgrade in place, keep the preview while loading, and reuse maps on return. */
export function createGlobeQualityController<T>(load: () => Promise<T>, apply: (resource: T | null) => void, release: (resource: T) => void) {
  let enabled = false
  let disposed = false
  let resource: T | null = null
  let pending: Promise<void> | null = null
  const preload = () => {
    if (disposed || resource !== null || pending) return
    pending = load().then(loaded => {
      if (disposed) { release(loaded); return }
      resource = loaded
      if (enabled) apply(loaded)
    }).catch(() => { /* The low-resolution globe stays usable if the upgrade fails. */ }).finally(() => { pending = null })
  }
  return {
    preload,
    setEnabled(next: boolean) {
      if (disposed) return
      enabled = next
      if (!next || resource !== null) { apply(next ? resource : null); return }
      preload()
    },
    dispose() {
      disposed = true
      if (resource !== null) release(resource)
      resource = null
    },
  }
}
