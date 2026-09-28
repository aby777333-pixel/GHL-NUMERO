import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { BellRing, CalendarClock, ChevronDown, ChevronRight, ExternalLink, Flame, Lock, ScanSearch, TrendingUp } from 'lucide-react'
import type { Account, Alert, ID, LedgerLine } from '@/engine/types'
import type { RegisterItem } from '@/engine/opsTypes'
import type { AttentionClass } from '@/engine/p3Types'
import { ATTENTION, attentionOf, burnRate, complianceView, forOwner, unusualEntries, yearOnYear, type Deadline, type Unusual, type YearRow } from '@/engine/analysis'
import { can, useApp, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { ledgerLink, monthlySeries } from '@/lib/data'
import { D, ZERO, fmtPct } from '@/lib/money'
import { addMonths, endOfMonth, fmtDate, fmtDateTime, fmtMonth, startOfMonth, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Loading, Money, Note, PageHeader, Panel, Section, StatusChip, Tabs, Truth } from '@/ui/kit'
import { AttentionChip, DemoTag, Estimate, Fact, human, NoAccess, Tile, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { useCompanyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, TrendChart } from '@/ui/charts'

// =====================================================================
// Analysis over the books (spec 476, 479, 775, 1354, 608, 1678).
// Everything here is read from what is recorded; nothing is posted or changed.
// Where the records are not enough to say something, the screen says that:
// a part year is marked as a part year, an average is called an average,
// and an entry that is unusual is a prompt to look, never a finding.
// =====================================================================

type TabKey = 'years' | 'burn' | 'unusual' | 'compliance' | 'attention'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'years', label: 'Year on year' }, { key: 'burn', label: 'Burn rate' }, { key: 'unusual', label: 'Unusual entries' },
  { key: 'compliance', label: 'Compliance deadlines' }, { key: 'attention', label: 'For the owner' },
]
const FIRST = '1990-01-01'
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const whenText = (days: number) => (days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} late`)

/** A tab the role does not read. An empty table would read as "there is nothing"; this says what is true. */
function NoTab({ what, perm }: { what: string; perm: string }) {
  return (
    <Panel>
      <Empty icon={<Lock size={20} />} title={`Your role does not include ${what}`}
        body={<>This tab needs the permission <span className="num text-ink2">{perm}</span> in at least one of the selected companies. A Group Super Admin can grant it under Team &amp; Access. That you cannot read it does not mean there is nothing to read.</>} />
    </Panel>
  )
}

/** Companies are only added together when the sum means something: one currency, and where years are compared, one financial year. */
function usePick(ids: ID[], sameYear: boolean) {
  const companies = useCompanyChoices(ids)
  const [picked, setPicked] = useState<ID>('')
  const oneCurrency = new Set(companies.map((c) => c.base_currency)).size <= 1
  const oneYear = new Set(companies.map((c) => c.fy_start_month)).size <= 1
  const together = oneCurrency && (!sameYear || oneYear)
  const company = companies.some((c) => c.id === picked) ? picked : together ? '' : companies[0]?.id ?? ''
  const use = useMemo(() => (company ? [company] : companies.map((c) => c.id)), [company, companies])
  const first = companies.find((c) => use.includes(c.id))
  const why = companies.length > 1 && !together ? (!oneCurrency ? 'The selected companies do not keep their books in one currency, so they are not added together here.' : 'The selected companies do not share a financial year, so they are not compared as one here.') : null
  return { companies, company, setPicked, use, together, why, currency: first?.base_currency ?? 'INR', fyStartMonth: first?.fy_start_month ?? 4 }
}
function CompanyPick({ pick }: { pick: ReturnType<typeof usePick> }) {
  return (
    <label><span className="label">Company</span>
      <select className="field sm" value={pick.company} onChange={(e) => pick.setPicked(e.target.value)}>
        {pick.together && pick.companies.length > 1 && <option value="">All {pick.companies.length} selected companies</option>}
        {pick.companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
      </select>
    </label>
  )
}

export default function Analysis() {
  useApp((s) => s.session)
  const [sp, setSp] = useSearchParams()
  const scope = useScopeIds()
  const reads = (perm: string) => scope.filter((id) => can(perm, id))
  const report = reads('report.view'), register = reads('register.view'), sentinel = reads('sentinel.view')
  const journal = report.filter((id) => can('journal.view', id))
  if (!report.length && !register.length && !sentinel.length) return <NoAccess eyebrow="Command · Analysis" title="Analysis" perm={['report.view', 'register.view', 'sentinel.view']} />

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'years'

  return (
    <div>
      <PageHeader
        eyebrow="Command · Analysis"
        title="Analysis"
        subtitle={<>What the books say over years, how fast cash is used, which entries stand apart from their ledger, what falls due across the companies, and what is for the owner. Read from the records; nothing here posts or changes anything.<DemoTag className="ml-2" /></>}
      />
      <Tabs<TabKey> tabs={TABS} value={tab} onChange={(k) => setSp(k === 'years' ? {} : { tab: k }, { replace: true })} />

      {tab === 'years' && (report.length ? <Years ids={report} /> : <NoTab what="the comparison of years" perm="report.view" />)}
      {tab === 'burn' && (report.length ? <Burn ids={report} /> : <NoTab what="the burn rate" perm="report.view" />)}
      {tab === 'unusual' && (journal.length ? <UnusualTab ids={journal} left={scope.length - journal.length} /> : <NoTab what="the entries of the ledger" perm="report.view and journal.view" />)}
      {tab === 'compliance' && (register.length ? <Compliance ids={register} left={scope.filter((id) => !register.includes(id))} /> : <NoTab what="the registers" perm="register.view" />)}
      {tab === 'attention' && (sentinel.length ? <Attention ids={sentinel} left={scope.length - sentinel.length} /> : <NoTab what="what Sentinel has raised" perm="sentinel.view" />)}
    </div>
  )
}

// ====================================================================== year on year
interface Line extends YearRow { nature: 'income' | 'cost' | 'result'; formula?: string }
const NATURE: Record<string, Line['nature']> = { revenue: 'income', cogs: 'cost', employee: 'cost', opex: 'cost', gross_profit: 'result', operating_profit: 'result', pbt: 'result', pat: 'result' }
const FORMULA: Record<string, string> = {
  gross_profit: 'Gross profit = Revenue − Cost of goods sold',
  operating_profit: 'Operating profit = Gross profit − Employee costs − Other operating expenses',
  pbt: 'Profit before tax = Operating profit + Other income − Depreciation − Finance costs − Exceptional items',
  pat: 'Profit after tax = Profit before tax − Tax expense',
}
const fyName = (y: number, startMonth: number) => (startMonth === 1 ? `FY ${y}` : `FY ${y}-${String(y + 1).slice(2)}`)

function Years({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companyCode = useCompanyCode()
  const pick = usePick(ids, true)
  const [source, setSource] = useState<'store' | 'ledger'>('store')
  const asOf = today()
  const useKey = pick.use.join(',')

  const main = useAsync(async () => {
    const refresh = await api.listFactRefresh(pick.use)
    const without = pick.use.filter((id) => !refresh.some((r) => r.company_id === id && r.rows > 0))
    const fromStore = source === 'store' && without.length === 0
    const rows = (fromStore ? await api.listFacts(pick.use, FIRST, asOf) : await api.ledgerMonthly(pick.use, FIRST, asOf))
      .map((r) => ({ account_id: r.account_id, month: r.month, debit: r.debit, credit: r.credit }))
    return { rows, fromStore, without, refresh }
  }, [api, useKey, source, asOf])

  const d = main.data
  const yoy = useMemo(() => (d ? yearOnYear(d.rows, accounts.filter((a) => pick.use.includes(a.company_id)), pick.fyStartMonth, asOf) : null), [d, accounts, useKey, pick.fyStartMonth, asOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (y: number) => fyName(y, pick.fyStartMonth)

  const lines: Line[] = useMemo(() => {
    if (!yoy) return []
    const by = new Map(yoy.rows.map((r) => [r.key, r]))
    const changes = (byYear: Record<number, Decimal>): YearRow['changes'] => {
      const out: YearRow['changes'] = {}
      yoy.years.forEach((y, i) => {
        if (i === 0) return
        const prev = byYear[yoy.years[i - 1]] ?? ZERO, cur = byYear[y] ?? ZERO
        out[y] = { amount: cur.minus(prev), pct: prev.isZero() ? null : cur.minus(prev).times(100).div(prev.abs()).toDecimalPlaces(1) }
      })
      return out
    }
    // what lies between two results of the engine is their difference: nothing is estimated
    const between = (key: string, label: string, a: string, b: string, nature: Line['nature'], formula: string): Line => {
      const byYear = Object.fromEntries(yoy.years.map((y) => [y, (by.get(a)?.byYear[y] ?? ZERO).minus(by.get(b)?.byYear[y] ?? ZERO)]))
      return { key, label, byYear, changes: changes(byYear), nature, formula }
    }
    const own = (k: string): Line[] => { const r = by.get(k); return r ? [{ ...r, nature: NATURE[k] ?? 'result', formula: FORMULA[k] }] : [] }
    return [
      ...own('revenue'), ...own('cogs'), ...own('gross_profit'), ...own('employee'), ...own('opex'), ...own('operating_profit'),
      between('other_net', 'Other income, less depreciation, finance costs and exceptional items', 'pbt', 'operating_profit', 'result', 'Shown net = Profit before tax − Operating profit'),
      ...own('pbt'),
      between('tax', 'Tax expense', 'pbt', 'pat', 'cost', 'Tax expense = Profit before tax − Profit after tax'),
      ...own('pat'),
    ]
  }, [yoy])

  const whole = (y: number) => !!yoy?.complete[y]?.complete
  const years = yoy?.years ?? []
  // the latest pair of years that are both complete and follow one another
  const pair = useMemo(() => { for (let i = years.length - 1; i > 0; i--) if (whole(years[i]) && whole(years[i - 1])) return [years[i - 1], years[i]] as const; return null }, [yoy]) // eslint-disable-line react-hooks/exhaustive-deps
  const latest = years[years.length - 1]
  const line = (k: string) => lines.find((l) => l.key === k)

  const columns: Column<Line>[] = [
    {
      key: 'label', header: 'Line', csv: (l) => l.label,
      render: (l) => <span className={cx('inline-flex items-center gap-2', l.nature === 'result' ? 'font-medium text-ink' : 'text-ink2')}>{l.label}{l.formula && <Explain title={l.label} formula={l.formula} text="Worked out from the totals of the ledgers of each kind, for each financial year." source={d?.fromStore ? 'Source: monthly totals of posted entries in the analytical store.' : 'Source: monthly totals of posted entries in the general ledger.'} />}</span>,
    },
    ...years.flatMap((y, i): Column<Line>[] => {
      const like = i > 0 && whole(y) && whole(years[i - 1])
      const amount: Column<Line> = {
        key: 'y' + y, header: `${name(y)}${whole(y) ? '' : ` · ${yoy!.complete[y].months} mo`}`, align: 'right', csv: (l) => (l.byYear[y] ?? ZERO).toFixed(2),
        render: (l) => <Money value={l.byYear[y] ?? ZERO} currency={pick.currency} dim className={cx(l.nature === 'result' && 'font-medium', !whole(y) && 'text-ink2')} />,
      }
      if (i === 0) return [amount]
      const change: Column<Line> = {
        key: 'c' + y, header: `Change on ${name(years[i - 1])}${like ? '' : ' · part year'}`, align: 'right',
        csv: (l) => `${l.changes[y]?.amount.toFixed(2) ?? ''}${l.changes[y]?.pct ? ` (${l.changes[y]!.pct!.toFixed(1)}%)` : ''}${like ? '' : ' part year, not like for like'}`,
        render: (l) => {
          const c = l.changes[y]
          if (!c) return <span className="text-muted">—</span>
          const good = c.amount.isZero() ? null : l.nature === 'cost' ? c.amount.lt(0) : c.amount.gt(0)
          const tone = !like ? 'text-muted' : good === null ? 'text-muted' : good ? 'text-pos' : 'text-neg'
          return (
            <div className={tone} title={like ? undefined : 'One of the two years is not complete. The figures are set side by side as they stand; they are not like for like.'}>
              <Money value={c.amount} currency={pick.currency} sign />
              <div className="num text-[11px]">{c.pct === null ? 'no figure the year before' : (c.amount.gt(0) ? '+' : '') + fmtPct(c.pct)}{!like && ' · not like for like'}</div>
            </div>
          )
        },
      }
      return [amount, change]
    }),
  ]

  const refreshed = (d?.refresh ?? []).filter((r) => pick.use.includes(r.company_id))
  const oldest = refreshed.map((r) => r.refreshed_at).sort()[0]

  return (
    <div>
      <Panel className="mb-4 p-4" lit={false}>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
          <CompanyPick pick={pick} />
          <label><span className="label">Read from</span>
            <select className="field sm" value={source} onChange={(e) => setSource(e.target.value as 'store' | 'ledger')}>
              <option value="store">The analytical store, where it has rows</option>
              <option value="ledger">The ledger itself</option>
            </select>
          </label>
          <div className="self-end text-[12px] text-muted">
            {!d ? 'Reading…' : d.fromStore
              ? <>Read from <span className="text-ink2">the analytical store</span>, last rebuilt {fmtDateTime(oldest)}{refreshed.length > 1 ? ' (the earliest of the companies chosen)' : ''}. Entries posted after that are not in these figures; read from the ledger to include them. The store is rebuilt by a person under <button className="link" onClick={() => nav('/system?tab=store')}>System → Analytical store</button>.</>
              : source === 'store'
                ? <>Read from <span className="text-ink2">the ledger itself</span>: the analytical store holds no rows your role can read for {d.without.map((id) => companyCode(id)).join(', ')}.</>
                : <>Read from <span className="text-ink2">the ledger itself</span>: every posted entry up to today.</>}
          </div>
        </div>
        {pick.why && <div className="mt-2 text-[11.5px] text-warn">{pick.why} Choose one company at a time.</div>}
      </Panel>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !yoy && <Panel><Loading rows={7} label="Reading the years" /></Panel>}

      {yoy && years.length === 0 && <Panel><Empty icon={<TrendingUp size={20} />} title="No income or expense has been posted" body="Years are compared from posted entries in income and expense ledgers. Drafts and entries awaiting approval are not counted." /></Panel>}

      {yoy && years.length > 0 && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Financial years in the books" sub={years.length > 1 ? `${name(years[0])} to ${name(latest)} · the year begins in ${fmtMonth(`2000-${String(pick.fyStartMonth).padStart(2, '0')}-01`).slice(0, 3)}` : name(latest)}><span className="num">{years.length}</span></Tile>
            <Tile label="Latest year" tone={whole(latest) ? 'text-ink' : 'text-warn'} sub={whole(latest) ? 'complete: twelve months of entries' : `not complete: ${plural(yoy.complete[latest].months, 'month', 'months')} of entries`}><span className="num text-[19px]">{name(latest)}</span></Tile>
            <Tile label="Revenue, year on year" tone={!pair ? 'text-muted' : (line('revenue')?.changes[pair[1]]?.amount ?? ZERO).gte(0) ? 'text-pos' : 'text-neg'}
              sub={pair ? <>{name(pair[1])} against {name(pair[0])}: <Money value={line('revenue')?.changes[pair[1]]?.amount ?? ZERO} currency={pick.currency} compact sign /></> : 'The books do not yet hold two complete years that follow one another.'}>
              {pair ? (() => { const p = line('revenue')?.changes[pair[1]]?.pct; return p ? <span className="num">{(p.gt(0) ? '+' : '') + fmtPct(p)}</span> : <span className="text-[15px]">no figure the year before</span> })() : <span className="text-[15px]">not comparable yet</span>}
            </Tile>
            <Tile label="Profit after tax, year on year" tone={!pair ? 'text-muted' : (line('pat')?.changes[pair[1]]?.amount ?? ZERO).gte(0) ? 'text-pos' : 'text-neg'}
              sub={pair ? <>{name(pair[1])}: <Money value={line('pat')?.byYear[pair[1]] ?? ZERO} currency={pick.currency} compact /> · {name(pair[0])}: <Money value={line('pat')?.byYear[pair[0]] ?? ZERO} currency={pick.currency} compact /></> : 'Only complete years are compared here.'}>
              {pair ? <Money value={line('pat')?.changes[pair[1]]?.amount ?? ZERO} currency={pick.currency} compact sign /> : <span className="text-[15px]">not comparable yet</span>}
            </Tile>
          </div>

          {yoy.notes.length > 0 && (
            <Note kind="warn" className="mb-4">
              <strong className="text-ink">Not every year is whole.</strong>
              <ul className="m-0 mt-1 list-disc pl-4">{yoy.notes.map((n) => <li key={n}>{n.replace(/FY(\d{4})/g, (_, y: string) => name(Number(y)))}</li>)}</ul>
              <div className="mt-1">A year counts as complete when it has ended and every one of its twelve months holds entries. A change that involves a part year is shown in grey and marked “not like for like”.</div>
            </Note>
          )}

          <Section title="By financial year" className="mb-4" right={<Truth state="ACTUAL" />}>
            <Panel className="p-4" lit={false}>
              <BarChart height={260} data={years.map((y) => ({
                label: `${name(y).replace('FY ', 'FY')}${whole(y) ? '' : ` ${yoy.complete[y].months}m`}`,
                values: [
                  { key: 'Revenue', value: (line('revenue')?.byYear[y] ?? ZERO).toNumber(), color: 'var(--gold)' },
                  { key: 'Gross profit', value: (line('gross_profit')?.byYear[y] ?? ZERO).toNumber(), color: 'var(--cyan)' },
                  { key: 'Profit after tax', value: (line('pat')?.byYear[y] ?? ZERO).toNumber(), color: 'var(--pos)' },
                ],
              }))} />
              <div className="mt-2 text-[11.5px] text-muted">A year marked with a number of months (for example “6m”) is a part year. Its bars are lower because it is shorter, not because the business is smaller.</div>
            </Panel>
          </Section>

          <Section title="Financial years side by side">
            <Panel lit={false}>
              <DataTable columns={columns} rows={lines} rowKey={(l) => l.key} pageSize={20}
                exportName={`year-on-year-${pick.company ? companyCode(pick.company) : 'selected-companies'}`}
                rowClass={(l) => (l.nature === 'result' ? 'bg-surface2' : undefined)}
                toolbar={<span className="text-[12px] text-muted">Costs are shown as positive amounts. A change is green when it adds to profit and red when it takes from it. Percentages are against the year before.</span>} />
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">
              Ledgers are grouped by their kind in the chart of accounts. “Other income, less depreciation, finance costs and exceptional items” is shown as one net line because it is what lies between operating profit and profit before tax; its parts are in the profit and loss report. No part year is scaled up to a full year.
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

// ====================================================================== burn rate
interface Point { month: string; closing: number; expense: number }

function Burn({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const pick = usePick(ids, false)
  const [span, setSpan] = useState(24)
  const [months, setMonths] = useState(6)
  const useKey = pick.use.join(',')
  // the month in progress is left out: its balance is not a month-end balance
  const to = endOfMonth(addMonths(today(), -1))
  const from = startOfMonth(addMonths(to, -(span - 1)))

  const main = useAsync(() => monthlySeries(api, accounts, pick.use, from, to), [api, accounts, useKey, from, to])
  const points: Point[] = useMemo(() => {
    const s = main.data
    if (!s) return []
    // months before the first entry of the books are not months of nil cash; they are not in the books
    const start = s.months.findIndex((_, i) => s.cash[i] !== 0 || s.income[i] !== 0 || s.expense[i] !== 0)
    return start < 0 ? [] : s.months.slice(start).map((m, k) => ({ month: m, closing: Math.round(s.cash[start + k] * 100) / 100, expense: s.expense[start + k] }))
  }, [main.data])
  const burn = useMemo(() => burnRate(points.map((p) => ({ month: p.month, closing: p.closing })), months), [points, months])

  const measured = burn.months.length
  const startCash = measured ? D(points[points.length - 1 - measured]?.closing ?? 0) : ZERO
  const spent = measured ? points.slice(-measured).reduce((s, p) => s + p.expense, 0) / measured : 0
  const cashIds = accounts.filter((a) => pick.use.includes(a.company_id) && a.type === 'asset' && (a.subtype === 'cash' || a.subtype === 'bank') && !a.is_group).map((a) => a.id)
  const rise = burn.monthlyBurn.neg()

  interface MonthRow { month: string; start: Decimal; end: Decimal; change: Decimal }
  const monthRows: MonthRow[] = burn.months.map((m) => { const end = D(points.find((p) => p.month === m.month)?.closing ?? 0); return { month: m.month, start: end.minus(m.change), end, change: m.change } })
  const columns: Column<MonthRow>[] = [
    { key: 'month', header: 'Month', sort: (r) => r.month, csv: (r) => r.month.slice(0, 7), render: (r) => <span className="text-ink">{fmtMonth(r.month)}</span> },
    { key: 'start', header: 'Cash at the start', align: 'right', sort: (r) => r.start.toNumber(), csv: (r) => r.start.toFixed(2), render: (r) => <Money value={r.start} currency={pick.currency} decimals={0} /> },
    { key: 'end', header: 'Cash at the end', align: 'right', sort: (r) => r.end.toNumber(), csv: (r) => r.end.toFixed(2), render: (r) => <button className="link" onClick={() => nav(ledgerLink({ accounts: cashIds, to: endOfMonth(r.month) }))} title="Open the entries of the cash and bank ledgers up to the end of this month"><Money value={r.end} currency={pick.currency} decimals={0} /></button> },
    { key: 'change', header: 'Change over the month', align: 'right', sort: (r) => r.change.toNumber(), csv: (r) => r.change.toFixed(2), render: (r) => <Money value={r.change} currency={pick.currency} decimals={0} sign colored /> },
  ]

  return (
    <div>
      <Panel className="mb-4 p-4" lit={false}>
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
          <CompanyPick pick={pick} />
          <label><span className="label">Measured over the last</span>
            <select className="field sm" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[3, 6, 12].map((n) => <option key={n} value={n}>{n} months</option>)}
            </select>
          </label>
          <label><span className="label">History shown</span>
            <select className="field sm" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
              {[12, 18, 24].map((n) => <option key={n} value={n}>{n} months</option>)}
            </select>
          </label>
        </div>
        {pick.why && <div className="mt-2 text-[11.5px] text-warn">{pick.why} Choose one company at a time.</div>}
      </Panel>

      <Note className="mb-4">
        <strong className="text-ink">These are averages of what happened, not a forecast.</strong> The burn rate is the average fall in cash and bank balances per month over the months measured, from posted entries. It says nothing of what will be received or paid next. To look ahead, use <button className="link" onClick={() => nav('/forward')}>Forward</button> (what is due and expected) and the <button className="link" onClick={() => nav('/twin')}>Digital Twin</button> (simulations).
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !main.data && <Panel><Loading rows={6} label="Reading cash at each month end" /></Panel>}

      {main.data && points.length < 3 && (
        <Panel><Empty icon={<Flame size={20} />} title="Too little history for a burn rate" body={<>{burn.says} The books hold {plural(points.length, 'completed month', 'completed months')} of entries up to {fmtDate(to)}{points.length ? <>, with cash of <Money value={burn.cash} currency={pick.currency} decimals={0} /> at the last month end</> : null}.</>} /></Panel>
      )}

      {main.data && points.length >= 3 && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Cash at the last month end" sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> cash and bank ledgers, {fmtDate(to)}</span>} onClick={() => nav(ledgerLink({ accounts: cashIds, to }))}><Money value={burn.cash} currency={pick.currency} compact /></Tile>
            {burn.consuming ? (
              <Tile label="Net burn a month" tone="text-warn" sub={<span className="flex flex-wrap items-center gap-1.5"><Estimate /> average fall in cash over {plural(measured, 'month', 'months')}</span>}><Money value={burn.monthlyBurn} currency={pick.currency} compact /></Tile>
            ) : (
              <Tile label="Net burn a month" tone="text-pos" sub={<>Cash {rise.isZero() ? 'did not change' : <>rose by about <Money value={rise} currency={pick.currency} compact /> a month</>} over {plural(measured, 'month', 'months')}. {pick.company || pick.companies.length === 1 ? 'This company is' : 'These companies are'} not consuming cash.</>}><span className="text-[19px]">No burn</span></Tile>
            )}
            <Tile label="Months of cash left" tone={burn.runway ? (burn.runway.lt(6) ? 'text-neg' : burn.runway.lt(12) ? 'text-warn' : 'text-ink') : 'text-muted'}
              sub={burn.consuming ? (burn.runway ? <span className="flex flex-wrap items-center gap-1.5"><Estimate /> if cash went on falling at the same average</span> : 'Nothing is left in hand at the last month end.') : 'Runway is only worked out for a company that consumes cash.'}>
              {burn.runway ? <span className="num">about {burn.runway.toDecimalPlaces(burn.runway.gte(10) ? 0 : 1).toString()}</span> : <span className="text-[19px]">{burn.consuming ? 'None' : 'Not applicable'}</span>}
            </Tile>
            <Tile label="Expenses recorded a month" sub={<>Average over the same {plural(measured, 'month', 'months')}, as recorded in expense ledgers whether paid or not. It is not the cash that went out.</>}><Money value={spent} currency={pick.currency} compact /></Tile>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Section title="Cash at each month end" right={<Truth state="ACTUAL" />}>
              <Panel className="p-4" lit={false}>
                <TrendChart height={250} labels={points.map((p) => fmtMonth(p.month))} series={[{ name: 'Cash and bank at month end', values: points.map((p) => p.closing) }]}
                  onPoint={(i) => nav(ledgerLink({ accounts: cashIds, to: endOfMonth(points[i].month) }))} />
                <div className="mt-2 text-[11.5px] text-muted">{points.length < span ? `The books hold ${points.length} completed months in this span; earlier months are not shown because they hold no entries. ` : ''}The month in progress is left out. Click a point to open the entries behind it.</div>
              </Panel>
            </Section>
            <Section title="How it is worked out" right={<Estimate />}>
              <Panel className="space-y-3 p-4 text-[12.5px]" lit={false}>
                <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-gold">{burn.formula}</div>
                <Fact label={`Cash at the start (end of ${fmtMonth(addMonths(monthRows[0]?.month ?? to, -1))})`}><Money value={startCash} currency={pick.currency} decimals={0} /></Fact>
                <Fact label={`Cash at the end (end of ${fmtMonth(to)})`}><Money value={burn.cash} currency={pick.currency} decimals={0} /></Fact>
                <Fact label="Months measured"><span className="num">{measured}</span>{measured < months && <span className="text-warn"> · fewer than the {months} asked for: the books hold no more</span>}</Fact>
                <Fact label={burn.consuming ? 'Net burn a month' : 'Average rise a month'}>
                  <span className="flex flex-wrap items-center gap-x-1.5">(<Money value={startCash} currency={pick.currency} decimals={0} /> − <Money value={burn.cash} currency={pick.currency} decimals={0} />) ÷ <span className="num">{measured}</span> = <Money value={burn.consuming ? burn.monthlyBurn : rise} currency={pick.currency} decimals={0} className="font-medium text-ink" /></span>
                </Fact>
                {burn.runway && <Fact label="Months of cash left"><span className="flex flex-wrap items-center gap-x-1.5"><Money value={burn.cash} currency={pick.currency} decimals={0} /> ÷ <Money value={burn.monthlyBurn} currency={pick.currency} decimals={0} /> = <span className="num font-medium text-ink">about {burn.runway.toString()}</span></span></Fact>}
                <div className="text-[11.5px] text-muted">This is the net burn: money received is set against money paid. A gross burn (money paid out alone) is not shown, because monthly totals cannot tell a payment from a transfer between the company's own accounts, and a figure that mixed the two would mislead.</div>
              </Panel>
            </Section>
          </div>

          <Section title={`The ${measured} month${measured === 1 ? '' : 's'} measured`}>
            <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
              <Panel className="p-4" lit={false}>
                <BarChart height={230} data={monthRows.map((r) => ({ label: fmtMonth(r.month), values: [{ key: 'Change in cash over the month', value: r.change.toNumber(), color: 'var(--cyan)' }] }))}
                  onBar={(label) => { const r = monthRows.find((x) => fmtMonth(x.month) === label); if (r) nav(ledgerLink({ accounts: cashIds, from: r.month, to: endOfMonth(r.month) })) }} />
                <div className="mt-2 text-[11.5px] text-muted">Bars below the line are months in which cash fell. One large receipt or payment can move the average; read the months as well as the average.</div>
              </Panel>
              <Panel lit={false}>
                <DataTable columns={columns} rows={monthRows} rowKey={(r) => r.month} pageSize={12} exportName="burn-rate-months" initialSort={{ key: 'month', dir: 'desc' }} />
              </Panel>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

// ====================================================================== unusual entries
const MAX_LINES = 5000
const PAGE = 1000
const TYPES: { key: Account['type']; label: string }[] = [{ key: 'expense', label: 'Expenses' }, { key: 'income', label: 'Income' }, { key: 'asset', label: 'Assets' }, { key: 'liability', label: 'Liabilities' }, { key: 'equity', label: 'Equity' }]
const SENSITIVITY: { value: number; label: string }[] = [{ value: 2.5, label: 'More sensitive · score 2.5 and above' }, { value: 3.5, label: 'Usual · score 3.5 and above' }, { value: 5, label: 'Less sensitive · score 5 and above' }, { value: 8, label: 'Only the extreme · score 8 and above' }]

function UnusualTab({ ids, left }: { ids: ID[]; left: number }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companyCode = useCompanyCode()
  const currency = useApp((s) => (ids.length === 1 ? s.companies.find((c) => c.id === ids[0])?.base_currency : s.session?.group?.base_currency) ?? 'INR')
  const period = usePeriod()
  const idsKey = ids.join(',')
  const from = period.from
  const to = period.to > today() ? today() : period.to
  const [threshold, setThreshold] = useState(3.5)
  const [minSamples, setMinSamples] = useState('8')
  const [types, setTypes] = useState<Account['type'][]>(['expense'])

  const main = useAsync(async () => {
    const rows: LedgerLine[] = []
    let total = 0, restricted = 0
    for (let offset = 0; offset < MAX_LINES; offset += PAGE) {
      const r = await api.ledgerLines({ company_ids: ids, from, to, limit: PAGE, offset })
      total = r.total; restricted = r.restricted.count
      rows.push(...r.rows)
      if (r.rows.length < PAGE || rows.length >= r.total) break
    }
    return { rows, total, restricted }
  }, [api, idsKey, from, to])

  const min = Math.max(4, Math.round(Number(minSamples) || 8))
  const d = main.data
  const found = useMemo(() => (d && types.length ? unusualEntries(d.rows, accounts, { minSamples: min, threshold, types }) : []), [d, accounts, min, threshold, types])
  const ledgers = useMemo(() => {
    const byType = new Map(accounts.map((a) => [a.id, a.type]))
    const m = new Map<ID, number>()
    for (const l of d?.rows ?? []) { const t = byType.get(l.account_id); if (t && types.includes(t)) m.set(l.account_id, (m.get(l.account_id) ?? 0) + 1) }
    const enough = [...m.values()].filter((n) => n >= min).length
    return { all: m.size, enough, few: m.size - enough }
  }, [d, accounts, types, min])
  const more = d ? d.total - d.rows.length : 0
  const top = found.slice(0, 8)

  const columns: Column<Unusual>[] = [
    { key: 'date', header: 'Date', width: 108, sort: (u) => u.line.journal_date, csv: (u) => u.line.journal_date, render: (u) => <span className="num text-[12.5px] text-ink2">{fmtDate(u.line.journal_date)}</span> },
    { key: 'voucher', header: 'Voucher', sort: (u) => u.line.voucher_no ?? '', csv: (u) => u.line.voucher_no ?? '', render: (u) => <div><span className="num text-[12.5px] text-gold">{u.line.voucher_no ?? '—'}</span>{u.line.status === 'reversed' && <div><StatusChip status="reversed" /></div>}{u.line.voucher_type === 'reversal' && <div><span className="chip violet">reversal</span></div>}</div> },
    ...(ids.length > 1 ? [{ key: 'co', header: 'Co.', width: 70, sort: (u: Unusual) => u.line.company_name, csv: (u: Unusual) => u.line.company_name, render: (u: Unusual) => <span className="num text-[11.5px] text-muted" title={u.line.company_name}>{companyCode(u.line.company_id)}</span> }] : []),
    {
      key: 'ledger', header: 'Ledger', sort: (u) => u.line.account_code, csv: (u) => `${u.line.account_code} ${u.line.account_name}`,
      render: (u) => <div className="min-w-0"><button className="link text-left" onClick={(e) => { e.stopPropagation(); nav(ledgerLink({ accounts: [u.account_id], from, to })) }} title="Open every entry of this ledger in the period"><span className="num text-[11.5px]">{u.line.account_code}</span> {u.line.account_name}</button><div className="truncate text-[11.5px] text-muted">{u.line.narration ?? u.line.description ?? ''}</div></div>,
    },
    { key: 'amount', header: 'This entry', align: 'right', sort: (u) => u.amount, csv: (u) => u.amount.toFixed(2), render: (u) => <Money value={u.amount} currency={currency} className="text-ink" /> },
    { key: 'median', header: 'Usual for the ledger (median)', align: 'right', sort: (u) => u.median, csv: (u) => u.median.toFixed(2), render: (u) => <Money value={u.median} currency={currency} decimals={0} className="text-ink2" /> },
    { key: 'spread', header: 'Spread (median distance)', align: 'right', sort: (u) => u.spread, csv: (u) => u.spread.toFixed(2), render: (u) => <Money value={u.spread} currency={currency} decimals={0} className="text-ink2" /> },
    { key: 'score', header: 'How far from usual (score)', align: 'right', sort: (u) => u.score, csv: (u) => u.score, render: (u) => <span className={cx('num', u.score >= threshold * 2 ? 'text-warn' : 'text-ink')}>{u.score.toFixed(1)}</span> },
    { key: 'samples', header: 'Entries compared', align: 'right', sort: (u) => u.samples, csv: (u) => u.samples, render: (u) => <span className={cx('num', u.samples < 12 && 'text-warn')} title={u.samples < 12 ? 'A comparison that rests on few entries is weak.' : undefined}>{u.samples}</span> },
    { key: 'why', header: 'Why it is unusual', csv: (u) => u.why, render: (u) => <span className="text-[12.5px] text-ink2">{u.why}</span> },
  ]

  return (
    <div>
      <Note className="mb-4">
        <strong className="text-ink">Unusual is a prompt to look, not a finding.</strong> For each ledger, NUMERO takes the middle amount of its entries (the median) and the middle distance of the entries from it (the spread). An entry far above the usual, measured in spreads, is listed. It says that the entry is unlike the others of its ledger. It says nothing about whether it is right or wrong; that is for a person to say, with the voucher in hand.
      </Note>

      <Panel className="mb-4 p-4" lit={false}>
        <div className="grid gap-3 md:grid-cols-[1.3fr_170px_2fr]">
          <label><span className="label">Sensitivity</span>
            <select className="field sm" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              {SENSITIVITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label><span className="label">Entries a ledger needs, at least</span>
            <input className="field sm num" inputMode="numeric" value={minSamples} onChange={(e) => setMinSamples(e.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={() => setMinSamples(String(min))} />
          </label>
          <div><span className="label">Kinds of ledger</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {TYPES.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink2">
                  <input type="checkbox" checked={types.includes(t.key)} onChange={(e) => setTypes(e.target.checked ? [...types, t.key] : types.filter((x) => x !== t.key))} /> {t.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11.5px] text-muted">Period: {period.label}, {fmtDate(from)} to {fmtDate(to)} — change it at the top of the screen. A ledger with fewer than {min} entries in the period is not judged: so few say nothing of what is usual (at least 4 are always asked for).</div>
      </Panel>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={7} label="Reading the entries of the period" /></Panel>}

      {d && (
        <>
          {more > 0 && <Note kind="warn" className="mb-4"><strong className="text-ink">Not every entry was examined.</strong> The period holds {d.total.toLocaleString()} posted lines; the latest {d.rows.length.toLocaleString()} were examined (the most this screen reads at once is {MAX_LINES.toLocaleString()}) and {more.toLocaleString()} earlier lines were not. Choose a shorter period to examine every line of it.</Note>}
          {d.restricted > 0 && <Note className="mb-4">{plural(d.restricted, 'line belongs', 'lines belong')} to entries classified above your clearance. They are in the books and were not examined here.</Note>}
          {left > 0 && <Note className="mb-4">{plural(left, 'selected company is', 'selected companies are')} not examined: your role does not read both the reports and the journal entries there (report.view and journal.view).</Note>}

          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Lines examined" sub={more > 0 ? `of ${d.total.toLocaleString()} posted in the period` : 'every posted line of the period'}><span className="num">{d.rows.length.toLocaleString()}</span></Tile>
            <Tile label="Ledgers judged" sub={`of ${ledgers.all} of the kinds ticked that hold entries in the period`}><span className="num">{ledgers.enough}</span></Tile>
            <Tile label="Ledgers with too few entries" tone={ledgers.few ? 'text-ink2' : 'text-muted'} sub={`fewer than ${min}; not judged`}><span className="num">{ledgers.few}</span></Tile>
            <Tile label="Entries unlike their ledger" tone={found.length ? 'text-warn' : 'text-pos'} sub={`score ${threshold} or more · to be looked at by a person`}><span className="num">{found.length}</span></Tile>
          </div>

          {top.length > 0 && (
            <Section title="The entries furthest from the usual" className="mb-4">
              <Panel className="p-4" lit={false}>
                <BarChart height={240} data={top.map((u, i) => ({ label: u.line.voucher_no ?? `Entry ${i + 1}`, values: [{ key: 'This entry', value: u.amount, color: 'var(--warn)' }, { key: 'Usual for its ledger (median)', value: u.median, color: 'var(--cyan)' }] }))}
                  onBar={(label) => { const u = top.find((x, i) => (x.line.voucher_no ?? `Entry ${i + 1}`) === label); if (u) nav('/journals/' + u.line.journal_id) }} />
                <div className="mt-2 text-[11.5px] text-muted">Each pair sets an entry beside the usual amount of its own ledger. Click a bar to open the entry.</div>
              </Panel>
            </Section>
          )}

          <Panel lit={false}>
            <DataTable columns={columns} rows={found} rowKey={(u) => u.line.id} onRow={(u) => nav('/journals/' + u.line.journal_id)} exportName="entries-unlike-their-ledger" initialSort={{ key: 'score', dir: 'desc' }}
              toolbar={<>
                <ScanSearch size={15} className="text-gold" />
                <span className="text-[12.5px] text-ink2"><span className="num text-ink">{found.length}</span> entr{found.length === 1 ? 'y' : 'ies'} · a row opens its voucher</span>
                <Explain title="How an entry is measured" text="The amounts of the entries of one ledger in the period are put in order. The median is the middle one. The spread is the median of the distances of all the entries from that median. Using the median rather than the average means that one very large entry cannot hide itself by pulling the average towards it. Only entries above the usual are listed."
                  formula="Score = 0.6745 × (amount of the entry − median of the ledger) ÷ spread of the ledger" source="Source: posted lines of the general ledger in the period chosen, in the companies you can read." />
              </>}
              empty={!types.length ? { title: 'No kind of ledger is ticked', body: 'Tick at least one kind of ledger to examine.' }
                : ledgers.enough === 0 ? { title: 'No ledger holds enough entries to judge', body: `No ledger of the kinds ticked holds ${min} entries or more in this period. With so few, what is usual cannot be said. Choose a longer period.`, icon: <ScanSearch size={20} /> }
                  : { title: 'No entry stands apart from its ledger', body: `${plural(ledgers.enough, 'ledger was', 'ledgers were')} judged at this sensitivity and none of their entries scored ${threshold} or more. This says that the amounts are alike; it is not a check of the entries themselves.`, icon: <ScanSearch size={20} /> }} />
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">A ledger in which at least half of the entries are of one same amount has no spread to measure by and is left out. Reversed entries and their reversals are posted lines and are examined like the others; they are marked.</div>
        </>
      )}
    </div>
  )
}

// ====================================================================== compliance across companies
type DueState = Deadline['state']
const DUE: { key: DueState; label: string; field: 'overdue' | 'week' | 'month' | 'later'; chip: string; text: string; soft: string; meaning: string }[] = [
  { key: 'overdue', label: 'Overdue', field: 'overdue', chip: 'neg', text: 'text-neg', soft: 'bg-negsoft', meaning: 'The due date has passed and the item is not marked paid, closed or resolved.' },
  { key: 'this week', label: 'This week', field: 'week', chip: 'warn', text: 'text-warn', soft: 'bg-warnsoft', meaning: 'Due today or within 7 days.' },
  { key: 'this month', label: 'This month', field: 'month', chip: 'gold', text: 'text-gold', soft: 'bg-goldsoft', meaning: 'Due in 8 to 31 days.' },
  { key: 'later', label: 'Later', field: 'later', chip: '', text: 'text-ink2', soft: '', meaning: 'Due in more than 31 days.' },
]
interface CompanyDue { company_id: ID; overdue: number; week: number; month: number; later: number }

function Compliance({ ids, left }: { ids: ID[]; left: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companyCode = useCompanyCode()
  const companyName = useCompanyName()
  const idsKey = ids.join(',')
  const asOf = today()
  const [ticked, setTicked] = useState<string[]>(['compliance'])
  const [only, setOnly] = useState<{ company?: ID; state?: DueState }>({})

  const main = useAsync(async () => {
    const [items, kinds] = await Promise.all([api.listRegisterItems({ companyIds: ids }), api.listRegisterKinds()])
    return { items, kinds }
  }, [api, idsKey])
  const d = main.data
  const items = useMemo(() => d?.items ?? [], [d])
  const kindName = (k: string) => d?.kinds.find((x) => x.key === k)?.name ?? human(k)

  // kinds that carry a due date on at least one active item; compliance is always offered
  const present = useMemo(() => {
    const m = new Map<string, number>([['compliance', 0]])
    for (const i of items) if (i.status === 'active' && i.next_due) m.set(i.kind, (m.get(i.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => Number(b[0] === 'compliance') - Number(a[0] === 'compliance') || b[1] - a[1])
  }, [items])

  const view = useMemo(() => complianceView(items, asOf, ticked), [items, asOf, ticked])
  const byCompany: CompanyDue[] = ids.map((id) => view.byCompany.find((c) => c.company_id === id) ?? { company_id: id, overdue: 0, week: 0, month: 0, later: 0 })
  const total = (f: CompanyDue) => f.overdue + f.week + f.month + f.later
  const sumOf = (field: 'overdue' | 'week' | 'month' | 'later') => byCompany.reduce((s, c) => s + c[field], 0)
  const undated = items.filter((i: RegisterItem) => ticked.includes(i.kind) && i.status === 'active' && !i.next_due).length
  const shown = view.rows.filter((r) => (!only.company || r.item.company_id === only.company) && (!only.state || r.state === only.state))

  const matrix: Column<CompanyDue>[] = [
    { key: 'company', header: 'Company', sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id), render: (c) => <span><span className="num text-gold">{companyCode(c.company_id)}</span> <span className="text-ink">· {companyName(c.company_id)}</span></span> },
    ...DUE.map((s): Column<CompanyDue> => ({
      key: s.field, header: s.label, align: 'center', width: 130, sort: (c) => c[s.field], csv: (c) => c[s.field],
      render: (c) => (c[s.field] === 0 ? <span className="num text-muted">0</span>
        : <button className={cx('num inline-grid h-8 min-w-[52px] place-items-center rounded-md px-2 text-[13px] font-medium', s.soft || 'bg-surface2', s.text)} onClick={(e) => { e.stopPropagation(); setOnly({ company: c.company_id, state: s.key }) }} aria-label={`${c[s.field]} ${s.label.toLowerCase()} in ${companyName(c.company_id)}: show them`}>{c[s.field]}</button>),
    })),
    { key: 'total', header: 'All', align: 'right', width: 90, sort: (c) => total(c), csv: (c) => total(c), render: (c) => <span className="num text-ink">{total(c)}</span> },
  ]

  const columns: Column<Deadline>[] = [
    { key: 'due', header: 'Due', sort: (r) => r.due, csv: (r) => r.due, render: (r) => <div><div className="num text-[12.5px] text-ink">{fmtDate(r.due)}</div><div className={cx('text-[11px]', r.days < 0 ? 'text-neg' : r.days <= 7 ? 'text-warn' : 'text-muted')}>{whenText(r.days)}</div></div> },
    { key: 'state', header: 'Falls', width: 120, sort: (r) => DUE.findIndex((x) => x.key === r.state), csv: (r) => r.state, render: (r) => <span className={cx('chip', DUE.find((x) => x.key === r.state)?.chip)}>{r.state}</span> },
    { key: 'company', header: 'Company', width: 100, sort: (r) => companyName(r.item.company_id), csv: (r) => companyName(r.item.company_id), render: (r) => <span className="text-ink2" title={companyName(r.item.company_id)}>{companyCode(r.item.company_id)}</span> },
    { key: 'ref', header: 'Reference', sort: (r) => r.item.ref_no, csv: (r) => r.item.ref_no, render: (r) => <span className="num text-[12.5px] text-gold">{r.item.ref_no}</span> },
    { key: 'title', header: 'What is due', sort: (r) => r.item.title.toLowerCase(), csv: (r) => r.item.title, render: (r) => <div className="min-w-0"><div className="text-ink">{r.item.title}</div><div className="text-[11.5px] text-muted">{kindName(r.item.kind)}{r.item.frequency !== 'once' ? ` · ${human(r.item.frequency)}` : ''}</div></div> },
    { key: 'owner', header: 'Who answers for it', sort: (r) => (r.item.owner_name ?? '').toLowerCase(), csv: (r) => r.item.owner_name ?? '', render: (r) => (r.item.owner_name ? <span className="text-ink2">{r.item.owner_name}</span> : <span className="text-[12px] text-warn">no owner recorded</span>) },
    { key: 'amount', header: 'Amount recorded', align: 'right', sort: (r) => D(r.item.amount).toNumber(), csv: (r) => `${D(r.item.amount).toFixed(2)} ${r.item.currency}`, render: (r) => (D(r.item.amount).isZero() ? <span className="text-muted" title="No amount is recorded on the item">—</span> : <Money value={r.item.amount} currency={r.item.currency} />) },
    { key: 'open', header: '', align: 'right', render: () => <span className="link inline-flex items-center gap-1 text-[12.5px]">Open <ExternalLink size={11} /></span> },
  ]

  return (
    <div>
      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Reading the registers" /></Panel>}
      {d && (
        <>
          <Panel className="mb-4 p-4" lit={false}>
            <div className="label">Kinds of register item counted as deadlines</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {present.map(([k, n]) => (
                <label key={k} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink2">
                  <input type="checkbox" checked={ticked.includes(k)} onChange={(e) => { setOnly({}); setTicked(e.target.checked ? [...ticked, k] : ticked.filter((x) => x !== k)) }} /> {kindName(k)} <span className="num text-[11px] text-muted">{n}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 text-[11.5px] text-muted">Counted: active register items of the kinds ticked that carry a next due date and are not marked paid, closed, resolved or cancelled. As at {fmtDate(asOf)}. The number beside each kind is how many of its active items carry a due date.</div>
          </Panel>

          {left.length > 0 && <Note kind="warn" className="mb-4"><strong className="text-ink">Not complete.</strong> Your role does not read the registers (register.view) of {left.map((id) => companyCode(id)).join(', ')}. Deadlines of {left.length === 1 ? 'that company' : 'those companies'} are not shown here.</Note>}
          {undated > 0 && <Note className="mb-4">{plural(undated, 'active item', 'active items')} of the kinds ticked {undated === 1 ? 'carries' : 'carry'} no due date and cannot appear among the deadlines. <button className="link" onClick={() => nav('/registers')}>Open the registers</button> to give {undated === 1 ? 'it' : 'them'} one.</Note>}

          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {DUE.map((s) => {
              const n = sumOf(s.field)
              const on = only.state === s.key && !only.company
              return <Tile key={s.key} label={s.label} tone={n ? s.text : 'text-muted'} onClick={() => setOnly(on ? {} : { state: s.key })} sub={s.meaning}><span className="num">{n}</span></Tile>
            })}
          </div>

          <Section title="By company" className="mb-4">
            <Panel lit={false}>
              <DataTable columns={matrix} rows={byCompany} rowKey={(c) => c.company_id} onRow={(c) => setOnly({ company: c.company_id })} pageSize={50} exportName="compliance-deadlines-by-company"
                toolbar={<span className="text-[12px] text-muted">A figure opens the deadlines behind it. A company at nought has no deadline recorded of the kinds ticked; that is a statement about the register, not about the law.</span>} />
            </Panel>
          </Section>

          <Section title="Deadlines, the earliest first">
            <Panel lit={false}>
              <DataTable key={`${only.company ?? ''}|${only.state ?? ''}|${ticked.join(',')}`} columns={columns} rows={shown} rowKey={(r) => r.item.id} onRow={(r) => nav('/registers/' + r.item.id)} exportName="compliance-deadlines"
                rowClass={(r) => (r.state === 'overdue' ? 'bg-negsoft' : undefined)}
                toolbar={<>
                  <CalendarClock size={15} className="text-gold" />
                  <span className="text-[12.5px] text-ink2"><span className="num text-ink">{shown.length}</span> deadline{shown.length === 1 ? '' : 's'}</span>
                  {only.company && <button className="chip gold" onClick={() => setOnly({ ...only, company: undefined })} title="Clear this filter">{companyCode(only.company)} ×</button>}
                  {only.state && <button className="chip gold" onClick={() => setOnly({ ...only, state: undefined })} title="Clear this filter">{only.state} ×</button>}
                </>}
                empty={!ticked.length ? { title: 'No kind is ticked', body: 'Tick at least one kind of register item.' }
                  : view.rows.length === 0 ? { title: 'No deadline is recorded', body: 'No active register item of the kinds ticked carries a due date in the companies you can read. NUMERO shows the deadlines that people have recorded; it does not know of one that nobody has entered.', icon: <CalendarClock size={20} /> }
                    : { title: 'Nothing in this list', body: 'No deadline matches the company and the state chosen.', icon: <CalendarClock size={20} /> }} />
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">NUMERO files nothing and pays nothing. A deadline leaves this list when a person records on the register item that it has been met, or moves its next due date.</div>
          </Section>
        </>
      )}
    </div>
  )
}

// ====================================================================== what is for the owner
interface Item { key: string; class: AttentionClass; source: 'Sentinel' | 'Notice'; title: string; body: string; kind: string; company_id: ID | null; at: string; to: string; record: string | null; state: string | null }
const PREFIX = /^ANOMALY DETECTED\s*[—–-]\s*/i
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const TONE: Record<AttentionClass, { text: string; tone: string }> = {
  information: { text: 'text-ink2', tone: 'muted' }, finance_action: { text: 'text-cyan', tone: 'cyan' }, management_action: { text: 'text-warn', tone: 'warn' },
  owner_action: { text: 'text-gold', tone: 'gold' }, critical: { text: 'text-neg', tone: 'neg' },
}
const IMPLIED: [Alert['attention'], AttentionClass][] = [['info', 'information'], ['review', 'finance_action'], ['priority', 'management_action'], ['critical', 'critical']]

/** The screen of the record a notice or an alert is about, where there is one. */
function recordOf(entity: string | null, id: ID | null): string | null {
  switch (entity) {
    case 'journals': case 'journal': return id ? '/journals/' + id : null
    case 'register_items': return id ? '/registers/' + id : null
    case 'fixed_assets': return id ? '/assets/' + id : null
    case 'cases': return id ? '/reality/cases/' + id : null
    case 'payments': return '/payments'
    case 'tasks': return '/tasks'
    case 'bank_accounts': return '/banking'
    default: return null
  }
}

function Attention({ ids, left }: { ids: ID[]; left: number }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companyCode = useCompanyCode()
  const idsKey = ids.join(',')
  const [opened, setOpened] = useState<AttentionClass | null>(null)

  const main = useAsync(async () => {
    const [alerts, rules, notices] = await Promise.all([api.listAlerts(ids), api.listAttentionRules(), api.listNotifications({ unreadOnly: true })])
    return { alerts, rules, notices }
  }, [api, idsKey])
  const d = main.data

  const items: Item[] = useMemo(() => {
    if (!d) return []
    const fromAlerts = d.alerts.filter((a) => a.status === 'open' || a.status === 'reviewing').map((a): Item => ({
      key: 'a' + a.id, class: attentionOf(a, d.rules), source: 'Sentinel', title: sentence(a.title.replace(PREFIX, '')), body: a.explanation, kind: a.kind, company_id: a.company_id, at: a.created_at,
      to: '/sentinel?alert=' + a.id, record: recordOf(a.entity, a.entity_id), state: a.status,
    }))
    const fromNotices = d.notices.map((n): Item => ({
      key: 'n' + n.id, class: n.class, source: 'Notice', title: n.title, body: n.body ?? '', kind: n.kind, company_id: n.company_id, at: n.created_at,
      to: '/notifications', record: n.kind === 'approval_waiting_long' ? '/approvals' : recordOf(n.entity, n.entity_id), state: n.mandatory ? 'cannot be switched off' : null,
    }))
    return [...fromAlerts, ...fromNotices].sort((a, b) => b.at.localeCompare(a.at))
  }, [d])
  const split = useMemo(() => forOwner(items), [items])
  const rank = (c: AttentionClass) => ATTENTION.find((x) => x.key === c)?.rank ?? 0
  const mine = [...split.owner].sort((a, b) => rank(b.class) - rank(a.class) || b.at.localeCompare(a.at))
  const of = (c: AttentionClass) => items.filter((i) => i.class === c)

  const columns: Column<Item>[] = [
    { key: 'title', header: 'What', sort: (i) => i.title.toLowerCase(), csv: (i) => i.title, render: (i) => <div className="min-w-0"><div className="text-ink">{i.title}</div><div className="line-clamp-2 text-[11.5px] text-muted">{i.body}</div></div> },
    { key: 'source', header: 'From', width: 110, sort: (i) => i.source, csv: (i) => i.source, render: (i) => <span className={cx('chip', i.source === 'Sentinel' ? 'violet' : 'cyan')}>{i.source}</span> },
    { key: 'kind', header: 'Kind', sort: (i) => i.kind, csv: (i) => human(i.kind), render: (i) => <span className="text-[12.5px] text-ink2">{sentence(human(i.kind))}</span> },
    { key: 'company', header: 'Company', width: 100, sort: (i) => companyCode(i.company_id), csv: (i) => companyCode(i.company_id), render: (i) => <span className="text-ink2">{companyCode(i.company_id)}</span> },
    { key: 'at', header: 'Since', width: 170, sort: (i) => i.at, csv: (i) => i.at, render: (i) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(i.at)}</span> },
    { key: 'open', header: '', align: 'right', render: (i) => (i.record ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav(i.record!) }}>The record <ExternalLink size={11} /></button> : null) },
  ]

  return (
    <div>
      <Note className="mb-4">
        <strong className="text-ink">The owner is shown what needs the owner.</strong> Routine bookkeeping stays with the finance team. The class of each item is decided by the rules of the group, set by a Group Super Admin under <button className="link" onClick={() => nav('/notifications?tab=rules')}>Notifications → Rules</button>{d ? <> ({plural(d.rules.length, 'rule', 'rules')} in force)</> : null}. Where no rule speaks of a kind of alert, its class follows the seriousness Sentinel gave it: {IMPLIED.map(([a, c], i) => <span key={a}>{i > 0 && ', '}{a} → {human(c)}</span>)}.
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Reading what is open" /></Panel>}

      {d && (
        <>
          {left > 0 && <Note kind="warn" className="mb-4"><strong className="text-ink">Not complete.</strong> Your role does not read Sentinel (sentinel.view) in {plural(left, 'of the selected companies', 'of the selected companies')}. What was raised there is not counted here.</Note>}

          <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {ATTENTION.map((a) => {
              const list = of(a.key)
              const own = a.key === 'owner_action' || a.key === 'critical'
              return (
                <Panel key={a.key} className={cx('p-4', opened === a.key && 'border-gold/50')} attention={a.key === 'critical' && list.length > 0}
                  onClick={own ? undefined : () => setOpened(opened === a.key ? null : a.key)} title={own ? 'Shown in full below' : opened === a.key ? 'Click to close the list' : 'Click to list these'}>
                  <div className="flex items-center gap-2"><span className={cx('lamp', list.length > 0 && TONE[a.key].tone !== 'muted' && TONE[a.key].tone, a.key === 'critical' && list.length > 0 && 'pulse')} /><span className="eyebrow">{a.label}</span></div>
                  <div className={cx('num mt-2.5 text-[26px] leading-none', list.length ? TONE[a.key].text : 'text-muted')}>{list.length}</div>
                  <div className="mt-2 text-[11px] text-muted">{a.meaning}</div>
                  <div className="mt-1 text-[11px] text-muted">{list.filter((i) => i.source === 'Sentinel').length} from Sentinel · {list.filter((i) => i.source === 'Notice').length} notice{list.filter((i) => i.source === 'Notice').length === 1 ? '' : 's'}</div>
                </Panel>
              )
            })}
          </div>

          <Section title="For the owner — owner action and critical" className="mb-4" right={<span className="text-[11.5px] text-muted">{mine.length} open</span>}>
            {mine.length === 0 ? (
              <Panel><Empty icon={<BellRing size={20} />} title="Nothing is waiting for the owner" body={<>No open alert and no unread notice is classed as owner action or critical in the companies you can read. {split.others.length > 0 ? `${plural(split.others.length, 'item is', 'items are')} open for the finance team and management, below.` : 'Nothing else is open either.'}</>} /></Panel>
            ) : (
              <div className="space-y-2.5">
                {mine.map((i) => (
                  <Panel key={i.key} className="p-4" lit={false} attention={i.class === 'critical'}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <AttentionChip value={i.class} />
                          <span className={cx('chip', i.source === 'Sentinel' ? 'violet' : 'cyan')}>{i.source}</span>
                          {i.state && (i.source === 'Sentinel' ? <StatusChip status={i.state} /> : <span className="chip">{i.state}</span>)}
                          <span className="text-[11.5px] text-muted">{companyCode(i.company_id)} · {sentence(human(i.kind))} · <span className="num">{fmtDateTime(i.at)}</span></span>
                        </div>
                        <div className="text-[13.5px] font-medium text-ink">{i.title}</div>
                        {i.body && <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink2">{i.body}</p>}
                      </div>
                      <div className="flex flex-none flex-wrap items-center gap-2">
                        {i.record && <button className="btn sm" onClick={() => nav(i.record!)}><ExternalLink size={13} /> Open the record</button>}
                        <button className="btn sm primary" onClick={() => nav(i.to)}>{i.source === 'Sentinel' ? 'Open in Sentinel' : 'Open the notices'}</button>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </Section>

          <Section title="For others — not shown to the owner first">
            <div className="space-y-2.5">
              {ATTENTION.filter((a) => a.key !== 'owner_action' && a.key !== 'critical').slice().reverse().map((a) => {
                const list = of(a.key)
                const on = opened === a.key
                return (
                  <Panel key={a.key} lit={false}>
                    <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpened(on ? null : a.key)} aria-expanded={on}>
                      {on ? <ChevronDown size={15} className="flex-none text-muted" /> : <ChevronRight size={15} className="flex-none text-muted" />}
                      <AttentionChip value={a.key} />
                      <span className="min-w-0 flex-1 text-[12.5px] text-ink2">{a.meaning}</span>
                      <span className={cx('num text-[15px]', list.length ? TONE[a.key].text : 'text-muted')}>{list.length}</span>
                    </button>
                    {on && (
                      <div className="border-t border-line">
                        <DataTable columns={columns} rows={list} rowKey={(i) => i.key} onRow={(i) => nav(i.to)} pageSize={25} exportName={`attention-${a.key}`} initialSort={{ key: 'at', dir: 'desc' }}
                          empty={{ title: 'Nothing open in this class', body: 'No open alert and no unread notice falls in this class in the companies you can read.' }} />
                      </div>
                    )}
                  </Panel>
                )
              })}
            </div>
            <div className="mt-2 text-[11.5px] text-muted">Counted: alerts of Sentinel that are open or under review, and your own unread notices. An alert is closed in Sentinel by a person, with a note; nothing is closed from this screen.</div>
          </Section>
        </>
      )}
    </div>
  )
}
