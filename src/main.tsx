import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('No se pudo iniciar la billetera.', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <main className="startup-error"><p className="eyebrow">Billetera UNLaR</p><h1>No se pudo cargar la aplicación</h1><p>Comprobá que la Mac y el teléfono estén conectados al mismo equipo o red, y volvé a cargar la página.</p><details><summary>Información para soporte</summary><pre>{this.state.error.message}</pre></details><button type="button" className="primary-button" onClick={() => window.location.reload()}>Volver a intentar</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register('/sw.js')
    } else {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('unlar-wallet-shell-')).map((key) => caches.delete(key))))
    }
  })
}
