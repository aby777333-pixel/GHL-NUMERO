import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, CornerDownLeft, Link2, Mic, MicOff, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { can, useApp, useCurrency, usePeriod, useScopeIds, capOn } from '@/store/app'
import { fmtMoney } from '@/lib/money'
import { cx, Money, Portal, Spinner, Truth } from '@/ui/kit'
import { askNumi, contextualPrompts, type NumiAnswer } from './engine'
import { resolveProvider } from '@/voice/gateway'

interface Turn { id: number; question: string; answer?: NumiAnswer; error?: string }

export function NumiPanel() {
  useApp((s) => s.flags)
  // a capability switched off is off wherever it is reached from: a report's "ask NUMI" button included
  const open = useApp((s) => s.numiOpen) && capOn('numi')
  const seed = useApp((s) => s.numiSeed)
  const close = useApp((s) => s.closeNumi)
  const api = useApp((s) => s.api)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const privacy = useApp((s) => s.privacy)
  const replies = useApp((s) => s.voiceReplies)
  const lang = useApp((s) => s.voiceLang)
  const scopeIds = useScopeIds()
  const period = usePeriod()
  const currency = useCurrency()
  const loc = useLocation()
  const nav = useNavigate()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const seq = useRef(0)
  const lastSeed = useRef<string | null>(null)
  // a question can be spoken: the words appear in the box as they are heard, and the question is asked when the speaker stops
  const voice = useRef(resolveProvider('browser'))
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')

  const ask = useCallback(async (q: string, channel: 'text' | 'voice' = 'text') => {
    const question = q.trim()
    if (!question || !api) return
    const id = ++seq.current
    setTurns((t) => [...t, { id, question }])
    setText('')
    setBusy(true)
    try {
      const answer = await askNumi(question, {
        api, companies, accounts, parties, scopeIds, period, screen: loc.pathname,
        money: (v, compact = true) => fmtMoney(v, { currency, compact, mask: privacy }),
        can,
      })
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)))
      void api.logNumi({ channel, question, intent: answer.intent, answer: answer.headline, evidence: answer.evidence, screen: loc.pathname }).catch(() => undefined)
      if (replies && (channel === 'voice' || lastSeed.current === question) && 'speechSynthesis' in window && !privacy) {
        const u = new SpeechSynthesisUtterance(answer.speak); u.lang = lang
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u)
      }
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)))
    } finally {
      setBusy(false)
    }
  }, [api, companies, accounts, parties, scopeIds, period, loc.pathname, currency, privacy, replies, lang])

  useEffect(() => {
    if (open && seed && seed !== lastSeed.current) { lastSeed.current = seed; void ask(seed) }
    if (!open) lastSeed.current = null
    if (open) setTimeout(() => input.current?.focus(), 120)
  }, [open, seed, ask])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])

  const stopListening = useCallback(() => { voice.current.provider?.stop(); setListening(false) }, [])
  const listen = useCallback(() => {
    const p = voice.current.provider
    setVoiceError('')
    if (!p) { setVoiceError(voice.current.reason ?? 'Voice is not available in this browser.'); return }
    if (listening) { stopListening(); return }
    p.cancelSpeech()
    setListening(true)
    p.listen(lang, {
      onInterim: (t) => setText(t),
      onFinal: (t) => { setText(t); setListening(false); if (t.trim()) void ask(t, 'voice') },
      onError: (m) => { setVoiceError(m); setListening(false) },
      onEnd: () => setListening(false),
    })
  }, [lang, listening, ask, stopListening])
  // closing NUMI stops the microphone
  useEffect(() => { if (!open) stopListening() }, [open, stopListening])
  useEffect(() => () => { voice.current.provider?.stop() }, [])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, close])

  const go = (to: string) => { nav(to); close() }
  const prompts = contextualPrompts(loc.pathname)

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <motion.div className="no-print fixed inset-0 z-[65]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} />
          <motion.aside role="dialog" aria-label="Ask NUMI" className="absolute bottom-0 right-0 top-0 flex w-[520px] max-w-full flex-col border-l border-line"
            style={{ background: 'var(--surface-solid)', boxShadow: '-40px 0 90px -50px var(--gold)', paddingTop: 'env(safe-area-inset-top)' }}
            initial={{ x: 60, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-gold/30 bg-goldsoft text-gold"><Sparkles size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="display text-[15.5px] font-medium">NUMI</div>
                <div className="truncate text-[11.5px] text-muted">Answers from your authorised books · every figure links to its source</div>
              </div>
              <button className="btn ghost icon sm" onClick={close} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {!turns.length && (
                <div className="fade-up">
                  <div className="display text-[19px] leading-snug">Ask anything about your financial universe.</div>
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] text-ink2">
                    <ShieldCheck size={15} className="mt-[1px] flex-none text-pos" />
                    <span>NUMI sees only what you are permitted to see, answers only from recorded data, and never posts entries, approves anything or moves money.</span>
                  </div>
                  <div className="eyebrow mb-2 mt-5">Suggested for this screen</div>
                  <div className="flex flex-col gap-1.5">
                    {prompts.map((p) => (
                      <button key={p} className="group flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[13px] text-ink2 transition-all hover:border-gold/40 hover:bg-goldsoft hover:text-ink" onClick={() => void ask(p)}>
                        {p}<ArrowUpRight size={14} className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((t) => (
                <div key={t.id} className="mb-6">
                  <div className="mb-3 flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-gold/25 bg-goldsoft px-3.5 py-2 text-[13.5px]">{t.question}</div>
                  </div>
                  {!t.answer && !t.error && <div className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner size={14} /> Reading the books…</div>}
                  {t.error && <div className="rounded-xl border border-neg/30 bg-negsoft px-3.5 py-2.5 text-[13px] text-ink2">I could not complete that: {t.error}</div>}
                  {t.answer && <Answer a={t.answer} go={go} ask={(q) => void ask(q)} />}
                </div>
              ))}
              <div ref={end} />
            </div>

            <form className="border-t border-line p-3.5" style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }} onSubmit={(e) => { e.preventDefault(); if (listening) stopListening(); void ask(text) }}>
              {(listening || voiceError) && (
                <div role="status" aria-live="polite" className={cx('mb-2 flex items-center gap-2 text-[12px]', voiceError ? 'text-warn' : 'text-cyan')}>
                  {listening ? <><span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span> Listening… ask your question, NUMI answers when you stop.</> : voiceError}
                </div>
              )}
              <div className="relative">
                <textarea ref={input} className="field pr-[84px]" rows={2} value={text} placeholder={listening ? 'Listening…' : 'Ask anything, or tap the microphone and speak…'} aria-label="Your question"
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
                <button type="button" className={cx('btn icon sm absolute bottom-2.5 right-[46px]', listening ? 'primary' : 'ghost')} onClick={listen} disabled={busy}
                  aria-label={listening ? 'Stop listening' : 'Ask by voice'} aria-pressed={listening}
                  title={!voice.current.provider ? voice.current.reason ?? 'Voice is not available in this browser' : listening ? 'Stop listening' : 'Ask by voice'}>
                  {listening ? <Square size={12} /> : voice.current.provider ? <Mic size={15} /> : <MicOff size={15} className="text-muted" />}
                </button>
                <button type="submit" className="btn primary icon sm absolute bottom-2.5 right-2.5" disabled={busy || !text.trim()} aria-label="Ask">{busy ? <Spinner size={14} /> : <CornerDownLeft size={14} />}</button>
              </div>
            </form>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
    </Portal>
  )
}

function Answer({ a, go, ask }: { a: NumiAnswer; go: (to: string) => void; ask: (q: string) => void }) {
  const basisCls = a.basis === 'FACT' ? 'pos' : a.basis === 'INFERENCE' ? 'warn' : 'violet'
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={cx('chip', basisCls)} title="FACT: read directly from recorded data. INFERENCE: derived by comparison. SUGGESTION: an idea for you to consider.">{a.basis}</span>
        <Truth state={a.truth} />
        <span className="truncate text-[11px] text-muted">{a.scope}</span>
      </div>
      <div className="display text-[16px] leading-snug text-ink">{a.headline}</div>
      {a.narrative && <div className="mt-2 text-[13px] leading-relaxed text-ink2">{a.narrative}</div>}

      {a.facts.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {a.facts.map((f, i) => (
            <div key={i} onClick={f.to ? () => go(f.to!) : undefined} role={f.to ? 'button' : undefined} tabIndex={f.to ? 0 : undefined}
              onKeyDown={f.to ? (e) => { if (e.key === 'Enter') go(f.to!) } : undefined}
              className={cx('flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5 last:border-0', f.to && 'cursor-pointer transition-colors hover:bg-goldsoft')}>
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{f.label}</div>
                {(f.note || (f.text && f.amount !== undefined)) && <div className="mt-0.5 text-[11.5px] text-muted">{f.note}</div>}
                {f.text && f.amount === undefined && <div className="mt-0.5 text-[12px] leading-snug text-ink2">{f.text}</div>}
              </div>
              <div className="flex flex-none items-center gap-2">
                {f.amount !== undefined && <Money value={f.amount} compact className={cx('text-[13.5px]', f.tone === 'neg' && 'text-neg', f.tone === 'pos' && 'text-pos', f.tone === 'warn' && 'text-warn')} />}
                {f.to && <ArrowUpRight size={13} className="text-muted" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {a.assumptions.length > 0 && (
        <ul className="mt-3 list-none space-y-1 p-0 text-[11.5px] text-muted">
          {a.assumptions.map((x, i) => <li key={i} className="flex gap-2"><span className="text-gold">•</span><span>{x}</span></li>)}
        </ul>
      )}

      {a.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.evidence.map((e) => <button key={e.to} className="btn sm" onClick={() => go(e.to)}><Link2 size={12} /> View evidence · {e.label}</button>)}
        </div>
      )}
      {a.followUps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.followUps.map((f) => <button key={f} className="rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-ink2 transition-colors hover:border-gold/40 hover:text-ink" onClick={() => ask(f)}>{f}</button>)}
        </div>
      )}
    </motion.div>
  )
}
