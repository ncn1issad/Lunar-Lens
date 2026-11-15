import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, mock, test } from 'node:test'
import type { GlobalTerrainManifest, GeographicImageryLayer } from '@lunar-lense/contracts'
import { sha256Hex } from '../src/sha256.ts'
import { imageryPatch } from '../src/surface-geometry.ts'
import type { SurfaceSnapshot } from '../src/surface-geometry.ts'
import { globalTerrainKeys, plannedTerrain } from '../src/surface-terrain.ts'

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
  mock.restoreAll()
})
function withoutSubtle() {
  // Browsers on http://192.168.x.x still have crypto, but no subtle property.
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
}

test('native and plain HTTP SHA-256 agree for empty, text, and terrain-sized binary data', async () => {
  const buffers = [new ArrayBuffer(0), new TextEncoder().encode('abc').buffer,
    Uint8Array.from({ length: 256 * 256 * 2 }, (_, i) => i % 251).buffer]
  for (const buffer of buffers) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    const expected = createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
    assert.equal(await sha256Hex(buffer), expected)
    withoutSubtle()
    assert.equal(await sha256Hex(buffer), expected)
  }
})

test('the native hashing path does not hide a digest failure', async () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    subtle: { digest: async () => { throw new Error('Digest failed') } },
  } })
  await assert.rejects(sha256Hex(new ArrayBuffer(1)), /Digest failed/)
})

const manifest: GlobalTerrainManifest = JSON.parse(await readFile(new URL('../public/terrain/ldem_64/manifest.json', import.meta.url), 'utf8'))
const snapshot: SurfaceSnapshot = JSON.parse(await readFile(new URL('../public/moon/surface-preview.json', import.meta.url), 'utf8'))
const patch = imageryPatch({ minZoom: 0, maxZoom: 8, levelZeroColumns: 2, levelZeroRows: 1 } as GeographicImageryLayer, snapshot)
const keys = globalTerrainKeys(manifest, patch)
const files = new Map(await Promise.all(keys.map(async key => [key,
  new Uint8Array(await readFile(new URL(`../public/terrain/ldem_64/${key}`, import.meta.url))),
] as const)))

function serveTerrain(corrupt: 'bit' | 'length' | null = null) {
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const name = String(input).split('/').at(-1)!
    if (name === 'manifest.json') return Response.json(manifest)
    const original = files.get(name)
    assert.ok(original, `Unexpected terrain request: ${name}`)
    const bytes = new Uint8Array(original)
    if (corrupt === 'bit') bytes[0] ^= 1
    return new Response(corrupt === 'length' ? bytes.slice(2) : bytes)
  })
}

test('Surface loads real terrain tiles over plain HTTP with checksum verification', async () => {
  withoutSubtle()
  serveTerrain()
  const grid = await plannedTerrain(patch, snapshot, '/', new AbortController().signal)
  assert.ok(Number.isFinite(grid.groundM))
  assert.equal(grid.positions.length, 513 * 513 * 3)
  assert.equal(grid.indices.length, 512 * 512 * 6)
})

for (const corruption of ['bit', 'length'] as const) {
  test(`plain HTTP still rejects terrain with ${corruption === 'bit' ? 'changed bytes' : 'a wrong size'}`, async () => {
    withoutSubtle()
    serveTerrain(corruption)
    await assert.rejects(plannedTerrain(patch, snapshot, '/', new AbortController().signal), /failed its integrity check/)
  })
}
