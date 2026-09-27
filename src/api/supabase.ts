import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Account, Alert, ApprovalRequest, ApprovalRule, AuditEntry, BankAccount, BankSuggestion, BankTxn, BankTxnStatus, Budget, BudgetLine,
  Company, CompanyCreatePayload, CustomFieldDef, DocType, FiscalPeriod, Group, ID, IntegrityReport, Invoice, InvoiceInput, Journal,
  JournalDetail, JournalInput, LedgerBalanceRow, LedgerFilter, LedgerLinesResult, LedgerMonthlyRow, Member, NumiRule, OrgUnit, Party,
  PartyBalanceRow, PartyBank, Payment, PaymentInput, Requirement, Role, SessionInfo, TaxCode, TypeDef,
} from '@/engine/types'
import { NumeroError } from '@/engine/types'
import type { CreatePartyResult, JournalFilter, NumeroApi, PartyInput } from './types'

// =====================================================================
// LIVE DATA LAYER — Supabase.
// Only the publishable key is used in the browser. Every table is protected
// by Row Level Security and every state change on accounting records goes
// through a controlled database function. No secret ever reaches the client.
// =====================================================================

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const liveConfigured = Boolean(URL && KEY)

let client: SupabaseClient | null = null
const sb = (): SupabaseClient => {
  if (!URL || !KEY) throw new NumeroError('The live database is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  if (!client) client = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  return client
}

interface PgErr { message: string; code?: string; details?: string | null; hint?: string | null }
const FRIENDLY: Record<string, string> = {
  '23505': 'That record already exists (duplicate value).',
  '23503': 'This record is referenced by other records and cannot be changed that way.',
  '42501': 'You are not authorised to perform this action.',
  PGRST301: 'Your session has expired. Please sign in again.',
}
function raise(e: PgErr): never {
  const msg = e.message?.startsWith('NUMERO:') ? e.message : FRIENDLY[e.code ?? ''] ?? e.message ?? 'Unexpected database error.'
  throw new NumeroError(msg, e.code)
}
async function q<T>(p: PromiseLike<{ data: T | null; error: PgErr | null }>): Promise<T> {
  const { data, error } = await p
  if (error) raise(error)
  return data as T
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args)
  if (error) raise(error)
  return data as T
}

const ALL_PERMS = [
  'company.view', 'company.configure', 'account.view', 'account.configure', 'orgunit.configure',
  'journal.view', 'journal.create', 'journal.edit', 'journal.submit', 'journal.approve', 'journal.reject', 'journal.post', 'journal.reverse',
  'invoice.view', 'invoice.create', 'invoice.approve', 'bill.view', 'bill.create', 'bill.approve',
  'payment.view', 'payment.create', 'payment.approve', 'party.view', 'party.create', 'party.edit', 'party.bank.verify',
  'bank.view', 'bank.import', 'bank.reconcile', 'budget.view', 'budget.edit', 'budget.approve', 'period.lock', 'period.reopen',
  'report.view', 'report.export', 'audit.view', 'sentinel.view', 'sentinel.review', 'vault.view', 'numi.use', 'tax.configure', 'approval.configure', 'field.configure',
]

export class SupabaseApi implements NumeroApi {
  readonly mode = 'live' as const
  private session: SessionInfo | null = null
  private names = new Map<ID, string>()

  private groupId(): ID {
    const g = this.session?.group?.id
    if (!g) throw new NumeroError('Your account is not attached to a group yet.')
    return g
  }

