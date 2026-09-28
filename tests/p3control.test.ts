import { beforeEach, describe, expect, it } from 'vitest'
import { DemoEngine } from '../src/api/demo'
import { buildCompanyPayload } from '../src/engine/templates'
import { D } from '../src/lib/money'
import { addDays, addMonths, startOfMonth, today } from '../src/lib/dates'
import type { Account, Alert, ApprovalRequest, ID, LedgerLine } from '../src/engine/types'
import type { InvHold, InvItem, InvLot, LegacyBalance, Shock, StockRow } from '../src/engine/p3Types'
import { SIMULATION, byAssets, byMultiples, compare, dcf, driverFits, freeCashFlows, simulate, standardCases, type TwinBase } from '../src/engine/twin'
import { REPORT_REALITY, findDifferences, notChecked, realityHealth, realityOfReport, sheetLineDifference } from '../src/engine/reality'
import { loadReality } from '../src/lib/realityData'
import { countDifferences, exposureTotals, lossExposure, reorderList } from '../src/engine/stock'
import { corporateTree, fundSummary, holdingPosition, investorStatement } from '../src/engine/invest'
import { attentionOf, burnRate, complianceView, forOwner, parallelRun, tryApprovalRule, tryThreshold, unusualEntries, yearOnYear } from '../src/engine/analysis'

// =====================================================================
// Phase 3 — reality and control, the platform, and the engines that
// calculate: the digital twin, reality, exposure, analysis.
// =====================================================================

const OWNER = 'demo-owner', MAKER = 'demo-accountant', CHECKER = 'demo-finance'
const TODAY = today()
const M1 = startOfMonth(addMonths(TODAY, -2))
const ago = (n: number) => addDays(TODAY, -n)

interface World { e: DemoEngine; co: ID; co2: ID; acc: (code: string, company?: ID) => ID; bank: ID; cash: ID; fin: ID; ops: ID; mkt: ID; emp: ID; vendor: ID; customer: ID }
async function world(): Promise<World> {
  const e = new DemoEngine()
  e.group.settings.controls = { maker_checker: 'enforced' }
  e.actor = OWNER
  const co = await e.createCompany(buildCompanyPayload({ code: 'T1', name: 'Test One', base_currency: 'INR', fy_start_month: 4 }, 'trading', { includeGst: true }))
  const co2 = await e.createCompany(buildCompanyPayload({ code: 'T2', name: 'Test Two', base_currency: 'INR', fy_start_month: 4 }, 'services', { includeGst: true }))
  const acc = (code: string, company: ID = co) => e.accounts.find((a) => a.company_id === company && a.code === code)!.id
  const dept = async (code: string, name: string) => e.orgUnits.find((u) => u.company_id === co && u.code === code)?.id ?? (await e.createOrgUnit({ company_id: co, type_key: 'department', code, name }))
  const fin = await dept('FIN', 'Finance'); const ops = await dept('OPS', 'Operations'); const mkt = await dept('MKT', 'Marketing')
  e.actor = MAKER
  const mk = async (type_key: string, display_name: string, extra: object = {}) => { const r = await e.createParty({ company_id: co, type_key, display_name, force: true, ...extra }); if (r.status !== 'created') throw new Error('party'); return r.id }
  const w: World = { e, co, co2, acc, bank: acc('1121'), cash: acc('1115'), fin, ops, mkt, emp: await mk('employee', 'Test Traveller', { kind: 'person' }), vendor: await mk('vendor', 'Vendor One'), customer: await mk('customer', 'Kovai Traders') }
  for (const c of [co, co2]) {
    const id = await e.saveJournalDraft({ company_id: c, journal_date: M1, voucher_type: 'opening', narration: 'Opening', lines: [{ account_id: acc('1121', c), debit: 1000000 }, { account_id: acc('1115', c), debit: 5000 }, { account_id: acc('3100', c), credit: 1005000 }] })
    await e.submitJournal(id)
    e.actor = CHECKER; await e.approveJournal(id); await e.postJournal(id); e.actor = MAKER
  }
  return w
}
const as = async <T>(e: DemoEngine, actor: string, fn: () => Promise<T>): Promise<T> => { const prev = e.actor; e.actor = actor; try { return await fn() } finally { e.actor = prev } }
const approve = (e: DemoEngine, j: ID, by = CHECKER) => as(e, by, () => e.approveJournal(j, 'ok'))
const post = async (w: World, lines: Parameters<DemoEngine['saveJournalDraft']>[0]['lines'], narration: string, company = w.co, date = addDays(M1, 5)) => {
  const j = await w.e.saveJournalDraft({ company_id: company, journal_date: date, voucher_type: 'journal', narration, lines })
  await w.e.submitJournal(j)
  await as(w.e, CHECKER, async () => { await w.e.approveJournal(j); await w.e.postJournal(j) })
  return j
}
const dimBalance = (e: DemoEngine, account: ID, unit: ID | null) => e.lines.filter((l) => l.account_id === account && ['posted', 'reversed'].includes(e.journals.find((j) => j.id === l.journal_id)!.status) && (unit ? Object.values(l.dims).includes(unit) : !Object.keys(l.dims).length)).reduce((s, l) => s.plus(l.debit).minus(l.credit), D(0)).toNumber()

