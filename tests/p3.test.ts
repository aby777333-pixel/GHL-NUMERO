import { beforeEach, describe, expect, it } from 'vitest'
import { DemoEngine } from '../src/api/demo'
import { buildCompanyPayload } from '../src/engine/templates'
import { D } from '../src/lib/money'
import { addDays, addMonths, startOfMonth, today } from '../src/lib/dates'
import type { ID } from '../src/engine/types'
import { lossExposure } from '../src/engine/stock'

// =====================================================================
// Phase 3 — inventory, investments, reality and control, simulations,
// the scenario studio and the platform, in the sample-data engine.
// Every rule tested here is also enforced by the database and tested
// there in tests/sql/phase3_*.sql.
// =====================================================================

const OWNER = 'demo-owner', MAKER = 'demo-accountant', CHECKER = 'demo-finance'
const TODAY = today()
const M1 = startOfMonth(addMonths(TODAY, -2))
const ago = (n: number) => addDays(TODAY, -n)

interface World { e: DemoEngine; co: ID; co2: ID; acc: (code: string, company?: ID) => ID; bank: ID; cash: ID; fin: ID; ops: ID; emp: ID; vendor: ID; customer: ID }
async function world(): Promise<World> {
  const e = new DemoEngine()
  e.group.settings.controls = { maker_checker: 'enforced' }
  e.vaultGrants = { 'demo-finance': 'confidential', 'demo-accountant': 'confidential' }
  e.actor = OWNER
  const co = await e.createCompany(buildCompanyPayload({ code: 'T1', name: 'Test One', base_currency: 'INR', fy_start_month: 4 }, 'trading', { includeGst: true }))
  const co2 = await e.createCompany(buildCompanyPayload({ code: 'T2', name: 'Test Two', base_currency: 'INR', fy_start_month: 4 }, 'services', { includeGst: true }))
  const acc = (code: string, company: ID = co) => e.accounts.find((a) => a.company_id === company && a.code === code)!.id
  e.actor = MAKER
  const mk = async (type_key: string, display_name: string, extra: object = {}) => { const r = await e.createParty({ company_id: co, type_key, display_name, force: true, ...extra }); if (r.status !== 'created') throw new Error('party'); return r.id }
  const unit = (code: string) => e.orgUnits.find((u) => u.company_id === co && u.code === code)!.id
  const w: World = { e, co, co2, acc, bank: acc('1121'), cash: acc('1115'), fin: unit('FIN'), ops: e.orgUnits.find((u) => u.company_id === co && u.type_key === 'department' && u.code !== 'FIN')!.id, emp: await mk('employee', 'Test Traveller', { kind: 'person' }), vendor: await mk('vendor', 'Vendor One'), customer: await mk('customer', 'Kovai Traders') }
  for (const c of [co, co2]) {
    const id = await e.saveJournalDraft({ company_id: c, journal_date: M1, voucher_type: 'opening', narration: 'Opening', lines: [{ account_id: acc('1121', c), debit: 5000000 }, { account_id: acc('1115', c), debit: 20000 }, { account_id: acc('3100', c), credit: 5020000 }] })
    await e.submitJournal(id)
    e.actor = CHECKER; await e.approveJournal(id); await e.postJournal(id); e.actor = MAKER
  }
  return w
}
const as = async <T>(e: DemoEngine, actor: string, fn: () => Promise<T>): Promise<T> => { const prev = e.actor; e.actor = actor; try { return await fn() } finally { e.actor = prev } }
const approve = (e: DemoEngine, j: ID, by = CHECKER) => as(e, by, () => e.approveJournal(j, 'ok'))
const balance = async (e: DemoEngine, co: ID, account: ID) => (await e.ledgerBalances([co], '1990-01-01', '2999-12-31')).filter((b) => b.account_id === account).reduce((s, b) => s.plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), D(0))
const item = (e: DemoEngine, id: ID) => e.invItems.find((i) => i.id === id)!

