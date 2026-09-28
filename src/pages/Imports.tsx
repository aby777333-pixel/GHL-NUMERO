import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { AlertTriangle, ArrowLeft, BadgeCheck, CheckCircle2, Download, ExternalLink, FileSpreadsheet, FileUp, Fingerprint, Scale, Trash2, Upload, XCircle } from 'lucide-react'
import type { Account, ID, Journal, Member } from '@/engine/types'
import type { ImportBatch, ImportInput, ImportKind, ImportRow, LegacyBalance } from '@/engine/p3Types'
import { parallelRun, type ParallelRow } from '@/engine/analysis'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv, ledgerLink, parseCsv } from '@/lib/data'
import { D, ZERO } from '@/lib/money'
import { addDays, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { useAccountName, useCompanyName } from '@/ui/ops'
import { DemoTag, Fact, foot, History, NoAccess, Tile, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'

// =====================================================================
// Imports and the parallel run (spec 635, 1370).
// A file is previewed, checked and staged before anything of it can enter
// the books. Committing journals or opening balances creates DRAFT entries
// that are approved like any other entry; the import itself posts nothing.
// The trial balance of an earlier system is kept BESIDE the books, to be
// compared with them. Comparing two sets of books changes neither.
// =====================================================================

type TabKey = 'imports' | 'parallel'
const TABS: { key: TabKey; label: string }[] = [{ key: 'imports', label: 'Imports' }, { key: 'parallel', label: 'Parallel run' }]

const KINDS: { key: ImportKind; label: string; short: string; about: string }[] = [
  { key: 'journals', label: 'Journal entries', short: 'journals', about: 'Vouchers with their lines. Each voucher reference becomes one draft entry.' },
  { key: 'opening_balances', label: 'Opening balances', short: 'opening balances', about: 'The balances a company starts with. The whole file becomes one draft opening entry.' },
  { key: 'legacy_trial_balance', label: 'Trial balance of the earlier system', short: 'trial balance of the earlier system', about: 'Kept beside the books for the parallel run. It creates no entry.' },
]
const kindLabel = (k: ImportKind) => KINDS.find((x) => x.key === k)?.label ?? k
const MAX_ROWS = 5000
const MAX_BYTES = 8 * 1024 * 1024

type FieldKey = 'date' | 'ref' | 'account' | 'name' | 'debit' | 'credit' | 'narration'
const FIELDS: { key: FieldKey; label: string; hint: string; journalsOnly?: boolean; required: 'always' | 'journals' | 'never' }[] = [
  { key: 'date', label: 'Date', hint: 'The date of the voucher', journalsOnly: true, required: 'journals' },
  { key: 'ref', label: 'Reference', hint: 'The voucher number. Lines with the same reference form one entry.', journalsOnly: true, required: 'journals' },
  { key: 'account', label: 'Account (code)', hint: 'The code of the ledger', required: 'always' },
  { key: 'name', label: 'Account name', hint: 'Optional. Kept for reading; the code decides the ledger.', required: 'never' },
  { key: 'debit', label: 'Debit', hint: 'The debit amount', required: 'always' },
  { key: 'credit', label: 'Credit', hint: 'The credit amount', required: 'always' },
  { key: 'narration', label: 'Narration', hint: 'Optional', required: 'never' },
]
type Cols = Record<FieldKey, string>
const NO_COLS: Cols = { date: '', ref: '', account: '', name: '', debit: '', credit: '', narration: '' }

type DateFormat = 'iso' | 'dmy' | 'mdy'
const DATE_FORMATS: { key: DateFormat; label: string }[] = [
  { key: 'iso', label: 'Year first — 2026-03-31' },
  { key: 'dmy', label: 'Day first — 31/03/2026' },
  { key: 'mdy', label: 'Month first — 03/31/2026' },
]

const two = (s: string) => s.padStart(2, '0')
/** A date as the engine reads it (YYYY-MM-DD). What cannot be turned is passed on as written, so that the check names it. */
function toIso(v: string, f: DateFormat): string {
  const t = v.trim()
  if (f === 'iso' || !t) return t
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (!m) return t
  return f === 'dmy' ? `${m[3]}-${two(m[2])}-${two(m[1])}` : `${m[3]}-${two(m[1])}-${two(m[2])}`
}
/** Thousands separators are removed; nothing else is changed. */
const amountAsRead = (v: string) => v.replace(/,/g, '').trim()

function guessColumns(header: string[]): Cols {
  const used = new Set<number>()
  const find = (re: RegExp) => {
    const i = header.findIndex((h, k) => !used.has(k) && re.test(h.trim()))
    if (i >= 0) used.add(i)
    return i >= 0 ? String(i) : ''
  }
  // the order matters: "voucher date" is a date, "account name" is a name
  const date = find(/date|^dt$/i)
  const name = find(/name|particulars/i)
  const account = find(/account|ledger|code|^gl/i)
  const ref = find(/ref|voucher|vch|doc|entry/i)
  const debit = find(/debit|^dr\b/i)
  const credit = find(/credit|^cr\b/i)
  const narration = find(/narration|description|remark|memo|detail|note/i)
  return { date, ref, account, name, debit, credit, narration }
}
function guessDateFormat(values: string[]): { format: DateFormat; sure: boolean } {
  const some = values.map((v) => v.trim()).filter(Boolean).slice(0, 200)
  if (!some.length || some.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return { format: 'iso', sure: true }
  const parts = some.map((v) => v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)).filter((m): m is RegExpMatchArray => !!m)
  if (parts.some((m) => Number(m[1]) > 12)) return { format: 'dmy', sure: true }
  if (parts.some((m) => Number(m[2]) > 12)) return { format: 'mdy', sure: true }
  return { format: 'dmy', sure: false }
}

const readBytes = (f: File) => new Promise<ArrayBuffer>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result as ArrayBuffer)
  r.onerror = () => reject(r.error ?? new Error('The file could not be read.'))
  r.readAsArrayBuffer(f)
})
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
const shortPrint = (s: string) => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s)

/** A file of the expected shape, written with ledgers of the company where it has them. */
function downloadSample(kind: ImportKind, chart: Account[]) {
  const post = chart.filter((a) => !a.is_group && a.is_active)
  const pick = (f: (a: Account) => boolean, code: string, name: string) => { const a = post.find(f); return { code: a?.code ?? code, name: a?.name ?? name } }
  const bank = pick((a) => a.subtype === 'bank' || a.subtype === 'cash', '1110', 'Bank account')
  const expense = pick((a) => a.type === 'expense', '6100', 'Office expenses')
  const income = pick((a) => a.type === 'income', '4100', 'Sales')
  const equity = pick((a) => a.type === 'equity', '3100', 'Capital')
  const liability = pick((a) => a.type === 'liability', '2100', 'Trade payables')
  if (kind === 'journals') {
    const d1 = addDays(today(), -10), d2 = addDays(today(), -9)
    downloadCsv('sample-journals', ['date', 'reference', 'account', 'account name', 'debit', 'credit', 'narration'], [
      [d1, 'JV-001', expense.code, expense.name, '1850.00', '', 'Courier charges'],
      [d1, 'JV-001', bank.code, bank.name, '', '1850.00', 'Courier charges'],
      [d2, 'JV-002', bank.code, bank.name, '12000.00', '', 'Cash sale'],
      [d2, 'JV-002', income.code, income.name, '', '12000.00', 'Cash sale'],
    ])
  } else {
    downloadCsv(kind === 'opening_balances' ? 'sample-opening-balances' : 'sample-trial-balance-of-the-earlier-system', ['account', 'account name', 'debit', 'credit'], [
      [bank.code, bank.name, '180000.00', ''],
      [liability.code, liability.name, '', '60000.00'],
      [equity.code, equity.name, '', '120000.00'],
    ])
  }
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const count = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function DrCr({ value, currency, className }: { value: Decimal; currency: string; className?: string }) {
  if (value.isZero()) return <span className="num text-muted">—</span>
  return <span className={cx('whitespace-nowrap', className)}><Money value={value.abs()} currency={currency} /> <span className="text-[10.5px] text-muted">{value.gt(0) ? 'Dr' : 'Cr'}</span></span>
}

function useNames() {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  // names are a convenience; the screen must work for people who cannot list the team
  const members = useAsync(() => api.listMembers().catch(() => [] as Member[]), [api])
  const byId = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m.full_name])), [members.data])
  return (id: ID | null | undefined) => (!id ? 'System' : session && id === session.user.id ? `${session.user.name} (you)` : byId.get(id) ?? 'Name not available to you')
}

