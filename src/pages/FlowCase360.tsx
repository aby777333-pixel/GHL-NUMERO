import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Check, CheckCircle2, ExternalLink, FileText, Hourglass, Lock, Search, SkipForward, Workflow } from 'lucide-react'
import type { NumeroApi } from '@/api/types'
import type { ID, Num } from '@/engine/types'
import type { FlowCase, FlowCaseStep, FlowDef, FlowFieldDef, FlowLink } from '@/engine/p3Types'
import { can, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { D } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Fact, History, NoAccess, Tile, human } from '@/ui/p3'
import { Meter } from '@/ui/charts'
import { ActionChip, ActionNode, INTENT_NOTE, Refusal, actionMeta, activeStepOf, daysText, docKindName, linkMeta, plural, triggerLabel, triggerWorks, useRefusing, waitingSince } from './Studio'

// =====================================================================
// Case 360 of the Scenario Studio (spec 1772, 1820, 1729): one case,
// step by step. Completing a step records that it was done and by whom.
// It posts nothing and moves no money: a step that releases money or
// recognises cost points to the record that does so.
// =====================================================================

// ------------------------------------------------------------------ the records a step can point to
interface RecordPick { id: ID; no: string; title: string; party_id: ID | null; amount: Num | null; measure: string; currency: string | null; date: string | null; status: string; caution: string | null; route: string }
interface RecordList { rows: RecordPick[]; more: number }
type RecordState = RecordList | { denied: true } | { error: string }

/** where a record of each kind is opened, and where one is recorded when none exists yet */
const ROUTES: Record<FlowLink, { open: (id: ID) => string; list: string }> = {
  advances: { open: (id) => '/expenses/advances/' + id, list: '/expenses?tab=advances' },
  expense_claims: { open: (id) => '/expenses/claims/' + id, list: '/expenses' },
  purchase_docs: { open: (id) => '/purchasing/' + id, list: '/purchasing' },
  register_items: { open: (id) => '/registers/' + id, list: '/registers' },
  journals: { open: (id) => '/journals/' + id, list: '/journals' },
  fund_transfers: { open: () => '/cash?tab=transfers', list: '/cash?tab=transfers' },
  invoices: { open: (id) => '/invoices/' + id, list: '/invoices' },
  payments: { open: () => '/payments', list: '/payments' },
  fixed_assets: { open: (id) => '/assets/' + id, list: '/assets' },
  loans: { open: (id) => '/treasury/loans/' + id, list: '/treasury?tab=loans' },
  stock_docs: { open: (id) => '/inventory/docs/' + id, list: '/inventory?tab=documents' },
  cases: { open: (id) => '/reality/cases/' + id, list: '/reality?tab=cases' },
}
const routeOf = (kind: string, id: ID) => (ROUTES as Record<string, { open: (id: ID) => string }>)[kind]?.open(id) ?? null
const mayRead = (kind: string, companyId: ID) => linkMeta(kind).perms.some((p) => can(p, companyId))
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null)
const JOURNAL_LIMIT = 500

/**
 * The records of one kind in one company, reduced to what a person needs to recognise one.
 * `caution` states how the record stands where that matters to the step: a fact, not a verdict.
 */
