import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowRight, BadgeCheck, ExternalLink, Lock, Pencil, Plus, Save, Search, Shuffle, SlidersHorizontal, Split } from 'lucide-react'
import type { Account, ID, Journal, JournalLineView, TypeDef } from '@/engine/types'
import type { Allocation, AllocationDriver, Materiality, Reclassification } from '@/engine/p3Types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO, round2, sum } from '@/lib/money'
import { addMonths, endOfMonth, fmtDate, fmtDateTime, startOfMonth, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { ProposedEntries, ProposedNote, useAccountName, useCompanyName, useUnitName } from '@/ui/ops'
import { DemoTag, digits, Fact, foot, human, NoAccess, Tile, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { Meter } from '@/ui/charts'
import { useWho } from './Reality'

// =====================================================================
// Control (spec 482, 1245, 1581): sharing a cost between units,
// moving a posted line to the ledger it belongs in, and the threshold
// of materiality of each company.
// An allocation and a reclassification PROPOSE an entry; nothing
// reaches the ledger until a second person approves it. The original
// entry stays exactly as it was posted. A threshold never hides,
// erases or changes anything: it only marks what is small.
// =====================================================================

type TabKey = 'allocations' | 'reclassifications' | 'materiality'
const TABS: { key: TabKey; label: string }[] = [{ key: 'allocations', label: 'Allocations' }, { key: 'reclassifications', label: 'Reclassifications' }, { key: 'materiality', label: 'Materiality' }]

const DRIVERS: { key: AllocationDriver; label: string; unit: string; what: string }[] = [
  { key: 'headcount', label: 'Headcount', unit: 'people', what: 'The number of people in each unit.' },
  { key: 'revenue', label: 'Revenue', unit: 'revenue', what: 'The revenue of each unit in the period.' },
  { key: 'area', label: 'Area', unit: 'area', what: 'The floor area each unit occupies.' },
  { key: 'usage', label: 'Usage', unit: 'usage', what: 'What each unit used: hours, units, seats, kilometres.' },
  { key: 'equal', label: 'Equal shares', unit: 'share', what: 'Every unit takes the same share.' },
  { key: 'manual', label: 'Manual shares', unit: 'weight', what: 'Weights decided by a person. The note must say what they rest on.' },
]
const driverLabel = (d: string) => DRIVERS.find((x) => x.key === d)?.label ?? human(d)
/** Ledgers that record what happened with someone else. They are corrected by reversing the source document. */
const FIXED_LEDGERS = ['bank', 'cash', 'receivable', 'payable', 'tax', 'intercompany']
const FIXED_RULE = 'Bank, cash, party, tax and intercompany ledgers cannot be reclassified. They record what happened with someone else, and are corrected by reversing the source document.'
const STATUS_LABEL: Record<string, string> = { draft: 'draft — nothing proposed', proposed: 'awaiting approval', posted: 'approved and posted', rejected: 'rejected — nothing was posted', reversed: 'posted and later reversed', cancelled: 'cancelled' }

// the database asks for journal.create: a reclassification is an entry
const mayWriteReclass = (id: ID) => can('journal.create', id)

function Denied({ perm, what }: { perm: string; what: string }) {
  return <Panel><Empty icon={<Lock size={20} />} title={`Your role does not include ${what}`} body={<>This needs the permission <span className="num text-ink2">{perm}</span> in at least one of the selected companies. What you cannot see still exists and is still part of the books.</>} /></Panel>
}

export default function Control() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const readIds = scope.filter((id) => can('journal.view', id) || can('allocation.manage', id))
  const realityIds = scope.filter((id) => can('reality.view', id))
  if (!readIds.length && !realityIds.length) return <NoAccess eyebrow="Control" title="Allocations and reclassification" perm={['journal.view', 'allocation.manage', 'reality.view']} />
  return <ControlView readIds={readIds} realityIds={realityIds} />
}

type Put = (patch: Record<string, string | null>) => void
type JournalNames = Map<ID, { voucher_no: string | null; status: string }>

function ControlView({ readIds, realityIds }: { readIds: ID[]; realityIds: ID[] }) {
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const readKey = readIds.join(',')
  const realityKey = realityIds.join(',')

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? (readIds.length ? 'allocations' : 'materiality')
  const put: Put = (patch) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v) }
    setSp(next, { replace: true })
  }

  const main = useAsync(async () => {
    if (!readIds.length) return { allocations: [] as Allocation[], reclass: [] as Reclassification[], journals: new Map() as JournalNames }
    const [allocations, reclass] = await Promise.all([api.listAllocations(readIds), api.listReclassifications({ companyIds: readIds })])
    // voucher numbers are a convenience: an entry above the clearance of the person is simply not named
    const journalIds = readIds.filter((id) => can('journal.view', id))
    const list = journalIds.length && reclass.length ? await api.listJournals({ companyIds: journalIds, limit: 1000 }).then((r) => r.rows).catch(() => [] as Journal[]) : []
    return { allocations, reclass, journals: new Map(list.map((j) => [j.id, { voucher_no: j.voucher_no, status: j.status }])) as JournalNames }
  }, [api, readKey])
  const thresholds = useAsync(async () => (realityIds.length ? api.listMateriality(realityIds) : []), [api, realityKey])

  const d = main.data
  const waitingA = d?.allocations.filter((a) => a.status === 'proposed').length ?? 0
  const drafts = d?.allocations.filter((a) => a.status === 'draft' || a.status === 'rejected').length ?? 0
  const waitingR = d?.reclass.filter((r) => r.status === 'proposed').length ?? 0
  const set = thresholds.data?.length ?? 0

  return (
    <div>
      <PageHeader
        eyebrow="Control"
        title="Allocations, reclassification and materiality"
        subtitle={<>
          A cost shared between units, a posted line moved to the ledger it belongs in, and the threshold below which a difference counts as small. Each change proposes an entry; the original stays as it was posted.
          <DemoTag className="ml-2" />
        </>}
      />

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Allocations awaiting approval" tone={waitingA ? 'text-warn' : undefined} onClick={() => put({ tab: 'allocations', open: null })} sub={readIds.length ? `${d?.allocations.filter((a) => a.status === 'posted').length ?? 0} posted` : 'Not in your role'}><span className="num">{readIds.length && d ? waitingA : '—'}</span></Tile>
        <Tile label="Allocations not yet proposed" onClick={() => put({ tab: 'allocations', open: null })} sub="drafts, and those rejected"><span className="num">{readIds.length && d ? drafts : '—'}</span></Tile>
        <Tile label="Reclassifications awaiting approval" tone={waitingR ? 'text-warn' : undefined} onClick={() => put({ tab: 'reclassifications', open: null })} sub={readIds.length ? `${d?.reclass.filter((r) => r.status === 'posted').length ?? 0} posted · originals unchanged` : 'Not in your role'}><span className="num">{readIds.length && d ? waitingR : '—'}</span></Tile>
        <Tile label="Companies with a threshold" tone={realityIds.length && thresholds.data && set < realityIds.length ? 'text-warn' : undefined} onClick={() => put({ tab: 'materiality', open: null })} sub={realityIds.length ? `of ${realityIds.length} · without one, every difference is material` : 'Not in your role'}><span className="num">{realityIds.length && thresholds.data ? set : '—'}</span></Tile>
      </div>

      <Tabs tabs={TABS.map((t) => ({ ...t, count: t.key === 'allocations' ? d?.allocations.length : t.key === 'reclassifications' ? d?.reclass.length : undefined }))} value={tab} onChange={(k) => put({ tab: k, open: null })} />

      {tab !== 'materiality' && (!readIds.length ? <Denied perm="journal.view or allocation.manage" what={tab === 'allocations' ? 'allocations' : 'reclassifications'} /> : <>
        {main.error && <ErrorBox message={main.error} retry={main.reload} />}
        {!main.error && !d && <Panel><Loading rows={6} label="Loading" /></Panel>}
        {d && tab === 'allocations' && <AllocationsTab rows={d.allocations} ids={readIds} sp={sp} put={put} />}
        {d && tab === 'reclassifications' && <ReclassTab rows={d.reclass} journals={d.journals} ids={readIds} sp={sp} put={put} />}
      </>)}
      {tab === 'materiality' && (!realityIds.length ? <Denied perm="reality.view" what="the materiality thresholds" /> : <>
        {thresholds.error && <ErrorBox message={thresholds.error} retry={thresholds.reload} />}
        {!thresholds.error && !thresholds.data && <Panel><Loading rows={4} label="Loading" /></Panel>}
        {thresholds.data && <MaterialityTab rows={thresholds.data} ids={realityIds} />}
      </>)}
    </div>
  )
}

