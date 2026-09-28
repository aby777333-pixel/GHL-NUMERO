// NUMERO REALITY — the books saying something happened is not enough.
//
// Five realities are set against each other:
//   DOCUMENT   what the order, the invoice, the agreement say
//   OPERATION  what was actually ordered, delivered, received, worked
//   ACCOUNTING what was posted to the books
//   CASH       what actually entered or left the bank and the cash box
//   PHYSICAL   what actually exists: stock, assets, cash counted
//
// This file is pure calculation over records the person may read. It finds where
// the realities differ and says so in plain words. It does not decide what the
// difference means: that is for a person, in a case. It never uses the word fraud.

import Decimal from 'decimal.js'
import { D, ZERO } from '@/lib/money'
import { daysBetween } from '@/lib/dates'
import type { Account, BankAccount, BankTxn, ID, Invoice, LedgerBalanceRow, Payment } from './types'
import type { Advance, AssetEvent, CashBox, CashCount, ExpenseClaim, FixedAsset, PurchaseDoc } from './opsTypes'
import type { CaseLink, InvCategory, InvItem, StockCount, StockDoc, VerificationLine, VerificationRun } from './p3Types'

export type Dimension = 'document' | 'operation' | 'accounting' | 'cash' | 'physical'
export const DIMENSIONS: { key: Dimension; label: string; question: string }[] = [
  { key: 'document', label: 'Document', question: 'What do the order, the invoice and the agreement say?' },
  { key: 'operation', label: 'Operation', question: 'What was actually delivered, received or done?' },
  { key: 'accounting', label: 'Accounting', question: 'What was posted to the books?' },
  { key: 'cash', label: 'Cash', question: 'What actually entered or left the bank and the cash box?' },
  { key: 'physical', label: 'Physical', question: 'What actually exists?' },
]
export type Chain = 'purchase' | 'sale' | 'advance' | 'asset' | 'cash' | 'stock' | 'bank' | 'verification'

export interface Reading { value: number | null; unit: 'amount' | 'quantity'; says: string }
export interface Finding {
  /** the same difference, found again, has the same key */
  key: string
  company_id: ID
  chain: Chain
  title: string
  party_id: ID | null
  readings: Partial<Record<Dimension, Reading>>
  /** the realities that do not agree with the others */
  differs: Dimension[]
  /** the value at stake, in the currency of the company */
  amount: number
  material: boolean
  explanation: string
  links: CaseLink[]
  date: string
}
export interface HealthRow { dimension: Dimension; label: string; checked: number; agree: number; differ: number; method: string }

export interface RealityInput {
  asOf: string
  /** a difference at or below this is reported, and marked as below the threshold */
  materiality: Record<ID, number>
  /** differences smaller than this are rounding, not differences */
  tolerance?: number
  purchaseDocs?: PurchaseDoc[]
  invoices?: Invoice[]
  payments?: Payment[]
  stockDocs?: StockDoc[]
  advances?: Advance[]
  claims?: ExpenseClaim[]
  assets?: FixedAsset[]
  assetEvents?: AssetEvent[]
  cashBoxes?: CashBox[]
  cashCounts?: CashCount[]
  ledger?: LedgerBalanceRow[]
  accounts?: Account[]
  invItems?: InvItem[]
  invCategories?: InvCategory[]
  stockCounts?: StockCount[]
  bankAccounts?: BankAccount[]
  bankTxns?: BankTxn[]
  verifications?: VerificationRun[]
}

const n = (v: Decimal.Value | null | undefined) => D(v ?? 0).toNumber()
const money = (v: number) => (Math.round(v * 100) / 100).toLocaleString('en-IN')
const material = (i: RealityInput, company: ID, amount: number) => Math.abs(amount) > (i.materiality[company] ?? 0)

/**
 * Every difference the records show, the largest amount first. Each amount is in the currency of its own company:
 * across companies that keep their books in different currencies the order is that of the figures, not of their worth.
 */
export function findDifferences(i: RealityInput): Finding[] {
  return [...purchases(i), ...sales(i), ...advances(i), ...assets(i), ...cash(i), ...stock(i), ...bank(i), ...sheets(i)].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}
