import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, CheckCheck, Crown, ExternalLink, Lock, Mail, MailOpen, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { AttentionClass, AttentionRule, Channel, Notification, NotificationPref } from '@/engine/p3Types'
import { CHANNELS_WORKING } from '@/engine/p3Types'
import { ATTENTION, forOwner } from '@/engine/analysis'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D } from '@/lib/money'
import { fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { AttentionChip, DemoTag, Tile, digits, human, useCompanyCode } from '@/ui/p3'

// =====================================================================
// Notifications (spec 61, 608): what waits for the person, by class of
// attention. Notices are delivered INSIDE the application only. The other
// channels are recorded preferences: nothing is sent through them.
// A notice of an approval that waits for the person is a governance
// notice and cannot be switched off.
// =====================================================================

type TabKey = 'inbox' | 'preferences' | 'rules'
const TABS: { key: TabKey; label: string }[] = [{ key: 'inbox', label: 'Inbox' }, { key: 'preferences', label: 'Preferences' }, { key: 'rules', label: 'Attention rules' }]

/** the API returns the newest notices up to a limit; the screen says so when the limit is reached */
const LIMIT = 500
const CLASSES = [...ATTENTION].sort((a, b) => b.rank - a.rank)
const CLASS_LABEL = new Map(ATTENTION.map((a) => [a.key, a]))
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'in_app', label: 'In the application' }, { key: 'email', label: 'E-mail' }, { key: 'push', label: 'Push' }, { key: 'sms', label: 'SMS' }, { key: 'whatsapp', label: 'WhatsApp' },
]
const working = (c: Channel) => CHANNELS_WORKING.includes(c)
/** the engine refuses to switch these off */
const GOVERNANCE = ['approval_waiting', 'approval_waiting_long']
const KINDS: Record<string, string> = {
  approval_waiting: 'Something waits for your approval.',
  approval_waiting_long: 'A request has waited for approval for several days.',
  alert: 'Sentinel raised an alert that asks for priority or is critical.',
  task_due: 'A follow-up is due.',
  follow_up_assigned: 'A follow-up was given to you.',
  follow_up_due: 'A follow-up of yours is due within two days, or is overdue.',
  case_assigned: 'A case was given to you.',
  document_expiring: 'A document is about to expire.',
  deadline: 'A commitment in the registers falls due: compliance, insurance, rent, a guarantee and the like.',
  reconciliation_incomplete: 'Bank statement lines have stayed unmatched for more than a week.',
}
const APPROVAL_KINDS = ['journal', 'advance', 'expense_claim', 'requisition', 'purchase_order', 'capital_call', 'distribution']

const RECORD: Record<string, string> = {
  journal: '/journals/', advance: '/expenses/advances/', expense_claim: '/expenses/claims/', requisition: '/purchasing/', purchase_order: '/purchasing/',
  capital_call: '/investments/calls/', distribution: '/investments/distributions/', cases: '/reality/cases/', register_items: '/registers/',
}
const PLACE: Record<string, string> = { alerts: '/sentinel', tasks: '/tasks', bank_accounts: '/banking' }
/** Where a notice leads. A notice with no record of its own leads nowhere rather than somewhere approximate. */
const routeOf = (n: Pick<Notification, 'kind' | 'entity' | 'entity_id'>): string | null => {
  if (n.entity && n.entity_id && RECORD[n.entity]) return RECORD[n.entity] + n.entity_id
  if (n.entity && PLACE[n.entity]) return PLACE[n.entity]
  if (n.kind.startsWith('approval')) return '/approvals'
  if (n.kind === 'alert') return '/sentinel'
  return null
}
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

