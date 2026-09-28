import Decimal from 'decimal.js'
import { D, round2 } from '@/lib/money'
import { addDays, addMonths, endOfMonth, fmtDate, startOfMonth } from '@/lib/dates'
import type { ID } from '@/engine/types'
import type { FlowDefinition, HoldCondition, StockDocLineInput, StockReason, WarehouseKind } from '@/engine/p3Types'
import { simulate } from '@/engine/twin'
import { loadTwin } from '@/lib/twinData'
import type { SeedCtx } from './demoSeedOps'

// =====================================================================
// SAMPLE DATA for phase 3: stock, investments and a fund, reality and
// control, simulations, the scenario studio and the platform records.
// Fictional, in memory only, and produced by driving the same engine a
// person would use: document → proposed journal → approval → posting.
// =====================================================================

/** What the two trading companies bought and sold after the day their stock ledger began. */
export type StockEvent =
  | { kind: 'sale'; co: 'GMED' | 'GWELL'; date: string; invoice: ID; party: ID; cost: number }
  | { kind: 'purchase'; co: 'GMED' | 'GWELL'; date: string; bill: ID; party: ID; charges?: { date: string; duty: number; freight: number; carrier: ID } }

const q6 = (v: Decimal.Value) => D(v).toDecimalPlaces(6)

