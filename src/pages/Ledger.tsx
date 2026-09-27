import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookText, Lock, Search, X } from 'lucide-react'
import { useApp, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { LedgerLine } from '@/engine/types'
import { D, ZERO } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, ErrorBox, Explain, Loading, Money, Note, PageHeader, Panel, StatusChip, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

/** General ledger. Every report figure in NUMERO drills down to this screen, and every line here opens its voucher. */
export default function Ledger() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const companies = useApp((s) => s.companies)
  const asOf = useApp((s) => s.asOf)
  const knownAt = useApp((s) => s.knownAt)
  const ids = useScopeIds()
  const period = usePeriod()
  const [limit, setLimit] = useState(300)
  const [q, setQ] = useState(sp.get('q') ?? '')

  const accIds = useMemo(() => (sp.get('accounts') ?? '').split(',').filter(Boolean), [sp])
  const party = sp.get('party') ?? ''
  const unit = sp.get('unit') ?? ''
  const min = sp.get('min') ?? ''
  const hasLinkDates = sp.has('from') || sp.has('to')
  const from = sp.get('from') ?? (accIds.length || party || unit ? (hasLinkDates ? '' : period.from) : period.from)
  const to = asOf ?? sp.get('to') ?? (period.to > today() ? today() : period.to)

  useEffect(() => { setLimit(300) }, [sp])
  useEffect(() => {
    const h = setTimeout(() => { const n = new URLSearchParams(sp); if (q.trim()) n.set('q', q.trim()); else n.delete('q'); if (n.toString() !== sp.toString()) setSp(n, { replace: true }) }, 300)
    return () => clearTimeout(h)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }
  const scopeAccs = useMemo(() => accounts.filter((a) => ids.includes(a.company_id) && !a.is_group).sort((a, b) => a.code.localeCompare(b.code)), [accounts, ids])
  const selected = accounts.filter((a) => accIds.includes(a.id))

  const res = useAsync(async () => {
    const [lines, bal] = await Promise.all([
      api.ledgerLines({ company_ids: ids, account_ids: accIds.length ? accIds : undefined, party_id: party || undefined, org_unit_id: unit || undefined, from: from || undefined, to, q: sp.get('q') ?? undefined, min_amount: min ? Number(min) : undefined, known_at: knownAt ?? undefined, limit, offset: 0 }),
      accIds.length && !party && !unit && !min && !sp.get('q') ? api.ledgerBalances(ids, from || '1990-01-01', to, { knownAt: knownAt ?? undefined }) : Promise.resolve(null),
    ])
    const opening = bal ? bal.filter((r) => accIds.includes(r.account_id)).reduce((s, r) => s.plus(r.opening_debit).minus(r.opening_credit), ZERO) : null
    return { lines, opening }
  }, [api, ids.join(','), accIds.join(','), party, unit, from, to, sp.get('q'), min, knownAt, limit])

  const d = res.data
  const movement = d ? D(d.lines.sum_debit).minus(d.lines.sum_credit).plus(d.lines.restricted.debit).minus(d.lines.restricted.credit) : ZERO
  const closing = d?.opening != null ? d.opening.plus(movement) : null
  const singleAccount = accIds.length === 1 && d?.opening != null && d.lines.rows.length === d.lines.total && d.lines.restricted.count === 0

  // running balance is only meaningful for one ledger, in date order, with every line loaded
  const running = useMemo(() => {
    const m = new Map<string, string>()
    if (!singleAccount || !d) return m
    let run = d.opening!
    for (const l of [...d.lines.rows].reverse()) { run = run.plus(l.debit).minus(l.credit); m.set(l.id, run.toString()) }
    return m
  }, [d, singleAccount])

  const co = (id: string) => companies.find((c) => c.id === id)
  const cols: Column<LedgerLine>[] = [
    { key: 'date', header: 'Date', width: 108, render: (l) => <span className="num text-ink2">{fmtDate(l.journal_date)}</span>, csv: (l) => l.journal_date },
    { key: 'voucher', header: 'Voucher', width: 148, render: (l) => <span className="num text-gold">{l.voucher_no}</span>, csv: (l) => l.voucher_no },
    ...(ids.length > 1 ? [{ key: 'co', header: 'Co.', width: 70, render: (l: LedgerLine) => <span className="num text-[11.5px] text-muted" title={l.company_name}>{co(l.company_id)?.code}</span>, csv: (l: LedgerLine) => l.company_name }] : []),
    ...(accIds.length === 1 ? [] : [{ key: 'acc', header: 'Ledger', render: (l: LedgerLine) => <span className="drill" onClick={(e: React.MouseEvent) => { e.stopPropagation(); patch('accounts', l.account_id) }}><span className="num text-[11.5px] text-muted">{l.account_code}</span> {l.account_name}</span>, csv: (l: LedgerLine) => `${l.account_code} ${l.account_name}` }]),
    { key: 'narr', header: 'Narration', render: (l) => <div className="min-w-0"><div className="truncate">{l.narration ?? l.description}</div>{l.description && l.description !== l.narration && <div className="truncate text-[11.5px] text-muted">{l.description}</div>}</div>, csv: (l) => l.narration ?? l.description },
    { key: 'party', header: 'Party', render: (l) => l.party_id ? <span className="drill" onClick={(e) => { e.stopPropagation(); nav('/parties/' + l.party_id) }}>{l.party_name}</span> : <span className="text-muted">—</span>, csv: (l) => l.party_name },
    { key: 'dr', header: 'Debit', align: 'right', width: 140, render: (l) => (D(l.debit).isZero() ? '' : <Money value={l.debit} />), csv: (l) => String(l.debit) },
    { key: 'cr', header: 'Credit', align: 'right', width: 140, render: (l) => (D(l.credit).isZero() ? '' : <Money value={l.credit} />), csv: (l) => String(l.credit) },
    ...(singleAccount ? [{ key: 'bal', header: 'Balance', align: 'right' as const, width: 150, render: (l: LedgerLine) => { const v = D(running.get(l.id)); return <span className="num">{<Money value={v.abs()} />} <span className="text-[10.5px] text-muted">{v.gte(0) ? 'Dr' : 'Cr'}</span></span> }, csv: (l: LedgerLine) => running.get(l.id) ?? '' }] : []),
    { key: 'st', header: '', width: 96, render: (l) => (l.status === 'reversed' ? <StatusChip status="reversed" /> : l.voucher_type === 'reversal' ? <span className="chip violet">reversal</span> : null) },
  ]

  const title = selected.length === 1 ? `${selected[0].code} · ${selected[0].name}` : selected.length > 1 ? `${selected.length} ledgers` : party ? parties.find((p) => p.id === party)?.display_name ?? 'Party ledger' : unit ? orgUnits.find((u) => u.id === unit)?.name ?? 'Tagged entries' : 'General ledger'

  return (
    <div>
      <PageHeader eyebrow="General ledger" title={title} truth="ACTUAL"
        subtitle={<>{from ? fmtDate(from) : 'From the beginning'} – {fmtDate(to)} · only posted entries appear here · click any line to open its voucher</>}
        actions={<Explain title="General ledger" text="The general ledger is the complete record of every posted accounting entry. Each line is one side of a balanced journal. Figures in every NUMERO report are built from these lines, and clicking a report figure brings you here." />} />

      <Panel className="mb-4 p-4" lit={false}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_150px_150px_130px_1fr]">
          <label><span className="label">Ledger account</span>
            <select className="field sm" value={accIds.length === 1 ? accIds[0] : ''} onChange={(e) => patch('accounts', e.target.value)}>
              <option value="">{accIds.length > 1 ? `${accIds.length} ledgers selected` : 'All ledgers'}</option>
              {(['asset', 'liability', 'equity', 'income', 'expense'] as const).map((t) => (
                <optgroup key={t} label={t.toUpperCase()}>{scopeAccs.filter((a) => a.type === t).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{ids.length > 1 ? ` — ${co(a.company_id)?.code}` : ''}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <label><span className="label">Party</span>
            <select className="field sm" value={party} onChange={(e) => patch('party', e.target.value)}>
              <option value="">Any party</option>
              {parties.filter((p) => p.roles.some((r) => ids.includes(r.company_id))).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </label>
          <label><span className="label">From</span><input type="date" className="field sm" value={from} max={to} onChange={(e) => patch('from', e.target.value)} /></label>
          <label><span className="label">To</span><input type="date" className="field sm" value={to} disabled={Boolean(asOf)} onChange={(e) => patch('to', e.target.value)} /></label>
          <label><span className="label">Amount at least</span><input className="field sm num" inputMode="decimal" value={min} onChange={(e) => patch('min', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></label>
          <label><span className="label">Search</span>
            <div className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="field sm pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Narration or voucher number" /></div>
          </label>
        </div>
        {(selected.length > 1 || unit || party || min || accIds.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {selected.length > 1 && selected.map((a) => <span key={a.id} className="chip gold">{a.code} {a.name}<button className="ml-0.5" style={{ border: 0, background: 'none' }} onClick={() => patch('accounts', accIds.filter((x) => x !== a.id).join(','))} aria-label={`Remove ${a.name}`}><X size={11} /></button></span>)}
            {unit && <span className="chip cyan">Tag: {orgUnits.find((u) => u.id === unit)?.name}<button className="ml-0.5" style={{ border: 0, background: 'none' }} onClick={() => patch('unit', '')} aria-label="Remove tag filter"><X size={11} /></button></span>}
            <button className="btn sm ghost" onClick={() => { setQ(''); setSp(new URLSearchParams(), { replace: true }) }}>Clear all filters</button>
          </div>
        )}
      </Panel>

      {d && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Opening balance', d.opening, 'Balance of the selected ledgers before the start date.'],
            ['Debits in period', D(d.lines.sum_debit).plus(d.lines.restricted.debit), 'Total of all debit lines in the filter, including restricted entries.'],
            ['Credits in period', D(d.lines.sum_credit).plus(d.lines.restricted.credit), 'Total of all credit lines in the filter, including restricted entries.'],
            ['Closing balance', closing, 'Opening balance plus debits less credits.'],
          ].map(([l, v, tip]) => (
            <Panel key={String(l)} className="p-3.5" lit={false} title={String(tip)}>
              <div className="eyebrow">{String(l)}</div>
              {v === null ? <div className="mt-1 text-[12px] text-muted">Shown when ledgers are selected without other filters</div>
                : <div className="mt-1 text-[17px]"><Money value={D(v as never).abs()} /> {(l === 'Opening balance' || l === 'Closing balance') && <span className="text-[11px] text-muted">{D(v as never).gte(0) ? 'Dr' : 'Cr'}</span>}</div>}
            </Panel>
          ))}
        </div>
      )}

      {d && d.lines.restricted.count > 0 && (
        <Note kind="warn" className="mb-4">
          <span className="inline-flex items-center gap-1.5"><Lock size={13} /> <b>{d.lines.restricted.count}</b> entr{d.lines.restricted.count === 1 ? 'y' : 'ies'} totalling <Money value={D(d.lines.restricted.debit).plus(d.lines.restricted.credit)} /> relate to restricted transactions that your account is not authorised to view.</span> They are included in the totals above so that this ledger still agrees with the financial statements.
        </Note>
      )}

      <Panel lit={false} className="overflow-hidden">
        {res.error ? <ErrorBox message={res.error} retry={res.reload} /> : !d ? <Loading rows={9} /> : (
          <DataTable columns={cols} rows={d.lines.rows} rowKey={(l) => l.id} onRow={(l) => nav('/journals/' + l.journal_id)} exportName="general-ledger" totalCount={d.lines.total} pageSize={100} maxHeight="calc(100vh - 300px)"
            rowClass={(l) => (l.status === 'reversed' || l.voucher_type === 'reversal' ? 'opacity-60' : undefined)}
            toolbar={<>
              <BookText size={15} className="text-gold" />
              <span className="text-[12.5px] text-ink2"><span className="num text-ink">{d.lines.total.toLocaleString()}</span> posted line{d.lines.total === 1 ? '' : 's'}</span>
              <Truth state="ACTUAL" />
              {d.lines.total > d.lines.rows.length && <button className="btn sm" onClick={() => setLimit(Math.min(1000, limit + 400))} disabled={limit >= 1000}>{limit >= 1000 ? 'Narrow the filter to see the rest' : `Load more (${(d.lines.total - d.lines.rows.length).toLocaleString()} remaining)`}</button>}
              {accIds.length === 1 && !singleAccount && d.lines.total > 0 && <span className={cx('text-[11.5px] text-muted')}>Running balance appears when every line of one ledger is loaded without other filters.</span>}
            </>}
            empty={{ title: 'No posted entries match', body: 'Widen the date range or clear the filters. Drafts and entries awaiting approval do not appear in the ledger.' }} />
        )}
      </Panel>
    </div>
  )
}
