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

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = new Headers()
  const token = localStorage.getItem('unlar-demo-token')
  if (token) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(path, { headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(payload.message || `No se pudo descargar el archivo (${response.status}).`)
  }

  const fileUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = fileUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000)
}
