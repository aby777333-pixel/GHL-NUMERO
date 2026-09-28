import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, BadgeCheck, Banknote, Briefcase, Calculator, Check, ChevronDown, ChevronRight, ExternalLink, HandCoins, Landmark, Megaphone, Pencil, Plus, Save, Scale, Send, Users, X } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { CapitalCall, CapitalCallLine, Distribution, Fund, FundCommitment, FundFee, Holding, HoldingTxn, NavRun, UnitAllotment } from '@/engine/p3Types'
import { carryingAmount, fundSummary, investorStatement, type FundSummary, type InvestorStatement } from '@/engine/invest'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO, fmtMoney, round2, sum } from '@/lib/money'
import { addDays, addMonths, daysBetween, endOfMonth, fmtDate, fmtDateTime, startOfMonth, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { ApprovalTrail, Attachments, MoneyMoveDialog, ProposedNote, Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, digits, Fact, foot, History, human, NoAccess, Tile } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, Meter, TrendChart } from '@/ui/charts'
import { DIST_KIND_LABEL, DIST_STATUS_LABEL, FEE_BASIS_LABEL, fmtQty, FundForm, HoldingForm, NOT_REGULATORY, pctText, STRUCTURE_LABEL, useHoldingColumns, useOwnWork, valuedWhenHeld } from './Investments'

// =====================================================================
// Fund 360: one fund, its investors, the capital it has called, the
// units it has issued, what it holds, its net asset value and its fee.
// A capital call moves no money: it states what investors owe. Money
// received against it PROPOSES an entry, and units are issued when
// that entry is approved. The net asset value is an accounting figure
// from the books as they stand; it is not a regulatory valuation.
// =====================================================================

type TabKey = 'overview' | 'investors' | 'calls' | 'holdings' | 'nav' | 'fees'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'investors', label: 'Investors' }, { key: 'calls', label: 'Capital calls' },
  { key: 'holdings', label: 'Holdings' }, { key: 'nav', label: 'Net asset value' }, { key: 'fees', label: 'Management fee' },
]
const BACK = '/investments?tab=funds'
const CALL_STATUS: Partial<Record<CapitalCall['status'], string>> = { submitted: 'awaiting approval', approved: 'approved — owed by the investors', closed: 'closed — received in full' }
const POSTING_STATUS: Record<UnitAllotment['status'], string> = { proposed: 'awaiting approval', posted: 'posted', rejected: 'rejected', reversed: 'reversed' }
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const whenText = (date: string, asOf: string) => { const n = daysBetween(asOf, date); return n === 0 ? 'today' : n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : `${-n} day${n === -1 ? '' : 's'} ago` }

interface FundData {
  fund: Fund; commitments: FundCommitment[]; calls: CapitalCall[]; allotments: UnitAllotment[]; navRuns: NavRun[]; fees: FundFee[]; holdings: Holding[]; holdingTxns: HoldingTxn[]; distributions: Distribution[]
  /** other funds, not wound up, that share the company of this fund — as far as they are shared with the person */
  siblings: number
}

export default function Fund360() {
  const { id } = useParams<{ id: string }>()
  const { pathname } = useLocation()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('investment.view', cid))
  const byCall = pathname.startsWith('/investments/calls/')
  if (!ids.length || !id) return <NoAccess eyebrow="Investments · Fund" title="Funds" perm="investment.view" back={BACK} />
  return <FundView key={(byCall ? 'call:' : 'fund:') + id} id={id} byCall={byCall} ids={ids} />
}

function FundView({ id, byCall, ids }: { id: ID; byCall: boolean; ids: ID[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const idsKey = ids.join(',')
  const [editing, setEditing] = useState(false)

  const main = useAsync(async (): Promise<FundData | null> => {
    let fundId = id
    if (byCall) {
      const call = (await api.listCapitalCalls({ companyIds: ids })).find((c) => c.id === id)
      if (!call) return null
      fundId = call.fund_id
    }
    const funds = await api.listFunds(ids)
    const fund = funds.find((f) => f.id === fundId)
    if (!fund) return null
    const co = [fund.company_id]
    const [commitments, calls, allotments, navRuns, fees, holdings, holdingTxns, declared] = await Promise.all([
      api.listCommitments({ fundId: fund.id, companyIds: co }), api.listCapitalCalls({ fundId: fund.id, companyIds: co }), api.listUnitAllotments(fund.id), api.listNavRuns(fund.id), api.listFundFees(fund.id),
      api.listHoldings(co), api.listHoldingTxns({ companyIds: co }), api.listDistributions(co),
    ])
    // the lines of each declaration say what was paid to which investor
    const distributions = await Promise.all(declared.filter((x) => x.fund_id === fund.id).map((x) => api.getDistribution(x.id)))
    return {
      fund, commitments, calls, allotments, navRuns, fees, holdings: holdings.filter((h) => h.fund_id === fund.id), holdingTxns, distributions,
      siblings: funds.filter((f) => f.company_id === fund.company_id && f.id !== fund.id && f.status !== 'wound_up').length,
    }
  }, [api, id, byCall, idsKey])

  const d = main.data
  const summary = useMemo(() => (d ? fundSummary(d.fund, d.commitments, d.navRuns) : null), [d])

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? (byCall ? 'calls' : 'overview')
  const openCall = sp.get('call') ?? (byCall && !sp.has('tab') ? id : null)
  const go = (next: Record<string, string>) => setSp(next, { replace: true })

  const back = <button className="btn ghost" onClick={() => nav(BACK)}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Investments · Fund" title="Fund" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (d === undefined) return <div><PageHeader eyebrow="Investments · Fund" title="Fund" actions={back} /><Panel><Loading rows={7} label="Loading the fund" /></Panel></div>
  if (!d || !summary) {
    return (
      <div>
        <PageHeader eyebrow="Investments · Fund" title={byCall ? 'Capital call' : 'Fund'} actions={back} />
        <Panel><Empty icon={<Landmark size={20} />} title={byCall ? 'Capital call not found or not shared with you' : 'Fund not found or not shared with you'} body="It does not exist in the companies you can access, or it is classified above your clearance." action={<button className="btn" onClick={() => nav(BACK)}><ArrowLeft size={14} /> Back to Investments</button>} /></Panel>
      </div>
    )
  }

  const { fund } = d
  const manage = can('investment.manage', fund.company_id)
  const approve = can('investment.approve', fund.company_id)
  const awaiting = d.calls.filter((c) => c.status === 'submitted').length + d.navRuns.filter((n) => n.status === 'draft').length

  return (
    <div>
      <PageHeader
        eyebrow="Investments · Fund"
        title={fund.name}
        subtitle={<>
          {fund.scheme ? `${fund.scheme} · ` : ''}{STRUCTURE_LABEL[fund.structure]} · books kept in {companyName(fund.company_id)}
          {fund.manager_party_id && <> · managed by <button className="link" onClick={() => nav('/parties/' + fund.manager_party_id)}>{partyName(fund.manager_party_id)}</button></>}
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          {back}
          <button className="btn" disabled={!manage} title={manage ? undefined : 'You need the permission investment.manage in this company'} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={fund.status} />
        {fund.confidentiality !== 'internal' && <span className="chip violet">{human(fund.confidentiality)}</span>}
        {fund.commitment_period_end && <span className="chip">commitment period {fund.commitment_period_end < today() ? 'ended' : 'ends'} {fmtDate(fund.commitment_period_end)}</span>}
        {fund.term_end && <span className="chip">term {fund.term_end < today() ? 'ended' : 'ends'} {fmtDate(fund.term_end)}</span>}
        {awaiting > 0 && <span className="chip warn">{awaiting} awaiting a decision</span>}
      </div>

      <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'investors' ? d.commitments.length : t.key === 'calls' ? d.calls.length : t.key === 'holdings' ? d.holdings.length : t.key === 'nav' ? d.navRuns.length : t.key === 'fees' ? d.fees.length : undefined }))} value={tab} onChange={(k) => go({ tab: k })} />

      {tab === 'overview' && <OverviewTab d={d} s={summary} go={go} />}
      {tab === 'investors' && <InvestorsTab d={d} s={summary} manage={manage} />}
      {tab === 'calls' && <CallsTab d={d} manage={manage} approve={approve} openCall={openCall} setOpenCall={(c) => go(c ? { tab: 'calls', call: c } : { tab: 'calls' })} />}
      {tab === 'holdings' && <HoldingsTab d={d} manage={manage} />}
      {tab === 'nav' && <NavTab d={d} manage={manage} approve={approve} />}
      {tab === 'fees' && <FeesTab d={d} s={summary} manage={manage} />}

      <FundForm open={editing} fund={fund} companyIds={[fund.company_id]} onClose={() => setEditing(false)} />
    </div>
  )
}

