import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Decimal from 'decimal.js'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Loader2, Minus, X } from 'lucide-react'
import { D, fmtMoney, fmtPct } from '@/lib/money'
import { useApp, useCurrency } from '@/store/app'
import type { TruthState } from '@/engine/types'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ------------------------------------------------------------------ brand
/**
 * The NUMERO mark: two ledger columns — debit and credit — joined by a rising stroke,
 * inside an orbit with a single node: one financial universe, every rupee placed.
 * It always sits on its own dark tile so it reads identically in dark and light themes.
 */
export function Logo({ size = 34, animate = false, className }: { size?: number; animate?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cx('flex-none', animate && 'draw', className)} role="img" aria-label="GHL NUMERO">
      <defs>
        <linearGradient id={`g${id}`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f6dfa6" /><stop offset=".5" stopColor="#d4af6a" /><stop offset="1" stopColor="#8e6a2c" />
        </linearGradient>
        <linearGradient id={`c${id}`} x1="20" y1="44" x2="44" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4fb8ff" /><stop offset="1" stopColor="#9be8ff" />
        </linearGradient>
        <radialGradient id={`t${id}`} cx="30%" cy="20%" r="90%">
          <stop offset="0" stopColor="#1a1f2b" /><stop offset="1" stopColor="#07080b" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="16" fill={`url(#t${id})`} stroke="rgba(216,181,111,0.35)" strokeWidth="1" />
      <circle className="d4" cx="32" cy="32" r="22.5" fill="none" stroke={`url(#g${id})`} strokeWidth="1.3" opacity=".55" />
      <path className="d1" d="M22 44V20" stroke={`url(#g${id})`} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path className="d3" d="M42 44V20" stroke={`url(#g${id})`} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path className="d2" d="M22 20L42 44" stroke={`url(#c${id})`} strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="51.5" cy="20.8" r="2.5" fill="#9be8ff">
        {animate && <animate attributeName="opacity" values="0;0;1" dur="1.9s" fill="freeze" />}
      </circle>
    </svg>
  )
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="leading-none select-none">
      <div className={cx('wordmark', small ? 'text-[12.5px]' : 'text-[15px]')}>
        <span className="text-ink2">GHL</span> <span className="goldtext">NUMERO</span>
      </div>
      {!small && <div className="mt-[7px] text-[9px] tracking-[0.26em] uppercase text-muted">The Financial Operating System</div>}
    </div>
  )
}

