import type { ID, Num } from '@/engine/types'
import { NumeroError } from '@/engine/types'
import KINDS from '@/engine/registerKinds.json'
import type {
  Advance, AdvanceInput, AssetCategory, AssetCategoryInput, AssetDisposalInput, AssetEvent, AssetEventInput, AssetImpairmentInput,
  CashBox, CashBoxInput, CashCount, CashCountInput, ClaimLineDecision, CollectionPromise, CollectionPromiseInput, CustomValues,
  DepreciationLine, DepreciationRun, DocumentLink, DocumentMeta, DocumentRecord, Employee, EmployeeInput, ExpenseCategory,
  ExpenseCategoryInput, ExpenseClaim, ExpenseClaimInput, FixedAsset, FixedAssetInput, FixedDeposit, FixedDepositInput, FundTransfer,
  FundTransferInput, Loan, LoanInput, LoanInstalment, MoneyMoveInput, PayrollLine, PayrollRun, PayrollRunInput, PurchaseDoc,
  PurchaseDocInput, PurchaseKind, RegisterItem, RegisterItemInput, RegisterKind, SalaryStructure, SalaryStructureInput, Task, TaskInput,
  UploadResult, WorkflowPosting,
} from '@/engine/opsTypes'
import type { CoreApi } from './types'
import type { OpsApi } from './opsApi'
import { SupabaseCore, all, first, q, rpc, sb } from './supabaseCore'
import { sha256Hex } from './demoOps'

export { liveConfigured } from './supabaseCore'

// =====================================================================
// LIVE DATA LAYER — operations (phase 2).
// Reads are plain selects protected by Row Level Security. Every change
// goes through a controlled database function; nothing here decides an
// accounting outcome. The functions return the id of a PROPOSED journal.
// =====================================================================

const BUCKET = 'numero-documents'
const none = <T>(ids: ID[] | undefined, run: () => Promise<T[]>): Promise<T[]> => (ids && !ids.length ? Promise.resolve([]) : run())
const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'file'

