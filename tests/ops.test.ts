import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DemoEngine } from '../src/api/demo'
import { getDemoEngine } from '../src/api/demoSeed'
import { buildCompanyPayload } from '../src/engine/templates'
import { balanceSheet, joinBalances } from '../src/engine/reports'
import { assetReconciliation, threeWayMatch } from '../src/engine/ops'
import { D, sum } from '../src/lib/money'
import { addDays, addMonths, endOfMonth, startOfMonth, today } from '../src/lib/dates'
import type { ID } from '../src/engine/types'

// =====================================================================
// Operations engine (phase 2). Every rule tested here is also enforced
// by the database and tested there in tests/sql/phase2_*.sql.
// =====================================================================

const OWNER = 'demo-owner', MAKER = 'demo-accountant', CHECKER = 'demo-finance'
const TODAY = today()
const M1 = startOfMonth(addMonths(TODAY, -2))
const M2 = startOfMonth(addMonths(TODAY, -1))
const ago = (n: number) => addDays(TODAY, -n)

interface World { e: DemoEngine; co: ID; co2: ID; acc: (code: string, company?: ID) => ID; bank: ID; cash: ID; dept: ID; emp: ID; vendor: ID; customer: ID }

async function world(): Promise<World> {
  const e = new DemoEngine()
  e.group.settings.controls = { maker_checker: 'enforced' }
  e.actor = OWNER
  const co = await e.createCompany(buildCompanyPayload({ code: 'T1', name: 'Test One', base_currency: 'INR', fy_start_month: 4 }, 'services', { includeGst: true }))
  const co2 = await e.createCompany(buildCompanyPayload({ code: 'T2', name: 'Test Two', base_currency: 'INR', fy_start_month: 4 }, 'services', { includeGst: true }))
  const acc = (code: string, company: ID = co) => e.accounts.find((a) => a.company_id === company && a.code === code)!.id
  e.actor = MAKER
  const mk = async (type_key: string, display_name: string, extra: object = {}) => { const r = await e.createParty({ company_id: co, type_key, display_name, force: true, ...extra }); if (r.status !== 'created') throw new Error('party'); return r.id }
  const w: World = { e, co, co2, acc, bank: acc('1121'), cash: acc('1115'), dept: e.orgUnits.find((u) => u.company_id === co && u.code === 'FIN')!.id, emp: await mk('employee', 'Test Traveller', { kind: 'person' }), vendor: await mk('vendor', 'Vendor One'), customer: await mk('customer', 'Limit Customer', { credit_limit: 1000 }) }
  for (const c of [co, co2]) {
    const id = await e.saveJournalDraft({ company_id: c, journal_date: M1, voucher_type: 'opening', narration: 'Opening', lines: [{ account_id: acc('1121', c), debit: 5000000 }, { account_id: acc('1115', c), debit: 20000 }, { account_id: acc('1350', c), debit: 120000 }, { account_id: acc('3100', c), credit: 5140000 }] })
    await e.submitJournal(id)
    e.actor = CHECKER; await e.approveJournal(id); await e.postJournal(id); e.actor = MAKER
  }
  return w
}
const as = async <T>(e: DemoEngine, actor: string, fn: () => Promise<T>): Promise<T> => { const prev = e.actor; e.actor = actor; try { return await fn() } finally { e.actor = prev } }
const approve = (e: DemoEngine, j: ID, by = CHECKER) => as(e, by, () => e.approveJournal(j, 'ok'))
const status = (e: DemoEngine, j: ID) => e.journals.find((x) => x.id === j)!.status
const linesOf = (e: DemoEngine, j: ID) => e.linesByJournal.get(j) ?? []
const balance = async (e: DemoEngine, co: ID, account: ID) => (await e.ledgerBalances([co], '1990-01-01', '2999-12-31')).filter((b) => b.account_id === account).reduce((s, b) => s.plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), D(0))

describe('workflow posting engine', () => {
  let w: World
  let asset: ID
  beforeEach(async () => {
    w = await world()
    const cat = await w.e.saveAssetCategory({ company_id: w.co, name: 'Computers', asset_account_id: w.acc('1350'), accum_account_id: w.acc('1390'), expense_account_id: w.acc('7100'), method: 'slm', life_months: 60, wdv_rate: null })
    asset = await w.e.saveAsset({ company_id: w.co, name: 'Server', category_id: cat, acquisition_date: M1, cost: 120000, org_unit_id: w.dept })
  })

  it('an operation only proposes: nothing reaches the ledger before approval', async () => {
    const run = await w.e.createDepreciationRun(w.co, M1)
    const j = await w.e.proposeDepreciationRun(run)
    expect(status(w.e, j)).toBe('submitted')
    expect((await balance(w.e, w.co, w.acc('7100'))).toNumber()).toBe(0)
    expect(w.e.depRuns.find((r) => r.id === run)!.status).toBe('proposed')
  })
  it('the person who proposed cannot approve (maker-checker)', async () => {
    const j = await w.e.proposeDepreciationRun(await w.e.createDepreciationRun(w.co, M1))
    await expect(w.e.approveJournal(j)).rejects.toThrow(/maker-checker/)
  })
  it('a workflow journal cannot be edited by hand', async () => {
    const j = await w.e.proposeDepreciationRun(await w.e.createDepreciationRun(w.co, M1))
    await expect(w.e.saveJournalDraft({ id: j, company_id: w.co, journal_date: M1, lines: [{ account_id: w.acc('7100'), debit: 5 }, { account_id: w.acc('1390'), credit: 5 }] })).rejects.toThrow(/prepared by a workflow/)
  })
  it('only one accounting entry per record can be pending', async () => {
    const adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'x', requested_amount: 1000 })
    await w.e.submitAdvance(adv)
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv))
    await w.e.releaseAdvance(adv, { amount: 400, bank_ledger_id: w.bank, date: TODAY })
    await expect(w.e.releaseAdvance(adv, { amount: 400, bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/already awaiting approval/)
  })
  it('final approval posts the journal and updates the source record', async () => {
    const run = await w.e.createDepreciationRun(w.co, M1)
    const j = await w.e.proposeDepreciationRun(run)
    await approve(w.e, j)
    expect(status(w.e, j)).toBe('posted')
    expect(w.e.depRuns.find((r) => r.id === run)!.status).toBe('posted')
    expect(D(w.e.assets.find((a) => a.id === asset)!.accumulated_depreciation).toNumber()).toBe(2000)
    const l = linesOf(w.e, j)
    expect(sum(l.map((x) => x.debit)).eq(sum(l.map((x) => x.credit)))).toBe(true)
    expect(l.find((x) => D(x.debit).gt(0))!.dims).toEqual({ department: w.dept })
  })
  it('a rejected proposal returns the source record to draft', async () => {
    const run = await w.e.createDepreciationRun(w.co, M1)
    const j = await w.e.proposeDepreciationRun(run)
    await as(w.e, CHECKER, () => w.e.rejectJournal(j, 'Asset list incomplete'))
    expect(w.e.depRuns.find((r) => r.id === run)!.status).toBe('draft')
    expect(w.e.postings.find((p) => p.journal_id === j)!.status).toBe('voided')
  })
  it('months are depreciated in order, and reversal undoes the source', async () => {
    const r1 = await w.e.createDepreciationRun(w.co, M1)
    await expect(w.e.createDepreciationRun(w.co, M2)).rejects.toThrow(/not posted yet/)
    const j1 = await w.e.proposeDepreciationRun(r1); await approve(w.e, j1)
    const j2 = await w.e.proposeDepreciationRun(await w.e.createDepreciationRun(w.co, M2)); await approve(w.e, j2)
    await expect(as(w.e, CHECKER, () => w.e.reverseJournal(j1, TODAY, 'test'))).rejects.toThrow(/most recent month first/)
    await as(w.e, CHECKER, () => w.e.reverseJournal(j2, TODAY, 'wrong month'))
    expect(D(w.e.assets.find((a) => a.id === asset)!.accumulated_depreciation).toNumber()).toBe(2000)
    expect(w.e.depRuns.filter((r) => r.status === 'reversed')).toHaveLength(1)
  })
  it('written-down value and part-month depreciation', async () => {
    const cat = await w.e.saveAssetCategory({ company_id: w.co, name: 'Vehicles', asset_account_id: w.acc('1340'), accum_account_id: w.acc('1390'), expense_account_id: w.acc('7100'), method: 'wdv', life_months: null, wdv_rate: 15 })
    const mid = addDays(M1, 15)
    const van = await w.e.saveAsset({ company_id: w.co, name: 'Van', category_id: cat, acquisition_date: mid, cost: 1200000 })
    const run = await w.e.createDepreciationRun(w.co, M1)
    const line = w.e.depLines.find((l) => l.run_id === run && l.asset_id === van)!
    const days = Number(endOfMonth(M1).slice(8))
    expect(D(line.amount).toNumber()).toBeCloseTo((1200000 * 0.15 / 12) * ((days - 15) / days), 1)
    expect(line.basis).toMatch(/part month/)
  })
  it('disposal removes cost and accumulated depreciation and records the loss', async () => {
    await approve(w.e, await w.e.proposeDepreciationRun(await w.e.createDepreciationRun(w.co, M1)))
    await expect(w.e.proposeAssetDisposal({ asset_id: asset, date: TODAY, kind: 'sale', proceeds: 100000, bank_ledger_id: w.acc('4120'), reason: 'x' })).rejects.toThrow(/bank or cash ledger/)
    const j = await w.e.proposeAssetDisposal({ asset_id: asset, date: TODAY, kind: 'sale', proceeds: 100000, bank_ledger_id: w.bank, reason: 'Replaced' })
    await approve(w.e, j)
    const loss = linesOf(w.e, j).find((l) => l.account_id === w.acc('7350'))!
    expect(D(loss.debit).toNumber()).toBe(18000)
    expect(w.e.assets.find((a) => a.id === asset)!.status).toBe('disposed')
  })
  it('depreciated assets cannot have their cost changed', async () => {
    await approve(w.e, await w.e.proposeDepreciationRun(await w.e.createDepreciationRun(w.co, M1)))
    const a = w.e.assets.find((x) => x.id === asset)!
    await expect(w.e.saveAsset({ id: asset, company_id: w.co, name: a.name, category_id: a.category_id, acquisition_date: a.acquisition_date, cost: 150000 })).rejects.toThrow(/can no longer be changed/)
  })
  it('a missing asset raises a factual alert and changes nothing in the books', async () => {
    await w.e.recordAssetEvent({ asset_id: asset, event_type: 'verification', event_date: TODAY, detail: { result: 'missing' } })
    const a = w.e.alerts.find((x) => x.kind === 'asset_verification')!
    expect(a.attention).toBe('priority')
    expect(a.explanation).toMatch(/books have not been changed/)
    expect(w.e.assets.find((x) => x.id === asset)!.status).toBe('active')
  })
})

