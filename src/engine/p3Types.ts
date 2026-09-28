// Phase 3 domain model: inventory, investments and funds, reality and control,
// simulations, the scenario studio, and the platform around them.
//
// The rules of Phase 2 hold unchanged: nothing here writes to the ledger on its own.
// Whatever has an accounting effect PROPOSES a journal. A simulation is never accounting.

import type { Confidentiality, ID, Num } from './types'

// ------------------------------------------------------------------ permissions
export const P3_PERMS = [
  'inventory.view', 'inventory.manage', 'inventory.count', 'inventory.approve',
  'investment.view', 'investment.manage', 'investment.approve',
  'reality.view', 'reality.manage',
  'scenario.view', 'scenario.manage',
  'flow.view', 'flow.manage', 'flow.configure',
  'allocation.manage', 'import.manage',
  'system.health', 'integration.manage', 'communication.send',
]

/** Ledger roles the Phase 3 engines need. Configured under Chart of Accounts → Account mapping. */
export const P3_ACCOUNT_MAP_KEYS: { key: string; label: string; usedBy: string }[] = [
  { key: 'grni', label: 'Goods received, not yet invoiced', usedBy: 'Stock receipts, returns to vendors' },
  { key: 'landed_cost_clearing', label: 'Landed cost — clearing', usedBy: 'Freight, customs and other charges added to stock' },
  { key: 'stock_loss', label: 'Stock lost or written down', usedBy: 'Stock adjustments, stock counts' },
  { key: 'stock_gain', label: 'Stock found', usedBy: 'Stock adjustments, stock counts' },
  { key: 'investment_gain_loss', label: 'Gain or loss on investments', usedBy: 'Sale and write-down of investments' },
  { key: 'unrealised_gain_loss', label: 'Changes in fair value', usedBy: 'Investments carried at fair value' },
  { key: 'investment_income', label: 'Income from investments', usedBy: 'Dividends, interest and distributions received' },
  { key: 'distribution_payable', label: 'Dividends and distributions payable', usedBy: 'Dividends, fund distributions' },
  { key: 'management_fee_expense', label: 'Management fees', usedBy: 'Fund management fee' },
  { key: 'management_fee_payable', label: 'Management fees owed to the manager', usedBy: 'Fund management fee, until the bill of the manager arrives' },
]

// ================================================================== INVENTORY
export type Valuation = 'weighted_average' | 'fifo'
export type Tracking = 'none' | 'lot' | 'serial'

export interface InvCategory {
  id: ID
  company_id: ID
  name: string
  inventory_account_id: ID
  cogs_account_id: ID
  valuation_method: Valuation
  is_active: boolean
}
export type InvCategoryInput = Omit<InvCategory, 'id' | 'is_active' | 'valuation_method'> & { id?: ID; valuation_method?: Valuation; is_active?: boolean }

export type WarehouseKind = 'warehouse' | 'store' | 'site' | 'office' | 'transit' | 'service_van'
export interface Warehouse {
  id: ID
  company_id: ID
  code: string
  name: string
  kind: WarehouseKind
  org_unit_id: ID | null
  address: string | null
  keeper_party_id: ID | null
  is_active: boolean
}
export type WarehouseInput = Partial<Omit<Warehouse, 'id'>> & { id?: ID; company_id: ID; code: string; name: string }

export interface InvItem {
  id: ID
  company_id: ID
  sku: string
  name: string
  category_id: ID
  description: string | null
  unit: string
  tracking: Tracking
  valuation_method: Valuation
  tax_code_id: ID | null
  hsn_code: string | null
  reorder_level: Num | null
  reorder_qty: Num | null
  shelf_life_days: number | null
  slow_after_days: number | null
  manufacturer: string | null
  model: string | null
  sale_price: Num | null
  unit_weight: Num | null
  attrs: Record<string, unknown>
  qty_on_hand: Num
  value_on_hand: Num
  qty_reserved: Num
  value_reserved: Num
  status: 'active' | 'inactive'
  created_at: string
}
export type InvItemInput = Partial<Omit<InvItem, 'id' | 'qty_on_hand' | 'value_on_hand' | 'qty_reserved' | 'value_reserved' | 'created_at'>> & {
  id?: ID; company_id: ID; sku: string; name: string; category_id: ID; reason?: string
}

export interface InvLot {
  id: ID
  company_id: ID
  item_id: ID
  lot_no: string
  is_serial: boolean
  mfg_date: string | null
  expiry_date: string | null
  supplier_party_id: ID | null
  import_details: Record<string, unknown>
  landed_cost: Num | null
  sold_to_party_id: ID | null
  sale_invoice_id: ID | null
  sold_on: string | null
  installed_on: string | null
  customer_location: string | null
  warranty_until: string | null
  service_item_id: ID | null
  note: string | null
  created_at: string
}
export type InvLotInput = { id: ID } & Partial<Pick<InvLot, 'mfg_date' | 'expiry_date' | 'import_details' | 'sold_to_party_id' | 'sold_on' | 'installed_on' | 'customer_location' | 'warranty_until' | 'service_item_id' | 'note'>>

