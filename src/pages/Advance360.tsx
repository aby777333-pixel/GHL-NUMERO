import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, BadgeCheck, Ban, Banknote, BellRing, CirclePause, FileSearch, HandCoins, Info, ListChecks, Receipt, Send, ShieldQuestion, Undo2, XCircle,
} from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { Advance, ExpenseClaim, Task } from '@/engine/opsTypes'
import { advanceAge, advanceMemory, advanceOutstanding, isOverdue, type MemoryFact } from '@/engine/ops'
import { D, fmtMoney } from '@/lib/money'
import { addDays, daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip } from '@/ui/kit'
import { ApprovalTrail, Attachments, MoneyMoveDialog, ProposedEntries, Stat, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'

const CLAIM_LABEL: Record<ExpenseClaim['status'], { label: string; tone: string }> = {
  draft: { label: 'DRAFT', tone: '' },
  submitted: { label: 'CLAIM PENDING', tone: 'warn' },
  approved: { label: 'APPROVED — entry awaiting approval', tone: 'cyan' },
  posted: { label: 'PAYABLE', tone: 'gold' },
  paid: { label: 'SETTLED', tone: 'pos' },
  rejected: { label: 'REJECTED', tone: 'neg' },
  cancelled: { label: 'CANCELLED', tone: '' },
}
const upper = (s: string) => s.replace(/_/g, ' ').toUpperCase()
const numeric = (s: string) => s.replace(/[^\d.]/g, '')
const plain = (f: MemoryFact) => f.kind === 'none' || f.kind === 'clean'

type NoteAction = 'disputed' | 'under_review' | 'hold' | 'clear' | 'follow_up'
const NOTE_TEXT: Record<NoteAction, { title: string; body: string; label: string; confirm: string; done: string }> = {
  disputed: { title: 'Mark the advance as disputed', body: 'Use this when the person and the company do not agree on the amount held or on how it was used. The amounts are not changed.', label: 'What is disputed', confirm: 'Mark disputed', done: 'Advance marked as disputed' },
  under_review: { title: 'Mark the advance as under review', body: 'Use this while the records of this advance are being examined. The amounts are not changed.', label: 'What is being reviewed', confirm: 'Mark under review', done: 'Advance marked as under review' },
  hold: { title: 'Hold this advance', body: 'The advance is marked as under review while the earlier records of this person are examined. It can still be approved later; the review status is cleared with a note.', label: 'Why the advance is held', confirm: 'Hold', done: 'Advance held — marked as under review' },
  clear: { title: 'Clear the review status', body: 'The advance returns to the status that follows from its amounts.', label: 'How the matter was resolved', confirm: 'Clear review status', done: 'Review status cleared' },
  follow_up: { title: 'Record follow-up', body: 'A follow-up records today as the date of the last contact. It does not change the amount or the status of the advance.', label: 'What was done', confirm: 'Record follow-up', done: 'Follow-up recorded' },
}

interface TaskForm { kind: 'evidence' | 'escalate'; title: string; detail: string; due_date: string; owner_name: string; priority: Task['priority'] }

export default function Advance360() {
  const { id } = useParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const session = useApp((s) => s.session)
  const privacy = useApp((s) => s.privacy)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const { act, busy } = useAction()
  const asOf = today()
  const allIds = useMemo(() => companies.map((c) => c.id), [companies])
  const allKey = allIds.join(',')

  const main = useAsync(async () => {
    const [advances, claims] = await Promise.all([api.listAdvances({ companyIds: allIds }), api.listClaims({ companyIds: allIds })])
    return { advances, claims }
  }, [api, allKey])
  const a: Advance | undefined = main.data?.advances.find((x) => x.id === id)

  const item = useAsync(async () => (a?.register_item_id ? api.getRegisterItem(a.register_item_id).catch(() => null) : null), [api, a?.register_item_id])
  const tasks = useAsync(async () => (a ? api.listTasks({ companyIds: [a.company_id], entity: 'advances', entityId: a.id }) : []), [api, a?.id, a?.company_id])
  const audit = useAsync(async () => (id ? api.listAudit({ entity: 'advances', entityId: id, limit: 100 }) : []), [api, id])

  const [dialog, setDialog] = useState<'approve' | 'reject' | 'release' | 'return' | 'cancel' | null>(null)
  const [noteFor, setNoteFor] = useState<NoteAction | null>(null)
  const [note, setNote] = useState('')
  const [approved, setApproved] = useState('')
  const [comment, setComment] = useState('')
  const [task, setTask] = useState<TaskForm | null>(null)
  useEffect(() => { if (noteFor) setNote('') }, [noteFor])

  const names = useMemo(() => {
    const m = new Map<ID, string>()
    for (const e of audit.data ?? []) if (e.actor && e.actor_name) m.set(e.actor, e.actor_name)
    if (session) m.set(session.user.id, session.user.name)
    return m
  }, [audit.data, session])
  const who = (uid: ID | null | undefined) => (uid ? names.get(uid) ?? 'Name not available to you' : '—')

  if (main.error) return <ErrorBox message={main.error} retry={main.reload} />
  if (!main.data) return <Panel><Loading rows={7} label="Loading the advance" /></Panel>
  if (!a) {
    return (
      <Panel>
        <Empty icon={<HandCoins size={20} />} title="This advance is not available" body="It does not exist, or it belongs to a company or a confidentiality level that is not shared with you."
          action={<button className="btn sm" onClick={() => nav('/expenses?tab=advances')}><ArrowLeft size={13} /> Back to advances</button>} />
      </Panel>
    )
  }

  const { advances, claims } = main.data
  const money = (v: Parameters<typeof D>[0]) => fmtMoney(v, { currency: a.currency, mask: privacy })
  const person = partyName(a.recipient_party_id)
  const out = advanceOutstanding(a)
  const unreleased = D(a.approved_amount).minus(a.released_amount)
  const overdue = isOverdue(a, asOf)
  const facts = advanceMemory(advances, claims, a.recipient_party_id, asOf, a.id)
  const previous = facts.find((f) => f.advance_id)?.advance_id
  const earlier = facts.filter((f) => f.advance_id).map((f) => advances.find((x) => x.id === f.advance_id)?.advance_no).filter(Boolean) as string[]
  const prominent = ['requested', 'approved', 'partially_released'].includes(a.status)
  const settlements = claims.filter((c) => c.advance_id === a.id)
  const live = !['draft', 'rejected', 'cancelled'].includes(a.status)

  const mayApprove = can('expense.approve', a.company_id)
  const mayPay = can('payment.create', a.company_id)
  const mayClaim = can('expense.create', a.company_id)
  const maySubmit = a.created_by === session?.user.id || mayApprove
  const whyNot = (ok: boolean, yes: string, no: string) => (ok ? yes : no)

  const sentence = (() => {
    if (a.status === 'draft') return `${money(a.requested_amount)} is requested in this draft. It has not been sent for approval. Nothing is approved and no money has been released.`
    if (a.status === 'requested') return `${money(a.requested_amount)} has been requested and awaits approval. Approval authorises the advance; it does not release money.`
    if (a.status === 'rejected') return `The request for ${money(a.requested_amount)} was rejected. No money was released.`
    if (a.status === 'cancelled') return `The request for ${money(a.requested_amount)} was cancelled. No money was released.`
    if (D(a.released_amount).lte(0)) return `${money(a.approved_amount)} is approved of the ${money(a.requested_amount)} requested. No money has been released yet: approval and release are separate events.`
    const parts = [`${money(a.released_amount)} was released.`]
    if (unreleased.gt(0)) parts.push(`${money(unreleased)} of the approved ${money(a.approved_amount)} has not been released.`)
    if (D(a.settled_amount).gt(0)) parts.push(`${money(a.settled_amount)} has been settled by approved claims.`)
    if (D(a.returned_amount).gt(0)) parts.push(`${money(a.returned_amount)} has been returned.`)
    if (out.gt(0)) parts.push(a.settlement_closed ? `${money(out)} is to be returned.` : `${money(out)} is still held by ${person}. It is not an expense until an approved claim settles it.`)
    else parts.push('Nothing remains unsettled.')
    return parts.join(' ')
  })()

  const openApprove = () => { setApproved(String(D(a.requested_amount))); setComment(''); setDialog('approve') }
  const approveProblem = D(approved).lte(0) ? 'Enter the amount approved.' : D(approved).gt(a.requested_amount) ? `The approved amount cannot exceed the requested ${money(a.requested_amount)}.` : null
  const approve = async () => {
    const res = await act(() => api.approveAdvance(a.id, D(approved).toDecimalPlaces(2).toString(), comment.trim() || undefined),
      (r) => (r === 'approved' ? 'Advance approved. No money has been released.' : 'Your approval is recorded. The advance waits for the next approver.'))
    if (res) setDialog(null)
  }
  const confirmNote = async () => {
    if (!noteFor) return
    const flag = noteFor === 'hold' ? 'under_review' : noteFor === 'clear' ? null : noteFor
    const ok = await act(async () => { await api.flagAdvance(a.id, flag, note.trim()); return true }, NOTE_TEXT[noteFor].done)
    if (ok) setNoteFor(null)
  }
  const openTask = (kind: TaskForm['kind']) => setTask(kind === 'evidence'
    ? { kind, title: `Provide receipts for advance ${earlier.length ? earlier.join(', ') : a.advance_no}`, detail: `${person} is asked to submit a settlement claim with receipts${earlier.length ? ` for the earlier advance${earlier.length === 1 ? '' : 's'} ${earlier.join(', ')}` : ` for advance ${a.advance_no}`}. Raised while reviewing ${a.advance_no} (${a.purpose}).`, due_date: addDays(asOf, 7), owner_name: '', priority: 'normal' }
    : { kind, title: `Review advance ${a.advance_no} for ${person} before it proceeds`, detail: `Escalated for a decision. ${facts.filter((f) => !plain(f)).map((f) => f.text).join(' ')}`.trim(), due_date: addDays(asOf, 3), owner_name: '', priority: 'high' })
  const saveTask = async () => {
    if (!task) return
    const tid = await act(() => api.saveTask({ company_id: a.company_id, entity: 'advances', entity_id: a.id, title: task.title.trim(), detail: task.detail.trim() || null, due_date: task.due_date || null, owner_name: task.owner_name.trim() || null, priority: task.priority }),
      task.kind === 'evidence' ? 'Request for evidence recorded as a task' : 'Escalation recorded as a high-priority task')
    if (tid) setTask(null)
  }

  const memory = (
    <Panel lit={false} attention={prominent && facts.some((f) => !plain(f))} className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">What is already on record for this person</div>
        {prominent && <span className="chip cyan">shown before approval and release</span>}
      </div>
      <div className="space-y-2">
        {facts.map((f, i) => (
          <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
            <span className={cx('mt-[2px] flex-none', plain(f) ? 'text-muted' : 'text-warn')}>{plain(f) ? <Info size={14} /> : <AlertTriangle size={14} />}</span>
            <span className="min-w-0 flex-1 text-ink2">{f.text}</span>
            {f.advance_id && <button className="btn ghost icon sm" aria-label="Open this earlier advance" title="Open this earlier advance" onClick={() => nav('/expenses/advances/' + f.advance_id)}><ArrowUpRight size={13} /></button>}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11.5px] text-muted">Facts from the records of {person}, for the approver's review. They do not block this advance and they state no conclusion.</div>
      {(prominent || previous) && (
        <div className="no-print mt-3 flex flex-wrap gap-2">
          {previous && <button className="btn sm" onClick={() => nav('/expenses/advances/' + previous)}><FileSearch size={13} /> View previous advance</button>}
          {prominent && <>
            <button className="btn sm" disabled={busy} title="Create a task asking for receipts or a settlement claim" onClick={() => openTask('evidence')}><Receipt size={13} /> Request evidence</button>
            <button className="btn sm" disabled={busy || !mayApprove || a.review_flag === 'under_review'} title={!mayApprove ? 'You are not authorised to change the review status of an advance' : a.review_flag === 'under_review' ? 'This advance is already under review' : 'Mark the advance as under review'} onClick={() => setNoteFor('hold')}><CirclePause size={13} /> Hold</button>
            <button className="btn sm" disabled={busy} title="Create a high-priority task for a senior decision" onClick={() => openTask('escalate')}><ShieldQuestion size={13} /> Escalate</button>
            {a.status === 'requested' && <button className="btn sm good" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Continue to the approval of this advance', 'You are not authorised to approve advances')} onClick={openApprove}><BadgeCheck size={13} /> Continue approval</button>}
          </>}
        </div>
      )}
    </Panel>
  )

  const history = (audit.data ?? []).filter((e) => e.action !== 'update')

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Flow · Advance 360°"
        title={a.advance_no}
        subtitle={<><button className="link" onClick={() => nav('/parties/' + a.recipient_party_id)}>{person}</button> · {companyName(a.company_id)} · {a.purpose}</>}
        actions={<>
          <button className="btn ghost" onClick={() => nav('/expenses?tab=advances')}><ArrowLeft size={15} /> Back</button>
          {a.status === 'draft' && <button className="btn primary" disabled={busy || !maySubmit} title={whyNot(maySubmit, 'Send the request to the approver', 'Only the person who prepared the request or an authorised approver can send it')}
            onClick={() => void act(async () => { await api.submitAdvance(a.id); return true }, 'Advance sent for approval')}>{busy ? <Spinner /> : <Send size={15} />} Request approval</button>}
          {a.status === 'requested' && <button className="btn danger" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Reject the request with a reason', 'You are not authorised to decide advances')} onClick={() => setDialog('reject')}><XCircle size={15} /> Reject</button>}
          {a.status === 'requested' && <button className="btn good" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Approval authorises the advance. It does not release money.', 'You are not authorised to approve advances')} onClick={openApprove}><BadgeCheck size={15} /> Approve</button>}
          {(a.status === 'approved' || a.status === 'partially_released') && <button className="btn primary" disabled={busy || !mayPay || unreleased.lte(0)} title={!mayPay ? 'You are not authorised to record payments' : unreleased.lte(0) ? 'The approved amount has been released in full' : 'Record that money was handed over'} onClick={() => setDialog('release')}><Banknote size={15} /> Record release</button>}
          {out.gt(0) && <button className="btn" disabled={busy || !mayClaim} title={whyNot(mayClaim, 'Enter the expenses paid from this advance, with receipts', 'You are not authorised to create expense claims')} onClick={() => nav(`/expenses/claims/new?advance=${a.id}&party=${a.recipient_party_id}&company=${a.company_id}`)}><Receipt size={15} /> Settle with a claim</button>}
          {out.gt(0) && <button className="btn" disabled={busy || !mayPay} title={whyNot(mayPay, 'Record that unused money was handed back', 'You are not authorised to record receipts')} onClick={() => setDialog('return')}><Undo2 size={15} /> Record return of unused money</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={a.status} label={upper(a.status)} />
        {a.review_flag && a.status !== a.review_flag && <StatusChip status={a.review_flag} label={`${upper(a.review_flag)} — review status`} />}
        {overdue && a.expected_settlement_date && <span className="chip neg" title={`Settlement was expected by ${fmtDate(a.expected_settlement_date)}`}>OVERDUE {daysBetween(a.expected_settlement_date, asOf)} day{daysBetween(a.expected_settlement_date, asOf) === 1 ? '' : 's'}</span>}
        {a.settlement_closed && out.gt(0) && a.status !== 'return_due' && <span className="chip warn">final settlement recorded</span>}
        {a.approved_at && <span className="chip">Approved {fmtDateTime(a.approved_at)}</span>}
        <ApprovalTrail companyId={a.company_id} entity="advance" entityId={a.id} />
      </div>

      <div className="stagger mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Requested" value={a.requested_amount} currency={a.currency} />
        <Stat label="Approved" value={a.approved_amount} currency={a.currency} sub="authorised, not yet money" />
        <Stat label="Released" value={a.released_amount} currency={a.currency} tone={D(a.released_amount).gt(0) ? 'cyan' : undefined} sub={a.released_on ? `first on ${fmtDate(a.released_on)}` : 'nothing handed over'} />
        <Stat label="Settled" value={a.settled_amount} currency={a.currency} tone={D(a.settled_amount).gt(0) ? 'pos' : undefined} sub="through approved claims" />
        <Stat label="Returned" value={a.returned_amount} currency={a.currency} sub="unused money handed back" />
        <Stat label="Unsettled" value={out.toString()} currency={a.currency} tone={out.gt(0) ? (overdue ? 'neg' : 'warn') : undefined} sub={out.gt(0) ? `held for ${advanceAge(a, asOf)} day${advanceAge(a, asOf) === 1 ? '' : 's'}` : 'nothing held'} />
      </div>
      <Note className="mb-4" kind={out.gt(0) && (overdue || a.settlement_closed) ? 'warn' : 'info'}>{sentence}</Note>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          {prominent && memory}

          <Panel className="p-5" lit={false}>
            <div className="eyebrow mb-3">Facts</div>
            <div className="grid gap-x-6 gap-y-3 text-[13px] md:grid-cols-2">
              <Fact label="Purpose" value={a.purpose} />
              <Fact label="Recipient type" value={a.recipient_type.replace(/_/g, ' ')} />
              <Fact label="Department" value={unitName(a.dims.department)} />
              <Fact label="Project" value={unitName(a.dims.project)} />
              <Fact label="Linked record" value={!a.register_item_id ? 'None' : item.loading ? 'Loading…' : item.data ? `${item.data.ref_no} · ${item.data.title}` : 'Linked record not shared with you'} />
              <Fact label="Expected settlement date" value={<span className={cx(overdue && 'text-neg')}>{fmtDate(a.expected_settlement_date)}</span>} />
              <Fact label="Released on" value={fmtDate(a.released_on)} />
              <Fact label="Payment method" value={a.payment_method || '—'} />
              <Fact label="Requested by" value={<>{who(a.created_by)} <span className="text-muted">· {fmtDateTime(a.created_at)}</span></>} />
              <Fact label="Approved by" value={a.approved_by ? <>{who(a.approved_by)} <span className="text-muted">· {fmtDateTime(a.approved_at)}</span></> : '—'} />
              <Fact label="Last follow-up" value={fmtDate(a.last_follow_up)} />
              <Fact label="Notes" value={a.notes || '—'} />
            </div>
          </Panel>

          <Section title="Settlement claims">
            <Panel lit={false} className="overflow-hidden">
              {settlements.length === 0 ? (
                <Empty icon={<Receipt size={20} />} title="No settlement claim yet"
                  body={out.gt(0) ? 'No claim has been entered against this advance. The money held becomes an expense only through an approved claim supported by receipts.' : 'No claim has been entered against this advance.'}
                  action={out.gt(0) && mayClaim ? <button className="btn sm primary" onClick={() => nav(`/expenses/claims/new?advance=${a.id}&party=${a.recipient_party_id}&company=${a.company_id}`)}><Receipt size={13} /> Settle with a claim</button> : undefined} />
              ) : (
                <div className="overflow-auto">
                  <table className="table dense">
                    <thead><tr><th>Claim no</th><th>Title</th><th className="r">Approved</th><th className="r">Applied to advance</th><th>Status</th></tr></thead>
                    <tbody>
                      {settlements.map((c) => {
                        const decided = ['approved', 'posted', 'paid'].includes(c.status)
                        const s = c.status === 'approved' && !c.journal_id ? { label: 'APPROVED — entry to be issued again', tone: 'warn' } : CLAIM_LABEL[c.status]
                        return (
                          <tr key={c.id} className="rowlink" tabIndex={0} onClick={() => nav('/expenses/claims/' + c.id)} onKeyDown={(e) => { if (e.key === 'Enter') nav('/expenses/claims/' + c.id) }}>
                            <td className="num text-[12.5px] text-gold">{c.claim_no}</td>
                            <td className="text-ink2">{c.title}</td>
                            <td className="r">{decided ? <Money value={c.approved_total} currency={c.currency} /> : <span className="text-muted">—</span>}</td>
                            <td className="r">{decided && c.journal_id ? <Money value={c.advance_applied} currency={c.currency} /> : <span className="text-muted">—</span>}</td>
                            <td><span className={cx('chip', s.tone)}>{s.label}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">The amount applied counts as settled once the accounting entry of the claim has been approved and posted.</div>
          </Section>

          <Section title="Follow-up tasks">
            <Panel lit={false} className="p-1.5">
              {tasks.error ? <div className="px-3 py-3 text-[12.5px] text-neg">{tasks.error}</div>
                : tasks.loading && !tasks.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Loading…</div>
                : !tasks.data?.length ? <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><ListChecks size={14} /> No task is recorded for this advance.</div>
                : tasks.data.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 rounded-lg px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] text-ink">{t.title}</span>
                      {t.detail && <span className="block text-[11.5px] text-muted">{t.detail}</span>}
                      <span className="block text-[11.5px] text-muted">{t.owner_name ? `Owner ${t.owner_name} · ` : ''}{t.due_date ? `due ${fmtDate(t.due_date)} · ` : ''}raised {fmtDateTime(t.created_at)}{t.outcome ? ` · outcome: ${t.outcome}` : ''}</span>
                    </span>
                    {(t.priority === 'high' || t.priority === 'critical') && <span className="chip neg">{t.priority} priority</span>}
                    <StatusChip status={t.status} />
                  </div>
                ))}
            </Panel>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          {(live || a.status === 'draft') && (
            <Section title="Review and follow-up">
              <Panel lit={false} className="p-4">
                <div className="no-print flex flex-wrap gap-2">
                  {live && a.review_flag !== 'disputed' && <button className="btn sm" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Record that the amount or its use is disputed', 'You are not authorised to change the review status of an advance')} onClick={() => setNoteFor('disputed')}><AlertTriangle size={13} /> Mark disputed</button>}
                  {live && a.review_flag !== 'under_review' && <button className="btn sm" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Record that this advance is being examined', 'You are not authorised to change the review status of an advance')} onClick={() => setNoteFor('under_review')}><FileSearch size={13} /> Mark under review</button>}
                  {a.review_flag && <button className="btn sm" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Remove the review status with a note', 'You are not authorised to change the review status of an advance')} onClick={() => setNoteFor('clear')}><BadgeCheck size={13} /> Clear review status</button>}
                  {out.gt(0) && <button className="btn sm" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Record that the person was reminded or contacted', 'You are not authorised to record a follow-up on this advance')} onClick={() => setNoteFor('follow_up')}><BellRing size={13} /> Record follow-up</button>}
                  {D(a.released_amount).lte(0) && ['draft', 'requested', 'approved'].includes(a.status) && <button className="btn sm danger" disabled={busy || !mayApprove} title={whyNot(mayApprove, 'Withdraw this advance. Possible only while no money has been released.', 'You are not authorised to cancel an advance')} onClick={() => setDialog('cancel')}><Ban size={13} /> Cancel</button>}
                </div>
                <div className="mt-3 text-[11.5px] leading-relaxed text-muted">A review status is an observation for the people responsible. It changes no amount and writes nothing to the ledger. Every change asks for a note, which is kept in the audit trail.</div>
              </Panel>
            </Section>
          )}

          <ProposedEntries companyIds={[a.company_id]} sourceId={a.id} sources={['advance_release', 'advance_return']} />
          <Attachments companyId={a.company_id} entity="advances" entityId={a.id} readOnly={a.status === 'cancelled'} />
          {!prominent && <Section title="Advance memory">{memory}</Section>}

          {history.length > 0 && (
            <Section title="History">
              <Panel className="max-h-[320px] overflow-auto p-1.5" lit={false}>
                {history.map((e) => {
                  const v = (e.new_value && typeof e.new_value === 'object' ? e.new_value : {}) as Record<string, unknown>
                  const n = v.recipient_open_advances, amt = v.recipient_unsettled_amount
                  return (
                    <div key={String(e.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                      <span className="text-ink">{e.action === 'insert' ? 'created' : e.action.replace(/_/g, ' ')}</span> <span className="text-muted">· {e.actor_name ?? 'Name not available to you'} · {fmtDateTime(e.at)}</span>
                      {typeof v.approved_amount === 'string' || typeof v.approved_amount === 'number' ? <div className="text-[12px] text-ink2">Approved {money(v.approved_amount)} of {money((v.requested_amount as string | number | undefined) ?? a.requested_amount)} requested.</div> : null}
                      {(typeof n === 'number' || typeof n === 'string') && <div className="text-[12px] text-ink2">At approval, this person had {String(n)} open advance(s) totalling {money((amt as string | number | undefined) ?? 0)}.</div>}
                      {e.reason && <div className="text-[12px] text-ink2">{e.reason}</div>}
                    </div>
                  )
                })}
              </Panel>
            </Section>
          )}
        </div>
      </div>

      <Modal open={dialog === 'approve'} onClose={() => setDialog(null)} title="Approve advance" subtitle={`${a.advance_no} · ${person}`} width={560}
        footer={<>
          <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn good" disabled={busy || !!approveProblem} title={approveProblem ?? undefined} onClick={() => void approve()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Approve</button>
        </>}>
        <Note className="mb-4">Approval authorises the advance. It moves no money and writes nothing to the ledger. The release of money is recorded separately. The person who prepared the request cannot approve it.</Note>
        {facts.some((f) => !plain(f)) && (
          <div className="mb-4 rounded-xl border border-warn/30 bg-warnsoft px-3.5 py-2.5">
            <div className="eyebrow mb-1.5">What is already on record for this person</div>
            <ul className="m-0 list-disc space-y-1 pl-4 text-[12.5px] text-ink2">{facts.filter((f) => !plain(f)).map((f, i) => <li key={i}>{f.text}</li>)}</ul>
            <div className="mt-1.5 text-[11.5px] text-muted">The number and amount of this person's open advances are recorded with your decision.</div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Requested"><input className="field num" value={money(a.requested_amount)} disabled readOnly /></Field>
          <Field label={`Amount approved (${a.currency})`} hint={`Up to ${money(a.requested_amount)}`}><input className="field num" inputMode="decimal" autoFocus value={approved} onChange={(e) => setApproved(numeric(e.target.value))} /></Field>
          <Field label="Comment (optional)" className="sm:col-span-2" hint="Recorded with the decision in the audit trail."><textarea className="field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
        {approveProblem && approved !== '' && <div className="mt-3 text-[12px] text-warn">{approveProblem}</div>}
      </Modal>

      <ReasonDialog open={dialog === 'reject'} title="Reject advance" confirm="Reject advance" danger body="The request is refused. No money is released and nothing reaches the ledger."
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void act(async () => { await api.rejectAdvance(a.id, reason); return true }, 'Advance rejected').then((ok) => { if (ok) setDialog(null) })} />
      <ReasonDialog open={dialog === 'cancel'} title="Cancel advance" confirm="Cancel advance" danger body="The advance is withdrawn. This is possible only while no money has been released against it. A cancelled advance cannot be reopened."
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void act(async () => { await api.flagAdvance(a.id, 'cancelled', reason); return true }, 'Advance cancelled').then((ok) => { if (ok) setDialog(null) })} />

      <MoneyMoveDialog open={dialog === 'release'} title="Record release" subtitle={`${a.advance_no} · money handed to ${person}`} companyId={a.company_id} amount={unreleased.toString()} max={unreleased.toString()} confirm="Record release" busy={busy}
        note={`Record the release after the money has been handed to ${person}. This proposes an accounting entry — advance held by the person, not an expense — which reaches the ledger only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money.`}
        onCancel={() => setDialog(null)}
        onConfirm={(v) => void act(() => api.releaseAdvance(a.id, { amount: D(v.amount).toDecimalPlaces(2).toString(), bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method }), 'Release recorded. Its entry waits in the approval inbox.').then((j) => { if (j) setDialog(null) })} />
      <MoneyMoveDialog open={dialog === 'return'} title="Record return of unused money" subtitle={`${a.advance_no} · money handed back by ${person}`} companyId={a.company_id} amount={out.toString()} max={out.toString()} confirm="Record return" busy={busy}
        note="Record the return after the unused money has been received. This proposes an accounting entry, which reaches the ledger only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money."
        onCancel={() => setDialog(null)}
        onConfirm={(v) => void act(() => api.returnAdvance(a.id, { amount: D(v.amount).toDecimalPlaces(2).toString(), bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method }), 'Return recorded. Its entry waits in the approval inbox.').then((j) => { if (j) setDialog(null) })} />

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor ? NOTE_TEXT[noteFor].title : ''} subtitle={`${a.advance_no} · ${person}`} width={500}
        footer={<>
          <button className="btn ghost" onClick={() => setNoteFor(null)}>Cancel</button>
          <button className="btn primary" disabled={busy || !note.trim()} onClick={() => void confirmNote()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} {noteFor ? NOTE_TEXT[noteFor].confirm : ''}</button>
        </>}>
        {noteFor && <div className="mb-4 text-[13px] text-ink2">{NOTE_TEXT[noteFor].body}</div>}
        <Field label={`${noteFor ? NOTE_TEXT[noteFor].label : 'Note'} (required — recorded in the audit trail)`}>
          <textarea className="field" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={!!task} onClose={() => setTask(null)} title={task?.kind === 'escalate' ? 'Escalate' : 'Request evidence'} subtitle={`${a.advance_no} · ${person}`} width={560}
        footer={<>
          <button className="btn ghost" onClick={() => setTask(null)}>Cancel</button>
          <button className="btn primary" disabled={busy || !task?.title.trim()} onClick={() => void saveTask()}>{busy ? <Spinner /> : <ListChecks size={15} />} Create task</button>
        </>}>
        {task && (
          <>
            <Note className="mb-4">{task.kind === 'escalate' ? 'This creates a task on this advance for a senior decision. It does not approve, reject or hold the advance.' : 'This creates a task on this advance asking for receipts or a settlement claim. NUMERO records the request; it does not send a message to the person.'}</Note>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Task" className="sm:col-span-2"><input className="field" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
              <Field label="Detail" className="sm:col-span-2"><textarea className="field" rows={3} value={task.detail} onChange={(e) => setTask({ ...task, detail: e.target.value })} /></Field>
              <Field label="Due date"><input type="date" className="field" value={task.due_date} min={asOf} onChange={(e) => setTask({ ...task, due_date: e.target.value })} /></Field>
              <Field label="Priority"><select className="field" value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value as Task['priority'] })}>{(['low', 'normal', 'high', 'critical'] as const).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
              <Field label="Owner" className="sm:col-span-2" hint="The person expected to act on the task."><input className="field" value={task.owner_name} onChange={(e) => setTask({ ...task, owner_name: e.target.value })} /></Field>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="break-words text-ink">{value}</div>
    </div>
  )
}