// ------------------------------------------------------------------ surfaces
interface PanelProps { children: ReactNode; className?: string; style?: CSSProperties; lit?: boolean; onClick?: () => void; attention?: boolean; hud?: boolean; title?: string }
export function Panel({ children, className, style, lit = true, onClick, attention, hud, title }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <div
      ref={ref} title={title} style={style} onMouseMove={lit ? move : undefined} onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      className={cx('panel', lit && 'lit', onClick && 'clickable', attention && 'attention', hud && 'hud', className)}
    >
      {children}
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, actions, truth }: { eyebrow?: string; title: string; subtitle?: ReactNode; actions?: ReactNode; truth?: TruthState }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 fade-up">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <div className="flex items-center gap-3">
          <h1 className="display m-0 text-[24px] font-medium leading-tight text-ink">{title}</h1>
          {truth && <Truth state={truth} />}
        </div>
        {subtitle && <div className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ money
interface MoneyProps { value: Decimal.Value | null | undefined; currency?: string; compact?: boolean; sign?: boolean; colored?: boolean; className?: string; decimals?: number; dim?: boolean }
export function Money({ value, currency, compact, sign, colored, className, decimals, dim }: MoneyProps) {
  const privacy = useApp((s) => s.privacy)
  const base = useCurrency()
  const d = D(value)
  const tone = colored ? (d.isZero() ? 'text-muted' : d.isNegative() ? 'text-neg' : 'text-pos') : dim && d.isZero() ? 'text-muted' : ''
  return (
    <span className={cx('num', tone, className)} title={privacy ? 'Hidden — privacy mode is on' : fmtMoney(d, { currency: currency ?? base })}>
      {fmtMoney(d, { currency: currency ?? base, compact, sign, mask: privacy, decimals })}
    </span>
  )
}

export function CountUp({ value, currency, compact = true, className }: { value: Decimal.Value; currency?: string; compact?: boolean; className?: string }) {
  const privacy = useApp((s) => s.privacy)
  const effects = useApp((s) => s.effects)
  const base = useCurrency()
  const target = D(value).toNumber()
  const [shown, setShown] = useState(effects === 'off' ? target : 0)
  const from = useRef(0)
  useEffect(() => {
    if (effects === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(target); from.current = target; return }
    const start = performance.now(), a = from.current, dur = 900
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const e = 1 - Math.pow(1 - p, 4)
      setShown(a + (target - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, effects])
  // the animated figure is cosmetic; the title always carries the exact ledger value
  return (
    <span className={cx('num', className)} title={privacy ? 'Hidden — privacy mode is on' : fmtMoney(value, { currency: currency ?? base })}>
      {fmtMoney(Math.abs(shown - target) < 0.5 ? D(value) : shown, { currency: currency ?? base, compact, mask: privacy })}
    </span>
  )
}

export function Delta({ value, invert = false, label }: { value: Decimal | null; invert?: boolean; label?: string }) {
  if (value === null) return <span className="chip" title="No comparable prior figure"><Minus size={11} /> n/a</span>
  const up = value.gt(0), flat = value.isZero()
  const good = flat ? null : invert ? !up : up
  return (
    <span className={cx('chip', good === null ? '' : good ? 'pos' : 'neg')} title={label}>
      {flat ? <Minus size={11} /> : up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {fmtPct(value.abs())}
    </span>
  )
}

// ------------------------------------------------------------------ labels
const TRUTH: Record<TruthState, { cls: string; tip: string }> = {
  ACTUAL: { cls: 'pos', tip: 'Recorded in the books from posted accounting entries.' },
  RECONCILED: { cls: 'pos', tip: 'Recorded and matched to independent evidence such as a bank statement.' },
  UNRECONCILED: { cls: 'warn', tip: 'Recorded in the books but not yet matched to independent evidence.' },
  COMMITTED: { cls: 'cyan', tip: 'Not yet paid or received, but contractually committed.' },
  EXPECTED: { cls: 'cyan', tip: 'Expected from recorded documents such as invoices and bills, based on their due dates.' },
  BUDGET: { cls: 'violet', tip: 'A planned figure from an approved budget. Not an accounting fact.' },
  FORECAST: { cls: 'violet', tip: 'A projection based on stated assumptions. Not an accounting fact.' },
  'AI ESTIMATE': { cls: 'violet', tip: 'A model-derived estimate. Review the evidence before relying on it.' },
  SIMULATION: { cls: 'violet', tip: 'A hypothetical scenario. It does not change or represent the real books.' },
  CONTINGENT: { cls: 'warn', tip: 'A possible obligation that depends on a future event.' },
  DISPUTED: { cls: 'neg', tip: 'The amount is under dispute.' },
  PROVISIONAL: { cls: 'warn', tip: 'Prepared before the period was finally closed; figures may still change.' },
  DEMO: { cls: 'gold', tip: 'Sample data for demonstration. These are not real company figures.' },
}
export function Truth({ state }: { state: TruthState }) {
  const t = TRUTH[state]
  return <span className={cx('chip', t.cls)} title={t.tip}>{state}</span>
}

const STATUS_CLS: Record<string, string> = {
  draft: '', submitted: 'warn', approved: 'cyan', posted: 'pos', reversed: 'violet', rejected: 'neg', cancelled: '',
  open: 'cyan', partially_paid: 'warn', paid: 'pos', disputed: 'neg', pending: 'warn',
  matched: 'pos', unmatched: 'warn', suggested: 'cyan', partial: 'warn', duplicate: 'neg', needs_review: 'warn',
  locked: 'gold', soft_closed: 'warn', active: 'pos', inactive: '', blocked: 'neg', suspended: 'warn', terminated: '',
  pending_verification: 'warn', verified: 'pos', superseded: '', reviewing: 'cyan', false_positive: '', resolved: 'pos', revised: 'violet',
  info: '', review: 'warn', priority: 'neg', critical: 'neg',
}
export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={cx('chip', STATUS_CLS[status] ?? '')}>{label ?? status.replace(/_/g, ' ')}</span>
}

// ------------------------------------------------------------------ overlays
/** Overlays render at the document root: glass panels use backdrop-filter, which would
 *  otherwise trap fixed-position children inside the panel. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 640 }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px]" onClick={onClose} />
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className="panel relative flex max-h-[88vh] w-full flex-col overflow-hidden" style={{ maxWidth: width, background: 'var(--surface-solid)' }}
            initial={{ y: 18, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 10, scale: 0.985, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="display text-[16px] font-medium">{title}</div>
                {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
              </div>
              <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Portal>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, width = 560, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            className="absolute bottom-0 right-0 top-0 flex max-w-full flex-col border-l border-line" style={{ width, background: 'var(--surface-solid)' }}
            initial={{ x: 40, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 36 }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="display truncate text-[16px] font-medium">{title}</div>
                {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
              </div>
              <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
    </Portal>
  )
}

/** Sensitive actions always ask for a reason, which is written to the audit trail. */
export function ReasonDialog({ open, title, body, confirm, danger, required = true, onCancel, onConfirm, extra }: { open: boolean; title: string; body?: ReactNode; confirm: string; danger?: boolean; required?: boolean; onCancel: () => void; onConfirm: (reason: string) => void; extra?: ReactNode }) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Modal open={open} onClose={onCancel} title={title} width={500}
      footer={<>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className={cx('btn', danger ? 'danger' : 'primary')} disabled={required && !reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirm}</button>
      </>}>
      {body && <div className="mb-4 text-[13px] text-ink2">{body}</div>}
      {extra}
      <label className="label">Reason {required ? '(required — recorded in the audit trail)' : '(optional)'}</label>
      <textarea className="field" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being done?" />
    </Modal>
  )
}

// ------------------------------------------------------------------ small parts
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="no-print mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cx('relative h-8 rounded-lg px-3 text-[12.5px] font-medium transition-colors', value === t.key ? 'text-ink' : 'text-muted hover:text-ink2')}>
          {value === t.key && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg border border-line2 bg-surface2" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative flex items-center gap-2">{t.label}{t.count !== undefined && <span className="num rounded-full bg-surface2 px-1.5 text-[10.5px] text-ink2">{t.count}</span>}</span>
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>}
    </label>
  )
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-surface2 text-gold">{icon}</div>}
      <div className="display text-[15px] font-medium">{title}</div>
      {body && <div className="mt-1.5 max-w-md text-[13px] text-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div className="p-5" aria-busy="true" aria-label={label ?? 'Loading'}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton mb-3 h-9" style={{ width: `${96 - i * 7}%` }} />)}
    </div>
  )
}
export const Spinner = ({ size = 16 }: { size?: number }) => <Loader2 size={size} className="spin" />

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="m-4 flex items-start gap-3 rounded-xl border border-neg/30 bg-negsoft p-4 text-[13px]">
      <AlertTriangle size={18} className="mt-0.5 flex-none text-neg" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">This could not be loaded</div>
        <div className="mt-0.5 break-words text-ink2">{message}</div>
      </div>
      {retry && <button className="btn sm" onClick={retry}>Try again</button>}
    </div>
  )
}

