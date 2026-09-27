import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  ArrowLeft, ArrowRightLeft, BadgeCheck, ClipboardCheck, PackageX, Pencil, Plus, Printer, StickyNote, Tag, TrendingDown, Trash2, UserRound, Wrench,
} from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { AuditEntry, ID } from '@/engine/types'
import type { AssetCategory, AssetDisposalInput, AssetEvent, AssetEventInput, DepreciationLine, DepreciationRun, FixedAsset } from '@/engine/opsTypes'
import { bookValue, depreciationForecast } from '@/engine/ops'
import { D, ZERO, fmtMoney, round2, sum } from '@/lib/money'
import { addMonths, daysBetween, fmtDate, fmtDateTime, fmtMonth, startOfMonth, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { Attachments, CustomFields, ProposedEntries, ProposedNote, Stat, useAccountName, useCompanyName, useMoneyLedgers, usePartyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { AssetFormDrawer } from '@/pages/Assets'

// =====================================================================
// One asset, in full: what it cost, what has been charged, where it is,
// who holds it and everything that has happened to it. Disposal and
// impairment PROPOSE an accounting entry; a second person approves it.
// =====================================================================

type Method = FixedAsset['method']
type EventType = AssetEventInput['event_type']
const METHOD_LABEL: Record<Method, string> = { slm: 'Straight line', wdv: 'Written down value', none: 'Not depreciated' }
const RUN_LABEL: Record<DepreciationRun['status'], string> = { draft: 'draft', proposed: 'awaiting approval', posted: 'posted', reversed: 'reversed', cancelled: 'cancelled' }
const EVENT_LABEL: Record<AssetEvent['event_type'], string> = { assignment: 'Assignment', transfer: 'Transfer', maintenance: 'Maintenance', verification: 'Physical verification', impairment: 'Impairment', disposal: 'Disposal', note: 'Note' }
const EVENT_STATUS: Record<AssetEvent['status'], string> = { recorded: 'recorded', proposed: 'awaiting approval', posted: 'posted', rejected: 'rejected', reversed: 'reversed' }
const RESULTS = ['located', 'transferred', 'damaged', 'missing', 'disposed'] as const
const RESULT_TONE: Record<string, string> = { located: 'pos', transferred: 'cyan', damaged: 'warn', missing: 'neg', disposed: '' }
const DISPOSAL_LABEL: Record<AssetDisposalInput['kind'], string> = { sale: 'Sale', scrap: 'Scrap', write_off: 'Write-off' }
const AUDIT_LABEL: Record<string, string> = { insert: 'registered', update: 'edited' }
const NO_MANAGE = 'Your role does not include the permission to manage fixed assets (asset.manage).'
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const humanise = (s: string) => s.replace(/[_.]/g, ' ')
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const foot = 'border-t border-line2 px-[14px] py-[10px]'

function eventIcon(t: AssetEvent['event_type']) {
  switch (t) {
    case 'assignment': return <UserRound size={14} />
    case 'transfer': return <ArrowRightLeft size={14} />
    case 'maintenance': return <Wrench size={14} />
    case 'verification': return <ClipboardCheck size={14} />
    case 'impairment': return <TrendingDown size={14} />
    case 'disposal': return <PackageX size={14} />
    default: return <StickyNote size={14} />
  }
}

interface Loaded {
  asset: FixedAsset
  categories: AssetCategory[]
  events: AssetEvent[]
  lines: DepreciationLine[]
  runs: DepreciationRun[]
  map: { company_id: ID; key: string; account_id: ID }[]
  audit: { rows: AuditEntry[]; error: string | null }
}

export default function Asset360() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const allKey = companies.map((c) => c.id).join(',')

  const main = useAsync<Loaded | null>(async () => {
    const asset = (await api.listAssets(companies.map((c) => c.id))).find((a) => a.id === id)
    if (!asset) return null
    const [categories, events, lines, runs, map, audit] = await Promise.all([
      api.listAssetCategories([asset.company_id]),
      api.listAssetEvents(asset.id),
      api.getDepreciationLines({ assetId: asset.id }),
      api.listDepreciationRuns([asset.company_id]),
      // the mapping only names the ledger in the preview; the page must load without it
      api.listAccountMap([asset.company_id]).catch(() => [] as Loaded['map']),
      // history needs audit access; the rest of the page must still load without it
      api.listAudit({ entity: 'fixed_assets', entityId: asset.id, limit: 100 }).then(
        (rows) => ({ rows, error: null as string | null }),
        (e: unknown) => ({ rows: [] as AuditEntry[], error: e instanceof Error ? e.message : String(e) }),
      ),
    ])
    return { asset, categories, events, lines, runs, map, audit }
  }, [api, id, allKey])

  if (main.error) return <ErrorBox message={main.error} retry={main.reload} />
  if (main.data === undefined || (main.data && main.data.asset.id !== id)) return <Panel><Loading rows={7} label="Loading the asset" /></Panel>
  if (main.data === null) {
    return (
      <div>
        <PageHeader eyebrow="Fixed asset" title="Asset" />
        <Panel>
          <Empty icon={<PackageX size={20} />} title="Asset not found or not shared with you" body="This asset does not exist, belongs to a company your account cannot access, or is held at a confidentiality level you are not cleared for."
            action={<button className="btn" onClick={() => nav('/assets')}><ArrowLeft size={14} /> Back to the register</button>} />
        </Panel>
      </div>
    )
  }
  return <AssetView key={main.data.asset.id} d={main.data} />
}

interface EventForm { type: EventType; date: string; custodian: ID; unit: ID; location: string; amount: string; work: string; vendor: string; next_due: string; result: string; verified_by: string; note: string }
interface DisposeForm { kind: AssetDisposalInput['kind']; date: string; proceeds: string; bank: ID; buyer: ID; reason: string }
interface ImpairForm { date: string; amount: string; reason: string; assessed_by: string }

function AssetView({ d }: { d: Loaded }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  useApp((s) => s.session)
  const partyName = usePartyName()
  const unitName = useUnitName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const a = d.asset
  const id = a.id
  const company = companies.find((c) => c.id === a.company_id)
  const currency = company?.base_currency
  const category = d.categories.find((c) => c.id === a.category_id)
  const ledgers = useMoneyLedgers(a.company_id)
  const allowed = can('asset.manage', a.company_id)
  const isActive = a.status === 'active'

  const [editing, setEditing] = useState(false)
  const [ev, setEv] = useState<EventForm | null>(null)
  const [dis, setDis] = useState<DisposeForm | null>(null)
  const [imp, setImp] = useState<ImpairForm | null>(null)
  const [printTag, setPrintTag] = useState(false)

  useEffect(() => {
    if (!printTag) return
    const done = () => setPrintTag(false)
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 60)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [printTag])

  // ------------------------------------------------------------ figures
  const cost = D(a.cost)
  const accumulated = D(a.accumulated_depreciation)
  const impairment = D(a.impairment)
  const book = bookValue(a)
  const residual = D(a.salvage_value)
  const remaining = Decimal.max(cost.minus(residual).minus(accumulated), 0)
  const warrantyDays = a.warranty_until ? daysBetween(today(), a.warranty_until) : null

  const people = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === a.company_id) && p.status !== 'terminated').sort((x, y) => x.display_name.localeCompare(y.display_name)), [parties, a.company_id])
  const units = useMemo(() => orgUnits.filter((u) => u.company_id === a.company_id && (u.status === 'active' || u.id === a.org_unit_id)).sort((x, y) => x.type_key.localeCompare(y.type_key) || x.name.localeCompare(y.name)), [orgUnits, a.company_id, a.org_unit_id])
  const unitTypes = [...new Set(units.map((u) => u.type_key))]

  const pendingDisposal = d.events.some((e) => e.event_type === 'disposal' && e.status === 'proposed')
  const pendingImpairment = d.events.some((e) => e.event_type === 'impairment' && e.status === 'proposed')
  const pending = pendingDisposal || pendingImpairment

  // ------------------------------------------------------------ depreciation history and forecast
  interface HistoryRow { line: DepreciationLine; run: DepreciationRun | undefined }
  const history: HistoryRow[] = useMemo(() => {
    const runs = new Map(d.runs.map((r) => [r.id, r]))
    return d.lines.map((line) => ({ line, run: runs.get(line.run_id) })).sort((x, y) => (y.run?.period_month ?? '').localeCompare(x.run?.period_month ?? ''))
  }, [d.lines, d.runs])
  const postedTotal = sum(history.filter((h) => h.run?.status === 'posted').map((h) => h.line.amount))

  const posted = d.runs.filter((r) => r.status === 'posted').map((r) => r.period_month).sort()
  const thisMonth = startOfMonth(today())
  const from = posted.length && addMonths(posted[posted.length - 1], 1) > thisMonth ? addMonths(posted[posted.length - 1], 1) : thisMonth
  const forecast = useMemo(() => depreciationForecast(a, from, 12), [a, from])
  const forecastTotal = sum(forecast.map((f) => f.amount))
  type ForecastRow = ReturnType<typeof depreciationForecast>[number]
  const forecastColumns: Column<ForecastRow>[] = [
    { key: 'month', header: 'Month', render: (f) => <span className="num text-ink">{fmtMonth(f.month)}</span>, csv: (f) => f.month.slice(0, 7) },
    { key: 'amount', header: 'Depreciation (forecast)', align: 'right', render: (f) => <Money value={f.amount} currency={currency} dim />, csv: (f) => f.amount.toFixed(2) },
    { key: 'closing', header: 'Book value at month end (forecast)', align: 'right', render: (f) => <Money value={f.closing} currency={currency} />, csv: (f) => f.closing.toFixed(2) },
  ]

  const historyColumns: Column<HistoryRow>[] = [
    { key: 'month', header: 'Month', render: (h) => <span className="num text-ink">{h.run ? fmtMonth(h.run.period_month) : '—'}</span>, sort: (h) => h.run?.period_month ?? '', csv: (h) => h.run?.period_month.slice(0, 7) ?? '' },
    { key: 'opening', header: 'Opening book value', align: 'right', render: (h) => <Money value={h.line.opening_book_value} currency={currency} dim />, sort: (h) => D(h.line.opening_book_value).toNumber(), csv: (h) => D(h.line.opening_book_value).toFixed(2) },
    { key: 'amount', header: 'Depreciation', align: 'right', render: (h) => <Money value={h.line.amount} currency={currency} className="text-ink" />, sort: (h) => D(h.line.amount).toNumber(), csv: (h) => D(h.line.amount).toFixed(2) },
    { key: 'basis', header: 'How it was calculated', render: (h) => <span className="num text-[12px] text-ink2">{h.line.basis}</span>, csv: (h) => h.line.basis },
    { key: 'status', header: 'Run', render: (h) => (h.run ? <StatusChip status={h.run.status} label={RUN_LABEL[h.run.status]} /> : <span className="text-muted">—</span>), sort: (h) => h.run?.status ?? '', csv: (h) => (h.run ? RUN_LABEL[h.run.status] : '') },
  ]

  // ------------------------------------------------------------ record an event
  const openEvent = () => setEv({ type: 'assignment', date: today(), custodian: a.custodian_party_id ?? '', unit: a.org_unit_id ?? '', location: a.location ?? '', amount: '', work: '', vendor: '', next_due: '', result: 'located', verified_by: '', note: '' })
  const moved = !!ev && (ev.custodian !== (a.custodian_party_id ?? '') || ev.unit !== (a.org_unit_id ?? '') || ev.location.trim() !== (a.location ?? ''))
  const evProblem = !ev ? null
    : !ev.date ? 'Enter the date.'
    : ev.date > today() ? 'The date cannot be in the future.'
    : (ev.type === 'assignment' || ev.type === 'transfer') && !moved ? 'Change the custodian, the department or the location.'
    : ev.type === 'maintenance' && !ev.work.trim() ? 'Describe the work done.'
    : ev.type === 'note' && !ev.note.trim() ? 'Write the note.'
    : null
  const saveEvent = async () => {
    if (!ev) return
    const note = ev.note.trim() || undefined
    let input: AssetEventInput
    if (ev.type === 'assignment' || ev.type === 'transfer') input = { asset_id: id, event_type: ev.type, event_date: ev.date, detail: { custodian_party_id: ev.custodian || null, org_unit_id: ev.unit || null, location: ev.location.trim() || null, ...(note ? { note } : {}) } }
    else if (ev.type === 'maintenance') input = { asset_id: id, event_type: 'maintenance', event_date: ev.date, amount: ev.amount ? ev.amount : null, detail: { work: ev.work.trim(), ...(ev.vendor.trim() ? { vendor: ev.vendor.trim() } : {}), ...(ev.next_due ? { next_due: ev.next_due } : {}), ...(note ? { note } : {}) } }
    else if (ev.type === 'verification') input = { asset_id: id, event_type: 'verification', event_date: ev.date, detail: { result: ev.result, ...(ev.verified_by.trim() ? { verified_by: ev.verified_by.trim() } : {}), ...(note ? { note } : {}) } }
    else input = { asset_id: id, event_type: 'note', event_date: ev.date, detail: { note: ev.note.trim() } }
    const ok = await act(() => api.recordAssetEvent(input), `${EVENT_LABEL[ev.type]} recorded`)
    if (ok) setEv(null)
  }

  // ------------------------------------------------------------ dispose
  const openDispose = () => setDis({ kind: 'sale', date: today(), proceeds: '', bank: ledgers.find((l) => l.control_type === 'bank')?.id ?? ledgers[0]?.id ?? '', buyer: '', reason: '' })
  const proceeds = dis && dis.kind === 'sale' ? round2(D(dis.proceeds)) : ZERO
  const gainOrLoss = proceeds.minus(book) // positive = gain
  const disposalLedger = d.map.find((m) => m.key === 'asset_disposal')?.account_id ?? null
  const disProblem = !dis ? null
    : !dis.date ? 'Enter the date.'
    : dis.date < a.acquisition_date ? 'The disposal date is before the acquisition date.'
    : dis.kind === 'sale' && proceeds.gt(0) && !dis.bank ? 'Choose the bank or cash ledger that received the proceeds.'
    : !dis.reason.trim() ? 'Record the reason.'
    : null
  const saveDispose = async () => {
    if (!dis) return
    const input: AssetDisposalInput = { asset_id: id, date: dis.date, kind: dis.kind, proceeds: proceeds.toString(), bank_ledger_id: proceeds.gt(0) ? dis.bank : null, party_id: dis.kind === 'sale' && dis.buyer ? dis.buyer : null, reason: dis.reason.trim() }
    const j = await act(() => api.proposeAssetDisposal(input), 'Disposal proposed — awaiting approval')
    if (j) setDis(null)
  }

  // ------------------------------------------------------------ impairment
  const impAmount = imp ? round2(D(imp.amount)) : ZERO
  const impProblem = !imp ? null
    : !imp.date ? 'Enter the date.'
    : impAmount.lte(0) ? 'Enter the amount.'
    : impAmount.gt(remaining) ? `The amount cannot exceed the remaining depreciable amount of ${fmtMoney(remaining, { currency })}.`
    : !imp.reason.trim() ? 'Record the basis of the impairment.'
    : null
  const saveImpair = async () => {
    if (!imp) return
    const j = await act(() => api.proposeAssetImpairment({ asset_id: id, date: imp.date, amount: impAmount.toString(), reason: imp.reason.trim(), assessed_by: imp.assessed_by.trim() || undefined }), 'Impairment proposed — awaiting approval')
    if (j) setImp(null)
  }

  // ------------------------------------------------------------ parts
  const fact = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-ink">{value || <span className="text-muted">Not recorded</span>}</span>
    </div>
  )
  const entryLine = (side: 'Dr' | 'Cr', label: string, amount: Decimal) => (
    <div key={side + label} className={cx('flex justify-between gap-3 py-0.5', side === 'Cr' && 'pl-5 text-ink2')}><span className="min-w-0">{side} {label}</span><Money value={amount} currency={currency} /></div>
  )

  const eventBody = (e: AssetEvent): ReactNode[] => {
    const x = e.detail ?? {}
    const out: ReactNode[] = []
    const row = (label: string, value: ReactNode) => out.push(<div key={label}><span className="text-muted">{label}:</span> <span className="text-ink2">{value}</span></div>)
    if (e.event_type === 'assignment' || e.event_type === 'transfer') {
      const was = (x.from ?? {}) as Record<string, unknown>
      const has = (k: string) => Object.prototype.hasOwnProperty.call(x, k)
      const change = (label: string, k: string, show: (v: unknown) => string) => { if (has(k) && (was[k] ?? null) !== (x[k] ?? null)) row(label, <>{show(was[k])} → {show(x[k])}</>) }
      change('Custodian', 'custodian_party_id', (v) => (v ? partyName(v as ID) : 'nobody'))
      change('Department', 'org_unit_id', (v) => (v ? unitName(v as ID) : 'none'))
      change('Location', 'location', (v) => str(v) ?? 'not recorded')
    } else if (e.event_type === 'maintenance') {
      if (str(x.work)) row('Work done', str(x.work))
      if (str(x.vendor)) row('Vendor', str(x.vendor))
      if (str(x.next_due)) row('Next due', fmtDate(str(x.next_due)))
    } else if (e.event_type === 'verification') {
      if (str(x.verified_by)) row('Verified by', str(x.verified_by))
    } else if (e.event_type === 'impairment') {
      if (str(x.reason)) row('Basis', str(x.reason))
      if (str(x.assessed_by)) row('Assessed by', str(x.assessed_by))
    } else if (e.event_type === 'disposal') {
      const kind = str(x.kind)
      if (kind) row('Type', DISPOSAL_LABEL[kind as AssetDisposalInput['kind']] ?? humanise(kind))
      if (x.book_value != null) row('Book value at disposal', <Money value={x.book_value as string} currency={currency} />)
      if (x.gain_or_loss != null && !D(x.gain_or_loss as string).isZero()) row(D(x.gain_or_loss as string).gt(0) ? 'Gain on disposal' : 'Loss on disposal', <Money value={D(x.gain_or_loss as string).abs()} currency={currency} />)
      if (x.buyer_party_id) row('Buyer', partyName(x.buyer_party_id as ID))
      if (str(x.reason)) row('Reason', str(x.reason))
    }
    if (str(x.note)) row('Note', str(x.note))
    return out
  }

  const auditRows = d.audit.rows

  return (
    <>
      {printTag && (
        <div className="hidden print:block">
          <div className="mx-auto mt-10 w-[340px] rounded-xl border border-line2 p-5 text-center">
            <div className="eyebrow">{company?.name ?? ''}</div>
            <div className="mt-2 text-[15px] font-medium">{a.name}</div>
            <div className="num mt-3 break-all text-[17px]">{a.tag_code ?? a.asset_no}</div>
            <div className="num mt-2 text-[12px]">{a.asset_no}{a.serial_no ? ` · serial ${a.serial_no}` : ''}</div>
          </div>
        </div>
      )}
      <div className={cx(printTag && 'print:hidden')}>
        <PageHeader eyebrow="Fixed asset" title={a.name}
          subtitle={<span className="flex flex-wrap items-center gap-2">
            <span className="num text-gold">{a.asset_no}</span>
            <StatusChip status={a.status} />
            <span>·</span><span>{category?.name ?? 'Category not available'}</span>
            <span>·</span><span>{companyName(a.company_id)}</span>
            {mode === 'demo' && <Truth state="DEMO" />}
          </span>}
          actions={<>
            <button className="btn ghost" onClick={() => nav('/assets')}><ArrowLeft size={15} /> Register</button>
            <button className="btn" disabled={!allowed || !isActive} title={!allowed ? NO_MANAGE : !isActive ? `This asset is ${humanise(a.status)} and can no longer be edited.` : 'Edit the register entry'} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
            <button className="btn" disabled={!allowed} title={allowed ? 'Assignment, transfer, maintenance, verification or a note' : NO_MANAGE} onClick={openEvent}><Plus size={14} /> Record an event</button>
            <button className="btn" disabled={!allowed || !isActive || pending || remaining.lte(0)}
              title={!allowed ? NO_MANAGE : !isActive ? `This asset is ${humanise(a.status)}.` : pending ? 'An accounting entry for this asset is already awaiting approval.' : remaining.lte(0) ? 'Nothing is left to depreciate or impair.' : 'Propose an impairment'}
              onClick={() => setImp({ date: today(), amount: '', reason: '', assessed_by: '' })}><TrendingDown size={14} /> Record impairment</button>
            <button className="btn danger" disabled={!allowed || !isActive || pending}
              title={!allowed ? NO_MANAGE : !isActive ? `This asset is already ${humanise(a.status)}.` : pending ? 'An accounting entry for this asset is already awaiting approval.' : 'Propose the sale, scrapping or write-off of this asset'}
              onClick={openDispose}><Trash2 size={14} /> Dispose</button>
          </>} />

        {!isActive && (
          <Note className="mb-4">
            This asset was {a.status === 'written_off' ? 'written off' : 'disposed of'}{a.disposed_on ? ` on ${fmtDate(a.disposed_on)}` : ''}{a.disposal_proceeds != null && D(a.disposal_proceeds).gt(0) ? <> for <Money value={a.disposal_proceeds} currency={currency} className="text-ink" /></> : null}. Its history is kept in full.
            {a.disposal_journal_id && <> <button className="link" onClick={() => nav('/journals/' + a.disposal_journal_id)}>Open the accounting entry</button></>}
          </Note>
        )}
        {pending && <Note kind="warn" className="mb-4">{pendingDisposal ? 'A disposal' : 'An impairment'} of this asset has been proposed and is awaiting approval. The register and the books change only when the entry is posted.</Note>}

        <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Cost" value={cost.toString()} currency={currency} sub="as registered" />
          <Stat label="Accumulated depreciation" value={accumulated.toString()} currency={currency} sub={impairment.gt(0) ? 'includes impairment' : D(a.opening_accumulated).gt(0) ? `includes ${fmtMoney(a.opening_accumulated, { currency })} brought in` : 'posted to date'} />
          <Stat label="Impairment" value={impairment.toString()} currency={currency} tone={impairment.gt(0) ? 'warn' : undefined} sub="posted to date" />
          <Stat label="Book value" value={book.toString()} currency={currency} tone="gold" sub="cost less accumulated" />
          <Stat label="Residual value" value={residual.toString()} currency={currency} sub="never depreciated" />
          <Stat label="Remaining depreciable" value={remaining.toString()} currency={currency} sub="cost − residual − accumulated" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="p-5" lit={false}>
                <div className="eyebrow mb-2">Acquisition and method</div>
                {fact('Acquired', fmtDate(a.acquisition_date))}
                {fact('In service from', fmtDate(a.in_service_date ?? a.acquisition_date))}
                {fact('Method', a.method === 'slm' ? `${METHOD_LABEL.slm} · ${a.life_months ?? '—'} months` : a.method === 'wdv' ? `${METHOD_LABEL.wdv} · ${D(a.wdv_rate).toString()}% a year` : METHOD_LABEL.none)}
                {fact('Vendor', a.vendor_party_id ? <button className="link" onClick={() => nav('/parties/' + a.vendor_party_id)}>{partyName(a.vendor_party_id)}</button> : null)}
                {fact('Source bill', a.source_invoice_id ? <button className="link" onClick={() => nav('/bills/' + a.source_invoice_id)}>Open the vendor's bill</button> : null)}
                {fact('Warranty until', a.warranty_until ? <span>{fmtDate(a.warranty_until)} <span className={cx('chip ml-1', warrantyDays !== null && warrantyDays < 0 ? '' : warrantyDays !== null && warrantyDays <= 30 ? 'warn' : 'pos')}>{warrantyDays !== null && warrantyDays < 0 ? 'expired' : warrantyDays === 0 ? 'ends today' : `${warrantyDays} day${warrantyDays === 1 ? '' : 's'} remaining`}</span></span> : null)}
                {fact('Description', a.description)}
              </Panel>
              <Panel className="p-5" lit={false}>
                <div className="eyebrow mb-2">Where it is and who holds it</div>
                {fact('Department', a.org_unit_id ? unitName(a.org_unit_id) : null)}
                {fact('Custodian', a.custodian_party_id ? <button className="link" onClick={() => nav('/parties/' + a.custodian_party_id)}>{partyName(a.custodian_party_id)}</button> : null)}
                {fact('Location', a.location)}
                {fact('Serial number', a.serial_no ? <span className="num">{a.serial_no}</span> : null)}
                {fact('Confidentiality', humanise(a.confidentiality))}
                {fact('Registered', fmtDateTime(a.created_at))}
                {fact('Notes', a.notes)}
              </Panel>
            </div>

            <Section title="Depreciation history" right={<Truth state="ACTUAL" />}>
              <Panel lit={false}>
                <DataTable<HistoryRow> columns={historyColumns} rows={history} rowKey={(h) => h.line.id} pageSize={12} exportName={`depreciation-history-${a.asset_no}`}
                  onRow={(h) => { if (h.run?.journal_id) nav('/journals/' + h.run.journal_id) }}
                  footer={<tr>
                    <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Posted to the ledger</td>
                    <td className={cx(foot, 'r')}><Money value={postedTotal} currency={currency} className="font-medium text-ink" /></td>
                    <td className={foot} colSpan={2} />
                  </tr>}
                  empty={{ title: 'No depreciation has been calculated', body: a.method === 'none' ? 'This asset is not depreciated.' : 'Depreciation is calculated month by month under Fixed assets → Depreciation.', icon: <TrendingDown size={20} /> }} />
              </Panel>
              {history.length > 0 && <div className="mt-2 text-[11.5px] text-muted">Only runs shown as posted have reached the ledger. Click a row to open its accounting entry.</div>}
            </Section>

            <Section title="Depreciation in the next 12 months" right={<Truth state="FORECAST" />}>
              <Panel lit={false} className="overflow-hidden">
                {forecast.length === 0 || forecastTotal.isZero() ? (
                  <Empty icon={<TrendingDown size={20} />} title="Nothing to forecast" body={!isActive ? `This asset is ${humanise(a.status)}.` : a.method === 'none' ? 'This asset is not depreciated.' : 'Nothing is left to depreciate.'} />
                ) : (
                  <DataTable<ForecastRow> columns={forecastColumns} rows={forecast} rowKey={(f) => f.month} pageSize={12} exportName={`depreciation-forecast-${a.asset_no}`}
                    footer={<tr>
                      <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Twelve months</td>
                      <td className={cx(foot, 'r')}><Money value={forecastTotal} currency={currency} className="font-medium text-ink" /></td>
                      <td className={foot} />
                    </tr>} />
                )}
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">FORECAST — calculated from the asset's recorded method, starting from its present book value. It is not an accounting fact; the figure posted is the one calculated by each monthly run.</div>
            </Section>

            <Section title="Lifecycle" right={<button className="btn sm no-print" disabled={!allowed} title={allowed ? undefined : NO_MANAGE} onClick={openEvent}><Plus size={13} /> Record an event</button>}>
              <Panel className="p-4" lit={false}>
                {d.events.length === 0 ? (
                  <Empty icon={<ClipboardCheck size={20} />} title="Nothing has been recorded yet" body="Assignments, transfers, maintenance, physical verification, impairment and disposal appear here in date order." />
                ) : (
                  <ol className="m-0 list-none p-0">
                    {d.events.map((e, i) => {
                      const body = eventBody(e)
                      const result = e.event_type === 'verification' ? str(e.detail?.result) : null
                      return (
                        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {i < d.events.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-line" aria-hidden="true" />}
                          <span className="grid h-7 w-7 flex-none place-items-center rounded-full border border-line bg-surface2 text-gold">{eventIcon(e.event_type)}</span>
                          <div className="min-w-0 flex-1 text-[12.5px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink">{EVENT_LABEL[e.event_type]}</span>
                              <span className="num text-muted">{fmtDate(e.event_date)}</span>
                              {result && <span className={cx('chip', RESULT_TONE[result] ?? '')}>{result}</span>}
                              {e.status !== 'recorded' && <StatusChip status={e.status} label={EVENT_STATUS[e.status]} />}
                              {e.amount != null && !D(e.amount).isZero() && <span className="ml-auto"><span className="mr-1.5 text-[11.5px] text-muted">{e.event_type === 'disposal' ? 'proceeds' : e.event_type === 'maintenance' ? 'cost' : 'amount'}</span><Money value={e.amount} currency={currency} /></span>}
                            </div>
                            {body.length > 0 && <div className="mt-1 space-y-0.5">{body}</div>}
                            {e.journal_id && <button className="link mt-1 text-[12px]" onClick={() => nav('/journals/' + e.journal_id)}>Open the accounting entry</button>}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </Panel>
            </Section>
          </div>

          <div className="min-w-0 space-y-4">
            <Section title="Asset tag">
              <Panel className="p-4" lit={false}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex-none text-gold"><Tag size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="num break-all rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink">{a.tag_code ?? a.asset_no}</div>
                    <div className="mt-2 text-[11.5px] text-muted">The text the register identifies this asset by. Print it and fix it to the asset so that it can be found during physical verification.</div>
                  </div>
                </div>
                <div className="no-print mt-3 flex justify-end"><button className="btn sm" onClick={() => setPrintTag(true)}><Printer size={13} /> Print tag</button></div>
              </Panel>
            </Section>

            <ProposedEntries companyIds={[a.company_id]} sourceId={id} sources={['asset_disposal', 'asset_impairment']} />
            <Attachments companyId={a.company_id} entity="fixed_assets" entityId={id} />
            <CustomFields companyId={a.company_id} entity="fixed_assets" entityId={id} readOnly={!allowed} />

            <Section title="History">
              {d.audit.error && <Note kind="warn" className="mb-2">The history could not be loaded for your account: {d.audit.error}</Note>}
              <Panel className="max-h-[320px] overflow-auto p-1.5" lit={false}>
                {auditRows.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No change has been recorded.</div> : auditRows.map((r) => (
                  <div key={String(r.id)} className="rounded-lg px-2.5 py-2 text-[12.5px]">
                    <span className="text-ink">{AUDIT_LABEL[r.action] ?? humanise(r.action)}</span> <span className="text-muted">· {r.actor_name ?? 'System'} · {fmtDateTime(r.at)}</span>
                    {r.reason && <div className="text-[12px] text-ink2">{r.reason}</div>}
                  </div>
                ))}
              </Panel>
            </Section>
          </div>
        </div>
      </div>

      <AssetFormDrawer open={editing} onClose={() => setEditing(false)} asset={a} companyIds={[a.company_id]} />

      {/* ---------------------------------------------------------- record an event */}
      <Modal open={!!ev} onClose={() => setEv(null)} title="Record an event" subtitle={`${a.asset_no} · ${a.name}`} width={600}
        footer={<>
          <button className="btn ghost" onClick={() => setEv(null)} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !!evProblem || !allowed} title={allowed ? undefined : NO_MANAGE} onClick={() => void saveEvent()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Record</button>
        </>}>
        {ev && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What happened">
                <select className="field" value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value as EventType })}>
                  {(['assignment', 'transfer', 'maintenance', 'verification', 'note'] as EventType[]).map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" className="field" value={ev.date} max={today()} onChange={(e) => setEv({ ...ev, date: e.target.value })} /></Field>

              {(ev.type === 'assignment' || ev.type === 'transfer') && <>
                <Field label="New custodian" hint={`Now: ${a.custodian_party_id ? partyName(a.custodian_party_id) : 'nobody'}`}>
                  <select className="field" value={ev.custodian} onChange={(e) => setEv({ ...ev, custodian: e.target.value })}>
                    <option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
                  </select>
                </Field>
                <Field label="New department" hint={`Now: ${a.org_unit_id ? unitName(a.org_unit_id) : 'none'}`}>
                  <select className="field" value={ev.unit} onChange={(e) => setEv({ ...ev, unit: e.target.value })}>
                    <option value="">None</option>
                    {unitTypes.map((t) => <optgroup key={t} label={humanise(t)}>{units.filter((u) => u.type_key === t).map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</optgroup>)}
                  </select>
                </Field>
                <Field label="New location" className="sm:col-span-2" hint={`Now: ${a.location ?? 'not recorded'}`}><input className="field" value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} /></Field>
              </>}

              {ev.type === 'maintenance' && <>
                <Field label={`Cost${currency ? ` (${currency})` : ''}`} hint="For information. The cost reaches the books through the vendor's bill."><input className="field num" inputMode="decimal" value={ev.amount} onChange={(e) => setEv({ ...ev, amount: digits(e.target.value) })} /></Field>
                <Field label="Next due"><input type="date" className="field" value={ev.next_due} onChange={(e) => setEv({ ...ev, next_due: e.target.value })} /></Field>
                <Field label="Work done" className="sm:col-span-2"><textarea className="field" rows={2} value={ev.work} onChange={(e) => setEv({ ...ev, work: e.target.value })} /></Field>
                <Field label="Vendor" className="sm:col-span-2">
                  <input className="field" list="asset-event-vendors" value={ev.vendor} onChange={(e) => setEv({ ...ev, vendor: e.target.value })} placeholder="Who carried out the work" />
                  <datalist id="asset-event-vendors">{people.map((p) => <option key={p.id} value={p.display_name} />)}</datalist>
                </Field>
              </>}

              {ev.type === 'verification' && <>
                <Field label="Result">
                  <select className="field" value={ev.result} onChange={(e) => setEv({ ...ev, result: e.target.value })}>
                    {RESULTS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="Verified by"><input className="field" value={ev.verified_by} onChange={(e) => setEv({ ...ev, verified_by: e.target.value })} /></Field>
              </>}

              <Field label={ev.type === 'note' ? 'Note' : 'Note (optional)'} className="sm:col-span-2"><textarea className="field" rows={2} value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} /></Field>
            </div>
            {ev.type === 'verification' && <Note className="mt-4">A verification result never changes the books; a difference raises an alert for review.</Note>}
            {(ev.type === 'assignment' || ev.type === 'transfer') && <Note className="mt-4">The register is updated with the new custodian, department and location. The earlier values are kept in the event. No accounting entry is made.</Note>}
            {evProblem && (ev.note || ev.work || moved) && <div className="mt-3 text-[12px] text-warn">{evProblem}</div>}
          </>
        )}
      </Modal>

      {/* ---------------------------------------------------------- dispose */}
      <Modal open={!!dis} onClose={() => setDis(null)} title="Dispose of this asset" subtitle={`${a.asset_no} · ${a.name}`} width={680}
        footer={<>
          <button className="btn ghost" onClick={() => setDis(null)} disabled={busy}>Cancel</button>
          <button className="btn danger" disabled={busy || !!disProblem || !allowed} title={allowed ? undefined : NO_MANAGE} onClick={() => void saveDispose()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the disposal</button>
        </>}>
        {dis && (
          <>
            <ProposedNote>This proposes the accounting entry shown below. The asset stays active in the register until a second person approves the entry in the approval inbox. NUMERO records that money was received; it does not move money.</ProposedNote>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <select className="field" value={dis.kind} onChange={(e) => setDis({ ...dis, kind: e.target.value as AssetDisposalInput['kind'] })}>
                  {(Object.keys(DISPOSAL_LABEL) as AssetDisposalInput['kind'][]).map((k) => <option key={k} value={k}>{DISPOSAL_LABEL[k]}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" className="field" value={dis.date} min={a.acquisition_date} max={today()} onChange={(e) => setDis({ ...dis, date: e.target.value })} /></Field>
              {dis.kind === 'sale' && <>
                <Field label={`Proceeds${currency ? ` (${currency})` : ''}`}><input className="field num" inputMode="decimal" value={dis.proceeds} onChange={(e) => setDis({ ...dis, proceeds: digits(e.target.value) })} /></Field>
                <Field label="Received in" hint={ledgers.length ? undefined : 'This company has no bank or cash ledger.'}>
                  <select className="field" value={dis.bank} onChange={(e) => setDis({ ...dis, bank: e.target.value })}>
                    <option value="">Choose…</option>{ledgers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
                  </select>
                </Field>
                <Field label="Buyer" className="sm:col-span-2">
                  <select className="field" value={dis.buyer} onChange={(e) => setDis({ ...dis, buyer: e.target.value })}>
                    <option value="">Not recorded</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
                  </select>
                </Field>
              </>}
              <Field label="Reason (required — recorded in the audit trail)" className="sm:col-span-2"><textarea className="field" rows={2} value={dis.reason} onChange={(e) => setDis({ ...dis, reason: e.target.value })} placeholder="Why is the asset leaving the business?" /></Field>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Panel className="p-4 text-[12.5px]" lit={false}>
                <div className="eyebrow mb-2">Figures</div>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Cost</span><Money value={cost} currency={currency} /></div>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Accumulated depreciation</span><Money value={accumulated} currency={currency} /></div>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Book value</span><Money value={book} currency={currency} /></div>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Proceeds</span><Money value={proceeds} currency={currency} /></div>
                <div className="hairline my-2" />
                <div className="flex items-baseline justify-between"><span className="font-medium">{gainOrLoss.isZero() ? 'No gain or loss' : gainOrLoss.gt(0) ? 'Gain on disposal' : 'Loss on disposal'}</span><Money value={gainOrLoss.abs()} currency={currency} className={cx('text-[15px]', gainOrLoss.gt(0) ? 'text-pos' : gainOrLoss.lt(0) ? 'text-neg' : 'text-muted')} /></div>
                <div className="mt-1.5 text-[11.5px] text-muted">Proceeds − book value, using the book value in the register today.</div>
              </Panel>
              <Panel className="p-4 text-[12.5px]" lit={false}>
                <div className="eyebrow mb-2">Entry that will be proposed</div>
                {proceeds.gt(0) && entryLine('Dr', dis.bank ? accountName(dis.bank) : 'Bank or cash ledger', proceeds)}
                {accumulated.gt(0) && entryLine('Dr', category ? accountName(category.accum_account_id) : 'Accumulated depreciation', accumulated)}
                {gainOrLoss.lt(0) && entryLine('Dr', `${disposalLedger ? accountName(disposalLedger) : 'Gain or loss on disposal of assets'} — loss`, gainOrLoss.abs())}
                {gainOrLoss.gt(0) && entryLine('Cr', `${disposalLedger ? accountName(disposalLedger) : 'Gain or loss on disposal of assets'} — gain`, gainOrLoss)}
                {entryLine('Cr', category ? accountName(category.asset_account_id) : 'Asset ledger', cost)}
              </Panel>
            </div>
            {!gainOrLoss.isZero() && !disposalLedger && <Note kind="warn" className="mt-4">No ledger is mapped for the gain or loss on disposal of assets. Map one under Chart of Accounts → Account mapping, otherwise the proposal will be refused.</Note>}
            {disProblem && dis.reason.trim() !== '' && <div className="mt-3 text-[12px] text-warn">{disProblem}</div>}
          </>
        )}
      </Modal>

      {/* ---------------------------------------------------------- impairment */}
      <Modal open={!!imp} onClose={() => setImp(null)} title="Record impairment" subtitle={`${a.asset_no} · ${a.name}`} width={560}
        footer={<>
          <button className="btn ghost" onClick={() => setImp(null)} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !!impProblem || !allowed} title={allowed ? undefined : NO_MANAGE} onClick={() => void saveImpair()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the impairment</button>
        </>}>
        {imp && (
          <>
            <Note className="mb-4">Impairment is an accounting judgement. NUMERO records the amount a responsible person has determined.</Note>
            <ProposedNote>This proposes an accounting entry: impairment loss is debited and accumulated depreciation is credited. It reaches the ledger only after a second person approves it in the approval inbox.</ProposedNote>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date"><input type="date" className="field" value={imp.date} max={today()} onChange={(e) => setImp({ ...imp, date: e.target.value })} /></Field>
              <Field label={`Amount${currency ? ` (${currency})` : ''}`} hint={`Up to ${fmtMoney(remaining, { currency })}, the remaining depreciable amount`}><input className="field num" inputMode="decimal" autoFocus value={imp.amount} onChange={(e) => setImp({ ...imp, amount: digits(e.target.value) })} /></Field>
              <Field label="Basis (required — recorded in the audit trail)" className="sm:col-span-2"><textarea className="field" rows={3} value={imp.reason} onChange={(e) => setImp({ ...imp, reason: e.target.value })} placeholder="What the assessment is based on" /></Field>
              <Field label="Assessed by" className="sm:col-span-2"><input className="field" value={imp.assessed_by} onChange={(e) => setImp({ ...imp, assessed_by: e.target.value })} placeholder="The person or valuer who determined the amount" /></Field>
            </div>
            {impAmount.gt(0) && impAmount.lte(remaining) && (
              <Panel className="mt-4 p-4 text-[12.5px]" lit={false}>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Book value now</span><Money value={book} currency={currency} /></div>
                <div className="flex justify-between py-0.5"><span className="text-ink2">Book value after the impairment is posted</span><Money value={book.minus(impAmount)} currency={currency} className="text-ink" /></div>
              </Panel>
            )}
            {impProblem && imp.amount !== '' && <div className="mt-3 text-[12px] text-warn">{impProblem}</div>}
          </>
        )}
      </Modal>
    </>
  )
}