const PO_OPEN = (d: PurchaseDoc) => d.kind === 'purchase_order' && !['draft', 'submitted', 'rejected', 'cancelled'].includes(d.status)
/** the orders whose goods are expected in stock: goods were received, in a company that keeps stock */
function ordersWithGoods(i: RealityInput): PurchaseDoc[] {
  const docs = i.purchaseDocs ?? []
  const keeps = new Set((i.stockDocs ?? []).filter((s) => s.kind === 'receipt').map((s) => s.company_id))
  return docs.filter((d) => PO_OPEN(d) && keeps.has(d.company_id) && docs.some((r) => r.parent_id === d.id && r.kind === 'goods_receipt' && r.status === 'confirmed'))
}
/** the last completed sheet of each subject and scope. Assets are carried by their own chain, asset by asset. */
export function lastSheets(i: Pick<RealityInput, 'verifications'>): VerificationRun[] {
  const last = new Map<string, VerificationRun>()
  for (const r of i.verifications ?? []) {
    if (r.status !== 'completed' || r.subject === 'assets') continue
    const k = [r.company_id, r.subject, JSON.stringify(r.scope ?? {})].join('|')
    const cur = last.get(k)
    if (!cur || r.run_date > cur.run_date || (r.run_date === cur.run_date && r.created_at > cur.created_at)) last.set(k, r)
  }
  return [...last.values()]
}

// ------------------------------------------------------------------ purchase: order ↔ receipt ↔ bill ↔ stock ↔ payment
function purchases(i: RealityInput): Finding[] {
  const tol = i.tolerance ?? 1
  const docs = i.purchaseDocs ?? []
  const out: Finding[] = []
  for (const po of docs.filter(PO_OPEN)) {
    const receipts = docs.filter((d) => d.parent_id === po.id && ['goods_receipt', 'service_receipt'].includes(d.kind) && d.status === 'confirmed')
    const bills = (i.invoices ?? []).filter((b) => b.po_id === po.id && b.doc_type === 'purchase_bill' && b.status !== 'cancelled' && b.status !== 'draft')
    const fx = n(po.fx_rate) || 1
    const ordered = n(po.subtotal) * fx
    const orderedQty = (po.lines ?? []).reduce((s, l) => s + n(l.quantity), 0)
    const received = receipts.reduce((s, r) => s + n(r.subtotal) * (n(r.fx_rate) || 1), 0)
    const receivedQty = receipts.reduce((s, r) => s + (r.lines ?? []).reduce((t, l) => t + n(l.quantity), 0), 0)
    const billed = bills.reduce((s, b) => s + n(b.subtotal) * (n(b.fx_rate) || 1), 0)
    const posted = bills.filter((b) => b.journal_id).reduce((s, b) => s + n(b.subtotal) * (n(b.fx_rate) || 1), 0)
    const paidGross = bills.reduce((s, b) => s + n(b.amount_settled) * (n(b.fx_rate) || 1), 0)
    // what was paid is compared before tax, in the proportion the bills carry
    const gross = bills.reduce((s, b) => s + n(b.total) * (n(b.fx_rate) || 1), 0)
    const paid = gross > 0 ? (paidGross * billed) / gross : 0
    const goods = receipts.filter((r) => r.kind === 'goods_receipt')
    const stockDocs = (i.stockDocs ?? []).filter((s) => s.kind === 'receipt' && s.status === 'posted' && goods.some((g) => g.id === s.purchase_doc_id))
    const inStock = stockDocs.reduce((s, x) => s + n(x.total_value), 0)
    const keepsStock = (i.stockDocs ?? []).some((s) => s.company_id === po.company_id && s.kind === 'receipt')
    const goodsReceived = goods.reduce((s, r) => s + n(r.subtotal) * (n(r.fx_rate) || 1), 0)

    const readings: Finding['readings'] = {
      document: { value: ordered, unit: 'amount', says: `Order ${po.doc_no} is for ${money(ordered)}${orderedQty ? ` (${orderedQty} units)` : ''}; bills linked to it come to ${money(billed)}.` },
      operation: { value: received, unit: 'amount', says: receipts.length ? `${receipts.length} receipt(s) confirm ${money(received)}${receivedQty ? ` (${receivedQty} units)` : ''}.` : 'No receipt of goods or service is confirmed.' },
      accounting: { value: posted, unit: 'amount', says: `Bills posted to the books come to ${money(posted)}.` },
      cash: { value: paid, unit: 'amount', says: `Payments recorded against those bills come to ${money(paid)} before tax.` },
    }
    if (keepsStock && goods.length) readings.physical = { value: inStock, unit: 'amount', says: `${money(inStock)} of the goods received has been taken into stock.` }

    const differs: Dimension[] = []
    const why: string[] = []
    if (billed - received > tol) { differs.push('operation'); why.push(`${money(billed - received)} has been billed for what no receipt confirms`) }
    if (paid - received > tol) { if (!differs.includes('operation')) differs.push('operation'); differs.push('cash'); why.push(`${money(paid - received)} has been paid for what no receipt confirms`) }
    if (billed - ordered > tol) { differs.push('document'); why.push(`the bills exceed the order by ${money(billed - ordered)}`) }
    if (Math.abs(billed - posted) > tol) { differs.push('accounting'); why.push(`${money(billed - posted)} of the bills is not yet in the books`) }
    if (readings.physical && goodsReceived - inStock > tol) { differs.push('physical'); why.push(`${money(goodsReceived - inStock)} of goods received has not been taken into stock`) }
    if (!differs.length) continue
    const amount = Math.max(billed - received, paid - received, billed - ordered, Math.abs(billed - posted), readings.physical ? goodsReceived - inStock : 0)
    out.push({
      key: `purchase:${po.id}`, company_id: po.company_id, chain: 'purchase', party_id: po.party_id, date: po.doc_date, readings, differs: [...new Set(differs)], amount, material: material(i, po.company_id, amount),
      title: `Order ${po.doc_no}: the ${[...new Set(differs)].join(', ')} ${differs.length > 1 ? 'do' : 'does'} not agree`,
      explanation: `For order ${po.doc_no}, ${why.join('; ')}. This may be goods in transit, a receipt not yet entered, a bill entered early, or an error. It is for a person to establish.`,
      links: [{ entity: 'purchase_docs', entity_id: po.id, label: po.doc_no }, ...receipts.map((r) => ({ entity: 'purchase_docs', entity_id: r.id, label: r.doc_no })), ...bills.map((b) => ({ entity: 'invoices', entity_id: b.id, label: b.doc_no ?? 'Bill' })),
        ...stockDocs.map((s) => ({ entity: 'stock_docs', entity_id: s.id, label: s.doc_no }))],
    })
  }
  return out
}

