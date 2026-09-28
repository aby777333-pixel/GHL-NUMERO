import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, Database, ExternalLink, HardDrive, Lock, Pencil, Plug, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, ToggleLeft, Trash2 } from 'lucide-react'
import type { ID, Role } from '@/engine/types'
import type { BackupCheck, FactRefresh, FeatureFlag, HealthSection, HealthState, Integration, IntegrationKind, SystemHealth as HealthReport } from '@/engine/p3Types'
import { AREAS, CAPABILITIES, capabilityOn, type Capability } from '@/engine/features'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { useCompanyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { DemoTag, Fact, NoAccess, Tile, human, useCompanyChoices, useCompanyCode } from '@/ui/p3'

// =====================================================================
// System health (spec 592, 1275, 1277, 1280, 1428-1434, 1535): NUMERO
// looking at itself. It shows what is measured and says plainly what is
// not: "not recorded" and "not connected" are states of their own, never
// "ok" by default. Backups are made by the database provider; a person
// records them here. The register of integrations holds no secret.
// =====================================================================

type TabKey = 'health' | 'backups' | 'integrations' | 'capabilities' | 'store'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'health', label: 'Health' }, { key: 'backups', label: 'Backups' }, { key: 'integrations', label: 'Integrations' }, { key: 'capabilities', label: 'Capabilities' }, { key: 'store', label: 'Analytical store' },
]

const SECTIONS = ['posting_engine', 'database', 'stock_and_ledger', 'bank_statements', 'alerts', 'storage', 'audit_trail', 'backups', 'analytical_store', 'integrations', 'notifications', 'queues_and_jobs']
const SECTION_LABEL: Record<string, string> = {
  posting_engine: 'Posting engine', database: 'Database', stock_and_ledger: 'Stock against its ledger', bank_statements: 'Bank statements', alerts: 'Alerts and cases', storage: 'Documents in storage',
  audit_trail: 'Audit trail', backups: 'Backups', analytical_store: 'Analytical store', integrations: 'Integrations', notifications: 'Notifications', queues_and_jobs: 'Queues and background jobs',
}
const SECTION_OPEN: Record<string, { label: string; to: string }> = {
  posting_engine: { label: 'Approvals', to: '/approvals' }, stock_and_ledger: { label: 'Inventory', to: '/inventory' }, bank_statements: { label: 'Banking', to: '/banking' }, alerts: { label: 'Sentinel', to: '/sentinel' },
  audit_trail: { label: 'Audit trail', to: '/audit' }, backups: { label: 'Backups', to: '/system?tab=backups' }, analytical_store: { label: 'Analytical store', to: '/system?tab=store' },
  integrations: { label: 'Register', to: '/system?tab=integrations' }, notifications: { label: 'Notifications', to: '/notifications' },
}
/** what the specification asks to be watched (1430), against the sections the engine reports */
const ASKED: { name: string; section: string | null }[] = [
  { name: 'Database', section: 'database' }, { name: 'Posting engine', section: 'posting_engine' }, { name: 'Queues', section: 'queues_and_jobs' }, { name: 'Bank feeds', section: 'bank_statements' },
  { name: 'Integrations', section: 'integrations' }, { name: 'Storage', section: 'storage' }, { name: 'Backups', section: 'backups' }, { name: 'AI', section: null }, { name: 'Notifications', section: 'notifications' },
  { name: 'Reconciliation jobs', section: 'queues_and_jobs' }, { name: 'API', section: null },
]

/** what the specification asks to be observed (1280), and the figure of the engine that answers it — or none */
const WATCHED: { asked: string; from: [section: string, key: string][]; none: string }[] = [
  { asked: 'Missing data', from: [['analytical_store', 'companies_never_refreshed'], ['backups', 'last_backup_recorded'], ['backups', 'last_restore_test_recorded']], none: 'The health report holds no figure for it.' },
  { asked: 'Stale feeds', from: [['bank_statements', 'accounts_without_a_recent_statement'], ['analytical_store', 'companies_with_entries_posted_since']], none: 'The health report holds no figure for it.' },
  { asked: 'Abnormal volumes', from: [], none: 'Not measured. The engine counts volumes and compares them with nothing, so nothing here says whether a volume is abnormal.' },
  { asked: 'Failed jobs', from: [['queues_and_jobs', 'state'], ['queues_and_jobs', 'explanation']], none: 'The health report holds no figure for it.' },
  { asked: 'Posting failures', from: [['posting_engine', 'posted_entries_that_do_not_balance'], ['posting_engine', 'proposed_entries_awaiting_approval']], none: 'The health report holds no figure for it.' },
  { asked: 'Reconciliation left open', from: [['bank_statements', 'statement_lines_unmatched'], ['stock_and_ledger', 'differences']], none: 'The health report holds no figure for it.' },
]

const STATES: { key: HealthState; label: string; lamp: string; tone: string; meaning: string }[] = [
  { key: 'failure', label: 'Failure', lamp: 'neg', tone: 'text-neg', meaning: 'Something that must never happen has happened.' },
  { key: 'attention', label: 'Attention', lamp: 'warn', tone: 'text-warn', meaning: 'It works, and something about it asks for a person.' },
  { key: 'ok', label: 'OK', lamp: 'pos', tone: 'text-pos', meaning: 'Checked, and nothing was found.' },
  { key: 'not_recorded', label: 'Not recorded', lamp: '', tone: 'text-ink', meaning: 'Nobody has recorded it, so nothing is known.' },
  { key: 'not_connected', label: 'Not connected', lamp: '', tone: 'text-ink', meaning: 'It does not exist or nothing is connected.' },
]
const stateOf = (k: string) => STATES.find((s) => s.key === k)

const MONEY_KEYS = ['stock_ledger', 'general_ledger', 'difference']
const LABELS: Record<string, string> = { company_id: 'Company', bytes: 'Size of the documents on the register', on: 'On' }
const label = (k: string) => LABELS[k] ?? human(k).replace(/^\w/, (m) => m.toUpperCase())
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const isDateTime = (s: string) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)
const isNumber = (s: string) => /^-?\d+(\.\d+)?$/.test(s)
const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024).toLocaleString()} KB` : `${n.toLocaleString()} bytes`)
const plain = (v: unknown): string => (v === null || v === undefined ? '' : isPlain(v) ? Object.entries(v).map(([k, x]) => `${label(k)}: ${plain(x)}`).join('; ') : Array.isArray(v) ? v.map(plain).join('; ') : String(v))
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`
const after = (a: string | null | undefined, b: string | null | undefined) => !!a && (!b || Date.parse(a) > Date.parse(b))

interface Loaded { report: HealthReport; ms: number; at: string }

export default function SystemHealth() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const healthIds = scope.filter((id) => can('system.health', id))
  const manageIds = scope.filter((id) => can('integration.manage', id))
  if (!healthIds.length && !manageIds.length) return <NoAccess eyebrow="Platform" title="System health" perm={['system.health', 'integration.manage']} />
  return <View healthIds={healthIds} manageIds={manageIds} />
}

function View({ healthIds, manageIds }: { healthIds: ID[]; manageIds: ID[] }) {
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const touch = useApp((s) => s.touch)
  const [sp, setSp] = useSearchParams()
  const sees = healthIds.length > 0
  const tabs = sees ? TABS : TABS.filter((t) => t.key === 'integrations')
  const wanted = sp.get('tab')
  const tab: TabKey = tabs.find((t) => t.key === wanted)?.key ?? tabs[0].key
  const go = (k: TabKey) => setSp({ tab: k }, { replace: true })
  const [only, setOnly] = useState<HealthState | ''>('')

  // the time the report takes is measured here, in this browser, from the request to the answer
  const health = useAsync(async (): Promise<Loaded | null> => {
    if (!sees) return null
    const t0 = performance.now()
    const report = await api.systemHealth()
    return { report, ms: performance.now() - t0, at: new Date().toISOString() }
  }, [api, sees])
  const report = health.data?.report
  const counts = useMemo(() => new Map(STATES.map((s) => [s.key, Object.values(report ?? {}).filter((x) => x.state === s.key).length])), [report])
  const sampleNote = mode === 'demo' ? report?.database?.explanation : undefined

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="System health"
        subtitle={<>
          NUMERO looking at itself: what is measured, what a person has recorded, and what is not connected. Each part has its own state; there is no score.
          <DemoTag className="ml-2" />
        </>}
        actions={<button className="btn" disabled={health.loading} onClick={() => touch()}>{health.loading ? <Spinner /> : <RefreshCw size={15} />} Refresh</button>}
      />

      {!sees && <Note className="mb-4">Your role includes the register of integrations (<span className="num text-ink">integration.manage</span>) and not the health of the system (<span className="num text-ink">system.health</span>). The other parts of this screen are not shown.</Note>}
      {sampleNote && <Note kind="demo" className="mb-4">{sampleNote}</Note>}

      {sees && report && (
        <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {STATES.map((s) => {
            const n = counts.get(s.key) ?? 0
            return (
              <Tile key={s.key} label={s.label} tone={n > 0 ? s.tone : 'text-muted'} sub={s.meaning} onClick={() => { setOnly(only === s.key ? '' : s.key); go('health') }}>
                <span className="flex items-center gap-2.5"><span className={cx('lamp', s.lamp)} /><span className="num">{n}</span><span className="text-[12px] font-normal text-muted">part{n === 1 ? '' : 's'}</span></span>
              </Tile>
            )
          })}
        </div>
      )}

      <Tabs<TabKey> tabs={tabs} value={tab} onChange={go} />

      {tab === 'health' && (
        health.error ? <ErrorBox message={health.error} retry={health.reload} />
          : !health.data ? <Panel><Loading rows={7} label="Loading the health report" /></Panel>
          : <HealthTab loaded={health.data} only={only} clear={() => setOnly('')} />
      )}
      {tab === 'backups' && <BackupsTab backups={report?.backups} />}
      {tab === 'integrations' && <IntegrationsTab manageIds={manageIds} admin={admin} explanation={typeof report?.integrations?.explanation === 'string' ? report.integrations.explanation : undefined} />}
      {tab === 'capabilities' && <CapabilitiesTab admin={admin} />}
      {tab === 'store' && <StoreTab ids={healthIds} />}
    </div>
  )
}

