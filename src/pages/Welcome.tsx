import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Building2, Eye, EyeOff, KeyRound, Lock, LogOut, Mail, Mic, ShieldCheck, Sparkles } from 'lucide-react'
import { useApp } from '@/store/app'
import { liveConfigured } from '@/api/supabase'
import { friendlyAuthError, resendConfirmation, sendPasswordReset, setNewPassword } from '@/api/auth'
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
  const authMessage = useApp((s) => s.authMessage)
  // an expired password link lands on "Forgot password", so that a new one can be asked for at once
  const [tab, setTab] = useState<'in' | 'up' | 'forgot'>(() => (useApp.getState().authMessage && /link/i.test(useApp.getState().authMessage ?? '') ? 'forgot' : 'in'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'' | 'auth' | 'demo'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const pick = (t: 'in' | 'up' | 'forgot') => { setTab(t); setError(''); setNotice(''); setUnconfirmed(false); if (useApp.getState().authMessage) useApp.setState({ authMessage: null }) }

  const demo = async () => {
    setBusy('demo'); setError('')
    try { await enterDemo() } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy('') }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('auth'); setError(''); setNotice(''); setUnconfirmed(false)
    if (tab === 'forgot') {
      try {
        await sendPasswordReset(email.trim())
        setNotice(`If an account exists for ${email.trim()}, a link to set a new password has been sent to it. Open the link on this device; it brings you back here. Look in the spam folder if it does not arrive within a few minutes.`)
      } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
      finally { setBusy('') }
      return
    }
    try {
      await enterLive()
      const api = useApp.getState().api!
      if (tab === 'up') {
        if (password.length < 10) throw new Error('Use a password of at least 10 characters.')
        const r = await api.signUp(email.trim(), password, name.trim() || email.split('@')[0])
        if (r.needsEmailConfirmation) { setNotice(`Account created. A confirmation link has been sent to ${email.trim()}. Open it on this device: it confirms the address and signs you in. Look in the spam folder if it does not arrive within a few minutes.`); setTab('in'); setBusy(''); useApp.setState({ status: 'signed_out' }); return }
      } else {
        await api.signIn(email.trim(), password)
      }
      await useApp.getState().refreshSession()
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err)
      setUnconfirmed(/email not confirmed/i.test(said))
      setError(friendlyAuthError(said))
      useApp.setState({ status: 'signed_out' })
    } finally {
      setBusy('')
    }
  }

  const resend = async () => {
    setBusy('auth'); setError('')
    try { await resendConfirmation(email.trim()); setUnconfirmed(false); setNotice(`The confirmation link has been sent again to ${email.trim()}.`) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy('') }
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
                {tab === 'forgot' ? (
                  <div className="mb-4">
                    <button type="button" className="btn sm ghost -ml-2" onClick={() => pick('in')}><ArrowLeft size={14} /> Back to sign in</button>
                    <div className="display mt-2 text-[17px] font-medium text-ink">Set a new password</div>
                    <div className="mt-1 text-[12.5px] leading-relaxed text-muted">Enter the email address of your account. A link to set a new password will be sent to it.</div>
                  </div>
                ) : (
                  <div className="mb-4 flex rounded-xl border border-line bg-surface p-1" role="tablist">
                    {(['in', 'up'] as const).map((t) => (
                      <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={cx('h-9 flex-1 rounded-lg text-[12.5px] font-medium transition-colors', tab === t ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{t === 'in' ? 'Sign in' : 'Create account'}</button>
                    ))}
                  </div>
                )}
                {authMessage && !error && !notice && <Note kind="warn" className="mb-3.5">{authMessage}</Note>}
                <form onSubmit={submit} className="space-y-3.5">
                  {tab === 'up' && <Field label="Full name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
                  <Field label="Email"><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
                  {tab !== 'forgot' && (
                    <Field label="Password" hint={tab === 'up' ? 'At least 10 characters.' : undefined}>
                      <div className="relative">
                        <input className="field pr-10" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'up' ? 'new-password' : 'current-password'} required />
                        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" style={{ border: 0, background: 'none' }} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                      </div>
                    </Field>
                  )}
                  {tab === 'in' && <div className="-mt-1 text-right"><button type="button" className="link text-[12px]" onClick={() => pick('forgot')}>Forgot password?</button></div>}
                  {error && <Note kind="warn">{error}</Note>}
                  {unconfirmed && <button type="button" className="btn sm w-full" disabled={busy !== '' || !email.trim()} onClick={() => void resend()}><Mail size={14} /> Send the confirmation email again</button>}
                  {notice && <Note kind="good">{notice}</Note>}
                  <button className="btn primary h-11 w-full" disabled={busy !== ''}>{busy === 'auth' ? <Spinner /> : tab === 'forgot' ? <Mail size={15} /> : <Lock size={15} />}{tab === 'in' ? 'Enter NUMERO' : tab === 'up' ? 'Create account' : 'Send the link'}</button>
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

/** Shown after a person came back through a password link: they are signed in, and set their new password here. */
export function SetPassword() {
  const session = useApp((s) => s.session)
  const leave = useApp((s) => s.leave)
  const endRecovery = useApp((s) => s.endRecovery)
  const toast = useApp((s) => s.toast)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problem = password.length < 10 ? 'Use a password of at least 10 characters.' : password !== again ? 'The two passwords are not the same.' : ''
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    try {
      await setNewPassword(password)
      endRecovery()
      toast('ok', 'Your new password is set', 'Use it the next time you sign in.')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return (
    <div className="relative z-10 grid h-full place-items-center overflow-auto px-5 py-10">
      <div className="w-full max-w-[460px]">
        <div className="mb-6 flex items-center gap-4">
          <Logo size={48} animate />
          <div>
            <div className="eyebrow">Secure access</div>
            <h1 className="display m-0 text-[24px] font-medium">Set a new password</h1>
          </div>
        </div>
        <Panel className="p-6" hud>
          <p className="mt-0 text-[13px] leading-relaxed text-ink2">For <b className="text-ink">{session?.user.email}</b>. The link you opened signed you in for this purpose only; choose the password you will use from now on.</p>
          <form onSubmit={save} className="mt-4 space-y-3.5">
            <Field label="New password" hint="At least 10 characters.">
              <div className="relative">
                <input className="field pr-10" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" style={{ border: 0, background: 'none' }} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </Field>
            <Field label="The same password again"><input className="field" type={show ? 'text' : 'password'} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></Field>
            {error && <Note kind="warn">{error}</Note>}
            <button className="btn primary h-11 w-full" disabled={busy}>{busy ? <Spinner /> : <KeyRound size={15} />} Save the new password</button>
          </form>
          <div className="mt-4 text-center"><button className="btn sm ghost" onClick={() => void leave()}><LogOut size={14} /> Sign out without changing it</button></div>
        </Panel>
      </div>
    </div>
  )
}