export type UnitEventType = 'installation' | 'engineer_visit' | 'spare_part' | 'warranty_claim' | 'service_contract' | 'relocation' | 'note'
export interface UnitEvent {
  id: ID
  company_id: ID
  lot_id: ID
  event_type: UnitEventType
  event_date: string
  party_id: ID | null
  engineer_name: string | null
  cost: Num | null
  chargeable: boolean | null
  invoice_id: ID | null
  detail: Record<string, unknown>
  created_by: ID | null
  created_at: string
}
export type UnitEventInput = Pick<UnitEvent, 'lot_id' | 'event_type' | 'event_date'> & Partial<Pick<UnitEvent, 'party_id' | 'engineer_name' | 'cost' | 'chargeable' | 'invoice_id' | 'detail'>>

export type StockDocKind = 'receipt' | 'issue' | 'transfer' | 'return_in' | 'return_out' | 'adjustment' | 'landed_cost'
export type StockDocStatus = 'draft' | 'proposed' | 'posted' | 'rejected' | 'reversed' | 'cancelled'
export type StockReason = 'damage' | 'expiry' | 'theft' | 'breakage' | 'obsolescence' | 'shrinkage' | 'count_difference' | 'found' | 'sample' | 'other'

export interface StockDocLine {
  id: ID
  doc_id: ID
  company_id: ID
  line_no: number
  item_id: ID
  lot_id: ID | null
  /** negative only on an adjustment (stock lost) */
  qty: Num
  unit_cost: Num
  /** cost of the line; for landed cost, the part that joined the stock */
  value: Num
  /** landed cost of units that had already left stock */
  expensed: Num
  weight: Num | null
  reason_code: StockReason | null
  source_line_id: ID | null
  receipt_line_id: ID | null
  hold_id: ID | null
  note: string | null
}
export interface StockDocLineInput {
  item_id: ID
  qty: Num
  lot_id?: ID | null
  lot_no?: string
  mfg_date?: string
  expiry_date?: string
  import_details?: Record<string, unknown>
  unit_cost?: Num
  weight?: Num
  reason_code?: StockReason
  source_line_id?: ID
  hold_id?: ID
  note?: string
}
export interface LandedCharge { name: string; amount: Num; account_id?: ID | null; party_id?: ID | null }
export interface StockDoc {
  id: ID
  company_id: ID
  kind: StockDocKind
  doc_no: string
  doc_date: string
  warehouse_id: ID
  to_warehouse_id: ID | null
  party_id: ID | null
  purchase_doc_id: ID | null
  invoice_id: ID | null
  receipt_doc_id: ID | null
  count_id: ID | null
  counter_account_id: ID | null
  reason: string | null
  dims: Record<string, ID>
  meta: { method?: 'value' | 'quantity' | 'weight'; charges?: LandedCharge[] } & Record<string, unknown>
  status: StockDocStatus
  total_value: Num
  journal_id: ID | null
  created_by: ID | null
  created_at: string
  lines?: StockDocLine[]
}
export interface StockDocInput {
  id?: ID
  company_id: ID
  kind: StockDocKind
  doc_date: string
  warehouse_id?: ID
  to_warehouse_id?: ID | null
  party_id?: ID | null
  purchase_doc_id?: ID | null
  invoice_id?: ID | null
  receipt_doc_id?: ID | null
  counter_account_id?: ID | null
  reason?: string
  dims?: Record<string, ID>
  meta?: StockDoc['meta']
  lines?: (StockDocLineInput & { receipt_line_id?: ID })[]
}

export interface InvMovement {
  id: ID
  company_id: ID
  item_id: ID
  warehouse_id: ID
  lot_id: ID | null
  doc_id: ID
  doc_line_id: ID | null
  kind: string
  move_date: string
  qty: Num
  value: Num
  unit_cost: Num
  is_layer: boolean
  remaining_qty: Num
  remaining_value: Num
  status: 'proposed' | 'posted' | 'rejected' | 'reversed'
  created_at: string
}
/** quantity in one place, from the stock ledger */
export interface StockRow {
  company_id: ID
  item_id: ID
  warehouse_id: ID
  lot_id: ID | null
  qty: Num
  pending_out: Num
  pending_in: Num
  last_in: string | null
  last_out: string | null
}

