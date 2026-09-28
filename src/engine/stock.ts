// Inventory: position, reorder, and exposure to loss. Pure calculation over records.
//
// EXPOSURE is not LOSS. Stock that is near its expiry, damaged, or not moving is still in
// the books at its cost. What it may cost the company is shown beside the loss that has
// actually been posted, never added to it.

import Decimal from 'decimal.js'
import { D, ZERO } from '@/lib/money'
import { addDays, daysBetween } from '@/lib/dates'
import type { Account, ID, LedgerBalanceRow } from './types'
import type { HoldCondition, InvCategory, InvHold, InvItem, InvLot, StockCountLine, StockDoc, StockReason, StockRow, Warehouse } from './p3Types'

export const unitCost = (i: Pick<InvItem, 'qty_on_hand' | 'value_on_hand'>) => (D(i.qty_on_hand).isZero() ? ZERO : D(i.value_on_hand).div(i.qty_on_hand))
export const freeQty = (i: Pick<InvItem, 'qty_on_hand' | 'qty_reserved'>) => D(i.qty_on_hand).minus(i.qty_reserved)

export interface ItemPosition {
  item: InvItem
  qty: Decimal
  free: Decimal
  value: Decimal
  cost: Decimal
  places: { warehouse_id: ID; qty: Decimal; pendingOut: Decimal; pendingIn: Decimal }[]
  lastIn: string | null
  lastOut: string | null
  /** the stock ledger and the running balance of the item say the same quantity */
  agrees: boolean
}
export function stockPosition(items: InvItem[], rows: StockRow[]): ItemPosition[] {
  const by = new Map<ID, StockRow[]>()
  for (const r of rows) by.set(r.item_id, [...(by.get(r.item_id) ?? []), r])
  return items.map((item) => {
    const rs = by.get(item.id) ?? []
    const places = new Map<ID, { warehouse_id: ID; qty: Decimal; pendingOut: Decimal; pendingIn: Decimal }>()
    for (const r of rs) {
      const p = places.get(r.warehouse_id) ?? { warehouse_id: r.warehouse_id, qty: ZERO, pendingOut: ZERO, pendingIn: ZERO }
      places.set(r.warehouse_id, { warehouse_id: r.warehouse_id, qty: p.qty.plus(r.qty), pendingOut: p.pendingOut.plus(r.pending_out), pendingIn: p.pendingIn.plus(r.pending_in) })
    }
    const ledgerQty = rs.reduce((s, r) => s.plus(r.qty), ZERO)
    const max = (k: 'last_in' | 'last_out') => rs.reduce<string | null>((m, r) => (r[k] && (!m || r[k]! > m) ? r[k] : m), null)
    return { item, qty: D(item.qty_on_hand), free: freeQty(item), value: D(item.value_on_hand), cost: unitCost(item), places: [...places.values()].filter((p) => !p.qty.isZero() || !p.pendingIn.isZero() || !p.pendingOut.isZero()), lastIn: max('last_in'), lastOut: max('last_out'), agrees: ledgerQty.eq(item.qty_on_hand) }
  })
}

export interface ReorderRow { item: InvItem; free: Decimal; level: Decimal; short: Decimal; suggested: Decimal; pendingIn: Decimal }
/** Items at or below the level at which more is to be ordered. A suggestion: a person places the order. */
export function reorderList(items: InvItem[], rows: StockRow[]): ReorderRow[] {
  return items.filter((i) => i.status === 'active' && i.reorder_level !== null).map((i) => {
    const free = freeQty(i); const level = D(i.reorder_level ?? 0)
    const pendingIn = rows.filter((r) => r.item_id === i.id).reduce((s, r) => s.plus(r.pending_in), ZERO)
    return { item: i, free, level, short: level.minus(free), suggested: Decimal.max(D(i.reorder_qty ?? 0), level.minus(free).minus(pendingIn), 0), pendingIn }
  }).filter((r) => r.free.lte(r.level)).sort((a, b) => b.short.cmp(a.short))
}

