import type { ID } from '@/engine/types'
import type { WorkflowPosting } from '@/engine/opsTypes'

// Where an accounting entry proposed by an operation came from, in words a person can read.
// An operation never writes to the ledger: it proposes a journal, and this describes the proposal.

export interface WorkflowSource { label: string; to: string | null; rule: string; onApproval: string }

const SOURCES: Record<string, { label: string; to: (id: ID, p: Record<string, unknown>) => string | null; rule: string; onApproval: string }> = {
  depreciation: { label: 'Depreciation run', to: () => '/assets?tab=depreciation', rule: 'DepreciationRun → debit depreciation expense, credit accumulated depreciation, by category', onApproval: 'the month is recorded as depreciated on every asset in the run' },
  asset_disposal: { label: 'Asset disposal', to: (id) => '/assets/' + id, rule: 'AssetDisposed → remove cost and accumulated depreciation, record proceeds, gain or loss to the disposal ledger', onApproval: 'the asset leaves the register' },
  asset_impairment: { label: 'Asset impairment', to: (id) => '/assets/' + id, rule: 'AssetImpaired → debit impairment loss, credit accumulated depreciation', onApproval: 'the book value of the asset is reduced' },
  advance_release: { label: 'Advance released', to: (id) => '/expenses/advances/' + id, rule: 'AdvanceReleased → debit advances held by the person, credit bank or cash. An advance is not an expense.', onApproval: 'the advance is recorded as released' },
  advance_return: { label: 'Advance returned', to: (id) => '/expenses/advances/' + id, rule: 'AdvanceReturned → debit bank or cash, credit advances held by the person', onApproval: 'the unsettled balance of the advance is reduced' },
  expense_claim: { label: 'Expense claim', to: (id) => '/expenses/claims/' + id, rule: 'ClaimApproved → debit each expense ledger, credit the advance settled and the reimbursement payable', onApproval: 'the expense is recognised and the advance is settled by the approved amount' },
  claim_payment: { label: 'Reimbursement', to: (id) => '/expenses/claims/' + id, rule: 'ClaimPaid → debit reimbursement payable, credit bank or cash', onApproval: 'the claim is recorded as settled' },
  fund_transfer: { label: 'Fund transfer', to: () => '/cash?tab=transfers', rule: 'FundsTransferred → debit the receiving ledger, credit the sending ledger. Not an expense.', onApproval: 'the transfer is recorded in the sending company' },
  fund_transfer_in: { label: 'Fund transfer (receiving company)', to: () => '/cash?tab=transfers', rule: 'FundsReceived → debit bank, credit due to the sending group company', onApproval: 'the transfer is recorded in the receiving company' },
  loan_disbursement: { label: 'Loan disbursement', to: (id) => '/treasury/loans/' + id, rule: 'LoanDisbursed → a loan taken: debit bank, credit the loan. A loan given: debit the loan, credit bank.', onApproval: 'the amount is recorded as disbursed' },
  loan_instalment: { label: 'Loan instalment', to: (_id, p) => (typeof p.loan_id === 'string' ? '/treasury/loans/' + p.loan_id : '/treasury?tab=loans'), rule: 'InstalmentPaid → principal reduces the loan, interest goes to the interest ledger', onApproval: 'the instalment is recorded as paid' },
  fd_placement: { label: 'Fixed deposit placed', to: (id) => '/treasury?tab=deposits&deposit=' + id, rule: 'DepositPlaced → debit the deposit, credit bank', onApproval: 'the deposit becomes active' },
  fd_closure: { label: 'Fixed deposit closed', to: (id) => '/treasury?tab=deposits&deposit=' + id, rule: 'DepositClosed → debit bank and tax deducted, credit the deposit and the interest actually received', onApproval: 'the deposit is closed' },
  payroll: { label: 'Payroll run', to: (id) => '/payroll/runs/' + id, rule: 'PayrollApproved → debit salary cost by department, credit deductions payable and net salaries payable. No individual salary appears in the ledger.', onApproval: 'salaries become payable and recoveries are applied' },
  // inventory, investments and control (phase 3)
  stock_doc: { label: 'Stock document', to: (id) => '/inventory/docs/' + id, rule: 'StockMoved → a receipt debits stock and credits goods received, not invoiced; an issue debits cost of sales and credits stock; an adjustment goes to stock lost or found; landed cost joins the stock it arrived with', onApproval: 'the quantities and their cost enter the stock ledger' },
  holding_txn: { label: 'Investment transaction', to: (_id, p) => (typeof p.holding_id === 'string' ? '/investments/holdings/' + p.holding_id : '/investments'), rule: 'InvestmentChanged → a purchase debits the investment; a sale releases its carrying amount and records the gain or loss; income is credited to investment income; a fair value change is unrealised', onApproval: 'the quantity, cost and fair value of the investment are updated' },
  capital_receipt: { label: 'Capital received from an investor', to: () => '/investments?tab=funds', rule: 'CapitalReceived → debit bank, credit the capital of the investors; units are allotted at the price of the call', onApproval: 'the units are allotted and the contribution of the investor rises' },
  distribution: { label: 'Dividend or distribution declared', to: (id) => '/investments/distributions/' + id, rule: 'DistributionDeclared → debit the equity ledger it is paid out of, credit what is payable to each holder. Declaring pays nothing.', onApproval: 'the amount becomes payable to the holders on record' },
  distribution_payment: { label: 'Dividend or distribution paid', to: (id) => '/investments/distributions/' + id, rule: 'DistributionPaid → debit what was payable to the holder, credit bank and the tax deducted at source', onApproval: 'the holders chosen are recorded as paid' },
  fund_fee: { label: 'Management fee of a fund', to: () => '/investments?tab=funds', rule: 'FeeAccrued → debit management fees, credit management fees owed to the manager. Formula: basis × rate × days ÷ 365', onApproval: 'the fee of the period is recorded as charged' },
  reclassification: { label: 'Reclassification', to: () => '/control?tab=reclassifications', rule: 'Reclassified → the amount leaves the ledger it was posted to and enters the ledger it belongs in. The original entry is not changed.', onApproval: 'the line is recorded as reclassified' },
  allocation: { label: 'Allocation of a shared cost', to: () => '/control?tab=allocations', rule: 'Allocated → credit the unit that holds the cost, debit each unit that shares it, in the same ledger, by the driver recorded', onApproval: 'the cost is shared between the units' },
  payroll_payment: { label: 'Salary payment', to: (id) => '/payroll/runs/' + id, rule: 'SalariesPaid → debit net salaries payable, credit bank', onApproval: 'the payroll run is recorded as paid' },
}

