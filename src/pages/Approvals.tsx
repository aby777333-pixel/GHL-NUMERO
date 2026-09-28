import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, ChevronDown, ChevronRight, ExternalLink, Inbox, Plus, Send, ShieldCheck, X } from 'lucide-react'
import type { ApprovalRequest, ApprovalRule, ID, JournalDetail, JournalLineView, Member } from '@/engine/types'
import type { Advance, ExpenseClaim, PurchaseDoc } from '@/engine/opsTypes'
import type { CapitalCall, Distribution, Fund } from '@/engine/p3Types'
import { advanceMemory, type MemoryFact } from '@/engine/ops'
import { APPROVAL_ENTITIES, workflowSource } from '@/lib/workflow'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, fmtMoney, ZERO } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { ApprovalRuleEditor } from '@/ui/ApprovalRuleEditor'

type TabKey = 'pending' | 'approved' | 'rejected' | 'all'

/** Review threshold of the "before I approve" checklist, in the company's base currency. */
const LARGE_AMOUNT = 1000000
const OLD_AFTER_DAYS = 30

const roleLabel = (key: string | undefined) => (!key ? 'not specified' : key === '*' ? 'any authorised approver' : key.replace(/_/g, ' '))
const humanise = (s: string) => s.replace(/[_.]/g, ' ')
const foot = 'border-t border-line2 px-[14px] py-[10px]'

function stepText(r: ApprovalRequest) {
  const n = r.steps.length
  if (r.status === 'pending') return `Step ${Math.min(r.current_step, n)} of ${n} — requires role: ${roleLabel(r.steps[r.current_step - 1])}`
  if (r.status === 'approved') return n === 1 ? 'The single approval step is complete' : `All ${n} steps complete`
  if (r.status === 'rejected') return `Rejected at step ${Math.min(r.current_step, n)} of ${n}`
  return `Withdrawn at step ${Math.min(r.current_step, n)} of ${n}`
}

function Steps({ r }: { r: ApprovalRequest }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {r.steps.map((s, i) => {
        const step = i + 1
        const done = r.status === 'approved' || step < r.current_step
        const current = r.status === 'pending' && step === r.current_step
        const stopped = (r.status === 'rejected' || r.status === 'cancelled') && step === r.current_step
        return <i key={i} title={`Step ${step}: ${roleLabel(s)}`} className={cx('lamp', done ? 'pos' : current ? 'warn pulse' : stopped ? 'neg' : '')} />
      })}
    </span>
  )
}

