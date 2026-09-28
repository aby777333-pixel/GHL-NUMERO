import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, ExternalLink, Package, Pencil } from 'lucide-react'
import type { ID, TaxCode } from '@/engine/types'
import type { InvCategory, InvHold, InvItem, InvLot, InvMovement, StockDoc, StockRow, Warehouse } from '@/engine/p3Types'
import { EXPOSURE_LABEL, lossExposure, stockPosition, warehouseName } from '@/engine/stock'
import { can, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { D, ZERO, sum } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, parseISO, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Loading, Money, Note, PageHeader, Panel, Section, StatusChip } from '@/ui/kit'
import { Attachments, Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Exposure, Fact, History, NoAccess, Tile, foot, human } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { CONDITION_LABEL, Calculated, DOC_KIND_LABEL, ItemForm, TRACKING_LABEL, VALUATION_LABEL, fmtQty } from './Inventory'

// =====================================================================
// Item 360: one item, where it lies, every movement of it and the
// document each movement belongs to. The running quantity counts posted
// movements only: what is awaiting approval has not happened in the books.
// =====================================================================

const LIMIT = 5000
const MOVE_LABEL: Record<string, string> = {
  receipt: 'Received', issue: 'Issued', transfer_out: 'Transferred out', transfer_in: 'Transferred in', return_in: 'Returned by customer', return_out: 'Returned to vendor', adjustment: 'Adjusted', landed_cost: 'Landed cost added',
}
const MOVE_STATUS: Record<InvMovement['status'], string> = { proposed: 'awaiting approval', posted: 'posted', rejected: 'rejected', reversed: 'reversed' }

export default function InvItem360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('inventory.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Inventory · Item" title="Inventory" perm="inventory.view" back="/inventory?tab=items" />
  return <ItemView key={id} id={id} ids={ids} />
}

interface MoveRow { move: InvMovement; runQty: Decimal | null; runValue: Decimal | null }
interface PlaceRow { row: StockRow; lot: InvLot | undefined; noted: Decimal }
interface Loaded { item: InvItem | null; categories: InvCategory[]; warehouses: Warehouse[]; rows: StockRow[]; lots: InvLot[]; holds: InvHold[]; moves: InvMovement[]; docs: StockDoc[]; taxes: TaxCode[] }

