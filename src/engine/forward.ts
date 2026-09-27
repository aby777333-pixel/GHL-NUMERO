import Decimal from 'decimal.js'
import { D, fmtMoney, round2, sum, ZERO } from '@/lib/money'
import { addDays, addMonths, daysBetween, endOfMonth, fmtDate, startOfMonth } from '@/lib/dates'
import type { ID, Invoice, Payment } from './types'
import type {
  Advance, DocumentRecord, ExpenseClaim, FixedDeposit, Frequency, Loan, LoanInstalment, PayrollRun, PurchaseDoc, RegisterItem, RegisterKind, CollectionPromise,
} from './opsTypes'

/** figures and dates inside sentences read the way they do everywhere else on screen */
const amt = (v: Decimal.Value) => fmtMoney(v, { bare: true })
const day = (d: string | null | undefined) => (d ? fmtDate(d) : 'an unrecorded date')

// =====================================================================
// NUMERO FORWARD (spec 663-723)
// Traditional accounting asks what happened. Forward asks what has been
// agreed, what is committed, what is due and what could go wrong.
//
// Everything here is a pure function of recorded data. Nothing is
// invented: every event names the record it comes from, how certain it
// is, and how its date and amount were arrived at. An estimate is always
// labelled as an estimate and never replaces the contractual date.
// =====================================================================

/** How firmly an amount is known (spec 666). Ordered from firmest to softest. */
export type ForwardCertainty = 'DUE' | 'CONTRACTED' | 'COMMITTED' | 'SCHEDULED' | 'EXPECTED' | 'PROBABLE' | 'POSSIBLE' | 'CONTINGENT' | 'FORECAST'
export const CERTAINTY_ORDER: ForwardCertainty[] = ['DUE', 'CONTRACTED', 'COMMITTED', 'SCHEDULED', 'EXPECTED', 'PROBABLE', 'POSSIBLE', 'CONTINGENT', 'FORECAST']
export const FIRM: ForwardCertainty[] = ['DUE', 'CONTRACTED', 'COMMITTED', 'SCHEDULED']
export const CERTAINTY_MEANING: Record<ForwardCertainty, string> = {
  DUE: 'Already recorded in the books as receivable or payable.',
  CONTRACTED: 'Legally or commercially committed under a recorded contract.',
  COMMITTED: 'An approved obligation, such as a purchase order. Not yet a cost.',
  SCHEDULED: 'A known recurring payment.',
  EXPECTED: 'Reasonably expected from recorded information.',
  PROBABLE: 'More likely than not, according to the person who recorded it.',
  POSSIBLE: 'May happen. Not counted as firm.',
  CONTINGENT: 'Depends on an uncertain event. Shown separately; not part of projected cash.',
  FORECAST: 'A projection from past figures. Labelled as a forecast wherever shown.',
}

export type ForwardSource = 'invoice' | 'bill' | 'purchase_order' | 'register' | 'loan' | 'deposit' | 'payroll' | 'claim' | 'advance' | 'document'

export interface ForwardEvent {
  id: string
  company_id: ID
  /** contractual or scheduled date */
  date: string
  /** estimated date, only when it differs and only ever labelled as an estimate */
  expected_date?: string
  expected_basis?: string
  direction: 'in' | 'out'
  /** amount in the company's base currency */
  amount: Decimal
  certainty: ForwardCertainty
  category: string
  source: ForwardSource
  label: string
  party_id?: ID | null
  link?: string
  /** how the date and amount were arrived at */
  basis: string
  /** currency of the source record, where that record carries no exchange rate (registers, loans, deposits, claims, advances). The amount is NOT converted. */
  currency?: string
  overdue?: boolean
}

export interface ForwardInput {
  asOf: string
  until: string
  invoices?: Invoice[]
  payments?: Payment[]
  promises?: CollectionPromise[]
  purchaseDocs?: PurchaseDoc[]
  registerItems?: RegisterItem[]
  registerKinds?: RegisterKind[]
  loans?: Loan[]
  loanSchedule?: LoanInstalment[]
  deposits?: FixedDeposit[]
  payrollRuns?: PayrollRun[]
  claims?: ExpenseClaim[]
  advances?: Advance[]
}

const STEP: Record<Frequency, (d: string, n: number) => string> = {
  once: (d) => d,
  weekly: (d, n) => addDays(d, 7 * n),
  monthly: (d, n) => addMonths(d, n),
  quarterly: (d, n) => addMonths(d, 3 * n),
  half_yearly: (d, n) => addMonths(d, 6 * n),
  yearly: (d, n) => addMonths(d, 12 * n),
}
export const PER_YEAR: Record<Frequency, number> = { once: 0, weekly: 52, monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 }

/** Amount of one occurrence on a date, after any configured escalation (spec 675). */
export function escalatedAmount(item: Pick<RegisterItem, 'amount' | 'escalation_pct' | 'escalation_date' | 'escalation_months'>, on: string): Decimal {
  const base = D(item.amount)
  const pct = D(item.escalation_pct)
  if (pct.isZero() || !item.escalation_date || on < item.escalation_date) return base
  const every = item.escalation_months && item.escalation_months > 0 ? item.escalation_months : 12
  let steps = 1
  for (let d = addMonths(item.escalation_date, every); d <= on && steps < 60; d = addMonths(d, every)) steps++
  return round2(base.times(pct.div(100).plus(1).pow(steps)))
}

