import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, ChevronDown, ChevronRight, Users } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { PayrollRun } from '@/engine/opsTypes'
import { newHireCost, peopleCost, workforceOutside, type PersonCost } from '@/engine/ops'
import { useApp, useCurrency, usePeriod } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { statements } from '@/lib/data'
import { D, ZERO, fmtPct, sum } from '@/lib/money'
import { fmtDate, startOfMonth } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Money, Note, PageHeader, Panel, Section, Truth } from '@/ui/kit'
import { Stat, useCompanyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart } from '@/ui/charts'
import { monthName, PayrollDenied, RESTRICTED_NOTE, usePayrollIds } from './Payroll'

// =====================================================================
// People cost universe (spec 1197-1230).
// These figures describe cost. They are never a measure of a person's
// performance. Forecasts and estimates are always labelled.
// =====================================================================

/** the data layer returns at most 1,000 entries a call; the period is read page by page up to this many */
const LEDGER_PAGE = 1000
const LEDGER_MAX = 20000
const foot = 'border-t border-line2 px-[14px] py-[10px]'
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const OUTSIDE_LABEL: Record<string, string> = { consultant: 'Consultants', freelancer: 'Freelancers', contractor: 'Contractors', subcontractor: 'Subcontractors', agent: 'Agents' }

interface DeptRow { id: ID | null; name: string; headcount: number; salary: Decimal; total: Decimal }
interface WorkforceRow { key: string; label: string; people: number; amount: Decimal; basis: string }

export default function PeopleCost() {
  const ids = usePayrollIds()
  if (!ids.length) return <PayrollDenied title="People cost" eyebrow="People" />
  return <PeopleCostView ids={ids} />
}

