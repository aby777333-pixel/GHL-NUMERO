// Phase 2 domain model: operations that surround the ledger.
// None of these records writes to the ledger on its own. Each one PROPOSES a
// journal that passes through the same approval control as any other journal.

import type { Confidentiality, ID, Num } from './types'
import { P3_ACCOUNT_MAP_KEYS, P3_PERMS } from './p3Types'
import type { BookingDetail } from './p3Types'

// ------------------------------------------------------------------ permissions
export const BASE_PERMS = [
  'company.view', 'company.configure', 'account.view', 'account.configure', 'orgunit.configure',
  'journal.view', 'journal.create', 'journal.edit', 'journal.submit', 'journal.approve', 'journal.reject', 'journal.post', 'journal.reverse',
  'invoice.view', 'invoice.create', 'invoice.approve', 'bill.view', 'bill.create', 'bill.approve',
  'payment.view', 'payment.create', 'payment.approve', 'party.view', 'party.create', 'party.edit', 'party.bank.verify',
  'bank.view', 'bank.import', 'bank.reconcile', 'budget.view', 'budget.edit', 'budget.approve', 'period.lock', 'period.reopen',
  'report.view', 'report.export', 'audit.view', 'sentinel.view', 'sentinel.review', 'vault.view', 'numi.use', 'tax.configure', 'approval.configure', 'field.configure',
]
export const OPS_PERMS = [
  'register.view', 'register.manage', 'document.view', 'document.upload', 'asset.view', 'asset.manage',
  'purchase.view', 'purchase.create', 'purchase.approve', 'expense.view', 'expense.create', 'expense.approve',
  'treasury.view', 'treasury.manage',
]
export const PAYROLL_PERMS = ['payroll.view', 'payroll.manage', 'payroll.approve']
export const ALL_PERMS = [...BASE_PERMS, ...OPS_PERMS, ...PAYROLL_PERMS, ...P3_PERMS]

/** Ledger roles the operational engines need. Configured per company under Chart of Accounts → Account mapping. */
export const ACCOUNT_MAP_KEYS: { key: string; label: string; usedBy: string }[] = [
  { key: 'ar_control', label: 'Accounts receivable (control)', usedBy: 'Sales invoices, receipts' },
  { key: 'ap_control', label: 'Accounts payable (control)', usedBy: 'Purchase bills, payments' },
  { key: 'customer_advances', label: 'Advances received from customers', usedBy: 'Receipts not yet matched to an invoice' },
  { key: 'vendor_advances', label: 'Advances paid to vendors', usedBy: 'Payments not yet matched to a bill' },
  { key: 'fx_gain_loss', label: 'Exchange difference', usedBy: 'Settlement in a foreign currency' },
  { key: 'retained_earnings', label: 'Retained earnings', usedBy: 'Balance sheet' },
  { key: 'suspense', label: 'Suspense — needs classification', usedBy: 'Unclassified items' },
  { key: 'intercompany_receivable', label: 'Due from group companies', usedBy: 'Intercompany transfers' },
  { key: 'intercompany_payable', label: 'Due to group companies', usedBy: 'Intercompany transfers' },
  { key: 'employee_advances', label: 'Advances held by employees', usedBy: 'Advances, settlements, payroll recovery' },
  { key: 'employee_payable', label: 'Reimbursements payable to employees', usedBy: 'Expense claims' },
  { key: 'salaries_payable', label: 'Net salaries payable', usedBy: 'Payroll' },
  { key: 'salary_expense', label: 'Salaries and wages', usedBy: 'Payroll' },
  { key: 'bonus_expense', label: 'Bonus and incentives', usedBy: 'Payroll' },
  { key: 'employer_contribution_expense', label: 'Employer contributions', usedBy: 'Payroll' },
  { key: 'statutory_payable', label: 'Statutory dues payable', usedBy: 'Payroll' },
  { key: 'tds_payable', label: 'Tax deducted — payable', usedBy: 'Payroll' },
  { key: 'tds_receivable', label: 'Tax deducted — receivable', usedBy: 'Fixed deposit interest' },
  { key: 'asset_disposal', label: 'Gain or loss on disposal of assets', usedBy: 'Asset disposal' },
  { key: 'asset_impairment', label: 'Impairment loss', usedBy: 'Asset impairment' },
  ...P3_ACCOUNT_MAP_KEYS,
]