export function Note({ kind = 'info', children, className }: { kind?: 'info' | 'warn' | 'good' | 'demo'; children: ReactNode; className?: string }) {
  const c = { info: 'border-cyan/25 bg-cyansoft', warn: 'border-warn/30 bg-warnsoft', good: 'border-pos/25 bg-possoft', demo: 'border-gold/30 bg-goldsoft' }[kind]
  const tone = { info: 'text-cyan', warn: 'text-warn', good: 'text-pos', demo: 'text-gold' }[kind]
  return (
    <div className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] text-ink2', c, className)}>
      <Info size={15} className={cx('mt-[2px] flex-none', tone)} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** "Explain this" — every figure can explain itself in plain language (spec 70, 501). */
export function Explain({ title, text, formula, inputs, source }: { title: string; text?: string; formula?: string; inputs?: { label: string; value: Decimal.Value }[]; source?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="no-print inline-grid h-5 w-5 place-items-center rounded-full border border-line text-muted transition-colors hover:border-gold hover:text-gold" onClick={(e) => { e.stopPropagation(); setOpen(true) }} aria-label={`Explain ${title}`} title="Explain this">
        <span className="text-[10px] font-semibold">?</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} subtitle="Explain this" width={520}>
        {text && <p className="m-0 text-[13.5px] leading-relaxed text-ink2">{text}</p>}
        {formula && (
          <div className="mt-4">
            <div className="eyebrow mb-1.5">How it is calculated</div>
            <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-gold">{formula}</div>
          </div>
        )}
        {inputs && inputs.length > 0 && (
          <div className="mt-4">
            <div className="eyebrow mb-1.5">Figures used</div>
            <div className="rounded-lg border border-line">
              {inputs.map((i) => (
                <div key={i.label} className="flex items-center justify-between border-b border-line px-3 py-2 text-[13px] last:border-0">
                  <span className="text-ink2">{i.label}</span>
                  {/days|ratio/i.test(i.label) ? <span className="num">{D(i.value).toDecimalPlaces(2).toString()}</span> : <Money value={i.value} />}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 text-[12px] text-muted">{source ?? 'Source: posted accounting entries in the general ledger for the selected companies and period.'}</div>
      </Modal>
    </>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismiss)
  const tone = { ok: 'pos', error: 'neg', info: 'cyan', warn: 'warn' } as const
  return (
    <Portal>
    <div className="no-print pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[380px] max-w-[calc(100vw-40px)] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="panel pointer-events-auto flex items-start gap-3 px-4 py-3" style={{ background: 'var(--surface-solid)' }}>
            <span className={cx('lamp mt-[6px]', tone[t.kind])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 break-words text-[12.5px] text-ink2">{t.body}</div>}
            </div>
            <button className="btn ghost icon sm" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
    </Portal>
  )
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="eyebrow m-0">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export const KeyHint = ({ children }: { children: ReactNode }) => (
  <kbd className="num rounded-md border border-line bg-surface px-1.5 py-[1px] text-[10.5px] text-muted">{children}</kbd>
)
