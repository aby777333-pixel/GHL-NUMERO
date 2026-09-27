import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, CheckCircle2, ExternalLink, Eye, FileText, Inbox as InboxIcon, Link2, Lock, Save, Search, Trash2, UploadCloud, XCircle } from 'lucide-react'
import type { NumeroApi } from '@/api/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Confidentiality, DocType, ID } from '@/engine/types'
import { DOCUMENT_KINDS, type DocumentLink, type DocumentMeta, type DocumentRecord } from '@/engine/opsTypes'
import { D } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { useCompanyName, usePartyName } from '@/ui/ops'

type Tab = 'received' | 'classified' | 'linked' | 'processed' | 'rejected' | 'duplicates' | 'all'
const TABS: { key: Tab; label: string }[] = [
  { key: 'received', label: 'Received' }, { key: 'classified', label: 'Classified' }, { key: 'linked', label: 'Linked' }, { key: 'processed', label: 'Processed' },
  { key: 'rejected', label: 'Rejected' }, { key: 'duplicates', label: 'Possible duplicates' }, { key: 'all', label: 'All' },
]
const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'SAR', 'CNY']
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xlsx,.xls,.doc,.docx,.eml,.txt'

const kindName = (key: string) => DOCUMENT_KINDS.find((k) => k.key === key)?.name ?? key.replace(/_/g, ' ')
const fileSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fingerprint = (h: string) => (h.length > 20 ? `${h.slice(0, 12)}…${h.slice(-6)}` : h)
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const inTab = (d: DocumentRecord, tab: Tab) => (tab === 'all' ? true : tab === 'duplicates' ? d.duplicate_of !== null && d.duplicate_of !== undefined : d.status === tab)

// ---------------------------------------------------------------- suggestion from the file name
const NAME_HINTS: { word: string; re: RegExp; kind: string; note?: string }[] = [
  { word: 'credit note', re: /\bcredit note\b/, kind: 'credit_note' },
  { word: 'debit note', re: /\bdebit note\b/, kind: 'debit_note' },
  { word: 'purchase order', re: /\bpurchase order\b/, kind: 'purchase_order' },
  { word: 'po', re: /\bpo\b/, kind: 'purchase_order' },
  { word: 'quotation', re: /\bquot(e|ation)\b/, kind: 'quotation' },
  { word: 'card statement', re: /\bcard statement\b/, kind: 'card_statement' },
  { word: 'statement', re: /\bstatement\b/, kind: 'bank_statement', note: 'If it is a card statement, choose that instead.' },
  { word: 'policy', re: /\b(policy|insurance)\b/, kind: 'insurance_policy' },
  { word: 'contract', re: /\b(contract|agreement)\b/, kind: 'contract' },
  { word: 'ticket', re: /\b(ticket|boarding)\b/, kind: 'travel_ticket' },
  { word: 'receipt', re: /\breceipt\b/, kind: 'receipt' },
  { word: 'bill', re: /\bbill\b/, kind: 'bill' },
  { word: 'invoice', re: /\binvoice\b/, kind: 'bill', note: 'An invoice received from a supplier is a purchase bill. If your company issued it, choose Sales invoice.' },
]
/** Reads nothing but the file name. It is a suggestion for a person to accept or ignore. */
function suggestFromName(name: string): { kind: string; word: string; note?: string } | null {
  const plain = name.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const hit = NAME_HINTS.find((h) => h.re.test(plain))
  return hit ? { kind: hit.kind, word: hit.word, note: hit.note } : null
}

