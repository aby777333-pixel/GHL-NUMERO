import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { BadgeCheck, Globe2, Landmark, Lock, Pencil, PiggyBank, Plus, Save, ShieldCheck, Wallet } from 'lucide-react'
import type { Account, Confidentiality, ID } from '@/engine/types'
import type { FixedDeposit, FixedDepositInput, Loan, LoanInput, RegisterItem } from '@/engine/opsTypes'
import { debtLadder, loanPosition } from '@/engine/ops'
import { CERTAINTY_MEANING } from '@/engine/forward'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink, openDocuments, type OpenDoc } from '@/lib/data'
import { D, ZERO, sum } from '@/lib/money'
import { addMonths, daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { Attachments, ProposedEntries, ProposedNote, Stat, useAccountName, useCompanyName, useMoneyLedgers, usePartyName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart } from '@/ui/charts'

// =====================================================================
// Treasury command centre (spec 552-560, 617, 1253).
// Every action here PROPOSES an accounting entry; nothing reaches the
// ledger until a second person approves it. NUMERO never moves money.
// =====================================================================

type TabKey = 'position' | 'deposits' | 'loans' | 'facilities' | 'forex'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'position', label: 'Position' }, { key: 'deposits', label: 'Deposits' }, { key: 'loans', label: 'Loans' },
  { key: 'facilities', label: 'Facilities and guarantees' }, { key: 'forex', label: 'Forex exposure' },
]

export const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
export const REPAYMENT_LABEL: Record<Loan['repayment'], string> = { emi: 'Equal instalments', equal_principal: 'Equal principal', bullet: 'Bullet — principal at the end' }
export const DIRECTION_LABEL: Record<Loan['direction'], string> = { borrowed: 'Loan taken', lent: 'Loan given' }
export const LOAN_KINDS: [string, string][] = [
  ['term_loan', 'Term loan'], ['working_capital', 'Working capital loan'], ['vehicle_loan', 'Vehicle loan'], ['equipment_loan', 'Equipment loan'],
  ['director_loan', 'Loan from or to a director'], ['shareholder_loan', 'Loan from or to a shareholder'], ['intercompany_loan', 'Intercompany loan'], ['employee_loan', 'Loan to an employee'], ['other', 'Other'],
]
const COMPOUNDING: Record<FixedDeposit['compounding'], string> = { simple: 'Simple interest', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' }
const FACILITY_KINDS = ['credit_facility', 'bank_guarantee', 'corporate_guarantee', 'letter_of_credit', 'covenant']
const FACILITY_LABEL: Record<string, string> = { credit_facility: 'Credit facility', bank_guarantee: 'Bank guarantee', corporate_guarantee: 'Corporate guarantee', letter_of_credit: 'Letter of credit', covenant: 'Loan covenant' }
const FACILITY_DATES: [string, string][] = [['expiry', 'Expiry'], ['claim_expiry', 'Claim expiry'], ['review_date', 'Review'], ['settlement_date', 'Settlement'], ['test_date', 'Next test']]

const foot = 'border-t border-line2 px-[14px] py-[10px]'
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const pct = (v: Decimal.Value) => D(v).toDecimalPlaces(4).toString() + '%'
const human = (s: string) => s.replace(/_/g, ' ')

/** "in 12 days", "today", "4 days ago" — relative to the given date. */
export const whenText = (date: string | null | undefined, asOf: string) => {
  if (!date) return ''
  const n = daysBetween(asOf, date)
  return n === 0 ? 'today' : n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : `${-n} day${n === -1 ? '' : 's'} ago`
}

export const Contracted = ({ label = 'CONTRACTED' }: { label?: string }) => <span className="chip cyan" title={CERTAINTY_MEANING.CONTRACTED}>{label}</span>

export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 break-words text-[13px] text-ink">{children}</div>
    </div>
  )
}

const postingLedgers = (accounts: Account[], companyId: ID, types: Account['type'][], first: string[]) =>
  accounts
    .filter((a) => a.company_id === companyId && !a.is_group && a.is_active && !a.control_type && types.includes(a.type))
    .sort((a, b) => Number(first.includes(b.subtype)) - Number(first.includes(a.subtype)) || a.code.localeCompare(b.code))