// ------------------------------------------------------------------ sale: invoice ↔ books ↔ money received
function sales(i: RealityInput): Finding[] {
  const out: Finding[] = []
  const paidBy = new Map<ID, number>()
  for (const p of i.payments ?? []) if (p.status === 'posted') for (const a of p.allocations ?? []) paidBy.set(a.invoice_id, (paidBy.get(a.invoice_id) ?? 0) + n(a.amount))
  const anyAllocations = (i.payments ?? []).some((p) => (p.allocations ?? []).length > 0)
  for (const inv of (i.invoices ?? []).filter((x) => x.doc_type === 'sales_invoice' && x.status !== 'draft' && x.status !== 'cancelled')) {
    // an invoice in another currency is stated at its own rate, in the currency of the company
    const fx = n(inv.fx_rate) || 1
    const total = n(inv.total) * fx; const settled = n(inv.amount_settled) * fx
    const differs: Dimension[] = []; const why: string[] = []
    if (!inv.journal_id) { differs.push('accounting'); why.push('the invoice is approved but no entry for it is in the books') }
    const received = paidBy.get(inv.id)
    const receipts = received === undefined ? undefined : received * fx
    if (anyAllocations && receipts !== undefined && Math.abs(receipts - settled) > (i.tolerance ?? 1)) { differs.push('cash'); why.push(`the invoice shows ${money(settled)} settled, and the receipts recorded against it come to ${money(receipts)}`) }
    if (settled - total > (i.tolerance ?? 1)) { differs.push('document'); why.push(`${money(settled - total)} more has been settled than the invoice is for`) }
    if (!differs.length) continue
    const amount = Math.max(Math.abs((receipts ?? settled) - settled), settled - total, inv.journal_id ? 0 : total)
    out.push({
      key: `sale:${inv.id}`, company_id: inv.company_id, chain: 'sale', party_id: inv.party_id, date: inv.doc_date, differs, amount, material: material(i, inv.company_id, amount),
      readings: {
        document: { value: total, unit: 'amount', says: `Invoice ${inv.doc_no ?? ''} is for ${money(total)}.` },
        accounting: { value: inv.journal_id ? total : 0, unit: 'amount', says: inv.journal_id ? 'Its entry is in the books.' : 'No entry for it is in the books.' },
        cash: { value: receipts ?? settled, unit: 'amount', says: `${money(receipts ?? settled)} is recorded as received against it.` },
      },
      title: `Invoice ${inv.doc_no ?? ''}: the ${differs.join(', ')} ${differs.length > 1 ? 'do' : 'does'} not agree`,
      explanation: `For invoice ${inv.doc_no ?? ''}, ${why.join('; ')}. It is for a person to establish why.`,
      links: [{ entity: 'invoices', entity_id: inv.id, label: inv.doc_no ?? 'Invoice' }],
    })
  }
  return out
}

