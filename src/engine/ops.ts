import Decimal from 'decimal.js'
import { D, ZERO, fmtMoney, round2, sum } from '@/lib/money'
import { addMonths, daysBetween, endOfMonth, fmtDate, startOfMonth } from '@/lib/dates'
import type { Account, ID, Invoice, LedgerBalanceRow, LedgerLine, Num, Party } from './types'
import type {
  Advance, AssetCategory, Employee, ExpenseClaim, FixedAsset, Loan, LoanInstalment, PayrollLine, PayrollRun, PurchaseDoc, PurchaseLine, SalaryComponent,
} from './opsTypes'

// =====================================================================
// Pure calculations for the operations that surround the ledger.
// Shared by the live and the demo data layers: the same figures, the
// same wording, whichever source the records come from.
// =====================================================================

/** figures and dates inside sentences read the way they do everywhere else on screen */
const amt = (v: Decimal.Value) => fmtMoney(v, { bare: true })

// ------------------------------------------------------------------ advances
export const ADVANCE_BUCKETS = [
  { key: 'b7', label: '0–7 days', from: 0, to: 7 }, { key: 'b15', label: '8–15 days', from: 8, to: 15 }, { key: 'b30', label: '16–30 days', from: 16, to: 30 },
  { key: 'b60', label: '31–60 days', from: 31, to: 60 }, { key: 'b90', label: '61–90 days', from: 61, to: 90 }, { key: 'b90p', label: 'Over 90 days', from: 91, to: 100000 },
]
export const advanceOutstanding = (a: Pick<Advance, 'released_amount' | 'settled_amount' | 'returned_amount'>) => D(a.released_amount).minus(a.settled_amount).minus(a.returned_amount)
export const advanceAge = (a: Pick<Advance, 'released_on' | 'created_at'>, asOf: string) => Math.max(0, daysBetween(a.released_on ?? a.created_at.slice(0, 10), asOf))
export const isOverdue = (a: Advance, asOf: string) => advanceOutstanding(a).gt(0) && !!a.expected_settlement_date && a.expected_settlement_date < asOf

/** Unsettled advances by age (spec 1564). */
export function advanceAgeing(advances: Advance[], asOf: string) {
  const open = advances.filter((a) => advanceOutstanding(a).gt(0))
  const buckets = ADVANCE_BUCKETS.map((b) => {
    const rows = open.filter((a) => { const n = advanceAge(a, asOf); return n >= b.from && n <= b.to })
    return { ...b, count: rows.length, amount: sum(rows.map((a) => advanceOutstanding(a))) }
  })
  return { buckets, total: sum(open.map((a) => advanceOutstanding(a))), count: open.length, overdue: open.filter((a) => isOverdue(a, asOf)) }
}

export interface MemoryFact { kind: string; text: string; advance_id?: ID; amount?: Decimal }
/**
 * NUMI advance memory (spec 1562-1563): what is already on record about a person
 * before another advance is approved or released. Facts only — never an accusation.
 */
export function advanceMemory(advances: Advance[], claims: ExpenseClaim[], partyId: ID, asOf: string, excludeId?: ID): MemoryFact[] {
  const mine = advances.filter((a) => a.recipient_party_id === partyId && a.id !== excludeId && !['draft', 'rejected', 'cancelled'].includes(a.status)).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const facts: MemoryFact[] = []
  const open = mine.filter((a) => advanceOutstanding(a).gt(0))
  for (const a of open) {
    const evidence = claims.some((c) => c.advance_id === a.id && !['draft', 'rejected', 'cancelled'].includes(c.status))
    facts.push({
      kind: 'open_advance', advance_id: a.id, amount: advanceOutstanding(a),
      text: `An earlier advance ${a.advance_no} of ${amt(a.released_amount)} released on ${a.released_on ? fmtDate(a.released_on) : 'an unrecorded date'} has ${amt(advanceOutstanding(a))} unsettled. ${evidence ? 'A settlement claim has been submitted.' : 'No supporting claim or receipt has been attached.'}`,
    })
  }
  if (open.length >= 2) facts.push({ kind: 'multiple_open', text: `${open.length} advances to this person are open at the same time, totalling ${amt(sum(open.map((a) => advanceOutstanding(a))))}.` })
  const late = mine.filter((a) => a.expected_settlement_date && ((advanceOutstanding(a).gt(0) && a.expected_settlement_date < asOf)))
  if (late.length) facts.push({ kind: 'late_settlement', text: `${late.length} advance(s) are past their expected settlement date.` })
  const recent = mine.filter((a) => daysBetween(a.created_at.slice(0, 10), asOf) <= 90)
  if (recent.length >= 3) facts.push({ kind: 'frequent', text: `${recent.length} advances were requested by or for this person in the last 90 days.` })
  const lastThree = mine.slice(-3).map((a) => D(a.requested_amount))
  if (lastThree.length === 3 && lastThree[0].lt(lastThree[1]) && lastThree[1].lt(lastThree[2])) facts.push({ kind: 'increasing', text: `The last three advances increased in amount: ${lastThree.map((v) => amt(v)).join(' → ')}.` })
  if (!facts.length && mine.length) facts.push({ kind: 'clean', text: `${mine.length} earlier advance(s) on record, all settled or returned.` })
  if (!mine.length) facts.push({ kind: 'none', text: 'No earlier advance is recorded for this person in the selected companies.' })
  return facts
}