// =========================================================================================== CONTROL
describe('reality and control', () => {
  let w: World
  beforeEach(async () => { w = await world() })

  it('materiality is a threshold for attention, set with its basis', async () => {
    await expect(w.e.setMateriality(w.co, 100, null, '')).rejects.toThrow(/basis/)
    await w.e.setMateriality(w.co, 100, null, 'Agreed with the auditors')
    expect(Number((await w.e.listMateriality([w.co]))[0].amount)).toBe(100)
  })
  it('a case: the same difference is one case; status needs a note, closing needs the resolution; history is kept', async () => {
    const c = await w.e.openCase({ company_id: w.co, title: 'Order, receipt and payment do not agree', amount: 18000, dedupe_key: 'po:1', finding: { document: 100, operation: 82 } })
    expect(await w.e.openCase({ company_id: w.co, title: 'Found again', dedupe_key: 'po:1' })).toBe(c)
    await expect(w.e.updateCase({ id: c, status: 'investigating' })).rejects.toThrow(/records what was found/)
    await w.e.updateCase({ id: c, status: 'investigating', note: 'Asked the warehouse', owner_name: 'Asha' })
    await expect(w.e.updateCase({ id: c, status: 'closed', note: 'Done' })).rejects.toThrow(/resolution/)
    await w.e.updateCase({ id: c, status: 'substantiated', note: '18 units were short-delivered' })
    await w.e.updateCase({ id: c, status: 'closed', note: 'Credit note received', resolution: 'Credit note for 18 units' })
    const full = await w.e.getCase(c)
    expect(full.status).toBe('closed')
    expect(full.events.map((e) => e.event)).toEqual(['opened', 'status', 'owner', 'status', 'status'])
  })
  it('an alert under a case follows the case', async () => {
    await as(w.e, CHECKER, () => w.e.runSentinel(w.co))
    w.e.alerts.push({ id: 'a1', company_id: w.co, kind: 'test', attention: 'review', title: 'Payments split', explanation: 'x', evidence: {}, entity: null, entity_id: null, status: 'open', created_at: w.e.now(), dedupe_key: 't1' })
    const c = await w.e.openCase({ company_id: w.co, kind: 'sentinel', title: 'Payments split', alert_id: 'a1' })
    expect(w.e.alerts.find((a) => a.id === 'a1')!.status).toBe('reviewing')
    await w.e.updateCase({ id: c, status: 'unsubstantiated', note: 'Two separate orders, each approved' })
    expect(w.e.alerts.find((a) => a.id === 'a1')!.status).toBe('false_positive')
  })
  it('verifying assets records what was found and changes nothing in the books', async () => {
    const cat = await w.e.saveAssetCategory({ company_id: w.co, name: 'Equipment', asset_account_id: w.acc('1320'), accum_account_id: w.acc('1390'), expense_account_id: w.acc('7100'), method: 'slm', life_months: 60, wdv_rate: null })
    const a1 = await w.e.saveAsset({ company_id: w.co, name: 'Generator', category_id: cat, acquisition_date: M1, cost: 200000, location: 'Head office' })
    const a2 = await w.e.saveAsset({ company_id: w.co, name: 'Projector', category_id: cat, acquisition_date: M1, cost: 100000, location: 'Head office' })
    const v = await w.e.openVerification({ company_id: w.co, subject: 'assets', performed_by_name: 'Auditor', scope: { location: 'head office' } })
    const ls = (await w.e.getVerification(v)).lines!
    expect(ls.length).toBe(2)
    const id = (asset: ID) => ls.find((l) => l.entity_id === asset)!.id
    await expect(w.e.recordVerification(v, [{ id: id(a2), result: 'missing' }])).rejects.toThrow(/say what was found/)
    await w.e.recordVerification(v, [{ id: id(a1), result: 'located' }, { id: id(a2), result: 'missing', note: 'Not in the meeting room' }])
    const s = await w.e.completeVerification(v)
    expect([s.agree, s.differ]).toEqual([1, 1])
    expect(w.e.assetEvents.filter((e) => e.event_type === 'verification').length).toBe(2)
    expect(w.e.alerts.filter((a) => a.kind === 'verification_difference').length).toBe(1)
    expect(w.e.assets.find((a) => a.id === a2)!.status).toBe('active')
  })
  it('verifying cash: a difference above the threshold is raised as a priority, and the books still say what they said', async () => {
    await w.e.setMateriality(w.co, 100, null, 'Agreed')
    await w.e.saveCashBox({ company_id: w.co, name: 'HO petty cash', ledger_account_id: w.cash, float_amount: 5000 })
    const v = await w.e.openVerification({ company_id: w.co, subject: 'cash' })
    await expect(w.e.completeVerification(v)).rejects.toThrow(/were not checked/)
    const l = (await w.e.getVerification(v)).lines![0]
    expect(Number(l.book_value)).toBe(5000)
    await w.e.recordVerification(v, [{ id: l.id, found_value: 4800, note: 'Two vouchers not yet entered' }])
    await w.e.completeVerification(v)
    const al = w.e.alerts.find((a) => a.kind === 'verification_difference')!
    expect(al.attention).toBe('priority')
    expect(Number(al.evidence.difference)).toBe(-200)
    expect(al.explanation).not.toMatch(/fraud|suspicious|misuse/i)
    const cash = (await w.e.ledgerBalances([w.co], '1990-01-01', TODAY)).find((x) => x.account_id === w.cash)!
    expect(Number(cash.period_debit) + Number(cash.opening_debit) - Number(cash.period_credit) - Number(cash.opening_credit)).toBe(5000)
  })
  it('a confirmation: NUMERO works out the balance, a person sends it and records the reply', async () => {
    await post(w, [{ account_id: w.acc('1130'), debit: 118000, party_id: w.customer }, { account_id: w.acc('4110'), credit: 118000 }], 'Sale')
    const c = await w.e.saveConfirmation({ company_id: w.co, subject: 'customer', party_id: w.customer, as_of: TODAY })
    expect(Number(w.e.confirmations[0].book_balance)).toBe(118000)
    await expect(w.e.updateConfirmation({ id: c, action: 'sent', sent_how: '' })).rejects.toThrow(/how and to whom/)
    await w.e.updateConfirmation({ id: c, action: 'sent', sent_how: 'Letter by email' })
    expect(await w.e.updateConfirmation({ id: c, action: 'reply', confirmed_balance: 100000 })).toBe('difference')
    expect(Number(w.e.confirmations[0].difference)).toBe(-18000)
    await expect(w.e.updateConfirmation({ id: c, action: 'explained', explanation: '' })).rejects.toThrow(/explanation/)
    await w.e.updateConfirmation({ id: c, action: 'explained', explanation: 'A receipt of the last day is in transit' })
    expect(w.e.alerts.filter((a) => a.kind === 'confirmation_difference').length).toBe(1)
  })
  it('between companies of the group the other side is read from its own books', async () => {
    const mine = await as(w.e, OWNER, () => w.e.createAccount({ company_id: w.co, code: '1191', name: 'Due from Test Two', type: 'asset', subtype: 'intercompany_receivable', control_type: 'intercompany', counterparty_company_id: w.co2, parent_id: null, is_group: false }))
    const theirs = await as(w.e, OWNER, () => w.e.createAccount({ company_id: w.co2, code: '2181', name: 'Due to Test One', type: 'liability', subtype: 'intercompany_payable', control_type: 'intercompany', counterparty_company_id: w.co, parent_id: null, is_group: false }))
    await post(w, [{ account_id: mine, debit: 50000 }, { account_id: w.bank, credit: 50000 }], 'Lent')
    await post(w, [{ account_id: w.acc('1121', w.co2), debit: 50000 }, { account_id: theirs, credit: 50000 }], 'Received', w.co2)
    await w.e.saveConfirmation({ company_id: w.co, subject: 'intercompany', counter_company_id: w.co2, as_of: TODAY })
    expect(w.e.confirmations[0].status).toBe('agreed')
    await post(w, [{ account_id: w.acc('6210', w.co2), debit: 10000 }, { account_id: theirs, credit: 10000 }], 'Charge recorded here only', w.co2)
    await w.e.saveConfirmation({ company_id: w.co, subject: 'intercompany', counter_company_id: w.co2, as_of: TODAY })
    expect([w.e.confirmations[1].status, Number(w.e.confirmations[1].difference)]).toEqual(['difference', 10000])
  })
  it('a reclassification leaves the original entry as it is and keeps the reason', async () => {
    const j = await post(w, [{ account_id: w.acc('6210'), debit: 12000, dims: { department: w.ops } }, { account_id: w.bank, credit: 12000 }], 'Rent')
    const line = w.e.linesByJournal.get(j)!.find((l) => l.account_id === w.acc('6210'))!
    const bankLine = w.e.linesByJournal.get(j)!.find((l) => l.account_id === w.bank)!
    await expect(w.e.proposeReclassification({ line_id: bankLine.id, to_account_id: w.cash, reason: 'Paid in cash' })).rejects.toThrow(/corrected by reversing/)
    await expect(w.e.proposeReclassification({ line_id: line.id, to_account_id: w.acc('6240'), reason: '' })).rejects.toThrow(/records its reason/)
    const r = await w.e.proposeReclassification({ line_id: line.id, to_account_id: w.acc('6240'), amount: 5000, reason: 'Stationery billed with the rent' })
    await expect(w.e.proposeReclassification({ line_id: line.id, to_account_id: w.acc('6240'), amount: 8000, reason: 'More' })).rejects.toThrow(/At most 7000/)
    await approve(w.e, r)
    expect(Number(line.debit)).toBe(12000)
    expect(dimBalance(w.e, w.acc('6240'), w.ops)).toBe(5000)
    expect(w.e.reclassifications[0]).toMatchObject({ status: 'posted', reason: 'Stationery billed with the rent', requested_by: MAKER })
  })
  it('an allocation shares out what the ledger holds, explains itself, and leaves the total unchanged', async () => {
    await post(w, [{ account_id: w.acc('6210'), debit: 90000 }, { account_id: w.bank, credit: 90000 }], 'Rent of the building')
    const base = { company_id: w.co, name: 'Head office rent', period_from: M1, period_to: TODAY, source_account_id: w.acc('6210'), dimension_type: 'department', driver: 'headcount' as const }
    await expect(w.e.saveAllocation({ ...base, amount: 95000, recipients: [{ org_unit_id: w.fin, driver_value: 2 }] })).rejects.toThrow(/No more than that/)
    const a = await w.e.saveAllocation({ ...base, amount: 90000, recipients: [{ org_unit_id: w.fin, driver_value: 2 }, { org_unit_id: w.ops, driver_value: 5 }, { org_unit_id: w.mkt, driver_value: 3 }] })
    const al = w.e.allocations.find((x) => x.id === a)!
    expect(al.recipients.map((r) => r.amount)).toEqual(['18000.00', '45000.00', '27000.00'])
    expect(al.formula).toMatch(/× its headcount ÷ total headcount of 10/)
    await approve(w.e, await w.e.proposeAllocation(a))
    expect(dimBalance(w.e, w.acc('6210'), null)).toBe(0)
    expect(dimBalance(w.e, w.acc('6210'), w.ops)).toBe(45000)
    expect(w.e.lines.filter((l) => l.account_id === w.acc('6210') && w.e.journals.find((j) => j.id === l.journal_id)!.status === 'posted').reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBe(90000)
  })
})

// =========================================================================================== PLATFORM
describe('simulations, scenario studio and platform', () => {
  let w: World
  beforeEach(async () => { w = await world() })

  it('a saved simulation is labelled SIMULATION, touches no entry, and cannot be relabelled', async () => {
    const s = await as(w.e, CHECKER, () => w.e.saveScenario({ company_id: w.co, name: 'Revenue falls 20%', kind: 'conservative', shocks: [{ kind: 'revenue_pct', value: -20 }] }))
    expect((await w.e.listScenarios()).length).toBe(0)                   // it belongs to the person who built it
    await as(w.e, CHECKER, () => w.e.saveScenario({ id: s, company_id: w.co, name: 'Revenue falls 20%', shared: true, shocks: [{ kind: 'revenue_pct', value: -20 }] }))
    expect((await w.e.listScenarios()).length).toBe(1)
    const before = w.e.journals.length
    const r = await as(w.e, CHECKER, () => w.e.saveScenarioRun({ scenario_id: s, company_ids: [w.co], as_of: TODAY, base: { revenue: 500000 }, result: { revenue: 400000 } }))
    expect(w.e.journals.length).toBe(before)
    const run = w.e.scenarioRuns.find((x) => x.id === r)!
    expect(run.label).toBe(SIMULATION)
    expect(() => { (run as { label: string }).label = 'ACTUAL' }).toThrow()
  })
  it('an assumption is used only after a second person approves it', async () => {
    const d = await w.e.saveTwinDriver({ company_id: w.co, key: 'Salary_Rise', name: 'Salary rise next April', unit: 'percent', value: 8, basis: 'Board minute of March' })
    await expect(w.e.decideTwinDriver(d, 'approved')).rejects.toThrow(/maker-checker/)
    await as(w.e, CHECKER, () => w.e.decideTwinDriver(d, 'approved'))
    expect((await w.e.listTwinDrivers())[0]).toMatchObject({ key: 'salary_rise', status: 'approved' })
  })
  it('a workflow: checked when designed, enforced when run, and it posts nothing', async () => {
    const def = (steps: object[]) => ({ company_id: w.co, key: 'site_advance', name: 'Site advance', trigger_kind: 'form' as const, definition: { fields: [{ key: 'site', label: 'Site', required: true }], steps } as never })
    await expect(w.e.saveFlowDef(def([{ key: 'release', name: 'Release the money', action: 'fund_release' }]))).rejects.toThrow(/a workflow itself posts nothing/)
    await expect(w.e.saveFlowDef(def([{ key: 's', name: 'Step', action: 'review', actor_role: 'chief_wizard' }]))).rejects.toThrow(/role that does not exist/)
    const fl = await w.e.saveFlowDef(def([
      { key: 'request', name: 'Request', action: 'request' }, { key: 'approve', name: 'Approval', action: 'approval' },
      { key: 'release', name: 'Money released', action: 'fund_release', links_to: 'advances', actor_role: 'accountant' },
      { key: 'evidence', name: 'Evidence', action: 'evidence', required_documents: ['receipt'] }, { key: 'review', name: 'Review', action: 'review', optional: true },
    ]))
    await expect(w.e.startFlowCase({ flow_id: fl, company_id: w.co, title: 'Too early', data: { site: 'Rubycon' } })).rejects.toThrow(/Only an active workflow/)
    await w.e.setFlowStatus(fl, 'active')
    await expect(w.e.startFlowCase({ flow_id: fl, company_id: w.co, title: 'Rubycon shuttering' })).rejects.toThrow(/missing — Site/)
    const c = await w.e.startFlowCase({ flow_id: fl, company_id: w.co, title: 'Rubycon shuttering', amount: 40000, party_id: w.emp, data: { site: 'Rubycon' } })
    await w.e.completeFlowStep({ case_id: c, note: 'Needed for shuttering material' })
    await expect(w.e.completeFlowStep({ case_id: c })).rejects.toThrow(/maker-checker/)
    await as(w.e, CHECKER, () => w.e.completeFlowStep({ case_id: c, note: 'Approved' }))
    await expect(as(w.e, CHECKER, () => w.e.completeFlowStep({ case_id: c, entity_id: 'x' }))).rejects.toThrow(/is for the role accountant/)
    await expect(w.e.completeFlowStep({ case_id: c })).rejects.toThrow(/points to its record/)
    await expect(w.e.completeFlowStep({ case_id: c, entity_id: 'nothing' })).rejects.toThrow(/not found in this company/)
    const journals = w.e.journals.length
    const adv = await w.e.saveAdvance({ company_id: w.co, recipient_party_id: w.emp, purpose: 'Rubycon shuttering', requested_amount: 40000 })
    await w.e.completeFlowStep({ case_id: c, entity_id: adv })
    expect(w.e.journals.length).toBe(journals)
    await expect(w.e.completeFlowStep({ case_id: c })).rejects.toThrow(/requires a document of the kind "receipt"/)
    const doc = await w.e.uploadDocument(w.co, new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' }), { doc_kind: 'receipt' })
    await w.e.linkDocument(doc.id, 'flow_cases', c)
    await w.e.completeFlowStep({ case_id: c, note: 'Receipts attached' })
    expect(await w.e.completeFlowStep({ case_id: c, skip: true, note: 'Reviewed with the claim' })).toBe('completed')
    // a workflow in use is not edited: a change is a new version, and the case keeps its steps
    const v2 = await w.e.saveFlowDef({ ...def([{ key: 'request', name: 'Request', action: 'request' }]), id: fl })
    expect(v2).not.toBe(fl)
    expect(w.e.flowDefs.find((f) => f.id === v2)!.version).toBe(2)
    expect((await w.e.getFlowCase(c)).steps!.length).toBe(5)
    const copy = await w.e.cloneFlowDef(fl, 'travel_advance', 'Travel advance', w.co)
    expect(w.e.flowDefs.find((f) => f.id === copy)!.cloned_from).toBe(fl)
  })
  it('notices: an approval is told to those who can approve, never to the person who made it, and cannot be switched off', async () => {
    const j = await w.e.saveJournalDraft({ company_id: w.co, journal_date: TODAY, narration: 'Test', lines: [{ account_id: w.acc('6210'), debit: 100 }, { account_id: w.bank, credit: 100 }] })
    await w.e.submitJournal(j)
    const mine = (await w.e.listNotifications()).filter((n) => n.kind === 'approval_waiting' && n.entity_id === j)
    expect(mine.length).toBe(0)
    const theirs = await as(w.e, CHECKER, () => w.e.listNotifications())
    expect(theirs.filter((n) => n.kind === 'approval_waiting' && n.entity_id === j && n.mandatory).length).toBe(1)
    await expect(as(w.e, CHECKER, () => w.e.setNotificationPref('approval_waiting', 'in_app', false))).rejects.toThrow(/cannot be switched off/)
    expect(await as(w.e, CHECKER, () => w.e.markNotifications(null))).toBeGreaterThan(0)
    expect((await as(w.e, CHECKER, () => w.e.listNotifications({ unreadOnly: true }))).length).toBe(0)
  })
  it('notices: what falls due is found when a person opens the application, and finding it again adds nothing', async () => {
    await w.e.saveTask({ company_id: w.co, title: 'Call the bank', due_date: TODAY, owner_user: CHECKER })
    expect(await as(w.e, CHECKER, () => w.e.refreshNotifications())).toBeGreaterThan(0)
    expect(await as(w.e, CHECKER, () => w.e.refreshNotifications())).toBe(0)
    const kinds = (await as(w.e, CHECKER, () => w.e.listNotifications())).map((n) => n.kind)
    expect(kinds).toContain('follow_up_assigned'); expect(kinds).toContain('follow_up_due')
  })
  it('NUMERO prepares a communication; a person sends it; what was sent cannot be rewritten', async () => {
    const t1 = await as(w.e, OWNER, () => w.e.saveMessageTemplate({ company_id: w.co, key: 'payment_reminder', name: 'Reminder', subject: 'Payment due', body: 'Dear {{party}}' }))
    const t2 = await as(w.e, OWNER, () => w.e.saveMessageTemplate({ company_id: w.co, key: 'payment_reminder', name: 'Reminder', subject: 'Payment overdue', body: 'Dear {{party}}' }))
    expect(w.e.messageTemplates.find((t) => t.id === t1)!.is_active).toBe(false)
    expect(w.e.messageTemplates.find((t) => t.id === t2)!.version).toBe(2)
    const c = await w.e.prepareCommunication({ company_id: w.co, party_id: w.customer, template_key: 'payment_reminder', to_address: 'accounts@kovai.invalid', subject: 'Payment overdue — INV-1', body: 'Dear Kovai Traders, 118000 is overdue.' })
    await expect(w.e.markCommunication(c, 'sent_by_person', '')).rejects.toThrow(/how it was sent/)
    await w.e.markCommunication(c, 'sent_by_person', 'Sent from the accounts mailbox by Asha')
    const row = w.e.communications.find((x) => x.id === c)!
    expect(row.status).toBe('sent_by_person')
    expect(() => { (row as { body: string }).body = 'rewritten' }).toThrow()
  })
  it('the register of integrations holds no secret, and guards what can move money', async () => {
    await expect(w.e.saveIntegration({ company_id: w.co, key: 'sms', name: 'SMS gateway', kind: 'sms', notes: 'api_key: 9f8e7d6c5b4a39281706' })).rejects.toThrow(/never the secret/)
    const money = { company_id: w.co, key: 'payouts', name: 'Bank payouts', kind: 'bank' as const, direction: 'outbound' as const, moves_money: true, secret_location: 'Server secret BANK_PAYOUT_KEY' }
    await expect(w.e.saveIntegration({ ...money, environment: 'production', status: 'testing' })).rejects.toThrow(/HIGH RISK/)
    const i = await w.e.saveIntegration({ ...money, environment: 'sandbox', status: 'testing', tested_in_sandbox_on: TODAY })
    expect(w.e.integrations[0].risk).toBe('high')
    await expect(w.e.saveIntegration({ ...money, id: i, environment: 'production', status: 'active' })).rejects.toThrow(/Only a Group Super Admin|only a Group Super Admin/)
  })
  it('capabilities are switched by a Group Super Admin; backups are recorded by a person and never changed', async () => {
    await expect(w.e.setFeatureFlag({ module: 'inventory', company_id: w.co, enabled: false })).rejects.toThrow(/Group Super Admin/)
    await as(w.e, OWNER, () => w.e.setFeatureFlag({ module: 'inventory', company_id: w.co, enabled: false, note: 'Not used' }))
    await as(w.e, OWNER, () => w.e.setFeatureFlag({ module: 'inventory', company_id: w.co, enabled: true }))
    expect(w.e.featureFlags).toMatchObject([{ module: 'inventory', enabled: true }])
    expect((await w.e.systemHealth()).backups.state).toBe('not_recorded')
    await expect(w.e.recordBackupCheck({ kind: 'backup', performed_on: addDays(TODAY, 1), outcome: 'succeeded', evidence: 'x', performed_by_name: 'IT' })).rejects.toThrow(/future/)
    await w.e.recordBackupCheck({ kind: 'backup', performed_on: TODAY, outcome: 'succeeded', evidence: 'Dashboard lists the daily backup', performed_by_name: 'IT' })
    const h = await w.e.systemHealth()
    expect(h.backups.state).toBe('attention')
    expect(h.backups.recovery_readiness).toMatch(/^unproven/)
    expect(h.posting_engine.posted_entries_that_do_not_balance).toBe(0)
    expect(h.queues_and_jobs.state).toBe('not_connected')
    expect(() => { (w.e.backupChecks[0] as { outcome: string }).outcome = 'failed' }).toThrow()
  })
  it('an import is checked before it enters the books, and enters them as drafts', async () => {
    const rows = (credit: string) => [
      { date: M1, ref: 'JV-1', account: '6210', debit: '25000', narration: 'Rent' }, { date: M1, ref: 'JV-1', account: '1121', credit, narration: 'Rent' },
      { date: M1, ref: 'JV-2', account: 'R-99', debit: '500', narration: 'Misc' }, { date: M1, ref: 'JV-2', account: '1121', credit: '500', narration: 'Misc' },
    ]
    const bad = await w.e.stageImport({ company_id: w.co, kind: 'journals', file_name: 'legacy.csv', sha256: '11', rows: rows('24000') })
    const b = await w.e.getImport(bad)
    expect([b.ok, b.checks.balance.passed, b.checks.mapping.unmapped, b.checks.validation.passed]).toEqual([false, false, ['R-99'], false])
    await expect(w.e.commitImport(bad)).rejects.toThrow(/did not pass its checks/)
    const before = w.e.journals.length
    const good = await w.e.stageImport({ company_id: w.co, kind: 'journals', file_name: 'legacy.csv', sha256: '22', mapping: { 'R-99': '6410' }, rows: rows('25000') })
    expect(w.e.journals.length).toBe(before)
    expect((await w.e.commitImport(good)).records).toBe(2)
    const added = w.e.journals.filter((j) => j.source === 'import')
    expect(added.map((j) => [j.status, j.origin])).toEqual([['draft', 'import'], ['draft', 'import']])
    const again = await w.e.getImport(await w.e.stageImport({ company_id: w.co, kind: 'journals', file_name: 'again.csv', sha256: '22', mapping: { 'R-99': '6410' }, rows: rows('25000') }))
    expect([again.ok, again.checks.duplicates.file_already_committed]).toEqual([false, true])
  })
  it('the monthly totals agree with the posted entries', async () => {
    const r = await w.e.refreshFacts(w.co)
    expect(r.journals).toBe(1)
    const facts = await w.e.listFacts([w.co], '1990-01-01', TODAY)
    expect(facts.reduce((s, f) => s + Number(f.debit), 0)).toBe(1005000)
    expect((await w.e.systemHealth()).analytical_store.companies_never_refreshed).toBe(1)
  })
  it('a booking on a claim line: its parts must add up to the line', async () => {
    const line = (parts: object) => ({ company_id: w.co, claimant_party_id: w.emp, title: 'Chennai', lines: [{ expense_date: ago(2), account_id: w.acc('6410'), description: 'Train to Chennai', amount: 1850, has_receipt: true, detail: { kind: 'train' as const, operator: 'Indian Railways', booking_ref: 'PNR 4521', origin: 'Coimbatore', destination: 'Chennai', class: '2A', ...parts } }] })
    await expect(w.e.saveClaim(line({ base_fare: 1600, taxes: 80, booking_charges: 100 }))).rejects.toThrow(/add up to 1780, and the line is 1850/)
    await expect(w.e.saveClaim(line({ kind: 'rocket' }))).rejects.toThrow(/by air, train, bus, cab or a hotel stay/)
    const c = await w.e.getClaim(await w.e.saveClaim(line({ base_fare: 1600, taxes: 80, booking_charges: 170 })))
    expect(c.lines![0].detail).toMatchObject({ booking_ref: 'PNR 4521', destination: 'Chennai' })
  })
  it('a generator is a register kind with a tag of its own', async () => {
    const g = await w.e.saveRegisterItem({ company_id: w.co, kind: 'generator', title: 'Head office generator 62.5 kVA', data: { located_at: 'Head office', fuel_type: 'Diesel' } })
    const unit = w.e.orgUnits.find((u) => u.id === w.e.registerItems.find((r) => r.id === g)!.org_unit_id)!
    expect(unit.type_key).toBe('equipment')
  })
})

// =========================================================================================== ENGINES
const BASE: TwinBase = {
  asOf: '2026-09-30', currency: 'INR', scope: 'Test', basisMonths: 12, revenue: 1000000, cogs: 600000, payroll: 150000, opex: 100000, otherIncome: 0, depreciation: 20000, financeCost: 10000, tax: 30000,
  categories: [{ key: 'fuel', label: 'Fuel', monthly: 20000 }, { key: 'marketing', label: 'Marketing', monthly: 30000 }],
  cash: 500000, receivables: 1000000, payables: 700000, inventory: 200000, debt: 1200000, fixedAssets: 2000000, headcount: 10,
  customers: [{ id: 'c1', name: 'Alpha', monthlyRevenue: 300000, receivable: 300000 }, { id: 'c2', name: 'Beta', monthlyRevenue: 200000, receivable: 200000 }, { id: 'c3', name: 'Gamma', monthlyRevenue: 100000, receivable: 100000 }, { id: 'c4', name: 'Delta', monthlyRevenue: 50000, receivable: 50000 }],
  debtRepayments: Array(12).fill(50000), committedOut: [], committedIn: [], notes: [],
}

describe('the digital twin', () => {
  it('with no assumptions the base case repeats the books, and says what it rests on', () => {
    const r = simulate(BASE, [], 12)
    expect(r.label).toBe(SIMULATION)
    expect(r.months.length).toBe(12)
    expect(r.months.every((m) => m.revenue === 1000000 && m.cogs === 600000)).toBe(true)
    expect(r.months[0].operatingProfit).toBe(150000)
    expect(r.months[0].collections).toBe(1000000)          // nothing changes what customers owe, so what is billed is collected
    expect(r.months[11].debt).toBe(600000)
    expect(r.assumptions.join(' ')).toMatch(/average of the last 12 month/)
  })
  it('revenue falls 20%: cost of sales falls with it, payroll does not', () => {
    const r = simulate(BASE, [{ kind: 'revenue_pct', value: -20 }], 12)
    expect([r.months[0].revenue, r.months[0].cogs, r.months[0].payroll]).toEqual([800000, 480000, 150000])
    expect(r.months[0].operatingProfit).toBe(70000)
    expect(r.effects[0].text).toMatch(/Revenue -20%: 10,00,000 a month becomes 8,00,000/)
    expect(r.totals.closingCash).toBeLessThan(simulate(BASE, [], 12).totals.closingCash)
  })
  it('customers pay 30 days later: profit is unchanged, cash is not', () => {
    const base = simulate(BASE, [], 12); const r = simulate(BASE, [{ kind: 'collection_delay_days', value: 30 }], 12)
    expect(r.totals.profit).toBe(base.totals.profit)
    expect(r.months[0].receivables - base.months[0].receivables).toBeCloseTo(1000000 * 12 * 30 / 365, 0)
    expect(base.totals.closingCash - r.totals.closingCash).toBeCloseTo(1000000 * 12 * 30 / 365, 0)
  })
  it('"the top three customers pay 60 days late" delays only their share', () => {
    const all = simulate(BASE, [{ kind: 'collection_delay_days', value: 60 }], 6); const top = simulate(BASE, [{ kind: 'collection_delay_days', value: 60, target: 'top3' }], 6)
    const base = simulate(BASE, [], 6)
    expect((top.months[0].receivables - base.months[0].receivables) / (all.months[0].receivables - base.months[0].receivables)).toBeCloseTo(0.6, 3)
    expect(top.totals.borrowingRequirement).toBeGreaterThanOrEqual(0)
    expect(top.effects[0].text).toMatch(/three largest customers.*60% of revenue/)
  })
  it('a loan and an asset: cash in, cash out, interest and depreciation follow', () => {
    const r = simulate(BASE, [{ kind: 'new_borrowing', value: 10000000, from_month: 1, extra: 12, months: 50 }, { kind: 'capex', value: 5000000, from_month: 2, extra: 50 }], 12)
    expect(r.months[0].borrowed).toBe(10000000)
    expect(r.months[0].debt).toBe(1200000 - 50000 + 10000000)
    expect(r.months[1].repaid).toBe(50000 + 200000)
    expect(r.months[1].financeCost).toBeCloseTo((1150000 * 0.1) / 12 + (10000000 * 0.12) / 12, 0)
    expect(r.months[1].capex).toBe(5000000)
    expect(r.months[2].depreciation).toBe(20000 + 100000)
  })
  it('several shocks at once, and a named expense that doubles', () => {
    const shocks: Shock[] = [{ kind: 'revenue_pct', value: -25 }, { kind: 'collection_delay_days', value: 45 }, { kind: 'capex', value: 5000000, from_month: 3 }, { kind: 'category_pct', target: 'marketing', value: 100 }, { kind: 'payroll_pct', value: 15 }]
    const r = simulate(BASE, shocks, 12)
    expect(r.months[0].revenue).toBe(750000)
    expect(r.months[0].opex).toBe(130000)
    expect(r.months[0].payroll).toBe(172500)
    expect(r.totals.lowestCash).toBeLessThan(0)
    expect(r.totals.borrowingRequirement).toBe(-r.totals.lowestCash)
    expect(r.totals.monthsOfCashLeft).not.toBeNull()
  })
  it('an assumption that names a customer or a ledger the books do not show says so, and changes nothing', () => {
    const r = simulate(BASE, [{ kind: 'lose_customer', target: 'Nobody Ltd', value: 100 }, { kind: 'category_pct', target: 'helicopters', value: 50 }], 3)
    expect(r.months[0].revenue).toBe(1000000)
    expect(r.notes.join(' ')).toMatch(/"Nobody Ltd" is not among the customers/)
    expect(r.effects[1].text).toMatch(/changed nothing/)
  })
  it('an approved driver supplies the value; one that is not approved does not', () => {
    const s: Shock[] = [{ kind: 'payroll_pct', value: 5, driver_key: 'salary_rise' }]
    expect(simulate(BASE, s, 1, 'x', [{ key: 'salary_rise', name: 'Salary rise', value: 8, status: 'approved' }]).months[0].payroll).toBe(162000)
    const r = simulate(BASE, s, 1, 'x', [{ key: 'salary_rise', name: 'Salary rise', value: 8, status: 'proposed' }])
    expect(r.months[0].payroll).toBe(157500)
    expect(r.notes.join(' ')).toMatch(/is not approved/)
  })
  it('side by side: the base and the scenarios, with the change from the base', () => {
    const shocks: Shock[] = [{ kind: 'revenue_pct', value: -10 }]
    const cases = standardCases(shocks)
    expect(cases.map((c) => c.shocks[0].value)).toEqual([-5, -15])
    const rows = compare([simulate(BASE, [], 12), simulate(BASE, shocks, 12, 'A'), simulate(BASE, cases[1].shocks, 12, 'Conservative')])
    const rev = rows.find((r) => r.key === 'revenue')!
    expect(rev.values).toEqual([12000000, 10800000, 10200000])
    expect(rev.changes).toEqual([null, -1200000, -1800000])
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(['revenue', 'profit', 'closingCash', 'closingDebt', 'closingWorkingCapital']))
  })
  it('valuation: every assumption is stated, and what cannot be valued is refused', () => {
    const r = simulate(BASE, [], 36)
    const fcf = freeCashFlows(r, BASE.receivables + BASE.inventory - BASE.payables)
    expect(fcf.length).toBe(3)
    const v = dcf({ cashFlows: fcf, discountPct: 14, terminalGrowthPct: 4, debt: 1200000, cash: 500000 })
    expect(v.label).toBe('ESTIMATE')
    expect(v.equityValue).toBeCloseTo(v.enterpriseValue - 1200000 + 500000, 2)
    expect(v.sensitivity.length).toBe(9)
    expect(v.assumptions.join(' ')).toMatch(/discounted at 14% a year/)
    expect(dcf({ cashFlows: fcf, discountPct: 4, terminalGrowthPct: 4, debt: 0, cash: 0 }).refused).toMatch(/must be higher/)
    expect(freeCashFlows(simulate(BASE, [], 18), 0).length).toBe(1)     // half a year is left out, not scaled up
    expect(byMultiples([{ metric: 'EBITDA', value: 1800000, multiple: 8, source: '' }], 0, 0)[0].refused).toMatch(/without its source/)
    expect(byAssets(5000000, 2000000, [{ label: 'Land at market', amount: 800000, basis: 'Registered valuer, March' }, { label: 'Brand', amount: 900000, basis: '' }])).toMatchObject({ bookNetAssets: 3000000, adjusted: 3800000 })
  })
})

describe('reality', () => {
  const po = { id: 'po1', company_id: 'c', kind: 'purchase_order', doc_no: 'PO-1', doc_date: '2026-09-01', party_id: 'v', parent_id: null, status: 'partially_received', fx_rate: 1, subtotal: 100000, lines: [{ quantity: 100 }] }
  const grn = { id: 'g1', company_id: 'c', kind: 'goods_receipt', doc_no: 'GRN-1', doc_date: '2026-09-05', party_id: 'v', parent_id: 'po1', status: 'confirmed', fx_rate: 1, subtotal: 82000, lines: [{ quantity: 82 }] }
  const bill = { id: 'b1', company_id: 'c', doc_type: 'purchase_bill', doc_no: 'BILL-1', party_id: 'v', doc_date: '2026-09-06', fx_rate: 1, subtotal: 100000, tax_total: 18000, total: 118000, amount_settled: 118000, status: 'paid', journal_id: 'j1', po_id: 'po1' }
  const input = (extra: object = {}) => ({ asOf: '2026-09-30', materiality: { c: 5000 }, purchaseDocs: [po, grn], invoices: [bill], ...extra }) as never

  it('the example of the specification: 100 ordered, 100 billed, 82 received, 100 paid — reality does not reconcile', () => {
    const f = findDifferences(input())
    expect(f.length).toBe(1)
    expect(f[0].differs.sort()).toEqual(['cash', 'operation'])
    expect(f[0].amount).toBe(18000)
    expect(f[0].material).toBe(true)
    expect(f[0].readings.operation!.says).toMatch(/82 units/)
    expect(f[0].explanation).toMatch(/18,000 has been billed for what no receipt confirms/)
    expect(f[0].explanation).not.toMatch(/fraud|theft|suspicious/i)
    expect(f[0].links.map((l) => l.label)).toEqual(['PO-1', 'GRN-1', 'BILL-1'])
  })
  it('when everything agrees there is nothing to report', () => {
    expect(findDifferences(input({ purchaseDocs: [po, { ...grn, subtotal: 100000, lines: [{ quantity: 100 }] }] }))).toEqual([])
  })
  it('goods received but not taken into stock differ in the physical reality', () => {
    const full = { ...grn, subtotal: 100000, lines: [{ quantity: 100 }] }
    const f = findDifferences(input({ purchaseDocs: [po, full], stockDocs: [{ id: 's1', company_id: 'c', kind: 'receipt', status: 'posted', doc_no: 'SR-1', purchase_doc_id: 'g1', total_value: 70000 }] }))
    expect(f[0].differs).toEqual(['physical'])
    expect(f[0].amount).toBe(30000)
  })
  it('five separate counts, never one score; and what was never checked is said', () => {
    const i = input({ assets: [{ id: 'a1', status: 'active', cost: 1000, accumulated_depreciation: 0 }], cashBoxes: [{ id: 'x', is_active: true }] })
    const h = realityHealth(i)
    expect(h.map((r) => r.dimension)).toEqual(['document', 'operation', 'accounting', 'cash', 'physical'])
    expect(h.find((r) => r.dimension === 'operation')).toMatchObject({ checked: 1, agree: 0, differ: 1 })
    expect(h.find((r) => r.dimension === 'document')).toMatchObject({ checked: 1, agree: 1 })
    expect(h.every((r) => r.method.length > 20)).toBe(true)
    expect(notChecked(i)).toEqual(['1 active asset(s) have never been physically verified.', '1 cash box(es) have never been counted.'])
  })
  it('an advance: released above what was approved, held past its date, claimed without receipts', () => {
    const adv = { id: 'ad', company_id: 'c', advance_no: 'ADV-1', recipient_party_id: 'p', approved_amount: 50000, released_amount: 60000, settled_amount: 20000, returned_amount: 0, expected_settlement_date: '2026-09-01', created_at: '2026-08-01T00:00:00Z', released_on: '2026-08-02' }
    const claim = { id: 'cl', advance_id: 'ad', claim_no: 'CLM-1', status: 'approved', lines: [{ amount: 12000, has_receipt: true }, { amount: 8000, has_receipt: false }] }
    const f = findDifferences({ asOf: '2026-09-30', materiality: {}, advances: [adv], claims: [claim] } as never)[0]
    expect(f.differs.sort()).toEqual(['cash', 'document', 'operation'])
    expect(f.explanation).toMatch(/10,000 more was released than was approved.*8,000 of what was claimed carries no receipt.*40,000 is still held 29 day/)
    expect(f.explanation).toMatch(/stated without a conclusion/)
  })
})

describe('inventory exposure', () => {
  const it1 = { id: 'i1', sku: 'KIT', name: 'Sterile kit', unit: 'pcs', status: 'active', qty_on_hand: 100, value_on_hand: 5000, qty_reserved: 0, reorder_level: 120, reorder_qty: 200, slow_after_days: 90 } as unknown as InvItem
  const it2 = { id: 'i2', sku: 'BOLT', name: 'Bolt', unit: 'pcs', status: 'active', qty_on_hand: 50, value_on_hand: 500, qty_reserved: 10, reorder_level: 20, reorder_qty: 100, slow_after_days: null } as unknown as InvItem
  const lots = [{ id: 'l1', item_id: 'i1', lot_no: 'A', expiry_date: '2026-09-20' }, { id: 'l2', item_id: 'i1', lot_no: 'B', expiry_date: '2026-10-20' }, { id: 'l3', item_id: 'i1', lot_no: 'C', expiry_date: '2027-06-30' }] as unknown as InvLot[]
  const row = (item_id: string, lot_id: string | null, qty: number, last_in: string, last_out: string | null = null) => ({ company_id: 'c', item_id, warehouse_id: 'w', lot_id, qty, pending_out: 0, pending_in: 0, last_in, last_out }) as unknown as StockRow
  const rows = [row('i1', 'l1', 20, '2026-01-01'), row('i1', 'l2', 30, '2026-05-01', '2026-09-25'), row('i1', 'l3', 50, '2026-02-01'), row('i2', null, 50, '2025-01-01', '2026-09-01')]

  it('exposure is shown under one heading only, the most serious, and is never added to posted loss', () => {
    const holds = [{ id: 'h', item_id: 'i2', warehouse_id: 'w', lot_id: null, qty: 5, condition: 'damaged', noted_on: '2026-09-10', note: 'Rusted', status: 'open' }] as unknown as InvHold[]
    const x = lossExposure([it1, it2], rows, lots, holds, '2026-09-30')
    expect(x.map((r) => [r.kind, r.item.sku, r.qty.toNumber(), r.value.toNumber()])).toEqual([
      ['slow_moving', 'KIT', 50, 2500], ['near_expiry', 'KIT', 30, 1500], ['expired', 'KIT', 20, 1000], ['damaged', 'BOLT', 5, 50],
    ])
    expect(x.find((r) => r.kind === 'expired')!.says).toMatch(/expired on 2026-09-20, 10 day/)
    expect(exposureTotals(x).map((t) => [t.kind, t.value.toNumber()])).toEqual([['expired', 1000], ['near_expiry', 1500], ['damaged', 50], ['slow_moving', 2500]])
  })
  it('what is at or below its level is listed for a person to order', () => {
    const r = reorderList([it1, it2], rows)
    expect(r.map((x) => [x.item.sku, x.free.toNumber(), x.suggested.toNumber()])).toEqual([['KIT', 100, 200]])
  })
  it('book quantity against physical quantity', () => {
    const c = countDifferences([{ book_qty: 120, counted_qty: 117, unit_cost: 12, reason_code: 'shrinkage' }, { book_qty: 20, counted_qty: 21, unit_cost: 50, reason_code: null }, { book_qty: 5, counted_qty: 5, unit_cost: 100, reason_code: null }, { book_qty: 9, counted_qty: null, unit_cost: 1, reason_code: null }] as never)
    expect(c).toMatchObject({ counted: 3, notCounted: 1, agree: 1, differ: 2, withoutReason: 1 })
    expect([c.shortValue.toNumber(), c.overValue.toNumber()]).toEqual([36, 50])
  })
})

describe('investments', () => {
  it('a valuation of a holding at cost stands beside the books', () => {
    const p = holdingPosition({ cost: 300000, fv_adjustment: 0, fair_value: 420000, fair_value_date: '2026-09-20', measurement: 'cost', quantity: 600 } as never, '2026-09-30')
    expect([p.carrying.toNumber(), p.beside!.toNumber(), p.inBooks]).toEqual([300000, 120000, 'cost'])
    expect(p.says).toMatch(/that figure is not in the books/)
  })
  it('the multiples of a fund carry their formulas, and none is shown without its divisor', () => {
    const fund = { id: 'f', units_outstanding: 21000 }
    const cs = [{ fund_id: 'f', status: 'active', committed_amount: 6000000, called_amount: 1500000, contributed_amount: 1500000, distributed_amount: 50000 }, { fund_id: 'f', status: 'active', committed_amount: 4000000, called_amount: 1000000, contributed_amount: 600000, distributed_amount: 0 }]
    const s = fundSummary(fund as never, cs as never, [{ fund_id: 'f', status: 'approved', nav_date: '2026-09-30', net_assets: 2310000 }] as never)
    expect([s.committed.toNumber(), s.uncalled.toNumber(), s.outstandingCalls.toNumber()]).toEqual([10000000, 7500000, 400000])
    expect(s.multiples.map((m) => m.value?.toNumber())).toEqual([0.0238, 1.1, 1.1238])
    expect(fundSummary(fund as never, [], []).multiples.every((m) => m.value === null)).toBe(true)
  })
  it('the group as a tree: what is held through another company is the product of the percentages', () => {
    const companies = [{ id: 'h', name: 'Holdings' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'z', name: 'Alone' }]
    const links = [{ id: '1', parent_company_id: 'h', parent_party_id: null, child_company_id: 'a', child_party_id: null, relation: 'subsidiary', ownership_pct: 80 }, { id: '2', parent_company_id: 'a', parent_party_id: null, child_company_id: 'b', child_party_id: null, relation: 'subsidiary', ownership_pct: 60 }]
    const t = corporateTree(links as never, companies as never, [], '2026-09-30')
    expect(t.roots.length).toBe(1)
    expect(t.roots[0].children[0].children[0]).toMatchObject({ name: 'B', relation: 'subsidiary' })
    expect(t.roots[0].children[0].children[0].effectivePct!.toNumber()).toBe(48)
    expect(t.unplaced.map((c) => c.name)).toEqual(['Alone'])
  })
})

describe('analysis', () => {
  const accounts = [{ id: 'r', type: 'income', subtype: 'revenue', code: '4000', name: 'Sales' }, { id: 'x', type: 'expense', subtype: 'operating_expense', code: '6210', name: 'Rent' }] as unknown as Account[]
  it('year on year: a year that is not complete is compared as it stands, never scaled up', () => {
    const rows = [
      ...['2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03'].map((m) => ({ account_id: 'r', month: m + '-01', debit: 0, credit: 100 })),
      ...['2025-04', '2025-05', '2025-06'].map((m) => ({ account_id: 'r', month: m + '-01', debit: 0, credit: 150 })),
      { account_id: 'x', month: '2024-04-01', debit: 300, credit: 0 },
    ]
    const y = yearOnYear(rows as never, accounts, 4, '2025-06-30')
    expect(y.years).toEqual([2024, 2025])
    const rev = y.rows.find((r) => r.key === 'revenue')!
    expect([rev.byYear[2024].toNumber(), rev.byYear[2025].toNumber()]).toEqual([1200, 450])
    expect(rev.changes[2025].pct!.toNumber()).toBe(-62.5)
    expect(y.complete[2025]).toEqual({ months: 3, complete: false })
    expect(y.notes.join(' ')).toMatch(/FY2025 holds 3 month\(s\) of entries so far.*not scaled/)
    expect(y.rows.find((r) => r.key === 'operating_profit')!.byYear[2024].toNumber()).toBe(900)
  })
  it('burn rate: cash falling is measured, cash rising is said, too little data is refused', () => {
    const b = burnRate([1000, 900, 780, 700, 610, 500, 400].map((c, i) => ({ month: `2026-0${i + 1}`, closing: c })))
    expect([b.consuming, b.monthlyBurn.toNumber(), b.runway!.toNumber()]).toEqual([true, 100, 4])
    expect(burnRate([100, 200, 300, 400].map((c, i) => ({ month: `2026-0${i + 1}`, closing: c }))).says).toMatch(/not consuming cash/)
    expect(burnRate([{ month: '2026-01', closing: 5 }, { month: '2026-02', closing: 4 }]).says).toMatch(/false precision/)
  })
  it('an unusual entry is measured against its own ledger and explained, not accused', () => {
    const lines = [900, 1000, 1100, 950, 1050, 1000, 980, 1020, 990, 9000].map((a, i) => ({ id: 'l' + i, account_id: 'x', debit: a, credit: 0 })) as unknown as LedgerLine[]
    const u = unusualEntries(lines, accounts)
    expect(u.length).toBe(1)
    expect(u[0].amount).toBe(9000)
    expect(u[0].why).toMatch(/usually carries about 1,000 an entry.*9,000.*whether it is in order is for a person to say/)
    expect(u[0].why).not.toMatch(/fraud|suspicious|wrong/i)
    expect(unusualEntries(lines.slice(0, 5), accounts)).toEqual([])
  })
  it('the books of the earlier system beside NUMERO: ledger by ledger, and ready only when nothing differs', () => {
    const acc = [{ id: 'b', code: '1000', name: 'Bank' }, { id: 'c', code: '3100', name: 'Capital' }, { id: 'x', code: '6210', name: 'Rent' }] as unknown as Account[]
    const legacy = [{ legacy_code: '1000', legacy_name: 'Bank', account_id: 'b', debit: 500, credit: 0 }, { legacy_code: 'CAP', legacy_name: 'Capital', account_id: null, debit: 0, credit: 500 }] as unknown as LegacyBalance[]
    const p = parallelRun(legacy, [{ account_id: 'b', closing: 480 }, { account_id: 'x', closing: 20 }], acc)
    expect(p.rows.map((r) => [r.name, r.state, r.difference.toNumber()])).toEqual([['Capital', 'not mapped', 500], ['1000 · Bank', 'differs', -20], ['6210 · Rent', 'only in NUMERO', 20]])
    expect(p.ready).toBe(false)
    expect(parallelRun([{ legacy_code: '1000', account_id: 'b', debit: 480, credit: 0 }] as never, [{ account_id: 'b', closing: 480 }], acc).ready).toBe(true)
  })
  it('a rule is tried against what is already on record before it is put in force', () => {
    const h = [{ entity: 'journal', company_id: 'c', amount: 50000, steps: ['*'] }, { entity: 'journal', company_id: 'c', amount: 600000, steps: ['*'] }, { entity: 'journal', company_id: 'c', amount: 900000, steps: ['*', 'finance_head'] }, { entity: 'advance', company_id: 'c', amount: 900000, steps: ['*'] }] as unknown as ApprovalRequest[]
    const t = tryApprovalRule({ name: 'Large entries', entity: 'journal', company_id: 'c', min_amount: 500000, max_amount: null, steps: ['finance_head', 'company_director'] }, h)
    expect([t.examined, t.caught, t.amount.toNumber(), t.stepsAdded]).toEqual([3, 2, 1500000, 1])
    expect(tryApprovalRule({ name: 'x', entity: 'capital_call', company_id: null, min_amount: 0, max_amount: null, steps: ['*'] }, h).says).toMatch(/nothing to try this rule against/)
    const alerts = [{ kind: 'large_payment', status: 'false_positive', evidence: { amount: 510000 } }, { kind: 'large_payment', status: 'open', evidence: { amount: 2000000 } }] as unknown as Alert[]
    expect(tryThreshold(alerts, 'large_payment', 1000000, (a) => Number((a.evidence as { amount: number }).amount)).says).toMatch(/1 would still have been raised.*spared 1/)
  })
  it('who attends to what: the rule of the group decides, and the owner is shown only what needs the owner', () => {
    const rules = [{ kind: 'large_payment', min_amount: 5000000, class: 'owner_action' }, { kind: '*', min_amount: 0, class: 'finance_action' }] as never
    expect(attentionOf({ kind: 'large_payment', attention: 'review', evidence: { amount: 7500000 } }, rules)).toBe('owner_action')
    expect(attentionOf({ kind: 'large_payment', attention: 'priority', evidence: { amount: 100000 } }, rules)).toBe('finance_action')
    expect(attentionOf({ kind: 'duplicate', attention: 'critical', evidence: {} }, [])).toBe('critical')
    expect(forOwner([{ class: 'information' }, { class: 'owner_action' }, { class: 'critical' }, { class: 'finance_action' }] as never).owner.length).toBe(2)
  })
  it('deadlines across companies', () => {
    const items = [{ id: '1', company_id: 'a', kind: 'compliance', status: 'active', state: 'active', next_due: '2026-09-25', title: 'GST return' }, { id: '2', company_id: 'a', kind: 'compliance', status: 'active', state: 'active', next_due: '2026-10-03', title: 'TDS' }, { id: '3', company_id: 'b', kind: 'compliance', status: 'active', state: 'paid', next_due: '2026-09-01', title: 'Filed' }, { id: '4', company_id: 'b', kind: 'rent', status: 'active', state: 'active', next_due: '2026-10-01', title: 'Rent' }] as never
    const v = complianceView(items, '2026-09-30')
    expect(v.rows.map((r) => [r.item.title, r.state, r.days])).toEqual([['GST return', 'overdue', -5], ['TDS', 'this week', 3]])
    expect(v.byCompany).toEqual([{ company_id: 'a', overdue: 1, week: 1, month: 0, later: 0 }])
  })
})

describe('what the builders of the screens found in the engines', () => {
  const base: TwinBase = {
    asOf: '2026-09-27', currency: 'INR', scope: 'Test', basisMonths: 6, revenue: 1000, cogs: 400, payroll: 200, opex: 100, otherIncome: 0, depreciation: 0, financeCost: 0, tax: 0,
    categories: [], cash: 5000, receivables: 0, payables: 0, inventory: 0, debt: 0, fixedAssets: 0, headcount: 10,
    customers: [{ id: 'c1', name: 'Alpha', monthlyRevenue: 300, receivable: 0 }], debtRepayments: [], committedOut: [], committedIn: [], notes: [],
  }
  it('a project without a stated duration lasts twelve months, not for as long as the model looks ahead', () => {
    const r = simulate(base, [{ kind: 'new_project', value: 12000, from_month: 1, extra: 50 }], 24)
    expect(r.months[0].revenue).toBe(2000)
    expect(r.months[11].revenue).toBe(2000)
    expect(r.months[12].revenue).toBe(1000)
    expect(r.totals.revenue).toBe(24 * 1000 + 12000)
  })
  it('a customer lost without a name changes nothing, and the model says so', () => {
    const r = simulate(base, [{ kind: 'lose_customer', value: 100, from_month: 1 }], 6)
    expect(r.months[0].revenue).toBe(1000)
    expect(r.notes.filter((n) => /names no customer/.test(n)).length).toBe(1)
    expect(simulate(base, [{ kind: 'lose_customer', value: 100, from_month: 1, target: 'Alpha' }], 6).months[0].revenue).toBe(700)
  })
  it('a driver in use stays in use while its successor awaits approval', async () => {
    const e = new DemoEngine()
    e.actor = 'demo-finance'
    const first = await e.saveTwinDriver({ company_id: null, key: 'rate', name: 'Rate', value: 8, basis: 'Board minute' })
    e.actor = 'demo-owner'
    await e.decideTwinDriver(first, 'approved')
    e.actor = 'demo-finance'
    const second = await e.saveTwinDriver({ company_id: null, key: 'rate', name: 'Rate', value: 10, basis: 'Board minute of June' })
    expect((await e.listTwinDrivers()).filter((d) => d.status === 'approved').map((d) => Number(d.value))).toEqual([8])
    // a second proposal takes the place of the first proposal, not of the driver in use
    const third = await e.saveTwinDriver({ company_id: null, key: 'rate', name: 'Rate', value: 11, basis: 'Board minute of July' })
    expect(e.twinDrivers.find((d) => d.id === second)!.status).toBe('retired')
    expect((await e.listTwinDrivers()).filter((d) => d.status === 'approved').map((d) => Number(d.value))).toEqual([8])
    e.actor = 'demo-owner'
    await e.decideTwinDriver(third, 'approved')
    expect((await e.listTwinDrivers()).filter((d) => d.status === 'approved').map((d) => Number(d.value))).toEqual([11])
    expect(e.twinDrivers.find((d) => d.id === first)!.status).toBe('retired')
    // a driver in use can be retired
    await e.decideTwinDriver(third, 'retired')
    expect((await e.listTwinDrivers()).length).toBe(0)
  })
})

describe('what the assessment of release 0.3.0 found', () => {
  const base: TwinBase = {
    asOf: '2026-09-27', currency: 'INR', scope: 'Test', basisMonths: 6, revenue: 1000, cogs: 400, payroll: 200, opex: 100, otherIncome: 0, depreciation: 0, financeCost: 0, tax: 0,
    categories: [], cash: 5000, receivables: 0, payables: 0, inventory: 0, debt: 0, fixedAssets: 0, headcount: 10,
    customers: [{ id: 'c1', name: 'Alpha', monthlyRevenue: 300, receivable: 0 }], debtRepayments: [], committedOut: [], committedIn: [], notes: [],
  }
  it('a driver supplies an assumption only in its own unit', () => {
    const shock = { kind: 'revenue_pct', value: 5, from_month: 1, driver_key: 'd', label: 'Growth' } as Shock
    const days = simulate(base, [shock], 3, 'x', [{ key: 'd', name: 'Credit period', value: '45', status: 'approved', unit: 'days' }])
    expect(days.months[0].revenue).toBe(1050)      // the value typed, not 45 percent
    expect(days.notes.some((n) => /is stated in days; the assumption "Growth" is in percent\. The driver was not used/.test(n))).toBe(true)
    const pct = simulate(base, [shock], 3, 'x', [{ key: 'd', name: 'Growth agreed', value: '10', status: 'approved', unit: 'percent' }])
    expect(pct.months[0].revenue).toBe(1100)
    expect([driverFits('rate', 'points'), driverFits('percent', 'points'), driverFits('amount', 'percent'), driverFits('count', 'count')]).toEqual([true, true, false, true])
  })
  it('customers who pay sooner free cash, and the model says sooner', () => {
    const b = { ...base, receivables: 3000 }
    const still = simulate(b, [], 3)
    const sooner = simulate(b, [{ kind: 'collection_delay_days', value: -10, from_month: 1 }], 3)
    const later = simulate(b, [{ kind: 'collection_delay_days', value: 10, from_month: 1 }], 3)
    expect(sooner.months[0].cash).toBeGreaterThan(still.months[0].cash)
    expect(later.months[0].cash).toBeLessThan(still.months[0].cash)
    expect(sooner.effects[0].text).toMatch(/pay 10 days sooner.*money owed falls by about/)
    expect(later.effects[0].text).toMatch(/pay 10 days later.*money owed rises by about/)
    expect(simulate(b, [{ kind: 'payment_delay_days', value: -5, from_month: 1 }], 3).effects[0].text).toMatch(/paid 5 days sooner/)
  })
  it('a rule tried on history states its amounts company by company: currencies are not added', () => {
    const req = (id: string, company_id: string, amount: number) => ({ id, company_id, entity: 'journal', entity_id: id, amount, steps: ['a'], status: 'approved' })
    const t = tryApprovalRule({ name: 'x', entity: 'journal', company_id: null, min_amount: 1000, max_amount: null, steps: ['a', 'b'] }, [req('1', 'inr', 5000), req('2', 'usd', 2000), req('3', 'inr', 3000), req('4', 'inr', 10)] as never)
    expect(t.caught).toBe(3)
    expect(t.amounts.map((a) => [a.company_id, a.amount.toNumber()]).sort()).toEqual([['inr', 8000], ['usd', 2000]])
  })
  it('a commitment that has ended counts for what was called of it: nothing of it remains to be called', () => {
    const cs = [{ fund_id: 'f', status: 'active', committed_amount: 6000000, called_amount: 1500000, contributed_amount: 1500000, distributed_amount: 0 }, { fund_id: 'f', status: 'transferred', committed_amount: 4000000, called_amount: 1000000, contributed_amount: 1000000, distributed_amount: 0 }]
    const s = fundSummary({ id: 'f', units_outstanding: 25000 } as never, cs as never, [])
    expect([s.committed.toNumber(), s.called.toNumber(), s.uncalled.toNumber()]).toEqual([7000000, 2500000, 4500000])
    expect(s.notes.some((n) => /1 commitment\(s\) have ended/.test(n))).toBe(true)
  })

  // ------------------------------------------------------------ reality
  const po = { id: 'po1', company_id: 'c', kind: 'purchase_order', doc_no: 'PO-1', doc_date: '2026-09-01', party_id: 'v', parent_id: null, status: 'partially_received', fx_rate: 1, subtotal: 100000, lines: [{ quantity: 100 }] }
  const grn = { id: 'g1', company_id: 'c', kind: 'goods_receipt', doc_no: 'GRN-1', doc_date: '2026-09-05', party_id: 'v', parent_id: 'po1', status: 'confirmed', fx_rate: 1, subtotal: 100000, lines: [{ quantity: 100 }] }
  const bill = { id: 'b1', company_id: 'c', doc_type: 'purchase_bill', doc_no: 'BILL-1', party_id: 'v', doc_date: '2026-09-06', fx_rate: 1, subtotal: 100000, tax_total: 18000, total: 118000, amount_settled: 0, status: 'open', journal_id: 'j1', po_id: 'po1' }
  it('a difference keeps its key while what differs changes, so its case stays with it', () => {
    const short = { ...grn, subtotal: 82000 }
    const one = findDifferences({ asOf: '2026-09-30', materiality: {}, purchaseDocs: [po, short], invoices: [bill] } as never)
    const two = findDifferences({ asOf: '2026-09-30', materiality: {}, purchaseDocs: [po, short], invoices: [{ ...bill, amount_settled: 118000, status: 'paid' }] } as never)
    expect(one[0].differs).toEqual(['operation'])
    expect([...two[0].differs].sort()).toEqual(['cash', 'operation'])
    expect([one[0].key, two[0].key]).toEqual(['purchase:po1', 'purchase:po1'])
  })
  it('a sale in another currency is stated in the currency of the company', () => {
    const inv = { id: 'i1', company_id: 'c', doc_type: 'sales_invoice', doc_no: 'INV-1', party_id: 'p', doc_date: '2026-09-01', fx_rate: 83, total: 1000, amount_settled: 0, status: 'open', journal_id: null }
    const f = findDifferences({ asOf: '2026-09-30', materiality: { c: 50000 }, invoices: [inv] } as never)[0]
    expect([f.key, f.amount, f.material, f.readings.document!.value]).toEqual(['sale:i1', 83000, true, 83000])
  })
  it('physical reality counts what it can find to differ: orders whose goods were received are among those checked', () => {
    const stockDocs = [{ id: 's1', company_id: 'c', kind: 'receipt', status: 'posted', doc_no: 'SR-1', purchase_doc_id: 'g1', total_value: 70000 }]
    const h = realityHealth({ asOf: '2026-09-30', materiality: {}, purchaseDocs: [po, grn], invoices: [bill], stockDocs } as never).find((r) => r.dimension === 'physical')!
    expect(h).toMatchObject({ checked: 1, agree: 0, differ: 1 })
    expect(h.method).toMatch(/orders whose goods received were taken into stock/)
    const ok = realityHealth({ asOf: '2026-09-30', materiality: {}, purchaseDocs: [po, grn], invoices: [bill], stockDocs: [{ ...stockDocs[0], total_value: 100000 }] } as never).find((r) => r.dimension === 'physical')!
    expect(ok).toMatchObject({ checked: 1, agree: 1, differ: 0 })
  })
  it('what a verification of stock, cash or documents found reaches Reality; the last sheet of a place stands for it', () => {
    const sheet = (id: string, subject: string, run_date: string, status: string, differ: number, scope: object = { warehouse_id: 'w1' }) => ({ id, company_id: 'c', verify_no: 'VER-' + id, subject, run_date, created_at: run_date, status, scope, summary: { lines: 10, agree: 10 - differ, differ, not_checked: 0, book_value: 50000, book_value_of_differences: differ * 1000 } })
    const i = { asOf: '2026-09-30', materiality: { c: 1500 }, verifications: [sheet('1', 'inventory', '2026-08-01', 'completed', 4), sheet('2', 'inventory', '2026-09-20', 'completed', 2), sheet('3', 'inventory', '2026-09-25', 'open', 0), sheet('4', 'documents', '2026-09-10', 'completed', 0, {}), sheet('5', 'assets', '2026-09-10', 'completed', 3, {}), sheet('6', 'cash', '2026-09-12', 'cancelled', 5, {})] } as never
    const f = findDifferences(i)
    expect(f.map((x) => [x.key, x.chain, x.differs, x.amount, x.material])).toEqual([['verification:2', 'verification', ['physical'], 2000, true]])
    expect(f[0].title).toMatch(/2 item\(s\) of stock were found otherwise than the books say/)
    expect(f[0].explanation).not.toMatch(/fraud|theft|suspicious/i)
    expect(f[0].links).toEqual([{ entity: 'verification_runs', entity_id: '2', label: 'VER-2' }])
    const h = realityHealth(i)
    expect(h.find((r) => r.dimension === 'physical')).toMatchObject({ checked: 1, agree: 0, differ: 1 })
    expect(h.find((r) => r.dimension === 'document')).toMatchObject({ checked: 1, agree: 1, differ: 0 })
  })
  it('a report states the reconciliation of the records it rests on, and of no others', () => {
    const f = (key: string, chain: string, differs: string[], material: boolean) => ({ key, chain, differs, material, amount: 100, company_id: 'c' })
    const all = [f('bank:1', 'bank', ['cash'], true), f('sale:1', 'sale', ['accounting'], false), f('purchase:1', 'purchase', ['operation', 'cash'], true), f('asset:1', 'asset', ['physical'], false), f('verification:1', 'verification', ['physical'], true)] as never
    const keys = (report: string) => realityOfReport(report, all)!.findings.map((x) => x.key).sort()
    expect(keys('balance-sheet')).toEqual(['asset:1', 'bank:1', 'purchase:1', 'sale:1', 'verification:1'])
    expect(keys('pnl')).toEqual(['purchase:1', 'sale:1'])
    expect(keys('ageing')).toEqual(['purchase:1', 'sale:1'])
    expect(keys('cash-book')).toEqual(['bank:1', 'purchase:1'])      // the order whose payment does not agree is a matter of money
    expect(keys('money-came')).toEqual(['sale:1'])
    const bs = realityOfReport('balance-sheet', all)!
    expect([bs.material, bs.byChain.length, bs.dimensions.length]).toEqual([3, 5, 5])
    expect(realityOfReport('cash-flow', [])).toMatchObject({ findings: [], material: 0, byChain: [] })
    expect(realityOfReport('no-such-report', all)).toBeNull()
    // every report of the library that rests on records is named
    expect(Object.keys(REPORT_REALITY).sort()).toEqual(['ageing', 'balance-sheet', 'cash-book', 'cash-flow', 'consolidated', 'money-came', 'money-went', 'pnl', 'ratios', 'registers', 'trial-balance'])
  })
  it('an advance with no date set for settling it is reported once it has been held thirty days', () => {
    const adv = { id: 'ad', company_id: 'c', advance_no: 'ADV-1', recipient_party_id: 'p', approved_amount: 50000, released_amount: 50000, settled_amount: 0, returned_amount: 0, expected_settlement_date: null, created_at: '2026-08-01T00:00:00Z', released_on: '2026-08-20' }
    const f = findDifferences({ asOf: '2026-09-30', materiality: {}, advances: [adv] } as never)
    expect(f[0].explanation).toMatch(/50,000 is still held 41 day\(s\) after it was released, and no date was set for settling it/)
    expect(findDifferences({ asOf: '2026-09-10', materiality: {}, advances: [adv] } as never)).toEqual([])
  })

  // ------------------------------------------------------------ in the engine of the sample data
  it('a verification opened by mistake is cancelled with a reason; what was completed stays', async () => {
    const w = await world()
    await w.e.saveCashBox({ company_id: w.co, name: 'HO petty cash', ledger_account_id: w.cash, float_amount: 5000 })
    const v = await w.e.openVerification({ company_id: w.co, subject: 'cash' })
    const l = (await w.e.getVerification(v)).lines![0]
    await w.e.recordVerification(v, [{ id: l.id, found_value: 4800, note: 'Two vouchers' }])
    await expect(w.e.cancelVerification(v, ' ')).rejects.toThrow(/reason is required/)
    await w.e.cancelVerification(v, 'Opened for the wrong company')
    const run = await w.e.getVerification(v)
    expect([run.status, run.note, run.lines!.length]).toEqual(['cancelled', 'Cancelled: Opened for the wrong company', 1])
    expect(w.e.alerts.filter((a) => a.kind === 'verification_difference').length).toBe(0)
    await expect(w.e.completeVerification(v, 'x')).rejects.toThrow(/is cancelled/)
    await expect(w.e.recordVerification(v, [{ id: l.id, found_value: 5000 }])).rejects.toThrow(/is cancelled/)
    const v2 = await w.e.openVerification({ company_id: w.co, subject: 'cash' })
    const l2 = (await w.e.getVerification(v2)).lines![0]
    await w.e.recordVerification(v2, [{ id: l2.id, found_value: 5000 }])
    await w.e.completeVerification(v2)
    await expect(w.e.cancelVerification(v2, 'Changed my mind')).rejects.toThrow(/What was completed stays/)
    expect(w.e.audit.some((a) => a.entity === 'verification_runs' && a.entity_id === v && a.reason === 'Opened for the wrong company')).toBe(true)
  })
  it('the owner is not told of every approval that waits: only of what the rules class for the owner', async () => {
    const w = await world()
    const submit = async (amount: number) => {
      const j = await w.e.saveJournalDraft({ company_id: w.co, journal_date: TODAY, narration: 'Rent', lines: [{ account_id: w.acc('6210'), debit: amount }, { account_id: w.bank, credit: amount }] })
      await w.e.submitJournal(j)
      return j
    }
    const told = async (who: string, j: ID) => (await as(w.e, who, () => w.e.listNotifications())).filter((n) => n.kind === 'approval_waiting' && n.entity_id === j)
    const routine = await submit(100)
    expect((await told(OWNER, routine)).length).toBe(0)
    expect((await told(CHECKER, routine)).length).toBe(1)
    await as(w.e, OWNER, () => w.e.saveAttentionRule({ kind: 'approval:journal', min_amount: 500000, class: 'owner_action', note: 'Above five lakh the owner decides' }))
    const large = await submit(750000)
    expect((await told(OWNER, large)).map((n) => [n.class, n.mandatory])).toEqual([['owner_action', true]])
    expect((await told(CHECKER, large)).length).toBe(1)
    expect((await told(OWNER, await submit(200))).length).toBe(0)
    // the owner still sees every request in the inbox of approvals: what is held back is the notice, not the right
    expect((await as(w.e, OWNER, () => w.e.listApprovalRequests([w.co]))).filter((r) => r.status === 'pending').length).toBe(3)
  })
  it('the class of an alert is worked out from its difference where it carries no amount, whichever way it points', async () => {
    const w = await world()
    await as(w.e, OWNER, () => w.e.saveAttentionRule({ kind: 'verification_difference', min_amount: 150, class: 'owner_action', note: 'Cash short by more than 150' }))
    await w.e.setMateriality(w.co, 100, null, 'Agreed')
    await w.e.saveCashBox({ company_id: w.co, name: 'HO petty cash', ledger_account_id: w.cash, float_amount: 5000 })
    const v = await w.e.openVerification({ company_id: w.co, subject: 'cash' })
    const l = (await w.e.getVerification(v)).lines![0]
    await w.e.recordVerification(v, [{ id: l.id, found_value: 4800, note: 'Two vouchers not yet entered' }])
    await w.e.completeVerification(v)
    const al = w.e.alerts.find((a) => a.kind === 'verification_difference')!
    expect(Number(al.evidence.difference)).toBe(-200)
    const n = (await as(w.e, CHECKER, () => w.e.listNotifications())).find((x) => x.kind === 'alert' && x.entity_id === (al.entity_id ?? al.id))!
    expect(n.class).toBe('owner_action')
    expect(attentionOf(al, await w.e.listAttentionRules())).toBe('owner_action')      // the screen and the notice say the same
  })
})

describe('what the second reading of the records found', () => {
  const sheet = (id: string, subject: string, o: { agree: number; differ: number; open?: number; bookOfDiffering?: number; lines?: object[] }) => ({
    id, company_id: 'c', verify_no: 'VER-' + id, subject, run_date: '2026-09-20', created_at: '2026-09-20', status: 'completed', scope: { place: id }, lines: o.lines,
    summary: { lines: o.agree + o.differ + (o.open ?? 0), agree: o.agree, differ: o.differ, not_checked: o.open ?? 0, book_value: 50000, book_value_of_differences: o.bookOfDiffering ?? 0 },
  })
  it('a sheet on which items were left unchecked is not a check that agrees', () => {
    const i = { asOf: '2026-09-30', materiality: {}, verifications: [sheet('1', 'cash', { agree: 3, differ: 0, open: 2 }), sheet('2', 'inventory', { agree: 4, differ: 0 }), sheet('3', 'cash', { agree: 0, differ: 0, open: 5 })] } as never
    expect(findDifferences(i)).toEqual([])
    expect(realityHealth(i).find((r) => r.dimension === 'physical')).toMatchObject({ checked: 1, agree: 1, differ: 0 })
    expect(notChecked(i)).toEqual(['Verification VER-1 left 2 item(s) unchecked: it is not counted as agreeing.', 'Verification VER-3 left 5 item(s) unchecked: it is not counted as agreeing.'])
  })
  it('what a sheet found is measured by the size of the difference, not by the value of what was looked at', () => {
    // a cash box of 5,000 found 200 short, and stock of 40 units at 25 each found 3 short
    const cash = sheet('1', 'cash', { agree: 0, differ: 1, bookOfDiffering: 5000, lines: [{ result: 'difference', book_value: 5000, found_value: 4800 }] })
    const stock = sheet('2', 'inventory', { agree: 1, differ: 1, bookOfDiffering: 1000, lines: [{ result: 'difference', book_qty: 40, book_value: 1000, found_qty: 37 }, { result: 'matched', book_qty: 10, book_value: 500, found_qty: 10 }] })
    const f = findDifferences({ asOf: '2026-09-30', materiality: { c: 150 }, verifications: [cash, stock] } as never)
    expect(f.map((x) => [x.key, x.amount, x.material])).toEqual([['verification:1', 200, true], ['verification:2', 75, false]])
    expect(f[0].readings.physical!.says).toMatch(/the differences come to 200 in all/)
    expect([sheetLineDifference('cash', { book_qty: null, book_value: 5000, found_qty: null, found_value: 4800 }), sheetLineDifference('inventory', { book_qty: 40, book_value: 1000, found_qty: 37, found_value: null }), sheetLineDifference('documents', { book_qty: null, book_value: 900, found_qty: null, found_value: null })]).toEqual([-200, -75, -900])
    // where the lines were not read, the figure is the book value of the items that differ, and the reading says so
    const bare = findDifferences({ asOf: '2026-09-30', materiality: {}, verifications: [{ ...cash, lines: undefined }] } as never)[0]
    expect(bare.amount).toBe(5000)
    expect(bare.readings.physical!.says).toMatch(/The books carry those items at 5,000; the size of each difference is on the sheet/)
  })
  it('stock that a verification looked at is not reported as never counted', () => {
    const items = [{ id: 'i', qty_on_hand: 5 }]
    expect(notChecked({ asOf: '2026-09-30', materiality: {}, invItems: items } as never)).toEqual(['1 item(s) are in stock, and no stock count or verification of stock has been completed.'])
    expect(notChecked({ asOf: '2026-09-30', materiality: {}, invItems: items, verifications: [sheet('1', 'inventory', { agree: 4, differ: 0 })] } as never)).toEqual([])
  })
  it('the reconciliation of a report is that of its period', () => {
    const f = (key: string, chain: string, date: string) => ({ key, chain, date, differs: ['accounting'], material: true, amount: 100, company_id: 'c' })
    const all = [f('sale:aug', 'sale', '2026-08-14'), f('sale:sep', 'sale', '2026-09-03'), f('purchase:oct', 'purchase', '2026-10-02')] as never
    const keys = (report: string, period?: { from?: string; to: string }) => realityOfReport(report, all, period)!.findings.map((x) => x.key)
    expect(keys('pnl', { from: '2026-09-01', to: '2026-09-30' })).toEqual(['sale:sep'])
    expect(keys('balance-sheet', { to: '2026-09-30' })).toEqual(['sale:aug', 'sale:sep'])      // as at a day: everything up to that day
    expect(keys('pnl').length).toBe(3)
    // differences that stand: a stock ledger found today, statement lines not in the books since August
    const standing = [f('stock:1', 'stock', '2026-09-30'), f('bank:1', 'bank', '2026-08-20'), f('bank:2', 'bank', '2026-10-05')] as never
    expect(realityOfReport('balance-sheet', standing, { to: '2026-09-15' })!.findings.map((x) => x.key)).toEqual(['stock:1', 'bank:1'])
    expect(realityOfReport('cash-book', standing, { from: '2026-09-01', to: '2026-09-30' })!.findings.map((x) => x.key)).toEqual(['bank:1'])
  })
  it('an investor whose commitment has ended has nothing left to be called', () => {
    const fund = { id: 'f', units_outstanding: 1000 }
    const of = (status: string) => investorStatement({ id: 'c', fund_id: 'f', status, committed_amount: 4000000, called_amount: 1000000, contributed_amount: 1000000, distributed_amount: 0, units: 100 } as never, fund as never, [], [], [], [])
    expect([of('active').uncalled.toNumber(), of('transferred').uncalled.toNumber(), of('transferred').called.toNumber()]).toEqual([3000000, 0, 1000000])
  })
  it('a statement line matched in part is not reconciled: the notice and the health of the system count it', async () => {
    const w = await world()
    const bank = await w.e.createBankAccount({ company_id: w.co, name: 'Test bank', kind: 'bank', ledger_account_id: w.bank, currency: 'INR' } as never)
    w.e.bankTxns.push({ id: 'bt1', company_id: w.co, bank_account_id: bank, txn_date: ago(20), amount: '1500', narration: 'Part matched', reference: null, status: 'partial', matched_line_id: null, fingerprint: 'bt1' })
    const health = await w.e.systemHealth()
    expect(health.bank_statements.statement_lines_unmatched).toBe(1)
    await as(w.e, CHECKER, () => w.e.refreshNotifications())
    expect((await as(w.e, CHECKER, () => w.e.listNotifications())).filter((n) => n.kind === 'reconciliation_incomplete').length).toBe(1)
  })
  it('a case opened on a line of a sheet is the case of that sheet in Reality', async () => {
    const w = await world()
    await w.e.setMateriality(w.co, 100, null, 'Agreed')
    await w.e.saveCashBox({ company_id: w.co, name: 'HO petty cash', ledger_account_id: w.cash, float_amount: 5000 })
    const v = await w.e.openVerification({ company_id: w.co, subject: 'cash' })
    const l = (await w.e.getVerification(v)).lines![0]
    await w.e.recordVerification(v, [{ id: l.id, found_value: 4800, note: 'Two vouchers not yet entered' }])
    await w.e.completeVerification(v)
    const before = await loadReality(w.e, w.e.accounts, [w.co])
    const found = before.findings.find((f) => f.key === 'verification:' + v)!
    expect([found.amount, found.material]).toEqual([200, true])      // the lines of the sheet were read: 200, not the 5,000 of the box
    expect(before.cases.get(found.key)).toBeUndefined()
    const c = await w.e.openCase({ company_id: w.co, kind: 'verification', title: 'Petty cash short', summary: 'x', dedupe_key: 'verification:' + l.id, links: [{ entity: 'cash_boxes', entity_id: l.entity_id, label: 'HO petty cash' }, { entity: 'verification_runs', entity_id: v, label: 'VER' }] })
    const after = await loadReality(w.e, w.e.accounts, [w.co])
    expect(after.cases.get('verification:' + v)?.id).toBe(c)
  })
})
