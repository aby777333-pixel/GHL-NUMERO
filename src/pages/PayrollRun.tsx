import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { AlertTriangle, ArrowLeft, BadgeCheck, Banknote, Calculator, ChevronDown, ChevronRight, Download, EyeOff, XCircle } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { PayrollLine } from '@/engine/opsTypes'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv } from '@/lib/data'
import { D, ZERO, sum } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { MoneyMoveDialog, ProposedEntries, ProposedNote, Stat, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart } from '@/ui/charts'
import { KIND_LABEL, monthName, PayrollDenied, RESTRICTED_NOTE, RUN_STATUS_LABEL, RUN_TYPE_LABEL, STATUTORY_NOTE, usePayrollIds } from './Payroll'

// =====================================================================
// One payroll run: who is in it, who was left out and why, what it
// costs by department, and the entries it has proposed.
// =====================================================================

const human = (s: string) => s.replace(/[_.]/g, ' ')
const foot = 'border-t border-line2 px-[14px] py-[10px]'
interface DeptRow { id: ID | null; name: string; people: number; gross: Decimal; employer: Decimal }

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>()
  const ids = usePayrollIds('all')
  if (!ids.length || !id) return <PayrollDenied title="Payroll run" />
  return <RunView key={id} id={id} ids={ids} />
}

