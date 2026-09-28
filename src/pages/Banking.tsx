import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowUpRight, Building2, Check, CopyX, Download, FileUp, Flag, Landmark, Link2, Link2Off, Plus, RotateCcw, Upload, Wallet } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv, ledgerLink, parseCsv } from '@/lib/data'
import { D, ZERO, sum } from '@/lib/money'
import { fmtDate, pad, today } from '@/lib/dates'
import type { Account, BankAccount, BankSuggestion, BankTxn, BankTxnStatus, Company, ID, LedgerLine } from '@/engine/types'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

const KINDS: { key: string; label: string }[] = [
  { key: 'bank', label: 'Bank account' },
  { key: 'cash', label: 'Cash' },
  { key: 'petty_cash', label: 'Petty cash' },
  { key: 'credit_card', label: 'Credit card' },
  { key: 'corporate_card', label: 'Corporate card' },
  { key: 'upi', label: 'UPI' },
  { key: 'gateway', label: 'Payment gateway' },
  { key: 'wallet', label: 'Wallet' },
]
const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k.replace(/_/g, ' ')

const STATUS_LABEL: Record<BankTxnStatus, string> = {
  matched: 'Matched', suggested: 'Suggested match', partial: 'Partially matched', duplicate: 'Duplicate', unmatched: 'Unmatched', needs_review: 'Needs review',
}
const STATUS_ORDER: BankTxnStatus[] = ['matched', 'suggested', 'partial', 'duplicate', 'unmatched', 'needs_review']
const NEVER_FORCED = 'NUMERO never forces a match when amounts differ.'

/** Only the last four characters are ever kept. */
const maskNumber = (raw: string) => {
  const s = raw.replace(/[^0-9A-Za-z]/g, '')
  return s ? '••••' + s.slice(-4) : ''
}
const signedOf = (l: LedgerLine) => D(l.debit).minus(D(l.credit))

