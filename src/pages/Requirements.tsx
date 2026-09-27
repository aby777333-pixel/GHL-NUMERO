import { useMemo, useState } from 'react'
import { ClipboardList, DatabaseZap, Download, Search, X } from 'lucide-react'
import type { Requirement } from '@/engine/types'
import { useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv } from '@/lib/data'
import { cx, Drawer, Empty, ErrorBox, Loading, Note, PageHeader, Panel } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Meter } from '@/ui/charts'

const STATUSES = ['NOT STARTED', 'PLANNED', 'IN PROGRESS', 'PARTIAL', 'IMPLEMENTED', 'TESTED', 'BLOCKED', 'NEEDS CLARIFICATION', 'FUTURE PHASE']
const PROMPTS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV']
const norm = (s: string) => (s ?? '').toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
const chipOf = (status: string) => (['IMPLEMENTED', 'TESTED'].includes(status) ? 'pos' : ['PARTIAL', 'IN PROGRESS'].includes(status) ? 'warn' : ['BLOCKED', 'NEEDS CLARIFICATION'].includes(status) ? 'neg' : '')
const COLOR: Record<string, string> = {
  'NOT STARTED': 'var(--line-strong)', PLANNED: 'var(--muted)', 'IN PROGRESS': 'var(--gold)', PARTIAL: 'var(--warn)', IMPLEMENTED: 'var(--pos)', TESTED: 'var(--cyan)',
  BLOCKED: 'var(--neg)', 'NEEDS CLARIFICATION': 'var(--violet)', 'FUTURE PHASE': 'var(--ink-2)',
}
const share = (n: number, total: number) => (total ? ((n / total) * 100).toFixed(1) + '%' : '0.0%')
const isDone = (s: string) => s === 'IMPLEMENTED' || s === 'TESTED'

interface Row extends Requirement { st: string }

