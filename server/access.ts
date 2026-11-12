import { scryptSync, timingSafeEqual } from 'node:crypto'

// Only password hashes are configured on the public deployment. Local demo credentials
// remain usable only in local mode.
export function verifyPassword(password: unknown, encoded: string | undefined): boolean {
  if (typeof password !== 'string' || password.length > 256 || !encoded) return false
  const [salt, expected] = encoded.split(':')
  if (!/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, 'hex'))
}

export class SessionStore<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>()
  private ttlMs: number
  constructor(ttlMs = 8 * 60 * 60_000) { this.ttlMs = ttlMs }
  set(key: string, value: T) {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }
  get(key: string): T | undefined {
    const item = this.entries.get(key)
    if (!item) return undefined
    if (item.expiresAt <= Date.now()) { this.entries.delete(key); return undefined }
    return item.value
  }
  has(key: string) { return this.get(key) !== undefined }
  delete(key: string) { return this.entries.delete(key) }
  *[Symbol.iterator](): IterableIterator<[string, T]> {
    for (const key of this.entries.keys()) {
      const value = this.get(key)
      if (value !== undefined) yield [key, value]
    }
  }
  cleanup() { for (const key of this.entries.keys()) this.get(key) }
}
