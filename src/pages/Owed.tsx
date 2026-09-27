import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { CalendarClock, HandCoins, Receipt, Users } from 'lucide-react'
import type { ID } from '@/engine/types'
import { DEFAULT_BUCKETS } from '@/engine/reports'
import { useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { ageingTotals, openDocuments, sumBase, type OpenDoc } from '@/lib/data'
import { ZERO } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, ErrorBox, Explain, Loading, Money, PageHeader, Panel, Section, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type Side = 'in' | 'out'
type GroupBy = 'party' | 'document'
type HorizonKey = 'due' | 'd7' | 'd30'
type Filter = { kind: 'bucket'; key: string } | { kind: 'horizon'; key: HorizonKey } | null

const BUCKET_COLOR = ['var(--pos)', 'var(--cyan)', 'var(--gold)', 'var(--warn)', 'var(--violet)', 'var(--neg)']
const HORIZONS: { key: HorizonKey; label: string; sub: string; test: (daysOverdue: number) => boolean }[] = [
  { key: 'due', label: 'Due today or overdue', sub: 'should already have been paid, or falls due today', test: (n) => n >= 0 },
  { key: 'd7', label: 'Due in the next 7 days', sub: 'falls due from tomorrow to 7 days from now', test: (n) => n < 0 && n >= -7 },
  { key: 'd30', label: 'Due in the next 30 days', sub: 'falls due from tomorrow to 30 days from now; includes the next 7 days', test: (n) => n < 0 && n >= -30 },
]

interface PartyRow { id: ID; name: string; partyNo: string; types: string; count: number; buckets: Record<string, Decimal>; total: Decimal }

const foot = 'border-t border-line2 px-[14px] py-[10px]'

export default function Owed() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const side: Side = sp.get('side') === 'out' ? 'out' : 'in'
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const currency = useCurrency()
  const asOf = today()

  const [groupBy, setGroupBy] = useState<GroupBy>('party')
  const [filter, setFilter] = useState<Filter>(null)

  const main = useAsync(async () => {
    const [invoices, types] = await Promise.all([
      api.listInvoices({ companyIds: ids, docTypes: side === 'in' ? ['sales_invoice'] : ['purchase_bill'] }),
      api.listPartyTypes(),
    ])
    return { side, docs: openDocuments(invoices, asOf).filter((x) => x.side === side), types }
  }, [api, idsKey, side, asOf])

  // while the other side is loading the previous result is still in memory; never show it under the wrong heading
  const d = main.data && main.data.side === side ? main.data : undefined

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties])
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const partyName = (id: ID) => partyById.get(id)?.display_name ?? 'Party not shared with you'

  const all = d?.docs ?? []
  const total = sumBase(all)
  const byBucket = ageingTotals(all)
  const share = (v: Decimal) => (total.isZero() ? ZERO : v.div(total).times(100))

  const shown = all.filter((x) => {
    if (!filter) return true
    if (filter.kind === 'bucket') return x.bucket === filter.key
    return HORIZONS.find((h) => h.key === filter.key)!.test(x.daysOverdue)
  })
  const shownTotal = sumBase(shown)
  const shownBuckets = ageingTotals(shown)

  const partyRows: PartyRow[] = useMemo(() => {
    const typeName = new Map((d?.types ?? []).map((t) => [t.key, t.name]))
    const m = new Map<ID, PartyRow>()
    for (const x of shown) {
      const pid = x.invoice.party_id
      let row = m.get(pid)
      if (!row) {
        const p = partyById.get(pid)
        const names = [...new Set((p?.roles ?? []).filter((r) => ids.includes(r.company_id)).map((r) => typeName.get(r.type_key) ?? r.type_key.replace(/_/g, ' ')))]
        row = { id: pid, name: partyName(pid), partyNo: p?.party_no ?? '', types: names.join(', '), count: 0, buckets: Object.fromEntries(DEFAULT_BUCKETS.map((b) => [b.key, ZERO])), total: ZERO }
        m.set(pid, row)
      }
      row.count += 1
      row.buckets[x.bucket] = row.buckets[x.bucket].plus(x.outstandingBase)
      row.total = row.total.plus(x.outstandingBase)
    }
    return [...m.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, filter, partyById, idsKey])

  const toggle = (f: Exclude<Filter, null>) => setFilter((cur) => (cur && cur.kind === f.kind && cur.key === f.key ? null : f))
  const isOn = (f: Exclude<Filter, null>) => !!filter && filter.kind === f.kind && filter.key === f.key
  const filterLabel = !filter ? null : filter.kind === 'bucket' ? (() => { const b = DEFAULT_BUCKETS.find((x) => x.key === filter.key); return b ? (b.key === 'current' ? b.label : `${b.label} days overdue`) : filter.key })() : HORIZONS.find((h) => h.key === filter.key)!.label

  const partyColumns: Column<PartyRow>[] = [
    {
      key: 'party', header: 'Party', sort: (r) => r.name.toLowerCase(), csv: (r) => (r.partyNo ? r.name + ' (' + r.partyNo + ')' : r.name),
      render: (r) => <div className="min-w-0"><div className="truncate text-ink">{r.name}</div>{r.partyNo && <div className="num text-[11px] text-gold">{r.partyNo}</div>}</div>,
    },
    { key: 'type', header: 'Type', render: (r) => <span className="text-[12.5px] text-ink2">{r.types || '—'}</span>, sort: (r) => r.types, csv: (r) => r.types },
    { key: 'count', header: 'Documents', align: 'right', render: (r) => <span className="num">{r.count}</span>, sort: (r) => r.count, csv: (r) => r.count },
    ...DEFAULT_BUCKETS.map((b): Column<PartyRow> => ({
      key: b.key, header: b.label, align: 'right',
      render: (r) => (r.buckets[b.key].isZero() ? <span className="text-muted">—</span> : <Money value={r.buckets[b.key]} className={b.key === 'current' ? '' : 'text-ink'} />),
      sort: (r) => r.buckets[b.key].toNumber(), csv: (r) => r.buckets[b.key].toFixed(2),
    })),
    { key: 'total', header: 'Total', align: 'right', render: (r) => <Money value={r.total} className="font-medium text-ink" />, sort: (r) => r.total.toNumber(), csv: (r) => r.total.toFixed(2) },
  ]

  const docColumns: Column<OpenDoc>[] = [
    { key: 'no', header: side === 'in' ? 'Invoice no' : 'Bill no', render: (x) => <span className="num text-[12.5px] text-gold">{x.invoice.doc_no ?? '—'}</span>, sort: (x) => x.invoice.doc_no ?? '', csv: (x) => x.invoice.doc_no ?? '' },
    { key: 'party', header: 'Party', render: (x) => <button className="link text-left" onClick={(e) => { e.stopPropagation(); nav('/parties/' + x.invoice.party_id) }}>{partyName(x.invoice.party_id)}</button>, sort: (x) => partyName(x.invoice.party_id).toLowerCase(), csv: (x) => partyName(x.invoice.party_id) },
    { key: 'company', header: 'Company', render: (x) => <span className="text-ink2" title={companyById.get(x.invoice.company_id)?.name}>{companyById.get(x.invoice.company_id)?.code ?? '—'}</span>, sort: (x) => companyById.get(x.invoice.company_id)?.name ?? '', csv: (x) => companyById.get(x.invoice.company_id)?.name ?? '' },
    { key: 'date', header: 'Date', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.invoice.doc_date)}</span>, sort: (x) => x.invoice.doc_date, csv: (x) => x.invoice.doc_date },
    { key: 'due', header: 'Due date', render: (x) => <span className="num text-[12.5px] text-ink2">{fmtDate(x.invoice.due_date ?? x.invoice.doc_date)}</span>, sort: (x) => x.invoice.due_date ?? x.invoice.doc_date, csv: (x) => x.invoice.due_date ?? x.invoice.doc_date },
    {
      key: 'over', header: 'Days overdue', align: 'right', sort: (x) => x.daysOverdue, csv: (x) => x.daysOverdue,
      render: (x) => (x.daysOverdue > 0 ? <span className="num text-neg">{x.daysOverdue}</span> : x.daysOverdue === 0 ? <span className="text-[12px] text-warn">due today</span> : <span className="text-[12px] text-muted">due in {-x.daysOverdue} day{x.daysOverdue === -1 ? '' : 's'}</span>),
    },
    { key: 'status', header: 'Status', render: (x) => <span className={cx('chip', x.invoice.status === 'partially_paid' ? 'warn' : 'cyan')}>{x.invoice.status.replace(/_/g, ' ')}</span>, sort: (x) => x.invoice.status, csv: (x) => x.invoice.status },
    { key: 'out', header: 'Outstanding', align: 'right', render: (x) => <Money value={x.outstanding} currency={x.invoice.currency} />, sort: (x) => x.outstanding.toNumber(), csv: (x) => x.outstanding.toFixed(2) },
    { key: 'ccy', header: 'Currency', render: (x) => <span className="num text-[12px] text-muted">{x.invoice.currency}</span>, sort: (x) => x.invoice.currency, csv: (x) => x.invoice.currency },
    { key: 'base', header: `In ${currency}`, align: 'right', render: (x) => <Money value={x.outstandingBase} className="text-ink" />, sort: (x) => x.outstandingBase.toNumber(), csv: (x) => x.outstandingBase.toFixed(2) },
  ]

  const partiesCount = new Set(all.map((x) => x.invoice.party_id)).size
  const name = side === 'in' ? 'who-owes-us' : 'who-do-we-owe'

  return (
    <div>
      <PageHeader
        eyebrow="Party Universe"
        title={side === 'in' ? 'WHO OWES US MONEY?' : 'WHO DO WE OWE MONEY TO?'}
        truth="ACTUAL"
        subtitle={<>
          As at {fmtDate(asOf)} · {side === 'in' ? 'open and partly paid sales invoices' : 'open and partly paid purchase bills'} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · totals in {currency}
          {mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}
        </>}
        actions={<button className="btn" onClick={() => nav('/parties')}><Users size={14} /> People & Parties</button>}
      />

      <Tabs<Side>
        tabs={[{ key: 'in', label: 'Who owes us?' }, { key: 'out', label: 'Who do we owe?' }]}
        value={side}
        onChange={(k) => { setFilter(null); setSp({ side: k }, { replace: true }) }}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading outstanding documents" /></Panel>}

      {d && (
        <>
          <Panel className="mb-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="eyebrow">{side === 'in' ? 'Total receivable outstanding' : 'Total payable outstanding'}</span>
                  <Explain title={side === 'in' ? 'Total receivable outstanding' : 'Total payable outstanding'}
                    text={side === 'in' ? 'The unpaid part of every open or partly paid sales invoice, converted to the base currency at each invoice\'s own rate.' : 'The unpaid part of every open or partly paid purchase bill, converted to the base currency at each bill\'s own rate.'}
                    formula="Σ (document total − amount settled) × exchange rate" inputs={[{ label: 'Total outstanding', value: total }]}
                    source="Source: approved documents recorded for the selected companies. Age is counted from the due date, or the document date when no due date is set." />
                </div>
                <Money value={total} className="mt-1 block text-[28px] leading-none" />
                <div className="mt-1.5 text-[12px] text-muted"><span className="num text-ink2">{all.length.toLocaleString()}</span> open document{all.length === 1 ? '' : 's'} from <span className="num text-ink2">{partiesCount.toLocaleString()}</span> part{partiesCount === 1 ? 'y' : 'ies'}</div>
              </div>
              {filter && <button className="btn sm" onClick={() => setFilter(null)}>Showing: {filterLabel} — clear</button>}
            </div>

            {all.length > 0 && (
              <div className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface2" role="group" aria-label="Ageing of the outstanding amount">
                {DEFAULT_BUCKETS.map((b, i) => {
                  const v = byBucket[b.key]
                  if (!v.gt(0)) return null
                  const on = isOn({ kind: 'bucket', key: b.key })
                  return (
                    <button key={b.key} onClick={() => toggle({ kind: 'bucket', key: b.key })}
                      aria-label={`${b.label}: ${share(v).toFixed(1)} percent of the total. Click to filter.`} aria-pressed={on} title={`${b.label} · ${share(v).toFixed(1)}%`}
                      className="h-full min-w-[4px] transition-opacity" style={{ width: `${share(v).toNumber()}%`, background: BUCKET_COLOR[i % BUCKET_COLOR.length], opacity: filter?.kind === 'bucket' && !on ? 0.3 : 0.92 }} />
                  )
                })}
              </div>
            )}

            <div className="stagger mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {DEFAULT_BUCKETS.map((b, i) => {
                const v = byBucket[b.key]
                const n = all.filter((x) => x.bucket === b.key).length
                const on = isOn({ kind: 'bucket', key: b.key })
                return (
                  <Panel key={b.key} lit={false} className={cx('p-3.5', on && 'border-gold/50')} onClick={() => toggle({ kind: 'bucket', key: b.key })} title={on ? 'Click to clear this filter' : 'Click to show only this age band'}>
                    <div className="flex items-center gap-2"><i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: BUCKET_COLOR[i % BUCKET_COLOR.length] }} /><span className="eyebrow truncate">{b.key === 'current' ? b.label : `${b.label} days`}</span></div>
                    <Money value={v} compact className={cx('mt-2 block text-[18px] leading-none', v.isZero() && 'text-muted')} />
                    <div className="mt-1.5 text-[11px] text-muted"><span className="num text-ink2">{share(v).toFixed(1)}%</span> · {n} document{n === 1 ? '' : 's'}</div>
                  </Panel>
                )
              })}
            </div>
          </Panel>

          {side === 'out' && (
            <Section title="Time horizon — when the money falls due" className="mb-4">
              <div className="stagger grid gap-3 md:grid-cols-3">
                {HORIZONS.map((h) => {
                  const list = all.filter((x) => h.test(x.daysOverdue))
                  const v = sumBase(list)
                  const on = isOn({ kind: 'horizon', key: h.key })
                  return (
                    <Panel key={h.key} className={cx('p-4', on && 'border-gold/50')} onClick={() => toggle({ kind: 'horizon', key: h.key })} attention={h.key === 'due' && v.gt(0)} title={on ? 'Click to clear this filter' : 'Click to show only these bills'}>
                      <div className="flex items-center gap-2 text-muted"><span className={h.key === 'due' && v.gt(0) ? 'text-neg' : 'text-gold'}><CalendarClock size={16} /></span><span className="eyebrow truncate">{h.label}</span></div>
                      <Money value={v} compact className={cx('mt-2.5 block text-[21px] leading-none', h.key === 'due' && v.gt(0) && 'text-neg')} />
                      <div className="mt-2 text-[11px] leading-snug text-muted"><span className="num text-ink2">{list.length}</span> bill{list.length === 1 ? '' : 's'} · {h.sub}</div>
                    </Panel>
                  )
                })}
              </div>
            </Section>
          )}

          <Panel lit={false}>
            {groupBy === 'party' ? (
              <DataTable
                key={'party-' + side}
                columns={partyColumns}
                rows={partyRows}
                rowKey={(r) => r.id}
                onRow={(r) => nav('/parties/' + r.id)}
                exportName={`${name}-by-party`}
                initialSort={{ key: 'total', dir: 'desc' }}
                toolbar={<GroupSwitch value={groupBy} onChange={setGroupBy} note={filterLabel} />}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Total · {partyRows.length.toLocaleString()} part{partyRows.length === 1 ? 'y' : 'ies'}</td>
                  <td className={cx(foot, 'r num')}>{shown.length.toLocaleString()}</td>
                  {DEFAULT_BUCKETS.map((b) => <td key={b.key} className={cx(foot, 'r')}><Money value={shownBuckets[b.key]} dim /></td>)}
                  <td className={cx(foot, 'r')}><Money value={shownTotal} className="font-medium text-ink" /></td>
                </tr>}
                empty={{
                  title: filter ? 'Nothing in this band' : side === 'in' ? 'Nobody owes us money' : 'We owe nothing',
                  body: filter ? 'No outstanding document falls in the selected band. Clear the filter to see everything.' : side === 'in' ? 'There is no open or partly paid sales invoice in the selected companies.' : 'There is no open or partly paid purchase bill in the selected companies.',
                  icon: side === 'in' ? <HandCoins size={20} /> : <Receipt size={20} />,
                  action: filter ? <button className="btn sm" onClick={() => setFilter(null)}>Clear filter</button> : undefined,
                }}
              />
            ) : (
              <DataTable
                key={'doc-' + side}
                columns={docColumns}
                rows={shown}
                rowKey={(x) => x.invoice.id}
                onRow={(x) => nav((x.invoice.doc_type === 'sales_invoice' ? '/invoices/' : '/bills/') + x.invoice.id)}
                exportName={`${name}-by-document`}
                initialSort={{ key: 'over', dir: 'desc' }}
                toolbar={<GroupSwitch value={groupBy} onChange={setGroupBy} note={filterLabel} />}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={9}>Total · {shown.length.toLocaleString()} document{shown.length === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r')}><Money value={shownTotal} className="font-medium text-ink" /></td>
                </tr>}
                empty={{
                  title: filter ? 'Nothing in this band' : 'No outstanding documents',
                  body: filter ? 'No outstanding document falls in the selected band. Clear the filter to see everything.' : 'Every document in the selected companies is settled.',
                  icon: <Receipt size={20} />,
                  action: filter ? <button className="btn sm" onClick={() => setFilter(null)}>Clear filter</button> : undefined,
                }}
              />
            )}
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">
            Amounts in a foreign currency are converted at the rate recorded on each document. Receivables and payables of the same party are never netted against each other here.
          </div>
        </>
      )}
    </div>
  )
}

function GroupSwitch({ value, onChange, note }: { value: GroupBy; onChange: (g: GroupBy) => void; note: string | null }) {
  const options: [GroupBy, string][] = [['party', 'By party'], ['document', 'By document']]
  return (
    <>
      <div className="flex items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label="Group the list">
        {options.map(([k, l]) => (
          <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} className={cx('h-[26px] rounded-lg px-3 text-[11.5px] font-medium transition-colors', value === k ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{l}</button>
        ))}
      </div>
      {note && <span className="chip gold">{note}</span>}
    </>
  )
}