/** Dates on which a register item falls due between two dates (inclusive). */
export function occurrences(item: Pick<RegisterItem, 'frequency' | 'next_due' | 'start_date' | 'end_date' | 'auto_renew'>, from: string, to: string, cap = 400): string[] {
  const first = item.next_due ?? item.start_date
  if (!first) return []
  const last = item.end_date && !item.auto_renew ? (item.end_date < to ? item.end_date : to) : to
  if (item.frequency === 'once') return first <= last ? [first] : []
  const out: string[] = []
  for (let n = 0; n < cap; n++) {
    const d = STEP[item.frequency](first, n)
    if (d > last) break
    if (d >= from || n === 0) out.push(d)
  }
  // an occurrence before the window is included once: it is already overdue
  return out.filter((d, i) => d >= from || i === 0)
}

const CATEGORY_BY_KIND: Record<string, string> = {
  subscription: 'Subscriptions', software_licence: 'Subscriptions', domain_hosting: 'Subscriptions', insurance: 'Insurance', rent: 'Rent', lease: 'Rent',
  amc: 'Maintenance contracts', retainer: 'Professional fees', utility: 'Utilities', contract_expense: 'Contracted expenditure', credit_card: 'Card payments',
  compliance: 'Taxes and compliance', csr_donation: 'Donations', dividend: 'Distributions', contract_revenue: 'Contracted inflows', sales_order: 'Expected billing',
  tenant_lease: 'Rental income', capital_call: 'Capital calls', capital_infusion: 'Capital', quotation: 'Quotations', asset_purchase: 'Capital expenditure',
  asset_sale: 'Asset sales', customer_refund: 'Refunds', commission: 'Commission', letter_of_credit: 'LC settlement', legal_claim: 'Legal', contingent_liability: 'Contingent',
  warranty: 'Warranty', security_deposit_paid: 'Deposits', security_deposit_received: 'Deposits', retention: 'Retention', insurance_claim: 'Insurance claims',
  recovery: 'Recoveries', trip: 'Travel', event: 'Events', work_order: 'Project payments',
}

/** Average number of days late, per customer, from settled invoices. Returned only where there is enough history. */
export function paymentBehaviour(invoices: Invoice[], payments: Payment[], minSamples = 3): Map<ID, { days: number; samples: number }> {
  const paidOn = new Map<ID, string>()
  for (const p of payments) {
    if (p.status !== 'posted') continue
    for (const a of p.allocations ?? []) if ((paidOn.get(a.invoice_id) ?? '') < p.pay_date) paidOn.set(a.invoice_id, p.pay_date)
  }
  const acc = new Map<ID, number[]>()
  for (const i of invoices) {
    if (i.status !== 'paid' || !i.due_date || !paidOn.has(i.id)) continue
    const list = acc.get(i.party_id) ?? []
    list.push(daysBetween(i.due_date, paidOn.get(i.id)!))
    acc.set(i.party_id, list)
  }
  const out = new Map<ID, { days: number; samples: number }>()
  for (const [party, list] of acc) if (list.length >= minSamples) out.set(party, { days: Math.round(list.reduce((a, b) => a + b, 0) / list.length), samples: list.length })
  return out
}

/** Value of each purchase order that has been approved but not yet billed: a commitment, not a cost (spec 672). */
export function openCommitments(purchaseDocs: PurchaseDoc[], invoices: Invoice[]) {
  const billed = new Map<ID, Decimal>()
  for (const i of invoices) if (i.po_id && i.doc_type === 'purchase_bill' && !['draft', 'cancelled'].includes(i.status)) billed.set(i.po_id, (billed.get(i.po_id) ?? ZERO).plus(i.subtotal))
  return purchaseDocs
    .filter((d) => d.kind === 'purchase_order' && ['approved', 'partially_received', 'fully_received'].includes(d.status))
    .map((po) => {
      const done = billed.get(po.id) ?? ZERO
      const open = Decimal.max(D(po.subtotal).minus(done), 0)
      const ratio = D(po.subtotal).isZero() ? ZERO : open.div(po.subtotal)
      return { po, ordered: D(po.subtotal), billed: done, open, openWithTax: round2(open.plus(D(po.tax_total).times(ratio))), openBase: round2(open.plus(D(po.tax_total).times(ratio)).times(po.fx_rate)) }
    })
    .filter((c) => c.open.gt(0))
}

/** Every known future money event between two dates. */
/** A scheduled occurrence of a register item that was left out because a document from the same party already stands for that period. */
export interface CoveredOccurrence { item_id: ID; ref_no: string; title: string; date: string; invoice_id: ID; doc_no: string | null }
const HALF_PERIOD: Record<Frequency, number> = { once: 15, weekly: 3, monthly: 15, quarterly: 45, half_yearly: 91, yearly: 182 }

export function buildEvents(i: ForwardInput): ForwardEvent[] { return buildForward(i).events }

/**
 * Everything recorded that will move money, and the scheduled occurrences that were left out because
 * the bill or invoice for that period has already been recorded (it is in the list as itself, or it is paid).
 */
export function buildForward(i: ForwardInput): { events: ForwardEvent[]; covered: CoveredOccurrence[] } {
  const covered: CoveredOccurrence[] = []
  return { events: build(i, covered), covered }
}