async function loadRecords(api: NumeroApi, kind: FlowLink, companyId: ID, q = ''): Promise<RecordList> {
  const ids = [companyId]
  switch (kind) {
    case 'advances':
      return { more: 0, rows: (await api.listAdvances({ companyIds: ids })).map((a) => ({ id: a.id, no: a.advance_no, title: a.purpose, party_id: a.recipient_party_id, amount: a.released_amount, measure: 'released', currency: a.currency, date: a.released_on ?? day(a.created_at), status: a.status, caution: D(a.released_amount).gt(0) ? null : 'No money has been released on this advance.', route: ROUTES.advances.open(a.id) })) }
    case 'expense_claims':
      return { more: 0, rows: (await api.listClaims({ companyIds: ids })).map((c) => ({ id: c.id, no: c.claim_no, title: c.title, party_id: c.claimant_party_id, amount: c.total, measure: 'claimed', currency: c.currency, date: c.paid_on ?? day(c.created_at), status: c.status, caution: ['posted', 'paid'].includes(c.status) ? null : `This claim is ${human(c.status)}: its cost has not reached the ledger.`, route: ROUTES.expense_claims.open(c.id) })) }
    case 'purchase_docs':
      return { more: 0, rows: (await api.listPurchaseDocs({ companyIds: ids })).map((p) => ({ id: p.id, no: p.doc_no, title: `${human(p.kind)}${p.title ? ' · ' + p.title : ''}`, party_id: p.party_id, amount: p.total, measure: 'total', currency: p.currency, date: p.doc_date, status: p.status, caution: null, route: ROUTES.purchase_docs.open(p.id) })) }
    case 'register_items':
      return { more: 0, rows: (await api.listRegisterItems({ companyIds: ids })).map((r) => ({ id: r.id, no: r.ref_no, title: `${r.title} · ${human(r.kind)}`, party_id: r.party_id, amount: r.amount, measure: human(r.frequency) || 'amount', currency: r.currency, date: r.start_date, status: r.status, caution: null, route: ROUTES.register_items.open(r.id) })) }
    case 'journals': {
      const r = await api.listJournals({ companyIds: ids, limit: JOURNAL_LIMIT, q: q.trim() || undefined })
      return {
        more: Math.max(0, r.total - r.rows.length),
        rows: r.rows.map((j) => ({ id: j.id, no: j.voucher_no ?? 'not numbered', title: j.narration ?? human(j.voucher_type), party_id: null, amount: j.total, measure: 'total', currency: null, date: j.journal_date, status: j.status, caution: j.status === 'posted' ? null : j.status === 'reversed' ? 'This entry was posted and later reversed.' : `This entry is ${human(j.status)}: it has not reached the ledger.`, route: ROUTES.journals.open(j.id) })),
      }
    }
    case 'fund_transfers':
      return { more: 0, rows: (await api.listFundTransfers(ids)).map((t) => ({ id: t.id, no: t.transfer_no, title: t.purpose, party_id: null, amount: t.amount, measure: 'transferred', currency: null, date: t.transfer_date, status: t.status, caution: t.status === 'posted' ? null : t.status === 'proposed' ? 'This transfer awaits approval: nothing has reached the ledger.' : `This transfer is ${human(t.status)}.`, route: ROUTES.fund_transfers.open(t.id) })) }
    case 'invoices': {
      const types = [...(can('invoice.view', companyId) ? (['sales_invoice', 'credit_note'] as const) : []), ...(can('bill.view', companyId) ? (['purchase_bill', 'debit_note'] as const) : [])]
      const rows = await api.listInvoices({ companyIds: ids, docTypes: [...types] })
      return { more: 0, rows: rows.map((i) => ({ id: i.id, no: i.doc_no ?? 'not numbered', title: `${human(i.doc_type)}${i.reference ? ' · ' + i.reference : ''}`, party_id: i.party_id, amount: i.total, measure: 'total', currency: i.currency, date: i.doc_date, status: i.status, caution: i.status === 'draft' ? 'This document is a draft: nothing has reached the ledger.' : null, route: (i.doc_type === 'sales_invoice' || i.doc_type === 'credit_note' ? '/invoices/' : '/bills/') + i.id })) }
    }
    case 'payments':
      return { more: 0, rows: (await api.listPayments({ companyIds: ids })).map((p) => ({ id: p.id, no: p.pay_no ?? 'not numbered', title: `${p.direction === 'in' ? 'Receipt' : 'Payment'} · ${p.method}${p.reference ? ' · ' + p.reference : ''}`, party_id: p.party_id, amount: p.amount, measure: p.direction === 'in' ? 'received' : 'paid', currency: p.currency, date: p.pay_date, status: p.status, caution: p.status === 'posted' ? null : `This ${p.direction === 'in' ? 'receipt' : 'payment'} is ${human(p.status)}: nothing has reached the ledger.`, route: ROUTES.payments.open(p.id) })) }
    case 'fixed_assets':
      return { more: 0, rows: (await api.listAssets(ids)).map((a) => ({ id: a.id, no: a.asset_no, title: a.name, party_id: a.vendor_party_id, amount: a.cost, measure: 'cost', currency: null, date: a.acquisition_date, status: a.status, caution: null, route: ROUTES.fixed_assets.open(a.id) })) }
    case 'loans':
      return { more: 0, rows: (await api.listLoans(ids)).map((l) => ({ id: l.id, no: l.loan_no, title: l.name, party_id: l.party_id, amount: l.principal, measure: 'principal', currency: l.currency, date: l.start_date, status: l.status, caution: l.status === 'draft' ? 'This loan is a draft: nothing has been disbursed.' : null, route: ROUTES.loans.open(l.id) })) }
    case 'stock_docs':
      return { more: 0, rows: (await api.listStockDocs({ companyIds: ids })).map((s) => ({ id: s.id, no: s.doc_no, title: `${human(s.kind)}${s.reason ? ' · ' + s.reason : ''}`, party_id: s.party_id, amount: s.total_value, measure: 'value', currency: null, date: s.doc_date, status: s.status, caution: s.status === 'posted' ? null : `This stock document is ${human(s.status)}: nothing has reached the ledger.`, route: ROUTES.stock_docs.open(s.id) })) }
    case 'cases':
      return { more: 0, rows: (await api.listCases({ companyIds: ids })).map((c) => ({ id: c.id, no: c.case_no, title: c.title, party_id: null, amount: c.amount, measure: 'at stake', currency: null, date: day(c.opened_at), status: c.status, caution: null, route: ROUTES.cases.open(c.id) })) }
  }
}