// ------------------------------------------------------------------ workflow postings
export interface WorkflowPosting {
  id: ID
  company_id: ID
  journal_id: ID
  source: string
  source_id: ID
  payload: Record<string, unknown>
  status: 'pending' | 'posted' | 'voided' | 'reversed'
  created_by: ID | null
  created_at: string
  completed_at?: string | null
}

// ------------------------------------------------------------------ registers
export type Certainty = 'contracted' | 'committed' | 'scheduled' | 'expected' | 'probable' | 'possible' | 'contingent' | 'forecast'
export type Frequency = 'once' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
export type RegisterCategory = 'obligation' | 'income' | 'pipeline' | 'exposure' | 'asset' | 'incident' | 'path' | 'other'

export interface RegisterField {
  key: string
  label: string
  type: 'text' | 'number' | 'money' | 'date' | 'select' | 'boolean'
  options?: string[]
  required?: boolean
  /** a date field that is watched for approaching expiry */
  alert?: boolean
}
export interface RegisterKind {
  id?: ID
  group_id?: ID | null
  key: string
  name: string
  category: RegisterCategory
  direction: 'out' | 'in' | 'none'
  default_certainty: Certainty
  dimension_type: string | null
  prefix: string
  fields: RegisterField[]
  sort: number
  is_active: boolean
}
export interface RegisterItem {
  id: ID
  company_id: ID
  kind: string
  ref_no: string
  title: string
  party_id: ID | null
  org_unit_id: ID | null
  account_id: ID | null
  direction: 'out' | 'in' | 'none'
  amount: Num
  currency: string
  frequency: Frequency
  start_date: string | null
  end_date: string | null
  next_due: string | null
  total_value: Num | null
  certainty: Certainty
  state: string
  auto_renew: boolean
  renewal_date: string | null
  cancel_by: string | null
  escalation_pct: Num | null
  escalation_date: string | null
  escalation_months: number | null
  probability: Num | null
  owner_user: ID | null
  owner_name: string | null
  confidentiality: Confidentiality
  notes: string | null
  data: Record<string, unknown>
  status: 'draft' | 'active' | 'paused' | 'ended' | 'cancelled' | 'closed'
  created_by: ID | null
  created_at: string
  updated_at: string
}
export type RegisterItemInput = Partial<Omit<RegisterItem, 'ref_no' | 'created_by' | 'created_at' | 'updated_at'>> & {
  company_id: ID
  kind: string
  title: string
  /** create a cost-tracking dimension for kinds that have one (default true) */
  create_dimension?: boolean
  reason?: string
}

export interface Task {
  id: ID
  company_id: ID
  entity: string | null
  entity_id: ID | null
  title: string
  detail: string | null
  due_date: string | null
  owner_user: ID | null
  owner_name: string | null
  priority: 'low' | 'normal' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  outcome: string | null
  /** taken from the record the follow-up is linked to, when it is created */
  confidentiality?: Confidentiality
  created_by: ID | null
  created_at: string
  completed_at?: string | null
}
export type TaskInput = Partial<Omit<Task, 'created_by' | 'created_at' | 'completed_at'>> & { company_id: ID; title: string }

// ------------------------------------------------------------------ documents
export interface DocumentRecord {
  id: ID
  company_id: ID
  name: string
  mime: string | null
  size_bytes: number
  sha256: string
  storage_path: string
  doc_kind: string
  status: 'received' | 'classified' | 'linked' | 'processed' | 'rejected'
  party_id: ID | null
  doc_date: string | null
  amount: Num | null
  currency: string | null
  reference: string | null
  expires_on: string | null
  duplicate_of: ID | null
  confidentiality: Confidentiality
  notes: string | null
  origin: string
  uploaded_by: ID | null
  uploaded_at: string
  links?: DocumentLink[]
}
export interface DocumentLink { document_id: ID; entity: string; entity_id: ID; company_id: ID; linked_at: string }
export interface DocumentMeta {
  doc_kind?: string
  party_id?: ID | null
  doc_date?: string | null
  amount?: Num | null
  currency?: string | null
  reference?: string | null
  expires_on?: string | null
  notes?: string | null
  confidentiality?: Confidentiality
  status?: DocumentRecord['status']
}
export interface UploadResult { id: ID; possible_duplicates: { id: ID; name: string; uploaded_at: string; reason: string }[] }

