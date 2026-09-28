import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useApp } from './store/app'
import './styles/index.css'
import { startInstallSupport } from './pwa/install'

startInstallSupport()

// Development only: lets the store be inspected from the browser console. Never present in production builds.
if (import.meta.env.DEV) (window as unknown as { __numero: typeof useApp }).__numero = useApp

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
