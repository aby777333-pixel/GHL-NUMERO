import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'
import { useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { AttentionClass } from '@/engine/p3Types'
import { fmtDateTime } from '@/lib/dates'
import { cx, Empty, PageHeader, Panel, Truth } from './kit'

// =====================================================================
// Shared parts of the phase 3 screens: stock, investments, reality,
// simulations, the scenario studio and the platform.
// =====================================================================

export const human = (s: string | null | undefined) => (s ?? '').replace(/[_.]/g, ' ')
export const digits = (s: string) => s.replace(/[^\d.]/g, '')
/** digits with an optional leading minus, for quantities that may go down */
export const signed = (s: string) => s.replace(/[^\d.-]/g, '').replace(/(?!^)-/g, '')
export const foot = 'border-t border-line2 px-[14px] py-[10px]'

/** The screen a role does not include. An empty screen would read as "there are none"; this says what is true. */
export function NoAccess({ eyebrow, title, perm, back }: { eyebrow: string; title: string; perm: string | string[]; back?: string }) {
  const nav = useNavigate()
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} actions={back ? <button className="btn ghost" onClick={() => nav(back)}><ArrowLeft size={15} /> Back</button> : undefined} />
      <Panel>
        <Empty icon={<Lock size={20} />} title={`Your role does not include ${title.toLowerCase()}`}
          body={<>This screen needs the permission <span className="num text-ink2">{[perm].flat().join(' or ')}</span> in at least one of the selected companies. A Group Super Admin can grant it under Team &amp; Access. Records you cannot see still exist and are still part of the books.</>} />
      </Panel>
    </div>
  )
}

/** Sample data is always marked as sample data. */
export function DemoTag({ className }: { className?: string }) {
  const mode = useApp((s) => s.mode)
  return mode === 'demo' ? <span className={cx('align-middle', className)}><Truth state="DEMO" /></span> : null
}

/** A figure that came out of a model. It is never an actual, and never shown without this mark. */
export const Simulated = ({ label = 'SIMULATION' }: { label?: string }) => (
  <span className="chip violet" title="A figure worked out by a model from assumptions. It is not in the books and changes nothing in them.">{label}</span>
)
export function SimulationBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[12.5px]" style={{ borderColor: 'var(--violet)', background: 'color-mix(in srgb, var(--violet) 9%, transparent)' }}>
      <Simulated />
      <span className="min-w-0 flex-1 text-ink2">{children ?? 'Everything on this screen is a simulation. It starts from the books and is worked out from the assumptions shown. Nothing here is posted, and no entry, budget or forecast is changed.'}</span>
    </div>
  )
}

/** What is at stake is not what has been lost. */
export const Exposure = () => <span className="chip warn" title="An estimate of what is at stake: quantity × the cost the stock is carried at. It is still in the books at cost. It is not a loss.">EXPOSURE</span>
export const Estimate = () => <span className="chip cyan" title="Worked out from the records by the formula shown. It is an estimate, not a recorded amount.">ESTIMATE</span>

const ATTENTION_CLS: Record<AttentionClass, string> = { information: '', finance_action: 'cyan', management_action: 'warn', owner_action: 'gold', critical: 'neg' }
export const AttentionChip = ({ value }: { value: AttentionClass }) => <span className={cx('chip', ATTENTION_CLS[value])} title="Who is expected to attend to this">{human(value)}</span>

export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 break-words text-[13px] text-ink">{children}</div>
    </div>
  )
}
export function Tile({ label, children, sub, tone, onClick }: { label: string; children: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <Panel className="p-4" onClick={onClick}>
      <div className="eyebrow">{label}</div>
      <div className={cx('display mt-1.5 text-[22px] font-medium', tone ?? 'text-ink')}>{children}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </Panel>
  )
}

/** Companies of the current selection in which the person holds one of the permissions. */
export function useCompanyChoices(ids: ID[]) {
  const companies = useApp((s) => s.companies)
  return useMemo(() => companies.filter((c) => c.status === 'active' && ids.includes(c.id)), [companies, ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}
export const useCompanyCode = () => {
  const companies = useApp((s) => s.companies)
  return useMemo(() => { const m = new Map(companies.map((c) => [c.id, c.code])); return (id: ID | null | undefined) => (id ? m.get(id) ?? '—' : '—') }, [companies])
}

/** What was done to a record, by whom and when, from the audit trail. */
export function History({ entity, entityId, title = 'History', className }: { entity: string; entityId: ID; title?: string; className?: string }) {
  const api = useApp((s) => s.api)!
  const audit = useAsync(() => api.listAudit({ entity, entityId, limit: 50 }), [api, entity, entityId])
  const rows = (audit.data ?? []).filter((a) => a.action !== 'update' || a.reason)
  return (
    <section className={className}>
      <div className="eyebrow mb-2.5">{title}</div>
      <Panel className="max-h-[280px] overflow-auto p-1.5" lit={false}>
        {audit.error ? <div className="px-3 py-3 text-[12.5px] text-muted">The history could not be loaded: {audit.error}</div>
          : !audit.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
          : rows.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No history is recorded.</div>
          : rows.map((a) => (
            <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
              <span className="text-ink">{a.action === 'insert' ? 'recorded' : human(a.action)}</span> <span className="text-muted">· {a.actor_name ?? 'Unknown user'} · {fmtDateTime(a.at)}</span>
              {a.reason && <div className="text-[11.5px] text-muted">{a.reason}</div>}
            </div>
          ))}
      </Panel>
    </section>
  )
}

/** Sources that could not be read are named, so that a figure never pretends to be complete. */
export function MissingSources({ missing, className }: { missing: string[]; className?: string }) {
  if (!missing.length) return null
  return (
    <div className={cx('rounded-xl border border-line px-4 py-3 text-[12.5px] text-ink2', className)} style={{ background: 'var(--warn-soft)' }}>
      <span className="font-medium text-warn">Not complete.</span> Your role does not read {missing.join(', ')} in every company selected. What those records would add is not in the figures below.
    </div>
  )
}
