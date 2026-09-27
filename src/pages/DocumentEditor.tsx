import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Banknote, Plus, Printer, Save, Trash2 } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { DocType, ID, InvoiceInput } from '@/engine/types'
import { D, fmtMoney, round2, sum, ZERO } from '@/lib/money'
import { addDays, daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, CustomFields } from '@/ui/ops'
import { BillOrder, Promises } from '@/ui/records'

interface Row { key: number; description: string; account_id: ID | ''; quantity: string; rate: string; tax_code_id: ID | ''; hsn_sac: string; project: ID | '' }
let k = 0
const blank = (): Row => ({ key: ++k, description: '', account_id: '', quantity: '1', rate: '', tax_code_id: '', hsn_sac: '', project: '' })

export default function DocumentEditor({ kind }: { kind: 'sales' | 'purchase' }) {
  const { id } = useParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const sales = kind === 'sales'
  const path = sales ? '/invoices' : '/bills'

  const [companyId, setCompanyId] = useState<ID>(ids[0] ?? '')
  const [docType, setDocType] = useState<DocType>(sales ? 'sales_invoice' : 'purchase_bill')
  const [partyId, setPartyId] = useState('')
  const [date, setDate] = useState(today())
  const [due, setDue] = useState(addDays(today(), 30))
  const [currency, setCurrency] = useState('INR')
  const [fx, setFx] = useState('1')
  const [reference, setReference] = useState('')
  const [narration, setNarration] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const loaded = useRef(false)

  const doc = useAsync(async () => (id ? api.getInvoice(id) : null), [api, id])
  const taxes = useAsync(() => api.listTaxCodes(companyId ? [companyId] : []), [api, companyId])
  const pays = useAsync(async () => (id ? (await api.listPayments({ companyIds: companies.map((c) => c.id) })).filter((p) => p.allocations?.some((a) => a.invoice_id === id)) : []), [api, id])
  const audit = useAsync(async () => (id ? api.listAudit({ entity: 'invoices', entityId: id, limit: 50 }) : []), [api, id])

  useEffect(() => {
    const d = doc.data
    if (!d || loaded.current) return
    loaded.current = true
    setCompanyId(d.company_id); setDocType(d.doc_type); setPartyId(d.party_id); setDate(d.doc_date); setDue(d.due_date ?? d.doc_date); setCurrency(d.currency); setFx(String(d.fx_rate)); setReference(d.reference ?? ''); setNarration(d.narration ?? '')
    setRows((d.lines ?? []).map((l) => ({ key: ++k, description: l.description ?? '', account_id: l.account_id, quantity: String(l.quantity ?? 1), rate: String(l.rate ?? l.amount), tax_code_id: l.tax_code_id ?? '', hsn_sac: l.hsn_sac ?? '', project: l.dims?.project ?? '' })))
  }, [doc.data])

  // a link that knows only the record, not its kind (a follow-up, an attachment), may arrive on the wrong side
  useEffect(() => {
    const d = doc.data
    if (!d) return
    const isSales = d.doc_type === 'sales_invoice' || d.doc_type === 'credit_note'
    if (isSales !== sales) nav((isSales ? '/invoices/' : '/bills/') + d.id, { replace: true })
  }, [doc.data, sales, nav])

  const company = companies.find((c) => c.id === companyId)
  useEffect(() => { if (!id && company) { setCurrency(company.base_currency); setFx('1') } }, [company?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const party = parties.find((p) => p.id === partyId)
  useEffect(() => { if (id || !party) return; const days = party.roles.find((r) => r.company_id === companyId)?.credit_days; if (days != null) setDue(addDays(date, days)) }, [partyId, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = Boolean(id && doc.data && doc.data.status !== 'draft')
  const wantTypes = sales ? (docType === 'credit_note' ? ['income'] : ['income']) : ['expense', 'asset']
  const accs = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active && wantTypes.includes(a.type) && !a.control_type).sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const pts = parties.filter((p) => p.roles.some((r) => r.company_id === companyId) && !['terminated'].includes(p.status)).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const projects = orgUnits.filter((u) => u.company_id === companyId && u.type_key === 'project' && u.status === 'active')

  const calc = rows.map((r) => {
    const amount = round2(D(r.quantity || 0).times(D(r.rate || 0)))
    const code = taxes.data?.find((t) => t.id === r.tax_code_id)
    const comps = (code?.components ?? []).filter((c) => (c.effective_from ?? '2000-01-01') <= date && (!c.effective_to || c.effective_to >= date))
    const parts = comps.map((c) => ({ name: c.component, rate: D(c.rate), tax: round2(amount.times(c.rate).div(100)) }))
    return { amount, parts, tax: sum(parts.map((p) => p.tax)) }
  })
  const subtotal = sum(calc.map((c) => c.amount)), taxTotal = sum(calc.map((c) => c.tax)), total = subtotal.plus(taxTotal)
  const byComp = new Map<string, ReturnType<typeof D>>()
  calc.forEach((c) => c.parts.forEach((p) => byComp.set(`${p.name} ${p.rate}%`, (byComp.get(`${p.name} ${p.rate}%`) ?? ZERO).plus(p.tax))))

  const problems: string[] = []
  if (!companyId) problems.push('Choose a company.')
  if (!partyId) problems.push(`Choose the ${sales ? 'customer' : 'supplier'}.`)
  if (party && ['blocked', 'terminated'].includes(party.status)) problems.push(`${party.display_name} is ${party.status}. New documents are not permitted.`)
  rows.forEach((r, i) => { if (!r.account_id) problems.push(`Line ${i + 1}: choose a ledger.`); if (calc[i].amount.lte(0)) problems.push(`Line ${i + 1}: enter a quantity and rate.`) })
  if (currency !== company?.base_currency && D(fx).lte(0)) problems.push('Enter the exchange rate.')
  if (due < date) problems.push('The due date is before the document date.')

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const payload = (): InvoiceInput => ({
    id, company_id: companyId, doc_type: docType, party_id: partyId, doc_date: date, due_date: due, currency, fx_rate: currency === company?.base_currency ? 1 : fx, reference: reference.trim() || undefined, narration: narration.trim() || undefined,
    lines: rows.map((r, i) => ({ description: r.description.trim(), account_id: r.account_id as ID, quantity: r.quantity || 1, rate: r.rate || 0, amount: calc[i].amount.toFixed(2), tax_code_id: r.tax_code_id || null, hsn_sac: r.hsn_sac || undefined, dims: (r.project ? { project: r.project } : {}) as Record<string, ID> })),
  })
  const save = async () => { const did = await act(() => api.saveInvoice(payload()), 'Saved — awaiting approval'); if (did && !id) nav(`${path}/${did}`, { replace: true }) }

  if (id && doc.error) return <ErrorBox message={doc.error} retry={doc.reload} />
  if (id && !doc.data) return <Panel><Loading rows={7} /></Panel>
  const d = doc.data
  const outstanding = d ? D(d.total).minus(d.amount_settled) : ZERO
  const over = d && (d.status === 'open' || d.status === 'partially_paid') ? daysBetween(d.due_date ?? d.doc_date, today()) : 0
  const approvePerm = sales ? 'invoice.approve' : 'bill.approve'
  const label = { sales_invoice: 'Tax invoice', purchase_bill: 'Purchase bill', credit_note: 'Credit note', debit_note: 'Debit note' }[docType]

  return (
    <div>
      <PageHeader eyebrow={`${sales ? 'Order to cash' : 'Purchase to pay'} · ${label}`} title={d?.doc_no ?? (id ? `${label} — awaiting approval` : `New ${label.toLowerCase()}`)}
        subtitle={d ? `${party?.display_name ?? ''} · ${company?.name ?? ''}` : 'The document is saved as a draft. Approval by a second person posts it to the ledger.'}
        actions={<>
          <button className="btn ghost" onClick={() => nav(path)}><ArrowLeft size={15} /> Back</button>
          {d && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>}
          {d?.journal_id && <button className="btn" onClick={() => nav('/journals/' + d.journal_id)}>View accounting entry</button>}
          {d && (d.status === 'open' || d.status === 'partially_paid') && <button className="btn primary" disabled={!can('payment.create', d.company_id)} onClick={() => nav(`/payments?new=${sales ? 'in' : 'out'}&party=${d.party_id}&invoice=${d.id}&company=${d.company_id}`)}><Banknote size={15} /> {sales ? 'Record receipt' : 'Record payment'}</button>}
          {!readOnly && <button className="btn" disabled={busy || problems.length > 0} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>}
          {d?.status === 'draft' && <button className="btn good" disabled={busy || !can(approvePerm, d.company_id)} title={can(approvePerm, d.company_id) ? 'Approving posts the entry to the ledger' : 'You are not authorised to approve this document'}
            onClick={() => void act(async () => { await api.saveInvoice(payload()); return api.approveInvoice(d.id) }, (no) => `Approved and posted as ${no}`)}><BadgeCheck size={15} /> Approve & post</button>}
        </>} />

      {d && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusChip status={over > 0 ? 'disputed' : d.status} label={over > 0 ? `overdue ${over} days` : d.status === 'draft' ? 'awaiting approval' : undefined} />
          {d.status !== 'draft' && <span className="chip">Outstanding {fmtMoney(outstanding, { currency: d.currency })}</span>}
          {d.approved_at && <span className="chip">Approved {fmtDateTime(d.approved_at)}</span>}
        </div>
      )}
      {d?.status === 'draft' && <Note className="mb-4">Maker-checker applies: the person who prepared this document cannot approve it, unless the Owner has explicitly enabled Owner self-approval.</Note>}
      {readOnly && <Note kind="good" className="mb-4">This document is posted. It cannot be edited. To correct it, raise a {sales ? 'credit note' : 'debit note'} or reverse its accounting entry.</Note>}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Company"><select className="field" value={companyId} disabled={Boolean(id)} onChange={(e) => { setCompanyId(e.target.value); setPartyId(''); setRows([blank()]) }}><option value="">Choose…</option>{companies.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
              <Field label="Document type"><select className="field" value={docType} disabled={Boolean(id)} onChange={(e) => setDocType(e.target.value as DocType)}>{(sales ? [['sales_invoice', 'Tax invoice'], ['credit_note', 'Credit note']] : [['purchase_bill', 'Purchase bill'], ['debit_note', 'Debit note']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label={sales ? 'Customer' : 'Supplier'} hint={party?.gstin ? `GSTIN ${party.gstin}` : party ? 'No GSTIN recorded for this party' : undefined}>
                <select className="field" value={partyId} disabled={readOnly} onChange={(e) => setPartyId(e.target.value)}><option value="">Choose…</option>{pts.map((p) => <option key={p.id} value={p.id} disabled={['blocked'].includes(p.status)}>{p.display_name} · {p.party_no}{p.status !== 'active' ? ` (${p.status})` : ''}</option>)}</select>
              </Field>
              <Field label="Document date"><input type="date" className="field" value={date} disabled={readOnly} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Due date"><input type="date" className="field" value={due} disabled={readOnly} onChange={(e) => setDue(e.target.value)} /></Field>
              <Field label={sales ? 'Your reference' : "Supplier's invoice number"} hint={!sales ? 'Used to detect duplicate bills.' : undefined}><input className="field" value={reference} disabled={readOnly} onChange={(e) => setReference(e.target.value)} /></Field>
              <Field label="Currency"><select className="field" value={currency} disabled={readOnly} onChange={(e) => { setCurrency(e.target.value); if (e.target.value === company?.base_currency) setFx('1') }}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'SAR', 'CNY'].map((c) => <option key={c}>{c}</option>)}</select></Field>
              {currency !== company?.base_currency && <Field label={`Exchange rate (1 ${currency} = ? ${company?.base_currency ?? ''})`} hint="Entered by you and stored with the document."><input className="field num" inputMode="decimal" value={fx} disabled={readOnly} onChange={(e) => setFx(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
              <Field label="Narration" className="md:col-span-2 xl:col-span-3"><input className="field" value={narration} disabled={readOnly} onChange={(e) => setNarration(e.target.value)} placeholder="What is this document for?" /></Field>
            </div>
          </Panel>

          <Panel lit={false} className="overflow-hidden">
            <div className="overflow-auto">
              <table className="table dense" style={{ minWidth: 980 }}>
                <thead><tr><th style={{ width: 36 }}>#</th><th style={{ minWidth: 210 }}>Description</th><th style={{ minWidth: 200 }}>Ledger</th>{projects.length > 0 && <th style={{ minWidth: 140 }}>Project</th>}<th style={{ width: 92 }}>HSN / SAC</th><th className="r" style={{ width: 84 }}>Qty</th><th className="r" style={{ width: 130 }}>Rate</th><th style={{ width: 150 }}>Tax</th><th className="r" style={{ width: 130 }}>Amount</th><th className="r" style={{ width: 110 }}>Tax</th>{!readOnly && <th style={{ width: 40 }} />}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key}>
                      <td className="num text-muted">{i + 1}</td>
                      <td><input className="field sm" value={r.description} disabled={readOnly} onChange={(e) => set(r.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></td>
                      <td><select className="field sm" value={r.account_id} disabled={readOnly} onChange={(e) => set(r.key, { account_id: e.target.value })} aria-label={`Line ${i + 1} ledger`}><option value="">Choose…</option>{accs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td>
                      {projects.length > 0 && <td><select className="field sm" value={r.project} disabled={readOnly} onChange={(e) => set(r.key, { project: e.target.value })} aria-label={`Line ${i + 1} project`}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>}
                      <td><input className="field sm num" value={r.hsn_sac} disabled={readOnly} onChange={(e) => set(r.key, { hsn_sac: e.target.value })} aria-label={`Line ${i + 1} HSN or SAC`} /></td>
                      <td><input className="field sm num text-right" inputMode="decimal" value={r.quantity} disabled={readOnly} onChange={(e) => set(r.key, { quantity: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Line ${i + 1} quantity`} /></td>
                      <td><input className="field sm num text-right" inputMode="decimal" value={r.rate} disabled={readOnly} onChange={(e) => set(r.key, { rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Line ${i + 1} rate`} /></td>
                      <td><select className="field sm" value={r.tax_code_id} disabled={readOnly} onChange={(e) => set(r.key, { tax_code_id: e.target.value })} aria-label={`Line ${i + 1} tax code`}><option value="">No tax</option>{(taxes.data ?? []).filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                      <td className="r"><Money value={calc[i].amount} currency={currency} /></td>
                      <td className="r"><Money value={calc[i].tax} currency={currency} dim /></td>
                      {!readOnly && <td><button className="btn ghost icon sm" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove line"><Trash2 size={13} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!readOnly && <div className="border-t border-line px-3.5 py-2.5"><button className="btn sm" onClick={() => setRows((rs) => [...rs, blank()])}><Plus size={13} /> Add line</button></div>}
          </Panel>
          {!readOnly && problems.length > 0 && rows.some((r) => r.account_id || r.rate) && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
        </div>

        <div className="space-y-4">
          <Panel className="p-5" lit={false}>
            <div className="eyebrow mb-3">Totals</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink2">Taxable value</span><Money value={subtotal} currency={currency} /></div>
              {[...byComp.entries()].map(([n, v]) => <div key={n} className="flex justify-between"><span className="text-ink2">{n}</span><Money value={v} currency={currency} /></div>)}
              <div className="hairline my-2" />
              <div className="flex items-baseline justify-between"><span className="font-medium">Total</span><Money value={total} currency={currency} className="display text-[22px] text-gold" /></div>
              {currency !== company?.base_currency && <div className="flex justify-between text-[12px] text-muted"><span>In {company?.base_currency} at {fx || '—'}</span><Money value={round2(total.times(D(fx)))} currency={company?.base_currency} /></div>}
              {d && d.status !== 'draft' && <>
                <div className="flex justify-between"><span className="text-ink2">Settled</span><Money value={d.amount_settled} currency={currency} /></div>
                <div className="flex justify-between"><span className="font-medium">Outstanding</span><Money value={outstanding} currency={currency} className={cx(over > 0 && 'text-neg')} /></div>
              </>}
            </div>
            <div className="mt-3 text-[11.5px] leading-relaxed text-muted">Tax is calculated from the tax codes in force on {fmtDate(date)} and recalculated by the ledger engine on approval. Rates are configuration, not code.</div>
          </Panel>

          <Section title="Accounting treatment on approval">
            <Panel className="p-4 text-[12.5px]" lit={false}>
              {(() => {
                const normal = docType === 'sales_invoice' || docType === 'purchase_bill'
                const controlDr = sales ? normal : !normal
                const ctl = sales ? 'Accounts receivable' : 'Accounts payable'
                const other = sales ? 'Revenue ledgers + output tax' : 'Expense / asset ledgers + input tax'
                return (<>
                  <div className="flex justify-between"><span>Dr {controlDr ? `${ctl} — ${party?.display_name ?? 'party'}` : other}</span><Money value={total} currency={currency} /></div>
                  <div className="flex justify-between pl-5 text-ink2"><span>Cr {controlDr ? other : `${ctl} — ${party?.display_name ?? 'party'}`}</span><Money value={total} currency={currency} /></div>
                  <div className="mt-2 text-[11.5px] text-muted">Rule: {sales ? 'InvoiceApproved → create receivable, revenue and tax liability.' : 'BillApproved → create expense or asset, input tax and payable.'}</div>
                </>)
              })()}
            </Panel>
          </Section>

          {d && (pays.data?.length ?? 0) > 0 && (
            <Section title={sales ? 'Receipts against this invoice' : 'Payments against this bill'}>
              <Panel className="p-1.5" lit={false}>
                {pays.data!.map((p) => (
                  <button key={p.id} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface2" onClick={() => p.journal_id && nav('/journals/' + p.journal_id)}>
                    <span><span className="num text-gold">{p.pay_no ?? 'draft'}</span> <span className="text-muted">· {fmtDate(p.pay_date)} · {p.reference ?? ''}</span></span>
                    <Money value={p.allocations?.find((a) => a.invoice_id === d.id)?.amount ?? 0} currency={p.currency} />
                  </button>
                ))}
              </Panel>
            </Section>
          )}

          {d && !sales && docType === 'purchase_bill' && <BillOrder bill={d} />}
          {d && sales && docType === 'sales_invoice' && d.status !== 'draft' && d.status !== 'cancelled' && <Promises companyId={d.company_id} partyId={d.party_id} invoice={d} />}
          {d && <Attachments companyId={d.company_id} entity="invoices" entityId={d.id} title={sales ? 'Documents attached to this invoice' : 'Documents attached to this bill'} />}
          {d && <CustomFields companyId={d.company_id} entity="invoices" entityId={d.id} scopeKey={d.doc_type} />}

          {d && (audit.data?.length ?? 0) > 0 && (
            <Section title="History">
              <Panel className="max-h-[260px] overflow-auto p-1.5" lit={false}>
                {audit.data!.filter((a) => !['insert', 'update'].includes(a.action)).map((a) => (
                  <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]"><span className="text-ink">{a.action.replace(/_/g, ' ')}</span> <span className="text-muted">· {a.actor_name} · {fmtDateTime(a.at)}</span></div>
                ))}
              </Panel>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