function build(i: ForwardInput, covered: CoveredOccurrence[]): ForwardEvent[] {
  const out: ForwardEvent[] = []
  const { asOf, until } = i
  const invoices = i.invoices ?? []
  const behaviour = paymentBehaviour(invoices, i.payments ?? [])
  const promised = new Map<ID, CollectionPromise>()
  for (const p of i.promises ?? []) if (p.status === 'open' && p.invoice_id) promised.set(p.invoice_id, p)

  // receivables and payables already in the books
  for (const inv of invoices) {
    if (inv.status !== 'open' && inv.status !== 'partially_paid') continue
    const left = D(inv.total).minus(inv.amount_settled)
    if (left.lte(0)) continue
    const incoming = inv.doc_type === 'sales_invoice' || inv.doc_type === 'debit_note'
    const date = inv.due_date ?? inv.doc_date
    if (date > until) continue
    const e: ForwardEvent = {
      id: 'inv:' + inv.id, company_id: inv.company_id, date, direction: incoming ? 'in' : 'out', amount: round2(left.times(inv.fx_rate)), certainty: 'DUE',
      category: incoming ? 'Collections' : 'Vendor payments', source: incoming ? 'invoice' : 'bill', label: `${inv.doc_no ?? 'Document'}${inv.narration ? ' · ' + inv.narration : ''}`,
      party_id: inv.party_id, link: `${inv.doc_type === 'sales_invoice' || inv.doc_type === 'credit_note' ? '/invoices' : '/bills'}/${inv.id}`, basis: `Outstanding on ${inv.doc_no ?? 'the document'}, due ${date}`, overdue: date < asOf,
    }
    if (incoming) {
      const pr = promised.get(inv.id)
      const b = behaviour.get(inv.party_id)
      if (pr) { e.expected_date = pr.promised_date; e.expected_basis = `PROMISED — the customer promised payment on ${pr.promised_date}` }
      else if (b && b.days > 0) { e.expected_date = addDays(date, b.days); e.expected_basis = `ESTIMATE — this customer has paid ${b.days} days after the due date on average (${b.samples} settled invoices)` }
    }
    out.push(e)
  }

  // purchase commitments
  for (const c of openCommitments(i.purchaseDocs ?? [], invoices)) {
    const date = c.po.required_date ?? addDays(c.po.doc_date, 30)
    if (date > until) continue
    out.push({
      id: 'po:' + c.po.id, company_id: c.po.company_id, date: date < asOf ? asOf : date, direction: 'out', amount: c.openBase, certainty: 'COMMITTED', category: 'Purchase commitments', source: 'purchase_order',
      label: `${c.po.doc_no}${c.po.title ? ' · ' + c.po.title : ''}`, party_id: c.po.party_id, link: `/purchasing/${c.po.id}`,
      basis: `Ordered ${c.ordered}, billed ${c.billed}; the unbilled part is committed. Date is ${c.po.required_date ? 'the required date' : 'order date + 30 days (no required date recorded)'}`,
    })
  }

  // registers: contracts, subscriptions, rent, insurance, guarantees …
  const kinds = new Map((i.registerKinds ?? []).map((k) => [k.key, k]))
  const documents = (i.invoices ?? []).filter((d) => !['draft', 'cancelled', 'rejected'].includes(d.status))
  for (const r of i.registerItems ?? []) {
    if (r.status !== 'active' || D(r.amount).lte(0)) continue
    const kind = kinds.get(r.kind)
    if (r.direction === 'none') {
      // an exposure with no direction of its own (a guarantee given, a claim against the company): it may have to be paid.
      // It is shown as CONTINGENT, beside the projection and never inside it.
      if (r.certainty !== 'contingent') continue
      const date = r.end_date ?? r.next_due ?? r.renewal_date ?? asOf
      if (date > until) continue
      out.push({
        id: 'reg:' + r.id + ':exposure', company_id: r.company_id, date: date < asOf ? asOf : date, direction: 'out', amount: D(r.total_value ?? r.amount).gt(0) ? D(r.total_value ?? r.amount) : D(r.amount),
        certainty: 'CONTINGENT', category: kind?.name ?? r.kind.replace(/_/g, ' '), currency: r.currency, source: 'register', label: `${r.ref_no} · ${r.title}`, party_id: r.party_id, link: '/registers/' + r.id,
        basis: `${kind?.name ?? r.kind}: an exposure that becomes payable only if it is called. Dated ${r.end_date ? 'at its end date' : r.next_due ? 'at its next date' : 'today, because no date is recorded'}`,
      })
      continue
    }
    for (const date of occurrences(r, asOf, until)) {
      // the document for this period already exists: counting the schedule as well would count the same money twice
      const doc = r.party_id ? documents.find((d) => d.company_id === r.company_id && d.party_id === r.party_id && d.doc_type === (r.direction === 'out' ? 'purchase_bill' : 'sales_invoice')
        && Math.abs(daysBetween(d.doc_date, date)) <= HALF_PERIOD[r.frequency]) : undefined
      if (doc) { covered.push({ item_id: r.id, ref_no: r.ref_no, title: r.title, date, invoice_id: doc.id, doc_no: doc.doc_no }); continue }
      const amount = escalatedAmount(r, date)
      const escalated = !amount.eq(D(r.amount))
      out.push({
        id: `reg:${r.id}:${date}`, company_id: r.company_id, date, direction: r.direction, amount, certainty: r.certainty.toUpperCase() as ForwardCertainty,
        category: CATEGORY_BY_KIND[r.kind] ?? (r.direction === 'in' ? 'Other inflows' : 'Other obligations'), currency: r.currency, source: 'register', label: `${r.ref_no} · ${r.title}`, party_id: r.party_id,
        link: `/registers/${r.id}`, overdue: date < asOf,
        basis: `${kind?.name ?? r.kind}, ${r.frequency === 'once' ? 'one payment' : r.frequency.replace('_', ' ')}${escalated ? `; includes the ${D(r.escalation_pct)}% escalation from ${day(r.escalation_date)}` : ''}`,
      })
    }
  }

  // loans
  const loans = new Map((i.loans ?? []).map((l) => [l.id, l]))
  for (const s of i.loanSchedule ?? []) {
    const l = loans.get(s.loan_id)
    if (!l || l.status !== 'active' || s.status === 'paid' || s.due_date > until) continue
    out.push({
      id: 'loan:' + s.id, company_id: s.company_id, date: s.due_date, direction: l.direction === 'borrowed' ? 'out' : 'in', amount: Decimal.max(D(s.principal).minus(D(s.recovered ?? 0)), 0).plus(s.interest), certainty: 'CONTRACTED', category: l.direction === 'borrowed' ? 'Loan repayments' : 'Loan recoveries',
      currency: l.currency, source: 'loan', label: `${l.loan_no} · ${l.name} · instalment ${s.instalment_no}`, party_id: l.party_id, link: `/treasury/loans/${l.id}`, overdue: s.due_date < asOf,
      basis: `Principal ${amt(Decimal.max(D(s.principal).minus(D(s.recovered ?? 0)), 0))}${D(s.recovered ?? 0).gt(0) ? ` (after ${amt(s.recovered)} recovered through payroll)` : ''} + interest ${amt(s.interest)} as per schedule${l.rate_type === 'floating' ? ' (floating rate: interest is indicative)' : ''}`,
    })
  }

  // fixed deposits maturing
  for (const d of i.deposits ?? []) {
    if (d.status !== 'active' || d.maturity_date > until || d.auto_renew) continue
    out.push({
      id: 'fd:' + d.id, company_id: d.company_id, currency: d.currency, date: d.maturity_date < asOf ? asOf : d.maturity_date, direction: 'in', amount: D(d.maturity_amount), certainty: 'CONTRACTED', category: 'Deposits maturing', source: 'deposit',
      label: `${d.fd_no} · ${d.bank_name}`, party_id: d.bank_party_id, link: `/treasury?deposit=${d.id}`,
      basis: `Maturity value at ${D(d.rate_pct)}% (${d.compounding}); tax deducted at source is not yet known${d.lien_marked ? '. UNDER LIEN — may not be freely available' : ''}`,
    })
  }

  // payroll: salaries already approved and unpaid, then a forecast from the last regular run
  const runs = (i.payrollRuns ?? []).filter((r) => r.run_type === 'regular')
  for (const r of runs) {
    if (r.status !== 'posted') continue
    out.push({ id: 'pay:' + r.id, company_id: r.company_id, date: asOf, direction: 'out', amount: D(r.net), certainty: 'DUE', category: 'Payroll', source: 'payroll', label: `${r.run_no} · net salaries`, link: `/payroll/runs/${r.id}`, basis: 'Payroll posted; net salaries not yet paid' })
  }
  const byCompany = new Map<ID, PayrollRun>()
  for (const r of runs) if (['posted', 'paid'].includes(r.status) && (byCompany.get(r.company_id)?.period_month ?? '') < r.period_month) byCompany.set(r.company_id, r)
  for (const [company, last] of byCompany) {
    for (let m = addMonths(last.period_month, 1), n = 0; n < 60; m = addMonths(m, 1), n++) {
      const date = endOfMonth(m)
      if (date > until) break
      if (date < asOf) continue
      out.push({ id: `payf:${company}:${m}`, company_id: company, date, direction: 'out', amount: D(last.net), certainty: 'FORECAST', category: 'Payroll', source: 'payroll', label: `Payroll forecast · ${m.slice(0, 7)}`, link: '/payroll', basis: `FORECAST — repeats the net of ${last.run_no} (${last.headcount} people). Approved increments, joiners and leavers after that run are not included` })
    }
  }

  // employee claims awaiting reimbursement; advances approved and not yet released
  for (const c of i.claims ?? []) {
    if (c.status === 'posted' && D(c.payable).gt(0)) out.push({ id: 'claim:' + c.id, company_id: c.company_id, currency: c.currency, date: asOf, direction: 'out', amount: D(c.payable), certainty: 'DUE', category: 'Reimbursements', source: 'claim', label: `${c.claim_no} · ${c.title}`, party_id: c.claimant_party_id, link: `/expenses/claims/${c.id}`, basis: 'Approved claim, reimbursement not yet paid' })
    else if (c.status === 'submitted') out.push({ id: 'claim:' + c.id, company_id: c.company_id, currency: c.currency, date: addDays(asOf, 7), direction: 'out', amount: D(c.total), certainty: 'POSSIBLE', category: 'Reimbursements', source: 'claim', label: `${c.claim_no} · ${c.title} (awaiting approval)`, party_id: c.claimant_party_id, link: `/expenses/claims/${c.id}`, basis: 'CLAIM PENDING — not a liability until approved' })
  }
  for (const a of i.advances ?? []) {
    const unreleased = D(a.approved_amount).minus(a.released_amount)
    if (['approved', 'partially_released'].includes(a.status) && unreleased.gt(0)) out.push({ id: 'adv:' + a.id, company_id: a.company_id, currency: a.currency, date: asOf, direction: 'out', amount: unreleased, certainty: 'COMMITTED', category: 'Advances', source: 'advance', label: `${a.advance_no} · ${a.purpose}`, party_id: a.recipient_party_id, link: `/expenses/advances/${a.id}`, basis: 'Advance approved, money not yet released' })
    const out_ = D(a.released_amount).minus(a.settled_amount).minus(a.returned_amount)
    if (a.status === 'return_due' && out_.gt(0)) out.push({ id: 'advr:' + a.id, company_id: a.company_id, currency: a.currency, date: a.expected_settlement_date && a.expected_settlement_date > asOf ? a.expected_settlement_date : asOf, direction: 'in', amount: out_, certainty: 'EXPECTED', category: 'Advance returns', source: 'advance', label: `${a.advance_no} · unused advance to be returned`, party_id: a.recipient_party_id, link: `/expenses/advances/${a.id}`, basis: 'Settlement closed with an unused balance' })
  }

  return out.filter((e) => e.amount.gt(0)).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
}

