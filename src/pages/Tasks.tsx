import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ExternalLink, ListTodo, Play, Plus, Search, XCircle } from 'lucide-react'
import { useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { Task, TaskInput } from '@/engine/opsTypes'
import { daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, ErrorBox, Field, Loading, Modal, Note, PageHeader, Panel, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { useCompanyName } from '@/ui/ops'

type Tab = 'open' | 'overdue' | 'done' | 'all'
type Priority = Task['priority']

const PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low']
const PRIORITY_CLS: Record<Priority, string> = { low: '', normal: 'cyan', high: 'warn', critical: 'neg' }
const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 }

/** Where each kind of linked record is opened. A record of any other kind shows no link. */
const LINKS: Record<string, { label: string; path: (id: ID) => string }> = {
  advances: { label: 'Advance', path: (id) => `/expenses/advances/${id}` },
  expense_claims: { label: 'Expense claim', path: (id) => `/expenses/claims/${id}` },
  register_items: { label: 'Register item', path: (id) => `/registers/${id}` },
  purchase_docs: { label: 'Purchasing document', path: (id) => `/purchasing/${id}` },
  loans: { label: 'Loan', path: (id) => `/treasury/loans/${id}` },
  fixed_assets: { label: 'Fixed asset', path: (id) => `/assets/${id}` },
  invoices: { label: 'Invoice or bill', path: (id) => `/bills/${id}` },
  journals: { label: 'Journal', path: (id) => `/journals/${id}` },
}

const isLive = (t: Task) => t.status === 'open' || t.status === 'in_progress'
const days = (n: number) => `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`
const taskInput = (t: Task, change: Partial<TaskInput>): TaskInput => ({
  id: t.id, company_id: t.company_id, entity: t.entity, entity_id: t.entity_id, title: t.title, detail: t.detail, due_date: t.due_date,
  owner_user: t.owner_user, owner_name: t.owner_name, priority: t.priority, status: t.status, outcome: t.outcome, ...change,
})

interface Draft { company_id: ID; title: string; detail: string; due_date: string; owner_name: string; priority: Priority }

export default function Tasks() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const t = today()
  const choices = companies.filter((c) => c.status === 'active' && ids.includes(c.id))

  const [tab, setTab] = useState<Tab>('open')
  const [priority, setPriority] = useState<'' | Priority>('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const blank = (): Draft => ({ company_id: ids[0] ?? '', title: '', detail: '', due_date: '', owner_name: '', priority: 'normal' })
  const [draft, setDraft] = useState<Draft>(blank)
  const [ending, setEnding] = useState<{ task: Task; to: 'done' | 'cancelled' } | null>(null)
  const [outcome, setOutcome] = useState('')
  useEffect(() => { if (creating) setDraft(blank()) }, [creating]) // eslint-disable-line react-hooks/exhaustive-deps

  const main = useAsync(() => api.listTasks({ companyIds: ids }), [api, idsKey])
  const all = main.data ?? []
  const isOverdue = (k: Task) => k.status === 'open' && !!k.due_date && k.due_date < t

  const needle = q.trim().toLowerCase()
  const base = all.filter((k) => (!priority || k.priority === priority)
    && (!needle || [k.title, k.detail ?? '', k.owner_name ?? '', k.outcome ?? '', k.entity ? LINKS[k.entity]?.label ?? k.entity : ''].some((s) => s.toLowerCase().includes(needle))))
  const inTab = (k: Task, which: Tab) => (which === 'open' ? isLive(k) : which === 'overdue' ? isOverdue(k) : which === 'done' ? k.status === 'done' : true)
  const shown = base.filter((k) => inTab(k, tab))

  const start = (k: Task) => void act(() => api.saveTask(taskInput(k, { status: 'in_progress' })), 'Follow-up started')
  const create = async () => {
    const r = await act(() => api.saveTask({ company_id: draft.company_id, title: draft.title.trim(), detail: draft.detail.trim() || null, due_date: draft.due_date || null, owner_name: draft.owner_name.trim() || null, priority: draft.priority }), 'Follow-up added')
    if (r) setCreating(false)
  }
  const end = async () => {
    if (!ending) return
    const r = await act(() => api.saveTask(taskInput(ending.task, { status: ending.to, outcome: outcome.trim() })), ending.to === 'done' ? 'Follow-up closed' : 'Follow-up cancelled')
    if (r) { setEnding(null); setOutcome('') }
  }

  const columns: Column<Task>[] = [
    {
      key: 'title', header: 'Title', sort: (k) => k.title.toLowerCase(), csv: (k) => k.title,
      render: (k) => (
        <div className="min-w-0 max-w-[360px]">
          <div className={cx('truncate', isLive(k) ? 'text-ink' : 'text-ink2')} title={k.title}>{k.title}</div>
          {k.detail && <div className="truncate text-[11.5px] text-muted" title={k.detail}>{k.detail}</div>}
          {k.outcome && <div className="truncate text-[11.5px] text-ink2" title={k.outcome}>Outcome: {k.outcome}</div>}
          {ids.length > 1 && <div className="truncate text-[11px] text-muted">{companyName(k.company_id)}</div>}
        </div>
      ),
    },
    {
      key: 'record', header: 'Linked record', sort: (k) => (k.entity ? LINKS[k.entity]?.label ?? k.entity : ''), csv: (k) => (k.entity ? LINKS[k.entity]?.label ?? k.entity.replace(/_/g, ' ') : ''),
      render: (k) => {
        if (!k.entity || !k.entity_id) return <span className="text-muted">—</span>
        const link = LINKS[k.entity]
        const to = k.entity_id
        if (!link) return <span className="text-[12.5px] text-ink2">{k.entity.replace(/_/g, ' ')}</span>
        return <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav(link.path(to))}>{link.label} <ExternalLink size={11} /></button>
      },
    },
    { key: 'owner', header: 'Owner', sort: (k) => (k.owner_name ?? '').toLowerCase(), csv: (k) => k.owner_name ?? '', render: (k) => (k.owner_name ? <span className="text-ink2">{k.owner_name}</span> : <span className="text-[12px] text-warn">no owner recorded</span>) },
    {
      key: 'due', header: 'Due', sort: (k) => k.due_date ?? '9999-12-31', csv: (k) => k.due_date ?? '',
      render: (k) => {
        if (!k.due_date) return <span className="text-muted">no date</span>
        const n = daysBetween(t, k.due_date)
        return (
          <div>
            <span className="num text-[12.5px]">{fmtDate(k.due_date)}</span>
            {isLive(k) && <div className={cx('text-[11.5px]', n < 0 ? 'text-neg' : n === 0 ? 'text-warn' : 'text-muted')}>{n < 0 ? `${days(n)} overdue` : n === 0 ? 'due today' : `${days(n)} remaining`}</div>}
          </div>
        )
      },
    },
    { key: 'priority', header: 'Priority', sort: (k) => PRIORITY_RANK[k.priority], csv: (k) => k.priority, render: (k) => <span className={cx('chip', PRIORITY_CLS[k.priority])}>{k.priority}</span> },
    { key: 'status', header: 'Status', sort: (k) => k.status, csv: (k) => k.status.replace(/_/g, ' '), render: (k) => <StatusChip status={k.status} /> },
    { key: 'created', header: 'Created', sort: (k) => k.created_at, csv: (k) => k.created_at.slice(0, 10), render: (k) => <span className="num text-[12.5px] text-ink2">{fmtDate(k.created_at.slice(0, 10))}</span> },
    {
      key: 'actions', header: 'Actions', align: 'right',
      render: (k) => (!isLive(k) ? <span className="text-[11.5px] text-muted">{k.completed_at ? fmtDate(k.completed_at.slice(0, 10)) : '—'}</span> : (
        <span className="no-print inline-flex items-center justify-end gap-1">
          {k.status === 'open' && <button className="btn sm" disabled={busy} onClick={() => start(k)}><Play size={12} /> Start</button>}
          <button className="btn sm good" disabled={busy} onClick={() => { setOutcome(''); setEnding({ task: k, to: 'done' }) }}><CheckCircle2 size={12} /> Close</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => { setOutcome(''); setEnding({ task: k, to: 'cancelled' }) }}><XCircle size={12} /> Cancel</button>
        </span>
      )),
    },
  ]

  const emptyFor: Record<Tab, { title: string; body: string }> = {
    open: { title: 'No follow-up is open', body: 'Add a follow-up to give a matter an owner and a date. Follow-ups can also be added from a register item.' },
    overdue: { title: 'Nothing is overdue', body: 'No open follow-up has a due date before today.' },
    done: { title: 'No follow-up has been closed', body: 'A follow-up appears here once it is closed with its outcome.' },
    all: { title: 'No follow-up is recorded', body: 'Add a follow-up to give a matter an owner and a date.' },
  }
  const filtered = !!priority || !!needle
  const problem = !draft.company_id ? 'Choose the company.' : !draft.title.trim() ? 'Enter a title.' : null

  return (
    <div>
      <PageHeader
        eyebrow="Actions"
        title="Follow-ups"
        subtitle={<>What needs to be done, by whom and by when. Each follow-up is closed with its outcome. {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}.{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
        actions={<button className="btn primary" disabled={!choices.length} title={choices.length ? undefined : 'No active company is selected'} onClick={() => setCreating(true)}><Plus size={15} /> New follow-up</button>}
      />

      <Tabs<Tab>
        tabs={[
          { key: 'open', label: 'Open', count: base.filter((k) => inTab(k, 'open')).length },
          { key: 'overdue', label: 'Overdue', count: base.filter((k) => inTab(k, 'overdue')).length },
          { key: 'done', label: 'Done', count: base.filter((k) => inTab(k, 'done')).length },
          { key: 'all', label: 'All', count: base.length },
        ]}
        value={tab} onChange={setTab}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !main.data && <Panel><Loading rows={6} label="Loading follow-ups" /></Panel>}

      {main.data && (
        <Panel lit={false}>
          <DataTable
            key={tab}
            columns={columns} rows={shown} rowKey={(k) => k.id} exportName={`follow-ups-${tab}`} initialSort={{ key: 'due', dir: 'asc' }}
            toolbar={<>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input className="field sm" style={{ width: 230, paddingLeft: 28 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, owner, outcome" aria-label="Search follow-ups" />
              </div>
              <select className="field sm" style={{ width: 160 }} value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)} aria-label="Filter by priority">
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {filtered && <button className="btn sm ghost" onClick={() => { setQ(''); setPriority('') }}>Clear filters</button>}
            </>}
            empty={filtered
              ? { title: 'No follow-up matches', body: 'No follow-up in this list matches the priority and search you have chosen.', icon: <Search size={20} />, action: <button className="btn sm" onClick={() => { setQ(''); setPriority('') }}>Clear filters</button> }
              : { ...emptyFor[tab], icon: <ListTodo size={20} />, action: tab === 'open' || tab === 'all' ? <button className="btn sm" disabled={!choices.length} onClick={() => setCreating(true)}><Plus size={13} /> New follow-up</button> : undefined }}
          />
        </Panel>
      )}
      <div className="mt-2 text-[11.5px] text-muted">“Overdue” lists follow-ups that are still open and whose due date is before {fmtDate(t)}. A follow-up records what a person must do; NUMERO does not act on it.</div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New follow-up" width={560}
        footer={<><button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void create()}>{busy ? <Spinner /> : <Plus size={15} />} Add follow-up</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" className="sm:col-span-2">
            <select className="field" value={draft.company_id} onChange={(e) => setDraft({ ...draft, company_id: e.target.value })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          </Field>
          <Field label="Title" className="sm:col-span-2"><input className="field" value={draft.title} autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="What needs to be done" /></Field>
          <Field label="Detail" className="sm:col-span-2"><textarea className="field" rows={3} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" className="field" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></Field>
          <Field label="Priority"><select className="field" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label="Owner name" className="sm:col-span-2" hint="The person who will do it"><input className="field" value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!ending} onClose={() => setEnding(null)} title={ending?.to === 'cancelled' ? 'Cancel the follow-up' : 'Close the follow-up'} subtitle={ending?.task.title} width={500}
        footer={<>
          <button className="btn ghost" onClick={() => setEnding(null)}>Keep it open</button>
          <button className={cx('btn', ending?.to === 'cancelled' ? 'danger' : 'primary')} disabled={busy || !outcome.trim()} onClick={() => void end()}>{busy ? <Spinner /> : ending?.to === 'cancelled' ? <XCircle size={15} /> : <CheckCircle2 size={15} />} {ending?.to === 'cancelled' ? 'Cancel follow-up' : 'Close follow-up'}</button>
        </>}>
        <Note className="mb-4">{ending?.to === 'cancelled' ? 'A cancelled follow-up stays on record with the reason. It cannot be reopened.' : 'A closed follow-up stays on record with its outcome. It cannot be reopened.'}</Note>
        <label className="label">{ending?.to === 'cancelled' ? 'Outcome (required — why it is no longer needed)' : 'Outcome (required — what was done or decided)'}</label>
        <textarea className="field" rows={3} autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </Modal>
    </div>
  )
}
