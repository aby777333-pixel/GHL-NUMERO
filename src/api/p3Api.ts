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

/**
 * Phase 3: inventory, investments, reality and control, simulations, the scenario studio, the platform.
 *
 * The rule of Phase 2 holds: a method with an accounting effect returns the id of a PROPOSED journal
 * (or null where nothing of value moves). Nothing here writes to the ledger, and nothing here moves money.
 * A simulation is a calculation beside the books; saving one stores figures labelled SIMULATION.
 */
export interface Phase3Api {
  // ------------------------------------------------------------ inventory
  listInvCategories(companyIds: ID[]): Promise<InvCategory[]>
  saveInvCategory(input: InvCategoryInput): Promise<ID>
  listWarehouses(companyIds: ID[]): Promise<Warehouse[]>
  saveWarehouse(input: WarehouseInput): Promise<ID>
  listInvItems(companyIds: ID[]): Promise<InvItem[]>
  saveInvItem(input: InvItemInput): Promise<ID>
  listInvLots(f: { companyIds: ID[]; itemId?: ID }): Promise<InvLot[]>
  saveInvLot(input: InvLotInput): Promise<ID>
  listUnitEvents(lotId: ID): Promise<UnitEvent[]>
  recordUnitEvent(input: UnitEventInput): Promise<ID>
  /** quantity in each place, from the stock ledger */
  stockOnHand(companyIds: ID[]): Promise<StockRow[]>
  /** the latest movements first; `limit` says how many are read (2,000 unless stated) */
  listInvMovements(f: { companyIds: ID[]; itemId?: ID; lotId?: ID; docId?: ID; limit?: number }): Promise<InvMovement[]>
  listStockDocs(f: { companyIds: ID[]; kinds?: StockDocKind[]; purchaseDocId?: ID }): Promise<StockDoc[]>
  getStockDoc(id: ID): Promise<StockDoc>
  saveStockDoc(input: StockDocInput): Promise<ID>
  /** proposes the accounting entry; null for a transfer or a document without value, which need none */
  proposeStockDoc(id: ID): Promise<ID | null>
  cancelStockDoc(id: ID, reason: string): Promise<void>
  listStockCounts(companyIds: ID[]): Promise<StockCount[]>
  getStockCount(id: ID): Promise<StockCount>
  createStockCount(input: { company_id: ID; warehouse_id: ID; count_date?: string; category_id?: ID; frozen?: boolean; note?: string }): Promise<ID>
  recordStockCount(countId: ID, lines: StockCountEntry[], complete?: boolean): Promise<'open' | 'counted'>
  reviewStockCount(id: ID, decision: 'reviewed' | 'recount', note?: string): Promise<void>
  proposeStockCount(id: ID): Promise<ID | null>
  cancelStockCount(id: ID, reason: string): Promise<void>
  listInvHolds(companyIds: ID[]): Promise<InvHold[]>
  saveInvHold(input: InvHoldInput): Promise<ID>
  releaseInvHold(id: ID, note: string): Promise<void>

  // ------------------------------------------------------------ investments
  listCorporateLinks(): Promise<CorporateLink[]>
  saveCorporateLink(input: CorporateLinkInput): Promise<ID>
  listEquityHolders(companyIds: ID[]): Promise<EquityHolder[]>
  saveEquityHolder(input: EquityHolderInput): Promise<ID>
  listHoldings(companyIds: ID[]): Promise<Holding[]>
  saveHolding(input: HoldingInput): Promise<ID>
  listHoldingTxns(f: { holdingId?: ID; companyIds?: ID[] }): Promise<HoldingTxn[]>
  proposeHoldingTxn(input: HoldingTxnInput): Promise<ID>
  recordHoldingValuation(input: HoldingValuationInput): Promise<ID>
  decideHoldingValuation(txnId: ID, decision: 'approved' | 'rejected', note?: string): Promise<void>
  listFunds(companyIds: ID[]): Promise<Fund[]>
  saveFund(input: FundInput): Promise<ID>
  listCommitments(f: { fundId?: ID; companyIds?: ID[] }): Promise<FundCommitment[]>
  saveCommitment(input: CommitmentInput): Promise<ID>
  listCapitalCalls(f: { fundId?: ID; companyIds?: ID[] }): Promise<CapitalCall[]>
  saveCapitalCall(input: CapitalCallInput): Promise<ID>
  submitCapitalCall(id: ID): Promise<void>
  decideCapitalCall(id: ID, decision: 'approved' | 'rejected', comment?: string): Promise<'approved' | 'pending' | 'rejected'>
  proposeCapitalReceipt(input: CapitalReceiptInput): Promise<ID>
  listUnitAllotments(fundId: ID): Promise<UnitAllotment[]>
  listDistributions(companyIds: ID[]): Promise<Distribution[]>
  getDistribution(id: ID): Promise<Distribution>
  saveDistribution(input: DistributionInput): Promise<ID>
  submitDistribution(id: ID): Promise<void>
  decideDistribution(id: ID, decision: 'approved' | 'rejected', comment?: string): Promise<'approved' | 'pending' | 'rejected'>
  proposeDistributionPayment(input: DistributionPaymentInput): Promise<ID>
  listNavRuns(fundId: ID): Promise<NavRun[]>
  prepareNav(fundId: ID, navDate: string, note?: string): Promise<ID>
  decideNav(id: ID, decision: 'approved' | 'rejected', note?: string): Promise<void>
  listFundFees(fundId: ID): Promise<FundFee[]>
  proposeFundFee(fundId: ID, from: string, to: string): Promise<ID>

