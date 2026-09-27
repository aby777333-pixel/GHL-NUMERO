import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, ExternalLink, HandCoins, Link2, Plus, Unlink } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID, Invoice } from '@/engine/types'
import type { CollectionPromise } from '@/engine/opsTypes'
import { threeWayMatch } from '@/engine/ops'
import { D } from '@/lib/money'
import { daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, Field, Modal, Money, Note, Panel, ReasonDialog, Spinner, StatusChip } from './kit'

// =====================================================================
// Parts that attach Phase 2 records to the Phase 1 documents:
// promise-to-pay on a receivable, and the purchase order behind a bill.
// =====================================================================

const CHANNELS = ['Phone call', 'Email', 'Meeting', 'Message', 'Letter', 'Other']
const OUTCOME: Record<string, string> = { kept: 'Kept — paid as promised', partly_kept: 'Partly kept — part was paid', broken: 'Not kept — nothing was paid by the date', cancelled: 'Cancelled — recorded in error or withdrawn' }

/**
 * Promise-to-pay (spec 687): what a customer said they would pay, and when.
 * A promise is a statement by the customer. It is not cash and it changes nothing in the books.
 */
export function Promises({ companyId, partyId, invoice, className }: { companyId: ID; partyId: ID; invoice?: Pick<Invoice, 'id' | 'doc_no' | 'total' | 'amount_settled' | 'currency'>; className?: string }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const rows = useAsync(async () => (await api.listPromises({ companyIds: [companyId], partyId })).filter((p) => !invoice || p.invoice_id === invoice.id || p.invoice_id === null), [api, companyId, partyId, invoice?.id])
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState<CollectionPromise | null>(null)
  const [outcome, setOutcome] = useState<CollectionPromise['status']>('kept')
  const open = invoice ? D(invoice.total).minus(invoice.amount_settled) : null
  const [f, setF] = useState({ amount: '', date: '', contact: '', channel: CHANNELS[0], notes: '' })
  const may = can('invoice.create', companyId)
  const start = () => { setF({ amount: open ? String(open) : '', date: '', contact: '', channel: CHANNELS[0], notes: '' }); setAdding(true) }
  const problem = D(f.amount || 0).lte(0) ? 'Enter the amount promised.' : !f.date ? 'Enter the date promised.' : null

  const save = async () => {
    const r = await act(() => api.savePromise({ company_id: companyId, party_id: partyId, invoice_id: invoice?.id ?? null, promised_amount: f.amount, promised_date: f.date, contact_person: f.contact || undefined, channel: f.channel, notes: f.notes || undefined }), 'Promise recorded. The books are unchanged.')
    if (r) setAdding(false)
  }
  const close = async (note: string) => {
    if (!closing) return
    const c = closing
    setClosing(null)
    await act(() => api.savePromise({ id: c.id, company_id: c.company_id, status: outcome, outcome_note: note || undefined }), 'Outcome recorded')
  }

  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="eyebrow">Promises to pay</div>
        <button className="btn sm no-print" disabled={!may} title={may ? undefined : 'You need the "invoice.create" permission for this company'} onClick={start}><Plus size={13} /> Record a promise</button>
      </div>
      <Panel className="p-1.5" lit={false}>
        {!rows.data ? <div className="px-3 py-3 text-[12.5px] text-muted">{rows.error ?? 'Loading…'}</div>
          : !rows.data.length ? <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><HandCoins size={14} /> No promise has been recorded.</div>
          : rows.data.map((p) => {
            const late = p.status === 'open' && p.promised_date < today()
            return (
              <div key={p.id} className="flex items-start gap-3 rounded-lg px-2.5 py-2">
                <CalendarClock size={15} className={cx('mt-[2px] flex-none', late ? 'text-warn' : 'text-muted')} />
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <div className="text-ink"><Money value={p.promised_amount} /> by <span className="num">{fmtDate(p.promised_date)}</span>{late && <span className="text-warn"> · the date passed {daysBetween(p.promised_date, today())} day(s) ago</span>}</div>
                  <div className="text-muted">{[p.contact_person, p.channel, p.notes].filter(Boolean).join(' · ') || 'No detail recorded'}</div>
                  {p.outcome_note && <div className="text-ink2">Outcome: {p.outcome_note}</div>}
                </div>
                <StatusChip status={p.status} label={p.status === 'open' ? 'PROMISED' : p.status.replace(/_/g, ' ')} />
                {p.status === 'open' && may && <button className="btn sm ghost no-print" disabled={busy} onClick={() => { setOutcome(late ? 'broken' : 'kept'); setClosing(p) }}>Record outcome</button>}
              </div>
            )
          })}
      </Panel>
      <div className="mt-1.5 text-[11.5px] text-muted">A promise is what the customer said. It is shown in Forward as PROMISED, never as cash, and it changes nothing in the books.</div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Record a promise to pay" subtitle={invoice?.doc_no ? `Against ${invoice.doc_no}` : undefined} width={520}
        footer={<><button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <HandCoins size={15} />} Record</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount promised" hint={open ? `Outstanding on this invoice: ${open.toFixed(2)}` : undefined}><input className="field num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} autoFocus /></Field>
          <Field label="Date promised"><input type="date" className="field" value={f.date} min={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Who promised"><input className="field" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Name of the person" /></Field>
          <Field label="How"><select className="field" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {problem && f.amount !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
      </Modal>

      <ReasonDialog open={!!closing} title="What happened to this promise?" confirm="Record outcome" required={outcome !== 'kept'} onCancel={() => setClosing(null)} onConfirm={(n) => void close(n)}
        body="The outcome is kept with the promise. It does not record a receipt: money received is recorded under Payments and Receipts."
        extra={<Field label="Outcome" className="mb-3"><select className="field" value={outcome} onChange={(e) => setOutcome(e.target.value as CollectionPromise['status'])}>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>} />
    </section>
  )
}