export type StockCountStatus = 'open' | 'counted' | 'reviewed' | 'proposed' | 'posted' | 'closed' | 'cancelled'
export interface StockCountLine {
  id: ID
  count_id: ID
  company_id: ID
  item_id: ID
  lot_id: ID | null
  book_qty: Num
  unit_cost: Num
  counted_qty: Num | null
  reason_code: StockReason | null
  note: string | null
  added_in_count: boolean
}
export interface StockCount {
  id: ID
  company_id: ID
  warehouse_id: ID
  count_no: string
  count_date: string
  status: StockCountStatus
  frozen: boolean
  snapshot_at: string
  scope: Record<string, unknown>
  counted_by: ID | null
  counted_at: string | null
  reviewed_by: ID | null
  reviewed_at: string | null
  review_note: string | null
  doc_id: ID | null
  note: string | null
  created_by: ID | null
  created_at: string
  lines?: StockCountLine[]
}
export interface StockCountEntry { id?: ID; item_id?: ID; lot_id?: ID | null; lot_no?: string; expiry_date?: string; counted_qty: Num | null; reason_code?: StockReason | null; note?: string; unit_cost?: Num }

export type HoldCondition = 'damaged' | 'expired' | 'obsolete' | 'quarantine' | 'missing'
export interface InvHold {
  id: ID
  company_id: ID
  item_id: ID
  warehouse_id: ID
  lot_id: ID | null
  qty: Num
  condition: HoldCondition
  noted_on: string
  note: string | null
  status: 'open' | 'released' | 'written_off'
  resolved_doc_id: ID | null
  resolved_at: string | null
  resolved_note: string | null
  created_at: string
}
export interface InvHoldInput { company_id: ID; item_id: ID; warehouse_id: ID; lot_id?: ID | null; qty: Num; condition: HoldCondition; noted_on?: string; note?: string }

// ================================================================== INVESTMENTS
export type CorporateRelation = 'subsidiary' | 'associate' | 'joint_venture' | 'spv' | 'investment_entity' | 'operating_company' | 'holding_company' | 'branch'
export interface CorporateLink {
  id: ID
  group_id: ID
  parent_company_id: ID | null
  parent_party_id: ID | null
  child_company_id: ID | null
  child_party_id: ID | null
  relation: CorporateRelation
  ownership_pct: Num | null
  voting_pct: Num | null
  effective_from: string | null
  effective_to: string | null
  note: string | null
  created_at: string
}
export type CorporateLinkInput = Partial<Omit<CorporateLink, 'id' | 'group_id' | 'created_at'>> & { id?: ID; relation: CorporateRelation; reason?: string }

export interface EquityHolder {
  id: ID
  company_id: ID
  holder_party_id: ID
  share_class: string
  quantity: Num
  paid_up: Num
  note: string | null
  updated_at: string
}
export interface EquityHolderInput { company_id: ID; holder_party_id: ID; share_class?: string; quantity: Num; paid_up?: Num; note?: string; reason?: string }

export type Instrument = 'equity' | 'preference' | 'debt' | 'units' | 'convertible' | 'partnership' | 'property' | 'other'
export interface Holding {
  id: ID
  company_id: ID
  holding_no: string
  name: string
  investee_party_id: ID | null
  investee_company_id: ID | null
  instrument: Instrument
  measurement: 'cost' | 'fair_value'
  investment_account_id: ID
  income_account_id: ID | null
  gain_account_id: ID | null
  fv_account_id: ID | null
  org_unit_id: ID | null
  fund_id: ID | null
  currency: string
  quantity: Num
  cost: Num
  fv_adjustment: Num
  fair_value: Num | null
  fair_value_date: string | null
  realised_gain: Num
  income_received: Num
  acquired_on: string | null
  exited_on: string | null
  status: 'active' | 'exited' | 'written_off'
  confidentiality: Confidentiality
  notes: string | null
  created_at: string
}
export type HoldingInput = Partial<Pick<Holding, 'investee_party_id' | 'investee_company_id' | 'instrument' | 'measurement' | 'income_account_id' | 'gain_account_id' | 'fv_account_id' | 'org_unit_id' | 'fund_id' | 'currency' | 'confidentiality' | 'notes'>> & {
  id?: ID; company_id: ID; name: string; investment_account_id: ID; reason?: string
}
export type HoldingTxnKind = 'purchase' | 'sale' | 'income' | 'valuation' | 'write_down'
export interface HoldingTxn {
  id: ID
  holding_id: ID
  company_id: ID
  kind: HoldingTxnKind
  txn_date: string
  quantity: Num | null
  amount: Num
  cost_released: Num | null
  gain: Num | null
  fair_value: Num | null
  status: 'recorded' | 'approved' | 'proposed' | 'posted' | 'rejected' | 'reversed'
  journal_id: ID | null
  detail: Record<string, unknown>
  decided_by: ID | null
  decided_at: string | null
  created_by: ID | null
  created_at: string
}
export interface HoldingTxnInput {
  holding_id: ID
  kind: 'purchase' | 'sale' | 'income' | 'write_down'
  date: string
  amount: Num
  quantity?: Num
  bank_ledger_id?: ID
  tax_deducted?: Num
  income_kind?: 'dividend' | 'interest' | 'distribution'
  reference?: string
  reason?: string
  counterparty?: string
}
export interface HoldingValuationInput { holding_id: ID; date: string; fair_value: Num; method: string; valuer: string; basis: string; document_id?: ID }