function ItemView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const partyName = usePartyName()
  const idsKey = ids.join(',')
  const asOf = today()
  const [editing, setEditing] = useState(false)

  const main = useAsync(async (): Promise<Loaded> => {
    const item = (await api.listInvItems(ids)).find((i) => i.id === id) ?? null
    // nothing else is read for an item that is not there: its company is not known
    if (!item) return { item, categories: [], warehouses: [], rows: [], lots: [], holds: [], moves: [], docs: [], taxes: [] }
    const co = [item.company_id]
    const [categories, warehouses, rows, lots, holds, moves, docs, taxes] = await Promise.all([
      api.listInvCategories(co), api.listWarehouses(co), api.stockOnHand(co), api.listInvLots({ companyIds: co, itemId: id }), api.listInvHolds(co),
      api.listInvMovements({ companyIds: co, itemId: id, limit: LIMIT }), api.listStockDocs({ companyIds: co }), api.listTaxCodes(co),
    ])
    return { item, categories, warehouses, rows: rows.filter((r) => r.item_id === id), lots: lots.filter((l) => l.item_id === id), holds: holds.filter((h) => h.item_id === id), moves: moves.filter((m) => m.item_id === id), docs, taxes }
  }, [api, id, idsKey])

  const d = main.data
  const item = d?.item ?? null
  const moves = useMemo(() => d?.moves ?? [], [d])
  const truncated = moves.length >= LIMIT

  // running balance over posted movements, oldest first; shown newest first
  const moveRows: MoveRow[] = useMemo(() => {
    if (!item) return []
    const asc = [...moves].sort((a, b) => a.move_date.localeCompare(b.move_date) || a.created_at.localeCompare(b.created_at))
    const posted = asc.filter((m) => m.status === 'posted')
    // when the list is cut short the oldest movements are missing, so the balance is walked back from what the item holds now
    let q = truncated ? D(item.qty_on_hand).minus(sum(posted.map((m) => m.qty))) : ZERO
    let v = truncated ? D(item.value_on_hand).minus(sum(posted.map((m) => m.value))) : ZERO
    return asc.map((m) => {
      if (m.status !== 'posted') return { move: m, runQty: null, runValue: null }
      q = q.plus(m.qty); v = v.plus(m.value)
      return { move: m, runQty: q, runValue: v }
    }).reverse()
  }, [moves, item, truncated])

  const points = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const r of [...moveRows].reverse()) if (r.runQty) byDay.set(r.move.move_date, r.runQty.toNumber())
    return [...byDay.entries()].map(([date, qty]) => ({ date, qty }))
  }, [moveRows])

  const back = <button className="btn ghost" onClick={() => nav('/inventory?tab=items')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Inventory · Item" title="Item" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!d) return <div><PageHeader eyebrow="Inventory · Item" title="Item" actions={back} /><Panel><Loading rows={7} label="Loading the item" /></Panel></div>
  if (!item) {
    return (
      <div>
        <PageHeader eyebrow="Inventory · Item" title="Item" actions={back} />
        <Panel><Empty icon={<Package size={20} />} title="Item not found or not shared with you" body="This item does not exist in the companies in which your role reads inventory." action={<button className="btn" onClick={() => nav('/inventory?tab=items')}><ArrowLeft size={14} /> Back to Inventory</button>} /></Panel>
      </div>
    )
  }

  const currency = companies.find((c) => c.id === item.company_id)?.base_currency
  const category = d.categories.find((c) => c.id === item.category_id)
  const whName = warehouseName(d.warehouses)
  const pos = stockPosition([item], d.rows)[0]
  const exposure = lossExposure([item], d.rows, d.lots, d.holds, asOf)
  const exposureTotal = sum(exposure.map((r) => r.value))
  const docs = new Map(d.docs.map((x) => [x.id, x]))
  const lotsById = new Map(d.lots.map((l) => [l.id, l]))
  const manage = can('inventory.manage', item.company_id)
  const awaiting = moves.filter((m) => m.status === 'proposed')
  const tax = d.taxes.find((t) => t.id === item.tax_code_id)
  const qtyOfLot = (lotId: ID) => sum(d.rows.filter((r) => r.lot_id === lotId).map((r) => r.qty))

  const placeRows: PlaceRow[] = d.rows.map((row) => ({
    row, lot: row.lot_id ? lotsById.get(row.lot_id) : undefined,
    noted: sum(d.holds.filter((h) => h.status === 'open' && h.warehouse_id === row.warehouse_id && (h.lot_id ?? null) === (row.lot_id ?? null)).map((h) => h.qty)),
  })).sort((a, b) => whName(a.row.warehouse_id).localeCompare(whName(b.row.warehouse_id)) || (a.lot?.expiry_date ?? '9').localeCompare(b.lot?.expiry_date ?? '9'))

  const placeColumns: Column<PlaceRow>[] = [
    { key: 'place', header: 'Location', render: (p) => <span className="text-ink">{whName(p.row.warehouse_id)}</span>, sort: (p) => whName(p.row.warehouse_id), csv: (p) => whName(p.row.warehouse_id) },
    ...(item.tracking !== 'none' ? [{
      key: 'lot', header: item.tracking === 'serial' ? 'Serial number' : 'Lot', sort: (p: PlaceRow) => p.lot?.lot_no ?? '', csv: (p: PlaceRow) => p.lot?.lot_no ?? '',
      render: (p: PlaceRow) => (p.lot ? (
        <div>
          {p.lot.is_serial ? <button className="link num text-[12.5px]" onClick={() => nav('/inventory/units/' + p.lot!.id)}>{p.lot.lot_no}</button> : <span className="num text-[12.5px] text-gold">{p.lot.lot_no}</span>}
          {p.lot.expiry_date && <div className={cx('text-[11px]', daysBetween(asOf, p.lot.expiry_date) < 0 ? 'text-neg' : daysBetween(asOf, p.lot.expiry_date) <= 60 ? 'text-warn' : 'text-muted')}>expires {fmtDate(p.lot.expiry_date)}</div>}
        </div>
      ) : <span className="text-muted">—</span>),
    }] : []),
    { key: 'qty', header: 'In stock', align: 'right', render: (p) => <span className="num text-ink">{fmtQty(p.row.qty)}</span>, sort: (p) => D(p.row.qty).toNumber(), csv: (p) => D(p.row.qty).toString() },
    { key: 'out', header: 'Leaving (awaiting approval)', align: 'right', render: (p) => (D(p.row.pending_out).isZero() ? <span className="text-muted">—</span> : <span className="num text-warn">{fmtQty(p.row.pending_out)}</span>), sort: (p) => D(p.row.pending_out).toNumber(), csv: (p) => D(p.row.pending_out).toString() },
    { key: 'in', header: 'Arriving (awaiting approval)', align: 'right', render: (p) => (D(p.row.pending_in).isZero() ? <span className="text-muted">—</span> : <span className="num text-cyan">{fmtQty(p.row.pending_in)}</span>), sort: (p) => D(p.row.pending_in).toNumber(), csv: (p) => D(p.row.pending_in).toString() },
    { key: 'free', header: 'Free here', align: 'right', render: (p) => <span className="num">{fmtQty(D(p.row.qty).minus(p.row.pending_out))}</span>, sort: (p) => D(p.row.qty).minus(p.row.pending_out).toNumber(), csv: (p) => D(p.row.qty).minus(p.row.pending_out).toString() },
    { key: 'noted', header: 'With a condition noted', align: 'right', render: (p) => (p.noted.isZero() ? <span className="text-muted">—</span> : <span className="num text-warn">{fmtQty(p.noted)}</span>), sort: (p) => p.noted.toNumber(), csv: (p) => p.noted.toString() },
    { key: 'lastin', header: 'Last in', render: (p) => (p.row.last_in ? <span className="num text-[12.5px]">{fmtDate(p.row.last_in)}</span> : <span className="text-muted">—</span>), sort: (p) => p.row.last_in ?? '', csv: (p) => p.row.last_in ?? '' },
    { key: 'lastout', header: 'Last out', render: (p) => (p.row.last_out ? <span className="num text-[12.5px]">{fmtDate(p.row.last_out)}</span> : <span className="text-muted">—</span>), sort: (p) => p.row.last_out ?? '', csv: (p) => p.row.last_out ?? '' },
  ]

  const moveColumns: Column<MoveRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="num text-[12.5px]">{fmtDate(r.move.move_date)}</span>, csv: (r) => r.move.move_date },
    { key: 'kind', header: 'Movement', render: (r) => <span className="text-ink">{MOVE_LABEL[r.move.kind] ?? human(r.move.kind)}</span>, csv: (r) => MOVE_LABEL[r.move.kind] ?? r.move.kind },
    {
      key: 'doc', header: 'Document', csv: (r) => docs.get(r.move.doc_id)?.doc_no ?? '',
      render: (r) => { const x = docs.get(r.move.doc_id); return <button className="link inline-flex items-center gap-1 text-[12.5px]" title={x ? `${DOC_KIND_LABEL[x.kind]}${x.reason ? ' — ' + x.reason : ''}` : undefined} onClick={() => nav('/inventory/docs/' + r.move.doc_id)}><span className="num">{x?.doc_no ?? 'Open'}</span> <ExternalLink size={11} /></button> },
    },
    { key: 'place', header: 'Location', render: (r) => <span className="text-[12.5px] text-ink2">{whName(r.move.warehouse_id)}</span>, csv: (r) => whName(r.move.warehouse_id) },
    ...(item.tracking !== 'none' ? [{ key: 'lot', header: item.tracking === 'serial' ? 'Serial' : 'Lot', render: (r: MoveRow) => <span className="num text-[12.5px] text-ink2">{r.move.lot_id ? lotsById.get(r.move.lot_id)?.lot_no ?? '—' : '—'}</span>, csv: (r: MoveRow) => (r.move.lot_id ? lotsById.get(r.move.lot_id)?.lot_no ?? '' : '') }] : []),
    { key: 'qty', header: 'Quantity', align: 'right', render: (r) => (D(r.move.qty).isZero() ? <span className="text-muted" title="Landed cost changes the value of stock, not its quantity">—</span> : <span className={cx('num', D(r.move.qty).lt(0) ? 'text-neg' : 'text-pos')}>{D(r.move.qty).gt(0) ? '+' : ''}{fmtQty(r.move.qty)}</span>), csv: (r) => D(r.move.qty).toString() },
    { key: 'cost', header: 'Unit cost', align: 'right', render: (r) => <Money value={r.move.unit_cost} currency={currency} className="text-ink2" />, csv: (r) => D(r.move.unit_cost).toString() },
    { key: 'value', header: 'Value', align: 'right', render: (r) => <Money value={r.move.value} currency={currency} sign colored />, csv: (r) => D(r.move.value).toFixed(2) },
    { key: 'run', header: 'Quantity after', align: 'right', render: (r) => (r.runQty ? <span className="num text-ink">{fmtQty(r.runQty)}</span> : <span className="text-muted" title="Not part of the balance in the books">—</span>), csv: (r) => r.runQty?.toString() ?? '' },
    { key: 'runv', header: 'Value after', align: 'right', render: (r) => (r.runValue ? <Money value={r.runValue} currency={currency} className="text-ink2" /> : <span className="text-muted">—</span>), csv: (r) => r.runValue?.toFixed(2) ?? '' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.move.status} label={MOVE_STATUS[r.move.status]} />, csv: (r) => MOVE_STATUS[r.move.status] },
  ]

  const holdColumns: Column<InvHold>[] = [
    { key: 'noted', header: 'Noted on', render: (h) => <span className="num text-[12.5px]">{fmtDate(h.noted_on)}</span>, sort: (h) => h.noted_on, csv: (h) => h.noted_on },
    { key: 'condition', header: 'Condition', render: (h) => <span className="chip warn">{CONDITION_LABEL[h.condition]}</span>, sort: (h) => h.condition, csv: (h) => CONDITION_LABEL[h.condition] },
    { key: 'place', header: 'Location', render: (h) => <span className="text-[12.5px] text-ink2">{whName(h.warehouse_id)}{h.lot_id ? ` · ${lotsById.get(h.lot_id)?.lot_no ?? ''}` : ''}</span>, csv: (h) => whName(h.warehouse_id) },
    { key: 'qty', header: 'Quantity', align: 'right', render: (h) => <span className="num">{fmtQty(h.qty)}</span>, sort: (h) => D(h.qty).toNumber(), csv: (h) => D(h.qty).toString() },
    { key: 'note', header: 'Note', render: (h) => <div className="text-[12.5px] text-ink2">{h.note ?? '—'}{h.resolved_note && <div className="text-[11.5px] text-muted">Released: {h.resolved_note}</div>}</div>, csv: (h) => [h.note, h.resolved_note].filter(Boolean).join(' | ') },
    { key: 'status', header: 'Status', render: (h) => <StatusChip status={h.status === 'released' ? 'released_hold' : h.status} label={human(h.status)} />, sort: (h) => h.status, csv: (h) => human(h.status) },
    { key: 'doc', header: 'Adjustment', render: (h) => (h.resolved_doc_id ? <button className="link text-[12.5px]" onClick={() => nav('/inventory/docs/' + h.resolved_doc_id)}>Open</button> : <span className="text-muted">—</span>) },
  ]

  const lotColumns: Column<InvLot>[] = [
    { key: 'lot', header: item.tracking === 'serial' ? 'Serial number' : 'Lot', render: (l) => <span className="num text-[12.5px] text-gold">{l.lot_no}</span>, sort: (l) => l.lot_no, csv: (l) => l.lot_no },
    { key: 'supplier', header: 'Supplier', render: (l) => <span className="text-[12.5px] text-ink2">{partyName(l.supplier_party_id)}</span>, sort: (l) => partyName(l.supplier_party_id), csv: (l) => (l.supplier_party_id ? partyName(l.supplier_party_id) : '') },
    { key: 'mfg', header: 'Manufactured', render: (l) => (l.mfg_date ? <span className="num text-[12.5px]">{fmtDate(l.mfg_date)}</span> : <span className="text-muted">—</span>), sort: (l) => l.mfg_date ?? '', csv: (l) => l.mfg_date ?? '' },
    {
      key: 'expiry', header: 'Expires', sort: (l) => l.expiry_date ?? '9999', csv: (l) => l.expiry_date ?? '',
      render: (l) => { if (!l.expiry_date) return <span className="text-muted">—</span>; const n = daysBetween(asOf, l.expiry_date); return <div><div className="num text-[12.5px]">{fmtDate(l.expiry_date)}</div><div className={cx('text-[11px]', n < 0 ? 'text-neg' : n <= 60 ? 'text-warn' : 'text-muted')}>{n < 0 ? `expired ${-n} day${n === -1 ? '' : 's'} ago` : `${n} day${n === 1 ? '' : 's'} left`}</div></div> },
    },
    { key: 'qty', header: 'In stock', align: 'right', render: (l) => <span className="num">{fmtQty(qtyOfLot(l.id))}</span>, sort: (l) => qtyOfLot(l.id).toNumber(), csv: (l) => qtyOfLot(l.id).toString() },
    { key: 'landed', header: 'Landed cost added', align: 'right', render: (l) => (l.landed_cost === null ? <span className="text-muted">—</span> : <Money value={l.landed_cost} currency={currency} />), sort: (l) => D(l.landed_cost).toNumber(), csv: (l) => (l.landed_cost === null ? '' : D(l.landed_cost).toFixed(2)) },
    { key: 'sold', header: 'Sold to', render: (l) => (l.sold_to_party_id ? <span className="text-[12.5px] text-ink2">{partyName(l.sold_to_party_id)}{l.sold_on ? ` · ${fmtDate(l.sold_on)}` : ''}</span> : <span className="text-muted">—</span>), sort: (l) => partyName(l.sold_to_party_id), csv: (l) => (l.sold_to_party_id ? partyName(l.sold_to_party_id) : '') },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={`Inventory · Item · ${category?.name ?? 'No category'}`}
        title={`${item.sku} · ${item.name}`}
        subtitle={<>{companyName(item.company_id)} · kept in {item.unit}{item.manufacturer ? ` · ${item.manufacturer}` : ''}{item.model ? ` · model ${item.model}` : ''}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          <button className="btn" disabled={!manage} title={manage ? undefined : 'You need the permission inventory.manage in this company'} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={item.status} />
        <span className={cx('chip', item.tracking !== 'none' && 'cyan')}>{TRACKING_LABEL[item.tracking]}</span>
        <span className="chip">{VALUATION_LABEL[item.valuation_method]}</span>
        {awaiting.length > 0 && <span className="chip warn">{awaiting.length} movement{awaiting.length === 1 ? '' : 's'} awaiting approval</span>}
        {!pos.agrees && <span className="chip warn">stock ledger differs from the item balance</span>}
      </div>
      {!pos.agrees && <Note kind="warn" className="mb-4">The posted movements of this item add up to <span className="num">{fmtQty(sum(d.rows.map((r) => r.qty)))}</span> {item.unit}, and the running balance of the item says <span className="num">{fmtQty(item.qty_on_hand)}</span>. The screen states the difference; it corrects nothing.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="In stock" sub={`${item.unit} · in ${pos.places.filter((p) => !p.qty.isZero()).length} location${pos.places.filter((p) => !p.qty.isZero()).length === 1 ? '' : 's'}`}><span className="num">{fmtQty(pos.qty)}</span></Tile>
        <Tile label="Reserved" tone={D(item.qty_reserved).gt(0) ? 'text-warn' : undefined} sub="on documents awaiting approval to leave"><span className="num">{fmtQty(item.qty_reserved)}</span></Tile>
        <Tile label="Free" sub="in stock − reserved"><span className="num">{fmtQty(pos.free)}</span></Tile>
        <Stat label="Value of stock" value={pos.value} currency={currency} tone="gold" sub="at the cost carried in the books" />
        <Tile label="Unit cost" sub={<span className="flex flex-wrap items-center gap-1.5"><Calculated title="value ÷ quantity" /> value ÷ quantity</span>}>
          {pos.qty.isZero() ? <span className="text-muted">—</span> : <Money value={pos.cost} currency={currency} />}
        </Tile>
        <Stat label="Exposure to loss" value={exposureTotal} currency={currency} tone={exposureTotal.gt(0) ? 'warn' : undefined}
          sub={<span className="flex flex-wrap items-center gap-1.5"><Exposure /> {exposure.length ? [...new Set(exposure.map((r) => EXPOSURE_LABEL[r.kind].toLowerCase()))].join(', ') : 'nothing recorded'}</span>} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          {points.length > 0 && (
            <Section title="Quantity in stock over time" right={<Explain title="Quantity in stock over time" text="The quantity the books held at the end of each day on which the item moved. Only posted movements are counted; what is awaiting approval has not happened in the books." formula="quantity after a movement = quantity before + quantity of the movement" source="Source: the posted movements of this item in the stock ledger." />}>
              <Panel className="p-4" lit={false}><QtyChart points={points} unit={item.unit} /></Panel>
            </Section>
          )}

          <Section title="Where it lies">
            <Panel lit={false}>
              <DataTable columns={placeColumns} rows={placeRows} rowKey={(p) => p.row.warehouse_id + '|' + (p.row.lot_id ?? '')} exportName={`stock-places-${item.sku}`}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={item.tracking !== 'none' ? 2 : 1}>Total</td>
                  <td className={cx(foot, 'r num')}>{fmtQty(sum(placeRows.map((p) => p.row.qty)))}</td>
                  <td className={cx(foot, 'r num')}>{fmtQty(sum(placeRows.map((p) => p.row.pending_out)))}</td>
                  <td className={cx(foot, 'r num')}>{fmtQty(sum(placeRows.map((p) => p.row.pending_in)))}</td>
                  <td className={cx(foot, 'r num')}>{fmtQty(sum(placeRows.map((p) => D(p.row.qty).minus(p.row.pending_out))))}</td>
                  <td className={foot} colSpan={3} />
                </tr>}
                empty={{ title: 'Nothing in stock', body: 'The stock ledger holds no quantity of this item in any location.' }} />
            </Panel>
          </Section>

          <Section title="Movements">
            <Panel lit={false}>
              <DataTable columns={moveColumns} rows={moveRows} rowKey={(r) => r.move.id} pageSize={40} exportName={`stock-movements-${item.sku}`}
                rowClass={(r) => (r.move.status === 'proposed' ? 'bg-warnsoft' : undefined)}
                toolbar={<span className="text-[12px] text-muted">Newest first. Quantity after and value after count posted movements only.</span>}
                empty={{ title: 'No movement', body: 'Nothing has been received, issued, transferred or adjusted for this item.' }} />
              {truncated && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-warn">Only the latest {LIMIT.toLocaleString()} movements are listed. The balances shown were worked back from what the item holds today.</div>}
            </Panel>
          </Section>

          {item.tracking !== 'none' && (
            <Section title={item.tracking === 'serial' ? 'Serial numbers' : 'Lots'}>
              <Panel lit={false}>
                <DataTable columns={lotColumns} rows={d.lots} rowKey={(l) => l.id} onRow={(l) => nav('/inventory/units/' + l.id)} exportName={`lots-${item.sku}`}
                  empty={{ title: item.tracking === 'serial' ? 'No serial number on record' : 'No lot on record', body: 'One appears when the item is received.' }} />
              </Panel>
            </Section>
          )}

          <Section title="Conditions noted on this item">
            <Panel lit={false}>
              <DataTable columns={holdColumns} rows={d.holds} rowKey={(h) => h.id} exportName={`conditions-${item.sku}`}
                empty={{ title: 'No condition is noted', body: 'Conditions are noted, released and written off under Inventory → Loss exposure.' }} />
            </Panel>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Code (SKU)"><span className="num">{item.sku}</span></Fact>
              <Fact label="Unit">{item.unit}</Fact>
              <Fact label="Category">{category?.name ?? '—'}</Fact>
              <Fact label="Tracking">{TRACKING_LABEL[item.tracking]}</Fact>
              <Fact label="Valuation method">{VALUATION_LABEL[item.valuation_method]}</Fact>
              <Fact label="Tax code">{tax ? tax.name : item.tax_code_id ? 'Recorded' : '—'}</Fact>
              <Fact label="HSN code"><span className="num">{item.hsn_code ?? '—'}</span></Fact>
              <Fact label="Sale price">{item.sale_price === null ? '—' : <Money value={item.sale_price} currency={currency} />}</Fact>
              <Fact label="Manufacturer">{item.manufacturer ?? '—'}</Fact>
              <Fact label="Model">{item.model ?? '—'}</Fact>
              <Fact label="Reorder level">{item.reorder_level === null ? 'Not watched' : <span className="num">{fmtQty(item.reorder_level)} {item.unit}</span>}</Fact>
              <Fact label="Reorder quantity">{item.reorder_qty === null ? '—' : <span className="num">{fmtQty(item.reorder_qty)} {item.unit}</span>}</Fact>
              <Fact label="Shelf life">{item.shelf_life_days === null ? '—' : <span><span className="num">{item.shelf_life_days}</span> days</span>}</Fact>
              <Fact label="Slow moving after">{<span><span className="num">{item.slow_after_days ?? 180}</span> days{item.slow_after_days === null ? ' (the default)' : ''}</span>}</Fact>
              <Fact label="Weight of one unit">{item.unit_weight === null ? '—' : <span className="num">{fmtQty(item.unit_weight)}</span>}</Fact>
              <Fact label="On record since"><span className="num">{fmtDateTime(item.created_at)}</span></Fact>
              <Fact label="Stock ledger" className="sm:col-span-2">{accountName(category?.inventory_account_id)}</Fact>
              <Fact label="Cost of sales ledger" className="sm:col-span-2">{accountName(category?.cogs_account_id)}</Fact>
              {item.description && <Fact label="Description" className="sm:col-span-2">{item.description}</Fact>}
            </Panel>
          </Section>

          <Attachments companyId={item.company_id} entity="inv_items" entityId={item.id} readOnly={!manage} />
          <History entity="inv_items" entityId={item.id} />
        </div>
      </div>

      <ItemForm open={editing} item={item} companyIds={[item.company_id]} categories={d.categories} onClose={() => setEditing(false)} />
    </div>
  )
}

/** A quantity is not money: this chart labels its axis in units of the item, never in a currency. */
function QtyChart({ points, unit, height = 220 }: { points: { date: string; qty: number }[]; unit: string; height?: number }) {
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const obs = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect()
    if (!el) return
    setW(el.clientWidth || 640)
    obs.current = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))))
    obs.current.observe(el)
  }, [])
  const pad = { l: 58, r: 14, t: 14, b: 28 }
  const t0 = parseISO(points[0].date).getTime()
  const t1 = Math.max(parseISO(points[points.length - 1].date).getTime(), parseISO(today()).getTime())
  const max = Math.max(1, ...points.map((p) => p.qty)), min = Math.min(0, ...points.map((p) => p.qty))
  const span = max - min || 1
  const x = (date: string) => pad.l + (t1 === t0 ? 0 : ((parseISO(date).getTime() - t0) / (t1 - t0)) * (w - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b)
  // a step line: the quantity holds until the next movement
  let path = ''
  points.forEach((p, i) => { path += i === 0 ? `M${x(p.date).toFixed(1)} ${y(p.qty).toFixed(1)}` : ` H${x(p.date).toFixed(1)} V${y(p.qty).toFixed(1)}` })
  path += ` H${(w - pad.r).toFixed(1)}`
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const step = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 90))))
  const h = hover !== null ? points[hover] : null
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={height} role="img" aria-label={`Quantity in stock over time, in ${unit}`} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - r.left
          let best = 0
          points.forEach((p, i) => { if (x(p.date) <= px + 0.5) best = i })
          setHover(best)
        }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '2 5'} />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">{fmtQty(new Decimal(t).toDecimalPlaces(1))}</text>
          </g>
        ))}
        {points.map((p, i) => i % step === 0 && <text key={p.date} x={x(p.date)} y={height - 8} textAnchor={i === 0 ? 'start' : 'middle'} fontSize="10" fill="var(--muted)">{fmtDate(p.date).slice(0, 6)}</text>)}
        <path d={`${path} V${y(min).toFixed(1)} H${x(points[0].date).toFixed(1)} Z`} fill="var(--gold)" opacity="0.1" />
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
        {h && <g><line x1={x(h.date)} x2={x(h.date)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" /><circle cx={x(h.date)} cy={y(h.qty)} r="3.6" fill="var(--bg)" stroke="var(--gold)" strokeWidth="2" /></g>}
      </svg>
      {h && (
        <div className="panel pointer-events-none absolute top-2 z-10 min-w-[150px] px-3 py-2 text-[12px]" style={{ left: Math.min(Math.max(8, x(h.date) + 12), w - 170), background: 'var(--surface-solid)' }}>
          <div className="mb-1 text-muted">{fmtDate(h.date)}</div>
          <div className="flex items-center justify-between gap-4"><span className="text-ink2">In stock</span><span className="num">{fmtQty(h.qty)} {unit}</span></div>
        </div>
      )}
      <div className="mt-1 px-1 text-[11.5px] text-ink2"><i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: 'var(--gold)' }} />Quantity in stock, in {unit}, after each day's posted movements</div>
    </div>
  )
}
