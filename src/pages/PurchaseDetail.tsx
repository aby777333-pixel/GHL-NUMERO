import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  ArrowLeft, BadgeCheck, Ban, ChevronRight, FilePlus2, FileSearch, Link2, PackageCheck, Pencil, Scale, Send, ShoppingCart, Unlink, UserCheck, XCircle,
} from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { AuditEntry, ID, Invoice, Payment } from '@/engine/types'
import type { PurchaseDoc, PurchaseKind, PurchaseLine } from '@/engine/opsTypes'
import { compareQuotations, threeWayMatch, type MatchLine, type MatchStatus } from '@/engine/ops'
import { D, ZERO, round2, sum } from '@/lib/money'
import { fiscalYearOf, fmtDate, fmtDateTime, fyEnd, fyLabel, fyStart, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { ApprovalTrail, Attachments, useAccountName, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'

// =====================================================================
// One purchasing document and the whole chain it belongs to: from the
// requisition to the payment. The comparisons on this screen state what
// differs. They never choose a vendor, never block a bill and never
// decide what a difference means — people do.
// =====================================================================

const KIND_LABEL: Record<PurchaseKind, string> = {
  requisition: 'Purchase requisition', rfq: 'Request for quotation', quotation: 'Vendor quotation', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt', service_receipt: 'Service receipt',
}
const AUDIT_LABEL: Record<string, string> = {
  draft_saved: 'draft saved', submitted: 'submitted for approval', sent: 'marked as sent to vendors', received: 'marked as received', confirmed: 'receipt confirmed', approved: 'approved',
  approval_step: 'approved at one step; further approval required', rejected: 'rejected', vendor_selected: 'vendor selected', cancelled: 'cancelled', closed: 'short-closed',
}
const MATCH_TONE: Record<MatchStatus, string> = {
  MATCHED: 'pos', 'NOT BILLED': '', 'PART BILLED': 'cyan', 'NOT RECEIVED': '', 'QUANTITY DIFFERENCE': 'warn', 'PRICE DIFFERENCE': 'warn', 'BILLED BEFORE RECEIPT': 'warn',
}
const OVERALL_TONE = { MATCHED: 'pos', INCOMPLETE: 'cyan', 'DIFFERENCES FOUND': 'warn' } as const
const NO_CREATE = 'Your role does not include the permission to prepare purchasing documents (purchase.create).'
const NO_APPROVE = 'Your role does not include the permission to approve purchasing documents (purchase.approve).'
const NO_BILL = 'Your role does not include the permission to record vendor bills (bill.create).'
const humanise = (s: string) => s.replace(/[_.]/g, ' ')
const isReceipt = (k: PurchaseKind) => k === 'goods_receipt' || k === 'service_receipt'
const statusLabel = (s: string) => (s === 'submitted' ? 'awaiting approval' : humanise(s))
const qty = (v: Decimal.Value) => D(v).toDecimalPlaces(3).toString()
const foot = 'border-t border-line2 px-[14px] py-[10px]'

interface Loaded {
  doc: PurchaseDoc
  chain: PurchaseDoc[]
  /** bills linked to the orders of this chain, with their lines */
  bills: Invoice[]
  /** bills of the same vendor and company that are not linked to any order */
  unlinked: Invoice[]
  billError: string | null
  payments: Payment[]
  paymentError: string | null
  audit: { rows: AuditEntry[]; error: string | null }
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function PurchaseDetail() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!

  const main = useAsync<Loaded | null>(async () => {
    if (!id) return null
    const [doc, chain] = await Promise.all([api.getPurchaseDoc(id), api.getPurchaseChain(id)])
    const orderIds = new Set(chain.filter((x) => x.kind === 'purchase_order').map((x) => x.id))
    let bills: Invoice[] = [], unlinked: Invoice[] = [], billError: string | null = null
    try {
      const all = await api.listInvoices({ companyIds: [doc.company_id], docTypes: ['purchase_bill'] })
      bills = await Promise.all(all.filter((b) => b.po_id && orderIds.has(b.po_id)).map((b) => api.getInvoice(b.id)))
      if (doc.kind === 'purchase_order') unlinked = all.filter((b) => !b.po_id && b.status !== 'cancelled' && b.party_id === doc.party_id)
    } catch (e) { billError = message(e) }
    let payments: Payment[] = [], paymentError: string | null = null
    if (bills.length) {
      try {
        const billIds = new Set(bills.map((b) => b.id))
        payments = (await api.listPayments({ companyIds: [doc.company_id] })).filter((p) => (p.allocations ?? []).some((a) => billIds.has(a.invoice_id)))
      } catch (e) { paymentError = message(e) }
    }
    // history needs audit access; the rest of the page must still load without it
    const audit = await api.listAudit({ entity: 'purchase_docs', entityId: id, limit: 100 }).then(
      (rows) => ({ rows, error: null as string | null }),
      (e: unknown) => ({ rows: [] as AuditEntry[], error: message(e) }),
    )
    return { doc, chain, bills, unlinked, billError, payments, paymentError, audit }
  }, [api, id])

  if (main.error) {
    return (
      <div>
        <PageHeader eyebrow="Purchase to pay" title="Purchasing document" actions={<button className="btn" onClick={() => nav('/purchasing')}><ArrowLeft size={14} /> Back to purchasing</button>} />
        <ErrorBox message={main.error} retry={main.reload} />
      </div>
    )
  }
  if (!main.data || main.data.doc.id !== id) return <Panel><Loading rows={7} label="Loading the document" /></Panel>
  return <DocView key={main.data.doc.id} d={main.data} />
}

type Dialog = 'approve' | 'reject' | 'select' | 'cancel' | null
interface Node { key: string; no: string; date: string; amount: Decimal.Value; currency: string; status: string; label: string; sub?: string; to: string; current: boolean }

function DocView({ d }: { d: Loaded }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const session = useApp((s) => s.session)
  const baseCurrency = useApp((s) => s.companies.find((c) => c.id === d.doc.company_id)?.base_currency)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [linking, setLinking] = useState(false)

  const doc = d.doc
  const id = doc.id
  const lines = doc.lines ?? []
  const asOf = today()
  const receipt = isReceipt(doc.kind)
  const mine = !!session && doc.created_by === session.user.id
  const mayCreate = can('purchase.create', doc.company_id)
  const mayApprove = can('purchase.approve', doc.company_id)
  const mayBill = can('bill.create', doc.company_id)
  const mayChange = mine || mayApprove
  const NOT_YOURS = 'Only the person who prepared this document, or a person who can approve purchasing documents, may do this.'

  const byId = useMemo(() => new Map(d.chain.map((x) => [x.id, x])), [d.chain])
  const parent = doc.parent_id ? byId.get(doc.parent_id) : undefined
  const orderBills = d.bills.filter((b) => b.po_id === id)
  const liveBills = orderBills.filter((b) => !['draft', 'cancelled'].includes(b.status))
  const receipts = d.chain.filter((x) => x.parent_id === id && isReceipt(x.kind))
  const expired = doc.kind === 'quotation' && !!doc.valid_until && doc.valid_until < asOf
  const open = !['cancelled', 'closed'].includes(doc.status)
  const committed = doc.kind === 'purchase_order' && ['approved', 'partially_received', 'fully_received'].includes(doc.status)

  // ------------------------------------------------------------ the chain
  const stages: { key: string; label: string; nodes: Node[] }[] = useMemo(() => {
    const node = (x: PurchaseDoc): Node => ({ key: x.id, no: x.doc_no, date: x.doc_date, amount: x.total, currency: x.currency, status: x.status, label: statusLabel(x.status), sub: x.party_id ? partyName(x.party_id) : undefined, to: '/purchasing/' + x.id, current: x.id === id })
    const of = (...kinds: PurchaseKind[]) => d.chain.filter((x) => kinds.includes(x.kind)).map(node)
    const billIds = new Set(d.bills.map((b) => b.id))
    return [
      { key: 'requisition', label: 'Requisition', nodes: of('requisition') },
      { key: 'rfq', label: 'Request for quotation', nodes: of('rfq') },
      { key: 'quotation', label: 'Quotations', nodes: of('quotation') },
      { key: 'order', label: 'Order', nodes: of('purchase_order') },
      { key: 'receipts', label: 'Receipts', nodes: of('goods_receipt', 'service_receipt') },
      { key: 'bills', label: 'Bills', nodes: d.bills.map((b) => ({ key: b.id, no: b.doc_no ?? 'Draft bill', date: b.doc_date, amount: b.total, currency: b.currency, status: b.status, label: b.status === 'draft' ? 'awaiting approval' : humanise(b.status), sub: b.reference ?? undefined, to: '/bills/' + b.id, current: false })) },
      { key: 'payments', label: 'Payments', nodes: d.payments.map((p) => ({ key: p.id, no: p.pay_no ?? 'Draft payment', date: p.pay_date, amount: sum((p.allocations ?? []).filter((a) => billIds.has(a.invoice_id)).map((a) => a.amount)), currency: p.currency, status: p.status, label: humanise(p.status), sub: p.reference ?? undefined, to: p.journal_id ? '/journals/' + p.journal_id : '/payments', current: false })) },
    ]
  }, [d, id, partyName])

  // ------------------------------------------------------------ actions
  const go = (kind: PurchaseKind) => nav(`/purchasing/new?kind=${kind}&parent=${id}`)
  const confirm = async (reason: string) => {
    const what = dialog
    setDialog(null)
    if (what === 'approve') await act(() => api.approvePurchaseDoc(id, reason || undefined), (r) => (r === 'approved' ? `${KIND_LABEL[doc.kind]} approved` : 'Approved at this step. A further approval is required.'))
    else if (what === 'reject') await act(() => api.rejectPurchaseDoc(id, reason), `${KIND_LABEL[doc.kind]} rejected`)
    else if (what === 'select') await act(() => api.selectQuotation(id, reason), 'Vendor selected — the reason is recorded')
    else if (what === 'cancel') await act(() => api.cancelPurchaseDoc(id, reason), doc.kind === 'purchase_order' && liveBills.length ? 'Order short-closed' : `${KIND_LABEL[doc.kind]} cancelled`)
  }
  const dialogText: Record<Exclude<Dialog, null>, { title: string; body: ReactNode; confirm: string; danger?: boolean; required: boolean }> = {
    approve: {
      title: `Approve ${doc.doc_no}`, confirm: 'Approve', required: false,
      body: doc.kind === 'purchase_order' ? 'Approving makes this order a commitment to the vendor. It is not a cost: no accounting entry is made until the vendor\'s bill is approved. The person who prepared the order cannot approve it.' : 'Approving allows this requisition to become a request for quotation or a purchase order. The person who prepared it cannot approve it.',
    },
    reject: { title: `Reject ${doc.doc_no}`, confirm: 'Reject', danger: true, required: true, body: 'The document returns to the person who prepared it, with your reason. It can be corrected and submitted again.' },
    select: {
      title: 'Why is this vendor selected?', confirm: 'Select this vendor', required: true,
      body: <>You are selecting <strong className="text-ink">{partyName(doc.party_id)}</strong> at <Money value={doc.total} currency={doc.currency} className="text-ink" />. The other quotations for the same request are marked as not selected. Price, delivery, warranty, payment terms and the vendor's record are all part of the decision; record what decided it.</>,
    },
    cancel: {
      title: doc.kind === 'purchase_order' && liveBills.length ? `Short-close ${doc.doc_no}` : `Cancel ${doc.doc_no}`, confirm: doc.kind === 'purchase_order' && liveBills.length ? 'Short-close the order' : 'Cancel the document', danger: true, required: true,
      body: doc.kind === 'purchase_order' && liveBills.length
        ? 'A bill has been recorded against this order, so it cannot be cancelled. It will be short-closed: what was billed stays as recorded, and the rest of the commitment is released.'
        : doc.kind === 'purchase_order' ? 'The commitment is released. An order against which goods or services have been received cannot be cancelled until those receipts are cancelled.'
        : receipt ? 'The receipt is withdrawn and the received status of the order is recalculated.'
        : 'The document is kept in history, marked as cancelled.',
    },
  }

  // ------------------------------------------------------------ parts
  const fact = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <span className="flex-none text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-ink">{value || <span className="text-muted">Not recorded</span>}</span>
    </div>
  )
  const dimText = (dims: Record<string, ID> | undefined) => Object.entries(dims ?? {}).filter(([, v]) => v).map(([t, v]) => `${humanise(t)}: ${unitName(v)}`).join(' · ')
  const receivedOf = (lineId: ID) => sum(receipts.filter((r) => r.status === 'confirmed').flatMap((r) => r.lines ?? []).filter((x) => x.source_line_id === lineId).map((x) => x.quantity))
  const sourceLine = (l: PurchaseLine) => (l.source_line_id && parent ? (parent.lines ?? []).find((x) => x.id === l.source_line_id) : undefined)

  const lineColumns: Column<PurchaseLine>[] = [
    { key: 'no', header: '#', width: 44, render: (l) => <span className="num text-muted">{l.line_no}</span>, sort: (l) => l.line_no, csv: (l) => l.line_no },
    { key: 'description', header: 'Description', render: (l) => <div className="min-w-0"><div className="text-ink">{l.description}</div>{dimText(l.dims) && <div className="text-[11px] text-muted">{dimText(l.dims)}</div>}</div>, csv: (l) => l.description },
    { key: 'ledger', header: 'Ledger to be charged', render: (l) => <span className="text-[12.5px] text-ink2">{l.account_id ? accountName(l.account_id) : <span className="text-muted">Not chosen</span>}</span>, csv: (l) => (l.account_id ? accountName(l.account_id) : '') },
    ...(receipt ? [{ key: 'ordered', header: 'Ordered', align: 'right' as const, render: (l: PurchaseLine) => { const s = sourceLine(l); return s ? <span className="num text-ink2">{qty(s.quantity)}</span> : <span className="text-muted">—</span> }, csv: (l: PurchaseLine) => { const s = sourceLine(l); return s ? qty(s.quantity) : '' } }] : []),
    { key: 'qty', header: receipt ? 'Received' : 'Quantity', align: 'right', render: (l) => <span className="num">{qty(l.quantity)}</span>, sort: (l) => D(l.quantity).toNumber(), csv: (l) => qty(l.quantity) },
    { key: 'unit', header: 'Unit', render: (l) => <span className="text-ink2">{l.unit ?? '—'}</span>, csv: (l) => l.unit ?? '' },
    ...(doc.kind === 'purchase_order' ? [{ key: 'received', header: 'Received so far', align: 'right' as const, render: (l: PurchaseLine) => <span className={cx('num', receivedOf(l.id).gte(l.quantity) ? 'text-pos' : 'text-ink2')}>{qty(receivedOf(l.id))}</span>, csv: (l: PurchaseLine) => qty(receivedOf(l.id)) }] : []),
    { key: 'rate', header: receipt ? 'Ordered rate' : 'Rate', align: 'right', render: (l) => (D(l.rate).isZero() ? <span className="text-muted">—</span> : <Money value={l.rate} currency={doc.currency} />), sort: (l) => D(l.rate).toNumber(), csv: (l) => D(l.rate).toFixed(2) },
    { key: 'amount', header: 'Amount', align: 'right', render: (l) => <Money value={l.amount} currency={doc.currency} dim />, sort: (l) => D(l.amount).toNumber(), csv: (l) => D(l.amount).toFixed(2) },
    { key: 'tax', header: 'Tax', align: 'right', render: (l) => <Money value={l.tax_amount} currency={doc.currency} dim />, sort: (l) => D(l.tax_amount).toNumber(), csv: (l) => D(l.tax_amount).toFixed(2) },
    ...(receipt ? [{ key: 'condition', header: 'Condition', render: (l: PurchaseLine) => <span className="text-[12.5px] text-ink2">{l.condition || '—'}</span>, csv: (l: PurchaseLine) => l.condition ?? '' }] : []),
  ]

  const quotes = doc.kind === 'rfq' ? d.chain.filter((x) => x.kind === 'quotation' && x.parent_id === id)
    : doc.kind === 'quotation' && doc.parent_id ? d.chain.filter((x) => x.kind === 'quotation' && x.parent_id === doc.parent_id) : []
  const showMatch = doc.kind === 'purchase_order' && !['draft', 'submitted', 'rejected', 'cancelled'].includes(doc.status)
  const showBudget = doc.kind === 'purchase_order' && ['draft', 'submitted', 'approved', 'partially_received', 'fully_received'].includes(doc.status)
  const dt = dialog ? dialogText[dialog] : null

  return (
    <div>
      <PageHeader eyebrow={`Purchase to pay · ${KIND_LABEL[doc.kind]}`} title={doc.doc_no}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          {doc.title && <span className="text-ink2">{doc.title}</span>}
          {doc.party_id && <><span>·</span><button className="link" onClick={() => nav('/parties/' + doc.party_id)}>{partyName(doc.party_id)}</button></>}
          <span>·</span><span>{companyName(doc.company_id)}</span>
          {mode === 'demo' && <Truth state="DEMO" />}
        </span>}
        actions={<>
          <button className="btn ghost" onClick={() => nav('/purchasing?tab=' + (receipt ? 'receipts' : doc.kind))}><ArrowLeft size={15} /> Purchasing</button>

          {['draft', 'rejected'].includes(doc.status) && (
            <button className="btn" disabled={!mayCreate || !mayChange} title={!mayCreate ? NO_CREATE : !mayChange ? NOT_YOURS : 'Edit this draft'} onClick={() => nav(`/purchasing/${id}/edit`)}><Pencil size={14} /> Edit</button>
          )}
          {doc.status === 'draft' && (
            <button className="btn primary" disabled={busy || !mayCreate} title={mayCreate ? undefined : NO_CREATE}
              onClick={() => void act(() => api.submitPurchaseDoc(id), (s) => (s === 'submitted' ? 'Submitted for approval' : s === 'sent' ? 'Marked as sent to vendors' : s === 'received' ? 'Marked as received' : 'Receipt confirmed'))}>
              {busy ? <Spinner /> : <Send size={14} />} {doc.kind === 'requisition' || doc.kind === 'purchase_order' ? 'Submit for approval' : doc.kind === 'rfq' ? 'Mark as sent' : doc.kind === 'quotation' ? 'Mark as received' : 'Confirm receipt'}
            </button>
          )}

          {(doc.kind === 'requisition' || doc.kind === 'purchase_order') && doc.status === 'submitted' && <>
            <button className="btn danger" disabled={busy || !mayApprove} title={mayApprove ? undefined : NO_APPROVE} onClick={() => setDialog('reject')}><XCircle size={14} /> Reject</button>
            <button className="btn good" disabled={busy || !mayApprove} title={mayApprove ? 'The person who prepared the document cannot approve it' : NO_APPROVE} onClick={() => setDialog('approve')}><BadgeCheck size={14} /> Approve</button>
          </>}

          {doc.kind === 'requisition' && ['approved', 'ordered'].includes(doc.status) && <>
            <button className="btn" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('rfq')}><FileSearch size={14} /> Create request for quotation</button>
            <button className="btn primary" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('purchase_order')}><ShoppingCart size={14} /> Create purchase order</button>
          </>}

          {doc.kind === 'rfq' && doc.status === 'sent' && (
            <button className="btn primary" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('quotation')}><FilePlus2 size={14} /> Record a vendor quotation</button>
          )}

          {doc.kind === 'quotation' && doc.status === 'received' && (
            <button className="btn good" disabled={busy || !mayApprove || expired} title={!mayApprove ? NO_APPROVE : expired ? `This quotation expired on ${fmtDate(doc.valid_until)}.` : 'A person selects the vendor and records why'} onClick={() => setDialog('select')}><UserCheck size={14} /> Select this vendor</button>
          )}
          {doc.kind === 'quotation' && doc.status === 'selected' && (
            <button className="btn primary" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('purchase_order')}><ShoppingCart size={14} /> Create purchase order</button>
          )}

          {doc.kind === 'purchase_order' && ['approved', 'partially_received'].includes(doc.status) && <>
            <button className="btn" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('goods_receipt')}><PackageCheck size={14} /> Record goods receipt</button>
            <button className="btn" disabled={!mayCreate} title={mayCreate ? undefined : NO_CREATE} onClick={() => go('service_receipt')}><PackageCheck size={14} /> Record service receipt</button>
          </>}
          {doc.kind === 'purchase_order' && ['approved', 'partially_received', 'fully_received', 'billed'].includes(doc.status) && (
            <button className="btn" disabled={!mayBill || !!d.billError} title={!mayBill ? NO_BILL : d.billError ? 'The vendor bills could not be loaded for your account.' : 'Link a bill already recorded from this vendor'} onClick={() => setLinking(true)}><Link2 size={14} /> Link a vendor bill</button>
          )}

          {open && (
            <button className="btn danger" disabled={busy || !mayChange} title={mayChange ? (doc.kind === 'purchase_order' && liveBills.length ? 'A bill has been recorded: the order will be short-closed' : 'Cancel with a reason') : NOT_YOURS} onClick={() => setDialog('cancel')}>
              <Ban size={14} /> {doc.kind === 'purchase_order' && liveBills.length ? 'Short-close' : 'Cancel'}
            </button>
          )}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={doc.status} label={statusLabel(doc.status)} />
        {committed && <Truth state="COMMITTED" />}
        {expired && doc.status === 'received' && <span className="chip warn">expired {fmtDate(doc.valid_until)}</span>}
        <span className="chip">Total <Money value={doc.total} currency={doc.currency} className="ml-1" /></span>
        {doc.approved_at && <span className="chip">{doc.kind === 'quotation' ? 'Selected' : 'Approved'} {fmtDateTime(doc.approved_at)}</span>}
        {(doc.kind === 'requisition' || doc.kind === 'purchase_order') && <ApprovalTrail companyId={doc.company_id} entity={doc.kind} entityId={id} />}
      </div>

      {doc.status === 'rejected' && <Note kind="warn" className="mb-4">Rejected{doc.decision_note ? <>: <span className="text-ink">{doc.decision_note}</span></> : ''}. Edit the document to correct it; saving returns it to draft so that it can be submitted again.</Note>}
      {doc.status === 'cancelled' && <Note className="mb-4">This document was cancelled{doc.decision_note ? <>: <span className="text-ink">{doc.decision_note}</span></> : ''}. It is kept in history.</Note>}
      {doc.status === 'closed' && doc.kind === 'purchase_order' && <Note className="mb-4">This order was short-closed{doc.decision_note ? <>: <span className="text-ink">{doc.decision_note}</span></> : ''}. What was billed stays as recorded; the rest of the commitment has been released.</Note>}
      {doc.status === 'closed' && doc.kind === 'rfq' && <Note className="mb-4">This request is closed: a person has selected a vendor from the quotations received.</Note>}
      {committed && <Note className="mb-4">An approved order is a commitment, not a cost. It becomes a cost when the vendor's bill is approved.</Note>}
      {doc.kind === 'quotation' && doc.status === 'selected' && <Note kind="good" className="mb-4">A person selected this vendor{doc.decision_note ? <>: <span className="text-ink">{doc.decision_note}</span></> : ''}</Note>}
      {d.billError && <Note kind="warn" className="mb-4">The vendor bills of this chain could not be loaded for your account: {d.billError}</Note>}
      {d.paymentError && <Note kind="warn" className="mb-4">The payments of this chain could not be loaded for your account: {d.paymentError}</Note>}

      <Section title="Document chain" className="mb-4">
        <Panel className="p-4" lit={false}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
            {stages.map((s, i) => (
              <Fragment key={s.key}>
                {i > 0 && <span className="hidden flex-none items-center text-muted lg:flex" aria-hidden="true"><ChevronRight size={15} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="eyebrow mb-1.5">{s.label}</div>
                  {s.nodes.length === 0 ? <div className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[11.5px] text-muted">None recorded</div> : (
                    <div className="space-y-1.5">
                      {s.nodes.map((n) => (
                        <button key={n.key} onClick={() => { if (!n.current) nav(n.to) }} aria-current={n.current ? 'page' : undefined} title={n.current ? 'This document' : 'Open'}
                          className={cx('block w-full rounded-xl border px-3 py-2 text-left transition-colors', n.current ? 'cursor-default border-gold/60 bg-goldsoft' : 'border-line bg-surface hover:border-line2')}>
                          <div className="num truncate text-[12px] text-gold">{n.no}</div>
                          {n.sub && <div className="truncate text-[11px] text-ink2">{n.sub}</div>}
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted"><span className="num">{fmtDate(n.date)}</span><Money value={n.amount} currency={n.currency} compact className="text-ink2" /></div>
                          <div className="mt-1"><StatusChip status={n.status} label={n.label} /></div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Fragment>
            ))}
          </div>
          <div className="mt-3 text-[11.5px] text-muted">Every document of the chain, in order. The document you are reading is highlighted. Only the bills and payments reach the ledger.</div>
        </Panel>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Lines">
            <Panel lit={false}>
              <DataTable<PurchaseLine> columns={lineColumns} rows={lines} rowKey={(l) => l.id} exportName={`${doc.doc_no}-lines`} initialSort={{ key: 'no', dir: 'asc' }}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={lineColumns.length - (receipt ? 3 : 2)}>Before tax <Money value={doc.subtotal} currency={doc.currency} className="ml-1 text-ink" /> · tax <Money value={doc.tax_total} currency={doc.currency} className="ml-1 text-ink" /></td>
                  <td className={cx(foot, 'r')} colSpan={2}><span className="mr-2 text-[12.5px] text-ink2">Total</span><Money value={doc.total} currency={doc.currency} className="font-medium text-ink" /></td>
                  {receipt && <td className={foot} />}
                </tr>}
                empty={{ title: 'This document has no lines', icon: <ShoppingCart size={20} /> }} />
            </Panel>
          </Section>

          {(doc.kind === 'rfq' || (doc.kind === 'quotation' && quotes.length > 1)) && <Comparison quotes={quotes} currentId={id} baseCurrency={baseCurrency} />}
          {showMatch && !d.billError && <ThreeWay order={doc} receipts={receipts} bills={orderBills} />}
          {showBudget && <BudgetContext order={doc} bills={orderBills} />}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="eyebrow mb-2">Details</div>
            {fact('Date', fmtDate(doc.doc_date))}
            {fact('Vendor', doc.party_id ? partyName(doc.party_id) : doc.kind === 'rfq' ? 'Sent to several vendors' : null)}
            {parent && fact('Linked to', <button className="link num" onClick={() => nav('/purchasing/' + parent.id)}>{parent.doc_no}</button>)}
            {(doc.kind === 'requisition' || doc.kind === 'purchase_order') && fact('Required by', doc.required_date ? fmtDate(doc.required_date) : null)}
            {(doc.kind === 'rfq' || doc.kind === 'quotation') && fact(doc.kind === 'rfq' ? 'Reply by' : 'Valid until', doc.valid_until ? <span>{fmtDate(doc.valid_until)}{expired && <span className="chip warn ml-1.5">expired</span>}</span> : null)}
            {(doc.kind === 'quotation' || doc.kind === 'purchase_order') && <>
              {fact('Delivery terms', doc.delivery_terms)}
              {fact('Payment terms', doc.payment_terms)}
              {fact('Warranty', doc.warranty)}
            </>}
            {fact('Currency', <span className="num">{doc.currency}{!D(doc.fx_rate).eq(1) ? ` at ${D(doc.fx_rate).toString()}` : ''}</span>)}
            {dimText(doc.dims) && fact('Charged to', dimText(doc.dims))}
            {fact(doc.kind === 'requisition' ? 'Reason for the purchase' : receipt ? 'Remarks' : 'Reason or remarks', doc.reason)}
            {doc.decision_note && fact(doc.kind === 'quotation' && doc.status === 'selected' ? 'Why this vendor was selected' : 'Decision note', doc.decision_note)}
            {fact('Confidentiality', humanise(doc.confidentiality))}
            {fact('Prepared', fmtDateTime(doc.created_at))}
          </Panel>

          {doc.kind === 'purchase_order' && !d.billError && (
            <Section title="Vendor bills linked to this order">
              <Panel className="p-1.5" lit={false}>
                {orderBills.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No bill is linked. The order remains a commitment until a bill is recorded and approved.</div> : orderBills.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] hover:bg-surface2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => nav('/bills/' + b.id)}>
                      <span className="num text-gold">{b.doc_no ?? 'Draft bill'}</span> <span className="text-muted">· {fmtDate(b.doc_date)}{b.reference ? ` · ${b.reference}` : ''}</span>
                      <span className="mt-0.5 block"><StatusChip status={b.status} label={b.status === 'draft' ? 'awaiting approval' : undefined} /></span>
                    </button>
                    <Money value={b.total} currency={b.currency} />
                    <button className="btn sm ghost" disabled={busy || !mayBill} title={mayBill ? 'Remove the link between this bill and the order. The bill itself is not changed.' : NO_BILL}
                      onClick={() => void act(() => api.linkBillToPo(b.id, null), 'Bill unlinked from the order')}><Unlink size={13} /> Unlink</button>
                  </div>
                ))}
              </Panel>
            </Section>
          )}

          <Attachments companyId={doc.company_id} entity="purchase_docs" entityId={id} />

          <Section title="History">
            {d.audit.error && <Note kind="warn" className="mb-2">The history could not be loaded for your account: {d.audit.error}</Note>}
            <Panel className="max-h-[360px] overflow-auto p-1.5" lit={false}>
              {d.audit.rows.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No change has been recorded.</div> : d.audit.rows.map((r) => {
                const v = (r.new_value && typeof r.new_value === 'object' ? r.new_value : {}) as Record<string, unknown>
                return (
                  <div key={String(r.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{AUDIT_LABEL[r.action] ?? humanise(r.action)}</span> <span className="text-muted">· {r.actor_name ?? 'System'} · {fmtDateTime(r.at)}</span>
                    {r.action === 'vendor_selected' && typeof v.was_lowest === 'boolean' && (
                      <div className="mt-0.5 text-[12px] text-ink2">
                        The selected quotation {v.was_lowest ? 'was' : 'was not'} the lowest.
                        {!v.was_lowest && v.lowest_quote != null && <> The lowest quotation was <Money value={v.lowest_quote as string} currency={baseCurrency} className="text-ink" />.</>}
                      </div>
                    )}
                    {typeof v.note === 'string' && v.note && <div className="mt-0.5 text-[12px] text-ink2">{v.note}</div>}
                    {r.reason && <div className="mt-0.5 text-[12px] text-ink2">{r.action === 'vendor_selected' ? 'Recorded reason: ' : ''}{r.reason}</div>}
                  </div>
                )
              })}
            </Panel>
          </Section>
        </div>
      </div>

      {dt && dialog && (
        <ReasonDialog open title={dt.title} body={dt.body} confirm={dt.confirm} danger={dt.danger} required={dt.required} onCancel={() => setDialog(null)} onConfirm={(r) => void confirm(r)} />
      )}

      <Modal open={linking} onClose={() => setLinking(false)} title="Link a vendor bill" subtitle={`${doc.doc_no} · ${partyName(doc.party_id)}`} width={640}
        footer={<>
          <button className="btn ghost" onClick={() => nav('/bills/new')}>Record a new bill</button>
          <button className="btn" onClick={() => setLinking(false)}>Close</button>
        </>}>
        <Note className="mb-4">Linking tells NUMERO which order a bill belongs to, so that the two can be compared with the receipts. Bill lines are matched to order lines by their position: line 1 to line 1. Linking does not approve the bill and does not change its amount.</Note>
        {d.unlinked.length === 0 ? (
          <Empty icon={<Link2 size={20} />} title="No bill to link" body={`No purchase bill from ${partyName(doc.party_id)} in ${companyName(doc.company_id)} is waiting to be linked to an order. Record the vendor's bill first, then link it here.`} />
        ) : (
          <div className="rounded-xl border border-line">
            {d.unlinked.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 text-[12.5px] last:border-0">
                <div className="min-w-0 flex-1">
                  <div><span className="num text-gold">{b.doc_no ?? 'Draft bill'}</span> <span className="text-muted">· {fmtDate(b.doc_date)}{b.reference ? ` · ${b.reference}` : ''}</span></div>
                  {b.narration && <div className="truncate text-ink2">{b.narration}</div>}
                  <div className="mt-0.5"><StatusChip status={b.status} label={b.status === 'draft' ? 'awaiting approval' : undefined} /></div>
                </div>
                <Money value={b.total} currency={b.currency} />
                <button className="btn sm primary" disabled={busy || !mayBill} title={mayBill ? undefined : NO_BILL}
                  onClick={() => void act(async () => { await api.linkBillToPo(b.id, id); return true }, `Bill linked to ${doc.doc_no}`).then((ok) => { if (ok) setLinking(false) })}>{busy ? <Spinner size={13} /> : <Link2 size={13} />} Link</button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ quotation comparison
type Compared = ReturnType<typeof compareQuotations>['quotes'][number]
interface AttributeRow { key: string; label: string; cell: (q: Compared) => ReactNode; text: (q: Compared) => string }

function Comparison({ quotes, currentId, baseCurrency }: { quotes: PurchaseDoc[]; currentId: ID; baseCurrency: string | undefined }) {
  const nav = useNavigate()
  const partyName = usePartyName()
  const cmp = useMemo(() => compareQuotations(quotes), [quotes])
  const sameCurrency = new Set(cmp.quotes.map((q) => q.quote.currency)).size <= 1
  const several = cmp.quotes.length > 1

  const rows: AttributeRow[] = [
    { key: 'no', label: 'Quotation', cell: (q) => <button className="link num text-[12.5px]" onClick={() => nav('/purchasing/' + q.quote.id)}>{q.quote.doc_no}</button>, text: (q) => q.quote.doc_no },
    { key: 'status', label: 'Status', cell: (q) => <StatusChip status={q.quote.status} />, text: (q) => humanise(q.quote.status) },
    {
      key: 'total', label: `Total${baseCurrency ? `, in ${baseCurrency}` : ''}`, text: (q) => q.total.toFixed(2),
      cell: (q) => <span className="inline-flex flex-wrap items-center justify-end gap-1.5"><Money value={q.total} currency={baseCurrency} className="text-ink" />{q.isLowest && several && <span className="chip cyan" title="Marked for information. The lowest quotation is never selected automatically.">lowest</span>}</span>,
    },
    { key: 'own', label: 'Total, as quoted', cell: (q) => <Money value={q.quote.total} currency={q.quote.currency} dim />, text: (q) => `${D(q.quote.total).toFixed(2)} ${q.quote.currency}` },
    { key: 'above', label: 'Difference from the lowest', cell: (q) => (q.aboveLowest.isZero() ? <span className="text-muted">—</span> : <Money value={q.aboveLowest} currency={baseCurrency} sign />), text: (q) => q.aboveLowest.toFixed(2) },
    { key: 'delivery', label: 'Delivery terms', cell: (q) => <span className="text-ink2">{q.quote.delivery_terms || '—'}</span>, text: (q) => q.quote.delivery_terms ?? '' },
    { key: 'payment', label: 'Payment terms', cell: (q) => <span className="text-ink2">{q.quote.payment_terms || '—'}</span>, text: (q) => q.quote.payment_terms ?? '' },
    { key: 'warranty', label: 'Warranty', cell: (q) => <span className="text-ink2">{q.quote.warranty || '—'}</span>, text: (q) => q.quote.warranty ?? '' },
    { key: 'valid', label: 'Valid until', cell: (q) => (q.quote.valid_until ? <span className="num text-[12.5px] text-ink2">{fmtDate(q.quote.valid_until)}{q.expired && <span className="chip warn ml-1.5">expired</span>}</span> : <span className="text-muted">—</span>), text: (q) => (q.quote.valid_until ? q.quote.valid_until + (q.expired ? ' (expired)' : '') : '') },
    ...cmp.items.map((item): AttributeRow => ({
      key: 'item:' + item.description, label: `Rate — ${(quotes.flatMap((q) => q.lines ?? []).find((l) => l.description.trim().toLowerCase() === item.description)?.description ?? item.description)}`,
      cell: (q) => {
        const c = item.cells.find((x) => x.quote_id === q.quote.id)
        if (!c?.rate) return <span className="text-muted">not quoted</span>
        return <span className="inline-flex flex-wrap items-center justify-end gap-1.5"><Money value={c.rate} currency={q.quote.currency} />{c.quantity && <span className="num text-[11px] text-muted">× {qty(c.quantity)}</span>}{sameCurrency && several && item.lowestRate && c.rate.eq(item.lowestRate) && <span className="chip cyan">lowest</span>}</span>
      },
      text: (q) => { const c = item.cells.find((x) => x.quote_id === q.quote.id); return c?.rate ? c.rate.toFixed(2) : '' },
    })),
  ]
  const columns: Column<AttributeRow>[] = [
    { key: 'attribute', header: '', render: (r) => <span className="text-[12.5px] text-muted">{r.label}</span>, csv: (r) => r.label },
    ...cmp.quotes.map((q): Column<AttributeRow> => ({
      key: q.quote.id, header: partyName(q.quote.party_id), align: 'right', className: q.quote.id === currentId ? 'bg-goldsoft' : undefined,
      render: (r) => r.cell(q), csv: (r) => r.text(q),
    })),
  ]

  return (
    <Section title="Quotation comparison" right={cmp.quotes.length > 0 ? <span className="text-[11.5px] text-muted">{cmp.quotes.length} quotation{cmp.quotes.length === 1 ? '' : 's'} side by side</span> : undefined}>
      <Panel lit={false}>
        {cmp.quotes.length === 0 ? (
          <Empty icon={<Scale size={20} />} title="No quotation has been received" body="Record each vendor's quotation against this request. They are set side by side here once they are marked as received." />
        ) : (
          <DataTable<AttributeRow> columns={columns} rows={rows} rowKey={(r) => r.key} exportName="quotation-comparison" pageSize={100} />
        )}
      </Panel>
      {cmp.quotes.length > 0 && <Note className="mt-3">{cmp.note} NUMERO does not choose: no quotation is selected automatically.{!sameCurrency ? ' The quotations are in different currencies: totals are compared at the exchange rate recorded on each quotation, and item rates are shown as quoted.' : ''}</Note>}
    </Section>
  )
}

// ------------------------------------------------------------------ three-way match
function ThreeWay({ order, receipts, bills }: { order: PurchaseDoc; receipts: PurchaseDoc[]; bills: Invoice[] }) {
  const nav = useNavigate()
  const m = useMemo(() => threeWayMatch(order, receipts, bills), [order, receipts, bills])
  const ccy = order.currency
  const columns: Column<MatchLine>[] = [
    { key: 'description', header: 'Order line', render: (l) => <span className="text-ink">{l.description}</span>, csv: (l) => l.description },
    { key: 'oq', header: 'Ordered', align: 'right', render: (l) => <span className="num">{qty(l.ordered_qty)}</span>, sort: (l) => l.ordered_qty.toNumber(), csv: (l) => qty(l.ordered_qty) },
    { key: 'or', header: 'Ordered rate', align: 'right', render: (l) => <Money value={l.ordered_rate} currency={ccy} />, sort: (l) => l.ordered_rate.toNumber(), csv: (l) => l.ordered_rate.toFixed(2) },
    { key: 'rq', header: 'Received', align: 'right', render: (l) => <span className="num">{qty(l.received_qty)}</span>, sort: (l) => l.received_qty.toNumber(), csv: (l) => qty(l.received_qty) },
    { key: 'bq', header: 'Billed', align: 'right', render: (l) => <span className="num">{qty(l.billed_qty)}</span>, sort: (l) => l.billed_qty.toNumber(), csv: (l) => qty(l.billed_qty) },
    { key: 'br', header: 'Billed rate', align: 'right', render: (l) => (l.billed_rate ? <Money value={l.billed_rate} currency={ccy} /> : <span className="text-muted">—</span>), sort: (l) => l.billed_rate?.toNumber() ?? 0, csv: (l) => l.billed_rate?.toFixed(2) ?? '' },
    { key: 'qd', header: 'Quantity difference', align: 'right', render: (l) => (l.billed_qty.isZero() || l.quantity_difference.isZero() ? <span className="text-muted">—</span> : <span className={cx('num', l.quantity_difference.gt(0) ? 'text-warn' : 'text-ink2')} title="Billed quantity − received quantity">{l.quantity_difference.gt(0) ? '+' : '−'}{qty(l.quantity_difference.abs())}</span>), sort: (l) => l.quantity_difference.toNumber(), csv: (l) => (l.billed_qty.isZero() ? '' : qty(l.quantity_difference)) },
    { key: 'pd', header: 'Price difference', align: 'right', render: (l) => (l.price_difference.isZero() ? <span className="text-muted">—</span> : <Money value={l.price_difference} currency={ccy} sign className="text-warn" />), sort: (l) => l.price_difference.toNumber(), csv: (l) => l.price_difference.toFixed(2) },
    { key: 'status', header: 'Status', render: (l) => <span className={cx('chip', MATCH_TONE[l.status])}>{l.status}</span>, sort: (l) => l.status, csv: (l) => l.status },
    { key: 'notes', header: 'What was found', render: (l) => <span className="text-[12px] text-ink2">{l.notes.join(' ') || '—'}</span>, csv: (l) => l.notes.join(' ') },
  ]
  return (
    <Section title="Three-way comparison: order, receipts, bills" right={<span className={cx('chip', OVERALL_TONE[m.status])}>{m.status}</span>}>
      <Panel className="mb-3 p-4" lit={false}>
        <div className="text-[13px] text-ink">{m.summary}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div><div className="eyebrow">Ordered, before tax</div><Money value={m.ordered} currency={ccy} className="mt-1 block text-[16px]" /></div>
          <div><div className="eyebrow">Received, at the ordered rates</div><Money value={m.received} currency={ccy} className="mt-1 block text-[16px]" /></div>
          <div><div className="eyebrow">Billed, before tax</div><Money value={m.billed} currency={ccy} className="mt-1 block text-[16px]" /></div>
        </div>
      </Panel>
      <Panel lit={false}>
        <DataTable<MatchLine> columns={columns} rows={m.lines} rowKey={(l) => l.po_line_id} exportName={`three-way-comparison-${order.doc_no}`}
          empty={{ title: 'This order has no lines to compare', icon: <Scale size={20} /> }} />
      </Panel>

      {m.unexpected.length > 0 && (
        <Panel className="mt-3 p-4" lit={false}>
          <div className="eyebrow mb-2">Charges on the bills that are not on the order</div>
          {m.unexpected.map((u, i) => (
            <button key={u.invoice_id + i} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface2" onClick={() => nav('/bills/' + u.invoice_id)}>
              <span className="min-w-0"><span className="num text-gold">{u.doc_no ?? 'Bill'}</span> <span className="text-ink2">· {u.description || 'No description'}</span></span>
              <Money value={u.amount} currency={ccy} />
            </button>
          ))}
          <div className="mt-1.5 text-[11.5px] text-muted">These bill lines are not tied to any line of the order. They may be freight, packing or another agreed charge; a person decides.</div>
        </Panel>
      )}

      <Panel className="mt-3 p-4 text-[12.5px]" lit={false}>
        <div className="eyebrow mb-2">Tax</div>
        <div className="flex justify-between py-0.5"><span className="text-ink2">Tax on the order</span><Money value={m.ordered_tax} currency={ccy} /></div>
        <div className="flex justify-between py-0.5"><span className="text-ink2">Tax on the bills</span><Money value={m.billed_tax} currency={ccy} /></div>
        <div className="flex justify-between py-0.5"><span className="text-ink2">Difference from the tax expected on the billed value</span>{m.tax_difference.isZero() ? <span className="text-muted">none</span> : <Money value={m.tax_difference} currency={ccy} sign className="text-warn" />}</div>
        <div className="mt-1.5 text-[11.5px] text-muted">The tax expected is the order's tax in proportion to the value billed so far.</div>
      </Panel>
      <Note className="mt-3">This is a factual comparison. It does not block the bill and it does not decide what a difference means. Differences up to 1.00 are treated as rounding. Only confirmed receipts and bills that are not drafts are counted.</Note>
    </Section>
  )
}

// ------------------------------------------------------------------ budget context
interface BudgetRow { account_id: ID; budget: Decimal; actual: Decimal; order: Decimal; remaining: Decimal }

function BudgetContext({ order, bills }: { order: PurchaseDoc; bills: Invoice[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const company = useApp((s) => s.companies.find((c) => c.id === order.company_id))
  const accountName = useAccountName()
  const start = company?.fy_start_month ?? 4
  const fy = fiscalYearOf(order.doc_date, start)
  const from = fyStart(order.doc_date, start)
  const end = fyEnd(order.doc_date, start)
  const upTo = end < today() ? end : today()
  const currency = company?.base_currency
  const approved = ['approved', 'partially_received', 'fully_received'].includes(order.status)

  const data = useAsync(async () => {
    const budgets = (await api.listBudgets([order.company_id])).filter((b) => b.fy === fy && b.status === 'approved')
    if (!budgets.length) return { budgets, lines: [], balances: [] }
    const [lines, balances] = await Promise.all([
      Promise.all(budgets.map((b) => api.getBudgetLines(b.id))).then((x) => x.flat()),
      upTo >= from ? api.ledgerBalances([order.company_id], from, upTo) : Promise.resolve([]),
    ])
    return { budgets, lines, balances }
  }, [api, order.id, order.company_id, fy, from, upTo])

  const rows: BudgetRow[] = useMemo(() => {
    if (!data.data) return []
    // the part of the order that has not been billed yet; what was billed is already in the actual figures
    const billed = sum(bills.filter((b) => !['draft', 'cancelled'].includes(b.status)).map((b) => b.subtotal))
    const subtotal = D(order.subtotal)
    const ratio = subtotal.isZero() ? ZERO : Decimal.max(subtotal.minus(billed), 0).div(subtotal)
    const ids = [...new Set((order.lines ?? []).map((l) => l.account_id).filter((x): x is ID => !!x))]
    return ids.filter((acc) => data.data!.lines.some((l) => l.account_id === acc)).map((acc) => {
      const budget = sum(data.data!.lines.filter((l) => l.account_id === acc).map((l) => l.amount))
      const actual = data.data!.balances.filter((b) => b.account_id === acc).reduce((s, b) => s.plus(b.period_debit).minus(b.period_credit), ZERO)
      const mine = round2(sum((order.lines ?? []).filter((l) => l.account_id === acc).map((l) => l.amount)).times(ratio).times(order.fx_rate))
      return { account_id: acc, budget, actual, order: mine, remaining: budget.minus(actual).minus(mine) }
    })
  }, [data.data, order, bills])

  const columns: Column<BudgetRow>[] = [
    { key: 'ledger', header: 'Ledger', render: (r) => <span className="text-ink">{accountName(r.account_id)}</span>, sort: (r) => accountName(r.account_id), csv: (r) => accountName(r.account_id) },
    { key: 'budget', header: `Budget, ${fyLabel(order.doc_date, start)}`, align: 'right', render: (r) => <Money value={r.budget} currency={currency} />, sort: (r) => r.budget.toNumber(), csv: (r) => r.budget.toFixed(2) },
    { key: 'actual', header: `Actual to ${fmtDate(upTo)}`, align: 'right', render: (r) => <Money value={r.actual} currency={currency} />, sort: (r) => r.actual.toNumber(), csv: (r) => r.actual.toFixed(2) },
    { key: 'order', header: 'This order, not yet billed', align: 'right', render: (r) => <Money value={r.order} currency={currency} />, sort: (r) => r.order.toNumber(), csv: (r) => r.order.toFixed(2) },
    { key: 'remaining', header: 'Budget left after this order', align: 'right', render: (r) => <Money value={r.remaining} currency={currency} className={cx('font-medium', r.remaining.lt(0) ? 'text-warn' : 'text-ink')} />, sort: (r) => r.remaining.toNumber(), csv: (r) => r.remaining.toFixed(2) },
  ]

  if (data.error) return <Section title="Budget context"><Note kind="warn">Budget figures could not be loaded for your account: {data.error}</Note></Section>
  if (!data.data) return null
  return (
    <Section title="Budget context" right={<Truth state="BUDGET" />}>
      {rows.length === 0 ? (
        <Panel className="p-4 text-[12.5px] text-muted" lit={false}>
          {data.data.budgets.length === 0 ? `No approved budget for ${fyLabel(order.doc_date, start)} exists for this company, so this order cannot be set against one.` : `The approved budget for ${fyLabel(order.doc_date, start)} has no line for the ledgers on this order.`}
        </Panel>
      ) : (
        <>
          <Panel lit={false}>
            <DataTable<BudgetRow> columns={columns} rows={rows} rowKey={(r) => r.account_id} exportName={`budget-context-${order.doc_no}`} onRow={() => nav('/budgets')} />
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">
            Budget is the full-year figure of the approved budget{data.data.budgets.length > 1 ? 's' : ''} ({data.data.budgets.map((b) => b.name).join(', ')}) for each ledger, across all departments. Actual is what has been posted to the ledger in the same year.
            {' '}This order is {approved ? 'COMMITTED' : 'not yet approved, so it is not yet a commitment'}; its unbilled part is shown in {currency ?? 'the base currency'}, before tax. Other open orders are not included in these figures. The comparison informs the decision; it does not block the order.
          </div>
        </>
      )}
    </Section>
  )
}
