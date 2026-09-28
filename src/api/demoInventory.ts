import Decimal from 'decimal.js'
import { D, ZERO, round2 } from '@/lib/money'
import { addDays, today } from '@/lib/dates'
import type { ID, JournalLineInput, Num } from '@/engine/types'
import type { WorkflowPosting } from '@/engine/opsTypes'
import type {
  InvCategory, InvCategoryInput, InvHold, InvHoldInput, InvItem, InvItemInput, InvLot, InvLotInput, InvMovement, StockCount, StockCountEntry, StockCountLine,
  StockDoc, StockDocInput, StockDocKind, StockDocLine, StockReason, StockRow, UnitEvent, UnitEventInput, Warehouse, WarehouseInput,
} from '@/engine/p3Types'
import { DemoOpsB } from './demoOpsB'
import { fail, uid } from './demoCore'

// =====================================================================
// DEMO ENGINE — INVENTORY. Mirrors migration 0014: the same rules, the
// same refusals, the same wording. All data it holds is SAMPLE DATA.
//
// The stock ledger and the general ledger say the same thing: a movement
// that changes the value of stock belongs to a stock document whose
// accounting entry was proposed and approved. A transfer inside one
// company changes no value and proposes nothing.
// =====================================================================

type WfEvent = 'posted' | 'voided' | 'reversed'
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const q4 = (v: Decimal.Value) => D(v).toDecimalPlaces(4)
const q6 = (v: Decimal.Value) => D(v).toDecimalPlaces(6)
const REASONS: StockReason[] = ['damage', 'expiry', 'theft', 'breakage', 'obsolescence', 'shrinkage', 'count_difference', 'found', 'sample', 'other']
const PREFIX: Record<StockDocKind, string> = { receipt: 'SR', issue: 'SI', transfer: 'ST', return_in: 'SRI', return_out: 'SRO', adjustment: 'SA', landed_cost: 'LC' }
interface LayerUse { id: ID; movement_id: ID; layer_id: ID; qty: string; value: string; released: boolean }

export class DemoInventory extends DemoOpsB {
  invCategories: InvCategory[] = []
  warehouses: Warehouse[] = []
  invItems: InvItem[] = []
  invLots: InvLot[] = []
  unitEvents: UnitEvent[] = []
  stockDocs: StockDoc[] = []
  stockDocLines: StockDocLine[] = []
  invMovements: InvMovement[] = []
  protected layerUse: LayerUse[] = []
  stockCounts: StockCount[] = []
  stockCountLines: StockCountLine[] = []
  invHolds: InvHold[] = []

  constructor() {
    super()
    this.handlers.stock_doc = (w, e) => this.applyStockDoc(w.source_id, e, w.journal_id)
  }

  // ------------------------------------------------------------ master data
  protected invAccount(companyId: ID, id: ID | null | undefined, what: string) {
    return this.postingAccount(companyId, id, `choose an active posting account of this company for ${what}.`)
  }
  protected invItem(id: ID | undefined | null) { return this.invItems.find((i) => i.id === id) ?? fail('item not found.') }
  protected invCategory(id: ID) { return this.invCategories.find((c) => c.id === id) ?? fail('category not found.') }

