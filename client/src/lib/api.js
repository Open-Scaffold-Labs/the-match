const RETRY_DELAYS = [500, 1000, 2000, 3000]

// API version (Track F.1 / audit N5). Every call site still passes "/api/..."
// paths; we rewrite the leading "/api/" to "/api/v1/" centrally here so the
// whole client moves to the versioned API in one place, with zero churn at the
// hundreds of call sites. The server keeps a "/api" legacy alias as a safety
// net, so anything that bypasses this helper keeps working. To cut over to a
// future API, change this one constant.
const API_VERSION = 'v1'
function versioned(url) {
  if (typeof url !== 'string') return url
  // Only rewrite a leading "/api/" that isn't already versioned.
  if (url.startsWith('/api/') && !url.startsWith(`/api/${API_VERSION}/`)) {
    return `/api/${API_VERSION}/` + url.slice('/api/'.length)
  }
  return url
}

export function getToken() {
  return localStorage.getItem('tm_token')
}

export function clearToken() {
  localStorage.removeItem('tm_token')
}

async function fetchWithRetry(url, opts = {}, attempt = 0) {
  url = versioned(url)
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
    // Attach status + raw payload so callers can branch on specific
    // error shapes (e.g. score-conflict 409 needs existing_score).
    throw Object.assign(new Error(err.error ?? 'Request failed'), {
      status: res.status,
      payload: err,
    })
  }

  return res.json()
}

export const api = (url, opts) => fetchWithRetry(url, opts)

export const post = (url, body) =>
  fetchWithRetry(url, { method: 'POST', body: JSON.stringify(body) })

export const put = (url, body) =>
  fetchWithRetry(url, { method: 'PUT', body: JSON.stringify(body) })

// DELETE supports an optional body (e.g. /api/auth/me requires
// { confirm: "DELETE" } as a typed-confirm guard). Most callers pass none.
export const del = (url, body) =>
  fetchWithRetry(url, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
