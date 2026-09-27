import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, MicOff, ShieldCheck, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { cx, Portal } from '@/ui/kit'
import { interpret, type Interpreted } from './commands'
import { resolveProvider } from './gateway'

/** Executes an interpreted command. Shared by voice and the command palette. */
export function useCommandRunner() {
  const nav = useNavigate()
  return useCallback((text: string, channel: 'voice' | 'text'): Interpreted => {
    const s = useApp.getState()
    const r = interpret(text, s.companies)
    const c = r.command
    switch (c.type) {
      case 'navigate': nav(c.to); break
      case 'sensitive': nav(c.to); break // opens the screen only; the human must act
      case 'company': s.setScope(c.companyId ? [c.companyId] : []); nav('/'); break
      case 'theme': s.setTheme(c.theme === 'toggle' ? (s.theme === 'dark' ? 'light' : 'dark') : c.theme); break
      case 'privacy': s.setPrivacy(c.on); break
      case 'uimode': s.setUiMode(c.mode); break
      case 'period': s.setPeriod(c.key); break
      case 'ask': s.askNumi(c.question); break
      case 'entry': nav('/entry?text=' + encodeURIComponent(c.text)); break
      case 'back': nav(-1); break
      case 'help': case 'stop': case 'unknown': break
    }
    if (channel === 'voice') {
      void s.api?.logVoice({
        provider: 'browser', language: s.voiceLang, transcript: text, intent: r.intent, action: c.type,
        required_confirmation: r.sensitive, confirmed: r.sensitive ? false : undefined,
        result: r.sensitive ? 'not executed — human confirmation required' : c.type === 'unknown' ? 'not understood' : 'done',
      }).catch(() => undefined)
    }
    return r
  }, [nav])
}

type Phase = 'idle' | 'listening' | 'done' | 'error'

export function VoiceOrb() {
  const lang = useApp((s) => s.voiceLang)
  const replies = useApp((s) => s.voiceReplies)
  const run = useCommandRunner()
  const [phase, setPhase] = useState<Phase>('idle')
  const [heard, setHeard] = useState('')
  const [result, setResult] = useState<Interpreted | null>(null)
  const [error, setError] = useState('')
  const timer = useRef<number | null>(null)
  const provider = useRef(resolveProvider('browser'))

  const hideLater = (ms: number) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase('idle'), ms)
  }
  const stop = useCallback(() => { provider.current.provider?.stop(); provider.current.provider?.cancelSpeech(); setPhase('idle') }, [])

  const start = useCallback(() => {
    const p = provider.current.provider
    if (timer.current) window.clearTimeout(timer.current)
    setHeard(''); setResult(null); setError('')
    if (!p) { setError(provider.current.reason ?? 'Voice is not available in this browser.'); setPhase('error'); hideLater(7000); return }
    p.cancelSpeech()
    setPhase('listening')
    let got = false
    p.listen(lang, {
      onInterim: (t) => setHeard(t),
      onFinal: (t) => {
        got = true
        setHeard(t)
        const r = run(t, 'voice')
        setResult(r)
        setPhase('done')
        if (r.command.type === 'stop') { setPhase('idle'); return }
        if (replies && r.command.type !== 'ask') p.speak(r.reply, lang)
        hideLater(r.sensitive ? 9000 : 4200)
      },
      onError: (m) => { got = true; setError(m); setPhase('error'); hideLater(7000) },
      onEnd: () => { if (!got) setPhase('idle') },
    })
  }, [lang, replies, run])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); if (phase === 'listening') stop(); else start() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [phase, start, stop])
  useEffect(() => () => { provider.current.provider?.stop(); if (timer.current) window.clearTimeout(timer.current) }, [])

  const unavailable = !provider.current.provider
  return (
    <>
      <button className={cx('orb', phase === 'listening' && 'live')} onClick={() => (phase === 'listening' ? stop() : start())}
        aria-label={phase === 'listening' ? 'Stop listening' : 'Voice command'} aria-pressed={phase === 'listening'}
        title={unavailable ? provider.current.reason ?? 'Voice unavailable' : 'Voice command (Alt + V). Say “Numero, show the balance sheet”.'}>
        {unavailable ? <MicOff size={16} className="text-muted" /> : <Mic size={16} />}
      </button>
      <Portal>
      <AnimatePresence>
        {phase !== 'idle' && (
          <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="panel no-print fixed bottom-7 left-1/2 z-[80] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 px-5 py-4" style={{ background: 'var(--surface-solid)', boxShadow: 'var(--shadow), 0 0 60px -20px var(--cyan)' }}>
            <div className="flex items-center gap-3">
              {phase === 'listening' ? <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span> : <span className={cx('lamp', phase === 'error' ? 'neg' : result?.sensitive ? 'warn' : 'pos')} />}
              <div className="eyebrow flex-1">{phase === 'listening' ? 'Listening…' : phase === 'error' ? 'Voice' : result?.sensitive ? 'Confirmation required' : 'Understood'}</div>
              <button className="btn ghost icon sm" onClick={stop} aria-label="Dismiss"><X size={14} /></button>
            </div>
            <div className="mt-2 min-h-[26px] text-[17px] leading-snug text-ink">
              {phase === 'error' ? <span className="text-[14px] text-ink2">{error}</span> : heard ? <>“{heard}”</> : <span className="text-muted">Say “Numero, how much cash do we have?”</span>}
            </div>
            {result && phase === 'done' && (
              <div className={cx('mt-2.5 flex items-start gap-2 text-[13px]', result.sensitive ? 'text-warn' : 'text-ink2')}>
                {result.sensitive && <ShieldCheck size={15} className="mt-[2px] flex-none" />}
                <span>{result.reply}</span>
              </div>
            )}
            {provider.current.fellBack && <div className="mt-2 text-[11.5px] text-muted">Using the browser speech engine as fallback.</div>}
          </motion.div>
        )}
      </AnimatePresence>
      </Portal>
    </>
  )
}
