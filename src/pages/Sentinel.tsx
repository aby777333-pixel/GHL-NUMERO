import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, CircleSlash, ExternalLink, Eye, Play, Radar, ShieldCheck } from 'lucide-react'
import type { Alert, ID, Invoice } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { fmtDateTime } from '@/lib/dates'
import { cx, Drawer, ErrorBox, Loading, Note, PageHeader, Panel, ReasonDialog, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { colorAt } from '@/ui/charts'

type TabKey = 'open' | 'reviewing' | 'closed' | 'all'
type Attention = Alert['attention']

const PREFIX = /^ANOMALY DETECTED\s*[—–-]\s*/i
const ATTENTION: { key: Attention; label: string; rank: number; lamp: string; text: string; meaning: string }[] = [
  { key: 'critical', label: 'Critical', rank: 3, lamp: 'neg pulse', text: 'text-neg', meaning: 'look at these first' },
  { key: 'priority', label: 'Priority', rank: 2, lamp: 'neg', text: 'text-neg', meaning: 'review soon' },
  { key: 'review', label: 'Review', rank: 1, lamp: 'warn', text: 'text-warn', meaning: 'standard review indicators' },
  { key: 'info', label: 'Info', rank: 0, lamp: 'cyan', text: 'text-cyan', meaning: 'for awareness' },
]
const rankOf = (a: Attention) => ATTENTION.find((x) => x.key === a)?.rank ?? 0
const humanise = (s: string) => s.replace(/[_.]/g, ' ')
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const shortTitle = (a: Alert) => sentence(a.title.replace(PREFIX, ''))
const isUnresolved = (a: Alert) => a.status === 'open' || a.status === 'reviewing'
const isClosed = (a: Alert) => a.status === 'resolved' || a.status === 'false_positive'

/** Evidence keys that point at records; they are rendered as links, not as raw identifiers. */
const LINK_KEYS = ['journal_id', 'reversal_journal', 'payment_id', 'payment_ids', 'invoice_id', 'invoice_ids', 'party_id']
const asIds = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : typeof v === 'string' && v ? [v] : [])
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ')
  try { return JSON.stringify(v) } catch { return String(v) }
}

