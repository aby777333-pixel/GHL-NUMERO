import { beforeAll, describe, expect, it } from 'vitest'
import type { DemoEngine } from '../src/api/demo'
import type { NumeroApi } from '../src/api/types'
import { getDemoEngine } from '../src/api/demoSeed'
import { askNumi, contextualPrompts, type NumiContext } from '../src/numi/engine'
import { shocksFrom, unread } from '../src/numi/p3'
import { interpret } from '../src/voice/commands'
import { capabilityOn, CAPABILITIES } from '../src/engine/features'
import { exposureTotals, lossExposure, postedLoss, reorderList, stockAgainstBooks } from '../src/engine/stock'
import { fundSummary } from '../src/engine/invest'
import { simulate, SIMULATION, standardCases } from '../src/engine/twin'
import { loadTwin } from '../src/lib/twinData'
import { loadReality } from '../src/lib/realityData'
import { BUILD, buildSandbox } from '../src/lib/sandbox'
import { workflowSource, APPROVAL_ENTITIES } from '../src/lib/workflow'
import type { FeatureFlag } from '../src/engine/p3Types'
import { D, fmtMoney, sum } from '../src/lib/money'
import { addDays, resolvePeriod, today } from '../src/lib/dates'
import { readers } from '../src/api/paging'

// =====================================================================
// Phase 3 as the application uses it: the sample books, the loaders that
// feed the screens, NUMI, the command bar, the capability switches and
// the sandbox.
// The properties that matter:
//   * the stock ledger and the general ledger say the same value
//   * what is at stake in stock is never counted as loss
//   * a simulation is labelled as one and leaves the books as they were
//   * a source the person may not read is named, not silently left out
//   * a command can open a screen; it can never issue stock, pay a
//     distribution, commit an import or send a message
//   * the sandbox reads the books and never writes to them
// =====================================================================

let e: DemoEngine
const TODAY = today()
const money = (v: Parameters<typeof fmtMoney>[0], compact = true) => fmtMoney(v, { currency: 'INR', compact })
const ctx = (api: NumeroApi = e, can?: NumiContext['can']): NumiContext => ({
  api, companies: e.companies, accounts: e.accounts, parties: e.parties, scopeIds: [], period: resolvePeriod('fy', 4), screen: '/', money, can,
})
const lacking = (perms: string[], inCompany?: (id: string) => boolean): NumiContext['can'] => (perm, id) => !(perms.includes(perm) && (!inCompany || !id || inCompany(id)))
const ids = () => e.companies.filter((c) => c.status === 'active').map((c) => c.id)
const co = (code: string) => e.companies.find((c) => c.code === code)!.id
/** a fingerprint of the books: if anything was written, it changes */
const books = () => [e.journals.length, e.lines.length, e.audit.length, e.stockDocs.length, e.invMovements.length, e.approvalRequests.length, e.notifications.length, e.scenarioRuns.length].join('|')

beforeAll(async () => { e = await getDemoEngine(); e.actor = 'demo-owner' })

