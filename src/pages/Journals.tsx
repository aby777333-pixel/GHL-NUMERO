import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, Search, Sparkles, Wand2 } from 'lucide-react'
import { can, useApp, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { Journal, JournalStatus } from '@/engine/types'
import { fmtDate, today } from '@/lib/dates'
import { ErrorBox, Loading, Money, PageHeader, Panel, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type Tab = 'all' | 'draft' | 'submitted' | 'approved' | 'posted' | 'reversed' | 'other'
const STATUS: Record<Tab, JournalStatus[] | undefined> = {
  all: undefined, draft: ['draft'], submitted: ['submitted'], approved: ['approved'], posted: ['posted'], reversed: ['reversed'], other: ['rejected', 'cancelled'],
}

export default function Journals() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const asOf = useApp((s) => s.asOf)
  const ids = useScopeIds()
  const period = usePeriod()
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [allDates, setAllDates] = useState(false)
  const [limit, setLimit] = useState(500)

  const to = asOf ?? period.to
  const res = useAsync(async () => {
    const [list, counts] = await Promise.all([
      api.listJournals({ companyIds: ids, status: STATUS[tab], from: allDates ? undefined : period.from, to: allDates ? asOf ?? undefined : to, q: q.trim() || undefined, limit }),
      Promise.all((['draft', 'submitted', 'approved'] as const).map((s) => api.listJournals({ companyIds: ids, status: [s], limit: 1 }).then((r) => [s, r.total] as const))),
    ])
    return { ...list, counts: Object.fromEntries(counts) as Record<'draft' | 'submitted' | 'approved', number> }
  }, [api, ids.join(','), tab, q, allDates, period.from, to, limit])

  const name = (id: string) => companies.find((c) => c.id === id)
  const cols: Column<Journal>[] = [
    { key: 'date', header: 'Date', width: 112, render: (j) => <span className="num text-ink2">{fmtDate(j.journal_date)}</span>, sort: (j) => j.journal_date, csv: (j) => j.journal_date },
    { key: 'no', header: 'Voucher', width: 150, render: (j) => j.voucher_no ? <span className="num text-gold">{j.voucher_no}</span> : <span className="text-muted">not yet numbered</span>, sort: (j) => j.voucher_no ?? '', csv: (j) => j.voucher_no },
    { key: 'type', header: 'Type', width: 130, render: (j) => <span className="text-ink2">{j.voucher_type.replace(/_/g, ' ')}</span>, sort: (j) => j.voucher_type, csv: (j) => j.voucher_type },
    { key: 'co', header: 'Company', width: 90, render: (j) => <span className="num text-[11.5px] text-muted" title={name(j.company_id)?.name}>{name(j.company_id)?.code}</span>, sort: (j) => name(j.company_id)?.code ?? '', csv: (j) => name(j.company_id)?.name },
    { key: 'narr', header: 'Narration', render: (j) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{j.narration ?? '—'}</span>
        {j.origin === 'ai_suggested' && <span className="chip violet flex-none" title="The classification was proposed by NUMI and approved by a person"><Sparkles size={10} /> NUMI draft</span>}
        {j.confidentiality !== 'internal' && <span className="chip gold flex-none">{j.confidentiality.replace(/_/g, ' ')}</span>}
      </span>
    ), csv: (j) => j.narration },
    { key: 'total', header: 'Amount', align: 'right', width: 150, render: (j) => <Money value={j.total} />, sort: (j) => Number(j.total), csv: (j) => String(j.total) },
    { key: 'status', header: 'Status', width: 120, render: (j) => <StatusChip status={j.status} />, sort: (j) => j.status, csv: (j) => j.status },
  ]

  const c = res.data?.counts
  return (
    <div>
      <PageHeader eyebrow="Journal engine" title="Journals & vouchers"
        subtitle="Every financial event ends as a balanced journal. Posted journals are permanent: they are corrected by reversal, never edited."
        actions={<>
          <button className="btn" onClick={() => nav('/entry')}><Wand2 size={15} /> Describe a transaction</button>
          <button className="btn primary" disabled={!can('journal.create')} title={can('journal.create') ? 'New journal (n)' : 'You are not authorised to create journals'} onClick={() => nav('/journals/new')}><FilePlus2 size={15} /> New journal</button>
        </>} />

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts', count: c?.draft }, { key: 'submitted', label: 'Awaiting approval', count: c?.submitted },
        { key: 'approved', label: 'Approved, not posted', count: c?.approved }, { key: 'posted', label: 'Posted' }, { key: 'reversed', label: 'Reversed' }, { key: 'other', label: 'Rejected / cancelled' },
      ]} />

      <Panel lit={false} className="overflow-hidden">
        {res.error ? <ErrorBox message={res.error} retry={res.reload} /> : !res.data ? <Loading rows={8} /> : (
          <DataTable columns={cols} rows={res.data.rows} rowKey={(j) => j.id} onRow={(j) => nav('/journals/' + j.id)} exportName="journal-register" totalCount={res.data.total}
            initialSort={{ key: 'date', dir: 'desc' }} maxHeight="calc(100vh - 330px)"
            toolbar={<>
              <div className="relative w-[280px] max-w-full">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input className="field sm pl-8" placeholder="Search narration or voucher number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search journals" />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" className="accent-[var(--gold)]" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} /> All dates</label>
              {!allDates && <span className="text-[11.5px] text-muted">{fmtDate(period.from)} – {fmtDate(to > today() ? today() : to)}</span>}
              {res.data.total > res.data.rows.length && <button className="btn sm" onClick={() => setLimit(limit + 1000)}>Load more ({(res.data.total - res.data.rows.length).toLocaleString()} remaining)</button>}
            </>}
            empty={{ title: 'No journals match', body: 'Change the period, the status tab or the search text.' }} />
        )}
      </Panel>
    </div>
  )
}
