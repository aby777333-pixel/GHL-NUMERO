// NUMERO DIGITAL TWIN — a model of a company or of the group, built from the books,
// on which a person can try a decision before taking it.
//
// Rules this file keeps:
//   * It is pure calculation. It reads figures given to it and writes nothing.
//   * Every result is a SIMULATION. It is never added to, or shown as, an actual.
//   * Every figure can be traced: the base says where it came from, each
//     assumption says what it changed and by what formula.
//   * Where the books do not hold enough to model something, the model says so
//     instead of inventing a number.

import type { ID } from './types'
import type { Shock, ShockKind, TwinDriver } from './p3Types'

export const SIMULATION = 'SIMULATION' as const

export interface TwinCategory { key: string; label: string; monthly: number }
export interface TwinCustomer { id: ID; name: string; monthlyRevenue: number; receivable: number }

/** The starting point of every simulation: what the books say, as monthly rates and as a position. */
export interface TwinBase {
  asOf: string
  currency: string
  scope: string
  /** months of actuals the monthly rates are averaged over */
  basisMonths: number
  revenue: number
  cogs: number
  payroll: number
  opex: number
  otherIncome: number
  depreciation: number
  financeCost: number
  tax: number
  categories: TwinCategory[]
  cash: number
  receivables: number
  payables: number
  inventory: number
  debt: number
  fixedAssets: number
  headcount: number | null
  customers: TwinCustomer[]
  /** principal already scheduled for repayment in each coming month (index 0 = the first month) */
  debtRepayments: number[]
  /** firm one-off amounts not contained in the monthly rates: open orders, asset purchases recorded in the registers */
  committedOut: number[]
  committedIn: number[]
  /** what the model could not read, or had to assume */
  notes: string[]
}