export default function Requirements() {
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const isAdmin = useApp((s) => s.session?.isGroupAdmin ?? false)
  const { act, busy } = useAction()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [module, setModule] = useState('')
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState('')
  const [open, setOpen] = useState<Row | null>(null)

  const res = useAsync(() => api.listRequirements(), [api])
  const all: Row[] = useMemo(() => (res.data?.requirements ?? []).map((r) => ({ ...r, st: norm(r.status) })), [res.data])
  const source = res.data?.source ?? ''
  const total = all.length

  const statusList = useMemo(() => [...STATUSES, ...[...new Set(all.map((r) => r.st))].filter((s) => s && !STATUSES.includes(s))], [all])
  const byStatus = useMemo(() => statusList.map((s) => ({ status: s, count: all.filter((r) => r.st === s).length })), [all, statusList])
  const phases = useMemo(() => [...new Set(all.map((r) => r.phase))].sort((a, b) => a - b), [all])
  const byPhase = useMemo(() => phases.map((p) => {
    const rows = all.filter((r) => r.phase === p)
    return { phase: p, total: rows.length, done: rows.filter((r) => isDone(r.st)).length, partial: rows.filter((r) => r.st === 'PARTIAL' || r.st === 'IN PROGRESS').length }
  }), [all, phases])
  const modules = useMemo(() => [...new Set(all.map((r) => r.module))].sort((a, b) => a.localeCompare(b)), [all])
  const byModule = useMemo(() => modules.map((m) => {
    const rows = all.filter((r) => r.module === m)
    return { module: m, total: rows.length, done: rows.filter((r) => isDone(r.st)).length, partial: rows.filter((r) => r.st === 'PARTIAL').length, planned: rows.filter((r) => r.st === 'PLANNED').length }
  }), [all, modules])
  const prompts = useMemo(() => [...PROMPTS, ...[...new Set(all.map((r) => r.prompt))].filter((p) => p && !PROMPTS.includes(p))], [all])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all.filter((r) =>
      (!status || r.st === status) && (!module || r.module === module) && (!prompt || r.prompt === prompt) && (!phase || String(r.phase) === phase) &&
      (!t || r.id.toLowerCase().includes(t) || r.title.toLowerCase().includes(t) || r.text.toLowerCase().includes(t)))
  }, [all, q, status, module, prompt, phase])
  const filtered = Boolean(q.trim() || status || module || prompt || phase)
  const clear = () => { setQ(''); setStatus(''); setModule(''); setPrompt(''); setPhase('') }

  const done = all.filter((r) => isDone(r.st)).length
  const tested = all.filter((r) => r.st === 'TESTED').length
  const maxPhase = Math.max(1, ...byPhase.map((p) => p.total))

  const exportCsv = () => {
    downloadCsv('requirement-ledger', ['ID', 'No', 'Prompt', 'Prompt title', 'Module', 'Requirement', 'Status', 'Phase', 'Evidence', 'Notes', 'Full text'],
      rows.map((r) => [r.id, r.no, r.prompt, r.promptTitle ?? '', r.module, r.title, r.st, r.phase, r.evidence, r.notes, r.text]))
    useApp.getState().toast('ok', 'Export ready', `${rows.length.toLocaleString()} requirement${rows.length === 1 ? '' : 's'} exported.`)
  }
  const sync = () => void act(() => api.syncRequirements(res.data?.requirements ?? []), (n) => `${n.toLocaleString()} requirement row${n === 1 ? '' : 's'} written to the database`)

  const cols: Column<Row>[] = [
    { key: 'id', header: 'ID', width: 100, render: (r) => <span className="num text-[12.5px] text-gold">{r.id}</span>, sort: (r) => r.no },
    { key: 'prompt', header: 'Prompt', width: 80, render: (r) => <span className="num text-[12.5px]" title={r.promptTitle}>{r.prompt}</span>, sort: (r) => prompts.indexOf(r.prompt) },
    { key: 'module', header: 'Module', render: (r) => <span className="text-ink2">{r.module}</span>, sort: (r) => r.module },
    { key: 'title', header: 'Requirement', render: (r) => <span className="text-ink">{r.title}</span>, sort: (r) => r.title },
    { key: 'status', header: 'Status', render: (r) => <span className={cx('chip', chipOf(r.st))}>{r.st}</span>, sort: (r) => statusList.indexOf(r.st) },
    { key: 'phase', header: 'Phase', align: 'right', width: 80, render: (r) => <span className="num">{r.phase}</span>, sort: (r) => r.phase },
    { key: 'evidence', header: 'Evidence', render: (r) => (r.evidence ? <span className="block max-w-[280px] truncate text-[12.5px] text-ink2" title={r.evidence}>{r.evidence}</span> : <span className="text-muted">—</span>) },
  ]

  const moduleCols: Column<(typeof byModule)[number]>[] = [
    { key: 'module', header: 'Module', render: (m) => <span className="text-ink">{m.module}</span>, sort: (m) => m.module, csv: (m) => m.module },
    { key: 'total', header: 'Total', align: 'right', render: (m) => <span className="num">{m.total}</span>, sort: (m) => m.total, csv: (m) => m.total },
    { key: 'done', header: 'Implemented + tested', align: 'right', render: (m) => <span className={cx('num', m.done > 0 && 'text-pos')}>{m.done}</span>, sort: (m) => m.done, csv: (m) => m.done },
    { key: 'partial', header: 'Partial', align: 'right', render: (m) => <span className={cx('num', m.partial > 0 && 'text-warn')}>{m.partial}</span>, sort: (m) => m.partial, csv: (m) => m.partial },
    { key: 'planned', header: 'Planned', align: 'right', render: (m) => <span className="num text-ink2">{m.planned}</span>, sort: (m) => m.planned, csv: (m) => m.planned },
    { key: 'meter', header: 'Implemented + tested of total', width: 220, render: (m) => <div className="flex items-center gap-2.5"><Meter value={m.done} max={m.total} tone="pos" /><span className="num w-[48px] flex-none text-right text-[11.5px] text-muted">{share(m.done, m.total)}</span></div>, sort: (m) => (m.total ? m.done / m.total : 0) },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Zero-omission governance"
        title="Requirement Ledger"
        subtitle={res.data ? <>{total.toLocaleString()} requirement{total === 1 ? '' : 's'} indexed from the specification · source: {source || 'not stated'}</> : undefined}
        actions={total > 0 && mode === 'live' && isAdmin && source !== 'database' ? <button className="btn" disabled={busy} onClick={sync}><DatabaseZap size={14} /> Load ledger into the database</button> : undefined}
      />

      {res.error && <ErrorBox message={res.error} retry={res.reload} />}
      {res.loading && !res.data && <Panel><Loading rows={6} /></Panel>}

      {res.data && total === 0 && (
        <Panel>
          <Empty icon={<ClipboardList size={20} />} title="The requirement ledger is not loaded in this environment"
            body={<>The ledger is generated from the specification by running <span className="num text-ink2">python scripts/build_requirement_ledger.py</span>. In the live system, a Group Super Admin can then load it into the database from this screen.</>}
            action={<button className="btn" onClick={res.reload}>Check again</button>} />
        </Panel>
      )}

      {res.data && total > 0 && (
        <>
          <Note className="mb-4">Nothing in the specification is dropped. A requirement is marked IMPLEMENTED only when the engine and the screen both exist, and TESTED only when an automated test covers it.</Note>

          <div className="mb-4 grid gap-4 xl:grid-cols-[1.15fr_1fr]">
            <Panel className="p-5" lit={false}>
              <div className="mb-3"><div className="eyebrow">Honest summary</div><div className="display mt-0.5 text-[15px]">Where every requirement stands</div></div>
              <div className="flex flex-wrap items-center gap-6">
                <StatusRing data={byStatus} total={total} done={done} onPick={(s) => setStatus(status === s ? '' : s)} />
                <div className="min-w-[240px] flex-1">
                  {byStatus.map((s) => (
                    <button key={s.status} onClick={() => setStatus(status === s.status ? '' : s.status)} aria-pressed={status === s.status}
                      className={cx('flex w-full items-center justify-between gap-3 rounded-md px-2 py-[5px] text-left text-[12.5px] transition-colors hover:bg-surface2', status === s.status && 'bg-surface2')}>
                      <span className="flex min-w-0 items-center gap-2 text-ink2"><i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: COLOR[s.status] ?? 'var(--muted)' }} /><span className="truncate">{s.status}</span></span>
                      <span className="flex flex-none items-center gap-3"><span className="num text-ink">{s.count.toLocaleString()}</span><span className="num w-[52px] text-right text-muted">{share(s.count, total)}</span></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 text-[12px] text-muted">
                <span className="num text-ink2">{done.toLocaleString()}</span> of <span className="num text-ink2">{total.toLocaleString()}</span> ({share(done, total)}) are implemented or tested; <span className="num text-ink2">{tested.toLocaleString()}</span> ({share(tested, total)}) are covered by an automated test.
              </div>
            </Panel>

            <Panel className="p-5" lit={false}>
              <div className="mb-3"><div className="eyebrow">By phase</div><div className="display mt-0.5 text-[15px]">Requirements in each delivery phase</div></div>
              <div className="space-y-2.5">
                {byPhase.map((p) => (
                  <button key={p.phase} onClick={() => setPhase(phase === String(p.phase) ? '' : String(p.phase))} aria-pressed={phase === String(p.phase)}
                    className={cx('block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface2', phase === String(p.phase) && 'bg-surface2')}>
                    <div className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="text-ink2">Phase <span className="num text-ink">{p.phase}</span></span>
                      <span className="text-muted"><span className="num text-ink">{p.total.toLocaleString()}</span> · <span className="num text-pos">{p.done}</span> done · <span className="num text-warn">{p.partial}</span> under way</span>
                    </div>
                    <div className="mt-1.5 flex h-[7px] overflow-hidden rounded-full bg-surface2" style={{ width: `${Math.max(4, (p.total / maxPhase) * 100)}%` }}>
                      <div style={{ width: `${(p.done / p.total) * 100}%`, background: 'var(--pos)' }} />
                      <div style={{ width: `${(p.partial / p.total) * 100}%`, background: 'var(--warn)' }} />
                      <div style={{ flex: 1, background: 'var(--line-strong)' }} />
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink2">
                {[['Implemented or tested', 'var(--pos)'], ['Partial or in progress', 'var(--warn)'], ['Everything else', 'var(--line-strong)']].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}
              </div>
              <div className="mt-1.5 text-[11.5px] text-muted">Bar length shows the number of requirements in the phase, relative to the largest phase.</div>
            </Panel>
          </div>

          <Panel className="mb-4 overflow-hidden" lit={false}>
            <div className="border-b border-line px-4 py-2.5"><div className="eyebrow">By module</div></div>
            <DataTable columns={moduleCols} rows={byModule} rowKey={(m) => m.module} onRow={(m) => setModule(module === m.module ? '' : m.module)} pageSize={100} maxHeight={380}
              exportName="requirement-ledger-by-module" initialSort={{ key: 'total', dir: 'desc' }} rowClass={(m) => (m.module === module ? 'bg-surface2' : undefined)} />
          </Panel>

          <Panel className="overflow-hidden" lit={false}>
            <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRow={setOpen} pageSize={50} initialSort={{ key: 'id', dir: 'asc' }}
              empty={{ title: 'No requirement matches these filters', body: 'Clear a filter to see more of the ledger.', action: <button className="btn sm" onClick={clear}>Clear filters</button> }}
              toolbar={<>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm" style={{ width: 230, paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, title or text" aria-label="Search requirements" />
                </div>
                <select className="field sm" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{statusList.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <select className="field sm" style={{ width: 190 }} value={module} onChange={(e) => setModule(e.target.value)} aria-label="Module"><option value="">All modules</option>{modules.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                <select className="field sm" style={{ width: 130 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt"><option value="">All prompts</option>{prompts.map((p) => <option key={p} value={p}>Prompt {p}</option>)}</select>
                <select className="field sm" style={{ width: 120 }} value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Phase"><option value="">All phases</option>{phases.map((p) => <option key={p} value={String(p)}>Phase {p}</option>)}</select>
                {filtered && <button className="btn sm ghost" onClick={clear}><X size={13} /> Clear</button>}
                <span className="text-[11.5px] text-muted"><span className="num text-ink2">{rows.length.toLocaleString()}</span> of <span className="num text-ink2">{total.toLocaleString()}</span></span>
                <button className="btn sm ghost ml-auto" disabled={!rows.length} onClick={exportCsv} title="Export every requirement in the current filter, with its full text"><Download size={13} /> Export CSV</button>
              </>} />
          </Panel>
        </>
      )}

      <Drawer open={open !== null} onClose={() => setOpen(null)} width={640}
        title={open ? <><span className="num text-gold">{open.id}</span> · {open.title}</> : ''}
        subtitle={open ? <>Prompt {open.prompt}{open.promptTitle ? ` — ${open.promptTitle}` : ''} · {open.module}</> : undefined}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('chip', chipOf(open.st))}>{open.st}</span>
              <span className="chip">Phase {open.phase}</span>
              <span className="chip">Requirement no. {open.no}</span>
            </div>
            <div>
              <div className="eyebrow mb-1.5">Requirement, as written in the specification</div>
              <div className="whitespace-pre-wrap rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink2">{open.text || 'No text is recorded for this requirement.'}</div>
            </div>
            <div>
              <div className="eyebrow mb-1.5">Evidence</div>
              <div className="whitespace-pre-wrap text-[13px] text-ink2">{open.evidence || <span className="text-muted">No evidence has been recorded. Until it is, this requirement cannot be treated as implemented.</span>}</div>
            </div>
            <div>
              <div className="eyebrow mb-1.5">Notes</div>
              <div className="whitespace-pre-wrap text-[13px] text-ink2">{open.notes || <span className="text-muted">No notes.</span>}</div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

/** A ring of requirement COUNTS. The shared Donut formats values as money, which would mislabel a count. */
function StatusRing({ data, total, done, onPick }: { data: { status: string; count: number }[]; total: number; done: number; onPick: (status: string) => void }) {
  const size = 176, thickness = 20
  const r = size / 2 - thickness / 2 - 4
  const C = 2 * Math.PI * r
  let off = 0
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="Requirements by status">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {data.filter((d) => d.count > 0).map((d) => {
          const len = (d.count / (total || 1)) * C
          const el = (
            <circle key={d.status} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLOR[d.status] ?? 'var(--muted)'} strokeWidth={thickness}
              strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off} style={{ cursor: 'pointer' }} onClick={() => onPick(d.status)}>
              <title>{`${d.status}: ${d.count.toLocaleString()} (${share(d.count, total)})`}</title>
            </circle>
          )
          off += len
          return el
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-[20px] leading-none text-ink">{share(done, total)}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">implemented<br />or tested</div>
        </div>
      </div>
    </div>
  )
}