export const DOCUMENT_KINDS: { key: string; name: string }[] = [
  ['unclassified', 'Not yet classified'], ['invoice', 'Sales invoice'], ['bill', 'Purchase bill'], ['receipt', 'Receipt'],
  ['credit_note', 'Credit note'], ['debit_note', 'Debit note'], ['purchase_order', 'Purchase order'], ['quotation', 'Quotation'],
  ['delivery_note', 'Delivery note / GRN'], ['contract', 'Contract / agreement'], ['bank_statement', 'Bank statement'],
  ['card_statement', 'Card statement'], ['payment_advice', 'Payment advice'], ['expense_receipt', 'Expense receipt'],
  ['travel_ticket', 'Ticket / boarding pass'], ['salary_record', 'Payroll record'], ['tax_document', 'Tax document'],
  ['insurance_policy', 'Insurance policy'], ['licence', 'Licence / registration'], ['loan_document', 'Loan document'],
  ['board_resolution', 'Approval / resolution'], ['email', 'Email evidence'], ['photo', 'Photograph'], ['other', 'Other'],
].map(([key, name]) => ({ key, name }))

// ------------------------------------------------------------------ custom fields
export type CustomValues = Record<string, unknown>

// ------------------------------------------------------------------ fixed assets
export interface AssetCategory {
  id: ID
  company_id: ID
  name: string
  asset_account_id: ID
  accum_account_id: ID
  expense_account_id: ID
  method: 'slm' | 'wdv' | 'none'
  life_months: number | null
  wdv_rate: Num | null
  salvage_pct: Num
  is_active: boolean
}
export type AssetCategoryInput = Omit<AssetCategory, 'id' | 'is_active' | 'salvage_pct'> & { id?: ID; salvage_pct?: Num; is_active?: boolean }

export interface FixedAsset {
  id: ID
  company_id: ID
  asset_no: string
  name: string
  category_id: ID
  description: string | null
  acquisition_date: string
  in_service_date: string | null
  cost: Num
  salvage_value: Num
  method: 'slm' | 'wdv' | 'none'
  life_months: number | null
  wdv_rate: Num | null
  opening_accumulated: Num
  accumulated_depreciation: Num
  impairment: Num
  org_unit_id: ID | null
  custodian_party_id: ID | null
  location: string | null
  serial_no: string | null
  tag_code: string | null
  vendor_party_id: ID | null
  source_invoice_id: ID | null
  warranty_until: string | null
  status: 'active' | 'disposed' | 'written_off'
  disposed_on: string | null
  disposal_proceeds: Num | null
  disposal_journal_id: ID | null
  confidentiality: Confidentiality
  notes: string | null
  created_by: ID | null
  created_at: string
}
export interface FixedAssetInput {
  id?: ID
  company_id: ID
  name: string
  category_id: ID
  description?: string | null
  acquisition_date: string
  in_service_date?: string | null
  cost: Num
  salvage_value?: Num
  method?: 'slm' | 'wdv' | 'none'
  life_months?: number | null
  wdv_rate?: Num | null
  opening_accumulated?: Num
  org_unit_id?: ID | null
  custodian_party_id?: ID | null
  location?: string | null
  serial_no?: string | null
  tag_code?: string | null
  vendor_party_id?: ID | null
  source_invoice_id?: ID | null
  warranty_until?: string | null
  confidentiality?: Confidentiality
  notes?: string | null
}
export interface DepreciationRun {
  id: ID
  company_id: ID
  period_month: string
  status: 'draft' | 'proposed' | 'posted' | 'reversed' | 'cancelled'
  total: Num
  asset_count: number
  journal_id: ID | null
  created_by: ID | null
  created_at: string
}
export interface DepreciationLine { id: ID; run_id: ID; company_id: ID; asset_id: ID; amount: Num; opening_book_value: Num; method: string; basis: string }
export interface AssetEvent {
  id: ID
  asset_id: ID
  company_id: ID
  event_type: 'assignment' | 'transfer' | 'maintenance' | 'verification' | 'impairment' | 'disposal' | 'note'
  event_date: string
  amount: Num | null
  status: 'recorded' | 'proposed' | 'posted' | 'rejected' | 'reversed'
  detail: Record<string, unknown>
  journal_id: ID | null
  created_by: ID | null
  created_at: string
}
export interface AssetEventInput {
  asset_id: ID
  event_type: 'assignment' | 'transfer' | 'maintenance' | 'verification' | 'note'
  event_date: string
  amount?: Num | null
  detail?: Record<string, unknown>
}
export interface AssetDisposalInput { asset_id: ID; date: string; kind: 'sale' | 'scrap' | 'write_off'; proceeds?: Num; bank_ledger_id?: ID | null; party_id?: ID | null; reason: string }
export interface AssetImpairmentInput { asset_id: ID; date: string; amount: Num; reason: string; assessed_by?: string }