export interface TwinMonth {
  month: number
  label: string
  revenue: number
  cogs: number
  grossProfit: number
  payroll: number
  opex: number
  operatingProfit: number
  depreciation: number
  financeCost: number
  tax: number
  profit: number
  collections: number
  paidToSuppliers: number
  capex: number
  borrowed: number
  repaid: number
  netCash: number
  cash: number
  receivables: number
  payables: number
  debt: number
  workingCapital: number
  /** cash available in the month ÷ cash that had to leave in the month */
  coverage: number | null
}
export interface ShockEffect { kind: ShockKind; label: string; text: string; formula: string }
export interface TwinResult {
  label: typeof SIMULATION
  name: string
  asOf: string
  currency: string
  horizon: number
  months: TwinMonth[]
  totals: { revenue: number; profit: number; operatingProfit: number; closingCash: number; lowestCash: number; lowestCashMonth: number; closingDebt: number; closingWorkingCapital: number; borrowingRequirement: number; lowestCoverage: number | null; monthsOfCashLeft: number | null }
  effects: ShockEffect[]
  assumptions: string[]
  notes: string[]
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const monthLabel = (asOf: string, m: number) => {
  const d = new Date(asOf + 'T00:00:00')
  const x = new Date(d.getFullYear(), d.getMonth() + m, 1)
  return x.toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}
const pct = (v: number) => `${v > 0 ? '+' : ''}${r2(v)}%`
/** a project without a stated duration lasts twelve months: it does not run for as long as the model looks ahead */
const span = (s: Shock) => (s.kind === 'new_project' ? Math.max(1, s.months ?? 12) : s.months)
const active = (s: Shock, m: number) => m >= (s.from_month ?? 1) && (span(s) === undefined || s.kind === 'new_borrowing' || s.kind === 'capex' || m < (s.from_month ?? 1) + span(s)!)

export const SHOCK_KINDS: { kind: ShockKind; label: string; unit: 'percent' | 'points' | 'days' | 'amount' | 'count'; needs?: string; hint: string }[] = [
  { kind: 'revenue_pct', label: 'Revenue changes', unit: 'percent', hint: 'Sales rise or fall by this percentage from the month stated.' },
  { kind: 'margin_pts', label: 'Gross margin changes', unit: 'points', hint: 'The gross margin moves by this many percentage points; the cost of what is sold moves with it.' },
  { kind: 'expense_pct', label: 'Operating expenses change', unit: 'percent', hint: 'Every operating expense other than payroll rises or falls by this percentage.' },
  { kind: 'category_pct', label: 'One kind of expense changes', unit: 'percent', needs: 'target', hint: 'A named expense ledger — fuel, marketing, rent — changes by this percentage. 100 doubles it.' },
  { kind: 'payroll_pct', label: 'Payroll changes', unit: 'percent', hint: 'The cost of salaries rises or falls by this percentage.' },
  { kind: 'new_hires', label: 'New people are hired', unit: 'count', needs: 'extra', hint: 'This many people join; give the monthly cost of one of them.' },
  { kind: 'collection_delay_days', label: 'Customers pay later', unit: 'days', hint: 'Customers take this many more days to pay. Name a customer, or "top3", to delay only them.' },
  { kind: 'payment_delay_days', label: 'Suppliers are paid later', unit: 'days', hint: 'The company takes this many more days to pay its suppliers.' },
  { kind: 'interest_rate_pts', label: 'Interest rates change', unit: 'points', hint: 'The rate on borrowings moves by this many percentage points.' },
  { kind: 'fx_pct', label: 'Exchange rate moves', unit: 'percent', needs: 'extra', hint: 'Costs bought in foreign currency move by this percentage; give the share of cost of sales that is imported.' },
  { kind: 'capex', label: 'An asset is bought', unit: 'amount', hint: 'Money is spent on equipment or property in the month stated, and depreciated over the life given.' },
  { kind: 'new_borrowing', label: 'Money is borrowed', unit: 'amount', hint: 'A loan is taken in the month stated, at the rate given, and repaid over the months given.' },
  { kind: 'lose_customer', label: 'A customer is lost', unit: 'percent', needs: 'target', hint: 'A named customer stops buying. 100 means all of their business.' },
  { kind: 'new_project', label: 'A project starts', unit: 'amount', needs: 'extra', hint: 'A project brings this revenue over the months given, at the margin given.' },
  { kind: 'project_overrun_pct', label: 'Costs of sale overrun', unit: 'percent', hint: 'The cost of what is sold overruns by this percentage while revenue stays as it is.' },
  { kind: 'one_off', label: 'A one-off amount', unit: 'amount', hint: 'A single receipt (positive) or payment (negative) in the month stated.' },
]

const UNIT_WORD: Record<string, string> = { amount: 'an amount', percent: 'percent', days: 'days', count: 'a count', rate: 'percent a year' }
/** A driver supplies the value of an assumption only where both are in the same unit. Percentage points take a percentage or a rate. */
export const driverFits = (unit: TwinDriver['unit'], wants: 'percent' | 'points' | 'days' | 'amount' | 'count') =>
  wants === 'points' ? unit === 'percent' || unit === 'rate' : unit === wants

/**
 * Runs the model forward. With no assumptions this is the base case: the books continue as they have been.
 * Approved drivers may supply the value of an assumption that names one.
 */
export function simulate(base: TwinBase, shocks: Shock[], horizon: number, name = 'Base case', drivers: (Pick<TwinDriver, 'key' | 'value' | 'status' | 'name'> & Partial<Pick<TwinDriver, 'unit'>>)[] = []): TwinResult {
  const H = Math.max(1, Math.min(60, Math.round(horizon)))
  const notes = [...base.notes]
  const assumptions: string[] = [
    `Monthly rates are the average of the last ${base.basisMonths} month(s) of posted entries, up to ${base.asOf}.`,
    'Customers are taken to pay, and suppliers to be paid, after the same number of days as the books show today.',
    'Tax is taken at the rate the books show for the same months; where the books show a loss or no tax, none is modelled.',
    'Borrowings already recorded are repaid as their schedules say. Interest is charged on what is outstanding each month.',
  ]
  // an assumption that names a driver takes the value of the driver, if a second person has approved it
  const use = shocks.map((s) => {
    if (!s.driver_key) return s
    const d = drivers.find((x) => x.key === s.driver_key && x.status === 'approved')
    if (!d) { notes.push(`The assumption "${s.label ?? s.kind}" names the driver "${s.driver_key}", which is not approved. The value typed (${s.value}) was used.`); return s }
    const wants = SHOCK_KINDS.find((k) => k.kind === s.kind)?.unit
    if (d.unit && wants && !driverFits(d.unit, wants)) {
      notes.push(`The driver "${d.name}" is stated in ${UNIT_WORD[d.unit]}; the assumption "${s.label ?? s.kind}" is in ${wants === 'points' ? 'percentage points' : UNIT_WORD[wants]}. The driver was not used: the value typed (${s.value}) was.`)
      return s
    }
    assumptions.push(`"${s.label ?? s.kind}" uses the approved driver "${d.name}" = ${d.value}.`)
    return { ...s, value: Number(d.value) }
  })

  const annualRevenue = base.revenue * 12
  const dso = annualRevenue > 0 ? (base.receivables / annualRevenue) * 365 : 0
  const bought = (base.cogs + base.opex) * 12
  const dpo = bought > 0 ? (base.payables / bought) * 365 : 0
  const cogsRatio = base.revenue > 0 ? base.cogs / base.revenue : 0
  const baseRate = base.debt > 0 ? (base.financeCost * 12) / base.debt : 0
  const pbtBase = base.revenue - base.cogs - base.payroll - base.opex + base.otherIncome - base.depreciation - base.financeCost
  const taxRate = pbtBase > 0 && base.tax > 0 ? Math.min(base.tax / pbtBase, 0.6) : 0
  if (base.revenue <= 0) notes.push('The books show no revenue in the months the model rests on. Assumptions stated as a percentage of revenue have nothing to act on.')
  if (base.debt > 0 && base.financeCost <= 0) notes.push('Borrowings are recorded, but no interest in the months the model rests on. Existing borrowings are modelled without interest.')
  /** the share of revenue that comes from the customers named; with `all`, naming nobody means every customer */
  const topShare = (target: string | undefined, id: ID | undefined, all = true) => {
    if (!target && !id) {
      if (all) return 1
      notes.push('An assumption that a customer is lost names no customer. It changed nothing.')
      return 0
    }
    const list = target === 'top3' ? base.customers.slice(0, 3) : base.customers.filter((c) => c.id === id || c.name.toLowerCase() === (target ?? '').toLowerCase())
    if (!list.length) { notes.push(`The customer "${target ?? id}" is not among the customers the books show. That assumption changed nothing.`); return 0 }
    return base.revenue > 0 ? list.reduce((s, c) => s + c.monthlyRevenue, 0) / base.revenue : 0
  }

  const effects: ShockEffect[] = use.map((s) => describe(s, base, topShare))
  const months: TwinMonth[] = []
  let cash = base.cash; let recv = base.receivables; let pay = base.payables; let debt = base.debt
  let newDebt: { left: number; perMonth: number; rate: number; from: number }[] = []
  let addedDep = 0

  for (let m = 1; m <= H; m++) {
    const on = use.filter((s) => active(s, m))
    const sumOf = (k: ShockKind, f: (s: Shock) => boolean = () => true) => on.filter((s) => s.kind === k && f(s)).reduce((t, s) => t + s.value, 0)

    // revenue
    let revenue = base.revenue * (1 + sumOf('revenue_pct') / 100)
    for (const s of on.filter((x) => x.kind === 'lose_customer')) revenue -= base.revenue * topShare(s.target, s.target_id, false) * Math.min(Math.max(s.value, 0), 100) / 100
    let projectRevenue = 0; let projectCost = 0
    for (const s of on.filter((x) => x.kind === 'new_project')) {
      const n = Math.max(1, s.months ?? 12)
      projectRevenue += s.value / n
      projectCost += (s.value / n) * (1 - Math.min(Math.max(s.extra ?? (1 - cogsRatio) * 100, -100), 100) / 100)
    }
    revenue = Math.max(0, revenue) + projectRevenue

    // cost of what is sold
    const ratio = Math.max(0, cogsRatio - sumOf('margin_pts') / 100)
    let cogs = (revenue - projectRevenue) * ratio + projectCost
    cogs *= 1 + sumOf('project_overrun_pct') / 100
    for (const s of on.filter((x) => x.kind === 'fx_pct')) cogs += cogs * (Math.min(Math.max(s.extra ?? 100, 0), 100) / 100) * (s.value / 100)

    // payroll and other expenses
    let payroll = base.payroll * (1 + sumOf('payroll_pct') / 100)
    for (const s of on.filter((x) => x.kind === 'new_hires')) payroll += Math.max(0, s.value) * Math.max(0, s.extra ?? (base.headcount ? base.payroll / base.headcount : 0))
    let opex = base.opex * (1 + sumOf('expense_pct') / 100)
    for (const s of on.filter((x) => x.kind === 'category_pct')) {
      const c = base.categories.find((x) => x.key === s.target || x.label.toLowerCase() === (s.target ?? '').toLowerCase())
      if (c) opex += c.monthly * (s.value / 100)
    }

    // assets and borrowing
    let capex = 0; let borrowed = 0
    for (const s of use.filter((x) => (x.from_month ?? 1) === m)) {
      if (s.kind === 'capex') { capex += Math.max(0, s.value); addedDep += Math.max(0, s.value) / Math.max(1, s.extra ?? 60) }
      if (s.kind === 'new_borrowing') {
        const n = Math.max(1, s.months ?? 60)
        borrowed += Math.max(0, s.value)
        newDebt.push({ left: Math.max(0, s.value), perMonth: Math.max(0, s.value) / n, rate: (s.extra ?? baseRate * 100) / 100, from: m })
      }
    }
    const depreciation = base.depreciation + addedDep
    const ratePts = sumOf('interest_rate_pts') / 100
    // what is owed on borrowings already in the books; borrowings of the simulation are followed one by one below
    const old = Math.max(0, debt - newDebt.filter((d) => d.from < m).reduce((t, d) => t + d.left, 0))
    let finance = (old * Math.max(0, baseRate + ratePts)) / 12
    let repaid = Math.min(old, base.debtRepayments[m - 1] ?? 0)
    for (const d of newDebt) {
      if (m <= d.from) continue            // interest and repayment begin the month after the money is received
      finance += (d.left * Math.max(0, d.rate + ratePts)) / 12
      const p = Math.min(d.left, d.perMonth); d.left -= p; repaid += p
    }
    newDebt = newDebt.filter((d) => d.left > 0.005)

    const grossProfit = revenue - cogs
    const operatingProfit = grossProfit - payroll - opex
    const pbt = operatingProfit + base.otherIncome - depreciation - finance
    const tax = pbt > 0 ? pbt * taxRate : 0
    const profit = pbt - tax

    // cash: customers and suppliers settle after the days the books show, moved by the assumptions
    let delay = 0
    for (const s of on.filter((x) => x.kind === 'collection_delay_days')) delay += s.value * topShare(s.target, s.target_id)
    const recvTarget = (revenue * 12 * Math.max(0, dso + delay)) / 365
    const collections = revenue - (recvTarget - recv)
    const payTarget = ((cogs + opex) * 12 * Math.max(0, dpo + sumOf('payment_delay_days'))) / 365
    const paidToSuppliers = cogs + opex - (payTarget - pay)
    const oneOff = use.filter((s) => s.kind === 'one_off' && (s.from_month ?? 1) === m).reduce((t, s) => t + s.value, 0)
    const inflow = collections + base.otherIncome + borrowed + (base.committedIn[m - 1] ?? 0) + Math.max(0, oneOff)
    const outflow = paidToSuppliers + payroll + finance + tax + capex + repaid + (base.committedOut[m - 1] ?? 0) + Math.max(0, -oneOff)
    const before = cash
    cash = cash + inflow - outflow
    recv = recvTarget; pay = payTarget
    debt = Math.max(0, debt + borrowed - repaid)

    months.push({
      month: m, label: monthLabel(base.asOf, m), revenue: r2(revenue), cogs: r2(cogs), grossProfit: r2(grossProfit), payroll: r2(payroll), opex: r2(opex), operatingProfit: r2(operatingProfit), depreciation: r2(depreciation),
      financeCost: r2(finance), tax: r2(tax), profit: r2(profit), collections: r2(collections), paidToSuppliers: r2(paidToSuppliers), capex: r2(capex), borrowed: r2(borrowed), repaid: r2(repaid), netCash: r2(inflow - outflow), cash: r2(cash),
      receivables: r2(recv), payables: r2(pay), debt: r2(debt), workingCapital: r2(recv + base.inventory - pay), coverage: outflow > 0 ? r2((Math.max(0, before) + inflow) / outflow) : null,
    })
  }

  const lowest = months.reduce((a, b) => (b.cash < a.cash ? b : a), months[0])
  const out = months.findIndex((x) => x.cash < 0)
  const cov = months.map((x) => x.coverage).filter((x): x is number => x !== null)
  return {
    label: SIMULATION, name, asOf: base.asOf, currency: base.currency, horizon: H, months, effects, assumptions, notes: [...new Set(notes)],
    totals: {
      revenue: r2(months.reduce((s, x) => s + x.revenue, 0)), profit: r2(months.reduce((s, x) => s + x.profit, 0)), operatingProfit: r2(months.reduce((s, x) => s + x.operatingProfit, 0)),
      closingCash: months[H - 1].cash, lowestCash: lowest.cash, lowestCashMonth: lowest.month, closingDebt: months[H - 1].debt, closingWorkingCapital: months[H - 1].workingCapital,
      borrowingRequirement: r2(Math.max(0, -lowest.cash)), lowestCoverage: cov.length ? Math.min(...cov) : null, monthsOfCashLeft: out === -1 ? null : out,
    },
  }
}

function describe(s: Shock, b: TwinBase, share: (t?: string, id?: ID, all?: boolean) => number): ShockEffect {
  const from = s.from_month && s.from_month > 1 ? ` from month ${s.from_month}` : ''
  const label = s.label ?? SHOCK_KINDS.find((k) => k.kind === s.kind)?.label ?? s.kind
  const money = (v: number) => r2(v).toLocaleString('en-IN')
  switch (s.kind) {
    case 'revenue_pct': return { kind: s.kind, label, text: `Revenue ${pct(s.value)}${from}: ${money(b.revenue)} a month becomes ${money(b.revenue * (1 + s.value / 100))}.`, formula: 'revenue × (1 + change ÷ 100)' }
    case 'margin_pts': return { kind: s.kind, label, text: `Gross margin moves by ${r2(s.value)} points${from}.`, formula: 'cost of sales = revenue × (cost ratio − points ÷ 100)' }
    case 'expense_pct': return { kind: s.kind, label, text: `Operating expenses ${pct(s.value)}${from}: ${money(b.opex)} a month becomes ${money(b.opex * (1 + s.value / 100))}.`, formula: 'expenses × (1 + change ÷ 100)' }
    case 'category_pct': {
      const c = b.categories.find((x) => x.key === s.target || x.label.toLowerCase() === (s.target ?? '').toLowerCase())
      return c ? { kind: s.kind, label, text: `${c.label} ${pct(s.value)}${from}: ${money(c.monthly)} a month becomes ${money(c.monthly * (1 + s.value / 100))}.`, formula: 'ledger × (1 + change ÷ 100)' }
        : { kind: s.kind, label, text: `No expense ledger named "${s.target ?? ''}" carries a balance in the months the model rests on. This assumption changed nothing.`, formula: '—' }
    }
    case 'payroll_pct': return { kind: s.kind, label, text: `Payroll ${pct(s.value)}${from}: ${money(b.payroll)} a month becomes ${money(b.payroll * (1 + s.value / 100))}.`, formula: 'payroll × (1 + change ÷ 100)' }
    case 'new_hires': { const each = s.extra ?? (b.headcount ? b.payroll / b.headcount : 0); return { kind: s.kind, label, text: `${s.value} people join${from} at ${money(each)} a month each: ${money(s.value * each)} a month more.`, formula: 'people × monthly cost of one' } }
    case 'collection_delay_days': { const sh = share(s.target, s.target_id); return { kind: s.kind, label, text: `${s.target ? (s.target === 'top3' ? 'The three largest customers' : s.target) : 'Customers'} pay ${Math.abs(s.value)} days ${s.value < 0 ? 'sooner' : 'later'}${from}. They are ${r2(sh * 100)}% of revenue, so money owed ${s.value < 0 ? 'falls' : 'rises'} by about ${money(Math.abs((b.revenue * 12 * s.value * sh) / 365))}.`, formula: 'receivables = revenue × (days outstanding + delay × share) ÷ 365' } }
    case 'payment_delay_days': return { kind: s.kind, label, text: `Suppliers are paid ${Math.abs(s.value)} days ${s.value < 0 ? 'sooner' : 'later'}${from}.`, formula: 'payables = purchases × (days payable + delay) ÷ 365' }
    case 'interest_rate_pts': return { kind: s.kind, label, text: `Interest rates move by ${r2(s.value)} points${from}: about ${money((b.debt * s.value) / 100 / 12)} a month on borrowings of ${money(b.debt)}.`, formula: 'interest = borrowings × (rate + points) ÷ 12' }
    case 'fx_pct': return { kind: s.kind, label, text: `Imported cost ${pct(s.value)}${from}, on ${r2(s.extra ?? 100)}% of the cost of sales.`, formula: 'cost of sales × imported share × change' }
    case 'capex': return { kind: s.kind, label, text: `${money(s.value)} is spent on an asset in month ${s.from_month ?? 1}, depreciated over ${s.extra ?? 60} months.`, formula: 'cash − cost; depreciation + cost ÷ life' }
    case 'new_borrowing': return { kind: s.kind, label, text: `${money(s.value)} is borrowed in month ${s.from_month ?? 1}${s.extra !== undefined ? ` at ${s.extra}% a year` : ''}, repaid over ${s.months ?? 60} months.`, formula: 'cash + loan; interest = outstanding × rate ÷ 12' }
    case 'lose_customer': { const sh = share(s.target, s.target_id, false); return { kind: s.kind, label, text: `${s.target === 'top3' ? 'The three largest customers stop' : (s.target ?? 'A customer') + ' stops'} ${r2(Math.min(s.value, 100))}% of their buying${from}: ${money(b.revenue * sh * Math.min(s.value, 100) / 100)} a month less.`, formula: 'revenue − revenue of the customer × share lost' } }
    case 'new_project': return { kind: s.kind, label, text: `A project brings ${money(s.value)} over ${s.months ?? 12} months${from}${s.extra !== undefined ? ` at a margin of ${s.extra}%` : ' at the margin the books show'}.`, formula: 'revenue + value ÷ months; cost = that × (1 − margin)' }
    case 'project_overrun_pct': return { kind: s.kind, label, text: `The cost of what is sold overruns by ${r2(s.value)}%${from}.`, formula: 'cost of sales × (1 + overrun ÷ 100)' }
    default: return { kind: s.kind, label, text: `${s.value >= 0 ? 'A receipt' : 'A payment'} of ${money(Math.abs(s.value))} in month ${s.from_month ?? 1}.`, formula: 'cash ± amount' }
  }
}

// ------------------------------------------------------------------ comparison
export interface ComparisonRow { key: string; label: string; values: number[]; changes: (number | null)[]; better: 'higher' | 'lower' }
/** Base case and scenarios side by side: revenue, profit, cash, debt, working capital. The first result is the base. */
export function compare(results: TwinResult[]): ComparisonRow[] {
  const row = (key: string, label: string, f: (r: TwinResult) => number, better: 'higher' | 'lower' = 'higher'): ComparisonRow => {
    const values = results.map(f)
    return { key, label, values, changes: values.map((v, i) => (i === 0 ? null : r2(v - values[0]))), better }
  }
  return [
    row('revenue', 'Revenue over the period', (r) => r.totals.revenue),
    row('operatingProfit', 'Operating profit over the period', (r) => r.totals.operatingProfit),
    row('profit', 'Profit after tax over the period', (r) => r.totals.profit),
    row('closingCash', 'Cash at the end', (r) => r.totals.closingCash),
    row('lowestCash', 'Lowest cash on the way', (r) => r.totals.lowestCash),
    row('borrowingRequirement', 'Borrowing needed to stay above zero', (r) => r.totals.borrowingRequirement, 'lower'),
    row('closingDebt', 'Borrowings at the end', (r) => r.totals.closingDebt, 'lower'),
    row('closingWorkingCapital', 'Working capital at the end', (r) => r.totals.closingWorkingCapital),
  ]
}

/** The three standard cases built from one set of assumptions: as typed, each softened by half, each hardened by half. */
export function standardCases(shocks: Shock[]): { kind: 'optimistic' | 'conservative'; shocks: Shock[] }[] {
  // what helps when it rises: revenue, margin, a receipt, and the days suppliers wait; everything else hurts when it rises
  const bad = (s: Shock) => ['revenue_pct', 'margin_pts', 'one_off', 'payment_delay_days'].includes(s.kind) ? s.value < 0 : s.value > 0 && !['new_project'].includes(s.kind)
  const scale = (f: (s: Shock) => number) => shocks.map((s) => (['capex', 'new_borrowing', 'new_hires', 'one_off', 'new_project'].includes(s.kind) ? s : { ...s, value: r2(s.value * f(s)) }))
  return [
    { kind: 'optimistic', shocks: scale((s) => (bad(s) ? 0.5 : 1.5)) },
    { kind: 'conservative', shocks: scale((s) => (bad(s) ? 1.5 : 0.5)) },
  ]
}

// ------------------------------------------------------------------ valuation lab
export interface DcfInput { cashFlows: number[]; discountPct: number; terminalGrowthPct: number; debt: number; cash: number }
export interface DcfResult {
  label: 'ESTIMATE'
  presentValues: number[]
  terminalValue: number
  terminalPresent: number
  enterpriseValue: number
  equityValue: number
  sensitivity: { discountPct: number; growthPct: number; equityValue: number }[]
  assumptions: string[]
  refused?: string
}
/** Discounted cash flow. Every assumption is an input and is stated back. */
export function dcf(i: DcfInput): DcfResult {
  const run = (rate: number, g: number) => {
    const pv = i.cashFlows.map((c, n) => c / Math.pow(1 + rate / 100, n + 1))
    const last = i.cashFlows[i.cashFlows.length - 1] ?? 0
    const tv = rate > g ? (last * (1 + g / 100)) / ((rate - g) / 100) : NaN
    const tp = tv / Math.pow(1 + rate / 100, i.cashFlows.length)
    const ev = pv.reduce((s, x) => s + x, 0) + tp
    return { pv, tv, tp, ev, eq: ev - i.debt + i.cash }
  }
  const assumptions = [
    `Cash flows of ${i.cashFlows.length} year(s) are discounted at ${i.discountPct}% a year.`,
    `After the last year the cash flow is taken to grow at ${i.terminalGrowthPct}% a year for ever (terminal value = last cash flow × (1 + growth) ÷ (discount − growth)).`,
    `Equity value = enterprise value − borrowings of ${r2(i.debt).toLocaleString('en-IN')} + cash of ${r2(i.cash).toLocaleString('en-IN')}.`,
    'This is an estimate from the assumptions stated. It is not a valuation opinion and is not used in the books.',
  ]
  if (!i.cashFlows.length) return { label: 'ESTIMATE', presentValues: [], terminalValue: 0, terminalPresent: 0, enterpriseValue: 0, equityValue: 0, sensitivity: [], assumptions, refused: 'There are no cash flows to discount.' }
  if (i.discountPct <= i.terminalGrowthPct) return { label: 'ESTIMATE', presentValues: [], terminalValue: 0, terminalPresent: 0, enterpriseValue: 0, equityValue: 0, sensitivity: [], assumptions, refused: 'The discount rate must be higher than the growth assumed for ever; otherwise the value has no limit.' }
  const b = run(i.discountPct, i.terminalGrowthPct)
  const sensitivity = [-2, 0, 2].flatMap((d) => [-1, 0, 1].map((g) => ({ discountPct: i.discountPct + d, growthPct: i.terminalGrowthPct + g })))
    .filter((x) => x.discountPct > x.growthPct && x.discountPct > 0).map((x) => ({ ...x, equityValue: r2(run(x.discountPct, x.growthPct).eq) }))
  return { label: 'ESTIMATE', presentValues: b.pv.map(r2), terminalValue: r2(b.tv), terminalPresent: r2(b.tp), enterpriseValue: r2(b.ev), equityValue: r2(b.eq), sensitivity, assumptions }
}
/** Free cash flow of each year of a simulation: operating profit − tax − assets bought − increase in working capital. */
export function freeCashFlows(r: TwinResult, openingWorkingCapital: number): number[] {
  const years: number[] = []
  let wc = openingWorkingCapital
  for (let y = 0; y * 12 < r.months.length; y++) {
    const ms = r.months.slice(y * 12, y * 12 + 12)
    if (ms.length < 12) break      // a part of a year is not a year: it is left out rather than scaled up
    const end = ms[ms.length - 1].workingCapital
    years.push(r2(ms.reduce((s, m) => s + m.operatingProfit - m.tax - m.capex, 0) - (end - wc)))
    wc = end
  }
  return years
}
export interface MultipleInput { metric: string; value: number; multiple: number; source: string }
/** Value by comparison: a figure of the company times a multiple a person has taken from somewhere, and says where. */
export function byMultiples(inputs: MultipleInput[], debt: number, cash: number) {
  return inputs.map((m) => ({
    ...m, label: 'ESTIMATE' as const, enterpriseValue: r2(m.value * m.multiple), equityValue: r2(m.value * m.multiple - debt + cash),
    refused: !m.source?.trim() ? 'A multiple without its source is a guess. Say where it comes from.' : m.value <= 0 ? `A multiple of ${m.metric} means nothing while ${m.metric} is zero or negative.` : undefined,
  }))
}
/** Value by assets: what the books carry, adjusted by what a person states and explains. */
export function byAssets(totalAssets: number, totalLiabilities: number, adjustments: { label: string; amount: number; basis: string }[]) {
  const adj = adjustments.filter((a) => a.basis?.trim())
  return {
    label: 'ESTIMATE' as const, bookNetAssets: r2(totalAssets - totalLiabilities), adjustments: adj, adjusted: r2(totalAssets - totalLiabilities + adj.reduce((s, a) => s + a.amount, 0)),
    leftOut: adjustments.filter((a) => !a.basis?.trim()).map((a) => `"${a.label}" was left out: an adjustment without its basis is not counted.`),
  }
}