// ------------------------------------------------------------------ fixed assets
export const bookValue = (a: Pick<FixedAsset, 'cost' | 'accumulated_depreciation'>) => D(a.cost).minus(a.accumulated_depreciation)

/** Depreciation an asset would carry in each coming month under its recorded method. FORECAST. */
export function depreciationForecast(asset: FixedAsset, fromMonth: string, months: number) {
  const out: { month: string; amount: Decimal; closing: Decimal }[] = []
  if (asset.status !== 'active' || asset.method === 'none') return out
  let acc = D(asset.accumulated_depreciation)
  for (let i = 0; i < months; i++) {
    const month = addMonths(startOfMonth(fromMonth), i)
    const end = endOfMonth(month)
    const inService = asset.in_service_date ?? asset.acquisition_date
    const left = D(asset.cost).minus(asset.salvage_value).minus(acc)
    if (inService > end || left.lte(0)) { out.push({ month, amount: ZERO, closing: D(asset.cost).minus(acc) }); continue }
    const dim = daysBetween(month, end) + 1
    const factor = inService > month ? D(daysBetween(inService, end) + 1).div(dim) : D(1)
    const raw = asset.method === 'slm' ? D(asset.cost).minus(asset.salvage_value).div(asset.life_months || 1).times(factor) : D(asset.cost).minus(acc).times(D(asset.wdv_rate)).div(1200).times(factor)
    const amount = round2(Decimal.min(raw, left))
    acc = acc.plus(amount)
    out.push({ month, amount, closing: D(asset.cost).minus(acc) })
  }
  return out
}

/** Asset register against the general ledger, ledger by ledger. A difference is shown, never hidden. */
export function assetReconciliation(assets: FixedAsset[], categories: AssetCategory[], balances: LedgerBalanceRow[], accounts: Account[]) {
  const cat = new Map(categories.map((c) => [c.id, c]))
  const acct = new Map(accounts.map((a) => [a.id, a]))
  const reg = new Map<ID, { cost: Decimal; accumulated: Decimal; count: number }>()
  const bump = (id: ID, cost: Decimal, accumulated: Decimal, n: number) => { const c = reg.get(id) ?? { cost: ZERO, accumulated: ZERO, count: 0 }; reg.set(id, { cost: c.cost.plus(cost), accumulated: c.accumulated.plus(accumulated), count: c.count + n }) }
  for (const a of assets) {
    if (a.status !== 'active') continue
    const c = cat.get(a.category_id)
    if (!c) continue
    bump(c.asset_account_id, D(a.cost), ZERO, 1)
    bump(c.accum_account_id, ZERO, D(a.accumulated_depreciation), 0)
  }
  const ledger = new Map<ID, Decimal>()
  for (const b of balances) ledger.set(b.account_id, (ledger.get(b.account_id) ?? ZERO).plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit))
  const ids = new Set<ID>([...reg.keys()])
  for (const a of accounts) if ((a.subtype === 'fixed_asset' || a.subtype === 'accumulated_depreciation') && !a.is_group && ledger.has(a.id)) ids.add(a.id)
  return [...ids].map((id) => {
    const a = acct.get(id)
    const r = reg.get(id) ?? { cost: ZERO, accumulated: ZERO, count: 0 }
    const isAccum = a?.subtype === 'accumulated_depreciation'
    const register = isAccum ? r.accumulated : r.cost
    const books = isAccum ? (ledger.get(id) ?? ZERO).neg() : ledger.get(id) ?? ZERO
    return { account_id: id, code: a?.code ?? '', name: a?.name ?? 'Unknown ledger', company_id: a?.company_id ?? '', kind: isAccum ? 'accumulated' as const : 'cost' as const, register, ledger: books, difference: register.minus(books), assets: r.count }
  }).sort((x, y) => x.code.localeCompare(y.code))
}

