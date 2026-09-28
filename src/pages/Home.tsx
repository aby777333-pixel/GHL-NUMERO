import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  ArrowUpRight, BadgeCheck, Banknote, Building2, CircleDollarSign, Coins, HandCoins, Landmark, PiggyBank, Radar, Receipt, Scale, ShieldCheck, Sparkles,
  TrendingDown, TrendingUp, Wallet,
} from 'lucide-react'
import { useApp, useCurrency, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { companyFigures, ledgerLink, monthlySeries, openDocuments, statements, sumBase } from '@/lib/data'
import { isBorrowing, isCash, isCurrentAsset, isCurrentLiability } from '@/engine/reports'
import { D, pctChange, ZERO } from '@/lib/money'
import { addMonths, fmtDate, fmtMonth, previousPeriod, startOfMonth, today } from '@/lib/dates'
import { CountUp, cx, Delta, ErrorBox, Explain, Loading, Money, PageHeader, Panel, Section, Truth } from '@/ui/kit'
import { Donut, Sparkline, TrendChart, colorAt } from '@/ui/charts'
import { contextualPrompts } from '@/numi/engine'
import { HomeBeyond } from '@/ui/HomeBeyond'

interface Tile { key: string; label: string; simple: string; value: Decimal; icon: ReactNode; to: string; delta?: Decimal | null; invert?: boolean; spark?: number[]; explain: string; formula?: string; tone?: string }

export default function Home() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const group = useApp((s) => s.session?.group)
  const scope = useApp((s) => s.scope)
  const setScope = useApp((s) => s.setScope)
  const simple = useApp((s) => s.simple)
  const setSimple = useApp((s) => s.setSimple)
  const askNumi = useApp((s) => s.askNumi)
  const asOf = useApp((s) => s.asOf)
  const knownAt = useApp((s) => s.knownAt)
  const ids = useScopeIds()
  const period = usePeriod()
  const currency = useCurrency()
  const [q, setQ] = useState('')

  const to = asOf ?? (period.to > today() ? today() : period.to)
  const from = asOf && period.from > asOf ? startOfMonth(asOf) : period.from
  const accs = accounts.filter((a) => ids.includes(a.company_id))

  const main = useAsync(async () => {
    const prev = previousPeriod({ ...period, from, to })
    const trendFrom = startOfMonth(addMonths(to, -11))
    const [now, was, figs, series, integrity, invoices, approvals, alerts] = await Promise.all([
      statements(api, companies, accs, ids, from, to, knownAt),
      statements(api, companies, accs, ids, prev.from, prev.to, knownAt),
      companyFigures(api, companies, accounts, ids, from, to, knownAt),
      monthlySeries(api, accs, ids, trendFrom, to),
      api.integrityCheck(ids),
      api.listInvoices({ companyIds: ids }),
      api.listApprovalRequests(ids),
      api.listAlerts(ids),
    ])
    const docs = openDocuments(invoices, to)
    return { now, was, figs, series, integrity, docs, approvals: approvals.filter((a) => a.status === 'pending'), alerts: alerts.filter((a) => a.status === 'open' || a.status === 'reviewing') }
  }, [api, ids.join(','), from, to, knownAt, accounts.length])

  const title = scope.length === 1 ? companies.find((c) => c.id === scope[0])?.name ?? '' : group?.name ?? 'Group'

  if (!companies.length) {
    return (
      <div>
        <PageHeader eyebrow="Group Command Centre" title={title} />
        <Panel className="p-2">
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-gold/30 bg-goldsoft text-gold"><Building2 size={24} /></div>
            <div className="display text-[19px]">Your universe is ready for its first company</div>
            <p className="max-w-md text-[13.5px] text-muted">Create a company from a template. NUMERO recommends a chart of accounts and tax configuration, and nothing becomes active until you confirm it.</p>
            <button className="btn primary mt-2" onClick={() => nav('/companies?new=1')}>Create the first company</button>
          </div>
        </Panel>
      </div>
    )
  }

  const d = main.data
  const tiles: Tile[] = d ? (() => {
    const { pl, bs } = d.now, p = d.was.pl
    const pos = d.now.position
    const idsOf = (f: (a: (typeof accs)[number]) => boolean) => pos.filter((b) => f(b.account)).map((b) => b.account.id)
    const plIds = (type: 'income' | 'expense') => d.now.period.filter((b) => b.account.type === type).map((b) => b.account.id)
    return [
      { key: 'cash', label: scope.length === 1 ? 'Total cash' : 'Total group cash', simple: 'Money we have', value: bs.cash, icon: <Banknote size={16} />, to: ledgerLink({ accounts: idsOf(isCash), to }), spark: d.series.cash, explain: 'Cash in hand and balances in bank accounts, as recorded in the books.', tone: 'gold' },
      { key: 'rev', label: 'Total revenue', simple: 'Money in', value: pl.totalIncome, icon: <TrendingUp size={16} />, to: '/reports/money-came', delta: pctChange(pl.totalIncome, p.totalIncome), spark: d.series.income, explain: 'All income earned in the selected period: revenue from operations plus other income.', formula: 'Revenue from operations + Other income' },
      { key: 'exp', label: 'Total expense', simple: 'Money out', value: pl.totalExpense, icon: <TrendingDown size={16} />, to: '/reports/money-went', delta: pctChange(pl.totalExpense, p.totalExpense), invert: true, spark: d.series.expense, explain: 'All costs recognised in the selected period.', formula: 'COGS + Employee costs + Operating expenses + Depreciation + Finance costs + Exceptional items + Tax' },
      { key: 'pat', label: 'Net profit / loss', simple: 'Profit', value: pl.pat, icon: <Scale size={16} />, to: '/reports/pnl', delta: pctChange(pl.pat, p.pat), spark: d.series.profit, explain: 'What is left after every cost of the period has been deducted from income.', formula: 'Total income − Total expense' },
      { key: 'ar', label: 'Receivables', simple: 'People owe us', value: bs.receivables, icon: <HandCoins size={16} />, to: '/parties/owed?side=in', explain: 'Money customers currently owe for recorded invoices.' },
      { key: 'ap', label: 'Payables', simple: 'We owe people', value: bs.payables, icon: <Receipt size={16} />, to: '/parties/owed?side=out', invert: true, explain: 'Money owed to suppliers for recorded bills.' },
      { key: 'assets', label: 'Assets', simple: 'Everything we own', value: bs.totalAssets, icon: <Coins size={16} />, to: '/reports/balance-sheet', explain: 'Everything the business owns or is owed, at recorded value.' },
      { key: 'liab', label: 'Liabilities', simple: 'Everything we owe', value: bs.totalLiabilities, icon: <CircleDollarSign size={16} />, to: '/reports/balance-sheet', invert: true, explain: 'Everything the business owes to others.' },
      { key: 'debt', label: 'Borrowings', simple: 'Loans', value: bs.borrowings, icon: <Landmark size={16} />, to: ledgerLink({ accounts: idsOf(isBorrowing), to }), invert: true, explain: 'Loans and credit facilities outstanding.' },
      { key: 'inv', label: 'Investments', simple: 'Investments', value: bs.investments, icon: <PiggyBank size={16} />, to: ledgerLink({ accounts: idsOf((a) => a.type === 'asset' && a.subtype === 'investment'), to }), explain: 'Investments and fixed deposits at recorded value.' },
      { key: 'wc', label: 'Working capital', simple: 'Short-term cushion', value: bs.workingCapital, icon: <Wallet size={16} />, to: '/reports/ratios', explain: 'Short-term assets less short-term obligations. A measure of day-to-day financial room.', formula: 'Current assets − Current liabilities' },
    ].map((t) => ({ ...t, to: t.to || ledgerLink({ accounts: [...idsOf(isCurrentAsset), ...idsOf(isCurrentLiability), ...plIds('income')] }) }))
  })() : []

  const overdue = d ? d.docs.filter((x) => x.side === 'in' && x.daysOverdue > 0) : []
  const dueSoon = d ? d.docs.filter((x) => x.side === 'out' && x.daysOverdue > -8) : []
  const expenseMix = d ? [d.now.pl.lines.find((l) => l.key === 'cogs'), d.now.pl.lines.find((l) => l.key === 'employee'), d.now.pl.lines.find((l) => l.key === 'opex'), d.now.pl.lines.find((l) => l.key === 'finance'), d.now.pl.lines.find((l) => l.key === 'depreciation'), d.now.pl.lines.find((l) => l.key === 'exceptional')]
    .filter((l) => l && l.amount.gt(0)).map((l, i) => ({ label: l!.label, value: l!.amount.toNumber(), color: colorAt(i), id: l!.key })) : []
  const balanced = d ? d.integrity.unbalanced_journals === 0 && D(d.integrity.total_debits).eq(d.integrity.total_credits) && d.now.bs.balanced : true

  return (
    <div>
      <PageHeader
        eyebrow={scope.length === 1 ? 'Company Command Centre' : 'Group Command Centre'}
        title={title}
        truth={mode === 'demo' ? 'DEMO' : 'ACTUAL'}
        subtitle={<>{period.label} · {fmtDate(from)} – {fmtDate(to)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · figures in {currency}</>}
        actions={<>
          <div className="flex items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label="Presentation level">
            {[['Simple', true], ['Professional', false]].map(([l, v]) => (
              <button key={String(l)} onClick={() => setSimple(v as boolean)} aria-pressed={simple === v} className={cx('h-[28px] rounded-lg px-3 text-[11.5px] font-medium transition-colors', simple === v ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{l}</button>
            ))}
          </div>
          <button className="btn" onClick={() => nav('/cockpit')}>Enter cockpit <ArrowUpRight size={14} /></button>
        </>}
      />

      {/* ASK NUMERO — the centre of the home screen */}
      <Panel className="mb-5 overflow-hidden p-5 fade-up" hud>
        <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { askNumi(q.trim()); setQ('') } }}>
          <div className="grid h-11 w-11 flex-none place-items-center rounded-xl border border-gold/30 bg-goldsoft text-gold"><Sparkles size={19} /></div>
          <input className="h-11 min-w-[220px] flex-1 border-0 bg-transparent text-[17px] text-ink outline-none placeholder:text-muted" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your financial universe…" aria-label="Ask NUMERO" />
          <button className="btn primary h-10" disabled={!q.trim()}>Ask NUMERO</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {contextualPrompts('/').map((p) => <button key={p} className="rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-ink2 transition-colors hover:border-gold/40 hover:text-ink" onClick={() => askNumi(p)}>{p}</button>)}
        </div>
      </Panel>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} /></Panel>}

      {d && (
        <>
          <div className="stagger mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {tiles.map((t) => (
              <Panel key={t.key} className="p-4" onClick={() => nav(t.to)} title="Click to see what makes up this figure">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-muted"><span className="text-gold">{t.icon}</span><span className="eyebrow truncate">{simple ? t.simple : t.label}</span></div>
                  <Explain title={t.label} text={t.explain} formula={t.formula} inputs={[{ label: t.label, value: t.value }]} />
                </div>
                <div className="mt-2.5 flex items-end justify-between gap-2">
                  <CountUp value={t.value} className={cx('text-[22px] leading-none', t.key === 'pat' && (t.value.lt(0) ? 'text-neg' : 'text-pos'))} />
                  {t.spark && t.spark.length > 1 && <Sparkline values={t.spark} width={74} height={28} color={t.key === 'exp' ? 'var(--neg)' : t.key === 'cash' ? 'var(--gold)' : 'var(--cyan)'} />}
                </div>
                <div className="mt-2 flex h-[22px] items-center gap-2">
                  {t.delta !== undefined ? <><Delta value={t.delta} invert={t.invert} label="Against the preceding period of equal length" /><span className="text-[11px] text-muted">vs previous period</span></> : <span className="text-[11px] text-muted">as at {fmtDate(to)}</span>}
                </div>
              </Panel>
            ))}
            <Panel className="p-4" onClick={() => nav('/reports/trial-balance')} attention={!balanced}>
              <div className="flex items-center gap-2"><span className={balanced ? 'text-pos' : 'text-neg'}><ShieldCheck size={16} /></span><span className="eyebrow">Integrity</span></div>
              <div className={cx('display mt-2.5 text-[15px] font-medium leading-tight', balanced ? 'text-pos' : 'text-neg')}>{balanced ? 'ALL BOOKS BALANCED' : 'INTEGRITY ALERT'}</div>
              <div className="mt-2 text-[11px] leading-snug text-muted"><span className="num">{d.integrity.posted_journals.toLocaleString()}</span> posted journals re-added · debits {balanced ? '=' : '≠'} credits</div>
            </Panel>
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Panel className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="eyebrow">Twelve-month movement</div><div className="display mt-0.5 text-[15px]">Income, expense and cash</div></div>
                <Truth state="ACTUAL" />
              </div>
              <TrendChart labels={d.series.months.map(fmtMonth)} height={270}
                series={[{ name: 'Income', color: 'var(--pos)', values: d.series.income }, { name: 'Expense', color: 'var(--neg)', values: d.series.expense }, { name: 'Cash balance', color: 'var(--gold)', values: d.series.cash, dashed: true }]}
                onPoint={(i) => nav(`/reports/pnl?from=${d.series.months[i]}&to=${addMonths(d.series.months[i], 1)}`)} />
            </Panel>

            <Panel className="p-5">
              <div className="mb-3 flex items-center justify-between"><div><div className="eyebrow">Requires attention</div><div className="display mt-0.5 text-[15px]">What needs you next</div></div><Radar size={17} className="text-gold" /></div>
              <div className="space-y-1.5">
                <Attn n={d.approvals.length} label="awaiting approval" sub={d.approvals.length ? `Largest ${''}` : 'Nothing is waiting'} amount={d.approvals.reduce((m, a) => Decimal.max(m, a.amount), ZERO)} to="/approvals" icon={<BadgeCheck size={15} />} tone={d.approvals.length ? 'warn' : 'pos'} nav={nav} />
                <Attn n={d.alerts.length} label="Sentinel anomalies open" sub="Factual patterns for review" to="/sentinel" icon={<Radar size={15} />} tone={d.alerts.some((a) => a.attention === 'priority' || a.attention === 'critical') ? 'neg' : d.alerts.length ? 'warn' : 'pos'} nav={nav} />
                <Attn n={overdue.length} label="customer invoices overdue" amount={sumBase(overdue)} to="/parties/owed?side=in" icon={<HandCoins size={15} />} tone={overdue.length ? 'neg' : 'pos'} nav={nav} />
                <Attn n={dueSoon.length} label="bills due within 7 days or overdue" amount={sumBase(dueSoon)} to="/forward" icon={<Receipt size={15} />} tone={dueSoon.length ? 'warn' : 'pos'} nav={nav} />
                <Attn n={d.integrity.unreconciled_bank_lines} label="bank lines unreconciled" to="/banking" icon={<Landmark size={15} />} tone={d.integrity.unreconciled_bank_lines ? 'warn' : 'pos'} nav={nav} />
                <Attn n={d.integrity.drafts + d.integrity.approved_unposted} label="drafts and approved entries not yet posted" to="/journals" icon={<Receipt size={15} />} tone="cyan" nav={nav} />
              </div>
            </Panel>
          </div>

          {!asOf && <HomeBeyond />}

          <Section title={scope.length === 1 ? 'Company' : 'Companies — click to enter a financial universe'} className="mb-5"
            right={scope.length > 0 ? <button className="btn sm ghost" onClick={() => setScope([])}>Show whole group</button> : undefined}>
            <div className="stagger grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {d.figs.map((f) => (
                <Panel key={f.company.id} className="p-4" onClick={() => { setScope([f.company.id]); window.scrollTo(0, 0) }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10.5px] text-gold">{f.company.code}</span><span className="truncate text-[11.5px] text-muted">{f.company.industry}</span></div>
                      <div className="display mt-1.5 truncate text-[16px] font-medium">{f.company.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="eyebrow">{f.pl.pat.lt(0) ? 'Loss' : 'Profit'}</div>
                      <Money value={f.pl.pat} compact className={cx('text-[16px]', f.pl.pat.lt(0) ? 'text-neg' : 'text-pos')} />
                    </div>
                  </div>
                  <div className="hairline my-3" />
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                    {[['Revenue', f.pl.totalIncome], ['Expense', f.pl.totalExpense], ['Cash', f.bs.cash], ['Receivables', f.bs.receivables], ['Payables', f.bs.payables], ['Borrowings', f.bs.borrowings]].map(([l, v]) => (
                      <div key={String(l)}><div className="text-[10.5px] uppercase tracking-[0.1em] text-muted">{String(l)}</div><Money value={v as Decimal} compact className="text-[13.5px]" /></div>
                    ))}
                  </div>
                </Panel>
              ))}
            </div>
            {d.figs.length > 1 && <div className="mt-2 text-[11.5px] text-muted">Company cards show each entity's own books. Group totals above are simple sums; intercompany balances are eliminated in the consolidation report.</div>}
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel className="p-5">
              <div className="mb-3"><div className="eyebrow">Cost DNA</div><div className="display mt-0.5 text-[15px]">What the expense is made of</div></div>
              {expenseMix.length ? <Donut data={expenseMix} onSlice={() => nav('/reports/money-went')} centre={<div><div className="text-[10.5px] uppercase tracking-[0.12em] text-muted">Total</div><Money value={d.now.pl.totalExpense} compact className="text-[15px]" /></div>} /> : <div className="py-10 text-center text-[13px] text-muted">No expense has been recorded in this period.</div>}
            </Panel>
            <Panel className="p-5">
              <div className="mb-3"><div className="eyebrow">Largest receivables</div><div className="display mt-0.5 text-[15px]">Who owes us the most</div></div>
              <TopParties docs={d.docs.filter((x) => x.side === 'in')} nav={nav} />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Attn({ n, label, sub, amount, to, icon, tone, nav }: { n: number; label: string; sub?: string; amount?: Decimal; to: string; icon: ReactNode; tone: 'pos' | 'warn' | 'neg' | 'cyan'; nav: (to: string) => void }) {
  return (
    <button onClick={() => nav(to)} className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-all hover:border-line2 hover:bg-surface2">
      <span className={cx('lamp', tone, n > 0 && tone !== 'pos' && tone !== 'cyan' && 'pulse')} />
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1 text-[13px]"><span className="num font-semibold text-ink">{n}</span> <span className="text-ink2">{label}</span>{sub && n === 0 && <span className="text-muted"> · {sub}</span>}</span>
      {amount && amount.gt(0) && <Money value={amount} compact className="text-[12.5px] text-ink2" />}
      <ArrowUpRight size={14} className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold" />
    </button>
  )
}

function TopParties({ docs, nav }: { docs: ReturnType<typeof openDocuments>; nav: (to: string) => void }) {
  const parties = useApp((s) => s.parties)
  const by = new Map<string, { total: Decimal; overdue: Decimal }>()
  for (const d of docs) {
    const e = by.get(d.invoice.party_id) ?? { total: ZERO, overdue: ZERO }
    e.total = e.total.plus(d.outstandingBase)
    if (d.daysOverdue > 0) e.overdue = e.overdue.plus(d.outstandingBase)
    by.set(d.invoice.party_id, e)
  }
  const rows = [...by.entries()].sort((a, b) => b[1].total.cmp(a[1].total)).slice(0, 6)
  const max = rows[0]?.[1].total ?? new Decimal(1)
  if (!rows.length) return <div className="py-10 text-center text-[13px] text-muted">No customer invoices are outstanding.</div>
  return (
    <div className="space-y-2.5">
      {rows.map(([id, v]) => (
        <button key={id} onClick={() => nav('/parties/' + id)} className="block w-full rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface2">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate text-ink">{parties.find((p) => p.id === id)?.display_name ?? 'Unknown party'}</span>
            <span className="flex flex-none items-center gap-2">{v.overdue.gt(0) && <span className="chip neg">overdue</span>}<Money value={v.total} compact /></span>
          </div>
          <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-surface2">
            <div className="h-full rounded-full" style={{ width: `${v.total.div(max).times(100).toNumber()}%`, background: 'linear-gradient(90deg, var(--gold), var(--cyan))' }} />
          </div>
        </button>
      ))}
    </div>
  )
}
