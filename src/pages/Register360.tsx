import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CalendarClock, CheckCircle2, ListTodo, Pencil, Plus } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { LedgerLine } from '@/engine/types'
import type { Certainty, Frequency, RegisterField, RegisterItem, Task, TaskInput } from '@/engine/opsTypes'
import { CERTAINTY_MEANING, escalatedAmount, occurrences, type ForwardCertainty } from '@/engine/forward'
import { D, sum } from '@/lib/money'
import { addMonths, daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { ledgerLink } from '@/lib/data'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Attachments, CustomFields, useAccountName, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'

const CERT_CLS: Record<Certainty, string> = { contracted: 'cyan', committed: 'cyan', scheduled: 'cyan', expected: 'gold', probable: 'gold', possible: 'warn', contingent: 'warn', forecast: 'violet' }
const FREQ: Record<Frequency, string> = { once: 'Once', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' }
const PRIORITY_CLS: Record<Task['priority'], string> = { low: '', normal: 'cyan', high: 'warn', critical: 'neg' }
const PRIORITIES: Task['priority'][] = ['low', 'normal', 'high', 'critical']
const ACTION_LABEL: Record<string, string> = { insert: 'recorded', update: 'changed' }
const foot = 'border-t border-line2 px-[14px] py-[10px]'

function CertaintyChip({ value }: { value: Certainty }) {
  return <span className={cx('chip', CERT_CLS[value])} title={CERTAINTY_MEANING[value.toUpperCase() as ForwardCertainty]}>{value.toUpperCase()}</span>
}

const dayWord = (n: number) => `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`
/** How far away a date is, stated as a fact. */
function Countdown({ date, asOf }: { date: string; asOf: string }) {
  const n = daysBetween(asOf, date)
  if (n === 0) return <span className="chip warn">today</span>
  return n > 0 ? <span className={cx('chip', n <= 30 ? 'warn' : '')}>{dayWord(n)} remain</span> : <span className="chip neg">{dayWord(n)} passed</span>
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('min-w-0', wide && 'sm:col-span-2 xl:col-span-3')}>
      <div className="label">{label}</div>
      <div className="break-words text-[13px] text-ink">{children}</div>
    </div>
  )
}
const none = <span className="text-muted">—</span>

const taskInput = (t: Task, change: Partial<TaskInput>): TaskInput => ({
  id: t.id, company_id: t.company_id, entity: t.entity, entity_id: t.entity_id, title: t.title, detail: t.detail, due_date: t.due_date,
  owner_user: t.owner_user, owner_name: t.owner_name, priority: t.priority, status: t.status, outcome: t.outcome, ...change,
})

