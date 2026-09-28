import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, ExternalLink, Plus, RotateCcw, Scale, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { Alert, ApprovalRequest, ApprovalRule, ID, Member, Role } from '@/engine/types'
import type { Shock, ShockKind, TwinDriver } from '@/engine/p3Types'
import { byAssets, byMultiples, dcf, freeCashFlows, simulate, SHOCK_KINDS, type TwinBase, type TwinMonth, type TwinResult } from '@/engine/twin'
import { tryApprovalRule, tryThreshold } from '@/engine/analysis'
import { balanceSheet, joinBalances } from '@/engine/reports'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { balancesAsOf } from '@/lib/data'
import type Decimal from 'decimal.js'
import { D } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { APPROVAL_ENTITIES } from '@/lib/workflow'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, Panel, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { Estimate, Simulated, SimulationBanner, digits, human, signed, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { TrendChart, type Series } from '@/ui/charts'

// =====================================================================
// Parts of the digital twin: the result of a simulation, the library of
// assumptions, the valuation lab and the trial of a rule on history.
// Everything here is arithmetic beside the books. It posts nothing,
// approves nothing, pays nothing and changes no budget or forecast.
// =====================================================================

// ------------------------------------------------------------------ small helpers
/** a typed figure, or null when nothing usable has been typed */
export const num = (s: string | null | undefined): number | null => {
  const t = (s ?? '').trim()
  if (t === '' || t === '-' || t === '.' || t === '-.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
/** ratios are shown to one decimal: a model does not know more than that */
export const one = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const whole = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0)
/** Privacy mode hides figures inside sentences written by the engine; dates stay readable. */
const maskFigures = (s: string) => s.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) => (i % 2 ? part : part.replace(/\d[\d,]*(\.\d+)?/g, '••'))).join('')
export function useSentence() {
  const privacy = useApp((s) => s.privacy)
  return (s: string) => (privacy ? maskFigures(s) : s)
}

/** A simulated amount: rounded to whole units and shown compact. Never an actual. */
export function Sim({ value, currency, colored, sign, className }: { value: number | null | undefined; currency?: string; colored?: boolean; sign?: boolean; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted">—</span>
  return <Money value={whole(value)} currency={currency} compact colored={colored} sign={sign} className={className} />
}

export function SimTile({ label, children, sub, tone, mark = <Simulated />, explain }: { label: string; children: ReactNode; sub?: ReactNode; tone?: string; mark?: ReactNode; explain?: ReactNode }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="eyebrow flex min-w-0 items-center gap-1.5">{label}{explain}</div>
        <span className="flex-none">{mark}</span>
      </div>
      <div className={cx('display mt-1.5 text-[22px] font-medium', tone ?? 'text-ink')}>{children}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </Panel>
  )
}

/** Names of people, where the role may read them; otherwise the start of their identifier. */
export function useWho() {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  // names are a convenience; the screen must work for people who cannot list team members
  const members = useAsync(() => api.listMembers().catch(() => [] as Member[]), [api])
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.full_name])), [members.data])
  return (id: ID | null | undefined) => (!id ? '—' : session && id === session.user.id ? `${session.user.name} (you)` : names.get(id) ?? `User ${id.slice(0, 8)}`)
}