export interface Fund {
  id: ID
  company_id: ID
  name: string
  scheme: string | null
  structure: 'aif_cat1' | 'aif_cat2' | 'aif_cat3' | 'trust' | 'llp' | 'company' | 'other'
  manager_party_id: ID | null
  currency: string
  unit_face_value: Num
  fee_pct: Num | null
  fee_basis: 'committed' | 'contributed' | 'nav'
  capital_account_id: ID
  commitment_period_end: string | null
  term_end: string | null
  status: 'forming' | 'open' | 'closed' | 'winding_up' | 'wound_up'
  units_outstanding: Num
  confidentiality: Confidentiality
  notes: string | null
  created_at: string
}
export type FundInput = Partial<Omit<Fund, 'id' | 'units_outstanding' | 'created_at'>> & { id?: ID; company_id: ID; name: string; capital_account_id: ID; reason?: string }
export interface FundCommitment {
  id: ID
  fund_id: ID
  company_id: ID
  investor_party_id: ID
  unit_class: string
  committed_amount: Num
  commitment_date: string
  status: 'active' | 'transferred' | 'withdrawn'
  called_amount: Num
  contributed_amount: Num
  units: Num
  distributed_amount: Num
  note: string | null
}
export interface CommitmentInput { id?: ID; fund_id: ID; investor_party_id: ID; unit_class?: string; committed_amount: Num; commitment_date?: string; status?: FundCommitment['status']; note?: string; reason?: string }
export interface CapitalCallLine {
  id: ID
  call_id: ID
  company_id: ID
  commitment_id: ID
  investor_party_id: ID
  amount: Num
  received_amount: Num
  units_allotted: Num
  status: 'due' | 'part_received' | 'received'
}
export interface CapitalCall {
  id: ID
  fund_id: ID
  company_id: ID
  call_no: string
  call_date: string
  due_date: string
  pct: Num | null
  total_amount: Num
  unit_price: Num
  purpose: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'closed' | 'cancelled'
  decision_note: string | null
  created_by: ID | null
  created_at: string
  approved_by?: ID | null
  approved_at?: string | null
  lines?: CapitalCallLine[]
}
export interface CapitalCallInput { id?: ID; fund_id: ID; call_date: string; due_date: string; pct: Num; unit_price?: Num; purpose: string }
export interface CapitalReceiptInput { line_id: ID; amount: Num; bank_ledger_id: ID; date: string; reference?: string }
export interface UnitAllotment {
  id: ID
  fund_id: ID
  company_id: ID
  commitment_id: ID
  call_line_id: ID | null
  allot_date: string
  amount: Num
  unit_price: Num
  units: Num
  journal_id: ID | null
  status: 'proposed' | 'posted' | 'rejected' | 'reversed'
}
export interface DistributionLine {
  id: ID
  distribution_id: ID
  company_id: ID
  holder_party_id: ID
  commitment_id: ID | null
  units: Num
  gross_amount: Num
  tax_deducted: Num
  net_amount: Num
  status: 'entitled' | 'payment_proposed' | 'paid'
  paid_on: string | null
  payment_journal_id: ID | null
}
export interface Distribution {
  id: ID
  company_id: ID
  fund_id: ID | null
  kind: 'dividend' | 'distribution' | 'return_of_capital'
  dist_no: string
  declaration_date: string
  record_date: string
  payment_date: string | null
  total_amount: Num
  tax_pct: Num
  source_account_id: ID
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'declared' | 'part_paid' | 'paid' | 'cancelled'
  journal_id: ID | null
  decision_note: string | null
  notes: string | null
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
  lines?: DistributionLine[]
}
export interface DistributionInput {
  id?: ID; company_id: ID; fund_id?: ID | null; kind: Distribution['kind']; declaration_date: string; record_date: string; payment_date?: string
  total_amount: Num; tax_pct?: Num; source_account_id: ID; notes?: string
}
export interface DistributionPaymentInput { distribution_id: ID; bank_ledger_id: ID; date: string; line_ids?: ID[]; reference?: string }
export interface NavRun {
  id: ID
  fund_id: ID
  company_id: ID
  nav_date: string
  total_assets: Num
  total_liabilities: Num
  net_assets: Num
  units: Num
  nav_per_unit: Num | null
  basis: Record<string, unknown>
  status: 'draft' | 'approved' | 'superseded' | 'rejected'
  note: string | null
  prepared_by: ID | null
  prepared_at: string
  approved_by: ID | null
  approved_at: string | null
}
export interface FundFee {
  id: ID
  fund_id: ID
  company_id: ID
  period_from: string
  period_to: string
  basis: string
  basis_amount: Num
  rate: Num
  amount: Num
  status: 'proposed' | 'posted' | 'rejected' | 'reversed'
  journal_id: ID | null
  created_at: string
}

