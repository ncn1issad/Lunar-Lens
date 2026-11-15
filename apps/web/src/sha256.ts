export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  // Plain HTTP on a LAN does not expose SubtleCrypto. Keep verifying assets
  // there with the same SHA-256 algorithm, loaded only when it is needed.
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-256', buffer))
    : (await import('@noble/hashes/sha2.js')).sha256(new Uint8Array(buffer))
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}