// =====================================================================
// Overview
// =====================================================================
function OverviewTab({ d, s, go }: { d: FundData; s: FundSummary; go: (next: Record<string, string>) => void }) {
  const nav = useNavigate()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const { fund } = d
  const ccy = fund.currency
  const navNote = s.nav ? `the net asset value approved for ${fmtDate(s.nav.nav_date)}` : 'no approved net asset value'
  const source = `Source: the register of commitments of the fund, whose contributed and distributed amounts come from posted entries, and ${navNote}. These are arithmetic on the books; they are not regulatory figures.`
  const inputs = {
    dpi: [{ label: 'Distributions paid', value: s.distributed }, { label: 'Capital contributed', value: s.contributed }],
    rvpi: [{ label: 'Net assets at the last approved net asset value', value: s.nav?.net_assets ?? 0 }, { label: 'Capital contributed', value: s.contributed }],
    tvpi: [{ label: 'Distributions paid', value: s.distributed }, { label: 'Net assets at the last approved net asset value', value: s.nav?.net_assets ?? 0 }, { label: 'Capital contributed', value: s.contributed }],
  }
  const bars = d.commitments.map((c) => ({
    label: partyName(c.investor_party_id),
    values: [{ key: 'Committed', value: D(c.committed_amount).toNumber() }, { key: 'Called', value: D(c.called_amount).toNumber() }, { key: 'Contributed', value: D(c.contributed_amount).toNumber() }, { key: 'Distributed', value: D(c.distributed_amount).toNumber() }],
  }))

  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Committed" value={s.committed} currency={ccy} tone="gold" onClick={() => go({ tab: 'investors' })} sub={`${d.commitments.filter((c) => c.status === 'active').length} active commitment${d.commitments.filter((c) => c.status === 'active').length === 1 ? '' : 's'}${d.commitments.some((c) => c.status !== 'active') ? `, and what was called of ${d.commitments.filter((c) => c.status !== 'active').length} that ended` : ''}`} />
        <Tile label="Called" onClick={() => go({ tab: 'calls' })} sub={<div><div className="mb-1.5">{s.committed.isZero() ? 'Nothing is committed' : `${pctText(s.called.times(100).div(s.committed), 1)} of what is committed · capital calls that were approved`}</div><Meter value={s.called.toNumber()} max={s.committed.toNumber()} /></div>}>
          <Money value={s.called} currency={ccy} compact />
        </Tile>
        <Stat label="Not yet called" value={s.uncalled} currency={ccy} sub="committed − called" />
        <Tile label="Contributed" onClick={() => go({ tab: 'calls' })} sub={<div><div className="mb-1.5 flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" />{s.called.isZero() ? 'nothing has been called' : `${pctText(s.contributed.times(100).div(s.called), 1)} of what was called`}</div><Meter value={s.contributed.toNumber()} max={s.called.toNumber()} tone="pos" /></div>}>
          <Money value={s.contributed} currency={ccy} compact />
        </Tile>
        <Stat label="Called, not yet received" value={s.outstandingCalls} currency={ccy} tone={s.outstandingCalls.gt(0) ? 'warn' : undefined} onClick={() => go({ tab: 'calls' })} sub="called − contributed · owed by investors" />
        <Stat label="Distributed" value={s.distributed} currency={ccy} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> paid to unit holders, before tax deducted</span>} />
        <Tile label="Units issued" sub={<span>face value <Money value={fund.unit_face_value} currency={ccy} /> · issued when money received is approved</span>}><span className="num">{fmtQty(s.units, ccy)}</span></Tile>
        <Tile label="Net asset value per unit" onClick={() => go({ tab: 'nav' })} sub={s.nav ? <span>as of {fmtDate(s.nav.nav_date)} · last approved · an accounting figure</span> : 'No net asset value has been approved'}>
          {s.nav?.nav_per_unit != null ? <Money value={s.nav.nav_per_unit} currency={ccy} decimals={4} /> : <span className="text-muted">—</span>}
        </Tile>
      </div>

      <Section title="Multiples">
        <div className="grid gap-3 md:grid-cols-3">
          {s.multiples.map((m) => (
            <Panel key={m.key} className="p-4" lit={false}>
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow">{m.key.toUpperCase()} · {m.label}</div>
                <Explain title={`${m.key.toUpperCase()} — ${m.label.toLowerCase()}`} formula={m.value === null ? m.formula : `${m.formula} = ${m.value.toString()}`} inputs={inputs[m.key]} source={source}
                  text={m.key === 'dpi' ? 'How much of the capital paid in has come back to the investors as distributions.' : m.key === 'rvpi' ? 'How much the fund still holds, at the last approved net asset value, for each unit of capital paid in.' : 'What has come back and what is still held, together, for each unit of capital paid in.'} />
              </div>
              <div className="display mt-1.5 text-[24px] font-medium text-ink">{m.value === null ? <span className="text-muted">—</span> : <span className="num">{m.value.toDecimalPlaces(4).toString()}×</span>}</div>
              <div className="num mt-1 text-[11.5px] text-gold">{m.formula}</div>
              {m.value === null && <div className="mt-1 text-[11.5px] text-muted">{m.key === 'dpi' ? 'Not stated: no capital has been contributed.' : 'Not stated: it needs an approved net asset value and capital contributed.'}</div>}
            </Panel>
          ))}
        </div>
        {s.notes.length > 0 && <Note className="mt-3"><ul className="m-0 list-disc space-y-0.5 pl-4">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul></Note>}
      </Section>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Capital by investor">
            <Panel className="p-4" lit={false}>
              {bars.length ? <BarChart data={bars} height={260} onBar={() => go({ tab: 'investors' })} /> : <Empty icon={<Users size={20} />} title="No investor has committed" body="Record the commitments of the investors. Capital is called as a percentage of each commitment." action={<button className="btn sm" onClick={() => go({ tab: 'investors' })}>Open investors</button>} />}
            </Panel>
          </Section>

          <Section title="Dividends and distributions of the fund">
            <Panel className="p-1.5" lit={false}>
              {d.distributions.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">Nothing has been declared by this fund.</div> : d.distributions.map((x) => (
                <button key={x.id} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => nav('/investments/distributions/' + x.id)}>
                  <HandCoins size={15} className="mt-[3px] flex-none text-gold" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] text-ink"><span className="num text-gold">{x.dist_no}</span> · {DIST_KIND_LABEL[x.kind]}</span>
                    <span className="block text-[11.5px] text-muted">Declared {fmtDate(x.declaration_date)} · record date {fmtDate(x.record_date)}{x.notes ? ` · ${x.notes}` : ''}</span>
                  </span>
                  <Money value={x.total_amount} currency={ccy} className="text-[12.5px]" />
                  <StatusChip status={x.status} label={DIST_STATUS_LABEL[x.status]} />
                </button>
              ))}
            </Panel>
          </Section>
          <Note>{NOT_REGULATORY}</Note>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Scheme">{fund.scheme ?? 'Not recorded'}</Fact>
              <Fact label="Structure">{STRUCTURE_LABEL[fund.structure]}</Fact>
              <Fact label="Books kept in">{companyName(fund.company_id)}</Fact>
              <Fact label="Manager">{fund.manager_party_id ? <button className="link text-left" onClick={() => nav('/parties/' + fund.manager_party_id)}>{partyName(fund.manager_party_id)}</button> : 'Not named'}</Fact>
              <Fact label="Face value of a unit"><Money value={fund.unit_face_value} currency={ccy} /></Fact>
              <Fact label="Currency"><span className="num">{ccy}</span></Fact>
              <Fact label="Management fee">{fund.fee_pct === null || D(fund.fee_pct).isZero() ? 'None recorded' : <><span className="num">{pctText(fund.fee_pct)}</span> a year</>}</Fact>
              <Fact label="The fee is charged on">{FEE_BASIS_LABEL[fund.fee_basis]}</Fact>
              <Fact label="Commitment period ends"><span className="num">{fmtDate(fund.commitment_period_end)}</span></Fact>
              <Fact label="Term ends"><span className="num">{fmtDate(fund.term_end)}</span></Fact>
              <Fact label="Equity ledger that carries the capital of the investors" className="sm:col-span-2"><button className="link text-left" onClick={() => nav(ledgerLink({ accounts: [fund.capital_account_id] }))}>{accountName(fund.capital_account_id)}</button></Fact>
              {fund.notes && <Fact label="Notes" className="sm:col-span-2">{fund.notes}</Fact>}
            </Panel>
          </Section>
          <Attachments companyId={fund.company_id} entity="funds" entityId={fund.id} title="Evidence — placement memorandum, agreements, reports" />
          <History entity="funds" entityId={fund.id} />
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Investors: commitments and the statement of each
// =====================================================================
function InvestorsTab({ d, s, manage }: { d: FundData; s: FundSummary; manage: boolean }) {
  const nav = useNavigate()
  const partyName = usePartyName()
  const { fund } = d
  const ccy = fund.currency
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<FundCommitment | null>(null)
  const [shown, setShown] = useState<ID | null>(null)
  const noManage = manage ? undefined : 'You need the permission investment.manage in this company'

  const rows = useMemo(() => d.commitments.map((c) => investorStatement(c, fund, d.calls, d.allotments, d.distributions, d.navRuns)), [d, fund])
  // the share of each commitment in the total, counted the way the total is: an ended commitment for what was called of it
  const ofCommitted = (r: InvestorStatement) => (s.committed.isZero() ? null : (r.commitment.status === 'active' ? r.committed : r.called).times(100).div(s.committed))
  const statement = rows.find((r) => r.commitment.id === shown) ?? null
  const statementLines = useMemo(() => (statement?.lines ?? []).map((l, n) => ({ ...l, n })), [statement])

  const columns: Column<InvestorStatement>[] = [
    { key: 'investor', header: 'Investor', render: (r) => <span className="text-ink">{partyName(r.commitment.investor_party_id)}</span>, sort: (r) => partyName(r.commitment.investor_party_id).toLowerCase(), csv: (r) => partyName(r.commitment.investor_party_id) },
    { key: 'class', header: 'Class', render: (r) => <span className="chip">{r.commitment.unit_class}</span>, sort: (r) => r.commitment.unit_class, csv: (r) => r.commitment.unit_class },
    { key: 'committed', header: 'Committed', align: 'right', render: (r) => <Money value={r.committed} currency={ccy} className="text-ink" />, sort: (r) => r.committed.toNumber(), csv: (r) => r.committed.toFixed(2) },
    { key: 'pct', header: '% of commitments', align: 'right', render: (r) => <span className="num text-ink2">{pctText(ofCommitted(r), 2)}</span>, sort: (r) => ofCommitted(r)?.toNumber() ?? 0, csv: (r) => ofCommitted(r)?.toDecimalPlaces(4).toString() ?? '' },
    { key: 'called', header: 'Called', align: 'right', render: (r) => <Money value={r.called} currency={ccy} dim />, sort: (r) => r.called.toNumber(), csv: (r) => r.called.toFixed(2) },
    { key: 'contributed', header: 'Contributed', align: 'right', render: (r) => <Money value={r.contributed} currency={ccy} dim />, sort: (r) => r.contributed.toNumber(), csv: (r) => r.contributed.toFixed(2) },
    { key: 'owing', header: 'Called, not yet received', align: 'right', render: (r) => (r.owing.gt(0) ? <Money value={r.owing} currency={ccy} className="text-warn" /> : <span className="text-muted">—</span>), sort: (r) => r.owing.toNumber(), csv: (r) => r.owing.toFixed(2) },
    { key: 'units', header: 'Units', align: 'right', render: (r) => <span className="num">{fmtQty(r.units, ccy)}</span>, sort: (r) => r.units.toNumber(), csv: (r) => r.units.toString() },
    { key: 'share', header: '% of the fund, by units', align: 'right', render: (r) => <span className="num text-ink">{pctText(r.sharePct, 2)}</span>, sort: (r) => r.sharePct?.toNumber() ?? 0, csv: (r) => r.sharePct?.toString() ?? '' },
    { key: 'distributed', header: 'Distributed', align: 'right', render: (r) => <Money value={r.commitment.distributed_amount} currency={ccy} dim />, sort: (r) => D(r.commitment.distributed_amount).toNumber(), csv: (r) => D(r.commitment.distributed_amount).toFixed(2) },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.commitment.status} />, sort: (r) => r.commitment.status, csv: (r) => human(r.commitment.status) },
    { key: 'act', header: '', align: 'right', render: (r) => <button className="btn sm ghost" disabled={!manage} title={noManage} onClick={(e) => { e.stopPropagation(); setEditing(r.commitment) }}><Pencil size={13} /> Edit</button> },
  ]
  const lineColumns: Column<InvestorStatement['lines'][number] & { n: number }>[] = [
    { key: 'date', header: 'Date', render: (l) => <span className="num text-[12.5px]">{fmtDate(l.date)}</span>, sort: (l) => l.date, csv: (l) => l.date },
    { key: 'what', header: 'What', render: (l) => <div className="min-w-0"><span className={cx('chip mr-1.5', l.kind === 'call' ? 'warn' : l.kind === 'contribution' ? 'pos' : 'cyan')}>{l.kind === 'call' ? 'called' : l.kind === 'contribution' ? 'received' : 'paid out'}</span><span className="text-[12.5px] text-ink2">{l.what}</span></div>, sort: (l) => l.kind, csv: (l) => l.what },
    { key: 'amount', header: 'Amount', align: 'right', render: (l) => <Money value={l.amount} currency={ccy} />, sort: (l) => l.amount.toNumber(), csv: (l) => l.amount.toFixed(2) },
    { key: 'units', header: 'Units', align: 'right', render: (l) => (l.units === null ? <span className="text-muted">—</span> : <span className="num">{fmtQty(l.units, ccy)}</span>), sort: (l) => l.units?.toNumber() ?? 0, csv: (l) => l.units?.toString() ?? '' },
  ]

  return (
    <div className="space-y-4">
      <Panel lit={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.commitment.id} onRow={(r) => setShown(r.commitment.id)} exportName={`fund-investors-${fund.name}`} initialSort={{ key: 'committed', dir: 'desc' }}
          toolbar={<>
            <button className="btn sm" disabled={!manage} title={noManage} onClick={() => setAdding(true)}><Plus size={13} /> Add a commitment</button>
            <span className="text-[12px] text-muted">Select an investor to open the statement. A commitment is a promise to pay when called; it posts nothing.</span>
          </>}
          footer={<tr>
            <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Total · {rows.length} commitment{rows.length === 1 ? '' : 's'}</td>
            <td className={cx(foot, 'r')}><Money value={s.committed} currency={ccy} className="font-medium text-ink" /></td>
            <td className={foot} />
            <td className={cx(foot, 'r')}><Money value={s.called} currency={ccy} /></td>
            <td className={cx(foot, 'r')}><Money value={s.contributed} currency={ccy} /></td>
            <td className={cx(foot, 'r')}><Money value={s.outstandingCalls} currency={ccy} /></td>
            <td className={cx(foot, 'r num')}>{fmtQty(sum(rows.map((r) => r.units)), ccy)}</td>
            <td className={foot} />
            <td className={cx(foot, 'r')}><Money value={s.distributed} currency={ccy} /></td>
            <td className={foot} colSpan={2} />
          </tr>}
          empty={{ title: 'No investor has committed', body: 'Record each investor with the amount committed. Capital is called as a percentage of each commitment, and units are issued as the money is received.', icon: <Users size={20} />, action: <button className="btn sm" disabled={!manage} title={noManage} onClick={() => setAdding(true)}><Plus size={13} /> Add a commitment</button> }} />
      </Panel>
      <div className="text-[11.5px] text-muted">% of commitments = committed ÷ the total committed. % of the fund, by units = units held ÷ units issued ({fmtQty(fund.units_outstanding, ccy)}). Both are worked out from the registers. The total committed holds active commitments in full and, of a commitment that has ended, what was called of it.</div>

      <Drawer open={!!statement} onClose={() => setShown(null)} width={720} title={statement ? `Statement · ${partyName(statement.commitment.investor_party_id)}` : 'Statement'} subtitle={statement ? `${fund.name} · class ${statement.commitment.unit_class} · committed on ${fmtDate(statement.commitment.commitment_date)}` : undefined}
        footer={statement ? <button className="btn" onClick={() => nav('/parties/' + statement.commitment.investor_party_id)}>Open the investor <ExternalLink size={13} /></button> : undefined}>
        {statement && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={statement.commitment.status} />
              <span className="chip">as at {fmtDate(today())}</span>
              <DemoTag />
            </div>
            <Panel className="grid gap-4 p-4 sm:grid-cols-3" lit={false}>
              <Fact label="Committed"><Money value={statement.committed} currency={ccy} /></Fact>
              <Fact label="Called"><Money value={statement.called} currency={ccy} /></Fact>
              <Fact label="Not yet called"><Money value={statement.uncalled} currency={ccy} /></Fact>
              <Fact label="Contributed"><Money value={statement.contributed} currency={ccy} /></Fact>
              <Fact label="Called, not yet received"><Money value={statement.owing} currency={ccy} className={statement.owing.gt(0) ? 'text-warn' : undefined} /></Fact>
              <Fact label="Units held"><span className="num">{fmtQty(statement.units, ccy)}</span>{statement.sharePct !== null && <span className="text-[11.5px] text-muted"> · {pctText(statement.sharePct, 2)} of the fund</span>}</Fact>
              <Fact label="Distributions paid, before tax"><Money value={statement.distributedGross} currency={ccy} /></Fact>
              <Fact label="Tax deducted"><Money value={statement.taxDeducted} currency={ccy} /></Fact>
              <Fact label="Distributions paid, net"><Money value={statement.distributedNet} currency={ccy} /></Fact>
            </Panel>
            <Panel className="p-4" lit={false}>
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow">Value of the units held</div>
                {statement.value !== null && <Explain title="Value of the units held" text="The units the investor holds, at the net asset value per unit that was last approved. It is an accounting figure from the books of the fund; it is not a regulatory valuation and not a price at which units can be redeemed." formula="units held × net asset value per unit, last approved" source={`Source: units issued on posted contributions, and the net asset value approved for ${fmtDate(statement.navDate)}.`} />}
              </div>
              <div className="display mt-1.5 text-[22px] font-medium text-ink">{statement.value === null ? <span className="text-muted">—</span> : <Money value={statement.value} currency={ccy} />}</div>
              <div className="mt-1 text-[11.5px] text-muted">{statement.value === null ? 'No net asset value per unit has been approved, so the units cannot be valued.' : `${fmtQty(statement.units, ccy)} units × the net asset value per unit approved for ${fmtDate(statement.navDate)}. An accounting figure, not a regulatory valuation.`}</div>
            </Panel>
            <Section title="What happened, in order">
              <Panel lit={false}>
                <DataTable columns={lineColumns} rows={statementLines} rowKey={(l) => String(l.n)} exportName={`investor-statement-${partyName(statement.commitment.investor_party_id)}`} pageSize={100}
                  empty={{ title: 'Nothing yet', body: 'No capital call has been approved, no contribution has been posted and no distribution has been paid for this investor.' }} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">The statement lists capital calls that were approved, contributions whose entry was posted, and distributions that were paid. What awaits approval is not in it.</div>
            </Section>
            {statement.commitment.note && <Note>{statement.commitment.note}</Note>}
          </div>
        )}
      </Drawer>

      <CommitmentModal open={adding || !!editing} commitment={editing} d={d} onClose={() => { setAdding(false); setEditing(null) }} />
    </div>
  )
}