// ------------------------------------------------------------------ purchase-to-pay
export type PurchaseKind = 'requisition' | 'rfq' | 'quotation' | 'purchase_order' | 'goods_receipt' | 'service_receipt'
export type PurchaseStatus =
  | 'draft' | 'submitted' | 'approved' | 'rejected' | 'sent' | 'received' | 'selected' | 'not_selected' | 'expired'
  | 'ordered' | 'partially_received' | 'fully_received' | 'billed' | 'confirmed' | 'closed' | 'cancelled'
export interface PurchaseLine {
  id: ID
  doc_id: ID
  company_id: ID
  line_no: number
  description: string
  account_id: ID | null
  quantity: Num
  unit: string | null
  rate: Num
  amount: Num
  tax_code_id: ID | null
  tax_amount: Num
  source_line_id: ID | null
  condition: string | null
  dims: Record<string, ID>
}
export interface PurchaseLineInput {
  description: string
  account_id?: ID | null
  quantity?: Num
  unit?: string | null
  rate?: Num
  tax_code_id?: ID | null
  source_line_id?: ID | null
  condition?: string | null
  dims?: Record<string, ID>
}
export interface PurchaseDoc {
  id: ID
  company_id: ID
  kind: PurchaseKind
  doc_no: string
  doc_date: string
  party_id: ID | null
  parent_id: ID | null
  title: string | null
  status: PurchaseStatus
  currency: string
  fx_rate: Num
  subtotal: Num
  tax_total: Num
  total: Num
  required_date: string | null
  valid_until: string | null
  delivery_terms: string | null
  payment_terms: string | null
  warranty: string | null
  reason: string | null
  decision_note: string | null
  dims: Record<string, ID>
  meta: Record<string, unknown>
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
  lines?: PurchaseLine[]
}
export interface PurchaseDocInput {
  id?: ID
  company_id: ID
  kind: PurchaseKind
  doc_date: string
  party_id?: ID | null
  parent_id?: ID | null
  title?: string | null
  currency?: string
  fx_rate?: Num
  required_date?: string | null
  valid_until?: string | null
  delivery_terms?: string | null
  payment_terms?: string | null
  warranty?: string | null
  reason?: string | null
  dims?: Record<string, ID>
  meta?: Record<string, unknown>
  confidentiality?: Confidentiality
  lines: PurchaseLineInput[]
}

// ------------------------------------------------------------------ expenses, advances, cash
export interface ExpenseCategory {
  id: ID
  company_id: ID
  name: string
  account_id: ID
  limit_per_item: Num | null
  limit_per_day: Num | null
  receipt_required_above: Num | null
  max_age_days: number | null
  guidance: string | null
  is_active: boolean
}
export type ExpenseCategoryInput = Partial<Omit<ExpenseCategory, 'id'>> & { id?: ID; company_id: ID; name: string; account_id: ID; reason?: string }

