import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Banknote, ExternalLink, Landmark, Lock, Pencil } from 'lucide-react'
import type { ID, Num } from '@/engine/types'
import type { Loan, LoanInstalment } from '@/engine/opsTypes'
import { instalmentDue, loanPosition, principalDue } from '@/engine/ops'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO, sum } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, fmtMonth, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Section, StatusChip, Truth } from '@/ui/kit'
import { Attachments, MoneyMoveDialog, ProposedEntries, Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { TrendChart } from '@/ui/charts'
import { Contracted, DIRECTION_LABEL, Fact, LoanForm, REPAYMENT_LABEL, whenText } from './Treasury'

// =====================================================================
// Loan 360: one loan, its schedule, its entries and its evidence.
// Disbursement and every instalment PROPOSE an accounting entry.
// =====================================================================

const human = (s: string) => s.replace(/[_.]/g, ' ')
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const foot = 'border-t border-line2 px-[14px] py-[10px]'

function Tile({ label, children, sub, tone }: { label: string; children: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <Panel className="p-4">
      <div className="eyebrow">{label}</div>
      <div className={cx('display mt-1.5 text-[22px] font-medium', tone ?? 'text-ink')}>{children}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </Panel>
  )
}

export default function Loan360() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('treasury.view', cid))
  if (!ids.length || !id) {
    return (
      <div>
        <PageHeader eyebrow="Treasury · Loan" title="Loan" actions={<button className="btn ghost" onClick={() => nav('/treasury?tab=loans')}><ArrowLeft size={15} /> Back</button>} />
        <Panel>
          <Empty icon={<Lock size={20} />} title="You do not have access to loans"
            body={<>This page needs the permission <span className="num text-ink2">treasury.view</span>. A group administrator can grant it under Team.</>} />
        </Panel>
      </div>
    )
  }
  return <LoanView key={id} id={id} ids={ids} />
}