// =====================================================================
// Health: one panel for each part, with its state, its explanation and its figures
// =====================================================================
function Value({ k, v, companyId }: { k: string; v: unknown; companyId?: ID }) {
  const code = useCompanyCode()
  const companyName = useCompanyName()
  const currency = useApp((s) => s.companies.find((c) => c.id === companyId)?.base_currency)
  if (v === null || v === undefined || v === '') return <span className="text-muted">none on record</span>
  if (typeof v === 'boolean') return <>{v ? 'yes' : 'no'}</>
  if (typeof v === 'number') return k === 'bytes' ? <span className="num" title={`${v.toLocaleString()} bytes`}>{size(v)}</span> : <span className="num">{v.toLocaleString()}</span>
  if (typeof v === 'string') {
    if (k === 'company_id') return <span title={companyName(v)}>{code(v)}</span>
    if (isDate(v)) return <span className="num">{fmtDate(v)}</span>
    if (isDateTime(v)) return <span className="num">{fmtDateTime(v)}</span>
    if (MONEY_KEYS.includes(k) && isNumber(v)) return <Money value={v} currency={currency} />
    if (isNumber(v)) return <span className="num">{v}</span>
    return <>{/^[a-z0-9]+(_[a-z0-9]+)+$/.test(v) ? human(v) : v}</>
  }
  if (Array.isArray(v)) return v.length ? <>{v.map(plain).join(', ')}</> : <span className="text-muted">none</span>
  if (isPlain(v)) {
    return (
      <span className="block space-y-0.5">
        {Object.entries(v).map(([kk, x]) => <span key={kk} className="flex flex-wrap gap-x-2 text-[12.5px]"><span className="text-muted">{label(kk)}</span><span className="text-ink"><Value k={kk} v={x} /></span></span>)}
      </span>
    )
  }
  return <>{String(v)}</>
}

interface FigureRow { key: string; data: Record<string, unknown> }
function FigureTable({ name, title, rows }: { name: string; title: string; rows: Record<string, unknown>[] }) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const columns: Column<FigureRow>[] = keys.map((k) => ({
    key: k, header: label(k), align: MONEY_KEYS.includes(k) || rows.every((r) => typeof r[k] === 'number') ? 'right' : 'left',
    render: (r) => <span className="text-[12.5px]"><Value k={k} v={r.data[k]} companyId={typeof r.data.company_id === 'string' ? r.data.company_id : undefined} /></span>,
    sort: (r) => { const v = r.data[k]; return typeof v === 'number' ? v : typeof v === 'string' && isNumber(v) ? Number(v) : plain(v) },
    csv: (r) => plain(r.data[k]),
  }))
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line">
      <DataTable columns={columns} rows={rows.map((data, i) => ({ key: String(i), data }))} rowKey={(r) => r.key} pageSize={10} exportName={`health-${name}-${title}`}
        toolbar={<span className="text-[12px] font-medium text-ink2">{label(title)}</span>} />
    </div>
  )
}

function SectionPanel({ name, s }: { name: string; s: HealthSection }) {
  const nav = useNavigate()
  const st = stateOf(s.state)
  const open = SECTION_OPEN[name]
  const entries = Object.entries(s).filter(([k]) => k !== 'state' && k !== 'explanation')
  const tables = entries.filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isPlain)) as [string, Record<string, unknown>[]][]
  const facts = entries.filter(([k]) => !tables.some(([t]) => t === k))
  return (
    <Panel className="p-4" lit={false} attention={s.state === 'failure'}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cx('lamp', st?.lamp, s.state === 'failure' && 'pulse')} />
        <h3 className="display m-0 text-[15px] font-medium text-ink">{SECTION_LABEL[name] ?? label(name)}</h3>
        <StatusChip status={s.state} label={st?.label.toLowerCase() ?? human(s.state)} />
        <span className="flex-1" />
        {open && <button className="link inline-flex items-center gap-1 text-[12px]" onClick={() => nav(open.to)}>{open.label} <ExternalLink size={11} /></button>}
      </div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-ink2">{s.explanation ?? <span className="text-muted">The engine gives no explanation for this part.</span>}</div>
      {facts.length > 0 && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          {facts.map(([k, v]) => <Fact key={k} label={label(k)}><Value k={k} v={v} /></Fact>)}
        </div>
      )}
      {tables.map(([k, rows]) => <FigureTable key={k} name={name} title={k} rows={rows} />)}
    </Panel>
  )
}

