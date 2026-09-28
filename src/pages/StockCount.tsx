import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Ban, CheckCircle2, ClipboardList, ExternalLink, Eye, EyeOff, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { InvCategory, InvItem, InvLot, StockCount as Count, StockCountEntry, StockCountLine, StockDoc, StockReason, Warehouse } from '@/engine/p3Types'
import { countDifferences, unitCost, warehouseName } from '@/engine/stock'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, ProposedEntries, Stat, useCompanyName } from '@/ui/ops'
import { DemoTag, Fact, History, NoAccess, Tile, digits, foot } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { COUNT_STATUS_LABEL, REASONS, REASON_LABEL, docStatusLabel, fmtQty } from './Inventory'

// =====================================================================
// The count sheet of one physical stock count (spec 568, 1387).
// Snapshot → count → differences → review by a second person → an
// adjustment whose entry is approved. Counting changes nothing in the
// books. The count is blind unless the counter chooses otherwise: what
// the books say is not shown before the quantity found is entered.
// =====================================================================

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
interface Entry { counted: string; reason: StockReason | ''; note: string }
interface Found { key: number; item_id: ID; lot_no: string; expiry_date: string; counted: string; unit_cost: string; reason: StockReason; note: string }
interface Loaded { count: Count | null; why: string | null; items: InvItem[]; lots: InvLot[]; warehouses: Warehouse[]; categories: InvCategory[]; doc: StockDoc | null }
/** a line of the sheet, or stock found that is typed and not yet saved */
interface SheetRow { line: StockCountLine; unsaved?: Found }
let k = 0

export default function StockCount() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('inventory.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Inventory · Stock count" title="Inventory" perm="inventory.view" back="/inventory?tab=counts" />
  return <CountView key={id} id={id} />
}

