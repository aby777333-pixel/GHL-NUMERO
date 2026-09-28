import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CircleDot, FolderOpen, Link2, MessageSquarePlus, RotateCcw, Route, UserRound } from 'lucide-react'
import type { NumeroApi } from '@/api/types'
import type { ID } from '@/engine/types'
import type { AttentionClass, Case, CaseEvent, CaseLink, CaseStatus } from '@/engine/p3Types'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, useCompanyName } from '@/ui/ops'
import { AttentionChip, DemoTag, Fact, human, NoAccess } from '@/ui/p3'
import { ATTENTION, CASE_STATUSES, caseKindLabel, caseRight, ENTITY_LABEL, OwnerPicker, Readings, readingsOf, RecordLinks, useWho } from './Reality'

// =====================================================================
// Case 360: one case — what was found, the records it points to, and
// everything people wrote and decided about it, in order.
// The history is only ever added to. A change of status records what
// was found or decided; a case is closed with its resolution.
// The case states facts. What they mean is written by a person.
// =====================================================================

const STATUS_MEANING: Record<CaseStatus, string> = {
  open: 'Opened. Nobody has looked at it yet.',
  triage: 'Being sorted: is it worth a review, and by whom.',
  under_review: 'The records are being read.',
  investigating: 'Being looked into beyond the records: people are asked, things are checked.',
  substantiated: 'What was reported was found to be so.',
  unsubstantiated: 'What was reported was not found to be so.',
  remediated: 'What had to be corrected has been corrected, by the documents of its own area.',
  closed: 'Closed, with its resolution.',
}

const notFound = (e: unknown) => /not found|no rows|0 rows|PGRST116|multiple \(or no\) rows/i.test(e instanceof Error ? e.message : String(e))

export default function Case360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('reality.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="NUMERO Reality · Case" title="Cases" perm="reality.view" back="/reality?tab=cases" />
  return <CaseView key={id} id={id} />
}

type Dialog = 'status' | 'note' | 'owner' | 'attention' | 'link' | null

