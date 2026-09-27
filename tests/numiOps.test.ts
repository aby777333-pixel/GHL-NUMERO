import { beforeAll, describe, expect, it } from 'vitest'
import type { DemoEngine } from '../src/api/demo'
import type { NumeroApi } from '../src/api/types'
import { getDemoEngine } from '../src/api/demoSeed'
import { askNumi, contextualPrompts, type NumiContext } from '../src/numi/engine'
import { loadForward } from '../src/lib/forwardData'
import { advanceAgeing, loanPosition } from '../src/engine/ops'
import { openCommitments } from '../src/engine/forward'
import { interpret } from '../src/voice/commands'
import { workflowSource } from '../src/lib/workflow'
import { D, fmtMoney, sum } from '../src/lib/money'
import { resolvePeriod, today } from '../src/lib/dates'

// =====================================================================
// NUMI and the command bar on operations (phase 2).
// The properties that matter:
//   * answers come from records and agree with the engines, figure for figure
//   * anything that is not ACTUAL says what it is
//   * a refusal by the data layer is reported as a refusal, never worked around
//   * NUMI never states what an individual is paid
//   * a command can open a screen; it can never release, pay or approve
// =====================================================================

let e: DemoEngine
const money = (v: Parameters<typeof fmtMoney>[0], compact = true) => fmtMoney(v, { currency: 'INR', compact })
const ctx = (api: NumeroApi = e, can?: NumiContext['can']): NumiContext => ({
  api, companies: e.companies, accounts: e.accounts, parties: e.parties, scopeIds: [], period: resolvePeriod('fy', 4), screen: '/', money, can,
})
/** a person whose role lacks some permissions, in every company or only in some */
const lacking = (perms: string[], inCompany?: (id: string) => boolean): NumiContext['can'] => (perm, id) => !(perms.includes(perm) && (!inCompany || !id || inCompany(id)))
const ids = () => e.companies.filter((c) => c.status === 'active').map((c) => c.id)
/** the same engine, with some calls refused the way the database refuses a person without the permission */
const without = (...methods: string[]): NumeroApi => new Proxy(e, {
  get(target, key, receiver) {
    if (typeof key === 'string' && methods.includes(key)) return () => Promise.reject(new Error('NUMERO: you are not authorised.'))
    const v = Reflect.get(target, key, receiver)
    return typeof v === 'function' ? v.bind(target) : v
  },
}) as unknown as NumeroApi

beforeAll(async () => { e = await getDemoEngine(); e.actor = 'demo-owner' })

