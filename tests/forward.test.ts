import { beforeAll, describe, expect, it } from 'vitest'
import { getDemoEngine } from '../src/api/demoSeed'
import type { DemoEngine } from '../src/api/demo'
import { budgetExhaustion, buildEvents, buildForward, cashHorizon, dailyBalance, earlyWarnings, escalatedAmount, FIRM, occurrences, openCommitments, paymentBehaviour } from '../src/engine/forward'
import { advanceAgeing, advanceMemory, compareQuotations, debtLadder, depreciationForecast, loanPosition, newHireCost, peopleCost } from '../src/engine/ops'
import { D, sum } from '../src/lib/money'
import { addDays, addMonths, startOfMonth, today } from '../src/lib/dates'
import type { Employee, Loan, LoanInstalment, PayrollLine, PayrollRun, RegisterItem } from '../src/engine/opsTypes'
import type { Invoice } from '../src/engine/types'

const TODAY = today()
const item = (o: Partial<RegisterItem>): RegisterItem => ({
  id: 'r1', company_id: 'c', kind: 'rent', ref_no: 'RNT-00001', title: 'Rent', party_id: null, org_unit_id: null, account_id: null, direction: 'out', amount: '1000000', currency: 'INR', frequency: 'monthly',
  start_date: '2026-01-05', end_date: null, next_due: '2026-01-05', total_value: null, certainty: 'contracted', state: 'active', auto_renew: false, renewal_date: null, cancel_by: null, escalation_pct: null,
  escalation_date: null, escalation_months: null, probability: null, owner_user: null, owner_name: null, confidentiality: 'internal', notes: null, data: {}, status: 'active', created_by: null, created_at: '', updated_at: '', ...o,
})

