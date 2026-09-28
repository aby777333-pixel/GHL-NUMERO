import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { Briefcase, Building2, GitBranch, HandCoins, Landmark, Network, Pencil, Plus, Save, User, Users } from 'lucide-react'
import type { Account, Confidentiality, ID } from '@/engine/types'
import type {
  CorporateLink, CorporateLinkInput, CorporateRelation, Distribution, DistributionInput, EquityHolder, Fund, FundInput, Holding, HoldingInput, HoldingTxn, Instrument,
} from '@/engine/p3Types'
import { carryingAmount, corporateTree, fundSummary, holdingPosition, investmentMap, RELATION_LABEL, type CorpNode, type FundSummary, valuedWhenHeld } from '@/engine/invest'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO, groupDigits, sum } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, digits, foot, human, MissingSources, NoAccess, Tile, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, FlowMap, Meter, type FlowLink, type FlowNode } from '@/ui/charts'

// =====================================================================
// Investments and funds (spec 30, 456, 561, 1350).
// What the group holds, the funds it runs, what has been declared to
// shareholders and unit holders, and who owns what.
// Buying, selling, receiving and paying each PROPOSE an accounting
// entry. A valuation of a holding carried at cost stands beside the
// books. Nothing here is a regulatory computation, and NUMERO never
// moves money.
// =====================================================================

type TabKey = 'holdings' | 'funds' | 'distributions' | 'structure' | 'map'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'holdings', label: 'Holdings' }, { key: 'funds', label: 'Funds' }, { key: 'distributions', label: 'Dividends and distributions' },
  { key: 'structure', label: 'Corporate structure' }, { key: 'map', label: 'Group investment map' },
]

export const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
export const INSTRUMENT_LABEL: Record<Instrument, string> = {
  equity: 'Equity shares', preference: 'Preference shares', debt: 'Debt', units: 'Units of a fund', convertible: 'Convertible instrument', partnership: 'Share in a partnership', property: 'Property', other: 'Other',
}
export const MEASUREMENT_LABEL: Record<Holding['measurement'], string> = { cost: 'cost', fair_value: 'fair value' }
export const STRUCTURE_LABEL: Record<Fund['structure'], string> = {
  aif_cat1: 'Alternative investment fund, category I', aif_cat2: 'Alternative investment fund, category II', aif_cat3: 'Alternative investment fund, category III',
  trust: 'Trust', llp: 'Limited liability partnership', company: 'Company', other: 'Other',
}
export const FEE_BASIS_LABEL: Record<Fund['fee_basis'], string> = { committed: 'Capital committed', contributed: 'Capital contributed', nav: 'Net assets at the last approved net asset value' }
export const FUND_STATUS: Fund['status'][] = ['forming', 'open', 'closed', 'winding_up', 'wound_up']
export const DIST_KIND_LABEL: Record<Distribution['kind'], string> = { dividend: 'Dividend', distribution: 'Distribution', return_of_capital: 'Return of capital' }
export const DIST_STATUS_LABEL: Partial<Record<Distribution['status'], string>> = {
  submitted: 'awaiting approval', approved: 'approved — entry awaiting approval', declared: 'declared — not yet paid', part_paid: 'paid in part',
}
export const NOT_REGULATORY = 'Nothing on this screen is a regulatory report. Multiples and net asset values are arithmetic on what the books and the registers hold, each with its formula. Reporting under the rules of the securities regulator is configured separately and validated by qualified professionals.'

/** a quantity of shares or units, grouped, with up to four decimals */
export const fmtQty = (v: Decimal.Value | null | undefined, ccy = 'INR') => {
  const d = D(v).toDecimalPlaces(4)
  const [i, f] = d.abs().toFixed().split('.')
  return (d.isNegative() ? '−' : '') + groupDigits(i, ccy === 'INR') + (f ? '.' + f : '')
}
export const pctText = (v: Decimal.Value | null | undefined, dp = 4) => (v === null || v === undefined || v === '' ? '—' : D(v).toDecimalPlaces(dp).toString() + '%')

export const postingLedgers = (accounts: Account[], companyId: ID, types: Account['type'][], first: string[] = []) =>
  accounts
    .filter((a) => a.company_id === companyId && !a.is_group && a.is_active && !a.control_type && types.includes(a.type))
    .sort((a, b) => Number(first.includes(b.subtype)) - Number(first.includes(a.subtype)) || a.code.localeCompare(b.code))

/** True when the person recorded the thing themselves and may therefore not decide on it. */
export function useOwnWork() {
  const session = useApp((s) => s.session)
  const override = session?.group?.settings.controls?.maker_checker === 'owner_override' && session.isGroupAdmin
  return (maker: ID | null | undefined) => !!maker && maker === session?.user.id && !override
}

/** The name of what an investment is held in: a company of the group, or an outside party. */
export function useInvesteeName() {
  const partyName = usePartyName()
  const companyName = useCompanyName()
  return (h: Pick<Holding, 'investee_company_id' | 'investee_party_id'>) => (h.investee_company_id ? companyName(h.investee_company_id) : h.investee_party_id ? partyName(h.investee_party_id) : '')
}

export { valuedWhenHeld }

export function useHoldingColumns(asOf: string, outdated?: Map<ID, Decimal>): Column<Holding>[] {
  const companyName = useCompanyName()
  const companyCode = useCompanyCode()
  const investee = useInvesteeName()
  return [
    { key: 'no', header: 'Number', render: (h) => <span className="num text-[12.5px] text-gold">{h.holding_no}</span>, sort: (h) => h.holding_no, csv: (h) => h.holding_no },
    { key: 'company', header: 'Company', render: (h) => <span className="text-ink2" title={companyName(h.company_id)}>{companyCode(h.company_id)}</span>, sort: (h) => companyName(h.company_id), csv: (h) => companyName(h.company_id) },
    {
      key: 'name', header: 'Investment', sort: (h) => h.name.toLowerCase(), csv: (h) => h.name + (investee(h) ? ` — in ${investee(h)}` : ''),
      render: (h) => <div className="min-w-0"><div className="text-ink">{h.name}</div>{investee(h) && <div className="text-[11px] text-muted">in {investee(h)}{h.investee_company_id ? ' · a company of the group' : ''}</div>}</div>,
    },
    { key: 'instrument', header: 'Instrument', render: (h) => <span className="text-[12.5px] text-ink2">{INSTRUMENT_LABEL[h.instrument]}</span>, sort: (h) => h.instrument, csv: (h) => INSTRUMENT_LABEL[h.instrument] },
    { key: 'measurement', header: 'Carried at', render: (h) => <span className={cx('chip', h.measurement === 'fair_value' ? 'cyan' : '')}>{MEASUREMENT_LABEL[h.measurement]}</span>, sort: (h) => h.measurement, csv: (h) => MEASUREMENT_LABEL[h.measurement] },
    { key: 'qty', header: 'Quantity', align: 'right', render: (h) => <span className="num">{fmtQty(h.quantity, h.currency)}</span>, sort: (h) => D(h.quantity).toNumber(), csv: (h) => D(h.quantity).toString() },
    { key: 'cost', header: 'Cost', align: 'right', render: (h) => <Money value={h.cost} currency={h.currency} dim />, sort: (h) => D(h.cost).toNumber(), csv: (h) => D(h.cost).toFixed(2) },
    { key: 'carrying', header: 'Carrying amount in the books', align: 'right', render: (h) => <Money value={carryingAmount(h)} currency={h.currency} className="text-ink" />, sort: (h) => carryingAmount(h).toNumber(), csv: (h) => carryingAmount(h).toFixed(2) },
    {
      key: 'fv', header: 'Latest approved fair value', align: 'right', sort: (h) => (h.fair_value === null ? -1 : D(h.fair_value).toNumber()), csv: (h) => (h.fair_value === null ? '' : D(h.fair_value).toFixed(2)),
      render: (h) => {
        if (h.fair_value === null) return <span className="text-muted">none on record</span>
        const p = holdingPosition(h, asOf)
        const then = outdated?.get(h.id)
        return (
          <div>
            <Money value={h.fair_value} currency={h.currency} className={then ? 'text-ink2' : undefined} />
            {h.measurement === 'cost' && <div className="text-[11px] text-muted">beside the books</div>}
            {then && <div className="text-[11px] text-warn" title="The quantity held has changed since this valuation. The valuation has not been restated.">of {fmtQty(then, h.currency)} held then</div>}
            {p.valuationAge !== null && p.valuationAge > 92 && <div className="text-[11px] text-warn">{p.valuationAge} days old</div>}
          </div>
        )
      },
    },
    { key: 'fvdate', header: 'Valued as of', render: (h) => (h.fair_value_date ? <span className="num text-[12.5px]">{fmtDate(h.fair_value_date)}</span> : <span className="text-muted">—</span>), sort: (h) => h.fair_value_date ?? '', csv: (h) => h.fair_value_date ?? '' },
    { key: 'status', header: 'Status', render: (h) => <StatusChip status={h.status} />, sort: (h) => h.status, csv: (h) => human(h.status) },
  ]
}

export default function Investments() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('investment.view', id))
  if (!ids.length) return <NoAccess eyebrow="Investments" title="Investments and funds" perm="investment.view" />
  return <InvestmentsView ids={ids} partial={ids.length < scope.length} />
}

interface FundRow { fund: Fund; s: FundSummary }

