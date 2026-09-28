import { useState } from 'react'
import { motion } from 'framer-motion'
import { LogOut, ShieldCheck, Users } from 'lucide-react'
import { useApp } from '@/store/app'
import { cx, Field, Logo, Note, Panel, Spinner } from '@/ui/kit'

/** First-run initialisation of the financial universe by its owner (spec 2, 66). */
export default function Onboarding() {
  const api = useApp((s) => s.api)
  const session = useApp((s) => s.session)
  const leave = useApp((s) => s.leave)
  const refresh = useApp((s) => s.refreshSession)
  const [name, setName] = useState('GHL Group')
  const [currency, setCurrency] = useState('INR')
  const [mc, setMc] = useState<'enforced' | 'owner_override' | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!api || !mc) return
    setBusy(true); setError('')
    try { await api.bootstrapGroup(name.trim(), currency, mc); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  const options = [
    { key: 'enforced' as const, icon: <Users size={17} />, title: 'Enforce maker-checker for everyone', body: 'Nobody — including you — can approve what they created. Recommended once at least two people use NUMERO.' },
    { key: 'owner_override' as const, icon: <ShieldCheck size={17} />, title: 'Allow Owner self-approval', body: 'Only the Group Super Admin may approve their own entries. Each such approval is recorded in the audit trail as an override. Everyone else remains subject to maker-checker.' },
  ]

  return (
    <div className="relative z-10 grid h-full place-items-center overflow-auto px-5 py-10">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="w-full max-w-[640px]">
        <div className="mb-6 flex items-center gap-4">
          <Logo size={52} animate />
          <div>
            <div className="eyebrow">Initialise</div>
            <h1 className="display m-0 text-[26px] font-medium">Create your financial universe</h1>
          </div>
        </div>
        <Panel className="p-6" hud>
          <p className="mt-0 text-[13.5px] leading-relaxed text-ink2">
            You are signed in as <b className="text-ink">{session?.user.email}</b>. The person who completes this step becomes the <b className="text-gold">Group Super Admin</b>. This can be done once.
          </p>
          <p className="mb-0 mt-2 text-[12.5px] leading-relaxed text-muted">
            Only the owner's email address can complete it. If NUMERO is already set up, this step is not for you: ask the Group Super Admin to add you under Team &amp; Access, then sign in again.
          </p>
          <form onSubmit={go} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Group name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
              <Field label="Group currency">
                <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div>
              <div className="label">Approval control — choose explicitly</div>
              <div className="grid gap-2.5">
                {options.map((o) => (
                  <button type="button" key={o.key} onClick={() => setMc(o.key)} aria-pressed={mc === o.key}
                    className={cx('flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all', mc === o.key ? 'border-gold/60 bg-goldsoft' : 'border-line bg-surface hover:border-line2')}>
                    <span className={cx('mt-0.5', mc === o.key ? 'text-gold' : 'text-muted')}>{o.icon}</span>
                    <span><span className="block text-[13.5px] font-medium text-ink">{o.title}</span><span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{o.body}</span></span>
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[11.5px] text-muted">You can change this later in Settings. The change itself is audited.</div>
            </div>
            {error && <Note kind="warn">{error}</Note>}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button type="button" className="btn ghost" onClick={() => void leave()}><LogOut size={15} /> Sign out</button>
              <button className="btn primary h-11 px-6" disabled={busy || !mc || !name.trim()}>{busy && <Spinner />} Initialise NUMERO</button>
            </div>
          </form>
        </Panel>
      </motion.div>
    </div>
  )
}

export function NoAccess() {
  const leave = useApp((s) => s.leave)
  const session = useApp((s) => s.session)
  return (
    <div className="relative z-10 grid h-full place-items-center px-5">
      <Panel className="max-w-[520px] p-7 text-center">
        <Logo size={46} className="mx-auto" />
        <h1 className="display mt-4 text-[20px] font-medium">No company has been shared with you yet</h1>
        <p className="text-[13.5px] leading-relaxed text-ink2">Your account <b>{session?.user.email}</b> is active, but the Group Super Admin has not granted it access to any company. Ask them to add you under Team &amp; Access.</p>
        <button className="btn mt-2" onClick={() => void leave()}><LogOut size={15} /> Sign out</button>
      </Panel>
    </div>
  )
}