// ---------------------------------------------------------------- records a document can be linked to
interface RecordOption { id: ID; label: string; path: string; docType?: DocType }
type RecordType = 'bill' | 'sales_invoice' | 'claim' | 'purchase_doc' | 'register_item' | 'asset' | 'loan'
const RECORD_TYPES: { key: RecordType; label: string; entity: string; docTypes?: DocType[] }[] = [
  { key: 'bill', label: 'Purchase bill', entity: 'invoices', docTypes: ['purchase_bill', 'debit_note'] },
  { key: 'sales_invoice', label: 'Sales invoice', entity: 'invoices', docTypes: ['sales_invoice', 'credit_note'] },
  { key: 'claim', label: 'Expense claim', entity: 'expense_claims' },
  { key: 'purchase_doc', label: 'Purchasing document', entity: 'purchase_docs' },
  { key: 'register_item', label: 'Register item', entity: 'register_items' },
  { key: 'asset', label: 'Fixed asset', entity: 'fixed_assets' },
  { key: 'loan', label: 'Loan', entity: 'loans' },
]
const ENTITY_LABEL: Record<string, string> = { invoices: 'Invoice or bill', expense_claims: 'Expense claim', purchase_docs: 'Purchasing document', register_items: 'Register item', fixed_assets: 'Fixed asset', loans: 'Loan' }
const DOC_TYPE_LABEL: Record<DocType, string> = { sales_invoice: 'Sales invoice', purchase_bill: 'Purchase bill', credit_note: 'Credit note', debit_note: 'Debit note' }

async function loadEntity(api: NumeroApi, entity: string, companyId: ID, partyName: (id: ID | null | undefined) => string): Promise<RecordOption[]> {
  switch (entity) {
    case 'invoices': return (await api.listInvoices({ companyIds: [companyId] })).map((i) => ({ id: i.id, docType: i.doc_type, label: `${i.doc_no ?? 'Awaiting approval'} · ${DOC_TYPE_LABEL[i.doc_type]} · ${partyName(i.party_id)} · ${fmtDate(i.doc_date)}`, path: `${i.doc_type === 'sales_invoice' || i.doc_type === 'credit_note' ? '/invoices' : '/bills'}/${i.id}` }))
    case 'expense_claims': return (await api.listClaims({ companyIds: [companyId] })).map((c) => ({ id: c.id, label: `${c.claim_no} · ${c.title} · ${partyName(c.claimant_party_id)}`, path: `/expenses/claims/${c.id}` }))
    case 'purchase_docs': return (await api.listPurchaseDocs({ companyIds: [companyId] })).map((p) => ({ id: p.id, label: `${p.doc_no} · ${p.kind.replace(/_/g, ' ')}${p.title ? ' · ' + p.title : ''}${p.party_id ? ' · ' + partyName(p.party_id) : ''}`, path: `/purchasing/${p.id}` }))
    case 'register_items': return (await api.listRegisterItems({ companyIds: [companyId] })).map((r) => ({ id: r.id, label: `${r.ref_no} · ${r.title}`, path: `/registers/${r.id}` }))
    case 'fixed_assets': return (await api.listAssets([companyId])).map((a) => ({ id: a.id, label: `${a.asset_no} · ${a.name}`, path: `/assets/${a.id}` }))
    case 'loans': return (await api.listLoans([companyId])).map((l) => ({ id: l.id, label: `${l.loan_no} · ${l.name}`, path: `/treasury/loans/${l.id}` }))
    default: return []
  }
}

interface UploadRow { key: number; name: string; state: 'uploading' | 'stored' | 'duplicate' | 'refused'; id?: ID; message?: string }
let uploadKey = 0

