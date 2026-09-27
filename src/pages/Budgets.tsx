import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { BadgeCheck, ChevronDown, ChevronRight, FilePlus2, GitBranch, Pencil, PiggyBank, Plus, Search } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO, fmtPct, sum } from '@/lib/money'
import { addDays, addMonths, endOfMonth, fiscalYearOf, fmtDate, fmtMonth, pad, today } from '@/lib/dates'
import type { Account, Budget, BudgetLine, Company, ID } from '@/engine/types'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, Meter } from '@/ui/charts'

type Tone = 'pos' | 'gold' | 'warn' | 'neg'
const toneOf = (pct: number): Tone => (pct < 70 ? 'pos' : pct < 90 ? 'gold' : pct < 100 ? 'warn' : 'neg')
const TEXT: Record<Tone, string> = { pos: 'text-pos', gold: 'text-gold', warn: 'text-warn', neg: 'text-neg' }
const THRESHOLDS = [100, 90, 80, 70] as const

const fyMonths = (fy: number, startMonth: number) => {
  const start = `${fy}-${pad(startMonth)}-01`
  return Array.from({ length: 12 }, (_, i) => addMonths(start, i))
}
const fyName = (fy: number, startMonth: number) => (startMonth === 1 ? `FY ${fy}` : `FY ${fy}-${String(fy + 1).slice(2)}`)
/** Natural sign of a movement: expenses and assets grow with debits, everything else with credits. */
const naturalOf = (a: Account | undefined, debit: Decimal.Value, credit: Decimal.Value) =>
  a && (a.type === 'income' || a.type === 'liability' || a.type === 'equity') ? D(credit).minus(D(debit)) : D(debit).minus(D(credit))

interface EditorSeed { mode: 'new' | 'edit' | 'revise'; budget?: Budget; lines?: BudgetLine[] }

export default function Budgets() {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const [selId, setSelId] = useState<ID | null>(null)
  const [editor, setEditor] = useState<EditorSeed | null>(null)

  const list = useAsync(() => api.listBudgets(ids), [api, ids.join(',')])
  const budgets = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.fy - a.fy || a.name.localeCompare(b.name) || b.version - a.version), [list.data])
  const sel = budgets.find((b) => b.id === selId) ?? budgets[0] ?? null
  const companyOf = (id: ID) => companies.find((c) => c.id === id)
  const editable = companies.filter((c) => ids.includes(c.id) && can('budget.edit', c.id))

  const newBtn = (
    <button className="btn primary" disabled={!editable.length} onClick={() => setEditor({ mode: 'new' })}
      title={editable.length ? 'Create a draft budget' : 'You need the "budget.edit" permission to create a budget'}>
      <Plus size={15} /> New budget
    </button>
  )

  const columns: Column<Budget>[] = [
    { key: 'company', header: 'Company', sort: (b) => companyOf(b.company_id)?.name ?? '', csv: (b) => companyOf(b.company_id)?.name, render: (b) => <span className="text-ink2">{companyOf(b.company_id)?.name ?? 'Unknown company'}</span> },
    { key: 'name', header: 'Budget', sort: (b) => b.name, csv: (b) => b.name, render: (b) => <span className="font-medium text-ink">{b.name}</span> },
    { key: 'fy', header: 'Fiscal year', sort: (b) => b.fy, csv: (b) => b.fy, render: (b) => <span className="num">{fyName(b.fy, companyOf(b.company_id)?.fy_start_month ?? 4)}</span> },
    { key: 'version', header: 'Version', sort: (b) => b.version, csv: (b) => b.version, render: (b) => <span className="num">v{b.version}</span> },
    { key: 'kind', header: 'Kind', sort: (b) => b.kind, csv: (b) => b.kind, render: (b) => <span className="chip">{b.kind}</span> },
    { key: 'limit', header: 'Limit', sort: (b) => b.limit_mode, csv: (b) => b.limit_mode, render: (b) => <span className={cx('chip', b.limit_mode === 'hard' ? 'warn' : '')} title={b.limit_mode === 'hard' ? 'Recorded as a hard limit' : 'Recorded as a soft limit'}>{b.limit_mode} limit</span> },
    { key: 'status', header: 'Status', sort: (b) => b.status, csv: (b) => b.status, render: (b) => <StatusChip status={b.status} /> },
  ]

  return (
    <div>
      <PageHeader eyebrow="Planning" title="Budgets" truth="BUDGET"
        subtitle="Plans are compared with what was actually recorded. Budget figures are never added to actual figures."
        actions={newBtn} />

      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading rows={5} /></Panel>}

      {list.data && (
        <Panel lit={false} className="mb-5 overflow-hidden">
          <DataTable<Budget> columns={columns} rows={budgets} rowKey={(b) => b.id} onRow={(b) => setSelId(b.id)} exportName="budgets" pageSize={10}
            rowClass={(b) => (sel?.id === b.id ? 'bg-goldsoft' : undefined)}
            empty={{ title: 'No budgets yet', body: 'Create a budget to compare planned spending with what is actually recorded.', icon: <PiggyBank size={20} />, action: newBtn }} />
        </Panel>
      )}

      {sel && <BudgetDetail key={sel.id} budget={sel} company={companyOf(sel.company_id)} onEdit={setEditor} />}

      {editor && <BudgetEditor key={(editor.budget?.id ?? 'new') + editor.mode} seed={editor} companies={editable} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); setSelId(id) }} />}
    </div>
  )
}