// =========================================================================================== INVENTORY
describe('inventory', () => {
  let w: World; let wh: ID; let wh2: ID; let bolt: ID; let pump: ID; let med: ID; let mri: ID
  const receive = async (itemId: ID, qty: number, cost: number, extra: object = {}, date = TODAY) => {
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: date, warehouse_id: wh, lines: [{ item_id: itemId, qty, unit_cost: cost, ...extra }] })
    const j = await w.e.proposeStockDoc(d)
    if (j) await approve(w.e, j)
    return d
  }
  const issue = async (itemId: ID, qty: number, extra: object = {}) => {
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'issue', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: itemId, qty, ...extra }] })
    return { d, j: (await w.e.proposeStockDoc(d))! }
  }
  beforeEach(async () => {
    w = await world()
    const cat = await w.e.saveInvCategory({ company_id: w.co, name: 'Hardware', inventory_account_id: w.acc('1140'), cogs_account_id: w.acc('5010') })
    const catf = await w.e.saveInvCategory({ company_id: w.co, name: 'Equipment', inventory_account_id: w.acc('1140'), cogs_account_id: w.acc('5010'), valuation_method: 'fifo' })
    wh = await w.e.saveWarehouse({ company_id: w.co, code: 'main', name: 'Main warehouse' })
    wh2 = await w.e.saveWarehouse({ company_id: w.co, code: 'site', name: 'Site store', kind: 'site' })
    bolt = await w.e.saveInvItem({ company_id: w.co, sku: 'bolt', name: 'Anchor bolt', category_id: cat, unit: 'pcs', reorder_level: 40, reorder_qty: 200 })
    pump = await w.e.saveInvItem({ company_id: w.co, sku: 'pump', name: 'Infusion pump', category_id: catf })
    med = await w.e.saveInvItem({ company_id: w.co, sku: 'med', name: 'Sterile kit', category_id: cat, tracking: 'lot', shelf_life_days: 365 })
    mri = await w.e.saveInvItem({ company_id: w.co, sku: 'mri', name: 'Scanner', category_id: catf, tracking: 'serial' })
  })

  it('the stock ledger of a category must be an asset, and an item takes the method of its category', async () => {
    await expect(w.e.saveInvCategory({ company_id: w.co, name: 'Wrong', inventory_account_id: w.acc('5010'), cogs_account_id: w.acc('5010') })).rejects.toThrow(/must be an asset/)
    expect(item(w.e, pump).valuation_method).toBe('fifo')
    expect(item(w.e, bolt).valuation_method).toBe('weighted_average')
  })
  it('a receipt proposes its entry and changes nothing until it is approved', async () => {
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: bolt, qty: 100, unit_cost: 10 }] })
    const j = (await w.e.proposeStockDoc(d))!
    expect(item(w.e, bolt).qty_on_hand).toBe('0')
    expect((await balance(w.e, w.co, w.acc('1140'))).toNumber()).toBe(0)
    await expect(w.e.approveJournal(j)).rejects.toThrow(/maker-checker/)
    await approve(w.e, j)
    expect(D(item(w.e, bolt).qty_on_hand).toNumber()).toBe(100)
    expect((await balance(w.e, w.co, w.acc('1140'))).toNumber()).toBe(1000)
    expect((await balance(w.e, w.co, w.acc('2125'))).toNumber()).toBe(-1000)
    expect(w.e.stockDocs.find((x) => x.id === d)!.status).toBe('posted')
  })
  it('weighted average: 100 at 10 and 100 at 14, an issue of 50 costs 600', async () => {
    await receive(bolt, 100, 10); await receive(bolt, 100, 14)
    const { d, j } = await issue(bolt, 50)
    expect(D(w.e.stockDocs.find((x) => x.id === d)!.total_value).toNumber()).toBe(600)
    await approve(w.e, j)
    expect(D(item(w.e, bolt).qty_on_hand).toNumber()).toBe(150)
    expect(D(item(w.e, bolt).value_on_hand).toNumber()).toBe(1800)
  })
  it('first in, first out: 10 at 100 then 10 at 120, an issue of 15 costs 1600', async () => {
    await receive(pump, 10, 100, {}, ago(5)); await receive(pump, 10, 120, {}, ago(2))
    const { d, j } = await issue(pump, 15)
    expect(D(w.e.stockDocs.find((x) => x.id === d)!.total_value).toNumber()).toBe(1600)
    await approve(w.e, j)
    expect(D(item(w.e, pump).value_on_hand).toNumber()).toBe(600)
  })
  it('stock awaiting approval on one document cannot be issued on another, and rejecting releases it', async () => {
    await receive(bolt, 150, 12)
    const { j } = await issue(bolt, 100)
    const second = await w.e.saveStockDoc({ company_id: w.co, kind: 'issue', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: bolt, qty: 100 }] })
    await expect(w.e.proposeStockDoc(second)).rejects.toThrow(/are asked for|free in stock/)
    expect(D(item(w.e, bolt).qty_reserved).toNumber()).toBe(100)
    await as(w.e, CHECKER, () => w.e.rejectJournal(j, 'Not needed'))
    expect(D(item(w.e, bolt).qty_reserved).toNumber()).toBe(0)
    expect(D(item(w.e, bolt).value_reserved).toNumber()).toBe(0)
    expect(w.e.invMovements.filter((m) => m.item_id === bolt && m.is_layer && m.status === 'posted').reduce((s, m) => s + Number(m.remaining_qty), 0)).toBe(150)
  })
  it('a refused proposal leaves nothing behind', async () => {
    await receive(bolt, 10, 10)
    const moves = w.e.invMovements.length
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'issue', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: bolt, qty: 4 }, { item_id: pump, qty: 1 }] })
    await expect(w.e.proposeStockDoc(d)).rejects.toThrow()
    expect(w.e.invMovements.length).toBe(moves)
    expect(D(item(w.e, bolt).qty_reserved).toNumber()).toBe(0)
    expect(w.e.stockDocs.find((x) => x.id === d)!.status).toBe('draft')
  })
  it('lots and serial numbers: a lot is required, its expiry follows the shelf life, a serial number is one unit', async () => {
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: med, qty: 20, unit_cost: 50 }] })).rejects.toThrow(/tracked by lot/)
    await receive(med, 20, 50, { lot_no: 'L-01', mfg_date: ago(300) })
    expect(w.e.invLots.find((l) => l.lot_no === 'L-01')!.expiry_date).toBe(addDays(TODAY, 65))
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: mri, qty: 2, unit_cost: 900000, lot_no: 'SN-1' }] })).rejects.toThrow(/one unit/)
    await receive(mri, 1, 900000, { lot_no: 'SN-1' })
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: mri, qty: 1, unit_cost: 900000, lot_no: 'SN-1' }] })).rejects.toThrow(/already in stock/)
  })
  it('a serial-numbered unit that is sold remembers its customer, and its service history is kept', async () => {
    await receive(mri, 1, 900000, { lot_no: 'SN-7' })
    const lot = w.e.invLots.find((l) => l.lot_no === 'SN-7')!
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'issue', doc_date: TODAY, warehouse_id: wh, party_id: w.customer, lines: [{ item_id: mri, qty: 1, lot_id: lot.id }] })
    await approve(w.e, (await w.e.proposeStockDoc(d))!)
    expect(lot.sold_to_party_id).toBe(w.customer)
    await w.e.recordUnitEvent({ lot_id: lot.id, event_type: 'installation', event_date: TODAY, detail: { location: 'Kovai Medical, Block B', warranty_until: addDays(TODAY, 365) } })
    await w.e.recordUnitEvent({ lot_id: lot.id, event_type: 'engineer_visit', event_date: TODAY, engineer_name: 'R. Kumar', cost: 1500, chargeable: false })
    expect(lot.customer_location).toBe('Kovai Medical, Block B')
    expect((await w.e.listUnitEvents(lot.id)).length).toBe(2)
  })
  it('a transfer proposes no entry: the place changes, the value does not', async () => {
    await receive(bolt, 150, 12)
    const before = w.e.journals.length
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'transfer', doc_date: TODAY, warehouse_id: wh, to_warehouse_id: wh2, lines: [{ item_id: bolt, qty: 30 }] })
    expect(await w.e.proposeStockDoc(d)).toBeNull()
    expect(w.e.journals.length).toBe(before)
    const rows = await w.e.stockOnHand([w.co])
    expect(Number(rows.find((r) => r.item_id === bolt && r.warehouse_id === wh2)!.qty)).toBe(30)
    expect(Number(rows.find((r) => r.item_id === bolt && r.warehouse_id === wh)!.qty)).toBe(120)
    expect(D(item(w.e, bolt).value_on_hand).toNumber()).toBe(1800)
  })
  it('an adjustment says what happened; a condition noted on stock is exposure until a loss is approved', async () => {
    await receive(bolt, 150, 12)
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'adjustment', doc_date: TODAY, warehouse_id: wh, reason: 'Found broken', lines: [{ item_id: bolt, qty: -5 }] })).rejects.toThrow(/state what happened/)
    const hold = await w.e.saveInvHold({ company_id: w.co, item_id: bolt, warehouse_id: wh, qty: 5, condition: 'damaged', note: 'Rusted in the rain' })
    await expect(w.e.saveInvHold({ company_id: w.co, item_id: bolt, warehouse_id: wh, qty: 500, condition: 'damaged' })).rejects.toThrow(/cannot exceed the stock/)
    expect(D(item(w.e, bolt).value_on_hand).toNumber()).toBe(1800)
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'adjustment', doc_date: TODAY, warehouse_id: wh, reason: 'Rusted bolts scrapped', lines: [{ item_id: bolt, qty: -5, reason_code: 'damage', hold_id: hold }] })
    await approve(w.e, (await w.e.proposeStockDoc(d))!)
    expect((await balance(w.e, w.co, w.acc('5150'))).toNumber()).toBe(60)
    expect(w.e.invHolds.find((h) => h.id === hold)!.status).toBe('written_off')
  })
  it('a stock count freezes the location, needs a second person and a reason, and changes the books only through an approved adjustment', async () => {
    await receive(bolt, 120, 12); await receive(med, 20, 50, { lot_no: 'L-01' })
    const cnt = await w.e.createStockCount({ company_id: w.co, warehouse_id: wh })
    const lines = (await w.e.getStockCount(cnt)).lines!
    expect(lines.length).toBe(2)
    const blocked = await w.e.saveStockDoc({ company_id: w.co, kind: 'issue', doc_date: TODAY, warehouse_id: wh, lines: [{ item_id: bolt, qty: 1 }] })
    await expect(w.e.proposeStockDoc(blocked)).rejects.toThrow(/frozen/)
    const found = (reason: boolean) => lines.map((l) => ({ id: l.id, counted_qty: l.item_id === bolt ? 117 : 21, reason_code: reason ? (l.item_id === bolt ? 'shrinkage' as const : 'found' as const) : undefined }))
    expect(await w.e.recordStockCount(cnt, found(false))).toBe('counted')
    await expect(w.e.reviewStockCount(cnt, 'reviewed')).rejects.toThrow(/maker-checker/)
    await expect(as(w.e, CHECKER, () => w.e.reviewStockCount(cnt, 'reviewed'))).rejects.toThrow(/carry no reason/)
    await as(w.e, CHECKER, () => w.e.reviewStockCount(cnt, 'recount', 'Reasons are missing'))
    await w.e.recordStockCount(cnt, found(true))
    await as(w.e, CHECKER, () => w.e.reviewStockCount(cnt, 'reviewed', 'Agreed'))
    expect(D(item(w.e, bolt).qty_on_hand).toNumber()).toBe(120)
    const j = (await as(w.e, CHECKER, () => w.e.proposeStockCount(cnt)))!
    await approve(w.e, j, OWNER)
    expect(D(item(w.e, bolt).qty_on_hand).toNumber()).toBe(117)
    expect(D(item(w.e, med).qty_on_hand).toNumber()).toBe(21)
    expect(w.e.stockCounts.find((c) => c.id === cnt)!.status).toBe('posted')
  })
  it('a count that agrees with the books is closed and proposes nothing', async () => {
    await receive(bolt, 10, 12)
    const cnt = await w.e.createStockCount({ company_id: w.co, warehouse_id: wh })
    await w.e.recordStockCount(cnt, (await w.e.getStockCount(cnt)).lines!.map((l) => ({ id: l.id, counted_qty: l.book_qty })))
    await as(w.e, CHECKER, () => w.e.reviewStockCount(cnt, 'reviewed'))
    const before = w.e.journals.length
    expect(await w.e.proposeStockCount(cnt)).toBeNull()
    expect(w.e.journals.length).toBe(before)
    expect(w.e.stockCounts.find((c) => c.id === cnt)!.status).toBe('closed')
  })
  it('landed cost joins the stock that is still there; the share of what has left is a cost now', async () => {
    await receive(pump, 10, 100, {}, ago(5))
    const rcp = await receive(pump, 10, 120, {}, ago(2))
    await approve(w.e, (await issue(pump, 15)).j)
    const lc = await w.e.saveStockDoc({ company_id: w.co, kind: 'landed_cost', doc_date: TODAY, receipt_doc_id: rcp, meta: { method: 'value', charges: [{ name: 'Freight', amount: 300 }, { name: 'Customs duty', amount: 200 }] } })
    const j = (await w.e.proposeStockDoc(lc))!
    const l = (await w.e.getStockDoc(lc)).lines![0]
    expect([Number(l.value), Number(l.expensed)]).toEqual([250, 250])
    await approve(w.e, j)
    expect(D(item(w.e, pump).value_on_hand).toNumber()).toBe(850)
    expect((await balance(w.e, w.co, w.acc('2127'))).toNumber()).toBe(-500)
  })
  it('a receipt cannot be reversed once its goods have left; reversing an issue brings the stock back', async () => {
    const rcp = await receive(pump, 10, 100)
    const { d, j } = await issue(pump, 4)
    await approve(w.e, j)
    const receiptJournal = w.e.stockDocs.find((x) => x.id === rcp)!.journal_id!
    await expect(as(w.e, CHECKER, () => w.e.reverseJournal(receiptJournal, TODAY, 'Test'))).rejects.toThrow(/have since left stock/)
    await as(w.e, CHECKER, () => w.e.reverseJournal(j, TODAY, 'Issued in error'))
    expect(D(item(w.e, pump).qty_on_hand).toNumber()).toBe(10)
    expect(D(item(w.e, pump).value_on_hand).toNumber()).toBe(1000)
    expect(w.e.stockDocs.find((x) => x.id === d)!.status).toBe('reversed')
  })
  it('stock received against a goods receipt takes the rate of the order and cannot exceed what was received', async () => {
    const po = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'purchase_order', doc_date: TODAY, party_id: w.vendor, lines: [{ description: 'Anchor bolts', quantity: 40, rate: 11, account_id: w.acc('2125') }] })
    await w.e.submitPurchaseDoc(po); await as(w.e, CHECKER, () => w.e.approvePurchaseDoc(po, 'ok'))
    const pol = (await w.e.getPurchaseDoc(po)).lines![0].id
    const grn = await w.e.savePurchaseDoc({ company_id: w.co, kind: 'goods_receipt', doc_date: TODAY, parent_id: po, lines: [{ description: 'Anchor bolts', quantity: 25, source_line_id: pol }] })
    await w.e.submitPurchaseDoc(grn)
    const grl = (await w.e.getPurchaseDoc(grn)).lines![0].id
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, purchase_doc_id: grn, lines: [{ item_id: bolt, qty: 25, source_line_id: grl }] })
    const doc = await w.e.getStockDoc(d)
    expect(Number(doc.lines![0].unit_cost)).toBe(11)
    expect(doc.party_id).toBe(w.vendor)
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: TODAY, warehouse_id: wh, purchase_doc_id: grn, lines: [{ item_id: bolt, qty: 1, source_line_id: grl }] })).rejects.toThrow(/would exceed/)
  })
  it('after everything, the stock ledger and the general ledger agree and nothing is left reserved', async () => {
    await receive(bolt, 100, 10); await receive(bolt, 100, 14); await approve(w.e, (await issue(bolt, 50)).j)
    await receive(pump, 10, 100); await approve(w.e, (await issue(pump, 3)).j)
    const adj = await w.e.saveStockDoc({ company_id: w.co, kind: 'adjustment', doc_date: TODAY, warehouse_id: wh, reason: 'Lost', lines: [{ item_id: bolt, qty: -7, reason_code: 'theft' }] })
    await approve(w.e, (await w.e.proposeStockDoc(adj))!)
    const stock = w.e.invItems.reduce((s, i) => s.plus(i.value_on_hand), D(0))
    expect(stock.toNumber()).toBe((await balance(w.e, w.co, w.acc('1140'))).toNumber())
    expect(w.e.invItems.every((i) => Number(i.qty_reserved) === 0 && Number(i.value_reserved) === 0)).toBe(true)
    expect((await w.e.systemHealth()).stock_and_ledger.state).toBe('ok')
  })
})