describe('schedules', () => {
  it('a monthly obligation falls due once a month', () => {
    expect(occurrences(item({}), '2026-01-01', '2026-04-30')).toEqual(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'])
    expect(occurrences(item({ frequency: 'quarterly' }), '2026-01-01', '2026-12-31')).toHaveLength(4)
    expect(occurrences(item({ frequency: 'once' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-05'])
  })
  it('stops at the end date unless it renews automatically', () => {
    expect(occurrences(item({ end_date: '2026-03-31' }), '2026-01-01', '2026-12-31')).toHaveLength(3)
    expect(occurrences(item({ end_date: '2026-03-31', auto_renew: true }), '2026-01-01', '2026-06-30')).toHaveLength(6)
  })
  it('an occurrence already past is kept once, as overdue', () => {
    expect(occurrences(item({ frequency: 'yearly' }), '2026-06-01', '2026-12-31')).toEqual(['2026-01-05'])
  })
  it('rent escalation: 10 lakh a month, 5% from April (spec 675)', () => {
    const rent = item({ escalation_pct: '5', escalation_date: '2026-04-01', escalation_months: 12 })
    expect(escalatedAmount(rent, '2026-03-05').toNumber()).toBe(1000000)
    expect(escalatedAmount(rent, '2026-04-05').toNumber()).toBe(1050000)
    expect(escalatedAmount(rent, '2027-04-05').toNumber()).toBe(1102500)
  })
})

describe('cash horizon on the sample universe', () => {
  let e: DemoEngine
  let ids: string[]
  let input: Parameters<typeof buildEvents>[0]
  beforeAll(async () => {
    e = await getDemoEngine()
    ids = e.companies.map((c) => c.id)
    input = {
      asOf: TODAY, until: addDays(TODAY, 1826), invoices: await e.listInvoices({ companyIds: ids }), payments: await e.listPayments({ companyIds: ids }), promises: await e.listPromises({ companyIds: ids }),
      purchaseDocs: await e.listPurchaseDocs({ companyIds: ids }), registerItems: await e.listRegisterItems({ companyIds: ids }), registerKinds: await e.listRegisterKinds(), loans: await e.listLoans(ids),
      loanSchedule: await e.listLoanSchedule({ companyIds: ids }), deposits: await e.listFixedDeposits(ids), payrollRuns: await e.listPayrollRuns(ids), claims: await e.listClaims({ companyIds: ids }), advances: await e.listAdvances({ companyIds: ids }),
    }
  })

  it('every event names its source, its certainty and how it was arrived at', () => {
    const ev = buildEvents(input)
    expect(ev.length).toBeGreaterThan(100)
    for (const x of ev) { expect(x.basis.length).toBeGreaterThan(10); expect(x.amount.gt(0)).toBe(true); expect(x.label).toBeTruthy() }
    expect(new Set(ev.map((x) => x.source))).toEqual(new Set(['invoice', 'bill', 'purchase_order', 'register', 'loan', 'deposit', 'payroll', 'claim', 'advance']))
  })
  it('an approved purchase order is COMMITTED for what has not been billed', () => {
    const c = openCommitments(input.purchaseDocs!, input.invoices!)
    const steel = c.find((x) => x.po.title?.includes('TMT steel'))!
    expect(steel.ordered.toNumber()).toBe(2340000)
    expect(steel.billed.toNumber()).toBe(1462500)
    expect(steel.open.toNumber()).toBe(877500)
    expect(buildEvents(input).find((x) => x.id === 'po:' + steel.po.id)!.certainty).toBe('COMMITTED')
    expect(c.some((x) => x.po.status === 'submitted')).toBe(false) // an order awaiting approval commits nothing
  })
  it('an estimate never replaces the contractual date', () => {
    const late = buildEvents(input).filter((x) => x.expected_date)
    expect(late.length).toBeGreaterThan(0)
    for (const x of late) { expect(x.expected_basis).toMatch(/^(ESTIMATE|PROMISED)/); expect(x.date).not.toBe(undefined) }
    expect(paymentBehaviour(input.invoices!, input.payments!).size).toBeGreaterThan(0)
  })
  it('contingent amounts are reported beside the projection, never inside it', () => {
    const ev = buildEvents(input)
    const h = cashHorizon(ev, 1000000, TODAY)
    const year = h.find((x) => x.key === '12m')!
    // 42 lakh of disputes and claims, and 1.2 crore of guarantees given: an exposure with no direction of its own is contingent
    expect(year.contingent.toNumber()).toBe(16200000)
    expect(ev.filter((x) => x.certainty === 'CONTINGENT' && x.id.endsWith(':exposure')).length).toBeGreaterThan(0)
    const counted = ev.filter((x) => x.date <= year.until && x.certainty !== 'CONTINGENT')
    expect(year.projected.eq(D(1000000).plus(sum(counted.filter((x) => x.direction === 'in').map((x) => x.amount))).minus(sum(counted.filter((x) => x.direction === 'out').map((x) => x.amount))))).toBe(true)
    expect(year.firmInflow.plus(year.softInflow).eq(year.inflow)).toBe(true)
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(year.confidence)
    expect(year.confidenceWhy).toMatch(/%/)
    expect(h.map((x) => x.key)).toEqual(['today', '7d', '14d', '30d', '60d', '90d', '6m', '12m', '3y', '5y'])
  })
  it('the payroll forecast is labelled FORECAST and says what it leaves out', () => {
    const f = buildEvents(input).filter((x) => x.source === 'payroll' && x.certainty === 'FORECAST')
    expect(f.length).toBeGreaterThan(10)
    expect(f[0].basis).toMatch(/^FORECAST — repeats the net of/)
    expect(FIRM).not.toContain('FORECAST')
  })
  it('daily balance ends where the horizon ends', () => {
    const ev = buildEvents(input)
    const d = dailyBalance(ev, 5000000, TODAY, 30)
    expect(d).toHaveLength(31)
    expect(d[30].balance.eq(cashHorizon(ev, 5000000, TODAY).find((x) => x.key === '30d')!.projected)).toBe(true)
  })
  it('early warnings state facts, rules and assumptions', async () => {
    const ev = buildEvents(input)
    const w = earlyWarnings({ ...input, events: ev, openingCash: 50000000, cashThreshold: 0, documents: await e.listDocuments({ companyIds: ids }), partyName: (id) => e.parties.find((p) => p.id === id)?.display_name ?? 'a party' })
    const kinds = new Set(w.map((x) => x.kind))
    for (const k of ['insurance_expiry', 'guarantee_expiry', 'tax_deadline', 'advance_unsettled', 'deposit_maturity', 'debt_service', 'promise_passed', 'document_expiry']) expect(kinds.has(k), k).toBe(true)
    const puc = w.find((x) => x.title.includes('pollution certificate'))!
    expect(puc.level).toBe('critical') // already expired
    expect(puc.title).toMatch(/5 day\(s\) ago/)
    const adv = w.find((x) => x.kind === 'advance_unsettled')!
    expect(adv.detail).toMatch(/No follow-up is recorded|Last follow-up/)
    for (const x of w) expect(`${x.title} ${x.detail}`).not.toMatch(/fraud|suspicious|misconduct|theft by/i)
    expect(w[0].level === 'critical' || w[0].level === 'priority').toBe(true)
  })
  it('a cash shortfall names its causes and assumptions', () => {
    const ev = buildEvents(input)
    const w = earlyWarnings({ ...input, events: ev.filter((x) => x.direction === 'out'), openingCash: 1000, cashThreshold: 500000 })
    const s = w.find((x) => x.kind === 'cash_shortfall')!
    expect(s.level).toBe('critical')
    expect(s.detail).toMatch(/Largest outflows before that date/)
    expect(s.assumptions.length).toBeGreaterThanOrEqual(3)
  })
})

describe('budget, advances, people and debt', () => {
  let e: DemoEngine
  let ids: string[]
  beforeAll(async () => { e = await getDemoEngine(); ids = e.companies.map((c) => c.id) })

  it('budget exhaustion is a statement with assumptions, not a verdict', () => {
    const b = budgetExhaustion(1200000, 500000, 100000, 4)!
    expect(b.runRate.toNumber()).toBe(125000)
    expect(b.monthsLeft).toBeCloseTo(4.8, 1)
    expect(b.exhaustsBeforeYearEnd).toBe(true)
    expect(b.statement).toMatch(/may be exhausted in approximately 4\.8 month/)
    expect(budgetExhaustion(0, 1, 0, 1)).toBeNull()
    expect(budgetExhaustion(100, 90, 20, 3)!.statement).toMatch(/already equal or exceed/)
  })
  it('advance ageing and advance memory', async () => {
    const adv = await e.listAdvances({ companyIds: ids })
    const claims = await e.listClaims({ companyIds: ids })
    const a = advanceAgeing(adv, TODAY)
    expect(a.buckets.map((b) => b.label)).toEqual(['0–7 days', '8–15 days', '16–30 days', '31–60 days', '61–90 days', 'Over 90 days'])
    expect(sum(a.buckets.map((b) => b.amount)).eq(a.total)).toBe(true)
    expect(a.overdue.length).toBeGreaterThanOrEqual(2)
    const requested = adv.find((x) => x.status === 'requested')!
    const facts = advanceMemory(adv, claims, requested.recipient_party_id, TODAY, requested.id)
    expect(facts[0].text).toMatch(/has 60,000\.00 unsettled\. No supporting claim or receipt has been attached\./)
    expect(facts.some((f) => f.kind === 'late_settlement')).toBe(true)
    expect(advanceMemory(adv, claims, 'nobody', TODAY)[0].kind).toBe('none')
    for (const f of facts) expect(f.text).not.toMatch(/fraud|suspicious|misuse/i)
  })
  it('people cost: salary is not the whole cost, and shared costs are not invented', async () => {
    const lines = await e.ledgerLines({ company_ids: ids, limit: 1000, from: addMonths(TODAY, -3) })
    const pc = peopleCost(await e.listPayrollRuns(ids), await e.getPayrollLines({ companyIds: ids }), await e.listEmployees(ids), e.parties, lines.rows)
    expect(pc.totals.headcount).toBe(9)
    expect(pc.totals.salary.toNumber()).toBe(2110000)
    expect(pc.totals.variable.toNumber()).toBe(117000)
    expect(pc.totals.employer.toNumber()).toBe(126600)
    expect(pc.totals.total.eq(pc.totals.salary.plus(pc.totals.variable).plus(pc.totals.employer).plus(pc.totals.direct))).toBe(true)
    expect(pc.notes.join(' ')).toMatch(/not allocated/)
    expect(pc.notes.join(' ')).toMatch(/not a measure of any person's performance/)
  })
  it('new-hire cost model', () => {
    const c = newHireCost({ monthlySalary: 100000, employerPct: 12, recruitmentFee: 80000, equipment: 90000, softwareMonthly: 2500, count: 20 })
    expect(c.perPerson.toNumber()).toBe(1200000 + 144000 + 30000 + 170000)
    expect(c.total.toNumber()).toBe(c.perPerson.toNumber() * 20)
  })
  it('loan position and debt ladder', async () => {
    const loans = await e.listLoans(ids)
    const sched = await e.listLoanSchedule({ companyIds: ids })
    const van = loans.find((l) => l.kind === 'vehicle_loan')!
    const p = loanPosition(van, sched, TODAY)
    expect(p.totalInstalments).toBe(36)
    expect(p.paidInstalments).toBeGreaterThanOrEqual(4)
    expect(p.outstanding.eq(D(2400000).minus(van.principal_repaid))).toBe(true)
    expect(p.next!.status).toBe('due')
    const ladder = debtLadder(loans, sched, TODAY)
    expect(sum(ladder.map((b) => b.principal)).eq(p.outstanding)).toBe(true)
  })
  it('depreciation forecast follows the recorded method', async () => {
    const assets = await e.listAssets(ids)
    const van = assets.find((a) => a.method === 'wdv')!
    const f = depreciationForecast(van, startOfMonth(TODAY), 12)
    expect(f).toHaveLength(12)
    expect(f[0].amount.gt(f[11].amount)).toBe(true) // written-down value declines
    const slm = depreciationForecast(assets.find((a) => a.method === 'slm')!, startOfMonth(TODAY), 3)
    expect(slm[0].amount.eq(slm[2].amount)).toBe(true)
  })
  it('quotation comparison marks the lowest and does not choose', async () => {
    const docs = await Promise.all((await e.listPurchaseDocs({ companyIds: ids, kinds: ['quotation'] })).map((q) => e.getPurchaseDoc(q.id)))
    const c = compareQuotations(docs)
    expect(c.quotes).toHaveLength(2)
    expect(c.quotes.filter((q) => q.isLowest)).toHaveLength(1)
    expect(c.quotes.find((q) => q.isLowest)!.quote.status).toBe('not_selected') // the person chose the other one
    expect(c.note).toMatch(/made by a person/)
  })
})

// =====================================================================
// Corrections found when every requirement was reviewed against the code.
// =====================================================================
describe('corrections from the requirement review', () => {
  const next = addDays(TODAY, 10)
  const bill = (o: Partial<Invoice>): Invoice => ({
    id: 'b1', company_id: 'c', doc_type: 'purchase_bill', doc_no: 'BILL-1', party_id: 'landlord', doc_date: addDays(next, -3), due_date: addDays(next, 20), currency: 'INR', fx_rate: '1',
    subtotal: '1000000', tax_total: '0', total: '1000000', amount_settled: '0', status: 'open', reference: null, narration: null, journal_id: null, created_by: null, created_at: '', ...o,
  } as Invoice)

  it('a scheduled occurrence that has already been billed is not counted twice', () => {
    const rent = item({ party_id: 'landlord', next_due: next, start_date: next })
    const without = buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [rent] })
    expect(without.events.filter((e) => e.source === 'register')).toHaveLength(1)
    expect(without.covered).toHaveLength(0)

    const withBill = buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [rent], invoices: [bill({})] })
    expect(withBill.events.filter((e) => e.source === 'register')).toHaveLength(0)
    expect(withBill.events.filter((e) => e.source === 'bill')).toHaveLength(1)
    expect(withBill.covered).toEqual([{ item_id: 'r1', ref_no: 'RNT-00001', title: 'Rent', date: next, invoice_id: 'b1', doc_no: 'BILL-1' }])
    expect(sum(withBill.events.map((e) => e.amount)).toNumber()).toBe(1000000)
  })
  it('a bill from another party, a cancelled bill or a bill of another period covers nothing', () => {
    const rent = item({ party_id: 'landlord', next_due: next, start_date: next })
    for (const other of [bill({ party_id: 'someone-else' }), bill({ status: 'cancelled' }), bill({ doc_date: addDays(next, -40), due_date: addDays(next, -10) }), bill({ doc_type: 'sales_invoice' })]) {
      const f = buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [rent], invoices: [other] })
      expect(f.covered, other.id + other.status).toHaveLength(0)
      expect(f.events.filter((e) => e.source === 'register')).toHaveLength(1)
    }
  })
  it('a guarantee given is contingent: beside the projection, never inside it', () => {
    const g = item({ id: 'g1', kind: 'bank_guarantee', ref_no: 'BG-00001', title: 'Performance guarantee', direction: 'none', certainty: 'contingent', frequency: 'once', amount: '12000000', end_date: addDays(TODAY, 200), next_due: null, start_date: null })
    const ev = buildEvents({ asOf: TODAY, until: addDays(TODAY, 365), registerItems: [g] })
    expect(ev).toHaveLength(1)
    expect([ev[0].certainty, ev[0].direction, ev[0].amount.toNumber(), ev[0].date]).toEqual(['CONTINGENT', 'out', 12000000, addDays(TODAY, 200)])
    const year = cashHorizon(ev, 5000000, TODAY).find((x) => x.key === '12m')!
    expect(year.projected.toNumber()).toBe(5000000)
    expect(year.contingent.toNumber()).toBe(12000000)
    // an item with no direction that is not contingent moves no money
    expect(buildEvents({ asOf: TODAY, until: addDays(TODAY, 365), registerItems: [{ ...g, certainty: 'expected' }] })).toHaveLength(0)
  })
  it('records that carry no exchange rate say which currency they are in', () => {
    const ev = buildEvents({ asOf: TODAY, until: addDays(TODAY, 40), registerItems: [item({ currency: 'USD', next_due: next, start_date: next })] })
    expect(ev[0].currency).toBe('USD')
    expect(ev[0].amount.toNumber()).toBe(1000000) // face value: not converted, and the screen says so
  })
  it('notices rise at 60, 30 and 7 days (spec 712)', () => {
    const at = (days: number) => earlyWarnings({ asOf: TODAY, until: addDays(TODAY, 400), events: [], openingCash: 0, registerItems: [item({ kind: 'insurance', frequency: 'yearly', renewal_date: addDays(TODAY, days), next_due: addDays(TODAY, 300), start_date: null })] })
      .find((w) => w.date === addDays(TODAY, days))?.level
    expect([at(85), at(55), at(25), at(5), at(-2)]).toEqual(['info', 'review', 'priority', 'critical', 'critical'])
  })
  it('dependence on one vendor is stated beside dependence on one customer', () => {
    const ev = buildEvents({ asOf: TODAY, until: addDays(TODAY, 60), invoices: [bill({ id: 'b1', party_id: 'v1', total: '900000', subtotal: '900000' }), bill({ id: 'b2', party_id: 'v2', doc_no: 'BILL-2', total: '100000', subtotal: '100000' })] })
    const w = earlyWarnings({ asOf: TODAY, until: addDays(TODAY, 60), events: ev, openingCash: 5000000, partyName: (id) => (id === 'v1' ? 'Steelmax' : 'Other') })
    const c = w.find((x) => x.kind === 'payable_concentration')!
    expect(c.title).toBe('90% of recorded payables are owed to Steelmax')
    expect(c.title + c.detail).not.toMatch(/fraud|suspicious|risk of/i)
  })
  it('an instalment partly recovered through payroll is projected for what remains', () => {
    const loan = { id: 'l1', company_id: 'c', loan_no: 'LN-1', name: 'Staff loan', direction: 'lent', party_id: 'p', status: 'active', rate_type: 'fixed', currency: 'INR', disbursed_amount: '60000', principal_repaid: '5000' } as unknown as Loan
    const s = { id: 's1', loan_id: 'l1', company_id: 'c', instalment_no: 1, due_date: next, opening_principal: '60000', principal: '10000', interest: '0', total: '10000', closing_principal: '50000', recovered: '5000', status: 'due', journal_id: null, paid_on: null } as LoanInstalment
    const ev = buildEvents({ asOf: TODAY, until: addDays(TODAY, 40), loans: [loan], loanSchedule: [s] })
    expect(ev[0].amount.toNumber()).toBe(5000)
    expect(ev[0].basis).toMatch(/after 5,000.00 recovered through payroll/)
    expect(loanPosition(loan, [s], TODAY).dueIn30.toNumber()).toBe(5000)
  })
  it('people cost follows the department recorded on the payroll line, not the person\'s present department', () => {
    const employees = [{ id: 'e1', company_id: 'c', party_id: 'p1', emp_no: 'EMP-1', department_id: 'NEW', employment_type: 'permanent' }] as unknown as Employee[]
    const runs = [{ id: 'r1', company_id: 'c', status: 'posted', period_month: '2026-01-01' }] as unknown as PayrollRun[]
    const lines = [{ id: 'x', run_id: 'r1', company_id: 'c', employee_id: 'e1', party_id: 'p1', department_id: 'OLD', components: [{ name: 'Basic', kind: 'earning', type: 'fixed', amount: '50000' }, { name: 'PF', kind: 'employer', amount: '6000' }] }] as unknown as PayrollLine[]
    const cost = peopleCost(runs, lines, employees, [])
    expect(cost.byDepartment).toEqual([{ department_id: 'OLD', headcount: 1, total: D(56000), salary: D(50000) }])
    expect(cost.totals.total.toNumber()).toBe(56000)
  })
})