function HealthTab({ loaded, only, clear }: { loaded: Loaded; only: HealthState | ''; clear: () => void }) {
  const { report, ms, at } = loaded
  const mode = useApp((s) => s.mode)
  // measured against the live database only: the sample data is read whole
  const page = useAsync(async () => (mode === 'live' ? (await import('@/api/supabaseCore')).apiPage() : null), [mode])
  const names = [...SECTIONS.filter((k) => report[k]), ...Object.keys(report).filter((k) => !SECTIONS.includes(k))]
  const shown = names.filter((k) => !only || report[k].state === only)
  const missing = SECTIONS.filter((k) => !report[k])
  const unreported = ASKED.filter((a) => !a.section || !report[a.section]).map((a) => a.name)
  const db = report.database
  const volumes = db ? Object.entries(db).filter(([, v]) => typeof v === 'number') as [string, number][] : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
        <span>{plural(names.length, 'part')} reported at <span className="num">{fmtDateTime(at)}</span>:</span>
        {STATES.map((s) => { const n = names.filter((k) => report[k].state === s.key).length; return <span key={s.key} className="inline-flex items-center gap-1.5"><span className={cx('lamp', s.lamp)} /><span className="num text-ink">{n}</span> {s.label.toLowerCase()}</span> })}
        {only && <button className="btn sm ghost" onClick={clear}>Showing {stateOf(only)?.label.toLowerCase()} only — show all</button>}
      </div>

      {shown.length === 0
        ? <Panel><Empty icon={<Activity size={20} />} title={`No part is in the state “${stateOf(only)?.label.toLowerCase()}”`} action={<button className="btn sm" onClick={clear}>Show every part</button>} /></Panel>
        : <div className="grid items-start gap-4 xl:grid-cols-2">{shown.map((k) => <SectionPanel key={k} name={k} s={report[k]} />)}</div>}

      {(missing.length > 0 || unreported.length > 0) && (
        <Note>
          {missing.length > 0 && <div>The report holds no part for: {missing.map((k) => SECTION_LABEL[k] ?? label(k)).join(', ')}. Nothing is known about {missing.length === 1 ? 'it' : 'them'} from here.</div>}
          {unreported.length > 0 && <div>The specification also names {unreported.join(' and ')}. The health report has no part for {unreported.length === 1 ? 'it' : 'them'}, so this screen shows no state for {unreported.length === 1 ? 'it' : 'them'} rather than an assumed one.</div>}
        </Note>
      )}

      <Section title="What is watched, and by which figure">
        <Panel className="p-1.5" lit={false}>
          {WATCHED.map((w) => {
            const found = w.from.filter(([s, k]) => report[s] && k in report[s])
            return (
              <div key={w.asked} className="grid gap-x-4 gap-y-1 rounded-lg px-2.5 py-2 text-[12.5px] sm:grid-cols-[200px_1fr]">
                <div className="text-ink">{w.asked}</div>
                <div className="min-w-0 space-y-0.5 text-ink2">
                  {found.length === 0 ? <span className="text-muted">{w.none}</span> : found.map(([s, k]) => {
                    const v = report[s][k]
                    return (
                      <div key={s + k} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{SECTION_LABEL[s] ?? label(s)} · {label(k)}</span>
                        <span className="text-ink">{Array.isArray(v) ? <span className="num">{v.length.toLocaleString()}</span> : <Value k={k} v={v} />}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </Panel>
        <div className="mt-2 text-[11.5px] text-muted">Each figure is the one shown in its part above. A figure of zero was counted and found to be zero; “none on record” means that nobody recorded anything.</div>
      </Section>

      <Section title="Scale and speed — only what is measured">
        <Panel className="p-4" lit={false}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {volumes.map(([k, v]) => <Fact key={k} label={label(k)}><span className="num text-[15px]">{v.toLocaleString()}</span></Fact>)}
            <Fact label="Time this report took to load"><span className="num text-[15px]">{ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString()}</span> ms</Fact>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
            {volumes.length ? 'The volumes are those the engine counts in its database part. ' : 'The engine reports no volume in its database part. '}
            The time is measured in this browser, from asking for the report to receiving it, on this device and this connection. It says how long this one report took, not what the system can carry.
            <span className="text-ink2"> Load tests have not been run</span>: no figure exists for millions of entries, and none is claimed. A list is read to its end, a page at a time, and one longer than twenty thousand records (two hundred thousand for the totals of ledgers) is refused with a message rather than cut. {page.data ? <>The API hands over <span className="num text-ink2">{page.data.toLocaleString()}</span> records to one request, as measured in this session.</> : mode === 'demo' ? 'The sample data is held in this browser and is read whole.' : 'How many records the API hands over to one request is being measured.'} Where only the latest records are read, the number is fixed: 200 notices, 300 rows of the trail unless more are asked for, 2,000 movements of stock (5,000 on the page of an item or of a unit, 20,000 of one document), 200 imports, 500 backup records, 50 runs of a scenario.
          </div>
        </Panel>
      </Section>
    </div>
  )
}

// =====================================================================
// Backups: made by the database provider, recorded here by a person
// =====================================================================
const COVERS: Record<BackupCheck['covers'], string> = { database: 'Database', files: 'Files', database_and_files: 'Database and files' }
const KIND_LABEL: Record<BackupCheck['kind'], string> = { backup: 'Backup', restore_test: 'Restore test' }

function BackupsTab({ backups }: { backups: HealthSection | undefined }) {
  const api = useApp((s) => s.api)!
  const list = useAsync(() => api.listBackupChecks(), [api])
  const [recording, setRecording] = useState<BackupCheck['kind'] | null>(null)
  const asOf = today()
  const rows = list.data ?? []
  // the list arrives newest first
  const lastOf = (kind: BackupCheck['kind']) => rows.filter((b) => b.kind === kind && b.outcome === 'succeeded').reduce<BackupCheck | null>((m, b) => (!m || b.performed_on > m.performed_on ? b : m), null)
  const backup = lastOf('backup'), restore = lastOf('restore_test')
  const failed = rows.filter((b) => b.outcome !== 'succeeded').reduce<BackupCheck | null>((m, b) => (!m || b.performed_on > m.performed_on ? b : m), null)
  const readiness = typeof backups?.recovery_readiness === 'string' ? backups.recovery_readiness : null
  const since = (b: BackupCheck) => daysBetween(b.performed_on, asOf)
  const days = (n: number) => (n === 0 ? 'today' : `${plural(n, 'day')} ago`)

  const columns: Column<BackupCheck>[] = [
    { key: 'kind', header: 'Kind', render: (b) => <span className={cx('chip', b.kind === 'restore_test' && 'cyan')}>{KIND_LABEL[b.kind]}</span>, sort: (b) => b.kind, csv: (b) => KIND_LABEL[b.kind] },
    { key: 'on', header: 'Performed on', render: (b) => <div><div className="num text-[12.5px]">{fmtDate(b.performed_on)}</div><div className="text-[11px] text-muted">{days(since(b))}</div></div>, sort: (b) => b.performed_on, csv: (b) => b.performed_on },
    { key: 'outcome', header: 'Outcome', render: (b) => <StatusChip status={b.outcome} />, sort: (b) => b.outcome, csv: (b) => b.outcome },
    { key: 'covers', header: 'Covers', render: (b) => <span className="text-[12.5px] text-ink2">{COVERS[b.covers] ?? human(b.covers)}</span>, sort: (b) => b.covers, csv: (b) => COVERS[b.covers] ?? b.covers },
    { key: 'evidence', header: 'Evidence', render: (b) => <div className="min-w-[220px] break-words text-[12.5px] text-ink2">{b.evidence}{b.note && <div className="text-[11.5px] text-muted">{b.note}</div>}</div>, csv: (b) => b.evidence + (b.note ? ` — ${b.note}` : '') },
    { key: 'point', header: 'Recovery point', render: (b) => (b.recovery_point ? <span className="num text-[12.5px]">{fmtDateTime(b.recovery_point)}</span> : <span className="text-muted">not recorded</span>), sort: (b) => b.recovery_point ?? '', csv: (b) => b.recovery_point ?? '' },
    { key: 'minutes', header: 'Minutes to recover', align: 'right', render: (b) => (b.recovery_minutes != null ? <span className="num">{b.recovery_minutes.toLocaleString()}</span> : <span className="text-muted">not recorded</span>), sort: (b) => b.recovery_minutes ?? -1, csv: (b) => b.recovery_minutes ?? '' },
    { key: 'by', header: 'Performed by', render: (b) => <span className="text-[12.5px] text-ink2">{b.performed_by_name}</span>, sort: (b) => b.performed_by_name.toLowerCase(), csv: (b) => b.performed_by_name },
    { key: 'recorded', header: 'Recorded', render: (b) => <span className="num text-[12.5px]">{fmtDateTime(b.recorded_at)}</span>, sort: (b) => b.recorded_at, csv: (b) => b.recorded_at },
  ]

  return (
    <div className="space-y-4">
      <Note kind="warn">
        Backups are made by the database provider, outside NUMERO. NUMERO cannot see them. What is shown here is what a person has recorded: that a backup was made, that a restore was tested, and what shows it.
        Where nobody has recorded one, the state is <span className="font-medium text-ink">not recorded</span> — never “ok”.
      </Note>

      {list.error ? <ErrorBox message={list.error} retry={list.reload} />
        : !list.data ? <Panel><Loading rows={5} label="Loading the backup records" /></Panel>
        : <>
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Last successful backup on record" tone={!backup ? 'text-ink2' : since(backup) > 7 ? 'text-warn' : undefined}
              sub={backup ? <><span className="num">{fmtDate(backup.performed_on)}</span> · calculated: today less the date recorded</> : 'Nobody has recorded a successful backup'}>
              {backup ? <span className="num">{days(since(backup))}</span> : 'Not recorded'}
            </Tile>
            <Tile label="Last successful restore test on record" tone={!restore ? 'text-ink2' : since(restore) > 120 ? 'text-warn' : undefined}
              sub={restore ? <><span className="num">{fmtDate(restore.performed_on)}</span> · calculated: today less the date recorded{restore.recovery_minutes != null ? ` · recovered in ${restore.recovery_minutes} minutes` : ''}</> : 'Nobody has recorded a successful restore test'}>
              {restore ? <span className="num">{days(since(restore))}</span> : 'Not recorded'}
            </Tile>
            <Tile label="Recovery readiness" sub={backups ? <span className="flex flex-wrap items-center gap-1.5">Backups are <StatusChip status={backups.state} /> in the health report</span> : 'The health report is not loaded'}>
              <span className="text-[15px] leading-snug">{readiness ?? 'Not reported'}</span>
            </Tile>
            <Tile label="Last record that did not succeed" tone={failed ? 'text-warn' : undefined} sub={failed ? <><span className="num">{fmtDate(failed.performed_on)}</span> · {KIND_LABEL[failed.kind].toLowerCase()} · {failed.outcome}</> : 'No failed or partial backup or restore is on record'}>
              {failed ? <span className="num">{days(since(failed))}</span> : 'None'}
            </Tile>
          </div>

          <Panel lit={false}>
            <DataTable columns={columns} rows={rows} rowKey={(b) => b.id} exportName="backup-records" pageSize={25}
              rowClass={(b) => (b.outcome === 'failed' ? 'bg-negsoft' : b.outcome === 'partial' ? 'bg-warnsoft' : undefined)}
              toolbar={<>
                <button className="btn sm primary" onClick={() => setRecording('backup')}><Plus size={13} /> Record a backup</button>
                <button className="btn sm" onClick={() => setRecording('restore_test')}><RotateCcw size={13} /> Record a restore test</button>
                <span className="text-[12px] text-muted">A record cannot be changed or removed afterwards. A mistake is corrected by a further record that says so.</span>
              </>}
              empty={{ title: 'No backup and no restore test is on record', body: 'Nothing is known here about the backups of the database. Record the last backup listed by the database provider, and the last time a restore was tested.', icon: <HardDrive size={20} />, action: <button className="btn sm" onClick={() => setRecording('backup')}><Plus size={13} /> Record a backup</button> }} />
          </Panel>
          <div className="text-[11.5px] text-muted">
            The health report asks for attention when the last successful backup on record is more than 7 days old, when no restore has been tested, or when the last successful restore test is more than 120 days old.
            A backup that has never been restored is not yet proven to be a backup.{list.data.length >= 500 ? ' The newest 500 records are listed; older records exist.' : ''}
          </div>
        </>}

      <BackupModal kind={recording} onClose={() => setRecording(null)} />
    </div>
  )
}

interface BackupDraft { performed_on: string; outcome: BackupCheck['outcome']; covers: BackupCheck['covers']; evidence: string; performed_by_name: string; recovery_point: string; recovery_minutes: string; note: string }

function BackupModal({ kind, onClose }: { kind: BackupCheck['kind'] | null; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const me = useApp((s) => s.session?.user.name ?? '')
  const { act, busy } = useAction()
  const blank = (): BackupDraft => ({ performed_on: today(), outcome: 'succeeded', covers: 'database', evidence: '', performed_by_name: me, recovery_point: '', recovery_minutes: '', note: '' })
  const [f, setF] = useState<BackupDraft>(blank)
  const [shown, setShown] = useState<BackupCheck['kind']>('backup')
  useEffect(() => { if (kind) { setF(blank()); setShown(kind) } }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<BackupDraft>) => setF((x) => ({ ...x, ...p }))
  const restore = shown === 'restore_test'
  const problem = !f.performed_on ? 'State the date.' : f.performed_on > today() ? 'The date cannot be in the future.'
    : f.recovery_point && f.recovery_point.slice(0, 10) > f.performed_on ? 'The recovery point cannot be later than the day it was performed.'
    : !f.evidence.trim() ? 'Record what shows that it was done.'
    : !f.performed_by_name.trim() ? 'Record who did it.'
    : null
  const save = async () => {
    const id = await act(() => api.recordBackupCheck({
      kind: shown, performed_on: f.performed_on, outcome: f.outcome, covers: f.covers, evidence: f.evidence.trim(), performed_by_name: f.performed_by_name.trim(),
      recovery_point: f.recovery_point ? new Date(f.recovery_point).toISOString() : null, recovery_minutes: f.recovery_minutes ? Number(f.recovery_minutes) : null, note: f.note.trim() || null,
    }), restore ? 'Restore test recorded' : 'Backup recorded')
    if (id) onClose()
  }
  return (
    <Modal open={!!kind} onClose={onClose} title={restore ? 'Record a restore test' : 'Record a backup'} width={620}
      subtitle={restore ? 'That a backup was restored somewhere and found to be whole' : 'That the database provider made a backup'}
      footer={<>
        {problem && f.evidence !== '' && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Record</button>
      </>}>
      <Note kind="warn" className="mb-4">This records what was done outside NUMERO. NUMERO makes no backup and restores nothing. The record cannot be changed or removed afterwards: check it before it is saved.</Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Performed on"><input type="date" className="field" value={f.performed_on} max={today()} onChange={(e) => set({ performed_on: e.target.value })} /></Field>
        <Field label="Outcome">
          <select className="field" value={f.outcome} onChange={(e) => set({ outcome: e.target.value as BackupCheck['outcome'] })}><option value="succeeded">Succeeded</option><option value="partial">Partial</option><option value="failed">Failed</option></select>
        </Field>
        <Field label="Covers">
          <select className="field" value={f.covers} onChange={(e) => set({ covers: e.target.value as BackupCheck['covers'] })}>{(Object.keys(COVERS) as BackupCheck['covers'][]).map((k) => <option key={k} value={k}>{COVERS[k]}</option>)}</select>
        </Field>
        <Field label="Performed by" hint="The person or the team"><input className="field" value={f.performed_by_name} onChange={(e) => set({ performed_by_name: e.target.value })} /></Field>
        <Field label="Evidence" className="sm:col-span-2" hint={restore ? 'For example: restored into a separate project; row counts and the trial balance compared.' : 'For example: the reference of the backup in the console of the database provider.'}>
          <textarea className="field" rows={3} value={f.evidence} onChange={(e) => set({ evidence: e.target.value })} autoFocus />
        </Field>
        <Field label="Recovery point" hint="Optional. The moment the backup holds the data of."><input type="datetime-local" className="field" value={f.recovery_point} max={f.performed_on ? f.performed_on + 'T23:59' : undefined} onChange={(e) => set({ recovery_point: e.target.value })} /></Field>
        <Field label="Minutes to recover" hint={restore ? 'Optional. How long the restore took.' : 'Optional. Known only from a restore.'}><input className="field num" inputMode="numeric" value={f.recovery_minutes} onChange={(e) => set({ recovery_minutes: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Note" className="sm:col-span-2"><input className="field" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// =====================================================================
// Register of integrations: what is connected, what it may do, where its secret is kept
// =====================================================================
const KINDS: Record<IntegrationKind, string> = {
  bank: 'Bank', payment_gateway: 'Payment gateway', crm: 'CRM', hr: 'HR', payroll: 'Payroll', pos: 'Point of sale', erp: 'ERP', ecommerce: 'E-commerce', logistics: 'Logistics', ghl_platform: 'GHL platform',
  email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp', speech: 'Speech recognition', ocr: 'Reading of documents', ai_model: 'Language model', tax_portal: 'Tax portal', other: 'Other',
}
const DIRECTIONS: Record<Integration['direction'], string> = { inbound: 'Inbound — NUMERO receives', outbound: 'Outbound — NUMERO gives', both: 'Both ways' }
const STATUSES: Integration['status'][] = ['planned', 'configured', 'testing', 'active', 'suspended', 'retired']
/** what the engine refuses as a secret; the form says so before the button is pressed */
const LOOKS_SECRET = /(sk_live|sk_test|eyj[a-z0-9_-]{10,}|-----begin|password\s*[:=]|api[_-]?key\s*[:=]\s*\S{8,}|secret\s*[:=]\s*\S{8,})/

interface IntegrationDraft {
  id?: ID; company_id: ID | ''; key: string; name: string; kind: IntegrationKind; direction: Integration['direction']; moves_money: boolean; environment: Integration['environment']; status: Integration['status']
  scopes: string; auth_method: string; secret_location: string; owner_name: string; tested_in_sandbox_on: string; last_checked_on: string; notes: string
}
const draftOf = (i?: Integration): IntegrationDraft => ({
  id: i?.id, company_id: i?.company_id ?? '', key: i?.key ?? '', name: i?.name ?? '', kind: i?.kind ?? 'other', direction: i?.direction ?? 'inbound', moves_money: i?.moves_money ?? false, environment: i?.environment ?? 'sandbox',
  status: i?.status ?? 'planned', scopes: (i?.scopes ?? []).join('\n'), auth_method: i?.auth_method ?? '', secret_location: i?.secret_location ?? '', owner_name: i?.owner_name ?? '',
  tested_in_sandbox_on: i?.tested_in_sandbox_on?.slice(0, 10) ?? '', last_checked_on: i?.last_checked_on?.slice(0, 10) ?? '', notes: i?.notes ?? '',
})

function IntegrationsTab({ manageIds, admin, explanation }: { manageIds: ID[]; admin: boolean; explanation?: string }) {
  const api = useApp((s) => s.api)!
  const companyName = useCompanyName()
  const code = useCompanyCode()
  const list = useAsync(() => api.listIntegrations(), [api])
  const [editing, setEditing] = useState<Integration | 'new' | null>(null)
  const [retired, setRetired] = useState(false)
  const rows = list.data ?? []
  const live = rows.filter((i) => i.status !== 'retired')
  const shown = retired ? rows : live
  const active = rows.filter((i) => i.status === 'active')
  const canAdd = manageIds.length > 0
  const noManage = canAdd ? undefined : 'You need the permission integration.manage to change the register'
  const mayChange = (i: Integration) => (i.company_id ? can('integration.manage', i.company_id) : canAdd)

  const columns: Column<Integration>[] = [
    { key: 'name', header: 'Integration', render: (i) => <div className="min-w-0"><div className="text-ink">{i.name}</div><div className="num text-[11px] text-muted">{i.key} · {i.company_id ? code(i.company_id) : 'whole group'}</div></div>, sort: (i) => i.name.toLowerCase(), csv: (i) => `${i.name} (${i.key}) — ${i.company_id ? companyName(i.company_id) : 'Whole group'}` },
    { key: 'kind', header: 'Kind', render: (i) => <span className="chip">{KINDS[i.kind] ?? human(i.kind)}</span>, sort: (i) => i.kind, csv: (i) => KINDS[i.kind] ?? i.kind },
    { key: 'direction', header: 'Direction', render: (i) => <span className="text-[12.5px] text-ink2">{i.direction}</span>, sort: (i) => i.direction, csv: (i) => i.direction },
    { key: 'money', header: 'Can move money', render: (i) => (i.moves_money || i.risk === 'high' ? <span className="chip neg" title="An integration that can move money needs a recorded test in a sandbox before production, and only a Group Super Admin makes it active"><AlertTriangle size={11} /> HIGH RISK</span> : <span className="text-muted">no</span>), sort: (i) => Number(i.moves_money), csv: (i) => (i.moves_money ? 'Yes — HIGH RISK' : 'No') },
    { key: 'env', header: 'Environment', render: (i) => <span className={cx('chip', i.environment === 'production' ? 'gold' : 'cyan')}>{i.environment}</span>, sort: (i) => i.environment, csv: (i) => i.environment },
    { key: 'status', header: 'Status', render: (i) => <StatusChip status={i.status} />, sort: (i) => STATUSES.indexOf(i.status), csv: (i) => i.status },
    { key: 'scopes', header: 'What it may do', render: (i) => (i.scopes.length ? <div className="min-w-[180px] text-[12.5px] text-ink2">{i.scopes.map((s) => <div key={s} className="break-words">{s}</div>)}</div> : <span className="text-muted">not recorded</span>), csv: (i) => i.scopes.join('; ') },
    { key: 'auth', header: 'Authentication', render: (i) => <span className="break-words text-[12.5px] text-ink2">{i.auth_method ?? <span className="text-muted">not recorded</span>}</span>, csv: (i) => i.auth_method ?? '' },
    { key: 'secret', header: 'Where the secret is kept', render: (i) => <span className="break-words text-[12.5px] text-ink2">{i.secret_location ?? <span className="text-muted">not recorded</span>}</span>, csv: (i) => i.secret_location ?? '' },
    { key: 'owner', header: 'Owner', render: (i) => <span className="text-[12.5px] text-ink2">{i.owner_name ?? '—'}</span>, sort: (i) => (i.owner_name ?? '').toLowerCase(), csv: (i) => i.owner_name ?? '' },
    { key: 'tested', header: 'Tested in sandbox', render: (i) => (i.tested_in_sandbox_on ? <span className="num text-[12.5px]">{fmtDate(i.tested_in_sandbox_on)}</span> : <span className={cx('text-[12.5px]', i.moves_money ? 'text-warn' : 'text-muted')}>no test recorded</span>), sort: (i) => i.tested_in_sandbox_on ?? '', csv: (i) => i.tested_in_sandbox_on ?? '' },
    { key: 'checked', header: 'Last checked', render: (i) => (i.last_checked_on ? <span className="num text-[12.5px]">{fmtDate(i.last_checked_on)}</span> : <span className="text-muted">never recorded</span>), sort: (i) => i.last_checked_on ?? '', csv: (i) => i.last_checked_on ?? '' },
    { key: 'notes', header: 'Notes', render: (i) => <div className="min-w-[200px] break-words text-[12.5px] text-ink2">{i.notes ?? '—'}</div>, csv: (i) => i.notes ?? '' },
    { key: 'act', header: '', align: 'right', render: (i) => <button className="btn ghost icon sm" disabled={!mayChange(i)} title={mayChange(i) ? 'Change' : 'You need the permission integration.manage for this integration'} aria-label={`Change ${i.name}`} onClick={(e) => { e.stopPropagation(); setEditing(i) }}><Pencil size={14} /></button> },
  ]

  return (
    <div className="space-y-4">
      <Note kind="warn">
        {active.length === 0 && list.data ? <span className="font-medium text-ink">No outside system is connected today. </span> : null}
        The register records what NUMERO is, or is planned to be, connected to, what each connection may do, and where its secret is kept — never the secret.
        {explanation ? ` ${explanation}` : ''}
        {active.length > 0 ? ` ${plural(active.length, 'integration')} ${active.length === 1 ? 'is' : 'are'} recorded as active: that is what a person recorded, not something this screen has tested.` : ''}
      </Note>

      {list.error ? <ErrorBox message={list.error} retry={list.reload} />
        : !list.data ? <Panel><Loading rows={5} label="Loading the register of integrations" /></Panel>
        : <>
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="On the register" sub={`${plural(rows.length - live.length, 'retired integration')} besides`}><span className="num">{live.length}</span></Tile>
            <Tile label="Recorded as active" sub={active.length ? 'As recorded by a person' : 'Nothing is connected'}><span className="num">{active.length}</span></Tile>
            <Tile label="Can move money" tone={live.some((i) => i.moves_money) ? 'text-warn' : undefined} sub="HIGH RISK — a sandbox test comes first"><span className="num">{live.filter((i) => i.moves_money).length}</span></Tile>
            <Tile label="Planned" sub="Described, and not connected"><span className="num">{live.filter((i) => i.status === 'planned').length}</span></Tile>
          </div>
          <Panel lit={false}>
            <DataTable columns={columns} rows={shown} rowKey={(i) => i.id} onRow={(i) => { if (mayChange(i)) setEditing(i) }} exportName="integrations-register" initialSort={{ key: 'name', dir: 'asc' }}
              toolbar={<>
                <button className="btn sm primary" disabled={!canAdd} title={noManage} onClick={() => setEditing('new')}><Plus size={13} /> Add an integration</button>
                <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Show retired</label>
                <span className="text-[12px] text-muted">Each integration has its own authentication and its own list of what it may do.</span>
              </>}
              empty={{ title: 'The register is empty', body: 'No integration is described. Nothing outside NUMERO is connected.', icon: <Plug size={20} />, action: <button className="btn sm" disabled={!canAdd} title={noManage} onClick={() => setEditing('new')}><Plus size={13} /> Add an integration</button> }} />
          </Panel>
        </>}

      <IntegrationModal value={editing} manageIds={manageIds} admin={admin} onClose={() => setEditing(null)} />
    </div>
  )
}

function IntegrationModal({ value, manageIds, admin, onClose }: { value: Integration | 'new' | null; manageIds: ID[]; admin: boolean; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useCompanyChoices(manageIds)
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const [f, setF] = useState<IntegrationDraft>(draftOf())
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (value) { setF(draftOf(value === 'new' ? undefined : value)); setAsking(false) } }, [value])
  const set = (p: Partial<IntegrationDraft>) => setF((x) => ({ ...x, ...p }))
  const existing = value && value !== 'new' ? value : null
  const text = [f.name, f.scopes, f.auth_method, f.secret_location, f.owner_name, f.notes].join(' ').toLowerCase()
  const future = (d: string) => !!d && d > today()

  const problem = !f.key.trim() ? 'Give the integration a key.' : /\s/.test(f.key.trim()) ? 'The key has no spaces.'
    : !f.name.trim() ? 'Give the integration a name.'
    : LOOKS_SECRET.test(text) ? 'This looks like a key, a password or a token. The register records where a secret is kept, never the secret. Remove it.'
    : future(f.tested_in_sandbox_on) || future(f.last_checked_on) ? 'A test or a check cannot be recorded for a day that has not come.'
    : f.moves_money && f.environment === 'production' && (f.status === 'testing' || f.status === 'active') && !f.tested_in_sandbox_on ? 'An integration that can move money is HIGH RISK. Record its test in a sandbox before it is used in production.'
    : f.moves_money && f.status === 'active' && !admin ? 'Only a Group Super Admin makes active an integration that can move money.'
    : null

  const save = async (reason?: string) => {
    const id = await act(() => api.saveIntegration({
      id: f.id, company_id: f.company_id || null, key: f.key.trim(), name: f.name.trim(), kind: f.kind, direction: f.direction, moves_money: f.moves_money, environment: f.environment, status: f.status,
      scopes: f.scopes.split('\n').map((s) => s.trim()).filter(Boolean), auth_method: f.auth_method.trim() || null, secret_location: f.secret_location.trim() || null, owner_name: f.owner_name.trim() || null,
      tested_in_sandbox_on: f.tested_in_sandbox_on || undefined, last_checked_on: f.last_checked_on || null, notes: f.notes.trim() || null, reason,
    }), existing ? 'Register updated' : 'Added to the register')
    setAsking(false)
    if (id) onClose()
  }

  return (
    <>
      <Modal open={!!value && !asking} onClose={onClose} title={existing ? `Change ${existing.name}` : 'Add an integration'} subtitle="A description for the register. Saving it connects nothing." width={760}
        footer={<>
          {problem && (f.key !== '' || !!existing) && <span className="mr-auto max-w-[460px] text-[12px] text-warn">{problem}</span>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!problem || busy} onClick={() => (existing ? setAsking(true) : void save())}>{busy ? <Spinner /> : <Save size={15} />} {existing ? 'Save the change' : 'Add to the register'}</button>
        </>}>
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-neg/30 bg-negsoft px-3.5 py-2.5 text-[12.5px] text-ink2">
          <Lock size={15} className="mt-[2px] flex-none text-neg" />
          <div><span className="font-medium text-ink">Type no key, no password and no token anywhere in this form.</span> Record where the secret is kept — “environment settings of the hosting platform”, “the vault of the bank portal” — and never the secret. The engine refuses text that looks like one.</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!existing} /></Field>
          <Field label="Key" hint={existing ? 'The key of an integration on the register does not change.' : 'A short name without spaces, for example bank_statements'}><input className="field num" value={f.key} disabled={!!existing} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/\s/g, '_') })} /></Field>
          <Field label="Belongs to" hint={existing ? 'Fixed when the integration was added.' : undefined}>
            <select className="field" value={f.company_id} disabled={!!existing} onChange={(e) => set({ company_id: e.target.value })}>
              <option value="">Whole group</option>
              {existing?.company_id && !companies.some((c) => c.id === existing.company_id) && <option value={existing.company_id}>{companyName(existing.company_id)}</option>}
              {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => set({ kind: e.target.value as IntegrationKind })}>{(Object.keys(KINDS) as IntegrationKind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}</select></Field>
          <Field label="Direction"><select className="field" value={f.direction} onChange={(e) => set({ direction: e.target.value as Integration['direction'] })}>{(Object.keys(DIRECTIONS) as Integration['direction'][]).map((k) => <option key={k} value={k}>{DIRECTIONS[k]}</option>)}</select></Field>
          <Field label="Status"><select className="field" value={f.status} onChange={(e) => set({ status: e.target.value as Integration['status'] })}>{STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></Field>
          <Field label="Environment"><select className="field" value={f.environment} onChange={(e) => set({ environment: e.target.value as Integration['environment'] })}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></Field>
          <Field label="Owner" hint="Who answers for it"><input className="field" value={f.owner_name} onChange={(e) => set({ owner_name: e.target.value })} /></Field>
          <label className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] sm:col-span-2', f.moves_money ? 'border-neg/30 bg-negsoft' : 'border-line')}>
            <input type="checkbox" className="mt-[3px]" checked={f.moves_money} onChange={(e) => set({ moves_money: e.target.checked })} />
            <span><span className="font-medium text-ink">It can move money</span> {f.moves_money && <span className="chip neg ml-1">HIGH RISK</span>}<span className="mt-0.5 block text-muted">It could pay, transfer or collect. It needs a recorded test in a sandbox before it is used in production, and only a Group Super Admin makes it active.</span></span>
          </label>
          <Field label="What it may do" className="sm:col-span-2" hint="One permission on each line, for example: Read statements"><textarea className="field" rows={3} value={f.scopes} onChange={(e) => set({ scopes: e.target.value })} /></Field>
          <Field label="Authentication method" hint="How it proves who it is — not the credential itself"><input className="field" value={f.auth_method} onChange={(e) => set({ auth_method: e.target.value })} /></Field>
          <Field label="Where the secret is kept" hint="The place, never the secret"><input className="field" value={f.secret_location} onChange={(e) => set({ secret_location: e.target.value })} /></Field>
          <Field label="Tested in a sandbox on" hint={existing?.tested_in_sandbox_on ? 'A test on record stays on record; the date can be moved to a later test.' : undefined}><input type="date" className="field" value={f.tested_in_sandbox_on} max={today()} onChange={(e) => set({ tested_in_sandbox_on: e.target.value })} /></Field>
          <Field label="Last checked on"><input type="date" className="field" value={f.last_checked_on} max={today()} onChange={(e) => set({ last_checked_on: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </Modal>
      <ReasonDialog open={asking} title="Why is the register changed?" confirm="Save the change" onCancel={() => setAsking(false)}
        body={existing && <>The description of <span className="text-ink">{existing.name}</span> is changed. What it said before stays in the audit trail.</>}
        onConfirm={(reason) => void save(reason)} />
    </>
  )
}

// =====================================================================
// Capabilities: switched on or off for the group, a company or a role
// =====================================================================
const CAP_CLS: Record<Capability['state'], string> = { working: 'pos', partial: 'warn', 'recorded only': 'cyan', 'not connected': '' }
const sameScope = (f: FeatureFlag, company: ID | null, role: string | null) => (f.company_id ?? null) === company && (f.role_key ?? null) === role

function CapabilitiesTab({ admin }: { admin: boolean }) {
  const api = useApp((s) => s.api)!
  const companyName = useCompanyName()
  const flags = useAsync(() => api.listFeatureFlags(), [api])
  // roles are read from Team & Access; a role that cannot read them still sees the switches, with the key of the role
  const roles = useAsync(async () => { try { return await api.listRoles() } catch { return null } }, [api])
  const [open, setOpen] = useState<string | null>(null)
  const [area, setArea] = useState('')
  const [switched, setSwitched] = useState(false)
  const all = flags.data ?? []
  const roleName = (k: string | null) => (k ? roles.data?.find((r) => r.key === k)?.name ?? k : 'every role')
  const where = (f: Pick<FeatureFlag, 'company_id' | 'role_key'>) => `${f.company_id ? companyName(f.company_id) : 'whole group'}${f.role_key ? ` · role ${roleName(f.role_key)}` : ''}`
  const areas = AREAS.filter((a) => CAPABILITIES.some((c) => c.area === a && (!switched || all.some((f) => f.module === c.key))))
  const shownAreas = areas.filter((a) => !area || a === area)

  const columns: Column<FeatureFlag>[] = [
    { key: 'module', header: 'Capability', render: (f) => { const c = CAPABILITIES.find((x) => x.key === f.module); return <div><div className="text-ink">{c?.label ?? f.module}</div><div className="num text-[11px] text-muted">{f.module}{c ? ` · ${c.area}` : ' · not in the list of capabilities'}</div></div> }, sort: (f) => f.module, csv: (f) => f.module },
    { key: 'company', header: 'Company', render: (f) => (f.company_id ? <span className="text-ink2">{companyName(f.company_id)}</span> : <span className="chip cyan">whole group</span>), sort: (f) => (f.company_id ? companyName(f.company_id) : ''), csv: (f) => (f.company_id ? companyName(f.company_id) : 'Whole group') },
    { key: 'role', header: 'Role', render: (f) => <span className="text-ink2">{roleName(f.role_key)}</span>, sort: (f) => f.role_key ?? '', csv: (f) => f.role_key ?? 'Every role' },
    { key: 'on', header: 'Switch', render: (f) => <span className={cx('chip', f.enabled ? 'pos' : 'warn')}>{f.enabled ? 'on' : 'off'}</span>, sort: (f) => Number(f.enabled), csv: (f) => (f.enabled ? 'On' : 'Off') },
    { key: 'note', header: 'Note', render: (f) => <span className="break-words text-[12.5px] text-ink2">{f.note ?? '—'}</span>, csv: (f) => f.note ?? '' },
    { key: 'at', header: 'Set', render: (f) => <span className="num text-[12.5px]">{fmtDateTime(f.set_at)}</span>, sort: (f) => f.set_at, csv: (f) => f.set_at },
  ]

  if (flags.error) return <ErrorBox message={flags.error} retry={flags.reload} />
  if (!flags.data) return <Panel><Loading rows={8} label="Loading the switches" /></Panel>
  return (
    <div className="space-y-4">
      {!admin && <Note>The switches are shown for reference. Only a Group Super Admin switches a capability on or off.</Note>}
      <div className="grid items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Panel className="no-print flex flex-wrap items-center gap-3 px-3.5 py-2.5" lit={false}>
            <select className="field sm" style={{ width: 210 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">Every area</option>{AREAS.filter((a) => CAPABILITIES.some((c) => c.area === a)).map((a) => <option key={a} value={a}>{a}</option>)}</select>
            <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={switched} onChange={(e) => setSwitched(e.target.checked)} /> Only capabilities that have a switch</label>
            <span className="text-[12px] text-muted">{plural(CAPABILITIES.length, 'capability', 'capabilities')} · {plural(all.length, 'switch', 'switches')} on record</span>
          </Panel>
          {shownAreas.length === 0 && <Panel><Empty icon={<ToggleLeft size={20} />} title="No capability has a switch" body="Every capability is on, because none has been switched. Clear the filter to see them all." action={<button className="btn sm" onClick={() => { setSwitched(false); setArea('') }}>Show every capability</button>} /></Panel>}
          {shownAreas.map((a) => (
            <Section key={a} title={a}>
              <Panel className="p-1.5" lit={false}>
                {CAPABILITIES.filter((c) => c.area === a && (!switched || all.some((f) => f.module === c.key))).map((c) => {
                  const mine = all.filter((f) => f.module === c.key)
                  const group = mine.find((f) => sameScope(f, null, null))
                  const narrower = mine.filter((f) => !sameScope(f, null, null))
                  return (
                    <button key={c.key} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-surface2" onClick={() => setOpen(c.key)}>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">{c.label} <span className="num text-[11px] text-muted">{c.key}</span></span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{c.what}</span>
                      </span>
                      <span className="flex flex-none flex-wrap items-center justify-end gap-1.5" style={{ maxWidth: 300 }}>
                        <span className={cx('chip', CAP_CLS[c.state])}>{c.state}</span>
                        {c.core ? <span className="chip gold" title="The application cannot be run without it, so it is never switched off"><Lock size={11} /> core — always on</span>
                          : group ? <span className={cx('chip', group.enabled ? 'pos' : 'warn')}>{group.enabled ? 'on' : 'off'} for the group</span>
                          : <span className="chip" title="No switch exists for the whole group, so the capability is on">on — no switch</span>}
                        {!c.core && narrower.length > 0 && <span className="chip cyan">{plural(narrower.length, 'narrower switch', 'narrower switches')}</span>}
                        {c.core && mine.length > 0 && <span className="chip" title="Switches on record for a core capability decide nothing">{plural(mine.length, 'switch', 'switches')} without effect</span>}
                      </span>
                    </button>
                  )
                })}
              </Panel>
            </Section>
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
            <div className="eyebrow mb-2">Which switch decides</div>
            <div>The most specific switch decides, in this order:</div>
            <ol className="m-0 mt-1 list-decimal space-y-1 pl-4">
              <li>the switch for the company <span className="text-muted">and</span> a role the person holds in it;</li>
              <li>the switch for the company;</li>
              <li>the switch for a role the person holds, for the whole group;</li>
              <li>the switch for the whole group.</li>
            </ol>
            <ul className="m-0 mt-2 list-disc space-y-1 pl-4">
              <li>Where no switch exists, the capability is on.</li>
              <li>Where two switches of the same rank disagree — a person with two roles — the capability stays on.</li>
              <li>A person who works in several companies sees the capability when it is on in at least one of them.</li>
              <li>A capability marked core is never switched off.</li>
            </ul>
          </Panel>
          <Note kind="warn">Switching a capability off hides its screen from the menu. It removes no data and changes no permission: the records stay in the books, and a role keeps what it was granted.</Note>
          {roles.data === null && <Note>The roles could not be read with your role, so a switch for a role is shown by the key of the role.</Note>}
        </div>
      </div>

      <Section title="Switches on record">
        <Panel lit={false}>
          <DataTable columns={columns} rows={all} rowKey={(f) => f.id} onRow={(f) => setOpen(f.module)} exportName="capability-switches"
            empty={{ title: 'No switch is on record', body: 'Every capability is on for everyone whose role includes it.', icon: <ToggleLeft size={20} /> }} />
        </Panel>
      </Section>

      <CapabilityDrawer capKey={open} flags={all} roles={roles.data ?? []} admin={admin} where={where} onClose={() => setOpen(null)} />
    </div>
  )
}

interface SwitchDraft { company_id: ID | ''; role_key: string; enabled: boolean; note: string }

function CapabilityDrawer({ capKey, flags, roles, admin, where, onClose }: { capKey: string | null; flags: FeatureFlag[]; roles: Role[]; admin: boolean; where: (f: Pick<FeatureFlag, 'company_id' | 'role_key'>) => string; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const companies = useApp((s) => s.companies).filter((c) => c.status === 'active')
  const myRoles = useApp((s) => s.roles)
  const scope = useScopeIds()
  const { act, busy } = useAction()
  const [f, setF] = useState<SwitchDraft>({ company_id: '', role_key: '', enabled: false, note: '' })
  const [removing, setRemoving] = useState<FeatureFlag | null>(null)
  const [tryCompany, setTryCompany] = useState<ID>('')
  const [tryRole, setTryRole] = useState('')
  useEffect(() => { if (capKey) { setF({ company_id: '', role_key: '', enabled: false, note: '' }); setTryCompany(''); setTryRole('') } }, [capKey])

  const c = CAPABILITIES.find((x) => x.key === capKey)
  const mine = flags.filter((x) => x.module === capKey)
  const existing = mine.find((x) => sameScope(x, f.company_id || null, f.role_key || null))
  const noAdmin = admin ? undefined : 'Only a Group Super Admin switches capabilities on or off'
  const problem = !f.note.trim() ? 'Say why, in a note.' : existing && existing.enabled === f.enabled ? `It is already switched ${f.enabled ? 'on' : 'off'} there.` : null
  const company = tryCompany || companies[0]?.id || ''
  const result = capKey && company ? capabilityOn(flags, capKey, [company], { [company]: tryRole ? [tryRole] : [] }) : null
  /** the switches of the rank that decides, for the explanation beside the answer of the engine */
  const deciding = (() => {
    const ranks: [string, FeatureFlag[]][] = [
      ['the switch for the company and the role', tryRole ? mine.filter((x) => sameScope(x, company, tryRole)) : []],
      ['the switch for the company', mine.filter((x) => sameScope(x, company, null))],
      ['the switch for the role, for the whole group', tryRole ? mine.filter((x) => sameScope(x, null, tryRole)) : []],
      ['the switch for the whole group', mine.filter((x) => sameScope(x, null, null))],
    ]
    return ranks.find(([, set]) => set.length > 0) ?? null
  })()

  const setSwitch = async () => {
    if (!capKey) return
    const ok = await act(async () => { await api.setFeatureFlag({ module: capKey, company_id: f.company_id || null, role_key: f.role_key || null, enabled: f.enabled, note: f.note.trim() }); return true },
      `${c?.label ?? capKey} switched ${f.enabled ? 'on' : 'off'}`)
    if (ok) { setF((x) => ({ ...x, note: '' })); followMenu() }
  }
  /** the menu reads the switches held by the application: they are read again so that it follows at once */
  const followMenu = () => void useApp.getState().refreshMaster().catch(() => undefined)
  const forMe = capKey ? capabilityOn(flags, capKey, scope, myRoles) : null

  return (
    <Drawer open={!!capKey} onClose={onClose} width={600} title={c?.label ?? capKey ?? 'Capability'} subtitle={c ? `${c.area} · ${c.key}` : 'Not in the list of capabilities'}>
      <div className="space-y-5">
        {c ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('chip', CAP_CLS[c.state])}>{c.state}</span>
              {c.core && <span className="chip gold"><Lock size={11} /> core — always on</span>}
              <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav(c.to)}>Open the screen <ExternalLink size={11} /></button>
            </div>
            <Panel className="grid gap-4 p-4" lit={false}>
              <Fact label="What it does">{c.what}</Fact>
              {c.limits && <Fact label="What it does not do">{c.limits}</Fact>}
              <Fact label="Permission it asks for">{c.perm ? <span className="num text-[12.5px]">{[c.perm].flat().join(' or ')}</span> : 'None of its own'}</Fact>
            </Panel>
          </>
        ) : <Note kind="warn">A switch names “{capKey}”, which is not in the list of capabilities. It decides nothing on the menu.</Note>}

        {c?.core && <Note><span className="font-medium text-ink">This capability cannot be switched off.</span> The application cannot be run without it, so the engine treats it as on whatever switch exists.</Note>}

        <Section title={`Switches for this capability · ${mine.length}`}>
          <Panel className="p-1.5" lit={false}>
            {mine.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No switch exists. The capability is on for everyone whose role includes it.</div> : mine.map((x) => (
              <div key={x.id} className="flex flex-wrap items-start gap-3 rounded-lg px-2.5 py-2">
                <span className={cx('chip mt-[1px]', x.enabled ? 'pos' : 'warn')}>{x.enabled ? 'on' : 'off'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink">{where(x)}</span>
                  <span className="block break-words text-[11.5px] text-muted">{x.note ?? 'No note'} · set {fmtDateTime(x.set_at)}</span>
                </span>
                <button className="btn sm ghost" disabled={!admin || busy} title={noAdmin ?? 'Remove the switch: the next switch in the order decides, or the capability is on'} onClick={() => setRemoving(x)}><Trash2 size={13} /> Remove</button>
              </div>
            ))}
          </Panel>
        </Section>

        {c && !c.core && (
          <Section title="Set a switch">
            <Panel className="p-4" lit={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="For">
                  <select className="field" value={f.company_id} disabled={!admin} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">Whole group</option>{companies.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select>
                </Field>
                <Field label="Role" hint={roles.length ? undefined : 'The roles could not be read.'}>
                  <select className="field" value={f.role_key} disabled={!admin} onChange={(e) => setF({ ...f, role_key: e.target.value })}><option value="">Every role</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
                </Field>
                <div className="sm:col-span-2">
                  <span className="label">Switch</span>
                  <div className="flex flex-wrap items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label="Switch" style={{ width: 'fit-content' }}>
                    {[{ v: true, t: 'On' }, { v: false, t: 'Off' }].map((o) => (
                      <button key={o.t} disabled={!admin} aria-pressed={f.enabled === o.v} onClick={() => setF({ ...f, enabled: o.v })}
                        className={cx('h-[30px] rounded-lg px-4 text-[12px] font-medium transition-colors', f.enabled === o.v ? 'border border-line2 bg-surface2 text-ink' : 'text-muted hover:text-ink2')}>{o.t}</button>
                    ))}
                  </div>
                </div>
                <Field label="Note" className="sm:col-span-2" hint="Why it is switched. Kept with the switch and in the audit trail.">
                  <input className="field" value={f.note} disabled={!admin} onChange={(e) => setF({ ...f, note: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button className="btn primary" disabled={!admin || !!problem || busy} title={noAdmin} onClick={() => void setSwitch()}>{busy ? <Spinner /> : <Save size={15} />} {existing ? 'Replace the switch' : 'Set the switch'}</button>
                {admin && problem && f.note !== '' && <span className="text-[12px] text-warn">{problem}</span>}
                {admin && existing && !problem && <span className="text-[12px] text-muted">A switch exists there, {existing.enabled ? 'on' : 'off'}. It will be replaced.</span>}
              </div>
              {!f.enabled && <div className="mt-3 text-[11.5px] text-muted">Off hides the screen from the menu for {where({ company_id: f.company_id || null, role_key: f.role_key || null })}. No data is removed and no permission is changed.</div>}
            </Panel>
          </Section>
        )}

        {c && (
          <Section title="Who sees it">
            <Panel className="p-4" lit={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="A person in the company"><select className="field" value={company} onChange={(e) => setTryCompany(e.target.value)}>{companies.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>
                <Field label="Holding the role"><select className="field" value={tryRole} onChange={(e) => setTryRole(e.target.value)}><option value="">No role named</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field>
              </div>
              {result !== null && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
                  <span className={cx('chip', result ? 'pos' : 'warn')}>{result ? 'on' : 'off'}</span>
                  <span>{c.core ? 'A core capability is always on.' : deciding ? `Decided by ${deciding[0]}${deciding[1].length > 1 ? ', where switches disagree and the capability stays on' : ''}.` : 'No switch applies, so the capability is on.'}</span>
                </div>
              )}
              {forMe !== null && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12.5px] text-ink2">
                  <span className={cx('chip', forMe ? 'pos' : 'warn')}>{forMe ? 'on' : 'off'}</span>
                  <span>for you, in the {plural(scope.length, 'company', 'companies')} selected, with the roles you hold there.</span>
                </div>
              )}
              <div className="mt-2 text-[11.5px] text-muted">The answer is that of the engine for one company and one role. It says whether the screen is on the menu; whether the person may use it is decided by the permissions of the role.</div>
            </Panel>
          </Section>
        )}
      </div>

      <ReasonDialog open={!!removing} title="Remove the switch" confirm="Remove the switch" danger onCancel={() => setRemoving(null)}
        body={removing && <>The switch “{removing.enabled ? 'on' : 'off'}” for {where(removing)} is removed. The next switch in the order decides; where none exists, the capability is on.</>}
        onConfirm={(reason) => { if (!removing) return; void act(async () => { await api.setFeatureFlag({ module: removing.module, company_id: removing.company_id, role_key: removing.role_key, enabled: null, note: reason }); return true }, 'Switch removed').then((ok) => { if (ok) { setRemoving(null); followMenu() } }) }} />
    </Drawer>
  )
}

// =====================================================================
// Analytical store: monthly totals, derived from posted entries
// =====================================================================
const READ = 1000
interface Posted { times: (string | null)[]; total: number }
interface StoreRow { company_id: ID; refresh: FactRefresh | null; posted: Posted | null; verdict: 'never' | 'behind' | 'current' | 'unknown'; text: ReactNode }

function StoreTab({ ids }: { ids: ID[] }) {
  const api = useApp((s) => s.api)!
  const companyName = useCompanyName()
  const code = useCompanyCode()
  const { act, busy } = useAction()
  const idsKey = ids.join(',')
  const [running, setRunning] = useState<ID | null>(null)
  const refreshes = useAsync(() => api.listFactRefresh(ids), [api, idsKey])
  const journalIds = ids.filter((id) => can('journal.view', id))
  // the newest posted entries of each company, to see whether any was posted after the refresh
  const posted = useAsync(async () => {
    const out = new Map<ID, Posted>()
    await Promise.all(journalIds.map(async (id) => {
      const r = await api.listJournals({ companyIds: [id], status: ['posted', 'reversed'], limit: READ })
      out.set(id, { times: r.rows.map((j) => j.posted_at ?? null), total: r.total })
    }))
    return out
  }, [api, journalIds.join(',')])

  const rows: StoreRow[] = useMemo(() => ids.map((id) => {
    const refresh = (refreshes.data ?? []).find((f) => f.company_id === id) ?? null
    const p = posted.data?.get(id) ?? null
    const reads = can('report.view', id)
    if (!refresh) {
      return { company_id: id, refresh, posted: p, verdict: 'never' as const, text: reads ? 'No refresh is on record: the store holds nothing for this company.' : <>No refresh is returned to your role. Your role does not include <span className="num">report.view</span> here, so this does not prove that none exists.</> }
    }
    if (!journalIds.includes(id)) return { company_id: id, refresh, posted: p, verdict: 'unknown' as const, text: <>Cannot be compared: your role does not list the entries of this company (<span className="num">journal.view</span>).</> }
    if (!p) return { company_id: id, refresh, posted: p, verdict: 'unknown' as const, text: posted.error ? `Cannot be compared: the entries could not be read (${posted.error}).` : 'Reading the entries…' }
    const later = p.times.filter((t) => after(t, refresh.last_posted_at)).length
    const partial = p.total > p.times.length
    if (later > 0) return { company_id: id, refresh, posted: p, verdict: 'behind' as const, text: `${partial ? 'At least ' : ''}${plural(later, 'entry', 'entries')} ${later === 1 ? 'was' : 'were'} posted after the refresh. The store does not hold ${later === 1 ? 'it' : 'them'} yet.` }
    if (p.total > refresh.journals) return { company_id: id, refresh, posted: p, verdict: 'behind' as const, text: `The books hold ${p.total.toLocaleString()} posted entries; the store was built from ${refresh.journals.toLocaleString()}.` }
    if (partial) return { company_id: id, refresh, posted: p, verdict: 'current' as const, text: `No entry among the ${p.times.length.toLocaleString()} newest by date was posted after the refresh, and the count of posted entries (${p.total.toLocaleString()}) is not above that of the store.` }
    if (p.total < refresh.journals) return { company_id: id, refresh, posted: p, verdict: 'current' as const, text: `No entry you can read was posted after the refresh. You read ${p.total.toLocaleString()} posted entries and the store was built from ${refresh.journals.toLocaleString()}: some entries are not shared with you.` }
    return { company_id: id, refresh, posted: p, verdict: 'current' as const, text: 'No entry was posted after the refresh.' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [idsKey, refreshes.data, posted.data, posted.error])

  const run = async (id: ID) => {
    setRunning(id)
    await act(() => api.refreshFacts(id), (r) => `${companyName(id)}: ${plural(r.rows, 'monthly total')} rebuilt from ${plural(r.journals, 'posted entry', 'posted entries')}`)
    setRunning(null)
  }
  const count = (v: StoreRow['verdict']) => rows.filter((r) => r.verdict === v).length
  const VERDICT: Record<StoreRow['verdict'], { label: string; cls: string }> = { never: { label: 'never refreshed', cls: '' }, behind: { label: 'entries posted since', cls: 'warn' }, current: { label: 'up to date', cls: 'pos' }, unknown: { label: 'cannot be compared', cls: '' } }

  const columns: Column<StoreRow>[] = [
    { key: 'company', header: 'Company', render: (r) => <div><div className="text-ink">{companyName(r.company_id)}</div><div className="num text-[11px] text-muted">{code(r.company_id)}</div></div>, sort: (r) => companyName(r.company_id), csv: (r) => companyName(r.company_id) },
    { key: 'refreshed', header: 'Totals last refreshed', render: (r) => (r.refresh ? <div><div className="num text-[12.5px]">{fmtDateTime(r.refresh.refreshed_at)}</div><div className="text-[11px] text-muted">{(() => { const n = daysBetween(r.refresh.refreshed_at.slice(0, 10), today()); return n <= 0 ? 'today' : `${plural(n, 'day')} ago` })()}</div></div> : <span className="text-muted">not on record</span>), sort: (r) => r.refresh?.refreshed_at ?? '', csv: (r) => r.refresh?.refreshed_at ?? '' },
    { key: 'last', header: 'Last posted entry included', render: (r) => (r.refresh?.last_posted_at ? <span className="num text-[12.5px]">{fmtDateTime(r.refresh.last_posted_at)}</span> : <span className="text-muted">{r.refresh ? 'none — no entry was posted' : '—'}</span>), sort: (r) => r.refresh?.last_posted_at ?? '', csv: (r) => r.refresh?.last_posted_at ?? '' },
    { key: 'rows', header: 'Monthly totals held', align: 'right', render: (r) => (r.refresh ? <span className="num">{r.refresh.rows.toLocaleString()}</span> : <span className="text-muted">—</span>), sort: (r) => r.refresh?.rows ?? -1, csv: (r) => r.refresh?.rows ?? '' },
    { key: 'journals', header: 'Posted entries they come from', align: 'right', render: (r) => (r.refresh ? <span className="num">{r.refresh.journals.toLocaleString()}</span> : <span className="text-muted">—</span>), sort: (r) => r.refresh?.journals ?? -1, csv: (r) => r.refresh?.journals ?? '' },
    { key: 'since', header: 'Against the books now', render: (r) => <div className="min-w-[240px]"><span className={cx('chip', VERDICT[r.verdict].cls)}>{VERDICT[r.verdict].label}</span><div className="mt-1 break-words text-[11.5px] text-muted">{r.text}</div></div>, sort: (r) => r.verdict, csv: (r) => VERDICT[r.verdict].label },
    { key: 'act', header: '', align: 'right', render: (r) => <button className="btn sm" disabled={busy} onClick={() => void run(r.company_id)} title="Rebuilds the monthly totals of this company from its posted entries">{running === r.company_id ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh</button> },
  ]

  return (
    <div className="space-y-4">
      {refreshes.error ? <ErrorBox message={refreshes.error} retry={refreshes.reload} />
        : !refreshes.data ? <Panel><Loading rows={4} label="Loading the state of the analytical store" /></Panel>
        : <>
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Companies" sub="Of those selected, where your role includes system.health"><span className="num">{rows.length}</span></Tile>
            <Tile label="Never refreshed" tone={count('never') ? 'text-ink2' : undefined} sub="Nothing is held for them"><span className="num">{count('never')}</span></Tile>
            <Tile label="Entries posted since the refresh" tone={count('behind') ? 'text-warn' : undefined} sub="The store is behind the books"><span className="num">{count('behind')}</span></Tile>
            <Tile label="Monthly totals held" sub="One for each month, ledger and unit"><span className="num">{rows.reduce((n, r) => n + (r.refresh?.rows ?? 0), 0).toLocaleString()}</span></Tile>
          </div>
          <Panel lit={false}>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.company_id} exportName="analytical-store" initialSort={{ key: 'company', dir: 'asc' }}
              rowClass={(r) => (r.verdict === 'behind' ? 'bg-warnsoft' : undefined)}
              toolbar={<span className="text-[12px] text-muted">Nothing refreshes the store on a schedule. It is rebuilt, company by company, when a person asks.</span>} />
          </Panel>
        </>}

      <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
        <div className="mb-2 flex items-center gap-2"><Database size={15} className="text-gold" /><span className="eyebrow">What the analytical store is</span></div>
        <ul className="m-0 list-disc space-y-1 pl-4">
          <li>It holds monthly totals — debit, credit and the number of lines — for each ledger, and for each unit a line was given to. Analysis over years reads these totals and does not make the ledger carry that work.</li>
          <li>It is derived from posted entries only. Drafts and entries awaiting approval are not in it.</li>
          <li>It can always be rebuilt: refreshing replaces the totals of a company with totals worked out afresh from its posted entries. Nothing in the books is changed.</li>
          <li>Reports of record — trial balance, profit and loss, balance sheet, the ledger — read the ledger itself, not the store. A store that is behind makes analysis stale; it never makes the books wrong.</li>
          <li>“Entries posted since” compares the moment each posted entry was posted with the last one the store included, among the {READ.toLocaleString()} newest entries by date, and the count of posted entries with the count the store was built from.</li>
        </ul>
      </Panel>
      <div className="flex items-center gap-2 text-[11.5px] text-muted"><ShieldCheck size={13} /> Refreshing is recorded by the engine with its time; the figures above change only when it is run.</div>
    </div>
  )
}