function InvestmentsView({ ids, partial }: { ids: ID[]; partial: boolean }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const currency = useCurrency()
  const companyName = useCompanyName()
  const companyCode = useCompanyCode()
  const idsKey = ids.join(',')
  const asOf = today()

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'holdings'
  const go = (next: Record<string, string>) => setSp(next, { replace: true })

  const [newHolding, setNewHolding] = useState(false)
  const [newFund, setNewFund] = useState(false)
  const [declaring, setDeclaring] = useState(false)
  const [newLink, setNewLink] = useState(false)
  const [newHolder, setNewHolder] = useState(false)

  const main = useAsync(async () => {
    const [holdings, funds, commitments, distributions, txns] = await Promise.all([api.listHoldings(ids), api.listFunds(ids), api.listCommitments({ companyIds: ids }), api.listDistributions(ids), api.listHoldingTxns({ companyIds: ids })])
    const navRuns = (await Promise.all(funds.map((f) => api.listNavRuns(f.id)))).flat()
    return { holdings, funds, commitments, distributions, navRuns, txns }
  }, [api, idsKey])

  const manageIds = ids.filter((id) => can('investment.manage', id))
  const noManage = manageIds.length ? undefined : 'You need the permission investment.manage to record this'
  const mixedCurrencies = new Set(ids.map((id) => companies.find((c) => c.id === id)?.base_currency ?? currency)).size > 1

  const d = main.data
  const holdings = useMemo(() => d?.holdings ?? [], [d])
  const funds = useMemo(() => d?.funds ?? [], [d])
  const distributions = useMemo(() => d?.distributions ?? [], [d])
  const outdated = useMemo(() => valuedWhenHeld(holdings, d?.txns ?? []), [holdings, d])
  const holdingColumns = useHoldingColumns(asOf, outdated)
  const ccyOf = (companyId: ID) => companies.find((c) => c.id === companyId)?.base_currency ?? currency

  // ---------------------------------------------------------------- holdings
  // a valuation made when a different quantity was held no longer describes the holding: it is shown on its line, and left out of the totals
  const positions = useMemo(() => holdings.map((h) => holdingPosition(h, asOf)), [holdings, asOf])
  const active = positions.filter((p) => p.holding.status === 'active')
  const cost = sum(holdings.map((h) => h.cost))
  const carrying = sum(positions.map((p) => p.carrying))
  const leftOut = active.filter((p) => p.valuation !== null && outdated.has(p.holding.id)).length
  const valued = active.filter((p) => p.valuation !== null && !outdated.has(p.holding.id))
  const fairValue = sum(valued.map((p) => p.valuation!))
  const valuedDates = valued.map((p) => p.holding.fair_value_date ?? '').filter(Boolean).sort()
  const inBooksChange = sum(holdings.map((h) => h.fv_adjustment))
  const besideBooks = sum(valued.map((p) => p.beside ?? ZERO))
  const besideCount = valued.filter((p) => p.beside !== null).length
  const income = sum(holdings.map((h) => h.income_received))
  const realised = sum(holdings.map((h) => h.realised_gain))

  // ---------------------------------------------------------------- funds
  const fundRows: FundRow[] = useMemo(() => funds.map((fund) => ({ fund, s: fundSummary(fund, d?.commitments ?? [], d?.navRuns ?? []) })), [funds, d])
  const fundColumns: Column<FundRow>[] = [
    { key: 'name', header: 'Fund', render: (r) => <span className="text-ink">{r.fund.name}</span>, sort: (r) => r.fund.name.toLowerCase(), csv: (r) => r.fund.name },
    { key: 'scheme', header: 'Scheme', render: (r) => (r.fund.scheme ? <span className="text-[12.5px] text-ink2">{r.fund.scheme}</span> : <span className="text-muted">—</span>), sort: (r) => (r.fund.scheme ?? '').toLowerCase(), csv: (r) => r.fund.scheme ?? '' },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companyName(r.fund.company_id)}>{companyCode(r.fund.company_id)}</span>, sort: (r) => companyName(r.fund.company_id), csv: (r) => companyName(r.fund.company_id) },
    { key: 'structure', header: 'Structure', render: (r) => <span className="text-[12.5px] text-ink2">{STRUCTURE_LABEL[r.fund.structure]}</span>, sort: (r) => r.fund.structure, csv: (r) => STRUCTURE_LABEL[r.fund.structure] },
    { key: 'committed', header: 'Committed', align: 'right', render: (r) => <Money value={r.s.committed} currency={r.fund.currency} />, sort: (r) => r.s.committed.toNumber(), csv: (r) => r.s.committed.toFixed(2) },
    { key: 'called', header: 'Called', align: 'right', render: (r) => <Money value={r.s.called} currency={r.fund.currency} dim />, sort: (r) => r.s.called.toNumber(), csv: (r) => r.s.called.toFixed(2) },
    { key: 'contributed', header: 'Contributed', align: 'right', render: (r) => <Money value={r.s.contributed} currency={r.fund.currency} dim />, sort: (r) => r.s.contributed.toNumber(), csv: (r) => r.s.contributed.toFixed(2) },
    { key: 'distributed', header: 'Distributed', align: 'right', render: (r) => <Money value={r.s.distributed} currency={r.fund.currency} dim />, sort: (r) => r.s.distributed.toNumber(), csv: (r) => r.s.distributed.toFixed(2) },
    { key: 'units', header: 'Units issued', align: 'right', render: (r) => <span className="num">{fmtQty(r.s.units, r.fund.currency)}</span>, sort: (r) => r.s.units.toNumber(), csv: (r) => r.s.units.toString() },
    {
      key: 'nav', header: 'Net asset value per unit, last approved', align: 'right', sort: (r) => D(r.s.nav?.nav_per_unit).toNumber(), csv: (r) => (r.s.nav?.nav_per_unit == null ? '' : D(r.s.nav.nav_per_unit).toString()),
      render: (r) => (r.s.nav?.nav_per_unit != null
        ? <Money value={r.s.nav.nav_per_unit} currency={r.fund.currency} decimals={4} />
        : <span className="text-muted">none approved</span>),
    },
    { key: 'navdate', header: 'As of', render: (r) => (r.s.nav ? <span className="num text-[12.5px]">{fmtDate(r.s.nav.nav_date)}</span> : <span className="text-muted">—</span>), sort: (r) => r.s.nav?.nav_date ?? '', csv: (r) => r.s.nav?.nav_date ?? '' },
    { key: 'status', header: 'Status', render: (r) => <span className="flex flex-wrap items-center gap-1.5"><StatusChip status={r.fund.status} />{r.fund.confidentiality !== 'internal' && <span className="chip violet">{human(r.fund.confidentiality)}</span>}</span>, sort: (r) => r.fund.status, csv: (r) => human(r.fund.status) },
  ]
  const fCommitted = sum(fundRows.map((r) => r.s.committed)), fCalled = sum(fundRows.map((r) => r.s.called))
  const fContributed = sum(fundRows.map((r) => r.s.contributed)), fDistributed = sum(fundRows.map((r) => r.s.distributed))

  // ---------------------------------------------------------------- dividends and distributions
  const fundName = (id: ID | null) => (id ? funds.find((f) => f.id === id)?.name ?? 'A fund' : null)
  const distColumns: Column<Distribution>[] = [
    { key: 'no', header: 'Number', render: (x) => <span className="num text-[12.5px] text-gold">{x.dist_no}</span>, sort: (x) => x.dist_no, csv: (x) => x.dist_no },
    { key: 'company', header: 'Company', render: (x) => <span className="text-ink2" title={companyName(x.company_id)}>{companyCode(x.company_id)}</span>, sort: (x) => companyName(x.company_id), csv: (x) => companyName(x.company_id) },
    { key: 'kind', header: 'Kind', render: (x) => <span className={cx('chip', x.kind === 'dividend' ? 'gold' : x.kind === 'return_of_capital' ? 'violet' : 'cyan')}>{DIST_KIND_LABEL[x.kind]}</span>, sort: (x) => x.kind, csv: (x) => DIST_KIND_LABEL[x.kind] },
    { key: 'to', header: 'Declared to', render: (x) => <span className="text-ink2">{x.fund_id ? `Unit holders of ${fundName(x.fund_id)}` : `Shareholders of ${companyName(x.company_id)}`}</span>, sort: (x) => fundName(x.fund_id) ?? '', csv: (x) => (x.fund_id ? `Unit holders of ${fundName(x.fund_id)}` : `Shareholders of ${companyName(x.company_id)}`) },
    { key: 'declared', header: 'Declared on', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.declaration_date)}</span>, sort: (x) => x.declaration_date, csv: (x) => x.declaration_date },
    { key: 'record', header: 'Record date', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.record_date)}</span>, sort: (x) => x.record_date, csv: (x) => x.record_date },
    { key: 'pay', header: 'Payment date', render: (x) => (x.payment_date ? <span className="num text-[12.5px]">{fmtDate(x.payment_date)}</span> : <span className="text-muted">not set</span>), sort: (x) => x.payment_date ?? '', csv: (x) => x.payment_date ?? '' },
    { key: 'total', header: 'Amount declared', align: 'right', render: (x) => <Money value={x.total_amount} currency={ccyOf(x.company_id)} className="text-ink" />, sort: (x) => D(x.total_amount).toNumber(), csv: (x) => D(x.total_amount).toFixed(2) },
    { key: 'tax', header: 'Tax deducted at', align: 'right', render: (x) => <span className="num">{pctText(x.tax_pct)}</span>, sort: (x) => D(x.tax_pct).toNumber(), csv: (x) => D(x.tax_pct).toString() },
    { key: 'status', header: 'Status', render: (x) => <StatusChip status={x.status} label={DIST_STATUS_LABEL[x.status]} />, sort: (x) => x.status, csv: (x) => DIST_STATUS_LABEL[x.status] ?? human(x.status) },
  ]
  const live = distributions.filter((x) => ['declared', 'part_paid', 'paid'].includes(x.status))
  const inApproval = distributions.filter((x) => ['submitted', 'approved'].includes(x.status))
  const unpaid = distributions.filter((x) => ['declared', 'part_paid'].includes(x.status))

  const action = tab === 'holdings' ? <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setNewHolding(true)}><Plus size={15} /> New investment</button>
    : tab === 'funds' ? <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setNewFund(true)}><Plus size={15} /> New fund</button>
    : tab === 'distributions' ? <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setDeclaring(true)}><HandCoins size={15} /> Declare</button>
    : tab === 'structure' ? <>
      <button className="btn" disabled={!manageIds.length} title={noManage} onClick={() => setNewHolder(true)}><Users size={15} /> Add a shareholder</button>
      <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setNewLink(true)}><GitBranch size={15} /> Add a link</button>
    </> : null

  return (
    <div>
      <PageHeader
        eyebrow="Investments"
        title="Investments and funds"
        subtitle={<>
          As at {fmtDate(asOf)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · what is held, the funds that are run, what has been declared, and who owns what. A purchase, a sale, a receipt or a payment proposes an entry; NUMERO never moves money.
          <DemoTag className="ml-2" />
        </>}
        actions={action}
      />

      {partial && <MissingSources missing={['investments']} className="mb-4" />}
      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading investments and funds" /></Panel>}

      {d && (
        <>
          <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'holdings' ? holdings.length : t.key === 'funds' ? funds.length : t.key === 'distributions' ? distributions.length : undefined }))} value={tab} onChange={(k) => go({ tab: k })} />
          {mixedCurrencies && tab !== 'structure' && <Note kind="warn" className="mb-4">The selected companies keep their books in different currencies. Totals on this page add the figures of each company as recorded, without converting them. Select one company for a total in a single currency.</Note>}

          {tab === 'holdings' && (
            <div className="space-y-4">
              <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                <Stat label="Cost" value={cost} currency={currency} sub={`what was paid for what is still held · ${active.length} active holding${active.length === 1 ? '' : 's'}`} />
                <Stat label="Carrying amount in the books" value={carrying} currency={currency} tone="gold" sub="cost + changes in fair value that have been posted" />
                <Tile label="Fair value, where one is approved"
                  sub={<span>
                    {valued.length ? <>{valued.length} of {active.length} active holdings · valuations dated {fmtDate(valuedDates[0])}{valuedDates.length > 1 && valuedDates[0] !== valuedDates[valuedDates.length - 1] ? ` to ${fmtDate(valuedDates[valuedDates.length - 1])}` : ''}</> : 'No approved valuation describes what is held today'}
                    {leftOut > 0 && <span className="text-warn"> · {leftOut} left out: the quantity held has changed since the valuation</span>}
                  </span>}>
                  {valued.length ? <Money value={fairValue} currency={currency} compact /> : <span className="text-muted">—</span>}
                </Tile>
                <Tile label="Unrealised change" tone={inBooksChange.isNegative() ? 'text-neg' : inBooksChange.gt(0) ? 'text-pos' : undefined}
                  sub={<span>in the books, on holdings carried at fair value{besideCount > 0 && <> · beside the books, on {besideCount} holding{besideCount === 1 ? '' : 's'} carried at cost: <Money value={besideBooks} currency={currency} compact sign /></>}</span>}>
                  <Money value={inBooksChange} currency={currency} compact sign />
                </Tile>
                <Stat label="Income received" value={income} currency={currency} sub="dividends, interest and distributions, from posted entries" />
                <Tile label="Realised gain or loss" tone={realised.isNegative() ? 'text-neg' : realised.gt(0) ? 'text-pos' : undefined} sub="on what has been sold, from posted entries">
                  <Money value={realised} currency={currency} compact sign />
                </Tile>
              </div>
              <Panel lit={false}>
                <DataTable columns={holdingColumns} rows={holdings} rowKey={(h) => h.id} onRow={(h) => nav('/investments/holdings/' + h.id)} exportName="investments-held" initialSort={{ key: 'no', dir: 'asc' }}
                  toolbar={<span className="text-[12px] text-muted">A fair value is shown only once it is approved, and always with its date. For a holding carried at cost it stands beside the books and is not added to them.</span>}
                  footer={<tr>
                    <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={6}>Total · {holdings.length} holding{holdings.length === 1 ? '' : 's'}</td>
                    <td className={cx(foot, 'r')}><Money value={cost} currency={currency} /></td>
                    <td className={cx(foot, 'r')}><Money value={carrying} currency={currency} className="font-medium text-ink" /></td>
                    <td className={foot} colSpan={3} />
                  </tr>}
                  empty={{ title: 'No investment is shared with you', body: 'Record an investment with the company that holds it and the asset ledger that carries it. It starts empty: recording a purchase proposes the accounting entry.', icon: <Briefcase size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setNewHolding(true)}><Plus size={13} /> New investment</button> }} />
              </Panel>
            </div>
          )}

          {tab === 'funds' && (
            <div className="space-y-4">
              <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Committed by investors" value={fCommitted} currency={currency} tone="gold" sub={`active commitments in ${funds.length} fund${funds.length === 1 ? '' : 's'}`} />
                <Stat label="Called" value={fCalled} currency={currency} sub={<span>capital calls that were approved · not yet called <Money value={fCommitted.minus(fCalled)} currency={currency} compact /></span>} />
                <Stat label="Contributed" value={fContributed} currency={currency} sub={<span>money received, from posted entries · called and not received <Money value={fCalled.minus(fContributed)} currency={currency} compact /></span>} />
                <Stat label="Distributed" value={fDistributed} currency={currency} sub="paid to unit holders, before tax deducted, from posted entries" />
              </div>
              <Panel lit={false}>
                <DataTable columns={fundColumns} rows={fundRows} rowKey={(r) => r.fund.id} onRow={(r) => nav('/investments/funds/' + r.fund.id)} exportName="funds" initialSort={{ key: 'name', dir: 'asc' }}
                  empty={{ title: 'No fund is shared with you', body: 'Record a fund with the company that keeps its books and the equity ledger that carries the capital of its investors. Commitments, capital calls, units and the net asset value follow from there.', icon: <Landmark size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setNewFund(true)}><Plus size={13} /> New fund</button> }} />
              </Panel>
              <Note>{NOT_REGULATORY}</Note>
            </div>
          )}

          {tab === 'distributions' && (
            <div className="space-y-4">
              <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Declared" value={sum(live.map((x) => x.total_amount))} currency={currency} tone="gold" sub={`${live.length} declaration${live.length === 1 ? '' : 's'} whose entry has been posted`} />
                <Stat label="Declared, not yet paid in full" value={unpaid.length} count tone={unpaid.length ? 'warn' : undefined} sub="payment is recorded holder by holder" />
                <Stat label="In approval" value={inApproval.length} count sub="submitted, or approved with the entry still awaiting approval" />
                <Stat label="Drafts" value={distributions.filter((x) => x.status === 'draft').length} count sub="nothing has been declared by a draft" />
              </div>
              <Panel lit={false}>
                <DataTable columns={distColumns} rows={distributions} rowKey={(x) => x.id} onRow={(x) => nav('/investments/distributions/' + x.id)} exportName="dividends-and-distributions" initialSort={{ key: 'declared', dir: 'desc' }}
                  toolbar={<span className="text-[12px] text-muted">Declaring pays nothing. A declaration is approved, its entry is posted, and payment to each holder is then recorded and approved separately.</span>}
                  empty={{ title: 'No dividend or distribution is shared with you', body: 'A company declares a dividend to the shareholders on its register. A fund declares a distribution to its unit holders by the units held on the record date.', icon: <HandCoins size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setDeclaring(true)}><Plus size={13} /> Declare</button> }} />
              </Panel>
            </div>
          )}

          {tab === 'structure' && <StructureTab ids={ids} manageIds={manageIds} />}
          {tab === 'map' && <MapTab holdings={holdings} outdated={outdated} asOf={asOf} />}
        </>
      )}

      <HoldingForm open={newHolding} companyIds={ids} funds={funds} onClose={() => setNewHolding(false)} onSaved={(id) => nav('/investments/holdings/' + id)} />
      <FundForm open={newFund} companyIds={ids} onClose={() => setNewFund(false)} onSaved={(id) => nav('/investments/funds/' + id)} />
      <DistributionForm open={declaring} companyIds={ids} funds={funds} onClose={() => setDeclaring(false)} onSaved={(id) => nav('/investments/distributions/' + id)} />
      <LinkForm open={newLink} onClose={() => setNewLink(false)} />
      <HolderForm open={newHolder} companyIds={manageIds} onClose={() => setNewHolder(false)} />
    </div>
  )
}

