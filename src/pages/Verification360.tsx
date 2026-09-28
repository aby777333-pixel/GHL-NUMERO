import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowLeft, BadgeCheck, Ban, ClipboardCheck, ExternalLink, FolderOpen, Save } from 'lucide-react'
import type { ID } from '@/engine/types'
import { DOCUMENT_KINDS } from '@/engine/opsTypes'
import type { Case, VerificationEntry, VerificationLine, VerifyResult } from '@/engine/p3Types'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, ZERO, round2, sum } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { Attachments, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'
import { DemoTag, digits, Fact, History, human, NoAccess, Tile } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { Meter } from '@/ui/charts'
import { recordRoute, useWho, verificationSummary, verifySubjectLabel } from './Reality'

// =====================================================================
// Verification 360: the sheet of one physical verification.
// The books say what should be there; a person writes what was found.
// A verification changes nothing in the books. What differs is taken
// up in a case and corrected by the documents of its own area — an
// asset disposal, a stock count adjustment, a cash voucher.
// An item that was not checked is never counted as agreeing.
// =====================================================================

const SEEN: VerifyResult[] = ['not_checked', 'located', 'transferred', 'damaged', 'missing', 'disposed']
const SEEN_LABEL: Record<string, string> = { not_checked: 'Not checked', located: 'Located — as the books say', transferred: 'Transferred — found elsewhere', damaged: 'Damaged', missing: 'Missing — not found', disposed: 'Disposed — no longer held' }
const agrees = (r: VerifyResult) => r === 'located' || r === 'matched'
const notFound = (e: unknown) => /not found|no rows|0 rows|PGRST116|multiple \(or no\) rows/i.test(e instanceof Error ? e.message : String(e))

/** What a person has typed on a line and not saved yet. */
interface Draft { result: VerifyResult; found: string; note: string }
interface Row { line: VerificationLine; value: Draft; dirty: boolean; result: VerifyResult; problem: string | null; diffQty: Decimal | null; diffValue: Decimal | null }

export default function Verification360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('reality.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="NUMERO Reality · Verification" title="Physical verification" perm="reality.view" back="/reality?tab=verification" />
  return <RunView key={id} id={id} />
}

function RunView({ id }: { id: ID }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const companyName = useCompanyName()
  const partyName = usePartyName()
  const unitName = useUnitName()
  const who = useWho()
  const { act, busy } = useAction()
  const [drafts, setDrafts] = useState<Record<ID, Draft>>({})
  const [show, setShow] = useState<'all' | 'open' | 'differ' | 'unsaved'>('all')
  const [q, setQ] = useState('')
  const [completing, setCompleting] = useState(false)
  const [why, setWhy] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  const main = useAsync(async () => {
    try {
      const r = await api.getVerification(id)
      return can('reality.view', r.company_id) ? r : null
    } catch (e) { if (notFound(e)) return null; throw e }
  }, [api, id])
  const run = main.data ?? null
  const companyId = run?.company_id
  const cases = useAsync(async () => {
    const m = new Map<string, Case>()
    if (companyId) for (const c of await api.listCases({ companyIds: [companyId] })) if (c.dedupe_key) m.set(c.dedupe_key, c)
    return m
  }, [api, companyId])

  // the names of what was chosen as the scope, each read under the permission of its own area
  const scope = (run?.scope ?? {}) as Record<string, unknown>
  const scopeKey = JSON.stringify(scope)
  const scopeNames = useAsync(async () => {
    const out: Record<string, string> = {}
    if (!companyId) return out
    const s = (k: string) => (typeof scope[k] === 'string' && scope[k] ? (scope[k] as string) : null)
    const wh = s('warehouse_id'), cat = s('category_id'), box = s('box_id')
    if (wh && can('inventory.view', companyId)) { const w = (await api.listWarehouses([companyId]).catch(() => [])).find((x) => x.id === wh); if (w) out.warehouse_id = `${w.code} · ${w.name}` }
    if (cat && can('asset.view', companyId)) { const c = (await api.listAssetCategories([companyId]).catch(() => [])).find((x) => x.id === cat); if (c) out.category_id = c.name }
    if (box && can('treasury.view', companyId)) { const b = (await api.listCashBoxes([companyId]).catch(() => [])).find((x) => x.id === box); if (b) out.box_id = b.name }
    return out
  }, [api, companyId, scopeKey])

  const subject = run?.subject
  const counted = subject === 'inventory' || subject === 'cash'
  const lines = useMemo(() => run?.lines ?? [], [run])

  const fromLine = (l: VerificationLine): Draft => ({
    result: l.result, note: l.note ?? '',
    found: subject === 'inventory' ? (l.found_qty === null ? '' : D(l.found_qty).toString()) : subject === 'cash' ? (l.found_value === null ? '' : D(l.found_value).toString()) : '',
  })
  const rows: Row[] = useMemo(() => lines.map((line) => {
    const saved = fromLine(line)
    const value = drafts[line.id] ?? saved
    const dirty = value.result !== saved.result || value.found !== saved.found || value.note.trim() !== saved.note.trim()
    const has = value.found.trim() !== ''
    let result: VerifyResult = value.result
    let diffQty: Decimal | null = null
    let diffValue: Decimal | null = null
    if (subject === 'inventory') {
      result = !has ? 'not_checked' : D(value.found).eq(D(line.book_qty)) ? 'matched' : 'difference'
      if (has) {
        diffQty = D(value.found).minus(D(line.book_qty))
        const unit = D(line.book_qty).isZero() ? ZERO : D(line.book_value).div(D(line.book_qty))
        diffValue = round2(diffQty.times(unit))
      }
    } else if (subject === 'cash') {
      result = !has ? 'not_checked' : round2(value.found).eq(round2(D(line.book_value))) ? 'matched' : 'difference'
      if (has) diffValue = D(value.found).minus(D(line.book_value))
    } else if (!agrees(result) && result !== 'not_checked' && line.book_value !== null) diffValue = D(line.book_value).neg()
    const problem = counted && !has && line.result !== 'not_checked' ? 'What was recorded can be corrected, not removed. Enter what was found.'
      : counted && !has && value.note.trim() && dirty ? (subject === 'inventory' ? 'State the quantity found.' : 'State the amount found.')
      : !agrees(result) && result !== 'not_checked' && !value.note.trim() ? 'Say what was found.' : null
    return { line, value, dirty, result, problem, diffQty, diffValue }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lines, drafts, subject])

  const back = <button className="btn ghost" onClick={() => nav('/reality?tab=verification')}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="NUMERO Reality · Verification" title="Physical verification" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (main.loading && main.data === undefined) return <div><PageHeader eyebrow="NUMERO Reality · Verification" title="Physical verification" actions={back} /><Panel><Loading rows={7} label="Loading the sheet" /></Panel></div>
  if (!run) {
    return (
      <div>
        <PageHeader eyebrow="NUMERO Reality · Verification" title="Physical verification" actions={back} />
        <Panel><Empty icon={<ClipboardCheck size={20} />} title="Verification not found or not shared with you" body="This verification does not exist in the companies you can access." action={<button className="btn" onClick={() => nav('/reality?tab=verification')}><ArrowLeft size={14} /> Back to the verifications</button>} /></Panel>
      </div>
    )
  }

  const manage = can('reality.manage', run.company_id)
  const open = run.status === 'open'
  const editable = open && manage
  const noManage = manage ? undefined : 'You need the permission reality.manage in this company'
  const currency = companies.find((c) => c.id === run.company_id)?.base_currency
  const summary = verificationSummary(run)

  const dirty = rows.filter((r) => r.dirty)
  const problems = dirty.filter((r) => r.problem)
  // the counts speak only of what has been saved: what is typed and not saved is not yet on the record
  const savedAgree = lines.filter((l) => agrees(l.result)).length
  const savedOpen = lines.filter((l) => l.result === 'not_checked').length
  const savedDiffer = lines.length - savedAgree - savedOpen
  const bookValue = sum(lines.map((l) => l.book_value ?? 0))

  const set = (l: VerificationLine, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [l.id]: { ...(d[l.id] ?? fromLine(l)), ...patch } }))
  const save = () => {
    const entries: VerificationEntry[] = dirty.filter((r) => !r.problem && (!counted || r.value.found.trim() !== '')).map((r) => ({
      id: r.line.id, note: r.value.note.trim() || undefined,
      ...(subject === 'inventory' ? { found_qty: r.value.found } : subject === 'cash' ? { found_value: r.value.found } : { result: r.value.result }),
    }))
    if (!entries.length) return
    void act(() => api.recordVerification(run.id, entries), (n) => `${n} line${n === 1 ? '' : 's'} recorded on the sheet`).then((n) => {
      if (n !== undefined) setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !entries.some((e) => e.id === k))))
    })
  }
  const cancel = () => void act(() => api.cancelVerification(run.id, reason.trim()), 'Verification cancelled — nothing was raised from it').then((r) => { if (r !== undefined) { setCancelling(false); setDrafts({}) } })
  const complete = () => void act(() => api.completeVerification(run.id, why.trim() || undefined), 'Verification completed — nothing in the books was changed').then((r) => { if (r) { setCompleting(false); setDrafts({}) } })

  const openCase = (r: Row) => {
    const l = r.line
    const found = subject === 'inventory' ? `${D(l.found_qty).toString()} found against ${D(l.book_qty).toString()} in the books` : subject === 'cash' ? `${D(l.found_value).toString()} found against ${D(l.book_value).toString()} in the books` : `found to be ${human(l.result)}, while the books carry it${l.book_value !== null ? ' at ' + D(l.book_value).toString() : ''}`
    const physical = subject === 'inventory' ? { value: D(l.found_qty).toNumber(), unit: 'quantity' } : subject === 'cash' ? { value: D(l.found_value).toNumber(), unit: 'amount' } : { value: l.result === 'missing' || l.result === 'disposed' ? 0 : null, unit: 'amount' }
    const books = subject === 'inventory' ? { value: D(l.book_qty).toNumber(), unit: 'quantity' } : { value: l.book_value === null ? null : D(l.book_value).toNumber(), unit: 'amount' }
    void act(() => api.openCase({
      company_id: run.company_id, kind: 'verification', title: `${l.label}: ${subject === 'inventory' || subject === 'cash' ? 'what was found differs from the books' : human(l.result) + ' at verification'}`,
      summary: `Verification ${run.verify_no} of ${run.run_date}: ${l.label} — ${found}.${l.note ? ' ' + l.note : ''} The books have not been changed.`,
      amount: r.diffValue ? r.diffValue.abs().toDecimalPlaces(2).toNumber() : undefined, attention: 'finance_action', dedupe_key: 'verification:' + l.id,
      links: [{ entity: l.entity, entity_id: l.entity_id, label: l.label }, { entity: 'verification_runs', entity_id: run.id, label: run.verify_no }],
      finding: {
        accounting: { ...books, says: subject === 'inventory' ? `The stock ledger shows ${D(l.book_qty).toString()} of ${l.label}${l.place ? ' in ' + l.place : ''}.` : subject === 'cash' ? `The books showed ${D(l.book_value).toString()} in ${l.label} on ${run.run_date}.` : `The books carry ${l.label}${l.book_value !== null ? ' at ' + D(l.book_value).toString() : ''}.` },
        physical: { ...physical, says: `Verification ${run.verify_no} of ${run.run_date}: ${found}.` },
        differs: ['physical'], as_at: run.run_date,
      },
    }), 'Case opened').then((caseId) => { if (caseId) nav('/reality/cases/' + caseId) })
  }

  const text = q.trim().toLowerCase()
  const shown = rows.filter((r) => (show === 'all' || (show === 'open' && r.result === 'not_checked') || (show === 'differ' && !agrees(r.result) && r.result !== 'not_checked') || (show === 'unsaved' && r.dirty))
    && (!text || `${r.line.label} ${r.line.place ?? ''}`.toLowerCase().includes(text)))

  const figure = (v: Decimal.Value | null, qty?: boolean) => (v === null ? <span className="text-muted">—</span> : qty ? <span className="num">{D(v).toString()}</span> : <Money value={v} currency={currency} />)
  const columns: Column<Row>[] = [
    {
      key: 'label', header: subject === 'cash' ? 'Cash box' : subject === 'documents' ? 'Document' : 'Item', sort: (r) => r.line.label.toLowerCase(), csv: (r) => r.line.label,
      render: (r) => {
        const to = recordRoute({ entity: r.line.entity, entity_id: r.line.entity_id })
        return <div className="min-w-[180px] max-w-[340px]"><div className="text-ink">{r.line.label}</div>{to && <button className="link inline-flex items-center gap-1 text-[11.5px]" onClick={() => nav(to)}>Open the record <ExternalLink size={10} /></button>}</div>
      },
    },
    { key: 'place', header: subject === 'cash' ? 'Custodian' : subject === 'documents' ? 'Kind' : 'Place', render: (r) => <span className="text-[12.5px] text-ink2">{subject === 'documents' ? DOCUMENT_KINDS.find((k) => k.key === r.line.place)?.name ?? r.line.place ?? '—' : r.line.place ?? '—'}</span>, sort: (r) => (r.line.place ?? '').toLowerCase(), csv: (r) => r.line.place ?? '' },
    ...(subject === 'inventory' || subject === 'assets' ? [{ key: 'bq', header: 'Books: quantity', align: 'right' as const, render: (r: Row) => figure(r.line.book_qty, true), sort: (r: Row) => D(r.line.book_qty).toNumber(), csv: (r: Row) => (r.line.book_qty === null ? '' : D(r.line.book_qty).toString()) }] : []),
    { key: 'bv', header: subject === 'inventory' ? 'Books: value at the cost carried' : subject === 'assets' ? 'Books: value after depreciation' : subject === 'cash' ? 'Books: balance on the date' : 'Books: amount of the document', align: 'right', render: (r) => figure(r.line.book_value), sort: (r) => D(r.line.book_value).toNumber(), csv: (r) => (r.line.book_value === null ? '' : D(r.line.book_value).toFixed(2)) },
    {
      key: 'found', header: subject === 'inventory' ? 'Quantity found' : subject === 'cash' ? 'Amount found' : 'What was found', align: counted ? 'right' : 'left',
      sort: (r) => (counted ? D(r.value.found || 0).toNumber() : SEEN.indexOf(r.value.result)), csv: (r) => (counted ? r.value.found : human(r.value.result)),
      render: (r) => (!editable
        ? (counted ? (r.value.found === '' ? <span className="text-muted">not checked</span> : figure(r.value.found, subject === 'inventory')) : <StatusChip status={r.value.result} label={r.value.result === 'not_checked' ? 'not checked' : undefined} />)
        : counted
          ? <input className="field sm num" style={{ width: 130, textAlign: 'right' }} inputMode="decimal" aria-label={`${subject === 'inventory' ? 'Quantity' : 'Amount'} found for ${r.line.label}`} placeholder="not checked" value={r.value.found} onChange={(e) => set(r.line, { found: digits(e.target.value) })} />
          : <select className="field sm" style={{ width: 230 }} aria-label={`What was found for ${r.line.label}`} value={r.value.result} onChange={(e) => set(r.line, { result: e.target.value as VerifyResult })}>{SEEN.map((s) => <option key={s} value={s}>{SEEN_LABEL[s]}</option>)}</select>),
    },
    {
      key: 'result', header: 'Result', sort: (r) => r.result, csv: (r) => human(r.result) + (r.dirty ? ' (not saved)' : ''),
      render: (r) => <span className="flex flex-wrap items-center gap-1.5"><StatusChip status={r.result} label={r.result === 'not_checked' ? 'not checked' : r.result === 'matched' ? 'agrees' : r.result === 'difference' ? 'differs' : undefined} />{r.dirty && <span className="chip warn" title="Typed, and not yet saved to the sheet">not saved</span>}</span>,
    },
    {
      key: 'diff', header: subject === 'inventory' ? 'Difference (value is an estimate at the cost carried)' : subject === 'cash' ? 'Difference' : 'Book value concerned', align: 'right',
      sort: (r) => (r.diffValue ?? ZERO).abs().toNumber(), csv: (r) => (r.diffValue ? r.diffValue.toFixed(2) : ''),
      render: (r) => {
        if (!r.diffValue || (r.diffValue.isZero() && (!r.diffQty || r.diffQty.isZero()))) return <span className="text-muted">—</span>
        return <div title={subject === 'inventory' ? 'Quantity found − quantity in the books, valued at book value ÷ book quantity. An estimate, not a recorded amount.' : subject === 'cash' ? 'Amount found − balance in the books' : 'The value the books carry for an item that was not found as the books describe it. It is what is at stake, not a loss.'}>
          {r.diffQty && <div className="num text-[12.5px] text-warn">{r.diffQty.gt(0) ? '+' : ''}{r.diffQty.toString()}</div>}
          <Money value={subject === 'assets' || subject === 'documents' ? r.diffValue.abs() : r.diffValue} currency={currency} sign={counted} className={cx('text-[12.5px]', r.diffQty ? 'text-muted' : 'text-warn')} />
        </div>
      },
    },
    {
      key: 'note', header: 'Note', sort: (r) => r.value.note.toLowerCase(), csv: (r) => r.value.note,
      render: (r) => (!editable ? <span className="text-[12.5px] text-ink2">{r.value.note || '—'}</span> : (
        <div>
          <input className="field sm" style={{ minWidth: 200 }} aria-label={`Note for ${r.line.label}`} placeholder={!agrees(r.result) && r.result !== 'not_checked' ? 'Required: what was found' : 'Optional'} value={r.value.note} onChange={(e) => set(r.line, { note: e.target.value })} />
          {r.problem && r.dirty && <div className="mt-1 text-[11px] text-warn">{r.problem}</div>}
        </div>
      )),
    },
    ...(!open ? [{
      key: 'case', header: 'Case',
      csv: (r: Row) => cases.data?.get('verification:' + r.line.id)?.case_no ?? '',
      render: (r: Row) => {
        if (agrees(r.line.result) || r.line.result === 'not_checked') return <span className="text-muted">—</span>
        const c = cases.data?.get('verification:' + r.line.id)
        return c ? <button className="link num text-[12.5px]" onClick={() => nav('/reality/cases/' + c.id)}>{c.case_no}</button>
          : <button className="btn sm" disabled={!manage || busy} title={noManage ?? 'Opens a case on this difference'} onClick={() => openCase(r)}><FolderOpen size={13} /> Open a case</button>
      },
    }] : []),
  ]

  const scopeFacts: [string, string][] = Object.entries(scope).flatMap(([k, v]): [string, string][] => {
    if (typeof v !== 'string' || !v) return []
    if (k === 'doc_kind') return [['Kind of document', DOCUMENT_KINDS.find((x) => x.key === v)?.name ?? human(v)]]
    if (k === 'location') return [['Location contains', v]]
    if (k === 'org_unit_id') return [['Unit', unitName(v)]]
    if (k === 'party_id') return [['Party', partyName(v)]]
    const label = k === 'warehouse_id' ? 'Location' : k === 'category_id' ? 'Category' : k === 'box_id' ? 'Cash box' : human(k)
    return [[label, scopeNames.data?.[k] ?? (k === 'warehouse_id' ? lines[0]?.place ?? 'Chosen' : k === 'box_id' && lines.length === 1 ? lines[0].label : 'Chosen — its name is not readable by your role')]]
  })

  return (
    <div>
      <PageHeader
        eyebrow={`NUMERO Reality · Physical verification · ${verifySubjectLabel(run.subject)}`}
        title={`${run.verify_no} · ${verifySubjectLabel(run.subject)}`}
        subtitle={<>{companyName(run.company_id)} · verified on {fmtDate(run.run_date)}{run.performed_by_name ? ` by ${run.performed_by_name}` : ''}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          {open && <button className="btn danger" disabled={!manage || busy} title={noManage ?? 'For a sheet opened by mistake. What was entered stays on it; nothing is raised from it.'} onClick={() => { setReason(''); setCancelling(true) }}><Ban size={14} /> Cancel the sheet</button>}
          {open && <button className="btn" disabled={!manage || busy || !dirty.length || problems.length > 0} title={noManage ?? (problems.length ? 'Some lines need attention first' : !dirty.length ? 'Nothing has been entered since the last save' : undefined)} onClick={save}>{busy ? <Spinner size={14} /> : <Save size={14} />} Save{dirty.length ? ` ${dirty.length} line${dirty.length === 1 ? '' : 's'}` : ''}</button>}
          {open && <button className="btn primary" disabled={!manage || busy || dirty.length > 0} title={noManage ?? (dirty.length ? 'Save what was entered first' : 'Records what was found. Nothing in the books is changed.')} onClick={() => { setWhy(''); setCompleting(true) }}><BadgeCheck size={15} /> Complete the verification</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={open ? 'in_progress' : run.status} label={open ? 'in progress' : undefined} />
        <span className="chip cyan">{verifySubjectLabel(run.subject)}</span>
        {open && savedOpen > 0 && <span className="chip">{savedOpen} not checked yet</span>}
        {dirty.length > 0 && <span className="chip warn">{dirty.length} line{dirty.length === 1 ? '' : 's'} typed and not saved</span>}
      </div>

      <Note className="mb-4">
        A verification records what a person found. <span className="text-ink">It changes nothing in the books</span> — not the asset register, not the stock, not the cash balance. What differs is taken up in a case and corrected by the documents of its own area: an asset disposal or transfer, a stock count adjustment, a cash voucher — each proposed and approved there.
        {run.subject === 'assets' && ' On completion, the result is written to the history of each asset that was checked.'} Each difference is also raised as an alert for review.
      </Note>

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label="On the sheet" sub={<>book value <Money value={summary?.bookValue ?? bookValue} currency={currency} compact /></>}><span className="num">{summary?.lines ?? lines.length}</span></Tile>
        <Tile label={open ? 'Checked so far' : 'Checked'} sub={<Meter value={(summary ? summary.lines - summary.notChecked : lines.length - savedOpen)} max={Math.max(1, summary?.lines ?? lines.length)} tone="cyan" />}>
          <span className="num">{summary ? summary.lines - summary.notChecked : lines.length - savedOpen}</span> <span className="text-[14px] text-muted">of {summary?.lines ?? lines.length}</span>
        </Tile>
        <Tile label="Found as the books say" tone="text-pos" sub="of the items checked"><span className="num">{summary?.agree ?? savedAgree}</span></Tile>
        <Tile label="Found otherwise" tone={(summary?.differ ?? savedDiffer) ? 'text-warn' : undefined} sub={summary?.bookValueOfDifferences ? <>book value concerned <Money value={summary.bookValueOfDifferences} currency={currency} compact /></> : 'of the items checked'}><span className="num">{summary?.differ ?? savedDiffer}</span></Tile>
        <Tile label="Not checked" tone={(summary?.notChecked ?? savedOpen) ? 'text-warn' : undefined} sub="counted neither as agreeing nor as differing"><span className="num">{summary?.notChecked ?? savedOpen}</span></Tile>
      </div>

      {summary && (
        <Panel className="mb-4 p-4 text-[12.5px] text-ink2" lit={false}>
          <span className="font-medium text-ink">Completed {fmtDateTime(run.completed_at)}.</span> Of {summary.lines - summary.notChecked} item{summary.lines - summary.notChecked === 1 ? '' : 's'} checked, {summary.agree} {summary.agree === 1 ? 'was' : 'were'} found as the books describe {summary.agree === 1 ? 'it' : 'them'} and {summary.differ} {summary.differ === 1 ? 'was' : 'were'} not.
          {summary.notChecked > 0 && <> {summary.notChecked} {summary.notChecked === 1 ? 'was' : 'were'} not checked{run.note ? `: ${run.note}` : '.'}</>}
          {summary.method && <div className="mt-1.5 text-[11.5px] text-muted"><span className="text-ink2">How it is counted.</span> {summary.method}</div>}
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[2.4fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="The sheet">
            <Panel lit={false}>
              <DataTable columns={columns} rows={shown} rowKey={(r) => r.line.id} pageSize={50} exportName={`verification-${run.verify_no}`}
                rowClass={(r) => (r.dirty && r.problem ? 'bg-warnsoft' : !agrees(r.result) && r.result !== 'not_checked' ? 'bg-negsoft' : undefined)}
                toolbar={<>
                  <input className="field sm" style={{ width: 210 }} placeholder="Find an item or a place" aria-label="Find on the sheet" value={q} onChange={(e) => setQ(e.target.value)} />
                  <select className="field sm" style={{ width: 190 }} aria-label="Lines shown" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
                    <option value="all">Every line</option><option value="open">Not checked</option><option value="differ">Found otherwise</option>{open && <option value="unsaved">Typed, not saved</option>}
                  </select>
                  <span className="text-[12px] text-muted">{shown.length} of {rows.length} line{rows.length === 1 ? '' : 's'}{editable ? (counted ? ' · leave a line empty if it was not checked' : ' · a note is required unless the item was located') : ''}</span>
                </>}
                empty={{ title: rows.length ? 'No line matches the filter' : 'The sheet is empty', body: rows.length ? undefined : 'No line of this sheet is shared with you.' }} />
            </Panel>
            {problems.length > 0 && (
              <div className="mt-2 rounded-xl border border-warn/30 bg-warnsoft px-3.5 py-2.5 text-[12.5px] text-ink2">
                <span className="font-medium text-warn">{problems.length} line{problems.length === 1 ? '' : 's'} cannot be saved yet.</span> {problems.slice(0, 4).map((r) => `${r.line.label}: ${r.problem}`).join(' · ')}{problems.length > 4 ? ` · and ${problems.length - 4} more` : ''}
              </div>
            )}
            {open && !manage && <div className="mt-2 text-[11.5px] text-muted">You can read this sheet. Entering what was found needs the permission <span className="num">reality.manage</span> in this company.</div>}
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" lit={false}>
              <Fact label="What is verified">{verifySubjectLabel(run.subject)}</Fact>
              <Fact label="Date"><span className="num">{fmtDate(run.run_date)}</span></Fact>
              <Fact label="Performed by">{run.performed_by_name ?? '—'}</Fact>
              <Fact label="Witness">{run.witness_name ?? 'None recorded'}</Fact>
              {scopeFacts.length === 0 ? <Fact label="What was chosen">Everything of this kind in the company</Fact> : scopeFacts.map(([k, v]) => <Fact key={k} label={k}>{v}</Fact>)}
              <Fact label="Sheet prepared">{who(run.created_by)} · {fmtDateTime(run.created_at)}</Fact>
              <Fact label="Completed">{run.completed_at ? <span className="num">{fmtDateTime(run.completed_at)}</span> : 'Not yet'}</Fact>
              {run.note && <Fact label="Note" className="sm:col-span-2 xl:col-span-1 2xl:col-span-2">{run.note}</Fact>}
            </Panel>
          </Section>
          <Attachments companyId={run.company_id} entity="verification_runs" entityId={run.id} title="Evidence — signed sheets and photographs" readOnly={!manage} />
          <History entity="verification_runs" entityId={run.id} />
        </div>
      </div>

      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel the verification" subtitle={`${run.verify_no} · ${verifySubjectLabel(run.subject)} · ${fmtDate(run.run_date)}`} width={520}
        footer={<><button className="btn ghost" onClick={() => setCancelling(false)}>Keep it open</button><button className="btn danger" disabled={busy || !reason.trim()} onClick={cancel}>{busy ? <Spinner /> : <Ban size={15} />} Cancel the sheet</button></>}>
        <div className="space-y-3">
          <Field label="Why the sheet is cancelled (required)"><textarea className="field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="text-[11.5px] text-muted">A cancelled sheet stays on record with its number, what had been entered on it and this reason. No alert is raised from it and it does not count in Reality health. It cannot be opened again: a new verification is started instead.{dirty.length > 0 ? ' What you have entered and not saved is not kept.' : ''}</div>
        </div>
      </Modal>

      <Modal open={completing} onClose={() => setCompleting(false)} title="Complete the verification" subtitle={`${run.verify_no} · ${verifySubjectLabel(run.subject)} · ${fmtDate(run.run_date)}`} width={560}
        footer={<><button className="btn ghost" onClick={() => setCompleting(false)}>Cancel</button><button className="btn primary" disabled={busy || (savedOpen > 0 && !why.trim())} onClick={complete}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Complete</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-line bg-surface p-3"><div className="num text-[18px] text-pos">{savedAgree}</div><div className="text-[11.5px] text-muted">found as the books say</div></div>
            <div className="rounded-xl border border-line bg-surface p-3"><div className={cx('num text-[18px]', savedDiffer ? 'text-warn' : 'text-muted')}>{savedDiffer}</div><div className="text-[11.5px] text-muted">found otherwise</div></div>
            <div className="rounded-xl border border-line bg-surface p-3"><div className={cx('num text-[18px]', savedOpen ? 'text-warn' : 'text-muted')}>{savedOpen}</div><div className="text-[11.5px] text-muted">not checked</div></div>
          </div>
          <Field label={savedOpen > 0 ? `Why ${savedOpen} item${savedOpen === 1 ? ' was' : 's were'} not checked (required)` : 'Note (optional)'} hint={savedOpen > 0 ? 'Items not checked stay not checked. They are counted neither as agreeing nor as differing.' : undefined}>
            <textarea className="field" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          </Field>
          <div className="text-[11.5px] text-muted">Once completed, the sheet can no longer be changed. Nothing in the books is changed by completing it. Each item found otherwise is raised as an alert, and can be taken up in a case from this screen.</div>
          {savedOpen > 0 && !why.trim() && <div className="text-[12px] text-warn">Say why the items were not checked.</div>}
        </div>
      </Modal>
    </div>
  )
}
