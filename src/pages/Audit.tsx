import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, ExternalLink, History, Lock, Search } from 'lucide-react'
import type { AuditEntry } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { downloadCsv } from '@/lib/data'
import { fmtDateTime, iso } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Loading, Modal, Note, PageHeader, Panel } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

const LIMIT = 500
const humanise = (s: string) => s.replace(/[_.]/g, ' ')
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const localDate = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at.slice(0, 10) : iso(d) }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const show = (v: unknown): string => {
  if (v === undefined) return ''
  if (v === null) return 'empty'
  if (typeof v === 'string') return v === '' ? 'empty' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}
const same = (a: unknown, b: unknown) => { try { return JSON.stringify(a) === JSON.stringify(b) } catch { return a === b } }

interface DiffRow { key: string; before: unknown; after: unknown; hasBefore: boolean; hasAfter: boolean; changed: boolean }
function diff(oldValue: unknown, newValue: unknown): DiffRow[] {
  const none = (v: unknown) => v === null || v === undefined
  if (none(oldValue) && none(newValue)) return []
  const o = isRecord(oldValue) ? oldValue : none(oldValue) ? {} : { value: oldValue }
  const n = isRecord(newValue) ? newValue : none(newValue) ? {} : { value: newValue }
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])]
  return keys.map((key) => {
    const hasBefore = key in o, hasAfter = key in n
    return { key, before: o[key], after: n[key], hasBefore, hasAfter, changed: hasBefore !== hasAfter || !same(o[key], n[key]) }
  })
}

const recordLink = (a: AuditEntry): { to: string; label: string } | null => {
  if (!a.entity_id) return null
  if (a.entity === 'journals') return { to: '/journals/' + a.entity_id, label: 'Open the journal' }
  if (a.entity === 'parties' || a.entity === 'party_roles') return { to: '/parties/' + a.entity_id, label: 'Open the party' }
  if (a.entity === 'alerts') return { to: '/sentinel?alert=' + encodeURIComponent(a.entity_id), label: 'Open the Sentinel item' }
  return null
}