export default function Imports() {
  useApp((s) => s.session)
  const { id } = useParams<{ id: string }>()
  const companies = useApp((s) => s.companies)
  const scope = useScopeIds()
  const ids = scope.filter((c) => can('import.manage', c))
  if (id) {
    // a batch opened by its address may belong to a company outside the current selection
    if (!companies.some((c) => can('import.manage', c.id))) return <NoAccess eyebrow="Platform · Imports" title="Imports" perm="import.manage" back="/imports" />
    return <BatchView key={id} id={id} />
  }
  if (!ids.length) return <NoAccess eyebrow="Platform · Imports" title="Imports and the parallel run" perm="import.manage" />
  return <ImportsView ids={ids} />
}

// ====================================================================== list and tabs
function ImportsView({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const companyCode = useCompanyCode()
  const companyName = useCompanyName()
  const who = useNames()
  const idsKey = ids.join(',')
  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'imports'
  const [bringing, setBringing] = useState(false)
  const [status, setStatus] = useState<'' | 'staged' | 'failed' | 'committed' | 'discarded'>('')

  const main = useAsync(() => api.listImports(ids), [api, idsKey])
  const batches = useMemo(() => main.data ?? [], [main.data])
  const staged = batches.filter((b) => b.status === 'staged' && b.ok)
  const failed = batches.filter((b) => b.status === 'staged' && !b.ok)
  const committed = batches.filter((b) => b.status === 'committed')
  const discarded = batches.filter((b) => b.status === 'discarded')
  const shown = status === 'staged' ? staged : status === 'failed' ? failed : status === 'committed' ? committed : status === 'discarded' ? discarded : batches

  const failing = (b: ImportBatch) => ([['validation', 'rows'], ['duplicates', 'duplicates'], ['balance', 'balance'], ['mapping', 'mapping']] as const)
    .filter(([k]) => b.checks?.[k] && !b.checks[k].passed).map(([, label]) => label)

  const columns: Column<ImportBatch>[] = [
    {
      key: 'file', header: 'File', sort: (b) => b.file_name.toLowerCase(), csv: (b) => b.file_name,
      render: (b) => <div className="min-w-0"><div className="truncate text-ink" title={b.file_name}>{b.file_name}</div><div className="num text-[11px] text-muted" title={`Fingerprint (SHA-256): ${b.sha256}`}>{shortPrint(b.sha256)}</div></div>,
    },
    { key: 'kind', header: 'What it holds', sort: (b) => b.kind, csv: (b) => kindLabel(b.kind), render: (b) => <div><span className="text-[12.5px] text-ink2">{kindLabel(b.kind)}</span>{b.period_end && <div className="text-[11px] text-muted">as at <span className="num">{fmtDate(b.period_end)}</span></div>}</div> },
    { key: 'company', header: 'Company', width: 100, sort: (b) => companyName(b.company_id), csv: (b) => companyName(b.company_id), render: (b) => <span className="text-ink2" title={companyName(b.company_id)}>{companyCode(b.company_id)}</span> },
    { key: 'rows', header: 'Rows', align: 'right', width: 80, sort: (b) => b.row_count, csv: (b) => b.row_count, render: (b) => <span className="num">{b.row_count.toLocaleString()}</span> },
    {
      key: 'checks', header: 'Checks', sort: (b) => Number(b.ok), csv: (b) => (b.ok ? 'passed' : `did not pass: ${failing(b).join(', ')}`),
      render: (b) => (b.ok
        ? <span className="chip pos"><CheckCircle2 size={11} /> passed</span>
        : <div><span className="chip neg"><XCircle size={11} /> did not pass</span><div className="mt-0.5 text-[11px] text-muted">{failing(b).join(', ') || 'see the batch'}</div></div>),
    },
    { key: 'status', header: 'Status', width: 120, sort: (b) => b.status, csv: (b) => b.status, render: (b) => <StatusChip status={b.status} /> },
    {
      key: 'who', header: 'Brought in by', sort: (b) => b.created_at, csv: (b) => `${who(b.created_by)} on ${b.created_at}`,
      render: (b) => <div><div className="text-ink2">{who(b.created_by)}</div><div className="num text-[11.5px] text-muted">{fmtDateTime(b.created_at)}</div></div>,
    },
    { key: 'committed', header: 'Committed', sort: (b) => b.committed_at ?? '', csv: (b) => b.committed_at ?? '', render: (b) => (b.committed_at ? <span className="num text-[12.5px] text-ink2">{fmtDateTime(b.committed_at)}</span> : <span className="text-muted">—</span>) },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Platform · Imports"
        title="Imports and the parallel run"
        subtitle={<>Bring in the entries and balances of an earlier system, and compare its books with NUMERO's while both are kept. A file is checked before anything of it can enter the books. {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}.<DemoTag className="ml-2" /></>}
        actions={<button className="btn primary" onClick={() => setBringing(true)}><FileUp size={15} /> Bring in a file</button>}
      />

      <Tabs<TabKey> tabs={TABS.map((t) => (t.key === 'imports' ? { ...t, count: main.data ? batches.length : undefined } : t))} value={tab}
        onChange={(k) => setSp(k === 'imports' ? {} : { tab: k }, { replace: true })} />

      {tab === 'imports' && (
        <>
          {main.error && <ErrorBox message={main.error} retry={main.reload} />}
          {!main.error && !main.data && <Panel><Loading rows={6} label="Loading the imports" /></Panel>}
          {main.data && (
            <>
              <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Passed, waiting to be committed" tone={staged.length ? 'text-gold' : 'text-muted'} onClick={() => setStatus(status === 'staged' ? '' : 'staged')}
                  sub="Staged files that passed every check. Nothing of them is in the books yet."><span className="num">{staged.length}</span></Tile>
                <Tile label="Did not pass their checks" tone={failed.length ? 'text-warn' : 'text-muted'} onClick={() => setStatus(status === 'failed' ? '' : 'failed')}
                  sub="Nothing of these has entered the books. Correct the file and bring it in again."><span className="num">{failed.length}</span></Tile>
                <Tile label="Committed" tone={committed.length ? 'text-pos' : 'text-muted'} onClick={() => setStatus(status === 'committed' ? '' : 'committed')}
                  sub="Entered as drafts for approval, or kept beside the books for comparison."><span className="num">{committed.length}</span></Tile>
                <Tile label="Discarded" tone="text-muted" onClick={() => setStatus(status === 'discarded' ? '' : 'discarded')}
                  sub="Set aside by a person, with the reason recorded."><span className="num">{discarded.length}</span></Tile>
              </div>

              <Panel lit={false}>
                <DataTable key={status} columns={columns} rows={shown} rowKey={(b) => b.id} onRow={(b) => nav('/imports/' + b.id)} exportName="imports"
                  toolbar={status ? <span className="flex flex-wrap items-center gap-2"><button className="chip gold" onClick={() => setStatus('')} title="Clear this filter">{status === 'failed' ? 'did not pass' : status === 'staged' ? 'passed, waiting' : status} ×</button>{batches.length >= 200 && <span className="text-[12px] text-muted">Only the latest 200 files are read.</span>}</span> : <span className="text-[12px] text-muted">Open a file to see its four checks and every row.{batches.length >= 200 ? ' Only the latest 200 files are listed.' : ''}</span>}
                  empty={batches.length === 0
                    ? { title: 'No file has been brought in', body: 'Bring in journal entries, opening balances, or the trial balance of the earlier system. The file is checked first; nothing enters the books until a person commits it, and then only as drafts for approval.', icon: <FileSpreadsheet size={20} />, action: <button className="btn sm" onClick={() => setBringing(true)}><FileUp size={13} /> Bring in a file</button> }
                    : { title: 'Nothing in this list', body: 'No file has this status in the selected companies.', icon: <FileSpreadsheet size={20} /> }} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">The fingerprint is the SHA-256 of the content of the file. A file whose fingerprint has already been committed for the same company is refused, whatever its name.</div>
            </>
          )}
        </>
      )}

      {tab === 'parallel' && <Parallel ids={ids} batches={batches} />}

      <BringIn open={bringing} ids={ids} batches={batches} onClose={() => setBringing(false)} onStaged={(id) => nav('/imports/' + id)} />
    </div>
  )
}

// ====================================================================== bring in a file
interface Loaded { name: string; size: number; sha256: string; cells: string[][] }
interface ReadRow extends ImportRow { n: number; target: Account | null }

function BringIn({ open, ids, batches, onClose, onStaged }: { open: boolean; ids: ID[]; batches: ImportBatch[]; onClose: () => void; onStaged: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useCompanyChoices(ids)
  const { act, busy } = useAction()
  const input = useRef<HTMLInputElement>(null)

  const [company, setCompany] = useState<ID>(ids[0] ?? '')
  const [kind, setKind] = useState<ImportKind>('journals')
  const [periodEnd, setPeriodEnd] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<Loaded | null>(null)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [cols, setCols] = useState<Cols>(NO_COLS)
  const [dateFormat, setDateFormat] = useState<DateFormat>('iso')
  const [dateSure, setDateSure] = useState(true)
  const [codeMap, setCodeMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setCompany((c) => (ids.includes(c) ? c : ids[0] ?? ''))
    setKind('journals'); setPeriodEnd(''); setNote(''); setFile(null); setFileError(null); setHasHeader(true); setCols(NO_COLS); setDateFormat('iso'); setDateSure(true); setCodeMap({})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const journals = kind === 'journals'
  const currency = companies.find((c) => c.id === company)?.base_currency ?? 'INR'
  const chart = useMemo(() => accounts.filter((a) => a.company_id === company), [accounts, company])
  const byCode = useMemo(() => new Map(chart.map((a) => [a.code, a])), [chart])
  const targets = useMemo(() => chart.filter((a) => (kind === 'legacy_trial_balance' ? true : !a.is_group && a.is_active)).sort((a, b) => a.code.localeCompare(b.code)), [chart, kind])

  const width = file ? Math.max(0, ...file.cells.map((r) => r.length)) : 0
  const header = useMemo(() => (file ? Array.from({ length: width }, (_, i) => (hasHeader ? (file.cells[0]?.[i] ?? '').trim() || `Column ${i + 1}` : `Column ${i + 1}`)) : []), [file, hasHeader, width])
  const body = useMemo(() => (file ? (hasHeader ? file.cells.slice(1) : file.cells) : []), [file, hasHeader])

  const choose = async (f: File | undefined) => {
    if (!f) return
    setFileError(null); setFile(null)
    if (f.size > MAX_BYTES) { setFileError(`This file is ${(f.size / 1048576).toFixed(1)} MB. A file of at most ${MAX_ROWS.toLocaleString()} rows is far smaller; bring a large file in parts.`); return }
    if (!window.crypto?.subtle) { setFileError('This browser cannot work out the fingerprint of the file here. Open NUMERO over a secure connection (https).'); return }
    setReading(true)
    try {
      const bytes = await readBytes(f)
      const sha256 = hex(await window.crypto.subtle.digest('SHA-256', bytes))
      const cells = parseCsv(new TextDecoder('utf-8').decode(bytes))
      if (!cells.length) { setFileError('The file holds no rows.'); return }
      const head = cells[0].map((h) => h.trim())
      const guessed = guessColumns(head)
      const looksLikeHeader = Object.values(guessed).some((v) => v !== '')
      setFile({ name: f.name, size: f.size, sha256, cells })
      setHasHeader(looksLikeHeader)
      setCols(looksLikeHeader ? guessed : NO_COLS)
      setCodeMap({})
      if (guessed.date !== '') {
        const g = guessDateFormat(cells.slice(1).map((r) => r[Number(guessed.date)] ?? ''))
        setDateFormat(g.format); setDateSure(g.sure)
      } else { setDateFormat('iso'); setDateSure(true) }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
      if (input.current) input.current.value = ''
    }
  }

  const setCol = (k: FieldKey, v: string) => {
    setCols((c) => ({ ...c, [k]: v }))
    if (k === 'date' && v !== '') { const g = guessDateFormat(body.map((r) => r[Number(v)] ?? '')); setDateFormat(g.format); setDateSure(g.sure) }
  }

  const cell = (r: string[], k: FieldKey) => (cols[k] === '' ? '' : (r[Number(cols[k])] ?? '').trim())
  const resolve = (code: string): Account | null => byCode.get((codeMap[code] ?? '').trim() || code) ?? null
  const usable = (a: Account | null) => !!a && (kind === 'legacy_trial_balance' || (!a.is_group && a.is_active))

  const rows: ReadRow[] = useMemo(() => body.map((r, i) => {
    const account = cell(r, 'account')
    const row: ReadRow = { n: i + 1, account, target: account ? resolve(account) : null }
    if (journals) { row.date = toIso(cell(r, 'date'), dateFormat) || undefined; row.ref = cell(r, 'ref') || undefined }
    row.name = cell(r, 'name') || undefined
    row.debit = amountAsRead(cell(r, 'debit')) || undefined
    row.credit = amountAsRead(cell(r, 'credit')) || undefined
    row.narration = cell(r, 'narration') || undefined
    return row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [body, cols, dateFormat, journals, codeMap, byCode])

  const codes = useMemo(() => [...new Set(rows.map((r) => r.account).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [rows])
  // codes the chart of the company cannot take as they stand
  const toMap = codes.filter((c) => !usable(byCode.get(c) ?? null))
  const unmapped = toMap.filter((c) => !usable(resolve(c)))
  const totalDebit = rows.reduce((s, r) => s.plus(D(r.debit)), ZERO)
  const totalCredit = rows.reduce((s, r) => s.plus(D(r.credit)), ZERO)
  const already = file ? batches.find((b) => b.company_id === company && b.sha256 === file.sha256 && b.status !== 'discarded') : undefined

  const needed = FIELDS.filter((f) => f.required === 'always' || (f.required === 'journals' && journals))
  const chosen = FIELDS.filter((f) => (journals || !f.journalsOnly) && cols[f.key] !== '')
  const twice = chosen.filter((f) => chosen.some((g) => g.key !== f.key && cols[g.key] === cols[f.key]))
  const problems: string[] = []
  if (!company) problems.push('Choose the company.')
  if (!journals && !periodEnd) problems.push('State the date of the balances.')
  if (!journals && periodEnd > today()) problems.push('The date of the balances is in the future.')
  if (!file) problems.push('Choose the file.')
  if (file && !body.length) problems.push('The file has a heading but no rows.')
  if (body.length > MAX_ROWS) problems.push(`The file has ${body.length.toLocaleString()} rows. A file of more than ${MAX_ROWS.toLocaleString()} rows is imported in parts.`)
  if (file) for (const f of needed) if (cols[f.key] === '') problems.push(`Say which column holds: ${f.label.toLowerCase()}.`)
  if (twice.length) problems.push(`One column is chosen for more than one thing: ${twice.map((f) => f.label.toLowerCase()).join(', ')}.`)

  const stage = async () => {
    if (!file || problems.length) return
    const mapping = Object.fromEntries(Object.entries(codeMap).filter(([k, v]) => v && codes.includes(k)))
    const payload: ImportInput = {
      company_id: company, kind, file_name: file.name, sha256: file.sha256,
      rows: rows.map(({ n: _n, target: _t, ...r }) => r),
      ...(journals ? {} : { period_end: periodEnd }), ...(Object.keys(mapping).length ? { mapping } : {}), ...(note.trim() ? { note: note.trim() } : {}),
    }
    const id = await act(() => api.stageImport(payload), 'File staged and checked. Nothing of it has entered the books.')
    if (id) { onClose(); onStaged(id) }
  }

  const preview: Column<ReadRow>[] = [
    { key: 'n', header: 'Row', width: 56, align: 'right', render: (r) => <span className="num text-muted">{r.n}</span> },
    ...(journals ? [
      { key: 'date', header: 'Date', render: (r: ReadRow) => (r.date ? <span className={cx('num text-[12.5px]', !/^\d{4}-\d{2}-\d{2}$/.test(r.date) && 'text-warn')}>{r.date}</span> : <span className="text-warn">missing</span>) },
      { key: 'ref', header: 'Reference', render: (r: ReadRow) => (r.ref ? <span className="num text-[12.5px] text-gold">{r.ref}</span> : <span className="text-warn">missing</span>) },
    ] : []),
    {
      key: 'account', header: 'Account',
      render: (r) => (!r.account ? <span className="text-warn">missing</span> : (
        <div className="min-w-0"><span className="num text-[12.5px]">{r.account}</span>{r.name && <span className="text-ink2"> · {r.name}</span>}
          <div className={cx('truncate text-[11px]', usable(r.target) ? 'text-muted' : 'text-warn')}>{usable(r.target) ? `→ ${r.target!.code} · ${r.target!.name}` : r.target ? `→ ${r.target.code} cannot receive entries` : 'not in the chart, not mapped'}</div>
        </div>
      )),
    },
    { key: 'debit', header: 'Debit', align: 'right', render: (r) => (r.debit ? <span className="num">{String(r.debit)}</span> : '') },
    { key: 'credit', header: 'Credit', align: 'right', render: (r) => (r.credit ? <span className="num">{String(r.credit)}</span> : '') },
    { key: 'narration', header: 'Narration', render: (r) => <span className="text-[12.5px] text-ink2">{r.narration ?? ''}</span> },
  ]

  return (
    <Drawer open={open} onClose={onClose} width={920} title="Bring in a file"
      subtitle="The file is read in this browser, checked, and staged. Nothing enters the books by staging."
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || reading || problems.length > 0} onClick={() => void stage()}>{busy ? <Spinner /> : <Upload size={15} />} Stage and check</button>
      </>}>
      <div className="space-y-6">
        <div>
          <div className="eyebrow mb-2.5">1 · What the file holds</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company">
              <select className="field" value={company} onChange={(e) => { setCompany(e.target.value); setCodeMap({}) }}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="What is brought in" hint={KINDS.find((k) => k.key === kind)?.about}>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </Field>
            {!journals && <Field label="Date of the balances" hint="The day at the end of which the balances stood"><input type="date" className="field" value={periodEnd} max={today()} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>}
            <Field label="Note" hint="Optional. Where the file came from." className={journals ? 'sm:col-span-2' : undefined}><input className="field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span>See the expected shape:</span>
            {KINDS.map((k) => <button key={k.key} className="btn sm ghost" onClick={() => downloadSample(k.key, chart)}><Download size={13} /> Sample — {k.short}</button>)}
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2.5">2 · The file</div>
          <input ref={input} type="file" hidden accept=".csv,text/csv,.txt" onChange={(e) => void choose(e.target.files?.[0])} />
          <Panel className="flex flex-wrap items-center gap-3 p-3.5" lit={false}>
            <button className="btn" disabled={reading} onClick={() => input.current?.click()}>{reading ? <Spinner /> : <FileSpreadsheet size={15} />} {file ? 'Choose another file' : 'Choose a CSV file'}</button>
            {file ? (
              <div className="min-w-0 flex-1 text-[12.5px]">
                <div className="truncate text-ink">{file.name} <span className="text-muted">· {Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB · {plural(body.length, 'row', 'rows')} · {width} columns</span></div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><Fingerprint size={12} className="flex-none text-gold" /><span className="num break-all">{file.sha256}</span></div>
              </div>
            ) : <span className="text-[12.5px] text-muted">Comma-separated values, one row per line, at most {MAX_ROWS.toLocaleString()} rows.</span>}
          </Panel>
          {fileError && <Note kind="warn" className="mt-3">{fileError}</Note>}
          {file && <div className="mt-1.5 text-[11.5px] text-muted">The fingerprint is the SHA-256 of the content of the file, worked out in this browser. NUMERO uses it to refuse the same file twice.</div>}
          {already && <Note kind="warn" className="mt-3">A file with this fingerprint was brought in for this company on {fmtDateTime(already.created_at)} ({already.file_name}, {already.status}). {already.status === 'committed' ? 'Because it has been committed, this file will not pass its duplicate check.' : 'It is staged and has not been committed.'}</Note>}
        </div>

        {file && (
          <div>
            <div className="eyebrow mb-2.5">3 · Which column holds what</div>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink2">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> The first row of the file is a heading, not an entry
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.filter((f) => journals || !f.journalsOnly).map((f) => (
                <Field key={f.key} label={f.label + (f.required === 'always' || (f.required === 'journals' && journals) ? ' *' : '')} hint={f.hint}>
                  <select className="field" value={cols[f.key]} onChange={(e) => setCol(f.key, e.target.value)}>
                    <option value="">{f.required === 'never' ? 'Not in the file' : 'Choose the column…'}</option>
                    {header.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
                  </select>
                </Field>
              ))}
              {journals && cols.date !== '' && (
                <Field label="How dates are written" hint={dateSure ? 'Read from the dates in the file' : 'Days and months cannot be told apart in this file. Day first is assumed; change it if the file writes the month first.'}>
                  <select className="field" value={dateFormat} onChange={(e) => { setDateFormat(e.target.value as DateFormat); setDateSure(true) }}>
                    {DATE_FORMATS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-2 text-[11.5px] text-muted">Columns were chosen from the headings where they could be recognised. Thousands separators in amounts are removed; nothing else in the file is changed.</div>
          </div>
        )}

        {file && cols.account !== '' && toMap.length > 0 && (
          <div>
            <div className="eyebrow mb-2.5">4 · Account codes that are not in the chart of the company</div>
            <Note className="mb-3" kind={kind === 'legacy_trial_balance' ? 'info' : 'warn'}>
              {kind === 'legacy_trial_balance'
                ? <>{plural(toMap.length, 'code of the earlier system is', 'codes of the earlier system are')} not in the chart of this company. Map each to the ledger it corresponds to. A code left unmapped is still kept, and is shown as “not mapped” in the parallel run.</>
                : <>{plural(toMap.length, 'code in the file cannot', 'codes in the file cannot')} receive entries as {toMap.length === 1 ? 'it stands' : 'they stand'}: not in the chart, a group ledger, or inactive. Map each to a ledger of NUMERO. With any left unmapped the file is staged but does not pass its mapping check, and cannot be committed.</>}
            </Note>
            <div className="max-h-[300px] overflow-auto rounded-xl border border-line">
              <table className="table dense">
                <thead><tr><th style={{ width: 160 }}>Code in the file</th><th>Name in the file</th><th style={{ width: 90, textAlign: 'right' }}>Rows</th><th style={{ width: 320 }}>Ledger in NUMERO</th></tr></thead>
                <tbody>
                  {toMap.map((c) => {
                    const own = byCode.get(c)
                    return (
                      <tr key={c}>
                        <td><span className="num">{c}</span>{own && <div className="text-[11px] text-warn">{own.is_group ? 'a group ledger' : 'inactive'}</div>}</td>
                        <td className="text-ink2">{rows.find((r) => r.account === c && r.name)?.name ?? '—'}</td>
                        <td className="r"><span className="num">{rows.filter((r) => r.account === c).length}</span></td>
                        <td>
                          <select className="field sm" value={codeMap[c] ?? ''} onChange={(e) => setCodeMap((m) => ({ ...m, [c]: e.target.value }))} aria-label={`Ledger in NUMERO for code ${c}`}>
                            <option value="">Not mapped</option>
                            {targets.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 text-[11.5px] text-muted">{unmapped.length === 0 ? 'Every code is mapped.' : `${plural(unmapped.length, 'code is', 'codes are')} still not mapped.`} The mapping is kept with the batch.</div>
          </div>
        )}

        {file && body.length > 0 && cols.account !== '' && (
          <div>
            <div className="eyebrow mb-2.5">{toMap.length > 0 ? '5' : '4'} · The rows as they will be read</div>
            <Panel lit={false}>
              <DataTable columns={preview} rows={rows} rowKey={(r) => String(r.n)} pageSize={8}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={journals ? 4 : 2}>As read · {plural(rows.length, 'row', 'rows')}</td>
                  <td className={cx(foot, 'r')}><Money value={totalDebit} currency={currency} /></td>
                  <td className={cx(foot, 'r')}><Money value={totalCredit} currency={currency} /></td>
                  <td className={cx(foot, 'text-[11.5px]', totalDebit.eq(totalCredit) ? 'text-muted' : 'text-warn')}>{totalDebit.eq(totalCredit) ? 'debits equal credits' : <>differ by <Money value={totalDebit.minus(totalCredit).abs()} currency={currency} /></>}</td>
                </tr>} />
            </Panel>
            <div className="mt-1.5 text-[11.5px] text-muted">This is a reading of the file, not a check of it. When the file is staged the engine checks every row, looks for duplicates, tests that debits equal credits{journals ? ' in every voucher' : ''}, and tests the mapping of accounts.</div>
          </div>
        )}

        {file && problems.length > 0 && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      </div>
    </Drawer>
  )
}

// ====================================================================== one batch
type BatchRow = ImportBatch['rows'][number]
interface Created { id: ID; n: number; journal: Journal | null }

function CheckCard({ title, passed, allowed, figure, children }: { title: string; passed: boolean; allowed?: boolean; figure: ReactNode; children?: ReactNode }) {
  const tone = passed ? 'text-pos' : allowed ? 'text-warn' : 'text-neg'
  return (
    <Panel className="p-4" lit={false}>
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">{title}</div>
        <span className={cx('chip', passed ? 'pos' : allowed ? 'warn' : 'neg')}>{passed ? <CheckCircle2 size={11} /> : allowed ? <AlertTriangle size={11} /> : <XCircle size={11} />}{passed ? 'passed' : allowed ? 'not passed · allowed' : 'did not pass'}</span>
      </div>
      <div className={cx('mt-2 text-[13px]', tone)}>{figure}</div>
      {children && <div className="mt-2 space-y-1 text-[12px] text-ink2">{children}</div>}
    </Panel>
  )
}

function BatchView({ id }: { id: ID }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accountName = useAccountName()
  const companyName = useCompanyName()
  const who = useNames()
  const { act, busy } = useAction()
  const [confirming, setConfirming] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [onlyErrors, setOnlyErrors] = useState(false)

  const main = useAsync(() => api.getImport(id), [api, id])
  const b = main.data
  const companyId = b?.company_id
  const journalIds = useMemo(() => list<ID>(b?.committed?.journal_ids).filter((x) => typeof x === 'string'), [b])
  const journalKey = journalIds.join(',')
  const mayReadJournals = !!companyId && can('journal.view', companyId)
  const journals = useAsync(async () => {
    if (!companyId || !journalIds.length || !mayReadJournals) return [] as Journal[]
    const wanted = new Set(journalIds)
    return (await api.listJournals({ companyIds: [companyId], limit: 1000 })).rows.filter((j) => wanted.has(j.id))
  }, [api, companyId, journalKey, mayReadJournals])

  const rows = useMemo(() => [...(b?.rows ?? [])].sort((x, y) => Number(!!y.error) - Number(!!x.error) || x.row - y.row), [b])

  const back = <button className="btn ghost" onClick={() => nav('/imports')}><ArrowLeft size={15} /> Back</button>
  if (main.error) {
    return (
      <div>
        <PageHeader eyebrow="Platform · Imports" title="Import" actions={back} />
        <Panel><Empty icon={<FileSpreadsheet size={20} />} title="Import not found or not shared with you" body={<>This file does not exist in the companies you can access. <span className="text-ink2">{main.error}</span></>} action={<button className="btn" onClick={main.reload}>Try again</button>} /></Panel>
      </div>
    )
  }
  if (!b) return <div><PageHeader eyebrow="Platform · Imports" title="Import" actions={back} /><Panel><Loading rows={7} label="Loading the import" /></Panel></div>
  if (!can('import.manage', b.company_id)) return <NoAccess eyebrow="Platform · Imports" title="Imports" perm="import.manage" back="/imports" />

  const currency = companies.find((c) => c.id === b.company_id)?.base_currency ?? 'INR'
  const legacy = b.kind === 'legacy_trial_balance'
  const checks = b.checks ?? ({} as ImportBatch['checks'])
  const errors = list<{ row: number | null; message: string }>(checks.validation?.errors)
  const rowErrors = rows.filter((r) => r.error).length
  const unbalanced = list<{ ref: string; debit: string; credit: string }>(checks.balance?.unbalanced)
  const notMapped = list<string>(checks.mapping?.unmapped)
  const dup = checks.duplicates ?? { passed: true }
  const repeated = count(dup.repeated_rows_in_file), lookRecorded = count(dup.vouchers_that_look_already_recorded)
  const vouchers = new Set(rows.map((r) => r.ref).filter(Boolean)).size
  const totalDebit = D(checks.total_debit), totalCredit = D(checks.total_credit)
  const mapping = Object.entries(b.mapping ?? {})
  const rule = typeof b.committed?.rule === 'string' ? b.committed.rule : null
  const records = count(b.committed?.records)

  const willDo: ReactNode = b.kind === 'journals'
    ? <>Each voucher reference in the file becomes one <strong className="text-ink">draft</strong> journal entry: {plural(vouchers, 'draft', 'drafts')} from {plural(rows.length, 'row', 'rows')}. A draft is not in the ledger. Each one is then submitted and approved like any other entry, and only then posted. The import itself posts nothing.</>
    : b.kind === 'opening_balances'
      ? <>The whole file becomes <strong className="text-ink">one draft</strong> opening entry dated {fmtDate(b.period_end)}, with one line for each of the {plural(rows.length, 'row', 'rows')}. A draft is not in the ledger. It is then submitted and approved like any other entry, and only then posted. The import itself posts nothing.</>
      : <>The {plural(rows.length, 'balance is', 'balances are')} kept <strong className="text-ink">beside</strong> the books, as the trial balance of the earlier system at {fmtDate(b.period_end)}, for the parallel run. No entry is created and nothing is posted.</>

  const commit = async () => {
    setConfirming(false)
    await act(() => api.commitImport(b.id), (r) => (legacy ? `${plural(r.records, 'balance', 'balances')} kept beside the books. Nothing was posted.` : `${plural(r.journal_ids.length, 'draft entry', 'draft entries')} created. Nothing is posted until each is approved.`))
  }
  const discard = async (reason: string) => {
    setDiscarding(false)
    await act(() => api.discardImport(b.id, reason), 'The file was discarded. Nothing of it had entered the books.')
  }

  const columns: Column<BatchRow>[] = [
    { key: 'row', header: 'Row', width: 60, align: 'right', sort: (r) => r.row, csv: (r) => r.row, render: (r) => <span className="num text-muted">{r.row}</span> },
    ...(b.kind === 'journals' ? [
      { key: 'date', header: 'Date', sort: (r: BatchRow) => r.date ?? '', csv: (r: BatchRow) => r.date ?? '', render: (r: BatchRow) => (r.date ? <span className="num text-[12.5px]">{fmtDate(r.date)}</span> : <span className="text-muted">—</span>) },
      { key: 'ref', header: 'Reference', sort: (r: BatchRow) => r.ref ?? '', csv: (r: BatchRow) => r.ref ?? '', render: (r: BatchRow) => (r.ref ? <span className="num text-[12.5px] text-gold">{r.ref}</span> : <span className="text-muted">—</span>) },
    ] : []),
    { key: 'account', header: 'Code in the file', sort: (r) => r.account, csv: (r) => r.account, render: (r) => <span className="num text-[12.5px]">{r.account || '—'}</span> },
    { key: 'name', header: 'Name in the file', sort: (r) => (r.name ?? '').toLowerCase(), csv: (r) => r.name ?? '', render: (r) => <span className="text-[12.5px] text-ink2">{r.name ?? ''}</span> },
    { key: 'ledger', header: 'Ledger in NUMERO', sort: (r) => (r.account_id ? accountName(r.account_id) : ''), csv: (r) => (r.account_id ? accountName(r.account_id) : 'not mapped'), render: (r) => (r.account_id ? <span className="text-ink2">{accountName(r.account_id)}</span> : <span className="chip warn">not mapped</span>) },
    { key: 'debit', header: 'Debit', align: 'right', sort: (r) => D(r.debit).toNumber(), csv: (r) => D(r.debit).toFixed(2), render: (r) => (D(r.debit).isZero() ? '' : <Money value={r.debit} currency={currency} />) },
    { key: 'credit', header: 'Credit', align: 'right', sort: (r) => D(r.credit).toNumber(), csv: (r) => D(r.credit).toFixed(2), render: (r) => (D(r.credit).isZero() ? '' : <Money value={r.credit} currency={currency} />) },
    { key: 'narration', header: 'Narration', csv: (r) => r.narration ?? '', render: (r) => <span className="text-[12.5px] text-ink2">{r.narration ?? ''}</span> },
    { key: 'error', header: 'What is wrong', sort: (r) => r.error ?? '', csv: (r) => r.error ?? '', render: (r) => (r.error ? <span className="text-[12.5px] text-neg">{r.error}</span> : <span className="text-muted">—</span>) },
  ]

  const created: Created[] = journalIds.map((jid, i) => ({ id: jid, n: i + 1, journal: (journals.data ?? []).find((j) => j.id === jid) ?? null }))
  const createdColumns: Column<Created>[] = [
    { key: 'n', header: 'No', width: 56, align: 'right', render: (c) => <span className="num text-muted">{c.n}</span>, sort: (c) => c.n, csv: (c) => c.n },
    { key: 'voucher', header: 'Entry', render: (c) => <span className="num text-[12.5px] text-gold">{c.journal?.voucher_no ?? 'Draft, not yet numbered'}</span>, csv: (c) => c.journal?.voucher_no ?? 'draft' },
    { key: 'date', header: 'Date', render: (c) => (c.journal ? <span className="num text-[12.5px]">{fmtDate(c.journal.journal_date)}</span> : <span className="text-muted">—</span>), sort: (c) => c.journal?.journal_date ?? '', csv: (c) => c.journal?.journal_date ?? '' },
    { key: 'narration', header: 'Narration', render: (c) => <span className="text-[12.5px] text-ink2">{c.journal?.narration ?? (mayReadJournals ? 'Not shared with you, or no longer among the latest entries' : '—')}</span>, csv: (c) => c.journal?.narration ?? '' },
    { key: 'total', header: 'Total', align: 'right', render: (c) => (c.journal ? <Money value={c.journal.total} currency={currency} /> : <span className="text-muted">—</span>), sort: (c) => D(c.journal?.total).toNumber(), csv: (c) => (c.journal ? D(c.journal.total).toFixed(2) : '') },
    { key: 'status', header: 'Where it stands', render: (c) => (c.journal ? <StatusChip status={c.journal.status} label={c.journal.status === 'draft' ? 'draft — not submitted' : c.journal.status === 'submitted' ? 'awaiting approval' : undefined} /> : <span className="text-muted">—</span>), sort: (c) => c.journal?.status ?? '', csv: (c) => c.journal?.status ?? '' },
    { key: 'open', header: '', align: 'right', render: () => <span className="link inline-flex items-center gap-1 text-[12.5px]">Open <ExternalLink size={11} /></span> },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={`Platform · Imports · ${kindLabel(b.kind)}`}
        title={b.file_name}
        subtitle={<>{companyName(b.company_id)} · brought in by {who(b.created_by)} on {fmtDateTime(b.created_at)}{b.period_end ? <> · balances as at {fmtDate(b.period_end)}</> : null}<DemoTag className="ml-2" /></>}
        actions={<>
          {back}
          {b.status === 'staged' && <button className="btn danger" disabled={busy} onClick={() => setDiscarding(true)}><Trash2 size={14} /> Discard</button>}
          {b.status === 'staged' && b.ok && <button className="btn primary" disabled={busy} onClick={() => setConfirming(true)}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Commit</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={b.status} />
        {b.ok ? <span className="chip pos"><CheckCircle2 size={11} /> passed its checks</span> : <span className="chip neg"><XCircle size={11} /> did not pass its checks</span>}
        <span className="chip">{kindLabel(b.kind)}</span>
      </div>

      {b.status === 'staged' && b.ok && <Note kind="good" className="mb-4"><strong className="text-ink">This file passed its checks. Nothing of it has entered the books.</strong> If it is committed: {willDo}</Note>}
      {b.status === 'staged' && !b.ok && <Note kind="warn" className="mb-4"><strong className="text-ink">This file did not pass its checks. Nothing of it has entered the books.</strong> It cannot be committed as it stands. Correct the file or the mapping of its accounts and bring it in again; then discard this one, with the reason.</Note>}
      {b.status === 'committed' && <Note kind="good" className="mb-4"><strong className="text-ink">Committed on {fmtDateTime(b.committed_at)}.</strong> {rule ?? (legacy ? 'Kept beside the books for comparison. Nothing was posted.' : 'Entered as drafts. Each is submitted and approved like any other entry before it is posted.')} What has been committed is corrected in the books, not discarded.</Note>}
      {b.status === 'discarded' && <Note className="mb-4"><strong className="text-ink">This file was discarded.</strong> Nothing of it entered the books. It stays on record.{b.note ? <> Reason or note: {b.note}</> : null}</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Rows" sub={b.kind === 'journals' ? `${plural(vouchers, 'voucher reference', 'voucher references')}` : `balances as at ${fmtDate(b.period_end)}`}><span className="num">{count(checks.rows || b.row_count).toLocaleString()}</span></Tile>
        <Tile label="Total debit" sub="of every row in the file"><Money value={totalDebit} currency={currency} compact /></Tile>
        <Tile label="Total credit" sub="of every row in the file"><Money value={totalCredit} currency={currency} compact /></Tile>
        <Tile label="Debit less credit" tone={totalDebit.eq(totalCredit) ? 'text-pos' : 'text-warn'} sub={totalDebit.eq(totalCredit) ? 'the file balances as a whole' : 'the file does not balance as a whole'}><Money value={totalDebit.minus(totalCredit)} currency={currency} compact /></Tile>
      </div>

      <Section title="The four checks" className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CheckCard title="1 · Rows" passed={!!checks.validation?.passed}
            figure={checks.validation?.passed ? `Every one of the ${rows.length.toLocaleString()} rows can be read.` : `${plural(rowErrors, 'row has', 'rows have')} something wrong${errors.some((e) => e.row === null) ? `, and ${plural(errors.filter((e) => e.row === null).length, 'voucher has', 'vouchers have')} a fault of its own` : ''}.`}>
            {errors.filter((e) => e.row === null).slice(0, 5).map((e, i) => <div key={i}>· {e.message}</div>)}
            {errors.filter((e) => e.row !== null).slice(0, 3).map((e, i) => <div key={i}>· row <span className="num">{e.row}</span>: {e.message}</div>)}
            {rowErrors > 3 && <div className="text-muted">Every row with a fault is in the table below, first.</div>}
            <div className="text-muted">Tested: date and reference (journals), the account, that amounts are numbers and not negative, that a line is a debit or a credit.</div>
          </CheckCard>
          <CheckCard title="2 · Duplicates" passed={!!dup.passed}
            figure={dup.passed ? 'This file has not been committed before.' : 'A file with the same fingerprint has already been committed for this company.'}>
            <div>Rows repeated inside the file: <span className={cx('num', repeated > 0 && 'text-warn')}>{repeated}</span></div>
            {b.kind === 'journals' && <div>Vouchers that look already recorded: <span className={cx('num', lookRecorded > 0 && 'text-warn')}>{lookRecorded}</span></div>}
            <div className="text-muted">{typeof dup.note === 'string' ? dup.note : 'Repeated rows and vouchers that look already recorded are shown for a person to judge. They do not stop the import; a file already committed does.'}</div>
            {b.kind === 'journals' && <div className="text-muted">“Looks already recorded”: an entry in the books with the same date and total whose narration carries the same reference.</div>}
          </CheckCard>
          <CheckCard title="3 · Balance" passed={!!checks.balance?.passed}
            figure={checks.balance?.passed ? (b.kind === 'journals' ? 'Debits equal credits in every voucher.' : 'Debits equal credits over the whole file.') : b.kind === 'journals' ? `${plural(unbalanced.length, 'voucher does', 'vouchers do')} not balance.` : 'Debits do not equal credits over the whole file.'}>
            {unbalanced.slice(0, 6).map((u) => <div key={u.ref}>· <span className="num text-gold">{u.ref}</span>: debit <Money value={u.debit} currency={currency} />, credit <Money value={u.credit} currency={currency} />, apart by <Money value={D(u.debit).minus(u.credit).abs()} currency={currency} className="text-warn" /></div>)}
            {unbalanced.length > 6 && <div className="text-muted">and {unbalanced.length - 6} more</div>}
          </CheckCard>
          <CheckCard title="4 · Mapping of accounts" passed={!!checks.mapping?.passed} allowed={legacy}
            figure={checks.mapping?.passed ? 'Every code in the file leads to a ledger of NUMERO.' : `${plural(notMapped.length, 'code leads', 'codes lead')} to no ledger of NUMERO.`}>
            {notMapped.length > 0 && <div className="num break-words">{notMapped.slice(0, 40).join(', ')}{notMapped.length > 40 ? ` and ${notMapped.length - 40} more` : ''}</div>}
            {legacy && notMapped.length > 0 && <div className="text-muted">For the trial balance of an earlier system this does not stop the import: the balances are kept and shown as “not mapped” in the parallel run.</div>}
            {mapping.length > 0 && <div className="text-muted">Mapped by the person: {mapping.map(([k, v]) => `${k} → ${v}`).join(', ')}</div>}
          </CheckCard>
        </div>
      </Section>

      {b.status === 'committed' && (
        <Section title="What was created" className="mb-4">
          {legacy ? (
            <Panel className="flex flex-wrap items-center justify-between gap-3 p-4" lit={false}>
              <div className="text-[13px] text-ink2"><span className="num text-ink">{records.toLocaleString()}</span> balance{records === 1 ? '' : 's'} of the earlier system as at {fmtDate(b.period_end)}, kept beside the books. No entry was created.</div>
              <button className="btn" onClick={() => nav(`/imports?tab=parallel&company=${b.company_id}&batch=${b.id}`)}><Scale size={14} /> Compare with NUMERO</button>
            </Panel>
          ) : (
            <Panel lit={false}>
              <DataTable columns={createdColumns} rows={created} rowKey={(c) => c.id} onRow={(c) => nav('/journals/' + c.id)} exportName={`import-${b.file_name.replace(/\.csv$/i, '')}-entries`}
                toolbar={<span className="text-[12px] text-muted">{plural(created.length, 'draft entry was', 'draft entries were')} created. An entry reaches the ledger only when it has been submitted and a second person has approved it, on the <button className="link" onClick={() => nav('/approvals')}>Approvals</button> screen.{!mayReadJournals && ' Your role does not read journal entries (journal.view) in this company, so only the links are shown.'}</span>}
                empty={{ title: 'No entry is recorded against this import', body: 'The import was committed but it lists no entry.' }} />
            </Panel>
          )}
        </Section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Section title="Every row of the file" className="min-w-0">
          <Panel lit={false}>
            <DataTable key={String(onlyErrors)} columns={columns} rows={onlyErrors ? rows.filter((r) => r.error) : rows} rowKey={(r) => String(r.row)} pageSize={50}
              exportName={`import-${b.file_name.replace(/\.csv$/i, '')}-rows`}
              rowClass={(r) => (r.error ? 'bg-negsoft' : undefined)}
              toolbar={<>
                <span className="text-[12.5px] text-ink2"><span className="num text-ink">{rows.length.toLocaleString()}</span> row{rows.length === 1 ? '' : 's'} · <span className={cx('num', rowErrors ? 'text-neg' : 'text-pos')}>{rowErrors.toLocaleString()}</span> with something wrong</span>
                {rowErrors > 0 && <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink2"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> only those</label>}
                <span className="text-[11.5px] text-muted">Rows with a fault come first.</span>
              </>}
              footer={<tr>
                <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={b.kind === 'journals' ? 6 : 4}>Total of the file</td>
                <td className={cx(foot, 'r')}><Money value={totalDebit} currency={currency} /></td>
                <td className={cx(foot, 'r')}><Money value={totalCredit} currency={currency} /></td>
                <td className={foot} colSpan={2} />
              </tr>}
              empty={{ title: onlyErrors ? 'No row has a fault' : 'The rows of this file are not available', body: onlyErrors ? undefined : 'The batch carries no rows.' }} />
          </Panel>
        </Section>

        <div className="min-w-0 space-y-4">
          <Section title="The file">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Company">{companyName(b.company_id)}</Fact>
              <Fact label="What it holds">{kindLabel(b.kind)}</Fact>
              <Fact label="Date of the balances">{b.period_end ? <span className="num">{fmtDate(b.period_end)}</span> : 'Not applicable — each row carries its date'}</Fact>
              <Fact label="Brought in">{who(b.created_by)} · <span className="num">{fmtDateTime(b.created_at)}</span></Fact>
              <Fact label="Fingerprint (SHA-256)" className="sm:col-span-2"><span className="num break-all text-[12px] text-ink2">{b.sha256}</span></Fact>
              {b.note && <Fact label={b.status === 'discarded' ? 'Reason or note' : 'Note'} className="sm:col-span-2">{b.note}</Fact>}
            </Panel>
          </Section>
          <History entity="import_batches" entityId={b.id} />
        </div>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Commit this import" subtitle={`${b.file_name} · ${companyName(b.company_id)}`} width={540}
        footer={<><button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => void commit()}><BadgeCheck size={15} /> Commit</button></>}>
        <p className="m-0 text-[13.5px] leading-relaxed text-ink2">{willDo}</p>
        {(repeated > 0 || lookRecorded > 0) && <Note kind="warn" className="mt-4">{repeated > 0 && <>{plural(repeated, 'row is', 'rows are')} repeated inside the file. </>}{lookRecorded > 0 && <>{plural(lookRecorded, 'voucher looks', 'vouchers look')} already recorded in the books. </>}These do not stop the import. Look at them before committing: what is committed twice has to be corrected in the books.</Note>}
        <div className="mt-4 text-[12px] text-muted">A committed import cannot be discarded. {legacy ? 'The balances stay beside the books as a record of the earlier system.' : 'A draft that should not have been created is cancelled from its own screen.'}</div>
      </Modal>

      <ReasonDialog open={discarding} title="Discard this file" confirm="Discard" danger onCancel={() => setDiscarding(false)} onConfirm={(r) => void discard(r)}
        body="Nothing of this file has entered the books. Discarding sets it aside; it stays on record with the reason, and the same file can be brought in again." />
    </div>
  )
}

// ====================================================================== parallel run
type State = ParallelRow['state']
const STATES: { key: State; label: string; chip: string; tone: string; text: string; meaning: string }[] = [
  { key: 'differs', label: 'Differs', chip: 'warn', tone: 'warn', text: 'text-warn', meaning: 'Both hold the ledger; the balances are apart by more than the tolerance.' },
  { key: 'not mapped', label: 'Not mapped', chip: 'violet', tone: 'violet', text: 'text-violet', meaning: 'A code of the earlier system that leads to no ledger of NUMERO.' },
  { key: 'only in NUMERO', label: 'Only in NUMERO', chip: 'cyan', tone: 'cyan', text: 'text-cyan', meaning: 'A ledger with a balance in NUMERO that the earlier trial balance does not carry.' },
  { key: 'agrees', label: 'Agrees', chip: 'pos', tone: 'pos', text: 'text-pos', meaning: 'The two balances are within the tolerance of each other.' },
]
const stateOf = (s: State) => STATES.find((x) => x.key === s)!

/** Shares of a whole, as one bar. */
function Shares({ parts }: { parts: { label: string; n: number; tone: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  if (!total) return null
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface2" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(', ')}>
        {parts.filter((p) => p.n > 0).map((p) => <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: `var(--${p.tone})` }} title={`${p.label}: ${p.n}`} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink2">
        {parts.map((p) => <span key={p.label} className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: `var(--${p.tone})` }} />{p.label} <span className="num text-ink">{p.n}</span></span>)}
      </div>
    </div>
  )
}

function Parallel({ ids, batches }: { ids: ID[]; batches: ImportBatch[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useCompanyChoices(ids)
  const [tolerance, setTolerance] = useState('1')
  const [only, setOnly] = useState<State | null>(null)

  const wantedCompany = sp.get('company') ?? ''
  const company = ids.includes(wantedCompany) ? wantedCompany : ids[0]
  const currency = companies.find((c) => c.id === company)?.base_currency ?? 'INR'
  const patch = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(p)) { if (v === null) n.delete(k); else n.set(k, v) }
    setSp(n, { replace: true })
  }

  const legacy = useAsync(() => api.listLegacyBalances([company]), [api, company])
  // one committed file is one trial balance; two files for the same date are never added together
  const files = useMemo(() => {
    const m = new Map<ID, { batch: ID; date: string; rows: LegacyBalance[] }>()
    for (const l of legacy.data ?? []) { const f = m.get(l.batch_id) ?? { batch: l.batch_id, date: l.period_end, rows: [] }; f.rows.push(l); m.set(l.batch_id, f) }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [legacy.data])
  const file = files.find((f) => f.batch === sp.get('batch')) ?? files[0] ?? null
  const date = file?.date ?? ''
  const fileName = (id: ID) => batches.find((x) => x.id === id)?.file_name ?? 'file'

  const mayReadLedger = can('report.view', company)
  const numero = useAsync(async () => (date && mayReadLedger ? api.ledgerBalances([company], '1990-01-01', date) : null), [api, company, date, mayReadLedger])

  const tol = D(tolerance || 0)
  const chart = useMemo(() => accounts.filter((a) => a.company_id === company), [accounts, company])
  const result = useMemo(() => {
    if (!file || !numero.data) return null
    // closing balance of each ledger at the date, debit positive: the convention of the engine
    const closing = numero.data.map((r) => ({ account_id: r.account_id, closing: D(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit) }))
    return { ...parallelRun(file.rows, closing, chart, tol), numeroTotal: closing.reduce((s, r) => s.plus(r.closing), ZERO) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, numero.data, chart, tol.toString()])

  const order = (s: State) => STATES.findIndex((x) => x.key === s)
  const rows = useMemo(() => [...(result?.rows ?? [])].sort((a, b) => order(a.state) - order(b.state) || b.difference.abs().cmp(a.difference.abs())), [result])
  const shown = only ? rows.filter((r) => r.state === only) : rows
  const counts: Record<State, number> = { differs: result?.differs ?? 0, 'not mapped': result?.notMapped ?? 0, 'only in NUMERO': result?.onlyHere ?? 0, agrees: result?.agrees ?? 0 }
  const open = (r: ParallelRow) => { if (r.account) nav(ledgerLink({ accounts: [r.account.id], to: date })) }

  const columns: Column<ParallelRow>[] = [
    { key: 'ledger', header: 'Ledger', sort: (r) => r.name.toLowerCase(), csv: (r) => r.name, render: (r) => <span className={cx(r.account ? 'text-ink' : 'text-ink2')}>{r.name}</span> },
    { key: 'code', header: 'Code in the earlier system', sort: (r) => r.code, csv: (r) => r.code, render: (r) => <span className="num text-[12.5px] text-ink2">{r.code}</span> },
    { key: 'legacy', header: 'Earlier system', align: 'right', sort: (r) => r.legacy.toNumber(), csv: (r) => r.legacy.toFixed(2), render: (r) => <DrCr value={r.legacy} currency={currency} /> },
    {
      key: 'numero', header: 'NUMERO', align: 'right', sort: (r) => r.numero.toNumber(), csv: (r) => (r.account ? r.numero.toFixed(2) : ''),
      render: (r) => (!r.account ? <span className="text-muted" title="No ledger of NUMERO corresponds to this code">no ledger</span>
        : <button className="link" onClick={(e) => { e.stopPropagation(); open(r) }} title="Open the entries of this ledger up to the date">{r.numero.isZero() ? <span className="num">0.00</span> : <DrCr value={r.numero} currency={currency} />}</button>),
    },
    { key: 'diff', header: 'NUMERO less earlier system', align: 'right', sort: (r) => r.difference.abs().toNumber(), csv: (r) => r.difference.toFixed(2), render: (r) => (r.difference.isZero() ? <span className="num text-muted">—</span> : <Money value={r.difference} currency={currency} sign className={r.state === 'agrees' ? 'text-muted' : 'text-warn'} />) },
    { key: 'state', header: 'State', width: 150, sort: (r) => order(r.state), csv: (r) => r.state, render: (r) => <span className={cx('chip', stateOf(r.state).chip)} title={stateOf(r.state).meaning}>{r.state}</span> },
  ]

  return (
    <div>
      <Note className="mb-4">
        <strong className="text-ink">This compares two sets of books. It changes neither.</strong> The trial balance of the earlier system is kept beside NUMERO's books and posts nothing. A difference is a fact to be explained by a person: a late entry, a mapping, a timing. While both systems are kept, bring in the trial balance of each month end and compare again.
      </Note>

      <Panel className="mb-4 p-4" lit={false}>
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_180px]">
          <label><span className="label">Company</span>
            <select className="field sm" value={company} onChange={(e) => { setOnly(null); patch({ company: e.target.value, batch: null }) }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label><span className="label">Trial balance of the earlier system, as at</span>
            <select className="field sm" value={file?.batch ?? ''} disabled={!files.length} onChange={(e) => { setOnly(null); patch({ batch: e.target.value }) }}>
              {!files.length && <option value="">None has been committed</option>}
              {files.map((f) => <option key={f.batch} value={f.batch}>{fmtDate(f.date)} · {fileName(f.batch)} · {f.rows.length} balances</option>)}
            </select>
          </label>
          <label><span className="label">Tolerance ({currency})</span>
            <input className="field sm num" inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Tolerance: balances this close are taken to agree" />
          </label>
        </div>
        <div className="mt-2 text-[11.5px] text-muted">Two balances no further apart than the tolerance are taken to agree. NUMERO's figure is the closing balance of each ledger from its first entry to the end of the date chosen, debit positive; income and expense ledgers therefore carry everything since the first entry, not one financial year only.</div>
      </Panel>

      {legacy.error && <ErrorBox message={legacy.error} retry={legacy.reload} />}
      {!legacy.error && !legacy.data && <Panel><Loading rows={6} label="Loading the trial balances of the earlier system" /></Panel>}
      {legacy.data && !files.length && (
        <Panel><Empty icon={<Scale size={20} />} title="No trial balance of the earlier system has been committed for this company"
          body="Bring in a file of kind “Trial balance of the earlier system”, with the date of its balances, and commit it. It is kept beside the books and posts nothing." action={<button className="btn sm" onClick={() => patch({ tab: null, company: null, batch: null })}>See the imports</button>} /></Panel>
      )}
      {file && !mayReadLedger && <Note kind="warn">Your role does not read the books of this company (report.view), so NUMERO's side of the comparison cannot be shown. The trial balance of the earlier system is on record: {file.rows.length} balances as at {fmtDate(date)}.</Note>}
      {file && mayReadLedger && numero.error && <ErrorBox message={numero.error} retry={numero.reload} />}
      {file && mayReadLedger && !numero.error && !result && <Panel><Loading rows={6} label="Reading NUMERO's balances" /></Panel>}

      {file && result && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STATES.map((s) => (
              <Tile key={s.key} label={s.label} tone={counts[s.key] ? s.text : 'text-muted'} onClick={() => setOnly(only === s.key ? null : s.key)} sub={s.meaning}><span className="num">{counts[s.key]}</span></Tile>
            ))}
          </div>

          <Panel className="mb-4 p-4" lit={false}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] text-ink2">
                {result.ready
                  ? <><span className="font-medium text-pos">Every ledger agrees</span> at {fmtDate(date)}, within a tolerance of <Money value={tol} currency={currency} />.</>
                  : <><span className="font-medium text-warn">{plural(result.differs + result.notMapped + result.onlyHere, 'ledger does', 'ledgers do')} not agree</span> at {fmtDate(date)}, of {rows.length} compared.</>}
              </div>
              <Explain title="Parallel run" text="The trial balance of the earlier system is set beside the closing balances of NUMERO at the same date, ledger by ledger. Balances of the earlier system that are mapped to the same ledger are added together before they are compared. Nothing is posted and neither set of books is changed."
                formula="Difference = balance in NUMERO − balance in the earlier system (debit positive). Agrees when |difference| ≤ tolerance."
                inputs={[{ label: 'Earlier system, debits less credits', value: result.legacyTotal }, { label: 'NUMERO, debits less credits', value: result.numeroTotal }, { label: 'Sum of the differences, without sign', value: result.totalDifference }]}
                source={`Source: the committed file ${fileName(file.batch)}, and the posted entries of the general ledger up to ${fmtDate(date)}.`} />
            </div>
            <Shares parts={STATES.map((s) => ({ label: s.label, n: counts[s.key], tone: s.tone }))} />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Fact label="Earlier system — debits less credits"><Money value={result.legacyTotal} currency={currency} className={result.legacyTotal.abs().gt(tol) ? 'text-warn' : undefined} /><div className="text-[11.5px] text-muted">{result.legacyTotal.abs().gt(tol) ? 'the trial balance brought in does not balance' : 'a trial balance that balances comes to zero'}</div></Fact>
              <Fact label="NUMERO — debits less credits"><Money value={result.numeroTotal} currency={currency} className={result.numeroTotal.abs().gt(tol) ? 'text-warn' : undefined} /><div className="text-[11.5px] text-muted">of every ledger with posted entries up to the date</div></Fact>
              <Fact label="Sum of the differences, without sign"><Money value={result.totalDifference} currency={currency} /><div className="text-[11.5px] text-muted">a measure of how far apart the books are; one entry missing shows twice, once in each of its ledgers</div></Fact>
            </div>
          </Panel>

          <Panel lit={false}>
            <DataTable key={only ?? 'all'} columns={columns} rows={shown} rowKey={(r) => `${r.state}|${r.account?.id ?? r.code}`} pageSize={100}
              exportName={`parallel-run-${companies.find((c) => c.id === company)?.code ?? 'company'}-${date}`}
              rowClass={(r) => (r.state === 'differs' ? 'bg-warnsoft' : undefined)}
              toolbar={<>
                <span className="text-[12.5px] text-ink2"><span className="num text-ink">{shown.length}</span> ledger{shown.length === 1 ? '' : 's'} · those that do not agree come first</span>
                {only && <button className="chip gold" onClick={() => setOnly(null)} title="Clear this filter">{only} ×</button>}
              </>}
              footer={<tr>
                <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={2}>Total, debits less credits{only ? ' · of the rows shown' : ''}</td>
                <td className={cx(foot, 'r')}><Money value={shown.reduce((s, r) => s.plus(r.legacy), ZERO)} currency={currency} /></td>
                <td className={cx(foot, 'r')}><Money value={shown.reduce((s, r) => s.plus(r.numero), ZERO)} currency={currency} /></td>
                <td className={cx(foot, 'r')}><Money value={shown.reduce((s, r) => s.plus(r.difference), ZERO)} currency={currency} sign /></td>
                <td className={foot} />
              </tr>}
              empty={{ title: 'Nothing in this list', body: only ? `No ledger is in the state “${only}”.` : 'Neither set of books carries a balance at this date.' }} />
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">A figure of NUMERO opens the entries of that ledger up to {fmtDate(date)}. Ledgers at zero in NUMERO that the earlier system does not carry are left out.</div>
        </>
      )}
    </div>
  )
}