export default function Banking() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const [selId, setSelId] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)

  const list = useAsync(async () => {
    const [banks, bals] = await Promise.all([api.listBankAccounts(ids), api.ledgerBalances(ids, '1990-01-01', today())])
    return { banks, bals }
  }, [api, ids.join(',')])

  const banks = useMemo(() => list.data?.banks ?? [], [list.data])
  const bookOf = useMemo(() => {
    const m = new Map<ID, Decimal>()
    for (const b of banks) {
      const rows = (list.data?.bals ?? []).filter((r) => r.company_id === b.company_id && r.account_id === b.ledger_account_id)
      m.set(b.id, rows.reduce((s, r) => s.plus(D(r.opening_debit)).plus(D(r.period_debit)).minus(D(r.opening_credit)).minus(D(r.period_credit)), ZERO))
    }
    return m
  }, [banks, list.data])

  const sel = banks.find((b) => b.id === selId) ?? banks[0] ?? null
  const scoped = companies.filter((c) => ids.includes(c.id))
  const configurable = scoped.filter((c) => can('account.configure', c.id))
  const selCompany = sel ? companies.find((c) => c.id === sel.company_id) : undefined

  const addBtn = (
    <button className="btn primary" disabled={!configurable.length} onClick={() => setAdding(true)}
      title={configurable.length ? 'Link a bank or cash ledger so that statements can be reconciled' : !scoped.length ? 'A bank or cash account belongs to a company: create a company first' : 'You need the "account.configure" permission to add a bank or cash account'}>
      <Plus size={15} /> Add bank / cash account
    </button>
  )

  return (
    <div>
      <PageHeader eyebrow="Treasury" title="Banking & Reconciliation"
        subtitle="Compare what the books say with what the bank says. Every difference stays visible until it is explained."
        actions={addBtn} />

      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading rows={6} /></Panel>}

      {list.data && banks.length === 0 && !companies.length && (
        <Panel>
          <Empty icon={<Building2 size={20} />} title="No company has been created yet"
            body="A bank or cash account belongs to a company and is linked to a bank or cash ledger in its chart of accounts. Create a company first: its recommended chart already has Cash in Hand, Petty Cash and a Primary Bank Account ledger, ready to link here."
            action={<button className="btn primary" onClick={() => nav('/companies?new=1')}>Create the first company</button>} />
        </Panel>
      )}

      {list.data && banks.length === 0 && companies.length > 0 && (
        <Panel>
          <Empty icon={<Landmark size={20} />} title="No bank or cash accounts yet"
            body="Link a bank or cash ledger from the chart of accounts. Statements can then be imported and reconciled against the books."
            action={addBtn} />
        </Panel>
      )}

      {list.data && banks.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-[330px_1fr]">
          <div className="space-y-4">
            {scoped.map((c) => {
              const own = banks.filter((b) => b.company_id === c.id)
              if (!own.length) return null
              return (
                <section key={c.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10.5px] text-gold">{c.code}</span>
                    <span className="eyebrow truncate">{c.name}</span>
                  </div>
                  <div className="space-y-2">
                    {own.map((b) => {
                      const active = sel?.id === b.id
                      return (
                        <Panel key={b.id} className={cx('p-3.5', active && 'border-gold/50')} onClick={() => setSelId(b.id)}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-gold">{b.kind === 'bank' ? <Landmark size={15} /> : <Wallet size={15} />}</span>
                                <span className="truncate text-[13.5px] font-medium text-ink">{b.name}</span>
                              </div>
                              <div className="mt-1 truncate text-[12px] text-muted">
                                {b.bank_name ?? 'No bank recorded'}{b.account_no_masked ? <> · <span className="num">{b.account_no_masked}</span></> : null}
                              </div>
                            </div>
                            <span className="chip">{kindLabel(b.kind)}</span>
                          </div>
                          <div className="mt-3 flex items-end justify-between gap-2">
                            <div className="text-[10.5px] uppercase tracking-[0.1em] text-muted">Book balance</div>
                            <Money value={bookOf.get(b.id) ?? ZERO} currency={c.base_currency} className="text-[15px]" />
                          </div>
                          {!b.is_active && <div className="mt-2"><span className="chip">inactive</span></div>}
                        </Panel>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>

          <div className="min-w-0">
            {sel && !can('bank.view', sel.company_id) && (
              <Panel><Empty icon={<Landmark size={20} />} title="Statement not available" body='You need the "bank.view" permission for this company to see its bank statement lines.' /></Panel>
            )}
            {sel && can('bank.view', sel.company_id) && (
              <Reconcile key={sel.id} bank={sel} company={selCompany} book={bookOf.get(sel.id) ?? ZERO} />
            )}
          </div>
        </div>
      )}

      <AddAccountModal open={adding} onClose={() => setAdding(false)} companies={configurable} banks={banks} onCreated={(id) => setSelId(id)} />
    </div>
  )
}

// ------------------------------------------------------------------ add account
function AddAccountModal({ open, onClose, companies, banks, onCreated }: { open: boolean; onClose: () => void; companies: Company[]; banks: BankAccount[]; onCreated: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const [companyId, setCompanyId] = useState<ID>('')
  const [ledgerId, setLedgerId] = useState<ID>('')
  const [name, setName] = useState('')
  const [bankName, setBankName] = useState('')
  const [number, setNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [currency, setCurrency] = useState('')
  const [kind, setKind] = useState('bank')

  const cid = companyId || companies[0]?.id || ''
  const company = companies.find((c) => c.id === cid)
  const ledgers = accounts.filter((a: Account) => a.company_id === cid && !a.is_group && a.is_active && (a.control_type === 'bank' || a.control_type === 'cash'))
  const linked = new Set(banks.filter((b) => b.company_id === cid).map((b) => b.ledger_account_id))
  const ledger = ledgers.find((a) => a.id === ledgerId)
  const ccy = (currency || ledger?.currency || company?.base_currency || '').toUpperCase()
  const masked = maskNumber(number)
  const valid = !!company && !!ledger && !linked.has(ledger.id) && name.trim() !== '' && /^[A-Z]{3}$/.test(ccy)

  const reset = () => { setCompanyId(''); setLedgerId(''); setName(''); setBankName(''); setNumber(''); setIfsc(''); setCurrency(''); setKind('bank') }
  const close = () => { reset(); onClose() }

  const save = async () => {
    if (!company || !ledger) return
    const id = await act(() => api.createBankAccount({
      company_id: company.id, ledger_account_id: ledger.id, name: name.trim(), bank_name: bankName.trim() || null,
      account_no_masked: masked || null, ifsc: ifsc.trim().toUpperCase() || null, currency: ccy, kind,
    }), 'Bank / cash account added')
    if (id) { onCreated(id); close() }
  }

  return (
    <Modal open={open} onClose={close} title="Add bank / cash account" subtitle="Links a ledger from the chart of accounts to a statement source" width={620}
      footer={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!valid || busy} onClick={() => void save()}>Add account</button>
      </>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Company">
          <select className="field" value={cid} onChange={(e) => { setCompanyId(e.target.value); setLedgerId('') }}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Ledger account" hint={ledgers.length ? 'Posting accounts with control type bank or cash' : undefined}>
          <select className="field" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
            <option value="">Select a ledger…</option>
            {ledgers.map((a) => <option key={a.id} value={a.id} disabled={linked.has(a.id)}>{a.code} · {a.name}{linked.has(a.id) ? ' (already linked)' : ''}</option>)}
          </select>
        </Field>
        {ledgers.length === 0 && (
          <Note kind="warn" className="sm:col-span-2">This company has no active posting account with control type <b>bank</b> or <b>cash</b>. Add one in the Chart of Accounts first.</Note>
        )}
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Current account — operations" /></Field>
        <Field label="Bank name"><input className="field" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Leave empty for cash" /></Field>
        <Field label="Account number (masked)" hint={masked ? `Stored as ${masked}. Only the last four characters are kept.` : 'Only the last four characters are kept.'}>
          <input className="field num" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Last four digits" autoComplete="off" />
        </Field>
        <Field label="IFSC"><input className="field num" value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Currency" hint="Three-letter currency code">
          <input className="field num" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder={ledger?.currency ?? company?.base_currency ?? ''} />
        </Field>
        <Field label="Kind">
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ reconciliation workspace
type TabKey = 'statement' | 'books' | 'import'
interface Pending { txn: BankTxn; status: BankTxnStatus; title: string; body: string; confirm: string; ok: string; danger?: boolean }

function Reconcile({ bank, company, book }: { bank: BankAccount; company: Company | undefined; book: Decimal }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [tab, setTab] = useState<TabKey>('statement')
  const [filter, setFilter] = useState<'all' | BankTxnStatus>('all')
  const [manual, setManual] = useState<BankTxn | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const detail = useAsync(async () => {
    const [txns, suggestions, lines] = await Promise.all([
      api.listBankTransactions(bank.id),
      api.suggestBankMatches(bank.id),
      api.ledgerLines({ company_ids: [bank.company_id], account_ids: [bank.ledger_account_id], limit: 1000 }),
    ])
    return { txns, suggestions, lines }
  }, [api, bank.id])

  const mayReconcile = can('bank.reconcile', bank.company_id)
  const mayImport = can('bank.import', bank.company_id)
  const whyNot = 'You need the "bank.reconcile" permission for this company'
  const baseCcy = company?.base_currency ?? bank.currency
  const mixed = baseCcy !== bank.currency

  const d = detail.data
  const view = useMemo(() => {
    const txns = d?.txns ?? []
    const best = new Map<ID, BankSuggestion>()
    for (const s of d?.suggestions ?? []) {
      const cur = best.get(s.txn_id)
      if (!cur || s.score > cur.score) best.set(s.txn_id, s)
    }
    /** an unmatched line for which a candidate book entry exists is shown as a suggested match */
    const shown = (t: BankTxn): BankTxnStatus => (t.status === 'unmatched' && best.has(t.id) ? 'suggested' : t.status)
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<BankTxnStatus, number>
    for (const t of txns) counts[shown(t)] += 1
    const statement = sum(txns.filter((t) => t.status !== 'duplicate').map((t) => t.amount))
    const matchedIds = new Set(txns.filter((t) => t.matched_line_id).map((t) => t.matched_line_id as ID))
    const lineById = new Map((d?.lines.rows ?? []).map((l) => [l.id, l]))
    const booksOnly = (d?.lines.rows ?? []).filter((l) => !matchedIds.has(l.id))
    return { txns, best, shown, counts, statement, lineById, booksOnly }
  }, [d])

  const difference = book.minus(view.statement)
  const rows = filter === 'all' ? view.txns : view.txns.filter((t) => view.shown(t) === filter)

  const confirmSuggestion = (t: BankTxn, s: BankSuggestion) =>
    void act(() => api.setBankMatch(t.id, s.line_id, 'matched', `Confirmed suggested match with ${s.voucher_no ?? 'book entry'} (score ${Math.round(s.score)}%): ${s.reasons.join('; ')}`), 'Match confirmed')

  const ask = (txn: BankTxn, status: BankTxnStatus) => {
    const line = `${fmtDate(txn.txn_date)} · ${txn.narration ?? 'no narration'}`
    const p: Record<string, Omit<Pending, 'txn' | 'status'>> = {
      needs_review: { title: 'Mark as needing review', body: `${line} will be flagged for review. It stays unreconciled and visible.`, confirm: 'Mark needs review', ok: 'Marked as needing review' },
      duplicate: { title: 'Mark as duplicate', body: `${line} will be marked as a duplicate statement line and excluded from the statement balance. The line itself is kept as evidence.`, confirm: 'Mark duplicate', ok: 'Marked as duplicate', danger: true },
      unmatched: txn.status === 'matched'
        ? { title: 'Unmatch this line', body: `${line} will be separated from its book entry. Neither the statement line nor the book entry is changed.`, confirm: 'Unmatch', ok: 'Match removed', danger: true }
        : { title: 'Return to unmatched', body: `${line} will be returned to the unmatched list.`, confirm: 'Return to unmatched', ok: 'Returned to unmatched' },
    }
    const def = p[status]
    if (def) setPending({ txn, status, ...def })
  }

  const columns: Column<BankTxn>[] = [
    { key: 'date', header: 'Date', width: 108, sort: (t) => t.txn_date, csv: (t) => t.txn_date, render: (t) => <span className="num text-ink2">{fmtDate(t.txn_date)}</span> },
    {
      key: 'narration', header: 'Narration', sort: (t) => t.narration ?? '', csv: (t) => t.narration,
      render: (t) => (
        <div className="min-w-[180px] max-w-[340px]">
          <div className="truncate text-ink" title={t.narration ?? undefined}>{t.narration ?? <span className="text-muted">No narration</span>}</div>
          {t.note && <div className="mt-0.5 truncate text-[11.5px] text-muted" title={t.note}>Note: {t.note}</div>}
        </div>
      ),
    },
    { key: 'reference', header: 'Reference', sort: (t) => t.reference ?? '', csv: (t) => t.reference, render: (t) => <span className="num text-[12px] text-ink2">{t.reference ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: (t) => D(t.amount).toNumber(), csv: (t) => D(t.amount).toFixed(2), render: (t) => <Money value={t.amount} currency={bank.currency} sign colored /> },
    { key: 'status', header: 'Status', sort: (t) => view.shown(t), csv: (t) => STATUS_LABEL[view.shown(t)], render: (t) => <StatusChip status={view.shown(t)} label={STATUS_LABEL[view.shown(t)]} /> },
    {
      key: 'match', header: 'Book entry',
      csv: (t) => (t.matched_line_id ? view.lineById.get(t.matched_line_id)?.voucher_no ?? t.matched_line_id : view.best.get(t.id)?.voucher_no ?? ''),
      render: (t) => {
        if (t.status === 'matched') {
          const l = t.matched_line_id ? view.lineById.get(t.matched_line_id) : undefined
          if (!l) return <span className="text-[12px] text-muted">Matched entry is outside the loaded book lines</span>
          return (
            <button className="drill text-left text-[12.5px]" onClick={() => nav('/journals/' + l.journal_id)} title="Open the matched book entry">
              <span className="num">{l.voucher_no ?? 'Unnumbered'}</span> · {fmtDate(l.journal_date)}
            </button>
          )
        }
        if (t.status === 'duplicate') return <span className="text-[12px] text-muted">Excluded from the statement balance</span>
        const s = view.best.get(t.id)
        if (!s) return <span className="text-[12px] text-muted">No book entry with this amount within 7 days</span>
        return (
          <div className="min-w-[200px]">
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <button className="drill" onClick={() => nav('/journals/' + s.journal_id)} title="Open the suggested book entry"><span className="num">{s.voucher_no ?? 'Unnumbered'}</span></button>
              <span className="text-muted">{fmtDate(s.journal_date)}</span>
              <span className="chip cyan" title="Strength of the suggestion. A suggestion is never applied without confirmation.">{Math.round(s.score)}%</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {s.reasons.map((r) => <span key={r} className="rounded-full border border-line bg-surface px-1.5 py-[1px] text-[10.5px] text-ink2">{r}</span>)}
            </div>
          </div>
        )
      },
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (t) => {
        const s = view.best.get(t.id)
        const off = !mayReconcile || busy
        if (t.status === 'matched') {
          return <button className="btn sm ghost" disabled={off} title={mayReconcile ? 'Separate this line from its book entry' : whyNot} onClick={() => ask(t, 'unmatched')}><Link2Off size={13} /> Unmatch</button>
        }
        if (t.status === 'duplicate') {
          return <button className="btn sm ghost" disabled={off} title={mayReconcile ? 'Return this line to the unmatched list' : whyNot} onClick={() => ask(t, 'unmatched')}><RotateCcw size={13} /> Not a duplicate</button>
        }
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {s && <button className="btn sm good" disabled={off} title={mayReconcile ? 'Confirm the suggested book entry' : whyNot} onClick={() => confirmSuggestion(t, s)}><Check size={13} /> Confirm match</button>}
            <button className="btn sm icon ghost" disabled={off} aria-label="Match manually" title={mayReconcile ? 'Match manually to a book entry with the same amount' : whyNot} onClick={() => setManual(t)}><Link2 size={14} /></button>
            {t.status !== 'needs_review'
              ? <button className="btn sm icon ghost" disabled={off} aria-label="Mark needs review" title={mayReconcile ? 'Mark needs review' : whyNot} onClick={() => ask(t, 'needs_review')}><Flag size={14} /></button>
              : <button className="btn sm icon ghost" disabled={off} aria-label="Return to unmatched" title={mayReconcile ? 'Return to unmatched' : whyNot} onClick={() => ask(t, 'unmatched')}><RotateCcw size={14} /></button>}
            <button className="btn sm icon ghost" disabled={off} aria-label="Mark duplicate" title={mayReconcile ? 'Mark duplicate' : whyNot} onClick={() => ask(t, 'duplicate')}><CopyX size={14} /></button>
          </div>
        )
      },
    },
  ]

  const bookColumns: Column<LedgerLine>[] = [
    { key: 'date', header: 'Date', width: 108, sort: (l) => l.journal_date, csv: (l) => l.journal_date, render: (l) => <span className="num text-ink2">{fmtDate(l.journal_date)}</span> },
    { key: 'voucher', header: 'Voucher', sort: (l) => l.voucher_no ?? '', csv: (l) => l.voucher_no, render: (l) => <span className="num drill">{l.voucher_no ?? 'Unnumbered'}</span> },
    { key: 'narration', header: 'Narration', sort: (l) => l.narration ?? '', csv: (l) => l.narration ?? l.description, render: (l) => <div className="max-w-[360px] truncate" title={l.narration ?? l.description ?? undefined}>{l.narration ?? l.description ?? <span className="text-muted">No narration</span>}</div> },
    { key: 'party', header: 'Party', sort: (l) => l.party_name ?? '', csv: (l) => l.party_name, render: (l) => <span className="text-ink2">{l.party_name ?? '—'}</span> },
    { key: 'debit', header: 'Debit', align: 'right', sort: (l) => D(l.debit).toNumber(), csv: (l) => D(l.debit).toFixed(2), render: (l) => <Money value={l.debit} currency={baseCcy} dim /> },
    { key: 'credit', header: 'Credit', align: 'right', sort: (l) => D(l.credit).toNumber(), csv: (l) => D(l.credit).toFixed(2), render: (l) => <Money value={l.credit} currency={baseCcy} dim /> },
  ]
  const booksOnlyNet = sum(view.booksOnly.map(signedOf))

  return (
    <div>
      <Panel className="mb-4 p-5" hud>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Reconciliation</div>
            <div className="display mt-0.5 truncate text-[17px] font-medium">{bank.name}</div>
            <div className="mt-0.5 text-[12px] text-muted">
              {company?.name ?? 'Unknown company'}{bank.bank_name ? ` · ${bank.bank_name}` : ''}{bank.account_no_masked ? <> · <span className="num">{bank.account_no_masked}</span></> : null}{bank.ifsc ? <> · <span className="num">{bank.ifsc}</span></> : null} · {bank.currency}
            </div>
          </div>
          <Truth state={difference.isZero() && view.txns.length > 0 ? 'RECONCILED' : 'UNRECONCILED'} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <button className="rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line2" onClick={() => nav(ledgerLink({ accounts: [bank.ledger_account_id], to: today() }))} title="Open the ledger lines behind this balance">
            <div className="eyebrow">Book balance</div>
            <Money value={book} currency={baseCcy} className="mt-1 block text-[20px]" />
            <div className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">Posted entries to {fmtDate(today())} <ArrowUpRight size={12} /></div>
          </button>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="eyebrow">Bank statement balance</div>
            <Money value={view.statement} currency={bank.currency} className="mt-1 block text-[20px]" />
            <div className="mt-1 text-[11.5px] text-muted">Net of imported statement lines</div>
          </div>
          <div className={cx('rounded-xl border px-4 py-3', difference.isZero() ? 'border-pos/30 bg-possoft' : 'border-warn/30 bg-warnsoft')}>
            <div className="eyebrow">Difference</div>
            <Money value={difference} currency={baseCcy} sign className={cx('mt-1 block text-[20px]', difference.isZero() ? 'text-pos' : 'text-warn')} />
            <div className="mt-1 text-[11.5px] text-muted">Book balance − statement balance</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => { setFilter(filter === s ? 'all' : s); setTab('statement') }} aria-pressed={filter === s}
              className={cx('flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors', filter === s ? 'border-gold/50 bg-goldsoft text-ink' : 'border-line bg-surface text-ink2 hover:border-line2')}>
              <span className="num font-semibold text-ink">{view.counts[s]}</span>{STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <Note>The statement balance is the net of the statement lines imported here, excluding duplicates. If the opening balance of the statement was not imported, the difference includes it. {NEVER_FORCED}</Note>
          {mixed && <Note kind="warn">This account is held in {bank.currency} while the books are kept in {baseCcy}. The book balance is shown in {baseCcy} and the statement balance in {bank.currency}; the difference is arithmetic only and is not a like-for-like comparison.</Note>}
          {d && d.lines.total > d.lines.rows.length && <Note kind="warn">This ledger has <span className="num">{d.lines.total.toLocaleString()}</span> book lines; the first <span className="num">{d.lines.rows.length.toLocaleString()}</span> are loaded for matching. The book balance above covers all of them.</Note>}
          {d && d.lines.restricted.count > 0 && <Note kind="warn"><span className="num">{d.lines.restricted.count}</span> book line{d.lines.restricted.count === 1 ? ' is' : 's are'} restricted by confidentiality and cannot be listed here.</Note>}
        </div>
      </Panel>

      <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
        { key: 'statement', label: 'Statement lines', count: view.txns.length },
        { key: 'books', label: 'Books only', count: view.booksOnly.length },
        { key: 'import', label: 'Import' },
      ]} />

      {detail.error && <ErrorBox message={detail.error} retry={detail.reload} />}
      {detail.loading && !d && <Panel><Loading rows={6} /></Panel>}

      {d && tab === 'statement' && (
        <Panel lit={false} className="overflow-hidden">
          <DataTable<BankTxn> columns={columns} rows={rows} rowKey={(t) => t.id} exportName={`bank-statement-${bank.name}`} initialSort={{ key: 'date', dir: 'desc' }}
            toolbar={<>
              <select className="field sm" style={{ width: 190 }} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | BankTxnStatus)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              {!mayReconcile && <span className="text-[11.5px] text-muted">{whyNot} to match or change lines.</span>}
            </>}
            empty={view.txns.length
              ? { title: 'No statement lines with this status', body: 'Choose another status to see the other lines.' }
              : { title: 'No statement has been imported', body: 'Import a bank statement to start reconciling this account.', icon: <FileUp size={20} />, action: <button className="btn sm" onClick={() => setTab('import')}><Upload size={13} /> Go to import</button> }} />
        </Panel>
      )}

      {d && tab === 'books' && (
        <Panel lit={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="text-[12.5px] text-ink2">Posted entries in this ledger that are not matched to any statement line.</div>
            <div className="flex items-center gap-2 text-[12.5px]"><span className="text-muted">Net</span><Money value={booksOnlyNet} currency={baseCcy} sign /></div>
          </div>
          <DataTable<LedgerLine> columns={bookColumns} rows={view.booksOnly} rowKey={(l) => l.id} onRow={(l) => nav('/journals/' + l.journal_id)}
            exportName={`books-only-${bank.name}`} initialSort={{ key: 'date', dir: 'desc' }} totalCount={d.lines.total > d.lines.rows.length ? d.lines.total : undefined}
            empty={{ title: 'Every book entry is matched', body: 'There are no posted entries in this ledger without a matching statement line.' }} />
        </Panel>
      )}

      {tab === 'import' && <ImportTab bank={bank} allowed={mayImport} onDone={() => setTab('statement')} />}

      <Note className="mt-4">Bank statement lines are evidence. They are never deleted or altered after import — a line can only be matched, flagged for review or marked as a duplicate, and each change is recorded.</Note>

      <ManualMatch txn={manual} bank={bank} candidates={view.booksOnly} baseCcy={baseCcy} onClose={() => setManual(null)} />

      <ReasonDialog open={!!pending} title={pending?.title ?? ''} body={pending?.body} confirm={pending?.confirm ?? 'Confirm'} danger={pending?.danger}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          const p = pending
          if (!p) return
          setPending(null)
          void act(() => api.setBankMatch(p.txn.id, null, p.status, reason), p.ok)
        }} />
    </div>
  )
}

// ------------------------------------------------------------------ manual match
function ManualMatch({ txn, bank, candidates, baseCcy, onClose }: { txn: BankTxn | null; bank: BankAccount; candidates: LedgerLine[]; baseCcy: string; onClose: () => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const [lineId, setLineId] = useState<ID | null>(null)
  const [note, setNote] = useState('')

  const same = txn ? candidates.filter((l) => signedOf(l).eq(D(txn.amount))).sort((a, b) => b.journal_date.localeCompare(a.journal_date)) : []
  const others = txn ? candidates.length - same.length : 0
  const close = () => { setLineId(null); setNote(''); onClose() }
  const chosen = same.find((l) => l.id === lineId)

  const save = async () => {
    if (!txn || !chosen) return
    const done = await act(async () => { await api.setBankMatch(txn.id, chosen.id, 'matched', note.trim() || `Matched manually to ${chosen.voucher_no ?? 'book entry'}`); return true }, 'Match confirmed')
    if (done) close()
  }

  return (
    <Modal open={!!txn} onClose={close} title="Match manually" width={720}
      subtitle={txn ? <>{fmtDate(txn.txn_date)} · {txn.narration ?? 'No narration'} · <Money value={txn.amount} currency={bank.currency} sign /></> : undefined}
      footer={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!chosen || busy || !can('bank.reconcile', bank.company_id)} title={can('bank.reconcile', bank.company_id) ? undefined : 'You need the "bank.reconcile" permission for this company'} onClick={() => void save()}>Confirm match</button>
      </>}>
      <Note className="mb-3">{NEVER_FORCED} Only unmatched book entries with exactly the same amount are offered.{others > 0 && <> <span className="num">{others}</span> other unmatched book entr{others === 1 ? 'y has' : 'ies have'} a different amount.</>}</Note>
      {same.length === 0 ? (
        <Empty title="No unmatched book entry has exactly this amount"
          body="Record the transaction in the books first, or mark the statement line as needing review."
          action={<button className="btn sm" onClick={() => { close(); nav('/journals/new') }}>Record a journal</button>} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {same.map((l) => (
            <label key={l.id} className={cx('flex cursor-pointer items-center gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-0', lineId === l.id ? 'bg-goldsoft' : 'hover:bg-surface2')}>
              <input type="radio" name="manual-line" checked={lineId === l.id} onChange={() => setLineId(l.id)} />
              <span className="num w-[92px] flex-none text-ink2">{fmtDate(l.journal_date)}</span>
              <span className="num w-[110px] flex-none">{l.voucher_no ?? 'Unnumbered'}</span>
              <span className="min-w-0 flex-1 truncate text-ink2" title={l.narration ?? l.description ?? undefined}>{l.narration ?? l.description ?? 'No narration'}</span>
              <Money value={signedOf(l)} currency={baseCcy} sign colored />
            </label>
          ))}
        </div>
      )}
      {same.length > 0 && (
        <Field label="Note (recorded with the match)" className="mt-3.5">
          <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why does this book entry belong to this statement line?" />
        </Field>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ import
type AmountMode = 'signed' | 'split'
type MapKey = 'date' | 'amount' | 'debit' | 'credit' | 'narration' | 'reference' | 'balance'
type Mapping = Record<MapKey, number>
const NONE = -1
const EMPTY_MAP: Mapping = { date: NONE, amount: NONE, debit: NONE, credit: NONE, narration: NONE, reference: NONE, balance: NONE }

const GUESS: Record<MapKey, RegExp> = {
  date: /date/i,
  amount: /^(amount|amt|transaction amount|txn amount)/i,
  debit: /debit|withdraw|\bdr\b/i,
  credit: /credit|deposit|\bcr\b/i,
  narration: /narration|description|particular|detail|remark/i,
  reference: /ref|chq|cheque|utr/i,
  balance: /balance|\bbal\b/i,
}
function guessMapping(header: string[]): Mapping {
  const m: Mapping = { ...EMPTY_MAP }
  const used = new Set<number>()
  for (const k of ['date', 'amount', 'debit', 'credit', 'balance', 'narration', 'reference'] as MapKey[]) {
    const i = header.findIndex((h, idx) => !used.has(idx) && GUESS[k].test(h.trim()))
    if (i >= 0) { m[k] = i; used.add(i) }
  }
  return m
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY. Returns an ISO date or null — never a guess. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim()
  let y = 0, m = 0, d = 0
  const a = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const b = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (a) { y = Number(a[1]); m = Number(a[2]); d = Number(a[3]) }
  else if (b) { d = Number(b[1]); m = Number(b[2]); y = Number(b[3]) }
  else return null
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return null
  if (d > new Date(y, m, 0).getDate()) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

type Cell = { kind: 'empty' } | { kind: 'bad' } | { kind: 'ok'; value: Decimal }
function readNumber(raw: string | undefined): Cell {
  const s = (raw ?? '').replace(/,/g, '').replace(/\s+/g, '')
  if (s === '') return { kind: 'empty' }
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return { kind: 'bad' }
  return { kind: 'ok', value: new Decimal(s) }
}

interface PreviewRow { n: number; rawDate: string; rawAmount: string; date: string | null; amount: Decimal | null; narration: string; reference: string; balance: Decimal | null; problems: string[] }

function buildPreview(body: string[][], map: Mapping, mode: AmountMode, offset: number): PreviewRow[] {
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  return body.map((r, i) => {
    const problems: string[] = []
    const rawDate = at(r, map.date)
    const date = rawDate ? toIsoDate(rawDate) : null
    if (!rawDate) problems.push('date is missing')
    else if (!date) problems.push('date is not valid')

    let amount: Decimal | null = null
    let rawAmount = ''
    if (mode === 'signed') {
      rawAmount = at(r, map.amount)
      const c = readNumber(rawAmount)
      if (c.kind === 'ok') amount = c.value
      else problems.push(c.kind === 'empty' ? 'amount is missing' : 'amount is not a number')
    } else {
      const rawDr = at(r, map.debit), rawCr = at(r, map.credit)
      rawAmount = [rawDr && `Dr ${rawDr}`, rawCr && `Cr ${rawCr}`].filter(Boolean).join(' / ')
      const dr = readNumber(rawDr), cr = readNumber(rawCr)
      if (dr.kind === 'bad' || cr.kind === 'bad') problems.push('amount is not a number')
      else {
        const drv = dr.kind === 'ok' ? dr.value : ZERO
        const crv = cr.kind === 'ok' ? cr.value : ZERO
        if (drv.isNegative() || crv.isNegative()) problems.push('debit and credit columns must not be negative')
        else if (!drv.isZero() && !crv.isZero()) problems.push('both debit and credit are filled')
        else if (dr.kind === 'empty' && cr.kind === 'empty') problems.push('amount is missing')
        else amount = crv.minus(drv)
      }
    }
    if (amount) {
      if (amount.isZero()) { problems.push('amount is zero'); amount = null }
      else if (amount.decimalPlaces() > 2) { problems.push('amount has more than 2 decimal places'); amount = null }
    }

    let balance: Decimal | null = null
    const rawBal = at(r, map.balance)
    if (rawBal) {
      const c = readNumber(rawBal)
      if (c.kind === 'ok') balance = c.value
      else problems.push('balance is not a number')
    }
    return { n: i + 1 + offset, rawDate, rawAmount, date, amount, narration: at(r, map.narration), reference: at(r, map.reference), balance, problems }
  })
}

function ImportTab({ bank, allowed, onDone }: { bank: BankAccount; allowed: boolean; onDone: () => void }) {
  const api = useApp((s) => s.api)!
  const toast = useApp((s) => s.toast)
  const { act, busy } = useAction()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mode, setMode] = useState<AmountMode>('signed')
  const [map, setMap] = useState<Mapping>(EMPTY_MAP)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [result, setResult] = useState<{ imported: number; possible_duplicates: number; rows: number } | null>(null)

  const parsed = useMemo(() => parseCsv(text), [text])
  const width = parsed.reduce((w, r) => Math.max(w, r.length), 0)
  const header = useMemo(() => Array.from({ length: width }, (_, i) => (hasHeader ? parsed[0]?.[i]?.trim() || `Column ${i + 1}` : `Column ${i + 1}`)), [parsed, width, hasHeader])
  const body = useMemo(() => (hasHeader ? parsed.slice(1) : parsed), [parsed, hasHeader])

  const load = (value: string, withHeader = hasHeader) => {
    setText(value)
    setResult(null)
    const rows = parseCsv(value)
    const g = withHeader && rows.length ? guessMapping(rows[0]) : { ...EMPTY_MAP }
    setMap(g)
    setMode(g.amount === NONE && (g.debit !== NONE || g.credit !== NONE) ? 'split' : 'signed')
  }
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => { setFileName(f.name); load(typeof reader.result === 'string' ? reader.result : '') }
    reader.onerror = () => toast('error', 'The file could not be read', f.name)
    reader.readAsText(f)
  }

  const mappingProblems: string[] = []
  if (body.length) {
    if (map.date === NONE) mappingProblems.push('Choose the column that holds the transaction date.')
    if (mode === 'signed' && map.amount === NONE) mappingProblems.push('Choose the column that holds the signed amount.')
    if (mode === 'split' && map.debit === NONE && map.credit === NONE) mappingProblems.push('Choose the withdrawal and / or deposit column.')
  }
  const preview = useMemo(() => buildPreview(body, map, mode, hasHeader ? 1 : 0), [body, map, mode, hasHeader])
  const invalid = preview.filter((r) => r.problems.length > 0)
  const shown = (onlyProblems ? invalid : preview).slice(0, 50)
  const ready = allowed && preview.length > 0 && invalid.length === 0 && mappingProblems.length === 0
  const net = sum(preview.map((r) => r.amount ?? ZERO))

  const doImport = async () => {
    if (!ready) return
    const rows = preview.map((r) => ({
      txn_date: r.date as string, amount: (r.amount as Decimal).toFixed(2),
      narration: r.narration || undefined, reference: r.reference || undefined, running_balance: r.balance ? r.balance.toFixed(2) : undefined,
    }))
    const res = await act(() => api.importBankTransactions(bank.id, rows), (x) => `${x.imported} statement line${x.imported === 1 ? '' : 's'} imported${x.possible_duplicates ? ` · ${x.possible_duplicates} possible duplicate${x.possible_duplicates === 1 ? '' : 's'}` : ''}`)
    if (res) { setResult({ ...res, rows: rows.length }); setText(''); setFileName(null); setMap(EMPTY_MAP) }
  }

  const sample = () => downloadCsv('numero-bank-statement-sample', ['Date', 'Narration', 'Reference', 'Amount', 'Balance'], [
    ['2025-04-01', 'SAMPLE ROW — money received (positive). Replace with your statement line.', 'REF0001', '1000.00', '1000.00'],
    ['02/04/2025', 'SAMPLE ROW — money paid (negative). Replace with your statement line.', 'REF0002', '-250.00', '750.00'],
  ])

  const select = (k: MapKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <select className="field sm" value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })}>
        <option value={NONE}>Not in this file</option>
        {header.map((h, i) => <option key={i} value={i}>{h}</option>)}
      </select>
    </Field>
  )

  if (!allowed) {
    return <Panel><Empty icon={<FileUp size={20} />} title="Import is not available" body='You need the "bank.import" permission for this company to import statement lines.' /></Panel>
  }

  return (
    <div className="space-y-4">
      {result && (
        <Note kind="good">
          <span className="num">{result.rows}</span> row{result.rows === 1 ? '' : 's'} received · <span className="num">{result.imported}</span> imported as new statement lines · <span className="num">{result.possible_duplicates}</span> kept as possible duplicate{result.possible_duplicates === 1 ? '' : 's'} (excluded from the statement balance until reviewed).{' '}
          <button className="link" onClick={onDone}>View statement lines</button>
        </Note>
      )}

      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><div className="eyebrow">Step 1</div><div className="display mt-0.5 text-[15px]">Provide the statement</div></div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn sm ghost" onClick={sample} title="A small file showing the expected layout"><Download size={13} /> Download sample CSV</button>
            <label className="btn sm" title="Choose a .csv file exported from your bank">
              <FileUp size={13} /> Choose .csv file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          </div>
        </div>
        {fileName && <div className="mb-2 text-[12px] text-muted">Loaded from <span className="num text-ink2">{fileName}</span></div>}
        <textarea className="field num text-[12px]" rows={7} value={text} onChange={(e) => { setFileName(null); load(e.target.value) }} placeholder={'Paste CSV text here, e.g.\nDate,Narration,Reference,Amount,Balance'} spellCheck={false} />
        <label className="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink2">
          <input type="checkbox" checked={hasHeader} onChange={(e) => { setHasHeader(e.target.checked); load(text, e.target.checked) }} />
          The first row contains column names
        </label>
      </Panel>

      {body.length > 0 && (
        <Panel className="p-5">
          <div className="mb-3"><div className="eyebrow">Step 2</div><div className="display mt-0.5 text-[15px]">Map the columns</div></div>
          <div className="mb-3.5 flex flex-wrap items-center gap-2" role="group" aria-label="How amounts are laid out">
            {([['signed', 'One signed amount column'], ['split', 'Separate withdrawal and deposit columns']] as [AmountMode, string][]).map(([k, l]) => (
              <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} className={cx('h-[30px] rounded-lg border px-3 text-[12px] font-medium transition-colors', mode === k ? 'border-gold/50 bg-goldsoft text-ink' : 'border-line bg-surface text-muted hover:text-ink2')}>{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {select('date', 'Date', 'YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY')}
            {mode === 'signed'
              ? select('amount', 'Amount (signed)', 'Positive = money received, negative = money paid')
              : <>{select('debit', 'Debit (withdrawal)', 'Money paid out of the account')}{select('credit', 'Credit (deposit)', 'Money received into the account')}</>}
            {select('narration', 'Narration')}
            {select('reference', 'Reference')}
            {select('balance', 'Balance', 'Running balance, if the statement has one')}
          </div>
          {mappingProblems.length > 0 && <Note kind="warn" className="mt-3.5">{mappingProblems.join(' ')}</Note>}
        </Panel>
      )}

      {body.length > 0 && (
        <Panel lit={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <div className="eyebrow">Step 3 · Validation preview</div>
              <div className="mt-1 text-[12.5px] text-ink2">
                <span className="num text-ink">{preview.length.toLocaleString()}</span> row{preview.length === 1 ? '' : 's'} in total ·{' '}
                <span className={cx('num', invalid.length ? 'text-neg' : 'text-pos')}>{invalid.length.toLocaleString()}</span> with problems · net of valid rows <Money value={net} currency={bank.currency} sign />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems</label>
              <button className="btn primary" disabled={!ready || busy} onClick={() => void doImport()}
                title={invalid.length ? 'Correct the rows with problems before importing. Nothing is imported while any row is invalid.' : mappingProblems.length ? mappingProblems[0] : undefined}>
                <Upload size={14} /> Import {preview.length.toLocaleString()} row{preview.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
          <div className="overflow-auto" style={{ maxHeight: 460 }}>
            {shown.length === 0 ? (
              <Empty title="No rows with problems" body="Every row has a valid date and amount." />
            ) : (
              <table className="table">
                <thead><tr><th>Row</th><th>Date</th><th>Narration</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th><th>Check</th></tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const badDate = r.problems.some((p) => p.startsWith('date'))
                    const badAmt = r.problems.some((p) => p.startsWith('amount') || p.startsWith('both') || p.startsWith('debit'))
                    return (
                      <tr key={r.n} className={r.problems.length ? 'bg-negsoft' : undefined}>
                        <td className="num text-muted">{r.n}</td>
                        <td className={cx('num', badDate && 'text-neg')}>{r.date ? fmtDate(r.date) : r.rawDate || '—'}</td>
                        <td><div className="max-w-[320px] truncate" title={r.narration}>{r.narration || <span className="text-muted">—</span>}</div></td>
                        <td className="num text-[12px] text-ink2">{r.reference || '—'}</td>
                        <td className={cx('r', badAmt && 'text-neg')}>{r.amount ? <Money value={r.amount} currency={bank.currency} sign colored /> : <span className="num">{r.rawAmount || '—'}</span>}</td>
                        <td className="r">{r.balance ? <Money value={r.balance} currency={bank.currency} /> : <span className="text-muted">—</span>}</td>
                        <td>{r.problems.length ? <span className="text-[12px] text-neg">{r.problems.join('; ')}</span> : <span className="chip pos">valid</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
            Showing the first <span className="num text-ink2">{shown.length}</span> of <span className="num text-ink2">{(onlyProblems ? invalid.length : preview.length).toLocaleString()}</span> {onlyProblems ? 'rows with problems' : 'rows'}. All <span className="num text-ink2">{preview.length.toLocaleString()}</span> rows are validated and imported together.
          </div>
        </Panel>
      )}

      {text.trim() !== '' && body.length === 0 && <Note kind="warn">No statement rows were found in the text provided.</Note>}
    </div>
  )
}
