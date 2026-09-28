import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type Decimal from 'decimal.js'
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock, ExternalLink, FileText, Paperclip, Save, Upload, XCircle } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Account, ID, Num } from '@/engine/types'
import type { CustomValues, DocumentRecord, WorkflowPosting } from '@/engine/opsTypes'
import { DOCUMENT_KINDS } from '@/engine/opsTypes'
import { D, fmtMoney } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Field, Modal, Money, Note, Panel, Spinner, StatusChip } from './kit'
import { workflowSource } from '@/lib/workflow'

// =====================================================================
// Shared parts of the operations screens.
// =====================================================================

/** Bank and cash ledgers of a company: the only ledgers money can leave from or arrive in. */
export function useMoneyLedgers(companyId: ID | undefined, bankOnly = false): Account[] {
  const accounts = useApp((s) => s.accounts)
  return useMemo(() => accounts
    .filter((a) => a.company_id === companyId && !a.is_group && a.is_active && (a.control_type === 'bank' || (!bankOnly && a.control_type === 'cash')))
    .sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId, bankOnly])
}
export const usePartyName = () => {
  const parties = useApp((s) => s.parties)
  return useMemo(() => { const m = new Map(parties.map((p) => [p.id, p.display_name])); return (id: ID | null | undefined) => (id ? m.get(id) ?? 'Unknown party' : '—') }, [parties])
}
export const useCompanyName = () => {
  const companies = useApp((s) => s.companies)
  return useMemo(() => { const m = new Map(companies.map((c) => [c.id, c])); return (id: ID | null | undefined) => (id ? m.get(id)?.name ?? 'Unknown company' : '—') }, [companies])
}
export const useUnitName = () => {
  const units = useApp((s) => s.orgUnits)
  return useMemo(() => { const m = new Map(units.map((u) => [u.id, u.name])); return (id: ID | null | undefined) => (id ? m.get(id) ?? '—' : '—') }, [units])
}
export const useAccountName = () => {
  const accounts = useApp((s) => s.accounts)
  return useMemo(() => { const m = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`])); return (id: ID | null | undefined) => (id ? m.get(id) ?? 'Unknown ledger' : '—') }, [accounts])
}

const POSTING_TEXT: Record<WorkflowPosting['status'], { icon: ReactNode; tone: string; text: string }> = {
  pending: { icon: <Clock size={15} />, tone: 'text-warn', text: 'Awaiting approval. Nothing has reached the ledger.' },
  posted: { icon: <CheckCircle2 size={15} />, tone: 'text-pos', text: 'Approved and posted to the ledger.' },
  voided: { icon: <XCircle size={15} />, tone: 'text-muted', text: 'Rejected or cancelled. Nothing was posted.' },
  reversed: { icon: <XCircle size={15} />, tone: 'text-violet', text: 'Posted and later reversed.' },
}

/**
 * The accounting entries an operational record has proposed, and what became of each.
 * An operation never writes to the ledger itself: it proposes a journal that must be approved.
 */
export function ProposedEntries({ companyIds, sources, sourceId, title = 'Accounting entries', className }: { companyIds: ID[]; sources?: string[]; sourceId: ID; title?: string; className?: string }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const rows = useAsync(async () => (await api.listWorkflowPostings({ companyIds, sourceId })).filter((w) => !sources || sources.includes(w.source)), [api, companyIds.join(','), sourceId, sources?.join(',')])
  const journals = useAsync(async () => {
    const ids = new Set((rows.data ?? []).map((r) => r.journal_id))
    if (!ids.size) return new Map<ID, { voucher_no: string | null; total: Num; status: string }>()
    const all = await api.listJournals({ companyIds, limit: 1000 })
    return new Map(all.rows.filter((j) => ids.has(j.id)).map((j) => [j.id, { voucher_no: j.voucher_no, total: j.total, status: j.status }]))
  }, [api, rows.data])
  if (!rows.data?.length) return null
  return (
    <section className={className}>
      <div className="eyebrow mb-2.5">{title}</div>
      <Panel className="p-1.5" lit={false}>
        {rows.data.map((w) => {
          const t = POSTING_TEXT[w.status]
          const j = journals.data?.get(w.journal_id)
          return (
            <button key={w.id} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => nav('/journals/' + w.journal_id)}>
              <span className={cx('mt-[2px] flex-none', t.tone)}>{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-ink">{workflowSource(w).label} {j?.voucher_no && <span className="num text-gold">· {j.voucher_no}</span>}</span>
                <span className="block text-[11.5px] text-muted">{t.text} Proposed {fmtDateTime(w.created_at)}.{!j && w.status !== 'voided' ? ' You are not cleared to open this entry.' : ''}</span>
              </span>
              {j && <Money value={j.total} className="text-[12.5px]" />}
              <ExternalLink size={13} className="mt-[3px] flex-none text-muted" />
            </button>
          )
        })}
      </Panel>
    </section>
  )
}

export function ProposedNote({ children }: { children?: ReactNode }) {
  return <Note className="mb-4">{children ?? 'This action proposes an accounting entry. It reaches the ledger only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money.'}</Note>
}

export interface MoneyMoveValue { amount: string; bank_ledger_id: ID; date: string; reference: string; method: string }
/** Asks where the money came from or went to, when, and under which reference. */
export function MoneyMoveDialog({ open, title, subtitle, companyId, amount, amountEditable = true, max, confirm, bankOnly, extra, note, onCancel, onConfirm, busy }: {
  open: boolean; title: string; subtitle?: ReactNode; companyId: ID; amount?: Num | Decimal; amountEditable?: boolean; max?: Num | Decimal; confirm: string; bankOnly?: boolean
  extra?: ReactNode; note?: ReactNode; onCancel: () => void; onConfirm: (v: MoneyMoveValue) => void; busy?: boolean
}) {
  const ledgers = useMoneyLedgers(companyId, bankOnly)
  const currency = useApp((s) => s.companies.find((c) => c.id === companyId)?.base_currency ?? 'INR')
  const [v, setV] = useState<MoneyMoveValue>({ amount: '', bank_ledger_id: '', date: today(), reference: '', method: 'Bank transfer' })
  useEffect(() => { if (open) setV({ amount: amount != null ? String(D(amount)) : '', bank_ledger_id: ledgers.find((l) => l.control_type === 'bank')?.id ?? ledgers[0]?.id ?? '', date: today(), reference: '', method: 'Bank transfer' }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const amt = D(v.amount || 0)
  const problem = !v.bank_ledger_id ? 'Choose the ledger.' : !v.date ? 'Choose the date.' : amountEditable && amt.lte(0) ? 'Enter the amount.' : max != null && amt.gt(D(max)) ? `The amount cannot exceed ${fmtMoney(max, { currency })}.` : null
  return (
    <Modal open={open} onClose={onCancel} title={title} subtitle={subtitle} width={520}
      footer={<><button className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => onConfirm(v)}>{busy ? <Spinner /> : <BadgeCheck size={15} />} {confirm}</button></>}>
      <ProposedNote>{note}</ProposedNote>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" hint={max != null ? `Up to ${fmtMoney(max, { currency })}` : undefined}>
          <input className="field num" inputMode="decimal" value={v.amount} disabled={!amountEditable} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') })} autoFocus={amountEditable} />
        </Field>
        <Field label="Date"><input type="date" className="field" value={v.date} max={today()} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label={bankOnly ? 'Bank ledger' : 'Bank or cash ledger'} className="sm:col-span-2" hint={ledgers.length ? undefined : 'This company has no bank or cash ledger.'}>
          <select className="field" value={v.bank_ledger_id} onChange={(e) => setV({ ...v, bank_ledger_id: e.target.value })}><option value="">Choose…</option>{ledgers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select>
        </Field>
        <Field label="Reference" hint="UTR, cheque number or receipt number"><input className="field" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        <Field label="Method"><select className="field" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{['Bank transfer', 'Cheque', 'Cash', 'UPI', 'Card', 'Auto-debit', 'Payroll recovery', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      </div>
      {extra && <div className="mt-4">{extra}</div>}
      {problem && v.amount !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Evidence attached to a record: upload, view, and an honest notice about duplicates. */
export function Attachments({ companyId, entity, entityId, title = 'Evidence', readOnly, className }: { companyId: ID; entity: string; entityId: ID; title?: string; readOnly?: boolean; className?: string }) {
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const toast = useApp((s) => s.toast)
  const { act, busy } = useAction()
  const input = useRef<HTMLInputElement>(null)
  const docs = useAsync(() => api.listDocuments({ companyIds: [companyId], entity, entityId }), [api, companyId, entity, entityId])
  const [kind, setKind] = useState('expense_receipt')
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const r = await act(() => api.uploadDocument(companyId, f, { doc_kind: kind, entity, entity_id: entityId }))
      if (r?.possible_duplicates.length) toast('warn', 'POSSIBLE DUPLICATE', `"${f.name}" has the same content as ${r.possible_duplicates[0].name}. It was kept and flagged for review.`)
      else if (r) toast('ok', `${f.name} attached`)
    }
    if (input.current) input.current.value = ''
  }
  const open = async (d: DocumentRecord) => {
    const url = await api.documentUrl(d.id)
    if (url) window.open(url, '_blank', 'noopener')
    else toast('info', 'No file to show', mode === 'demo' ? 'Sample documents are descriptions only; no file is stored for them.' : 'The file could not be retrieved.')
  }
  const canUpload = !readOnly && can('document.upload', companyId)
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="eyebrow">{title}</div>
        {canUpload && (
          <div className="no-print flex items-center gap-1.5">
            <select className="field sm" style={{ width: 170 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of document">{DOCUMENT_KINDS.filter((k) => k.key !== 'unclassified').map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select>
            <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xlsx,.xls,.doc,.docx,.eml,.txt" />
            <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Spinner size={13} /> : <Upload size={13} />} Attach</button>
          </div>
        )}
      </div>
      <Panel className="p-1.5" lit={false}>
        {docs.loading && !docs.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
          : !docs.data?.length ? <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><Paperclip size={14} /> Nothing is attached.</div>
          : docs.data.map((d) => (
            <button key={d.id} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => void open(d)}>
              <FileText size={15} className="flex-none text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{d.name}</span>
                <span className="block text-[11.5px] text-muted">{DOCUMENT_KINDS.find((k) => k.key === d.doc_kind)?.name ?? d.doc_kind} · {size(d.size_bytes)} · {fmtDate(d.uploaded_at.slice(0, 10))}</span>
              </span>
              {d.duplicate_of && <span className="chip warn" title="The same file content exists in another document"><AlertTriangle size={11} /> possible duplicate</span>}
              {d.expires_on && <span className="chip" title="Expiry recorded on the document">expires {fmtDate(d.expires_on)}</span>}
            </button>
          ))}
      </Panel>
    </section>
  )
}

/** Fields an administrator has defined for this kind of record (Genesis Builder). */
export function CustomFields({ companyId, entity, entityId, scopeKey, readOnly, className }: { companyId: ID; entity: string; entityId: ID; scopeKey?: string | string[] | null; readOnly?: boolean; className?: string }) {
  const scopes = [scopeKey ?? []].flat().filter(Boolean) as string[]
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const defs = useAsync(async () => (await api.listCustomFields()).filter((d) => d.entity === entity && d.status === 'active' && (d.company_id === null || d.company_id === companyId) && (!d.scope_key || !scopes.length || scopes.includes(d.scope_key))), [api, entity, companyId, scopes.join(',')])
  const saved = useAsync(() => api.getCustomValues(entity, entityId), [api, entity, entityId])
  const [v, setV] = useState<CustomValues>({})
  useEffect(() => { if (saved.data) setV(saved.data) }, [saved.data])
  if (!defs.data?.length) return null
  const str = (k: string) => (v[k] === null || v[k] === undefined ? '' : String(v[k]))
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between"><div className="eyebrow">Additional information</div>
        {!readOnly && <button className="btn sm" disabled={busy} onClick={() => void act(() => api.saveCustomValues(companyId, entity, entityId, v), 'Saved')}>{busy ? <Spinner size={13} /> : <Save size={13} />} Save</button>}
      </div>
      <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
        {defs.data.map((d) => {
          const label = d.label + (d.is_required ? ' *' : '')
          const options = (d.options ?? []).map(String)
          const set = (val: unknown) => setV((x) => ({ ...x, [d.key]: val }))
          return (
            <Field key={d.id} label={label}>
              {d.field_type === 'boolean' || d.field_type === 'checkbox' ? <select className="field" disabled={readOnly} value={str(d.key)} onChange={(e) => set(e.target.value === '' ? null : e.target.value === 'true')}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select>
                : options.length ? <select className="field" disabled={readOnly} value={str(d.key)} onChange={(e) => set(e.target.value)}><option value="">—</option>{options.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className={cx('field', ['number', 'money', 'percentage', 'currency'].includes(d.field_type) && 'num')} disabled={readOnly} type={d.field_type === 'date' ? 'date' : 'text'} inputMode={['number', 'money', 'percentage', 'currency'].includes(d.field_type) ? 'decimal' : undefined} value={str(d.key)} onChange={(e) => set(e.target.value)} />}
            </Field>
          )
        })}
      </Panel>
    </section>
  )
}

/** One figure with its label, used in the summary strips at the top of the operations screens. */
export function Stat({ label, value, currency, sub, tone, onClick, count }: { label: string; value: Num | Decimal; currency?: string; sub?: ReactNode; tone?: 'gold' | 'pos' | 'neg' | 'warn' | 'cyan'; onClick?: () => void; count?: boolean }) {
  const c = tone ? { gold: 'text-gold', pos: 'text-pos', neg: 'text-neg', warn: 'text-warn', cyan: 'text-cyan' }[tone] : 'text-ink'
  return (
    <Panel className="p-4" onClick={onClick}>
      <div className="eyebrow">{label}</div>
      <div className={cx('display mt-1.5 text-[22px] font-medium', c)}>{count ? <span className="num">{D(value).toString()}</span> : <Money value={value} currency={currency} compact />}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </Panel>
  )
}

/** Approval trail of a record handled by the general approval engine. */
export function ApprovalTrail({ companyId, entity, entityId }: { companyId: ID; entity: string; entityId: ID }) {
  const api = useApp((s) => s.api)!
  const req = useAsync(async () => (await api.listApprovalRequests([companyId])).filter((r) => r.entity === entity && r.entity_id === entityId), [api, companyId, entity, entityId])
  const last = req.data?.[0]
  if (!last) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
      <StatusChip status={last.status} label={last.status === 'pending' ? `awaiting approval · step ${last.current_step} of ${last.steps.length}` : `approval ${last.status}`} />
      <span>{last.steps.map((s) => (s === '*' ? 'any authorised approver' : s.replace(/_/g, ' '))).join(' → ')}</span>
      <span>· requested {fmtDateTime(last.requested_at)}</span>
    </div>
  )
}
