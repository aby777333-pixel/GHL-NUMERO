import type { ID, Num } from '@/engine/types'
import type {
  Allocation, AllocationInput, AttentionClass, AttentionRule, BackupCheck, BackupCheckInput, CapitalCall, CapitalCallInput, CapitalReceiptInput, Case, CaseEvent,
  CaseInput, CaseUpdate, Channel, CommitmentInput, Communication, CommunicationInput, Confirmation, ConfirmationAction, ConfirmationInput, CorporateLink,
  CorporateLinkInput, Distribution, DistributionInput, DistributionPaymentInput, EquityHolder, EquityHolderInput, FactRefresh, FactRow, FeatureFlag,
  FeatureFlagInput, FlowCase, FlowCaseInput, FlowDef, FlowDefInput, FlowStepInput, Fund, FundCommitment, FundFee, FundInput, Holding, HoldingInput, HoldingTxn,
  HoldingTxnInput, HoldingValuationInput, ImportBatch, ImportInput, Integration, IntegrationInput, InvCategory, InvCategoryInput, InvHold, InvHoldInput, InvItem,
  InvItemInput, InvLot, InvLotInput, InvMovement, LegacyBalance, Materiality, MessageTemplate, MessageTemplateInput, NavRun, Notification, NotificationPref,
  Reclassification, ReclassificationInput, Scenario, ScenarioInput, ScenarioRun, StockCount, StockCountEntry, StockDoc, StockDocInput, StockDocKind, StockRow,
  SystemHealth, TwinDriver, TwinDriverInput, UnitAllotment, UnitEvent, UnitEventInput, VerificationEntry, VerificationInput, VerificationRun, Warehouse, WarehouseInput,
} from '@/engine/p3Types'
import type { Phase3Api } from './p3Api'
import { all, first, q, rpc, rpcAll, sb } from './supabaseCore'
import { SupabaseOps } from './supabaseOps'

// =====================================================================
// LIVE DATA LAYER — phase 3.
// Reads are plain selects protected by Row Level Security. Every change
// goes through a controlled database function. Nothing here decides an
// accounting outcome, and nothing here calls a service outside NUMERO.
// =====================================================================

const none = <T>(ids: ID[] | undefined, run: () => Promise<T[]>): Promise<T[]> => (ids && !ids.length ? Promise.resolve([]) : run())
const byLine = <T extends { line_no: number }>(xs: T[] | undefined) => (xs ?? []).sort((a, b) => a.line_no - b.line_no)

