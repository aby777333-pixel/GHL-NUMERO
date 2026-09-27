import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, BadgeCheck, Download, HandCoins, Landmark, Link2, PiggyBank, Plus, Receipt, ShieldAlert, ShoppingCart, Sparkles, TrendingUp, UserRoundX, Wallet,
} from 'lucide-react'
import type { AuditEntry, ID, Invoice, LedgerLine, Party, PartyBank, PartyRole, Payment } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv, ledgerLink, openDocuments, sumBase } from '@/lib/data'
import { D, ZERO } from '@/lib/money'
import { daysBetween, fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type TabKey = 'overview' | 'documents' | 'payments' | 'ledger' | 'bank' | 'timeline'
const STATUSES: Party['status'][] = ['active', 'suspended', 'blocked', 'inactive', 'terminated']

const docRoute = (i: Pick<Invoice, 'id' | 'doc_type'>) => (i.doc_type === 'sales_invoice' || i.doc_type === 'credit_note' ? '/invoices/' : '/bills/') + i.id
const DOC_LABEL: Record<Invoice['doc_type'], string> = { sales_invoice: 'Sales invoice', purchase_bill: 'Purchase bill', credit_note: 'Credit note', debit_note: 'Debit note' }
const maskAccount = (no: string) => '•••• ' + no.replace(/\s+/g, '').slice(-4)
const humanise = (s: string) => s.replace(/[_.]/g, ' ')

export default function Party360() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const party = useApp((s) => s.parties).find((p) => p.id === id)
  if (!party) {
    return (
      <div>
        <PageHeader eyebrow="Party 360°" title="Party" />
        <Panel>
          <Empty icon={<UserRoundX size={20} />} title="Party not found or not shared with you"
            body="This party does not exist, or it has no relationship with a company your account can access."
            action={<button className="btn" onClick={() => nav('/parties')}><ArrowLeft size={14} /> Back to People & Parties</button>} />
        </Panel>
      </div>
    )
  }
  return <PartyView key={party.id} party={party} />
}

interface StatementRow { line: LedgerLine; balance: Decimal }
interface DocRow { invoice: Invoice; outstanding: Decimal | null; outstandingBase: Decimal | null; daysOverdue: number | null }

function DrCr({ value, className }: { value: Decimal; className?: string }) {
  if (value.isZero()) return <Money value={ZERO} className={cx('text-muted', className)} />
  return <span className={cx('whitespace-nowrap', className)}><Money value={value.abs()} /> <span className="text-[10.5px] text-muted">{value.gt(0) ? 'Dr' : 'Cr'}</span></span>
}

