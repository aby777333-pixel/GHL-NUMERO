import Decimal from 'decimal.js'
import { D, ZERO, round2, sum } from '@/lib/money'
import { addDays, daysBetween, endOfMonth, fiscalYearOf, parseISO, startOfMonth, today } from '@/lib/dates'
import type {
  Account, Alert, ApprovalRequest, ApprovalRule, AuditEntry, BankAccount, BankSuggestion, BankTxn, BankTxnStatus, Budget, BudgetLine,
  Company, CompanyCreatePayload, Confidentiality, CustomFieldDef, DocType, FiscalPeriod, Group, ID, IntegrityReport, Invoice, InvoiceInput,
  Journal, JournalDetail, JournalInput, JournalLineInput, LedgerBalanceRow, LedgerFilter, LedgerLine, LedgerLinesResult, LedgerMonthlyRow,
  Member, NumiRule, OrgUnit, Party, PartyBalanceRow, PartyBank, Payment, PaymentInput, Requirement, Role, SessionInfo, TaxCode, TypeDef,
} from '@/engine/types'
import { NumeroError } from '@/engine/types'
import type { CoreApi, CreatePartyResult, JournalFilter, PartyInput } from './types'
import { ALL_PERMS } from '@/engine/opsTypes'

// =====================================================================
// DEMO LEDGER ENGINE
// A complete in-browser double-entry engine that enforces the same
// invariants as the database: balanced postings, immutable posted
// history, reversal-only corrections, period locks, maker-checker,
// idempotent event posting. All data it holds is SAMPLE DATA and is
// labelled DEMO everywhere in the interface (spec 1516).
// =====================================================================

let idSource: (() => ID) | null = null
export const uid = (): ID =>
  idSource?.() ??
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

/**
 * Runs `build` with ids taken from a sequence fixed by `seed`, then returns to random ids.
 * The sample data is built the same way every time on the same day, so with the day as the seed each record keeps
 * its id when the page is reloaded, and a link to it still leads to it. A link from another day finds nothing, rather
 * than another record. Records a person creates afterwards take random ids as always.
 */
