import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { AlertTriangle, ArrowLeft, BadgeCheck, Ban, Banknote, Check, Plus, RefreshCw, Save, Send, Ticket, Trash2, XCircle } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { ClaimLineDecision, ExpenseClaim, ExpenseClaimInput, ExpenseClaimLine } from '@/engine/opsTypes'
import { BOOKING_PARTS, type BookingDetail, type BookingKind } from '@/engine/p3Types'
import { advanceOutstanding } from '@/engine/ops'
import { D, fmtMoney, round2, sum, ZERO } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner } from '@/ui/kit'
import { ApprovalTrail, Attachments, MoneyMoveDialog, ProposedEntries, useAccountName, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'

interface Row {
  key: number; expense_date: string; category_id: ID | ''; account_id: ID | ''; description: string; merchant: string; amount: string
  paid_by: 'claimant' | 'company'; paid_from_ledger_id: ID | ''; has_receipt: boolean; document_id: ID | null
  department: ID | ''; project: ID | ''; otherDims: Record<string, ID>; flags: string[]; edited: boolean
  /** a ticket or a stay: who carried or lodged the person, under which reference, and what the amount is made of */
  booking: Record<string, string> | null
}

// ------------------------------------------------------------------ travel bookings (spec 199-202)
type Part = typeof BOOKING_PARTS[number]
const BOOKING: Record<BookingKind, { label: string; operator: string; facts: [string, string][]; parts: Part[] }> = {
  air: { label: 'Flight', operator: 'Airline', facts: [['booking_ref', 'Booking reference (PNR)'], ['origin', 'From'], ['destination', 'To'], ['class', 'Class'], ['travel_date', 'Date of travel'], ['agent', 'Booked through']], parts: ['base_fare', 'taxes', 'booking_charges', 'baggage', 'seat', 'change_fee', 'cancellation_fee'] },
  train: { label: 'Train', operator: 'Train', facts: [['booking_ref', 'Booking reference (PNR)'], ['origin', 'From'], ['destination', 'To'], ['class', 'Class'], ['travel_date', 'Date of travel'], ['agent', 'Booked through']], parts: ['base_fare', 'taxes', 'booking_charges', 'meals', 'cancellation_fee'] },
  bus: { label: 'Bus', operator: 'Operator', facts: [['booking_ref', 'Booking reference'], ['origin', 'From'], ['destination', 'To'], ['class', 'Class'], ['travel_date', 'Date of travel'], ['agent', 'Booked through']], parts: ['base_fare', 'taxes', 'booking_charges', 'cancellation_fee'] },
  cab: { label: 'Cab or taxi', operator: 'Operator or driver', facts: [['booking_ref', 'Trip reference'], ['origin', 'From'], ['destination', 'To'], ['travel_date', 'Date'], ['purpose', 'Purpose']], parts: ['base_fare', 'taxes', 'toll', 'parking', 'tip', 'other_charges'] },
  hotel: { label: 'Hotel stay', operator: 'Hotel', facts: [['booking_ref', 'Booking reference'], ['city', 'City'], ['check_in', 'Check-in'], ['check_out', 'Check-out'], ['agent', 'Booked through'], ['purpose', 'Purpose']], parts: ['room_charges', 'taxes', 'meals', 'laundry', 'other_charges'] },
}
const DATES = ['travel_date', 'check_in', 'check_out']
const partLabel = (p: string) => p.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())
const partsOf = (b: Record<string, string> | null) => (b ? BOOKING_PARTS.filter((p) => (b[p] ?? '').trim() !== '') : [])
const partsTotal = (b: Record<string, string> | null) => sum(partsOf(b).map((p) => b![p]))
/** what is kept: the fields that were filled in, amounts rounded to the paisa */
const bookingOut = (b: Record<string, string> | null): BookingDetail | undefined => {
  if (!b || !b.kind) return undefined
  const out: Record<string, string> = { kind: b.kind }
  for (const [k, v] of Object.entries(b)) if (k !== 'kind' && (v ?? '').trim() !== '') out[k] = (BOOKING_PARTS as readonly string[]).includes(k) ? round2(v).toString() : v.trim()
  return out as unknown as BookingDetail
}
const bookingIn = (d: ExpenseClaimLine['detail']): Record<string, string> | null => {
  const x = (d ?? {}) as Record<string, unknown>
  return x.kind ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])) : null
}
function BookingFacts({ detail, currency }: { detail: ExpenseClaimLine['detail']; currency: string }) {
  const b = bookingIn(detail)
  if (!b) return null
  const kind = BOOKING[b.kind as BookingKind]
  if (!kind) return null
  const facts = [b.operator && `${kind.operator}: ${b.operator}`, ...kind.facts.map(([k, label]) => b[k] && `${label}: ${DATES.includes(k) ? fmtDate(b[k]) : b[k]}`)].filter(Boolean) as string[]
  const parts = partsOf(b)
  return (
    <span className="mt-1 block text-[11.5px] text-muted">
      <span className="chip mr-1.5"><Ticket size={11} /> {kind.label}</span>{facts.join(' · ')}
      {parts.length > 0 && <span className="block">Made of: {parts.map((p) => `${partLabel(p).toLowerCase()} ${fmtMoney(b[p], { currency })}`).join(' + ')}</span>}
    </span>
  )
}
let k = 0
const blank = (): Row => ({ key: ++k, expense_date: today(), category_id: '', account_id: '', description: '', merchant: '', amount: '', paid_by: 'claimant', paid_from_ledger_id: '', has_receipt: false, document_id: null, department: '', project: '', otherDims: {}, flags: [], edited: false, booking: null })
const fromLine = (l: ExpenseClaimLine): Row => {
  const { department, project, ...otherDims } = l.dims ?? {}
  return { key: ++k, expense_date: l.expense_date, category_id: l.category_id ?? '', account_id: l.account_id, description: l.description, merchant: l.merchant ?? '', amount: String(D(l.amount)), paid_by: l.paid_by, paid_from_ledger_id: l.paid_from_ledger_id ?? '', has_receipt: l.has_receipt, document_id: l.document_id, department: department ?? '', project: project ?? '', otherDims, flags: l.flags ?? [], edited: false, booking: bookingIn(l.detail) }
}

