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
}
