// Domain model shared by the live (Supabase) and demo data layers.
// Monetary values cross the API boundary as string | number and are converted
// to Decimal at the point of arithmetic.

export type ID = string
export type Num = string | number
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
export type Confidentiality = 'internal' | 'confidential' | 'highly_confidential' | 'restricted' | 'super_admin_only'
export type JournalStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'reversed' | 'rejected' | 'cancelled'

/** Zero-ambiguity principle (spec 90, 1490): these are never mixed without a label. */
export type TruthState = 'ACTUAL' | 'RECONCILED' | 'UNRECONCILED' | 'COMMITTED' | 'EXPECTED' | 'BUDGET' | 'FORECAST' | 'AI ESTIMATE' | 'SIMULATION' | 'CONTINGENT' | 'DISPUTED' | 'PROVISIONAL' | 'DEMO'

export interface Group {
  id: ID
  name: string
  base_currency: string
  settings: {
    controls?: { maker_checker?: 'enforced' | 'owner_override' }
    sentinel?: { timezone?: string; large_payment?: number; round_number_unit?: number }
    [k: string]: unknown
  }
}

export interface Company {
  id: ID
  group_id: ID
  code: string
  name: string
  legal_name?: string | null
  business_type?: string | null
  industry?: string | null
  country: string
  state?: string | null
  registered_address?: string | null
  pan?: string | null
  gstin?: string | null
  cin?: string | null
  fy_start_month: number
  base_currency: string
  accounting_method: string
  modules: Record<string, boolean>
  template_key?: string | null
  status: 'active' | 'archived'
  created_at: string
}

export interface Account {
  id: ID
  company_id: ID
  code: string
  name: string
  type: AccountType
  subtype: string
  parent_id: ID | null
  is_group: boolean
  currency: string | null
  control_type: string | null
  counterparty_company_id: ID | null
  is_active: boolean
  description?: string | null
}

export interface OrgUnit {
  id: ID
  company_id: ID
  type_key: string
  parent_id: ID | null
  code: string
  name: string
  status: string
  confidentiality: Confidentiality
  meta: Record<string, unknown>
}

export interface TypeDef { key: string; name: string; prefix?: string; category?: string; sort?: number; group_id?: ID | null }

export interface PartyRole {
  id: ID
  party_id: ID
  company_id: ID
  type_key: string
  status: string
  credit_limit?: Num | null
  credit_days?: number | null
  payment_terms?: string | null
}

export interface Party {
  id: ID
  group_id: ID
  party_no: string
  kind: 'person' | 'organization'
  display_name: string
  legal_name?: string | null
  pan?: string | null
  gstin?: string | null
  email?: string | null
  phone?: string | null
  status: 'active' | 'suspended' | 'blocked' | 'inactive' | 'terminated'
  status_reason?: string | null
  notes?: string | null
  created_at: string
  roles: PartyRole[]
}

export interface PartyBank {
  id: ID
  party_id: ID
  company_id: ID
  bank_name: string
  account_no: string
  ifsc?: string | null
  beneficiary_name: string
  status: 'pending_verification' | 'verified' | 'superseded' | 'rejected'
  created_by?: ID | null
  created_at: string
  verified_by?: ID | null
  verified_at?: string | null
}

export interface JournalLineInput {
  account_id: ID
  party_id?: ID | null
  description?: string | null
  debit?: Num
  credit?: Num
  txn_currency?: string | null
  txn_amount?: Num | null
  fx_rate?: Num | null
  dims?: Record<string, ID>
}

export interface JournalInput {
  id?: ID
  company_id: ID
  voucher_type?: string
  journal_date: string
  narration?: string
  purpose?: string
  confidentiality?: Confidentiality
  origin?: 'human' | 'ai_suggested' | 'system' | 'import'
  source?: string
  idempotency_key?: string
  lines: JournalLineInput[]
}

export interface Journal {
  id: ID
  company_id: ID
  voucher_type: string
  voucher_no: string | null
  journal_date: string
  narration: string | null
  purpose: string | null
  status: JournalStatus
  source: string
  source_id: ID | null
  origin: string
  reversal_of: ID | null
  reversed_by: ID | null
  confidentiality: Confidentiality
  total: Num
  created_by: ID | null
  created_at: string
  submitted_by?: ID | null
  submitted_at?: string | null
  approved_by?: ID | null
  approved_at?: string | null
  posted_by?: ID | null
  posted_at?: string | null
}

export interface JournalLineView {
  id: ID
  line_no: number
  account_id: ID
  account_code: string
  account_name: string
  party_id: ID | null
  party_name: string | null
  description: string | null
  debit: Num
  credit: Num
  txn_currency?: string | null
  txn_amount?: Num | null
  fx_rate?: Num | null
  dims: Record<string, { id: ID; name: string; code: string }>
}