export type ExposureKind = 'expired' | 'near_expiry' | 'damaged' | 'obsolete' | 'quarantine' | 'missing' | 'slow_moving'
export const EXPOSURE_LABEL: Record<ExposureKind, string> = {
  expired: 'Expired', near_expiry: 'Near expiry', damaged: 'Damaged', obsolete: 'Obsolete', quarantine: 'Held for inspection', missing: 'Missing', slow_moving: 'Slow moving',
}
export interface ExposureRow {
  kind: ExposureKind
  item: InvItem
  warehouse_id: ID | null
  lot: InvLot | null
  qty: Decimal
  /** quantity × the cost at which the item is carried. An estimate of what is at stake, not a loss. */
  value: Decimal
  since: string | null
  says: string
  hold_id?: ID
}
export interface ExposureOptions { nearExpiryDays?: number; slowAfterDays?: number }
/**
 * Conditions recorded on stock that is still in the books.
 * One quantity is shown under one heading only, the most serious: expired before near expiry, a noted condition before slow moving.
 */
export function lossExposure(items: InvItem[], rows: StockRow[], lots: InvLot[], holds: InvHold[], asOf: string, o: ExposureOptions = {}): ExposureRow[] {
  const near = o.nearExpiryDays ?? 60
  const byItem = new Map(items.map((i) => [i.id, i]))
  const byLot = new Map(lots.map((l) => [l.id, l]))
  const out: ExposureRow[] = []
  const taken = new Map<string, Decimal>()
  const key = (r: { item_id: ID; warehouse_id: ID; lot_id: ID | null }) => [r.item_id, r.warehouse_id, r.lot_id ?? ''].join('|')
  const take = (k: string, q: Decimal) => taken.set(k, (taken.get(k) ?? ZERO).plus(q))

  // conditions a person has noted
  const label: Record<HoldCondition, ExposureKind> = { damaged: 'damaged', expired: 'expired', obsolete: 'obsolete', quarantine: 'quarantine', missing: 'missing' }
  for (const h of holds.filter((x) => x.status === 'open')) {
    const item = byItem.get(h.item_id)
    if (!item) continue
    out.push({ kind: label[h.condition], item, warehouse_id: h.warehouse_id, lot: h.lot_id ? byLot.get(h.lot_id) ?? null : null, qty: D(h.qty), value: D(h.qty).times(unitCost(item)).toDecimalPlaces(2), since: h.noted_on, says: h.note ?? `Noted as ${h.condition} on ${h.noted_on}.`, hold_id: h.id })
    take(key(h), D(h.qty))
  }
  // expiry, from the dates on the lots
  for (const r of rows) {
    const item = byItem.get(r.item_id); const lot = r.lot_id ? byLot.get(r.lot_id) : undefined
    const qty = D(r.qty).minus(taken.get(key(r)) ?? 0)
    if (!item || !lot?.expiry_date || qty.lte(0)) continue
    const days = daysBetween(asOf, lot.expiry_date)
    if (days < 0) { out.push({ kind: 'expired', item, warehouse_id: r.warehouse_id, lot, qty, value: qty.times(unitCost(item)).toDecimalPlaces(2), since: lot.expiry_date, says: `Lot ${lot.lot_no} expired on ${lot.expiry_date}, ${-days} day(s) ago.` }); take(key(r), qty) }
    else if (days <= near) { out.push({ kind: 'near_expiry', item, warehouse_id: r.warehouse_id, lot, qty, value: qty.times(unitCost(item)).toDecimalPlaces(2), since: lot.expiry_date, says: `Lot ${lot.lot_no} expires on ${lot.expiry_date}, in ${days} day(s).` }); take(key(r), qty) }
  }
  // stock that has not moved
  for (const r of rows) {
    const item = byItem.get(r.item_id)
    const qty = D(r.qty).minus(taken.get(key(r)) ?? 0)
    if (!item || qty.lte(0)) continue
    const after = item.slow_after_days ?? o.slowAfterDays ?? 180
    const moved = r.last_out ?? r.last_in
    if (!moved || moved >= addDays(asOf, -after)) continue
    out.push({ kind: 'slow_moving', item, warehouse_id: r.warehouse_id, lot: r.lot_id ? byLot.get(r.lot_id) ?? null : null, qty, value: qty.times(unitCost(item)).toDecimalPlaces(2), since: moved,
      says: r.last_out ? `Nothing has left this stock since ${r.last_out} (${daysBetween(r.last_out, asOf)} days).` : `Received on ${r.last_in} and nothing has left since (${daysBetween(r.last_in!, asOf)} days).` })
  }
  return out.sort((a, b) => b.value.cmp(a.value))
}
export function exposureTotals(rows: ExposureRow[]) {
  const kinds: ExposureKind[] = ['expired', 'near_expiry', 'damaged', 'obsolete', 'quarantine', 'missing', 'slow_moving']
  return kinds.map((k) => ({ kind: k, label: EXPOSURE_LABEL[k], lines: rows.filter((r) => r.kind === k).length, value: rows.filter((r) => r.kind === k).reduce((s, r) => s.plus(r.value), ZERO) })).filter((x) => x.lines > 0)
}