describe('the sample books after the phase 3 seed', () => {
  it('the stock ledger and the general ledger carry the same value, in both trading companies', async () => {
    const ledger = await e.ledgerBalances(ids(), '1990-01-01', TODAY)
    const rows = stockAgainstBooks(e.invItems, e.invCategories, ledger, e.accounts)
    expect(rows.length).toBe(2)
    for (const r of rows) { expect(r.stock.gt(1000000)).toBe(true); expect(r.difference.toString()).toBe('0') }
  })
  it('every item balance equals the sum of its posted movements', () => {
    for (const i of e.invItems) {
      const ms = e.invMovements.filter((m) => m.item_id === i.id && m.status === 'posted')
      expect(sum(ms.map((m) => m.qty)).toString(), i.sku).toBe(D(i.qty_on_hand).toString())
      expect(sum(ms.map((m) => m.value)).toDecimalPlaces(2).toString(), i.sku).toBe(D(i.value_on_hand).toDecimalPlaces(2).toString())
    }
  })
  it('goods bought after the stock ledger began were received against the bill, and the clearing ledgers are back at zero', async () => {
    const ledger = await e.ledgerBalances(ids(), '1990-01-01', TODAY)
    for (const code of ['GMED', 'GWELL']) for (const acc of ['2125', '2127']) {
      const a = e.accounts.find((x) => x.company_id === co(code) && x.code === acc)!
      const b = ledger.find((x) => x.account_id === a.id)
      const net = b ? D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit) : D(0)
      expect(net.abs().lt(0.01), `${code} ${acc} ${net}`).toBe(true)
    }
  })
  it('exposure is reported beside the loss that was posted, never inside it', async () => {
    const rows = await e.stockOnHand(ids())
    const ex = lossExposure(e.invItems, rows, e.invLots, e.invHolds, TODAY)
    const kinds = exposureTotals(ex).map((x) => x.kind)
    expect(kinds).toEqual(expect.arrayContaining(['expired', 'near_expiry', 'damaged', 'obsolete', 'quarantine']))
    const docs = await Promise.all(e.stockDocs.map((d) => e.getStockDoc(d.id)))
    const lost = postedLoss(docs, addDays(TODAY, -60), TODAY)
    expect(lost.length).toBeGreaterThan(0)
    // the expired lot awaits approval: it is exposure, and is not among the losses posted
    expect(lost.some((l) => l.reason === 'expiry')).toBe(false)
    expect(ex.find((x) => x.kind === 'expired')!.lot!.lot_no).toBe('HW-2291')
  })
  it('an item below its level is on the reorder list', async () => {
    expect(reorderList(e.invItems, await e.stockOnHand(ids())).some((r) => r.item.sku === 'PK-GIFT')).toBe(true)
  })
  it('the fund: what was called is owed, what was received became units, and the net asset value rests on the books of its own company', async () => {
    const f = e.funds[0]
    const s = fundSummary(f, e.commitments, e.navRuns)
    expect(s.committed.toNumber()).toBe(200000000)
    expect(s.called.toNumber()).toBe(80000000)
    expect(s.contributed.toNumber()).toBe(71750000)
    expect(s.outstandingCalls.toNumber()).toBe(8250000)
    expect(D(f.units_outstanding).toNumber()).toBe(717500)
    expect(s.nav!.status).toBe('approved')
    const capital = e.accounts.find((a) => a.id === f.capital_account_id)!
    const b = (await e.ledgerBalances([f.company_id], '1990-01-01', TODAY)).find((x) => x.account_id === capital.id)!
    expect(D(b.opening_credit).plus(b.period_credit).minus(b.opening_debit).minus(b.period_debit).toNumber()).toBe(71750000)
  })
  it('what the sponsor paid into the fund is an investment in its own books, for the same amount', () => {
    const h = e.holdings.find((x) => x.investee_company_id === e.funds[0].company_id)!
    const sponsor = e.commitments.find((c) => D(c.committed_amount).eq(50000000))!
    expect(D(h.cost).toString()).toBe(D(sponsor.contributed_amount).toString())
    expect(D(h.income_received).toString()).toBe(D(sponsor.distributed_amount).toString())
  })
  it('the fee of the manager is owed on a ledger of its own, so open bills still equal what vendors are owed', async () => {
    const f = e.funds[0]
    const fees = e.fundFees.filter((x) => x.status === 'posted')
    expect(fees.length).toBe(2)
    const payable = e.accounts.find((a) => a.company_id === f.company_id && a.code === '2129')!
    const b = (await e.ledgerBalances([f.company_id], '1990-01-01', TODAY)).find((x) => x.account_id === payable.id)!
    expect(D(b.period_credit).plus(b.opening_credit).toString()).toBe(sum(fees.map((x) => x.amount)).toString())
  })
  it('every workflow source and every approval entity the sample uses has a label, a rule and a link', async () => {
    for (const w of await e.listWorkflowPostings({ companyIds: ids() })) expect(workflowSource(w).to, w.source).toBeTruthy()
    for (const r of e.approvalRequests.filter((x) => x.entity !== 'journal')) expect(APPROVAL_ENTITIES[r.entity], r.entity).toBeTruthy()
  })
  it('a saved simulation is labelled as one and cannot be changed', () => {
    expect(e.scenarioRuns.length).toBeGreaterThan(0)
    for (const r of e.scenarioRuns) { expect(r.label).toBe(SIMULATION); expect(Object.isFrozen(r)).toBe(true) }
  })
  it('notices of approvals decided long ago were not left unread', () => {
    const waiting = new Set(e.approvalRequests.filter((r) => r.status === 'pending').map((r) => r.id))
    for (const n of e.notifications.filter((x) => !x.read_at && x.dedupe_key.startsWith('approval:'))) expect(waiting.has(n.dedupe_key.slice(9))).toBe(true)
  })
})