// =========================================================================================== INVESTMENTS
describe('investments and funds', () => {
  let w: World; let hold: ID; let inv1: ID; let inv2: ID; let mgr: ID; let investee: ID
  beforeEach(async () => {
    w = await world()
    const mk = async (type_key: string, name: string) => { const r = await w.e.createParty({ company_id: w.co, type_key, display_name: name, force: true }); if (r.status !== 'created') throw new Error('party'); return r.id }
    inv1 = await mk('investor', 'Investor One'); inv2 = await mk('investor', 'Investor Two'); mgr = await mk('vendor', 'Fund Manager LLP'); investee = await mk('other', 'Portfolio Company A')
    hold = await w.e.saveHolding({ company_id: w.co, name: 'Portfolio Company A — equity', investee_party_id: investee, investment_account_id: w.acc('1220') })
  })
  const buy = async (h: ID, qty: number, amount: number, date = ago(60)) => approve(w.e, await w.e.proposeHoldingTxn({ holding_id: h, kind: 'purchase', date, quantity: qty, amount, bank_ledger_id: w.bank }))
  const holding = (id: ID) => w.e.holdings.find((h) => h.id === id)!

  it('the corporate structure: owners cannot hold more than the whole, and a company cannot own its owner', async () => {
    await as(w.e, OWNER, () => w.e.saveCorporateLink({ parent_company_id: w.co, child_company_id: w.co2, relation: 'subsidiary', ownership_pct: 60 }))
    await expect(as(w.e, OWNER, () => w.e.saveCorporateLink({ parent_party_id: investee, child_company_id: w.co2, relation: 'associate', ownership_pct: 45 }))).rejects.toThrow(/exceed the whole/)
    await expect(as(w.e, OWNER, () => w.e.saveCorporateLink({ parent_company_id: w.co2, child_company_id: w.co, relation: 'subsidiary', ownership_pct: 10 }))).rejects.toThrow(/owner of its own owner/)
    expect((await w.e.listCorporateLinks()).length).toBe(1)
  })
  it('a purchase changes the holding only when its entry is approved; a sale releases cost in proportion', async () => {
    await expect(w.e.saveHolding({ company_id: w.co, name: 'Wrong', investment_account_id: w.acc('4950') })).rejects.toThrow(/asset ledger/)
    const j = await w.e.proposeHoldingTxn({ holding_id: hold, kind: 'purchase', date: ago(60), quantity: 1000, amount: 500000, bank_ledger_id: w.bank })
    expect(Number(holding(hold).quantity)).toBe(0)
    await approve(w.e, j)
    expect([Number(holding(hold).quantity), Number(holding(hold).cost)]).toEqual([1000, 500000])
    await expect(w.e.proposeHoldingTxn({ holding_id: hold, kind: 'sale', date: ago(30), quantity: 1500, amount: 900000, bank_ledger_id: w.bank })).rejects.toThrow(/cannot exceed/)
    await approve(w.e, await w.e.proposeHoldingTxn({ holding_id: hold, kind: 'sale', date: ago(30), quantity: 400, amount: 260000, bank_ledger_id: w.bank }))
    expect([Number(holding(hold).quantity), Number(holding(hold).cost), Number(holding(hold).realised_gain)]).toEqual([600, 300000, 60000])
    expect((await balance(w.e, w.co, w.acc('4930'))).toNumber()).toBe(-60000)
  })
  it('income is recorded with the tax deducted from it', async () => {
    await buy(hold, 1000, 500000)
    const j = await w.e.proposeHoldingTxn({ holding_id: hold, kind: 'income', income_kind: 'dividend', date: ago(20), amount: 12000, tax_deducted: 1200, bank_ledger_id: w.bank })
    await approve(w.e, j)
    const lines = w.e.linesByJournal.get(j)!
    expect(Number(lines.find((l) => l.account_id === w.bank)!.debit)).toBe(10800)
    expect(Number(lines.find((l) => l.account_id === w.acc('1185'))!.debit)).toBe(1200)
    expect(Number(holding(hold).income_received)).toBe(12000)
  })
  it('a holding at cost: a valuation stands beside the books, proposes no entry, and needs a second person', async () => {
    await buy(hold, 1000, 300000)
    await expect(w.e.recordHoldingValuation({ holding_id: hold, date: ago(10), fair_value: 420000, method: '', valuer: '', basis: '' })).rejects.toThrow(/states its method/)
    const before = w.e.journals.length
    const v = await w.e.recordHoldingValuation({ holding_id: hold, date: ago(10), fair_value: 420000, method: 'Comparable transactions', valuer: 'Independent valuer', basis: 'Last funding round' })
    expect(w.e.journals.length).toBe(before)
    await expect(w.e.decideHoldingValuation(v, 'approved')).rejects.toThrow(/maker-checker/)
    await as(w.e, CHECKER, () => w.e.decideHoldingValuation(v, 'approved', 'Agreed'))
    expect([Number(holding(hold).fair_value), Number(holding(hold).cost)]).toEqual([420000, 300000])
    expect((await balance(w.e, w.co, w.acc('1220'))).toNumber()).toBe(300000)
  })
  it('a holding at fair value: the change is posted on approval, and a sale is measured against what is carried', async () => {
    const h2 = await w.e.saveHolding({ company_id: w.co, name: 'Listed units', instrument: 'units', investment_account_id: w.acc('1220'), measurement: 'fair_value' })
    await buy(h2, 100, 100000, ago(50))
    const v = await w.e.recordHoldingValuation({ holding_id: h2, date: ago(5), fair_value: 130000, method: 'Quoted price', valuer: 'Exchange close', basis: 'Closing price' })
    expect(Number(holding(h2).fv_adjustment)).toBe(0)
    await approve(w.e, w.e.holdingTxns.find((t) => t.id === v)!.journal_id!)
    expect([Number(holding(h2).fv_adjustment), Number(holding(h2).fair_value)]).toEqual([30000, 130000])
    const j = await w.e.proposeHoldingTxn({ holding_id: h2, kind: 'sale', date: ago(2), quantity: 100, amount: 125000, bank_ledger_id: w.bank })
    await approve(w.e, j)
    expect(Number(w.e.linesByJournal.get(j)!.find((l) => l.account_id === w.acc('4930'))!.debit)).toBe(5000)
    expect(holding(h2).status).toBe('exited')
  })

  describe('a fund', () => {
    let fund: ID; let cm1: ID; let cm2: ID; let call: ID
    beforeEach(async () => {
      fund = await w.e.saveFund({ company_id: w.co, name: 'GHL Growth Fund I', structure: 'aif_cat2', manager_party_id: mgr, unit_face_value: 100, fee_pct: 2, fee_basis: 'committed', capital_account_id: w.acc('3100') })
      cm1 = await w.e.saveCommitment({ fund_id: fund, investor_party_id: inv1, committed_amount: 6000000, commitment_date: ago(90) })
      cm2 = await w.e.saveCommitment({ fund_id: fund, investor_party_id: inv2, committed_amount: 4000000, commitment_date: ago(90) })
      call = await w.e.saveCapitalCall({ fund_id: fund, call_date: ago(45), due_date: ago(30), pct: 25, purpose: 'First investment' })
      await w.e.submitCapitalCall(call)
    })
    const contribute = async () => {
      await as(w.e, CHECKER, () => w.e.decideCapitalCall(call, 'approved', 'ok'))
      const ls = w.e.capitalCallLines.filter((l) => l.call_id === call)
      await approve(w.e, await w.e.proposeCapitalReceipt({ line_id: ls.find((l) => l.commitment_id === cm1)!.id, amount: 1500000, bank_ledger_id: w.bank, date: ago(40) }))
      await approve(w.e, await w.e.proposeCapitalReceipt({ line_id: ls.find((l) => l.commitment_id === cm2)!.id, amount: 600000, bank_ledger_id: w.bank, date: ago(38) }))
    }

    it('is confidential: a person who is not cleared does not see it', async () => {
      w.e.vaultGrants = {}
      expect((await w.e.listFunds([w.co])).length).toBe(0)
      expect((await w.e.listCommitments({ companyIds: [w.co] })).length).toBe(0)
      expect((await as(w.e, OWNER, () => w.e.listFunds([w.co]))).length).toBe(1)
    })
    it('a capital call is a request, not money: approving it posts nothing', async () => {
      const before = w.e.journals.length
      await expect(w.e.decideCapitalCall(call, 'approved')).rejects.toThrow(/maker-checker/)
      await as(w.e, CHECKER, () => w.e.decideCapitalCall(call, 'approved', 'ok'))
      expect(Number(w.e.capitalCalls.find((c) => c.id === call)!.total_amount)).toBe(2500000)
      expect(Number(w.e.commitments.find((c) => c.id === cm1)!.called_amount)).toBe(1500000)
      expect(w.e.journals.length).toBe(before)
    })
    it('units are issued when the money is posted, and a receipt cannot exceed what was called', async () => {
      await as(w.e, CHECKER, () => w.e.decideCapitalCall(call, 'approved', 'ok'))
      const l1 = w.e.capitalCallLines.find((l) => l.call_id === call && l.commitment_id === cm1)!.id
      await expect(w.e.proposeCapitalReceipt({ line_id: l1, amount: 1600000, bank_ledger_id: w.bank, date: ago(40) })).rejects.toThrow(/cannot exceed/)
      const j = await w.e.proposeCapitalReceipt({ line_id: l1, amount: 1500000, bank_ledger_id: w.bank, date: ago(40) })
      expect(Number(w.e.funds[0].units_outstanding)).toBe(0)
      await approve(w.e, j)
      expect(Number(w.e.funds[0].units_outstanding)).toBe(15000)
      expect(w.e.capitalCalls.find((c) => c.id === call)!.status).toBe('approved')
    })
    it('net asset value comes from the books and is approved by a second person', async () => {
      await contribute()
      const nav = await w.e.prepareNav(fund, TODAY)
      const n = w.e.navRuns.find((x) => x.id === nav)!
      const assets = (await w.e.ledgerBalances([w.co], '1990-01-01', TODAY)).filter((b) => w.e.account(b.account_id)!.type === 'asset').reduce((s, b) => s.plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), D(0))
      expect(Number(n.total_assets)).toBe(assets.toNumber())
      expect(Number(n.units)).toBe(21000)
      expect(Number(n.nav_per_unit)).toBeCloseTo(assets.toNumber() / 21000, 5)
      await expect(w.e.decideNav(nav, 'approved')).rejects.toThrow(/maker-checker/)
      await as(w.e, CHECKER, () => w.e.decideNav(nav, 'approved', 'Agreed to the books'))
      expect(n.status).toBe('approved')
    })
    it('the management fee follows its formula and the same days cannot be charged twice', async () => {
      const j = await w.e.proposeFundFee(fund, ago(72), TODAY)
      expect(Number(w.e.fundFees.find((f) => f.journal_id === j)!.amount)).toBe(40000)
      await expect(w.e.proposeFundFee(fund, ago(10), TODAY)).rejects.toThrow(/already been proposed/)
      // a fee is charged for days that have passed
      await expect(w.e.proposeFundFee(fund, addDays(TODAY, 1), addDays(TODAY, 20))).rejects.toThrow(/days that have passed/)
    })
    it('a distribution: entitlement by units, declaration before payment, tax withheld, a second person for each entry', async () => {
      await contribute()
      const dist = await w.e.saveDistribution({ company_id: w.co, fund_id: fund, kind: 'distribution', declaration_date: TODAY, record_date: TODAY, total_amount: 70000, tax_pct: 10, source_account_id: w.acc('3300') })
      const l1 = w.e.distributionLines.find((l) => l.distribution_id === dist && l.holder_party_id === inv1)!
      expect([Number(l1.gross_amount), Number(l1.tax_deducted), Number(l1.net_amount)]).toEqual([50000, 5000, 45000])
      await w.e.submitDistribution(dist)
      await expect(w.e.proposeDistributionPayment({ distribution_id: dist, bank_ledger_id: w.bank, date: TODAY })).rejects.toThrow(/follows the declaration/)
      expect(await as(w.e, CHECKER, () => w.e.decideDistribution(dist, 'approved', 'ok'))).toBe('approved')
      const j = w.e.distributions.find((d) => d.id === dist)!.journal_id!
      await expect(as(w.e, CHECKER, () => w.e.approveJournal(j))).rejects.toThrow(/maker-checker/)
      await approve(w.e, j, OWNER)
      expect((await balance(w.e, w.co, w.acc('2128'))).toNumber()).toBe(-70000)
      const pj = await w.e.proposeDistributionPayment({ distribution_id: dist, bank_ledger_id: w.bank, date: TODAY, line_ids: [l1.id] })
      await approve(w.e, pj)
      expect(Number(w.e.linesByJournal.get(pj)!.find((l) => l.account_id === w.bank)!.credit)).toBe(45000)
      expect(Number(w.e.commitments.find((c) => c.id === cm1)!.distributed_amount)).toBe(50000)
      expect(w.e.distributions.find((d) => d.id === dist)!.status).toBe('part_paid')
    })
  })
  it('a dividend cannot be declared while no shareholder is on record', async () => {
    await expect(w.e.saveDistribution({ company_id: w.co2, kind: 'dividend', declaration_date: TODAY, record_date: TODAY, total_amount: 1000, source_account_id: w.acc('3300', w.co2) })).rejects.toThrow(/nobody is entitled/)
    await w.e.saveEquityHolder({ company_id: w.co2, holder_party_id: inv1, quantity: 600 }); await w.e.saveEquityHolder({ company_id: w.co2, holder_party_id: inv2, quantity: 400 })
    const d = await w.e.saveDistribution({ company_id: w.co2, kind: 'dividend', declaration_date: TODAY, record_date: TODAY, total_amount: 1000, source_account_id: w.acc('3300', w.co2) })
    expect(w.e.distributionLines.filter((l) => l.distribution_id === d).map((l) => Number(l.gross_amount))).toEqual([600, 400])
  })
})

