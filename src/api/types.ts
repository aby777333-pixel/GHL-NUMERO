import type {
  Account, Alert, ApprovalRequest, ApprovalRule, AuditEntry, BankAccount, BankSuggestion, BankTxn, BankTxnStatus, Budget, BudgetLine,
  Company, CompanyCreatePayload, CustomFieldDef, DocType, FiscalPeriod, Group, ID, IntegrityReport, Invoice, InvoiceInput, Journal,
  JournalDetail, JournalInput, JournalStatus, LedgerBalanceRow, LedgerFilter, LedgerLinesResult, LedgerMonthlyRow, Member, NumiRule, SuperAdmin,
  OrgUnit, Party, PartyBalanceRow, PartyBank, Payment, PaymentInput, Requirement, Role, SessionInfo, TaxCode, TypeDef,
} from '@/engine/types'
import type { OpsApi } from './opsApi'
import type { Phase3Api } from './p3Api'

export type CreatePartyResult =
  | { status: 'created'; id: ID; party_no: string }
  | { status: 'possible_duplicate'; candidates: { id: ID; party_no: string; display_name: string }[]; restricted_matches: number }

export interface PartyInput {
  company_id: ID
  type_key: string
  kind?: 'person' | 'organization'
  display_name: string
  legal_name?: string
  pan?: string
  gstin?: string
  email?: string
  phone?: string
  credit_limit?: number
  credit_days?: number
  payment_terms?: string
  notes?: string
  force?: boolean
}

export interface JournalFilter {
  companyIds: ID[]
  status?: JournalStatus[]
  from?: string
  to?: string
  q?: string
  limit?: number
  offset?: number
}

/**
 * The single data contract of the application. Two implementations exist:
 *   live  – Supabase (Postgres + Row Level Security + controlled posting functions)
 *   demo  – an in-browser ledger engine seeded with clearly-labelled sample data
 * Both enforce the same accounting invariants.
 */
export interface CoreApi {
  readonly mode: 'live' | 'demo'