describe('NUMI answers from the operations records', () => {
  it('advances: the total agrees with the ageing engine and is not called an expense', async () => {
    const a = await askNumi('Who holds unsettled advances?', ctx())
    const age = advanceAgeing(await e.listAdvances({ companyIds: ids() }), today())
    expect(a.intent).toBe('advances')
    expect(age.count).toBeGreaterThan(0)
    expect(a.headline).toContain(money(age.total, false))
    expect(a.narrative).toMatch(/not an expense/)
    expect(a.truth).toBe('ACTUAL')
    expect(a.facts.some((f) => f.to?.startsWith('/expenses/advances/'))).toBe(true)
  })

  it('advances overdue: lists only those past the settlement date', async () => {
    const a = await askNumi('Which advances are overdue?', ctx())
    const age = advanceAgeing(await e.listAdvances({ companyIds: ids() }), today())
    expect(a.intent).toBe('advances')
    expect(age.overdue.length).toBeGreaterThan(0)
    expect(a.headline).toContain(money(sum(age.overdue.map((x) => D(x.released_amount).minus(x.settled_amount).minus(x.returned_amount))), false))
  })

  it('advance memory for a named person states facts, not conclusions', async () => {
    const adv = (await e.listAdvances({ companyIds: ids() })).find((x) => D(x.released_amount).gt(x.settled_amount))!
    const name = e.parties.find((p) => p.id === adv.recipient_party_id)!.display_name
    const a = await askNumi(`Show the advances of ${name}`, ctx())
    expect(a.intent).toBe('advance_memory')
    expect(a.headline).toContain(name)
    expect(JSON.stringify(a)).not.toMatch(/fraud|suspicious|misuse|misconduct/i)
    expect(a.assumptions.join(' ')).toMatch(/not a conclusion/)
  })

  it('commitments are labelled COMMITTED and agree with the engine', async () => {
    const a = await askNumi('How much is committed on purchase orders?', ctx())
    const open = openCommitments(await e.listPurchaseDocs({ companyIds: ids() }), await e.listInvoices({ companyIds: ids(), docTypes: ['purchase_bill'] }))
    expect(a.intent).toBe('commitments')
    expect(a.truth).toBe('COMMITTED')
    expect(open.length).toBeGreaterThan(0)
    expect(a.headline).toContain(money(sum(open.map((o) => o.openBase)), false))
    expect(a.narrative).toMatch(/commitment, not a cost/)
  })

  it('debt: principal outstanding agrees with the loan schedule', async () => {
    const a = await askNumi('How much debt do we have?', ctx())
    const loans = (await e.listLoans(ids())).filter((l) => l.status === 'active' && l.direction === 'borrowed')
    const schedule = await e.listLoanSchedule({ companyIds: ids() })
    expect(a.intent).toBe('debt')
    expect(loans.length).toBeGreaterThan(0)
    expect(a.headline).toContain(money(sum(loans.map((l) => loanPosition(l, schedule, today()).outstanding)), false))
  })

  it('deposits under lien are said to be not freely available', async () => {
    const a = await askNumi('Show fixed deposits', ctx())
    expect(a.intent).toBe('deposits')
    expect(a.narrative).toMatch(/under lien and is not freely available/)
    expect(a.assumptions.join(' ')).toMatch(/confirmed only by the bank/)
  })

  it('assets: book value comes from the register', async () => {
    const a = await askNumi('What is the book value of our assets?', ctx())
    const assets = (await e.listAssets(ids())).filter((x) => x.status === 'active')
    expect(a.intent).toBe('assets')
    expect(a.headline).toContain(money(sum(assets.map((x) => D(x.cost).minus(x.accumulated_depreciation))), false))
  })
})

