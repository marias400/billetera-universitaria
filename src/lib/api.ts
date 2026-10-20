export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) throw new Error(payload.message || `Error del servidor (${response.status})`)
  return payload
}