// =====================================================================
// Corporate structure: the tree, the register of links, the shareholders
// =====================================================================
const keyOf = (companyId: ID | null, partyId: ID | null) => (companyId ? 'c:' + companyId : 'p:' + partyId)
const inForce = (l: CorporateLink, asOf: string) => (l.effective_from && l.effective_from > asOf ? 'not yet in force' : l.effective_to && l.effective_to < asOf ? 'ended' : 'in force')

function StructureTab({ ids, manageIds }: { ids: ID[]; manageIds: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const idsKey = ids.join(',')
  const asOf = today()
  const [editLink, setEditLink] = useState<CorporateLink | null>(null)
  const [editHolder, setEditHolder] = useState<EquityHolder | null>(null)
  const [addHolderTo, setAddHolderTo] = useState<ID | null>(null)
  const [shown, setShown] = useState<ID>('')

  const data = useAsync(async () => {
    const [links, holders] = await Promise.all([api.listCorporateLinks(), api.listEquityHolders(ids)])
    return { links, holders }
  }, [api, idsKey])

  const links = useMemo(() => data.data?.links ?? [], [data.data])
  const holders = useMemo(() => data.data?.holders ?? [], [data.data])
  const tree = useMemo(() => corporateTree(links, companies, parties, asOf), [links, companies, parties, asOf])
  const manage = manageIds.length > 0
  const noManage = manage ? undefined : 'You need the permission investment.manage to change the register'

  const sideName = (c: ID | null, p: ID | null) => (c ? companyName(c) : partyName(p))
  const linkFor = (parent: CorpNode, child: CorpNode) => links.find((l) => inForce(l, asOf) === 'in force' && keyOf(l.parent_company_id, l.parent_party_id) === (parent.kind === 'company' ? 'c:' : 'p:') + parent.id
    && keyOf(l.child_company_id, l.child_party_id) === (child.kind === 'company' ? 'c:' : 'p:') + child.id && l.relation === child.relation
    && (l.ownership_pct === null ? child.directPct === null : child.directPct !== null && D(l.ownership_pct).eq(child.directPct))) ?? null

  const linkColumns: Column<CorporateLink>[] = [
    { key: 'owner', header: 'Owner', render: (l) => <Side company={l.parent_company_id} name={sideName(l.parent_company_id, l.parent_party_id)} />, sort: (l) => sideName(l.parent_company_id, l.parent_party_id).toLowerCase(), csv: (l) => sideName(l.parent_company_id, l.parent_party_id) },
    { key: 'owned', header: 'Owned', render: (l) => <Side company={l.child_company_id} name={sideName(l.child_company_id, l.child_party_id)} />, sort: (l) => sideName(l.child_company_id, l.child_party_id).toLowerCase(), csv: (l) => sideName(l.child_company_id, l.child_party_id) },
    { key: 'relation', header: 'What the owned entity is', render: (l) => <span className="chip gold">{RELATION_LABEL[l.relation]}</span>, sort: (l) => l.relation, csv: (l) => RELATION_LABEL[l.relation] },
    { key: 'own', header: 'Ownership', align: 'right', render: (l) => <span className="num">{pctText(l.ownership_pct)}</span>, sort: (l) => D(l.ownership_pct).toNumber(), csv: (l) => (l.ownership_pct === null ? '' : D(l.ownership_pct).toString()) },
    { key: 'vote', header: 'Voting', align: 'right', render: (l) => <span className="num">{pctText(l.voting_pct)}</span>, sort: (l) => D(l.voting_pct).toNumber(), csv: (l) => (l.voting_pct === null ? '' : D(l.voting_pct).toString()) },
    { key: 'from', header: 'In force from', render: (l) => (l.effective_from ? <span className="num text-[12.5px]">{fmtDate(l.effective_from)}</span> : <span className="text-muted">not recorded</span>), sort: (l) => l.effective_from ?? '', csv: (l) => l.effective_from ?? '' },
    { key: 'to', header: 'Until', render: (l) => (l.effective_to ? <span className="num text-[12.5px]">{fmtDate(l.effective_to)}</span> : <span className="text-muted">—</span>), sort: (l) => l.effective_to ?? '9999', csv: (l) => l.effective_to ?? '' },
    { key: 'state', header: 'State', render: (l) => { const s = inForce(l, asOf); return <span className={cx('chip', s === 'in force' ? 'pos' : s === 'ended' ? '' : 'cyan')}>{s}</span> }, sort: (l) => inForce(l, asOf), csv: (l) => inForce(l, asOf) },
    { key: 'note', header: 'Note', render: (l) => <span className="text-[12.5px] text-ink2">{l.note ?? ''}</span>, csv: (l) => l.note ?? '' },
    { key: 'act', header: '', align: 'right', render: (l) => <button className="btn sm ghost" disabled={!manage} title={noManage} onClick={(e) => { e.stopPropagation(); setEditLink(l) }}><Pencil size={13} /> Edit</button> },
  ]

  // shareholders: each holder's part of its class is shares ÷ all shares of that class in the company
  const classTotals = useMemo(() => {
    const m = new Map<string, Decimal>()
    for (const e of holders) m.set(e.company_id + '|' + e.share_class, (m.get(e.company_id + '|' + e.share_class) ?? ZERO).plus(e.quantity))
    return m
  }, [holders])
  const shareOf = (e: EquityHolder) => { const t = classTotals.get(e.company_id + '|' + e.share_class) ?? ZERO; return t.isZero() ? null : D(e.quantity).times(100).div(t) }
  const withHolders = companies.filter((c) => ids.includes(c.id) && holders.some((e) => e.company_id === c.id))
  const shownId = withHolders.some((c) => c.id === shown) ? shown : withHolders[0]?.id ?? ''
  const shownHolders = holders.filter((e) => e.company_id === shownId)
  const shownCurrency = companies.find((c) => c.id === shownId)?.base_currency
  const canManageShown = !!shownId && can('investment.manage', shownId)
  const holderColumns: Column<EquityHolder>[] = [
    { key: 'holder', header: 'Holder', render: (e) => <button className="link text-left" onClick={(ev) => { ev.stopPropagation(); nav('/parties/' + e.holder_party_id) }}>{partyName(e.holder_party_id)}</button>, sort: (e) => partyName(e.holder_party_id).toLowerCase(), csv: (e) => partyName(e.holder_party_id) },
    { key: 'class', header: 'Class', render: (e) => <span className="chip">{e.share_class}</span>, sort: (e) => e.share_class, csv: (e) => e.share_class },
    { key: 'qty', header: 'Number of shares', align: 'right', render: (e) => <span className="num">{fmtQty(e.quantity, shownCurrency)}</span>, sort: (e) => D(e.quantity).toNumber(), csv: (e) => D(e.quantity).toString() },
    { key: 'paid', header: 'Paid up', align: 'right', render: (e) => <Money value={e.paid_up} currency={shownCurrency} dim />, sort: (e) => D(e.paid_up).toNumber(), csv: (e) => D(e.paid_up).toFixed(2) },
    {
      key: 'share', header: 'Part of the class (calculated)', width: 210, sort: (e) => shareOf(e)?.toNumber() ?? 0, csv: (e) => shareOf(e)?.toDecimalPlaces(4).toString() ?? '',
      render: (e) => { const s = shareOf(e); return s === null ? <span className="text-muted">—</span> : <div><div className="num mb-1 text-[12.5px] text-ink">{pctText(s, 2)}</div><Meter value={s.toNumber()} max={100} /></div> },
    },
    { key: 'note', header: 'Note', render: (e) => <span className="text-[12.5px] text-ink2">{e.note ?? ''}</span>, csv: (e) => e.note ?? '' },
    { key: 'updated', header: 'Last changed', render: (e) => <span className="num text-[12px] text-muted">{fmtDate(e.updated_at.slice(0, 10))}</span>, sort: (e) => e.updated_at, csv: (e) => e.updated_at.slice(0, 10) },
    { key: 'act', header: '', align: 'right', render: (e) => <button className="btn sm ghost" disabled={!canManageShown} title={canManageShown ? undefined : 'You need the permission investment.manage in this company'} onClick={(ev) => { ev.stopPropagation(); setEditHolder(e) }}><Pencil size={13} /> Change</button> },
  ]

  if (data.error) return <ErrorBox message={data.error} retry={data.reload} />
  if (!data.data) return <Panel><Loading rows={6} label="Loading the corporate structure" /></Panel>

  return (
    <div className="space-y-4">
      <Section title={`The group as a tree, as at ${fmtDate(asOf)}`} right={<Explain title="Held by the top of the tree" text="Each line shows what the entity above holds directly. The second percentage is what the entity at the top of that tree holds through every level on the way down." formula="held through every level = the product of the direct percentages on the way down" source="Source: the register of links below, as in force today. An entity with two owners appears under each of them." />}>
        <Panel className="p-3" lit={false}>
          {tree.roots.length === 0
            ? <Empty icon={<Network size={20} />} title="No link is in force" body="Record who owns what: the owner, what is owned, what the owned entity is, and the percentage held. The tree is drawn from those links." />
            : <div className="overflow-x-auto"><div className="min-w-[640px]">
              <div className="flex items-center gap-3 border-b border-line px-2.5 pb-2 text-[11px] uppercase tracking-[0.08em] text-muted">
                <span className="min-w-0 flex-1">Owner, and under it what it owns</span>
                <span className="w-[92px] text-right">Ownership</span><span className="w-[80px] text-right">Voting</span><span className="w-[120px] text-right">Through every level</span><span className="w-[70px]" />
              </div>
              {tree.roots.map((r) => <Branch key={r.key} node={r} parent={null} depth={0} linkFor={linkFor} onEdit={setEditLink} manage={manage} />)}
            </div></div>}
        </Panel>
        {tree.notes.length > 0 && <Note className="mt-3"><ul className="m-0 list-disc space-y-0.5 pl-4">{tree.notes.map((n) => <li key={n}>{n}</li>)}</ul></Note>}
      </Section>

      {tree.unplaced.length > 0 && (
        <Section title="Companies outside the tree">
          <Panel className="flex flex-wrap gap-2 p-3.5" lit={false}>
            {tree.unplaced.map((c) => <span key={c.id} className="chip" title="No owner and nothing owned is on record for this company"><Building2 size={11} /> {c.code} · {c.name}</span>)}
          </Panel>
        </Section>
      )}

      <Section title="Register of links">
        <Panel lit={false}>
          <DataTable columns={linkColumns} rows={links} rowKey={(l) => l.id} exportName="corporate-structure-links" initialSort={{ key: 'owner', dir: 'asc' }}
            toolbar={<span className="text-[12px] text-muted">A link that has ended stays on the register with its dates. Changing a link asks for a reason, which is kept in the history.</span>}
            empty={{ title: 'No link is recorded', body: 'The register holds holding companies, subsidiaries, associates, joint ventures, special purpose vehicles, investment entities, operating companies and branches.', icon: <GitBranch size={20} /> }} />
        </Panel>
      </Section>

      <Section title="Shareholders" right={withHolders.length > 0 ? (
        <span className="no-print flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <select className="field sm" style={{ width: 240, maxWidth: '100%' }} value={shownId} onChange={(e) => setShown(e.target.value)} aria-label="Company whose shareholders are shown">{withHolders.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <button className="btn sm" disabled={!canManageShown} title={canManageShown ? undefined : 'You need the permission investment.manage in this company'} onClick={() => setAddHolderTo(shownId)}><Plus size={13} /> Add</button>
        </span>
      ) : undefined}>
        <Panel lit={false}>
          <DataTable columns={holderColumns} rows={shownHolders} rowKey={(e) => e.id} exportName={`shareholders-${companies.find((c) => c.id === shownId)?.code ?? 'company'}`} initialSort={{ key: 'qty', dir: 'desc' }}
            footer={<tr>
              <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Total · {shownHolders.length} holder{shownHolders.length === 1 ? '' : 's'}</td>
              <td className={cx(foot, 'r num')}>{fmtQty(sum(shownHolders.map((e) => e.quantity)), shownCurrency)}</td>
              <td className={cx(foot, 'r')}><Money value={sum(shownHolders.map((e) => e.paid_up))} currency={shownCurrency} /></td>
              <td className={foot} colSpan={4} />
            </tr>}
            empty={{ title: 'No shareholder is on the register', body: 'Record the holders of the shares of a company with the class, the number of shares and the amount paid up. A dividend is declared to the holders on this register.', icon: <Users size={20} />, action: <button className="btn sm" disabled={!manage} title={noManage} onClick={() => setAddHolderTo(manageIds[0] ?? null)}><Plus size={13} /> Add a shareholder</button> }} />
        </Panel>
        <div className="mt-2 text-[11.5px] text-muted">Part of the class = shares held ÷ all shares of that class on the register of the company. It is worked out from the register; it is not a recorded figure.</div>
      </Section>

      <LinkForm open={!!editLink} link={editLink} onClose={() => setEditLink(null)} />
      <HolderForm open={!!editHolder || !!addHolderTo} holder={editHolder} companyIds={manageIds} companyId={addHolderTo ?? undefined} onClose={() => { setEditHolder(null); setAddHolderTo(null) }} />
    </div>
  )
}

function Side({ company, name }: { company: ID | null; name: string }) {
  return <span className="flex min-w-0 items-center gap-1.5">{company ? <Building2 size={13} className="flex-none text-gold" /> : <User size={13} className="flex-none text-muted" />}<span className="text-ink">{name}</span>{!company && <span className="text-[11px] text-muted">outside the group</span>}</span>
}

function Branch({ node, parent, depth, linkFor, onEdit, manage }: { node: CorpNode; parent: CorpNode | null; depth: number; linkFor: (p: CorpNode, c: CorpNode) => CorporateLink | null; onEdit: (l: CorporateLink) => void; manage: boolean }) {
  const nav = useNavigate()
  const link = parent ? linkFor(parent, node) : null
  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[12.5px] hover:bg-surface2">
        <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: depth * 22 }}>
          {depth > 0 && <span className="flex-none text-muted" aria-hidden="true">└</span>}
          {node.kind === 'company' ? <Building2 size={14} className="flex-none text-gold" /> : <User size={14} className="flex-none text-muted" />}
          {node.kind === 'party'
            ? <button className="link min-w-0 truncate text-left" onClick={() => nav('/parties/' + node.id)}>{node.name}</button>
            : <span className={cx('min-w-0 truncate', depth === 0 ? 'font-medium text-ink' : 'text-ink')}>{node.name}</span>}
          {node.relation && <span className="chip gold flex-none">{RELATION_LABEL[node.relation]}</span>}
          {depth === 0 && <span className="chip flex-none" title="No owner of this entity is on record">top of the tree</span>}
          {!node.inNumero && <span className="flex-none text-[11px] text-muted">outside the group</span>}
        </span>
        <span className="num w-[92px] flex-none text-right text-ink">{parent ? pctText(node.directPct) : ''}</span>
        <span className="num w-[80px] flex-none text-right text-ink2">{parent ? pctText(link?.voting_pct) : ''}</span>
        <span className="num w-[120px] flex-none text-right text-muted" title="The product of the direct percentages on the way down from the top">{parent ? pctText(node.effectivePct) : ''}</span>
        <span className="w-[70px] flex-none text-right">
          {link && <button className="btn sm ghost icon" disabled={!manage} title={manage ? 'Change this link' : 'You need the permission investment.manage to change the register'} aria-label={`Change the link to ${node.name}`} onClick={() => onEdit(link)}><Pencil size={13} /></button>}
        </span>
      </div>
      {link?.note && <div className="pb-1 text-[11.5px] text-muted" style={{ paddingLeft: depth * 22 + 44 }}>{link.note}</div>}
      {node.children.map((c) => <Branch key={c.key} node={c} parent={node} depth={depth + 1} linkFor={linkFor} onEdit={onEdit} manage={manage} />)}
    </div>
  )
}

