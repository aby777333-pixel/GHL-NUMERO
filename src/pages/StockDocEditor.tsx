import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, Ban, Boxes, ExternalLink, Plus, Save, Send, Trash2, Truck } from 'lucide-react'
import type { ID, Invoice } from '@/engine/types'
import type { PurchaseDoc } from '@/engine/opsTypes'
import { P3_ACCOUNT_MAP_KEYS } from '@/engine/p3Types'
import type { InvHold, InvItem, InvLot, InvMovement, LandedCharge, StockDoc, StockDocInput, StockDocKind, StockDocLine, StockReason } from '@/engine/p3Types'
import { unitCost, warehouseName } from '@/engine/stock'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO, round2, sum } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, ProposedEntries, Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Estimate, Fact, History, NoAccess, Tile, digits, foot, human, signed, useCompanyChoices } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { CONDITION_LABEL, DOC_KINDS, DOC_KIND_LABEL, REASONS, REASON_LABEL, docStatusLabel, fmtQty, freeInPlace } from './Inventory'

// how many movements of one document are read: the adjustment of a large count writes one for every line
const DOC_MOVES = 20000

// =====================================================================
// A stock document of any kind: an editor while it is a draft, a record
// afterwards. Saving commits nothing. Proposing PROPOSES the accounting
// entry; stock and books change when a second person approves it.
// A transfer changes the place of stock, not its value: it proposes nothing.
// =====================================================================

const isKind = (v: string | null): v is StockDocKind => !!v && DOC_KINDS.includes(v as StockDocKind)
const NO_MANAGE = 'You need the permission inventory.manage in this company'
const METHODS: { key: 'value' | 'quantity' | 'weight'; label: string; says: string }[] = [
  { key: 'value', label: 'By value', says: 'Each line takes its share in proportion to the value at which it was received.' },
  { key: 'quantity', label: 'By quantity', says: 'Each line takes its share in proportion to the quantity received.' },
  { key: 'weight', label: 'By weight', says: 'Each line takes its share in proportion to its weight. Every line needs a weight.' },
]
const CHARGE_NAMES = ['Freight', 'Insurance', 'Customs duty', 'Clearing charges', 'Port charges', 'Inland transport', 'Handling']
const WHAT: Record<StockDocKind, string> = {
  receipt: 'Goods taken into stock. Proposing debits the stock ledger and credits goods received, not yet invoiced, unless another ledger is named.',
  issue: 'Goods leaving stock, to a customer or for use. Proposing debits the cost of sales ledger and credits the stock ledger, at the cost the engine works out.',
  transfer: 'Goods moving between two locations of the same company. The place changes and the value does not, so nothing is proposed and no approval is needed.',
  return_in: 'Goods a customer has returned. Proposing debits the stock ledger and credits the cost of sales ledger, unless another ledger is named.',
  return_out: 'Goods sent back to a vendor. Proposing debits goods received, not yet invoiced, and credits the stock ledger, at the cost the engine works out.',
  adjustment: 'Stock lost, written down or found. Every line states what happened. Proposing charges stock lost to the ledger for stock losses, and credits stock found to the ledger for stock gains.',
  landed_cost: 'Freight, insurance, duty and other charges added to the cost of goods already received. The share of goods still in stock joins the stock; the share of goods that have left is a cost at once.',
}
const HOLD_REASON: Partial<Record<InvHold['condition'], StockReason>> = { damaged: 'damage', expired: 'expiry', obsolete: 'obsolescence' }
const plain = (v: Decimal.Value | null | undefined) => (v === null || v === undefined || v === '' ? '' : D(v).toString())
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Row { key: number; item_id: ID | ''; lot_id: ID | ''; lot_no: string; mfg_date: string; expiry_date: string; qty: string; unit_cost: string; reason_code: StockReason | ''; source_line_id: ID | ''; hold_id: ID | ''; note: string }
interface Charge { key: number; name: string; amount: string; account_id: ID | ''; party_id: ID | '' }
let k = 0
const blankRow = (): Row => ({ key: ++k, item_id: '', lot_id: '', lot_no: '', mfg_date: '', expiry_date: '', qty: '', unit_cost: '', reason_code: '', source_line_id: '', hold_id: '', note: '' })
const blankCharge = (): Charge => ({ key: ++k, name: '', amount: '', account_id: '', party_id: '' })

export default function StockDocEditor() {
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('inventory.view', cid))
  if (!ids.length) return <NoAccess eyebrow="Inventory · Stock document" title="Inventory" perm="inventory.view" back="/inventory?tab=documents" />
  // a fresh form for every document: nothing typed for one may leak into another
  if (id) return <Existing key={id} id={id} />
  return <Editor key={`new|${sp.get('kind') ?? ''}|${sp.get('company') ?? ''}|${sp.get('hold') ?? ''}|${sp.get('receipt') ?? ''}`} doc={null} />
}

const Back = ({ to = '/inventory?tab=documents' }: { to?: string }) => { const nav = useNavigate(); return <button className="btn ghost" onClick={() => nav(to)}><ArrowLeft size={15} /> Back</button> }

function Existing({ id }: { id: ID }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  // a document that cannot be read is reported as such, with what the engine said
  const main = useAsync(async () => { try { return { doc: await api.getStockDoc(id), why: null as string | null } } catch (e) { return { doc: null, why: message(e) } } }, [api, id])
  if (!main.data) return <div><PageHeader eyebrow="Inventory · Stock document" title="Stock document" actions={<Back />} /><Panel><Loading rows={7} label="Loading the document" /></Panel></div>
  const doc = main.data.doc
  if (!doc || !can('inventory.view', doc.company_id)) {
    return (
      <div>
        <PageHeader eyebrow="Inventory · Stock document" title="Stock document" actions={<Back />} />
        <Panel><Empty icon={<Boxes size={20} />} title="Document not found or not shared with you" body={<>This stock document does not exist in the companies in which your role reads inventory.{main.data.why ? <span className="mt-1 block text-[12px]">The system said: {main.data.why}</span> : null}</>} action={<button className="btn" onClick={() => nav('/inventory?tab=documents')}><ArrowLeft size={14} /> Back to Inventory</button>} /></Panel>
      </div>
    )
  }
  const editable = ['draft', 'rejected'].includes(doc.status) && !doc.count_id && can('inventory.manage', doc.company_id)
  return editable ? <Editor doc={doc} /> : <DocView doc={doc} />
}

