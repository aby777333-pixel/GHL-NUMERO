import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BadgeCheck, Calculator, Copy, Lock, Plus, Save, Trash2, UserPlus, Users, Wallet, XCircle } from 'lucide-react'
import type { Confidentiality, ID } from '@/engine/types'
import type { ComponentKind, Employee, EmployeeInput, EmploymentType, PayrollRun, PayrollRunInput, SalaryComponent, SalaryStructure, SalaryStructureInput } from '@/engine/opsTypes'
import { advanceOutstanding } from '@/engine/ops'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, fmtMoney, sum } from '@/lib/money'
import { fmtDate, parseISO, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { useCompanyName, usePartyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'

// =====================================================================
// Payroll: runs, employees and salaries.
// Restricted to holders of payroll.view. A run is calculated from
// approved salaries and posts nothing until its entry is proposed and
// approved. An approved salary is never overwritten.
// =====================================================================

type TabKey = 'runs' | 'employees' | 'salaries'
const TABS: { key: TabKey; label: string }[] = [{ key: 'runs', label: 'Payroll runs' }, { key: 'employees', label: 'Employees' }, { key: 'salaries', label: 'Salaries' }]

export const RUN_STATUS_LABEL: Record<PayrollRun['status'], string> = { draft: 'draft', proposed: 'awaiting approval', posted: 'salaries payable', paid: 'paid', reversed: 'reversed', cancelled: 'cancelled' }
export const RUN_TYPE_LABEL: Record<PayrollRun['run_type'], string> = { regular: 'Regular', supplementary: 'Supplementary', full_and_final: 'Full and final' }
export const KIND_LABEL: Record<ComponentKind, string> = { earning: 'Earning', deduction: 'Deduction', employer: 'Employer cost' }
export const RESTRICTED_NOTE = 'Payroll records are restricted. The payroll journal is confidential and is charged by department; no individual salary appears in the general ledger.'
export const STATUTORY_NOTE = 'Statutory amounts such as provident fund and tax deducted are whatever the company has configured. NUMERO does not decide what is legally due; professional review remains required.'
export const monthName = (d: string) => parseISO(d).toLocaleString('en-GB', { month: 'long', year: 'numeric' })

const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
const EMPLOYMENT: EmploymentType[] = ['permanent', 'contract', 'consultant', 'freelancer', 'agency', 'temporary', 'intern', 'advisor']
const EMP_STATUS: Employee['status'][] = ['planned', 'active', 'notice', 'exited']
const PAY_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'UPI', 'Other']
const STRUCTURE_TYPES: Record<ComponentKind, string[]> = { earning: ['fixed', 'bonus', 'incentive', 'commission', 'overtime', 'arrears', 'other'], deduction: ['tax', 'statutory', 'other'], employer: ['statutory', 'benefit'] }
const ADJUSTMENT_TYPES: Record<ComponentKind, string[]> = { earning: ['bonus', 'incentive', 'commission', 'overtime', 'arrears', 'other'], deduction: ['tax', 'statutory', 'advance_recovery', 'loan_recovery', 'other'], employer: ['statutory', 'benefit'] }

const human = (s: string) => s.replace(/_/g, ' ')
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const foot = 'border-t border-line2 px-[14px] py-[10px]'
let seq = 0
const nextKey = () => ++seq

/** Companies in which the viewer holds payroll.view — in the current scope, or across the group. */
export function usePayrollIds(range: 'scope' | 'all' = 'scope'): ID[] {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const companies = useApp((s) => s.companies)
  return (range === 'all' ? companies.map((c) => c.id) : scope).filter((id) => can('payroll.view', id))
}

/** Shown in place of any payroll screen when the viewer lacks payroll.view. No payroll data is requested. */
export function PayrollDenied({ title, eyebrow = 'Payroll' }: { title: string; eyebrow?: string }) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Panel>
        <Empty icon={<Lock size={20} />} title="Payroll records are restricted"
          body={<>This page needs the permission <span className="num text-ink2">payroll.view</span> in at least one of the selected companies. Salary data is shared only with the people who need it; a group administrator can grant access under Team.</>} />
      </Panel>
    </div>
  )
}

export default function Payroll() {
  const ids = usePayrollIds()
  if (!ids.length) return <PayrollDenied title="Payroll" />
  return <PayrollView ids={ids} />
}

