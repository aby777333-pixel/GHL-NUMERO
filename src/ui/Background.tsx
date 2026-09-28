import { useEffect, useRef } from 'react'
import { useApp } from '@/store/app'

/**
 * Ambient backdrop: a slow aurora and a fine ledger grid. No floating particles.
 * Deliberately quiet. Pauses when the tab is hidden; held still by "Effects: off"
 * and by the operating system's reduced-motion setting.
 */
export function Background() {
  const ref = useRef<HTMLCanvasElement>(null)
  const effects = useApp((s) => s.effects)
  const theme = useApp((s) => s.theme)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const still = effects === 'off' || reduce
    const dark = theme === 'dark'
    let w = 0, h = 0, raf = 0, t = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const size = () => {
      w = window.innerWidth; h = window.innerHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const blob = (cx: number, cy: number, r: number, c: string) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      const k = dark ? 1 : 0.55
      blob(w * (0.16 + Math.sin(t * 0.00011) * 0.05), h * (0.08 + Math.cos(t * 0.00009) * 0.04), Math.max(w, h) * 0.5, `rgba(216,181,111,${0.085 * k})`)
      blob(w * (0.88 + Math.cos(t * 0.00008) * 0.05), h * (0.22 + Math.sin(t * 0.0001) * 0.06), Math.max(w, h) * 0.46, `rgba(80,170,255,${0.075 * k})`)
      blob(w * (0.55 + Math.sin(t * 0.00007) * 0.08), h * (1.02 + Math.cos(t * 0.00012) * 0.04), Math.max(w, h) * 0.5, `rgba(130,110,255,${0.05 * k})`)

      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.022)' : 'rgba(16,22,38,0.035)'
      ctx.lineWidth = 1
      const gs = 56
      ctx.beginPath()
      for (let x = (t * 0.004) % gs; x < w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, h) }
      for (let y = 0; y < h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(w, y) }
      ctx.stroke()

    }
    const loop = (now: number) => {
      t = now
      draw()
      if (!still) raf = requestAnimationFrame(loop)
    }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !still) raf = requestAnimationFrame(loop) }
    const onSize = () => { size(); if (still) draw() }
    size()
    if (still) draw(); else raf = requestAnimationFrame(loop)
    window.addEventListener('resize', onSize)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onSize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [effects, theme])

  return <canvas ref={ref} className="no-print pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
}