// ------------------------------------------------------------------ advance: approval ↔ money released ↔ evidence ↔ use ↔ books ↔ return
function advances(i: RealityInput): Finding[] {
  const out: Finding[] = []
  for (const a of i.advances ?? []) {
    const approved = n(a.approved_amount); const released = n(a.released_amount); const settled = n(a.settled_amount); const returned = n(a.returned_amount)
    if (released <= 0) continue
    const held = released - settled - returned
    const claims = (i.claims ?? []).filter((c) => c.advance_id === a.id && !['draft', 'rejected', 'cancelled'].includes(c.status))
    const lines = claims.flatMap((c) => c.lines ?? [])
    const noEvidence = lines.filter((l) => !l.has_receipt).reduce((s, l) => s + n(l.amount), 0)
    const days = a.expected_settlement_date ? daysBetween(a.expected_settlement_date, i.asOf) : 0
    // with no date set, thirty days from the release is taken as long enough
    const undated = !a.expected_settlement_date && a.released_on ? daysBetween(a.released_on, i.asOf) : 0
    const differs: Dimension[] = []; const why: string[] = []
    if (released - approved > (i.tolerance ?? 1)) { differs.push('document'); why.push(`${money(released - approved)} more was released than was approved`) }
    if (noEvidence > 0) { differs.push('operation'); why.push(`${money(noEvidence)} of what was claimed carries no receipt`) }
    if (held > (i.tolerance ?? 1) && days > 0) { differs.push('cash'); why.push(`${money(held)} is still held ${days} day(s) after the date it was to be settled`) }
    else if (held > (i.tolerance ?? 1) && undated > 30) { differs.push('cash'); why.push(`${money(held)} is still held ${undated} day(s) after it was released, and no date was set for settling it`) }
    if (held < -(i.tolerance ?? 1)) { differs.push('accounting'); why.push(`${money(-held)} more has been settled and returned than was released`) }
    if (!differs.length) continue
    const amount = Math.max(released - approved, noEvidence, held > 0 && (days > 0 || undated > 30) ? held : 0, -held)
    out.push({
      key: `advance:${a.id}`, company_id: a.company_id, chain: 'advance', party_id: a.recipient_party_id, date: a.released_on ?? a.created_at.slice(0, 10), differs, amount, material: material(i, a.company_id, amount),
      readings: {
        document: { value: approved, unit: 'amount', says: `${money(approved)} was approved.` },
        cash: { value: released - returned, unit: 'amount', says: `${money(released)} was released and ${money(returned)} has come back.` },
        operation: { value: lines.reduce((s, l) => s + n(l.amount), 0), unit: 'amount', says: lines.length ? `${lines.length} expense line(s) are claimed against it, ${lines.filter((l) => l.has_receipt).length} with a receipt.` : 'Nothing has been claimed against it.' },
        accounting: { value: settled, unit: 'amount', says: `${money(settled)} has been recognised as expense through approved claims.` },
      },
      title: `Advance ${a.advance_no}: the ${differs.join(', ')} ${differs.length > 1 ? 'do' : 'does'} not agree`,
      explanation: `For advance ${a.advance_no}, ${why.join('; ')}. These are facts from the records, stated without a conclusion.`,
      links: [{ entity: 'advances', entity_id: a.id, label: a.advance_no }, ...claims.map((c) => ({ entity: 'expense_claims', entity_id: c.id, label: c.claim_no }))],
    })
  }
  return out
}