export default function Sentinel() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const alertId = sp.get('alert')
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const { act, busy } = useAction()

  const [tab, setTab] = useState<TabKey>('open')
  const [attention, setAttention] = useState<Attention | null>(null)
  const [kind, setKind] = useState<string | null>(null)

  const main = useAsync(() => api.listAlerts(ids), [api, idsKey])
  const alerts = main.data ?? []
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])

  const unresolved = alerts.filter(isUnresolved)
  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of alerts) if (isUnresolved(a)) m.set(a.kind, (m.get(a.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count], i) => ({ key, label: sentence(humanise(key)), count, color: colorAt(i) }))
  }, [alerts])

  const inTab = (a: Alert, t: TabKey) => (t === 'all' ? true : t === 'closed' ? isClosed(a) : a.status === t)
  const rows = alerts.filter((a) => inTab(a, tab) && (!attention || a.attention === attention) && (!kind || a.kind === kind))
  const selected = alertId ? alerts.find((a) => a.id === alertId) ?? null : null

  const openAlert = (id: ID | null) => {
    const next = new URLSearchParams(sp)
    if (id) next.set('alert', id); else next.delete('alert')
    setSp(next, { replace: true })
  }

  const runnable = ids.filter((id) => can('sentinel.view', id))
  const run = () => act(async () => {
    let n = 0
    for (const id of runnable) n += await api.runSentinel(id)
    return n
  }, (n) => `Sentinel run complete — ${n} new item${n === 1 ? '' : 's'}`)

  const columns: Column<Alert>[] = [
    { key: 'attention', header: 'Attention', width: 120, render: (a) => <StatusChip status={a.attention} />, sort: (a) => rankOf(a.attention), csv: (a) => a.attention },
    {
      key: 'title', header: 'Indicator', sort: (a) => shortTitle(a).toLowerCase(), csv: (a) => shortTitle(a),
      render: (a) => <div className="min-w-0"><div className="text-ink">{shortTitle(a)}</div><div className="text-[11.5px] text-muted">{sentence(humanise(a.kind))}</div></div>,
    },
    { key: 'explanation', header: 'Explanation', render: (a) => <span className="line-clamp-2 text-[12.5px] text-ink2">{a.explanation}</span>, csv: (a) => a.explanation },
    { key: 'company', header: 'Company', width: 110, render: (a) => <span className="text-ink2" title={companyById.get(a.company_id)?.name}>{companyById.get(a.company_id)?.code ?? '—'}</span>, sort: (a) => companyById.get(a.company_id)?.name ?? '', csv: (a) => companyById.get(a.company_id)?.name ?? '' },
    { key: 'created', header: 'Raised', width: 170, render: (a) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(a.created_at)}</span>, sort: (a) => a.created_at, csv: (a) => a.created_at },
    { key: 'status', header: 'Status', width: 130, render: (a) => <StatusChip status={a.status} />, sort: (a) => a.status, csv: (a) => a.status },
    { key: 'note', header: 'Review note', render: (a) => <span className="text-[12.5px] text-ink2">{a.review_note || '—'}</span>, csv: (a) => a.review_note ?? '' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Financial Watchtower"
        title="Sentinel"
        subtitle={<>Sentinel reads the books of the selected compan{ids.length === 1 ? 'y' : 'ies'} and raises factual patterns that deserve a second look.</>}
        actions={
          <button className="btn primary" onClick={run} disabled={busy || runnable.length === 0}
            title={runnable.length ? `Check ${runnable.length} compan${runnable.length === 1 ? 'y' : 'ies'} now` : 'Your role does not include access to Sentinel (sentinel.view) in the selected companies.'}>
            <Play size={14} /> {busy ? 'Running…' : 'Run Sentinel now'}
          </button>
        }
      />

      <Note className="mb-4">
        <strong className="text-ink">Sentinel reports factual patterns.</strong> An anomaly is an indicator for human review — never a conclusion about any person.
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !main.data && <Panel><Loading rows={6} label="Loading Sentinel" /></Panel>}

      {main.data && (
        <>
          {alertId && !selected && (
            <Note kind="warn" className="mb-4">
              The item you were sent to is not in the selected companies, or is not visible to your account. <button className="link" onClick={() => openAlert(null)}>Dismiss</button>
            </Note>
          )}

          <div className="mb-4 grid gap-4 xl:grid-cols-[1.15fr_1fr]">
            <div className="stagger grid grid-cols-2 gap-3">
              {ATTENTION.map((t) => {
                const n = unresolved.filter((a) => a.attention === t.key).length
                const on = attention === t.key
                return (
                  <Panel key={t.key} className={cx('p-4', on && 'border-gold/50')} attention={t.key === 'critical' && n > 0}
                    onClick={() => { setAttention(on ? null : t.key); if (!on && tab === 'closed') setTab('all') }} title={on ? 'Click to clear this filter' : `Show only ${t.label.toLowerCase()} items`}>
                    <div className="flex items-center gap-2"><span className={cx('lamp', n > 0 ? t.lamp : '')} /><span className="eyebrow">{t.label}</span></div>
                    <div className={cx('num mt-2.5 text-[26px] leading-none', n > 0 ? t.text : 'text-muted')}>{n.toLocaleString()}</div>
                    <div className="mt-2 text-[11px] text-muted">open or under review · {t.meaning}</div>
                  </Panel>
                )
              })}
            </div>
            <Panel className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="eyebrow">By kind</div><div className="display mt-0.5 text-[15px]">What the open indicators are about</div></div>
                <Radar size={17} className="text-gold" />
              </div>
              {kinds.length ? <KindDonut data={kinds} total={unresolved.length} picked={kind} onPick={(k) => setKind(kind === k ? null : k)} /> : (
                <div className="py-8 text-center text-[13px] text-muted">No indicator is open or under review.</div>
              )}
            </Panel>
          </div>

          <Tabs<TabKey>
            tabs={[
              { key: 'open', label: 'Open', count: alerts.filter((a) => a.status === 'open').length },
              { key: 'reviewing', label: 'Reviewing', count: alerts.filter((a) => a.status === 'reviewing').length },
              { key: 'closed', label: 'Closed', count: alerts.filter(isClosed).length },
              { key: 'all', label: 'All', count: alerts.length },
            ]}
            value={tab} onChange={setTab}
          />

          <Panel lit={false}>
            <DataTable
              key={tab}
              columns={columns}
              rows={rows}
              rowKey={(a) => a.id}
              onRow={(a) => openAlert(a.id)}
              exportName={`sentinel-${tab}`}
              initialSort={tab === 'open' || tab === 'reviewing' ? { key: 'attention', dir: 'desc' } : { key: 'created', dir: 'desc' }}
              toolbar={(attention || kind) ? <>
                {attention && <button className="chip gold" onClick={() => setAttention(null)} title="Clear this filter">Attention: {attention} ×</button>}
                {kind && <button className="chip gold" onClick={() => setKind(null)} title="Clear this filter">Kind: {humanise(kind)} ×</button>}
              </> : undefined}
              empty={alerts.length === 0
                ? { title: 'Sentinel has raised nothing', body: 'No indicator exists for the selected companies. Run Sentinel to check the books now.', icon: <ShieldCheck size={20} /> }
                : { title: 'Nothing in this list', body: 'No indicator matches the selected tab and filters.', icon: <ShieldCheck size={20} /> }}
            />
          </Panel>
        </>
      )}

      <AlertDrawer alert={selected} onClose={() => openAlert(null)} go={(to) => nav(to)} />
    </div>
  )
}