function CaseView({ id }: { id: ID }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const who = useWho()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [target, setTarget] = useState<CaseStatus | null>(null)

  const main = useAsync(async () => {
    try {
      const c = await api.getCase(id)
      return can('reality.view', c.company_id) ? c : null
    } catch (e) { if (notFound(e)) return null; throw e }
  }, [api, id])
  const c = main.data ?? null

  // a bill opens on the bills screen and an invoice on the invoices screen: the kind is read where the person may read it
  const invoiceIds = (c?.links ?? []).filter((l) => l.entity === 'invoices').map((l) => l.entity_id)
  const companyId = c?.company_id
  const docTypes = useAsync(async () => {
    const m = new Map<ID, string>()
    if (!companyId || !invoiceIds.length || !(can('invoice.view', companyId) || can('bill.view', companyId))) return m
    await Promise.all(invoiceIds.map((x) => api.getInvoice(x).then((i) => { m.set(x, i.doc_type) }).catch(() => undefined)))
    return m
  }, [api, companyId, invoiceIds.join(',')])

  const events = useMemo(() => {
    const all = [...(c?.events ?? [])].sort((a, b) => a.at.localeCompare(b.at) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    // a note written together with a change is carried by the change; it is shown once
    return all.filter((e) => e.event !== 'note' || !all.some((x) => x !== e && x.event !== 'note' && x.at === e.at && x.note === e.note))
  }, [c])
  const reached = useMemo(() => new Set<string>((c?.events ?? []).flatMap((e) => [e.from_status, e.to_status]).filter((s): s is string => !!s)), [c])

  const back = <button className="btn ghost" onClick={() => nav('/reality?tab=cases')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="NUMERO Reality · Case" title="Case" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (main.loading && main.data === undefined) return <div><PageHeader eyebrow="NUMERO Reality · Case" title="Case" actions={back} /><Panel><Loading rows={7} label="Loading the case" /></Panel></div>
  if (!c) {
    return (
      <div>
        <PageHeader eyebrow="NUMERO Reality · Case" title="Case" actions={back} />
        <Panel><Empty icon={<FolderOpen size={20} />} title="Case not found or not shared with you" body="This case does not exist in the companies you can access, or it is classified above your clearance." action={<button className="btn" onClick={() => nav('/reality?tab=cases')}><ArrowLeft size={14} /> Back to the cases</button>} /></Panel>
      </div>
    )
  }

  const manage = can(caseRight(c.kind), c.company_id)
  const noManage = manage ? undefined : `You need the permission ${caseRight(c.kind)} in this company`
  const currency = companies.find((x) => x.id === c.company_id)?.base_currency
  const { readings, differs } = readingsOf(c.finding)
  const hasReadings = Object.keys(readings).length > 0
  const other = Object.entries(c.finding ?? {}).filter(([k, v]) => !(hasReadings && ['differs', 'chain', 'as_at', 'material', 'readings'].includes(k)) && !(k in readings) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v) !== '')
  const asAt = typeof c.finding?.as_at === 'string' ? c.finding.as_at : null
  const owner = c.owner_name || (c.owner_user ? who(c.owner_user) : '')
  const closed = c.status === 'closed'
  const change = (s: CaseStatus | null) => { setTarget(s); setDialog('status') }

  return (
    <div>
      <PageHeader
        eyebrow={`NUMERO Reality · Case · ${caseKindLabel(c.kind)}`}
        title={`${c.case_no} · ${c.title}`}
        subtitle={<>{companyName(c.company_id)} · opened by {who(c.opened_by)} on {fmtDateTime(c.opened_at)}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          <button className="btn" disabled={!manage} title={noManage} onClick={() => setDialog('note')}><MessageSquarePlus size={14} /> Add a note</button>
          <button className="btn primary" disabled={!manage} title={noManage} onClick={() => change(null)}>{closed ? <RotateCcw size={15} /> : <Route size={15} />} {closed ? 'Reopen' : 'Change the status'}</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={c.status} />
        <AttentionChip value={c.attention} />
        <span className="chip">{caseKindLabel(c.kind)}</span>
        {c.confidentiality !== 'internal' && <span className="chip violet">{human(c.confidentiality)}</span>}
        {!owner && !closed && <span className="chip warn">nobody owns this case yet</span>}
      </div>

      {closed && <Note kind="good" className="mb-4"><span className="font-medium text-ink">Closed by {who(c.closed_by)} on {fmtDateTime(c.closed_at)}.</span> {c.resolution ?? 'No resolution is recorded.'}</Note>}

      <Section title="The path of the case" className="mb-4">
        <Panel className="p-4" lit={false}>
          <div className="flex flex-wrap items-stretch gap-x-1.5 gap-y-2">
            {CASE_STATUSES.map((s, i) => {
              const now = s === c.status
              const was = !now && reached.has(s)
              return (
                <div key={s} className="flex items-center gap-1.5">
                  {i > 0 && <ArrowRight size={13} className="flex-none text-muted" />}
                  <button disabled={!manage || now} title={now ? `The case is here. ${STATUS_MEANING[s]}` : manage ? `${STATUS_MEANING[s]} Choose to move the case here.` : STATUS_MEANING[s]} onClick={() => change(s)}
                    className={cx('flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] transition-colors', now ? 'border-gold bg-goldsoft font-medium text-ink' : was ? 'border-line2 bg-surface2 text-ink2' : 'border-line text-muted', manage && !now && 'hover:border-line2 hover:text-ink')}>
                    {now ? <CircleDot size={13} className="text-gold" /> : was ? <Check size={13} className="text-pos" /> : null}
                    {human(s)}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-[11.5px] text-muted"><span className="text-ink2">{human(c.status)}.</span> {STATUS_MEANING[c.status]} A case does not have to pass through every step: substantiated and unsubstantiated are the two outcomes of looking into it, and a case takes one of them. Every change records what was found or decided.</div>
        </Panel>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="What was found">
            <Panel className="p-4 text-[13px] leading-relaxed text-ink2" lit={false}>{c.summary ?? 'Nothing was written when the case was opened.'}</Panel>
          </Section>

          {hasReadings && (
            <Section title="The difference it was opened on" right={asAt ? <span className="text-[11.5px] text-muted">dated {fmtDate(asAt)}</span> : undefined}>
              <Panel className="p-4" lit={false}>
                <Readings readings={readings} differs={differs} currency={currency} columns={3} />
                <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted">These are the readings as the records stood when the case was opened on {fmtDate(c.opened_at.slice(0, 10))}. They are kept as they were. How the records stand today is on the <button className="link" onClick={() => nav('/reality?tab=differences')}>differences screen</button>.</div>
              </Panel>
            </Section>
          )}
          {other.length > 0 && (
            <Section title={hasReadings ? 'Recorded with the difference' : 'What the case was opened on'}>
              <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
                {other.map(([k, v]) => <Fact key={k} label={human(k).replace(/^./, (x) => x.toUpperCase())} className={String(v).length > 60 ? 'sm:col-span-2' : undefined}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : <span className={typeof v === 'number' || /^-?[\d.]+$/.test(String(v)) ? 'num' : undefined}>{String(v)}</span>}</Fact>)}
              </Panel>
            </Section>
          )}

          <Section title="History of the case" right={<span className="text-[11.5px] text-muted">{events.length} entr{events.length === 1 ? 'y' : 'ies'} · only ever added to</span>}>
            <Panel className="p-4" lit={false}>
              {events.length === 0 ? <div className="text-[12.5px] text-muted">No history is recorded.</div> : (
                <ol className="m-0 list-none space-y-0 p-0">
                  {events.map((e, i) => <Entry key={String(e.id)} e={e} last={i === events.length - 1} who={who} />)}
                </ol>
              )}
              <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted">Nothing in this history can be edited or removed. A correction is a new entry.</div>
            </Panel>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Amount at stake">{c.amount === null ? 'Not stated' : <Money value={c.amount} currency={currency} />}</Fact>
              <Fact label="Company">{companyName(c.company_id)}</Fact>
              <Fact label="Owner">
                {owner || <span className="text-warn">Nobody yet</span>}
                <div><button className="link text-[12px]" disabled={!manage} title={noManage} onClick={() => setDialog('owner')}><UserRound size={11} className="mr-1 inline" />Change the owner</button></div>
              </Fact>
              <Fact label="Who is expected to attend to it">
                <AttentionChip value={c.attention} />
                <div><button className="link text-[12px]" disabled={!manage} title={noManage} onClick={() => setDialog('attention')}>Change the class</button></div>
              </Fact>
              <Fact label="Opened"><span className="num">{fmtDateTime(c.opened_at)}</span> · {who(c.opened_by)}</Fact>
              <Fact label="Closed">{c.closed_at ? <><span className="num">{fmtDateTime(c.closed_at)}</span> · {who(c.closed_by)}</> : 'Not closed'}</Fact>
              <Fact label="Confidentiality">{human(c.confidentiality)}</Fact>
              <Fact label="Raised from an alert">{c.alert_id ? <button className="link" onClick={() => nav('/sentinel')}>Open the alerts</button> : 'No'}</Fact>
              {c.resolution && <Fact label="Resolution" className="sm:col-span-2">{c.resolution}</Fact>}
              {c.dedupe_key && <Fact label="The difference it stands for" className="sm:col-span-2"><span className="num break-all text-[12px] text-ink2">{c.dedupe_key}</span><div className="text-[11.5px] text-muted">The same difference, found again, comes back to this case instead of opening another.</div></Fact>}
            </Panel>
          </Section>

          <Section title="Linked records" right={<button className="btn sm" disabled={!manage} title={noManage} onClick={() => setDialog('link')}><Link2 size={13} /> Add a link</button>}>
            <Panel className="p-1.5" lit={false}><RecordLinks links={c.links} docTypes={docTypes.data} empty="No record is linked to this case yet." /></Panel>
          </Section>

          <Attachments companyId={c.company_id} entity="cases" entityId={c.id} readOnly={!manage} />
        </div>
      </div>

      <StatusDialog open={dialog === 'status'} c={c} target={target} onClose={() => setDialog(null)} />
      <NoteDialog open={dialog === 'note'} c={c} onClose={() => setDialog(null)} />
      <OwnerDialog open={dialog === 'owner'} c={c} onClose={() => setDialog(null)} />
      <AttentionDialog open={dialog === 'attention'} c={c} onClose={() => setDialog(null)} />
      <LinkDialog open={dialog === 'link'} c={c} onClose={() => setDialog(null)} />
    </div>
  )
}

// ------------------------------------------------------------------ history
function Entry({ e, last, who }: { e: CaseEvent; last: boolean; who: (id: ID | null | undefined) => string }) {
  const d = e.detail ?? {}
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const what = e.event === 'opened' ? 'Case opened'
    : e.event === 'status' ? `Status changed from ${human(e.from_status)} to ${human(e.to_status)}`
    : e.event === 'reopened' ? `Reopened — from ${human(e.from_status)} to ${human(e.to_status)}`
    : e.event === 'note' ? 'Note'
    : e.event === 'owner' ? `Owner changed to ${text(d.owner_name) ?? (text(d.owner_user) ? who(text(d.owner_user)) : 'nobody')}`
    : e.event === 'attention' ? `Attention changed from ${human(text(d.from))} to ${human(text(d.to))}`
    : `Record linked: ${ENTITY_LABEL[text(d.entity) ?? ''] ?? human(text(d.entity))}${text(d.label) ? ' · ' + text(d.label) : ''}`
  const tone = e.event === 'opened' ? 'gold' : e.event === 'status' ? (e.to_status === 'closed' ? 'pos' : 'cyan') : e.event === 'reopened' ? 'warn' : ''
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[3px] top-[14px] w-px bg-line" aria-hidden="true" />}
      <span className={cx('lamp relative mt-[6px]', tone)} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">{what}</div>
        <div className="text-[11.5px] text-muted">{e.actor ? who(e.actor) : 'System'} · {fmtDateTime(e.at)}</div>
        {e.note && <div className="mt-1.5 whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink2">{e.note}</div>}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ actions
type Props = { open: boolean; c: Case; onClose: () => void }

function StatusDialog({ open, c, target, onClose }: Props & { target: CaseStatus | null }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [status, setStatus] = useState<CaseStatus | ''>('')
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState('')
  useEffect(() => { if (open) { setStatus(target ?? ''); setNote(''); setResolution(c.resolution ?? '') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const reopening = c.status === 'closed'
  const problem = !status ? 'Choose the status.' : !note.trim() ? 'Record what was found or decided.' : status === 'closed' && !resolution.trim() ? 'A case is closed with its resolution.' : null
  const submit = () => { if (status) void act(() => api.updateCase({ id: c.id, status, note: note.trim(), ...(status === 'closed' ? { resolution: resolution.trim() } : {}) }).then(() => true), status === 'closed' ? 'Case closed' : reopening ? 'Case reopened' : 'Status changed').then((ok) => { if (ok) onClose() }) }
  return (
    <Modal open={open} onClose={onClose} title={reopening ? 'Reopen the case' : 'Change the status'} subtitle={`${c.case_no} · now ${human(c.status)}`} width={560}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <Route size={15} />} {status === 'closed' ? 'Close the case' : reopening ? 'Reopen' : 'Record the change'}</button></>}>
      <div className="space-y-4">
        {reopening && <Note kind="warn">This case is closed. Moving it to another status reopens it. The closing and its resolution stay in the history.</Note>}
        <Field label="New status" hint={status ? STATUS_MEANING[status] : undefined}>
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}><option value="">Choose…</option>{CASE_STATUSES.filter((s) => s !== c.status).map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
        </Field>
        <Field label="What was found or decided (required)" hint="Facts and decisions. This is written to the history of the case and cannot be edited afterwards.">
          <textarea className="field" rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        {status === 'closed' && (
          <Field label="Resolution (required to close)" hint="How the matter ended: what it turned out to be, and what was done about it.">
            <textarea className="field" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
        )}
        {(status === 'remediated' || status === 'closed') && <div className="text-[11.5px] text-muted">Changing the status corrects nothing in the books. A correction is made by the documents of its own area — a credit note, a reversal, a stock adjustment, an asset disposal — and approved there.</div>}
        {problem && (note || status) && <div className="text-[12px] text-warn">{problem}</div>}
      </div>
    </Modal>
  )
}

function NoteDialog({ open, c, onClose }: Props) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [note, setNote] = useState('')
  useEffect(() => { if (open) setNote('') }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Add a note" subtitle={`${c.case_no} · ${c.title}`} width={540}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!note.trim() || busy} onClick={() => void act(() => api.updateCase({ id: c.id, note: note.trim() }).then(() => true), 'Note added').then((ok) => { if (ok) onClose() })}>{busy ? <Spinner /> : <MessageSquarePlus size={15} />} Add the note</button></>}>
      <Field label="Note" hint="Written to the history of the case under your name. It cannot be edited or removed afterwards.">
        <textarea className="field" rows={5} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}

function OwnerDialog({ open, c, onClose }: Props) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [owner, setOwner] = useState<{ user: ID | null; name: string }>({ user: null, name: '' })
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setOwner({ user: c.owner_user, name: c.owner_name ?? '' }); setNote('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = owner.name.trim()
  const same = owner.user === c.owner_user && name === (c.owner_name ?? '')
  return (
    <Modal open={open} onClose={onClose} title="Change the owner" subtitle={`${c.case_no} · now ${c.owner_name || 'nobody'}`} width={560}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={same || busy} title={same ? 'The owner is unchanged' : undefined}
        onClick={() => void act(() => api.updateCase({ id: c.id, owner_user: owner.user, owner_name: name || null, ...(note.trim() ? { note: note.trim() } : {}) }).then(() => true), name ? 'Owner changed' : 'The case has no owner now').then((ok) => { if (ok) onClose() })}>{busy ? <Spinner /> : <UserRound size={15} />} Record</button></>}>
      <div className="space-y-4">
        <div><span className="label">Owner</span><OwnerPicker companyId={c.company_id} userId={owner.user} name={owner.name} onChange={(user, n) => setOwner({ user, name: n })} /></div>
        <div className="text-[11.5px] text-muted">Choose a person of the team, or type the name of somebody who does not use NUMERO. Leave both empty to record that nobody owns the case.</div>
        <Field label="Why (optional)"><textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function AttentionDialog({ open, c, onClose }: Props) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [value, setValue] = useState<AttentionClass>(c.attention)
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setValue(c.attention); setNote('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Change who attends to it" subtitle={`${c.case_no} · now ${human(c.attention)}`} width={520}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={value === c.attention || busy} title={value === c.attention ? 'The class is unchanged' : undefined}
        onClick={() => void act(() => api.updateCase({ id: c.id, attention: value, ...(note.trim() ? { note: note.trim() } : {}) }).then(() => true), 'Class of attention changed').then((ok) => { if (ok) onClose() })}>{busy ? <Spinner /> : null} Record</button></>}>
      <div className="space-y-4">
        <Field label="Class of attention"><select className="field" value={value} onChange={(e) => setValue(e.target.value as AttentionClass)}>{ATTENTION.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
        <Field label="Why (optional)"><textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ linking a record
interface Choice { id: ID; label: string }
interface LinkKind { entity: string; perm: string[]; /** the list is asked for with the text typed, instead of being filtered here */ search?: boolean; load: (api: NumeroApi, companyId: ID, find: string) => Promise<Choice[]> }
const LINK_KINDS: LinkKind[] = [
  { entity: 'invoices', perm: ['invoice.view', 'bill.view'], load: async (api, c) => (await api.listInvoices({ companyIds: [c] })).map((i) => ({ id: i.id, label: `${i.doc_no ?? 'No number yet'} · ${human(i.doc_type)} · ${fmtDate(i.doc_date)}` })) },
  { entity: 'purchase_docs', perm: ['purchase.view'], load: async (api, c) => (await api.listPurchaseDocs({ companyIds: [c] })).map((d) => ({ id: d.id, label: `${d.doc_no} · ${human(d.kind)} · ${fmtDate(d.doc_date)}` })) },
  { entity: 'advances', perm: ['expense.view', 'expense.approve'], load: async (api, c) => (await api.listAdvances({ companyIds: [c] })).map((a) => ({ id: a.id, label: `${a.advance_no} · ${a.purpose}` })) },
  { entity: 'expense_claims', perm: ['expense.view', 'expense.approve'], load: async (api, c) => (await api.listClaims({ companyIds: [c] })).map((x) => ({ id: x.id, label: `${x.claim_no} · ${x.title}` })) },
  { entity: 'fixed_assets', perm: ['asset.view'], load: async (api, c) => (await api.listAssets([c])).map((a) => ({ id: a.id, label: `${a.asset_no} · ${a.name}` })) },
  { entity: 'journals', perm: ['journal.view'], search: true, load: async (api, c, find) => (await api.listJournals({ companyIds: [c], q: find || undefined, limit: 60 })).rows.map((j) => ({ id: j.id, label: `${j.voucher_no ?? 'No number yet'} · ${fmtDate(j.journal_date)} · ${j.status}${j.narration ? ' · ' + j.narration.slice(0, 60) : ''}` })) },
  { entity: 'stock_docs', perm: ['inventory.view'], load: async (api, c) => (await api.listStockDocs({ companyIds: [c] })).map((d) => ({ id: d.id, label: `${d.doc_no} · ${human(d.kind)} · ${fmtDate(d.doc_date)}` })) },
  { entity: 'inv_items', perm: ['inventory.view'], load: async (api, c) => (await api.listInvItems([c])).map((i) => ({ id: i.id, label: `${i.sku} · ${i.name}` })) },
  { entity: 'bank_accounts', perm: ['bank.view'], load: async (api, c) => (await api.listBankAccounts([c])).map((b) => ({ id: b.id, label: `${b.name}${b.account_no_masked ? ' · ' + b.account_no_masked : ''}` })) },
  { entity: 'cash_boxes', perm: ['treasury.view'], load: async (api, c) => (await api.listCashBoxes([c])).map((b) => ({ id: b.id, label: b.name })) },
  { entity: 'loans', perm: ['treasury.view'], load: async (api, c) => (await api.listLoans([c])).map((l) => ({ id: l.id, label: `${l.loan_no} · ${l.name}` })) },
  { entity: 'verification_runs', perm: ['reality.view'], load: async (api, c) => (await api.listVerifications([c])).map((r) => ({ id: r.id, label: `${r.verify_no} · ${human(r.subject)} · ${fmtDate(r.run_date)}` })) },
  { entity: 'confirmations', perm: ['reality.view'], load: async (api, c) => (await api.listConfirmations([c])).map((x) => ({ id: x.id, label: `${x.confirm_no} · ${x.label} · as at ${fmtDate(x.as_of)}` })) },
]
const SHOWN = 150

function LinkDialog({ open, c, onClose }: Props) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const accounts = useApp((s) => s.accounts)
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const [entity, setEntity] = useState('invoices')
  const [find, setFind] = useState('')
  const [asked, setAsked] = useState('')
  const [pick, setPick] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setEntity('invoices'); setFind(''); setAsked(''); setPick(''); setNote('') } }, [open])
  // the text typed is sent to the list of entries only when the person stops typing
  useEffect(() => { const t = setTimeout(() => setAsked(find.trim()), 350); return () => clearTimeout(t) }, [find])

  const kind = LINK_KINDS.find((k) => k.entity === entity)
  const need = kind && !kind.perm.some((p) => can(p, c.company_id)) ? kind.perm.join(' or ') : null
  const list = useAsync<Choice[]>(async () => {
    if (!open) return []
    if (entity === 'parties') return parties.map((p) => ({ id: p.id, label: `${p.display_name} · ${p.party_no}` }))
    if (entity === 'accounts') return accounts.filter((a) => a.company_id === c.company_id && !a.is_group).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))
    if (!kind || need) return []
    return kind.load(api, c.company_id, kind.search ? asked : '')
  }, [api, open, entity, c.company_id, need, kind?.search ? asked : ''])

  const text = find.trim().toLowerCase()
  const linked = (id: ID) => c.links.some((l) => l.entity === entity && l.entity_id === id)
  const matches = (list.data ?? []).filter((o) => kind?.search || !text || o.label.toLowerCase().includes(text) || o.id === pick)
  const options = matches.slice(0, SHOWN)
  const chosen = (list.data ?? []).find((o) => o.id === pick)
  const problem = need ? `Your role does not include ${need} in this company.` : !pick ? 'Choose the record.' : linked(pick) ? 'This record is already linked to the case.' : null
  const submit = () => {
    if (!chosen) return
    const link: CaseLink = { entity, entity_id: chosen.id, label: chosen.label.split(' · ').slice(0, ['fixed_assets', 'inv_items', 'loans', 'accounts'].includes(entity) ? 2 : 1).join(' · ') }
    void act(() => api.updateCase({ id: c.id, add_links: [link], ...(note.trim() ? { note: note.trim() } : {}) }).then(() => true), 'Record linked').then((ok) => { if (ok) onClose() })
  }
  const kinds = [...LINK_KINDS.map((k) => k.entity), 'parties', 'accounts'].sort((a, b) => (ENTITY_LABEL[a] ?? a).localeCompare(ENTITY_LABEL[b] ?? b))

  return (
    <Modal open={open} onClose={onClose} title="Add a link" subtitle={`${c.case_no} · a record of ${companyName(c.company_id)} that belongs to this case`} width={600}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={submit}>{busy ? <Spinner /> : <Link2 size={15} />} Link the record</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of record"><select className="field" value={entity} onChange={(e) => { setEntity(e.target.value); setPick(''); setFind('') }}>{kinds.map((k) => <option key={k} value={k}>{ENTITY_LABEL[k] ?? human(k)}</option>)}</select></Field>
        <Field label="Find" hint={kind?.search ? 'Searches the accounting entries by number and narration.' : undefined}><input className="field" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type part of the number or the name" /></Field>
        <Field label="Record" className="sm:col-span-2"
          hint={need ? undefined : list.loading ? 'Loading…' : list.error ? `The list could not be read: ${list.error}` : matches.length > SHOWN ? `${matches.length} records match; the first ${SHOWN} are listed. Type to narrow.` : kind?.search && (list.data ?? []).length >= 60 ? 'The first 60 entries that match are listed. Type to narrow.' : matches.length === 0 ? 'No record of this kind matches, or none is shared with you.' : undefined}>
          <select className="field" value={pick} disabled={!!need} onChange={(e) => setPick(e.target.value)}><option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id} disabled={linked(o.id)}>{o.label}{linked(o.id) ? ' — already linked' : ''}</option>)}</select>
        </Field>
        <Field label="Why it belongs to the case (optional)" className="sm:col-span-2"><textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {need && <div className="mt-3 rounded-lg bg-warnsoft px-3 py-2 text-[12px] text-ink2">Your role does not include <span className="num">{need}</span> in this company, so records of this kind cannot be read or linked by you. An empty list here does not mean there are none.</div>}
      <div className="mt-3 text-[11.5px] text-muted">A link can be added; it cannot be taken away. Linking a record changes nothing in the record.</div>
      {problem && pick && !need && <div className="mt-2 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}