describe('the loaders behind the screens', () => {
  it('the twin starts from the books: cash and receivables are those of the balance sheet', async () => {
    const before = books()
    const t = await loadTwin(e, e.companies, e.accounts, ids())
    expect(t.missing).toEqual([])
    expect(t.base.basisMonths).toBe(6)
    expect(t.base.revenue).toBeGreaterThan(1000000)
    expect(t.base.cash).toBeGreaterThan(1000000)
    // cash, what customers owe and what vendors are owed are the balances of their ledgers today, to the rupee
    const bal = await e.ledgerBalances(ids(), '1990-01-01', TODAY)
    const of = (pick: (a: (typeof e.accounts)[number]) => boolean) => Math.round(bal.filter((b) => { const a = e.accounts.find((x) => x.id === b.account_id); return !!a && pick(a) })
      .reduce((s, b) => s.plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), D(0)).toNumber())
    expect(Math.round(t.base.cash)).toBe(of((a) => a.control_type === 'bank' || a.control_type === 'cash'))
    expect(Math.round(t.base.receivables)).toBe(of((a) => a.control_type === 'receivable'))
    expect(Math.round(t.base.payables)).toBe(-of((a) => a.control_type === 'payable'))
    expect(t.base.customers.length).toBeGreaterThan(3)
    expect(t.base.debt).toBeGreaterThan(0)
    // the term loan is in the ledger without a schedule in the loan register: the model says so instead of inventing repayments
    expect(t.base.notes.some((n) => /without a repayment schedule/.test(n))).toBe(true)
    expect(t.drivers.filter((d) => d.status === 'approved').length).toBe(3)
    expect(books()).toBe(before)
  })
  it('the twin names what it may not read', async () => {
    const t = await loadTwin(e, e.companies, e.accounts, ids(), { can: lacking(['invoice.view', 'payroll.view', 'treasury.view']) })
    expect(t.missing).toEqual(expect.arrayContaining(['sales invoices', 'employees', 'loans']))
    expect(t.base.customers).toEqual([])
    expect(t.base.headcount).toBeNull()
  })
  it('a simulation leaves the base and the books as they were', async () => {
    const before = books()
    const t = await loadTwin(e, e.companies, e.accounts, ids())
    const copy = JSON.stringify(t.base)
    const r = simulate(t.base, [{ kind: 'revenue_pct', value: -20, from_month: 1 }], 12, 'Revenue falls', t.drivers)
    expect(r.label).toBe(SIMULATION)
    expect(r.totals.closingCash).toBeLessThan(simulate(t.base, [], 12).totals.closingCash)
    expect(JSON.stringify(t.base)).toBe(copy)
    expect(books()).toBe(before)
  })
  it('reality: five separate counts, the differences the sample holds, and nothing written', async () => {
    const before = books()
    const r = await loadReality(e, e.accounts, ids())
    expect(r.health.map((h) => h.dimension)).toEqual(['document', 'operation', 'accounting', 'cash', 'physical'])
    expect(r.findings.some((f) => f.chain === 'asset' && /damaged/.test(f.title))).toBe(true)
    expect(r.findings.some((f) => f.chain === 'cash')).toBe(true)
    // the stock ledgers agree with the books, so stock is not among the differences
    expect(r.findings.some((f) => f.chain === 'stock')).toBe(false)
    for (const f of r.findings) expect(JSON.stringify(f).toLowerCase()).not.toContain('fraud')
    expect(r.missing).toEqual([])
    expect(books()).toBe(before)
  })
  it('reality names what it may not read, and does not count it as agreeing', async () => {
    const r = await loadReality(e, e.accounts, ids(), lacking(['inventory.view', 'asset.view']))
    expect(r.missing).toEqual(expect.arrayContaining(['stock items', 'fixed assets']))
    expect(r.findings.some((f) => f.chain === 'asset')).toBe(false)
    expect(r.health.find((h) => h.dimension === 'physical')!.checked).toBeLessThan((await loadReality(e, e.accounts, ids())).health.find((h) => h.dimension === 'physical')!.checked)
  })
})