export interface JournalDetail extends Journal {
  restricted?: boolean
  message?: string
  company_name: string
  people: Record<ID, string>
  lines: JournalLineView[]
  approvals: { step: number; action: string; comment: string | null; at: string; actor: string | null }[]
  history: { at: string; action: string; reason: string | null; actor: string | null }[]
}

export interface LedgerBalanceRow {
  company_id: ID
  account_id: ID
  opening_debit: Num
  opening_credit: Num
  period_debit: Num
  period_credit: Num
}

export interface LedgerMonthlyRow { company_id: ID; account_id: ID; month: string; debit: Num; credit: Num }

export interface LedgerLine {
  id: ID
  journal_id: ID
  company_id: ID
  company_name: string
  line_no: number
  account_id: ID
  account_code: string
  account_name: string
  account_type: AccountType
  party_id: ID | null
  party_name: string | null
  party_no?: string | null
  description: string | null
  debit: Num
  credit: Num
  voucher_no: string | null
  voucher_type: string
  journal_date: string
  narration: string | null
  status: JournalStatus
  source: string
  source_id: ID | null
  origin: string
  confidentiality: Confidentiality
  posted_at: string | null
}

export interface LedgerFilter {
  company_ids: ID[]
  account_ids?: ID[]
  party_id?: ID
  org_unit_id?: ID
  journal_id?: ID
  from?: string
  to?: string
  q?: string
  min_amount?: number
  known_at?: string
  limit?: number
  offset?: number
}

export interface LedgerLinesResult {
  rows: LedgerLine[]
  total: number
  sum_debit: Num
  sum_credit: Num
  restricted: { count: number; debit: Num; credit: Num }
}

export interface PartyBalanceRow { company_id: ID; party_id: ID; control_type: string; debit: Num; credit: Num }

export interface TaxComponent {
  id?: ID
  component: string
  rate: Num
  output_account_id?: ID | null
  input_account_id?: ID | null
  effective_from?: string
  effective_to?: string | null
}
export interface TaxCode {
  id: ID
  company_id: ID
  code: string
  name: string
  kind: string
  jurisdiction: string
  is_active: boolean
  components: TaxComponent[]
}

export type DocType = 'sales_invoice' | 'purchase_bill' | 'credit_note' | 'debit_note'
export interface InvoiceLineInput {
  description?: string
  account_id: ID
  quantity?: Num
  rate?: Num
  amount?: Num
  tax_code_id?: ID | null
  hsn_sac?: string
  dims?: Record<string, ID>
}
export interface InvoiceInput {
  id?: ID
  company_id: ID
  doc_type: DocType
  party_id: ID
  doc_date: string
  due_date?: string | null
  currency?: string
  fx_rate?: Num
  reference?: string
  place_of_supply?: string
  narration?: string
  confidentiality?: Confidentiality
  origin?: string
  lines: InvoiceLineInput[]
}
export interface Invoice {
  id: ID
  company_id: ID
  doc_type: DocType
  doc_no: string | null
  party_id: ID
  doc_date: string
  due_date: string | null
  currency: string
  fx_rate: Num
  reference: string | null
  narration: string | null
  subtotal: Num
  tax_total: Num
  total: Num
  amount_settled: Num
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'cancelled' | 'disputed'
  journal_id: ID | null
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
  lines?: (InvoiceLineInput & { id: ID; line_no: number; tax_amount: Num; amount: Num })[]
}

export interface PaymentInput {
  company_id: ID
  direction: 'in' | 'out'
  party_id: ID
  bank_ledger_id: ID
  party_bank_account_id?: ID | null
  pay_date: string
  amount: Num
  currency?: string
  fx_rate?: Num
  method?: string
  reference?: string
  narration?: string
  allocations?: { invoice_id: ID; amount: Num }[]
}
export interface Payment {
  id: ID
  company_id: ID
  direction: 'in' | 'out'
  pay_no: string | null
  party_id: ID
  bank_ledger_id: ID
  pay_date: string
  amount: Num
  currency: string
  fx_rate: Num
  method: string
  reference: string | null
  narration: string | null
  status: 'draft' | 'posted' | 'cancelled'
  journal_id: ID | null
  created_by: ID | null
  created_at: string
  allocations?: { invoice_id: ID; amount: Num }[]
}