describe('second review of the corrections', () => {
  it('only the bill itself stands for the period: a debit note or a credit note covers nothing', () => {
    const next = addDays(TODAY, 10)
    const rent = item({ party_id: 'landlord', next_due: next, start_date: next })
    const doc = (doc_type: string) => ({ id: 'n1', company_id: 'c', doc_type, doc_no: 'DN-1', party_id: 'landlord', doc_date: addDays(next, -2), due_date: addDays(next, 5), currency: 'INR', fx_rate: '1', subtotal: '5000', tax_total: '0', total: '5000', amount_settled: '0', status: 'open' } as unknown as Invoice)
    for (const t of ['debit_note', 'credit_note', 'sales_invoice']) {
      const f = buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [rent], invoices: [doc(t)] })
      expect(f.covered, t).toHaveLength(0)
      expect(f.events.filter((e) => e.source === 'register'), t).toHaveLength(1)
    }
    expect(buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [rent], invoices: [doc('purchase_bill')] }).covered).toHaveLength(1)
    // income: a rent we receive is covered by the sales invoice, not by the landlord's bill
    const income = item({ party_id: 'landlord', direction: 'in', next_due: next, start_date: next })
    expect(buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [income], invoices: [doc('sales_invoice')] }).covered).toHaveLength(1)
    expect(buildForward({ asOf: TODAY, until: addDays(TODAY, 35), registerItems: [income], invoices: [doc('purchase_bill')] }).covered).toHaveLength(0)
  })
})
