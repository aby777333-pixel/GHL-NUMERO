import Decimal from 'decimal.js'
import { D, ZERO, round2, sum } from '@/lib/money'
import { daysBetween, endOfMonth, fiscalYearOf, startOfMonth, today } from '@/lib/dates'
import KINDS from '@/engine/registerKinds.json'
import type { ApprovalRequest, Confidentiality, ID, Journal, JournalLineInput, Num } from '@/engine/types'
import type {
  AssetCategory, AssetCategoryInput, AssetDisposalInput, AssetEvent, AssetEventInput, AssetImpairmentInput, Certainty, CustomValues,
  DepreciationLine, DepreciationRun, DocumentLink, DocumentMeta, DocumentRecord, FixedAsset, FixedAssetInput, PurchaseDoc, PurchaseDocInput,
  PurchaseKind, PurchaseLine, RegisterField, RegisterItem, RegisterItemInput, RegisterKind, Task, TaskInput, UploadResult, WorkflowPosting,
} from '@/engine/opsTypes'
import { DemoCore, fail, uid } from './demoCore'

// =====================================================================
// DEMO OPERATIONS ENGINE — part A
// Workflow posting, general approvals, registers, tasks, documents,
// fixed assets and purchase-to-pay. Mirrors migrations 0006 and 0007:
// the same rules, the same refusals, the same wording.
// =====================================================================