describe('advances and expense claims', () => {
  let w: World
  let adv: ID
  beforeEach(async () => {
    w = await world()
    adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Site visit', requested_amount: 120000, dims: { department: w.dept } })
    await w.e.submitAdvance(adv)
  })
  const release = async (amount: number, from = w.bank) => { const j = await w.e.releaseAdvance(adv, { amount, bank_ledger_id: from, date: TODAY }); await approve(w.e, j); return j }

  it('approval authorises and moves no money', async () => {
    await expect(w.e.releaseAdvance(adv, { amount: 1000, bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/cannot be released/)
    await expect(w.e.approveAdvance(adv, 100000)).rejects.toThrow(/maker-checker/)
    expect(await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 100000, 'Reduced'))).toBe('approved')
    expect(w.e.journals.filter((j) => j.source === 'advance_release')).toHaveLength(0)
    expect(D(w.e.advances[0].approved_amount).toNumber()).toBe(100000)
  })
  it('release cannot exceed the approval or come from a ledger that is not bank or cash', async () => {
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 100000))
    await expect(w.e.releaseAdvance(adv, { amount: 100001, bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/cannot exceed/)
    await expect(w.e.releaseAdvance(adv, { amount: 100, bank_ledger_id: w.acc('6410'), date: TODAY })).rejects.toThrow(/bank or cash ledger/)
  })
  it('ADVANCE IS NOT EXPENSE', async () => {
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 100000))
    await release(100000)
    expect((await balance(w.e, w.co, w.acc('1155'))).toNumber()).toBe(100000)
    expect((await balance(w.e, w.co, w.acc('6410'))).toNumber()).toBe(0)
    expect(w.e.advances[0].status).toBe('released')
  })
  it('partial settlement leaves a balance that is RETURN DUE, and the return settles it', async () => {
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 100000)); await release(100000)
    const c = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Site visit', advance_id: adv, final_settlement: true, lines: [
      { expense_date: ago(3), account_id: w.acc('6410'), description: 'Flights', amount: 42000, has_receipt: true },
      { expense_date: ago(3), account_id: w.acc('6420'), description: 'Hotel', amount: 28000, has_receipt: true },
      { expense_date: ago(2), account_id: w.acc('6450'), description: 'Meals', amount: 8000, has_receipt: true }] })
    await w.e.submitClaim(c)
    await as(w.e, OWNER, () => w.e.approveClaim(c, 'Reviewed'))
    const claim = w.e.claims[0]
    expect(D(claim.advance_applied).toNumber()).toBe(78000)
    expect(D(claim.payable).toNumber()).toBe(0)
    await approve(w.e, claim.journal_id!)
    expect(w.e.advances[0].status).toBe('return_due')
    await expect(w.e.returnAdvance(adv, { amount: 22001, bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/cannot exceed/)
    await approve(w.e, await w.e.returnAdvance(adv, { amount: 22000, bank_ledger_id: w.bank, date: TODAY }))
    expect(w.e.advances[0].status).toBe('settled')
    expect((await balance(w.e, w.co, w.acc('1155'))).toNumber()).toBe(0)
    expect((await balance(w.e, w.co, w.acc('6410'))).toNumber()).toBe(42000)
  })
  it('excess expense becomes a reimbursement due, then paid', async () => {
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 10000)); await release(10000, w.cash)
    const c = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Trip', advance_id: adv, lines: [{ expense_date: ago(1), account_id: w.acc('6430'), description: 'Taxi and train', amount: 11500, has_receipt: true }] })
    await w.e.submitClaim(c)
    await as(w.e, OWNER, () => w.e.approveClaim(c, 'ok'))
    await approve(w.e, w.e.claims[0].journal_id!)
    expect(w.e.claims[0].status).toBe('posted')
    expect(D(w.e.claims[0].payable).toNumber()).toBe(1500)
    const pay = await w.e.payClaim(c, { bank_ledger_id: w.bank, date: TODAY })
    await expect(as(w.e, CHECKER, () => w.e.reverseJournal(w.e.claims[0].journal_id!, TODAY, 'x'))).rejects.toThrow(/awaiting approval/)
    await approve(w.e, pay)
    expect(w.e.claims[0].status).toBe('paid')
    expect((await balance(w.e, w.co, w.acc('2165'))).toNumber()).toBe(0)
  })
  it('policy flags inform the approver and never reject on their own', async () => {
    const hotel = await as(w.e, OWNER, () => w.e.saveExpenseCategory({ company_id: w.co, name: 'Hotel', account_id: w.acc('6420'), limit_per_item: 6500, receipt_required_above: 0 }))
    const meals = await as(w.e, OWNER, () => w.e.saveExpenseCategory({ company_id: w.co, name: 'Meals', account_id: w.acc('6450'), limit_per_day: 1500, receipt_required_above: 500 }))
    const c = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Flags', lines: [
      { expense_date: ago(4), category_id: hotel, description: 'Hotel', merchant: 'The Park', amount: 9000, has_receipt: true },
      { expense_date: ago(4), category_id: meals, description: 'Lunch', amount: 900 },
      { expense_date: ago(4), category_id: meals, description: 'Dinner', amount: 900, has_receipt: true }] })
    const lines = (await w.e.getClaim(c)).lines!
    expect(lines[0].flags.join()).toMatch(/OUTSIDE POLICY — above the limit of 6500 per item/)
    expect(lines[1].flags.join()).toMatch(/EVIDENCE MISSING/)
    expect(lines[2].flags.join()).toMatch(/daily limit of 1500/)
    expect(w.e.claims[0].status).toBe('draft')
    await w.e.submitClaim(c)
    await expect(as(w.e, CHECKER, () => w.e.approveClaim(c))).rejects.toThrow(/flagged lines/)
    await expect(as(w.e, CHECKER, () => w.e.approveClaim(c, 'ok', [{ line_id: lines[0].id, approved_amount: 6500 }]))).rejects.toThrow(/reason for approving less/)
    await as(w.e, CHECKER, () => w.e.approveClaim(c, 'Hotel capped at policy', [{ line_id: lines[0].id, approved_amount: 6500, note: 'Capped at the policy limit' }]))
    expect(D(w.e.claims[0].approved_total).toNumber()).toBe(8300)
  })
  it('the same expense on a second claim is flagged as a possible duplicate', async () => {
    const line = { expense_date: ago(4), account_id: w.acc('6430'), description: 'Taxi', merchant: 'Ola', amount: 640, has_receipt: true }
    await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'One', lines: [line] })
    const c2 = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Two', lines: [line] })
    expect((await w.e.getClaim(c2)).lines![0].flags.join()).toMatch(/POSSIBLE DUPLICATE/)
  })
  it('a released advance cannot be cancelled', async () => {
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 100000)); await release(100000)
    await expect(w.e.flagAdvance(adv, 'cancelled', 'no longer needed')).rejects.toThrow(/cannot be cancelled/)
  })
})