// ------------------------------------------------------------------ assets: register ↔ what was found
function assets(i: RealityInput): Finding[] {
  const out: Finding[] = []
  const last = new Map<ID, AssetEvent>()
  for (const e of i.assetEvents ?? []) if (e.event_type === 'verification' && (!last.has(e.asset_id) || e.event_date > last.get(e.asset_id)!.event_date)) last.set(e.asset_id, e)
  for (const a of (i.assets ?? []).filter((x) => x.status === 'active')) {
    const e = last.get(a.id)
    const result = (e?.detail as { result?: string } | undefined)?.result
    if (!e || !result || result === 'located') continue
    const value = n(a.cost) - n(a.accumulated_depreciation)
    out.push({
      key: `asset:${a.id}:${e.id}`, company_id: a.company_id, chain: 'asset', party_id: a.custodian_party_id ?? null, date: e.event_date, differs: ['physical'], amount: value, material: material(i, a.company_id, value),
      readings: {
        accounting: { value, unit: 'amount', says: `The register carries ${a.asset_no} as active, at a book value of ${money(value)}.` },
        physical: { value: result === 'missing' || result === 'disposed' ? 0 : value, unit: 'amount', says: `Verification of ${e.event_date} reported it as ${result}.` },
      },
      title: `Asset ${a.asset_no}: the books say active, the verification says ${result}`,
      explanation: `${a.asset_no} · ${a.name} is in the register as active. The last physical verification, on ${e.event_date}, reported it as ${result}. The books have not been changed.`,
      links: [{ entity: 'fixed_assets', entity_id: a.id, label: a.asset_no }],
    })
  }
  return out
}

// ------------------------------------------------------------------ cash boxes: books ↔ what was counted
function cash(i: RealityInput): Finding[] {
  const out: Finding[] = []
  for (const b of i.cashBoxes ?? []) {
    const c = (i.cashCounts ?? []).filter((x) => x.box_id === b.id).sort((x, y) => y.count_date.localeCompare(x.count_date) || y.created_at.localeCompare(x.created_at))[0]
    if (!c) continue
    const diff = n(c.difference)
    if (Math.abs(diff) <= (i.tolerance ?? 1)) continue
    out.push({
      key: `cash:${b.id}:${c.id}`, company_id: b.company_id, chain: 'cash', party_id: b.custodian_party_id ?? null, date: c.count_date, differs: ['physical'], amount: Math.abs(diff), material: material(i, b.company_id, diff),
      readings: {
        accounting: { value: n(c.book_balance), unit: 'amount', says: `The books showed ${money(n(c.book_balance))} in ${b.name} on ${c.count_date}.` },
        physical: { value: n(c.counted_total), unit: 'amount', says: `${money(n(c.counted_total))} was counted.` },
      },
      title: `${b.name}: ${money(Math.abs(diff))} ${diff < 0 ? 'short of' : 'over'} the books`,
      explanation: `The count of ${c.count_date} found ${money(n(c.counted_total))} against ${money(n(c.book_balance))} in the books. Vouchers not yet entered are the usual reason; it is for a person to establish.`,
      links: [{ entity: 'cash_boxes', entity_id: b.id, label: b.name }],
    })
  }
  return out
}

// ------------------------------------------------------------------ stock: stock ledger ↔ general ledger
function stock(i: RealityInput): Finding[] {
  const out: Finding[] = []
  const byLedger = new Map<ID, { company: ID; value: Decimal }>()
  for (const c of i.invCategories ?? []) {
    const v = (i.invItems ?? []).filter((x) => x.category_id === c.id).reduce((s, x) => s.plus(x.value_on_hand), ZERO)
    const cur = byLedger.get(c.inventory_account_id)
    byLedger.set(c.inventory_account_id, { company: c.company_id, value: (cur?.value ?? ZERO).plus(v) })
  }
  for (const [accountId, s] of byLedger) {
    const r = (i.ledger ?? []).find((x) => x.account_id === accountId)
    const gl = r ? D(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit) : ZERO
    const diff = s.value.minus(gl).toNumber()
    if (Math.abs(diff) <= (i.tolerance ?? 1)) continue
    const name = (i.accounts ?? []).find((a) => a.id === accountId)?.name ?? 'the stock ledger'
    out.push({
      key: `stock:${accountId}`, company_id: s.company, chain: 'stock', party_id: null, date: i.asOf, differs: ['accounting'], amount: Math.abs(diff), material: material(i, s.company, diff),
      readings: {
        operation: { value: s.value.toNumber(), unit: 'amount', says: `The stock ledger values what is in stock at ${money(s.value.toNumber())}.` },
        accounting: { value: gl.toNumber(), unit: 'amount', says: `${name} carries ${money(gl.toNumber())} in the books.` },
      },
      title: `${name}: the stock ledger and the books differ by ${money(Math.abs(diff))}`,
      explanation: `Every stock document proposes its own accounting entry, so the two should agree. A manual entry in ${name}, or a bill coded straight to it, makes them differ.`,
      links: [{ entity: 'accounts', entity_id: accountId, label: name }],
    })
  }
  return out
}

