import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Building2, Eye, EyeOff, Lock, Mic, ShieldCheck, Sparkles } from 'lucide-react'
import { useApp } from '@/store/app'
import { liveConfigured } from '@/api/supabase'
import { cx, Field, Logo, Note, Panel, Spinner } from '@/ui/kit'

const PILLARS = [
  { icon: <Building2 size={16} />, title: 'Unlimited companies', body: 'Every entity keeps its own books. The owner sees one consolidated universe.' },
  { icon: <ShieldCheck size={16} />, title: 'Books that cannot lie', body: 'Debits always equal credits. Posted history is immutable. Every action is attributed.' },
  { icon: <Sparkles size={16} />, title: 'NUMI intelligence', body: 'Plain-language answers, each linked to the records that prove it.' },
  { icon: <Mic size={16} />, title: 'Voice navigation', body: 'Say where you want to go. Voice can never approve or move money.' },
]

export default function Welcome() {
  const enterDemo = useApp((s) => s.enterDemo)
  const enterLive = useApp((s) => s.enterLive)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const [tab, setTab] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'' | 'auth' | 'demo'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const demo = async () => {
    setBusy('demo'); setError('')
    try { await enterDemo() } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy('') }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('auth'); setError(''); setNotice('')
    try {
      await enterLive()
      const api = useApp.getState().api!
      if (tab === 'up') {
        if (password.length < 10) throw new Error('Use a password of at least 10 characters.')
        const r = await api.signUp(email.trim(), password, name.trim() || email.split('@')[0])
        if (r.needsEmailConfirmation) { setNotice('Account created. Open the confirmation link sent to your email, then sign in here.'); setTab('in'); setBusy(''); useApp.setState({ status: 'signed_out' }); return }
      } else {
        await api.signIn(email.trim(), password)
      }
      await useApp.getState().refreshSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      useApp.setState({ status: 'signed_out' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="relative z-10 h-full overflow-auto">
      <div className="mx-auto grid min-h-full max-w-[1240px] items-center gap-10 px-6 py-10 lg:grid-cols-[1.15fr_0.85fr]">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}>
          <div className="flex items-center gap-4">
            <Logo size={62} animate />
            <div>
              <div className="wordmark text-[22px]"><span className="text-ink2">GHL</span> <span className="goldtext">NUMERO</span></div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.3em] text-muted">The Financial Operating System</div>
            </div>
          </div>
          <h1 className="display mt-10 text-[44px] font-light leading-[1.08] tracking-tight text-ink md:text-[54px]">
            One financial universe.<br /><span className="goldtext font-normal">Unlimited companies.</span>
          </h1>
          <p className="mt-5 max-w-[560px] text-[15.5px] leading-relaxed text-ink2">
            Where every rupee is, where it came from, where it went, who authorised it, what document supports it — and what needs attention next.
          </p>
          <div className="stagger mt-9 grid max-w-[640px] gap-3 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <Panel key={p.title} className="p-4">
                <div className="flex items-center gap-2.5 text-gold">{p.icon}<span className="text-[13px] font-medium text-ink">{p.title}</span></div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{p.body}</div>
              </Panel>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 22, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, delay: 0.12, ease: [0.2, 0.7, 0.2, 1] }}>
          <Panel className="p-6" hud>
            <div className="mb-5 flex items-center justify-between">
              <div className="eyebrow">Secure access</div>
              <button className="btn sm ghost" onClick={(e) => setTheme(theme === 'dark' ? 'light' : 'dark', { x: e.clientX, y: e.clientY })}>{theme === 'dark' ? 'Light' : 'Dark'} mode</button>
            </div>

            {liveConfigured ? (
              <>
                <div className="mb-4 flex rounded-xl border border-line bg-surface p-1">
                  {(['in', 'up'] as const).map((t) => (
                    <button key={t} onClick={() => { setTab(t); setError(''); setNotice('') }} className={cx('h-9 flex-1 rounded-lg text-[12.5px] font-medium transition-colors', tab === t ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{t === 'in' ? 'Sign in' : 'Create account'}</button>
                  ))}
                </div>
                <form onSubmit={submit} className="space-y-3.5">
                  {tab === 'up' && <Field label="Full name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
                  <Field label="Email"><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
                  <Field label="Password" hint={tab === 'up' ? 'At least 10 characters.' : undefined}>
                    <div className="relative">
                      <input className="field pr-10" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'up' ? 'new-password' : 'current-password'} required />
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" style={{ border: 0, background: 'none' }} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </div>
                  </Field>
                  {error && <Note kind="warn">{error}</Note>}
                  {notice && <Note kind="good">{notice}</Note>}
                  <button className="btn primary h-11 w-full" disabled={busy !== ''}>{busy === 'auth' ? <Spinner /> : <Lock size={15} />}{tab === 'in' ? 'Enter NUMERO' : 'Create account'}</button>
                </form>
              </>
            ) : (
              <Note kind="warn">The live database is not configured in this build. Set <span className="num">VITE_SUPABASE_URL</span> and <span className="num">VITE_SUPABASE_PUBLISHABLE_KEY</span>, then reload.</Note>
            )}

            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-muted"><span className="hairline flex-1" />or<span className="hairline flex-1" /></div>
            <button className="btn h-11 w-full" onClick={demo} disabled={busy !== ''}>
              {busy === 'demo' ? <Spinner /> : <Sparkles size={15} className="text-gold" />} Explore the demo universe <ArrowRight size={15} className="text-muted" />
            </button>
            {!liveConfigured && error && <Note kind="warn" className="mt-3">{error}</Note>}
            <div className="mt-3 text-center text-[11.5px] leading-relaxed text-muted">
              Five sample companies with a year of fictional transactions, running on the real accounting engine inside your browser. Nothing is saved.
            </div>
          </Panel>
        </motion.div>
      </div>
    </div>
  )
}