describe('NUMI and payroll privacy', () => {
  it('gives totals and never names a person', async () => {
    const a = await askNumi('What was the payroll cost last month?', ctx())
    expect(a.intent).toBe('payroll')
    expect(a.narrative).toMatch(/no individual salary/)
    const employees = new Set((await e.listEmployees(ids())).map((x) => e.parties.find((p) => p.id === x.party_id)?.display_name).filter(Boolean))
    expect(employees.size).toBeGreaterThan(0)
    for (const n of employees) expect(JSON.stringify(a)).not.toContain(n)
  })

  it('declines to state what an individual is paid, even for a person who may see payroll', async () => {
    const emp = (await e.listEmployees(ids()))[0]
    const name = e.parties.find((p) => p.id === emp.party_id)!.display_name
    for (const q of [`What is the salary of ${name}?`, `How much does ${name} earn in salary?`, 'Who is the highest paid in payroll?']) {
      const a = await askNumi(q, ctx())
      expect(a.intent, q).toBe('payroll_private')
      expect(a.facts, q).toHaveLength(0)
    }
  })

  it('reports a refusal as a refusal and does not say whether records exist', async () => {
    const a = await askNumi('What was the payroll cost last month?', ctx(without('listPayrollRuns')))
    expect(a.headline).toBe('You are not authorised to see payroll.')
    expect(a.facts).toHaveLength(0)
    expect(a.narrative).toMatch(/cannot say whether such records exist/)
  })

  it('an empty answer from the database is never read as "none exist"', async () => {
    // the live database returns no rows to a person without the permission: the data layer raises no error
    const silent = new Proxy(e, { get(target, key, receiver) {
      if (['listPayrollRuns', 'listAdvances', 'listClaims', 'listLoans', 'listLoanSchedule', 'listFixedDeposits', 'listAssets', 'listPurchaseDocs'].includes(String(key))) return () => Promise.resolve([])
      const v = Reflect.get(target, key, receiver); return typeof v === 'function' ? v.bind(target) : v
    } }) as unknown as NumeroApi
    const cases: [string, string[], RegExp][] = [
      ['What was the payroll cost last month?', ['payroll.view'], /not authorised to see payroll/],
      ['Who holds unsettled advances?', ['expense.view', 'expense.approve', 'expense.create'], /not authorised to see advances/],
      ['Which expense claims are waiting?', ['expense.view', 'expense.approve', 'expense.create'], /not authorised to see expense claims/],
      ['How much debt do we have?', ['treasury.view'], /not authorised to see loans/],
      ['Show fixed deposits', ['treasury.view'], /not authorised to see fixed deposits/],
      ['What is the book value of our assets?', ['asset.view'], /not authorised to see the fixed asset register/],
      ['Show open commitments', ['purchase.view'], /not authorised to see purchasing/],
    ]
    for (const [q, perms, re] of cases) {
      const a = await askNumi(q, ctx(silent, lacking(perms)))
      expect(a.headline, q).toMatch(re)
      expect(a.headline, q).not.toMatch(/^No |is empty|No active/)
      expect(a.facts, q).toHaveLength(0)
    }
  })

  it('a permission held in some companies only: the answer covers those and says what is left out', async () => {
    const jb = e.companies.find((x) => x.code === 'JB')!.id
    const a = await askNumi('Who holds unsettled advances?', ctx(e, lacking(['expense.view', 'expense.approve', 'expense.create'], (id) => id !== jb)))
    expect(a.intent).toBe('advances')
    expect(a.assumptions.join(' ')).toMatch(/of the \d+ selected companies are not included: your role there does not include expense\.view/)
  })

  it('a person who may enter expenses but not view them is told the answer covers only their own records', async () => {
    const a = await askNumi('Who holds unsettled advances?', ctx(e, lacking(['expense.view', 'expense.approve'])))
    expect(a.intent).toBe('advances')
    expect(a.assumptions.join(' ')).toMatch(/only the records you entered yourself are counted/)
    const none = await askNumi('Who holds unsettled advances?', ctx(e, lacking(['expense.view', 'expense.approve', 'expense.create'])))
    expect(none.headline).toMatch(/not authorised to see advances/)
  })

  it('does the same for advances, loans and purchasing', async () => {
    expect((await askNumi('Who holds unsettled advances?', ctx(without('listAdvances')))).headline).toMatch(/not authorised to see advances/)
    expect((await askNumi('How much debt do we have?', ctx(without('listLoans')))).headline).toMatch(/not authorised to see loans/)
    expect((await askNumi('Show open commitments', ctx(without('listPurchaseDocs')))).headline).toMatch(/not authorised to see purchasing/)
  })
})

describe('NUMI looking ahead', () => {
  it('a projection is labelled FORECAST and INFERENCE, and starts from ACTUAL cash', async () => {
    const a = await askNumi('How much cash will we have in 30 days?', ctx())
    const f = await loadForward(e, ids(), e.accounts)
    expect(a.intent).toBe('cash_ahead')
    expect(a.truth).toBe('FORECAST')
    expect(a.basis).toBe('INFERENCE')
    expect(a.facts[0].label).toMatch(/ACTUAL/)
    expect(D(a.facts[0].amount!).eq(f.openingCash)).toBe(true)
    expect(f.openingCash.gt(0)).toBe(true)
    expect(a.narrative).toMatch(/not a prediction/)
    expect(a.speak).toMatch(/forecast/i)
  })

  it('firm and uncertain amounts are never added into one unlabelled figure', async () => {
    const a = await askNumi('What is coming in the next 60 days?', ctx())
    const labels = a.facts.map((f) => f.label)
    expect(labels.some((l) => /Inflows.*firm/.test(l))).toBe(true)
    expect(labels.some((l) => /expected, probable or possible/.test(l))).toBe(true)
    expect(a.scope).toMatch(/today to/)
  })

  it('contingent exposure is shown beside the projection, not inside it', async () => {
    const a = await askNumi('How much cash will we have in 365 days?', ctx())
    const c = a.facts.find((f) => /CONTINGENT/.test(f.label))
    expect(c).toBeTruthy()
    expect(c!.label).toMatch(/not in the projection/)
  })

  it('names the sources it could not read instead of pretending to be complete', async () => {
    const f = await loadForward(without('listPayrollRuns', 'listLoans', 'listLoanSchedule'), ids(), e.accounts)
    expect(f.missing).toContain('payroll')
    expect(f.missing).toContain('loans')
    expect(f.events.some((x) => x.source === 'payroll' || x.source === 'loan')).toBe(false)
    const a = await askNumi('How much cash will we have in 30 days?', ctx(without('listPayrollRuns')))
    expect(a.assumptions.join(' ')).toMatch(/Not included, because your account may not read them in every selected company: payroll/)
  })

  it('names a source the person holds no permission for, even when the database is silent', async () => {
    const f = await loadForward(e, ids(), e.accounts, 1826, lacking(['payroll.view', 'treasury.view']))
    expect(f.missing).toEqual(expect.arrayContaining(['payroll', 'loans', 'fixed deposits']))
    expect(f.events.some((x) => ['payroll', 'loan', 'deposit'].includes(x.source))).toBe(false)
    const full = await loadForward(e, ids(), e.accounts, 1826, () => true)
    expect(full.missing).toEqual([])
    expect(full.events.length).toBeGreaterThan(f.events.length)
  })

  it('renewals and expiries come from recorded dates', async () => {
    const a = await askNumi('Which renewals are coming up?', ctx())
    expect(a.intent).toBe('renewals')
    expect(a.facts.length).toBeGreaterThan(0)
  })
})

