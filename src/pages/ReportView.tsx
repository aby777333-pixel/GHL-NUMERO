import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, ChevronDown, ChevronRight, Download, Printer, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { useApp, useCurrency, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { Account, ID, Invoice, LedgerLine } from '@/engine/types'
import { DEFAULT_BUCKETS, intercompanyEliminations, joinBalances, profitAndLoss, balanceSheet, ratios, isCash, type AccountBal, type ReportLine } from '@/engine/reports'
import { ageingTotals, balancesAsOf, downloadCsv, ledgerLink, openDocuments, statements, sumBase } from '@/lib/data'
import { D, fmtPct, pctChange, sum, ZERO } from '@/lib/money'
import { daysBetween, fmtDate, previousPeriod, today } from '@/lib/dates'
import { cx, Delta, Empty, ErrorBox, Explain, Loading, Money, Note, PageHeader, Panel, Section, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, Donut, colorAt } from '@/ui/charts'
import { RealityNote } from '@/ui/RealityNote'

const TITLES: Record<string, [string, string]> = {
  pnl: ['Profit & Loss', 'Financial statement'], 'balance-sheet': ['Balance Sheet', 'Financial statement'], 'cash-flow': ['Cash Flow Statement', 'Financial statement'],
  'trial-balance': ['Trial Balance', 'Financial statement'], consolidated: ['Group Consolidation', 'Group'], ratios: ['Financial Health', 'Transparent indicators'],
  'money-went': ['Where did the money go?', 'Expenditure'], 'money-came': ['Where did the money come from?', 'Income'], ageing: ['Ageing Analysis', 'Receivables & payables'],
  'cash-book': ['Cash Book & Bank Book', 'Register'], registers: ['Sales & Purchase Registers', 'Register'],
}

function useRange() {
  const [sp] = useSearchParams()
  const period = usePeriod()
  const asOf = useApp((s) => s.asOf)
  const knownAt = useApp((s) => s.knownAt)
  const to = asOf ?? sp.get('to') ?? (period.to > today() ? today() : period.to)
  let from = sp.get('from') ?? period.from
  if (from > to) from = to.slice(0, 8) + '01'
  return { from, to, knownAt, label: sp.get('from') ? 'Selected range' : period.label, period }
}

export default function ReportView() {
  const { key = 'pnl' } = useParams()
  const nav = useNavigate()
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const askNumi = useApp((s) => s.askNumi)
  const ids = useScopeIds()
  const currency = useCurrency()
  const r = useRange()
  const [title, eyebrow] = TITLES[key] ?? ['Report', 'Report']
  const names = ids.length === companies.filter((c) => c.status === 'active').length ? 'All companies' : ids.map((i) => companies.find((c) => c.id === i)?.name).join(', ')
  const pointInTime = key === 'balance-sheet' || key === 'ageing' || key === 'consolidated'

  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} truth={mode === 'demo' ? 'DEMO' : 'ACTUAL'}
        subtitle={<>{names} · {pointInTime ? <>as at {fmtDate(r.to)}</> : <>{r.label}: {fmtDate(r.from)} – {fmtDate(r.to)}</>} · figures in {currency} · source: posted ledger entries</>}
        actions={<>
          <button className="btn ghost" onClick={() => nav('/reports')}><ArrowLeft size={15} /> Reports</button>
          <button className="btn" onClick={() => askNumi(key === 'pnl' ? 'Why did expenses increase?' : key === 'balance-sheet' ? 'Explain this balance sheet in simple English' : key === 'cash-flow' ? 'Which company is consuming the most cash?' : 'Are the books balanced?')}><Sparkles size={15} className="text-gold" /> Explain with NUMI</button>
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </>} />
      <RealityNote report={key} from={pointInTime ? undefined : r.from} to={r.to} />
      {key === 'pnl' && <PnL />}
      {key === 'balance-sheet' && <BalanceSheetView />}
      {key === 'cash-flow' && <CashFlowView />}
      {key === 'trial-balance' && <TrialBalanceView />}
      {key === 'consolidated' && <Consolidated />}
      {key === 'ratios' && <Ratios />}
      {(key === 'money-went' || key === 'money-came') && <MoneyFlow side={key === 'money-went' ? 'expense' : 'income'} />}
      {key === 'ageing' && <Ageing />}
      {key === 'cash-book' && <CashBook />}
      {key === 'registers' && <Registers />}
      {!TITLES[key] && <Panel><Empty title="Report not found" body="Choose a report from the library." /></Panel>}
    </div>
  )
}

// ------------------------------------------------------------------ shared statement renderer
interface StatementProps { lines: ReportLine[]; prior?: Map<string, Decimal>; base?: Decimal; from?: string; to: string; csvName: string; priorLabel?: string; baseLabel?: string }
function flatten(lines: ReportLine[]): ReportLine[] { return lines.flatMap((l) => [l, ...(l.children ?? [])]) }
const priorMap = (lines: ReportLine[]) => new Map(flatten(lines).map((l) => [l.key, l.amount]))