export type AdvanceStatus =
  | 'draft' | 'requested' | 'approved' | 'rejected' | 'partially_released' | 'released' | 'partially_settled'
  | 'settled' | 'return_due' | 'returned' | 'disputed' | 'under_review' | 'cancelled'
export interface Advance {
  id: ID
  company_id: ID
  advance_no: string
  recipient_party_id: ID
  recipient_type: string
  purpose: string
  register_item_id: ID | null
  dims: Record<string, ID>
  currency: string
  requested_amount: Num
  approved_amount: Num
  released_amount: Num
  settled_amount: Num
  returned_amount: Num
  expected_settlement_date: string | null
  released_on: string | null
  payment_method: string | null
  settlement_closed: boolean
  review_flag: 'disputed' | 'under_review' | null
  status: AdvanceStatus
  last_follow_up: string | null
  notes: string | null
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
}
export interface AdvanceInput {
  id?: ID
  company_id: ID
  recipient_party_id: ID
  recipient_type?: string
  purpose: string
  register_item_id?: ID | null
  dims?: Record<string, ID>
  currency?: string
  requested_amount: Num
  expected_settlement_date?: string | null
  payment_method?: string | null
  notes?: string | null
  confidentiality?: Confidentiality
}
export interface MoneyMoveInput { amount: Num; bank_ledger_id: ID; date: string; reference?: string; method?: string }

export interface ExpenseClaimLine {
  id: ID
  claim_id: ID
  company_id: ID
  line_no: number
  expense_date: string
  category_id: ID | null
  account_id: ID
  description: string
  merchant: string | null
  amount: Num
  approved_amount: Num
  paid_by: 'claimant' | 'company'
  paid_from_ledger_id: ID | null
  has_receipt: boolean
  document_id: ID | null
  flags: string[]
  approver_note: string | null
  dims: Record<string, ID>
  /** what is known about a journey or a stay: operator, reference, route, class, and how the amount is made up */
  detail?: BookingDetail | Record<string, never>
}
export interface ExpenseClaimLineInput {
  expense_date: string
  category_id?: ID | null
  account_id?: ID | null
  description: string
  merchant?: string | null
  amount: Num
  paid_by?: 'claimant' | 'company'
  paid_from_ledger_id?: ID | null
  has_receipt?: boolean
  document_id?: ID | null
  dims?: Record<string, ID>
  detail?: BookingDetail
}
export interface ExpenseClaim {
  id: ID
  company_id: ID
  claim_no: string
  claimant_party_id: ID
  title: string
  purpose: string | null
  advance_id: ID | null
  final_settlement: boolean
  register_item_id: ID | null
  currency: string
  total: Num
  approved_total: Num
  advance_applied: Num
  payable: Num
  flagged_lines: number
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted' | 'paid' | 'cancelled'
  journal_id: ID | null
  payment_journal_id: ID | null
  paid_on: string | null
  notes: string | null
  decision_note: string | null
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
  lines?: ExpenseClaimLine[]
}
export interface ExpenseClaimInput {
  id?: ID
  company_id: ID
  claimant_party_id: ID
  title: string
  purpose?: string | null
  advance_id?: ID | null
  final_settlement?: boolean
  register_item_id?: ID | null
  currency?: string
  notes?: string | null
  confidentiality?: Confidentiality
  lines: ExpenseClaimLineInput[]
}
export interface ClaimLineDecision { line_id: ID; approved_amount: Num; note?: string }

export interface CashBox {
  id: ID
  company_id: ID
  name: string
  ledger_account_id: ID
  custodian_party_id: ID | null
  custodian_name: string | null
  org_unit_id: ID | null
  float_amount: Num
  min_balance: Num
  max_single_payment: Num | null
  is_active: boolean
}
export type CashBoxInput = Partial<Omit<CashBox, 'id'>> & { id?: ID; company_id: ID; name: string; ledger_account_id: ID }
export interface CashCount {
  id: ID
  box_id: ID
  company_id: ID
  count_date: string
  denominations: Record<string, number>
  counted_total: Num
  book_balance: Num
  difference: Num
  note: string | null
  witness_name: string | null
  counted_by: ID | null
  created_at: string
}
export interface CashCountInput { box_id: ID; count_date: string; denominations?: Record<string, number>; counted_total?: Num; note?: string; witness_name?: string }

