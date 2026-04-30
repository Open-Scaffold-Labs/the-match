import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Pre-warm server lambda on app load (cold-start protection)
fetch('/health').catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