export async function seedDemoP3(x: SeedCtx, events: StockEvent[], CUT: string): Promise<void> {
  const { e, C, P, START, TODAY, MAKER, CHECKER, OWNER, as, acc, bank, dim, party, tax } = x
  const ago = (n: number) => { const d = addDays(TODAY, -n); return d < START ? START : d }
  const ahead = (n: number) => addDays(TODAY, n)
  const notAfterToday = (d: string) => (d > TODAY ? TODAY : d)
  /** the Group CFO: cleared for confidential records, and the second approver of entries that need two */
  const CFO = 'demo-cfo'

  /** approves a proposed journal with people who did not prepare it and are cleared to read it */
  const approve = async (journalId: ID | null, date: string) => {
    if (!journalId) throw new Error('seed: nothing was proposed')
    const j = e.journals.find((q) => q.id === journalId)!
    const d = notAfterToday(date)
    const people = (j.confidentiality === 'internal' ? [CHECKER, OWNER, MAKER] : j.confidentiality === 'confidential' ? [CHECKER, CFO, OWNER] : [OWNER]).filter((p) => p !== j.created_by)
    for (let i = 0; i < 4 && j.status === 'submitted'; i++) await as(people[i % people.length], d, () => e.approveJournal(journalId, 'Checked against the source record'))
    if (j.status !== 'posted') throw new Error('seed: workflow journal did not post — ' + j.narration)
  }
  const ledgerAt = async (co: string, code: string, date: string) => {
    const b = (await e.ledgerBalances([C[co]], '1990-01-01', date)).find((r) => r.account_id === acc(co, code))
    return b ? D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit) : D(0)
  }

  // ================================================================ INVENTORY
  const T0 = addDays(CUT, -1)
  const WH: Record<string, ID> = {}
  const I: Record<string, ID> = {}
  const warehouse = async (co: string, code: string, name: string, kind: WarehouseKind, address: string) => { WH[code] = await as(CHECKER, T0, () => e.saveWarehouse({ company_id: C[co], code, name, kind, address })) }
  const category = (co: string, name: string, method: 'fifo' | 'weighted_average') => as(CHECKER, T0, () => e.saveInvCategory({ company_id: C[co], name, inventory_account_id: acc(co, '1140'), cogs_account_id: acc(co, '5010'), valuation_method: method }))
  const item = async (co: string, key: string, cat: ID, sku: string, name: string, o: Partial<Parameters<typeof e.saveInvItem>[0]> = {}) => { I[key] = await as(MAKER, T0, () => e.saveInvItem({ company_id: C[co], category_id: cat, sku, name, ...o })) }
  const theItem = (key: string) => e.invItems.find((i) => i.id === I[key])!
  const costOf = (key: string) => { const i = theItem(key); return D(i.qty_on_hand).isZero() ? D(0) : D(i.value_on_hand).div(i.qty_on_hand) }
  const lotOf = (key: string, lotNo: string) => e.invLots.find((l) => l.item_id === I[key] && l.lot_no === lotNo)!.id
  /** free quantity of an item in one place, lot by lot, earliest expiry first. Distributors take nothing with less than 90 days of shelf life left. */
  const freeIn = async (co: string, key: string, wh: ID, asOf: string) => (await e.stockOnHand([C[co]]))
    .filter((r) => r.item_id === I[key] && r.warehouse_id === wh)
    .map((r) => ({ lot_id: r.lot_id, lot: e.invLots.find((l) => l.id === r.lot_id), qty: D(r.qty).minus(r.pending_out).minus(e.invHolds.filter((h) => h.status === 'open' && h.item_id === r.item_id && h.warehouse_id === wh && (h.lot_id ?? null) === (r.lot_id ?? null)).reduce((s, h) => s.plus(h.qty), D(0))) }))
    .filter((r) => r.qty.gt(0) && (!r.lot?.expiry_date || r.lot.expiry_date > addDays(asOf, 90)))
    .sort((a, b) => (a.lot?.expiry_date ?? '9').localeCompare(b.lot?.expiry_date ?? '9') || (a.lot?.lot_no ?? '').localeCompare(b.lot?.lot_no ?? ''))

  const stockDoc = async (p: Parameters<typeof e.saveStockDoc>[0], o: { by?: ID; approve?: boolean } = {}) => {
    const by = o.by ?? MAKER
    const id = await as(by, p.doc_date, () => e.saveStockDoc(p))
    const j = await as(by, p.doc_date, () => e.proposeStockDoc(id))
    if (j && o.approve !== false) await approve(j, p.doc_date)
    return id
  }

  interface Opening { key: string; qty: number; cost: number; lot_no?: string; mfg?: string; expiry?: string; serial?: boolean; fixed?: boolean }
  /**
   * Brings the stock that the books already carry under the stock ledger. The entry debits and credits the stock ledger
   * by the same amount: quantities are recorded, the value in the books does not change, and the approval is on record.
   */
  const takeOn = async (co: string, wh: ID, rows: Opening[], scaleQuantities: boolean) => {
    const book = await ledgerAt(co, '1140', T0)
    const planned = (rs: Opening[]) => rs.reduce((s, r) => s.plus(D(r.qty).times(r.cost)), D(0))
    const fixed = planned(rows.filter((r) => r.fixed))
    const open = rows.filter((r) => !r.fixed)
    if (scaleQuantities) { const f = book.minus(fixed).div(planned(open)).toNumber(); for (const r of open) if (!r.serial) r.qty = Math.max(1, Math.round(r.qty * f)) }
    const f = book.minus(fixed).div(planned(open))
    let left = book.minus(fixed)
    const value = new Map<Opening, Decimal>()
    open.forEach((r, i) => { const v = i === open.length - 1 ? left : round2(D(r.qty).times(r.cost).times(f)); left = left.minus(v); value.set(r, v) })
    const lines: StockDocLineInput[] = rows.map((r) => ({ item_id: I[r.key], qty: r.qty, lot_no: r.lot_no, mfg_date: r.mfg, expiry_date: r.expiry, unit_cost: r.fixed ? r.cost : q6(value.get(r)!.div(r.qty)).toString() }))
    const id = await as(MAKER, T0, () => e.saveStockDoc({ company_id: C[co], kind: 'receipt', doc_date: T0, warehouse_id: wh, counter_account_id: acc(co, '1140'), reason: 'Opening stock taken on: quantities as counted on the day, value as the books already carry it', lines }))
    const total = (await e.getStockDoc(id)).total_value
    if (!D(total).eq(book)) throw new Error(`seed: opening stock of ${co} is ${total}, the books carry ${book}`)
    await approve(await as(MAKER, T0, () => e.proposeStockDoc(id)), T0)
  }

  // ---------------------------------------------------------------- GHL Medical Equipment
  await warehouse('GMED', 'WH-MAIN', 'Central warehouse', 'warehouse', 'Ambattur Industrial Estate, Chennai')
  await warehouse('GMED', 'DEP-CBE', 'Service depot', 'store', 'Avinashi Road, Coimbatore')
  await warehouse('GMED', 'VAN-2210', 'Service van TN-38-CK-2210', 'service_van', 'With the service team, Coimbatore')
  const catEq = await category('GMED', 'Imaging and diagnostic equipment', 'fifo')
  const catSp = await category('GMED', 'Spares', 'weighted_average')
  const catCn = await category('GMED', 'Consumables', 'weighted_average')
  const gst12 = tax('GMED', 'GST12'), gst18 = tax('GMED', 'GST18')
  await item('GMED', 'us40', catEq, 'EQ-US40', 'Ultrasound system GM-US40', { tracking: 'serial', unit: 'unit', manufacturer: 'Shenzhen MedTech', model: 'GM-US40', hsn_code: '90181210', tax_code_id: gst12, sale_price: 2350000, slow_after_days: 120, unit_weight: 86 })
  await item('GMED', 'dr17', catEq, 'EQ-DR17', 'Digital X-ray detector DR-17', { tracking: 'serial', unit: 'unit', manufacturer: 'Shenzhen MedTech', model: 'DR-17', hsn_code: '90221400', tax_code_id: gst12, sale_price: 1580000, slow_after_days: 120, unit_weight: 14 })
  await item('GMED', 'pm12', catEq, 'EQ-PM12', 'Patient monitor PM-12', { unit: 'unit', manufacturer: 'Shenzhen MedTech', model: 'PM-12', hsn_code: '90181990', tax_code_id: gst12, sale_price: 228000, reorder_level: 4, reorder_qty: 8, unit_weight: 6 })
  await item('GMED', 'ecg', catEq, 'EQ-ECG12', 'ECG machine, 12 channel', { unit: 'unit', manufacturer: 'Shenzhen MedTech', model: 'EC-12', hsn_code: '90181100', tax_code_id: gst12, sale_price: 109000, reorder_level: 5, reorder_qty: 10, unit_weight: 4 })
  await item('GMED', 'ip20', catEq, 'EQ-IP20', 'Infusion pump IP-20', { unit: 'unit', manufacturer: 'Shenzhen MedTech', model: 'IP-20', hsn_code: '90189099', tax_code_id: gst12, sale_price: 62000, unit_weight: 3 })
  await item('GMED', 'probe', catSp, 'SP-PRB-C5', 'Ultrasound probe, convex C5-2', { unit: 'unit', hsn_code: '90189099', tax_code_id: gst18, sale_price: 165000, reorder_level: 2, reorder_qty: 4, unit_weight: 0.6 })
  await item('GMED', 'tube', catSp, 'SP-XRT', 'X-ray tube insert', { unit: 'unit', hsn_code: '90223000', tax_code_id: gst18, sale_price: 372000, reorder_level: 1, reorder_qty: 2, slow_after_days: 365, unit_weight: 9 })
  await item('GMED', 'paper', catCn, 'CN-ECGP', 'ECG paper roll, box of 20', { unit: 'box', hsn_code: '48234000', tax_code_id: gst18, sale_price: 1650, reorder_level: 250, reorder_qty: 400, unit_weight: 1.2 })
  await item('GMED', 'gel', catCn, 'CN-GEL5', 'Ultrasound gel, 5 litre', { tracking: 'lot', unit: 'can', shelf_life_days: 730, hsn_code: '30067000', tax_code_id: gst12, sale_price: 880, reorder_level: 150, reorder_qty: 400, unit_weight: 5.4 })
  await takeOn('GMED', WH['WH-MAIN'], [
    ...['US40-25071', 'US40-25072', 'US40-25075'].map((s) => ({ key: 'us40', qty: 1, cost: 1450000, lot_no: s, serial: true })),
    ...['DR17-25118', 'DR17-25121'].map((s) => ({ key: 'dr17', qty: 1, cost: 980000, lot_no: s, serial: true })),
    { key: 'pm12', qty: 12, cost: 142000 }, { key: 'ecg', qty: 15, cost: 68000 }, { key: 'ip20', qty: 20, cost: 38500 },
    { key: 'probe', qty: 6, cost: 118000 }, { key: 'tube', qty: 2, cost: 265000, serial: true },
    { key: 'gel', qty: 110, cost: 620, lot_no: 'GEL-2411', mfg: addDays(ahead(48), -730), expiry: ahead(48) },
    { key: 'gel', qty: 240, cost: 620, lot_no: 'GEL-2603', mfg: addDays(T0, -150), expiry: addDays(T0, 580) },
    { key: 'paper', qty: 300, cost: 1150 },
  ], true)

  // ---------------------------------------------------------------- GHL Wellness
  await warehouse('GWELL', 'ST-MAIN', 'Main store', 'store', 'R.S. Puram, Coimbatore')
  await warehouse('GWELL', 'ST-ONL', 'Online orders shelf', 'store', 'Packing room, R.S. Puram')
  const catW = await category('GWELL', 'Wellness products', 'weighted_average')
  const catP = await category('GWELL', 'Packing material', 'weighted_average')
  const w12 = tax('GWELL', 'GST12'), w18 = tax('GWELL', 'GST18')
  await item('GWELL', 'ash', catW, 'WL-ASH60', 'Ashwagandha capsules, 60s', { tracking: 'lot', unit: 'bottle', shelf_life_days: 730, hsn_code: '30049011', tax_code_id: w12, sale_price: 399, reorder_level: 800, reorder_qty: 2000 })
  await item('GWELL', 'tea', catW, 'WL-TEA100', 'Herbal tea, tulsi and ginger, 100 g', { tracking: 'lot', unit: 'pack', shelf_life_days: 365, hsn_code: '21069099', tax_code_id: w12, sale_price: 180, reorder_level: 1500, reorder_qty: 4000 })
  await item('GWELL', 'aloe', catW, 'WL-ALOE200', 'Aloe vera gel, 200 ml', { tracking: 'lot', unit: 'tube', shelf_life_days: 540, hsn_code: '33049990', tax_code_id: w18, sale_price: 245, reorder_level: 1000, reorder_qty: 3000 })
  await item('GWELL', 'pro', catW, 'WL-PRO500', 'Plant protein powder, 500 g', { tracking: 'lot', unit: 'jar', shelf_life_days: 540, hsn_code: '21061000', tax_code_id: w18, sale_price: 999, reorder_level: 600, reorder_qty: 1500 })
  await item('GWELL', 'gum', catW, 'WL-GUM30', 'Multivitamin gummies, 30s', { tracking: 'lot', unit: 'bottle', shelf_life_days: 450, hsn_code: '21069099', tax_code_id: w18, sale_price: 475, reorder_level: 800, reorder_qty: 2000 })
  await item('GWELL', 'oil', catW, 'WL-OIL3', 'Essential oil set, 3 × 10 ml', { unit: 'set', hsn_code: '33012990', tax_code_id: w18, sale_price: 749, slow_after_days: 90 })
  await item('GWELL', 'box', catP, 'PK-GIFT', 'Gift box with sleeve', { unit: 'piece', hsn_code: '48192020', tax_code_id: w18, reorder_level: 4500, reorder_qty: 5000 })
  await takeOn('GWELL', WH['ST-MAIN'], [
    // the lot that has passed its expiry, at the cost the write-off register records for it
    { key: 'ash', qty: 420, cost: 220, lot_no: 'HW-2291', mfg: addDays(ago(12), -730), expiry: ago(12), fixed: true },
    { key: 'ash', qty: 2600, cost: 220, lot_no: 'HW-2410', mfg: addDays(T0, -200), expiry: addDays(T0, 530), fixed: true },
    { key: 'tea', qty: 2400, cost: 95, lot_no: 'HT-2502', mfg: addDays(ahead(41), -365), expiry: ahead(41) },
    { key: 'tea', qty: 4200, cost: 95, lot_no: 'HT-2507', mfg: addDays(T0, -70), expiry: addDays(T0, 295) },
    { key: 'aloe', qty: 4800, cost: 130, lot_no: 'AV-2505', mfg: addDays(T0, -110), expiry: addDays(T0, 430) },
    { key: 'pro', qty: 3600, cost: 540, lot_no: 'PP-2506', mfg: addDays(T0, -90), expiry: addDays(T0, 450) },
    { key: 'gum', qty: 4400, cost: 260, lot_no: 'MG-2504', mfg: addDays(T0, -130), expiry: addDays(T0, 320) },
    { key: 'oil', qty: 2400, cost: 410 },
    { key: 'box', qty: 3000, cost: 38 },
  ], true)

  // ---------------------------------------------------------------- what was bought and sold since, in the order it happened
  let serial = 25200
  const receiptOf = new Map<ID, ID>()
  const grni = async (co: string, bill: ID) => {
    const inv = e.invoices.find((i) => i.id === bill)!
    const l = e.lines.find((q) => q.journal_id === inv.journal_id && q.account_id === acc(co, '2125'))
    if (!l) throw new Error('seed: the purchase bill did not reach the goods-received ledger')
    return { inv, value: D(l.debit) }
  }
  const receiveGmed = async (ev: Extract<StockEvent, { kind: 'purchase' }>) => {
    const { inv, value } = await grni('GMED', ev.bill)
    const details = { supplier_invoice: inv.reference, bill_of_entry: 'BE/' + ev.date.replace(/-/g, '').slice(2) + '/4471', port: 'Chennai', country_of_origin: 'China', currency: inv.currency, exchange_rate: inv.fx_rate }
    const lines: StockDocLineInput[] = []
    let left = value
    const unit = (key: string, cost: number, prefix: string) => { lines.push({ item_id: I[key], qty: 1, lot_no: `${prefix}-${++serial}`, unit_cost: cost, import_details: details }); left = left.minus(cost) }
    const n = value.gte(6100000) ? 3 : value.gte(4600000) ? 2 : 1
    for (let i = 0; i < n; i++) unit('us40', 1462000, 'US40')
    unit('dr17', 986500, 'DR17')
    lines.push({ item_id: I.pm12, qty: 4, unit_cost: 143250 }); left = left.minus(573000)
    // the rest of the consignment is ECG machines, at whatever the invoice leaves for them
    const qty = Math.max(1, Math.round(left.div(68400).toNumber()))
    lines.push({ item_id: I.ecg, qty, unit_cost: q6(left.div(qty)).toString() })
    const id = await stockDoc({ company_id: C.GMED, kind: 'receipt', doc_date: ev.date, warehouse_id: WH['WH-MAIN'], party_id: ev.party, reason: `Consignment against supplier invoice ${inv.reference}`, lines })
    if (!D((await e.getStockDoc(id)).total_value).eq(value)) throw new Error('seed: the stock receipt and the bill differ')
    receiptOf.set(ev.bill, id)
  }
  const receiveGwell = async (ev: Extract<StockEvent, { kind: 'purchase' }>) => {
    const { inv, value } = await grni('GWELL', ev.bill)
    const k = value.div(2000000).toNumber()
    const tag = ev.date.slice(2, 4) + ev.date.slice(5, 7)
    const lines: StockDocLineInput[] = []
    let left = value
    const lot = (key: string, qty: number, cost: number, no: string) => { lines.push({ item_id: I[key], qty, unit_cost: cost, lot_no: no, mfg_date: addDays(ev.date, -18) }); left = left.minus(D(qty).times(cost)) }
    lot('pro', Math.round(1500 * k), 545, 'PP-' + tag)
    lot('gum', Math.round(1500 * k), 262, 'MG-' + tag)
    lot('ash', Math.round(1200 * k), 222, 'HW-' + tag)
    lot('tea', Math.max(1, Math.round(left.div(2).div(96).toNumber())), 96, 'HT-' + tag)
    const qty = Math.max(1, Math.min(4900, Math.round(left.div(131).toNumber())))
    lines.push({ item_id: I.aloe, qty, unit_cost: q6(left.div(qty)).toString(), lot_no: 'AV-' + tag, mfg_date: addDays(ev.date, -18) })
    const id = await stockDoc({ company_id: C.GWELL, kind: 'receipt', doc_date: ev.date, warehouse_id: WH['ST-MAIN'], party_id: ev.party, reason: `Batch purchase against supplier invoice ${inv.reference}`, lines })
    if (!D((await e.getStockDoc(id)).total_value).eq(value)) throw new Error('seed: the stock receipt and the bill differ')
    receiptOf.set(ev.bill, id)
  }
  const sellGmed = async (ev: Extract<StockEvent, { kind: 'sale' }>) => {
    const inv = e.invoices.find((i) => i.id === ev.invoice)!
    const lines: StockDocLineInput[] = []
    let left = D(ev.cost)
    for (const key of ['us40', 'dr17']) for (const r of await freeIn('GMED', key, WH['WH-MAIN'], ev.date)) {
      const layer = e.invMovements.find((m) => m.lot_id === r.lot_id && m.is_layer && m.status === 'posted')
      if (!layer || D(layer.remaining_value).gt(left.times(1.04))) continue
      lines.push({ item_id: I[key], qty: 1, lot_id: r.lot_id }); left = left.minus(layer.remaining_value)
    }
    for (const [key, keep] of [['pm12', 3], ['ecg', 4], ['ip20', 6]] as const) {
      const free = (await freeIn('GMED', key, WH['WH-MAIN'], ev.date)).reduce((s, r) => s.plus(r.qty), D(0)).minus(keep)
      const n = Math.min(free.toNumber(), Math.floor(left.div(costOf(key)).toNumber()))
      if (n > 0) { lines.push({ item_id: I[key], qty: n }); left = left.minus(costOf(key).times(n)) }
    }
    if (lines.length) await stockDoc({ company_id: C.GMED, kind: 'issue', doc_date: ev.date, warehouse_id: WH['WH-MAIN'], party_id: ev.party, invoice_id: ev.invoice, dims: dim('GMED', 'department', 'SAL'), reason: `Delivered against invoice ${inv.doc_no}`, lines })
  }
  const sellGwell = async (ev: Extract<StockEvent, { kind: 'sale' }>) => {
    const inv = e.invoices.find((i) => i.id === ev.invoice)!
    const lines: StockDocLineInput[] = []
    for (const [key, share] of [['pro', 0.3], ['gum', 0.2], ['aloe', 0.15], ['tea', 0.15], ['ash', 0.12], ['oil', 0.08]] as const) {
      let want = Math.floor(D(ev.cost).times(share).div(costOf(key)).toNumber())
      // what expires first leaves first
      for (const r of await freeIn('GWELL', key, WH['ST-MAIN'], ev.date)) {
        const n = Math.min(want, r.qty.toNumber())
        if (n <= 0) break
        lines.push({ item_id: I[key], qty: n, lot_id: r.lot_id }); want -= n
      }
    }
    if (lines.length) await stockDoc({ company_id: C.GWELL, kind: 'issue', doc_date: ev.date, warehouse_id: WH['ST-MAIN'], party_id: ev.party, invoice_id: ev.invoice, dims: dim('GWELL', 'department', 'SAL'), reason: `Supplied against invoice ${inv.doc_no}`, lines })
  }
  type Step = { date: string; order: number; run: () => Promise<void> }
  const steps: Step[] = []
  for (const ev of events) {
    if (ev.kind === 'purchase') {
      steps.push({ date: ev.date, order: 0, run: () => (ev.co === 'GMED' ? receiveGmed(ev) : receiveGwell(ev)) })
      const k = ev.charges
      // duty and freight join the cost of the goods they brought in; what has left stock by then is a cost at once
      if (k) steps.push({ date: k.date, order: 1, run: async () => { await stockDoc({
        company_id: C[ev.co], kind: 'landed_cost', doc_date: k.date, receipt_doc_id: receiptOf.get(ev.bill)!, reason: 'Customs duty and freight of the consignment',
        meta: { method: 'value', charges: [{ name: 'Customs duty', amount: k.duty, account_id: acc(ev.co, '2127') }, ...(k.freight ? [{ name: 'Port clearance and inland freight', amount: k.freight, account_id: acc(ev.co, '2127'), party_id: k.carrier }] : [])] },
      }) } })
    } else steps.push({ date: ev.date, order: 2, run: () => (ev.co === 'GMED' ? sellGmed(ev) : sellGwell(ev)) })
  }
  for (const s of steps.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)) await s.run()

  // ---------------------------------------------------------------- movements inside the companies
  // spares and consumables go to the service depot and to the van: place changes, value does not
  await stockDoc({ company_id: C.GMED, kind: 'transfer', doc_date: ago(21), warehouse_id: WH['WH-MAIN'], to_warehouse_id: WH['DEP-CBE'], reason: 'Monthly replenishment of the service depot', lines: [
    { item_id: I.probe, qty: 3 }, { item_id: I.tube, qty: 1 }, { item_id: I.paper, qty: 60 }, { item_id: I.gel, qty: 80, lot_id: lotOf('gel', 'GEL-2603') },
  ] })
  await stockDoc({ company_id: C.GMED, kind: 'transfer', doc_date: ago(15), warehouse_id: WH['DEP-CBE'], to_warehouse_id: WH['VAN-2210'], reason: 'Van stock for the week', lines: [
    { item_id: I.probe, qty: 1 }, { item_id: I.paper, qty: 20 }, { item_id: I.gel, qty: 12, lot_id: lotOf('gel', 'GEL-2603') },
  ] })
  await stockDoc({ company_id: C.GMED, kind: 'issue', doc_date: ago(8), warehouse_id: WH['VAN-2210'], party_id: P.apollo, dims: dim('GMED', 'department', 'SVC'), reason: 'Probe replaced under the maintenance contract, Apollo Care Hospital', lines: [
    { item_id: I.probe, qty: 1 }, { item_id: I.gel, qty: 4, lot_id: lotOf('gel', 'GEL-2603') },
  ] })
  const hold = (co: string, key: string, wh: ID, qty: number, condition: HoldCondition, noted: string, note: string, lot?: ID) =>
    as(MAKER, noted, () => e.saveInvHold({ company_id: C[co], item_id: I[key], warehouse_id: wh, lot_id: lot ?? null, qty, condition, noted_on: noted, note }))
  await hold('GMED', 'pm12', WH['WH-MAIN'], 1, 'damaged', ago(6), 'Screen cracked while unloading. The insurer has been informed; the surveyor is awaited.')
  await hold('GMED', 'tube', WH['WH-MAIN'], 1, 'quarantine', ago(3), 'Vacuum seal to be tested before the tube is released to a customer.')
  // goods returned by a customer: the entry waits in the approval inbox
  await stockDoc({ company_id: C.GMED, kind: 'return_in', doc_date: ago(1), warehouse_id: WH['WH-MAIN'], party_id: P.cityDiag, reason: 'Returned unopened: the order was revised', lines: [{ item_id: I.ip20, qty: 2, unit_cost: q6(costOf('ip20')).toString() }] }, { approve: false })

  // a unit that was sold carries its history with it
  const sold = e.invLots.find((l) => l.company_id === C.GMED && l.item_id === I.us40 && l.sold_to_party_id)
  if (sold) {
    const on = sold.sold_on ?? ago(20)
    const place = 'Radiology, Block B'
    await as(MAKER, notAfterToday(addDays(on, 5)), () => e.saveInvLot({ id: sold.id, installed_on: notAfterToday(addDays(on, 5)), customer_location: place, warranty_until: addMonths(on, 24), note: 'Two-year comprehensive warranty.' }))
    await as(MAKER, notAfterToday(addDays(on, 5)), () => e.recordUnitEvent({ lot_id: sold.id, event_type: 'installation', event_date: notAfterToday(addDays(on, 5)), party_id: sold.sold_to_party_id, engineer_name: 'R. Senthil Kumar', chargeable: false, detail: { location: place, acceptance: 'Signed by the head of radiology', training: 'Two operators trained' } }))
    await as(MAKER, notAfterToday(addDays(on, 12)), () => e.recordUnitEvent({ lot_id: sold.id, event_type: 'engineer_visit', event_date: notAfterToday(addDays(on, 12)), party_id: sold.sold_to_party_id, engineer_name: 'R. Senthil Kumar', cost: 4200, chargeable: false, detail: { complaint: 'Image freezes when the probe is changed', finding: 'Probe connector seated loosely', action: 'Connector reseated and tested' } }))
    await as(MAKER, notAfterToday(addDays(on, 14)), () => e.recordUnitEvent({ lot_id: sold.id, event_type: 'warranty_claim', event_date: notAfterToday(addDays(on, 14)), party_id: sold.sold_to_party_id, chargeable: false, detail: { claim: 'Replacement of the probe connector', on: 'Shenzhen MedTech Co', state: 'Raised with the manufacturer' } }))
  }

  await stockDoc({ company_id: C.GWELL, kind: 'transfer', doc_date: ago(18), warehouse_id: WH['ST-MAIN'], to_warehouse_id: WH['ST-ONL'], reason: 'Stock for online orders', lines: await (async () => {
    const out: StockDocLineInput[] = []
    for (const [key, qty] of [['pro', 300], ['gum', 400], ['aloe', 300], ['tea', 500], ['oil', 150]] as const) {
      const r = (await freeIn('GWELL', key, WH['ST-MAIN'], ago(18))).find((f) => f.qty.gte(qty))
      if (r) out.push({ item_id: I[key], qty, lot_id: r.lot_id })
    }
    return out
  })() })
  // the expired lot: noted, then written off through an adjustment that waits for approval
  const expired = await hold('GWELL', 'ash', WH['ST-MAIN'], 420, 'expired', ago(12), 'Lot HW-2291 passed its expiry. The supplier declined to take it back, in writing.', lotOf('ash', 'HW-2291'))
  await stockDoc({ company_id: C.GWELL, kind: 'adjustment', doc_date: ago(2), warehouse_id: WH['ST-MAIN'], reason: 'Write-off of expired stock, lot HW-2291', lines: [{ item_id: I.ash, qty: -420, lot_id: lotOf('ash', 'HW-2291'), reason_code: 'expiry', hold_id: expired, note: 'To be destroyed in the presence of the store manager' }] }, { approve: false })
  await hold('GWELL', 'oil', WH['ST-MAIN'], 60, 'obsolete', ago(9), 'Old packaging. To be sold at a discount or repacked.')

  // a stock count of the online shelf: counted by one person, reviewed by another, the difference posted after approval
  const count = await as(MAKER, ago(4), () => e.createStockCount({ company_id: C.GWELL, warehouse_id: WH['ST-ONL'], count_date: ago(4), frozen: false, note: 'Monthly count of the online orders shelf' }))
  const counted = (await e.getStockCount(count)).lines!.map((l) => {
    const short: Record<string, [number, StockReason, string]> = { [I.gum]: [6, 'shrinkage', 'Six bottles short. No order or return explains it.'], [I.aloe]: [2, 'breakage', 'Two tubes crushed under a carton.'] }
    const s = short[l.item_id]
    return { id: l.id, counted_qty: D(l.book_qty).minus(s?.[0] ?? 0).toString(), reason_code: s?.[1] ?? null, note: s?.[2] }
  })
  await as(MAKER, ago(4), () => e.recordStockCount(count, counted, true))
  await as(CHECKER, ago(3), () => e.reviewStockCount(count, 'reviewed', 'Differences re-counted in my presence. Reasons accepted.'))
  await approve(await as(CHECKER, ago(3), () => e.proposeStockCount(count)), ago(3))

  // ================================================================ INVESTMENTS AND THE FUND
  const fundStart = ago(300)
  const sponsor = await party('GGF', 'group_company', 'GHL India Ventures Private Limited', { date: fundStart })
  const investors: [string, ID, number][] = [
    ['sponsor', sponsor, 50000000],
    ['coromandel', await party('GGF', 'investor', 'Coromandel Family Office', { date: fundStart }), 60000000],
    ['sundaram', await party('GGF', 'investor', 'Sundaram Holdings', { date: fundStart }), 40000000],
    ['lakshmi', await party('GGF', 'investor', 'Lakshmi Estates LLP', { date: fundStart }), 30000000],
    ['nirmala', await party('GGF', 'investor', 'Dr. Nirmala Venkataraman', { kind: 'person', date: fundStart }), 20000000],
  ]
  const fund = await as(CHECKER, fundStart, () => e.saveFund({
    company_id: C.GGF, name: 'GHL Growth Fund I', scheme: 'Scheme A, growth capital', structure: 'aif_cat2', manager_party_id: sponsor, unit_face_value: 100, fee_pct: 2, fee_basis: 'committed',
    capital_account_id: acc('GGF', '3110'), commitment_period_end: addMonths(fundStart, 36), term_end: addMonths(fundStart, 96), status: 'open', notes: 'Sample fund. Investors, holdings and figures are fictional.',
  }))
  const commitment: Record<string, ID> = {}
  for (const [key, pid, amount] of investors) commitment[key] = await as(CHECKER, fundStart, () => e.saveCommitment({ fund_id: fund, investor_party_id: pid, committed_amount: amount, commitment_date: fundStart, unit_class: 'A' }))

  // what GHL India Ventures holds
  const hFund = await as(CHECKER, fundStart, () => e.saveHolding({ company_id: C.GIV, name: 'Units of GHL Growth Fund I', investee_company_id: C.GGF, instrument: 'units', measurement: 'cost', investment_account_id: acc('GIV', '1220'), confidentiality: 'confidential', notes: 'Commitment of 5 crore as sponsor. Carried at cost; the net asset value of the fund is shown beside it.' }))
  const hold2 = async (co: string, name: string, investee: string, o: Partial<Parameters<typeof e.saveHolding>[0]>, on: string) => {
    const pid = await party(co, 'other', investee, { date: on })
    return as(CHECKER, on, () => e.saveHolding({ company_id: C[co], name, investee_party_id: pid, investment_account_id: acc(co, '1220'), confidentiality: 'confidential', ...o }))
  }
  const txn = async (p: Parameters<typeof e.proposeHoldingTxn>[0], by: ID = CHECKER, stop = false) => {
    const j = await as(by, p.date, () => e.proposeHoldingTxn(p))
    if (!stop) await approve(j, p.date)
    return j
  }

  const call = async (date: string, due: string, pct: number, purpose: string, receipts: Record<string, number>, paidOn: string) => {
    const id = await as(CHECKER, date, () => e.saveCapitalCall({ fund_id: fund, call_date: date, due_date: due, pct, purpose }))
    await as(CHECKER, date, () => e.submitCapitalCall(id))
    for (let i = 0; i < 4 && e.capitalCalls.find((c) => c.id === id)!.status === 'submitted'; i++) await as(OWNER, date, () => e.decideCapitalCall(id, 'approved', 'Within the drawdown plan approved by the investment committee'))
    for (const l of e.capitalCallLines.filter((q) => q.call_id === id)) {
      const key = investors.find((r) => r[1] === l.investor_party_id)![0]
      const share = receipts[key] ?? 1
      if (share <= 0) continue
      const amount = round2(D(l.amount).times(share))
      const day = notAfterToday(addDays(paidOn, investors.findIndex((r) => r[0] === key) * 2))
      await approve(await as(CHECKER, day, () => e.proposeCapitalReceipt({ line_id: l.id, amount: amount.toString(), bank_ledger_id: bank('GGF'), date: day, reference: 'NEFT ' + key.toUpperCase() + ' ' + day })), day)
      // the sponsor's contribution is an investment in the books of the company that paid it
      if (key === 'sponsor') await txn({ holding_id: hFund, kind: 'purchase', date: day, amount: amount.toString(), quantity: amount.div(100).toString(), bank_ledger_id: bank('GIV'), reference: 'Capital call ' + e.capitalCalls.find((c) => c.id === id)!.call_no })
    }
    return id
  }
  await call(ago(280), ago(265), 25, 'First drawdown: investment in Kaveri Agritech and Nilgiri Renewables, and the expenses of setting up the fund', {}, ago(272))

  const hKaveri = await hold2('GGF', 'Kaveri Agritech Pvt Ltd, 14% equity', 'Kaveri Agritech Pvt Ltd', { instrument: 'equity', measurement: 'fair_value', fund_id: fund }, ago(262))
  await txn({ holding_id: hKaveri, kind: 'purchase', date: ago(255), amount: 22000000, quantity: 220000, bank_ledger_id: bank('GGF'), reference: 'Share subscription agreement, tranche 1' })
  const hNilgiri = await hold2('GGF', 'Nilgiri Renewables, compulsorily convertible debentures', 'Nilgiri Renewables Pvt Ltd', { instrument: 'convertible', measurement: 'cost', fund_id: fund }, ago(200))
  await txn({ holding_id: hNilgiri, kind: 'purchase', date: ago(190), amount: 18000000, quantity: 18000, bank_ledger_id: bank('GGF'), reference: 'Debenture subscription agreement' })
  await txn({ holding_id: hNilgiri, kind: 'income', date: ago(70), amount: 900000, tax_deducted: 90000, income_kind: 'interest', bank_ledger_id: bank('GGF'), reference: 'Half-yearly coupon at 10%' })

  // the second call: one investor has not paid, one has paid half
  await call(ago(62), ago(47), 15, 'Second drawdown: investment in Coastal Cold Chain Logistics', { sundaram: 0, lakshmi: 0.5 }, ago(52))
  const hCoastal = await hold2('GGF', 'Coastal Cold Chain Logistics, 9% equity', 'Coastal Cold Chain Logistics Pvt Ltd', { instrument: 'equity', measurement: 'fair_value', fund_id: fund }, ago(45))
  await txn({ holding_id: hCoastal, kind: 'purchase', date: ago(40), amount: 14000000, quantity: 140000, bank_ledger_id: bank('GGF'), reference: 'Share purchase agreement' })
  // a valuation of a holding carried at fair value proposes its own entry
  const value = async (holding: ID, date: string, fair: number, method: string, valuer: string, basis: string, post = true) => {
    const t = await as(CHECKER, date, () => e.recordHoldingValuation({ holding_id: holding, date, fair_value: fair, method, valuer, basis }))
    const j = e.holdingTxns.find((q) => q.id === t)!.journal_id
    if (j && post) await approve(j, date)
    return t
  }
  await value(hKaveri, ago(32), 25300000, 'Price of the latest funding round', 'R. Anand & Co, registered valuers', 'Series B closed at 115 a share in the quarter; no discount applied for the minority holding')
  // a holding carried at cost: the valuation is recorded beside the books and posts nothing
  const vN = await value(hNilgiri, ago(30), 18400000, 'Discounted cash flow', 'R. Anand & Co, registered valuers', 'Coupon of 10%, conversion in month 36, discount rate of 14%')
  await as(OWNER, ago(28), () => e.decideHoldingValuation(vN, 'approved', 'Noted by the investment committee'))

  // management fee of two quarters, owed to the manager
  const q1 = startOfMonth(addMonths(TODAY, -8)), q2 = startOfMonth(addMonths(TODAY, -5))
  for (const from of [q1, q2]) {
    const to = endOfMonth(addMonths(from, 2))
    await approve(await as(CHECKER, to, () => e.proposeFundFee(fund, from, to)), to)
  }
  // net asset value: one approved at the end of last month, one prepared today and awaiting a second person
  const lastMonthEnd = endOfMonth(addMonths(TODAY, -1))
  const nav = await as(CHECKER, lastMonthEnd, () => e.prepareNav(fund, lastMonthEnd, 'Month-end net asset value'))
  await as(OWNER, notAfterToday(addDays(lastMonthEnd, 4)), () => e.decideNav(nav, 'approved', 'Agreed with the trial balance of the fund'))
  // a distribution of the coupon received: declared, and paid to all but one investor, whose payment awaits approval
  const dist = await as(CHECKER, ago(24), () => e.saveDistribution({ company_id: C.GGF, fund_id: fund, kind: 'distribution', declaration_date: ago(24), record_date: ago(24), payment_date: ago(17), total_amount: 750000, tax_pct: 10, source_account_id: acc('GGF', '3200'), notes: 'Out of the coupon received on the debentures of Nilgiri Renewables' }))
  await as(CHECKER, ago(24), () => e.submitDistribution(dist))
  for (let i = 0; i < 4 && e.distributions.find((d) => d.id === dist)!.status === 'submitted'; i++) await as(OWNER, ago(23), () => e.decideDistribution(dist, 'approved', 'Approved by the investment committee'))
  await approve(e.distributions.find((d) => d.id === dist)!.journal_id, ago(23))
  const entitled = e.distributionLines.filter((l) => l.distribution_id === dist)
  const last = entitled.find((l) => l.holder_party_id === investors[4][1]) ?? entitled[entitled.length - 1]
  await approve(await as(CHECKER, ago(17), () => e.proposeDistributionPayment({ distribution_id: dist, bank_ledger_id: bank('GGF'), date: ago(17), line_ids: entitled.filter((l) => l.id !== last.id).map((l) => l.id), reference: 'Bulk payment file D-01' })), ago(17))
  await as(CHECKER, ago(1), () => e.proposeDistributionPayment({ distribution_id: dist, bank_ledger_id: bank('GGF'), date: ago(1), line_ids: [last.id], reference: 'Bank details were corrected by the investor' }))
  // what the fund paid to its sponsor is income in the books of the sponsor
  const own = entitled.find((l) => l.holder_party_id === sponsor)
  if (own) await txn({ holding_id: hFund, kind: 'income', date: ago(17), amount: own.gross_amount, tax_deducted: own.tax_deducted, income_kind: 'distribution', bank_ledger_id: bank('GIV'), reference: 'Distribution ' + e.distributions.find((d) => d.id === dist)!.dist_no })
  await as(CHECKER, TODAY, () => e.prepareNav(fund, TODAY, 'Prepared for the quarterly report to investors'))

  // direct holdings of GHL India Ventures
  const hKovai = await hold2('GIV', 'Kovai Health Tech Pvt Ltd, 26% equity', 'Kovai Health Tech Pvt Ltd', { instrument: 'equity', measurement: 'cost', notes: 'Board seat held by the group.' }, ago(240))
  await txn({ holding_id: hKovai, kind: 'purchase', date: ago(235), amount: 26000000, quantity: 260000, bank_ledger_id: bank('GIV'), reference: 'Share subscription and shareholders agreement' })
  await txn({ holding_id: hKovai, kind: 'income', date: ago(44), amount: 650000, tax_deducted: 65000, income_kind: 'dividend', bank_ledger_id: bank('GIV'), reference: 'Interim dividend' })
  const hListed = await as(CHECKER, ago(170), () => e.saveHolding({ company_id: C.GIV, name: 'Listed equities, portfolio with HDFC Securities', instrument: 'equity', measurement: 'fair_value', investment_account_id: acc('GIV', '1220'), confidentiality: 'internal', notes: 'Large-cap index constituents. Valued at the closing price of the exchange.' }))
  await txn({ holding_id: hListed, kind: 'purchase', date: ago(165), amount: 8000000, quantity: 40000, bank_ledger_id: bank('GIV'), reference: 'Contract notes of the week' }, MAKER)
  await value(hListed, ago(95), 8640000, 'Closing price on the exchange', 'Finance team', 'Quantity held × closing price on the date; statement of the depository attached')
  await txn({ holding_id: hListed, kind: 'sale', date: ago(50), amount: 3450000, quantity: 15000, bank_ledger_id: bank('GIV'), reference: 'Contract notes of the week', counterparty: 'Sold on the exchange' }, MAKER)
  // a valuation entered today: its entry waits in the approval inbox
  await value(hListed, ago(1), 5180000, 'Closing price on the exchange', 'Finance team', 'Quantity held × closing price on the date; statement of the depository attached', false)

  // who owns what
  const link = (p: Parameters<typeof e.saveCorporateLink>[0]) => as(OWNER, START, () => e.saveCorporateLink({ effective_from: START, ...p }))
  await link({ parent_company_id: C.GIV, child_company_id: C.JB, relation: 'subsidiary', ownership_pct: 100, voting_pct: 100 })
  await link({ parent_company_id: C.GIV, child_company_id: C.GCON, relation: 'subsidiary', ownership_pct: 100, voting_pct: 100 })
  await link({ parent_company_id: C.GIV, child_company_id: C.GMED, relation: 'subsidiary', ownership_pct: 76, voting_pct: 76 })
  await link({ parent_party_id: P.shenzhen, child_company_id: C.GMED, relation: 'joint_venture', ownership_pct: 24, voting_pct: 24, note: 'The supplier of the equipment is also a shareholder: dealings with it are dealings with a related party.' })
  await link({ parent_company_id: C.GIV, child_company_id: C.GWELL, relation: 'subsidiary', ownership_pct: 60, voting_pct: 60 })
  await link({ parent_party_id: investors[4][1], child_company_id: C.GWELL, relation: 'associate', ownership_pct: 40, voting_pct: 40 })
  await link({ parent_company_id: C.GIV, child_company_id: C.GGF, relation: 'investment_entity', ownership_pct: 25, note: 'Sponsor commitment of 25% of the fund. The fund is managed, not controlled by shareholding.' })
  await link({ parent_company_id: C.GIV, child_party_id: e.holdings.find((h) => h.id === hKovai)!.investee_party_id, relation: 'associate', ownership_pct: 26, voting_pct: 26 })
  const trust = await party('GIV', 'shareholder', 'Subramanian Family Trust')
  const family = await party('GIV', 'shareholder', 'Coromandel Family Office')
  for (const [holder, shares] of [[trust, 28000000], [family, 8000000], [P.rajesh, 4000000]] as const) await as(OWNER, START, () => e.saveEquityHolder({ company_id: C.GIV, holder_party_id: holder, share_class: 'Equity', quantity: shares, paid_up: shares * 10, note: 'Face value 10, fully paid' }))
  await link({ parent_party_id: trust, child_company_id: C.GIV, relation: 'holding_company', ownership_pct: 70, voting_pct: 70 })

  // ================================================================ REALITY AND CONTROL
  for (const [co, amount, note] of [
    ['GIV', 500000, 'Set by the audit committee: half a percent of total assets, rounded down'], ['JB', 250000, 'Set by the audit committee: half a percent of revenue, rounded'],
    ['GCON', 400000, 'Set by the audit committee: half a percent of revenue, rounded'], ['GMED', 150000, 'Set by the audit committee: half a percent of revenue, rounded'],
    ['GWELL', 50000, 'Set by the audit committee: half a percent of revenue, rounded'], ['GGF', 200000, 'Set by the investment committee: a tenth of a percent of commitments'],
  ] as const) await as(OWNER, START, () => e.setMateriality(C[co], amount, null, note))

  // confirmations from outside: what the other side says the balance is
  const monthEnd = lastMonthEnd
  const confirm = async (p: Parameters<typeof e.saveConfirmation>[0], sent: string | null, reply?: { by: number; on: string; then?: ['explained' | 'disputed', string] } | 'no_reply') => {
    // a confirmation of a confidential record is prepared by someone cleared to read it
    const id = await as(p.confidentiality ? CHECKER : MAKER, notAfterToday(addDays(monthEnd, 3)), () => e.saveConfirmation(p))
    if (!sent) return id
    await as(MAKER, notAfterToday(addDays(monthEnd, 4)), () => e.updateConfirmation({ id, action: 'sent', sent_how: sent, sent_on: notAfterToday(addDays(monthEnd, 4)) }))
    if (reply === 'no_reply') await as(MAKER, TODAY, () => e.updateConfirmation({ id, action: 'no_reply', explanation: 'Two reminders sent. No reply so far.' }))
    else if (reply) {
      const c = e.confirmations.find((q) => q.id === id)!
      await as(MAKER, reply.on, () => e.updateConfirmation({ id, action: 'reply', confirmed_balance: D(c.book_balance).plus(reply.by).toString(), received_on: reply.on }))
      if (reply.then) await as(CHECKER, reply.on, () => e.updateConfirmation({ id, action: reply.then![0], explanation: reply.then![1] }))
    }
    return id
  }
  const kotak = e.parties.find((p) => p.display_name === 'Kotak Mahindra Bank')
  const loan = e.loans.find((l) => l.company_id === C.GMED && l.party_id === kotak?.id)
  const fd = e.deposits.find((d) => d.company_id === C.GIV)
  await confirm({ company_id: C.JB, subject: 'bank', as_of: monthEnd, entity_id: 'bank-JB', contact: 'Branch manager, HDFC Bank, R.S. Puram' }, 'Balance confirmation letter, by hand to the branch', { by: 18250, on: ago(12), then: ['explained', 'Interest on the sweep deposit was credited by the bank and is not yet in the books. It is on the bank statement awaiting matching.'] })
  const cSund = await confirm({ company_id: C.GCON, subject: 'customer', as_of: monthEnd, party_id: P.sundaram, contact: 'Mr. Raghavan, Accounts' }, 'Statement of account, by e-mail from the accounts mailbox', { by: -1180000, on: ago(9) })
  await confirm({ company_id: C.GCON, subject: 'vendor', as_of: monthEnd, party_id: P.steel, contact: 'Accounts, Steelmax Traders' }, 'Balance confirmation letter, by e-mail', 'no_reply')
  await confirm({ company_id: C.GCON, subject: 'customer', as_of: monthEnd, party_id: P.tnInfra, contact: 'Deputy General Manager, Finance' }, 'Balance confirmation letter, by registered post', { by: 0, on: ago(7) })
  if (loan) await confirm({ company_id: C.GMED, subject: 'loan', as_of: monthEnd, entity_id: loan.id, contact: 'Relationship manager, Kotak Mahindra Bank' }, 'Loan balance certificate requested through the bank portal', { by: 0, on: ago(11) })
  if (fd) await confirm({ company_id: C.GIV, subject: 'deposit', as_of: monthEnd, entity_id: fd.id, contact: 'HDFC Bank, Anna Salai' }, 'Deposit confirmation requested at the branch', { by: 0, on: ago(10) })
  // between two companies of the group nothing is sent: the books of the other company are read, if the person may read them
  await confirm({ company_id: C.GIV, subject: 'intercompany', as_of: monthEnd, counter_company_id: C.JB }, null)
  await confirm({ company_id: C.GIV, subject: 'intercompany', as_of: monthEnd, counter_company_id: C.GCON }, null)
  await confirm({ company_id: C.GIV, subject: 'investment', as_of: monthEnd, entity_id: hKovai, contact: 'Company secretary, Kovai Health Tech', confidentiality: 'confidential' }, null)

  // physical verification of assets, and of the stock of one store
  const ver = await as(CHECKER, ago(12), () => e.openVerification({ company_id: C.GMED, subject: 'assets', run_date: ago(12), performed_by_name: 'Internal audit', witness_name: 'Service manager', note: 'Half-yearly verification of fixed assets' }))
  const vLines = (await e.getVerification(ver)).lines!
  await as(CHECKER, ago(12), () => e.recordVerification(ver, vLines.map((l) => (/CK-2264/.test(l.label)
    ? { id: l.id, result: 'damaged' as const, note: 'Rear panel damaged in the depot. Repair estimate awaited.' }
    : { id: l.id, result: 'located' as const, note: 'Tag intact' }))))
  await as(CHECKER, ago(11), () => e.completeVerification(ver))
  const ver2 = await as(CHECKER, ago(1), () => e.openVerification({ company_id: C.GWELL, subject: 'inventory', run_date: ago(1), scope: { warehouse_id: WH['ST-MAIN'] }, performed_by_name: 'Internal audit', witness_name: 'Store manager', note: 'Surprise verification of the main store. In progress.' }))
  const v2 = (await e.getVerification(ver2)).lines!
  await as(CHECKER, ago(1), () => e.recordVerification(ver2, v2.slice(0, Math.ceil(v2.length / 2)).map((l) => ({ id: l.id, result: 'matched' as const, found_qty: l.book_qty ?? 0 }))))

  // cases: a difference is looked into by a person, step by step, and every step is kept
  const dup = e.invoices.filter((i) => i.company_id === C.JB && i.reference === 'SLA/2026/118')
  const c1 = await as(CHECKER, ago(10), () => e.openCase({ company_id: C.JB, kind: 'sentinel', title: 'The same legal bill appears twice: SLA/2026/118', summary: 'Two purchase bills from Shree Legal Associates carry the same reference and the same amount, eight days apart.', attention: 'finance_action', amount: D(dup[0]?.total ?? 278480).toNumber(), owner_user: MAKER, owner_name: 'Priya Raman', links: dup.map((i) => ({ entity: 'invoices', entity_id: i.id, label: i.doc_no ?? 'Bill' })) }))
  await as(MAKER, ago(8), () => e.updateCase({ id: c1, status: 'under_review', note: 'Both bills are unpaid. The vendor has been asked whether the second is a reminder or a second piece of work.' }))
  const c2 = await as(CHECKER, ago(9), () => e.openCase({ company_id: C.GCON, kind: 'confirmation', title: 'Sundaram Holdings confirms less than the books show', summary: 'The customer confirms 11.8 lakh less than our receivable at the end of the month.', attention: 'management_action', amount: 1180000, owner_user: CHECKER, owner_name: 'Arun Mehta', links: [{ entity: 'confirmations', entity_id: cSund, label: 'Balance confirmation' }, { entity: 'parties', entity_id: P.sundaram, label: 'Sundaram Holdings' }] }))
  await as(CHECKER, ago(7), () => e.updateCase({ id: c2, status: 'investigating', note: 'The customer says it has deducted retention on two running bills. The contract is being read for a retention clause.' }))
  await as(CHECKER, ago(2), () => e.updateCase({ id: c2, note: 'The contract allows 5% retention until the defects period ends. Our invoices do not show it. To be corrected by credit notes after approval.', attention: 'owner_action' }))
  await as(MAKER, ago(5), () => e.openCase({ company_id: C.GWELL, kind: 'reality', title: 'Expired stock is still in the books: lot HW-2291', summary: '420 bottles passed their expiry and are carried at cost. The adjustment that writes them off awaits approval.', attention: 'finance_action', amount: 92400, owner_name: 'Store manager', links: [{ entity: 'inv_items', entity_id: I.ash, label: 'WL-ASH60' }] }))
  const van = e.assets.find((a) => /CK-2264/.test(a.name))
  const c4 = await as(CHECKER, ago(11), () => e.openCase({ company_id: C.GMED, kind: 'verification', title: 'Service van found damaged at verification', summary: 'The register carries the van as active and undamaged. The verification found the rear panel damaged.', attention: 'finance_action', amount: 42000, owner_name: 'Service manager', links: van ? [{ entity: 'fixed_assets', entity_id: van.id, label: van.asset_no }, { entity: 'verification_runs', entity_id: ver, label: 'Verification' }] : [] }))
  await as(CHECKER, ago(6), () => e.updateCase({ id: c4, status: 'substantiated', note: 'Damage confirmed by the workshop. Estimate of 42,000. An insurance claim is being prepared.' }))
  const c5 = await as(CHECKER, ago(5), () => e.openCase({ company_id: C.JB, kind: 'reality', title: 'Petty cash counted 350 short of the books', summary: 'The surprise count found 350 less than the book balance of the head office petty cash.', attention: 'information', amount: 350, owner_name: 'Lakshmi Priya' }))
  await as(CHECKER, ago(3), () => e.updateCase({ id: c5, status: 'closed', note: 'The courier voucher was found and entered.', resolution: 'A voucher of 350 had not been entered on the day of the count. Entered on the next working day; the box agrees.' }))

  // a posted entry moved to the ledger it belongs in, without touching the entry
  const sw = e.journals.filter((j) => j.company_id === C.GIV && j.status === 'posted' && j.narration === 'Software subscriptions' && j.journal_date >= startOfMonth(addMonths(TODAY, -1))).sort((a, b) => b.journal_date.localeCompare(a.journal_date))[0]
  const swLine = sw && e.lines.find((l) => l.journal_id === sw.id && l.account_id === acc('GIV', '6610'))
  if (swLine) await approve(await as(MAKER, TODAY, () => e.proposeReclassification({ line_id: swLine.id, to_account_id: acc('GIV', '6620'), amount: round2(D(swLine.debit).times(0.4)).toString(), date: TODAY, reason: 'Part of the invoice is for cloud hosting, not for software licences' })), TODAY)
  // head office rent shared between departments by the people in each: awaiting approval
  const rentFrom = startOfMonth(addMonths(TODAY, -1)), rentTo = endOfMonth(rentFrom)
  const adm = dim('GIV', 'department', 'ADM').department
  if (adm) {
    const al = await as(MAKER, TODAY, () => e.saveAllocation({
      company_id: C.GIV, name: 'Head office rent shared by headcount', period_from: rentFrom, period_to: rentTo, source_account_id: acc('GIV', '6210'), source_org_unit_id: adm, dimension_type: 'department', amount: 120000, driver: 'headcount',
      driver_note: 'People seated at the head office on the last day of the month', recipients: [{ org_unit_id: dim('GIV', 'department', 'FIN').department, driver_value: 9 }, { org_unit_id: dim('GIV', 'department', 'SAL').department, driver_value: 4 }, { org_unit_id: dim('GIV', 'department', 'MKT').department, driver_value: 3 }],
    }))
    await as(MAKER, TODAY, () => e.proposeAllocation(al))
  }

  // ================================================================ SIMULATIONS
  const driver = async (p: Parameters<typeof e.saveTwinDriver>[0], decide: 'approved' | null) => {
    const id = await as(CHECKER, ago(20), () => e.saveTwinDriver(p))
    if (decide) await as(OWNER, ago(18), () => e.decideTwinDriver(id, decide))
  }
  await driver({ company_id: null, key: 'salary_increase_pct', name: 'Annual salary increase', unit: 'percent', value: 8, basis: 'Increment policy approved by the board for the year', source: 'assumed' }, 'approved')
  await driver({ company_id: null, key: 'collection_delay_days', name: 'Customers pay later in a slowdown', unit: 'days', value: 20, basis: 'The longest delay seen in the receipts of the last two years', source: 'recorded' }, 'approved')
  await driver({ company_id: null, key: 'rate_rise_pts', name: 'Rise in lending rates', unit: 'rate', value: 1.5, basis: 'Stress case used by the lenders of the group', source: 'assumed' }, 'approved')
  await driver({ company_id: null, key: 'revenue_growth_pct', name: 'Growth in revenue', unit: 'percent', value: 12, basis: 'Sales plan of the year, not yet approved by the board', source: 'assumed' }, null)
  const scenario = (p: Parameters<typeof e.saveScenario>[0]) => as(CHECKER, ago(16), () => e.saveScenario({ horizon_months: 12, shared: true, ...p }))
  await scenario({ company_id: null, name: 'Books continue as they are', kind: 'base', description: 'No assumption. The monthly rates of the last six months continue.', shocks: [] })
  await scenario({ company_id: null, name: 'Rates rise and customers pay later', kind: 'conservative', description: 'Lending rates rise and customers take longer to pay, from the third month.', shocks: [
    { kind: 'interest_rate_pts', value: 1.5, from_month: 3, driver_key: 'rate_rise_pts', label: 'Lending rates rise' }, { kind: 'collection_delay_days', value: 20, from_month: 3, driver_key: 'collection_delay_days', label: 'Customers pay later' },
  ] })
  await scenario({ company_id: C.GCON, name: 'Sundaram Holdings stops buying', kind: 'custom', description: 'The second-largest customer of GHL Constructions places no further work.', shocks: [{ kind: 'lose_customer', value: 100, from_month: 2, target: 'Sundaram Holdings', target_id: P.sundaram, label: 'Sundaram Holdings is lost' }] })
  await scenario({ company_id: C.GMED, name: 'Second service team and a rupee that weakens', kind: 'custom', description: 'Six engineers are hired and the rupee loses 6% against the dollar.', shocks: [
    { kind: 'new_hires', value: 6, extra: 65000, from_month: 2, label: 'Six service engineers' }, { kind: 'fx_pct', value: 6, extra: 80, from_month: 1, label: 'Rupee weakens by 6%' }, { kind: 'capex', value: 3200000, from_month: 2, months: 96, label: 'Two more service vans' },
  ] })

  // ================================================================ SCENARIO STUDIO
  const imprest: FlowDefinition = {
    steps: [
      { key: 'request', name: 'Request for site imprest', action: 'request', actor_role: '*', guidance: 'State the site, the period and what the money is for.' },
      { key: 'approval', name: 'Approval by the finance head', action: 'approval', actor_role: 'finance_head', guidance: 'Approve the purpose and the amount. Approval releases no money.' },
      { key: 'release', name: 'Release of the advance', action: 'fund_release', actor_role: '*', links_to: 'advances', guidance: 'Point to the advance that released the money.' },
      { key: 'evidence', name: 'Receipts collected', action: 'evidence', actor_role: '*', required_documents: ['expense_receipt'], guidance: 'Attach the receipts of what was spent.' },
      { key: 'settlement', name: 'Settlement through an expense claim', action: 'settlement', actor_role: '*', links_to: 'expense_claims', guidance: 'Point to the claim that settled the advance.' },
      { key: 'review', name: 'Review by the project manager', action: 'review', actor_role: '*', optional: true },
    ],
    fields: [{ key: 'site', label: 'Site', type: 'text', required: true }, { key: 'period', label: 'Period covered', type: 'text', required: true }, { key: 'estimate', label: 'Estimate', type: 'money' }],
    actors: ['Site supervisor', 'Finance head', 'Accountant', 'Project manager'],
    money_flow: 'Bank → site supervisor (advance) → vendors at site. Any balance returns to the bank.',
    accounting: 'The advance is an asset until it is settled. Cost is recognised by the expense claim, ledger by ledger.',
    settlement: 'Within 21 days of release, by an expense claim with receipts.',
    notifications: 'The approver is told when a request waits. The requester is told when the settlement date passes.',
    sentinel: 'An advance older than its settlement date is raised as an alert.',
    reports: 'Advances outstanding by site and by person.',
  }
  const flow = await as(OWNER, ago(40), () => e.saveFlowDef({ company_id: null, key: 'site_imprest', name: 'Site imprest, request to settlement', description: 'Money handed to a site for small purchases, from the request to its settlement.', category: 'Advances', trigger_kind: 'manual', definition: imprest }))
  await as(OWNER, ago(40), () => e.setFlowStatus(flow, 'active'))
  await as(OWNER, ago(6), () => e.saveFlowDef({ company_id: null, key: 'vendor_onboarding', name: 'A new vendor is taken on', description: 'Documents, bank details verified by a second person, and the first order. Still being designed.', category: 'Purchasing', trigger_kind: 'form', definition: {
    steps: [
      { key: 'details', name: 'Vendor details and documents', action: 'request', actor_role: '*', required_documents: ['contract'] },
      { key: 'bank', name: 'Bank details verified by a second person', action: 'review', actor_role: 'finance_head' },
      { key: 'approval', name: 'Approval', action: 'approval', actor_role: 'finance_head' },
    ],
    fields: [{ key: 'gstin', label: 'GSTIN', type: 'text' }, { key: 'category', label: 'What they supply', type: 'text', required: true }],
  } }))
  const adv = e.advances.find((a) => /Registration and stamp duty incidentals/.test(a.purpose))
  if (adv) {
    const fc = await as(MAKER, ago(44), () => e.startFlowCase({ flow_id: flow, company_id: C.JB, title: 'Site imprest: Rubycon phase 2 registration', party_id: adv.recipient_party_id, amount: 150000, data: { site: 'Project Rubycon', period: 'Registration week', estimate: 150000 } }))
    await as(MAKER, ago(44), () => e.completeFlowStep({ case_id: fc, note: 'Request raised by the site supervisor' }))
    await as(CHECKER, ago(43), () => e.completeFlowStep({ case_id: fc, note: 'Purpose and estimate reviewed' }))
    await as(MAKER, ago(42), () => e.completeFlowStep({ case_id: fc, entity_id: adv.id, note: 'Released by bank transfer' }))
  }

  // ================================================================ THE PLATFORM
  await as(OWNER, START, () => e.saveAttentionRule({ kind: 'approval:journal', min_amount: 10000000, class: 'owner_action', note: 'Entries above one crore are for the owner to see' }))
  await as(OWNER, START, () => e.saveAttentionRule({ kind: 'approval:distribution', min_amount: 0, class: 'owner_action', note: 'Every distribution to investors is for the owner to see' }))
  const template = (p: Parameters<typeof e.saveMessageTemplate>[0]) => as(CHECKER, START, () => e.saveMessageTemplate(p))
  await template({ company_id: null, key: 'payment_reminder', name: 'Payment reminder, first', subject: 'Invoice {{invoice_no}} is due', body: 'Dear {{contact}},\n\nOur invoice {{invoice_no}} of {{invoice_date}} for {{amount}} fell due on {{due_date}}. We would be grateful for your payment, or for a word on when we may expect it.\n\nWith regards,\n{{company}}' })
  await template({ company_id: null, key: 'confirmation', name: 'Confirmation of balance', subject: 'Confirmation of balance as at {{as_of}}', body: 'Dear {{contact}},\n\nOur books show a balance of {{amount}} with you as at {{as_of}}. Please confirm the balance in your books, or tell us the balance you hold and we will reconcile the two.\n\nWith regards,\n{{company}}' })
  await template({ company_id: null, key: 'statement', name: 'Statement of account', subject: 'Statement of account, {{period}}', body: 'Dear {{contact}},\n\nPlease find the statement of your account for {{period}}. The balance is {{amount}}.\n\nWith regards,\n{{company}}' })
  await template({ company_id: C.GGF, key: 'capital_call', name: 'Capital call notice', subject: 'Capital call {{call_no}}, {{fund}}', body: 'Dear investor,\n\nThe fund calls {{pct}}% of your commitment, {{amount}}, payable by {{due_date}}, for: {{purpose}}.\n\nWith regards,\n{{manager}}' })
  // NUMERO prepares what is to be said; a person sends it, and records that it was sent
  const overdue = e.invoices.filter((i) => i.company_id === C.GCON && i.party_id === P.sundaram && i.doc_type === 'sales_invoice' && ['open', 'partially_paid'].includes(i.status)).sort((a, b) => a.doc_date.localeCompare(b.doc_date))[0]
  if (overdue) {
    const m = await as(MAKER, ago(6), () => e.prepareCommunication({ company_id: C.GCON, channel: 'email', template_key: 'payment_reminder', party_id: P.sundaram, to_address: 'Accounts, Sundaram Holdings', subject: `Invoice ${overdue.doc_no} is due`, body: `Dear Mr. Raghavan,\n\nOur invoice ${overdue.doc_no} of ${fmtDate(overdue.doc_date)} fell due on ${fmtDate(overdue.due_date)}. We would be grateful for your payment, or for a word on when we may expect it.\n\nWith regards,\nGHL Constructions`, entity: 'invoices', entity_id: overdue.id }))
    await as(MAKER, ago(6), () => e.markCommunication(m, 'sent_by_person', 'Sent from the accounts mailbox by Priya Raman', ago(6)))
  }
  await as(MAKER, ago(1), () => e.prepareCommunication({ company_id: C.GCON, channel: 'letter', template_key: 'confirmation', party_id: P.steel, to_address: 'Accounts, Steelmax Traders', subject: `Confirmation of balance as at ${fmtDate(monthEnd)}`, body: `Dear Sir or Madam,\n\nWe wrote to you for a confirmation of the balance as at ${fmtDate(monthEnd)} and have not had your reply. Please confirm the balance in your books.\n\nWith regards,\nGHL Constructions`, entity: 'parties', entity_id: P.steel }))

  // what NUMERO connects to, and what it does not. No secret is kept here: only where it is kept.
  const connect = (p: Omit<Parameters<typeof e.saveIntegration>[0], 'company_id'>) => as(OWNER, ago(30), () => e.saveIntegration({ ...p, company_id: null }))
  await connect({ key: 'speech_to_text', name: 'Speech recognition for Indian languages', kind: 'speech', direction: 'outbound', moves_money: false, environment: 'production', status: 'planned', scopes: ['Audio of a spoken command, for transcription'], auth_method: 'Issued by the provider to the owner of the account', secret_location: 'Environment settings of the hosting platform, entered by the owner', owner_name: 'Group IT', notes: 'Not connected. Voice commands use the recognition built into the browser until it is.' })
  await connect({ key: 'bank_statements', name: 'Bank statements, HDFC Bank', kind: 'bank', direction: 'inbound', moves_money: false, environment: 'production', status: 'planned', scopes: ['Read statements'], owner_name: 'Finance', notes: 'Not connected. Statements are imported as files.' })
  await connect({ key: 'bank_payments', name: 'Payments through the bank', kind: 'bank', direction: 'outbound', moves_money: true, environment: 'sandbox', status: 'planned', scopes: ['Submit a payment file that a person has approved'], owner_name: 'Finance', notes: 'Not connected, and not planned without a test in the sandbox of the bank. NUMERO proposes and records payments; people make them in the portal of the bank.' })
  await connect({ key: 'ghl_pulse', name: 'GHL Pulse', kind: 'ghl_platform', direction: 'inbound', moves_money: false, environment: 'production', status: 'planned', scopes: ['Read sales orders'], owner_name: 'Group IT', notes: 'Not connected.' })
  await connect({ key: 'email', name: 'Outgoing e-mail', kind: 'email', direction: 'outbound', moves_money: false, environment: 'production', status: 'planned', scopes: ['Send a message a person has approved'], owner_name: 'Group IT', notes: 'Not connected. Messages are prepared here and sent by a person from their own mailbox.' })
}