function CommitmentModal({ open, onClose, commitment, d }: { open: boolean; onClose: () => void; commitment: FundCommitment | null; d: FundData }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const { act, busy } = useAction()
  const { fund } = d
  const [asking, setAsking] = useState(false)
  const [investor, setInvestor] = useState('')
  const [cls, setCls] = useState('A')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [status, setStatus] = useState<FundCommitment['status']>('active')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!open) return
    setAsking(false)
    setInvestor(commitment?.investor_party_id ?? ''); setCls(commitment?.unit_class ?? 'A'); setAmount(commitment ? D(commitment.committed_amount).toString() : '')
    setDate(commitment?.commitment_date ?? today()); setStatus(commitment?.status ?? 'active'); setNote(commitment?.note ?? '')
  }, [open, commitment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties])
  const klass = cls.trim() || 'A'
  const problems: string[] = []
  if (!investor) problems.push('Name the investor.')
  if (round2(amount || 0).lte(0)) problems.push('Enter the amount committed.')
  if (commitment && round2(amount || 0).lt(D(commitment.called_amount))) problems.push(`${fmtMoney(commitment.called_amount, { currency: fund.currency })} has already been called on this commitment. It cannot be lowered below that.`)
  if (!commitment && investor && d.commitments.some((c) => c.investor_party_id === investor && c.unit_class === klass)) problems.push('This investor already has a commitment in this class. Change that commitment instead.')

  const save = async (reason?: string) => {
    const id = await act(() => api.saveCommitment({ id: commitment?.id, fund_id: fund.id, investor_party_id: investor, unit_class: klass, committed_amount: amount, commitment_date: date || undefined, status: commitment ? status : undefined, note: note.trim() || undefined, reason }), commitment ? 'Commitment changed' : 'Commitment recorded')
    if (id) { setAsking(false); onClose() }
  }

  return (
    <>
      <Modal open={open && !asking} onClose={onClose} title={commitment ? 'Change a commitment' : 'Add a commitment'} subtitle={`${fund.name} · a commitment is a promise to pay when called; it posts nothing`} width={580}
        footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => (commitment ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Investor" className="sm:col-span-2">
            <select className="field" value={investor} disabled={!!commitment} onChange={(e) => setInvestor(e.target.value)}><option value="">Choose…</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
          </Field>
          <Field label="Class of unit"><input className="field" value={cls} disabled={!!commitment} onChange={(e) => setCls(e.target.value)} /></Field>
          <Field label="Date of the commitment"><input type="date" className="field" value={date} disabled={!!commitment} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Amount committed" hint={commitment ? `Called so far: ${fmtMoney(commitment.called_amount, { currency: fund.currency })}` : undefined}><input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(digits(e.target.value))} /></Field>
          {commitment && <Field label="Status" hint="Only active commitments are called and counted as committed."><select className="field" value={status} onChange={(e) => setStatus(e.target.value as FundCommitment['status'])}>{(['active', 'transferred', 'withdrawn'] as const).map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></Field>}
          <Field label="Note" className="sm:col-span-2"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {problems.length > 0 && (investor || amount) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </Modal>
      <ReasonDialog open={open && asking} title="Change this commitment" body="The commitment of an investor is being changed. The earlier figures are kept in the history with your reason." confirm="Save the change" onCancel={() => setAsking(false)} onConfirm={(r) => void save(r)} />
    </>
  )
}

// =====================================================================
// Capital calls, money received against them, and the units issued
// =====================================================================
function CallsTab({ d, manage, approve, openCall, setOpenCall }: { d: FundData; manage: boolean; approve: boolean; openCall: ID | null; setOpenCall: (id: ID | null) => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const ownWork = useOwnWork()
  const { act, busy } = useAction()
  const { fund } = d
  const ccy = fund.currency
  const asOf = today()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<CapitalCall | null>(null)
  const [deciding, setDeciding] = useState<{ call: CapitalCall; decision: 'approved' | 'rejected' } | null>(null)
  const [receiving, setReceiving] = useState<{ call: CapitalCall; line: CapitalCallLine } | null>(null)

  const noManage = manage ? undefined : 'You need the permission investment.manage in this company'
  const canCall = ['forming', 'open'].includes(fund.status)
  const whyNotCall = noManage ?? (canCall ? undefined : `This fund is ${human(fund.status)}. Capital can no longer be called.`)
  const investorOf = useMemo(() => new Map(d.commitments.map((c) => [c.id, c.investor_party_id])), [d.commitments])
  const pendingOf = (lineId: ID) => sum(d.allotments.filter((a) => a.call_line_id === lineId && a.status === 'proposed').map((a) => a.amount))
  const roomOf = (l: CapitalCallLine) => D(l.amount).minus(l.received_amount).minus(pendingOf(l.id))
  const receivedOf = (c: CapitalCall) => sum((c.lines ?? []).map((l) => l.received_amount))
  const whyNotDecide = (c: CapitalCall) => (!approve ? 'You need the permission investment.approve in this company' : ownWork(c.created_by) ? 'You prepared this capital call. A second person decides on it.' : undefined)

  const decide = async (comment: string) => {
    if (!deciding) return
    const { call, decision } = deciding
    const r = await act(() => api.decideCapitalCall(call.id, decision, comment || undefined), (v) => (v === 'approved' ? 'Capital call approved — it is now owed by the investors' : v === 'pending' ? 'Approved at this step — a further approval is needed' : 'Capital call rejected'))
    if (r) setDeciding(null)
  }

  const lineColumns = (c: CapitalCall): Column<CapitalCallLine>[] => [
    { key: 'investor', header: 'Investor', render: (l) => <span className="text-ink">{partyName(l.investor_party_id)}</span>, sort: (l) => partyName(l.investor_party_id).toLowerCase(), csv: (l) => partyName(l.investor_party_id) },
    { key: 'amount', header: 'Called', align: 'right', render: (l) => <Money value={l.amount} currency={ccy} className="text-ink" />, sort: (l) => D(l.amount).toNumber(), csv: (l) => D(l.amount).toFixed(2) },
    { key: 'received', header: 'Received', align: 'right', render: (l) => <Money value={l.received_amount} currency={ccy} dim />, sort: (l) => D(l.received_amount).toNumber(), csv: (l) => D(l.received_amount).toFixed(2) },
    { key: 'pending', header: 'Receipt awaiting approval', align: 'right', render: (l) => (pendingOf(l.id).gt(0) ? <Money value={pendingOf(l.id)} currency={ccy} className="text-warn" /> : <span className="text-muted">—</span>), sort: (l) => pendingOf(l.id).toNumber(), csv: (l) => pendingOf(l.id).toFixed(2) },
    { key: 'out', header: 'Still to be received', align: 'right', render: (l) => { const v = D(l.amount).minus(l.received_amount); return v.gt(0) ? <Money value={v} currency={ccy} className={c.status === 'approved' && c.due_date < asOf ? 'text-neg' : 'text-ink2'} /> : <span className="text-muted">—</span> }, sort: (l) => D(l.amount).minus(l.received_amount).toNumber(), csv: (l) => D(l.amount).minus(l.received_amount).toFixed(2) },
    { key: 'units', header: 'Units issued', align: 'right', render: (l) => <span className="num">{fmtQty(l.units_allotted, ccy)}</span>, sort: (l) => D(l.units_allotted).toNumber(), csv: (l) => D(l.units_allotted).toString() },
    { key: 'status', header: 'Status', render: (l) => (['approved', 'closed'].includes(c.status) ? <StatusChip status={l.status} label={l.status === 'due' ? 'not received' : l.status === 'part_received' ? 'received in part' : 'received'} /> : <span className="text-[12px] text-muted">not yet owed</span>), sort: (l) => l.status, csv: (l) => (['approved', 'closed'].includes(c.status) ? human(l.status) : 'not yet owed') },
    {
      key: 'act', header: '', align: 'right',
      render: (l) => (c.status === 'approved' && D(l.amount).gt(l.received_amount) ? (
        <button className="btn sm primary" disabled={!manage || roomOf(l).lte(0) || busy} title={noManage ?? (roomOf(l).lte(0) ? 'A receipt for the rest of this line is already awaiting approval' : 'Proposes the entry of the money received')} onClick={() => setReceiving({ call: c, line: l })}><Banknote size={13} /> Record money received</button>
      ) : null),
    },
  ]
  const allotColumns: Column<UnitAllotment>[] = [
    { key: 'date', header: 'Date', render: (a) => <span className="num text-[12.5px]">{fmtDate(a.allot_date)}</span>, sort: (a) => a.allot_date, csv: (a) => a.allot_date },
    { key: 'investor', header: 'Investor', render: (a) => <span className="text-ink2">{partyName(investorOf.get(a.commitment_id))}</span>, sort: (a) => partyName(investorOf.get(a.commitment_id)).toLowerCase(), csv: (a) => partyName(investorOf.get(a.commitment_id)) },
    { key: 'amount', header: 'Money received', align: 'right', render: (a) => <Money value={a.amount} currency={ccy} />, sort: (a) => D(a.amount).toNumber(), csv: (a) => D(a.amount).toFixed(2) },
    { key: 'price', header: 'Price of a unit', align: 'right', render: (a) => <Money value={a.unit_price} currency={ccy} decimals={4} />, sort: (a) => D(a.unit_price).toNumber(), csv: (a) => D(a.unit_price).toString() },
    { key: 'units', header: 'Units', align: 'right', render: (a) => <span className="num text-ink">{fmtQty(a.units, ccy)}</span>, sort: (a) => D(a.units).toNumber(), csv: (a) => D(a.units).toString() },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} label={a.status === 'posted' ? 'posted — units issued' : a.status === 'proposed' ? 'awaiting approval — no units yet' : POSTING_STATUS[a.status]} />, sort: (a) => a.status, csv: (a) => POSTING_STATUS[a.status] },
    { key: 'entry', header: 'Entry', render: (a) => (a.journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + a.journal_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
  ]

  const live = d.calls.filter((c) => ['approved', 'closed'].includes(c.status))
  const called = sum(live.map((c) => c.total_amount)), received = sum(live.map(receivedOf))
  const late = d.calls.filter((c) => c.status === 'approved' && c.due_date < asOf)

  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Called" value={called} currency={ccy} tone="gold" sub={`${live.length} capital call${live.length === 1 ? '' : 's'} that were approved`} />
        <Stat label="Received" value={received} currency={ccy} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> from posted entries</span>} />
        <Stat label="Still to be received" value={called.minus(received)} currency={ccy} tone={late.length ? 'neg' : called.minus(received).gt(0) ? 'warn' : undefined} sub={late.length ? `${late.length} call${late.length === 1 ? ' is' : 's are'} past the due date` : 'called − received'} />
        <Stat label="Awaiting approval" value={d.calls.filter((c) => c.status === 'submitted').length} count sub="capital calls submitted and not yet decided" />
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <button className="btn primary" disabled={!!whyNotCall} title={whyNotCall} onClick={() => setAdding(true)}><Megaphone size={15} /> New capital call</button>
        <span className="text-[12px] text-muted">A capital call moves no money. Once approved it is owed by the investors. Money received against it proposes an entry, and units are issued when that entry is approved.</span>
      </div>

      {d.calls.length === 0 && <Panel><Empty icon={<Megaphone size={20} />} title="No capital has been called" body="A capital call asks each investor for a percentage of the commitment, by a due date, for a stated purpose. It is prepared as a draft, submitted, and approved by a second person." /></Panel>}

      {d.calls.map((c) => {
        const open = openCall === c.id
        const lines = c.lines ?? []
        const got = receivedOf(c)
        const mine = d.allotments.filter((a) => lines.some((l) => l.id === a.call_line_id))
        const overdue = c.status === 'approved' && c.due_date < asOf
        return (
          <Panel key={c.id} lit={false} className="overflow-hidden">
            <button className="flex w-full flex-wrap items-start gap-3 px-4 py-3 text-left hover:bg-surface2" aria-expanded={open} onClick={() => setOpenCall(open ? null : c.id)}>
              <span className="mt-[3px] flex-none text-muted">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink"><span className="num text-gold">{c.call_no}</span> · {c.purpose}</span>
                <span className="block text-[11.5px] text-muted">Called on {fmtDate(c.call_date)} · due {fmtDate(c.due_date)}{c.status === 'approved' ? ` (${whenText(c.due_date, asOf)})` : ''} · {pctText(c.pct)} of each commitment · units at <Money value={c.unit_price} currency={ccy} decimals={4} /></span>
              </span>
              <span className="flex-none text-right">
                <Money value={c.total_amount} currency={ccy} className="text-[13px] text-ink" />
                {['approved', 'closed'].includes(c.status) && <span className="block text-[11.5px] text-muted">received <Money value={got} currency={ccy} compact /></span>}
              </span>
              <span className="flex flex-none flex-wrap items-center gap-1.5">
                <StatusChip status={c.status} label={CALL_STATUS[c.status]} />
                {overdue && <span className="chip neg">past the due date</span>}
              </span>
            </button>

            {open && (
              <div className="border-t border-line">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <ApprovalTrail companyId={c.company_id} entity="capital_call" entityId={c.id} />
                    {c.status === 'draft' && <div className="text-[12px] text-muted">A draft. Nothing is owed by anyone. Submit it for the approval of a second person.</div>}
                    {c.status === 'submitted' && <div className="text-[12px] text-muted">Awaiting approval. Nothing is owed until it is approved.</div>}
                    {c.status === 'rejected' && <div className="text-[12px] text-neg">Rejected{c.decision_note ? `: ${c.decision_note}` : '.'} <span className="text-muted">Editing it makes it a draft again.</span></div>}
                    {c.status === 'approved' && <div className="text-[12px] text-muted">Approved{c.approved_at ? ` on ${fmtDateTime(c.approved_at)}` : ''}{c.decision_note ? ` — ${c.decision_note}` : ''}. Approval posted nothing: it made the amounts below owed by the investors.</div>}
                    {c.status === 'closed' && <div className="text-[12px] text-muted">Every investor has paid in full.</div>}
                  </div>
                  <div className="no-print flex flex-wrap items-center gap-2">
                    {(c.status === 'draft' || c.status === 'rejected') && <button className="btn sm" disabled={!!whyNotCall} title={whyNotCall} onClick={() => setEditing(c)}><Pencil size={13} /> Edit</button>}
                    {c.status === 'draft' && <button className="btn sm primary" disabled={!manage || busy} title={noManage} onClick={() => void act(async () => { await api.submitCapitalCall(c.id); return true }, 'Capital call submitted — awaiting approval')}><Send size={13} /> Submit for approval</button>}
                    {c.status === 'submitted' && <>
                      <button className="btn sm good" disabled={!!whyNotDecide(c) || busy} title={whyNotDecide(c)} onClick={() => setDeciding({ call: c, decision: 'approved' })}><Check size={13} /> Approve</button>
                      <button className="btn sm danger" disabled={!!whyNotDecide(c) || busy} title={whyNotDecide(c)} onClick={() => setDeciding({ call: c, decision: 'rejected' })}><X size={13} /> Reject</button>
                    </>}
                  </div>
                </div>
                <div className="border-t border-line">
                  <DataTable columns={lineColumns(c)} rows={lines} rowKey={(l) => l.id} exportName={`capital-call-${c.call_no}`} pageSize={100}
                    footer={<tr>
                      <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total · {lines.length} investor{lines.length === 1 ? '' : 's'}</td>
                      <td className={cx(foot, 'r')}><Money value={c.total_amount} currency={ccy} className="font-medium text-ink" /></td>
                      <td className={cx(foot, 'r')}><Money value={got} currency={ccy} /></td>
                      <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => pendingOf(l.id)))} currency={ccy} /></td>
                      <td className={cx(foot, 'r')}><Money value={D(c.total_amount).minus(got)} currency={ccy} /></td>
                      <td className={cx(foot, 'r num')}>{fmtQty(sum(lines.map((l) => l.units_allotted)), ccy)}</td>
                      <td className={foot} colSpan={2} />
                    </tr>}
                    empty={{ title: 'This call has no lines', body: 'No active commitment had anything left to call.' }} />
                </div>
                <div className="border-t border-line px-4 py-3">
                  <div className="eyebrow mb-2">Money received and units allotted</div>
                  {mine.length === 0
                    ? <div className="text-[12.5px] text-muted">{c.status === 'approved' ? 'No money has been recorded against this call.' : ['draft', 'submitted', 'rejected'].includes(c.status) ? 'Money is recorded against a call once it has been approved.' : 'Nothing is recorded.'}</div>
                    : <Panel lit={false}><DataTable columns={allotColumns} rows={mine} rowKey={(a) => a.id} exportName={`units-allotted-${c.call_no}`} pageSize={100} initialSort={{ key: 'date', dir: 'asc' }} /></Panel>}
                  <div className="mt-2 text-[11.5px] text-muted">Units = money received ÷ price of a unit, to four decimals. Units are issued, and the investor's contribution rises, only when the entry of the receipt is approved and posted.</div>
                </div>
              </div>
            )}
          </Panel>
        )
      })}

      <CallModal open={adding || !!editing} call={editing} d={d} onClose={() => { setAdding(false); setEditing(null) }} onSaved={(id) => setOpenCall(id)} />

      <ReasonDialog open={!!deciding} required={deciding?.decision === 'rejected'} danger={deciding?.decision === 'rejected'}
        title={deciding?.decision === 'approved' ? `Approve ${deciding.call.call_no}` : `Reject ${deciding?.call.call_no ?? 'the call'}`} confirm={deciding?.decision === 'approved' ? 'Approve' : 'Reject'}
        body={deciding && (deciding.decision === 'approved'
          ? <>Approving makes <Money value={deciding.call.total_amount} currency={ccy} /> owed by {(deciding.call.lines ?? []).length} investor{(deciding.call.lines ?? []).length === 1 ? '' : 's'}, due on {fmtDate(deciding.call.due_date)}. No money moves and nothing is posted: what has been called on each commitment rises.</>
          : <>The capital call goes back to the person who prepared it, with your reason. Nothing becomes owed.</>)}
        onCancel={() => setDeciding(null)} onConfirm={(r) => void decide(r)} />

      <MoneyMoveDialog open={!!receiving} companyId={fund.company_id} bankOnly title="Record money received" confirm="Propose the entry" busy={busy}
        subtitle={receiving ? `${receiving.call.call_no} · from ${partyName(receiving.line.investor_party_id)}` : undefined}
        amount={receiving ? roomOf(receiving.line).toString() : undefined} max={receiving ? roomOf(receiving.line).toString() : undefined}
        note="This proposes an accounting entry for money that has already arrived in the bank account. It reaches the ledger, and units are issued, only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money."
        extra={receiving && (
          <Panel className="space-y-1.5 p-3.5 text-[12.5px] text-ink2" lit={false}>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Called</span><Money value={receiving.line.amount} currency={ccy} /><span>− received</span><Money value={receiving.line.received_amount} currency={ccy} /><span>− awaiting approval</span><Money value={pendingOf(receiving.line.id)} currency={ccy} /><span>= can still be recorded</span><Money value={roomOf(receiving.line)} currency={ccy} className="font-medium text-ink" /></div>
            <div>Units on approval = amount ÷ <Money value={receiving.call.unit_price} currency={ccy} decimals={4} />, to four decimals. For the whole amount: <span className="num text-ink">{fmtQty(D(receiving.call.unit_price).isZero() ? 0 : roomOf(receiving.line).div(receiving.call.unit_price), ccy)}</span> units.</div>
            <div className="text-[11.5px] text-muted">On approval the bank ledger is debited and the capital of the investors is credited. The method chosen above is written into the reference of the entry.</div>
          </Panel>
        )}
        onCancel={() => setReceiving(null)}
        onConfirm={(v) => { if (!receiving) return; void act(() => api.proposeCapitalReceipt({ line_id: receiving.line.id, amount: v.amount, bank_ledger_id: v.bank_ledger_id, date: v.date, reference: [v.reference.trim(), v.method].filter(Boolean).join(' · ') || undefined }), 'Receipt proposed — awaiting approval').then((j) => { if (j) setReceiving(null) }) }} />
    </div>
  )
}