function useCompanyChoices(ids: ID[]) {
  const companies = useApp((s) => s.companies)
  return useMemo(() => companies.filter((c) => c.status === 'active' && ids.includes(c.id)), [companies, ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Treasury() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('treasury.view', id))
  if (!ids.length) {
    return (
      <div>
        <PageHeader eyebrow="Treasury" title="Treasury command centre" />
        <Panel>
          <Empty icon={<Lock size={20} />} title="You do not have access to Treasury"
            body={<>This page needs the permission <span className="num text-ink2">treasury.view</span> in at least one of the selected companies. A group administrator can grant it under Team.</>} />
        </Panel>
      </div>
    )
  }
  return <TreasuryView ids={ids} />
}

interface CashRow { account: Account; balance: Decimal }
interface LadderRow { key: string; sign: string; line: string; basis: 'ACTUAL' | 'CONTRACTED' | 'CALCULATED'; d30: Decimal; d90: Decimal; strong?: boolean }
interface ForexRow { key: string; currency: string; base: string; count: number; receivable: Decimal; payable: Decimal; receivableBase: Decimal; payableBase: Decimal }

function TreasuryView({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const currency = useCurrency()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const idsKey = ids.join(',')
  const asOf = today()

  const depositId = sp.get('deposit')
  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? (depositId ? 'deposits' : 'position')
  const go = (next: Record<string, string>) => setSp(next, { replace: true })

  const [newDeposit, setNewDeposit] = useState(false)
  const [editDeposit, setEditDeposit] = useState<FixedDeposit | null>(null)
  const [newLoan, setNewLoan] = useState(false)
  const [addKind, setAddKind] = useState(FACILITY_KINDS[0])
  const [forexCurrency, setForexCurrency] = useState<string | null>(null)

  const main = useAsync(async () => {
    const [balances, deposits, loans, schedule] = await Promise.all([
      api.ledgerBalances(ids, '1990-01-01', asOf), api.listFixedDeposits(ids), api.listLoans(ids), api.listLoanSchedule({ companyIds: ids }),
    ])
    return { balances, deposits, loans, schedule }
  }, [api, idsKey, asOf])

  const registerIds = ids.filter((id) => can('register.view', id))
  const registerKey = registerIds.join(',')
  const registers = useAsync(async () => (registerIds.length ? api.listRegisterItems({ companyIds: registerIds, kinds: FACILITY_KINDS }) : []), [api, registerKey])
  const invoices = useAsync(async () => (tab === 'forex' ? api.listInvoices({ companyIds: ids }) : null), [api, idsKey, tab === 'forex'])

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const ccyOf = (companyId: ID) => companyById.get(companyId)?.base_currency ?? currency
  const mixedCurrencies = new Set(ids.map(ccyOf)).size > 1
  const manageIds = ids.filter((id) => can('treasury.manage', id))
  const noManage = manageIds.length ? undefined : 'You need the permission treasury.manage to record this'

  const d = main.data
  const cashRows: CashRow[] = useMemo(() => {
    const bal = new Map<ID, Decimal>()
    for (const r of d?.balances ?? []) bal.set(r.account_id, (bal.get(r.account_id) ?? ZERO).plus(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit))
    return accounts
      .filter((a) => ids.includes(a.company_id) && (a.subtype === 'cash' || a.subtype === 'bank') && !a.is_group)
      .map((a) => ({ account: a, balance: bal.get(a.id) ?? ZERO }))
      .filter((r) => r.account.is_active || !r.balance.isZero())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, accounts, idsKey])

  const deposits = d?.deposits ?? []
  const loans = d?.loans ?? []
  const schedule = d?.schedule ?? []
  const positions = useMemo(() => new Map(loans.map((l) => [l.id, loanPosition(l, schedule, asOf)])), [loans, schedule, asOf])

  const cash = sum(cashRows.map((r) => r.balance))
  const activeDeposits = deposits.filter((x) => x.status === 'active')
  const depositsTotal = sum(activeDeposits.map((x) => x.principal))
  const borrowed = loans.filter((l) => l.status === 'active' && l.direction === 'borrowed')
  const borrowings = sum(borrowed.map((l) => positions.get(l.id)?.outstanding ?? ZERO))
  const due30 = sum(borrowed.map((l) => positions.get(l.id)?.dueIn30 ?? ZERO))
  const due90 = sum(borrowed.map((l) => positions.get(l.id)?.dueIn90 ?? ZERO))
  const overdueTotal = sum(borrowed.map((l) => positions.get(l.id)?.overdueAmount ?? ZERO))
  const freeDeposits = activeDeposits.filter((x) => !x.lien_marked && !x.auto_renew)
  const maturing = (days: number) => freeDeposits.filter((x) => daysBetween(asOf, x.maturity_date) <= days)
  const underLien = activeDeposits.filter((x) => x.lien_marked)
  const renewing = activeDeposits.filter((x) => x.auto_renew && !x.lien_marked && daysBetween(asOf, x.maturity_date) <= 90)
  const guarantees = (registers.data ?? []).filter((r) => (r.kind === 'bank_guarantee' || r.kind === 'corporate_guarantee') && r.status === 'active')
  const guaranteeTotal = sum(guarantees.map((r) => r.amount))

  const m30 = sum(maturing(30).map((x) => x.maturity_amount)), m90 = sum(maturing(90).map((x) => x.maturity_amount))
  const ladder: LadderRow[] = [
    { key: 'cash', sign: '', line: 'Cash and bank now', basis: 'ACTUAL', d30: cash, d90: cash },
    { key: 'fd', sign: '+', line: 'Deposits maturing, free of lien and not renewing automatically', basis: 'CONTRACTED', d30: m30, d90: m90 },
    { key: 'loan', sign: '−', line: 'Loan instalments due, including any already overdue', basis: 'CONTRACTED', d30: due30, d90: due90 },
    { key: 'net', sign: '=', line: 'Liquidity after the period', basis: 'CALCULATED', d30: cash.plus(m30).minus(due30), d90: cash.plus(m90).minus(due90), strong: true },
  ]

  const selectedDeposit = depositId ? deposits.find((x) => x.id === depositId) ?? null : null

  // ---------------------------------------------------------------- columns
  const cashColumns: Column<CashRow>[] = [
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={companyName(r.account.company_id)}>{companyById.get(r.account.company_id)?.code ?? '—'}</span>, sort: (r) => companyName(r.account.company_id), csv: (r) => companyName(r.account.company_id) },
    { key: 'ledger', header: 'Ledger', render: (r) => <span><span className="num text-gold">{r.account.code}</span> <span className="text-ink">· {r.account.name}</span></span>, sort: (r) => r.account.code, csv: (r) => `${r.account.code} ${r.account.name}` },
    { key: 'kind', header: 'Kind', render: (r) => <span className="chip">{r.account.subtype}</span>, sort: (r) => r.account.subtype, csv: (r) => r.account.subtype },
    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <Money value={r.balance} currency={ccyOf(r.account.company_id)} className={r.balance.isNegative() ? 'text-neg' : 'text-ink'} />, sort: (r) => r.balance.toNumber(), csv: (r) => r.balance.toFixed(2) },
    { key: 'open', header: 'Ledger entries', align: 'right', render: (r) => <button className="link text-[12.5px]" onClick={(e) => { e.stopPropagation(); nav(ledgerLink({ accounts: [r.account.id] })) }}>Open the ledger</button> },
  ]

  const ladderColumns: Column<LadderRow>[] = [
    { key: 'line', header: 'Line', render: (r) => <span className={cx(r.strong ? 'font-medium text-ink' : 'text-ink2')}><span className="num mr-2 inline-block w-3 text-gold">{r.sign}</span>{r.line}</span>, csv: (r) => `${r.sign} ${r.line}`.trim() },
    { key: 'basis', header: 'Basis', render: (r) => (r.basis === 'ACTUAL' ? <Truth state="ACTUAL" /> : r.basis === 'CONTRACTED' ? <Contracted /> : <span className="chip" title="Calculated from the lines above">CALCULATED</span>), csv: (r) => r.basis },
    { key: 'd30', header: 'Within 30 days', align: 'right', render: (r) => <Money value={r.d30} className={cx(r.strong && 'font-medium', r.strong && (r.d30.isNegative() ? 'text-neg' : 'text-ink'))} />, csv: (r) => r.d30.toFixed(2) },
    { key: 'd90', header: 'Within 90 days', align: 'right', render: (r) => <Money value={r.d90} className={cx(r.strong && 'font-medium', r.strong && (r.d90.isNegative() ? 'text-neg' : 'text-ink'))} />, csv: (r) => r.d90.toFixed(2) },
  ]

  const depositColumns: Column<FixedDeposit>[] = [
    { key: 'no', header: 'Number', render: (x) => <span className="num text-[12.5px] text-gold">{x.fd_no}</span>, sort: (x) => x.fd_no, csv: (x) => x.fd_no },
    { key: 'company', header: 'Company', render: (x) => <span className="text-ink2" title={companyName(x.company_id)}>{companyById.get(x.company_id)?.code ?? '—'}</span>, sort: (x) => companyName(x.company_id), csv: (x) => companyName(x.company_id) },
    { key: 'bank', header: 'Bank', render: (x) => <span className="text-ink">{x.bank_name}</span>, sort: (x) => x.bank_name.toLowerCase(), csv: (x) => x.bank_name },
    { key: 'ref', header: 'Reference', render: (x) => <span className="num text-[12.5px] text-ink2">{x.reference ?? '—'}</span>, sort: (x) => x.reference ?? '', csv: (x) => x.reference ?? '' },
    { key: 'principal', header: 'Principal', align: 'right', render: (x) => <Money value={x.principal} currency={x.currency} />, sort: (x) => D(x.principal).toNumber(), csv: (x) => D(x.principal).toFixed(2) },
    { key: 'rate', header: 'Rate', align: 'right', render: (x) => <span className="num">{pct(x.rate_pct)}</span>, sort: (x) => D(x.rate_pct).toNumber(), csv: (x) => D(x.rate_pct).toString() },
    { key: 'comp', header: 'Compounding', render: (x) => <span className="text-[12.5px] text-ink2">{COMPOUNDING[x.compounding]}</span>, sort: (x) => x.compounding, csv: (x) => COMPOUNDING[x.compounding] },
    { key: 'start', header: 'Start', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.start_date)}</span>, sort: (x) => x.start_date, csv: (x) => x.start_date },
    {
      key: 'maturity', header: 'Maturity', sort: (x) => x.maturity_date, csv: (x) => x.maturity_date,
      render: (x) => {
        const n = daysBetween(asOf, x.maturity_date)
        return <div><div className="num text-[12.5px]">{fmtDate(x.maturity_date)}</div>{x.status === 'active' && <div className={cx('text-[11px]', n < 0 ? 'text-neg' : n <= 30 ? 'text-warn' : 'text-muted')}>{n < 0 ? `matured ${whenText(x.maturity_date, asOf)} — closure not recorded` : `matures ${whenText(x.maturity_date, asOf)}`}</div>}</div>
      },
    },
    { key: 'value', header: 'Maturity value (calculated, not confirmed by the bank)', align: 'right', render: (x) => <span title="Calculated, not confirmed by the bank"><Money value={x.maturity_amount} currency={x.currency} className="text-ink2" /></span>, sort: (x) => D(x.maturity_amount).toNumber(), csv: (x) => D(x.maturity_amount).toFixed(2) },
    { key: 'lien', header: 'Lien', render: (x) => (x.lien_marked ? <span className="chip warn" title={x.lien_note ?? 'No note recorded'}>under lien</span> : <span className="text-muted">—</span>), sort: (x) => Number(x.lien_marked), csv: (x) => (x.lien_marked ? `Under lien: ${x.lien_note ?? ''}` : 'No') },
    { key: 'renew', header: 'Auto-renew', render: (x) => (x.auto_renew ? <span className="chip cyan">renews</span> : <span className="text-muted">no</span>), sort: (x) => Number(x.auto_renew), csv: (x) => (x.auto_renew ? 'Yes' : 'No') },
    { key: 'status', header: 'Status', render: (x) => <StatusChip status={x.status} label={x.status === 'draft' ? 'draft — not placed' : undefined} />, sort: (x) => x.status, csv: (x) => x.status },
  ]

  const loanColumns: Column<Loan>[] = [
    { key: 'no', header: 'Number', render: (l) => <span className="num text-[12.5px] text-gold">{l.loan_no}</span>, sort: (l) => l.loan_no, csv: (l) => l.loan_no },
    { key: 'name', header: 'Name', render: (l) => <div className="min-w-0"><div className="truncate text-ink">{l.name}</div><div className="text-[11px] text-muted">{companyById.get(l.company_id)?.code ?? ''} · {human(l.kind)}</div></div>, sort: (l) => l.name.toLowerCase(), csv: (l) => l.name },
    { key: 'dir', header: 'Direction', render: (l) => <span className={cx('chip', l.direction === 'borrowed' ? 'warn' : 'cyan')}>{DIRECTION_LABEL[l.direction]}</span>, sort: (l) => l.direction, csv: (l) => DIRECTION_LABEL[l.direction] },
    { key: 'party', header: 'Lender or borrower', render: (l) => <span className="text-ink2">{partyName(l.party_id)}</span>, sort: (l) => partyName(l.party_id).toLowerCase(), csv: (l) => partyName(l.party_id) },
    { key: 'principal', header: 'Principal', align: 'right', render: (l) => <Money value={l.principal} currency={l.currency} />, sort: (l) => D(l.principal).toNumber(), csv: (l) => D(l.principal).toFixed(2) },
    { key: 'rate', header: 'Rate', align: 'right', render: (l) => <span className="num" title={l.rate_type === 'floating' ? 'Floating rate: scheduled interest is indicative' : 'Fixed rate'}>{pct(l.rate_pct)}{l.rate_type === 'floating' ? ' fl.' : ''}</span>, sort: (l) => D(l.rate_pct).toNumber(), csv: (l) => `${D(l.rate_pct).toString()} ${l.rate_type}` },
    { key: 'tenure', header: 'Tenure', align: 'right', render: (l) => <span className="num">{l.tenure_months} mo</span>, sort: (l) => l.tenure_months, csv: (l) => l.tenure_months },
    { key: 'out', header: 'Outstanding', align: 'right', render: (l) => <Money value={positions.get(l.id)?.outstanding ?? ZERO} currency={l.currency} className="text-ink" />, sort: (l) => (positions.get(l.id)?.outstanding ?? ZERO).toNumber(), csv: (l) => (positions.get(l.id)?.outstanding ?? ZERO).toFixed(2) },
    {
      key: 'next', header: 'Next instalment', sort: (l) => positions.get(l.id)?.next?.due_date ?? '9999', csv: (l) => { const n = positions.get(l.id)?.next; return n ? `${n.due_date} ${D(n.total).toFixed(2)}` : '' },
      render: (l) => { const n = positions.get(l.id)?.next; return n ? <div><div className="num text-[12.5px]">{fmtDate(n.due_date)}</div><Money value={n.total} currency={l.currency} className="text-[11.5px] text-ink2" /></div> : <span className="text-muted">—</span> },
    },
    { key: 'overdue', header: 'Overdue', align: 'right', render: (l) => { const v = positions.get(l.id)?.overdueAmount ?? ZERO; return v.gt(0) && l.status === 'active' ? <Money value={v} currency={l.currency} className="text-neg" /> : <span className="text-muted">—</span> }, sort: (l) => (positions.get(l.id)?.overdueAmount ?? ZERO).toNumber(), csv: (l) => (l.status === 'active' ? (positions.get(l.id)?.overdueAmount ?? ZERO).toFixed(2) : '0.00') },
    { key: 'status', header: 'Status', render: (l) => <StatusChip status={l.status} label={l.status === 'draft' ? 'draft — not disbursed' : undefined} />, sort: (l) => l.status, csv: (l) => l.status },
  ]

  const bands = useMemo(() => debtLadder(loans, schedule, asOf), [loans, schedule, asOf])
  type Band = (typeof bands)[number]
  const bandColumns: Column<Band>[] = [
    { key: 'band', header: 'Falls due', render: (b) => <span className={cx(b.label === 'Overdue' && b.instalments > 0 ? 'text-neg' : 'text-ink')}>{b.label}</span>, csv: (b) => b.label },
    { key: 'n', header: 'Instalments', align: 'right', render: (b) => <span className="num">{b.instalments}</span>, csv: (b) => b.instalments },
    { key: 'principal', header: 'Principal', align: 'right', render: (b) => <Money value={b.principal} dim />, csv: (b) => b.principal.toFixed(2) },
    { key: 'interest', header: 'Interest per schedule', align: 'right', render: (b) => <Money value={b.interest} dim />, csv: (b) => b.interest.toFixed(2) },
    { key: 'total', header: 'Total', align: 'right', render: (b) => <Money value={b.principal.plus(b.interest)} dim className="text-ink" />, csv: (b) => b.principal.plus(b.interest).toFixed(2) },
  ]

  const amountOf = (v: unknown): Decimal | null => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? D(v) : null)
  const datesOf = (r: RegisterItem) => FACILITY_DATES.flatMap(([k, label]) => { const v = r.data[k]; return typeof v === 'string' && v ? [{ label, date: v.slice(0, 10) }] : [] })
  const facilityColumns: Column<RegisterItem>[] = [
    { key: 'ref', header: 'Reference', render: (r) => <span className="num text-[12.5px] text-gold">{r.ref_no}</span>, sort: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: 'kind', header: 'Kind', render: (r) => <span className="chip">{FACILITY_LABEL[r.kind] ?? human(r.kind)}</span>, sort: (r) => r.kind, csv: (r) => FACILITY_LABEL[r.kind] ?? r.kind },
    { key: 'title', header: 'Title', render: (r) => <div className="min-w-0"><div className="truncate text-ink">{r.title}</div><div className="text-[11px] text-muted">{companyById.get(r.company_id)?.code ?? ''}</div></div>, sort: (r) => r.title.toLowerCase(), csv: (r) => r.title },
    { key: 'party', header: 'Party', render: (r) => <span className="text-ink2">{partyName(r.party_id)}</span>, sort: (r) => partyName(r.party_id).toLowerCase(), csv: (r) => partyName(r.party_id) },
    {
      key: 'amount', header: 'Amount or sanctioned limit', align: 'right', sort: (r) => (amountOf(r.data.sanctioned_limit) ?? D(r.amount)).toNumber(), csv: (r) => (amountOf(r.data.sanctioned_limit) ?? D(r.amount)).toFixed(2),
      render: (r) => { const limit = amountOf(r.data.sanctioned_limit); return limit ? <span title="Sanctioned limit"><Money value={limit} currency={r.currency} /></span> : D(r.amount).isZero() ? <span className="text-muted">—</span> : <Money value={r.amount} currency={r.currency} /> },
    },
    {
      key: 'drawn', header: 'Drawn (as last updated)', align: 'right', sort: (r) => (amountOf(r.data.drawn) ?? ZERO).toNumber(), csv: (r) => amountOf(r.data.drawn)?.toFixed(2) ?? '',
      render: (r) => { const v = amountOf(r.data.drawn); return v ? <Money value={v} currency={r.currency} className="text-ink2" /> : <span className="text-muted">—</span> },
    },
    {
      key: 'date', header: 'Expiry, review or test date', sort: (r) => datesOf(r).map((x) => x.date).sort()[0] ?? '9999', csv: (r) => datesOf(r).map((x) => `${x.label} ${x.date}`).join('; '),
      render: (r) => {
        const list = datesOf(r)
        if (!list.length) return <span className="text-muted">not recorded</span>
        return <div>{list.map((x) => { const n = daysBetween(asOf, x.date); return <div key={x.label} className="text-[12px]"><span className="text-muted">{x.label}</span> <span className="num">{fmtDate(x.date)}</span> <span className={cx(n < 0 ? 'text-neg' : n <= 30 ? 'text-warn' : 'text-muted')}>· {whenText(x.date, asOf)}</span></div> })}</div>
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} />, sort: (r) => r.status, csv: (r) => r.status },
  ]

  // ---------------------------------------------------------------- forex
  const forexDocs: OpenDoc[] = useMemo(() => openDocuments(invoices.data ?? [], asOf).filter((x) => x.invoice.currency !== (companyById.get(x.invoice.company_id)?.base_currency ?? currency)), [invoices.data, asOf, companyById, currency])
  const forexRows: ForexRow[] = useMemo(() => {
    const m = new Map<string, ForexRow>()
    for (const x of forexDocs) {
      const base = companyById.get(x.invoice.company_id)?.base_currency ?? currency
      const key = x.invoice.currency + '|' + base
      const r = m.get(key) ?? { key, currency: x.invoice.currency, base, count: 0, receivable: ZERO, payable: ZERO, receivableBase: ZERO, payableBase: ZERO }
      r.count += 1
      if (x.side === 'in') { r.receivable = r.receivable.plus(x.outstanding); r.receivableBase = r.receivableBase.plus(x.outstandingBase) }
      else { r.payable = r.payable.plus(x.outstanding); r.payableBase = r.payableBase.plus(x.outstandingBase) }
      m.set(key, r)
    }
    return [...m.values()].sort((a, b) => a.currency.localeCompare(b.currency))
  }, [forexDocs, companyById, currency])
  const forexColumns: Column<ForexRow>[] = [
    { key: 'ccy', header: 'Currency', render: (r) => <span className="num text-gold">{r.currency}</span>, sort: (r) => r.currency, csv: (r) => r.currency },
    { key: 'n', header: 'Documents', align: 'right', render: (r) => <span className="num">{r.count}</span>, sort: (r) => r.count, csv: (r) => r.count },
    { key: 'rec', header: 'Receivable', align: 'right', render: (r) => <Money value={r.receivable} currency={r.currency} dim />, sort: (r) => r.receivable.toNumber(), csv: (r) => r.receivable.toFixed(2) },
    { key: 'pay', header: 'Payable', align: 'right', render: (r) => <Money value={r.payable} currency={r.currency} dim />, sort: (r) => r.payable.toNumber(), csv: (r) => r.payable.toFixed(2) },
    { key: 'net', header: 'Net', align: 'right', render: (r) => <Money value={r.receivable.minus(r.payable)} currency={r.currency} colored sign />, sort: (r) => r.receivable.minus(r.payable).toNumber(), csv: (r) => r.receivable.minus(r.payable).toFixed(2) },
    { key: 'base', header: 'Base currency', render: (r) => <span className="num text-[12px] text-muted">{r.base}</span>, sort: (r) => r.base, csv: (r) => r.base },
    { key: 'recb', header: 'Receivable at recorded rate', align: 'right', render: (r) => <Money value={r.receivableBase} currency={r.base} dim />, sort: (r) => r.receivableBase.toNumber(), csv: (r) => r.receivableBase.toFixed(2) },
    { key: 'payb', header: 'Payable at recorded rate', align: 'right', render: (r) => <Money value={r.payableBase} currency={r.base} dim />, sort: (r) => r.payableBase.toNumber(), csv: (r) => r.payableBase.toFixed(2) },
    { key: 'netb', header: 'Net at recorded rate', align: 'right', render: (r) => <Money value={r.receivableBase.minus(r.payableBase)} currency={r.base} colored sign />, sort: (r) => r.receivableBase.minus(r.payableBase).toNumber(), csv: (r) => r.receivableBase.minus(r.payableBase).toFixed(2) },
  ]
  const forexShown = forexCurrency ? forexDocs.filter((x) => x.invoice.currency === forexCurrency) : forexDocs
  const forexDocColumns: Column<OpenDoc>[] = [
    { key: 'no', header: 'Document', render: (x) => <span className="num text-[12.5px] text-gold">{x.invoice.doc_no ?? '—'}</span>, sort: (x) => x.invoice.doc_no ?? '', csv: (x) => x.invoice.doc_no ?? '' },
    { key: 'side', header: 'Side', render: (x) => <span className={cx('chip', x.side === 'in' ? 'pos' : 'warn')}>{x.side === 'in' ? 'receivable' : 'payable'}</span>, sort: (x) => x.side, csv: (x) => (x.side === 'in' ? 'Receivable' : 'Payable') },
    { key: 'party', header: 'Party', render: (x) => <span className="text-ink2">{partyName(x.invoice.party_id)}</span>, sort: (x) => partyName(x.invoice.party_id).toLowerCase(), csv: (x) => partyName(x.invoice.party_id) },
    { key: 'company', header: 'Company', render: (x) => <span className="text-ink2" title={companyName(x.invoice.company_id)}>{companyById.get(x.invoice.company_id)?.code ?? '—'}</span>, sort: (x) => companyName(x.invoice.company_id), csv: (x) => companyName(x.invoice.company_id) },
    { key: 'due', header: 'Due date', render: (x) => <span className="num text-[12.5px]">{fmtDate(x.invoice.due_date ?? x.invoice.doc_date)}</span>, sort: (x) => x.invoice.due_date ?? x.invoice.doc_date, csv: (x) => x.invoice.due_date ?? x.invoice.doc_date },
    { key: 'out', header: 'Outstanding', align: 'right', render: (x) => <Money value={x.outstanding} currency={x.invoice.currency} />, sort: (x) => x.outstanding.toNumber(), csv: (x) => x.outstanding.toFixed(2) },
    { key: 'ccy', header: 'Currency', render: (x) => <span className="num text-[12px] text-muted">{x.invoice.currency}</span>, sort: (x) => x.invoice.currency, csv: (x) => x.invoice.currency },
    { key: 'rate', header: 'Recorded rate', align: 'right', render: (x) => <span className="num text-[12.5px]">{D(x.invoice.fx_rate).toString()}</span>, sort: (x) => D(x.invoice.fx_rate).toNumber(), csv: (x) => D(x.invoice.fx_rate).toString() },
    { key: 'base', header: 'At recorded rate', align: 'right', render: (x) => <Money value={x.outstandingBase} currency={ccyOf(x.invoice.company_id)} className="text-ink" />, sort: (x) => x.outstandingBase.toNumber(), csv: (x) => x.outstandingBase.toFixed(2) },
  ]

  const canManageRegisters = ids.some((id) => can('register.manage', id))

  return (
    <div>
      <PageHeader
        eyebrow="Treasury"
        title="Treasury command centre"
        subtitle={<>
          As at {fmtDate(asOf)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · cash, deposits, borrowings, facilities and currency exposure. NUMERO records that money moved; it never moves money.
          {mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}
        </>}
        actions={<>
          <button className="btn" disabled={!manageIds.length} title={noManage} onClick={() => setNewDeposit(true)}><PiggyBank size={15} /> New deposit</button>
          <button className="btn primary" disabled={!manageIds.length} title={noManage} onClick={() => setNewLoan(true)}><Plus size={15} /> New loan</button>
        </>}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading the treasury position" /></Panel>}

      {d && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <Stat label="Cash and bank today" value={cash} currency={currency} tone="gold" onClick={() => go({ tab: 'position' })}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> {cashRows.length} ledger{cashRows.length === 1 ? '' : 's'}</span>} />
            <Stat label="Fixed deposits" value={depositsTotal} currency={currency} onClick={() => go({ tab: 'deposits' })}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> principal of {activeDeposits.length} active deposit{activeDeposits.length === 1 ? '' : 's'}</span>} />
            <Stat label="Borrowings outstanding" value={borrowings} currency={currency} tone={borrowings.gt(0) ? 'warn' : undefined} onClick={() => go({ tab: 'loans' })}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> {borrowed.length} active loan{borrowed.length === 1 ? '' : 's'} taken</span>} />
            <Stat label="Due within 30 days" value={due30} currency={currency} tone={overdueTotal.gt(0) ? 'neg' : undefined} onClick={() => go({ tab: 'loans' })}
              sub={<span className="flex flex-wrap items-center gap-1.5"><Contracted /> loan instalments{overdueTotal.gt(0) ? ', some already overdue' : ''}</span>} />
            {registerIds.length ? (
              <Stat label="Guarantees outstanding" value={guaranteeTotal} currency={currency} onClick={() => go({ tab: 'facilities' })}
                sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="CONTINGENT" /> {registers.loading && !registers.data ? 'loading' : `${guarantees.length} active guarantee${guarantees.length === 1 ? '' : 's'}`}</span>} />
            ) : (
              <Panel className="p-4">
                <div className="eyebrow">Guarantees outstanding</div>
                <div className="mt-1.5 text-[13px] text-ink2">Not shown</div>
                <div className="mt-1 text-[11.5px] text-muted">The permission register.view is needed to read the guarantee register.</div>
              </Panel>
            )}
          </div>
          {mixedCurrencies && <Note kind="warn" className="mb-4">The selected companies keep their books in different currencies. Totals on this page add the figures of each company as recorded, without converting them. Select one company for a total in a single currency.</Note>}

          <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'deposits' ? deposits.length : t.key === 'loans' ? loans.length : t.key === 'facilities' && registerIds.length ? registers.data?.length : undefined }))} value={tab} onChange={(k) => go({ tab: k })} />

          {tab === 'position' && (
            <div className="space-y-4">
              <Section title="Cash and bank by company and ledger" right={<Truth state="ACTUAL" />}>
                <Panel lit={false}>
                  <DataTable columns={cashColumns} rows={cashRows} rowKey={(r) => r.account.id} onRow={(r) => nav(ledgerLink({ accounts: [r.account.id] }))} exportName="treasury-cash-and-bank" initialSort={{ key: 'company', dir: 'asc' }}
                    footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {cashRows.length} ledger{cashRows.length === 1 ? '' : 's'}</td><td className={cx(foot, 'r')}><Money value={cash} className="font-medium text-ink" /></td><td className={foot} /></tr>}
                    empty={{ title: 'No cash or bank ledger', body: 'The selected companies have no ledger of subtype cash or bank. Add one under Chart of Accounts.', icon: <Wallet size={20} /> }} />
                </Panel>
                <div className="mt-2 text-[11.5px] text-muted">Balances are taken from posted accounting entries up to {fmtDate(asOf)}. They are book balances; whether they agree with the bank is shown under Banking.</div>
              </Section>

              <Section title="Liquidity ladder">
                <Panel lit={false}>
                  <DataTable columns={ladderColumns} rows={ladder} rowKey={(r) => r.key} exportName="treasury-liquidity-ladder" />
                </Panel>
                <Note className="mt-3">
                  <div className="font-medium text-ink">Assumptions</div>
                  <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4">
                    <li>Cash and bank is the book balance of the cash and bank ledgers today.</li>
                    <li>Deposits are counted at their calculated maturity value, which the bank has not confirmed, and before any tax deducted at source.</li>
                    <li>Deposits under lien and deposits set to renew automatically are left out{renewing.length ? ` (${renewing.length} renewing deposit${renewing.length === 1 ? '' : 's'} mature within 90 days)` : ''}.</li>
                    <li>Loan instalments are those of active loans taken, as per schedule, and include instalments that are already overdue. For floating-rate loans the interest is indicative.</li>
                    <li>The 90-day column includes everything in the 30-day column.</li>
                    <li>Customer receipts, supplier payments, payroll and instalments receivable on loans given are not part of this ladder. <button className="link" onClick={() => nav('/forward')}>NUMERO Forward</button> shows the full projection.</li>
                  </ul>
                </Note>
              </Section>

              <Section title="Deposits under lien — not freely available">
                <Panel lit={false} className="p-1.5">
                  {underLien.length === 0 ? <div className="px-3 py-3 text-[12.5px] text-muted">No active deposit is under lien.</div> : underLien.map((x) => (
                    <button key={x.id} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => go({ tab: 'deposits', deposit: x.id })}>
                      <Lock size={15} className="mt-[3px] flex-none text-warn" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-ink"><span className="num text-gold">{x.fd_no}</span> · {x.bank_name} · {companyName(x.company_id)}</span>
                        <span className="block text-[11.5px] text-muted">{x.lien_note ?? 'No note is recorded for this lien.'} Matures {fmtDate(x.maturity_date)} ({whenText(x.maturity_date, asOf)}).</span>
                      </span>
                      <Money value={x.principal} currency={x.currency} className="text-[12.5px]" />
                    </button>
                  ))}
                </Panel>
              </Section>
            </div>
          )}

          {tab === 'deposits' && (
            <Panel lit={false}>
              <DataTable columns={depositColumns} rows={deposits} rowKey={(x) => x.id} onRow={(x) => go({ tab: 'deposits', deposit: x.id })} exportName="fixed-deposits" initialSort={{ key: 'maturity', dir: 'asc' }}
                toolbar={<span className="text-[12px] text-muted">Placing or closing a deposit proposes an accounting entry. It reaches the ledger only after a second person approves it.</span>}
                empty={{ title: 'No fixed deposit is recorded', body: 'Record a deposit with its bank, principal, rate and dates. It starts as a draft; recording its placement proposes the accounting entry.', icon: <PiggyBank size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setNewDeposit(true)}><Plus size={13} /> New deposit</button> }} />
            </Panel>
          )}

          {tab === 'loans' && (
            <div className="space-y-4">
              <Panel lit={false}>
                <DataTable columns={loanColumns} rows={loans} rowKey={(l) => l.id} onRow={(l) => nav('/treasury/loans/' + l.id)} exportName="loans" initialSort={{ key: 'no', dir: 'asc' }}
                  empty={{ title: 'No loan is recorded', body: 'Record a loan taken or a loan given. NUMERO builds the repayment schedule; disbursement and each instalment propose an accounting entry for approval.', icon: <Landmark size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setNewLoan(true)}><Plus size={13} /> New loan</button> }} />
              </Panel>
              <Section title="Debt maturity ladder — active loans taken" right={<Contracted />}>
                {bands.every((b) => b.instalments === 0) ? (
                  <Panel lit={false}><Empty icon={<Landmark size={20} />} title="No instalment is outstanding" body="There is no unpaid instalment on an active loan taken in the selected companies." /></Panel>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel className="p-4" lit={false}>
                      <BarChart data={bands.map((b) => ({ label: b.label, values: [{ key: 'Principal falling due', value: b.principal.toNumber(), color: b.label === 'Overdue' ? 'var(--neg)' : undefined }] }))} />
                    </Panel>
                    <Panel lit={false}>
                      <DataTable columns={bandColumns} rows={bands} rowKey={(b) => b.label} exportName="debt-maturity-ladder"
                        footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total</td><td className={cx(foot, 'r num')}>{bands.reduce((n, b) => n + b.instalments, 0)}</td><td className={cx(foot, 'r')}><Money value={sum(bands.map((b) => b.principal))} /></td><td className={cx(foot, 'r')}><Money value={sum(bands.map((b) => b.interest))} /></td><td className={cx(foot, 'r')}><Money value={sum(bands.map((b) => b.principal.plus(b.interest)))} className="font-medium text-ink" /></td></tr>} />
                    </Panel>
                  </div>
                )}
                <div className="mt-2 text-[11.5px] text-muted">Principal and interest are taken from the repayment schedules. For floating-rate loans the interest is indicative: the lender's statement is the authority.</div>
              </Section>
            </div>
          )}

          {tab === 'facilities' && (
            !registerIds.length ? (
              <Panel><Empty icon={<Lock size={20} />} title="You do not have access to the registers" body={<>Facilities, guarantees, letters of credit and covenants are kept in the registers. Reading them needs the permission <span className="num text-ink2">register.view</span>.</>} /></Panel>
            ) : registers.error ? <ErrorBox message={registers.error} retry={registers.reload} />
              : !registers.data ? <Panel><Loading rows={5} label="Loading facilities and guarantees" /></Panel>
              : (
                <Panel lit={false}>
                  <DataTable columns={facilityColumns} rows={registers.data} rowKey={(r) => r.id} onRow={(r) => nav('/registers/' + r.id)} exportName="facilities-and-guarantees" initialSort={{ key: 'date', dir: 'asc' }}
                    toolbar={<>
                      <select className="field sm" style={{ width: 210 }} value={addKind} onChange={(e) => setAddKind(e.target.value)} aria-label="Kind of record to add">{FACILITY_KINDS.map((k) => <option key={k} value={k}>{FACILITY_LABEL[k]}</option>)}</select>
                      <button className="btn sm" disabled={!canManageRegisters} title={canManageRegisters ? undefined : 'You need the permission register.manage to add a record'} onClick={() => nav('/registers?new=' + addKind)}><Plus size={13} /> Add</button>
                      <span className="text-[12px] text-muted">Guarantees are <span className="text-warn">CONTINGENT</span>: they become payable only if they are invoked.</span>
                    </>}
                    empty={{ title: 'No facility or guarantee is recorded', body: 'Credit facilities, bank and corporate guarantees, letters of credit and loan covenants are recorded in the registers, with their expiry, review and test dates.', icon: <ShieldCheck size={20} />, action: <button className="btn sm" disabled={!canManageRegisters} title={canManageRegisters ? undefined : 'You need the permission register.manage to add a record'} onClick={() => nav('/registers?new=' + addKind)}><Plus size={13} /> Add {FACILITY_LABEL[addKind].toLowerCase()}</button> }} />
                </Panel>
              )
          )}

          {tab === 'forex' && (
            invoices.error ? <ErrorBox message={invoices.error} retry={invoices.reload} />
              : !invoices.data ? <Panel><Loading rows={5} label="Loading open documents" /></Panel>
              : (
                <div className="space-y-4">
                  <Note>Amounts in the base currency use the exchange rate recorded on each document. NUMERO does not fetch market rates.</Note>
                  <Section title="Open documents in a foreign currency, by currency" right={<Truth state="ACTUAL" />}>
                    <Panel lit={false}>
                      <DataTable columns={forexColumns} rows={forexRows} rowKey={(r) => r.key} onRow={(r) => setForexCurrency((c) => (c === r.currency ? null : r.currency))} exportName="forex-exposure-by-currency" initialSort={{ key: 'ccy', dir: 'asc' }}
                        rowClass={(r) => (forexCurrency === r.currency ? 'bg-surface2' : undefined)}
                        empty={{ title: 'No exposure in a foreign currency', body: 'Every open or partly paid invoice and bill in the selected companies is in the base currency of its company.', icon: <Globe2 size={20} /> }} />
                    </Panel>
                  </Section>
                  {forexDocs.length > 0 && (
                    <Section title={forexCurrency ? `Documents in ${forexCurrency}` : 'Documents behind these figures'} right={forexCurrency ? <button className="btn sm" onClick={() => setForexCurrency(null)}>Showing {forexCurrency} — clear</button> : undefined}>
                      <Panel lit={false}>
                        <DataTable columns={forexDocColumns} rows={forexShown} rowKey={(x) => x.invoice.id} onRow={(x) => nav((x.invoice.doc_type === 'sales_invoice' ? '/invoices/' : '/bills/') + x.invoice.id)} exportName="forex-exposure-documents" initialSort={{ key: 'due', dir: 'asc' }} />
                      </Panel>
                      <div className="mt-2 text-[11.5px] text-muted">Open and partly paid sales invoices and purchase bills only. Receivables and payables are shown side by side; the net is for information and is not a set-off.</div>
                    </Section>
                  )}
                </div>
              )
          )}
        </>
      )}

      <DepositForm open={newDeposit || !!editDeposit} deposit={editDeposit} companyIds={ids} onClose={() => { setNewDeposit(false); setEditDeposit(null) }} onSaved={(id) => go({ tab: 'deposits', deposit: id })} />
      <LoanForm open={newLoan} companyIds={ids} onClose={() => setNewLoan(false)} onSaved={(id) => nav('/treasury/loans/' + id)} />

      <Drawer open={!!depositId && !!d} onClose={() => go({ tab: 'deposits' })} width={620}
        title={selectedDeposit ? `${selectedDeposit.fd_no} · ${selectedDeposit.bank_name}` : 'Fixed deposit'}
        subtitle={selectedDeposit ? companyName(selectedDeposit.company_id) : undefined}>
        {selectedDeposit
          ? <DepositBody key={selectedDeposit.id} d={selectedDeposit} onEdit={() => setEditDeposit(selectedDeposit)} />
          : <Empty icon={<PiggyBank size={20} />} title="Deposit not found or not shared with you" body="This deposit does not exist in the selected companies, or it is classified above your clearance." />}
      </Drawer>
    </div>
  )
}