// ================================================================== REALITY AND CONTROL
export interface Materiality { company_id: ID; amount: Num; pct: Num | null; note: string | null; set_by: ID | null; set_at: string }

export type CaseStatus = 'open' | 'triage' | 'under_review' | 'investigating' | 'substantiated' | 'unsubstantiated' | 'remediated' | 'closed'
export type AttentionClass = 'information' | 'finance_action' | 'management_action' | 'owner_action' | 'critical'
export type CaseKind = 'reality' | 'sentinel' | 'incident' | 'verification' | 'confirmation' | 'other'
export interface CaseLink { entity: string; entity_id: ID; label?: string }
export interface Case {
  id: ID
  company_id: ID
  case_no: string
  kind: CaseKind
  title: string
  summary: string | null
  status: CaseStatus
  attention: AttentionClass
  amount: Num | null
  owner_user: ID | null
  owner_name: string | null
  links: CaseLink[]
  finding: Record<string, unknown>
  dedupe_key: string | null
  alert_id: ID | null
  confidentiality: Confidentiality
  resolution: string | null
  opened_by: ID | null
  opened_at: string
  closed_by: ID | null
  closed_at: string | null
}
export interface CaseInput {
  company_id: ID; kind?: CaseKind; title: string; summary?: string; attention?: AttentionClass; amount?: Num; owner_user?: ID | null; owner_name?: string
  links?: CaseLink[]; finding?: Record<string, unknown>; dedupe_key?: string; alert_id?: ID; confidentiality?: Confidentiality
}
export interface CaseUpdate { id: ID; status?: CaseStatus; note?: string; resolution?: string; owner_user?: ID | null; owner_name?: string | null; attention?: AttentionClass; add_links?: CaseLink[] }
export interface CaseEvent {
  id: number | string
  case_id: ID
  company_id: ID
  event: 'opened' | 'status' | 'note' | 'link' | 'owner' | 'attention' | 'reopened'
  from_status: string | null
  to_status: string | null
  note: string | null
  detail: Record<string, unknown>
  actor: ID | null
  at: string
}

export type VerifySubject = 'assets' | 'inventory' | 'cash' | 'documents'
export type VerifyResult = 'not_checked' | 'located' | 'matched' | 'difference' | 'transferred' | 'damaged' | 'missing' | 'disposed'
export interface VerificationLine {
  id: ID
  run_id: ID
  company_id: ID
  entity: string
  entity_id: ID
  sub_id: ID | null
  label: string
  place: string | null
  book_qty: Num | null
  book_value: Num | null
  found_qty: Num | null
  found_value: Num | null
  result: VerifyResult
  note: string | null
}
export interface VerificationRun {
  id: ID
  company_id: ID
  verify_no: string
  subject: VerifySubject
  run_date: string
  scope: Record<string, unknown>
  status: 'open' | 'completed' | 'cancelled'
  performed_by_name: string | null
  witness_name: string | null
  note: string | null
  summary: Record<string, unknown>
  created_by: ID | null
  created_at: string
  completed_at: string | null
  lines?: VerificationLine[]
}
export interface VerificationInput { company_id: ID; subject: VerifySubject; run_date?: string; scope?: Record<string, unknown>; performed_by_name?: string; witness_name?: string; note?: string }
export interface VerificationEntry { id: ID; result?: VerifyResult; found_qty?: Num; found_value?: Num; note?: string }

export type ConfirmSubject = 'bank' | 'customer' | 'vendor' | 'loan' | 'deposit' | 'investment' | 'intercompany'
export type ConfirmStatus = 'drafted' | 'sent' | 'agreed' | 'difference' | 'explained' | 'disputed' | 'no_reply' | 'cancelled'
export interface Confirmation {
  id: ID
  company_id: ID
  confirm_no: string
  subject: ConfirmSubject
  party_id: ID | null
  counter_company_id: ID | null
  entity: string | null
  entity_id: ID | null
  label: string
  as_of: string
  currency: string
  book_balance: Num
  book_basis: string
  confirmed_balance: Num | null
  difference: Num | null
  status: ConfirmStatus
  contact: string | null
  sent_on: string | null
  sent_how: string | null
  received_on: string | null
  document_id: ID | null
  explanation: string | null
  confidentiality: Confidentiality
  created_by: ID | null
  created_at: string
}
export interface ConfirmationInput { company_id: ID; subject: ConfirmSubject; as_of: string; party_id?: ID; entity_id?: ID; counter_company_id?: ID; contact?: string; confidentiality?: Confidentiality }
export type ConfirmationAction =
  | { id: ID; action: 'sent'; sent_how: string; sent_on?: string; contact?: string }
  | { id: ID; action: 'reply'; confirmed_balance: Num; received_on?: string; document_id?: ID }
  | { id: ID; action: 'explained' | 'disputed'; explanation: string }
  | { id: ID; action: 'no_reply'; explanation?: string }
  | { id: ID; action: 'cancel'; explanation: string }