function CountView({ id }: { id: ID }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const me = session?.user.id
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const { act, busy } = useAction()

  const [entries, setEntries] = useState<Record<ID, Entry>>({})
  const [found, setFound] = useState<Found[]>([])
  const [showBook, setShowBook] = useState(false)
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState<'reviewed' | 'recount' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** what was typed is kept when the page refreshes its data for another reason */
  const unsaved = useRef(false)

  const main = useAsync(async (): Promise<Loaded> => {
    let count: Count | null = null; let why: string | null = null
    try { count = await api.getStockCount(id) } catch (e) { why = message(e) }
    if (!count || !can('inventory.view', count.company_id)) return { count: null, why, items: [], lots: [], warehouses: [], categories: [], doc: null }
    const co = [count.company_id]
    const [items, lots, warehouses, categories, doc] = await Promise.all([
      api.listInvItems(co), api.listInvLots({ companyIds: co }), api.listWarehouses(co), api.listInvCategories(co), count.doc_id ? api.getStockDoc(count.doc_id).then((x) => x, () => null) : Promise.resolve(null),
    ])
    return { count, why, items, lots, warehouses, categories, doc }
  }, [api, id])

  const count = main.data?.count ?? null
  const lines = useMemo(() => count?.lines ?? [], [count])
  useEffect(() => {
    if (!count || unsaved.current) return
    setEntries(Object.fromEntries(lines.map((l) => [l.id, { counted: l.counted_qty === null ? '' : D(l.counted_qty).toString(), reason: l.reason_code ?? '', note: l.note ?? '' }])))
    setFound([]); setDirty(false)
  }, [count, lines])

  const items = useMemo(() => new Map((main.data?.items ?? []).map((i) => [i.id, i])), [main.data])
  const lots = useMemo(() => new Map((main.data?.lots ?? []).map((l) => [l.id, l])), [main.data])

  const back = <button className="btn ghost" onClick={() => nav('/inventory?tab=counts')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Inventory · Stock count" title="Stock count" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!main.data) return <div><PageHeader eyebrow="Inventory · Stock count" title="Stock count" actions={back} /><Panel><Loading rows={7} label="Loading the count sheet" /></Panel></div>
  if (!count) {
    return (
      <div>
        <PageHeader eyebrow="Inventory · Stock count" title="Stock count" actions={back} />
        <Panel><Empty icon={<ClipboardList size={20} />} title="Stock count not found or not shared with you" body={<>This count does not exist in the companies in which your role reads inventory.{main.data.why ? <span className="mt-1 block text-[12px]">The system said: {main.data.why}</span> : null}</>} action={<button className="btn" onClick={() => nav('/inventory?tab=counts')}><ArrowLeft size={14} /> Back to Inventory</button>} /></Panel>
      </div>
    )
  }

  const d = main.data
  const currency = companies.find((c) => c.id === count.company_id)?.base_currency
  const whName = warehouseName(d.warehouses)
  const scopeId = count.scope?.category_id
  const scopeCategory = typeof scopeId === 'string' ? d.categories.find((c) => c.id === scopeId) : undefined
  const mayCount = can('inventory.count', count.company_id) || can('inventory.manage', count.company_id)
  const mayReview = can('inventory.approve', count.company_id)
  const mayPropose = can('inventory.approve', count.company_id) || can('inventory.manage', count.company_id)
  const counting = count.status === 'open'
  const editable = counting && mayCount
  const blind = counting && !showBook
  const iCounted = !!me && count.counted_by === me
  // where the group allows it, its administrator may review their own count; the review is then recorded as an override
  const override = iCounted && !!session?.isGroupAdmin && session.group?.settings.controls?.maker_checker === 'owner_override'
  const ownCount = iCounted && !override

  // the sheet as it stands on the screen: what is saved, with what has been typed over it
  const typed = (l: StockCountLine): StockCountLine => {
    const e = entries[l.id]
    return counting && e ? { ...l, counted_qty: e.counted.trim() === '' ? null : e.counted, reason_code: e.reason || null, note: e.note.trim() || null } : l
  }
  const pseudo = (f: Found): StockCountLine => {
    const it = items.get(f.item_id)
    const cost = it && !D(it.qty_on_hand).isZero() ? unitCost(it) : D(f.unit_cost || 0)
    return { id: 'new-' + f.key, count_id: count.id, company_id: count.company_id, item_id: f.item_id, lot_id: null, book_qty: '0', unit_cost: cost.toString(), counted_qty: f.counted, reason_code: f.reason, note: f.note.trim() || null, added_in_count: true }
  }
  const sheet: SheetRow[] = [...lines.map((l) => ({ line: typed(l) })), ...found.map((f) => ({ line: pseudo(f), unsaved: f }))]
  const diff = countDifferences(sheet.map((r) => r.line))
  const diffOf = (l: StockCountLine) => (l.counted_qty === null ? null : D(l.counted_qty).minus(l.book_qty))

  const setEntry = (lineId: ID, patch: Partial<Entry>) => { unsaved.current = true; setDirty(true); setEntries((x) => ({ ...x, [lineId]: { ...(x[lineId] ?? { counted: '', reason: '', note: '' }), ...patch } })) }
  const payload = (): StockCountEntry[] => [
    ...lines.map((l) => { const e = entries[l.id] ?? { counted: '', reason: '', note: '' }; return { id: l.id, counted_qty: e.counted.trim() === '' ? null : e.counted, reason_code: e.reason || null, note: e.note.trim() || undefined } }),
    ...found.map((f) => ({ item_id: f.item_id, lot_no: f.lot_no.trim() || undefined, expiry_date: f.expiry_date || undefined, counted_qty: f.counted, reason_code: f.reason, note: f.note.trim() || undefined, unit_cost: f.unit_cost.trim() || undefined })),
  ]
  const record = (complete: boolean) => void act(async () => { const r = await api.recordStockCount(count.id, payload(), complete); unsaved.current = false; return r },
    (r) => (r === 'counted' ? 'Count completed — awaiting review by a second person' : complete ? 'Saved. Some lines are not counted yet, so the count stays open.' : 'Progress saved'))
  const reopen = () => void act(() => api.recordStockCount(count.id, [], false), 'Count reopened — quantities can be changed')

  const columns: Column<SheetRow>[] = [
    {
      key: 'item', header: 'Item', sort: (r) => items.get(r.line.item_id)?.sku ?? '', csv: (r) => `${items.get(r.line.item_id)?.sku ?? ''} ${items.get(r.line.item_id)?.name ?? ''}`.trim(),
      render: (r) => { const it = items.get(r.line.item_id); return (
        <div className="min-w-0">
          <div className="text-ink"><span className="num text-[12px] text-gold">{it?.sku ?? '—'}</span> · {it?.name ?? 'Unknown item'}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted"><span>counted in {it?.unit ?? 'units'}</span>{r.line.added_in_count && <span className="chip cyan">found in the count</span>}{r.unsaved && <span className="chip warn">not saved yet</span>}</div>
        </div>
      ) },
    },
    {
      key: 'lot', header: 'Lot or serial', sort: (r) => (r.unsaved ? r.unsaved.lot_no : r.line.lot_id ? lots.get(r.line.lot_id)?.lot_no ?? '' : ''), csv: (r) => (r.unsaved ? r.unsaved.lot_no : r.line.lot_id ? lots.get(r.line.lot_id)?.lot_no ?? '' : ''),
      render: (r) => { const lot = r.line.lot_id ? lots.get(r.line.lot_id) : undefined; const no = r.unsaved ? r.unsaved.lot_no : lot?.lot_no; const exp = r.unsaved ? r.unsaved.expiry_date : lot?.expiry_date; return no ? <div><span className="num text-[12.5px] text-ink2">{no}</span>{exp && <div className="text-[11px] text-muted">expires {fmtDate(exp)}</div>}</div> : <span className="text-muted">—</span> },
    },
    ...(!blind ? [{ key: 'book', header: 'In the books', align: 'right' as const, render: (r: SheetRow) => <span className="num text-ink2">{fmtQty(r.line.book_qty)}</span>, sort: (r: SheetRow) => D(r.line.book_qty).toNumber(), csv: (r: SheetRow) => D(r.line.book_qty).toString() }] : []),
    {
      key: 'counted', header: 'Counted', align: 'right', width: 140, sort: (r) => (r.line.counted_qty === null ? -1 : D(r.line.counted_qty).toNumber()), csv: (r) => (r.line.counted_qty === null ? '' : D(r.line.counted_qty).toString()),
      render: (r) => (r.unsaved ? <span className="num text-ink">{fmtQty(r.unsaved.counted)}</span>
        : editable ? <input className="field sm num text-right" inputMode="decimal" value={entries[r.line.id]?.counted ?? ''} placeholder="not counted" onChange={(e) => setEntry(r.line.id, { counted: digits(e.target.value) })} aria-label={`Quantity counted of ${items.get(r.line.item_id)?.sku ?? 'the item'}`} />
        : r.line.counted_qty === null ? <span className="text-muted">not counted</span> : <span className="num text-ink">{fmtQty(r.line.counted_qty)}</span>),
    },
    ...(!blind ? [
      {
        key: 'diff', header: 'Difference', align: 'right' as const, sort: (r: SheetRow) => (diffOf(r.line) ?? ZERO).toNumber(), csv: (r: SheetRow) => diffOf(r.line)?.toString() ?? '',
        render: (r: SheetRow) => { const x = diffOf(r.line); return x === null ? <span className="text-muted">—</span> : x.isZero() ? <span className="chip pos">agrees</span> : <span className={cx('num', x.lt(0) ? 'text-neg' : 'text-cyan')}>{x.gt(0) ? '+' : ''}{fmtQty(x)}</span> },
      },
      {
        key: 'value', header: 'Value of the difference', align: 'right' as const, sort: (r: SheetRow) => (diffOf(r.line) ?? ZERO).times(r.line.unit_cost).toNumber(), csv: (r: SheetRow) => (diffOf(r.line) ?? ZERO).times(r.line.unit_cost).toFixed(2),
        render: (r: SheetRow) => { const x = diffOf(r.line); return x === null || x.isZero() ? <span className="text-muted">—</span> : <span title={`difference × cost of one at the snapshot = ${x.toString()} × ${D(r.line.unit_cost).toString()}`}><Money value={x.times(r.line.unit_cost).toDecimalPlaces(2)} currency={currency} sign className={x.lt(0) ? 'text-neg' : 'text-cyan'} /></span> },
      },
    ] : []),
    {
      key: 'reason', header: 'Reason for a difference', width: 200, sort: (r) => r.line.reason_code ?? '', csv: (r) => (r.line.reason_code ? REASON_LABEL[r.line.reason_code] : ''),
      render: (r) => { const x = diffOf(r.line); const needs = !blind && x !== null && !x.isZero() && !r.line.reason_code; return (r.unsaved ? <span className="chip">{REASON_LABEL[r.unsaved.reason]}</span>
        : editable ? <select className={cx('field sm', needs && 'border-warn')} value={entries[r.line.id]?.reason ?? ''} onChange={(e) => setEntry(r.line.id, { reason: e.target.value as StockReason | '' })} aria-label={`Reason for the difference of ${items.get(r.line.item_id)?.sku ?? 'the item'}`}><option value="">{needs ? 'Needed — choose…' : 'None'}</option>{REASONS.map((x2) => <option key={x2} value={x2}>{REASON_LABEL[x2]}</option>)}</select>
        : r.line.reason_code ? <span className="chip">{REASON_LABEL[r.line.reason_code]}</span> : needs ? <span className="chip warn">no reason given</span> : <span className="text-muted">—</span>) },
    },
    {
      key: 'note', header: 'Note', csv: (r) => r.line.note ?? '',
      render: (r) => (r.unsaved ? <span className="text-[12.5px] text-ink2">{r.unsaved.note || '—'}</span>
        : editable ? <input className="field sm" value={entries[r.line.id]?.note ?? ''} onChange={(e) => setEntry(r.line.id, { note: e.target.value })} aria-label={`Note on ${items.get(r.line.item_id)?.sku ?? 'the item'}`} />
        : <span className="text-[12.5px] text-ink2">{r.line.note ?? '—'}</span>),
    },
    ...(editable && found.length ? [{ key: 'rm', header: '', align: 'right' as const, render: (r: SheetRow) => (r.unsaved ? <button className="btn ghost icon sm" onClick={() => setFound((fs) => fs.filter((f) => f.key !== r.unsaved!.key))} aria-label="Remove the line of stock found"><Trash2 size={13} /></button> : null) }] : []),
  ]

  const notCounted = diff.notCounted
  const completeProblem = notCounted > 0 ? `${notCounted} line${notCounted === 1 ? ' is' : 's are'} not counted yet. Where nothing was found, enter 0.` : null

  return (
    <div>
      <PageHeader eyebrow="Inventory · Physical stock count" title={`${count.count_no} · ${whName(count.warehouse_id)}`}
        subtitle={<>{companyName(count.company_id)} · count of {fmtDate(count.count_date)} · the books as they stood at {fmtDateTime(count.snapshot_at)}{scopeCategory ? ` · category ${scopeCategory.name}` : ''}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          {['open', 'counted', 'reviewed'].includes(count.status) && <button className="btn danger" disabled={!mayPropose || busy} title={mayPropose ? undefined : 'You need the permission inventory.approve or inventory.manage in this company'} onClick={() => setCancelling(true)}><Ban size={15} /> Cancel the count</button>}
          {counting && <>
            <button className="btn" disabled={!editable || busy || !dirty} title={!mayCount ? 'You need the permission inventory.count in this company' : !dirty ? 'Nothing has been changed since the last save' : 'Saves what has been counted so far. The count stays open.'} onClick={() => record(false)}>{busy ? <Spinner /> : <Save size={15} />} Save progress</button>
            <button className="btn primary" disabled={!editable || busy || !!completeProblem} title={!mayCount ? 'You need the permission inventory.count in this company' : completeProblem ?? 'Closes the counting. A second person then reviews the differences.'} onClick={() => record(true)}>{busy ? <Spinner /> : <CheckCircle2 size={15} />} Complete the count</button>
          </>}
          {count.status === 'reviewed' && <button className="btn primary" disabled={!mayPropose || busy} title={mayPropose ? 'Prepares the adjustment for the differences and proposes its accounting entry' : 'You need the permission inventory.approve in this company'}
            onClick={() => void act(() => api.proposeStockCount(count.id), (j) => (j ? 'Adjustment proposed — its entry is awaiting approval' : 'The count agrees with the books. It is closed and nothing is adjusted.'))}>{busy ? <Spinner /> : <Send size={15} />} Propose the adjustment</button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={count.status} label={COUNT_STATUS_LABEL[count.status]} />
        {count.frozen ? <span className="chip cyan" title="No stock document for this location can be proposed while the count is open">stock frozen while counting</span> : <span className="chip" title="Stock could move during the count">stock not frozen</span>}
        {counting && <span className={cx('chip', blind ? 'gold' : '')}>{blind ? 'blind count' : 'book quantities shown'}</span>}
      </div>

      <div className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 text-[12px] sm:grid-cols-5">
        {([['Snapshot', 'The books were photographed when the count was opened', true], ['Count', 'What is found is entered, line by line', count.status !== 'open'], ['Differences', 'Each difference is given its reason', !['open'].includes(count.status)], ['Review', 'A second person accepts the count or asks for a recount', ['reviewed', 'proposed', 'posted', 'closed'].includes(count.status)], ['Approved adjustment', 'The adjustment is proposed and its entry approved', ['posted', 'closed'].includes(count.status)]] as [string, string, boolean][]).map(([name, says, done], i) => (
          <div key={name} className="flex items-start gap-2">
            <span className={cx('num mt-[1px] grid h-5 w-5 flex-none place-items-center rounded-full border text-[10.5px]', done ? 'border-pos/40 bg-possoft text-pos' : 'border-line text-muted')}>{i + 1}</span>
            <span><span className={cx('block font-medium', done ? 'text-ink' : 'text-ink2')}>{name}</span><span className="block text-[11px] text-muted">{says}</span></span>
          </div>
        ))}
      </div>

      {count.status === 'cancelled' && <Note className="mb-4">This count was cancelled. Nothing was adjusted.</Note>}
      {count.status === 'closed' && <Note kind="good" className="mb-4">What was counted agrees with the books. The count is closed and nothing was adjusted.</Note>}
      {count.status === 'posted' && <Note kind="good" className="mb-4">The adjustment for the differences was approved and posted. The books now say what was counted.</Note>}
      {count.status === 'proposed' && <Note className="mb-4">The adjustment for the differences has been proposed. Its accounting entry is awaiting approval; until then the books are unchanged.</Note>}
      {count.status === 'reviewed' && <Note className="mb-4">The count was reviewed{count.reviewed_at ? ` on ${fmtDateTime(count.reviewed_at)}` : ''}. {diff.differ ? 'Proposing the adjustment prepares a stock adjustment for the differences and proposes its accounting entry: stock lost is charged to the ledger for stock losses, stock found is credited to the ledger for stock gains. The books change when that entry is approved.' : 'Nothing differs from the books: proposing the adjustment closes the count and adjusts nothing.'}</Note>}
      {count.status === 'counted' && <Note className="mb-4">The count is complete and awaits review by a second person. The person who counted cannot review it{session?.group?.settings.controls?.maker_checker === 'owner_override' ? ', except the administrator of the group, by override' : ''}.</Note>}
      {counting && count.review_note && <Note kind="warn" className="mb-4">A recount was asked for{count.reviewed_at ? ` on ${fmtDateTime(count.reviewed_at)}` : ''}: {count.review_note}</Note>}
      {counting && (
        <Note className="mb-4">
          <span className="font-medium text-ink">This is a blind count.</span> The quantity the books hold is not shown before you enter what you found, so that the count is of the shelf and not of the screen. Count first. When everything is counted, choose "Show book quantities" to see the differences and give each its reason. Counting changes nothing in the books.
        </Note>
      )}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Lines counted" sub={notCounted ? `${notCounted} not counted yet` : 'every line is counted'} tone={notCounted ? 'text-warn' : undefined}><span className="num">{diff.counted}</span> <span className="text-[14px] text-muted">of {sheet.length}</span></Tile>
        {blind ? (
          <Panel className="col-span-1 flex items-center p-4 text-[12px] text-muted lg:col-span-2 xl:col-span-5" lit={false}>Agreement with the books, the differences and their value are shown once you choose to show the book quantities, or once the count is completed.</Panel>
        ) : <>
          <Tile label="Agree with the books"><span className="num">{diff.agree}</span></Tile>
          <Tile label="Differ from the books" tone={diff.differ ? 'text-warn' : undefined}><span className="num">{diff.differ}</span></Tile>
          <Stat label="Value short" value={diff.shortValue} currency={currency} tone={diff.shortValue.gt(0) ? 'neg' : undefined} sub="counted less than the books · at the cost of the snapshot" />
          <Stat label="Value over" value={diff.overValue} currency={currency} tone={diff.overValue.gt(0) ? 'cyan' : undefined} sub="counted more than the books · at the cost of the snapshot" />
          <Tile label="Differences without a reason" tone={diff.withoutReason ? 'text-warn' : undefined} sub={diff.withoutReason ? 'a difference is adjusted only with its reason' : 'every difference has its reason'}><span className="num">{diff.withoutReason}</span></Tile>
        </>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Count sheet" right={counting ? (
            <span className="no-print flex items-center gap-2">
              <button className="btn sm" onClick={() => setShowBook((x) => !x)} aria-pressed={showBook}>{showBook ? <EyeOff size={13} /> : <Eye size={13} />} {showBook ? 'Hide book quantities' : 'Show book quantities'}</button>
              <button className="btn sm" disabled={!editable} title={editable ? 'Stock on the shelf that the books do not have in this location' : 'You need the permission inventory.count in this company'} onClick={() => setAdding(true)}><Plus size={13} /> Add stock found</button>
            </span>
          ) : undefined}>
            <Panel lit={false}>
              <DataTable columns={columns} rows={sheet} rowKey={(r) => r.line.id} pageSize={100} exportName={`stock-count-${count.count_no}${blind ? '-blind' : ''}`}
                rowClass={(r) => { const x = diffOf(r.line); return !blind && x !== null && !x.isZero() ? (r.line.reason_code ? undefined : 'bg-warnsoft') : undefined }}
                footer={blind ? undefined : <tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Differences · {diff.differ} line{diff.differ === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r')}><Money value={diff.overValue.minus(diff.shortValue)} currency={currency} sign className="font-medium text-ink" /></td>
                  <td className={foot} colSpan={editable && found.length ? 3 : 2} />
                </tr>}
                empty={{ title: 'The sheet is empty', body: 'The books held nothing in this location when the count was opened. Stock that is found can be added.' }} />
              <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
                {blind ? 'An empty quantity means not counted. Where nothing was found, enter 0.' : 'Difference = counted − in the books. Value of the difference = difference × the cost of one when the count was opened. Net value = value over − value short.'}
                {dirty && <span className="ml-2 text-warn">There are changes that have not been saved.</span>}
              </div>
            </Panel>
          </Section>

          {count.status === 'counted' && (
            <Section title="Review by a second person">
              <Panel className="p-4" lit={false}>
                <div className="text-[12.5px] text-ink2">
                  Counted{count.counted_at ? ` on ${fmtDateTime(count.counted_at)}` : ''}{iCounted ? ' by you' : ''}. The reviewer accepts the count as it stands, or sends it back to be counted again. A count cannot be accepted while a difference carries no reason.
                </div>
                {override && <Note kind="warn" className="mt-3">You counted this stock yourself. The group allows its administrator to review their own work; if you do, the review is recorded as an override and not as the check of a second person.</Note>}
                <div className="no-print mt-3 flex flex-wrap gap-2">
                  <button className="btn good" disabled={!mayReview || ownCount || busy || diff.withoutReason > 0} title={!mayReview ? 'You need the permission inventory.approve in this company' : ownCount ? 'The person who counted cannot review the count' : diff.withoutReason > 0 ? `${diff.withoutReason} difference${diff.withoutReason === 1 ? '' : 's'} carry no reason. Ask for a recount so that the reasons are given.` : undefined} onClick={() => setReviewing('reviewed')}><BadgeCheck size={15} /> Accept the count</button>
                  <button className="btn" disabled={!mayReview || ownCount || busy} title={!mayReview ? 'You need the permission inventory.approve in this company' : ownCount ? 'The person who counted cannot review the count' : undefined} onClick={() => setReviewing('recount')}><RotateCcw size={15} /> Ask for a recount</button>
                  <button className="btn ghost" disabled={!mayCount || busy} title={mayCount ? 'Returns the count to open so that quantities and reasons can be changed' : 'You need the permission inventory.count in this company'} onClick={reopen}>Reopen to change quantities</button>
                </div>
              </Panel>
            </Section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Location">{whName(count.warehouse_id)}</Fact>
              <Fact label="Date of the count"><span className="num">{fmtDate(count.count_date)}</span></Fact>
              <Fact label="Books as at"><span className="num">{fmtDateTime(count.snapshot_at)}</span></Fact>
              <Fact label="What is counted">{scopeCategory ? `Category: ${scopeCategory.name}` : 'Everything in the location'}</Fact>
              <Fact label="Stock while counting">{count.frozen ? 'Frozen until the count is posted, closed or cancelled' : 'Not frozen: stock may have moved'}</Fact>
              <Fact label="Opened"><span className="num">{fmtDateTime(count.created_at)}</span></Fact>
              <Fact label="Counted">{count.counted_at ? <span className="num">{fmtDateTime(count.counted_at)}</span> : 'Not yet'}</Fact>
              <Fact label="Reviewed">{count.reviewed_at && count.status !== 'open' ? <span className="num">{fmtDateTime(count.reviewed_at)}</span> : 'Not yet'}</Fact>
              {count.review_note && <Fact label="Note of the reviewer" className="sm:col-span-2">{count.review_note}</Fact>}
              {count.note && <Fact label="Note" className="sm:col-span-2">{count.note}</Fact>}
            </Panel>
          </Section>

          {count.doc_id && (
            <Section title="Adjustment">
              <Panel className="p-1.5" lit={false}>
                <button className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface2" onClick={() => nav('/inventory/docs/' + count.doc_id)}>
                  <span className="min-w-0"><span className="num text-gold">{d.doc?.doc_no ?? 'Open the adjustment'}</span>{d.doc && <span className="block text-[11.5px] text-muted">{d.doc.reason ?? 'Stock adjustment'} · {(d.doc.lines ?? []).length} line{(d.doc.lines ?? []).length === 1 ? '' : 's'}</span>}</span>
                  <span className="flex flex-none items-center gap-2">{d.doc && <StatusChip status={d.doc.status} label={docStatusLabel(d.doc.status)} />}{d.doc && <Money value={d.doc.total_value} currency={currency} />}<ExternalLink size={13} className="text-muted" /></span>
                </button>
              </Panel>
            </Section>
          )}
          {count.doc_id && <ProposedEntries companyIds={[count.company_id]} sourceId={count.doc_id} sources={['stock_doc']} title="Accounting entry of the adjustment" />}

          <Attachments companyId={count.company_id} entity="stock_counts" entityId={count.id} title="Evidence of the count" />
          <History entity="stock_counts" entityId={count.id} />
        </div>
      </div>

      <FoundForm open={adding} count={count} lines={lines} pending={found} items={d.items} lots={d.lots} scope={scopeCategory} currency={currency}
        onClose={() => setAdding(false)} onAdd={(f) => { unsaved.current = true; setDirty(true); setFound((fs) => [...fs, { ...f, key: ++k }]); setAdding(false) }} />

      <ReasonDialog open={reviewing === 'reviewed'} title="Accept the count" confirm="Accept the count" required={false} onCancel={() => setReviewing(null)}
        body={<>You confirm that the count of {whName(count.warehouse_id)} and the reasons given for its {diff.differ} difference{diff.differ === 1 ? '' : 's'} can be relied on. Accepting changes nothing in the books: the adjustment is proposed afterwards and its entry approved separately.</>}
        onConfirm={(note) => void act(() => api.reviewStockCount(count.id, 'reviewed', note || undefined), 'Count accepted').then(() => setReviewing(null))} />
      <ReasonDialog open={reviewing === 'recount'} title="Ask for a recount" confirm="Send back for a recount" onCancel={() => setReviewing(null)}
        body="The count returns to open. The quantities entered are kept and can be changed. Say what is to be counted again, and why."
        onConfirm={(note) => void act(() => api.reviewStockCount(count.id, 'recount', note), 'Recount asked for').then(() => setReviewing(null))} />
      <ReasonDialog open={cancelling} title={`Cancel ${count.count_no}`} confirm="Cancel the count" danger onCancel={() => setCancelling(false)}
        body={<>The count is closed as cancelled and nothing is adjusted.{count.frozen ? ' The stock of the location is no longer frozen.' : ''} What was entered stays on record.</>}
        onConfirm={(why) => void act(async () => { await api.cancelStockCount(count.id, why); unsaved.current = false }, 'Count cancelled').then(() => setCancelling(false))} />
    </div>
  )
}

/** Stock on the shelf that the books do not have in this location. It joins the sheet with a book quantity of zero. */
function FoundForm({ open, count, lines, pending, items, lots, scope, currency, onClose, onAdd }: {
  open: boolean; count: Count; lines: StockCountLine[]; pending: Found[]; items: InvItem[]; lots: InvLot[]; scope: InvCategory | undefined; currency: string | undefined; onClose: () => void; onAdd: (f: Omit<Found, 'key'>) => void
}) {
  const blank = (): Omit<Found, 'key'> => ({ item_id: '', lot_no: '', expiry_date: '', counted: '', unit_cost: '', reason: 'found', note: '' })
  const [v, setV] = useState(blank)
  useEffect(() => { if (open) setV(blank()) }, [open])
  const choices = items.filter((i) => i.status === 'active' && (!scope || i.category_id === scope.id))
  const item = items.find((i) => i.id === v.item_id)
  const tracked = !!item && item.tracking !== 'none'
  const noCost = !!item && D(item.qty_on_hand).isZero()
  const lotId = tracked && v.lot_no.trim() ? lots.find((l) => l.item_id === v.item_id && l.lot_no === v.lot_no.trim())?.id ?? null : null
  const onSheet = !!item && (tracked
    ? (!!lotId && lines.some((l) => l.item_id === item.id && l.lot_id === lotId)) || pending.some((p) => p.item_id === item.id && p.lot_no.trim() === v.lot_no.trim() && !!v.lot_no.trim())
    : lines.some((l) => l.item_id === item.id && !l.lot_id) || pending.some((p) => p.item_id === item.id))
  const problem = !v.item_id ? 'Choose the item that was found.' : tracked && !v.lot_no.trim() ? `${item?.sku} is tracked by ${item?.tracking === 'serial' ? 'serial number' : 'lot'}: state which was found.`
    : onSheet ? 'This is already on the count sheet. Enter the quantity found on its line.' : D(v.counted || 0).lte(0) ? 'Enter the quantity found.'
    : item?.tracking === 'serial' && !D(v.counted).eq(1) ? 'A serial number is one unit.' : null
  return (
    <Modal open={open} onClose={onClose} title="Add stock found" subtitle={`Found in the location during ${count.count_no}, and not in the books there.`} width={620}
      footer={<>
        {problem && v.item_id && <span className="mr-auto max-w-[330px] text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem} onClick={() => onAdd(v)}><Plus size={15} /> Add to the sheet</button>
      </>}>
      <Note className="mb-4">The line joins the sheet with a book quantity of zero. It is saved with the rest of the count, and it changes the books only through the approved adjustment.</Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" className="sm:col-span-2" hint={scope ? `This count covers the category ${scope.name}.` : undefined}>
          <select className="field" value={v.item_id} onChange={(e) => setV({ ...v, item_id: e.target.value, lot_no: '', expiry_date: '' })}><option value="">Choose…</option>{choices.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select>
        </Field>
        {tracked && <Field label={item?.tracking === 'serial' ? 'Serial number' : 'Lot number'} hint={lotId ? 'This one is on record.' : 'Not on record: it will be recorded when the count is saved.'}><input className="field num" value={v.lot_no} onChange={(e) => setV({ ...v, lot_no: e.target.value })} /></Field>}
        {tracked && item?.tracking === 'lot' && !lotId && <Field label="Expiry date (optional)"><input type="date" className="field" value={v.expiry_date} onChange={(e) => setV({ ...v, expiry_date: e.target.value })} /></Field>}
        <Field label="Quantity found" hint={item ? `in ${item.unit}` : undefined}><input className="field num" inputMode="decimal" value={v.counted} onChange={(e) => setV({ ...v, counted: digits(e.target.value) })} /></Field>
        {noCost
          ? <Field label="Cost of one" hint="The books hold none of this item, so they carry no cost for it. Without a cost the stock is recorded at no value."><input className="field num" inputMode="decimal" value={v.unit_cost} onChange={(e) => setV({ ...v, unit_cost: digits(e.target.value) })} /></Field>
          : item ? <Field label="Cost of one"><div className="field flex items-center text-ink2"><Money value={unitCost(item)} currency={currency} /><span className="ml-2 text-[11.5px] text-muted">as the stock beside it</span></div></Field> : null}
        <Field label="Reason"><select className="field" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value as StockReason })}>{REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</select></Field>
        <Field label="Note" className="sm:col-span-2"><textarea className="field" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Where it was found, and what is known about it" /></Field>
      </div>
    </Modal>
  )
}