export interface FundTransfer {
  id: ID
  company_id: ID
  transfer_no: string
  kind: string
  from_ledger_id: ID
  to_company_id: ID
  to_ledger_id: ID
  amount: Num
  transfer_date: string
  purpose: string
  reference: string | null
  status: 'proposed' | 'part_posted' | 'posted' | 'rejected' | 'reversed'
  journal_id: ID | null
  to_journal_id: ID | null
  created_by: ID | null
  created_at: string
}
export interface FundTransferInput { company_id: ID; to_company_id?: ID; from_ledger_id: ID; to_ledger_id: ID; amount: Num; transfer_date: string; purpose: string; reference?: string; kind?: string }

export interface CollectionPromise {
  id: ID
  company_id: ID
  party_id: ID
  invoice_id: ID | null
  promised_amount: Num
  promised_date: string
  contact_person: string | null
  channel: string | null
  notes: string | null
  status: 'open' | 'kept' | 'partly_kept' | 'broken' | 'cancelled'
  outcome_note: string | null
  created_by: ID | null
  created_at: string
}
export interface CollectionPromiseInput { id?: ID; company_id: ID; party_id?: ID; invoice_id?: ID | null; promised_amount?: Num; promised_date?: string; contact_person?: string; channel?: string; notes?: string; status?: CollectionPromise['status']; outcome_note?: string }

// ------------------------------------------------------------------ treasury
export interface Loan {
  id: ID
  company_id: ID
  loan_no: string
  name: string
  direction: 'borrowed' | 'lent'
  kind: string
  party_id: ID
  principal: Num
  currency: string
  rate_pct: Num
  rate_type: 'fixed' | 'floating'
  rate_reset_date: string | null
  start_date: string
  first_due_date: string
  tenure_months: number
  repayment: 'emi' | 'equal_principal' | 'bullet'
  loan_account_id: ID
  interest_account_id: ID
  disbursed_amount: Num
  principal_repaid: Num
  interest_paid: Num
  sanction_ref: string | null
  security: string | null
  covenants: string | null
  status: 'draft' | 'active' | 'closed' | 'cancelled'
  confidentiality: Confidentiality
  notes: string | null
  created_by: ID | null
  created_at: string
}
export type LoanInput = Pick<Loan, 'company_id' | 'name' | 'party_id' | 'principal' | 'start_date' | 'first_due_date' | 'tenure_months' | 'loan_account_id' | 'interest_account_id'>
  & Partial<Pick<Loan, 'direction' | 'kind' | 'currency' | 'rate_pct' | 'rate_type' | 'rate_reset_date' | 'repayment' | 'sanction_ref' | 'security' | 'covenants' | 'confidentiality' | 'notes'>> & { id?: ID }
export interface LoanInstalment {
  id: ID
  loan_id: ID
  company_id: ID
  instalment_no: number
  due_date: string
  opening_principal: Num
  principal: Num
  interest: Num
  total: Num
  closing_principal: Num
  /** principal of this instalment recovered through payroll; what remains is principal − recovered, plus interest */
  recovered: Num
  status: 'due' | 'proposed' | 'paid'
  journal_id: ID | null
  paid_on: string | null
}
export interface FixedDeposit {
  id: ID
  company_id: ID
  fd_no: string
  bank_party_id: ID | null
  bank_name: string
  reference: string | null
  principal: Num
  currency: string
  rate_pct: Num
  compounding: 'simple' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
  start_date: string
  maturity_date: string
  maturity_amount: Num
  fd_account_id: ID
  interest_account_id: ID
  lien_marked: boolean
  lien_note: string | null
  auto_renew: boolean
  status: 'draft' | 'active' | 'closed' | 'cancelled'
  placement_journal_id: ID | null
  closure_journal_id: ID | null
  closed_on: string | null
  proceeds: Num | null
  tax_deducted: Num | null
  confidentiality: Confidentiality
  notes: string | null
  created_by: ID | null
  created_at: string
}
export type FixedDepositInput = Pick<FixedDeposit, 'company_id' | 'bank_name' | 'principal' | 'start_date' | 'maturity_date' | 'fd_account_id' | 'interest_account_id'>
  & Partial<Pick<FixedDeposit, 'bank_party_id' | 'reference' | 'currency' | 'rate_pct' | 'compounding' | 'maturity_amount' | 'lien_marked' | 'lien_note' | 'auto_renew' | 'confidentiality' | 'notes'>> & { id?: ID }

