// =====================================================================
// NUMERO AS AN INSTALLED APP: the browser's offer to install it, and the
// service worker that lets it open without a connection. The offer comes
// once, early, and is kept here until the person asks to install.
// =====================================================================

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let offer: InstallPrompt | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

/** Started once, before the application is drawn, so that the browser's offer is not missed. */
export function startInstallSupport(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e as InstallPrompt; changed() })
  window.addEventListener('appinstalled', () => { offer = null; changed() })
  // the service worker runs only in the published build: in development every file changes all the time
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
  }
}

/** Open as an installed app rather than in a browser tab. */
export function runningInstalled(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone and iPad install only from Safari's Share menu: no browser there offers it to a page. */
export function onAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export const canOfferInstall = (): boolean => offer !== null

export async function offerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const o = offer
  if (!o) return 'unavailable'
  await o.prompt()
  const { outcome } = await o.userChoice
  offer = null
  changed()
  return outcome
}

export function onInstallChange(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