export async function withFixedIds<T>(seed: string, build: () => Promise<T>): Promise<T> {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const previous = idSource
  idSource = () => {
    const s = hex(next()) + hex(next()) + hex(next()) + hex(next())
    // shaped as a version-4 UUID, as the database would give
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${((parseInt(s[16], 16) & 0x3) | 0x8).toString(16)}${s.slice(17, 20)}-${s.slice(20, 32)}`
  }
  try { return await build() } finally { idSource = previous }
}

export interface StoredLine {
  id: ID; journal_id: ID; company_id: ID; line_no: number; account_id: ID; party_id: ID | null
  description: string | null; debit: string; credit: string
  txn_currency: string | null; txn_amount: string | null; fx_rate: string | null
  dims: Record<string, ID>
}
interface StoredInvoiceLine { id: ID; invoice_id: ID; line_no: number; description: string; account_id: ID; quantity: string; rate: string; amount: string; tax_code_id: ID | null; tax_amount: string; hsn_sac?: string; dims: Record<string, ID>; po_line_id?: ID | null }
interface ApprovalAction { request_id: ID; step: number; actor: ID; action: string; comment: string | null; at: string }

export const fail = (m: string, code = 'P0001'): never => { throw new NumeroError(m, code) }
const normName = (t: string) => t.toLowerCase().replace(/\bprivate\b/g, 'pvt').replace(/\blimited\b/g, 'ltd').replace(/[^a-z0-9]/g, '')
const CONF_RANK: Record<string, number> = { internal: 0, confidential: 1, highly_confidential: 2, restricted: 3, super_admin_only: 4 }

export const DEMO_USERS: Record<ID, { name: string; email: string; role: string }> = {
  'demo-owner': { name: 'Demo Owner', email: 'owner@demo.numero', role: 'Group Super Admin' },
  'demo-accountant': { name: 'Priya Raman', email: 'priya@demo.numero', role: 'Accountant' },
  'demo-finance': { name: 'Arun Mehta', email: 'arun@demo.numero', role: 'Finance Head' },
  'demo-cfo': { name: 'Meera Iyer', email: 'meera@demo.numero', role: 'Group CFO' },
}


export class DemoCore implements CoreApi {
  readonly mode = 'demo' as const
  actor: ID = 'demo-owner'
  /** clock override used only while seeding historical sample data */
  clock: string | null = null

  group: Group = { id: 'demo-group', name: 'GHL Group', base_currency: 'INR', settings: { controls: { maker_checker: 'owner_override' }, sentinel: { timezone: 'Asia/Kolkata', large_payment: 500000, round_number_unit: 100000 } } }
  companies: Company[] = []
  accounts: Account[] = []
  accountMap = new Map<ID, Record<string, ID>>()
  orgUnits: OrgUnit[] = []
  orgUnitTypes: TypeDef[] = ['business_unit:Business Unit', 'branch:Branch', 'office:Office', 'department:Department', 'division:Division', 'cost_centre:Cost Centre', 'profit_centre:Profit Centre', 'project:Project', 'property:Property / Site', 'fund:Fund / Scheme', 'portfolio:Portfolio', 'warehouse:Warehouse', 'store:Store', 'team:Team', 'vehicle:Vehicle', 'equipment:Equipment', 'trip:Trip', 'campaign:Campaign', 'contract:Contract', 'event:Event', 'path:Financial Path']
    .map((s, i) => ({ key: s.split(':')[0], name: s.split(':')[1], sort: (i + 1) * 10 }))
  partyTypes: TypeDef[] = ['customer:Customer:CUS:customer', 'client:Client:CUS:customer', 'vendor:Vendor:VEN:vendor', 'supplier:Supplier:VEN:vendor', 'employee:Employee:EMP:employee', 'director:Director:PER:other', 'shareholder:Shareholder:PER:investor', 'investor:Investor:INV:investor', 'agent:Agent:AGT:agent', 'broker:Broker:BRK:broker', 'sub_broker:Sub-Broker:BRK:broker', 'referral_partner:Referral Partner:AGT:agent', 'channel_partner:Channel Partner:PTN:partner', 'consultant:Consultant:CON:consultant', 'freelancer:Freelancer:FRL:freelancer', 'contractor:Contractor:CTR:contractor', 'subcontractor:Subcontractor:CTR:contractor', 'landlord:Landlord:LND:other', 'tenant:Tenant:TNT:customer', 'transporter:Transporter:LOG:vendor', 'bank:Bank:BNK:bank', 'lender:Lender:BNK:bank', 'government:Government / Regulator:GOV:government', 'insurer:Insurance Company:INS:vendor', 'group_company:Group Company:GRP:group', 'related_party:Related Party:REL:other', 'other:Other:PTY:other']
    .map((s) => { const [key, name, prefix, category] = s.split(':'); return { key, name, prefix, category } })
  voucherTypes: TypeDef[] = ['journal:Journal Voucher:JV', 'payment:Payment Voucher:PV', 'receipt:Receipt Voucher:RV', 'contra:Contra Voucher:CV', 'purchase:Purchase Voucher:PU', 'sales:Sales Voucher:SV', 'debit_note:Debit Note:DN', 'credit_note:Credit Note:CN', 'expense:Expense Voucher:EV', 'petty_cash:Petty Cash Voucher:PC', 'adjustment:Adjustment Journal:AJ', 'accrual:Accrual Journal:AC', 'depreciation:Depreciation Journal:DP', 'reclassification:Reclassification Journal:RC', 'intercompany:Intercompany Journal:IC', 'closing:Closing Journal:CL', 'reversal:Reversal Journal:RJ', 'correction:Correction Journal:CJ', 'fx:Foreign Exchange Journal:FX', 'consolidation:Consolidation Journal:CO', 'opening:Opening Balance:OB']
    .map((s) => { const [key, name, prefix] = s.split(':'); return { key, name, prefix } })
  taxCodes: TaxCode[] = []
  parties: Party[] = []
  partyBanks: PartyBank[] = []
  journals: Journal[] = []
  lines: StoredLine[] = []
  linesByJournal = new Map<ID, StoredLine[]>()
  invoices: Invoice[] = []
  invoiceLines: StoredInvoiceLine[] = []
  payments: Payment[] = []
  bankAccounts: BankAccount[] = []
  bankTxns: (BankTxn & { fingerprint: string })[] = []
  periods: FiscalPeriod[] = []
  approvalRules: ApprovalRule[] = []
  approvalRequests: ApprovalRequest[] = []
  approvalActions: ApprovalAction[] = []
  budgets: Budget[] = []
  budgetLines: BudgetLine[] = []
  alerts: (Alert & { dedupe_key: string })[] = []
  audit: AuditEntry[] = []
  numiRules: NumiRule[] = []
  customFields: CustomFieldDef[] = []
  seq = new Map<string, number>()
  idem = new Map<string, ID>()
  protected listeners = new Set<() => void>()
  signedIn = true

  // ------------------------------------------------------------ helpers
  now() { return this.clock ?? new Date().toISOString() }
  protected nextSeq(key: string) { const n = (this.seq.get(key) ?? 0) + 1; this.seq.set(key, n); return n }
  company(id: ID) { return this.companies.find((c) => c.id === id) ?? fail('company not found.') }
  account(id: ID) { return this.accounts.find((a) => a.id === id) }
  protected isAdmin() { return this.actor === 'demo-owner' }
  protected log(company_id: ID | null, entity: string, entity_id: ID | null, action: string, old_value: unknown, new_value: unknown, reason: string | null = null) {
    this.audit.push({ id: this.audit.length + 1, at: this.now(), actor: this.actor, actor_name: DEMO_USERS[this.actor]?.name ?? this.actor, company_id, entity, entity_id, action, old_value, new_value, reason })
  }
  protected mapAccount(companyId: ID, key: string): ID {
    return this.accountMap.get(companyId)?.[key] ?? fail(`this company has no "${key}" account configured. Set it under Chart of Accounts → Account Mapping.`)
  }
  /** Black Vault grants: the highest level a person other than the Group Super Admin may open */
  vaultGrants: Record<ID, string> = { 'demo-finance': 'confidential', 'demo-cfo': 'confidential' }
  protected canViewLevel(level: string) {
    if (level === 'internal' || this.isAdmin()) return true
    if (level === 'super_admin_only') return false
    const g = this.vaultGrants[this.actor]
    return !!g && CONF_RANK[g] >= (CONF_RANK[level] ?? 9)
  }
  protected makerChecker(maker: ID | null, what: string): 'approve' | 'override' {
    if (maker !== this.actor) return 'approve'
    if (this.group.settings.controls?.maker_checker === 'owner_override' && this.isAdmin()) return 'override'
    return fail(`maker-checker control — the person who created this ${what} cannot also approve it.`, '42501')
  }

  // ------------------------------------------------------------ workflow hooks (implemented by the operations layer)
  /** true when the journal was prepared by an operational workflow */
  protected hasWorkflow(_journalId: ID, _state?: 'pending' | 'posted'): boolean { return false }
  /** tells the source record that its journal was posted, voided or reversed; may refuse by throwing */
  protected wfDispatch(_journalId: ID, _event: 'posted' | 'voided' | 'reversed', _reason?: string): void { /* no workflow in the core */ }
  /** keeps a Phase 1 document truthful when its journal is reversed */
  protected onDocumentReversed(j: Journal, reason: string) {
    if (j.source === 'invoice') {
      const inv = this.invoices.find((i) => i.journal_id === j.id)
      if (!inv) return
      if (D(inv.amount_settled).gt(0)) fail(`${inv.doc_no} has settlements of ${inv.amount_settled} recorded against it. Reverse those receipts or payments first.`)
      const old = inv.status
      inv.status = 'cancelled'
      this.log(inv.company_id, 'invoices', inv.id, 'cancelled_by_reversal', { status: old }, { status: 'cancelled' }, reason)
    } else if (j.source === 'payment' || j.source === 'receipt') {
      const pay = this.payments.find((x) => x.journal_id === j.id)
      if (!pay) return
      for (const a of pay.allocations ?? []) {
        const inv = this.invoices.find((i) => i.id === a.invoice_id)
        if (!inv) continue
        const left = Decimal.max(D(inv.amount_settled).minus(a.amount), 0)
        inv.amount_settled = left.toString()
        if (inv.status !== 'cancelled') inv.status = left.lte(0) ? 'open' : 'partially_paid'
      }
      const old = pay.status
      pay.status = 'cancelled'
      this.log(pay.company_id, 'payments', pay.id, 'cancelled_by_reversal', { status: old }, { status: 'cancelled' }, reason)
    }
  }

  // ------------------------------------------------------------ periods
  protected ensurePeriod(companyId: ID, date: string): FiscalPeriod {
    let p = this.periods.find((x) => x.company_id === companyId && date >= x.period_start && date <= x.period_end)
    if (!p) {
      p = { id: uid(), company_id: companyId, period_start: startOfMonth(date), period_end: endOfMonth(date), status: 'open' }
      this.periods.push(p)
    }
    return p
  }
  protected assertPeriodOpen(companyId: ID, date: string) {
    const p = this.ensurePeriod(companyId, date)
    if (p.status === 'locked') fail(`the accounting period ${p.period_start} to ${p.period_end} is locked. Posting refused.`)
  }
  async listPeriods(companyIds: ID[]) { return this.periods.filter((p) => companyIds.includes(p.company_id)).sort((a, b) => b.period_start.localeCompare(a.period_start)) }
  async setPeriodStatus(companyId: ID, date: string, status: FiscalPeriod['status'], reason?: string) {
    const p = this.ensurePeriod(companyId, date)
    if (p.status === status) return
    if (p.status === 'locked' && !(reason ?? '').trim()) fail('a reason is required to reopen a locked period.')
    const old = p.status
    p.status = status; p.changed_at = this.now(); p.reason = reason ?? null
    this.log(companyId, 'fiscal_periods', p.id, 'period_' + status, { status: old }, { status, period_start: p.period_start, period_end: p.period_end }, reason ?? null)
  }

  // ------------------------------------------------------------ session
  async getSession(): Promise<SessionInfo | null> {
    if (!this.signedIn) return null
    const u = DEMO_USERS[this.actor]
    return {
      user: { id: this.actor, email: u.email, name: u.name },
      group: this.group, isGroupAdmin: this.isAdmin(),
      permissions: Object.fromEntries(this.companies.map((c) => [c.id, ALL_PERMS])),
    }
  }
  async signIn() { this.signedIn = true; this.listeners.forEach((l) => l()) }
  async signUp() { this.signedIn = true; return { needsEmailConfirmation: false } }
  async signOut() { this.signedIn = false; this.listeners.forEach((l) => l()) }
  onAuthChange(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  async bootstrapGroup(name: string, currency: string, makerChecker: 'enforced' | 'owner_override') {
    this.group = { ...this.group, name, base_currency: currency, settings: { ...this.group.settings, controls: { maker_checker: makerChecker } } }
    return this.group.id
  }
  async updateGroupSettings(patch: Partial<Group['settings']>) {
    const old = this.group.settings
    this.group = { ...this.group, settings: { ...old, ...patch, controls: { ...old.controls, ...(patch.controls ?? {}) }, sentinel: { ...old.sentinel, ...(patch.sentinel ?? {}) } } }
    this.log(null, 'groups', this.group.id, 'update', old, this.group.settings, 'Group settings changed')
  }

  // ------------------------------------------------------------ master data
  async listCompanies() { return [...this.companies] }
  async createCompany(p: CompanyCreatePayload): Promise<ID> {
    const c = p.company
    if (!c.name?.trim() || !c.code?.trim()) fail('company name and code are required.')
    if (this.companies.some((x) => x.code === c.code.toUpperCase())) fail(`a company with code ${c.code.toUpperCase()} already exists.`)
    const id = uid()
    this.companies.push({
      id, group_id: this.group.id, code: c.code.toUpperCase().trim(), name: c.name.trim(), legal_name: c.legal_name ?? null,
      business_type: c.business_type ?? null, industry: c.industry ?? null, country: c.country ?? 'IN', state: c.state ?? null,
      registered_address: c.registered_address ?? null, pan: c.pan ?? null, gstin: c.gstin ?? null, cin: c.cin ?? null,
      fy_start_month: c.fy_start_month ?? 4, base_currency: c.base_currency ?? 'INR', accounting_method: c.accounting_method ?? 'accrual',
      modules: c.modules ?? {}, template_key: c.template_key ?? null, status: 'active', created_at: this.now(),
    })
    const byCode = new Map<string, ID>()
    for (const a of p.accounts) {
      const aid = uid(); byCode.set(a.code, aid)
      this.accounts.push({ id: aid, company_id: id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, parent_id: null, is_group: !!a.is_group, currency: null, control_type: a.control_type ?? null, counterparty_company_id: null, is_active: true, description: a.description ?? null })
    }
    for (const a of p.accounts) if (a.parent_code) { const acc = this.account(byCode.get(a.code)!)!; acc.parent_id = byCode.get(a.parent_code) ?? null }
    const map: Record<string, ID> = {}
    for (const [k, code] of Object.entries(p.account_map)) map[k] = byCode.get(code) ?? fail(`account map "${k}" points to unknown account code ${code}.`)
    this.accountMap.set(id, map)
    for (const t of p.tax_codes) {
      this.taxCodes.push({ id: uid(), company_id: id, code: t.code, name: t.name, kind: t.kind ?? 'gst', jurisdiction: 'IN', is_active: true,
        components: t.components.map((k) => ({ id: uid(), component: k.component, rate: k.rate, output_account_id: byCode.get(k.output_code ?? '') ?? null, input_account_id: byCode.get(k.input_code ?? '') ?? null, effective_from: '2000-01-01', effective_to: null })) })
    }
    for (const u of p.org_units ?? []) this.orgUnits.push({ id: uid(), company_id: id, type_key: u.type_key, parent_id: null, code: u.code, name: u.name, status: 'active', confidentiality: 'internal', meta: {} })
    this.log(id, 'companies', id, 'company_created', null, { template: c.template_key, accounts: p.accounts.length }, 'Company created with user-confirmed configuration')
    return id
  }
  async updateCompany(id: ID, patch: Partial<Company>) {
    const c = this.company(id); const old = { ...c }
    Object.assign(c, patch, { id: c.id, group_id: c.group_id })
    this.log(id, 'companies', id, 'update', old, { ...c }, null)
  }
  async listAccounts(companyIds: ID[]) { return this.accounts.filter((a) => companyIds.includes(a.company_id)) }
  async createAccount(a: Parameters<CoreApi['createAccount']>[0]) {
    if (this.accounts.some((x) => x.company_id === a.company_id && x.code === a.code)) fail(`account code ${a.code} already exists in this company.`)
    const id = uid()
    const acc: Account = { id, company_id: a.company_id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, parent_id: a.parent_id ?? null, is_group: !!a.is_group, currency: a.currency ?? null, control_type: a.control_type ?? null, counterparty_company_id: a.counterparty_company_id ?? null, is_active: true, description: a.description ?? null }
    this.accounts.push(acc)
    this.log(a.company_id, 'accounts', id, 'insert', null, acc, null)
    return id
  }
  async updateAccount(id: ID, patch: Partial<Account>) {
    const acc = this.account(id) ?? fail('account not found.')
    const old = { ...acc }
    const used = this.lines.some((l) => l.account_id === id)
    if (used && patch.type && patch.type !== acc.type) fail('the type of an account that already carries postings cannot be changed. Create a new account and reclassify.')
    Object.assign(acc, patch, { id: acc.id, company_id: acc.company_id })
    this.log(acc.company_id, 'accounts', id, 'update', old, { ...acc }, null)
  }
  async listAccountMap(companyIds: ID[]) {
    return companyIds.flatMap((c) => Object.entries(this.accountMap.get(c) ?? {}).map(([key, account_id]) => ({ company_id: c, key, account_id })))
  }
  async setAccountMap(companyId: ID, key: string, accountId: ID) {
    const a = this.account(accountId)
    if (!key.trim()) fail('a mapping key is required.')
    if (!a || a.company_id !== companyId || a.is_group || !a.is_active) fail('choose an active posting account of this company.')
    const map = this.accountMap.get(companyId) ?? {}
    const old = map[key] ?? null
    map[key] = accountId
    this.accountMap.set(companyId, map)
    this.log(companyId, 'company_account_map', null, old ? 'update' : 'insert', old ? { key, account_id: old } : null, { key, account_id: accountId }, null)
  }
  async listOrgUnits(companyIds: ID[]) { return this.orgUnits.filter((u) => companyIds.includes(u.company_id)) }
  async createOrgUnit(u: Parameters<CoreApi['createOrgUnit']>[0]) {
    if (this.orgUnits.some((x) => x.company_id === u.company_id && x.type_key === u.type_key && x.code === u.code)) fail(`${u.type_key} code ${u.code} already exists.`)
    const id = uid()
    const unit: OrgUnit = { id, company_id: u.company_id, type_key: u.type_key, parent_id: u.parent_id ?? null, code: u.code, name: u.name, status: 'active', confidentiality: u.confidentiality ?? 'internal', meta: u.meta ?? {} }
    this.orgUnits.push(unit)
    this.log(u.company_id, 'org_units', id, 'insert', null, unit, null)
    return id
  }
  async listOrgUnitTypes() { return this.orgUnitTypes }
  async createOrgUnitType(t: { key: string; name: string }) {
    if (this.orgUnitTypes.some((x) => x.key === t.key)) fail('this structure level already exists.')
    this.orgUnitTypes.push({ ...t, sort: 500, group_id: this.group.id })
  }
  async listPartyTypes() { return this.partyTypes }
  async createPartyType(t: { key: string; name: string; prefix: string; category: string }) {
    if (this.partyTypes.some((x) => x.key === t.key)) fail('this party type already exists.')
    this.partyTypes.push({ ...t, group_id: this.group.id })
  }
  async listVoucherTypes() { return this.voucherTypes }
  async listTaxCodes(companyIds: ID[]) { return this.taxCodes.filter((t) => companyIds.includes(t.company_id)) }
  async saveTaxCode(t: Parameters<CoreApi['saveTaxCode']>[0]) {
    const existing = this.taxCodes.find((x) => x.company_id === t.company_id && x.code === t.code)
    const comps = t.components.map((k) => ({ id: uid(), component: k.component, rate: k.rate, output_account_id: k.output_account_id ?? null, input_account_id: k.input_account_id ?? null, effective_from: k.effective_from ?? '2000-01-01', effective_to: null }))
    if (existing) {
      // rates are versioned by effective date: earlier components are end-dated, never overwritten
      const from = comps[0]?.effective_from ?? today()
      existing.components.forEach((c) => { if (!c.effective_to && (c.effective_from ?? '') < from) c.effective_to = addDays(from, -1) })
      existing.components.push(...comps); existing.name = t.name
      this.log(t.company_id, 'tax_codes', existing.id, 'update', null, t, 'Tax rate version added')
      return existing.id
    }
    const id = uid()
    this.taxCodes.push({ id, company_id: t.company_id, code: t.code, name: t.name, kind: t.kind, jurisdiction: 'IN', is_active: true, components: comps })
    this.log(t.company_id, 'tax_codes', id, 'insert', null, t, null)
    return id
  }

  // ------------------------------------------------------------ parties
  async listParties() { return this.parties.map((p) => ({ ...p })) }
  async createParty(p: PartyInput): Promise<CreatePartyResult> {
    if (!p.display_name?.trim()) fail('party name is required.')
    const type = this.partyTypes.find((t) => t.key === p.type_key) ?? fail(`unknown party type ${p.type_key}.`)
    if (!p.force) {
      const n = normName(p.display_name)
      const cand = this.parties.filter((x) => normName(x.display_name) === n || (p.pan && x.pan?.toUpperCase() === p.pan.toUpperCase()) || (p.gstin && x.gstin?.toUpperCase() === p.gstin.toUpperCase()))
      if (cand.length) return { status: 'possible_duplicate', candidates: cand.map((c) => ({ id: c.id, party_no: c.party_no, display_name: c.display_name })), restricted_matches: 0 }
    }
    const no = this.nextSeq('party:' + type.prefix)
    const id = uid()
    const party_no = `NUM-${type.prefix}-${String(no).padStart(6, '0')}`
    const party: Party = {
      id, group_id: this.group.id, party_no, kind: p.kind ?? 'organization', display_name: p.display_name.trim(), legal_name: p.legal_name ?? null,
      pan: p.pan?.toUpperCase() || null, gstin: p.gstin?.toUpperCase() || null, email: p.email || null, phone: p.phone || null, status: 'active', notes: p.notes ?? null, created_at: this.now(),
      roles: [{ id: uid(), party_id: id, company_id: p.company_id, type_key: type.key, status: 'active', credit_limit: p.credit_limit ?? null, credit_days: p.credit_days ?? null, payment_terms: p.payment_terms ?? null }],
    }
    this.parties.push(party)
    this.log(p.company_id, 'parties', id, 'insert', null, { party_no, display_name: party.display_name, type: type.key }, null)
    return { status: 'created', id, party_no }
  }
  async addPartyRole(partyId: ID, companyId: ID, typeKey: string) {
    const p = this.parties.find((x) => x.id === partyId) ?? fail('party not found.')
    if (!p.roles.some((r) => r.company_id === companyId && r.type_key === typeKey)) {
      p.roles.push({ id: uid(), party_id: partyId, company_id: companyId, type_key: typeKey, status: 'active' })
      this.log(companyId, 'party_roles', partyId, 'insert', null, { type_key: typeKey }, null)
    }
  }
  async setPartyStatus(partyId: ID, status: Party['status'], reason: string) {
    const p = this.parties.find((x) => x.id === partyId) ?? fail('party not found.')
    if (!reason?.trim()) fail('a reason is required.')
    const old = p.status
    p.status = status; p.status_reason = reason
    this.log(p.roles[0]?.company_id ?? null, 'parties', partyId, 'status_' + status, { status: old }, { status }, reason)
  }
  async partyLedgerBalances(companyIds: ID[], to: string): Promise<PartyBalanceRow[]> {
    const m = new Map<string, { d: Decimal; c: Decimal; row: Omit<PartyBalanceRow, 'debit' | 'credit'> }>()
    const posted = new Map(this.journals.filter((j) => (j.status === 'posted' || j.status === 'reversed') && j.journal_date <= to).map((j) => [j.id, j]))
    for (const l of this.lines) {
      if (!l.party_id || !companyIds.includes(l.company_id) || !posted.has(l.journal_id)) continue
      const a = this.account(l.account_id)
      if (!a?.control_type) continue
      const k = `${l.company_id}|${l.party_id}|${a.control_type}`
      const cur = m.get(k) ?? { d: ZERO, c: ZERO, row: { company_id: l.company_id, party_id: l.party_id, control_type: a.control_type } }
      cur.d = cur.d.plus(l.debit); cur.c = cur.c.plus(l.credit)
      m.set(k, cur)
    }
    return [...m.values()].map((v) => ({ ...v.row, debit: v.d.toString(), credit: v.c.toString() }))
  }
  async listPartyBanks(partyId: ID) { return this.partyBanks.filter((b) => b.party_id === partyId) }
  async addPartyBank(p: Parameters<CoreApi['addPartyBank']>[0]) {
    const party = this.parties.find((x) => x.id === p.party_id) ?? fail('party not found.')
    const had = this.partyBanks.some((b) => b.party_id === p.party_id && b.company_id === p.company_id && b.status === 'verified')
    const id = uid()
    this.partyBanks.push({ id, party_id: p.party_id, company_id: p.company_id, bank_name: p.bank_name, account_no: p.account_no, ifsc: p.ifsc ?? null, beneficiary_name: p.beneficiary_name, status: 'pending_verification', created_by: this.actor, created_at: this.now() })
    this.raise(p.company_id, 'bank_detail_change', had ? 'priority' : 'review', 'BANK DETAIL CHANGE ALERT',
      had ? `New bank details were entered for ${party.display_name}, which already has verified bank details. Payments cannot use the new details until an independent person verifies them.`
          : `Bank details were entered for ${party.display_name} and await independent verification before any payment can use them.`,
      { party_id: p.party_id, bank_account_id: id }, 'party_bank_accounts', id, 'bankchange:' + id)
    this.log(p.company_id, 'party_bank_accounts', id, 'insert', null, { bank_name: p.bank_name, beneficiary_name: p.beneficiary_name }, null)
    return id
  }
  async verifyPartyBank(id: ID, decision: 'verified' | 'rejected', note?: string) {
    const b = this.partyBanks.find((x) => x.id === id) ?? fail('bank detail record not found.')
    if (b.status !== 'pending_verification') fail('this record is not awaiting verification.')
    const action = this.makerChecker(b.created_by ?? null, 'bank detail change')
    if (decision === 'verified') this.partyBanks.forEach((x) => { if (x.party_id === b.party_id && x.company_id === b.company_id && x.status === 'verified') x.status = 'superseded' })
    b.status = decision; b.verified_by = this.actor; b.verified_at = this.now()
    this.alerts.forEach((a) => { if (a.entity === 'party_bank_accounts' && a.entity_id === id && (a.status === 'open' || a.status === 'reviewing')) { a.status = 'resolved'; a.review_note = 'Bank details ' + decision } })
    this.log(b.company_id, 'party_bank_accounts', id, 'bank_' + decision, { status: 'pending_verification' }, { status: decision }, (note ?? '') + (action === 'override' ? ' [Owner self-verification override]' : ''))
  }

  // ------------------------------------------------------------ journals
  protected writeLines(journalId: ID, companyId: ID, input: JournalLineInput[]): Decimal {
    const old = this.linesByJournal.get(journalId) ?? []
    if (old.length) { const ids = new Set(old.map((l) => l.id)); this.lines = this.lines.filter((l) => !ids.has(l.id)) }
    let total = ZERO
    const out: StoredLine[] = []
    input.forEach((l, i) => {
      const no = i + 1
      const acc = this.account(l.account_id)
      if (!acc || acc.company_id !== companyId) fail(`line ${no} uses an account that does not belong to this company.`)
      if (acc!.is_group) fail(`line ${no} — "${acc!.name}" is a group heading and cannot receive postings.`)
      if (!acc!.is_active) fail(`line ${no} — account "${acc!.name}" is inactive.`)
      if (l.party_id && !this.parties.some((p) => p.id === l.party_id)) fail(`line ${no} references an unknown party.`)
      const debit = D(l.debit).toDecimalPlaces(4); const credit = D(l.credit).toDecimalPlaces(4)
      if (debit.lt(0) || credit.lt(0) || debit.isZero() === credit.isZero()) fail(`line ${no} must carry either a debit or a credit amount (not both, not neither).`)
      for (const [k, v] of Object.entries(l.dims ?? {})) if (v && !this.orgUnits.some((u) => u.id === v && u.company_id === companyId)) fail(`line ${no} references a dimension (${k}) outside this company.`)
      out.push({ id: uid(), journal_id: journalId, company_id: companyId, line_no: no, account_id: acc!.id, party_id: l.party_id ?? null, description: l.description ?? null, debit: debit.toString(), credit: credit.toString(), txn_currency: l.txn_currency ?? null, txn_amount: l.txn_amount != null ? String(l.txn_amount) : null, fx_rate: l.fx_rate != null ? String(l.fx_rate) : null, dims: Object.fromEntries(Object.entries(l.dims ?? {}).filter(([, v]) => v)) })
      total = total.plus(debit)
    })
    this.lines.push(...out)
    this.linesByJournal.set(journalId, out)
    return total
  }
  protected assertBalanced(journalId: ID) {
    const ls = this.linesByJournal.get(journalId) ?? []
    if (ls.length < 2) fail('a journal needs at least two lines.')
    const d = sum(ls.map((l) => l.debit)); const c = sum(ls.map((l) => l.credit))
    if (!d.eq(c)) fail(`unbalanced journal. Debits ${d.toFixed(2)} do not equal credits ${c.toFixed(2)}. Posting refused.`)
    if (d.isZero()) fail('journal total is zero.')
    return d
  }
  protected journal(id: ID) { return this.journals.find((j) => j.id === id) ?? fail('journal not found.') }

  async saveJournalDraft(p: JournalInput): Promise<ID> {
    if (!p.journal_date) fail('journal date is required.')
    this.company(p.company_id)
    if (p.confidentiality && !this.canViewLevel(p.confidentiality)) fail('you cannot create records at a confidentiality level you are not cleared for.', '42501')
    if (!p.id && p.idempotency_key) { const e = this.idem.get(p.company_id + '|' + p.idempotency_key); if (e) return e }
    let j: Journal
    if (p.id) {
      j = this.journal(p.id)
      if (this.hasWorkflow(j.id)) fail('this journal was prepared by a workflow and cannot be edited by hand. Reject it and issue it again from its source record.')
      if (j.status !== 'draft' && j.status !== 'rejected') fail(`only drafts can be edited. This journal is ${j.status}.`)
      Object.assign(j, { status: 'draft', voucher_type: p.voucher_type ?? j.voucher_type, journal_date: p.journal_date, narration: p.narration ?? null, purpose: p.purpose ?? null, confidentiality: p.confidentiality ?? j.confidentiality })
    } else {
      j = {
        id: uid(), company_id: p.company_id, voucher_type: p.voucher_type ?? 'journal', voucher_no: null, journal_date: p.journal_date, narration: p.narration ?? null,
        purpose: p.purpose ?? null, status: 'draft', source: p.source ?? 'manual', source_id: p.source_id ?? null, origin: p.origin ?? 'human', reversal_of: null, reversed_by: null,
        confidentiality: p.confidentiality ?? 'internal', total: '0', created_by: this.actor, created_at: this.now(),
      }
      this.journals.push(j)
      if (p.idempotency_key) this.idem.set(p.company_id + '|' + p.idempotency_key, j.id)
    }
    j.total = this.writeLines(j.id, j.company_id, p.lines).toString()
    this.log(j.company_id, 'journals', j.id, 'draft_saved', null, { lines: p.lines.length, total: j.total }, null)
    return j.id
  }
  async submitJournal(id: ID) {
    const j = this.journal(id)
    if (j.status !== 'draft') fail(`only a draft can be submitted. This journal is ${j.status}.`)
    this.assertBalanced(id)
    this.assertPeriodOpen(j.company_id, j.journal_date)
    const total = D(j.total)
    const rule = this.approvalRules
      .filter((r) => r.is_active && r.entity === 'journal' && (r.company_id === j.company_id || r.company_id === null) && total.gte(r.min_amount) && (r.max_amount === null || total.lt(r.max_amount)))
      .sort((a, b) => Number(b.company_id !== null) - Number(a.company_id !== null) || D(b.min_amount).cmp(a.min_amount))[0]
    this.approvalRequests.forEach((r) => { if (r.entity === 'journal' && r.entity_id === id && r.status === 'pending') r.status = 'cancelled' })
    const req: ApprovalRequest = { id: uid(), company_id: j.company_id, entity: 'journal', entity_id: id, amount: j.total, steps: rule?.steps ?? ['*'], current_step: 1, status: 'pending', summary: j.narration, requested_by: this.actor, requested_at: this.now() }
    this.approvalRequests.push(req)
    j.status = 'submitted'; j.submitted_by = this.actor; j.submitted_at = this.now()
    this.log(j.company_id, 'journals', id, 'submitted', null, { approval_request: req.id, steps: req.steps }, null)
  }
  async approveJournal(id: ID, comment?: string): Promise<'approved' | 'pending'> {
    const j = this.journal(id)
    if (j.status !== 'submitted') fail(`this journal is ${j.status} and is not awaiting approval.`)
    const r = this.approvalRequests.find((x) => x.entity === 'journal' && x.entity_id === id && x.status === 'pending') ?? fail('no pending approval request for this journal.')
    if (!this.canViewLevel(j.confidentiality)) fail(`this journal is classified ${j.confidentiality} and you are not cleared to see it. Nobody approves what they cannot read.`, '42501')
    const action = this.makerChecker(j.created_by, 'journal')
    if (action === 'approve' && this.approvalActions.some((a) => a.request_id === r.id && a.actor === this.actor)) fail('you have already approved an earlier step of this request.', '42501')
    const last = r.current_step >= r.steps.length
    if (last && this.hasWorkflow(id, 'pending')) {
      // a workflow journal posts on its final approval: anything that could refuse is checked before the decision is recorded
      this.assertPeriodOpen(j.company_id, j.journal_date)
      this.assertBalanced(id)
    }
    this.approvalActions.push({ request_id: r.id, step: r.current_step, actor: this.actor, action, comment: comment ?? null, at: this.now() })
    if (last) {
      r.status = 'approved'
      j.status = 'approved'; j.approved_by = this.actor; j.approved_at = this.now()
      this.log(j.company_id, 'journals', id, 'approved', null, { action, step: r.current_step }, comment ?? null)
      if (this.hasWorkflow(id, 'pending')) {
        const v = this.doPost(id)
        this.wfDispatch(id, 'posted')
        this.log(j.company_id, 'journals', id, 'posted', null, { voucher_no: v, total: j.total, rule: 'Workflow journal posts on final approval' }, null)
      }
      return 'approved'
    }
    this.log(j.company_id, 'journals', id, 'approval_step', null, { action, step: r.current_step }, comment ?? null)
    r.current_step += 1
    return 'pending'
  }
  async rejectJournal(id: ID, comment: string) {
    const j = this.journal(id)
    if (j.status !== 'submitted') fail('this journal is not awaiting approval.')
    if (!comment?.trim()) fail('a reason is required to reject.')
    const r = this.approvalRequests.find((x) => x.entity === 'journal' && x.entity_id === id && x.status === 'pending')
    if (r) { this.approvalActions.push({ request_id: r.id, step: r.current_step, actor: this.actor, action: 'reject', comment, at: this.now() }); r.status = 'rejected' }
    this.wfDispatch(id, 'voided', comment)
    j.status = 'rejected'
    this.log(j.company_id, 'journals', id, 'rejected', null, null, comment)
  }
  async cancelJournal(id: ID, reason?: string) {
    const j = this.journal(id)
    if (!['draft', 'rejected', 'submitted', 'approved'].includes(j.status)) fail(`a ${j.status} journal cannot be cancelled. Use reversal.`)
    this.approvalRequests.forEach((r) => { if (r.entity === 'journal' && r.entity_id === id && r.status === 'pending') r.status = 'cancelled' })
    this.wfDispatch(id, 'voided', reason)
    j.status = 'cancelled'
    this.log(j.company_id, 'journals', id, 'cancelled', null, null, reason ?? null)
  }
  protected doPost(id: ID): string {
    const j = this.journal(id)
    this.assertPeriodOpen(j.company_id, j.journal_date)
    const total = this.assertBalanced(id)
    const fy = fiscalYearOf(j.journal_date, this.company(j.company_id).fy_start_month)
    const n = this.nextSeq(`v:${j.company_id}:${j.voucher_type}:${fy}`)
    const prefix = this.voucherTypes.find((v) => v.key === j.voucher_type)?.prefix ?? 'JV'
    j.voucher_no = `${prefix}-${fy}-${String(n).padStart(6, '0')}`
    j.status = 'posted'; j.total = total.toString(); j.posted_by = this.actor; j.posted_at = this.now()
    Object.freeze(this.linesByJournal.get(id)) // posted lines are immutable
    this.linesByJournal.get(id)!.forEach((l) => Object.freeze(l))
    return j.voucher_no
  }
  async postJournal(id: ID) {
    const j = this.journal(id)
    if (j.status === 'posted') return j.voucher_no!
    if (j.status !== 'approved') fail(`a journal must be approved before posting. This journal is ${j.status}.`)
    const v = this.doPost(id)
    this.wfDispatch(id, 'posted')
    this.log(j.company_id, 'journals', id, 'posted', null, { voucher_no: v, total: j.total }, null)
    return v
  }
  async reverseJournal(id: ID, date: string, reason: string) {
    const j = this.journal(id)
    if (j.status === 'reversed') fail('this journal has already been reversed.')
    if (j.status !== 'posted') fail('only posted journals can be reversed.')
    if (j.reversal_of) fail('a reversal journal cannot itself be reversed. Post a new correcting journal.')
    if (!reason?.trim()) fail('a reason is required for reversal.')
    const d = date || today()
    this.assertPeriodOpen(j.company_id, d)
    // the source record is consulted first: it may refuse (for example a settled invoice)
    this.onDocumentReversed(j, reason)
    this.wfDispatch(id, 'reversed', reason)
    const n: Journal = { ...j, id: uid(), voucher_type: 'reversal', voucher_no: null, journal_date: d, narration: `Reversal of ${j.voucher_no}: ${reason}`, purpose: reason, status: 'draft', source: 'reversal', source_id: j.id, origin: 'system', reversal_of: j.id, reversed_by: null, created_by: this.actor, created_at: this.now(), approved_by: this.actor, approved_at: this.now(), posted_by: null, posted_at: null, submitted_by: null, submitted_at: null }
    this.journals.push(n)
    this.writeLines(n.id, n.company_id, (this.linesByJournal.get(id) ?? []).map((l) => ({ account_id: l.account_id, party_id: l.party_id, description: l.description, debit: l.credit, credit: l.debit, dims: l.dims, txn_currency: l.txn_currency, txn_amount: l.txn_amount, fx_rate: l.fx_rate })))
    const v = this.doPost(n.id)
    j.status = 'reversed'; j.reversed_by = n.id
    this.log(j.company_id, 'journals', id, 'reversed', { voucher_no: j.voucher_no }, { reversal_journal: n.id, reversal_voucher: v }, reason)
    return n.id
  }
  async listJournals(f: JournalFilter) {
    const q = f.q?.toLowerCase()
    const rows = this.journals
      .filter((j) => f.companyIds.includes(j.company_id) && this.canViewLevel(j.confidentiality))
      .filter((j) => !f.status?.length || f.status.includes(j.status))
      .filter((j) => (!f.from || j.journal_date >= f.from) && (!f.to || j.journal_date <= f.to))
      .filter((j) => !q || (j.narration ?? '').toLowerCase().includes(q) || (j.voucher_no ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.journal_date.localeCompare(a.journal_date) || (b.voucher_no ?? '').localeCompare(a.voucher_no ?? ''))
    const off = f.offset ?? 0
    return { rows: rows.slice(off, off + (f.limit ?? 100)), total: rows.length }
  }
  async openJournal(id: ID): Promise<JournalDetail> {
    const j = this.journal(id)
    const names = (ids: (ID | null | undefined)[]) => Object.fromEntries(ids.filter(Boolean).map((i) => [i!, DEMO_USERS[i!]?.name ?? i!]))
    const req = this.approvalRequests.filter((r) => r.entity === 'journal' && r.entity_id === id).map((r) => r.id)
    return {
      ...j,
      company_name: this.company(j.company_id).name,
      people: names([j.created_by, j.submitted_by, j.approved_by, j.posted_by]),
      lines: (this.linesByJournal.get(id) ?? []).map((l) => {
        const a = this.account(l.account_id)!
        return {
          id: l.id, line_no: l.line_no, account_id: l.account_id, account_code: a.code, account_name: a.name, party_id: l.party_id,
          party_name: this.parties.find((p) => p.id === l.party_id)?.display_name ?? null, description: l.description, debit: l.debit, credit: l.credit,
          txn_currency: l.txn_currency, txn_amount: l.txn_amount, fx_rate: l.fx_rate,
          dims: Object.fromEntries(Object.entries(l.dims).map(([k, v]) => { const u = this.orgUnits.find((x) => x.id === v); return [k, { id: v, name: u?.name ?? '?', code: u?.code ?? '' }] })),
        }
      }),
      approvals: this.approvalActions.filter((a) => req.includes(a.request_id)).map((a) => ({ step: a.step, action: a.action, comment: a.comment, at: a.at, actor: DEMO_USERS[a.actor]?.name ?? a.actor })),
      history: this.audit.filter((a) => a.entity === 'journals' && a.entity_id === id).map((a) => ({ at: a.at, action: a.action, reason: a.reason, actor: a.actor_name ?? null })),
    }
  }

  // ------------------------------------------------------------ ledger
  protected postedSet(to: string, knownAt?: string) {
    return new Map(this.journals.filter((j) => (j.status === 'posted' || j.status === 'reversed') && j.journal_date <= to && (!knownAt || (j.posted_at ?? '') <= knownAt)).map((j) => [j.id, j]))
  }
  async ledgerBalances(companyIds: ID[], from: string, to: string, opts: { knownAt?: string; dim?: ID } = {}): Promise<LedgerBalanceRow[]> {
    const posted = this.postedSet(to, opts.knownAt)
    const m = new Map<string, { company_id: ID; account_id: ID; od: Decimal; oc: Decimal; pd: Decimal; pc: Decimal }>()
    for (const l of this.lines) {
      const j = posted.get(l.journal_id)
      if (!j || !companyIds.includes(l.company_id)) continue
      if (opts.dim && !Object.values(l.dims).includes(opts.dim)) continue
      const k = l.company_id + '|' + l.account_id
      const cur = m.get(k) ?? { company_id: l.company_id, account_id: l.account_id, od: ZERO, oc: ZERO, pd: ZERO, pc: ZERO }
      if (j.journal_date < from) { cur.od = cur.od.plus(l.debit); cur.oc = cur.oc.plus(l.credit) } else { cur.pd = cur.pd.plus(l.debit); cur.pc = cur.pc.plus(l.credit) }
      m.set(k, cur)
    }
    return [...m.values()].map((v) => ({ company_id: v.company_id, account_id: v.account_id, opening_debit: v.od.toString(), opening_credit: v.oc.toString(), period_debit: v.pd.toString(), period_credit: v.pc.toString() }))
  }
  async ledgerMonthly(companyIds: ID[], from: string, to: string): Promise<LedgerMonthlyRow[]> {
    const posted = this.postedSet(to)
    const m = new Map<string, { company_id: ID; account_id: ID; month: string; d: Decimal; c: Decimal }>()
    for (const l of this.lines) {
      const j = posted.get(l.journal_id)
      if (!j || j.journal_date < from || !companyIds.includes(l.company_id)) continue
      const month = startOfMonth(j.journal_date)
      const k = `${l.company_id}|${l.account_id}|${month}`
      const cur = m.get(k) ?? { company_id: l.company_id, account_id: l.account_id, month, d: ZERO, c: ZERO }
      cur.d = cur.d.plus(l.debit); cur.c = cur.c.plus(l.credit)
      m.set(k, cur)
    }
    return [...m.values()].map((v) => ({ company_id: v.company_id, account_id: v.account_id, month: v.month, debit: v.d.toString(), credit: v.c.toString() }))
  }
  async ledgerLines(f: LedgerFilter): Promise<LedgerLinesResult> {
    const posted = this.postedSet(f.to ?? '2999-12-31', f.known_at)
    const q = f.q?.trim().toLowerCase()
    const base = this.lines.filter((l) => {
      const j = posted.get(l.journal_id)
      if (!j || !f.company_ids.includes(l.company_id)) return false
      if (f.from && j.journal_date < f.from) return false
      if (f.account_ids?.length && !f.account_ids.includes(l.account_id)) return false
      if (f.party_id && l.party_id !== f.party_id) return false
      if (f.journal_id && l.journal_id !== f.journal_id) return false
      if (f.org_unit_id && !Object.values(l.dims).includes(f.org_unit_id)) return false
      if (f.min_amount && Decimal.max(l.debit, l.credit).lt(f.min_amount)) return false
      return true
    })
    const vis = base.filter((l) => {
      const j = posted.get(l.journal_id)!
      if (!this.canViewLevel(j.confidentiality)) return false
      return !q || (j.narration ?? '').toLowerCase().includes(q) || (l.description ?? '').toLowerCase().includes(q) || (j.voucher_no ?? '').toLowerCase().includes(q)
    })
    const hidden = base.filter((l) => !this.canViewLevel(posted.get(l.journal_id)!.confidentiality))
    const sorted = vis.sort((a, b) => {
      const ja = posted.get(a.journal_id)!; const jb = posted.get(b.journal_id)!
      return jb.journal_date.localeCompare(ja.journal_date) || (jb.voucher_no ?? '').localeCompare(ja.voucher_no ?? '') || a.line_no - b.line_no
    })
    const off = f.offset ?? 0
    const rows: LedgerLine[] = sorted.slice(off, off + Math.min(f.limit ?? 200, 1000)).map((l) => {
      const j = posted.get(l.journal_id)!; const a = this.account(l.account_id)!; const p = this.parties.find((x) => x.id === l.party_id)
      return {
        id: l.id, journal_id: l.journal_id, company_id: l.company_id, company_name: this.company(l.company_id).name, line_no: l.line_no,
        account_id: l.account_id, account_code: a.code, account_name: a.name, account_type: a.type, party_id: l.party_id, party_name: p?.display_name ?? null, party_no: p?.party_no ?? null,
        description: l.description, debit: l.debit, credit: l.credit, voucher_no: j.voucher_no, voucher_type: j.voucher_type, journal_date: j.journal_date, narration: j.narration,
        status: j.status, source: j.source, source_id: j.source_id, origin: j.origin, confidentiality: j.confidentiality, posted_at: j.posted_at ?? null,
      }
    })
    return {
      rows, total: vis.length, sum_debit: sum(vis.map((l) => l.debit)).toString(), sum_credit: sum(vis.map((l) => l.credit)).toString(),
      restricted: { count: hidden.length, debit: sum(hidden.map((l) => l.debit)).toString(), credit: sum(hidden.map((l) => l.credit)).toString() },
    }
  }
  async integrityCheck(companyIds: ID[]): Promise<IntegrityReport> {
    const js = this.journals.filter((j) => companyIds.includes(j.company_id))
    const posted = js.filter((j) => j.status === 'posted' || j.status === 'reversed')
    let d = ZERO, c = ZERO, unbalanced = 0
    for (const j of posted) {
      const ls = this.linesByJournal.get(j.id) ?? []
      const jd = sum(ls.map((l) => l.debit)); const jc = sum(ls.map((l) => l.credit))
      if (!jd.eq(jc)) unbalanced++
      d = d.plus(jd); c = c.plus(jc)
    }
    return {
      posted_journals: posted.length, unbalanced_journals: unbalanced, total_debits: d.toString(), total_credits: c.toString(),
      drafts: js.filter((j) => j.status === 'draft').length, awaiting_approval: js.filter((j) => j.status === 'submitted').length,
      approved_unposted: js.filter((j) => j.status === 'approved').length,
      unreconciled_bank_lines: this.bankTxns.filter((t) => companyIds.includes(t.company_id) && ['unmatched', 'suggested', 'needs_review', 'partial'].includes(t.status)).length,
      locked_periods: this.periods.filter((p) => companyIds.includes(p.company_id) && p.status === 'locked').length,
      open_alerts: this.alerts.filter((a) => companyIds.includes(a.company_id) && (a.status === 'open' || a.status === 'reviewing')).length,
    }
  }

  // ------------------------------------------------------------ invoices
  protected taxFor(taxCodeId: ID | null | undefined, amount: Decimal, date: string) {
    if (!taxCodeId) return [] as { component: string; tax: Decimal; output: ID | null; input: ID | null }[]
    const t = this.taxCodes.find((x) => x.id === taxCodeId)
    if (!t) return []
    return t.components
      .filter((k) => (k.effective_from ?? '2000-01-01') <= date && (!k.effective_to || k.effective_to >= date))
      .map((k) => ({ component: k.component, tax: round2(amount.times(k.rate).div(100)), output: k.output_account_id ?? null, input: k.input_account_id ?? null }))
  }
  async saveInvoice(p: InvoiceInput): Promise<ID> {
    const party = this.parties.find((x) => x.id === p.party_id) ?? fail('a valid party is required.')
    if (party.status === 'blocked' || party.status === 'terminated') fail(`${party.display_name} is ${party.status} — new documents are not permitted. Reason: ${party.status_reason ?? 'not recorded'}`)
    if (!p.lines?.length) fail('a document needs at least one line.')
    const c = this.company(p.company_id)
    let inv: Invoice
    if (p.id) {
      inv = this.invoices.find((i) => i.id === p.id) ?? fail('document not found.')
      if (inv.status !== 'draft') fail('only drafts can be edited.')
      this.invoiceLines = this.invoiceLines.filter((l) => l.invoice_id !== inv.id)
      Object.assign(inv, { party_id: p.party_id, doc_date: p.doc_date, due_date: p.due_date ?? null, currency: p.currency ?? inv.currency, fx_rate: p.fx_rate ?? 1, reference: p.reference ?? null, narration: p.narration ?? null })
    } else {
      inv = { id: uid(), company_id: p.company_id, doc_type: p.doc_type, doc_no: null, party_id: p.party_id, doc_date: p.doc_date, due_date: p.due_date ?? null, currency: p.currency ?? c.base_currency, fx_rate: p.fx_rate ?? 1, reference: p.reference ?? null, narration: p.narration ?? null, subtotal: '0', tax_total: '0', total: '0', amount_settled: '0', status: 'draft', journal_id: null, confidentiality: p.confidentiality ?? 'internal', created_by: this.actor, created_at: this.now() }
      this.invoices.push(inv)
    }
    let sub = ZERO, tax = ZERO
    p.lines.forEach((l, i) => {
      const acc = this.account(l.account_id)
      if (!acc || acc.company_id !== p.company_id || acc.is_group) fail(`line ${i + 1} needs a valid posting account of this company.`)
      const amount = round2(l.amount != null ? D(l.amount) : D(l.quantity ?? 1).times(D(l.rate)))
      if (amount.lte(0)) fail(`line ${i + 1} amount must be greater than zero.`)
      const t = sum(this.taxFor(l.tax_code_id, amount, p.doc_date).map((x) => x.tax))
      this.invoiceLines.push({ id: uid(), invoice_id: inv.id, line_no: i + 1, description: l.description ?? '', account_id: l.account_id, quantity: String(l.quantity ?? 1), rate: String(l.rate ?? amount), amount: amount.toString(), tax_code_id: l.tax_code_id ?? null, tax_amount: t.toString(), hsn_sac: l.hsn_sac, dims: l.dims ?? {} })
      sub = sub.plus(amount); tax = tax.plus(t)
    })
    inv.subtotal = sub.toString(); inv.tax_total = tax.toString(); inv.total = sub.plus(tax).toString()
    this.log(p.company_id, 'invoices', inv.id, 'draft_saved', null, { lines: p.lines.length, total: inv.total }, null)
    return inv.id
  }
  async approveInvoice(id: ID): Promise<string> {
    const inv = this.invoices.find((i) => i.id === id) ?? fail('document not found.')
    if (inv.status !== 'draft') { if (inv.journal_id) return inv.doc_no!; fail(`this document is ${inv.status} and cannot be approved.`) }
    const action = this.makerChecker(inv.created_by, 'document')
    this.assertPeriodOpen(inv.company_id, inv.doc_date)
    const sales = inv.doc_type === 'sales_invoice' || inv.doc_type === 'credit_note'
    const normal = inv.doc_type === 'sales_invoice' || inv.doc_type === 'purchase_bill'
    if (inv.doc_type === 'purchase_bill' && inv.reference && this.invoices.some((o) => o.id !== inv.id && o.company_id === inv.company_id && o.party_id === inv.party_id && o.doc_type === 'purchase_bill' && o.status !== 'cancelled' && (o.reference ?? '').toLowerCase() === inv.reference!.toLowerCase())) {
      this.raise(inv.company_id, 'duplicate_invoice', 'priority', 'ANOMALY DETECTED — possible duplicate bill', `Supplier reference "${inv.reference}" has already been recorded for this party. This is a factual match for human review, not a conclusion.`, { invoice_id: inv.id, reference: inv.reference }, 'invoices', inv.id, 'dupbill:' + inv.id)
    }
    const control = this.mapAccount(inv.company_id, sales ? 'ar_control' : 'ap_control')
    const side: 'debit' | 'credit' = (sales && normal) || (!sales && !normal) ? 'credit' : 'debit'
    const ctl: 'debit' | 'credit' = side === 'credit' ? 'debit' : 'credit'
    const fx = D(inv.fx_rate)
    const jl: JournalLineInput[] = []
    let totalBase = ZERO
    const taxAgg = new Map<string, { account: ID; component: string; tax: Decimal }>()
    for (const l of this.invoiceLines.filter((x) => x.invoice_id === id).sort((a, b) => a.line_no - b.line_no)) {
      const base = round2(D(l.amount).times(fx))
      totalBase = totalBase.plus(base)
      jl.push({ account_id: l.account_id, party_id: inv.party_id, description: l.description, [side]: base.toString(), txn_currency: inv.currency, txn_amount: l.amount, fx_rate: inv.fx_rate, dims: l.dims })
      for (const k of this.taxFor(l.tax_code_id, D(l.amount), inv.doc_date)) {
        const account = (sales ? k.output : k.input) ?? fail(`tax component ${k.component} has no ledger account configured.`)
        const key = account + '|' + k.component
        const cur = taxAgg.get(key) ?? { account, component: k.component, tax: ZERO }
        cur.tax = cur.tax.plus(k.tax); taxAgg.set(key, cur)
      }
    }
    for (const k of taxAgg.values()) {
      if (k.tax.lte(0)) continue
      const base = round2(k.tax.times(fx))
      totalBase = totalBase.plus(base)
      jl.push({ account_id: k.account, description: k.component, [side]: base.toString(), txn_currency: inv.currency, txn_amount: k.tax.toString(), fx_rate: inv.fx_rate })
    }
    jl.unshift({ account_id: control, party_id: inv.party_id, description: inv.narration ?? inv.doc_type, [ctl]: totalBase.toString(), txn_currency: inv.currency, txn_amount: inv.total, fx_rate: inv.fx_rate })
    const fy = fiscalYearOf(inv.doc_date, this.company(inv.company_id).fy_start_month)
    const prefix = { sales_invoice: 'INV', purchase_bill: 'BILL', credit_note: 'CRN', debit_note: 'DBN' }[inv.doc_type]
    const docNo = `${prefix}-${fy}-${String(this.nextSeq(`d:${inv.company_id}:${inv.doc_type}:${fy}`)).padStart(6, '0')}`
    const vtype = { sales_invoice: 'sales', purchase_bill: 'purchase', credit_note: 'credit_note', debit_note: 'debit_note' }[inv.doc_type]
    const j: Journal = { id: uid(), company_id: inv.company_id, voucher_type: vtype, voucher_no: null, journal_date: inv.doc_date, narration: docNo + (inv.narration ? ' · ' + inv.narration : ''), purpose: null, status: 'draft', source: 'invoice', source_id: inv.id, origin: 'system', reversal_of: null, reversed_by: null, confidentiality: inv.confidentiality, total: '0', created_by: inv.created_by, created_at: this.now(), approved_by: this.actor, approved_at: this.now() }
    this.journals.push(j)
    this.writeLines(j.id, j.company_id, jl)
    const voucher = this.doPost(j.id)
    inv.status = 'open'; inv.doc_no = docNo; inv.journal_id = j.id; inv.approved_by = this.actor; inv.approved_at = this.now()
    this.log(inv.company_id, 'invoices', id, 'approved_and_posted', null, { doc_no: docNo, voucher_no: voucher, approval: action, rule: 'InvoiceApproved → control account, revenue/expense, tax' }, null)
    return docNo
  }
  async listInvoices(f: { companyIds: ID[]; docTypes?: DocType[]; partyId?: ID }) {
    return this.invoices
      .filter((i) => f.companyIds.includes(i.company_id) && (!f.docTypes?.length || f.docTypes.includes(i.doc_type)) && (!f.partyId || i.party_id === f.partyId) && this.canViewLevel(i.confidentiality))
      .sort((a, b) => b.doc_date.localeCompare(a.doc_date))
  }
  async getInvoice(id: ID) {
    const inv = this.invoices.find((i) => i.id === id) ?? fail('document not found.')
    return { ...inv, lines: this.invoiceLines.filter((l) => l.invoice_id === id).sort((a, b) => a.line_no - b.line_no) }
  }

  // ------------------------------------------------------------ payments
  async savePayment(p: PaymentInput): Promise<ID> {
    const party = this.parties.find((x) => x.id === p.party_id) ?? fail('a valid party is required.')
    if (p.direction === 'out' && ['blocked', 'suspended', 'terminated'].includes(party.status)) fail(`${party.display_name} is ${party.status} — new payments are not permitted.`)
    const bank = this.account(p.bank_ledger_id)
    if (!bank || bank.company_id !== p.company_id || !['bank', 'cash'].includes(bank.control_type ?? '')) fail('choose a bank or cash ledger of this company.')
    if (p.party_bank_account_id && !this.partyBanks.some((b) => b.id === p.party_bank_account_id && b.party_id === party.id && b.status === 'verified')) fail('the selected beneficiary bank details are not verified. Payment cannot use them.')
    const amount = round2(D(p.amount))
    if (amount.lte(0)) fail('payment amount must be greater than zero.')
    let alloc = ZERO
    for (const a of p.allocations ?? []) {
      const inv = this.invoices.find((i) => i.id === a.invoice_id)
      if (!inv || inv.company_id !== p.company_id || inv.party_id !== party.id) fail('an allocation references a document of another party or company.')
      if (!['open', 'partially_paid'].includes(inv!.status)) fail(`document ${inv!.doc_no} is ${inv!.status} and cannot be settled.`)
      if ((p.direction === 'in') !== (inv!.doc_type === 'sales_invoice' || inv!.doc_type === 'debit_note')) fail(`document ${inv!.doc_no} cannot be settled by this payment direction.`)
      if (D(a.amount).gt(D(inv!.total).minus(inv!.amount_settled))) fail(`allocation of ${a.amount} exceeds the outstanding balance of ${inv!.doc_no}.`)
      alloc = alloc.plus(a.amount)
    }
    if (alloc.gt(amount)) fail('allocations exceed the payment amount.')
    const id = uid()
    this.payments.push({ id, company_id: p.company_id, direction: p.direction, pay_no: null, party_id: p.party_id, bank_ledger_id: p.bank_ledger_id, pay_date: p.pay_date, amount: amount.toString(), currency: p.currency ?? this.company(p.company_id).base_currency, fx_rate: p.fx_rate ?? 1, method: p.method ?? 'bank_transfer', reference: p.reference ?? null, narration: p.narration ?? null, status: 'draft', journal_id: null, created_by: this.actor, created_at: this.now(), allocations: (p.allocations ?? []).map((a) => ({ invoice_id: a.invoice_id, amount: round2(D(a.amount)).toString() })) })
    this.log(p.company_id, 'payments', id, 'insert', null, { amount: amount.toString(), direction: p.direction }, null)
    return id
  }
  async approvePayment(id: ID): Promise<string> {
    const pay = this.payments.find((p) => p.id === id) ?? fail('payment not found.')
    if (pay.status === 'posted') return pay.pay_no!
    if (pay.status !== 'draft') fail(`this payment is ${pay.status}.`)
    const action = this.makerChecker(pay.created_by, 'payment')
    this.assertPeriodOpen(pay.company_id, pay.pay_date)
    const isIn = pay.direction === 'in'
    const control = this.mapAccount(pay.company_id, isIn ? 'ar_control' : 'ap_control')
    const bankBase = round2(D(pay.amount).times(pay.fx_rate))
    let ctlBase = ZERO, alloc = ZERO
    for (const a of pay.allocations ?? []) {
      const inv = this.invoices.find((i) => i.id === a.invoice_id)!
      if (!['open', 'partially_paid'].includes(inv.status) || D(a.amount).gt(D(inv.total).minus(inv.amount_settled))) fail(`document ${inv.doc_no} can no longer absorb this allocation.`)
      ctlBase = ctlBase.plus(round2(D(a.amount).times(inv.fx_rate)))
      alloc = alloc.plus(a.amount)
    }
    for (const a of pay.allocations ?? []) {
      const inv = this.invoices.find((i) => i.id === a.invoice_id)!
      inv.amount_settled = D(inv.amount_settled).plus(a.amount).toString()
      inv.status = D(inv.amount_settled).gte(inv.total) ? 'paid' : 'partially_paid'
    }
    const unalloc = D(pay.amount).minus(alloc)
    const advBase = unalloc.gt(0) ? round2(unalloc.times(pay.fx_rate)) : ZERO
    const diff = bankBase.minus(ctlBase).minus(advBase)
    const s = (side: 'debit' | 'credit', v: Decimal) => ({ [side]: v.toString() })
    const jl: JournalLineInput[] = [{ account_id: pay.bank_ledger_id, description: pay.narration ?? pay.reference, ...s(isIn ? 'debit' : 'credit', bankBase), txn_currency: pay.currency, txn_amount: pay.amount, fx_rate: pay.fx_rate }]
    if (ctlBase.gt(0)) jl.push({ account_id: control, party_id: pay.party_id, description: 'Settlement', ...s(isIn ? 'credit' : 'debit', ctlBase) })
    if (advBase.gt(0)) jl.push({ account_id: this.mapAccount(pay.company_id, isIn ? 'customer_advances' : 'vendor_advances'), party_id: pay.party_id, description: 'Advance — not yet settled against a document', ...s(isIn ? 'credit' : 'debit', advBase) })
    if (!diff.isZero()) jl.push({ account_id: this.mapAccount(pay.company_id, 'fx_gain_loss'), description: 'Exchange difference on settlement', ...s((isIn && diff.gt(0)) || (!isIn && diff.lt(0)) ? 'credit' : 'debit', diff.abs()) })
    const fy = fiscalYearOf(pay.pay_date, this.company(pay.company_id).fy_start_month)
    const payNo = `${isIn ? 'RCT' : 'PAY'}-${fy}-${String(this.nextSeq(`d:${pay.company_id}:${isIn ? 'receipt' : 'payment'}:${fy}`)).padStart(6, '0')}`
    const j: Journal = { id: uid(), company_id: pay.company_id, voucher_type: isIn ? 'receipt' : 'payment', voucher_no: null, journal_date: pay.pay_date, narration: payNo + (pay.narration ? ' · ' + pay.narration : ''), purpose: null, status: 'draft', source: isIn ? 'receipt' : 'payment', source_id: pay.id, origin: 'system', reversal_of: null, reversed_by: null, confidentiality: 'internal', total: '0', created_by: pay.created_by, created_at: this.now(), approved_by: this.actor, approved_at: this.now() }
    this.journals.push(j)
    this.writeLines(j.id, j.company_id, jl)
    const voucher = this.doPost(j.id)
    pay.status = 'posted'; pay.pay_no = payNo; pay.journal_id = j.id
    this.log(pay.company_id, 'payments', id, 'approved_and_posted', null, { pay_no: payNo, voucher_no: voucher, approval: action, rule: isIn ? 'PaymentReceived → Debit Bank, Credit Receivable' : 'PaymentMade → Debit Payable, Credit Bank' }, null)
    return payNo
  }
  async listPayments(f: { companyIds: ID[]; partyId?: ID }) {
    return this.payments.filter((p) => f.companyIds.includes(p.company_id) && (!f.partyId || p.party_id === f.partyId)).sort((a, b) => b.pay_date.localeCompare(a.pay_date))
  }

  // ------------------------------------------------------------ banking
  async listBankAccounts(companyIds: ID[]) { return this.bankAccounts.filter((b) => companyIds.includes(b.company_id)) }
  async createBankAccount(b: Omit<BankAccount, 'id' | 'is_active'>) {
    const id = uid()
    this.bankAccounts.push({ ...b, id, is_active: true })
    this.log(b.company_id, 'bank_accounts', id, 'insert', null, b, null)
    return id
  }
  async listBankTransactions(bankAccountId: ID) { return this.bankTxns.filter((t) => t.bank_account_id === bankAccountId).sort((a, b) => b.txn_date.localeCompare(a.txn_date)) }
  async importBankTransactions(bankAccountId: ID, rows: Parameters<CoreApi['importBankTransactions']>[1]) {
    const b = this.bankAccounts.find((x) => x.id === bankAccountId) ?? fail('bank account not found.')
    if (rows.some((r) => !r.txn_date || r.amount === undefined || r.amount === null || r.amount === '')) fail('every statement row needs a date and an amount. Nothing was imported.')
    let imported = 0, dup = 0
    for (const r of rows) {
      const amount = round2(D(r.amount))
      const fingerprint = [r.txn_date, amount.toFixed(2), (r.reference ?? '').toLowerCase(), (r.narration ?? '').toLowerCase()].join('|')
      const isDup = this.bankTxns.some((t) => t.bank_account_id === bankAccountId && t.fingerprint === fingerprint)
      if (isDup) dup++; else imported++
      this.bankTxns.push({ id: uid(), company_id: b.company_id, bank_account_id: bankAccountId, txn_date: r.txn_date, amount: amount.toString(), narration: r.narration ?? null, reference: r.reference ?? null, running_balance: r.running_balance != null ? String(r.running_balance) : null, status: isDup ? 'duplicate' : 'unmatched', matched_line_id: null, fingerprint })
    }
    this.log(b.company_id, 'bank_transactions', bankAccountId, 'statement_imported', null, { new: imported, possible_duplicates: dup }, null)
    return { imported, possible_duplicates: dup }
  }
  async suggestBankMatches(bankAccountId: ID): Promise<BankSuggestion[]> {
    const b = this.bankAccounts.find((x) => x.id === bankAccountId) ?? fail('bank account not found.')
    const posted = this.postedSet('2999-12-31')
    const taken = new Set(this.bankTxns.filter((t) => t.matched_line_id).map((t) => t.matched_line_id))
    const bookLines = this.lines.filter((l) => l.company_id === b.company_id && l.account_id === b.ledger_account_id && posted.has(l.journal_id) && !taken.has(l.id))
    const out: BankSuggestion[] = []
    for (const t of this.bankTxns.filter((x) => x.bank_account_id === bankAccountId && ['unmatched', 'suggested', 'needs_review'].includes(x.status))) {
      for (const l of bookLines) {
        if (!D(l.debit).minus(l.credit).eq(t.amount)) continue
        const j = posted.get(l.journal_id)!
        const gap = Math.abs(daysBetween(j.journal_date, t.txn_date))
        if (gap > 7) continue
        const refHit = !!t.reference && ((j.narration ?? '') + ' ' + (l.description ?? '')).toLowerCase().includes(t.reference.toLowerCase())
        out.push({ txn_id: t.id, line_id: l.id, journal_id: j.id, voucher_no: j.voucher_no, journal_date: j.journal_date, narration: j.narration, amount: t.amount, score: 50 + (gap === 0 ? 30 : Math.max(0, 20 - gap * 4)) + (refHit ? 20 : 0), reasons: ['amount matches exactly', gap === 0 ? 'same date' : `date within ${gap} day(s)`, ...(refHit ? ['reference appears in book narration'] : [])] })
      }
    }
    return out.sort((a, b) => b.score - a.score)
  }
  async setBankMatch(txnId: ID, lineId: ID | null, status: BankTxnStatus, note?: string) {
    const t = this.bankTxns.find((x) => x.id === txnId) ?? fail('bank transaction not found.')
    const old = { status: t.status, matched_line_id: t.matched_line_id }
    if (status === 'matched') {
      const b = this.bankAccounts.find((x) => x.id === t.bank_account_id)!
      const l = this.lines.find((x) => x.id === lineId)
      if (!l || l.company_id !== t.company_id || l.account_id !== b.ledger_account_id) fail('the book entry does not belong to this bank ledger.')
      if (!D(l!.debit).minus(l!.credit).eq(t.amount)) fail(`amounts differ (bank ${t.amount}, books ${D(l!.debit).minus(l!.credit)}). Questionable matches are never forced.`)
      if (this.bankTxns.some((x) => x.matched_line_id === lineId && x.id !== txnId)) fail('this book entry is already matched to another bank transaction.')
      t.status = 'matched'; t.matched_line_id = lineId
    } else { t.status = status; t.matched_line_id = null }
    t.note = note ?? null
    this.log(t.company_id, 'bank_transactions', txnId, 'reconciliation_' + status, old, { status, matched_line_id: lineId }, note ?? null)
  }

  // ------------------------------------------------------------ approvals
  async listApprovalRequests(companyIds: ID[]) { return this.approvalRequests.filter((r) => companyIds.includes(r.company_id)).sort((a, b) => b.requested_at.localeCompare(a.requested_at)) }
  async listApprovalRules() { return [...this.approvalRules] }
  async saveApprovalRule(r: Parameters<CoreApi['saveApprovalRule']>[0]) {
    if (!r.steps.length) fail('an approval rule needs at least one step.')
    const ex = r.id ? this.approvalRules.find((x) => x.id === r.id) : undefined
    if (ex) { const old = { ...ex }; Object.assign(ex, r); this.log(r.company_id, 'approval_rules', ex.id, 'update', old, { ...ex }, null) }
    else { const n: ApprovalRule = { ...r, id: uid(), group_id: this.group.id, is_active: r.is_active ?? true }; this.approvalRules.push(n); this.log(r.company_id, 'approval_rules', n.id, 'insert', null, n, null) }
  }

  // ------------------------------------------------------------ budgets
  async listBudgets(companyIds: ID[]) { return this.budgets.filter((b) => companyIds.includes(b.company_id)) }
  async getBudgetLines(budgetId: ID) { return this.budgetLines.filter((l) => l.budget_id === budgetId) }
  async saveBudget(b: Parameters<CoreApi['saveBudget']>[0]) {
    let bud = b.id ? this.budgets.find((x) => x.id === b.id) : undefined
    if (bud && bud.status !== 'draft') fail('approved budgets are never overwritten. Create a revised version.')
    if (!bud) {
      const version = Math.max(0, ...this.budgets.filter((x) => x.company_id === b.company_id && x.name === b.name && x.fy === b.fy).map((x) => x.version)) + 1
      bud = { id: uid(), company_id: b.company_id, name: b.name, fy: b.fy, version, kind: b.kind, status: 'draft', limit_mode: b.limit_mode, created_at: this.now() }
      this.budgets.push(bud)
    } else Object.assign(bud, { name: b.name, kind: b.kind, limit_mode: b.limit_mode })
    this.budgetLines = this.budgetLines.filter((l) => l.budget_id !== bud!.id)
    this.budgetLines.push(...b.lines.map((l) => ({ ...l, id: uid(), budget_id: bud!.id, company_id: b.company_id })))
    this.log(b.company_id, 'budgets', bud.id, 'saved', null, { lines: b.lines.length, version: bud.version }, null)
    return bud.id
  }
  async setBudgetStatus(id: ID, status: 'approved' | 'revised') {
    const b = this.budgets.find((x) => x.id === id) ?? fail('budget not found.')
    if (status === 'approved' && b.status !== 'draft') fail('only a draft budget can be approved.')
    if (status === 'revised' && b.status !== 'approved') fail('only an approved budget can be marked revised.')
    const old = b.status; b.status = status
    this.log(b.company_id, 'budgets', id, 'budget_' + status, { status: old }, { status }, null)
  }

  // ------------------------------------------------------------ sentinel
  protected raise(company_id: ID, kind: string, attention: Alert['attention'], title: string, explanation: string, evidence: Record<string, unknown>, entity: string, entity_id: ID, dedupe_key: string) {
    if (this.alerts.some((a) => a.company_id === company_id && a.dedupe_key === dedupe_key)) return false
    this.alerts.push({ id: uid(), company_id, kind, attention, title, explanation, evidence, entity, entity_id, status: 'open', created_at: this.now(), dedupe_key })
    return true
  }
  async listAlerts(companyIds: ID[]) { return this.alerts.filter((a) => companyIds.includes(a.company_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)) }
  async runSentinel(companyId: ID): Promise<number> {
    let n = 0
    const s = this.group.settings.sentinel ?? {}
    const large = s.large_payment ?? 500000, unit = s.round_number_unit ?? 100000
    const add = (...a: Parameters<DemoCore['raise']>) => { if (this.raise(...a)) n++ }
    const pays = this.payments.filter((p) => p.company_id === companyId && p.status !== 'cancelled')
    for (let i = 0; i < pays.length; i++) for (let k = i + 1; k < pays.length; k++) {
      const a = pays[i], b = pays[k]
      if (a.party_id === b.party_id && a.direction === b.direction && D(a.amount).eq(b.amount) && Math.abs(daysBetween(a.pay_date, b.pay_date)) <= 3) {
        const [x, y] = [a.id, b.id].sort()
        add(companyId, 'duplicate_payment', 'priority', 'ANOMALY DETECTED — possible duplicate payment', `Two payments of the same amount (${a.amount} ${a.currency}) went to the same party within ${Math.abs(daysBetween(a.pay_date, b.pay_date))} day(s): ${a.pay_no ?? 'draft'} and ${b.pay_no ?? 'draft'}. This is a factual pattern for human review.`, { payment_ids: [a.id, b.id], party_id: a.party_id, amount: a.amount, rule: 'same party + same amount + within 3 days' }, 'payments', b.id, `duppay:${x}:${y}`)
      }
    }
    const invs = this.invoices.filter((i) => i.company_id === companyId && i.reference && i.status !== 'cancelled')
    for (let i = 0; i < invs.length; i++) for (let k = i + 1; k < invs.length; k++) {
      const a = invs[i], b = invs[k]
      if (a.party_id === b.party_id && a.doc_type === b.doc_type && a.reference!.toLowerCase() === b.reference!.toLowerCase()) {
        const [x, y] = [a.id, b.id].sort()
        add(companyId, 'duplicate_invoice', 'priority', 'ANOMALY DETECTED — invoice reference used more than once', `Reference "${a.reference}" appears on more than one ${a.doc_type.replace('_', ' ')} for the same party.`, { invoice_ids: [a.id, b.id], reference: a.reference, rule: 'same party + same reference' }, 'invoices', b.id, `dupinv:${x}:${y}`)
      }
    }
    for (const j of this.journals.filter((x) => x.company_id === companyId && (x.status === 'posted' || x.status === 'reversed') && x.source === 'manual')) {
      const total = D(j.total)
      if (total.gte(unit) && total.mod(unit).isZero()) add(companyId, 'round_number_journal', 'review', 'ANOMALY DETECTED — large round-number manual journal', `Manual journal ${j.voucher_no} totals exactly ${total.toFixed(2)}, a round multiple of ${unit}. Round figures in manual journals are a standard review indicator.`, { journal_id: j.id, total: j.total, rule: 'manual journal, total is a multiple of ' + unit }, 'journals', j.id, 'round:' + j.id)
      if (j.posted_at) {
        const d = new Date(j.posted_at); const day = d.getDay(); const h = d.getHours()
        if (day === 0 || day === 6 || h >= 23 || h < 5) add(companyId, 'unusual_time', 'review', 'ANOMALY DETECTED — manual journal posted at an unusual time', `Manual journal ${j.voucher_no} was posted on ${d.toString().slice(0, 21)}, outside configured working hours.`, { journal_id: j.id, posted_at: j.posted_at, rule: 'weekend, or between 23:00 and 05:00' }, 'journals', j.id, 'time:' + j.id)
      }
      const lag = daysBetween(j.journal_date, j.created_at.slice(0, 10))
      if (lag > 30 && j.voucher_type !== 'opening') add(companyId, 'backdated', 'review', 'ANOMALY DETECTED — backdated entry', `Journal ${j.voucher_no} is dated ${j.journal_date} but was created on ${j.created_at.slice(0, 10)} (${lag} days later).`, { journal_id: j.id, rule: 'journal date more than 30 days before creation' }, 'journals', j.id, 'backdated:' + j.id)
      const rule = this.approvalRules.filter((r) => r.is_active && r.entity === 'journal' && D(r.min_amount).gt(0) && (r.company_id === null || r.company_id === companyId)).find((r) => total.gte(D(r.min_amount).times(0.95)) && total.lt(r.min_amount))
      if (rule) add(companyId, 'below_threshold', 'review', 'ANOMALY DETECTED — amount just below an approval threshold', `Journal ${j.voucher_no} totals ${total.toFixed(2)}, within 5% below the approval threshold of ${rule.min_amount} ("${rule.name}").`, { journal_id: j.id, total: j.total, threshold: rule.min_amount, rule: 'total between 95% and 100% of a threshold' }, 'journals', j.id, 'threshold:' + j.id)
      if (j.status === 'reversed' && j.reversed_by) {
        const r = this.journals.find((x) => x.id === j.reversed_by)
        if (r?.posted_at && j.posted_at && new Date(r.posted_at).getTime() - new Date(j.posted_at).getTime() < 86400000) add(companyId, 'immediate_reversal', 'review', 'ANOMALY DETECTED — journal reversed shortly after posting', `Journal ${j.voucher_no} was reversed within 24 hours of being posted.`, { journal_id: j.id, reversal_journal: r.id, rule: 'reversal posted within 24 hours' }, 'journals', j.id, 'quickrev:' + j.id)
      }
    }
    for (const p of pays.filter((x) => x.direction === 'out')) {
      const pt = this.parties.find((x) => x.id === p.party_id)
      if (!pt) continue
      const gap = daysBetween(pt.created_at.slice(0, 10), p.pay_date)
      if (D(p.amount).times(p.fx_rate).gte(large) && gap >= 0 && gap <= 7) add(companyId, 'new_vendor_large_payment', 'priority', 'ANOMALY DETECTED — new party received an immediate large payment', `${pt.display_name} was created on ${pt.created_at.slice(0, 10)} and was paid ${p.amount} ${p.currency} on ${p.pay_date} (${gap} day(s) later).`, { payment_id: p.id, party_id: pt.id, amount: p.amount, rule: `payment of at least ${large} within 7 days of party creation` }, 'payments', p.id, 'newvendor:' + p.id)
    }
    return n
  }
  async reviewAlert(id: ID, status: Alert['status'], note?: string) {
    const a = this.alerts.find((x) => x.id === id) ?? fail('alert not found.')
    if ((status === 'false_positive' || status === 'resolved') && !note?.trim()) fail('a note is required to close an alert.')
    const old = a.status
    a.status = status; a.review_note = note ?? null
    this.log(a.company_id, 'alerts', id, 'alert_' + status, { status: old }, { status }, note ?? null)
  }

  // ------------------------------------------------------------ audit, numi, genesis
  async listAudit(f: { companyIds?: ID[]; entity?: string; entityId?: ID; limit?: number }) {
    return this.audit
      .filter((a) => (!f.companyIds || a.company_id === null || f.companyIds.includes(a.company_id)) && (!f.entity || a.entity === f.entity) && (!f.entityId || a.entity_id === f.entityId))
      .slice().reverse().slice(0, f.limit ?? 300)
  }
  async listNumiRules(companyIds: ID[]) { return this.numiRules.filter((r) => companyIds.includes(r.company_id)) }
  async numiLearn(companyId: ID, pattern: string, partyId: ID | null, accountId: ID) {
    const pat = pattern.toLowerCase().trim()
    const ex = this.numiRules.find((r) => r.company_id === companyId && r.pattern === pat && r.account_id === accountId)
    if (ex) { ex.approved_count++; ex.last_used_at = this.now() }
    else this.numiRules.push({ id: uid(), company_id: companyId, pattern: pat, party_id: partyId, account_id: accountId, approved_count: 1, status: 'active', last_used_at: this.now() })
  }
  async setNumiRuleStatus(id: ID, status: 'active' | 'disabled') {
    const r = this.numiRules.find((x) => x.id === id) ?? fail('rule not found.')
    const old = r.status; r.status = status
    this.log(r.company_id, 'numi_rules', id, 'update', { status: old }, { status }, null)
  }
  numiLog: unknown[] = []
  voiceLog: unknown[] = []
  async logNumi(e: Parameters<CoreApi['logNumi']>[0]) { this.numiLog.push({ ...e, at: this.now() }) }
  async logVoice(e: Parameters<CoreApi['logVoice']>[0]) { this.voiceLog.push({ ...e, at: this.now() }) }
  async listCustomFields() { return [...this.customFields] }
  async saveCustomField(d: Parameters<CoreApi['saveCustomField']>[0]) {
    const ex = d.id ? this.customFields.find((x) => x.id === d.id) : undefined
    if (ex) { const old = { ...ex }; Object.assign(ex, d, { version: ex.version + 1 }); this.log(d.company_id, 'custom_field_defs', ex.id, 'update', old, { ...ex }, null) }
    else {
      if (this.customFields.some((x) => x.entity === d.entity && x.key === d.key && x.company_id === d.company_id)) fail('a field with this key already exists for this record type.')
      const n: CustomFieldDef = { ...d, id: uid(), group_id: this.group.id, version: 1, status: d.status ?? 'active' }
      this.customFields.push(n); this.log(d.company_id, 'custom_field_defs', n.id, 'insert', null, n, null)
    }
  }
  async listRoles(): Promise<Role[]> {
    const pick = (p: string[]) => ALL_PERMS.filter((x) => p.some((q) => x === q || (q.endsWith('.*') && x.startsWith(q.slice(0, -1)))))
    return [
      { id: 'r-owner', key: 'owner', name: 'Owner', is_system: true, permissions: ALL_PERMS },
      { id: 'r-cfo', key: 'group_cfo', name: 'Group CFO', is_system: true, permissions: ALL_PERMS },
      { id: 'r-dir', key: 'company_director', name: 'Company Director', is_system: true, permissions: pick(['company.view', 'account.view', 'journal.view', 'journal.approve', 'journal.reject', 'invoice.view', 'invoice.approve', 'bill.view', 'bill.approve', 'payment.view', 'payment.approve', 'party.view', 'bank.view', 'budget.view', 'budget.approve', 'report.*', 'audit.view', 'sentinel.view', 'numi.use']) },
      { id: 'r-fh', key: 'finance_head', name: 'Finance Head', is_system: true, permissions: ALL_PERMS.filter((p) => !['company.configure', 'period.reopen', 'vault.view', 'field.configure'].includes(p)) },
      { id: 'r-acc', key: 'accountant', name: 'Accountant', is_system: true, permissions: pick(['company.view', 'account.view', 'journal.view', 'journal.create', 'journal.edit', 'journal.submit', 'journal.post', 'invoice.view', 'invoice.create', 'bill.view', 'bill.create', 'payment.view', 'payment.create', 'party.view', 'party.create', 'party.edit', 'bank.*', 'budget.view', 'report.*', 'sentinel.view', 'numi.use']) },
      { id: 'r-jr', key: 'junior_accountant', name: 'Junior Accountant', is_system: true, permissions: pick(['company.view', 'account.view', 'journal.view', 'journal.create', 'journal.edit', 'journal.submit', 'invoice.view', 'invoice.create', 'bill.view', 'bill.create', 'payment.view', 'payment.create', 'party.view', 'bank.view', 'report.view', 'numi.use']) },
      { id: 'r-aud', key: 'auditor', name: 'Auditor', is_system: true, permissions: pick(['company.view', 'account.view', 'journal.view', 'invoice.view', 'bill.view', 'payment.view', 'party.view', 'bank.view', 'budget.view', 'report.*', 'audit.view', 'sentinel.view', 'numi.use']) },
      { id: 'r-tax', key: 'tax_consultant', name: 'Tax Consultant', is_system: true, permissions: pick(['company.view', 'account.view', 'journal.view', 'invoice.view', 'bill.view', 'report.*', 'numi.use']) },
      { id: 'r-dh', key: 'department_head', name: 'Department Head', is_system: true, permissions: pick(['company.view', 'budget.view', 'report.view', 'journal.view', 'numi.use']) },
      { id: 'r-pm', key: 'project_manager', name: 'Project Manager', is_system: true, permissions: pick(['company.view', 'budget.view', 'report.view', 'numi.use']) },
      { id: 'r-pur', key: 'purchase_manager', name: 'Purchase Manager', is_system: true, permissions: pick(['company.view', 'bill.view', 'bill.create', 'party.view', 'party.create', 'report.view', 'numi.use']) },
      { id: 'r-sal', key: 'sales_manager', name: 'Sales Manager', is_system: true, permissions: pick(['company.view', 'invoice.view', 'invoice.create', 'party.view', 'party.create', 'report.view', 'numi.use']) },
      { id: 'r-pay', key: 'payroll_officer', name: 'Payroll Officer', is_system: true, permissions: pick(['company.view', 'party.view', 'numi.use', 'document.upload', 'expense.create', 'payroll.view', 'payroll.manage', 'flow.view']) },
      { id: 'r-hr', key: 'hr_head', name: 'HR Head', is_system: true, permissions: pick(['company.view', 'party.view', 'party.create', 'numi.use', 'document.upload', 'expense.create', 'expense.approve', 'payroll.*', 'flow.view', 'flow.manage']) },
      { id: 'r-store', key: 'store_keeper', name: 'Store Keeper', is_system: true, permissions: pick(['company.view', 'party.view', 'numi.use', 'document.upload', 'expense.create', 'purchase.view', 'inventory.view', 'inventory.manage', 'inventory.count', 'flow.view']) },
      { id: 'r-inv', key: 'investment_manager', name: 'Investment Manager', is_system: true, permissions: pick(['company.view', 'account.view', 'party.view', 'party.create', 'report.view', 'numi.use', 'document.view', 'document.upload', 'register.view', 'investment.view', 'investment.manage', 'scenario.view', 'scenario.manage', 'flow.view']) },
      { id: 'r-it', key: 'it_admin', name: 'IT Administrator', is_system: true, permissions: pick(['company.view', 'numi.use', 'system.health', 'integration.manage']) },
      { id: 'r-emp', key: 'employee', name: 'Employee', is_system: true, permissions: pick(['company.view', 'numi.use']) },
      { id: 'r-ro', key: 'read_only', name: 'Read Only', is_system: true, permissions: ALL_PERMS.filter((p) => p.endsWith('.view')) },
    ]
  }
  members: Member[] = []
  async listMembers() { return [...this.members] }
  async grantMembership(email: string, companyId: ID, roleKey: string, validFrom?: string, validTo?: string) {
    this.members.push({ id: uid(), user_id: uid(), email, full_name: email.split('@')[0], company_id: companyId, role_key: roleKey, valid_from: validFrom ?? null, valid_to: validTo ?? null })
    this.log(companyId, 'memberships', null, 'insert', null, { email, role: roleKey, valid_to: validTo ?? null }, null)
  }
  async revokeMembership(id: ID) {
    const m = this.members.find((x) => x.id === id)
    this.members = this.members.filter((x) => x.id !== id)
    if (m) this.log(m.company_id, 'memberships', id, 'delete', m, null, null)
  }

  // ------------------------------------------------------------ requirement ledger
  async listRequirements() {
    try {
      const r = await fetch('/requirements.json', { cache: 'no-cache' })
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      return { requirements: j.requirements as Requirement[], source: 'local ledger file' }
    } catch {
      return { requirements: [], source: 'unavailable' }
    }
  }
  async syncRequirements() { return 0 }
}

export type { Confidentiality }
export { CONF_RANK, parseISO }