export const HORIZONS: { key: string; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 0 }, { key: '7d', label: '7 days', days: 7 }, { key: '14d', label: '14 days', days: 14 }, { key: '30d', label: '30 days', days: 30 },
  { key: '60d', label: '60 days', days: 60 }, { key: '90d', label: '90 days', days: 90 }, { key: '6m', label: '6 months', days: 183 }, { key: '12m', label: '12 months', days: 365 },
  { key: '3y', label: '3 years', days: 1096 }, { key: '5y', label: '5 years', days: 1826 },
]

export interface HorizonRow {
  key: string
  label: string
  until: string
  inflow: Decimal
  outflow: Decimal
  firmInflow: Decimal
  firmOutflow: Decimal
  softInflow: Decimal
  softOutflow: Decimal
  /** opening cash + firm and soft movements (contingent items excluded) */
  projected: Decimal
  /** opening cash + firm movements only */
  projectedFirm: Decimal
  byCategory: { category: string; direction: 'in' | 'out'; amount: Decimal }[]
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  confidenceWhy: string
  contingent: Decimal
}

/** Cash horizon (spec 702-704). Contingent items are reported beside the projection, never inside it. */
export function cashHorizon(events: ForwardEvent[], openingCash: Decimal.Value, asOf: string, opts: { useExpectedDates?: boolean } = {}): HorizonRow[] {
  const when = (e: ForwardEvent) => (opts.useExpectedDates && e.expected_date ? e.expected_date : e.date)
  return HORIZONS.map((h) => {
    const until = addDays(asOf, h.days)
    const within = events.filter((e) => when(e) <= until)
    const counted = within.filter((e) => e.certainty !== 'CONTINGENT')
    const firm = counted.filter((e) => FIRM.includes(e.certainty))
    const soft = counted.filter((e) => !FIRM.includes(e.certainty))
    const tot = (xs: ForwardEvent[], dir: 'in' | 'out') => sum(xs.filter((e) => e.direction === dir).map((e) => e.amount))
    const cats = new Map<string, { category: string; direction: 'in' | 'out'; amount: Decimal }>()
    for (const e of counted) {
      const k = e.direction + '|' + e.category
      const cur = cats.get(k) ?? { category: e.category, direction: e.direction, amount: ZERO }
      cur.amount = cur.amount.plus(e.amount)
      cats.set(k, cur)
    }
    const gross = tot(counted, 'in').plus(tot(counted, 'out'))
    const firmGross = tot(firm, 'in').plus(tot(firm, 'out'))
    const share = gross.isZero() ? 1 : firmGross.div(gross).toNumber()
    const overdueIn = sum(firm.filter((e) => e.direction === 'in' && e.overdue).map((e) => e.amount))
    const overdueShare = tot(counted, 'in').isZero() ? 0 : overdueIn.div(tot(counted, 'in')).toNumber()
    const confidence: HorizonRow['confidence'] = share >= 0.8 && overdueShare < 0.35 ? 'HIGH' : share >= 0.5 ? 'MEDIUM' : 'LOW'
    const why = gross.isZero()
      ? 'No movements are recorded for this horizon.'
      : `${Math.round(share * 100)}% of the amounts in this horizon are due, contracted, committed or scheduled; the rest are expected, possible or forecast.`
        + (overdueShare >= 0.35 ? ` ${Math.round(overdueShare * 100)}% of the inflows are already overdue, so their timing is uncertain.` : '')
    return {
      key: h.key, label: h.label, until, inflow: tot(counted, 'in'), outflow: tot(counted, 'out'), firmInflow: tot(firm, 'in'), firmOutflow: tot(firm, 'out'), softInflow: tot(soft, 'in'), softOutflow: tot(soft, 'out'),
      projected: D(openingCash).plus(tot(counted, 'in')).minus(tot(counted, 'out')), projectedFirm: D(openingCash).plus(tot(firm, 'in')).minus(tot(firm, 'out')),
      byCategory: [...cats.values()].sort((a, b) => b.amount.cmp(a.amount)), confidence, confidenceWhy: why,
      contingent: sum(within.filter((e) => e.certainty === 'CONTINGENT').map((e) => e.amount)),
    }
  })
}