function RunView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const toast = useApp((s) => s.toast)
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const { act, busy } = useAction()
  const idsKey = ids.join(',')

  const [open, setOpen] = useState<Set<ID>>(new Set())
  const [proposing, setProposing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)

  const main = useAsync(async () => {
    const run = (await api.listPayrollRuns(ids)).find((r) => r.id === id) ?? null
    if (!run) return { run, lines: [] as PayrollLine[], employees: [] }
    const [lines, employees] = await Promise.all([api.getPayrollLines({ runId: id }), api.listEmployees([run.company_id])])
    return { run, lines, employees }
  }, [api, id, idsKey])
  const run = main.data?.run ?? null
  const companyId = run?.company_id
  const postings = useAsync(async () => (companyId ? api.listWorkflowPostings({ companyIds: [companyId], sourceId: id }) : []), [api, companyId, id])
  const audit = useAsync(() => api.listAudit({ entity: 'payroll_runs', entityId: id, limit: 50 }), [api, id])

  const empNo = useMemo(() => new Map((main.data?.employees ?? []).map((e) => [e.id, e.emp_no])), [main.data])
  const lines = useMemo(() => [...(main.data?.lines ?? [])].sort((a, b) => (empNo.get(a.employee_id) ?? '').localeCompare(empNo.get(b.employee_id) ?? '')), [main.data, empNo])
  const departments: DeptRow[] = useMemo(() => {
    const m = new Map<string, DeptRow>()
    for (const l of lines) {
      const k = l.department_id ?? ''
      const c = m.get(k) ?? { id: l.department_id, name: l.department_id ? unitName(l.department_id) : 'No department', people: 0, gross: ZERO, employer: ZERO }
      m.set(k, { ...c, people: c.people + 1, gross: c.gross.plus(l.gross), employer: c.employer.plus(l.employer_cost) })
    }
    return [...m.values()].sort((a, b) => b.gross.plus(b.employer).cmp(a.gross.plus(a.employer)))
  }, [lines, unitName])

  const back = <button className="btn ghost" onClick={() => nav('/payroll?tab=runs')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Payroll" title="Payroll run" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!main.data) return <div><PageHeader eyebrow="Payroll" title="Payroll run" actions={back} /><Panel><Loading rows={7} label="Loading the payroll run" /></Panel></div>
  if (!run) {
    return (
      <div>
        <PageHeader eyebrow="Payroll" title="Payroll run" actions={back} />
        <Panel><Empty icon={<Calculator size={20} />} title="Payroll run not found or not shared with you" body="This run does not exist in the companies where you hold payroll.view." action={<button className="btn" onClick={() => nav('/payroll?tab=runs')}><ArrowLeft size={14} /> Back to Payroll</button>} /></Panel>
      </div>
    )
  }

  const currency = companies.find((c) => c.id === run.company_id)?.base_currency
  const manage = can('payroll.manage', run.company_id)
  const canPay = can('payment.create', run.company_id)
  const hidden = Math.max(0, run.headcount - lines.length)
  const totalCost = D(run.gross).plus(run.employer_cost)
  const pendingPayment = (postings.data ?? []).some((w) => w.source === 'payroll_payment' && w.status === 'pending')
  const month = monthName(run.period_month)
  const toggle = (lineId: ID) => setOpen((s) => { const n = new Set(s); if (n.has(lineId)) n.delete(lineId); else n.add(lineId); return n })
  const allOpen = lines.length > 0 && lines.every((l) => open.has(l.id))

  const exportLines = () => {
    downloadCsv(`payroll-lines-${run.run_no}${mode === 'demo' ? '-DEMO' : ''}`,
      ['Employee no', 'Name', 'Department', 'Days paid', 'Days in month', 'Gross', 'Deductions', 'Employer cost', 'Net'],
      lines.map((l) => [empNo.get(l.employee_id) ?? '', partyName(l.party_id), l.department_id ? unitName(l.department_id) : '', D(l.days_paid).toString(), l.days_in_month, D(l.gross).toFixed(2), D(l.deductions).toFixed(2), D(l.employer_cost).toFixed(2), D(l.net).toFixed(2)]))
    toast('ok', 'Export ready', `${lines.length.toLocaleString()} row${lines.length === 1 ? '' : 's'} exported${mode === 'demo' ? ' (sample data)' : ''}.${hidden ? ` ${hidden} restricted record${hidden === 1 ? ' is' : 's are'} not in the file.` : ''}`)
  }

  const deptColumns: Column<DeptRow>[] = [
    { key: 'dept', header: 'Department', render: (r) => <span className="text-ink">{r.name}</span>, sort: (r) => r.name.toLowerCase(), csv: (r) => r.name },
    { key: 'people', header: 'People', align: 'right', render: (r) => <span className="num">{r.people}</span>, sort: (r) => r.people, csv: (r) => r.people },
    { key: 'gross', header: 'Gross', align: 'right', render: (r) => <Money value={r.gross} currency={currency} />, sort: (r) => r.gross.toNumber(), csv: (r) => r.gross.toFixed(2) },
    { key: 'employer', header: 'Employer cost', align: 'right', render: (r) => <Money value={r.employer} currency={currency} dim />, sort: (r) => r.employer.toNumber(), csv: (r) => r.employer.toFixed(2) },
    { key: 'total', header: 'Total cost', align: 'right', render: (r) => <Money value={r.gross.plus(r.employer)} currency={currency} className="text-ink" />, sort: (r) => r.gross.plus(r.employer).toNumber(), csv: (r) => r.gross.plus(r.employer).toFixed(2) },
  ]
  const history = (audit.data ?? []).filter((a) => a.action !== 'update' || a.reason)

  return (
    <div>
      <PageHeader
        eyebrow={`Payroll · ${RUN_TYPE_LABEL[run.run_type]} run`}
        title={`${run.run_no} · ${month}`}
        subtitle={<>{companyName(run.company_id)} · calculated {fmtDateTime(run.created_at)}{run.paid_on ? ` · salaries paid ${fmtDate(run.paid_on)}` : ''}{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
        actions={<>
          {back}
          {run.status === 'draft' && <button className="btn danger" disabled={!manage || busy} title={manage ? 'Cancels this calculation. Nothing has been posted.' : 'You need the permission payroll.manage in this company'} onClick={() => setCancelling(true)}><XCircle size={15} /> Cancel run</button>}
          {run.status === 'draft' && <button className="btn primary" disabled={!manage || busy || run.headcount === 0} title={!manage ? 'You need the permission payroll.manage in this company' : run.headcount === 0 ? 'This run has nobody in it' : 'Proposes the payroll journal for approval'} onClick={() => setProposing(true)}><BadgeCheck size={15} /> Propose the accounting entry</button>}
          {run.status === 'posted' && <button className="btn primary" disabled={!manage || !canPay || pendingPayment || busy}
            title={!manage ? 'You need the permission payroll.manage in this company' : !canPay ? 'You need the permission payment.create in this company' : pendingPayment ? 'A salary payment for this run is already awaiting approval' : 'Proposes the entry for the payment of net salaries'}
            onClick={() => setPaying(true)}><Banknote size={15} /> Record salary payment</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={run.status} label={RUN_STATUS_LABEL[run.status]} />
        <span className="chip">{RUN_TYPE_LABEL[run.run_type]}</span>
        <span className="chip violet" title="The payroll journal is classified confidential">confidential</span>
        {pendingPayment && <span className="chip warn">salary payment awaiting approval</span>}
        {run.exceptions.length > 0 && <span className="chip warn">{run.exceptions.length} not included</span>}
        {hidden > 0 && <span className="chip"><EyeOff size={11} /> {hidden} restricted</span>}
      </div>
      <Note className="mb-4">{RESTRICTED_NOTE}</Note>
      {run.status === 'draft' && <Note className="mb-4">This run is a calculation. Nothing has reached the ledger. Review the people and amounts, then propose the accounting entry.</Note>}
      {run.notes && <Note className="mb-4">Notes: {run.notes}</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="People" value={run.headcount} count sub={hidden ? `${lines.length} shown to you` : 'in this run'} />
        <Stat label="Gross" value={run.gross} currency={currency} sub="earnings before deductions" />
        <Stat label="Deductions" value={run.deductions} currency={currency} sub="as configured by the company" />
        <Stat label="Employer cost" value={run.employer_cost} currency={currency} sub="borne by the company" />
        <Stat label="Net pay" value={run.net} currency={currency} tone="gold" sub="gross less deductions" />
        <Stat label="Total cost" value={totalCost} currency={currency} sub="gross plus employer cost" />
      </div>

      {run.exceptions.length > 0 && (
        <Panel attention lit={false} className="mb-4 border-warn/40 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 flex-none text-warn" />
            <div className="min-w-0 flex-1">
              <div className="display text-[15px] font-medium text-ink">Not included in this run — {run.exceptions.length} {run.exceptions.length === 1 ? 'person' : 'people'}</div>
              <div className="mt-0.5 text-[12.5px] text-ink2">Nobody is dropped silently: each person left out is listed with the reason.</div>
              <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                {run.exceptions.map((x) => (
                  <div key={x.employee_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px]">
                    <span className="num text-gold">{x.emp_no}</span>
                    <span className="text-ink">{x.name}</span>
                    <span className="text-warn">{x.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="People in this run">
            <Panel lit={false} className="overflow-hidden">
              <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {lines.length > 0 && <button className="btn sm" onClick={() => setOpen(allOpen ? new Set() : new Set(lines.map((l) => l.id)))}>{allOpen ? 'Hide all components' : 'Show all components'}</button>}
                  <span className="text-[12px] text-muted">Open a row to see how the pay of that person is made up.</span>
                </div>
                {lines.length > 0 && <button className="btn sm ghost" onClick={exportLines} title="Export every line shown to you"><Download size={13} /> Export CSV</button>}
              </div>
              {lines.length === 0 ? (
                <Empty icon={<Calculator size={20} />} title={hidden ? 'Every record in this run is restricted' : 'Nobody is in this run'} body={hidden ? 'The people in this run are classified above your clearance. The totals above include them.' : 'No person had pay to calculate for this month. See the people not included, above.'} />
              ) : (
                <div className="overflow-auto">
                  <table className="table dense" style={{ minWidth: 860 }}>
                    <thead><tr><th style={{ width: 38 }} /><th>Employee no</th><th>Name</th><th>Department</th><th className="r">Days paid</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Employer cost</th><th className="r">Net</th></tr></thead>
                    <tbody>
                      {lines.map((l) => {
                        const on = open.has(l.id)
                        const name = partyName(l.party_id)
                        return (
                          <Fragment key={l.id}>
                            <tr className="rowlink" onClick={() => toggle(l.id)}>
                              <td><button className="btn ghost icon sm" aria-expanded={on} aria-label={`${on ? 'Hide' : 'Show'} the components of ${name}`} onClick={(e) => { e.stopPropagation(); toggle(l.id) }}>{on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                              <td><span className="num text-gold">{empNo.get(l.employee_id) ?? '—'}</span></td>
                              <td className="text-ink">{name}</td>
                              <td className="text-ink2">{unitName(l.department_id)}</td>
                              <td className="r"><span className="num">{D(l.days_paid).toString()}</span> <span className="text-muted">of {l.days_in_month}</span></td>
                              <td className="r"><Money value={l.gross} currency={currency} /></td>
                              <td className="r"><Money value={l.deductions} currency={currency} dim /></td>
                              <td className="r"><Money value={l.employer_cost} currency={currency} dim /></td>
                              <td className="r"><Money value={l.net} currency={currency} className="text-ink" /></td>
                            </tr>
                            {on && (
                              <tr>
                                <td />
                                <td colSpan={8} className="bg-surface">
                                  <table className="table dense">
                                    <thead><tr><th>Component</th><th>Kind</th><th>Type</th><th>Comes from</th><th className="r">Amount</th></tr></thead>
                                    <tbody>
                                      {l.components.map((c, i) => (
                                        <tr key={(c.key ?? c.name) + i}>
                                          <td className="text-ink">{c.name}{c.note ? <span className="text-muted"> · {c.note}</span> : null}</td>
                                          <td><span className={cx('chip', c.kind === 'earning' ? 'pos' : c.kind === 'deduction' ? 'warn' : 'cyan')}>{KIND_LABEL[c.kind]}</span></td>
                                          <td className="text-ink2">{human(c.type ?? '—')}</td>
                                          <td className="text-ink2">{c.source === 'adjustment' ? 'adjustment for this month' : 'salary structure'}</td>
                                          <td className="r"><Money value={c.amount} currency={currency} /></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>{hidden ? `Total of the ${lines.length} record${lines.length === 1 ? '' : 's'} shown to you` : `Total · ${lines.length} ${lines.length === 1 ? 'person' : 'people'}`}</td>
                        <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => l.gross))} currency={currency} /></td>
                        <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => l.deductions))} currency={currency} /></td>
                        <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => l.employer_cost))} currency={currency} /></td>
                        <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => l.net))} currency={currency} className="font-medium text-ink" /></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <div className="border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
                Showing <span className="num text-ink2">{lines.length}</span> of <span className="num text-ink2">{run.headcount}</span> {run.headcount === 1 ? 'person' : 'people'} in the run.
              </div>
            </Panel>
            {hidden > 0 && <Note kind="warn" className="mt-3">{hidden} record(s) are restricted and not shown to you; the totals above include them.</Note>}
            <div className="mt-2 text-[11.5px] text-muted">{STATUTORY_NOTE}</div>
          </Section>

          <Section title="Cost by department">
            {departments.length === 0 ? <Panel lit={false}><Empty title="Nothing to show" body="No payroll line of this run is available to you." /></Panel> : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel className="p-4" lit={false}>
                  <BarChart stacked data={departments.map((r) => ({ label: r.name, values: [{ key: 'Gross', value: r.gross.toNumber() }, { key: 'Employer cost', value: r.employer.toNumber() }] }))} />
                </Panel>
                <Panel lit={false}>
                  <DataTable columns={deptColumns} rows={departments} rowKey={(r) => r.id ?? 'none'} exportName={`payroll-by-department-${run.run_no}`} initialSort={{ key: 'total', dir: 'desc' }}
                    footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total</td><td className={cx(foot, 'r num')}>{lines.length}</td><td className={cx(foot, 'r')}><Money value={sum(departments.map((r) => r.gross))} currency={currency} /></td><td className={cx(foot, 'r')}><Money value={sum(departments.map((r) => r.employer))} currency={currency} /></td><td className={cx(foot, 'r')}><Money value={sum(departments.map((r) => r.gross.plus(r.employer)))} currency={currency} className="font-medium text-ink" /></td></tr>} />
                </Panel>
              </div>
            )}
            <div className="mt-2 text-[11.5px] text-muted">This is how the payroll journal charges the cost: by department, never by person.{hidden ? ` The ${hidden} restricted record${hidden === 1 ? ' is' : 's are'} not part of this breakdown.` : ''} These figures describe cost. They are not a measure of any person's performance.</div>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <ProposedEntries companyIds={[run.company_id]} sourceId={run.id} sources={['payroll', 'payroll_payment']} />
          {!postings.loading && !(postings.data ?? []).some((w) => w.source === 'payroll' || w.source === 'payroll_payment') && (
            <Section title="Accounting entries">
              <Panel className="px-4 py-3 text-[12.5px] text-muted" lit={false}>No entry has been proposed for this run. Nothing has reached the ledger.</Panel>
            </Section>
          )}

          <Section title="History">
            <Panel className="max-h-[300px] overflow-auto p-1.5" lit={false}>
              {audit.error ? <div className="px-3 py-3 text-[12.5px] text-muted">The history could not be loaded: {audit.error}</div>
                : !audit.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
                : history.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No history is recorded for this run.</div>
                : history.map((a) => (
                  <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{human(a.action)}</span> <span className="text-muted">· {a.actor_name ?? 'Unknown user'} · {fmtDateTime(a.at)}</span>
                    {a.reason && <div className="text-[11.5px] text-muted">{a.reason}</div>}
                  </div>
                ))}
            </Panel>
          </Section>
        </div>
      </div>

      <Modal open={proposing} onClose={() => setProposing(false)} title="Propose the accounting entry" subtitle={`${run.run_no} · ${month}`} width={540}
        footer={<><button className="btn ghost" onClick={() => setProposing(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => void act(() => api.proposePayrollRun(run.id), 'Payroll entry proposed — awaiting approval').then((j) => { if (j) setProposing(false) })}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
        <ProposedNote>This action proposes the payroll journal. It reaches the ledger only after a second person approves it in the approval inbox. The entry is CONFIDENTIAL and can be approved only by a person cleared to read it. NUMERO records that salaries are payable; it does not pay them.</ProposedNote>
        <div className="space-y-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-ink2">Dr Salaries, bonus and employer contributions — by department</span><Money value={totalCost} currency={currency} /></div>
          <div className="flex justify-between pl-5 text-ink2"><span>Cr Net salaries payable · {run.headcount} {run.headcount === 1 ? 'person' : 'people'}</span><Money value={run.net} currency={currency} /></div>
          <div className="flex justify-between pl-5 text-ink2"><span>Cr Dues to authorities and recoveries</span><Money value={totalCost.minus(run.net)} currency={currency} /></div>
        </div>
        <div className="mt-3 text-[11.5px] text-muted">No individual salary appears in the journal: cost is charged by department and net pay is one line. The entry is dated the last day of {month}. {STATUTORY_NOTE}</div>
        {run.exceptions.length > 0 && <Note kind="warn" className="mt-3">{run.exceptions.length} {run.exceptions.length === 1 ? 'person was' : 'people were'} not included in this run. The entry covers only the people in the run.</Note>}
      </Modal>

      <ReasonDialog open={cancelling} title="Cancel this payroll run" danger confirm="Cancel the run" body="The calculation is cancelled and kept for the record. Nothing was posted. The payroll for the month can be run again."
        onCancel={() => setCancelling(false)} onConfirm={(reason) => { setCancelling(false); void act(() => api.cancelPayrollRun(run.id, reason), 'Payroll run cancelled') }} />

      <MoneyMoveDialog open={paying} companyId={run.company_id} title="Record salary payment" subtitle={`${run.run_no} · net salaries for ${month} · ${run.headcount} ${run.headcount === 1 ? 'person' : 'people'}`}
        amount={run.net} amountEditable={false} confirm="Propose the entry" busy={busy} onCancel={() => setPaying(false)}
        note="This action proposes an accounting entry for salaries already paid through the bank. It reaches the ledger only after a second person approves it. The entry is CONFIDENTIAL. NUMERO records that money moved; it does not move money."
        extra={<div className="text-[12px] text-muted">On approval: net salaries payable is debited and the bank or cash ledger is credited, in one line for the whole run.</div>}
        onConfirm={(v) => void act(() => api.payPayrollRun(run.id, { bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method }), 'Salary payment proposed — awaiting approval').then((j) => { if (j) setPaying(false) })} />
    </div>
  )
}