// ------------------------------------------------------------------ allocations
const periodText = (a: Pick<Allocation, 'period_from' | 'period_to'>) => `${fmtDate(a.period_from)} – ${fmtDate(a.period_to)}`
const pct = (v: Decimal.Value | null | undefined) => D(v).toDecimalPlaces(2).toString() + '%'

function AllocationsTab({ rows: all, ids, sp, put }: { rows: Allocation[]; ids: ID[]; sp: URLSearchParams; put: Put }) {
  const companies = useApp((s) => s.companies)
  const choices = useCompanyChoices(ids)
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const unitName = useUnitName()
  const manageIds = ids.filter((id) => can('allocation.manage', id))
  const noManage = manageIds.length ? undefined : 'You need the permission allocation.manage to share out a cost'
  const [form, setForm] = useState<Allocation | 'new' | null>(null)
  const [company, setCompany] = useState('')
  const [status, setStatus] = useState('')
  const ccyOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency
  const openId = sp.get('open')
  const sel = openId ? all.find((a) => a.id === openId) ?? null : null
  const rows = all.filter((a) => (!company || a.company_id === company) && (!status || a.status === status))

  const columns: Column<Allocation>[] = [
    { key: 'no', header: 'Number', render: (a) => <span className="num text-[12.5px] text-gold">{a.alloc_no}</span>, sort: (a) => a.alloc_no, csv: (a) => a.alloc_no },
    { key: 'name', header: 'Name', render: (a) => <div className="min-w-0 max-w-[300px]"><div className="truncate text-ink" title={a.name}>{a.name}</div><div className="text-[11px] text-muted">{code(a.company_id)}</div></div>, sort: (a) => a.name.toLowerCase(), csv: (a) => a.name },
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2">{companyName(a.company_id)}</span>, sort: (a) => companyName(a.company_id), csv: (a) => companyName(a.company_id) },
    { key: 'period', header: 'Period', render: (a) => <span className="num whitespace-nowrap text-[12.5px]">{periodText(a)}</span>, sort: (a) => a.period_to, csv: (a) => `${a.period_from} to ${a.period_to}` },
    { key: 'source', header: 'Source', render: (a) => <div className="min-w-0 max-w-[260px]"><div className="truncate text-ink2">{accountName(a.source_account_id)}</div><div className="text-[11px] text-muted">{a.source_org_unit_id ? `held by ${unitName(a.source_org_unit_id)}` : `carried by no ${human(a.dimension_type)}`}</div></div>, sort: (a) => accountName(a.source_account_id), csv: (a) => `${accountName(a.source_account_id)}${a.source_org_unit_id ? ' / ' + unitName(a.source_org_unit_id) : ''}` },
    { key: 'amount', header: 'Amount shared', align: 'right', render: (a) => <Money value={a.amount} currency={ccyOf(a.company_id)} className="text-ink" />, sort: (a) => D(a.amount).toNumber(), csv: (a) => D(a.amount).toFixed(2) },
    { key: 'driver', header: 'Driver', render: (a) => <span className="chip cyan" title={a.driver_note ?? undefined}>{driverLabel(a.driver)}</span>, sort: (a) => a.driver, csv: (a) => `${driverLabel(a.driver)}${a.driver_note ? ' — ' + a.driver_note : ''}` },
    { key: 'to', header: 'Recipients', render: (a) => <span className="text-[12.5px] text-ink2"><span className="num">{a.recipients.length}</span> {human(a.dimension_type)}{a.recipients.length === 1 ? '' : 's'}</span>, sort: (a) => a.recipients.length, csv: (a) => a.recipients.map((r) => `${r.name ?? unitName(r.org_unit_id)} ${D(r.share_pct).toDecimalPlaces(2)}% ${D(r.amount).toFixed(2)}`).join('; ') },
    { key: 'formula', header: 'Formula', render: (a) => <div className="line-clamp-2 min-w-[200px] max-w-[300px] text-[12px] leading-snug text-muted" title={a.formula}>{a.formula}</div>, csv: (a) => a.formula },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} label={STATUS_LABEL[a.status]} />, sort: (a) => a.status, csv: (a) => STATUS_LABEL[a.status] ?? a.status },
  ]

  return (
    <div className="space-y-4">
      <Note>An allocation moves a cost or an income from where it was recorded to the units that should carry it. It says where the amount came from, by what driver it was shared, by what formula, to whom and for which period. It proposes one entry; the ledger total does not change, and the entries that recorded the cost stay as they were posted.</Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} onRow={(a) => put({ open: a.id })} exportName="allocations"
          toolbar={<>
            <select className="field sm" style={{ width: 190 }} aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
            <select className="field sm" style={{ width: 210 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Every status</option>{Object.keys(STATUS_LABEL).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
            <button className="btn sm primary" disabled={!manageIds.length} title={noManage} onClick={() => setForm('new')}><Plus size={13} /> New allocation</button>
          </>}
          empty={all.length ? { title: 'No allocation matches the filter' } : { title: 'No cost has been shared out', body: 'No allocation is recorded in the selected companies.', icon: <Split size={20} /> }} />
      </Panel>

      <AllocationDrawer a={sel} onClose={() => put({ open: null })} onEdit={(a) => setForm(a)} />
      {openId && !sel && <Note kind="warn">The allocation you opened was not found in the companies you can read.</Note>}
      <AllocationForm open={form !== null} editing={form !== null && form !== 'new' ? form : null} companyIds={manageIds} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); put({ open: id }) }} />
    </div>
  )
}

