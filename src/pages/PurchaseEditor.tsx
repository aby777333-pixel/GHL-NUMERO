import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, Copy, Plus, Save, Send, Trash2 } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Confidentiality, ID } from '@/engine/types'
import type { PurchaseDoc, PurchaseDocInput, PurchaseKind, PurchaseLine, PurchaseLineInput } from '@/engine/opsTypes'
import { D, ZERO, round2, sum } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { usePartyName } from '@/ui/ops'

// =====================================================================
// Prepares a purchasing document of any kind. Whatever is saved here is
// a draft: it commits nobody and reaches no ledger. A purchase order
// becomes a commitment when it is approved; a cost arises only from the
// vendor's bill.
// =====================================================================

const KINDS: PurchaseKind[] = ['requisition', 'rfq', 'quotation', 'purchase_order', 'goods_receipt', 'service_receipt']
const isKind = (v: string | null): v is PurchaseKind => !!v && KINDS.includes(v as PurchaseKind)
const KIND_LABEL: Record<PurchaseKind, string> = {
  requisition: 'Purchase requisition', rfq: 'Request for quotation', quotation: 'Vendor quotation', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt', service_receipt: 'Service receipt',
}
const PARENT_LABEL: Record<PurchaseKind, string | null> = {
  requisition: null, rfq: 'Requisition', quotation: 'Request for quotation', purchase_order: 'Requisition or selected quotation', goods_receipt: 'Purchase order', service_receipt: 'Purchase order',
}
const SUBMIT_TEXT: Record<PurchaseKind, string> = {
  requisition: 'Submitting sends the requisition for approval. Nothing is ordered until a second person approves it.',
  rfq: 'Submitting marks the request as sent to vendors. Record each reply as a vendor quotation.',
  quotation: 'Submitting marks the quotation as received, so that it can be compared with the others. A person then selects the vendor and records why.',
  purchase_order: 'Submitting sends the order for approval. Once approved it is a commitment to the vendor — not a cost. The cost arises when the vendor\'s bill is approved.',
  goods_receipt: 'Submitting confirms the receipt and updates the received status of the order. No accounting entry is made.',
  service_receipt: 'Submitting confirms the receipt and updates the received status of the order. No accounting entry is made.',
}
const SUBMITTED_TOAST: Record<PurchaseKind, string> = {
  requisition: 'Requisition submitted for approval', rfq: 'Request for quotation marked as sent', quotation: 'Quotation marked as received',
  purchase_order: 'Purchase order submitted for approval', goods_receipt: 'Receipt confirmed', service_receipt: 'Receipt confirmed',
}
const CONFIDENTIALITY: { key: Confidentiality; label: string }[] = [
  { key: 'internal', label: 'Internal' }, { key: 'confidential', label: 'Confidential' }, { key: 'highly_confidential', label: 'Highly confidential' },
  { key: 'restricted', label: 'Restricted' }, { key: 'super_admin_only', label: 'Super administrator only' },
]
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'SAR', 'CNY']
const NO_CREATE = 'Your role does not include the permission to prepare purchasing documents (purchase.create).'
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const plain = (v: Decimal.Value | null | undefined) => (v === null || v === undefined || v === '' ? '' : D(v).toString())
const qty = (v: Decimal.Value) => D(v).toDecimalPlaces(3).toString()

interface Row { key: number; description: string; account_id: ID | ''; quantity: string; unit: string; rate: string; tax_code_id: ID | ''; project: ID | ''; dims: Record<string, ID> }
let k = 0
const blank = (): Row => ({ key: ++k, description: '', account_id: '', quantity: '1', unit: '', rate: '', tax_code_id: '', project: '', dims: {} })
const toRow = (l: PurchaseLine, keepRate: boolean): Row => {
  const { project, ...rest } = l.dims ?? {}
  return { key: ++k, description: l.description, account_id: l.account_id ?? '', quantity: plain(l.quantity) || '1', unit: l.unit ?? '', rate: keepRate && !D(l.rate).isZero() ? plain(l.rate) : '', tax_code_id: l.tax_code_id ?? '', project: project ?? '', dims: rest }
}

export default function PurchaseEditor() {
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  // a fresh form for every document: nothing typed for one may leak into another
  return <Editor key={`${id ?? 'new'}|${sp.get('kind') ?? ''}|${sp.get('parent') ?? ''}`} />
}