/** Day-by-day projected balance; used to find the first day cash falls below a threshold. */
export function dailyBalance(events: ForwardEvent[], openingCash: Decimal.Value, asOf: string, days: number, firmOnly = false) {
  const byDay = new Map<string, Decimal>()
  for (const e of events) {
    if (e.certainty === 'CONTINGENT' || (firmOnly && !FIRM.includes(e.certainty))) continue
    const d = e.date < asOf ? asOf : e.date
    byDay.set(d, (byDay.get(d) ?? ZERO).plus(e.direction === 'in' ? e.amount : e.amount.neg()))
  }
  const out: { date: string; balance: Decimal; net: Decimal }[] = []
  let bal = D(openingCash)
  for (let n = 0; n <= days; n++) {
    const date = addDays(asOf, n)
    const net = byDay.get(date) ?? ZERO
    bal = bal.plus(net)
    out.push({ date, balance: bal, net })
  }
  return out
}

export type WarningLevel = 'info' | 'review' | 'priority' | 'critical'
export interface ForwardWarning {
  id: string
  kind: string
  level: WarningLevel
  company_id?: ID
  title: string
  /** factual statement; never a conclusion about anyone's conduct */
  detail: string
  assumptions: string[]
  date?: string
  amount?: Decimal
  link?: string
}