export default function Notifications() {
  const session = useApp((s) => s.session)
  const api = useApp((s) => s.api)!
  const [sp, setSp] = useSearchParams()
  const { act, busy } = useAction()
  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'inbox'
  const go = (k: TabKey) => setSp({ tab: k }, { replace: true })
  const [looked, setLooked] = useState<{ added: number; at: string } | null>(null)

  const list = useAsync(() => api.listNotifications({ limit: LIMIT }), [api])
  const rows = useMemo(() => list.data ?? [], [list.data])
  const unread = rows.filter((n) => !n.read_at)
  const kindsSeen = useMemo(() => [...new Set(rows.map((n) => n.kind))].sort(), [rows])

  const look = async () => {
    const n = await act(() => api.refreshNotifications(), (added) => (added === 0 ? 'Nothing new has fallen due' : `${plural(added, 'notice')} added`))
    if (n !== undefined) setLooked({ added: n, at: new Date().toISOString() })
  }

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Notifications"
        subtitle={<>
          What waits for {session?.user.name ?? 'you'}, by class of attention. Notices are shown inside the application only; NUMERO sends nothing outside itself.
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          <button className="btn" disabled={busy || unread.length === 0} title={unread.length ? 'Marks every notice of yours as read, including any older than those listed' : 'Every notice is already read'}
            onClick={() => void act(() => api.markNotifications(null, true), (n) => `${plural(n, 'notice')} marked as read`)}><CheckCheck size={15} /> Mark all as read</button>
          <button className="btn primary" disabled={busy} onClick={() => void look()}>{busy ? <Spinner /> : <RefreshCw size={15} />} Look for what has fallen due</button>
        </>}
      />

      <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'inbox' && list.data ? unread.length : undefined }))} value={tab} onChange={go} />

      {tab === 'inbox' && (
        list.error ? <ErrorBox message={list.error} retry={list.reload} />
          : !list.data ? <Panel><Loading rows={6} label="Loading your notices" /></Panel>
          : <Inbox rows={rows} looked={looked} owner={!!session?.isGroupAdmin} />
      )}
      {tab === 'preferences' && <Preferences rows={rows} kindsSeen={kindsSeen} />}
      {tab === 'rules' && <Rules admin={!!session?.isGroupAdmin} />}
    </div>
  )
}