describe('cash, transfers and documents', () => {
  let w: World
  beforeEach(async () => { w = await world() })

  it('a cash count records the difference and cannot be altered', async () => {
    const box = await w.e.saveCashBox({ company_id: w.co, name: 'HO', ledger_account_id: w.cash, float_amount: 20000, min_balance: 5000 })
    const r = await w.e.recordCashCount({ box_id: box, count_date: TODAY, denominations: { 500: 39, 100: 4 } })
    expect(D(r.counted_total).toNumber()).toBe(19900)
    expect(D(r.difference).toNumber()).toBe(-100)
    expect(w.e.alerts.find((a) => a.kind === 'cash_count_difference')!.explanation).toMatch(/cash short/)
    expect(() => { (w.e.cashCounts[0] as { counted_total: string }).counted_total = '20000' }).toThrow()
    await expect(w.e.saveCashBox({ company_id: w.co, name: 'Bad', ledger_account_id: w.bank })).rejects.toThrow(/cash ledger/)
  })
  it('an internal transfer touches neither income nor expense', async () => {
    const id = await w.e.proposeFundTransfer({ company_id: w.co, from_ledger_id: w.bank, to_ledger_id: w.cash, amount: 5000, transfer_date: TODAY, purpose: 'Top-up' })
    const t = w.e.transfers.find((x) => x.id === id)!
    expect(t.kind).toBe('cash_withdrawal')
    await approve(w.e, t.journal_id!)
    expect(t.status).toBe('posted')
    expect(linesOf(w.e, t.journal_id!).every((l) => ['asset'].includes(w.e.account(l.account_id)!.type))).toBe(true)
    await expect(w.e.proposeFundTransfer({ company_id: w.co, from_ledger_id: w.acc('4120'), to_ledger_id: w.cash, amount: 1, transfer_date: TODAY, purpose: 'x' })).rejects.toThrow(/leaves from/)
  })
  it('an intercompany transfer has two entries; a one-sided outcome raises an alert', async () => {
    const id = await w.e.proposeFundTransfer({ company_id: w.co, to_company_id: w.co2, from_ledger_id: w.bank, to_ledger_id: w.acc('1121', w.co2), amount: 50000, transfer_date: TODAY, purpose: 'Support' })
    const t = w.e.transfers.find((x) => x.id === id)!
    await approve(w.e, t.journal_id!)
    expect(t.status).toBe('part_posted')
    await as(w.e, CHECKER, () => w.e.rejectJournal(t.to_journal_id!, 'Money not received'))
    expect(t.status).toBe('rejected')
    expect(w.e.alerts.some((a) => a.kind === 'intercompany_one_sided' && a.company_id === w.co2)).toBe(true)
  })
  it('an identical file is kept and flagged, never discarded', async () => {
    const sha = 'ab'.repeat(32)
    const a = w.e.registerDocument({ company_id: w.co, name: 'hotel.pdf', sha256: sha })
    const b = w.e.registerDocument({ company_id: w.co, name: 'hotel-copy.pdf', sha256: sha })
    expect(a.possible_duplicates).toHaveLength(0)
    expect(b.possible_duplicates[0].id).toBe(a.id)
    expect(w.e.documents).toHaveLength(2)
    expect(w.e.documents[1].duplicate_of).toBe(a.id)
    expect(w.e.alerts.some((x) => x.kind === 'duplicate_document')).toBe(true)
    expect(() => w.e.registerDocument({ company_id: w.co, name: 'x.pdf', sha256: 'nothex' })).toThrow(/valid fingerprint/)
  })
  it('register kinds enforce their required fields and create a cost dimension', async () => {
    await expect(w.e.saveRegisterItem({ company_id: w.co, kind: 'vehicle', title: 'Innova', data: {} })).rejects.toThrow(/Registration number/)
    const id = await w.e.saveRegisterItem({ company_id: w.co, kind: 'vehicle', title: 'Innova', data: { registration_no: 'TN01AB1234' } })
    const r = await w.e.getRegisterItem(id)
    expect(r.ref_no).toBe('VEH-00001')
    expect(w.e.orgUnits.find((u) => u.id === r.org_unit_id)!.type_key).toBe('vehicle')
    const s = await w.e.getRegisterItem(await w.e.saveRegisterItem({ company_id: w.co, kind: 'subscription', title: 'CRM', amount: 12000, frequency: 'monthly', start_date: TODAY }))
    expect(s.certainty).toBe('scheduled')
    expect((await w.e.listRegisterKinds()).length).toBeGreaterThanOrEqual(50)
  })
  it('a task cannot be closed without its outcome; required custom fields are enforced', async () => {
    const t = await w.e.saveTask({ company_id: w.co, title: 'Follow up' })
    await expect(w.e.saveTask({ id: t, company_id: w.co, title: 'Follow up', status: 'done' })).rejects.toThrow(/outcome/)
    await as(w.e, OWNER, () => w.e.saveCustomField({ company_id: null, entity: 'register_items', key: 'board_ref', label: 'Board approval reference', field_type: 'text', options: [], rules: {}, is_required: true }))
    await expect(w.e.saveCustomValues(w.co, 'register_items', 'x', { board_ref: '' })).rejects.toThrow(/Board approval reference/)
    await w.e.saveCustomValues(w.co, 'register_items', 'x', { board_ref: 'BR/14', unknown: 'ignored' })
    expect(await w.e.getCustomValues('register_items', 'x')).toEqual({ board_ref: 'BR/14' })
  })
  it('reversal keeps documents truthful', async () => {
    const inv = await w.e.saveInvoice({ company_id: w.co, doc_type: 'sales_invoice', party_id: w.customer, doc_date: TODAY, lines: [{ account_id: w.acc('4120'), amount: 5000, description: 'Service' }] })
    await as(w.e, CHECKER, () => w.e.approveInvoice(inv))
    expect(w.e.alerts.some((a) => a.kind === 'credit_limit_exceeded')).toBe(true)
    const pay = await w.e.savePayment({ company_id: w.co, direction: 'in', party_id: w.customer, bank_ledger_id: w.bank, pay_date: TODAY, amount: 2000, allocations: [{ invoice_id: inv, amount: 2000 }] })
    await as(w.e, CHECKER, () => w.e.approvePayment(pay))
    const i = w.e.invoices.find((x) => x.id === inv)!
    await expect(as(w.e, CHECKER, () => w.e.reverseJournal(i.journal_id!, TODAY, 'Wrong customer'))).rejects.toThrow(/Reverse those receipts/)
    await as(w.e, CHECKER, () => w.e.reverseJournal(w.e.payments.find((p) => p.id === pay)!.journal_id!, TODAY, 'Wrong invoice'))
    expect([i.status, D(i.amount_settled).toNumber()]).toEqual(['open', 0])
    await as(w.e, CHECKER, () => w.e.reverseJournal(i.journal_id!, TODAY, 'Wrong customer'))
    expect(i.status).toBe('cancelled')
  })
})