export default function Register360() {
  const { id } = useParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const mode = useApp((s) => s.mode)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const t = today()

  const main = useAsync(async () => {
    if (!id) throw new Error('No register item was named.')
    const [item, kinds] = await Promise.all([api.getRegisterItem(id), api.listRegisterKinds()])
    return { item, kinds }
  }, [api, id])
  const item: RegisterItem | undefined = main.data && main.data.item.id === id ? main.data.item : undefined
  const kind = item ? main.data?.kinds.find((k) => k.key === item.kind) : undefined

  const ledger = useAsync(async () => (item?.org_unit_id ? api.ledgerLines({ company_ids: [item.company_id], org_unit_id: item.org_unit_id, limit: 200 }) : null), [api, item?.id, item?.company_id, item?.org_unit_id])
  // what the tagged entries are: a cost, money still held by a person, or something else. An advance is not a cost.
  const byLedger = useAsync(async () => (item?.org_unit_id ? api.ledgerBalances([item.company_id], '1990-01-01', '2999-12-31', { dim: item.org_unit_id }) : []), [api, item?.id, item?.company_id, item?.org_unit_id])
  // claims and advances that name this item; shown to people who may read expenses
  const seesExpenses = !!item && (can('expense.view', item.company_id) || can('expense.approve', item.company_id) || can('expense.create', item.company_id))
  const linked = useAsync(async () => {
    if (!item || !seesExpenses) return { claims: [], advances: [] }
    const [claims, advances] = await Promise.all([api.listClaims({ companyIds: [item.company_id] }), api.listAdvances({ companyIds: [item.company_id] })])
    return { claims: claims.filter((c) => c.register_item_id === item.id), advances: advances.filter((a) => a.register_item_id === item.id) }
  }, [api, item?.id, item?.company_id, seesExpenses])
  const tasks = useAsync(async () => (item ? api.listTasks({ companyIds: [item.company_id], entity: 'register_items', entityId: item.id }) : []), [api, item?.id, item?.company_id])
  const audit = useAsync(async () => (item ? api.listAudit({ entity: 'register_items', entityId: item.id, limit: 50 }) : []), [api, item?.id])

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', due_date: '', owner_name: '', priority: 'normal' as Task['priority'] })
  const [closing, setClosing] = useState<Task | null>(null)
  const [outcome, setOutcome] = useState('')

  const horizon = addMonths(t, 12)
  const schedule = useMemo(() => {
    if (!item || item.status !== 'active' || item.direction === 'none' || D(item.amount).lte(0)) return []
    return occurrences(item, t, horizon).map((date) => ({ date, amount: escalatedAmount(item, date), overdue: date < t }))
  }, [item, t, horizon])
  const scheduleTotal = sum(schedule.map((x) => x.amount))

  // every hook runs on every draw, before the page may return early while it loads
  const split = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]))
    let cost = D(0), held = D(0), other = D(0)
    for (const b of byLedger.data ?? []) {
      const a = byId.get(b.account_id)
      const net = D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit)
      if (a?.type === 'expense') cost = cost.plus(net)
      else if (a?.control_type === 'advance_paid') held = held.plus(net)
      else other = other.plus(net)
    }
    return { cost, held, other }
  }, [byLedger.data, accounts])

  if (main.error) return <ErrorBox message={main.error} retry={main.reload} />
  if (!item) return <Panel><Loading rows={7} label="Loading the register item" /></Panel>

  const mayManage = can('register.manage', item.company_id)
  const noSchedule = item.status !== 'active' ? `This item is ${item.status}, so nothing is scheduled.`
    : item.direction === 'none' ? 'This item records no movement of money, so there is nothing to schedule.'
    : D(item.amount).lte(0) ? 'No amount is recorded on this item.'
    : !item.next_due && !item.start_date ? 'Neither a start date nor a next-due date is recorded, so no schedule can be drawn.'
    : 'Nothing falls due in the next 12 months.'

  const fieldValue = (f: RegisterField): ReactNode => {
    const v = item.data[f.key]
    if (v === null || v === undefined || v === '') return none
    if (f.type === 'money') return <Money value={String(v)} currency={item.currency} />
    if (f.type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No'
    if (f.type === 'date' && typeof v === 'string') return <span className="inline-flex flex-wrap items-center gap-2"><span className="num">{fmtDate(v)}</span>{f.alert && <Countdown date={v} asOf={t} />}</span>
    if (f.type === 'number') return <span className="num">{String(v)}</span>
    return String(v)
  }
  const known = new Set((kind?.fields ?? []).map((f) => f.key))
  const extras = Object.entries(item.data ?? {}).filter(([k, v]) => !known.has(k) && v !== null && v !== undefined && v !== '')

  const l = ledger.data
  const debit = l ? D(l.sum_debit).plus(l.restricted.debit) : D(0)
  const credit = l ? D(l.sum_credit).plus(l.restricted.credit) : D(0)
  const entries = l ? l.total + l.restricted.count : 0
  const lineColumns: Column<LedgerLine>[] = [
    { key: 'date', header: 'Date', sort: (r) => r.journal_date, csv: (r) => r.journal_date, render: (r) => <span className="num text-[12.5px]">{fmtDate(r.journal_date)}</span> },
    { key: 'voucher', header: 'Voucher', sort: (r) => r.voucher_no ?? '', csv: (r) => r.voucher_no ?? '', render: (r) => <span className="num text-[12.5px] text-gold">{r.voucher_no ?? '—'}</span> },
    { key: 'ledger', header: 'Ledger', sort: (r) => r.account_code, csv: (r) => `${r.account_code} ${r.account_name}`, render: (r) => <span className="text-ink2"><span className="num text-[12px] text-muted">{r.account_code}</span> {r.account_name}</span> },
    { key: 'narration', header: 'Narration', csv: (r) => r.description ?? r.narration ?? '', render: (r) => <span className="block max-w-[300px] truncate text-[12.5px] text-ink2" title={r.description ?? r.narration ?? ''}>{r.description ?? r.narration ?? '—'}</span> },
    { key: 'debit', header: 'Debit', align: 'right', sort: (r) => D(r.debit).toNumber(), csv: (r) => D(r.debit).toFixed(2), render: (r) => <Money value={r.debit} dim /> },
    { key: 'credit', header: 'Credit', align: 'right', sort: (r) => D(r.credit).toNumber(), csv: (r) => D(r.credit).toFixed(2), render: (r) => <Money value={r.credit} dim /> },
  ]

  const addTask = async () => {
    const r = await act(() => api.saveTask({ company_id: item.company_id, entity: 'register_items', entity_id: item.id, title: draft.title.trim(), due_date: draft.due_date || null, owner_name: draft.owner_name.trim() || null, priority: draft.priority }), 'Follow-up added')
    if (r) { setAdding(false); setDraft({ title: '', due_date: '', owner_name: '', priority: 'normal' }) }
  }
  const closeTask = async () => {
    if (!closing) return
    const r = await act(() => api.saveTask(taskInput(closing, { status: 'done', outcome: outcome.trim() })), 'Follow-up closed')
    if (r) { setClosing(null); setOutcome('') }
  }

  return (
    <div>
      <PageHeader
        eyebrow={`Registers · ${kind?.name ?? item.kind.replace(/_/g, ' ')}`}
        title={`${item.ref_no} · ${item.title}`}
        subtitle={<>{companyName(item.company_id)}{item.party_id ? <> · <button className="link" onClick={() => nav('/parties/' + item.party_id)}>{partyName(item.party_id)}</button></> : ' · no party recorded'}</>}
        actions={<>
          <button className="btn ghost" onClick={() => nav('/registers')}><ArrowLeft size={15} /> Back</button>
          <button className="btn primary" disabled={!mayManage} title={mayManage ? 'Change what is recorded on this item' : 'You are not authorised to manage the registers of this company'} onClick={() => nav('/registers?edit=' + item.id)}><Pencil size={15} /> Edit</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={item.status} />
        <CertaintyChip value={item.certainty} />
        {item.state && item.state !== item.status && <span className="chip" title="State, as described by the person who recorded it">{item.state.replace(/_/g, ' ')}</span>}
        {item.confidentiality !== 'internal' && <span className="chip gold">{item.confidentiality.replace(/_/g, ' ')}</span>}
        {item.auto_renew && <span className="chip cyan">renews automatically</span>}
        {mode === 'demo' && <Truth state="DEMO" />}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="What is recorded">
            <Panel className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 xl:grid-cols-3" lit={false}>
              <Fact label="Amount of one occurrence">{item.direction === 'none' && D(item.amount).isZero() ? none : <><Money value={item.amount} currency={item.currency} /> <span className="text-[12px] text-muted">{item.direction === 'in' ? 'comes in' : item.direction === 'out' ? 'goes out' : 'no movement'}</span></>}</Fact>
              <Fact label="Frequency">{FREQ[item.frequency]}</Fact>
              <Fact label="Total value of the agreement">{item.total_value != null ? <Money value={item.total_value} currency={item.currency} /> : none}</Fact>
              <Fact label="Start date">{item.start_date ? <span className="num">{fmtDate(item.start_date)}</span> : none}</Fact>
              <Fact label="End date">{item.end_date ? <span className="inline-flex flex-wrap items-center gap-2"><span className="num">{fmtDate(item.end_date)}</span>{item.status === 'active' && <Countdown date={item.end_date} asOf={t} />}</span> : none}</Fact>
              <Fact label="Next due">{item.next_due ? <span className="inline-flex flex-wrap items-center gap-2"><span className="num">{fmtDate(item.next_due)}</span>{item.status === 'active' && <Countdown date={item.next_due} asOf={t} />}</span> : none}</Fact>
              <Fact label="Renewal">{item.renewal_date ? <span className="inline-flex flex-wrap items-center gap-2"><span className="num">{fmtDate(item.renewal_date)}</span>{item.status === 'active' && <Countdown date={item.renewal_date} asOf={t} />}</span> : item.auto_renew ? 'Renews automatically; no date recorded' : none}</Fact>
              <Fact label="Cancel by">{item.cancel_by ? <span className="inline-flex flex-wrap items-center gap-2"><span className="num">{fmtDate(item.cancel_by)}</span>{item.status === 'active' && <Countdown date={item.cancel_by} asOf={t} />}</span> : none}</Fact>
              <Fact label="Escalation">{item.escalation_pct != null && !D(item.escalation_pct).isZero() ? <><span className="num">{D(item.escalation_pct).toString()}%</span>{item.escalation_date ? <> from <span className="num">{fmtDate(item.escalation_date)}</span>, then every {item.escalation_months && item.escalation_months > 0 ? item.escalation_months : 12} months</> : <span className="text-[12px] text-warn"> · no date recorded, so it is not applied</span>}</> : none}</Fact>
              <Fact label="Probability">{item.probability != null ? <><span className="num">{D(item.probability).toString()}%</span> <span className="text-[12px] text-muted">as assessed by a person</span></> : <span className="text-muted">Not assessed</span>}</Fact>
              <Fact label="Owner">{item.owner_name ?? <span className="text-warn">No owner is recorded</span>}</Fact>
              <Fact label="Confidentiality">{item.confidentiality.replace(/_/g, ' ')}</Fact>
              <Fact label="Ledger account">{item.account_id ? accountName(item.account_id) : none}</Fact>
              <Fact label="Cost-tracking dimension">{item.org_unit_id ? unitName(item.org_unit_id) : <span className="text-muted">None</span>}</Fact>
              <Fact label="Recorded">{fmtDateTime(item.created_at)}{item.updated_at && item.updated_at !== item.created_at && <span className="text-[12px] text-muted"> · changed {fmtDateTime(item.updated_at)}</span>}</Fact>
              <Fact label="Notes" wide>{item.notes ? <span className="whitespace-pre-wrap text-ink2">{item.notes}</span> : none}</Fact>
            </Panel>
          </Section>

          {((kind?.fields.length ?? 0) > 0 || extras.length > 0) && (
            <Section title={`${kind?.name ?? 'Item'} — details`}>
              <Panel className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 xl:grid-cols-3" lit={false}>
                {(kind?.fields ?? []).map((f) => <Fact key={f.key} label={f.label}>{fieldValue(f)}</Fact>)}
                {extras.map(([k, v]) => <Fact key={k} label={k.replace(/_/g, ' ')}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Fact>)}
              </Panel>
            </Section>
          )}

          <Section title={`Upcoming schedule — to ${fmtDate(horizon)}`} right={<CertaintyChip value={item.certainty} />}>
            <Panel lit={false}>
              {schedule.length === 0 ? <Empty icon={<CalendarClock size={20} />} title="Nothing is scheduled" body={noSchedule} /> : (
                <div className="overflow-auto">
                  <table className="table dense">
                    <thead><tr><th>Date</th><th>Certainty</th><th>Note</th><th className="r">{item.direction === 'in' ? 'Inflow' : 'Outflow'}</th></tr></thead>
                    <tbody>
                      {schedule.map((x) => (
                        <tr key={x.date}>
                          <td><span className="num">{fmtDate(x.date)}</span></td>
                          <td><CertaintyChip value={item.certainty} /></td>
                          <td className="text-[12px] text-muted">{x.overdue ? <span className="text-neg">date has passed — {dayWord(daysBetween(x.date, t))} ago</span> : !x.amount.eq(D(item.amount)) ? `includes the ${D(item.escalation_pct).toString()}% escalation` : ''}</td>
                          <td className="r"><Money value={x.amount} currency={item.currency} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {schedule.length} occurrence{schedule.length === 1 ? '' : 's'} · {item.certainty.toUpperCase()}</td><td className={cx(foot, 'r')}><Money value={scheduleTotal} currency={item.currency} className="font-medium text-ink" /></td></tr></tfoot>
                  </table>
                </div>
              )}
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">Drawn from the recorded amount, frequency and dates. It is what was agreed, not what has been paid. NUMERO does not move money.</div>
          </Section>

          <Section title="Recorded so far" right={<Truth state="ACTUAL" />}>
            {!item.org_unit_id ? (
              <Note kind="warn">This item has no cost-tracking dimension. Spending cannot be traced to it without one, so NUMERO cannot say what has actually been recorded against it. Entries tagged to a dimension are the only link between the ledger and a register item.</Note>
            ) : ledger.error ? <ErrorBox message={ledger.error} retry={ledger.reload} /> : !l ? <Panel><Loading rows={4} label="Loading posted entries" /></Panel> : (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <Panel className="p-4" lit={false}><div className="eyebrow">Cost recorded</div><Money value={split.cost} className="mt-1.5 block text-[18px] text-gold" /><div className="mt-1 text-[11px] text-muted">Posted to expense ledgers</div></Panel>
                  <Panel className="p-4" lit={false}><div className="eyebrow">Advances still held</div><Money value={split.held} className="mt-1.5 block text-[18px]" /><div className="mt-1 text-[11px] text-muted">Money held by people. Not a cost until a claim is approved</div></Panel>
                  <Panel className="p-4" lit={false}><div className="eyebrow">All tagged entries, debits less credits</div><Money value={debit.minus(credit)} className="mt-1.5 block text-[18px]" /><div className="mt-1 text-[11px] text-muted">{entries.toLocaleString()} posted entr{entries === 1 ? 'y' : 'ies'} tagged to {unitName(item.org_unit_id)}</div></Panel>
                </div>
                {l.restricted.count > 0 && <Note kind="warn" className="mb-3">{l.restricted.count.toLocaleString()} entr{l.restricted.count === 1 ? 'y is' : 'ies are'} restricted; their amounts are included in the totals. Your account is not cleared to see their detail, so they are not listed below.</Note>}
                {l.total > l.rows.length && <Note className="mb-3">The {l.rows.length.toLocaleString()} most recent of {l.total.toLocaleString()} entries are listed. The totals cover all of them. Open the ledger to see every entry.</Note>}
                <Panel lit={false}>
                  <DataTable
                    columns={lineColumns} rows={l.rows} rowKey={(r) => r.id} onRow={(r) => nav('/journals/' + r.journal_id)} exportName={`register-${item.ref_no}-entries`} totalCount={l.total} pageSize={25}
                    toolbar={<button className="btn sm" onClick={() => nav(ledgerLink({ unit: item.org_unit_id ?? undefined }))}><BookOpen size={13} /> Open in the ledger</button>}
                    footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={4}>Total of every entry{l.restricted.count > 0 ? ', restricted entries included' : ''}</td><td className={cx(foot, 'r')}><Money value={debit} /></td><td className={cx(foot, 'r')}><Money value={credit} /></td></tr>}
                    empty={{ title: 'Nothing has been posted against this item', body: l.restricted.count > 0 ? 'Every entry tagged to this item is restricted. The totals above include them.' : 'When a journal, bill or claim is tagged to this item\'s dimension and posted, it appears here.', icon: <BookOpen size={20} /> }}
                  />
                </Panel>
              </>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          {linked.data && (linked.data.claims.length > 0 || linked.data.advances.length > 0) && (
            <Section title="Claims and advances linked to this item">
              <Panel className="p-1.5" lit={false}>
                {linked.data.advances.map((a) => (
                  <button key={a.id} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface2" onClick={() => nav('/expenses/advances/' + a.id)}>
                    <span className="min-w-0 truncate"><span className="num text-gold">{a.advance_no}</span> <span className="text-ink2">· advance · {partyName(a.recipient_party_id)} · {a.purpose}</span></span>
                    <span className="flex flex-none items-center gap-2"><Money value={a.released_amount} currency={a.currency} /><StatusChip status={a.status} /></span>
                  </button>
                ))}
                {linked.data.claims.map((c) => (
                  <button key={c.id} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface2" onClick={() => nav('/expenses/claims/' + c.id)}>
                    <span className="min-w-0 truncate"><span className="num text-gold">{c.claim_no}</span> <span className="text-ink2">· claim · {partyName(c.claimant_party_id)} · {c.title}</span></span>
                    <span className="flex flex-none items-center gap-2"><Money value={D(c.approved_total).gt(0) ? c.approved_total : c.total} currency={c.currency} /><StatusChip status={c.status} /></span>
                  </button>
                ))}
              </Panel>
              <div className="mt-1.5 text-[11.5px] text-muted">An advance is money held by a person, not a cost of this item. A claim becomes a cost when its entry is posted{item.org_unit_id ? '; the entry then carries this item’s dimension and appears under “Recorded so far”.' : '. This item has no cost-tracking dimension, so posted entries cannot be traced to it.'}</div>
            </Section>
          )}

          <Attachments companyId={item.company_id} entity="register_items" entityId={item.id} />
          <CustomFields companyId={item.company_id} entity="register_items" entityId={item.id} scopeKey={item.kind} readOnly={!mayManage} />

          <Section title="Follow-ups" right={!adding ? <button className="btn sm no-print" onClick={() => setAdding(true)}><Plus size={13} /> Add follow-up</button> : undefined}>
            <Panel className="p-1.5" lit={false}>
              {adding && (
                <div className="m-1.5 space-y-3 rounded-lg border border-line bg-surface p-3">
                  <Field label="What needs to be done"><input className="field" value={draft.title} autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Due date"><input type="date" className="field" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></Field>
                    <Field label="Owner name"><input className="field" value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} /></Field>
                    <Field label="Priority"><select className="field" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Task['priority'] })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
                    <button className="btn sm primary" disabled={busy || !draft.title.trim()} onClick={() => void addTask()}>{busy ? <Spinner size={13} /> : <Plus size={13} />} Add</button>
                  </div>
                </div>
              )}
              {tasks.error ? <div className="px-3 py-3 text-[12.5px] text-neg">{tasks.error}</div>
                : tasks.loading && !tasks.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
                : !tasks.data?.length ? (!adding && <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><ListTodo size={14} /> No follow-up is recorded. Add one to give this item an owner and a date.</div>)
                : tasks.data.map((k) => {
                  const live = k.status === 'open' || k.status === 'in_progress'
                  const n = k.due_date ? daysBetween(t, k.due_date) : null
                  return (
                    <div key={k.id} className="flex items-start gap-3 rounded-lg px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className={cx('text-[12.5px]', live ? 'text-ink' : 'text-ink2')}>{k.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                          <StatusChip status={k.status} />
                          <span className={cx('chip', PRIORITY_CLS[k.priority])}>{k.priority}</span>
                          <span>{k.owner_name ?? 'no owner'}</span>
                          {k.due_date && <span>· due {fmtDate(k.due_date)}{live && n !== null && (n < 0 ? <span className="text-neg"> · {dayWord(n)} overdue</span> : n === 0 ? <span className="text-warn"> · today</span> : <> · in {dayWord(n)}</>)}</span>}
                        </div>
                        {k.outcome && <div className="mt-1 text-[11.5px] text-ink2">Outcome: {k.outcome}</div>}
                      </div>
                      {live && <button className="btn sm no-print" onClick={() => { setOutcome(''); setClosing(k) }}><CheckCircle2 size={13} /> Close</button>}
                    </div>
                  )
                })}
            </Panel>
          </Section>

          <Section title="History">
            <Panel className="max-h-[340px] overflow-auto p-1.5" lit={false}>
              {audit.error ? <div className="px-3 py-3 text-[12.5px] text-muted">The history could not be loaded: {audit.error}</div>
                : audit.loading && !audit.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
                : !audit.data?.length ? <div className="px-3 py-3 text-[12.5px] text-muted">No history is available to you for this item.</div>
                : audit.data.map((a) => (
                  <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{ACTION_LABEL[a.action] ?? a.action.replace(/_/g, ' ')}</span> <span className="text-muted">· {a.actor_name ?? 'unknown user'} · {fmtDateTime(a.at)}</span>
                    {a.reason && <div className="mt-0.5 text-[12px] text-ink2">Reason: {a.reason}</div>}
                  </div>
                ))}
            </Panel>
          </Section>
        </div>
      </div>

      <Modal open={!!closing} onClose={() => setClosing(null)} title="Close the follow-up" subtitle={closing?.title} width={500}
        footer={<><button className="btn ghost" onClick={() => setClosing(null)}>Cancel</button><button className="btn primary" disabled={busy || !outcome.trim()} onClick={() => void closeTask()}>{busy ? <Spinner /> : <CheckCircle2 size={15} />} Close follow-up</button></>}>
        <label className="label">Outcome (required — what was done or decided)</label>
        <textarea className="field" rows={3} autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </Modal>
    </div>
  )
}
