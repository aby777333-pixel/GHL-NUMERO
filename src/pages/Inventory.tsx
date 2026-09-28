import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { Boxes, ClipboardList, ExternalLink, Flag, MapPin, Pencil, Plus, Save, ShoppingCart, Tags, Undo2 } from 'lucide-react'
import type { Account, ID } from '@/engine/types'
import type {
  HoldCondition, InvCategory, InvCategoryInput, InvHold, InvItem, InvItemInput, InvLot, StockCount, StockCountStatus, StockDoc, StockDocKind, StockDocStatus, StockReason, StockRow,
  Tracking, Valuation, Warehouse, WarehouseInput, WarehouseKind,
} from '@/engine/p3Types'
import {
  EXPOSURE_LABEL, exposureTotals, lossExposure, postedLoss, reorderList, stockAgainstBooks, stockPosition, warehouseName,
  type ExposureKind, type ExposureRow, type ItemPosition, type ReorderRow,
} from '@/engine/stock'
import { can, useApp, useCurrency, usePeriod, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO, groupDigits, sum } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Exposure, NoAccess, Tile, digits, foot, human, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, Donut } from '@/ui/charts'

// =====================================================================
// Inventory command centre (spec 24, 28, 29, 153, 568, 570, 573, 700, 1387).
// The stock ledger and the books must say the same thing, and this screen
// shows whether they do. A stock document PROPOSES an accounting entry;
// stock changes in the books only when a second person approves it.
// EXPOSURE is not LOSS: what is at stake is shown beside what was posted,
// never added to it.
// =====================================================================

type TabKey = 'stock' | 'items' | 'documents' | 'counts' | 'exposure' | 'reorder' | 'units' | 'setup'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'stock', label: 'Stock' }, { key: 'items', label: 'Items' }, { key: 'documents', label: 'Stock documents' }, { key: 'counts', label: 'Stock counts' },
  { key: 'exposure', label: 'Loss exposure' }, { key: 'reorder', label: 'Reorder' }, { key: 'units', label: 'Units and lots' }, { key: 'setup', label: 'Locations and categories' },
]

export const DOC_KINDS: StockDocKind[] = ['receipt', 'issue', 'transfer', 'return_in', 'return_out', 'adjustment', 'landed_cost']
export const DOC_KIND_LABEL: Record<StockDocKind, string> = {
  receipt: 'Stock receipt', issue: 'Stock issue', transfer: 'Transfer between locations', return_in: 'Return from customer', return_out: 'Return to vendor', adjustment: 'Stock adjustment', landed_cost: 'Landed cost',
}
const DOC_KIND_SHORT: Record<StockDocKind, string> = { receipt: 'receipt', issue: 'issue', transfer: 'transfer', return_in: 'return from customer', return_out: 'return to vendor', adjustment: 'adjustment', landed_cost: 'landed cost' }
const DOC_STATUSES: StockDocStatus[] = ['draft', 'proposed', 'posted', 'rejected', 'reversed', 'cancelled']
/** "proposed" is the engine's word; on the screen it is what it means: awaiting approval */
export const docStatusLabel = (s: StockDocStatus) => (s === 'proposed' ? 'awaiting approval' : s)
export const COUNT_STATUS_LABEL: Record<StockCountStatus, string> = {
  open: 'open — being counted', counted: 'counted — awaiting review', reviewed: 'reviewed', proposed: 'adjustment awaiting approval', posted: 'adjustment posted', closed: 'closed — agrees with the books', cancelled: 'cancelled',
}
export const REASONS: StockReason[] = ['damage', 'expiry', 'theft', 'breakage', 'obsolescence', 'shrinkage', 'count_difference', 'found', 'sample', 'other']
export const REASON_LABEL: Record<StockReason, string> = {
  damage: 'Damage', expiry: 'Expiry', theft: 'Theft (recorded by a person)', breakage: 'Breakage', obsolescence: 'Obsolescence', shrinkage: 'Shrinkage', count_difference: 'Difference on counting', found: 'Stock found', sample: 'Given as a sample', other: 'Other',
}
export const CONDITIONS: HoldCondition[] = ['damaged', 'expired', 'obsolete', 'quarantine', 'missing']
export const CONDITION_LABEL: Record<HoldCondition, string> = { damaged: 'Damaged', expired: 'Expired', obsolete: 'Obsolete', quarantine: 'Held for inspection', missing: 'Missing' }
export const TRACKING_LABEL: Record<Tracking, string> = { none: 'Not tracked', lot: 'By lot or batch', serial: 'By serial number' }
export const VALUATION_LABEL: Record<Valuation, string> = { weighted_average: 'Weighted average', fifo: 'First in, first out' }
export const WAREHOUSE_KINDS: WarehouseKind[] = ['warehouse', 'store', 'site', 'office', 'transit', 'service_van']
export const WAREHOUSE_KIND_LABEL: Record<WarehouseKind, string> = { warehouse: 'Warehouse', store: 'Store', site: 'Site', office: 'Office', transit: 'In transit', service_van: 'Service van' }
const EXPOSURE_CLS: Record<ExposureKind, string> = { expired: 'neg', near_expiry: 'warn', damaged: 'warn', obsolete: 'warn', quarantine: 'cyan', missing: 'neg', slow_moving: '' }

/** A quantity: up to four decimals, grouped, never in exponent form. */
export const fmtQty = (v: Decimal.Value | null | undefined) => {
  const d = D(v).toDecimalPlaces(4)
  const [i, f] = d.abs().toFixed().split('.')
  return (d.isNegative() && !d.isZero() ? '−' : '') + groupDigits(i, false) + (f ? '.' + f : '')
}
export const Calculated = ({ title }: { title: string }) => <span className="chip" title={title}>CALCULATED</span>
/** free quantity of one item in one place: what is there, less what is awaiting approval to leave */
export const freeInPlace = (rows: StockRow[], itemId: ID, warehouseId: ID, lotId: ID | null) =>
  rows.filter((r) => r.item_id === itemId && r.warehouse_id === warehouseId && (r.lot_id ?? null) === (lotId ?? null)).reduce((s, r) => s.plus(r.qty).minus(r.pending_out), ZERO)

const has = (q: string, ...parts: (string | null | undefined)[]) => { const t = q.trim().toLowerCase(); return !t || parts.some((p) => (p ?? '').toLowerCase().includes(t)) }
const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
const NO_MANAGE = 'You need the permission inventory.manage to do this'

interface Inv {
  ids: ID[]
  categories: InvCategory[]
  warehouses: Warehouse[]
  items: InvItem[]
  rows: StockRow[]
  lots: InvLot[]
  holds: InvHold[]
  docs: StockDoc[]
  counts: StockCount[]
}

export default function Inventory() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('inventory.view', id))
  if (!ids.length) return <NoAccess eyebrow="Inventory" title="Inventory" perm="inventory.view" />
  return <InventoryView ids={ids} />
}

function InventoryView({ ids }: { ids: ID[] }) {
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const currency = useCurrency()
  const period = usePeriod()
  const idsKey = ids.join(',')
  const asOf = today()

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'stock'
  const go = (k: TabKey) => setSp({ tab: k }, { replace: true })

  const main = useAsync(async (): Promise<Inv> => {
    const [categories, warehouses, items, rows, lots, holds, docs, counts] = await Promise.all([
      api.listInvCategories(ids), api.listWarehouses(ids), api.listInvItems(ids), api.stockOnHand(ids), api.listInvLots({ companyIds: ids }), api.listInvHolds(ids), api.listStockDocs({ companyIds: ids }), api.listStockCounts(ids),
    ])
    return { ids, categories, warehouses, items, rows, lots, holds, docs, counts }
  }, [api, idsKey])

  // the books are read only where the person may read reports; an unauthorised read would return nothing and prove nothing
  const reportIds = ids.filter((id) => can('report.view', id))
  const reportKey = reportIds.join(',')
  const ledger = useAsync(async () => (reportIds.length ? api.ledgerBalances(reportIds, '1990-01-01', asOf) : []), [api, reportKey, asOf])

  const inv = main.data
  const against = useMemo(() => {
    if (!inv || !ledger.data || !reportIds.length) return null
    return stockAgainstBooks(inv.items.filter((i) => reportIds.includes(i.company_id)), inv.categories.filter((c) => reportIds.includes(c.company_id)), ledger.data, accounts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv, ledger.data, accounts, reportKey])
  const exposure = useMemo(() => (inv ? lossExposure(inv.items, inv.rows, inv.lots, inv.holds, asOf) : []), [inv, asOf])

  const mixed = new Set(ids.map((id) => companies.find((c) => c.id === id)?.base_currency)).size > 1
  const stockValue = sum((inv?.items ?? []).map((i) => i.value_on_hand))
  const inStock = (inv?.items ?? []).filter((i) => !D(i.qty_on_hand).isZero())
  const awaiting = (inv?.docs ?? []).filter((d) => d.status === 'proposed')
  const exposureTotal = sum(exposure.map((r) => r.value))
  const booksValue = sum((against ?? []).map((a) => a.books))
  const comparedStock = sum((against ?? []).map((a) => a.stock))
  const disagree = (against ?? []).filter((a) => !a.agrees)

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Inventory"
        subtitle={<>
          As at {fmtDate(asOf)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · items, locations, lots and serial numbers, stock documents, counts and exposure to loss. A stock document proposes an entry; stock changes in the books when a second person approves it.
          <DemoTag className="ml-2" />
        </>}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !inv && <Panel><Loading rows={6} label="Loading the stock position" /></Panel>}

      {inv && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <Stat label="Value of stock" value={stockValue} currency={currency} tone="gold" onClick={() => go('stock')}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> from the stock ledger, at the cost carried</span>} />
            {!reportIds.length ? (
              <Tile label="Value in the books" sub="Reading ledger balances needs the permission report.view, which your role does not include here. The comparison is not shown." onClick={() => go('stock')}>
                <span className="text-[15px] text-muted">Not shown</span>
              </Tile>
            ) : ledger.error ? (
              <Tile label="Value in the books" sub={`The ledger could not be read: ${ledger.error}`}><span className="text-[15px] text-muted">Not shown</span></Tile>
            ) : !against ? (
              <Tile label="Value in the books" sub="Reading the stock ledgers of the books"><Spinner /></Tile>
            ) : (
              <Stat label="Value in the books, same ledgers" value={booksValue} currency={currency} tone={disagree.length ? 'warn' : undefined} onClick={() => go('stock')}
                sub={<span className="flex flex-wrap items-center gap-1.5">
                  {disagree.length ? <span className="chip warn">differs by <Money value={comparedStock.minus(booksValue)} currency={currency} compact sign /></span> : <span className="chip pos">agrees with the stock ledger</span>}
                  {reportIds.length < ids.length && <span>{reportIds.length} of {ids.length} companies</span>}
                </span>} />
            )}
            <Tile label="Items in stock" onClick={() => go('items')} sub={`of ${inv.items.length} item${inv.items.length === 1 ? '' : 's'} on record · ${inv.warehouses.filter((w) => w.is_active).length} active location${inv.warehouses.filter((w) => w.is_active).length === 1 ? '' : 's'}`}>
              <span className="num">{inStock.length}</span>
            </Tile>
            <Tile label="Awaiting approval" tone={awaiting.length ? 'text-warn' : undefined} onClick={() => go('documents')}
              sub={awaiting.length ? <span>stock documents with a proposed entry · <Money value={sum(awaiting.map((d) => d.total_value))} currency={currency} compact /></span> : 'No stock document is waiting'}>
              <span className="num">{awaiting.length}</span>
            </Tile>
            <Stat label="Exposure to loss" value={exposureTotal} currency={currency} tone={exposureTotal.gt(0) ? 'warn' : undefined} onClick={() => go('exposure')}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Exposure /> {exposure.length} line{exposure.length === 1 ? '' : 's'} · still in the books at cost</span>} />
          </div>
          {mixed && <Note className="mb-4">The selected companies keep their books in different currencies. Totals on this screen add the figures as recorded, without conversion; each row shows its own currency.</Note>}

          <Tabs tabs={TABS} value={tab} onChange={go} />

          {tab === 'stock' && <StockTab inv={inv} against={against} reportIds={reportIds} ledgerError={ledger.error} ledgerLoading={ledger.loading} />}
          {tab === 'items' && <ItemsTab inv={inv} />}
          {tab === 'documents' && <DocumentsTab inv={inv} />}
          {tab === 'counts' && <CountsTab inv={inv} />}
          {tab === 'exposure' && <ExposureTab inv={inv} exposure={exposure} period={period} />}
          {tab === 'reorder' && <ReorderTab inv={inv} />}
          {tab === 'units' && <UnitsTab inv={inv} asOf={asOf} />}
          {tab === 'setup' && <SetupTab inv={inv} />}
        </>
      )}
    </div>
  )
}