function PayrollView({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const idsKey = ids.join(',')

  const tab: TabKey = TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'runs'
  const employeeId = sp.get('employee') ?? ''
  const go = (next: Record<string, string>) => setSp(next, { replace: true })

  const [running, setRunning] = useState(false)
  const [empForm, setEmpForm] = useState<{ open: boolean; employee: Employee | null }>({ open: false, employee: null })

  const runs = useAsync(() => api.listPayrollRuns(ids), [api, idsKey])
  const employees = useAsync(() => api.listEmployees(ids), [api, idsKey])

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const ccyOf = (companyId: ID) => companyById.get(companyId)?.base_currency
  const manageIds = ids.filter((id) => can('payroll.manage', id))
  const noManage = manageIds.length ? undefined : 'You need the permission payroll.manage to do this'

  const runColumns: Column<PayrollRun>[] = [
    { key: 'no', header: 'Run no', render: (r) => <span className="num text-[12.5px] text-gold">{r.run_no}</span>, sort: (r) => r.run_no, csv: (r) => r.run_no },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companyName(r.company_id)}>{companyById.get(r.company_id)?.code ?? '—'}</span>, sort: (r) => companyName(r.company_id), csv: (r) => companyName(r.company_id) },
    { key: 'month', header: 'Month', render: (r) => <span className="text-ink">{monthName(r.period_month)}</span>, sort: (r) => r.period_month, csv: (r) => r.period_month.slice(0, 7) },
    { key: 'type', header: 'Type', render: (r) => <span className="text-[12.5px] text-ink2">{RUN_TYPE_LABEL[r.run_type]}</span>, sort: (r) => r.run_type, csv: (r) => RUN_TYPE_LABEL[r.run_type] },
    { key: 'people', header: 'People', align: 'right', render: (r) => <span className="num">{r.headcount}</span>, sort: (r) => r.headcount, csv: (r) => r.headcount },
    { key: 'gross', header: 'Gross', align: 'right', render: (r) => <Money value={r.gross} currency={ccyOf(r.company_id)} />, sort: (r) => D(r.gross).toNumber(), csv: (r) => D(r.gross).toFixed(2) },
    { key: 'ded', header: 'Deductions', align: 'right', render: (r) => <Money value={r.deductions} currency={ccyOf(r.company_id)} dim />, sort: (r) => D(r.deductions).toNumber(), csv: (r) => D(r.deductions).toFixed(2) },
    { key: 'emp', header: 'Employer cost', align: 'right', render: (r) => <Money value={r.employer_cost} currency={ccyOf(r.company_id)} dim />, sort: (r) => D(r.employer_cost).toNumber(), csv: (r) => D(r.employer_cost).toFixed(2) },
    { key: 'net', header: 'Net', align: 'right', render: (r) => <Money value={r.net} currency={ccyOf(r.company_id)} className="text-ink" />, sort: (r) => D(r.net).toNumber(), csv: (r) => D(r.net).toFixed(2) },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} label={RUN_STATUS_LABEL[r.status]} />, sort: (r) => r.status, csv: (r) => RUN_STATUS_LABEL[r.status] },
    { key: 'left', header: 'Not included', align: 'right', render: (r) => (r.exceptions.length > 0 ? <span className="chip warn" title="People left out of this run, each with the reason">{r.exceptions.length} not included</span> : <span className="text-muted">none</span>), sort: (r) => r.exceptions.length, csv: (r) => r.exceptions.length },
  ]

  const employeeColumns: Column<Employee>[] = [
    { key: 'no', header: 'Employee no', render: (e) => <span className="num text-[12.5px] text-gold">{e.emp_no}</span>, sort: (e) => e.emp_no, csv: (e) => e.emp_no },
    { key: 'name', header: 'Name', render: (e) => <div className="min-w-0"><div className="truncate text-ink">{partyName(e.party_id)}</div><div className="text-[11px] text-muted">{companyById.get(e.company_id)?.code ?? ''}</div></div>, sort: (e) => partyName(e.party_id).toLowerCase(), csv: (e) => partyName(e.party_id) },
    { key: 'designation', header: 'Designation', render: (e) => <span className="text-ink2">{e.designation ?? '—'}</span>, sort: (e) => e.designation ?? '', csv: (e) => e.designation ?? '' },
    { key: 'dept', header: 'Department', render: (e) => <span className="text-ink2">{unitName(e.department_id)}</span>, sort: (e) => unitName(e.department_id), csv: (e) => (e.department_id ? unitName(e.department_id) : '') },
    { key: 'type', header: 'Employment type', render: (e) => <span className="text-[12.5px] text-ink2">{e.employment_type}</span>, sort: (e) => e.employment_type, csv: (e) => e.employment_type },
    { key: 'join', header: 'Joined', render: (e) => <span className="num text-[12.5px]">{fmtDate(e.join_date)}</span>, sort: (e) => e.join_date, csv: (e) => e.join_date },
    { key: 'exit', header: 'Exit', render: (e) => (e.exit_date ? <span className="num text-[12.5px]">{fmtDate(e.exit_date)}</span> : <span className="text-muted">—</span>), sort: (e) => e.exit_date ?? '', csv: (e) => e.exit_date ?? '' },
    { key: 'status', header: 'Status', render: (e) => <StatusChip status={e.status} label={e.status === 'notice' ? 'serving notice' : undefined} />, sort: (e) => e.status, csv: (e) => e.status },
    { key: 'conf', header: 'Confidentiality', render: (e) => (e.confidentiality !== 'internal' ? <span className="chip violet">{human(e.confidentiality)}</span> : <span className="text-muted">—</span>), sort: (e) => e.confidentiality, csv: (e) => e.confidentiality },
    { key: 'salary', header: '', align: 'right', render: (e) => <button className="btn sm ghost" onClick={(ev) => { ev.stopPropagation(); go({ tab: 'salaries', employee: e.id }) }}><Wallet size={13} /> Salary</button> },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Payroll"
        subtitle={<>{ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · runs are calculated from approved salaries and post nothing until the entry is proposed and approved{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
        actions={<>
          <button className="btn" onClick={() => nav('/payroll/people-cost')}><Users size={15} /> People cost</button>
          <button className="btn" disabled={!manageIds.length} title={noManage} onClick={() => setEmpForm({ open: true, employee: null })}><UserPlus size={15} /> Add employee</button>
          <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setRunning(true)}><Calculator size={15} /> Run payroll</button>
        </>}
      />
      <Note className="mb-4">{RESTRICTED_NOTE}</Note>

      <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'runs' ? runs.data?.length : t.key === 'employees' ? employees.data?.length : undefined }))} value={tab} onChange={(k) => go(k === 'salaries' && employeeId ? { tab: k, employee: employeeId } : { tab: k })} />

      {tab === 'runs' && (
        runs.error ? <ErrorBox message={runs.error} retry={runs.reload} />
          : !runs.data ? <Panel><Loading rows={5} label="Loading payroll runs" /></Panel>
          : (
            <>
              <Panel lit={false}>
                <DataTable columns={runColumns} rows={runs.data} rowKey={(r) => r.id} onRow={(r) => nav('/payroll/runs/' + r.id)} exportName="payroll-runs" initialSort={{ key: 'month', dir: 'desc' }}
                  empty={{ title: 'No payroll has been run', body: 'Record the employees and have their salaries approved, then run the payroll for a month. The run is a calculation; nothing is posted until its entry is proposed and approved.', icon: <Calculator size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setRunning(true)}><Calculator size={13} /> Run payroll</button> }} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">The totals of a run include every person in it. Records classified above your clearance are counted in the totals but are not shown to you individually.</div>
            </>
          )
      )}

      {tab === 'employees' && (
        employees.error ? <ErrorBox message={employees.error} retry={employees.reload} />
          : !employees.data ? <Panel><Loading rows={5} label="Loading employees" /></Panel>
          : (
            <>
              <Panel lit={false}>
                <DataTable columns={employeeColumns} rows={employees.data} rowKey={(e) => e.id} exportName="employees" initialSort={{ key: 'no', dir: 'asc' }}
                  onRow={(e) => (can('payroll.manage', e.company_id) ? setEmpForm({ open: true, employee: e }) : go({ tab: 'salaries', employee: e.id }))}
                  empty={{ title: 'No employee is recorded', body: 'Add each employee from the party register, with the joining date, department and employment type.', icon: <Users size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setEmpForm({ open: true, employee: null })}><UserPlus size={13} /> Add employee</button> }} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">A record with a confidentiality level above your clearance is not sent to you, so it does not appear in this list.</div>
            </>
          )
      )}

      {tab === 'salaries' && (
        employees.error ? <ErrorBox message={employees.error} retry={employees.reload} />
          : !employees.data ? <Panel><Loading rows={5} label="Loading employees" /></Panel>
          : <Salaries employees={employees.data} employeeId={employeeId} onChoose={(id) => go(id ? { tab: 'salaries', employee: id } : { tab: 'salaries' })} />
      )}

      <RunPayrollModal open={running} onClose={() => setRunning(false)} ids={ids} employees={employees.data ?? []} />
      <EmployeeForm open={empForm.open} employee={empForm.employee} ids={ids} onClose={() => setEmpForm((x) => ({ ...x, open: false }))} />
    </div>
  )
}