  async listInvCategories(companyIds: ID[]) { return this.invCategories.filter((c) => companyIds.includes(c.company_id)).sort((a, b) => a.name.localeCompare(b.name)) }
  async saveInvCategory(p: InvCategoryInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.name)) fail('a name is required.')
    const method = p.valuation_method ?? 'weighted_average'
    if (!['weighted_average', 'fifo'].includes(method)) fail('the valuation method must be weighted average or first in, first out.')
    const inv = this.invAccount(p.company_id, p.inventory_account_id, 'the stock ledger')
    this.invAccount(p.company_id, p.cogs_account_id, 'the cost of goods sold')
    if (inv.type !== 'asset') fail('the stock ledger must be an asset.')
    if (!p.id) {
      if (this.invCategories.some((c) => c.company_id === p.company_id && c.name === p.name.trim())) fail('a category of this name already exists.')
      const c: InvCategory = { id: uid(), company_id: p.company_id, name: p.name.trim(), inventory_account_id: p.inventory_account_id, cogs_account_id: p.cogs_account_id, valuation_method: method, is_active: true }
      this.invCategories.push(c)
      this.log(p.company_id, 'inv_categories', c.id, 'insert', null, c, null)
      return c.id
    }
    const c = this.invCategories.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('category not found.')
    if (c.inventory_account_id !== p.inventory_account_id && this.invItems.some((i) => i.category_id === c.id && (!D(i.qty_on_hand).isZero() || !D(i.value_on_hand).isZero())))
      fail('the stock ledger of a category cannot be changed while its items hold stock.')
    const old = { ...c }
    Object.assign(c, { name: p.name.trim(), inventory_account_id: p.inventory_account_id, cogs_account_id: p.cogs_account_id, valuation_method: method, is_active: p.is_active ?? c.is_active })
    this.log(p.company_id, 'inv_categories', c.id, 'update', old, c, null)
    return c.id
  }

  async listWarehouses(companyIds: ID[]) { return this.warehouses.filter((w) => companyIds.includes(w.company_id)).sort((a, b) => a.code.localeCompare(b.code)) }
  async saveWarehouse(p: WarehouseInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.code) || blank(p.name)) fail('a code and a name are required.')
    this.needUnit(p.company_id, p.org_unit_id, 'the selected branch, site or office belongs to another company.')
    if (p.keeper_party_id) this.needParty(p.keeper_party_id, 'unknown party.')
    const code = p.code.trim().toUpperCase()
    if (!p.id) {
      if (this.warehouses.some((w) => w.company_id === p.company_id && w.code === code)) fail('a location with this code already exists.')
      const w: Warehouse = { id: uid(), company_id: p.company_id, code, name: p.name.trim(), kind: p.kind ?? 'warehouse', org_unit_id: p.org_unit_id ?? null, address: p.address ?? null, keeper_party_id: p.keeper_party_id ?? null, is_active: true }
      this.warehouses.push(w)
      this.log(p.company_id, 'warehouses', w.id, 'insert', null, w, null)
      return w.id
    }
    const w = this.warehouses.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('location not found.')
    if (p.is_active === false && this.stockRows([p.company_id]).some((r) => r.warehouse_id === w.id && (!D(r.qty).isZero() || !D(r.pending_in).isZero() || !D(r.pending_out).isZero())))
      fail('this location still holds stock. Transfer or adjust it before closing the location.')
    const old = { ...w }
    Object.assign(w, { code, name: p.name.trim(), kind: p.kind ?? w.kind, org_unit_id: p.org_unit_id ?? null, address: p.address ?? null, keeper_party_id: p.keeper_party_id ?? null, is_active: p.is_active ?? w.is_active })
    this.log(p.company_id, 'warehouses', w.id, 'update', old, w, null)
    return w.id
  }

  async listInvItems(companyIds: ID[]) { return this.invItems.filter((i) => companyIds.includes(i.company_id)).sort((a, b) => a.sku.localeCompare(b.sku)) }
  async saveInvItem(p: InvItemInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.sku) || blank(p.name)) fail('an item needs a code (SKU) and a name.')
    const c = this.invCategories.find((x) => x.id === p.category_id && x.company_id === p.company_id) ?? fail('choose a category of this company.')
    const method = p.valuation_method ?? c.valuation_method
    const tracking = p.tracking ?? 'none'
    if (!['weighted_average', 'fifo'].includes(method)) fail('the valuation method must be weighted average or first in, first out.')
    if (!['none', 'lot', 'serial'].includes(tracking)) fail('tracking must be none, by lot or by serial number.')
    if (p.tax_code_id && !this.taxCodes.some((t) => t.id === p.tax_code_id && t.company_id === p.company_id)) fail('the tax code belongs to another company.')
    const sku = p.sku.trim().toUpperCase()
    const fields = {
      sku, name: p.name.trim(), category_id: c.id, description: p.description ?? null, unit: blank(p.unit) ? 'unit' : String(p.unit).trim(), tracking, valuation_method: method,
      tax_code_id: p.tax_code_id ?? null, hsn_code: p.hsn_code ?? null, reorder_level: p.reorder_level ?? null, reorder_qty: p.reorder_qty ?? null,
      shelf_life_days: p.shelf_life_days ?? null, slow_after_days: p.slow_after_days ?? null, manufacturer: p.manufacturer ?? null, model: p.model ?? null,
      sale_price: p.sale_price ?? null, unit_weight: p.unit_weight ?? null, attrs: p.attrs ?? {},
    }
    if (!p.id) {
      if (this.invItems.some((i) => i.company_id === p.company_id && i.sku === sku)) fail('an item with this code already exists.')
      const it: InvItem = { id: uid(), company_id: p.company_id, ...fields, qty_on_hand: '0', value_on_hand: '0', qty_reserved: '0', value_reserved: '0', status: 'active', created_at: this.now() }
      this.invItems.push(it)
      this.log(p.company_id, 'inv_items', it.id, 'insert', null, it, null)
      return it.id
    }
    const it = this.invItems.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('item not found.')
    const ledgerChanges = it.category_id !== c.id && this.invCategory(it.category_id).inventory_account_id !== c.inventory_account_id
    if ((it.valuation_method !== method || it.tracking !== tracking || ledgerChanges)
      && (!D(it.qty_on_hand).isZero() || !D(it.value_on_hand).isZero() || this.invMovements.some((m) => m.item_id === it.id && m.status === 'proposed')))
      fail('the valuation method, the tracking and the stock ledger of an item cannot change while it holds stock. Bring the stock to zero first.')
    if ((p.status ?? it.status) === 'inactive' && !D(it.qty_on_hand).isZero()) fail('an item that holds stock cannot be made inactive.')
    const old = { ...it }
    Object.assign(it, fields, { status: p.status ?? it.status })
    this.log(p.company_id, 'inv_items', it.id, 'update', old, it, p.reason ?? null)
    return it.id
  }

  async listInvLots(f: { companyIds: ID[]; itemId?: ID }) {
    return this.invLots.filter((l) => f.companyIds.includes(l.company_id) && (!f.itemId || l.item_id === f.itemId)).sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'))
  }
  async saveInvLot(p: InvLotInput): Promise<ID> {
    const l = this.invLots.find((x) => x.id === p.id) ?? fail('lot not found.')
    if (p.sold_to_party_id) this.needParty(p.sold_to_party_id, 'unknown party.')
    if (p.service_item_id && !this.registerItems.some((r) => r.id === p.service_item_id && r.company_id === l.company_id)) fail('the service contract belongs to another company.')
    const old = { ...l }
    for (const k of ['mfg_date', 'expiry_date', 'import_details', 'sold_to_party_id', 'sold_on', 'installed_on', 'customer_location', 'warranty_until', 'service_item_id', 'note'] as const)
      if (Object.prototype.hasOwnProperty.call(p, k)) (l as unknown as Record<string, unknown>)[k] = k === 'import_details' ? (p[k] ?? {}) : (p[k] ?? null)
    this.log(l.company_id, 'inv_lots', l.id, 'update', old, l, null)
    return l.id
  }
  async listUnitEvents(lotId: ID) { return this.unitEvents.filter((e) => e.lot_id === lotId).sort((a, b) => b.event_date.localeCompare(a.event_date) || b.created_at.localeCompare(a.created_at)) }
  async recordUnitEvent(p: UnitEventInput): Promise<ID> {
    const l = this.invLots.find((x) => x.id === p.lot_id) ?? fail('unit not found.')
    if (!['installation', 'engineer_visit', 'spare_part', 'warranty_claim', 'service_contract', 'relocation', 'note'].includes(p.event_type)) fail('unknown event.')
    if (blank(p.event_date)) fail('the date is required.')
    if (p.party_id) this.needParty(p.party_id, 'unknown party.')
    const e: UnitEvent = { id: uid(), company_id: l.company_id, lot_id: l.id, event_type: p.event_type, event_date: p.event_date, party_id: p.party_id ?? null, engineer_name: p.engineer_name ?? null, cost: p.cost ?? null, chargeable: p.chargeable ?? null, invoice_id: p.invoice_id ?? null, detail: p.detail ?? {}, created_by: this.actor, created_at: this.now() }
    this.unitEvents.push(e)
    const d = e.detail as { location?: string; warranty_until?: string }
    if (p.event_type === 'installation') Object.assign(l, { installed_on: p.event_date, customer_location: d.location ?? l.customer_location, warranty_until: d.warranty_until ?? l.warranty_until })
    if (p.event_type === 'relocation') l.customer_location = d.location ?? l.customer_location
    return e.id
  }

  // ------------------------------------------------------------ the stock ledger
  protected stockRows(companyIds: ID[]): StockRow[] {
    const m = new Map<string, { r: StockRow; q: Decimal; po: Decimal; pi: Decimal }>()
    for (const x of this.invMovements) {
      if (!companyIds.includes(x.company_id) || (x.status !== 'posted' && x.status !== 'proposed')) continue
      const k = [x.item_id, x.warehouse_id, x.lot_id ?? ''].join('|')
      const cur = m.get(k) ?? { r: { company_id: x.company_id, item_id: x.item_id, warehouse_id: x.warehouse_id, lot_id: x.lot_id, qty: '0', pending_out: '0', pending_in: '0', last_in: null, last_out: null }, q: ZERO, po: ZERO, pi: ZERO }
      const qty = D(x.qty)
      if (x.status === 'posted') {
        cur.q = cur.q.plus(qty)
        if (qty.gt(0) && x.kind !== 'transfer_in' && (!cur.r.last_in || x.move_date > cur.r.last_in)) cur.r.last_in = x.move_date
        if (qty.lt(0) && x.kind !== 'transfer_out' && (!cur.r.last_out || x.move_date > cur.r.last_out)) cur.r.last_out = x.move_date
      } else if (qty.lt(0)) cur.po = cur.po.minus(qty)
      else cur.pi = cur.pi.plus(qty)
      m.set(k, cur)
    }
    // goods moved from another place of the company came in when the company received them, not when they were moved
    const came = new Map<string, string>()
    for (const x of this.invMovements) {
      if (!companyIds.includes(x.company_id) || x.status !== 'posted' || x.kind === 'transfer_in' || !D(x.qty).gt(0)) continue
      const k = [x.item_id, x.lot_id ?? ''].join('|')
      if (!came.has(k) || x.move_date > came.get(k)!) came.set(k, x.move_date)
    }
    return [...m.values()].filter((v) => !v.q.isZero() || !v.po.isZero() || !v.pi.isZero())
      .map((v) => ({ ...v.r, last_in: v.r.last_in ?? came.get([v.r.item_id, v.r.lot_id ?? ''].join('|')) ?? null, qty: v.q.toString(), pending_out: v.po.toString(), pending_in: v.pi.toString() }))
  }
  /** quantity in one place, counting what is posted and what is awaiting approval to leave */
  protected stockAvailable(itemId: ID, warehouseId: ID, lotId: ID | null): Decimal {
    let s = ZERO
    for (const m of this.invMovements) {
      if (m.item_id !== itemId || m.warehouse_id !== warehouseId || (m.lot_id ?? null) !== (lotId ?? null)) continue
      if (m.status === 'posted' || (m.status === 'proposed' && D(m.qty).lt(0))) s = s.plus(m.qty)
    }
    return s
  }
  async stockOnHand(companyIds: ID[]) { return this.stockRows(companyIds) }
  async listInvMovements(f: { companyIds: ID[]; itemId?: ID; lotId?: ID; docId?: ID; limit?: number }) {
    return this.invMovements.filter((m) => f.companyIds.includes(m.company_id) && (!f.itemId || m.item_id === f.itemId) && (!f.lotId || m.lot_id === f.lotId) && (!f.docId || m.doc_id === f.docId))
      .sort((a, b) => b.move_date.localeCompare(a.move_date) || b.created_at.localeCompare(a.created_at)).slice(0, f.limit ?? 2000)
  }

  // ------------------------------------------------------------ stock documents
  protected stockDoc(id: ID) { return this.stockDocs.find((d) => d.id === id) ?? fail('document not found.') }
  protected docLines(docId: ID) { return this.stockDocLines.filter((l) => l.doc_id === docId).sort((a, b) => a.line_no - b.line_no) }
  protected assertNotCounting(warehouseId: ID, countId: ID | null) {
    const c = this.stockCounts.find((x) => x.warehouse_id === warehouseId && x.frozen && ['open', 'counted', 'reviewed', 'proposed'].includes(x.status) && x.id !== countId)
    if (c) fail(`stock count ${c.count_no} is open for this location, so its stock is frozen. Complete or cancel the count first.`)
  }
  async listStockDocs(f: { companyIds: ID[]; kinds?: StockDocKind[]; purchaseDocId?: ID }) {
    return this.stockDocs.filter((d) => f.companyIds.includes(d.company_id) && (!f.kinds?.length || f.kinds.includes(d.kind)) && (!f.purchaseDocId || d.purchase_doc_id === f.purchaseDocId))
      .sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.doc_no.localeCompare(a.doc_no))
  }
  async getStockDoc(id: ID) { const d = this.stockDoc(id); return { ...d, lines: this.docLines(id) } }

  async saveStockDoc(p: StockDocInput): Promise<ID> {
    this.company(p.company_id)
    const kind = p.kind
    if (!(kind in PREFIX)) fail('unknown stock document.')
    if (blank(p.doc_date)) fail('the date is required.')
    if (p.doc_date > today()) fail('a stock document is dated today or earlier: goods have not moved on a day that has not come.')
    const rc = kind === 'landed_cost' ? this.stockDocs.find((d) => d.id === p.receipt_doc_id) : undefined
    if (kind === 'landed_cost') {
      if (!rc || rc.company_id !== p.company_id || rc.kind !== 'receipt' || rc.status !== 'posted') fail('landed cost is added to a stock receipt that has been posted.')
      if (!['value', 'quantity', 'weight'].includes(p.meta?.method ?? 'value')) fail('landed cost is shared by value, by quantity or by weight.')
      if (!p.meta?.charges?.length) fail('list the charges that make up the landed cost.')
      for (const k of p.meta!.charges!) {
        if (blank(k.name) || D(k.amount).lte(0)) fail('each charge needs a name and an amount greater than zero.')
        if (k.account_id) this.invAccount(p.company_id, k.account_id, `the charge "${k.name}"`)
        if (k.party_id) this.needParty(k.party_id, `unknown party on the charge "${k.name}".`)
      }
    }
    const wh = this.warehouses.find((w) => w.id === (p.warehouse_id ?? rc?.warehouse_id))
    if (!wh || wh.company_id !== p.company_id || !wh.is_active) fail('choose an active location of this company.')
    if (kind === 'transfer' && (!this.warehouses.some((w) => w.id === p.to_warehouse_id && w.company_id === p.company_id && w.is_active) || p.to_warehouse_id === wh!.id))
      fail('a transfer needs another active location of the same company to receive the stock.')
    if (p.party_id) this.needParty(p.party_id, 'unknown party.')
    if (p.counter_account_id) this.invAccount(p.company_id, p.counter_account_id, 'the other side of the entry')
    this.needDims(p.company_id, p.dims, 'the selected dimension belongs to another company.')
    const gr = p.purchase_doc_id ? this.purchaseDocs.find((d) => d.id === p.purchase_doc_id) : undefined
    if (p.purchase_doc_id) {
      if (!['receipt', 'return_out'].includes(kind)) fail('only a stock receipt or a return to the vendor refers to a goods receipt.')
      if (!gr || gr.company_id !== p.company_id || gr.kind !== 'goods_receipt' || gr.status !== 'confirmed') fail('stock is received against a goods receipt that has been confirmed.')
    }
    if (p.invoice_id && !this.invoices.some((i) => i.id === p.invoice_id && i.company_id === p.company_id)) fail('the invoice belongs to another company.')
    if (kind === 'adjustment' && blank(p.reason)) fail('an adjustment of stock needs its reason.')

    let d: StockDoc
    if (p.id) {
      d = this.stockDoc(p.id)
      if (d.company_id !== p.company_id || d.kind !== kind) fail('document not found.')
      if (!['draft', 'rejected'].includes(d.status)) fail(`only a draft can be edited. This document is ${d.status}.`)
      if (d.count_id) fail('this adjustment belongs to a stock count and is changed through the count.')
    } else {
      d = {
        id: uid(), company_id: p.company_id, kind, doc_no: this.docNo(p.company_id, 'stock_' + kind, PREFIX[kind], p.doc_date), doc_date: p.doc_date, warehouse_id: wh!.id, to_warehouse_id: null,
        party_id: null, purchase_doc_id: null, invoice_id: null, receipt_doc_id: null, count_id: null, counter_account_id: null, reason: null, dims: {}, meta: {}, status: 'draft', total_value: '0', journal_id: null,
        created_by: this.actor, created_at: this.now(),
      }
    }
    // build the lines first: a refused document leaves nothing behind
    const lines: StockDocLine[] = []
    const newLots: InvLot[] = []
    let total = ZERO
    if (kind === 'landed_cost') {
      const given = new Map((p.lines ?? []).filter((x) => x.receipt_line_id).map((x) => [x.receipt_line_id!, x]))
      this.docLines(rc!.id).forEach((rl, i) => {
        const it = this.invItem(rl.item_id)
        const w = given.get(rl.id)?.weight ?? rl.weight ?? (it.unit_weight !== null ? D(it.unit_weight).times(rl.qty).toString() : null)
        lines.push({ id: uid(), doc_id: d.id, company_id: p.company_id, line_no: i + 1, item_id: rl.item_id, lot_id: rl.lot_id, qty: rl.qty, unit_cost: '0', value: '0', expensed: '0', weight: w, reason_code: null, source_line_id: null, receipt_line_id: rl.id, hold_id: null, note: null })
      })
      total = p.meta!.charges!.reduce((s, k) => s.plus(k.amount), ZERO)
    } else {
      (p.lines ?? []).forEach((l, i) => {
        const no = i + 1
        const it = this.invItems.find((x) => x.id === l.item_id)
        if (!it || it.company_id !== p.company_id) fail(`line ${no} — item not found.`)
        if (it!.status !== 'active') fail(`line ${no} — item ${it!.sku} is inactive.`)
        const qty = D(l.qty ?? 0)
        if (qty.isZero() || (kind !== 'adjustment' && qty.lt(0))) fail(`line ${no} — the quantity must be greater than zero.`)
        const inbound = kind === 'receipt' || kind === 'return_in' || (kind === 'adjustment' && qty.gt(0))
        if (kind === 'adjustment' && (!l.reason_code || !REASONS.includes(l.reason_code)))
          fail(`line ${no} — state what happened to the stock: damage, expiry, theft, breakage, obsolescence, shrinkage, a difference on counting, or stock found.`)
        let lotId: ID | null = null
        if (it!.tracking === 'none') {
          if (l.lot_id || !blank(l.lot_no)) fail(`line ${no} — item ${it!.sku} is not tracked by lot or serial number.`)
        } else {
          const what = it!.tracking === 'serial' ? 'serial' : 'lot'
          if (l.lot_id) {
            const lot = this.invLots.find((x) => x.id === l.lot_id && x.item_id === it!.id) ?? fail(`line ${no} — that lot does not belong to item ${it!.sku}.`)
            lotId = lot.id
          } else if (!blank(l.lot_no)) {
            const lotNo = l.lot_no!.trim()
            const lot = this.invLots.find((x) => x.item_id === it!.id && x.lot_no === lotNo) ?? newLots.find((x) => x.item_id === it!.id && x.lot_no === lotNo)
            if (lot) lotId = lot.id
            else if (inbound) {
              const nl: InvLot = {
                id: uid(), company_id: p.company_id, item_id: it!.id, lot_no: lotNo, is_serial: it!.tracking === 'serial', mfg_date: l.mfg_date ?? null,
                expiry_date: l.expiry_date ?? (it!.shelf_life_days ? addDays(l.mfg_date ?? p.doc_date, it!.shelf_life_days) : null), supplier_party_id: p.party_id ?? gr?.party_id ?? null,
                import_details: l.import_details ?? {}, landed_cost: null, sold_to_party_id: null, sale_invoice_id: null, sold_on: null, installed_on: null, customer_location: null, warranty_until: null, service_item_id: null, note: null, created_at: this.now(),
              }
              newLots.push(nl); lotId = nl.id
            } else fail(`line ${no} — no lot "${lotNo}" of item ${it!.sku} is on record.`)
          } else fail(`line ${no} — item ${it!.sku} is tracked by ${it!.tracking === 'serial' ? 'serial number' : 'lot'}: state the ${what} number.`)
          if (it!.tracking === 'serial') {
            if (!qty.abs().eq(1)) fail(`line ${no} — a serial number is one unit.`)
            const held = this.invMovements.filter((m) => m.lot_id === lotId && (m.status === 'proposed' || m.status === 'posted')).reduce((s, m) => s.plus(m.qty), ZERO)
            if (inbound && held.gt(0)) fail(`line ${no} — serial number ${l.lot_no ?? ''} is already in stock.`)
          }
        }
        let cost = D(l.unit_cost ?? 0)
        let src: { id: ID; rate: Num; quantity: Num } | undefined
        if (l.source_line_id) {
          if (!gr) fail(`line ${no} refers to a goods receipt, but the document names none.`)
          src = this.purchaseLines.find((x) => x.id === l.source_line_id && x.doc_id === gr!.id) ?? fail(`line ${no} does not belong to goods receipt ${gr!.doc_no}.`)
          if (kind === 'receipt') {
            const done = this.stockDocLines.filter((sl) => sl.source_line_id === src!.id && sl.doc_id !== d.id).reduce((s, sl) => {
              const sd = this.stockDocs.find((x) => x.id === sl.doc_id)
              return sd && sd.kind === 'receipt' && ['draft', 'proposed', 'posted'].includes(sd.status) ? s.plus(sl.qty) : s
            }, ZERO).plus(lines.filter((x) => x.source_line_id === src!.id).reduce((s, x) => s.plus(x.qty), ZERO))
            if (done.plus(qty).gt(src!.quantity)) fail(`line ${no} — taking ${qty} into stock would exceed the ${src!.quantity} received on ${gr!.doc_no} (already taken into stock: ${done}).`)
            if (l.unit_cost === undefined || l.unit_cost === null) cost = q6(D(src!.rate).times(gr!.fx_rate ?? 1))
          }
        }
        if (cost.lt(0)) fail(`line ${no} — the cost cannot be negative.`)
        if ((kind === 'receipt' || kind === 'return_in') && (l.unit_cost === undefined || l.unit_cost === null) && !src) fail(`line ${no} — state the cost of one ${it!.unit}.`)
        if (l.hold_id) {
          const h = this.invHolds.find((x) => x.id === l.hold_id)
          if (!h || h.status !== 'open' || h.item_id !== it!.id || h.warehouse_id !== wh!.id || (h.lot_id ?? null) !== lotId)
            fail(`line ${no} — the condition noted does not match this item, lot and location, or is no longer open.`)
        }
        const value = inbound ? round2(qty.times(cost)) : ZERO
        lines.push({
          id: uid(), doc_id: d.id, company_id: p.company_id, line_no: no, item_id: it!.id, lot_id: lotId, qty: qty.toString(), unit_cost: cost.toString(), value: value.toString(), expensed: '0',
          weight: l.weight ?? (it!.unit_weight !== null ? D(it!.unit_weight).times(qty.abs()).toString() : null), reason_code: l.reason_code ?? null, source_line_id: src?.id ?? null, receipt_line_id: null, hold_id: l.hold_id ?? null, note: l.note ?? null,
        })
        if (inbound) total = total.plus(value)
      })
    }
    if (!lines.length) fail('the document needs at least one line.')

    Object.assign(d, {
      status: 'draft', doc_date: p.doc_date, warehouse_id: wh!.id, to_warehouse_id: p.to_warehouse_id ?? null, party_id: p.party_id ?? gr?.party_id ?? null, purchase_doc_id: p.purchase_doc_id ?? null,
      invoice_id: p.invoice_id ?? null, receipt_doc_id: rc?.id ?? null, counter_account_id: p.counter_account_id ?? null, reason: p.reason ?? null, dims: p.dims ?? {}, meta: p.meta ?? {}, journal_id: null, total_value: total.toString(),
    })
    if (!p.id) this.stockDocs.push(d)
    else {
      // rejected movements keep their rows and let go of the lines
      this.invMovements.forEach((m) => { if (m.doc_id === d.id && m.status === 'rejected') m.doc_line_id = null })
      this.stockDocLines = this.stockDocLines.filter((l) => l.doc_id !== d.id)
    }
    this.invLots.push(...newLots)
    this.stockDocLines.push(...lines)
    this.log(p.company_id, 'stock_docs', d.id, 'draft_saved', null, { kind, lines: lines.length }, null)
    return d.id
  }

  /** Takes a quantity out of the receipts it came from (oldest first) and returns its cost. */
  protected takeStock(it: InvItem, lotId: ID | null, qty: Decimal, movementId: ID): Decimal {
    const free = D(it.qty_on_hand).minus(it.qty_reserved)
    if (qty.gt(free)) fail(`only ${free} ${it.unit} of ${it.sku} are free in stock (${it.qty_on_hand} in stock, ${it.qty_reserved} awaiting approval on other documents).`)
    const layers = this.invMovements.filter((m) => m.item_id === it.id && m.is_layer && m.status === 'posted' && D(m.remaining_qty).gt(0) && (m.lot_id ?? null) === (lotId ?? null))
      .sort((a, b) => a.move_date.localeCompare(b.move_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    let left = qty; let fifo = ZERO
    const uses: LayerUse[] = []; const changes: [InvMovement, Decimal, Decimal][] = []
    for (const ly of layers) {
      if (left.isZero()) break
      const take = Decimal.min(ly.remaining_qty, left)
      const val = take.eq(ly.remaining_qty) ? D(ly.remaining_value) : round2(D(ly.remaining_value).times(take).div(ly.remaining_qty))
      changes.push([ly, take, val])
      uses.push({ id: uid(), movement_id: movementId, layer_id: ly.id, qty: take.toString(), value: val.toString(), released: false })
      fifo = fifo.plus(val); left = left.minus(take)
    }
    if (left.gt(0)) fail(`the receipts on record for ${it.sku} do not cover ${qty} ${it.unit}. ${left} remain unaccounted for.`)
    for (const [ly, take, val] of changes) { ly.remaining_qty = D(ly.remaining_qty).minus(take).toString(); ly.remaining_value = D(ly.remaining_value).minus(val).toString() }
    this.layerUse.push(...uses)
    const cost = it.valuation_method === 'fifo' ? fifo
      : qty.eq(free) ? D(it.value_on_hand).minus(it.value_reserved)      // the last of the stock takes the last of the value
        : round2(qty.times(D(it.value_on_hand).minus(it.value_reserved)).div(free))
    it.qty_reserved = D(it.qty_reserved).plus(qty).toString()
    it.value_reserved = D(it.value_reserved).plus(cost).toString()
    return cost
  }
  protected giveBackStock(movementId: ID) {
    for (const u of this.layerUse) {
      if (u.movement_id !== movementId || u.released) continue
      const ly = this.invMovements.find((m) => m.id === u.layer_id)!
      ly.remaining_qty = D(ly.remaining_qty).plus(u.qty).toString(); ly.remaining_value = D(ly.remaining_value).plus(u.value).toString()
      u.released = true
    }
  }

  async proposeStockDoc(id: ID): Promise<ID | null> {
    const d = this.stockDoc(id)
    if (!['draft', 'rejected'].includes(d.status)) fail(`this document is ${d.status}.`)
    this.assertNotCounting(d.warehouse_id, d.count_id)
    if (d.to_warehouse_id) this.assertNotCounting(d.to_warehouse_id, d.count_id)
    this.assertPeriodOpen(d.company_id, d.doc_date)
    // everything below is undone if the proposal is refused: the database does this inside one transaction
    const snap = this.inventorySnapshot()
    try {
      return this.proposeStockDocInner(d)
    } catch (e) {
      this.inventoryRestore(snap)
      throw e
    }
  }
  protected inventorySnapshot() {
    return {
      items: this.invItems.map((i) => ({ ...i })), moves: this.invMovements.map((m) => ({ ...m })), uses: this.layerUse.map((u) => ({ ...u })),
      lines: this.stockDocLines.map((l) => ({ ...l })), docs: this.stockDocs.map((x) => ({ ...x })), counts: this.stockCounts.map((c) => ({ ...c })), holds: this.invHolds.map((h) => ({ ...h })), lots: this.invLots.map((l) => ({ ...l })),
    }
  }
  protected inventoryRestore(s: ReturnType<DemoInventory['inventorySnapshot']>) {
    // objects are restored in place so that references held elsewhere stay valid
    const put = <T extends { id: ID }>(live: T[], saved: T[]) => {
      const byId = new Map(saved.map((x) => [x.id, x]))
      for (let i = live.length - 1; i >= 0; i--) { const o = byId.get(live[i].id); if (o) Object.assign(live[i], o); else live.splice(i, 1) }
    }
    put(this.invItems, s.items); put(this.invMovements, s.moves); put(this.layerUse, s.uses); put(this.stockDocLines, s.lines); put(this.stockDocs, s.docs); put(this.stockCounts, s.counts); put(this.invHolds, s.holds); put(this.invLots, s.lots)
  }

  protected proposeStockDocInner(d: StockDoc): ID | null {
    const acc = new Map<string, Decimal>()
    const add = (accountId: ID, side: 'debit' | 'credit', v: Decimal) => { if (!v.isZero()) acc.set(accountId + ':' + side, (acc.get(accountId + ':' + side) ?? ZERO).plus(v)) }
    const move = (m: Partial<InvMovement> & Pick<InvMovement, 'item_id' | 'warehouse_id' | 'kind' | 'qty' | 'value'>): InvMovement => {
      const row: InvMovement = { id: uid(), company_id: d.company_id, lot_id: null, doc_id: d.id, doc_line_id: null, move_date: d.doc_date, unit_cost: '0', is_layer: false, remaining_qty: '0', remaining_value: '0', status: 'proposed', created_at: this.now(), ...m }
      this.invMovements.push(row)
      return row
    }
    let total = ZERO
    let lines: JournalLineInput[] = []
    let what: string
    const name = (id: ID) => this.account(id)?.name ?? ''

    if (d.kind === 'landed_cost') {
      const rc = this.stockDoc(d.receipt_doc_id!)
      if (rc.status !== 'posted') fail('the stock receipt is no longer posted.')
      const method = d.meta.method ?? 'value'
      const charges = round2((d.meta.charges ?? []).reduce((s, k) => s.plus(k.amount), ZERO))
      const dl = this.docLines(d.id)
      const basis = (l: StockDocLine) => (method === 'quantity' ? D(l.qty) : method === 'weight' ? D(l.weight ?? 0) : D(this.stockDocLines.find((x) => x.id === l.receipt_line_id)?.value ?? 0))
      if (method === 'weight' && dl.some((l) => D(l.weight ?? 0).lte(0))) fail('to share the cost by weight, every line needs its weight.')
      const sumBasis = dl.reduce((s, l) => s.plus(basis(l)), ZERO)
      if (sumBasis.lte(0)) fail('the receipt carries nothing to share the cost over.')
      let left = charges
      dl.forEach((l, i) => {
        const it = this.invItem(l.item_id); const c = this.invCategory(it.category_id)
        const alloc = i === dl.length - 1 ? left : round2(charges.times(basis(l)).div(sumBasis))
        left = left.minus(alloc)
        const ly = this.invMovements.find((m) => m.doc_line_id === l.receipt_line_id && m.is_layer && m.status === 'posted') ?? fail(`line ${l.line_no} of the receipt is not in the stock ledger.`)
        // the part of the receipt still in stock carries its share in stock; the part that has left is a cost now
        const stock = D(ly.qty).isZero() ? ZERO : round2(alloc.times(ly.remaining_qty).div(ly.qty))
        Object.assign(l, { unit_cost: q6(alloc.div(l.qty)).toString(), value: stock.toString(), expensed: alloc.minus(stock).toString() })
        if (!stock.isZero()) move({ item_id: it.id, warehouse_id: ly.warehouse_id, lot_id: l.lot_id, doc_line_id: l.id, kind: 'landed_cost', qty: '0', value: stock.toString(), unit_cost: l.unit_cost })
        add(c.inventory_account_id, 'debit', stock)
        add(c.cogs_account_id, 'debit', alloc.minus(stock))
      })
      lines = [...acc.entries()].map(([k, v]) => ({ account_id: k.split(':')[0], debit: v.toString(), description: `Landed cost on ${rc.doc_no} — ${name(k.split(':')[0])}` }))
      for (const k of d.meta.charges ?? []) lines.push({ account_id: k.account_id ?? this.mapAccount(d.company_id, 'landed_cost_clearing'), credit: round2(k.amount).toString(), party_id: k.party_id ?? undefined, description: `${k.name} — ${rc.doc_no}` })
      total = charges
      what = `Landed cost ${d.doc_no} on receipt ${rc.doc_no}, shared by ${method}`
    } else {
      for (const l of this.docLines(d.id)) {
        const it = this.invItem(l.item_id); const c = this.invCategory(it.category_id)
        const qty = D(l.qty); const q = qty.abs()
        const inbound = d.kind === 'receipt' || d.kind === 'return_in' || (d.kind === 'adjustment' && qty.gt(0))
        let cost: Decimal
        if (inbound) {
          let unit = D(l.unit_cost)
          if (d.kind === 'adjustment' && unit.isZero() && D(it.qty_on_hand).gt(0)) unit = q6(D(it.value_on_hand).div(it.qty_on_hand))   // stock found is valued as the stock beside it
          cost = round2(q.times(unit))
          move({ item_id: it.id, warehouse_id: d.warehouse_id, lot_id: l.lot_id, doc_line_id: l.id, kind: d.kind, qty: q.toString(), value: cost.toString(), unit_cost: unit.toString(), is_layer: true })
          Object.assign(l, { unit_cost: unit.toString(), value: cost.toString() })
          const counter = d.kind === 'receipt' ? d.counter_account_id ?? this.mapAccount(d.company_id, 'grni') : d.kind === 'return_in' ? d.counter_account_id ?? c.cogs_account_id : this.mapAccount(d.company_id, 'stock_gain')
          add(c.inventory_account_id, 'debit', cost); add(counter, 'credit', cost)
        } else {
          const have = this.stockAvailable(it.id, d.warehouse_id, l.lot_id)
          if (q.gt(have)) fail(`line ${l.line_no} — ${q} ${it.unit} of ${it.sku} are asked for, and ${have} are in this location${l.lot_id ? ' in this lot' : ''}.`)
          if (d.kind === 'transfer') {
            // the goods change place, not value: nothing is proposed, and the receipts they came from are untouched
            cost = D(it.qty_on_hand).isZero() ? ZERO : round2(q.times(it.value_on_hand).div(it.qty_on_hand))
            const unit = q.isZero() ? ZERO : q6(cost.div(q))
            move({ item_id: it.id, warehouse_id: d.warehouse_id, lot_id: l.lot_id, doc_line_id: l.id, kind: 'transfer_out', qty: q.neg().toString(), value: cost.neg().toString(), unit_cost: unit.toString(), status: 'posted' })
            move({ item_id: it.id, warehouse_id: d.to_warehouse_id!, lot_id: l.lot_id, doc_line_id: l.id, kind: 'transfer_in', qty: q.toString(), value: cost.toString(), unit_cost: unit.toString(), status: 'posted' })
            Object.assign(l, { unit_cost: unit.toString(), value: cost.toString() })
          } else {
            const mv = move({ item_id: it.id, warehouse_id: d.warehouse_id, lot_id: l.lot_id, doc_line_id: l.id, kind: d.kind, qty: q.neg().toString(), value: '0' })
            cost = this.takeStock(it, l.lot_id, q, mv.id)
            Object.assign(mv, { value: cost.neg().toString(), unit_cost: q6(cost.div(q)).toString() })
            Object.assign(l, { unit_cost: q6(cost.div(q)).toString(), value: cost.toString() })
            const counter = d.kind === 'issue' ? d.counter_account_id ?? c.cogs_account_id : d.kind === 'return_out' ? d.counter_account_id ?? this.mapAccount(d.company_id, 'grni') : this.mapAccount(d.company_id, 'stock_loss')
            add(counter, 'debit', cost); add(c.inventory_account_id, 'credit', cost)
          }
        }
        total = total.plus(cost)
      }
      const label = d.kind.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
      lines = [...acc.entries()].sort((a, b) => b[0].split(':')[1].localeCompare(a[0].split(':')[1]) || a[0].localeCompare(b[0])).map(([k, v]) => {
        const [accountId, side] = k.split(':'); const a = this.account(accountId)
        return {
          account_id: accountId, [side]: v.toString(), party_id: ['payable', 'receivable'].includes(a?.control_type ?? '') ? d.party_id ?? undefined : undefined,
          dims: a?.type === 'expense' || a?.type === 'income' ? d.dims : {}, description: `${label} ${d.doc_no} — ${a?.name ?? ''}`,
        } as JournalLineInput
      })
      what = ({ receipt: 'Stock received', issue: 'Stock issued', return_in: 'Stock returned by customer', return_out: 'Stock returned to vendor', transfer: 'Stock transferred', adjustment: 'Stock adjusted' } as Record<string, string>)[d.kind]
        + ' ' + d.doc_no + (blank(d.reason) ? '' : ' — ' + d.reason!.trim())
    }

    d.total_value = total.toString()
    if (d.kind === 'transfer') {
      d.status = 'posted'
      this.log(d.company_id, 'stock_docs', d.id, 'transferred', null, { doc_no: d.doc_no, value: total.toString(), rule: 'A transfer inside one company changes the place of stock, not its value. No accounting entry.' }, null)
      return null
    }
    if (!lines.length) {
      // nothing of value moves (goods received at no cost): there is no accounting entry to approve
      this.applyStockDoc(d.id, 'posted', null)
      this.log(d.company_id, 'stock_docs', d.id, 'posted_without_value', null, { doc_no: d.doc_no, rule: 'The document carries no value. The quantities are recorded; no accounting entry exists.' }, null)
      return null
    }
    const j = this.proposePosting(d.company_id, 'journal', d.doc_date, what, 'stock_doc', d.id, lines, { kind: d.kind, doc_no: d.doc_no, amount: total.toString() }, 'internal')
    d.status = 'proposed'; d.journal_id = j
    const c = d.count_id ? this.stockCounts.find((x) => x.id === d.count_id) : undefined
    if (c) c.status = 'proposed'
    return j
  }

  /** Brings the stock ledger and the item balances in line with what happened to the accounting entry. */
  protected applyStockDoc(docId: ID, event: WfEvent, journalId: ID | null) {
    const d = this.stockDoc(docId)
    const count = d.count_id ? this.stockCounts.find((x) => x.id === d.count_id) : undefined
    const item = (id: ID) => this.invItem(id)
    const bump = (it: InvItem, k: 'qty_on_hand' | 'value_on_hand' | 'qty_reserved' | 'value_reserved', v: Decimal.Value) => { it[k] = D(it[k]).plus(v).toString() }
    const layerOf = (m: InvMovement) => {
      const l = this.stockDocLines.find((x) => x.id === m.doc_line_id)
      return { line: l, layer: this.invMovements.find((x) => x.doc_line_id === l?.receipt_line_id && x.is_layer) }
    }
    if (event === 'posted') {
      // checked first: a handler that refuses must leave nothing half done
      for (const m of this.invMovements) {
        if (m.doc_id !== d.id || m.status !== 'proposed' || !D(m.qty).isZero()) continue
        const { line, layer } = layerOf(m)
        if (!layer || layer.status !== 'posted' || D(layer.remaining_qty).isZero()) fail(`the goods of line ${line?.line_no} have left stock since this entry was proposed. Reject it and propose the landed cost again.`)
      }
      for (const m of this.invMovements.filter((x) => x.doc_id === d.id && x.status === 'proposed')) {
        const it = item(m.item_id); const qty = D(m.qty)
        if (qty.gt(0)) {
          bump(it, 'qty_on_hand', qty); bump(it, 'value_on_hand', m.value)
          Object.assign(m, { status: 'posted', remaining_qty: m.qty, remaining_value: m.value })
        } else if (qty.lt(0)) {
          bump(it, 'qty_on_hand', qty); bump(it, 'value_on_hand', m.value); bump(it, 'qty_reserved', qty); bump(it, 'value_reserved', m.value)
          m.status = 'posted'
        } else {
          const { line, layer } = layerOf(m)
          layer!.remaining_value = D(layer!.remaining_value).plus(m.value).toString()
          bump(it, 'value_on_hand', m.value)
          const lot = this.invLots.find((x) => x.id === line?.lot_id)
          if (lot) lot.landed_cost = D(lot.landed_cost ?? 0).plus(line!.value).plus(line!.expensed).toString()
          m.status = 'posted'
        }
      }
      for (const l of this.docLines(d.id)) {
        const h = l.hold_id ? this.invHolds.find((x) => x.id === l.hold_id && x.status === 'open') : undefined
        if (h) Object.assign(h, { status: 'written_off', resolved_doc_id: d.id, resolved_at: this.now() })
        const lot = l.lot_id ? this.invLots.find((x) => x.id === l.lot_id) : undefined
        if (d.kind === 'issue' && d.party_id && lot?.is_serial) Object.assign(lot, { sold_to_party_id: d.party_id, sale_invoice_id: d.invoice_id, sold_on: d.doc_date })
      }
      d.status = 'posted'; d.journal_id = journalId ?? d.journal_id
      if (count) count.status = 'posted'
    } else if (event === 'voided') {
      for (const m of this.invMovements.filter((x) => x.doc_id === d.id && x.status === 'proposed')) {
        if (D(m.qty).lt(0)) { this.giveBackStock(m.id); const it = item(m.item_id); bump(it, 'qty_reserved', m.qty); bump(it, 'value_reserved', m.value) }
        m.status = 'rejected'
      }
      d.status = 'rejected'
      if (count) count.status = 'reviewed'
    } else {
      if (d.kind === 'receipt' && this.stockDocs.some((x) => x.receipt_doc_id === d.id && x.kind === 'landed_cost' && ['proposed', 'posted'].includes(x.status)))
        fail('landed cost has been added to this receipt. Reverse the landed cost first.')
      const posted = this.invMovements.filter((x) => x.doc_id === d.id && x.status === 'posted')
      for (const m of posted) {
        const qty = D(m.qty)
        if (qty.gt(0) && !D(m.remaining_qty).eq(qty))
          fail(`${qty.minus(m.remaining_qty)} of the ${qty} units received on ${d.doc_no} have since left stock or are awaiting approval on another document. The receipt cannot be reversed; return or adjust the stock instead.`)
        if (qty.isZero()) {
          const { layer } = layerOf(m)
          if (!layer || D(layer.remaining_value).lt(m.value) || D(layer.remaining_qty).isZero()) fail('goods that carried this landed cost have since left stock. It cannot be reversed; record an adjustment instead.')
        }
      }
      for (const m of posted) {
        const it = item(m.item_id); const qty = D(m.qty)
        if (qty.gt(0)) {
          bump(it, 'qty_on_hand', qty.neg()); bump(it, 'value_on_hand', D(m.value).neg())
          Object.assign(m, { status: 'reversed', remaining_qty: '0', remaining_value: '0' })
        } else if (qty.lt(0)) {
          this.giveBackStock(m.id)
          bump(it, 'qty_on_hand', qty.neg()); bump(it, 'value_on_hand', D(m.value).neg())
          m.status = 'reversed'
        } else {
          const { line, layer } = layerOf(m)
          layer!.remaining_value = D(layer!.remaining_value).minus(m.value).toString()
          bump(it, 'value_on_hand', D(m.value).neg())
          const lot = this.invLots.find((x) => x.id === line?.lot_id)
          if (lot) { const v = D(lot.landed_cost ?? 0).minus(line!.value).minus(line!.expensed); lot.landed_cost = v.isZero() ? null : v.toString() }
          m.status = 'reversed'
        }
      }
      this.invHolds.forEach((h) => { if (h.resolved_doc_id === d.id && h.status === 'written_off') Object.assign(h, { status: 'open', resolved_doc_id: null, resolved_at: null }) })
      d.status = 'reversed'
      if (count) Object.assign(count, { status: 'reviewed', doc_id: null })
    }
  }

  async cancelStockDoc(id: ID, reason: string) {
    const d = this.stockDoc(id)
    if (!['draft', 'rejected'].includes(d.status)) fail(`a document that is ${d.status} cannot be cancelled. Reject its accounting entry, or reverse it.`)
    if (blank(reason)) fail('a reason is required.')
    d.status = 'cancelled'
    const c = d.count_id ? this.stockCounts.find((x) => x.id === d.count_id) : undefined
    if (c) Object.assign(c, { status: 'reviewed', doc_id: null })
    this.log(d.company_id, 'stock_docs', d.id, 'update', null, { status: 'cancelled' }, reason)
  }

  // ------------------------------------------------------------ physical stock count
  protected stockCount(id: ID) { return this.stockCounts.find((c) => c.id === id) ?? fail('stock count not found.') }
  protected countLines(id: ID) { return this.stockCountLines.filter((l) => l.count_id === id) }
  async listStockCounts(companyIds: ID[]) { return this.stockCounts.filter((c) => companyIds.includes(c.company_id)).sort((a, b) => b.count_date.localeCompare(a.count_date) || b.count_no.localeCompare(a.count_no)) }
  async getStockCount(id: ID) { const c = this.stockCount(id); return { ...c, lines: this.countLines(id) } }
  async createStockCount(p: { company_id: ID; warehouse_id: ID; count_date?: string; category_id?: ID; frozen?: boolean; note?: string }): Promise<ID> {
    const wh = this.warehouses.find((w) => w.id === p.warehouse_id)
    if (!wh || wh.company_id !== p.company_id || !wh.is_active) fail('choose an active location of this company.')
    if (this.stockCounts.some((c) => c.warehouse_id === wh!.id && ['open', 'counted', 'reviewed', 'proposed'].includes(c.status))) fail('a stock count is already open for this location.')
    const frozen = p.frozen ?? true
    if (frozen && this.invMovements.some((m) => m.warehouse_id === wh!.id && m.status === 'proposed')) fail('stock documents for this location are awaiting approval. Approve or reject them before the stock is frozen for counting.')
    if (p.category_id && !this.invCategories.some((c) => c.id === p.category_id && c.company_id === p.company_id)) fail('category not found.')
    const date = p.count_date ?? today()
    const c: StockCount = {
      id: uid(), company_id: p.company_id, warehouse_id: wh!.id, count_no: this.docNo(p.company_id, 'stock_count', 'SC', date), count_date: date, status: 'open', frozen, snapshot_at: this.now(),
      scope: p.category_id ? { category_id: p.category_id } : {}, counted_by: null, counted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, doc_id: null, note: p.note ?? null, created_by: this.actor, created_at: this.now(),
    }
    this.stockCounts.push(c)
    // the snapshot: what the books say is in this location now
    const book = new Map<string, Decimal>()
    for (const m of this.invMovements) if (m.warehouse_id === wh!.id && m.status === 'posted') book.set(m.item_id + '|' + (m.lot_id ?? ''), (book.get(m.item_id + '|' + (m.lot_id ?? '')) ?? ZERO).plus(m.qty))
    let n = 0
    for (const [k, qty] of book) {
      const [itemId, lotId] = k.split('|'); const it = this.invItem(itemId)
      if (qty.isZero() || (p.category_id && it.category_id !== p.category_id)) continue
      this.stockCountLines.push({ id: uid(), count_id: c.id, company_id: p.company_id, item_id: itemId, lot_id: lotId || null, book_qty: qty.toString(), unit_cost: (D(it.qty_on_hand).isZero() ? ZERO : q6(D(it.value_on_hand).div(it.qty_on_hand))).toString(), counted_qty: null, reason_code: null, note: null, added_in_count: false })
      n++
    }
    this.log(p.company_id, 'stock_counts', c.id, 'opened', null, { location: wh!.code, lines: n, frozen, rule: 'The count records what is found. It changes nothing in the books.' }, null)
    return c.id
  }
  async recordStockCount(countId: ID, lines: StockCountEntry[], complete = true): Promise<'open' | 'counted'> {
    const c = this.stockCount(countId)
    if (!['open', 'counted'].includes(c.status)) fail(`this count is ${c.status}. Quantities can no longer be changed.`)
    for (const l of lines) {
      const qty = l.counted_qty === null || l.counted_qty === undefined ? null : D(l.counted_qty)
      if (qty && qty.lt(0)) fail('a counted quantity cannot be negative.')
      if (l.id) {
        const row = this.stockCountLines.find((x) => x.id === l.id && x.count_id === c.id) ?? fail('a line does not belong to this count.')
        Object.assign(row, { counted_qty: qty?.toString() ?? null, reason_code: l.reason_code ?? null, note: l.note ?? null })
        continue
      }
      const it = this.invItems.find((x) => x.id === l.item_id)
      if (!it || it.company_id !== c.company_id) fail('item not found.')
      let lotId = l.lot_id ?? null
      if (!lotId && !blank(l.lot_no)) {
        let lot = this.invLots.find((x) => x.item_id === it!.id && x.lot_no === l.lot_no!.trim())
        if (!lot) {
          lot = { id: uid(), company_id: c.company_id, item_id: it!.id, lot_no: l.lot_no!.trim(), is_serial: it!.tracking === 'serial', mfg_date: null, expiry_date: l.expiry_date ?? null, supplier_party_id: null, import_details: {}, landed_cost: null, sold_to_party_id: null, sale_invoice_id: null, sold_on: null, installed_on: null, customer_location: null, warranty_until: null, service_item_id: null, note: null, created_at: this.now() }
          this.invLots.push(lot)
        }
        lotId = lot.id
      }
      if (it!.tracking !== 'none' && !lotId) fail(`item ${it!.sku} is tracked by lot or serial number: state which was found.`)
      if (it!.tracking === 'none' && lotId) fail(`item ${it!.sku} is not tracked by lot or serial number.`)
      const ex = this.stockCountLines.find((x) => x.count_id === c.id && x.item_id === it!.id && (x.lot_id ?? null) === lotId)
      if (ex) Object.assign(ex, { counted_qty: qty?.toString() ?? null, reason_code: l.reason_code ?? 'found', note: l.note ?? null })
      else this.stockCountLines.push({ id: uid(), count_id: c.id, company_id: c.company_id, item_id: it!.id, lot_id: lotId, book_qty: '0', unit_cost: (D(it!.qty_on_hand).isZero() ? D(l.unit_cost ?? 0) : q6(D(it!.value_on_hand).div(it!.qty_on_hand))).toString(), counted_qty: qty?.toString() ?? null, reason_code: l.reason_code ?? 'found', note: l.note ?? null, added_in_count: true })
    }
    if (complete && !this.countLines(c.id).some((l) => l.counted_qty === null)) {
      Object.assign(c, { status: 'counted', counted_by: this.actor, counted_at: this.now() })
      return 'counted'
    }
    c.status = 'open'
    return 'open'
  }
  async reviewStockCount(id: ID, decision: 'reviewed' | 'recount', note?: string) {
    const c = this.stockCount(id)
    if (c.status !== 'counted') fail(`only a completed count can be reviewed. This count is ${c.status}.`)
    if (!['reviewed', 'recount'].includes(decision)) fail('the decision is reviewed or recount.')
    this.makerChecker(c.counted_by, 'stock count')
    if (decision === 'recount') {
      if (blank(note)) fail('say why the stock must be counted again.')
      Object.assign(c, { status: 'open', review_note: note, reviewed_by: this.actor, reviewed_at: this.now() })
      this.log(c.company_id, 'stock_counts', c.id, 'recount_asked', null, { count_no: c.count_no }, note ?? null)
      return
    }
    const n = this.countLines(id).filter((l) => !D(l.counted_qty ?? 0).eq(l.book_qty) && !l.reason_code).length
    if (n > 0) fail(`${n} line(s) differ from the books and carry no reason. A difference is adjusted only with its reason.`)
    Object.assign(c, { status: 'reviewed', review_note: note ?? null, reviewed_by: this.actor, reviewed_at: this.now() })
    this.log(c.company_id, 'stock_counts', c.id, 'reviewed', null, { count_no: c.count_no }, note ?? null)
  }
  async proposeStockCount(id: ID): Promise<ID | null> {
    const c = this.stockCount(id)
    if (c.status !== 'reviewed') fail(`the count must be reviewed before its differences are adjusted. It is ${c.status}.`)
    const diff = this.countLines(id).filter((l) => !D(l.counted_qty ?? 0).eq(l.book_qty))
    if (!diff.length) {
      c.status = 'closed'
      this.log(c.company_id, 'stock_counts', c.id, 'closed_without_difference', null, { count_no: c.count_no, rule: 'What was counted agrees with the books. Nothing is adjusted.' }, null)
      return null
    }
    const snap = this.inventorySnapshot()
    const d: StockDoc = {
      id: uid(), company_id: c.company_id, kind: 'adjustment', doc_no: this.docNo(c.company_id, 'stock_adjustment', 'SA', c.count_date), doc_date: c.count_date, warehouse_id: c.warehouse_id, to_warehouse_id: null, party_id: null,
      purchase_doc_id: null, invoice_id: null, receipt_doc_id: null, count_id: c.id, counter_account_id: null, reason: `Differences found by stock count ${c.count_no}`, dims: {}, meta: {}, status: 'draft', total_value: '0', journal_id: null, created_by: this.actor, created_at: this.now(),
    }
    try {
      this.stockDocs.push(d)
      diff.forEach((l, i) => {
        const delta = D(l.counted_qty ?? 0).minus(l.book_qty)
        this.stockDocLines.push({ id: uid(), doc_id: d.id, company_id: c.company_id, line_no: i + 1, item_id: l.item_id, lot_id: l.lot_id, qty: delta.toString(), unit_cost: delta.gt(0) ? String(l.unit_cost) : '0', value: '0', expensed: '0', weight: null, reason_code: l.reason_code, source_line_id: null, receipt_line_id: null, hold_id: null, note: l.note })
      })
      c.doc_id = d.id
      return this.proposeStockDocInner(d)
    } catch (e) {
      this.inventoryRestore(snap)
      throw e
    }
  }
  async cancelStockCount(id: ID, reason: string) {
    const c = this.stockCount(id)
    if (!['open', 'counted', 'reviewed'].includes(c.status)) fail(`a count that is ${c.status} cannot be cancelled.`)
    if (blank(reason)) fail('a reason is required.')
    c.status = 'cancelled'
    this.log(c.company_id, 'stock_counts', c.id, 'update', null, { status: 'cancelled' }, reason)
  }

  // ------------------------------------------------------------ conditions noted on stock
  async listInvHolds(companyIds: ID[]) { return this.invHolds.filter((h) => companyIds.includes(h.company_id)).sort((a, b) => b.noted_on.localeCompare(a.noted_on)) }
  async saveInvHold(p: InvHoldInput): Promise<ID> {
    const it = this.invItems.find((x) => x.id === p.item_id)
    if (!it || it.company_id !== p.company_id) fail('item not found.')
    if (!this.warehouses.some((w) => w.id === p.warehouse_id && w.company_id === p.company_id)) fail('location not found.')
    if (!['damaged', 'expired', 'obsolete', 'quarantine', 'missing'].includes(p.condition)) fail('state the condition: damaged, expired, obsolete, quarantine or missing.')
    const qty = D(p.qty ?? 0)
    if (qty.lte(0)) fail('the quantity must be greater than zero.')
    const have = this.stockAvailable(it!.id, p.warehouse_id, p.lot_id ?? null)
    const held = this.invHolds.filter((h) => h.item_id === it!.id && h.warehouse_id === p.warehouse_id && (h.lot_id ?? null) === (p.lot_id ?? null) && h.status === 'open').reduce((s, h) => s.plus(h.qty), ZERO)
    if (held.plus(qty).gt(have)) fail(`only ${have} ${it!.unit} of this item are in this location, and ${held} are already noted. The quantity noted cannot exceed the stock.`)
    const h: InvHold = { id: uid(), company_id: p.company_id, item_id: it!.id, warehouse_id: p.warehouse_id, lot_id: p.lot_id ?? null, qty: q4(qty).toString(), condition: p.condition, noted_on: p.noted_on ?? today(), note: p.note ?? null, status: 'open', resolved_doc_id: null, resolved_at: null, resolved_note: null, created_at: this.now() }
    this.invHolds.push(h)
    this.log(p.company_id, 'inv_holds', h.id, 'insert', null, h, null)
    return h.id
  }
  async releaseInvHold(id: ID, note: string) {
    const h = this.invHolds.find((x) => x.id === id) ?? fail('record not found.')
    if (h.status !== 'open') fail(`this note is already ${h.status.replace(/_/g, ' ')}.`)
    if (blank(note)) fail('say why the stock is released.')
    Object.assign(h, { status: 'released', resolved_at: this.now(), resolved_note: note })
    this.log(h.company_id, 'inv_holds', h.id, 'update', null, { status: 'released' }, note)
  }

}