// ------------------------------------------------------------------ bank: books ↔ statement
function bank(i: RealityInput): Finding[] {
  const out: Finding[] = []
  for (const b of i.bankAccounts ?? []) {
    const open = (i.bankTxns ?? []).filter((t) => t.bank_account_id === b.id && ['unmatched', 'suggested', 'needs_review', 'partial'].includes(t.status) && daysBetween(t.txn_date, i.asOf) > 7)
    if (!open.length) continue
    const amount = open.reduce((s, t) => s + Math.abs(n(t.amount)), 0)
    const oldest = open.reduce((m, t) => (t.txn_date < m ? t.txn_date : m), open[0].txn_date)
    out.push({
      key: `bank:${b.id}`, company_id: b.company_id, chain: 'bank', party_id: null, date: oldest, differs: ['cash'], amount, material: material(i, b.company_id, amount),
      readings: {
        cash: { value: amount, unit: 'amount', says: `${open.length} line(s) of the statement of ${b.name}, ${money(amount)} in all, match nothing in the books. The oldest is of ${oldest}.` },
        accounting: { value: null, unit: 'amount', says: 'No entry in the books has been matched to them.' },
      },
      title: `${b.name}: ${open.length} statement line(s) older than a week are not in the books`,
      explanation: `Money moved in the bank and the books do not show it, or show it differently. Until these lines are matched, the cash the books report for ${b.name} is not confirmed by the bank.`,
      links: [{ entity: 'bank_accounts', entity_id: b.id, label: b.name }],
    })
  }
  return out
}

// ------------------------------------------------------------------ verification sheets: books ↔ what was found
const sheetCounts = (r: VerificationRun) => {
  const s = r.summary as { agree?: number; differ?: number; not_checked?: number; book_value?: Decimal.Value; book_value_of_differences?: Decimal.Value }
  return { agree: Number(s.agree ?? 0), differ: Number(s.differ ?? 0), open: Number(s.not_checked ?? 0), book: n(s.book_value), bookOfDiffering: n(s.book_value_of_differences) }
}
/** by how much a line of a sheet differs from the books, in money: the same rule as the alert the sheet raises */
export function sheetLineDifference(subject: VerificationRun['subject'], l: Pick<VerificationLine, 'book_qty' | 'book_value' | 'found_qty' | 'found_value'>): number {
  if (subject === 'inventory') { const q = n(l.book_qty); return q === 0 ? 0 : Math.round((n(l.found_qty) - q) * (n(l.book_value) / q) * 100) / 100 }
  if (subject === 'cash') return n(l.found_value) - n(l.book_value)
  return -n(l.book_value)
}
/** a sheet counts as a check that agrees only when every item on it was looked at and found as the books say */
const sheetAgrees = (r: VerificationRun) => { const c = sheetCounts(r); return c.differ === 0 && c.open === 0 && c.agree > 0 }
function sheets(i: RealityInput): Finding[] {
  const out: Finding[] = []
  for (const r of lastSheets(i)) {
    const c = sheetCounts(r)
    if (!c.differ) continue
    const checked = c.agree + c.differ
    // where the lines of the sheet were read, the amount is the size of the differences; otherwise it is the book value of the items that differ, and says so
    const lines = (r.lines ?? []).filter((l) => !['located', 'matched', 'not_checked'].includes(l.result))
    const bySize = lines.length > 0
    const amount = bySize ? Math.round(lines.reduce((t, l) => t + Math.abs(sheetLineDifference(r.subject, l)), 0) * 100) / 100 : Math.abs(c.bookOfDiffering)
    const dim: Dimension = r.subject === 'documents' ? 'document' : 'physical'
    const what = r.subject === 'inventory' ? 'stock' : r.subject === 'cash' ? 'cash' : 'documents'
    out.push({
      key: `verification:${r.id}`, company_id: r.company_id, chain: 'verification', party_id: null, date: r.run_date, differs: [dim], amount, material: material(i, r.company_id, amount),
      readings: {
        accounting: { value: c.book, unit: 'amount', says: `The books carry what was on the sheet at ${money(c.book)}.` },
        [dim]: { value: bySize ? null : null, unit: 'amount', says: `${c.differ} of ${checked} item(s) checked were found otherwise than the books say${bySize ? `: the differences come to ${money(amount)} in all` : `. The books carry those items at ${money(c.bookOfDiffering)}; the size of each difference is on the sheet`}.${c.open ? ` ${c.open} item(s) were not checked.` : ''}` },
      },
      title: `Verification ${r.verify_no}: ${c.differ} item(s) of ${what} were found otherwise than the books say`,
      explanation: `The verification of ${r.run_date} checked ${checked} item(s) of ${what} and found ${c.differ} otherwise than the books say. The books have not been changed. Each item is on the sheet, with what was found.`,
      links: [{ entity: 'verification_runs', entity_id: r.id, label: r.verify_no }],
    })
  }
  return out
}