export function workflowSource(w: Pick<WorkflowPosting, 'source' | 'source_id' | 'payload'>): WorkflowSource {
  const s = SOURCES[w.source]
  if (!s) return { label: w.source.replace(/_/g, ' '), to: null, rule: 'Prepared by an operation', onApproval: 'the source record is updated' }
  return { label: s.label, to: s.to(w.source_id, w.payload ?? {}), rule: s.rule, onApproval: s.onApproval }
}

/** Records handled by the general approval engine, other than journals. */
export const APPROVAL_ENTITIES: Record<string, { label: string; to: (id: ID) => string; perm: string }> = {
  advance: { label: 'Advance request', to: (id) => '/expenses/advances/' + id, perm: 'expense.approve' },
  expense_claim: { label: 'Expense claim', to: (id) => '/expenses/claims/' + id, perm: 'expense.approve' },
  requisition: { label: 'Purchase requisition', to: (id) => '/purchasing/' + id, perm: 'purchase.approve' },
  purchase_order: { label: 'Purchase order', to: (id) => '/purchasing/' + id, perm: 'purchase.approve' },
  capital_call: { label: 'Capital call', to: (id) => '/investments/calls/' + id, perm: 'investment.approve' },
  distribution: { label: 'Dividend or distribution', to: (id) => '/investments/distributions/' + id, perm: 'investment.approve' },
}