const NOTICE_DAYS = [7, 30, 60, 90]
/** notices at 90, 60, 30 and 7 days (spec 712): the nearer the date, the higher the attention */
const noticeLevel = (days: number): WarningLevel => (days <= 7 ? 'critical' : days <= 30 ? 'priority' : days <= 60 ? 'review' : 'info')
const inDays = (n: number) => (n < 0 ? `${-n} day(s) ago` : n === 0 ? 'today' : `in ${n} day(s)`)

export interface WarningInput extends ForwardInput {
  events: ForwardEvent[]
  openingCash: Decimal.Value
  /** cash the business does not want to fall below */
  cashThreshold?: Decimal.Value
  documents?: DocumentRecord[]
  partyName?: (id: ID | null | undefined) => string
}

/** Early-warning system (spec 707-717). Each warning states the facts, the rule and the assumptions. */
export function earlyWarnings(i: WarningInput): ForwardWarning[] {
  const out: ForwardWarning[] = []
  const name = i.partyName ?? (() => 'a party')
  const threshold = D(i.cashThreshold ?? 0)

  // cash shortfall
  const daily = dailyBalance(i.events, i.openingCash, i.asOf, 90)
  const dip = daily.find((d) => d.balance.lt(threshold))
  if (dip) {
    const n = daysBetween(i.asOf, dip.date)
    const causes = i.events.filter((e) => e.direction === 'out' && e.certainty !== 'CONTINGENT' && (e.date < i.asOf ? i.asOf : e.date) <= dip.date).sort((a, b) => b.amount.cmp(a.amount)).slice(0, 3)
    out.push({
      id: 'cash-shortfall', kind: 'cash_shortfall', level: n <= 14 ? 'critical' : n <= 30 ? 'priority' : 'review', date: dip.date, amount: dip.balance,
      title: `Projected cash may fall below ${threshold.isZero() ? 'zero' : 'the configured threshold'} ${inDays(n)}`,
      detail: `Projected available cash on ${day(dip.date)} is ${amt(dip.balance)} against a threshold of ${amt(threshold)}. Largest outflows before that date: ${causes.map((c) => `${c.label} (${amt(c.amount)}, ${c.certainty})`).join('; ') || 'none recorded'}.`,
      assumptions: ['Receivables are collected on their due dates', 'Every recorded obligation is paid on its date', 'Contingent items are excluded', 'Opening cash is the ledger balance of bank and cash accounts'], link: '/forward',
    })
  }

  // payroll coverage
  const nextPayroll = i.events.filter((e) => e.category === 'Payroll' && e.direction === 'out').sort((a, b) => a.date.localeCompare(b.date))[0]
  if (nextPayroll) {
    const cover = nextPayroll.amount.isZero() ? null : D(i.openingCash).div(nextPayroll.amount)
    if (cover && cover.lt(2)) out.push({
      id: 'payroll-coverage', kind: 'payroll_coverage', level: cover.lt(1) ? 'critical' : 'priority', company_id: nextPayroll.company_id, date: nextPayroll.date, amount: nextPayroll.amount,
      title: `Current cash covers the next payroll ${cover.toFixed(1)} times`, detail: `Current cash is ${amt(D(i.openingCash))}. The next payroll is ${amt(nextPayroll.amount)} (${nextPayroll.certainty}) on ${day(nextPayroll.date)}.`,
      assumptions: [nextPayroll.basis, 'Collections expected before that date are not counted in the coverage ratio'], link: '/payroll',
    })
  }

  // debt service in the next 30 days
  const debt = i.events.filter((e) => e.source === 'loan' && e.direction === 'out' && e.date <= addDays(i.asOf, 30))
  if (debt.length) out.push({
    id: 'debt-service', kind: 'debt_service', level: debt.some((e) => e.overdue) ? 'priority' : 'info', amount: sum(debt.map((e) => e.amount)),
    title: `${debt.length} loan instalment(s) fall due within 30 days`, detail: debt.map((e) => `${e.label}: ${amt(e.amount)} on ${day(e.date)}${e.overdue ? ' (overdue)' : ''}`).join('; '),
    assumptions: ['Amounts are taken from the loan schedule', 'For floating-rate loans the interest shown is indicative'], link: '/treasury',
  })

  // renewals, expiries and deadlines from the registers
  const kinds = new Map((i.registerKinds ?? []).map((k) => [k.key, k]))
  const horizon = addDays(i.asOf, Math.max(...NOTICE_DAYS))
  for (const r of i.registerItems ?? []) {
    if (r.status !== 'active') continue
    const kind = kinds.get(r.kind)
    const dates: { label: string; date: string }[] = []
    if (r.renewal_date) dates.push({ label: 'renews', date: r.renewal_date })
    if (r.cancel_by) dates.push({ label: 'must be cancelled by', date: r.cancel_by })
    if (r.end_date && !r.auto_renew) dates.push({ label: 'ends', date: r.end_date })
    if (r.kind === 'compliance' && r.next_due) dates.push({ label: 'is due', date: r.next_due })
    for (const f of kind?.fields ?? []) if (f.alert && typeof r.data[f.key] === 'string' && r.data[f.key]) dates.push({ label: f.label.toLowerCase() + ':', date: r.data[f.key] as string })
    for (const d of dates) {
      if (d.date > horizon || d.date < addDays(i.asOf, -60)) continue
      const n = daysBetween(i.asOf, d.date)
      const owner = r.owner_name ? ` Owner: ${r.owner_name}.` : ' No owner is recorded.'
      out.push({
        id: `reg:${r.id}:${d.label}`, kind: r.kind === 'compliance' ? 'tax_deadline' : r.kind.includes('guarantee') ? 'guarantee_expiry' : r.kind === 'insurance' || d.label.includes('insurance') ? 'insurance_expiry' : r.kind === 'subscription' ? 'subscription_renewal' : 'renewal',
        level: noticeLevel(n), company_id: r.company_id, date: d.date, amount: D(r.amount), link: `/registers/${r.id}`,
        title: `${r.title} ${d.label} ${d.date} (${inDays(n)})`,
        detail: `${kind?.name ?? r.kind} ${r.ref_no}.${D(r.amount).gt(0) ? ` Amount ${amt(D(r.amount))} ${r.currency}, ${r.frequency.replace('_', ' ')}.` : ''}${r.auto_renew ? ' Renews automatically unless cancelled.' : ''}${owner}`,
        assumptions: ['Dates are as recorded in the register'],
      })
    }
  }
  for (const d of i.documents ?? []) {
    if (!d.expires_on || d.status === 'rejected' || d.expires_on > horizon || d.expires_on < addDays(i.asOf, -60)) continue
    const n = daysBetween(i.asOf, d.expires_on)
    out.push({ id: 'doc:' + d.id, kind: 'document_expiry', level: noticeLevel(n), company_id: d.company_id, date: d.expires_on, title: `${d.name} expires ${d.expires_on} (${inDays(n)})`, detail: `Document recorded as ${d.doc_kind.replace(/_/g, ' ')}.`, assumptions: ['Expiry date is as entered when the document was classified'], link: '/inbox' })
  }

  // deposits maturing, and deposits that will renew on their own
  for (const d of i.deposits ?? []) {
    if (d.status !== 'active' || d.maturity_date > addDays(i.asOf, 30)) continue
    const n = daysBetween(i.asOf, d.maturity_date)
    out.push({ id: 'fd:' + d.id, kind: 'deposit_maturity', level: noticeLevel(n), company_id: d.company_id, date: d.maturity_date, amount: D(d.maturity_amount), title: `Fixed deposit ${d.fd_no} matures ${inDays(n)}`, detail: `${d.bank_name}, principal ${amt(D(d.principal))} at ${D(d.rate_pct)}%.${d.auto_renew ? ' Set to renew automatically.' : ''}${d.lien_marked ? ` Under lien: ${d.lien_note ?? 'no note'}.` : ''}`, assumptions: ['Maturity value is calculated, not confirmed by the bank'], link: '/treasury' })
  }

  // unsettled advances past their expected settlement date
  for (const a of i.advances ?? []) {
    const left = D(a.released_amount).minus(a.settled_amount).minus(a.returned_amount)
    if (left.lte(0) || ['cancelled', 'rejected', 'draft', 'requested'].includes(a.status)) continue
    const since = a.expected_settlement_date ?? (a.released_on ? addDays(a.released_on, 30) : null)
    if (!since || since >= i.asOf) continue
    const n = daysBetween(since, i.asOf)
    out.push({ id: 'adv:' + a.id, kind: 'advance_unsettled', level: n > 60 ? 'priority' : 'review', company_id: a.company_id, date: since, amount: left, title: `Advance ${a.advance_no} is unsettled ${n} day(s) past its settlement date`, detail: `${amt(left)} is held by ${name(a.recipient_party_id)} for "${a.purpose}". ${a.last_follow_up ? `Last follow-up ${day(a.last_follow_up.slice(0, 10))}.` : 'No follow-up is recorded.'}`, assumptions: [a.expected_settlement_date ? 'Settlement date is as recorded on the advance' : 'No settlement date was recorded; 30 days from release is used'], link: `/expenses/advances/${a.id}` })
  }

  // receivable concentration
  const recv = i.events.filter((e) => e.source === 'invoice' && e.direction === 'in')
  const total = sum(recv.map((e) => e.amount))
  if (total.gt(0)) {
    const by = new Map<ID, Decimal>()
    for (const e of recv) if (e.party_id) by.set(e.party_id, (by.get(e.party_id) ?? ZERO).plus(e.amount))
    const [top] = [...by.entries()].sort((a, b) => b[1].cmp(a[1]))
    if (top && top[1].div(total).gte(0.3)) out.push({ id: 'recv-concentration', kind: 'receivable_concentration', level: top[1].div(total).gte(0.5) ? 'priority' : 'review', amount: top[1], title: `${Math.round(top[1].div(total).times(100).toNumber())}% of recorded receivables are associated with ${name(top[0])}`, detail: `${amt(top[1])} of ${amt(total)} outstanding.`, assumptions: ['Receivables are open sales invoices and debit notes in the selected companies'], link: `/parties/${top[0]}` })
  }

  // payable concentration: how much of what is owed is owed to one party
  const owed = i.events.filter((e) => e.source === 'bill' && e.direction === 'out')
  const owedTotal = sum(owed.map((e) => e.amount))
  if (owedTotal.gt(0)) {
    const by = new Map<ID, Decimal>()
    for (const e of owed) if (e.party_id) by.set(e.party_id, (by.get(e.party_id) ?? ZERO).plus(e.amount))
    const [top] = [...by.entries()].sort((a, b) => b[1].cmp(a[1]))
    if (top && top[1].div(owedTotal).gte(0.3)) out.push({ id: 'pay-concentration', kind: 'payable_concentration', level: 'review', amount: top[1], title: `${Math.round(top[1].div(owedTotal).times(100).toNumber())}% of recorded payables are owed to ${name(top[0])}`, detail: `${amt(top[1])} of ${amt(owedTotal)} outstanding.`, assumptions: ['Payables are open purchase bills and credit notes received, in the selected companies'], link: `/parties/${top[0]}` })
  }

  // promises to pay that have passed
  for (const p of i.promises ?? []) {
    if (p.status !== 'open' || p.promised_date >= i.asOf) continue
    out.push({ id: 'promise:' + p.id, kind: 'promise_passed', level: 'review', company_id: p.company_id, date: p.promised_date, amount: D(p.promised_amount), title: `A promise to pay ${amt(D(p.promised_amount))} passed on ${day(p.promised_date)}`, detail: `${name(p.party_id)} promised payment${p.contact_person ? ` (contact: ${p.contact_person})` : ''}. Record whether it was kept.`, assumptions: [], link: `/parties/${p.party_id}` })
  }

  const rank: Record<WarningLevel, number> = { critical: 0, priority: 1, review: 2, info: 3 }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.date ?? '9').localeCompare(b.date ?? '9'))
}