describe('NUMI on stock, investments, reality and simulations', () => {
  it('stock: the value agrees with the stock ledger and with the books', async () => {
    const a = await askNumi('What is the value of our stock?', ctx())
    expect(a.intent).toBe('stock')
    expect(a.headline).toContain(money(sum(e.invItems.map((i) => i.value_on_hand)), false))
    expect(a.narrative).toMatch(/agrees with the books/)
    expect(a.truth).toBe('ACTUAL')
  })
  it('stock at risk is called exposure, and is said not to be a loss', async () => {
    const a = await askNumi('How much stock is at risk?', ctx())
    expect(a.intent).toBe('stock_exposure')
    expect(a.headline).toMatch(/^EXPOSURE/)
    expect(a.narrative).toMatch(/not what has been lost/)
    expect(a.truth).not.toBe('ACTUAL')
  })
  it('reorder is a suggestion: a person places the order', async () => {
    const a = await askNumi('Which items need to be reordered?', ctx())
    expect(a.intent).toBe('reorder')
    expect(a.basis).toBe('SUGGESTION')
    expect(a.facts.some((f) => /PK-GIFT/.test(f.label))).toBe(true)
  })
  it('a named item is answered from its own record', async () => {
    const a = await askNumi('How many patient monitor pm-12 are in stock?', ctx())
    expect(a.intent).toBe('stock_item')
    expect(a.headline).toContain(D(e.invItems.find((i) => i.sku === 'EQ-PM12')!.qty_on_hand).toString())
  })
  it('stock is refused to a person without the permission, whatever the records hold', async () => {
    const a = await askNumi('What is the value of our stock?', ctx(e, lacking(['inventory.view'])))
    expect(a.headline).toMatch(/not authorised/)
    expect(a.facts).toEqual([])
  })
  it('funds: commitments, contributions and what is called but not received', async () => {
    const a = await askNumi('How are our funds doing?', ctx())
    expect(a.intent).toBe('funds')
    expect(a.headline).toContain(money(200000000, false))
    expect(a.facts.some((f) => /called and not yet received/.test(f.label))).toBe(true)
    expect(a.facts.some((f) => /not a regulatory valuation/.test(f.note ?? ''))).toBe(true)
  })
  it('a transfer of funds is not a question about a fund', async () => {
    expect((await askNumi('Show fund transfers', ctx())).intent).not.toBe('funds')
  })
  it('investments: carried amount against cost', async () => {
    const a = await askNumi('What are our investments worth?', ctx())
    expect(a.intent).toBe('investments')
    const hs = e.holdings.filter((h) => h.status === 'active')
    expect(a.headline).toContain(money(sum(hs.map((h) => D(h.cost).plus(h.fv_adjustment))), false))
  })
  it('reality: five counts, stated as facts', async () => {
    const a = await askNumi('Do the records agree with each other?', ctx())
    expect(a.intent).toBe('reality')
    expect(a.facts.filter((f) => / reality$/.test(f.label)).length).toBe(5)
    expect(JSON.stringify(a).toLowerCase()).not.toContain('fraud')
  })
  it('open cases and confirmations', async () => {
    const a = await askNumi('Which cases are open?', ctx())
    expect(a.intent).toBe('cases')
    expect(a.facts.length).toBe(e.cases.filter((c) => c.status !== 'closed').length)
    expect((await askNumi('Show the confirmations', ctx())).intent).toBe('confirmations')
  })
  it('a what-if is a SIMULATION, says what it assumed, and writes nothing', async () => {
    const before = books()
    const a = await askNumi('What if revenue falls by 20%?', ctx())
    expect(a.intent).toBe('what_if')
    expect(a.truth).toBe('SIMULATION')
    expect(a.headline).toMatch(/^SIMULATION/)
    expect(a.facts.filter((f) => /SIMULATION/.test(f.label)).length).toBeGreaterThanOrEqual(3)
    expect(a.facts.some((f) => /ACTUAL/.test(f.label))).toBe(true)
    expect(a.assumptions.length).toBeGreaterThan(3)
    expect(a.narrative).toMatch(/not a forecast/)
    // only the question itself is written to the log of NUMI; the books are untouched
    expect(books()).toBe(before)
  })
  it('a what-if it cannot read is not guessed', async () => {
    const a = await askNumi('What if the moon is made of cheese?', ctx())
    expect(a.intent).toBe('what_if')
    expect(a.headline).toMatch(/could not read an assumption/)
    expect(a.facts).toEqual([])
  })
  it('assumptions are read from the words, with their direction', () => {
    const cs = [{ id: 'c1', name: 'Sundaram Holdings' }]
    expect(shocksFrom('what if revenue falls by 20%', cs)).toMatchObject([{ kind: 'revenue_pct', value: -20 }])
    expect(shocksFrom('what if sales rise 15 percent', cs)).toMatchObject([{ kind: 'revenue_pct', value: 15 }])
    expect(shocksFrom('what if customers pay 30 days later', cs)).toMatchObject([{ kind: 'collection_delay_days', value: 30 }])
    expect(shocksFrom('what if interest rates rise by 2 points and salaries rise 8%', cs).map((s) => s.kind).sort()).toEqual(['interest_rate_pts', 'payroll_pct'])
    expect(shocksFrom('what if we lose Sundaram Holdings', cs)).toMatchObject([{ kind: 'lose_customer', target_id: 'c1', value: 100 }])
    expect(shocksFrom('what if we hire 6 people at 65,000', cs)).toMatchObject([{ kind: 'new_hires', value: 6, extra: 65000 }])
    expect(shocksFrom('what if it rains', cs)).toEqual([])
  })
  it('burn rate is an average of what happened, not a forecast', async () => {
    const a = await askNumi('What is our burn rate?', ctx())
    expect(a.intent).toBe('burn')
    expect(a.narrative).toMatch(/not a forecast/)
    expect(a.assumptions.some((x) => /Monthly burn =/.test(x))).toBe(true)
  })
  it('year on year: a year that is not complete is said to be incomplete', async () => {
    const a = await askNumi('Show year on year', ctx())
    expect(a.intent).toBe('year_on_year')
    expect(a.headline + (a.narrative ?? '')).toMatch(/not complete|one financial year/)
  })
  it('system health: what is not recorded or not connected is not counted as in order', async () => {
    const a = await askNumi('Is the system healthy?', ctx())
    expect(a.intent).toBe('system_health')
    expect(a.narrative).toMatch(/not connected/)
    expect(a.facts.find((f) => f.label === 'integrations')!.text).toBe('not connected')
    expect((await askNumi('Is the system healthy?', ctx(e, lacking(['system.health'])))).headline).toMatch(/not authorised/)
  })
  it('what waits for the person', async () => {
    const a = await askNumi('What is waiting for me?', ctx())
    expect(a.intent).toBe('notifications')
    expect(a.assumptions.join(' ')).toMatch(/Nothing is sent by e-mail/)
  })
  it('each new screen suggests questions of its own', () => {
    expect(contextualPrompts('/inventory')).toContain('How much stock is at risk?')
    expect(contextualPrompts('/twin')).toContain('What if revenue falls by 20%?')
    expect(contextualPrompts('/reality')).toContain('Which cases are open?')
  })
})

