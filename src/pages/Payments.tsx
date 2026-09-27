import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Search, ShieldCheck } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID, Invoice, Payment } from '@/engine/types'
import { D, parseAmount, sum, ZERO } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type Tab = 'all' | 'in' | 'out' | 'draft'

export default function Payments() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Payment | null>(null)
  const creating = sp.get('new') as 'in' | 'out' | null

  const res = useAsync(() => api.listPayments({ companyIds: ids }), [api, ids.join(',')])
  const all = res.data ?? []
  useEffect(() => { const o = sp.get('open'); if (o && all.length) setOpen(all.find((p) => p.id === o) ?? null) }, [sp, all.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const party = (p: Payment) => parties.find((x) => x.id === p.party_id)?.display_name ?? 'Unknown party'
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all.filter((p) => tab === 'all' || (tab === 'draft' ? p.status === 'draft' : p.direction === tab))
      .filter((p) => !t || ((p.pay_no ?? '') + ' ' + (p.reference ?? '') + ' ' + party(p) + ' ' + (p.narration ?? '')).toLowerCase().includes(t))
  }, [all, tab, q, parties]) // eslint-disable-line react-hooks/exhaustive-deps

  const base = (p: Payment) => D(p.amount).times(p.fx_rate)
  const posted = all.filter((p) => p.status === 'posted')
  const cols: Column<Payment>[] = [
    { key: 'date', header: 'Date', width: 110, render: (p) => <span className="num text-ink2">{fmtDate(p.pay_date)}</span>, sort: (p) => p.pay_date, csv: (p) => p.pay_date },
    { key: 'no', header: 'Number', width: 160, render: (p) => p.pay_no ? <span className="num text-gold">{p.pay_no}</span> : <span className="text-muted">draft</span>, sort: (p) => p.pay_no ?? '', csv: (p) => p.pay_no },
    { key: 'dir', header: 'Direction', width: 120, render: (p) => <span className={cx('chip', p.direction === 'in' ? 'pos' : 'cyan')}>{p.direction === 'in' ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}{p.direction === 'in' ? 'received' : 'paid'}</span>, sort: (p) => p.direction, csv: (p) => p.direction },
    { key: 'co', header: 'Co.', width: 70, render: (p) => <span className="num text-[11.5px] text-muted">{companies.find((c) => c.id === p.company_id)?.code}</span>, csv: (p) => companies.find((c) => c.id === p.company_id)?.name },
    { key: 'party', header: 'Party', render: (p) => <div className="min-w-0"><div className="truncate">{party(p)}</div>{p.narration && <div className="truncate text-[11.5px] text-muted">{p.narration}</div>}</div>, sort: party, csv: party },
    { key: 'bank', header: 'Through', width: 190, render: (p) => <span className="text-ink2">{accounts.find((a) => a.id === p.bank_ledger_id)?.name}</span>, csv: (p) => accounts.find((a) => a.id === p.bank_ledger_id)?.name },
    { key: 'ref', header: 'Bank reference', width: 150, render: (p) => <span className="num text-[12px] text-ink2">{p.reference ?? ''}</span>, csv: (p) => p.reference },
    { key: 'amt', header: 'Amount', align: 'right', width: 150, render: (p) => <Money value={p.amount} currency={p.currency} />, sort: (p) => base(p).toNumber(), csv: (p) => String(p.amount) },
    { key: 'st', header: 'Status', width: 140, render: (p) => <StatusChip status={p.status} label={p.status === 'draft' ? 'awaiting approval' : undefined} />, sort: (p) => p.status, csv: (p) => p.status },
  ]

  const closeNew = () => { const n = new URLSearchParams(sp); ['new', 'party', 'invoice', 'company'].forEach((k) => n.delete(k)); setSp(n, { replace: true }) }

  return (
    <div>
      <PageHeader eyebrow="Receipts & payments" title="Payments & receipts"
        subtitle="NUMERO records money that has moved and prepares payment proposals. It never moves money itself — payment is released through your bank, under your bank's own security."
        actions={<>
          <button className="btn" disabled={!can('payment.create')} onClick={() => setSp({ new: 'in' })}><ArrowDownLeft size={15} className="text-pos" /> Record receipt</button>
          <button className="btn primary" disabled={!can('payment.create')} onClick={() => setSp({ new: 'out' })}><ArrowUpRight size={15} /> Record payment</button>
        </>} />

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Received', posted.filter((p) => p.direction === 'in'), 'pos'], ['Paid', posted.filter((p) => p.direction === 'out'), ''], ['Awaiting approval', all.filter((p) => p.status === 'draft'), 'warn']] as const).map(([l, list, tone]) => (
          <Panel key={l} className="p-4" lit={false}><div className="eyebrow">{l}</div><div className={cx('mt-1.5 text-[19px]', tone === 'pos' && 'text-pos')}><Money value={sum(list.map(base))} compact /></div><div className="mt-1 text-[11.5px] text-muted"><span className="num">{list.length}</span> record{list.length === 1 ? '' : 's'}</div></Panel>
        ))}
        <Panel className="p-4" lit={false}><div className="flex items-center gap-2 text-pos"><ShieldCheck size={16} /><span className="eyebrow">No autonomous money movement</span></div><div className="mt-1.5 text-[12px] leading-relaxed text-muted">Neither NUMI nor any automation can release a payment. Every payment record needs a human maker and a separate approver.</div></Panel>
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All', count: all.length }, { key: 'in', label: 'Receipts' }, { key: 'out', label: 'Payments' }, { key: 'draft', label: 'Awaiting approval', count: all.filter((p) => p.status === 'draft').length }]} />
      <Panel lit={false} className="overflow-hidden">
        {res.error ? <ErrorBox message={res.error} retry={res.reload} /> : !res.data ? <Loading rows={8} /> : (
          <DataTable columns={cols} rows={rows} rowKey={(p) => p.id} onRow={setOpen} exportName="payments-and-receipts" initialSort={{ key: 'date', dir: 'desc' }} maxHeight="calc(100vh - 420px)"
            toolbar={<div className="relative w-[300px] max-w-full"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="field sm pl-8" placeholder="Search number, reference, party" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" /></div>}
            empty={{ title: 'No payments or receipts match' }} />
        )}
      </Panel>

      <Drawer open={Boolean(open)} onClose={() => { setOpen(null); if (sp.get('open')) setSp({}, { replace: true }) }} title={open?.pay_no ?? 'Payment record'} subtitle={open ? `${open.direction === 'in' ? 'Received from' : 'Paid to'} ${party(open)}` : ''}
        footer={open && <>
          {open.journal_id && <button className="btn" onClick={() => nav('/journals/' + open.journal_id)}>View accounting entry</button>}
          <button className="btn" onClick={() => nav('/parties/' + open.party_id)}>Open party</button>
          {open.status === 'draft' && <button className="btn good" disabled={busy || !can('payment.approve', open.company_id)} title={can('payment.approve', open.company_id) ? undefined : 'You are not authorised to approve payments'}
            onClick={() => void act(async () => { const n = await api.approvePayment(open.id); setOpen(null); return n }, (n) => `Approved and posted as ${n}`)}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Approve & post</button>}
        </>}>
        {open && <PaymentBody p={open} />}
      </Drawer>

      {creating && <NewPayment direction={creating} onClose={closeNew} presetParty={sp.get('party') ?? ''} presetInvoice={sp.get('invoice') ?? ''} presetCompany={sp.get('company') ?? (ids.length === 1 ? ids[0] : '')} />}
    </div>
  )
}