/** What can only be done once everything else is in the books: the analytical store, a saved simulation, and a tidy inbox. */
export async function finishDemoP3(x: SeedCtx): Promise<void> {
  const { e, C, TODAY, CHECKER, OWNER, as } = x
  const ago = (n: number) => addDays(TODAY, -n)

  // a trial balance of the earlier system, kept beside the books for the parallel run; two ledgers differ
  const end = endOfMonth(addMonths(TODAY, -3))
  const tb = (await e.ledgerBalances([C.GWELL], '1990-01-01', end)).map((b) => ({ a: e.account(b.account_id)!, v: D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit) })).filter((r) => !r.v.isZero())
  const shift = (code: string, by: number) => { const r = tb.find((t) => t.a.code === code); if (r) r.v = r.v.plus(by) }
  if (tb.some((t) => t.a.code === '6260') && tb.some((t) => t.a.code === '1121')) { shift('6260', 4200); shift('1121', -4200) }
  if (tb.length) {
    const batch = await as(CHECKER, ago(14), () => e.stageImport({
      company_id: C.GWELL, kind: 'legacy_trial_balance', file_name: `trial-balance-${end}.csv`, sha256: 'a3f1'.repeat(16), period_end: end, note: 'Trial balance of the earlier accounting package, for the parallel run',
      rows: tb.map((t) => ({ account: t.a.code, name: t.a.name, debit: t.v.gt(0) ? t.v.toString() : '0', credit: t.v.lt(0) ? t.v.neg().toString() : '0' })),
    }))
    if (e.imports.find((b) => b.id === batch)!.ok) await as(CHECKER, ago(14), () => e.commitImport(batch))
  }
  // a file that does not pass its checks stays where it is: nothing of it enters the books
  await as(CHECKER, ago(2), () => e.stageImport({ company_id: C.GWELL, kind: 'journals', file_name: 'journals-from-the-store.csv', sha256: 'c90e'.repeat(16), note: 'Entries kept by the store in a spreadsheet', rows: [
    { date: ago(20), ref: 'ST-101', account: '6260', debit: '1850', narration: 'Courier, local' }, { date: ago(20), ref: 'ST-101', account: '1115', credit: '1850', narration: 'Courier, local' },
    { date: ago(19), ref: 'ST-102', account: '6450', debit: '2400', narration: 'Tea and snacks for the stock count' }, { date: ago(19), ref: 'ST-102', account: '1115', credit: '2040', narration: 'Tea and snacks for the stock count' },
    { date: ago(18), ref: 'ST-103', account: '6999', debit: '900', narration: 'Miscellaneous' }, { date: ago(18), ref: 'ST-103', account: '1115', credit: '900', narration: 'Miscellaneous' },
  ] }))

  // backups are made outside NUMERO; a person records that one was made and that one was restored
  await as(OWNER, ago(1), () => e.recordBackupCheck({ kind: 'backup', performed_on: ago(1), outcome: 'succeeded', covers: 'database_and_files', evidence: 'Sample record. In a live system: the reference of the backup in the console of the database provider.', performed_by_name: 'Group IT', recovery_point: ago(1) + 'T02:00:00' }))
  await as(OWNER, ago(38), () => e.recordBackupCheck({ kind: 'restore_test', performed_on: ago(38), outcome: 'succeeded', covers: 'database', evidence: 'Sample record. In a live system: the note of the restore into a separate project, with the row counts compared.', performed_by_name: 'Group IT', recovery_point: ago(39) + 'T02:00:00', recovery_minutes: 42, note: 'Restored into a separate project and compared with the trial balance.' }))

  // a simulation saved with its result, labelled as what it is
  const ids = Object.values(C)
  const twin = await as(CHECKER, TODAY, () => loadTwin(e, e.companies, e.accounts, ids, { asOf: TODAY }))
  for (const s of e.scenarios.filter((q) => q.company_id === null)) {
    const result = simulate(twin.base, s.shocks, s.horizon_months, s.name, twin.drivers)
    await as(CHECKER, TODAY, () => e.saveScenarioRun({ scenario_id: s.id, company_ids: ids, as_of: TODAY, base: twin.base as unknown as Record<string, unknown>, result: result as unknown as Record<string, unknown>, note: 'Run on the sample books' }))
  }

  // monthly totals for analysis over years
  for (const id of ids) await as(OWNER, TODAY, () => e.refreshFacts(id))

  // approvals that were decided long ago are not news: only what still waits, and what is recent, stays unread
  const waiting = new Set(e.approvalRequests.filter((r) => r.status === 'pending').map((r) => r.id))
  const recent = ago(7) + 'T00:00:00'
  for (const n of e.notifications) {
    const open = n.dedupe_key.startsWith('approval:') ? waiting.has(n.dedupe_key.slice(9)) : n.created_at >= recent
    if (!open && !n.read_at) n.read_at = n.created_at
  }
}