export default function Approvals() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const session = useApp((s) => s.session)
  const ids = useScopeIds()
  const idsKey = ids.join(',')

  const [tab, setTab] = useState<TabKey>('pending')
  const [selId, setSelId] = useState<ID | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [editing, setEditing] = useState<ApprovalRule | 'new' | null>(null)
  const mayConfigure = !!session?.isGroupAdmin || can('approval.configure')

  const main = useAsync(async () => {
    const [requests, rules, members] = await Promise.all([
      api.listApprovalRequests(ids),
      api.listApprovalRules(),
      // names are a convenience; the inbox must work for people who cannot list team members
      api.listMembers().catch(() => [] as Member[]),
    ])
    return { requests, rules, members }
  }, [api, idsKey])

  const d = main.data
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const nameById = useMemo(() => new Map((d?.members ?? []).map((m) => [m.user_id, m.full_name])), [d])
  const who = (id: ID | null) => {
    if (!id) return 'System'
    if (session && id === session.user.id) return `${session.user.name} (you)`
    return nameById.get(id) ?? `User ${id.slice(0, 8)}`
  }

  const requests = d?.requests ?? []
  const count = (s: ApprovalRequest['status']) => requests.filter((r) => r.status === s).length
  const rows = tab === 'all' ? requests : requests.filter((r) => r.status === tab)
  const selected = requests.find((r) => r.id === selId) ?? null
  const pendingTotal = requests.filter((r) => r.status === 'pending').reduce((s, r) => s.plus(D(r.amount)), ZERO)
  const selfApproval = session?.group?.settings.controls?.maker_checker === 'owner_override'

  const columns: Column<ApprovalRequest>[] = [
    { key: 'company', header: 'Company', render: (r) => <span title={companyById.get(r.company_id)?.name}><span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10.5px] text-gold">{companyById.get(r.company_id)?.code ?? '—'}</span></span>, sort: (r) => companyById.get(r.company_id)?.name ?? '', csv: (r) => companyById.get(r.company_id)?.name ?? '' },
    { key: 'entity', header: 'Record', render: (r) => <span className="chip">{APPROVAL_ENTITIES[r.entity]?.label ?? humanise(r.entity)}</span>, sort: (r) => r.entity, csv: (r) => APPROVAL_ENTITIES[r.entity]?.label ?? r.entity },
    { key: 'summary', header: 'Summary', render: (r) => <span className="text-ink">{r.summary || <span className="text-muted">No narration was entered</span>}</span>, csv: (r) => r.summary ?? '' },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} currency={companyById.get(r.company_id)?.base_currency} className="text-ink" />, sort: (r) => D(r.amount).toNumber(), csv: (r) => D(r.amount).toFixed(2) },
    {
      key: 'requested', header: 'Requested by', sort: (r) => r.requested_at, csv: (r) => `${who(r.requested_by)} on ${r.requested_at}`,
      render: (r) => <div><div className="text-ink2">{who(r.requested_by)}</div><div className="num text-[11.5px] text-muted">{fmtDateTime(r.requested_at)}</div></div>,
    },
    {
      key: 'progress', header: 'Progress', sort: (r) => r.current_step, csv: (r) => stepText(r),
      render: (r) => <div className="flex items-center gap-2.5"><Steps r={r} /><span className="text-[12.5px] text-ink2">{stepText(r)}</span></div>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} />, sort: (r) => r.status, csv: (r) => r.status },
  ]

  const ruleColumns: Column<ApprovalRule>[] = [
    { key: 'name', header: 'Rule', render: (r) => <span className="text-ink">{r.name}</span>, sort: (r) => r.name },
    { key: 'entity', header: 'Applies to', render: (r) => <span className="chip">{r.entity === 'journal' ? 'journals and proposed entries' : APPROVAL_ENTITIES[r.entity]?.label.toLowerCase() ?? humanise(r.entity)}</span>, sort: (r) => r.entity },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2">{r.company_id ? companyById.get(r.company_id)?.name ?? 'Company not shared with you' : 'All companies'}</span>, sort: (r) => (r.company_id ? companyById.get(r.company_id)?.name ?? '' : '') },
    {
      key: 'range', header: 'Amount range', align: 'right', sort: (r) => D(r.min_amount).toNumber(),
      render: (r) => <span className="whitespace-nowrap"><Money value={r.min_amount} decimals={0} /> <span className="text-muted">{r.max_amount === null ? 'and above' : 'to below'}</span>{r.max_amount !== null && <> <Money value={r.max_amount} decimals={0} /></>}</span>,
    },
    { key: 'steps', header: 'Steps', render: (r) => <div className="flex flex-wrap items-center gap-1">{r.steps.map((s, i) => <span key={i} className="chip cyan"><span className="num">{i + 1}</span> {roleLabel(s)}</span>)}</div> },
    { key: 'active', header: 'State', render: (r) => <StatusChip status={r.is_active ? 'active' : 'inactive'} />, sort: (r) => (r.is_active ? 0 : 1) },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Controls"
        title="Approvals"
        subtitle={<>Everything waiting for a decision in the selected compan{ids.length === 1 ? 'y' : 'ies'}: journals, entries proposed by operations, advances, expense claims, requisitions and purchase orders. Nothing reaches the books until it has been approved and posted.</>}
        actions={d && count('pending') > 0 ? <span className="chip warn"><span className="num">{count('pending')}</span> pending · <Money value={pendingTotal} compact /></span> : undefined}
      />

      <Note className="mb-4">
        <strong className="text-ink">Maker-checker.</strong> The person who created an entry cannot approve it, unless the Owner has explicitly enabled Owner self-approval. The engine enforces this on every approval; a refused approval is explained on screen. Approving a request is a decision only: it moves no money.
        {session?.group && <> Current setting for {session.group.name}: <span className="text-ink">{selfApproval ? 'Owner self-approval is enabled, and each use is recorded in the audit trail' : 'strictly enforced'}</span>.</>}
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} label="Loading approvals" /></Panel>}

      {d && (
        <>
          <Tabs<TabKey>
            tabs={[
              { key: 'pending', label: 'Pending', count: count('pending') },
              { key: 'approved', label: 'Approved', count: count('approved') },
              { key: 'rejected', label: 'Rejected', count: count('rejected') },
              { key: 'all', label: 'All', count: requests.length },
            ]}
            value={tab} onChange={setTab}
          />

          <Panel lit={false} className="mb-5">
            <DataTable
              key={tab}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRow={(r) => setSelId(r.id)}
              exportName={`approvals-${tab}`}
              initialSort={{ key: 'requested', dir: 'desc' }}
              empty={tab === 'pending'
                ? { title: 'Nothing is waiting for approval', body: 'Entries submitted for approval in the selected companies appear here.', icon: <Inbox size={20} /> }
                : { title: 'No requests in this list', body: 'No approval request in the selected companies has this status.', icon: <Inbox size={20} /> }}
            />
          </Panel>

          <Section title="Configured approval rules"
            right={<span className="flex items-center gap-2">{mayConfigure && <button className="btn sm" onClick={() => { setRulesOpen(true); setEditing('new') }}><Plus size={13} /> Add rule</button>}<button className="btn sm ghost" onClick={() => setRulesOpen((o) => !o)} aria-expanded={rulesOpen}>{rulesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {rulesOpen ? 'Hide' : 'Show'} {d.rules.length} rule{d.rules.length === 1 ? '' : 's'}</button></span>}>
            {rulesOpen ? (
              <Panel lit={false}>
                <DataTable columns={ruleColumns} rows={d.rules} rowKey={(r) => r.id} initialSort={{ key: 'range', dir: 'asc' }} onRow={mayConfigure ? (r) => setEditing(r) : undefined}
                  empty={{ title: 'No approval rule is configured', body: 'Without a rule, a submitted entry needs one approval from any authorised approver.', icon: <ShieldCheck size={20} /> }} />
              </Panel>
            ) : (
              <div className="text-[12.5px] text-muted">Rules decide how many approval steps an entry needs, by amount. When no rule matches, one approval from any authorised approver is required.</div>
            )}
          </Section>
        </>
      )}

      <ApprovalRuleEditor open={editing !== null} rule={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
      <RequestDrawer request={selected} onClose={() => setSelId(null)} who={who} onOpen={(to) => nav(to)} />
    </div>
  )
}

