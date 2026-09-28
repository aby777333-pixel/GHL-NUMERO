import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Copy, ExternalLink, FileText, Mail, MessageSquare, Plus, Save, XCircle } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { Communication, MessageTemplate, TemplateKey } from '@/engine/p3Types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { useCompanyName, usePartyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { DemoTag, Fact, History, NoAccess, Tile, human, useCompanyChoices, useCompanyCode } from '@/ui/p3'

// =====================================================================
// Communications (spec 60): reminders, statements and confirmations
// PREPARED here from templates, and a record of what a person sent.
// NUMERO sends nothing. A person sends the message from their own
// mailbox or by post, and records that they did. The words of a
// prepared message are fixed from the moment it is prepared.
// =====================================================================

type TabKey = 'messages' | 'templates'
const TABS: { key: TabKey; label: string }[] = [{ key: 'messages', label: 'Messages' }, { key: 'templates', label: 'Templates' }]

const CHANNELS: { key: Communication['channel']; label: string }[] = [
  { key: 'email', label: 'E-mail' }, { key: 'letter', label: 'Letter' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'sms', label: 'SMS' },
  { key: 'phone', label: 'Telephone' }, { key: 'in_person', label: 'In person' }, { key: 'portal', label: 'Portal of the other party' },
]
const channelLabel = (k: string) => CHANNELS.find((c) => c.key === k)?.label ?? human(k)
const TEMPLATE_KEYS: { key: TemplateKey; label: string }[] = [
  { key: 'invoice', label: 'Invoice' }, { key: 'payment_reminder', label: 'Payment reminder' }, { key: 'statement', label: 'Statement of account' }, { key: 'receipt', label: 'Receipt' },
  { key: 'approval_request', label: 'Approval request' }, { key: 'report', label: 'Report' }, { key: 'confirmation', label: 'Confirmation of balance' }, { key: 'capital_call', label: 'Capital call' }, { key: 'other', label: 'Other' },
]
const keyLabel = (k: string | null) => (k ? TEMPLATE_KEYS.find((t) => t.key === k)?.label ?? human(k) : '—')
const STATUS_LABEL: Record<Communication['status'], string> = { prepared: 'prepared — not recorded as sent', sent_by_person: 'sent by a person', not_sent: 'not sent' }

/** the screens a communication can be about */
const RECORD: Record<string, string> = {
  invoices: '/invoices/', bills: '/bills/', parties: '/parties/', journals: '/journals/', journal: '/journals/', register_items: '/registers/', advances: '/expenses/advances/',
  expense_claims: '/expenses/claims/', purchase_docs: '/purchasing/', capital_calls: '/investments/calls/', capital_call: '/investments/calls/', distributions: '/investments/distributions/',
  distribution: '/investments/distributions/', cases: '/reality/cases/', loans: '/treasury/loans/', fixed_assets: '/assets/',
}
const recordRoute = (entity: string | null, id: ID | null) => (entity && id && RECORD[entity] ? RECORD[entity] + id : null)

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g
const placeholdersOf = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))]
/** A placeholder is replaced only by what the person typed. One left empty stays in the text, in sight. */
const fill = (text: string, values: Record<string, string>) => text.replace(PLACEHOLDER, (m, k: string) => (values[k]?.trim() ? values[k].trim() : m))
const isEmail = (s: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s.trim())
const scopeOf = (t: Pick<MessageTemplate, 'company_id'>, name: (id: ID) => string) => (t.company_id ? name(t.company_id) : 'Whole group')

export default function Communications() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('communication.send', id) || can('party.view', id))
  if (!ids.length) return <NoAccess eyebrow="Integrations" title="Communications" perm={['communication.send', 'party.view']} />
  return <View ids={ids} />
}

