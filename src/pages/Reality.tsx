import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, ExternalLink, FolderOpen, Link2, MailCheck, Plus, Scale, Send, ShieldQuestion } from 'lucide-react'
import type { Confidentiality, ID, Member } from '@/engine/types'
import { DOCUMENT_KINDS } from '@/engine/opsTypes'
import type { AttentionClass, Case, CaseKind, CaseLink, CaseStatus, Confirmation, ConfirmSubject, VerificationRun, VerifySubject } from '@/engine/p3Types'
import { DIMENSIONS, notChecked, realityHealth, type Chain, type Dimension, type Finding, type HealthRow, type Reading, type RealityInput } from '@/engine/reality'
import { loadReality, type RealityData } from '@/lib/realityData'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D } from '@/lib/money'
import { addMonths, endOfMonth, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { Attachments, useCompanyName, usePartyName } from '@/ui/ops'
import { AttentionChip, DemoTag, digits, Fact, human, MissingSources, NoAccess, signed, Tile, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { Gauge } from '@/ui/charts'

// =====================================================================
// NUMERO Reality (spec 1454-1468): what the documents say, what was
// done, what was posted, what the bank and the cash box show, and what
// physically exists, set against each other.
// The five realities are five separate counts and are never added into
// one score. A difference is stated as a fact, with both readings; what
// it means is for a person to decide, in a case. A reality that was not
// looked at is never shown as one that agrees.
// =====================================================================

type TabKey = 'health' | 'differences' | 'cases' | 'verification' | 'confirmations'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'health', label: 'Reality health' }, { key: 'differences', label: 'Differences' }, { key: 'cases', label: 'Cases' },
  { key: 'verification', label: 'Physical verification' }, { key: 'confirmations', label: 'Confirmations from outside' },
]

export const CASE_STATUSES: CaseStatus[] = ['open', 'triage', 'under_review', 'investigating', 'substantiated', 'unsubstantiated', 'remediated', 'closed']
export const CASE_KINDS: { key: CaseKind; label: string }[] = [
  { key: 'reality', label: 'Difference between realities' }, { key: 'verification', label: 'Physical verification' }, { key: 'confirmation', label: 'Confirmation from outside' },
  { key: 'sentinel', label: 'Raised from an alert' }, { key: 'incident', label: 'Incident' }, { key: 'other', label: 'Other' },
]
/** the permission a case of this kind is worked under: the database asks for the same */
export const caseRight = (kind: string) => (kind === 'sentinel' || kind === 'incident' ? 'sentinel.review' : 'reality.manage')
export const caseKindLabel = (k: string) => CASE_KINDS.find((x) => x.key === k)?.label ?? human(k)
export const ATTENTION: { key: AttentionClass; label: string }[] = [
  { key: 'information', label: 'Information — nobody needs to act' }, { key: 'finance_action', label: 'Finance action' }, { key: 'management_action', label: 'Management action' },
  { key: 'owner_action', label: 'Owner action' }, { key: 'critical', label: 'Critical' },
]
export const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
export const CHAIN_LABEL: Record<Chain, string> = { purchase: 'Purchase', sale: 'Sale', advance: 'Advance', asset: 'Fixed asset', cash: 'Cash box', stock: 'Stock', bank: 'Bank', verification: 'Verification' }
const CHAIN_WHAT: Record<Chain, string> = {
  purchase: 'order ↔ receipt ↔ bill ↔ stock ↔ payment', sale: 'invoice ↔ books ↔ money received', advance: 'approval ↔ money released ↔ evidence ↔ use ↔ books ↔ return',
  asset: 'register ↔ what was found', cash: 'books ↔ what was counted', stock: 'stock ledger ↔ general ledger', bank: 'books ↔ statement', verification: 'books ↔ what the sheet found',
}
export const ENTITY_LABEL: Record<string, string> = {
  invoices: 'Invoice or bill', purchase_docs: 'Purchase document', advances: 'Advance', expense_claims: 'Expense claim', fixed_assets: 'Fixed asset', cash_boxes: 'Cash box',
  bank_accounts: 'Bank account', accounts: 'Ledger', stock_docs: 'Stock document', inv_items: 'Stock item', parties: 'Party', party: 'Party', journals: 'Accounting entry',
  verification_runs: 'Physical verification', confirmations: 'Confirmation', cases: 'Case', loans: 'Loan', holdings: 'Investment', fixed_deposits: 'Fixed deposit', documents: 'Document', companies: 'Company',
}
const SUBJECT_LABEL: Record<VerifySubject, string> = { assets: 'Fixed assets', inventory: 'Stock', cash: 'Cash', documents: 'Documents' }
const CONFIRM_LABEL: Record<ConfirmSubject, string> = { bank: 'Bank', customer: 'Customer', vendor: 'Vendor', loan: 'Loan', deposit: 'Deposit', investment: 'Investment', intercompany: 'Intercompany' }
const CONFIRM_STATUS: Record<Confirmation['status'], string> = {
  drafted: 'prepared — not sent', sent: 'sent by a person — awaiting the reply', agreed: 'agrees', difference: 'differs', explained: 'difference explained', disputed: 'difference disputed', no_reply: 'no reply', cancelled: 'cancelled',
}

/** The screen that opens a linked record. Null where no screen opens that kind of record. */
export function recordRoute(l: Pick<CaseLink, 'entity' | 'entity_id'>, docType?: string | null): string | null {
  const id = l.entity_id
  switch (l.entity) {
    case 'invoices': return (docType === 'purchase_bill' || docType === 'debit_note' ? '/bills/' : '/invoices/') + id
    case 'purchase_docs': return '/purchasing/' + id
    case 'advances': return '/expenses/advances/' + id
    case 'expense_claims': return '/expenses/claims/' + id
    case 'fixed_assets': return '/assets/' + id
    case 'cash_boxes': return '/cash'
    case 'bank_accounts': return '/banking'
    case 'accounts': return ledgerLink({ accounts: [id] })
    case 'stock_docs': return '/inventory/docs/' + id
    case 'inv_items': return '/inventory/items/' + id
    case 'parties': case 'party': return '/parties/' + id
    case 'journals': return '/journals/' + id
    case 'verification_runs': return '/reality/verifications/' + id
    case 'confirmations': return '/reality?tab=confirmations&open=' + id
    case 'cases': return '/reality/cases/' + id
    case 'loans': return '/treasury/loans/' + id
    case 'holdings': return '/investments/holdings/' + id
    case 'fixed_deposits': return '/treasury?tab=deposits&deposit=' + id
    default: return null
  }
}

/** Records a finding or a case points to, each opening on its own screen. */
export function RecordLinks({ links, docTypes, empty = 'No record is linked.' }: { links: CaseLink[]; docTypes?: Map<ID, string>; empty?: string }) {
  const nav = useNavigate()
  if (!links.length) return <div className="px-3 py-3 text-[12.5px] text-muted">{empty}</div>
  return (
    <>
      {links.map((l, i) => {
        const to = recordRoute(l, docTypes?.get(l.entity_id))
        const kind = ENTITY_LABEL[l.entity] ?? human(l.entity)
        const body = (
          <>
            <Link2 size={14} className={cx('flex-none', to ? 'text-gold' : 'text-muted')} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{l.label || kind}</span>
              <span className="block text-[11.5px] text-muted">{kind}{to ? '' : ' · no screen opens this kind of record'}</span>
            </span>
          </>
        )
        return to
          ? <button key={l.entity + l.entity_id + i} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => nav(to)}>{body}<ExternalLink size={13} className="flex-none text-muted" /></button>
          : <div key={l.entity + l.entity_id + i} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2">{body}</div>
      })}
    </>
  )
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** The readings a case was opened on, read back from what the case stored. */
export function readingsOf(finding: Record<string, unknown> | null | undefined): { readings: Partial<Record<Dimension, Reading>>; differs: Dimension[] } {
  const readings: Partial<Record<Dimension, Reading>> = {}
  if (!finding) return { readings, differs: [] }
  const src = isRecord(finding.readings) ? finding.readings : finding
  for (const d of DIMENSIONS) {
    const r = src[d.key]
    if (!isRecord(r) || typeof r.says !== 'string') continue
    const n = r.value === null || r.value === undefined || r.value === '' ? null : Number(r.value)
    readings[d.key] = { value: n !== null && Number.isFinite(n) ? n : null, unit: r.unit === 'quantity' ? 'quantity' : 'amount', says: r.says }
  }
  const differs = Array.isArray(finding.differs) ? DIMENSIONS.map((d) => d.key).filter((k) => (finding.differs as unknown[]).includes(k)) : []
  return { readings, differs }
}