function AllocationDrawer({ a, onClose, onEdit }: { a: Allocation | null; onClose: () => void; onEdit: (a: Allocation) => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const unitName = useUnitName()
  const who = useWho()
  const { act, busy } = useAction()
  const currency = a ? companies.find((c) => c.id === a.company_id)?.base_currency : undefined
  const manage = a ? can('allocation.manage', a.company_id) : false
  const noManage = manage ? undefined : 'You need the permission allocation.manage in this company'
  const open = a ? a.status === 'draft' || a.status === 'rejected' : false
  const income = a ? accounts.find((x) => x.id === a.source_account_id)?.type === 'income' : false
  const totalDriver = a ? sum(a.recipients.map((r) => r.driver_value)) : ZERO
  const unit = a ? DRIVERS.find((x) => x.key === a.driver)?.unit ?? 'driver' : 'driver'
  const left = a ? D(a.pool_balance).minus(a.amount) : ZERO

  type Rec = Allocation['recipients'][number]
  const columns: Column<Rec>[] = [
    { key: 'unit', header: a ? human(a.dimension_type).replace(/^./, (x) => x.toUpperCase()) : 'Unit', render: (r) => <span className="text-ink">{r.name ?? unitName(r.org_unit_id)}</span>, csv: (r) => r.name ?? unitName(r.org_unit_id) },
    { key: 'driver', header: `Its ${unit}`, align: 'right', render: (r) => <span className="num">{D(r.driver_value).toString()}</span>, csv: (r) => D(r.driver_value).toString() },
    { key: 'share', header: 'Share', align: 'right', render: (r) => <div className="ml-auto w-[110px]"><div className="num text-[12.5px]">{pct(r.share_pct)}</div><Meter value={D(r.share_pct).toNumber()} max={100} tone="cyan" height={4} /></div>, csv: (r) => D(r.share_pct).toString() },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} currency={currency} className="text-ink" />, csv: (r) => D(r.amount).toFixed(2) },
  ]

  return (
    <Drawer open={!!a} onClose={onClose} width={720} title={a ? `${a.alloc_no} · ${a.name}` : ''} subtitle={a && <>{companyName(a.company_id)} · {periodText(a)}</>}
      footer={a && open ? <>
        <button className="btn" disabled={!manage || busy} title={noManage} onClick={() => onEdit(a)}><Pencil size={14} /> Edit the draft</button>
        <button className="btn primary" disabled={!manage || busy} title={noManage ?? 'Proposes the accounting entry. It reaches the ledger only when a second person approves it.'}
          onClick={() => void act(() => api.proposeAllocation(a.id), 'Allocation proposed — awaiting approval')}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button>
      </> : undefined}>
      {a && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={a.status} label={STATUS_LABEL[a.status]} />
            <span className="chip cyan">shared by {driverLabel(a.driver).toLowerCase()}</span>
            {a.journal_id && <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + a.journal_id)}>Open the entry <ExternalLink size={11} /></button>}
          </div>
          {open && <ProposedNote>{a.status === 'rejected' ? 'The entry proposed for this allocation was rejected; nothing was posted. It can be edited and proposed again.' : 'This is a draft. Nothing has been proposed and nothing has reached the ledger. Read the figures below; then propose the entry. It is posted only when a second person approves it.'}</ProposedNote>}

          <Section title="Where the amount comes from">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label={`Source — ${income ? 'income' : 'expense'} ledger`}><button className="link text-left" onClick={() => nav(ledgerLink({ accounts: [a.source_account_id], from: a.period_from, to: a.period_to, unit: a.source_org_unit_id ?? undefined }))}>{accountName(a.source_account_id)}</button></Fact>
              <Fact label="Held by">{a.source_org_unit_id ? unitName(a.source_org_unit_id) : `No ${human(a.dimension_type)} — the part of the ledger that names none`}</Fact>
              <Fact label="Period"><span className="num">{periodText(a)}</span></Fact>
              <Fact label="Shared between">{human(a.dimension_type)}s of {companyName(a.company_id)}</Fact>
              <Fact label="The pool: what the source held in the period"><Money value={a.pool_balance} currency={currency} /><div className="text-[11.5px] text-muted">From posted entries of the period, when the draft was saved.</div></Fact>
              <Fact label="Amount shared out"><Money value={a.amount} currency={currency} className="text-gold" /><div className="text-[11.5px] text-muted">{left.isZero() ? 'The whole pool.' : <>Leaves <Money value={left} currency={currency} /> with the source.</>}</div></Fact>
              <div className="sm:col-span-2"><Meter value={D(a.amount).toNumber()} max={Math.max(D(a.pool_balance).toNumber(), D(a.amount).toNumber(), 1)} tone="gold" /></div>
            </Panel>
          </Section>

          <Section title="How it is shared">
            <Panel className="space-y-3 p-4" lit={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Fact label="Driver">{driverLabel(a.driver)}<div className="text-[11.5px] text-muted">{DRIVERS.find((x) => x.key === a.driver)?.what}</div></Fact>
                <Fact label="What the driver rests on">{a.driver_note ?? <span className="text-warn">No note was recorded</span>}</Fact>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Formula</div>
                <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-gold">{a.formula}</div>
                <div className="mt-1.5 text-[11.5px] text-muted">Each share is rounded to two decimals; the last unit takes what is left, so that the shares add up to the amount exactly.</div>
              </div>
            </Panel>
          </Section>

          <Section title={`Who receives it · ${a.recipients.length} ${human(a.dimension_type)}${a.recipients.length === 1 ? '' : 's'}`}>
            <Panel lit={false}>
              <DataTable columns={columns} rows={a.recipients} rowKey={(r) => r.org_unit_id} pageSize={200} exportName={`allocation-${a.alloc_no}`}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total</td>
                  <td className={cx(foot, 'r')}><span className="num">{totalDriver.toString()}</span></td>
                  <td className={cx(foot, 'r')}><span className="num">{pct(sum(a.recipients.map((r) => r.share_pct ?? 0)))}</span></td>
                  <td className={cx(foot, 'r')}><Money value={sum(a.recipients.map((r) => r.amount ?? 0))} currency={currency} className="font-medium text-ink" /></td>
                </tr>} />
            </Panel>
          </Section>

          <Section title="What the entry does">
            <Panel className="p-4 text-[12.5px] leading-relaxed text-ink2" lit={false}>
              One entry, dated {fmtDate(a.period_to)}, all of it in {accountName(a.source_account_id)}: <span className="text-ink">{income ? 'debit' : 'credit'}</span> <Money value={a.amount} currency={currency} /> {a.source_org_unit_id ? <>against {unitName(a.source_org_unit_id)}</> : <>against no {human(a.dimension_type)}</>}, and <span className="text-ink">{income ? 'credit' : 'debit'}</span> each recipient with its share. The balance of the ledger does not change; only the units that carry it do. The entries that recorded the {income ? 'income' : 'cost'} are not touched.
            </Panel>
          </Section>

          <ProposedEntries companyIds={[a.company_id]} sourceId={a.id} sources={['allocation']} title="The entry proposed" />
          <div className="text-[11.5px] text-muted">Recorded by {who(a.created_by)} on {fmtDateTime(a.created_at)}.{a.status === 'posted' ? ' To undo a posted allocation, reverse its entry: the allocation and the reversal both stay on record.' : ''}</div>
        </div>
      )}
    </Drawer>
  )
}

interface Share { id: ID; name: string; value: Decimal | null; pct: Decimal; amount: Decimal }