// =====================================================================
// Fixed deposit: facts, entries, evidence and actions
// =====================================================================
function DepositBody({ d, onEdit }: { d: FixedDeposit; onEdit: () => void }) {
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const accountName = useAccountName()
  const [placing, setPlacing] = useState(false)
  const [closing, setClosing] = useState(false)
  const postings = useAsync(() => api.listWorkflowPostings({ companyIds: [d.company_id], sourceId: d.id }), [api, d.company_id, d.id])
  const pending = (postings.data ?? []).find((w) => w.status === 'pending' && (w.source === 'fd_placement' || w.source === 'fd_closure'))
  const manage = can('treasury.manage', d.company_id)
  const asOf = today()
  const n = daysBetween(asOf, d.maturity_date)
  const why = !manage ? 'You need the permission treasury.manage in this company' : pending ? 'An entry for this deposit is already awaiting approval' : undefined
  const earned = d.status === 'closed' && d.proceeds != null ? D(d.proceeds).plus(D(d.tax_deducted)).minus(d.principal) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={d.status} label={d.status === 'draft' ? 'draft — not placed' : undefined} />
        {pending && <span className="chip warn">{pending.source === 'fd_placement' ? 'placement' : 'closure'} awaiting approval</span>}
        {d.lien_marked && <span className="chip warn" title={d.lien_note ?? undefined}><Lock size={11} /> under lien</span>}
        {d.auto_renew && <span className="chip cyan">renews automatically</span>}
        {d.confidentiality !== 'internal' && <span className="chip violet">{human(d.confidentiality)}</span>}
        {d.status === 'active' && <span className={cx('chip', n < 0 ? 'neg' : n <= 30 ? 'warn' : '')}>{n < 0 ? `matured ${whenText(d.maturity_date, asOf)}` : `matures ${whenText(d.maturity_date, asOf)}`}</span>}
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {d.status === 'draft' && <button className="btn primary" disabled={!!why} title={why ?? 'Proposes the accounting entry for the placement'} onClick={() => setPlacing(true)}><BadgeCheck size={15} /> Record placement</button>}
        {d.status === 'active' && <button className="btn primary" disabled={!!why} title={why ?? 'Proposes the accounting entry for the maturity or closure'} onClick={() => setClosing(true)}><BadgeCheck size={15} /> Record maturity or closure</button>}
        {(d.status === 'draft' || d.status === 'active') && <button className="btn" disabled={!manage} title={manage ? undefined : 'You need the permission treasury.manage in this company'} onClick={onEdit}><Pencil size={14} /> Edit</button>}
      </div>
      {d.status === 'draft' && !pending && <Note>This deposit is a draft. Nothing has reached the ledger. Record its placement to propose the accounting entry.</Note>}

      <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
        <Fact label="Bank">{d.bank_name}{d.bank_party_id ? <span className="text-muted"> · {partyName(d.bank_party_id)}</span> : null}</Fact>
        <Fact label="Reference"><span className="num">{d.reference ?? '—'}</span></Fact>
        <Fact label="Principal"><Money value={d.principal} currency={d.currency} /></Fact>
        <Fact label="Rate and compounding"><span className="num">{pct(d.rate_pct)}</span> · {COMPOUNDING[d.compounding]}</Fact>
        <Fact label="Start date"><span className="num">{fmtDate(d.start_date)}</span></Fact>
        <Fact label="Maturity date"><span className="num">{fmtDate(d.maturity_date)}</span></Fact>
        <Fact label="Maturity value"><Money value={d.maturity_amount} currency={d.currency} /> <span className="text-[11.5px] text-muted">calculated, not confirmed by the bank</span></Fact>
        <Fact label="Lien">{d.lien_marked ? d.lien_note ?? 'Under lien; no note recorded' : 'Not under lien'}</Fact>
        <Fact label="Deposit ledger">{accountName(d.fd_account_id)}</Fact>
        <Fact label="Interest ledger">{accountName(d.interest_account_id)}</Fact>
        {d.status === 'closed' && <>
          <Fact label="Closed on"><span className="num">{fmtDate(d.closed_on)}</span></Fact>
          <Fact label="Amount received"><Money value={d.proceeds} currency={d.currency} /></Fact>
          <Fact label="Tax deducted at source"><Money value={d.tax_deducted} currency={d.currency} /></Fact>
          <Fact label="Interest actually paid by the bank">{earned ? <Money value={earned} currency={d.currency} colored /> : '—'}</Fact>
        </>}
        {d.notes && <Fact label="Notes" className="sm:col-span-2">{d.notes}</Fact>}
      </Panel>

      <ProposedEntries companyIds={[d.company_id]} sourceId={d.id} sources={['fd_placement', 'fd_closure']} />
      <Attachments companyId={d.company_id} entity="fixed_deposits" entityId={d.id} />

      <PlacementModal open={placing} d={d} onClose={() => setPlacing(false)} />
      <ClosureModal open={closing} d={d} onClose={() => setClosing(false)} />
    </div>
  )
}