describe('commands on the phase 3 screens', () => {
  const run = (t: string) => interpret(t, e.companies)
  const opens: [string, string][] = [
    ['open inventory', '/inventory'], ['show expired stock', '/inventory?tab=exposure'], ['open the reorder list', '/inventory?tab=reorder'], ['go to stock counts', '/inventory?tab=counts'],
    ['open investments', '/investments'], ['show capital calls', '/investments?tab=funds'], ['show the corporate structure', '/investments?tab=structure'],
    ['open reality', '/reality'], ['show open cases', '/reality?tab=cases'], ['open balance confirmations', '/reality?tab=confirmations'],
    ['open the digital twin', '/twin'], ['open the valuation lab', '/twin?tab=valuation'], ['open the sandbox', '/sandbox'], ['open the scenario studio', '/studio'],
    ['open notifications', '/notifications'], ['show system health', '/system'], ['show backups', '/system?tab=backups'], ['open the parallel run', '/imports?tab=parallel'],
    ['show burn rate', '/analysis?tab=burn'], ['open capabilities', '/features'], ['open materiality', '/control?tab=materiality'],
    // screens of the earlier phases still open as they did
    ['open fund transfers', '/cash?tab=transfers'], ['open the requirement ledger', '/requirements'], ['open the general ledger', '/ledger'],
  ]
  for (const [say, to] of opens) it(`"${say}" opens ${to}`, () => { expect(run(say).command).toMatchObject({ type: 'navigate', to }) })

  const never: [string, string][] = [
    ['issue 5 patient monitors from stock', '/inventory?tab=documents'], ['write off the expired stock', '/inventory?tab=documents'], ['transfer 20 units to the depot', '/inventory?tab=documents'],
    ['pay the distribution to the investors', '/investments?tab=distributions'], ['declare a dividend of 10 lakh', '/investments?tab=distributions'],
    ['sell the shares of Kovai Health Tech', '/investments'], ['call capital from the investors', '/investments'],
    ['commit the import', '/imports'], ['reclassify this entry to travel', '/control'], ['send a reminder to the customer', '/communications'], ['switch off the inventory module', '/system'],
  ]
  for (const [say, to] of never) {
    it(`"${say}" is never carried out from a command`, () => {
      const r = run(say)
      expect(r.sensitive).toBe(true)
      expect(r.command).toMatchObject({ type: 'sensitive', to })
      expect(r.reply).toMatch(/cannot .* from a command alone/)
    })
  }
  it('a question is a question, even when it names something that may not be done by command', () => {
    expect(run('what if revenue falls by 20%?').command.type).toBe('ask')
    expect(run('how much stock is at risk?').command.type).toBe('ask')
  })
})

describe('capability switches', () => {
  const flag = (module: string, enabled: boolean, company_id: string | null = null, role_key: string | null = null): FeatureFlag => ({ id: module + company_id + role_key, group_id: 'g', module, company_id, role_key, enabled, note: null, set_at: TODAY })
  it('no switch means on', () => { expect(capabilityOn([], 'inventory', ['a'])).toBe(true) })
  it('switched off for the group', () => { expect(capabilityOn([flag('inventory', false)], 'inventory', ['a', 'b'])).toBe(false) })
  it('a company decides before the group', () => {
    const f = [flag('inventory', false), flag('inventory', true, 'a')]
    expect(capabilityOn(f, 'inventory', ['a'])).toBe(true)
    expect(capabilityOn(f, 'inventory', ['b'])).toBe(false)
    expect(capabilityOn(f, 'inventory', ['a', 'b'])).toBe(true)
  })
  it('a role decides before the group, and a company with a role before everything', () => {
    const f = [flag('twin', true), flag('twin', false, null, 'accountant'), flag('twin', true, 'a', 'accountant')]
    expect(capabilityOn(f, 'twin', ['b'], { b: ['accountant'] })).toBe(false)
    expect(capabilityOn(f, 'twin', ['a'], { a: ['accountant'] })).toBe(true)
    expect(capabilityOn(f, 'twin', ['b'], { b: ['finance_head'] })).toBe(true)
  })
  it('what the application cannot run without is never switched off', () => {
    expect(capabilityOn([flag('journals', false), flag('approvals', false), flag('audit', false)], 'journals', ['a'])).toBe(true)
    expect(capabilityOn([flag('audit', false)], 'audit', ['a'])).toBe(true)
  })
  it('the inventory of capabilities says what is not connected, and every key is its own', () => {
    expect(new Set(CAPABILITIES.map((c) => c.key)).size).toBe(CAPABILITIES.length)
    for (const c of CAPABILITIES.filter((x) => x.state !== 'working')) expect(c.limits, c.key).toBeTruthy()
    expect(CAPABILITIES.find((c) => c.key === 'integrations')!.state).toBe('not connected')
    expect(CAPABILITIES.find((c) => c.key === 'communications')!.state).toBe('recorded only')
  })
})