  // ------------------------------------------------------------ reality and control
  listMateriality(companyIds: ID[]): Promise<Materiality[]>
  setMateriality(companyId: ID, amount: Num, pct: Num | null, note: string): Promise<void>
  listCases(f: { companyIds: ID[]; openOnly?: boolean }): Promise<Case[]>
  getCase(id: ID): Promise<Case & { events: CaseEvent[] }>
  openCase(input: CaseInput): Promise<ID>
  updateCase(input: CaseUpdate): Promise<void>
  listVerifications(companyIds: ID[]): Promise<VerificationRun[]>
  getVerification(id: ID): Promise<VerificationRun>
  openVerification(input: VerificationInput): Promise<ID>
  recordVerification(runId: ID, lines: VerificationEntry[]): Promise<number>
  completeVerification(id: ID, note?: string): Promise<Record<string, unknown>>
  /** a sheet that is still open, opened by mistake: what was entered stays on it, and nothing is raised from it */
  cancelVerification(id: ID, reason: string): Promise<void>
  listConfirmations(companyIds: ID[]): Promise<Confirmation[]>
  saveConfirmation(input: ConfirmationInput): Promise<ID>
  updateConfirmation(action: ConfirmationAction): Promise<string>
  listReclassifications(f: { companyIds: ID[]; journalId?: ID }): Promise<Reclassification[]>
  proposeReclassification(input: ReclassificationInput): Promise<ID>
  listAllocations(companyIds: ID[]): Promise<Allocation[]>
  saveAllocation(input: AllocationInput): Promise<ID>
  proposeAllocation(id: ID): Promise<ID>

  // ------------------------------------------------------------ simulations
  listScenarios(): Promise<Scenario[]>
  saveScenario(input: ScenarioInput): Promise<ID>
  listScenarioRuns(scenarioId: ID): Promise<ScenarioRun[]>
  saveScenarioRun(input: { scenario_id: ID; company_ids: ID[]; as_of: string; base: Record<string, unknown>; result: Record<string, unknown>; note?: string }): Promise<ID>
  listTwinDrivers(): Promise<TwinDriver[]>
  saveTwinDriver(input: TwinDriverInput): Promise<ID>
  decideTwinDriver(id: ID, decision: 'approved' | 'retired'): Promise<void>

  // ------------------------------------------------------------ scenario studio
  listFlowDefs(): Promise<FlowDef[]>
  saveFlowDef(input: FlowDefInput): Promise<ID>
  setFlowStatus(id: ID, status: 'active' | 'retired'): Promise<void>
  cloneFlowDef(id: ID, key: string, name: string, companyId: ID | null): Promise<ID>
  listFlowCases(f: { companyIds: ID[]; flowId?: ID; openOnly?: boolean }): Promise<FlowCase[]>
  getFlowCase(id: ID): Promise<FlowCase>
  startFlowCase(input: FlowCaseInput): Promise<ID>
  completeFlowStep(input: FlowStepInput): Promise<'open' | 'completed'>
  cancelFlowCase(id: ID, reason: string): Promise<void>

  // ------------------------------------------------------------ platform
  listNotifications(f?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]>
  /** looks for what has fallen due since the person last opened the application; returns how many notices were added */
  refreshNotifications(): Promise<number>
  markNotifications(ids: ID[] | null, read?: boolean): Promise<number>
  listNotificationPrefs(): Promise<NotificationPref[]>
  setNotificationPref(kind: string, channel: Channel, enabled: boolean): Promise<void>
  listAttentionRules(): Promise<AttentionRule[]>
  saveAttentionRule(input: { kind: string; min_amount?: Num; class: AttentionClass; note?: string; remove?: boolean }): Promise<void>
  listMessageTemplates(): Promise<MessageTemplate[]>
  saveMessageTemplate(input: MessageTemplateInput): Promise<ID>
  listCommunications(f: { companyIds: ID[]; partyId?: ID; entity?: string; entityId?: ID }): Promise<Communication[]>
  prepareCommunication(input: CommunicationInput): Promise<ID>
  markCommunication(id: ID, status: 'sent_by_person' | 'not_sent', note: string, sentOn?: string): Promise<void>
  listIntegrations(): Promise<Integration[]>
  saveIntegration(input: IntegrationInput): Promise<ID>
  listFeatureFlags(): Promise<FeatureFlag[]>
  setFeatureFlag(input: FeatureFlagInput): Promise<void>
  listBackupChecks(): Promise<BackupCheck[]>
  recordBackupCheck(input: BackupCheckInput): Promise<ID>
  systemHealth(): Promise<SystemHealth>
  listImports(companyIds: ID[]): Promise<ImportBatch[]>
  getImport(id: ID): Promise<ImportBatch>
  stageImport(input: ImportInput): Promise<ID>
  commitImport(id: ID): Promise<{ records: number; journal_ids: ID[] }>
  discardImport(id: ID, reason?: string): Promise<void>
  listLegacyBalances(companyIds: ID[], periodEnd?: string): Promise<LegacyBalance[]>
  /** monthly totals for analysis over years */
  listFacts(companyIds: ID[], from: string, to: string): Promise<FactRow[]>
  listFactRefresh(companyIds: ID[]): Promise<FactRefresh[]>
  refreshFacts(companyId: ID): Promise<{ rows: number; journals: number }>
}