function PartyView({ party }: { party: Party }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const id = party.id
  const { act, busy } = useAction()

  const [tab, setTab] = useState<TabKey>('overview')
  const [statusOpen, setStatusOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<Party['status']>(party.status)
  const [statusReason, setStatusReason] = useState('')
  const [roleOpen, setRoleOpen] = useState(false)
  const [roleForm, setRoleForm] = useState<{ company_id: ID; type_key: string }>({ company_id: '', type_key: '' })
  const [bankOpen, setBankOpen] = useState(false)
  const [bankForm, setBankForm] = useState({ company_id: '', bank_name: '', account_no: '', account_no_again: '', ifsc: '', beneficiary_name: '' })
  const [decision, setDecision] = useState<{ bank: PartyBank; decision: 'verified' | 'rejected' } | null>(null)

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const companyName = (cid: ID | null) => (cid ? companyById.get(cid)?.name ?? 'Company not shared with you' : '—')
  const scopedCompanies = companies.filter((c) => ids.includes(c.id))

  const types = useAsync(() => api.listPartyTypes(), [api])
  const typeName = (key: string) => types.data?.find((t) => t.key === key)?.name ?? humanise(key)

  const main = useAsync(async () => {
    const [invoices, payments, ledger, balances, banks, audit] = await Promise.all([
      api.listInvoices({ companyIds: ids, partyId: id }),
      api.listPayments({ companyIds: ids, partyId: id }),
      // A party statement is the party's subledger: only receivable, payable, advance and intercompany
      // control accounts. Revenue and expense lines tagged with the party are analysis, not balance.
      api.ledgerLines({ company_ids: ids, party_id: id, account_ids: useApp.getState().accounts.filter((a) => ids.includes(a.company_id) && a.control_type && ['receivable', 'payable', 'advance_paid', 'advance_received', 'intercompany'].includes(a.control_type)).map((a) => a.id), limit: 500 }),
      api.partyLedgerBalances(ids, today()),
      api.listPartyBanks(id),
      // the timeline needs audit access; the rest of the page must still load without it
      api.listAudit({ entity: 'parties', entityId: id, limit: 100 }).then(
        (rows) => ({ rows, error: null as string | null }),
        (e: unknown) => ({ rows: [] as AuditEntry[], error: e instanceof Error ? e.message : String(e) }),
      ),
    ])
    return { invoices, payments, ledger, balances: balances.filter((b) => b.party_id === id), banks: banks.filter((b) => ids.includes(b.company_id)), audit }
  }, [api, idsKey, id])

  const d = main.data

  const facts = useMemo(() => {
    if (!d) return null
    const posted = d.payments.filter((p) => p.status === 'posted')
    const base = (p: Payment) => D(p.amount).times(p.fx_rate)
    const paid = posted.filter((p) => p.direction === 'out').reduce((s, p) => s.plus(base(p)), ZERO)
    const received = posted.filter((p) => p.direction === 'in').reduce((s, p) => s.plus(base(p)), ZERO)
    const docs = openDocuments(d.invoices)
    const receivable = sumBase(docs.filter((x) => x.side === 'in'))
    const payable = sumBase(docs.filter((x) => x.side === 'out'))
    const net = (type: string) => d.balances.filter((b) => b.control_type === type).reduce((s, b) => s.plus(D(b.debit)).minus(D(b.credit)), ZERO)
    const advancePaid = net('advance_paid')
    const advanceReceived = net('advance_received').negated()
    const counted = d.invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
    const sales = counted.filter((i) => i.doc_type === 'sales_invoice').reduce((s, i) => s.plus(D(i.total).times(i.fx_rate)), ZERO)
    const purchases = counted.filter((i) => i.doc_type === 'purchase_bill').reduce((s, i) => s.plus(D(i.total).times(i.fx_rate)), ZERO)
    return { paid, received, receivable, payable, advancePaid, advanceReceived, sales, purchases, openIn: docs.filter((x) => x.side === 'in').length, openOut: docs.filter((x) => x.side === 'out').length }
  }, [d])

  const statement = useMemo(() => {
    if (!d) return null
    const asc = [...d.ledger.rows].sort((a, b) => a.journal_date.localeCompare(b.journal_date) || (a.voucher_no ?? '').localeCompare(b.voucher_no ?? '', undefined, { numeric: true }) || a.line_no - b.line_no)
    const loadedDebit = asc.reduce((s, l) => s.plus(D(l.debit)), ZERO)
    const loadedCredit = asc.reduce((s, l) => s.plus(D(l.credit)), ZERO)
    // entries older than the loaded window are carried in the opening balance
    const opening = D(d.ledger.sum_debit).minus(D(d.ledger.sum_credit)).minus(loadedDebit.minus(loadedCredit))
    let run = opening
    const rows: StatementRow[] = asc.map((line) => { run = run.plus(D(line.debit)).minus(D(line.credit)); return { line, balance: run } })
    return { rows, opening, closing: run, debit: loadedDebit, credit: loadedCredit, earlier: Math.max(0, d.ledger.total - asc.length) }
  }, [d])

  const docRows: DocRow[] = useMemo(() => (d?.invoices ?? []).map((invoice) => {
    const live = invoice.status === 'open' || invoice.status === 'partially_paid' || invoice.status === 'disputed'
    const outstanding = live ? D(invoice.total).minus(D(invoice.amount_settled)) : invoice.status === 'paid' ? ZERO : null
    const over = outstanding && outstanding.gt(0) ? daysBetween(invoice.due_date ?? invoice.doc_date, today()) : null
    return { invoice, outstanding, outstandingBase: outstanding ? outstanding.times(invoice.fx_rate).toDecimalPlaces(2) : null, daysOverdue: over }
  }), [d])

  // ------------------------------------------------------------ permissions
  const mayEdit = party.roles.some((r) => can('party.edit', r.company_id))
  const roleCompanies = scopedCompanies.filter((c) => can('party.create', c.id))
  const bankCompanies = scopedCompanies.filter((c) => can('party.edit', c.id))

  // ------------------------------------------------------------ actions
  const openStatus = () => { setNewStatus(party.status === 'active' ? 'suspended' : 'active'); setStatusReason(''); setStatusOpen(true) }
  const saveStatus = async () => {
    const ok = await act(async () => {
      await api.setPartyStatus(id, newStatus, statusReason.trim())
      await useApp.getState().refreshMaster()
      return true
    }, `Status changed to ${newStatus}`)
    if (ok) setStatusOpen(false)
  }

  const openRole = () => {
    setRoleForm({ company_id: roleCompanies.find((c) => !party.roles.some((r) => r.company_id === c.id))?.id ?? roleCompanies[0]?.id ?? '', type_key: party.roles[0]?.type_key ?? types.data?.[0]?.key ?? '' })
    setRoleOpen(true)
  }
  const roleExists = party.roles.some((r) => r.company_id === roleForm.company_id && r.type_key === roleForm.type_key)
  const saveRole = async () => {
    const ok = await act(async () => {
      await api.addPartyRole(id, roleForm.company_id, roleForm.type_key)
      await useApp.getState().refreshMaster()
      return true
    }, 'Relationship added')
    if (ok) setRoleOpen(false)
  }

  const openBank = () => {
    setBankForm({ company_id: bankCompanies.find((c) => party.roles.some((r) => r.company_id === c.id))?.id ?? bankCompanies[0]?.id ?? '', bank_name: '', account_no: '', account_no_again: '', ifsc: '', beneficiary_name: party.legal_name || party.display_name })
    setBankOpen(true)
  }
  const bankValid = !!bankForm.company_id && !!bankForm.bank_name.trim() && !!bankForm.account_no.trim() && bankForm.account_no.trim() === bankForm.account_no_again.trim() && !!bankForm.beneficiary_name.trim()
  const saveBank = async () => {
    const r = await act(() => api.addPartyBank({
      company_id: bankForm.company_id, party_id: id, bank_name: bankForm.bank_name.trim(), account_no: bankForm.account_no.trim(),
      ifsc: bankForm.ifsc.trim().toUpperCase() || undefined, beneficiary_name: bankForm.beneficiary_name.trim(),
    }), 'Bank details recorded — awaiting independent verification')
    if (r) setBankOpen(false)
  }
  const decide = async (note: string) => {
    if (!decision) return
    const { bank, decision: what } = decision
    setDecision(null)
    await act(() => api.verifyPartyBank(bank.id, what, note || undefined), what === 'verified' ? 'Bank details verified' : 'Bank details rejected')
  }

  const downloadStatement = () => {
    if (!d || !statement) return
    const rows: (string | number | null)[][] = [
      ['', '', '', '', statement.earlier > 0 ? `Opening balance (carries ${statement.earlier} earlier entries)` : 'Opening balance', '', '', statement.opening.toFixed(2)],
      ...statement.rows.map((r) => [r.line.journal_date, r.line.voucher_no ?? '', r.line.company_name, `${r.line.account_code} ${r.line.account_name}`, r.line.narration ?? r.line.description ?? '', D(r.line.debit).toFixed(2), D(r.line.credit).toFixed(2), r.balance.toFixed(2)]),
      ['', '', '', '', 'Closing balance', statement.debit.toFixed(2), statement.credit.toFixed(2), statement.closing.toFixed(2)],
    ]
    if (d.ledger.restricted.count > 0) rows.push(['', '', '', '', `${d.ledger.restricted.count} restricted entries are not included in this statement`, '', '', ''])
    downloadCsv(`statement-${party.party_no}${mode === 'demo' ? '-DEMO' : ''}`, ['Date', 'Voucher', 'Company', 'Account', 'Narration', 'Debit', 'Credit', 'Balance (Dr positive, Cr negative)'], rows)
    useApp.getState().toast('ok', 'Statement ready', `${statement.rows.length.toLocaleString()} entr${statement.rows.length === 1 ? 'y' : 'ies'} exported${mode === 'demo' ? ' (sample data)' : ''}.`)
  }

  // ------------------------------------------------------------ tiles
  const tiles: { key: string; label: string; value: Decimal; icon: ReactNode; sub: string; explain: string; formula?: string; go: () => void; tone?: string }[] = facts ? [
    { key: 'paid', label: 'Total paid', value: facts.paid, icon: <ArrowUpRight size={16} />, sub: 'posted payments made by us', explain: 'Every posted payment made to this party by the selected companies, converted to the base currency at each payment\'s own rate.', formula: 'Σ (amount × exchange rate) of posted payments, direction out', go: () => setTab('payments') },
    { key: 'received', label: 'Total received', value: facts.received, icon: <ArrowDownLeft size={16} />, sub: 'posted receipts from this party', explain: 'Every posted receipt from this party, converted to the base currency at each receipt\'s own rate.', formula: 'Σ (amount × exchange rate) of posted payments, direction in', go: () => setTab('payments') },
    { key: 'ar', label: 'Outstanding receivable', value: facts.receivable, icon: <HandCoins size={16} />, sub: `${facts.openIn} open invoice${facts.openIn === 1 ? '' : 's'}`, explain: 'What this party still owes on open and partly paid sales invoices.', formula: 'Σ (invoice total − amount settled) × exchange rate', go: () => setTab('documents'), tone: facts.receivable.gt(0) ? 'text-pos' : undefined },
    { key: 'ap', label: 'Outstanding payable', value: facts.payable, icon: <Receipt size={16} />, sub: `${facts.openOut} open bill${facts.openOut === 1 ? '' : 's'}`, explain: 'What the selected companies still owe this party on open and partly paid purchase bills.', formula: 'Σ (bill total − amount settled) × exchange rate', go: () => setTab('documents'), tone: facts.payable.gt(0) ? 'text-warn' : undefined },
    { key: 'advp', label: 'Advances paid', value: facts.advancePaid, icon: <Wallet size={16} />, sub: 'held by this party for us', explain: 'The balance on advance-paid control accounts for this party, from posted ledger entries.', formula: 'Debit − Credit on advance-paid control accounts', go: () => nav(ledgerLink({ party: id, to: today() })) },
    { key: 'advr', label: 'Advances received', value: facts.advanceReceived, icon: <PiggyBank size={16} />, sub: 'held by us for this party', explain: 'The balance on advance-received control accounts for this party, from posted ledger entries. The ledger balance (Debit − Credit) is a credit balance; it is shown here as the amount held.', formula: 'Credit − Debit on advance-received control accounts', go: () => nav(ledgerLink({ party: id, to: today() })) },
    { key: 'sales', label: 'Total sales', value: facts.sales, icon: <TrendingUp size={16} />, sub: 'sales invoices raised', explain: 'The total of every sales invoice raised on this party, excluding drafts and cancelled documents.', formula: 'Σ (invoice total × exchange rate)', go: () => setTab('documents') },
    { key: 'purchases', label: 'Total purchases', value: facts.purchases, icon: <ShoppingCart size={16} />, sub: 'purchase bills recorded', explain: 'The total of every purchase bill recorded from this party, excluding drafts and cancelled documents.', formula: 'Σ (bill total × exchange rate)', go: () => setTab('documents') },
  ] : []

  // ------------------------------------------------------------ columns
  const multi = ids.length > 1
  const docColumns: Column<DocRow>[] = [
    { key: 'no', header: 'Document no', render: (r) => <span className="num text-[12.5px] text-gold">{r.invoice.doc_no ?? 'Draft'}</span>, sort: (r) => r.invoice.doc_no ?? '', csv: (r) => r.invoice.doc_no ?? '' },
    { key: 'type', header: 'Type', render: (r) => <span className="text-ink2">{DOC_LABEL[r.invoice.doc_type]}</span>, sort: (r) => r.invoice.doc_type, csv: (r) => DOC_LABEL[r.invoice.doc_type] },
    ...(multi ? [{ key: 'company', header: 'Company', render: (r: DocRow) => <span className="text-ink2">{companyById.get(r.invoice.company_id)?.code ?? '—'}</span>, sort: (r: DocRow) => companyName(r.invoice.company_id), csv: (r: DocRow) => companyName(r.invoice.company_id) }] : []),
    { key: 'date', header: 'Date', render: (r) => <span className="num text-[12.5px]">{fmtDate(r.invoice.doc_date)}</span>, sort: (r) => r.invoice.doc_date, csv: (r) => r.invoice.doc_date },
    { key: 'due', header: 'Due', render: (r) => <span className="num text-[12.5px] text-ink2">{fmtDate(r.invoice.due_date)}</span>, sort: (r) => r.invoice.due_date ?? '', csv: (r) => r.invoice.due_date ?? '' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.invoice.status} />, sort: (r) => r.invoice.status, csv: (r) => r.invoice.status },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <Money value={r.invoice.total} currency={r.invoice.currency} />, sort: (r) => D(r.invoice.total).toNumber(), csv: (r) => D(r.invoice.total).toFixed(2) },
    { key: 'out', header: 'Outstanding', align: 'right', render: (r) => (r.outstanding ? <Money value={r.outstanding} currency={r.invoice.currency} dim /> : <span className="text-muted">—</span>), sort: (r) => r.outstanding?.toNumber() ?? 0, csv: (r) => r.outstanding?.toFixed(2) ?? '' },
    {
      key: 'over', header: 'Days overdue', align: 'right', sort: (r) => r.daysOverdue ?? -99999, csv: (r) => (r.daysOverdue !== null && r.daysOverdue > 0 ? r.daysOverdue : ''),
      render: (r) => (r.daysOverdue === null ? <span className="text-muted">—</span> : r.daysOverdue > 0 ? <span className="num text-neg">{r.daysOverdue}</span> : <span className="text-[12px] text-muted">not due</span>),
    },
  ]

  const payColumns: Column<Payment>[] = [
    { key: 'no', header: 'Payment no', render: (p) => <span className="num text-[12.5px] text-gold">{p.pay_no ?? 'Draft'}</span>, sort: (p) => p.pay_no ?? '', csv: (p) => p.pay_no ?? '' },
    { key: 'date', header: 'Date', render: (p) => <span className="num text-[12.5px]">{fmtDate(p.pay_date)}</span>, sort: (p) => p.pay_date, csv: (p) => p.pay_date },
    { key: 'dir', header: 'Direction', render: (p) => <span className={cx('chip', p.direction === 'in' ? 'pos' : 'cyan')}>{p.direction === 'in' ? 'Received' : 'Paid'}</span>, sort: (p) => p.direction, csv: (p) => (p.direction === 'in' ? 'Received' : 'Paid') },
    ...(multi ? [{ key: 'company', header: 'Company', render: (p: Payment) => <span className="text-ink2">{companyById.get(p.company_id)?.code ?? '—'}</span>, sort: (p: Payment) => companyName(p.company_id), csv: (p: Payment) => companyName(p.company_id) }] : []),
    { key: 'method', header: 'Method', render: (p) => <span className="text-ink2">{humanise(p.method)}</span>, sort: (p) => p.method, csv: (p) => p.method },
    { key: 'ref', header: 'Reference', render: (p) => <span className="text-ink2">{p.reference ?? '—'}</span>, csv: (p) => p.reference ?? '' },
    { key: 'status', header: 'Status', render: (p) => <StatusChip status={p.status} />, sort: (p) => p.status, csv: (p) => p.status },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} currency={p.currency} />, sort: (p) => D(p.amount).toNumber(), csv: (p) => D(p.amount).toFixed(2) },
    { key: 'ccy', header: 'Currency', render: (p) => <span className="num text-[12px] text-muted">{p.currency}</span>, csv: (p) => p.currency },
    { key: 'base', header: 'In base currency', align: 'right', render: (p) => <Money value={D(p.amount).times(p.fx_rate)} />, sort: (p) => D(p.amount).times(p.fx_rate).toNumber(), csv: (p) => D(p.amount).times(p.fx_rate).toFixed(2) },
  ]

  const ledgerColumns: Column<StatementRow>[] = [
    { key: 'date', header: 'Date', width: 112, render: (r) => <span className="num text-[12.5px]">{fmtDate(r.line.journal_date)}</span>, csv: (r) => r.line.journal_date },
    { key: 'voucher', header: 'Voucher', render: (r) => <span className="num text-[12.5px] text-gold">{r.line.voucher_no ?? '—'}</span>, csv: (r) => r.line.voucher_no ?? '' },
    ...(multi ? [{ key: 'company', header: 'Company', render: (r: StatementRow) => <span className="text-ink2">{companyById.get(r.line.company_id)?.code ?? r.line.company_name}</span>, csv: (r: StatementRow) => r.line.company_name }] : []),
    { key: 'account', header: 'Account', render: (r) => <span className="text-ink2"><span className="num text-[11.5px] text-muted">{r.line.account_code}</span> {r.line.account_name}</span>, csv: (r) => `${r.line.account_code} ${r.line.account_name}` },
    { key: 'narration', header: 'Narration', render: (r) => <span className="text-ink2">{r.line.narration ?? r.line.description ?? '—'}</span>, csv: (r) => r.line.narration ?? r.line.description ?? '' },
    { key: 'debit', header: 'Debit', align: 'right', render: (r) => (D(r.line.debit).isZero() ? <span className="text-muted">—</span> : <Money value={r.line.debit} />), csv: (r) => D(r.line.debit).toFixed(2) },
    { key: 'credit', header: 'Credit', align: 'right', render: (r) => (D(r.line.credit).isZero() ? <span className="text-muted">—</span> : <Money value={r.line.credit} />), csv: (r) => D(r.line.credit).toFixed(2) },
    { key: 'balance', header: 'Running balance', align: 'right', render: (r) => <DrCr value={r.balance} />, csv: (r) => r.balance.toFixed(2) },
  ]

  const bankColumns: Column<PartyBank>[] = [
    { key: 'bank', header: 'Bank', render: (b) => <span className="text-ink">{b.bank_name}</span>, sort: (b) => b.bank_name },
    { key: 'ben', header: 'Beneficiary', render: (b) => <span className="text-ink2">{b.beneficiary_name}</span>, sort: (b) => b.beneficiary_name },
    { key: 'acct', header: 'Account', render: (b) => <span className="num text-[12.5px]" title="Only the last four characters are shown">{maskAccount(b.account_no)}</span> },
    { key: 'ifsc', header: 'IFSC', render: (b) => <span className="num text-[12.5px] text-ink2">{b.ifsc ?? '—'}</span> },
    { key: 'company', header: 'Company', render: (b) => <span className="text-ink2">{companyById.get(b.company_id)?.code ?? '—'}</span>, sort: (b) => companyName(b.company_id) },
    { key: 'status', header: 'Status', render: (b) => <StatusChip status={b.status} />, sort: (b) => b.status },
    { key: 'added', header: 'Entered', render: (b) => <span className="num text-[12px] text-ink2">{fmtDateTime(b.created_at)}</span>, sort: (b) => b.created_at },
    { key: 'verified', header: 'Decided', render: (b) => <span className="num text-[12px] text-ink2">{fmtDateTime(b.verified_at)}</span>, sort: (b) => b.verified_at ?? '' },
    {
      key: 'actions', header: '', align: 'right',
      render: (b) => {
        if (b.status !== 'pending_verification') return null
        const ok = can('party.bank.verify', b.company_id)
        const why = ok ? undefined : 'Your role does not include the permission to verify bank details (party.bank.verify).'
        return (
          <span className="flex justify-end gap-1.5">
            <button className="btn sm good" disabled={!ok || busy} title={why ?? 'Confirm these details after checking them independently'} onClick={() => setDecision({ bank: b, decision: 'verified' })}>Verify</button>
            <button className="btn sm danger" disabled={!ok || busy} title={why ?? 'Reject these details'} onClick={() => setDecision({ bank: b, decision: 'rejected' })}>Reject</button>
          </span>
        )
      },
    },
  ]

  const auditRows = useMemo(() => [...(d?.audit.rows ?? [])].sort((a, b) => b.at.localeCompare(a.at)), [d])
  const mayAudit = can('audit.view')
  const auditColumns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', width: 170, render: (a) => <span className="num text-[12.5px]">{fmtDateTime(a.at)}</span>, csv: (a) => a.at },
    { key: 'who', header: 'Who', render: (a) => <span className="text-ink2">{a.actor_name ?? 'System'}</span>, csv: (a) => a.actor_name ?? '' },
    { key: 'action', header: 'Action', render: (a) => <span className="chip">{humanise(a.action)}</span>, csv: (a) => a.action },
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2">{a.company_id ? companyById.get(a.company_id)?.code ?? '—' : 'Group'}</span>, csv: (a) => companyName(a.company_id) },
    { key: 'reason', header: 'Reason', render: (a) => <span className="text-ink2">{a.reason || '—'}</span>, csv: (a) => a.reason ?? '' },
  ]

  const scopedRoles = party.roles.filter((r) => ids.includes(r.company_id))
  const otherRoles = party.roles.length - scopedRoles.length
  const roleColumns: Column<PartyRole>[] = [
    { key: 'company', header: 'Company', render: (r) => <span><span className="num mr-2 rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10.5px] text-gold">{companyById.get(r.company_id)?.code ?? '—'}</span>{companyName(r.company_id)}</span>, sort: (r) => companyName(r.company_id) },
    { key: 'type', header: 'Relationship', render: (r) => <span className="chip">{typeName(r.type_key)}</span>, sort: (r) => typeName(r.type_key) },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} />, sort: (r) => r.status },
    { key: 'days', header: 'Credit days', align: 'right', render: (r) => (r.credit_days === null || r.credit_days === undefined ? <span className="text-muted">—</span> : <span className="num">{r.credit_days}</span>), sort: (r) => r.credit_days ?? -1 },
    { key: 'limit', header: 'Credit limit', align: 'right', render: (r) => (r.credit_limit === null || r.credit_limit === undefined ? <span className="text-muted">No limit set</span> : <Money value={r.credit_limit} currency={companyById.get(r.company_id)?.base_currency} />), sort: (r) => D(r.credit_limit).toNumber() },
    { key: 'terms', header: 'Payment terms', render: (r) => <span className="text-ink2">{r.payment_terms || '—'}</span> },
  ]

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'documents', label: 'Documents', count: d?.invoices.length },
    { key: 'payments', label: 'Payments', count: d?.payments.length },
    { key: 'ledger', label: 'Ledger', count: d?.ledger.total },
    { key: 'bank', label: 'Bank details', count: d?.banks.length },
    { key: 'timeline', label: 'Timeline', count: d ? auditRows.length : undefined },
  ]

  const fact = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-ink">{value || <span className="text-muted">Not recorded</span>}</span>
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Party 360°"
        title={party.display_name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <span className="num text-gold">{party.party_no}</span>
          <span>·</span><span>{party.kind === 'person' ? 'Person' : 'Organization'}</span>
          <StatusChip status={party.status} />
          {mode === 'demo' && <Truth state="DEMO" />}
        </span>}
        actions={<>
          <button className="btn" onClick={openStatus} disabled={!mayEdit} title={mayEdit ? 'Change the status of this party' : 'Your role does not include the permission to change parties (party.edit).'}><ShieldAlert size={14} /> Change status</button>
          <button className="btn" onClick={openRole} disabled={roleCompanies.length === 0 || !types.data?.length} title={roleCompanies.length ? 'Give this party a role in another company' : 'Your role does not include the permission to add party relationships (party.create) in the selected companies.'}><Link2 size={14} /> Add relationship</button>
          <button className="btn" onClick={downloadStatement} disabled={!statement || statement.rows.length === 0} title={statement && statement.rows.length ? 'Download the ledger statement as CSV' : 'There are no ledger entries to download'}><Download size={14} /> Download statement</button>
          <button className="btn primary" onClick={() => useApp.getState().askNumi('Show everything we have paid ' + party.display_name)}><Sparkles size={14} /> Ask NUMI</button>
        </>}
      />

      {party.status !== 'active' && (
        <Note kind="warn" className="mb-4">
          This party is <strong className="text-ink">{party.status}</strong>{party.status_reason ? <> — {party.status_reason}</> : null}. {party.status === 'blocked' ? 'New documents and payments cannot be raised for a blocked party. ' : ''}All history remains available.
        </Note>
      )}

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} label="Loading party" /></Panel>}

      {d && facts && statement && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((t) => (
              <Panel key={t.key} className="p-4" onClick={t.go} title="Click to see the records behind this figure">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-muted"><span className="text-gold">{t.icon}</span><span className="eyebrow truncate">{t.label}</span></div>
                  <Explain title={t.label} text={t.explain} formula={t.formula} inputs={[{ label: t.label, value: t.value }]} source="Source: posted payments, approved documents and posted ledger entries for this party in the selected companies." />
                </div>
                <Money value={t.value} compact className={cx('mt-2.5 block text-[21px] leading-none', t.tone)} />
                <div className="mt-2 text-[11px] text-muted">{t.sub}</div>
              </Panel>
            ))}
          </div>

          {facts.receivable.gt(0) && facts.payable.gt(0) && (
            <Note className="mb-4">
              This party both owes money and is owed money. It owes the selected companies <Money value={facts.receivable} className="text-ink" /> (receivable), and the selected companies owe it <Money value={facts.payable} className="text-ink" /> (payable). The two balances are shown separately: NUMERO never nets unrelated balances automatically.
            </Note>
          )}

          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel className="p-5">
                  <div className="eyebrow mb-2">Contact</div>
                  {fact('Display name', party.display_name)}
                  {fact('Legal name', party.legal_name)}
                  {fact('Email', party.email ? <a className="link" href={`mailto:${party.email}`}>{party.email}</a> : null)}
                  {fact('Phone', party.phone)}
                  {fact('Known since', fmtDate(party.created_at))}
                  {fact('Notes', party.notes)}
                </Panel>
                <Panel className="p-5">
                  <div className="eyebrow mb-2">Tax identifiers</div>
                  {fact('PAN', party.pan ? <span className="num">{party.pan}</span> : null)}
                  {fact('GSTIN', party.gstin ? <span className="num">{party.gstin}</span> : null)}
                  {fact('Party number', <span className="num text-gold">{party.party_no}</span>)}
                  {fact('Kind', party.kind === 'person' ? 'Person' : 'Organization')}
                  {fact('Status', <StatusChip status={party.status} />)}
                  {fact('Status reason', party.status_reason)}
                </Panel>
              </div>
              <Section title="Relationships and credit terms by company">
                <Panel lit={false}>
                  <DataTable columns={roleColumns} rows={scopedRoles} rowKey={(r) => r.id}
                    empty={{ title: 'No relationship in the selected companies', body: 'This party has no role in the companies currently selected.', icon: <Link2 size={20} /> }} />
                </Panel>
                {otherRoles > 0 && <div className="mt-2 text-[11.5px] text-muted">{otherRoles} further relationship{otherRoles === 1 ? '' : 's'} exist{otherRoles === 1 ? 's' : ''} in companies outside the current selection.</div>}
              </Section>
            </div>
          )}

          {tab === 'documents' && (
            <Panel lit={false}>
              <DataTable columns={docColumns} rows={docRows} rowKey={(r) => r.invoice.id} onRow={(r) => nav(docRoute(r.invoice))}
                exportName={`documents-${party.party_no}`} initialSort={{ key: 'date', dir: 'desc' }}
                empty={{ title: 'No invoices or bills', body: 'No document has been recorded for this party in the selected companies.', icon: <Receipt size={20} /> }} />
            </Panel>
          )}

          {tab === 'payments' && (
            <Panel lit={false}>
              <DataTable columns={payColumns} rows={d.payments} rowKey={(p) => p.id} onRow={(p) => nav(p.journal_id ? '/journals/' + p.journal_id : '/payments')}
                exportName={`payments-${party.party_no}`} initialSort={{ key: 'date', dir: 'desc' }}
                empty={{ title: 'No payments or receipts', body: 'No money has moved between this party and the selected companies.', icon: <Wallet size={20} /> }} />
            </Panel>
          )}

          {tab === 'ledger' && (
            <div className="space-y-3">
              {d.ledger.restricted.count > 0 && (
                <Note kind="warn">
                  {d.ledger.restricted.count} entr{d.ledger.restricted.count === 1 ? 'y' : 'ies'} totalling <Money value={d.ledger.restricted.debit} className="text-ink" /> debit and <Money value={d.ledger.restricted.credit} className="text-ink" /> credit relate to restricted transactions your account is not authorised to view. They are part of the books but are not included in the statement below.
                </Note>
              )}
              {statement.earlier > 0 && (
                <Note>
                  The statement shows the latest {statement.rows.length.toLocaleString()} of {d.ledger.total.toLocaleString()} entries. The {statement.earlier.toLocaleString()} earlier entr{statement.earlier === 1 ? 'y is' : 'ies are'} carried in the opening balance. <button className="link" onClick={() => nav(ledgerLink({ party: id }))}>Open the full ledger</button>
                </Note>
              )}
              <Panel lit={false}>
                <DataTable columns={ledgerColumns} rows={statement.rows} rowKey={(r) => r.line.id} onRow={(r) => nav('/journals/' + r.line.journal_id)} pageSize={100}
                  toolbar={<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink2">
                    <span>Opening balance <DrCr value={statement.opening} className="ml-1 text-ink" /></span>
                    <span>Closing balance <DrCr value={statement.closing} className="ml-1 text-ink" /></span>
                    <button className="btn sm ghost" onClick={() => nav(ledgerLink({ party: id }))}>Open in general ledger</button>
                    <button className="btn sm ghost" onClick={downloadStatement} disabled={statement.rows.length === 0}><Download size={13} /> Download statement</button>
                  </div>}
                  footer={<tr>
                    <td colSpan={multi ? 5 : 4} className="border-t border-line2 px-[14px] py-[10px] text-[12.5px] font-medium text-ink2">Totals of the loaded entries</td>
                    <td className="r border-t border-line2 px-[14px] py-[10px]"><Money value={statement.debit} /></td>
                    <td className="r border-t border-line2 px-[14px] py-[10px]"><Money value={statement.credit} /></td>
                    <td className="r border-t border-line2 px-[14px] py-[10px]"><DrCr value={statement.closing} /></td>
                  </tr>}
                  empty={{ title: 'No ledger entries', body: 'No posted accounting entry carries this party in the selected companies.', icon: <BadgeCheck size={20} /> }} />
              </Panel>
            </div>
          )}

          {tab === 'bank' && (
            <div className="space-y-3">
              <Note kind="warn">
                <strong className="text-ink">BANK DETAIL CHANGE PROTECTION</strong> — new bank details cannot be used for payments until a second person verifies them. Earlier details are kept in history.
              </Note>
              <Panel lit={false}>
                <DataTable columns={bankColumns} rows={d.banks} rowKey={(b) => b.id} initialSort={{ key: 'added', dir: 'desc' }}
                  toolbar={<button className="btn sm" onClick={openBank} disabled={bankCompanies.length === 0} title={bankCompanies.length ? 'Record new bank details for this party' : 'Your role does not include the permission to change party bank details (party.edit).'}><Plus size={13} /> Add bank details</button>}
                  empty={{ title: 'No bank details recorded', body: 'Bank details entered here must be verified by a second person before any payment can use them.', icon: <Landmark size={20} /> }} />
              </Panel>
            </div>
          )}

          {tab === 'timeline' && (
            <div className="space-y-3">
              {d.audit.error && <Note kind="warn">The timeline could not be loaded for your account: {d.audit.error}</Note>}
              <Panel lit={false}>
                <DataTable columns={auditColumns} rows={auditRows} rowKey={(a) => String(a.id)}
                  onRow={mayAudit ? () => nav(`/audit?entity=parties&record=${encodeURIComponent(id)}`) : undefined}
                  empty={{ title: 'No recorded changes', body: 'Changes to this party record appear here, newest first. Entries are never edited or deleted.', icon: <BadgeCheck size={20} /> }} />
              </Panel>
            </div>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- change status */}
      <Modal open={statusOpen} onClose={() => setStatusOpen(false)} title="Change party status" subtitle={`${party.display_name} · currently ${party.status}`} width={520}
        footer={<>
          <button className="btn ghost" onClick={() => setStatusOpen(false)} disabled={busy}>Cancel</button>
          <button className={cx('btn', newStatus === 'active' ? 'primary' : 'danger')} onClick={saveStatus} disabled={busy || !statusReason.trim() || newStatus === party.status}>Change status</button>
        </>}>
        <Note className="mb-4">
          History is never deleted. Changing the status keeps every document, payment and ledger entry of this party exactly as recorded. Blocked parties cannot receive new documents or payments.
        </Note>
        <Field label="New status" className="mb-3.5" hint={newStatus === party.status ? 'This is the current status' : undefined}>
          <select className="field" value={newStatus} onChange={(e) => setNewStatus(e.target.value as Party['status'])}>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}{s === party.status ? ' (current)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Reason (required — recorded in the audit trail)">
          <textarea className="field" rows={3} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="Why is the status being changed?" />
        </Field>
      </Modal>

      {/* ---------------------------------------------------------- add relationship */}
      <Modal open={roleOpen} onClose={() => setRoleOpen(false)} title="Add relationship" subtitle={`Give ${party.display_name} a role in a company. The party keeps one identity across the group.`} width={520}
        footer={<>
          <button className="btn ghost" onClick={() => setRoleOpen(false)} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={saveRole} disabled={busy || !roleForm.company_id || !roleForm.type_key || roleExists}>Add relationship</button>
        </>}>
        <div className="grid gap-3.5">
          <Field label="Company">
            <select className="field" value={roleForm.company_id} onChange={(e) => setRoleForm((f) => ({ ...f, company_id: e.target.value }))}>
              {roleCompanies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Relationship" hint={roleExists ? 'This party already has this relationship with the chosen company' : undefined}>
            <select className="field" value={roleForm.type_key} onChange={(e) => setRoleForm((f) => ({ ...f, type_key: e.target.value }))}>
              {(types.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- add bank details */}
      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Add bank details" subtitle={party.display_name} width={600}
        footer={<>
          <button className="btn ghost" onClick={() => setBankOpen(false)} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={saveBank} disabled={busy || !bankValid}>Record for verification</button>
        </>}>
        <Note kind="warn" className="mb-4">These details cannot be used for payments until a second person verifies them. Confirm them with the party through a channel you already trust.</Note>
        <div className="grid gap-3.5 md:grid-cols-2">
          <Field label="Company" className="md:col-span-2">
            <select className="field" value={bankForm.company_id} onChange={(e) => setBankForm((f) => ({ ...f, company_id: e.target.value }))}>
              {bankCompanies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Bank name">
            <input className="field" value={bankForm.bank_name} onChange={(e) => setBankForm((f) => ({ ...f, bank_name: e.target.value }))} />
          </Field>
          <Field label="IFSC">
            <input className="field num" value={bankForm.ifsc} onChange={(e) => setBankForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} maxLength={11} />
          </Field>
          <Field label="Account number">
            <input className="field num" autoComplete="off" value={bankForm.account_no} onChange={(e) => setBankForm((f) => ({ ...f, account_no: e.target.value }))} />
          </Field>
          <Field label="Account number, again" hint={bankForm.account_no_again && bankForm.account_no.trim() !== bankForm.account_no_again.trim() ? 'The two account numbers do not match' : undefined}>
            <input className="field num" autoComplete="off" value={bankForm.account_no_again} onChange={(e) => setBankForm((f) => ({ ...f, account_no_again: e.target.value }))} />
          </Field>
          <Field label="Beneficiary name" className="md:col-span-2">
            <input className="field" value={bankForm.beneficiary_name} onChange={(e) => setBankForm((f) => ({ ...f, beneficiary_name: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <ReasonDialog
        open={!!decision}
        title={decision?.decision === 'verified' ? 'Verify bank details' : 'Reject bank details'}
        confirm={decision?.decision === 'verified' ? 'Verify' : 'Reject'}
        danger={decision?.decision === 'rejected'}
        required={false}
        onCancel={() => setDecision(null)}
        onConfirm={decide}
        body={decision && (
          <>
            {decision.bank.bank_name} · account {maskAccount(decision.bank.account_no)} · beneficiary {decision.bank.beneficiary_name}.{' '}
            {decision.decision === 'verified'
              ? 'Verifying allows payments to use these details and supersedes any earlier verified details, which stay in history. The person who entered the details cannot verify them.'
              : 'Rejected details can never be used for payments. The record stays in history.'}
          </>
        )}
      />
    </div>
  )
}