// ------------------------------------------------------------------ purchase-to-pay
export type MatchStatus = 'MATCHED' | 'NOT BILLED' | 'PART BILLED' | 'QUANTITY DIFFERENCE' | 'PRICE DIFFERENCE' | 'BILLED BEFORE RECEIPT' | 'NOT RECEIVED'
export interface MatchLine {
  po_line_id: ID
  description: string
  ordered_qty: Decimal; ordered_rate: Decimal; ordered_amount: Decimal
  received_qty: Decimal
  billed_qty: Decimal; billed_amount: Decimal; billed_rate: Decimal | null
  quantity_difference: Decimal
  price_difference: Decimal
  status: MatchStatus
  notes: string[]
}
export interface MatchResult {
  lines: MatchLine[]
  unexpected: { invoice_id: ID; doc_no: string | null; description: string; amount: Decimal }[]
  ordered: Decimal; received: Decimal; billed: Decimal
  ordered_tax: Decimal; billed_tax: Decimal; tax_difference: Decimal
  status: 'MATCHED' | 'DIFFERENCES FOUND' | 'INCOMPLETE'
  summary: string
}

/**
 * Three-way match (spec 529): purchase order against receipts against bills.
 * A factual comparison. It identifies differences; people decide what they mean.
 */
export function threeWayMatch(po: PurchaseDoc, receipts: PurchaseDoc[], bills: Invoice[], tolerance: Num = 1): MatchResult {
  const tol = D(tolerance)
  const live = bills.filter((b) => !['draft', 'cancelled'].includes(b.status))
  const confirmed = receipts.filter((r) => r.status === 'confirmed')
  const lines: MatchLine[] = (po.lines ?? []).map((l: PurchaseLine) => {
    const received = sum(confirmed.flatMap((r) => r.lines ?? []).filter((x) => x.source_line_id === l.id).map((x) => x.quantity))
    const bl = live.flatMap((b) => b.lines ?? []).filter((x) => x.po_line_id === l.id)
    const billedQty = sum(bl.map((x) => x.quantity ?? 1))
    const billedAmt = sum(bl.map((x) => x.amount))
    const billedRate = billedQty.isZero() ? null : billedAmt.div(billedQty)
    const qtyDiff = billedQty.minus(received)
    const priceDiff = billedRate ? round2(billedRate.minus(l.rate).times(billedQty)) : ZERO
    const notes: string[] = []
    let status: MatchStatus = 'MATCHED'
    if (billedQty.isZero()) { status = received.isZero() ? 'NOT RECEIVED' : 'NOT BILLED'; notes.push(received.isZero() ? 'Nothing has been received or billed against this line.' : `Received ${received}; no bill yet.`) }
    else {
      if (billedQty.gt(D(l.quantity))) { status = 'QUANTITY DIFFERENCE'; notes.push(`Billed quantity ${billedQty} is more than the ordered ${D(l.quantity)}.`) }
      if (qtyDiff.gt(0)) { status = 'BILLED BEFORE RECEIPT'; notes.push(`Billed ${billedQty} but only ${received} confirmed as received.`) }
      if (priceDiff.abs().gt(tol)) { status = status === 'MATCHED' ? 'PRICE DIFFERENCE' : status; notes.push(`Billed at ${round2(billedRate!)} against the ordered rate of ${D(l.rate)} (difference ${priceDiff}).`) }
      if (status === 'MATCHED' && billedQty.lt(D(l.quantity))) { status = 'PART BILLED'; notes.push(`${D(l.quantity).minus(billedQty)} of ${D(l.quantity)} still to be billed.`) }
    }
    return { po_line_id: l.id, description: l.description, ordered_qty: D(l.quantity), ordered_rate: D(l.rate), ordered_amount: D(l.amount), received_qty: received, billed_qty: billedQty, billed_amount: billedAmt, billed_rate: billedRate, quantity_difference: qtyDiff, price_difference: priceDiff, status, notes }
  })
  const unexpected = live.flatMap((b) => (b.lines ?? []).filter((x) => !x.po_line_id).map((x) => ({ invoice_id: b.id, doc_no: b.doc_no, description: x.description ?? '', amount: D(x.amount) })))
  const billedTax = sum(live.map((b) => b.tax_total))
  const billed = sum(live.map((b) => b.subtotal))
  const taxExpected = D(po.subtotal).isZero() ? ZERO : round2(D(po.tax_total).times(billed).div(po.subtotal))
  const differences = lines.filter((l) => ['QUANTITY DIFFERENCE', 'PRICE DIFFERENCE', 'BILLED BEFORE RECEIPT'].includes(l.status)).length + unexpected.length + (billedTax.minus(taxExpected).abs().gt(tol) && !billed.isZero() ? 1 : 0)
  const incomplete = lines.some((l) => ['NOT BILLED', 'PART BILLED', 'NOT RECEIVED'].includes(l.status))
  return {
    lines, unexpected, ordered: D(po.subtotal), billed, received: sum(lines.map((l) => l.received_qty.times(l.ordered_rate))), ordered_tax: D(po.tax_total), billed_tax: billedTax, tax_difference: billed.isZero() ? ZERO : billedTax.minus(taxExpected),
    status: differences ? 'DIFFERENCES FOUND' : incomplete ? 'INCOMPLETE' : 'MATCHED',
    summary: differences ? `${differences} difference(s) need a person's review.` : incomplete ? 'No differences so far; the order is not yet fully received and billed.' : 'Order, receipts and bills agree within the tolerance.',
  }
}