const RELATIONS = Object.keys(RELATION_LABEL) as CorporateRelation[]
interface LinkDraft { parent_kind: 'company' | 'party'; parent_id: ID; child_kind: 'company' | 'party'; child_id: ID; relation: CorporateRelation; ownership_pct: string; voting_pct: string; effective_from: string; effective_to: string; note: string }

function LinkForm({ open, onClose, link }: { open: boolean; onClose: () => void; link?: CorporateLink | null }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const { act, busy } = useAction()
  const [asking, setAsking] = useState(false)
  const fresh = (): LinkDraft => ({ parent_kind: 'company', parent_id: '', child_kind: 'company', child_id: '', relation: 'subsidiary', ownership_pct: '', voting_pct: '', effective_from: today(), effective_to: '', note: '' })
  const [f, setF] = useState<LinkDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setAsking(false)
    setF(link ? {
      parent_kind: link.parent_company_id ? 'company' : 'party', parent_id: link.parent_company_id ?? link.parent_party_id ?? '', child_kind: link.child_company_id ? 'company' : 'party', child_id: link.child_company_id ?? link.child_party_id ?? '',
      relation: link.relation, ownership_pct: link.ownership_pct === null ? '' : D(link.ownership_pct).toString(), voting_pct: link.voting_pct === null ? '' : D(link.voting_pct).toString(),
      effective_from: link.effective_from ?? '', effective_to: link.effective_to ?? '', note: link.note ?? '',
    } : fresh())
  }, [open, link?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<LinkDraft>) => setF((x) => ({ ...x, ...patch }))
  const others = useAsync(async () => (open ? api.listCorporateLinks() : []), [api, open])

  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties])
  // the register is changed by a person who manages investments in the company that owns, or in the company that is owned
  const sides = [f.parent_kind === 'company' ? f.parent_id : '', f.child_kind === 'company' ? f.child_id : ''].filter(Boolean)
  const manage = sides.length ? sides.some((id) => can('investment.manage', id)) : !!useApp.getState().session?.isGroupAdmin

  // what other owners already hold of the same entity, among links with no end date
  const heldByOthers = sum((others.data ?? []).filter((l) => !l.effective_to && l.id !== link?.id && f.child_id !== '' && (f.child_kind === 'company' ? l.child_company_id === f.child_id : l.child_party_id === f.child_id)).map((l) => l.ownership_pct ?? 0))
  const problems: string[] = []
  if (!f.parent_id) problems.push('Name the owner: a company of the group, or an outside party.')
  if (!f.child_id) problems.push('Name what is owned: a company of the group, or an outside party.')
  if (f.parent_id && f.parent_kind === f.child_kind && f.parent_id === f.child_id) problems.push(f.parent_kind === 'company' ? 'A company cannot own itself.' : 'The owner and what is owned are the same party.')
  if (f.ownership_pct !== '' && D(f.ownership_pct).gt(100)) problems.push('Ownership is a percentage between 0 and 100.')
  if (f.voting_pct !== '' && D(f.voting_pct).gt(100)) problems.push('Voting is a percentage between 0 and 100.')
  if (f.ownership_pct !== '' && !f.effective_to && heldByOthers.plus(D(f.ownership_pct)).gt(100)) problems.push(`Other owners already hold ${pctText(heldByOthers)}. With this ${pctText(f.ownership_pct)} the total would exceed the whole.`)
  if (f.effective_from && f.effective_to && f.effective_to < f.effective_from) problems.push('The end date is before the start date.')

  const save = async (reason?: string) => {
    const input: CorporateLinkInput = {
      id: link?.id, parent_company_id: f.parent_kind === 'company' ? f.parent_id : null, parent_party_id: f.parent_kind === 'party' ? f.parent_id : null,
      child_company_id: f.child_kind === 'company' ? f.child_id : null, child_party_id: f.child_kind === 'party' ? f.child_id : null, relation: f.relation,
      ownership_pct: f.ownership_pct === '' ? null : f.ownership_pct, voting_pct: f.voting_pct === '' ? null : f.voting_pct, effective_from: f.effective_from || null, effective_to: f.effective_to || null, note: f.note.trim() || null, reason,
    }
    const id = await act(() => api.saveCorporateLink(input), link ? 'Link changed' : 'Link recorded')
    if (id) { setAsking(false); onClose() }
  }

  const side = (which: 'parent' | 'child', label: string) => {
    const kind = f[`${which}_kind`], value = f[`${which}_id`]
    return (
      <>
        <Field label={label}>
          <select className="field" value={kind} onChange={(e) => set({ [`${which}_kind`]: e.target.value as 'company' | 'party', [`${which}_id`]: '' } as Partial<LinkDraft>)}>
            <option value="company">A company of the group</option><option value="party">An outside party</option>
          </select>
        </Field>
        <Field label={kind === 'company' ? 'Company' : 'Party'}>
          <select className="field" value={value} onChange={(e) => set({ [`${which}_id`]: e.target.value } as Partial<LinkDraft>)}>
            <option value="">Choose…</option>
            {kind === 'company' ? companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>) : partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
          </select>
        </Field>
      </>
    )
  }

  return (
    <>
      <Modal open={open && !asking} onClose={onClose} title={link ? 'Change a link' : 'Add a link'} subtitle="Who owns what. Recording a link changes the register only; it posts nothing to the ledger." width={640}
        footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission investment.manage' : problems[0]} onClick={() => (link ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {side('parent', 'The owner is')}
          {side('child', 'What is owned is')}
          <Field label="What the owned entity is" className="sm:col-span-2" hint="To its owner, or within the group.">
            <select className="field" value={f.relation} onChange={(e) => set({ relation: e.target.value as CorporateRelation })}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select>
          </Field>
          <Field label="Ownership %" hint="Leave empty when it is not known. Holdings through a link without a percentage cannot be worked out."><input className="field num" inputMode="decimal" value={f.ownership_pct} onChange={(e) => set({ ownership_pct: digits(e.target.value) })} /></Field>
          <Field label="Voting %" hint="Where it differs from ownership."><input className="field num" inputMode="decimal" value={f.voting_pct} onChange={(e) => set({ voting_pct: digits(e.target.value) })} /></Field>
          <Field label="In force from"><input type="date" className="field" value={f.effective_from} onChange={(e) => set({ effective_from: e.target.value })} /></Field>
          <Field label="Until" hint="Set this to end a link. The link stays on the register."><input type="date" className="field" value={f.effective_to} onChange={(e) => set({ effective_to: e.target.value })} /></Field>
          <Field label="Note" className="sm:col-span-2"><textarea className="field" rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>
        {problems.length > 0 && (f.parent_id || f.child_id) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </Modal>
      <ReasonDialog open={open && asking} title="Change this link" body="The register of who owns what is being changed. The earlier values are kept in the history with your reason." confirm="Save the change" onCancel={() => setAsking(false)} onConfirm={(r) => void save(r)} />
    </>
  )
}