describe('existing answers are not taken over', () => {
  it('a question about why a figure changed is still a comparison', async () => {
    for (const q of ['Why did salary expense increase?', 'Why did depreciation change?', 'Compare loans this quarter with last quarter']) {
      const a = await askNumi(q, ctx())
      expect(['payroll', 'assets', 'debt'], q).not.toContain(a.intent)
    }
  })
  it('cash, receivables and approvals answer as before', async () => {
    expect((await askNumi('How much cash do we have across the group?', ctx())).intent).toBe('cash')
    expect((await askNumi('Which company owes us the most money?', ctx())).intent).toMatch(/receivable/)
    expect((await askNumi('What requires approval?', ctx())).intent).toBe('approvals')
  })
  it('the operations screens suggest their own questions', () => {
    expect(contextualPrompts('/expenses')).toContain('Who holds unsettled advances?')
    expect(contextualPrompts('/treasury/loans/x')).toContain('How much debt do we have?')
    expect(contextualPrompts('/reports/pnl')).toContain('Why did expenses increase?')
  })
})

describe('commands on operations', () => {
  const run = (t: string) => interpret(t, e.companies)
  const nav: [string, string][] = [
    ['open expenses', '/expenses'],
    ['show expense claims', '/expenses'],
    ['new expense claim', '/expenses/claims/new'],
    ['show unsettled advances', '/expenses?tab=unsettled'],
    ['open advances', '/expenses?tab=advances'],
    ['open purchase orders', '/purchasing'],
    ['show open commitments', '/purchasing?tab=commitments'],
    ['open petty cash', '/cash'],
    ['show fund transfers', '/cash?tab=transfers'],
    ['open treasury', '/treasury'],
    ['show loans', '/treasury?tab=loans'],
    ['show fixed deposits', '/treasury?tab=deposits'],
    ['open fixed assets', '/assets'],
    ['open the asset register', '/assets'],
    ['show depreciation', '/assets?tab=depreciation'],
    ['open payroll', '/payroll'],
    ['show people cost', '/people-cost'],
    ['open registers', '/registers'],
    ['show insurance', '/registers'],
    ['show follow-ups', '/tasks'],
    ['open the document inbox', '/inbox'],
    ['open account mapping', '/accounts?tab=mapping'],
    // earlier routes keep their meaning
    ['record expense', '/entry'],
    ['show approvals', '/approvals'],
    ['open purchase bills', '/bills'],
    ['open people', '/parties'],
    ['open the requirement ledger', '/requirements'],
  ]
  for (const [said, to] of nav) {
    it(`"${said}" opens ${to}`, () => {
      const r = run(said)
      expect(r.command).toMatchObject({ type: 'navigate', to })
      expect(r.sensitive).toBe(false)
    })
  }

  const sensitive: [string, string][] = [
    ['release the advance to Ravi', '/expenses?tab=advances'],
    ['release 50,000 advance for the site visit', '/expenses?tab=advances'],
    ['settle the advance', '/expenses?tab=advances'],
    ['reimburse the claim', '/expenses?tab=claims'],
    ['pay the reimbursement', '/expenses?tab=claims'],
    ['run payroll for this month', '/payroll'],
    ['dispose the old asset', '/assets'],
    ['repay the loan', '/treasury'],
    ['break the fixed deposit', '/treasury'],
    ['place the purchase order', '/purchasing'],
    ['select the vendor with the lowest quotation', '/purchasing'],
    ['approve the purchase order', '/approvals'],
    ['approve the advance', '/approvals'],
    ['pay salaries', '/payments'],
  ]
  for (const [said, to] of sensitive) {
    it(`"${said}" is never executed`, () => {
      const r = run(said)
      expect(r.sensitive).toBe(true)
      expect(r.command).toMatchObject({ type: 'sensitive', to })
      expect(r.reply).toMatch(/cannot .* from a command alone/)
    })
  }
})