/** Side-by-side comparison of vendor quotations (spec 525). It marks the lowest figure; it does not choose. */
export function compareQuotations(quotes: PurchaseDoc[]) {
  const live = quotes.filter((q) => q.kind === 'quotation' && !['draft', 'cancelled'].includes(q.status))
  const base = (q: PurchaseDoc) => D(q.total).times(q.fx_rate)
  const lowest = live.length ? Decimal.min(...live.map(base)) : ZERO
  const descriptions = [...new Set(live.flatMap((q) => (q.lines ?? []).map((l) => l.description.trim().toLowerCase())))]
  return {
    quotes: live.map((q) => ({ quote: q, total: base(q), isLowest: base(q).eq(lowest), aboveLowest: base(q).minus(lowest), expired: !!q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10) })),
    items: descriptions.map((d) => {
      const cells = live.map((q) => { const l = (q.lines ?? []).find((x) => x.description.trim().toLowerCase() === d); return { quote_id: q.id, rate: l ? D(l.rate) : null, quantity: l ? D(l.quantity) : null, amount: l ? D(l.amount) : null } })
      const rates = cells.filter((c) => c.rate).map((c) => c.rate!)
      return { description: d, cells, lowestRate: rates.length ? Decimal.min(...rates) : null }
    }),
    note: 'The lowest price is marked for information. Delivery, warranty, payment terms and vendor history are part of the decision, which is made by a person and recorded with a reason.',
  }
}

// ------------------------------------------------------------------ loans
/** what is still to be recorded on an instalment: a recovery through payroll has already taken part of the principal */
export const principalDue = (s: Pick<LoanInstalment, 'principal' | 'recovered'>) => Decimal.max(D(s.principal).minus(D(s.recovered ?? 0)), 0)
export const instalmentDue = (s: Pick<LoanInstalment, 'principal' | 'recovered' | 'interest'>) => principalDue(s).plus(s.interest)