export class SupabaseOps extends SupabaseCore implements CoreApi, OpsApi {
  // ------------------------------------------------------------ workflow
  async listWorkflowPostings(f: { companyIds: ID[]; source?: string; sourceId?: ID; journalId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('workflow_postings').select('*').in('company_id', f.companyIds)
      if (f.source) s = s.eq('source', f.source)
      if (f.sourceId) s = s.eq('source_id', f.sourceId)
      if (f.journalId) s = s.eq('journal_id', f.journalId)
      return all<WorkflowPosting>(s.order('created_at', { ascending: false }), 20000)
    })
  }

  // ------------------------------------------------------------ registers
  async listRegisterKinds() {
    const rows = await all<RegisterKind>(sb().from('register_kinds').select('*').order('sort'))
    // the group's own version of a kind takes precedence over the system default
    const byKey = new Map<string, RegisterKind>()
    for (const r of rows) if (!byKey.has(r.key) || r.group_id) byKey.set(r.key, r)
    return [...byKey.values()].filter((k) => k.is_active).sort((a, b) => a.sort - b.sort)
  }
  async saveRegisterKind(k: Parameters<OpsApi['saveRegisterKind']>[0]) {
    const row = { key: k.key, name: k.name, category: k.category, direction: k.direction, default_certainty: k.default_certainty, dimension_type: k.dimension_type, prefix: k.prefix, fields: k.fields, sort: k.sort, is_active: k.is_active ?? true }
    const mine = await q<{ id: ID } | null>(sb().from('register_kinds').select('id').eq('key', k.key).eq('group_id', this.groupId()).maybeSingle())
    if (mine) await q(sb().from('register_kinds').update(row).eq('id', mine.id).select('id'))
    else await q(sb().from('register_kinds').insert({ ...row, group_id: this.groupId() }).select('id'))
  }
  async listRegisterItems(f: { companyIds: ID[]; kinds?: string[]; partyId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('register_items').select('*').in('company_id', f.companyIds)
      if (f.kinds?.length) s = s.in('kind', f.kinds)
      if (f.partyId) s = s.eq('party_id', f.partyId)
      return all<RegisterItem>(s.order('ref_no'), 20000)
    })
  }
  async getRegisterItem(id: ID) { return q<RegisterItem>(sb().from('register_items').select('*').eq('id', id).single()) }
  async saveRegisterItem(input: RegisterItemInput) { return rpc<ID>('save_register_item', { p: input }) }

  // ------------------------------------------------------------ tasks
  async listTasks(f: { companyIds: ID[]; entity?: string; entityId?: ID; openOnly?: boolean }) {
    return none(f.companyIds, () => {
      let s = sb().from('tasks').select('*').in('company_id', f.companyIds)
      if (f.entity) s = s.eq('entity', f.entity)
      if (f.entityId) s = s.eq('entity_id', f.entityId)
      if (f.openOnly) s = s.in('status', ['open', 'in_progress'])
      return all<Task>(s.order('due_date', { ascending: true, nullsFirst: false }), 20000)
    })
  }
  async saveTask(input: TaskInput) { return rpc<ID>('save_task', { p: input }) }

  // ------------------------------------------------------------ document vault
  async listDocuments(f: { companyIds: ID[]; entity?: string; entityId?: ID; status?: DocumentRecord['status'][] }) {
    if (!f.companyIds.length) return []
    let ids: ID[] | null = null
    if (f.entity && f.entityId) {
      ids = (await all<{ document_id: ID }>(sb().from('document_links').select('document_id').eq('entity', f.entity).eq('entity_id', f.entityId), 20000, ['document_id'])).map((r) => r.document_id)
      if (!ids.length) return []
    }
    let s = sb().from('documents').select('*, links:document_links(document_id,entity,entity_id,company_id,linked_at)').in('company_id', f.companyIds)
    if (ids) s = s.in('id', ids)
    if (f.status?.length) s = s.in('status', f.status)
    return all<DocumentRecord>(s.order('uploaded_at', { ascending: false }) as never, 20000)
  }
  async listDocumentLinks(documentIds: ID[]) {
    if (!documentIds.length) return []
    return all<DocumentLink>(sb().from('document_links').select('*').in('document_id', documentIds), 20000, ['document_id', 'entity', 'entity_id'])
  }
  async uploadDocument(companyId: ID, file: File, meta: DocumentMeta & { entity?: string; entity_id?: ID } = {}): Promise<UploadResult> {
    if (file.size > 25 * 1024 * 1024) throw new NumeroError('the file is larger than 25 MB.')
    const hash = await sha256Hex(await file.arrayBuffer())
    const path = `${companyId}/${crypto.randomUUID()}-${safeName(file.name)}`
    const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up.error) throw new NumeroError(`The file could not be stored: ${up.error.message}`)
    // the file is stored first; the register entry is what makes it part of the books
    try {
      return await rpc<UploadResult>('register_document', { p: { ...meta, company_id: companyId, name: file.name, mime: file.type || null, size_bytes: file.size, sha256: hash, storage_path: path } })
    } catch (e) {
      // the file never became a document: it is not evidence, and its uploader may remove it (storage policy, migration 0011)
      await sb().storage.from(BUCKET).remove([path]).catch(() => undefined)
      throw e
    }
  }
  async classifyDocument(id: ID, meta: DocumentMeta) { await rpc('classify_document', { p_id: id, p: meta }) }
  async linkDocument(id: ID, entity: string, entityId: ID, remove = false) { await rpc('link_document', { p_id: id, p_entity: entity, p_entity_id: entityId, p_remove: remove }) }
  async documentUrl(id: ID) {
    const d = await q<{ storage_path: string } | null>(sb().from('documents').select('storage_path').eq('id', id).maybeSingle())
    if (!d) return null
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(d.storage_path, 300)
    return error ? null : data.signedUrl
  }

  // ------------------------------------------------------------ custom field values
  async getCustomValues(_entity: string, entityId: ID): Promise<CustomValues> {
    const rows = await all<{ value: unknown; field: { key: string } | null }>(sb().from('custom_field_values').select('value, field:custom_field_defs(key)').eq('entity_id', entityId) as never, 20000, ['field_id'])
    return Object.fromEntries(rows.filter((r) => r.field).map((r) => [r.field!.key, r.value]))
  }
  async saveCustomValues(companyId: ID, entity: string, entityId: ID, values: CustomValues) {
    await rpc('save_custom_values', { p_company: companyId, p_entity: entity, p_entity_id: entityId, p_values: values })
  }

  // ------------------------------------------------------------ fixed assets
  async listAssetCategories(companyIds: ID[]) { return none(companyIds, () => all<AssetCategory>(sb().from('asset_categories').select('*').in('company_id', companyIds).order('name'))) }
  async saveAssetCategory(input: AssetCategoryInput) { return rpc<ID>('save_asset_category', { p: input }) }
  async listAssets(companyIds: ID[]) { return none(companyIds, () => all<FixedAsset>(sb().from('fixed_assets').select('*').in('company_id', companyIds).order('asset_no'), 20000)) }
  async saveAsset(input: FixedAssetInput) { return rpc<ID>('save_asset', { p: input }) }
  async listAssetEvents(assetId: ID) { return all<AssetEvent>(sb().from('asset_events').select('*').eq('asset_id', assetId).order('event_date', { ascending: false }).order('created_at', { ascending: false })) }
  async recordAssetEvent(input: AssetEventInput) { return rpc<ID>('record_asset_event', { p: input }) }
  async listDepreciationRuns(companyIds: ID[]) { return none(companyIds, () => all<DepreciationRun>(sb().from('depreciation_runs').select('*').in('company_id', companyIds).order('period_month', { ascending: false }))) }
  async getDepreciationLines(f: { runId?: ID; assetId?: ID }) {
    let s = sb().from('depreciation_lines').select('*')
    if (f.runId) s = s.eq('run_id', f.runId)
    if (f.assetId) s = s.eq('asset_id', f.assetId)
    return all<DepreciationLine>(s, 20000)
  }
  async createDepreciationRun(companyId: ID, month: string) { return rpc<ID>('create_depreciation_run', { p_company: companyId, p_month: month }) }
  async proposeDepreciationRun(runId: ID) { return rpc<ID>('propose_depreciation_run', { p_id: runId }) }
  async cancelDepreciationRun(runId: ID) { await rpc('cancel_depreciation_run', { p_id: runId }) }
  async proposeAssetDisposal(input: AssetDisposalInput) { return rpc<ID>('propose_asset_disposal', { p: input }) }
  async proposeAssetImpairment(input: AssetImpairmentInput) { return rpc<ID>('propose_asset_impairment', { p: input }) }

  // ------------------------------------------------------------ purchase-to-pay
  async listPurchaseDocs(f: { companyIds: ID[]; kinds?: PurchaseKind[]; partyId?: ID; parentId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('purchase_docs').select('*').in('company_id', f.companyIds)
      if (f.kinds?.length) s = s.in('kind', f.kinds)
      if (f.partyId) s = s.eq('party_id', f.partyId)
      if (f.parentId) s = s.eq('parent_id', f.parentId)
      return all<PurchaseDoc>(s.order('doc_date', { ascending: false }).order('doc_no', { ascending: false }), 20000)
    })
  }
  async getPurchaseDoc(id: ID) {
    const d = await q<PurchaseDoc>(sb().from('purchase_docs').select('*, lines:purchase_doc_lines(*)').eq('id', id).single() as never)
    d.lines = (d.lines ?? []).sort((a, b) => a.line_no - b.line_no)
    return d
  }
  async getPurchaseChain(id: ID) {
    let root = await this.getPurchaseDoc(id)
    for (let i = 0; root.parent_id && i < 8; i++) root = await this.getPurchaseDoc(root.parent_id)
    const out: PurchaseDoc[] = []
    const walk = async (d: PurchaseDoc, depth: number): Promise<void> => {
      out.push(d)
      if (depth > 8) return
      const kids = await all<PurchaseDoc>(sb().from('purchase_docs').select('*, lines:purchase_doc_lines(*)').eq('parent_id', d.id).order('doc_date') as never)
      for (const k of kids) { k.lines = (k.lines ?? []).sort((a, b) => a.line_no - b.line_no); await walk(k, depth + 1) }
    }
    await walk(root, 0)
    return out
  }
  async savePurchaseDoc(input: PurchaseDocInput) { return rpc<ID>('save_purchase_doc', { p: input }) }
  async submitPurchaseDoc(id: ID) { return rpc<string>('submit_purchase_doc', { p_id: id }) }
  async approvePurchaseDoc(id: ID, comment?: string) { return rpc<'approved' | 'pending'>('approve_purchase_doc', { p_id: id, p_comment: comment ?? null }) }
  async rejectPurchaseDoc(id: ID, comment: string) { await rpc('reject_purchase_doc', { p_id: id, p_comment: comment }) }
  async selectQuotation(id: ID, reason: string) { await rpc('select_quotation', { p_id: id, p_reason: reason }) }
  async cancelPurchaseDoc(id: ID, reason: string) { await rpc('cancel_purchase_doc', { p_id: id, p_reason: reason }) }
  async linkBillToPo(invoiceId: ID, poId: ID | null, map?: Record<ID, ID>) { await rpc('link_bill_to_po', { p_invoice: invoiceId, p_po: poId, p_map: map ?? null }) }

  // ------------------------------------------------------------ expense policy, advances, claims
  async listExpenseCategories(companyIds: ID[]) { return none(companyIds, () => all<ExpenseCategory>(sb().from('expense_categories').select('*').in('company_id', companyIds).order('name'))) }
  async saveExpenseCategory(input: ExpenseCategoryInput) { return rpc<ID>('save_expense_category', { p: input }) }
  async listAdvances(f: { companyIds: ID[]; partyId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('advances').select('*').in('company_id', f.companyIds)
      if (f.partyId) s = s.eq('recipient_party_id', f.partyId)
      return all<Advance>(s.order('created_at', { ascending: false }), 20000)
    })
  }
  async saveAdvance(input: AdvanceInput) { return rpc<ID>('save_advance', { p: input }) }
  async submitAdvance(id: ID) { await rpc('submit_advance', { p_id: id }) }
  async approveAdvance(id: ID, amount?: Num, comment?: string) { return rpc<'approved' | 'pending'>('approve_advance', { p_id: id, p_amount: amount ?? null, p_comment: comment ?? null }) }
  async rejectAdvance(id: ID, comment: string) { await rpc('reject_advance', { p_id: id, p_comment: comment }) }
  async releaseAdvance(id: ID, m: MoneyMoveInput) { return rpc<ID>('release_advance', { p: { advance_id: id, ...m } }) }
  async returnAdvance(id: ID, m: MoneyMoveInput) { return rpc<ID>('return_advance', { p: { advance_id: id, ...m } }) }
  async flagAdvance(id: ID, flag: 'disputed' | 'under_review' | 'follow_up' | 'cancelled' | null, note: string) { await rpc('flag_advance', { p_id: id, p_flag: flag, p_note: note }) }
  async listClaims(f: { companyIds: ID[]; partyId?: ID; advanceId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('expense_claims').select('*').in('company_id', f.companyIds)
      if (f.partyId) s = s.eq('claimant_party_id', f.partyId)
      if (f.advanceId) s = s.eq('advance_id', f.advanceId)
      return all<ExpenseClaim>(s.order('created_at', { ascending: false }), 20000)
    })
  }
  async getClaim(id: ID) {
    const c = await q<ExpenseClaim>(sb().from('expense_claims').select('*, lines:expense_claim_lines(*)').eq('id', id).single() as never)
    c.lines = (c.lines ?? []).sort((a, b) => a.line_no - b.line_no)
    return c
  }
  async saveClaim(input: ExpenseClaimInput) { return rpc<ID>('save_claim', { p: input }) }
  async submitClaim(id: ID) { await rpc('submit_claim', { p_id: id }) }
  async approveClaim(id: ID, comment?: string, lines?: ClaimLineDecision[]) { return rpc<'approved' | 'pending'>('approve_claim', { p_id: id, p_comment: comment ?? null, p_lines: lines ?? null }) }
  async rejectClaim(id: ID, comment: string) { await rpc('reject_claim', { p_id: id, p_comment: comment }) }
  async cancelClaim(id: ID, reason: string) { await rpc('cancel_claim', { p_id: id, p_reason: reason }) }
  async payClaim(id: ID, m: Omit<MoneyMoveInput, 'amount'>) { return rpc<ID>('pay_claim', { p: { claim_id: id, ...m } }) }

  // ------------------------------------------------------------ cash
  async listCashBoxes(companyIds: ID[]) { return none(companyIds, () => all<CashBox>(sb().from('cash_boxes').select('*').in('company_id', companyIds).order('name'))) }
  async saveCashBox(input: CashBoxInput) { return rpc<ID>('save_cash_box', { p: input }) }
  async listCashCounts(boxId: ID) { return all<CashCount>(sb().from('cash_counts').select('*').eq('box_id', boxId).order('count_date', { ascending: false }).order('created_at', { ascending: false })) }
  async recordCashCount(input: CashCountInput) { return rpc<{ id: ID; counted_total: Num; book_balance: Num; difference: Num }>('record_cash_count', { p: input }) }
  async listFundTransfers(companyIds: ID[]) {
    return none(companyIds, () => all<FundTransfer>(sb().from('fund_transfers').select('*').or(`company_id.in.(${companyIds.join(',')}),to_company_id.in.(${companyIds.join(',')})`).order('transfer_date', { ascending: false }), 20000))
  }
  async proposeFundTransfer(input: FundTransferInput) { return rpc<ID>('propose_fund_transfer', { p: input }) }

  // ------------------------------------------------------------ collections
  async listPromises(f: { companyIds: ID[]; partyId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('collection_promises').select('*').in('company_id', f.companyIds)
      if (f.partyId) s = s.eq('party_id', f.partyId)
      return all<CollectionPromise>(s.order('promised_date'), 20000)
    })
  }
  async savePromise(input: CollectionPromiseInput) { return rpc<ID>('save_promise', { p: input }) }

  // ------------------------------------------------------------ treasury
  async listLoans(companyIds: ID[]) { return none(companyIds, () => all<Loan>(sb().from('loans').select('*').in('company_id', companyIds).order('loan_no'))) }
  async saveLoan(input: LoanInput) { return rpc<ID>('save_loan', { p: input }) }
  async listLoanSchedule(f: { loanId?: ID; companyIds?: ID[] }) {
    if (f.companyIds && !f.companyIds.length) return []
    let s = sb().from('loan_schedule').select('*')
    if (f.loanId) s = s.eq('loan_id', f.loanId)
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    return all<LoanInstalment>(s.order('due_date').order('instalment_no'), 20000)
  }
  async disburseLoan(loanId: ID, m: MoneyMoveInput) { return rpc<ID>('disburse_loan', { p: { loan_id: loanId, ...m } }) }
  async payLoanInstalment(scheduleId: ID, m: Omit<MoneyMoveInput, 'amount'> & { interest?: Num }) { return rpc<ID>('pay_loan_instalment', { p: { schedule_id: scheduleId, ...m } }) }
  async listFixedDeposits(companyIds: ID[]) { return none(companyIds, () => all<FixedDeposit>(sb().from('fixed_deposits').select('*').in('company_id', companyIds).order('maturity_date'))) }
  async saveFixedDeposit(input: FixedDepositInput) { return rpc<ID>('save_fixed_deposit', { p: input }) }
  async placeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date?: string }) { return rpc<ID>('place_fixed_deposit', { p: { fd_id: fdId, ...m } }) }
  async closeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date: string; proceeds: Num; tax_deducted?: Num; lien_released?: boolean }) { return rpc<ID>('close_fixed_deposit', { p: { fd_id: fdId, ...m } }) }

  // ------------------------------------------------------------ payroll
  async listEmployees(companyIds: ID[]) { return none(companyIds, () => all<Employee>(sb().from('employees').select('*').in('company_id', companyIds).order('emp_no'), 20000)) }
  async saveEmployee(input: EmployeeInput) { return rpc<ID>('save_employee', { p: input }) }
  async listSalaryStructures(f: { companyIds?: ID[]; employeeId?: ID }) {
    if (f.companyIds && !f.companyIds.length) return []
    let s = sb().from('salary_structures').select('*')
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    if (f.employeeId) s = s.eq('employee_id', f.employeeId)
    return all<SalaryStructure>(s.order('effective_from', { ascending: false }), 20000)
  }
  async saveSalaryStructure(input: SalaryStructureInput) { return rpc<ID>('save_salary_structure', { p: input }) }
  async decideSalaryStructure(id: ID, decision: 'approved' | 'rejected', comment?: string) { await rpc('decide_salary_structure', { p_id: id, p_decision: decision, p_comment: comment ?? null }) }
  async listPayrollRuns(companyIds: ID[]) { return none(companyIds, () => all<PayrollRun>(sb().from('payroll_runs').select('*').in('company_id', companyIds).order('period_month', { ascending: false }))) }
  async getPayrollLines(f: { runId?: ID; companyIds?: ID[]; from?: string; to?: string }) {
    if (f.companyIds && !f.companyIds.length) return []
    let runIds: ID[] | null = null
    if (f.from || f.to) {
      let r = sb().from('payroll_runs').select('id')
      if (f.companyIds) r = r.in('company_id', f.companyIds)
      if (f.from) r = r.gte('period_month', f.from.slice(0, 8) + '01')
      if (f.to) r = r.lte('period_month', f.to)
      runIds = (await all<{ id: ID }>(r)).map((x) => x.id)
      if (!runIds.length) return []
    }
    let s = sb().from('payroll_lines').select('*')
    if (f.runId) s = s.eq('run_id', f.runId)
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    if (runIds) s = s.in('run_id', runIds)
    return all<PayrollLine>(s, 20000)
  }
  async createPayrollRun(input: PayrollRunInput) { return rpc<ID>('create_payroll_run', { p: input }) }
  async proposePayrollRun(runId: ID) { return rpc<ID>('propose_payroll_run', { p_id: runId }) }
  async cancelPayrollRun(runId: ID, reason?: string) { await rpc('cancel_payroll_run', { p_id: runId, p_reason: reason ?? null }) }
  async payPayrollRun(runId: ID, m: Omit<MoneyMoveInput, 'amount'>) { return rpc<ID>('pay_payroll_run', { p: { run_id: runId, ...m } }) }
}

/** kinds shipped with the application; the database holds the same list (generated from the same file) */
export const BUILT_IN_REGISTER_KINDS = (KINDS as unknown as { key: string }[]).length