/** The readings side by side: what each reality says, in its own words. A reality that was not read is named as not read. */
export function Readings({ readings, differs, currency, columns = 2 }: { readings: Partial<Record<Dimension, Reading>>; differs: Dimension[]; currency?: string; columns?: 2 | 3 }) {
  const shown = DIMENSIONS.filter((d) => readings[d.key])
  const absent = DIMENSIONS.filter((d) => !readings[d.key])
  return (
    <div>
      <div className={cx('grid gap-3', columns === 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2')}>
        {shown.map((d) => {
          const r = readings[d.key]!
          const out = differs.includes(d.key)
          return (
            <div key={d.key} className={cx('rounded-xl border p-3.5', out ? 'border-warn/30 bg-warnsoft' : 'border-line bg-surface')}>
              <div className="flex items-center justify-between gap-2"><span className="eyebrow">{d.label}</span>{out && <span className="chip warn" title="This reality does not agree with the others">differs</span>}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">{d.question}</div>
              <div className="display mt-2 text-[18px] font-medium text-ink">
                {r.value === null ? <span className="text-[13px] font-normal text-muted">no figure</span> : r.unit === 'quantity' ? <span className="num">{D(r.value).toString()}</span> : <Money value={r.value} currency={currency} />}
              </div>
              <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{r.says}</div>
            </div>
          )
        })}
      </div>
      {absent.length > 0 && (
        <div className="mt-2.5 text-[11.5px] text-muted">
          Not read in this comparison: {absent.map((d) => d.label).join(', ')}. Nothing is said about {absent.length === 1 ? 'it' : 'them'} here — a reality that was not looked at is not a reality that agrees.
        </div>
      )}
    </div>
  )
}

/** Names of the people of the group. A convenience: the screens work for people who cannot list the team. */
export function useMembers(): Member[] {
  const api = useApp((s) => s.api)!
  const members = useAsync(() => api.listMembers().catch(() => [] as Member[]), [api])
  return members.data ?? []
}
export function useWho() {
  const session = useApp((s) => s.session)
  const members = useMembers()
  return useMemo(() => {
    const m = new Map(members.map((x) => [x.user_id, x.full_name || x.email]))
    return (id: ID | null | undefined) => (!id ? '—' : session && id === session.user.id ? `${session.user.name} (you)` : m.get(id) ?? `User ${id.slice(0, 8)}`)
  }, [members, session])
}

/** Who a case is given to: a person of the team, or a name typed in. */
export function OwnerPicker({ companyId, userId, name, onChange }: { companyId: ID; userId: ID | null; name: string; onChange: (userId: ID | null, name: string) => void }) {
  const members = useMembers()
  const people = useMemo(() => {
    const seen = new Set<ID>()
    return members.filter((m) => m.company_id === companyId && !seen.has(m.user_id) && !!seen.add(m.user_id)).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  }, [members, companyId])
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select className="field" aria-label="Owner from the team" value={userId ?? ''} onChange={(e) => { const m = people.find((x) => x.user_id === e.target.value); onChange(m ? m.user_id : null, m ? m.full_name || m.email : '') }}>
        <option value="">{people.length ? 'Not a user of NUMERO' : 'The team list is not available to you'}</option>
        {people.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email} · {human(m.role_key)}</option>)}
      </select>
      <input className="field" aria-label="Name of the owner" placeholder="Name of the person" value={name} disabled={!!userId} onChange={(e) => onChange(null, e.target.value)} />
    </div>
  )
}

/** The same input, narrowed to one company: company reality is the group reality of a single company. */
function forCompany(i: RealityInput, id: ID): RealityInput {
  const only = <T extends { company_id: ID }>(xs: T[] | undefined) => xs?.filter((x) => x.company_id === id)
  return {
    ...i, purchaseDocs: only(i.purchaseDocs), invoices: only(i.invoices), payments: only(i.payments), stockDocs: only(i.stockDocs), advances: only(i.advances), claims: only(i.claims),
    assets: only(i.assets), assetEvents: only(i.assetEvents), cashBoxes: only(i.cashBoxes), cashCounts: only(i.cashCounts), ledger: only(i.ledger), accounts: only(i.accounts), invItems: only(i.invItems),
    invCategories: only(i.invCategories), stockCounts: only(i.stockCounts), bankAccounts: only(i.bankAccounts), bankTxns: only(i.bankTxns), verifications: only(i.verifications),
  }
}

export default function Reality() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('reality.view', id))
  if (!ids.length) return <NoAccess eyebrow="NUMERO Reality" title="Reality" perm="reality.view" />
  return <RealityView ids={ids} leftOut={scope.length - ids.length} />
}

interface Lists { cases: Case[]; verifications: VerificationRun[]; confirmations: Confirmation[] }
type Put = (patch: Record<string, string | null>) => void