/**
 * Reality health: for each of the five realities, how many chains were checked and how many of them agree.
 * Five separate counts are shown. They are not added into one score: a single number would hide which reality is out.
 */
export function realityHealth(i: RealityInput, findings = findDifferences(i)): HealthRow[] {
  const po = (i.purchaseDocs ?? []).filter(PO_OPEN).length
  const poGoods = ordersWithGoods(i).length
  // a sheet on which items were left unchecked, and none was found otherwise, is neither a check that agrees nor one that differs
  const sheetsOf = (physical: boolean) => lastSheets(i).filter((r) => (r.subject !== 'documents') === physical && (sheetCounts(r).differ > 0 || sheetAgrees(r))).length
  const inv = (i.invoices ?? []).filter((x) => x.doc_type === 'sales_invoice' && x.status !== 'draft' && x.status !== 'cancelled').length
  const adv = (i.advances ?? []).filter((a) => n(a.released_amount) > 0).length
  const verified = new Set((i.assetEvents ?? []).filter((e) => e.event_type === 'verification').map((e) => e.asset_id))
  const ast = (i.assets ?? []).filter((a) => a.status === 'active' && verified.has(a.id)).length
  const boxes = (i.cashBoxes ?? []).filter((b) => (i.cashCounts ?? []).some((c) => c.box_id === b.id)).length
  const ledgers = new Set((i.invCategories ?? []).map((c) => c.inventory_account_id)).size
  const banks = (i.bankAccounts ?? []).filter((b) => (i.bankTxns ?? []).some((t) => t.bank_account_id === b.id)).length
  const checked: Record<Dimension, number> = { document: po + inv + adv + sheetsOf(false), operation: po + adv, accounting: po + inv + adv + ledgers, cash: po + inv + adv + banks, physical: ast + boxes + poGoods + sheetsOf(true) }
  const method: Record<Dimension, string> = {
    document: 'Orders, invoices and advances whose amounts stay within what the document allows, and verifications of documents that found every document as recorded ÷ those checked.',
    operation: 'Orders whose bills and payments are covered by a confirmed receipt, and advances whose claims carry receipts ÷ those checked.',
    accounting: 'Orders, invoices and advances whose entries are in the books, and stock ledgers that agree with the books ÷ those checked.',
    cash: 'Orders, invoices and advances whose money agrees with the record, and bank accounts with no statement line unmatched for more than a week ÷ those checked.',
    physical: 'Assets found as the register says at their last verification, cash boxes whose last count agrees, orders whose goods received were taken into stock, and the last verification of stock or cash of each place where it found everything as the books say ÷ those verified, counted or received. Assets never verified and boxes never counted are not included.',
  }
  return DIMENSIONS.map((d) => {
    const differ = new Set(findings.filter((f) => f.differs.includes(d.key)).map((f) => f.key.split(':').slice(0, 2).join(':'))).size
    const c = Math.max(checked[d.key], differ)
    return { dimension: d.key, label: d.label, checked: c, agree: c - differ, differ, method: method[d.key] }
  })
}

