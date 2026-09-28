import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Pencil, Plus, Save, Stethoscope, Wrench } from 'lucide-react'
import type { ID, Invoice } from '@/engine/types'
import type { RegisterItem } from '@/engine/opsTypes'
import type { InvItem, InvLot, InvLotInput, InvMovement, StockDoc, StockRow, UnitEvent, UnitEventInput, UnitEventType, Warehouse } from '@/engine/p3Types'
import { warehouseName } from '@/engine/stock'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO, sum } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, Stat, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Fact, History, NoAccess, Tile, digits, foot, human } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { Calculated, DOC_KIND_LABEL, docStatusLabel, fmtQty } from './Inventory'

// how many movements of the unit are read, the latest first
const MOVES = 5000

// =====================================================================
// Unit 360: one serial-numbered unit — a machine — from the day it was
// received to the customer it stands with: its cost, its sale, its
// installation and warranty, and every service visit since.
// Recording an event here is a record. It moves no stock, raises no
// invoice and proposes no entry.
// =====================================================================

const EVENT_TYPES: UnitEventType[] = ['installation', 'engineer_visit', 'spare_part', 'warranty_claim', 'service_contract', 'relocation', 'note']
const EVENT_LABEL: Record<UnitEventType, string> = {
  installation: 'Installation', engineer_visit: 'Engineer visit', spare_part: 'Spare part fitted', warranty_claim: 'Warranty claim', service_contract: 'Service contract', relocation: 'Relocation', note: 'Note',
}
const EVENT_CLS: Record<UnitEventType, string> = { installation: 'pos', engineer_visit: 'cyan', spare_part: 'gold', warranty_claim: 'warn', service_contract: 'violet', relocation: '', note: '' }
interface DetailField { key: string; label: string; type?: 'date' | 'area'; hint?: string }
const EVENT_FIELDS: Record<UnitEventType, DetailField[]> = {
  installation: [{ key: 'location', label: 'Location at the customer', hint: 'Becomes the location of the unit.' }, { key: 'warranty_until', label: 'Warranty until', type: 'date', hint: 'Becomes the warranty date of the unit.' }, { key: 'acceptance', label: 'Acceptance by the customer' }, { key: 'training', label: 'Training given' }],
  engineer_visit: [{ key: 'complaint', label: 'Complaint' }, { key: 'finding', label: 'Finding' }, { key: 'action', label: 'Action taken', type: 'area' }],
  spare_part: [{ key: 'part', label: 'Part fitted' }, { key: 'quantity', label: 'Quantity' }, { key: 'stock_document', label: 'Stock document', hint: 'The number of the stock issue that took the part out of stock, if there is one.' }],
  warranty_claim: [{ key: 'claim', label: 'What is claimed' }, { key: 'on', label: 'Claimed from' }, { key: 'state', label: 'State of the claim' }],
  service_contract: [{ key: 'contract', label: 'Contract reference' }, { key: 'from', label: 'From', type: 'date' }, { key: 'until', label: 'Until', type: 'date' }, { key: 'covers', label: 'What it covers', type: 'area' }],
  relocation: [{ key: 'location', label: 'New location at the customer', hint: 'Becomes the location of the unit.' }, { key: 'reason', label: 'Reason' }],
  note: [{ key: 'note', label: 'Note', type: 'area' }],
}
const IMPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'supplier_invoice', label: 'Supplier invoice' }, { key: 'bill_of_entry', label: 'Bill of entry' }, { key: 'port', label: 'Port of entry' }, { key: 'country_of_origin', label: 'Country of origin' },
  { key: 'currency', label: 'Currency of purchase' }, { key: 'exchange_rate', label: 'Exchange rate' },
]
const NO_MANAGE = 'You need the permission inventory.manage in this company'
const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Loaded {
  lot: InvLot | null; item: InvItem | null; rows: StockRow[]; warehouses: Warehouse[]; events: UnitEvent[]; moves: InvMovement[]; docs: StockDoc[]
  contracts: RegisterItem[]; contractsWhy: string | null; invoices: Invoice[]; invoicesWhy: string | null
}

export default function InvUnit360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('inventory.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Inventory · Unit" title="Inventory" perm="inventory.view" back="/inventory?tab=units" />
  return <UnitView key={id} id={id} ids={ids} />
}