type WfEvent = 'posted' | 'voided' | 'reversed'
type Handler = (w: WorkflowPosting, event: WfEvent, reason?: string) => void
const mon = (d: string) => new Date(d + 'T00:00:00').toLocaleString('en-GB', { month: 'short', year: 'numeric' })
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
export const money = (v: Num | null | undefined) => round2(D(v ?? 0))

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class DemoOpsA extends DemoCore {
  postings: WorkflowPosting[] = []
  protected handlers: Record<string, Handler> = {}

  registerKinds: RegisterKind[] = (KINDS as unknown as (Omit<RegisterKind, 'default_certainty' | 'is_active'> & { certainty: Certainty })[])
    .map((k) => ({ key: k.key, name: k.name, category: k.category, direction: k.direction, default_certainty: k.certainty, dimension_type: k.dimension_type, prefix: k.prefix, fields: k.fields as RegisterField[], sort: k.sort, is_active: true, group_id: null }))
  registerItems: RegisterItem[] = []
  tasks: Task[] = []
  documents: DocumentRecord[] = []
  documentLinks: DocumentLink[] = []
  protected blobs = new Map<ID, Blob>()
  customValues = new Map<string, CustomValues>()
  assetCategories: AssetCategory[] = []
  assets: FixedAsset[] = []
  assetEvents: AssetEvent[] = []
  depRuns: DepreciationRun[] = []
  depLines: DepreciationLine[] = []
  purchaseDocs: PurchaseDoc[] = []
  purchaseLines: PurchaseLine[] = []

  constructor() {
    super()
    this.handlers.depreciation = (w, e) => this.wfDepreciation(w, e)
    this.handlers.asset_disposal = (w, e) => this.wfAssetDisposal(w, e)
    this.handlers.asset_impairment = (w, e) => this.wfAssetImpairment(w, e)
  }

  // ------------------------------------------------------------ shared helpers
  protected docNo(companyId: ID, type: string, prefix: string, date: string) {
    const fy = fiscalYearOf(date || today(), this.company(companyId).fy_start_month)
    return `${prefix}-${fy}-${String(this.nextSeq(`d:${companyId}:${type}:${fy}`)).padStart(6, '0')}`
  }
  protected partyName(id: ID | null | undefined) { return this.parties.find((p) => p.id === id)?.display_name ?? 'Unknown' }
  protected needParty(id: ID | null | undefined, message: string) { return this.parties.find((p) => p.id === id) ?? fail(message) }
  protected needUnit(companyId: ID, id: ID | null | undefined, message = 'the selected dimension belongs to another company.') {
    if (id && !this.orgUnits.some((u) => u.id === id && u.company_id === companyId)) fail(message)
  }
  protected needDims(companyId: ID, dims: Record<string, ID> | undefined, message: string) {
    for (const v of Object.values(dims ?? {})) if (v && !this.orgUnits.some((u) => u.id === v && u.company_id === companyId)) fail(message)
  }
  protected postingAccount(companyId: ID, id: ID | null | undefined, message: string) {
    const a = id ? this.account(id) : undefined
    if (!a || a.company_id !== companyId || a.is_group || !a.is_active) fail(message)
    return a!
  }
  protected bankLedger(companyId: ID, id: ID | null | undefined, message: string, bankOnly = false) {
    const a = id ? this.account(id) : undefined
    if (!a || a.company_id !== companyId || !(bankOnly ? ['bank'] : ['bank', 'cash']).includes(a.control_type ?? '')) fail(message)
    return a!
  }
  protected clearance(level: string | undefined) {
    if (level && level !== 'internal' && !this.canViewLevel(level)) fail('you cannot create records at a confidentiality level you are not cleared for.', '42501')
  }
  protected dimOf(unitId: ID | null | undefined): Record<string, ID> {
    const u = this.orgUnits.find((x) => x.id === unitId)
    return u ? { [u.type_key]: u.id } : {}
  }
  /** balance of a ledger from posted journals up to a date (debit positive) */
  protected ledgerBalance(companyId: ID, accountId: ID, to: string): Decimal {
    const posted = this.postedSet(to)
    let b = ZERO
    for (const l of this.lines) if (l.company_id === companyId && l.account_id === accountId && posted.has(l.journal_id)) b = b.plus(l.debit).minus(l.credit)
    return b
  }

  // ------------------------------------------------------------ general approvals
  protected openRequest(companyId: ID, entity: string, entityId: ID, amount: Num, summary: string | null): ID {
    const amt = D(amount)
    const rule = this.approvalRules
      .filter((r) => r.is_active && r.entity === entity && (r.company_id === companyId || r.company_id === null) && amt.gte(r.min_amount) && (r.max_amount === null || amt.lt(r.max_amount)))
      .sort((a, b) => Number(b.company_id !== null) - Number(a.company_id !== null) || D(b.min_amount).cmp(a.min_amount))[0]
    this.approvalRequests.forEach((r) => { if (r.entity === entity && r.entity_id === entityId && r.status === 'pending') r.status = 'cancelled' })
    const req: ApprovalRequest = { id: uid(), company_id: companyId, entity, entity_id: entityId, amount: amt.toString(), steps: rule?.steps ?? ['*'], current_step: 1, status: 'pending', summary, requested_by: this.actor, requested_at: this.now() }
    this.approvalRequests.push(req)
    return req.id
  }
  protected decideRequest(entity: string, entityId: ID, maker: ID | null, what: string, comment?: string | null): 'approved' | 'pending' {
    const r = this.approvalRequests.find((x) => x.entity === entity && x.entity_id === entityId && x.status === 'pending') ?? fail(`this ${what} is not awaiting approval.`)
    const action = this.makerChecker(maker, what)
    if (action === 'approve' && this.approvalActions.some((a) => a.request_id === r.id && a.actor === this.actor && (a.action === 'approve' || a.action === 'override'))) fail('you have already approved an earlier step of this request.', '42501')
    this.approvalActions.push({ request_id: r.id, step: r.current_step, actor: this.actor, action, comment: comment ?? null, at: this.now() })
    if (r.current_step >= r.steps.length) { r.status = 'approved'; return 'approved' }
    r.current_step += 1
    return 'pending'
  }
  protected refuseRequest(entity: string, entityId: ID, what: string, comment: string) {
    if (blank(comment)) fail('a reason is required to reject.')
    const r = this.approvalRequests.find((x) => x.entity === entity && x.entity_id === entityId && x.status === 'pending') ?? fail(`this ${what} is not awaiting approval.`)
    this.approvalActions.push({ request_id: r.id, step: r.current_step, actor: this.actor, action: 'reject', comment, at: this.now() })
    r.status = 'rejected'
  }
  protected cancelRequests(entity: string, entityId: ID) {
    this.approvalRequests.forEach((r) => { if (r.entity === entity && r.entity_id === entityId && r.status === 'pending') r.status = 'cancelled' })
  }

  // ------------------------------------------------------------ workflow posting engine
  protected override hasWorkflow(journalId: ID, state?: 'pending' | 'posted') {
    return this.postings.some((w) => w.journal_id === journalId && (!state || w.status === state))
  }
  protected override wfDispatch(journalId: ID, event: WfEvent, reason?: string) {
    const w = this.postings.find((x) => x.journal_id === journalId && x.status === (event === 'reversed' ? 'posted' : 'pending'))
    if (!w) return
    const h = this.handlers[w.source] ?? fail(`no handler is installed for workflow source "${w.source}".`)
    h(w, event, reason)
    w.status = event
    w.completed_at = this.now()
  }
  protected pendingAmount(source: string, sourceId: ID) {
    return sum(this.postings.filter((w) => w.source === source && w.source_id === sourceId && w.status === 'pending').map((w) => (w.payload.amount as Num) ?? 0))
  }
  /** A payment out of a cash box above its limit for a single payment is recorded and raised for review. It is never blocked. */
  protected checkCashBoxLimit(_companyId: ID, _journalId: ID, _narration: string, _source: string): void { /* cash boxes arrive with the expenses layer */ }
  /** Prepares a journal from an operational event and places it in the approval queue. */
  protected proposePosting(companyId: ID, vtype: string, date: string, narration: string, source: string, sourceId: ID, lines: JournalLineInput[], payload: Record<string, unknown> = {}, confidentiality = 'internal'): ID {
    if (!date) fail('a posting date is required.')
    if (this.postings.some((w) => w.source === source && w.source_id === sourceId && w.status === 'pending')) fail('an accounting entry for this record is already awaiting approval. Approve or reject it first.')
    this.assertPeriodOpen(companyId, date)
    const j: Journal = {
      id: uid(), company_id: companyId, voucher_type: vtype, voucher_no: null, journal_date: date, narration, purpose: null, status: 'draft', source, source_id: sourceId,
      origin: 'system', reversal_of: null, reversed_by: null, confidentiality: confidentiality as Journal['confidentiality'], total: '0', created_by: this.actor, created_at: this.now(),
    }
    this.journals.push(j)
    try {
      j.total = this.writeLines(j.id, companyId, lines.filter((l) => D(l.debit).gt(0) || D(l.credit).gt(0))).toString()
      this.assertBalanced(j.id)
    } catch (e) {
      // the database does this inside one transaction: a refused proposal leaves nothing behind
      const ids = new Set((this.linesByJournal.get(j.id) ?? []).map((l) => l.id))
      this.lines = this.lines.filter((l) => !ids.has(l.id))
      this.linesByJournal.delete(j.id)
      this.journals = this.journals.filter((x) => x.id !== j.id)
      throw e
    }
    const req = this.openRequest(companyId, 'journal', j.id, j.total, narration)
    j.status = 'submitted'; j.submitted_by = this.actor; j.submitted_at = this.now()
    this.postings.push({ id: uid(), company_id: companyId, journal_id: j.id, source, source_id: sourceId, payload, status: 'pending', created_by: this.actor, created_at: this.now() })
    this.checkCashBoxLimit(companyId, j.id, narration, source)
    this.log(companyId, 'journals', j.id, 'proposed', null, { source, source_id: sourceId, total: j.total, approval_request: req, rule: 'Operational event → proposed journal → approval → posting' }, null)
    return j.id
  }
  async listWorkflowPostings(f: { companyIds: ID[]; source?: string; sourceId?: ID; journalId?: ID }) {
    return this.postings.filter((w) => f.companyIds.includes(w.company_id) && (!f.source || w.source === f.source) && (!f.sourceId || w.source_id === f.sourceId) && (!f.journalId || w.journal_id === f.journalId))
  }

  // ------------------------------------------------------------ registers
  async listRegisterKinds() { return [...this.registerKinds].sort((a, b) => a.sort - b.sort) }
  async saveRegisterKind(k: Omit<RegisterKind, 'id' | 'group_id' | 'is_active'> & { id?: ID; is_active?: boolean }) {
    if (!this.isAdmin()) fail('only a Group Super Admin can define register kinds.', '42501')
    if (blank(k.key) || blank(k.name)) fail('a register kind needs a key and a name.')
    const ex = this.registerKinds.find((x) => x.key === k.key)
    if (ex && ex.group_id === null) {
      // a system kind is never edited: the group's own version takes precedence
      this.registerKinds = this.registerKinds.filter((x) => x !== ex)
    }
    const mine = this.registerKinds.find((x) => x.key === k.key && x.group_id === this.group.id)
    const row: RegisterKind = { ...k, id: mine?.id ?? uid(), group_id: this.group.id, is_active: k.is_active ?? true }
    if (mine) Object.assign(mine, row); else this.registerKinds.push(row)
    this.log(null, 'register_kinds', row.id!, mine ? 'update' : 'insert', null, row, null)
  }
  async listRegisterItems(f: { companyIds: ID[]; kinds?: string[]; partyId?: ID }) {
    return this.registerItems
      .filter((r) => f.companyIds.includes(r.company_id) && (!f.kinds?.length || f.kinds.includes(r.kind)) && (!f.partyId || r.party_id === f.partyId) && this.canViewLevel(r.confidentiality))
      .sort((a, b) => a.ref_no.localeCompare(b.ref_no))
  }
  async getRegisterItem(id: ID) {
    const r = this.registerItems.find((x) => x.id === id && this.canViewLevel(x.confidentiality)) ?? fail('register item not found.')
    return { ...r }
  }
  async saveRegisterItem(p: RegisterItemInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.title)) fail('a title is required.')
    this.clearance(p.confidentiality)
    if (p.party_id) this.needParty(p.party_id, 'unknown party.')
    if (p.account_id) { const a = this.account(p.account_id); if (!a || a.company_id !== p.company_id || a.is_group) fail('choose a posting account of this company.') }
    this.needUnit(p.company_id, p.org_unit_id)
    if (p.end_date && p.start_date && p.end_date < p.start_date) fail('the end date is before the start date.')
    const ex = p.id ? this.registerItems.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('register item not found.') : undefined
    if (ex && !this.canViewLevel(ex.confidentiality)) fail('you are not cleared to change this record.', '42501')
    const k = this.registerKinds.filter((x) => x.key === (p.kind ?? ex?.kind) && x.is_active).sort((a, b) => Number(b.group_id !== null) - Number(a.group_id !== null))[0] ?? fail(`unknown register kind ${p.kind ?? ex?.kind}.`)
    const missing = k.fields.filter((f) => f.required && blank((p.data ?? {})[f.key])).map((f) => f.label)
    if (missing.length) fail(`required information is missing — ${missing.join(', ')}.`)
    if (p.probability != null && (D(p.probability).lt(0) || D(p.probability).gt(100))) fail('probability must be between 0 and 100.')

    if (!ex) {
      const ref = `${k.prefix}-${String(this.nextSeq(`reg:${p.company_id}:${k.prefix}`)).padStart(5, '0')}`
      let unit = p.org_unit_id ?? null
      if (!unit && k.dimension_type && (p.create_dimension ?? true)) {
        unit = uid()
        this.orgUnits.push({ id: unit, company_id: p.company_id, type_key: k.dimension_type, parent_id: null, code: ref, name: p.title.trim(), status: 'active', confidentiality: p.confidentiality ?? 'internal', meta: {} })
      }
      const row: RegisterItem = {
        id: uid(), company_id: p.company_id, kind: k.key, ref_no: ref, title: p.title.trim(), party_id: p.party_id ?? null, org_unit_id: unit, account_id: p.account_id ?? null,
        direction: p.direction ?? k.direction, amount: money(p.amount).toString(), currency: p.currency ?? this.company(p.company_id).base_currency, frequency: p.frequency ?? 'once',
        start_date: p.start_date ?? null, end_date: p.end_date ?? null, next_due: p.next_due ?? p.start_date ?? null, total_value: p.total_value ?? null,
        certainty: p.certainty ?? k.default_certainty, state: p.state ?? 'active', auto_renew: p.auto_renew ?? false, renewal_date: p.renewal_date ?? null, cancel_by: p.cancel_by ?? null,
        escalation_pct: p.escalation_pct ?? null, escalation_date: p.escalation_date ?? null, escalation_months: p.escalation_months ?? null, probability: p.probability ?? null,
        owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null, confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, data: p.data ?? {},
        status: p.status ?? 'active', created_by: this.actor, created_at: this.now(), updated_at: this.now(),
      }
      this.registerItems.push(row)
      this.log(p.company_id, 'register_items', row.id, 'insert', null, row, null)
      return row.id
    }
    const old = { ...ex }
    Object.assign(ex, {
      title: p.title.trim(), party_id: p.party_id ?? null, org_unit_id: p.org_unit_id ?? ex.org_unit_id, account_id: p.account_id ?? null, direction: p.direction ?? ex.direction,
      amount: p.amount != null ? money(p.amount).toString() : ex.amount, currency: p.currency ?? ex.currency, frequency: p.frequency ?? ex.frequency, start_date: p.start_date ?? null,
      end_date: p.end_date ?? null, next_due: p.next_due ?? null, total_value: p.total_value ?? null, certainty: p.certainty ?? ex.certainty, state: p.state ?? ex.state,
      auto_renew: p.auto_renew ?? ex.auto_renew, renewal_date: p.renewal_date ?? null, cancel_by: p.cancel_by ?? null, escalation_pct: p.escalation_pct ?? null,
      escalation_date: p.escalation_date ?? null, escalation_months: p.escalation_months ?? null, probability: p.probability ?? null, owner_user: p.owner_user ?? null,
      owner_name: p.owner_name ?? null, confidentiality: p.confidentiality ?? ex.confidentiality, notes: p.notes ?? null, data: p.data ?? ex.data, status: p.status ?? ex.status, updated_at: this.now(),
    })
    this.log(p.company_id, 'register_items', ex.id, 'update', old, { ...ex }, p.reason ?? null)
    return ex.id
  }

  // ------------------------------------------------------------ tasks
  async listTasks(f: { companyIds: ID[]; entity?: string; entityId?: ID; openOnly?: boolean }) {
    return this.tasks
      .filter((t) => this.canViewLevel(t.entity && t.entity_id ? this.recordConfidentiality(t.entity, t.entity_id) : t.confidentiality ?? 'internal'))
      .filter((t) => f.companyIds.includes(t.company_id) && (!f.entity || t.entity === f.entity) && (!f.entityId || t.entity_id === f.entityId) && (!f.openOnly || t.status === 'open' || t.status === 'in_progress'))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  }
  /** A follow-up is as confidential as the record it is linked to. */
  protected recordConfidentiality(entity?: string | null, id?: ID | null): Confidentiality {
    if (!entity || !id) return 'internal'
    const lists: Record<string, { id: ID; confidentiality?: Confidentiality }[]> = {
      register_items: this.registerItems, documents: this.documents, journals: this.journals, invoices: this.invoices, fixed_assets: this.assets, purchase_docs: this.purchaseDocs,
      ...this.confidentialRecords(),
    }
    return lists[entity]?.find((x) => x.id === id)?.confidentiality ?? 'internal'
  }
  /** records of the layers above this one (advances, claims, loans, deposits, employees) */
  protected confidentialRecords(): Record<string, { id: ID; confidentiality?: Confidentiality }[]> { return {} }
  async saveTask(p: TaskInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.title)) fail('the task needs a title.')
    if (!p.id) {
      const t: Task = { id: uid(), company_id: p.company_id, entity: p.entity ?? null, entity_id: p.entity_id ?? null, title: p.title.trim(), detail: p.detail ?? null, due_date: p.due_date ?? null, owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null, priority: p.priority ?? 'normal', status: 'open', outcome: null, confidentiality: this.recordConfidentiality(p.entity, p.entity_id), created_by: this.actor, created_at: this.now() }
      this.tasks.push(t)
      this.log(p.company_id, 'tasks', t.id, 'insert', null, t, null)
      return t.id
    }
    const t = this.tasks.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('task not found.')
    if (t.status === 'done' || t.status === 'cancelled') fail(`this task is already ${t.status}.`)
    const status = p.status ?? t.status
    if ((status === 'done' || status === 'cancelled') && blank(p.outcome)) fail('record the outcome when closing a task.')
    const old = { ...t }
    Object.assign(t, { title: p.title.trim(), detail: p.detail ?? null, due_date: p.due_date ?? null, owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null, priority: p.priority ?? t.priority, status, outcome: p.outcome ?? null, completed_at: status === 'done' || status === 'cancelled' ? this.now() : null })
    this.log(p.company_id, 'tasks', t.id, 'update', old, { ...t }, null)
    return t.id
  }

  // ------------------------------------------------------------ document vault
  async listDocuments(f: { companyIds: ID[]; entity?: string; entityId?: ID; status?: DocumentRecord['status'][] }) {
    const linked = f.entity && f.entityId ? new Set(this.documentLinks.filter((l) => l.entity === f.entity && l.entity_id === f.entityId).map((l) => l.document_id)) : null
    return this.documents
      .filter((d) => f.companyIds.includes(d.company_id) && this.canViewLevel(d.confidentiality) && (!linked || linked.has(d.id)) && (!f.status?.length || f.status.includes(d.status)))
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
      .map((d) => ({ ...d, links: this.documentLinks.filter((l) => l.document_id === d.id) }))
  }
  async listDocumentLinks(documentIds: ID[]) { return this.documentLinks.filter((l) => documentIds.includes(l.document_id)) }
  /** the same registration the database performs, usable without a real file (sample data, tests) */
  registerDocument(p: { company_id: ID; name: string; mime?: string | null; size_bytes?: number; sha256: string; entity?: string; entity_id?: ID } & DocumentMeta, blob?: Blob): UploadResult {
    this.company(p.company_id)
    if (blank(p.name) || !/^[0-9a-f]{64}$/.test(p.sha256)) fail('a document needs a name and a valid fingerprint.')
    if (p.party_id) this.needParty(p.party_id, 'unknown party.')
    const dups = this.documents.filter((d) => d.company_id === p.company_id && d.sha256 === p.sha256).sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    const id = uid()
    const kind = p.doc_kind || 'unclassified'
    const doc: DocumentRecord = {
      id, company_id: p.company_id, name: p.name.trim(), mime: p.mime ?? null, size_bytes: p.size_bytes ?? 0, sha256: p.sha256, storage_path: `${p.company_id}/${id}-${p.name.trim()}`,
      doc_kind: kind, status: kind === 'unclassified' ? 'received' : 'classified', party_id: p.party_id ?? null, doc_date: p.doc_date ?? null, amount: p.amount ?? null, currency: p.currency ?? null,
      reference: p.reference || null, expires_on: p.expires_on ?? null, duplicate_of: dups[0]?.id ?? null, confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, origin: 'upload',
      uploaded_by: this.actor, uploaded_at: this.now(),
    }
    this.documents.push(doc)
    if (blob) this.blobs.set(id, blob)
    if (p.entity && p.entity_id) { this.documentLinks.push({ document_id: id, entity: p.entity, entity_id: p.entity_id, company_id: p.company_id, linked_at: this.now() }); doc.status = 'linked' }
    const possible = dups.map((d) => ({ id: d.id, name: d.name, uploaded_at: d.uploaded_at, reason: 'identical file content' }))
    if (dups.length) {
      this.raise(p.company_id, 'duplicate_document', 'review', 'POSSIBLE DUPLICATE — identical file already in the vault',
        `The file "${doc.name}" has exactly the same content as a document recorded earlier. It was kept, not discarded, and is flagged for human review.`,
        { document_id: id, matches: possible, rule: 'same company + identical SHA-256 fingerprint' }, 'documents', id, 'dupdoc:' + id)
    }
    this.log(p.company_id, 'documents', id, 'insert', null, { name: doc.name, doc_kind: doc.doc_kind, sha256: doc.sha256 }, null)
    return { id, possible_duplicates: possible }
  }
  async uploadDocument(companyId: ID, file: File, meta: DocumentMeta & { entity?: string; entity_id?: ID } = {}): Promise<UploadResult> {
    if (file.size > 25 * 1024 * 1024) fail('the file is larger than 25 MB.')
    const hash = await sha256Hex(await file.arrayBuffer())
    return this.registerDocument({ ...meta, company_id: companyId, name: file.name, mime: file.type || null, size_bytes: file.size, sha256: hash }, file)
  }
  async classifyDocument(id: ID, p: DocumentMeta) {
    const d = this.documents.find((x) => x.id === id) ?? fail('document not found.')
    if (p.party_id) this.needParty(p.party_id, 'unknown party.')
    const status = p.status ?? (d.status === 'received' ? 'classified' : d.status)
    if (status === 'rejected' && blank(p.notes)) fail('a note is required when rejecting a document.')
    const old = { ...d }
    const has = (k: keyof DocumentMeta) => Object.prototype.hasOwnProperty.call(p, k)
    Object.assign(d, {
      doc_kind: p.doc_kind || d.doc_kind, party_id: has('party_id') ? p.party_id ?? null : d.party_id, doc_date: has('doc_date') ? p.doc_date ?? null : d.doc_date,
      amount: has('amount') ? p.amount ?? null : d.amount, currency: has('currency') ? p.currency || null : d.currency, reference: has('reference') ? p.reference || null : d.reference,
      expires_on: has('expires_on') ? p.expires_on ?? null : d.expires_on, notes: has('notes') ? p.notes ?? null : d.notes, confidentiality: p.confidentiality ?? d.confidentiality, status,
    })
    this.log(d.company_id, 'documents', id, 'update', old, { ...d }, null)
  }
  async linkDocument(id: ID, entity: string, entityId: ID, remove = false) {
    const d = this.documents.find((x) => x.id === id) ?? fail('document not found.')
    if (blank(entity) || !entityId) fail('choose the record to link this document to.')
    if (remove) {
      this.documentLinks = this.documentLinks.filter((l) => !(l.document_id === id && l.entity === entity && l.entity_id === entityId))
      this.log(d.company_id, 'documents', id, 'unlinked', { entity, entity_id: entityId }, null, null)
      return
    }
    if (!this.documentLinks.some((l) => l.document_id === id && l.entity === entity && l.entity_id === entityId)) this.documentLinks.push({ document_id: id, entity, entity_id: entityId, company_id: d.company_id, linked_at: this.now() })
    if (d.status === 'received' || d.status === 'classified') d.status = 'linked'
    this.log(d.company_id, 'documents', id, 'linked', null, { entity, entity_id: entityId }, null)
  }
  async documentUrl(id: ID) {
    const b = this.blobs.get(id)
    return b && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null
  }

  // ------------------------------------------------------------ custom field values
  /** the sub-types a record belongs to; null when its record type has none known here, in which case every field applies */
  protected recordScopes(entity: string, id: ID): string[] | null {
    if (entity === 'register_items') { const r = this.registerItems.find((x) => x.id === id); return r ? [r.kind] : [] }
    if (entity === 'invoices' || entity === 'invoice' || entity === 'bill') { const i = this.invoices.find((x) => x.id === id); return i ? [i.doc_type] : [] }
    if (entity === 'party' || entity === 'parties') return [...new Set((this.parties.find((x) => x.id === id)?.roles ?? []).map((r) => r.type_key))]
    return null
  }
  async getCustomValues(entity: string, entityId: ID) { return { ...(this.customValues.get(entity + '|' + entityId) ?? {}) } }
  async saveCustomValues(companyId: ID, entity: string, entityId: ID, values: CustomValues) {
    const scopes = this.recordScopes(entity, entityId)
    const defs = this.customFields.filter((f) => f.entity === entity && f.status === 'active' && (f.company_id === null || f.company_id === companyId)
      && (!f.scope_key || scopes === null || scopes.includes(f.scope_key)))
    const missing = defs.filter((d) => d.is_required && blank(values[d.key])).map((d) => d.label)
    if (missing.length) fail(`required information is missing — ${missing.join(', ')}.`)
    const old = this.customValues.get(entity + '|' + entityId) ?? {}
    const next = { ...old }
    for (const d of defs) if (Object.prototype.hasOwnProperty.call(values, d.key)) next[d.key] = values[d.key]
    this.customValues.set(entity + '|' + entityId, next)
    this.log(companyId, 'custom_field_values', entityId, 'update', old, next, null)
  }

  // ------------------------------------------------------------ fixed assets
  async listAssetCategories(companyIds: ID[]) { return this.assetCategories.filter((c) => companyIds.includes(c.company_id)) }
  async saveAssetCategory(p: AssetCategoryInput): Promise<ID> {
    if (blank(p.name)) fail('the category needs a name.')
    for (const k of ['asset_account_id', 'accum_account_id', 'expense_account_id'] as const) this.postingAccount(p.company_id, p[k], 'choose active posting accounts of this company for the asset, accumulated depreciation and depreciation expense.')
    const method = p.method ?? 'slm'
    if (method === 'slm' && !(Number(p.life_months) > 0)) fail('straight-line depreciation needs a useful life in months.')
    if (method === 'wdv' && !D(p.wdv_rate).gt(0)) fail('written-down-value depreciation needs an annual rate.')
    const ex = p.id ? this.assetCategories.find((c) => c.id === p.id && c.company_id === p.company_id) ?? fail('category not found.') : undefined
    if (!ex && this.assetCategories.some((c) => c.company_id === p.company_id && c.name === p.name.trim())) fail('That record already exists (duplicate value).', '23505')
    const row: AssetCategory = { id: ex?.id ?? uid(), company_id: p.company_id, name: p.name.trim(), asset_account_id: p.asset_account_id, accum_account_id: p.accum_account_id, expense_account_id: p.expense_account_id, method, life_months: p.life_months ?? null, wdv_rate: p.wdv_rate ?? null, salvage_pct: p.salvage_pct ?? 0, is_active: p.is_active ?? ex?.is_active ?? true }
    if (ex) { const old = { ...ex }; Object.assign(ex, row); this.log(p.company_id, 'asset_categories', ex.id, 'update', old, row, null) }
    else { this.assetCategories.push(row); this.log(p.company_id, 'asset_categories', row.id, 'insert', null, row, null) }
    return row.id
  }
  async listAssets(companyIds: ID[]) { return this.assets.filter((a) => companyIds.includes(a.company_id) && this.canViewLevel(a.confidentiality)).sort((a, b) => a.asset_no.localeCompare(b.asset_no)) }
  async saveAsset(p: FixedAssetInput): Promise<ID> {
    if (blank(p.name)) fail('the asset needs a name.')
    const c = this.assetCategories.find((x) => x.id === p.category_id && x.company_id === p.company_id) ?? fail('choose an asset category of this company.')
    if (!p.acquisition_date) fail('the acquisition date is required.')
    this.needUnit(p.company_id, p.org_unit_id)
    if (p.custodian_party_id) this.needParty(p.custodian_party_id, 'unknown party.')
    if (p.vendor_party_id) this.needParty(p.vendor_party_id, 'unknown party.')
    const cost = money(p.cost)
    if (cost.lte(0)) fail('the cost must be greater than zero.')
    const salvage = p.salvage_value != null ? money(p.salvage_value) : round2(cost.times(c.salvage_pct).div(100))
    const method = p.method ?? c.method
    const life = p.life_months ?? c.life_months
    const rate = p.wdv_rate ?? c.wdv_rate
    const open = money(p.opening_accumulated)
    if (salvage.gte(cost)) fail('the residual value must be lower than the cost.')
    if (open.gt(cost.minus(salvage))) fail('opening accumulated depreciation exceeds the depreciable amount.')
    if (method === 'slm' && !(Number(life) > 0)) fail('straight-line depreciation needs a useful life in months.')
    if (method === 'wdv' && !D(rate).gt(0)) fail('written-down-value depreciation needs an annual rate.')

    if (!p.id) {
      const no = this.docNo(p.company_id, 'fixed_asset', 'FA', p.acquisition_date)
      const a: FixedAsset = {
        id: uid(), company_id: p.company_id, asset_no: no, name: p.name.trim(), category_id: c.id, description: p.description ?? null, acquisition_date: p.acquisition_date,
        in_service_date: p.in_service_date ?? p.acquisition_date, cost: cost.toString(), salvage_value: salvage.toString(), method, life_months: life ?? null, wdv_rate: rate ?? null,
        opening_accumulated: open.toString(), accumulated_depreciation: open.toString(), impairment: '0', org_unit_id: p.org_unit_id ?? null, custodian_party_id: p.custodian_party_id ?? null,
        location: p.location ?? null, serial_no: p.serial_no ?? null, tag_code: p.tag_code || 'NUMERO-ASSET:' + no, vendor_party_id: p.vendor_party_id ?? null, source_invoice_id: p.source_invoice_id ?? null,
        warranty_until: p.warranty_until ?? null, status: 'active', disposed_on: null, disposal_proceeds: null, disposal_journal_id: null, confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null,
        created_by: this.actor, created_at: this.now(),
      }
      this.assets.push(a)
      this.log(p.company_id, 'fixed_assets', a.id, 'insert', null, a, null)
      return a.id
    }
    const a = this.assets.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('asset not found.')
    if (a.status !== 'active') fail(`this asset is ${a.status} and can no longer be edited.`)
    const depreciated = this.depLines.some((l) => l.asset_id === a.id && ['proposed', 'posted'].includes(this.depRuns.find((r) => r.id === l.run_id)?.status ?? ''))
    const inService = p.in_service_date ?? a.in_service_date
    if (depreciated && (!cost.eq(a.cost) || !salvage.eq(a.salvage_value) || method !== a.method || Number(life ?? 0) !== Number(a.life_months ?? 0) || !D(rate).eq(D(a.wdv_rate)) || !open.eq(a.opening_accumulated) || c.id !== a.category_id || p.acquisition_date !== a.acquisition_date || inService !== a.in_service_date)) {
      fail('depreciation has already been recorded for this asset. Its cost, dates, category and method can no longer be changed.')
    }
    const old = { ...a }
    Object.assign(a, {
      name: p.name.trim(), category_id: c.id, description: p.description ?? null, acquisition_date: p.acquisition_date, in_service_date: inService, cost: cost.toString(), salvage_value: salvage.toString(),
      method, life_months: life ?? null, wdv_rate: rate ?? null, opening_accumulated: open.toString(), accumulated_depreciation: D(a.accumulated_depreciation).minus(a.opening_accumulated).plus(open).toString(),
      org_unit_id: p.org_unit_id ?? null, custodian_party_id: p.custodian_party_id ?? null, location: p.location ?? null, serial_no: p.serial_no ?? null, tag_code: p.tag_code || a.tag_code,
      vendor_party_id: p.vendor_party_id ?? null, source_invoice_id: p.source_invoice_id ?? null, warranty_until: p.warranty_until ?? null, confidentiality: p.confidentiality ?? a.confidentiality, notes: p.notes ?? null,
    })
    this.log(p.company_id, 'fixed_assets', a.id, 'update', old, { ...a }, null)
    return a.id
  }
  async listAssetEvents(assetId: ID) { return this.assetEvents.filter((e) => e.asset_id === assetId).sort((a, b) => b.event_date.localeCompare(a.event_date) || b.created_at.localeCompare(a.created_at)) }
  async recordAssetEvent(p: AssetEventInput): Promise<ID> {
    const a = this.assets.find((x) => x.id === p.asset_id) ?? fail('asset not found.')
    if (!['assignment', 'transfer', 'maintenance', 'verification', 'note'].includes(p.event_type)) fail('unknown asset event.')
    if (!p.event_date) fail('the event date is required.')
    let d: Record<string, unknown> = { ...(p.detail ?? {}) }
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k)
    let result: string | undefined
    if (p.event_type === 'assignment' || p.event_type === 'transfer') {
      if (d.custodian_party_id) this.needParty(d.custodian_party_id as ID, 'unknown party.')
      this.needUnit(a.company_id, d.org_unit_id as ID | undefined)
      d = { ...d, from: { custodian_party_id: a.custodian_party_id, org_unit_id: a.org_unit_id, location: a.location } }
      if (has('custodian_party_id')) a.custodian_party_id = (d.custodian_party_id as ID) ?? null
      if (has('org_unit_id')) a.org_unit_id = (d.org_unit_id as ID) ?? null
      if (has('location')) a.location = (d.location as string) ?? null
    } else if (p.event_type === 'verification') {
      result = d.result as string
      if (!['located', 'transferred', 'damaged', 'missing', 'disposed'].includes(result)) fail('the verification result must be located, transferred, damaged, missing or disposed.')
    }
    const ev: AssetEvent = { id: uid(), asset_id: a.id, company_id: a.company_id, event_type: p.event_type, event_date: p.event_date, amount: p.amount ?? null, status: 'recorded', detail: d, journal_id: null, created_by: this.actor, created_at: this.now() }
    this.assetEvents.push(ev)
    if (result && ['missing', 'damaged', 'disposed'].includes(result) && a.status === 'active') {
      this.raise(a.company_id, 'asset_verification', result === 'missing' ? 'priority' : 'review', `ASSET VERIFICATION — ${a.asset_no} reported ${result}`,
        `Physical verification on ${p.event_date} reported asset ${a.asset_no} (${a.name}) as ${result}, while the register shows it as active with a book value of ${D(a.cost).minus(a.accumulated_depreciation)}. The books have not been changed.`,
        { asset_id: a.id, event_id: ev.id, result, rule: 'verification result differs from register status' }, 'fixed_assets', a.id, 'assetverify:' + ev.id)
    }
    this.log(a.company_id, 'asset_events', ev.id, 'insert', null, ev, null)
    return ev.id
  }

  async listDepreciationRuns(companyIds: ID[]) { return this.depRuns.filter((r) => companyIds.includes(r.company_id)).sort((a, b) => b.period_month.localeCompare(a.period_month) || b.created_at.localeCompare(a.created_at)) }
  async getDepreciationLines(f: { runId?: ID; assetId?: ID }) { return this.depLines.filter((l) => (!f.runId || l.run_id === f.runId) && (!f.assetId || l.asset_id === f.assetId)) }
  /** Calculates one month of depreciation for every asset in service. Nothing is posted here. */
  async createDepreciationRun(companyId: ID, month: string): Promise<ID> {
    if (!month) fail('choose the month to depreciate.')
    const start = startOfMonth(month), end = endOfMonth(month)
    this.assertPeriodOpen(companyId, end)
    const live = (r: DepreciationRun) => r.company_id === companyId
    if (this.depRuns.some((r) => live(r) && r.period_month === start && ['draft', 'proposed', 'posted'].includes(r.status))) fail(`a depreciation run for ${mon(start)} already exists.`)
    const pending = this.depRuns.filter((r) => live(r) && ['draft', 'proposed'].includes(r.status) && r.period_month < start).map((r) => r.period_month).sort()[0]
    if (pending) fail(`the depreciation run for ${mon(pending)} is not posted yet. Finish or cancel it first so that book values are correct.`)
    if (this.depRuns.some((r) => live(r) && ['proposed', 'posted'].includes(r.status) && r.period_month > start)) fail('a later month has already been depreciated. Months must be run in order.')
    const days = daysBetween(start, end) + 1
    const run: DepreciationRun = { id: uid(), company_id: companyId, period_month: start, status: 'draft', total: '0', asset_count: 0, journal_id: null, created_by: this.actor, created_at: this.now() }
    let total = ZERO, n = 0
    for (const a of this.assets.filter((x) => x.company_id === companyId && x.status === 'active' && x.method !== 'none' && (x.in_service_date ?? x.acquisition_date) <= end).sort((x, y) => x.asset_no.localeCompare(y.asset_no))) {
      const left = D(a.cost).minus(a.salvage_value).minus(a.accumulated_depreciation)
      if (left.lte(0)) continue
      const inService = a.in_service_date ?? a.acquisition_date
      const factor = inService > start ? D(daysBetween(inService, end) + 1).div(days) : D(1)
      const part = factor.lt(1) ? ` × ${factor.toDecimalPlaces(4)} (part month)` : ''
      let amt: Decimal, basis: string
      if (a.method === 'slm') {
        amt = D(a.cost).minus(a.salvage_value).div(a.life_months!).times(factor)
        basis = `Straight line: (${D(a.cost)} − ${D(a.salvage_value)}) ÷ ${a.life_months} months${part}`
      } else {
        amt = D(a.cost).minus(a.accumulated_depreciation).times(D(a.wdv_rate)).div(100).div(12).times(factor)
        basis = `Written down value: ${D(a.cost).minus(a.accumulated_depreciation)} × ${D(a.wdv_rate)}% ÷ 12${part}`
      }
      amt = round2(Decimal.min(amt, left))
      if (amt.lte(0)) continue
      this.depLines.push({ id: uid(), run_id: run.id, company_id: companyId, asset_id: a.id, amount: amt.toString(), opening_book_value: D(a.cost).minus(a.accumulated_depreciation).toString(), method: a.method, basis })
      total = total.plus(amt); n++
    }
    run.total = total.toString(); run.asset_count = n
    this.depRuns.push(run)
    this.log(companyId, 'depreciation_runs', run.id, 'calculated', null, { month: start, assets: n, total: run.total }, null)
    return run.id
  }
  async proposeDepreciationRun(runId: ID): Promise<ID> {
    const r = this.depRuns.find((x) => x.id === runId) ?? fail('depreciation run not found.')
    if (r.status !== 'draft') fail(`this run is ${r.status}.`)
    if (D(r.total).lte(0)) fail('there is nothing to depreciate in this month.')
    const dr = new Map<string, { account: ID; unit: ID | null; amount: Decimal; n: number }>()
    const cr = new Map<ID, Decimal>()
    for (const l of this.depLines.filter((x) => x.run_id === runId)) {
      const a = this.assets.find((x) => x.id === l.asset_id)!
      const c = this.assetCategories.find((x) => x.id === a.category_id)!
      const k = `${c.expense_account_id}|${c.accum_account_id}|${a.org_unit_id ?? ''}`
      const cur = dr.get(k) ?? { account: c.expense_account_id, unit: a.org_unit_id, amount: ZERO, n: 0 }
      cur.amount = cur.amount.plus(l.amount); cur.n++
      dr.set(k, cur)
      cr.set(c.accum_account_id, (cr.get(c.accum_account_id) ?? ZERO).plus(l.amount))
    }
    const lines: JournalLineInput[] = [
      ...[...dr.values()].map((g) => ({ account_id: g.account, debit: g.amount.toString(), description: `Depreciation ${mon(r.period_month)} · ${g.n} asset(s)`, dims: this.dimOf(g.unit) })),
      ...[...cr.entries()].map(([account, amount]) => ({ account_id: account, credit: amount.toString(), description: `Accumulated depreciation ${mon(r.period_month)}` })),
    ]
    const j = this.proposePosting(r.company_id, 'depreciation', endOfMonth(r.period_month), `Depreciation for ${mon(r.period_month)}`, 'depreciation', r.id, lines, { month: r.period_month, total: r.total })
    r.status = 'proposed'; r.journal_id = j
    return j
  }
  async cancelDepreciationRun(runId: ID) {
    const r = this.depRuns.find((x) => x.id === runId) ?? fail('depreciation run not found.')
    if (r.status !== 'draft') fail('only a draft run can be cancelled. Reject or reverse its journal instead.')
    r.status = 'cancelled'
    this.log(r.company_id, 'depreciation_runs', r.id, 'cancelled', null, null, null)
  }
  protected wfDepreciation(w: WorkflowPosting, event: WfEvent) {
    const r = this.depRuns.find((x) => x.id === w.source_id)!
    const lines = this.depLines.filter((l) => l.run_id === r.id)
    const apply = (sign: 1 | -1) => lines.forEach((l) => { const a = this.assets.find((x) => x.id === l.asset_id)!; a.accumulated_depreciation = Decimal.max(D(a.accumulated_depreciation).plus(D(l.amount).times(sign)), 0).toString() })
    if (event === 'posted') { apply(1); r.status = 'posted' }
    else if (event === 'voided') { r.status = 'draft'; r.journal_id = null }
    else {
      if (this.depRuns.some((x) => x.company_id === r.company_id && ['proposed', 'posted'].includes(x.status) && x.period_month > r.period_month)) fail('later months have been depreciated. Reverse the most recent month first.')
      apply(-1); r.status = 'reversed'
    }
  }

  async proposeAssetDisposal(p: AssetDisposalInput): Promise<ID> {
    const a = this.assets.find((x) => x.id === p.asset_id) ?? fail('asset not found.')
    if (a.status !== 'active') fail(`this asset is already ${a.status}.`)
    const kind = p.kind ?? 'sale'
    if (!['sale', 'scrap', 'write_off'].includes(kind)) fail('unknown disposal type.')
    if (!p.date || p.date < a.acquisition_date) fail('the disposal date is missing or before acquisition.')
    if (blank(p.reason)) fail('a reason is required.')
    const proceeds = money(p.proceeds)
    if (proceeds.lt(0)) fail('proceeds cannot be negative.')
    if (kind !== 'sale' && proceeds.gt(0)) fail('proceeds are recorded only for a sale.')
    const c = this.assetCategories.find((x) => x.id === a.category_id)!
    const lines: JournalLineInput[] = []
    if (proceeds.gt(0)) {
      const bank = this.bankLedger(a.company_id, p.bank_ledger_id, 'choose the bank or cash ledger that received the proceeds.')
      lines.push({ account_id: bank.id, debit: proceeds.toString(), party_id: p.party_id ?? null, description: `Proceeds — ${a.asset_no} ${a.name}` })
    }
    if (D(a.accumulated_depreciation).gt(0)) lines.push({ account_id: c.accum_account_id, debit: a.accumulated_depreciation, description: `Accumulated depreciation released — ${a.asset_no}` })
    const diff = D(a.cost).minus(a.accumulated_depreciation).minus(proceeds) // positive = loss
    if (!diff.isZero()) lines.push({ account_id: this.mapAccount(a.company_id, 'asset_disposal'), [diff.gt(0) ? 'debit' : 'credit']: diff.abs().toString(), description: `${diff.gt(0) ? 'Loss on' : 'Gain on'} ${kind} — ${a.asset_no}` })
    lines.push({ account_id: c.asset_account_id, credit: a.cost, description: `Asset removed from books — ${a.asset_no} ${a.name}` })
    const ev: AssetEvent = { id: uid(), asset_id: a.id, company_id: a.company_id, event_type: 'disposal', event_date: p.date, amount: proceeds.toString(), status: 'proposed', detail: { kind, reason: p.reason, book_value: D(a.cost).minus(a.accumulated_depreciation).toString(), gain_or_loss: diff.neg().toString(), buyer_party_id: p.party_id ?? null }, journal_id: null, created_by: this.actor, created_at: this.now() }
    const label = kind.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase())
    const j = this.proposePosting(a.company_id, 'journal', p.date, `${label} of asset ${a.asset_no} · ${a.name} — ${p.reason}`, 'asset_disposal', a.id, lines, { event_id: ev.id, kind, proceeds: proceeds.toString(), date: p.date }, a.confidentiality)
    ev.journal_id = j
    this.assetEvents.push(ev)
    return j
  }
  protected wfAssetDisposal(w: WorkflowPosting, event: WfEvent) {
    const a = this.assets.find((x) => x.id === w.source_id)!
    const ev = this.assetEvents.find((x) => x.id === w.payload.event_id)
    if (event === 'posted') {
      Object.assign(a, { status: w.payload.kind === 'write_off' ? 'written_off' : 'disposed', disposed_on: w.payload.date, disposal_proceeds: w.payload.proceeds, disposal_journal_id: w.journal_id })
      if (ev) ev.status = 'posted'
    } else if (event === 'voided') { if (ev) ev.status = 'rejected' }
    else { Object.assign(a, { status: 'active', disposed_on: null, disposal_proceeds: null, disposal_journal_id: null }); if (ev) ev.status = 'reversed' }
  }
  async proposeAssetImpairment(p: AssetImpairmentInput): Promise<ID> {
    const a = this.assets.find((x) => x.id === p.asset_id) ?? fail('asset not found.')
    if (a.status !== 'active') fail(`this asset is ${a.status}.`)
    if (!p.date) fail('a date is required.')
    if (blank(p.reason)) fail('the basis of the impairment must be recorded.')
    const amt = money(p.amount)
    const room = D(a.cost).minus(a.salvage_value).minus(a.accumulated_depreciation)
    if (amt.lte(0) || amt.gt(room)) fail(`the impairment must be greater than zero and cannot exceed the remaining depreciable value of ${room}.`)
    const c = this.assetCategories.find((x) => x.id === a.category_id)!
    const loss = this.mapAccount(a.company_id, 'asset_impairment')
    const ev: AssetEvent = { id: uid(), asset_id: a.id, company_id: a.company_id, event_type: 'impairment', event_date: p.date, amount: amt.toString(), status: 'proposed', detail: { reason: p.reason, assessed_by: p.assessed_by ?? null }, journal_id: null, created_by: this.actor, created_at: this.now() }
    const j = this.proposePosting(a.company_id, 'adjustment', p.date, `Impairment of asset ${a.asset_no} · ${a.name} — ${p.reason}`, 'asset_impairment', a.id, [
      { account_id: loss, debit: amt.toString(), description: `Impairment loss — ${a.asset_no}` },
      { account_id: c.accum_account_id, credit: amt.toString(), description: `Accumulated impairment — ${a.asset_no}` },
    ], { event_id: ev.id, amount: amt.toString() }, a.confidentiality)
    ev.journal_id = j
    this.assetEvents.push(ev)
    return j
  }
  protected wfAssetImpairment(w: WorkflowPosting, event: WfEvent) {
    const a = this.assets.find((x) => x.id === w.source_id)!
    const ev = this.assetEvents.find((x) => x.id === w.payload.event_id)
    const amt = D(w.payload.amount as Num)
    if (event === 'posted') { a.accumulated_depreciation = D(a.accumulated_depreciation).plus(amt).toString(); a.impairment = D(a.impairment).plus(amt).toString(); if (ev) ev.status = 'posted' }
    else if (event === 'voided') { if (ev) ev.status = 'rejected' }
    else { a.accumulated_depreciation = Decimal.max(D(a.accumulated_depreciation).minus(amt), 0).toString(); a.impairment = Decimal.max(D(a.impairment).minus(amt), 0).toString(); if (ev) ev.status = 'reversed' }
  }

  // ------------------------------------------------------------ purchase-to-pay
  protected pdoc(id: ID) { return this.purchaseDocs.find((d) => d.id === id) ?? fail('document not found.') }
  protected plines(docId: ID) { return this.purchaseLines.filter((l) => l.doc_id === docId).sort((a, b) => a.line_no - b.line_no) }
  protected receivedQty(poLineId: ID, exceptDoc?: ID) {
    return sum(this.purchaseLines.filter((l) => l.source_line_id === poLineId && l.doc_id !== exceptDoc && this.purchaseDocs.find((d) => d.id === l.doc_id)?.status === 'confirmed').map((l) => l.quantity))
  }
  async listPurchaseDocs(f: { companyIds: ID[]; kinds?: PurchaseKind[]; partyId?: ID; parentId?: ID }) {
    return this.purchaseDocs
      .filter((d) => f.companyIds.includes(d.company_id) && (!f.kinds?.length || f.kinds.includes(d.kind)) && (!f.partyId || d.party_id === f.partyId) && (!f.parentId || d.parent_id === f.parentId) && this.canViewLevel(d.confidentiality))
      .sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.doc_no.localeCompare(a.doc_no))
  }
  async getPurchaseDoc(id: ID) { const d = this.pdoc(id); return { ...d, lines: this.plines(id) } }
  async getPurchaseChain(id: ID) {
    let root = this.pdoc(id)
    while (root.parent_id) root = this.pdoc(root.parent_id)
    const out: PurchaseDoc[] = []
    const walk = (d: PurchaseDoc) => { out.push({ ...d, lines: this.plines(d.id) }); this.purchaseDocs.filter((c) => c.parent_id === d.id).sort((a, b) => a.doc_date.localeCompare(b.doc_date)).forEach(walk) }
    walk(root)
    return out
  }
  async savePurchaseDoc(p: PurchaseDocInput): Promise<ID> {
    const c = this.company(p.company_id)
    const kind = p.kind
    if (!['requisition', 'rfq', 'quotation', 'purchase_order', 'goods_receipt', 'service_receipt'].includes(kind)) fail('unknown purchasing document.')
    if (!p.doc_date) fail('the document date is required.')
    const receipt = kind === 'goods_receipt' || kind === 'service_receipt'
    if ((kind === 'quotation' || kind === 'purchase_order') && !p.party_id) fail('a vendor is required.')
    if (p.party_id) {
      const v = this.needParty(p.party_id, 'unknown vendor.')
      if (kind === 'purchase_order' && ['blocked', 'suspended', 'terminated'].includes(v.status)) fail('this vendor is blocked, suspended or terminated. New orders are not permitted.')
    }
    if (kind === 'requisition' && blank(p.reason)) fail('a requisition needs the reason for the purchase.')
    let par: PurchaseDoc | undefined
    if (p.parent_id) {
      par = this.purchaseDocs.find((d) => d.id === p.parent_id && d.company_id === p.company_id) ?? fail('the linked document was not found.')
      if (receipt) { if (par.kind !== 'purchase_order' || !['approved', 'partially_received'].includes(par.status)) fail('a receipt can be recorded only against an approved purchase order that is still open.') }
      else if (kind === 'quotation' && par.kind !== 'rfq') fail('a vendor quotation links to a request for quotation.')
      else if (kind === 'rfq' && par.kind !== 'requisition') fail('a request for quotation links to a requisition.')
      else if (kind === 'purchase_order' && !['requisition', 'quotation'].includes(par.kind)) fail('a purchase order links to a requisition or to the selected quotation.')
      if (kind === 'purchase_order' && par.kind === 'requisition' && !['approved', 'ordered'].includes(par.status)) fail('the requisition has not been approved.')
      if (kind === 'purchase_order' && par.kind === 'quotation' && par.status !== 'selected') fail('only the quotation selected by an authorised person can become a purchase order.')
    } else if (receipt) fail('a receipt must reference its purchase order.')
    if (!p.lines?.length) fail('the document needs at least one line.')

    const ex = p.id ? this.purchaseDocs.find((d) => d.id === p.id && d.company_id === p.company_id && d.kind === kind) ?? fail('document not found.') : undefined
    if (ex && !['draft', 'rejected'].includes(ex.status)) fail(`only drafts can be edited. This document is ${ex.status}.`)
    const docId = ex?.id ?? uid()

    // validate and price every line before anything is stored
    let sub = ZERO, tax = ZERO
    const rows: PurchaseLine[] = p.lines.map((l, i) => {
      const no = i + 1
      if (blank(l.description)) fail(`line ${no} needs a description.`)
      const qty = D(l.quantity ?? 1)
      if (qty.lte(0)) fail(`line ${no} quantity must be greater than zero.`)
      let rate = D(l.rate ?? 0)
      let src: PurchaseLine | undefined
      if (receipt) {
        src = this.purchaseLines.find((x) => x.id === l.source_line_id && x.doc_id === par!.id) ?? fail(`line ${no} does not reference a line of the purchase order.`)
        const done = this.receivedQty(src.id, docId)
        if (done.plus(qty).gt(src.quantity)) fail(`line ${no} — receiving ${qty} would exceed the ordered quantity of ${D(src.quantity)} (already received ${done}). Amend the purchase order instead.`)
        rate = D(src.rate)
      }
      const accountId = l.account_id ?? src?.account_id ?? null
      if (accountId) { const a = this.account(accountId); if (!a || a.company_id !== p.company_id || a.is_group) fail(`line ${no} needs a valid posting account of this company.`) }
      else if (kind === 'purchase_order') fail(`line ${no} of a purchase order needs the ledger the cost will be charged to.`)
      this.needDims(p.company_id, l.dims, `line ${no} references a dimension outside this company.`)
      const amount = round2(qty.times(rate))
      const taxCode = l.tax_code_id ?? src?.tax_code_id ?? null
      const t = sum(this.taxFor(taxCode, amount, p.doc_date).map((x) => x.tax))
      sub = sub.plus(amount); tax = tax.plus(t)
      return { id: uid(), doc_id: docId, company_id: p.company_id, line_no: no, description: l.description.trim(), account_id: accountId, quantity: qty.toString(), unit: l.unit ?? src?.unit ?? null, rate: rate.toString(), amount: amount.toString(), tax_code_id: taxCode, tax_amount: t.toString(), source_line_id: l.source_line_id ?? null, condition: l.condition ?? null, dims: l.dims ?? src?.dims ?? {} }
    })

    let d: PurchaseDoc
    if (ex) {
      d = ex
      Object.assign(d, { status: 'draft', doc_date: p.doc_date, party_id: p.party_id ?? null, parent_id: p.parent_id ?? null, title: p.title ?? null, currency: p.currency ?? d.currency, fx_rate: p.fx_rate ?? 1, required_date: p.required_date ?? null, valid_until: p.valid_until ?? null, delivery_terms: p.delivery_terms ?? null, payment_terms: p.payment_terms ?? null, warranty: p.warranty ?? null, reason: p.reason ?? null, dims: p.dims ?? {}, meta: p.meta ?? {}, confidentiality: p.confidentiality ?? d.confidentiality })
      this.purchaseLines = this.purchaseLines.filter((l) => l.doc_id !== d.id)
    } else {
      const prefix = { requisition: 'PR', rfq: 'RFQ', quotation: 'VQ', purchase_order: 'PO', goods_receipt: 'GRN', service_receipt: 'SRN' }[kind]
      d = {
        id: docId, company_id: p.company_id, kind, doc_no: this.docNo(p.company_id, kind, prefix, p.doc_date), doc_date: p.doc_date, party_id: p.party_id ?? (receipt ? par!.party_id : null), parent_id: p.parent_id ?? null,
        title: p.title ?? null, status: 'draft', currency: p.currency ?? par?.currency ?? c.base_currency, fx_rate: p.fx_rate ?? par?.fx_rate ?? 1, subtotal: '0', tax_total: '0', total: '0',
        required_date: p.required_date ?? null, valid_until: p.valid_until ?? null, delivery_terms: p.delivery_terms ?? null, payment_terms: p.payment_terms ?? null, warranty: p.warranty ?? null, reason: p.reason ?? null,
        decision_note: null, dims: p.dims ?? {}, meta: p.meta ?? {}, confidentiality: p.confidentiality ?? 'internal', created_by: this.actor, created_at: this.now(),
      }
      this.purchaseDocs.push(d)
    }
    this.purchaseLines.push(...rows)
    d.subtotal = sub.toString(); d.tax_total = tax.toString(); d.total = sub.plus(tax).toString()
    this.log(p.company_id, 'purchase_docs', d.id, 'draft_saved', null, { kind, lines: rows.length, total: d.total }, null)
    return d.id
  }
  protected refreshPoReceiptStatus(poId: ID) {
    const po = this.pdoc(poId)
    if (!['approved', 'partially_received', 'fully_received'].includes(po.status)) return
    const ls = this.plines(poId)
    const open = ls.filter((l) => this.receivedQty(l.id).lt(l.quantity)).length
    const any = ls.filter((l) => this.receivedQty(l.id).gt(0)).length
    po.status = open === 0 ? 'fully_received' : any > 0 ? 'partially_received' : 'approved'
  }
  async submitPurchaseDoc(id: ID): Promise<string> {
    const d = this.pdoc(id)
    if (d.status !== 'draft') fail(`only a draft can be submitted. This document is ${d.status}.`)
    let next: PurchaseDoc['status']
    if (d.kind === 'requisition' || d.kind === 'purchase_order') {
      this.openRequest(d.company_id, d.kind, d.id, round2(D(d.total).times(d.fx_rate)).toString(), d.doc_no + (d.title ? ' · ' + d.title : ''))
      next = 'submitted'
    } else if (d.kind === 'rfq') next = 'sent'
    else if (d.kind === 'quotation') next = 'received'
    else next = 'confirmed'
    const old = d.status
    d.status = next
    if (d.kind === 'goods_receipt' || d.kind === 'service_receipt') this.refreshPoReceiptStatus(d.parent_id!)
    this.log(d.company_id, 'purchase_docs', id, next, { status: old }, { status: next, doc_no: d.doc_no }, null)
    return next
  }
  async approvePurchaseDoc(id: ID, comment?: string): Promise<'approved' | 'pending'> {
    const d = this.pdoc(id)
    if (!['requisition', 'purchase_order'].includes(d.kind) || d.status !== 'submitted') fail('this document is not awaiting approval.')
    const res = this.decideRequest(d.kind, d.id, d.created_by, d.kind.replace('_', ' '), comment)
    if (res === 'approved') {
      d.status = 'approved'; d.approved_by = this.actor; d.approved_at = this.now()
      if (d.kind === 'purchase_order' && d.parent_id) {
        const par = this.pdoc(d.parent_id)
        if (par.kind === 'requisition' && par.status === 'approved') par.status = 'ordered'
        if (par.kind === 'quotation' && par.parent_id) {
          const rfq = this.pdoc(par.parent_id)
          const req = rfq.parent_id ? this.pdoc(rfq.parent_id) : undefined
          if (req && req.kind === 'requisition' && req.status === 'approved') req.status = 'ordered'
        }
      }
      this.log(d.company_id, 'purchase_docs', id, 'approved', null, { doc_no: d.doc_no, total: d.total, note: d.kind === 'purchase_order' ? 'Purchase order approved — the amount is now a COMMITMENT, not a cost.' : undefined }, comment ?? null)
    } else this.log(d.company_id, 'purchase_docs', id, 'approval_step', null, null, comment ?? null)
    return res
  }
  async rejectPurchaseDoc(id: ID, comment: string) {
    const d = this.pdoc(id)
    if (!['requisition', 'purchase_order'].includes(d.kind) || d.status !== 'submitted') fail('this document is not awaiting approval.')
    this.refuseRequest(d.kind, d.id, d.kind.replace('_', ' '), comment)
    d.status = 'rejected'; d.decision_note = comment
    this.log(d.company_id, 'purchase_docs', id, 'rejected', null, null, comment)
  }
  /** A person chooses the vendor. NUMERO shows the comparison; it never chooses. */
  async selectQuotation(id: ID, reason: string) {
    const d = this.purchaseDocs.find((x) => x.id === id && x.kind === 'quotation') ?? fail('quotation not found.')
    if (d.status !== 'received') fail(`this quotation is ${d.status} and cannot be selected.`)
    if (d.valid_until && d.valid_until < today()) fail(`this quotation expired on ${d.valid_until}.`)
    if (blank(reason)) fail('record why this vendor was selected.')
    this.makerChecker(d.created_by, 'quotation')
    const peers = d.parent_id ? this.purchaseDocs.filter((q) => q.kind === 'quotation' && q.parent_id === d.parent_id && q.company_id === d.company_id && ['received', 'selected'].includes(q.status)) : []
    const lowest = peers.length ? Decimal.min(...peers.map((q) => D(q.total).times(q.fx_rate))) : null
    d.status = 'selected'; d.decision_note = reason; d.approved_by = this.actor; d.approved_at = this.now()
    if (d.parent_id) {
      this.purchaseDocs.forEach((q) => { if (q.kind === 'quotation' && q.parent_id === d.parent_id && q.id !== id && q.status === 'received') q.status = 'not_selected' })
      const rfq = this.pdoc(d.parent_id)
      if (rfq.kind === 'rfq') rfq.status = 'closed'
    }
    this.log(d.company_id, 'purchase_docs', id, 'vendor_selected', null, { doc_no: d.doc_no, total: d.total, lowest_quote: lowest?.toString() ?? null, was_lowest: !lowest || D(d.total).times(d.fx_rate).lte(lowest) }, reason)
  }
  async cancelPurchaseDoc(id: ID, reason: string) {
    const d = this.pdoc(id)
    if (blank(reason)) fail('a reason is required.')
    if (d.status === 'cancelled' || d.status === 'closed') fail(`this document is already ${d.status}.`)
    const billed = (poId: ID | null) => this.invoices.some((i) => i.po_id === poId && !['draft', 'cancelled'].includes(i.status))
    const receipt = d.kind === 'goods_receipt' || d.kind === 'service_receipt'
    if (receipt && d.status === 'confirmed' && billed(d.parent_id)) fail('a bill has been recorded against this order. The receipt can no longer be cancelled.')
    let next: PurchaseDoc['status'] = 'cancelled'
    if (d.kind === 'purchase_order') {
      if (billed(d.id)) next = 'closed' // short-closed: what was billed stays, the rest of the commitment is released
      else if (this.purchaseDocs.some((r) => r.parent_id === d.id && r.status === 'confirmed')) fail('goods or services have been received against this order. Cancel the receipts first, or record the bill and close the order.')
    }
    this.cancelRequests(d.kind, d.id)
    const old = d.status
    d.status = next; d.decision_note = reason
    if (receipt) this.refreshPoReceiptStatus(d.parent_id!)
    this.log(d.company_id, 'purchase_docs', id, next, { status: old }, { status: next }, reason)
  }
  async linkBillToPo(invoiceId: ID, poId: ID | null, map?: Record<ID, ID>) {
    const inv = this.invoices.find((i) => i.id === invoiceId && i.doc_type === 'purchase_bill') ?? fail('purchase bill not found.')
    if (inv.status === 'cancelled') fail('this bill is cancelled.')
    const ils = this.invoiceLines.filter((l) => l.invoice_id === invoiceId)
    if (!poId) {
      ils.forEach((l) => { l.po_line_id = null })
      this.log(inv.company_id, 'invoices', invoiceId, 'po_unlinked', { po_id: inv.po_id ?? null }, null, null)
      inv.po_id = null
      return
    }
    const po = this.purchaseDocs.find((d) => d.id === poId && d.kind === 'purchase_order' && d.company_id === inv.company_id) ?? fail('purchase order not found in this company.')
    if (po.party_id !== inv.party_id) fail('the bill and the purchase order belong to different vendors.')
    if (!['approved', 'partially_received', 'fully_received', 'billed'].includes(po.status)) fail(`the purchase order is ${po.status} and cannot take a bill.`)
    const pls = this.plines(poId)
    if (map && Object.keys(map).length) {
      for (const v of Object.values(map)) if (v && !pls.some((l) => l.id === v)) fail('a bill line is mapped to a line that is not on this purchase order.')
    }
    inv.po_id = poId
    ils.forEach((l) => { l.po_line_id = map && Object.keys(map).length ? map[l.id] || null : pls.find((x) => x.line_no === l.line_no)?.id ?? null })
    this.log(inv.company_id, 'invoices', invoiceId, 'po_linked', null, { po_id: poId, po_no: po.doc_no }, null)
    if (inv.status !== 'draft') this.checkBillAgainstPo(invoiceId)
  }
  /** Factual comparison raised for human review. It never blocks and never concludes. */
  protected checkBillAgainstPo(invoiceId: ID) {
    const inv = this.invoices.find((i) => i.id === invoiceId)
    if (!inv?.po_id || inv.status === 'draft' || inv.status === 'cancelled') return
    const po = this.pdoc(inv.po_id)
    const billed = sum(this.invoices.filter((i) => i.po_id === po.id && i.doc_type === 'purchase_bill' && !['draft', 'cancelled'].includes(i.status)).map((i) => i.subtotal))
    const received = sum(this.purchaseDocs.filter((r) => r.parent_id === po.id && r.status === 'confirmed').flatMap((r) => this.plines(r.id)).map((rl) => D(rl.quantity).times(this.purchaseLines.find((x) => x.id === rl.source_line_id)?.rate ?? 0)))
    const tol = 1
    if (billed.gt(D(po.subtotal).plus(tol))) {
      this.raise(inv.company_id, 'bill_exceeds_po', 'priority', 'THREE-WAY MATCH — billed more than ordered',
        `Bills recorded against purchase order ${po.doc_no} total ${billed} before tax, while the order is for ${D(po.subtotal)}. Difference ${billed.minus(po.subtotal)}. This is a factual comparison for human review.`,
        { invoice_id: inv.id, po_id: po.id, ordered: po.subtotal, billed: billed.toString(), rule: 'sum of bills > order value (tolerance 1.00)' }, 'invoices', inv.id, 'billpo:' + inv.id)
    }
    if (billed.gt(received.plus(tol))) {
      this.raise(inv.company_id, 'billed_before_receipt', 'review', 'THREE-WAY MATCH — billed more than received',
        `Bills against purchase order ${po.doc_no} total ${billed} before tax, while confirmed receipts are worth ${received} at the ordered rates. Either the goods or services have not all been received, or a receipt has not been recorded.`,
        { invoice_id: inv.id, po_id: po.id, received: received.toString(), billed: billed.toString(), rule: 'sum of bills > value of confirmed receipts (tolerance 1.00)' }, 'invoices', inv.id, 'billgrn:' + inv.id)
    }
    if (billed.gte(D(po.subtotal).minus(tol)) && po.status === 'fully_received') po.status = 'billed'
  }
  /** Controls that run when a document becomes an accounting fact (database: trigger on invoices). */
  override async approveInvoice(id: ID): Promise<string> {
    const before = this.invoices.find((i) => i.id === id)?.status
    const no = await super.approveInvoice(id)
    const inv = this.invoices.find((i) => i.id === id)!
    if (before === 'draft' && inv.status === 'open') {
      if (inv.po_id) this.checkBillAgainstPo(id)
      if (inv.doc_type === 'sales_invoice') {
        const limits = (this.parties.find((p) => p.id === inv.party_id)?.roles ?? []).filter((r) => r.company_id === inv.company_id && r.credit_limit != null).map((r) => D(r.credit_limit))
        const limit = limits.length ? Decimal.max(...limits) : null
        if (limit && limit.gt(0)) {
          const out = sum(this.invoices.filter((i) => i.company_id === inv.company_id && i.party_id === inv.party_id && ['sales_invoice', 'debit_note'].includes(i.doc_type) && ['open', 'partially_paid'].includes(i.status)).map((i) => D(i.total).minus(i.amount_settled).times(i.fx_rate)))
          if (out.gt(limit)) {
            this.raise(inv.company_id, 'credit_limit_exceeded', 'review', 'CREDIT CONTROL — outstanding exceeds the configured limit',
              `${this.partyName(inv.party_id)} now has ${round2(out)} outstanding against a configured credit limit of ${limit}. The invoice was recorded; extending further credit is a human decision.`,
              { invoice_id: inv.id, party_id: inv.party_id, outstanding: round2(out).toString(), credit_limit: limit.toString(), rule: 'open receivables > credit limit on the party relationship' }, 'invoices', inv.id, 'credit:' + inv.id)
          }
        }
      }
    }
    return no
  }
}