describe('where a proposed entry came from', () => {
  it('every workflow source the engine uses has a label, a rule and a link', async () => {
    const postings = await e.listWorkflowPostings({ companyIds: ids() })
    expect(postings.length).toBeGreaterThan(10)
    for (const w of postings) {
      const s = workflowSource(w)
      expect(s.rule, w.source).not.toBe('Prepared by an operation')
      expect(s.to, w.source).toBeTruthy()
    }
  })
  it('an unknown source is described honestly instead of guessed', () => {
    const s = workflowSource({ source: 'something_new', source_id: 'x', payload: {} })
    expect(s.label).toBe('something new')
    expect(s.to).toBeNull()
  })
})

describe('the wording of the specification\'s own example questions', () => {
  const cases: [string, string][] = [
    ['How much money did we make this week?', 'profit'],
    ['How much money do we actually have?', 'cash'],
    ['Show consolidated P&L', 'profit'],
    ['Show unreconciled transactions', 'integrity'],
    ['Show audit exceptions', 'anomalies'],
    ['Explain working capital', 'balance_sheet'],
    ['Compare actual with budget', 'budget'],
    ['How much cash will we likely need next month?', 'cash_ahead'],
    ['Which contracts renew next month?', 'renewals'],
    ['How much of the purchase budget is uncommitted?', 'commitments'],
  ]
  for (const [q, intent] of cases) {
    it(`"${q}" is answered (${intent})`, async () => {
      const a = await askNumi(q, ctx())
      expect(a.intent).toBe(intent)
      expect(a.headline).not.toMatch(/cannot answer/)
    })
  }
  it('"this week" is the week, not the financial year', async () => {
    const a = await askNumi('How much money did we make this week?', ctx())
    expect(a.scope).toMatch(/This week/)
  })
  it('"where did the money go" is answered from spending, never invented', async () => {
    const a = await askNumi('Show me where ₹10 crore went', ctx())
    expect(a.intent).not.toBe('unknown')
    expect(a.evidence.length).toBeGreaterThan(0)
  })
  it('a narrower question gets the narrower figure: fuel is not the whole of travel', async () => {
    const fuel = await askNumi('How much did we spend on fuel?', ctx())
    const travel = await askNumi('How much did we spend on travel?', ctx())
    expect(fuel.headline).toMatch(/Fuel/)
    expect(travel.headline).toMatch(/Travel/)
    expect(fuel.headline).not.toBe(travel.headline)
  })
})

describe('whole words only', () => {
  it('"profit" is not read as "it", nor "loads" as "ads"', async () => {
    const a = await askNumi('Why did profit fall?', ctx())
    expect(a.headline).not.toMatch(/Technology/)
    expect(JSON.stringify(a.facts)).not.toMatch(/Technology spending/)
    const b = await askNumi('How much did we spend on truck loads?', ctx())
    expect(b.headline).not.toMatch(/Marketing/)
  })
  it('a question about overspending is a budget question', async () => {
    expect((await askNumi('Which department overspent?', ctx())).intent).toBe('budget')
    expect((await askNumi('Which budget lines are overspent?', ctx())).intent).toBe('budget')
  })
  it('a question that names a category still finds it', async () => {
    expect((await askNumi('How much did we spend on IT this year?', ctx())).headline).toMatch(/Technology/)
    expect((await askNumi('How much did we spend on marketing?', ctx())).headline).toMatch(/Marketing/)
  })
})