function CallModal({ open, onClose, call, d, onSaved }: { open: boolean; onClose: () => void; call: CapitalCall | null; d: FundData; onSaved: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const { fund } = d
  const ccy = fund.currency
  const [callDate, setCallDate] = useState(today())
  const [dueDate, setDueDate] = useState(addDays(today(), 15))
  const [pct, setPct] = useState('')
  const [price, setPrice] = useState('')
  const [purpose, setPurpose] = useState('')
  useEffect(() => {
    if (!open) return
    setCallDate(call?.call_date ?? today()); setDueDate(call?.due_date ?? addDays(today(), 15)); setPct(call?.pct != null ? D(call.pct).toString() : '')
    setPrice(D(call?.unit_price ?? fund.unit_face_value).toString()); setPurpose(call?.purpose ?? '')
  }, [open, call?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // what each investor will be asked for: the percentage of the commitment, capped at what is left to call
  const lines = useMemo(() => {
    const share = D(pct)
    const elsewhere = d.calls.filter((c) => c.id !== call?.id && ['draft', 'submitted'].includes(c.status)).flatMap((c) => c.lines ?? [])
    return d.commitments.filter((c) => c.status === 'active').map((c) => {
      const inDraft = sum(elsewhere.filter((l) => l.commitment_id === c.id).map((l) => l.amount))
      const wanted = round2(D(c.committed_amount).times(share).div(100))
      const left = D(c.committed_amount).minus(c.called_amount).minus(inDraft)
      return { c, inDraft, wanted, left, amount: Decimal.max(Decimal.min(wanted, left), 0) }
    })
  }, [d, call?.id, pct])
  const asked = lines.filter((l) => l.amount.gt(0))
  const total = sum(asked.map((l) => l.amount))
  const capped = asked.filter((l) => l.amount.lt(l.wanted))
  const previewColumns: Column<(typeof lines)[number]>[] = [
    { key: 'investor', header: 'Investor', render: (l) => <span><span className="text-ink">{partyName(l.c.investor_party_id)}</span> <span className="text-[11px] text-muted">class {l.c.unit_class}</span></span>, csv: (l) => partyName(l.c.investor_party_id) },
    { key: 'committed', header: 'Committed', align: 'right', render: (l) => <Money value={l.c.committed_amount} currency={ccy} dim />, csv: (l) => D(l.c.committed_amount).toFixed(2) },
    { key: 'called', header: 'Already called', align: 'right', render: (l) => <Money value={l.c.called_amount} currency={ccy} dim />, csv: (l) => D(l.c.called_amount).toFixed(2) },
    { key: 'elsewhere', header: 'In calls awaiting approval', align: 'right', render: (l) => <Money value={l.inDraft} currency={ccy} dim />, csv: (l) => l.inDraft.toFixed(2) },
    { key: 'amount', header: 'This call', align: 'right', render: (l) => (l.amount.gt(0) ? <Money value={l.amount} currency={ccy} className={l.amount.lt(l.wanted) ? 'text-warn' : 'text-ink'} /> : <span className="text-muted">nothing left</span>), csv: (l) => l.amount.toFixed(2) },
  ]

  const problems: string[] = []
  if (!callDate || !dueDate) problems.push('The date of the call and the date by which it is due are required.')
  if (callDate && dueDate && dueDate < callDate) problems.push('The due date is before the date of the call.')
  if (D(pct).lte(0) || D(pct).gt(100)) problems.push('State the share of the commitment that is called, as a percentage up to 100.')
  if (D(price).lte(0)) problems.push('Enter the price at which units are issued.')
  if (!purpose.trim()) problems.push('A capital call states its purpose.')
  if (D(pct).gt(0) && !asked.length) problems.push('Nothing is left to call: every active commitment has been called in full, or is covered by a call that awaits approval.')

  const save = async () => {
    const id = await act(() => api.saveCapitalCall({ id: call?.id, fund_id: fund.id, call_date: callDate, due_date: dueDate, pct, unit_price: price, purpose: purpose.trim() }), call ? 'Capital call changed — it is a draft' : 'Capital call saved as a draft')
    if (id) { onClose(); onSaved(id) }
  }

  return (
    <Modal open={open} onClose={onClose} title={call ? `Change ${call.call_no}` : 'New capital call'} subtitle={`${fund.name} · saved as a draft; nothing is owed until a second person approves it`} width={700}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save the draft</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of the call"><input type="date" className="field" value={callDate} onChange={(e) => setCallDate(e.target.value)} /></Field>
        <Field label="Due by"><input type="date" className="field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="% of each commitment" hint="Each investor is asked for this share of the amount committed."><input className="field num" inputMode="decimal" value={pct} onChange={(e) => setPct(digits(e.target.value))} autoFocus /></Field>
        <Field label="Price of a unit" hint="Units issued = money received ÷ this price."><input className="field num" inputMode="decimal" value={price} onChange={(e) => setPrice(digits(e.target.value))} /></Field>
        <Field label="Purpose" className="sm:col-span-2" hint="What the money is called for. It is shown to the approver and on the statement of each investor."><textarea className="field" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      </div>

      <div className="mt-4">
        <div className="eyebrow mb-2">What each investor will be asked for — calculated</div>
        <Panel lit={false}>
          <DataTable columns={previewColumns} rows={lines} rowKey={(l) => l.c.id} pageSize={100} exportName={`capital-call-preview-${fund.name}`}
            footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={4}>Total of this call · {asked.length} investor{asked.length === 1 ? '' : 's'}</td><td className={cx(foot, 'r')}><Money value={total} currency={ccy} className="font-medium text-ink" /></td></tr>}
            empty={{ title: 'No active commitment', body: 'This fund has no active commitment to call on. Record the commitments of the investors first.' }} />
        </Panel>
        <div className="mt-2 text-[11.5px] text-muted">This call = committed × {pctText(D(pct))}, rounded to two decimals, and never more than committed − already called − in calls awaiting approval.{capped.length > 0 ? ` ${capped.length} investor${capped.length === 1 ? ' is' : 's are'} asked for less than the percentage because less than that is left to call.` : ''} The lines are worked out again when the draft is saved.</div>
      </div>
      {problems.length > 0 && (pct || purpose) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Modal>
  )
}

// =====================================================================
// What the fund holds
// =====================================================================
function HoldingsTab({ d, manage }: { d: FundData; manage: boolean }) {
  const nav = useNavigate()
  const asOf = today()
  const { fund, holdings } = d
  const outdated = useMemo(() => valuedWhenHeld(holdings, d.holdingTxns), [holdings, d.holdingTxns])
  const columns = useHoldingColumns(asOf, outdated).filter((c) => c.key !== 'company')
  const [adding, setAdding] = useState(false)
  const ccy = fund.currency
  const active = holdings.filter((h) => h.status === 'active')
  // a valuation made when a different quantity was held is shown on its line and left out of the total
  const valued = active.filter((h) => h.fair_value !== null && !outdated.has(h.id))
  const atCost = active.filter((h) => h.measurement === 'cost')
  const noManage = manage ? undefined : 'You need the permission investment.manage in this company'

  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cost" value={sum(holdings.map((h) => h.cost))} currency={ccy} sub={`${active.length} active holding${active.length === 1 ? '' : 's'}`} />
        <Stat label="Carrying amount in the books" value={sum(holdings.map(carryingAmount))} currency={ccy} tone="gold" sub="what the net asset value counts" />
        <Tile label="Fair value, where one is approved" sub={valued.length ? `${valued.length} of ${active.length} active holdings, each as of its own date` : 'No approved valuation is on record'}>
          {valued.length ? <Money value={sum(valued.map((h) => D(h.fair_value)))} currency={ccy} compact /> : <span className="text-muted">—</span>}
        </Tile>
        <Stat label="Carried at cost" value={sum(atCost.map((h) => h.cost))} currency={ccy} sub={`${atCost.length} holding${atCost.length === 1 ? '' : 's'} · in the net asset value at cost, whatever they are worth`} />
      </div>
      <Panel lit={false}>
        <DataTable columns={columns} rows={holdings} rowKey={(h) => h.id} onRow={(h) => nav('/investments/holdings/' + h.id)} exportName={`fund-holdings-${fund.name}`} initialSort={{ key: 'no', dir: 'asc' }}
          toolbar={<>
            <button className="btn sm" disabled={!manage} title={noManage} onClick={() => setAdding(true)}><Plus size={13} /> New investment of the fund</button>
            <span className="text-[12px] text-muted">Investments of {fund.name} that are shared with you. Select one to buy, sell, record income or a valuation.</span>
          </>}
          empty={{ title: 'No investment of this fund is shared with you', body: 'Record an investment and name this fund on it. Its purchase proposes the accounting entry.', icon: <Briefcase size={20} /> }} />
      </Panel>
      <HoldingForm open={adding} companyIds={[fund.company_id]} funds={[fund]} preset={{ company_id: fund.company_id, fund_id: fund.id }} onClose={() => setAdding(false)} onSaved={(id) => nav('/investments/holdings/' + id)} />
    </div>
  )
}

// =====================================================================
// Net asset value: prepared from the books, decided by a second person
// =====================================================================
const NAV_STATUS: Record<NavRun['status'], string> = { draft: 'prepared — awaiting a decision', approved: 'approved', superseded: 'superseded', rejected: 'rejected' }
const BASIS_LABEL: Record<string, string> = {
  holdings_not_at_recent_fair_value: 'Holdings carried at cost, or valued more than three months before the date',
  holdings_carried_at_cost: 'Holdings carried at cost, at their cost',
  entries_awaiting_approval: 'Entries awaiting approval up to the date — not in the figures',
}

function NavTab({ d, manage, approve }: { d: FundData; manage: boolean; approve: boolean }) {
  const api = useApp((s) => s.api)!
  const ownWork = useOwnWork()
  const { act, busy } = useAction()
  const { fund, navRuns } = d
  const ccy = fund.currency
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<ID | null>(null)
  const [deciding, setDeciding] = useState<{ run: NavRun; decision: 'approved' | 'rejected' } | null>(null)

  const run = navRuns.find((n) => n.id === picked) ?? navRuns.find((n) => n.status === 'draft') ?? navRuns.find((n) => n.status === 'approved') ?? navRuns[0] ?? null
  const approved = useMemo(() => navRuns.filter((n) => n.status === 'approved').sort((a, b) => a.nav_date.localeCompare(b.nav_date)), [navRuns])
  const whyNotPrepare = !manage ? 'You need the permission investment.manage in this company'
    : d.siblings > 0 ? 'Several funds share this company, so their net assets cannot be told apart. Give each fund a company of its own.'
    : !date ? 'Choose the date.' : undefined
  const whyNotDecide = (n: NavRun) => (!approve ? 'You need the permission investment.approve in this company' : ownWork(n.prepared_by) ? 'You prepared this net asset value. A second person decides on it.' : undefined)

  const prepare = async () => {
    const id = await act(() => api.prepareNav(fund.id, date, note.trim() || undefined), 'Net asset value prepared — it awaits the decision of a second person')
    if (id) { setPicked(id); setNote('') }
  }
  const decide = async (reason: string) => {
    if (!deciding) return
    const ok = await act(async () => { await api.decideNav(deciding.run.id, deciding.decision, reason || undefined); return true }, deciding.decision === 'approved' ? 'Net asset value approved' : 'Net asset value rejected')
    if (ok) setDeciding(null)
  }

  const columns: Column<NavRun>[] = [
    { key: 'date', header: 'As of', render: (n) => <span className="num text-[12.5px] text-ink">{fmtDate(n.nav_date)}</span>, sort: (n) => n.nav_date, csv: (n) => n.nav_date },
    { key: 'assets', header: 'Assets', align: 'right', render: (n) => <Money value={n.total_assets} currency={ccy} dim />, sort: (n) => D(n.total_assets).toNumber(), csv: (n) => D(n.total_assets).toFixed(2) },
    { key: 'liab', header: 'Liabilities', align: 'right', render: (n) => <Money value={n.total_liabilities} currency={ccy} dim />, sort: (n) => D(n.total_liabilities).toNumber(), csv: (n) => D(n.total_liabilities).toFixed(2) },
    { key: 'net', header: 'Net assets', align: 'right', render: (n) => <Money value={n.net_assets} currency={ccy} className="text-ink" />, sort: (n) => D(n.net_assets).toNumber(), csv: (n) => D(n.net_assets).toFixed(2) },
    { key: 'units', header: 'Units', align: 'right', render: (n) => <span className="num">{fmtQty(n.units, ccy)}</span>, sort: (n) => D(n.units).toNumber(), csv: (n) => D(n.units).toString() },
    { key: 'per', header: 'For each unit', align: 'right', render: (n) => (n.nav_per_unit === null ? <span className="text-muted">no units</span> : <Money value={n.nav_per_unit} currency={ccy} decimals={4} className="text-gold" />), sort: (n) => D(n.nav_per_unit).toNumber(), csv: (n) => (n.nav_per_unit === null ? '' : D(n.nav_per_unit).toString()) },
    { key: 'status', header: 'Status', render: (n) => <StatusChip status={n.status === 'draft' ? 'prepared' : n.status} label={NAV_STATUS[n.status]} />, sort: (n) => n.status, csv: (n) => NAV_STATUS[n.status] },
    { key: 'prepared', header: 'Prepared', render: (n) => <span className="num text-[12px] text-muted">{fmtDateTime(n.prepared_at)}</span>, sort: (n) => n.prepared_at, csv: (n) => n.prepared_at },
    { key: 'decided', header: 'Decided', render: (n) => (n.approved_at ? <span className="num text-[12px] text-muted">{fmtDateTime(n.approved_at)}</span> : <span className="text-muted">—</span>), sort: (n) => n.approved_at ?? '', csv: (n) => n.approved_at ?? '' },
  ]
  const others = run ? Object.entries(run.basis).filter(([k, v]) => k !== 'formula' && k !== 'caution' && text(v) !== '') : []

  return (
    <div className="space-y-4">
      <Note kind="warn">The net asset value is an accounting figure from the books of the fund as they stand. It is not a regulatory valuation. Holdings carried at cost, or valued more than three months before the date, are counted at their book amount.</Note>

      <Section title="Prepare for a date">
        <Panel className="p-4" lit={false}>
          <div className="grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <Field label="As of"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: month-end, or for the quarterly report" /></Field>
            <button className="btn primary" disabled={!!whyNotPrepare || busy} title={whyNotPrepare} onClick={() => void prepare()}>{busy ? <Spinner /> : <Calculator size={15} />} Prepare</button>
          </div>
          <div className="mt-3 text-[11.5px] text-muted">Preparing reads the posted entries of the company up to the date and the units issued up to the date. It posts nothing and changes nothing. A figure prepared earlier for the same date and not yet decided is superseded.</div>
          {d.siblings > 0 && <div className="mt-2 text-[12px] text-warn">Several funds share the company of this fund, so their net assets cannot be told apart. Give each fund a company of its own.</div>}
        </Panel>
      </Section>

      {run && (
        <Section title={`Net asset value as of ${fmtDate(run.nav_date)}`} right={<span className="flex flex-wrap items-center gap-2">
          <StatusChip status={run.status === 'draft' ? 'prepared' : run.status} label={NAV_STATUS[run.status]} />
          {run.status === 'draft' && <>
            <button className="btn sm good" disabled={!!whyNotDecide(run) || busy} title={whyNotDecide(run)} onClick={() => setDeciding({ run, decision: 'approved' })}><Check size={13} /> Approve</button>
            <button className="btn sm danger" disabled={!!whyNotDecide(run) || busy} title={whyNotDecide(run)} onClick={() => setDeciding({ run, decision: 'rejected' })}><X size={13} /> Reject</button>
          </>}
        </span>}>
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Assets" value={run.total_assets} currency={ccy} sub="from posted entries up to the date" />
            <Stat label="Liabilities" value={run.total_liabilities} currency={ccy} sub="from posted entries up to the date" />
            <Stat label="Net assets" value={run.net_assets} currency={ccy} tone="gold" sub="assets − liabilities" />
            <Tile label="Units" sub="issued up to the date"><span className="num">{fmtQty(run.units, ccy)}</span></Tile>
            <Tile label="Net asset value for each unit" tone="text-gold" sub={run.nav_per_unit === null ? 'No units had been issued by the date' : 'net assets ÷ units'}>
              {run.nav_per_unit === null ? <span className="text-muted">—</span> : <Money value={run.nav_per_unit} currency={ccy} decimals={4} />}
            </Tile>
          </div>
          <Panel className="mt-3 space-y-3 p-4" lit={false}>
            <div>
              <div className="eyebrow mb-1.5">How it is calculated</div>
              <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-gold">{text(run.basis.formula) || 'Net asset value per unit = (assets − liabilities) ÷ units issued'}</div>
            </div>
            {others.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3">
                {others.map(([k, v]) => <Fact key={k} label={BASIS_LABEL[k] ?? human(k)}>{k === 'holdings_carried_at_cost' ? <Money value={text(v)} currency={ccy} /> : <span className="num">{text(v)}</span>}</Fact>)}
              </div>
            )}
            {text(run.basis.caution) && <Note kind="warn">{text(run.basis.caution)}</Note>}
            <div className="text-[11.5px] text-muted">
              Prepared {fmtDateTime(run.prepared_at)}{run.approved_at ? ` · ${run.status === 'rejected' ? 'rejected' : 'decided'} ${fmtDateTime(run.approved_at)}` : ''}{run.note ? ` · ${run.note}` : ''}
              {run.status === 'draft' && ' · It is not used anywhere until a second person approves it.'}
              {run.status === 'superseded' && ' · A later figure for the same date has replaced it. The record is kept.'}
            </div>
          </Panel>
        </Section>
      )}

      {approved.length > 1 && (
        <Section title="Net assets at each approved date">
          <Panel className="p-4" lit={false}><TrendChart height={220} labels={approved.map((n) => fmtDate(n.nav_date))} series={[{ name: 'Net assets, as approved', values: approved.map((n) => D(n.net_assets).toNumber()) }]} onPoint={(i) => setPicked(approved[i].id)} /></Panel>
        </Section>
      )}

      <Section title="Every figure prepared">
        <Panel lit={false}>
          <DataTable columns={columns} rows={navRuns} rowKey={(n) => n.id} onRow={(n) => setPicked(n.id)} exportName={`net-asset-value-${fund.name}`} rowClass={(n) => (run && n.id === run.id ? 'bg-surface2' : undefined)}
            empty={{ title: 'No net asset value has been prepared', body: 'Prepare one for a date. It is worked out from the posted entries of the company of the fund and the units issued, and a second person approves or rejects it.', icon: <Scale size={20} /> }} />
        </Panel>
      </Section>

      <ReasonDialog open={!!deciding} required={deciding?.decision === 'rejected'} danger={deciding?.decision === 'rejected'}
        title={deciding?.decision === 'approved' ? 'Approve this net asset value' : 'Reject this net asset value'} confirm={deciding?.decision === 'approved' ? 'Approve' : 'Reject'}
        body={deciding && (deciding.decision === 'approved'
          ? <>Net assets of <Money value={deciding.run.net_assets} currency={ccy} /> as of {fmtDate(deciding.run.nav_date)}{deciding.run.nav_per_unit !== null ? <>, <Money value={deciding.run.nav_per_unit} currency={ccy} decimals={4} /> for each unit,</> : null} will be shown as the net asset value of the fund and used for its multiples, for the value of each investor's units and, where the fee rests on it, for the management fee. It is an accounting figure, not a regulatory valuation. Nothing is posted.</>
          : <>The figure is kept on record as rejected and is not used anywhere.</>)}
        onCancel={() => setDeciding(null)} onConfirm={(r) => void decide(r)} />
    </div>
  )
}

// =====================================================================
// Management fee
// =====================================================================
function FeesTab({ d, s, manage }: { d: FundData; s: FundSummary; manage: boolean }) {
  const nav = useNavigate()
  const api = useApp((s0) => s0.api)!
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const { fund, fees } = d
  const ccy = fund.currency
  const counted = fees.filter((f) => f.status === 'proposed' || f.status === 'posted')
  const start = () => { const last = counted.map((f) => f.period_to).sort().pop(); return last ? addDays(last, 1) : startOfMonth(addMonths(today(), -2)) }
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState(() => endOfMonth(addMonths(start(), 2)))
  const [open, setOpen] = useState(false)

  const rate = fund.fee_pct === null ? ZERO : D(fund.fee_pct)
  const navFor = d.navRuns.filter((n) => n.status === 'approved' && n.nav_date <= to).sort((a, b) => b.nav_date.localeCompare(a.nav_date))[0] ?? null
  const basis = fund.fee_basis === 'committed' ? s.committed : fund.fee_basis === 'contributed' ? s.contributed : navFor ? D(navFor.net_assets) : null
  const days = from && to && to >= from ? daysBetween(from, to) + 1 : 0
  const amount = basis === null ? ZERO : round2(basis.times(rate).div(100).times(days).div(365))
  const clash = counted.find((f) => f.period_from <= to && f.period_to >= from)
  const problem = !manage ? 'You need the permission investment.manage in this company'
    : rate.isZero() ? 'This fund records no rate of management fee.'
    : !fund.manager_party_id ? 'This fund names no manager to whom the fee is owed.'
    : !from || !to || to < from ? 'State the period the fee covers.'
    : clash ? `A fee has already been proposed or posted for ${fmtDate(clash.period_from)} to ${fmtDate(clash.period_to)}, which overlaps this period.`
    : basis === null ? `The fee of this fund rests on its net asset value, and no approved net asset value exists up to ${fmtDate(to)}.`
    : amount.lte(0) ? 'The fee works out to nothing.' : undefined

  const propose = async () => {
    const j = await act(() => api.proposeFundFee(fund.id, from, to), 'Management fee proposed — awaiting approval')
    if (j) setOpen(false)
  }

  const columns: Column<FundFee>[] = [
    { key: 'from', header: 'From', render: (f) => <span className="num text-[12.5px]">{fmtDate(f.period_from)}</span>, sort: (f) => f.period_from, csv: (f) => f.period_from },
    { key: 'to', header: 'To', render: (f) => <span className="num text-[12.5px]">{fmtDate(f.period_to)}</span>, sort: (f) => f.period_to, csv: (f) => f.period_to },
    { key: 'days', header: 'Days', align: 'right', render: (f) => <span className="num">{daysBetween(f.period_from, f.period_to) + 1}</span>, sort: (f) => daysBetween(f.period_from, f.period_to), csv: (f) => daysBetween(f.period_from, f.period_to) + 1 },
    { key: 'basis', header: 'Charged on', render: (f) => <span className="text-[12.5px] text-ink2">{FEE_BASIS_LABEL[f.basis as Fund['fee_basis']] ?? human(f.basis)}</span>, sort: (f) => f.basis, csv: (f) => FEE_BASIS_LABEL[f.basis as Fund['fee_basis']] ?? f.basis },
    { key: 'amountOn', header: 'That amount', align: 'right', render: (f) => <Money value={f.basis_amount} currency={ccy} dim />, sort: (f) => D(f.basis_amount).toNumber(), csv: (f) => D(f.basis_amount).toFixed(2) },
    { key: 'rate', header: 'Rate a year', align: 'right', render: (f) => <span className="num">{pctText(f.rate)}</span>, sort: (f) => D(f.rate).toNumber(), csv: (f) => D(f.rate).toString() },
    { key: 'fee', header: 'Fee', align: 'right', render: (f) => <Money value={f.amount} currency={ccy} className="text-ink" />, sort: (f) => D(f.amount).toNumber(), csv: (f) => D(f.amount).toFixed(2) },
    { key: 'status', header: 'Status', render: (f) => <StatusChip status={f.status} label={POSTING_STATUS[f.status]} />, sort: (f) => f.status, csv: (f) => POSTING_STATUS[f.status] },
    { key: 'entry', header: 'Entry', render: (f) => (f.journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + f.journal_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
  ]
  const posted = fees.filter((f) => f.status === 'posted')

  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Rate" sub={`a year, on ${FEE_BASIS_LABEL[fund.fee_basis].toLowerCase()}`}>{rate.isZero() ? <span className="text-muted">none</span> : <span className="num">{pctText(rate)}</span>}</Tile>
        <Tile label="Owed to" sub="the manager named on the fund"><span className="text-[16px]">{fund.manager_party_id ? partyName(fund.manager_party_id) : <span className="text-muted">nobody is named</span>}</span></Tile>
        <Stat label="Fees posted" value={sum(posted.map((f) => f.amount))} currency={ccy} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> {posted.length} period{posted.length === 1 ? '' : 's'}</span>} />
        <Stat label="Fees awaiting approval" value={sum(fees.filter((f) => f.status === 'proposed').map((f) => f.amount))} currency={ccy} tone={fees.some((f) => f.status === 'proposed') ? 'warn' : undefined} sub="proposed, not in the ledger" />
      </div>

      <Panel lit={false}>
        <DataTable columns={columns} rows={fees} rowKey={(f) => f.id} exportName={`management-fees-${fund.name}`} initialSort={{ key: 'from', dir: 'desc' }}
          toolbar={<>
            <button className="btn sm primary" disabled={!manage} title={manage ? 'Proposes the entry of the fee for a period' : 'You need the permission investment.manage in this company'} onClick={() => setOpen(true)}><Plus size={13} /> Propose the fee for a period</button>
            <span className="text-[12px] text-muted">Fee = amount charged on × rate × days ÷ 365. The figures used are kept with each fee.</span>
          </>}
          empty={{ title: 'No management fee has been proposed', body: 'The fee for a period is worked out from the rate of the fund and the amount it is charged on, and proposed as an entry owed to the manager.', icon: <Calculator size={20} /> }} />
      </Panel>

      <Modal open={open} onClose={() => setOpen(false)} title="Propose the management fee for a period" subtitle={`${fund.name}${fund.manager_party_id ? ` · owed to ${partyName(fund.manager_party_id)}` : ''}`} width={600}
        footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!!problem || busy} title={problem} onClick={() => void propose()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
        <ProposedNote>This proposes an accounting entry. The fee reaches the ledger only after a second person approves it in the approval inbox. It records what is owed to the manager; no money moves.</ProposedNote>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Panel className="mt-4 space-y-2 p-3.5 text-[12.5px] text-ink2" lit={false}>
          <div className="eyebrow">Calculated before it is proposed</div>
          <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-gold">fee = amount charged on × rate × days ÷ 365</div>
          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2"><span>{FEE_BASIS_LABEL[fund.fee_basis]}{fund.fee_basis === 'nav' && navFor ? `, approved for ${fmtDate(navFor.nav_date)}` : fund.fee_basis === 'committed' ? ', active commitments' : ''}</span>{basis === null ? <span className="text-warn">none approved</span> : <Money value={basis} currency={ccy} />}</div>
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2"><span>Rate a year</span><span className="num">{pctText(rate)}</span></div>
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2"><span>Days, both dates included</span><span className="num">{days}</span></div>
            <div className="flex items-center justify-between gap-3 px-3 py-2"><span className="font-medium text-ink">Fee for the period</span><Money value={amount} currency={ccy} className="font-medium text-ink" /></div>
          </div>
          <div className="text-[11.5px] text-muted">The entry is dated {fmtDate(to)}. On approval the management fee is charged as an expense and credited to what is owed to the manager. The figures are read again when the entry is proposed, so the fee proposed is the one the records give at that moment.</div>
        </Panel>
        {!problem && to > today() && <div className="mt-3 text-[12px] text-warn">The period ends after today, on {fmtDate(to)}: the fee would be charged for days that have not yet passed, and the entry would carry that date.</div>}
        {problem && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
      </Modal>
    </div>
  )
}