// ====================================================================== the editor
function Editor({ doc }: { doc: StockDoc | null }) {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  useApp((s) => s.session)
  const accountName = useAccountName()
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const manageIds = companies.map((c) => c.id).filter((cid) => can('inventory.manage', cid))
  const choices = useCompanyChoices(manageIds)
  const paramKind = sp.get('kind')
  const paramCompany = sp.get('company')
  const holdParam = doc ? null : sp.get('hold')
  const receiptParam = doc ? null : sp.get('receipt')

  const [kind, setKind] = useState<StockDocKind>(doc?.kind ?? (holdParam ? 'adjustment' : isKind(paramKind) ? paramKind : 'receipt'))
  const [companyId, setCompanyId] = useState<ID>(doc?.company_id ?? (paramCompany && manageIds.includes(paramCompany) ? paramCompany : manageIds.length === 1 ? manageIds[0] : ''))
  const [date, setDate] = useState(doc?.doc_date ?? today())
  const [warehouseId, setWarehouseId] = useState<ID>(doc?.warehouse_id ?? '')
  const [toWarehouseId, setToWarehouseId] = useState<ID>(doc?.to_warehouse_id ?? '')
  const [partyId, setPartyId] = useState<ID>(doc?.party_id ?? '')
  const [purchaseDocId, setPurchaseDocId] = useState<ID>(doc?.purchase_doc_id ?? '')
  const [invoiceId, setInvoiceId] = useState<ID>(doc?.invoice_id ?? '')
  const [receiptDocId, setReceiptDocId] = useState<ID>(doc?.receipt_doc_id ?? receiptParam ?? '')
  const [counterId, setCounterId] = useState<ID>(doc?.counter_account_id ?? '')
  const [reason, setReason] = useState(doc?.reason ?? '')
  const [method, setMethod] = useState<'value' | 'quantity' | 'weight'>(doc?.meta?.method ?? 'value')
  const [charges, setCharges] = useState<Charge[]>(() => (doc?.meta?.charges?.length ? doc.meta.charges.map((c) => ({ key: ++k, name: c.name, amount: plain(c.amount), account_id: c.account_id ?? '', party_id: c.party_id ?? '' })) : [blankCharge()]))
  const [weights, setWeights] = useState<Record<ID, string>>(() => Object.fromEntries((doc?.lines ?? []).filter((l) => l.receipt_line_id && l.weight !== null).map((l) => [l.receipt_line_id as ID, plain(l.weight)])))
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [cancelling, setCancelling] = useState(false)
  const [touched, setTouched] = useState(false)
  /** the lines of an existing draft are on the screen: nothing is checked, and nothing can be saved, before that */
  const [ready, setReady] = useState(!doc || doc.kind === 'landed_cost')
  const loaded = useRef(false)
  const holdApplied = useRef(false)

  const landed = kind === 'landed_cost'
  const incoming = kind === 'receipt' || kind === 'return_in'
  const outgoing = kind === 'issue' || kind === 'transfer' || kind === 'return_out'
  const showParty = kind === 'receipt' || kind === 'issue' || kind === 'return_in' || kind === 'return_out'
  const showPurchase = kind === 'receipt' || kind === 'return_out'
  const showInvoice = showParty
  const showCounter = showParty
  const partyLabel = kind === 'receipt' ? 'Supplier' : kind === 'return_out' ? 'Vendor' : 'Customer'

  // ------------------------------------------------------------ what the company holds
  const base = useAsync(async () => {
    if (!companyId) return null
    const co = [companyId]
    const [warehouses, categories, items, lots, stock, holds, counts, receipts, map] = await Promise.all([
      api.listWarehouses(co), api.listInvCategories(co), api.listInvItems(co), api.listInvLots({ companyIds: co }), api.stockOnHand(co), api.listInvHolds(co), api.listStockCounts(co),
      api.listStockDocs({ companyIds: co, kinds: ['receipt'] }), api.listAccountMap(co).then((m) => m, () => null),
    ])
    return { warehouses, categories, items, lots, stock, holds, counts, receipts: receipts.filter((r) => r.status === 'posted'), map }
  }, [api, companyId])
  const b = base.data

  const mayPurchase = !!companyId && can('purchase.view', companyId)
  const invoicePerm = kind === 'receipt' || kind === 'return_out' ? 'bill.view' : 'invoice.view'
  const mayInvoice = !!companyId && can(invoicePerm, companyId)
  const goodsReceipts = useAsync<PurchaseDoc[]>(async () => (showPurchase && mayPurchase ? (await api.listPurchaseDocs({ companyIds: [companyId], kinds: ['goods_receipt'] })).filter((g) => g.status === 'confirmed' || g.id === purchaseDocId) : []), [api, companyId, showPurchase, mayPurchase])
  const gr = useAsync<PurchaseDoc | null>(async () => (showPurchase && mayPurchase && purchaseDocId ? api.getPurchaseDoc(purchaseDocId) : null), [api, purchaseDocId, showPurchase, mayPurchase])
  const invoices = useAsync<Invoice[]>(async () => (showInvoice && mayInvoice ? api.listInvoices({ companyIds: [companyId], docTypes: invoicePerm === 'bill.view' ? ['purchase_bill', 'debit_note'] : ['sales_invoice', 'credit_note'] }) : []), [api, companyId, showInvoice, mayInvoice, invoicePerm])
  const receipt = useAsync(async () => {
    if (!landed || !receiptDocId || !companyId) return null
    const [rdoc, moves] = await Promise.all([api.getStockDoc(receiptDocId), api.listInvMovements({ companyIds: [companyId], docId: receiptDocId, limit: DOC_MOVES })])
    return { doc: rdoc, moves }
  }, [api, landed, receiptDocId, companyId])
  const holdLookup = useAsync(async () => (holdParam ? (await api.listInvHolds(manageIds)).find((h) => h.id === holdParam) ?? null : null), [api, holdParam, manageIds.join(',')])

  const items = useMemo(() => new Map((b?.items ?? []).map((i) => [i.id, i])), [b])
  const lotsById = useMemo(() => new Map((b?.lots ?? []).map((l) => [l.id, l])), [b])
  const categories = useMemo(() => new Map((b?.categories ?? []).map((c) => [c.id, c])), [b])
  const whName = useMemo(() => warehouseName(b?.warehouses ?? []), [b])
  const currency = companies.find((c) => c.id === companyId)?.base_currency

  // ------------------------------------------------------------ load the lines of an existing draft
  useEffect(() => {
    if (!doc || !b || loaded.current) return
    loaded.current = true
    if (doc.kind === 'landed_cost') return
    const list = (doc.lines ?? []).map((l): Row => {
      const lot = l.lot_id ? b.lots.find((x) => x.id === l.lot_id) : undefined
      return {
        key: ++k, item_id: l.item_id, lot_id: l.lot_id ?? '', lot_no: lot?.lot_no ?? '', mfg_date: lot?.mfg_date ?? '', expiry_date: lot?.expiry_date ?? '', qty: plain(l.qty),
        unit_cost: D(l.unit_cost).isZero() ? '' : plain(l.unit_cost), reason_code: l.reason_code ?? '', source_line_id: l.source_line_id ?? '', hold_id: l.hold_id ?? '', note: l.note ?? '',
      }
    })
    setRows(list.length ? list : [blankRow()])
    setReady(true)
  }, [doc, b])

  // ------------------------------------------------------------ a write-off that starts from a condition noted on stock
  const hold = holdLookup.data ?? null
  useEffect(() => {
    if (!hold || holdApplied.current || hold.status !== 'open') return
    holdApplied.current = true
    setKind('adjustment'); setCompanyId(hold.company_id); setWarehouseId(hold.warehouse_id)
    setReason(`Write-off of stock noted as ${CONDITION_LABEL[hold.condition].toLowerCase()} on ${fmtDate(hold.noted_on)}`)
    setRows([{ ...blankRow(), item_id: hold.item_id, lot_id: hold.lot_id ?? '', qty: '-' + D(hold.qty).toString(), reason_code: HOLD_REASON[hold.condition] ?? '', hold_id: hold.id, note: hold.note ?? '' }])
  }, [hold])

  // the supplier of a goods receipt is the supplier of the stock receipt, unless another is chosen
  useEffect(() => { if (gr.data?.party_id && !partyId) setPartyId(gr.data.party_id) }, [gr.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ helpers over the lines
  const itemOf = (r: Row): InvItem | undefined => (r.item_id ? items.get(r.item_id) : undefined)
  const inbound = (r: Row) => incoming || (kind === 'adjustment' && D(r.qty || 0).gt(0))
  const knownLot = (r: Row): InvLot | undefined => (r.item_id && r.lot_no.trim() ? (b?.lots ?? []).find((l) => l.item_id === r.item_id && l.lot_no === r.lot_no.trim()) : undefined)
  const sourceOf = (r: Row) => (r.source_line_id ? (gr.data?.lines ?? []).find((l) => l.id === r.source_line_id) : undefined)
  const costOf = (r: Row): Decimal | null => {
    if (r.unit_cost.trim() !== '') return D(r.unit_cost)
    const src = sourceOf(r)
    if (kind === 'receipt' && src) return D(src.rate).times(gr.data?.fx_rate ?? 1)
    return null
  }
  const freeHere = (r: Row) => (r.item_id && warehouseId ? freeInPlace(b?.stock ?? [], r.item_id, warehouseId, r.lot_id || null) : ZERO)
  const lotChoices = (r: Row) => (b?.stock ?? []).filter((s) => s.item_id === r.item_id && s.warehouse_id === warehouseId && s.lot_id && (D(s.qty).gt(0) || s.lot_id === r.lot_id))
    .map((s) => ({ lot: lotsById.get(s.lot_id as ID), free: D(s.qty).minus(s.pending_out) })).filter((x): x is { lot: InvLot; free: Decimal } => !!x.lot)
    .sort((x, y) => (x.lot.expiry_date ?? '9').localeCompare(y.lot.expiry_date ?? '9') || x.lot.lot_no.localeCompare(y.lot.lot_no))
  /** what the line is worth: known for goods coming in, an estimate at the cost carried for goods going out */
  const valueOf = (r: Row): { value: Decimal; estimate: boolean } | null => {
    const it = itemOf(r); const q = D(r.qty || 0).abs()
    if (!it || q.isZero()) return null
    if (inbound(r)) { const c = costOf(r) ?? (kind === 'adjustment' ? unitCost(it) : null); return c ? { value: round2(q.times(c)), estimate: kind === 'adjustment' && r.unit_cost.trim() === '' } : null }
    return { value: round2(q.times(unitCost(it))), estimate: true }
  }

  const set = (key: number, patch: Partial<Row>) => { setTouched(true); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))) }
  const used = rows.filter((r) => r.item_id)

  // ------------------------------------------------------------ landed cost: how the charges would be shared
  const receiptLines = receipt.data?.doc.lines ?? []
  const weightOf = (l: StockDocLine) => weights[l.id] ?? (l.weight !== null ? plain(l.weight) : (() => { const it = items.get(l.item_id); return it && it.unit_weight !== null ? D(it.unit_weight).times(l.qty).toString() : '' })())
  const chargeTotal = round2(sum(charges.map((c) => D(c.amount || 0))))
  const shares = useMemo(() => {
    if (!landed || !receipt.data) return []
    const basis = (l: StockDocLine) => (method === 'quantity' ? D(l.qty) : method === 'weight' ? D(weightOf(l) || 0) : D(l.value))
    const all = sum(receiptLines.map(basis))
    let left = chargeTotal
    return receiptLines.map((l, i) => {
      const share = all.lte(0) ? ZERO : i === receiptLines.length - 1 ? left : round2(chargeTotal.times(basis(l)).div(all))
      left = left.minus(share)
      const layer = receipt.data!.moves.find((m) => m.doc_line_id === l.id && m.is_layer && m.status === 'posted')
      const toStock = layer && !D(layer.qty).isZero() ? round2(share.times(layer.remaining_qty).div(layer.qty)) : ZERO
      return { line: l, basis: basis(l), share, remaining: layer ? D(layer.remaining_qty) : null, toStock, expensed: share.minus(toStock) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, receipt.data, method, weights, chargeTotal, items])

  // ------------------------------------------------------------ what proposing would propose
  const mapped = (key: string) => {
    const label = P3_ACCOUNT_MAP_KEYS.find((x) => x.key === key)?.label ?? key
    if (!b?.map) return { text: `the ledger mapped as “${label}”`, missing: false, label }
    const m = b.map.find((x) => x.company_id === companyId && x.key === key)
    return m ? { text: accountName(m.account_id), missing: false, label } : { text: `no ledger is mapped as “${label}”`, missing: true, label }
  }
  interface Leg { side: 'Debit' | 'Credit'; ledger: string; amount: Decimal; estimate: boolean }
  const legs: Leg[] = []
  const missingMaps = new Set<string>()
  const put = (side: Leg['side'], ledger: string, amount: Decimal, estimate: boolean) => {
    if (amount.isZero()) return
    const ex = legs.find((l) => l.side === side && l.ledger === ledger)
    if (ex) { ex.amount = ex.amount.plus(amount); ex.estimate = ex.estimate || estimate } else legs.push({ side, ledger, amount, estimate })
  }
  const need = (key: string) => { const m = mapped(key); if (m.missing) missingMaps.add(m.label); return m.text }
  if (landed) {
    const stockLedgers = new Map<string, Decimal>(); let cost = ZERO; const costLedgers = new Map<string, Decimal>()
    for (const s of shares) {
      const cat = categories.get(items.get(s.line.item_id)?.category_id ?? '')
      stockLedgers.set(accountName(cat?.inventory_account_id), (stockLedgers.get(accountName(cat?.inventory_account_id)) ?? ZERO).plus(s.toStock))
      costLedgers.set(accountName(cat?.cogs_account_id), (costLedgers.get(accountName(cat?.cogs_account_id)) ?? ZERO).plus(s.expensed)); cost = cost.plus(s.expensed)
    }
    stockLedgers.forEach((v, name) => put('Debit', name, v, true))
    costLedgers.forEach((v, name) => put('Debit', name, v, true))
    for (const c of charges) if (D(c.amount || 0).gt(0)) put('Credit', c.account_id ? accountName(c.account_id) : need('landed_cost_clearing'), round2(c.amount), false)
  } else if (kind !== 'transfer') {
    for (const r of used) {
      const it = itemOf(r); const v = valueOf(r)
      if (!it || !v) continue
      const cat = categories.get(it.category_id)
      const stockLedger = accountName(cat?.inventory_account_id)
      const counter = counterId ? accountName(counterId) : null
      if (kind === 'receipt') { put('Debit', stockLedger, v.value, v.estimate); put('Credit', counter ?? need('grni'), v.value, v.estimate) }
      else if (kind === 'return_in') { put('Debit', stockLedger, v.value, v.estimate); put('Credit', counter ?? accountName(cat?.cogs_account_id), v.value, v.estimate) }
      else if (kind === 'issue') { put('Debit', counter ?? accountName(cat?.cogs_account_id), v.value, true); put('Credit', stockLedger, v.value, true) }
      else if (kind === 'return_out') { put('Debit', counter ?? need('grni'), v.value, true); put('Credit', stockLedger, v.value, true) }
      else if (D(r.qty || 0).lt(0)) { put('Debit', need('stock_loss'), v.value, true); put('Credit', stockLedger, v.value, true) }
      else { put('Debit', stockLedger, v.value, v.estimate); put('Credit', need('stock_gain'), v.value, v.estimate) }
    }
  }
  const debitTotal = sum(legs.filter((l) => l.side === 'Debit').map((l) => l.amount))

  // ------------------------------------------------------------ checks
  const problems: string[] = []
  const beforeProposing: string[] = []
  if (!companyId) problems.push('Choose the company.')
  if (!date) problems.push('Enter the date of the document.')
  if (landed) {
    if (!receiptDocId) problems.push('Choose the posted stock receipt the cost is added to.')
    charges.forEach((c, i) => {
      if (!c.name.trim()) problems.push(`Charge ${i + 1}: name the charge.`)
      if (D(c.amount || 0).lte(0)) problems.push(`Charge ${i + 1}: enter an amount greater than zero.`)
    })
    if (method === 'weight' && receiptLines.some((l) => D(weightOf(l) || 0).lte(0))) beforeProposing.push('To share the cost by weight, every line of the receipt needs its weight.')
    if (method === 'value' && receipt.data && sum(receiptLines.map((l) => l.value)).lte(0)) beforeProposing.push('The receipt carries no value to share the cost over. Share it by quantity or by weight.')
  } else {
    if (!warehouseId) problems.push('Choose the location.')
    if (kind === 'transfer' && !toWarehouseId) problems.push('Choose the location that receives the stock.')
    if (kind === 'transfer' && toWarehouseId && toWarehouseId === warehouseId) problems.push('A transfer needs another location to receive the stock.')
    if (kind === 'adjustment' && !reason.trim()) problems.push('An adjustment of stock needs its reason.')
    if (!used.length) problems.push('Add at least one line.')
    rows.forEach((r, i) => {
      const n = i + 1; const it = itemOf(r); const q = D(r.qty || 0)
      if (!r.item_id) { if (rows.length > 1 || r.qty || r.note) problems.push(`Line ${n}: choose the item, or remove the line.`); return }
      if (!it) return
      if (q.isZero()) problems.push(`Line ${n}: enter the quantity.`)
      if (it.tracking !== 'none') {
        const what = it.tracking === 'serial' ? 'serial number' : 'lot'
        if (inbound(r) ? !r.lot_no.trim() : !r.lot_id) problems.push(`Line ${n}: ${it.sku} is tracked by ${what}: ${inbound(r) ? 'enter' : 'choose'} the ${what}${it.tracking === 'serial' ? '' : ' number'}.`)
        if (it.tracking === 'serial' && !q.isZero() && !q.abs().eq(1)) problems.push(`Line ${n}: a serial number is one unit.`)
        const known = inbound(r) && it.tracking === 'serial' ? knownLot(r) : undefined
        if (known && (b?.stock ?? []).some((s) => s.lot_id === known.id && D(s.qty).plus(s.pending_in).minus(s.pending_out).gt(0))) problems.push(`Line ${n}: serial number ${known.lot_no} is already in stock.`)
        if (inbound(r) && r.lot_no.trim() && rows.some((o) => o.key !== r.key && o.item_id === r.item_id && o.lot_no.trim() === r.lot_no.trim()) && it.tracking === 'serial') problems.push(`Line ${n}: serial number ${r.lot_no.trim()} is entered on more than one line.`)
      }
      if (incoming && r.unit_cost.trim() === '' && !sourceOf(r)) problems.push(`Line ${n}: state the cost of one ${it.unit}.`)
      if (kind === 'adjustment' && !r.reason_code) problems.push(`Line ${n}: state what happened to the stock.`)
      if (!inbound(r) && !q.isZero() && warehouseId && q.abs().gt(freeHere(r))) beforeProposing.push(`Line ${n}: ${fmtQty(q.abs())} ${it.unit} of ${it.sku} are asked for, and ${fmtQty(freeHere(r))} are free in this location${r.lot_id ? ' in this lot' : ''}.`)
    })
  }
  const frozen = (b?.counts ?? []).find((c) => c.frozen && ['open', 'counted', 'reviewed', 'proposed'].includes(c.status) && (c.warehouse_id === warehouseId || (!!toWarehouseId && c.warehouse_id === toWarehouseId)))
  if (frozen && !landed) beforeProposing.push(`Stock count ${frozen.count_no} is open for ${whName(frozen.warehouse_id)}, so its stock is frozen. Complete or cancel the count before proposing.`)
  missingMaps.forEach((label) => beforeProposing.push(`No ledger is mapped as “${label}”. Set it under Chart of accounts → Account mapping.`))

  const allowed = ready && !!companyId && can('inventory.manage', companyId)
  const started = ready && (touched || !!doc || used.length > 0 || (landed && (!!receiptDocId || charges.some((c) => c.name || c.amount))))

  // ------------------------------------------------------------ actions
  const changeCompany = (cid: ID) => { setCompanyId(cid); setWarehouseId(''); setToWarehouseId(''); setPartyId(''); setPurchaseDocId(''); setInvoiceId(''); setReceiptDocId(''); setCounterId(''); setRows([blankRow()]); setCharges([blankCharge()]); setWeights({}) }
  const changeKind = (next: StockDocKind) => { setKind(next); setToWarehouseId(''); setPurchaseDocId(''); setInvoiceId(''); setReceiptDocId(''); setCounterId(''); setRows([blankRow()]) }
  const changeWarehouse = (wid: ID) => { setWarehouseId(wid); if (!incoming) setRows((rs) => rs.map((r) => ({ ...r, lot_id: r.hold_id ? r.lot_id : '' }))) }

  const payload = (): StockDocInput => {
    const head = { id: doc?.id, company_id: companyId, kind, doc_date: date, reason: reason.trim() || undefined, dims: doc?.dims ?? {} }
    if (landed) {
      const list: LandedCharge[] = charges.map((c) => ({ name: c.name.trim(), amount: c.amount, account_id: c.account_id || null, party_id: c.party_id || null }))
      return {
        ...head, receipt_doc_id: receiptDocId, meta: { ...(doc?.meta ?? {}), method, charges: list },
        lines: receiptLines.map((l) => ({ item_id: l.item_id, qty: l.qty, receipt_line_id: l.id, ...(weightOf(l).trim() !== '' ? { weight: weightOf(l) } : {}) })),
      }
    }
    return {
      ...head, warehouse_id: warehouseId, to_warehouse_id: kind === 'transfer' ? toWarehouseId : null, party_id: showParty ? partyId || null : null, purchase_doc_id: showPurchase ? purchaseDocId || null : null,
      invoice_id: showInvoice ? invoiceId || null : null, counter_account_id: showCounter ? counterId || null : null, meta: doc?.meta ?? {},
      lines: used.map((r) => {
        const it = itemOf(r); const tracked = !!it && it.tracking !== 'none'; const known = knownLot(r)
        return {
          item_id: r.item_id as ID, qty: r.qty,
          ...(tracked ? (inbound(r) ? { lot_no: r.lot_no.trim(), ...(known ? {} : { mfg_date: r.mfg_date || undefined, expiry_date: r.expiry_date || undefined }) } : { lot_id: r.lot_id || null }) : {}),
          ...(inbound(r) && r.unit_cost.trim() !== '' ? { unit_cost: r.unit_cost } : {}),
          ...(kind === 'adjustment' && r.reason_code ? { reason_code: r.reason_code } : {}),
          ...(showPurchase && purchaseDocId && r.source_line_id ? { source_line_id: r.source_line_id } : {}),
          ...(kind === 'adjustment' && r.hold_id ? { hold_id: r.hold_id } : {}),
          note: r.note.trim() || undefined,
        }
      }),
    }
  }
  const save = async (propose: boolean) => {
    const did = await act(() => api.saveStockDoc(payload()), propose ? undefined : 'Draft saved')
    if (!did) return
    setTouched(false)
    // the draft now exists; if proposing is refused the person continues from the document itself
    if (propose) await act(() => api.proposeStockDoc(did), (j) => (j ? 'Entry proposed — awaiting approval' : kind === 'transfer' ? 'Transfer recorded. It changes no value, so no entry was needed.' : 'Quantities recorded. The document carries no value, so there is no entry.'))
    nav('/inventory/docs/' + did, { replace: true })
  }

  // ------------------------------------------------------------ choices
  const places = (b?.warehouses ?? []).filter((w) => w.is_active || w.id === warehouseId || w.id === toWarehouseId)
  const itemChoices = (r: Row) => (b?.items ?? []).filter((i) => i.status === 'active' || i.id === r.item_id)
  const ledgers = useMemo(() => accounts.filter((a) => a.company_id === companyId && ((!a.is_group && a.is_active) || a.id === counterId)).sort((x, y) => x.code.localeCompare(y.code)), [accounts, companyId, counterId])
  const chargeLedgers = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active && (a.type === 'liability' || a.type === 'asset' || a.type === 'expense')).sort((x, y) => Number(y.type === 'liability') - Number(x.type === 'liability') || x.code.localeCompare(y.code)), [accounts, companyId])
  const partyChoices = useMemo(() => parties.filter((p) => (p.status !== 'terminated' && p.roles.some((r) => r.company_id === companyId)) || p.id === partyId || charges.some((c) => c.party_id === p.id)).sort((x, y) => x.display_name.localeCompare(y.display_name)), [parties, companyId, partyId, charges])
  const defaultCounter = kind === 'receipt' || kind === 'return_out' ? mapped('grni').text : 'the cost of sales ledger of each item\'s category'
  const proposeLabel = kind === 'transfer' ? 'Save and record the transfer' : 'Save and propose'
  const proposeTitle = !ready ? 'Loading the lines of the document' : !allowed ? NO_MANAGE : kind === 'transfer' ? 'Records the transfer at once. The place of the stock changes and its value does not, so there is no entry to approve.' : 'Proposes the accounting entry. Stock and books change when a second person approves it.'

  const title = doc ? `Edit ${doc.doc_no}` : `New ${DOC_KIND_LABEL[kind].toLowerCase()}`
  return (
    <div>
      <PageHeader eyebrow={`Inventory · ${DOC_KIND_LABEL[kind]}`} title={title}
        subtitle={<>{doc ? 'A draft.' : 'Not saved yet.'} A draft changes neither stock nor books.<DemoTag className="ml-2" /></>}
        actions={<>
          <Back />
          {doc && <button className="btn danger" disabled={busy || !can('inventory.manage', doc.company_id)} title={can('inventory.manage', doc.company_id) ? undefined : NO_MANAGE} onClick={() => setCancelling(true)}><Ban size={15} /> Cancel the document</button>}
          <button className="btn" disabled={busy || problems.length > 0 || !allowed} title={allowed ? undefined : ready ? NO_MANAGE : 'Loading the lines of the document'} onClick={() => void save(false)}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>
          <button className="btn primary" disabled={busy || problems.length > 0 || beforeProposing.length > 0 || !allowed} title={proposeTitle} onClick={() => void save(true)}>{busy ? <Spinner /> : <Send size={15} />} {proposeLabel}</button>
        </>} />

      {doc && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusChip status={doc.status} label={docStatusLabel(doc.status)} />
          <span className="chip">{DOC_KIND_LABEL[doc.kind]}</span>
        </div>
      )}
      {doc?.status === 'rejected' && <Note kind="warn" className="mb-4">The accounting entry of this document was rejected, so nothing was posted and the stock it had reserved is free again. Saving returns the document to draft; it can then be corrected and proposed again.</Note>}
      {holdParam && holdLookup.data === null && !holdLookup.loading && <Note kind="warn" className="mb-4">The condition noted on stock that this write-off was to start from could not be found in the companies in which you manage inventory.</Note>}
      {hold && hold.status !== 'open' && <Note kind="warn" className="mb-4">The condition noted on stock is already {human(hold.status)}, so there is nothing left to write off under it.</Note>}
      {hold && hold.status === 'open' && <Note className="mb-4">This write-off starts from a condition noted on stock: {CONDITION_LABEL[hold.condition].toLowerCase()}, noted on {fmtDate(hold.noted_on)}. The note is closed as written off when the entry of this adjustment is approved — not before.</Note>}
      <Note className="mb-4">{WHAT[kind]}</Note>
      {base.error && <ErrorBox message={base.error} retry={base.reload} />}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Document">
                <select className="field" value={kind} disabled={!!doc || !!holdParam} onChange={(e) => changeKind(e.target.value as StockDocKind)}>{DOC_KINDS.map((x) => <option key={x} value={x}>{DOC_KIND_LABEL[x]}</option>)}</select>
              </Field>
              <Field label="Company" hint={choices.length ? undefined : 'Your role manages inventory in no company.'}>
                <select className="field" value={companyId} disabled={!!doc || !!holdParam} onChange={(e) => changeCompany(e.target.value)}>
                  <option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  {companyId && !choices.some((c) => c.id === companyId) && <option value={companyId}>{companies.find((c) => c.id === companyId)?.name ?? 'This company'}</option>}
                </select>
              </Field>
              <Field label="Date"><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></Field>

              {landed ? (
                <Field label="Stock receipt the cost is added to" className="md:col-span-2 xl:col-span-3" hint={companyId && b && !b.receipts.length ? 'This company has no posted stock receipt.' : 'Only a receipt that has been posted can take landed cost.'}>
                  <select className="field" value={receiptDocId} onChange={(e) => { setReceiptDocId(e.target.value); setWeights({}); setTouched(true) }}>
                    <option value="">Choose…</option>
                    {(b?.receipts ?? []).map((r) => <option key={r.id} value={r.id}>{r.doc_no} · {fmtDate(r.doc_date)} · {whName(r.warehouse_id)}{r.party_id ? ` · ${partyName(r.party_id)}` : ''}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label={kind === 'transfer' ? 'From location' : 'Location'} hint={companyId && b && !places.length ? 'This company has no active location. Add one under Inventory → Locations and categories.' : undefined}>
                  <select className="field" value={warehouseId} disabled={!!holdParam && !!hold} onChange={(e) => { setTouched(true); changeWarehouse(e.target.value) }}><option value="">Choose…</option>{places.filter((w) => w.is_active || w.id === warehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>
                </Field>
              )}
              {kind === 'transfer' && (
                <Field label="To location">
                  <select className="field" value={toWarehouseId} onChange={(e) => { setTouched(true); setToWarehouseId(e.target.value) }}><option value="">Choose…</option>{places.filter((w) => w.id !== warehouseId && (w.is_active || w.id === toWarehouseId)).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>
                </Field>
              )}

              {showParty && (
                <Field label={`${partyLabel} (optional)`} hint={kind === 'issue' ? 'A serial-numbered unit issued to a customer is recorded as sold to that customer when the entry is approved.' : undefined}>
                  <select className="field" value={partyId} onChange={(e) => { setTouched(true); setPartyId(e.target.value) }}><option value="">Not recorded</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
                </Field>
              )}
              {showPurchase && (
                <Field label="Goods receipt (optional)" hint={!mayPurchase ? 'Your role does not read purchasing documents (purchase.view), so none can be linked here.' : goodsReceipts.data && !goodsReceipts.data.length ? 'This company has no confirmed goods receipt.' : 'A confirmed goods receipt from Purchasing.'}>
                  <select className="field" value={purchaseDocId} disabled={!mayPurchase} onChange={(e) => { setTouched(true); setPurchaseDocId(e.target.value); setRows((rs) => rs.map((r) => ({ ...r, source_line_id: '' }))) }}>
                    <option value="">{purchaseDocId && !mayPurchase ? 'Linked' : 'Not linked'}</option>
                    {(goodsReceipts.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.doc_no} · {fmtDate(g.doc_date)}{g.party_id ? ` · ${partyName(g.party_id)}` : ''}</option>)}
                  </select>
                </Field>
              )}
              {showInvoice && (
                <Field label={`${invoicePerm === 'bill.view' ? 'Vendor\'s bill' : 'Invoice'} (optional)`} hint={!mayInvoice ? `Your role does not read these documents (${invoicePerm}), so none can be linked here.` : undefined}>
                  <select className="field" value={invoiceId} disabled={!mayInvoice} onChange={(e) => { setTouched(true); setInvoiceId(e.target.value) }}>
                    <option value="">{invoiceId && !mayInvoice ? 'Linked' : 'Not linked'}</option>
                    {(invoices.data ?? []).filter((i) => (i.status !== 'draft' && i.status !== 'cancelled' && (!partyId || i.party_id === partyId)) || i.id === invoiceId).map((i) => <option key={i.id} value={i.id}>{i.doc_no ?? 'No number'} · {fmtDate(i.doc_date)} · {partyName(i.party_id)}</option>)}
                  </select>
                </Field>
              )}
              {showCounter && (
                <Field label="Other ledger of the entry (optional)" className="md:col-span-2" hint={`Left empty, the entry uses ${defaultCounter}.`}>
                  <select className="field" value={counterId} onChange={(e) => { setTouched(true); setCounterId(e.target.value) }}><option value="">As usual for this document</option>{ledgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
                </Field>
              )}
              {landed && (
                <Field label="How the charges are shared" className="md:col-span-2 xl:col-span-3" hint={METHODS.find((m) => m.key === method)?.says}>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How the charges are shared">
                    {METHODS.map((m) => <button key={m.key} type="button" role="radio" aria-checked={method === m.key} className={cx('btn sm', method === m.key && 'primary')} onClick={() => { setTouched(true); setMethod(m.key) }}>{m.label}</button>)}
                  </div>
                </Field>
              )}
              <Field label={kind === 'adjustment' ? 'Reason (required)' : 'Reason or remarks'} className="md:col-span-2 xl:col-span-3">
                <textarea className="field" rows={2} value={reason} onChange={(e) => { setTouched(true); setReason(e.target.value) }} placeholder={kind === 'adjustment' ? 'Why is the stock being adjusted?' : undefined} />
              </Field>
            </div>
          </Panel>

          {landed ? (
            <>
              <Section title="Charges that make up the landed cost">
                <Panel lit={false} className="overflow-hidden">
                  <div className="overflow-auto">
                    <table className="table dense" style={{ minWidth: 820 }}>
                      <thead><tr><th style={{ width: 36 }}>#</th><th style={{ minWidth: 200 }}>Charge</th><th className="r" style={{ width: 150 }}>Amount</th><th style={{ minWidth: 220 }}>Ledger credited</th><th style={{ minWidth: 200 }}>Owed to (optional)</th><th style={{ width: 40 }} /></tr></thead>
                      <tbody>
                        {charges.map((c, i) => (
                          <tr key={c.key}>
                            <td className="num text-muted">{i + 1}</td>
                            <td><input className="field sm" list="landed-charge-names" value={c.name} onChange={(e) => { setTouched(true); setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x))) }} placeholder="Freight, duty, insurance…" aria-label={`Charge ${i + 1} name`} /></td>
                            <td><input className="field sm num text-right" inputMode="decimal" value={c.amount} onChange={(e) => { setTouched(true); setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: digits(e.target.value) } : x))) }} aria-label={`Charge ${i + 1} amount`} /></td>
                            <td><select className="field sm" value={c.account_id} onChange={(e) => { setTouched(true); setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, account_id: e.target.value } : x))) }} aria-label={`Charge ${i + 1} ledger`}><option value="">Landed cost — clearing</option>{chargeLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td>
                            <td><select className="field sm" value={c.party_id} onChange={(e) => { setTouched(true); setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, party_id: e.target.value } : x))) }} aria-label={`Charge ${i + 1} party`}><option value="">Not recorded</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></td>
                            <td><button className="btn ghost icon sm" disabled={charges.length <= 1} onClick={() => { setTouched(true); setCharges((cs) => cs.filter((x) => x.key !== c.key)) }} aria-label="Remove charge"><Trash2 size={13} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><td className={foot} colSpan={2}><span className="text-[12.5px] font-medium text-ink2">Landed cost to be shared</span></td><td className={cx(foot, 'r')}><Money value={chargeTotal} currency={currency} className="font-medium text-ink" /></td><td className={foot} colSpan={3} /></tr></tfoot>
                    </table>
                    <datalist id="landed-charge-names">{CHARGE_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
                  </div>
                  <div className="border-t border-line px-3.5 py-2.5"><button className="btn sm" onClick={() => setCharges((cs) => [...cs, blankCharge()])}><Plus size={13} /> Add a charge</button></div>
                </Panel>
              </Section>

              <Section title="How the cost would be shared over the receipt" right={<Estimate />}>
                <Panel lit={false} className="overflow-hidden">
                  {!receiptDocId ? <div className="px-5 py-8 text-center text-[13px] text-muted">Choose the stock receipt. Its lines appear here with the share each would take.</div>
                    : receipt.error ? <ErrorBox message={receipt.error} retry={receipt.reload} />
                    : !receipt.data ? <Loading rows={3} label="Loading the receipt" />
                    : (
                      <div className="overflow-auto">
                        <table className="table dense" style={{ minWidth: 900 }}>
                          <thead><tr><th style={{ width: 36 }}>#</th><th style={{ minWidth: 200 }}>Item</th><th className="r">Received</th><th className="r">Still in stock</th><th className="r">Value received</th><th className="r" style={{ width: 120 }}>Weight</th><th className="r">Share</th><th className="r">Would join the stock</th><th className="r">Would be a cost at once</th></tr></thead>
                          <tbody>
                            {shares.map((s, i) => { const it = items.get(s.line.item_id); const lot = s.line.lot_id ? lotsById.get(s.line.lot_id) : undefined; return (
                              <tr key={s.line.id}>
                                <td className="num text-muted">{i + 1}</td>
                                <td><span className="num text-[12px] text-gold">{it?.sku ?? '—'}</span> <span className="text-ink">{it?.name ?? ''}</span>{lot && <div className="num text-[11px] text-muted">{lot.lot_no}</div>}</td>
                                <td className="r num">{fmtQty(s.line.qty)}</td>
                                <td className="r num">{s.remaining ? fmtQty(s.remaining) : <span className="text-muted">—</span>}</td>
                                <td className="r"><Money value={s.line.value} currency={currency} className="text-ink2" /></td>
                                <td><input className="field sm num text-right" inputMode="decimal" value={weightOf(s.line)} disabled={method !== 'weight'} onChange={(e) => { setTouched(true); setWeights((w) => ({ ...w, [s.line.id]: digits(e.target.value) })) }} aria-label={`Line ${i + 1} weight`} /></td>
                                <td className="r"><Money value={s.share} currency={currency} /></td>
                                <td className="r"><Money value={s.toStock} currency={currency} dim className="text-pos" /></td>
                                <td className="r"><Money value={s.expensed} currency={currency} dim className="text-warn" /></td>
                              </tr>
                            ) })}
                          </tbody>
                          <tfoot><tr>
                            <td className={foot} colSpan={6}><span className="text-[12.5px] font-medium text-ink2">Total</span></td>
                            <td className={cx(foot, 'r')}><Money value={sum(shares.map((s) => s.share))} currency={currency} className="font-medium text-ink" /></td>
                            <td className={cx(foot, 'r')}><Money value={sum(shares.map((s) => s.toStock))} currency={currency} /></td>
                            <td className={cx(foot, 'r')}><Money value={sum(shares.map((s) => s.expensed))} currency={currency} /></td>
                          </tr></tfoot>
                        </table>
                      </div>
                    )}
                  <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">An estimate from the stock as it stands now. Share = landed cost × the line's {method === 'value' ? 'value' : method} ÷ the total {method === 'value' ? 'value' : method} of the receipt. Would join the stock = share × quantity still in stock ÷ quantity received. The figures are worked out again when the document is proposed.</div>
                </Panel>
              </Section>
            </>
          ) : (
            <Panel lit={false} className="overflow-hidden">
              <div className="overflow-auto">
                <table className="table dense" style={{ minWidth: kind === 'adjustment' ? 1180 : incoming ? 1080 : 900 }}>
                  <thead><tr>
                    <th style={{ width: 36 }}>#</th><th style={{ minWidth: 230 }}>Item</th><th style={{ minWidth: 190 }}>Lot or serial number</th>
                    {showPurchase && !!purchaseDocId && <th style={{ minWidth: 190 }}>Line of the goods receipt</th>}
                    <th className="r" style={{ width: 130 }}>{kind === 'adjustment' ? 'Quantity (− lost, + found)' : 'Quantity'}</th>
                    {(incoming || kind === 'adjustment') && <th className="r" style={{ width: 130 }}>Cost of one</th>}
                    <th className="r" style={{ width: 130 }}>Value</th>
                    {kind === 'adjustment' && <th style={{ width: 190 }}>What happened</th>}
                    <th style={{ minWidth: 160 }}>Note</th><th style={{ width: 40 }} />
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const it = itemOf(r); const tracked = !!it && it.tracking !== 'none'; const into = inbound(r); const known = knownLot(r); const v = valueOf(r); const free = freeHere(r)
                      const over = !into && !!it && !!warehouseId && D(r.qty || 0).abs().gt(free)
                      return (
                        <tr key={r.key} style={{ verticalAlign: 'top' }}>
                          <td className="num text-muted">{i + 1}</td>
                          <td>
                            <select className="field sm" value={r.item_id} disabled={!companyId || !!r.hold_id} onChange={(e) => set(r.key, { item_id: e.target.value, lot_id: '', lot_no: '', mfg_date: '', expiry_date: '', source_line_id: '' })} aria-label={`Line ${i + 1} item`}>
                              <option value="">Choose…</option>{itemChoices(r).map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}
                            </select>
                            {it && <div className="mt-1 text-[11px] text-muted">in {it.unit} · {fmtQty(it.qty_on_hand)} in stock in the company{r.hold_id ? ' · from a condition noted' : ''}</div>}
                          </td>
                          <td>
                            {!it ? <span className="text-muted">—</span> : !tracked ? <span className="text-[12px] text-muted">Not tracked</span> : into ? (
                              <>
                                <input className="field sm num" value={r.lot_no} onChange={(e) => set(r.key, { lot_no: e.target.value })} placeholder={it.tracking === 'serial' ? 'Serial number' : 'Lot number'} aria-label={`Line ${i + 1} ${it.tracking === 'serial' ? 'serial number' : 'lot number'}`} />
                                {known ? <div className="mt-1 text-[11px] text-muted">On record{known.expiry_date ? ` · expires ${fmtDate(known.expiry_date)}` : ''}. Its dates are kept.</div>
                                  : it.tracking === 'lot' && (
                                    <div className="mt-1 grid grid-cols-2 gap-1">
                                      <label className="text-[10.5px] text-muted">Made<input type="date" className="field sm" value={r.mfg_date} onChange={(e) => set(r.key, { mfg_date: e.target.value })} aria-label={`Line ${i + 1} date of manufacture`} /></label>
                                      <label className="text-[10.5px] text-muted">Expires<input type="date" className="field sm" value={r.expiry_date} onChange={(e) => set(r.key, { expiry_date: e.target.value })} aria-label={`Line ${i + 1} expiry date`} /></label>
                                      {!r.expiry_date && it.shelf_life_days ? <div className="col-span-2 text-[10.5px] text-muted">Left empty, the expiry is {it.shelf_life_days} days after the date of manufacture, or after the date of the document.</div> : null}
                                    </div>
                                  )}
                              </>
                            ) : (
                              <select className="field sm" value={r.lot_id} disabled={!warehouseId || !!r.hold_id} onChange={(e) => set(r.key, { lot_id: e.target.value })} aria-label={`Line ${i + 1} ${it.tracking === 'serial' ? 'serial number' : 'lot'}`}>
                                <option value="">{warehouseId ? 'Choose…' : 'Choose the location first'}</option>
                                {lotChoices(r).map((x) => <option key={x.lot.id} value={x.lot.id}>{x.lot.lot_no} · {fmtQty(x.free)} free{x.lot.expiry_date ? ` · expires ${fmtDate(x.lot.expiry_date)}` : ''}</option>)}
                              </select>
                            )}
                          </td>
                          {showPurchase && !!purchaseDocId && (
                            <td>
                              <select className="field sm" value={r.source_line_id} onChange={(e) => set(r.key, { source_line_id: e.target.value })} aria-label={`Line ${i + 1} line of the goods receipt`}>
                                <option value="">Not linked</option>
                                {(gr.data?.lines ?? []).map((l) => <option key={l.id} value={l.id}>{l.line_no}. {l.description} · {fmtQty(l.quantity)}{l.unit ? ' ' + l.unit : ''}</option>)}
                              </select>
                              {kind === 'receipt' && sourceOf(r) && r.unit_cost.trim() === '' && <div className="mt-1 text-[11px] text-muted">Cost taken from the order: <Money value={costOf(r) ?? 0} currency={currency} /></div>}
                            </td>
                          )}
                          <td>
                            <input className={cx('field sm num text-right', over && 'border-warn')} inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, { qty: kind === 'adjustment' ? signed(e.target.value) : digits(e.target.value) })} aria-label={`Line ${i + 1} quantity`} />
                            {it && !into && warehouseId && (!tracked || r.lot_id) && <div className={cx('mt-1 text-right text-[11px]', over ? 'text-warn' : 'text-muted')}>{fmtQty(free)} {it.unit} free here</div>}
                          </td>
                          {(incoming || kind === 'adjustment') && (
                            <td>
                              {into ? <input className="field sm num text-right" inputMode="decimal" value={r.unit_cost} onChange={(e) => set(r.key, { unit_cost: digits(e.target.value) })} placeholder={kind === 'adjustment' ? 'as the stock beside it' : undefined} aria-label={`Line ${i + 1} cost of one`} />
                                : <div className="pt-1.5 text-right text-[11.5px] text-muted">worked out on proposing</div>}
                            </td>
                          )}
                          <td className="r">{v ? <span title={v.estimate ? 'ESTIMATE: quantity × the cost the item is carried at (value ÷ quantity). The engine works out the cost when the document is proposed.' : 'quantity × cost of one'}><Money value={v.value} currency={currency} className={v.estimate ? 'text-ink2' : 'text-ink'} />{v.estimate && <div className="text-[10.5px] text-cyan">estimate</div>}</span> : <span className="text-muted">—</span>}</td>
                          {kind === 'adjustment' && (
                            <td><select className="field sm" value={r.reason_code} onChange={(e) => set(r.key, { reason_code: e.target.value as StockReason | '' })} aria-label={`Line ${i + 1} what happened`}><option value="">Choose…</option>{REASONS.map((x) => <option key={x} value={x}>{REASON_LABEL[x]}</option>)}</select></td>
                          )}
                          <td><input className="field sm" value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} aria-label={`Line ${i + 1} note`} /></td>
                          <td><button className="btn ghost icon sm" disabled={rows.length <= 1} onClick={() => { setTouched(true); setRows((rs) => rs.filter((x) => x.key !== r.key)) }} aria-label="Remove line"><Trash2 size={13} /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-2.5">
                <button className="btn sm" disabled={!companyId} onClick={() => setRows((rs) => [...rs, blankRow()])}><Plus size={13} /> Add line</button>
                {outgoing && <span className="text-[11.5px] text-muted">Free here = in this location, less what is awaiting approval to leave. Lots that expire first are listed first.</span>}
                {kind === 'adjustment' && <span className="text-[11.5px] text-muted">A negative quantity is stock lost; a positive quantity is stock found. Stock found with no cost entered is valued as the stock beside it.</span>}
              </div>
            </Panel>
          )}

          {started && problems.length > 0 && <Note kind="warn"><div className="mb-1 font-medium text-ink">Before the document can be saved</div><ul className="m-0 list-disc pl-4">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}{problems.length > 8 && <li>and {problems.length - 8} more</li>}</ul></Note>}
          {started && beforeProposing.length > 0 && <Note kind="warn"><div className="mb-1 font-medium text-ink">Before it can be proposed (it can still be saved as a draft)</div><ul className="m-0 list-disc pl-4">{beforeProposing.slice(0, 8).map((p) => <li key={p}>{p}</li>)}{beforeProposing.length > 8 && <li>and {beforeProposing.length - 8} more</li>}</ul></Note>}
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="What proposing will propose">
            <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
              {kind === 'transfer' ? (
                <p className="m-0"><span className="font-medium text-ink">Nothing.</span> A transfer changes the place of stock and not its value. The quantities move at once, no accounting entry is made and nothing waits for approval.</p>
              ) : legs.length === 0 ? (
                <p className="m-0 text-muted">{landed ? 'Enter the charges and choose the receipt to see the entry.' : 'Enter the lines to see the entry. A document whose lines carry no value records quantities only: there is no entry to approve.'}</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-lg border border-line">
                    {legs.map((l) => (
                      <div key={l.side + l.ledger} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0">
                        <span className="min-w-0"><span className={cx('chip mr-2', l.side === 'Debit' ? 'cyan' : 'gold')}>{l.side}</span><span className="text-ink">{l.ledger}</span></span>
                        <span className="flex flex-none items-center gap-1.5">{l.estimate && <span className="text-[10.5px] text-cyan">estimate</span>}<Money value={l.amount} currency={currency} /></span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between"><span className="font-medium text-ink">Value of the entry</span><Money value={debitTotal} currency={currency} className="display text-[20px] text-gold" /></div>
                </>
              )}
              {kind !== 'transfer' && <p className="mb-0 mt-3 text-[11.5px] leading-relaxed text-muted">
                {legs.some((l) => l.estimate) ? 'Amounts marked estimate use the cost the stock is carried at today. The engine works out the cost when the document is proposed: from the receipts the goods came from, oldest first, or at the weighted average, as the item is valued. ' : ''}
                The entry reaches the ledger only when a second person approves it in the approval inbox. Until then the stock in the books is unchanged; a quantity going out is reserved so that it cannot be promised twice.
              </p>}
            </Panel>
          </Section>

          {doc && <Attachments companyId={doc.company_id} entity="stock_docs" entityId={doc.id} />}
          {doc && <History entity="stock_docs" entityId={doc.id} />}
          {!doc && <Panel className="p-4 text-[12px] text-muted" lit={false}>Evidence can be attached once the draft has been saved.</Panel>}
        </div>
      </div>

      <ReasonDialog open={cancelling} title={`Cancel ${doc?.doc_no ?? 'the document'}`} confirm="Cancel the document" danger onCancel={() => setCancelling(false)}
        body="The document is closed as cancelled and cannot be edited or proposed again. Nothing was posted for it, so nothing is reversed."
        onConfirm={(why) => { if (!doc) return; void act(() => api.cancelStockDoc(doc.id, why), 'Document cancelled').then(() => setCancelling(false)) }} />
    </div>
  )
}

// ====================================================================== the record
function DocView({ doc }: { doc: StockDoc }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const [cancelling, setCancelling] = useState(false)
  const co = [doc.company_id]
  const currency = companies.find((c) => c.id === doc.company_id)?.base_currency
  const manage = can('inventory.manage', doc.company_id)
  const mayPurchase = can('purchase.view', doc.company_id)

  const main = useAsync(async () => {
    const [warehouses, items, lots, moves, related, count] = await Promise.all([
      api.listWarehouses(co), api.listInvItems(co), api.listInvLots({ companyIds: co }), api.listInvMovements({ companyIds: co, docId: doc.id, limit: DOC_MOVES }),
      api.listStockDocs({ companyIds: co, kinds: ['receipt', 'landed_cost'] }), doc.count_id ? api.getStockCount(doc.count_id).then((c) => c, () => null) : Promise.resolve(null),
    ])
    return { warehouses, items, lots, moves: moves.filter((m) => m.doc_id === doc.id), related, count }
  }, [api, doc.id, doc.status])
  const purchase = useAsync<PurchaseDoc | null>(async () => (doc.purchase_doc_id && mayPurchase ? api.getPurchaseDoc(doc.purchase_doc_id).then((p) => p, () => null) : null), [api, doc.purchase_doc_id, mayPurchase])
  const invoice = useAsync<Invoice | null>(async () => {
    if (!doc.invoice_id || !(can('invoice.view', doc.company_id) || can('bill.view', doc.company_id))) return null
    return (await api.listInvoices({ companyIds: co })).find((i) => i.id === doc.invoice_id) ?? null
  }, [api, doc.invoice_id, doc.company_id])

  const d = main.data
  const items = useMemo(() => new Map((d?.items ?? []).map((i) => [i.id, i])), [d])
  const lots = useMemo(() => new Map((d?.lots ?? []).map((l) => [l.id, l])), [d])
  const whName = useMemo(() => warehouseName(d?.warehouses ?? []), [d])
  const lines = doc.lines ?? []
  const landed = doc.kind === 'landed_cost'
  const receiptDoc = d?.related.find((r) => r.id === doc.receipt_doc_id)
  const landedOnThis = (d?.related ?? []).filter((r) => r.kind === 'landed_cost' && r.receipt_doc_id === doc.id && r.status !== 'cancelled')
  const open = ['draft', 'rejected'].includes(doc.status)
  const noEntry = doc.status === 'posted' && !doc.journal_id
  const meta = doc.meta ?? {}
  const charges = meta.charges ?? []

  const columns: Column<StockDocLine>[] = [
    { key: 'no', header: '#', width: 44, render: (l) => <span className="num text-muted">{l.line_no}</span>, sort: (l) => l.line_no, csv: (l) => l.line_no },
    {
      key: 'item', header: 'Item', sort: (l) => items.get(l.item_id)?.sku ?? '', csv: (l) => `${items.get(l.item_id)?.sku ?? ''} ${items.get(l.item_id)?.name ?? ''}`.trim(),
      render: (l) => { const it = items.get(l.item_id); return <button className="text-left" onClick={() => nav('/inventory/items/' + l.item_id)}><span className="num text-[12px] text-gold">{it?.sku ?? '—'}</span> <span className="link">{it?.name ?? 'Open the item'}</span></button> },
    },
    {
      key: 'lot', header: 'Lot or serial', sort: (l) => (l.lot_id ? lots.get(l.lot_id)?.lot_no ?? '' : ''), csv: (l) => (l.lot_id ? lots.get(l.lot_id)?.lot_no ?? '' : ''),
      render: (l) => { const lot = l.lot_id ? lots.get(l.lot_id) : undefined; return !lot ? <span className="text-muted">—</span> : lot.is_serial ? <button className="link num text-[12.5px]" onClick={() => nav('/inventory/units/' + lot.id)}>{lot.lot_no}</button> : <div><span className="num text-[12.5px] text-ink2">{lot.lot_no}</span>{lot.expiry_date && <div className="text-[11px] text-muted">expires {fmtDate(lot.expiry_date)}</div>}</div> },
    },
    { key: 'qty', header: landed ? 'Quantity received' : 'Quantity', align: 'right', render: (l) => <span className={cx('num', D(l.qty).lt(0) ? 'text-neg' : 'text-ink')}>{fmtQty(l.qty)} <span className="text-[11px] text-muted">{items.get(l.item_id)?.unit ?? ''}</span></span>, sort: (l) => D(l.qty).toNumber(), csv: (l) => D(l.qty).toString() },
    ...(landed ? [
      { key: 'weight', header: 'Weight', align: 'right' as const, render: (l: StockDocLine) => (l.weight === null ? <span className="text-muted">—</span> : <span className="num text-ink2">{fmtQty(l.weight)}</span>), sort: (l: StockDocLine) => D(l.weight).toNumber(), csv: (l: StockDocLine) => (l.weight === null ? '' : D(l.weight).toString()) },
      { key: 'unit', header: 'Landed cost of one', align: 'right' as const, render: (l: StockDocLine) => (open ? <span className="text-muted">—</span> : <Money value={l.unit_cost} currency={currency} className="text-ink2" />), sort: (l: StockDocLine) => D(l.unit_cost).toNumber(), csv: (l: StockDocLine) => D(l.unit_cost).toString() },
      { key: 'share', header: 'Share of the landed cost', align: 'right' as const, render: (l: StockDocLine) => (open ? <span className="text-muted">—</span> : <Money value={D(l.value).plus(l.expensed)} currency={currency} />), sort: (l: StockDocLine) => D(l.value).plus(l.expensed).toNumber(), csv: (l: StockDocLine) => D(l.value).plus(l.expensed).toFixed(2) },
      { key: 'value', header: 'Joined the stock', align: 'right' as const, render: (l: StockDocLine) => (open ? <span className="text-muted">—</span> : <Money value={l.value} currency={currency} dim className="text-pos" />), sort: (l: StockDocLine) => D(l.value).toNumber(), csv: (l: StockDocLine) => D(l.value).toFixed(2) },
      { key: 'expensed', header: 'A cost at once: the goods had left', align: 'right' as const, render: (l: StockDocLine) => (open ? <span className="text-muted">—</span> : <Money value={l.expensed} currency={currency} dim className="text-warn" />), sort: (l: StockDocLine) => D(l.expensed).toNumber(), csv: (l: StockDocLine) => D(l.expensed).toFixed(2) },
    ] : [
      { key: 'unit', header: 'Cost of one, as the engine gave it', align: 'right' as const, render: (l: StockDocLine) => (D(l.unit_cost).isZero() && open ? <span className="text-muted" title="Worked out when the document is proposed">—</span> : <Money value={l.unit_cost} currency={currency} className="text-ink2" />), sort: (l: StockDocLine) => D(l.unit_cost).toNumber(), csv: (l: StockDocLine) => D(l.unit_cost).toString() },
      { key: 'value', header: 'Value', align: 'right' as const, render: (l: StockDocLine) => (D(l.value).isZero() && open ? <span className="text-muted">—</span> : <Money value={l.value} currency={currency} />), sort: (l: StockDocLine) => D(l.value).toNumber(), csv: (l: StockDocLine) => D(l.value).toFixed(2) },
    ]),
    ...(doc.kind === 'adjustment' ? [{ key: 'reason', header: 'What happened', render: (l: StockDocLine) => (l.reason_code ? <span className="chip">{REASON_LABEL[l.reason_code]}</span> : <span className="text-muted">—</span>), sort: (l: StockDocLine) => l.reason_code ?? '', csv: (l: StockDocLine) => (l.reason_code ? REASON_LABEL[l.reason_code] : '') }] : []),
    { key: 'note', header: 'Note', render: (l) => <span className="text-[12.5px] text-ink2">{l.note ?? '—'}{l.hold_id ? <span className="chip ml-1.5 warn">from a condition noted</span> : null}</span>, csv: (l) => l.note ?? '' },
  ]
  const moveColumns: Column<InvMovement>[] = [
    { key: 'kind', header: 'Movement', render: (m) => <span className="text-ink">{human(m.kind)}</span>, csv: (m) => human(m.kind) },
    { key: 'item', header: 'Item', render: (m) => <span className="text-[12.5px] text-ink2">{items.get(m.item_id)?.sku ?? '—'}{m.lot_id ? ` · ${lots.get(m.lot_id)?.lot_no ?? ''}` : ''}</span>, csv: (m) => items.get(m.item_id)?.sku ?? '' },
    { key: 'place', header: 'Location', render: (m) => <span className="text-[12.5px] text-ink2">{whName(m.warehouse_id)}</span>, csv: (m) => whName(m.warehouse_id) },
    { key: 'qty', header: 'Quantity', align: 'right', render: (m) => (D(m.qty).isZero() ? <span className="text-muted">—</span> : <span className={cx('num', D(m.qty).lt(0) ? 'text-neg' : 'text-pos')}>{D(m.qty).gt(0) ? '+' : ''}{fmtQty(m.qty)}</span>), csv: (m) => D(m.qty).toString() },
    { key: 'value', header: 'Value', align: 'right', render: (m) => <Money value={m.value} currency={currency} sign colored />, csv: (m) => D(m.value).toFixed(2) },
    { key: 'status', header: 'In the stock ledger', render: (m) => <StatusChip status={m.status} label={m.status === 'proposed' ? 'awaiting approval' : m.status} />, csv: (m) => (m.status === 'proposed' ? 'awaiting approval' : m.status) },
  ]

  return (
    <div>
      <PageHeader eyebrow={`Inventory · ${DOC_KIND_LABEL[doc.kind]}`} title={doc.doc_no}
        subtitle={<>{companyName(doc.company_id)} · {fmtDate(doc.doc_date)}{doc.reason ? ` · ${doc.reason}` : ''}<DemoTag className="ml-2" /></>}
        actions={<>
          <Back />
          {doc.journal_id && <button className="btn" onClick={() => nav('/journals/' + doc.journal_id)}><ExternalLink size={14} /> Open the entry</button>}
          {doc.kind === 'receipt' && doc.status === 'posted' && <button className="btn" disabled={!manage} title={manage ? 'Adds freight, duty and other charges to the cost of these goods' : NO_MANAGE} onClick={() => nav(`/inventory/docs/new?kind=landed_cost&company=${doc.company_id}&receipt=${doc.id}`)}><Truck size={14} /> Add landed cost</button>}
          {open && <button className="btn danger" disabled={!manage || busy} title={manage ? undefined : NO_MANAGE} onClick={() => setCancelling(true)}><Ban size={15} /> Cancel the document</button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={doc.status} label={doc.kind === 'transfer' && doc.status === 'posted' ? 'recorded — no entry needed' : docStatusLabel(doc.status)} />
        <span className="chip">{DOC_KIND_LABEL[doc.kind]}</span>
        {doc.count_id && <span className="chip cyan">from a stock count</span>}
        {landed && <span className="chip">shared by {meta.method ?? 'value'}</span>}
      </div>

      {doc.status === 'proposed' && <Note className="mb-4">The accounting entry of this document is awaiting approval. Nothing has reached the ledger and the stock in the books is unchanged. {lines.some((l) => D(l.qty).lt(0)) || ['issue', 'return_out'].includes(doc.kind) ? 'The quantity going out is reserved, so that it cannot be promised twice.' : ''} A second person approves or rejects the entry in the approval inbox.</Note>}
      {doc.status === 'posted' && doc.kind === 'transfer' && <Note kind="good" className="mb-4">The transfer is recorded. The goods changed place and not value, so no accounting entry was made and none was needed.</Note>}
      {noEntry && doc.kind !== 'transfer' && <Note kind="good" className="mb-4">The quantities are recorded. The document carries no value, so no accounting entry exists for it.</Note>}
      {doc.status === 'posted' && doc.journal_id && <Note kind="good" className="mb-4">The accounting entry was approved and posted. The stock ledger and the books were changed together.</Note>}
      {doc.status === 'rejected' && <Note kind="warn" className="mb-4">The accounting entry was rejected. Nothing was posted, and the stock the document had reserved is free again.{doc.count_id ? ' The adjustment belongs to a stock count: it is proposed again from the count.' : manage ? '' : ' A person who manages inventory can correct the document and propose it again.'}</Note>}
      {doc.status === 'draft' && <Note className="mb-4">This document is a draft. It has changed neither stock nor books.{manage ? '' : ' Your role does not include inventory.manage, so it is shown as a record.'}</Note>}
      {doc.status === 'reversed' && <Note kind="warn" className="mb-4">The accounting entry of this document was posted and later reversed. The stock ledger was brought back with it.</Note>}
      {doc.status === 'cancelled' && <Note className="mb-4">This document was cancelled before anything was posted for it.</Note>}

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={5} label="Loading the document" /></Panel>}

      {d && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={landed ? 'Landed cost' : doc.kind === 'transfer' ? 'Value moved (unchanged)' : 'Value'} value={doc.total_value} currency={currency} tone="gold"
              sub={open && !landed && !['receipt', 'return_in'].includes(doc.kind) ? 'worked out when the document is proposed' : doc.status === 'proposed' ? 'proposed — awaiting approval' : doc.status === 'posted' ? 'as posted' : undefined} />
            <Tile label="Lines" sub={`${new Set(lines.map((l) => l.item_id)).size} item${new Set(lines.map((l) => l.item_id)).size === 1 ? '' : 's'}`}><span className="num">{lines.length}</span></Tile>
            <Tile label={doc.kind === 'transfer' ? 'From' : 'Location'} sub={doc.to_warehouse_id ? `to ${whName(doc.to_warehouse_id)}` : undefined}><span className="text-[15px]">{whName(doc.warehouse_id)}</span></Tile>
            {landed ? <Stat label="Of which a cost at once" value={open ? 0 : sum(lines.map((l) => l.expensed))} currency={currency} tone={!open && sum(lines.map((l) => l.expensed)).gt(0) ? 'warn' : undefined} sub={open ? 'worked out when the document is proposed' : 'the share of goods that had already left stock'} />
              : <Tile label="Date" sub={`prepared ${fmtDateTime(doc.created_at)}`}><span className="num text-[18px]">{fmtDate(doc.doc_date)}</span></Tile>}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
            <div className="min-w-0 space-y-4">
              <Section title={landed ? 'How the landed cost was shared' : 'Lines'}>
                <Panel lit={false}>
                  <DataTable columns={columns} rows={lines} rowKey={(l) => l.id} pageSize={60} exportName={`stock-document-${doc.doc_no}`}
                    footer={<tr>
                      <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={landed ? 6 : 5}>Total</td>
                      {landed ? <>
                        <td className={cx(foot, 'r')}><Money value={open ? doc.total_value : sum(lines.map((l) => D(l.value).plus(l.expensed)))} currency={currency} className="font-medium text-ink" /></td>
                        <td className={cx(foot, 'r')}>{open ? null : <Money value={sum(lines.map((l) => l.value))} currency={currency} />}</td>
                        <td className={cx(foot, 'r')}>{open ? null : <Money value={sum(lines.map((l) => l.expensed))} currency={currency} />}</td>
                      </> : <td className={cx(foot, 'r')}><Money value={doc.total_value} currency={currency} className="font-medium text-ink" /></td>}
                      <td className={foot} colSpan={doc.kind === 'adjustment' ? 2 : 1} />
                    </tr>}
                    empty={{ title: 'No line', body: 'This document carries no line.' }} />
                  {landed && !open && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">Share = landed cost × the line's {meta.method ?? 'value'} ÷ the total of the receipt. Joined the stock = share × quantity still in stock when proposed ÷ quantity received. The rest was a cost at once, because those goods had already left.</div>}
                  {!landed && !open && ['issue', 'return_out', 'adjustment', 'transfer'].includes(doc.kind) && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">The cost of goods going out was worked out by the engine when the document was proposed: from the receipts they came from, oldest first, or at the weighted average, as each item is valued.</div>}
                </Panel>
              </Section>

              {landed && charges.length > 0 && (
                <Section title="Charges">
                  <Panel className="p-1.5" lit={false}>
                    {charges.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[12.5px]">
                        <span className="min-w-0"><span className="text-ink">{c.name}</span><span className="block text-[11.5px] text-muted">credited to {c.account_id ? accountName(c.account_id) : 'the ledger mapped as “Landed cost — clearing”'}{c.party_id ? ` · owed to ${partyName(c.party_id)}` : ''}</span></span>
                        <Money value={c.amount} currency={currency} />
                      </div>
                    ))}
                  </Panel>
                </Section>
              )}

              {d.moves.length > 0 && (
                <Section title="What it did in the stock ledger">
                  <Panel lit={false}><DataTable columns={moveColumns} rows={d.moves} rowKey={(m) => m.id} pageSize={60} exportName={`stock-movements-${doc.doc_no}`} />{d.moves.length >= DOC_MOVES && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-warn">Only {DOC_MOVES.toLocaleString()} movements of this document are listed; it has more.</div>}</Panel>
                </Section>
              )}

              {landedOnThis.length > 0 && (
                <Section title="Landed cost added to this receipt">
                  <Panel className="p-1.5" lit={false}>
                    {landedOnThis.map((l) => (
                      <button key={l.id} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface2" onClick={() => nav('/inventory/docs/' + l.id)}>
                        <span><span className="num text-gold">{l.doc_no}</span> <span className="text-muted">· {fmtDate(l.doc_date)}{l.reason ? ` · ${l.reason}` : ''}</span></span>
                        <span className="flex flex-none items-center gap-2"><StatusChip status={l.status} label={docStatusLabel(l.status)} /><Money value={l.total_value} currency={currency} /></span>
                      </button>
                    ))}
                  </Panel>
                </Section>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              <Section title="Facts">
                <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
                  <Fact label="Company">{companyName(doc.company_id)}</Fact>
                  <Fact label="Date"><span className="num">{fmtDate(doc.doc_date)}</span></Fact>
                  <Fact label={doc.kind === 'transfer' ? 'From location' : 'Location'}>{whName(doc.warehouse_id)}</Fact>
                  {doc.to_warehouse_id && <Fact label="To location">{whName(doc.to_warehouse_id)}</Fact>}
                  {doc.party_id && <Fact label="Party"><button className="link" onClick={() => nav('/parties/' + doc.party_id)}>{partyName(doc.party_id)}</button></Fact>}
                  {doc.purchase_doc_id && <Fact label="Goods receipt">{mayPurchase ? <button className="link num" onClick={() => nav('/purchasing/' + doc.purchase_doc_id)}>{purchase.data?.doc_no ?? 'Open'}</button> : 'Linked. Your role does not read purchasing documents.'}</Fact>}
                  {doc.invoice_id && <Fact label="Invoice or bill">{invoice.data ? <button className="link num" onClick={() => nav((invoice.data!.doc_type === 'purchase_bill' || invoice.data!.doc_type === 'debit_note' ? '/bills/' : '/invoices/') + doc.invoice_id)}>{invoice.data.doc_no ?? 'Open'}</button> : 'Linked. It is not among the documents your role reads.'}</Fact>}
                  {doc.receipt_doc_id && <Fact label="Stock receipt the cost was added to"><button className="link num" onClick={() => nav('/inventory/docs/' + doc.receipt_doc_id)}>{receiptDoc?.doc_no ?? 'Open'}</button></Fact>}
                  {doc.count_id && <Fact label="Stock count"><button className="link num" onClick={() => nav('/inventory/counts/' + doc.count_id)}>{d.count?.count_no ?? 'Open'}</button></Fact>}
                  {doc.counter_account_id && <Fact label="Other ledger of the entry" className="sm:col-span-2">{accountName(doc.counter_account_id)}</Fact>}
                  {landed && <Fact label="Shared">by {meta.method ?? 'value'}</Fact>}
                  <Fact label="Prepared"><span className="num">{fmtDateTime(doc.created_at)}</span></Fact>
                  <Fact label="Reason" className="sm:col-span-2">{doc.reason ?? 'None recorded'}</Fact>
                </Panel>
              </Section>

              <ProposedEntries companyIds={[doc.company_id]} sourceId={doc.id} sources={['stock_doc']} />
              <Attachments companyId={doc.company_id} entity="stock_docs" entityId={doc.id} readOnly={!manage} />
              <History entity="stock_docs" entityId={doc.id} />
            </div>
          </div>
        </>
      )}

      <ReasonDialog open={cancelling} title={`Cancel ${doc.doc_no}`} confirm="Cancel the document" danger onCancel={() => setCancelling(false)}
        body={<>The document is closed as cancelled. Nothing was posted for it, so nothing is reversed.{doc.count_id ? ' The stock count it belongs to returns to reviewed, and its adjustment can be proposed again from the count.' : ''}</>}
        onConfirm={(why) => void act(() => api.cancelStockDoc(doc.id, why), 'Document cancelled').then(() => setCancelling(false))} />
    </div>
  )
}