function LoanView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const idsKey = ids.join(',')
  const asOf = today()

  const [editing, setEditing] = useState(false)
  const [disbursing, setDisbursing] = useState(false)
  const [paying, setPaying] = useState<LoanInstalment | null>(null)
  const [interest, setInterest] = useState('')

  const main = useAsync(async () => {
    const [loans, schedule] = await Promise.all([api.listLoans(ids), api.listLoanSchedule({ loanId: id })])
    return { loan: loans.find((l) => l.id === id) ?? null, schedule: schedule.filter((s) => s.loan_id === id).sort((a, b) => a.instalment_no - b.instalment_no) }
  }, [api, id, idsKey])
  const loan = main.data?.loan ?? null
  const companyId = loan?.company_id
  const postings = useAsync(async () => (companyId ? api.listWorkflowPostings({ companyIds: [companyId], sourceId: id }) : []), [api, companyId, id])
  const audit = useAsync(() => api.listAudit({ entity: 'loans', entityId: id, limit: 50 }), [api, id])

  const schedule = useMemo(() => main.data?.schedule ?? [], [main.data])
  const pos = useMemo(() => (loan ? loanPosition(loan, schedule, asOf) : null), [loan, schedule, asOf])

  const back = <button className="btn ghost" onClick={() => nav('/treasury?tab=loans')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Treasury · Loan" title="Loan" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!main.data) return <div><PageHeader eyebrow="Treasury · Loan" title="Loan" actions={back} /><Panel><Loading rows={7} label="Loading the loan" /></Panel></div>
  if (!loan || !pos) {
    return (
      <div>
        <PageHeader eyebrow="Treasury · Loan" title="Loan" actions={back} />
        <Panel><Empty icon={<Landmark size={20} />} title="Loan not found or not shared with you" body="This loan does not exist in the companies you can access, or it is classified above your clearance." action={<button className="btn" onClick={() => nav('/treasury?tab=loans')}><ArrowLeft size={14} /> Back to Treasury</button>} /></Panel>
      </div>
    )
  }

  const taken = loan.direction === 'borrowed'
  const manage = can('treasury.manage', loan.company_id)
  const noManage = manage ? undefined : 'You need the permission treasury.manage in this company'
  const room = D(loan.principal).minus(loan.disbursed_amount)
  const pendingDisbursement = sum((postings.data ?? []).filter((w) => w.source === 'loan_disbursement' && w.status === 'pending').map((w) => D(w.payload.amount as Num | undefined)))
  const canDisburse = room.gt(0) && (loan.status === 'draft' || loan.status === 'active')
  const firstUnpaid = schedule.find((s) => s.status !== 'paid') ?? null
  const scheduledInterestPaid = sum(schedule.filter((s) => s.status === 'paid').map((s) => s.interest))
  const floating = loan.rate_type === 'floating'
  const overdueDays = (s: LoanInstalment) => (s.status !== 'paid' && s.due_date < asOf ? daysBetween(s.due_date, asOf) : 0)

  const startPayment = (s: LoanInstalment) => { setInterest(D(s.interest).toString()); setPaying(s) }
  const charged = paying ? (interest.trim() === '' ? D(paying.interest) : D(interest)) : ZERO
  const recorded = paying ? principalDue(paying).plus(charged) : ZERO
  const anyRecovered = schedule.some((s) => D(s.recovered ?? 0).gt(0))

  const columns: Column<LoanInstalment>[] = [
    { key: 'no', header: 'No', align: 'right', width: 56, render: (s) => <span className="num">{s.instalment_no}</span>, sort: (s) => s.instalment_no, csv: (s) => s.instalment_no },
    { key: 'due', header: 'Due date', render: (s) => <span className="num text-[12.5px]">{fmtDate(s.due_date)}</span>, sort: (s) => s.due_date, csv: (s) => s.due_date },
    { key: 'open', header: 'Opening principal', align: 'right', render: (s) => <Money value={s.opening_principal} currency={loan.currency} className="text-ink2" />, sort: (s) => D(s.opening_principal).toNumber(), csv: (s) => D(s.opening_principal).toFixed(2) },
    { key: 'principal', header: 'Principal', align: 'right', render: (s) => <Money value={s.principal} currency={loan.currency} dim />, sort: (s) => D(s.principal).toNumber(), csv: (s) => D(s.principal).toFixed(2) },
    ...(anyRecovered ? [{ key: 'recovered', header: 'Recovered through payroll', align: 'right' as const, render: (s: LoanInstalment) => (D(s.recovered ?? 0).gt(0) ? <Money value={s.recovered} currency={loan.currency} className="text-cyan" /> : <span className="text-muted">—</span>), sort: (s: LoanInstalment) => D(s.recovered ?? 0).toNumber(), csv: (s: LoanInstalment) => D(s.recovered ?? 0).toFixed(2) }] : []),
    { key: 'interest', header: floating ? 'Interest (indicative)' : 'Interest', align: 'right', render: (s) => <Money value={s.interest} currency={loan.currency} dim />, sort: (s) => D(s.interest).toNumber(), csv: (s) => D(s.interest).toFixed(2) },
    { key: 'total', header: 'Instalment', align: 'right', render: (s) => <Money value={s.total} currency={loan.currency} className="text-ink" />, sort: (s) => D(s.total).toNumber(), csv: (s) => D(s.total).toFixed(2) },
    { key: 'close', header: 'Closing principal', align: 'right', render: (s) => <Money value={s.closing_principal} currency={loan.currency} className="text-ink2" />, sort: (s) => D(s.closing_principal).toNumber(), csv: (s) => D(s.closing_principal).toFixed(2) },
    {
      key: 'status', header: 'Status', sort: (s) => s.status, csv: (s) => (s.status === 'proposed' ? 'awaiting approval' : overdueDays(s) > 0 ? `due — overdue ${overdueDays(s)} days` : s.status),
      render: (s) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={s.status} label={s.status === 'proposed' ? 'awaiting approval' : undefined} />
          {overdueDays(s) > 0 && <span className="chip neg">overdue {overdueDays(s)} day{overdueDays(s) === 1 ? '' : 's'}</span>}
        </span>
      ),
    },
    { key: 'paid', header: 'Paid on', render: (s) => (s.paid_on ? <span className="num text-[12.5px]">{fmtDate(s.paid_on)}</span> : <span className="text-muted">—</span>), sort: (s) => s.paid_on ?? '', csv: (s) => s.paid_on ?? '' },
    {
      key: 'journal', header: 'Entry',
      render: (s) => (s.journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + s.journal_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>),
    },
    {
      key: 'act', header: '', align: 'right',
      render: (s) => (firstUnpaid && s.id === firstUnpaid.id && s.status === 'due' && loan.status !== 'closed' && loan.status !== 'cancelled' ? (
        <button className="btn sm primary" disabled={!manage || loan.status !== 'active' || busy}
          title={!manage ? noManage : loan.status !== 'active' ? 'Record and approve the disbursement first' : 'Proposes the accounting entry for this instalment'}
          onClick={() => startPayment(s)}><Banknote size={13} /> {taken ? 'Record payment' : 'Record receipt'}</button>
      ) : null),
    },
  ]

  const chartLabels = schedule.length ? ['Start', ...schedule.map((s) => fmtMonth(s.due_date))] : []
  const chartValues = schedule.length ? [D(schedule[0].opening_principal).toNumber(), ...schedule.map((s) => D(s.closing_principal).toNumber())] : []
  const history = (audit.data ?? []).filter((a) => a.action !== 'update' || a.reason)

  return (
    <div>
      <PageHeader
        eyebrow={`Treasury · ${DIRECTION_LABEL[loan.direction]}`}
        title={`${loan.loan_no} · ${loan.name}`}
        subtitle={<>{taken ? 'Lender' : 'Borrower'}: <button className="link" onClick={() => nav('/parties/' + loan.party_id)}>{partyName(loan.party_id)}</button> · {companyName(loan.company_id)} · {human(loan.kind)}{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
        actions={<>
          {back}
          {(loan.status === 'draft' || loan.status === 'active') && <button className="btn" disabled={!manage} title={noManage} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
          {canDisburse && <button className="btn primary" disabled={!manage || busy} title={noManage ?? 'Proposes the accounting entry for the disbursement'} onClick={() => setDisbursing(true)}><BadgeCheck size={15} /> Record disbursement</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={loan.status} label={loan.status === 'draft' ? 'draft — not disbursed' : undefined} />
        <span className={cx('chip', taken ? 'warn' : 'cyan')}>{DIRECTION_LABEL[loan.direction]}</span>
        {floating && <span className="chip violet" title="Scheduled interest is indicative">floating rate</span>}
        {loan.confidentiality !== 'internal' && <span className="chip violet">{human(loan.confidentiality)}</span>}
        {pendingDisbursement.gt(0) && <span className="chip warn">disbursement awaiting approval</span>}
        {pos.overdue.length > 0 && loan.status === 'active' && <span className="chip neg">{pos.overdue.length} instalment{pos.overdue.length === 1 ? '' : 's'} overdue</span>}
      </div>

      {loan.status === 'draft' && <Note className="mb-4">This loan is a draft. Nothing has reached the ledger. Record its disbursement to propose the accounting entry; instalments can be recorded once the disbursement is approved.</Note>}
      {floating && <Note kind="warn" className="mb-4">This is a floating-rate loan{loan.rate_reset_date ? ` (next rate reset ${fmtDate(loan.rate_reset_date)})` : ''}. The interest in the schedule is indicative: it is calculated at {D(loan.rate_pct).toString()}% and will differ when the rate changes. The lender's statement is the authority for interest.</Note>}
      {pos.balloon && <Note kind="warn" className="mb-4">This loan ends with a balloon payment: the last instalment repays principal of <Money value={pos.balloon} currency={loan.currency} />{pos.maturity ? <> on {fmtDate(pos.maturity)}</> : null}, far more than the earlier instalments.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Principal" value={loan.principal} currency={loan.currency} sub="as sanctioned" />
        <Stat label="Disbursed" value={loan.disbursed_amount} currency={loan.currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" />{room.gt(0) ? <span>undisbursed <Money value={room} currency={loan.currency} compact /></span> : 'in full'}</span>} />
        <Stat label="Outstanding" value={pos.outstanding} currency={loan.currency} tone="gold" sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> disbursed less principal repaid</span>} />
        <Stat label="Interest paid so far" value={loan.interest_paid} currency={loan.currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> as charged{!D(loan.interest_paid).eq(scheduledInterestPaid) ? <span>; schedule said <Money value={scheduledInterestPaid} currency={loan.currency} compact /></span> : null}</span>} />
        <Stat label="Interest remaining" value={pos.interestRemaining} currency={loan.currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Contracted label={floating ? 'INDICATIVE' : 'CONTRACTED'} /> per schedule</span>} />
        <Tile label="Next instalment" sub={pos.next ? <span><span className="num">{fmtDate(pos.next.due_date)}</span> · {whenText(pos.next.due_date, asOf)}{pos.next.status === 'proposed' ? ' · awaiting approval' : ''}</span> : 'Nothing is outstanding'}>
          {pos.next ? <Money value={pos.next.total} currency={loan.currency} compact /> : <span className="text-muted">—</span>}
        </Tile>
        <Stat label="Overdue" value={loan.status === 'active' ? pos.overdueAmount : 0} currency={loan.currency} tone={loan.status === 'active' && pos.overdueAmount.gt(0) ? 'neg' : undefined} sub={loan.status === 'active' ? `${pos.overdue.length} instalment${pos.overdue.length === 1 ? '' : 's'} past the due date` : 'The loan is not active'} />
        <Tile label="Maturity" sub={pos.maturity ? whenText(pos.maturity, asOf) : 'No schedule'}><span className="num text-[18px]">{fmtDate(pos.maturity)}</span></Tile>
        <Tile label="Instalments paid" sub={`${pos.totalInstalments - pos.paidInstalments} still to be paid`}><span className="num">{pos.paidInstalments}</span> <span className="text-[14px] text-muted">of {pos.totalInstalments}</span></Tile>
        <Stat label="Due within 30 days" value={pos.dueIn30} currency={loan.currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Contracted /> includes overdue</span>} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Principal outstanding over the schedule" right={<Contracted />}>
            <Panel className="p-4" lit={false}>
              {schedule.length ? <TrendChart labels={chartLabels} series={[{ name: 'Principal outstanding per schedule', values: chartValues }]} height={230} /> : <Empty title="No schedule" body="This loan has no repayment schedule." />}
            </Panel>
          </Section>

          <Section title="Repayment schedule">
            <Panel lit={false}>
              <DataTable columns={columns} rows={schedule} rowKey={(s) => s.id} pageSize={60} exportName={`loan-schedule-${loan.loan_no}`}
                rowClass={(s) => (overdueDays(s) > 0 && loan.status === 'active' ? 'bg-negsoft' : undefined)}
                toolbar={<span className="text-[12px] text-muted">Instalments are recorded in order. Recording one proposes an accounting entry; it is marked paid only when that entry is approved.</span>}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {schedule.length} instalment{schedule.length === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r')}><Money value={sum(schedule.map((s) => s.principal))} currency={loan.currency} /></td>
                  <td className={cx(foot, 'r')}><Money value={sum(schedule.map((s) => s.interest))} currency={loan.currency} /></td>
                  <td className={cx(foot, 'r')}><Money value={sum(schedule.map((s) => s.total))} currency={loan.currency} className="font-medium text-ink" /></td>
                  <td className={foot} colSpan={5} />
                </tr>}
                empty={{ title: 'No schedule', body: 'This loan has no repayment schedule.' }} />
            </Panel>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Rate"><span className="num">{D(loan.rate_pct).toString()}%</span> a year · {loan.rate_type}</Fact>
              <Fact label="Rate reset date">{loan.rate_type === 'floating' ? <span className="num">{fmtDate(loan.rate_reset_date)}</span> : 'Not applicable — fixed rate'}</Fact>
              <Fact label="Repayment">{REPAYMENT_LABEL[loan.repayment]}</Fact>
              <Fact label="Tenure"><span className="num">{loan.tenure_months}</span> months</Fact>
              <Fact label="Start date"><span className="num">{fmtDate(loan.start_date)}</span></Fact>
              <Fact label="First due date"><span className="num">{fmtDate(loan.first_due_date)}</span></Fact>
              <Fact label="Sanction reference">{loan.sanction_ref ?? '—'}</Fact>
              <Fact label="Principal repaid"><Money value={loan.principal_repaid} currency={loan.currency} /></Fact>
              <Fact label="Security" className="sm:col-span-2">{loan.security ?? 'None recorded'}</Fact>
              <Fact label="Covenants" className="sm:col-span-2">{loan.covenants ?? 'None recorded'}</Fact>
              <Fact label={taken ? 'Loan ledger (liability)' : 'Loan ledger (asset)'}>{accountName(loan.loan_account_id)}</Fact>
              <Fact label={taken ? 'Interest ledger (expense)' : 'Interest ledger (income)'}>{accountName(loan.interest_account_id)}</Fact>
              {loan.notes && <Fact label="Notes" className="sm:col-span-2">{loan.notes}</Fact>}
            </Panel>
          </Section>

          <ProposedEntries companyIds={[loan.company_id]} sourceId={loan.id} sources={['loan_disbursement']} title="Disbursement entries" />
          <Attachments companyId={loan.company_id} entity="loans" entityId={loan.id} />

          <Section title="History">
            <Panel className="max-h-[280px] overflow-auto p-1.5" lit={false}>
              {audit.error ? <div className="px-3 py-3 text-[12.5px] text-muted">The history could not be loaded: {audit.error}</div>
                : !audit.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
                : history.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No history is recorded for this loan.</div>
                : history.map((a) => (
                  <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{a.action === 'insert' ? 'recorded' : human(a.action)}</span> <span className="text-muted">· {a.actor_name ?? 'Unknown user'} · {fmtDateTime(a.at)}</span>
                    {a.reason && <div className="text-[11.5px] text-muted">{a.reason}</div>}
                  </div>
                ))}
            </Panel>
          </Section>
        </div>
      </div>

      <LoanForm open={editing} loan={loan} companyIds={[loan.company_id]} onClose={() => setEditing(false)} />

      <MoneyMoveDialog open={disbursing} companyId={loan.company_id} title="Record disbursement" subtitle={`${loan.loan_no} · ${taken ? 'received from' : 'paid to'} ${partyName(loan.party_id)}`}
        max={room.toString()} confirm="Propose the entry" busy={busy} onCancel={() => setDisbursing(false)}
        extra={<div className="space-y-1.5 text-[12px] text-muted">
          <div>On approval: {taken ? 'the bank or cash ledger is debited and the loan ledger is credited.' : 'the loan ledger is debited and the bank or cash ledger is credited.'}</div>
          {pendingDisbursement.gt(0) && <div className="text-warn">A disbursement of <Money value={pendingDisbursement} currency={loan.currency} /> is already awaiting approval. Make sure this one is not the same money.</div>}
        </div>}
        onConfirm={(v) => void act(() => api.disburseLoan(loan.id, { amount: v.amount, bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method }), 'Disbursement proposed — awaiting approval').then((j) => { if (j) setDisbursing(false) })} />

      <MoneyMoveDialog open={!!paying} companyId={loan.company_id} title={taken ? 'Record payment of the instalment' : 'Record receipt of the instalment'}
        subtitle={paying ? `${loan.loan_no} · instalment ${paying.instalment_no} of ${pos.totalInstalments} · due ${fmtDate(paying.due_date)}` : undefined}
        amount={paying ? instalmentDue(paying).toString() : undefined} amountEditable={false} confirm="Propose the entry" busy={busy} onCancel={() => setPaying(null)}
        extra={paying && (
          <div className="space-y-3">
            <Field label="Interest actually charged" hint="The lender's statement is the authority for interest. Leave the scheduled figure when it agrees with the statement.">
              <input className="field num" inputMode="decimal" value={interest} onChange={(e) => setInterest(digits(e.target.value))} />
            </Field>
            <Panel className="p-3.5 text-[12.5px]" lit={false}>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink2">
                <span>Amount that will be recorded = principal</span><Money value={paying.principal} currency={loan.currency} /><span>+ interest charged</span><Money value={charged} currency={loan.currency} /><span>=</span><Money value={recorded} currency={loan.currency} className="font-medium text-ink" />
              </div>
              {!charged.eq(D(paying.interest)) && <div className="mt-1.5 text-[11.5px] text-warn">The amount field above shows the scheduled instalment. The entry will be proposed for the amount on this line, using the interest you entered in place of the scheduled <Money value={paying.interest} currency={loan.currency} />.</div>}
            </Panel>
          </div>
        )}
        onConfirm={(v) => { if (!paying) return; void act(() => api.payLoanInstalment(paying.id, { bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method, interest: charged.toString() }), 'Instalment proposed — awaiting approval').then((j) => { if (j) setPaying(null) }) }} />
    </div>
  )
}
