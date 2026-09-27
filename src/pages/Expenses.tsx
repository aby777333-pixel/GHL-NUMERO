import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BellRing, ExternalLink, HandCoins, Info, Pencil, Plus, Receipt, Save, Scale, Send, Wallet } from 'lucide-react'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { Advance, AdvanceInput, ExpenseCategory, ExpenseCategoryInput, ExpenseClaim } from '@/engine/opsTypes'
import { advanceAge, advanceAgeing, advanceMemory, advanceOutstanding, isOverdue } from '@/engine/ops'
import { D, sum } from '@/lib/money'
import { daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Stat, useAccountName, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'

type TabKey = 'claims' | 'advances' | 'unsettled' | 'policy'
const TAB_KEYS: TabKey[] = ['claims', 'advances', 'unsettled', 'policy']

const CLAIM_STATUS: Record<ExpenseClaim['status'], { label: string; tone: string; tip: string }> = {
  draft: { label: 'DRAFT', tone: '', tip: 'Not yet submitted for approval.' },
  submitted: { label: 'CLAIM PENDING', tone: 'warn', tip: 'Submitted and waiting for an approver. Nothing has reached the ledger.' },
  approved: { label: 'APPROVED — entry awaiting approval', tone: 'cyan', tip: 'The claim is approved. Its accounting entry waits in the approval inbox.' },
  posted: { label: 'PAYABLE', tone: 'gold', tip: 'The expense is in the ledger. A reimbursement is owed to the person.' },
  paid: { label: 'SETTLED', tone: 'pos', tip: 'Nothing further is owed on this claim.' },
  rejected: { label: 'REJECTED', tone: 'neg', tip: 'Rejected by the approver. It can be corrected and submitted again.' },
  cancelled: { label: 'CANCELLED', tone: '', tip: 'Cancelled. Nothing was posted, or its entry was reversed.' },
}
const claimStatus = (c: ExpenseClaim) => (c.status === 'approved' && !c.journal_id
  ? { label: 'APPROVED — entry to be issued again', tone: 'warn', tip: 'The accounting entry of this claim was rejected. It has to be issued again.' }
  : CLAIM_STATUS[c.status])
const decided = (c: ExpenseClaim) => ['approved', 'posted', 'paid'].includes(c.status)
const counts = (c: ExpenseClaim) => !['draft', 'rejected', 'cancelled'].includes(c.status)

const RECIPIENT_TYPES: [string, string][] = [
  ['employee', 'Employee'], ['department', 'Department'], ['project', 'Project'], ['site', 'Site'], ['travel', 'Travel'],
  ['procurement', 'Procurement'], ['vendor', 'Vendor'], ['petty_cash', 'Petty cash'], ['emergency', 'Emergency'], ['other', 'Other'],
]
const METHODS = ['Bank transfer', 'Cheque', 'Cash', 'UPI', 'Card', 'Other']
const upper = (s: string) => s.replace(/_/g, ' ').toUpperCase()
const numeric = (s: string) => s.replace(/[^\d.]/g, '')
const foot = 'border-t border-line2 px-[14px] py-[10px]'

export default function Expenses() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const wanted = sp.get('tab') as TabKey | null
  const tab: TabKey = wanted && TAB_KEYS.includes(wanted) ? wanted : 'claims'
  const api = useApp((s) => s.api)!
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const currency = useCurrency()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const accountName = useAccountName()
  const companies = useApp((s) => s.companies)
  const asOf = today()
  const { act, busy } = useAction()

  const [bucket, setBucket] = useState<string | null>(null)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [followUp, setFollowUp] = useState<Advance | null>(null)
  const [followNote, setFollowNote] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | 'new' | null>(null)

  const main = useAsync(async () => {
    const [claims, advances, categories] = await Promise.all([
      api.listClaims({ companyIds: ids }), api.listAdvances({ companyIds: ids }), api.listExpenseCategories(ids),
    ])
    return { claims, advances, categories }
  }, [api, idsKey])

  const claims = main.data?.claims ?? []
  const advances = main.data?.advances ?? []
  const categories = main.data?.categories ?? []
  const companyCode = (id: ID) => companies.find((c) => c.id === id)?.code ?? '—'

  const ageing = useMemo(() => advanceAgeing(advances, asOf), [advances, asOf])
  const pending = claims.filter((c) => c.status === 'submitted')
  const payable = claims.filter((c) => c.status === 'posted')
  const payableTotal = sum(payable.map((c) => c.payable))
  const overdueTotal = sum(ageing.overdue.map((a) => advanceOutstanding(a)))
  const mixed = advances.some((a) => a.currency !== currency) || claims.some((c) => c.currency !== currency)

  const evidence = useMemo(() => {
    const m = new Map<ID, number>()
    for (const c of claims) if (c.advance_id && counts(c)) m.set(c.advance_id, (m.get(c.advance_id) ?? 0) + 1)
    return m
  }, [claims])

  const open = advances.filter((a) => advanceOutstanding(a).gt(0))
  const band = ageing.buckets.find((b) => b.key === bucket) ?? null
  const shown = band ? open.filter((a) => { const n = advanceAge(a, asOf); return n >= band.from && n <= band.to }) : open
  const shownTotal = sum(shown.map((a) => advanceOutstanding(a)))

  const mayCreate = can('expense.create')
  const mayEditPolicy = can('expense.approve')
  const go = (k: TabKey) => setSp({ tab: k }, { replace: true })

  const claimColumns: Column<ExpenseClaim>[] = [
    { key: 'no', header: 'Claim no', render: (c) => <span className="num text-[12.5px] text-gold">{c.claim_no}</span>, sort: (c) => c.claim_no, csv: (c) => c.claim_no },
    { key: 'person', header: 'Person', render: (c) => <span className="text-ink">{partyName(c.claimant_party_id)}</span>, sort: (c) => partyName(c.claimant_party_id).toLowerCase(), csv: (c) => partyName(c.claimant_party_id) },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{companyCode(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'title', header: 'Title', render: (c) => <span className="text-ink2">{c.title}</span>, sort: (c) => c.title.toLowerCase(), csv: (c) => c.title },
    { key: 'total', header: 'Claimed', align: 'right', render: (c) => <Money value={c.total} currency={c.currency} />, sort: (c) => D(c.total).toNumber(), csv: (c) => D(c.total).toFixed(2) },
    {
      key: 'approved', header: 'Approved', align: 'right', sort: (c) => (decided(c) ? D(c.approved_total).toNumber() : -1), csv: (c) => (decided(c) ? D(c.approved_total).toFixed(2) : ''),
      render: (c) => (decided(c) ? <Money value={c.approved_total} currency={c.currency} className={cx(D(c.approved_total).lt(c.total) && 'text-warn')} /> : <span className="text-muted" title="No decision has been recorded yet">—</span>),
    },
    { key: 'status', header: 'Status', render: (c) => { const s = claimStatus(c); return <span className={cx('chip', s.tone)} title={s.tip}>{s.label}</span> }, sort: (c) => claimStatus(c).label, csv: (c) => claimStatus(c).label },
    {
      key: 'flags', header: 'Flagged lines', align: 'right', sort: (c) => c.flagged_lines, csv: (c) => c.flagged_lines,
      render: (c) => (c.flagged_lines > 0 ? <span className="chip warn" title="Flags inform the approver. They do not reject the claim."><AlertTriangle size={11} /> {c.flagged_lines}</span> : <span className="text-muted">—</span>),
    },
    { key: 'created', header: 'Created', render: (c) => <span className="num text-[12.5px] text-ink2">{fmtDate(c.created_at)}</span>, sort: (c) => c.created_at, csv: (c) => c.created_at.slice(0, 10) },
  ]

  const amount = (key: string, header: string, get: (a: Advance) => ReturnType<typeof D>, tone?: (a: Advance) => string | false): Column<Advance> => ({
    key, header, align: 'right', sort: (a) => get(a).toNumber(), csv: (a) => get(a).toFixed(2),
    render: (a) => <Money value={get(a)} currency={a.currency} dim className={cx(tone?.(a))} />,
  })
  const ageCell = (a: Advance) => <span className="num" title="Counted from the release date, or from the request date when nothing has been released">{advanceAge(a, asOf)}</span>
  const expectedCell = (a: Advance) => (a.expected_settlement_date
    ? <span className={cx('num text-[12.5px]', isOverdue(a, asOf) ? 'text-neg' : 'text-ink2')} title={isOverdue(a, asOf) ? `Past the expected settlement date by ${daysBetween(a.expected_settlement_date, asOf)} day(s)` : undefined}>{fmtDate(a.expected_settlement_date)}</span>
    : <span className="text-muted">—</span>)

  const advanceColumns: Column<Advance>[] = [
    { key: 'no', header: 'Advance no', render: (a) => <span className="num text-[12.5px] text-gold">{a.advance_no}</span>, sort: (a) => a.advance_no, csv: (a) => a.advance_no },
    { key: 'recipient', header: 'Recipient', render: (a) => <span className="text-ink">{partyName(a.recipient_party_id)}</span>, sort: (a) => partyName(a.recipient_party_id).toLowerCase(), csv: (a) => partyName(a.recipient_party_id) },
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2" title={companyName(a.company_id)}>{companyCode(a.company_id)}</span>, sort: (a) => companyName(a.company_id), csv: (a) => companyName(a.company_id) },
    { key: 'type', header: 'Type', render: (a) => <span className="text-[12.5px] text-ink2">{a.recipient_type.replace(/_/g, ' ')}</span>, sort: (a) => a.recipient_type, csv: (a) => a.recipient_type.replace(/_/g, ' ') },
    { key: 'purpose', header: 'Purpose', render: (a) => <span className="text-ink2">{a.purpose}</span>, sort: (a) => a.purpose.toLowerCase(), csv: (a) => a.purpose },
    amount('requested', 'Requested', (a) => D(a.requested_amount)),
    amount('approved', 'Approved', (a) => D(a.approved_amount)),
    amount('released', 'Released', (a) => D(a.released_amount)),
    amount('settled', 'Settled', (a) => D(a.settled_amount)),
    amount('returned', 'Returned', (a) => D(a.returned_amount)),
    amount('unsettled', 'Unsettled', (a) => advanceOutstanding(a), (a) => advanceOutstanding(a).gt(0) && 'text-warn'),
    { key: 'expected', header: 'Expected settlement', render: expectedCell, sort: (a) => a.expected_settlement_date ?? '', csv: (a) => a.expected_settlement_date ?? '' },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} label={upper(a.status)} />, sort: (a) => a.status, csv: (a) => upper(a.status) },
    { key: 'age', header: 'Age (days)', align: 'right', render: ageCell, sort: (a) => advanceAge(a, asOf), csv: (a) => advanceAge(a, asOf) },
  ]

  const unsettledColumns: Column<Advance>[] = [
    {
      key: 'person', header: 'Person', sort: (a) => partyName(a.recipient_party_id).toLowerCase(), csv: (a) => `${partyName(a.recipient_party_id)} (${a.advance_no})`,
      render: (a) => <div className="min-w-0"><div className="truncate text-ink">{partyName(a.recipient_party_id)}</div><div className="num text-[11px] text-gold">{a.advance_no} · {companyCode(a.company_id)}</div></div>,
    },
    { key: 'department', header: 'Department', render: (a) => <span className="text-[12.5px] text-ink2">{unitName(a.dims.department)}</span>, sort: (a) => unitName(a.dims.department), csv: (a) => (a.dims.department ? unitName(a.dims.department) : '') },
    { key: 'project', header: 'Project', render: (a) => <span className="text-[12.5px] text-ink2">{unitName(a.dims.project)}</span>, sort: (a) => unitName(a.dims.project), csv: (a) => (a.dims.project ? unitName(a.dims.project) : '') },
    { key: 'unsettled', header: 'Unsettled', align: 'right', render: (a) => <Money value={advanceOutstanding(a)} currency={a.currency} className="text-ink" />, sort: (a) => advanceOutstanding(a).toNumber(), csv: (a) => advanceOutstanding(a).toFixed(2) },
    { key: 'age', header: 'Age (days)', align: 'right', render: ageCell, sort: (a) => advanceAge(a, asOf), csv: (a) => advanceAge(a, asOf) },
    { key: 'purpose', header: 'Purpose', render: (a) => <span className="text-ink2">{a.purpose}</span>, sort: (a) => a.purpose.toLowerCase(), csv: (a) => a.purpose },
    {
      key: 'evidence', header: 'Evidence', sort: (a) => evidence.get(a.id) ?? 0, csv: (a) => (evidence.get(a.id) ? 'claim submitted' : 'no claim yet'),
      render: (a) => (evidence.get(a.id) ? <span className="chip cyan" title={`${evidence.get(a.id)} settlement claim(s) have been submitted against this advance`}>claim submitted</span> : <span className="chip warn" title="No settlement claim has been submitted against this advance">no claim yet</span>),
    },
    { key: 'expected', header: 'Expected settlement', render: expectedCell, sort: (a) => a.expected_settlement_date ?? '', csv: (a) => a.expected_settlement_date ?? '' },
    { key: 'follow', header: 'Last follow-up', render: (a) => <span className="num text-[12.5px] text-ink2">{fmtDate(a.last_follow_up)}</span>, sort: (a) => a.last_follow_up ?? '', csv: (a) => a.last_follow_up ?? '' },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} label={upper(a.status)} />, sort: (a) => a.status, csv: (a) => upper(a.status) },
    {
      key: 'action', header: '', align: 'right',
      render: (a) => {
        const ok = can('expense.approve', a.company_id)
        return <button className="btn sm" disabled={!ok} title={ok ? 'Record that the person was reminded or contacted' : 'You are not authorised to record a follow-up on advances of this company'} onClick={(e) => { e.stopPropagation(); setFollowNote(''); setFollowUp(a) }}><BellRing size={13} /> Record follow-up</button>
      },
    },
  ]

  const limit = (v: ExpenseCategory['limit_per_item'], currencyOf: string) => (v === null || v === undefined ? <span className="text-muted">—</span> : <Money value={v} currency={currencyOf} />)
  const ccyOf = (companyId: ID) => companies.find((c) => c.id === companyId)?.base_currency
  const categoryColumns: Column<ExpenseCategory>[] = [
    { key: 'name', header: 'Category', render: (c) => <span className="text-ink">{c.name}</span>, sort: (c) => c.name.toLowerCase(), csv: (c) => c.name },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{companyCode(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'ledger', header: 'Ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.account_id)}</span>, sort: (c) => accountName(c.account_id), csv: (c) => accountName(c.account_id) },
    { key: 'item', header: 'Limit per item', align: 'right', render: (c) => limit(c.limit_per_item, ccyOf(c.company_id) ?? currency), sort: (c) => D(c.limit_per_item).toNumber(), csv: (c) => (c.limit_per_item == null ? '' : D(c.limit_per_item).toFixed(2)) },
    { key: 'day', header: 'Limit per day', align: 'right', render: (c) => limit(c.limit_per_day, ccyOf(c.company_id) ?? currency), sort: (c) => D(c.limit_per_day).toNumber(), csv: (c) => (c.limit_per_day == null ? '' : D(c.limit_per_day).toFixed(2)) },
    {
      key: 'receipt', header: 'Receipt required above', align: 'right', sort: (c) => D(c.receipt_required_above).toNumber(), csv: (c) => (c.receipt_required_above == null ? 'every expense' : D(c.receipt_required_above).toFixed(2)),
      render: (c) => (c.receipt_required_above == null ? <span className="text-[12px] text-ink2">every expense</span> : <Money value={c.receipt_required_above} currency={ccyOf(c.company_id) ?? currency} />),
    },
    { key: 'age', header: 'Maximum age (days)', align: 'right', render: (c) => (c.max_age_days == null ? <span className="text-muted">—</span> : <span className="num">{c.max_age_days}</span>), sort: (c) => c.max_age_days ?? 0, csv: (c) => c.max_age_days ?? '' },
    { key: 'guidance', header: 'Guidance', render: (c) => <span className="text-[12.5px] text-ink2">{c.guidance || '—'}</span>, csv: (c) => c.guidance ?? '' },
    { key: 'active', header: 'Active', render: (c) => <StatusChip status={c.is_active ? 'active' : 'inactive'} />, sort: (c) => (c.is_active ? 0 : 1), csv: (c) => (c.is_active ? 'yes' : 'no') },
    {
      key: 'edit', header: '', align: 'right',
      render: (c) => {
        const ok = can('expense.approve', c.company_id)
        return <button className="btn ghost icon sm" disabled={!ok} aria-label={`Edit ${c.name}`} title={ok ? 'Edit this category' : 'You are not authorised to change the expense policy of this company'} onClick={(e) => { e.stopPropagation(); setCategory(c) }}><Pencil size={13} /></button>
      },
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Flow"
        title="Expenses and advances"
        subtitle={<>An advance is money held by a person. It is not an expense. It becomes an expense only through an approved claim supported by evidence. Approval, release of money, the expense and its settlement are separate events. · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}</>}
        actions={<>
          <button className="btn" disabled={!mayCreate} title={mayCreate ? 'Ask for money to be held by a person for a stated purpose' : 'You are not authorised to request advances'} onClick={() => setAdvanceOpen(true)}><HandCoins size={15} /> Request an advance</button>
          <button className="btn primary" disabled={!mayCreate} title={mayCreate ? 'Record expenses for approval' : 'You are not authorised to create expense claims'} onClick={() => nav('/expenses/claims/new')}><Plus size={15} /> New claim</button>
        </>}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !main.data && <Panel><Loading rows={6} label="Loading expenses and advances" /></Panel>}

      {main.data && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Claims awaiting approval" value={pending.length} count tone={pending.length ? 'warn' : undefined} onClick={() => go('claims')}
              sub={<>CLAIM PENDING · claimed <Money value={sum(pending.map((c) => c.total))} compact /></>} />
            <Stat label="Reimbursements payable" value={payableTotal.toString()} tone={payableTotal.gt(0) ? 'gold' : undefined} onClick={() => go('claims')}
              sub={<>PAYABLE · {payable.length} claim{payable.length === 1 ? '' : 's'} posted and not yet reimbursed</>} />
            <Stat label="Advances unsettled" value={ageing.total.toString()} tone={ageing.total.gt(0) ? 'cyan' : undefined} onClick={() => { setBucket(null); go('unsettled') }}
              sub={<>{ageing.count} advance{ageing.count === 1 ? '' : 's'} · money held by people, not an expense</>} />
            <Stat label="Past settlement date" value={overdueTotal.toString()} tone={ageing.overdue.length ? 'neg' : undefined} onClick={() => { setBucket(null); go('unsettled') }}
              sub={<>{ageing.overdue.length} advance{ageing.overdue.length === 1 ? '' : 's'} past the expected settlement date</>} />
          </div>
          {mixed && <Note kind="warn" className="mb-4">Some records are in a currency other than {currency}. The totals on this page add the amounts as they were recorded, without conversion. The tables show each record in its own currency.</Note>}

          <Tabs<TabKey>
            tabs={[
              { key: 'claims', label: 'Claims', count: claims.length },
              { key: 'advances', label: 'Advances', count: advances.length },
              { key: 'unsettled', label: 'Unsettled advances', count: open.length },
              { key: 'policy', label: 'Policy', count: categories.length },
            ]}
            value={tab} onChange={go}
          />

          {tab === 'claims' && (
            <Panel lit={false}>
              <DataTable key="claims" columns={claimColumns} rows={claims} rowKey={(c) => c.id} onRow={(c) => nav('/expenses/claims/' + c.id)} exportName="expense-claims"
                toolbar={<span className="text-[12px] text-muted">CLAIM PENDING → PAYABLE → SETTLED. A claim reaches the ledger only after its accounting entry is approved.</span>}
                empty={{
                  title: 'No expense claims', icon: <Receipt size={20} />,
                  body: 'No claim is recorded for the selected companies. A claim lists the expenses a person incurred, with receipts, for approval.',
                  action: mayCreate ? <button className="btn sm primary" onClick={() => nav('/expenses/claims/new')}><Plus size={13} /> New claim</button> : undefined,
                }} />
            </Panel>
          )}

          {tab === 'advances' && (
            <Panel lit={false}>
              <DataTable key="advances" columns={advanceColumns} rows={advances} rowKey={(a) => a.id} onRow={(a) => nav('/expenses/advances/' + a.id)} exportName="advances"
                toolbar={<span className="text-[12px] text-muted">Approving an advance moves no money. Recording its release proposes an accounting entry that a second person approves.</span>}
                empty={{
                  title: 'No advances', icon: <HandCoins size={20} />,
                  body: 'No advance is recorded for the selected companies. Request an advance when a person needs to hold company money for a stated purpose.',
                  action: mayCreate ? <button className="btn sm primary" onClick={() => setAdvanceOpen(true)}><HandCoins size={13} /> Request an advance</button> : undefined,
                }} />
            </Panel>
          )}

          {tab === 'unsettled' && (
            <>
              <Section title="Unsettled advances by age" className="mb-4" right={bucket ? <button className="btn sm" onClick={() => setBucket(null)}>Showing: {band?.label} — clear</button> : undefined}>
                <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {ageing.buckets.map((b) => {
                    const on = bucket === b.key
                    return (
                      <Panel key={b.key} lit={false} className={cx('p-3.5', on && 'border-gold/50')} onClick={() => setBucket(on ? null : b.key)} title={on ? 'Click to clear this filter' : 'Click to show only this age band'}>
                        <div className="eyebrow truncate">{b.label}</div>
                        <Money value={b.amount} compact className={cx('mt-2 block text-[18px] leading-none', b.amount.isZero() && 'text-muted')} />
                        <div className="mt-1.5 text-[11px] text-muted"><span className="num text-ink2">{b.count}</span> advance{b.count === 1 ? '' : 's'}</div>
                      </Panel>
                    )
                  })}
                </div>
              </Section>
              <Panel lit={false}>
                <DataTable key={'unsettled-' + (bucket ?? 'all')} columns={unsettledColumns} rows={shown} rowKey={(a) => a.id} onRow={(a) => nav('/expenses/advances/' + a.id)} exportName="unsettled-advances"
                  initialSort={{ key: 'age', dir: 'desc' }}
                  toolbar={<span className="text-[12px] text-muted">Unsettled = released − settled by approved claims − returned. Age is counted from the release date.</span>}
                  footer={<tr>
                    <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {shown.length.toLocaleString()} advance{shown.length === 1 ? '' : 's'}</td>
                    <td className={cx(foot, 'r')}><Money value={shownTotal} className="font-medium text-ink" /></td>
                    <td className={foot} colSpan={7} />
                  </tr>}
                  empty={{
                    title: bucket ? 'Nothing in this age band' : 'No unsettled advances', icon: <Wallet size={20} />,
                    body: bucket ? 'No unsettled advance falls in the selected age band. Clear the filter to see every unsettled advance.' : 'Every advance released in the selected companies has been settled by approved claims or returned.',
                    action: bucket ? <button className="btn sm" onClick={() => setBucket(null)}>Clear filter</button> : undefined,
                  }} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">These are facts for review. An unsettled balance states that money is still held by a person; it does not state why.</div>
            </>
          )}

          {tab === 'policy' && (
            <>
              <Note className="mb-4">Limits produce flags for the approver. They never reject a claim automatically. A flag (OUTSIDE POLICY, EVIDENCE MISSING, POSSIBLE DUPLICATE, LATE CLAIM, WEEKEND) is shown on the claim line, and the approver records a reason when approving a flagged line.</Note>
              <Panel lit={false}>
                <DataTable key="policy" columns={categoryColumns} rows={categories} rowKey={(c) => c.id} exportName="expense-policy"
                  initialSort={{ key: 'name', dir: 'asc' }}
                  toolbar={<button className="btn sm" disabled={!mayEditPolicy} title={mayEditPolicy ? 'Add an expense category' : 'Only a person authorised to approve expenses can change the policy'} onClick={() => setCategory('new')}><Plus size={13} /> Add category</button>}
                  empty={{
                    title: 'No expense categories', icon: <Scale size={20} />,
                    body: 'No expense category is set up for the selected companies. A category names the ledger an expense is recorded in and the limits that produce flags for the approver.',
                    action: mayEditPolicy ? <button className="btn sm primary" onClick={() => setCategory('new')}><Plus size={13} /> Add category</button> : undefined,
                  }} />
              </Panel>
            </>
          )}
        </>
      )}

      <AdvanceDrawer open={advanceOpen} onClose={() => setAdvanceOpen(false)} companyIds={ids} advances={advances} claims={claims} />
      <CategoryDrawer target={category} onClose={() => setCategory(null)} companyIds={ids} />

      <Modal open={!!followUp} onClose={() => setFollowUp(null)} title="Record follow-up" width={500}
        subtitle={followUp ? <>{followUp.advance_no} · {partyName(followUp.recipient_party_id)} · unsettled <Money value={advanceOutstanding(followUp)} currency={followUp.currency} /></> : undefined}
        footer={<>
          <button className="btn ghost" onClick={() => setFollowUp(null)}>Cancel</button>
          <button className="btn primary" disabled={busy || !followNote.trim()} onClick={async () => {
            if (!followUp) return
            const done = await act(async () => { await api.flagAdvance(followUp.id, 'follow_up', followNote.trim()); return true }, 'Follow-up recorded')
            if (done) setFollowUp(null)
          }}>{busy ? <Spinner /> : <BellRing size={15} />} Record follow-up</button>
        </>}>
        <Field label="What was done (required — recorded in the audit trail)" hint="For example: reminded by phone; the person will submit receipts by Friday.">
          <textarea className="field" rows={3} autoFocus value={followNote} onChange={(e) => setFollowNote(e.target.value)} />
        </Field>
        <div className="mt-3 text-[12px] text-muted">A follow-up records today as the date of the last contact. It does not change the amount or the status of the advance.</div>
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ request an advance
interface AdvanceForm {
  company_id: ID; recipient_party_id: ID | ''; recipient_type: string; purpose: string; amount: string; expected: string
  method: string; department: ID | ''; project: ID | ''; register_item_id: ID | ''; notes: string
}
const blankAdvance = (companyId: ID): AdvanceForm => ({ company_id: companyId, recipient_party_id: '', recipient_type: 'employee', purpose: '', amount: '', expected: '', method: '', department: '', project: '', register_item_id: '', notes: '' })

function AdvanceDrawer({ open, onClose, companyIds, advances, claims }: { open: boolean; onClose: () => void; companyIds: ID[]; advances: Advance[]; claims: ExpenseClaim[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const { act, busy } = useAction()
  const [f, setF] = useState<AdvanceForm>(blankAdvance(companyIds[0] ?? ''))
  const [savedId, setSavedId] = useState<ID | null>(null)
  useEffect(() => { if (open) { setF(blankAdvance(companyIds[0] ?? '')); setSavedId(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useAsync(async () => (open && f.company_id ? api.listRegisterItems({ companyIds: [f.company_id] }) : []), [api, open, f.company_id])
  const choices = companies.filter((c) => c.status === 'active' && companyIds.includes(c.id))
  const company = companies.find((c) => c.id === f.company_id)
  const inCompany = parties.filter((p) => p.roles.some((r) => r.company_id === f.company_id)).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const people = inCompany.filter((p) => p.kind === 'person'), organisations = inCompany.filter((p) => p.kind !== 'person')
  const units = (type: string) => orgUnits.filter((u) => u.company_id === f.company_id && u.type_key === type && u.status === 'active').sort((a, b) => a.name.localeCompare(b.name))
  const departments = units('department'), projects = units('project')
  // any register item that tracks its own cost can be named: its tag is what the accounting entry carries
  const linkable = (items.data ?? []).filter((i) => !!i.org_unit_id && !['cancelled', 'closed', 'ended'].includes(i.status))
  const recipient = parties.find((p) => p.id === f.recipient_party_id)
  const facts = f.recipient_party_id ? advanceMemory(advances, claims, f.recipient_party_id, today()) : []
  const barred = !!recipient && ['blocked', 'suspended', 'terminated'].includes(recipient.status)

  const problem = !f.company_id ? 'Choose the company.'
    : !f.recipient_party_id ? 'Choose who receives the advance.'
    : barred ? `${recipient!.display_name} is ${recipient!.status}. A new advance is not permitted.`
    : !f.purpose.trim() ? 'State the purpose of the advance.'
    : D(f.amount).lte(0) ? 'Enter the amount requested.'
    : f.expected && f.expected < today() ? 'The expected settlement date is in the past.'
    : null
  const allowed = can('expense.create', f.company_id || undefined)

  const input = (): AdvanceInput => {
    const dims: Record<string, ID> = {}
    if (f.department) dims.department = f.department
    if (f.project) dims.project = f.project
    return {
      id: savedId ?? undefined, company_id: f.company_id, recipient_party_id: f.recipient_party_id as ID, recipient_type: f.recipient_type, purpose: f.purpose.trim(), register_item_id: f.register_item_id || null, dims,
      currency: company?.base_currency, requested_amount: D(f.amount).toDecimalPlaces(2).toString(), expected_settlement_date: f.expected || null, payment_method: f.method || null, notes: f.notes.trim() || null,
    }
  }
  const save = async (submit: boolean) => {
    const id = await act(() => api.saveAdvance(input()), submit ? undefined : 'Advance saved as a draft')
    if (!id) return
    setSavedId(id)
    if (submit) {
      const sent = await act(async () => { await api.submitAdvance(id); return true }, 'Advance sent for approval')
      if (!sent) return
    }
    onClose()
    nav('/expenses/advances/' + id)
  }
  const set = (patch: Partial<AdvanceForm>) => setF((x) => ({ ...x, ...patch }))

  return (
    <Drawer open={open} onClose={onClose} title="Request an advance" width={620}
      subtitle="Money to be held by a person for a stated purpose. It is not an expense."
      footer={<>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" disabled={busy || !!problem || !allowed} title={allowed ? problem ?? 'Keep the request as a draft' : 'You are not authorised to request advances in this company'} onClick={() => void save(false)}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>
        <button className="btn primary" disabled={busy || !!problem || !allowed} title={allowed ? problem ?? 'Save the request and send it to the approver' : 'You are not authorised to request advances in this company'} onClick={() => void save(true)}>{busy ? <Spinner /> : <Send size={15} />} Save and request approval</button>
      </>}>
      <Note className="mb-4">Approving this request moves no money. When the money is handed over, its release is recorded separately and proposes an accounting entry that a second person approves.</Note>
      {savedId && <Note kind="warn" className="mb-4">The request is saved as a draft. It has not been sent for approval.</Note>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <select className="field" value={f.company_id} disabled={!!savedId} onChange={(e) => set({ company_id: e.target.value, recipient_party_id: '', department: '', project: '', register_item_id: '' })}>
            <option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Recipient type">
          <select className="field" value={f.recipient_type} onChange={(e) => set({ recipient_type: e.target.value })}>{RECIPIENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Recipient" className="sm:col-span-2" hint={inCompany.length ? 'The person or party who will hold the money and account for it.' : 'No party is registered with this company. Add the person under People & Parties first.'}>
          <select className="field" value={f.recipient_party_id} onChange={(e) => set({ recipient_party_id: e.target.value })}>
            <option value="">Choose…</option>
            {people.length > 0 && <optgroup label="People">{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}{p.status !== 'active' ? ` (${p.status})` : ''}</option>)}</optgroup>}
            {organisations.length > 0 && <optgroup label="Organisations">{organisations.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}{p.status !== 'active' ? ` (${p.status})` : ''}</option>)}</optgroup>}
          </select>
        </Field>
      </div>

      {f.recipient_party_id && (
        <Panel lit={false} attention={facts.some((x) => !['none', 'clean'].includes(x.kind))} className="mt-4 p-4">
          <div className="eyebrow mb-2">What is already on record</div>
          <div className="space-y-2">
            {facts.map((x, i) => {
              const plain = ['none', 'clean'].includes(x.kind)
              return (
                <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className={cx('mt-[2px] flex-none', plain ? 'text-muted' : 'text-warn')}>{plain ? <Info size={14} /> : <AlertTriangle size={14} />}</span>
                  <span className="min-w-0 flex-1 text-ink2">{x.text}</span>
                  {x.advance_id && <button className="btn ghost icon sm" aria-label="Open the earlier advance" title="Open the earlier advance" onClick={() => { onClose(); nav('/expenses/advances/' + x.advance_id) }}><ExternalLink size={13} /></button>}
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-[11.5px] text-muted">Facts from the records of the selected companies, shown for the approver's review. They do not block the request.</div>
        </Panel>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Purpose" className="sm:col-span-2"><input className="field" value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="What will the money be used for?" /></Field>
        <Field label={`Amount requested${company ? ` (${company.base_currency})` : ''}`}><input className="field num" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: numeric(e.target.value) })} /></Field>
        <Field label="Expected settlement date" hint="The advance is shown as overdue when it is still unsettled after this date."><input type="date" className="field" value={f.expected} min={today()} onChange={(e) => set({ expected: e.target.value })} /></Field>
        <Field label="Payment method"><select className="field" value={f.method} onChange={(e) => set({ method: e.target.value })}><option value="">Not decided</option>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Linked record" hint={items.loading ? 'Loading…' : linkable.length ? undefined : 'No record that tracks its own cost (a trip, event, vehicle, property, incident, work order or path) is kept for this company.'}>
          <select className="field" value={f.register_item_id} onChange={(e) => set({ register_item_id: e.target.value })}><option value="">None</option>{linkable.map((i) => <option key={i.id} value={i.id}>{i.ref_no} · {i.title}</option>)}</select>
        </Field>
        <Field label="Department" hint={departments.length ? undefined : 'No department is set up for this company.'}>
          <select className="field" value={f.department} onChange={(e) => set({ department: e.target.value })}><option value="">—</option>{departments.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Project" hint={projects.length ? undefined : 'No project is set up for this company.'}>
          <select className="field" value={f.project} onChange={(e) => set({ project: e.target.value })}><option value="">—</option>{projects.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {problem && (f.purpose || f.amount || f.recipient_party_id) && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Drawer>
  )
}

// ------------------------------------------------------------------ expense policy
interface CategoryForm {
  company_id: ID; name: string; account_id: ID | ''; limit_per_item: string; limit_per_day: string; receipt_required_above: string
  max_age_days: string; guidance: string; is_active: boolean; reason: string
}
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(D(v)))

function CategoryDrawer({ target, onClose, companyIds }: { target: ExpenseCategory | 'new' | null; onClose: () => void; companyIds: ID[] }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const existing = target && target !== 'new' ? target : null
  const blank = (): CategoryForm => ({ company_id: companyIds.find((id) => can('expense.approve', id)) ?? companyIds[0] ?? '', name: '', account_id: '', limit_per_item: '', limit_per_day: '', receipt_required_above: '', max_age_days: '', guidance: '', is_active: true, reason: '' })
  const [f, setF] = useState<CategoryForm>(blank)
  useEffect(() => {
    if (!target) return
    setF(existing ? {
      company_id: existing.company_id, name: existing.name, account_id: existing.account_id, limit_per_item: text(existing.limit_per_item), limit_per_day: text(existing.limit_per_day),
      receipt_required_above: text(existing.receipt_required_above), max_age_days: existing.max_age_days == null ? '' : String(existing.max_age_days), guidance: existing.guidance ?? '', is_active: existing.is_active, reason: '',
    } : blank())
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const choices = companies.filter((c) => c.status === 'active' && companyIds.includes(c.id))
  const company = companies.find((c) => c.id === f.company_id)
  const ledgers = accounts.filter((a) => a.company_id === f.company_id && !a.is_group && a.is_active && (a.type === 'expense' || a.id === f.account_id)).sort((a, b) => a.code.localeCompare(b.code))
  const allowed = can('expense.approve', f.company_id || undefined)
  const problem = !f.company_id ? 'Choose the company.'
    : !f.name.trim() ? 'Give the category a name.'
    : !f.account_id ? 'Choose the ledger expenses of this category are recorded in.'
    : f.max_age_days !== '' && !/^\d+$/.test(f.max_age_days) ? 'The maximum age is a whole number of days.'
    : existing && !f.reason.trim() ? 'State the reason for the change.'
    : null
  const money = (v: string) => (v.trim() === '' ? null : D(v).toDecimalPlaces(2).toString())
  const set = (patch: Partial<CategoryForm>) => setF((x) => ({ ...x, ...patch }))

  const save = async () => {
    const input: ExpenseCategoryInput = {
      id: existing?.id, company_id: f.company_id, name: f.name.trim(), account_id: f.account_id as ID, limit_per_item: money(f.limit_per_item), limit_per_day: money(f.limit_per_day),
      receipt_required_above: money(f.receipt_required_above), max_age_days: f.max_age_days === '' ? null : Number(f.max_age_days), guidance: f.guidance.trim() || null, is_active: f.is_active,
      reason: existing ? f.reason.trim() : undefined,
    }
    const id = await act(() => api.saveExpenseCategory(input), existing ? 'Expense category updated' : 'Expense category added')
    if (id) onClose()
  }

  return (
    <Drawer open={!!target} onClose={onClose} title={existing ? `Edit ${existing.name}` : 'Add expense category'} subtitle="Expense policy"
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !!problem || !allowed} title={allowed ? problem ?? undefined : 'You are not authorised to change the expense policy of this company'} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button>
      </>}>
      <Note className="mb-4">Limits produce flags for the approver. They never reject a claim automatically.</Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2">
          <select className="field" value={f.company_id} disabled={!!existing} onChange={(e) => set({ company_id: e.target.value, account_id: '' })}>
            <option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Name"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Local travel" /></Field>
        <Field label="Ledger" hint={ledgers.length ? 'Expenses of this category are recorded in this ledger.' : 'This company has no active expense ledger.'}>
          <select className="field" value={f.account_id} onChange={(e) => set({ account_id: e.target.value })}><option value="">Choose…</option>{ledgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label={`Limit per item${company ? ` (${company.base_currency})` : ''}`} hint="A line above this amount is flagged OUTSIDE POLICY. Leave empty for no limit.">
          <input className="field num" inputMode="decimal" value={f.limit_per_item} onChange={(e) => set({ limit_per_item: numeric(e.target.value) })} />
        </Field>
        <Field label={`Limit per day${company ? ` (${company.base_currency})` : ''}`} hint="Applies to the total of this category on one date within a claim. Leave empty for no limit.">
          <input className="field num" inputMode="decimal" value={f.limit_per_day} onChange={(e) => set({ limit_per_day: numeric(e.target.value) })} />
        </Field>
        <Field label={`Receipt required above${company ? ` (${company.base_currency})` : ''}`} hint="A line above this amount without a receipt is flagged EVIDENCE MISSING. Leave empty to expect a receipt for every expense.">
          <input className="field num" inputMode="decimal" value={f.receipt_required_above} onChange={(e) => set({ receipt_required_above: numeric(e.target.value) })} />
        </Field>
        <Field label="Maximum age in days" hint="An expense older than this when claimed is flagged LATE CLAIM. Leave empty for no limit.">
          <input className="field num" inputMode="numeric" value={f.max_age_days} onChange={(e) => set({ max_age_days: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Guidance" className="sm:col-span-2" hint="Shown to the person while they enter a claim line of this category.">
          <textarea className="field" rows={3} value={f.guidance} onChange={(e) => set({ guidance: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink2 sm:col-span-2">
          <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active — offered when a claim is entered
        </label>
        {existing && (
          <Field label="Reason for the change (required — recorded in the audit trail)" className="sm:col-span-2">
            <textarea className="field" rows={2} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Why is the policy being changed?" />
          </Field>
        )}
      </div>
      {problem && f.name && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Drawer>
  )
}
