import { useState, type MouseEvent, type ReactNode } from 'react'
import { CheckCircle2, Clock, Eye, EyeOff, Keyboard, LogOut, Mic, Moon, Palette, PlugZap, ShieldCheck, Sun, Volume2 } from 'lucide-react'
import { useApp, type Effects } from '@/store/app'
import { PROVIDERS, VOICE_LANGUAGES, resolveProvider } from '@/voice/gateway'
import { ROUTES } from '@/voice/commands'
import { cx, KeyHint, Note, PageHeader, Panel } from '@/ui/kit'

const EFFECTS: { key: Effects; label: string; text: string }[] = [
  { key: 'full', label: 'Full', text: 'Every effect: the ambient backdrop at full density, moving light on panels, flowing particles on the money map, the cockpit scan line and figures that count up.' },
  { key: 'subtle', label: 'Subtle', text: 'A sparser backdrop and no flowing particles on the money map. Highlights, the cockpit scan line and figures that count up stay.' },
  { key: 'off', label: 'Off', text: 'Decorative animation is switched off: the backdrop is still, lamps do not pulse, there is no scan line and figures appear at their final value. Dialogs still slide into place.' },
]

const SHORTCUTS: { keys: string[][]; action: string }[] = [
  { keys: [['Ctrl', 'K'], ['/']], action: 'Search and commands' },
  { keys: [['Ctrl', '/']], action: 'Ask NUMI' },
  { keys: [['Alt', 'V']], action: 'Voice' },
  { keys: [['g', 'h']], action: 'Go to home' },
  { keys: [['g', 'j']], action: 'Go to journals' },
  { keys: [['g', 'l']], action: 'Go to the general ledger' },
  { keys: [['g', 'r']], action: 'Go to reports' },
  { keys: [['g', 'p']], action: 'Go to people and parties' },
  { keys: [['g', 'b']], action: 'Go to banking' },
  { keys: [['g', 'a']], action: 'Go to approvals' },
  { keys: [['g', 's']], action: 'Go to Sentinel' },
  { keys: [['g', 'e']], action: 'Go to the transaction entry centre' },
  { keys: [['g', 'c']], action: 'Go to the cockpit' },
  { keys: [['g', 'i']], action: 'Go to invoices' },
  { keys: [['n']], action: 'New journal' },
  { keys: [['Esc']], action: 'Close the open dialog or panel' },
]

const EXTRA_COMMANDS = ['dark mode', 'light mode', 'hide the numbers', 'open Jamin Bazaar', 'show the whole group', 'this quarter', 'how much cash do we have']

const IN_PLACE = [
  { title: 'Tenant isolation', text: 'Enforced inside the database by row level security, so one company\'s data cannot be read through another company\'s access.' },
  { title: 'Posted entries are immutable', text: 'A posted entry cannot be edited or deleted. Corrections are made by a reversing entry, which keeps both on record.' },
  { title: 'Audit trail is append-only', text: 'Audit records can be added but never changed or removed.' },
  { title: 'Only the publishable key is in the browser', text: 'No secret or service key is shipped to this application. Access is decided by the database for the signed-in user.' },
]
const PLANNED = ['Multi-factor authentication', 'Passkeys', 'IP restrictions', 'Scheduled encrypted backups with restore testing']

