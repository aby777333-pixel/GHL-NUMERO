import { useEffect, useState, type ReactNode } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { useApp } from '@/store/app'
import { canOfferInstall, offerInstall, onAppleMobile, onInstallChange, runningInstalled } from '@/pwa/install'
import { cx } from './kit'

/** How to install where the browser does not offer it itself. */
function howTo(): { title: string; body: string } {
  if (onAppleMobile()) return { title: 'Install NUMERO on this iPhone or iPad', body: 'Open this page in Safari, tap the Share button, then “Add to Home Screen”.' }
  return { title: 'Install NUMERO', body: 'In the browser menu choose “Install app” or “Add to Home screen”. On a computer, Chrome and Edge also show an install button at the right of the address bar.' }
}

/** Installs NUMERO as an app; hidden once it runs as one. `item` fits a menu, `button` a page. */
export function InstallAppItem({ onDone, variant = 'item', icon }: { onDone?: () => void; variant?: 'item' | 'button'; icon?: ReactNode }) {
  const toast = useApp((s) => s.toast)
  const [, redraw] = useState(0)
  useEffect(() => onInstallChange(() => redraw((n) => n + 1)), [])
  if (runningInstalled()) return null

  const install = async () => {
    onDone?.()
    if (canOfferInstall()) {
      const r = await offerInstall()
      if (r === 'accepted') toast('ok', 'NUMERO is being installed', 'It opens from your home screen or app list, like any app.')
      return
    }
    const h = howTo()
    toast('info', h.title, h.body)
  }
  return (
    <button type="button" className={cx(variant === 'item' ? 'navlink w-full' : 'btn ghost w-full')} onClick={() => void install()}>
      {icon ?? <MonitorSmartphone size={15} />} <span className={variant === 'item' ? 'flex-1 text-left' : undefined}>Install the NUMERO app</span>
    </button>
  )
}