export interface Reclassification {
  id: ID
  company_id: ID
  journal_id: ID
  line_id: ID
  from_account_id: ID
  to_account_id: ID
  amount: Num
  side: 'debit' | 'credit'
  reclass_date: string
  reason: string
  status: 'proposed' | 'posted' | 'rejected' | 'reversed'
  new_journal_id: ID | null
  requested_by: ID | null
  requested_at: string
}
export interface ReclassificationInput { line_id: ID; to_account_id: ID; amount?: Num; date?: string; reason: string }

export type AllocationDriver = 'headcount' | 'revenue' | 'area' | 'usage' | 'equal' | 'manual'
export interface AllocationRecipient { org_unit_id: ID; name?: string; driver_value: Num; share_pct?: Num; amount?: Num }
export interface Allocation {
  id: ID
  company_id: ID
  alloc_no: string
  name: string
  period_from: string
  period_to: string
  source_account_id: ID
  source_org_unit_id: ID | null
  dimension_type: string
  pool_balance: Num
  amount: Num
  driver: AllocationDriver
  driver_note: string | null
  formula: string
  recipients: AllocationRecipient[]
  status: 'draft' | 'proposed' | 'posted' | 'rejected' | 'reversed' | 'cancelled'
  journal_id: ID | null
  created_by: ID | null
  created_at: string
}
export interface AllocationInput {
  id?: ID; company_id: ID; name: string; period_from: string; period_to: string; source_account_id: ID; source_org_unit_id?: ID | null
  dimension_type: string; amount: Num; driver: AllocationDriver; driver_note?: string; recipients: { org_unit_id: ID; driver_value?: Num }[]
}

// ================================================================== SIMULATIONS
export type ShockKind =
  | 'revenue_pct' | 'margin_pts' | 'expense_pct' | 'category_pct' | 'payroll_pct' | 'collection_delay_days' | 'payment_delay_days'
  | 'interest_rate_pts' | 'fx_pct' | 'capex' | 'new_borrowing' | 'new_hires' | 'lose_customer' | 'new_project' | 'project_overrun_pct' | 'one_off'
export interface Shock {
  kind: ShockKind
  /** the size of the change, in the unit the kind implies: percent, percentage points, days, or an amount */
  value: number
  /** month from now in which it begins (1 = next month) */
  from_month?: number
  /** a narrower target: an expense category, a customer, a project */
  target?: string
  target_id?: ID
  /** second figure where one is not enough: monthly cost per hire, months of a project, rate of a loan */
  extra?: number
  months?: number
  label?: string
  /** an approved driver this assumption rests on */
  driver_key?: string
}
export interface Scenario {
  id: ID
  group_id: ID
  company_id: ID | null
  name: string
  kind: 'base' | 'optimistic' | 'conservative' | 'custom'
  description: string | null
  horizon_months: number
  shocks: Shock[]
  status: 'saved' | 'archived'
  shared: boolean
  created_by: ID | null
  created_at: string
  updated_at: string
}
export type ScenarioInput = Partial<Pick<Scenario, 'kind' | 'description' | 'horizon_months' | 'shared' | 'status'>> & { id?: ID; company_id: ID | null; name: string; shocks: Shock[] }
export interface ScenarioRun {
  id: ID
  scenario_id: ID
  group_id: ID
  company_ids: ID[]
  as_of: string
  label: 'SIMULATION'
  base: Record<string, unknown>
  result: Record<string, unknown>
  note: string | null
  created_by: ID | null
  created_at: string
}
export interface TwinDriver {
  id: ID
  group_id: ID
  company_id: ID | null
  key: string
  name: string
  unit: 'amount' | 'percent' | 'days' | 'count' | 'rate'
  value: Num
  basis: string
  source: 'recorded' | 'assumed'
  status: 'proposed' | 'approved' | 'retired'
  created_by: ID | null
  created_at: string
  approved_by: ID | null
  approved_at: string | null
}
export interface TwinDriverInput { company_id: ID | null; key: string; name: string; unit?: TwinDriver['unit']; value: Num; basis: string; source?: TwinDriver['source'] }

// ================================================================== SCENARIO STUDIO
export const FLOW_ACTIONS = ['request', 'approval', 'fund_release', 'evidence', 'settlement', 'accounting', 'reconciliation', 'review', 'notice'] as const
export type FlowAction = typeof FLOW_ACTIONS[number]
export const FLOW_LINKS = ['advances', 'expense_claims', 'purchase_docs', 'register_items', 'journals', 'fund_transfers', 'invoices', 'payments', 'fixed_assets', 'loans', 'stock_docs', 'cases'] as const
export type FlowLink = typeof FLOW_LINKS[number]
export const FLOW_TRIGGERS = ['manual', 'form', 'voice', 'document_upload', 'email', 'api', 'schedule', 'event', 'bank_transaction', 'invoice', 'contract', 'numi_detection'] as const
export type FlowTrigger = typeof FLOW_TRIGGERS[number]
/** the ways a case can actually be started today; the others are recorded as intent and start nothing */
export const FLOW_TRIGGERS_WORKING: FlowTrigger[] = ['manual', 'form']

