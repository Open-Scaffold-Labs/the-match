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

// Native-shell API base. When the app is bundled into the Capacitor iOS/Android
// shell, the webview origin is capacitor://localhost, so root-relative "/api"
// and "/health" calls would resolve to the local bundle instead of our backend
// and every request would fail. VITE_API_ORIGIN is injected at NATIVE build time
// (e.g. `VITE_API_ORIGIN=https://<prod-domain> npm run build`) to point requests
// at the deployed API. On the web build it is unset → empty string → same-origin
// relative calls, so existing web/PWA behavior is byte-for-byte unchanged.
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '')
function withOrigin(url) {
  if (API_ORIGIN && typeof url === 'string' && url.startsWith('/')) {
    return API_ORIGIN + url
  }
  return url
}

// Native-shell safety net. ~A dozen call sites across the app call fetch("/api/…")
// or fetch("/health") directly, bypassing this helper. On the web build those are
// same-origin and fine; in the Capacitor shell (origin capacitor://localhost) they
// would all 404. Rather than edit every call site (and risk missing one, or a new
// one being added later), we install a single fetch shim at startup that rewrites
// root-relative "/api" and "/health" requests to the deployed backend.
//
// This is a NO-OP on web: API_ORIGIN is empty there, so the shim is never installed
// and window.fetch is untouched — existing behavior is byte-for-byte unchanged.
// Absolute URLs (including ones this module already prefixed via withOrigin) start
// with "http", not "/", so they pass straight through with no double-prefixing.
let nativeApiBaseInstalled = false
export function installNativeApiBase() {
  if (nativeApiBaseInstalled || !API_ORIGIN) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && (input.startsWith('/api') || input.startsWith('/health'))) {
      return origFetch(API_ORIGIN + input, init)
    }
    return origFetch(input, init)
  }
  nativeApiBaseInstalled = true
}

export function getToken() {
  return localStorage.getItem('tm_token')
}

export function clearToken() {
  localStorage.removeItem('tm_token')
}

async function fetchWithRetry(url, opts = {}, attempt = 0) {
  url = withOrigin(versioned(url))
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