/** Budget exhaustion forecast (spec 718). Returns null when there is nothing to project from. */
export function budgetExhaustion(budget: Decimal.Value, spent: Decimal.Value, committed: Decimal.Value, monthsElapsed: number, monthsTotal = 12) {
  const b = D(budget), s = D(spent), c = D(committed)
  if (b.lte(0) || monthsElapsed <= 0) return null
  const runRate = s.div(monthsElapsed)
  const remaining = b.minus(s).minus(c)
  const monthsLeft = runRate.lte(0) ? null : Decimal.max(remaining, 0).div(runRate).toNumber()
  return {
    budget: b, spent: s, committed: c, remaining, runRate: round2(runRate), monthsLeft,
    exhaustsBeforeYearEnd: monthsLeft !== null && monthsLeft < monthsTotal - monthsElapsed,
    statement: monthsLeft === null ? 'Nothing has been spent yet, so no run rate can be calculated.'
      : remaining.lte(0) ? `Spending plus commitments (${amt(s.plus(c))}) already equal or exceed the approved budget of ${amt(b)}.`
      : `At the recorded run rate of ${amt(runRate)} a month, the remaining ${amt(remaining)} may be exhausted in approximately ${monthsLeft.toFixed(1)} month(s).`,
    assumptions: [`Run rate is actual spending over ${monthsElapsed} month(s)`, 'Approved purchase orders not yet billed are treated as committed', 'Future spending continues at the same rate'],
  }
}

/** Calendar view (spec 721): events grouped by day for a month. */
export function calendarMonth(events: ForwardEvent[], month: string) {
  const from = startOfMonth(month), to = endOfMonth(month)
  const days = new Map<string, ForwardEvent[]>()
  for (const e of events) if (e.date >= from && e.date <= to) days.set(e.date, [...(days.get(e.date) ?? []), e])
  return { from, to, days }
}