describe('the sandbox', () => {
  it('is built from the configuration and the balances, and writes nothing to the books', async () => {
    e.actor = 'demo-owner'
    const before = books()
    const s = await e.getSession()
    const { engine, report } = await buildSandbox(e, s!, e.companies, () => true)
    expect(books()).toBe(before)
    expect(engine).not.toBe(e)
    expect(engine.companies.length).toBe(e.companies.length)
    expect(engine.accounts.length).toBe(e.accounts.length)
    expect(engine.parties.length).toBe(e.parties.length)
    expect(engine.approvalRules.length).toBe(e.approvalRules.length)
    // transactions, people and what is confidential stay behind: a year arrives as one entry of balances and one entry a month
    expect(engine.journals.length).toBeGreaterThan(e.companies.length * 10)
    expect(engine.journals.length).toBeLessThan(e.companies.length * 17)
    expect(engine.journals.every((j) => j.status === 'posted' && (j.narration ?? '').startsWith(BUILD))).toBe(true)
    expect(engine.invoices.length + engine.payments.length + engine.employees.length + engine.salaryStructures.length + engine.documents.length + engine.holdings.length + engine.funds.length).toBe(0)
    expect(report.left_out.some((x) => /salaries/.test(x))).toBe(true)
    // the balances are those of the books
    const real = await e.ledgerBalances(ids(), '1990-01-01', TODAY)
    const copy = await engine.ledgerBalances(ids(), '1990-01-01', TODAY)
    const net = (rows: typeof real, id: string) => { const b = rows.find((x) => x.account_id === id); return b ? D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit).toDecimalPlaces(2).toString() : '0' }
    for (const a of e.accounts.filter((x) => !x.is_group)) expect(net(copy, a.id), a.code).toBe(net(real, a.id))
    for (const c of report.companies) expect(c.note, c.code).toBeNull()
    // what each party owes and is owed is that of the books
    const owed = (rows: Awaited<ReturnType<typeof e.partyLedgerBalances>>) => rows.map((r) => [r.company_id, r.party_id, r.control_type, D(r.debit).minus(r.credit).toFixed(2)].join('|')).filter((x) => !x.endsWith('|0.00')).sort()
    const inBooks = owed(await e.partyLedgerBalances(ids(), TODAY)); const inCopy = owed(await engine.partyLedgerBalances(ids(), TODAY))
    // a kind of ledger that several ledgers carry cannot be set against parties: the report names each one that was left out, and nothing else is missing
    const code = (id: string) => e.companies.find((c) => c.id === id)!.code
    const named = (row: string) => { const [co, , control] = row.split('|'); return report.left_out.some((t) => t.startsWith(code(co) + ':') && t.includes(`"${control.replace(/_/g, ' ')}"`)) }
    expect(inCopy.filter((x) => !inBooks.includes(x))).toEqual([])
    const missing = inBooks.filter((x) => !inCopy.includes(x))
    expect(missing.filter((x) => !named(x))).toEqual([])
    expect(missing.filter((x) => /\|(receivable|payable)\|/.test(x))).toEqual([])
    expect(inCopy.length).toBeGreaterThan(20)
    // the months that were locked are locked again, and the trail of the build is set apart from what the person will do
    expect(engine.periods.filter((p) => p.status === 'locked').length).toBe(e.periods.filter((p) => p.status === 'locked').length)
    expect(report.audit_rows).toBe(engine.audit.length)
  })
  it('the twin of the sandbox rests on the same months as the twin of the books', async () => {
    const s = await e.getSession()
    const { engine } = await buildSandbox(e, s!, e.companies, () => true)
    const real = await loadTwin(e, e.companies, e.accounts, ids())
    const copy = await loadTwin(engine, engine.companies, engine.accounts, ids())
    expect(copy.base.basisMonths).toBe(real.base.basisMonths)
    for (const k of ['revenue', 'cogs', 'payroll', 'opex', 'cash', 'receivables', 'payables', 'debt'] as const) expect(Math.round(copy.base[k]), k).toBe(Math.round(real.base[k]))
  })
  it('what is done in the sandbox stays in the sandbox, and changes no object of the books', async () => {
    const s = await e.getSession()
    const { engine, report } = await buildSandbox(e, s!, e.companies, () => true)
    const before = books()
    const name = e.accounts[5].name
    engine.accounts[5].name = 'Changed in the sandbox'
    const jb = co('JB')
    const acc = (code: string) => engine.accounts.find((a) => a.company_id === jb && a.code === code)!.id
    const j = await engine.saveJournalDraft({ company_id: jb, journal_date: TODAY, narration: 'Tried in the sandbox', lines: [{ account_id: acc('6210'), debit: '1000' }, { account_id: acc('1121'), credit: '1000' }] })
    await engine.submitJournal(j)
    // the person who prepared it cannot approve it: the sandbox keeps the rule of the books
    expect(engine.actor).toBe('demo-accountant')
    engine.actor = 'demo-finance'
    await engine.approveJournal(j, 'ok')
    expect(e.accounts[5].name).toBe(name)
    expect(e.journals.some((x) => x.narration === 'Tried in the sandbox')).toBe(false)
    expect(books()).toBe(before)
    expect((await engine.getSession())!.user.name).toMatch(/^Sandbox/)
    // what was done after the build is what the trail of the sandbox shows
    expect(engine.audit.filter((a) => Number(a.id) > report.audit_rows).map((a) => a.action)).toEqual(expect.arrayContaining(['draft_saved', 'submitted']))
  })
  it('a person who may not read the ledger of a company gets that company empty, and is told', async () => {
    const s = await e.getSession()
    const gcon = co('GCON')
    const { engine, report } = await buildSandbox(e, s!, e.companies, (perm, id) => !(perm === 'report.view' && id === gcon))
    expect(report.companies.find((c) => c.id === gcon)!.note).toMatch(/does not read the ledger/)
    expect(engine.journals.some((j) => j.company_id === gcon)).toBe(false)
    expect(report.companies.filter((c) => c.entries > 0).length).toBe(e.companies.length - 1)
  })
})