function Editor() {
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  useApp((s) => s.session)
  const partyName = usePartyName()
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const paramKind = sp.get('kind')
  const paramParent = id ? null : sp.get('parent')

  const [kind, setKind] = useState<PurchaseKind>(isKind(paramKind) ? paramKind : 'requisition')
  const [companyId, setCompanyId] = useState<ID>(ids[0] ?? '')
  const [date, setDate] = useState(today())
  const [title, setTitle] = useState('')
  const [partyId, setPartyId] = useState<ID>('')
  const [parentId, setParentId] = useState<ID>(paramParent ?? '')
  const [reason, setReason] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [delivery, setDelivery] = useState('')
  const [payment, setPayment] = useState('')
  const [warranty, setWarranty] = useState('')
  const [currency, setCurrency] = useState(() => companies.find((c) => c.id === ids[0])?.base_currency ?? 'INR')
  const [fx, setFx] = useState('1')
  const [dims, setDims] = useState<Record<string, ID>>({})
  const [confidentiality, setConfidentiality] = useState<Confidentiality>('internal')
  const [meta, setMeta] = useState<Record<string, unknown>>({})
  const [rows, setRows] = useState<Row[]>([blank()])
  /** receipts: what the person typed against each line of the order */
  const [recv, setRecv] = useState<Record<ID, { now?: string; condition?: string }>>({})
  /** when an existing receipt is edited, a line it did not carry stays at zero */
  const [zeroByDefault, setZeroByDefault] = useState(false)
  const [copyFrom, setCopyFrom] = useState<ID | null>(paramParent)
  const loaded = useRef(false)

  const receipt = kind === 'goods_receipt' || kind === 'service_receipt'
  const existing = useAsync<PurchaseDoc | null>(async () => (id ? api.getPurchaseDoc(id) : null), [api, id])
  const taxes = useAsync(() => api.listTaxCodes(companyId ? [companyId] : []), [api, companyId])
  const candidates = useAsync<PurchaseDoc[]>(async () => (companyId && kind !== 'requisition' ? api.listPurchaseDocs({ companyIds: [companyId] }) : []), [api, companyId, kind])
  const parent = useAsync<{ doc: PurchaseDoc; chain: PurchaseDoc[] } | null>(async () => {
    if (!parentId) return null
    const doc = await api.getPurchaseDoc(parentId)
    return { doc, chain: receipt ? await api.getPurchaseChain(parentId) : [] }
  }, [api, parentId, receipt])

  // ------------------------------------------------------------ load an existing draft
  useEffect(() => {
    const d = existing.data
    if (!d || loaded.current) return
    loaded.current = true
    const isReceipt = d.kind === 'goods_receipt' || d.kind === 'service_receipt'
    setKind(d.kind); setCompanyId(d.company_id); setDate(d.doc_date); setTitle(d.title ?? ''); setPartyId(d.party_id ?? ''); setParentId(d.parent_id ?? ''); setReason(d.reason ?? '')
    setRequiredDate(d.required_date ?? ''); setValidUntil(d.valid_until ?? ''); setDelivery(d.delivery_terms ?? ''); setPayment(d.payment_terms ?? ''); setWarranty(d.warranty ?? '')
    setCurrency(d.currency); setFx(plain(d.fx_rate) || '1'); setDims(d.dims ?? {}); setConfidentiality(d.confidentiality); setMeta(d.meta ?? {})
    if (isReceipt) {
      setZeroByDefault(true)
      setRecv(Object.fromEntries((d.lines ?? []).filter((l) => l.source_line_id).map((l) => [l.source_line_id as ID, { now: plain(l.quantity), condition: l.condition ?? '' }])))
    } else setRows((d.lines ?? []).length ? (d.lines ?? []).map((l) => toRow(l, true)) : [blank()])
  }, [existing.data])

  // ------------------------------------------------------------ copy from the linked document
  const applyParent = (p: PurchaseDoc) => {
    setCompanyId(p.company_id)
    setTitle(p.title ?? '')
    if (p.party_id) setPartyId(p.party_id)
    setDims(p.dims ?? {})
    setCurrency(p.currency); setFx(plain(p.fx_rate) || '1')
    setConfidentiality(p.confidentiality)
    if (p.required_date && (kind === 'purchase_order' || kind === 'requisition')) setRequiredDate(p.required_date)
    if (kind === 'purchase_order' && p.kind === 'quotation') { setDelivery(p.delivery_terms ?? ''); setPayment(p.payment_terms ?? ''); setWarranty(p.warranty ?? '') }
    if (!(kind === 'goods_receipt' || kind === 'service_receipt')) {
      // a request for quotation carries no price: the requisition's estimate is not shown to vendors
      const lines = (p.lines ?? []).map((l) => toRow(l, kind !== 'rfq'))
      setRows(lines.length ? lines : [blank()])
    }
  }
  useEffect(() => {
    const p = parent.data?.doc
    if (!p || id || copyFrom !== p.id) return
    setCopyFrom(null)
    applyParent(p)
  }, [parent.data, copyFrom]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ choices
  const company = companies.find((c) => c.id === companyId)
  const baseCurrency = company?.base_currency
  const companyOptions = companies.filter((c) => (c.status === 'active' && ids.includes(c.id)) || c.id === companyId)
  const accs = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active && (a.type === 'expense' || a.type === 'asset') && !a.control_type).sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId])
  const vendors = useMemo(() => parties.filter((p) => (p.roles.some((r) => r.company_id === companyId) && p.status !== 'terminated') || p.id === partyId).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, companyId, partyId])
  const vendor = parties.find((p) => p.id === partyId)
  const unitsOf = (type: string, keep?: ID) => orgUnits.filter((u) => u.company_id === companyId && u.type_key === type && (u.status === 'active' || u.id === keep)).sort((a, b) => a.name.localeCompare(b.name))
  const departments = unitsOf('department', dims.department)
  const projects = unitsOf('project', dims.project)
  const lineProjects = orgUnits.filter((u) => u.company_id === companyId && u.type_key === 'project' && (u.status === 'active' || rows.some((r) => r.project === u.id)))

  const parentOptions = useMemo(() => {
    const ok = (d: PurchaseDoc) => (
      kind === 'rfq' ? d.kind === 'requisition' && ['approved', 'ordered'].includes(d.status)
        : kind === 'quotation' ? d.kind === 'rfq' && d.status === 'sent'
        : kind === 'purchase_order' ? (d.kind === 'requisition' && ['approved', 'ordered'].includes(d.status)) || (d.kind === 'quotation' && d.status === 'selected')
        : kind === 'goods_receipt' || kind === 'service_receipt' ? d.kind === 'purchase_order' && ['approved', 'partially_received'].includes(d.status)
        : false)
    const list = (candidates.data ?? []).filter((d) => d.company_id === companyId && d.id !== id && (ok(d) || d.id === parentId))
    const linked = parent.data?.doc
    if (linked && linked.id === parentId && !list.some((d) => d.id === linked.id)) list.unshift(linked)
    return list
  }, [candidates.data, parent.data, kind, id, parentId, companyId])

  const showVendor = !receipt
  const vendorRequired = kind === 'quotation' || kind === 'purchase_order'
  const showRequired = kind === 'requisition' || kind === 'purchase_order'
  const showValid = kind === 'rfq' || kind === 'quotation'
  const showTerms = kind === 'quotation' || kind === 'purchase_order'
  const order = receipt && parent.data?.doc.id === parentId ? parent.data.doc : undefined
  const docCurrency = receipt ? order?.currency ?? currency : currency

  // ------------------------------------------------------------ figures
  const taxCodes = (taxes.data ?? []).filter((t) => t.company_id === companyId)
  const taxOf = (amount: Decimal, codeId: ID | '' | null) => {
    const code = taxCodes.find((t) => t.id === codeId)
    const comps = (code?.components ?? []).filter((c) => (c.effective_from ?? '2000-01-01') <= date && (!c.effective_to || c.effective_to >= date))
    const parts = comps.map((c) => ({ name: c.component, rate: D(c.rate), tax: round2(amount.times(c.rate).div(100)) }))
    return { parts, tax: sum(parts.map((p) => p.tax)) }
  }
  const calc = rows.map((r) => { const amount = round2(D(r.quantity || 0).times(D(r.rate || 0))); return { amount, ...taxOf(amount, r.tax_code_id) } })

  const receiptLines = useMemo(() => {
    if (!order || !parent.data) return []
    const confirmed = parent.data.chain.filter((r) => r.parent_id === order.id && (r.kind === 'goods_receipt' || r.kind === 'service_receipt') && r.status === 'confirmed' && r.id !== id)
    const done = confirmed.flatMap((r) => r.lines ?? [])
    return (order.lines ?? []).map((line) => {
      const received = sum(done.filter((x) => x.source_line_id === line.id).map((x) => x.quantity))
      return { line, ordered: D(line.quantity), received, remaining: Decimal.max(D(line.quantity).minus(received), 0) }
    })
  }, [order, parent.data, id])
  const nowOf = (l: { line: PurchaseLine; remaining: Decimal }) => recv[l.line.id]?.now ?? (zeroByDefault ? '0' : l.remaining.toString())
  const receiptCalc = receiptLines.map((l) => { const now = D(nowOf(l) || 0); const amount = round2(now.times(l.line.rate)); return { now, amount, ...taxOf(amount, l.line.tax_code_id) } })

  const figures = receipt ? receiptCalc : calc
  const subtotal = sum(figures.map((c) => c.amount)), taxTotal = sum(figures.map((c) => c.tax)), total = subtotal.plus(taxTotal)
  const byComp = new Map<string, Decimal>()
  figures.forEach((c) => c.parts.forEach((p) => byComp.set(`${p.name} ${p.rate}%`, (byComp.get(`${p.name} ${p.rate}%`) ?? ZERO).plus(p.tax))))
  const docFx = receipt ? D(order?.fx_rate ?? 1) : docCurrency === baseCurrency ? D(1) : D(fx)

  // ------------------------------------------------------------ checks
  const problems: string[] = []
  if (!companyId) problems.push('Choose a company.')
  if (!date) problems.push('Enter the document date.')
  if (vendorRequired && !partyId) problems.push('Choose the vendor.')
  if (kind === 'purchase_order' && vendor && ['blocked', 'suspended', 'terminated'].includes(vendor.status)) problems.push(`${vendor.display_name} is ${vendor.status}. New orders are not permitted.`)
  if (kind === 'requisition' && !reason.trim()) problems.push('Record the reason for the purchase.')
  if (receipt && !parentId) problems.push('Choose the purchase order this receipt belongs to.')
  if (!receipt && docCurrency !== baseCurrency && D(fx).lte(0)) problems.push('Enter the exchange rate.')
  if (receipt) {
    if (parentId && !order) problems.push('The purchase order has not been loaded yet.')
    if (order && receiptCalc.every((c) => c.now.lte(0))) problems.push('Enter the quantity received on at least one line.')
    receiptLines.forEach((l, i) => { if (receiptCalc[i].now.gt(l.remaining)) problems.push(`Line ${i + 1}: ${qty(receiptCalc[i].now)} is more than the ${qty(l.remaining)} still to be received.`) })
  } else {
    rows.forEach((r, i) => {
      if (!r.description.trim()) problems.push(`Line ${i + 1}: describe what is being bought.`)
      if (D(r.quantity || 0).lte(0)) problems.push(`Line ${i + 1}: enter the quantity.`)
      if (vendorRequired && D(r.rate || 0).lte(0)) problems.push(`Line ${i + 1}: enter the rate.`)
      if (kind === 'purchase_order' && !r.account_id) problems.push(`Line ${i + 1}: choose the ledger the cost will be charged to.`)
    })
  }

  const allowed = !!companyId && can('purchase.create', companyId)
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setDim = (type: string, value: ID) => setDims((x) => { const n = { ...x }; if (value) n[type] = value; else delete n[type]; return n })
  const changeCompany = (cid: ID) => {
    setCompanyId(cid); setPartyId(''); setParentId(''); setDims({}); setRows([blank()]); setRecv({})
    setCurrency(companies.find((c) => c.id === cid)?.base_currency ?? 'INR'); setFx('1')
  }
  const changeKind = (next: PurchaseKind) => { setKind(next); setParentId(''); setRecv({}) }

  const payload = (): PurchaseDocInput => {
    const lines: PurchaseLineInput[] = receipt
      ? receiptLines.map((l, i) => ({ l, now: receiptCalc[i].now })).filter((x) => x.now.gt(0)).map(({ l, now }) => ({
        description: l.line.description, quantity: now.toString(), unit: l.line.unit, source_line_id: l.line.id, condition: recv[l.line.id]?.condition?.trim() || null,
      }))
      : rows.map((r) => ({
        description: r.description.trim(), account_id: r.account_id || null, quantity: r.quantity || 1, unit: r.unit.trim() || null, rate: r.rate || 0, tax_code_id: r.tax_code_id || null,
        dims: { ...r.dims, ...(r.project ? { project: r.project } : {}) },
      }))
    return {
      id, company_id: companyId, kind, doc_date: date, party_id: receipt ? order?.party_id ?? null : partyId || null, parent_id: parentId || null, title: title.trim() || null,
      currency: docCurrency, fx_rate: receipt ? order?.fx_rate ?? 1 : docCurrency === baseCurrency ? 1 : fx,
      required_date: showRequired ? requiredDate || null : null, valid_until: showValid ? validUntil || null : null,
      delivery_terms: showTerms ? delivery.trim() || null : null, payment_terms: showTerms ? payment.trim() || null : null, warranty: showTerms ? warranty.trim() || null : null,
      reason: reason.trim() || null, dims: receipt ? order?.dims ?? {} : dims, meta, confidentiality, lines,
    }
  }
  const save = async (submit: boolean) => {
    const did = await act(() => api.savePurchaseDoc(payload()), submit ? undefined : 'Draft saved')
    if (!did) return
    // the draft now exists; if submitting is refused the person continues from the document itself
    if (submit) await act(() => api.submitPurchaseDoc(did), SUBMITTED_TOAST[kind])
    nav('/purchasing/' + did, { replace: true })
  }

  // ------------------------------------------------------------ render
  if (id && existing.error) return <ErrorBox message={existing.error} retry={existing.reload} />
  if (id && !existing.data) return <Panel><Loading rows={7} label="Loading the document" /></Panel>
  const d = existing.data ?? null
  if (d && !['draft', 'rejected'].includes(d.status)) {
    return (
      <div>
        <PageHeader eyebrow={`Purchase to pay · ${KIND_LABEL[d.kind]}`} title={d.doc_no} actions={<button className="btn" onClick={() => nav('/purchasing/' + d.id)}><ArrowLeft size={15} /> Open the document</button>} />
        <Note kind="warn">Only drafts can be edited. This document is {d.status === 'submitted' ? 'awaiting approval' : d.status.replace(/_/g, ' ')}. To change it, cancel it with a reason and prepare a new one.</Note>
      </div>
    )
  }
  const linked = parent.data?.doc.id === parentId ? parent.data.doc : undefined
  const showProblems = problems.length > 0 && (receipt ? !!order : rows.some((r) => r.description || r.rate))

  return (
    <div>
      <PageHeader eyebrow={`Purchase to pay · ${KIND_LABEL[kind]}`} title={d ? `Edit ${d.doc_no}` : `New ${KIND_LABEL[kind].toLowerCase()}`}
        subtitle="Saved as a draft. A purchasing document never writes to the ledger."
        actions={<>
          <button className="btn ghost" onClick={() => nav(d ? '/purchasing/' + d.id : '/purchasing')}><ArrowLeft size={15} /> Back</button>
          <button className="btn" disabled={busy || problems.length > 0 || !allowed} title={allowed ? undefined : NO_CREATE} onClick={() => void save(false)}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>
          <button className="btn primary" disabled={busy || problems.length > 0 || !allowed} title={allowed ? SUBMIT_TEXT[kind] : NO_CREATE} onClick={() => void save(true)}>{busy ? <Spinner /> : <Send size={15} />} Save and submit</button>
        </>} />

      {d && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusChip status={d.status} />
          {d.status === 'rejected' && d.decision_note && <span className="text-[12.5px] text-ink2">Rejected: {d.decision_note}</span>}
        </div>
      )}
      {d?.status === 'rejected' && <Note className="mb-4">Saving a rejected document returns it to draft, so that it can be corrected and submitted again.</Note>}
      <Note className="mb-4">{SUBMIT_TEXT[kind]}</Note>
      {parent.error && <Note kind="warn" className="mb-4">The linked document could not be loaded: {parent.error}</Note>}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Document">
                <select className="field" value={kind} disabled={Boolean(id) || Boolean(paramParent)} onChange={(e) => changeKind(e.target.value as PurchaseKind)}>
                  {KINDS.map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
                </select>
              </Field>
              <Field label="Company">
                <select className="field" value={companyId} disabled={Boolean(id) || Boolean(paramParent)} onChange={(e) => changeCompany(e.target.value)}>
                  <option value="">Choose…</option>{companyOptions.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></Field>

              {PARENT_LABEL[kind] && (
                <Field label={`${PARENT_LABEL[kind]}${receipt ? '' : ' (optional)'}`} className="md:col-span-2"
                  hint={parentOptions.length === 0 ? (receipt ? 'This company has no approved purchase order that is still open.' : kind === 'quotation' ? 'This company has no request for quotation open with vendors.' : kind === 'rfq' ? 'This company has no approved requisition.' : 'This company has no approved requisition or selected quotation.') : undefined}>
                  <select className="field" value={parentId} disabled={Boolean(paramParent)} onChange={(e) => { setParentId(e.target.value); setRecv({}); setZeroByDefault(false) }}>
                    <option value="">{receipt ? 'Choose…' : 'Not linked'}</option>
                    {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.doc_no} · {KIND_LABEL[p.kind]}{p.title ? ` · ${p.title}` : ''}{p.party_id ? ` · ${partyName(p.party_id)}` : ''}</option>)}
                  </select>
                </Field>
              )}
              {!receipt && !id && !paramParent && linked && (
                <div className="flex items-end">
                  <button className="btn" title="Replaces the title, vendor, dimensions and lines below with those of the linked document" onClick={() => applyParent(linked)}><Copy size={14} /> Copy from {linked.doc_no}</button>
                </div>
              )}

              <Field label="Title" className="md:col-span-2 xl:col-span-3"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={receipt ? 'For example: first lot received at site' : 'What is being bought'} /></Field>

              {showVendor && (
                <Field label={vendorRequired ? 'Vendor' : 'Vendor (optional)'} className="md:col-span-2"
                  hint={kind === 'rfq' ? 'A request usually goes to several vendors. Record each reply as a vendor quotation.' : kind === 'requisition' ? 'A suggested vendor, if there is one. The vendor is chosen later.' : vendor?.gstin ? `GSTIN ${vendor.gstin}` : undefined}>
                  <select className="field" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                    <option value="">{vendorRequired ? 'Choose…' : 'Not recorded'}</option>
                    {vendors.map((p) => <option key={p.id} value={p.id} disabled={kind === 'purchase_order' && ['blocked', 'suspended'].includes(p.status)}>{p.display_name} · {p.party_no}{p.status !== 'active' ? ` (${p.status})` : ''}</option>)}
                  </select>
                </Field>
              )}
              {receipt && <Field label="Vendor" className="md:col-span-2"><div className="field flex items-center text-ink2">{order ? partyName(order.party_id) : 'Taken from the purchase order'}</div></Field>}

              {showRequired && <Field label="Required by"><input type="date" className="field" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></Field>}
              {showValid && <Field label={kind === 'rfq' ? 'Reply by' : 'Valid until'} hint={kind === 'quotation' ? 'An expired quotation cannot be selected.' : undefined}><input type="date" className="field" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>}

              {!receipt && (
                <Field label="Currency">
                  <select className="field" value={currency} onChange={(e) => { setCurrency(e.target.value); if (e.target.value === baseCurrency) setFx('1') }}>
                    {[...new Set([...CURRENCIES, currency])].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              )}
              {!receipt && currency !== baseCurrency && (
                <Field label={`Exchange rate (1 ${currency} = ? ${baseCurrency ?? ''})`} hint="Entered by you and stored with the document.">
                  <input className="field num" inputMode="decimal" value={fx} onChange={(e) => setFx(digits(e.target.value))} />
                </Field>
              )}

              {!receipt && (departments.length > 0 || dims.department) && (
                <Field label="Department">
                  <select className="field" value={dims.department ?? ''} onChange={(e) => setDim('department', e.target.value)}>
                    <option value="">—</option>{departments.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                  </select>
                </Field>
              )}
              {!receipt && (projects.length > 0 || dims.project) && (
                <Field label="Project">
                  <select className="field" value={dims.project ?? ''} onChange={(e) => setDim('project', e.target.value)}>
                    <option value="">—</option>{projects.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Confidentiality">
                <select className="field" value={confidentiality} onChange={(e) => setConfidentiality(e.target.value as Confidentiality)}>
                  {CONFIDENTIALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>

              <Field label={kind === 'requisition' ? 'Reason for the purchase (required)' : receipt ? 'Remarks' : 'Reason or remarks'} className="md:col-span-2 xl:col-span-3">
                <textarea className="field" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'requisition' ? 'Why is this needed, and why now?' : undefined} />
              </Field>

              {showTerms && <>
                <Field label="Delivery terms"><input className="field" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="For example: delivered to site within 5 days" /></Field>
                <Field label="Payment terms"><input className="field" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="For example: 30 days credit" /></Field>
                <Field label="Warranty"><input className="field" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
              </>}
            </div>
          </Panel>

          {receipt ? (
            <Panel lit={false} className="overflow-hidden">
              {!parentId ? <div className="px-5 py-8 text-center text-[13px] text-muted">Choose the purchase order. Its lines appear here with what has already been received.</div>
                : parent.loading && !order ? <Loading rows={3} label="Loading the purchase order" />
                : !order ? <div className="px-5 py-8 text-center text-[13px] text-muted">The purchase order could not be loaded.</div>
                : (
                  <div className="overflow-auto">
                    <table className="table dense" style={{ minWidth: 940 }}>
                      <thead><tr><th style={{ width: 36 }}>#</th><th style={{ minWidth: 220 }}>Description</th><th className="r" style={{ width: 96 }}>Ordered</th><th className="r" style={{ width: 120 }}>Already received</th><th className="r" style={{ width: 100 }}>Remaining</th><th className="r" style={{ width: 120 }}>Received now</th><th style={{ width: 70 }}>Unit</th><th style={{ minWidth: 200 }}>Condition</th><th className="r" style={{ width: 130 }}>Value at the ordered rate</th></tr></thead>
                      <tbody>
                        {receiptLines.map((l, i) => (
                          <tr key={l.line.id}>
                            <td className="num text-muted">{i + 1}</td>
                            <td className="text-ink">{l.line.description}</td>
                            <td className="r num">{qty(l.ordered)}</td>
                            <td className="r num text-ink2">{qty(l.received)}</td>
                            <td className="r num">{qty(l.remaining)}</td>
                            <td><input className="field sm num text-right" inputMode="decimal" value={nowOf(l)} disabled={l.remaining.lte(0)} onChange={(e) => setRecv((x) => ({ ...x, [l.line.id]: { ...x[l.line.id], now: digits(e.target.value) } }))} aria-label={`Line ${i + 1} quantity received now`} /></td>
                            <td className="text-ink2">{l.line.unit ?? '—'}</td>
                            <td><input className="field sm" value={recv[l.line.id]?.condition ?? ''} disabled={l.remaining.lte(0)} onChange={(e) => setRecv((x) => ({ ...x, [l.line.id]: { ...x[l.line.id], condition: e.target.value } }))} placeholder="Condition on arrival" aria-label={`Line ${i + 1} condition`} /></td>
                            <td className="r"><Money value={receiptCalc[i].amount} currency={docCurrency} dim /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              {order && <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">Lines with nothing received now are left out of the receipt. The rate is taken from the order. Already received counts confirmed receipts only.</div>}
            </Panel>
          ) : (
            <Panel lit={false} className="overflow-hidden">
              <div className="overflow-auto">
                <table className="table dense" style={{ minWidth: 1040 }}>
                  <thead><tr>
                    <th style={{ width: 36 }}>#</th><th style={{ minWidth: 220 }}>Description</th><th style={{ minWidth: 200 }}>Ledger to be charged{kind === 'purchase_order' ? '' : ' (optional)'}</th>
                    {lineProjects.length > 0 && <th style={{ minWidth: 140 }}>Project</th>}
                    <th className="r" style={{ width: 84 }}>Qty</th><th style={{ width: 84 }}>Unit</th><th className="r" style={{ width: 130 }}>{vendorRequired ? 'Rate' : kind === 'rfq' ? 'Rate (optional)' : 'Estimated rate'}</th>
                    <th style={{ width: 150 }}>Tax</th><th className="r" style={{ width: 130 }}>Amount</th><th className="r" style={{ width: 110 }}>Tax</th><th style={{ width: 40 }} />
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.key}>
                        <td className="num text-muted">{i + 1}</td>
                        <td><input className="field sm" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></td>
                        <td><select className="field sm" value={r.account_id} onChange={(e) => set(r.key, { account_id: e.target.value })} aria-label={`Line ${i + 1} ledger`}><option value="">Choose…</option>{accs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td>
                        {lineProjects.length > 0 && <td><select className="field sm" value={r.project} onChange={(e) => set(r.key, { project: e.target.value })} aria-label={`Line ${i + 1} project`}><option value="">—</option>{lineProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>}
                        <td><input className="field sm num text-right" inputMode="decimal" value={r.quantity} onChange={(e) => set(r.key, { quantity: digits(e.target.value) })} aria-label={`Line ${i + 1} quantity`} /></td>
                        <td><input className="field sm" value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`} /></td>
                        <td><input className="field sm num text-right" inputMode="decimal" value={r.rate} onChange={(e) => set(r.key, { rate: digits(e.target.value) })} aria-label={`Line ${i + 1} rate`} /></td>
                        <td><select className="field sm" value={r.tax_code_id} onChange={(e) => set(r.key, { tax_code_id: e.target.value })} aria-label={`Line ${i + 1} tax code`}><option value="">No tax</option>{taxCodes.filter((t) => t.is_active || t.id === r.tax_code_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                        <td className="r"><Money value={calc[i].amount} currency={docCurrency} /></td>
                        <td className="r"><Money value={calc[i].tax} currency={docCurrency} dim /></td>
                        <td><button className="btn ghost icon sm" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove line"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line px-3.5 py-2.5"><button className="btn sm" onClick={() => setRows((rs) => [...rs, blank()])}><Plus size={13} /> Add line</button></div>
            </Panel>
          )}
          {showProblems && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="eyebrow mb-3">{receipt ? 'Value of this receipt' : 'Totals'}</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink2">Value before tax</span><Money value={subtotal} currency={docCurrency} /></div>
              {[...byComp.entries()].map(([n, v]) => <div key={n} className="flex justify-between"><span className="text-ink2">{n}</span><Money value={v} currency={docCurrency} /></div>)}
              <div className="hairline my-2" />
              <div className="flex items-baseline justify-between"><span className="font-medium">Total</span><Money value={total} currency={docCurrency} className="display text-[22px] text-gold" /></div>
              {docCurrency !== baseCurrency && baseCurrency && <div className="flex justify-between text-[12px] text-muted"><span>In {baseCurrency} at {docFx.toString()}</span><Money value={round2(total.times(docFx))} currency={baseCurrency} /></div>}
            </div>
            <div className="mt-3 text-[11.5px] leading-relaxed text-muted">A preview, using the tax codes in force on {fmtDate(date)}. The figures are recalculated when the document is saved.</div>
          </Panel>

          <Section title="What this document does">
            <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
              <p className="m-0">{SUBMIT_TEXT[kind]}</p>
              <p className="mb-0 mt-2 text-muted">No purchasing document writes to the ledger. {kind === 'purchase_order' ? 'An approved order is shown as COMMITTED until the vendor\'s bill is approved.' : receipt ? 'The receipt is compared with the order and the vendor\'s bill in the three-way comparison.' : 'The cost arises only when the vendor\'s bill is approved.'}</p>
            </Panel>
          </Section>

          {linked && (
            <Section title="Linked to">
              <Panel className="p-4" lit={false}>
                <div className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0"><span className="num text-gold">{linked.doc_no}</span> <span className="text-muted">· {KIND_LABEL[linked.kind]} · {fmtDate(linked.doc_date)}</span>{linked.title && <span className="block truncate text-ink2">{linked.title}</span>}</span>
                  <span className="flex flex-none items-center gap-2"><StatusChip status={linked.status} /><Money value={linked.total} currency={linked.currency} /></span>
                </div>
                <div className="mt-2 text-[11.5px] text-muted">The link is kept when this document is saved, so that the whole chain can be followed from either end.</div>
              </Panel>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