interface HolderDraft { company_id: ID; holder_party_id: ID; share_class: string; quantity: string; paid_up: string; note: string }

function HolderForm({ open, onClose, holder, companyIds, companyId }: { open: boolean; onClose: () => void; holder?: EquityHolder | null; companyIds: ID[]; companyId?: ID }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const partyName = usePartyName()
  const choices = useCompanyChoices(holder ? [holder.company_id] : companyIds)
  const { act, busy } = useAction()
  const [asking, setAsking] = useState(false)
  const fresh = (): HolderDraft => ({ company_id: companyId ?? choices[0]?.id ?? '', holder_party_id: '', share_class: 'Equity', quantity: '', paid_up: '', note: '' })
  const [f, setF] = useState<HolderDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setAsking(false)
    setF(holder ? { company_id: holder.company_id, holder_party_id: holder.holder_party_id, share_class: holder.share_class, quantity: D(holder.quantity).toString(), paid_up: D(holder.paid_up).toString(), note: holder.note ?? '' } : fresh())
  }, [open, holder?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<HolderDraft>) => setF((x) => ({ ...x, ...patch }))
  const register = useAsync(async () => (open && f.company_id && can('investment.view', f.company_id) ? api.listEquityHolders([f.company_id]) : []), [api, open, f.company_id])

  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties])
  const cls = f.share_class.trim() || 'Equity'
  // the register holds one line for a holder in a class: saving a second one replaces the first
  const existing = holder ?? (register.data ?? []).find((e) => e.company_id === f.company_id && e.holder_party_id === f.holder_party_id && e.share_class === cls) ?? null
  const manage = !!f.company_id && can('investment.manage', f.company_id)
  const classTotal = sum((register.data ?? []).filter((e) => e.share_class === cls && e.id !== existing?.id).map((e) => e.quantity)).plus(D(f.quantity))

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company whose shares these are.')
  if (!f.holder_party_id) problems.push('Name the holder.')
  if (f.quantity === '') problems.push('Enter the number of shares. Enter 0 for a holder who no longer holds any.')

  const save = async (reason?: string) => {
    const id = await act(() => api.saveEquityHolder({ company_id: f.company_id, holder_party_id: f.holder_party_id, share_class: cls, quantity: f.quantity, paid_up: f.paid_up || 0, note: f.note.trim() || undefined, reason }), existing ? 'Shareholding changed' : 'Shareholder recorded')
    if (id) { setAsking(false); onClose() }
  }

  return (
    <>
      <Modal open={open && !asking} onClose={onClose} title={holder ? `Change the shareholding of ${partyName(holder.holder_party_id)}` : 'Add a shareholder'} subtitle="The register of shareholders. It posts nothing to the ledger." width={600}
        footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission investment.manage in this company' : problems[0]} onClick={() => (existing ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" className="sm:col-span-2">
            <select className="field" value={f.company_id} disabled={!!holder} onChange={(e) => set({ company_id: e.target.value })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          </Field>
          <Field label="Holder">
            <select className="field" value={f.holder_party_id} disabled={!!holder} onChange={(e) => set({ holder_party_id: e.target.value })}><option value="">Choose…</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
          </Field>
          <Field label="Class of share" hint="For example Equity, or Preference."><input className="field" value={f.share_class} disabled={!!holder} onChange={(e) => set({ share_class: e.target.value })} /></Field>
          <Field label="Number of shares"><input className="field num" inputMode="decimal" value={f.quantity} onChange={(e) => set({ quantity: digits(e.target.value) })} /></Field>
          <Field label="Paid up" hint="The amount paid on these shares."><input className="field num" inputMode="decimal" value={f.paid_up} onChange={(e) => set({ paid_up: digits(e.target.value) })} /></Field>
          <Field label="Note" className="sm:col-span-2"><input className="field" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>
        {f.quantity !== '' && !classTotal.isZero() && (
          <Panel className="mt-4 p-3.5 text-[12.5px] text-ink2" lit={false}>
            Part of the class = <span className="num">{fmtQty(f.quantity)}</span> ÷ <span className="num">{fmtQty(classTotal)}</span> shares of class {cls} = <span className="num font-medium text-ink">{pctText(D(f.quantity).times(100).div(classTotal), 2)}</span>
          </Panel>
        )}
        {!holder && existing && <Note kind="warn" className="mt-4">{partyName(existing.holder_party_id)} is already on the register in class {existing.share_class} with <span className="num">{fmtQty(existing.quantity)}</span> shares. Saving replaces that figure, and asks for a reason.</Note>}
        {problems.length > 0 && (f.holder_party_id || f.quantity) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </Modal>
      <ReasonDialog open={open && asking} title="Change this shareholding" body="The register of shareholders is being changed. The earlier figures are kept in the history with your reason." confirm="Save the change" onCancel={() => setAsking(false)} onConfirm={(r) => void save(r)} />
    </>
  )
}

// =====================================================================
// Group investment map: who in the group has invested in what
// =====================================================================
interface MapRow { key: string; holding: Holding; company: string; investee: string; inGroup: boolean; carrying: Decimal; valuation: Decimal | null; beside: Decimal | null; from: string; to: string }

function MapTab({ holdings, outdated, asOf }: { holdings: Holding[]; outdated: Map<ID, Decimal>; asOf: string }) {
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const currency = useCurrency()
  const [focus, setFocus] = useState<{ from?: string; to?: string; label: string } | null>(null)

  const map = useMemo(() => investmentMap(holdings, companies, parties, asOf), [holdings, companies, parties, asOf])
  const rows: MapRow[] = useMemo(() => map.flatMap((m) => m.holdings.map((h) => ({
    key: h.holding.id, holding: h.holding, company: m.company.name, investee: h.investee, inGroup: h.inGroup, carrying: h.carrying, valuation: h.valuation, beside: h.beside,
    from: 'c:' + m.company.id, to: h.holding.investee_company_id ? 'c:' + h.holding.investee_company_id : h.holding.investee_party_id ? 'p:' + h.holding.investee_party_id : 'h:' + h.holding.id,
  }))), [map])

  const chart = useMemo(() => {
    const drawn = rows.filter((r) => r.carrying.gt(0) && r.from !== r.to)
    const names = new Map<string, string>()
    const out = new Map<string, Decimal>(), into = new Map<string, Decimal>()
    const edges = new Map<string, FlowLink>()
    for (const r of drawn) {
      names.set(r.from, r.company); names.set(r.to, r.investee)
      out.set(r.from, (out.get(r.from) ?? ZERO).plus(r.carrying)); into.set(r.to, (into.get(r.to) ?? ZERO).plus(r.carrying))
      const k = r.from + '>' + r.to
      edges.set(k, { from: r.from, to: r.to, value: (edges.get(k)?.value ?? 0) + r.carrying.toNumber() })
    }
    // a company that is itself invested in by the group stands one column to the right of its investor
    const depth = new Map<string, number>([...names.keys()].map((k) => [k, 0]))
    for (let pass = 0; pass < names.size; pass++) {
      let moved = false
      for (const e of edges.values()) {
        const want = Math.min((depth.get(e.from) ?? 0) + 1, 4)
        if ((depth.get(e.to) ?? 0) < want) { depth.set(e.to, want); moved = true }
      }
      if (!moved) break
    }
    const nodes: FlowNode[] = [...names.entries()].map(([id, label]) => {
      const col = depth.get(id) ?? 0
      return { id, label, column: col, value: (col === 0 ? out.get(id) ?? ZERO : into.get(id) ?? ZERO).toNumber(), tone: id.startsWith('c:') ? 'var(--gold)' : id.startsWith('p:') ? 'var(--cyan)' : 'var(--violet)' }
    })
    const cols = Math.max(0, ...nodes.map((n) => n.column)) + 1
    const columns = ['Company that invested', 'Invested in', 'Invested in, one level further', 'Two levels further', 'Three levels further'].slice(0, cols)
    const tallest = Math.max(1, ...columns.map((_, c) => nodes.filter((n) => n.column === c).length))
    return { nodes, links: [...edges.values()], columns, height: Math.max(320, tallest * 58 + 40) }
  }, [rows])

  const shown = focus ? rows.filter((r) => (!focus.from || r.from === focus.from) && (!focus.to || r.to === focus.to)) : rows
  const bars = map.map((m) => ({ label: m.company.code, values: [{ key: 'In companies of the group', value: m.inGroup.toNumber() }, { key: 'In outside parties and other investments', value: m.carrying.minus(m.inGroup).toNumber() }] }))

  type Entry = (typeof map)[number]
  const summaryColumns: Column<Entry>[] = [
    { key: 'company', header: 'Company that invested', render: (m) => <span><span className="num text-gold">{m.company.code}</span> <span className="text-ink">· {m.company.name}</span></span>, sort: (m) => m.company.name, csv: (m) => m.company.name },
    { key: 'n', header: 'Active holdings', align: 'right', render: (m) => <span className="num">{m.holdings.length}</span>, sort: (m) => m.holdings.length, csv: (m) => m.holdings.length },
    { key: 'carrying', header: 'Carrying amount in the books', align: 'right', render: (m) => <Money value={m.carrying} currency={m.company.base_currency} className="text-ink" />, sort: (m) => m.carrying.toNumber(), csv: (m) => m.carrying.toFixed(2) },
    { key: 'cost', header: 'Of which carried at cost', align: 'right', render: (m) => <Money value={m.atCost} currency={m.company.base_currency} dim />, sort: (m) => m.atCost.toNumber(), csv: (m) => m.atCost.toFixed(2) },
    { key: 'group', header: 'Of which in companies of the group', align: 'right', render: (m) => <Money value={m.inGroup} currency={m.company.base_currency} dim />, sort: (m) => m.inGroup.toNumber(), csv: (m) => m.inGroup.toFixed(2) },
    { key: 'nv', header: 'Holdings with no valuation on record', align: 'right', render: (m) => (m.notValued ? <span className="num text-warn">{m.notValued}</span> : <span className="num text-muted">0</span>), sort: (m) => m.notValued, csv: (m) => m.notValued },
  ]
  const rowColumns: Column<MapRow>[] = [
    { key: 'company', header: 'Company that invested', render: (r) => <span className="text-ink2">{r.company}</span>, sort: (r) => r.company, csv: (r) => r.company },
    { key: 'investee', header: 'Invested in', render: (r) => <span className="flex flex-wrap items-center gap-1.5"><span className="text-ink">{r.investee}</span>{r.inGroup && <span className="chip gold">company of the group</span>}</span>, sort: (r) => r.investee.toLowerCase(), csv: (r) => r.investee + (r.inGroup ? ' (a company of the group)' : '') },
    { key: 'holding', header: 'Investment', render: (r) => <div className="min-w-0"><div className="num text-[12px] text-gold">{r.holding.holding_no}</div><div className="text-[12.5px] text-ink2">{r.holding.name}</div></div>, sort: (r) => r.holding.holding_no, csv: (r) => `${r.holding.holding_no} ${r.holding.name}` },
    { key: 'instrument', header: 'Instrument', render: (r) => <span className="text-[12.5px] text-ink2">{INSTRUMENT_LABEL[r.holding.instrument]}</span>, sort: (r) => r.holding.instrument, csv: (r) => INSTRUMENT_LABEL[r.holding.instrument] },
    { key: 'measurement', header: 'Carried at', render: (r) => <span className={cx('chip', r.holding.measurement === 'fair_value' ? 'cyan' : '')}>{MEASUREMENT_LABEL[r.holding.measurement]}</span>, sort: (r) => r.holding.measurement, csv: (r) => MEASUREMENT_LABEL[r.holding.measurement] },
    { key: 'carrying', header: 'Carrying amount in the books', align: 'right', render: (r) => <Money value={r.carrying} currency={r.holding.currency} className="text-ink" />, sort: (r) => r.carrying.toNumber(), csv: (r) => r.carrying.toFixed(2) },
    {
      key: 'fv', header: 'Latest approved fair value', align: 'right', sort: (r) => r.valuation?.toNumber() ?? -1, csv: (r) => r.valuation?.toFixed(2) ?? '',
      render: (r) => (r.valuation === null ? <span className="text-muted">none on record</span>
        : <div><Money value={r.valuation} currency={r.holding.currency} className={outdated.has(r.key) ? 'text-ink2' : undefined} />{outdated.has(r.key) && <div className="text-[11px] text-warn" title="The quantity held has changed since this valuation. The valuation has not been restated.">of {fmtQty(outdated.get(r.key), r.holding.currency)} held then</div>}</div>),
    },
    { key: 'fvdate', header: 'Valued as of', render: (r) => (r.holding.fair_value_date ? <span className="num text-[12.5px]">{fmtDate(r.holding.fair_value_date)}</span> : <span className="text-muted">—</span>), sort: (r) => r.holding.fair_value_date ?? '', csv: (r) => r.holding.fair_value_date ?? '' },
    { key: 'beside', header: 'Difference, beside the books', align: 'right', render: (r) => (r.beside === null || outdated.has(r.key) ? <span className="text-muted">—</span> : <Money value={r.beside} currency={r.holding.currency} colored sign />), sort: (r) => (outdated.has(r.key) ? 0 : r.beside?.toNumber() ?? 0), csv: (r) => (outdated.has(r.key) ? '' : r.beside?.toFixed(2) ?? '') },
  ]

  if (!map.length) {
    return <Panel><Empty icon={<Network size={20} />} title="No active investment is shared with you" body="The map is drawn from the active investments of the selected companies: the company that invested on the left, what it invested in on the right." /></Panel>
  }

  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Carrying amount in the books" value={sum(map.map((m) => m.carrying))} currency={currency} tone="gold" sub={`${rows.length} active holding${rows.length === 1 ? '' : 's'} of ${map.length} compan${map.length === 1 ? 'y' : 'ies'}`} />
        <Stat label="Of which in companies of the group" value={sum(map.map((m) => m.inGroup))} currency={currency} sub="one company of the group invested in another" />
        <Stat label="Of which carried at cost" value={sum(map.map((m) => m.atCost))} currency={currency} sub="the books show what was paid, less any write-down" />
        <Stat label="With no valuation on record" value={map.reduce((n, m) => n + m.notValued, 0)} count tone={map.some((m) => m.notValued > 0) ? 'warn' : undefined} sub="active holdings for which no fair value has been approved" />
      </div>

      <Section title="Who has invested in what" right={<span className="text-[11.5px] text-muted">Width of a line = carrying amount in the books · select a line or a box to see its holdings</span>}>
        <Panel className="p-4" lit={false}>
          {chart.links.length > 0
            ? <FlowMap nodes={chart.nodes} links={chart.links} columns={chart.columns} height={chart.height}
              onLink={(l) => { const hit = rows.filter((r) => r.from === l.from && r.to === l.to); if (hit.length === 1) nav('/investments/holdings/' + hit[0].holding.id); else setFocus({ from: l.from, to: l.to, label: `${hit[0]?.company ?? ''} in ${hit[0]?.investee ?? ''}` }) }}
              onNode={(n) => setFocus(rows.some((r) => r.from === n.id) && n.column === 0 ? { from: n.id, label: `held by ${n.label}` } : { to: n.id, label: `in ${n.label}` })} />
            : <BarChart data={bars} stacked height={240} />}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11.5px] text-ink2">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--gold)' }} />A company of the group</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--cyan)' }} />An outside party</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--violet)' }} />An investment with no investee named</span>
          </div>
        </Panel>
        <div className="mt-2 text-[11.5px] text-muted">The map shows active investments at their carrying amount in the books. A holding whose carrying amount is nil is listed below but draws no line. Amounts in different currencies are drawn as recorded, without conversion.</div>
      </Section>

      <Section title="By company">
        <Panel lit={false}>
          <DataTable columns={summaryColumns} rows={map} rowKey={(m) => m.company.id} onRow={(m) => setFocus({ from: 'c:' + m.company.id, label: `held by ${m.company.name}` })} exportName="group-investment-map-by-company" initialSort={{ key: 'carrying', dir: 'desc' }} />
        </Panel>
      </Section>

      <Section title={focus ? `Holdings ${focus.label}` : 'Every holding on the map'} right={focus ? <button className="btn sm" onClick={() => setFocus(null)}>Showing a part — show all</button> : undefined}>
        <Panel lit={false}>
          <DataTable columns={rowColumns} rows={shown} rowKey={(r) => r.key} onRow={(r) => nav('/investments/holdings/' + r.holding.id)} exportName="group-investment-map" initialSort={{ key: 'company', dir: 'asc' }}
            footer={<tr>
              <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Total · {shown.length} holding{shown.length === 1 ? '' : 's'}</td>
              <td className={cx(foot, 'r')}><Money value={sum(shown.map((r) => r.carrying))} currency={currency} className="font-medium text-ink" /></td>
              <td className={foot} colSpan={3} />
            </tr>} />
        </Panel>
      </Section>
    </div>
  )
}