export interface BankAccount {
  id: ID
  company_id: ID
  ledger_account_id: ID
  name: string
  bank_name: string | null
  account_no_masked: string | null
  ifsc?: string | null
  currency: string
  kind: string
  is_active: boolean
}
export type BankTxnStatus = 'unmatched' | 'suggested' | 'matched' | 'partial' | 'duplicate' | 'needs_review'
export interface BankTxn {
  id: ID
  company_id: ID
  bank_account_id: ID
  txn_date: string
  amount: Num
  narration: string | null
  reference: string | null
  running_balance?: Num | null
  status: BankTxnStatus
  matched_line_id: ID | null
  note?: string | null
}
export interface BankSuggestion {
  txn_id: ID
  line_id: ID
  journal_id: ID
  voucher_no: string | null
  journal_date: string
  narration: string | null
  amount: Num
  score: number
  reasons: string[]
}

export interface FiscalPeriod {
  id: ID
  company_id: ID
  period_start: string
  period_end: string
  status: 'open' | 'soft_closed' | 'locked'
  changed_at?: string | null
  reason?: string | null
}

export interface ApprovalRule {
  id: ID
  group_id: ID
  company_id: ID | null
  entity: string
  name: string
  min_amount: Num
  max_amount: Num | null
  steps: string[]
  is_active: boolean
}
export interface ApprovalRequest {
  id: ID
  company_id: ID
  entity: string
  entity_id: ID
  amount: Num
  steps: string[]
  current_step: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  summary: string | null
  requested_by: ID | null
  requested_at: string
}

export interface Budget {
  id: ID
  company_id: ID
  name: string
  fy: number
  version: number
  kind: 'opex' | 'capex'
  status: 'draft' | 'approved' | 'revised'
  limit_mode: 'soft' | 'hard'
  created_at: string
}
export interface BudgetLine { id?: ID; budget_id: ID; company_id: ID; account_id: ID; org_unit_id?: ID | null; period_month: string; amount: Num }

export interface Alert {
  id: ID
  company_id: ID
  kind: string
  attention: 'info' | 'review' | 'priority' | 'critical'
  title: string
  explanation: string
  evidence: Record<string, unknown>
  entity: string | null
  entity_id: ID | null
  status: 'open' | 'reviewing' | 'false_positive' | 'resolved'
  created_at: string
  review_note?: string | null
}

export interface AuditEntry {
  id: number | string
  at: string
  actor: ID | null
  actor_name?: string | null
  company_id: ID | null
  entity: string
  entity_id: ID | null
  action: string
  old_value?: unknown
  new_value?: unknown
  reason: string | null
}

export interface NumiRule {
  id: ID
  company_id: ID
  pattern: string
  party_id: ID | null
  account_id: ID
  approved_count: number
  status: 'active' | 'disabled'
  last_used_at: string
}

export interface CustomFieldDef {
  id: ID
  group_id: ID
  company_id: ID | null
  entity: string
  scope_key?: string | null
  key: string
  label: string
  field_type: string
  options: unknown[]
  rules: Record<string, unknown>
  is_required: boolean
  status: 'draft' | 'active' | 'inactive'
  version: number
}

export interface Role { id: ID; key: string; name: string; is_system: boolean; permissions: string[] }
export interface Member { id: ID; user_id: ID; email: string; full_name: string; company_id: ID; role_key: string; valid_from?: string | null; valid_to?: string | null }

export interface Requirement {
  id: string
  no: number
  prompt: string
  promptTitle?: string
  title: string
  module: string
  text: string
  status: string
  phase: number
  evidence: string
  notes: string
}

export interface SessionInfo {
  user: { id: ID; email: string; name: string }
  group: Group | null
  isGroupAdmin: boolean
  /** permission strings per company; group admins hold every permission */
  permissions: Record<ID, string[]>
}

export interface CompanyCreatePayload {
  company: Partial<Company> & { code: string; name: string }
  accounts: TemplateAccount[]
  account_map: Record<string, string>
  tax_codes: { code: string; name: string; kind?: string; components: { component: string; rate: number; output_code?: string; input_code?: string }[] }[]
  org_units?: { type_key: string; code: string; name: string; parent_code?: string }[]
}

export interface TemplateAccount {
  code: string
  name: string
  type: AccountType
  subtype: string
  parent_code?: string
  is_group?: boolean
  control_type?: string
  description?: string
}

export interface IntegrityReport {
  posted_journals: number
  unbalanced_journals: number
  total_debits: Num
  total_credits: Num
  drafts: number
  awaiting_approval: number
  approved_unposted: number
  unreconciled_bank_lines: number
  locked_periods: number
  open_alerts: number
}

export class NumeroError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message.replace(/^NUMERO:\s*/, ''))
    this.name = 'NumeroError'
    this.code = code
  }
}
