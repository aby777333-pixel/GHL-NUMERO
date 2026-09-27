import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, Search } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { DocType, Invoice } from '@/engine/types'
import { D, sum } from '@/lib/money'
import { daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, ErrorBox, Loading, Money, PageHeader, Panel, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type Tab = 'all' | 'draft' | 'open' | 'overdue' | 'paid' | 'notes'

export default function Documents({ kind }: { kind: 'sales' | 'purchase' }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const sales = kind === 'sales'
  const types: DocType[] = sales ? ['sales_invoice', 'credit_note'] : ['purchase_bill', 'debit_note']
  const path = sales ? '/invoices' : '/bills'
  const perm = sales ? 'invoice.create' : 'bill.create'

  const res = useAsync(() => api.listInvoices({ companyIds: ids, docTypes: types }), [api, ids.join(','), kind])
  const all = res.data ?? []
  const out = (i: Invoice) => D(i.total).minus(i.amount_settled)
  const isOpen = (i: Invoice) => i.status === 'open' || i.status === 'partially_paid'
  const overdue = (i: Invoice) => isOpen(i) && daysBetween(i.due_date ?? i.doc_date, today()) > 0
  const party = (i: Invoice) => parties.find((p) => p.id === i.party_id)?.display_name ?? 'Unknown party'

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all
      .filter((i) => tab === 'all' || (tab === 'draft' && i.status === 'draft') || (tab === 'open' && isOpen(i)) || (tab === 'overdue' && overdue(i)) || (tab === 'paid' && i.status === 'paid') || (tab === 'notes' && (i.doc_type === 'credit_note' || i.doc_type === 'debit_note')))
      .filter((i) => !t || ((i.doc_no ?? '') + ' ' + (i.reference ?? '') + ' ' + party(i) + ' ' + (i.narration ?? '')).toLowerCase().includes(t))
  }, [all, tab, q, parties]) // eslint-disable-line react-hooks/exhaustive-deps

  const main = all.filter((i) => i.doc_type === (sales ? 'sales_invoice' : 'purchase_bill'))
  const base = (i: Invoice, v: D_) => D(v).times(i.fx_rate)
  const tiles: [string, number, ReturnType<typeof D>, string][] = [
    ['Outstanding', main.filter(isOpen).length, sum(main.filter(isOpen).map((i) => base(i, out(i)))), ''],
    ['Overdue', main.filter(overdue).length, sum(main.filter(overdue).map((i) => base(i, out(i)))), 'neg'],
    ['Drafts awaiting approval', all.filter((i) => i.status === 'draft').length, sum(all.filter((i) => i.status === 'draft').map((i) => base(i, i.total))), 'warn'],
    ['Settled', main.filter((i) => i.status === 'paid').length, sum(main.filter((i) => i.status === 'paid').map((i) => base(i, i.total))), 'pos'],
  ]

  const cols: Column<Invoice>[] = [
    { key: 'date', header: 'Date', width: 110, render: (i) => <span className="num text-ink2">{fmtDate(i.doc_date)}</span>, sort: (i) => i.doc_date, csv: (i) => i.doc_date },
    { key: 'no', header: 'Number', width: 160, render: (i) => i.doc_no ? <span className="num text-gold">{i.doc_no}</span> : <span className="text-muted">draft</span>, sort: (i) => i.doc_no ?? '', csv: (i) => i.doc_no },
    { key: 'co', header: 'Co.', width: 70, render: (i) => <span className="num text-[11.5px] text-muted">{companies.find((c) => c.id === i.company_id)?.code}</span>, csv: (i) => companies.find((c) => c.id === i.company_id)?.name },
    { key: 'party', header: sales ? 'Customer' : 'Supplier', render: (i) => <div className="min-w-0"><div className="truncate">{party(i)}</div>{i.narration && <div className="truncate text-[11.5px] text-muted">{i.narration}</div>}</div>, sort: party, csv: party },
    { key: 'ref', header: sales ? 'Reference' : 'Supplier ref.', width: 140, render: (i) => <span className="num text-[12px] text-ink2">{i.reference ?? ''}</span>, csv: (i) => i.reference },
    { key: 'due', header: 'Due', width: 150, render: (i) => { const dd = daysBetween(i.due_date ?? i.doc_date, today()); return <span className={cx('num', overdue(i) ? 'text-neg' : 'text-ink2')}>{fmtDate(i.due_date)}{overdue(i) && <span className="ml-1.5 text-[11px]">+{dd}d</span>}</span> }, sort: (i) => i.due_date ?? '', csv: (i) => i.due_date },
    { key: 'total', header: 'Total', align: 'right', width: 150, render: (i) => <Money value={i.total} currency={i.currency} />, sort: (i) => Number(i.total) * Number(i.fx_rate), csv: (i) => String(i.total) },
    { key: 'out', header: 'Outstanding', align: 'right', width: 150, render: (i) => (i.status === 'draft' ? <span className="text-muted">—</span> : <Money value={out(i)} currency={i.currency} dim className={cx(overdue(i) && 'text-neg')} />), sort: (i) => out(i).toNumber(), csv: (i) => out(i).toFixed(2) },
    { key: 'ccy', header: 'Ccy', width: 60, render: (i) => <span className="num text-[11.5px] text-muted">{i.currency}</span>, csv: (i) => i.currency },
    { key: 'st', header: 'Status', width: 130, render: (i) => <StatusChip status={overdue(i) ? 'disputed' : i.status} label={overdue(i) ? 'overdue' : i.status === 'draft' ? 'awaiting approval' : undefined} />, sort: (i) => i.status, csv: (i) => i.status },
  ]

  return (
    <div>
      <PageHeader eyebrow={sales ? 'Order to cash' : 'Purchase to pay'} title={sales ? 'Sales & billing' : 'Purchase bills'}
        subtitle={sales ? 'When an invoice is approved, NUMERO posts the receivable, the revenue and the tax in one balanced entry.' : 'When a bill is approved, NUMERO posts the expense or asset, the input tax and the payable in one balanced entry.'}
        actions={<button className="btn primary" disabled={!can(perm)} title={can(perm) ? undefined : 'You are not authorised to create this document'} onClick={() => nav(path + '/new')}><FilePlus2 size={15} /> {sales ? 'New invoice' : 'New bill'}</button>} />

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([l, n, v, tone]) => (
          <Panel key={l} className="p-4" lit={false}>
            <div className="eyebrow">{l}</div>
            <div className={cx('mt-1.5 text-[19px]', tone === 'neg' && n > 0 && 'text-neg')}><Money value={v} compact /></div>
            <div className="mt-1 text-[11.5px] text-muted"><span className="num">{n}</span> document{n === 1 ? '' : 's'}</div>
          </Panel>
        ))}
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'all', label: 'All', count: all.length }, { key: 'draft', label: 'Awaiting approval', count: all.filter((i) => i.status === 'draft').length },
        { key: 'open', label: 'Outstanding', count: all.filter(isOpen).length }, { key: 'overdue', label: 'Overdue', count: all.filter(overdue).length },
        { key: 'paid', label: 'Settled' }, { key: 'notes', label: sales ? 'Credit notes' : 'Debit notes' },
      ]} />

      <Panel lit={false} className="overflow-hidden">
        {res.error ? <ErrorBox message={res.error} retry={res.reload} /> : !res.data ? <Loading rows={8} /> : (
          <DataTable columns={cols} rows={rows} rowKey={(i) => i.id} onRow={(i) => nav(`${path}/${i.id}`)} exportName={sales ? 'sales-invoices' : 'purchase-bills'} initialSort={{ key: 'date', dir: 'desc' }} maxHeight="calc(100vh - 420px)"
            toolbar={<div className="relative w-[300px] max-w-full"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="field sm pl-8" placeholder="Search number, reference, party" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" /></div>}
            empty={{ title: 'No documents match', body: sales ? 'Raise the first invoice to a customer.' : 'Record the first supplier bill.' }} />
        )}
      </Panel>
    </div>
  )
}
type D_ = Parameters<typeof D>[0]