function useCcy() {
  const companies = useApp((s) => s.companies)
  const base = useCurrency()
  return useMemo(() => { const m = new Map(companies.map((c) => [c.id, c.base_currency])); return (id: ID | null | undefined) => (id ? m.get(id) ?? base : base) }, [companies, base])
}

function CompanyFilter({ ids, value, onChange }: { ids: ID[]; value: string; onChange: (v: string) => void }) {
  const choices = useCompanyChoices(ids)
  if (choices.length < 2) return null
  return (
    <select className="field sm" style={{ width: 190 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Company">
      <option value="">All companies</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
    </select>
  )
}
const TextFilter = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
  <input className="field sm" style={{ width: 220 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
)

// ====================================================================== stock
type Against = ReturnType<typeof stockAgainstBooks>

function StockTab({ inv, against, reportIds, ledgerError, ledgerLoading }: { inv: Inv; against: Against | null; reportIds: ID[]; ledgerError: string | null; ledgerLoading: boolean }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const ccy = useCcy()
  const currency = useCurrency()
  const [company, setCompany] = useState('')
  const [place, setPlace] = useState('')
  const [category, setCategory] = useState('')
  const [show, setShow] = useState<'all' | 'in' | 'none'>('all')
  const [text, setText] = useState('')

  const positions = useMemo(() => stockPosition(inv.items, inv.rows), [inv.items, inv.rows])
  const whName = useMemo(() => warehouseName(inv.warehouses), [inv.warehouses])
  const whCode = useMemo(() => { const m = new Map(inv.warehouses.map((w) => [w.id, w.code])); return (id: ID) => m.get(id) ?? '—' }, [inv.warehouses])
  const catName = useMemo(() => { const m = new Map(inv.categories.map((c) => [c.id, c.name])); return (id: ID) => m.get(id) ?? '—' }, [inv.categories])

  const places = inv.warehouses.filter((w) => !company || w.company_id === company)
  const cats = inv.categories.filter((c) => !company || c.company_id === company)
  const shown = positions.filter((p) =>
    (!company || p.item.company_id === company) && (!category || p.item.category_id === category) && (!place || p.places.some((x) => x.warehouse_id === place))
    && (show === 'all' || (show === 'in' ? !p.qty.isZero() : p.qty.isZero())) && has(text, p.item.sku, p.item.name, p.item.manufacturer, p.item.model, p.item.hsn_code))
  const here = (p: ItemPosition) => p.places.find((x) => x.warehouse_id === place)

  const byCategory = inv.categories.map((c) => ({ label: `${c.name}${inv.ids.length > 1 ? ' · ' + code(c.company_id) : ''}`, value: sum(inv.items.filter((i) => i.category_id === c.id).map((i) => i.value_on_hand)).toNumber() })).filter((x) => x.value > 0)
  const total = sum(inv.items.map((i) => i.value_on_hand))

  const columns: Column<ItemPosition>[] = [
    { key: 'sku', header: 'Code', render: (p) => <span className="num text-[12.5px] text-gold">{p.item.sku}</span>, sort: (p) => p.item.sku, csv: (p) => p.item.sku },
    {
      key: 'item', header: 'Item', sort: (p) => p.item.name.toLowerCase(), csv: (p) => p.item.name,
      render: (p) => (
        <div className="min-w-0">
          <div className="text-ink">{p.item.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span>{code(p.item.company_id)} · {catName(p.item.category_id)}</span>
            {p.item.tracking !== 'none' && <span className="chip cyan">{p.item.tracking === 'serial' ? 'serial numbers' : 'lots'}</span>}
            {!p.agrees && <span className="chip warn" title="The movements in the stock ledger add up to a different quantity than the running balance of the item. Nothing is corrected here; the difference is stated.">stock ledger differs</span>}
          </div>
        </div>
      ),
    },
    { key: 'qty', header: 'In stock', align: 'right', render: (p) => <span className="num">{fmtQty(p.qty)} <span className="text-[11px] text-muted">{p.item.unit}</span></span>, sort: (p) => p.qty.toNumber(), csv: (p) => p.qty.toString() },
    {
      key: 'reserved', header: 'Reserved (awaiting approval)', align: 'right', sort: (p) => D(p.item.qty_reserved).toNumber(), csv: (p) => D(p.item.qty_reserved).toString(),
      render: (p) => (D(p.item.qty_reserved).isZero() ? <span className="text-muted">—</span> : <span className="num text-warn" title="Quantity on stock documents whose entry is awaiting approval to leave">{fmtQty(p.item.qty_reserved)}</span>),
    },
    { key: 'free', header: 'Free', align: 'right', render: (p) => <span className={cx('num', p.free.lte(0) ? 'text-muted' : 'text-ink')}>{fmtQty(p.free)}</span>, sort: (p) => p.free.toNumber(), csv: (p) => p.free.toString() },
    ...(place ? [{
      key: 'here', header: `In ${whCode(place)}`, align: 'right' as const, sort: (p: ItemPosition) => (here(p)?.qty ?? ZERO).toNumber(), csv: (p: ItemPosition) => (here(p)?.qty ?? ZERO).toString(),
      render: (p: ItemPosition) => { const x = here(p); return <span className="num text-ink">{fmtQty(x?.qty)}{x && !x.pendingOut.isZero() ? <span className="text-[11px] text-warn"> · {fmtQty(x.pendingOut)} leaving</span> : null}{x && !x.pendingIn.isZero() ? <span className="text-[11px] text-cyan"> · {fmtQty(x.pendingIn)} arriving</span> : null}</span> },
    }] : []),
    {
      key: 'cost', header: 'Unit cost (calculated)', align: 'right', sort: (p) => p.cost.toNumber(), csv: (p) => p.cost.toDecimalPlaces(6).toString(),
      render: (p) => (p.qty.isZero() ? <span className="text-muted">—</span> : <span title={`CALCULATED: value ÷ quantity = ${p.value.toFixed(2)} ÷ ${p.qty.toString()}`}><Money value={p.cost} currency={ccy(p.item.company_id)} className="text-ink2" /></span>),
    },
    { key: 'value', header: 'Value', align: 'right', render: (p) => <Money value={p.value} currency={ccy(p.item.company_id)} dim className="text-ink" />, sort: (p) => p.value.toNumber(), csv: (p) => p.value.toFixed(2) },
    {
      key: 'places', header: 'Places', sort: (p) => p.places.length, csv: (p) => p.places.map((x) => `${whCode(x.warehouse_id)} ${x.qty.toString()}`).join('; '),
      render: (p) => (p.places.length === 0 ? <span className="text-muted">—</span> : (
        <div className="text-[12px]">{p.places.map((x) => (
          <div key={x.warehouse_id} title={whName(x.warehouse_id)}><span className="text-ink2">{whCode(x.warehouse_id)}</span> <span className="num">{fmtQty(x.qty)}</span>
            {!x.pendingOut.isZero() && <span className="text-warn"> · {fmtQty(x.pendingOut)} leaving</span>}{!x.pendingIn.isZero() && <span className="text-cyan"> · {fmtQty(x.pendingIn)} arriving</span>}
          </div>
        ))}</div>
      )),
    },
    { key: 'in', header: 'Last in', render: (p) => (p.lastIn ? <span className="num text-[12.5px]">{fmtDate(p.lastIn)}</span> : <span className="text-muted">—</span>), sort: (p) => p.lastIn ?? '', csv: (p) => p.lastIn ?? '' },
    { key: 'out', header: 'Last out', render: (p) => (p.lastOut ? <span className="num text-[12.5px]">{fmtDate(p.lastOut)}</span> : <span className="text-muted">—</span>), sort: (p) => p.lastOut ?? '', csv: (p) => p.lastOut ?? '' },
  ]

  const againstColumns: Column<Against[number]>[] = [
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2" title={companyName(a.company_id)}>{code(a.company_id)}</span>, sort: (a) => code(a.company_id), csv: (a) => companyName(a.company_id) },
    { key: 'ledger', header: 'Stock ledger', render: (a) => (a.account ? <span><span className="num text-gold">{a.account.code}</span> <span className="text-ink">· {a.account.name}</span></span> : <span className="text-muted">Unknown ledger</span>), sort: (a) => a.account?.code ?? '', csv: (a) => (a.account ? `${a.account.code} ${a.account.name}` : '') },
    { key: 'stock', header: 'Value per the stock ledger', align: 'right', render: (a) => <Money value={a.stock} currency={ccy(a.company_id)} />, sort: (a) => a.stock.toNumber(), csv: (a) => a.stock.toFixed(2) },
    { key: 'books', header: 'Value in the books', align: 'right', render: (a) => <Money value={a.books} currency={ccy(a.company_id)} />, sort: (a) => a.books.toNumber(), csv: (a) => a.books.toFixed(2) },
    { key: 'diff', header: 'Difference', align: 'right', render: (a) => (a.agrees ? <span className="text-muted">—</span> : <Money value={a.difference} currency={ccy(a.company_id)} sign className="text-warn" />), sort: (a) => a.difference.toNumber(), csv: (a) => a.difference.toFixed(2) },
    { key: 'agrees', header: 'Do they agree', render: (a) => (a.agrees ? <span className="chip pos">agree</span> : <span className="chip warn">differ</span>), sort: (a) => Number(a.agrees), csv: (a) => (a.agrees ? 'Agree' : 'Differ') },
    { key: 'open', header: 'Ledger entries', align: 'right', render: (a) => <button className="link text-[12.5px]" onClick={() => nav(ledgerLink({ accounts: [a.account_id] }))}>Open the ledger</button> },
  ]
  const left = inv.ids.filter((id) => !reportIds.includes(id))

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.5fr]">
        <Section title="Value of stock by category" right={<Truth state="ACTUAL" />}>
          <Panel className="p-4" lit={false}>
            {byCategory.length ? <Donut data={byCategory} centre={<div><div className="text-[11px] text-muted">Stock</div><Money value={total} currency={currency} compact className="text-[15px]" /></div>} />
              : <Empty title="No stock is carried" body="No item holds stock in the selected companies." />}
          </Panel>
        </Section>

        <Section title="The stock ledger against the books" right={<Explain title="The stock ledger against the books" text="Every movement that changes the value of stock belongs to a stock document whose accounting entry was approved. So the value of the items of a category and the balance of its stock ledger in the books should be the same figure. Where they differ, an entry was made in that ledger without a stock document, or a stock document was posted to another ledger. The screen states the difference; a person finds the cause." formula="value per the stock ledger (sum of the value of the items) − balance of the same ledger in the books" source="Source: item balances from the stock ledger, and posted accounting entries in the general ledger up to today." />}>
          <Panel lit={false}>
            {!reportIds.length ? <div className="p-4"><Note kind="warn">The comparison with the books is not shown. Reading ledger balances needs the permission <span className="num">report.view</span>, which your role does not include in the selected companies. The stock figures on this screen are complete; only the comparison is left out.</Note></div>
              : ledgerError ? <ErrorBox message={ledgerError} />
              : !against ? <Loading rows={3} label={ledgerLoading ? 'Reading the books' : 'Loading'} />
              : <DataTable columns={againstColumns} rows={against} rowKey={(a) => a.account_id} exportName="stock-against-books" rowClass={(a) => (a.agrees ? undefined : 'bg-warnsoft')}
                  empty={{ title: 'No category is set up', body: 'A category names the stock ledger of its items. Add one under Locations and categories.' }} />}
            {reportIds.length > 0 && left.length > 0 && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">Not compared, because your role does not read reports there: {left.map((id) => code(id)).join(', ')}.</div>}
          </Panel>
        </Section>
      </div>

      <Section title="Position by item">
        <Panel lit={false}>
          <DataTable columns={columns} rows={shown} rowKey={(p) => p.item.id} onRow={(p) => nav('/inventory/items/' + p.item.id)} exportName="stock-position" initialSort={{ key: 'value', dir: 'desc' }}
            toolbar={<>
              <CompanyFilter ids={inv.ids} value={company} onChange={(v) => { setCompany(v); setPlace(''); setCategory('') }} />
              <select className="field sm" style={{ width: 200 }} value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Location"><option value="">All locations</option>{places.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>
              <select className="field sm" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select className="field sm" style={{ width: 150 }} value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Stock held"><option value="all">All items</option><option value="in">In stock</option><option value="none">Nothing in stock</option></select>
              <TextFilter value={text} onChange={setText} placeholder="Code, name, maker or model" />
            </>}
            footer={<tr>
              <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={place ? 7 : 6}>Total · {shown.length} item{shown.length === 1 ? '' : 's'}</td>
              <td className={cx(foot, 'r')}><Money value={sum(shown.map((p) => p.value))} currency={currency} className="font-medium text-ink" /></td>
              <td className={foot} colSpan={3} />
            </tr>}
            empty={{ title: 'No item matches', body: inv.items.length ? 'Change the filter to see more items.' : 'No item is on record. Add categories and items first, then receive stock.' }} />
          <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
            Free = in stock − reserved. Reserved is the quantity on stock documents awaiting approval to leave. Unit cost is CALCULATED as value ÷ quantity; for an item valued first in, first out it is the average of the receipts still in stock. The value of stock in one location is not kept separately: value belongs to the item.
          </div>
        </Panel>
      </Section>
    </div>
  )
}

// ====================================================================== items
function ItemsTab({ inv }: { inv: Inv }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const ccy = useCcy()
  const [company, setCompany] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<InvItem | null>(null)
  const manageIds = inv.ids.filter((id) => can('inventory.manage', id))
  const catName = useMemo(() => { const m = new Map(inv.categories.map((c) => [c.id, c.name])); return (id: ID) => m.get(id) ?? '—' }, [inv.categories])
  const shown = inv.items.filter((i) => (!company || i.company_id === company) && (!category || i.category_id === category) && (!status || i.status === status) && has(text, i.sku, i.name, i.manufacturer, i.model, i.hsn_code, i.description))

  const columns: Column<InvItem>[] = [
    { key: 'sku', header: 'Code (SKU)', render: (i) => <span className="num text-[12.5px] text-gold">{i.sku}</span>, sort: (i) => i.sku, csv: (i) => i.sku },
    { key: 'name', header: 'Item', render: (i) => <div className="min-w-0"><div className="text-ink">{i.name}</div>{(i.manufacturer || i.model) && <div className="text-[11px] text-muted">{[i.manufacturer, i.model].filter(Boolean).join(' · ')}</div>}</div>, sort: (i) => i.name.toLowerCase(), csv: (i) => i.name },
    { key: 'company', header: 'Company', render: (i) => <span className="text-ink2">{code(i.company_id)}</span>, sort: (i) => code(i.company_id), csv: (i) => code(i.company_id) },
    { key: 'category', header: 'Category', render: (i) => <span className="text-ink2">{catName(i.category_id)}</span>, sort: (i) => catName(i.category_id), csv: (i) => catName(i.category_id) },
    { key: 'unit', header: 'Unit', render: (i) => <span className="text-ink2">{i.unit}</span>, sort: (i) => i.unit, csv: (i) => i.unit },
    { key: 'tracking', header: 'Tracking', render: (i) => <span className={cx('chip', i.tracking !== 'none' && 'cyan')}>{TRACKING_LABEL[i.tracking]}</span>, sort: (i) => i.tracking, csv: (i) => TRACKING_LABEL[i.tracking] },
    { key: 'valuation', header: 'Valuation', render: (i) => <span className="text-[12.5px] text-ink2">{VALUATION_LABEL[i.valuation_method]}</span>, sort: (i) => i.valuation_method, csv: (i) => VALUATION_LABEL[i.valuation_method] },
    { key: 'hsn', header: 'HSN', render: (i) => <span className="num text-[12.5px] text-ink2">{i.hsn_code ?? '—'}</span>, sort: (i) => i.hsn_code ?? '', csv: (i) => i.hsn_code ?? '' },
    { key: 'reorder', header: 'Reorder at', align: 'right', render: (i) => (i.reorder_level === null ? <span className="text-muted">—</span> : <span className="num">{fmtQty(i.reorder_level)}</span>), sort: (i) => D(i.reorder_level).toNumber(), csv: (i) => (i.reorder_level === null ? '' : D(i.reorder_level).toString()) },
    { key: 'price', header: 'Sale price', align: 'right', render: (i) => (i.sale_price === null ? <span className="text-muted">—</span> : <Money value={i.sale_price} currency={ccy(i.company_id)} />), sort: (i) => D(i.sale_price).toNumber(), csv: (i) => (i.sale_price === null ? '' : D(i.sale_price).toFixed(2)) },
    { key: 'qty', header: 'In stock', align: 'right', render: (i) => <span className="num">{fmtQty(i.qty_on_hand)}</span>, sort: (i) => D(i.qty_on_hand).toNumber(), csv: (i) => D(i.qty_on_hand).toString() },
    { key: 'status', header: 'Status', render: (i) => <StatusChip status={i.status} />, sort: (i) => i.status, csv: (i) => i.status },
    {
      key: 'edit', header: '', align: 'right',
      render: (i) => <button className="btn sm ghost" disabled={!can('inventory.manage', i.company_id)} title={can('inventory.manage', i.company_id) ? undefined : NO_MANAGE} onClick={(e) => { e.stopPropagation(); setEditing(i) }}><Pencil size={13} /> Edit</button>,
    },
  ]

  return (
    <Section title="Item master" right={<button className="btn sm primary" disabled={!manageIds.length || !inv.categories.some((c) => manageIds.includes(c.company_id))} title={!manageIds.length ? NO_MANAGE : !inv.categories.some((c) => manageIds.includes(c.company_id)) ? 'Add a category first: an item belongs to a category, which names its stock ledger' : undefined} onClick={() => setAdding(true)}><Plus size={13} /> Add an item</button>}>
      <Panel lit={false}>
        <DataTable columns={columns} rows={shown} rowKey={(i) => i.id} onRow={(i) => nav('/inventory/items/' + i.id)} exportName="items"
          toolbar={<>
            <CompanyFilter ids={inv.ids} value={company} onChange={(v) => { setCompany(v); setCategory('') }} />
            <select className="field sm" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{inv.categories.filter((c) => !company || c.company_id === company).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="field sm" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            <TextFilter value={text} onChange={setText} placeholder="Code, name, maker, model or HSN" />
          </>}
          empty={{ title: 'No item matches', body: inv.items.length ? 'Change the filter to see more items.' : 'No item is on record in the selected companies.', icon: <Tags size={20} /> }} />
      </Panel>
      <ItemForm open={adding} companyIds={manageIds} categories={inv.categories} onClose={() => setAdding(false)} />
      <ItemForm open={!!editing} item={editing} companyIds={manageIds} categories={inv.categories} onClose={() => setEditing(null)} />
    </Section>
  )
}

interface ItemDraft {
  company_id: ID; sku: string; name: string; category_id: ID; description: string; unit: string; tracking: Tracking; valuation: Valuation | ''; tax_code_id: ID; hsn_code: string
  reorder_level: string; reorder_qty: string; shelf_life_days: string; slow_after_days: string; manufacturer: string; model: string; sale_price: string; unit_weight: string; status: InvItem['status']; reason: string
}
const plain = (v: Decimal.Value | null | undefined) => (v === null || v === undefined || v === '' ? '' : D(v).toString())

/** Adds an item or changes one. Changing asks for the reason, which is written to the history of the item. */
export function ItemForm({ open, item, companyIds, categories, onClose }: { open: boolean; item?: InvItem | null; companyIds: ID[]; categories: InvCategory[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const start = (): ItemDraft => ({
    company_id: item?.company_id ?? choices.find((c) => categories.some((k) => k.company_id === c.id && k.is_active))?.id ?? choices[0]?.id ?? '', sku: item?.sku ?? '', name: item?.name ?? '', category_id: item?.category_id ?? '', description: item?.description ?? '',
    unit: item?.unit ?? 'unit', tracking: item?.tracking ?? 'none', valuation: item?.valuation_method ?? '', tax_code_id: item?.tax_code_id ?? '', hsn_code: item?.hsn_code ?? '',
    reorder_level: plain(item?.reorder_level), reorder_qty: plain(item?.reorder_qty), shelf_life_days: item?.shelf_life_days?.toString() ?? '', slow_after_days: item?.slow_after_days?.toString() ?? '',
    manufacturer: item?.manufacturer ?? '', model: item?.model ?? '', sale_price: plain(item?.sale_price), unit_weight: plain(item?.unit_weight), status: item?.status ?? 'active', reason: '',
  })
  const [v, setV] = useState<ItemDraft>(start)
  useEffect(() => { if (open) setV(start()) }, [open, item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const taxes = useAsync(async () => (open && v.company_id ? api.listTaxCodes([v.company_id]) : []), [api, open, v.company_id])

  const cats = categories.filter((c) => c.company_id === v.company_id && (c.is_active || c.id === v.category_id))
  const cat = categories.find((c) => c.id === v.category_id)
  const holds = !!item && (!D(item.qty_on_hand).isZero() || !D(item.value_on_hand).isZero())
  const set = (patch: Partial<ItemDraft>) => setV((x) => ({ ...x, ...patch }))
  const whole = (s: string) => s.replace(/[^\d]/g, '')

  const problem = !v.company_id ? 'Choose the company.' : !v.sku.trim() ? 'Enter the code (SKU) of the item.' : !v.name.trim() ? 'Enter the name of the item.' : !v.category_id ? 'Choose the category.'
    : item && v.status === 'inactive' && !D(item.qty_on_hand).isZero() ? 'An item that holds stock cannot be made inactive.'
    : item && !v.reason.trim() ? 'Say why the item is being changed.' : null

  const save = async () => {
    const input: InvItemInput = {
      id: item?.id, company_id: v.company_id, sku: v.sku.trim(), name: v.name.trim(), category_id: v.category_id, description: orNull(v.description), unit: v.unit.trim() || 'unit', tracking: v.tracking,
      valuation_method: v.valuation || undefined, tax_code_id: v.tax_code_id || null, hsn_code: orNull(v.hsn_code), reorder_level: orNull(v.reorder_level), reorder_qty: orNull(v.reorder_qty),
      shelf_life_days: v.shelf_life_days ? Number(v.shelf_life_days) : null, slow_after_days: v.slow_after_days ? Number(v.slow_after_days) : null, manufacturer: orNull(v.manufacturer), model: orNull(v.model),
      sale_price: orNull(v.sale_price), unit_weight: orNull(v.unit_weight), attrs: item?.attrs ?? {}, ...(item ? { status: v.status, reason: v.reason.trim() } : {}),
    }
    const id = await act(() => api.saveInvItem(input), item ? 'Item changed' : 'Item added')
    if (id) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={item ? `Edit ${item.sku}` : 'Add an item'} subtitle="An item carries no stock until a stock receipt for it is approved." width={760}
      footer={<>
        {problem && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {item ? 'Save the change' : 'Add the item'}</button>
      </>}>
      {holds && <Note kind="warn" className="mb-4">This item holds stock. Its tracking, its valuation method and the stock ledger of its category cannot change until the stock is brought to zero.</Note>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company">
          <select className="field" value={v.company_id} disabled={!!item} onChange={(e) => set({ company_id: e.target.value, category_id: '', tax_code_id: '' })}>
            <option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            {item && !choices.some((c) => c.id === item.company_id) && <option value={item.company_id}>This company</option>}
          </select>
        </Field>
        <Field label="Code (SKU)" hint="Unique within the company. Stored in capitals."><input className="field num" value={v.sku} onChange={(e) => set({ sku: e.target.value })} autoFocus={!item} /></Field>
        <Field label="Unit" hint="What one of it is: unit, box, bottle, kg"><input className="field" value={v.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
        <Field label="Name" className="sm:col-span-2 lg:col-span-3"><input className="field" value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Category" hint={cat ? 'The category names the stock ledger and the cost of sales ledger.' : cats.length ? undefined : 'This company has no category. Add one under Locations and categories.'}>
          <select className="field" value={v.category_id} onChange={(e) => set({ category_id: e.target.value })}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Tracking" hint={v.tracking === 'serial' ? 'Every unit has its own number and its own history.' : v.tracking === 'lot' ? 'Every batch has a number and may carry an expiry date.' : undefined}>
          <select className="field" value={v.tracking} disabled={holds} onChange={(e) => set({ tracking: e.target.value as Tracking })}>{(['none', 'lot', 'serial'] as Tracking[]).map((t) => <option key={t} value={t}>{TRACKING_LABEL[t]}</option>)}</select>
        </Field>
        <Field label="Valuation method" hint="How the cost of what leaves stock is worked out.">
          <select className="field" value={v.valuation} disabled={holds} onChange={(e) => set({ valuation: e.target.value as Valuation | '' })}>
            {!item && <option value="">As the category{cat ? ` (${VALUATION_LABEL[cat.valuation_method].toLowerCase()})` : ''}</option>}
            {(['weighted_average', 'fifo'] as Valuation[]).map((m) => <option key={m} value={m}>{VALUATION_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field label="Tax code">
          <select className="field" value={v.tax_code_id} onChange={(e) => set({ tax_code_id: e.target.value })}><option value="">None</option>{(taxes.data ?? []).filter((t) => t.company_id === v.company_id && (t.is_active || t.id === v.tax_code_id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
        <Field label="HSN code"><input className="field num" value={v.hsn_code} onChange={(e) => set({ hsn_code: e.target.value })} /></Field>
        <Field label="Sale price" hint="A list price. It is not used to value stock."><input className="field num" inputMode="decimal" value={v.sale_price} onChange={(e) => set({ sale_price: digits(e.target.value) })} /></Field>
        <Field label="Reorder level" hint="More is suggested when free stock falls to this."><input className="field num" inputMode="decimal" value={v.reorder_level} onChange={(e) => set({ reorder_level: digits(e.target.value) })} /></Field>
        <Field label="Reorder quantity"><input className="field num" inputMode="decimal" value={v.reorder_qty} onChange={(e) => set({ reorder_qty: digits(e.target.value) })} /></Field>
        <Field label="Weight of one unit" hint="Used to share landed cost by weight."><input className="field num" inputMode="decimal" value={v.unit_weight} onChange={(e) => set({ unit_weight: digits(e.target.value) })} /></Field>
        <Field label="Shelf life, in days" hint="Gives a new lot its expiry date when none is entered."><input className="field num" inputMode="numeric" value={v.shelf_life_days} onChange={(e) => set({ shelf_life_days: whole(e.target.value) })} /></Field>
        <Field label="Slow moving after, in days" hint="Blank uses 180 days."><input className="field num" inputMode="numeric" value={v.slow_after_days} onChange={(e) => set({ slow_after_days: whole(e.target.value) })} /></Field>
        {item && <Field label="Status"><select className="field" value={v.status} onChange={(e) => set({ status: e.target.value as InvItem['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
        <Field label="Manufacturer"><input className="field" value={v.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} /></Field>
        <Field label="Model"><input className="field" value={v.model} onChange={(e) => set({ model: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea className="field" rows={2} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        {item && <Field label="Reason for the change (required — recorded in the history)" className="sm:col-span-2 lg:col-span-3"><textarea className="field" rows={2} value={v.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Why is the item being changed?" /></Field>}
      </div>
    </Modal>
  )
}

// ====================================================================== documents
function DocumentsTab({ inv }: { inv: Inv }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const ccy = useCcy()
  const currency = useCurrency()
  const partyName = usePartyName()
  const [company, setCompany] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')
  const manageIds = inv.ids.filter((id) => can('inventory.manage', id))
  const whCode = useMemo(() => { const m = new Map(inv.warehouses.map((w) => [w.id, w])); return (id: ID | null) => (id ? m.get(id)?.code ?? '—' : '—') }, [inv.warehouses])
  const whName = useMemo(() => warehouseName(inv.warehouses), [inv.warehouses])
  const shown = inv.docs.filter((d) => (!company || d.company_id === company) && (!kind || d.kind === kind) && (!status || d.status === status) && has(text, d.doc_no, d.reason, partyName(d.party_id), whName(d.warehouse_id)))
  const create = (k: StockDocKind) => { const c = company && manageIds.includes(company) ? company : manageIds.length === 1 ? manageIds[0] : ''; nav(`/inventory/docs/new?kind=${k}${c ? '&company=' + c : ''}`) }

  const columns: Column<StockDoc>[] = [
    { key: 'no', header: 'Number', render: (d) => <span className="num text-[12.5px] text-gold">{d.doc_no}</span>, sort: (d) => d.doc_no, csv: (d) => d.doc_no },
    { key: 'date', header: 'Date', render: (d) => <span className="num text-[12.5px]">{fmtDate(d.doc_date)}</span>, sort: (d) => d.doc_date, csv: (d) => d.doc_date },
    { key: 'kind', header: 'Document', render: (d) => <span className="chip">{DOC_KIND_LABEL[d.kind]}</span>, sort: (d) => d.kind, csv: (d) => DOC_KIND_LABEL[d.kind] },
    { key: 'company', header: 'Company', render: (d) => <span className="text-ink2">{code(d.company_id)}</span>, sort: (d) => code(d.company_id), csv: (d) => code(d.company_id) },
    { key: 'place', header: 'Location', render: (d) => <span className="text-[12.5px] text-ink2" title={whName(d.warehouse_id) + (d.to_warehouse_id ? ' → ' + whName(d.to_warehouse_id) : '')}>{whCode(d.warehouse_id)}{d.to_warehouse_id ? ` → ${whCode(d.to_warehouse_id)}` : ''}</span>, sort: (d) => whCode(d.warehouse_id), csv: (d) => whName(d.warehouse_id) + (d.to_warehouse_id ? ' → ' + whName(d.to_warehouse_id) : '') },
    { key: 'party', header: 'Party', render: (d) => <span className="text-ink2">{partyName(d.party_id)}</span>, sort: (d) => partyName(d.party_id).toLowerCase(), csv: (d) => (d.party_id ? partyName(d.party_id) : '') },
    { key: 'reason', header: 'Reason', render: (d) => <span className="text-[12.5px] text-ink2">{d.reason ?? '—'}{d.count_id ? <span className="chip ml-1.5 cyan">from a stock count</span> : null}</span>, csv: (d) => d.reason ?? '' },
    { key: 'value', header: 'Value', align: 'right', render: (d) => (d.kind === 'transfer' ? <span title="A transfer changes the place of stock, not its value"><Money value={d.total_value} currency={ccy(d.company_id)} className="text-muted" /></span> : <Money value={d.total_value} currency={ccy(d.company_id)} dim />), sort: (d) => D(d.total_value).toNumber(), csv: (d) => D(d.total_value).toFixed(2) },
    { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status} label={d.kind === 'transfer' && d.status === 'posted' ? 'recorded — no entry needed' : docStatusLabel(d.status)} />, sort: (d) => d.status, csv: (d) => docStatusLabel(d.status) },
    { key: 'journal', header: 'Entry', render: (d) => (d.journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav('/journals/' + d.journal_id) }}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
  ]

  return (
    <div className="space-y-4">
      <Panel className="p-4" lit={false}>
        <div className="eyebrow mb-2.5">Prepare a stock document</div>
        <div className="no-print flex flex-wrap gap-2">
          {DOC_KINDS.map((k) => <button key={k} className={cx('btn sm', k === 'receipt' && 'primary')} disabled={!manageIds.length} title={manageIds.length ? undefined : NO_MANAGE} onClick={() => create(k)}><Plus size={13} /> New {DOC_KIND_SHORT[k]}</button>)}
        </div>
        <div className="mt-2.5 text-[11.5px] text-muted">A document is saved as a draft. Proposing it proposes the accounting entry; stock and books change when a second person approves that entry. A transfer changes the place of stock and not its value, so it needs no entry.</div>
      </Panel>
      <Section title="Stock documents">
        <Panel lit={false}>
          <DataTable columns={columns} rows={shown} rowKey={(d) => d.id} onRow={(d) => nav('/inventory/docs/' + d.id)} exportName="stock-documents"
            toolbar={<>
              <CompanyFilter ids={inv.ids} value={company} onChange={setCompany} />
              <select className="field sm" style={{ width: 210 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of document"><option value="">Every kind</option>{DOC_KINDS.map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}</select>
              <select className="field sm" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{DOC_STATUSES.map((s) => <option key={s} value={s}>{docStatusLabel(s)}</option>)}</select>
              <TextFilter value={text} onChange={setText} placeholder="Number, party, location or reason" />
            </>}
            footer={<tr>
              <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={7}>{shown.length} document{shown.length === 1 ? '' : 's'} · value of those posted</td>
              <td className={cx(foot, 'r')}><Money value={sum(shown.filter((d) => d.status === 'posted' && d.kind !== 'transfer').map((d) => d.total_value))} currency={currency} /></td>
              <td className={foot} colSpan={2} />
            </tr>}
            empty={{ title: 'No stock document matches', body: inv.docs.length ? 'Change the filter to see more documents.' : 'No stock document has been prepared in the selected companies.', icon: <Boxes size={20} /> }} />
        </Panel>
      </Section>
    </div>
  )
}

// ====================================================================== counts
function CountsTab({ inv }: { inv: Inv }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const code = useCompanyCode()
  const { act, busy } = useAction()
  const whName = useMemo(() => warehouseName(inv.warehouses), [inv.warehouses])
  // a count is started by the person who will answer for it; it is counted by those who hold inventory.count
  const countIds = inv.ids.filter((id) => can('inventory.approve', id) || can('inventory.manage', id))
  const choices = useCompanyChoices(countIds)
  const [open, setOpen] = useState(false)
  const [v, setV] = useState({ company_id: '', warehouse_id: '', count_date: today(), category_id: '', frozen: true, note: '' })
  useEffect(() => { if (open) setV({ company_id: (choices.find((c) => inv.warehouses.some((w) => w.company_id === c.id && w.is_active)) ?? choices[0])?.id ?? '', warehouse_id: '', count_date: today(), category_id: '', frozen: true, note: '' }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const places = inv.warehouses.filter((w) => w.company_id === v.company_id && w.is_active)
  const busyPlace = inv.counts.find((c) => c.warehouse_id === v.warehouse_id && ['open', 'counted', 'reviewed', 'proposed'].includes(c.status))
  const waiting = inv.rows.some((r) => r.warehouse_id === v.warehouse_id && (!D(r.pending_in).isZero() || !D(r.pending_out).isZero()))
  const problem = !v.company_id ? 'Choose the company.' : !v.warehouse_id ? 'Choose the location to be counted.' : !v.count_date ? 'Enter the date of the count.'
    : busyPlace ? `Stock count ${busyPlace.count_no} is already open for this location.`
    : v.frozen && waiting ? 'Stock documents for this location are awaiting approval. Approve or reject them first, or count without freezing the stock.' : null
  const start = async () => {
    const id = await act(() => api.createStockCount({ company_id: v.company_id, warehouse_id: v.warehouse_id, count_date: v.count_date, category_id: v.category_id || undefined, frozen: v.frozen, note: v.note.trim() || undefined }), 'Stock count opened')
    if (id) { setOpen(false); nav('/inventory/counts/' + id) }
  }

  const columns: Column<StockCount>[] = [
    { key: 'no', header: 'Number', render: (c) => <span className="num text-[12.5px] text-gold">{c.count_no}</span>, sort: (c) => c.count_no, csv: (c) => c.count_no },
    { key: 'date', header: 'Date of count', render: (c) => <span className="num text-[12.5px]">{fmtDate(c.count_date)}</span>, sort: (c) => c.count_date, csv: (c) => c.count_date },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2">{code(c.company_id)}</span>, sort: (c) => code(c.company_id), csv: (c) => code(c.company_id) },
    { key: 'place', header: 'Location', render: (c) => <span className="text-ink">{whName(c.warehouse_id)}</span>, sort: (c) => whName(c.warehouse_id), csv: (c) => whName(c.warehouse_id) },
    { key: 'frozen', header: 'Stock while counting', render: (c) => (c.frozen ? <span className="chip cyan">frozen</span> : <span className="chip" title="Stock could move during the count; the books were photographed when it opened">snapshot only</span>), sort: (c) => Number(c.frozen), csv: (c) => (c.frozen ? 'Frozen' : 'Snapshot only') },
    { key: 'snapshot', header: 'Books as at', render: (c) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(c.snapshot_at)}</span>, sort: (c) => c.snapshot_at, csv: (c) => c.snapshot_at },
    { key: 'counted', header: 'Counted', render: (c) => (c.counted_at ? <span className="num text-[12.5px]">{fmtDateTime(c.counted_at)}</span> : <span className="text-muted">—</span>), sort: (c) => c.counted_at ?? '', csv: (c) => c.counted_at ?? '' },
    { key: 'reviewed', header: 'Reviewed', render: (c) => (c.reviewed_at ? <span className="num text-[12.5px]">{fmtDateTime(c.reviewed_at)}</span> : <span className="text-muted">—</span>), sort: (c) => c.reviewed_at ?? '', csv: (c) => c.reviewed_at ?? '' },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} label={COUNT_STATUS_LABEL[c.status]} />, sort: (c) => c.status, csv: (c) => COUNT_STATUS_LABEL[c.status] },
    { key: 'doc', header: 'Adjustment', render: (c) => (c.doc_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav('/inventory/docs/' + c.doc_id) }}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
  ]

  return (
    <Section title="Physical stock counts" right={<button className="btn sm primary" disabled={!countIds.length} title={countIds.length ? undefined : 'You need the permission inventory.approve or inventory.manage to start a count'} onClick={() => setOpen(true)}><ClipboardList size={13} /> Start a count</button>}>
      <Note className="mb-3">A count records what is found. It changes nothing in the books. The path is: snapshot of the books → count → differences with their reasons → review by a second person → an adjustment whose entry is approved.</Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={inv.counts} rowKey={(c) => c.id} onRow={(c) => nav('/inventory/counts/' + c.id)} exportName="stock-counts"
          empty={{ title: 'No stock count', body: 'No count has been opened in the selected companies.', icon: <ClipboardList size={20} /> }} />
      </Panel>

      <Modal open={open} onClose={() => setOpen(false)} title="Start a stock count" subtitle="The books are photographed now: the count sheet lists what they say is in the location." width={620}
        footer={<>
          {problem && v.warehouse_id && <span className="mr-auto max-w-[340px] text-[12px] text-warn">{problem}</span>}
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={!!problem || busy} onClick={() => void start()}>{busy ? <Spinner /> : <ClipboardList size={15} />} Open the count</button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company"><select className="field" value={v.company_id} onChange={(e) => setV({ ...v, company_id: e.target.value, warehouse_id: '', category_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
          <Field label="Location" hint={v.company_id && !places.length ? 'This company has no active location.' : undefined}><select className="field" value={v.warehouse_id} onChange={(e) => setV({ ...v, warehouse_id: e.target.value })}><option value="">Choose…</option>{places.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
          <Field label="Date of the count"><input type="date" className="field" value={v.count_date} max={today()} onChange={(e) => setV({ ...v, count_date: e.target.value })} /></Field>
          <Field label="Category (optional)" hint="Leave empty to count everything in the location."><select className="field" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}><option value="">Every category</option>{inv.categories.filter((c) => c.company_id === v.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink2 sm:col-span-2">
            <input type="checkbox" className="mt-[3px]" checked={v.frozen} onChange={(e) => setV({ ...v, frozen: e.target.checked })} />
            <span><span className="text-ink">Freeze the stock of this location while it is counted.</span> No stock document for the location can be proposed until the count is completed or cancelled. Without freezing, stock may move during the count and the differences will include those movements.</span>
          </label>
          <Field label="Note" className="sm:col-span-2"><textarea className="field" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="For example: month-end count, counted by two people" /></Field>
        </div>
      </Modal>
    </Section>
  )
}

// ====================================================================== exposure
interface HoldPreset { company_id: ID; item_id: ID; warehouse_id: ID; lot_id: ID | null; qty: string; condition: HoldCondition }

function ExposureTab({ inv, exposure, period }: { inv: Inv; exposure: ExposureRow[]; period: { from: string; to: string; label: string } }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const code = useCompanyCode()
  const ccy = useCcy()
  const currency = useCurrency()
  const { act, busy } = useAction()
  const whName = useMemo(() => warehouseName(inv.warehouses), [inv.warehouses])
  const [kind, setKind] = useState('')
  const [holdStatus, setHoldStatus] = useState('open')
  const [noting, setNoting] = useState<HoldPreset | 'new' | null>(null)
  const [releasing, setReleasing] = useState<InvHold | null>(null)
  const manageIds = inv.ids.filter((id) => can('inventory.manage', id))

  // posted loss needs the lines of the adjustments, which the list does not carry
  const adjustments = inv.docs.filter((d) => d.kind === 'adjustment' && d.status === 'posted' && d.doc_date >= period.from && d.doc_date <= period.to)
  const adjKey = adjustments.map((d) => d.id).join(',')
  const lossDocs = useAsync(() => Promise.all(adjustments.map((d) => api.getStockDoc(d.id))), [api, adjKey])
  const posted = useMemo(() => postedLoss(lossDocs.data ?? [], period.from, period.to), [lossDocs.data, period.from, period.to])
  const postedTotal = sum(posted.map((p) => p.value))

  const totals = exposureTotals(exposure)
  const total = sum(exposure.map((r) => r.value))
  const shown = exposure.filter((r) => !kind || r.kind === kind)
  const items = useMemo(() => new Map(inv.items.map((i) => [i.id, i])), [inv.items])
  const lots = useMemo(() => new Map(inv.lots.map((l) => [l.id, l])), [inv.lots])
  const holds = inv.holds.filter((h) => !holdStatus || h.status === holdStatus)
  const writeOff = (id: ID) => nav(`/inventory/docs/new?kind=adjustment&hold=${id}`)
  const NOTED: Partial<Record<ExposureKind, HoldCondition>> = { expired: 'expired', near_expiry: 'quarantine', slow_moving: 'obsolete' }

  const columns: Column<ExposureRow>[] = [
    { key: 'kind', header: 'Condition', render: (r) => <span className={cx('chip', EXPOSURE_CLS[r.kind])}>{EXPOSURE_LABEL[r.kind]}</span>, sort: (r) => r.kind, csv: (r) => EXPOSURE_LABEL[r.kind] },
    { key: 'item', header: 'Item', render: (r) => <div className="min-w-0"><div className="text-ink"><span className="num text-[12px] text-gold">{r.item.sku}</span> · {r.item.name}</div><div className="text-[11px] text-muted">{code(r.item.company_id)}</div></div>, sort: (r) => r.item.sku, csv: (r) => `${r.item.sku} ${r.item.name}` },
    { key: 'lot', header: 'Lot or serial', render: (r) => <span className="num text-[12.5px] text-ink2">{r.lot?.lot_no ?? '—'}</span>, sort: (r) => r.lot?.lot_no ?? '', csv: (r) => r.lot?.lot_no ?? '' },
    { key: 'place', header: 'Location', render: (r) => <span className="text-[12.5px] text-ink2">{whName(r.warehouse_id)}</span>, sort: (r) => whName(r.warehouse_id), csv: (r) => whName(r.warehouse_id) },
    { key: 'qty', header: 'Quantity', align: 'right', render: (r) => <span className="num">{fmtQty(r.qty)} <span className="text-[11px] text-muted">{r.item.unit}</span></span>, sort: (r) => r.qty.toNumber(), csv: (r) => r.qty.toString() },
    { key: 'value', header: 'Exposure (estimate)', align: 'right', render: (r) => <span title="EXPOSURE: quantity × the cost the item is carried at. It is not a loss."><Money value={r.value} currency={ccy(r.item.company_id)} className="text-warn" /></span>, sort: (r) => r.value.toNumber(), csv: (r) => r.value.toFixed(2) },
    { key: 'since', header: 'Since', render: (r) => (r.since ? <span className="num text-[12.5px]">{fmtDate(r.since)}</span> : <span className="text-muted">—</span>), sort: (r) => r.since ?? '', csv: (r) => r.since ?? '' },
    { key: 'says', header: 'What is recorded', render: (r) => <span className="text-[12.5px] text-ink2">{r.says}</span>, csv: (r) => r.says },
    {
      key: 'act', header: '', align: 'right',
      render: (r) => {
        const ok = can('inventory.manage', r.item.company_id)
        const hold = r.hold_id ? inv.holds.find((h) => h.id === r.hold_id) : undefined
        if (hold) return (
          <span className="flex justify-end gap-1.5">
            <button className="btn sm" disabled={!ok || busy} title={ok ? 'The stock is fit for use again' : NO_MANAGE} onClick={() => setReleasing(hold)}><Undo2 size={13} /> Release</button>
            <button className="btn sm" disabled={!ok} title={ok ? 'Prepares an adjustment; the loss is posted only when its entry is approved' : NO_MANAGE} onClick={() => writeOff(hold.id)}>Write off</button>
          </span>
        )
        if (!r.warehouse_id) return null
        const wh = r.warehouse_id
        return <button className="btn sm" disabled={!ok} title={ok ? 'Records the condition, so that the stock can be released or written off' : NO_MANAGE} onClick={() => setNoting({ company_id: r.item.company_id, item_id: r.item.id, warehouse_id: wh, lot_id: r.lot?.id ?? null, qty: r.qty.toString(), condition: NOTED[r.kind] ?? 'damaged' })}><Flag size={13} /> Note a condition</button>
      },
    },
  ]

  const holdColumns: Column<InvHold>[] = [
    { key: 'noted', header: 'Noted on', render: (h) => <span className="num text-[12.5px]">{fmtDate(h.noted_on)}</span>, sort: (h) => h.noted_on, csv: (h) => h.noted_on },
    { key: 'condition', header: 'Condition', render: (h) => <span className="chip warn">{CONDITION_LABEL[h.condition]}</span>, sort: (h) => h.condition, csv: (h) => CONDITION_LABEL[h.condition] },
    { key: 'item', header: 'Item', render: (h) => { const i = items.get(h.item_id); return <div className="min-w-0"><div className="text-ink">{i ? <><span className="num text-[12px] text-gold">{i.sku}</span> · {i.name}</> : 'Unknown item'}</div><div className="text-[11px] text-muted">{code(h.company_id)}{h.lot_id ? ` · lot ${lots.get(h.lot_id)?.lot_no ?? '—'}` : ''}</div></div> }, sort: (h) => items.get(h.item_id)?.sku ?? '', csv: (h) => items.get(h.item_id)?.sku ?? '' },
    { key: 'place', header: 'Location', render: (h) => <span className="text-[12.5px] text-ink2">{whName(h.warehouse_id)}</span>, sort: (h) => whName(h.warehouse_id), csv: (h) => whName(h.warehouse_id) },
    { key: 'qty', header: 'Quantity', align: 'right', render: (h) => <span className="num">{fmtQty(h.qty)}</span>, sort: (h) => D(h.qty).toNumber(), csv: (h) => D(h.qty).toString() },
    { key: 'note', header: 'Note', render: (h) => <div className="text-[12.5px] text-ink2">{h.note ?? '—'}{h.resolved_note && <div className="text-[11.5px] text-muted">Released: {h.resolved_note}</div>}</div>, csv: (h) => [h.note, h.resolved_note].filter(Boolean).join(' | ') },
    { key: 'status', header: 'Status', render: (h) => <StatusChip status={h.status === 'released' ? 'released_hold' : h.status} label={h.status === 'open' ? 'open' : human(h.status)} />, sort: (h) => h.status, csv: (h) => human(h.status) },
    { key: 'doc', header: 'Adjustment', render: (h) => (h.resolved_doc_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/inventory/docs/' + h.resolved_doc_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
    {
      key: 'act', header: '', align: 'right',
      render: (h) => (h.status !== 'open' ? null : (
        <span className="flex justify-end gap-1.5">
          <button className="btn sm" disabled={!can('inventory.manage', h.company_id) || busy} title={can('inventory.manage', h.company_id) ? 'The stock is fit for use again' : NO_MANAGE} onClick={() => setReleasing(h)}><Undo2 size={13} /> Release</button>
          <button className="btn sm" disabled={!can('inventory.manage', h.company_id)} title={can('inventory.manage', h.company_id) ? 'Prepares an adjustment; the loss is posted only when its entry is approved' : NO_MANAGE} onClick={() => writeOff(h.id)}>Write off</button>
        </span>
      )),
    },
  ]

  return (
    <div className="space-y-4">
      <Note kind="warn">Exposure is not loss. The stock below is still in the books at its cost. The left side estimates what is at stake; the right side is loss that was approved and posted. The two are shown side by side and are never added together.</Note>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={`Exposure as at ${fmtDate(today())}`} right={<span className="flex items-center gap-2"><Exposure /><Explain title="Exposure to loss" text="Each quantity is shown under one heading only, the most serious: a condition a person has noted comes first, then expiry from the dates on the lots, then stock that has not moved. Near expiry means within 60 days. Slow moving means nothing has left for the number of days set on the item, or 180 days." formula="exposure = quantity × unit cost carried (value ÷ quantity of the item)" source="Source: the stock ledger, the expiry dates of lots and the conditions noted by people. An estimate; nothing is posted." /></span>}>
          <Panel className="p-4" lit={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Money value={total} currency={currency} className="display text-[24px] text-warn" />
              <span className="text-[11.5px] text-muted">{exposure.length} line{exposure.length === 1 ? '' : 's'} · an estimate, not a loss</span>
            </div>
            {totals.length ? <>
              <div className="mt-2"><BarChart height={190} data={totals.map((t) => ({ label: t.label, values: [{ key: 'Exposure', value: t.value.toNumber(), color: 'var(--warn)' }] }))} onBar={(label) => setKind(totals.find((t) => t.label === label)?.kind ?? '')} /></div>
              <div className="mt-2 overflow-hidden rounded-lg border border-line">
                {totals.map((t) => (
                  <button key={t.kind} aria-pressed={kind === t.kind} className={cx('flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left text-[12.5px] last:border-0 hover:bg-surface2', kind === t.kind && 'bg-surface2')} onClick={() => setKind(kind === t.kind ? '' : t.kind)}>
                    <span className="flex items-center gap-2"><span className={cx('chip', EXPOSURE_CLS[t.kind])}>{t.label}</span><span className="text-muted">{t.lines} line{t.lines === 1 ? '' : 's'}</span></span>
                    <Money value={t.value} currency={currency} />
                  </button>
                ))}
              </div>
            </> : <Empty title="No exposure is recorded" body="No stock is expired, near expiry, noted with a condition or slow moving." />}
          </Panel>
        </Section>

        <Section title={`Loss posted · ${period.label}`} right={<Truth state="ACTUAL" />}>
          <Panel className="p-4" lit={false}>
            {lossDocs.error ? <ErrorBox message={lossDocs.error} retry={lossDocs.reload} /> : !lossDocs.data ? <Loading rows={3} label="Reading the posted adjustments" /> : <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Money value={postedTotal} currency={currency} className="display text-[24px] text-ink" />
                <span className="text-[11.5px] text-muted">{fmtDate(period.from)} to {fmtDate(period.to)} · {adjustments.length} posted adjustment{adjustments.length === 1 ? '' : 's'}</span>
              </div>
              {posted.length ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-line">
                  {posted.map((p) => <div key={p.reason} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-[12.5px] last:border-0"><span className="text-ink2">{REASON_LABEL[p.reason]}</span><Money value={p.value} currency={currency} /></div>)}
                </div>
              ) : <div className="mt-3 rounded-lg border border-line px-3 py-3 text-[12.5px] text-muted">No loss of stock was posted in this period.</div>}
              <div className="mt-3 text-[11.5px] leading-relaxed text-muted">Loss posted = the cost of stock taken out by adjustments whose entry was approved, by the reason a person recorded. The period is the one selected at the top of the application. Adjustments awaiting approval are not included.</div>
            </>}
          </Panel>
        </Section>
      </div>

      <Section title="Stock at stake" right={<Exposure />}>
        <Panel lit={false}>
          <DataTable columns={columns} rows={shown} rowKey={(r) => [r.kind, r.item.id, r.warehouse_id ?? '', r.lot?.id ?? '', r.hold_id ?? ''].join('|')} exportName="stock-exposure"
            toolbar={<select className="field sm" style={{ width: 210 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Condition"><option value="">Every condition</option>{(Object.keys(EXPOSURE_LABEL) as ExposureKind[]).map((k) => <option key={k} value={k}>{EXPOSURE_LABEL[k]}</option>)}</select>}
            footer={<tr>
              <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Exposure · {shown.length} line{shown.length === 1 ? '' : 's'}</td>
              <td className={cx(foot, 'r')}><Money value={sum(shown.map((r) => r.value))} currency={currency} className="font-medium text-warn" /></td>
              <td className={foot} colSpan={3} />
            </tr>}
            empty={{ title: 'Nothing is at stake under this heading', body: 'No stock matches the condition chosen.' }} />
        </Panel>
      </Section>

      <Section title="Conditions noted on stock" right={<button className="btn sm primary" disabled={!manageIds.length} title={manageIds.length ? undefined : NO_MANAGE} onClick={() => setNoting('new')}><Flag size={13} /> Note a condition</button>}>
        <Panel lit={false}>
          <DataTable columns={holdColumns} rows={holds} rowKey={(h) => h.id} exportName="stock-conditions"
            toolbar={<select className="field sm" style={{ width: 170 }} value={holdStatus} onChange={(e) => setHoldStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="open">Open</option><option value="released">Released</option><option value="written_off">Written off</option></select>}
            empty={{ title: 'No condition is noted', body: 'Noting a condition changes nothing in the books. It marks stock that a person has found damaged, expired, obsolete, missing or held for inspection.' }} />
        </Panel>
      </Section>

      <HoldForm open={noting !== null} preset={noting && noting !== 'new' ? noting : null} inv={inv} companyIds={manageIds} onClose={() => setNoting(null)} />
      <ReasonDialog open={!!releasing} title="Release the stock" confirm="Release" onCancel={() => setReleasing(null)}
        body={releasing ? <>The note that <span className="num">{fmtQty(releasing.qty)}</span> of {items.get(releasing.item_id)?.name ?? 'this item'} is {CONDITION_LABEL[releasing.condition].toLowerCase()} will be closed. The stock stays in the books as it is; it is no longer counted as exposure under this note.</> : undefined}
        onConfirm={(reason) => { if (!releasing) return; void act(() => api.releaseInvHold(releasing.id, reason), 'Stock released').then(() => setReleasing(null)) }} />
    </div>
  )
}

function HoldForm({ open, preset, inv, companyIds, onClose }: { open: boolean; preset: HoldPreset | null; inv: Inv; companyIds: ID[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const blank = () => ({ company_id: preset?.company_id ?? (choices.find((c) => inv.rows.some((r) => r.company_id === c.id && D(r.qty).gt(0))) ?? choices[0])?.id ?? '', item_id: preset?.item_id ?? '', warehouse_id: preset?.warehouse_id ?? '', lot_id: preset?.lot_id ?? '', qty: preset?.qty ?? '', condition: preset?.condition ?? ('damaged' as HoldCondition), noted_on: today(), note: '' })
  const [v, setV] = useState(blank)
  useEffect(() => { if (open) setV(blank()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const item = inv.items.find((i) => i.id === v.item_id)
  const stocked = inv.items.filter((i) => i.company_id === v.company_id && inv.rows.some((r) => r.item_id === i.id && D(r.qty).gt(0)))
  const placeRows = inv.rows.filter((r) => r.item_id === v.item_id && D(r.qty).gt(0))
  const places = inv.warehouses.filter((w) => placeRows.some((r) => r.warehouse_id === w.id))
  const lotChoices = placeRows.filter((r) => r.warehouse_id === v.warehouse_id && r.lot_id).map((r) => ({ row: r, lot: inv.lots.find((l) => l.id === r.lot_id) }))
  const tracked = !!item && item.tracking !== 'none'
  const have = v.item_id && v.warehouse_id ? freeInPlace(inv.rows, v.item_id, v.warehouse_id, v.lot_id || null) : ZERO
  const noted = sum(inv.holds.filter((h) => h.status === 'open' && h.item_id === v.item_id && h.warehouse_id === v.warehouse_id && (h.lot_id ?? null) === (v.lot_id || null)).map((h) => h.qty))
  const room = have.minus(noted)
  const problem = !v.company_id ? 'Choose the company.' : !v.item_id ? 'Choose the item.' : !v.warehouse_id ? 'Choose the location.' : tracked && !v.lot_id ? `Choose the ${item?.tracking === 'serial' ? 'serial number' : 'lot'}.`
    : D(v.qty || 0).lte(0) ? 'Enter the quantity.' : D(v.qty).gt(room) ? `Only ${fmtQty(have)} ${item?.unit ?? ''} are in this place${noted.gt(0) ? `, and ${fmtQty(noted)} are already noted` : ''}.` : !v.noted_on ? 'Enter the date.' : null
  const save = async () => {
    const id = await act(() => api.saveInvHold({ company_id: v.company_id, item_id: v.item_id, warehouse_id: v.warehouse_id, lot_id: v.lot_id || null, qty: v.qty, condition: v.condition, noted_on: v.noted_on, note: v.note.trim() || undefined }), 'Condition noted')
    if (id) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Note a condition on stock" subtitle="This records what a person has found. It changes nothing in the books and posts no loss." width={640}
      footer={<>
        {problem && v.item_id && <span className="mr-auto max-w-[340px] text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Flag size={15} />} Note the condition</button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} disabled={!!preset} onChange={(e) => setV({ ...v, company_id: e.target.value, item_id: '', warehouse_id: '', lot_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Condition"><select className="field" value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value as HoldCondition })}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</select></Field>
        <Field label="Item" className="sm:col-span-2" hint={v.company_id && !stocked.length ? 'No item of this company holds stock.' : undefined}>
          <select className="field" value={v.item_id} disabled={!!preset} onChange={(e) => setV({ ...v, item_id: e.target.value, warehouse_id: '', lot_id: '' })}><option value="">Choose…</option>{stocked.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select>
        </Field>
        <Field label="Location"><select className="field" value={v.warehouse_id} disabled={!!preset} onChange={(e) => setV({ ...v, warehouse_id: e.target.value, lot_id: '' })}><option value="">Choose…</option>{places.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
        {tracked && (
          <Field label={item?.tracking === 'serial' ? 'Serial number' : 'Lot'}>
            <select className="field" value={v.lot_id} disabled={!!preset} onChange={(e) => setV({ ...v, lot_id: e.target.value })}><option value="">Choose…</option>{lotChoices.map(({ row, lot }) => <option key={row.lot_id ?? ''} value={row.lot_id ?? ''}>{lot?.lot_no ?? '—'} · {fmtQty(row.qty)} here{lot?.expiry_date ? ` · expires ${fmtDate(lot.expiry_date)}` : ''}</option>)}</select>
          </Field>
        )}
        <Field label="Quantity" hint={v.item_id && v.warehouse_id && (!tracked || v.lot_id) ? `${fmtQty(have)} ${item?.unit ?? ''} in this place${noted.gt(0) ? ` · ${fmtQty(noted)} already noted` : ''}` : undefined}>
          <input className="field num" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: digits(e.target.value) })} />
        </Field>
        <Field label="Noted on"><input type="date" className="field" value={v.noted_on} max={today()} onChange={(e) => setV({ ...v, noted_on: e.target.value })} /></Field>
        <Field label="What was found" className="sm:col-span-2"><textarea className="field" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="What happened, who found it, what is being done about it" /></Field>
      </div>
    </Modal>
  )
}

// ====================================================================== reorder
function ReorderTab({ inv }: { inv: Inv }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const list = useMemo(() => reorderList(inv.items, inv.rows), [inv.items, inv.rows])
  const withLevel = inv.items.filter((i) => i.status === 'active' && i.reorder_level !== null).length
  const columns: Column<ReorderRow>[] = [
    { key: 'sku', header: 'Code', render: (r) => <span className="num text-[12.5px] text-gold">{r.item.sku}</span>, sort: (r) => r.item.sku, csv: (r) => r.item.sku },
    { key: 'item', header: 'Item', render: (r) => <div className="min-w-0"><div className="text-ink">{r.item.name}</div><div className="text-[11px] text-muted">{code(r.item.company_id)}</div></div>, sort: (r) => r.item.name.toLowerCase(), csv: (r) => r.item.name },
    { key: 'free', header: 'Free stock', align: 'right', render: (r) => <span className={cx('num', r.free.lte(0) ? 'text-neg' : 'text-ink')}>{fmtQty(r.free)} <span className="text-[11px] text-muted">{r.item.unit}</span></span>, sort: (r) => r.free.toNumber(), csv: (r) => r.free.toString() },
    { key: 'level', header: 'Reorder level', align: 'right', render: (r) => <span className="num text-ink2">{fmtQty(r.level)}</span>, sort: (r) => r.level.toNumber(), csv: (r) => r.level.toString() },
    { key: 'short', header: 'Below the level by', align: 'right', render: (r) => <span className="num text-warn">{fmtQty(r.short)}</span>, sort: (r) => r.short.toNumber(), csv: (r) => r.short.toString() },
    { key: 'in', header: 'Arriving (awaiting approval)', align: 'right', render: (r) => (r.pendingIn.isZero() ? <span className="text-muted">—</span> : <span className="num text-cyan">{fmtQty(r.pendingIn)}</span>), sort: (r) => r.pendingIn.toNumber(), csv: (r) => r.pendingIn.toString() },
    { key: 'qty', header: 'Set reorder quantity', align: 'right', render: (r) => (r.item.reorder_qty === null ? <span className="text-muted">—</span> : <span className="num text-ink2">{fmtQty(r.item.reorder_qty)}</span>), sort: (r) => D(r.item.reorder_qty).toNumber(), csv: (r) => (r.item.reorder_qty === null ? '' : D(r.item.reorder_qty).toString()) },
    { key: 'suggested', header: 'Suggested order (a suggestion)', align: 'right', render: (r) => <span className="num font-medium text-gold" title="The larger of the reorder quantity and (level − free − arriving)">{fmtQty(r.suggested)} <span className="text-[11px] font-normal text-muted">{r.item.unit}</span></span>, sort: (r) => r.suggested.toNumber(), csv: (r) => r.suggested.toString() },
    { key: 'open', header: '', align: 'right', render: (r) => <button className="link text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav('/inventory/items/' + r.item.id) }}>Open the item</button> },
  ]
  const mayOrder = inv.ids.some((id) => can('purchase.create', id))
  return (
    <Section title="Items at or below their reorder level" right={<span className="flex items-center gap-2">
      <span className="chip cyan" title="Worked out from the levels set on the items. Nothing is ordered by NUMERO.">SUGGESTION</span>
      <Explain title="Suggested order" text="An item is listed when its free stock is at or below the reorder level set on it. The suggestion is the larger of the reorder quantity set on the item and what is missing to reach the level after what is already arriving. NUMERO orders nothing: a person prepares the requisition or the order." formula="suggested = max(reorder quantity, reorder level − free stock − arriving, 0)" source="Source: the item master and the stock ledger. Purchase orders already placed are not counted; check Purchasing before ordering." />
      <button className="btn sm primary" disabled={!mayOrder} title={mayOrder ? 'Opens a new purchasing document. A person decides what is ordered.' : 'You need the permission purchase.create to prepare a purchasing document'} onClick={() => nav('/purchasing/new?kind=requisition')}><ShoppingCart size={13} /> Prepare a requisition</button>
    </span>}>
      <Panel lit={false}>
        <DataTable columns={columns} rows={list} rowKey={(r) => r.item.id} onRow={(r) => nav('/inventory/items/' + r.item.id)} exportName="reorder-suggestions"
          empty={{ title: 'Nothing needs reordering', body: withLevel ? `${withLevel} item${withLevel === 1 ? ' has' : 's have'} a reorder level, and all are above it.` : 'No item has a reorder level. Set one on the item to have it watched.', icon: <ShoppingCart size={20} /> }} />
        <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">A suggestion, not an order. Purchase orders already placed with vendors are not part of this figure: the stock ledger knows only what has been received. Check Purchasing before ordering.</div>
      </Panel>
    </Section>
  )
}

// ====================================================================== units and lots
interface UnitRow { lot: InvLot; item: InvItem | undefined; place: ID | null; arriving: boolean; state: 'in_stock' | 'sold' | 'arriving' | 'not_in_stock' }
interface LotRow { lot: InvLot; item: InvItem | undefined; qty: Decimal; places: { warehouse_id: ID; qty: Decimal }[] }
const UNIT_STATE: Record<UnitRow['state'], string> = { in_stock: 'In stock', sold: 'With a customer', arriving: 'Arriving — awaiting approval', not_in_stock: 'Not in stock' }

function UnitsTab({ inv, asOf }: { inv: Inv; asOf: string }) {
  const nav = useNavigate()
  const code = useCompanyCode()
  const ccy = useCcy()
  const partyName = usePartyName()
  const whName = useMemo(() => warehouseName(inv.warehouses), [inv.warehouses])
  const [text, setText] = useState('')
  const [state, setState] = useState('')
  const [lotText, setLotText] = useState('')
  const [empty, setEmpty] = useState(false)
  const items = useMemo(() => new Map(inv.items.map((i) => [i.id, i])), [inv.items])

  const units: UnitRow[] = useMemo(() => inv.lots.filter((l) => l.is_serial).map((lot) => {
    const rs = inv.rows.filter((r) => r.lot_id === lot.id)
    const held = rs.find((r) => D(r.qty).gt(0))
    const arriving = rs.some((r) => D(r.pending_in).gt(0))
    return { lot, item: items.get(lot.item_id), place: held?.warehouse_id ?? null, arriving, state: held ? 'in_stock' : lot.sold_to_party_id ? 'sold' : arriving ? 'arriving' : 'not_in_stock' } as UnitRow
  }), [inv.lots, inv.rows, items])
  const shownUnits = units.filter((u) => (!state || u.state === state) && has(text, u.lot.lot_no, u.item?.sku, u.item?.name, u.item?.model, partyName(u.lot.sold_to_party_id), u.lot.customer_location))

  const lots: LotRow[] = useMemo(() => inv.lots.filter((l) => !l.is_serial).map((lot) => {
    const places = inv.rows.filter((r) => r.lot_id === lot.id && !D(r.qty).isZero()).map((r) => ({ warehouse_id: r.warehouse_id, qty: D(r.qty) }))
    return { lot, item: items.get(lot.item_id), qty: sum(places.map((p) => p.qty)), places }
  }), [inv.lots, inv.rows, items])
  const shownLots = lots.filter((l) => (empty || l.qty.gt(0)) && has(lotText, l.lot.lot_no, l.item?.sku, l.item?.name))
  const left = (l: InvLot) => (l.expiry_date ? daysBetween(asOf, l.expiry_date) : null)

  const unitColumns: Column<UnitRow>[] = [
    { key: 'serial', header: 'Serial number', render: (u) => <span className="num text-[12.5px] text-gold">{u.lot.lot_no}</span>, sort: (u) => u.lot.lot_no, csv: (u) => u.lot.lot_no },
    { key: 'item', header: 'Item', render: (u) => <div className="min-w-0"><div className="text-ink">{u.item?.name ?? 'Unknown item'}</div><div className="text-[11px] text-muted">{code(u.lot.company_id)} · {u.item?.sku ?? '—'}{u.item?.model ? ` · model ${u.item.model}` : ''}</div></div>, sort: (u) => u.item?.name.toLowerCase() ?? '', csv: (u) => `${u.item?.sku ?? ''} ${u.item?.name ?? ''}`.trim() },
    { key: 'state', header: 'Where it is', render: (u) => <span className={cx('chip', u.state === 'in_stock' ? 'pos' : u.state === 'sold' ? 'cyan' : u.state === 'arriving' ? 'warn' : '')}>{UNIT_STATE[u.state]}</span>, sort: (u) => u.state, csv: (u) => UNIT_STATE[u.state] },
    {
      key: 'where', header: 'Location or customer', sort: (u) => (u.place ? whName(u.place) : partyName(u.lot.sold_to_party_id)), csv: (u) => (u.place ? whName(u.place) : u.lot.sold_to_party_id ? `${partyName(u.lot.sold_to_party_id)}${u.lot.customer_location ? ', ' + u.lot.customer_location : ''}` : ''),
      render: (u) => (u.place ? <span className="text-ink2">{whName(u.place)}</span> : u.lot.sold_to_party_id ? <div><div className="text-ink2">{partyName(u.lot.sold_to_party_id)}</div>{u.lot.customer_location && <div className="text-[11px] text-muted">{u.lot.customer_location}</div>}</div> : <span className="text-muted">—</span>),
    },
    { key: 'sold', header: 'Sold on', render: (u) => (u.lot.sold_on ? <span className="num text-[12.5px]">{fmtDate(u.lot.sold_on)}</span> : <span className="text-muted">—</span>), sort: (u) => u.lot.sold_on ?? '', csv: (u) => u.lot.sold_on ?? '' },
    { key: 'installed', header: 'Installed on', render: (u) => (u.lot.installed_on ? <span className="num text-[12.5px]">{fmtDate(u.lot.installed_on)}</span> : <span className="text-muted">—</span>), sort: (u) => u.lot.installed_on ?? '', csv: (u) => u.lot.installed_on ?? '' },
    {
      key: 'warranty', header: 'Warranty until', sort: (u) => u.lot.warranty_until ?? '', csv: (u) => u.lot.warranty_until ?? '',
      render: (u) => { const w = u.lot.warranty_until; if (!w) return <span className="text-muted">—</span>; const n = daysBetween(asOf, w); return <div><div className="num text-[12.5px]">{fmtDate(w)}</div><div className={cx('text-[11px]', n < 0 ? 'text-muted' : n <= 60 ? 'text-warn' : 'text-muted')}>{n < 0 ? `ended ${-n} day${n === -1 ? '' : 's'} ago` : `${n} day${n === 1 ? '' : 's'} left`}</div></div> },
    },
    { key: 'landed', header: 'Landed cost added', align: 'right', render: (u) => (u.lot.landed_cost === null ? <span className="text-muted">—</span> : <Money value={u.lot.landed_cost} currency={ccy(u.lot.company_id)} />), sort: (u) => D(u.lot.landed_cost).toNumber(), csv: (u) => (u.lot.landed_cost === null ? '' : D(u.lot.landed_cost).toFixed(2)) },
  ]
  const lotColumns: Column<LotRow>[] = [
    { key: 'lot', header: 'Lot or batch', render: (l) => <span className="num text-[12.5px] text-gold">{l.lot.lot_no}</span>, sort: (l) => l.lot.lot_no, csv: (l) => l.lot.lot_no },
    { key: 'item', header: 'Item', render: (l) => <div className="min-w-0"><div className="text-ink">{l.item?.name ?? 'Unknown item'}</div><div className="text-[11px] text-muted">{code(l.lot.company_id)} · {l.item?.sku ?? '—'}</div></div>, sort: (l) => l.item?.name.toLowerCase() ?? '', csv: (l) => `${l.item?.sku ?? ''} ${l.item?.name ?? ''}`.trim() },
    { key: 'supplier', header: 'Supplier', render: (l) => <span className="text-[12.5px] text-ink2">{partyName(l.lot.supplier_party_id)}</span>, sort: (l) => partyName(l.lot.supplier_party_id), csv: (l) => (l.lot.supplier_party_id ? partyName(l.lot.supplier_party_id) : '') },
    { key: 'mfg', header: 'Manufactured', render: (l) => (l.lot.mfg_date ? <span className="num text-[12.5px]">{fmtDate(l.lot.mfg_date)}</span> : <span className="text-muted">—</span>), sort: (l) => l.lot.mfg_date ?? '', csv: (l) => l.lot.mfg_date ?? '' },
    { key: 'expiry', header: 'Expires', render: (l) => (l.lot.expiry_date ? <span className="num text-[12.5px]">{fmtDate(l.lot.expiry_date)}</span> : <span className="text-muted">no date recorded</span>), sort: (l) => l.lot.expiry_date ?? '9999', csv: (l) => l.lot.expiry_date ?? '' },
    {
      key: 'left', header: 'Days left', align: 'right', sort: (l) => left(l.lot) ?? 99999, csv: (l) => left(l.lot) ?? '',
      render: (l) => { const n = left(l.lot); return n === null ? <span className="text-muted">—</span> : n < 0 ? <span className="chip neg">expired {-n} day{n === -1 ? '' : 's'} ago</span> : <span className={cx('num', n <= 60 ? 'text-warn' : 'text-ink2')}>{n}</span> },
    },
    { key: 'qty', header: 'Quantity', align: 'right', render: (l) => <span className="num">{fmtQty(l.qty)} <span className="text-[11px] text-muted">{l.item?.unit ?? ''}</span></span>, sort: (l) => l.qty.toNumber(), csv: (l) => l.qty.toString() },
    { key: 'places', header: 'Where', render: (l) => (l.places.length ? <div className="text-[12px]">{l.places.map((p) => <div key={p.warehouse_id}><span className="text-ink2">{whName(p.warehouse_id)}</span> <span className="num">{fmtQty(p.qty)}</span></div>)}</div> : <span className="text-muted">—</span>), csv: (l) => l.places.map((p) => `${whName(p.warehouse_id)} ${p.qty.toString()}`).join('; ') },
  ]

  return (
    <div className="space-y-4">
      <Section title="Serial-numbered units">
        <Panel lit={false}>
          <DataTable columns={unitColumns} rows={shownUnits} rowKey={(u) => u.lot.id} onRow={(u) => nav('/inventory/units/' + u.lot.id)} exportName="serial-units"
            toolbar={<>
              <select className="field sm" style={{ width: 220 }} value={state} onChange={(e) => setState(e.target.value)} aria-label="Where the unit is"><option value="">Wherever it is</option>{(Object.keys(UNIT_STATE) as UnitRow['state'][]).map((s) => <option key={s} value={s}>{UNIT_STATE[s]}</option>)}</select>
              <TextFilter value={text} onChange={setText} placeholder="Serial, item, model or customer" />
            </>}
            empty={{ title: 'No unit matches', body: units.length ? 'Change the filter to see more units.' : 'No serial-numbered unit is on record. A unit appears when an item tracked by serial number is received.', icon: <MapPin size={20} /> }} />
          <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">A unit is with a customer once a stock issue naming the customer is approved. Installation, warranty and service history are kept on the unit itself: open a row.</div>
        </Panel>
      </Section>

      <Section title="Lots and their expiry dates">
        <Panel lit={false}>
          <DataTable columns={lotColumns} rows={shownLots} rowKey={(l) => l.lot.id} onRow={(l) => nav('/inventory/units/' + l.lot.id)} exportName="lots-expiry" initialSort={{ key: 'expiry', dir: 'asc' }}
            rowClass={(l) => { const n = left(l.lot); return n !== null && n < 0 && l.qty.gt(0) ? 'bg-negsoft' : undefined }}
            toolbar={<>
              <TextFilter value={lotText} onChange={setLotText} placeholder="Lot or item" />
              <label className="flex items-center gap-1.5 text-[12px] text-ink2"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Include lots with nothing left in stock</label>
            </>}
            empty={{ title: 'No lot matches', body: lots.length ? 'No lot with stock matches. Include lots with nothing left to see the rest.' : 'No lot is on record. A lot appears when an item tracked by lot is received.' }} />
          <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">Days left = expiry date − today. NUMERO records lots and dates; it is not a regulated pharmaceutical compliance system and does not replace one.</div>
        </Panel>
      </Section>
    </div>
  )
}

// ====================================================================== setup
const ledgersOf = (accounts: Account[], companyId: ID, type: Account['type'], first: string, keep?: ID) =>
  accounts.filter((a) => a.company_id === companyId && a.type === type && ((!a.is_group && a.is_active) || a.id === keep))
    .sort((a, b) => Number(b.subtype === first) - Number(a.subtype === first) || a.code.localeCompare(b.code))

function SetupTab({ inv }: { inv: Inv }) {
  const code = useCompanyCode()
  const partyName = usePartyName()
  const accountName = useAccountName()
  const orgUnits = useApp((s) => s.orgUnits)
  const manageIds = inv.ids.filter((id) => can('inventory.manage', id))
  const [place, setPlace] = useState<Warehouse | 'new' | null>(null)
  const [category, setCategory] = useState<InvCategory | 'new' | null>(null)
  const held = (w: Warehouse) => inv.rows.filter((r) => r.warehouse_id === w.id && !D(r.qty).isZero()).length
  const itemsOf = (c: InvCategory) => inv.items.filter((i) => i.category_id === c.id)

  const placeColumns: Column<Warehouse>[] = [
    { key: 'code', header: 'Code', render: (w) => <span className="num text-[12.5px] text-gold">{w.code}</span>, sort: (w) => w.code, csv: (w) => w.code },
    { key: 'name', header: 'Name', render: (w) => <span className="text-ink">{w.name}</span>, sort: (w) => w.name.toLowerCase(), csv: (w) => w.name },
    { key: 'company', header: 'Company', render: (w) => <span className="text-ink2">{code(w.company_id)}</span>, sort: (w) => code(w.company_id), csv: (w) => code(w.company_id) },
    { key: 'kind', header: 'Kind', render: (w) => <span className="chip">{WAREHOUSE_KIND_LABEL[w.kind]}</span>, sort: (w) => w.kind, csv: (w) => WAREHOUSE_KIND_LABEL[w.kind] },
    { key: 'unit', header: 'Branch, site or office', render: (w) => { const u = orgUnits.find((x) => x.id === w.org_unit_id); return u ? <span className="text-[12.5px] text-ink2">{u.name} <span className="text-muted">· {human(u.type_key)}</span></span> : <span className="text-muted">—</span> }, sort: (w) => orgUnits.find((x) => x.id === w.org_unit_id)?.name ?? '', csv: (w) => orgUnits.find((x) => x.id === w.org_unit_id)?.name ?? '' },
    { key: 'address', header: 'Address', render: (w) => <span className="text-[12.5px] text-ink2">{w.address ?? '—'}</span>, csv: (w) => w.address ?? '' },
    { key: 'keeper', header: 'Keeper', render: (w) => <span className="text-[12.5px] text-ink2">{partyName(w.keeper_party_id)}</span>, sort: (w) => partyName(w.keeper_party_id), csv: (w) => (w.keeper_party_id ? partyName(w.keeper_party_id) : '') },
    { key: 'held', header: 'Lines of stock held', align: 'right', render: (w) => <span className="num">{held(w)}</span>, sort: (w) => held(w), csv: (w) => held(w) },
    { key: 'status', header: 'Status', render: (w) => <StatusChip status={w.is_active ? 'active' : 'inactive'} label={w.is_active ? 'active' : 'closed'} />, sort: (w) => Number(w.is_active), csv: (w) => (w.is_active ? 'Active' : 'Closed') },
    { key: 'edit', header: '', align: 'right', render: (w) => <button className="btn sm ghost" disabled={!can('inventory.manage', w.company_id)} title={can('inventory.manage', w.company_id) ? undefined : NO_MANAGE} onClick={() => setPlace(w)}><Pencil size={13} /> Edit</button> },
  ]
  const categoryColumns: Column<InvCategory>[] = [
    { key: 'name', header: 'Category', render: (c) => <span className="text-ink">{c.name}</span>, sort: (c) => c.name.toLowerCase(), csv: (c) => c.name },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2">{code(c.company_id)}</span>, sort: (c) => code(c.company_id), csv: (c) => code(c.company_id) },
    { key: 'inv', header: 'Stock ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.inventory_account_id)}</span>, sort: (c) => accountName(c.inventory_account_id), csv: (c) => accountName(c.inventory_account_id) },
    { key: 'cogs', header: 'Cost of sales ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.cogs_account_id)}</span>, sort: (c) => accountName(c.cogs_account_id), csv: (c) => accountName(c.cogs_account_id) },
    { key: 'method', header: 'Valuation method', render: (c) => <span className="chip">{VALUATION_LABEL[c.valuation_method]}</span>, sort: (c) => c.valuation_method, csv: (c) => VALUATION_LABEL[c.valuation_method] },
    { key: 'items', header: 'Items', align: 'right', render: (c) => <span className="num">{itemsOf(c).length}</span>, sort: (c) => itemsOf(c).length, csv: (c) => itemsOf(c).length },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.is_active ? 'active' : 'inactive'} />, sort: (c) => Number(c.is_active), csv: (c) => (c.is_active ? 'Active' : 'Inactive') },
    { key: 'edit', header: '', align: 'right', render: (c) => <button className="btn sm ghost" disabled={!can('inventory.manage', c.company_id)} title={can('inventory.manage', c.company_id) ? undefined : NO_MANAGE} onClick={() => setCategory(c)}><Pencil size={13} /> Edit</button> },
  ]

  return (
    <div className="space-y-4">
      <Section title="Locations of stock" right={<button className="btn sm primary" disabled={!manageIds.length} title={manageIds.length ? undefined : NO_MANAGE} onClick={() => setPlace('new')}><Plus size={13} /> Add a location</button>}>
        <Panel lit={false}>
          <DataTable columns={placeColumns} rows={inv.warehouses} rowKey={(w) => w.id} exportName="stock-locations"
            empty={{ title: 'No location', body: 'A company may keep stock in many warehouses, stores, sites, offices and vans without becoming many companies. Add the first location.', icon: <MapPin size={20} /> }} />
        </Panel>
      </Section>
      <Section title="Categories" right={<button className="btn sm primary" disabled={!manageIds.length} title={manageIds.length ? undefined : NO_MANAGE} onClick={() => setCategory('new')}><Plus size={13} /> Add a category</button>}>
        <Panel lit={false}>
          <DataTable columns={categoryColumns} rows={inv.categories} rowKey={(c) => c.id} exportName="stock-categories"
            empty={{ title: 'No category', body: 'A category names the ledger in which the stock of its items is carried, and the ledger that takes their cost when they are sold.', icon: <Tags size={20} /> }} />
        </Panel>
      </Section>
      <WarehouseForm open={place !== null} place={place && place !== 'new' ? place : null} companyIds={manageIds} onClose={() => setPlace(null)} />
      <CategoryForm open={category !== null} category={category && category !== 'new' ? category : null} holdsStock={!!category && category !== 'new' && itemsOf(category).some((i) => !D(i.qty_on_hand).isZero() || !D(i.value_on_hand).isZero())} companyIds={manageIds} onClose={() => setCategory(null)} />
    </div>
  )
}

function WarehouseForm({ open, place, companyIds, onClose }: { open: boolean; place: Warehouse | null; companyIds: ID[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const orgUnits = useApp((s) => s.orgUnits)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const blank = () => ({ company_id: place?.company_id ?? choices[0]?.id ?? '', code: place?.code ?? '', name: place?.name ?? '', kind: place?.kind ?? ('warehouse' as WarehouseKind), org_unit_id: place?.org_unit_id ?? '', address: place?.address ?? '', keeper_party_id: place?.keeper_party_id ?? '', is_active: place?.is_active ?? true })
  const [v, setV] = useState(blank)
  useEffect(() => { if (open) setV(blank()) }, [open, place?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const units = orgUnits.filter((u) => u.company_id === v.company_id && (u.status === 'active' || u.id === v.org_unit_id)).sort((a, b) => a.type_key.localeCompare(b.type_key) || a.name.localeCompare(b.name))
  const keepers = parties.filter((p) => p.status === 'active' || p.id === v.keeper_party_id).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const problem = !v.company_id ? 'Choose the company.' : !v.code.trim() ? 'Enter a short code for the location.' : !v.name.trim() ? 'Enter the name of the location.' : null
  const save = async () => {
    const input: WarehouseInput = { id: place?.id, company_id: v.company_id, code: v.code.trim(), name: v.name.trim(), kind: v.kind, org_unit_id: v.org_unit_id || null, address: orNull(v.address), keeper_party_id: v.keeper_party_id || null, ...(place ? { is_active: v.is_active } : {}) }
    const id = await act(() => api.saveWarehouse(input), place ? 'Location changed' : 'Location added')
    if (id) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={place ? `Edit ${place.code}` : 'Add a location'} subtitle="A place where stock is kept. It belongs to one company." width={640}
      footer={<>
        {problem && (v.code || v.name) && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {place ? 'Save the change' : 'Add the location'}</button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} disabled={!!place} onChange={(e) => setV({ ...v, company_id: e.target.value, org_unit_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Kind"><select className="field" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as WarehouseKind })}>{WAREHOUSE_KINDS.map((k) => <option key={k} value={k}>{WAREHOUSE_KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Code" hint="Short and unique within the company. Stored in capitals."><input className="field num" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus={!place} /></Field>
        <Field label="Name"><input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Branch, site or office (optional)" hint="The unit of the company this location belongs to."><select className="field" value={v.org_unit_id} onChange={(e) => setV({ ...v, org_unit_id: e.target.value })}><option value="">Not linked</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} · {human(u.type_key)}</option>)}</select></Field>
        <Field label="Keeper (optional)" hint="The person answerable for the stock kept here."><select className="field" value={v.keeper_party_id} onChange={(e) => setV({ ...v, keeper_party_id: e.target.value })}><option value="">Not recorded</option>{keepers.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select></Field>
        <Field label="Address" className="sm:col-span-2"><textarea className="field" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        {place && (
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink2 sm:col-span-2">
            <input type="checkbox" className="mt-[3px]" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
            <span><span className="text-ink">The location is in use.</span> A location that still holds stock cannot be closed: transfer or adjust the stock first.</span>
          </label>
        )}
      </div>
    </Modal>
  )
}

function CategoryForm({ open, category, holdsStock, companyIds, onClose }: { open: boolean; category: InvCategory | null; holdsStock: boolean; companyIds: ID[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()
  const blank = () => ({ company_id: category?.company_id ?? choices[0]?.id ?? '', name: category?.name ?? '', inventory_account_id: category?.inventory_account_id ?? '', cogs_account_id: category?.cogs_account_id ?? '', valuation_method: category?.valuation_method ?? ('weighted_average' as Valuation), is_active: category?.is_active ?? true })
  const [v, setV] = useState(blank)
  useEffect(() => { if (open) setV(blank()) }, [open, category?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const stockLedgers = useMemo(() => ledgersOf(accounts, v.company_id, 'asset', 'inventory', v.inventory_account_id), [accounts, v.company_id, v.inventory_account_id])
  const costLedgers = useMemo(() => ledgersOf(accounts, v.company_id, 'expense', 'cogs', v.cogs_account_id), [accounts, v.company_id, v.cogs_account_id])
  const problem = !v.company_id ? 'Choose the company.' : !v.name.trim() ? 'Enter the name of the category.' : !v.inventory_account_id ? 'Choose the stock ledger.' : !v.cogs_account_id ? 'Choose the cost of sales ledger.' : null
  const save = async () => {
    const input: InvCategoryInput = { id: category?.id, company_id: v.company_id, name: v.name.trim(), inventory_account_id: v.inventory_account_id, cogs_account_id: v.cogs_account_id, valuation_method: v.valuation_method, ...(category ? { is_active: v.is_active } : {}) }
    const id = await act(() => api.saveInvCategory(input), category ? 'Category changed' : 'Category added')
    if (id) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={category ? `Edit ${category.name}` : 'Add a category'} subtitle="The category decides which ledgers the stock documents of its items propose entries to." width={640}
      footer={<>
        {problem && v.name && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {category ? 'Save the change' : 'Add the category'}</button>
      </>}>
      {holdsStock && <Note kind="warn" className="mb-4">Items of this category hold stock. The stock ledger cannot be changed until their stock is brought to zero.</Note>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={v.company_id} disabled={!!category} onChange={(e) => setV({ ...v, company_id: e.target.value, inventory_account_id: '', cogs_account_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Name"><input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus={!category} /></Field>
        <Field label="Stock ledger" hint={v.company_id && !stockLedgers.length ? 'This company has no active asset ledger.' : 'An asset ledger. The value of the stock is carried here.'}>
          <select className="field" value={v.inventory_account_id} disabled={holdsStock} onChange={(e) => setV({ ...v, inventory_account_id: e.target.value })}><option value="">Choose…</option>{stockLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Cost of sales ledger" hint={v.company_id && !costLedgers.length ? 'This company has no active expense ledger.' : 'An expense ledger. It takes the cost of stock when it is issued.'}>
          <select className="field" value={v.cogs_account_id} onChange={(e) => setV({ ...v, cogs_account_id: e.target.value })}><option value="">Choose…</option>{costLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Valuation method" hint="New items of the category take this method. Items already on record keep their own."><select className="field" value={v.valuation_method} onChange={(e) => setV({ ...v, valuation_method: e.target.value as Valuation })}>{(['weighted_average', 'fifo'] as Valuation[]).map((m) => <option key={m} value={m}>{VALUATION_LABEL[m]}</option>)}</select></Field>
        {category && (
          <label className="flex items-center gap-2.5 text-[12.5px] text-ink2">
            <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
            <span className="text-ink">The category is in use</span>
          </label>
        )}
      </div>
    </Modal>
  )
}