/**
 * The purchase order behind a vendor's bill, with the three-way comparison
 * (ordered, received, billed). Factual: it never blocks a bill and never concludes.
 */
export function BillOrder({ bill, className }: { bill: Invoice; className?: string }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const { act, busy } = useAction()
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState('')
  const may = can('bill.create', bill.company_id)
  const mayView = can('purchase.view', bill.company_id)

  const data = useAsync(async () => {
    if (!mayView) return null
    const orders = (await api.listPurchaseDocs({ companyIds: [bill.company_id], kinds: ['purchase_order'] })).filter((o) => o.party_id === bill.party_id)
    if (!bill.po_id) return { orders, match: null, order: null }
    const order = await api.getPurchaseDoc(bill.po_id)
    const chain = await api.getPurchaseChain(bill.po_id)
    const receipts = await Promise.all(chain.filter((c) => (c.kind === 'goods_receipt' || c.kind === 'service_receipt') && c.parent_id === order.id && c.status === 'confirmed').map((c) => api.getPurchaseDoc(c.id)))
    const bills = await Promise.all((await api.listInvoices({ companyIds: [bill.company_id], docTypes: ['purchase_bill'] })).filter((b) => b.po_id === order.id && !['cancelled', 'rejected'].includes(b.status)).map((b) => api.getInvoice(b.id)))
    return { orders, order, match: threeWayMatch(order, receipts, bills) }
  }, [api, bill.id, bill.po_id, mayView])

  if (!mayView) return null
  const d = data.data
  const candidates = (d?.orders ?? []).filter((o) => ['approved', 'partially_received', 'fully_received', 'billed'].includes(o.status))
  if (!bill.po_id && !candidates.length) return null
  const tone = d?.match?.status === 'MATCHED' ? 'pos' : d?.match?.status === 'INCOMPLETE' ? 'cyan' : 'warn'

  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="eyebrow">Purchase order</div>
        {!bill.po_id && <button className="btn sm no-print" disabled={!may || busy} title={may ? undefined : 'You need the "bill.create" permission for this company'} onClick={() => { setChoice(candidates[0]?.id ?? ''); setPicking(true) }}><Link2 size={13} /> Link to an order</button>}
        {bill.po_id && <button className="btn sm ghost no-print" disabled={!may || busy} onClick={() => void act(() => api.linkBillToPo(bill.id, null), 'The bill is no longer linked to the order')}><Unlink size={13} /> Unlink</button>}
      </div>
      <Panel className="p-3.5 text-[12.5px]" lit={false}>
        {data.error ? <span className="text-warn">{data.error}</span>
          : !d ? <span className="text-muted">Loading…</span>
          : !d.order ? <span className="text-muted">This bill is not linked to a purchase order. {candidates.length} open order{candidates.length === 1 ? '' : 's'} exist{candidates.length === 1 ? 's' : ''} for this vendor.</span>
          : (
            <>
              <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => nav('/purchasing/' + d.order!.id)}>
                <span><span className="num text-gold">{d.order.doc_no}</span> <span className="text-ink2">· {d.order.title ?? 'Purchase order'}</span></span>
                <span className="flex items-center gap-2"><Money value={d.order.total} currency={d.order.currency} /><ExternalLink size={13} className="text-muted" /></span>
              </button>
              {d.match && (
                <div className="mt-2.5 border-t border-line pt-2.5">
                  <span className={cx('chip', tone)}>{d.match.status}</span>
                  <div className="mt-1.5 text-ink2">{d.match.summary}</div>
                  <div className="mt-1 text-[11.5px] text-muted">Ordered, received and billed are compared line by line on the order. The comparison is factual: it does not block this bill and does not decide what a difference means.</div>
                </div>
              )}
            </>
          )}
      </Panel>

      <Modal open={picking} onClose={() => setPicking(false)} title="Link this bill to a purchase order" width={520}
        footer={<><button className="btn ghost" onClick={() => setPicking(false)}>Cancel</button><button className="btn primary" disabled={!choice || busy} onClick={() => void act(() => api.linkBillToPo(bill.id, choice), 'Bill linked to the order').then((r) => { if (r !== undefined) setPicking(false) })}>{busy ? <Spinner /> : <Link2 size={15} />} Link</button></>}>
        <Note className="mb-4">Linking lets NUMERO compare what was ordered, what was received and what is billed. Bill lines are matched to order lines in order: the first line of the bill to the first line of the order, and so on. A bill line with no order line is shown as an unexpected charge.</Note>
        <Field label="Purchase order">
          <select className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {candidates.map((o) => <option key={o.id} value={o.id}>{o.doc_no} · {o.title ?? ''} · {fmtDate(o.doc_date)} · {D(o.total).toFixed(2)}</option>)}
          </select>
        </Field>
      </Modal>
    </section>
  )
}