export interface FlowStepDef {
  key: string
  name: string
  action: FlowAction
  actor_role?: string
  links_to?: FlowLink
  required_documents?: string[]
  optional?: boolean
  guidance?: string
}
export interface FlowFieldDef { key: string; label: string; type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'boolean'; options?: string[]; required?: boolean }
export interface FlowDefinition {
  steps: FlowStepDef[]
  fields?: FlowFieldDef[]
  actors?: string[]
  money_flow?: string
  accounting?: string
  settlement?: string
  notifications?: string
  numi?: string
  sentinel?: string
  reports?: string
  register_kind?: string
}
export interface FlowDef {
  id: ID
  group_id: ID
  company_id: ID | null
  key: string
  version: number
  name: string
  description: string | null
  category: string
  trigger_kind: FlowTrigger
  definition: FlowDefinition
  status: 'draft' | 'active' | 'retired'
  cloned_from: ID | null
  created_by: ID | null
  created_at: string
  activated_at: string | null
}
export interface FlowDefInput { id?: ID; company_id: ID | null; key: string; name: string; description?: string; category?: string; trigger_kind?: FlowTrigger; definition: FlowDefinition }
export interface FlowCaseStep {
  id: ID
  case_id: ID
  company_id: ID
  step_no: number
  step_key: string
  name: string
  action: FlowAction
  actor_role: string
  links_to: FlowLink | null
  required_documents: string[]
  optional: boolean
  status: 'pending' | 'active' | 'done' | 'skipped'
  entity: string | null
  entity_id: ID | null
  note: string | null
  done_by: ID | null
  done_at: string | null
}
export interface FlowCase {
  id: ID
  company_id: ID
  flow_id: ID
  case_no: string
  title: string
  party_id: ID | null
  amount: Num | null
  register_item_id: ID | null
  data: Record<string, unknown>
  status: 'open' | 'completed' | 'cancelled'
  current_step: number
  confidentiality: Confidentiality
  started_by: ID | null
  started_at: string
  completed_at: string | null
  cancel_reason: string | null
  steps?: FlowCaseStep[]
}
export interface FlowCaseInput { flow_id: ID; company_id: ID; title: string; party_id?: ID | null; amount?: Num; register_item_id?: ID | null; data?: Record<string, unknown>; confidentiality?: Confidentiality }
export interface FlowStepInput { case_id: ID; note?: string; entity_id?: ID; skip?: boolean }

// ================================================================== PLATFORM
export interface Notification {
  id: ID
  group_id: ID
  company_id: ID | null
  user_id: ID
  kind: string
  class: AttentionClass
  title: string
  body: string | null
  entity: string | null
  entity_id: ID | null
  mandatory: boolean
  created_at: string
  read_at: string | null
}
export type Channel = 'in_app' | 'email' | 'push' | 'sms' | 'whatsapp'
export interface NotificationPref { user_id: ID; kind: string; channel: Channel; enabled: boolean }
/** the channels that deliver today. The others are recorded preferences; nothing is sent through them. */
export const CHANNELS_WORKING: Channel[] = ['in_app']
export interface AttentionRule { id: ID; group_id: ID; kind: string; min_amount: Num; class: AttentionClass; note: string | null }

export type TemplateKey = 'invoice' | 'payment_reminder' | 'statement' | 'receipt' | 'approval_request' | 'report' | 'confirmation' | 'capital_call' | 'other'
export interface MessageTemplate {
  id: ID
  group_id: ID
  company_id: ID | null
  key: TemplateKey
  name: string
  subject: string
  body: string
  is_active: boolean
  version: number
  created_at: string
}
export interface MessageTemplateInput { company_id: ID | null; key: TemplateKey; name: string; subject: string; body: string }
export interface Communication {
  id: ID
  company_id: ID
  channel: 'email' | 'letter' | 'whatsapp' | 'sms' | 'phone' | 'in_person' | 'portal'
  template_key: string | null
  party_id: ID | null
  to_address: string | null
  subject: string
  body: string
  entity: string | null
  entity_id: ID | null
  status: 'prepared' | 'sent_by_person' | 'not_sent'
  sent_on: string | null
  sent_note: string | null
  prepared_by: ID | null
  prepared_at: string
}
export interface CommunicationInput { company_id: ID; channel?: Communication['channel']; template_key?: string; party_id?: ID | null; to_address?: string; subject: string; body: string; entity?: string; entity_id?: ID }