function View({ ids }: { ids: ID[] }) {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const code = useCompanyCode()
  const idsKey = ids.join(',')
  const sendIds = ids.filter((id) => can('communication.send', id))
  const readOnlyIds = ids.filter((id) => !sendIds.includes(id))
  const noSend = sendIds.length ? undefined : 'You need the permission communication.send to prepare a message or record what became of it'

  const wanted = sp.get('tab')
  const messageId = sp.get('message')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'messages'
  const go = (next: Record<string, string>) => setSp(next, { replace: true })

  const [preparing, setPreparing] = useState(false)
  const [template, setTemplate] = useState<MessageTemplate | 'new' | null>(null)
  const [status, setStatus] = useState<Communication['status'] | ''>('')
  const [allVersions, setAllVersions] = useState(false)

  const comms = useAsync(() => api.listCommunications({ companyIds: ids }), [api, idsKey])
  const templates = useAsync(() => api.listMessageTemplates(), [api])
  // names of colleagues are read from the team; a role that cannot read the team sees no name, not a wrong one
  const people = useAsync(async () => { try { return new Map((await api.listMembers()).map((m) => [m.user_id, m.full_name])) } catch { return new Map<ID, string>() } }, [api])
  const personName = (id: ID | null) => (!id ? '—' : id === session?.user.id ? session.user.name : people.data?.get(id) ?? 'A colleague — the name is not shown to your role')

  const rows = comms.data ?? []
  const shown = status ? rows.filter((c) => c.status === status) : rows
  const count = (s: Communication['status']) => rows.filter((c) => c.status === s).length
  const selected = messageId ? rows.find((c) => c.id === messageId) ?? null : null
  const tpl = templates.data ?? []
  const tplShown = allVersions ? tpl : tpl.filter((t) => t.is_active)

  const columns: Column<Communication>[] = [
    { key: 'at', header: 'Prepared', render: (c) => <span className="num text-[12.5px]">{fmtDateTime(c.prepared_at)}</span>, sort: (c) => c.prepared_at, csv: (c) => c.prepared_at },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{code(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'channel', header: 'Channel', render: (c) => <span className="chip">{channelLabel(c.channel)}</span>, sort: (c) => c.channel, csv: (c) => channelLabel(c.channel) },
    {
      key: 'to', header: 'To whom', sort: (c) => partyName(c.party_id).toLowerCase(), csv: (c) => [c.party_id ? partyName(c.party_id) : '', c.to_address ?? ''].filter(Boolean).join(' — '),
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{c.party_id ? partyName(c.party_id) : <span className="text-muted">no party recorded</span>}</div>
          {c.to_address && <div className="truncate text-[11.5px] text-muted">{c.to_address}</div>}
        </div>
      ),
    },
    { key: 'subject', header: 'Subject', render: (c) => <div className="min-w-0"><div className="break-words text-ink">{c.subject}</div>{c.template_key && <div className="text-[11.5px] text-muted">from the template {keyLabel(c.template_key).toLowerCase()}</div>}</div>, sort: (c) => c.subject.toLowerCase(), csv: (c) => c.subject },
    {
      key: 'about', header: 'About', sort: (c) => c.entity ?? '', csv: (c) => (c.entity ? `${c.entity} ${c.entity_id ?? ''}`.trim() : ''),
      render: (c) => {
        const to = recordRoute(c.entity, c.entity_id)
        return !c.entity ? <span className="text-muted">—</span>
          : to ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav(to) }}>{human(c.entity)} <ExternalLink size={11} /></button>
          : <span className="text-[12.5px] text-ink2">{human(c.entity)}</span>
      },
    },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} label={STATUS_LABEL[c.status]} />, sort: (c) => c.status, csv: (c) => STATUS_LABEL[c.status] },
    { key: 'by', header: 'Prepared by', render: (c) => <span className="text-[12.5px] text-ink2">{personName(c.prepared_by)}</span>, sort: (c) => personName(c.prepared_by), csv: (c) => personName(c.prepared_by) },
    { key: 'sent', header: 'Sent on', render: (c) => (c.sent_on ? <span className="num text-[12.5px]">{fmtDate(c.sent_on)}</span> : <span className="text-muted">—</span>), sort: (c) => c.sent_on ?? '', csv: (c) => c.sent_on ?? '' },
    { key: 'note', header: 'How it was sent, or why it was not', render: (c) => <span className="break-words text-[12.5px] text-ink2">{c.sent_note ?? '—'}</span>, csv: (c) => c.sent_note ?? '' },
  ]

  const templateColumns: Column<MessageTemplate>[] = [
    { key: 'key', header: 'For', render: (t) => <span className="chip">{keyLabel(t.key)}</span>, sort: (t) => t.key, csv: (t) => keyLabel(t.key) },
    { key: 'name', header: 'Name', render: (t) => <span className="text-ink">{t.name}</span>, sort: (t) => t.name.toLowerCase(), csv: (t) => t.name },
    { key: 'subject', header: 'Subject', render: (t) => <span className="break-words text-[12.5px] text-ink2">{t.subject}</span>, sort: (t) => t.subject.toLowerCase(), csv: (t) => t.subject },
    { key: 'scope', header: 'Used by', render: (t) => (t.company_id ? <span className="text-ink2" title={companyName(t.company_id)}>{code(t.company_id)}</span> : <span className="chip cyan">whole group</span>), sort: (t) => scopeOf(t, companyName), csv: (t) => scopeOf(t, companyName) },
    { key: 'version', header: 'Version', align: 'right', render: (t) => <span className="num">{t.version}</span>, sort: (t) => t.version, csv: (t) => t.version },
    { key: 'state', header: 'State', render: (t) => (t.is_active ? <span className="chip pos">in use</span> : <span className="chip" title="A later version of this template took its place">replaced</span>), sort: (t) => Number(t.is_active), csv: (t) => (t.is_active ? 'In use' : 'Replaced') },
    { key: 'fields', header: 'Placeholders', render: (t) => { const p = placeholdersOf(t.subject + ' ' + t.body); return p.length ? <span className="num text-[11.5px] text-muted">{p.join(', ')}</span> : <span className="text-muted">none</span> }, csv: (t) => placeholdersOf(t.subject + ' ' + t.body).join(', ') },
    { key: 'created', header: 'Saved', render: (t) => <span className="num text-[12.5px]">{fmtDateTime(t.created_at)}</span>, sort: (t) => t.created_at, csv: (t) => t.created_at },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Integrations"
        title="Communications"
        subtitle={<>
          Messages are prepared here and sent by a person from their own mailbox, by post or by hand. NUMERO sends nothing; it keeps the record of what was prepared and of what a person says became of it.
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          <button className="btn" disabled={!sendIds.length} title={noSend} onClick={() => setTemplate('new')}><FileText size={15} /> New template</button>
          <button className="btn primary" disabled={!sendIds.length} title={noSend} onClick={() => setPreparing(true)}><Plus size={15} /> Prepare a message</button>
        </>}
      />

      {comms.data && (
        <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Prepared, nothing recorded yet" tone={count('prepared') ? 'text-warn' : undefined} onClick={() => { setStatus('prepared'); go({ tab: 'messages' }) }} sub="Nobody has recorded whether these were sent"><span className="num">{count('prepared').toLocaleString()}</span></Tile>
          <Tile label="Sent by a person" onClick={() => { setStatus('sent_by_person'); go({ tab: 'messages' }) }} sub="As recorded by the person who sent them"><span className="num">{count('sent_by_person').toLocaleString()}</span></Tile>
          <Tile label="Not sent" onClick={() => { setStatus('not_sent'); go({ tab: 'messages' }) }} sub="Prepared and then not sent, with the reason"><span className="num">{count('not_sent').toLocaleString()}</span></Tile>
          <Tile label="Templates in use" onClick={() => go({ tab: 'templates' })} sub={templates.data ? `${tpl.length.toLocaleString()} version${tpl.length === 1 ? '' : 's'} on record` : templates.error ? 'could not be loaded' : 'loading'}><span className="num">{tpl.filter((t) => t.is_active).length.toLocaleString()}</span></Tile>
        </div>
      )}

      {readOnlyIds.length > 0 && (
        <Note className="mb-4">
          In {readOnlyIds.map((id) => code(id)).join(', ')} your role reads parties (<span className="num text-ink">party.view</span>) but does not include <span className="num text-ink">communication.send</span>. Communications of {readOnlyIds.length === 1 ? 'that company' : 'those companies'} are listed
          for you to read. Preparing a communication and recording that it was sent need the permission.
        </Note>
      )}

      <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'messages' ? comms.data?.length : templates.data ? tpl.filter((x) => x.is_active).length : undefined }))} value={tab} onChange={(k) => go({ tab: k })} />

      {tab === 'messages' && (
        comms.error ? <ErrorBox message={comms.error} retry={comms.reload} />
          : !comms.data ? <Panel><Loading rows={6} label="Loading communications" /></Panel>
          : (
            <Panel lit={false}>
              <DataTable columns={columns} rows={shown} rowKey={(c) => c.id} onRow={(c) => go({ tab: 'messages', message: c.id })} exportName="communications" initialSort={{ key: 'at', dir: 'desc' }}
                rowClass={(c) => (c.status === 'prepared' ? 'bg-warnsoft' : undefined)}
                toolbar={<>
                  <select className="field sm" style={{ width: 250 }} value={status} onChange={(e) => setStatus(e.target.value as Communication['status'] | '')} aria-label="Status">
                    <option value="">Every status</option>
                    {(Object.keys(STATUS_LABEL) as Communication['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                  <span className="text-[12px] text-muted">“Sent” here always means that a person recorded having sent it. NUMERO has no means of sending and none of knowing whether a message arrived.</span>
                </>}
                empty={{
                  title: status ? 'No communication has this status' : 'No communication is on record', icon: <MessageSquare size={20} />,
                  body: status ? 'Choose another status to see the others.' : 'Prepare a reminder, a statement or a confirmation from a template. It is kept word for word; a person sends it and records that they did.',
                  action: status ? <button className="btn sm" onClick={() => setStatus('')}>Show every status</button> : <button className="btn sm" disabled={!sendIds.length} title={noSend} onClick={() => setPreparing(true)}><Plus size={13} /> Prepare a message</button>,
                }} />
            </Panel>
          )
      )}

      {tab === 'templates' && (
        templates.error ? <ErrorBox message={templates.error} retry={templates.reload} />
          : !templates.data ? <Panel><Loading rows={5} label="Loading templates" /></Panel>
          : (
            <div className="space-y-4">
              <Panel lit={false}>
                <DataTable columns={templateColumns} rows={tplShown} rowKey={(t) => t.id} onRow={(t) => setTemplate(t)} exportName="message-templates"
                  toolbar={<>
                    <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={allVersions} onChange={(e) => setAllVersions(e.target.checked)} /> Show the versions that were replaced</label>
                    <button className="btn sm" disabled={!sendIds.length} title={noSend} onClick={() => setTemplate('new')}><Plus size={13} /> New template</button>
                  </>}
                  empty={{ title: 'No template is on record', body: 'A template holds the subject and the body of a message, with placeholders such as {{invoice_no}} for what changes each time.', icon: <FileText size={20} />, action: <button className="btn sm" disabled={!sendIds.length} title={noSend} onClick={() => setTemplate('new')}><Plus size={13} /> New template</button> }} />
              </Panel>
              <Panel className="p-4 text-[12.5px] text-ink2" lit={false}>
                <div className="eyebrow mb-2">How versions work</div>
                <ul className="m-0 list-disc space-y-1 pl-4">
                  <li>A template is never overwritten. Saving a template for the same purpose and the same scope — the whole group, or one company — adds a new version with the next number.</li>
                  <li>The new version becomes the one in use. Every earlier version for that purpose and scope is kept and marked as replaced.</li>
                  <li>A company may have its own template beside that of the group: the two are separate, each with its own versions.</li>
                  <li>Messages already prepared keep the words they were prepared with, whatever happens to the template afterwards.</li>
                </ul>
              </Panel>
            </div>
          )
      )}

      <Drawer open={!!messageId && !!comms.data} onClose={() => go({ tab: 'messages' })} width={640}
        title={selected ? selected.subject : 'Communication'}
        subtitle={selected ? `${channelLabel(selected.channel)} · ${companyName(selected.company_id)}` : undefined}>
        {selected
          ? <MessageBody key={selected.id} c={selected} preparedBy={personName(selected.prepared_by)} />
          : <Empty icon={<MessageSquare size={20} />} title="Communication not found or not shared with you" body="This communication does not exist in the companies selected, or your role does not read it." />}
      </Drawer>

      <PrepareModal open={preparing} companyIds={sendIds} templates={tpl} onClose={() => setPreparing(false)} onPrepared={(id) => { setPreparing(false); setStatus(''); go({ tab: 'messages', message: id }) }} />
      <TemplateModal value={template} templates={tpl} companyIds={sendIds} onClose={() => setTemplate(null)} />
    </div>
  )
}

// =====================================================================
// One communication: its words, and what a person says became of it
// =====================================================================
function MessageBody({ c, preparedBy }: { c: Communication; preparedBy: string }) {
  const api = useApp((s) => s.api)!
  const toast = useApp((s) => s.toast)
  const nav = useNavigate()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const [sending, setSending] = useState(false)
  const [notSending, setNotSending] = useState(false)
  const [sentOn, setSentOn] = useState(today())
  const [how, setHow] = useState('')

  const send = can('communication.send', c.company_id)
  const noSend = send ? undefined : 'You need the permission communication.send in this company'
  const to = recordRoute(c.entity, c.entity_id)
  const address = c.to_address && isEmail(c.to_address) ? c.to_address.trim() : ''
  const mailto = `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(c.body)}`
  const problem = !sentOn ? 'State the date it was sent.' : sentOn > today() ? 'The date cannot be in the future.' : sentOn < c.prepared_at.slice(0, 10) ? 'The date is before the message was prepared.' : !how.trim() ? 'Record how it was sent: from which mailbox, by which courier, by whom.' : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${c.subject}\n\n${c.body}`)
      toast('ok', 'Copied', 'The subject and the body are on the clipboard. Nothing has been sent.')
    } catch {
      toast('warn', 'The text could not be copied', 'This browser did not allow it. Select the text and copy it by hand.')
    }
  }
  const record = async (status: 'sent_by_person' | 'not_sent', note: string, on?: string) => {
    const ok = await act(async () => { await api.markCommunication(c.id, status, note, on); return true }, status === 'sent_by_person' ? 'Recorded as sent by a person' : 'Recorded as not sent')
    if (ok) { setSending(false); setNotSending(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={c.status} label={STATUS_LABEL[c.status]} />
        <span className="chip">{channelLabel(c.channel)}</span>
        {c.template_key && <span className="chip cyan">template: {keyLabel(c.template_key).toLowerCase()}</span>}
      </div>

      {c.status === 'prepared' && (
        <Note kind="warn">
          NUMERO has sent nothing. This message is prepared: copy it{c.channel === 'email' ? ' or open it in your own mail program' : ''}, send it yourself, and then record that it was sent, and how. If it is not going to be sent, record that instead, with the reason.
        </Note>
      )}

      <div className="no-print flex flex-wrap gap-2">
        <button className="btn" onClick={() => void copy()}><Copy size={14} /> Copy</button>
        {c.channel === 'email' && <a className="btn" href={mailto} title="Opens your own mail program with this text. NUMERO still sends nothing."><Mail size={14} /> Open in my mail program</a>}
        {c.status === 'prepared' && <>
          <button className="btn primary" disabled={!send || busy} title={noSend} onClick={() => { setSentOn(today()); setHow(''); setSending(true) }}><CheckCircle2 size={15} /> Record that it was sent</button>
          <button className="btn" disabled={!send || busy} title={noSend} onClick={() => setNotSending(true)}><XCircle size={14} /> Record that it was not sent</button>
        </>}
      </div>
      {c.channel === 'email' && (
        <div className="-mt-3 text-[11.5px] text-muted">
          The link opens the mail program of this device with the subject and the body filled in{address ? ` and ${address} as the recipient` : '; the address on record is not an e-mail address, so the recipient is left for you to enter'}.
          A long message may be cut short by the mail program: compare it with the text below, or use Copy.
        </div>
      )}

      <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
        <Fact label="Company">{companyName(c.company_id)}</Fact>
        <Fact label="Channel">{channelLabel(c.channel)}</Fact>
        <Fact label="To whom">{c.party_id ? <button className="link" onClick={() => nav('/parties/' + c.party_id)}>{partyName(c.party_id)}</button> : 'No party recorded'}</Fact>
        <Fact label="Address">{c.to_address ?? 'Not recorded'}</Fact>
        <Fact label="About">{!c.entity ? 'No record linked' : to ? <button className="link inline-flex items-center gap-1" onClick={() => nav(to)}>{human(c.entity)} <ExternalLink size={11} /></button> : human(c.entity)}</Fact>
        <Fact label="Prepared">{preparedBy} · <span className="num">{fmtDateTime(c.prepared_at)}</span></Fact>
        <Fact label="Sent on">{c.status === 'sent_by_person' ? <span className="num">{fmtDate(c.sent_on)}</span> : c.status === 'not_sent' ? 'Not sent' : 'Nothing recorded yet'}</Fact>
        <Fact label={c.status === 'not_sent' ? 'Why it was not sent' : 'How it was sent'}>{c.sent_note ?? 'Nothing recorded yet'}</Fact>
      </Panel>

      <Section title="The words, as prepared" right={<span className="text-[11.5px] text-muted">They cannot be changed afterwards</span>}>
        <Panel className="p-4" lit={false}>
          <div className="text-[11.5px] text-muted">Subject</div>
          <div className="mt-0.5 break-words text-[13.5px] font-medium text-ink">{c.subject}</div>
          <div className="hairline my-3" />
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink2">{c.body}</div>
        </Panel>
        <div className="mt-2 text-[11.5px] text-muted">To say something else, prepare another message. This one stays on record as it is.</div>
      </Section>

      <History entity="communications" entityId={c.id} />

      <Modal open={sending} onClose={() => setSending(false)} title="Record that it was sent" subtitle={c.subject} width={520}
        footer={<><button className="btn ghost" onClick={() => setSending(false)}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => void record('sent_by_person', how.trim(), sentOn)}>{busy ? <Spinner /> : <CheckCircle2 size={15} />} Record</button></>}>
        <Note className="mb-4">You are recording that a person sent this message outside NUMERO. The record cannot be changed afterwards.</Note>
        <div className="grid gap-4">
          <Field label="Sent on"><input type="date" className="field" value={sentOn} max={today()} min={c.prepared_at.slice(0, 10)} onChange={(e) => setSentOn(e.target.value)} /></Field>
          <Field label="How it was sent, and by whom" hint="For example: from the accounts mailbox by Priya Raman; by registered post, receipt 4512.">
            <textarea className="field" rows={3} value={how} onChange={(e) => setHow(e.target.value)} autoFocus />
          </Field>
        </div>
        {problem && how !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
      </Modal>

      <ReasonDialog open={notSending} title="Record that it was not sent" confirm="Record that it was not sent" onCancel={() => setNotSending(false)}
        body="The message stays on record as prepared and not sent. This cannot be changed afterwards; to send it after all, prepare it again."
        onConfirm={(reason) => void record('not_sent', reason)} />
    </div>
  )
}

// =====================================================================
// Prepare a message
// =====================================================================
interface Draft { company_id: ID; channel: Communication['channel']; template_id: ID | ''; party_id: ID | ''; to_address: string; subject: string; body: string; invoice_id: ID | '' }

function PrepareModal({ open, companyIds, templates, onClose, onPrepared }: { open: boolean; companyIds: ID[]; templates: MessageTemplate[]; onClose: () => void; onPrepared: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useCompanyChoices(companyIds)
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const blank = (): Draft => ({ company_id: companies[0]?.id ?? '', channel: 'email', template_id: '', party_id: '', to_address: '', subject: '', body: '', invoice_id: '' })
  const [f, setF] = useState<Draft>(blank)
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => { if (open) { setF(blank()); setValues({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }))

  const offered = useMemo(() => templates.filter((t) => t.is_active && (t.company_id === null || t.company_id === f.company_id)).sort((a, b) => a.key.localeCompare(b.key) || Number(!!b.company_id) - Number(!!a.company_id)), [templates, f.company_id])
  const people = useMemo(() => parties.filter((p) => (p.roles.some((r) => r.company_id === f.company_id) || p.id === f.party_id) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, f.company_id, f.party_id])
  const party = parties.find((p) => p.id === f.party_id)
  const seesInvoices = !!f.company_id && can('invoice.view', f.company_id)
  const invoices = useAsync(async () => (open && f.party_id && seesInvoices
    ? (await api.listInvoices({ companyIds: [f.company_id], docTypes: ['sales_invoice'], partyId: f.party_id })).filter((i) => i.status === 'open' || i.status === 'partially_paid')
    : []), [api, open, f.company_id, f.party_id, seesInvoices])

  const chosen = templates.find((t) => t.id === f.template_id) ?? null
  const names = placeholdersOf(f.subject + '\n' + f.body)
  const subject = fill(f.subject, values)
  const body = fill(f.body, values)
  const left = placeholdersOf(subject + '\n' + body)
  const problem = !f.company_id ? 'Choose the company the message is from.'
    : !f.subject.trim() ? 'Write the subject.'
    : !f.body.trim() ? 'Write the body.'
    : left.length ? `Fill in: ${left.join(', ')}.`
    : null

  const pickTemplate = (id: ID | '') => {
    const t = templates.find((x) => x.id === id)
    set({ template_id: id, ...(t ? { subject: t.subject, body: t.body } : {}) })
    if (t) setValues({})
  }
  const submit = async () => {
    const id = await act(() => api.prepareCommunication({
      company_id: f.company_id, channel: f.channel, template_key: chosen?.key, party_id: f.party_id || null, to_address: f.to_address.trim() || undefined, subject, body,
      ...(f.invoice_id ? { entity: 'invoices', entity_id: f.invoice_id } : {}),
    }), 'Prepared. Nothing has been sent.')
    if (id) onPrepared(id)
  }

  return (
    <Modal open={open} onClose={onClose} title="Prepare a message" subtitle="NUMERO keeps the words. A person sends them." width={920}
      footer={<>
        {problem && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void submit()}>{busy ? <Spinner /> : <Save size={15} />} Prepare</button>
      </>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From the company">
              <select className="field" value={f.company_id} onChange={(e) => { set({ company_id: e.target.value, template_id: '', party_id: '', invoice_id: '' }) }}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="Channel" hint="The way a person will send it">
              <select className="field" value={f.channel} onChange={(e) => set({ channel: e.target.value as Communication['channel'] })}>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            </Field>
            <Field label="Template" className="sm:col-span-2" hint={offered.length ? 'Optional. Choosing one replaces the subject and the body below.' : 'No template is in use for this company or for the group.'}>
              <select className="field" value={f.template_id} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">No template — written by hand</option>
                {offered.map((t) => <option key={t.id} value={t.id}>{keyLabel(t.key)} · {t.name} · v{t.version} · {t.company_id ? companyName(t.company_id) : 'whole group'}</option>)}
              </select>
            </Field>
            <Field label="To whom" hint="Optional. A party of this company.">
              <select className="field" value={f.party_id} onChange={(e) => set({ party_id: e.target.value, invoice_id: '' })}>
                <option value="">No party</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </select>
            </Field>
            <Field label="Address" hint="E-mail address, postal address or telephone number, as it will be used">
              <input className="field" value={f.to_address} onChange={(e) => set({ to_address: e.target.value })} />
            </Field>
            {party?.email && party.email !== f.to_address.trim() && (
              <div className="-mt-2 text-[11.5px] text-muted sm:col-span-2">
                The e-mail address on record for {party.display_name} is <span className="num text-ink2">{party.email}</span>. <button className="link" onClick={() => set({ to_address: party.email ?? '' })}>Use it</button>
              </div>
            )}
            <Field label="About which record" className="sm:col-span-2"
              hint={!f.party_id ? 'Choose a party to link one of its open sales invoices.' : !seesInvoices ? 'Your role does not read invoices in this company (invoice.view), so none can be offered.' : invoices.error ? `The invoices could not be loaded: ${invoices.error}` : invoices.loading ? 'Loading the open invoices…' : !invoices.data?.length ? 'This party has no open sales invoice in this company.' : 'Optional. Open and partly paid sales invoices of this party.'}>
              <select className="field" value={f.invoice_id} disabled={!invoices.data?.length} onChange={(e) => set({ invoice_id: e.target.value })}>
                <option value="">No record</option>
                {(invoices.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.doc_no ?? 'No number'} · {fmtDate(i.doc_date)} · due {fmtDate(i.due_date ?? i.doc_date)}</option>)}
              </select>
            </Field>
          </div>
          {f.invoice_id && (() => {
            const i = invoices.data?.find((x) => x.id === f.invoice_id)
            return i ? (
              <Panel className="grid gap-3 p-3.5 sm:grid-cols-3" lit={false}>
                <Fact label="Invoice"><span className="num text-gold">{i.doc_no ?? '—'}</span></Fact>
                <Fact label="Total"><Money value={i.total} currency={i.currency} /></Fact>
                <Fact label="Settled so far"><Money value={i.amount_settled} currency={i.currency} /></Fact>
                <div className="text-[11.5px] text-muted sm:col-span-3">Shown for you to read from. Nothing is copied into the message: what the message says is what you type.</div>
              </Panel>
            ) : null
          })()}
          <Field label="Subject" hint="Placeholders are written {{like_this}}">
            <input className="field" value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <Field label="Body">
            <textarea className="field" rows={9} value={f.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title={`Values for the placeholders${names.length ? ` · ${names.length}` : ''}`}>
            <Panel className="p-4" lit={false}>
              {names.length === 0
                ? <div className="text-[12.5px] text-muted">The text holds no placeholder.</div>
                : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {names.map((k) => (
                      <Field key={k} label={human(k)}>
                        <input className={cx('field sm', !values[k]?.trim() && 'border-warn')} value={values[k] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} aria-label={`Value for ${k}`} />
                      </Field>
                    ))}
                  </div>
                )}
              <div className="mt-3 text-[11.5px] text-muted">Every value is typed by you. NUMERO fills in nothing by itself, so that no message says something nobody checked.</div>
            </Panel>
          </Section>
          <Section title="What will be kept, word for word">
            <Panel className="p-4" lit={false}>
              <div className="text-[11.5px] text-muted">Subject</div>
              <div className="mt-0.5 break-words text-[13px] font-medium text-ink">{subject || <span className="font-normal text-muted">empty</span>}</div>
              <div className="hairline my-3" />
              <div className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink2">{body || <span className="text-muted">empty</span>}</div>
            </Panel>
          </Section>
          <Note kind="warn">Preparing sends nothing. After it is prepared the text cannot be edited: check it here first.</Note>
        </div>
      </div>
    </Modal>
  )
}

// =====================================================================
// A template, and the next version of it
// =====================================================================
interface TemplateDraft { company_id: ID | ''; key: TemplateKey; name: string; subject: string; body: string }

function TemplateModal({ value, templates, companyIds, onClose }: { value: MessageTemplate | 'new' | null; templates: MessageTemplate[]; companyIds: ID[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useCompanyChoices(companyIds)
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const [f, setF] = useState<TemplateDraft>({ company_id: '', key: 'payment_reminder', name: '', subject: '', body: '' })
  useEffect(() => {
    if (value === 'new') setF({ company_id: '', key: 'payment_reminder', name: '', subject: '', body: '' })
    else if (value) setF({ company_id: value.company_id ?? '', key: value.key, name: value.name, subject: value.subject, body: value.body })
  }, [value])
  const opened = value && value !== 'new' ? value : null

  const same = templates.filter((t) => t.key === f.key && (t.company_id ?? '') === f.company_id)
  const next = Math.max(0, ...same.map((t) => t.version)) + 1
  const inUse = same.find((t) => t.is_active)
  // a template of the group is saved by someone who may prepare messages; a template of a company, by someone who may in that company
  const allowed = f.company_id ? companyIds.includes(f.company_id) : companyIds.length > 0
  const unchanged = !!opened && (opened.company_id ?? '') === f.company_id && opened.key === f.key && opened.name === f.name.trim() && opened.subject === f.subject && opened.body === f.body
  const problem = !allowed ? 'Your role does not include communication.send for this scope.'
    : !f.name.trim() ? 'Give the template a name.'
    : !f.subject.trim() ? 'Write the subject.'
    : !f.body.trim() ? 'Write the body.'
    : unchanged ? 'Nothing has been changed.'
    : null
  const names = placeholdersOf(f.subject + '\n' + f.body)
  const save = async () => {
    const id = await act(() => api.saveMessageTemplate({ company_id: f.company_id || null, key: f.key, name: f.name.trim(), subject: f.subject, body: f.body }), `Saved as version ${next}`)
    if (id) onClose()
  }
  // a company the person cannot choose still has to be shown when the template opened belongs to it
  const extra = opened?.company_id && !companies.some((c) => c.id === opened.company_id) ? opened.company_id : null

  return (
    <Modal open={!!value} onClose={onClose} title={opened ? `${opened.name} · version ${opened.version}` : 'New template'} width={680}
      subtitle={opened ? (opened.is_active ? 'In use. Saving a change makes a new version.' : 'Replaced by a later version. Saving makes a new version from this text.') : 'The subject and the body of a message, with placeholders for what changes each time'}
      footer={<>
        {problem && (f.name !== '' || !!opened) && <span className="mr-auto text-[12px] text-warn">{problem}</span>}
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save as version {next}</button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="For" hint="What the message is for">
          <select className="field" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value as TemplateKey })}>{TEMPLATE_KEYS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        </Field>
        <Field label="Used by" hint="The whole group, or one company with wording of its own">
          <select className="field" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}>
            <option value="">Whole group</option>
            {extra && <option value={extra}>{companyName(extra)}</option>}
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Name" className="sm:col-span-2"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Subject" className="sm:col-span-2"><input className="field" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Body" className="sm:col-span-2" hint="Write a placeholder as {{name}}, for example {{invoice_no}} or {{due_date}}. The person who prepares a message types its value.">
          <textarea className="field" rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
        Placeholders found: {names.length ? names.map((k) => <span key={k} className="chip num">{k}</span>) : 'none'}
      </div>
      <Note className="mt-4">
        {inUse
          ? <>For {keyLabel(f.key).toLowerCase()}, {f.company_id ? companyName(f.company_id) : 'the whole group'} uses “{inUse.name}”, version {inUse.version}. Saving keeps it on record, marks it as replaced, and puts version {next} in use.</>
          : <>No template for {keyLabel(f.key).toLowerCase()} is on record for {f.company_id ? companyName(f.company_id) : 'the whole group'}. This will be version {next}.</>}
        {' '}Messages already prepared keep their words.
      </Note>
    </Modal>
  )
}