export function loanPosition(loan: Loan, schedule: LoanInstalment[], asOf: string) {
  const rows = schedule.filter((s) => s.loan_id === loan.id).sort((a, b) => a.instalment_no - b.instalment_no)
  const unpaid = rows.filter((s) => s.status !== 'paid')
  const outstanding = D(loan.disbursed_amount).minus(loan.principal_repaid)
  const next = unpaid[0] ?? null
  const overdue = unpaid.filter((s) => s.due_date < asOf)
  const within = (days: number) => sum(unpaid.filter((s) => daysBetween(asOf, s.due_date) <= days).map((s) => instalmentDue(s)))
  return {
    outstanding, next, overdue, overdueAmount: sum(overdue.map((s) => instalmentDue(s))), interestRemaining: sum(unpaid.map((s) => s.interest)), maturity: rows.length ? rows[rows.length - 1].due_date : null,
    dueIn30: within(30), dueIn90: within(90), dueIn365: within(365), paidInstalments: rows.length - unpaid.length, totalInstalments: rows.length,
    balloon: rows.length > 1 && D(rows[rows.length - 1].principal).gt(D(rows[0].principal).times(3)) ? D(rows[rows.length - 1].principal) : null,
  }
}
/** Debt maturity ladder (spec 1253): principal falling due by year. */
export function debtLadder(loans: Loan[], schedule: LoanInstalment[], asOf: string) {
  const active = new Set(loans.filter((l) => l.status === 'active' && l.direction === 'borrowed').map((l) => l.id))
  const bands = [{ label: 'Overdue', from: -100000, to: -1 }, { label: 'Within 1 year', from: 0, to: 365 }, { label: '1–2 years', from: 366, to: 730 }, { label: '2–3 years', from: 731, to: 1095 }, { label: '3–5 years', from: 1096, to: 1826 }, { label: 'Beyond 5 years', from: 1827, to: 1000000 }]
  return bands.map((b) => {
    const rows = schedule.filter((s) => active.has(s.loan_id) && s.status !== 'paid' && daysBetween(asOf, s.due_date) >= b.from && daysBetween(asOf, s.due_date) <= b.to)
    return { label: b.label, principal: sum(rows.map((s) => principalDue(s))), interest: sum(rows.map((s) => s.interest)), instalments: rows.length }
  })
}

// ------------------------------------------------------------------ people cost
const VARIABLE = ['bonus', 'incentive', 'commission', 'overtime', 'arrears']
export interface PersonCost {
  employee_id: ID; party_id: ID; emp_no: string; name: string; department_id: ID | null; employment_type: string
  salary: Decimal; variable: Decimal; employer: Decimal; direct: Decimal; total: Decimal
  directBreakdown: { account: string; amount: Decimal }[]
}
/**
 * True cost of people (spec 1197-1226): salary is not the whole cost.
 * Salary, variable pay and employer cost come from posted payroll; directly attributable
 * spending (travel, equipment, software …) comes from expense lines tagged with the person.
 * Shared costs such as rent are NOT allocated unless an allocation method has been approved.
 */
