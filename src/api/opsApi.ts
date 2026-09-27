import type { ID, Num } from '@/engine/types'
import type {
  Advance, AdvanceInput, AssetCategory, AssetCategoryInput, AssetDisposalInput, AssetEvent, AssetEventInput, AssetImpairmentInput,
  CashBox, CashBoxInput, CashCount, CashCountInput, ClaimLineDecision, CollectionPromise, CollectionPromiseInput, CustomValues,
  DepreciationLine, DepreciationRun, DocumentLink, DocumentMeta, DocumentRecord, Employee, EmployeeInput, ExpenseCategory,
  ExpenseCategoryInput, ExpenseClaim, ExpenseClaimInput, FixedAsset, FixedAssetInput, FixedDeposit, FixedDepositInput, FundTransfer,
  FundTransferInput, Loan, LoanInput, LoanInstalment, MoneyMoveInput, PayrollLine, PayrollRun, PayrollRunInput, PurchaseDoc,
  PurchaseDocInput, PurchaseKind, RegisterItem, RegisterItemInput, RegisterKind, SalaryStructure, SalaryStructureInput, Task, TaskInput,
  UploadResult, WorkflowPosting,
} from '@/engine/opsTypes'

/**
 * Operations that surround the ledger (phase 2).
 *
 * Rule shared by every method that has an accounting effect: it returns the id of a
 * PROPOSED journal. That journal sits in the approval queue like any other and posts
 * on its final approval. Nothing here writes to the ledger directly, and nothing here
 * moves money — NUMERO records that money moved.
 */
export interface OpsApi {
  // workflow
  listWorkflowPostings(f: { companyIds: ID[]; source?: string; sourceId?: ID; journalId?: ID }): Promise<WorkflowPosting[]>

  // registers & obligations
  listRegisterKinds(): Promise<RegisterKind[]>
  saveRegisterKind(k: Omit<RegisterKind, 'id' | 'group_id' | 'is_active'> & { id?: ID; is_active?: boolean }): Promise<void>
  listRegisterItems(f: { companyIds: ID[]; kinds?: string[]; partyId?: ID }): Promise<RegisterItem[]>
  getRegisterItem(id: ID): Promise<RegisterItem>
  saveRegisterItem(input: RegisterItemInput): Promise<ID>

  // tasks & follow-ups
  listTasks(f: { companyIds: ID[]; entity?: string; entityId?: ID; openOnly?: boolean }): Promise<Task[]>
  saveTask(input: TaskInput): Promise<ID>

  // document vault
  listDocuments(f: { companyIds: ID[]; entity?: string; entityId?: ID; status?: DocumentRecord['status'][] }): Promise<DocumentRecord[]>
  listDocumentLinks(documentIds: ID[]): Promise<DocumentLink[]>
  uploadDocument(companyId: ID, file: File, meta?: DocumentMeta & { entity?: string; entity_id?: ID }): Promise<UploadResult>
  classifyDocument(id: ID, meta: DocumentMeta): Promise<void>
  linkDocument(id: ID, entity: string, entityId: ID, remove?: boolean): Promise<void>
  /** a short-lived address for viewing the file; null when the file is not available */
  documentUrl(id: ID): Promise<string | null>

  // custom field values
  getCustomValues(entity: string, entityId: ID): Promise<CustomValues>
  saveCustomValues(companyId: ID, entity: string, entityId: ID, values: CustomValues): Promise<void>

  // fixed assets
  listAssetCategories(companyIds: ID[]): Promise<AssetCategory[]>
  saveAssetCategory(input: AssetCategoryInput): Promise<ID>
  listAssets(companyIds: ID[]): Promise<FixedAsset[]>
  saveAsset(input: FixedAssetInput): Promise<ID>
  listAssetEvents(assetId: ID): Promise<AssetEvent[]>
  recordAssetEvent(input: AssetEventInput): Promise<ID>
  listDepreciationRuns(companyIds: ID[]): Promise<DepreciationRun[]>
  getDepreciationLines(f: { runId?: ID; assetId?: ID }): Promise<DepreciationLine[]>
  createDepreciationRun(companyId: ID, month: string): Promise<ID>
  proposeDepreciationRun(runId: ID): Promise<ID>
  cancelDepreciationRun(runId: ID): Promise<void>
  proposeAssetDisposal(input: AssetDisposalInput): Promise<ID>
  proposeAssetImpairment(input: AssetImpairmentInput): Promise<ID>