function UnitView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const partyName = usePartyName()
  const idsKey = ids.join(',')
  const asOf = today()
  const [editing, setEditing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [kind, setKind] = useState('')

  const main = useAsync(async (): Promise<Loaded> => {
    const none: Loaded = { lot: null, item: null, rows: [], warehouses: [], events: [], moves: [], docs: [], contracts: [], contractsWhy: null, invoices: [], invoicesWhy: null }
    const lot = (await api.listInvLots({ companyIds: ids })).find((l) => l.id === id) ?? null
    if (!lot) return none
    const co = [lot.company_id]
    const [items, rows, warehouses, events, moves, docs] = await Promise.all([
      api.listInvItems(co), api.stockOnHand(co), api.listWarehouses(co), api.listUnitEvents(lot.id), api.listInvMovements({ companyIds: co, itemId: lot.item_id, lotId: lot.id, limit: MOVES }), api.listStockDocs({ companyIds: co }),
    ])
    // registers and invoices are read only where the role reads them; an empty answer would otherwise prove nothing
    let contracts: RegisterItem[] = [], contractsWhy: string | null = null
    if (can('register.view', lot.company_id)) { try { contracts = await api.listRegisterItems({ companyIds: co }) } catch (e) { contractsWhy = message(e) } } else contractsWhy = 'Your role does not read registers (register.view).'
    let invoices: Invoice[] = [], invoicesWhy: string | null = null
    if (can('invoice.view', lot.company_id)) { try { invoices = await api.listInvoices({ companyIds: co, docTypes: ['sales_invoice'] }) } catch (e) { invoicesWhy = message(e) } } else invoicesWhy = 'Your role does not read sales invoices (invoice.view).'
    return { lot, item: items.find((i) => i.id === lot.item_id) ?? null, rows: rows.filter((r) => r.lot_id === lot.id), warehouses, events, moves: moves.filter((m) => m.lot_id === lot.id), docs, contracts, contractsWhy, invoices, invoicesWhy }
  }, [api, id, idsKey])

  const d = main.data
  const events = useMemo(() => (d?.events ?? []).filter((e) => !kind || e.event_type === kind), [d, kind])

  const back = <button className="btn ghost" onClick={() => nav('/inventory?tab=units')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Inventory · Unit" title="Unit" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!d) return <div><PageHeader eyebrow="Inventory · Unit" title="Unit" actions={back} /><Panel><Loading rows={7} label="Loading the unit" /></Panel></div>
  const lot = d.lot
  if (!lot) {
    return (
      <div>
        <PageHeader eyebrow="Inventory · Unit" title="Unit" actions={back} />
        <Panel><Empty icon={<Stethoscope size={20} />} title="Unit not found or not shared with you" body="This unit does not exist in the companies in which your role reads inventory." action={<button className="btn" onClick={() => nav('/inventory?tab=units')}><ArrowLeft size={14} /> Back to Inventory</button>} /></Panel>
      </div>
    )
  }

  const item = d.item
  const currency = companies.find((c) => c.id === lot.company_id)?.base_currency
  const manage = can('inventory.manage', lot.company_id)
  const whName = warehouseName(d.warehouses)
  const docs = new Map(d.docs.map((x) => [x.id, x]))
  const held = d.rows.find((r) => D(r.qty).gt(0))
  const places = d.rows.filter((r) => D(r.qty).gt(0))
  // a lot may lie in several places at once; a serial-numbered unit lies in one
  const inStock = places.length > 1 ? places.map((r) => `${whName(r.warehouse_id)} (${fmtQty(r.qty)})`).join(', ') : whName(held?.warehouse_id)
  const arriving = d.rows.some((r) => D(r.pending_in).gt(0))
  const leaving = d.rows.some((r) => D(r.pending_out).gt(0))
  const where = held ? 'in_stock' : lot.sold_to_party_id ? 'sold' : arriving ? 'arriving' : 'not_in_stock'
  // the receipt that brought the unit in: its cost is the purchase cost
  const received = [...d.moves].filter((m) => m.is_layer && D(m.qty).gt(0) && (m.status === 'posted' || m.status === 'proposed')).sort((a, b) => a.move_date.localeCompare(b.move_date) || a.created_at.localeCompare(b.created_at))[0]
  const purchaseCost = received ? D(received.value) : null
  const landedCost = D(lot.landed_cost ?? 0)
  const invoice = lot.sale_invoice_id ? d.invoices.find((i) => i.id === lot.sale_invoice_id) : undefined
  const contract = lot.service_item_id ? d.contracts.find((c) => c.id === lot.service_item_id) : undefined
  const warrantyDays = lot.warranty_until ? daysBetween(asOf, lot.warranty_until) : null
  const costOf = (list: UnitEvent[]) => sum(list.map((e) => e.cost ?? 0))
  const chargeable = d.events.filter((e) => e.chargeable === true), free = d.events.filter((e) => e.chargeable === false), unstated = d.events.filter((e) => e.chargeable === null && e.cost !== null)
  const importDetails = Object.entries(lot.import_details ?? {}).filter(([, v]) => text(v) !== '')
  const importLabel = (key: string) => IMPORT_FIELDS.find((f) => f.key === key)?.label ?? human(key)

  const eventColumns: Column<UnitEvent>[] = [
    { key: 'date', header: 'Date', render: (e) => <span className="num text-[12.5px]">{fmtDate(e.event_date)}</span>, sort: (e) => e.event_date, csv: (e) => e.event_date },
    { key: 'type', header: 'Event', render: (e) => <span className={cx('chip', EVENT_CLS[e.event_type])}>{EVENT_LABEL[e.event_type]}</span>, sort: (e) => e.event_type, csv: (e) => EVENT_LABEL[e.event_type] },
    {
      key: 'detail', header: 'What was recorded', csv: (e) => Object.entries(e.detail ?? {}).map(([key, v]) => `${human(key)}: ${text(v)}`).join('; '),
      render: (e) => { const list = Object.entries(e.detail ?? {}).filter(([, v]) => text(v) !== ''); return list.length ? <div className="text-[12.5px]">{list.map(([key, v]) => <div key={key}><span className="text-muted">{human(key)}:</span> <span className="text-ink2">{isDate(text(v)) ? fmtDate(text(v)) : text(v)}</span></div>)}</div> : <span className="text-muted">—</span> },
    },
    { key: 'engineer', header: 'Engineer', render: (e) => <span className="text-[12.5px] text-ink2">{e.engineer_name ?? '—'}</span>, sort: (e) => e.engineer_name ?? '', csv: (e) => e.engineer_name ?? '' },
    { key: 'party', header: 'Customer or party', render: (e) => <span className="text-[12.5px] text-ink2">{partyName(e.party_id)}</span>, sort: (e) => partyName(e.party_id), csv: (e) => (e.party_id ? partyName(e.party_id) : '') },
    { key: 'cost', header: 'Cost recorded', align: 'right', render: (e) => (e.cost === null ? <span className="text-muted">—</span> : <Money value={e.cost} currency={currency} />), sort: (e) => D(e.cost).toNumber(), csv: (e) => (e.cost === null ? '' : D(e.cost).toFixed(2)) },
    { key: 'chargeable', header: 'Chargeable', render: (e) => (e.chargeable === null ? <span className="text-muted">not stated</span> : e.chargeable ? <span className="chip cyan">chargeable</span> : <span className="chip">not chargeable</span>), sort: (e) => String(e.chargeable), csv: (e) => (e.chargeable === null ? '' : e.chargeable ? 'Chargeable' : 'Not chargeable') },
    {
      key: 'invoice', header: 'Invoice', csv: (e) => (e.invoice_id ? d.invoices.find((i) => i.id === e.invoice_id)?.doc_no ?? 'linked' : ''),
      render: (e) => (e.invoice_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/invoices/' + e.invoice_id)}><span className="num">{d.invoices.find((i) => i.id === e.invoice_id)?.doc_no ?? 'Open'}</span> <ExternalLink size={11} /></button> : <span className="text-muted">—</span>),
    },
  ]
  const moveColumns: Column<InvMovement>[] = [
    { key: 'date', header: 'Date', render: (m) => <span className="num text-[12.5px]">{fmtDate(m.move_date)}</span>, csv: (m) => m.move_date },
    { key: 'kind', header: 'Movement', render: (m) => <span className="text-ink">{human(m.kind)}</span>, csv: (m) => human(m.kind) },
    { key: 'doc', header: 'Document', render: (m) => { const x = docs.get(m.doc_id); return <button className="link inline-flex items-center gap-1 text-[12.5px]" title={x ? DOC_KIND_LABEL[x.kind] : undefined} onClick={() => nav('/inventory/docs/' + m.doc_id)}><span className="num">{x?.doc_no ?? 'Open'}</span> <ExternalLink size={11} /></button> }, csv: (m) => docs.get(m.doc_id)?.doc_no ?? '' },
    { key: 'place', header: 'Location', render: (m) => <span className="text-[12.5px] text-ink2">{whName(m.warehouse_id)}</span>, csv: (m) => whName(m.warehouse_id) },
    { key: 'qty', header: 'Quantity', align: 'right', render: (m) => (D(m.qty).isZero() ? <span className="text-muted">—</span> : <span className={cx('num', D(m.qty).lt(0) ? 'text-neg' : 'text-pos')}>{D(m.qty).gt(0) ? '+' : ''}{fmtQty(m.qty)}</span>), csv: (m) => D(m.qty).toString() },
    { key: 'value', header: 'Value', align: 'right', render: (m) => <Money value={m.value} currency={currency} sign colored />, csv: (m) => D(m.value).toFixed(2) },
    { key: 'status', header: 'Status', render: (m) => <StatusChip status={m.status} label={m.status === 'proposed' ? 'awaiting approval' : m.status} />, csv: (m) => (m.status === 'proposed' ? 'awaiting approval' : m.status) },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={`Inventory · ${lot.is_serial ? 'Serial-numbered unit' : 'Lot'}`}
        title={`${lot.lot_no} · ${item?.name ?? 'Unknown item'}`}
        subtitle={<>{companyName(lot.company_id)}{item?.manufacturer ? ` · ${item.manufacturer}` : ''}{item?.model ? ` · model ${item.model}` : ''}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          {item && <button className="btn" onClick={() => nav('/inventory/items/' + item.id)}>Open the item</button>}
          <button className="btn" disabled={!manage} title={manage ? undefined : NO_MANAGE} onClick={() => setEditing(true)}><Pencil size={14} /> Update the facts</button>
          <button className="btn primary" disabled={!manage} title={manage ? 'A record of what was done. It moves no stock and raises no invoice.' : NO_MANAGE} onClick={() => setRecording(true)}><Wrench size={15} /> Record an event</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={cx('chip', where === 'in_stock' ? 'pos' : where === 'sold' ? 'cyan' : where === 'arriving' ? 'warn' : '')}>
          {where === 'in_stock' ? (places.length > 1 ? `in stock in ${places.length} locations` : `in stock at ${inStock}`) : where === 'sold' ? `with ${partyName(lot.sold_to_party_id)}` : where === 'arriving' ? 'arriving — receipt awaiting approval' : 'not in stock'}
        </span>
        {leaving && <span className="chip warn">leaving — issue awaiting approval</span>}
        {warrantyDays !== null && (warrantyDays >= 0 ? <span className={cx('chip', warrantyDays <= 60 ? 'warn' : 'pos')}>under warranty · {warrantyDays} day{warrantyDays === 1 ? '' : 's'} left</span> : <span className="chip">warranty ended {fmtDate(lot.warranty_until)}</span>)}
        {lot.service_item_id && <span className="chip violet">service contract linked</span>}
      </div>
      {!lot.is_serial && <Note className="mb-4">This is a lot, not a single unit. Its dates and its supplier are kept here; the facts about a customer and the service history are meant for serial-numbered units.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {purchaseCost ? <Stat label="Purchase cost" value={purchaseCost} currency={currency} sub={received?.status === 'proposed' ? 'on a receipt awaiting approval' : `received ${fmtDate(received?.move_date)}`} />
          : <Tile label="Purchase cost" sub="No receipt of this unit is in the stock ledger"><span className="text-muted">—</span></Tile>}
        <Stat label="Landed cost added" value={landedCost} currency={currency} sub="freight, duty and other charges, as posted" />
        <Stat label="Cost in total" value={(purchaseCost ?? ZERO).plus(landedCost)} currency={currency} tone="gold" sub={<span className="flex flex-wrap items-center gap-1.5"><Calculated title="purchase cost + landed cost added" /> purchase + landed</span>} />
        {invoice ? <Stat label="Sold for" value={invoice.total} currency={invoice.currency} sub={`invoice ${invoice.doc_no ?? ''} in total, tax included — it may cover more than this unit`} />
          : <Tile label="List sale price" sub={item?.sale_price === null || !item ? 'None is set on the item' : 'the price set on the item, not a sale'}>{item && item.sale_price !== null ? <Money value={item.sale_price} currency={currency} compact /> : <span className="text-muted">—</span>}</Tile>}
        <Stat label="Service cost recorded" value={costOf(d.events)} currency={currency} sub={`${d.events.length} event${d.events.length === 1 ? '' : 's'} on record`} />
        <Tile label="Chargeable / not" sub={unstated.length ? <span>and <Money value={costOf(unstated)} currency={currency} compact /> not stated either way</span> : 'of the service cost recorded'}>
          <span className="text-[17px]"><Money value={costOf(chargeable)} currency={currency} compact className="text-cyan" /> <span className="text-muted">/</span> <Money value={costOf(free)} currency={currency} compact /></span>
        </Tile>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Service history">
            <Panel lit={false}>
              <DataTable columns={eventColumns} rows={events} rowKey={(e) => e.id} exportName={`unit-history-${lot.lot_no}`}
                toolbar={<select className="field sm" style={{ width: 210 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of event"><option value="">Every event</option>{EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}</select>}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Cost recorded · {events.length} event{events.length === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r')}><Money value={costOf(events)} currency={currency} className="font-medium text-ink" /></td>
                  <td className={foot} colSpan={2} />
                </tr>}
                empty={{ title: 'No event on record', body: d.events.length ? 'No event of this kind is on record.' : 'Installation, engineer visits, spare parts, warranty claims and relocations are recorded here as they happen.', icon: <Wrench size={20} /> }} />
              <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">The cost of service is what people recorded on each event. It is a record beside the books: it is not a posted expense, and a chargeable visit is revenue only when its invoice is raised and approved.</div>
            </Panel>
          </Section>

          <Section title="Movements in the stock ledger">
            <Panel lit={false}>
              <DataTable columns={moveColumns} rows={d.moves} rowKey={(m) => m.id} exportName={`unit-movements-${lot.lot_no}`}
                empty={{ title: 'No movement', body: 'The stock ledger holds no movement of this unit.' }} />
              {d.moves.length >= MOVES && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-warn">Only the latest {MOVES.toLocaleString()} movements of this unit are listed.</div>}
            </Panel>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="The unit">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label={lot.is_serial ? 'Serial number' : 'Lot number'}><span className="num">{lot.lot_no}</span></Fact>
              <Fact label="Item">{item ? <button className="link" onClick={() => nav('/inventory/items/' + item.id)}>{item.sku} · {item.name}</button> : '—'}</Fact>
              <Fact label="Manufacturer">{item?.manufacturer ?? '—'}</Fact>
              <Fact label="Model">{item?.model ?? '—'}</Fact>
              <Fact label="Supplier">{lot.supplier_party_id ? <button className="link" onClick={() => nav('/parties/' + lot.supplier_party_id)}>{partyName(lot.supplier_party_id)}</button> : 'Not recorded'}</Fact>
              <Fact label="Manufactured on">{lot.mfg_date ? <span className="num">{fmtDate(lot.mfg_date)}</span> : 'Not recorded'}</Fact>
              <Fact label="Where it is now" className="sm:col-span-2">{where === 'in_stock' ? `In stock at ${inStock}` : where === 'sold' ? `With ${partyName(lot.sold_to_party_id)}${lot.customer_location ? ', ' + lot.customer_location : ''}` : where === 'arriving' ? 'Arriving: its receipt is awaiting approval' : 'Not in stock, and no customer is recorded'}</Fact>
              <Fact label="On record since"><span className="num">{fmtDateTime(lot.created_at)}</span></Fact>
              {(lot.expiry_date || !lot.is_serial) && <Fact label="Expires">{lot.expiry_date ? <span><span className="num">{fmtDate(lot.expiry_date)}</span> <span className={cx('text-[11.5px]', daysBetween(asOf, lot.expiry_date) < 0 ? 'text-neg' : daysBetween(asOf, lot.expiry_date) <= 60 ? 'text-warn' : 'text-muted')}>· {daysBetween(asOf, lot.expiry_date) < 0 ? `expired ${-daysBetween(asOf, lot.expiry_date)} days ago` : `${daysBetween(asOf, lot.expiry_date)} days left`}</span></span> : 'No date recorded'}</Fact>}
              {!lot.is_serial && <Fact label="In stock"><span className="num">{fmtQty(sum(d.rows.map((r) => r.qty)))}</span> {item?.unit ?? ''}</Fact>}
              {lot.note && <Fact label="Note" className="sm:col-span-2">{lot.note}</Fact>}
            </Panel>
          </Section>

          <Section title="Import details">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              {importDetails.length ? importDetails.map(([key, v]) => <Fact key={key} label={importLabel(key)}>{text(v)}</Fact>) : <div className="text-[12.5px] text-muted sm:col-span-2">No import details are recorded for this unit.</div>}
            </Panel>
          </Section>

          <Section title="Sale, installation and warranty">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Sold to">{lot.sold_to_party_id ? <button className="link" onClick={() => nav('/parties/' + lot.sold_to_party_id)}>{partyName(lot.sold_to_party_id)}</button> : 'Not sold'}</Fact>
              <Fact label="Sold on">{lot.sold_on ? <span className="num">{fmtDate(lot.sold_on)}</span> : '—'}</Fact>
              <Fact label="Invoice">{!lot.sale_invoice_id ? 'None linked' : invoice ? <button className="link num" onClick={() => nav('/invoices/' + invoice.id)}>{invoice.doc_no ?? 'Open'}</button> : `Linked. ${d.invoicesWhy ?? 'It is not among the invoices your role reads.'}`}</Fact>
              <Fact label="Installed on">{lot.installed_on ? <span className="num">{fmtDate(lot.installed_on)}</span> : 'Not recorded'}</Fact>
              <Fact label="Location at the customer" className="sm:col-span-2">{lot.customer_location ?? 'Not recorded'}</Fact>
              <Fact label="Warranty until">{lot.warranty_until ? <span><span className="num">{fmtDate(lot.warranty_until)}</span> <span className={cx('text-[11.5px]', warrantyDays !== null && warrantyDays >= 0 && warrantyDays <= 60 ? 'text-warn' : 'text-muted')}>· {warrantyDays !== null && warrantyDays >= 0 ? `${warrantyDays} day${warrantyDays === 1 ? '' : 's'} left` : 'ended'}</span></span> : 'Not recorded'}</Fact>
              <Fact label="Service contract">{!lot.service_item_id ? 'None linked' : contract ? <button className="link" onClick={() => nav('/registers/' + contract.id)}><span className="num">{contract.ref_no}</span> · {contract.title}</button> : can('register.view', lot.company_id) ? <button className="link" onClick={() => nav('/registers/' + lot.service_item_id)}>Open the register item</button> : `Linked. ${d.contractsWhy ?? ''}`}</Fact>
              {contract && <Fact label="Contract runs" className="sm:col-span-2"><span className="num">{fmtDate(contract.start_date)}</span> to <span className="num">{fmtDate(contract.end_date)}</span> · <StatusChip status={contract.status} /></Fact>}
            </Panel>
          </Section>

          <Attachments companyId={lot.company_id} entity="inv_lots" entityId={lot.id} readOnly={!manage} />
          <History entity="inv_lots" entityId={lot.id} />
        </div>
      </div>

      <UnitForm open={editing} lot={lot} contracts={d.contracts} contractsWhy={d.contractsWhy} onClose={() => setEditing(false)} />
      <EventForm open={recording} lot={lot} invoices={d.invoices} invoicesWhy={d.invoicesWhy} onClose={() => setRecording(false)} />
    </div>
  )
}

/** The facts about the customer the unit stands with. The sale itself is recorded by the stock issue, not here. */
function UnitForm({ open, lot, contracts, contractsWhy, onClose }: { open: boolean; lot: InvLot; contracts: RegisterItem[]; contractsWhy: string | null; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const { act, busy } = useAction()
  const start = () => ({
    sold_to_party_id: lot.sold_to_party_id ?? '', sold_on: lot.sold_on ?? '', installed_on: lot.installed_on ?? '', customer_location: lot.customer_location ?? '', warranty_until: lot.warranty_until ?? '', service_item_id: lot.service_item_id ?? '',
    mfg_date: lot.mfg_date ?? '', expiry_date: lot.expiry_date ?? '', note: lot.note ?? '', imports: Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, text(lot.import_details?.[f.key])])) as Record<string, string>,
  })
  const [v, setV] = useState(start)
  useEffect(() => { if (open) setV(start()) }, [open, lot.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const customers = useMemo(() => parties.filter((p) => (p.status !== 'terminated' && p.roles.some((r) => r.company_id === lot.company_id)) || p.id === v.sold_to_party_id).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, lot.company_id, v.sold_to_party_id])
  const choices = useMemo(() => contracts.filter((c) => (c.status !== 'cancelled' && c.status !== 'draft') || c.id === v.service_item_id).sort((a, b) => Number(['amc', 'warranty', 'contract_revenue'].includes(b.kind)) - Number(['amc', 'warranty', 'contract_revenue'].includes(a.kind)) || a.ref_no.localeCompare(b.ref_no)), [contracts, v.service_item_id])
  const problem = v.sold_on && !v.sold_to_party_id ? 'A date of sale needs the customer.' : v.installed_on && v.sold_on && v.installed_on < v.sold_on ? 'The unit cannot be installed before it was sold.'
    : v.warranty_until && v.installed_on && v.warranty_until < v.installed_on ? 'The warranty cannot end before the installation.'
    : v.expiry_date && v.mfg_date && v.expiry_date < v.mfg_date ? 'The expiry date cannot be before the date of manufacture.' : null
  const save = async () => {
    // keys of the import details that this form does not know are kept as they are
    const imports: Record<string, unknown> = { ...(lot.import_details ?? {}) }
    for (const f of IMPORT_FIELDS) { if (v.imports[f.key].trim()) imports[f.key] = v.imports[f.key].trim(); else delete imports[f.key] }
    const input: InvLotInput = {
      id: lot.id, sold_to_party_id: v.sold_to_party_id || null, sold_on: v.sold_on || null, installed_on: v.installed_on || null, customer_location: v.customer_location.trim() || null, warranty_until: v.warranty_until || null,
      mfg_date: v.mfg_date || null, expiry_date: v.expiry_date || null, note: v.note.trim() || null, import_details: imports, ...(contractsWhy ? {} : { service_item_id: v.service_item_id || null }),
    }
    const r = await act(() => api.saveInvLot(input), 'Unit updated')
    if (r) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Update ${lot.lot_no}`} subtitle="Facts about the unit. They move no stock and propose no entry." width={720}
      footer={<>
        {problem && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button>
      </>}>
      <Note className="mb-4">A unit is recorded as sold when a stock issue naming the customer is approved. Change the customer here only to correct the record: doing so takes nothing out of stock.</Note>
      <div className="eyebrow mb-2">With the customer</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sold to"><select className="field" value={v.sold_to_party_id} onChange={(e) => setV({ ...v, sold_to_party_id: e.target.value })}><option value="">Not sold</option>{customers.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select></Field>
        <Field label="Sold on"><input type="date" className="field" value={v.sold_on} max={today()} onChange={(e) => setV({ ...v, sold_on: e.target.value })} /></Field>
        <Field label="Installed on"><input type="date" className="field" value={v.installed_on} max={today()} onChange={(e) => setV({ ...v, installed_on: e.target.value })} /></Field>
        <Field label="Warranty until"><input type="date" className="field" value={v.warranty_until} onChange={(e) => setV({ ...v, warranty_until: e.target.value })} /></Field>
        <Field label="Location at the customer" className="sm:col-span-2"><input className="field" value={v.customer_location} onChange={(e) => setV({ ...v, customer_location: e.target.value })} placeholder="Building, floor, department" /></Field>
        <Field label="Service contract" className="sm:col-span-2" hint={contractsWhy ? `${contractsWhy} The link is left as it is.` : 'An item of the registers: an annual maintenance contract, a warranty given or a service contract.'}>
          <select className="field" value={v.service_item_id} disabled={!!contractsWhy} onChange={(e) => setV({ ...v, service_item_id: e.target.value })}>
            <option value="">{contractsWhy && v.service_item_id ? 'Linked' : 'None linked'}</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.ref_no} · {c.title} · {human(c.kind)}</option>)}
          </select>
        </Field>
      </div>
      <div className="eyebrow mb-2 mt-5">Import details</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_FIELDS.map((f) => <Field key={f.key} label={f.label}><input className={cx('field', f.key === 'exchange_rate' && 'num')} value={v.imports[f.key]} onChange={(e) => setV({ ...v, imports: { ...v.imports, [f.key]: f.key === 'exchange_rate' ? digits(e.target.value) : e.target.value } })} /></Field>)}
        <Field label="Manufactured on"><input type="date" className="field" value={v.mfg_date} max={today()} onChange={(e) => setV({ ...v, mfg_date: e.target.value })} /></Field>
        <Field label="Expiry date" hint="Changing it changes what is shown as expired or near expiry. It posts nothing."><input type="date" className="field" value={v.expiry_date} onChange={(e) => setV({ ...v, expiry_date: e.target.value })} /></Field>
      </div>
      <Field label="Note" className="mt-4"><textarea className="field" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
    </Modal>
  )
}

function EventForm({ open, lot, invoices, invoicesWhy, onClose }: { open: boolean; lot: InvLot; invoices: Invoice[]; invoicesWhy: string | null; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const start = () => ({ event_type: (lot.installed_on ? 'engineer_visit' : 'installation') as UnitEventType, event_date: today(), party_id: lot.sold_to_party_id ?? '', engineer_name: '', cost: '', chargeable: '' as '' | 'yes' | 'no', invoice_id: '', detail: {} as Record<string, string> })
  const [v, setV] = useState(start)
  useEffect(() => { if (open) setV(start()) }, [open, lot.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const fields = EVENT_FIELDS[v.event_type]
  const people = useMemo(() => parties.filter((p) => (p.status !== 'terminated' && p.roles.some((r) => r.company_id === lot.company_id)) || p.id === v.party_id).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, lot.company_id, v.party_id])
  const bills = invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled' && (!v.party_id || i.party_id === v.party_id))
  const anything = fields.some((f) => (v.detail[f.key] ?? '').trim()) || v.engineer_name.trim() || v.cost.trim()
  const problem = !v.event_date ? 'Enter the date.' : v.event_date > today() ? 'An event is recorded once it has happened.' : !anything ? 'Record what happened.' : v.invoice_id && v.chargeable === 'no' ? 'An event with an invoice is chargeable.' : null
  const save = async () => {
    const detail: Record<string, unknown> = {}
    for (const f of fields) { const x = (v.detail[f.key] ?? '').trim(); if (x) detail[f.key] = x }
    const input: UnitEventInput = {
      lot_id: lot.id, event_type: v.event_type, event_date: v.event_date, party_id: v.party_id || null, engineer_name: v.engineer_name.trim() || null, cost: v.cost.trim() || null,
      chargeable: v.chargeable === '' ? null : v.chargeable === 'yes', invoice_id: v.invoice_id || null, detail,
    }
    const r = await act(() => api.recordUnitEvent(input), `${EVENT_LABEL[v.event_type]} recorded`)
    if (r) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Record an event" subtitle={`${lot.lot_no} · a record of what was done`} width={680}
      footer={<>
        {problem && anything && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Plus size={15} />} Record</button>
      </>}>
      <Note className="mb-4">
        {v.event_type === 'spare_part' ? 'Recording a spare part here does not take it out of stock. Prepare a stock issue for the part; this records that it was fitted to this unit.'
          : v.event_type === 'installation' ? 'The date of installation, the location and the warranty date entered here become those of the unit.'
          : v.event_type === 'relocation' ? 'The new location becomes the location of the unit at the customer.'
          : 'A record beside the books. It raises no invoice and proposes no accounting entry.'}
      </Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event"><select className="field" value={v.event_type} onChange={(e) => setV({ ...v, event_type: e.target.value as UnitEventType, detail: {} })}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}</select></Field>
        <Field label="Date"><input type="date" className="field" value={v.event_date} max={today()} onChange={(e) => setV({ ...v, event_date: e.target.value })} /></Field>
        <Field label="Customer or party"><select className="field" value={v.party_id} onChange={(e) => setV({ ...v, party_id: e.target.value, invoice_id: '' })}><option value="">Not recorded</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select></Field>
        <Field label="Engineer"><input className="field" value={v.engineer_name} onChange={(e) => setV({ ...v, engineer_name: e.target.value })} placeholder="Name of the engineer" /></Field>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} className={f.type === 'area' ? 'sm:col-span-2' : undefined}>
            {f.type === 'area' ? <textarea className="field" rows={2} value={v.detail[f.key] ?? ''} onChange={(e) => setV({ ...v, detail: { ...v.detail, [f.key]: e.target.value } })} />
              : <input type={f.type === 'date' ? 'date' : 'text'} className="field" value={v.detail[f.key] ?? ''} onChange={(e) => setV({ ...v, detail: { ...v.detail, [f.key]: e.target.value } })} />}
          </Field>
        ))}
        <Field label="Cost" hint="What the visit, the part or the work cost the company."><input className="field num" inputMode="decimal" value={v.cost} onChange={(e) => setV({ ...v, cost: digits(e.target.value) })} /></Field>
        <Field label="Chargeable to the customer" hint="Work under warranty or under a contract is usually not chargeable.">
          <select className="field" value={v.chargeable} onChange={(e) => setV({ ...v, chargeable: e.target.value as '' | 'yes' | 'no' })}><option value="">Not stated</option><option value="yes">Chargeable</option><option value="no">Not chargeable</option></select>
        </Field>
        <Field label="Invoice (optional)" className="sm:col-span-2" hint={invoicesWhy ? `${invoicesWhy} None can be linked here.` : 'The sales invoice on which the work was charged, if it has been raised.'}>
          <select className="field" value={v.invoice_id} disabled={!!invoicesWhy} onChange={(e) => setV({ ...v, invoice_id: e.target.value, chargeable: e.target.value ? 'yes' : v.chargeable })}>
            <option value="">Not linked</option>{bills.map((i) => <option key={i.id} value={i.id}>{i.doc_no ?? 'No number'} · {fmtDate(i.doc_date)} · {partyName(i.party_id)}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