export type IntegrationKind = 'bank' | 'payment_gateway' | 'crm' | 'hr' | 'payroll' | 'pos' | 'erp' | 'ecommerce' | 'logistics' | 'ghl_platform' | 'email' | 'sms' | 'whatsapp' | 'speech' | 'ocr' | 'ai_model' | 'tax_portal' | 'other'
export interface Integration {
  id: ID
  group_id: ID
  company_id: ID | null
  key: string
  name: string
  kind: IntegrationKind
  direction: 'inbound' | 'outbound' | 'both'
  moves_money: boolean
  risk: 'normal' | 'high'
  environment: 'sandbox' | 'production'
  status: 'planned' | 'configured' | 'testing' | 'active' | 'suspended' | 'retired'
  scopes: string[]
  auth_method: string | null
  /** where the secret is kept. Never the secret itself. */
  secret_location: string | null
  owner_name: string | null
  tested_in_sandbox_on: string | null
  last_checked_on: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type IntegrationInput = Partial<Omit<Integration, 'id' | 'group_id' | 'risk' | 'created_at' | 'updated_at'>> & { id?: ID; company_id: ID | null; key: string; name: string; reason?: string }

export interface FeatureFlag { id: ID; group_id: ID; module: string; company_id: ID | null; role_key: string | null; enabled: boolean; note: string | null; set_at: string }
export interface FeatureFlagInput { module: string; company_id?: ID | null; role_key?: string | null; enabled: boolean | null; note?: string }

export interface BackupCheck {
  id: ID
  group_id: ID
  kind: 'backup' | 'restore_test'
  performed_on: string
  outcome: 'succeeded' | 'failed' | 'partial'
  covers: 'database' | 'files' | 'database_and_files'
  evidence: string
  recovery_point: string | null
  recovery_minutes: number | null
  performed_by_name: string
  note: string | null
  recorded_at: string
}
export type BackupCheckInput = Pick<BackupCheck, 'kind' | 'performed_on' | 'outcome' | 'evidence' | 'performed_by_name'> & Partial<Pick<BackupCheck, 'covers' | 'recovery_point' | 'recovery_minutes' | 'note'>>

export type HealthState = 'ok' | 'attention' | 'failure' | 'not_recorded' | 'not_connected'
export interface HealthSection { state: HealthState; explanation?: string; [k: string]: unknown }
export type SystemHealth = Record<string, HealthSection>

export type ImportKind = 'journals' | 'opening_balances' | 'legacy_trial_balance'
export interface ImportRow { date?: string; ref?: string; account: string; name?: string; debit?: Num | string; credit?: Num | string; narration?: string }
export interface ImportCheck { passed: boolean; [k: string]: unknown }
export interface ImportBatch {
  id: ID
  company_id: ID
  kind: ImportKind
  file_name: string
  sha256: string
  period_end: string | null
  status: 'staged' | 'committed' | 'discarded'
  row_count: number
  rows: (ImportRow & { row: number; account_id: ID | null; error: string | null })[]
  mapping: Record<string, string>
  checks: { rows: number; total_debit: Num; total_credit: Num; validation: ImportCheck; duplicates: ImportCheck; balance: ImportCheck; mapping: ImportCheck }
  ok: boolean
  committed: Record<string, unknown>
  note: string | null
  created_by: ID | null
  created_at: string
  committed_at: string | null
}
export interface ImportInput { company_id: ID; kind: ImportKind; file_name: string; sha256: string; period_end?: string; rows: ImportRow[]; mapping?: Record<string, string>; note?: string }
export interface LegacyBalance { id: ID; company_id: ID; batch_id: ID; period_end: string; legacy_code: string; legacy_name: string | null; account_id: ID | null; debit: Num; credit: Num }

export interface FactRow { company_id: ID; month: string; account_id: ID; org_unit_id: ID | null; debit: Num; credit: Num; entries: number }
export interface FactRefresh { company_id: ID; refreshed_at: string; last_posted_at: string | null; rows: number; journals: number }

// ------------------------------------------------------------------ travel detail on a claim line
export type BookingKind = 'air' | 'train' | 'bus' | 'cab' | 'hotel'
export const BOOKING_PARTS = ['base_fare', 'taxes', 'booking_charges', 'baggage', 'seat', 'cancellation_fee', 'change_fee', 'tip', 'toll', 'parking', 'room_charges', 'meals', 'laundry', 'other_charges'] as const
export interface BookingDetail {
  kind: BookingKind
  operator?: string
  booking_ref?: string
  origin?: string
  destination?: string
  class?: string
  travel_date?: string
  city?: string
  check_in?: string
  check_out?: string
  agent?: string
  purpose?: string
  base_fare?: Num; taxes?: Num; booking_charges?: Num; baggage?: Num; seat?: Num; cancellation_fee?: Num; change_fee?: Num
  tip?: Num; toll?: Num; parking?: Num; room_charges?: Num; meals?: Num; laundry?: Num; other_charges?: Num
}