  // session
  getSession(): Promise<SessionInfo | null>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string, name: string): Promise<{ needsEmailConfirmation: boolean }>
  signOut(): Promise<void>
  /** `event` names what changed where the engine knows it, such as PASSWORD_RECOVERY */
  onAuthChange(cb: (event?: string) => void): () => void
  bootstrapGroup(name: string, currency: string, makerChecker: 'enforced' | 'owner_override'): Promise<ID>
  updateGroupSettings(patch: Partial<Group['settings']>): Promise<void>

  // master data
  listCompanies(): Promise<Company[]>
  createCompany(payload: CompanyCreatePayload): Promise<ID>
  updateCompany(id: ID, patch: Partial<Company>): Promise<void>
  listAccounts(companyIds: ID[]): Promise<Account[]>
  listAccountMap(companyIds: ID[]): Promise<{ company_id: ID; key: string; account_id: ID }[]>
  setAccountMap(companyId: ID, key: string, accountId: ID): Promise<void>
  createAccount(a: Omit<Account, 'id' | 'is_active' | 'counterparty_company_id' | 'currency'> & Partial<Account>): Promise<ID>
  updateAccount(id: ID, patch: Partial<Account>): Promise<void>
  listOrgUnits(companyIds: ID[]): Promise<OrgUnit[]>
  createOrgUnit(u: Pick<OrgUnit, 'company_id' | 'type_key' | 'code' | 'name'> & Partial<OrgUnit>): Promise<ID>
  listOrgUnitTypes(): Promise<TypeDef[]>
  createOrgUnitType(t: { key: string; name: string }): Promise<void>
  listPartyTypes(): Promise<TypeDef[]>
  createPartyType(t: { key: string; name: string; prefix: string; category: string }): Promise<void>
  listVoucherTypes(): Promise<TypeDef[]>
  listTaxCodes(companyIds: ID[]): Promise<TaxCode[]>
  saveTaxCode(t: { company_id: ID; code: string; name: string; kind: string; components: { component: string; rate: number; output_account_id?: ID | null; input_account_id?: ID | null; effective_from?: string }[] }): Promise<ID>

  // parties
  listParties(): Promise<Party[]>
  createParty(p: PartyInput): Promise<CreatePartyResult>
  addPartyRole(partyId: ID, companyId: ID, typeKey: string): Promise<void>
  setPartyStatus(partyId: ID, status: Party['status'], reason: string): Promise<void>
  partyLedgerBalances(companyIds: ID[], to: string): Promise<PartyBalanceRow[]>
  listPartyBanks(partyId: ID): Promise<PartyBank[]>
  addPartyBank(p: { company_id: ID; party_id: ID; bank_name: string; account_no: string; ifsc?: string; beneficiary_name: string }): Promise<ID>
  verifyPartyBank(id: ID, decision: 'verified' | 'rejected', note?: string): Promise<void>

  // journals
  listJournals(f: JournalFilter): Promise<{ rows: Journal[]; total: number }>
  openJournal(id: ID): Promise<JournalDetail>
  saveJournalDraft(input: JournalInput): Promise<ID>
  submitJournal(id: ID): Promise<void>
  approveJournal(id: ID, comment?: string): Promise<'approved' | 'pending'>
  rejectJournal(id: ID, comment: string): Promise<void>
  cancelJournal(id: ID, reason?: string): Promise<void>
  postJournal(id: ID): Promise<string>
  reverseJournal(id: ID, date: string, reason: string): Promise<ID>

  // ledger & reporting primitives
  ledgerBalances(companyIds: ID[], from: string, to: string, opts?: { knownAt?: string; dim?: ID }): Promise<LedgerBalanceRow[]>
  ledgerMonthly(companyIds: ID[], from: string, to: string): Promise<LedgerMonthlyRow[]>
  ledgerLines(f: LedgerFilter): Promise<LedgerLinesResult>
  integrityCheck(companyIds: ID[]): Promise<IntegrityReport>

  // documents
  listInvoices(f: { companyIds: ID[]; docTypes?: DocType[]; partyId?: ID }): Promise<Invoice[]>
  getInvoice(id: ID): Promise<Invoice>
  saveInvoice(input: InvoiceInput): Promise<ID>
  approveInvoice(id: ID): Promise<string>
  listPayments(f: { companyIds: ID[]; partyId?: ID }): Promise<Payment[]>
  savePayment(input: PaymentInput): Promise<ID>
  approvePayment(id: ID): Promise<string>

  // banking
  listBankAccounts(companyIds: ID[]): Promise<BankAccount[]>
  createBankAccount(b: Omit<BankAccount, 'id' | 'is_active'>): Promise<ID>
  listBankTransactions(bankAccountId: ID): Promise<BankTxn[]>
  importBankTransactions(bankAccountId: ID, rows: { txn_date: string; amount: number | string; narration?: string; reference?: string; running_balance?: number | string }[]): Promise<{ imported: number; possible_duplicates: number }>
  suggestBankMatches(bankAccountId: ID): Promise<BankSuggestion[]>
  setBankMatch(txnId: ID, lineId: ID | null, status: BankTxnStatus, note?: string): Promise<void>

  // periods
  listPeriods(companyIds: ID[]): Promise<FiscalPeriod[]>
  setPeriodStatus(companyId: ID, date: string, status: FiscalPeriod['status'], reason?: string): Promise<void>

  // approvals
  listApprovalRequests(companyIds: ID[]): Promise<ApprovalRequest[]>
  listApprovalRules(): Promise<ApprovalRule[]>
  saveApprovalRule(r: Omit<ApprovalRule, 'id' | 'group_id' | 'is_active'> & { id?: ID; is_active?: boolean }): Promise<void>

  // budgets
  listBudgets(companyIds: ID[]): Promise<Budget[]>
  getBudgetLines(budgetId: ID): Promise<BudgetLine[]>
  saveBudget(b: { id?: ID; company_id: ID; name: string; fy: number; kind: 'opex' | 'capex'; limit_mode: 'soft' | 'hard'; lines: Omit<BudgetLine, 'id' | 'budget_id' | 'company_id'>[] }): Promise<ID>
  setBudgetStatus(id: ID, status: 'approved' | 'revised'): Promise<void>

  // sentinel
  listAlerts(companyIds: ID[]): Promise<Alert[]>
  runSentinel(companyId: ID): Promise<number>
  reviewAlert(id: ID, status: Alert['status'], note?: string): Promise<void>

  // audit
  listAudit(f: { companyIds?: ID[]; entity?: string; entityId?: ID; limit?: number }): Promise<AuditEntry[]>

  // NUMI
  listNumiRules(companyIds: ID[]): Promise<NumiRule[]>
  numiLearn(companyId: ID, pattern: string, partyId: ID | null, accountId: ID): Promise<void>
  setNumiRuleStatus(id: ID, status: 'active' | 'disabled'): Promise<void>
  logNumi(e: { channel: 'text' | 'voice'; question: string; intent?: string; answer?: string; evidence?: unknown; screen?: string }): Promise<void>
  logVoice(e: { provider: string; language?: string; transcript: string; intent?: string; action?: string; required_confirmation?: boolean; confirmed?: boolean; result?: string }): Promise<void>

  // genesis (configuration)
  listCustomFields(): Promise<CustomFieldDef[]>
  saveCustomField(d: Omit<CustomFieldDef, 'id' | 'group_id' | 'version' | 'status'> & { id?: ID; status?: CustomFieldDef['status'] }): Promise<void>
  listRoles(): Promise<Role[]>
  listMembers(): Promise<Member[]>
  grantMembership(email: string, companyId: ID, roleKey: string, validFrom?: string, validTo?: string): Promise<void>
  revokeMembership(id: ID): Promise<void>
  /** Group Super Admins, and the people named to become one once their email address is confirmed. Empty for anyone who is not one. */
  listSuperAdmins(): Promise<SuperAdmin[]>
  /** `active` when the person has a confirmed account and holds the authority now; `pending` until they sign up and confirm. */
  grantSuperAdmin(email: string): Promise<'active' | 'pending'>
  revokeSuperAdmin(email: string): Promise<void>

  // requirement ledger
  listRequirements(): Promise<{ requirements: Requirement[]; source: string }>
  syncRequirements(reqs: Requirement[]): Promise<number>
}

/** The complete contract: the accounting core, the operations that surround it, and Phase 3 (inventory, investments, control, simulation, platform). */
export interface NumeroApi extends CoreApi, OpsApi, Phase3Api {}