// =====================================================================
// Inbox
// =====================================================================
function Inbox({ rows, looked, owner }: { rows: Notification[]; looked: { added: number; at: string } | null; owner: boolean }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const code = useCompanyCode()
  const { act, busy } = useAction()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [cls, setCls] = useState<AttentionClass | ''>('')
  const [kind, setKind] = useState('')

  const unread = rows.filter((n) => !n.read_at)
  const split = forOwner(unread)
  const governance = unread.filter((n) => n.mandatory)
  const kinds = [...new Set(rows.map((n) => n.kind))].sort()
  const shown = rows.filter((n) => (!unreadOnly || !n.read_at) && (!cls || n.class === cls) && (!kind || n.kind === kind))
  const filtered = unreadOnly || !!cls || !!kind
  const shownUnread = shown.filter((n) => !n.read_at)
  const shownRead = shown.filter((n) => n.read_at)

  const open = async (n: Notification) => {
    const to = routeOf(n)
    if (!to) return
    if (!n.read_at) await act(() => api.markNotifications([n.id], true))
    nav(to)
  }
  const mark = (ids: ID[], read: boolean) => void act(() => api.markNotifications(ids, read), (n) => `${plural(n, 'notice')} marked as ${read ? 'read' : 'unread'}`)

  const columns: Column<Notification>[] = [
    { key: 'read', header: 'Read', width: 64, render: (n) => (n.read_at ? <span className="text-[11.5px] text-muted" title={`Read ${fmtDateTime(n.read_at)}`}>read</span> : <span className="flex items-center gap-1.5 text-[11.5px] text-gold"><span className="lamp gold" /> new</span>), sort: (n) => (n.read_at ? 1 : 0), csv: (n) => (n.read_at ? `Read ${n.read_at}` : 'Unread') },
    {
      key: 'notice', header: 'Notice', sort: (n) => n.title.toLowerCase(), csv: (n) => `${n.title}${n.body ? ' — ' + n.body : ''}`,
      render: (n) => (
        <div className="min-w-0">
          <div className={cx('break-words', n.read_at ? 'text-ink2' : 'font-medium text-ink')}>{n.title}</div>
          {n.body && <div className="break-words text-[11.5px] text-muted">{n.body}</div>}
        </div>
      ),
    },
    {
      key: 'kind', header: 'Kind', sort: (n) => n.kind, csv: (n) => n.kind + (n.mandatory ? ' (governance)' : ''),
      render: (n) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="chip">{human(n.kind)}</span>
          {n.mandatory && <span className="chip gold" title="A governance notice: it reaches you whatever your preferences say"><Lock size={11} /> governance</span>}
        </span>
      ),
    },
    { key: 'company', header: 'Company', render: (n) => <span className="text-ink2">{n.company_id ? code(n.company_id) : 'Group'}</span>, sort: (n) => code(n.company_id), csv: (n) => (n.company_id ? code(n.company_id) : 'Group') },
    { key: 'when', header: 'Raised', render: (n) => <span className="num text-[12.5px]">{fmtDateTime(n.created_at)}</span>, sort: (n) => n.created_at, csv: (n) => n.created_at },
    {
      key: 'record', header: 'Record', csv: (n) => routeOf(n) ?? '',
      render: (n) => (routeOf(n)
        ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); void open(n) }}>Open <ExternalLink size={11} /></button>
        : <span className="text-[11.5px] text-muted" title="This notice points to no record that has a screen of its own">no record to open</span>),
    },
    {
      key: 'act', header: '', align: 'right', width: 56,
      render: (n) => (
        <button className="btn ghost icon sm" disabled={busy} aria-label={n.read_at ? 'Mark as unread' : 'Mark as read'} title={n.read_at ? 'Mark as unread' : 'Mark as read'}
          onClick={(e) => { e.stopPropagation(); mark([n.id], !n.read_at) }}>{n.read_at ? <Mail size={14} /> : <MailOpen size={14} />}</button>
      ),
    },
  ]

  return (
    <div>
      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Unread" tone={unread.length ? 'text-gold' : undefined} onClick={() => { setUnreadOnly(true); setCls(''); setKind('') }} sub={`of ${plural(rows.length, 'notice')} listed`}><span className="num">{unread.length.toLocaleString()}</span></Tile>
        <Tile label="Critical, unread" tone={unread.some((n) => n.class === 'critical') ? 'text-neg' : undefined} onClick={() => { setUnreadOnly(true); setCls('critical'); setKind('') }} sub={CLASS_LABEL.get('critical')?.meaning}>
          <span className="num">{unread.filter((n) => n.class === 'critical').length.toLocaleString()}</span>
        </Tile>
        <Tile label="Owner action, unread" onClick={() => { setUnreadOnly(true); setCls('owner_action'); setKind('') }} sub={CLASS_LABEL.get('owner_action')?.meaning}>
          <span className="num">{unread.filter((n) => n.class === 'owner_action').length.toLocaleString()}</span>
        </Tile>
        <Tile label="Governance notices, unread" sub="Approvals that wait for you and critical alerts. They cannot be switched off."><span className="num">{governance.length.toLocaleString()}</span></Tile>
      </div>

      {owner && (
        <Panel className="mb-4 p-4" attention={split.owner.length > 0} lit={false}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Crown size={15} className="text-gold" />
            <span className="eyebrow">For the owner</span>
            <span className="text-[11.5px] text-muted">Unread notices of the classes owner action and critical. Routine bookkeeping stays with the finance team.</span>
          </div>
          {split.owner.length === 0
            ? <div className="text-[12.5px] text-ink2">No unread notice asks for the owner.</div>
            : (
              <div className="-mx-1.5">
                {split.owner.slice(0, 6).map((n) => (
                  <button key={n.id} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2 disabled:cursor-default" disabled={!routeOf(n)} onClick={() => void open(n)}>
                    <span className={cx('lamp mt-[6px]', n.class === 'critical' ? 'neg' : 'gold')} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[12.5px] text-ink">{n.title}</span>
                      <span className="block break-words text-[11.5px] text-muted">{n.body ? n.body + ' · ' : ''}{n.company_id ? code(n.company_id) : 'Group'} · {fmtDateTime(n.created_at)}</span>
                    </span>
                    <AttentionChip value={n.class} />
                    {routeOf(n) && <ExternalLink size={13} className="mt-[3px] flex-none text-muted" />}
                  </button>
                ))}
                {split.owner.length > 6 && <div className="px-2.5 pt-1 text-[11.5px] text-muted">and {split.owner.length - 6} more, in the inbox below.</div>}
              </div>
            )}
          <div className="mt-2 text-[11.5px] text-muted">{plural(split.others.length, 'other unread notice')} {split.others.length === 1 ? 'is' : 'are'} for the finance team and the managers. They are in the inbox below and nothing is hidden.</div>
        </Panel>
      )}

      <Panel className="no-print mb-4 flex flex-wrap items-center gap-3 px-3.5 py-2.5" lit={false}>
        <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
        <select className="field sm" style={{ width: 190 }} value={cls} onChange={(e) => setCls(e.target.value as AttentionClass | '')} aria-label="Class of attention">
          <option value="">Every class</option>{CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="field sm" style={{ width: 220 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of notice">
          <option value="">Every kind</option>{kinds.map((k) => <option key={k} value={k}>{human(k)}</option>)}
        </select>
        {filtered && <button className="btn sm ghost" onClick={() => { setUnreadOnly(false); setCls(''); setKind('') }}>Clear the filter</button>}
        <span className="flex-1" />
        <button className="btn sm" disabled={busy || !shownUnread.length} onClick={() => mark(shownUnread.map((n) => n.id), true)}><MailOpen size={13} /> Mark the {shownUnread.length.toLocaleString()} shown as read</button>
        <button className="btn sm ghost" disabled={busy || !shownRead.length} onClick={() => mark(shownRead.map((n) => n.id), false)}><Mail size={13} /> Mark the {shownRead.length.toLocaleString()} shown as unread</button>
      </Panel>

      {rows.length >= LIMIT && <Note kind="warn" className="mb-4">The newest {LIMIT.toLocaleString()} notices are listed. Older notices exist and are not shown here; marking all as read covers them too.</Note>}

      {shown.length === 0 ? (
        <Panel><Empty icon={<Bell size={20} />} title={filtered ? 'No notice matches the filter' : 'No notice has reached you'}
          body={filtered ? 'Clear the filter to see every notice.' : 'Approvals that wait for you, alerts and what is given to you arrive here when they happen. What falls due with the passing of time is found when you ask: nothing in NUMERO runs on a schedule.'} /></Panel>
      ) : (
        <div className="space-y-4">
          {CLASSES.map((c) => {
            const group = shown.filter((n) => n.class === c.key)
            if (!group.length) return null
            return (
              <Section key={c.key} title={`${c.label} · ${group.length.toLocaleString()}`} right={<span className="flex items-center gap-2 text-[11.5px] text-muted">{c.meaning} <AttentionChip value={c.key} /></span>}>
                <Panel lit={false}>
                  <DataTable columns={columns} rows={group} rowKey={(n) => n.id} onRow={(n) => void open(n)} pageSize={25} exportName={`notices-${c.key}`}
                    rowClass={(n) => (n.read_at ? undefined : 'bg-surface2')} />
                </Panel>
              </Section>
            )
          })}
        </div>
      )}

      <div className="mt-3 text-[11.5px] text-muted">
        Newest first within each class. Opening a notice marks it as read.
        {looked && <> Last looked for what has fallen due at {fmtDateTime(looked.at)}: {looked.added === 0 ? 'nothing new' : `${plural(looked.added, 'notice')} added`}.</>}
        {' '}“Look for what has fallen due” reads your follow-ups, the deadlines in the registers, the approvals that have waited and the bank statement lines left unmatched. Nothing does this on a schedule.
      </div>
    </div>
  )
}

// =====================================================================
// Preferences: kind of notice × channel
// =====================================================================
interface PrefRow { kind: string; received: number; governance: boolean }

function Preferences({ rows, kindsSeen }: { rows: Notification[]; kindsSeen: string[] }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const prefs = useAsync(() => api.listNotificationPrefs(), [api])

  const byKey = useMemo(() => new Map((prefs.data ?? []).map((p: NotificationPref) => [p.kind + '|' + p.channel, p])), [prefs.data])
  const table: PrefRow[] = useMemo(() => {
    const kinds = [...new Set([...Object.keys(KINDS), ...kindsSeen, ...(prefs.data ?? []).map((p) => p.kind)])]
    return kinds.map((k) => ({ kind: k, received: rows.filter((n) => n.kind === k).length, governance: GOVERNANCE.includes(k) }))
      .sort((a, b) => Number(b.governance) - Number(a.governance) || a.kind.localeCompare(b.kind))
  }, [kindsSeen, prefs.data, rows])

  /** in the application a notice is shown unless it was switched off; elsewhere nothing is on record until the person records it */
  const isOn = (kind: string, c: Channel) => { const p = byKey.get(kind + '|' + c); return working(c) ? p?.enabled !== false : p?.enabled === true }
  const set = (kind: string, c: Channel, on: boolean) => void act(() => api.setNotificationPref(kind, c, on),
    working(c) ? (on ? `Notices of the kind "${human(kind)}" are shown` : `Notices of the kind "${human(kind)}" are no longer shown`) : 'Preference recorded. Nothing is sent through this channel today.')

  const columns: Column<PrefRow>[] = [
    {
      key: 'kind', header: 'Kind of notice', sort: (r) => r.kind, csv: (r) => r.kind,
      render: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-ink">{human(r.kind)}{r.governance && <span className="chip gold" title="The engine refuses to switch this off"><Lock size={11} /> governance</span>}</div>
          <div className="text-[11.5px] text-muted">{KINDS[r.kind] ?? 'A kind of notice that has reached you.'}</div>
        </div>
      ),
    },
    { key: 'received', header: 'Notices listed', align: 'right', render: (r) => (r.received ? <span className="num">{r.received.toLocaleString()}</span> : <span className="text-muted" title="No notice of this kind is among those listed in your inbox">none</span>), sort: (r) => r.received, csv: (r) => r.received },
    ...CHANNELS.map<Column<PrefRow>>((c) => ({
      key: c.key, header: working(c.key) ? c.label : `${c.label} — recorded only`, align: 'center',
      csv: (r) => (isOn(r.kind, c.key) ? (working(c.key) ? 'Shown' : 'Preferred — nothing is sent') : working(c.key) ? 'Switched off' : 'No preference'),
      render: (r) => {
        const on = isOn(r.kind, c.key)
        const locked = r.governance && on
        const why = locked ? 'Approvals that wait for you are a governance notice and cannot be switched off.'
          : working(c.key) ? (on ? 'Shown in the application' : 'Switched off by you') : on ? 'Preference recorded. Nothing is sent through this channel today.' : 'No preference recorded. Nothing is sent through this channel today.'
        return (
          <label className="inline-flex items-center justify-center gap-1.5" title={why}>
            <input type="checkbox" checked={on} disabled={busy || locked} onChange={(e) => set(r.kind, c.key, e.target.checked)} aria-label={`${human(r.kind)} — ${c.label}`} />
            {locked && <Lock size={11} className="text-gold" aria-hidden />}
          </label>
        )
      },
    })),
  ]

  return (
    <div className="space-y-4">
      <Note kind="warn">
        Notices are delivered <span className="font-medium text-ink">inside the application only</span>. A preference for {CHANNELS.filter((c) => !working(c.key)).map((c) => c.label).join(', ')} can be recorded here,
        and it is kept for the day those channels are connected. <span className="font-medium text-ink">Nothing is sent through them today.</span>
      </Note>
      {prefs.error ? <ErrorBox message={prefs.error} retry={prefs.reload} />
        : !prefs.data ? <Panel><Loading rows={6} label="Loading your preferences" /></Panel>
        : (
          <Panel lit={false}>
            <DataTable columns={columns} rows={table} rowKey={(r) => r.kind} pageSize={60} exportName="notification-preferences"
              toolbar={<span className="text-[12px] text-muted">These are your own preferences. They change nothing for anyone else.</span>} />
          </Panel>
        )}
      <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
        <div className="mb-1.5 flex items-center gap-2 font-medium text-ink"><Lock size={14} className="text-gold" /> What cannot be switched off</div>
        <ul className="m-0 list-disc space-y-1 pl-4">
          <li>Notices of approvals that wait for you ({GOVERNANCE.map(human).join(', ')}) are governance notices. The engine refuses to switch them off, so they are shown as locked.</li>
          <li>A notice the engine marks as governance — a critical alert, for one — reaches you even where its kind is switched off.</li>
          <li>Switching a kind off stops new notices of that kind. Notices already in the inbox stay there.</li>
          <li>“Notices listed” counts the notices of each kind among those listed in your inbox. “None” means that none has reached you, not that the kind is switched off.</li>
        </ul>
      </Panel>
    </div>
  )
}

// =====================================================================
// Attention rules: which class a kind of notice is given, from which amount
// =====================================================================
interface RuleForm { kind: string; min_amount: string; class: AttentionClass; note: string }
const BLANK_RULE: RuleForm = { kind: '', min_amount: '', class: 'owner_action', note: '' }

function Rules({ admin }: { admin: boolean }) {
  const api = useApp((s) => s.api)!
  const scope = useScopeIds()
  const { act, busy } = useAction()
  const rules = useAsync(() => api.listAttentionRules(), [api])
  const alertIds = scope.filter((id) => can('sentinel.view', id))
  // kinds of alert are taken from the alerts on record, never from a list of our own
  const alertKinds = useAsync(async () => (alertIds.length ? [...new Set((await api.listAlerts(alertIds)).map((a) => a.kind))].sort() : []), [api, alertIds.join(',')])
  const [form, setForm] = useState<RuleForm | null>(null)
  const [removing, setRemoving] = useState<AttentionRule | null>(null)
  const noAdmin = admin ? undefined : 'Only a Group Super Admin decides who attends to what'

  const columns: Column<AttentionRule>[] = [
    { key: 'kind', header: 'Kind of notice', render: (r) => <span className="num text-[12.5px] text-gold">{r.kind === '*' ? '* — every kind' : r.kind}</span>, sort: (r) => r.kind, csv: (r) => r.kind },
    { key: 'min', header: 'From an amount of', align: 'right', render: (r) => (D(r.min_amount).isZero() ? <span className="text-ink2">any amount</span> : <Money value={r.min_amount} />), sort: (r) => D(r.min_amount).toNumber(), csv: (r) => D(r.min_amount).toFixed(2) },
    { key: 'class', header: 'Class of attention', render: (r) => <AttentionChip value={r.class} />, sort: (r) => CLASS_LABEL.get(r.class)?.rank ?? 0, csv: (r) => CLASS_LABEL.get(r.class)?.label ?? r.class },
    { key: 'note', header: 'Note', render: (r) => <span className="break-words text-[12.5px] text-ink2">{r.note ?? '—'}</span>, csv: (r) => r.note ?? '' },
    {
      key: 'act', header: '', align: 'right',
      render: (r) => (admin ? (
        <span className="flex justify-end gap-1">
          <button className="btn ghost icon sm" disabled={busy} aria-label={`Change the rule for ${r.kind}`} title="Change the class or the note" onClick={(e) => { e.stopPropagation(); setForm({ kind: r.kind, min_amount: D(r.min_amount).isZero() ? '' : D(r.min_amount).toString(), class: r.class, note: r.note ?? '' }) }}><Pencil size={14} /></button>
          <button className="btn ghost icon sm" disabled={busy} aria-label={`Remove the rule for ${r.kind}`} title="Remove the rule" onClick={(e) => { e.stopPropagation(); setRemoving(r) }}><Trash2 size={14} /></button>
        </span>
      ) : null),
    },
  ]

  return (
    <div className="space-y-4">
      {!admin && <Note>These rules are shown for reference. Only a Group Super Admin changes them.</Note>}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {rules.error ? <ErrorBox message={rules.error} retry={rules.reload} />
            : !rules.data ? <Panel><Loading rows={4} label="Loading the attention rules" /></Panel>
            : (
              <Panel lit={false}>
                <DataTable columns={columns} rows={rules.data} rowKey={(r) => r.id} exportName="attention-rules"
                  toolbar={<>
                    <button className="btn sm" disabled={!admin} title={noAdmin} onClick={() => setForm(BLANK_RULE)}><Plus size={13} /> Add a rule</button>
                    <span className="text-[12px] text-muted">A rule decides the class of notices raised after it is saved. Notices already raised keep the class they were given.</span>
                  </>}
                  empty={{ title: 'No attention rule is on record', body: 'Without a rule a notice keeps the class its origin gives it: an approval is a finance action; an alert takes the class of its seriousness.', icon: <Crown size={20} />, action: <button className="btn sm" disabled={!admin} title={noAdmin} onClick={() => setForm(BLANK_RULE)}><Plus size={13} /> Add a rule</button> }} />
              </Panel>
            )}
        </div>
        <div className="min-w-0 space-y-4">
          <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
            <div className="eyebrow mb-2">How a class is decided</div>
            <ol className="m-0 list-decimal space-y-1 pl-4">
              <li>Only the rules for the kind of the notice, and the rules for every kind (*), are looked at.</li>
              <li>Of those, only the rules whose minimum amount the amount of the notice reaches.</li>
              <li>A rule for the exact kind goes before a rule for every kind.</li>
              <li>Among the rules that remain, the one with the highest minimum amount decides.</li>
              <li>Where no rule remains, the notice keeps the class its origin gives it.</li>
            </ol>
            <div className="mt-2 text-[11.5px] text-muted">The kind of an approval is written <span className="num text-ink2">approval:</span> followed by what is approved, for example <span className="num text-ink2">approval:journal</span>. The kind of an alert is the kind Sentinel gives it. A notice with no amount counts as an amount of zero.</div>
          </Panel>
          <Panel className="p-4" lit={false}>
            <div className="eyebrow mb-2">The classes</div>
            <div className="space-y-2">
              {CLASSES.map((c) => (
                <div key={c.key} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className="w-[140px] flex-none"><AttentionChip value={c.key} /></span>
                  <span className="text-ink2">{c.meaning}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <RuleModal form={form} rules={rules.data ?? []} alertKinds={alertKinds.data ?? []} onClose={() => setForm(null)} />
      <ReasonDialog open={!!removing} title="Remove the rule" confirm="Remove the rule" danger required={false} onCancel={() => setRemoving(null)}
        body={removing && <>The rule for <span className="num text-ink">{removing.kind}</span> from {D(removing.min_amount).isZero() ? 'any amount' : <Money value={removing.min_amount} />} is removed. Notices raised afterwards take the class the remaining rules give them; notices already raised keep theirs.</>}
        onConfirm={(reason) => { if (!removing) return; void act(async () => { await api.saveAttentionRule({ kind: removing.kind, min_amount: removing.min_amount, class: removing.class, note: reason || undefined, remove: true }); return true }, 'Rule removed').then((ok) => { if (ok) setRemoving(null) }) }} />
    </div>
  )
}

function RuleModal({ form, rules, alertKinds, onClose }: { form: RuleForm | null; rules: AttentionRule[]; alertKinds: string[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [f, setF] = useState<RuleForm>(BLANK_RULE)
  useEffect(() => { if (form) setF(form) }, [form])
  const kind = f.kind.trim()
  const existing = rules.find((r) => r.kind === kind && D(r.min_amount).eq(D(f.min_amount || 0)))
  const problem = !kind ? 'State the kind of notice the rule is for.' : /\s/.test(kind) ? 'The kind of a notice has no spaces.' : null
  const suggestions = [...new Set([...APPROVAL_KINDS.map((k) => 'approval:' + k), ...alertKinds, '*'])]
  const save = async () => {
    const ok = await act(async () => { await api.saveAttentionRule({ kind, min_amount: f.min_amount || 0, class: f.class, note: f.note.trim() || undefined }); return true }, existing ? 'Rule replaced' : 'Rule saved')
    if (ok) onClose()
  }
  return (
    <Modal open={!!form} onClose={onClose} title="Attention rule" subtitle="Which class a kind of notice is given, and from which amount" width={560}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {existing ? 'Replace the rule' : 'Save the rule'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of notice" className="sm:col-span-2" hint="Choose from the list or type the kind. * stands for every kind.">
          <input className="field num" list="attention-kinds" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="approval:journal" autoFocus />
          <datalist id="attention-kinds">{suggestions.map((k) => <option key={k} value={k} />)}</datalist>
        </Field>
        <Field label="From an amount of" hint="Leave empty for any amount. In the currency of the group.">
          <input className="field num" inputMode="decimal" value={f.min_amount} onChange={(e) => setF({ ...f, min_amount: digits(e.target.value) })} placeholder="0" />
        </Field>
        <Field label="Class of attention" hint={CLASS_LABEL.get(f.class)?.meaning}>
          <select className="field" value={f.class} onChange={(e) => setF({ ...f, class: e.target.value as AttentionClass })}>{CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        </Field>
        <Field label="Note" className="sm:col-span-2" hint="Why this is for that class. Shown beside the rule.">
          <input className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      {existing && <Note className="mt-4">A rule for this kind and this amount is on record, giving the class <AttentionChip value={existing.class} />. Saving replaces it.</Note>}
      {form && form.kind && !existing && <Note className="mt-4">The kind or the amount differs from the rule you opened. Saving makes a further rule; the rule you opened stays until it is removed.</Note>}
      {problem && f.kind !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}