function Statement({ lines, prior, base, from, to, csvName, priorLabel = 'Previous period', baseLabel }: StatementProps) {
  const nav = useNavigate()
  const mode = useApp((s) => s.mode)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (k: string) => open[k] ?? true
  const pct = (v: Decimal) => (base && !base.isZero() ? fmtPct(v.div(base).times(100)) : '')
  const drill = (l: ReportLine) => { if (l.accountIds.length) nav(ledgerLink({ accounts: [...new Set(l.accountIds)], from, to })) }

  const exportCsv = () => {
    const rows = flatten(lines).map((l) => [l.kind === 'account' || l.level === 1 ? '    ' + (l.code ? l.code + ' ' : '') + l.label : l.label, l.amount.toFixed(2), prior ? (prior.get(l.key) ?? ZERO).toFixed(2) : '', l.formula ?? ''])
    downloadCsv(csvName + (mode === 'demo' ? '-DEMO' : ''), ['Line', 'Amount', priorLabel, 'Formula'], rows)
  }

  const row = (l: ReportLine, child = false): ReactNode => {
    const p = prior?.get(l.key)
    const strong = l.kind === 'subtotal' || l.kind === 'total'
    const section = l.kind === 'section'
    return (
      <tr key={l.key + (child ? 'c' : '')} className={cx(strong && 'bg-[color-mix(in_srgb,var(--gold)_6%,transparent)]', l.kind === 'total' && 'text-[14px]')}>
        <td style={{ paddingLeft: child ? 44 : 14 }}>
          <div className="flex items-center gap-2">
            {section && l.children!.length > 0 && <button className="btn ghost icon sm no-print -ml-1" style={{ width: 22, height: 22 }} onClick={() => setOpen({ ...open, [l.key]: !isOpen(l.key) })} aria-label={isOpen(l.key) ? 'Collapse' : 'Expand'} aria-expanded={isOpen(l.key)}>{isOpen(l.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
            {child && l.code && <span className="num text-[11px] text-muted">{l.code}</span>}
            <span className={cx(strong ? 'font-semibold text-ink' : section ? 'font-medium text-ink' : 'text-ink2', l.accountIds.length > 0 && 'drill')} onClick={() => drill(l)}>{l.label}</span>
            {(l.explain || l.formula) && <Explain title={l.label} text={l.explain} formula={l.formula} inputs={[{ label: l.label, value: l.amount }]} />}
          </div>
        </td>
        <td className="r"><span className={cx(l.accountIds.length > 0 && 'cursor-pointer')} onClick={() => drill(l)}><Money value={l.amount} className={cx(strong && 'font-semibold', strong && l.amount.lt(0) && 'text-neg')} dim /></span></td>
        {base && <td className="r num text-[12px] text-muted">{pct(l.amount)}</td>}
        {prior && <td className="r"><Money value={p ?? ZERO} className="text-ink2" dim /></td>}
        {prior && <td className="r"><Money value={l.amount.minus(p ?? ZERO)} sign className="text-ink2" dim /></td>}
        {prior && <td className="r">{p !== undefined && <Delta value={pctChange(l.amount, p)} invert={/cost|expense|finance|depreciation|exceptional|tax|payable|borrowing|liabilit/i.test(l.label)} />}</td>}
      </tr>
    )
  }

  return (
    <Panel lit={false} className="overflow-hidden">
      <div className="no-print flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[12px] text-muted"><span>Click any figure to see the transactions behind it.</span></div>
        <div className="flex gap-1.5">
          <button className="btn sm ghost" onClick={() => setOpen(Object.fromEntries(lines.map((l) => [l.key, false])))}>Collapse all</button>
          <button className="btn sm ghost" onClick={() => setOpen({})}>Expand all</button>
          <button className="btn sm ghost" onClick={exportCsv}><Download size={13} /> Export CSV</button>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="table">
          <thead><tr><th>Line</th><th className="r" style={{ width: 170 }}>Amount</th>{base && <th className="r" style={{ width: 90 }} title={baseLabel}>% {baseLabel}</th>}{prior && <><th className="r" style={{ width: 170 }}>{priorLabel}</th><th className="r" style={{ width: 160 }}>Change</th><th className="r" style={{ width: 100 }}>%</th></>}</tr></thead>
          <tbody>{lines.flatMap((l) => [row(l), ...(l.kind === 'section' && isOpen(l.key) ? l.children!.map((c) => row(c, true)) : [])])}</tbody>
        </table>
      </div>
    </Panel>
  )
}

function useStatements(prev = false) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const r = useRange()
  const accs = accounts.filter((a) => ids.includes(a.company_id))
  const res = useAsync(async () => {
    const now = await statements(api, companies, accs, ids, r.from, r.to, r.knownAt)
    if (!prev) return { now, was: null, prevRange: null }
    const prevRange = previousPeriod({ key: 'custom', from: r.from, to: r.to, label: '' })
    return { now, was: await statements(api, companies, accs, ids, prevRange.from, prevRange.to, r.knownAt), prevRange }
  }, [api, ids.join(','), r.from, r.to, r.knownAt, prev, accounts.length])
  return { ...res, range: r, accs }
}

const Wrap = ({ res, children }: { res: { error: string | null; data: unknown; reload: () => void }; children: ReactNode }) =>
  res.error ? <ErrorBox message={res.error} retry={res.reload} /> : !res.data ? <Panel><Loading rows={9} /></Panel> : <>{children}</>

const Provisional = ({ from, to }: { from: string; to: string }) => {
  const api = useApp((s) => s.api)!
  const ids = useScopeIds()
  const p = useAsync(() => api.listPeriods(ids), [api, ids.join(',')])
  const open = (p.data ?? []).filter((x) => x.period_end >= from && x.period_start <= to && x.status !== 'locked')
  const months = Math.max(1, Math.round(daysBetween(from, to) / 30))
  if (!p.data) return null
  const locked = (p.data ?? []).filter((x) => x.period_end >= from && x.period_start <= to && x.status === 'locked').length
  return open.length || locked < months * ids.length
    ? <Note kind="warn" className="mb-4"><b>PROVISIONAL</b> — one or more accounting periods in this range are not yet locked, so these figures can still change.</Note>
    : <Note kind="good" className="mb-4"><b>FINAL</b> — every accounting period in this range is locked.</Note>
}

// ------------------------------------------------------------------ P&L
function PnL() {
  const [compare, setCompare] = useState(true)
  const [common, setCommon] = useState(false)
  const s = useStatements(compare)
  const d = s.data
  return (
    <Wrap res={s}>
      {d && <>
        <Provisional from={s.range.from} to={s.range.to} />
        <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {([['Revenue', d.now.pl.revenue, d.was?.pl.revenue, false], ['Gross profit', d.now.pl.grossProfit, d.was?.pl.grossProfit, false], ['Operating profit', d.now.pl.operatingProfit, d.was?.pl.operatingProfit, false], ['Total expense', d.now.pl.totalExpense, d.was?.pl.totalExpense, true], ['Profit after tax', d.now.pl.pat, d.was?.pl.pat, false]] as const).map(([l, v, p, inv]) => (
            <Panel key={l} className="p-4" lit={false}>
              <div className="eyebrow">{l}</div>
              <div className="mt-1.5 text-[19px]"><Money value={v} compact className={cx(l === 'Profit after tax' && (v.lt(0) ? 'text-neg' : 'text-pos'))} /></div>
              <div className="mt-1.5 h-[22px]">{p !== undefined && <Delta value={pctChange(v, p)} invert={inv} />}</div>
            </Panel>
          ))}
        </div>
        <div className="no-print mb-3 flex flex-wrap items-center gap-4 text-[12.5px] text-ink2">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--gold)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with the previous period{d.prevRange && compare ? ` (${fmtDate(d.prevRange.from)} – ${fmtDate(d.prevRange.to)})` : ''}</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--gold)]" checked={common} onChange={(e) => setCommon(e.target.checked)} /> Common-size (each line as % of revenue)</label>
        </div>
        <Statement lines={d.now.pl.lines} prior={d.was ? priorMap(d.was.pl.lines) : undefined} base={common ? d.now.pl.revenue : undefined} baseLabel="of revenue" from={s.range.from} to={s.range.to} csvName="profit-and-loss" />
      </>}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Balance sheet
function BalanceSheetView() {
  const [common, setCommon] = useState(false)
  const s = useStatements(false)
  const d = s.data
  const bs = d?.now.bs
  const total = (key: string, label: string, amount: Decimal, formula: string): ReportLine => ({ key, label, amount, accountIds: [], kind: 'total', level: 0, formula })
  return (
    <Wrap res={s}>
      {bs && <>
        <Panel className="mb-4 p-4" lit={false} attention={!bs.balanced}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <span className={bs.balanced ? 'text-pos' : 'text-neg'}>{bs.balanced ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}</span>
              <div><div className="eyebrow">Balance sheet equation</div><div className={cx('display text-[15px] font-medium', bs.balanced ? 'text-pos' : 'text-neg')}>{bs.balanced ? 'Assets = Liabilities + Equity' : 'CRITICAL: the equation does not hold'}</div></div>
            </div>
            {([['Assets', bs.totalAssets], ['Liabilities', bs.totalLiabilities], ['Equity', bs.totalEquity], ['Difference', bs.difference]] as const).map(([l, v]) => <div key={l}><div className="eyebrow">{l}</div><Money value={v} className={cx('text-[16px]', l === 'Difference' && !v.isZero() && 'text-neg')} /></div>)}
          </div>
          {!bs.balanced && <div className="mt-2 text-[12.5px] text-neg">Period closing is blocked until this is resolved. Open the trial balance to locate the ledger causing the difference.</div>}
        </Panel>
        <label className="no-print mb-3 flex items-center gap-2 text-[12.5px] text-ink2"><input type="checkbox" className="accent-[var(--gold)]" checked={common} onChange={(e) => setCommon(e.target.checked)} /> Common-size (each line as % of total assets)</label>
        <div className="grid gap-4 xl:grid-cols-2">
          <div><Section title="What the business owns"><Statement lines={[...bs.assets, total('ta', 'Total assets', bs.totalAssets, 'Sum of all asset sections')]} base={common ? bs.totalAssets : undefined} baseLabel="of assets" to={s.range.to} csvName="balance-sheet-assets" /></Section></div>
          <div className="space-y-4">
            <Section title="What the business owes"><Statement lines={[...bs.liabilities, total('tl', 'Total liabilities', bs.totalLiabilities, 'Sum of all liability sections')]} base={common ? bs.totalAssets : undefined} baseLabel="of assets" to={s.range.to} csvName="balance-sheet-liabilities" /></Section>
            <Section title="The owners' share"><Statement lines={[...bs.equity, total('te', 'Total equity', bs.totalEquity, 'Capital + reserves + accumulated and current results'), total('tle', 'Total liabilities and equity', bs.totalLiabilities.plus(bs.totalEquity), 'Must equal total assets')]} base={common ? bs.totalAssets : undefined} baseLabel="of assets" to={s.range.to} csvName="balance-sheet-equity" /></Section>
          </div>
        </div>
      </>}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Cash flow
function CashFlowView() {
  const s = useStatements(false)
  const cf = s.data?.now.cf
  const tl = (key: string, label: string, amount: Decimal, formula: string, kind: ReportLine['kind'] = 'subtotal'): ReportLine => ({ key, label, amount, accountIds: [], kind, level: 0, formula })
  return (
    <Wrap res={s}>
      {cf && <>
        <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {([['Opening cash', cf.openingCash], ['Operating', cf.operating], ['Investing', cf.investing], ['Financing', cf.financing], ['Closing cash', cf.closingCash]] as const).map(([l, v]) => (
            <Panel key={l} className="p-4" lit={false}><div className="eyebrow">{l}</div><div className="mt-1.5 text-[18px]"><Money value={v} compact sign={!/cash/i.test(l)} className={cx(!/cash/i.test(l) && (v.lt(0) ? 'text-neg' : 'text-pos'))} /></div></Panel>
          ))}
        </div>
        <Note kind={cf.unexplained.isZero() ? 'good' : 'warn'} className="mb-4">
          {cf.unexplained.isZero()
            ? <>The statement explains the whole movement in cash: opening <Money value={cf.openingCash} /> + net change <Money value={cf.netChange} sign /> = closing <Money value={cf.closingCash} />.</>
            : <><b>UNEXPLAINED DIFFERENCE: <Money value={cf.unexplained} /></b>. The statement does not fully explain the movement in cash. This difference is displayed, never hidden.</>}
          {' '}Prepared by the indirect method from ledger movements.
        </Note>
        <Statement lines={[...cf.lines, tl('net', 'Net change in cash', cf.netChange, 'Operating + Investing + Financing'), tl('open', 'Opening cash and bank', cf.openingCash, 'Balance at the start of the period'), tl('close', 'Closing cash and bank', cf.closingCash, 'Opening + net change', 'total')]} from={s.range.from} to={s.range.to} csvName="cash-flow" />
      </>}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Trial balance
function TrialBalanceView() {
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const s = useStatements(false)
  const tb = s.data?.now.tb
  type Row = NonNullable<typeof tb>['rows'][number]
  const cols: Column<Row>[] = [
    { key: 'code', header: 'Code', width: 84, render: (r) => <span className="num text-gold">{r.account.code}</span>, sort: (r) => r.account.code, csv: (r) => r.account.code },
    { key: 'name', header: 'Ledger', render: (r) => r.account.name, sort: (r) => r.account.name, csv: (r) => r.account.name },
    ...(ids.length > 1 ? [{ key: 'co', header: 'Co.', width: 70, render: (r: Row) => <span className="num text-[11.5px] text-muted">{companies.find((c) => c.id === r.companyId)?.code}</span>, sort: (r: Row) => companies.find((c) => c.id === r.companyId)?.code ?? '', csv: (r: Row) => companies.find((c) => c.id === r.companyId)?.name }] : []),
    { key: 'type', header: 'Type', width: 96, render: (r) => <span className="text-muted">{r.account.type}</span>, sort: (r) => r.account.type, csv: (r) => r.account.type },
    ...(['openingDr', 'openingCr', 'periodDr', 'periodCr', 'closingDr', 'closingCr'] as const).map((k) => ({
      key: k, header: k.replace(/([a-z]+)(Dr|Cr)/, (_, a: string, b: string) => `${a[0].toUpperCase() + a.slice(1)} ${b}`), align: 'right' as const, width: 138,
      render: (r: Row) => (r[k].isZero() ? <span className="text-muted">—</span> : <Money value={r[k]} />), sort: (r: Row) => r[k].toNumber(), csv: (r: Row) => r[k].toFixed(2),
    })),
  ]
  return (
    <Wrap res={s}>
      {tb && <>
        <Panel className="mb-4 p-4" lit={false} attention={!tb.balanced}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3"><span className={cx('lamp', tb.balanced ? 'pos' : 'neg pulse')} /><div><div className="eyebrow">Balance check</div><div className={cx('display text-[15px] font-medium', tb.balanced ? 'text-pos' : 'text-neg')}>{tb.balanced ? 'TOTAL DEBITS = TOTAL CREDITS' : 'DEBITS AND CREDITS DO NOT AGREE'}</div></div></div>
            {([['Period debits', tb.totals.periodDr], ['Period credits', tb.totals.periodCr], ['Closing debits', tb.totals.closingDr], ['Closing credits', tb.totals.closingCr], ['Difference', tb.difference]] as const).map(([l, v]) => <div key={l}><div className="eyebrow">{l}</div><Money value={v} className={cx('text-[15px]', l === 'Difference' && !v.isZero() && 'text-neg')} /></div>)}
          </div>
        </Panel>
        <Panel lit={false} className="overflow-hidden">
          <DataTable columns={cols} rows={tb.rows} rowKey={(r) => r.account.id} pageSize={200} exportName="trial-balance" initialSort={{ key: 'code', dir: 'asc' }}
            onRow={(r) => nav(ledgerLink({ accounts: [r.account.id], from: s.range.from, to: s.range.to }))}
            footer={<tr className="bg-[color-mix(in_srgb,var(--gold)_6%,transparent)] font-semibold"><td colSpan={ids.length > 1 ? 4 : 3} className="px-3.5 py-3">Total</td>{(['openingDr', 'openingCr', 'periodDr', 'periodCr', 'closingDr', 'closingCr'] as const).map((k) => <td key={k} className="r px-3.5 py-3"><Money value={tb.totals[k]} /></td>)}</tr>}
            empty={{ title: 'No ledger has any balance or movement in this range' }} />
        </Panel>
      </>}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Consolidation
function Consolidated() {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const group = useApp((s) => s.session?.group)
  const ids = useScopeIds()
  const r = useRange()
  const [view, setView] = useState<'bs' | 'pl' | 'ic'>('bs')
  const res = useAsync(async () => {
    const [pos, per] = await Promise.all([balancesAsOf(api, companies, ids, r.to, r.knownAt), api.ledgerBalances(ids, r.from, r.to, { knownAt: r.knownAt ?? undefined })])
    return { pos, per }
  }, [api, ids.join(','), r.from, r.to, r.knownAt])
  const scope = companies.filter((c) => ids.includes(c.id))
  const foreign = scope.filter((c) => c.base_currency !== (group?.base_currency ?? 'INR'))

  const model = useMemo(() => {
    if (!res.data) return null
    const per = (id: ID, rows: typeof res.data.pos): AccountBal[] => joinBalances(accounts.filter((a) => a.company_id === id), rows.filter((x) => x.company_id === id))
    const posAll = joinBalances(accounts.filter((a) => ids.includes(a.company_id)), res.data.pos)
    const el = intercompanyEliminations(posAll, scope)
    const cols = scope.map((c) => ({ c, bs: balanceSheet(per(c.id, res.data!.pos)), pl: profitAndLoss(per(c.id, res.data!.per)) }))
    const elim = sum(el.map((e) => e.eliminated))
    // intercompany income / expense flagged on the ledgers (management fees charged within the group are eliminated by matching amount)
    return { cols, el, elim }
  }, [res.data, accounts, ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (ids.length < 2) return <Panel><Empty title="Consolidation needs at least two companies" body="Select the whole group, or several companies, in the company switcher at the top." /></Panel>
  const name = (id: ID) => companies.find((c) => c.id === id)?.name ?? '—'
  type Line = { label: string; get: (x: NonNullable<typeof model>['cols'][number]) => Decimal; elim?: Decimal; strong?: boolean; to?: string }
  const bsLines: Line[] = model ? [
    { label: 'Cash & bank', get: (x) => x.bs.cash }, { label: 'Receivables', get: (x) => x.bs.receivables }, { label: 'Inventory & work-in-progress', get: (x) => x.bs.inventory },
    { label: 'Investments', get: (x) => x.bs.investments }, { label: 'Fixed assets (net)', get: (x) => x.bs.fixedAssetsNet },
    { label: 'Due from group companies', get: (x) => sum(x.bs.assets.filter((s) => s.key === 'ic_recv').map((s) => s.amount)), elim: model.elim.neg() },
    { label: 'Other assets', get: (x) => x.bs.totalAssets.minus(x.bs.cash).minus(x.bs.receivables).minus(x.bs.inventory).minus(x.bs.investments).minus(x.bs.fixedAssetsNet).minus(sum(x.bs.assets.filter((s) => s.key === 'ic_recv').map((s) => s.amount))) },
    { label: 'TOTAL ASSETS', get: (x) => x.bs.totalAssets, elim: model.elim.neg(), strong: true },
    { label: 'Payables', get: (x) => x.bs.payables }, { label: 'Borrowings', get: (x) => x.bs.borrowings },
    { label: 'Due to group companies', get: (x) => sum(x.bs.liabilities.filter((s) => s.key === 'ic_pay').map((s) => s.amount)), elim: model.elim.neg() },
    { label: 'Other liabilities', get: (x) => x.bs.totalLiabilities.minus(x.bs.payables).minus(x.bs.borrowings).minus(sum(x.bs.liabilities.filter((s) => s.key === 'ic_pay').map((s) => s.amount))) },
    { label: 'TOTAL LIABILITIES', get: (x) => x.bs.totalLiabilities, elim: model.elim.neg(), strong: true },
    { label: 'TOTAL EQUITY', get: (x) => x.bs.totalEquity, strong: true },
  ] : []
  const plLines: Line[] = [
    { label: 'Revenue from operations', get: (x) => x.pl.revenue }, { label: 'Cost of goods sold', get: (x) => x.pl.cogs }, { label: 'GROSS PROFIT', get: (x) => x.pl.grossProfit, strong: true },
    { label: 'Employee costs', get: (x) => x.pl.employeeCost }, { label: 'Other operating expenses', get: (x) => x.pl.opex }, { label: 'OPERATING PROFIT', get: (x) => x.pl.operatingProfit, strong: true },
    { label: 'Other income', get: (x) => x.pl.otherIncome }, { label: 'Depreciation', get: (x) => x.pl.depreciation }, { label: 'Finance costs', get: (x) => x.pl.financeCost }, { label: 'Exceptional items', get: (x) => x.pl.exceptional },
    { label: 'Tax', get: (x) => x.pl.tax }, { label: 'PROFIT AFTER TAX', get: (x) => x.pl.pat, strong: true },
  ]
  const lines = view === 'bs' ? bsLines : plLines

  return (
    <Wrap res={res}>
      {model && <>
        {foreign.length > 0 && <Note kind="warn" className="mb-4">{foreign.map((c) => c.name).join(', ')} {foreign.length === 1 ? 'keeps' : 'keep'} books in a currency other than {group?.base_currency}. Currency translation is not yet applied, so {foreign.length === 1 ? 'its' : 'their'} figures are shown untranslated and the total is <b>not</b> reliable. Tracked in the requirement ledger (468).</Note>}
        <Note className="mb-4">Ownership percentages and non-controlling interests are not yet applied: every company is consolidated at 100%. Intercompany revenue and expense (for example management fees charged within the group) are shown gross in the P&L view; their elimination is planned. Balance-sheet intercompany balances are eliminated below.</Note>
        <Tabs value={view} onChange={setView} tabs={[{ key: 'bs', label: 'Balance sheet' }, { key: 'pl', label: 'Profit & loss' }, { key: 'ic', label: 'Intercompany balances', count: model.el.length }]} />
        {view !== 'ic' ? (
          <Panel lit={false} className="overflow-hidden">
            <div className="overflow-auto">
              <table className="table">
                <thead><tr><th style={{ minWidth: 220 }}>Line</th>{model.cols.map((x) => <th key={x.c.id} className="r" style={{ minWidth: 140 }} title={x.c.name}>{x.c.code}</th>)}<th className="r" style={{ minWidth: 140 }}>Sum</th><th className="r" style={{ minWidth: 140 }}>Eliminations</th><th className="r" style={{ minWidth: 150 }}>Consolidated</th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const total = sum(model.cols.map(l.get)), e = l.elim ?? ZERO
                    return (
                      <tr key={l.label} className={cx(l.strong && 'bg-[color-mix(in_srgb,var(--gold)_6%,transparent)] font-semibold')}>
                        <td>{l.label}</td>
                        {model.cols.map((x) => <td key={x.c.id} className="r"><Money value={l.get(x)} dim /></td>)}
                        <td className="r"><Money value={total} dim /></td>
                        <td className="r">{e.isZero() ? <span className="text-muted">—</span> : <Money value={e} className="text-violet" />}</td>
                        <td className="r"><Money value={total.plus(e)} className={cx(l.strong && 'text-gold')} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel lit={false} className="overflow-hidden">
            {model.el.length === 0 ? <Empty title="No intercompany balances" body="No ledger is flagged as an intercompany account with a counterparty inside the selected companies." /> : (
              <table className="table">
                <thead><tr><th>Creditor company</th><th>Debtor company</th><th className="r">Receivable in creditor's books</th><th className="r">Payable in debtor's books</th><th className="r">Eliminated</th><th className="r">Difference</th><th>Status</th></tr></thead>
                <tbody>
                  {model.el.map((e) => (
                    <tr key={e.fromCompany + e.toCompany}>
                      <td>{name(e.fromCompany)}</td><td>{name(e.toCompany)}</td>
                      <td className="r"><Money value={e.receivable} /></td><td className="r"><Money value={e.payable} /></td><td className="r"><Money value={e.eliminated} className="text-violet" /></td>
                      <td className="r"><Money value={e.mismatch} className={cx(!e.mismatch.isZero() && 'text-neg')} /></td>
                      <td>{e.mismatch.isZero() ? <span className="chip pos">agreed</span> : <span className="chip neg">mismatch — investigate</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="border-t border-line px-3.5 py-2.5 text-[12px] text-muted">A mismatch is never forced to agree. It usually means one company has recorded a transaction that the other has not, or has recorded it in a different period.</div>
          </Panel>
        )}
      </>}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Ratios
function Ratios() {
  const s = useStatements(false)
  const d = s.data
  const days = daysBetween(s.range.from, s.range.to) + 1
  const months = Math.max(1, days / 30.4)
  const list = useMemo(() => {
    if (!d) return []
    const burn = d.now.cf.openingCash.minus(d.now.cf.closingCash).div(months)
    return ratios(d.now.pl, d.now.bs, days, burn)
  }, [d, days, months])
  const groups = [...new Set(list.map((r) => r.group))]
  const show = (r: (typeof list)[number]) => r.value === null ? 'n/a' : r.unit === '%' ? fmtPct(r.value) : r.unit === 'x' ? r.value.toDecimalPlaces(2).toString() + '×' : r.unit === 'days' ? r.value.toDecimalPlaces(0).toString() + ' days' : r.value.toDecimalPlaces(1).toString() + ' months'
  return (
    <Wrap res={s}>
      <Note className="mb-4">NUMERO does not reduce a company to an opaque score. Each indicator below is a standard ratio, shown with the formula and the exact figures used. Ratios based on a part-year are not annualised.</Note>
      {groups.map((g) => (
        <Section key={g} title={g} className="mb-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {list.filter((r) => r.group === g).map((r) => (
              <Panel key={r.key} className="p-4" lit={false}>
                <div className="flex items-center justify-between gap-2"><div className="eyebrow">{r.label}</div><Explain title={r.label} formula={r.formula} inputs={r.inputs} text={r.note} /></div>
                <div className={cx('num mt-2 text-[24px] leading-none', r.value === null && 'text-muted')}>{show(r)}</div>
                <div className="num mt-2.5 text-[11.5px] text-gold">{r.formula}</div>
                {r.value === null && <div className="mt-1 text-[11.5px] text-muted">{r.note ?? 'Cannot be calculated: the denominator is zero in this period.'}</div>}
              </Panel>
            ))}
          </div>
        </Section>
      ))}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Where did the money go / come from
function MoneyFlow({ side }: { side: 'expense' | 'income' }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const r = useRange()
  const [path, setPath] = useState<{ level: 'category' | 'ledger' | 'company'; key: string; label: string }[]>([])
  const s = useStatements(false)
  const amt = (b: AccountBal) => (side === 'expense' ? b.debit.minus(b.credit) : b.credit.minus(b.debit))
  const parentName = (a: Account) => accounts.find((x) => x.id === a.parent_id)?.name ?? (side === 'expense' ? 'Other expenses' : 'Other income')

  const rows = (s.data?.now.period ?? []).filter((b) => b.account.type === side && !amt(b).isZero())
  const cat = path.find((p) => p.level === 'category')?.key
  const led = path.find((p) => p.level === 'ledger')?.key
  const co = path.find((p) => p.level === 'company')?.key
  const inCat = cat ? rows.filter((b) => parentName(b.account) === cat) : rows
  const inLed = led ? inCat.filter((b) => b.account.name === led) : inCat
  const inCo = co ? inLed.filter((b) => b.account.company_id === co) : inLed
  const level: 'category' | 'ledger' | 'company' | 'lines' = !cat ? 'category' : !led ? 'ledger' : !co && ids.length > 1 ? 'company' : 'lines'

  const group = (list: AccountBal[], by: (b: AccountBal) => [string, string]) => {
    const m = new Map<string, { key: string; label: string; v: Decimal; ids: ID[] }>()
    for (const b of list) { const [k, l] = by(b); const e = m.get(k) ?? { key: k, label: l, v: ZERO, ids: [] }; e.v = e.v.plus(amt(b)); e.ids.push(b.account.id); m.set(k, e) }
    return [...m.values()].sort((a, b) => b.v.cmp(a.v))
  }
  const items = level === 'category' ? group(rows, (b) => [parentName(b.account), parentName(b.account)]) : level === 'ledger' ? group(inCat, (b) => [b.account.name, b.account.name]) : level === 'company' ? group(inLed, (b) => [b.account.company_id, companies.find((c) => c.id === b.account.company_id)?.name ?? '']) : []
  const total = sum((level === 'category' ? rows : level === 'ledger' ? inCat : inLed).map(amt))
  const accIds = [...new Set(inCo.map((b) => b.account.id))]

  const lines = useAsync(async () => (level === 'lines' ? api.ledgerLines({ company_ids: co ? [co] : ids, account_ids: accIds, from: r.from, to: r.to, known_at: r.knownAt ?? undefined, limit: 500 }) : null), [api, level, accIds.join(','), co, r.from, r.to])
  const cols: Column<LedgerLine>[] = [
    { key: 'd', header: 'Date', width: 110, render: (l) => <span className="num text-ink2">{fmtDate(l.journal_date)}</span>, sort: (l) => l.journal_date, csv: (l) => l.journal_date },
    { key: 'v', header: 'Voucher', width: 150, render: (l) => <span className="num text-gold">{l.voucher_no}</span>, csv: (l) => l.voucher_no },
    { key: 'n', header: 'What', render: (l) => l.narration ?? l.description, csv: (l) => l.narration },
    { key: 'p', header: 'Party', render: (l) => l.party_name ?? <span className="text-muted">—</span>, sort: (l) => l.party_name ?? '', csv: (l) => l.party_name },
    { key: 'a', header: 'Amount', align: 'right', width: 150, render: (l) => <Money value={side === 'expense' ? D(l.debit).minus(l.credit) : D(l.credit).minus(l.debit)} />, sort: (l) => Number(l.debit) - Number(l.credit), csv: (l) => String(side === 'expense' ? D(l.debit).minus(l.credit) : D(l.credit).minus(l.debit)) },
  ]

  return (
    <Wrap res={s}>
      <Panel className="mb-4 p-5" hud>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <button className={cx('drill', !path.length && 'text-gold')} onClick={() => setPath([])}>{side === 'expense' ? 'Total outflow' : 'Total income'}</button>
          {path.map((p, i) => <span key={i} className="flex items-center gap-2"><ChevronRight size={13} className="text-muted" /><button className={cx('drill', i === path.length - 1 && 'text-gold')} onClick={() => setPath(path.slice(0, i + 1))}>{p.label}</button></span>)}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Money value={total} className="display text-[34px] leading-none" />
          <Truth state="ACTUAL" />
          <span className="text-[12.5px] text-muted">{level === 'lines' ? 'individual transactions' : `broken down by ${level}`}</span>
        </div>
      </Panel>

      {level !== 'lines' ? (
        items.length === 0 ? <Panel><Empty title={`No ${side} was recorded in this period`} /></Panel> : (
          <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
            <Panel className="p-5" lit={false}>
              <Donut data={items.map((x, i) => ({ label: x.label, value: Math.max(0, x.v.toNumber()), color: colorAt(i), id: x.key }))} size={210}
                onSlice={(sl) => setPath([...path, { level, key: sl.id!, label: sl.label }])} centre={<div><div className="text-[10.5px] uppercase tracking-[0.12em] text-muted">{items.length} {level === 'category' ? 'categories' : level === 'ledger' ? 'ledgers' : 'companies'}</div></div>} />
            </Panel>
            <Panel lit={false} className="overflow-hidden">
              <table className="table">
                <thead><tr><th>{level === 'category' ? 'Category' : level === 'ledger' ? 'Ledger' : 'Company'}</th><th className="r">Amount</th><th className="r" style={{ width: 90 }}>Share</th><th style={{ width: 160 }} /></tr></thead>
                <tbody>
                  {items.map((x, i) => (
                    <tr key={x.key} className="rowlink" onClick={() => setPath([...path, { level, key: x.key, label: x.label }])}>
                      <td><span className="flex items-center gap-2"><i className="inline-block h-2 w-2 rounded-full" style={{ background: colorAt(i) }} />{x.label}</span></td>
                      <td className="r"><Money value={x.v} /></td>
                      <td className="r num text-muted">{total.isZero() ? '' : fmtPct(x.v.div(total).times(100))}</td>
                      <td><div className="h-[5px] overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full" style={{ width: `${total.isZero() ? 0 : Math.max(0, x.v.div(total).times(100).toNumber())}%`, background: colorAt(i) }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        )
      ) : (
        <Panel lit={false} className="overflow-hidden">
          {lines.error ? <ErrorBox message={lines.error} retry={lines.reload} /> : !lines.data ? <Loading /> : <>
            {lines.data.restricted.count > 0 && <Note kind="warn" className="m-3">{lines.data.restricted.count} entr{lines.data.restricted.count === 1 ? 'y' : 'ies'} totalling <Money value={D(lines.data.restricted.debit).plus(lines.data.restricted.credit)} /> relate to restricted transactions that your account is not authorised to view.</Note>}
            <DataTable columns={cols} rows={lines.data.rows} rowKey={(l) => l.id} onRow={(l) => nav('/journals/' + l.journal_id)} totalCount={lines.data.total} exportName={side === 'expense' ? 'where-money-went' : 'where-money-came-from'} initialSort={{ key: 'a', dir: 'desc' }}
              toolbar={<button className="btn sm" onClick={() => nav(ledgerLink({ accounts: accIds, from: r.from, to: r.to }))}>Open in the general ledger</button>} />
          </>}
        </Panel>
      )}
    </Wrap>
  )
}

// ------------------------------------------------------------------ Ageing
function Ageing() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const ids = useScopeIds()
  const asOf = useApp((s) => s.asOf)
  const [side, setSide] = useState<'in' | 'out'>('in')
  const res = useAsync(() => api.listInvoices({ companyIds: ids, docTypes: ['sales_invoice', 'purchase_bill'] }), [api, ids.join(',')])
  const docs = useMemo(() => openDocuments(res.data ?? [], asOf ?? today()).filter((d) => d.side === side), [res.data, side, asOf])
  const totals = ageingTotals(docs)
  const total = sumBase(docs)
  interface Row { id: ID; name: string; total: Decimal; buckets: Record<string, Decimal> }
  const byParty = useMemo<Row[]>(() => {
    const m = new Map<ID, Row>()
    for (const d of docs) {
      const e = m.get(d.invoice.party_id) ?? { id: d.invoice.party_id, name: parties.find((p) => p.id === d.invoice.party_id)?.display_name ?? 'Unknown party', total: ZERO, buckets: Object.fromEntries(DEFAULT_BUCKETS.map((b) => [b.key, ZERO])) }
      e.buckets[d.bucket] = e.buckets[d.bucket].plus(d.outstandingBase)
      e.total = e.total.plus(d.outstandingBase)
      m.set(d.invoice.party_id, e)
    }
    return [...m.values()].sort((a, b) => b.total.cmp(a.total))
  }, [docs, parties])
  const cols: Column<Row>[] = [
    { key: 'n', header: side === 'in' ? 'Customer' : 'Supplier', render: (r) => r.name, sort: (r) => r.name, csv: (r) => r.name },
    ...DEFAULT_BUCKETS.map((b) => ({ key: b.key, header: b.label, align: 'right' as const, width: 130, render: (r: Row) => (r.buckets[b.key].isZero() ? <span className="text-muted">—</span> : <Money value={r.buckets[b.key]} className={cx(b.from > 60 && 'text-neg', b.from > 0 && b.from <= 60 && 'text-warn')} />), sort: (r: Row) => r.buckets[b.key].toNumber(), csv: (r: Row) => r.buckets[b.key].toFixed(2) })),
    { key: 't', header: 'Total', align: 'right', width: 150, render: (r) => <Money value={r.total} className="font-semibold" />, sort: (r) => r.total.toNumber(), csv: (r) => r.total.toFixed(2) },
  ]
  return (
    <Wrap res={res}>
      <Tabs value={side} onChange={setSide} tabs={[{ key: 'in', label: 'Receivables — who owes us' }, { key: 'out', label: 'Payables — who we owe' }]} />
      <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <Panel className="p-4" lit={false}><div className="eyebrow">Total outstanding</div><div className="mt-1.5 text-[18px]"><Money value={total} compact /></div><div className="mt-1 text-[11px] text-muted">{docs.length} document{docs.length === 1 ? '' : 's'}</div></Panel>
        {DEFAULT_BUCKETS.map((b) => (
          <Panel key={b.key} className="p-4" lit={false}>
            <div className="eyebrow">{b.label}{b.from > 0 ? ' days' : ''}</div>
            <div className={cx('mt-1.5 text-[18px]', b.from > 60 && !totals[b.key].isZero() && 'text-neg')}><Money value={totals[b.key]} compact /></div>
            <div className="num mt-1 text-[11px] text-muted">{total.isZero() ? '0.0%' : fmtPct(totals[b.key].div(total).times(100))}</div>
          </Panel>
        ))}
      </div>
      <Panel className="mb-4 p-5" lit={false}>
        <BarChart height={200} data={DEFAULT_BUCKETS.map((b) => ({ label: b.label, values: [{ key: side === 'in' ? 'Receivable' : 'Payable', value: totals[b.key].toNumber(), color: b.from > 60 ? 'var(--neg)' : b.from > 0 ? 'var(--warn)' : 'var(--pos)' }] }))} />
      </Panel>
      <Panel lit={false} className="overflow-hidden">
        <DataTable columns={cols} rows={byParty} rowKey={(r) => r.id} onRow={(r) => nav('/parties/' + r.id)} exportName={side === 'in' ? 'receivables-ageing' : 'payables-ageing'}
          empty={{ title: 'Nothing is outstanding' }} />
      </Panel>
      <div className="mt-2 text-[11.5px] text-muted">Ageing is counted from each document's due date. Amounts in foreign currency are shown in base currency at the rate recorded on the document.</div>
    </Wrap>
  )
}

// ------------------------------------------------------------------ Cash & bank book
function CashBook() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const r = useRange()
  const cash = accounts.filter((a) => ids.includes(a.company_id) && isCash(a) && !a.is_group)
  const res = useAsync(async () => joinBalances(cash, await api.ledgerBalances(ids, r.from, r.to, { knownAt: r.knownAt ?? undefined })), [api, ids.join(','), r.from, r.to, cash.length])
  type Row = AccountBal
  const cols: Column<Row>[] = [
    { key: 'c', header: 'Company', width: 90, render: (b) => <span className="num text-[11.5px] text-muted">{companies.find((c) => c.id === b.account.company_id)?.code}</span>, csv: (b) => companies.find((c) => c.id === b.account.company_id)?.name },
    { key: 'n', header: 'Cash / bank ledger', render: (b) => <><span className="num text-[11.5px] text-gold">{b.account.code}</span> {b.account.name}</>, sort: (b) => b.account.name, csv: (b) => b.account.name },
    { key: 'k', header: 'Kind', width: 90, render: (b) => <StatusChip status={b.account.subtype === 'cash' ? 'info' : 'open'} label={b.account.subtype} />, csv: (b) => b.account.subtype },
    { key: 'o', header: 'Opening', align: 'right', width: 150, render: (b) => <Money value={b.opening} />, sort: (b) => b.opening.toNumber(), csv: (b) => b.opening.toFixed(2) },
    { key: 'i', header: 'Money in', align: 'right', width: 150, render: (b) => <Money value={b.debit} className="text-pos" />, sort: (b) => b.debit.toNumber(), csv: (b) => b.debit.toFixed(2) },
    { key: 'x', header: 'Money out', align: 'right', width: 150, render: (b) => <Money value={b.credit} className="text-neg" />, sort: (b) => b.credit.toNumber(), csv: (b) => b.credit.toFixed(2) },
    { key: 'e', header: 'Closing', align: 'right', width: 150, render: (b) => <Money value={b.closing} className={cx('font-semibold', b.closing.lt(0) && 'text-neg')} />, sort: (b) => b.closing.toNumber(), csv: (b) => b.closing.toFixed(2) },
  ]
  const rows = res.data ?? []
  return (
    <Wrap res={res}>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Opening', sum(rows.map((b) => b.opening))], ['Cash in', sum(rows.map((b) => b.debit))], ['Cash out', sum(rows.map((b) => b.credit))], ['Closing', sum(rows.map((b) => b.closing))]] as const).map(([l, v]) => <Panel key={l} className="p-4" lit={false}><div className="eyebrow">{l}</div><div className="mt-1.5 text-[18px]"><Money value={v} compact /></div></Panel>)}
      </div>
      {rows.some((b) => b.closing.lt(0)) && <Note kind="warn" className="mb-4">One or more cash or bank ledgers show a negative balance. A cash ledger cannot physically be negative; this usually means a receipt has not been recorded yet.</Note>}
      <Panel lit={false} className="overflow-hidden">
        <DataTable columns={cols} rows={rows} rowKey={(b) => b.account.id} exportName="cash-and-bank-book" onRow={(b) => nav(ledgerLink({ accounts: [b.account.id], from: r.from, to: r.to }))} empty={{ title: 'No cash or bank movement in this period' }} />
      </Panel>
    </Wrap>
  )
}

// ------------------------------------------------------------------ Sales & purchase registers
function Registers() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const r = useRange()
  const [side, setSide] = useState<'sales_invoice' | 'purchase_bill'>('sales_invoice')
  const res = useAsync(() => api.listInvoices({ companyIds: ids, docTypes: [side] }), [api, ids.join(','), side])
  const rows = (res.data ?? []).filter((i) => i.status !== 'draft' && i.doc_date >= r.from && i.doc_date <= r.to)
  const base = (i: Invoice, v: Decimal.Value) => D(v).times(i.fx_rate).toDecimalPlaces(2)
  const cols: Column<Invoice>[] = [
    { key: 'd', header: 'Date', width: 110, render: (i) => <span className="num text-ink2">{fmtDate(i.doc_date)}</span>, sort: (i) => i.doc_date, csv: (i) => i.doc_date },
    { key: 'n', header: 'Number', width: 160, render: (i) => <span className="num text-gold">{i.doc_no}</span>, sort: (i) => i.doc_no ?? '', csv: (i) => i.doc_no },
    { key: 'c', header: 'Co.', width: 70, render: (i) => <span className="num text-[11.5px] text-muted">{companies.find((c) => c.id === i.company_id)?.code}</span>, csv: (i) => companies.find((c) => c.id === i.company_id)?.name },
    { key: 'p', header: side === 'sales_invoice' ? 'Customer' : 'Supplier', render: (i) => parties.find((p) => p.id === i.party_id)?.display_name, sort: (i) => parties.find((p) => p.id === i.party_id)?.display_name ?? '', csv: (i) => parties.find((p) => p.id === i.party_id)?.display_name },
    { key: 'g', header: 'GSTIN', width: 170, render: (i) => <span className="num text-[11.5px] text-ink2">{parties.find((p) => p.id === i.party_id)?.gstin ?? '—'}</span>, csv: (i) => parties.find((p) => p.id === i.party_id)?.gstin },
    { key: 'r', header: 'Reference', width: 140, render: (i) => i.reference ?? '', csv: (i) => i.reference },
    { key: 's', header: 'Taxable value', align: 'right', width: 150, render: (i) => <Money value={base(i, i.subtotal)} />, sort: (i) => Number(i.subtotal), csv: (i) => base(i, i.subtotal).toFixed(2) },
    { key: 't', header: 'Tax', align: 'right', width: 130, render: (i) => <Money value={base(i, i.tax_total)} dim />, sort: (i) => Number(i.tax_total), csv: (i) => base(i, i.tax_total).toFixed(2) },
    { key: 'x', header: 'Total', align: 'right', width: 150, render: (i) => <Money value={base(i, i.total)} className="font-semibold" />, sort: (i) => Number(i.total), csv: (i) => base(i, i.total).toFixed(2) },
    { key: 'st', header: 'Status', width: 130, render: (i) => <StatusChip status={i.status} />, csv: (i) => i.status },
  ]
  return (
    <Wrap res={res}>
      <Tabs value={side} onChange={setSide} tabs={[{ key: 'sales_invoice', label: 'Sales register' }, { key: 'purchase_bill', label: 'Purchase register' }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Documents', null], ['Taxable value', sum(rows.map((i) => base(i, i.subtotal)))], [side === 'sales_invoice' ? 'Output tax' : 'Input tax', sum(rows.map((i) => base(i, i.tax_total)))], ['Total', sum(rows.map((i) => base(i, i.total)))]] as const).map(([l, v]) => <Panel key={l} className="p-4" lit={false}><div className="eyebrow">{l}</div><div className="mt-1.5 text-[18px]">{v === null ? <span className="num">{rows.length}</span> : <Money value={v} compact />}</div></Panel>)}
      </div>
      <Note className="mb-4">This register lists recorded documents and the tax calculated on them from the tax codes in force on each document's date. It is a working paper for review, not a filed return. GST and TDS return workflows are planned.</Note>
      <Panel lit={false} className="overflow-hidden">
        <DataTable columns={cols} rows={rows} rowKey={(i) => i.id} exportName={side === 'sales_invoice' ? 'sales-register' : 'purchase-register'} initialSort={{ key: 'd', dir: 'desc' }}
          onRow={(i) => nav((side === 'sales_invoice' ? '/invoices/' : '/bills/') + i.id)} empty={{ title: 'No documents in this period' }} />
      </Panel>
    </Wrap>
  )
}