function PaymentBody({ p }: { p: Payment }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const inv = useAsync(async () => Promise.all((p.allocations ?? []).map((a) => api.getInvoice(a.invoice_id))), [api, p.id])
  const alloc = sum((p.allocations ?? []).map((a) => a.amount))
  const rest = D(p.amount).minus(alloc)
  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex flex-wrap gap-2"><StatusChip status={p.status} label={p.status === 'draft' ? 'awaiting approval' : undefined} /><span className="chip">{fmtDate(p.pay_date)}</span><span className="chip">{p.method.replace(/_/g, ' ')}</span></div>
      <Money value={p.amount} currency={p.currency} className="display block text-[30px]" />
      <div className="grid grid-cols-2 gap-3">
        {[['Company', companies.find((c) => c.id === p.company_id)?.name], ['Through', accounts.find((a) => a.id === p.bank_ledger_id)?.name], ['Bank reference', p.reference ?? '—'], ['Exchange rate', String(p.fx_rate)]].map(([l, v]) => <div key={l}><div className="eyebrow">{l}</div><div>{v}</div></div>)}
      </div>
      {p.narration && <div><div className="eyebrow">Narration</div><div>{p.narration}</div></div>}
      <div>
        <div className="eyebrow mb-1.5">Settled against</div>
        {(p.allocations ?? []).length === 0 ? <div className="text-muted">Not allocated to any document.</div> : (
          <div className="rounded-xl border border-line">
            {(p.allocations ?? []).map((a) => { const i = inv.data?.find((x) => x.id === a.invoice_id); return (
              <button key={a.invoice_id} className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left last:border-0 hover:bg-surface2" onClick={() => i && nav((i.doc_type === 'sales_invoice' ? '/invoices/' : '/bills/') + i.id)}>
                <span className="num text-gold">{i?.doc_no ?? '…'}</span><Money value={a.amount} currency={p.currency} />
              </button>) })}
          </div>
        )}
      </div>
      {rest.gt(0) && <Note kind="warn"><Money value={rest} currency={p.currency} /> is not allocated to any document. It is held as an <b>advance</b> — it is not income and not an expense — and stays visible until it is settled.</Note>}
      {p.status === 'draft' && <Note>Maker-checker applies: the person who recorded this cannot approve it, unless the Owner has explicitly enabled Owner self-approval.</Note>}
    </div>
  )
}