function KindDonut({ data, total, picked, onPick }: { data: { key: string; label: string; count: number; color: string }[]; total: number; picked: string | null; onPick: (key: string) => void }) {
  const size = 164, thickness = 20
  const r = size / 2 - thickness / 2 - 4
  const C = 2 * Math.PI * r
  let off = 0
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label={`${total} open indicators by kind`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
          {data.map((d) => {
            const len = (d.count / Math.max(1, total)) * C
            const el = (
              <circle key={d.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={picked === d.key ? thickness + 5 : thickness}
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off}
                opacity={picked && picked !== d.key ? 0.35 : 1} style={{ cursor: 'pointer', transition: 'stroke-width .18s, opacity .18s' }} onClick={() => onPick(d.key)}>
                <title>{`${d.label}: ${d.count}`}</title>
              </circle>
            )
            off += len
            return el
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="num text-[22px] leading-none">{total.toLocaleString()}</div><div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted">open</div></div>
        </div>
      </div>
      <div className="min-w-[180px] flex-1">
        {data.map((d) => (
          <button key={d.key} onClick={() => onPick(d.key)} aria-pressed={picked === d.key}
            className={cx('flex w-full items-center justify-between gap-3 rounded-md px-2 py-[5px] text-left text-[12.5px] transition-colors hover:bg-surface2', picked === d.key && 'bg-surface2')}>
            <span className="flex min-w-0 items-center gap-2 text-ink2"><i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: d.color }} /><span className="truncate">{d.label}</span></span>
            <span className="num flex-none text-ink">{d.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function AlertDrawer({ alert, onClose, go }: { alert: Alert | null; onClose: () => void; go: (to: string) => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  useApp((s) => s.session)
  const { act, busy } = useAction()
  const [closing, setClosing] = useState<'resolved' | 'false_positive' | null>(null)

  const ev = alert?.evidence ?? {}
  const journalIds = [...asIds(ev.journal_id), ...asIds(ev.reversal_journal)]
  const paymentIds = [...asIds(ev.payment_ids), ...asIds(ev.payment_id)]
  const invoiceIds = [...asIds(ev.invoice_ids), ...asIds(ev.invoice_id)]
  const partyIds = asIds(ev.party_id)
  const invoiceKey = invoiceIds.join(',')

  // the document type decides which screen opens an invoice; ask the API rather than assume
  const invoices = useAsync(async () => Promise.all(invoiceIds.map((id) => api.getInvoice(id).then((i) => i as Invoice | null, () => null))), [api, invoiceKey])
  const invoiceById = new Map((invoices.data ?? []).filter((i): i is Invoice => !!i).map((i) => [i.id, i]))

  const mayReview = !!alert && can('sentinel.review', alert.company_id)
  const why = mayReview ? undefined : 'Your role does not include the permission to review Sentinel items (sentinel.review) in this company.'
  const live = !!alert && isUnresolved(alert)
  const facts = Object.entries(ev).filter(([k]) => k !== 'rule' && !LINK_KEYS.includes(k))
  const hasPrefix = !!alert && PREFIX.test(alert.title)
  const rule = typeof ev.rule === 'string' ? ev.rule : ev.rule !== undefined && ev.rule !== null ? show(ev.rule) : null

  const startReview = async () => {
    if (!alert) return
    await act(() => api.reviewAlert(alert.id, 'reviewing'), 'Review started')
  }
  const close = async (note: string) => {
    if (!alert || !closing) return
    const status = closing
    setClosing(null)
    await act(() => api.reviewAlert(alert.id, status, note), status === 'resolved' ? 'Marked as resolved' : 'Marked as a false positive')
  }

  const links: { key: string; label: string; to: string; icon?: ReactNode }[] = [
    ...journalIds.map((id, i) => ({ key: 'j' + id, label: journalIds.length > 1 ? `Open journal ${i + 1}` : 'Open the journal', to: '/journals/' + id })),
    ...invoiceIds.map((id, i) => {
      const inv = invoiceById.get(id)
      const to = (inv && inv.doc_type !== 'purchase_bill' && inv.doc_type !== 'debit_note' ? '/invoices/' : '/bills/') + id
      return { key: 'i' + id, label: inv?.doc_no ? `Open document ${inv.doc_no}` : invoiceIds.length > 1 ? `Open document ${i + 1}` : 'Open the document', to }
    }),
    ...(paymentIds.length ? [{ key: 'p', label: paymentIds.length > 1 ? `Open payments (${paymentIds.length} records)` : 'Open payments', to: '/payments' }] : []),
    ...partyIds.map((id) => ({ key: 'party' + id, label: `Open party — ${parties.find((p) => p.id === id)?.display_name ?? 'record'}`, to: '/parties/' + id })),
  ]

  return (
    <>
      <Drawer open={!!alert} onClose={onClose} width={620}
        title={alert ? <span className="block"><span className="eyebrow mb-1 block">{hasPrefix ? 'Anomaly detected' : 'Indicator for review'}</span><span className="block whitespace-normal">{shortTitle(alert)}</span></span> : ''}
        subtitle={alert && <span className="flex flex-wrap items-center gap-2"><StatusChip status={alert.attention} /><StatusChip status={alert.status} /><span>{companies.find((c) => c.id === alert.company_id)?.name ?? 'Company'}</span><span>·</span><span className="num">{fmtDateTime(alert.created_at)}</span></span>}
        footer={alert && live ? <>
          {alert.status === 'open' && <button className="btn" onClick={startReview} disabled={busy || !mayReview} title={why ?? 'Mark this item as being reviewed'}><Eye size={14} /> Start review</button>}
          <button className="btn ghost" onClick={() => setClosing('false_positive')} disabled={busy || !mayReview} title={why ?? 'The pattern has an ordinary explanation'}><CircleSlash size={14} /> Mark as false positive</button>
          <button className="btn good" onClick={() => setClosing('resolved')} disabled={busy || !mayReview} title={why ?? 'The item has been looked into and dealt with'}><CheckCircle2 size={14} /> Resolve</button>
        </> : undefined}>
        {alert && (
          <div className="space-y-5">
            <p className="m-0 text-[13.5px] leading-relaxed text-ink">{alert.explanation}</p>

            <div>
              <div className="eyebrow mb-2">Why was this flagged?</div>
              {rule ? <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-gold">{sentence(rule)}</div> : <div className="text-[12.5px] text-muted">No rule text was recorded with this item.</div>}
              <div className="mt-1.5 text-[11.5px] text-muted">The rule is a pattern test applied to recorded entries. Meeting it is a reason to look, not a finding.</div>
            </div>

            {facts.length > 0 && (
              <div>
                <div className="eyebrow mb-2">Facts recorded with this item</div>
                <div className="rounded-xl border border-line px-3.5">
                  {facts.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
                      <span className="flex-none text-muted">{sentence(humanise(k))}</span>
                      <span className="num min-w-0 break-all text-right text-ink">{show(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="eyebrow mb-2">Underlying records</div>
              {links.length === 0 ? <div className="text-[12.5px] text-muted">No linked record was stored with this item.</div> : (
                <div className="flex flex-wrap gap-2">
                  {links.map((l) => <button key={l.key} className="btn sm" onClick={() => go(l.to)}><ExternalLink size={13} /> {l.label}</button>)}
                </div>
              )}
            </div>

            {alert.review_note && (
              <div>
                <div className="eyebrow mb-2">Review note</div>
                <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink2">{alert.review_note}</div>
              </div>
            )}

            {!live && <Note kind="good">This item is closed as {humanise(alert.status)}. It stays on record and cannot be deleted.</Note>}
            {live && !mayReview && <Note>You can read this item. Reviewing it needs the sentinel.review permission in this company.</Note>}
          </div>
        )}
      </Drawer>

      <ReasonDialog open={!!closing} title={closing === 'resolved' ? 'Resolve this item' : 'Mark as a false positive'} confirm={closing === 'resolved' ? 'Resolve' : 'Mark as false positive'}
        onCancel={() => setClosing(null)} onConfirm={close}
        body={closing === 'resolved'
          ? 'Record what was checked and what was done. The note is kept with the item and in the audit trail.'
          : 'Record why this pattern has an ordinary explanation. The note is kept with the item and in the audit trail.'} />
    </>
  )
}