describe('purchase-to-pay', () => {
  let w: World
  const line = (extra: object = {}) => ({ description: 'Monitors', quantity: 10, rate: 1000, ...extra })
  beforeEach(async () => { w = await world() })

  it('requisition → order → receipt → bill, with a three-way comparison', async () => {
    await expect(w.e.savePurchaseDoc({ company_id: w.co, kind: 'requisition', doc_date: TODAY, lines: [line()] })).rejects.toThrow(/reason/)
    const req = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'requisition', doc_date: TODAY, reason: 'New joiners', lines: [line()] })
    await w.e.submitPurchaseDoc(req)
    const order = { company_id: w.co, kind: 'purchase_order' as const, doc_date: TODAY, party_id: w.vendor, parent_id: req, lines: [line({ account_id: w.acc('6240') })] }
    await expect(w.e.savePurchaseDoc(order)).rejects.toThrow(/not been approved/)
    await expect(w.e.approvePurchaseDoc(req)).rejects.toThrow(/maker-checker/)
    await as(w.e, CHECKER, () => w.e.approvePurchaseDoc(req))
    const po = await w.e.savePurchaseDoc(order)
    await w.e.submitPurchaseDoc(po)
    await as(w.e, CHECKER, () => w.e.approvePurchaseDoc(po))
    expect(w.e.purchaseDocs.find((d) => d.id === req)!.status).toBe('ordered')
    expect(w.e.journals.filter((j) => j.source !== 'manual')).toHaveLength(0) // a commitment, not a cost
    const pol = (await w.e.getPurchaseDoc(po)).lines![0].id
    const grn = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'goods_receipt', doc_date: TODAY, parent_id: po, lines: [{ description: 'Monitors', quantity: 6, source_line_id: pol }] })
    await w.e.submitPurchaseDoc(grn)
    expect(w.e.purchaseDocs.find((d) => d.id === po)!.status).toBe('partially_received')
    await expect(w.e.savePurchaseDoc({ company_id: w.co, kind: 'goods_receipt', doc_date: TODAY, parent_id: po, lines: [{ description: 'Monitors', quantity: 5, source_line_id: pol }] })).rejects.toThrow(/exceed the ordered quantity/)

    const bill = await w.e.saveInvoice({ company_id: w.co, doc_type: 'purchase_bill', party_id: w.vendor, doc_date: TODAY, reference: 'V1', lines: [{ account_id: w.acc('6240'), quantity: 10, rate: 1000, description: 'Monitors' }] })
    await w.e.linkBillToPo(bill, po)
    await as(w.e, CHECKER, () => w.e.approveInvoice(bill))
    expect(w.e.alerts.filter((a) => a.entity_id === bill).map((a) => a.kind)).toEqual(['billed_before_receipt'])
    expect(w.e.invoices.find((i) => i.id === bill)!.status).toBe('open') // flagged, not blocked

    const chain = await w.e.getPurchaseChain(grn)
    expect(chain.map((d) => d.kind)).toEqual(['requisition', 'purchase_order', 'goods_receipt'])
    const m = threeWayMatch(chain[1], chain.filter((d) => d.kind === 'goods_receipt'), [await w.e.getInvoice(bill)])
    expect(m.status).toBe('DIFFERENCES FOUND')
    expect(m.lines[0].status).toBe('BILLED BEFORE RECEIPT')
    expect(m.lines[0].quantity_difference.toNumber()).toBe(4)
    await expect(as(w.e, CHECKER, () => w.e.cancelPurchaseDoc(grn, 'x'))).rejects.toThrow(/can no longer be cancelled/)
  })
  it('a person selects the vendor and records why', async () => {
    const rfq = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'rfq', doc_date: TODAY, lines: [{ description: 'Laptops', quantity: 5 }] })
    await w.e.submitPurchaseDoc(rfq)
    const v2 = (await w.e.createParty({ company_id: w.co, type_key: 'vendor', display_name: 'Vendor Two', force: true }) as { id: ID }).id
    const q = async (party: ID, rate: number) => { const id = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'quotation', doc_date: TODAY, party_id: party, parent_id: rfq, lines: [{ description: 'Laptops', quantity: 5, rate }] }); await w.e.submitPurchaseDoc(id); return id }
    const q1 = await q(w.vendor, 58000), q2 = await q(v2, 61000)
    await expect(as(w.e, CHECKER, () => w.e.selectQuotation(q2, '  '))).rejects.toThrow(/why this vendor/)
    await as(w.e, CHECKER, () => w.e.selectQuotation(q2, 'Three-year on-site warranty'))
    expect(w.e.purchaseDocs.find((d) => d.id === q1)!.status).toBe('not_selected')
    expect(w.e.purchaseDocs.find((d) => d.id === rfq)!.status).toBe('closed')
    expect((w.e.audit.find((a) => a.action === 'vendor_selected')!.new_value as { was_lowest: boolean }).was_lowest).toBe(false)
    await expect(w.e.savePurchaseDoc({ company_id: w.co, kind: 'purchase_order', doc_date: TODAY, party_id: w.vendor, parent_id: q1, lines: [{ description: 'Laptops', quantity: 5, rate: 58000, account_id: w.acc('6240') }] })).rejects.toThrow(/selected/)
  })
})