// ------------------------------------------------------------------ the reconciliation status of a report (spec 1676)
const ALL_CHAINS: Chain[] = ['purchase', 'sale', 'advance', 'asset', 'cash', 'stock', 'bank', 'verification']
const ALL_DIMENSIONS: Dimension[] = ['document', 'operation', 'accounting', 'cash', 'physical']
/** The chains and the realities a report rests on. A report that is not named here shows no reconciliation status. */
export const REPORT_REALITY: Record<string, { chains: Chain[]; dimensions: Dimension[]; alsoWhere?: Dimension }> = {
  'pnl': { chains: ['purchase', 'sale', 'advance', 'stock'], dimensions: ['document', 'operation', 'accounting'] },
  'balance-sheet': { chains: ALL_CHAINS, dimensions: ALL_DIMENSIONS },
  'trial-balance': { chains: ALL_CHAINS, dimensions: ALL_DIMENSIONS },
  'consolidated': { chains: ALL_CHAINS, dimensions: ALL_DIMENSIONS },
  'ratios': { chains: ALL_CHAINS, dimensions: ALL_DIMENSIONS },
  // a report of money also rests on every record whose money does not agree, whatever its chain
  'cash-flow': { chains: ['bank', 'cash'], dimensions: ['cash', 'physical'], alsoWhere: 'cash' },
  'cash-book': { chains: ['bank', 'cash'], dimensions: ['cash', 'physical'], alsoWhere: 'cash' },
  'ageing': { chains: ['sale', 'purchase'], dimensions: ['document', 'accounting', 'cash'] },
  'registers': { chains: ['sale', 'purchase'], dimensions: ['document', 'operation', 'accounting'] },
  'money-went': { chains: ['purchase', 'advance'], dimensions: ['document', 'operation', 'cash'] },
  'money-came': { chains: ['sale'], dimensions: ['document', 'accounting', 'cash'] },
}
export interface ReportReality { dimensions: Dimension[]; findings: Finding[]; material: number; byChain: { chain: Chain; count: number; material: number }[] }
/** Of every difference found, those among the records a report rests on. Null for a report that rests on none of them. */
export function realityOfReport(report: string, findings: Finding[], period?: { from?: string; to: string }): ReportReality | null {
  const r = REPORT_REALITY[report]
  if (!r) return null
  // a report of a period rests on the records of that period; a report as at a day, on those up to that day.
  // Two differences stand rather than happen: a stock ledger that does not agree with the books, dated the day it is
  // found, is shown on every report; statement lines not in the books, dated by the oldest of them, are shown on every
  // report that ends after that date, since the lines may fall in any later period.
  const inPeriod = (f: Finding) => !period || f.chain === 'stock' || (f.chain === 'bank' ? f.date <= period.to : f.date <= period.to && (!period.from || f.date >= period.from))
  const mine = findings.filter((f) => inPeriod(f) && (r.chains.includes(f.chain) || (!!r.alsoWhere && f.differs.includes(r.alsoWhere))))
  const chains = [...new Set(mine.map((f) => f.chain))]
  return {
    dimensions: r.dimensions, findings: mine, material: mine.filter((f) => f.material).length,
    byChain: chains.map((chain) => ({ chain, count: mine.filter((f) => f.chain === chain).length, material: mine.filter((f) => f.chain === chain && f.material).length })).sort((a, b) => b.count - a.count),
  }
}

/** What was never checked at all: a reality that was not looked at is not a reality that agrees. */
export function notChecked(i: RealityInput): string[] {
  const out: string[] = []
  const verified = new Set((i.assetEvents ?? []).filter((e) => e.event_type === 'verification').map((e) => e.asset_id))
  const never = (i.assets ?? []).filter((a) => a.status === 'active' && !verified.has(a.id)).length
  if (never) out.push(`${never} active asset(s) have never been physically verified.`)
  const uncounted = (i.cashBoxes ?? []).filter((b) => b.is_active && !(i.cashCounts ?? []).some((c) => c.box_id === b.id)).length
  if (uncounted) out.push(`${uncounted} cash box(es) have never been counted.`)
  const stocked = (i.invItems ?? []).filter((x) => D(x.qty_on_hand).gt(0)).length
  const verifiedStock = lastSheets(i).some((r) => r.subject === 'inventory')
  if (stocked && !verifiedStock && !(i.stockCounts ?? []).some((c) => ['posted', 'closed'].includes(c.status))) out.push(`${stocked} item(s) are in stock, and no stock count or verification of stock has been completed.`)
  for (const r of lastSheets(i)) { const c = sheetCounts(r); if (c.open) out.push(`Verification ${r.verify_no} left ${c.open} item(s) unchecked${c.differ ? '' : ': it is not counted as agreeing'}.`) }
  const noStatement = (i.bankAccounts ?? []).filter((b) => b.is_active && !(i.bankTxns ?? []).some((t) => t.bank_account_id === b.id)).length
  if (noStatement) out.push(`${noStatement} bank account(s) have no statement imported.`)
  return out
}
