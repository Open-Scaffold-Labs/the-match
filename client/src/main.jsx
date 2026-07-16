import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installNativeApiBase } from './lib/api.js'
import { initNativeShell } from './lib/native.js'

// Native shell (Capacitor): route root-relative /api + /health calls to the
// deployed backend. No-op on web. MUST run before the first fetch below.
installNativeApiBase()

// Native shell: status bar, splash dismiss, back button. No-op on web.
initNativeShell()

// Pre-warm server lambda on app load (cold-start protection)
fetch('/health').catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