const STATUS: Record<ExpenseClaim['status'], { label: string; tone: string }> = {
  draft: { label: 'DRAFT', tone: '' },
  submitted: { label: 'CLAIM PENDING', tone: 'warn' },
  approved: { label: 'APPROVED — entry awaiting approval', tone: 'cyan' },
  posted: { label: 'PAYABLE', tone: 'gold' },
  paid: { label: 'SETTLED', tone: 'pos' },
  rejected: { label: 'REJECTED', tone: 'neg' },
  cancelled: { label: 'CANCELLED', tone: '' },
}
const STAGES: { key: string; label: string; text: string }[] = [
  { key: 'pending', label: 'CLAIM PENDING', text: 'Submitted. The claim and then its accounting entry are approved. Nothing is in the ledger yet.' },
  { key: 'payable', label: 'PAYABLE', text: 'The expense is in the ledger. The reimbursement is owed to the person.' },
  { key: 'settled', label: 'SETTLED', text: 'Nothing further is owed on this claim.' },
]
const numeric = (s: string) => s.replace(/[^\d.]/g, '')

export default function ClaimEditor() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const session = useApp((s) => s.session)
  const privacy = useApp((s) => s.privacy)
  const ids = useScopeIds()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const unitName = useUnitName()
  const accountName = useAccountName()
  const { act, busy } = useAction()

  const [companyId, setCompanyId] = useState<ID>(sp.get('company') ?? ids[0] ?? '')
  const [partyId, setPartyId] = useState<ID | ''>(sp.get('party') ?? '')
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [advanceId, setAdvanceId] = useState<ID | ''>(sp.get('advance') ?? '')
  const [finalSettlement, setFinalSettlement] = useState(false)
  const [registerItemId, setRegisterItemId] = useState<ID | ''>('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const loadedFor = useRef<string | null>(id ? null : 'new')

  const [approving, setApproving] = useState(false)
  const [decisions, setDecisions] = useState<Record<ID, { amount: string; note: string }>>({})
  const [comment, setComment] = useState('')
  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'pay' | null>(null)

  const claim = useAsync(async () => (id ? api.getClaim(id) : null), [api, id])
  const d = id && claim.data && claim.data.id === id ? claim.data : undefined

  const load = (c: ExpenseClaim) => {
    setCompanyId(c.company_id); setPartyId(c.claimant_party_id); setTitle(c.title); setPurpose(c.purpose ?? ''); setAdvanceId(c.advance_id ?? ''); setFinalSettlement(c.final_settlement)
    setRegisterItemId(c.register_item_id ?? ''); setNotes(c.notes ?? '')
    const lines = (c.lines ?? []).map(fromLine)
    setRows(lines.length ? lines : [blank()])
  }
  useEffect(() => {
    if (!id) {
      if (loadedFor.current !== 'new') {
        loadedFor.current = 'new'
        setCompanyId(sp.get('company') ?? ids[0] ?? ''); setPartyId(sp.get('party') ?? ''); setTitle(''); setPurpose(''); setAdvanceId(sp.get('advance') ?? ''); setFinalSettlement(false); setRegisterItemId(''); setNotes(''); setRows([blank()])
      }
      return
    }
    if (d && loadedFor.current !== id) { loadedFor.current = id; load(d) }
  }, [id, d]) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useAsync(async () => (companyId ? api.listExpenseCategories([companyId]) : []), [api, companyId])
  const openAdvances = useAsync(async () => (companyId && partyId ? api.listAdvances({ companyIds: [companyId], partyId }) : []), [api, companyId, partyId])
  const items = useAsync(async () => (companyId ? api.listRegisterItems({ companyIds: [companyId] }) : []), [api, companyId])
  const audit = useAsync(async () => (id ? api.listAudit({ entity: 'expense_claims', entityId: id, limit: 50 }) : []), [api, id])

  const company = companies.find((c) => c.id === companyId)
  const currency = d?.currency ?? company?.base_currency ?? 'INR'
  const party = parties.find((p) => p.id === partyId)
  const money = (v: Decimal.Value) => fmtMoney(v, { currency, mask: privacy })

  const editable = !id || (!!d && (d.status === 'draft' || d.status === 'rejected'))
  const mine = !d || d.created_by === session?.user.id
  const mayEdit = can('expense.create', companyId || undefined) && (mine || can('expense.approve', companyId || undefined))
  const mayApprove = can('expense.approve', companyId || undefined)
  const mayPay = can('payment.create', companyId || undefined)

  const pts = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === companyId) || p.id === partyId).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, companyId, partyId])
  const people = pts.filter((p) => p.kind === 'person'), organisations = pts.filter((p) => p.kind !== 'person')
  const expenseLedgers = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active && a.type === 'expense').sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId])
  const paidFrom = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active && (a.control_type === 'bank' || a.control_type === 'cash' || a.subtype === 'payable' || a.subtype === 'other_liability')).sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId])
  const units = (type: string) => orgUnits.filter((u) => u.company_id === companyId && u.type_key === type && u.status === 'active').sort((a, b) => a.name.localeCompare(b.name))
  const departments = units('department'), projects = units('project')
  const cats = categories.data ?? []
  const advanceChoices = (openAdvances.data ?? []).filter((a) => advanceOutstanding(a).gt(0) || a.id === advanceId)
  const advance = (openAdvances.data ?? []).find((a) => a.id === advanceId)
  // any register item that tracks its own cost can be named: its tag is what the accounting entry carries
  const linkable = (items.data ?? []).filter((i) => (!!i.org_unit_id && !['cancelled', 'closed', 'ended'].includes(i.status)) || i.id === registerItemId)
  const linked = (items.data ?? []).find((i) => i.id === (d?.register_item_id ?? registerItemId))

  // ---------------------------------------------------------------- editing
  const total = sum(rows.map((r) => r.amount))
  const byPerson = sum(rows.filter((r) => r.paid_by === 'claimant').map((r) => r.amount))
  const byCompany = total.minus(byPerson)
  const held = advance ? Decimal.max(advanceOutstanding(advance), 0) : ZERO
  const applied = advance ? Decimal.min(byPerson, held) : ZERO
  const reimbursement = byPerson.minus(applied)
  const left = held.minus(applied)

  const problems: string[] = []
  if (!companyId) problems.push('Choose the company.')
  if (!partyId) problems.push('Choose the person who incurred the expense.')
  if (!title.trim()) problems.push('Give the claim a title.')
  rows.forEach((r, i) => {
    const no = i + 1
    if (!r.expense_date) problems.push(`Line ${no}: enter the date of the expense.`)
    else if (r.expense_date > today()) problems.push(`Line ${no}: the date is in the future.`)
    if (!r.category_id && !r.account_id) problems.push(`Line ${no}: choose a category or a ledger.`)
    if (!r.description.trim()) problems.push(`Line ${no}: describe the expense.`)
    if (D(r.amount).lte(0)) problems.push(`Line ${no}: enter the amount.`)
    if (r.paid_by === 'company' && !r.paid_from_ledger_id) problems.push(`Line ${no}: the company paid — choose the card, cash or bank ledger it was paid from.`)
    if (r.booking && partsOf(r.booking).length && !partsTotal(r.booking).eq(round2(r.amount || 0))) problems.push(`Line ${no}: the parts of the booking add up to ${partsTotal(r.booking).toFixed(2)} and the line is ${round2(r.amount || 0).toFixed(2)}. They must agree.`)
    if (r.booking?.kind === 'hotel' && r.booking.check_in && r.booking.check_out && r.booking.check_out < r.booking.check_in) problems.push(`Line ${no}: the stay ends before it begins.`)
  })
  const touched = Boolean(title || partyId) && rows.some((r) => r.description || r.amount)

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, edited: true } : r)))
  const payload = (): ExpenseClaimInput => ({
    id, company_id: companyId, claimant_party_id: partyId as ID, title: title.trim(), purpose: purpose.trim() || null, advance_id: advanceId || null, final_settlement: advanceId ? finalSettlement : false,
    register_item_id: registerItemId || null, currency: d?.currency ?? company?.base_currency, notes: notes.trim() || null,
    lines: rows.map((r) => {
      const dims: Record<string, ID> = { ...r.otherDims }
      if (r.department) dims.department = r.department
      if (r.project) dims.project = r.project
      return {
        expense_date: r.expense_date, category_id: r.category_id || null, account_id: r.account_id || null, description: r.description.trim(), merchant: r.merchant.trim() || null, amount: round2(r.amount).toString(),
        paid_by: r.paid_by, paid_from_ledger_id: r.paid_by === 'company' ? r.paid_from_ledger_id || null : null, has_receipt: r.has_receipt, document_id: r.document_id, dims, detail: bookingOut(r.booking),
      }
    }),
  })
  /** Saves the draft and shows the flags the engine has just computed. */
  const save = async (message?: string): Promise<ID | undefined> => {
    const fresh = await act(async () => api.getClaim(await api.saveClaim(payload())), message)
    if (!fresh) return undefined
    loadedFor.current = fresh.id
    load(fresh)
    if (!id) nav('/expenses/claims/' + fresh.id, { replace: true })
    return fresh.id
  }
  const submit = async () => {
    const cid = await save()
    if (cid) await act(async () => { await api.submitClaim(cid); return true }, 'Claim submitted for approval')
  }

  // ---------------------------------------------------------------- approval
  const lines = d?.lines ?? []
  const openApproval = () => {
    setDecisions(Object.fromEntries(lines.map((l) => [l.id, { amount: String(D(l.approved_amount)), note: l.approver_note ?? '' }])))
    setComment('')
    setApproving(true)
  }
  const dec = (l: ExpenseClaimLine) => decisions[l.id] ?? { amount: String(D(l.approved_amount)), note: l.approver_note ?? '' }
  const approvedTotal = sum(lines.map((l) => dec(l).amount))
  const flaggedApproved = lines.some((l) => l.flags.length > 0 && D(dec(l).amount).gt(0))
  const approvalProblems: string[] = []
  lines.forEach((l) => {
    const v = dec(l)
    if (v.amount.trim() === '') approvalProblems.push(`Line ${l.line_no}: enter the approved amount. Enter 0 to approve nothing on this line.`)
    else if (D(v.amount).gt(l.amount)) approvalProblems.push(`Line ${l.line_no}: the approved amount cannot exceed the claimed ${money(l.amount)}.`)
    else if (D(v.amount).lt(l.amount) && !v.note.trim()) approvalProblems.push(`Line ${l.line_no}: give the reason for approving less than was claimed.`)
  })
  if (lines.length && approvedTotal.lte(0)) approvalProblems.push('Nothing is approved on this claim. Reject it instead.')
  if (flaggedApproved && !comment.trim()) approvalProblems.push('This claim has flagged lines. Record your reason for approving them.')

  const approve = async () => {
    if (!d) return
    const changed: ClaimLineDecision[] = lines
      .filter((l) => !D(dec(l).amount).eq(l.approved_amount) || dec(l).note.trim() !== (l.approver_note ?? ''))
      .map((l) => ({ line_id: l.id, approved_amount: round2(dec(l).amount).toString(), note: dec(l).note.trim() || undefined }))
    const res = await act(() => api.approveClaim(d.id, comment.trim() || undefined, changed),
      (r) => (r === 'approved' ? 'The claim is approved. Its accounting entry now waits in the approval inbox.' : 'Your approval is recorded. The claim waits for the next approver.'))
    if (res) setApproving(false)
  }

  // ---------------------------------------------------------------- render
  if (id && claim.error) return <ErrorBox message={claim.error} retry={claim.reload} />
  if (id && !d) return <Panel><Loading rows={7} label="Loading the claim" /></Panel>

  const status = d ? (d.status === 'approved' && !d.journal_id ? { label: 'APPROVED — entry to be issued again', tone: 'warn' } : STATUS[d.status]) : null
  const stage = !d ? -1 : d.status === 'submitted' || d.status === 'approved' ? 0 : d.status === 'posted' ? 1 : d.status === 'paid' ? 2 : -1
  const decidedNow = !!d && ['approved', 'posted', 'paid'].includes(d.status)
  const showApproved = decidedNow || lines.some((l) => !D(l.approved_amount).eq(l.amount) || !!l.approver_note)
  const cancellable = !!d && (['draft', 'submitted', 'rejected'].includes(d.status) || (d.status === 'approved' && !d.journal_id))
  const mayCancel = mine || mayApprove
  const lineCols = 8 + (departments.length ? 1 : 0) + (projects.length ? 1 : 0) + 1

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Flow · Expense claim"
        title={d ? d.claim_no : 'New expense claim'}
        subtitle={d ? `${partyName(d.claimant_party_id)} · ${companyName(d.company_id)} · ${d.title}` : 'A claim lists expenses a person incurred. It is approved first; its accounting entry is approved separately; reimbursement is a further step.'}
        actions={<>
          <button className="btn ghost" onClick={() => nav('/expenses?tab=claims')}><ArrowLeft size={15} /> Back</button>
          {cancellable && <button className="btn" disabled={busy || !mayCancel} title={mayCancel ? 'Withdraw this claim' : 'Only the person who prepared the claim or an authorised approver can cancel it'} onClick={() => setDialog('cancel')}><Ban size={15} /> Cancel claim</button>}
          {editable && <button className="btn" disabled={busy || problems.length > 0 || !mayEdit} title={mayEdit ? problems[0] ?? 'Keep the claim as a draft' : 'You are not authorised to edit this claim'} onClick={() => void save('Draft saved')}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>}
          {editable && <button className="btn primary" disabled={busy || problems.length > 0 || !mayEdit} title={mayEdit ? problems[0] ?? 'Save the claim and send it to the approver' : 'You are not authorised to submit this claim'} onClick={() => void submit()}>{busy ? <Spinner /> : <Send size={15} />} Submit for approval</button>}
          {d?.status === 'submitted' && <button className="btn danger" disabled={busy || !mayApprove} title={mayApprove ? 'Reject the claim with a reason' : 'You are not authorised to decide expense claims'} onClick={() => setDialog('reject')}><XCircle size={15} /> Reject</button>}
          {d?.status === 'submitted' && <button className="btn good" disabled={busy || !mayApprove} title={mayApprove ? 'Decide each line of the claim' : 'You are not authorised to approve expense claims'} onClick={openApproval}><BadgeCheck size={15} /> Approve</button>}
          {d?.status === 'approved' && !d.journal_id && <button className="btn primary" disabled={busy || !mayApprove} title={mayApprove ? 'The earlier accounting entry was rejected. Propose it again.' : 'You are not authorised to approve expense claims'}
            onClick={() => void act(() => api.approveClaim(d.id), 'The accounting entry has been issued again. It waits in the approval inbox.')}>{busy ? <Spinner /> : <RefreshCw size={15} />} Issue the accounting entry again</button>}
          {d?.status === 'posted' && <button className="btn primary" disabled={busy || !mayPay} title={mayPay ? 'Record that the reimbursement was paid' : 'You are not authorised to record payments'} onClick={() => setDialog('pay')}><Banknote size={15} /> Record reimbursement</button>}
        </>}
      />

      {d && status && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={cx('chip', status.tone)}>{status.label}</span>
          {d.flagged_lines > 0 && <span className="chip warn"><AlertTriangle size={11} /> {d.flagged_lines} flagged line{d.flagged_lines === 1 ? '' : 's'}</span>}
          {d.approved_at && <span className="chip">Approved {fmtDateTime(d.approved_at)}</span>}
          {d.paid_on && <span className="chip">{D(d.payable).gt(0) ? 'Reimbursed' : 'Settled'} {fmtDate(d.paid_on)}</span>}
          <ApprovalTrail companyId={d.company_id} entity="expense_claim" entityId={d.id} />
        </div>
      )}

      {d && d.flagged_lines > 0 && <Note kind="warn" className="mb-4">{d.flagged_lines} line(s) are flagged. Flags inform the approver; they do not reject the claim.</Note>}
      {d?.status === 'rejected' && <Note kind="warn" className="mb-4">This claim was rejected{d.decision_note ? `: ${d.decision_note}` : '.'} Correct it and save; it returns to draft and can be submitted again.</Note>}
      {d?.status === 'cancelled' && <Note className="mb-4">This claim is cancelled{d.decision_note ? `: ${d.decision_note}` : '.'} It has no effect on the ledger.</Note>}
      {d?.status === 'approved' && d.journal_id && <Note kind="good" className="mb-4">The claim is approved. Its accounting entry now waits in the approval inbox. <button className="link" onClick={() => nav('/approvals')}>Open the approval inbox</button></Note>}
      {d?.status === 'approved' && !d.journal_id && <Note kind="warn" className="mb-4">The claim is approved, but its accounting entry was rejected in the approval inbox. Nothing has reached the ledger. Issue the entry again, or cancel the claim.</Note>}
      {d?.status === 'posted' && <Note className="mb-4">The expense is in the ledger. {money(d.payable)} is owed to {partyName(d.claimant_party_id)}. Recording the reimbursement proposes a further entry; NUMERO records that money moved, it does not move money.</Note>}
      {!editable && d && d.decision_note && ['approved', 'posted', 'paid'].includes(d.status) && <Note className="mb-4">Approver's comment: {d.decision_note}</Note>}

      {!editable && d && stage >= 0 && (
        <Panel lit={false} className="mb-4 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {STAGES.map((s, i) => {
              const done = i < stage, here = i === stage
              return (
                <div key={s.key} className={cx('rounded-xl border px-3.5 py-3', here ? 'border-gold/50 bg-surface2' : 'border-line')} aria-current={here ? 'step' : undefined}>
                  <div className="flex items-center gap-2">
                    <span className={cx('grid h-5 w-5 flex-none place-items-center rounded-full border text-[10.5px]', done ? 'border-pos/40 text-pos' : here ? 'border-gold/60 text-gold' : 'border-line text-muted')}>{done ? <Check size={11} /> : <span className="num">{i + 1}</span>}</span>
                    <span className={cx('eyebrow', here ? 'text-gold' : done ? 'text-pos' : '')}>{s.label}</span>
                    {here && <span className="chip gold">now</span>}
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-snug text-muted">{here && d.status === 'approved' ? (d.journal_id ? 'The claim is approved. Its accounting entry is awaiting approval; nothing is in the ledger yet.' : 'The claim is approved, but its accounting entry was rejected. It has to be issued again; nothing is in the ledger.') : here && d.status === 'paid' && D(d.payable).lte(0) && D(d.advance_applied).gt(0) ? 'Settled against the advance. No reimbursement was due.' : s.text}</div>
                </div>
              )
            })}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          {editable ? (
            <Panel className="p-5" lit={false}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Company">
                  <select className="field" value={companyId} disabled={Boolean(id)} onChange={(e) => { setCompanyId(e.target.value); setPartyId(''); setAdvanceId(''); setFinalSettlement(false); setRegisterItemId(''); setRows([blank()]) }}>
                    <option value="">Choose…</option>{companies.filter((c) => c.status === 'active' && (ids.includes(c.id) || c.id === companyId)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </select>
                </Field>
                <Field label="Person who incurred the expense" hint={party && party.status !== 'active' ? `${party.display_name} is ${party.status}.` : undefined}>
                  <select className="field" value={partyId} onChange={(e) => { setPartyId(e.target.value); setAdvanceId(''); setFinalSettlement(false) }}>
                    <option value="">Choose…</option>
                    {people.length > 0 && <optgroup label="People">{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</optgroup>}
                    {organisations.length > 0 && <optgroup label="Organisations">{organisations.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</optgroup>}
                  </select>
                </Field>
                <Field label="Title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Client visit, Pune, 12–14 March" /></Field>
                <Field label="Purpose"><input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="The business reason for the expenses" /></Field>
                <Field label="Advance being settled" hint={!partyId ? 'Choose the person first.' : openAdvances.loading ? 'Loading…' : advanceChoices.length ? 'Approved expenses the person paid are set against this advance before any reimbursement.' : 'This person holds no unsettled advance in this company.'}>
                  <select className="field" value={advanceId} disabled={!partyId} onChange={(e) => { setAdvanceId(e.target.value); if (!e.target.value) setFinalSettlement(false) }}>
                    <option value="">None — the person is to be reimbursed</option>
                    {advanceChoices.map((a) => <option key={a.id} value={a.id}>{a.advance_no} · {a.purpose} · unsettled {fmtMoney(advanceOutstanding(a), { currency: a.currency, mask: privacy })}</option>)}
                  </select>
                </Field>
                <Field label="Linked record" hint={items.loading ? 'Loading…' : linkable.length ? undefined : 'No record that tracks its own cost (a trip, event, vehicle, property, incident, work order or path) is kept for this company.'}>
                  <select className="field" value={registerItemId} onChange={(e) => setRegisterItemId(e.target.value)}><option value="">None</option>{linkable.map((i) => <option key={i.id} value={i.id}>{i.ref_no} · {i.title}</option>)}</select>
                </Field>
                {advanceId && (
                  <label className="flex items-start gap-2.5 text-[13px] text-ink2 md:col-span-2">
                    <input type="checkbox" className="mt-[3px]" checked={finalSettlement} onChange={(e) => setFinalSettlement(e.target.checked)} />
                    <span>This is the final settlement of the advance<span className="block text-[11.5px] text-muted">Any balance left after this claim becomes RETURN DUE.</span></span>
                  </label>
                )}
                <Field label="Notes" className="md:col-span-2"><textarea className="field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              </div>
            </Panel>
          ) : d && (
            <Panel className="p-5" lit={false}>
              <div className="grid gap-x-6 gap-y-3 text-[13px] md:grid-cols-2">
                <Fact label="Company" value={companyName(d.company_id)} />
                <Fact label="Person who incurred the expense" value={<button className="link text-left" onClick={() => nav('/parties/' + d.claimant_party_id)}>{partyName(d.claimant_party_id)}</button>} />
                <Fact label="Title" value={d.title} />
                <Fact label="Purpose" value={d.purpose || '—'} />
                <Fact label="Advance being settled" value={d.advance_id ? <button className="link text-left" onClick={() => nav('/expenses/advances/' + d.advance_id)}>{advance?.advance_no ?? 'Open the advance'}{d.final_settlement ? ' · final settlement' : ''}</button> : 'None'} />
                <Fact label="Linked record" value={d.register_item_id ? (linked ? `${linked.ref_no} · ${linked.title}` : 'Linked record not shared with you') : 'None'} />
                <Fact label="Created" value={fmtDateTime(d.created_at)} />
                <Fact label="Notes" value={d.notes || '—'} />
              </div>
            </Panel>
          )}

          <Panel lit={false} className="overflow-hidden">
            <div className="overflow-auto">
              {editable ? (
                <table className="table dense" style={{ minWidth: 1180 }}>
                  <thead><tr>
                    <th style={{ width: 34 }}>#</th><th style={{ width: 140 }}>Date</th><th style={{ minWidth: 150 }}>Category</th><th style={{ minWidth: 180 }}>Ledger</th><th style={{ minWidth: 190 }}>Description</th><th style={{ minWidth: 130 }}>Merchant</th>
                    <th className="r" style={{ width: 120 }}>Amount</th><th style={{ minWidth: 170 }}>Paid by</th><th style={{ width: 84 }}>Receipt</th>
                    {departments.length > 0 && <th style={{ minWidth: 130 }}>Department</th>}{projects.length > 0 && <th style={{ minWidth: 130 }}>Project</th>}<th style={{ width: 40 }} />
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const cat = cats.find((c) => c.id === r.category_id)
                      const hints = cat ? [
                        cat.guidance,
                        cat.limit_per_item != null && `Limit per item ${fmtMoney(cat.limit_per_item, { currency })}`,
                        cat.limit_per_day != null && `Limit per day ${fmtMoney(cat.limit_per_day, { currency })}`,
                        cat.receipt_required_above != null ? `Receipt expected above ${fmtMoney(cat.receipt_required_above, { currency })}` : 'Receipt expected for every expense',
                        cat.max_age_days != null && `Claim within ${cat.max_age_days} days`,
                      ].filter(Boolean) as string[] : []
                      return (
                        <Fragment key={r.key}>
                          <tr>
                            <td className="num text-muted">{i + 1}</td>
                            <td><input type="date" className="field sm" value={r.expense_date} max={today()} onChange={(e) => set(r.key, { expense_date: e.target.value })} aria-label={`Line ${i + 1} date`} /></td>
                            <td>
                              <select className="field sm" value={r.category_id} aria-label={`Line ${i + 1} category`} onChange={(e) => { const c = cats.find((x) => x.id === e.target.value); set(r.key, { category_id: e.target.value, account_id: c ? c.account_id : r.account_id }) }}>
                                <option value="">No category</option>{cats.filter((c) => c.is_active || c.id === r.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </td>
                            <td>
                              <select className="field sm" value={r.account_id} aria-label={`Line ${i + 1} ledger`} onChange={(e) => set(r.key, { account_id: e.target.value })}>
                                <option value="">Choose…</option>
                                {r.account_id && !expenseLedgers.some((a) => a.id === r.account_id) && <option value={r.account_id}>{accountName(r.account_id)}</option>}
                                {expenseLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                              </select>
                            </td>
                            <td>
                              <div className="flex items-center gap-1">
                                <input className="field sm" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                                <button className={cx('btn icon sm', r.booking ? 'primary' : 'ghost')} aria-pressed={!!r.booking} aria-label={`Line ${i + 1}: ${r.booking ? 'remove the booking details' : 'add the details of a ticket or a stay'}`}
                                  title={r.booking ? 'Remove the booking details' : 'Add the details of a ticket or a hotel stay'} onClick={() => set(r.key, { booking: r.booking ? null : { kind: 'air' } })}><Ticket size={13} /></button>
                              </div>
                            </td>
                            <td><input className="field sm" value={r.merchant} onChange={(e) => set(r.key, { merchant: e.target.value })} aria-label={`Line ${i + 1} merchant`} /></td>
                            <td><input className="field sm num text-right" inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: numeric(e.target.value) })} aria-label={`Line ${i + 1} amount`} /></td>
                            <td>
                              <select className="field sm" value={r.paid_by} aria-label={`Line ${i + 1} paid by`} onChange={(e) => set(r.key, { paid_by: e.target.value as Row['paid_by'], paid_from_ledger_id: e.target.value === 'company' ? r.paid_from_ledger_id : '' })}>
                                <option value="claimant">The person</option><option value="company">The company</option>
                              </select>
                              {r.paid_by === 'company' && (
                                <select className="field sm mt-1" value={r.paid_from_ledger_id} aria-label={`Line ${i + 1} ledger the company paid from`} onChange={(e) => set(r.key, { paid_from_ledger_id: e.target.value })}>
                                  <option value="">Paid from…</option>{paidFrom.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                                </select>
                              )}
                            </td>
                            <td><label className="flex items-center gap-1.5 text-[12px] text-ink2"><input type="checkbox" checked={r.has_receipt} onChange={(e) => set(r.key, { has_receipt: e.target.checked })} aria-label={`Line ${i + 1} receipt attached`} /> attached</label></td>
                            {departments.length > 0 && <td><select className="field sm" value={r.department} onChange={(e) => set(r.key, { department: e.target.value })} aria-label={`Line ${i + 1} department`}><option value="">—</option>{departments.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></td>}
                            {projects.length > 0 && <td><select className="field sm" value={r.project} onChange={(e) => set(r.key, { project: e.target.value })} aria-label={`Line ${i + 1} project`}><option value="">—</option>{projects.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></td>}
                            <td><button className="btn ghost icon sm" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove line ${i + 1}`}><Trash2 size={13} /></button></td>
                          </tr>
                          {r.booking && (() => {
                            const b = r.booking
                            const kind = BOOKING[b.kind as BookingKind] ?? BOOKING.air
                            const put = (k: string, v: string) => set(r.key, { booking: { ...b, [k]: v } })
                            const parts = partsTotal(b)
                            const given = partsOf(b).length > 0
                            const agree = parts.eq(round2(r.amount || 0))
                            return (
                              <tr>
                                <td />
                                <td colSpan={lineCols} className="pb-3 pt-0">
                                  <div className="rounded-xl border border-line bg-surface p-3">
                                    <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                                      <label><span className="label">Booking</span>
                                        <select className="field sm" value={b.kind} aria-label={`Line ${i + 1} kind of booking`} onChange={(e) => set(r.key, { booking: { ...Object.fromEntries(Object.entries(b).filter(([k]) => !(BOOKING_PARTS as readonly string[]).includes(k) || BOOKING[e.target.value as BookingKind].parts.includes(k as Part))), kind: e.target.value } })}>
                                          {(Object.keys(BOOKING) as BookingKind[]).map((x) => <option key={x} value={x}>{BOOKING[x].label}</option>)}
                                        </select>
                                      </label>
                                      <label><span className="label">{kind.operator}</span><input className="field sm" value={b.operator ?? ''} onChange={(e) => put('operator', e.target.value)} aria-label={`Line ${i + 1} ${kind.operator}`} /></label>
                                      {kind.facts.map(([k, label]) => (
                                        <label key={k}><span className="label">{label}</span><input className="field sm" type={DATES.includes(k) ? 'date' : 'text'} value={b[k] ?? ''} onChange={(e) => put(k, e.target.value)} aria-label={`Line ${i + 1} ${label}`} /></label>
                                      ))}
                                    </div>
                                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                                      {kind.parts.map((p) => (
                                        <label key={p}><span className="label">{partLabel(p)}</span><input className="field sm num text-right" inputMode="decimal" value={b[p] ?? ''} onChange={(e) => put(p, numeric(e.target.value))} aria-label={`Line ${i + 1} ${partLabel(p)}`} /></label>
                                      ))}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                                      {given ? <>
                                        <span className={agree ? 'text-pos' : 'text-warn'}>The parts add up to <span className="num">{fmtMoney(parts, { currency })}</span>{agree ? ', the amount of the line.' : <>; the line is <span className="num">{fmtMoney(r.amount || 0, { currency })}</span>.</>}</span>
                                        {!agree && <button className="btn sm ghost" onClick={() => set(r.key, { amount: parts.toString() })}>Set the amount of the line to the parts</button>}
                                      </> : <span>The parts are optional. Where they are given, they add up to the amount of the line.</span>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                          })()}
                          {(hints.length > 0 || r.flags.length > 0) && (
                            <tr>
                              <td />
                              <td colSpan={lineCols} className="pb-3 pt-0">
                                {hints.length > 0 && <div className="text-[11.5px] text-muted">{cat!.name}: {hints.join(' · ')}</div>}
                                {r.flags.length > 0 && (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    {r.flags.map((x) => <span key={x} className="chip warn"><AlertTriangle size={11} /> {x}</span>)}
                                    {r.edited && <span className="text-[11.5px] text-muted">as last saved — flags are worked out again when the claim is saved</span>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              ) : lines.length === 0 ? (
                <Empty title="No lines on this claim" body="The claim carries no expense line." />
              ) : (
                <table className="table dense" style={{ minWidth: 980 }}>
                  <thead><tr>
                    <th style={{ width: 34 }}>#</th><th style={{ width: 110 }}>Date</th><th>Category</th><th>Ledger</th><th>Description</th><th>Paid by</th><th style={{ width: 84 }}>Receipt</th>
                    <th className="r" style={{ width: 130 }}>Claimed</th>{showApproved && <th className="r" style={{ width: 130 }}>Approved</th>}
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const dims = [l.dims?.department && `Department ${unitName(l.dims.department)}`, l.dims?.project && `Project ${unitName(l.dims.project)}`].filter(Boolean) as string[]
                      return (
                        <Fragment key={l.id}>
                          <tr>
                            <td className="num text-muted">{l.line_no}</td>
                            <td className="num text-[12.5px]">{fmtDate(l.expense_date)}</td>
                            <td className="text-ink2">{cats.find((c) => c.id === l.category_id)?.name ?? '—'}</td>
                            <td className="text-[12.5px] text-ink2">{accountName(l.account_id)}</td>
                            <td><span className="text-ink">{l.description}</span>{l.merchant && <span className="block text-[11.5px] text-muted">{l.merchant}</span>}{dims.length > 0 && <span className="block text-[11.5px] text-muted">{dims.join(' · ')}</span>}<BookingFacts detail={l.detail} currency={currency} /></td>
                            <td className="text-[12.5px] text-ink2">{l.paid_by === 'company' ? <>The company<span className="block text-[11.5px] text-muted">{accountName(l.paid_from_ledger_id)}</span></> : 'The person'}</td>
                            <td>{l.has_receipt ? <span className="chip pos">attached</span> : <span className="chip">none</span>}</td>
                            <td className="r"><Money value={l.amount} currency={currency} /></td>
                            {showApproved && <td className="r"><Money value={l.approved_amount} currency={currency} className={cx(D(l.approved_amount).lt(l.amount) && 'text-warn')} /></td>}
                          </tr>
                          {(l.flags.length > 0 || l.approver_note) && (
                            <tr>
                              <td />
                              <td colSpan={showApproved ? 8 : 7} className="pb-3 pt-0">
                                {l.flags.length > 0 && <div className="flex flex-wrap gap-1.5">{l.flags.map((x) => <span key={x} className="chip warn"><AlertTriangle size={11} /> {x}</span>)}</div>}
                                {l.approver_note && <div className="mt-1 text-[12px] text-ink2"><span className="text-muted">Approver's note:</span> {l.approver_note}</div>}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {editable && <div className="border-t border-line px-3.5 py-2.5"><button className="btn sm" onClick={() => setRows((rs) => [...rs, blank()])}><Plus size={13} /> Add line</button></div>}
          </Panel>
          {editable && problems.length > 0 && touched && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
          {editable && <div className="text-[11.5px] text-muted">Policy flags are worked out when the claim is saved. They inform the approver; they never reject a claim on their own.</div>}
        </div>

        <div className="min-w-0 space-y-4">
          {editable ? (
            <Panel className="p-5" lit={false}>
              <div className="eyebrow mb-3">Totals</div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-ink2">Paid by the person</span><Money value={byPerson} currency={currency} /></div>
                <div className="flex justify-between"><span className="text-ink2">Paid by the company</span><Money value={byCompany} currency={currency} dim /></div>
                <div className="hairline my-2" />
                <div className="flex items-baseline justify-between"><span className="font-medium">Total claimed</span><Money value={total} currency={currency} className="display text-[22px] text-gold" /></div>
              </div>
              <div className="mt-4 eyebrow mb-2">If approved in full</div>
              <div className="space-y-2 text-[13px]">
                {advance && <div className="flex justify-between"><span className="text-ink2">Unsettled on {advance.advance_no}</span><Money value={held} currency={currency} /></div>}
                {advance && <div className="flex justify-between"><span className="text-ink2">Settled against the advance</span><Money value={applied} currency={currency} /></div>}
                <div className="flex justify-between"><span className="text-ink2">Reimbursement due to the person</span><Money value={reimbursement} currency={currency} /></div>
                {advance && <div className="flex justify-between"><span className="text-ink2">{finalSettlement && left.gt(0) ? 'RETURN DUE from the person' : 'Left unsettled on the advance'}</span><Money value={left} currency={currency} className={cx(finalSettlement && left.gt(0) && 'text-warn')} /></div>}
              </div>
              <div className="mt-3 text-[11.5px] leading-relaxed text-muted">An estimate from the lines entered. The approver may approve less; the ledger engine works out the final figures when the claim is approved.</div>
            </Panel>
          ) : d && (
            <Panel className="p-5" lit={false}>
              <div className="eyebrow mb-3">Settlement summary</div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-ink2">Claimed</span><Money value={d.total} currency={currency} /></div>
                <div className="flex justify-between"><span className="text-ink2">Approved</span>{decidedNow ? <Money value={d.approved_total} currency={currency} className={cx(D(d.approved_total).lt(d.total) && 'text-warn')} /> : <span className="text-muted">not yet decided</span>}</div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink2">Settled against advance{d.advance_id && <> · <button className="link" onClick={() => nav('/expenses/advances/' + d.advance_id)}>{advance?.advance_no ?? 'open'}</button></>}</span>
                  {decidedNow && d.journal_id ? <Money value={d.advance_applied} currency={currency} dim /> : <span className="text-muted">—</span>}
                </div>
                <div className="hairline my-2" />
                <div className="flex items-baseline justify-between"><span className="font-medium">Reimbursement due</span>{decidedNow && d.journal_id ? <Money value={d.payable} currency={currency} className="display text-[22px] text-gold" /> : <span className="text-muted">—</span>}</div>
                <div className="flex justify-between"><span className="text-ink2">Paid on</span><span className="num text-ink2">{fmtDate(d.paid_on)}</span></div>
              </div>
              <div className="mt-3 text-[11.5px] leading-relaxed text-muted">Approved expenses the person paid are first set against the advance, if one is being settled. What remains is the reimbursement due. Expenses the company paid directly are never reimbursed.</div>
            </Panel>
          )}

          {d && <ProposedEntries companyIds={[d.company_id]} sourceId={d.id} sources={['expense_claim', 'claim_payment']} />}
          {d ? <Attachments companyId={d.company_id} entity="expense_claims" entityId={d.id} readOnly={['cancelled'].includes(d.status)} />
            : <Section title="Evidence"><Panel className="px-4 py-3 text-[12.5px] text-muted" lit={false}>Save the draft first. Receipts can then be attached to the claim.</Panel></Section>}

          {d && (audit.data?.length ?? 0) > 0 && (
            <Section title="History">
              <Panel className="max-h-[280px] overflow-auto p-1.5" lit={false}>
                {audit.data!.filter((a) => a.action !== 'update').map((a) => (
                  <div key={String(a.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{a.action === 'insert' ? 'created' : a.action.replace(/_/g, ' ')}</span> <span className="text-muted">· {a.actor_name ?? 'Name not available'} · {fmtDateTime(a.at)}</span>
                    {a.reason && <div className="text-[12px] text-ink2">{a.reason}</div>}
                  </div>
                ))}
              </Panel>
            </Section>
          )}
        </div>
      </div>

      <Modal open={approving} onClose={() => setApproving(false)} title="Approve expense claim" width={860}
        subtitle={d ? `${d.claim_no} · ${partyName(d.claimant_party_id)} · ${d.title}` : undefined}
        footer={<>
          <span className="mr-auto text-[12.5px] text-ink2">Approved <Money value={approvedTotal} currency={currency} className="text-ink" /> of <Money value={d?.total ?? 0} currency={currency} /></span>
          <button className="btn ghost" onClick={() => setApproving(false)}>Cancel</button>
          <button className="btn good" disabled={busy || approvalProblems.length > 0} title={approvalProblems[0]} onClick={() => void approve()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Approve</button>
        </>}>
        <Note className="mb-4">Approval accepts the expense. It moves no money and writes nothing to the ledger: the accounting entry is proposed and approved separately in the approval inbox. The person who prepared the claim cannot approve it.</Note>
        <div className="overflow-auto rounded-xl border border-line">
          <table className="table dense" style={{ minWidth: 720 }}>
            <thead><tr><th style={{ width: 34 }}>#</th><th>Expense</th><th className="r" style={{ width: 120 }}>Claimed</th><th className="r" style={{ width: 130 }}>Approved</th><th style={{ minWidth: 220 }}>Note</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const v = dec(l)
                const less = v.amount.trim() !== '' && D(v.amount).lt(l.amount)
                return (
                  <tr key={l.id}>
                    <td className="num text-muted">{l.line_no}</td>
                    <td>
                      <span className="text-ink">{l.description}</span>
                      <span className="block text-[11.5px] text-muted">{fmtDate(l.expense_date)}{l.merchant ? ` · ${l.merchant}` : ''} · {l.paid_by === 'company' ? 'paid by the company' : 'paid by the person'} · {l.has_receipt ? 'receipt attached' : 'no receipt'}</span>
                      {l.flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{l.flags.map((x) => <span key={x} className="chip warn"><AlertTriangle size={11} /> {x}</span>)}</span>}
                    </td>
                    <td className="r"><Money value={l.amount} currency={currency} /></td>
                    <td><input className="field sm num text-right" inputMode="decimal" value={v.amount} aria-label={`Line ${l.line_no} approved amount`} onChange={(e) => setDecisions((x) => ({ ...x, [l.id]: { ...v, amount: numeric(e.target.value) } }))} /></td>
                    <td><input className="field sm" value={v.note} aria-label={`Line ${l.line_no} note`} placeholder={less ? 'Required — why less than claimed?' : 'Optional'} onChange={(e) => setDecisions((x) => ({ ...x, [l.id]: { ...v, note: e.target.value } }))} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Field label={flaggedApproved ? 'Comment (required — this claim has flagged lines)' : 'Comment (optional)'} className="mt-4" hint="Recorded with the decision in the audit trail.">
          <textarea className="field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={flaggedApproved ? 'Why are the flagged lines being approved?' : undefined} />
        </Field>
        {approvalProblems.length > 0 && <div className="mt-3 text-[12px] text-warn">{approvalProblems[0]}</div>}
      </Modal>

      <ReasonDialog open={dialog === 'reject'} title="Reject expense claim" confirm="Reject claim" danger
        body="The claim returns to the person who prepared it. It can be corrected and submitted again. Nothing reaches the ledger."
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => { if (d) void act(async () => { await api.rejectClaim(d.id, reason); return true }, 'Claim rejected').then((ok) => { if (ok) setDialog(null) }) }} />
      <ReasonDialog open={dialog === 'cancel'} title="Cancel expense claim" confirm="Cancel claim" danger
        body="A cancelled claim cannot be reopened. It has no effect on the ledger."
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => { if (d) void act(async () => { await api.cancelClaim(d.id, reason); return true }, 'Claim cancelled').then((ok) => { if (ok) setDialog(null) }) }} />
      {d && (
        <MoneyMoveDialog open={dialog === 'pay'} title="Record reimbursement" subtitle={`${d.claim_no} · ${partyName(d.claimant_party_id)}`} companyId={d.company_id} amount={d.payable} amountEditable={false} confirm="Record reimbursement" busy={busy}
          note="Record the reimbursement after the money has been paid to the person. This proposes an accounting entry; it reaches the ledger only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money."
          onCancel={() => setDialog(null)}
          onConfirm={(v) => void act(() => api.payClaim(d.id, { bank_ledger_id: v.bank_ledger_id, date: v.date, reference: v.reference.trim() || undefined, method: v.method }), 'Reimbursement recorded. Its entry waits in the approval inbox.').then((j) => { if (j) setDialog(null) })} />
      )}
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