function NewPayment({ direction, onClose, presetParty, presetInvoice, presetCompany }: { direction: 'in' | 'out'; onClose: () => void; presetParty: ID; presetInvoice: ID; presetCompany: ID }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const { act, busy } = useAction()
  const isIn = direction === 'in'
  const [companyId, setCompanyId] = useState(presetCompany)
  const [partyId, setPartyId] = useState(presetParty)
  const [bank, setBank] = useState('')
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [narration, setNarration] = useState('')
  const [benef, setBenef] = useState('')
  const [alloc, setAlloc] = useState<Record<ID, string>>({})

  const company = companies.find((c) => c.id === companyId)
  const banks = accounts.filter((a) => a.company_id === companyId && !a.is_group && (a.control_type === 'bank' || a.control_type === 'cash'))
  // default to a bank account rather than the cash box: most receipts and payments move through the bank
  useEffect(() => { if (banks.length && !banks.some((b) => b.id === bank)) setBank((banks.find((b) => b.control_type === 'bank') ?? banks[0]).id) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps
  const docs = useAsync(async () => (companyId && partyId ? (await api.listInvoices({ companyIds: [companyId], partyId, docTypes: [isIn ? 'sales_invoice' : 'purchase_bill'] })).filter((i) => i.status === 'open' || i.status === 'partially_paid').sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')) : []), [api, companyId, partyId, direction])
  const pbanks = useAsync(async () => (!isIn && partyId ? api.listPartyBanks(partyId) : []), [api, partyId, direction])
  const out = (i: Invoice) => D(i.total).minus(i.amount_settled)
  const currency = docs.data?.[0]?.currency ?? company?.base_currency ?? 'INR'
  const foreign = currency !== company?.base_currency
  const [fx, setFx] = useState('1')
  useEffect(() => { if (docs.data?.[0]) setFx(String(docs.data[0].fx_rate)) }, [docs.data?.[0]?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!presetInvoice || !docs.data) return
    const i = docs.data.find((x) => x.id === presetInvoice)
    if (i && !amount) { setAmount(out(i).toString()); setAlloc({ [i.id]: out(i).toString() }) }
  }, [docs.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const amt = parseAmount(amount) ?? ZERO
  const allocated = sum(Object.values(alloc).map((v) => D(v || 0)))
  const rest = amt.minus(allocated)
  const autoAllocate = () => {
    let left = amt; const next: Record<ID, string> = {}
    for (const i of docs.data ?? []) { if (left.lte(0)) break; const take = left.gt(out(i)) ? out(i) : left; next[i.id] = take.toString(); left = left.minus(take) }
    setAlloc(next)
  }
  const problems: string[] = []
  if (!companyId) problems.push('Choose a company.')
  if (!partyId) problems.push('Choose the party.')
  if (!bank) problems.push('Choose the bank or cash account.')
  if (amt.lte(0)) problems.push('Enter the amount.')
  if (rest.lt(0)) problems.push('Allocations exceed the amount.')
  for (const i of docs.data ?? []) if (D(alloc[i.id] || 0).gt(out(i))) problems.push(`Allocation to ${i.doc_no} exceeds its outstanding balance.`)
  const pty = parties.find((p) => p.id === partyId)
  if (!isIn && pty && ['blocked', 'suspended', 'terminated'].includes(pty.status)) problems.push(`${pty.display_name} is ${pty.status}. New payments are not permitted.`)

  const save = async () => {
    const id = await act(() => api.savePayment({
      company_id: companyId, direction, party_id: partyId, bank_ledger_id: bank, pay_date: date, amount: amt.toFixed(2), currency, fx_rate: foreign ? fx : 1, method, reference: reference.trim() || undefined, narration: narration.trim() || undefined,
      party_bank_account_id: benef || null, allocations: Object.entries(alloc).filter(([, v]) => D(v || 0).gt(0)).map(([invoice_id, v]) => ({ invoice_id, amount: D(v).toFixed(2) })),
    }), 'Recorded — awaiting approval by a second person')
    if (id) onClose()
  }

  return (
    <Modal open onClose={onClose} width={760} title={isIn ? 'Record a receipt' : 'Record a payment'} subtitle={isIn ? 'Money received from a customer or other party.' : 'Money paid to a supplier or other party. This records the payment; it does not send money.'}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} onClick={() => void save()}>{busy && <Spinner />} Save for approval</button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company"><select className="field" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPartyId(''); setAlloc({}) }}><option value="">Choose…</option>{companies.filter((c) => c.status === 'active' && can('payment.create', c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={isIn ? 'Received from' : 'Paid to'}><select className="field" value={partyId} onChange={(e) => { setPartyId(e.target.value); setAlloc({}); setBenef('') }}><option value="">Choose…</option>{parties.filter((p) => p.roles.some((r) => r.company_id === companyId)).sort((a, b) => a.display_name.localeCompare(b.display_name)).map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select></Field>
        <Field label={isIn ? 'Received into' : 'Paid from'}><select className="field" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Choose…</option>{banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={`Amount (${currency})`}><input className="field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        {foreign && <Field label={`Settlement rate (1 ${currency} = ? ${company?.base_currency})`} hint="Any difference from the booking rate is posted as exchange gain or loss."><input className="field num" value={fx} onChange={(e) => setFx(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        <Field label="Method"><select className="field" value={method} onChange={(e) => setMethod(e.target.value)}>{['bank_transfer', 'upi', 'cheque', 'cash', 'card', 'gateway', 'other'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></Field>
        <Field label="Bank reference / UTR / cheque no."><input className="field num" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        {!isIn && <Field label="Beneficiary bank details" hint={(pbanks.data ?? []).some((b) => b.status === 'pending_verification') ? 'Some details await independent verification and cannot be used yet.' : undefined}>
          <select className="field" value={benef} onChange={(e) => setBenef(e.target.value)}><option value="">Not specified</option>{(pbanks.data ?? []).map((b) => <option key={b.id} value={b.id} disabled={b.status !== 'verified'}>{b.bank_name} ••••{b.account_no.slice(-4)} — {b.status.replace(/_/g, ' ')}</option>)}</select>
        </Field>}
        <Field label="Narration" className="sm:col-span-2 lg:col-span-3"><input className="field" value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
      </div>

      <div className="mb-2 mt-5 flex items-center justify-between"><div className="eyebrow">Settle against open documents</div>{(docs.data?.length ?? 0) > 0 && <button className="btn sm" disabled={amt.lte(0)} onClick={autoAllocate}>Allocate oldest first</button>}</div>
      {!partyId ? <div className="text-[12.5px] text-muted">Choose the party to see what is outstanding.</div> : docs.loading ? <Loading rows={2} /> : !(docs.data?.length) ? <div className="text-[12.5px] text-muted">This party has no open {isIn ? 'invoices' : 'bills'} in this company.</div> : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table dense">
            <thead><tr><th>Document</th><th>Due</th><th className="r">Outstanding</th><th className="r" style={{ width: 170 }}>Settle now</th></tr></thead>
            <tbody>{docs.data!.map((i) => (
              <tr key={i.id}><td><span className="num text-gold">{i.doc_no}</span></td><td className="num text-ink2">{fmtDate(i.due_date)}</td><td className="r"><Money value={out(i)} currency={i.currency} /></td>
                <td><input className="field sm num text-right" inputMode="decimal" value={alloc[i.id] ?? ''} placeholder="0.00" onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Settle ${i.doc_no}`} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
        <span className="text-ink2">Allocated <Money value={allocated} currency={currency} /> of <Money value={amt} currency={currency} /></span>
        {rest.gt(0) && amt.gt(0) && <span className="chip warn">{`${rest.toFixed(2)} ${currency} will be held as an advance`}</span>}
      </div>
      {problems.length > 0 && amt.gt(0) && <Note kind="warn" className="mt-3"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Modal>
  )
}