export function peopleCost(runs: PayrollRun[], lines: PayrollLine[], employees: Employee[], parties: Party[], expenseLines: LedgerLine[] = []) {
  const counted = new Set(runs.filter((r) => ['posted', 'paid'].includes(r.status)).map((r) => r.id))
  const party = new Map(parties.map((p) => [p.id, p]))
  const rows = new Map<ID, PersonCost>()
  const depts = new Map<string, { department_id: ID | null; people: Set<ID>; total: Decimal; salary: Decimal }>()
  const deptOf = (id: ID | null) => { const k = id ?? ''; let d = depts.get(k); if (!d) { d = { department_id: id, people: new Set<ID>(), total: ZERO, salary: ZERO }; depts.set(k, d) } return d }
  for (const e of employees) rows.set(e.id, { employee_id: e.id, party_id: e.party_id, emp_no: e.emp_no, name: party.get(e.party_id)?.display_name ?? e.emp_no, department_id: e.department_id, employment_type: e.employment_type, salary: ZERO, variable: ZERO, employer: ZERO, direct: ZERO, total: ZERO, directBreakdown: [] })
  for (const l of lines) {
    if (!counted.has(l.run_id)) continue
    const r = rows.get(l.employee_id)
    if (!r) continue
    // the department is the one recorded on the payroll line: a later transfer does not move earlier months
    const dept = deptOf(l.department_id ?? r.department_id)
    dept.people.add(l.employee_id)
    for (const c of l.components as SalaryComponent[]) {
      if (c.kind === 'earning' || c.kind === 'employer') dept.total = dept.total.plus(c.amount)
      if (c.kind === 'earning' && !VARIABLE.includes(c.type ?? '')) dept.salary = dept.salary.plus(c.amount)
      if (c.kind === 'earning') { if (VARIABLE.includes(c.type ?? '')) r.variable = r.variable.plus(c.amount); else r.salary = r.salary.plus(c.amount) }
      else if (c.kind === 'employer') r.employer = r.employer.plus(c.amount)
    }
  }
  const byParty = new Map([...rows.values()].map((r) => [r.party_id, r]))
  for (const l of expenseLines) {
    if (!l.party_id || l.account_type !== 'expense' || l.source === 'payroll') continue
    const r = byParty.get(l.party_id)
    if (!r) continue
    const amt = D(l.debit).minus(l.credit)
    r.direct = r.direct.plus(amt)
    // a direct cost carries no department of its own here: it follows the person's present department
    const dept = deptOf(r.department_id); dept.total = dept.total.plus(amt); dept.people.add(r.employee_id)
    const b = r.directBreakdown.find((x) => x.account === l.account_name)
    if (b) b.amount = b.amount.plus(amt); else r.directBreakdown.push({ account: l.account_name, amount: amt })
  }
  const people = [...rows.values()].map((r) => ({ ...r, total: r.salary.plus(r.variable).plus(r.employer).plus(r.direct) }))
  const tot = (f: (r: PersonCost) => Decimal) => sum(people.map(f))
  const byDepartment = [...depts.values()].map((d) => ({ department_id: d.department_id, headcount: d.people.size, total: d.total, salary: d.salary }))
  return {
    people, byDepartment: byDepartment.sort((a, b) => b.total.cmp(a.total)),
    totals: { salary: tot((r) => r.salary), variable: tot((r) => r.variable), employer: tot((r) => r.employer), direct: tot((r) => r.direct), total: tot((r) => r.total), headcount: people.filter((r) => r.total.gt(0)).length },
    notes: [
      'Salary, variable pay and employer cost are taken from payroll runs that have been posted.',
      'Direct costs are expense lines recorded against the person (for example approved travel claims).',
      'Shared costs such as rent, electricity and internet are not allocated to people: no allocation method has been approved.',
      'These figures describe cost. They are not a measure of any person\'s performance.',
    ],
  }
}

/** Spending on people who are not employees (spec 1224-1226), from posted expense lines by party type. */
export function workforceOutside(expenseLines: LedgerLine[], parties: Party[], companyIds: ID[]) {
  const types = ['consultant', 'freelancer', 'contractor', 'subcontractor', 'agent']
  const kind = new Map<ID, string>()
  for (const p of parties) { const r = p.roles.find((x) => companyIds.includes(x.company_id) && types.includes(x.type_key)); if (r) kind.set(p.id, r.type_key) }
  const by = new Map<string, { type: string; amount: Decimal; parties: Set<ID> }>()
  for (const l of expenseLines) {
    if (!l.party_id || l.account_type !== 'expense' || !kind.has(l.party_id)) continue
    const t = kind.get(l.party_id)!
    const c = by.get(t) ?? { type: t, amount: ZERO, parties: new Set<ID>() }
    c.amount = c.amount.plus(l.debit).minus(l.credit); c.parties.add(l.party_id)
    by.set(t, c)
  }
  return [...by.values()].map((c) => ({ type: c.type, amount: c.amount, people: c.parties.size })).sort((a, b) => b.amount.cmp(a.amount))
}

/** First-year cost of a planned hire (spec 1222). An ESTIMATE built from the figures entered. */
export function newHireCost(i: { monthlySalary: Num; employerPct?: Num; recruitmentFee?: Num; equipment?: Num; softwareMonthly?: Num; training?: Num; benefitsMonthly?: Num; travel?: Num; count?: number }) {
  const n = i.count ?? 1
  const salary = D(i.monthlySalary).times(12)
  const employer = salary.times(D(i.employerPct ?? 0)).div(100)
  const recurring = D(i.softwareMonthly ?? 0).plus(i.benefitsMonthly ?? 0).times(12)
  const oneTime = D(i.recruitmentFee ?? 0).plus(i.equipment ?? 0).plus(i.training ?? 0).plus(i.travel ?? 0)
  const each = salary.plus(employer).plus(recurring).plus(oneTime)
  return { salary: salary.times(n), employer: employer.times(n), recurring: recurring.times(n), oneTime: oneTime.times(n), perPerson: each, total: each.times(n), monthlyRunRate: round2(salary.plus(employer).plus(recurring).div(12).times(n)) }
}
