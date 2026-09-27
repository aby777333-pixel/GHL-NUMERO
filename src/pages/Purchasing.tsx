import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, ClipboardList, FileQuestion, FileText, PackageCheck, Plus, ShoppingCart } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { Invoice, Payment } from '@/engine/types'
import type { PurchaseDoc, PurchaseKind } from '@/engine/opsTypes'
import { openCommitments } from '@/engine/forward'
import { D, sum } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, ErrorBox, Loading, Money, Note, PageHeader, Panel, StatusChip, Tabs, Truth } from '@/ui/kit'
import { usePartyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'

// =====================================================================
// Purchase-to-pay. None of the documents on this screen touches the
// ledger: a requisition asks, a quotation offers, an order commits and a
// receipt confirms. Only the vendor's bill becomes a cost.
// =====================================================================

const TAB_KEYS = ['requisition', 'rfq', 'quotation', 'purchase_order', 'receipts', 'commitments'] as const
type TabKey = typeof TAB_KEYS[number]
type DocTab = Exclude<TabKey, 'commitments'>

const KIND_LABEL: Record<PurchaseKind, string> = {
  requisition: 'Purchase requisition', rfq: 'Request for quotation', quotation: 'Vendor quotation', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt', service_receipt: 'Service receipt',
}
const TAB_KINDS: Record<DocTab, PurchaseKind[]> = {
  requisition: ['requisition'], rfq: ['rfq'], quotation: ['quotation'], purchase_order: ['purchase_order'], receipts: ['goods_receipt', 'service_receipt'],
}
const TAB_TEXT: Record<DocTab, { plural: string; dateHeader: string | null; emptyTitle: string; emptyBody: string; create: PurchaseKind | null; createLabel: string | null; icon: ReactNode }> = {
  requisition: { plural: 'requisitions', dateHeader: 'Required by', emptyTitle: 'No requisition yet', emptyBody: 'A requisition states what is needed and why. Once approved it can become a request for quotation or a purchase order.', create: 'requisition', createLabel: 'New requisition', icon: <ClipboardList size={20} /> },
  rfq: { plural: 'requests for quotation', dateHeader: 'Reply by', emptyTitle: 'No request for quotation yet', emptyBody: 'A request for quotation asks vendors to quote for an approved requisition. Create one from the requisition, or start a new one here.', create: 'rfq', createLabel: 'New request for quotation', icon: <FileQuestion size={20} /> },
  quotation: { plural: 'vendor quotations', dateHeader: 'Valid until', emptyTitle: 'No vendor quotation yet', emptyBody: 'Record each quotation a vendor sends. NUMERO sets them side by side; a person chooses the vendor and records why.', create: 'quotation', createLabel: 'Record a vendor quotation', icon: <FileText size={20} /> },
  purchase_order: { plural: 'purchase orders', dateHeader: 'Required by', emptyTitle: 'No purchase order yet', emptyBody: 'An approved purchase order is a commitment to the vendor. It is not a cost until the vendor\'s bill is approved.', create: 'purchase_order', createLabel: 'New purchase order', icon: <ShoppingCart size={20} /> },
  receipts: { plural: 'receipts', dateHeader: null, emptyTitle: 'No receipt yet', emptyBody: 'A receipt confirms what was delivered against an order. Open an approved purchase order and choose "Record goods receipt" or "Record service receipt".', create: null, createLabel: null, icon: <PackageCheck size={20} /> },
}
const NO_CREATE = 'Your role does not include the permission to prepare purchasing documents (purchase.create).'
const humanise = (s: string) => s.replace(/_/g, ' ')
const statusLabel = (d: Pick<PurchaseDoc, 'kind' | 'status'>) => (d.status === 'submitted' ? 'awaiting approval' : humanise(d.status))
const foot = 'border-t border-line2 px-[14px] py-[10px]'

type Commitment = ReturnType<typeof openCommitments>[number]

export default function Purchasing() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const tab: TabKey = TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'requisition'
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session)
  const partyName = usePartyName()
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const asOf = today()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  const main = useAsync(async () => {
    const [docs, bills, payments] = await Promise.all([
      api.listPurchaseDocs({ companyIds: ids }),
      // bills and payments need their own permissions; the purchasing documents must still load without them
      api.listInvoices({ companyIds: ids, docTypes: ['purchase_bill'] }).then((rows) => ({ rows, error: null as string | null }), (e: unknown) => ({ rows: [] as Invoice[], error: e instanceof Error ? e.message : String(e) })),
      api.listPayments({ companyIds: ids }).then((rows) => ({ rows, error: null as string | null }), (e: unknown) => ({ rows: [] as Payment[], error: e instanceof Error ? e.message : String(e) })),
    ])
    return { docs, bills, payments }
  }, [api, idsKey])

  const d = main.data
  // while another selection is loading, never show documents of companies that are no longer selected
  const docs = useMemo(() => (d?.docs ?? []).filter((x) => ids.includes(x.company_id)), [d, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const coById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const noById = useMemo(() => new Map(docs.map((x) => [x.id, x])), [docs])
  const go = (k: TabKey) => { setStatus(''); setQ(''); setSp(k === 'requisition' ? {} : { tab: k }, { replace: true }) }
  const mayCreate = can('purchase.create')
  const multi = ids.length > 1

  // ------------------------------------------------------------ the flow and its counts
  const live = docs.filter((x) => x.status !== 'cancelled')
  const count = (kinds: PurchaseKind[]) => live.filter((x) => kinds.includes(x.kind)).length
  const orderIds = new Set(docs.filter((x) => x.kind === 'purchase_order').map((x) => x.id))
  const linkedBills = (d?.bills.rows ?? []).filter((b) => ids.includes(b.company_id) && b.po_id && orderIds.has(b.po_id) && b.status !== 'cancelled')
  const billIds = new Set(linkedBills.map((b) => b.id))
  const paid = (d?.payments.rows ?? []).filter((p) => p.direction === 'out' && p.status === 'posted' && (p.allocations ?? []).some((x) => billIds.has(x.invoice_id)))
  const waiting = (kind: PurchaseKind) => live.filter((x) => x.kind === kind && x.status === 'submitted').length
  const unknown = (e: string | null | undefined) => (e ? 'not available to your role' : null)

  const stages: { key: string; label: string; count: number | null; note: string; on: () => void; active: boolean }[] = [
    { key: 'requisition', label: 'Requisition', count: count(['requisition']), note: waiting('requisition') ? `${waiting('requisition')} awaiting approval` : 'what is needed, and why', on: () => go('requisition'), active: tab === 'requisition' },
    { key: 'rfq', label: 'Request for quotation', count: count(['rfq']), note: `${live.filter((x) => x.kind === 'rfq' && x.status === 'sent').length} open with vendors`, on: () => go('rfq'), active: tab === 'rfq' },
    { key: 'quotation', label: 'Vendor quotations', count: count(['quotation']), note: `${live.filter((x) => x.kind === 'quotation' && x.status === 'received').length} awaiting a decision`, on: () => go('quotation'), active: tab === 'quotation' },
    { key: 'select', label: 'A person selects', count: live.filter((x) => x.kind === 'quotation' && x.status === 'selected').length, note: 'with a recorded reason', on: () => { go('quotation'); setStatus('selected') }, active: false },
    { key: 'purchase_order', label: 'Purchase order', count: count(['purchase_order']), note: waiting('purchase_order') ? `${waiting('purchase_order')} awaiting approval` : 'a commitment, not a cost', on: () => go('purchase_order'), active: tab === 'purchase_order' },
    { key: 'receipts', label: 'Goods or service receipt', count: count(['goods_receipt', 'service_receipt']), note: 'what was delivered', on: () => go('receipts'), active: tab === 'receipts' },
    { key: 'bill', label: 'Vendor\'s bill', count: d?.bills.error ? null : linkedBills.length, note: unknown(d?.bills.error) ?? 'linked to an order · the cost', on: () => nav('/bills'), active: false },
    { key: 'match', label: 'Three-way comparison', count: d?.bills.error ? null : new Set(linkedBills.map((b) => b.po_id)).size, note: unknown(d?.bills.error) ?? 'orders with a bill to compare', on: () => go('purchase_order'), active: false },
    { key: 'payment', label: 'Payment', count: d?.bills.error || d?.payments.error ? null : paid.length, note: unknown(d?.bills.error ?? d?.payments.error) ?? 'against those bills', on: () => nav('/payments'), active: false },
  ]

  // ------------------------------------------------------------ the list of the selected tab
  const docTab: DocTab | null = tab === 'commitments' ? null : tab
  const inTab = docTab ? docs.filter((x) => TAB_KINDS[docTab].includes(x.kind)) : []
  const needle = q.trim().toLowerCase()
  const rows = inTab.filter((x) => (!status || x.status === status)
    && (!needle || [x.doc_no, x.title, x.reason, x.party_id ? partyName(x.party_id) : '', x.parent_id ? noById.get(x.parent_id)?.doc_no : ''].some((v) => (v ?? '').toLowerCase().includes(needle))))
  const statuses = [...new Set(inTab.map((x) => x.status))].sort()
  const filtered = Boolean(status || needle)
  const dateOf = (x: PurchaseDoc) => (x.kind === 'rfq' || x.kind === 'quotation' ? x.valid_until : x.required_date)
  const expired = (x: PurchaseDoc) => x.kind === 'quotation' && x.status === 'received' && !!x.valid_until && x.valid_until < asOf

  const columns: Column<PurchaseDoc>[] = docTab ? [
    { key: 'no', header: 'Number', render: (x) => <span className="num text-[12.5px] text-gold">{x.doc_no}</span>, sort: (x) => x.doc_no, csv: (x) => x.doc_no },
    ...(docTab === 'receipts' ? [{ key: 'kind', header: 'Kind', render: (x: PurchaseDoc) => <span className="text-[12.5px] text-ink2">{KIND_LABEL[x.kind]}</span>, sort: (x: PurchaseDoc) => x.kind, csv: (x: PurchaseDoc) => KIND_LABEL[x.kind] }] : []),
    { key: 'date', header: 'Date', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.doc_date)}</span>, sort: (x) => x.doc_date, csv: (x) => x.doc_date },
    { key: 'title', header: 'Title', render: (x) => <span className="text-ink">{x.title || <span className="text-muted">No title</span>}</span>, sort: (x) => (x.title ?? '').toLowerCase(), csv: (x) => x.title ?? '' },
    { key: 'vendor', header: 'Vendor', render: (x) => <span className="text-ink2">{partyName(x.party_id)}</span>, sort: (x) => partyName(x.party_id).toLowerCase(), csv: (x) => (x.party_id ? partyName(x.party_id) : '') },
    ...(multi ? [{ key: 'company', header: 'Company', render: (x: PurchaseDoc) => <span className="text-ink2" title={coById.get(x.company_id)?.name}>{coById.get(x.company_id)?.code ?? '—'}</span>, sort: (x: PurchaseDoc) => coById.get(x.company_id)?.name ?? '', csv: (x: PurchaseDoc) => coById.get(x.company_id)?.name ?? '' }] : []),
    { key: 'total', header: 'Total', align: 'right', render: (x) => <Money value={x.total} currency={x.currency} dim />, sort: (x) => D(x.total).times(x.fx_rate).toNumber(), csv: (x) => D(x.total).toFixed(2) },
    { key: 'ccy', header: 'Currency', render: (x) => <span className="num text-[12px] text-muted">{x.currency}</span>, sort: (x) => x.currency, csv: (x) => x.currency },
    ...(TAB_TEXT[docTab].dateHeader ? [{
      key: 'due', header: TAB_TEXT[docTab].dateHeader as string, sort: (x: PurchaseDoc) => dateOf(x) ?? '', csv: (x: PurchaseDoc) => dateOf(x) ?? '',
      render: (x: PurchaseDoc) => (dateOf(x) ? <span className="num text-[12.5px] text-ink2">{fmtDate(dateOf(x))}{expired(x) && <span className="chip warn ml-1.5">expired</span>}</span> : <span className="text-muted">—</span>),
    }] : []),
    { key: 'status', header: 'Status', render: (x) => <StatusChip status={x.status} label={statusLabel(x)} />, sort: (x) => x.status, csv: (x) => statusLabel(x) },
    {
      key: 'parent', header: 'Linked to', sort: (x) => (x.parent_id ? noById.get(x.parent_id)?.doc_no ?? '' : ''), csv: (x) => (x.parent_id ? noById.get(x.parent_id)?.doc_no ?? '' : ''),
      render: (x) => {
        const p = x.parent_id ? noById.get(x.parent_id) : undefined
        if (!x.parent_id) return <span className="text-muted">—</span>
        if (!p) return <span className="text-[12px] text-muted">not shared with you</span>
        return <button className="link num text-[12.5px]" title={KIND_LABEL[p.kind]} onClick={(e) => { e.stopPropagation(); nav('/purchasing/' + p.id) }}>{p.doc_no}</button>
      },
    },
  ] : []

  // ------------------------------------------------------------ commitments
  const commitments = useMemo(() => (d && !d.bills.error ? openCommitments(docs, d.bills.rows.filter((b) => ids.includes(b.company_id))) : []), [d, docs]) // eslint-disable-line react-hooks/exhaustive-deps
  const committed = sum(commitments.map((c) => c.openBase))
  const base = (c: Commitment) => coById.get(c.po.company_id)?.base_currency
  const currencies = [...new Set(commitments.map((c) => base(c)))]
  const commitmentColumns: Column<Commitment>[] = [
    { key: 'no', header: 'Order', render: (c) => <div className="min-w-0"><div className="num text-[12.5px] text-gold">{c.po.doc_no}</div>{c.po.title && <div className="truncate text-[11.5px] text-muted">{c.po.title}</div>}</div>, sort: (c) => c.po.doc_no, csv: (c) => c.po.doc_no },
    { key: 'vendor', header: 'Vendor', render: (c) => <span className="text-ink2">{partyName(c.po.party_id)}</span>, sort: (c) => partyName(c.po.party_id).toLowerCase(), csv: (c) => (c.po.party_id ? partyName(c.po.party_id) : '') },
    ...(multi ? [{ key: 'company', header: 'Company', render: (c: Commitment) => <span className="text-ink2">{coById.get(c.po.company_id)?.code ?? '—'}</span>, sort: (c: Commitment) => coById.get(c.po.company_id)?.name ?? '', csv: (c: Commitment) => coById.get(c.po.company_id)?.name ?? '' }] : []),
    { key: 'required', header: 'Required by', render: (c) => <span className="num text-[12.5px] text-ink2">{fmtDate(c.po.required_date)}</span>, sort: (c) => c.po.required_date ?? '', csv: (c) => c.po.required_date ?? '' },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.po.status} />, sort: (c) => c.po.status, csv: (c) => humanise(c.po.status) },
    { key: 'ordered', header: 'Ordered', align: 'right', render: (c) => <Money value={c.ordered} currency={c.po.currency} />, sort: (c) => c.ordered.toNumber(), csv: (c) => c.ordered.toFixed(2) },
    { key: 'billed', header: 'Billed', align: 'right', render: (c) => <Money value={c.billed} currency={c.po.currency} dim />, sort: (c) => c.billed.toNumber(), csv: (c) => c.billed.toFixed(2) },
    { key: 'open', header: 'Open, before tax', align: 'right', render: (c) => <Money value={c.open} currency={c.po.currency} />, sort: (c) => c.open.toNumber(), csv: (c) => c.open.toFixed(2) },
    { key: 'openTax', header: 'Open, with tax', align: 'right', render: (c) => <Money value={c.openWithTax} currency={c.po.currency} />, sort: (c) => c.openWithTax.toNumber(), csv: (c) => c.openWithTax.toFixed(2) },
    { key: 'ccy', header: 'Currency', render: (c) => <span className="num text-[12px] text-muted">{c.po.currency}</span>, sort: (c) => c.po.currency, csv: (c) => c.po.currency },
    { key: 'base', header: 'Open commitment', align: 'right', render: (c) => <Money value={c.openBase} currency={base(c)} className="font-medium text-ink" />, sort: (c) => c.openBase.toNumber(), csv: (c) => c.openBase.toFixed(2) },
  ]

  const newDoc = (kind: PurchaseKind) => nav(`/purchasing/new?kind=${kind}`)
  const newButton = (kind: PurchaseKind, label: string, primary = false) => (
    <button className={cx('btn', primary && 'primary')} disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => newDoc(kind)}><Plus size={14} /> {label}</button>
  )

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Purchasing"
        subtitle={<>
          From the request to the payment, one linked chain. Purchasing documents never touch the ledger; only the vendor's bill does · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}
          {mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}
        </>}
        actions={<>
          {newButton('rfq', 'New request for quotation')}
          {newButton('quotation', 'Record a vendor quotation')}
          {newButton('purchase_order', 'New purchase order')}
          {newButton('requisition', 'New requisition', true)}
        </>} />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading purchasing documents" /></Panel>}

      {d && (
        <>
          <Panel className="mb-4 p-4" lit={false}>
            <div className="eyebrow mb-3">Purchase to pay</div>
            <div className="flex flex-wrap items-stretch gap-y-2" role="group" aria-label="The stages of purchase to pay, with the number of documents at each">
              {stages.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <span className="flex items-center px-1 text-muted" aria-hidden="true"><ChevronRight size={15} /></span>}
                  <button onClick={s.on} aria-pressed={s.active}
                    className={cx('min-w-[118px] flex-1 rounded-xl border bg-surface px-3 py-2 text-left transition-colors hover:border-line2', s.active ? 'border-gold/50 bg-surface2' : 'border-line')}>
                    <div className="text-[11.5px] leading-tight text-ink2">{s.label}</div>
                    <div className="num mt-1 text-[18px] leading-none text-ink">{s.count === null ? '—' : s.count.toLocaleString()}</div>
                    <div className="mt-1 text-[10.5px] leading-tight text-muted">{s.note}</div>
                  </button>
                </Fragment>
              ))}
            </div>
            <div className="mt-3 text-[11.5px] text-muted">Counts leave out cancelled documents. The three-way comparison sets the order, the receipts and the bills side by side; it identifies differences and leaves the decision to a person.</div>
          </Panel>

          <Tabs<TabKey> value={tab} onChange={go} tabs={[
            { key: 'requisition', label: 'Requisitions', count: docs.filter((x) => x.kind === 'requisition').length },
            { key: 'rfq', label: 'Requests for quotation', count: docs.filter((x) => x.kind === 'rfq').length },
            { key: 'quotation', label: 'Vendor quotations', count: docs.filter((x) => x.kind === 'quotation').length },
            { key: 'purchase_order', label: 'Purchase orders', count: docs.filter((x) => x.kind === 'purchase_order').length },
            { key: 'receipts', label: 'Receipts', count: docs.filter((x) => x.kind === 'goods_receipt' || x.kind === 'service_receipt').length },
            { key: 'commitments', label: 'Commitments', count: d.bills.error ? undefined : commitments.length },
          ]} />

          {docTab && (
            <>
              {docTab === 'quotation' && <Note className="mb-3">NUMERO shows the comparison; a person chooses the vendor and records why. The lowest quotation is marked for information and is never selected automatically.</Note>}
              {docTab === 'purchase_order' && <Note className="mb-3">An approved order is a commitment, not a cost. It becomes a cost when the vendor's bill is approved.</Note>}
              <Panel lit={false}>
                <DataTable<PurchaseDoc> key={docTab} columns={columns} rows={rows} rowKey={(x) => x.id} onRow={(x) => nav('/purchasing/' + x.id)} exportName={`purchasing-${docTab.replace(/_/g, '-')}`} initialSort={{ key: 'date', dir: 'desc' }}
                  toolbar={<>
                    <input className="field sm" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, title, vendor" aria-label={`Search ${TAB_TEXT[docTab].plural}`} />
                    <select className="field sm" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                      <option value="">Every status</option>{statuses.map((s) => <option key={s} value={s}>{s === 'submitted' ? 'awaiting approval' : humanise(s)}</option>)}
                      {status && !statuses.includes(status as PurchaseDoc['status']) && <option value={status}>{humanise(status)}</option>}
                    </select>
                    {filtered && <button className="btn sm ghost" onClick={() => { setQ(''); setStatus('') }}>Clear filters</button>}
                  </>}
                  empty={{
                    title: filtered ? `No ${TAB_TEXT[docTab].plural} match this filter` : TAB_TEXT[docTab].emptyTitle,
                    body: filtered ? 'Clear the filter to see every document.' : TAB_TEXT[docTab].emptyBody,
                    icon: TAB_TEXT[docTab].icon,
                    action: filtered ? <button className="btn sm" onClick={() => { setQ(''); setStatus('') }}>Clear filters</button>
                      : TAB_TEXT[docTab].create ? <button className="btn sm" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => newDoc(TAB_TEXT[docTab].create as PurchaseKind)}><Plus size={13} /> {TAB_TEXT[docTab].createLabel}</button>
                      : <button className="btn sm" onClick={() => go('purchase_order')}>Open purchase orders</button>,
                  }} />
              </Panel>
            </>
          )}

          {tab === 'commitments' && (
            d.bills.error ? (
              <Note kind="warn">Open commitments cannot be calculated for your account, because the vendor bills could not be loaded: {d.bills.error}</Note>
            ) : (
              <>
                <Panel className="mb-4 p-5">
                  <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">Open purchase commitments</span><Truth state="COMMITTED" /></div>
                  <Money value={committed} currency={currencies.length === 1 ? currencies[0] : undefined} className="mt-1.5 block text-[28px] leading-none" />
                  <div className="mt-1.5 text-[12px] text-muted"><span className="num text-ink2">{commitments.length.toLocaleString()}</span> approved order{commitments.length === 1 ? '' : 's'} not yet fully billed · including tax, in each company's own currency</div>
                  <div className="mt-3 max-w-3xl text-[12.5px] text-ink2">An approved order is a commitment, not a cost. It becomes a cost when the vendor's bill is approved.</div>
                  {currencies.length > 1 && <div className="mt-2 text-[12px] text-warn">The selected companies keep their books in different currencies ({currencies.join(', ')}). The total adds the figures as recorded, without conversion.</div>}
                </Panel>
                <Panel lit={false}>
                  <DataTable<Commitment> columns={commitmentColumns} rows={commitments} rowKey={(c) => c.po.id} onRow={(c) => nav('/purchasing/' + c.po.id)} exportName="open-purchase-commitments" initialSort={{ key: 'base', dir: 'desc' }}
                    footer={<tr>
                      <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={commitmentColumns.length - 1}>Total committed · {commitments.length.toLocaleString()} order{commitments.length === 1 ? '' : 's'}</td>
                      <td className={cx(foot, 'r')}><Money value={committed} currency={currencies.length === 1 ? currencies[0] : undefined} className="font-medium text-ink" /></td>
                    </tr>}
                    empty={{ title: 'No open commitment', body: 'Every approved purchase order in the selected companies has been billed in full, or no order has been approved yet.', icon: <ShoppingCart size={20} /> }} />
                </Panel>
                <div className="mt-2 text-[11.5px] text-muted">Open = ordered − billed, before tax, counting approved bills linked to the order. Tax is added in the same proportion. Orders in a foreign currency are converted at the rate recorded on the order.</div>
              </>
            )
          )}
        </>
      )}
    </div>
  )
}
