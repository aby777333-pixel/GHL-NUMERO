import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowUpRight, Building2, Network } from 'lucide-react'
import type { NumeroApi } from '@/api/types'
import type { ID, LedgerFilter, LedgerLine, LedgerLinesResult } from '@/engine/types'
import { joinBalances } from '@/engine/reports'
import { useApp, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Loading, Money, Note, PageHeader, Panel, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { FlowMap, type FlowLink, type FlowNode } from '@/ui/charts'

type View = 'out' | 'in' | 'ic'
type Sign = 'out' | 'in' | 'dr'
const PAGE = 1000
const CAP = 5000
const TOP_CATEGORIES = 8
const TOP_PARTIES = 10

type NodeMeta =
  | { kind: 'company'; companyId: ID }
  | { kind: 'category'; accountIds: ID[] }
  | { kind: 'party'; partyId: ID }
  | { kind: 'bucket' }

interface Graph {
  nodes: FlowNode[]
  links: FlowLink[]
  nodeLines: Map<string, LedgerLine[]>
  linkLines: Map<string, LedgerLine[]>
  meta: Map<string, NodeMeta>
  total: Decimal
  /** lines on the opposite side (refunds, reversals) which are not drawn as flows */
  contra: { count: number; amount: Decimal }
}

interface Selection {
  title: string
  subtitle: string
  total: Decimal
  sign: Sign
  lines?: LedgerLine[]
  filter?: LedgerFilter
  meta: NodeMeta | null
}

const amountOf = (l: LedgerLine, sign: Sign) => (sign === 'in' ? D(l.credit).minus(D(l.debit)) : D(l.debit).minus(D(l.credit)))

async function fetchAll(api: NumeroApi, f: LedgerFilter): Promise<{ rows: LedgerLine[]; total: number; restricted: LedgerLinesResult['restricted'] }> {
  const first = await api.ledgerLines({ ...f, limit: PAGE, offset: 0 })
  const rows = [...first.rows]
  while (rows.length < first.total && rows.length < CAP) {
    const next = await api.ledgerLines({ ...f, limit: Math.min(PAGE, CAP - rows.length), offset: rows.length })
    if (!next.rows.length) break
    rows.push(...next.rows)
  }
  return { rows, total: first.total, restricted: first.restricted }
}

function buildFlow(rows: LedgerLine[], dir: 'out' | 'in'): Graph {
  const type = dir === 'out' ? 'expense' : 'income'
  const used: { line: LedgerLine; amt: Decimal }[] = []
  let contraCount = 0
  let contraAmount = ZERO
  for (const line of rows) {
    if (line.account_type !== type) continue
    const amt = amountOf(line, dir)
    if (amt.gt(0)) used.push({ line, amt })
    else if (amt.lt(0)) { contraCount++; contraAmount = contraAmount.plus(amt.abs()) }
  }

  const add = (m: Map<string, Decimal>, k: string, v: Decimal) => m.set(k, (m.get(k) ?? ZERO).plus(v))
  const catTotals = new Map<string, Decimal>()
  const partyTotals = new Map<string, Decimal>()
  for (const { line, amt } of used) {
    add(catTotals, line.account_name, amt)
    if (line.party_id) add(partyTotals, line.party_id, amt)
  }
  const top = (m: Map<string, Decimal>, n: number) => new Set([...m.entries()].sort((a, b) => b[1].cmp(a[1])).slice(0, n).map(([k]) => k))
  const topCats = top(catTotals, TOP_CATEGORIES)
  const topParties = top(partyTotals, TOP_PARTIES)

  const colCompany = dir === 'out' ? 0 : 2
  const colParty = dir === 'out' ? 2 : 0
  const values = new Map<string, Decimal>()
  const labels = new Map<string, { label: string; column: number; tone: string }>()
  const meta = new Map<string, NodeMeta>()
  const nodeLines = new Map<string, LedgerLine[]>()
  const linkLines = new Map<string, LedgerLine[]>()
  const linkValues = new Map<string, { from: string; to: string; value: Decimal }>()
  const catAccounts = new Map<string, Set<ID>>()
  let total = ZERO

  const touch = (id: string, label: string, column: number, tone: string, m: NodeMeta, line: LedgerLine, amt: Decimal) => {
    if (!labels.has(id)) { labels.set(id, { label, column, tone }); meta.set(id, m); nodeLines.set(id, []) }
    add(values, id, amt)
    nodeLines.get(id)!.push(line)
  }
  const link = (from: string, to: string, line: LedgerLine, amt: Decimal) => {
    const k = from + '>' + to
    const cur = linkValues.get(k)
    if (cur) cur.value = cur.value.plus(amt)
    else { linkValues.set(k, { from, to, value: amt }); linkLines.set(k, []) }
    linkLines.get(k)!.push(line)
  }

  for (const { line, amt } of used) {
    total = total.plus(amt)
    const co = 'co:' + line.company_id
    const inTop = topCats.has(line.account_name)
    const cat = inTop ? 'cat:' + line.account_name : 'cat:__other'
    const party = !line.party_id ? 'pt:__none' : topParties.has(line.party_id) ? 'pt:' + line.party_id : 'pt:__other'

    touch(co, line.company_name, colCompany, 'var(--gold)', { kind: 'company', companyId: line.company_id }, line, amt)
    if (inTop) {
      const set = catAccounts.get(cat) ?? new Set<ID>()
      set.add(line.account_id)
      catAccounts.set(cat, set)
    }
    touch(cat, inTop ? line.account_name : 'Other categories', 1, inTop ? 'var(--cyan)' : 'var(--muted)', inTop ? { kind: 'category', accountIds: [] } : { kind: 'bucket' }, line, amt)
    touch(party, party === 'pt:__none' ? 'No party recorded' : party === 'pt:__other' ? 'Other parties' : line.party_name ?? 'Unnamed party', colParty,
      line.party_id && party !== 'pt:__other' ? 'var(--violet)' : 'var(--muted)', line.party_id && party !== 'pt:__other' ? { kind: 'party', partyId: line.party_id } : { kind: 'bucket' }, line, amt)

    if (dir === 'out') { link(co, cat, line, amt); link(cat, party, line, amt) }
    else { link(party, cat, line, amt); link(cat, co, line, amt) }
  }
  for (const [id, set] of catAccounts) meta.set(id, { kind: 'category', accountIds: [...set] })

  return {
    nodes: [...labels.entries()].map(([id, l]) => ({ id, label: l.label, column: l.column, tone: l.tone, value: (values.get(id) ?? ZERO).toNumber() })),
    links: [...linkValues.values()].map((l) => ({ from: l.from, to: l.to, value: l.value.toNumber() })),
    nodeLines, linkLines, meta, total, contra: { count: contraCount, amount: contraAmount },
  }
}

export default function MoneyMap() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const setScope = useApp((s) => s.setScope)
  const ids = useScopeIds()
  const period = usePeriod()
  const [view, setView] = useState<View>('out')
  const [sel, setSel] = useState<Selection | null>(null)

  const from = period.from
  const to = period.to
  const nameOf = (id: ID) => companies.find((c) => c.id === id)?.name ?? 'Group company outside your access'

  const flow = useAsync(async () => {
    if (view === 'ic') return null
    const type = view === 'out' ? 'expense' : 'income'
    const accountIds = accounts.filter((a) => ids.includes(a.company_id) && a.type === type && !a.is_group).map((a) => a.id)
    if (!ids.length || !accountIds.length) return { rows: [] as LedgerLine[], total: 0, restricted: { count: 0, debit: 0, credit: 0 } as LedgerLinesResult['restricted'] }
    return fetchAll(api, { company_ids: ids, account_ids: accountIds, from, to })
  }, [api, view, ids.join(','), from, to, accounts.length])

  const ic = useAsync(async () => {
    if (view !== 'ic') return null
    const all = companies.map((c) => c.id)
    const icAccounts = accounts.filter((a) => a.control_type === 'intercompany' && a.counterparty_company_id)
    if (!all.length || !icAccounts.length) return []
    const rows = await api.ledgerBalances(all, '1990-01-01', today())
    return joinBalances(icAccounts, rows).filter((b) => b.account.type === 'asset' && b.closing.gt(0))
  }, [api, view, companies.length, accounts.length])

  const graph = useMemo(() => (flow.data && view !== 'ic' ? buildFlow(flow.data.rows, view) : null), [flow.data, view])

  const icGraph = useMemo(() => {
    if (!ic.data) return null
    const values = new Map<string, Decimal>()
    const links = new Map<string, { from: string; to: string; value: Decimal; accounts: ID[]; owners: ID[] }>()
    const nodeAccounts = new Map<string, { accounts: ID[]; owners: ID[]; companyId: ID }>()
    let total = ZERO
    const bump = (id: string, companyId: ID, account: ID, owner: ID, v: Decimal) => {
      values.set(id, (values.get(id) ?? ZERO).plus(v))
      const n = nodeAccounts.get(id) ?? { accounts: [], owners: [], companyId }
      n.accounts.push(account)
      if (!n.owners.includes(owner)) n.owners.push(owner)
      nodeAccounts.set(id, n)
    }
    for (const b of ic.data) {
      const debtor = b.account.counterparty_company_id!
      const owner = b.account.company_id
      const a = 'by:' + debtor, z = 'to:' + owner
      total = total.plus(b.closing)
      bump(a, debtor, b.account.id, owner, b.closing)
      bump(z, owner, b.account.id, owner, b.closing)
      const k = a + '>' + z
      const cur = links.get(k)
      if (cur) { cur.value = cur.value.plus(b.closing); cur.accounts.push(b.account.id) }
      else links.set(k, { from: a, to: z, value: b.closing, accounts: [b.account.id], owners: [owner] })
    }
    const nodes: FlowNode[] = [...values.entries()].map(([id, v]) => ({ id, label: nameOf(nodeAccounts.get(id)!.companyId), column: id.startsWith('by:') ? 0 : 1, value: v.toNumber(), tone: id.startsWith('by:') ? 'var(--warn)' : 'var(--gold)' }))
    return { nodes, links: [...links.values()], values, nodeAccounts, total }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ic.data, companies])

  const columns = view === 'out' ? ['Company', 'Category', 'Party'] : view === 'in' ? ['Party', 'Revenue type', 'Company'] : ['Owed by', 'Owed to']
  const periodText = `${fmtDate(from)} – ${to > '2900' ? 'today' : fmtDate(to)}`

  const openNode = (n: FlowNode) => {
    if (view === 'ic') {
      const info = icGraph?.nodeAccounts.get(n.id)
      if (!info) return
      setSel({
        title: n.label, subtitle: n.id.startsWith('by:') ? 'Owes other group companies — entries in their intercompany receivable ledgers' : 'Is owed by other group companies — entries in its intercompany receivable ledgers',
        total: icGraph!.values.get(n.id) ?? ZERO, sign: 'dr', filter: { company_ids: info.owners, account_ids: info.accounts, to: today() },
        meta: companies.some((c) => c.id === info.companyId) ? { kind: 'company', companyId: info.companyId } : null,
      })
      return
    }
    if (!graph) return
    const lines = graph.nodeLines.get(n.id) ?? []
    setSel({ title: n.label, subtitle: `${view === 'out' ? 'Money out' : 'Money in'} · ${periodText}`, total: lines.reduce((s, l) => s.plus(amountOf(l, view)), ZERO), sign: view, lines, meta: graph.meta.get(n.id) ?? null })
  }

  const openLink = (l: FlowLink) => {
    const k = l.from + '>' + l.to
    if (view === 'ic') {
      const link = icGraph?.links.find((x) => x.from === l.from && x.to === l.to)
      if (!link) return
      const a = icGraph!.nodes.find((n) => n.id === l.from)?.label ?? ''
      const z = icGraph!.nodes.find((n) => n.id === l.to)?.label ?? ''
      setSel({ title: `${a} → ${z}`, subtitle: 'Intercompany balance outstanding — entries in the receivable ledger', total: link.value, sign: 'dr', filter: { company_ids: link.owners, account_ids: link.accounts, to: today() }, meta: null })
      return
    }
    if (!graph) return
    const lines = graph.linkLines.get(k) ?? []
    const a = graph.nodes.find((n) => n.id === l.from)?.label ?? ''
    const z = graph.nodes.find((n) => n.id === l.to)?.label ?? ''
    setSel({ title: `${a} → ${z}`, subtitle: `${view === 'out' ? 'Money out' : 'Money in'} · ${periodText}`, total: lines.reduce((s, x) => s.plus(amountOf(x, view)), ZERO), sign: view, lines, meta: null })
  }

  const loading = view === 'ic' ? ic.loading && !ic.data : flow.loading && !flow.data
  const error = view === 'ic' ? ic.error : flow.error
  const retry = view === 'ic' ? ic.reload : flow.reload
  const nodes = view === 'ic' ? icGraph?.nodes ?? [] : graph?.nodes ?? []
  const links: FlowLink[] = view === 'ic' ? (icGraph?.links ?? []).map((l) => ({ from: l.from, to: l.to, value: l.value.toNumber() })) : graph?.links ?? []
  const total = view === 'ic' ? icGraph?.total ?? ZERO : graph?.total ?? ZERO
  const capped = view !== 'ic' && flow.data ? flow.data.rows.length < flow.data.total : false
  const restricted = view !== 'ic' ? flow.data?.restricted : undefined
  const restrictedNet = restricted ? (view === 'in' ? D(restricted.credit).minus(D(restricted.debit)) : D(restricted.debit).minus(D(restricted.credit))) : ZERO
  const tallest = Math.max(1, ...columns.map((_, c) => nodes.filter((n) => n.column === c).length))

  return (
    <div>
      <PageHeader
        eyebrow="Money Graph"
        title="Financial Command Map"
        truth="ACTUAL"
        subtitle={view === 'ic'
          ? <>Intercompany balances outstanding as at {fmtDate(today())}, across every company you are authorised to see.</>
          : <>{period.label} · {periodText} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · built from posted ledger entries</>}
        actions={<>
          {mode === 'demo' && <Truth state="DEMO" />}
          <div className="flex items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label="Map view">
            {([['out', 'Money out'], ['in', 'Money in'], ['ic', 'Intercompany']] as [View, string][]).map(([k, l]) => (
              <button key={k} onClick={() => { setView(k); setSel(null) }} aria-pressed={view === k} className={cx('h-[28px] rounded-lg px-3 text-[11.5px] font-medium transition-colors', view === k ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{l}</button>
            ))}
          </div>
        </>}
      />

      {error && <ErrorBox message={error} retry={retry} />}
      {loading && <Panel><Loading rows={7} label="Reading ledger entries" /></Panel>}

      {!loading && !error && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="eyebrow">{view === 'out' ? 'Total money out in view' : view === 'in' ? 'Total money in in view' : 'Total intercompany receivable in view'}</div>
              <div className="mt-1 flex items-center gap-2.5"><Money value={total} className="text-[22px]" /><Truth state="ACTUAL" /></div>
            </div>
            {view !== 'ic' && flow.data && <div className="text-[12px] text-muted"><span className="num text-ink2">{flow.data.rows.length.toLocaleString()}</span> ledger entr{flow.data.rows.length === 1 ? 'y' : 'ies'} read</div>}
          </div>

          {capped && flow.data && (
            <Note kind="warn" className="mb-3">
              This map includes the most recent <span className="num">{flow.data.rows.length.toLocaleString()}</span> of <span className="num">{flow.data.total.toLocaleString()}</span> entries. The remaining <span className="num">{(flow.data.total - flow.data.rows.length).toLocaleString()}</span> are not drawn, so the totals shown are incomplete. Choose a shorter period or fewer companies to see everything.
            </Note>
          )}
          {restricted && restricted.count > 0 && (
            <Note kind="warn" className="mb-3">
              <span className="num">{restricted.count.toLocaleString()}</span> entr{restricted.count === 1 ? 'y' : 'ies'} totalling <Money value={restrictedNet} /> relate to restricted transactions that your account is not authorised to view. They are excluded from the map and from the detail.
            </Note>
          )}
          {graph && graph.contra.count > 0 && view !== 'ic' && (
            <Note className="mb-3">
              <span className="num">{graph.contra.count.toLocaleString()}</span> {view === 'out' ? 'credit' : 'debit'} entr{graph.contra.count === 1 ? 'y' : 'ies'} on {view === 'out' ? 'expense' : 'income'} ledgers (refunds, reversals and corrections) totalling <Money value={graph.contra.amount} /> are not drawn as flows. The {view === 'out' ? 'Profit & Loss expense' : 'Profit & Loss income'} figure nets them, so it is lower than this map by that amount.
            </Note>
          )}

          <Panel className="p-4" hud lit={false}>
            {nodes.length === 0 ? (
              <Empty icon={<Network size={20} />}
                title={view === 'ic' ? 'No intercompany balance is outstanding' : view === 'out' ? 'No expense has been recorded in this period' : 'No income has been recorded in this period'}
                body={view === 'ic' ? 'Intercompany ledgers with a counterparty company appear here when they carry a receivable balance.' : 'The map is drawn only from posted ledger entries. Change the period or the company selection.'} />
            ) : (
              <>
                <FlowMap nodes={nodes} links={links} columns={columns} height={Math.max(440, Math.min(900, tallest * 52 + 40))} onNode={openNode} onLink={openLink} />
                <div className="mt-2 text-[11.5px] text-muted">
                  {view === 'ic'
                    ? 'Each line is a receivable recorded by the company on the right against the company on the left. Click a company or a line to see the entries behind it.'
                    : `Click any box or line to see the ledger entries behind it. The ${TOP_CATEGORIES} largest categories and ${TOP_PARTIES} largest parties are shown by name; everything else is grouped so that each column adds up to the same total.`}
                </div>
              </>
            )}
          </Panel>
        </>
      )}

      <Drawer open={sel !== null} onClose={() => setSel(null)} width={680}
        title={sel?.title ?? ''}
        subtitle={sel && <span className="flex flex-wrap items-center gap-2">{sel.subtitle} · <Money value={sel.total} /> <Truth state="ACTUAL" /></span>}
        footer={sel?.meta && sel.meta.kind !== 'bucket' ? (
          <>
            {sel.meta.kind === 'company' && <button className="btn" onClick={() => { const m = sel.meta; if (m?.kind === 'company') { setScope([m.companyId]); setSel(null) } }}><Building2 size={14} /> Show only this company</button>}
            {sel.meta.kind === 'party' && <button className="btn" onClick={() => { const m = sel.meta; if (m?.kind === 'party') nav('/parties/' + m.partyId) }}>Open party <ArrowUpRight size={14} /></button>}
            {sel.meta.kind === 'category' && <button className="btn" onClick={() => { const m = sel.meta; if (m?.kind === 'category') nav(ledgerLink({ accounts: m.accountIds, from, to: to > '2900' ? undefined : to })) }}>Open in the general ledger <ArrowUpRight size={14} /></button>}
          </>
        ) : undefined}>
        {sel?.lines && <LinesTable lines={sel.lines} sign={sel.sign} onOpen={(id) => nav('/journals/' + id)} />}
        {sel?.filter && <LoadedLines filter={sel.filter} onOpen={(id) => nav('/journals/' + id)} />}
      </Drawer>
    </div>
  )
}

function LinesTable({ lines, sign, onOpen, total }: { lines: LedgerLine[]; sign: Sign; onOpen: (journalId: ID) => void; total?: number }) {
  const cols: Column<LedgerLine>[] = [
    { key: 'date', header: 'Date', width: 104, render: (l) => <span className="num text-[12.5px]">{fmtDate(l.journal_date)}</span>, sort: (l) => l.journal_date, csv: (l) => l.journal_date },
    { key: 'voucher', header: 'Voucher', width: 120, render: (l) => <span className="num text-[12.5px] text-gold">{l.voucher_no ?? '—'}</span>, sort: (l) => l.voucher_no ?? '', csv: (l) => l.voucher_no },
    {
      key: 'narration', header: 'Narration',
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{l.narration ?? l.description ?? '—'}</div>
          <div className="truncate text-[11.5px] text-muted">{l.company_name} · {l.account_name}{l.party_name ? ` · ${l.party_name}` : ''}</div>
        </div>
      ),
      csv: (l) => [l.narration ?? l.description ?? '', l.company_name, l.account_name, l.party_name ?? ''].filter(Boolean).join(' | '),
    },
    { key: 'amount', header: 'Amount', align: 'right', width: 130, render: (l) => <Money value={amountOf(l, sign)} />, sort: (l) => amountOf(l, sign).toNumber(), csv: (l) => amountOf(l, sign).toFixed(2) },
  ]
  return (
    <div className="-mx-5 -my-4">
      <DataTable columns={cols} rows={lines} rowKey={(l) => l.id} onRow={(l) => onOpen(l.journal_id)} pageSize={50} totalCount={total}
        initialSort={{ key: 'date', dir: 'desc' }} exportName="money-map-entries"
        empty={{ title: 'No ledger entries', body: 'Nothing has been posted behind this flow.' }} />
    </div>
  )
}

function LoadedLines({ filter, onOpen }: { filter: LedgerFilter; onOpen: (journalId: ID) => void }) {
  const api = useApp((s) => s.api)!
  const res = useAsync(() => fetchAll(api, filter), [api, JSON.stringify(filter)])
  if (res.error) return <ErrorBox message={res.error} retry={res.reload} />
  if (!res.data) return <Loading rows={5} />
  return (
    <>
      {res.data.rows.length < res.data.total && (
        <Note kind="warn" className="mb-6">The most recent <span className="num">{res.data.rows.length.toLocaleString()}</span> of <span className="num">{res.data.total.toLocaleString()}</span> entries are listed. Open the general ledger for the complete history.</Note>
      )}
      {res.data.restricted.count > 0 && (
        <Note kind="warn" className="mb-6"><span className="num">{res.data.restricted.count.toLocaleString()}</span> entr{res.data.restricted.count === 1 ? 'y' : 'ies'} totalling <Money value={D(res.data.restricted.debit).minus(D(res.data.restricted.credit))} /> relate to restricted transactions that your account is not authorised to view.</Note>
      )}
      <LinesTable lines={res.data.rows} sign="dr" onOpen={onOpen} total={res.data.total} />
    </>
  )
}