function RealityView({ ids, leftOut }: { ids: ID[]; leftOut: number }) {
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const idsKey = ids.join(',')

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'health'
  const put: Put = (patch) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v) }
    setSp(next, { replace: true })
  }
  const go = (t: TabKey, more: Record<string, string | null> = {}) => put({ chain: null, reality: null, company: null, material: null, open: null, status: null, tab: t, ...more })

  const main = useAsync(() => loadReality(api, accounts, ids, can), [api, idsKey, accounts])
  const lists = useAsync<Lists>(async () => {
    const [cases, verifications, confirmations] = await Promise.all([api.listCases({ companyIds: ids }), api.listVerifications(ids), api.listConfirmations(ids)])
    return { cases, verifications, confirmations }
  }, [api, idsKey])

  const manageIds = ids.filter((id) => can('reality.manage', id))
  const d = main.data
  const l = lists.data
  const material = d?.findings.filter((f) => f.material).length ?? 0
  const unset = d ? [...new Set(d.findings.map((f) => f.company_id))].filter((c) => !d.materiality.some((m) => m.company_id === c)).length : 0
  const openCases = l?.cases.filter((c) => c.status !== 'closed') ?? []
  const urgent = openCases.filter((c) => c.attention === 'critical' || c.attention === 'owner_action').length
  const runsOpen = l?.verifications.filter((r) => r.status === 'open').length ?? 0
  const differing = l?.confirmations.filter((c) => c.status === 'difference' || c.status === 'disputed').length ?? 0
  const awaiting = l?.confirmations.filter((c) => c.status === 'sent' || c.status === 'no_reply').length ?? 0
  const gaps = (d?.unchecked.length ?? 0) + (d?.missing.length ?? 0)

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Reality"
        title="Does the world agree with the books?"
        subtitle={<>
          As at {fmtDate(d?.asOf ?? today())} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · documents, operations, accounting, cash and the physical world, set against each other. A difference is a fact; what it means is decided by a person, in a case.
          <DemoTag className="ml-2" />
        </>}
      />

      {leftOut > 0 && <Note kind="warn" className="mb-4">{leftOut} of the selected companies {leftOut === 1 ? 'is' : 'are'} left out: your role does not include <span className="num">reality.view</span> there. Nothing on this screen speaks for {leftOut === 1 ? 'that company' : 'those companies'}.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label="Differences found" tone={d && d.findings.length ? 'text-warn' : undefined} onClick={() => go('differences')}
          sub={d ? `${material} above the threshold · ${d.findings.length - material} below the threshold${unset ? ` · no threshold set in ${unset} compan${unset === 1 ? 'y' : 'ies'}, where every difference counts` : ''}` : 'Reading the records'}>
          <span className="num">{d ? d.findings.length : '—'}</span>
        </Tile>
        <Tile label="Cases open" onClick={() => go('cases', { status: 'not_closed' })} sub={l ? `${urgent} for the owner or critical · ${l.cases.length - openCases.length} closed` : 'Loading'}>
          <span className="num">{l ? openCases.length : '—'}</span>
        </Tile>
        <Tile label="Verifications in progress" onClick={() => go('verification')} sub={l ? `${l.verifications.filter((r) => r.status === 'completed').length} completed` : 'Loading'}>
          <span className="num">{l ? runsOpen : '—'}</span>
        </Tile>
        <Tile label="Confirmations that differ" tone={differing ? 'text-warn' : undefined} onClick={() => go('confirmations')} sub={l ? `${awaiting} awaiting a reply · ${l.confirmations.filter((c) => c.status === 'agreed').length} agree` : 'Loading'}>
          <span className="num">{l ? differing : '—'}</span>
        </Tile>
        <Tile label="Not looked at" tone={gaps ? 'text-warn' : undefined} onClick={() => go('health')} sub={d ? `${d.unchecked.length} never checked · ${d.missing.length} source${d.missing.length === 1 ? '' : 's'} you may not read` : 'Reading the records'}>
          <span className="num">{d ? gaps : '—'}</span>
        </Tile>
      </div>

      <Tabs tabs={TABS.map((t) => ({
        ...t,
        count: t.key === 'differences' ? d?.findings.length : t.key === 'cases' ? (l ? openCases.length : undefined) : t.key === 'verification' ? (l ? runsOpen : undefined) : t.key === 'confirmations' ? l?.confirmations.length : undefined,
      }))} value={tab} onChange={(k) => go(k)} />

      {(tab === 'health' || tab === 'differences') && (
        <>
          {main.error && <ErrorBox message={main.error} retry={main.reload} />}
          {!main.error && !d && <Panel><Loading rows={6} label="Reading the records of every chain" /></Panel>}
          {d && tab === 'health' && <HealthTab data={d} ids={ids} onDimension={(k) => go('differences', { reality: k })} onCompany={(id) => go('differences', { company: id })} />}
          {d && tab === 'differences' && <DifferencesTab data={d} ids={ids} manageIds={manageIds} sp={sp} put={put} />}
        </>
      )}
      {(tab === 'cases' || tab === 'verification' || tab === 'confirmations') && (
        <>
          {lists.error && <ErrorBox message={lists.error} retry={lists.reload} />}
          {!lists.error && !l && <Panel><Loading rows={6} label="Loading" /></Panel>}
          {l && tab === 'cases' && <CasesTab cases={l.cases} ids={ids} manageIds={manageIds} sp={sp} put={put} />}
          {l && tab === 'verification' && <VerificationTab runs={l.verifications} ids={ids} manageIds={manageIds} />}
          {l && tab === 'confirmations' && <ConfirmationsTab rows={l.confirmations} cases={l.cases} ids={ids} manageIds={manageIds} sp={sp} put={put} />}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ reality health
const noManageText = (ids: ID[]) => (ids.length ? undefined : 'You need the permission reality.manage to record this')

function HealthPanel({ row, onOpen }: { row: HealthRow; onOpen: () => void }) {
  const d = DIMENSIONS.find((x) => x.key === row.dimension)!
  const none = row.checked === 0
  return (
    <Panel className="flex flex-col p-4" lit={false}>
      <div className="eyebrow">{d.label} match</div>
      <div className="mt-0.5 min-h-[34px] text-[11.5px] text-muted">{d.question}</div>
      <div className="my-2 grid place-items-center">
        <Gauge value={none ? 0 : row.agree / row.checked} label={none ? '—' : `${row.agree}/${row.checked}`} sub={none ? 'not checked' : 'agree'} tone={none ? 'cyan' : row.differ ? 'warn' : 'pos'} />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <div><div className="num text-[15px] text-ink">{row.checked}</div><div className="text-[11px] text-muted">checked</div></div>
        <div><div className={cx('num text-[15px]', none ? 'text-muted' : 'text-pos')}>{row.agree}</div><div className="text-[11px] text-muted">agree</div></div>
        <div><div className={cx('num text-[15px]', row.differ ? 'text-warn' : 'text-muted')}>{row.differ}</div><div className="text-[11px] text-muted">differ</div></div>
      </div>
      {none && <div className="mt-2.5 rounded-lg bg-warnsoft px-2.5 py-1.5 text-[11.5px] text-ink2">Nothing was checked for this reality. That is not the same as agreeing.</div>}
      <div className="mt-2.5 flex-1 text-[11.5px] leading-relaxed text-muted"><span className="text-ink2">How it is counted.</span> {row.method}</div>
      <button className="btn sm mt-3" disabled={!row.differ} title={row.differ ? undefined : 'No difference was found in this reality'} onClick={onOpen}>See the {row.differ} difference{row.differ === 1 ? '' : 's'}</button>
    </Panel>
  )
}

interface CompanyHealth { id: ID | null; name: string; code: string; rows: HealthRow[]; unchecked: string[]; findings: number }

function HealthTab({ data, ids, onDimension, onCompany }: { data: RealityData; ids: ID[]; onDimension: (k: Dimension) => void; onCompany: (id: ID) => void }) {
  const companies = useCompanyChoices(ids)
  const byCompany: CompanyHealth[] = useMemo(() => {
    const rows: CompanyHealth[] = companies.map((c) => {
      const input = forCompany(data.input, c.id)
      const findings = data.findings.filter((f) => f.company_id === c.id)
      return { id: c.id, name: c.name, code: c.code, rows: realityHealth(input, findings), unchecked: notChecked(input), findings: findings.length }
    })
    return [...rows, { id: null, name: `The whole selection · ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`, code: 'GROUP', rows: data.health, unchecked: data.unchecked, findings: data.findings.length }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, companies])

  const cell = (k: Dimension) => (r: CompanyHealth) => {
    const h = r.rows.find((x) => x.dimension === k)!
    if (!h.checked) return <span className="text-[12px] text-muted" title="Nothing was checked for this reality in this company">not checked</span>
    return <span className="whitespace-nowrap"><span className="num text-ink">{h.agree}</span><span className="text-muted"> of </span><span className="num text-ink2">{h.checked}</span>{h.differ > 0 && <span className="chip warn ml-2">{h.differ} differ</span>}</span>
  }
  const columns: Column<CompanyHealth>[] = [
    { key: 'company', header: 'Company', render: (r) => <span className={cx(r.id ? 'text-ink' : 'font-medium text-gold')}>{r.id ? <><span className="num text-gold">{r.code}</span> · {r.name}</> : r.name}</span>, csv: (r) => r.name },
    ...DIMENSIONS.map<Column<CompanyHealth>>((d) => ({
      key: d.key, header: `${d.label} — agree of checked`, render: cell(d.key),
      csv: (r) => { const h = r.rows.find((x) => x.dimension === d.key)!; return h.checked ? `${h.agree} of ${h.checked} agree, ${h.differ} differ` : 'not checked' },
    })),
    { key: 'never', header: 'Never checked', render: (r) => (r.unchecked.length ? <span className="chip warn" title={r.unchecked.join(' ')}>{r.unchecked.length} kind{r.unchecked.length === 1 ? '' : 's'} of record</span> : <span className="text-muted">—</span>), csv: (r) => r.unchecked.join(' ') },
    { key: 'open', header: '', align: 'right', render: (r) => (r.id && r.findings ? <button className="link text-[12.5px]" onClick={(e) => { e.stopPropagation(); onCompany(r.id!) }}>{r.findings} difference{r.findings === 1 ? '' : 's'}</button> : null) },
  ]

  return (
    <div className="space-y-4">
      <MissingSources missing={data.missing} />
      <Note>Five realities, five separate counts. They are not added into one score: a single number would hide which reality is out. Each count says how many chains were checked and how many of those agree, by the method written under it.</Note>

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {data.health.map((row) => <HealthPanel key={row.dimension} row={row} onOpen={() => onDimension(row.dimension)} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Never checked">
          <Panel className="p-4" lit={false}>
            {data.unchecked.length === 0
              ? <div className="text-[12.5px] text-ink2">Among the records you may read, every active asset has been verified at least once, every cash box counted, stock counted and every bank account has a statement imported.{data.missing.length > 0 && ' This says nothing about the sources named under "Not complete".'}</div>
              : <>
                <ul className="m-0 list-none space-y-2 p-0">
                  {data.unchecked.map((u) => <li key={u} className="flex items-start gap-2.5 text-[13px] text-ink"><ShieldQuestion size={15} className="mt-[2px] flex-none text-warn" /><span>{u}</span></li>)}
                </ul>
                <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted">These are counted in none of the five panels above. They are neither agreeing nor differing: nobody has looked. A physical verification, a cash count, a stock count or an imported statement brings them in.</div>
              </>}
          </Panel>
        </Section>
        <Section title="Sources you may not read">
          <Panel className="p-4" lit={false}>
            {data.missing.length === 0
              ? <div className="text-[12.5px] text-ink2">Your role reads every source the comparison uses, in every company selected.</div>
              : <>
                <div className="flex flex-wrap gap-1.5">{data.missing.map((m) => <span key={m} className="chip warn">{m}</span>)}</div>
                <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted">The chains that depend on these records could not be compared, in some or all of the companies. They are left out of the counts — not counted as agreeing. A person whose role reads them sees a fuller picture.</div>
              </>}
          </Panel>
        </Section>
      </div>

      <Section title="The same five counts, company by company">
        <Panel lit={false}>
          <DataTable columns={columns} rows={byCompany} rowKey={(r) => r.id ?? 'group'} exportName="reality-health-by-company" pageSize={100}
            rowClass={(r) => (r.id ? undefined : 'bg-surface2')}
            toolbar={<span className="text-[12px] text-muted">Every company is compared on its own records. The last line is the whole selection: the counts of the companies, side by side, never netted against each other.</span>} />
        </Panel>
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ differences
function DifferencesTab({ data, ids, manageIds, sp, put }: { data: RealityData; ids: ID[]; manageIds: ID[]; sp: URLSearchParams; put: Put }) {
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const choices = useCompanyChoices(ids)
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const partyName = usePartyName()
  const who = useWho()
  const [selKey, setSelKey] = useState<string | null>(null)
  const [opening, setOpening] = useState<Finding | null>(null)

  const chain = sp.get('chain') ?? ''
  const reality = sp.get('reality') ?? ''
  const company = sp.get('company') ?? ''
  const materialOnly = sp.get('material') === '1'
  const ccyOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency
  const docTypes = useMemo(() => new Map((data.input.invoices ?? []).map((i) => [i.id, i.doc_type as string])), [data.input.invoices])

  const rows = data.findings.filter((f) => (!chain || f.chain === chain) && (!reality || f.differs.includes(reality as Dimension)) && (!company || f.company_id === company) && (!materialOnly || f.material))
  const sel = selKey ? data.findings.find((f) => f.key === selKey) ?? null : null
  const selCase = sel ? data.cases.get(sel.key) ?? null : null
  const threshold = sel ? data.materiality.find((m) => m.company_id === sel.company_id) ?? null : null
  const mayOpen = sel ? manageIds.includes(sel.company_id) : false

  const columns: Column<Finding>[] = [
    { key: 'title', header: 'What differs', render: (f) => <div className="min-w-0 max-w-[460px]"><div className="text-ink">{f.title}</div>{f.party_id && <div className="text-[11px] text-muted">{partyName(f.party_id)}</div>}</div>, sort: (f) => f.title.toLowerCase(), csv: (f) => f.title },
    { key: 'chain', header: 'Chain', render: (f) => <span className="chip" title={CHAIN_WHAT[f.chain]}>{CHAIN_LABEL[f.chain]}</span>, sort: (f) => f.chain, csv: (f) => CHAIN_LABEL[f.chain] },
    { key: 'company', header: 'Company', render: (f) => <span className="text-ink2" title={companyName(f.company_id)}>{code(f.company_id)}</span>, sort: (f) => companyName(f.company_id), csv: (f) => companyName(f.company_id) },
    { key: 'differs', header: 'Realities that differ', render: (f) => <span className="flex flex-wrap gap-1">{f.differs.map((k) => <span key={k} className="chip warn">{DIMENSIONS.find((d) => d.key === k)?.label ?? k}</span>)}</span>, sort: (f) => f.differs.join(','), csv: (f) => f.differs.join(', ') },
    { key: 'amount', header: 'Value at stake', align: 'right', render: (f) => <Money value={f.amount} currency={ccyOf(f.company_id)} className="text-ink" />, sort: (f) => Math.abs(f.amount), csv: (f) => D(f.amount).toFixed(2) },
    { key: 'material', header: 'Against the threshold', render: (f) => (f.material ? <span className="chip gold" title="Above the materiality threshold of the company">material</span> : <span className="chip" title="At or below the materiality threshold of the company. It is still a difference, and it is still shown.">below the threshold</span>), sort: (f) => Number(f.material), csv: (f) => (f.material ? 'Material' : 'Below the threshold') },
    { key: 'date', header: 'Date', render: (f) => <span className="num text-[12.5px]">{fmtDate(f.date)}</span>, sort: (f) => f.date, csv: (f) => f.date },
    {
      key: 'case', header: 'Case', sort: (f) => data.cases.get(f.key)?.case_no ?? '', csv: (f) => data.cases.get(f.key)?.case_no ?? '',
      render: (f) => { const c = data.cases.get(f.key); return c ? <button className="link num text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav('/reality/cases/' + c.id) }}>{c.case_no}</button> : <span className="text-muted">none</span> },
    },
    { key: 'why', header: 'In words', render: (f) => <div className="line-clamp-2 min-w-[240px] max-w-[380px] text-[12px] leading-snug text-ink2" title={f.explanation}>{f.explanation}</div>, csv: (f) => f.explanation },
  ]

  return (
    <div className="space-y-4">
      <MissingSources missing={data.missing} />
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(f) => f.key} onRow={(f) => setSelKey(f.key)} exportName="reality-differences"
          toolbar={<>
            <select className="field sm" style={{ width: 150 }} aria-label="Chain" value={chain} onChange={(e) => put({ chain: e.target.value || null })}>
              <option value="">Every chain</option>{(Object.keys(CHAIN_LABEL) as Chain[]).map((k) => <option key={k} value={k}>{CHAIN_LABEL[k]}</option>)}
            </select>
            <select className="field sm" style={{ width: 170 }} aria-label="Reality that differs" value={reality} onChange={(e) => put({ reality: e.target.value || null })}>
              <option value="">Every reality</option>{DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label} differs</option>)}
            </select>
            <select className="field sm" style={{ width: 190 }} aria-label="Company" value={company} onChange={(e) => put({ company: e.target.value || null })}>
              <option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink2"><input type="checkbox" checked={materialOnly} onChange={(e) => put({ material: e.target.checked ? '1' : null })} /> Material only</label>
            <span className="text-[12px] text-muted">{rows.length} of {data.findings.length} · most valuable first</span>
          </>}
          empty={data.findings.length
            ? { title: 'No difference matches the filter', body: 'Differences exist outside this filter. Clear the filter to see them all.' }
            : { title: 'No difference was found', body: data.missing.length || data.unchecked.length ? 'Among the chains that could be compared, the realities agree. Some records were never checked or are not readable by your role: see Reality health.' : 'In every chain that was compared, the realities agree.', icon: <Scale size={20} /> }} />
      </Panel>

      <Drawer open={!!sel} onClose={() => setSelKey(null)} width={680} title={sel?.title ?? ''}
        subtitle={sel && <>{CHAIN_LABEL[sel.chain]} chain · {CHAIN_WHAT[sel.chain]} · {companyName(sel.company_id)}</>}
        footer={sel && (selCase
          ? <button className="btn primary" onClick={() => nav('/reality/cases/' + selCase.id)}><FolderOpen size={15} /> Open the case {selCase.case_no}</button>
          : <button className="btn primary" disabled={!mayOpen} title={mayOpen ? 'Opens a case on this difference, with the readings and the records' : 'You need the permission reality.manage in this company'} onClick={() => setOpening(sel)}><Plus size={15} /> Open a case</button>)}>
        {sel && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {sel.differs.map((k) => <span key={k} className="chip warn">{DIMENSIONS.find((d) => d.key === k)?.label} differs</span>)}
              {sel.material ? <span className="chip gold">material</span> : <span className="chip">below the threshold</span>}
              {selCase && <StatusChip status={selCase.status} label={`case ${human(selCase.status)}`} />}
            </div>

            <Section title="What each reality says">
              <Readings readings={sel.readings} differs={sel.differs} currency={ccyOf(sel.company_id)} />
            </Section>

            <Section title="The difference, in words">
              <Panel className="p-4 text-[13px] leading-relaxed text-ink2" lit={false}>{sel.explanation}</Panel>
            </Section>

            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Value at stake"><Money value={sel.amount} currency={ccyOf(sel.company_id)} /></Fact>
              <Fact label="Date"><span className="num">{fmtDate(sel.date)}</span></Fact>
              <Fact label="Party">{sel.party_id ? <button className="link" onClick={() => nav('/parties/' + sel.party_id)}>{partyName(sel.party_id)}</button> : '—'}</Fact>
              <Fact label="Company">{companyName(sel.company_id)}</Fact>
              <Fact label="Materiality threshold of the company" className="sm:col-span-2">
                {threshold
                  ? <><Money value={threshold.amount} currency={ccyOf(sel.company_id)} /> <span className="text-muted">· set by {who(threshold.set_by)} on {fmtDateTime(threshold.set_at)}{threshold.note ? ` · ${threshold.note}` : ''}</span></>
                  : <span className="text-ink2">None is set, so every difference counts as material.</span>}
                <div className="mt-1 text-[11.5px] text-muted">{sel.material ? 'This difference is above the threshold.' : 'This difference is at or below the threshold. It is still a difference: it is shown, it can be taken up in a case, and nothing is erased.'}</div>
              </Fact>
            </Panel>

            <Section title="The records">
              <Panel className="p-1.5" lit={false}><RecordLinks links={sel.links} docTypes={docTypes} /></Panel>
            </Section>

            <div className="text-[11.5px] text-muted">NUMERO states what the records show. It does not say why, and it changes nothing in the books. Whether this is timing, an entry not yet made, or an error is for a person to establish.</div>
          </div>
        )}
      </Drawer>

      <CaseFromFinding finding={opening} currency={opening ? ccyOf(opening.company_id) : undefined} onClose={() => setOpening(null)} onOpened={(id) => { setOpening(null); nav('/reality/cases/' + id) }} />
    </div>
  )
}

function CaseFromFinding({ finding, currency, onClose, onOpened }: { finding: Finding | null; currency?: string; onClose: () => void; onOpened: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [title, setTitle] = useState('')
  const [attention, setAttention] = useState<AttentionClass>('finance_action')
  const [owner, setOwner] = useState<{ user: ID | null; name: string }>({ user: null, name: '' })
  useEffect(() => { if (finding) { setTitle(finding.title); setAttention(finding.material ? 'management_action' : 'finance_action'); setOwner({ user: null, name: '' }) } }, [finding])
  const problem = !title.trim() ? 'A case needs a title.' : null
  const submit = () => {
    if (!finding) return
    void act(() => api.openCase({
      company_id: finding.company_id, kind: 'reality', title: title.trim(), summary: finding.explanation, attention, amount: D(finding.amount).toDecimalPlaces(2).toNumber(),
      owner_user: owner.user, owner_name: owner.name.trim() || undefined, links: finding.links,
      finding: { ...finding.readings, differs: finding.differs, chain: finding.chain, as_at: finding.date, material: finding.material }, dedupe_key: finding.key,
    }), 'Case opened').then((id) => { if (id) onOpened(id) })
  }
  return (
    <Modal open={!!finding} onClose={onClose} title="Open a case" subtitle="The readings, the explanation and the records are copied into the case as they stand now." width={620}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <FolderOpen size={15} />} Open the case</button></>}>
      {finding && (
        <div className="space-y-4">
          <Field label="Title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
          <Field label="What was found" hint="Taken from the difference. It is not edited here: what people find out is added to the case as notes.">
            <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">{finding.explanation}</div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who is expected to attend to it">
              <select className="field" value={attention} onChange={(e) => setAttention(e.target.value as AttentionClass)}>{ATTENTION.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
            </Field>
            <Field label="Value at stake"><div className="field flex items-center"><Money value={finding.amount} currency={currency} /></div></Field>
          </div>
          <div><span className="label">Owner of the case (optional)</span><OwnerPicker companyId={finding.company_id} userId={owner.user} name={owner.name} onChange={(user, name) => setOwner({ user, name })} /></div>
          <div className="text-[11.5px] text-muted">The same difference is one case, however often it is found: if a case already exists on it, that case is opened instead of a second one.</div>
          {problem && <div className="text-[12px] text-warn">{problem}</div>}
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ cases
function CasesTab({ cases, ids, manageIds, sp, put }: { cases: Case[]; ids: ID[]; manageIds: ID[]; sp: URLSearchParams; put: Put }) {
  // a case is opened by a person who manages Reality, or, for an incident, by a person who reviews alerts
  const caseIds = ids.filter((id) => manageIds.includes(id) || can('sentinel.review', id))
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const choices = useCompanyChoices(ids)
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const who = useWho()
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [attention, setAttention] = useState('')
  const status = sp.get('status') ?? ''
  const company = sp.get('company') ?? ''
  const ccyOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency
  const ownerOf = (c: Case) => c.owner_name || (c.owner_user ? who(c.owner_user) : '')

  const text = q.trim().toLowerCase()
  const rows = cases.filter((c) => (!status || (status === 'not_closed' ? c.status !== 'closed' : c.status === status)) && (!kind || c.kind === kind) && (!attention || c.attention === attention) && (!company || c.company_id === company)
    && (!text || `${c.case_no} ${c.title} ${c.summary ?? ''} ${ownerOf(c)}`.toLowerCase().includes(text)))

  const columns: Column<Case>[] = [
    { key: 'no', header: 'Number', render: (c) => <span className="num text-[12.5px] text-gold">{c.case_no}</span>, sort: (c) => c.case_no, csv: (c) => c.case_no },
    { key: 'title', header: 'Title', render: (c) => <div className="min-w-0 max-w-[420px]"><div className="truncate text-ink" title={c.title}>{c.title}</div>{c.confidentiality !== 'internal' && <div className="text-[11px] text-violet">{human(c.confidentiality)}</div>}</div>, sort: (c) => c.title.toLowerCase(), csv: (c) => c.title },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{code(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'kind', header: 'Kind', render: (c) => <span className="chip">{caseKindLabel(c.kind)}</span>, sort: (c) => c.kind, csv: (c) => caseKindLabel(c.kind) },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} />, sort: (c) => CASE_STATUSES.indexOf(c.status), csv: (c) => human(c.status) },
    { key: 'attention', header: 'Attention', render: (c) => <AttentionChip value={c.attention} />, sort: (c) => ATTENTION.findIndex((a) => a.key === c.attention), csv: (c) => human(c.attention) },
    { key: 'amount', header: 'Amount', align: 'right', render: (c) => (c.amount === null ? <span className="text-muted">—</span> : <Money value={c.amount} currency={ccyOf(c.company_id)} />), sort: (c) => D(c.amount).toNumber(), csv: (c) => (c.amount === null ? '' : D(c.amount).toFixed(2)) },
    { key: 'owner', header: 'Owner', render: (c) => (ownerOf(c) ? <span className="text-ink2">{ownerOf(c)}</span> : <span className="text-warn">nobody yet</span>), sort: (c) => ownerOf(c).toLowerCase(), csv: (c) => ownerOf(c) },
    { key: 'opened', header: 'Opened', render: (c) => <span className="num text-[12.5px]">{fmtDate(c.opened_at.slice(0, 10))}</span>, sort: (c) => c.opened_at, csv: (c) => c.opened_at.slice(0, 10) },
  ]

  return (
    <div className="space-y-4">
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} onRow={(c) => nav('/reality/cases/' + c.id)} exportName="cases" initialSort={{ key: 'opened', dir: 'desc' }}
          toolbar={<>
            <input className="field sm" style={{ width: 200 }} placeholder="Search number, title, owner" aria-label="Search cases" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="field sm" style={{ width: 160 }} aria-label="Status" value={status} onChange={(e) => put({ status: e.target.value || null })}>
              <option value="">Every status</option><option value="not_closed">Not closed</option>{CASE_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
            </select>
            <select className="field sm" style={{ width: 200 }} aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Every kind</option>{CASE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select className="field sm" style={{ width: 180 }} aria-label="Attention" value={attention} onChange={(e) => setAttention(e.target.value)}>
              <option value="">Every class of attention</option>{ATTENTION.map((a) => <option key={a.key} value={a.key}>{human(a.key)}</option>)}
            </select>
            <select className="field sm" style={{ width: 180 }} aria-label="Company" value={company} onChange={(e) => put({ company: e.target.value || null })}>
              <option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!caseIds.length} title={caseIds.length ? undefined : 'You need the permission reality.manage, or sentinel.review for an incident, to open a case'} onClick={() => setAdding(true)}><Plus size={13} /> Open a case</button>
          </>}
          empty={cases.length
            ? { title: 'No case matches the filter', body: 'Cases exist outside this filter.' }
            : { title: 'No case is shared with you', body: 'No case has been opened in the selected companies, or the cases that exist are classified above your clearance.', icon: <FolderOpen size={20} /> }} />
      </Panel>
      <div className="text-[11.5px] text-muted">A case is where people record what they found and decided. Its history is only ever added to. Cases classified above your clearance are not listed.</div>
      <CaseForm open={adding} companyIds={caseIds} onClose={() => setAdding(false)} onOpened={(id) => { setAdding(false); nav('/reality/cases/' + id) }} />
    </div>
  )
}

function CaseForm({ open, companyIds, onClose, onOpened }: { open: boolean; companyIds: ID[]; onClose: () => void; onOpened: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const kindsFor = (company: ID) => CASE_KINDS.filter((k) => !!company && can(caseRight(k.key), company))
  const blank = { company_id: '', kind: 'other' as CaseKind, title: '', summary: '', attention: 'finance_action' as AttentionClass, amount: '', owner_user: null as ID | null, owner_name: '', confidentiality: 'internal' as Confidentiality }
  const [v, setV] = useState(blank)
  const first = (company: ID) => (kindsFor(company).find((k) => k.key === 'incident') ?? kindsFor(company).find((k) => k.key === 'other') ?? kindsFor(company)[0])?.key ?? 'other'
  useEffect(() => { if (open) { const company = choices[0]?.id ?? ''; setV({ ...blank, company_id: company, kind: first(company) }) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const problem = !v.company_id ? 'Choose the company.' : !kindsFor(v.company_id).some((k) => k.key === v.kind) ? `A case of this kind needs the permission ${caseRight(v.kind)} in this company.` : !v.title.trim() ? 'A case needs a title.' : !v.summary.trim() ? 'Say what was found or reported.' : null
  const submit = () => void act(() => api.openCase({
    company_id: v.company_id, kind: v.kind, title: v.title.trim(), summary: v.summary.trim(), attention: v.attention, amount: v.amount ? D(v.amount).toNumber() : undefined,
    owner_user: v.owner_user, owner_name: v.owner_name.trim() || undefined, confidentiality: v.confidentiality,
  }), 'Case opened').then((id) => { if (id) onOpened(id) })
  return (
    <Modal open={open} onClose={onClose} title="Open a case" subtitle="For something that did not come from a difference on this screen. Records are linked to it once it is open." width={640}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <FolderOpen size={15} />} Open the case</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} onChange={(e) => setV({ ...v, company_id: e.target.value, kind: kindsFor(e.target.value).some((k) => k.key === v.kind) ? v.kind : first(e.target.value), owner_user: null, owner_name: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Kind" hint={kindsFor(v.company_id).length < CASE_KINDS.length ? 'Kinds your role may not open in this company are not offered.' : undefined}><select className="field" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as CaseKind })}>{kindsFor(v.company_id).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
        <Field label="Title" className="sm:col-span-2"><input className="field" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus /></Field>
        <Field label="What was found or reported" className="sm:col-span-2" hint="State the facts as they are known. What they mean is decided in the case.">
          <textarea className="field" rows={4} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
        </Field>
        <Field label="Who is expected to attend to it"><select className="field" value={v.attention} onChange={(e) => setV({ ...v, attention: e.target.value as AttentionClass })}>{ATTENTION.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
        <Field label="Amount at stake (optional)"><input className="field num" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value) })} /></Field>
        <div className="sm:col-span-2"><span className="label">Owner of the case (optional)</span>{v.company_id ? <OwnerPicker companyId={v.company_id} userId={v.owner_user} name={v.owner_name} onChange={(owner_user, owner_name) => setV({ ...v, owner_user, owner_name })} /> : <div className="text-[12px] text-muted">Choose the company first.</div>}</div>
        <Field label="Confidentiality" hint="People whose clearance is lower will not see the case.">
          <select className="field" value={v.confidentiality} onChange={(e) => setV({ ...v, confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
        </Field>
      </div>
      {problem && (v.title || v.summary) && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ physical verification
export const verificationSummary = (r: VerificationRun): { lines: number; agree: number; differ: number; notChecked: number; bookValue: string | null; bookValueOfDifferences: string | null; method: string | null } | null => {
  const s = r.summary ?? {}
  if (r.status !== 'completed' || typeof s.lines !== 'number') return null
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  const t = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
  return { lines: n(s.lines), agree: n(s.agree), differ: n(s.differ), notChecked: n(s.not_checked), bookValue: t(s.book_value), bookValueOfDifferences: t(s.book_value_of_differences), method: t(s.method) }
}
export const verifySubjectLabel = (s: VerifySubject) => SUBJECT_LABEL[s] ?? human(s)

function VerificationTab({ runs, ids, manageIds }: { runs: VerificationRun[]; ids: ID[]; manageIds: ID[] }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const choices = useCompanyChoices(ids)
  const [adding, setAdding] = useState(false)
  const [subject, setSubject] = useState('')
  const [company, setCompany] = useState('')
  const rows = runs.filter((r) => (!subject || r.subject === subject) && (!company || r.company_id === company))

  const columns: Column<VerificationRun>[] = [
    { key: 'no', header: 'Number', render: (r) => <span className="num text-[12.5px] text-gold">{r.verify_no}</span>, sort: (r) => r.verify_no, csv: (r) => r.verify_no },
    { key: 'subject', header: 'What is verified', render: (r) => <span className="chip cyan">{verifySubjectLabel(r.subject)}</span>, sort: (r) => r.subject, csv: (r) => verifySubjectLabel(r.subject) },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companyName(r.company_id)}>{code(r.company_id)}</span>, sort: (r) => companyName(r.company_id), csv: (r) => companyName(r.company_id) },
    { key: 'date', header: 'Date', render: (r) => <span className="num text-[12.5px]">{fmtDate(r.run_date)}</span>, sort: (r) => r.run_date, csv: (r) => r.run_date },
    { key: 'by', header: 'Performed by', render: (r) => <div><div className="text-ink2">{r.performed_by_name ?? '—'}</div>{r.witness_name && <div className="text-[11px] text-muted">witness: {r.witness_name}</div>}</div>, sort: (r) => (r.performed_by_name ?? '').toLowerCase(), csv: (r) => r.performed_by_name ?? '' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status === 'open' ? 'in_progress' : r.status} label={r.status === 'open' ? 'in progress' : undefined} />, sort: (r) => r.status, csv: (r) => (r.status === 'open' ? 'in progress' : r.status) },
    {
      key: 'summary', header: 'What was found', csv: (r) => { const s = verificationSummary(r); return s ? `${s.agree} agree, ${s.differ} differ, ${s.notChecked} not checked, of ${s.lines}` : '' },
      render: (r) => {
        const s = verificationSummary(r)
        if (!s) return <span className="text-[12.5px] text-muted">{r.status === 'open' ? 'Not completed yet' : '—'}</span>
        return <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]"><span className="chip pos">{s.agree} agree</span>{s.differ > 0 && <span className="chip warn">{s.differ} differ</span>}{s.notChecked > 0 && <span className="chip" title="Not checked is counted neither as agreeing nor as differing">{s.notChecked} not checked</span>}<span className="text-muted">of {s.lines}</span></span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Note>A physical verification records what a person found when they went and looked. It changes nothing in the books. What differs is taken up in a case, and corrected by the documents of its own area: an asset disposal, a stock count adjustment, a cash voucher.</Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRow={(r) => nav('/reality/verifications/' + r.id)} exportName="physical-verifications"
          toolbar={<>
            <select className="field sm" style={{ width: 170 }} aria-label="What is verified" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Everything verified</option>{(Object.keys(SUBJECT_LABEL) as VerifySubject[]).map((k) => <option key={k} value={k}>{SUBJECT_LABEL[k]}</option>)}
            </select>
            <select className="field sm" style={{ width: 190 }} aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!manageIds.length} title={noManageText(manageIds)} onClick={() => setAdding(true)}><ClipboardCheck size={13} /> Start a verification</button>
          </>}
          empty={runs.length ? { title: 'No verification matches the filter' } : { title: 'No physical verification has been recorded', body: 'Until somebody goes and looks, the physical reality of assets, stock, cash and documents is not known — it is not assumed to agree.', icon: <ClipboardCheck size={20} /> }} />
      </Panel>
      <VerificationForm open={adding} companyIds={manageIds} onClose={() => setAdding(false)} onOpened={(id) => { setAdding(false); nav('/reality/verifications/' + id) }} />
    </div>
  )
}

interface Choice { id: ID; label: string }
interface Source { need: string | null; options: Choice[] }

function VerificationForm({ open, companyIds, onClose, onOpened }: { open: boolean; companyIds: ID[]; onClose: () => void; onOpened: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const blank = { company_id: '', subject: 'assets' as VerifySubject, run_date: today(), warehouse_id: '', category_id: '', location: '', box_id: '', doc_kind: '', performed_by_name: '', witness_name: '', note: '' }
  const [v, setV] = useState(blank)
  useEffect(() => { if (open) setV({ ...blank, company_id: choices[0]?.id ?? '' }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // what can be chosen as the scope is read under the permission of its own area
  const source = useAsync<Source | null>(async () => {
    const c = v.company_id
    if (!open || !c) return null
    if (v.subject === 'inventory') return can('inventory.view', c) ? { need: null, options: (await api.listWarehouses([c])).filter((w) => w.is_active).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` })) } : { need: 'inventory.view', options: [] }
    if (v.subject === 'assets') return can('asset.view', c) ? { need: null, options: (await api.listAssetCategories([c])).filter((x) => x.is_active).map((x) => ({ id: x.id, label: x.name })) } : { need: 'asset.view', options: [] }
    if (v.subject === 'cash') return can('treasury.view', c) ? { need: null, options: (await api.listCashBoxes([c])).filter((b) => b.is_active).map((b) => ({ id: b.id, label: b.name })) } : { need: 'treasury.view', options: [] }
    return { need: null, options: [] }
  }, [api, open, v.company_id, v.subject])
  const src = source.data

  const problem = !v.company_id ? 'Choose the company.' : !v.run_date ? 'Choose the date.' : v.run_date > today() ? 'A verification cannot be dated in the future.'
    : v.subject === 'inventory' && !v.warehouse_id ? 'Choose the location whose stock is verified.' : !v.performed_by_name.trim() ? 'Say who performs the verification.' : null
  const submit = () => {
    const scope: Record<string, string> = {}
    if (v.subject === 'inventory') scope.warehouse_id = v.warehouse_id
    if (v.subject === 'assets') { if (v.category_id) scope.category_id = v.category_id; if (v.location.trim()) scope.location = v.location.trim() }
    if (v.subject === 'cash' && v.box_id) scope.box_id = v.box_id
    if (v.subject === 'documents' && v.doc_kind) scope.doc_kind = v.doc_kind
    void act(() => api.openVerification({ company_id: v.company_id, subject: v.subject, run_date: v.run_date, scope, performed_by_name: v.performed_by_name.trim(), witness_name: v.witness_name.trim() || undefined, note: v.note.trim() || undefined }), 'Verification sheet prepared')
      .then((id) => { if (id) onOpened(id) })
  }
  const need = src?.need ? <div className="rounded-lg bg-warnsoft px-3 py-2 text-[12px] text-ink2">Your role does not include <span className="num">{src.need}</span> in this company, so the list cannot be read. {v.subject === 'inventory' ? 'A verification of stock needs its location.' : 'The verification can still be started for everything in the company.'}</div> : null

  return (
    <Modal open={open} onClose={onClose} title="Start a verification" subtitle="Prepares the sheet from what the books say exists. What is found is entered on the sheet." width={640}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <ClipboardCheck size={15} />} Prepare the sheet</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} onChange={(e) => setV({ ...v, company_id: e.target.value, warehouse_id: '', category_id: '', box_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="What is verified"><select className="field" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value as VerifySubject })}>{(Object.keys(SUBJECT_LABEL) as VerifySubject[]).map((k) => <option key={k} value={k}>{SUBJECT_LABEL[k]}</option>)}</select></Field>
        <Field label="Date of the verification"><input type="date" className="field" value={v.run_date} max={today()} onChange={(e) => setV({ ...v, run_date: e.target.value })} /></Field>

        {v.subject === 'inventory' && (
          <Field label="Location (required)" hint="Every item the stock ledger shows in this location goes on the sheet.">
            <select className="field" value={v.warehouse_id} disabled={!!src?.need} onChange={(e) => setV({ ...v, warehouse_id: e.target.value })}><option value="">{source.loading ? 'Loading…' : 'Choose…'}</option>{(src?.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </Field>
        )}
        {v.subject === 'assets' && <>
          <Field label="Category (optional)"><select className="field" value={v.category_id} disabled={!!src?.need} onChange={(e) => setV({ ...v, category_id: e.target.value })}><option value="">Every category</option>{(src?.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
          <Field label="Location contains (optional)" hint="Only assets whose recorded location contains this text." className="sm:col-span-2"><input className="field" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} placeholder="For example: Head office" /></Field>
        </>}
        {v.subject === 'cash' && <Field label="Cash box (optional)"><select className="field" value={v.box_id} disabled={!!src?.need} onChange={(e) => setV({ ...v, box_id: e.target.value })}><option value="">Every active cash box</option>{(src?.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>}
        {v.subject === 'documents' && <Field label="Kind of document (optional)"><select className="field" value={v.doc_kind} onChange={(e) => setV({ ...v, doc_kind: e.target.value })}><option value="">Every kind</option>{DOCUMENT_KINDS.filter((k) => k.key !== 'unclassified').map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>}
        {need && <div className="sm:col-span-2">{need}</div>}

        <Field label="Performed by"><input className="field" value={v.performed_by_name} onChange={(e) => setV({ ...v, performed_by_name: e.target.value })} placeholder="Name or team" /></Field>
        <Field label="Witness (optional)"><input className="field" value={v.witness_name} onChange={(e) => setV({ ...v, witness_name: e.target.value })} /></Field>
        <Field label="Note (optional)" className="sm:col-span-2"><textarea className="field" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
      <div className="mt-3 text-[11.5px] text-muted">The sheet lists only records you are cleared to see. If nothing in the books falls within what was chosen, no sheet is prepared and the reason is stated.</div>
      {problem && v.performed_by_name !== '' && <div className="mt-2 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ confirmations from outside
const isQuantity = (c: Pick<Confirmation, 'subject'>) => c.subject === 'investment'
/** A balance of a confirmation: an amount, except for an investment, where what is confirmed is a quantity held. */
function Balance({ c, value, colored }: { c: Confirmation; value: string | number | null; colored?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>
  if (isQuantity(c)) { const q = D(value); return <span className={cx('num', colored && !q.isZero() && 'text-warn')}>{colored && q.gt(0) ? '+' : ''}{q.toString()} <span className="text-[11px] text-muted">units</span></span> }
  return <Money value={value} currency={c.currency} sign={colored} className={colored && !D(value).isZero() ? 'text-warn' : undefined} />
}

function ConfirmationsTab({ rows: all, cases, ids, manageIds, sp, put }: { rows: Confirmation[]; cases: Case[]; ids: ID[]; manageIds: ID[]; sp: URLSearchParams; put: Put }) {
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const choices = useCompanyChoices(ids)
  const [adding, setAdding] = useState(false)
  const [subject, setSubject] = useState('')
  const [status, setStatus] = useState('')
  const [company, setCompany] = useState('')
  const openId = sp.get('open')
  const sel = openId ? all.find((c) => c.id === openId) ?? null : null
  const rows = all.filter((c) => (!subject || c.subject === subject) && (!status || c.status === status) && (!company || c.company_id === company))

  const columns: Column<Confirmation>[] = [
    { key: 'no', header: 'Number', render: (c) => <span className="num text-[12.5px] text-gold">{c.confirm_no}</span>, sort: (c) => c.confirm_no, csv: (c) => c.confirm_no },
    { key: 'subject', header: 'Confirmed with', render: (c) => <span className="chip cyan">{CONFIRM_LABEL[c.subject]}</span>, sort: (c) => c.subject, csv: (c) => CONFIRM_LABEL[c.subject] },
    { key: 'label', header: 'Counterparty', render: (c) => <div className="min-w-0 max-w-[300px]"><div className="truncate text-ink" title={c.label}>{c.label}</div>{c.confidentiality !== 'internal' && <div className="text-[11px] text-violet">{human(c.confidentiality)}</div>}</div>, sort: (c) => c.label.toLowerCase(), csv: (c) => c.label },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{code(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'asof', header: 'As at', render: (c) => <span className="num text-[12.5px]">{fmtDate(c.as_of)}</span>, sort: (c) => c.as_of, csv: (c) => c.as_of },
    { key: 'book', header: 'In the books', align: 'right', render: (c) => <span title={c.book_basis}><Balance c={c} value={c.book_balance} /></span>, sort: (c) => D(c.book_balance).toNumber(), csv: (c) => D(c.book_balance).toString() },
    { key: 'confirmed', header: 'Confirmed by the other side', align: 'right', render: (c) => (c.confirmed_balance === null ? <span className="text-[12.5px] text-muted">no reply recorded</span> : <Balance c={c} value={c.confirmed_balance} />), sort: (c) => D(c.confirmed_balance).toNumber(), csv: (c) => (c.confirmed_balance === null ? '' : D(c.confirmed_balance).toString()) },
    { key: 'diff', header: 'Difference', align: 'right', render: (c) => (c.difference === null ? <span className="text-muted">—</span> : <Balance c={c} value={c.difference} colored />), sort: (c) => D(c.difference).abs().toNumber(), csv: (c) => (c.difference === null ? '' : D(c.difference).toString()) },
    { key: 'unit', header: 'Measured in', render: (c) => <span className="text-[12px] text-muted">{isQuantity(c) ? 'quantity' : c.currency}</span>, sort: (c) => (isQuantity(c) ? 'quantity' : c.currency), csv: (c) => (isQuantity(c) ? 'quantity' : c.currency) },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} label={CONFIRM_STATUS[c.status]} />, sort: (c) => c.status, csv: (c) => CONFIRM_STATUS[c.status] },
    { key: 'basis', header: 'Basis of the balance in the books', render: (c) => <div className="line-clamp-2 min-w-[220px] max-w-[340px] text-[12px] leading-snug text-muted" title={c.book_basis}>{c.book_basis}</div>, csv: (c) => c.book_basis },
  ]

  return (
    <div className="space-y-4">
      <Note>NUMERO prepares a confirmation and records the reply. It sends nothing: a person sends the request and receives the answer. For an intercompany balance nothing is sent at all — the books of the other company are read, if you may read them.</Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} onRow={(c) => put({ open: c.id })} exportName="confirmations"
          rowClass={(c) => (c.status === 'difference' || c.status === 'disputed' ? 'bg-warnsoft' : undefined)}
          toolbar={<>
            <select className="field sm" style={{ width: 170 }} aria-label="Confirmed with" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Every counterparty</option>{(Object.keys(CONFIRM_LABEL) as ConfirmSubject[]).map((k) => <option key={k} value={k}>{CONFIRM_LABEL[k]}</option>)}
            </select>
            <select className="field sm" style={{ width: 210 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Every status</option>{(Object.keys(CONFIRM_STATUS) as Confirmation['status'][]).map((k) => <option key={k} value={k}>{CONFIRM_STATUS[k]}</option>)}
            </select>
            <select className="field sm" style={{ width: 190 }} aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!manageIds.length} title={noManageText(manageIds)} onClick={() => setAdding(true)}><MailCheck size={13} /> Prepare a confirmation</button>
          </>}
          empty={all.length ? { title: 'No confirmation matches the filter' } : { title: 'No confirmation is shared with you', body: 'No balance has been confirmed with anybody outside in the selected companies, or the confirmations that exist are classified above your clearance.', icon: <MailCheck size={20} /> }} />
      </Panel>
      <ConfirmationDrawer c={sel} existing={sel ? cases.find((x) => x.dedupe_key === 'confirmation:' + sel.id) ?? null : null} mayManage={sel ? manageIds.includes(sel.company_id) : false} onClose={() => put({ open: null })} />
      {openId && !sel && <Note kind="warn">The confirmation you opened was not found or is not shared with you.</Note>}
      <ConfirmationForm open={adding} companyIds={manageIds} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); put({ open: id }) }} />
    </div>
  )
}

function ConfirmationForm({ open, companyIds, onClose, onSaved }: { open: boolean; companyIds: ID[]; onClose: () => void; onSaved: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const blank = { company_id: '', subject: 'bank' as ConfirmSubject, as_of: endOfMonth(addMonths(today(), -1)), target: '', contact: '', confidentiality: 'internal' as Confidentiality }
  const [v, setV] = useState(blank)
  const [find, setFind] = useState('')
  useEffect(() => { if (open) { setV({ ...blank, company_id: choices[0]?.id ?? '' }); setFind('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const byParty = v.subject === 'customer' || v.subject === 'vendor'

  const source = useAsync<Source | null>(async () => {
    const c = v.company_id
    if (!open || !c) return null
    const gate = async (perm: string, load: () => Promise<Choice[]>): Promise<Source> => (can(perm, c) ? { need: null, options: await load() } : { need: perm, options: [] })
    if (v.subject === 'bank') return gate('bank.view', async () => (await api.listBankAccounts([c])).map((b) => ({ id: b.id, label: `${b.name}${b.account_no_masked ? ' · ' + b.account_no_masked : ''} · ${b.currency}` })))
    if (v.subject === 'loan') return gate('treasury.view', async () => (await api.listLoans([c])).filter((x) => x.status !== 'cancelled').map((x) => ({ id: x.id, label: `${x.loan_no} · ${x.name} · ${x.direction === 'borrowed' ? 'taken' : 'given'}` })))
    if (v.subject === 'deposit') return gate('treasury.view', async () => (await api.listFixedDeposits([c])).filter((x) => x.status !== 'cancelled' && x.status !== 'draft').map((x) => ({ id: x.id, label: `${x.fd_no} · ${x.bank_name}` })))
    if (v.subject === 'investment') return gate('investment.view', async () => (await api.listHoldings([c])).map((x) => ({ id: x.id, label: `${x.holding_no} · ${x.name}` })))
    if (v.subject === 'intercompany') return { need: null, options: companies.filter((x) => x.id !== c).map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` })) }
    const own = parties.filter((p) => p.roles.some((r) => r.company_id === c))
    return { need: null, options: (own.length ? own : parties).map((p) => ({ id: p.id, label: `${p.display_name} · ${p.party_no}` })).sort((a, b) => a.label.localeCompare(b.label)) }
  }, [api, open, v.company_id, v.subject, parties, companies])
  const src = source.data
  const text = find.trim().toLowerCase()
  const options = (src?.options ?? []).filter((o) => !byParty || !text || o.label.toLowerCase().includes(text) || o.id === v.target)

  const what: Record<ConfirmSubject, string> = { bank: 'Bank account', customer: 'Customer', vendor: 'Vendor', loan: 'Loan', deposit: 'Fixed deposit', investment: 'Investment', intercompany: 'The other company of the group' }
  const problem = !v.company_id ? 'Choose the company.' : src?.need ? `Your role does not include ${src.need} in this company.` : !v.target ? `Choose the ${what[v.subject].toLowerCase()}.` : !v.as_of ? 'State the date as at which the balance is confirmed.' : v.as_of > today() ? 'A balance cannot be confirmed as at a future date.' : null
  const submit = () => void act(() => api.saveConfirmation({
    company_id: v.company_id, subject: v.subject, as_of: v.as_of, contact: v.subject === 'intercompany' ? undefined : v.contact.trim() || undefined, confidentiality: v.confidentiality,
    ...(byParty ? { party_id: v.target } : v.subject === 'intercompany' ? { counter_company_id: v.target } : { entity_id: v.target }),
  }), v.subject === 'intercompany' ? 'The two sets of books were compared' : 'Confirmation prepared — nothing has been sent').then((id) => { if (id) onSaved(id) })

  return (
    <Modal open={open} onClose={onClose} title="Prepare a confirmation" subtitle="Works out the balance in the books as at the date, with its basis, ready for a person to send." width={640}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy || source.loading} onClick={submit}>{busy ? <Spinner /> : <MailCheck size={15} />} {v.subject === 'intercompany' ? 'Compare the two sets of books' : 'Prepare'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} onChange={(e) => setV({ ...v, company_id: e.target.value, target: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Confirmed with"><select className="field" value={v.subject} onChange={(e) => { setV({ ...v, subject: e.target.value as ConfirmSubject, target: '' }); setFind('') }}>{(Object.keys(CONFIRM_LABEL) as ConfirmSubject[]).map((k) => <option key={k} value={k}>{CONFIRM_LABEL[k]}</option>)}</select></Field>
        {byParty && <Field label="Find the party"><input className="field" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type part of the name or number" /></Field>}
        <Field label={what[v.subject]} className={byParty ? undefined : 'sm:col-span-2'} hint={src && !src.need && !source.loading && src.options.length === 0 ? 'Nothing of this kind is recorded in this company, or none is shared with you.' : undefined}>
          <select className="field" value={v.target} disabled={!!src?.need} onChange={(e) => setV({ ...v, target: e.target.value })}><option value="">{source.loading ? 'Loading…' : 'Choose…'}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        <Field label="As at"><input type="date" className="field" value={v.as_of} max={today()} onChange={(e) => setV({ ...v, as_of: e.target.value })} /></Field>
        {v.subject !== 'intercompany' && <Field label="Contact at the other side (optional)" hint="The person or the address the request goes to."><input className="field" value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>}
        <Field label="Confidentiality" hint="People whose clearance is lower will not see it.">
          <select className="field" value={v.confidentiality} onChange={(e) => setV({ ...v, confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
        </Field>
      </div>
      {src?.need && <div className="mt-3 rounded-lg bg-warnsoft px-3 py-2 text-[12px] text-ink2">Your role does not include <span className="num">{src.need}</span> in this company, so the list cannot be read and this confirmation cannot be prepared by you.</div>}
      {v.subject === 'investment' && <Note kind="warn" className="mt-3">For an investment, what is confirmed is the QUANTITY held — units or shares — not an amount of money. The balance in the books is the quantity from purchases and sales posted up to the date.</Note>}
      {v.subject === 'intercompany' && <Note className="mt-3">Nothing is sent. The balance in our intercompany ledgers is set against the balance the other company carries for us, which is read from its books if you may read them.</Note>}
      {problem && v.target !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

type ConfirmMode = 'sent' | 'reply' | 'explained' | 'disputed' | 'no_reply' | null

function ConfirmationDrawer({ c, existing, mayManage, onClose }: { c: Confirmation | null; existing: Case | null; mayManage: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companyName = useCompanyName()
  const partyName = usePartyName()
  const who = useWho()
  const { act, busy } = useAction()
  const [mode, setMode] = useState<ConfirmMode>(null)
  const [cancelling, setCancelling] = useState(false)
  const [f, setF] = useState({ sent_how: '', sent_on: today(), contact: '', confirmed: '', received_on: today(), document_id: '', explanation: '' })
  const id = c?.id
  useEffect(() => { setMode(null); setCancelling(false); setF({ sent_how: '', sent_on: today(), contact: c?.contact ?? '', confirmed: '', received_on: today(), document_id: '', explanation: c?.explanation ?? '' }) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const companyId = c?.company_id
  const files = useAsync(async () => (id && companyId && can('document.view', companyId) ? api.listDocuments({ companyIds: [companyId], entity: 'confirmations', entityId: id }).catch(() => []) : []), [api, id, companyId])

  const qty = c ? isQuantity(c) : false
  const noManage = mayManage ? undefined : 'You need the permission reality.manage in this company'
  const s = c?.status
  const canSend = s === 'drafted'
  const canReply = s === 'drafted' || s === 'sent' || s === 'no_reply'
  const canExplain = s === 'difference' || s === 'explained' || s === 'disputed'
  const canNoReply = s === 'sent'
  const canCancel = !!s && s !== 'cancelled'
  const done = () => setMode(null)

  const problem = mode === 'sent' ? (!f.sent_how.trim() ? 'Record how and to whom it was sent.' : !f.sent_on ? 'Record the date it was sent.' : f.sent_on > today() ? 'The date it was sent cannot be in the future.' : null)
    : mode === 'reply' ? (f.confirmed.trim() === '' || f.confirmed === '-' ? `State the ${qty ? 'quantity' : 'balance'} the other side confirms.` : !f.received_on ? 'Record the date the reply was received.' : f.received_on > today() ? 'The date of the reply cannot be in the future.' : null)
    : mode === 'explained' || mode === 'disputed' ? (!f.explanation.trim() ? 'Record the explanation.' : null) : null

  const run = () => {
    if (!c || !mode || problem) return
    if (mode === 'sent') void act(() => api.updateConfirmation({ id: c.id, action: 'sent', sent_how: f.sent_how.trim(), sent_on: f.sent_on, contact: f.contact.trim() || undefined }), 'Recorded that it was sent').then((r) => { if (r) done() })
    else if (mode === 'reply') void act(() => api.updateConfirmation({ id: c.id, action: 'reply', confirmed_balance: f.confirmed, received_on: f.received_on, document_id: f.document_id || undefined }), (r) => (r === 'agreed' ? 'The reply agrees with the books' : 'The reply differs from the books')).then((r) => { if (r) done() })
    else if (mode === 'explained' || mode === 'disputed') void act(() => api.updateConfirmation({ id: c.id, action: mode, explanation: f.explanation.trim() }), mode === 'explained' ? 'Explanation recorded' : 'Recorded as disputed').then((r) => { if (r) done() })
    else void act(() => api.updateConfirmation({ id: c.id, action: 'no_reply', explanation: f.explanation.trim() || undefined }), 'Marked as unanswered').then((r) => { if (r) done() })
  }
  const openCase = () => {
    if (!c || c.difference === null) return
    const links: CaseLink[] = [{ entity: 'confirmations', entity_id: c.id, label: c.confirm_no }, ...(c.party_id ? [{ entity: 'parties', entity_id: c.party_id, label: partyName(c.party_id) }] : [])]
    void act(() => api.openCase({
      company_id: c.company_id, kind: 'confirmation', title: `${c.label}: the balance confirmed differs from the books`,
      summary: `Confirmation ${c.confirm_no} as at ${c.as_of}. The books show ${D(c.book_balance).toString()}${qty ? ' units' : ' ' + c.currency}; the other side confirms ${D(c.confirmed_balance).toString()}${qty ? ' units' : ' ' + c.currency}; the difference is ${D(c.difference).toString()}. Basis of the balance in the books: ${c.book_basis}.${c.explanation ? ' Recorded so far: ' + c.explanation : ''}`,
      amount: qty ? undefined : D(c.difference).abs().toDecimalPlaces(2).toNumber(), attention: 'finance_action', links, confidentiality: c.confidentiality, dedupe_key: 'confirmation:' + c.id,
      finding: { confirmation: c.confirm_no, as_at: c.as_of, measured_in: qty ? 'quantity' : c.currency, balance_in_the_books: D(c.book_balance).toString(), basis: c.book_basis, balance_confirmed: D(c.confirmed_balance).toString(), difference: D(c.difference).toString() },
    }), 'Case opened').then((caseId) => { if (caseId) nav('/reality/cases/' + caseId) })
  }

  const head = (t: string, children: ReactNode) => (
    <Panel className="space-y-3 p-4" lit={false}>
      <div className="text-[13px] font-medium text-ink">{t}</div>
      {children}
      {problem && <div className="text-[12px] text-warn">{problem}</div>}
      <div className="flex justify-end gap-2"><button className="btn sm ghost" onClick={done}>Cancel</button><button className="btn sm primary" disabled={!!problem || busy} onClick={run}>{busy ? <Spinner size={13} /> : null} Record</button></div>
    </Panel>
  )

  return (
    <>
      <Drawer open={!!c} onClose={onClose} width={640} title={c ? `${c.confirm_no} · ${c.label}` : ''} subtitle={c && <>{CONFIRM_LABEL[c.subject]} confirmation · as at {fmtDate(c.as_of)} · {companyName(c.company_id)}</>}>
        {c && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={c.status} label={CONFIRM_STATUS[c.status]} />
              {qty && <span className="chip violet" title="What is confirmed for an investment is the quantity held">quantity, not an amount</span>}
              {c.confidentiality !== 'internal' && <span className="chip violet">{human(c.confidentiality)}</span>}
              {existing && <button className="chip gold" onClick={() => nav('/reality/cases/' + existing.id)}>case {existing.case_no}</button>}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-3.5"><div className="eyebrow">In the books</div><div className="display mt-1.5 text-[18px] font-medium"><Balance c={c} value={c.book_balance} /></div></div>
              <div className="rounded-xl border border-line bg-surface p-3.5"><div className="eyebrow">Confirmed by the other side</div><div className="display mt-1.5 text-[18px] font-medium">{c.confirmed_balance === null ? <span className="text-[13px] font-normal text-muted">no reply recorded</span> : <Balance c={c} value={c.confirmed_balance} />}</div></div>
              <div className={cx('rounded-xl border p-3.5', c.difference !== null && !D(c.difference).isZero() ? 'border-warn/30 bg-warnsoft' : 'border-line bg-surface')}><div className="eyebrow">Difference</div><div className="display mt-1.5 text-[18px] font-medium">{c.difference === null ? <span className="text-[13px] font-normal text-muted">not known yet</span> : <Balance c={c} value={c.difference} colored />}</div></div>
            </div>
            <div className="text-[11.5px] text-muted"><span className="text-ink2">Basis of the balance in the books.</span> {c.book_basis}. Difference = balance confirmed − balance in the books.{c.confirmed_balance === null && ' Until a reply is recorded, this balance is not confirmed by anybody outside: it is not shown as agreeing.'}</div>

            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Counterparty">{c.party_id ? <button className="link" onClick={() => nav('/parties/' + c.party_id)}>{partyName(c.party_id)}</button> : c.counter_company_id ? companyName(c.counter_company_id) : c.label}</Fact>
              <Fact label="Contact">{c.contact ?? '—'}</Fact>
              <Fact label="Sent">{c.sent_on ? <><span className="num">{fmtDate(c.sent_on)}</span>{c.sent_how ? ` · ${c.sent_how}` : ''}</> : c.sent_how ?? 'Not sent. NUMERO sends nothing; a person does.'}</Fact>
              <Fact label="Reply received">{c.received_on ? <span className="num">{fmtDate(c.received_on)}</span> : 'None recorded'}</Fact>
              <Fact label="Prepared by">{who(c.created_by)} · {fmtDateTime(c.created_at)}</Fact>
              <Fact label="The record confirmed">{c.entity && c.entity_id && recordRoute({ entity: c.entity, entity_id: c.entity_id }) ? <button className="link" onClick={() => nav(recordRoute({ entity: c.entity!, entity_id: c.entity_id! })!)}>{ENTITY_LABEL[c.entity] ?? human(c.entity)}</button> : c.entity ? ENTITY_LABEL[c.entity] ?? human(c.entity) : '—'}</Fact>
              {c.explanation && <Fact label={c.status === 'cancelled' ? 'Reason it was cancelled' : c.status === 'disputed' ? 'Why it is disputed' : 'Explanation'} className="sm:col-span-2">{c.explanation}</Fact>}
            </Panel>

            {c.status !== 'cancelled' && (
              <Section title="Record what happened">
                <div className="no-print mb-3 flex flex-wrap gap-2">
                  {canSend && <button className="btn sm" disabled={!mayManage} title={noManage ?? 'Records that a person sent it. NUMERO sends nothing.'} onClick={() => setMode('sent')}><Send size={13} /> A person sent it</button>}
                  {canReply && <button className="btn sm primary" disabled={!mayManage} title={noManage} onClick={() => setMode('reply')}><MailCheck size={13} /> Record the reply</button>}
                  {canExplain && <button className="btn sm" disabled={!mayManage} title={noManage} onClick={() => setMode('explained')}>Explain the difference</button>}
                  {canExplain && <button className="btn sm" disabled={!mayManage} title={noManage} onClick={() => setMode('disputed')}>Dispute the difference</button>}
                  {canNoReply && <button className="btn sm" disabled={!mayManage} title={noManage} onClick={() => setMode('no_reply')}>Mark as unanswered</button>}
                  {canExplain && !existing && <button className="btn sm" disabled={!mayManage || busy} title={noManage ?? 'Opens a case on this difference'} onClick={openCase}><FolderOpen size={13} /> Open a case</button>}
                  {canExplain && existing && <button className="btn sm" onClick={() => nav('/reality/cases/' + existing.id)}><FolderOpen size={13} /> Open the case {existing.case_no}</button>}
                  {canCancel && <button className="btn sm danger" disabled={!mayManage} title={noManage} onClick={() => setCancelling(true)}>Cancel the confirmation</button>}
                </div>
                {mode === 'sent' && head('A person sent the request', <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="How and to whom" className="sm:col-span-2" hint="For example: by email to the branch manager; by registered post."><input className="field" value={f.sent_how} onChange={(e) => setF({ ...f, sent_how: e.target.value })} autoFocus /></Field>
                  <Field label="Sent on"><input type="date" className="field" value={f.sent_on} max={today()} onChange={(e) => setF({ ...f, sent_on: e.target.value })} /></Field>
                  <Field label="Contact"><input className="field" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
                </div>)}
                {mode === 'reply' && head('The reply of the other side', <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={qty ? 'Quantity confirmed (units or shares)' : `Balance confirmed (${c.currency})`} hint={qty ? 'A quantity, not an amount of money.' : 'As the other side states it, with a minus sign if it is the other way round.'}>
                    <input className="field num" inputMode="decimal" value={f.confirmed} onChange={(e) => setF({ ...f, confirmed: signed(e.target.value) })} autoFocus />
                  </Field>
                  <Field label="Received on"><input type="date" className="field" value={f.received_on} max={today()} onChange={(e) => setF({ ...f, received_on: e.target.value })} /></Field>
                  <Field label="The reply on file (optional)" className="sm:col-span-2" hint={(files.data ?? []).length ? undefined : 'Attach the reply under Evidence below first, then choose it here.'}>
                    <select className="field" value={f.document_id} onChange={(e) => setF({ ...f, document_id: e.target.value })}><option value="">Not chosen</option>{(files.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  </Field>
                  {f.confirmed.trim() !== '' && f.confirmed !== '-' && <div className="text-[12px] text-ink2 sm:col-span-2">Difference that will be recorded = {D(f.confirmed).toString()} − {D(c.book_balance).toString()} = <span className="num text-ink">{D(f.confirmed).minus(c.book_balance).toString()}</span>{qty ? ' units' : ''}</div>}
                </div>)}
                {(mode === 'explained' || mode === 'disputed') && head(mode === 'explained' ? 'Explain the difference' : 'Dispute the difference', <Field label={mode === 'explained' ? 'What explains it' : 'What is disputed, and why'} hint="A difference is often timing: items in transit, or recorded on one side only. State what was established.">
                  <textarea className="field" rows={3} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} autoFocus />
                </Field>)}
                {mode === 'no_reply' && head('No reply was received', <Field label="Note (optional)" hint="For example: reminders sent, and when."><textarea className="field" rows={2} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} autoFocus /></Field>)}
                {!mode && <div className="text-[11.5px] text-muted">Recording a reply changes nothing in the books. A difference is reconciled by a person and corrected by the documents of its own area.</div>}
              </Section>
            )}

            <Attachments companyId={c.company_id} entity="confirmations" entityId={c.id} title="Evidence — the request and the reply" readOnly={!mayManage} />
          </div>
        )}
      </Drawer>
      <ReasonDialog open={cancelling} title="Cancel the confirmation" danger confirm="Cancel the confirmation" body={c ? <>Confirmation <span className="num">{c.confirm_no}</span> will be marked as cancelled. It stays on record with the reason; it cannot be used again.</> : undefined}
        onCancel={() => setCancelling(false)} onConfirm={(reason) => { if (c) void act(() => api.updateConfirmation({ id: c.id, action: 'cancel', explanation: reason }), 'Confirmation cancelled').then((r) => { if (r) setCancelling(false) }) }} />
    </>
  )
}