describe('what the assessment found in the simulations', () => {
  const cs = [{ id: 'c1', name: 'Sundaram Holdings' }]
  it('the questions of the specification are read as they are asked', () => {
    expect(shocksFrom('What if collections are delayed 30 days?', cs)).toMatchObject([{ kind: 'collection_delay_days', value: 30 }])
    expect(shocksFrom('what if collections are delayed by 45 days', cs)).toMatchObject([{ kind: 'collection_delay_days', value: 45 }])
    expect(shocksFrom('what if the top 3 customers pay 60 days late', cs)).toMatchObject([{ kind: 'collection_delay_days', value: 60, target: 'top3' }])
    expect(shocksFrom('what if we pay suppliers 15 days later', cs)).toMatchObject([{ kind: 'payment_delay_days', value: 15 }])
    expect(shocksFrom('what if sales fall 25%, collections are delayed 45 days and interest rates rise 2%', cs).map((s) => s.kind).sort()).toEqual(['collection_delay_days', 'interest_rate_pts', 'revenue_pct'])
    // a number of days alone says nothing about who pays later
    expect(shocksFrom('what if the project takes 30 days', cs)).toEqual([])
  })
  it('what could not be read is said, not dropped', async () => {
    expect(unread('What if revenue falls by 20% and the monsoon fails?', cs)).toEqual(['the monsoon fails'])
    expect(unread('What if revenue falls by 20%?', cs)).toEqual([])
    const a = await askNumi('What if revenue falls by 20% and the monsoon fails?', ctx())
    expect(a.intent).toBe('what_if')
    expect(a.narrative).toMatch(/could not read an assumption in: "the monsoon fails"/)
  })
  it('paying suppliers later helps cash, so the conservative case shortens the delay', () => {
    const [opt, con] = standardCases([{ kind: 'payment_delay_days', value: 20 }, { kind: 'collection_delay_days', value: 20 }])
    expect(opt.shocks.map((s) => s.value)).toEqual([30, 10])
    expect(con.shocks.map((s) => s.value)).toEqual([10, 30])
  })
})

describe('which way a figure points is read where the figure stands', () => {
  const who = [{ id: 'c1', name: 'Alpha Hospitals' }]
  const read = (q: string) => Object.fromEntries(shocksFrom(q, who).map((s) => [s.kind, s.value]))
  it('a fall of sales says nothing about interest rates', () => {
    expect(read('What if sales fall 25%, collections are delayed 45 days and interest rates rise 2%?')).toEqual({ revenue_pct: -25, collection_delay_days: 45, interest_rate_pts: 2 })
    expect(read('What if sales rise 10% and interest rates fall 1.5 points?')).toEqual({ revenue_pct: 10, interest_rate_pts: -1.5 })
    expect(shocksFrom('what if interest rates fall 2 points', who)[0].label).toBe('Interest rates fall by 2 points')
  })
  it('sooner is not later', () => {
    expect(read('What if customers pay 10 days sooner and we pay suppliers 15 days later?')).toEqual({ collection_delay_days: -10, payment_delay_days: 15 })
    expect(read('What if suppliers are paid 20 days earlier and revenue drops 5%?')).toEqual({ payment_delay_days: -20, revenue_pct: -5 })
    expect(shocksFrom('what if customers pay 10 days sooner', who)[0].label).toBe('Customers pay 10 days sooner')
  })
  it('a subject and its figure stand in the same clause', () => {
    expect(read('What if revenue drops and expenses rise 15%?')).toEqual({ expense_pct: 15 })
    expect(unread('What if revenue drops and expenses rise 15%?', who)).toEqual(['revenue drops'])
    expect(read('What if revenue drops and interest rates rise 2%?')).toEqual({ interest_rate_pts: 2 })
    expect(read('What if customers leave and suppliers are paid 15 days later?')).toEqual({ payment_delay_days: 15 })
  })
  it('a rate of exchange or of tax is not the rate of interest', () => {
    expect(read('What if the exchange rate falls 5%?')).toEqual({})
    expect(read('What if the tax rate rises 3%?')).toEqual({})
    expect(read('What if the interest rate rises 1.5%?')).toEqual({ interest_rate_pts: 1.5 })
  })
  it('a number of days that points neither way is not read, and is named as not read', () => {
    expect(read('What if customers pay in 30 days and revenue falls 10%?')).toEqual({ revenue_pct: -10 })
    expect(unread('What if customers pay in 30 days and revenue falls 10%?', who)).toEqual(['customers pay in 30 days'])
  })
})