  // ------------------------------------------------------------ session
  async getSession(): Promise<SessionInfo | null> {
    const { data } = await sb().auth.getSession()
    const user = data.session?.user
    if (!user) { this.session = null; return null }
    const profile = await q<{ id: ID; email: string; full_name: string; group_id: ID | null; is_group_super_admin: boolean } | null>(
      sb().from('profiles').select('id,email,full_name,group_id,is_group_super_admin').eq('id', user.id).maybeSingle())
    let group: Group | null = null
    const permissions: Record<ID, string[]> = {}
    if (profile?.group_id) {
      group = await q<Group | null>(sb().from('groups').select('id,name,base_currency,settings').eq('id', profile.group_id).maybeSingle())
      if (profile.is_group_super_admin) {
        const cs = await q<{ id: ID }[]>(sb().from('companies').select('id'))
        for (const c of cs) permissions[c.id] = ALL_PERMS
      } else {
        const ms = await q<{ company_id: ID; role: { role_permissions: { permission: string }[] } | null }[]>(
          sb().from('memberships').select('company_id, role:roles(role_permissions(permission))').eq('user_id', user.id) as never)
        for (const m of ms) {
          const set = new Set(permissions[m.company_id] ?? [])
          for (const p of m.role?.role_permissions ?? []) set.add(p.permission)
          permissions[m.company_id] = [...set]
        }
      }
    }
    this.session = {
      user: { id: user.id, email: user.email ?? profile?.email ?? '', name: profile?.full_name ?? user.email ?? 'User' },
      group, isGroupAdmin: Boolean(profile?.is_group_super_admin), permissions,
    }
    return this.session
  }
  async signIn(email: string, password: string) {
    const { error } = await sb().auth.signInWithPassword({ email, password })
    if (error) throw new NumeroError(error.message)
  }
  async signUp(email: string, password: string, name: string) {
    const { data, error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: window.location.origin } })
    if (error) throw new NumeroError(error.message)
    return { needsEmailConfirmation: !data.session }
  }
  async signOut() { await sb().auth.signOut(); this.session = null }
  onAuthChange(cb: () => void) {
    const { data } = sb().auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') cb() })
    return () => data.subscription.unsubscribe()
  }
  async bootstrapGroup(name: string, currency: string, makerChecker: 'enforced' | 'owner_override') {
    return rpc<ID>('bootstrap_group', { p_name: name, p_currency: currency, p_maker_checker: makerChecker })
  }
  async updateGroupSettings(patch: Partial<Group['settings']>) {
    const cur = this.session?.group?.settings ?? {}
    const settings = { ...cur, ...patch, controls: { ...cur.controls, ...(patch.controls ?? {}) }, sentinel: { ...cur.sentinel, ...(patch.sentinel ?? {}) } }
    await q(sb().from('groups').update({ settings }).eq('id', this.groupId()).select('id'))
    if (this.session?.group) this.session.group.settings = settings
  }

  // ------------------------------------------------------------ master data
  async listCompanies() { return q<Company[]>(sb().from('companies').select('*').order('name')) }
  async createCompany(p: CompanyCreatePayload) { return rpc<ID>('create_company', { p }) }
  async updateCompany(id: ID, patch: Partial<Company>) {
    const { id: _i, group_id: _g, created_at: _c, ...rest } = patch as Company
    await q(sb().from('companies').update(rest).eq('id', id).select('id'))
  }
  async listAccounts(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<Account[]>(sb().from('accounts').select('*').in('company_id', companyIds).order('code').limit(10000))
  }
  async createAccount(a: Parameters<NumeroApi['createAccount']>[0]) {
    const r = await q<{ id: ID }>(sb().from('accounts').insert({
      company_id: a.company_id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, parent_id: a.parent_id ?? null, is_group: !!a.is_group,
      control_type: a.control_type ?? null, currency: a.currency ?? null, counterparty_company_id: a.counterparty_company_id ?? null, description: a.description ?? null,
    }).select('id').single())
    return r.id
  }
  async updateAccount(id: ID, patch: Partial<Account>) {
    const { id: _i, company_id: _c, ...rest } = patch as Account
    await q(sb().from('accounts').update(rest).eq('id', id).select('id'))
  }
  async listOrgUnits(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<OrgUnit[]>(sb().from('org_units').select('*').in('company_id', companyIds).order('name'))
  }
  async createOrgUnit(u: Parameters<NumeroApi['createOrgUnit']>[0]) {
    const r = await q<{ id: ID }>(sb().from('org_units').insert({ company_id: u.company_id, type_key: u.type_key, code: u.code, name: u.name, parent_id: u.parent_id ?? null, confidentiality: u.confidentiality ?? 'internal', meta: u.meta ?? {} }).select('id').single())
    return r.id
  }
  async listOrgUnitTypes() { return q<TypeDef[]>(sb().from('org_unit_types').select('key,name,sort,group_id').order('sort')) }
  async createOrgUnitType(t: { key: string; name: string }) { await q(sb().from('org_unit_types').insert({ ...t, group_id: this.groupId(), sort: 500 }).select('key')) }
  async listPartyTypes() { return q<TypeDef[]>(sb().from('party_types').select('key,name,prefix,category,group_id').order('name')) }
  async createPartyType(t: { key: string; name: string; prefix: string; category: string }) { await q(sb().from('party_types').insert({ ...t, group_id: this.groupId() }).select('key')) }
  async listVoucherTypes() { return q<TypeDef[]>(sb().from('voucher_types').select('key,name,prefix,group_id').order('name')) }
  async listTaxCodes(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<TaxCode[]>(sb().from('tax_codes').select('*, components:tax_code_components(*)').in('company_id', companyIds).order('code') as never)
  }
  async saveTaxCode(t: Parameters<NumeroApi['saveTaxCode']>[0]) {
    const existing = await q<{ id: ID } | null>(sb().from('tax_codes').select('id').eq('company_id', t.company_id).eq('code', t.code).maybeSingle())
    let id = existing?.id
    const from = t.components[0]?.effective_from ?? new Date().toISOString().slice(0, 10)
    if (id) {
      const before = new Date(from); before.setDate(before.getDate() - 1)
      await q(sb().from('tax_code_components').update({ effective_to: before.toISOString().slice(0, 10) }).eq('tax_code_id', id).is('effective_to', null).lt('effective_from', from).select('id'))
      await q(sb().from('tax_codes').update({ name: t.name }).eq('id', id).select('id'))
    } else {
      id = (await q<{ id: ID }>(sb().from('tax_codes').insert({ company_id: t.company_id, code: t.code, name: t.name, kind: t.kind }).select('id').single())).id
    }
    await q(sb().from('tax_code_components').insert(t.components.map((k) => ({ tax_code_id: id, component: k.component, rate: k.rate, output_account_id: k.output_account_id ?? null, input_account_id: k.input_account_id ?? null, effective_from: k.effective_from ?? '2000-01-01' }))).select('id'))
    return id!
  }

  // ------------------------------------------------------------ parties
  async listParties() { return q<Party[]>(sb().from('parties').select('*, roles:party_roles(*)').order('display_name').limit(5000) as never) }
  async createParty(p: PartyInput) { return rpc<CreatePartyResult>('create_party', { p }) }
  async addPartyRole(partyId: ID, companyId: ID, typeKey: string) { await rpc('add_party_role', { p_party: partyId, p_company: companyId, p_type: typeKey }) }
  async setPartyStatus(partyId: ID, status: Party['status'], reason: string) { await rpc('set_party_status', { p_party: partyId, p_status: status, p_reason: reason }) }
  async partyLedgerBalances(companyIds: ID[], to: string) { return rpc<PartyBalanceRow[]>('party_ledger_balances', { p_companies: companyIds, p_to: to }) }
  async listPartyBanks(partyId: ID) { return q<PartyBank[]>(sb().from('party_bank_accounts').select('*').eq('party_id', partyId).order('created_at', { ascending: false })) }
  async addPartyBank(p: Parameters<NumeroApi['addPartyBank']>[0]) { return rpc<ID>('add_party_bank', { p }) }
  async verifyPartyBank(id: ID, decision: 'verified' | 'rejected', note?: string) { await rpc('verify_party_bank', { p_id: id, p_decision: decision, p_note: note ?? null }) }

  // ------------------------------------------------------------ journals
  async listJournals(f: JournalFilter) {
    if (!f.companyIds.length) return { rows: [], total: 0 }
    let s = sb().from('journals').select('*', { count: 'exact' }).in('company_id', f.companyIds)
    if (f.status?.length) s = s.in('status', f.status)
    if (f.from) s = s.gte('journal_date', f.from)
    if (f.to) s = s.lte('journal_date', f.to)
    if (f.q) s = s.or(`narration.ilike.%${f.q.replace(/[%,()]/g, ' ')}%,voucher_no.ilike.%${f.q.replace(/[%,()]/g, ' ')}%`)
    const off = f.offset ?? 0
    const { data, error, count } = await s.order('journal_date', { ascending: false }).order('voucher_no', { ascending: false, nullsFirst: true }).range(off, off + (f.limit ?? 100) - 1)
    if (error) raise(error)
    return { rows: (data ?? []) as Journal[], total: count ?? 0 }
  }
  async openJournal(id: ID) { return rpc<JournalDetail>('open_journal', { p_id: id }) }
  async saveJournalDraft(input: JournalInput) { return rpc<ID>('save_journal_draft', { p: input }) }
  async submitJournal(id: ID) { await rpc('submit_journal', { p_id: id }) }
  async approveJournal(id: ID, comment?: string) { return rpc<'approved' | 'pending'>('approve_journal', { p_id: id, p_comment: comment ?? null }) }
  async rejectJournal(id: ID, comment: string) { await rpc('reject_journal', { p_id: id, p_comment: comment }) }
  async cancelJournal(id: ID, reason?: string) { await rpc('cancel_journal', { p_id: id, p_reason: reason ?? null }) }
  async postJournal(id: ID) { return rpc<string>('post_journal', { p_id: id }) }
  async reverseJournal(id: ID, date: string, reason: string) { return rpc<ID>('reverse_journal', { p_id: id, p_date: date, p_reason: reason }) }

  // ------------------------------------------------------------ ledger
  async ledgerBalances(companyIds: ID[], from: string, to: string, opts: { knownAt?: string; dim?: ID } = {}) {
    if (!companyIds.length) return []
    return rpc<LedgerBalanceRow[]>('ledger_balances', { p_companies: companyIds, p_from: from, p_to: to, p_known_at: opts.knownAt ?? null, p_dim: opts.dim ?? null })
  }
  async ledgerMonthly(companyIds: ID[], from: string, to: string) {
    if (!companyIds.length) return []
    return rpc<LedgerMonthlyRow[]>('ledger_monthly', { p_companies: companyIds, p_from: from, p_to: to })
  }
  async ledgerLines(f: LedgerFilter) { return rpc<LedgerLinesResult>('ledger_lines', { p: f }) }
  async integrityCheck(companyIds: ID[]) { return rpc<IntegrityReport>('integrity_check', { p_companies: companyIds }) }

  // ------------------------------------------------------------ documents
  async listInvoices(f: { companyIds: ID[]; docTypes?: DocType[]; partyId?: ID }) {
    if (!f.companyIds.length) return []
    let s = sb().from('invoices').select('*').in('company_id', f.companyIds)
    if (f.docTypes?.length) s = s.in('doc_type', f.docTypes)
    if (f.partyId) s = s.eq('party_id', f.partyId)
    return q<Invoice[]>(s.order('doc_date', { ascending: false }).limit(5000))
  }
  async getInvoice(id: ID) { return q<Invoice>(sb().from('invoices').select('*, lines:invoice_lines(*)').eq('id', id).single() as never) }
  async saveInvoice(input: InvoiceInput) { return rpc<ID>('save_invoice', { p: input }) }
  async approveInvoice(id: ID) { return rpc<string>('approve_invoice', { p_id: id }) }
  async listPayments(f: { companyIds: ID[]; partyId?: ID }) {
    if (!f.companyIds.length) return []
    let s = sb().from('payments').select('*, allocations:payment_allocations(invoice_id, amount)').in('company_id', f.companyIds)
    if (f.partyId) s = s.eq('party_id', f.partyId)
    return q<Payment[]>(s.order('pay_date', { ascending: false }).limit(5000) as never)
  }
  async savePayment(input: PaymentInput) { return rpc<ID>('save_payment', { p: input }) }
  async approvePayment(id: ID) { return rpc<string>('approve_payment', { p_id: id }) }

  // ------------------------------------------------------------ banking
  async listBankAccounts(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<BankAccount[]>(sb().from('bank_accounts').select('*').in('company_id', companyIds).order('name'))
  }
  async createBankAccount(b: Omit<BankAccount, 'id' | 'is_active'>) { return (await q<{ id: ID }>(sb().from('bank_accounts').insert(b).select('id').single())).id }
  async listBankTransactions(bankAccountId: ID) { return q<BankTxn[]>(sb().from('bank_transactions').select('*').eq('bank_account_id', bankAccountId).order('txn_date', { ascending: false }).limit(5000)) }
  async importBankTransactions(bankAccountId: ID, rows: Parameters<NumeroApi['importBankTransactions']>[1]) {
    return rpc<{ imported: number; possible_duplicates: number }>('import_bank_transactions', { p_bank: bankAccountId, p_rows: rows })
  }
  async suggestBankMatches(bankAccountId: ID) { return rpc<BankSuggestion[]>('suggest_bank_matches', { p_bank: bankAccountId }) }
  async setBankMatch(txnId: ID, lineId: ID | null, status: BankTxnStatus, note?: string) { await rpc('set_bank_match', { p_txn: txnId, p_line: lineId, p_status: status, p_note: note ?? null }) }

  // ------------------------------------------------------------ periods
  async listPeriods(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<FiscalPeriod[]>(sb().from('fiscal_periods').select('*').in('company_id', companyIds).order('period_start', { ascending: false }))
  }
  async setPeriodStatus(companyId: ID, date: string, status: FiscalPeriod['status'], reason?: string) {
    await rpc('set_period_status', { p_company: companyId, p_date: date, p_status: status, p_reason: reason ?? null })
  }

  // ------------------------------------------------------------ approvals
  async listApprovalRequests(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<ApprovalRequest[]>(sb().from('approval_requests').select('*').in('company_id', companyIds).order('requested_at', { ascending: false }).limit(1000))
  }
  async listApprovalRules() { return q<ApprovalRule[]>(sb().from('approval_rules').select('*').order('min_amount')) }
  async saveApprovalRule(r: Parameters<NumeroApi['saveApprovalRule']>[0]) {
    const row = { company_id: r.company_id, entity: r.entity, name: r.name, min_amount: r.min_amount, max_amount: r.max_amount, steps: r.steps, is_active: r.is_active ?? true }
    if (r.id) await q(sb().from('approval_rules').update(row).eq('id', r.id).select('id'))
    else await q(sb().from('approval_rules').insert({ ...row, group_id: this.groupId() }).select('id'))
  }

  // ------------------------------------------------------------ budgets
  async listBudgets(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<Budget[]>(sb().from('budgets').select('*').in('company_id', companyIds).order('fy', { ascending: false }))
  }
  async getBudgetLines(budgetId: ID) { return q<BudgetLine[]>(sb().from('budget_lines').select('*').eq('budget_id', budgetId).limit(20000)) }
  async saveBudget(b: Parameters<NumeroApi['saveBudget']>[0]) {
    let id = b.id
    if (id) {
      await q(sb().from('budgets').update({ name: b.name, kind: b.kind, limit_mode: b.limit_mode }).eq('id', id).select('id'))
      await q(sb().from('budget_lines').delete().eq('budget_id', id).select('id'))
    } else {
      const prior = await q<{ version: number }[]>(sb().from('budgets').select('version').eq('company_id', b.company_id).eq('name', b.name).eq('fy', b.fy))
      const version = Math.max(0, ...prior.map((x) => x.version)) + 1
      id = (await q<{ id: ID }>(sb().from('budgets').insert({ company_id: b.company_id, name: b.name, fy: b.fy, kind: b.kind, limit_mode: b.limit_mode, version }).select('id').single())).id
    }
    if (b.lines.length) await q(sb().from('budget_lines').insert(b.lines.map((l) => ({ ...l, budget_id: id, company_id: b.company_id }))).select('id'))
    return id!
  }
  async setBudgetStatus(id: ID, status: 'approved' | 'revised') { await q(sb().from('budgets').update({ status }).eq('id', id).select('id')) }

  // ------------------------------------------------------------ sentinel
  async listAlerts(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<Alert[]>(sb().from('alerts').select('*').in('company_id', companyIds).order('created_at', { ascending: false }).limit(1000))
  }
  async runSentinel(companyId: ID) { return rpc<number>('run_sentinel', { p_company: companyId }) }
  async reviewAlert(id: ID, status: Alert['status'], note?: string) { await rpc('review_alert', { p_id: id, p_status: status, p_note: note ?? null }) }

  // ------------------------------------------------------------ audit
  private async loadNames() {
    if (this.names.size) return
    const ps = await q<{ id: ID; full_name: string | null; email: string | null }[]>(sb().from('profiles').select('id,full_name,email'))
    for (const p of ps) this.names.set(p.id, p.full_name ?? p.email ?? p.id)
  }
  async listAudit(f: { companyIds?: ID[]; entity?: string; entityId?: ID; limit?: number }) {
    await this.loadNames()
    let s = sb().from('audit_log').select('*')
    if (f.companyIds?.length) s = s.or(`company_id.in.(${f.companyIds.join(',')}),company_id.is.null`)
    if (f.entity) s = s.eq('entity', f.entity)
    if (f.entityId) s = s.eq('entity_id', f.entityId)
    const rows = await q<AuditEntry[]>(s.order('id', { ascending: false }).limit(f.limit ?? 300))
    return rows.map((r) => ({ ...r, actor_name: r.actor ? this.names.get(r.actor) ?? 'Unknown user' : 'System' }))
  }

  // ------------------------------------------------------------ NUMI
  async listNumiRules(companyIds: ID[]) {
    if (!companyIds.length) return []
    return q<NumiRule[]>(sb().from('numi_rules').select('*').in('company_id', companyIds).order('approved_count', { ascending: false }))
  }
  async numiLearn(companyId: ID, pattern: string, partyId: ID | null, accountId: ID) { await rpc('numi_learn', { p_company: companyId, p_pattern: pattern, p_party: partyId, p_account: accountId }) }
  async setNumiRuleStatus(id: ID, status: 'active' | 'disabled') { await q(sb().from('numi_rules').update({ status }).eq('id', id).select('id')) }
  async logNumi(e: Parameters<NumeroApi['logNumi']>[0]) {
    if (!this.session?.group) return
    await sb().from('numi_log').insert({ ...e, group_id: this.session.group.id, user_id: this.session.user.id })
  }
  async logVoice(e: Parameters<NumeroApi['logVoice']>[0]) {
    if (!this.session?.group) return
    await sb().from('voice_audit').insert({ ...e, group_id: this.session.group.id, user_id: this.session.user.id })
  }

  // ------------------------------------------------------------ genesis
  async listCustomFields() { return q<CustomFieldDef[]>(sb().from('custom_field_defs').select('*').order('entity')) }
  async saveCustomField(d: Parameters<NumeroApi['saveCustomField']>[0]) {
    const row = { company_id: d.company_id, entity: d.entity, scope_key: d.scope_key ?? null, key: d.key, label: d.label, field_type: d.field_type, options: d.options, rules: d.rules, is_required: d.is_required, status: d.status ?? 'active' }
    if (d.id) {
      const cur = await q<{ version: number }>(sb().from('custom_field_defs').select('version').eq('id', d.id).single())
      await q(sb().from('custom_field_defs').update({ ...row, version: cur.version + 1 }).eq('id', d.id).select('id'))
    } else await q(sb().from('custom_field_defs').insert({ ...row, group_id: this.groupId() }).select('id'))
  }
  async listRoles() {
    const rows = await q<{ id: ID; key: string; name: string; is_system: boolean; role_permissions: { permission: string }[] }[]>(
      sb().from('roles').select('id,key,name,is_system,role_permissions(permission)').order('name') as never)
    return rows.map<Role>((r) => ({ id: r.id, key: r.key, name: r.name, is_system: r.is_system, permissions: r.role_permissions.map((p) => p.permission) }))
  }
  async listMembers() {
    const rows = await q<{ id: ID; user_id: ID; company_id: ID; valid_from: string | null; valid_to: string | null; profile: { email: string; full_name: string } | null; role: { key: string } | null }[]>(
      sb().from('memberships').select('id,user_id,company_id,valid_from,valid_to, profile:profiles(email,full_name), role:roles(key)') as never)
    return rows.map<Member>((m) => ({ id: m.id, user_id: m.user_id, company_id: m.company_id, valid_from: m.valid_from, valid_to: m.valid_to, email: m.profile?.email ?? '', full_name: m.profile?.full_name ?? '', role_key: m.role?.key ?? '' }))
  }
  async grantMembership(email: string, companyId: ID, roleKey: string, validFrom?: string, validTo?: string) {
    await rpc('grant_membership', { p_email: email, p_company: companyId, p_role_key: roleKey, p_valid_from: validFrom ?? null, p_valid_to: validTo ?? null })
  }
  async revokeMembership(id: ID) { await q(sb().from('memberships').delete().eq('id', id).select('id')) }

  // ------------------------------------------------------------ requirement ledger
  async listRequirements() {
    if (this.session?.isGroupAdmin) {
      const rows = await q<{ no: number; prompt: string; module: string; title: string; body: string | null; status: string; phase: number; evidence: string | null; notes: string | null }[]>(
        sb().from('requirement_ledger').select('*').order('no').limit(5000))
      if (rows.length) {
        return { source: 'database', requirements: rows.map<Requirement>((r) => ({ id: 'REQ-' + String(r.no).padStart(4, '0'), no: r.no, prompt: r.prompt, title: r.title, module: r.module, text: r.body ?? '', status: r.status, phase: r.phase, evidence: r.evidence ?? '', notes: r.notes ?? '' })) }
      }
    }
    try {
      const r = await fetch('/requirements.json', { cache: 'no-cache' })
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      return { requirements: j.requirements as Requirement[], source: 'local ledger file' }
    } catch {
      return { requirements: [], source: 'unavailable' }
    }
  }
  async syncRequirements(reqs: Requirement[]) {
    const gid = this.groupId()
    let n = 0
    for (let i = 0; i < reqs.length; i += 200) {
      const chunk = reqs.slice(i, i + 200).map((r) => ({ group_id: gid, no: r.no, prompt: r.prompt, module: r.module, title: r.title, body: r.text, status: r.status, phase: r.phase, evidence: r.evidence, notes: r.notes }))
      await q(sb().from('requirement_ledger').upsert(chunk, { onConflict: 'group_id,no' }).select('no'))
      n += chunk.length
    }
    return n
  }
}