export default function Audit() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const allowed = can('audit.view')

  // optional deep link from a record's own timeline: /audit?entity=parties&record=<id>
  const linkedEntity = sp.get('entity') ?? undefined
  const linkedRecord = sp.get('record') ?? undefined

  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const main = useAsync(
    async () => (allowed ? api.listAudit({ companyIds: ids, limit: LIMIT, entity: linkedRecord ? linkedEntity : undefined, entityId: linkedRecord }) : []),
    [api, idsKey, allowed, linkedEntity, linkedRecord],
  )
  const entries = main.data ?? []
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const companyName = (a: AuditEntry) => (a.company_id ? companyById.get(a.company_id)?.name ?? 'Company not shared with you' : 'Group')
  const entities = useMemo(() => [...new Set(entries.map((a) => a.entity))].sort(), [entries])

  const qa = action.trim().toLowerCase(), qw = actor.trim().toLowerCase()
  const rows = entries.filter((a) => {
    if (entity && a.entity !== entity) return false
    if (qa && !a.action.toLowerCase().includes(qa) && !humanise(a.action).toLowerCase().includes(qa)) return false
    if (qw && !(a.actor_name ?? '').toLowerCase().includes(qw)) return false
    const day = localDate(a.at)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })
  const filtered = !!(entity || qa || qw || from || to)
  const selected = selId ? entries.find((a) => String(a.id) === selId) ?? null : null
  const changes = selected ? diff(selected.old_value, selected.new_value) : []
  const link = selected ? recordLink(selected) : null

  const clearLink = () => { const next = new URLSearchParams(sp); next.delete('entity'); next.delete('record'); setSp(next, { replace: true }) }
  const doExport = () => {
    setConfirm(false)
    const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at))
    downloadCsv(`audit-trail${mode === 'demo' ? '-DEMO' : ''}`, ['when', 'who', 'company', 'entity', 'action', 'reason'],
      sorted.map((a) => [a.at, a.actor_name ?? '', companyName(a), a.entity, a.action, a.reason ?? '']))
    useApp.getState().toast('ok', 'Export ready', `${sorted.length.toLocaleString()} audit entr${sorted.length === 1 ? 'y' : 'ies'} exported${mode === 'demo' ? ' (sample data)' : ''}.`)
  }

  if (!allowed) {
    return (
      <div>
        <PageHeader eyebrow="Controls" title="Audit Trail" />
        <Panel>
          <Empty icon={<Lock size={20} />} title="Access to the audit trail is restricted"
            body="Your role does not include the permission to view the audit trail (audit.view) in the selected companies. Ask a group administrator if you need it." />
        </Panel>
      </div>
    )
  }

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', width: 170, render: (a) => <span className="num text-[12.5px]">{fmtDateTime(a.at)}</span>, sort: (a) => a.at },
    { key: 'who', header: 'Who', render: (a) => <span className="text-ink">{a.actor_name ?? (a.actor ? `User ${a.actor.slice(0, 8)}` : 'System')}</span>, sort: (a) => (a.actor_name ?? '').toLowerCase() },
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2" title={companyName(a)}>{a.company_id ? companyById.get(a.company_id)?.code ?? '—' : 'Group'}</span>, sort: (a) => companyName(a) },
    { key: 'entity', header: 'Record type', render: (a) => <span className="chip">{humanise(a.entity)}</span>, sort: (a) => a.entity },
    { key: 'action', header: 'Action', render: (a) => <span className="text-ink2">{sentence(humanise(a.action))}</span>, sort: (a) => a.action },
    { key: 'reason', header: 'Reason', render: (a) => <span className="text-[12.5px] text-ink2">{a.reason?.trim() || <span className="text-muted">—</span>}</span> },
  ]

  const diffColumns: Column<DiffRow>[] = [
    { key: 'key', header: 'Field', render: (r) => <span className={cx('text-[12.5px]', r.changed ? 'font-medium text-gold' : 'text-muted')}>{sentence(humanise(r.key))}</span> },
    { key: 'before', header: 'Before', render: (r) => (r.hasBefore ? <span className={cx('num break-all text-[12.5px]', r.changed ? 'text-neg' : 'text-ink2')}>{show(r.before)}</span> : <span className="text-[12px] text-muted">not recorded</span>) },
    { key: 'after', header: 'After', render: (r) => (r.hasAfter ? <span className={cx('num break-all text-[12.5px]', r.changed ? 'text-pos' : 'text-ink2')}>{show(r.after)}</span> : <span className="text-[12px] text-muted">not recorded</span>) },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Controls"
        title="Audit Trail"
        subtitle={<>Who did what, when and why, across the selected compan{ids.length === 1 ? 'y' : 'ies'}.</>}
      />

      <Note className="mb-4">The audit trail is append-only. Entries cannot be edited or deleted by anyone.</Note>

      {linkedRecord && (
        <Note kind="demo" className="mb-4">
          Showing the history of one record{linkedEntity ? <> of type <span className="text-ink">{humanise(linkedEntity)}</span></> : null}. <button className="link" onClick={clearLink}>Show the whole audit trail</button>
        </Note>
      )}

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !main.data && <Panel><Loading rows={7} label="Loading the audit trail" /></Panel>}

      {main.data && (
        <>
          {entries.length >= LIMIT && (
            <Note kind="warn" className="mb-4">The latest {LIMIT.toLocaleString()} entries are loaded. Older entries exist in the trail but are not shown on this screen.</Note>
          )}
          <Panel lit={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(a) => String(a.id)}
              onRow={(a) => setSelId(String(a.id))}
              initialSort={{ key: 'at', dir: 'desc' }}
              toolbar={<>
                <select className="field sm" style={{ width: 180 }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by record type">
                  <option value="">All record types</option>
                  {entities.map((e) => <option key={e} value={e}>{sentence(humanise(e))}</option>)}
                </select>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm" style={{ width: 170, paddingLeft: 28 }} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action" aria-label="Search by action" />
                </div>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm" style={{ width: 170, paddingLeft: 28 }} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Person" aria-label="Search by person" />
                </div>
                <input className="field sm num" style={{ width: 150 }} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From date" />
                <span className="text-[12px] text-muted">to</span>
                <input className="field sm num" style={{ width: 150 }} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To date" />
                {filtered && <button className="btn sm ghost" onClick={() => { setEntity(''); setAction(''); setActor(''); setFrom(''); setTo('') }}>Clear filters</button>}
                <button className="btn sm ghost ml-auto" onClick={() => setConfirm(true)} disabled={rows.length === 0} title={rows.length ? 'Export every row in the current filter' : 'There is nothing to export'}><Download size={13} /> Export CSV</button>
              </>}
              empty={entries.length === 0
                ? { title: 'No audit entries', body: 'Nothing has been recorded for the selected companies yet.', icon: <History size={20} /> }
                : { title: 'No entry matches these filters', body: 'Change or clear the filters to see more of the trail.', icon: <Search size={20} /> }}
            />
          </Panel>
        </>
      )}

      <Drawer open={!!selected} onClose={() => setSelId(null)} width={640}
        title={selected ? `${sentence(humanise(selected.action))} · ${humanise(selected.entity)}` : ''}
        subtitle={selected && <span className="num">{fmtDateTime(selected.at)}</span>}
        footer={selected && link ? <button className="btn" onClick={() => nav(link.to)}><ExternalLink size={14} /> {link.label}</button> : undefined}>
        {selected && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">Who</div>
                <div className="mt-1 text-[13.5px] text-ink">{selected.actor_name ?? (selected.actor ? `User ${selected.actor.slice(0, 8)}` : 'System')}</div>
                <div className="text-[11.5px] text-muted">{companyName(selected)}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">When</div>
                <div className="num mt-1 text-[13.5px] text-ink">{fmtDateTime(selected.at)}</div>
                <div className="num break-all text-[11.5px] text-muted">{selected.at}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">What</div>
                <div className="mt-1 text-[13.5px] text-ink">{sentence(humanise(selected.action))}</div>
                <div className="text-[11.5px] text-muted">{sentence(humanise(selected.entity))}{selected.entity_id ? <> · <span className="num break-all">{selected.entity_id}</span></> : null}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5">
                <div className="eyebrow">Why</div>
                <div className="mt-1 text-[13.5px] text-ink">{selected.reason?.trim() || <span className="text-muted">No reason was recorded for this action</span>}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="eyebrow">Before and after</div>
                {changes.length > 0 && <span className="chip gold">{changes.filter((c) => c.changed).length} field{changes.filter((c) => c.changed).length === 1 ? '' : 's'} differ</span>}
              </div>
              {changes.length === 0 ? (
                <div className="text-[12.5px] text-muted">No before or after values were recorded with this entry.</div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-line">
                  <DataTable columns={diffColumns} rows={changes} rowKey={(r) => r.key} pageSize={200} rowClass={(r) => (r.changed ? 'bg-goldsoft' : undefined)} />
                </div>
              )}
              <div className="mt-1.5 text-[11.5px] text-muted">Highlighted fields have a different value before and after. Values are shown exactly as recorded.</div>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Export the audit trail" width={480}
        footer={<>
          <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
          <button className="btn primary" onClick={doExport}><Download size={14} /> Export {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}</button>
        </>}>
        <p className="m-0 text-[13.5px] leading-relaxed text-ink2">
          You are about to export <span className="num text-ink">{rows.length.toLocaleString()}</span> audit entr{rows.length === 1 ? 'y' : 'ies'}{filtered ? ' matching the current filters' : ''} to a CSV file named <span className="num text-ink">audit-trail</span>.
        </p>
        <p className="mb-0 mt-2.5 text-[12.5px] text-muted">The file contains names, actions and reasons. Once exported it is outside NUMERO's access controls — store and share it with care.</p>
      </Modal>
    </div>
  )
}