function AllocationForm({ open, editing, companyIds, onClose, onSaved }: { open: boolean; editing: Allocation | null; companyIds: ID[]; onClose: () => void; onSaved: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const orgUnits = useApp((s) => s.orgUnits)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const last = addMonths(today(), -1)
  const blank = { company_id: '', name: '', period_from: startOfMonth(last), period_to: endOfMonth(last), source_account_id: '', source_org_unit_id: '', dimension_type: '', amount: '', driver: 'headcount' as AllocationDriver, driver_note: '' }
  const [v, setV] = useState(blank)
  const [rec, setRec] = useState<Record<ID, { on: boolean; value: string }>>({})
  useEffect(() => {
    if (!open) return
    if (editing) {
      setV({ company_id: editing.company_id, name: editing.name, period_from: editing.period_from, period_to: editing.period_to, source_account_id: editing.source_account_id, source_org_unit_id: editing.source_org_unit_id ?? '', dimension_type: editing.dimension_type, amount: D(editing.amount).toString(), driver: editing.driver, driver_note: editing.driver_note ?? '' })
      setRec(Object.fromEntries(editing.recipients.map((r) => [r.org_unit_id, { on: true, value: D(r.driver_value).toString() }])))
    } else { setV({ ...blank, company_id: choices[0]?.id ?? '' }); setRec({}) }
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const types = useAsync(() => api.listOrgUnitTypes().catch(() => [] as TypeDef[]), [api])
  const typeName = (k: string) => types.data?.find((t) => t.key === k)?.name ?? human(k)
  const currency = companies.find((c) => c.id === v.company_id)?.base_currency
  const units = useMemo(() => orgUnits.filter((u) => u.company_id === v.company_id && u.status !== 'inactive' && u.status !== 'archived'), [orgUnits, v.company_id])
  const kinds = useMemo(() => [...new Set(units.map((u) => u.type_key))], [units])
  const ofKind = units.filter((u) => u.type_key === v.dimension_type).sort((a, b) => a.name.localeCompare(b.name))
  const ledgers = accounts.filter((a) => a.company_id === v.company_id && !a.is_group && a.is_active && (a.type === 'expense' || a.type === 'income')).sort((a, b) => a.code.localeCompare(b.code))
  const ledger = ledgers.find((a) => a.id === v.source_account_id)
  const srcUnit = ofKind.find((u) => u.id === v.source_org_unit_id)

  // what the ledger moved in the period, read the way the ledger screen reads it
  const periodOk = !!v.period_from && !!v.period_to && v.period_to >= v.period_from
  const mayRead = !!v.company_id && (can('journal.view', v.company_id) || can('report.view', v.company_id))
  const held = useAsync(async () => {
    if (!open || !ledger || !periodOk || !mayRead) return null
    const rows = await api.ledgerBalances([v.company_id], v.period_from, v.period_to, v.source_org_unit_id ? { dim: v.source_org_unit_id } : undefined).catch(() => null)
    if (!rows) return null
    const r = rows.find((x) => x.account_id === ledger.id)
    const moved = r ? D(r.period_debit).minus(r.period_credit) : ZERO
    return ledger.type === 'income' ? moved.neg() : moved
  }, [api, open, v.company_id, ledger?.id, v.period_from, v.period_to, v.source_org_unit_id, periodOk, mayRead])

  const amount = D(v.amount || 0)
  const equal = v.driver === 'equal'
  const unit = DRIVERS.find((x) => x.key === v.driver)?.unit ?? 'driver'
  const chosen = ofKind.filter((u) => rec[u.id]?.on && u.id !== v.source_org_unit_id)
  const missing = equal ? [] : chosen.filter((u) => (rec[u.id]?.value ?? '').trim() === '')
  const total = equal ? D(chosen.length) : sum(chosen.map((u) => rec[u.id]?.value || 0))
  const shares: Share[] = useMemo(() => {
    let left = amount
    return chosen.map((u, i) => {
      const value = equal ? D(1) : (rec[u.id]?.value ?? '').trim() === '' ? null : D(rec[u.id].value)
      const share = total.lte(0) || value === null ? ZERO : i === chosen.length - 1 ? left : round2(amount.times(value).div(total))
      left = left.minus(share)
      return { id: u.id, name: u.name, value, pct: total.lte(0) || value === null ? ZERO : value.times(100).div(total), amount: share }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.map((u) => u.id).join(','), JSON.stringify(rec), v.amount, v.driver])

  const problem = !v.company_id ? 'Choose the company.' : !v.name.trim() ? 'Give the allocation a name.' : !periodOk ? 'State the period: the end cannot be before the start.'
    : !ledger ? 'Choose the income or expense ledger that holds the amount.' : !v.dimension_type ? 'Choose the kind of unit the amount is shared between.' : amount.lte(0) ? 'Enter the amount to share out.'
    : srcUnit && held.data && amount.gt(held.data) ? `${srcUnit.name} holds ${held.data.toFixed(2)} in this ledger for the period. No more than that can be shared out.`
    : v.driver === 'manual' && !v.driver_note.trim() ? 'Manual shares need a note saying what they rest on.'
    : !chosen.length ? 'Choose the units that receive the amount.' : missing.length ? `${missing[0].name} needs the value of its ${unit}.` : total.lte(0) ? 'The drivers add up to nothing, so there is nothing to share by.' : null

  const submit = () => void act(() => api.saveAllocation({
    id: editing?.id, company_id: v.company_id, name: v.name.trim(), period_from: v.period_from, period_to: v.period_to, source_account_id: v.source_account_id, source_org_unit_id: v.source_org_unit_id || null,
    dimension_type: v.dimension_type, amount: round2(amount).toString(), driver: v.driver, driver_note: v.driver_note.trim() || undefined,
    recipients: chosen.map((u) => ({ org_unit_id: u.id, driver_value: equal ? 1 : rec[u.id].value })),
  }), 'Draft saved — nothing has been proposed yet').then((id) => { if (id) onSaved(id) })

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.alloc_no}` : 'New allocation'} subtitle="Saves a draft. The pool, the shares and the formula are shown before anything is proposed." width={860}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <Save size={15} />} Save the draft and review it</button></>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company"><select className="field" value={v.company_id} disabled={!!editing} onChange={(e) => { setV({ ...v, company_id: e.target.value, source_account_id: '', source_org_unit_id: '', dimension_type: '' }); setRec({}) }}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Name" className="lg:col-span-2"><input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="For example: Head office rent, shared by area" /></Field>
        <Field label="Period from"><input type="date" className="field" value={v.period_from} onChange={(e) => setV({ ...v, period_from: e.target.value })} /></Field>
        <Field label="Period to" hint="The entry is dated on this day."><input type="date" className="field" value={v.period_to} min={v.period_from} onChange={(e) => setV({ ...v, period_to: e.target.value })} /></Field>
        <Field label="Amount to share out"><input className="field num" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value) })} /></Field>

        <Field label="Source: the ledger that holds the amount" className="sm:col-span-2" hint="An income or expense ledger of the company.">
          <select className="field" value={v.source_account_id} onChange={(e) => setV({ ...v, source_account_id: e.target.value })}><option value="">Choose…</option>
            <optgroup label="Expense">{ledgers.filter((a) => a.type === 'expense').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
            <optgroup label="Income">{ledgers.filter((a) => a.type === 'income').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Shared between" hint={v.company_id && !kinds.length ? 'This company has no units. Create departments, projects or branches first.' : undefined}>
          <select className="field" value={v.dimension_type} onChange={(e) => { setV({ ...v, dimension_type: e.target.value, source_org_unit_id: '' }); setRec({}) }}><option value="">Choose…</option>{kinds.map((k) => <option key={k} value={k}>{typeName(k)}</option>)}</select>
        </Field>
        <Field label="The unit that holds it now (optional)" className="sm:col-span-2" hint={v.dimension_type ? `Leave empty when the amount was recorded without naming a ${typeName(v.dimension_type).toLowerCase()}.` : undefined}>
          <select className="field" value={v.source_org_unit_id} disabled={!v.dimension_type} onChange={(e) => setV({ ...v, source_org_unit_id: e.target.value })}><option value="">No unit — the part of the ledger that names none</option>{ofKind.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
        </Field>
        <Field label="Driver" hint={DRIVERS.find((x) => x.key === v.driver)?.what}>
          <select className="field" value={v.driver} onChange={(e) => setV({ ...v, driver: e.target.value as AllocationDriver })}>{DRIVERS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
        </Field>
        <Field label={`What the driver rests on${v.driver === 'manual' ? ' (required)' : ''}`} className="sm:col-span-2 lg:col-span-3" hint="Where the figures come from and as at which date: the payroll of March, the lease plan, the meter readings.">
          <input className="field" value={v.driver_note} onChange={(e) => setV({ ...v, driver_note: e.target.value })} />
        </Field>
      </div>

      {ledger && periodOk && (
        <div className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink2">
          {!mayRead ? <>Your role does not read the ledger of this company, so what the source holds cannot be shown here. It is stated when the draft is saved.</>
            : held.loading ? 'Reading the ledger…'
            : held.data === null || held.data === undefined ? 'What the source holds could not be read. It is stated when the draft is saved.'
            : srcUnit ? <><span className="text-ink">{srcUnit.name}</span> holds <Money value={held.data} currency={currency} className="text-ink" /> in {ledger.name} for the period, from posted entries. That is the pool; no more than that can be shared out.</>
            : <>{ledger.name} moved <Money value={held.data} currency={currency} className="text-ink" /> in the period, every unit included. The pool is only the part that names no {typeName(v.dimension_type || 'unit').toLowerCase()}; it is worked out and shown when the draft is saved, and the draft is refused if the amount exceeds it.</>}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="eyebrow">Recipients{v.dimension_type ? ` · ${typeName(v.dimension_type).toLowerCase()}s` : ''}</div>
          {ofKind.length > 0 && <div className="flex gap-2">
            <button className="btn sm ghost" onClick={() => setRec((r) => Object.fromEntries(ofKind.filter((u) => u.id !== v.source_org_unit_id).map((u) => [u.id, { on: true, value: r[u.id]?.value ?? '' }])))}>Choose all</button>
            <button className="btn sm ghost" onClick={() => setRec({})}>Clear</button>
          </div>}
        </div>
        <Panel lit={false}>
          {!v.dimension_type ? <div className="px-4 py-4 text-[12.5px] text-muted">Choose the kind of unit the amount is shared between.</div>
            : ofKind.length === 0 ? <div className="px-4 py-4 text-[12.5px] text-muted">This company has no {typeName(v.dimension_type).toLowerCase()}.</div>
            : (
              <div className="max-h-[300px] overflow-auto">
                <table className="table dense">
                  <thead><tr><th style={{ width: 44 }} /><th>Unit</th><th className="r" style={{ textAlign: 'right' }}>{equal ? 'Share' : `Its ${unit}`}</th><th className="r" style={{ textAlign: 'right' }}>Share</th><th className="r" style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {ofKind.map((u) => {
                      const source = u.id === v.source_org_unit_id
                      const on = !!rec[u.id]?.on && !source
                      const s = shares.find((x) => x.id === u.id)
                      return (
                        <tr key={u.id}>
                          <td><input type="checkbox" aria-label={`${u.name} receives a share`} checked={on} disabled={source} onChange={(e) => setRec((r) => ({ ...r, [u.id]: { on: e.target.checked, value: r[u.id]?.value ?? '' } }))} /></td>
                          <td><span className={cx(on ? 'text-ink' : 'text-ink2')}>{u.code} · {u.name}</span>{source && <span className="ml-2 text-[11px] text-muted">holds the amount — cannot also receive it</span>}</td>
                          <td className="r" style={{ textAlign: 'right' }}>{equal ? <span className="num text-muted">{on ? '1' : '—'}</span> : <input className="field sm num" style={{ width: 120, textAlign: 'right' }} inputMode="decimal" aria-label={`${unit} of ${u.name}`} disabled={!on} value={rec[u.id]?.value ?? ''} onChange={(e) => setRec((r) => ({ ...r, [u.id]: { on: true, value: digits(e.target.value) } }))} />}</td>
                          <td className="r" style={{ textAlign: 'right' }}><span className="num">{s && on ? pct(s.pct) : '—'}</span></td>
                          <td className="r" style={{ textAlign: 'right' }}>{s && on ? <Money value={s.amount} currency={currency} /> : <span className="text-muted">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td className={foot} /><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>{chosen.length} chosen</td>
                    <td className={cx(foot, 'r')}><span className="num">{total.toString()}</span></td>
                    <td className={cx(foot, 'r')}><span className="num">{pct(sum(shares.map((s) => s.pct)))}</span></td>
                    <td className={cx(foot, 'r')}><Money value={sum(shares.map((s) => s.amount))} currency={currency} className="font-medium text-ink" /></td>
                  </tr></tfoot>
                </table>
              </div>
            )}
        </Panel>
        {chosen.length > 0 && amount.gt(0) && total.gt(0) && (
          <div className="mt-2">
            <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-gold">Share of a unit = {round2(amount).toString()} × its {v.driver} ÷ total {v.driver} of {total.toString()}</div>
            <div className="mt-1 text-[11.5px] text-muted">The shares above are worked out here as they will be when the draft is saved: each rounded to two decimals, the last unit taking what is left.</div>
          </div>
        )}
      </div>
      {problem && (v.name || v.amount) && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ reclassifications
function ReclassTab({ rows: all, journals, ids, sp, put }: { rows: Reclassification[]; journals: JournalNames; ids: ID[]; sp: URLSearchParams; put: Put }) {
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const choices = useCompanyChoices(ids)
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const who = useWho()
  const writeIds = ids.filter((id) => mayWriteReclass(id) && can('journal.view', id))
  const noWrite = writeIds.length ? undefined : 'You need the permissions journal.view and journal.create to propose a reclassification'
  const [adding, setAdding] = useState(false)
  const [company, setCompany] = useState('')
  const [status, setStatus] = useState('')
  const ccyOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency
  const openId = sp.get('open')
  const sel = openId ? all.find((r) => r.id === openId) ?? null : null
  const rows = all.filter((r) => (!company || r.company_id === company) && (!status || r.status === status))
  const voucher = (id: ID | null) => (id ? journals.get(id)?.voucher_no ?? null : null)
  const entry = (id: ID | null, fallback: string) => (id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav('/journals/' + id) }}><span className="num">{voucher(id) ?? fallback}</span> <ExternalLink size={11} /></button> : <span className="text-muted">—</span>)

  const columns: Column<Reclassification>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="num text-[12.5px]">{fmtDate(r.reclass_date)}</span>, sort: (r) => r.reclass_date, csv: (r) => r.reclass_date },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companyName(r.company_id)}>{code(r.company_id)}</span>, sort: (r) => companyName(r.company_id), csv: (r) => companyName(r.company_id) },
    { key: 'orig', header: 'Original entry — unchanged', render: (r) => entry(r.journal_id, 'Open'), sort: (r) => voucher(r.journal_id) ?? '', csv: (r) => voucher(r.journal_id) ?? r.journal_id },
    { key: 'from', header: 'From ledger', render: (r) => <span className="text-ink2">{accountName(r.from_account_id)}</span>, sort: (r) => accountName(r.from_account_id), csv: (r) => accountName(r.from_account_id) },
    { key: 'to', header: 'To ledger', render: (r) => <span className="flex items-center gap-1.5 text-ink"><ArrowRight size={12} className="flex-none text-gold" />{accountName(r.to_account_id)}</span>, sort: (r) => accountName(r.to_account_id), csv: (r) => accountName(r.to_account_id) },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <div><Money value={r.amount} currency={ccyOf(r.company_id)} className="text-ink" /><div className="text-[11px] text-muted">{r.side} side</div></div>, sort: (r) => D(r.amount).toNumber(), csv: (r) => D(r.amount).toFixed(2) },
    { key: 'reason', header: 'Reason', render: (r) => <div className="line-clamp-2 min-w-[200px] max-w-[320px] text-[12.5px] leading-snug text-ink2" title={r.reason}>{r.reason}</div>, sort: (r) => r.reason.toLowerCase(), csv: (r) => r.reason },
    { key: 'by', header: 'Asked by', render: (r) => <div className="text-[12.5px]"><div className="text-ink2">{who(r.requested_by)}</div><div className="num text-[11px] text-muted">{fmtDateTime(r.requested_at)}</div></div>, sort: (r) => r.requested_at, csv: (r) => `${who(r.requested_by)} ${r.requested_at}` },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} label={STATUS_LABEL[r.status]} />, sort: (r) => r.status, csv: (r) => STATUS_LABEL[r.status] ?? r.status },
    { key: 'new', header: 'New entry', render: (r) => entry(r.new_journal_id, 'Open'), sort: (r) => voucher(r.new_journal_id) ?? '', csv: (r) => voucher(r.new_journal_id) ?? r.new_journal_id ?? '' },
  ]

  return (
    <div className="space-y-4">
      <Note>
        A reclassification never changes the entry that was posted. It proposes a <span className="text-ink">new</span> entry that moves the amount from the ledger it was put in to the ledger it belongs in, with the reason — and that entry is posted only when a second person approves it. The original classification, the new one, who asked, when, why, the approval and the accounting effect all stay on record.
        <div className="mt-1.5 text-ink2">{FIXED_RULE}</div>
      </Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRow={(r) => put({ open: r.id })} exportName="reclassifications"
          toolbar={<>
            <select className="field sm" style={{ width: 190 }} aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Every company</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
            <select className="field sm" style={{ width: 220 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Every status</option>{['proposed', 'posted', 'rejected', 'reversed'].map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
            <button className="btn sm primary" disabled={!writeIds.length} title={noWrite} onClick={() => setAdding(true)}><Shuffle size={13} /> Reclassify a posted line</button>
          </>}
          empty={all.length ? { title: 'No reclassification matches the filter' } : { title: 'Nothing has been reclassified', body: 'No reclassification is recorded in the selected companies.', icon: <Shuffle size={20} /> }} />
      </Panel>

      <Drawer open={!!sel} onClose={() => put({ open: null })} width={620} title={sel ? `Reclassification of ${fmtDate(sel.reclass_date)}` : ''} subtitle={sel && <>{companyName(sel.company_id)} · {STATUS_LABEL[sel.status]}</>}>
        {sel && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><StatusChip status={sel.status} label={STATUS_LABEL[sel.status]} /></div>
            <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-xl border border-line bg-surface p-3.5"><div className="eyebrow">Original classification</div><div className="mt-1.5 text-[13px] text-ink">{accountName(sel.from_account_id)}</div><div className="mt-1 text-[11.5px] text-muted">As posted. It is not changed.</div></div>
              <div className="grid place-items-center text-gold"><ArrowRight size={18} /></div>
              <div className="rounded-xl border border-gold/30 bg-goldsoft p-3.5"><div className="eyebrow">New classification</div><div className="mt-1.5 text-[13px] text-ink">{accountName(sel.to_account_id)}</div><div className="mt-1 text-[11.5px] text-muted">{sel.status === 'posted' ? 'In force.' : sel.status === 'proposed' ? 'Proposed. Not in the books yet.' : 'Not in force.'}</div></div>
            </div>
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Amount"><Money value={sel.amount} currency={ccyOf(sel.company_id)} /> <span className="text-muted">· {sel.side} side of the line</span></Fact>
              <Fact label="Date of the new entry"><span className="num">{fmtDate(sel.reclass_date)}</span></Fact>
              <Fact label="Reason" className="sm:col-span-2">{sel.reason}</Fact>
              <Fact label="Asked by">{who(sel.requested_by)}</Fact>
              <Fact label="Asked on"><span className="num">{fmtDateTime(sel.requested_at)}</span></Fact>
              <Fact label="Original entry">{entry(sel.journal_id, 'Open the original entry')}</Fact>
              <Fact label="New entry, with its approval">{sel.new_journal_id ? entry(sel.new_journal_id, 'Open the new entry') : 'None'}</Fact>
              <Fact label="Accounting effect" className="sm:col-span-2">
                {sel.side === 'debit' ? 'Debit' : 'Credit'} {accountName(sel.to_account_id)} and {sel.side === 'debit' ? 'credit' : 'debit'} {accountName(sel.from_account_id)} with <Money value={sel.amount} currency={ccyOf(sel.company_id)} />, carrying the party and the units of the original line.
                <div className="mt-1 text-[11.5px] text-muted">{sel.status === 'posted' ? 'Posted: both entries are in the books, and the ledgers show the amount where it now belongs.' : sel.status === 'proposed' ? 'Awaiting approval: nothing has reached the ledger. Who approves, and when, is on the new entry.' : sel.status === 'rejected' ? 'Rejected: nothing was posted. The original stands alone.' : 'The new entry was posted and later reversed. The original stands as it was.'}</div>
              </Fact>
            </Panel>
            <div className="flex flex-wrap gap-2">
              <button className="btn sm" onClick={() => nav(ledgerLink({ accounts: [sel.from_account_id] }))}>Ledger of the original classification</button>
              <button className="btn sm" onClick={() => nav(ledgerLink({ accounts: [sel.to_account_id] }))}>Ledger of the new classification</button>
              {sel.status === 'proposed' && <button className="btn sm" onClick={() => nav('/approvals')}>Approval inbox</button>}
            </div>
            <ProposedEntries companyIds={[sel.company_id]} sourceId={sel.id} sources={['reclassification']} title="The entry proposed" />
          </div>
        )}
      </Drawer>
      {openId && !sel && <Note kind="warn">The reclassification you opened was not found in the companies you can read.</Note>}
      <ReclassForm open={adding} companyIds={writeIds} onClose={() => setAdding(false)} />
    </div>
  )
}

function ReclassForm({ open, companyIds, onClose }: { open: boolean; companyIds: ID[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const [company, setCompany] = useState('')
  const [find, setFind] = useState('')
  const [asked, setAsked] = useState('')
  const [journalId, setJournalId] = useState<ID | null>(null)
  const [lineId, setLineId] = useState<ID | null>(null)
  const [v, setV] = useState({ to: '', amount: '', date: today(), reason: '' })
  useEffect(() => { if (open) { setCompany(choices[0]?.id ?? ''); setFind(''); setAsked(''); setJournalId(null); setLineId(null); setV({ to: '', amount: '', date: today(), reason: '' }) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setAsked(find.trim()), 350); return () => clearTimeout(t) }, [find])

  const found = useAsync(async () => (open && company && !journalId ? api.listJournals({ companyIds: [company], status: ['posted'], q: asked || undefined, limit: 25 }) : null), [api, open, company, asked, journalId])
  const detail = useAsync(async () => {
    if (!open || !journalId) return null
    const [journal, done] = await Promise.all([api.openJournal(journalId), api.listReclassifications({ companyIds: [company], journalId })])
    return { journal, done }
  }, [api, open, journalId, company])
  const j = detail.data?.journal ?? null
  const currency = companies.find((c) => c.id === company)?.base_currency
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const lineAmount = (l: JournalLineView) => Decimal.max(D(l.debit), D(l.credit))
  const doneOn = (l: JournalLineView) => sum((detail.data?.done ?? []).filter((r) => r.line_id === l.id && (r.status === 'proposed' || r.status === 'posted')).map((r) => r.amount))
  const fixed = (l: JournalLineView) => FIXED_LEDGERS.includes(byId.get(l.account_id)?.control_type ?? '')
  const line = j?.lines.find((l) => l.id === lineId) ?? null
  const left = line ? lineAmount(line).minus(doneOn(line)) : ZERO
  const targets: Account[] = accounts.filter((a) => a.company_id === company && !a.is_group && a.is_active && !FIXED_LEDGERS.includes(a.control_type ?? '') && a.id !== line?.account_id).sort((a, b) => a.code.localeCompare(b.code))
  const groups = [...new Set(targets.map((a) => a.type))]
  const amount = D(v.amount || 0)

  const pickLine = (l: JournalLineView) => { setLineId(l.id); setV((x) => ({ ...x, to: '', amount: lineAmount(l).minus(doneOn(l)).toString() })) }
  const problem = !company ? 'Choose the company.' : !journalId ? 'Find the posted entry and choose it.' : !line ? 'Choose the line to move.' : !v.to ? 'Choose the ledger the amount belongs in.'
    : amount.lte(0) ? 'Enter the amount to move.' : amount.gt(left) ? `At most ${left.toFixed(2)} of this line is left to move.` : !v.date ? 'Choose the date of the new entry.' : v.date > today() ? 'The new entry cannot be dated in the future.' : !v.reason.trim() ? 'A reclassification records its reason.' : null
  const submit = () => { if (line) void act(() => api.proposeReclassification({ line_id: line.id, to_account_id: v.to, amount: round2(amount).toString(), date: v.date, reason: v.reason.trim() }), 'Reclassification proposed — awaiting approval').then((id) => { if (id) onClose() }) }

  return (
    <Modal open={open} onClose={onClose} title="Reclassify a posted line" subtitle="Proposes a new entry that moves the amount. The posted entry is not changed." width={860}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
      <ProposedNote>The original entry stays exactly as it was posted. This proposes a second entry that moves the amount, with its reason. It reaches the ledger only when a second person approves it. {FIXED_RULE}</ProposedNote>

      <div className="eyebrow mb-2">1 · The posted entry</div>
      {!journalId ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <select className="field" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Choose the company…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
            <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="field" style={{ paddingLeft: 32 }} aria-label="Find the entry" placeholder="Voucher number, or words of the narration" value={find} onChange={(e) => setFind(e.target.value)} autoFocus /></div>
          </div>
          <Panel className="mt-3 max-h-[300px] overflow-auto p-1.5" lit={false}>
            {found.error ? <div className="px-3 py-3 text-[12.5px] text-neg">The entries could not be read: {found.error}</div>
              : found.loading || !found.data ? <div className="px-3 py-3 text-[12.5px] text-muted">{company ? 'Searching…' : 'Choose the company.'}</div>
              : found.data.rows.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No posted entry matches{asked ? ` “${asked}”` : ''}, or none that matches is shared with you.</div>
              : found.data.rows.map((x) => (
                <button key={x.id} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => { setJournalId(x.id); setLineId(null) }}>
                  <span className="num w-[130px] flex-none text-[12.5px] text-gold">{x.voucher_no ?? 'no number'}</span>
                  <span className="num w-[92px] flex-none text-[12px] text-muted">{fmtDate(x.journal_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">{x.narration ?? human(x.voucher_type)}</span>
                  <Money value={x.total} currency={currency} className="flex-none text-[12.5px]" />
                </button>
              ))}
          </Panel>
          {found.data && found.data.total > found.data.rows.length && <div className="mt-1.5 text-[11.5px] text-muted">{found.data.rows.length} of {found.data.total} posted entries are listed. Type the voucher number or words of the narration to narrow.</div>}
        </>
      ) : (
        <Panel className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" lit={false}>
          {j ? <>
            <span className="num text-[12.5px] text-gold">{j.voucher_no ?? 'no number'}</span>
            <span className="num text-[12px] text-muted">{fmtDate(j.journal_date)}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">{j.narration ?? human(j.voucher_type)}</span>
            <Money value={j.total} currency={currency} className="text-[12.5px]" />
          </> : <span className="flex-1 text-[12.5px] text-muted">{detail.error ? `The entry could not be opened: ${detail.error}` : 'Opening the entry…'}</span>}
          <button className="btn sm ghost" onClick={() => { setJournalId(null); setLineId(null) }}>Choose another entry</button>
        </Panel>
      )}

      {j && (
        <>
          <div className="eyebrow mb-2 mt-5">2 · The line to move</div>
          {j.restricted ? <Note kind="warn">{j.message ?? 'This entry is classified above your clearance. Its lines are not shown.'}</Note> : (
            <Panel lit={false}>
              <div className="max-h-[260px] overflow-auto">
                <table className="table dense">
                  <thead><tr><th style={{ width: 44 }} /><th>Ledger</th><th>Party and description</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Left to move</th></tr></thead>
                  <tbody>
                    {j.lines.map((l) => {
                      const rest = lineAmount(l).minus(doneOn(l))
                      const off = fixed(l) ? 'This ledger records what happened with someone else. It is corrected by reversing the source document.' : rest.lte(0) ? 'The whole line has been reclassified already.' : null
                      return (
                        <tr key={l.id} className={cx(!off && 'rowlink', lineId === l.id && 'bg-surface2')} onClick={off ? undefined : () => pickLine(l)} title={off ?? undefined}>
                          <td><input type="radio" name="reclass-line" aria-label={`Line ${l.line_no}: ${l.account_name}`} checked={lineId === l.id} disabled={!!off} onChange={() => pickLine(l)} /></td>
                          <td><span className={cx(off ? 'text-muted' : 'text-ink')}><span className="num text-gold">{l.account_code}</span> · {l.account_name}</span>{fixed(l) && <div className="text-[11px] text-muted">cannot be reclassified</div>}</td>
                          <td className="text-[12.5px] text-ink2">{[l.party_name, l.description].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="r"><Money value={l.debit} currency={currency} dim /></td>
                          <td className="r"><Money value={l.credit} currency={currency} dim /></td>
                          <td className="r">{fixed(l) ? <span className="text-muted">—</span> : <Money value={rest} currency={currency} className={rest.lte(0) ? 'text-muted' : 'text-ink'} />}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}

      {line && (
        <>
          <div className="eyebrow mb-2 mt-5">3 · Where it belongs, and why</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="From — as posted"><div className="field flex items-center text-ink2"><span className="truncate">{line.account_code} · {line.account_name}</span></div></Field>
            <Field label="To — the ledger it belongs in" className="lg:col-span-2">
              <select className="field" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })}><option value="">Choose…</option>{groups.map((g) => <optgroup key={g} label={human(g).replace(/^./, (x) => x.toUpperCase())}>{targets.filter((a) => a.type === g).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>)}</select>
            </Field>
            <Field label="Amount to move" hint={`Up to ${left.toFixed(2)}: the line carries ${lineAmount(line).toFixed(2)}${doneOn(line).gt(0) ? `, of which ${doneOn(line).toFixed(2)} has been reclassified or proposed already` : ''}.`}>
              <input className="field num" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value) })} />
            </Field>
            <Field label="Date of the new entry"><input type="date" className="field" value={v.date} max={today()} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
            <Field label="Reason (required)" className="sm:col-span-2 lg:col-span-3" hint="Why the amount belongs in the other ledger. It is written on the new entry and kept with the original.">
              <textarea className="field" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
            </Field>
          </div>
          {v.to && amount.gt(0) && (
            <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink2">
              The entry proposed: <span className="text-ink">{D(line.debit).gt(0) ? 'debit' : 'credit'}</span> {byId.get(v.to)?.name} and <span className="text-ink">{D(line.debit).gt(0) ? 'credit' : 'debit'}</span> {line.account_name} with <Money value={amount} currency={currency} className="text-ink" />. Entry {j?.voucher_no ?? ''} itself is not touched.
            </div>
          )}
        </>
      )}
      {problem && journalId && line && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ materiality
interface ThresholdRow { id: ID; code: string; name: string; currency: string; m: Materiality | null }

function MaterialityTab({ rows: set, ids }: { rows: Materiality[]; ids: ID[] }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const choices = useCompanyChoices(ids)
  const who = useWho()
  const { act, busy } = useAction()
  const [editing, setEditing] = useState<ThresholdRow | null>(null)
  const [v, setV] = useState({ amount: '', pct: '', note: '' })
  useEffect(() => { if (editing) setV({ amount: editing.m ? D(editing.m.amount).toString() : '', pct: editing.m?.pct != null ? D(editing.m.pct).toString() : '', note: '' }) }, [editing])
  const rows: ThresholdRow[] = choices.map((c) => ({ id: c.id, code: c.code, name: c.name, currency: c.base_currency, m: set.find((x) => x.company_id === c.id) ?? null }))

  const columns: Column<ThresholdRow>[] = [
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink"><span className="num text-gold">{r.code}</span> · {r.name}</span>, sort: (r) => r.name, csv: (r) => r.name },
    { key: 'amount', header: 'Threshold', align: 'right', render: (r) => (r.m ? <Money value={r.m.amount} currency={r.currency} className="text-ink" /> : <span className="chip warn" title="Without a threshold, every difference counts as material">not set</span>), sort: (r) => (r.m ? D(r.m.amount).toNumber() : -1), csv: (r) => (r.m ? D(r.m.amount).toFixed(2) : '') },
    { key: 'pct', header: 'Percentage recorded with it', align: 'right', render: (r) => (r.m?.pct != null ? <span className="num">{D(r.m.pct).toString()}%</span> : <span className="text-muted">—</span>), sort: (r) => D(r.m?.pct).toNumber(), csv: (r) => (r.m?.pct != null ? D(r.m.pct).toString() : '') },
    { key: 'note', header: 'What it rests on', render: (r) => (r.m ? <div className="min-w-[220px] max-w-[420px] text-[12.5px] leading-snug text-ink2">{r.m.note ?? '—'}</div> : <span className="text-[12.5px] text-muted">Every difference counts as material</span>), csv: (r) => r.m?.note ?? '' },
    { key: 'by', header: 'Set by', render: (r) => (r.m ? <div className="text-[12.5px]"><div className="text-ink2">{who(r.m.set_by)}</div><div className="num text-[11px] text-muted">{fmtDateTime(r.m.set_at)}</div></div> : <span className="text-muted">—</span>), sort: (r) => r.m?.set_at ?? '', csv: (r) => (r.m ? `${who(r.m.set_by)} ${r.m.set_at}` : '') },
    {
      key: 'act', header: '', align: 'right',
      render: (r) => { const ok = can('reality.manage', r.id); return <button className="btn sm" disabled={!ok} title={ok ? undefined : 'You need the permission reality.manage in this company'} onClick={() => setEditing(r)}><SlidersHorizontal size={13} /> {r.m ? 'Change' : 'Set the threshold'}</button> },
    },
  ]

  const amountOk = v.amount.trim() !== ''
  const problem = !amountOk ? 'Enter the threshold: an amount of zero or more.' : v.pct.trim() !== '' && D(v.pct).gt(100) ? 'The percentage cannot exceed 100.' : !v.note.trim() ? 'Record what the threshold rests on.' : null
  const save = () => { if (editing) void act(() => api.setMateriality(editing.id, round2(v.amount).toString(), v.pct.trim() === '' ? null : v.pct, v.note.trim()).then(() => true), 'Threshold recorded').then((ok) => { if (ok) setEditing(null) }) }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4 text-[12.5px] leading-relaxed text-ink2" lit={false}>
          <div className="eyebrow mb-2">What the threshold is used for</div>
          The same amount can matter in one company and be small in another, so each company has its own threshold. A difference <span className="text-ink">above</span> it is marked material and is raised with priority. A difference <span className="text-ink">at or below</span> it is still found, still shown on the <button className="link" onClick={() => nav('/reality?tab=differences')}>differences screen</button>, and marked “below the threshold”. It can still be taken up in a case.
        </Panel>
        <Panel className="p-4 text-[12.5px] leading-relaxed text-ink2" lit={false}>
          <div className="eyebrow mb-2">What it is never used for</div>
          A threshold hides nothing, erases nothing and changes no transaction. It does not round a difference away and it posts no entry. Differences are compared with the <span className="text-ink">amount</span>; the percentage is recorded beside it as part of what the amount rests on, and is not used in the comparison. Every change of a threshold is written to the audit trail with its basis.
        </Panel>
      </div>
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} exportName="materiality-thresholds" pageSize={100}
          toolbar={<span className="text-[12px] text-muted">{set.length} of {rows.length} compan{rows.length === 1 ? 'y has' : 'ies have'} a threshold. A company without one treats every difference as material.</span>} />
      </Panel>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.m ? 'Change the threshold' : 'Set the threshold'} subtitle={editing ? `${editing.code} · ${editing.name}` : undefined} width={540}
        footer={<><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} Record the threshold</button></>}>
        {editing && (
          <div className="space-y-4">
            {editing.m && <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink2">Now <Money value={editing.m.amount} currency={editing.currency} className="text-ink" />, set by {who(editing.m.set_by)} on {fmtDateTime(editing.m.set_at)}{editing.m.note ? ` — ${editing.m.note}` : ''}. The change is written to the audit trail; the earlier threshold stays in it.</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Threshold (${editing.currency})`} hint="Zero means every difference is material."><input className="field num" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value) })} autoFocus /></Field>
              <Field label="Percentage (optional)" hint="Recorded with the basis. Not used in the comparison."><input className="field num" inputMode="decimal" value={v.pct} onChange={(e) => setV({ ...v, pct: digits(e.target.value) })} placeholder="For example 0.5" /></Field>
            </div>
            <Field label="What the threshold rests on (required)" hint="For example: 0.5% of the revenue of last year, agreed with the auditors.">
              <textarea className="field" rows={3} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </Field>
            <div className="text-[11.5px] text-muted">A lower threshold marks more differences as material. It removes nothing from any screen, in either direction.</div>
            {problem && (v.amount || v.note) && <div className="text-[12px] text-warn">{problem}</div>}
          </div>
        )}
      </Modal>
    </div>
  )
}