export function Sentences({ items, empty }: { items: string[]; empty: string }) {
  const say = useSentence()
  if (!items.length) return <div className="text-[12.5px] text-muted">{empty}</div>
  return (
    <ul className="m-0 list-none space-y-1.5 p-0">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink2"><i className="mt-[7px] inline-block h-1 w-1 flex-none rounded-full bg-muted" /><span className="min-w-0">{say(t)}</span></li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ assumptions as they are typed
/** What each kind of assumption reads, as the model reads it. */
export interface KindSpec {
  value: string
  min?: number
  max?: number
  target?: 'category' | 'customer'
  targetRequired?: boolean
  extra?: { label: string; hint: string; min?: number; max?: number }
  months?: { label: string; hint: string; required?: boolean }
  /** happens in one month rather than from a month onwards */
  once?: boolean
}
const LASTS = { label: 'Lasts (months)', hint: 'Empty: until the end of the horizon' }
export const KIND_SPEC: Record<ShockKind, KindSpec> = {
  revenue_pct: { value: 'Change in revenue (%)', months: LASTS },
  margin_pts: { value: 'Change in gross margin (points)', months: LASTS },
  expense_pct: { value: 'Change in expenses (%)', months: LASTS },
  category_pct: { value: 'Change in that expense (%)', target: 'category', targetRequired: true, months: LASTS },
  payroll_pct: { value: 'Change in payroll (%)', months: LASTS },
  new_hires: { value: 'People hired', min: 0, extra: { label: 'Monthly cost of one person', hint: 'Empty: payroll ÷ headcount, as the books show', min: 0 }, months: LASTS },
  collection_delay_days: { value: 'Days later', target: 'customer', months: LASTS },
  payment_delay_days: { value: 'Days later', months: LASTS },
  interest_rate_pts: { value: 'Change in the rate (points)', months: LASTS },
  fx_pct: { value: 'Change in imported cost (%)', extra: { label: 'Imported share of cost of sales (%)', hint: 'Empty: 100', min: 0, max: 100 }, months: LASTS },
  capex: { value: 'Cost of the asset', min: 0, once: true, extra: { label: 'Life (months)', hint: 'Empty: 60. Depreciation = cost ÷ life', min: 1 } },
  new_borrowing: { value: 'Amount borrowed', min: 0, once: true, extra: { label: 'Interest rate (% a year)', hint: 'Empty: the rate the books show on borrowings', min: 0 }, months: { label: 'Repaid over (months)', hint: 'Empty: 60' } },
  lose_customer: { value: 'Share of their business lost (%)', min: 0, max: 100, target: 'customer', targetRequired: true, months: LASTS },
  new_project: { value: 'Revenue of the project, in total', min: 0, extra: { label: 'Margin of the project (%)', hint: 'Empty: the gross margin the books show', min: -100, max: 100 }, months: { label: 'The project lasts (months)', hint: 'Revenue a month = total ÷ months', required: true } },
  project_overrun_pct: { value: 'Overrun (%)', months: LASTS },
  one_off: { value: 'Amount (negative: a payment)', once: true },
}
export const kindOf = (k: ShockKind) => SHOCK_KINDS.find((x) => x.kind === k)
export const TOP3 = 'top3'

export interface Draft { id: string; kind: ShockKind; value: string; from: string; target: string; targetId: string; extra: string; months: string; label: string; driver: string }
let draftNo = 0
export const newDraft = (kind: ShockKind, patch: Partial<Omit<Draft, 'id' | 'kind'>> = {}): Draft => ({
  id: `a${++draftNo}`, kind, value: '', from: '1', target: '', targetId: '', extra: '', months: kind === 'new_project' ? '12' : '', label: '', driver: '', ...patch,
})
export const fromShock = (s: Shock): Draft => newDraft(s.kind, {
  value: Number.isFinite(s.value) ? String(s.value) : '', from: String(s.from_month ?? 1), target: s.target ?? '', targetId: s.target_id ?? '',
  extra: s.extra === undefined || s.extra === null ? '' : String(s.extra), months: s.months === undefined || s.months === null ? '' : String(s.months), label: s.label ?? '', driver: s.driver_key ?? '',
})
export function toShock(d: Draft): Shock {
  const spec = KIND_SPEC[d.kind]
  const s: Shock = { kind: d.kind, value: num(d.value) ?? 0, from_month: Math.max(1, Math.round(num(d.from) ?? 1)) }
  if (spec.target && d.target) { s.target = d.target; if (d.targetId) s.target_id = d.targetId }
  const e = num(d.extra)
  if (spec.extra && e !== null) s.extra = e
  const m = num(d.months)
  if (spec.months && m !== null) s.months = Math.max(1, Math.round(m))
  if (d.label.trim()) s.label = d.label.trim()
  if (d.driver) s.driver_key = d.driver
  return s
}
/** What stops an assumption from entering the model, and what the person should know about it. */
export function checkDraft(d: Draft, base: TwinBase, horizon: number): { blocking: string[]; warnings: string[] } {
  const spec = KIND_SPEC[d.kind]
  const blocking: string[] = []
  const warnings: string[] = []
  const v = num(d.value)
  if (v === null) blocking.push('Enter the size of the change.')
  else {
    if (spec.min !== undefined && v < spec.min) blocking.push(`${spec.value}: not below ${spec.min}.`)
    if (spec.max !== undefined && v > spec.max) blocking.push(`${spec.value}: not above ${spec.max}.`)
    if (v === 0) warnings.push('A change of zero changes nothing.')
  }
  const f = num(d.from)
  if (f === null || f < 1 || f > 60 || Math.round(f) !== f) blocking.push('The month is a whole number between 1 and 60 (1 = next month).')
  else if (f > horizon) warnings.push(`It begins in month ${f}, after the ${horizon} month(s) the model looks ahead. It changes nothing in this result.`)
  if (spec.targetRequired && !d.target) blocking.push(spec.target === 'category' ? 'Choose the kind of expense.' : 'Choose the customer.')
  if (spec.target === 'category' && d.target && !base.categories.some((c) => c.key === d.target || c.label.toLowerCase() === d.target.toLowerCase())) warnings.push(`The books of this selection carry no expense ledger "${d.target}" in the months the model rests on.`)
  if (spec.target === 'customer' && d.target && d.target !== TOP3 && !base.customers.some((c) => c.id === d.targetId || c.name.toLowerCase() === d.target.toLowerCase())) warnings.push(`"${d.target}" is not among the customers the books of this selection show.`)
  if (spec.target === 'customer' && d.target === TOP3 && !base.customers.length) warnings.push('The books show no customers, so there are no three largest to act on.')
  if (spec.extra) {
    const e = num(d.extra)
    if (d.extra.trim() !== '' && e === null) blocking.push(`${spec.extra.label}: enter a figure, or leave it empty.`)
    if (e !== null && spec.extra.min !== undefined && e < spec.extra.min) blocking.push(`${spec.extra.label}: not below ${spec.extra.min}.`)
    if (e !== null && spec.extra.max !== undefined && e > spec.extra.max) blocking.push(`${spec.extra.label}: not above ${spec.extra.max}.`)
    if (d.kind === 'new_hires' && e === null && !(base.headcount && base.payroll > 0)) blocking.push('Give the monthly cost of one person: the books hold no headcount and payroll to work it out from.')
    if (d.kind === 'new_borrowing' && e === null && !(base.debt > 0 && base.financeCost > 0)) warnings.push('The books show no rate on borrowings, so without a rate this loan is modelled free of interest.')
  }
  if (spec.months) {
    const m = num(d.months)
    if (d.months.trim() !== '' && (m === null || m < 1 || Math.round(m) !== m)) blocking.push(`${spec.months.label}: a whole number of months, 1 or more.`)
    if (spec.months.required && d.months.trim() === '') blocking.push(`${spec.months.label}: state it.`)
  }
  return { blocking, warnings }
}

// ------------------------------------------------------------------ the starting point
/** The figures a simulation starts from. They come from the books and are marked as such. */
export function BaseFacts({ base, currency }: { base: Partial<TwinBase>; currency: string }) {
  const money = (v: unknown, exact = false) => (typeof v === 'number' && Number.isFinite(v) ? <Money value={v} currency={currency} decimals={exact ? undefined : 0} /> : <span className="text-muted">not recorded</span>)
  const monthly: [string, unknown][] = [
    ['Revenue', base.revenue], ['Cost of sales', base.cogs], ['Payroll', base.payroll], ['Operating expenses', base.opex],
    ['Other income', base.otherIncome], ['Depreciation', base.depreciation], ['Finance cost', base.financeCost], ['Tax', base.tax],
  ]
  const position: [string, unknown][] = [
    ['Cash and bank', base.cash], ['Receivables', base.receivables], ['Payables', base.payables], ['Inventory', base.inventory], ['Borrowings', base.debt], ['Fixed assets, net', base.fixedAssets],
  ]
  const cell = 'flex items-baseline justify-between gap-3 border-b border-line py-[7px] text-[12.5px] last:border-0'
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted"><span className="font-medium text-ink2">A month, on average</span><Truth state="ACTUAL" /><span>average of the last {base.basisMonths ?? '—'} complete month{base.basisMonths === 1 ? '' : 's'}</span></div>
        {monthly.map(([l, v]) => <div key={l} className={cell}><span className="text-ink2">{l}</span>{money(v)}</div>)}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted"><span className="font-medium text-ink2">Position</span><Truth state="ACTUAL" /><span>ledger balances as at {base.asOf ? fmtDate(base.asOf) : '—'}</span></div>
        {position.map(([l, v]) => <div key={l} className={cell}><span className="text-ink2">{l}</span>{money(v, true)}</div>)}
        <div className={cell}><span className="text-ink2">People employed</span>{typeof base.headcount === 'number' ? <span className="num">{base.headcount}</span> : <span className="text-muted">not read</span>}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the result of one simulation
/** A saved run holds its result as plain data. It is shown only if it still has the shape of a result. */
export function readResult(v: Record<string, unknown> | null | undefined): TwinResult | null {
  const r = (v ?? {}) as Partial<TwinResult>
  if (!Array.isArray(r.months) || !r.months.length || !r.totals || typeof r.totals !== 'object') return null
  if (typeof r.totals.closingCash !== 'number' || typeof r.months[0]?.cash !== 'number') return null
  return {
    label: 'SIMULATION', name: String(r.name ?? 'Saved run'), asOf: String(r.asOf ?? ''), currency: String(r.currency ?? 'INR'), horizon: Number(r.horizon ?? r.months.length), months: r.months, totals: r.totals,
    effects: Array.isArray(r.effects) ? r.effects : [], assumptions: Array.isArray(r.assumptions) ? r.assumptions.map(String) : [], notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
  }
}

export const BOOKS_CONTINUE = 'Books continue as they are'

export function ResultView({ result, against, startCash, exportName }: { result: TwinResult; against?: TwinResult; startCash?: number; exportName: string }) {
  const say = useSentence()
  const c = result.currency
  const t = result.totals
  const b = against?.totals
  const H = result.months.length
  const last = result.months[H - 1]
  const low = result.months.find((m) => m.month === t.lowestCashMonth)
  const out = t.monthsOfCashLeft === null ? null : result.months[t.monthsOfCashLeft]
  const beside = (v: number | null | undefined, ratio = false) => (against && v !== undefined ? <span> · books continue: {ratio ? <span className="num">{one(v)}×</span> : <Sim value={v} currency={c} />}</span> : null)
  const source = 'Source: a simulation. It starts from the books and applies the assumptions shown on this screen. It is not an accounting record.'

  const labels = [...(startCash !== undefined ? ['Today'] : []), ...result.months.map((m) => m.label)]
  const lead = (xs: number[]) => (startCash !== undefined ? [startCash, ...xs] : xs)
  const same = !against || result.effects.length === 0
  const scenarioName = result.name === BOOKS_CONTINUE && !same ? 'The scenario' : result.name
  const cashSeries: Series[] = same
    ? [{ name: against ? BOOKS_CONTINUE : scenarioName, color: against ? 'var(--cyan)' : 'var(--violet)', values: lead(result.months.map((m) => m.cash)) }]
    : [{ name: BOOKS_CONTINUE, color: 'var(--cyan)', dashed: true, values: lead(against.months.map((m) => m.cash)) }, { name: scenarioName, color: 'var(--violet)', values: lead(result.months.map((m) => m.cash)) }]
  const flowSeries: Series[] = same
    ? [{ name: 'Revenue', color: 'var(--gold)', values: result.months.map((m) => m.revenue) }, { name: 'Profit after tax', color: 'var(--pos)', values: result.months.map((m) => m.profit) }]
    : [
      { name: 'Revenue — books continue', color: 'var(--gold)', dashed: true, values: against.months.map((m) => m.revenue) }, { name: 'Revenue — scenario', color: 'var(--gold)', values: result.months.map((m) => m.revenue) },
      { name: 'Profit after tax — books continue', color: 'var(--pos)', dashed: true, values: against.months.map((m) => m.profit) }, { name: 'Profit after tax — scenario', color: 'var(--pos)', values: result.months.map((m) => m.profit) },
    ]

  const amount = (key: keyof TwinMonth, header: string, o: { colored?: boolean; strong?: boolean } = {}): Column<TwinMonth> => ({
    key, header, align: 'right', render: (m) => <Sim value={m[key] as number} currency={c} colored={o.colored} className={o.strong ? 'text-ink' : undefined} />, sort: (m) => (m[key] as number) ?? 0, csv: (m) => whole(m[key] as number),
  })
  const columns: Column<TwinMonth>[] = [
    { key: 'month', header: 'Month', render: (m) => <span className="whitespace-nowrap"><span className="num text-muted">{m.month}</span> <span className="text-ink">{m.label}</span></span>, sort: (m) => m.month, csv: (m) => `${m.month} · ${m.label}` },
    { key: 'mark', header: 'Label', render: () => <Simulated />, csv: () => 'SIMULATION' },
    amount('revenue', 'Revenue'), amount('cogs', 'Cost of sales'), amount('grossProfit', 'Gross profit'), amount('payroll', 'Payroll'), amount('opex', 'Operating expenses'),
    amount('operatingProfit', 'Operating profit', { colored: true }), amount('depreciation', 'Depreciation'), amount('financeCost', 'Finance cost'), amount('tax', 'Tax'), amount('profit', 'Profit after tax', { colored: true }),
    amount('collections', 'Collected from customers'), amount('paidToSuppliers', 'Paid to suppliers'), amount('capex', 'Assets bought'), amount('borrowed', 'Borrowed'), amount('repaid', 'Borrowings repaid'),
    amount('netCash', 'Net cash of the month', { colored: true }), amount('cash', 'Cash at the end', { colored: true }), amount('receivables', 'Receivables'), amount('payables', 'Payables'), amount('debt', 'Borrowings'), amount('workingCapital', 'Working capital'),
    { key: 'coverage', header: 'Coverage', align: 'right', render: (m) => (m.coverage === null ? <span className="text-muted">—</span> : <span className={cx('num', m.coverage < 1 ? 'text-neg' : 'text-ink2')}>{one(m.coverage)}×</span>), sort: (m) => m.coverage ?? 0, csv: (m) => (m.coverage === null ? '' : one(m.coverage)) },
  ]

  return (
    <div>
      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SimTile label="Cash at the end" tone={t.closingCash < 0 ? 'text-neg' : 'text-ink'} sub={<>end of {last.label}{beside(b?.closingCash)}</>}
          explain={<Explain title="Cash at the end" text="Cash in the books today, plus everything the model takes to arrive, less everything it takes to leave, month by month to the end of the horizon." formula="cash + collections + other income + borrowed + firm receipts − suppliers − payroll − interest − tax − assets bought − repayments − firm payments" source={source} />}>
          <Sim value={t.closingCash} currency={c} />
        </SimTile>
        <SimTile label="Lowest cash on the way" tone={t.lowestCash < 0 ? 'text-neg' : 'text-ink'} sub={<>{low ? `in ${low.label} (month ${low.month})` : `month ${t.lowestCashMonth}`}{beside(b?.lowestCash)}</>}>
          <Sim value={t.lowestCash} currency={c} />
        </SimTile>
        <SimTile label="Months of cash left" tone={t.monthsOfCashLeft === null ? 'text-pos' : 'text-neg'}
          sub={t.monthsOfCashLeft === null ? <>Cash stays above zero in every one of the {H} month{H === 1 ? '' : 's'} modelled. The model says nothing about the months after.</> : <>Cash falls below zero in {out?.label ?? `month ${t.monthsOfCashLeft + 1}`}.</>}
          explain={<Explain title="Months of cash left" text="The number of whole months that pass before cash in the model first falls below zero. Where it never does within the horizon, no figure is given: the model does not look further." formula="months before the first month with cash below zero" source={source} />}>
          {t.monthsOfCashLeft === null ? <span className="text-[17px]">More than {H}</span> : <span className="num">{t.monthsOfCashLeft}</span>}
        </SimTile>
        <SimTile label="Borrowing requirement" tone={t.borrowingRequirement > 0 ? 'text-warn' : 'text-ink'} sub={<>what it would take to keep cash at zero or above{beside(b?.borrowingRequirement)}</>}
          explain={<Explain title="Borrowing requirement" text="How far below zero cash goes at its lowest point. It is what would have to be found, from a lender or otherwise, for cash never to be negative. It is not a loan and nothing is requested." formula="the greater of zero and (0 − lowest cash)" source={source} />}>
          <Sim value={t.borrowingRequirement} currency={c} />
        </SimTile>
        <SimTile label="Profit over the horizon" tone={t.profit < 0 ? 'text-neg' : 'text-ink'} sub={<>after tax, {H} month{H === 1 ? '' : 's'}{beside(b?.profit)}</>}>
          <Sim value={t.profit} currency={c} />
        </SimTile>
        <SimTile label="Lowest payment coverage" tone={t.lowestCoverage !== null && t.lowestCoverage < 1 ? 'text-neg' : 'text-ink'} sub={<>in the tightest month; below 1.0 the month cannot be paid in full{beside(b?.lowestCoverage, true)}</>}
          explain={<Explain title="Payment coverage" text="In each month: the cash there was at the start (never less than zero) plus what arrived, divided by what had to leave. The figure shown is the lowest of the months." formula="(cash at the start + cash in) ÷ cash out" source={source} />}>
          {t.lowestCoverage === null ? <span className="text-muted">—</span> : <span className="num">{one(t.lowestCoverage)}×</span>}
        </SimTile>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Section title="Cash, month by month" right={<Simulated />}>
          <Panel className="p-4" lit={false}>
            <TrendChart labels={labels} series={cashSeries} height={260} />
            <div className="mt-2 text-[11.5px] text-muted">
              {startCash !== undefined && <>The first point is the cash in the books today (<span className="text-pos">ACTUAL</span>). Every later point is simulated. </>}
              {same && against ? 'No assumption is in the model yet, so the line is the books continuing as they are.' : !same ? 'The dashed line is the books continuing as they are; the solid line applies the assumptions.' : null}
            </div>
          </Panel>
        </Section>
        <Section title="Revenue and profit, month by month" right={<Simulated />}>
          <Panel className="p-4" lit={false}>
            <TrendChart labels={result.months.map((m) => m.label)} series={flowSeries} height={260} />
            <div className="mt-2 text-[11.5px] text-muted">Profit is after depreciation, interest and tax. Revenue over the horizon: <Sim value={t.revenue} currency={c} />; operating profit: <Sim value={t.operatingProfit} currency={c} />.</div>
          </Panel>
        </Section>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Section title="What each assumption did" right={<Simulated />}>
          <Panel className="p-1.5" lit={false}>
            {result.effects.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No assumption is in the model. The result is the books continuing as they have been.</div> : result.effects.map((e, i) => (
              <div key={i} className="border-b border-line px-3 py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2"><span className="num text-[11px] text-muted">{i + 1}</span><span className="text-[12.5px] font-medium text-ink">{e.label}</span><span className="chip">{kindOf(e.kind)?.label ?? human(e.kind)}</span></div>
                <div className="mt-1 text-[12.5px] leading-relaxed text-ink2">{say(e.text)}</div>
                <div className="mt-1.5 text-[11.5px] text-muted">Formula: <span className="num text-gold">{e.formula}</span></div>
              </div>
            ))}
          </Panel>
        </Section>
        <div className="min-w-0 space-y-4">
          <Section title="What the model takes for granted">
            <Panel className="p-4" lit={false}><Sentences items={result.assumptions} empty="No assumption was recorded with this result." /></Panel>
          </Section>
          <Section title="What the model could not read, or had to assume">
            <Panel className="p-4" lit={false}><Sentences items={result.notes} empty="The model reported no gap in what it read." /></Panel>
          </Section>
        </div>
      </div>

      <Section title="Month by month" right={<Simulated />}>
        <Panel lit={false}>
          <DataTable columns={columns} rows={result.months} rowKey={(m) => String(m.month)} pageSize={60} exportName={exportName} maxHeight={520}
            rowClass={(m) => (m.cash < 0 ? 'bg-negsoft' : undefined)}
            toolbar={<span className="text-[12px] text-muted">Amounts are rounded: a model does not know the paise. Coverage is shown to one decimal. Months in which cash is below zero are shaded. The export carries the word SIMULATION in its name and on every row.</span>} />
        </Panel>
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ the library of assumptions
const UNIT_LABEL: Record<TwinDriver['unit'], string> = { amount: 'Amount', percent: 'Percent', days: 'Days', count: 'Count', rate: 'Rate, % a year' }
export const driverValue = (d: Pick<TwinDriver, 'unit' | 'value'>) => {
  const v = D(d.value).toString()
  return d.unit === 'percent' ? `${v}%` : d.unit === 'rate' ? `${v}% a year` : d.unit === 'days' ? `${v} days` : v
}
interface DriverForm { company_id: string; key: string; name: string; unit: TwinDriver['unit']; value: string; basis: string; source: TwinDriver['source'] }
const blankDriver = (): DriverForm => ({ company_id: '', key: '', name: '', unit: 'percent', value: '', basis: '', source: 'assumed' })

export function DriversTab() {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const code = useCompanyCode()
  const who = useWho()
  const { act, busy } = useAction()
  // a driver of a company is managed by those who manage simulations in that company; a driver of the group, by those who manage them in any company
  const manageIds = companies.filter((c) => can('scenario.manage', c.id)).map((c) => c.id)
  const mayManage = manageIds.length > 0
  const noManage = mayManage ? undefined : 'Your role does not include scenario.manage'
  const mayDecide = (d: TwinDriver) => (d.company_id ? manageIds.includes(d.company_id) : mayManage)

  const list = useAsync(() => api.listTwinDrivers(), [api])
  const [form, setForm] = useState<DriverForm | null>(null)
  const [retire, setRetire] = useState<TwinDriver | null>(null)
  const rows = list.data ?? []
  const set = (p: Partial<DriverForm>) => setForm((f) => (f ? { ...f, ...p } : f))

  const clash = form ? rows.find((d) => d.key === form.key.trim().toLowerCase() && (d.company_id ?? '') === form.company_id) : undefined
  const problems: string[] = []
  if (form) {
    if (!form.key.trim()) problems.push('Give the driver a key: a short name without spaces, by which an assumption refers to it.')
    if (!form.name.trim()) problems.push('Give the driver a name.')
    if (num(form.value) === null) problems.push('Enter the value.')
    if (!form.basis.trim()) problems.push('State what the value rests on: a contract, a quotation, a decision, a record.')
  }
  const propose = async () => {
    if (!form) return
    const id = await act(() => api.saveTwinDriver({ company_id: form.company_id || null, key: form.key.trim().toLowerCase(), name: form.name.trim(), unit: form.unit, value: form.value.trim(), basis: form.basis.trim(), source: form.source }), 'Driver proposed — a second person must approve it before a simulation uses it')
    if (id) setForm(null)
  }

  const columns: Column<TwinDriver>[] = [
    { key: 'key', header: 'Key', render: (d) => <span className="num text-[12.5px] text-gold">{d.key}</span>, sort: (d) => d.key, csv: (d) => d.key },
    { key: 'name', header: 'Name', render: (d) => <span className="text-ink">{d.name}</span>, sort: (d) => d.name.toLowerCase(), csv: (d) => d.name },
    { key: 'scope', header: 'Applies to', render: (d) => (d.company_id ? <span className="text-ink2" title={companies.find((c) => c.id === d.company_id)?.name}>{code(d.company_id)}</span> : <span className="chip">the group</span>), sort: (d) => (d.company_id ? code(d.company_id) : ''), csv: (d) => (d.company_id ? companies.find((c) => c.id === d.company_id)?.name ?? 'Company' : 'The group') },
    { key: 'unit', header: 'Unit', render: (d) => <span className="text-[12.5px] text-ink2">{UNIT_LABEL[d.unit] ?? d.unit}</span>, sort: (d) => d.unit, csv: (d) => UNIT_LABEL[d.unit] ?? d.unit },
    { key: 'value', header: 'Value', align: 'right', render: (d) => (d.unit === 'amount' ? <Money value={d.value} /> : <span className="num">{driverValue(d)}</span>), sort: (d) => D(d.value).toNumber(), csv: (d) => D(d.value).toString() },
    { key: 'basis', header: 'What it rests on', render: (d) => <span className="text-[12.5px] text-ink2">{d.basis}</span>, csv: (d) => d.basis },
    { key: 'source', header: 'Recorded or assumed', render: (d) => <span className={cx('chip', d.source === 'recorded' ? 'pos' : 'violet')} title={d.source === 'recorded' ? 'Taken from a record: a contract, a register, the books' : 'A judgement of the person who proposed it'}>{d.source}</span>, sort: (d) => d.source, csv: (d) => d.source },
    { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status} label={d.status === 'proposed' ? 'proposed — not yet used' : undefined} />, sort: (d) => d.status, csv: (d) => d.status },
    { key: 'by', header: 'Proposed by', render: (d) => <div><div className="text-ink2">{who(d.created_by)}</div><div className="num text-[11.5px] text-muted">{fmtDateTime(d.created_at)}</div></div>, sort: (d) => d.created_at, csv: (d) => `${who(d.created_by)} on ${d.created_at}` },
    { key: 'approved', header: 'Decided by', render: (d) => (d.approved_by ? <div><div className="text-ink2">{who(d.approved_by)}</div><div className="num text-[11.5px] text-muted">{fmtDateTime(d.approved_at)}</div></div> : <span className="text-muted">—</span>), sort: (d) => d.approved_at ?? '', csv: (d) => (d.approved_by ? `${who(d.approved_by)} on ${d.approved_at ?? ''}` : '') },
    {
      key: 'act', header: '', align: 'right',
      render: (d) => {
        if (d.status === 'approved') return <button className="btn sm ghost" disabled={busy || !mayDecide(d)} title={noManage ?? (!mayDecide(d) ? 'Your role does not include scenario.manage in the company of this driver' : 'Take this driver out of use')} onClick={() => setRetire(d)}>Retire</button>
        if (d.status !== 'proposed') return null
        const own = !!session && d.created_by === session.user.id
        return (
          <span className="flex flex-nowrap items-center justify-end gap-1.5">
            <button className="btn sm good" disabled={busy || !mayDecide(d) || own} title={noManage ?? (!mayDecide(d) ? 'Your role does not include scenario.manage in the company of this driver' : own ? 'You proposed this driver. A second person must approve it.' : 'Simulations that name this driver will use its value')}
              onClick={() => void act(() => api.decideTwinDriver(d.id, 'approved'), 'Driver approved — simulations that name it now use its value')}><BadgeCheck size={13} /> Approve</button>
            <button className="btn sm ghost" disabled={busy || !mayDecide(d)} title={noManage ?? (!mayDecide(d) ? 'Your role does not include scenario.manage in the company of this driver' : 'Withdraw this proposal')} onClick={() => setRetire(d)}>Retire</button>
          </span>
        )
      },
    },
  ]

  return (
    <div>
      <Note className="mb-4">
        <strong className="text-ink">A driver is an assumption kept in one place</strong> — a rate of interest agreed with a bank, a rise in salaries decided by the board, the days a large customer takes to pay. An assumption in a simulation may name a driver; the value of the driver then replaces the value typed.
        {' '}<strong className="text-ink">Only a driver approved by a second person is used.</strong> The person who proposed a driver cannot approve it. A driver that is proposed or retired is ignored, and the result of the simulation says that the typed value was used instead.
      </Note>
      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {!list.error && !list.data && <Panel><Loading rows={5} label="Loading the assumptions library" /></Panel>}
      {list.data && (
        <Section title="Assumptions library" right={<button className="btn sm primary" disabled={!mayManage} title={noManage} onClick={() => setForm(blankDriver())}><Plus size={13} /> Propose a driver</button>}>
          <Panel lit={false}>
            <DataTable columns={columns} rows={rows} rowKey={(d) => d.id} exportName="twin-drivers" initialSort={{ key: 'key', dir: 'asc' }}
              toolbar={<span className="text-[12px] text-muted">Proposed and approved drivers. A retired driver leaves this list; it stays in the audit trail.</span>}
              empty={{ title: 'No driver has been proposed', body: mayManage ? 'Propose the first one. Until a driver is approved, every assumption uses the value typed into it.' : 'Every assumption uses the value typed into it. Proposing a driver needs the permission scenario.manage.', icon: <SlidersHorizontal size={20} /> }} />
          </Panel>
        </Section>
      )}
      {!mayManage && <Note className="mt-4">You can read the library. Proposing, approving and retiring a driver need the permission <span className="num text-ink">scenario.manage</span>.</Note>}

      <Modal open={!!form} onClose={() => setForm(null)} title="Propose a driver" subtitle="It is used by simulations only after a second person approves it" width={620}
        footer={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void propose()}>{busy ? <Spinner /> : <Plus size={15} />} Propose</button></>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" hint="Lower case, no spaces. For example: bank_rate_rise"><input className="field num" value={form.key} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') })} autoFocus /></Field>
            <Field label="Name"><input className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: rise in the bank's lending rate" /></Field>
            <Field label="Applies to" hint="A driver of one company is for the simulations of that company">
              <select className="field" value={form.company_id} onChange={(e) => set({ company_id: e.target.value })}>
                <option value="">The whole group</option>
                {companies.filter((c) => manageIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="Unit"><select className="field" value={form.unit} onChange={(e) => set({ unit: e.target.value as TwinDriver['unit'] })}>{(Object.keys(UNIT_LABEL) as TwinDriver['unit'][]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></Field>
            <Field label="Value" hint="In the unit chosen. It replaces the value typed in an assumption that names this driver."><input className="field num" inputMode="decimal" value={form.value} onChange={(e) => set({ value: signed(e.target.value) })} /></Field>
            <Field label="Recorded or assumed" hint="Recorded: taken from a record. Assumed: a judgement.">
              <select className="field" value={form.source} onChange={(e) => set({ source: e.target.value as TwinDriver['source'] })}><option value="assumed">Assumed</option><option value="recorded">Recorded</option></select>
            </Field>
            <Field label="What it rests on" className="sm:col-span-2" hint="The contract, quotation, decision or record the value comes from">
              <textarea className="field" rows={3} value={form.basis} onChange={(e) => set({ basis: e.target.value })} />
            </Field>
            {clash && <Note kind="warn" className="sm:col-span-2">A driver with the key <span className="num text-ink">{clash.key}</span> exists for the same scope ({clash.status}, {driverValue(clash)}). {clash.status === 'approved' ? 'It stays in use until a second person approves this one; at that moment this one takes its place.' : 'It is a proposal that nobody has approved: this one takes its place.'}</Note>}
            {problems.length > 0 && (form.key || form.name || form.value || form.basis) && <Note kind="warn" className="sm:col-span-2"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
          </div>
        )}
      </Modal>

      <Modal open={!!retire} onClose={() => setRetire(null)} title={retire?.status === 'approved' ? 'Retire this driver' : 'Retire this proposal'} width={500}
        footer={<><button className="btn ghost" onClick={() => setRetire(null)}>Cancel</button><button className="btn danger" disabled={busy} onClick={() => { const d = retire; if (!d) return; void act(() => api.decideTwinDriver(d.id, 'retired'), 'Driver retired').then(() => setRetire(null)) }}>Retire the driver</button></>}>
        {retire && (
          <div className="space-y-3 text-[13px] text-ink2">
            <p className="m-0">The driver <span className="num text-gold">{retire.key}</span> ({retire.name}, {driverValue(retire)}) {retire.status === 'approved' ? 'is in use and will be taken out of use. Simulations that name it will use the value typed in the assumption, and will say so.' : 'will be retired without having been approved. It leaves this list and no simulation will use it.'}</p>
            <p className="m-0 text-[12.5px] text-muted">This cannot be undone here: to bring the assumption back, propose it again. The decision and the person who took it are recorded.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ valuation lab
/** A figure taken from the books unless the person types another. The screen says which of the two it is. */
function BookOrTyped({ label, book, value, onChange, hint, reading }: { label: string; book: number | null; value: string; onChange: (v: string) => void; hint?: string; reading?: boolean }) {
  const typed = value.trim() !== ''
  return (
    <div>
      <Field label={label} hint={hint}>
        <input className="field num" inputMode="decimal" value={value} onChange={(e) => onChange(signed(e.target.value))} placeholder={reading ? '' : book === null ? 'type it' : String(whole(book))} />
      </Field>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
        {typed ? <><span className="chip">TYPED</span><button className="link inline-flex items-center gap-1" onClick={() => onChange('')}><RotateCcw size={11} /> {book === null ? 'clear' : 'back to the books'}</button></>
          : reading ? <span>Reading the books…</span>
          : book === null ? <span className="text-warn">Not read from the books. Type the figure.</span>
          : <><Truth state="ACTUAL" /><span>from the books</span></>}
      </div>
    </div>
  )
}

interface MultipleRow { id: string; metric: string; value: string; multiple: string; source: string }
interface AdjustRow { id: string; label: string; amount: string; basis: string }
let rowNo = 0
const rid = () => `r${++rowNo}`

function RangeBand({ rows, currency }: { rows: { key: string; label: string; low: number; high: number; color: string; note?: string }[]; currency: string }) {
  const lo = Math.min(0, ...rows.map((r) => r.low))
  const hi = Math.max(...rows.map((r) => r.high), lo + 1)
  const span = hi - lo || 1
  const x = (v: number) => ((v - lo) / span) * 100
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-ink2">{r.label}{r.note && <span className="text-muted"> · {r.note}</span>}</span>
            <span className="text-ink">{r.low === r.high ? <Sim value={r.low} currency={currency} /> : <><Sim value={r.low} currency={currency} /> <span className="text-muted">to</span> <Sim value={r.high} currency={currency} /></>}</span>
          </div>
          <div className="relative h-[10px] rounded-full bg-surface2">
            {lo < 0 && <i className="absolute top-[-3px] h-4 w-px" style={{ left: `${x(0)}%`, background: 'var(--line-strong)' }} />}
            <i className="absolute top-0 h-full rounded-full" style={{ left: `${x(r.low)}%`, width: `${Math.max(1.2, x(r.high) - x(r.low))}%`, background: r.color, opacity: 0.85 }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between text-[11px] text-muted"><span><Sim value={lo} currency={currency} /></span><span><Sim value={hi} currency={currency} /></span></div>
    </div>
  )
}

export function ValuationTab({ base, drivers, shocks, scenarioName, ids }: { base: TwinBase; drivers: TwinDriver[]; shocks: Shock[]; scenarioName: string; ids: ID[] }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const c = base.currency
  const hasScenario = shocks.length > 0

  const [source, setSource] = useState<'base' | 'scenario'>('base')
  const [years, setYears] = useState(3)
  const [discount, setDiscount] = useState('12')
  const [growth, setGrowth] = useState('3')
  const [debt, setDebt] = useState('')
  const [cash, setCash] = useState('')
  const [assets, setAssets] = useState('')
  const [liabs, setLiabs] = useState('')
  const [multiples, setMultiples] = useState<MultipleRow[]>(() => [{ id: rid(), metric: 'operating', value: '', multiple: '', source: '' }])
  const [adjust, setAdjust] = useState<AdjustRow[]>([])

  const useScenario = source === 'scenario' && hasScenario
  const sim = useMemo(() => simulate(base, useScenario ? shocks : [], years * 12, useScenario ? scenarioName : BOOKS_CONTINUE, drivers), [base, shocks, useScenario, years, scenarioName, drivers])
  const openingWc = base.receivables + base.inventory - base.payables
  const flows = useMemo(() => freeCashFlows(sim, openingWc), [sim, openingWc])
  // the parts of each year's free cash flow, by the formula the model uses, so that the total can be followed
  const parts = useMemo(() => {
    let wc = openingWc
    return flows.map((flow, y) => {
      const ms = sim.months.slice(y * 12, y * 12 + 12)
      const end = ms[ms.length - 1].workingCapital
      const row = { year: y + 1, from: ms[0].label, to: ms[ms.length - 1].label, operating: ms.reduce((s, m) => s + m.operatingProfit, 0), tax: ms.reduce((s, m) => s + m.tax, 0), capex: ms.reduce((s, m) => s + m.capex, 0), wcChange: end - wc, flow }
      wc = end
      return row
    })
  }, [flows, sim, openingWc])

  // the balance sheet, where the role reads the ledger in every company chosen
  const reportIds = ids.filter((id) => can('report.view', id))
  const complete = reportIds.length === ids.length
  const books = useAsync(async () => {
    if (!complete) return null
    const rows = await balancesAsOf(api, companies, reportIds, base.asOf)
    const bs = balanceSheet(joinBalances(accounts.filter((a) => reportIds.includes(a.company_id)), rows))
    return { assets: bs.totalAssets.toNumber(), liabilities: bs.totalLiabilities.toNumber(), investments: bs.investments.toNumber() }
  }, [api, reportIds.join(','), complete, base.asOf, accounts.length])

  const debtV = num(debt) ?? base.debt
  const cashV = num(cash) ?? base.cash
  const rate = num(discount)
  const g = num(growth)
  const d = useMemo(() => (rate === null || g === null ? null : dcf({ cashFlows: flows, discountPct: rate, terminalGrowthPct: g, debt: debtV, cash: cashV })), [flows, rate, g, debtV, cashV])

  const annual = { revenue: base.revenue * 12, operating: (base.revenue - base.cogs - base.payroll - base.opex) * 12, simRevenue: sim.months.slice(0, 12).reduce((s, m) => s + m.revenue, 0), simOperating: sim.months.slice(0, 12).reduce((s, m) => s + m.operatingProfit, 0) }
  const METRICS: { key: string; label: string; short: string; value: number | null; mark: 'ACTUAL' | 'SIMULATION' | 'TYPED'; how: string }[] = [
    { key: 'revenue', label: 'Revenue of a year, as the books run now', short: 'revenue', value: annual.revenue, mark: 'ACTUAL', how: `average monthly revenue of the last ${base.basisMonths} month(s) × 12` },
    { key: 'operating', label: 'Operating profit of a year before depreciation, as the books run now', short: 'operating profit', value: annual.operating, mark: 'ACTUAL', how: `(revenue − cost of sales − payroll − operating expenses), average of the last ${base.basisMonths} month(s) × 12` },
    { key: 'simRevenue', label: 'Revenue of the first simulated year', short: 'simulated revenue', value: annual.simRevenue, mark: 'SIMULATION', how: 'the first twelve months of the simulation chosen above' },
    { key: 'simOperating', label: 'Operating profit of the first simulated year', short: 'simulated operating profit', value: annual.simOperating, mark: 'SIMULATION', how: 'the first twelve months of the simulation chosen above' },
    { key: 'typed', label: 'Another figure, typed', short: 'the figure typed', value: null, mark: 'TYPED', how: 'typed by you' },
  ]
  const metricOf = (k: string) => METRICS.find((m) => m.key === k) ?? METRICS[0]
  const figureOf = (r: MultipleRow) => num(r.value) ?? metricOf(r.metric).value
  const usable = multiples.filter((r) => figureOf(r) !== null && num(r.multiple) !== null)
  const byM = useMemo(() => byMultiples(usable.map((r) => ({ metric: metricOf(r.metric).short, value: figureOf(r) as number, multiple: num(r.multiple) as number, source: r.source })), debtV, cashV),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(usable), debtV, cashV, annual.revenue, annual.operating, annual.simRevenue, annual.simOperating])
  const resultOf = (r: MultipleRow) => { const i = usable.findIndex((u) => u.id === r.id); return i === -1 ? null : byM[i] }

  const assetsV = num(assets) ?? books.data?.assets ?? null
  const liabsV = num(liabs) ?? books.data?.liabilities ?? null
  const na = useMemo(() => (assetsV === null || liabsV === null ? null : byAssets(assetsV, liabsV, adjust.filter((a) => a.label.trim() && num(a.amount) !== null).map((a) => ({ label: a.label.trim(), amount: num(a.amount) as number, basis: a.basis })))), [assetsV, liabsV, adjust])

  // the range: every estimate that was not refused, method by method
  const band: { key: string; label: string; low: number; high: number; color: string; note?: string }[] = []
  if (d && !d.refused) {
    const all = [d.equityValue, ...d.sensitivity.map((s) => s.equityValue)]
    band.push({ key: 'dcf', label: 'Discounted cash flow', low: Math.min(...all), high: Math.max(...all), color: 'var(--violet)', note: 'across the discount rates and growth rates of the table' })
  }
  const okM = byM.filter((m) => !m.refused)
  if (okM.length) band.push({ key: 'mult', label: 'Multiples', low: Math.min(...okM.map((m) => m.equityValue)), high: Math.max(...okM.map((m) => m.equityValue)), color: 'var(--cyan)', note: `${okM.length} multiple${okM.length === 1 ? '' : 's'} with a source` })
  if (na) band.push({ key: 'assets', label: 'Net assets', low: Math.min(na.bookNetAssets, na.adjusted), high: Math.max(na.bookNetAssets, na.adjusted), color: 'var(--gold)', note: na.adjustments.length ? 'as the books carry them, and as adjusted' : 'as the books carry them' })
  const low = band.length ? Math.min(...band.map((b) => b.low)) : null
  const high = band.length ? Math.max(...band.map((b) => b.high)) : null

  const setM = (id: string, p: Partial<MultipleRow>) => setMultiples((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const setA = (id: string, p: Partial<AdjustRow>) => setAdjust((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const line = 'flex items-baseline justify-between gap-3 border-b border-line py-[7px] text-[12.5px] last:border-0'

  return (
    <div>
      <SimulationBanner>
        <strong className="text-ink">This is arithmetic, not a valuation opinion.</strong> It works on a simulation and on figures a person typed. What it gives is an <strong className="text-ink">estimate of a range</strong>. It is not used anywhere in the books, it changes no record, and it is not advice to buy or to sell at any price.
      </SimulationBanner>

      <Section title="The range across the methods" right={<Estimate />} className="mb-4">
        <Panel className="p-5">
          {band.length === 0 ? <Empty icon={<Scale size={20} />} title="No estimate yet" body="Complete the inputs of at least one method below. A method whose inputs are incomplete, or which the arithmetic refuses, gives no figure." /> : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_1fr]">
              <div>
                <div className="eyebrow">Value of the equity — estimate</div>
                <div className="display mt-1.5 text-[22px] font-medium text-ink"><Sim value={low} currency={c} /> <span className="text-[14px] text-muted">to</span> <Sim value={high} currency={c} /></div>
                <div className="mt-2 text-[11.5px] leading-relaxed text-muted">The lowest and the highest of the estimates below. No single figure is given: the methods answer different questions, and each moves with the inputs a person chose. Amounts are rounded.</div>
              </div>
              <RangeBand rows={band} currency={c} />
            </div>
          )}
        </Panel>
      </Section>

      <Section title="What every method starts from" className="mb-4">
        <Panel className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4" lit={false}>
          <Field label="Simulation the cash flows come from" hint={hasScenario ? undefined : 'The scenario lab holds no assumption, so only the books continuing are available'}>
            <select className="field" value={useScenario ? 'scenario' : 'base'} onChange={(e) => setSource(e.target.value as 'base' | 'scenario')}>
              <option value="base">{BOOKS_CONTINUE}</option>
              {hasScenario && <option value="scenario">{scenarioName} — the scenario in the lab</option>}
            </select>
          </Field>
          <Field label="Years of cash flow" hint="Whole years only: a part of a year is left out, not scaled up">
            <select className="field" value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y === 1 ? '' : 's'} · {y * 12} months</option>)}</select>
          </Field>
          <BookOrTyped label="Borrowings" book={base.debt} value={debt} onChange={setDebt} />
          <BookOrTyped label="Cash and bank" book={base.cash} value={cash} onChange={setCash} />
        </Panel>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ------------------------------------------------ discounted cash flow */}
        <Section title="1 · Discounted cash flow" right={<Estimate />} className="xl:col-span-2">
          <Panel className="grid gap-x-8 gap-y-2 p-4 xl:grid-cols-2" lit={false}>
           <div className="min-w-0">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Discount rate (% a year)"><input className="field num" inputMode="decimal" value={discount} onChange={(e) => setDiscount(digits(e.target.value))} /></Field>
              <Field label="Growth for ever after (% a year)"><input className="field num" inputMode="decimal" value={growth} onChange={(e) => setGrowth(signed(e.target.value))} /></Field>
            </div>
            <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              <div>Free cash flow of a year = <span className="num text-gold">operating profit − tax − assets bought − increase in working capital</span></div>
              <div>Present value = <span className="num text-gold">cash flow ÷ (1 + discount)^year</span></div>
              <div>Terminal value = <span className="num text-gold">last cash flow × (1 + growth) ÷ (discount − growth)</span></div>
              <div>Equity = <span className="num text-gold">Σ present values + present value of the terminal value − borrowings + cash</span></div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2"><div className="eyebrow">Cash flows, year by year</div><Simulated /></div>
            {parts.length === 0 ? <div className="mt-2 text-[12.5px] text-muted">The simulation holds no whole year.</div> : (
              <div className="mt-1.5 overflow-auto">
                <table className="table">
                  <thead><tr><th>Year</th><th style={{ textAlign: 'right' }}>Operating profit</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>Assets bought</th><th style={{ textAlign: 'right' }}>Rise in working capital</th><th style={{ textAlign: 'right' }}>Free cash flow</th><th style={{ textAlign: 'right' }}>Present value</th></tr></thead>
                  <tbody>
                    {parts.map((p, i) => (
                      <tr key={p.year}>
                        <td><span className="num">{p.year}</span> <span className="text-[11px] text-muted">{p.from} – {p.to}</span></td>
                        <td className="r"><Sim value={p.operating} currency={c} /></td><td className="r"><Sim value={p.tax} currency={c} /></td><td className="r"><Sim value={p.capex} currency={c} /></td><td className="r"><Sim value={p.wcChange} currency={c} /></td>
                        <td className="r"><Sim value={p.flow} currency={c} colored /></td>
                        <td className="r">{d && !d.refused ? <Sim value={d.presentValues[i]} currency={c} /> : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-1.5 text-[11.5px] text-muted">Working capital at the start: <Money value={openingWc} currency={c} decimals={0} /> <Truth state="ACTUAL" /> (receivables + inventory − payables, from the books).</div>
            {d && <div className="mt-4"><div className="eyebrow mb-1.5">Assumptions stated by the method</div><Sentences items={d.assumptions} empty="" /></div>}
           </div>
           <div className="min-w-0">
            {rate === null || g === null ? <Note kind="warn">Enter the discount rate and the growth assumed for ever.</Note>
              : d?.refused ? <Note kind="warn">{d.refused}</Note>
              : d && (
                <>
                  <div>
                    <div className={line}><span className="text-ink2">Sum of the present values</span><Sim value={d.presentValues.reduce((s, v) => s + v, 0)} currency={c} /></div>
                    <div className={line}><span className="text-ink2">Terminal value, at the end of year {flows.length}</span><Sim value={d.terminalValue} currency={c} /></div>
                    <div className={line}><span className="text-ink2">Present value of the terminal value</span><Sim value={d.terminalPresent} currency={c} /></div>
                    <div className={line}><span className="text-ink2">Value of the business (enterprise value)</span><Sim value={d.enterpriseValue} currency={c} className="text-ink" /></div>
                    <div className={line}><span className="text-ink2">Less borrowings</span><Sim value={-debtV} currency={c} /></div>
                    <div className={line}><span className="text-ink2">Plus cash</span><Sim value={cashV} currency={c} /></div>
                    <div className={line}><span className="font-medium text-ink">Value of the equity</span><span className="flex items-center gap-2"><Estimate /><Sim value={d.equityValue} currency={c} className="font-medium text-ink" /></span></div>
                  </div>
                  {d.enterpriseValue !== 0 && <div className="mt-1.5 text-[11.5px] text-muted">The terminal value is <span className="num text-ink2">{one((d.terminalPresent / d.enterpriseValue) * 100)}%</span> of the value of the business: that much of the estimate rests on the growth assumed for ever.</div>}

                  <div className="eyebrow mb-1.5 mt-4">How the equity value moves with the two rates</div>
                  <div className="overflow-auto">
                    <table className="table">
                      <thead><tr><th>Discount rate</th>{[-1, 0, 1].map((k) => <th key={k} style={{ textAlign: 'right' }}>growth {one(g + k)}%</th>)}</tr></thead>
                      <tbody>
                        {[-2, 0, 2].map((k) => (
                          <tr key={k}>
                            <td><span className="num">{one(rate + k)}%</span></td>
                            {[-1, 0, 1].map((j) => {
                              const s = d.sensitivity.find((x) => Math.abs(x.discountPct - (rate + k)) < 1e-9 && Math.abs(x.growthPct - (g + j)) < 1e-9)
                              return <td key={j} className="r">{s ? <Sim value={s.equityValue} currency={c} className={k === 0 && j === 0 ? 'font-medium text-ink' : undefined} /> : <span className="text-muted" title="The discount rate must be above the growth rate and above zero">no value</span>}</td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
           </div>
          </Panel>
        </Section>

        {/* ------------------------------------------------ multiples */}
        <Section title="2 · Multiples" right={<Estimate />}>
          <Panel className="p-4" lit={false}>
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              <div>Value of the business = <span className="num text-gold">figure × multiple</span></div>
              <div>Equity = <span className="num text-gold">figure × multiple − borrowings + cash</span></div>
              <div className="mt-1">NUMERO holds no market data and looks nothing up. The multiple and its source are yours; a multiple without a source is not counted.</div>
            </div>
            <div className="mt-3 space-y-3">
              {multiples.map((r, i) => {
                const m = metricOf(r.metric)
                const res = resultOf(r)
                const typed = r.metric === 'typed' || r.value.trim() !== ''
                return (
                  <div key={r.id} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-ink2">Comparison {i + 1}</span>
                      <button className="btn ghost icon sm" onClick={() => setMultiples((xs) => xs.filter((x) => x.id !== r.id))} aria-label={`Remove comparison ${i + 1}`}><Trash2 size={13} /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Figure of the company" className="sm:col-span-2"><select className="field" value={r.metric} onChange={(e) => setM(r.id, { metric: e.target.value, value: '' })}>{METRICS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
                      <div>
                        <Field label="Its amount"><input className="field num" inputMode="decimal" value={r.value} onChange={(e) => setM(r.id, { value: signed(e.target.value) })} placeholder={m.value === null ? 'type it' : String(whole(m.value))} /></Field>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">{typed ? <span className="chip">TYPED</span> : m.mark === 'ACTUAL' ? <Truth state="ACTUAL" /> : <Simulated />}<span>{typed ? 'typed by you' : m.how}</span></div>
                      </div>
                      <Field label="Multiple (times)"><input className="field num" inputMode="decimal" value={r.multiple} onChange={(e) => setM(r.id, { multiple: digits(e.target.value) })} /></Field>
                      <Field label="Where the multiple comes from" className="sm:col-span-2" hint="A transaction, a listed company, a broker's note — with its date"><input className="field" value={r.source} onChange={(e) => setM(r.id, { source: e.target.value })} /></Field>
                    </div>
                    {!res ? <div className="mt-2.5 text-[12px] text-muted">Enter the figure and the multiple.</div>
                      : res.refused ? <div className="mt-2.5 text-[12px] text-warn">{res.refused}</div>
                      : (
                        <div className="mt-2.5">
                          <div className={line}><span className="text-ink2">Value of the business</span><Sim value={res.enterpriseValue} currency={c} /></div>
                          <div className={line}><span className="text-ink2">Less borrowings, plus cash</span><Sim value={cashV - debtV} currency={c} sign /></div>
                          <div className={line}><span className="font-medium text-ink">Value of the equity</span><span className="flex items-center gap-2"><Estimate /><Sim value={res.equityValue} currency={c} className="font-medium text-ink" /></span></div>
                        </div>
                      )}
                  </div>
                )
              })}
            </div>
            <button className="btn sm mt-3" disabled={multiples.length >= 6} onClick={() => setMultiples((xs) => [...xs, { id: rid(), metric: 'revenue', value: '', multiple: '', source: '' }])}><Plus size={13} /> Add a comparison</button>
          </Panel>
        </Section>

        {/* ------------------------------------------------ net assets */}
        <Section title="3 · Net assets" right={<Estimate />}>
          <Panel className="p-4" lit={false}>
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              <div>Net assets in the books = <span className="num text-gold">total assets − total liabilities</span></div>
              <div>Adjusted = <span className="num text-gold">net assets in the books + adjustments that state their basis</span></div>
            </div>
            {!complete && <Note kind="warn" className="mt-3">Your role does not read the ledger (report.view) in every company selected, so the balance sheet is not read here. Type the totals, or choose companies whose ledger you read.</Note>}
            {books.error && <Note kind="warn" className="mt-3">The balance sheet could not be read: {books.error}</Note>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <BookOrTyped label="Total assets" book={books.data?.assets ?? null} value={assets} onChange={setAssets} reading={complete && books.loading && !books.data} />
              <BookOrTyped label="Total liabilities" book={books.data?.liabilities ?? null} value={liabs} onChange={setLiabs} reading={complete && books.loading && !books.data} />
            </div>
            {ids.length > 1 && <div className="mt-2 text-[11.5px] leading-relaxed text-muted">Several companies are added as they stand. What one of them owes another cancels between assets and liabilities. What one of them has invested in another does not: it is inside the assets of the first and the net assets of the second{books.data && books.data.investments !== 0 ? <> (investments in the books: <Money value={books.data.investments} currency={c} decimals={0} />)</> : null}. Adjust for it below if it applies.</div>}

            <div className="eyebrow mb-1.5 mt-4">Adjustments</div>
            {adjust.length === 0 && <div className="text-[12.5px] text-muted">None. Add one where the books carry something at an amount that differs from what it is worth — land at cost, stock that will not sell, a claim not recorded.</div>}
            <div className="space-y-3">
              {adjust.map((a, i) => (
                <div key={a.id} className="rounded-xl border border-line p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={`Adjustment ${i + 1}`}><input className="field" value={a.label} onChange={(e) => setA(a.id, { label: e.target.value })} placeholder="What is adjusted" /></Field>
                    <Field label="Amount (negative: a reduction)"><input className="field num" inputMode="decimal" value={a.amount} onChange={(e) => setA(a.id, { amount: signed(e.target.value) })} /></Field>
                    <Field label="Basis" className="sm:col-span-2" hint="A valuation report, a quotation, a court order — what the amount rests on"><input className="field" value={a.basis} onChange={(e) => setA(a.id, { basis: e.target.value })} /></Field>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px]">
                    <span className={a.label.trim() && num(a.amount) !== null && !a.basis.trim() ? 'text-warn' : 'text-muted'}>{!a.label.trim() || num(a.amount) === null ? 'Not counted until it has a name and an amount.' : !a.basis.trim() ? 'Not counted: an adjustment without its basis is left out.' : 'Counted.'}</span>
                    <button className="btn ghost icon sm" onClick={() => setAdjust((xs) => xs.filter((x) => x.id !== a.id))} aria-label={`Remove adjustment ${i + 1}`}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn sm mt-3" disabled={adjust.length >= 12} onClick={() => setAdjust((xs) => [...xs, { id: rid(), label: '', amount: '', basis: '' }])}><Plus size={13} /> Add an adjustment</button>

            {!na ? <Note className="mt-4">Total assets and total liabilities are needed.</Note> : (
              <div className="mt-4">
                <div className={line}><span className="text-ink2">Total assets</span><Money value={assetsV ?? 0} currency={c} decimals={0} /></div>
                <div className={line}><span className="text-ink2">Less total liabilities</span><Money value={-(liabsV ?? 0)} currency={c} decimals={0} /></div>
                <div className={line}><span className="text-ink2">Net assets in the books</span><span className="flex items-center gap-2">{assets.trim() === '' && liabs.trim() === '' ? <Truth state="ACTUAL" /> : <span className="chip">TYPED</span>}<Money value={na.bookNetAssets} currency={c} decimals={0} className="text-ink" /></span></div>
                {na.adjustments.map((a, i) => <div key={i} className={line}><span className="min-w-0 text-ink2">{a.label}<span className="block text-[11px] text-muted">{a.basis}</span></span><Money value={a.amount} currency={c} decimals={0} sign /></div>)}
                <div className={line}><span className="font-medium text-ink">Net assets, adjusted</span><span className="flex items-center gap-2"><Estimate /><Sim value={na.adjusted} currency={c} className="font-medium text-ink" /></span></div>
                {na.leftOut.length > 0 && <div className="mt-2"><Sentences items={na.leftOut} empty="" /></div>}
              </div>
            )}
          </Panel>
        </Section>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ a rule tried on history
const ANY = '*'
const roleLabel = (key: string, roles: Role[]) => (key === ANY ? 'any authorised approver' : roles.find((r) => r.key === key)?.name ?? key.replace(/_/g, ' '))
const entityLabel = (e: string) => (e === 'journal' ? 'Journals and entries proposed by operations' : APPROVAL_ENTITIES[e] ? APPROVAL_ENTITIES[e].label + 's' : human(e))
/** Where an alert carries an amount, in the order the facts recorded with it are read. */
const AMOUNT_KEYS = ['amount', 'difference', 'total', 'outstanding', 'billed'] as const
export const alertAmount = (a: Alert): number | null => {
  for (const k of AMOUNT_KEYS) {
    const v = (a.evidence ?? {})[k]
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : NaN
    if (Number.isFinite(n)) return n
  }
  return null
}

export function RulesTab({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const code = useCompanyCode()
  const privacy = useApp((s) => s.privacy)
  const idsKey = ids.join(',')
  const alertIds = ids.filter((id) => can('sentinel.view', id))
  const alertKey = alertIds.join(',')

  const history = useAsync(async () => {
    const [requests, rules, roles] = await Promise.all([api.listApprovalRequests(ids), api.listApprovalRules().catch(() => [] as ApprovalRule[]), api.listRoles().catch(() => [] as Role[])])
    return { requests, rules, roles }
  }, [api, idsKey])
  const alerts = useAsync(async () => (alertIds.length ? api.listAlerts(alertIds) : []), [api, alertKey])

  // ---- the approval rule being tried
  const [from, setFrom] = useState('')
  const [entity, setEntity] = useState('journal')
  const [company, setCompany] = useState('')
  const [min, setMin] = useState('0')
  const [max, setMax] = useState('')
  const [steps, setSteps] = useState<string[]>([ANY, ANY])
  const roles = history.data?.roles ?? []
  const requests = history.data?.requests ?? []
  const rules = history.data?.rules ?? []
  const entities = useMemo(() => [...new Set(['journal', ...Object.keys(APPROVAL_ENTITIES), ...requests.map((r) => r.entity)])], [requests])
  const startFrom = (id: string) => {
    setFrom(id)
    const r = rules.find((x) => x.id === id)
    if (!r) return
    setEntity(r.entity); setCompany(r.company_id && ids.includes(r.company_id) ? r.company_id : ''); setMin(D(r.min_amount).toString()); setMax(r.max_amount === null ? '' : D(r.max_amount).toString()); setSteps(r.steps.length ? [...r.steps] : [ANY])
  }
  const ruleProblems: string[] = []
  if (num(min) === null) ruleProblems.push('Enter the amount the rule starts from (0 for every amount).')
  if (max.trim() !== '' && (num(max) === null || (num(min) !== null && (num(max) as number) <= (num(min) as number)))) ruleProblems.push('The upper amount must be greater than the lower amount, or empty for "and above".')
  if (!steps.length) ruleProblems.push('A rule needs at least one step.')
  const trial = useMemo(() => (ruleProblems.length || !history.data ? null : tryApprovalRule({ name: 'Rule being tried', entity, company_id: company || null, min_amount: min.trim(), max_amount: max.trim() === '' ? null : max.trim(), steps }, requests)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entity, company, min, max, steps.join('|'), requests, ruleProblems.length, !history.data])

  const currencyOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency
  const trialByCurrency = useMemo(() => {
    const m = new Map<string, Decimal>()
    for (const a of trial?.amounts ?? []) { const k = companies.find((c) => c.id === a.company_id)?.base_currency ?? ''; m.set(k, (m.get(k) ?? D(0)).plus(a.amount)) }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }, [trial, companies])
  const exampleColumns: Column<ApprovalRequest>[] = [
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companies.find((c) => c.id === r.company_id)?.name}>{code(r.company_id)}</span>, sort: (r) => code(r.company_id), csv: (r) => companies.find((c) => c.id === r.company_id)?.name ?? '' },
    { key: 'summary', header: 'Request', render: (r) => <span className="text-ink">{r.summary || <span className="text-muted">No narration was entered</span>}</span>, csv: (r) => r.summary ?? '' },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} currency={currencyOf(r.company_id)} />, sort: (r) => D(r.amount).toNumber(), csv: (r) => D(r.amount).toFixed(2) },
    { key: 'had', header: 'Approvals it went through', align: 'right', render: (r) => <span className="num" title={r.steps.map((s) => roleLabel(s, roles)).join(' → ')}>{r.steps.length}</span>, sort: (r) => r.steps.length, csv: (r) => r.steps.length },
    { key: 'would', header: 'Under the rule tried', align: 'right', render: (r) => <span className="flex items-center justify-end gap-1.5"><span className="num">{steps.length}</span>{steps.length > r.steps.length && <span className="chip warn">+{steps.length - r.steps.length}</span>}</span>, csv: () => steps.length },
    { key: 'status', header: 'What became of it', render: (r) => <StatusChip status={r.status} />, sort: (r) => r.status, csv: (r) => r.status },
    { key: 'when', header: 'Requested', render: (r) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(r.requested_at)}</span>, sort: (r) => r.requested_at, csv: (r) => r.requested_at },
  ]

  // ---- the threshold being tried. A threshold is an amount in one currency: alerts of companies that keep their books in another are left out
  const [ccy, setCcy] = useState('')
  const currencies = useMemo(() => [...new Set((alerts.data ?? []).map((a) => companies.find((c) => c.id === a.company_id)?.base_currency ?? ''))].filter(Boolean).sort(), [alerts.data, companies])
  const cur = currencies.includes(ccy) ? ccy : currencies[0] ?? ''
  const alertsIn = useMemo(() => (currencies.length > 1 ? (alerts.data ?? []).filter((a) => companies.find((c) => c.id === a.company_id)?.base_currency === cur) : alerts.data ?? []), [alerts.data, companies, currencies.length, cur])
  const kinds = useMemo(() => {
    const m = new Map<string, { kind: string; all: number; withAmount: number; falsePositive: number; largest: number }>()
    for (const a of alertsIn) {
      const k = m.get(a.kind) ?? { kind: a.kind, all: 0, withAmount: 0, falsePositive: 0, largest: 0 }
      const v = alertAmount(a)
      k.all++; if (v !== null) { k.withAmount++; k.largest = Math.max(k.largest, Math.abs(v)) }
      if (a.status === 'false_positive') k.falsePositive++
      m.set(a.kind, k)
    }
    return [...m.values()].sort((a, b) => b.withAmount - a.withAmount || b.all - a.all)
  }, [alertsIn])
  const [kind, setKind] = useState('')
  const [threshold, setThreshold] = useState('')
  const chosen = kinds.find((k) => k.kind === kind) ?? kinds[0] ?? null
  const th = num(threshold)
  const ofKind = useMemo(() => alertsIn.filter((a) => chosen && a.kind === chosen.kind), [alertsIn, chosen])
  const trialT = useMemo(() => (chosen && th !== null ? tryThreshold(alertsIn, chosen.kind, th, alertAmount) : null), [alertsIn, chosen, th])
  const spared = th === null ? 0 : ofKind.filter((a) => a.status === 'false_positive' && alertAmount(a) !== null && Math.abs(alertAmount(a) as number) < th).length
  const dropped = th === null ? 0 : ofKind.filter((a) => a.status !== 'false_positive' && alertAmount(a) !== null && Math.abs(alertAmount(a) as number) < th).length
  const alertColumns: Column<Alert>[] = [
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2">{code(a.company_id)}</span>, sort: (a) => code(a.company_id), csv: (a) => companies.find((c) => c.id === a.company_id)?.name ?? '' },
    { key: 'title', header: 'Alert', render: (a) => <span className="text-ink">{a.title}</span>, csv: (a) => a.title },
    { key: 'amount', header: 'Amount recorded with it', align: 'right', render: (a) => { const v = alertAmount(a); return v === null ? <span className="text-muted">none</span> : <Money value={Math.abs(v)} currency={currencyOf(a.company_id)} /> }, sort: (a) => Math.abs(alertAmount(a) ?? 0), csv: (a) => alertAmount(a) ?? '' },
    { key: 'status', header: 'What a person decided', render: (a) => <StatusChip status={a.status} label={a.status === 'false_positive' ? 'closed as not a concern' : undefined} />, sort: (a) => a.status, csv: (a) => a.status },
    {
      key: 'would', header: 'At the threshold tried', sort: (a) => { const v = alertAmount(a); return v === null || th === null ? 0 : Math.abs(v) >= th ? 2 : 1 }, csv: (a) => { const v = alertAmount(a); return v === null ? 'no amount' : th === null ? '' : Math.abs(v) >= th ? 'raised' : 'not raised' },
      render: (a) => { const v = alertAmount(a); return v === null ? <span className="text-muted">no amount to test</span> : th === null ? <span className="text-muted">—</span> : Math.abs(v) >= th ? <span className="chip warn">still raised</span> : <span className="chip">not raised</span> },
    },
    { key: 'when', header: 'Raised', render: (a) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(a.created_at)}</span>, sort: (a) => a.created_at, csv: (a) => a.created_at },
  ]

  return (
    <div>
      <SimulationBanner>
        <strong className="text-ink">Trying a rule changes nothing.</strong> The rule typed here is tested against what is already on record and then forgotten. No request is re-opened, no alert is raised or closed. Approval rules are changed under Approvals, and the thresholds of Sentinel in the Genesis Builder, by the people allowed to change them.
      </SimulationBanner>

      <div className="grid gap-4 2xl:grid-cols-2">
        {/* ------------------------------------------------ approval rule */}
        <Section title="An approval rule, tried on past requests" right={<button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/approvals')}>Approvals <ExternalLink size={11} /></button>}>
          <Panel className="p-4" lit={false}>
            {history.error && <ErrorBox message={history.error} retry={history.reload} />}
            {!history.error && !history.data && <Loading rows={4} label="Loading the requests on record" />}
            {history.data && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Start from a rule in force" className="sm:col-span-2" hint={rules.length ? 'Its terms are copied here to be changed; the rule itself is not touched' : 'No rule could be read; type the terms below'}>
                    <select className="field" value={from} onChange={(e) => startFrom(e.target.value)} disabled={!rules.length}>
                      <option value="">A new rule</option>
                      {rules.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_active ? '' : ' (switched off)'}</option>)}
                    </select>
                  </Field>
                  <Field label="Applies to"><select className="field" value={entity} onChange={(e) => setEntity(e.target.value)}>{entities.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}</select></Field>
                  <Field label="Company"><select className="field" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Every company selected</option>{companies.filter((c) => ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
                  <Field label="From amount"><input className="field num" inputMode="decimal" value={min} onChange={(e) => setMin(digits(e.target.value))} /></Field>
                  <Field label="To below" hint="Empty: and above"><input className="field num" inputMode="decimal" value={max} onChange={(e) => setMax(digits(e.target.value))} /></Field>
                </div>
                <div className="eyebrow mb-1.5 mt-4">Approvals the rule asks for, in order</div>
                <div className="rounded-xl border border-line">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                      <span className="num w-14 flex-none text-[12px] text-muted">Step {i + 1}</span>
                      <select className="field sm flex-1" value={s} onChange={(e) => setSteps(steps.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Step ${i + 1}: role required`}>
                        <option value={ANY}>Any authorised approver</option>
                        {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                        {s !== ANY && !roles.some((r) => r.key === s) && <option value={s}>{s.replace(/_/g, ' ')}</option>}
                      </select>
                      <button className="btn ghost icon sm" disabled={steps.length <= 1} onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label={`Remove step ${i + 1}`}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
                <button className="btn sm mt-2" disabled={steps.length >= 6} onClick={() => setSteps([...steps, ANY])}><Plus size={13} /> Add a step</button>
                {ruleProblems.length > 0 && <Note kind="warn" className="mt-3"><ul className="m-0 list-disc pl-4">{ruleProblems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}

                {trial && (
                  <div className="mt-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Count label="Requests on record" value={trial.examined} sub={entityLabel(entity).toLowerCase()} />
                      <Count label="The rule would have applied to" value={trial.caught} tone={trial.caught ? 'text-gold' : undefined} sub={trial.examined ? `${one((trial.caught / trial.examined) * 100)}% of them` : 'nothing to try it on'} />
                      <Count label="Approvals it would have added" value={trial.stepsAdded} tone={trial.stepsAdded ? 'text-warn' : undefined} sub="more than those requests went through" />
                      <div className="rounded-xl border border-line px-3 py-2.5"><div className="text-[11.5px] text-muted">Amount of those requests</div><div className="mt-0.5 text-[17px] text-ink">{trialByCurrency.length ? trialByCurrency.map(([ccy, v], i) => <span key={ccy}>{i > 0 && <span className="text-muted"> · </span>}<Money value={v} currency={ccy} compact /></span>) : <Money value={0} compact />}</div><div className="text-[11px] text-muted">{trialByCurrency.length > 1 ? 'each currency by itself: they are not added' : 'in total'}</div></div>
                    </div>
                    <div className="mt-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">{trial.says}</div>
                    <div className="mt-1.5 text-[11.5px] text-muted">A request is counted when its kind and company match and its amount is at or above the lower amount and below the upper one. Approvals added = for each such request, the steps of the rule less the steps it had, never below zero. The roles named in the steps are not compared.</div>
                  </div>
                )}
              </>
            )}
          </Panel>
          {trial && trial.examples.length > 0 && (
            <Panel lit={false} className="mt-3">
              <DataTable columns={exampleColumns} rows={trial.examples} rowKey={(r) => r.id} exportName="SIMULATION-approval-rule-trial" initialSort={{ key: 'amount', dir: 'desc' }}
                toolbar={<span className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><Simulated label="TRIAL" /> The {trial.examples.length} largest request{trial.examples.length === 1 ? '' : 's'} the rule would have applied to{trial.caught > trial.examples.length ? `, of ${trial.caught}` : ''}. The requests are records; the column "under the rule tried" is the trial.</span>} />
            </Panel>
          )}
        </Section>

        {/* ------------------------------------------------ sentinel threshold */}
        <Section title="A Sentinel threshold, tried on past alerts" right={<button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/sentinel')}>Sentinel <ExternalLink size={11} /></button>}>
          <Panel className="p-4" lit={false}>
            {!alertIds.length ? <Empty icon={<ShieldCheck size={20} />} title="Your role does not read Sentinel alerts" body={<>Trying a threshold needs the permission <span className="num text-ink2">sentinel.view</span> in at least one of the selected companies. Alerts you cannot read still exist.</>} />
              : alerts.error ? <ErrorBox message={alerts.error} retry={alerts.reload} />
              : !alerts.data ? <Loading rows={4} label="Loading the alerts on record" />
              : !kinds.length ? <Empty icon={<ShieldCheck size={20} />} title="No alert is on record" body="Sentinel has raised nothing in the companies you read, so there is nothing to try a threshold against." />
              : (
                <>
                  {alertIds.length < ids.length && <Note kind="warn" className="mb-3">Alerts are read in {alertIds.length} of the {ids.length} companies selected: your role does not include sentinel.view in the others.</Note>}
                  {currencies.length > 1 && (
                    <Field label="Currency of the threshold" className="mb-3" hint={`A threshold is an amount in one currency. Alerts of companies that keep their books in another currency are left out of this trial: ${(alerts.data ?? []).length - alertsIn.length} of ${(alerts.data ?? []).length}.`}>
                      <select className="field" value={cur} onChange={(e) => { setCcy(e.target.value); setKind(''); setThreshold('') }}>{currencies.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                    </Field>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Kind of alert" hint="Only kinds that Sentinel has raised are listed">
                      <select className="field" value={chosen?.kind ?? ''} onChange={(e) => { setKind(e.target.value); setThreshold('') }}>
                        {kinds.map((k) => <option key={k.kind} value={k.kind}>{human(k.kind)} — {k.all} on record, {k.withAmount} with an amount</option>)}
                      </select>
                    </Field>
                    <Field label="Threshold to try" hint={chosen?.withAmount ? `Largest amount on record for this kind: ${privacy ? 'hidden — privacy mode is on' : whole(chosen.largest).toLocaleString('en-IN')}` : 'Alerts of this kind carry no amount'}>
                      <input className="field num" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(digits(e.target.value))} placeholder="An amount" />
                    </Field>
                  </div>
                  {chosen && chosen.withAmount === 0 && <Note kind="warn" className="mt-3">No alert of this kind carries an amount, so a threshold in money has nothing to act on. The pattern it tests is not a matter of size.</Note>}
                  {chosen && chosen.withAmount > 0 && chosen.withAmount < chosen.all && <div className="mt-2 text-[11.5px] text-muted">{chosen.all - chosen.withAmount} alert{chosen.all - chosen.withAmount === 1 ? '' : 's'} of this kind carry no amount and are left out of the trial.</div>}
                  {trialT ? (
                    <div className="mt-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Count label="Alerts with an amount" value={trialT.examined} sub="of this kind, on record" />
                        <Count label="Still raised" value={trialT.flagged} tone={trialT.flagged ? 'text-gold' : undefined} sub="at or above the threshold" />
                        <Count label="Closed as not a concern" value={trialT.alreadyClosedAsFalse} sub={`${spared} of them would not have been raised`} />
                        <Count label="Others no longer raised" value={dropped} tone={dropped ? 'text-warn' : undefined} sub="open, under review or resolved" />
                      </div>
                      <div className="mt-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">{trialT.says}</div>
                      {dropped > 0 && <Note kind="warn" className="mt-3">This threshold would also have kept back {dropped} alert{dropped === 1 ? '' : 's'} that a person did not close as "not a concern". A threshold that spares false alarms may hide what deserved a look: open the list below before deciding.</Note>}
                      <div className="mt-1.5 text-[11.5px] text-muted">The amount of an alert is read from the facts recorded with it: {AMOUNT_KEYS.join(', ')}, the first of these that is present. An alert is "still raised" when that amount, without its sign, is at or above the threshold.</div>
                    </div>
                  ) : chosen && chosen.withAmount > 0 ? <Note className="mt-3">Enter a threshold to see how many of the {chosen.withAmount} alert{chosen.withAmount === 1 ? '' : 's'} it would still have raised.</Note> : null}
                </>
              )}
          </Panel>
          {chosen && ofKind.length > 0 && (
            <Panel lit={false} className="mt-3">
              <DataTable columns={alertColumns} rows={ofKind} rowKey={(a) => a.id} exportName="SIMULATION-sentinel-threshold-trial" initialSort={{ key: 'amount', dir: 'desc' }} onRow={(a) => nav('/sentinel?alert=' + a.id)}
                toolbar={<span className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><Simulated label="TRIAL" /> Alerts of the kind "{human(chosen.kind)}". The alerts and what was decided are records; the column "at the threshold tried" is the trial.</span>} />
            </Panel>
          )}
        </Section>
      </div>
    </div>
  )
}

function Count({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cx('num mt-0.5 text-[19px]', tone ?? 'text-ink')}>{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