function PeopleCostView({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const currency = useCurrency()
  const period = usePeriod()
  const unitName = useUnitName()
  const companyName = useCompanyName()
  const { from, to } = period
  const idsKey = ids.join(',')

  const [open, setOpen] = useState<Set<ID>>(new Set())
  const [hire, setHire] = useState({ count: '1', monthlySalary: '', employerPct: '', recruitmentFee: '', equipment: '', softwareMonthly: '', benefitsMonthly: '', training: '', travel: '' })

  const payroll = useAsync(async () => {
    const [runs, lines, employees] = await Promise.all([api.listPayrollRuns(ids), api.getPayrollLines({ companyIds: ids, from, to }), api.listEmployees(ids)])
    return { runs, lines, employees }
  }, [api, idsKey, from, to])
  const ledger = useAsync(async () => {
    const first = await api.ledgerLines({ company_ids: ids, from, to, limit: LEDGER_PAGE })
    const rows = [...first.rows]
    while (rows.length < first.total && rows.length < LEDGER_MAX) {
      const next = await api.ledgerLines({ company_ids: ids, from, to, limit: LEDGER_PAGE, offset: rows.length })
      if (!next.rows.length) break
      rows.push(...next.rows)
    }
    return { ...first, rows }
  }, [api, idsKey, from, to])
  const revenue = useAsync(async () => (await statements(api, companies, accounts, ids, from, to)).pl.revenue, [api, idsKey, from, to, companies, accounts])

  const rows = useMemo(() => ledger.data?.rows ?? [], [ledger.data])
  const runsInPeriod = useMemo(() => (payroll.data?.runs ?? []).filter((r) => r.period_month >= startOfMonth(from) && r.period_month <= to), [payroll.data, from, to])
  const cost = useMemo(() => (payroll.data ? peopleCost(runsInPeriod, payroll.data.lines, payroll.data.employees, parties, rows) : null), [payroll.data, runsInPeriod, parties, rows])
  const outside = useMemo(() => workforceOutside(rows, parties, ids), [rows, parties, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const lastRuns = useMemo(() => {
    const m = new Map<ID, PayrollRun>()
    for (const r of payroll.data?.runs ?? []) if (r.run_type === 'regular' && (r.status === 'posted' || r.status === 'paid') && (m.get(r.company_id)?.period_month ?? '') < r.period_month) m.set(r.company_id, r)
    return [...m.values()]
  }, [payroll.data])

  const header = (
    <PageHeader
      eyebrow="People"
      title="People cost"
      subtitle={<>{period.label} · {fmtDate(from)} to {fmtDate(to)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · what people cost the business, beyond salary{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
      actions={<button className="btn ghost" onClick={() => nav('/payroll')}><ArrowLeft size={15} /> Payroll</button>}
    />
  )
  if (payroll.error) return <div>{header}<ErrorBox message={payroll.error} retry={payroll.reload} /></div>
  if (!payroll.data || !cost) return <div>{header}<Panel><Loading rows={7} label="Loading people cost" /></Panel></div>

  const t = cost.totals
  const countedRuns = runsInPeriod.filter((r) => r.status === 'posted' || r.status === 'paid')
  const runsTotal = sum(countedRuns.map((r) => D(r.gross).plus(r.employer_cost)))
  const shownPayroll = t.salary.plus(t.variable).plus(t.employer)
  const restricted = runsTotal.minus(shownPayroll)

  const people = cost.people.filter((p) => p.total.gt(0) || !p.direct.isZero())
  const departments: DeptRow[] = cost.byDepartment.filter((d) => d.headcount > 0 || !d.total.isZero()).map((d) => ({ id: d.department_id, name: d.department_id ? unitName(d.department_id) : 'No department', headcount: d.headcount, salary: d.salary, total: d.total }))

  const outsideTotal = sum(outside.map((o) => o.amount))
  const workforce: WorkforceRow[] = [
    { key: 'employees', label: 'Employees', people: t.headcount, amount: t.total, basis: 'Posted payroll and direct costs' },
    ...outside.map((o) => ({ key: o.type, label: OUTSIDE_LABEL[o.type] ?? o.type, people: o.people, amount: o.amount, basis: 'Expense entries recorded against the party' })),
  ]
  const grandTotal = t.total.plus(outsideTotal)

  const rev = revenue.data ?? null
  const ratio = rev && !rev.isZero() ? t.total.div(rev).times(100) : null
  const perEmployee = rev && t.headcount > 0 ? rev.div(t.headcount) : null

  const monthly = sum(lastRuns.map((r) => D(r.gross).plus(r.employer_cost)))

  const count = Math.max(1, Math.floor(Number(hire.count) || 1))
  const estimate = newHireCost({ count, monthlySalary: hire.monthlySalary || 0, employerPct: hire.employerPct || 0, recruitmentFee: hire.recruitmentFee || 0, equipment: hire.equipment || 0, softwareMonthly: hire.softwareMonthly || 0, benefitsMonthly: hire.benefitsMonthly || 0, training: hire.training || 0, travel: hire.travel || 0 })
  const setH = (k: keyof typeof hire, v: string) => setHire((x) => ({ ...x, [k]: v }))

  const toggle = (id: ID) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const deptColumns: Column<DeptRow>[] = [
    { key: 'dept', header: 'Department', render: (r) => <span className="text-ink">{r.name}</span>, sort: (r) => r.name.toLowerCase(), csv: (r) => r.name },
    { key: 'head', header: 'Headcount', align: 'right', render: (r) => <span className="num">{r.headcount}</span>, sort: (r) => r.headcount, csv: (r) => r.headcount },
    { key: 'salary', header: 'Salary', align: 'right', render: (r) => <Money value={r.salary} dim />, sort: (r) => r.salary.toNumber(), csv: (r) => r.salary.toFixed(2) },
    { key: 'total', header: 'Total people cost', align: 'right', render: (r) => <Money value={r.total} className="text-ink" />, sort: (r) => r.total.toNumber(), csv: (r) => r.total.toFixed(2) },
  ]

  const personColumns: Column<PersonCost>[] = [
    {
      key: 'open', header: '', width: 40,
      render: (p) => (p.directBreakdown.length ? <button className="btn ghost icon sm" aria-expanded={open.has(p.employee_id)} aria-label={`${open.has(p.employee_id) ? 'Hide' : 'Show'} the direct costs of ${p.name} by ledger`} onClick={(e) => { e.stopPropagation(); toggle(p.employee_id) }}>{open.has(p.employee_id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : null),
    },
    { key: 'no', header: 'Employee no', render: (p) => <span className="num text-[12.5px] text-gold">{p.emp_no}</span>, sort: (p) => p.emp_no, csv: (p) => p.emp_no },
    {
      key: 'name', header: 'Name', sort: (p) => p.name.toLowerCase(), csv: (p) => p.name,
      render: (p) => (
        <div className="min-w-[180px]">
          <div className="text-ink">{p.name}</div>
          {open.has(p.employee_id) && p.directBreakdown.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <div className="eyebrow mb-1">Direct costs by ledger</div>
              {[...p.directBreakdown].sort((a, b) => b.amount.cmp(a.amount)).map((b) => (
                <div key={b.account} className="flex items-baseline justify-between gap-4 py-[2px] text-[12px]"><span className="text-ink2">{b.account}</span><Money value={b.amount} /></div>
              ))}
            </div>
          )}
        </div>
      ),
    },
    { key: 'dept', header: 'Department', render: (p) => <span className="text-ink2">{unitName(p.department_id)}</span>, sort: (p) => unitName(p.department_id), csv: (p) => (p.department_id ? unitName(p.department_id) : '') },
    { key: 'type', header: 'Employment type', render: (p) => <span className="text-[12.5px] text-ink2">{p.employment_type}</span>, sort: (p) => p.employment_type, csv: (p) => p.employment_type },
    { key: 'salary', header: 'Salary', align: 'right', render: (p) => <Money value={p.salary} dim />, sort: (p) => p.salary.toNumber(), csv: (p) => p.salary.toFixed(2) },
    { key: 'variable', header: 'Variable pay', align: 'right', render: (p) => <Money value={p.variable} dim />, sort: (p) => p.variable.toNumber(), csv: (p) => p.variable.toFixed(2) },
    { key: 'employer', header: 'Employer cost', align: 'right', render: (p) => <Money value={p.employer} dim />, sort: (p) => p.employer.toNumber(), csv: (p) => p.employer.toFixed(2) },
    { key: 'direct', header: 'Direct costs', align: 'right', render: (p) => <Money value={p.direct} dim />, sort: (p) => p.direct.toNumber(), csv: (p) => p.direct.toFixed(2) },
    { key: 'total', header: 'Total', align: 'right', render: (p) => <Money value={p.total} className="font-medium text-ink" />, sort: (p) => p.total.toNumber(), csv: (p) => p.total.toFixed(2) },
  ]

  const workforceColumns: Column<WorkforceRow>[] = [
    { key: 'group', header: 'Group', render: (r) => <span className="text-ink">{r.label}</span>, csv: (r) => r.label },
    { key: 'basis', header: 'Taken from', render: (r) => <span className="text-[12.5px] text-ink2">{r.basis}</span>, csv: (r) => r.basis },
    { key: 'people', header: 'People', align: 'right', render: (r) => <span className="num">{r.people}</span>, sort: (r) => r.people, csv: (r) => r.people },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} className="text-ink" />, sort: (r) => r.amount.toNumber(), csv: (r) => r.amount.toFixed(2) },
  ]

  return (
    <div>
      {header}
      <Note className="mb-4">{RESTRICTED_NOTE}</Note>

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Salary" value={t.salary} currency={currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> posted payroll</span>} />
        <Stat label="Variable pay" value={t.variable} currency={currency} sub="bonus, incentive, commission, overtime, arrears" />
        <Stat label="Employer cost" value={t.employer} currency={currency} sub="contributions borne by the company" />
        <Stat label="Direct costs" value={t.direct} currency={currency} sub="expense entries recorded against the person" />
        <Stat label="Total people cost" value={t.total} currency={currency} tone="gold" sub={`${countedRuns.length} posted run${countedRuns.length === 1 ? '' : 's'} in the period`} />
        <Stat label="Headcount" value={t.headcount} count sub="people with a cost in the period" />
      </div>

      <Note className="mb-4"><ul className="m-0 list-disc space-y-0.5 pl-4">{cost.notes.map((n) => <li key={n}>{n}</li>)}</ul></Note>
      {restricted.gt(0) && <Note kind="warn" className="mb-4">The posted payroll runs of the period come to <Money value={runsTotal} />. <Money value={restricted} /> of that belongs to records that are restricted and not shown to you; it is not part of the figures on this page.</Note>}
      {ledger.error && <Note kind="warn" className="mb-4">Direct costs and spending on people who are not employees could not be loaded, and are shown as zero: {ledger.error}</Note>}
      {ledger.data && ledger.data.total > ledger.data.rows.length && <Note kind="warn" className="mb-4">Direct costs are calculated from the first {ledger.data.rows.length.toLocaleString()} entries of the period. The period holds {ledger.data.total.toLocaleString()} entries, so direct costs and spending on people who are not employees may be understated. Choose a shorter period or fewer companies for complete figures.</Note>}
      {ledger.data && ledger.data.restricted.count > 0 && <Note className="mb-4">{ledger.data.restricted.count.toLocaleString()} ledger entr{ledger.data.restricted.count === 1 ? 'y is' : 'ies are'} classified above your clearance and {ledger.data.restricted.count === 1 ? 'is' : 'are'} not part of direct costs.</Note>}

      <div className="space-y-5">
        <Section title="By department">
          {departments.length === 0 ? (
            <Panel lit={false}><Empty icon={<Users size={20} />} title="No people cost in this period" body="No payroll run has been posted for the period, and no expense entry is recorded against an employee. Choose another period, or post a payroll run." action={<button className="btn sm" onClick={() => nav('/payroll')}>Open Payroll</button>} /></Panel>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel className="p-4" lit={false}>
                <BarChart stacked data={departments.map((d) => ({ label: d.name, values: [{ key: 'Salary', value: d.salary.toNumber() }, { key: 'Variable pay, employer cost and direct costs', value: Decimal.max(d.total.minus(d.salary), 0).toNumber() }] }))} />
              </Panel>
              <Panel lit={false}>
                <DataTable columns={deptColumns} rows={departments} rowKey={(r) => r.id ?? 'none'} exportName="people-cost-by-department" initialSort={{ key: 'total', dir: 'desc' }}
                  footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total</td><td className={cx(foot, 'r num')}>{t.headcount}</td><td className={cx(foot, 'r')}><Money value={t.salary} /></td><td className={cx(foot, 'r')}><Money value={t.total} className="font-medium text-ink" /></td></tr>} />
              </Panel>
            </div>
          )}
        </Section>

        <Section title="By person" right={<span className="chip violet" title="Shown only to holders of payroll.view">restricted</span>}>
          <Panel lit={false}>
            <DataTable columns={personColumns} rows={people} rowKey={(p) => p.employee_id} onRow={(p) => { if (p.directBreakdown.length) toggle(p.employee_id) }} exportName="people-cost-by-person" initialSort={{ key: 'total', dir: 'desc' }}
              toolbar={<span className="text-[12px] text-muted">These figures describe cost. They are not a measure of any person's performance. Open a row to see direct costs by ledger.</span>}
              footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Total · {people.length} {people.length === 1 ? 'person' : 'people'}</td><td className={cx(foot, 'r')}><Money value={t.salary} /></td><td className={cx(foot, 'r')}><Money value={t.variable} /></td><td className={cx(foot, 'r')}><Money value={t.employer} /></td><td className={cx(foot, 'r')}><Money value={t.direct} /></td><td className={cx(foot, 'r')}><Money value={t.total} className="font-medium text-ink" /></td></tr>}
              empty={{ title: 'Nobody has a cost in this period', body: 'Records classified above your clearance are not sent to you, so they cannot appear here.', icon: <Users size={20} /> }} />
          </Panel>
        </Section>

        <Section title="Total workforce cost" right={<Truth state="ACTUAL" />}>
          <Panel lit={false}>
            <DataTable columns={workforceColumns} rows={workforce} rowKey={(r) => r.key} exportName="total-workforce-cost"
              footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Total workforce cost</td><td className={cx(foot, 'r num')}>{workforce.reduce((n, r) => n + r.people, 0)}</td><td className={cx(foot, 'r')}><Money value={grandTotal} className="font-medium text-ink" /></td></tr>} />
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">People who are not employees are parties recorded as consultant, freelancer, contractor, subcontractor or agent in the selected companies. Their amount is the expense recorded against them in the period{outside.length === 0 ? '; none is recorded' : ''}.</div>
        </Section>

        <Section title="People cost against revenue">
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="p-4">
              <div className="flex items-center gap-2"><span className="eyebrow">People cost ÷ revenue</span>
                <Explain title="People cost ÷ revenue" text="The share of the revenue of the period that was spent on employees: salary, variable pay, employer cost and direct costs." formula="Total people cost ÷ Revenue from operations × 100"
                  inputs={[{ label: 'Total people cost', value: t.total }, { label: 'Revenue from operations', value: rev ?? ZERO }]} source="Source: posted payroll runs, expense entries recorded against employees, and revenue ledgers in the general ledger, for the selected companies and period." />
              </div>
              <div className="display mt-1.5 text-[22px] font-medium text-ink">{revenue.error ? <span className="text-[13px] text-muted">Revenue could not be loaded</span> : !revenue.data ? <span className="text-[13px] text-muted">Loading…</span> : ratio ? <span className="num">{fmtPct(ratio)}</span> : <span className="text-[13px] text-muted">No revenue is recorded in the period</span>}</div>
              <div className="mt-1 text-[11.5px] text-muted">People cost <Money value={t.total} compact /> · revenue {rev ? <Money value={rev} compact /> : '—'}</div>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2"><span className="eyebrow">Revenue per employee</span>
                <Explain title="Revenue per employee" text="The revenue of the period divided by the number of employees who had a cost in the period." formula="Revenue from operations ÷ Employees with a cost in the period"
                  inputs={[{ label: 'Revenue from operations', value: rev ?? ZERO }, { label: 'Employees counted (ratio denominator)', value: t.headcount }]} source="Source: revenue ledgers in the general ledger and posted payroll runs, for the selected companies and period." />
              </div>
              <div className="display mt-1.5 text-[22px] font-medium text-ink">{revenue.error ? <span className="text-[13px] text-muted">Revenue could not be loaded</span> : !revenue.data ? <span className="text-[13px] text-muted">Loading…</span> : perEmployee ? <Money value={perEmployee} compact /> : <span className="text-[13px] text-muted">Nobody had a cost in the period</span>}</div>
              <div className="mt-1 text-[11.5px] text-muted">{t.headcount} employee{t.headcount === 1 ? '' : 's'} counted</div>
            </Panel>
          </div>
          <div className="mt-2 text-[11.5px] text-muted">These ratios describe the business, not any person.{revenue.error ? ` ${revenue.error}` : ''}</div>
        </Section>

        <Section title="Payroll forecast" right={<Truth state="FORECAST" />}>
          {lastRuns.length === 0 ? (
            <Panel lit={false}><Empty title="Nothing to project from" body="A forecast needs at least one regular payroll run that has been posted. None exists in the selected companies." /></Panel>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {[3, 6, 12].map((m) => (
                  <Panel key={m} className="p-4">
                    <div className="flex items-center justify-between gap-2"><span className="eyebrow">Next {m} months</span><Truth state="FORECAST" /></div>
                    <Money value={monthly.times(m)} currency={currency} compact className="display mt-1.5 block text-[22px] font-medium text-ink" />
                    <div className="mt-1 text-[11.5px] text-muted"><Money value={monthly} currency={currency} compact /> a month × {m}</div>
                  </Panel>
                ))}
              </div>
              <Note className="mt-3">
                <div className="font-medium text-ink">Assumptions</div>
                <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4">
                  <li>Each coming month repeats the gross and employer cost of the last regular run that was posted: {lastRuns.map((r) => `${r.run_no} (${monthName(r.period_month)}, ${r.headcount} people${ids.length > 1 ? ', ' + companyName(r.company_id) : ''})`).join('; ')}.</li>
                  <li>Approved increments with a future effective date are not included.</li>
                  <li>Joiners and leavers after that run are not included.</li>
                  <li>Bonuses and other one-off pay in that run are repeated as they were; direct costs are not part of the forecast.</li>
                </ul>
              </Note>
            </>
          )}
        </Section>

        <Section title="New-hire cost model" right={<span className="chip violet" title="Calculated only from the figures entered below. Nothing is read from the books.">ESTIMATE from the figures entered</span>}>
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3" lit={false}>
              <Field label="Number of hires"><input className="field num" inputMode="numeric" value={hire.count} onChange={(e) => setH('count', e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Monthly salary, each"><input className="field num" inputMode="decimal" value={hire.monthlySalary} onChange={(e) => setH('monthlySalary', digits(e.target.value))} /></Field>
              <Field label="Employer cost %" hint="Of salary, as configured by the company"><input className="field num" inputMode="decimal" value={hire.employerPct} onChange={(e) => setH('employerPct', digits(e.target.value))} /></Field>
              <Field label="Recruitment fee, each"><input className="field num" inputMode="decimal" value={hire.recruitmentFee} onChange={(e) => setH('recruitmentFee', digits(e.target.value))} /></Field>
              <Field label="Equipment, each"><input className="field num" inputMode="decimal" value={hire.equipment} onChange={(e) => setH('equipment', digits(e.target.value))} /></Field>
              <Field label="Software per month, each"><input className="field num" inputMode="decimal" value={hire.softwareMonthly} onChange={(e) => setH('softwareMonthly', digits(e.target.value))} /></Field>
              <Field label="Benefits per month, each"><input className="field num" inputMode="decimal" value={hire.benefitsMonthly} onChange={(e) => setH('benefitsMonthly', digits(e.target.value))} /></Field>
              <Field label="Training, each"><input className="field num" inputMode="decimal" value={hire.training} onChange={(e) => setH('training', digits(e.target.value))} /></Field>
              <Field label="Travel, each"><input className="field num" inputMode="decimal" value={hire.travel} onChange={(e) => setH('travel', digits(e.target.value))} /></Field>
            </Panel>
            <Panel className="p-4 text-[13px]" lit={false}>
              <div className="mb-2.5 flex items-center justify-between gap-2"><span className="eyebrow">First year</span><span className="chip violet">ESTIMATE from the figures entered</span></div>
              {D(hire.monthlySalary).lte(0) ? <div className="text-[12.5px] text-muted">Enter the monthly salary to see the estimate.</div> : (
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-ink2">Salary for 12 months</span><Money value={estimate.salary} currency={currency} /></div>
                  <div className="flex justify-between"><span className="text-ink2">Employer cost</span><Money value={estimate.employer} currency={currency} /></div>
                  <div className="flex justify-between"><span className="text-ink2">Software and benefits for 12 months</span><Money value={estimate.recurring} currency={currency} /></div>
                  <div className="flex justify-between"><span className="text-ink2">One-time: recruitment, equipment, training, travel</span><Money value={estimate.oneTime} currency={currency} /></div>
                  <div className="hairline my-2" />
                  <div className="flex justify-between"><span className="text-ink2">First-year cost per person</span><Money value={estimate.perPerson} currency={currency} /></div>
                  <div className="flex items-baseline justify-between"><span className="font-medium">Total for {count} hire{count === 1 ? '' : 's'}</span><Money value={estimate.total} currency={currency} className="display text-[20px] text-gold" /></div>
                  <div className="flex justify-between"><span className="text-ink2">Monthly run rate after joining</span><Money value={estimate.monthlyRunRate} currency={currency} /></div>
                </div>
              )}
              <div className="mt-3 text-[11.5px] text-muted">The estimate uses only the figures entered here. The employer cost percentage is whatever you enter: NUMERO does not decide what is legally due, and professional review remains required. Nothing is saved or posted.</div>
            </Panel>
          </div>
        </Section>
      </div>
    </div>
  )
}