// =====================================================================
// Salaries: history per employee, revisions and approval
// =====================================================================
function Salaries({ employees, employeeId, onChoose }: { employees: Employee[]; employeeId: ID; onChoose: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const unitName = useUnitName()
  const { act, busy } = useAction()
  const asOf = today()

  const employee = employees.find((e) => e.id === employeeId) ?? null
  const list = useAsync(async () => (employee ? api.listSalaryStructures({ employeeId: employee.id }) : []), [api, employee?.id])
  const [selected, setSelected] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const [rejecting, setRejecting] = useState<SalaryStructure | null>(null)
  useEffect(() => { setSelected(null) }, [employeeId])

  const currency = companies.find((c) => c.id === employee?.company_id)?.base_currency
  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at)), [list.data])
  const inForce = rows.find((s) => s.status === 'approved' && s.effective_from <= asOf) ?? null
  const shown = rows.find((s) => s.id === selected) ?? inForce ?? rows[0] ?? null

  const manage = !!employee && can('payroll.manage', employee.company_id)
  const approve = !!employee && can('payroll.approve', employee.company_id)
  const override = session?.group?.settings.controls?.maker_checker === 'owner_override' && session.isGroupAdmin
  const own = (s: SalaryStructure) => !!s.created_by && s.created_by === session?.user.id && !override
  const whyNot = (s: SalaryStructure) => (!approve ? 'You need the permission payroll.approve in this company' : own(s) ? 'You entered this salary. A second person must approve it.' : undefined)

  const state = (s: SalaryStructure) => {
    if (s.status === 'draft') return <StatusChip status="pending" label="awaiting approval" />
    if (s.status === 'rejected') return <StatusChip status="rejected" />
    if (inForce && s.id === inForce.id) return <span className="chip pos">in force</span>
    if (s.effective_from > asOf) return <span className="chip cyan">takes effect on {fmtDate(s.effective_from)}</span>
    return <span className="chip" title="A later approved salary has replaced it. The record is kept.">approved · superseded</span>
  }
  const stateText = (s: SalaryStructure) => (s.status === 'draft' ? 'awaiting approval' : s.status === 'rejected' ? 'rejected' : inForce && s.id === inForce.id ? 'approved — in force' : s.effective_from > asOf ? `approved — takes effect on ${s.effective_from}` : 'approved — superseded')

  const columns: Column<SalaryStructure>[] = [
    { key: 'from', header: 'Effective from', render: (s) => <span className="num text-[12.5px] text-ink">{fmtDate(s.effective_from)}</span>, sort: (s) => s.effective_from, csv: (s) => s.effective_from },
    { key: 'gross', header: 'Monthly gross', align: 'right', render: (s) => <Money value={s.monthly_gross} currency={currency} />, sort: (s) => D(s.monthly_gross).toNumber(), csv: (s) => D(s.monthly_gross).toFixed(2) },
    { key: 'ded', header: 'Deductions', align: 'right', render: (s) => <Money value={s.monthly_deductions} currency={currency} dim />, sort: (s) => D(s.monthly_deductions).toNumber(), csv: (s) => D(s.monthly_deductions).toFixed(2) },
    { key: 'emp', header: 'Employer cost', align: 'right', render: (s) => <Money value={s.monthly_employer} currency={currency} dim />, sort: (s) => D(s.monthly_employer).toNumber(), csv: (s) => D(s.monthly_employer).toFixed(2) },
    { key: 'net', header: 'Net', align: 'right', render: (s) => <Money value={s.monthly_net} currency={currency} className="text-ink" />, sort: (s) => D(s.monthly_net).toNumber(), csv: (s) => D(s.monthly_net).toFixed(2) },
    { key: 'ctc', header: 'Annual cost to company', align: 'right', render: (s) => <Money value={s.annual_ctc} currency={currency} />, sort: (s) => D(s.annual_ctc).toNumber(), csv: (s) => D(s.annual_ctc).toFixed(2) },
    { key: 'reason', header: 'Reason', render: (s) => <span className="text-[12.5px] text-ink2">{s.reason}</span>, csv: (s) => s.reason },
    { key: 'status', header: 'Status', render: (s) => state(s), sort: (s) => s.status, csv: (s) => stateText(s) },
  ]

  return (
    <div className="space-y-4">
      <Note>An approved salary is never overwritten. To change a salary, record a revision with a new effective date. The earlier records stay as history.</Note>
      <Panel className="flex flex-wrap items-end gap-3 p-4" lit={false}>
        <Field label="Employee" className="min-w-[280px] flex-1">
          <select className="field" value={employee?.id ?? ''} onChange={(e) => onChoose(e.target.value)}>
            <option value="">Choose an employee…</option>
            {[...employees].sort((a, b) => partyName(a.party_id).localeCompare(partyName(b.party_id))).map((e) => <option key={e.id} value={e.id}>{partyName(e.party_id)} · {e.emp_no}{e.status !== 'active' ? ` (${e.status})` : ''}</option>)}
          </select>
        </Field>
        {employee && <button className="btn primary" disabled={!manage} title={manage ? undefined : 'You need the permission payroll.manage in this company'} onClick={() => setAdding(true)}><Plus size={15} /> New salary or revision</button>}
      </Panel>

      {!employee ? (
        <Panel><Empty icon={<Wallet size={20} />} title={employees.length ? 'Choose an employee' : 'No employee is recorded'} body={employees.length ? 'The salary history of the chosen person is shown here, newest first.' : 'Add employees first. Records above your clearance are not sent to you.'} /></Panel>
      ) : list.error ? <ErrorBox message={list.error} retry={list.reload} />
        : !list.data ? <Panel><Loading rows={4} label="Loading the salary history" /></Panel>
        : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
              <span className="text-ink">{partyName(employee.party_id)}</span><span className="num text-gold">{employee.emp_no}</span>
              {employee.designation && <span>· {employee.designation}</span>}{employee.department_id && <span>· {unitName(employee.department_id)}</span>}
              {employee.confidentiality !== 'internal' && <span className="chip violet">{human(employee.confidentiality)}</span>}
              {!inForce && rows.length > 0 && <span className="chip warn">no approved salary is in force today</span>}
            </div>
            <Panel lit={false}>
              <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} onRow={(s) => setSelected(s.id)} exportName={`salary-history-${employee.emp_no}`}
                rowClass={(s) => (shown && s.id === shown.id ? 'bg-surface2' : undefined)}
                empty={{ title: 'No salary is recorded for this person', body: 'Record the salary with its effective date. It is a draft until a second person approves it; a payroll run uses approved salaries only.', icon: <Wallet size={20} />, action: <button className="btn sm" disabled={!manage} title={manage ? undefined : 'You need the permission payroll.manage in this company'} onClick={() => setAdding(true)}><Plus size={13} /> New salary</button> }} />
            </Panel>

            {shown && (
              <Section title={`Components — effective ${fmtDate(shown.effective_from)}`} right={state(shown)}>
                <Panel lit={false} className="overflow-hidden">
                  <div className="overflow-auto">
                    <table className="table dense">
                      <thead><tr><th>Component</th><th>Kind</th><th>Type</th><th className="r">Monthly amount</th></tr></thead>
                      <tbody>
                        {shown.components.map((c, i) => (
                          <tr key={(c.key ?? c.name) + i}>
                            <td className="text-ink">{c.name}</td>
                            <td><span className={cx('chip', c.kind === 'earning' ? 'pos' : c.kind === 'deduction' ? 'warn' : 'cyan')}>{KIND_LABEL[c.kind]}</span></td>
                            <td className="text-ink2">{human(c.type ?? '—')}</td>
                            <td className="r"><Money value={c.amount} currency={currency} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr><td className={cx(foot, 'text-[12.5px] text-ink2')} colSpan={3}>Gross − deductions = net each month</td><td className={cx(foot, 'r')}><Money value={shown.monthly_net} currency={currency} className="font-medium text-ink" /></td></tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="border-t border-line px-4 py-3 text-[12px] text-muted">
                    <div>Reason: <span className="text-ink2">{shown.reason}</span></div>
                    {shown.approved_at && <div className="mt-0.5">Approved {fmtDate(shown.approved_at.slice(0, 10))}.</div>}
                    {shown.decision_note && <div className="mt-0.5">Decision note: <span className="text-ink2">{shown.decision_note}</span></div>}
                    <div className="mt-1.5">{STATUTORY_NOTE}</div>
                  </div>
                  {shown.status === 'draft' && (
                    <div className="no-print flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                      <button className="btn good" disabled={busy || !!whyNot(shown)} title={whyNot(shown) ?? 'Approving makes this salary effective from its date'} onClick={() => void act(() => api.decideSalaryStructure(shown.id, 'approved'), 'Salary approved')}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Approve</button>
                      <button className="btn danger" disabled={busy || !approve} title={approve ? undefined : 'You need the permission payroll.approve in this company'} onClick={() => setRejecting(shown)}><XCircle size={15} /> Reject</button>
                      <span className="text-[12px] text-muted">Maker-checker applies: the person who entered a salary cannot approve it.</span>
                    </div>
                  )}
                </Panel>
              </Section>
            )}
          </>
        )}

      {employee && <SalaryForm open={adding} onClose={() => setAdding(false)} employee={employee} base={inForce ?? rows.find((s) => s.status === 'approved') ?? null} baseInForce={!!inForce} currency={currency} onSaved={(id) => setSelected(id)} />}
      <ReasonDialog open={!!rejecting} title="Reject this salary" danger confirm="Reject" body="The record is kept as rejected. It will not be used by any payroll run."
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => { const s = rejecting; setRejecting(null); if (s) void act(() => api.decideSalaryStructure(s.id, 'rejected', reason), 'Salary rejected') }} />
    </div>
  )
}

