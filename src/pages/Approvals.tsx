import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, ChevronDown, ChevronRight, ExternalLink, Inbox, Send, ShieldCheck, X } from 'lucide-react'
import type { ApprovalRequest, ApprovalRule, ID, JournalDetail, JournalLineView, Member } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, fmtMoney, ZERO } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

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
    { key: 'entity', header: 'Record', render: (r) => <span className="chip">{humanise(r.entity)}</span>, sort: (r) => r.entity, csv: (r) => r.entity },
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
    { key: 'entity', header: 'Applies to', render: (r) => <span className="chip">{humanise(r.entity)}</span>, sort: (r) => r.entity },
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
        subtitle={<>Everything waiting for a decision in the selected compan{ids.length === 1 ? 'y' : 'ies'}. Nothing reaches the books until it has been approved and posted.</>}
        actions={d && count('pending') > 0 ? <span className="chip warn"><span className="num">{count('pending')}</span> pending · <Money value={pendingTotal} compact /></span> : undefined}
      />

      <Note className="mb-4">
        <strong className="text-ink">Maker-checker.</strong> The person who created an entry cannot approve it, unless the Owner has explicitly enabled Owner self-approval. The engine enforces this on every approval; a refused approval is explained on screen.
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
            right={<button className="btn sm ghost" onClick={() => setRulesOpen((o) => !o)} aria-expanded={rulesOpen}>{rulesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {rulesOpen ? 'Hide' : 'Show'} {d.rules.length} rule{d.rules.length === 1 ? '' : 's'}</button>}>
            {rulesOpen ? (
              <Panel lit={false}>
                <DataTable columns={ruleColumns} rows={d.rules} rowKey={(r) => r.id} initialSort={{ key: 'range', dir: 'asc' }}
                  empty={{ title: 'No approval rule is configured', body: 'Without a rule, a submitted entry needs one approval from any authorised approver.', icon: <ShieldCheck size={20} /> }} />
              </Panel>
            ) : (
              <div className="text-[12.5px] text-muted">Rules decide how many approval steps an entry needs, by amount. When no rule matches, one approval from any authorised approver is required.</div>
            )}
          </Section>
        </>
      )}

      <RequestDrawer request={selected} onClose={() => setSelId(null)} who={who} onOpen={(to) => nav(to)} />
    </div>
  )
}

interface Check { ok: boolean; label: string; detail: string }

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
  useApp((s) => s.session)
  const { act, busy } = useAction()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [approvedNow, setApprovedNow] = useState<ID | null>(null)

  const isJournal = request?.entity === 'journal'
  const journalId = isJournal && request ? request.entity_id : null
  const detail = useAsync(async () => (journalId ? api.openJournal(journalId) : null), [api, journalId])
  const j = detail.data && detail.data.id === journalId ? detail.data : null

  const company = request ? companies.find((c) => c.id === request.company_id) : undefined
  const currency = company?.base_currency ?? 'INR'
  const mayApprove = !!request && can('journal.approve', request.company_id)
  const mayReject = !!request && can('journal.reject', request.company_id)
  const mayPost = !!request && can('journal.post', request.company_id)
  const pending = request?.status === 'pending'
  const readyToPost = !!journalId && (j ? j.status === 'approved' : approvedNow === journalId)

  const approve = async (comment: string) => {
    if (!journalId) return
    setDialog(null)
    const r = await act(() => api.approveJournal(journalId, comment || undefined), (v) => (v === 'approved' ? 'Approved — the entry is ready to be posted' : 'Step approved — passed to the next approver'))
    if (r === 'approved') setApprovedNow(journalId)
  }
  const reject = async (reason: string) => {
    if (!journalId) return
    setDialog(null)
    await act(() => api.rejectJournal(journalId, reason), 'Entry rejected and returned to its maker')
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
        </div>
      ),
    },
    { key: 'debit', header: 'Debit', align: 'right', render: (l) => (D(l.debit).isZero() ? <span className="text-muted">—</span> : <Money value={l.debit} currency={currency} />) },
    { key: 'credit', header: 'Credit', align: 'right', render: (l) => (D(l.credit).isZero() ? <span className="text-muted">—</span> : <Money value={l.credit} currency={currency} />) },
  ]

  const approveWhy = !isJournal ? 'This kind of record is approved from its own screen.' : !pending ? `This request is ${request?.status}.` : !mayApprove ? 'Your role does not include the permission to approve journals (journal.approve) in this company.' : 'Approve this step'
  const rejectWhy = !isJournal ? 'This kind of record is decided from its own screen.' : !pending ? `This request is ${request?.status}.` : !mayReject ? 'Your role does not include the permission to reject journals (journal.reject) in this company.' : 'Reject and return to the maker'

  return (
    <>
      <Drawer open={!!request} onClose={onClose} width={680}
        title={request ? request.summary || `${humanise(request.entity)} awaiting approval` : ''}
        subtitle={request && <span className="flex flex-wrap items-center gap-2"><span>{company?.name ?? 'Company'}</span><span>·</span><StatusChip status={request.status} /><span>·</span><span>{stepText(request)}</span></span>}
        footer={request && <>
          {journalId && <button className="btn ghost" onClick={() => onOpen('/journals/' + journalId)}><ExternalLink size={14} /> Open full record</button>}
          {readyToPost && (
            <button className="btn good" onClick={post} disabled={busy || !mayPost} title={mayPost ? 'Post this approved entry to the books' : 'Your role does not include the permission to post journals (journal.post) in this company.'}><Send size={14} /> Post now</button>
          )}
          {pending && <>
            <button className="btn danger" onClick={() => setDialog('reject')} disabled={busy || !isJournal || !mayReject} title={rejectWhy}><X size={14} /> Reject</button>
            <button className="btn primary" onClick={() => setDialog('approve')} disabled={busy || !isJournal || !mayApprove} title={approveWhy}><BadgeCheck size={14} /> Approve</button>
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

            {!isJournal && <Note>The detail of a {humanise(request.entity)} request is shown on its own record. Approval from this inbox is available for journals.</Note>}

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

      <ReasonDialog open={dialog === 'approve'} title="Approve this entry" confirm="Approve" required={false}
        onCancel={() => setDialog(null)} onConfirm={approve}
        body={request && <>
          You are approving {stepText(request).toLowerCase()}. {request.current_step >= request.steps.length ? 'This is the final step: once approved, the entry can be posted to the books.' : 'After this step the entry passes to the next approver.'}
          {flagged > 0 && <span className="mt-2 block text-warn">The checklist raised {flagged} point{flagged === 1 ? '' : 's'} on this entry.</span>}
        </>} />
      <ReasonDialog open={dialog === 'reject'} title="Reject this entry" confirm="Reject" danger
        onCancel={() => setDialog(null)} onConfirm={reject}
        body="The entry returns to its maker with your reason. Nothing is deleted: the rejection is kept in the entry's history." />
    </>
  )
}