export class SupabaseP3 extends SupabaseOps implements Phase3Api {
  // ------------------------------------------------------------ inventory
  async listInvCategories(companyIds: ID[]) { return none(companyIds, () => all<InvCategory>(sb().from('inv_categories').select('*').in('company_id', companyIds).order('name'))) }
  async saveInvCategory(input: InvCategoryInput) { return rpc<ID>('save_inv_category', { p: input }) }
  async listWarehouses(companyIds: ID[]) { return none(companyIds, () => all<Warehouse>(sb().from('warehouses').select('*').in('company_id', companyIds).order('code'))) }
  async saveWarehouse(input: WarehouseInput) { return rpc<ID>('save_warehouse', { p: input }) }
  async listInvItems(companyIds: ID[]) { return none(companyIds, () => all<InvItem>(sb().from('inv_items').select('*').in('company_id', companyIds).order('sku'), 20000)) }
  async saveInvItem(input: InvItemInput) { return rpc<ID>('save_inv_item', { p: input }) }
  async listInvLots(f: { companyIds: ID[]; itemId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('inv_lots').select('*').in('company_id', f.companyIds)
      if (f.itemId) s = s.eq('item_id', f.itemId)
      return all<InvLot>(s.order('expiry_date', { ascending: true, nullsFirst: false }), 20000)
    })
  }
  async saveInvLot(input: InvLotInput) { return rpc<ID>('save_inv_lot', { p: input }) }
  async listUnitEvents(lotId: ID) { return all<UnitEvent>(sb().from('inv_unit_events').select('*').eq('lot_id', lotId).order('event_date', { ascending: false }).order('created_at', { ascending: false })) }
  async recordUnitEvent(input: UnitEventInput) { return rpc<ID>('record_unit_event', { p: input }) }
  async stockOnHand(companyIds: ID[]) { return none(companyIds, () => rpcAll<StockRow>('stock_on_hand', { p_companies: companyIds }, ['company_id', 'item_id', 'warehouse_id', 'lot_id'])) }
  async listInvMovements(f: { companyIds: ID[]; itemId?: ID; lotId?: ID; docId?: ID; limit?: number }) {
    return none(f.companyIds, () => {
      let s = sb().from('inv_movements').select('*').in('company_id', f.companyIds)
      if (f.itemId) s = s.eq('item_id', f.itemId)
      if (f.lotId) s = s.eq('lot_id', f.lotId)
      if (f.docId) s = s.eq('doc_id', f.docId)
      return first<InvMovement>(s.order('move_date', { ascending: false }).order('created_at', { ascending: false }), f.limit ?? 2000)
    })
  }
  async listStockDocs(f: { companyIds: ID[]; kinds?: StockDocKind[]; purchaseDocId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('stock_docs').select('*').in('company_id', f.companyIds)
      if (f.kinds?.length) s = s.in('kind', f.kinds)
      if (f.purchaseDocId) s = s.eq('purchase_doc_id', f.purchaseDocId)
      return all<StockDoc>(s.order('doc_date', { ascending: false }).order('doc_no', { ascending: false }), 20000)
    })
  }
  async getStockDoc(id: ID) {
    const d = await q<StockDoc>(sb().from('stock_docs').select('*, lines:stock_doc_lines(*)').eq('id', id).single() as never)
    d.lines = byLine(d.lines)
    return d
  }
  async saveStockDoc(input: StockDocInput) { return rpc<ID>('save_stock_doc', { p: input }) }
  async proposeStockDoc(id: ID) { return rpc<ID | null>('propose_stock_doc', { p_id: id }) }
  async cancelStockDoc(id: ID, reason: string) { await rpc('cancel_stock_doc', { p_id: id, p_reason: reason }) }
  async listStockCounts(companyIds: ID[]) { return none(companyIds, () => all<StockCount>(sb().from('stock_counts').select('*').in('company_id', companyIds).order('count_date', { ascending: false }).order('count_no', { ascending: false }))) }
  async getStockCount(id: ID) { return q<StockCount>(sb().from('stock_counts').select('*, lines:stock_count_lines(*)').eq('id', id).single() as never) }
  async createStockCount(input: { company_id: ID; warehouse_id: ID; count_date?: string; category_id?: ID; frozen?: boolean; note?: string }) { return rpc<ID>('create_stock_count', { p: input }) }
  async recordStockCount(countId: ID, lines: StockCountEntry[], complete = true) { return rpc<'open' | 'counted'>('record_stock_count', { p: { count_id: countId, lines, complete } }) }
  async reviewStockCount(id: ID, decision: 'reviewed' | 'recount', note?: string) { await rpc('review_stock_count', { p_id: id, p_decision: decision, p_note: note ?? null }) }
  async proposeStockCount(id: ID) { return rpc<ID | null>('propose_stock_count', { p_id: id }) }
  async cancelStockCount(id: ID, reason: string) { await rpc('cancel_stock_count', { p_id: id, p_reason: reason }) }
  async listInvHolds(companyIds: ID[]) { return none(companyIds, () => all<InvHold>(sb().from('inv_holds').select('*').in('company_id', companyIds).order('noted_on', { ascending: false }), 20000)) }
  async saveInvHold(input: InvHoldInput) { return rpc<ID>('save_inv_hold', { p: input }) }
  async releaseInvHold(id: ID, note: string) { await rpc('release_inv_hold', { p_id: id, p_note: note }) }

  // ------------------------------------------------------------ investments
  async listCorporateLinks() { return all<CorporateLink>(sb().from('corporate_links').select('*').order('created_at')) }
  async saveCorporateLink(input: CorporateLinkInput) { return rpc<ID>('save_corporate_link', { p: input }) }
  async listEquityHolders(companyIds: ID[]) { return none(companyIds, () => all<EquityHolder>(sb().from('equity_holders').select('*').in('company_id', companyIds).order('quantity', { ascending: false }))) }
  async saveEquityHolder(input: EquityHolderInput) { return rpc<ID>('save_equity_holder', { p: input }) }
  async listHoldings(companyIds: ID[]) { return none(companyIds, () => all<Holding>(sb().from('holdings').select('*').in('company_id', companyIds).order('holding_no'))) }
  async saveHolding(input: HoldingInput) { return rpc<ID>('save_holding', { p: input }) }
  async listHoldingTxns(f: { holdingId?: ID; companyIds?: ID[] }) {
    if (f.companyIds && !f.companyIds.length) return []
    let s = sb().from('holding_txns').select('*')
    if (f.holdingId) s = s.eq('holding_id', f.holdingId)
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    return all<HoldingTxn>(s.order('txn_date', { ascending: false }).order('created_at', { ascending: false }), 20000)
  }
  async proposeHoldingTxn(input: HoldingTxnInput) { return rpc<ID>('propose_holding_txn', { p: input }) }
  async recordHoldingValuation(input: HoldingValuationInput) { return rpc<ID>('record_holding_valuation', { p: input }) }
  async decideHoldingValuation(txnId: ID, decision: 'approved' | 'rejected', note?: string) { await rpc('decide_holding_valuation', { p_id: txnId, p_decision: decision, p_note: note ?? null }) }
  async listFunds(companyIds: ID[]) { return none(companyIds, () => all<Fund>(sb().from('funds').select('*').in('company_id', companyIds).order('name'))) }
  async saveFund(input: FundInput) { return rpc<ID>('save_fund', { p: input }) }
  async listCommitments(f: { fundId?: ID; companyIds?: ID[] }) {
    if (f.companyIds && !f.companyIds.length) return []
    let s = sb().from('fund_commitments').select('*')
    if (f.fundId) s = s.eq('fund_id', f.fundId)
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    return all<FundCommitment>(s.order('commitment_date'))
  }
  async saveCommitment(input: CommitmentInput) { return rpc<ID>('save_commitment', { p: input }) }
  async listCapitalCalls(f: { fundId?: ID; companyIds?: ID[] }) {
    if (f.companyIds && !f.companyIds.length) return []
    let s = sb().from('capital_calls').select('*, lines:capital_call_lines(*)')
    if (f.fundId) s = s.eq('fund_id', f.fundId)
    if (f.companyIds) s = s.in('company_id', f.companyIds)
    return all<CapitalCall>(s.order('call_date', { ascending: false }) as never)
  }
  async saveCapitalCall(input: CapitalCallInput) { return rpc<ID>('save_capital_call', { p: input }) }
  async submitCapitalCall(id: ID) { await rpc('submit_capital_call', { p_id: id }) }
  async decideCapitalCall(id: ID, decision: 'approved' | 'rejected', comment?: string) { return rpc<'approved' | 'pending' | 'rejected'>('decide_capital_call', { p_id: id, p_decision: decision, p_comment: comment ?? null }) }
  async proposeCapitalReceipt(input: CapitalReceiptInput) { return rpc<ID>('propose_capital_receipt', { p: input }) }
  async listUnitAllotments(fundId: ID) { return all<UnitAllotment>(sb().from('unit_allotments').select('*').eq('fund_id', fundId).order('allot_date')) }
  async listDistributions(companyIds: ID[]) { return none(companyIds, () => all<Distribution>(sb().from('fund_distributions').select('*').in('company_id', companyIds).order('declaration_date', { ascending: false }))) }
  async getDistribution(id: ID) { return q<Distribution>(sb().from('fund_distributions').select('*, lines:distribution_lines(*)').eq('id', id).single() as never) }
  async saveDistribution(input: DistributionInput) { return rpc<ID>('save_distribution', { p: input }) }
  async submitDistribution(id: ID) { await rpc('submit_distribution', { p_id: id }) }
  async decideDistribution(id: ID, decision: 'approved' | 'rejected', comment?: string) { return rpc<'approved' | 'pending' | 'rejected'>('decide_distribution', { p_id: id, p_decision: decision, p_comment: comment ?? null }) }
  async proposeDistributionPayment(input: DistributionPaymentInput) { return rpc<ID>('propose_distribution_payment', { p: input }) }
  async listNavRuns(fundId: ID) { return all<NavRun>(sb().from('nav_runs').select('*').eq('fund_id', fundId).order('nav_date', { ascending: false }).order('prepared_at', { ascending: false })) }
  async prepareNav(fundId: ID, navDate: string, note?: string) { return rpc<ID>('prepare_nav', { p: { fund_id: fundId, nav_date: navDate, note: note ?? null } }) }
  async decideNav(id: ID, decision: 'approved' | 'rejected', note?: string) { await rpc('decide_nav', { p_id: id, p_decision: decision, p_note: note ?? null }) }
  async listFundFees(fundId: ID) { return all<FundFee>(sb().from('fund_fees').select('*').eq('fund_id', fundId).order('period_from', { ascending: false })) }
  async proposeFundFee(fundId: ID, from: string, to: string) { return rpc<ID>('propose_fund_fee', { p: { fund_id: fundId, period_from: from, period_to: to } }) }

  // ------------------------------------------------------------ reality and control
  async listMateriality(companyIds: ID[]) { return none(companyIds, () => all<Materiality>(sb().from('materiality').select('*').in('company_id', companyIds), 20000, ['company_id'])) }
  async setMateriality(companyId: ID, amount: Num, pct: Num | null, note: string) { await rpc('set_materiality', { p_company: companyId, p_amount: amount, p_pct: pct, p_note: note }) }
  async listCases(f: { companyIds: ID[]; openOnly?: boolean }) {
    return none(f.companyIds, () => {
      let s = sb().from('cases').select('*').in('company_id', f.companyIds)
      if (f.openOnly) s = s.neq('status', 'closed')
      return all<Case>(s.order('opened_at', { ascending: false }), 20000)
    })
  }
  async getCase(id: ID) {
    const c = await q<Case & { events: CaseEvent[] }>(sb().from('cases').select('*, events:case_events(*)').eq('id', id).single() as never)
    c.events = (c.events ?? []).sort((a, b) => a.at.localeCompare(b.at))
    return c
  }
  async openCase(input: CaseInput) { return rpc<ID>('open_case', { p: input }) }
  async updateCase(input: CaseUpdate) { await rpc('update_case', { p: input }) }
  async listVerifications(companyIds: ID[]) { return none(companyIds, () => all<VerificationRun>(sb().from('verification_runs').select('*').in('company_id', companyIds).order('run_date', { ascending: false }).order('verify_no', { ascending: false }))) }
  async getVerification(id: ID) {
    const r = await q<VerificationRun>(sb().from('verification_runs').select('*, lines:verification_lines(*)').eq('id', id).single() as never)
    r.lines = (r.lines ?? []).sort((a, b) => a.label.localeCompare(b.label))
    return r
  }
  async openVerification(input: VerificationInput) { return rpc<ID>('open_verification', { p: input }) }
  async recordVerification(runId: ID, lines: VerificationEntry[]) { return rpc<number>('record_verification', { p: { run_id: runId, lines } }) }
  async completeVerification(id: ID, note?: string) { return rpc<Record<string, unknown>>('complete_verification', { p_id: id, p_note: note ?? null }) }
  async cancelVerification(id: ID, reason: string) { await rpc<null>('cancel_verification', { p_id: id, p_reason: reason }) }
  async listConfirmations(companyIds: ID[]) { return none(companyIds, () => all<Confirmation>(sb().from('confirmations').select('*').in('company_id', companyIds).order('as_of', { ascending: false }).order('confirm_no', { ascending: false }), 20000)) }
  async saveConfirmation(input: ConfirmationInput) { return rpc<ID>('save_confirmation', { p: input }) }
  async updateConfirmation(action: ConfirmationAction) { return rpc<string>('update_confirmation', { p: action }) }
  async listReclassifications(f: { companyIds: ID[]; journalId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('reclassifications').select('*').in('company_id', f.companyIds)
      if (f.journalId) s = s.or(`journal_id.eq.${f.journalId},new_journal_id.eq.${f.journalId}`)
      return all<Reclassification>(s.order('requested_at', { ascending: false }), 20000)
    })
  }
  async proposeReclassification(input: ReclassificationInput) { return rpc<ID>('propose_reclassification', { p: input }) }
  async listAllocations(companyIds: ID[]) { return none(companyIds, () => all<Allocation>(sb().from('allocations').select('*').in('company_id', companyIds).order('period_to', { ascending: false }).order('alloc_no', { ascending: false }))) }
  async saveAllocation(input: AllocationInput) { return rpc<ID>('save_allocation', { p: input }) }
  async proposeAllocation(id: ID) { return rpc<ID>('propose_allocation', { p_id: id }) }

  // ------------------------------------------------------------ simulations
  async listScenarios() { return all<Scenario>(sb().from('scenarios').select('*').order('updated_at', { ascending: false })) }
  async saveScenario(input: ScenarioInput) { return rpc<ID>('save_scenario', { p: input }) }
  async listScenarioRuns(scenarioId: ID) { return first<ScenarioRun>(sb().from('scenario_runs').select('*').eq('scenario_id', scenarioId).order('created_at', { ascending: false }), 50) }
  async saveScenarioRun(input: { scenario_id: ID; company_ids: ID[]; as_of: string; base: Record<string, unknown>; result: Record<string, unknown>; note?: string }) { return rpc<ID>('save_scenario_run', { p: input }) }
  async listTwinDrivers() { return all<TwinDriver>(sb().from('twin_drivers').select('*').neq('status', 'retired').order('key')) }
  async saveTwinDriver(input: TwinDriverInput) { return rpc<ID>('save_twin_driver', { p: input }) }
  async decideTwinDriver(id: ID, decision: 'approved' | 'retired') { await rpc('decide_twin_driver', { p_id: id, p_decision: decision }) }

  // ------------------------------------------------------------ scenario studio
  async listFlowDefs() { return all<FlowDef>(sb().from('flow_defs').select('*').order('key').order('version', { ascending: false })) }
  async saveFlowDef(input: FlowDefInput) { return rpc<ID>('save_flow_def', { p: input }) }
  async setFlowStatus(id: ID, status: 'active' | 'retired') { await rpc('set_flow_status', { p_id: id, p_status: status }) }
  async cloneFlowDef(id: ID, key: string, name: string, companyId: ID | null) { return rpc<ID>('clone_flow_def', { p_id: id, p_key: key, p_name: name, p_company: companyId }) }
  async listFlowCases(f: { companyIds: ID[]; flowId?: ID; openOnly?: boolean }) {
    return none(f.companyIds, () => {
      let s = sb().from('flow_cases').select('*, steps:flow_case_steps(*)').in('company_id', f.companyIds)
      if (f.flowId) s = s.eq('flow_id', f.flowId)
      if (f.openOnly) s = s.eq('status', 'open')
      return all<FlowCase>(s.order('started_at', { ascending: false }) as never, 20000)
    })
  }
  async getFlowCase(id: ID) {
    const c = await q<FlowCase>(sb().from('flow_cases').select('*, steps:flow_case_steps(*)').eq('id', id).single() as never)
    c.steps = (c.steps ?? []).sort((a, b) => a.step_no - b.step_no)
    return c
  }
  async startFlowCase(input: FlowCaseInput) { return rpc<ID>('start_flow_case', { p: input }) }
  async completeFlowStep(input: FlowStepInput) { return rpc<'open' | 'completed'>('complete_flow_step', { p: input }) }
  async cancelFlowCase(id: ID, reason: string) { await rpc('cancel_flow_case', { p_id: id, p_reason: reason }) }

  // ------------------------------------------------------------ platform
  async listNotifications(f: { unreadOnly?: boolean; limit?: number } = {}) {
    let s = sb().from('notifications').select('*')
    if (f.unreadOnly) s = s.is('read_at', null)
    return first<Notification>(s.order('created_at', { ascending: false }), f.limit ?? 200)
  }
  async refreshNotifications() { return rpc<number>('refresh_notifications', {}) }
  async markNotifications(ids: ID[] | null, read = true) { return rpc<number>('mark_notifications', { p_ids: ids, p_read: read }) }
  async listNotificationPrefs() { return all<NotificationPref>(sb().from('notification_prefs').select('*'), 20000, ['user_id', 'kind', 'channel']) }
  async setNotificationPref(kind: string, channel: Channel, enabled: boolean) { await rpc('set_notification_pref', { p_kind: kind, p_channel: channel, p_enabled: enabled }) }
  async listAttentionRules() { return all<AttentionRule>(sb().from('attention_rules').select('*').order('kind').order('min_amount')) }
  async saveAttentionRule(input: { kind: string; min_amount?: Num; class: AttentionClass; note?: string; remove?: boolean }) { await rpc('save_attention_rule', { p: input }) }
  async listMessageTemplates() { return all<MessageTemplate>(sb().from('message_templates').select('*').order('key').order('version', { ascending: false })) }
  async saveMessageTemplate(input: MessageTemplateInput) { return rpc<ID>('save_message_template', { p: input }) }
  async listCommunications(f: { companyIds: ID[]; partyId?: ID; entity?: string; entityId?: ID }) {
    return none(f.companyIds, () => {
      let s = sb().from('communications').select('*').in('company_id', f.companyIds)
      if (f.partyId) s = s.eq('party_id', f.partyId)
      if (f.entity) s = s.eq('entity', f.entity)
      if (f.entityId) s = s.eq('entity_id', f.entityId)
      return all<Communication>(s.order('prepared_at', { ascending: false }), 20000)
    })
  }
  async prepareCommunication(input: CommunicationInput) { return rpc<ID>('prepare_communication', { p: input }) }
  async markCommunication(id: ID, status: 'sent_by_person' | 'not_sent', note: string, sentOn?: string) { await rpc('mark_communication', { p_id: id, p_status: status, p_sent_on: sentOn ?? null, p_note: note }) }
  async listIntegrations() { return all<Integration>(sb().from('integrations').select('*').order('name')) }
  async saveIntegration(input: IntegrationInput) { return rpc<ID>('save_integration', { p: input }) }
  async listFeatureFlags() { return all<FeatureFlag>(sb().from('feature_flags').select('*').order('module')) }
  async setFeatureFlag(input: FeatureFlagInput) { await rpc('set_feature_flag', { p: input }) }
  async listBackupChecks() { return first<BackupCheck>(sb().from('backup_checks').select('*').order('performed_on', { ascending: false }).order('recorded_at', { ascending: false }), 500) }
  async recordBackupCheck(input: BackupCheckInput) { return rpc<ID>('record_backup_check', { p: input }) }
  async systemHealth() { return rpc<SystemHealth>('system_health', {}) }
  async listImports(companyIds: ID[]) {
    // the rows of a file can be large: the list carries the checks, the detail carries the rows
    return none(companyIds, () => first<ImportBatch>(sb().from('import_batches')
      .select('id,company_id,kind,file_name,sha256,period_end,status,row_count,mapping,checks,ok,committed,note,created_by,created_at,committed_at')
      .in('company_id', companyIds).order('created_at', { ascending: false }) as never, 200))
  }
  async getImport(id: ID) { return q<ImportBatch>(sb().from('import_batches').select('*').eq('id', id).single()) }
  async stageImport(input: ImportInput) { return rpc<ID>('stage_import', { p: input }) }
  async commitImport(id: ID) { return rpc<{ records: number; journal_ids: ID[] }>('commit_import', { p_id: id }) }
  async discardImport(id: ID, reason?: string) { await rpc('discard_import', { p_id: id, p_reason: reason ?? null }) }
  async listLegacyBalances(companyIds: ID[], periodEnd?: string) {
    return none(companyIds, () => {
      let s = sb().from('legacy_balances').select('*').in('company_id', companyIds)
      if (periodEnd) s = s.eq('period_end', periodEnd)
      return all<LegacyBalance>(s.order('legacy_code'), 20000)
    })
  }
  async listFacts(companyIds: ID[], from: string, to: string) {
    if (!companyIds.length) return []
    // read page by page: years of monthly totals exceed one page, and a total cut short would be a false total
    return all<FactRow>(sb().from('fact_ledger_monthly').select('*').in('company_id', companyIds).is('org_unit_id', null)
      .gte('month', from.slice(0, 8) + '01').lte('month', to).order('month').order('account_id'), 200000, ['company_id'])
  }
  async listFactRefresh(companyIds: ID[]) { return none(companyIds, () => all<FactRefresh>(sb().from('fact_refresh').select('*').in('company_id', companyIds), 20000, ['company_id'])) }
  async refreshFacts(companyId: ID) { return rpc<{ rows: number; journals: number }>('refresh_facts', { p_company: companyId }) }
}