const isList = (s: RecordState | undefined): s is RecordList => !!s && 'rows' in s

export default function FlowCase360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('flow.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Scenario Studio · Case" title="The cases of the studio" perm="flow.view" back="/studio?tab=cases" />
  return <CaseView key={id} id={id} ids={ids} />
}

function CaseView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const { run, busy, refusal, clear } = useRefusing()
  const idsKey = ids.join(',')
  const asOf = today()

  const [note, setNote] = useState('')
  const [pick, setPick] = useState<ID>('')
  const [skipping, setSkipping] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const main = useAsync(async () => {
    const [found, defs] = await Promise.all([
      api.getFlowCase(id).then((c) => ({ c: c as FlowCase | null, why: null as string | null }), (e: unknown) => ({ c: null, why: e instanceof Error ? e.message : String(e) })),
      api.listFlowDefs().catch(() => [] as FlowDef[]),
    ])
    return { c: found.c && ids.includes(found.c.company_id) ? found.c : null, why: found.why, defs }
  }, [api, id, idsKey])

  const c = main.data?.c ?? null
  const companyId = c?.company_id
  const steps = useMemo(() => [...(c?.steps ?? [])].sort((a, b) => a.step_no - b.step_no), [c])
  const active = c ? activeStepOf({ ...c, steps }) : null
  const kinds = useMemo(() => [...new Set(steps.filter((s) => s.links_to && (s.status === 'active' || s.entity_id)).map((s) => s.links_to as FlowLink))].sort(), [steps])
  const kindsKey = kinds.join(',')

  const records = useAsync(async () => {
    const out: Record<string, RecordState> = {}
    if (!companyId) return out
    await Promise.all(kinds.map(async (k) => {
      if (!mayRead(k, companyId)) { out[k] = { denied: true }; return }
      try { out[k] = await loadRecords(api, k, companyId) } catch (e) { out[k] = { error: e instanceof Error ? e.message : String(e) } }
    }))
    return out
  }, [api, companyId, kindsKey])

  const readsDocs = !!companyId && can('document.view', companyId)
  const docs = useAsync(async () => (companyId && readsDocs ? api.listDocuments({ companyIds: [companyId], entity: 'flow_cases', entityId: id }) : null), [api, companyId, id, readsDocs])
  const item = useAsync(async () => (c?.register_item_id && companyId && can('register.view', companyId) ? api.getRegisterItem(c.register_item_id).catch(() => null) : null), [api, c?.register_item_id, companyId])
  // names are a convenience: the case must be readable by people who cannot list the team or the audit trail
  const people = useAsync(async () => {
    const [members, audit] = await Promise.all([api.listMembers().catch(() => []), api.listAudit({ entity: 'flow_cases', entityId: id, limit: 100 }).catch(() => [])])
    const m = new Map<ID, string>()
    for (const x of members) m.set(x.user_id, x.full_name)
    for (const a of audit) if (a.actor && a.actor_name) m.set(a.actor, a.actor_name)
    return m
  }, [api, id])

  useEffect(() => { setNote(''); setPick(''); clear() }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = <button className="btn ghost" onClick={() => nav('/studio?tab=cases')}><ArrowLeft size={15} /> Back</button>
  const eyebrow = 'Scenario Studio · Case'
  if (main.error) return <div><PageHeader eyebrow={eyebrow} title="Case" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!main.data) return <div><PageHeader eyebrow={eyebrow} title="Case" actions={back} /><Panel><Loading rows={7} label="Loading the case" /></Panel></div>
  if (!c || !companyId) {
    return (
      <div>
        <PageHeader eyebrow={eyebrow} title="Case" actions={back} />
        <Panel><Empty icon={<Workflow size={20} />} title="Case not found or not shared with you" body="This case does not exist in the companies in which your role reads cases, or it is classified above your clearance." action={<button className="btn" onClick={() => nav('/studio?tab=cases')}><ArrowLeft size={14} /> Back to the studio</button>} /></Panel>
      </div>
    )
  }

  const def = main.data.defs.find((d) => d.id === c.flow_id) ?? null
  const currency = companies.find((x) => x.id === companyId)?.base_currency
  const me = session?.user.id
  const manages = can('flow.manage', companyId)
  const who = (uid: ID | null | undefined) => (!uid ? '—' : uid === me ? `${session?.user.name ?? 'You'} (you)` : people.data?.get(uid) ?? 'Name not available to you')
  const roleText = (r: string) => (r === '*' ? 'anyone authorised' : `the role ${human(r)}`)
  const guidanceOf = (s: FlowCaseStep) => def?.definition.steps?.find((x) => x.key === s.step_key)?.guidance ?? null

  const recorded = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const openFor = daysBetween(c.started_at.slice(0, 10), c.status === 'open' ? asOf : (c.completed_at ?? c.started_at).slice(0, 10))
  const waited = daysBetween(waitingSince({ ...c, steps }).slice(0, 10), asOf)

  const have = new Set((docs.data ?? []).map((x) => x.doc_kind))
  const required = active?.required_documents ?? []
  const missingDocs = docs.data ? required.filter((k) => !have.has(k)) : []
  const state: RecordState | undefined = active?.links_to ? records.data?.[active.links_to] : undefined
  const chosen = isList(state) ? state.rows.find((r) => r.id === pick) ?? null : null
  const override = session?.group?.settings?.controls?.maker_checker === 'owner_override'
  const ownApproval = !!active && active.action === 'approval' && !!c.started_by && c.started_by === me
  // the person who started a case states their own request and attaches their own evidence; every other step needs flow.manage
  const ownStep = !!active && (active.action === 'request' || active.action === 'evidence') && !!c.started_by && c.started_by === me && can('flow.view', companyId)
  const manage = manages || ownStep
  const noManage = manage ? undefined : c.started_by === me ? 'Your request is with the people who work on it. This step needs the permission flow.manage in this company' : 'You need the permission flow.manage in this company'

  const problems: string[] = []
  if (active?.links_to && !pick) problems.push(`This step is complete when it points to its record. Choose the ${linkMeta(active.links_to).one}.`)
  if (missingDocs.length) problems.push(`Attach first: ${missingDocs.map(docKindName).join(', ')}.`)

  const complete = async () => {
    if (!active) return
    const r = await run(() => api.completeFlowStep({ case_id: c.id, note: note.trim() || undefined, entity_id: active.links_to ? pick : undefined }), (x) => (x === 'completed' ? 'Step recorded. The case is completed.' : 'Step recorded. The next step is in turn.'))
    if (r) { setNote(''); setPick('') }
  }
  const skip = async (reason: string) => {
    const r = await run(() => api.completeFlowStep({ case_id: c.id, skip: true, note: reason }), (x) => (x === 'completed' ? 'Step skipped. The case is completed.' : 'Step skipped. The next step is in turn.'))
    if (r) setSkipping(false)
  }
  const cancel = async (reason: string) => {
    const ok = await run(async () => { await api.cancelFlowCase(c.id, reason); return true }, 'Case cancelled')
    if (ok) setCancelling(false)
  }

  // ---------------------------------------------------------------- the record a recorded step points to
  const pointer = (s: FlowCaseStep): ReactNode => {
    const kind = s.entity ?? s.links_to
    if (!kind || !s.entity_id) return null
    const meta = linkMeta(kind)
    const st = records.data?.[kind]
    const route = routeOf(kind, s.entity_id)
    if (!mayRead(kind, companyId)) return <div className="mt-2 rounded-lg border border-line px-3 py-2 text-[12px] text-muted"><Lock size={12} className="mr-1.5 inline" />Points to {/^[aeiou]/.test(meta.one) ? 'an' : 'a'} {meta.one}. Your role does not read {meta.many} in this company, so it is not shown here.</div>
    if (!st) return <div className="mt-2 text-[12px] text-muted">Loading the {meta.one}…</div>
    const rec = isList(st) ? st.rows.find((r) => r.id === s.entity_id) ?? null : null
    if (!rec) {
      return (
        <div className="mt-2 rounded-lg border border-line px-3 py-2 text-[12px] text-muted">
          Points to {/^[aeiou]/.test(meta.one) ? 'an' : 'a'} {meta.one}. {'error' in st ? `The ${meta.many} could not be read: ${st.error}` : `It is not among the ${meta.many} sent to you${isList(st) && st.more > 0 ? `: only the ${st.rows.length.toLocaleString()} most recent are listed here, and it may be older` : ': it may be classified above your clearance'}.`}
          {route && <> <button className="link" onClick={() => nav(route)}>Open it</button></>}
        </div>
      )
    }
    return (
      <button className="mt-2 flex w-full items-start gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-line2 hover:bg-surface2" onClick={() => nav(rec.route)} title={`Open the ${meta.one}`}>
        <FileText size={15} className="mt-[2px] flex-none text-gold" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-ink"><span className="text-muted">{meta.one.replace(/^./, (x) => x.toUpperCase())}</span> <span className="num text-gold">{rec.no}</span> · {rec.title}</span>
          <span className="block text-[11.5px] text-muted">{rec.party_id ? `${partyName(rec.party_id)} · ` : ''}{fmtDate(rec.date)} · as it stands now{rec.caution ? <span className="text-warn"> · {rec.caution}</span> : null}</span>
        </span>
        <span className="flex-none text-right">{rec.amount !== null && <><Money value={rec.amount} currency={rec.currency ?? currency} className="text-[12.5px]" /><span className="block text-[11px] text-muted">{rec.measure}</span></>}</span>
        <StatusChip status={rec.status} />
        <ExternalLink size={13} className="mt-[3px] flex-none text-muted" />
      </button>
    )
  }

  const fields: FlowFieldDef[] = def?.definition.fields ?? []
  const known = new Set(fields.map((f) => f.key))
  const answers: { key: string; label: string; type: FlowFieldDef['type']; value: unknown }[] = [
    ...fields.map((f) => ({ key: f.key, label: f.label, type: f.type, value: c.data?.[f.key] })),
    ...Object.keys(c.data ?? {}).filter((k) => !known.has(k)).map((k) => ({ key: k, label: human(k), type: undefined, value: c.data[k] })),
  ]
  const showAnswer = (a: { type: FlowFieldDef['type']; value: unknown }): ReactNode => {
    const v = a.value
    if (v === null || v === undefined || String(v).trim() === '') return <span className="text-muted">Not answered</span>
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (a.type === 'money' && (typeof v === 'number' || typeof v === 'string')) return <Money value={v} currency={currency} />
    if (a.type === 'date' && typeof v === 'string') return <span className="num">{fmtDate(v)}</span>
    if (a.type === 'number') return <span className="num">{String(v)}</span>
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  const evidenceInStep = c.status === 'open' && required.length > 0

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={`${c.case_no} · ${c.title}`}
        subtitle={<>
          {def ? <button className="link" onClick={() => nav('/studio/flows/' + def.id)}>{def.name} · version {def.version}</button> : 'A workflow not shared with you'} · {companyName(companyId)}
          {c.party_id && <> · <button className="link" onClick={() => nav('/parties/' + c.party_id)}>{partyName(c.party_id)}</button></>}
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          {back}
          {c.status === 'open' && <button className="btn danger" disabled={!manages || busy} title={manages ? undefined : 'You need the permission flow.manage in this company'} onClick={() => setCancelling(true)}><Ban size={14} /> Cancel the case</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={c.status} />
        {active && <><span className="text-[11.5px] text-muted">in turn</span><ActionChip action={active.action} /></>}
        {c.confidentiality !== 'internal' && <span className="chip violet">{human(c.confidentiality)}</span>}
        {def && !triggerWorks(def.trigger_kind) && <span className="chip warn" title={`The trigger of the workflow, ${triggerLabel(def.trigger_kind).toLowerCase()}, is ${INTENT_NOTE}. This case was started by a person.`}>started by a person</span>}
      </div>

      <Note className="mb-4">Completing a step records that it was done, and by whom. It posts nothing and moves no money. Money is released, and cost reaches the ledger, only through the records the steps point to — each on its own screen, each approved by a second person.</Note>
      {c.status === 'cancelled' && <Note kind="warn" className="mb-4">This case was cancelled on {fmtDateTime(c.completed_at)}. Reason: {c.cancel_reason ?? 'none recorded'}. The steps already recorded stay on record, and the records they point to were not changed by the cancellation.</Note>}
      {c.status === 'completed' && <Note kind="good" className="mb-4">This case was completed on {fmtDateTime(c.completed_at)}. Every step was recorded or, where optional, skipped with a reason.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Amount of the case" sub="as stated at the start · not an amount approved or released">{c.amount === null || c.amount === undefined ? <span className="text-muted">—</span> : <Money value={c.amount} currency={currency} compact />}</Tile>
        <Tile label="Steps recorded" sub={<span className="block pt-1"><Meter value={recorded} max={steps.length} tone={c.status === 'cancelled' ? 'warn' : 'pos'} height={5} /></span>}><span className="num">{recorded}</span> <span className="text-[14px] text-muted">of {steps.length}</span></Tile>
        <Tile label={c.status === 'open' ? 'Open for' : 'Was open for'} sub={`started ${fmtDate(c.started_at.slice(0, 10))} by ${who(c.started_by)}`}><span className="num">{daysText(openFor)}</span></Tile>
        <Tile label="In turn" tone={active ? 'text-gold' : undefined} sub={active ? `for ${roleText(active.actor_role)} · here for ${daysText(waited)}` : c.status === 'completed' ? 'The case is completed' : 'The case is cancelled'}>
          <span className="text-[15px]">{active ? `${active.step_no}. ${active.name}` : '—'}</span>
        </Tile>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0">
          <Section title="The steps">
            <div>
              {steps.map((s, i) => {
                const on = c.status === 'open' && active?.id === s.id
                const guidance = guidanceOf(s)
                return (
                  <div key={s.id} className="flex gap-3">
                    <div className="flex w-10 flex-none flex-col items-center">
                      <ActionNode action={s.action} size={40} state={on ? 'active' : s.status === 'active' ? 'pending' : s.status} />
                      {i < steps.length - 1 && <span className="w-px flex-1" style={{ minHeight: 10, background: s.status === 'done' ? 'var(--pos)' : 'var(--line-strong)' }} />}
                    </div>
                    <div className="min-w-0 flex-1 pb-3">
                      <Panel lit={false} className={cx('p-4', on && 'border-gold/50')} style={on ? { boxShadow: 'var(--glow)' } : undefined}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className={cx('text-[13.5px] font-medium', s.status === 'pending' || s.status === 'skipped' ? 'text-ink2' : 'text-ink')}><span className="num mr-2 text-[12px] text-gold">{s.step_no}</span>{s.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <ActionChip action={s.action} />
                              <span className="chip" title="Who acts at this step">{roleText(s.actor_role)}</span>
                              {s.links_to && <span className="chip cyan" title="The step is complete only when it points to this record">→ {linkMeta(s.links_to).one}</span>}
                              {s.required_documents.map((k) => <span key={k} className="chip violet" title="A document of this kind must be attached to the case">{docKindName(k)}</span>)}
                              {s.optional && <span className="chip">optional</span>}
                            </div>
                          </div>
                          <StatusChip status={on ? 'active' : s.status === 'done' ? 'done' : 'planned'} label={on ? 'in turn' : s.status === 'pending' ? (c.status === 'open' ? 'not yet in turn' : 'not reached') : s.status === 'active' ? 'stopped here' : s.status === 'done' ? 'recorded' : undefined} />
                        </div>

                        {(s.status === 'done' || s.status === 'skipped') && (
                          <div className="mt-3 border-t border-line pt-2.5">
                            <div className="flex items-center gap-1.5 text-[12px] text-ink2">
                              {s.status === 'done' ? <CheckCircle2 size={14} className="flex-none text-pos" /> : <SkipForward size={14} className="flex-none text-muted" />}
                              <span>{s.status === 'done' ? 'Recorded' : 'Skipped'} by <span className="text-ink">{who(s.done_by)}</span> · <span className="num">{fmtDateTime(s.done_at)}</span></span>
                            </div>
                            {s.note && <div className="mt-1.5 rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-ink2">{s.status === 'skipped' && <span className="text-muted">Reason: </span>}{s.note}</div>}
                            {pointer(s)}
                          </div>
                        )}

                        {s.status === 'pending' && guidance && <div className="mt-2.5 text-[12px] text-muted">{guidance}</div>}

                        {on && (
                          <div className="mt-3 space-y-3.5 border-t border-line pt-3.5">
                            <div className="text-[12px] text-muted">{actionMeta(s.action).says}</div>
                            {guidance && <div className="rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-ink2"><span className="text-muted">Guidance: </span>{guidance}</div>}
                            {ownApproval && (
                              <Note kind="warn">
                                {override
                                  ? 'You started this case, and an approval is for a second person. This group has set the maker-checker control to owner override, so the engine may accept your approval; it then stands on record as given by the person who started the case.'
                                  : 'You started this case. The person who started a case cannot also approve it: the engine refuses, and a second person completes this step.'}
                              </Note>
                            )}
                            {s.actor_role !== '*' && <div className="text-[12px] text-muted">This step is for {roleText(s.actor_role)}. The engine refuses anyone else, other than a Group Super Admin.</div>}

                            {s.links_to && (
                              <RecordPicker kind={s.links_to} state={state} loading={records.loading} companyId={companyId} currency={currency} value={pick} onChange={setPick} />
                            )}
                            {chosen?.caution && <Note kind="warn">{chosen.caution} Completing the step records that the step points to this {linkMeta(s.links_to ?? '').one}. It does not change the {linkMeta(s.links_to ?? '').one}.</Note>}

                            {required.length > 0 && (
                              <div>
                                <div className="label">Documents this step requires</div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {required.map((k) => (
                                    <span key={k} className={cx('chip', !docs.data ? '' : have.has(k) ? 'pos' : 'warn')}>
                                      {docs.data && have.has(k) && <Check size={11} />}{docKindName(k)} · {!docs.data ? 'not known' : have.has(k) ? 'attached' : 'missing'}
                                    </span>
                                  ))}
                                </div>
                                <div className="mt-1.5 text-[11.5px] text-muted">
                                  {!readsDocs ? 'Your role does not read documents in this company, so what is attached cannot be shown here. The engine checks it when the step is completed.'
                                    : docs.error ? `The documents could not be read: ${docs.error}`
                                    : !docs.data ? 'Loading what is attached…'
                                    : missingDocs.length ? `Still missing: ${missingDocs.map(docKindName).join(', ')}. Choose the kind of the document before you attach it: the engine checks the kind, not the content.`
                                    : 'A document of every kind required is attached to the case.'}
                                </div>
                                <Attachments className="mt-3" companyId={companyId} entity="flow_cases" entityId={c.id} title="Documents of the case" />
                              </div>
                            )}

                            <label className="block">
                              <span className="label">Note (optional)</span>
                              <textarea className="field" rows={2} value={note} disabled={!manage} placeholder="What was done, in a line" onChange={(e) => { setNote(e.target.value); clear() }} />
                            </label>

                            <Refusal message={refusal} />

                            <div className="flex flex-wrap items-center gap-2">
                              <button className="btn primary" disabled={!manage || busy || problems.length > 0} title={noManage ?? problems[0]} onClick={() => void complete()}>{busy ? <Spinner /> : <Check size={15} />} Complete this step</button>
                              {s.optional && <button className="btn" disabled={!manage || busy} title={noManage ?? 'An optional step can be skipped, with a reason'} onClick={() => setSkipping(true)}><SkipForward size={14} /> Skip</button>}
                              <span className="min-w-0 flex-1 text-[11.5px] text-muted">{!manage ? noManage : problems.length ? <span className="text-warn">{problems.join(' ')}</span> : 'Records the step as done by you, now. Posts nothing and moves no money.'}</span>
                            </div>
                          </div>
                        )}
                      </Panel>
                    </div>
                  </div>
                )
              })}
              {steps.length === 0 && <Panel lit={false}><Empty icon={<Hourglass size={20} />} title="No step is recorded for this case" body="The steps of this case were not sent to you." /></Panel>}
            </div>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Entered at the start">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Workflow">{def ? <button className="link" onClick={() => nav('/studio/flows/' + def.id)}>{def.name}</button> : 'Not shared with you'}{def && <span className="text-muted"> · v{def.version} · {def.status}</span>}</Fact>
              <Fact label="Company">{companyName(companyId)}</Fact>
              <Fact label="Party">{c.party_id ? <button className="link" onClick={() => nav('/parties/' + c.party_id)}>{partyName(c.party_id)}</button> : 'None'}</Fact>
              <Fact label="Amount">{c.amount === null || c.amount === undefined ? 'None stated' : <Money value={c.amount} currency={currency} />}</Fact>
              <Fact label="Register item">
                {!c.register_item_id ? 'None'
                  : !can('register.view', companyId) ? 'Linked. Your role does not read the registers of this company.'
                  : item.data ? <button className="link" onClick={() => nav('/registers/' + c.register_item_id)}>{item.data.ref_no} · {item.data.title}</button>
                  : item.loading ? 'Loading…' : <button className="link" onClick={() => nav('/registers/' + c.register_item_id)}>Open the register item</button>}
              </Fact>
              <Fact label="Confidentiality">{human(c.confidentiality)}</Fact>
              <Fact label="Started by">{who(c.started_by)}</Fact>
              <Fact label="Started"><span className="num">{fmtDateTime(c.started_at)}</span></Fact>
              {answers.length > 0 && <div className="border-t border-line sm:col-span-2" />}
              {answers.map((a) => <Fact key={a.key} label={a.label}>{showAnswer(a)}</Fact>)}
              {answers.length === 0 && <div className="border-t border-line pt-3 text-[12px] text-muted sm:col-span-2">The workflow asked for nothing more at the start.</div>}
            </Panel>
          </Section>

          {!evidenceInStep && (
            readsDocs || can('document.upload', companyId)
              ? <Attachments companyId={companyId} entity="flow_cases" entityId={c.id} title="Documents of the case" readOnly={c.status !== 'open'} />
              : <Section title="Documents of the case"><Panel className="p-4 text-[12.5px] text-muted" lit={false}>Your role does not read documents in this company. Documents attached to the case exist all the same.</Panel></Section>
          )}
          {!readsDocs && can('document.upload', companyId) && <div className="text-[11.5px] text-muted">Your role attaches documents but does not read them in this company: an empty list here does not mean that nothing is attached.</div>}

          <History entity="flow_cases" entityId={c.id} title="History of the case" />
          <div className="text-[11.5px] text-muted">The history shows what the audit trail holds for the case itself. Who recorded each step, and when, is on the step.</div>
        </div>
      </div>

      <ReasonDialog open={skipping} title="Skip this step" confirm="Skip the step" onCancel={() => setSkipping(false)} onConfirm={(r) => void skip(r)}
        body={active ? <>The step <span className="text-ink">{active.step_no}. {active.name}</span> is optional. Skipping records that it was not done, by you, with your reason, and brings the next step in turn. The reason is kept on the step. It posts nothing.</> : undefined}
        extra={<Refusal message={refusal} className="mb-3" />} />
      <ReasonDialog open={cancelling} danger title="Cancel this case" confirm="Cancel the case" onCancel={() => setCancelling(false)} onConfirm={(r) => void cancel(r)}
        body={<>Cancelling closes the case: no further step can be recorded, and a cancelled case is not opened again. The {plural(recorded, 'step')} already recorded stay on record. Cancelling reverses nothing: an advance, a claim, a payment or an entry the steps point to is not changed. Settle or reverse those on their own screens. The reason is kept on the case.</>}
        extra={<Refusal message={refusal} className="mb-3" />} />
    </div>
  )
}

// =====================================================================
// Choosing the record a step points to
// =====================================================================
function RecordPicker({ kind, state, loading, companyId, currency, value, onChange }: { kind: FlowLink; state: RecordState | undefined; loading: boolean; companyId: ID; currency?: string; value: ID; onChange: (id: ID) => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const [q, setQ] = useState('')
  const meta = linkMeta(kind)
  const capped = isList(state) && state.more > 0
  // entries are many: when the list is only the most recent ones, the search asks the ledger itself
  const term = capped && kind === 'journals' ? q.trim() : ''
  const searched = useAsync(async () => (term ? loadRecords(api, kind, companyId, term) : null), [api, kind, companyId, term])

  if (!state) return <div className="rounded-lg border border-line px-3 py-3 text-[12.5px] text-muted">{loading ? `Loading the ${meta.many} of ${companyName(companyId)}…` : `The ${meta.many} are not loaded.`}</div>
  if ('denied' in state) {
    return (
      <Note kind="warn">
        This step is complete only when it points to {/^[aeiou]/.test(meta.one) ? 'an' : 'a'} {meta.one}. Your role does not read {meta.many} in {companyName(companyId)} (permission <span className="num">{meta.perms.join(' or ')}</span>), so they cannot be listed here. A person who reads them completes this step.
      </Note>
    )
  }
  if ('error' in state) return <Note kind="warn">The {meta.many} could not be read: {state.error}</Note>

  const base = term && searched.data ? searched.data.rows : state.rows
  const w = q.trim().toLowerCase()
  const rows = term ? base : base.filter((r) => !w || r.no.toLowerCase().includes(w) || r.title.toLowerCase().includes(w) || (r.party_id ? partyName(r.party_id).toLowerCase().includes(w) : false))
  const sorted = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const held = value && !sorted.some((r) => r.id === value) ? [...state.rows, ...(searched.data?.rows ?? [])].find((r) => r.id === value) ?? null : null
  const shown = held ? [held, ...sorted] : sorted

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="label m-0">The {meta.one} this step points to</span>
        <span className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-[9px] text-muted" />
          <input className="field sm pl-8" style={{ width: 230 }} value={q} placeholder="Number, title or party" aria-label={`Search the ${meta.many}`} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>
      <div className="max-h-[300px] overflow-auto rounded-xl border border-line p-1" role="radiogroup" aria-label={`The ${meta.one} this step points to`}>
        {term && searched.loading && !searched.data ? <div className="px-3 py-3 text-[12.5px] text-muted">Searching…</div>
          : shown.length === 0 ? (
            <div className="px-3 py-3 text-[12.5px] text-muted">
              {state.rows.length === 0 ? <>No {meta.one} that you may read is recorded in {companyName(companyId)}. Record it under <button className="link" onClick={() => nav(ROUTES[kind].list)}>{meta.where}</button>, then come back to this step.</> : 'Nothing matches the search.'}
            </div>
          ) : shown.map((r) => {
            const on = r.id === value
            return (
              <button key={r.id} role="radio" aria-checked={on} onClick={() => onChange(on ? '' : r.id)}
                className={cx('flex w-full items-start gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors', on ? 'border-gold bg-goldsoft' : 'border-transparent hover:bg-surface2')}>
                <span className={cx('mt-[3px] grid h-4 w-4 flex-none place-items-center rounded-full border', on ? 'border-gold text-gold' : 'border-line2 text-transparent')}><Check size={10} strokeWidth={3} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink"><span className="num text-gold">{r.no}</span> · {r.title}</span>
                  <span className="block text-[11.5px] text-muted">{r.party_id ? `${partyName(r.party_id)} · ` : ''}{fmtDate(r.date)}{r.caution ? <span className="text-warn"> · {r.caution}</span> : null}</span>
                </span>
                <span className="flex-none text-right">{r.amount !== null && <><Money value={r.amount} currency={r.currency ?? currency} className="text-[12.5px]" /><span className="block text-[11px] text-muted">{r.measure}</span></>}</span>
                <StatusChip status={r.status} />
              </button>
            )
          })}
      </div>
      <div className="mt-1.5 text-[11.5px] text-muted">
        {term ? `${plural(shown.length, 'entry', 'entries')} found in the ledger for "${term}".` : `${plural(shown.length, 'record')} shown of ${state.rows.length.toLocaleString()} ${state.rows.length === 1 ? meta.one : meta.many} of ${companyName(companyId)} that you may read.`}
        {capped && !term && ` Only the ${state.rows.length.toLocaleString()} most recent are listed, of ${(state.rows.length + state.more).toLocaleString()}: search to find an older one.`}
        {' '}Records above your clearance are not sent to you. <button className="link" onClick={() => nav(ROUTES[kind].list)}>Open {meta.where}</button>
      </div>
    </div>
  )
}