// ------------------------------------------------------------------ budget vs actual
interface Row {
  id: ID
  account: Account | undefined
  full: Decimal
  ytd: Decimal
  actual: Decimal
  variance: Decimal
  variancePct: Decimal | null
  remaining: Decimal
  /** actual as a percentage of the year-to-date budget; null when there is no budget for the period */
  used: number | null
}

function BudgetDetail({ budget, company, onEdit }: { budget: Budget; company: Company | undefined; onEdit: (s: EditorSeed) => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const [approving, setApproving] = useState(false)

  const startMonth = company?.fy_start_month ?? 4
  const months = useMemo(() => fyMonths(budget.fy, startMonth), [budget.fy, startMonth])
  const fyFrom = months[0]
  const fyTo = addDays(addMonths(fyFrom, 12), -1)
  const now = today()
  const started = now >= fyFrom
  /** year to date runs in whole months so that budget and actual cover exactly the same span */
  const ytdTo = !started ? null : endOfMonth(now) > fyTo ? fyTo : endOfMonth(now)
  const ccy = company?.base_currency

  const detail = useAsync(async () => {
    const [lines, actuals] = await Promise.all([api.getBudgetLines(budget.id), api.ledgerMonthly([budget.company_id], fyFrom, fyTo)])
    return { lines, actuals }
  }, [api, budget.id, fyFrom, fyTo])

  const calc = useMemo(() => {
    const d = detail.data
    if (!d) return null
    const byId = new Map(accounts.filter((a) => a.company_id === budget.company_id).map((a) => [a.id, a]))
    const inYtd = (m: string) => ytdTo !== null && m.slice(0, 10) <= ytdTo
    const budgetIds = [...new Set(d.lines.map((l) => l.account_id))]
    const inBudget = new Set(budgetIds)

    const rows: Row[] = budgetIds.map((id) => {
      const account = byId.get(id)
      const own = d.lines.filter((l) => l.account_id === id)
      const full = sum(own.map((l) => l.amount))
      const ytd = sum(own.filter((l) => inYtd(l.period_month)).map((l) => l.amount))
      const actual = d.actuals.filter((r) => r.account_id === id && inYtd(r.month)).reduce((s, r) => s.plus(naturalOf(account, r.debit, r.credit)), ZERO)
      const variance = ytd.minus(actual)
      return {
        id, account, full, ytd, actual, variance,
        variancePct: ytd.isZero() ? null : variance.div(ytd).times(100),
        remaining: full.minus(actual),
        used: ytd.gt(0) ? actual.div(ytd).times(100).toNumber() : actual.gt(0) ? null : 0,
      }
    }).sort((a, b) => (a.account?.code ?? '').localeCompare(b.account?.code ?? ''))

    const total = {
      full: sum(rows.map((r) => r.full)), ytd: sum(rows.map((r) => r.ytd)), actual: sum(rows.map((r) => r.actual)),
    }
    const monthly = months.map((m) => ({
      month: m,
      budget: sum(d.lines.filter((l) => l.period_month.slice(0, 10) === m).map((l) => l.amount)),
      actual: d.actuals.filter((r) => inBudget.has(r.account_id) && r.month.slice(0, 10) === m).reduce((s, r) => s.plus(naturalOf(byId.get(r.account_id), r.debit, r.credit)), ZERO),
    }))
    // spending recorded on expense accounts that this budget does not cover is stated, never hidden
    const outside = budget.kind === 'opex'
      ? d.actuals.filter((r) => !inBudget.has(r.account_id) && byId.get(r.account_id)?.type === 'expense' && inYtd(r.month))
      : []
    const outsideTotal = outside.reduce((s, r) => s.plus(D(r.debit)).minus(D(r.credit)), ZERO)
    const outsideIds = [...new Set(outside.map((r) => r.account_id))]
    const allocated = d.lines.some((l) => !!l.org_unit_id)
    return { rows, total, monthly, budgetIds, outsideTotal, outsideIds, allocated }
  }, [detail.data, accounts, budget.company_id, budget.kind, months, ytdTo])

  const mayApprove = can('budget.approve', budget.company_id)
  const mayEdit = can('budget.edit', budget.company_id)
  const drill = (accountIds: ID[], from = fyFrom, to = ytdTo ?? fyTo) => nav(ledgerLink({ accounts: accountIds, from, to }))

  const usedCell = (r: Row) => {
    if (r.used === null) return <span className="chip neg" title="Spending is recorded but no budget exists for the period">no budget</span>
    const t = toneOf(r.used)
    return (
      <div className="flex min-w-[130px] items-center gap-2">
        <div className="flex-1"><Meter value={r.used} max={100} tone={t} /></div>
        <span className={cx('num w-[52px] text-right text-[12px]', TEXT[t])}>{fmtPct(r.used)}</span>
      </div>
    )
  }

  const columns: Column<Row>[] = [
    {
      key: 'account', header: 'Account', sort: (r) => r.account?.code ?? '', csv: (r) => `${r.account?.code ?? ''} ${r.account?.name ?? r.id}`.trim(),
      render: (r) => <div className="min-w-[180px]"><span className="num mr-2 text-[12px] text-muted">{r.account?.code ?? '—'}</span><span className="text-ink">{r.account?.name ?? 'Account not available'}</span></div>,
    },
    { key: 'full', header: 'Budget (full year)', align: 'right', sort: (r) => r.full.toNumber(), csv: (r) => r.full.toFixed(2), render: (r) => <Money value={r.full} currency={ccy} className="text-violet" /> },
    { key: 'ytd', header: 'Budget YTD', align: 'right', sort: (r) => r.ytd.toNumber(), csv: (r) => r.ytd.toFixed(2), render: (r) => <Money value={r.ytd} currency={ccy} className="text-violet" /> },
    { key: 'actual', header: 'Actual YTD', align: 'right', sort: (r) => r.actual.toNumber(), csv: (r) => r.actual.toFixed(2), render: (r) => <span className="drill"><Money value={r.actual} currency={ccy} /></span> },
    { key: 'variance', header: 'Variance', align: 'right', sort: (r) => r.variance.toNumber(), csv: (r) => r.variance.toFixed(2), render: (r) => <Money value={r.variance} currency={ccy} sign colored /> },
    { key: 'variancePct', header: 'Variance %', align: 'right', sort: (r) => r.variancePct?.toNumber() ?? 0, csv: (r) => r.variancePct?.toFixed(1) ?? '', render: (r) => (r.variancePct === null ? <span className="text-muted" title="There is no budget for the period to compare against">n/a</span> : <span className={cx('num', r.variancePct.isZero() ? 'text-muted' : r.variancePct.lt(0) ? 'text-neg' : 'text-pos')}>{fmtPct(r.variancePct)}</span>) },
    { key: 'remaining', header: 'Remaining', align: 'right', sort: (r) => r.remaining.toNumber(), csv: (r) => r.remaining.toFixed(2), render: (r) => <Money value={r.remaining} currency={ccy} sign colored /> },
    { key: 'used', header: 'Utilisation', sort: (r) => r.used ?? 1e9, csv: (r) => (r.used === null ? 'no budget' : r.used.toFixed(1)), render: usedCell },
  ]

  const alerts = calc ? THRESHOLDS.map((t, i) => ({
    threshold: t,
    rows: calc.rows.filter((r) => (r.used === null ? t === 100 : r.used >= t && (i === 0 || r.used < THRESHOLDS[i - 1]))),
  })) : []
  const alertCount = alerts.reduce((n, a) => n + a.rows.length, 0)
  const totalVariance = calc ? calc.total.ytd.minus(calc.total.actual) : ZERO
  const totalUsed = calc && calc.total.ytd.gt(0) ? calc.total.actual.div(calc.total.ytd).times(100).toNumber() : null

  return (
    <div>
      <Panel className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">{company?.name ?? 'Unknown company'} · {fyName(budget.fy, startMonth)} · {fmtDate(fyFrom)} – {fmtDate(fyTo)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="display text-[18px] font-medium">{budget.name}</span>
              <span className="chip">v{budget.version}</span>
              <span className="chip">{budget.kind}</span>
              <span className={cx('chip', budget.limit_mode === 'hard' ? 'warn' : '')}>{budget.limit_mode} limit</span>
              <StatusChip status={budget.status} />
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {budget.status === 'draft' && (
              <>
                <button className="btn" disabled={!mayEdit || !detail.data} title={mayEdit ? 'Change the draft' : 'You need the "budget.edit" permission for this company'} onClick={() => onEdit({ mode: 'edit', budget, lines: detail.data?.lines })}><Pencil size={14} /> Edit draft</button>
                <button className="btn good" disabled={!mayApprove || busy} title={mayApprove ? 'Approve this budget' : 'You need the "budget.approve" permission for this company'} onClick={() => setApproving(true)}><BadgeCheck size={14} /> Approve</button>
              </>
            )}
            {budget.status === 'approved' && (
              <button className="btn" disabled={!mayEdit || !detail.data} title={mayEdit ? 'Start a new version from the current figures' : 'You need the "budget.edit" permission for this company'} onClick={() => onEdit({ mode: 'revise', budget, lines: detail.data?.lines })}><GitBranch size={14} /> Create revised version</button>
            )}
          </div>
        </div>
        {budget.status === 'approved' && <Note className="mt-3.5">Approved budgets are never overwritten. To change the plan, create a revised version: it is saved as a new draft and this version is kept, marked as revised.</Note>}
        {budget.status === 'revised' && <Note className="mt-3.5">This version has been superseded by a later version. It is kept unchanged for the record.</Note>}
      </Panel>

      {detail.error && <ErrorBox message={detail.error} retry={detail.reload} />}
      {detail.loading && !calc && <Panel><Loading rows={6} /></Panel>}

      {calc && calc.rows.length === 0 && (
        <Panel><Empty icon={<PiggyBank size={20} />} title="This budget has no lines" body="No amounts have been entered for any account." /></Panel>
      )}

      {calc && calc.rows.length > 0 && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Panel className="p-4">
              <div className="flex items-center justify-between"><span className="eyebrow">Budget · full year</span><Truth state="BUDGET" /></div>
              <Money value={calc.total.full} currency={ccy} compact className="mt-2 block text-[20px] text-violet" />
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center justify-between"><span className="eyebrow">Budget · year to date</span><Truth state="BUDGET" /></div>
              <Money value={calc.total.ytd} currency={ccy} compact className="mt-2 block text-[20px] text-violet" />
            </Panel>
            <Panel className="p-4" onClick={() => drill(calc.budgetIds)} title="Open the ledger lines behind this figure">
              <div className="flex items-center justify-between"><span className="eyebrow">Actual · year to date</span><Truth state="ACTUAL" /></div>
              <Money value={calc.total.actual} currency={ccy} compact className="mt-2 block text-[20px]" />
            </Panel>
            <Panel className="p-4">
              <div className="eyebrow">Variance · budget YTD − actual</div>
              <Money value={totalVariance} currency={ccy} compact sign colored className="mt-2 block text-[20px]" />
              <div className="mt-1 text-[11.5px] text-muted">{totalUsed === null ? 'No budget for the period' : <>Utilisation <span className={cx('num', TEXT[toneOf(totalUsed)])}>{fmtPct(totalUsed)}</span></>}</div>
            </Panel>
          </div>

          <Panel lit={false} className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <div className="eyebrow">Budget versus actual</div>
                <div className="mt-0.5 text-[12.5px] text-ink2">
                  {ytdTo ? <>Year to date: {fmtDate(fyFrom)} – {fmtDate(ytdTo)}, in whole months</> : <>The fiscal year starts on {fmtDate(fyFrom)}; nothing is due to date</>}
                </div>
              </div>
              <div className="flex items-center gap-2"><Truth state="BUDGET" /><span className="text-[11px] text-muted">compared with</span><Truth state="ACTUAL" /></div>
            </div>
            <DataTable<Row> columns={columns} rows={calc.rows} rowKey={(r) => r.id} onRow={(r) => drill([r.id])} exportName={`budget-vs-actual-${budget.name}-v${budget.version}`} initialSort={{ key: 'account', dir: 'asc' }}
              footer={(
                <tr className="font-medium">
                  <td className="border-t border-line2 px-[14px] py-2.5 text-ink">Total</td>
                  <td className="r border-t border-line2 px-[14px] py-2.5"><Money value={calc.total.full} currency={ccy} className="text-violet" /></td>
                  <td className="r border-t border-line2 px-[14px] py-2.5"><Money value={calc.total.ytd} currency={ccy} className="text-violet" /></td>
                  <td className="r border-t border-line2 px-[14px] py-2.5"><Money value={calc.total.actual} currency={ccy} /></td>
                  <td className="r border-t border-line2 px-[14px] py-2.5"><Money value={totalVariance} currency={ccy} sign colored /></td>
                  <td className="r border-t border-line2 px-[14px] py-2.5">{calc.total.ytd.isZero() ? <span className="text-muted">n/a</span> : <span className="num">{fmtPct(totalVariance.div(calc.total.ytd).times(100))}</span>}</td>
                  <td className="r border-t border-line2 px-[14px] py-2.5"><Money value={calc.total.full.minus(calc.total.actual)} currency={ccy} sign colored /></td>
                  <td className="border-t border-line2 px-[14px] py-2.5">{totalUsed === null ? <span className="text-muted">n/a</span> : <span className={cx('num text-[12px]', TEXT[toneOf(totalUsed)])}>{fmtPct(totalUsed)}</span>}</td>
                </tr>
              )} />
          </Panel>

          <div className="mb-4 space-y-2">
            {!calc.outsideTotal.isZero() && (
              <Note kind="warn">
                Expense of <button className="drill" onClick={() => drill(calc.outsideIds)}><Money value={calc.outsideTotal} currency={ccy} /></button> is recorded year to date on <span className="num">{calc.outsideIds.length}</span> account{calc.outsideIds.length === 1 ? '' : 's'} that this budget does not cover. It is not part of the figures above.
              </Note>
            )}
            {calc.allocated && <Note>Some lines of this budget are allocated to departments or units. The comparison above is by account, across all units.</Note>}
            <Note>Variance = Budget YTD − Actual YTD. Remaining = full-year budget − Actual YTD. The limit mode ({budget.limit_mode}) is recorded on the budget; this screen reports overruns and does not block postings.</Note>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Panel className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="eyebrow">Month by month</div><div className="display mt-0.5 text-[15px]">Budget and actual, side by side</div></div>
                <div className="flex items-center gap-2"><Truth state="BUDGET" /><Truth state="ACTUAL" /></div>
              </div>
              <BarChart height={260}
                data={calc.monthly.map((m) => ({ label: fmtMonth(m.month), values: [{ key: 'Budget', value: m.budget.toNumber(), color: 'var(--violet)' }, { key: 'Actual', value: m.actual.toNumber(), color: 'var(--pos)' }] }))}
                onBar={(label, key) => {
                  const m = calc.monthly.find((x) => fmtMonth(x.month) === label)
                  if (m && key === 'Actual') drill(calc.budgetIds, m.month, endOfMonth(m.month))
                }} />
              <div className="mt-2 text-[11.5px] text-muted">Click an Actual bar to see the ledger lines of that month. Budget bars are plans and have no ledger lines behind them.</div>
            </Panel>

            <Panel className="p-5">
              <div className="mb-3"><div className="eyebrow">Overrun alerts</div><div className="display mt-0.5 text-[15px]">Accounts at 70% or more of budget YTD</div></div>
              {alertCount === 0 ? (
                <div className="py-8 text-center text-[13px] text-muted">No account has used 70% or more of its year-to-date budget.</div>
              ) : (
                <div className="space-y-3.5">
                  {alerts.filter((a) => a.rows.length > 0).map((a) => (
                    <Section key={a.threshold} title={a.threshold === 100 ? '100% or more — over budget' : `${a.threshold}% or more`} right={<span className={cx('chip', toneOf(a.threshold))}>{a.rows.length}</span>}>
                      <div className="space-y-1.5">
                        {a.rows.map((r) => (
                          <button key={r.id} onClick={() => drill([r.id])} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[12.5px] transition-colors hover:border-line2 hover:bg-surface2">
                            <span className={cx('lamp', r.used === null ? 'neg' : toneOf(r.used), (r.used === null || r.used >= 100) && 'pulse')} />
                            <span className="min-w-0 flex-1 truncate"><span className="num mr-1.5 text-muted">{r.account?.code}</span>{r.account?.name ?? 'Account not available'}</span>
                            <span className="flex-none text-right"><Money value={r.actual} currency={ccy} compact /> <span className="text-muted">of</span> <Money value={r.ytd} currency={ccy} compact className="text-violet" /></span>
                            <span className={cx('num w-[58px] flex-none text-right', r.used === null ? 'text-neg' : TEXT[toneOf(r.used)])}>{r.used === null ? 'no budget' : fmtPct(r.used)}</span>
                          </button>
                        ))}
                      </div>
                    </Section>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <Modal open={approving} onClose={() => setApproving(false)} title="Approve this budget" width={500}
        footer={<>
          <button className="btn ghost" onClick={() => setApproving(false)}>Cancel</button>
          <button className="btn good" disabled={busy} onClick={() => { setApproving(false); void act(() => api.setBudgetStatus(budget.id, 'approved'), 'Budget approved') }}><BadgeCheck size={14} /> Approve</button>
        </>}>
        <p className="m-0 text-[13px] text-ink2">
          <b className="text-ink">{budget.name}</b> v{budget.version} for {fyName(budget.fy, startMonth)} will be approved{calc ? <> with a full-year total of <Money value={calc.total.full} currency={ccy} className="text-violet" /></> : null}.
          Once approved it can no longer be edited; later changes are made through a revised version.
        </p>
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ editor
const AMOUNT = /^\d+(\.\d{1,2})?$/
const clean = (v: string) => v.replace(/,/g, '').trim()
const validAmount = (v: string) => clean(v) === '' || AMOUNT.test(clean(v))
const blank12 = () => Array.from({ length: 12 }, () => '')

function BudgetEditor({ seed, companies, onClose, onSaved }: { seed: EditorSeed; companies: Company[]; onClose: () => void; onSaved: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const allCompanies = useApp((s) => s.companies)
  const toast = useApp((s) => s.toast)
  const { act, busy } = useAction()
  const locked = seed.mode !== 'new'

  const [companyId, setCompanyId] = useState<ID>(seed.budget?.company_id ?? companies[0]?.id ?? '')
  const company = allCompanies.find((c) => c.id === companyId)
  const startMonth = company?.fy_start_month ?? 4
  const [name, setName] = useState(seed.budget?.name ?? '')
  const [fyText, setFyText] = useState(String(seed.budget?.fy ?? fiscalYearOf(today(), startMonth)))
  const [kind, setKind] = useState<'opex' | 'capex'>(seed.budget?.kind ?? 'opex')
  const [limitMode, setLimitMode] = useState<'soft' | 'hard'>(seed.budget?.limit_mode ?? 'soft')
  const [start, setStart] = useState<'zero' | 'last_year'>('zero')
  const [prefilled, setPrefilled] = useState<string | null>(null)
  const [loadingActuals, setLoadingActuals] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<ID>>(new Set())
  const [quick, setQuick] = useState<Record<ID, string>>({})

  const fy = /^\d{4}$/.test(fyText.trim()) ? Number(fyText.trim()) : NaN
  const fyOk = Number.isInteger(fy) && fy >= 1990 && fy <= 2999
  const months = useMemo(() => (fyOk ? fyMonths(fy, startMonth) : []), [fy, fyOk, startMonth])

  const [grid, setGrid] = useState<Record<ID, string[]>>(() => {
    const g: Record<ID, Decimal[]> = {}
    const b = seed.budget
    if (!b || !seed.lines) return {}
    const ms = fyMonths(b.fy, allCompanies.find((c) => c.id === b.company_id)?.fy_start_month ?? 4)
    for (const l of seed.lines) {
      const i = ms.indexOf(l.period_month.slice(0, 10))
      if (i < 0) continue
      g[l.account_id] = g[l.account_id] ?? Array.from({ length: 12 }, () => ZERO)
      g[l.account_id][i] = g[l.account_id][i].plus(D(l.amount))
    }
    return Object.fromEntries(Object.entries(g).map(([id, v]) => [id, v.map((x) => (x.isZero() ? '' : x.toFixed(2).replace(/\.00$/, '')))]))
  })
  const outOfYear = seed.lines && seed.budget ? seed.lines.filter((l) => !fyMonths(seed.budget!.fy, startMonth).includes(l.period_month.slice(0, 10))).length : 0
  const hadUnits = !!seed.lines?.some((l) => !!l.org_unit_id)

  const rows = useMemo(() => accounts
    .filter((a) => a.company_id === companyId && !a.is_group && ((a.is_active && (a.type === 'expense' || (kind === 'capex' && a.subtype === 'fixed_asset'))) || !!grid[a.id]))
    .sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId, kind, grid])
  const needle = q.trim().toLowerCase()
  const visible = needle ? rows.filter((a) => a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)) : rows

  const cells = (id: ID) => grid[id] ?? blank12()
  const annual = (id: ID) => sum(cells(id).map((v) => (validAmount(v) ? clean(v) : 0)))
  const uniform = (id: ID) => { const c = cells(id); return c.every((v) => clean(v) === clean(c[0])) ? clean(c[0]) : null }
  const setCell = (id: ID, i: number, v: string) => setGrid((g) => { const c = [...(g[id] ?? blank12())]; c[i] = v; return { ...g, [id]: c } })
  const applyAll = (id: ID) => {
    const v = quick[id]
    if (v === undefined || !validAmount(v)) return
    setGrid((g) => ({ ...g, [id]: Array.from({ length: 12 }, () => clean(v)) }))
    setQuick((s) => { const n = { ...s }; delete n[id]; return n })
  }
  const pendingIds = Object.keys(quick).filter((id) => rows.some((a) => a.id === id))
  const applyPending = () => pendingIds.forEach(applyAll)

  const invalidCells = rows.reduce((n, a) => n + cells(a.id).filter((v) => !validAmount(v)).length, 0) + pendingIds.filter((id) => !validAmount(quick[id])).length
  const filled = rows.filter((a) => annual(a.id).gt(0))
  const grand = sum(filled.map((a) => annual(a.id)))

  const changeCompany = (id: ID) => { setCompanyId(id); setGrid({}); setQuick({}); setOpen(new Set()); setStart('zero'); setPrefilled(null) }

  const startFromZero = () => { setStart('zero'); setGrid({}); setQuick({}); setPrefilled(null) }
  const startFromLastYear = async () => {
    if (!fyOk || !companyId) return
    setStart('last_year')
    setLoadingActuals(true)
    try {
      const from = fyMonths(fy - 1, startMonth)[0]
      const to = addDays(addMonths(from, 12), -1)
      const bals = await api.ledgerBalances([companyId], from, to)
      const g: Record<ID, string[]> = {}
      for (const a of rows) {
        const actual = bals.filter((r) => r.account_id === a.id).reduce((s, r) => s.plus(D(r.period_debit)).minus(D(r.period_credit)), ZERO)
        if (actual.lte(0)) continue
        const monthly = actual.div(12).div(1000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(1000)
        if (monthly.gt(0)) g[a.id] = Array.from({ length: 12 }, () => monthly.toFixed(0))
      }
      setGrid(g); setQuick({})
      setPrefilled(`${Object.keys(g).length} account${Object.keys(g).length === 1 ? '' : 's'} pre-filled from the recorded actuals of ${fyName(fy - 1, startMonth)} (${fmtDate(from)} – ${fmtDate(to)}), divided by 12 and rounded to the nearest 1,000.`)
    } catch (e) {
      toast('error', 'Last year\'s actuals could not be loaded', e instanceof Error ? e.message : String(e))
      setStart('zero')
    } finally {
      setLoadingActuals(false)
    }
  }

  const mayEdit = !!companyId && can('budget.edit', companyId)
  const problems: string[] = []
  if (!companyId) problems.push('Choose a company.')
  if (!name.trim()) problems.push('Give the budget a name.')
  if (!fyOk) problems.push('Enter the fiscal year as a four-digit year.')
  if (invalidCells) problems.push(`${invalidCells} amount${invalidCells === 1 ? ' is' : 's are'} not valid. Amounts must be positive numbers with at most 2 decimal places.`)
  if (pendingIds.length) problems.push(`${pendingIds.length} monthly amount${pendingIds.length === 1 ? ' has' : 's have'} been typed but not applied.`)
  if (!filled.length && !invalidCells && !pendingIds.length) problems.push('Enter an amount for at least one account.')
  if (!mayEdit && companyId) problems.push('You need the "budget.edit" permission for this company.')

  const save = async () => {
    if (problems.length || !fyOk) return
    const lines = filled.flatMap((a) => cells(a.id).map((v, i) => ({ account_id: a.id, period_month: months[i], amount: D(clean(v)).toFixed(2) })))
    const base = { company_id: companyId, name: name.trim(), fy, kind, limit_mode: limitMode, lines }
    const old = seed.budget
    const id = seed.mode === 'revise' && old
      ? await act(async () => { const n = await api.saveBudget(base); await api.setBudgetStatus(old.id, 'revised'); return n }, 'Revised version saved as a new draft')
      : await act(() => api.saveBudget(seed.mode === 'edit' && old ? { ...base, id: old.id } : base), 'Budget saved as a draft')
    if (id) onSaved(id)
  }

  const title = seed.mode === 'new' ? 'New budget' : seed.mode === 'edit' ? 'Edit draft budget' : 'Create revised version'

  return (
    <Modal open onClose={onClose} title={title} width={1040}
      subtitle={seed.mode === 'revise' ? `A new version of "${seed.budget?.name}" is saved as a draft. Version ${seed.budget?.version} is kept and marked as revised.` : 'Saved as a draft. A budget takes effect only after approval.'}
      footer={<>
        <div className="mr-auto flex items-center gap-2 text-[12.5px] text-ink2"><Truth state="BUDGET" /> Full-year total <Money value={grand} currency={company?.base_currency} className="text-violet" /> across <span className="num">{filled.length}</span> account{filled.length === 1 ? '' : 's'}</div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={problems.length > 0 || busy} title={problems[0]} onClick={() => void save()}><FilePlus2 size={14} /> {seed.mode === 'revise' ? 'Save revised version' : 'Save draft'}</button>
      </>}>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Company" className="lg:col-span-2">
          <select className="field" value={companyId} disabled={locked} onChange={(e) => changeCompany(e.target.value)}>
            {!companies.some((c) => c.id === companyId) && company && <option value={company.id}>{company.code} · {company.name}</option>}
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Name" className="lg:col-span-2" hint={seed.mode === 'revise' ? 'A revised version keeps the name of the budget it replaces' : undefined}>
          <input className="field" value={name} disabled={seed.mode === 'revise'} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operating budget" />
        </Field>
        <Field label="Fiscal year" hint={fyOk ? `${fyName(fy, startMonth)} · starts ${fmtDate(months[0])}` : 'Year in which the fiscal year starts'}>
          <input className="field num" inputMode="numeric" value={fyText} disabled={locked} onChange={(e) => setFyText(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as 'opex' | 'capex')}>
            <option value="opex">Opex — operating expenses</option>
            <option value="capex">Capex — capital expenditure</option>
          </select>
        </Field>
        <Field label="Limit mode">
          <select className="field" value={limitMode} onChange={(e) => setLimitMode(e.target.value as 'soft' | 'hard')}>
            <option value="soft">Soft limit</option>
            <option value="hard">Hard limit</option>
          </select>
        </Field>
      </div>

      {seed.mode === 'new' && (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <button onClick={startFromZero} aria-pressed={start === 'zero'} className={cx('rounded-xl border px-4 py-3 text-left transition-colors', start === 'zero' ? 'border-gold/50 bg-goldsoft' : 'border-line bg-surface hover:border-line2')}>
            <div className="text-[13px] font-medium text-ink">Start from zero (zero-based budgeting)</div>
            <div className="mt-0.5 text-[12px] text-muted">Every amount is entered and justified afresh.</div>
          </button>
          <button onClick={() => void startFromLastYear()} disabled={!fyOk || !companyId || loadingActuals} aria-pressed={start === 'last_year'} className={cx('rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50', start === 'last_year' ? 'border-gold/50 bg-goldsoft' : 'border-line bg-surface hover:border-line2')}>
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">Start from last year's actuals {loadingActuals && <Spinner size={13} />}</div>
            <div className="mt-0.5 text-[12px] text-muted">Monthly amount = last fiscal year's recorded actual ÷ 12, rounded to the nearest 1,000.</div>
          </button>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {prefilled && <Note>{prefilled} These are starting points for a plan, not accounting facts — review every amount before saving.</Note>}
        {hadUnits && <Note kind="warn">Some lines of the current version are allocated to departments or units. This editor works by account: amounts are shown in total per account, and the saved version will not carry the unit allocation.</Note>}
        {outOfYear > 0 && <Note kind="warn"><span className="num">{outOfYear}</span> line{outOfYear === 1 ? '' : 's'} of the current version fall outside the twelve months of the fiscal year and are not shown.</Note>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field sm" style={{ width: 260, paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an account…" aria-label="Find an account" />
        </div>
        {pendingIds.length > 0 && <button className="btn sm" onClick={applyPending}>Apply {pendingIds.length} pending amount{pendingIds.length === 1 ? '' : 's'} to all 12 months</button>}
      </div>

      <div className="mt-2.5 overflow-hidden rounded-xl border border-line">
        {rows.length === 0 ? (
          <Empty title="No accounts to budget" body={kind === 'capex' ? 'This company has no active expense or fixed-asset posting accounts.' : 'This company has no active expense posting accounts.'} />
        ) : visible.length === 0 ? (
          <Empty title="No account matches" body="Clear the search to see every account." />
        ) : (
          <div className="max-h-[46vh] overflow-auto">
            {visible.map((a) => {
              const isOpen = open.has(a.id)
              const u = uniform(a.id)
              const typed = quick[a.id]
              const total = annual(a.id)
              return (
                <div key={a.id} className="border-b border-line last:border-0">
                  <div className="flex flex-wrap items-center gap-2.5 px-3 py-2">
                    <button className="btn sm icon ghost" aria-expanded={isOpen} aria-label={isOpen ? 'Hide months' : 'Show months'} title="Show the twelve months"
                      onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="min-w-[200px] flex-1 truncate text-[13px]"><span className="num mr-2 text-[12px] text-muted">{a.code}</span>{a.name}{!a.is_active && <span className="chip ml-2">inactive</span>}</div>
                    <input className={cx('field sm num text-right', typed !== undefined && !validAmount(typed) && 'border-neg')} style={{ width: 150 }} inputMode="decimal" aria-label={`Monthly amount for ${a.name}`}
                      value={typed ?? u ?? ''} placeholder={u === null ? 'varies by month' : 'Monthly amount'}
                      onChange={(e) => setQuick((s) => ({ ...s, [a.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyAll(a.id) } }} />
                    <button className={cx('btn sm', typed !== undefined && validAmount(typed) ? 'good' : 'ghost')} disabled={typed === undefined || !validAmount(typed)} onClick={() => applyAll(a.id)}>Apply to all 12 months</button>
                    <div className="w-[130px] text-right"><Money value={total} currency={company?.base_currency} dim className="text-violet" /></div>
                  </div>
                  {isOpen && (
                    <div className="grid grid-cols-3 gap-2 bg-surface px-3 pb-3 pt-1 sm:grid-cols-4 lg:grid-cols-6">
                      {cells(a.id).map((v, i) => (
                        <label key={i} className="block">
                          <span className="mb-1 block text-[10.5px] uppercase tracking-[0.1em] text-muted">{months[i] ? fmtMonth(months[i]) : `Month ${i + 1}`}</span>
                          <input className={cx('field sm num text-right', !validAmount(v) && 'border-neg')} inputMode="decimal" value={v} onChange={(e) => setCell(a.id, i, e.target.value)} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {problems.length > 0 && <div className="mt-2.5 text-[12px] text-muted">{problems.join(' ')}</div>}
    </Modal>
  )
}