// =====================================================================
// New or edited investment — shared with the Holding 360 screen
// =====================================================================
interface HoldingDraft {
  company_id: ID; name: string; investee_kind: 'none' | 'party' | 'company'; investee_id: ID; instrument: Instrument; measurement: Holding['measurement']
  investment_account_id: ID; income_account_id: ID; gain_account_id: ID; fv_account_id: ID; fund_id: ID; confidentiality: Confidentiality; notes: string
}

export function HoldingForm({ open, onClose, holding, companyIds, funds, preset, onSaved }: { open: boolean; onClose: () => void; holding?: Holding | null; companyIds: ID[]; funds: Fund[]; preset?: { company_id: ID; fund_id: ID }; onSaved?: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const [asking, setAsking] = useState(false)

  const firstLedger = (companyId: ID) => postingLedgers(accounts, companyId, ['asset'], ['investment']).find((a) => a.subtype === 'investment')?.id ?? ''
  const fresh = (): HoldingDraft => {
    const company_id = preset?.company_id ?? choices.find((c) => can('investment.manage', c.id))?.id ?? choices[0]?.id ?? ''
    return { company_id, name: '', investee_kind: 'party', investee_id: '', instrument: 'equity', measurement: 'cost', investment_account_id: firstLedger(company_id), income_account_id: '', gain_account_id: '', fv_account_id: '', fund_id: preset?.fund_id ?? '', confidentiality: preset ? 'confidential' : 'internal', notes: '' }
  }
  const [f, setF] = useState<HoldingDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setAsking(false)
    setF(holding ? {
      company_id: holding.company_id, name: holding.name, investee_kind: holding.investee_company_id ? 'company' : holding.investee_party_id ? 'party' : 'none', investee_id: holding.investee_company_id ?? holding.investee_party_id ?? '',
      instrument: holding.instrument, measurement: holding.measurement, investment_account_id: holding.investment_account_id, income_account_id: holding.income_account_id ?? '', gain_account_id: holding.gain_account_id ?? '',
      fv_account_id: holding.fv_account_id ?? '', fund_id: holding.fund_id ?? '', confidentiality: holding.confidentiality, notes: holding.notes ?? '',
    } : fresh())
  }, [open, holding?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<HoldingDraft>) => setF((x) => ({ ...x, ...patch }))

  const carries = !!holding && (!D(holding.cost).isZero() || !D(holding.fv_adjustment).isZero())
  const assetLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['asset'], ['investment']), [accounts, f.company_id])
  const incomeLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['income'], ['other_income']), [accounts, f.company_id])
  const resultLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['income', 'expense']), [accounts, f.company_id])
  const changeLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['income', 'expense', 'equity']), [accounts, f.company_id])
  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties])
  const companyFunds = funds.filter((x) => x.company_id === f.company_id)
  const manage = !!f.company_id && can('investment.manage', f.company_id)

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company that holds the investment.')
  if (!f.name.trim()) problems.push('Give the investment a name.')
  if (f.investee_kind !== 'none' && !f.investee_id) problems.push(f.investee_kind === 'company' ? 'Choose the company of the group that is invested in.' : 'Choose the party that is invested in.')
  if (f.investee_kind === 'company' && f.investee_id === f.company_id) problems.push('The company invested in must be another company of the group.')
  if (!f.investment_account_id) problems.push('Choose the asset ledger that carries this investment.')

  const save = async (reason?: string) => {
    const input: HoldingInput = {
      id: holding?.id, company_id: f.company_id, name: f.name.trim(), investee_party_id: f.investee_kind === 'party' ? f.investee_id : null, investee_company_id: f.investee_kind === 'company' ? f.investee_id : null,
      instrument: f.instrument, measurement: f.measurement, investment_account_id: f.investment_account_id, income_account_id: f.income_account_id || null, gain_account_id: f.gain_account_id || null, fv_account_id: f.fv_account_id || null,
      org_unit_id: holding?.org_unit_id ?? null, fund_id: f.fund_id || null, confidentiality: f.confidentiality, notes: f.notes.trim() || null, reason,
    }
    const id = await act(() => api.saveHolding(input), holding ? 'Investment changed' : 'Investment recorded — nothing has been bought yet')
    if (id) { setAsking(false); onClose(); onSaved?.(id) }
  }
  const ledgerOptions = (list: Account[]) => list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)

  return (
    <>
      <Drawer open={open} onClose={onClose} width={660} title={holding ? `Change ${holding.holding_no}` : 'New investment'} subtitle="Saving records the investment. It posts nothing to the ledger: a purchase does, once it is approved."
        footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission investment.manage in this company' : problems[0]} onClick={() => (holding ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
        {carries && <Note kind="warn" className="mb-4">This investment carries a balance. Its asset ledger and the way it is measured cannot change while it does.</Note>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company that holds the investment" className="sm:col-span-2">
            <select className="field" value={f.company_id} disabled={!!holding} onChange={(e) => set({ company_id: e.target.value, investment_account_id: firstLedger(e.target.value), income_account_id: '', gain_account_id: '', fv_account_id: '', fund_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          </Field>
          <Field label="Name" className="sm:col-span-2" hint="As it should read in lists, for example the investee and the stake held."><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Invested in">
            <select className="field" value={f.investee_kind} onChange={(e) => set({ investee_kind: e.target.value as HoldingDraft['investee_kind'], investee_id: '' })}>
              <option value="party">An outside party</option><option value="company">A company of the group</option><option value="none">No single investee, for example a portfolio</option>
            </select>
          </Field>
          {f.investee_kind !== 'none' && (
            <Field label={f.investee_kind === 'company' ? 'Company of the group' : 'Party'}>
              <select className="field" value={f.investee_id} onChange={(e) => set({ investee_id: e.target.value })}>
                <option value="">Choose…</option>
                {f.investee_kind === 'company' ? companies.filter((c) => c.id !== f.company_id).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>) : partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
              </select>
            </Field>
          )}
          <Field label="Instrument"><select className="field" value={f.instrument} onChange={(e) => set({ instrument: e.target.value as Instrument })}>{(Object.keys(INSTRUMENT_LABEL) as Instrument[]).map((k) => <option key={k} value={k}>{INSTRUMENT_LABEL[k]}</option>)}</select></Field>
          <Field label="Carried in the books at" hint={f.measurement === 'cost' ? 'The books show what was paid. A valuation is kept beside the books and posts nothing.' : 'A valuation proposes an entry for the change in fair value.'}>
            <select className="field" value={f.measurement} disabled={carries} onChange={(e) => set({ measurement: e.target.value as Holding['measurement'] })}><option value="cost">Cost</option><option value="fair_value">Fair value</option></select>
          </Field>
          <Field label="Asset ledger that carries the investment" className="sm:col-span-2" hint={assetLedgers.length ? undefined : 'This company has no asset ledger to post to.'}>
            <select className="field" value={f.investment_account_id} disabled={carries} onChange={(e) => set({ investment_account_id: e.target.value })}><option value="">Choose…</option>{ledgerOptions(assetLedgers)}</select>
          </Field>
          <Field label="Income ledger (optional)" hint="Dividends, interest and distributions received. When empty, the ledger set for income from investments in the account map is used.">
            <select className="field" value={f.income_account_id} onChange={(e) => set({ income_account_id: e.target.value })}><option value="">From the account map</option>{ledgerOptions(incomeLedgers)}</select>
          </Field>
          <Field label="Gain or loss ledger (optional)" hint="Gain or loss on sale, and write-downs. When empty, the account map is used.">
            <select className="field" value={f.gain_account_id} onChange={(e) => set({ gain_account_id: e.target.value })}><option value="">From the account map</option>{ledgerOptions(resultLedgers)}</select>
          </Field>
          <Field label="Fair value ledger (optional)" hint="Changes in fair value of a holding carried at fair value. When empty, the account map is used.">
            <select className="field" value={f.fv_account_id} onChange={(e) => set({ fv_account_id: e.target.value })}><option value="">From the account map</option>{ledgerOptions(changeLedgers)}</select>
          </Field>
          <Field label="Fund (optional)" hint={companyFunds.length ? 'When the investment belongs to the portfolio of a fund of this company.' : 'No fund of this company is shared with you.'}>
            <select className="field" value={f.fund_id} onChange={(e) => set({ fund_id: e.target.value })}><option value="">Not part of a fund</option>{companyFunds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
          <Field label="Confidentiality" hint="People without clearance for the chosen level do not receive this record. You can choose only a level you are cleared for.">
            <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
          </Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        {problems.length > 0 && f.name && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </Drawer>
      <ReasonDialog open={open && asking} title="Change this investment" body="The record of the investment is being changed. The earlier values are kept in the history with your reason. Amounts in the books are not changed by this." confirm="Save the change" onCancel={() => setAsking(false)} onConfirm={(r) => void save(r)} />
    </>
  )
}

// =====================================================================
// New or edited fund — shared with the Fund 360 screen
// =====================================================================
interface FundDraft {
  company_id: ID; name: string; scheme: string; structure: Fund['structure']; manager_party_id: ID; unit_face_value: string; fee_pct: string; fee_basis: Fund['fee_basis']
  capital_account_id: ID; commitment_period_end: string; term_end: string; status: Fund['status']; confidentiality: Confidentiality; notes: string
}

export function FundForm({ open, onClose, fund, companyIds, onSaved }: { open: boolean; onClose: () => void; fund?: Fund | null; companyIds: ID[]; onSaved?: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const [asking, setAsking] = useState(false)

  const fresh = (): FundDraft => {
    const company_id = choices.find((c) => can('investment.manage', c.id))?.id ?? choices[0]?.id ?? ''
    return { company_id, name: '', scheme: '', structure: 'aif_cat2', manager_party_id: '', unit_face_value: '100', fee_pct: '', fee_basis: 'committed', capital_account_id: '', commitment_period_end: '', term_end: '', status: 'forming', confidentiality: 'confidential', notes: '' }
  }
  const [f, setF] = useState<FundDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setAsking(false)
    setF(fund ? {
      company_id: fund.company_id, name: fund.name, scheme: fund.scheme ?? '', structure: fund.structure, manager_party_id: fund.manager_party_id ?? '', unit_face_value: D(fund.unit_face_value).toString(), fee_pct: fund.fee_pct === null ? '' : D(fund.fee_pct).toString(),
      fee_basis: fund.fee_basis, capital_account_id: fund.capital_account_id, commitment_period_end: fund.commitment_period_end ?? '', term_end: fund.term_end ?? '', status: fund.status, confidentiality: fund.confidentiality, notes: fund.notes ?? '',
    } : fresh())
  }, [open, fund?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<FundDraft>) => setF((x) => ({ ...x, ...patch }))

  const issued = !!fund && !D(fund.units_outstanding).isZero()
  const equityLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['equity']), [accounts, f.company_id])
  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties])
  const manage = !!f.company_id && can('investment.manage', f.company_id)

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company that keeps the books of the fund.')
  if (!f.name.trim()) problems.push('Give the fund a name.')
  if (D(f.unit_face_value).lte(0)) problems.push('Enter the face value of a unit.')
  if (f.fee_pct !== '' && D(f.fee_pct).gte(100)) problems.push('The management fee is a percentage a year.')
  if (!f.capital_account_id) problems.push('Choose the equity ledger that carries the capital of the investors.')
  if (f.commitment_period_end && f.term_end && f.term_end < f.commitment_period_end) problems.push('The term of the fund ends before its commitment period.')

  const save = async (reason?: string) => {
    const input: FundInput = {
      id: fund?.id, company_id: f.company_id, name: f.name.trim(), scheme: f.scheme.trim() || null, structure: f.structure, manager_party_id: f.manager_party_id || null, unit_face_value: f.unit_face_value, fee_pct: f.fee_pct === '' ? null : f.fee_pct,
      fee_basis: f.fee_basis, capital_account_id: f.capital_account_id, commitment_period_end: f.commitment_period_end || null, term_end: f.term_end || null, status: f.status, confidentiality: f.confidentiality, notes: f.notes.trim() || null, reason,
    }
    const id = await act(() => api.saveFund(input), fund ? 'Fund changed' : 'Fund recorded')
    if (id) { setAsking(false); onClose(); onSaved?.(id) }
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} width={660} title={fund ? `Change ${fund.name}` : 'New fund'} subtitle="Saving records the fund. It posts nothing to the ledger."
        footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission investment.manage in this company' : problems[0]} onClick={() => (fund ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
        {issued && <Note kind="warn" className="mb-4">Units of this fund have been issued. Its capital ledger can no longer change.</Note>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company that keeps the books of the fund" className="sm:col-span-2" hint="The net asset value is worked out from the books of this company. Give each fund a company of its own.">
            <select className="field" value={f.company_id} disabled={!!fund} onChange={(e) => set({ company_id: e.target.value, capital_account_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          </Field>
          <Field label="Name"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Scheme"><input className="field" value={f.scheme} onChange={(e) => set({ scheme: e.target.value })} /></Field>
          <Field label="Structure"><select className="field" value={f.structure} onChange={(e) => set({ structure: e.target.value as Fund['structure'] })}>{(Object.keys(STRUCTURE_LABEL) as Fund['structure'][]).map((k) => <option key={k} value={k}>{STRUCTURE_LABEL[k]}</option>)}</select></Field>
          <Field label="Manager" hint="The party to whom the management fee is owed.">
            <select className="field" value={f.manager_party_id} onChange={(e) => set({ manager_party_id: e.target.value })}><option value="">Not named</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
          </Field>
          <Field label="Face value of a unit" hint={fund ? 'Set when the fund was recorded. Each capital call states the price at which its units are issued.' : 'The price of a unit unless a capital call states another.'}>
            <input className="field num" inputMode="decimal" value={f.unit_face_value} disabled={!!fund} onChange={(e) => set({ unit_face_value: digits(e.target.value) })} />
          </Field>
          <Field label="Status"><select className="field" value={f.status} onChange={(e) => set({ status: e.target.value as Fund['status'] })}>{FUND_STATUS.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></Field>
          <Field label="Management fee, % a year" hint="Leave empty when the fund charges none."><input className="field num" inputMode="decimal" value={f.fee_pct} onChange={(e) => set({ fee_pct: digits(e.target.value) })} /></Field>
          <Field label="The fee is charged on" hint="Fee = this amount × rate × days ÷ 365.">
            <select className="field" value={f.fee_basis} onChange={(e) => set({ fee_basis: e.target.value as Fund['fee_basis'] })}>{(Object.keys(FEE_BASIS_LABEL) as Fund['fee_basis'][]).map((k) => <option key={k} value={k}>{FEE_BASIS_LABEL[k]}</option>)}</select>
          </Field>
          <Field label="Equity ledger that carries the capital of the investors" className="sm:col-span-2" hint={equityLedgers.length ? undefined : 'This company has no equity ledger to post to.'}>
            <select className="field" value={f.capital_account_id} disabled={issued} onChange={(e) => set({ capital_account_id: e.target.value })}><option value="">Choose…</option>{equityLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
          </Field>
          <Field label="Commitment period ends"><input type="date" className="field" value={f.commitment_period_end} onChange={(e) => set({ commitment_period_end: e.target.value })} /></Field>
          <Field label="Term of the fund ends"><input type="date" className="field" value={f.term_end} onChange={(e) => set({ term_end: e.target.value })} /></Field>
          <Field label="Confidentiality" className="sm:col-span-2" hint="A fund is confidential unless you choose otherwise. People without clearance for the chosen level do not receive the fund, its investors or its figures. You can choose only a level you are cleared for.">
            <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
          </Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        {problems.length > 0 && f.name && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </Drawer>
      <ReasonDialog open={open && asking} title="Change this fund" body="The record of the fund is being changed. The earlier values are kept in the history with your reason." confirm="Save the change" onCancel={() => setAsking(false)} onConfirm={(r) => void save(r)} />
    </>
  )
}

// =====================================================================
// Declaration of a dividend or a distribution — shared with Distribution 360
// =====================================================================
interface DistDraft { company_id: ID; fund_id: ID; kind: Distribution['kind']; declaration_date: string; record_date: string; payment_date: string; total_amount: string; tax_pct: string; source_account_id: ID; notes: string }

export function DistributionForm({ open, onClose, distribution, companyIds, funds, onSaved }: { open: boolean; onClose: () => void; distribution?: Distribution | null; companyIds: ID[]; funds: Fund[]; onSaved?: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const choices = useCompanyChoices(companyIds)
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const companies = useApp((s) => s.companies)

  const fresh = (): DistDraft => {
    const company_id = choices.find((c) => can('investment.manage', c.id))?.id ?? choices[0]?.id ?? ''
    return { company_id, fund_id: '', kind: 'dividend', declaration_date: today(), record_date: today(), payment_date: '', total_amount: '', tax_pct: '', source_account_id: '', notes: '' }
  }
  const [f, setF] = useState<DistDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setF(distribution ? {
      company_id: distribution.company_id, fund_id: distribution.fund_id ?? '', kind: distribution.kind, declaration_date: distribution.declaration_date, record_date: distribution.record_date, payment_date: distribution.payment_date ?? '',
      total_amount: D(distribution.total_amount).toString(), tax_pct: D(distribution.tax_pct).isZero() ? '' : D(distribution.tax_pct).toString(), source_account_id: distribution.source_account_id, notes: distribution.notes ?? '',
    } : fresh())
  }, [open, distribution?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<DistDraft>) => setF((x) => ({ ...x, ...patch }))

  const companyFunds = funds.filter((x) => x.company_id === f.company_id)
  const ccy = companyFunds.find((x) => x.id === f.fund_id)?.currency ?? companies.find((c) => c.id === f.company_id)?.base_currency
  const equityLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['equity']), [accounts, f.company_id])
  const manage = !!f.company_id && can('investment.manage', f.company_id)

  // who holds shares or units on the record date: the same rule the declaration applies when it is saved
  const entitled = useAsync(async () => {
    if (!open || !f.company_id || !f.record_date || !can('investment.view', f.company_id)) return null
    if (f.fund_id) {
      const [allotments, commitments] = await Promise.all([api.listUnitAllotments(f.fund_id), api.listCommitments({ fundId: f.fund_id, companyIds: [f.company_id] })])
      const held = commitments.map((c) => sum(allotments.filter((u) => u.commitment_id === c.id && u.status === 'posted' && u.allot_date <= f.record_date).map((u) => u.units))).filter((u) => u.gt(0))
      return { holders: held.length, units: sum(held) }
    }
    const held = new Map<ID, Decimal>()
    for (const e of await api.listEquityHolders([f.company_id])) held.set(e.holder_party_id, (held.get(e.holder_party_id) ?? ZERO).plus(e.quantity))
    const some = [...held.values()].filter((u) => u.gt(0))
    return { holders: some.length, units: sum(some) }
  }, [api, open, f.company_id, f.fund_id, f.record_date])

  const total = D(f.total_amount), taxPct = D(f.tax_pct)
  const tax = total.times(taxPct).div(100).toDecimalPlaces(2)
  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company.')
  if (!f.fund_id && f.kind !== 'dividend') problems.push('A distribution or a return of capital belongs to a fund. A company declares a dividend.')
  if (!f.declaration_date || !f.record_date) problems.push('The date of declaration and the record date are required.')
  if (total.lte(0)) problems.push('Enter the total amount declared.')
  if (taxPct.gte(100)) problems.push('The rate of tax deducted is a percentage below 100.')
  if (!f.source_account_id) problems.push('Choose the equity ledger the amount is paid out of.')
  if (entitled.data && entitled.data.holders === 0) problems.push(f.fund_id ? 'Nobody holds units of this fund on the record date, so nobody is entitled. Units are issued when money received on a capital call is approved.' : 'Nobody holds shares of this company on the register, so nobody is entitled. Record the shareholders under Corporate structure first.')

  const save = async () => {
    const input: DistributionInput = {
      id: distribution?.id, company_id: f.company_id, fund_id: f.fund_id || null, kind: f.kind, declaration_date: f.declaration_date, record_date: f.record_date, payment_date: f.payment_date || undefined,
      total_amount: f.total_amount, tax_pct: f.tax_pct || 0, source_account_id: f.source_account_id, notes: f.notes.trim() || undefined,
    }
    const id = await act(() => api.saveDistribution(input), distribution ? 'Draft changed — entitlements worked out again' : 'Saved as a draft — nothing has been declared yet')
    if (id) { onClose(); onSaved?.(id) }
  }
  const what: ReactNode = f.fund_id ? 'units' : 'shares'

  return (
    <Drawer open={open} onClose={onClose} width={660} title={distribution ? `Change ${distribution.dist_no}` : 'Declare a dividend or a distribution'} subtitle="Saving keeps a draft. A draft declares nothing and pays nothing."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission investment.manage in this company' : problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save the draft</button></>}>
      <Note className="mb-4">
        <div>A company declares a dividend to its shareholders on record: the holders on its register of shareholders, in proportion to the shares they hold.</div>
        <div className="mt-1">A fund declares a distribution to its unit holders, in proportion to the units each held on the record date.</div>
        <div className="mt-1 font-medium text-ink">Declaring pays nothing.</div>
        <div>The draft is submitted and approved by a second person. Approval proposes the entry of the declaration. Payment to each holder is recorded afterwards, and each payment proposes its own entry.</div>
      </Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2">
          <select className="field" value={f.company_id} disabled={!!distribution} onChange={(e) => set({ company_id: e.target.value, fund_id: '', kind: 'dividend', source_account_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        </Field>
        <Field label="Declared by" hint={companyFunds.length ? undefined : 'No fund of this company is shared with you.'}>
          <select className="field" value={f.fund_id} onChange={(e) => set({ fund_id: e.target.value, kind: e.target.value ? (f.kind === 'dividend' ? 'distribution' : f.kind) : 'dividend' })}>
            <option value="">The company, to its shareholders</option>{companyFunds.map((x) => <option key={x.id} value={x.id}>{x.name}, to its unit holders</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className="field" value={f.kind} onChange={(e) => set({ kind: e.target.value as Distribution['kind'] })}>
            {(Object.keys(DIST_KIND_LABEL) as Distribution['kind'][]).filter((k) => f.fund_id || k === 'dividend').map((k) => <option key={k} value={k}>{DIST_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Date of declaration"><input type="date" className="field" value={f.declaration_date} onChange={(e) => set({ declaration_date: e.target.value })} /></Field>
        <Field label="Record date" hint={`Whoever holds ${f.fund_id ? 'units' : 'shares'} on this date is entitled.`}><input type="date" className="field" value={f.record_date} onChange={(e) => set({ record_date: e.target.value })} /></Field>
        <Field label="Payment date (optional)" hint="The date payment is intended. Payment is recorded separately when it is made."><input type="date" className="field" value={f.payment_date} onChange={(e) => set({ payment_date: e.target.value })} /></Field>
        <Field label="Total amount declared" hint="Before tax deducted."><input className="field num" inputMode="decimal" value={f.total_amount} onChange={(e) => set({ total_amount: digits(e.target.value) })} /></Field>
        <Field label="Rate of tax deducted, %" hint="Leave empty when no tax is deducted. The rate is what you enter: NUMERO does not decide which rate applies."><input className="field num" inputMode="decimal" value={f.tax_pct} onChange={(e) => set({ tax_pct: digits(e.target.value) })} /></Field>
        <Field label="Equity ledger it is paid out of" hint={equityLedgers.length ? 'For example retained earnings, or the distributable surplus of the fund.' : 'This company has no equity ledger to post to.'}>
          <select className="field" value={f.source_account_id} onChange={(e) => set({ source_account_id: e.target.value })}><option value="">Choose…</option>{equityLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>

      <Panel className="mt-4 space-y-1.5 p-3.5 text-[12.5px] text-ink2" lit={false}>
        <div className="eyebrow">What the draft will hold</div>
        <div>
          {entitled.loading ? 'Reading who is entitled…'
            : entitled.error ? `Who is entitled could not be read: ${entitled.error}`
            : entitled.data ? <><span className="num text-ink">{entitled.data.holders}</span> holder{entitled.data.holders === 1 ? '' : 's'} with <span className="num text-ink">{fmtQty(entitled.data.units)}</span> {what} {f.fund_id ? `on ${fmtDate(f.record_date)}` : 'on the register as it stands'}{f.company_id ? ` · ${companyName(f.company_id)}` : ''}</>
            : 'Choose the company and the record date to see who is entitled.'}
        </div>
        {total.gt(0) && <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Declared</span><Money value={total} currency={ccy} /><span>− tax deducted at {pctText(taxPct)}</span><Money value={tax} currency={ccy} /><span>= payable to holders</span><Money value={total.minus(tax)} currency={ccy} className="font-medium text-ink" /></div>}
        {total.gt(0) && entitled.data && entitled.data.units.gt(0) && <div className="text-[11.5px] text-muted">Each holder: declared amount × {what} held ÷ {fmtQty(entitled.data.units)}, which is <span className="num">{total.div(entitled.data.units).toDecimalPlaces(6).toString()}</span> for each {f.fund_id ? 'unit' : 'share'}. Tax is deducted from each holder at the same rate.</div>}
        {f.source_account_id && <div className="text-[11.5px] text-muted">On approval the entry proposed will debit {accountName(f.source_account_id)} and credit what is owed to each holder.</div>}
      </Panel>
      {problems.length > 0 && f.total_amount && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}