interface Check { ok: boolean; label: string; detail: string }

type OtherRecord =
  | { kind: 'advance'; advance: Advance; memory: MemoryFact[] }
  | { kind: 'claim'; claim: ExpenseClaim }
  | { kind: 'purchase'; doc: PurchaseDoc }
  | { kind: 'call'; call: CapitalCall; fund: Fund | null }
  | { kind: 'distribution'; dist: Distribution; fund: Fund | null }
  | { kind: 'hidden' }

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="rounded-xl border border-line px-3.5">
      {rows.map(([l, v]) => (
        <div key={l} className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
          <span className="flex-none text-muted">{l}</span>
          <span className="min-w-0 break-words text-right text-ink">{v}</span>
        </div>
      ))}
    </div>
  )
}

function checklist(j: JournalDetail, currency: string, mask: boolean): Check[] {
  const debit = j.lines.reduce((s, l) => s.plus(D(l.debit)), ZERO)
  const credit = j.lines.reduce((s, l) => s.plus(D(l.credit)), ZERO)
  const balanced = j.lines.length > 0 && debit.eq(credit)
  const bare = j.lines.filter((l) => !l.description?.trim()).length
  const age = daysBetween(j.journal_date, today())
  const total = D(j.total)
  const large = total.gt(LARGE_AMOUNT)
  const limit = fmtMoney(LARGE_AMOUNT, { currency, decimals: 0 })
  return [
    {
      ok: balanced, label: balanced ? 'The entry is balanced' : 'The entry is not balanced',
      detail: j.lines.length === 0 ? 'The entry has no lines.' : `Debits ${fmtMoney(debit, { currency, mask })} · credits ${fmtMoney(credit, { currency, mask })}${balanced ? '' : ` · difference ${fmtMoney(debit.minus(credit).abs(), { currency, mask })}`}`,
    },
    {
      ok: bare === 0, label: bare === 0 ? 'Every line has a description' : `${bare} of ${j.lines.length} line${j.lines.length === 1 ? '' : 's'} ${bare === 1 ? 'has' : 'have'} no description`,
      detail: bare === 0 ? 'Each line states what it is for.' : 'A line without a description is harder to explain later.',
    },
    {
      ok: age >= 0 && age <= OLD_AFTER_DAYS,
      label: age < 0 ? 'The entry is dated in the future' : age > OLD_AFTER_DAYS ? `The entry is dated more than ${OLD_AFTER_DAYS} days ago` : 'The entry date is recent',
      detail: age < 0 ? `Dated ${fmtDate(j.journal_date)}, which is ${-age} day${age === -1 ? '' : 's'} from today.` : `Dated ${fmtDate(j.journal_date)}, ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.`,
    },
    {
      ok: !large, label: large ? `The amount is above ${limit}` : `The amount is not above ${limit}`,
      detail: `Entry total ${fmtMoney(total, { currency, mask })}.`,
    },
    {
      ok: !!j.purpose?.trim(), label: j.purpose?.trim() ? 'The maker has stated a purpose' : 'The maker has not stated a purpose',
      detail: j.purpose?.trim() ? j.purpose.trim() : 'No purpose was recorded with this entry.',
    },
  ]
}

