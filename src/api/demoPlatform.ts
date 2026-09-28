import { D, ZERO, round2 } from '@/lib/money'
import { addDays, daysBetween, today } from '@/lib/dates'
import type { Alert, ID, Num } from '@/engine/types'
import type { TaskInput } from '@/engine/opsTypes'
import type {
  AttentionClass, AttentionRule, BackupCheck, BackupCheckInput, Case, Channel, Communication, CommunicationInput, FactRefresh, FactRow, FeatureFlag, FeatureFlagInput,
  FlowCase, FlowCaseInput, FlowCaseStep, FlowDef, FlowDefInput, FlowDefinition, FlowStepInput, ImportBatch, ImportInput, Integration, IntegrationInput, LegacyBalance,
  MessageTemplate, MessageTemplateInput, Notification, NotificationPref, Scenario, ScenarioInput, ScenarioRun, SystemHealth, TwinDriver, TwinDriverInput,
} from '@/engine/p3Types'
import { FLOW_ACTIONS, FLOW_LINKS } from '@/engine/p3Types'
import { DemoControl } from './demoControl'
import { DEMO_USERS, fail, uid } from './demoCore'

// =====================================================================
// DEMO ENGINE — SIMULATIONS, SCENARIO STUDIO, PLATFORM. Mirrors
// migrations 0017 and 0018. All data it holds is SAMPLE DATA.
//
// NUMERO sends nothing outside itself and calls no outside service.
// A communication is prepared here and sent by a person.
// =====================================================================

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const CLASSES: AttentionClass[] = ['information', 'finance_action', 'management_action', 'owner_action', 'critical']
const SECRET = /(sk_live|sk_test|eyj[a-z0-9_-]{10,}|-----begin|password\s*[:=]|api[_-]?key\s*[:=]\s*\S{8,}|secret\s*[:=]\s*\S{8,})/
const DEADLINE_KINDS = ['compliance', 'insurance', 'rent', 'lease', 'amc', 'subscription', 'software_licence', 'domain_hosting', 'bank_guarantee', 'letter_of_credit', 'covenant']

export class DemoPlatform extends DemoControl {
  scenarios: Scenario[] = []
  scenarioRuns: ScenarioRun[] = []
  twinDrivers: TwinDriver[] = []
  flowDefs: FlowDef[] = []
  flowCases: FlowCase[] = []
  flowCaseSteps: FlowCaseStep[] = []
  notifications: (Notification & { dedupe_key: string })[] = []
  notificationPrefs: NotificationPref[] = []
  attentionRules: AttentionRule[] = []
  messageTemplates: MessageTemplate[] = []
  communications: Communication[] = []
  integrations: Integration[] = []
  featureFlags: FeatureFlag[] = []
  backupChecks: BackupCheck[] = []
  imports: ImportBatch[] = []
  legacyBalances: LegacyBalance[] = []
  factRefresh: FactRefresh[] = []
  protected facts: FactRow[] = []

  protected override confidentialRecords() { return { ...super.confidentialRecords(), flow_cases: this.flowCases } }

  // ------------------------------------------------------------ simulations
  async listScenarios() { return this.scenarios.filter((s) => s.created_by === this.actor || s.shared).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }
  async saveScenario(p: ScenarioInput): Promise<ID> {
    if (p.company_id) this.company(p.company_id)
    if (blank(p.name)) fail('a simulation needs a name.')
    if (!Array.isArray(p.shocks)) fail('the assumptions must be a list.')
    for (const k of p.shocks) if (blank(k.kind)) fail('each assumption names what it changes.')
    const horizon = p.horizon_months ?? 12
    if (horizon < 1 || horizon > 60) fail('a simulation looks between 1 and 60 months ahead.')
    if (!p.id) {
      const s: Scenario = { id: uid(), group_id: this.group.id, company_id: p.company_id, name: p.name.trim(), kind: p.kind ?? 'custom', description: p.description ?? null, horizon_months: horizon, shocks: p.shocks, status: 'saved', shared: p.shared ?? false, created_by: this.actor, created_at: this.now(), updated_at: this.now() }
      this.scenarios.push(s)
      return s.id
    }
    const s = this.scenarios.find((x) => x.id === p.id) ?? fail('simulation not found.')
    if (s.created_by !== this.actor && !this.isAdmin()) fail('a simulation is changed by the person who built it. Save a copy under your own name.', '42501')
    Object.assign(s, { company_id: p.company_id, name: p.name.trim(), kind: p.kind ?? s.kind, description: p.description ?? null, horizon_months: p.horizon_months ?? s.horizon_months, shocks: p.shocks, shared: p.shared ?? s.shared, status: p.status ?? s.status, updated_at: this.now() })
    return s.id
  }
  async listScenarioRuns(scenarioId: ID) { return this.scenarioRuns.filter((r) => r.scenario_id === scenarioId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50) }
  async saveScenarioRun(p: { scenario_id: ID; company_ids: ID[]; as_of: string; base: Record<string, unknown>; result: Record<string, unknown>; note?: string }): Promise<ID> {
    const s = this.scenarios.find((x) => x.id === p.scenario_id) ?? fail('simulation not found.')
    if (!p.company_ids?.length) fail('state the companies the simulation was run for.')
    p.company_ids.forEach((c) => this.company(c))
    const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
    if (!obj(p.base) || !obj(p.result)) fail('a result records the figures it started from and the figures it arrived at.')
    // a saved result is a record of a calculation. It is labelled SIMULATION and nothing can change that label.
    const r: ScenarioRun = Object.freeze({ id: uid(), scenario_id: s.id, group_id: s.group_id, company_ids: [...p.company_ids], as_of: p.as_of ?? today(), label: 'SIMULATION' as const, base: p.base, result: p.result, note: p.note ?? null, created_by: this.actor, created_at: this.now() })
    this.scenarioRuns.push(r)
    return r.id
  }
  async listTwinDrivers() { return this.twinDrivers.filter((d) => d.status !== 'retired').sort((a, b) => a.key.localeCompare(b.key)) }
  async saveTwinDriver(p: TwinDriverInput): Promise<ID> {
    if (p.company_id) this.company(p.company_id)
    if (blank(p.key) || blank(p.name)) fail('a driver needs a key and a name.')
    if (p.value === undefined || p.value === null || blank(p.value)) fail('a driver needs its value.')
    if (blank(p.basis)) fail('a driver states what it rests on.')
    const key = p.key.trim().toLowerCase()
    // a new proposal takes the place of an earlier proposal; what is approved stays in use until its successor is approved
    this.twinDrivers.forEach((d) => { if (d.key === key && (d.company_id ?? null) === (p.company_id ?? null) && d.status === 'proposed') d.status = 'retired' })
    const d: TwinDriver = { id: uid(), group_id: this.group.id, company_id: p.company_id ?? null, key, name: p.name.trim(), unit: p.unit ?? 'amount', value: D(p.value).toString(), basis: p.basis.trim(), source: p.source ?? 'assumed', status: 'proposed', created_by: this.actor, created_at: this.now(), approved_by: null, approved_at: null }
    this.twinDrivers.push(d)
    return d.id
  }
  async decideTwinDriver(id: ID, decision: 'approved' | 'retired') {
    const d = this.twinDrivers.find((x) => x.id === id) ?? fail('driver not found.')
    if (!['approved', 'retired'].includes(decision)) fail('the decision is approved or retired.')
    // a proposal is approved or retired; a driver in use can be retired
    if (d.status === 'retired' || (d.status === 'approved' && decision === 'approved')) fail(`this driver is ${d.status}.`)
    // an assumption feeds every simulation that uses it: here the second person is required even of the owner
    if (decision === 'approved' && d.created_by === this.actor) fail('maker-checker control — the person who proposed this assumption cannot also approve it.', '42501')
    if (decision === 'retired') { d.status = 'retired'; return }
    // the driver it succeeds leaves use at the same moment
    this.twinDrivers.forEach((x) => { if (x.id !== d.id && x.key === d.key && (x.company_id ?? null) === (d.company_id ?? null) && x.status === 'approved') x.status = 'retired' })
    Object.assign(d, { status: 'approved', approved_by: this.actor, approved_at: this.now() })
  }

