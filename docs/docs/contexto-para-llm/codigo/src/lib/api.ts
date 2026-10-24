export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = localStorage.getItem('unlar-demo-token')
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(path, {
    ...init,
    headers,
  })
  const payload = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) throw new Error(payload.message || `Error del servidor (${response.status})`)
  return payload
}