// =========================================================================================== READING LISTS
describe('a list of the live books is read to its end', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }))
  /** a query as the API answers it: it hands over what is asked for, up to its own limit, and says nothing of the rest */
  const query = (limit: number, data = rows) => {
    const q = { asked: [] as [number, number][], keys: [] as string[],
      order(k: string) { q.keys.push(k); return q },
      range(from: number, to: number) { q.asked.push([from, to]); return Promise.resolve({ data: data.slice(from, Math.min(to + 1, from + limit)), error: null }) } }
    return q
  }
  const raise = (e: { message: string }): never => { throw new Error(e.message) }

  it('page by page, in a complete order, until a page comes back short', async () => {
    const q = query(3)
    const { all } = readers(async () => 3, raise)
    expect((await all<{ id: number }>(q)).map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(q.asked).toEqual([[0, 2], [3, 5], [6, 8]])
    expect(q.keys).toEqual(['id'])
    const byKey = query(3)
    await all(byKey, 100, ['company_id', 'key'])
    expect(byKey.keys).toEqual(['company_id', 'key'])
  })
  it('a list that ends on the edge of a page costs one more request, and loses nothing', async () => {
    const q = query(3, rows.slice(0, 6))
    expect((await readers(async () => 3, raise).all(q)).length).toBe(6)
    expect(q.asked.length).toBe(3)
  })
  it('a list longer than its ceiling is refused, never cut', async () => {
    const { all } = readers(async () => 3, raise)
    await expect(all(query(3), 5)).rejects.toThrow(/More than 5 records match, and a list cut short would be a false list/)
    expect((await all(query(3), 7)).length).toBe(7)
  })
  it('the size of a page is what the API delivers: assumed larger, the list would end early', async () => {
    // the API hands over 3 rows; an application that takes a page for 5 sees a short page and stops
    expect((await readers(async () => 5, raise).all(query(3))).length).toBe(3)
    // measured, the page is 3 and the list is whole
    expect((await readers(async () => 3, raise).all(query(3))).length).toBe(7)
  })
  it('the latest records only: as many as were asked for, and no more', async () => {
    const q = query(3)
    const { first } = readers(async () => 3, raise)
    expect((await first<{ id: number }>(q, 5)).map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
    expect(q.asked).toEqual([[0, 2], [3, 4]])
    expect((await first(query(3), 50)).length).toBe(7)
    expect((await first(query(3), 0)).length).toBe(0)
  })
  it('a refusal of the database is a refusal, not an empty list', async () => {
    const refused = { order() { return refused }, range() { return Promise.resolve({ data: null, error: { message: 'NUMERO: you are not authorised.', code: '42501' } }) } }
    await expect(readers(async () => 3, raise).all(refused)).rejects.toThrow(/not authorised/)
    await expect(readers(async () => 3, raise).first(refused, 10)).rejects.toThrow(/not authorised/)
  })
})

describe('a switch governs its screens wherever they are reached from', () => {
  it('the screen of an address belongs to the capability whose address begins it, the longest first', async () => {
    const { capabilityOfPath } = await import('../src/engine/features')
    expect(capabilityOfPath('/payroll')).toBe('payroll')
    expect(capabilityOfPath('/payroll/runs/abc')).toBe('payroll')
    expect(capabilityOfPath('/people-cost')).toBe('people_cost')
    expect(capabilityOfPath('/reports/balance-sheet')).toBe('reports')
    expect(capabilityOfPath('/treasury/loans/x')).toBe('treasury')
    expect(capabilityOfPath('/inventory/docs/new')).toBe('inventory')
    // what cannot be switched off is never looked for
    expect([capabilityOfPath('/'), capabilityOfPath('/journals/x'), capabilityOfPath('/approvals'), capabilityOfPath('/settings')]).toEqual([null, null, null, null])
    // an address that only begins with the same letters is not the same screen
    expect(capabilityOfPath('/cashflow')).toBeNull()
    // a tab of a screen does not govern the screen: System Health is governed by its own switch
    expect(capabilityOfPath('/system')).toBe('system')
  })
})