// ------------------------------------------------------------------ payroll
export type EmploymentType = 'permanent' | 'contract' | 'consultant' | 'freelancer' | 'agency' | 'temporary' | 'intern' | 'advisor'
export interface Employee {
  id: ID
  company_id: ID
  party_id: ID
  emp_no: string
  designation: string | null
  department_id: ID | null
  office_id: ID | null
  employment_type: EmploymentType
  join_date: string
  exit_date: string | null
  status: 'planned' | 'active' | 'notice' | 'exited'
  payment_method: string | null
  confidentiality: Confidentiality
  notes: string | null
  created_by: ID | null
  created_at: string
}
export type EmployeeInput = Pick<Employee, 'company_id' | 'party_id' | 'join_date'>
  & Partial<Pick<Employee, 'emp_no' | 'designation' | 'department_id' | 'office_id' | 'employment_type' | 'exit_date' | 'status' | 'payment_method' | 'confidentiality' | 'notes'>> & { id?: ID }

export type ComponentKind = 'earning' | 'deduction' | 'employer'
export interface SalaryComponent {
  key?: string
  name: string
  kind: ComponentKind
  /** earning: fixed | bonus | incentive | commission | overtime | arrears · deduction: tax | statutory | advance_recovery | loan_recovery | other · employer: statutory | benefit */
  type?: string
  amount: Num
  account_id?: ID | null
  source?: 'structure' | 'adjustment'
  advance_id?: ID | null
  loan_id?: ID | null
  note?: string | null
}
export interface SalaryStructure {
  id: ID
  employee_id: ID
  company_id: ID
  effective_from: string
  components: SalaryComponent[]
  monthly_gross: Num
  monthly_deductions: Num
  monthly_employer: Num
  monthly_net: Num
  annual_ctc: Num
  reason: string
  status: 'draft' | 'approved' | 'rejected'
  decision_note: string | null
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
}
export interface SalaryStructureInput { id?: ID; employee_id: ID; effective_from: string; reason: string; components: SalaryComponent[] }
export interface PayrollAdjustment { employee_id: ID; name: string; kind: ComponentKind; type?: string; amount: Num; advance_id?: ID; loan_id?: ID; note?: string }
export interface PayrollRunInput { company_id: ID; month: string; run_type?: 'regular' | 'supplementary' | 'full_and_final'; notes?: string; adjustments?: PayrollAdjustment[]; unpaid_days?: Record<ID, number> }
export interface PayrollException { employee_id: ID; emp_no: string; name: string; reason: string }
export interface PayrollRun {
  id: ID
  company_id: ID
  run_no: string
  period_month: string
  run_type: 'regular' | 'supplementary' | 'full_and_final'
  status: 'draft' | 'proposed' | 'posted' | 'paid' | 'reversed' | 'cancelled'
  headcount: number
  gross: Num
  deductions: Num
  employer_cost: Num
  net: Num
  exceptions: PayrollException[]
  journal_id: ID | null
  payment_journal_id: ID | null
  paid_on: string | null
  notes: string | null
  created_by: ID | null
  created_at: string
}
export interface PayrollLine {
  id: ID
  run_id: ID
  company_id: ID
  employee_id: ID
  party_id: ID
  department_id: ID | null
  structure_id: ID | null
  days_in_month: number
  days_paid: Num
  gross: Num
  deductions: Num
  employer_cost: Num
  net: Num
  components: SalaryComponent[]
}