describe('treasury', () => {
  let w: World
  let lender: ID
  beforeEach(async () => { w = await world(); lender = (await w.e.createParty({ company_id: w.co, type_key: 'lender', display_name: 'Test Bank', force: true }) as { id: ID }).id })

  it('loan schedule, disbursement and instalments in order', async () => {
    const base = { company_id: w.co, name: 'Term loan', party_id: lender, principal: 1200000, rate_pct: 12, start_date: M2, first_due_date: addMonths(M2, 1), tenure_months: 12, interest_account_id: w.acc('7010') }
    await expect(w.e.saveLoan({ ...base, loan_account_id: w.bank })).rejects.toThrow(/liability ledger/)
    const loan = await w.e.saveLoan({ ...base, loan_account_id: w.acc('2210') })
    const s = await w.e.listLoanSchedule({ loanId: loan })
    expect(s).toHaveLength(12)
    expect(sum(s.map((x) => x.principal)).toNumber()).toBe(1200000)
    expect(D(s[11].closing_principal).toNumber()).toBe(0)
    expect(D(s[0].interest).toNumber()).toBe(12000)
    expect(D(s[0].total).toNumber()).toBeCloseTo(106618.55, 2)
    await expect(w.e.payLoanInstalment(s[0].id, { bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/disbursement first/)
    await approve(w.e, await w.e.disburseLoan(loan, { amount: 1200000, bank_ledger_id: w.bank, date: M2 }), OWNER)
    expect(w.e.loans[0].status).toBe('active')
    await expect(w.e.payLoanInstalment(s[1].id, { bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/in order/)
    const j = await w.e.payLoanInstalment(s[0].id, { bank_ledger_id: w.bank, date: TODAY, interest: 12100 })
    await approve(w.e, j)
    expect(D(w.e.loans[0].interest_paid).toNumber()).toBe(12100)
    expect(D(w.e.loans[0].principal_repaid).eq(s[0].principal)).toBe(true)
    await expect(w.e.saveLoan({ ...base, id: loan, loan_account_id: w.acc('2210'), principal: 999 })).rejects.toThrow(/money has already moved/)
  })
  it('fixed deposit: maturity value, lien, and interest as actually paid', async () => {
    const fd = await w.e.saveFixedDeposit({ company_id: w.co, bank_name: 'Test Bank', principal: 500000, rate_pct: 7, compounding: 'quarterly', start_date: M2, maturity_date: addDays(M2, 365), fd_account_id: w.acc('1210'), interest_account_id: w.acc('4910'), lien_marked: true, lien_note: 'BG margin' })
    expect(D(w.e.deposits[0].maturity_amount).toNumber()).toBeCloseTo(535929.52, 1)
    await approve(w.e, await w.e.placeFixedDeposit(fd, { bank_ledger_id: w.bank }))
    const close = { bank_ledger_id: w.bank, date: TODAY, proceeds: 532000, tax_deducted: 3500 }
    await expect(w.e.closeFixedDeposit(fd, close)).rejects.toThrow(/under lien/)
    const j = await w.e.closeFixedDeposit(fd, { ...close, lien_released: true })
    await approve(w.e, j)
    expect(D(linesOf(w.e, j).find((l) => l.account_id === w.acc('4910'))!.credit).toNumber()).toBe(35500)
    expect(w.e.deposits[0].status).toBe('closed')
  })
})

describe('payroll', () => {
  let w: World
  let e1: ID, e2: ID, s1: ID, run: ID
  const partMonth = () => { const dim = Number(endOfMonth(M2).slice(8)); return Math.round((30000 * (dim - 15) / dim) * 100) / 100 }
  beforeEach(async () => {
    w = await world()
    const p = async (n: string) => (await w.e.createParty({ company_id: w.co, type_key: 'employee', kind: 'person', display_name: n, force: true }) as { id: ID }).id
    const ops = w.e.orgUnits.find((u) => u.company_id === w.co && u.code === 'ADM')!.id
    e1 = await w.e.saveEmployee({ company_id: w.co, party_id: w.emp, join_date: addDays(M2, -400), department_id: w.dept })
    e2 = await w.e.saveEmployee({ company_id: w.co, party_id: await p('Ravi'), join_date: addDays(M2, 15), department_id: ops })
    await w.e.saveEmployee({ company_id: w.co, party_id: await p('New Joiner'), join_date: addDays(M2, -10), department_id: ops })
    s1 = await w.e.saveSalaryStructure({ employee_id: e1, effective_from: addDays(M2, -400), reason: 'Joining', components: [
      { name: 'Basic', kind: 'earning', amount: 50000 }, { name: 'HRA', kind: 'earning', amount: 20000 }, { name: 'PF', kind: 'deduction', type: 'statutory', amount: 6000 },
      { name: 'Income tax', kind: 'deduction', type: 'tax', amount: 4000 }, { name: 'Employer PF', kind: 'employer', amount: 6000 }] })
    const s2 = await w.e.saveSalaryStructure({ employee_id: e2, effective_from: addDays(M2, 15), reason: 'Joining', components: [{ name: 'Consolidated', kind: 'earning', amount: 30000 }] })
    await expect(w.e.decideSalaryStructure(s1, 'approved')).rejects.toThrow(/maker-checker/)
    await as(w.e, OWNER, async () => { await w.e.decideSalaryStructure(s1, 'approved'); await w.e.decideSalaryStructure(s2, 'approved') })
    run = await w.e.createPayrollRun({ company_id: w.co, month: M2, adjustments: [{ employee_id: e1, name: 'Bonus', kind: 'earning', type: 'bonus', amount: 10000 }] })
  })

  it('calculates from approved salaries, pro-rata, and lists anyone left out', async () => {
    const r = w.e.payrollRuns[0]
    expect(r.headcount).toBe(2)
    expect(D(r.gross).toNumber()).toBeCloseTo(80000 + partMonth(), 2)
    expect(D(r.deductions).toNumber()).toBe(10000)
    expect(D(r.employer_cost).toNumber()).toBe(6000)
    expect(r.exceptions).toHaveLength(1)
    expect(r.exceptions[0].reason).toMatch(/NOT INCLUDED — no approved salary/)
    await expect(w.e.createPayrollRun({ company_id: w.co, month: M2 })).rejects.toThrow(/already exists/)
  })
  it('the payroll journal is confidential, by department, and names no one', async () => {
    const j = await w.e.proposePayrollRun(run)
    const jr = w.e.journals.find((x) => x.id === j)!
    expect(jr.confidentiality).toBe('confidential')
    const l = linesOf(w.e, j)
    expect(l.every((x) => !x.party_id)).toBe(true)
    expect(sum(l.map((x) => x.debit)).eq(sum(l.map((x) => x.credit)))).toBe(true)
    expect(D(l.find((x) => x.account_id === w.acc('6140'))!.debit).toNumber()).toBe(10000)
    expect(D(l.find((x) => x.account_id === w.acc('2170'))!.credit).toNumber()).toBe(12000)
    expect(D(l.find((x) => x.account_id === w.acc('2150'))!.credit).toNumber()).toBe(4000)
  })
  it('nobody approves what they cannot read', async () => {
    const j = await w.e.proposePayrollRun(run)
    w.e.vaultGrants = {}
    await expect(approve(w.e, j)).rejects.toThrow(/not cleared to see it/)
    w.e.vaultGrants = { [CHECKER]: 'confidential' }
    await approve(w.e, j)
    expect(w.e.payrollRuns[0].status).toBe('posted')
  })
  it('PRIVATE IS NOT FALSE: totals include the confidential payroll', async () => {
    await approve(w.e, await w.e.proposePayrollRun(run))
    const seen = await as(w.e, MAKER, () => w.e.ledgerLines({ company_ids: [w.co], account_ids: [w.acc('6110')] }))
    expect(seen.rows).toHaveLength(0)
    expect(D(seen.restricted.debit).toNumber()).toBeCloseTo(70000 + partMonth(), 2)
    expect((await balance(w.e, w.co, w.acc('6110'))).toNumber()).toBeCloseTo(70000 + partMonth(), 2)
  })
  it('payment settles the payable; a paid payroll cannot be reversed', async () => {
    const j = await w.e.proposePayrollRun(run); await approve(w.e, j)
    await approve(w.e, await w.e.payPayrollRun(run, { bank_ledger_id: w.bank, date: TODAY }))
    expect(w.e.payrollRuns[0].status).toBe('paid')
    expect((await balance(w.e, w.co, w.acc('2160'))).toNumber()).toBe(0)
    await expect(as(w.e, OWNER, () => w.e.reverseJournal(j, TODAY, 'x'))).rejects.toThrow(/have been paid/)
  })
  it('an approved salary is never overwritten; a revision adds history', async () => {
    const s = w.e.salaryStructures.find((x) => x.id === s1)!
    expect(() => { (s as { monthly_gross: string }).monthly_gross = '1' }).toThrow()
    await expect(w.e.saveSalaryStructure({ id: s1, employee_id: e1, effective_from: TODAY, reason: 'x', components: [{ name: 'Basic', kind: 'earning', amount: 1 }] })).rejects.toThrow(/never overwritten/)
    const rev = await w.e.saveSalaryStructure({ employee_id: e1, effective_from: TODAY, reason: 'Increment', components: [{ name: 'Basic', kind: 'earning', amount: 60000 }] })
    await as(w.e, OWNER, () => w.e.decideSalaryStructure(rev, 'approved'))
    expect((await w.e.listSalaryStructures({ employeeId: e1 })).filter((x) => x.status === 'approved')).toHaveLength(2)
  })
  it('a recovery cannot exceed the unsettled advance, and posting records it', async () => {
    const adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Salary advance', requested_amount: 8000 })
    await w.e.submitAdvance(adv); await as(w.e, CHECKER, () => w.e.approveAdvance(adv))
    await approve(w.e, await w.e.releaseAdvance(adv, { amount: 8000, bank_ledger_id: w.bank, date: M2 }))
    await w.e.cancelPayrollRun(run, 'redo')
    const recover = (amount: number) => w.e.createPayrollRun({ company_id: w.co, month: M2, adjustments: [{ employee_id: e1, name: 'Advance recovery', kind: 'deduction', type: 'advance_recovery', amount, advance_id: adv }] })
    await expect(recover(9000)).rejects.toThrow(/exceeds the unsettled balance/)
    const j = await w.e.proposePayrollRun(await recover(5000))
    expect(linesOf(w.e, j).filter((l) => l.party_id)).toHaveLength(1)
    await approve(w.e, j)
    expect(w.e.advances[0].status).toBe('partially_settled')
    expect(D(w.e.advances[0].returned_amount).toNumber()).toBe(5000)
  })
})

describe('the sample universe after the operations seed', () => {
  let e: DemoEngine
  beforeAll(async () => { e = await getDemoEngine() })

  it('every posted journal balances', () => {
    const posted = e.journals.filter((j) => j.status === 'posted' || j.status === 'reversed')
    expect(posted.length).toBeGreaterThan(900)
    for (const j of posted) { const l = e.linesByJournal.get(j.id) ?? []; expect(sum(l.map((x) => x.debit)).eq(sum(l.map((x) => x.credit)))).toBe(true) }
  })
  it('assets = liabilities + equity in every company', async () => {
    for (const c of e.companies) {
      const rows = joinBalances(e.accounts.filter((a) => a.company_id === c.id), await e.ledgerBalances([c.id], '1990-01-01', TODAY))
      const bs = balanceSheet(rows)
      expect(bs.totalAssets.toNumber()).toBeGreaterThan(1000000)
      expect(bs.difference.abs().toNumber()).toBeLessThan(0.01)
    }
  })
  it('every workflow posting was resolved, except those deliberately left in the inbox', () => {
    const pending = e.postings.filter((p) => p.status === 'pending')
    // the transfer between two companies, and from phase 3: an allocation, a distribution to one investor, a valuation, goods returned and an expired lot
    expect(pending.map((p) => p.source).sort()).toEqual(['allocation', 'distribution_payment', 'fund_transfer', 'fund_transfer_in', 'holding_txn', 'stock_doc', 'stock_doc'])
    expect(e.postings.filter((p) => p.status === 'posted').length).toBeGreaterThan(20)
    for (const p of e.postings.filter((x) => x.status === 'posted')) expect(e.journals.find((j) => j.id === p.journal_id)!.status).toBe('posted')
  })
  it('the asset register agrees with the general ledger', async () => {
    const co = e.companies.find((c) => c.code === 'GMED')!
    const rec = assetReconciliation(await e.listAssets([co.id]), await e.listAssetCategories([co.id]), await e.ledgerBalances([co.id], '1990-01-01', TODAY), e.accounts.filter((a) => a.company_id === co.id))
    expect(rec.length).toBeGreaterThanOrEqual(3)
    for (const r of rec) expect(r.difference.abs().toNumber()).toBeLessThan(0.01)
  })
  it('salaries never appear against a person in the general ledger', () => {
    const payroll = e.journals.filter((j) => j.source === 'payroll')
    expect(payroll).toHaveLength(1)
    const salary = (e.linesByJournal.get(payroll[0].id) ?? []).filter((l) => D(l.debit).gt(0))
    expect(salary.length).toBeGreaterThan(0)
    expect(salary.every((l) => !l.party_id)).toBe(true)
  })
  it('a restricted salary is invisible to a person without clearance', async () => {
    const all = await e.listEmployees(e.companies.map((c) => c.id))
    e.actor = MAKER
    try {
      const seen = await e.listEmployees(e.companies.map((c) => c.id))
      expect(seen.length).toBe(all.length - 1)
      expect((await e.listSalaryStructures({})).some((s) => D(s.monthly_gross).eq(600000))).toBe(false)
    } finally { e.actor = OWNER }
  })
})

// =====================================================================
// Corrections found when every requirement was reviewed against the code.
// The same rules are tested against the database in tests/sql/phase2_corrections.sql.
// =====================================================================
describe('corrections from the requirement review', () => {
  let w: World
  beforeEach(async () => { w = await world() })

  it('a loan recovered through payroll reaches its instalment schedule and is never counted twice', async () => {
    const loan = await w.e.saveLoan({ company_id: w.co, direction: 'lent', kind: 'employee_loan', name: 'Staff loan', party_id: w.emp, principal: 60000, rate_pct: 0, start_date: M2, first_due_date: addMonths(M2, 1), tenure_months: 6, repayment: 'equal_principal', loan_account_id: w.acc('1195'), interest_account_id: w.acc('4910') })
    await approve(w.e, await w.e.disburseLoan(loan, { amount: 60000, bank_ledger_id: w.bank, date: M2 }), OWNER)
    const e1 = await w.e.saveEmployee({ company_id: w.co, party_id: w.emp, join_date: addDays(M2, -400), department_id: w.dept })
    const s1 = await w.e.saveSalaryStructure({ employee_id: e1, effective_from: addDays(M2, -400), reason: 'Joining', components: [{ name: 'Basic', kind: 'earning', amount: 80000 }] })
    await as(w.e, OWNER, () => w.e.decideSalaryStructure(s1, 'approved'))
    const run = await w.e.createPayrollRun({ company_id: w.co, month: M2, adjustments: [{ employee_id: e1, name: 'Staff loan recovery', kind: 'deduction', type: 'loan_recovery', amount: 15000, loan_id: loan }] })
    const pj = await w.e.proposePayrollRun(run)
    expect(w.e.loanSchedule.every((s) => D(s.recovered).isZero())).toBe(true) // nothing before approval
    await approve(w.e, pj, OWNER)

    const s = () => w.e.loanSchedule.filter((x) => x.loan_id === loan).sort((a, b) => a.instalment_no - b.instalment_no)
    expect([s()[0].status, D(s()[0].recovered).toNumber()]).toEqual(['paid', 10000])
    expect([s()[1].status, D(s()[1].recovered).toNumber()]).toEqual(['due', 5000])
    expect(D(w.e.loans[0].principal_repaid).toNumber()).toBe(15000)

    const j = await w.e.payLoanInstalment(s()[1].id, { bank_ledger_id: w.bank, date: TODAY })
    const principal = linesOf(w.e, j).filter((l) => l.account_id === w.acc('1195'))
    expect(sum(principal.map((l) => l.credit)).toNumber()).toBe(5000)
    await approve(w.e, j)
    expect(D(w.e.loans[0].principal_repaid).toNumber()).toBe(20000)
    expect(D(w.e.loans[0].principal_repaid).lte(w.e.loans[0].disbursed_amount)).toBe(true)
    await expect(as(w.e, OWNER, () => w.e.reverseJournal(pj, TODAY, 'test'))).rejects.toThrow(/recorded after this recovery/)
  })

  it('reversing the payroll takes the recovery back from the schedule', async () => {
    const loan = await w.e.saveLoan({ company_id: w.co, direction: 'lent', kind: 'employee_loan', name: 'Staff loan', party_id: w.emp, principal: 60000, rate_pct: 0, start_date: M2, first_due_date: addMonths(M2, 1), tenure_months: 6, repayment: 'equal_principal', loan_account_id: w.acc('1195'), interest_account_id: w.acc('4910') })
    await approve(w.e, await w.e.disburseLoan(loan, { amount: 60000, bank_ledger_id: w.bank, date: M2 }), OWNER)
    const e1 = await w.e.saveEmployee({ company_id: w.co, party_id: w.emp, join_date: addDays(M2, -400), department_id: w.dept })
    const s1 = await w.e.saveSalaryStructure({ employee_id: e1, effective_from: addDays(M2, -400), reason: 'Joining', components: [{ name: 'Basic', kind: 'earning', amount: 80000 }] })
    await as(w.e, OWNER, () => w.e.decideSalaryStructure(s1, 'approved'))
    const run = await w.e.createPayrollRun({ company_id: w.co, month: M2, adjustments: [{ employee_id: e1, name: 'Staff loan recovery', kind: 'deduction', type: 'loan_recovery', amount: 15000, loan_id: loan }] })
    const pj = await w.e.proposePayrollRun(run)
    await approve(w.e, pj, OWNER)
    await as(w.e, OWNER, () => w.e.reverseJournal(pj, TODAY, 'Recovery recorded against the wrong month'))
    expect(w.e.loanSchedule.filter((x) => x.loan_id === loan).every((x) => x.status === 'due' && D(x.recovered).isZero())).toBe(true)
    expect(D(w.e.loans[0].principal_repaid).toNumber()).toBe(0)
  })

  it('an advance to a vendor sits in the vendor advances ledger', async () => {
    const adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.vendor, recipient_type: 'vendor', purpose: 'Advance against an order', requested_amount: 30000 })
    await w.e.submitAdvance(adv)
    await as(w.e, CHECKER, () => w.e.approveAdvance(adv))
    const j = await w.e.releaseAdvance(adv, { amount: 30000, bank_ledger_id: w.bank, date: TODAY })
    const map = (await w.e.listAccountMap([w.co]))
    const vendorAdvances = map.find((m) => m.key === 'vendor_advances')!.account_id, employeeAdvances = map.find((m) => m.key === 'employee_advances')!.account_id
    expect(vendorAdvances).not.toBe(employeeAdvances)
    expect(linesOf(w.e, j).some((l) => l.account_id === vendorAdvances && D(l.debit).eq(30000))).toBe(true)
    expect(linesOf(w.e, j).some((l) => l.account_id === employeeAdvances)).toBe(false)
  })

  it('a claim linked to a trip carries the trip into its entry', async () => {
    const trip = await w.e.saveRegisterItem({ company_id: w.co, kind: 'trip', title: 'Kochi expo', amount: 40000, data: { traveller: 'Test Traveller', to_place: 'Kochi', purpose: 'Expo' } })
    const unit = w.e.registerItems.find((r) => r.id === trip)!.org_unit_id!
    expect(unit).toBeTruthy()
    const claim = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Kochi expo', register_item_id: trip, lines: [{ expense_date: ago(2), account_id: w.acc('6410'), description: 'Train tickets', amount: 3000, has_receipt: true }] })
    await w.e.submitClaim(claim)
    await as(w.e, CHECKER, () => w.e.approveClaim(claim, 'ok'))
    const j = w.e.claims.find((c) => c.id === claim)!.journal_id!
    const detail = await as(w.e, CHECKER, () => w.e.openJournal(j))
    const expense = detail.lines.find((l) => l.account_id === w.acc('6410'))!
    expect(Object.values(expense.dims).map((u) => u.id)).toContain(unit)
  })

  it('a payment from a cash box above its limit is raised for review and still recorded', async () => {
    await w.e.saveCashBox({ company_id: w.co, name: 'HO', ledger_account_id: w.cash, float_amount: 20000, min_balance: 5000, max_single_payment: 2000 })
    const over = await w.e.proposeFundTransfer({ company_id: w.co, from_ledger_id: w.cash, to_ledger_id: w.bank, amount: 3000, transfer_date: TODAY, purpose: 'Cash deposited' })
    const t = w.e.transfers.find((x) => x.id === over)!
    const alert = w.e.alerts.find((a) => a.kind === 'cash_box_limit_exceeded')!
    expect(alert.entity_id).toBe(t.journal_id)
    expect(alert.explanation).toMatch(/is recorded; whether it is in order is for a person to decide/)
    expect(alert.explanation).not.toMatch(/fraud|suspicious|misuse/i)
    expect(w.e.postings.find((p) => p.journal_id === t.journal_id)!.status).toBe('pending')
    const before = w.e.alerts.length
    await approve(w.e, t.journal_id!)
    await w.e.proposeFundTransfer({ company_id: w.co, from_ledger_id: w.cash, to_ledger_id: w.bank, amount: 1500, transfer_date: TODAY, purpose: 'Cash deposited' })
    expect(w.e.alerts.length).toBe(before)
  })

  it('in an approval of several steps a later approver may lower the amount, not raise it', async () => {
    await as(w.e, OWNER, () => w.e.saveApprovalRule({ company_id: w.co, entity: 'advance', name: 'Large advances', min_amount: 40000, max_amount: null, steps: ['*', '*'] }))
    const adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Site mobilisation', requested_amount: 50000 })
    await w.e.submitAdvance(adv)
    expect(await as(w.e, CHECKER, () => w.e.approveAdvance(adv, 30000, 'Enough for a fortnight'))).toBe('pending')
    const a = () => w.e.advances.find((x) => x.id === adv)!
    expect([a().status, D(a().approved_amount).toNumber()]).toEqual(['requested', 30000])
    await expect(as(w.e, OWNER, () => w.e.approveAdvance(adv, 40000))).rejects.toThrow(/earlier approver authorised/)
    expect(await as(w.e, OWNER, () => w.e.approveAdvance(adv, 25000))).toBe('approved')
    expect(D(a().approved_amount).toNumber()).toBe(25000)

    const second = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Second site', requested_amount: 45000 })
    await w.e.submitAdvance(second)
    await as(w.e, CHECKER, () => w.e.approveAdvance(second, 20000))
    await as(w.e, OWNER, () => w.e.rejectAdvance(second, 'Not needed'))
    expect(D(w.e.advances.find((x) => x.id === second)!.approved_amount).toNumber()).toBe(0)
  })

  it('a follow-up is as confidential as the record it is linked to', async () => {
    const secret = await as(w.e, OWNER, () => w.e.saveRegisterItem({ company_id: w.co, kind: 'dividend', title: 'Settlement', amount: 900000, confidentiality: 'restricted' }))
    const open = await w.e.saveRegisterItem({ company_id: w.co, kind: 'dividend', title: 'Interim dividend', amount: 100000 })
    await as(w.e, OWNER, () => w.e.saveTask({ company_id: w.co, entity: 'register_items', entity_id: secret, title: 'Obtain the signed deed' }))
    await w.e.saveTask({ company_id: w.co, entity: 'register_items', entity_id: open, title: 'Record the board resolution' })
    const seen = (await w.e.listTasks({ companyIds: [w.co] })).map((t) => t.title)
    expect(seen).toEqual(['Record the board resolution'])
    expect((await as(w.e, OWNER, () => w.e.listTasks({ companyIds: [w.co] }))).length).toBe(2)
  })
})

describe('second review of the corrections', () => {
  let w: World
  beforeEach(async () => { w = await world() })

  it('a required field of one sub-type does not block a record of another', async () => {
    await as(w.e, OWNER, () => w.e.saveCustomField({ company_id: null, entity: 'register_items', scope_key: 'vehicle', key: 'fitness_cert', label: 'Fitness certificate number', field_type: 'text', options: [], rules: {}, is_required: true, status: 'active' }))
    const dividend = await w.e.saveRegisterItem({ company_id: w.co, kind: 'dividend', title: 'Interim dividend', amount: 100000 })
    const vehicle = await w.e.saveRegisterItem({ company_id: w.co, kind: 'vehicle', title: 'Innova', data: { registration_no: 'TN01AB1234' } })
    await expect(w.e.saveCustomValues(w.co, 'register_items', dividend, {})).resolves.toBeUndefined()
    await expect(w.e.saveCustomValues(w.co, 'register_items', vehicle, {})).rejects.toThrow(/required information is missing — Fitness certificate number/)
    await w.e.saveCustomValues(w.co, 'register_items', vehicle, { fitness_cert: 'FC/2026/118' })
    expect((await w.e.getCustomValues('register_items', vehicle)).fitness_cert).toBe('FC/2026/118')
  })

  it('a field required of one party type is asked of that type only', async () => {
    await as(w.e, OWNER, () => w.e.saveCustomField({ company_id: null, entity: 'party', scope_key: 'broker', key: 'licence_no', label: 'Licence number', field_type: 'text', options: [], rules: {}, is_required: true, status: 'active' }))
    const broker = (await w.e.createParty({ company_id: w.co, type_key: 'broker', display_name: 'Coastal Brokers', force: true }) as { id: ID }).id
    const vendor = (await w.e.createParty({ company_id: w.co, type_key: 'vendor', display_name: 'Steel Traders', force: true }) as { id: ID }).id
    await expect(w.e.saveCustomValues(w.co, 'party', vendor, {})).resolves.toBeUndefined()
    await expect(w.e.saveCustomValues(w.co, 'party', broker, {})).rejects.toThrow(/Licence number/)
    await w.e.saveCustomValues(w.co, 'party', broker, { licence_no: 'BRK/2026/44' })
    expect((await w.e.getCustomValues('party', broker)).licence_no).toBe('BRK/2026/44')
  })

  it('a follow-up stays as confidential as its record when the record is reclassified', async () => {
    const item = await w.e.saveRegisterItem({ company_id: w.co, kind: 'dividend', title: 'Settlement under discussion', amount: 900000 })
    await w.e.saveTask({ company_id: w.co, entity: 'register_items', entity_id: item, title: 'Obtain the draft deed' })
    expect((await w.e.listTasks({ companyIds: [w.co] })).map((t) => t.title)).toEqual(['Obtain the draft deed'])
    await as(w.e, OWNER, () => w.e.saveRegisterItem({ id: item, company_id: w.co, kind: 'dividend', title: 'Settlement under discussion', amount: 900000, confidentiality: 'restricted', reason: 'Now a legal matter' }))
    expect(await w.e.listTasks({ companyIds: [w.co] })).toHaveLength(0)
    expect(await as(w.e, OWNER, () => w.e.listTasks({ companyIds: [w.co] }))).toHaveLength(1)
  })

  it('a claim linked to a property or an incident carries that record into its entry', async () => {
    const kinds: [string, Record<string, unknown>][] = [['property', {}], ['incident', { incident_type: 'Damage', incident_date: ago(3) }]]
    for (const [kind, data] of kinds) {
      const item = await w.e.saveRegisterItem({ company_id: w.co, kind, title: 'Linked ' + kind, data })
      const unit = w.e.registerItems.find((r) => r.id === item)!.org_unit_id!
      expect(unit, kind).toBeTruthy()
      const claim = await w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Repairs', register_item_id: item, lines: [{ expense_date: ago(2), account_id: w.acc('6410'), description: 'Repair', amount: 4000, has_receipt: true }] })
      await w.e.submitClaim(claim)
      await as(w.e, CHECKER, () => w.e.approveClaim(claim, 'ok'))
      const j = w.e.claims.find((c) => c.id === claim)!.journal_id!
      const detail = await as(w.e, CHECKER, () => w.e.openJournal(j))
      const expense = detail.lines.find((l) => l.account_id === w.acc('6410'))!
      expect(Object.values(expense.dims).map((u) => u.id), kind).toContain(unit)
    }
  })

  it('a claim or an advance is at least as confidential as the item it is linked to', async () => {
    const trip = await as(w.e, CHECKER, () => w.e.saveRegisterItem({ company_id: w.co, kind: 'trip', title: 'Acquisition talks — Mumbai', amount: 80000, confidentiality: 'confidential', data: { traveller: 'Test Traveller', to_place: 'Mumbai', purpose: 'Talks' } }))
    const claim = await as(w.e, CHECKER, () => w.e.saveClaim({ company_id: w.co, claimant_party_id: w.emp, title: 'Mumbai', register_item_id: trip, lines: [{ expense_date: ago(2), account_id: w.acc('6410'), description: 'Flight', amount: 9000, has_receipt: true }] }))
    const adv = await as(w.e, CHECKER, () => w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Mumbai', requested_amount: 20000, register_item_id: trip }))
    expect(w.e.claims.find((c) => c.id === claim)!.confidentiality).toBe('confidential')
    expect(w.e.advances.find((a) => a.id === adv)!.confidentiality).toBe('confidential')
    // a person who is not cleared sees neither
    expect((await w.e.listClaims({ companyIds: [w.co] })).some((c) => c.id === claim)).toBe(false)
    expect((await w.e.listAdvances({ companyIds: [w.co] })).some((a) => a.id === adv)).toBe(false)
  })
})