// =========================================================================================== AFTER THE ASSESSMENT
describe('what the assessment of release 0.3.0 found in inventory', () => {
  let w: World; let wh: ID; let wh2: ID; let bolt: ID; let med: ID
  beforeEach(async () => {
    w = await world()
    const cat = await w.e.saveInvCategory({ company_id: w.co, name: 'Hardware', inventory_account_id: w.acc('1140'), cogs_account_id: w.acc('5010') })
    wh = await w.e.saveWarehouse({ company_id: w.co, code: 'main', name: 'Main warehouse' })
    wh2 = await w.e.saveWarehouse({ company_id: w.co, code: 'site', name: 'Site store', kind: 'site' })
    bolt = await w.e.saveInvItem({ company_id: w.co, sku: 'bolt', name: 'Anchor bolt', category_id: cat, unit: 'pcs' })
    med = await w.e.saveInvItem({ company_id: w.co, sku: 'med', name: 'Sterile kit', category_id: cat, tracking: 'lot', shelf_life_days: 365 })
  })
  const receive = async (itemId: ID, qty: number, date: string, extra: object = {}) => {
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: date, warehouse_id: wh, lines: [{ item_id: itemId, qty, unit_cost: 10, ...extra }] })
    await approve(w.e, (await w.e.proposeStockDoc(d))!)
    return d
  }

  it('stock moved to another place was not received again: it is as old as its receipt', async () => {
    await receive(bolt, 100, ago(45))
    const t = await w.e.saveStockDoc({ company_id: w.co, kind: 'transfer', doc_date: ago(2), warehouse_id: wh, to_warehouse_id: wh2, lines: [{ item_id: bolt, qty: 30 }] })
    await w.e.proposeStockDoc(t)
    const rows = await w.e.stockOnHand([w.co])
    const site = rows.find((r) => r.item_id === bolt && r.warehouse_id === wh2)!
    const main = rows.find((r) => r.item_id === bolt && r.warehouse_id === wh)!
    expect([site.qty, site.last_in, site.last_out].map(String)).toEqual(['30', ago(45), 'null'])
    expect([main.last_in, main.last_out].map(String)).toEqual([ago(45), 'null'])      // a transfer out is not a sale
    const slow = lossExposure(w.e.invItems, rows, w.e.invLots, w.e.invHolds, TODAY, { slowAfterDays: 30 }).filter((x) => x.kind === 'slow_moving')
    expect(slow.map((x) => [x.warehouse_id, x.qty.toNumber(), x.since]).sort()).toEqual([[wh, 70, ago(45)], [wh2, 30, ago(45)]].sort())
    // a receipt from outside at the second place starts its own clock there
    const d = await w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: ago(1), warehouse_id: wh2, lines: [{ item_id: bolt, qty: 5, unit_cost: 10 }] })
    await approve(w.e, (await w.e.proposeStockDoc(d))!)
    expect((await w.e.stockOnHand([w.co])).find((r) => r.item_id === bolt && r.warehouse_id === wh2)!.last_in).toBe(ago(1))
  })
  it('a stock document is not dated on a day that has not come', async () => {
    await expect(w.e.saveStockDoc({ company_id: w.co, kind: 'receipt', doc_date: addDays(TODAY, 1), warehouse_id: wh, lines: [{ item_id: bolt, qty: 1, unit_cost: 10 }] })).rejects.toThrow(/a day that has not come/)
    expect(w.e.stockDocs.length).toBe(0)
  })
  it('the movements of one lot are asked for as such, however many the item has', async () => {
    await receive(med, 10, ago(20), { lot_no: 'L-1' })
    await receive(med, 10, ago(10), { lot_no: 'L-2' })
    const lot = w.e.invLots.find((l) => l.lot_no === 'L-1')!
    const all = await w.e.listInvMovements({ companyIds: [w.co], itemId: med })
    const mine = await w.e.listInvMovements({ companyIds: [w.co], itemId: med, lotId: lot.id, limit: 1 })
    expect(all.length).toBe(2)
    expect(mine.map((m) => m.lot_id)).toEqual([lot.id])      // with a limit of one the newest of the item is of the other lot
  })
  it('system health compares a stock ledger with the books also when it holds no item', async () => {
    const ledger = w.e.accounts.find((a) => a.company_id === w.co && a.type === 'asset' && !a.is_group && !a.control_type && a.code !== '1140')!
    await w.e.saveInvCategory({ company_id: w.co, name: 'Spares, nothing recorded yet', inventory_account_id: ledger.id, cogs_account_id: w.acc('5010') })
    const before = (await w.e.systemHealth()).stock_and_ledger
    expect(before.state).toBe('ok')
    const j = await w.e.saveJournalDraft({ company_id: w.co, journal_date: TODAY, narration: 'Spares bought, entered by hand', lines: [{ account_id: ledger.id, debit: 5000 }, { account_id: w.bank, credit: 5000 }] })
    await w.e.submitJournal(j); await as(w.e, CHECKER, async () => { await w.e.approveJournal(j); await w.e.postJournal(j) })
    const after = (await w.e.systemHealth()).stock_and_ledger
    expect(after.state).toBe('attention')
    expect((after.differences as { difference: number }[]).map((d) => Number(d.difference))).toEqual([-5000])
  })
})
