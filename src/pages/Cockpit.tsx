import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  BadgeCheck, Banknote, Building2, HandCoins, Landmark, Lock, LogOut, Radar, Receipt, Scale, ScrollText, ShieldAlert, ShieldCheck, Sparkles,
  TrendingDown, TrendingUp,
} from 'lucide-react'
import { useApp, useCurrency, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { companyFigures, monthlySeries, openDocuments, statements, sumBase } from '@/lib/data'
import { joinBalances, ratios, type Ratio } from '@/engine/reports'
import { D, sum, ZERO } from '@/lib/money'
import { addMonths, daysBetween, fmtDate, fmtMonth, startOfMonth, today } from '@/lib/dates'
import { CountUp, cx, Empty, ErrorBox, Explain, Loading, Money, Panel, Truth } from '@/ui/kit'
import { Gauge, TrendChart } from '@/ui/charts'

type Lamp = 'pos' | 'neg' | 'warn' | 'cyan' | 'gold'
type Tone = 'gold' | 'pos' | 'warn' | 'neg' | 'cyan'

interface Instrument {
  key: string
  label: string
  icon: ReactNode
  lamp: Lamp
  attention: boolean
  onClick: () => void
  body: ReactNode
  foot: ReactNode
  hint: string
}

interface GaugeSpec { ratio: Ratio; value: number; label: string; tone: Tone; text: string }

export default function Cockpit() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const group = useApp((s) => s.session?.group)
  const scope = useApp((s) => s.scope)
  const setScope = useApp((s) => s.setScope)
  const askNumi = useApp((s) => s.askNumi)
  const effects = useApp((s) => s.effects)
  const asOf = useApp((s) => s.asOf)
  const knownAt = useApp((s) => s.knownAt)
  const ids = useScopeIds()
  const period = usePeriod()
  const currency = useCurrency()

  const to = asOf ?? (period.to > today() ? today() : period.to)
  const from = asOf && period.from > asOf ? startOfMonth(asOf) : period.from
  const accs = accounts.filter((a) => ids.includes(a.company_id))
  const fx = effects !== 'off'

  const main = useAsync(async () => {
    const trendFrom = startOfMonth(addMonths(to, -11))
    const [now, figs, series, integrity, alerts, approvals, invoices, periods, taxRows] = await Promise.all([
      statements(api, companies, accs, ids, from, to, knownAt),
      companyFigures(api, companies, accounts, ids, from, to, knownAt),
      monthlySeries(api, accs, ids, trendFrom, to),
      api.integrityCheck(ids),
      api.listAlerts(ids),
      api.listApprovalRequests(ids),
      api.listInvoices({ companyIds: ids }),
      api.listPeriods(ids),
      api.ledgerBalances(ids, '1990-01-01', today()),
    ])
    const tax = joinBalances(accs.filter((a) => a.control_type === 'tax'), taxRows)
    const taxLiability = sum(tax.filter((b) => b.account.type === 'liability').map((b) => b.closing.neg()))
    const taxAsset = sum(tax.filter((b) => b.account.type === 'asset').map((b) => b.closing))
    return {
      now, figs, series, integrity,
      docs: openDocuments(invoices, to),
      openAlerts: alerts.filter((a) => a.status === 'open' || a.status === 'reviewing'),
      pending: approvals.filter((a) => a.status === 'pending'),
      lockedPeriods: periods.filter((p) => p.status === 'locked').length,
      periodCount: periods.length,
      taxLiability, taxAsset, taxNet: taxLiability.minus(taxAsset), taxAccounts: tax.length,
    }
  }, [api, ids.join(','), from, to, knownAt, accounts.length])

  const title = scope.length === 1 ? companies.find((c) => c.id === scope[0])?.name ?? '' : group?.name ?? 'Group'
  const d = main.data

  const header = (
    <div className={cx('mb-4 flex flex-wrap items-end justify-between gap-3', fx && 'fade-up')}>
      <div className="min-w-0">
        <div className="eyebrow mb-1.5 flex items-center gap-2"><span className={cx('lamp gold', fx && 'pulse')} />NUMERO Command Centre</div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display m-0 text-[24px] font-medium leading-tight text-ink">{title}</h1>
          <Truth state={mode === 'demo' ? 'DEMO' : 'ACTUAL'} />
        </div>
        <div className="mt-1 text-[13px] text-muted">{period.label} · {fmtDate(from)} – {fmtDate(to)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · figures in {currency}</div>
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">
        {scope.length > 0 && <button className="btn ghost" onClick={() => setScope([])}>Show whole group</button>}
        <button className="btn" onClick={() => nav('/home')}><LogOut size={14} /> Exit cockpit</button>
      </div>
    </div>
  )

  if (!companies.length) {
    return (
      <div>
        {header}
        <Panel hud><Empty icon={<Building2 size={20} />} title="No company has been created yet" body="The cockpit reads posted accounting entries. Create a company first; nothing is shown until real entries exist." action={<button className="btn primary" onClick={() => nav('/companies?new=1')}>Create the first company</button>} /></Panel>
      </div>
    )
  }

  const instruments: Instrument[] = d ? (() => {
    const { pl, bs } = d.now
    const recv = d.docs.filter((x) => x.side === 'in')
    const pay = d.docs.filter((x) => x.side === 'out')
    const recvOld = recv.filter((x) => x.daysOverdue > 60)
    const payOverdue = pay.filter((x) => x.daysOverdue > 0)
    const risk = d.openAlerts.filter((a) => a.attention === 'priority' || a.attention === 'critical')
    const critical = risk.some((a) => a.attention === 'critical')
    const largest = d.pending.reduce((m, a) => Decimal.max(m, D(a.amount)), ZERO)
    const money = (v: Decimal, cls?: string) => <CountUp value={v} className={cx('text-[21px] leading-none', cls)} />
    const count = (n: number, cls?: string) => <span className={cx('num text-[21px] leading-none', cls)}>{n.toLocaleString()}</span>
    return [
      {
        key: 'cash', label: 'Group cash', icon: <Banknote size={15} />, lamp: bs.cash.lt(0) ? 'neg' : 'pos', attention: bs.cash.lt(0), onClick: () => nav('/banking'),
        body: money(bs.cash, bs.cash.lt(0) ? 'text-neg' : undefined), foot: <>as at {fmtDate(to)}</>, hint: 'Cash in hand and bank balances as recorded in the books.',
      },
      {
        key: 'rev', label: 'Revenue', icon: <TrendingUp size={15} />, lamp: pl.totalIncome.gt(0) ? 'pos' : 'cyan', attention: false, onClick: () => nav('/reports/money-came'),
        body: money(pl.totalIncome), foot: <>income recognised in the period</>, hint: 'Revenue from operations plus other income for the selected period.',
      },
      {
        key: 'exp', label: 'Expenditure', icon: <TrendingDown size={15} />, lamp: 'cyan', attention: false, onClick: () => nav('/reports/money-went'),
        body: money(pl.totalExpense), foot: <>costs recognised in the period</>, hint: 'All costs recognised in the selected period.',
      },
      {
        key: 'pat', label: 'Profit', icon: <Scale size={15} />, lamp: pl.pat.lt(0) ? 'neg' : 'pos', attention: pl.pat.lt(0), onClick: () => nav('/reports/pnl'),
        body: money(pl.pat, pl.pat.lt(0) ? 'text-neg' : 'text-pos'), foot: <>{pl.pat.lt(0) ? 'loss' : 'profit'} after tax for the period</>, hint: 'Total income less total expense for the selected period.',
      },
      {
        key: 'ar', label: 'Receivables', icon: <HandCoins size={15} />, lamp: recvOld.length ? 'warn' : 'pos', attention: recvOld.length > 0, onClick: () => nav('/parties/owed?side=in'),
        body: money(bs.receivables),
        foot: recvOld.length ? <><span className="num text-warn">{recvOld.length}</span> invoice{recvOld.length === 1 ? '' : 's'} over 60 days overdue · <Money value={sumBase(recvOld)} compact /></> : <>no invoice is more than 60 days overdue</>,
        hint: 'Money customers owe for recorded invoices.',
      },
      {
        key: 'ap', label: 'Payables', icon: <Receipt size={15} />, lamp: payOverdue.length ? 'warn' : 'pos', attention: payOverdue.length > 0, onClick: () => nav('/parties/owed?side=out'),
        body: money(bs.payables),
        foot: payOverdue.length ? <><span className="num text-warn">{payOverdue.length}</span> bill{payOverdue.length === 1 ? '' : 's'} overdue · <Money value={sumBase(payOverdue)} compact /></> : <>no bill is overdue</>,
        hint: 'Money owed to suppliers for recorded bills.',
      },
      {
        key: 'treasury', label: 'Treasury', icon: <Landmark size={15} />, lamp: 'gold', attention: false, onClick: () => nav('/reports/balance-sheet'),
        body: (
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-[10px] uppercase tracking-[0.12em] text-muted">Borrowings</div><Money value={bs.borrowings} compact className="text-[15px]" /></div>
            <div><div className="text-[10px] uppercase tracking-[0.12em] text-muted">Investments</div><Money value={bs.investments} compact className="text-[15px]" /></div>
          </div>
        ),
        foot: <>shown separately; never netted</>, hint: 'Loans outstanding and investments held, at recorded value.',
      },
      {
        key: 'tax', label: 'Tax', icon: <ScrollText size={15} />, lamp: d.taxNet.gt(0) ? 'gold' : 'pos', attention: false, onClick: () => nav('/reports/balance-sheet'),
        body: d.taxAccounts ? <div className="flex items-end gap-2">{money(d.taxNet.abs())}<span className={cx('chip', d.taxNet.gt(0) ? 'gold' : 'pos')}>{d.taxNet.gt(0) ? 'payable' : d.taxNet.lt(0) ? 'credit' : 'nil'}</span></div> : <span className="text-[13px] text-muted">No tax ledger has a balance</span>,
        foot: <>payable <Money value={d.taxLiability} compact /> − credits <Money value={d.taxAsset} compact /> · as at {fmtDate(today())}</>,
        hint: 'Net tax position: closing balance of tax liability ledgers less closing balance of tax credit ledgers.',
      },
      {
        key: 'risk', label: 'Risk', icon: <ShieldAlert size={15} />, lamp: risk.length ? (critical ? 'neg' : 'warn') : 'pos', attention: risk.length > 0, onClick: () => nav('/sentinel'),
        body: count(risk.length, risk.length ? (critical ? 'text-neg' : 'text-warn') : undefined), foot: <>open priority or critical anomalies</>, hint: 'Sentinel anomalies marked priority or critical that are still open.',
      },
      {
        key: 'approvals', label: 'Approvals', icon: <BadgeCheck size={15} />, lamp: d.pending.length ? 'warn' : 'pos', attention: d.pending.length > 0, onClick: () => nav('/approvals'),
        body: count(d.pending.length, d.pending.length ? 'text-warn' : undefined),
        foot: d.pending.length ? <>awaiting a decision · largest <Money value={largest} compact /></> : <>nothing is waiting</>, hint: 'Requests waiting for an approver.',
      },
      {
        key: 'anomalies', label: 'Anomalies', icon: <Radar size={15} />, lamp: d.openAlerts.length ? 'warn' : 'pos', attention: d.openAlerts.length > 0, onClick: () => nav('/sentinel'),
        body: count(d.openAlerts.length, d.openAlerts.length ? 'text-warn' : undefined), foot: <>open or under review</>, hint: 'Every Sentinel anomaly not yet resolved.',
      },
      {
        key: 'ai', label: 'AI', icon: <Sparkles size={15} />, lamp: 'gold', attention: false, onClick: () => askNumi(),
        body: <span className="display text-[17px] leading-none text-gold">Ask NUMI</span>, foot: <>answers come from the books, with evidence</>, hint: 'Open NUMI and ask a question about the books.',
      },
    ] satisfies Instrument[]
  })() : []

  const gauges: GaugeSpec[] = d ? (() => {
    const rs = ratios(d.now.pl, d.now.bs, daysBetween(from, to) + 1)
    const pick = (k: string) => rs.find((r) => r.key === k)
    const out: GaugeSpec[] = []
    const cur = pick('current')
    if (cur) out.push({ ratio: cur, value: cur.value ? Math.min(cur.value.toNumber() / 3, 1) : 0, label: cur.value ? cur.value.toFixed(2) + 'x' : 'n/a', tone: cur.value ? (cur.value.lt(1) ? 'warn' : 'pos') : 'cyan', text: 'Short-term assets available for every unit of short-term obligations. Below 1.00x, short-term obligations exceed short-term assets. The dial is full at 3.00x.' })
    const gm = pick('gross_margin')
    if (gm) out.push({ ratio: gm, value: gm.value ? gm.value.toNumber() / 100 : 0, label: gm.value ? gm.value.toFixed(1) + '%' : 'n/a', tone: gm.value ? (gm.value.lt(0) ? 'neg' : 'gold') : 'cyan', text: 'The share of revenue left after the direct cost of what was sold.' })
    const nm = pick('net_margin')
    if (nm) out.push({ ratio: nm, value: nm.value ? nm.value.toNumber() / 100 : 0, label: nm.value ? nm.value.toFixed(1) + '%' : 'n/a', tone: nm.value ? (nm.value.lt(0) ? 'neg' : 'pos') : 'cyan', text: 'The share of revenue left as profit after every cost of the period.' })
    const de = pick('de')
    if (de) out.push({ ratio: de, value: de.value && de.value.gt(0) ? Math.min(de.value.toNumber() / 3, 1) : 0, label: de.value ? de.value.toFixed(2) + 'x' : 'n/a', tone: d.now.bs.totalEquity.lte(0) ? 'neg' : 'cyan', text: 'Borrowings for every unit of owners\' equity. The dial is full at 3.00x.' })
    return out
  })() : []

  const balanced = d ? d.integrity.unbalanced_journals === 0 && D(d.integrity.total_debits).eq(d.integrity.total_credits) && d.now.bs.balanced : true
  const hasTrend = d ? d.series.months.length > 0 : false

  const gaugeCell = (g: GaugeSpec) => (
    <div key={g.ratio.key} className="grid place-items-center gap-1.5">
      <button className="rounded-full" onClick={() => nav('/reports/ratios')} title="Open financial health indicators" aria-label={`${g.ratio.label}: ${g.label}`}>
        <Gauge value={g.value} label={g.label} sub={g.ratio.label} tone={g.tone} size={128} />
      </button>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span>{g.ratio.value ? g.ratio.group : 'not computable'}</span>
        <Explain title={g.ratio.label} text={g.ratio.value ? g.text : `${g.text} It cannot be computed for this selection because the divisor is zero.`} formula={g.ratio.formula} inputs={g.ratio.inputs} />
      </div>
    </div>
  )

  return (
    <div>
      {header}
      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel hud><Loading rows={7} label="Reading the books" /></Panel>}

      {d && (
        <>
          {/* INTEGRITY strip */}
          <Panel hud className="mb-4 px-5 py-3" attention={!balanced}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <button className="flex items-center gap-2.5 text-left" onClick={() => nav('/reports/trial-balance')} title="Open the trial balance">
                <span className={cx('lamp', balanced ? 'pos' : 'neg', !balanced && fx && 'pulse')} />
                <span className={balanced ? 'text-pos' : 'text-neg'}><ShieldCheck size={16} /></span>
                <span><span className="eyebrow block">Integrity</span><span className={cx('display text-[14px] font-medium', balanced ? 'text-pos' : 'text-neg')}>{balanced ? 'ALL BOOKS BALANCED' : 'INTEGRITY ALERT'}</span></span>
              </button>
              <div className="text-[12px] text-muted"><span className="num text-ink2">{d.integrity.posted_journals.toLocaleString()}</span> posted journals re-added · <span className="num text-ink2">{d.integrity.unbalanced_journals.toLocaleString()}</span> unbalanced · debits {balanced ? '=' : '≠'} credits</div>
              <button className="flex items-center gap-2 text-[12px] text-ink2 hover:text-ink" onClick={() => nav('/close')} title="Open period close">
                <Lock size={13} className="text-gold" /><span className="num text-ink">{d.lockedPeriods.toLocaleString()}</span> locked period{d.lockedPeriods === 1 ? '' : 's'}<span className="text-muted">of {d.periodCount.toLocaleString()}</span>
              </button>
              <button className="flex items-center gap-2 text-[12px] text-ink2 hover:text-ink" onClick={() => nav('/banking')} title="Open banking and reconciliation">
                <span className={cx('lamp', d.integrity.unreconciled_bank_lines ? 'warn' : 'pos')} /><span className="num text-ink">{d.integrity.unreconciled_bank_lines.toLocaleString()}</span> unreconciled bank line{d.integrity.unreconciled_bank_lines === 1 ? '' : 's'}
              </button>
            </div>
          </Panel>

          {/* main display */}
          <Panel hud lit={false} className="mb-4 overflow-hidden p-5">
            {fx && <div className="scan" />}
            <div className="relative grid items-center gap-5 xl:grid-cols-[150px_minmax(0,1fr)_150px]">
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">{gauges.slice(0, 2).map(gaugeCell)}</div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div><div className="eyebrow">Main display · twelve months to {fmtDate(to)}</div><div className="display mt-0.5 text-[15px]">Income, expense and cash</div></div>
                  <Truth state="ACTUAL" />
                </div>
                {hasTrend ? (
                  <TrendChart labels={d.series.months.map(fmtMonth)} height={300}
                    series={[{ name: 'Income', color: 'var(--pos)', values: d.series.income }, { name: 'Expense', color: 'var(--neg)', values: d.series.expense }, { name: 'Cash balance', color: 'var(--gold)', values: d.series.cash, dashed: true }]}
                    onPoint={(i) => nav(`/reports/pnl?from=${d.series.months[i]}&to=${addMonths(d.series.months[i], 1)}`)} />
                ) : <Empty title="No posted entries in the last twelve months" body="The display fills as soon as entries are posted." />}
              </div>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">{gauges.slice(2, 4).map(gaugeCell)}</div>
            </div>
          </Panel>

          {/* twelve instruments */}
          <div className={cx('mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6', fx && 'stagger')}>
            {instruments.map((t) => (
              <Panel key={t.key} hud className="p-4" onClick={t.onClick} attention={t.attention} title={t.hint}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2"><span className="text-gold">{t.icon}</span><span className="eyebrow truncate">{t.label}</span></div>
                  <span className={cx('lamp', t.lamp, t.attention && fx && 'pulse')} aria-label={t.attention ? 'Attention required' : 'Normal'} />
                </div>
                <div className="mt-3 min-h-[34px]">{t.body}</div>
                <div className="mt-2 text-[11px] leading-snug text-muted">{t.foot}</div>
              </Panel>
            ))}
          </div>

          {/* company ticker */}
          <Panel hud className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="eyebrow">Companies · profit for the period and cash as at {fmtDate(to)}</div>
              <Truth state="ACTUAL" />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {d.figs.map((f) => (
                <button key={f.company.id} onClick={() => { setScope([f.company.id]); window.scrollTo(0, 0) }} title={`Show only ${f.company.name}`}
                  className={cx('flex flex-none items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left transition-colors hover:border-line2 hover:bg-surface2', scope.length === 1 && scope[0] === f.company.id ? 'border-gold/40' : 'border-line')}>
                  <span className={cx('lamp', f.pl.pat.lt(0) ? 'neg' : 'pos')} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2"><span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10px] text-gold">{f.company.code}</span><span className="max-w-[180px] truncate text-[12.5px] text-ink">{f.company.name}</span></span>
                    <span className="mt-1 flex items-center gap-3 text-[11.5px] text-muted">
                      <span>{f.pl.pat.lt(0) ? 'Loss' : 'Profit'} <Money value={f.pl.pat} compact className={f.pl.pat.lt(0) ? 'text-neg' : 'text-pos'} /></span>
                      <span>Cash <Money value={f.bs.cash} compact className="text-ink2" /></span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {d.figs.length > 1 && <div className="mt-1.5 text-[11px] text-muted">Each company shows its own books. Group figures above are simple sums; intercompany balances are eliminated in the consolidation report.</div>}
          </Panel>
        </>
      )}
    </div>
  )
}