export default function Inbox() {
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const { act, busy } = useAction()
  const t = today()
  // the database lets a person read every document with document.view, and otherwise the documents they uploaded
  const seesAll = can('document.view')
  const mayView = seesAll || can('document.upload')
  const choices = companies.filter((c) => c.status === 'active' && ids.includes(c.id))
  const baseOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency ?? 'INR'

  const [tab, setTab] = useState<Tab>('received')
  const [q, setQ] = useState('')
  const [companyId, setCompanyId] = useState<ID>(ids[0] ?? '')
  const [kind, setKind] = useState('')
  const [over, setOver] = useState(false)
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [selected, setSelected] = useState<ID | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const company = choices.some((c) => c.id === companyId) ? companyId : choices[0]?.id ?? ''
  const mayUpload = !!company && can('document.upload', company)

  const main = useAsync(async () => (mayView ? api.listDocuments({ companyIds: ids }) : []), [api, idsKey, mayView])
  const docs = useMemo(() => main.data ?? [], [main.data])
  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])
  const doc = selected ? byId.get(selected) ?? null : null

  const needle = q.trim().toLowerCase()
  const base = docs.filter((d) => !needle || [d.name, kindName(d.doc_kind), d.reference ?? '', d.notes ?? '', d.party_id ? partyName(d.party_id) : ''].some((s) => s.toLowerCase().includes(needle)))
  const shown = base.filter((d) => inTab(d, tab))

  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? [])
    if (!files.length || !mayUpload) return
    for (const f of files) {
      const key = ++uploadKey
      // a dropped file does not pass through the file chooser, so the list of accepted types is applied here
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
      if (!ACCEPT.split(',').includes(ext)) {
        setUploads((u) => [{ key, name: f.name, state: 'refused' as const, message: `Files of type “${ext}” are not accepted. Accepted: ${ACCEPT.replace(/,/g, ' ')}.` }, ...u].slice(0, 60))
        continue
      }
      setUploads((u) => [{ key, name: f.name, state: 'uploading' as const }, ...u].slice(0, 60))
      let refusal = 'The upload was refused.'
      const r = await act(async () => {
        try { return await api.uploadDocument(company, f, kind ? { doc_kind: kind } : {}) } catch (e) { refusal = e instanceof Error ? e.message : String(e); throw e }
      })
      const dup = r?.possible_duplicates[0]
      setUploads((u) => u.map((x) => (x.key !== key ? x : !r ? { ...x, state: 'refused', message: refusal }
        : dup ? { ...x, state: 'duplicate', id: r.id, message: `POSSIBLE DUPLICATE — kept, not discarded. The content is identical to “${dup.name}”, uploaded ${fmtDateTime(dup.uploaded_at)}.` }
        : { ...x, state: 'stored', id: r.id, message: kind ? `Stored and fingerprinted as ${kindName(kind).toLowerCase()}.` : 'Stored and fingerprinted. Waiting to be classified.' })))
    }
    if (input.current) input.current.value = ''
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files) }

  const columns: Column<DocumentRecord>[] = [
    {
      key: 'name', header: 'Name', sort: (d) => d.name.toLowerCase(), csv: (d) => d.name,
      render: (d) => (
        <div className="flex min-w-0 max-w-[320px] items-center gap-2">
          <FileText size={14} className="flex-none text-gold" />
          <div className="min-w-0">
            <div className="truncate text-ink" title={d.name}>{d.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              {ids.length > 1 && <span className="truncate">{companyName(d.company_id)}</span>}
              {d.duplicate_of && <span className="chip warn" title="The same file content exists in another document"><AlertTriangle size={10} /> possible duplicate</span>}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'kind', header: 'Kind', sort: (d) => kindName(d.doc_kind), csv: (d) => kindName(d.doc_kind), render: (d) => <span className={cx('text-[12.5px]', d.doc_kind === 'unclassified' ? 'text-warn' : 'text-ink2')}>{kindName(d.doc_kind)}</span> },
    { key: 'party', header: 'Party', sort: (d) => partyName(d.party_id).toLowerCase(), csv: (d) => (d.party_id ? partyName(d.party_id) : ''), render: (d) => <span className="text-ink2">{partyName(d.party_id)}</span> },
    { key: 'date', header: 'Document date', sort: (d) => d.doc_date ?? '', csv: (d) => d.doc_date ?? '', render: (d) => (d.doc_date ? <span className="num text-[12.5px]">{fmtDate(d.doc_date)}</span> : <span className="text-muted">—</span>) },
    { key: 'amount', header: 'Amount', align: 'right', sort: (d) => D(d.amount).toNumber(), csv: (d) => (d.amount != null ? `${D(d.amount).toFixed(2)} ${d.currency ?? baseOf(d.company_id)}` : ''), render: (d) => (d.amount != null ? <Money value={d.amount} currency={d.currency ?? baseOf(d.company_id)} /> : <span className="text-muted">—</span>) },
    { key: 'reference', header: 'Reference', sort: (d) => d.reference ?? '', csv: (d) => d.reference ?? '', render: (d) => (d.reference ? <span className="num text-[12.5px] text-ink2">{d.reference}</span> : <span className="text-muted">—</span>) },
    {
      key: 'expiry', header: 'Expiry', sort: (d) => d.expires_on ?? '9999', csv: (d) => d.expires_on ?? '',
      render: (d) => {
        if (!d.expires_on) return <span className="text-muted">—</span>
        const n = daysBetween(t, d.expires_on)
        return <div><span className="num text-[12.5px]">{fmtDate(d.expires_on)}</span>{d.status !== 'rejected' && n <= 30 && <div className={cx('text-[11.5px]', n < 0 ? 'text-neg' : 'text-warn')}>{n < 0 ? `expired ${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'expires today' : `${n} day${n === 1 ? '' : 's'} remain`}</div>}</div>
      },
    },
    { key: 'status', header: 'Status', sort: (d) => d.status, csv: (d) => d.status, render: (d) => <StatusChip status={d.status} /> },
    { key: 'uploaded', header: 'Uploaded', sort: (d) => d.uploaded_at, csv: (d) => d.uploaded_at, render: (d) => <span className="num text-[12.5px] text-ink2">{fmtDateTime(d.uploaded_at)}</span> },
  ]

  const emptyFor: Record<Tab, { title: string; body: string }> = {
    received: { title: 'Nothing is waiting to be classified', body: 'Documents uploaded without a kind wait here until a person classifies them. Upload files above to begin.' },
    classified: { title: 'No document is classified and unlinked', body: 'A document appears here once a person has said what it is, and until it is linked to a record.' },
    linked: { title: 'No document is linked to a record', body: 'Open a document and use “Link to a record” to attach it to a bill, claim, register item or other record.' },
    processed: { title: 'No document has been marked processed', body: 'Mark a document processed when nothing more needs to be done with it.' },
    rejected: { title: 'No document has been rejected', body: 'A rejected document is kept, with the note explaining why.' },
    duplicates: { title: 'No possible duplicate', body: 'When a file with identical content is uploaded twice to the same company, both copies are kept and the later one is listed here for a person to review.' },
    all: { title: 'The inbox is empty', body: 'Upload invoices, bills, receipts, statements, contracts and other financial documents above. Each file is stored in the private vault and fingerprinted.' },
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title="NUMERO INBOX"
        subtitle={<>The intake point for financial documents: upload, fingerprint, classify, link to a record. {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}.{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
      />

      <Note className="mb-4">Documents are stored and fingerprinted. Reading their contents automatically is not available yet; classification is done by a person.</Note>

      {!mayView && <Panel><Empty icon={<Lock size={20} />} title="You do not have access to the document vault" body="Viewing documents needs the permission “document.view”, and adding them needs “document.upload”, in at least one of the selected companies. Ask a Group Super Admin to grant it." /></Panel>}
      {mayView && !seesAll && <Note className="mb-4">Your role lets you add documents, not view the whole vault. You see the documents you uploaded yourself; others exist that you cannot see.</Note>}

      {mayView && (
        <>
          <Section title="Upload" className="mb-5">
            <Panel className="p-4" lit={false}>
              <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
                <Field label="Company">
                  <select className="field" value={company} onChange={(e) => setCompanyId(e.target.value)}>{choices.length === 0 && <option value="">No active company is selected</option>}{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
                </Field>
                <Field label="Kind (optional)" hint="Applied to every file in this upload. Leave empty to classify each one afterwards.">
                  <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Not yet classified</option>{DOCUMENT_KINDS.filter((k) => k.key !== 'unclassified').map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select>
                </Field>
              </div>
              <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => void upload(e.target.files)} />
              <div
                onDragOver={(e) => { e.preventDefault(); if (mayUpload) setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}
                className={cx('no-print grid place-items-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors', over ? 'border-gold bg-surface2' : 'border-line2 bg-surface', !mayUpload && 'opacity-60')}
                title={mayUpload ? undefined : company ? 'You are not authorised to upload documents for this company' : 'Choose a company first'}>
                <UploadCloud size={26} className="text-gold" />
                <div className="mt-2 text-[13.5px] text-ink">Drop files here, or choose them</div>
                <div className="mt-1 max-w-md text-[12px] text-muted">Several files can be uploaded at once. Each file may be up to 25 MB. Files are kept in the private vault of {company ? companyName(company) : 'the chosen company'}.</div>
                <button className="btn primary mt-3" disabled={!mayUpload || busy} title={mayUpload ? undefined : company ? 'You are not authorised to upload documents for this company' : 'Choose a company first'} onClick={() => input.current?.click()}>{busy ? <Spinner /> : <UploadCloud size={15} />} Choose files</button>
              </div>

              {uploads.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2"><div className="eyebrow">This upload</div><button className="btn sm ghost" disabled={uploads.some((u) => u.state === 'uploading')} onClick={() => setUploads([])}>Clear the list</button></div>
                  <div className="rounded-xl border border-line">
                    {uploads.map((u) => (
                      <div key={u.key} className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-0">
                        <span className={cx('mt-[2px] flex-none', u.state === 'stored' ? 'text-pos' : u.state === 'duplicate' ? 'text-warn' : u.state === 'refused' ? 'text-neg' : 'text-muted')}>
                          {u.state === 'uploading' ? <Spinner size={15} /> : u.state === 'stored' ? <CheckCircle2 size={15} /> : u.state === 'duplicate' ? <AlertTriangle size={15} /> : <XCircle size={15} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] text-ink">{u.name}</div>
                          <div className={cx('text-[11.5px]', u.state === 'duplicate' ? 'text-warn' : u.state === 'refused' ? 'text-neg' : 'text-muted')}>{u.state === 'uploading' ? 'Storing and fingerprinting…' : u.state === 'refused' ? `Not stored. ${u.message}` : u.message}</div>
                        </div>
                        {u.id && <button className="btn sm" onClick={() => setSelected(u.id ?? null)}>Open</button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </Section>

          <Tabs<Tab> tabs={TABS.map((x) => ({ ...x, count: base.filter((d) => inTab(d, x.key)).length }))} value={tab} onChange={setTab} />

          {main.error && <ErrorBox message={main.error} retry={main.reload} />}
          {!main.error && !main.data && <Panel><Loading rows={6} label="Loading documents" /></Panel>}
          {main.data && (
            <Panel lit={false}>
              <DataTable
                key={tab}
                columns={columns} rows={shown} rowKey={(d) => d.id} onRow={(d) => setSelected(d.id)} exportName={`inbox-${tab}`} initialSort={{ key: 'uploaded', dir: 'desc' }}
                toolbar={<div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm" style={{ width: 250, paddingLeft: 28 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, kind, party, reference" aria-label="Search documents" />
                </div>}
                empty={needle
                  ? { title: 'No document matches', body: 'No document in this list matches your search.', icon: <Search size={20} />, action: <button className="btn sm" onClick={() => setQ('')}>Clear the search</button> }
                  : { ...emptyFor[tab], icon: <InboxIcon size={20} /> }}
              />
            </Panel>
          )}
        </>
      )}

      <Drawer open={!!doc} onClose={() => setSelected(null)} width={640} title={doc?.name ?? 'Document'} subtitle={doc ? <>{kindName(doc.doc_kind)} · {companyName(doc.company_id)}</> : undefined}>
        {doc && <DocumentPanel key={doc.id} doc={doc} original={doc.duplicate_of ? byId.get(doc.duplicate_of) ?? null : null} onOpen={setSelected} onDone={() => setSelected(null)} />}
      </Drawer>
    </div>
  )
}

// ====================================================================== one document
interface ClassForm { doc_kind: string; party_id: string; doc_date: string; amount: string; currency: string; reference: string; expires_on: string; notes: string; confidentiality: Confidentiality }

function DocumentPanel({ doc, original, onOpen, onDone }: { doc: DocumentRecord; original: DocumentRecord | null; onOpen: (id: ID) => void; onDone: () => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const parties = useApp((s) => s.parties)
  const baseCurrency = useApp((s) => s.companies.find((c) => c.id === doc.company_id)?.base_currency ?? 'INR')
  const partyName = usePartyName()
  const { act, busy } = useAction()
  const mayEdit = can('document.upload', doc.company_id)
  const why = mayEdit ? undefined : 'You are not authorised to change documents of this company'

  const [form, setForm] = useState<ClassForm>({
    doc_kind: doc.doc_kind, party_id: doc.party_id ?? '', doc_date: doc.doc_date ?? '', amount: doc.amount != null ? String(doc.amount) : '', currency: doc.currency ?? baseCurrency,
    reference: doc.reference ?? '', expires_on: doc.expires_on ?? '', notes: doc.notes ?? '', confidentiality: doc.confidentiality,
  })
  const set = (p: Partial<ClassForm>) => setForm((f) => ({ ...f, ...p }))
  const [viewNote, setViewNote] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [recordType, setRecordType] = useState<'' | RecordType>('')
  const [recordId, setRecordId] = useState('')

  const links: DocumentLink[] = doc.links ?? []
  const linkKey = links.map((l) => l.entity + ':' + l.entity_id).sort().join('|')
  const chosen = RECORD_TYPES.find((r) => r.key === recordType)
  const pts = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === doc.company_id) || p.id === doc.party_id).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, doc.company_id, doc.party_id])
  const suggestion = useMemo(() => suggestFromName(doc.name), [doc.name])

  /** Names of the records this document is linked to. A list the viewer may not read is reported, not hidden. */
  const linked = useAsync(async () => {
    const out = new Map<string, { records: Map<ID, RecordOption>; error: string | null }>()
    for (const entity of new Set(links.map((l) => l.entity))) {
      try { out.set(entity, { records: new Map((await loadEntity(api, entity, doc.company_id, partyName)).map((r) => [r.id, r])), error: null }) }
      catch (e) { out.set(entity, { records: new Map(), error: e instanceof Error ? e.message : String(e) }) }
    }
    return out
  }, [api, doc.company_id, linkKey])

  const options = useAsync(async () => {
    if (!chosen) return [] as RecordOption[]
    const all = await loadEntity(api, chosen.entity, doc.company_id, partyName)
    return chosen.docTypes ? all.filter((r) => r.docType && chosen.docTypes!.includes(r.docType)) : all
  }, [api, doc.company_id, recordType])
  const already = new Set(links.filter((l) => l.entity === chosen?.entity).map((l) => l.entity_id))

  const view = async () => {
    setViewNote(null); setOpening(true)
    try {
      const url = await api.documentUrl(doc.id)
      if (url) window.open(url, '_blank', 'noopener')
      else setViewNote(mode === 'demo' ? 'Sample documents are descriptions only; no file is stored for them.' : 'The file could not be retrieved from the vault.')
    } catch (e) {
      setViewNote(e instanceof Error ? e.message : String(e))
    } finally { setOpening(false) }
  }
  const meta = (): DocumentMeta => ({
    doc_kind: form.doc_kind, party_id: form.party_id || null, doc_date: orNull(form.doc_date), amount: orNull(form.amount), currency: form.amount.trim() ? form.currency : orNull(doc.currency ?? ''),
    reference: orNull(form.reference), expires_on: orNull(form.expires_on), notes: orNull(form.notes), confidentiality: form.confidentiality,
  })
  const save = () => void act(() => api.classifyDocument(doc.id, meta()), 'Classification saved')
  const markProcessed = async () => { let ok = false; await act(async () => { await api.classifyDocument(doc.id, { status: 'processed' }); ok = true }, 'Marked processed'); if (ok) onDone() }
  const reject = async (reason: string) => {
    let ok = false
    await act(async () => { await api.classifyDocument(doc.id, { status: 'rejected', notes: `${doc.notes ? doc.notes + '\n' : ''}Rejected: ${reason}` }); ok = true }, 'Document rejected. It is kept in the vault.')
    if (ok) { setRejecting(false); onDone() }
  }
  const link = async () => {
    if (!chosen || !recordId) return
    let ok = false
    await act(async () => { await api.linkDocument(doc.id, chosen.entity, recordId); ok = true }, 'Linked to the record')
    if (ok) setRecordId('')
  }
  const unlink = (l: DocumentLink) => void act(() => api.linkDocument(doc.id, l.entity, l.entity_id, true), 'Link removed')

  const problem = form.doc_kind === 'unclassified' ? 'Choose what kind of document this is.' : form.amount !== '' && D(form.amount).lt(0) ? 'The amount cannot be negative.' : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={doc.status} />
        {doc.duplicate_of && <span className="chip warn"><AlertTriangle size={11} /> POSSIBLE DUPLICATE</span>}
        {doc.confidentiality !== 'internal' && <span className="chip gold">{doc.confidentiality.replace(/_/g, ' ')}</span>}
      </div>

      {doc.duplicate_of && (
        <Note kind="warn">
          <div className="font-medium text-ink">POSSIBLE DUPLICATE — kept, not discarded</div>
          <div className="mt-1">
            {original
              ? <>This file matches <button className="link" onClick={() => onOpen(original.id)}>{original.name}</button>, uploaded {fmtDateTime(original.uploaded_at)} ({kindName(original.doc_kind).toLowerCase()}, {original.status}).</>
              : <>This file matches a document recorded earlier that is not in the list available to you.</>}
          </div>
          <div className="mt-1">The file content is identical. Whether it is a true duplicate is for a person to decide.</div>
        </Note>
      )}

      <section>
        <div className="eyebrow mb-2">The file</div>
        <div className="grid gap-x-5 gap-y-3 rounded-xl border border-line bg-surface p-3.5 text-[12.5px] sm:grid-cols-2">
          <div><div className="label">Size</div><span className="num text-ink">{fileSize(doc.size_bytes)}</span></div>
          <div><div className="label">Type</div><span className="text-ink">{doc.mime ?? 'not recorded'}</span></div>
          <div><div className="label">Fingerprint (SHA-256)</div><span className="num text-ink" title={doc.sha256}>{fingerprint(doc.sha256)}</span></div>
          <div><div className="label">Uploaded</div><span className="num text-ink">{fmtDateTime(doc.uploaded_at)}</span></div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button className="btn" disabled={opening} onClick={() => void view()}>{opening ? <Spinner /> : <Eye size={15} />} View file</button>
          {viewNote && <span className="text-[12px] text-warn">{viewNote}</span>}
        </div>
      </section>

      <section>
        <div className="eyebrow mb-2">Classification — done by a person</div>
        {suggestion && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
            <span className="chip violet">SUGGESTION</span>
            <span className="min-w-0 flex-1 text-ink2">Suggestion from the file name: <span className="text-ink">{kindName(suggestion.kind)}</span>, because the name contains “{suggestion.word}”. The file itself was not read.{suggestion.note ? ' ' + suggestion.note : ''}</span>
            <button className="btn sm" disabled={!mayEdit || form.doc_kind === suggestion.kind} title={why ?? (form.doc_kind === suggestion.kind ? 'This kind is already chosen' : 'Fills the kind below. Nothing is saved until you save the classification.')} onClick={() => set({ doc_kind: suggestion.kind })}>Use suggestion</button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind"><select className="field" value={form.doc_kind} disabled={!mayEdit} onChange={(e) => set({ doc_kind: e.target.value })}>{DOCUMENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>
          <Field label="Party"><select className="field" value={form.party_id} disabled={!mayEdit} onChange={(e) => set({ party_id: e.target.value })}><option value="">None</option>{pts.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select></Field>
          <Field label="Document date"><input type="date" className="field" value={form.doc_date} disabled={!mayEdit} onChange={(e) => set({ doc_date: e.target.value })} /></Field>
          <Field label="Reference" hint="The number printed on the document"><input className="field" value={form.reference} disabled={!mayEdit} onChange={(e) => set({ reference: e.target.value })} /></Field>
          <Field label="Amount" hint="As printed on the document, entered by you"><input className="field num" inputMode="decimal" value={form.amount} disabled={!mayEdit} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="Currency"><select className="field" value={form.currency} disabled={!mayEdit} onChange={(e) => set({ currency: e.target.value })}>{[...new Set([form.currency, ...CURRENCIES])].filter(Boolean).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Expiry date" hint="A warning is raised in Forward as it approaches"><input type="date" className="field" value={form.expires_on} disabled={!mayEdit} onChange={(e) => set({ expires_on: e.target.value })} /></Field>
          <Field label="Confidentiality"><select className="field" value={form.confidentiality} disabled={!mayEdit} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={3} value={form.notes} disabled={!mayEdit} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn primary" disabled={busy || !mayEdit || !!problem} title={why ?? problem ?? undefined} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} Save classification</button>
          {problem && mayEdit && <span className="text-[12px] text-warn">{problem}</span>}
        </div>
      </section>

      <section>
        <div className="eyebrow mb-2">Linked records</div>
        <div className="rounded-xl border border-line">
          {links.length === 0 ? <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><Link2 size={14} /> This document is not linked to any record.</div> : links.map((l) => {
            const group = linked.data?.get(l.entity)
            const rec = group?.records.get(l.entity_id)
            return (
              <div key={l.entity + l.entity_id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-ink">{rec?.label ?? (linked.loading && !linked.data ? 'Loading…' : 'A record that is not in the list available to you')}</div>
                  <div className="text-[11.5px] text-muted">{ENTITY_LABEL[l.entity] ?? l.entity.replace(/_/g, ' ')} · linked {fmtDateTime(l.linked_at)}{group?.error ? ` · ${group.error}` : ''}</div>
                </div>
                {rec && <button className="btn sm icon ghost" onClick={() => nav(rec.path)} aria-label="Open the linked record"><ExternalLink size={13} /></button>}
                <button className="btn sm icon ghost" disabled={busy || !mayEdit} title={why ?? 'Remove this link. The document and the record are both kept.'} onClick={() => unlink(l)} aria-label="Remove the link"><Trash2 size={13} /></button>
              </div>
            )
          })}
        </div>

        <div className="mt-3 rounded-xl border border-line bg-surface p-3.5">
          <div className="mb-2 text-[12.5px] text-ink2">Link to a record</div>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <Field label="Type of record"><select className="field" value={recordType} disabled={!mayEdit} onChange={(e) => { setRecordType(e.target.value as '' | RecordType); setRecordId('') }}><option value="">Choose…</option>{RECORD_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
            <Field label="Record">
              <select className="field" value={recordId} disabled={!mayEdit || !chosen || options.loading || !!options.error} onChange={(e) => setRecordId(e.target.value)}>
                <option value="">{!chosen ? 'Choose the type first' : options.loading ? 'Loading…' : options.error ? 'Could not be loaded' : (options.data ?? []).length === 0 ? 'No record of this type in this company' : 'Choose…'}</option>
                {(options.data ?? []).map((r) => <option key={r.id} value={r.id} disabled={already.has(r.id)}>{r.label}{already.has(r.id) ? ' (already linked)' : ''}</option>)}
              </select>
            </Field>
            <button className="btn" disabled={busy || !mayEdit || !chosen || !recordId} title={why} onClick={() => void link()}>{busy ? <Spinner /> : <Link2 size={15} />} Link</button>
          </div>
          {options.error && <div className="mt-2 text-[12px] text-neg">{options.error}</div>}
          <div className="mt-2 text-[11.5px] text-muted">Only records of the same company are listed. Linking attaches the document as evidence; it changes nothing in the record or in the ledger.</div>
        </div>
      </section>

      <section className="no-print">
        <div className="eyebrow mb-2">Decision — made by a person</div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn good" disabled={busy || !mayEdit || doc.status === 'processed'} title={why ?? (doc.status === 'processed' ? 'This document is already marked processed' : 'Nothing more needs to be done with this document')} onClick={() => void markProcessed()}><BadgeCheck size={15} /> Mark processed</button>
          <button className="btn danger" disabled={busy || !mayEdit || doc.status === 'rejected'} title={why ?? (doc.status === 'rejected' ? 'This document is already rejected' : 'The document is kept, with your note')} onClick={() => setRejecting(true)}><XCircle size={15} /> Reject</button>
        </div>
        <div className="mt-2 text-[11.5px] text-muted">A rejected document is never deleted. It stays in the vault with the note explaining why it was rejected.</div>
      </section>

      <ReasonDialog open={rejecting} title="Reject the document" confirm="Reject" danger
        body={<>“{doc.name}” will be marked rejected. It is kept in the vault and can still be viewed.</>}
        onCancel={() => setRejecting(false)} onConfirm={(reason) => void reject(reason)} />
    </div>
  )
}