function Segmented<T extends string>({ value, options, onPick, label }: { value: T; options: { key: T; label: string; icon?: ReactNode }[]; onPick: (k: T, e: MouseEvent<HTMLButtonElement>) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label={label} style={{ width: 'fit-content' }}>
      {options.map((o) => (
        <button key={o.key} onClick={(e) => onPick(o.key, e)} aria-pressed={value === o.key}
          className={cx('flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors', value === o.key ? 'border border-line2 bg-surface2 text-ink' : 'text-muted hover:text-ink2')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

function Setting({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line py-3.5 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-[200px] max-w-md flex-1">
        <div className="text-[13.5px] text-ink">{title}</div>
        {text && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{text}</div>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  )
}

function Head({ icon, eyebrow, title }: { icon: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div><div className="eyebrow">{eyebrow}</div><div className="display mt-0.5 text-[15px]">{title}</div></div>
      <span className="text-gold">{icon}</span>
    </div>
  )
}

export default function Settings() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const uiMode = useApp((s) => s.uiMode)
  const setUiMode = useApp((s) => s.setUiMode)
  const simple = useApp((s) => s.simple)
  const setSimple = useApp((s) => s.setSimple)
  const effects = useApp((s) => s.effects)
  const setEffects = useApp((s) => s.setEffects)
  const privacy = useApp((s) => s.privacy)
  const setPrivacy = useApp((s) => s.setPrivacy)
  const voiceLang = useApp((s) => s.voiceLang)
  const voiceReplies = useApp((s) => s.voiceReplies)
  const setVoice = useApp((s) => s.setVoice)
  const mode = useApp((s) => s.mode)
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const [leaving, setLeaving] = useState(false)
  const [tested, setTested] = useState<string | null>(null)

  const resolved = resolveProvider('browser')
  const canSpeak = resolved.provider !== null && typeof window !== 'undefined' && 'speechSynthesis' in window
  const language = VOICE_LANGUAGES.find((l) => l.code === voiceLang)?.label ?? voiceLang
  const commands = [...ROUTES.map((r) => `open ${r.label}`), ...EXTRA_COMMANDS]

  const testVoice = () => {
    if (!resolved.provider) return
    resolved.provider.speak('This is NUMERO. Voice replies are working.', voiceLang)
    setTested(`Spoken with ${resolved.provider.name} in ${language}. If you heard nothing, check the device volume and whether this browser has a voice installed for that language.`)
  }
  const leave = async () => {
    setLeaving(true)
    try { await useApp.getState().leave() } finally { setLeaving(false) }
  }

  return (
    <div>
      <PageHeader eyebrow="Preferences" title="Settings" subtitle="Appearance, voice and keyboard preferences are stored on this device. Group-wide controls are under Genesis Builder." />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {/* appearance */}
        <Panel className="p-5" lit={false}>
          <Head icon={<Palette size={17} />} eyebrow="Appearance" title="How NUMERO looks and moves" />
          <Setting title="Theme" text="Dark graphite or a light workspace.">
            <Segmented label="Theme" value={theme} onPick={(k, e) => setTheme(k, { x: e.clientX, y: e.clientY })}
              options={[{ key: 'dark', label: 'Dark', icon: <Moon size={13} /> }, { key: 'light', label: 'Light', icon: <Sun size={13} /> }]} />
          </Setting>
          <Setting title="Interface mode" text="Command opens on the command centre. Accounting opens on journals and uses denser tables.">
            <Segmented label="Interface mode" value={uiMode} onPick={(k) => setUiMode(k)} options={[{ key: 'command', label: 'Command' }, { key: 'accounting', label: 'Accounting' }]} />
          </Setting>
          <Setting title="Presentation" text="Simple uses everyday words such as “Money in”. Professional uses accounting terms such as “Total revenue”. The figures are the same.">
            <Segmented label="Presentation" value={simple ? 'simple' : 'professional'} onPick={(k) => setSimple(k === 'simple')} options={[{ key: 'simple', label: 'Simple' }, { key: 'professional', label: 'Professional' }]} />
          </Setting>
          <Setting title="Effects" text={<>{EFFECTS.map((e) => <span key={e.key} className={cx('mt-1 block', e.key === effects && 'text-ink2')}><span className="font-medium">{e.label}.</span> {e.text}</span>)}</>}>
            <Segmented label="Effects" value={effects} onPick={(k) => setEffects(k)} options={EFFECTS.map((e) => ({ key: e.key, label: e.label }))} />
          </Setting>
          <Setting title="Privacy mode" text="Hides every amount on screen, for use when someone can see your display. It lasts until you switch it off or reload, and does not change what is exported.">
            <button className={cx('btn', privacy && 'good')} aria-pressed={privacy} onClick={() => setPrivacy(!privacy)}>{privacy ? <EyeOff size={14} /> : <Eye size={14} />}{privacy ? 'Figures hidden' : 'Figures visible'}</button>
          </Setting>
        </Panel>

        {/* voice */}
        <Panel className="p-5" lit={false}>
          <Head icon={<Mic size={17} />} eyebrow="Voice" title="Speaking to NUMERO" />
          <div className="mb-3 space-y-2">
            {PROVIDERS.map((p) => {
              const reason = p.unavailableReason()
              const active = resolved.provider?.id === p.id
              return (
                <div key={p.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <span className={cx('lamp mt-[7px]', reason ? 'warn' : 'pos')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">{p.name}{active && <span className="chip gold">in use</span>}<span className={cx('chip', reason ? 'warn' : 'pos')}>{reason ? 'unavailable' : 'available'}</span></div>
                    {reason && <div className="mt-0.5 text-[12px] text-muted">{reason}</div>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mb-1 text-[12px] text-muted">
            {resolved.provider
              ? <>Voice uses <span className="text-ink2">{resolved.provider.name}</span>.{resolved.fellBack && resolved.reason ? <> The preferred engine is unavailable: {resolved.reason}</> : null}</>
              : <>No voice engine can be used on this device. {resolved.reason}</>}
          </div>
          <Setting title="Language" text="The language NUMERO listens for and replies in.">
            <select className="field sm" style={{ width: 220 }} value={voiceLang} onChange={(e) => setVoice(e.target.value, voiceReplies)} aria-label="Voice language">
              {VOICE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Setting>
          <Setting title="Spoken replies" text="When on, NUMERO reads its short replies aloud.">
            <button className={cx('btn', voiceReplies && 'good')} aria-pressed={voiceReplies} onClick={() => setVoice(voiceLang, !voiceReplies)}><Volume2 size={14} />{voiceReplies ? 'On' : 'Off'}</button>
          </Setting>
          <Setting title="Test voice" text={tested ?? (canSpeak ? 'Speaks one short sentence in the selected language.' : 'This device has no speech output available to the browser.')}>
            <button className="btn" disabled={!canSpeak} onClick={testVoice}><Volume2 size={14} /> Test voice</button>
          </Setting>
          <div className="mt-4">
            <div className="eyebrow mb-2">Things you can say</div>
            <div className="flex max-h-[168px] flex-wrap gap-1.5 overflow-auto">
              {commands.map((c) => <span key={c} className="rounded-full border border-line bg-surface px-2.5 py-[3px] text-[11.5px] text-ink2">“{c}”</span>)}
            </div>
          </div>
          <Note kind="warn" className="mt-4">Voice can navigate, answer questions and prepare drafts. It can never approve, post, or move money — those always need your own confirmation on screen. Voice identity is not treated as authentication.</Note>
        </Panel>

        {/* shortcuts */}
        <Panel className="overflow-hidden" lit={false}>
          <div className="px-5 pt-5"><Head icon={<Keyboard size={17} />} eyebrow="Keyboard shortcuts" title="Work without the mouse" /></div>
          <table className="table">
            <thead><tr><th style={{ width: 210 }}>Keys</th><th>Action</th></tr></thead>
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.action}>
                  <td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {s.keys.map((combo, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="px-1 text-[11px] text-muted">or</span>}
                          {combo.map((k, j) => <span key={k + j} className="flex items-center gap-1">{j > 0 && <span className="text-[11px] text-muted">{combo[0] === 'g' ? 'then' : '+'}</span>}<KeyHint>{k}</KeyHint></span>)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="text-ink2">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line px-5 py-2.5 text-[11.5px] text-muted">Single-letter shortcuts are ignored while you are typing in a field.</div>
        </Panel>

        <div className="space-y-4">
          {/* connection */}
          <Panel className="p-5" lit={false}>
            <Head icon={<PlugZap size={17} />} eyebrow="Connection" title="Where your data comes from" />
            <div className="rounded-xl border border-line">
              {([
                ['Mode', mode === 'demo' ? <span key="m" className="chip gold">Demo universe</span> : mode === 'live' ? <span key="m" className="chip pos">Live books</span> : <span key="m" className="text-muted">Not connected</span>],
                ['Signed in as', session ? <span key="u">{session.user.name || session.user.email}<span className="text-muted"> · {session.user.email}</span></span> : <span key="u" className="text-muted">Nobody</span>],
                ['Group', session?.group?.name ?? <span key="g" className="text-muted">No group</span>],
                ['Group currency', session?.group ? <span key="c" className="num">{session.group.base_currency}</span> : <span key="c" className="text-muted">—</span>],
                ['Companies you can see', <span key="n" className="num">{companies.length}</span>],
                ['Access level', session?.isGroupAdmin ? 'Group administrator' : 'By company role'],
              ] as [string, ReactNode][]).map(([l, v]) => (
                <div key={l} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-[13px] last:border-0"><span className="text-ink2">{l}</span><span className="text-right text-ink">{v}</span></div>
              ))}
            </div>
            {mode === 'demo' && <Note kind="demo" className="mt-3">The demo universe is sample data held in this browser. None of its figures are real company figures, and changes are lost when the page is reloaded.</Note>}
            <button className="btn danger mt-4" disabled={leaving} onClick={() => void leave()}><LogOut size={14} /> {mode === 'demo' ? 'Leave the demo universe' : 'Sign out and leave'}</button>
          </Panel>

          {/* security posture */}
          <Panel className="p-5" lit={false}>
            <Head icon={<ShieldCheck size={17} />} eyebrow="Security posture" title="What protects the live books" />
            {mode === 'demo' && <div className="mb-3 text-[12px] text-muted">These protections belong to the live database. The demo universe runs in this browser and applies the same accounting rules, without a database behind it.</div>}
            <div className="eyebrow mb-2">In place</div>
            <div className="space-y-2">
              {IN_PLACE.map((f) => (
                <div key={f.title} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <CheckCircle2 size={15} className="mt-[3px] flex-none text-pos" />
                  <div className="min-w-0"><div className="text-[13px] text-ink">{f.title}</div><div className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.text}</div></div>
                </div>
              ))}
            </div>
            <div className="eyebrow mb-2 mt-4">Not yet configured</div>
            <div className="space-y-2">
              {PLANNED.map((t) => (
                <div key={t} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <Clock size={15} className="flex-none text-warn" />
                  <div className="min-w-0 flex-1 text-[13px] text-ink2">{t}</div>
                  <span className="chip warn">planned</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11.5px] text-muted">Planned items are not active today. Each is tracked in the requirement ledger.</div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