/** Loss that has been posted: adjustments approved and in the books, by what happened to the stock. */
export function postedLoss(docs: StockDoc[], from: string, to: string) {
  const m = new Map<StockReason, Decimal>()
  for (const d of docs) {
    if (d.kind !== 'adjustment' || d.status !== 'posted' || d.doc_date < from || d.doc_date > to) continue
    for (const l of d.lines ?? []) if (D(l.qty).lt(0) && l.reason_code) m.set(l.reason_code, (m.get(l.reason_code) ?? ZERO).plus(l.value))
  }
  return [...m.entries()].map(([reason, value]) => ({ reason, value })).sort((a, b) => b.value.cmp(a.value))
}

/** Book quantity against physical quantity, line by line. */
export function countDifferences(lines: StockCountLine[]) {
  const counted = lines.filter((l) => l.counted_qty !== null)
  const rows = counted.map((l) => {
    const diff = D(l.counted_qty!).minus(l.book_qty)
    return { line: l, diff, value: diff.times(l.unit_cost).toDecimalPlaces(2) }
  })
  const differ = rows.filter((r) => !r.diff.isZero())
  return {
    rows, counted: counted.length, notCounted: lines.length - counted.length, agree: rows.length - differ.length, differ: differ.length,
    shortValue: differ.filter((r) => r.diff.lt(0)).reduce((s, r) => s.plus(r.value.abs()), ZERO), overValue: differ.filter((r) => r.diff.gt(0)).reduce((s, r) => s.plus(r.value), ZERO),
    withoutReason: differ.filter((r) => !r.line.reason_code).length,
  }
}

/** The value of stock, ledger by ledger, against what the books carry in that ledger. */
export function stockAgainstBooks(items: InvItem[], categories: InvCategory[], ledger: LedgerBalanceRow[], accounts: Account[]) {
  const m = new Map<ID, { company_id: ID; stock: Decimal }>()
  for (const c of categories) {
    const v = items.filter((i) => i.category_id === c.id).reduce((s, i) => s.plus(i.value_on_hand), ZERO)
    m.set(c.inventory_account_id, { company_id: c.company_id, stock: (m.get(c.inventory_account_id)?.stock ?? ZERO).plus(v) })
  }
  return [...m.entries()].map(([accountId, x]) => {
    const r = ledger.find((l) => l.account_id === accountId)
    const books = r ? D(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit) : ZERO
    return { account: accounts.find((a) => a.id === accountId), account_id: accountId, company_id: x.company_id, stock: x.stock, books, difference: x.stock.minus(books), agrees: x.stock.eq(books) }
  })
}

export const warehouseName = (ws: Warehouse[]) => { const m = new Map(ws.map((w) => [w.id, `${w.code} · ${w.name}`])); return (id: ID | null | undefined) => (id ? m.get(id) ?? '—' : '—') }
