const RETRY_DELAYS = [500, 1000, 2000, 3000]

export function getToken() {
  return localStorage.getItem('tm_token')
}

export function clearToken() {
  localStorage.removeItem('tm_token')
}

async function fetchWithRetry(url, opts = {}, attempt = 0) {
  const token = getToken()
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  })

  if (res.status === 503 && attempt < RETRY_DELAYS.length) {
    await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    return fetchWithRetry(url, opts, attempt + 1)
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status })
  }

  return res.json()
}

export const api = (url, opts) => fetchWithRetry(url, opts)

export const post = (url, body) =>
  fetchWithRetry(url, { method: 'POST', body: JSON.stringify(body) })

export const put = (url, body) =>
  fetchWithRetry(url, { method: 'PUT', body: JSON.stringify(body) })

export const del = (url) =>
  fetchWithRetry(url, { method: 'DELETE' })