  // ------------------------------------------------------------ scenario studio
  protected checkFlow(d: FlowDefinition | undefined) {
    if (!d || !Array.isArray(d.steps) || !d.steps.length) fail('a workflow needs at least one step.')
    const keys = new Set<string>()
    const roles = new Set(this.roleKeys())
    d!.steps.forEach((s, i) => {
      if (blank(s.key) || blank(s.name)) fail(`step ${i + 1} needs a key and a name.`)
      if (keys.has(s.key)) fail(`two steps share the key "${s.key}".`)
      keys.add(s.key)
      if (!s.action || !(FLOW_ACTIONS as readonly string[]).includes(s.action)) fail(`step "${s.name}" — the action must be one of: ${FLOW_ACTIONS.join(', ')}.`)
      if ((s.actor_role ?? '*') !== '*' && !roles.has(s.actor_role!)) fail(`step "${s.name}" names a role that does not exist: ${s.actor_role}.`)
      if (s.links_to && !(FLOW_LINKS as readonly string[]).includes(s.links_to)) fail(`step "${s.name}" points to a kind of record that a workflow cannot link: ${s.links_to}.`)
      if (s.required_documents !== undefined && !Array.isArray(s.required_documents)) fail(`step "${s.name}" — the required documents must be a list.`)
      // money is released, and cost is recognised, only through the engines that propose an accounting entry
      if (['fund_release', 'accounting', 'settlement'].includes(s.action) && !s.links_to)
        fail(`step "${s.name}" releases money or recognises cost. It must point to the record that does so (an advance, a claim, a transfer, a journal), because a workflow itself posts nothing.`)
    })
    for (const f of d!.fields ?? []) if (blank(f.key) || blank(f.label)) fail('each field of the form needs a key and a label.')
  }
  protected roleKeys(): string[] {
    return ['owner', 'group_cfo', 'company_director', 'finance_head', 'accountant', 'junior_accountant', 'auditor', 'tax_consultant', 'department_head', 'project_manager', 'purchase_manager', 'sales_manager',
      'payroll_officer', 'hr_head', 'store_keeper', 'investment_manager', 'it_admin', 'employee', 'read_only']
  }
  /** the role each sample person holds; the demo has three people */
  protected actorRoles(): string[] {
    return this.actor === 'demo-owner' ? this.roleKeys() : this.actor === 'demo-finance' ? ['finance_head'] : this.actor === 'demo-cfo' ? ['group_cfo'] : this.actor === 'demo-accountant' ? ['accountant'] : []
  }
  async listFlowDefs() { return [...this.flowDefs].sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version) }
  async saveFlowDef(p: FlowDefInput): Promise<ID> {
    const ex = p.id ? this.flowDefs.find((x) => x.id === p.id) ?? fail('workflow not found.') : undefined
    // the workflow on record decides which company, and which key, the change belongs to
    const companyId = ex ? ex.company_id : p.company_id ?? null
    const key = ex ? ex.key : (p.key ?? '').trim().toLowerCase()
    if (companyId) this.company(companyId)
    if (!companyId && !this.isAdmin()) fail('a workflow for the whole group is designed by a Group Super Admin.', '42501')
    if (blank(key) || blank(p.name)) fail('a workflow needs a key and a name.')
    this.checkFlow(p.definition)
    if (ex?.status === 'draft') {
      Object.assign(ex, { name: p.name.trim(), description: p.description ?? null, category: p.category ?? ex.category, trigger_kind: p.trigger_kind ?? ex.trigger_kind, definition: p.definition })
      return ex.id
    }
    // a workflow in use is never edited: cases already started keep the steps they started with. A change is a new version.
    const version = Math.max(0, ...this.flowDefs.filter((x) => x.key === key && (x.company_id ?? null) === companyId).map((x) => x.version)) + 1
    const f: FlowDef = { id: uid(), group_id: this.group.id, company_id: companyId, key, version, name: p.name.trim(), description: p.description ?? null, category: p.category ?? 'other', trigger_kind: p.trigger_kind ?? 'manual', definition: p.definition, status: 'draft', cloned_from: (p as { cloned_from?: ID }).cloned_from ?? ex?.id ?? null, created_by: this.actor, created_at: this.now(), activated_at: null }
    this.flowDefs.push(f)
    this.log(companyId, 'flow_defs', f.id, 'insert', null, f, null)
    return f.id
  }
  async setFlowStatus(id: ID, status: 'active' | 'retired') {
    const f = this.flowDefs.find((x) => x.id === id) ?? fail('workflow not found.')
    if (!f.company_id && !this.isAdmin()) fail('you are not authorised to change this workflow.', '42501')
    if (!['active', 'retired'].includes(status)) fail('a workflow is made active or retired.')
    if (status === 'active') {
      this.checkFlow(f.definition)
      this.flowDefs.forEach((x) => { if (x.key === f.key && (x.company_id ?? null) === (f.company_id ?? null) && x.status === 'active' && x.id !== f.id) x.status = 'retired' })
      Object.assign(f, { status: 'active', activated_at: this.now() })
    } else f.status = 'retired'
    this.log(f.company_id, 'flow_defs', f.id, 'update', null, { status }, null)
  }
  async cloneFlowDef(id: ID, key: string, name: string, companyId: ID | null) {
    const f = this.flowDefs.find((x) => x.id === id) ?? fail('workflow not found.')
    return this.saveFlowDef({ company_id: companyId, key, name, description: f.description ?? undefined, category: f.category, trigger_kind: f.trigger_kind, definition: JSON.parse(JSON.stringify(f.definition)), cloned_from: f.id } as FlowDefInput)
  }
  protected flowCase(id: ID) { return this.flowCases.find((c) => c.id === id) ?? fail('case not found.') }
  protected stepsOf(id: ID) { return this.flowCaseSteps.filter((s) => s.case_id === id).sort((a, b) => a.step_no - b.step_no) }
  async listFlowCases(f: { companyIds: ID[]; flowId?: ID; openOnly?: boolean }) {
    return this.flowCases.filter((c) => f.companyIds.includes(c.company_id) && this.canViewLevel(c.confidentiality) && (!f.flowId || c.flow_id === f.flowId) && (!f.openOnly || c.status === 'open'))
      .sort((a, b) => b.started_at.localeCompare(a.started_at)).map((c) => ({ ...c, steps: this.stepsOf(c.id) }))
  }
  async getFlowCase(id: ID) { const c = this.flowCase(id); if (!this.canViewLevel(c.confidentiality)) fail('case not found.'); return { ...c, steps: this.stepsOf(id) } }
  async startFlowCase(p: FlowCaseInput): Promise<ID> {
    const f = this.flowDefs.find((x) => x.id === p.flow_id) ?? fail('workflow not found.')
    this.company(p.company_id)
    if (f.status !== 'active') fail(`this workflow is ${f.status}. Only an active workflow can be started.`)
    if (f.company_id && f.company_id !== p.company_id) fail('this workflow belongs to another company.')
    if (blank(p.title)) fail('a title is required.')
    this.clearance(p.confidentiality)
    const missing = (f.definition.fields ?? []).filter((x) => x.required && blank((p.data ?? {})[x.key])).map((x) => x.label)
    if (missing.length) fail(`required information is missing — ${missing.join(', ')}.`)
    if (p.register_item_id && !this.registerItems.some((r) => r.id === p.register_item_id && r.company_id === p.company_id)) fail('the register item belongs to another company.')
    const prefix = f.key.replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase()
    const c: FlowCase = { id: uid(), company_id: p.company_id, flow_id: f.id, case_no: this.docNo(p.company_id, 'flow_case', prefix, today()), title: p.title.trim(), party_id: p.party_id ?? null, amount: p.amount ?? null, register_item_id: p.register_item_id ?? null, data: p.data ?? {}, status: 'open', current_step: 1, confidentiality: p.confidentiality ?? 'internal', started_by: this.actor, started_at: this.now(), completed_at: null, cancel_reason: null }
    this.flowCases.push(c)
    f.definition.steps.forEach((s, i) => this.flowCaseSteps.push({
      id: uid(), case_id: c.id, company_id: p.company_id, step_no: i + 1, step_key: s.key, name: s.name, action: s.action, actor_role: s.actor_role ?? '*', links_to: s.links_to ?? null, required_documents: s.required_documents ?? [],
      optional: s.optional ?? false, status: i === 0 ? 'active' : 'pending', entity: null, entity_id: null, note: null, done_by: null, done_at: null,
    }))
    this.log(p.company_id, 'flow_cases', c.id, 'insert', null, c, null)
    return c.id
  }
  /** the records a step may point to */
  protected flowRecords(entity: string): { id: ID; company_id: ID }[] {
    const m: Record<string, { id: ID; company_id: ID }[]> = {
      advances: this.advances, expense_claims: this.claims, purchase_docs: this.purchaseDocs, register_items: this.registerItems, journals: this.journals, fund_transfers: this.transfers, invoices: this.invoices,
      payments: this.payments, fixed_assets: this.assets, loans: this.loans, stock_docs: this.stockDocs, cases: this.cases,
    }
    return m[entity] ?? []
  }
  /** Completes the step that is in turn. A workflow posts nothing and releases nothing. */
  async completeFlowStep(p: FlowStepInput): Promise<'open' | 'completed'> {
    const c = this.flowCase(p.case_id)
    if (!this.canViewLevel(c.confidentiality)) fail('you are not cleared for this case.', '42501')
    if (c.status !== 'open') fail(`this case is ${c.status}.`)
    const steps = this.stepsOf(c.id)
    const s = steps.find((x) => x.step_no === c.current_step)!
    if (s.actor_role !== '*' && !this.actorRoles().includes(s.actor_role) && !this.isAdmin()) fail(`the step "${s.name}" is for the role ${s.actor_role}.`, '42501')
    if (p.skip) {
      if (!s.optional) fail(`the step "${s.name}" cannot be skipped.`)
      if (blank(p.note)) fail('say why the step is skipped.')
    } else {
      // the rule of every approval: where the group allows an override, it is the Group Super Admin's alone
      if (s.action === 'approval' && c.started_by === this.actor && !(this.group.settings.controls?.maker_checker === 'owner_override' && this.isAdmin()))
        fail('maker-checker control — the person who started this case cannot also approve it.', '42501')
      if (s.links_to) {
        if (!p.entity_id) fail(`the step "${s.name}" is complete when it points to its record (${s.links_to.replace(/_/g, ' ')}).`)
        if (!this.flowRecords(s.links_to).some((r) => r.id === p.entity_id && r.company_id === c.company_id)) fail('that record was not found in this company.')
      }
      // the documents the step requires must be attached to the case, each of its kind
      const have = new Set(this.documentLinks.filter((l) => l.entity === 'flow_cases' && l.entity_id === c.id).map((l) => this.documents.find((d) => d.id === l.document_id)?.doc_kind))
      for (const k of s.required_documents) if (!have.has(k)) fail(`the step "${s.name}" requires a document of the kind "${k}". Attach it to the case first.`)
    }
    Object.assign(s, { status: p.skip ? 'skipped' : 'done', entity: p.skip ? null : s.links_to, entity_id: p.skip ? null : p.entity_id ?? null, note: p.note ?? null, done_by: this.actor, done_at: this.now() })
    this.log(c.company_id, 'flow_cases', c.id, p.skip ? 'step_skipped' : 'step_completed', null, { case_no: c.case_no, step: s.step_no, name: s.name, action: s.action, entity: s.entity, entity_id: s.entity_id }, p.note ?? null)
    const next = steps.find((x) => x.step_no > s.step_no)
    if (!next) { Object.assign(c, { status: 'completed', completed_at: this.now() }); this.log(c.company_id, 'flow_cases', c.id, 'completed', null, { case_no: c.case_no }, null); return 'completed' }
    next.status = 'active'; c.current_step = next.step_no
    return 'open'
  }
  async cancelFlowCase(id: ID, reason: string) {
    const c = this.flowCase(id)
    if (c.status !== 'open') fail(`this case is ${c.status}.`)
    if (blank(reason)) fail('a reason is required.')
    Object.assign(c, { status: 'cancelled', cancel_reason: reason, completed_at: this.now() })
    this.log(c.company_id, 'flow_cases', c.id, 'cancelled', null, { case_no: c.case_no }, reason)
  }

  // ------------------------------------------------------------ notifications
  protected muted(user: ID, kind: string) { return this.notificationPrefs.some((p) => p.user_id === user && p.kind === kind && p.channel === 'in_app' && !p.enabled) }
  protected attentionClass(kind: string, amount: Num | null | undefined, fallback: AttentionClass): AttentionClass {
    const amt = D(amount ?? 0).abs()
    const r = this.attentionRules.filter((x) => (x.kind === kind || x.kind === '*') && amt.gte(x.min_amount))
      .sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind) || D(b.min_amount).cmp(a.min_amount))[0]
    return r?.class ?? fallback
  }
  protected notify(user: ID, n: Pick<Notification, 'company_id' | 'kind' | 'class' | 'title'> & Partial<Notification>, dedupe: string, mandatory = false) {
    if (!mandatory && this.muted(user, n.kind)) return false
    if (this.notifications.some((x) => x.user_id === user && x.dedupe_key === dedupe)) return false
    this.notifications.push({ id: uid(), group_id: this.group.id, user_id: user, body: null, entity: null, entity_id: null, mandatory, created_at: this.now(), read_at: null, ...n, dedupe_key: dedupe })
    return true
  }
  /** Tells every person who could act. A person is never told about their own action. In the demo every person holds every permission. */
  protected notifyHolders(n: Parameters<DemoPlatform['notify']>[1], dedupe: string, except: ID | null, mandatory = false) {
    let c = 0
    // the owner is not to be overwhelmed with routine bookkeeping: of an approval that waits, the Group Super Admin is told
    // only when the rules of the group class it as owner action or critical, or when no other person could approve it
    const others = Object.keys(DEMO_USERS).filter((u) => u !== 'demo-owner' && u !== except).length
    const owner = n.kind !== 'approval_waiting' || n.class === 'owner_action' || n.class === 'critical' || others === 0
    for (const u of Object.keys(DEMO_USERS)) if (u !== except && (owner || u !== 'demo-owner') && this.notify(u, n, dedupe, mandatory)) c++
    return c
  }
  protected override openRequest(companyId: ID, entity: string, entityId: ID, amount: Num, summary: string | null): ID {
    const id = super.openRequest(companyId, entity, entityId, amount, summary)
    this.notifyHolders({ company_id: companyId, kind: 'approval_waiting', class: this.attentionClass('approval:' + entity, amount, 'finance_action'), title: `Approval waiting — ${entity.replace(/_/g, ' ')}`, body: `${summary ?? ''} · ${amount}`, entity, entity_id: entityId }, 'approval:' + id, this.actor, true)
    return id
  }
  /** an entry submitted by hand asks for approval too: the database tells the approvers of every request, whatever raised it */
  override async submitJournal(id: ID) {
    await super.submitJournal(id)
    const r = this.approvalRequests.find((x) => x.entity === 'journal' && x.entity_id === id && x.status === 'pending')
    if (r) this.notifyHolders({ company_id: r.company_id, kind: 'approval_waiting', class: this.attentionClass('approval:journal', r.amount, 'finance_action'), title: 'Approval waiting — journal', body: `${r.summary ?? ''} · ${r.amount}`, entity: 'journal', entity_id: id }, 'approval:' + r.id, this.actor, true)
  }
  protected override raise(company_id: ID, kind: string, attention: Alert['attention'], title: string, explanation: string, evidence: Record<string, unknown>, entity: string, entity_id: ID, dedupe_key: string) {
    const added = super.raise(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    if (added && (attention === 'priority' || attention === 'critical')) {
      const al = this.alerts[this.alerts.length - 1]
      this.notifyHolders({ company_id, kind: 'alert', class: this.attentionClass(kind, (evidence.amount ?? evidence.difference) as Num | undefined, attention === 'critical' ? 'critical' : 'management_action'), title, body: explanation, entity: entity ?? 'alerts', entity_id: entity_id ?? al.id }, 'alert:' + al.id, null, attention === 'critical')
    }
    return added
  }
  override async saveTask(p: TaskInput): Promise<ID> {
    const before = p.id ? this.tasks.find((t) => t.id === p.id)?.owner_user ?? null : null
    const id = await super.saveTask(p)
    const t = this.tasks.find((x) => x.id === id)!
    if (t.owner_user && t.owner_user !== this.actor && t.owner_user !== before && ['open', 'in_progress'].includes(t.status))
      this.notify(t.owner_user, { company_id: t.company_id, kind: 'follow_up_assigned', class: 'finance_action', title: `Follow-up for you — ${t.title}`, body: t.due_date ? `Due ${t.due_date}` : 'No due date', entity: 'tasks', entity_id: t.id }, `task:${t.id}:${t.owner_user}`)
    return id
  }
  protected override onCaseAssigned(c: Case) {
    if (c.owner_user && c.owner_user !== this.actor && c.status !== 'closed')
      this.notify(c.owner_user, { company_id: c.company_id, kind: 'case_assigned', class: c.attention, title: `Case for you — ${c.case_no}`, body: c.title, entity: 'cases', entity_id: c.id }, `case:${c.id}:${c.owner_user}`)
  }
  async listNotifications(f: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.notifications.filter((n) => n.user_id === this.actor && (!f.unreadOnly || !n.read_at)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, f.limit ?? 200)
  }
  /** Things that become due with the passing of time. Nothing in NUMERO runs on a schedule: this is run when a person opens the application. */
  async refreshNotifications(): Promise<number> {
    const me = this.actor; const now = today(); let n = 0
    const week = (() => { const d = new Date(now + 'T00:00:00'); const onejan = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-${Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)}` })()
    for (const t of this.tasks) {
      if (t.owner_user !== me || !['open', 'in_progress'].includes(t.status) || !t.due_date || t.due_date > addDays(now, 2)) continue
      const late = t.due_date < now
      if (this.notify(me, { company_id: t.company_id, kind: 'follow_up_due', class: late ? 'management_action' : 'finance_action', title: `${late ? 'Follow-up overdue — ' : 'Follow-up due — '}${t.title}`, body: `Due ${t.due_date}`, entity: 'tasks', entity_id: t.id }, `taskdue:${t.id}:${t.due_date}`)) n++
    }
    for (const i of this.registerItems) {
      if (i.status !== 'active' || !i.next_due || i.next_due < addDays(now, -30) || i.next_due > addDays(now, 7) || !DEADLINE_KINDS.includes(i.kind) || !this.canViewLevel(i.confidentiality)) continue
      if (this.notify(me, { company_id: i.company_id, kind: 'deadline', class: i.next_due < now ? 'management_action' : 'finance_action', title: `${i.kind === 'compliance' ? 'Compliance deadline — ' : 'Falls due — '}${i.title}`, body: `${i.ref_no} · due ${i.next_due}`, entity: 'register_items', entity_id: i.id }, `due:${i.id}:${i.next_due}`)) n++
    }
    for (const a of this.approvalRequests) {
      if (a.status !== 'pending' || a.requested_by === me || daysBetween(a.requested_at.slice(0, 10), now) <= 3) continue
      if (this.notify(me, { company_id: a.company_id, kind: 'approval_waiting_long', class: 'management_action', title: `Waiting ${daysBetween(a.requested_at.slice(0, 10), now)} days for approval — ${a.entity.replace(/_/g, ' ')}`, body: a.summary ?? '', entity: a.entity, entity_id: a.entity_id }, `approvallong:${a.id}:${week}`, true)) n++
    }
    for (const b of this.bankAccounts) {
      const open = this.bankTxns.filter((t) => t.bank_account_id === b.id && ['unmatched', 'suggested', 'needs_review', 'partial'].includes(t.status) && t.txn_date < addDays(now, -7))
      if (!open.length) continue
      const oldest = open.reduce((m, t) => (t.txn_date < m ? t.txn_date : m), open[0].txn_date)
      if (this.notify(me, { company_id: b.company_id, kind: 'reconciliation_incomplete', class: 'finance_action', title: `Bank reconciliation incomplete — ${b.name}`, body: `${open.length} statement line(s) are unmatched, the oldest of ${oldest}`, entity: 'bank_accounts', entity_id: b.id }, `recon:${b.id}:${week}`)) n++
    }
    return n
  }
  async markNotifications(ids: ID[] | null, read = true) {
    let n = 0
    for (const x of this.notifications) if (x.user_id === this.actor && (!ids || ids.includes(x.id))) { x.read_at = read ? x.read_at ?? this.now() : null; n++ }
    return n
  }
  async listNotificationPrefs() { return this.notificationPrefs.filter((p) => p.user_id === this.actor) }
  async setNotificationPref(kind: string, channel: Channel, enabled: boolean) {
    if (!['in_app', 'email', 'push', 'sms', 'whatsapp'].includes(channel)) fail('unknown channel.')
    if (!enabled && ['approval_waiting', 'approval_waiting_long'].includes(kind)) fail('approvals that wait for you are a governance notice and cannot be switched off.')
    this.notificationPrefs = [...this.notificationPrefs.filter((p) => !(p.user_id === this.actor && p.kind === kind && p.channel === channel)), { user_id: this.actor, kind, channel, enabled }]
  }
  async listAttentionRules() { return [...this.attentionRules].sort((a, b) => a.kind.localeCompare(b.kind) || D(a.min_amount).cmp(b.min_amount)) }
  async saveAttentionRule(p: { kind: string; min_amount?: Num; class: AttentionClass; note?: string; remove?: boolean }) {
    if (!this.isAdmin()) fail('only a Group Super Admin decides who attends to what.', '42501')
    if (blank(p.kind)) fail('state the kind of notice the rule is for.')
    if (!CLASSES.includes(p.class)) fail('unknown class of attention.')
    const min = D(p.min_amount ?? 0)
    this.attentionRules = this.attentionRules.filter((r) => !(r.kind === p.kind.trim() && D(r.min_amount).eq(min)))
    if (!p.remove) this.attentionRules.push({ id: uid(), group_id: this.group.id, kind: p.kind.trim(), min_amount: min.toString(), class: p.class, note: p.note ?? null })
  }

  // ------------------------------------------------------------ communications: prepared here, sent by a person
  async listMessageTemplates() { return [...this.messageTemplates].sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version) }
  async saveMessageTemplate(p: MessageTemplateInput): Promise<ID> {
    if (p.company_id) this.company(p.company_id)
    if (blank(p.name) || blank(p.subject) || blank(p.body)) fail('a template needs a name, a subject and a body.')
    // a template that has been used is not overwritten: what was sent stays as it was sent
    const same = this.messageTemplates.filter((t) => t.key === p.key && (t.company_id ?? null) === (p.company_id ?? null))
    same.forEach((t) => { t.is_active = false })
    const t: MessageTemplate = { id: uid(), group_id: this.group.id, company_id: p.company_id ?? null, key: p.key, name: p.name.trim(), subject: p.subject, body: p.body, is_active: true, version: Math.max(0, ...same.map((x) => x.version)) + 1, created_at: this.now() }
    this.messageTemplates.push(t)
    return t.id
  }
  async listCommunications(f: { companyIds: ID[]; partyId?: ID; entity?: string; entityId?: ID }) {
    return this.communications.filter((c) => f.companyIds.includes(c.company_id) && (!f.partyId || c.party_id === f.partyId) && (!f.entity || c.entity === f.entity) && (!f.entityId || c.entity_id === f.entityId))
      .sort((a, b) => b.prepared_at.localeCompare(a.prepared_at))
  }
  async prepareCommunication(p: CommunicationInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.subject) || blank(p.body)) fail('a communication needs a subject and a body.')
    if (p.party_id) this.needParty(p.party_id, 'unknown party .')
    // what was said is a record: its words are fixed from the moment it is prepared
    const c = { id: uid(), company_id: p.company_id, channel: p.channel ?? 'email', template_key: p.template_key ?? null, party_id: p.party_id ?? null, to_address: p.to_address ?? null, subject: p.subject, body: p.body, entity: p.entity ?? null, entity_id: p.entity_id ?? null, status: 'prepared', sent_on: null, sent_note: null, prepared_by: this.actor, prepared_at: this.now() } as Communication
    for (const k of ['subject', 'body', 'party_id', 'to_address'] as const) Object.defineProperty(c, k, { value: c[k], writable: false, enumerable: true, configurable: false })
    this.communications.push(c)
    this.log(p.company_id, 'communications', c.id, 'insert', null, { ...c }, null)
    return c.id
  }
  async markCommunication(id: ID, status: 'sent_by_person' | 'not_sent', note: string, sentOn?: string) {
    const c = this.communications.find((x) => x.id === id) ?? fail('communication not found.')
    if (c.status !== 'prepared') fail(`this communication is already recorded as ${c.status.replace(/_/g, ' ')}.`)
    if (!['sent_by_person', 'not_sent'].includes(status)) fail('record whether it was sent or not.')
    if (blank(note)) fail('record how it was sent, or why it was not.')
    c.status = status; c.sent_on = status === 'sent_by_person' ? sentOn ?? today() : null; c.sent_note = note
    this.log(c.company_id, 'communications', c.id, 'update', null, { status, sent_note: note }, null)
  }

  // ------------------------------------------------------------ register of integrations
  async listIntegrations() { return [...this.integrations].sort((a, b) => a.name.localeCompare(b.name)) }
  async saveIntegration(p: IntegrationInput): Promise<ID> {
    if (p.company_id) this.company(p.company_id)
    if (blank(p.key) || blank(p.name)) fail('an integration needs a key and a name.')
    // the register holds no secret
    if (SECRET.test(`${p.secret_location ?? ''} ${p.notes ?? ''} ${p.auth_method ?? ''}`.toLowerCase())) fail('this looks like a key, a password or a token. The register records where a secret is kept, never the secret.')
    const ex = p.id ? this.integrations.find((x) => x.id === p.id) ?? fail('integration not found.') : undefined
    const money = p.moves_money ?? false; const status = p.status ?? 'planned'; const env = p.environment ?? 'sandbox'
    // real money safety: an integration that can move money reaches production only after a recorded test in a sandbox
    if (money && env === 'production' && ['testing', 'active'].includes(status) && !(p.tested_in_sandbox_on ?? ex?.tested_in_sandbox_on))
      fail('an integration that can move money is HIGH RISK. Record its test in a sandbox before it is used in production.')
    if (money && status === 'active' && !this.isAdmin()) fail('only a Group Super Admin makes active an integration that can move money.', '42501')
    const fields = {
      name: p.name.trim(), kind: p.kind ?? ex?.kind ?? 'other', direction: p.direction ?? ex?.direction ?? 'inbound', moves_money: money, risk: (money ? 'high' : 'normal') as Integration['risk'], environment: env, status, scopes: p.scopes ?? [],
      auth_method: p.auth_method ?? null, secret_location: p.secret_location ?? null, owner_name: p.owner_name ?? null, tested_in_sandbox_on: p.tested_in_sandbox_on ?? ex?.tested_in_sandbox_on ?? null, last_checked_on: p.last_checked_on ?? null, notes: p.notes ?? null, updated_at: this.now(),
    }
    if (ex) { const old = { ...ex }; Object.assign(ex, fields); this.log(ex.company_id, 'integrations', ex.id, 'update', old, ex, p.reason ?? null); return ex.id }
    const key = p.key.trim().toLowerCase()
    if (this.integrations.some((x) => x.key === key && (x.company_id ?? null) === (p.company_id ?? null))) fail('an integration with this key is already on the register.')
    const i: Integration = { id: uid(), group_id: this.group.id, company_id: p.company_id ?? null, key, created_at: this.now(), ...fields }
    this.integrations.push(i)
    this.log(i.company_id, 'integrations', i.id, 'insert', null, i, null)
    return i.id
  }

  // ------------------------------------------------------------ feature flags
  async listFeatureFlags() { return [...this.featureFlags].sort((a, b) => a.module.localeCompare(b.module)) }
  async setFeatureFlag(p: FeatureFlagInput) {
    if (!this.isAdmin()) fail('only a Group Super Admin switches capabilities on or off.', '42501')
    if (blank(p.module)) fail('name the capability.')
    if (p.company_id) this.company(p.company_id)
    if (p.role_key && !this.roleKeys().includes(p.role_key)) fail('role not found.')
    const same = (f: FeatureFlag) => f.module === p.module.trim() && (f.company_id ?? null) === (p.company_id ?? null) && (f.role_key ?? null) === (p.role_key ?? null)
    const old = this.featureFlags.find(same) ?? null
    this.featureFlags = this.featureFlags.filter((f) => !same(f))
    const row: FeatureFlag | null = p.enabled === null || p.enabled === undefined ? null : { id: old?.id ?? uid(), group_id: this.group.id, module: p.module.trim(), company_id: p.company_id ?? null, role_key: p.role_key ?? null, enabled: p.enabled, note: p.note ?? null, set_at: this.now() }
    if (row) this.featureFlags.push(row)
    this.log(p.company_id ?? null, 'feature_flags', row?.id ?? old?.id ?? null, row ? (old ? 'update' : 'insert') : 'delete', old, row, p.note ?? null)
  }

  // ------------------------------------------------------------ backups: recorded by a person
  async listBackupChecks() { return [...this.backupChecks].sort((a, b) => b.performed_on.localeCompare(a.performed_on) || b.recorded_at.localeCompare(a.recorded_at)) }
  async recordBackupCheck(p: BackupCheckInput): Promise<ID> {
    if (!['backup', 'restore_test'].includes(p.kind)) fail('record a backup or a restore test.')
    if (!['succeeded', 'failed', 'partial'].includes(p.outcome)) fail('record the outcome.')
    if (blank(p.performed_on) || p.performed_on > today()) fail('the date is required and cannot be in the future.')
    if (blank(p.evidence) || blank(p.performed_by_name)) fail('record who did it and what shows that it was done.')
    // a record of a backup is not changed or removed afterwards
    const b: BackupCheck = Object.freeze({ id: uid(), group_id: this.group.id, kind: p.kind, performed_on: p.performed_on, outcome: p.outcome, covers: p.covers ?? 'database', evidence: p.evidence.trim(), recovery_point: p.recovery_point ?? null, recovery_minutes: p.recovery_minutes ?? null, performed_by_name: p.performed_by_name.trim(), note: p.note ?? null, recorded_at: this.now() })
    this.backupChecks.push(b)
    return b.id
  }

  // ------------------------------------------------------------ system health: NUMERO looking at itself
  async systemHealth(): Promise<SystemHealth> {
    const now = today()
    const posted = this.journals.filter((j) => j.status === 'posted' || j.status === 'reversed')
    const unbalanced = posted.filter((j) => { const ls = this.linesByJournal.get(j.id) ?? []; return !ls.reduce((s, l) => s.plus(l.debit).minus(l.credit), ZERO).isZero() }).length
    const pending = this.postings.filter((w) => w.status === 'pending')
    const oldest = pending.reduce<string | null>((m, w) => (!m || w.created_at < m ? w.created_at : m), null)
    const waiting = !!oldest && daysBetween(oldest.slice(0, 10), now) > 7
    const stock = this.invCategories.map((c) => {
      const s = this.invItems.filter((i) => i.category_id === c.id).reduce((t, i) => t.plus(i.value_on_hand), ZERO)
      const gl = this.lines.filter((l) => l.account_id === c.inventory_account_id && posted.some((j) => j.id === l.journal_id)).reduce((t, l) => t.plus(l.debit).minus(l.credit), ZERO)
      return { company_id: c.company_id, account_id: c.inventory_account_id, ledger: this.account(c.inventory_account_id)?.name ?? '', stock: s, gl }
    })
    // several categories may share one ledger: compare ledger by ledger
    const byLedger = new Map<string, { company_id: ID; ledger: string; stock: typeof ZERO; gl: typeof ZERO }>()
    for (const r of stock) { const cur = byLedger.get(r.account_id); byLedger.set(r.account_id, { company_id: r.company_id, ledger: r.ledger, stock: (cur?.stock ?? ZERO).plus(r.stock), gl: r.gl }) }
    const differences = [...byLedger.values()].filter((r) => !r.stock.eq(r.gl)).map((r) => ({ company_id: r.company_id, ledger: r.ledger, stock_ledger: r.stock.toString(), general_ledger: r.gl.toString(), difference: r.stock.minus(r.gl).toString() }))
    const banks = this.bankAccounts.filter((b) => b.is_active).map((b) => {
      const tx = this.bankTxns.filter((t) => t.bank_account_id === b.id)
      const last = tx.reduce<string | null>((m, t) => (!m || t.txn_date > m ? t.txn_date : m), null)
      return { company_id: b.company_id, bank_account: b.name, last_statement_line: last, unmatched: tx.filter((t) => ['unmatched', 'suggested', 'needs_review', 'partial'].includes(t.status)).length, stale: !last || last < addDays(now, -35) }
    })
    const okBackup = this.backupChecks.filter((b) => b.kind === 'backup' && b.outcome === 'succeeded').map((b) => b.performed_on).sort().pop() ?? null
    const okRestore = this.backupChecks.filter((b) => b.kind === 'restore_test' && b.outcome === 'succeeded').map((b) => b.performed_on).sort().pop() ?? null
    const failure = this.backupChecks.filter((b) => b.outcome !== 'succeeded').sort((a, b) => b.performed_on.localeCompare(a.performed_on))[0]
    const lastPosted = (c: ID) => posted.filter((j) => j.company_id === c).reduce<string | null>((m, j) => (!m || (j.posted_at ?? '') > m ? j.posted_at ?? m : m), null)
    const never = this.companies.filter((c) => !this.factRefresh.some((f) => f.company_id === c.id)).length
    const since = this.factRefresh.filter((f) => (f.last_posted_at ?? '') < (lastPosted(f.company_id) ?? '')).length
    const openAlerts = this.alerts.filter((a) => a.status === 'open' || a.status === 'reviewing')
    return {
      posting_engine: {
        state: unbalanced > 0 ? 'failure' : waiting ? 'attention' : 'ok', posted_entries_that_do_not_balance: unbalanced, proposed_entries_awaiting_approval: pending.length, oldest_awaiting_since: oldest,
        explanation: unbalanced > 0 ? 'A posted entry does not balance. This must never happen: stop and investigate.' : waiting ? 'Entries proposed by operations have waited more than seven days for approval. Until they are approved the books do not show them.' : 'Every posted entry balances.',
      },
      database: { state: 'ok', companies: this.companies.length, entries: this.journals.length, entry_lines: this.lines.length, checked_at: this.now(), explanation: 'Sample data held in this browser. Volumes are counted, not estimated.' },
      stock_and_ledger: { state: differences.length ? 'attention' : 'ok', differences, explanation: differences.length ? 'The value of stock differs from its ledger. A manual entry in a stock ledger, or a bill coded straight to stock, causes this.' : 'Where stock is kept, its value agrees with its ledger.' },
      bank_statements: {
        state: !banks.length ? 'not_recorded' : banks.some((b) => b.stale || b.unmatched > 0) ? 'attention' : 'ok', accounts: banks, accounts_without_a_recent_statement: banks.filter((b) => b.stale).length, statement_lines_unmatched: banks.reduce((s, b) => s + b.unmatched, 0),
        explanation: 'No bank feed is connected. Statements are imported by a person; an account with no statement line in 35 days is shown as stale.',
      },
      alerts: { state: openAlerts.some((a) => a.attention === 'critical') ? 'attention' : 'ok', open: openAlerts.length, critical: openAlerts.filter((a) => a.attention === 'critical').length, open_cases: this.cases.filter((c) => c.status !== 'closed').length },
      storage: { state: 'ok', documents: this.documents.length, bytes: this.documents.reduce((s, d) => s + Number(d.size_bytes ?? 0), 0), explanation: 'Counted from the register of documents. NUMERO does not measure the storage bucket itself.' },
      audit_trail: { state: 'ok', entries: this.audit.length, last_entry: this.audit[this.audit.length - 1]?.at ?? null, explanation: 'The audit trail can only be added to.' },
      backups: {
        state: !okBackup ? 'not_recorded' : okBackup < addDays(now, -7) || !okRestore || okRestore < addDays(now, -120) ? 'attention' : 'ok', last_backup_recorded: okBackup, last_restore_test_recorded: okRestore,
        last_failure: failure ? { kind: failure.kind, on: failure.performed_on } : null,
        recovery_readiness: !okBackup ? 'unknown — no backup is on record' : !okRestore ? 'unproven — a backup is on record, but no restore has been tested' : okRestore < addDays(now, -120) ? 'stale — the last restore test is more than 120 days old' : 'tested',
        explanation: 'NUMERO cannot see the backups of its own database. These are the records a person has entered. A backup that has never been restored is not yet a backup.',
      },
      analytical_store: { state: never + since > 0 ? 'attention' : 'ok', companies_never_refreshed: never, companies_with_entries_posted_since: since, explanation: 'Monthly totals are rebuilt when a person asks. Nothing refreshes them on a schedule.' },
      integrations: {
        state: this.integrations.some((i) => i.status === 'active') ? 'ok' : 'not_connected',
        register: this.integrations.filter((i) => i.status !== 'retired').map((i) => ({ name: i.name, kind: i.kind, status: i.status, environment: i.environment, moves_money: i.moves_money, last_checked_on: i.last_checked_on })),
        explanation: 'The register describes integrations. NUMERO itself calls no outside service.',
      },
      notifications: { state: 'ok', unread: this.notifications.filter((n) => n.user_id === this.actor && !n.read_at).length, channels: { in_app: 'working', email: 'not connected', sms: 'not connected', push: 'not connected', whatsapp: 'not connected' } },
      queues_and_jobs: { state: 'not_connected', explanation: 'NUMERO runs nothing on a schedule and keeps no queue. Depreciation, payroll, Sentinel and the analytical store are each started by a person.' },
    }
  }

  // ------------------------------------------------------------ imports: preview → validate → duplicates → balance → mapping → commit
  async listImports(companyIds: ID[]) { return this.imports.filter((b) => companyIds.includes(b.company_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((b) => ({ ...b, rows: [] })) }
  async getImport(id: ID) { return this.imports.find((b) => b.id === id) ?? fail('import not found.') }
  async stageImport(p: ImportInput): Promise<ID> {
    this.company(p.company_id)
    if (!['journals', 'opening_balances', 'legacy_trial_balance'].includes(p.kind)) fail('state what is imported: journals, opening balances, or the trial balance of the earlier system.')
    if (blank(p.file_name) || blank(p.sha256)) fail('the file name and the fingerprint of the file are required.')
    if (!Array.isArray(p.rows) || !p.rows.length) fail('the file has no rows.')
    if (p.rows.length > 5000) fail('a file of more than 5,000 rows is imported in parts.')
    if (p.kind !== 'journals' && blank(p.period_end)) fail('state the date of the balances.')
    const map = p.mapping ?? {}
    const seen = this.imports.some((b) => b.company_id === p.company_id && b.sha256 === p.sha256 && b.status === 'committed')
    const errors: { row: number | null; message: string }[] = []
    const unmapped: string[] = []; const keys = new Set<string>()
    let td = ZERO; let tc = ZERO; let dupFile = 0
    const num = (v: unknown) => { const t = String(v ?? '').trim(); if (t === '') return ZERO; if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error('nan'); return round2(t) }
    const rows = p.rows.map((r, i) => {
      const no = i + 1; const errs: string[] = []
      const code = String(r.account ?? '').trim()
      let d = ZERO; let c = ZERO
      try { d = num(r.debit); c = num(r.credit) } catch { errs.push('the amounts are not numbers') }
      let date: string | null = null
      if (p.kind === 'journals') {
        const t = String(r.date ?? '').trim()
        if (!t) errs.push('the date is missing')
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(t + 'T00:00:00').getTime())) errs.push('the date cannot be read')
        else date = t
        if (blank(r.ref)) errs.push('the voucher reference is missing')
      }
      let acc = undefined as ReturnType<DemoPlatform['account']>
      if (!code) errs.push('the account is missing')
      else {
        const target = blank(map[code]) ? code : map[code].trim()
        acc = this.accounts.find((a) => a.company_id === p.company_id && a.code === target)
        if (!acc) {
          if (!unmapped.includes(code)) unmapped.push(code)
          if (p.kind !== 'legacy_trial_balance') errs.push(`account ${code} is not in the chart and is not mapped`)
        } else if (p.kind !== 'legacy_trial_balance' && (acc.is_group || !acc.is_active)) errs.push(`account ${acc.code} cannot receive postings`)
      }
      if (d.lt(0) || c.lt(0)) errs.push('an amount is negative')
      if (p.kind === 'legacy_trial_balance') { if (!d.isZero() && !c.isZero()) errs.push('a balance is a debit or a credit, not both') }
      else if (d.isZero() === c.isZero()) errs.push('a line carries either a debit or a credit')
      const key = [r.ref ?? '', date ?? '', code, d, c, r.narration ?? ''].join('|')
      if (keys.has(key)) dupFile++; else keys.add(key)
      const err = errs.length ? errs.join('; ') : null
      if (err && errors.length < 200) errors.push({ row: no, message: err })
      td = td.plus(d); tc = tc.plus(c)
      return { row: no, date: date ?? undefined, ref: blank(r.ref) ? undefined : String(r.ref).trim(), account: code, name: r.name, account_id: acc?.id ?? null, debit: d.toString(), credit: c.toString(), narration: r.narration, error: err }
    })
    const unbalanced: { ref: string; debit: string; credit: string }[] = []
    let dupBooks = 0
    if (p.kind === 'journals') {
      const groups = new Map<string, typeof rows>()
      for (const r of rows) if (r.ref) groups.set(r.ref, [...(groups.get(r.ref) ?? []), r])
      for (const [ref, g] of groups) {
        const d = g.reduce((s, x) => s.plus(x.debit), ZERO); const c = g.reduce((s, x) => s.plus(x.credit), ZERO)
        if (!d.eq(c)) unbalanced.push({ ref, debit: d.toString(), credit: c.toString() })
        if (new Set(g.map((x) => x.date)).size > 1) errors.push({ row: null, message: `voucher ${ref} carries more than one date` })
        const dt = g.map((x) => x.date).filter(Boolean).sort()[0]
        // already in the books? same date, same total and the same reference in the narration
        if (this.journals.some((j) => j.company_id === p.company_id && j.journal_date === dt && D(j.total).eq(d) && !['cancelled', 'rejected'].includes(j.status) && (j.narration ?? '').toLowerCase().includes(ref.toLowerCase()))) dupBooks++
      }
    } else if (!td.eq(tc)) unbalanced.push({ ref: 'whole file', debit: td.toString(), credit: tc.toString() })
    const ok = !errors.length && !unbalanced.length && !seen && (p.kind === 'legacy_trial_balance' || !unmapped.length)
    const b: ImportBatch = {
      id: uid(), company_id: p.company_id, kind: p.kind, file_name: p.file_name.trim(), sha256: p.sha256, period_end: p.period_end ?? null, status: 'staged', row_count: rows.length, rows, mapping: map, ok, committed: {}, note: p.note ?? null, created_by: this.actor, created_at: this.now(), committed_at: null,
      checks: {
        rows: rows.length, total_debit: td.toString(), total_credit: tc.toString(),
        validation: { passed: !errors.length, errors },
        duplicates: { passed: !seen, file_already_committed: seen, repeated_rows_in_file: dupFile, vouchers_that_look_already_recorded: dupBooks, note: 'Rows repeated in the file and vouchers that look already recorded are shown for a person to judge. They do not stop the import; a file already committed does.' },
        balance: { passed: !unbalanced.length, unbalanced },
        mapping: { passed: !unmapped.length, unmapped },
      },
    }
    this.imports.push(b)
    this.log(p.company_id, 'import_batches', b.id, 'insert', null, { kind: b.kind, file_name: b.file_name, rows: b.row_count, ok }, null)
    return b.id
  }
  /** Commit puts journals and opening balances into the books as DRAFTS. They are then submitted and approved like any entry. */
  async commitImport(id: ID): Promise<{ records: number; journal_ids: ID[] }> {
    const b = this.imports.find((x) => x.id === id) ?? fail('import not found.')
    if (b.status !== 'staged') fail(`this import is ${b.status}.`)
    if (!b.ok) fail('the file did not pass its checks. Correct the file or the mapping and bring it in again; nothing of it has entered the books.')
    const ids: ID[] = []; let n = 0
    if (b.kind === 'journals') {
      const groups = new Map<string, typeof b.rows>()
      for (const r of b.rows) groups.set(r.ref!, [...(groups.get(r.ref!) ?? []), r])
      for (const [ref, g] of groups) {
        const j = await this.saveJournalDraft({
          company_id: b.company_id, journal_date: g.map((x) => x.date!).sort()[0], voucher_type: 'journal', narration: `${g.map((x) => x.narration).filter(Boolean).sort()[0] ?? 'Imported'} · ${ref}`,
          source: 'import', source_id: b.id, origin: 'import', idempotency_key: `import:${b.id}:${ref}`,
          lines: g.map((x) => ({ account_id: x.account_id!, debit: x.debit as string, credit: x.credit as string, description: x.narration })),
        } as Parameters<DemoPlatform['saveJournalDraft']>[0])
        ids.push(j); n++
      }
    } else if (b.kind === 'opening_balances') {
      ids.push(await this.saveJournalDraft({
        company_id: b.company_id, journal_date: b.period_end!, voucher_type: 'opening', narration: `Opening balances as at ${b.period_end} · ${b.file_name}`, source: 'import', source_id: b.id, origin: 'import', idempotency_key: `import:${b.id}:opening`,
        lines: b.rows.map((x) => ({ account_id: x.account_id!, debit: x.debit as string, credit: x.credit as string, description: `Opening balance — ${x.name ?? x.account}` })),
      } as Parameters<DemoPlatform['saveJournalDraft']>[0]))
      n = 1
    } else {
      for (const x of b.rows) this.legacyBalances.push({ id: uid(), company_id: b.company_id, batch_id: b.id, period_end: b.period_end!, legacy_code: x.account, legacy_name: x.name ?? null, account_id: x.account_id, debit: x.debit as string, credit: x.credit as string })
      n = b.rows.length
    }
    Object.assign(b, { status: 'committed', committed_at: this.now(), committed: { records: n, journal_ids: ids, rule: b.kind === 'legacy_trial_balance' ? 'Kept beside the books for comparison. Nothing was posted.' : 'Entered as drafts. Each is submitted and approved like any other entry before it is posted.' } })
    return { records: n, journal_ids: ids }
  }
  async discardImport(id: ID, reason?: string) {
    const b = this.imports.find((x) => x.id === id) ?? fail('import not found.')
    if (b.status !== 'staged') fail(`this import is ${b.status}. What has been committed is corrected in the books, not discarded.`)
    Object.assign(b, { status: 'discarded', note: blank(reason) ? b.note : reason })
  }
  async listLegacyBalances(companyIds: ID[], periodEnd?: string) { return this.legacyBalances.filter((l) => companyIds.includes(l.company_id) && (!periodEnd || l.period_end === periodEnd)).sort((a, b) => a.legacy_code.localeCompare(b.legacy_code)) }

  // ------------------------------------------------------------ analytical store
  async listFacts(companyIds: ID[], from: string, to: string) { return this.facts.filter((f) => companyIds.includes(f.company_id) && f.org_unit_id === null && f.month >= from.slice(0, 8) + '01' && f.month <= to) }
  async listFactRefresh(companyIds: ID[]) { return this.factRefresh.filter((f) => companyIds.includes(f.company_id)) }
  async refreshFacts(companyId: ID): Promise<{ rows: number; journals: number }> {
    this.company(companyId)
    const posted = new Map(this.journals.filter((j) => j.company_id === companyId && (j.status === 'posted' || j.status === 'reversed')).map((j) => [j.id, j]))
    const m = new Map<string, FactRow>()
    const add = (month: string, accountId: ID, unit: ID | null, debit: string, credit: string) => {
      const k = [month, accountId, unit ?? ''].join('|')
      const cur = m.get(k) ?? { company_id: companyId, month, account_id: accountId, org_unit_id: unit, debit: '0', credit: '0', entries: 0 }
      m.set(k, { ...cur, debit: D(cur.debit).plus(debit).toString(), credit: D(cur.credit).plus(credit).toString(), entries: cur.entries + 1 })
    }
    for (const l of this.lines) {
      const j = posted.get(l.journal_id)
      if (!j) continue
      const month = j.journal_date.slice(0, 8) + '01'
      add(month, l.account_id, null, l.debit, l.credit)
      for (const u of Object.values(l.dims)) if (u) add(month, l.account_id, u, l.debit, l.credit)
    }
    this.facts = [...this.facts.filter((f) => f.company_id !== companyId), ...m.values()]
    const last = [...posted.values()].reduce<string | null>((x, j) => (!x || (j.posted_at ?? '') > x ? j.posted_at ?? x : x), null)
    this.factRefresh = [...this.factRefresh.filter((f) => f.company_id !== companyId), { company_id: companyId, refreshed_at: this.now(), last_posted_at: last, rows: m.size, journals: posted.size }]
    return { rows: m.size, journals: posted.size }
  }
}