  // purchase-to-pay
  listPurchaseDocs(f: { companyIds: ID[]; kinds?: PurchaseKind[]; partyId?: ID; parentId?: ID }): Promise<PurchaseDoc[]>
  getPurchaseDoc(id: ID): Promise<PurchaseDoc>
  /** every document of the chain a document belongs to, with lines */
  getPurchaseChain(id: ID): Promise<PurchaseDoc[]>
  savePurchaseDoc(input: PurchaseDocInput): Promise<ID>
  submitPurchaseDoc(id: ID): Promise<string>
  approvePurchaseDoc(id: ID, comment?: string): Promise<'approved' | 'pending'>
  rejectPurchaseDoc(id: ID, comment: string): Promise<void>
  selectQuotation(id: ID, reason: string): Promise<void>
  cancelPurchaseDoc(id: ID, reason: string): Promise<void>
  linkBillToPo(invoiceId: ID, poId: ID | null, map?: Record<ID, ID>): Promise<void>

  // expense policy, advances, claims
  listExpenseCategories(companyIds: ID[]): Promise<ExpenseCategory[]>
  saveExpenseCategory(input: ExpenseCategoryInput): Promise<ID>
  listAdvances(f: { companyIds: ID[]; partyId?: ID }): Promise<Advance[]>
  saveAdvance(input: AdvanceInput): Promise<ID>
  submitAdvance(id: ID): Promise<void>
  approveAdvance(id: ID, amount?: Num, comment?: string): Promise<'approved' | 'pending'>
  rejectAdvance(id: ID, comment: string): Promise<void>
  releaseAdvance(id: ID, m: MoneyMoveInput): Promise<ID>
  returnAdvance(id: ID, m: MoneyMoveInput): Promise<ID>
  flagAdvance(id: ID, flag: 'disputed' | 'under_review' | 'follow_up' | 'cancelled' | null, note: string): Promise<void>
  listClaims(f: { companyIds: ID[]; partyId?: ID; advanceId?: ID }): Promise<ExpenseClaim[]>
  getClaim(id: ID): Promise<ExpenseClaim>
  saveClaim(input: ExpenseClaimInput): Promise<ID>
  submitClaim(id: ID): Promise<void>
  approveClaim(id: ID, comment?: string, lines?: ClaimLineDecision[]): Promise<'approved' | 'pending'>
  rejectClaim(id: ID, comment: string): Promise<void>
  cancelClaim(id: ID, reason: string): Promise<void>
  payClaim(id: ID, m: Omit<MoneyMoveInput, 'amount'>): Promise<ID>

  // cash
  listCashBoxes(companyIds: ID[]): Promise<CashBox[]>
  saveCashBox(input: CashBoxInput): Promise<ID>
  listCashCounts(boxId: ID): Promise<CashCount[]>
  recordCashCount(input: CashCountInput): Promise<{ id: ID; counted_total: Num; book_balance: Num; difference: Num }>
  listFundTransfers(companyIds: ID[]): Promise<FundTransfer[]>
  proposeFundTransfer(input: FundTransferInput): Promise<ID>

  // collections
  listPromises(f: { companyIds: ID[]; partyId?: ID }): Promise<CollectionPromise[]>
  savePromise(input: CollectionPromiseInput): Promise<ID>

  // treasury
  listLoans(companyIds: ID[]): Promise<Loan[]>
  saveLoan(input: LoanInput): Promise<ID>
  listLoanSchedule(f: { loanId?: ID; companyIds?: ID[] }): Promise<LoanInstalment[]>
  disburseLoan(loanId: ID, m: MoneyMoveInput): Promise<ID>
  payLoanInstalment(scheduleId: ID, m: Omit<MoneyMoveInput, 'amount'> & { interest?: Num }): Promise<ID>
  listFixedDeposits(companyIds: ID[]): Promise<FixedDeposit[]>
  saveFixedDeposit(input: FixedDepositInput): Promise<ID>
  placeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date?: string }): Promise<ID>
  closeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date: string; proceeds: Num; tax_deducted?: Num; lien_released?: boolean }): Promise<ID>

  // payroll (requires payroll permissions; salary detail never reaches the general ledger)
  listEmployees(companyIds: ID[]): Promise<Employee[]>
  saveEmployee(input: EmployeeInput): Promise<ID>
  listSalaryStructures(f: { companyIds?: ID[]; employeeId?: ID }): Promise<SalaryStructure[]>
  saveSalaryStructure(input: SalaryStructureInput): Promise<ID>
  decideSalaryStructure(id: ID, decision: 'approved' | 'rejected', comment?: string): Promise<void>
  listPayrollRuns(companyIds: ID[]): Promise<PayrollRun[]>
  getPayrollLines(f: { runId?: ID; companyIds?: ID[]; from?: string; to?: string }): Promise<PayrollLine[]>
  createPayrollRun(input: PayrollRunInput): Promise<ID>
  proposePayrollRun(runId: ID): Promise<ID>
  cancelPayrollRun(runId: ID, reason?: string): Promise<void>
  payPayrollRun(runId: ID, m: Omit<MoneyMoveInput, 'amount'>): Promise<ID>
}