interface ComponentRow { key: number; name: string; kind: ComponentKind; type: string; amount: string; account_id: ID | null }
const blankComponent = (kind: ComponentKind = 'earning'): ComponentRow => ({ key: nextKey(), name: '', kind, type: STRUCTURE_TYPES[kind][0], amount: '', account_id: null })

function SalaryForm({ open, onClose, employee, base, baseInForce, currency, onSaved }: { open: boolean; onClose: () => void; employee: Employee; base: SalaryStructure | null; baseInForce: boolean; currency?: string; onSaved: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const accounts = useApp((s) => s.accounts)
  const expenseLedgers = useMemo(() => accounts.filter((a) => a.company_id === employee.company_id && a.type === 'expense' && !a.is_group && a.is_active).sort((a, b) => a.code.localeCompare(b.code)), [accounts, employee.company_id])
  const { act, busy } = useAction()
  const [from, setFrom] = useState(today())
  const [reason, setReason] = useState('')
  const [rows, setRows] = useState<ComponentRow[]>([blankComponent()])
  useEffect(() => { if (open) { setFrom(today()); setReason(''); setRows([blankComponent()]) } }, [open])

  const set = (key: number, patch: Partial<ComponentRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const copyBase = () => { if (base) setRows(base.components.map((c) => ({ key: nextKey(), name: c.name, kind: c.kind, type: c.type ?? STRUCTURE_TYPES[c.kind][0], amount: D(c.amount).toString(), account_id: c.account_id ?? null }))) }

  const total = (kind: ComponentKind) => sum(rows.filter((r) => r.kind === kind).map((r) => D(r.amount)))
  const gross = total('earning'), deductions = total('deduction'), employer = total('employer')
  const net = gross.minus(deductions)
  const ctc = gross.plus(employer).times(12)
  const filled = rows.filter((r) => r.name.trim() || r.amount)

  const problems: string[] = []
  if (!from) problems.push('Choose the date from which this salary is effective.')
  if (!reason.trim()) problems.push('Record the reason for this salary or revision.')
  if (filled.some((r) => !r.name.trim())) problems.push('Every component needs a name.')
  if (gross.lte(0)) problems.push('The salary needs at least one earning.')
  if (deductions.gt(gross)) problems.push('Deductions exceed earnings.')
  if (base && base.status === 'approved' && base.effective_from === from) problems.push('An approved salary already exists with this effective date. Choose a different date.')

  const save = async () => {
    const components: SalaryComponent[] = filled.map((r) => ({ name: r.name.trim(), kind: r.kind, type: r.type, amount: r.amount || 0, account_id: r.account_id }))
    const input: SalaryStructureInput = { employee_id: employee.id, effective_from: from, reason: reason.trim(), components }
    const id = await act(() => api.saveSalaryStructure(input), 'Salary recorded — awaiting approval by a second person')
    if (id) { onClose(); onSaved(id) }
  }

  return (
    <Drawer open={open} onClose={onClose} width={760} title="New salary or revision" subtitle={`${partyName(employee.party_id)} · ${employee.emp_no}`}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save for approval</button></>}>
      <Note className="mb-4">This is saved as a draft and takes effect only after a second person approves it. An approved salary is never overwritten: this record sits beside the earlier ones.</Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Effective from" hint={from > today() ? 'A future date: once approved it takes effect on that date.' : undefined}><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Reason (required)" hint="For example: joining salary, annual increment, promotion"><input className="field" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>

      <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Components — monthly amounts</div>
        <button className="btn sm" disabled={!base} title={base ? undefined : 'This person has no approved salary to start from'} onClick={copyBase}><Copy size={13} /> {baseInForce || !base ? 'Start from the salary in force' : 'Start from the last approved salary'}</button>
      </div>
      <Panel lit={false} className="overflow-hidden">
        <div className="overflow-auto">
          <table className="table dense" style={{ minWidth: 820 }}>
            <thead><tr><th style={{ minWidth: 190 }}>Name</th><th style={{ width: 150 }}>Kind</th><th style={{ width: 150 }}>Type</th><th style={{ minWidth: 190 }}>Charged to</th><th className="r" style={{ width: 140 }}>Amount</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td><input className="field sm" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} aria-label={`Component ${i + 1} name`} placeholder={r.kind === 'earning' ? 'Basic salary' : r.kind === 'deduction' ? 'Provident fund — employee' : 'Provident fund — employer'} /></td>
                  <td><select className="field sm" value={r.kind} onChange={(e) => { const kind = e.target.value as ComponentKind; set(r.key, { kind, type: STRUCTURE_TYPES[kind][0] }) }} aria-label={`Component ${i + 1} kind`}>{(Object.keys(KIND_LABEL) as ComponentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                  <td><select className="field sm" value={r.type} onChange={(e) => set(r.key, { type: e.target.value })} aria-label={`Component ${i + 1} type`}>{[...new Set([...STRUCTURE_TYPES[r.kind], r.type])].map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></td>
                  <td>{r.kind === 'deduction' ? <span className="text-[11.5px] text-muted">by its type</span> : (
                    <select className="field sm" value={r.account_id ?? ''} onChange={(e) => set(r.key, { account_id: e.target.value || null })} aria-label={`Component ${i + 1} ledger`} title="The expense ledger this component is charged to. Left empty, the ledger mapped for payroll is used.">
                      <option value="">As mapped for payroll</option>{expenseLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  )}</td>
                  <td><input className="field sm num text-right" inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: digits(e.target.value) })} aria-label={`Component ${i + 1} amount`} /></td>
                  <td><button className="btn ghost icon sm" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove component"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5">
          <button className="btn sm" onClick={() => setRows((rs) => [...rs, blankComponent('earning')])}><Plus size={13} /> Earning</button>
          <button className="btn sm" onClick={() => setRows((rs) => [...rs, blankComponent('deduction')])}><Plus size={13} /> Deduction</button>
          <button className="btn sm" onClick={() => setRows((rs) => [...rs, blankComponent('employer')])}><Plus size={13} /> Employer cost</button>
        </div>
      </Panel>

      <Panel className="mt-4 p-4 text-[13px]" lit={false}>
        <div className="eyebrow mb-2.5">Totals</div>
        <div className="space-y-1.5">
          <div className="flex justify-between"><span className="text-ink2">Monthly gross</span><Money value={gross} currency={currency} /></div>
          <div className="flex justify-between"><span className="text-ink2">Deductions</span><Money value={deductions} currency={currency} /></div>
          <div className="flex justify-between"><span className="text-ink2">Employer cost</span><Money value={employer} currency={currency} /></div>
          <div className="hairline my-2" />
          <div className="flex items-baseline justify-between"><span className="font-medium">Net each month</span><Money value={net} currency={currency} className={cx('display text-[20px]', net.isNegative() ? 'text-neg' : 'text-gold')} /></div>
          <div className="flex justify-between text-[12px] text-muted"><span>Annual cost to company = (gross + employer cost) × 12</span><Money value={ctc} currency={currency} /></div>
        </div>
      </Panel>
      <div className="mt-3 text-[11.5px] text-muted">{STATUTORY_NOTE} Deductions and employer contributions are credited to the ledgers mapped for tax deducted and statutory dues; a ledger of their own per component is not available.</div>
      {problems.length > 0 && (reason || filled.length > 0) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}

// =====================================================================
// Employee record
// =====================================================================
interface EmployeeDraft {
  company_id: ID; party_id: ID; emp_no: string; designation: string; department_id: ID; office_id: ID; employment_type: EmploymentType
  join_date: string; exit_date: string; status: Employee['status']; payment_method: string; confidentiality: Confidentiality; notes: string
}

function EmployeeForm({ open, onClose, employee, ids }: { open: boolean; onClose: () => void; employee: Employee | null; ids: ID[] }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const { act, busy } = useAction()
  const choices = companies.filter((c) => c.status === 'active' && ids.includes(c.id))

  const fresh = (): EmployeeDraft => ({ company_id: choices.find((c) => can('payroll.manage', c.id))?.id ?? choices[0]?.id ?? '', party_id: '', emp_no: '', designation: '', department_id: '', office_id: '', employment_type: 'permanent', join_date: today(), exit_date: '', status: 'active', payment_method: 'Bank transfer', confidentiality: 'internal', notes: '' })
  const [f, setF] = useState<EmployeeDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setF(employee ? {
      company_id: employee.company_id, party_id: employee.party_id, emp_no: employee.emp_no, designation: employee.designation ?? '', department_id: employee.department_id ?? '', office_id: employee.office_id ?? '',
      employment_type: employee.employment_type, join_date: employee.join_date, exit_date: employee.exit_date ?? '', status: employee.status, payment_method: employee.payment_method ?? '', confidentiality: employee.confidentiality, notes: employee.notes ?? '',
    } : fresh())
  }, [open, employee?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<EmployeeDraft>) => setF((x) => ({ ...x, ...patch }))

  const people = useMemo(() => parties
    .filter((p) => p.id === f.party_id || !['blocked', 'terminated'].includes(p.status))
    .sort((a, b) => Number(b.kind === 'person') - Number(a.kind === 'person') || a.display_name.localeCompare(b.display_name)), [parties, f.party_id])
  const units = (type: string) => orgUnits.filter((u) => u.company_id === f.company_id && u.type_key === type && (u.status === 'active' || u.id === f.department_id || u.id === f.office_id)).sort((a, b) => a.name.localeCompare(b.name))
  const manage = !!f.company_id && can('payroll.manage', f.company_id)
  const methods = f.payment_method && !PAY_METHODS.includes(f.payment_method) ? [...PAY_METHODS, f.payment_method] : PAY_METHODS

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company.')
  if (!f.party_id) problems.push('Choose the person from the party register.')
  if (!f.join_date) problems.push('Enter the joining date.')
  if (f.exit_date && f.join_date && f.exit_date < f.join_date) problems.push('The exit date is before the joining date.')

  const save = async () => {
    const input: EmployeeInput = {
      id: employee?.id, company_id: f.company_id, party_id: f.party_id, join_date: f.join_date, ...(f.emp_no.trim() ? { emp_no: f.emp_no.trim() } : {}), designation: f.designation.trim() || null,
      department_id: f.department_id || null, office_id: f.office_id || null, employment_type: f.employment_type, exit_date: f.exit_date || null, status: f.status, payment_method: f.payment_method || null,
      confidentiality: f.confidentiality, notes: f.notes.trim() || null,
    }
    const id = await act(() => api.saveEmployee(input), employee ? 'Employee record updated' : 'Employee recorded')
    if (id) onClose()
  }

  return (
    <Drawer open={open} onClose={onClose} width={640} title={employee ? `Edit ${employee.emp_no}` : 'Add employee'} subtitle="The employee record holds no salary. Salaries are recorded and approved separately."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission payroll.manage in this company' : problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <select className="field" value={f.company_id} disabled={!!employee} onChange={(e) => set({ company_id: e.target.value, department_id: '', office_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        </Field>
        <div>
          <Field label="Person">
            <select className="field" value={f.party_id} disabled={!!employee} onChange={(e) => set({ party_id: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}{p.kind === 'organization' ? ' (organisation)' : ''}</option>)}</select>
          </Field>
          {!employee && <div className="mt-1 text-[11.5px] text-muted">Not in the list? <button className="link" onClick={() => { onClose(); nav('/parties') }}>Add the person in People & Parties</button> first.</div>}
        </div>
        <Field label="Employee number (optional)" hint={employee ? 'The number cannot be changed once it is assigned.' : 'Leave empty and the next number is assigned.'}><input className="field num" value={f.emp_no} disabled={!!employee} onChange={(e) => set({ emp_no: e.target.value })} /></Field>
        <Field label="Designation"><input className="field" value={f.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
        <Field label="Department" hint={units('department').length ? 'Payroll cost is charged to the department, never to the person.' : 'This company has no department. Add one under Companies.'}>
          <select className="field" value={f.department_id} onChange={(e) => set({ department_id: e.target.value })}><option value="">No department</option>{units('department').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Office">
          <select className="field" value={f.office_id} onChange={(e) => set({ office_id: e.target.value })}><option value="">No office</option>{units('office').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </Field>
        <Field label="Employment type"><select className="field" value={f.employment_type} onChange={(e) => set({ employment_type: e.target.value as EmploymentType })}>{EMPLOYMENT.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Status"><select className="field" value={f.status} onChange={(e) => set({ status: e.target.value as Employee['status'] })}>{EMP_STATUS.map((s) => <option key={s} value={s}>{s === 'notice' ? 'serving notice' : s}</option>)}</select></Field>
        <Field label="Joining date"><input type="date" className="field" value={f.join_date} onChange={(e) => set({ join_date: e.target.value })} /></Field>
        <Field label="Exit date" hint="Leave empty while the person is employed"><input type="date" className="field" value={f.exit_date} onChange={(e) => set({ exit_date: e.target.value })} /></Field>
        <Field label="Payment method"><select className="field" value={f.payment_method} onChange={(e) => set({ payment_method: e.target.value })}><option value="">Not recorded</option>{methods.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="Confidentiality" hint="A person without clearance for the chosen level does not receive this record or its salary.">
          <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {problems.length > 0 && f.party_id && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}

// =====================================================================
// Run payroll
// =====================================================================
interface AdjustmentRow { key: number; employee_id: ID; name: string; kind: ComponentKind; type: string; amount: string; advance_id: ID; loan_id: ID }
interface UnpaidRow { key: number; employee_id: ID; days: string }
const blankAdjustment = (): AdjustmentRow => ({ key: nextKey(), employee_id: '', name: '', kind: 'earning', type: ADJUSTMENT_TYPES.earning[0], amount: '', advance_id: '', loan_id: '' })

function AdvancePicker({ companyId, partyId, value, onChange, label }: { companyId: ID; partyId: ID | undefined; value: ID; onChange: (id: ID) => void; label: string }) {
  const api = useApp((s) => s.api)!
  const privacy = useApp((s) => s.privacy)
  const list = useAsync(async () => (partyId ? (await api.listAdvances({ companyIds: [companyId], partyId })).filter((a) => advanceOutstanding(a).gt(0) && !['draft', 'requested', 'rejected', 'cancelled'].includes(a.status)) : []), [api, companyId, partyId])
  if (!partyId) return <span className="text-[11.5px] text-muted">Choose the employee first.</span>
  if (list.error) return <span className="text-[11.5px] text-warn">The advances could not be loaded: {list.error}</span>
  if (list.data && !list.data.length) return <span className="text-[11.5px] text-warn">This person holds no advance with an unsettled balance.</span>
  return (
    <select className="field sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{list.data ? 'Choose the advance…' : 'Loading…'}</option>
      {(list.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.advance_no} · unsettled {fmtMoney(advanceOutstanding(a), { currency: a.currency, mask: privacy })}</option>)}
    </select>
  )
}

function LoanPicker({ companyId, partyId, value, onChange, label }: { companyId: ID; partyId: ID | undefined; value: ID; onChange: (id: ID) => void; label: string }) {
  const api = useApp((s) => s.api)!
  const privacy = useApp((s) => s.privacy)
  const list = useAsync(async () => (partyId ? (await api.listLoans([companyId])).filter((l) => l.direction === 'lent' && l.party_id === partyId && D(l.disbursed_amount).minus(l.principal_repaid).gt(0)) : []), [api, companyId, partyId])
  if (!partyId) return <span className="text-[11.5px] text-muted">Choose the employee first.</span>
  if (list.error) return <span className="text-[11.5px] text-warn">The loans could not be loaded: {list.error}</span>
  if (list.data && !list.data.length) return <span className="text-[11.5px] text-warn">No loan given to this person has principal outstanding.</span>
  return (
    <select className="field sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{list.data ? 'Choose the loan…' : 'Loading…'}</option>
      {(list.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.loan_no} · outstanding {fmtMoney(D(l.disbursed_amount).minus(l.principal_repaid), { currency: l.currency, mask: privacy })}</option>)}
    </select>
  )
}

function RunPayrollModal({ open, onClose, ids, employees }: { open: boolean; onClose: () => void; ids: ID[]; employees: Employee[] }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const base = useCurrency()
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const choices = companies.filter((c) => c.status === 'active' && ids.includes(c.id) && can('payroll.manage', c.id))

  const [company, setCompany] = useState<ID>('')
  const [month, setMonth] = useState(today().slice(0, 7))
  const [type, setType] = useState<PayrollRun['run_type']>('regular')
  const [notes, setNotes] = useState('')
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [unpaid, setUnpaid] = useState<UnpaidRow[]>([])
  useEffect(() => { if (open) { setCompany(choices[0]?.id ?? ''); setMonth(today().slice(0, 7)); setType('regular'); setNotes(''); setAdjustments([]); setUnpaid([]) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const currency = companies.find((c) => c.id === company)?.base_currency ?? base
  const staff = useMemo(() => employees.filter((e) => e.company_id === company && e.status !== 'planned').sort((a, b) => a.emp_no.localeCompare(b.emp_no)), [employees, company])
  const byId = useMemo(() => new Map(staff.map((e) => [e.id, e])), [staff])
  const setAdj = (key: number, patch: Partial<AdjustmentRow>) => setAdjustments((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setDays = (key: number, patch: Partial<UnpaidRow>) => setUnpaid((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const problems: string[] = []
  if (!company) problems.push('Choose the company.')
  if (!/^\d{4}-\d{2}$/.test(month)) problems.push('Choose the payroll month.')
  adjustments.forEach((a, i) => {
    const n = i + 1
    if (!a.employee_id) problems.push(`Adjustment ${n}: choose the employee.`)
    if (!a.name.trim()) problems.push(`Adjustment ${n}: enter a name.`)
    if (D(a.amount).lte(0)) problems.push(`Adjustment ${n}: enter an amount greater than zero.`)
    if (a.type === 'advance_recovery' && !a.advance_id) problems.push(`Adjustment ${n}: choose the advance being recovered.`)
    if (a.type === 'loan_recovery' && !a.loan_id) problems.push(`Adjustment ${n}: choose the loan being recovered.`)
  })
  unpaid.forEach((u, i) => { if (!u.employee_id || !(Number(u.days) > 0)) problems.push(`Unpaid days ${i + 1}: choose the employee and enter the days.`) })
  if (new Set(unpaid.map((u) => u.employee_id)).size !== unpaid.length) problems.push('Unpaid days: each employee can be listed once.')
  if (type !== 'regular' && adjustments.length === 0) problems.push('A supplementary or full and final run needs at least one adjustment.')

  const adjustmentTotal = (kind: ComponentKind) => sum(adjustments.filter((a) => a.kind === kind).map((a) => D(a.amount)))

  const submit = async () => {
    const input: PayrollRunInput = {
      company_id: company, month: month + '-01', run_type: type, notes: notes.trim() || undefined,
      adjustments: adjustments.map((a) => ({ employee_id: a.employee_id, name: a.name.trim(), kind: a.kind, type: a.type, amount: a.amount, ...(a.type === 'advance_recovery' ? { advance_id: a.advance_id } : {}), ...(a.type === 'loan_recovery' ? { loan_id: a.loan_id } : {}) })),
      unpaid_days: type === 'regular' ? Object.fromEntries(unpaid.map((u) => [u.employee_id, Number(u.days)])) : {},
    }
    const id = await act(() => api.createPayrollRun(input), 'Payroll calculated. Nothing has been posted.')
    if (id) { onClose(); nav('/payroll/runs/' + id) }
  }

  const employeeSelect = (value: ID, onChange: (id: ID) => void, label: string) => (
    <select className="field sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose…</option>
      {staff.map((e) => <option key={e.id} value={e.id}>{partyName(e.party_id)} · {e.emp_no}</option>)}
    </select>
  )

  return (
    <Modal open={open} onClose={onClose} title="Run payroll" subtitle="Calculates the pay of each person for one month" width={980}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void submit()}>{busy ? <Spinner /> : <Calculator size={15} />} Calculate the run</button></>}>
      <Note className="mb-4">The run is calculated from approved salaries. Nothing is posted until the entry is proposed and approved. Anyone left out of the run is listed with the reason.</Note>
      {!choices.length && <Note kind="warn" className="mb-4">You do not hold the permission payroll.manage in any of the selected companies.</Note>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Company"><select className="field" value={company} onChange={(e) => { setCompany(e.target.value); setAdjustments([]); setUnpaid([]) }}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Month"><input type="month" className="field" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Type" hint={type === 'regular' ? 'Everyone with an approved salary effective in the month.' : 'Only the people who have an adjustment below.'}>
          <select className="field" value={type} onChange={(e) => setType(e.target.value as PayrollRun['run_type'])}>{(Object.keys(RUN_TYPE_LABEL) as PayrollRun['run_type'][]).map((t) => <option key={t} value={t}>{RUN_TYPE_LABEL[t]}</option>)}</select>
        </Field>
        <Field label="Notes" className="sm:col-span-3"><input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the approver should know" /></Field>
      </div>

      <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
        <div><div className="eyebrow">Adjustments for this month</div><div className="mt-0.5 text-[11.5px] text-muted">One-off earnings, deductions and recoveries, on top of the approved salary.</div></div>
        <button className="btn sm" disabled={!company || !staff.length} title={!company ? 'Choose the company first' : !staff.length ? 'No employee record of this company is available to you' : undefined} onClick={() => setAdjustments((rs) => [...rs, blankAdjustment()])}><Plus size={13} /> Add adjustment</button>
      </div>
      <Panel lit={false} className="overflow-hidden">
        {adjustments.length === 0 ? <div className="px-4 py-3 text-[12.5px] text-muted">No adjustment. {type === 'regular' ? 'The run will use the approved salaries as they are.' : 'Add at least one for this type of run.'}</div> : (
          <div className="overflow-auto">
            <table className="table dense" style={{ minWidth: 900 }}>
              <thead><tr><th style={{ minWidth: 200 }}>Employee</th><th style={{ minWidth: 170 }}>Name</th><th style={{ width: 140 }}>Kind</th><th style={{ width: 160 }}>Type</th><th className="r" style={{ width: 130 }}>Amount</th><th style={{ minWidth: 210 }}>Recovered against</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {adjustments.map((a, i) => (
                  <tr key={a.key}>
                    <td>{employeeSelect(a.employee_id, (id) => setAdj(a.key, { employee_id: id, advance_id: '', loan_id: '' }), `Adjustment ${i + 1} employee`)}</td>
                    <td><input className="field sm" value={a.name} onChange={(e) => setAdj(a.key, { name: e.target.value })} aria-label={`Adjustment ${i + 1} name`} placeholder="Shown on the payroll line" /></td>
                    <td><select className="field sm" value={a.kind} onChange={(e) => { const kind = e.target.value as ComponentKind; setAdj(a.key, { kind, type: ADJUSTMENT_TYPES[kind][0], advance_id: '', loan_id: '' }) }} aria-label={`Adjustment ${i + 1} kind`}>{(Object.keys(KIND_LABEL) as ComponentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                    <td><select className="field sm" value={a.type} onChange={(e) => setAdj(a.key, { type: e.target.value, advance_id: '', loan_id: '' })} aria-label={`Adjustment ${i + 1} type`}>{ADJUSTMENT_TYPES[a.kind].map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></td>
                    <td><input className="field sm num text-right" inputMode="decimal" value={a.amount} onChange={(e) => setAdj(a.key, { amount: digits(e.target.value) })} aria-label={`Adjustment ${i + 1} amount`} /></td>
                    <td>
                      {a.type === 'advance_recovery' ? <AdvancePicker companyId={company} partyId={byId.get(a.employee_id)?.party_id} value={a.advance_id} onChange={(id) => setAdj(a.key, { advance_id: id })} label={`Adjustment ${i + 1} advance`} />
                        : a.type === 'loan_recovery' ? <LoanPicker companyId={company} partyId={byId.get(a.employee_id)?.party_id} value={a.loan_id} onChange={(id) => setAdj(a.key, { loan_id: id })} label={`Adjustment ${i + 1} loan`} />
                        : <span className="text-muted">—</span>}
                    </td>
                    <td><button className="btn ghost icon sm" onClick={() => setAdjustments((rs) => rs.filter((x) => x.key !== a.key))} aria-label="Remove adjustment"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {adjustments.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-muted">
            <span>Earnings <Money value={adjustmentTotal('earning')} currency={currency} className="text-ink2" /></span>
            <span>Deductions <Money value={adjustmentTotal('deduction')} currency={currency} className="text-ink2" /></span>
            <span>Employer cost <Money value={adjustmentTotal('employer')} currency={currency} className="text-ink2" /></span>
          </div>
        )}
      </Panel>

      {type === 'regular' && (
        <>
          <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
            <div><div className="eyebrow">Unpaid days (optional)</div><div className="mt-0.5 text-[11.5px] text-muted">Days without pay reduce the salary in proportion to the days of the month.</div></div>
            <button className="btn sm" disabled={!company || !staff.length} onClick={() => setUnpaid((rs) => [...rs, { key: nextKey(), employee_id: '', days: '' }])}><Plus size={13} /> Add unpaid days</button>
          </div>
          <Panel lit={false} className="overflow-hidden">
            {unpaid.length === 0 ? <div className="px-4 py-3 text-[12.5px] text-muted">Nobody has unpaid days. Everyone is paid for the full month, or from the joining date to the exit date.</div> : (
              <table className="table dense">
                <thead><tr><th>Employee</th><th className="r" style={{ width: 140 }}>Unpaid days</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>
                  {unpaid.map((u, i) => (
                    <tr key={u.key}>
                      <td>{employeeSelect(u.employee_id, (id) => setDays(u.key, { employee_id: id }), `Unpaid days ${i + 1} employee`)}</td>
                      <td><input className="field sm num text-right" inputMode="decimal" value={u.days} onChange={(e) => setDays(u.key, { days: digits(e.target.value) })} aria-label={`Unpaid days ${i + 1} number of days`} /></td>
                      <td><button className="btn ghost icon sm" onClick={() => setUnpaid((rs) => rs.filter((x) => x.key !== u.key))} aria-label="Remove unpaid days"><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      <div className="mt-4 text-[11.5px] text-muted">{STATUTORY_NOTE}</div>
      {problems.length > 0 && (adjustments.length > 0 || unpaid.length > 0) && <Note kind="warn" className="mt-3"><ul className="m-0 list-disc pl-4">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Modal>
  )
}
