import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowUpRight, CalendarCheck, CircleAlert, CircleCheck, CircleMinus, Info, Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink, openDocuments, sumBase } from '@/lib/data'
import { D, ZERO, sum } from '@/lib/money'
import { addMonths, endOfMonth, fmtDate, fmtDateTime, fmtMonth, startOfMonth, today } from '@/lib/dates'
import type { FiscalPeriod, ID, Journal } from '@/engine/types'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Money, Note, PageHeader, Panel, ReasonDialog, StatusChip, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Gauge } from '@/ui/charts'

type State = 'pass' | 'attention' | 'na' | 'info'
interface Item {
  key: string
  no: number
  label: string
  state: State
  detail: string
  figures?: { label: string; value: Decimal }[]
  journals?: Journal[]
  to: string
  action: string
}
type Target = FiscalPeriod['status']

const STATE_LABEL: Record<State, string> = { pass: 'Pass', attention: 'Attention', na: 'Not applicable', info: 'For information' }
const STATE_CHIP: Record<State, string> = { pass: 'pos', attention: 'warn', na: '', info: 'cyan' }
const OPEN_BANK = ['unmatched', 'suggested', 'needs_review', 'partial']
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

export default function PeriodClose() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const { act, busy } = useAction()

  const scoped = companies.filter((c) => ids.includes(c.id))
  const [companyId, setCompanyId] = useState<ID>('')
  const cid = scoped.some((c) => c.id === companyId) ? companyId : scoped[0]?.id ?? ''
  const company = scoped.find((c) => c.id === cid)

  const thisMonth = startOfMonth(today())
  const [month, setMonth] = useState(() => addMonths(thisMonth, -1))
  const options = useMemo(() => {
    const list = Array.from({ length: 18 }, (_, i) => addMonths(thisMonth, -i))
    return list.includes(month) ? list : [...list, month].sort((a, b) => b.localeCompare(a))
  }, [thisMonth, month])
  const from = month
  const to = endOfMonth(month)
  const asOf = to > today() ? today() : to
  const [target, setTarget] = useState<Target | null>(null)

  const mayViewBank = !!cid && can('bank.view', cid)
  const stamp = `${cid}|${month}`

  const main = useAsync(async () => {
    if (!cid) return null
    const [periods, integrity, journals, banks, invoices, bals, alerts, approvals] = await Promise.all([
      api.listPeriods([cid]),
      api.integrityCheck([cid]),
      api.listJournals({ companyIds: [cid], from, to, limit: 1000 }),
      mayViewBank ? api.listBankAccounts([cid]) : Promise.resolve([]),
      api.listInvoices({ companyIds: [cid] }),
      api.ledgerBalances([cid], from, to),
      api.listAlerts([cid]),
      api.listApprovalRequests([cid]),
    ])
    const txns = (await Promise.all(banks.map((b) => api.listBankTransactions(b.id)))).flat()
    return { stamp, periods, integrity, journals, banks, txns, invoices, bals, alerts, approvals }
  }, [api, cid, month, mayViewBank])

  const d = main.data && main.data.stamp === stamp ? main.data : null

  const items = useMemo<Item[]>(() => {
    if (!d) return []
    const own = accounts.filter((a) => a.company_id === cid)
    const byId = new Map(own.map((a) => [a.id, a]))
    const closing = (f: (id: ID) => boolean) => d.bals.filter((r) => f(r.account_id)).reduce((s, r) => s.plus(D(r.opening_debit)).plus(D(r.period_debit)).minus(D(r.opening_credit)).minus(D(r.period_credit)), ZERO)
    const js = d.journals.rows
    const of = (status: Journal['status']) => js.filter((j) => j.status === status)

    // 1
    const debits = D(d.integrity.total_debits), credits = D(d.integrity.total_credits)
    const balanced = d.integrity.unbalanced_journals === 0 && debits.eq(credits)
    // 2–4
    const submitted = of('submitted'), approved = of('approved'), drafts = of('draft')
    const pendingReqs = d.approvals.filter((a) => a.status === 'pending')
    // 5
    const inMonth = d.txns.filter((t) => t.txn_date >= from && t.txn_date <= to)
    const openBank = inMonth.filter((t) => OPEN_BANK.includes(t.status))
    const openBankNet = sum(openBank.map((t) => t.amount))
    // 6–7
    const docs = openDocuments(d.invoices.filter((i) => i.doc_date <= to), asOf)
    const recvOld = docs.filter((x) => x.side === 'in' && x.daysOverdue > 90)
    const payOver = docs.filter((x) => x.side === 'out' && x.daysOverdue > 0)
    // 8
    const fixedIds = own.filter((a) => a.type === 'asset' && a.subtype === 'fixed_asset').map((a) => a.id)
    const fixed = closing((id) => fixedIds.includes(id))
    const dep = js.filter((j) => j.status === 'posted' && j.voucher_type === 'depreciation')
    // 9
    const suspenseIds = own.filter((a) => a.subtype === 'suspense' || a.control_type === 'suspense').map((a) => a.id)
    const suspense = closing((id) => suspenseIds.includes(id))
    // 10
    const isIc = (id: ID) => { const a = byId.get(id); return !!a && (a.control_type === 'intercompany' || a.subtype === 'intercompany_receivable' || a.subtype === 'intercompany_payable') }
    const icIds = own.filter((a) => isIc(a.id)).map((a) => a.id)
    const icRecv = closing((id) => isIc(id) && byId.get(id)?.type === 'asset')
    const icPay = closing((id) => isIc(id) && byId.get(id)?.type !== 'asset').neg()
    // 11
    const openAlerts = d.alerts.filter((a) => a.status === 'open' || a.status === 'reviewing')
    // 12
    const bare = js.filter((j) => j.status === 'posted' && j.source === 'manual' && !(j.purpose ?? '').trim() && !(j.narration ?? '').trim())

    const list: Omit<Item, 'no'>[] = [
      {
        key: 'balanced', label: 'Books balanced', state: balanced ? 'pass' : 'attention',
        detail: balanced
          ? `${plural(d.integrity.posted_journals, 'posted journal')} re-added for this company: debits equal credits.`
          : `${plural(d.integrity.unbalanced_journals, 'unbalanced journal')}; total debits and credits ${debits.eq(credits) ? 'agree' : 'do not agree'}.`,
        figures: [{ label: 'Total debits', value: debits }, { label: 'Total credits', value: credits }, { label: 'Difference', value: debits.minus(credits) }],
        to: '/reports/trial-balance', action: 'Open trial balance',
      },
      {
        key: 'awaiting', label: 'No journals awaiting approval', state: submitted.length ? 'attention' : 'pass',
        detail: `${submitted.length ? plural(submitted.length, 'journal') + ' dated in this month await approval' : 'No journal dated in this month awaits approval'}. ${plural(pendingReqs.length, 'approval request')} pending for this company in total.`,
        journals: submitted, to: '/approvals', action: 'Open approvals',
      },
      {
        key: 'unposted', label: 'No approved journals left unposted', state: approved.length ? 'attention' : 'pass',
        detail: approved.length ? `${plural(approved.length, 'approved journal')} dated in this month ${approved.length === 1 ? 'has' : 'have'} not been posted and ${approved.length === 1 ? 'is' : 'are'} not in the ledger.` : 'Every approved journal dated in this month has been posted.',
        journals: approved, to: '/journals', action: 'Open journals',
      },
      {
        key: 'drafts', label: 'No drafts dated in the period', state: drafts.length ? 'attention' : 'pass',
        detail: drafts.length ? `${plural(drafts.length, 'draft')} dated in this month ${drafts.length === 1 ? 'is' : 'are'} not part of the books.` : 'There are no drafts dated in this month.',
        journals: drafts, to: '/journals', action: 'Open journals',
      },
      !mayViewBank
        ? { key: 'bank', label: 'Bank reconciled', state: 'attention', detail: 'This cannot be checked: you need the "bank.view" permission for this company.', to: '/banking', action: 'Open banking' }
        : inMonth.length === 0
          ? { key: 'bank', label: 'Bank reconciled', state: 'na', detail: `No statement lines dated in this month have been imported for ${plural(d.banks.length, 'bank or cash account')}, so reconciliation cannot be assessed.`, to: '/banking', action: 'Import a statement' }
          : {
              key: 'bank', label: 'Bank reconciled', state: openBank.length ? 'attention' : 'pass',
              detail: openBank.length ? `${plural(openBank.length, 'statement line')} of ${inMonth.length.toLocaleString()} dated in this month ${openBank.length === 1 ? 'is' : 'are'} not reconciled.` : `All ${plural(inMonth.length, 'statement line')} dated in this month are matched or marked as duplicates.`,
              figures: [{ label: 'Net of unreconciled lines', value: openBankNet }],
              to: '/banking', action: 'Open banking',
            },
      {
        key: 'receivables', label: 'Receivables reviewed', state: recvOld.length ? 'attention' : 'pass',
        detail: recvOld.length ? `${plural(recvOld.length, 'open sales invoice')} ${recvOld.length === 1 ? 'is' : 'are'} more than 90 days overdue as at ${fmtDate(asOf)}.` : `No open sales invoice is more than 90 days overdue as at ${fmtDate(asOf)}.`,
        figures: [{ label: 'Outstanding over 90 days', value: sumBase(recvOld) }],
        to: '/parties/owed?side=in', action: 'Open receivables',
      },
      {
        key: 'payables', label: 'Payables reviewed', state: payOver.length ? 'attention' : 'pass',
        detail: payOver.length ? `${plural(payOver.length, 'open purchase bill')} ${payOver.length === 1 ? 'is' : 'are'} overdue as at ${fmtDate(asOf)}.` : `No open purchase bill is overdue as at ${fmtDate(asOf)}.`,
        figures: [{ label: 'Overdue payables', value: sumBase(payOver) }],
        to: '/parties/owed?side=out', action: 'Open payables',
      },
      fixed.isZero()
        ? { key: 'depreciation', label: 'Depreciation posted', state: 'na', detail: `The company carries no fixed-asset balance as at ${fmtDate(to)}.`, figures: [{ label: 'Fixed assets at cost', value: fixed }], to: fixedIds.length ? ledgerLink({ accounts: fixedIds, to }) : '/accounts', action: fixedIds.length ? 'Open fixed-asset ledger' : 'Open chart of accounts' }
        : {
            key: 'depreciation', label: 'Depreciation posted', state: dep.length ? 'pass' : 'attention',
            detail: dep.length ? `${plural(dep.length, 'depreciation journal')} posted in this month.` : 'No depreciation journal has been posted in this month.',
            figures: [{ label: 'Fixed assets at cost', value: fixed }],
            journals: dep, to: dep.length ? '/journals/' + dep[0].id : '/journals/new', action: dep.length ? 'Open the journal' : 'Record depreciation',
          },
      {
        key: 'suspense', label: 'Suspense cleared', state: suspense.isZero() ? 'pass' : 'attention',
        detail: suspenseIds.length === 0 ? 'The chart of accounts has no suspense account.' : suspense.isZero() ? `The suspense balance is zero as at ${fmtDate(to)}.` : `Unclassified amounts remain in suspense as at ${fmtDate(to)}.`,
        figures: [{ label: 'Suspense balance', value: suspense.neg() }],
        to: suspenseIds.length ? ledgerLink({ accounts: suspenseIds, to }) : '/accounts', action: suspenseIds.length ? 'Open suspense ledger' : 'Open chart of accounts',
      },
      {
        key: 'intercompany', label: 'Intercompany reviewed', state: 'info',
        detail: icIds.length ? `Balances with group companies as at ${fmtDate(to)}. Agreement with the counterparty is checked in the consolidation report.` : 'The chart of accounts has no intercompany account.',
        figures: [{ label: 'Due from group companies', value: icRecv }, { label: 'Due to group companies', value: icPay }],
        to: icIds.length ? ledgerLink({ accounts: icIds, to }) : '/accounts', action: icIds.length ? 'Open intercompany ledger' : 'Open chart of accounts',
      },
      {
        key: 'exceptions', label: 'Exceptional transactions reviewed', state: openAlerts.length ? 'attention' : 'pass',
        detail: openAlerts.length ? `${plural(openAlerts.length, 'Sentinel alert')} for this company ${openAlerts.length === 1 ? 'is' : 'are'} open or under review.` : 'No Sentinel alert is open for this company.',
        to: '/sentinel', action: 'Open Sentinel',
      },
      {
        key: 'documents', label: 'Documents complete', state: bare.length ? 'attention' : 'pass',
        detail: bare.length ? `${plural(bare.length, 'posted manual journal')} in this month ${bare.length === 1 ? 'has' : 'have'} neither a purpose nor a narration.` : 'Every posted manual journal in this month states a purpose or a narration.',
        journals: bare, to: bare.length === 1 ? '/journals/' + bare[0].id : '/journals', action: 'Open journals',
      },
    ]
    return list.map((x, i) => ({ ...x, no: i + 1 }))
  }, [d, accounts, cid, from, to, asOf, mayViewBank])

  const passed = items.filter((i) => i.state === 'pass').length
  const attention = items.filter((i) => i.state === 'attention')
  const counted = passed + attention.length
  const pct = counted ? Math.round((passed / counted) * 100) : 0
  const tone = pct === 100 ? 'pos' : pct >= 70 ? 'gold' : pct >= 40 ? 'warn' : 'neg'

  const period = d?.periods.find((p) => p.company_id === cid && p.period_start.slice(0, 10) === from)
  const status: Target = period?.status ?? 'open'
  const mayLock = !!cid && can('period.lock', cid)
  const mayReopen = !!cid && can('period.reopen', cid)
  const truncated = d ? d.journals.total > d.journals.rows.length : false

  const dialog: Record<Target, { title: string; body: string; confirm: string; ok: string; required: boolean; danger?: boolean }> = {
    soft_closed: {
      title: `Soft close ${fmtMonth(from)}`, confirm: 'Soft close', ok: `${fmtMonth(from)} soft closed (provisional)`, required: attention.length > 0,
      body: 'The month is marked as provisionally closed. Figures prepared from it remain provisional until the period is locked.',
    },
    locked: {
      title: `Lock ${fmtMonth(from)}`, confirm: 'Lock period', ok: `${fmtMonth(from)} locked`, required: true, danger: attention.length > 0,
      body: 'Once locked, ordinary users cannot post into this month. Corrections are made through reversal or adjustment journals in an open period.',
    },
    open: {
      title: `Reopen ${fmtMonth(from)}`, confirm: 'Reopen period', ok: `${fmtMonth(from)} reopened`, required: true, danger: true,
      body: 'Reopening allows posting into this month again. Reports already issued for it may no longer agree with the books.',
    },
  }

  const columns: Column<FiscalPeriod>[] = [
    { key: 'month', header: 'Month', sort: (p) => p.period_start, csv: (p) => p.period_start.slice(0, 7), render: (p) => <div><span className="text-ink">{fmtMonth(p.period_start)}</span><span className="ml-2 text-[12px] text-muted">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</span></div> },
    { key: 'status', header: 'Status', sort: (p) => p.status, csv: (p) => p.status, render: (p) => <StatusChip status={p.status} /> },
    { key: 'changed', header: 'Changed at', sort: (p) => p.changed_at ?? '', csv: (p) => p.changed_at, render: (p) => <span className="num text-[12px] text-ink2">{fmtDateTime(p.changed_at)}</span> },
    { key: 'reason', header: 'Reason', csv: (p) => p.reason, render: (p) => (p.reason ? <span className="text-ink2">{p.reason}</span> : <span className="text-muted">No reason recorded</span>) },
  ]

  if (!scoped.length) {
    return (
      <div>
        <PageHeader eyebrow="NUMERO CLOSE" title="Period Close" />
        <Panel><Empty icon={<CalendarCheck size={20} />} title="No company in scope" body="Choose a company to review its month-end close." /></Panel>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="NUMERO CLOSE" title="Period Close"
        subtitle={<>{company?.name} · {fmtDate(from)} – {fmtDate(to)} · every checklist item is computed from the books, not ticked by hand</>}
        actions={<>
          <Field label="Company" className="w-[240px]">
            <select className="field sm" value={cid} onChange={(e) => setCompanyId(e.target.value)}>
              {scoped.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Month" className="w-[150px]">
            <select className="field sm" value={month} onChange={(e) => setMonth(e.target.value)}>
              {options.map((m) => <option key={m} value={m}>{fmtMonth(m)}{m === thisMonth ? ' (current)' : ''}</option>)}
            </select>
          </Field>
        </>} />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!d && !main.error && <Panel><Loading rows={8} /></Panel>}

      {d && (
        <>
          <div className="mb-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
            <Panel className="p-5" hud>
              <div className="flex flex-wrap items-center gap-5">
                <Gauge value={pct / 100} label={`${pct}%`} sub="complete" tone={tone} size={140} />
                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center gap-2">
                    <div className="eyebrow">{fmtMonth(from)}</div>
                    <Explain title="Close completion" text="The share of applicable checklist items that pass. Items that are not applicable, and items shown for information only, are left out of the calculation."
                      formula="Items passed ÷ (Items passed + Items needing attention) × 100" source="Source: the checklist below, computed from journals, bank statement lines, invoices, ledger balances and Sentinel alerts of this company." />
                  </div>
                  <div className={cx('display mt-1 text-[19px] font-medium leading-tight', pct === 100 ? 'text-pos' : 'text-ink')}>MONTH-END CLOSE: {pct}% COMPLETE</div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="chip pos"><span className="num">{passed}</span> passed</span>
                    <span className={cx('chip', attention.length ? 'warn' : '')}><span className="num">{attention.length}</span> need attention</span>
                    <span className="chip"><span className="num">{items.filter((i) => i.state === 'na').length}</span> not applicable</span>
                    <span className="chip cyan"><span className="num">{items.filter((i) => i.state === 'info').length}</span> for information</span>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow">Status of the period</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusChip status={status} />
                    {status === 'soft_closed' && <Truth state="PROVISIONAL" />}
                    {status === 'locked' ? <Lock size={14} className="text-gold" /> : <LockOpen size={14} className="text-muted" />}
                  </div>
                </div>
                <div className="text-right text-[12px] text-muted">{period?.changed_at ? <>Changed {fmtDateTime(period.changed_at)}</> : 'No change has been recorded'}</div>
              </div>
              <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px]">
                <div className="eyebrow mb-1">Recorded reason</div>
                <div className={period?.reason ? 'text-ink2' : 'text-muted'}>{period?.reason ?? 'No reason is recorded for this period.'}</div>
              </div>
              <div className="no-print mt-3.5 flex flex-wrap gap-2">
                {status === 'open' && <button className="btn" disabled={!mayLock || busy} title={mayLock ? 'Mark the month as provisionally closed' : 'You need the "period.lock" permission for this company'} onClick={() => setTarget('soft_closed')}><ShieldCheck size={14} /> Soft close (provisional)</button>}
                {status !== 'locked' && <button className="btn primary" disabled={!mayLock || busy} title={mayLock ? 'Prevent further posting into this month' : 'You need the "period.lock" permission for this company'} onClick={() => setTarget('locked')}><Lock size={14} /> Lock period</button>}
                {status !== 'open' && <button className="btn danger" disabled={!mayReopen || busy} title={mayReopen ? 'Allow posting into this month again' : 'You need the "period.reopen" permission for this company'} onClick={() => setTarget('open')}><LockOpen size={14} /> Reopen</button>}
              </div>
            </Panel>
          </div>

          {truncated && <Note kind="warn" className="mb-4">This month has <span className="num">{d.journals.total.toLocaleString()}</span> journals; the checklist examined the first <span className="num">{d.journals.rows.length.toLocaleString()}</span>. Items that count journals may be understated.</Note>}

          <Panel lit={false} className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div><div className="eyebrow">Close checklist</div><div className="mt-0.5 text-[12.5px] text-ink2">Each item links to the place where it can be resolved.</div></div>
              <Truth state="ACTUAL" />
            </div>
            <div>
              {items.map((it) => (
                <div key={it.key} className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                  <span className={cx('mt-0.5 flex-none', it.state === 'pass' ? 'text-pos' : it.state === 'attention' ? 'text-warn' : it.state === 'info' ? 'text-cyan' : 'text-muted')}>
                    {it.state === 'pass' ? <CircleCheck size={18} /> : it.state === 'attention' ? <CircleAlert size={18} /> : it.state === 'info' ? <Info size={18} /> : <CircleMinus size={18} />}
                  </span>
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[11.5px] text-muted">{String(it.no).padStart(2, '0')}</span>
                      <span className="text-[13.5px] font-medium text-ink">{it.label}</span>
                      <span className={cx('chip', STATE_CHIP[it.state])}>{STATE_LABEL[it.state]}</span>
                    </div>
                    <div className="mt-1 text-[12.5px] text-ink2">{it.detail}</div>
                    {it.figures && (
                      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                        {it.figures.map((f) => <span key={f.label} className="text-muted">{f.label} <Money value={f.value} currency={company?.base_currency} className="text-ink2" /></span>)}
                      </div>
                    )}
                    {it.journals && it.journals.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                        {it.journals.slice(0, 6).map((j) => (
                          <button key={j.id} className="drill num" onClick={() => nav('/journals/' + j.id)} title={j.narration ?? undefined}>{j.voucher_no ?? `${j.voucher_type} · ${fmtDate(j.journal_date)}`}</button>
                        ))}
                        {it.journals.length > 6 && <span className="text-muted">and {it.journals.length - 6} more</span>}
                      </div>
                    )}
                  </div>
                  <button className="btn sm ghost no-print" onClick={() => nav(it.to)}>{it.action} <ArrowUpRight size={13} /></button>
                </div>
              ))}
            </div>
          </Panel>

          <Note className="mb-4">Once a period is locked, ordinary users cannot post into it. Corrections go through reversal or adjustment journals in an open period, so the locked figures and their history stay intact.</Note>

          <Panel lit={false} className="overflow-hidden">
            <div className="border-b border-line px-4 py-3"><div className="eyebrow">History of periods</div><div className="mt-0.5 text-[12.5px] text-ink2">{company?.name}</div></div>
            <DataTable<FiscalPeriod> columns={columns} rows={d.periods.filter((p) => p.company_id === cid)} rowKey={(p) => p.id} exportName={`periods-${company?.code ?? 'company'}`}
              initialSort={{ key: 'month', dir: 'desc' }} onRow={(p) => setMonth(startOfMonth(p.period_start.slice(0, 10)))}
              rowClass={(p) => (p.period_start.slice(0, 10) === from ? 'bg-goldsoft' : undefined)}
              empty={{ title: 'No period has been closed or locked', body: 'Every month of this company is open.', icon: <CalendarCheck size={20} /> }} />
          </Panel>
        </>
      )}

      <ReasonDialog open={!!target} title={target ? dialog[target].title : ''} body={target ? dialog[target].body : undefined} confirm={target ? dialog[target].confirm : 'Confirm'}
        danger={target ? dialog[target].danger : undefined} required={target ? dialog[target].required : true}
        extra={target && target !== 'open' && attention.length > 0 ? (
          <div className="mb-4 rounded-xl border border-warn/30 bg-warnsoft px-3.5 py-3 text-[12.5px]">
            <div className="mb-1.5 font-medium text-ink">{plural(attention.length, 'checklist item')} still need{attention.length === 1 ? 's' : ''} attention</div>
            <ul className="m-0 space-y-1 pl-4 text-ink2">
              {attention.map((a) => <li key={a.key}><span className="text-ink">{a.label}</span> — {a.detail}</li>)}
            </ul>
            <div className="mt-2 text-muted">The period can still be {target === 'locked' ? 'locked' : 'soft closed'}, but the reason for doing so with items outstanding must be stated.</div>
          </div>
        ) : undefined}
        onCancel={() => setTarget(null)}
        onConfirm={(reason) => {
          const t = target
          if (!t || !cid) return
          setTarget(null)
          void act(() => api.setPeriodStatus(cid, from, t, reason || undefined), dialog[t].ok)
        }} />
    </div>
  )
}