function RequestDrawer({ request, onClose, who, onOpen }: { request: ApprovalRequest | null; onClose: () => void; who: (id: ID | null) => string; onOpen: (to: string) => void }) {
  const api = useApp((s) => s.api)!
  const privacy = useApp((s) => s.privacy)
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const accounts = useApp((s) => s.accounts)
  useApp((s) => s.session)
  const { act, busy } = useAction()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [approvedNow, setApprovedNow] = useState<ID | null>(null)
  const [amount, setAmount] = useState('')

  const isJournal = request?.entity === 'journal'
  const other = request ? APPROVAL_ENTITIES[request.entity] : undefined
  const journalId = isJournal && request ? request.entity_id : null
  const detail = useAsync(async () => (journalId ? api.openJournal(journalId) : null), [api, journalId])
  const j = detail.data && detail.data.id === journalId ? detail.data : null

  // an entry proposed by an operation posts on its final approval and then updates its source record
  const wf = useAsync(async () => (journalId && request ? (await api.listWorkflowPostings({ companyIds: [request.company_id], journalId }))[0] ?? null : null), [api, journalId, request?.company_id])
  const proposal = wf.data && wf.data.journal_id === journalId ? wf.data : null
  const origin = proposal ? workflowSource(proposal) : null

  // the record behind a request that is not a journal
  const record = useAsync<OtherRecord | null>(async () => {
    if (!request || !other) return null
    const cid = request.company_id
    if (request.entity === 'advance') {
      const advances = await api.listAdvances({ companyIds: [cid] })
      const advance = advances.find((a) => a.id === request.entity_id)
      if (!advance) return { kind: 'hidden' }
      const claims = await api.listClaims({ companyIds: [cid], partyId: advance.recipient_party_id }).catch(() => [] as ExpenseClaim[])
      return { kind: 'advance', advance, memory: advanceMemory(advances, claims, advance.recipient_party_id, today(), advance.id) }
    }
    if (request.entity === 'expense_claim') return { kind: 'claim', claim: await api.getClaim(request.entity_id) }
    // a fund the person is not cleared for is not returned, and its call or distribution is then not decided from here
    if (request.entity === 'capital_call') {
      const call = (await api.listCapitalCalls({ companyIds: [cid] })).find((c) => c.id === request.entity_id)
      if (!call) return { kind: 'hidden' }
      return { kind: 'call', call, fund: (await api.listFunds([cid])).find((f) => f.id === call.fund_id) ?? null }
    }
    if (request.entity === 'distribution') {
      const dist = await api.getDistribution(request.entity_id).catch(() => null)
      if (!dist) return { kind: 'hidden' }
      return { kind: 'distribution', dist, fund: dist.fund_id ? (await api.listFunds([cid])).find((f) => f.id === dist.fund_id) ?? null : null }
    }
    return { kind: 'purchase', doc: await api.getPurchaseDoc(request.entity_id) }
  }, [api, request?.id, request?.entity_id])
  const rec = record.data ?? null

  const company = request ? companies.find((c) => c.id === request.company_id) : undefined
  const currency = company?.base_currency ?? 'INR'
  const mayApprove = !!request && can(other ? other.perm : 'journal.approve', request.company_id)
  const mayReject = !!request && can(other ? other.perm : 'journal.reject', request.company_id)
  const mayPost = !!request && can('journal.post', request.company_id)
  const pending = request?.status === 'pending'
  const decidable = isJournal || (!!other && !!rec && rec.kind !== 'hidden')
  const readyToPost = !!journalId && !proposal && (j ? j.status === 'approved' : approvedNow === journalId)
  const claimFlags = rec?.kind === 'claim' ? rec.claim.flagged_lines : 0
  const partyName = (id: ID | null) => (id ? parties.find((x) => x.id === id)?.display_name ?? 'Unknown party' : '—')
  const accountName = (id: ID | null) => { const a = id ? accounts.find((x) => x.id === id) : undefined; return a ? `${a.code} · ${a.name}` : '—' }

  const openApprove = () => { setAmount(rec?.kind === 'advance' ? String(D(rec.advance.requested_amount)) : ''); setDialog('approve') }
  const amountProblem = rec?.kind === 'advance' && dialog === 'approve'
    ? (D(amount || 0).lte(0) ? 'Enter the amount approved.' : D(amount || 0).gt(D(rec.advance.requested_amount)) ? 'The approved amount cannot exceed the amount requested.' : null)
    : null

  const approve = async (comment: string) => {
    if (!request) return
    const id = request.entity_id
    const note = comment || undefined
    if (journalId) {
      setDialog(null)
      const r = await act(() => api.approveJournal(journalId, note), (v) => (v !== 'approved' ? 'Step approved — passed to the next approver' : proposal ? 'Approved and posted to the books' : 'Approved — the entry is ready to be posted'))
      if (r === 'approved' && !proposal) setApprovedNow(journalId)
      return
    }
    if (!rec || rec.kind === 'hidden') return
    if (amountProblem) return
    setDialog(null)
    const done = (what: string) => (v: 'approved' | 'pending' | 'rejected') => (v === 'approved' ? what : 'Step approved — passed to the next approver')
    if (rec.kind === 'advance') await act(() => api.approveAdvance(id, amount, note), done('Advance approved. No money has moved: the release is recorded separately.'))
    else if (rec.kind === 'claim') await act(() => api.approveClaim(id, note), done('Claim approved as claimed. Its accounting entry now waits in this inbox.'))
    else if (rec.kind === 'call') await act(() => api.decideCapitalCall(id, 'approved', note), done('Capital call approved. The investors now owe what was called. No money has moved and nothing is posted.'))
    else if (rec.kind === 'distribution') await act(() => api.decideDistribution(id, 'approved', note), done('Approved. The entry that declares it now waits in this inbox. Nothing has been paid.'))
    else await act(() => api.approvePurchaseDoc(id, note), done(rec.doc.kind === 'purchase_order' ? 'Order approved. It is now a commitment, not a cost.' : 'Requisition approved'))
  }
  const reject = async (reason: string) => {
    if (!request) return
    const id = request.entity_id
    setDialog(null)
    if (journalId) { await act(() => api.rejectJournal(journalId, reason), proposal ? 'Entry rejected. Nothing was posted; the source record has been told.' : 'Entry rejected and returned to its maker'); return }
    if (!rec || rec.kind === 'hidden') return
    if (rec.kind === 'advance') await act(() => api.rejectAdvance(id, reason), 'Advance request rejected')
    else if (rec.kind === 'claim') await act(() => api.rejectClaim(id, reason), 'Claim rejected and returned to its maker')
    else if (rec.kind === 'call') await act(() => api.decideCapitalCall(id, 'rejected', reason), 'Capital call rejected and returned to its maker')
    else if (rec.kind === 'distribution') await act(() => api.decideDistribution(id, 'rejected', reason), 'Rejected and returned to its maker. Nothing was declared.')
    else await act(() => api.rejectPurchaseDoc(id, reason), 'Rejected and returned to its maker')
  }
  const post = async () => {
    if (!journalId) return
    const v = await act(() => api.postJournal(journalId), (no) => `Posted to the books as ${no}`)
    if (v) setApprovedNow(null)
  }

  const debit = j ? j.lines.reduce((s, l) => s.plus(D(l.debit)), ZERO) : ZERO
  const credit = j ? j.lines.reduce((s, l) => s.plus(D(l.credit)), ZERO) : ZERO
  const checks = j && !j.restricted ? checklist(j, currency, privacy) : []
  const flagged = checks.filter((c) => !c.ok).length

  const lineColumns: Column<JournalLineView>[] = [
    { key: 'n', header: '#', width: 36, render: (l) => <span className="num text-[11.5px] text-muted">{l.line_no}</span> },
    {
      key: 'account', header: 'Account',
      render: (l) => (
        <div className="min-w-0">
          <div className="text-ink"><span className="num text-[11.5px] text-muted">{l.account_code}</span> {l.account_name}</div>
          {l.party_id && <button className="link text-[12px]" onClick={() => onOpen('/parties/' + l.party_id)}>{l.party_name ?? 'Party'}</button>}
          {l.description ? <div className="text-[12px] text-muted">{l.description}</div> : <div className="text-[12px] text-warn">No description</div>}
          {Object.keys(l.dims).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{Object.entries(l.dims).map(([t, u]) => <span key={t} className="chip" title={humanise(t)}>{u.name}</span>)}</div>}
        </div>
      ),
    },
    { key: 'debit', header: 'Debit', align: 'right', render: (l) => (D(l.debit).isZero() ? <span className="text-muted">—</span> : <Money value={l.debit} currency={currency} />) },
    { key: 'credit', header: 'Credit', align: 'right', render: (l) => (D(l.credit).isZero() ? <span className="text-muted">—</span> : <Money value={l.credit} currency={currency} />) },
  ]

  const permText = other ? `${other.perm} (needed to decide a ${other.label.toLowerCase()})` : null
  const approveWhy = !decidable ? 'This record cannot be decided from the inbox.' : !pending ? `This request is ${request?.status}.` : !mayApprove ? `Your role does not include the permission ${permText ?? 'to approve journals (journal.approve)'} in this company.` : 'Approve this step'
  const rejectWhy = !decidable ? 'This record cannot be decided from the inbox.' : !pending ? `This request is ${request?.status}.` : !mayReject ? `Your role does not include the permission ${permText ?? 'to reject journals (journal.reject)'} in this company.` : 'Reject and return to the maker'
  const noun = other ? other.label.toLowerCase() : 'entry'

  return (
    <>
      <Drawer open={!!request} onClose={onClose} width={680}
        title={request ? request.summary || `${humanise(request.entity)} awaiting approval` : ''}
        subtitle={request && <span className="flex flex-wrap items-center gap-2"><span>{company?.name ?? 'Company'}</span><span>·</span><StatusChip status={request.status} /><span>·</span><span>{stepText(request)}</span></span>}
        footer={request && <>
          {journalId && <button className="btn ghost" onClick={() => onOpen('/journals/' + journalId)}><ExternalLink size={14} /> Open full record</button>}
          {other && request && <button className="btn ghost" onClick={() => onOpen(other.to(request.entity_id))}><ExternalLink size={14} /> Open full record</button>}
          {readyToPost && (
            <button className="btn good" onClick={post} disabled={busy || !mayPost} title={mayPost ? 'Post this approved entry to the books' : 'Your role does not include the permission to post journals (journal.post) in this company.'}><Send size={14} /> Post now</button>
          )}
          {pending && <>
            <button className="btn danger" onClick={() => setDialog('reject')} disabled={busy || !decidable || !mayReject} title={rejectWhy}><X size={14} /> Reject</button>
            <button className="btn primary" onClick={openApprove} disabled={busy || !decidable || !mayApprove} title={approveWhy}><BadgeCheck size={14} /> Approve</button>
          </>}
        </>}>
        {request && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">Amount</div>
                <Money value={request.amount} currency={currency} className="mt-1 block text-[20px] leading-none" />
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">Requested</div>
                <div className="mt-1 text-[13px] text-ink">{who(request.requested_by)}</div>
                <div className="num text-[11.5px] text-muted">{fmtDateTime(request.requested_at)}</div>
              </div>
            </div>

            <div>
              <div className="eyebrow mb-2">Approval steps</div>
              <div className="rounded-xl border border-line">
                {request.steps.map((s, i) => {
                  const step = i + 1
                  const done = request.status === 'approved' || step < request.current_step
                  const current = request.status === 'pending' && step === request.current_step
                  return (
                    <div key={i} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                      <span className={cx('lamp', done ? 'pos' : current ? 'warn pulse' : '')} />
                      <span className="num text-muted">Step {step}</span>
                      <span className="flex-1 text-ink2">requires role: <span className="text-ink">{roleLabel(s)}</span></span>
                      <span className="text-[12px] text-muted">{done ? 'approved' : current ? 'waiting' : request.status === 'pending' ? 'not yet reached' : 'not reached'}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {readyToPost && (
              <Note kind="good">This entry is fully approved. It does not affect the books until it is posted{mayPost ? ' — use “Post now” below.' : '. Posting needs the journal.post permission.'}</Note>
            )}

            {!isJournal && !other && <Note>The detail of a {humanise(request.entity)} request is shown on its own record.</Note>}

            {origin && proposal && (
              <Note kind={proposal.status === 'pending' ? 'info' : 'good'}>
                <strong className="text-ink">Proposed by an operation: {origin.label}.</strong> This entry was prepared from a source record, not typed by hand. On its final approval it is posted to the books immediately and {origin.onApproval}. Rejecting it posts nothing.
                <span className="mt-1 block text-[12px] text-muted">Rule applied: {origin.rule}</span>
                {origin.to && <button className="link mt-1 block text-[12.5px]" onClick={() => onOpen(origin.to!)}>Open the source record</button>}
              </Note>
            )}

            {other && record.error && <ErrorBox message={record.error} retry={record.reload} />}
            {other && !rec && !record.error && <Loading rows={4} label="Loading the record" />}
            {rec?.kind === 'hidden' && <Note kind="warn">This record is restricted. Your account is not authorised to view its detail, so it cannot be decided from here.</Note>}

            {rec?.kind === 'advance' && (
              <>
                <Facts rows={[
                  ['Advance', <span key="a" className="num text-gold">{rec.advance.advance_no}</span>],
                  ['Recipient', <button key="r" className="link" onClick={() => onOpen('/parties/' + rec.advance.recipient_party_id)}>{partyName(rec.advance.recipient_party_id)}</button>],
                  ['Kind', humanise(rec.advance.recipient_type)],
                  ['Purpose', rec.advance.purpose],
                  ['Requested', <Money key="q" value={rec.advance.requested_amount} currency={rec.advance.currency} />],
                  ['To be settled by', rec.advance.expected_settlement_date ? <span key="d" className="num">{fmtDate(rec.advance.expected_settlement_date)}</span> : <span key="d" className="text-warn">No settlement date was given</span>],
                  ['Method', rec.advance.payment_method ?? '—'],
                ]} />
                <div>
                  <div className="eyebrow mb-2">What is already on record for this person</div>
                  <div className="rounded-xl border border-line">
                    {rec.memory.map((f, i) => (
                      <div key={i} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                        <span className={cx('lamp mt-[6px]', f.kind === 'clean' || f.kind === 'none' ? 'pos' : 'warn')} />
                        <div className="min-w-0 flex-1 text-ink2">{f.text}</div>
                        {f.advance_id && <button className="link flex-none text-[12px]" onClick={() => onOpen('/expenses/advances/' + f.advance_id)}>View</button>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-muted">These are facts from the records of the selected company. They inform the decision; they do not make it.</div>
                </div>
                <Note>An advance is money held by a person. It is not an expense. Approving it moves no money: the release is recorded separately and its entry is approved again before it reaches the books.</Note>
              </>
            )}

            {rec?.kind === 'claim' && (
              <>
                <Facts rows={[
                  ['Claim', <span key="c" className="num text-gold">{rec.claim.claim_no}</span>],
                  ['Person', <button key="p" className="link" onClick={() => onOpen('/parties/' + rec.claim.claimant_party_id)}>{partyName(rec.claim.claimant_party_id)}</button>],
                  ['Title', rec.claim.title],
                  ['Purpose', rec.claim.purpose || <span key="u" className="text-muted">None recorded</span>],
                  ['Claimed', <Money key="t" value={rec.claim.total} currency={rec.claim.currency} />],
                  ['Settles an advance', rec.claim.advance_id ? <button key="a" className="link" onClick={() => onOpen('/expenses/advances/' + rec.claim.advance_id)}>Yes — open the advance{rec.claim.final_settlement ? ' (final settlement)' : ''}</button> : 'No'],
                ]} />
                {claimFlags > 0 && <Note kind="warn">{claimFlags} line{claimFlags === 1 ? ' is' : 's are'} flagged. Flags inform the approver; they never reject a claim. Approving a flagged line needs a comment.</Note>}
                <div>
                  <div className="eyebrow mb-2">Lines</div>
                  <div className="rounded-xl border border-line">
                    {(rec.claim.lines ?? []).map((l) => (
                      <div key={l.id} className="border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-ink">{l.description}{l.merchant ? <span className="text-muted"> · {l.merchant}</span> : null}</div>
                            <div className="text-[12px] text-muted"><span className="num">{fmtDate(l.expense_date)}</span> · {accountName(l.account_id)} · paid by {l.paid_by === 'company' ? 'the company' : 'the person'} · {l.has_receipt ? 'receipt attached' : 'no receipt'}</div>
                          </div>
                          <Money value={l.amount} currency={rec.claim.currency} className="flex-none text-ink" />
                        </div>
                        {l.flags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{l.flags.map((f) => <span key={f} className="chip warn">{f}</span>)}</div>}
                      </div>
                    ))}
                    {!(rec.claim.lines ?? []).length && <div className="px-3.5 py-3 text-[12.5px] text-muted">This claim has no lines.</div>}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-muted">Approving from the inbox approves every line as claimed. To approve a lower amount on a line, open the full record.</div>
                </div>
              </>
            )}

            {rec?.kind === 'call' && (
              <>
                <Facts rows={[
                  ['Capital call', <span key="n" className="num text-gold">{rec.call.call_no}</span>],
                  ['Fund', rec.fund?.name ?? <span key="f" className="text-muted">Not shown</span>],
                  ['Called', <span key="p"><span className="num">{D(rec.call.pct ?? 0).toString()}%</span> of each commitment</span>],
                  ['Amount', <Money key="a" value={rec.call.total_amount} currency={rec.fund?.currency ?? currency} />],
                  ['Price of a unit', <Money key="u" value={rec.call.unit_price} currency={rec.fund?.currency ?? currency} />],
                  ['Date of the call', <span key="d" className="num">{fmtDate(rec.call.call_date)}</span>],
                  ['Due by', <span key="e" className="num">{fmtDate(rec.call.due_date)}</span>],
                  ['Purpose', rec.call.purpose],
                ]} />
                <Note>Approving a capital call makes the amount owed by the investors. It moves no money and posts nothing: each receipt is recorded when the money arrives, and its entry is approved again before it reaches the books.</Note>
              </>
            )}

            {rec?.kind === 'distribution' && (
              <>
                <Facts rows={[
                  ['Number', <span key="n" className="num text-gold">{rec.dist.dist_no}</span>],
                  ['Kind', humanise(rec.dist.kind)],
                  ['Fund', rec.dist.fund_id ? rec.fund?.name ?? <span key="f" className="text-muted">Not shown</span> : 'None — declared by the company to its shareholders'],
                  ['Declared on', <span key="d" className="num">{fmtDate(rec.dist.declaration_date)}</span>],
                  ['Holders on record on', <span key="r" className="num">{fmtDate(rec.dist.record_date)}</span>],
                  ['Amount', <Money key="a" value={rec.dist.total_amount} currency={currency} />],
                  ['Tax deducted', <span key="t" className="num">{D(rec.dist.tax_pct).toString()}%</span>],
                  ['Paid out of', accountName(rec.dist.source_account_id)],
                ]} />
                <div>
                  <div className="eyebrow mb-2">Who is entitled</div>
                  <div className="rounded-xl border border-line">
                    {(rec.dist.lines ?? []).map((l) => (
                      <div key={l.id} className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                        <div className="min-w-0">
                          <button className="link" onClick={() => onOpen('/parties/' + l.holder_party_id)}>{partyName(l.holder_party_id)}</button>
                          <div className="text-[12px] text-muted"><span className="num">{D(l.units).toString()}</span> held · tax deducted <Money value={l.tax_deducted} currency={currency} /> · net <Money value={l.net_amount} currency={currency} /></div>
                        </div>
                        <Money value={l.gross_amount} currency={currency} className="flex-none text-ink" />
                      </div>
                    ))}
                    {!(rec.dist.lines ?? []).length && <div className="px-3.5 py-3 text-[12.5px] text-muted">Nobody is entitled.</div>}
                  </div>
                </div>
                <Note>Approving proposes the entry that declares the amount as payable. Declaring pays nothing: each payment is recorded separately, and its entry is approved again.</Note>
              </>
            )}

            {rec?.kind === 'purchase' && (
              <>
                <Facts rows={[
                  ['Document', <span key="n" className="num text-gold">{rec.doc.doc_no}</span>],
                  ['Title', rec.doc.title || <span key="t" className="text-muted">None recorded</span>],
                  ['Vendor', rec.doc.party_id ? <button key="v" className="link" onClick={() => onOpen('/parties/' + rec.doc.party_id)}>{partyName(rec.doc.party_id)}</button> : 'Not yet chosen'],
                  ['Date', <span key="d" className="num">{fmtDate(rec.doc.doc_date)}</span>],
                  ['Required by', rec.doc.required_date ? <span key="r" className="num">{fmtDate(rec.doc.required_date)}</span> : '—'],
                  ['Reason', rec.doc.reason || <span key="e" className="text-muted">None recorded</span>],
                  ['Total', <Money key="m" value={rec.doc.total} currency={rec.doc.currency} />],
                ]} />
                <div>
                  <div className="eyebrow mb-2">Lines</div>
                  <div className="rounded-xl border border-line">
                    {(rec.doc.lines ?? []).map((l) => (
                      <div key={l.id} className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                        <div className="min-w-0">
                          <div className="text-ink">{l.description}</div>
                          <div className="text-[12px] text-muted"><span className="num">{D(l.quantity).toString()}</span> {l.unit ?? ''} × <Money value={l.rate} currency={rec.doc.currency} />{l.account_id ? <> · {accountName(l.account_id)}</> : null}</div>
                        </div>
                        <Money value={D(l.amount).plus(l.tax_amount)} currency={rec.doc.currency} className="flex-none text-ink" />
                      </div>
                    ))}
                    {!(rec.doc.lines ?? []).length && <div className="px-3.5 py-3 text-[12.5px] text-muted">This document has no lines.</div>}
                  </div>
                </div>
                {rec.doc.kind === 'purchase_order' && <Note>An approved order is a commitment, not a cost. It reaches the books only through the vendor's bill.</Note>}
              </>
            )}

            {isJournal && detail.error && <ErrorBox message={detail.error} retry={detail.reload} />}
            {isJournal && !j && !detail.error && <Loading rows={5} label="Loading the entry" />}

            {j && j.restricted && (
              <Note kind="warn">{j.message ?? 'This entry is restricted. Your account is not authorised to view its detail.'}</Note>
            )}

            {j && !j.restricted && (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="eyebrow">Before I approve</div>
                    <span className={cx('chip', flagged ? 'warn' : 'pos')}>{flagged ? `${flagged} point${flagged === 1 ? '' : 's'} to look at` : 'No point raised'}</span>
                  </div>
                  <div className="rounded-xl border border-line">
                    {checks.map((c) => (
                      <div key={c.label} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-0">
                        <span className={cx('lamp mt-[6px]', c.ok ? 'pos' : 'warn')} />
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink">{c.label}</div>
                          <div className="break-words text-[12px] text-muted">{c.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-muted">These are facts read from the entry itself. They inform the decision; they do not make it.</div>
                </div>

                <div>
                  <div className="eyebrow mb-2">The entry</div>
                  <div className="rounded-xl border border-line px-3.5">
                    {[
                      ['Voucher', <span key="v" className="num text-gold">{j.voucher_no ?? 'Not yet numbered — numbered when posted'}</span>],
                      ['Type', humanise(j.voucher_type)],
                      ['Date', <span key="d" className="num">{fmtDate(j.journal_date)}</span>],
                      ['Status', <StatusChip key="s" status={j.status} />],
                      ['Maker', j.created_by ? j.people[j.created_by] ?? who(j.created_by) : 'System'],
                      ['Created', <span key="c" className="num">{fmtDateTime(j.created_at)}</span>],
                      ['Narration', j.narration || <span key="n" className="text-muted">None recorded</span>],
                      ['Purpose', j.purpose || <span key="p" className="text-muted">None recorded</span>],
                      ['Origin', humanise(j.origin)],
                      ['Confidentiality', j.confidentiality === 'internal' ? 'Internal' : <span key="x" className="chip gold">{humanise(j.confidentiality)}</span>],
                    ].map(([l, v]) => (
                      <div key={String(l)} className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
                        <span className="flex-none text-muted">{l}</span>
                        <span className="min-w-0 break-words text-right text-ink">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="eyebrow mb-2">Lines</div>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <DataTable columns={lineColumns} rows={j.lines} rowKey={(l) => l.id} pageSize={200}
                      footer={<tr>
                        <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Totals {debit.eq(credit) ? '· balanced' : '· not balanced'}</td>
                        <td className={cx(foot, 'r')}><Money value={debit} currency={currency} className="text-ink" /></td>
                        <td className={cx(foot, 'r')}><Money value={credit} currency={currency} className={debit.eq(credit) ? 'text-ink' : 'text-neg'} /></td>
                      </tr>}
                      empty={{ title: 'This entry has no lines' }} />
                  </div>
                </div>

                <div>
                  <div className="eyebrow mb-2">Decisions so far</div>
                  {j.approvals.length === 0 ? <div className="text-[12.5px] text-muted">No approval decision has been recorded yet.</div> : (
                    <div className="rounded-xl border border-line">
                      {j.approvals.map((a, i) => (
                        <div key={i} className="border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-ink"><span className="num text-muted">Step {a.step}</span> · {humanise(a.action)} · {a.actor ?? 'System'}</span>
                            <span className="num text-[11.5px] text-muted">{fmtDateTime(a.at)}</span>
                          </div>
                          {a.comment && <div className="mt-0.5 text-[12.5px] text-ink2">{a.comment}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="eyebrow mb-2">History</div>
                  {j.history.length === 0 ? <div className="text-[12.5px] text-muted">No history has been recorded.</div> : (
                    <div className="rounded-xl border border-line">
                      {[...j.history].sort((a, b) => b.at.localeCompare(a.at)).map((h, i) => (
                        <div key={i} className="border-b border-line px-3.5 py-2.5 text-[13px] last:border-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-ink">{humanise(h.action)} · <span className="text-ink2">{h.actor ?? 'System'}</span></span>
                            <span className="num text-[11.5px] text-muted">{fmtDateTime(h.at)}</span>
                          </div>
                          {h.reason && <div className="mt-0.5 text-[12.5px] text-ink2">{h.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

      <ReasonDialog open={dialog === 'approve'} title={`Approve this ${noun}`} confirm="Approve" required={claimFlags > 0}
        onCancel={() => setDialog(null)} onConfirm={approve}
        extra={rec?.kind === 'advance' ? (
          <Field label="Amount approved" hint={amountProblem ?? `Requested: ${fmtMoney(rec.advance.requested_amount, { currency: rec.advance.currency })}. A lower amount may be approved.`} className="mt-3">
            <input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        ) : undefined}
        body={request && <>
          You are approving {stepText(request).toLowerCase()}. {request.current_step < request.steps.length ? `After this step the ${noun} passes to the next approver.`
            : other ? (rec?.kind === 'claim' ? 'This is the final step: the claim is approved as claimed and its accounting entry is proposed for approval.' : 'This is the final step. Approval is a decision only: it moves no money and posts nothing.')
            : proposal ? 'This is the final step: once approved, the entry is posted to the books immediately.' : 'This is the final step: once approved, the entry can be posted to the books.'}
          {flagged > 0 && <span className="mt-2 block text-warn">The checklist raised {flagged} point{flagged === 1 ? '' : 's'} on this entry.</span>}
          {claimFlags > 0 && <span className="mt-2 block text-warn">{claimFlags} line{claimFlags === 1 ? ' is' : 's are'} flagged. State why the claim is approved despite the flag{claimFlags === 1 ? '' : 's'}.</span>}
        </>} />
      <ReasonDialog open={dialog === 'reject'} title={`Reject this ${noun}`} confirm="Reject" danger
        onCancel={() => setDialog(null)} onConfirm={reject}
        body={`The ${noun} returns to its maker with your reason. Nothing is deleted: the rejection is kept in its history.`} />
    </>
  )
}