function PlacementModal({ open, d, onClose }: { open: boolean; d: FixedDeposit; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const ledgers = useMoneyLedgers(d.company_id, true)
  const [bank, setBank] = useState('')
  const [date, setDate] = useState(today())
  useEffect(() => { if (open) { setBank(ledgers[0]?.id ?? ''); setDate(d.start_date <= today() ? d.start_date : today()) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const problem = !bank ? 'Choose the bank ledger the deposit was funded from.' : !date ? 'Choose the date.' : null
  const submit = async () => { const j = await act(() => api.placeFixedDeposit(d.id, { bank_ledger_id: bank, date }), 'Placement proposed — awaiting approval'); if (j) onClose() }
  return (
    <Modal open={open} onClose={onClose} title="Record placement" subtitle={`${d.fd_no} · ${d.bank_name}`} width={520}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => void submit()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
      <ProposedNote />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount placed"><div className="field flex items-center"><Money value={d.principal} currency={d.currency} /></div></Field>
        <Field label="Date the money left the bank account"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Bank ledger the deposit was funded from" className="sm:col-span-2" hint={ledgers.length ? undefined : 'This company has no bank ledger.'}>
          <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Choose…</option>{ledgers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select>
        </Field>
      </div>
      <div className="mt-3 text-[12px] text-muted">On approval: the deposit ledger is debited and the bank ledger is credited with the principal.</div>
      {problem && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

function ClosureModal({ open, d, onClose }: { open: boolean; d: FixedDeposit; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const ledgers = useMoneyLedgers(d.company_id, true)
  const [bank, setBank] = useState('')
  const [date, setDate] = useState(today())
  const [proceeds, setProceeds] = useState('')
  const [tds, setTds] = useState('')
  const [lienReleased, setLienReleased] = useState(false)
  useEffect(() => { if (open) { setBank(ledgers[0]?.id ?? ''); setDate(today()); setProceeds(''); setTds(''); setLienReleased(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const interest = D(proceeds).plus(D(tds)).minus(d.principal)
  const problem = !bank ? 'Choose the bank ledger that received the money.' : !date ? 'Choose the date.' : date < d.start_date ? 'The date is before the start date of the deposit.'
    : D(proceeds).lte(0) ? 'Enter the amount received from the bank.' : d.lien_marked && !lienReleased ? 'Confirm that the lien has been released.' : null
  const submit = async () => {
    const j = await act(() => api.closeFixedDeposit(d.id, { bank_ledger_id: bank, date, proceeds, tax_deducted: tds || 0, lien_released: d.lien_marked ? lienReleased : undefined }), 'Closure proposed — awaiting approval')
    if (j) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Record maturity or closure" subtitle={`${d.fd_no} · ${d.bank_name} · matures ${fmtDate(d.maturity_date)}`} width={560}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!problem || busy} onClick={() => void submit()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
      <ProposedNote />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank ledger that received the money" className="sm:col-span-2" hint={ledgers.length ? undefined : 'This company has no bank ledger.'}>
          <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Choose…</option>{ledgers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select>
        </Field>
        <Field label="Date the money was received"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount received" hint="As credited in the bank statement"><input className="field num" inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(digits(e.target.value))} autoFocus /></Field>
        <Field label="Tax deducted at source" hint="As stated by the bank; leave empty when none was deducted" className="sm:col-span-2"><input className="field num" inputMode="decimal" value={tds} onChange={(e) => setTds(digits(e.target.value))} /></Field>
      </div>
      {d.lien_marked && (
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-warn/30 bg-warnsoft px-3.5 py-2.5 text-[12.5px] text-ink2">
          <input type="checkbox" className="mt-[3px]" checked={lienReleased} onChange={(e) => setLienReleased(e.target.checked)} />
          <span><span className="font-medium text-ink">The lien has been released</span><span className="block text-muted">{d.lien_note ?? 'This deposit is under lien.'} A deposit under lien cannot be closed until the lien is released.</span></span>
        </label>
      )}
      <Panel className="mt-4 p-3.5 text-[12.5px]" lit={false}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink2">
          <span>Interest = received</span><Money value={D(proceeds)} currency={d.currency} /><span>+ tax deducted</span><Money value={D(tds)} currency={d.currency} /><span>− principal</span><Money value={d.principal} currency={d.currency} /><span>=</span>
          {proceeds === '' ? <span className="text-muted">enter the amount received</span> : <Money value={interest} currency={d.currency} className={cx('font-medium', interest.isNegative() ? 'text-neg' : 'text-pos')} />}
        </div>
        <div className="mt-1.5 text-[11.5px] text-muted">Interest is what the bank actually paid, not what was expected. The calculated maturity value was <Money value={d.maturity_amount} currency={d.currency} />.</div>
        {proceeds !== '' && interest.isNegative() && <div className="mt-1.5 text-[11.5px] text-warn">The amount received plus tax is less than the principal. The shortfall will be charged to the interest ledger.</div>}
        {date && date < d.maturity_date && <div className="mt-1.5 text-[11.5px] text-warn">This date is before the maturity date: the entry will be recorded as a closure before maturity.</div>}
      </Panel>
      {problem && proceeds !== '' && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

// =====================================================================
// New or edited fixed deposit
// =====================================================================
interface DepositDraft {
  company_id: ID; bank_name: string; bank_party_id: ID; reference: string; principal: string; rate_pct: string; compounding: FixedDeposit['compounding']
  start_date: string; maturity_date: string; maturity_amount: string; fd_account_id: ID; interest_account_id: ID; lien_marked: boolean; lien_note: string
  auto_renew: boolean; confidentiality: Confidentiality; notes: string
}

function DepositForm({ open, onClose, deposit, companyIds, onSaved }: { open: boolean; onClose: () => void; deposit?: FixedDeposit | null; companyIds: ID[]; onSaved?: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()

  const defaults = (companyId: ID): Pick<DepositDraft, 'fd_account_id' | 'interest_account_id'> => ({
    fd_account_id: postingLedgers(accounts, companyId, ['asset'], ['investment']).find((a) => a.subtype === 'investment')?.id ?? '',
    interest_account_id: postingLedgers(accounts, companyId, ['income'], ['other_income']).find((a) => /interest/i.test(a.name))?.id ?? '',
  })
  const fresh = (): DepositDraft => {
    const company_id = choices.find((c) => can('treasury.manage', c.id))?.id ?? choices[0]?.id ?? ''
    return { company_id, bank_name: '', bank_party_id: '', reference: '', principal: '', rate_pct: '', compounding: 'quarterly', start_date: today(), maturity_date: addMonths(today(), 12), maturity_amount: '', ...defaults(company_id), lien_marked: false, lien_note: '', auto_renew: false, confidentiality: 'internal', notes: '' }
  }
  const [f, setF] = useState<DepositDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setF(deposit ? {
      company_id: deposit.company_id, bank_name: deposit.bank_name, bank_party_id: deposit.bank_party_id ?? '', reference: deposit.reference ?? '', principal: D(deposit.principal).toString(), rate_pct: D(deposit.rate_pct).toString(),
      compounding: deposit.compounding, start_date: deposit.start_date, maturity_date: deposit.maturity_date, maturity_amount: D(deposit.maturity_amount).toString(), fd_account_id: deposit.fd_account_id, interest_account_id: deposit.interest_account_id,
      lien_marked: deposit.lien_marked, lien_note: deposit.lien_note ?? '', auto_renew: deposit.auto_renew, confidentiality: deposit.confidentiality, notes: deposit.notes ?? '',
    } : fresh())
  }, [open, deposit?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<DepositDraft>) => setF((x) => ({ ...x, ...patch }))

  const placed = deposit?.status === 'active'
  const assetLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['asset'], ['investment']), [accounts, f.company_id])
  const incomeLedgers = useMemo(() => postingLedgers(accounts, f.company_id, ['income'], ['other_income']), [accounts, f.company_id])
  const banks = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === f.company_id) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, f.company_id])
  const manage = !!f.company_id && can('treasury.manage', f.company_id)

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company.')
  if (!f.bank_name.trim()) problems.push('Enter the name of the bank.')
  if (D(f.principal).lte(0)) problems.push('Enter the principal.')
  if (!f.start_date || !f.maturity_date || f.maturity_date <= f.start_date) problems.push('The maturity date must be after the start date.')
  if (!f.fd_account_id) problems.push('Choose the deposit ledger.')
  if (!f.interest_account_id) problems.push('Choose the interest ledger.')

  const save = async () => {
    const input: FixedDepositInput = {
      id: deposit?.id, company_id: f.company_id, bank_name: f.bank_name.trim(), bank_party_id: f.bank_party_id || null, reference: f.reference.trim() || null, principal: f.principal, rate_pct: f.rate_pct || 0,
      compounding: f.compounding, start_date: f.start_date, maturity_date: f.maturity_date, ...(f.maturity_amount.trim() ? { maturity_amount: f.maturity_amount } : {}), fd_account_id: f.fd_account_id, interest_account_id: f.interest_account_id,
      lien_marked: f.lien_marked, lien_note: f.lien_marked ? f.lien_note.trim() || null : null, auto_renew: f.auto_renew, confidentiality: f.confidentiality, notes: f.notes.trim() || null,
    }
    const id = await act(() => api.saveFixedDeposit(input), deposit ? 'Deposit updated' : 'Deposit recorded as a draft')
    if (id) { onClose(); onSaved?.(id) }
  }

  return (
    <Drawer open={open} onClose={onClose} width={640} title={deposit ? `Edit ${deposit.fd_no}` : 'New fixed deposit'} subtitle="Saving records the deposit. It does not post anything to the ledger."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission treasury.manage in this company' : problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
      {placed && <Note kind="warn" className="mb-4">This deposit has been placed. Its principal, start date and deposit ledger can no longer be changed.</Note>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2">
          <select className="field" value={f.company_id} disabled={!!deposit} onChange={(e) => set({ company_id: e.target.value, bank_party_id: '', ...defaults(e.target.value) })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        </Field>
        <Field label="Bank name"><input className="field" value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} /></Field>
        <Field label="Bank as a party (optional)" hint="Links the deposit to the bank's record in People & Parties">
          <select className="field" value={f.bank_party_id} onChange={(e) => set({ bank_party_id: e.target.value })}><option value="">Not linked</option>{banks.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
        </Field>
        <Field label="Reference" hint="Deposit receipt or account number"><input className="field num" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
        <Field label="Principal"><input className="field num" inputMode="decimal" value={f.principal} disabled={placed} onChange={(e) => set({ principal: digits(e.target.value) })} /></Field>
        <Field label="Rate % a year"><input className="field num" inputMode="decimal" value={f.rate_pct} onChange={(e) => set({ rate_pct: digits(e.target.value) })} /></Field>
        <Field label="Compounding"><select className="field" value={f.compounding} onChange={(e) => set({ compounding: e.target.value as FixedDeposit['compounding'] })}>{(Object.keys(COMPOUNDING) as FixedDeposit['compounding'][]).map((k) => <option key={k} value={k}>{COMPOUNDING[k]}</option>)}</select></Field>
        <Field label="Start date"><input type="date" className="field" value={f.start_date} disabled={placed} onChange={(e) => set({ start_date: e.target.value })} /></Field>
        <Field label="Maturity date"><input type="date" className="field" value={f.maturity_date} onChange={(e) => set({ maturity_date: e.target.value })} /></Field>
        <Field label="Maturity amount (optional)" className="sm:col-span-2" hint={deposit ? 'Clear this field to have it calculated again from the rate and compounding. A calculated value is not confirmed by the bank.' : 'Leave empty and it is calculated from the rate and compounding. A calculated value is not confirmed by the bank.'}>
          <input className="field num" inputMode="decimal" value={f.maturity_amount} onChange={(e) => set({ maturity_amount: digits(e.target.value) })} />
        </Field>
        <Field label="Deposit ledger" hint="An asset ledger: the deposit is money the company still owns.">
          <select className="field" value={f.fd_account_id} disabled={placed} onChange={(e) => set({ fd_account_id: e.target.value })}><option value="">Choose…</option>{assetLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Interest ledger" hint="An income ledger: interest earned on the deposit.">
          <select className="field" value={f.interest_account_id} onChange={(e) => set({ interest_account_id: e.target.value })}><option value="">Choose…</option>{incomeLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink2">
          <input type="checkbox" className="mt-[3px]" checked={f.lien_marked} onChange={(e) => set({ lien_marked: e.target.checked })} />
          <span><span className="text-ink">Under lien</span><span className="block text-[11.5px] text-muted">Pledged as margin or security; not freely available.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink2">
          <input type="checkbox" className="mt-[3px]" checked={f.auto_renew} onChange={(e) => set({ auto_renew: e.target.checked })} />
          <span><span className="text-ink">Renews automatically</span><span className="block text-[11.5px] text-muted">Left out of projected cash on maturity.</span></span>
        </label>
        {f.lien_marked && <Field label="Lien note" className="sm:col-span-2" hint="In whose favour, and for what"><input className="field" value={f.lien_note} onChange={(e) => set({ lien_note: e.target.value })} /></Field>}
        <Field label="Confidentiality" hint="People without clearance for the chosen level do not receive this record.">
          <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {problems.length > 0 && (f.bank_name || f.principal) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}

// =====================================================================
// New or edited loan — shared with the Loan 360 screen
// =====================================================================
interface LoanDraft {
  company_id: ID; direction: Loan['direction']; kind: string; party_id: ID; name: string; principal: string; rate_pct: string; rate_type: Loan['rate_type']; rate_reset_date: string
  start_date: string; first_due_date: string; tenure_months: string; repayment: Loan['repayment']; loan_account_id: ID; interest_account_id: ID
  sanction_ref: string; security: string; covenants: string; confidentiality: Confidentiality; notes: string
}

export function LoanForm({ open, onClose, loan, companyIds, onSaved }: { open: boolean; onClose: () => void; loan?: Loan | null; companyIds: ID[]; onSaved?: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const choices = useCompanyChoices(companyIds)
  const { act, busy } = useAction()

  const fresh = (): LoanDraft => ({
    company_id: choices.find((c) => can('treasury.manage', c.id))?.id ?? choices[0]?.id ?? '', direction: 'borrowed', kind: 'term_loan', party_id: '', name: '', principal: '', rate_pct: '', rate_type: 'fixed', rate_reset_date: '',
    start_date: today(), first_due_date: addMonths(today(), 1), tenure_months: '12', repayment: 'emi', loan_account_id: '', interest_account_id: '', sanction_ref: '', security: '', covenants: '', confidentiality: 'internal', notes: '',
  })
  const [f, setF] = useState<LoanDraft>(fresh)
  useEffect(() => {
    if (!open) return
    setF(loan ? {
      company_id: loan.company_id, direction: loan.direction, kind: loan.kind, party_id: loan.party_id, name: loan.name, principal: D(loan.principal).toString(), rate_pct: D(loan.rate_pct).toString(), rate_type: loan.rate_type,
      rate_reset_date: loan.rate_reset_date ?? '', start_date: loan.start_date, first_due_date: loan.first_due_date, tenure_months: String(loan.tenure_months), repayment: loan.repayment, loan_account_id: loan.loan_account_id,
      interest_account_id: loan.interest_account_id, sanction_ref: loan.sanction_ref ?? '', security: loan.security ?? '', covenants: loan.covenants ?? '', confidentiality: loan.confidentiality, notes: loan.notes ?? '',
    } : fresh())
  }, [open, loan?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<LoanDraft>) => setF((x) => ({ ...x, ...patch }))

  const taken = f.direction === 'borrowed'
  const moved = !!loan && D(loan.disbursed_amount).gt(0)
  const loanLedgers = useMemo(() => postingLedgers(accounts, f.company_id, [taken ? 'liability' : 'asset'], taken ? ['loan', 'borrowing'] : ['loan', 'other_current_asset']), [accounts, f.company_id, taken])
  const interestLedgers = useMemo(() => postingLedgers(accounts, f.company_id, [taken ? 'expense' : 'income'], taken ? ['finance_cost'] : ['other_income']), [accounts, f.company_id, taken])
  const people = useMemo(() => parties.filter((p) => (p.roles.some((r) => r.company_id === f.company_id) || p.id === f.party_id) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, f.company_id, f.party_id])
  const manage = !!f.company_id && can('treasury.manage', f.company_id)
  const tenure = Number(f.tenure_months)
  const kinds = LOAN_KINDS.some(([k]) => k === f.kind) ? LOAN_KINDS : [...LOAN_KINDS, [f.kind, human(f.kind)] as [string, string]]

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company.')
  if (!f.party_id) problems.push(taken ? 'Choose the lender.' : 'Choose the borrower.')
  if (!f.name.trim()) problems.push('Give the loan a name.')
  if (D(f.principal).lte(0)) problems.push('Enter the principal.')
  if (!Number.isInteger(tenure) || tenure <= 0) problems.push('Enter the tenure in whole months.')
  if (!f.start_date || !f.first_due_date || f.first_due_date < f.start_date) problems.push('The first instalment cannot fall before the start date.')
  if (!f.loan_account_id) problems.push('Choose the loan ledger.')
  if (!f.interest_account_id) problems.push('Choose the interest ledger.')

  const save = async () => {
    const input: LoanInput = {
      id: loan?.id, company_id: f.company_id, direction: f.direction, kind: f.kind, party_id: f.party_id, name: f.name.trim(), principal: f.principal, rate_pct: f.rate_pct || 0, rate_type: f.rate_type,
      rate_reset_date: f.rate_type === 'floating' && f.rate_reset_date ? f.rate_reset_date : null, start_date: f.start_date, first_due_date: f.first_due_date, tenure_months: tenure, repayment: f.repayment,
      loan_account_id: f.loan_account_id, interest_account_id: f.interest_account_id, sanction_ref: f.sanction_ref.trim() || null, security: f.security.trim() || null, covenants: f.covenants.trim() || null,
      confidentiality: f.confidentiality, notes: f.notes.trim() || null,
    }
    const id = await act(() => api.saveLoan(input), loan ? 'Loan updated' : 'Loan recorded as a draft. Record its disbursement to propose the accounting entry.')
    if (id) { onClose(); onSaved?.(id) }
  }

  return (
    <Drawer open={open} onClose={onClose} width={660} title={loan ? `Edit ${loan.loan_no}` : 'New loan'} subtitle="Saving records the loan and builds its repayment schedule. It does not post anything to the ledger."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !manage} title={!manage ? 'You need the permission treasury.manage in this company' : problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button></>}>
      {moved && <Note kind="warn" className="mb-4">Money has already moved on this loan. Its amount, rate, tenure, first due date, repayment method and loan ledger can no longer be changed here.</Note>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <select className="field" value={f.company_id} disabled={!!loan} onChange={(e) => set({ company_id: e.target.value, party_id: '', loan_account_id: '', interest_account_id: '' })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        </Field>
        <Field label="Direction">
          <select className="field" value={f.direction} disabled={moved} onChange={(e) => set({ direction: e.target.value as Loan['direction'], loan_account_id: '', interest_account_id: '' })}><option value="borrowed">Loan taken — the company borrows</option><option value="lent">Loan given — the company lends</option></select>
        </Field>
        <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label={taken ? 'Lender' : 'Borrower'} hint="From People & Parties">
          <select className="field" value={f.party_id} onChange={(e) => set({ party_id: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
        </Field>
        <Field label="Name" className="sm:col-span-2"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="What the loan is for" /></Field>
        <Field label="Principal"><input className="field num" inputMode="decimal" value={f.principal} disabled={moved} onChange={(e) => set({ principal: digits(e.target.value) })} /></Field>
        <Field label="Rate % a year"><input className="field num" inputMode="decimal" value={f.rate_pct} disabled={moved} onChange={(e) => set({ rate_pct: digits(e.target.value) })} /></Field>
        <Field label="Rate type" hint={f.rate_type === 'floating' ? 'Scheduled interest is indicative; the lender\'s statement is the authority.' : undefined}>
          <select className="field" value={f.rate_type} onChange={(e) => set({ rate_type: e.target.value as Loan['rate_type'] })}><option value="fixed">Fixed</option><option value="floating">Floating</option></select>
        </Field>
        {f.rate_type === 'floating' ? <Field label="Rate reset date"><input type="date" className="field" value={f.rate_reset_date} onChange={(e) => set({ rate_reset_date: e.target.value })} /></Field> : <div className="hidden sm:block" />}
        <Field label="Start date"><input type="date" className="field" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
        <Field label="First due date"><input type="date" className="field" value={f.first_due_date} disabled={moved} onChange={(e) => set({ first_due_date: e.target.value })} /></Field>
        <Field label="Tenure in months"><input className="field num" inputMode="numeric" value={f.tenure_months} disabled={moved} onChange={(e) => set({ tenure_months: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Repayment"><select className="field" value={f.repayment} disabled={moved} onChange={(e) => set({ repayment: e.target.value as Loan['repayment'] })}>{(Object.keys(REPAYMENT_LABEL) as Loan['repayment'][]).map((k) => <option key={k} value={k}>{REPAYMENT_LABEL[k]}</option>)}</select></Field>
        <Field label="Loan ledger" hint={taken ? 'A loan taken is money the company owes, so it sits in a liability ledger.' : 'A loan given is money owed to the company, so it sits in an asset ledger.'}>
          <select className="field" value={f.loan_account_id} disabled={moved} onChange={(e) => set({ loan_account_id: e.target.value })}><option value="">Choose…</option>{loanLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Interest ledger" hint={taken ? 'Interest on a loan taken is a cost, so it sits in an expense ledger.' : 'Interest on a loan given is earned, so it sits in an income ledger.'}>
          <select className="field" value={f.interest_account_id} onChange={(e) => set({ interest_account_id: e.target.value })}><option value="">Choose…</option>{interestLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Sanction reference"><input className="field" value={f.sanction_ref} onChange={(e) => set({ sanction_ref: e.target.value })} /></Field>
        <Field label="Confidentiality" hint="People without clearance for the chosen level do not receive this record.">
          <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
        </Field>
        <Field label="Security" className="sm:col-span-2"><input className="field" value={f.security} onChange={(e) => set({ security: e.target.value })} placeholder="What has been pledged or hypothecated" /></Field>
        <Field label="Covenants" className="sm:col-span-2"><textarea className="field" rows={2} value={f.covenants} onChange={(e) => set({ covenants: e.target.value })} placeholder="Conditions the borrower has agreed to keep" /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {problems.length > 0 && (f.name || f.principal) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}
