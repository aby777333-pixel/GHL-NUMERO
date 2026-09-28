import Decimal from 'decimal.js'
import { D, ZERO, round2 } from '@/lib/money'
import { today } from '@/lib/dates'
import type { ID, JournalLineInput, Num } from '@/engine/types'
import type { AssetEvent } from '@/engine/opsTypes'
import type {
  Allocation, AllocationInput, AllocationRecipient, AttentionClass, Case, CaseEvent, CaseInput, CaseKind, CaseStatus, CaseUpdate, Confirmation, ConfirmationAction,
  ConfirmationInput, Materiality, Reclassification, ReclassificationInput, VerificationEntry, VerificationInput, VerificationLine, VerificationRun, VerifyResult,
} from '@/engine/p3Types'
import { DemoInvest } from './demoInvest'
import { fail, uid } from './demoCore'

// =====================================================================
// DEMO ENGINE — REALITY AND CONTROL. Mirrors migration 0016.
// Materiality, cases and their history, physical verification,
// confirmation of balances, reclassification, allocation of cost.
// Nothing here alters a posted entry, and nothing here calls a
// difference a fraud.
// =====================================================================

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const STATUSES: CaseStatus[] = ['open', 'triage', 'under_review', 'investigating', 'substantiated', 'unsubstantiated', 'remediated', 'closed']
const CLASSES: AttentionClass[] = ['information', 'finance_action', 'management_action', 'owner_action', 'critical']
const KINDS: CaseKind[] = ['reality', 'sentinel', 'incident', 'verification', 'confirmation', 'other']
const CONTROL = ['bank', 'cash', 'receivable', 'payable', 'tax', 'intercompany']

export class DemoControl extends DemoInvest {
  materiality: Materiality[] = []
  cases: Case[] = []
  caseEvents: CaseEvent[] = []
  verifications: VerificationRun[] = []
  verificationLines: VerificationLine[] = []
  confirmations: Confirmation[] = []
  reclassifications: Reclassification[] = []
  allocations: Allocation[] = []

  constructor() {
    super()
    const set = (list: { id: ID; status: string }[]) => (w: { source_id: ID }, e: string) => { const r = list.find((x) => x.id === w.source_id); if (r) r.status = e === 'posted' ? 'posted' : e === 'voided' ? 'rejected' : 'reversed' }
    this.handlers.reclassification = (w, e) => set(this.reclassifications)(w, e)
    this.handlers.allocation = (w, e) => set(this.allocations)(w, e)
  }

  protected override confidentialRecords() { return { ...super.confidentialRecords(), cases: this.cases, confirmations: this.confirmations } }

  // ------------------------------------------------------------ materiality
  async listMateriality(companyIds: ID[]) { return this.materiality.filter((m) => companyIds.includes(m.company_id)) }
  async setMateriality(companyId: ID, amount: Num, pct: Num | null, note: string) {
    this.company(companyId)
    if (amount === null || amount === undefined || D(amount).lt(0)) fail('the threshold is an amount of zero or more.')
    if (blank(note)) fail('record the basis of the threshold.')
    const old = this.materiality.find((m) => m.company_id === companyId)
    const row: Materiality = { company_id: companyId, amount: round2(amount).toString(), pct: pct ?? null, note, set_by: this.actor, set_at: this.now() }
    this.materiality = [...this.materiality.filter((m) => m.company_id !== companyId), row]
    this.log(companyId, 'materiality', null, old ? 'update' : 'insert', old ?? null, row, note)
  }
  /** a threshold for attention, never a reason to erase */
  protected isMaterial(companyId: ID, difference: Decimal.Value | null | undefined) {
    return D(difference ?? 0).abs().gt(this.materiality.find((m) => m.company_id === companyId)?.amount ?? 0)
  }

  // ------------------------------------------------------------ cases
  protected theCase(id: ID) { return this.cases.find((c) => c.id === id) ?? fail('case not found.') }
  protected caseEvent(c: Case, event: CaseEvent['event'], e: Partial<CaseEvent> = {}) {
    this.caseEvents.push({ id: this.caseEvents.length + 1, case_id: c.id, company_id: c.company_id, event, from_status: null, to_status: null, note: null, detail: {}, actor: this.actor, at: this.now(), ...e })
  }
  async listCases(f: { companyIds: ID[]; openOnly?: boolean }) {
    return this.cases.filter((c) => f.companyIds.includes(c.company_id) && this.canViewLevel(c.confidentiality) && (!f.openOnly || c.status !== 'closed')).sort((a, b) => b.opened_at.localeCompare(a.opened_at))
  }
  async getCase(id: ID) {
    const c = this.theCase(id)
    if (!this.canViewLevel(c.confidentiality)) fail('case not found.')
    return { ...c, events: this.caseEvents.filter((e) => e.case_id === id) }
  }
  async openCase(p: CaseInput): Promise<ID> {
    this.company(p.company_id)
    const kind = p.kind ?? 'reality'
    if (!KINDS.includes(kind)) fail('unknown kind of case.')
    if (blank(p.title)) fail('a case needs a title.')
    this.clearance(p.confidentiality)
    if (!CLASSES.includes(p.attention ?? 'finance_action')) fail('unknown class of attention.')
    for (const k of p.links ?? []) if (blank(k.entity) || !k.entity_id) fail('each linked record names its kind and its record.')
    if (p.dedupe_key) {
      // the same difference is one case, however often it is found
      const ex = this.cases.find((c) => c.company_id === p.company_id && c.dedupe_key === p.dedupe_key)
      if (ex) return ex.id
    }
    const al = p.alert_id ? this.alerts.find((a) => a.id === p.alert_id && a.company_id === p.company_id) ?? fail('the alert belongs to another company.') : undefined
    const c: Case = {
      id: uid(), company_id: p.company_id, case_no: this.docNo(p.company_id, 'case', 'CASE', today()), kind, title: p.title.trim(), summary: p.summary ?? null, status: 'open', attention: p.attention ?? 'finance_action',
      amount: p.amount ?? null, owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null, links: p.links ?? [], finding: p.finding ?? {}, dedupe_key: p.dedupe_key ?? null, alert_id: al?.id ?? null,
      confidentiality: p.confidentiality ?? 'internal', resolution: null, opened_by: this.actor, opened_at: this.now(), closed_by: null, closed_at: null,
    }
    this.cases.push(c)
    this.caseEvent(c, 'opened', { to_status: 'open', note: p.summary ?? null })
    if (al && al.status === 'open') Object.assign(al, { status: 'reviewing', review_note: 'A case was opened.' })
    this.log(p.company_id, 'cases', c.id, 'insert', null, c, null)
    this.onCaseAssigned(c)
    return c.id
  }
  /** the platform layer tells the person a case is given to */
  protected onCaseAssigned(_c: Case) { /* notifications arrive with the platform layer */ }
  async updateCase(p: CaseUpdate) {
    const c = this.theCase(p.id)
    if (!this.canViewLevel(c.confidentiality)) fail('you are not cleared for this case.', '42501')
    const note = blank(p.note) ? null : p.note!.trim()
    const has = (k: keyof CaseUpdate) => Object.prototype.hasOwnProperty.call(p, k)
    if (p.status && p.status !== c.status) {
      if (!STATUSES.includes(p.status)) fail('unknown status.')
      if (!note) fail('a change of status records what was found or decided.')
      if (p.status === 'closed' && blank(p.resolution ?? c.resolution)) fail('a case is closed with its resolution.')
      this.caseEvent(c, c.status === 'closed' ? 'reopened' : 'status', { from_status: c.status, to_status: p.status, note })
      Object.assign(c, { status: p.status, resolution: p.resolution ?? c.resolution, closed_at: p.status === 'closed' ? this.now() : null, closed_by: p.status === 'closed' ? this.actor : null })
      const al = c.alert_id ? this.alerts.find((a) => a.id === c.alert_id) : undefined
      if (al && ['unsubstantiated', 'remediated', 'closed'].includes(p.status) && ['open', 'reviewing'].includes(al.status))
        Object.assign(al, { status: p.status === 'unsubstantiated' ? 'false_positive' : 'resolved', review_note: note })
    } else if (note) this.caseEvent(c, 'note', { note })
    if (has('owner_user') || has('owner_name')) {
      const before = c.owner_user
      Object.assign(c, { owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null })
      this.caseEvent(c, 'owner', { note, detail: { owner_user: p.owner_user ?? null, owner_name: p.owner_name ?? null } })
      if (c.owner_user && c.owner_user !== before) this.onCaseAssigned(c)
    }
    if (p.attention && p.attention !== c.attention) {
      if (!CLASSES.includes(p.attention)) fail('unknown class of attention.')
      this.caseEvent(c, 'attention', { note, detail: { from: c.attention, to: p.attention } })
      c.attention = p.attention
    }
    for (const k of p.add_links ?? []) {
      if (blank(k.entity) || !k.entity_id) fail('each linked record names its kind and its record.')
      if (!c.links.some((x) => x.entity === k.entity && x.entity_id === k.entity_id)) c.links = [...c.links, k]
      this.caseEvent(c, 'link', { note, detail: { ...k } })
    }
  }

  // ------------------------------------------------------------ physical verification
  protected ledgerAt(companyId: ID, accountId: ID, to: string) { return this.ledgerBalance(companyId, accountId, to) }
  protected run(id: ID) { return this.verifications.find((r) => r.id === id) ?? fail('verification not found.') }
  async listVerifications(companyIds: ID[]) { return this.verifications.filter((r) => companyIds.includes(r.company_id)).sort((a, b) => b.run_date.localeCompare(a.run_date) || b.verify_no.localeCompare(a.verify_no)) }
  async getVerification(id: ID) { const r = this.run(id); return { ...r, lines: this.verificationLines.filter((l) => l.run_id === id).sort((a, b) => a.label.localeCompare(b.label)) } }
  async openVerification(p: VerificationInput): Promise<ID> {
    this.company(p.company_id)
    if (!['assets', 'inventory', 'cash', 'documents'].includes(p.subject)) fail('state what is verified: assets, inventory, cash or documents.')
    const s = (p.scope ?? {}) as Record<string, string | undefined>
    if (p.subject === 'inventory' && !this.warehouses.some((w) => w.id === s.warehouse_id && w.company_id === p.company_id)) fail('choose the location whose stock is verified.')
    const date = p.run_date ?? today()
    const id = uid()
    const line = (l: Partial<VerificationLine> & Pick<VerificationLine, 'entity' | 'entity_id' | 'label'>): VerificationLine =>
      ({ id: uid(), run_id: id, company_id: p.company_id, sub_id: null, place: null, book_qty: null, book_value: null, found_qty: null, found_value: null, result: 'not_checked', note: null, ...l })
    let lines: VerificationLine[] = []
    if (p.subject === 'assets') {
      lines = this.assets.filter((a) => a.company_id === p.company_id && a.status === 'active' && this.canViewLevel(a.confidentiality)
        && (!s.category_id || a.category_id === s.category_id) && (!s.org_unit_id || a.org_unit_id === s.org_unit_id) && (blank(s.location) || (a.location ?? '').toLowerCase().includes(s.location!.toLowerCase())))
        .map((a) => line({ entity: 'fixed_assets', entity_id: a.id, label: `${a.asset_no} · ${a.name}`, place: [a.location, this.orgUnits.find((u) => u.id === a.org_unit_id)?.name].filter(Boolean).join(' · ') || null, book_qty: 1, book_value: D(a.cost).minus(a.accumulated_depreciation).toString() }))
    } else if (p.subject === 'inventory') {
      const wh = this.warehouses.find((w) => w.id === s.warehouse_id)!
      lines = this.stockRows([p.company_id]).filter((r) => r.warehouse_id === wh.id && !D(r.qty).isZero()).map((r) => {
        const it = this.invItems.find((i) => i.id === r.item_id)!
        const lot = this.invLots.find((l) => l.id === r.lot_id)
        const unit = D(it.qty_on_hand).isZero() ? ZERO : D(it.value_on_hand).div(it.qty_on_hand)
        return line({ entity: 'inv_items', entity_id: it.id, sub_id: r.lot_id, label: `${it.sku} · ${it.name}${lot ? ' · ' + lot.lot_no : ''}`, place: wh.code, book_qty: r.qty, book_value: round2(D(r.qty).times(unit)).toString() })
      })
    } else if (p.subject === 'cash') {
      lines = this.cashBoxes.filter((b) => b.company_id === p.company_id && b.is_active && (!s.box_id || b.id === s.box_id))
        .map((b) => line({ entity: 'cash_boxes', entity_id: b.id, label: b.name, place: b.custodian_name ?? null, book_value: this.ledgerAt(p.company_id, b.ledger_account_id, date).toString() }))
    } else {
      lines = this.documents.filter((d) => d.company_id === p.company_id && d.status !== 'rejected' && this.canViewLevel(d.confidentiality) && (!s.doc_kind || d.doc_kind === s.doc_kind) && (!s.party_id || d.party_id === s.party_id))
        .map((d) => line({ entity: 'documents', entity_id: d.id, label: d.name + (d.reference ? ' · ' + d.reference : ''), place: d.doc_kind, book_value: d.amount ?? null }))
    }
    if (!lines.length) fail('nothing in the books falls within what was chosen, so there is nothing to verify.')
    const r: VerificationRun = { id, company_id: p.company_id, verify_no: this.docNo(p.company_id, 'verification', 'VER', date), subject: p.subject, run_date: date, scope: p.scope ?? {}, status: 'open', performed_by_name: p.performed_by_name ?? null, witness_name: p.witness_name ?? null, note: p.note ?? null, summary: {}, created_by: this.actor, created_at: this.now(), completed_at: null }
    this.verifications.push(r)
    this.verificationLines.push(...lines)
    return id
  }
  async recordVerification(runId: ID, lines: VerificationEntry[]): Promise<number> {
    const r = this.run(runId)
    if (r.status !== 'open') fail(`this verification is ${r.status}.`)
    const changes: [VerificationLine, Partial<VerificationLine>][] = []
    for (const l of lines) {
      const ln = this.verificationLines.find((x) => x.id === l.id && x.run_id === r.id) ?? fail('a line does not belong to this verification.')
      let res: VerifyResult | undefined = l.result
      if (r.subject === 'inventory' || r.subject === 'cash') {
        // what was found decides the result: it either agrees with the books or it does not
        if (r.subject === 'inventory' && (l.found_qty === undefined || l.found_qty === null)) fail(`state the quantity found for ${ln.label}.`)
        if (r.subject === 'cash' && (l.found_value === undefined || l.found_value === null)) fail(`state the amount found in ${ln.label}.`)
        res = (r.subject === 'inventory' ? D(l.found_qty!).eq(ln.book_qty ?? 0) : round2(l.found_value!).eq(round2(ln.book_value ?? 0))) ? 'matched' : 'difference'
      } else if (!res || !['located', 'transferred', 'damaged', 'missing', 'disposed', 'not_checked'].includes(res)) fail(`the result for ${ln.label} must be located, transferred, damaged, missing or disposed.`)
      if (!['located', 'matched', 'not_checked'].includes(res!) && blank(l.note)) fail(`say what was found for ${ln.label}.`)
      changes.push([ln, { result: res, found_qty: l.found_qty ?? null, found_value: l.found_value ?? null, note: l.note ?? null }])
    }
    changes.forEach(([ln, c]) => Object.assign(ln, c))
    return changes.length
  }
  /** A sheet opened by mistake: what was entered stays on it, and nothing is raised from it. */
  async cancelVerification(id: ID, reason: string) {
    const r = this.run(id)
    if (r.status !== 'open') fail(`this verification is ${r.status}. What was completed stays as it was found.`)
    if (blank(reason)) fail('a reason is required.')
    Object.assign(r, { status: 'cancelled', note: [r.note?.trim(), 'Cancelled: ' + reason.trim()].filter(Boolean).join(' · '), completed_at: this.now() })
    this.log(r.company_id, 'verification_runs', r.id, 'update', null, { status: 'cancelled' }, reason)
  }
  /** Completing a verification records what was found. It changes nothing in the books. */
  async completeVerification(id: ID, note?: string): Promise<Record<string, unknown>> {
    const r = this.run(id)
    if (r.status !== 'open') fail(`this verification is ${r.status}.`)
    const all = this.verificationLines.filter((l) => l.run_id === id)
    const open = all.filter((l) => l.result === 'not_checked').length
    if (open > 0 && blank(note)) fail(`${open} item(s) were not checked. Say why before the verification is completed.`)
    const agrees = (l: VerificationLine) => l.result === 'located' || l.result === 'matched'
    const event = (assetId: ID, detail: Record<string, unknown>) => {
      const ev: AssetEvent = { id: uid(), asset_id: assetId, company_id: r.company_id, event_type: 'verification', event_date: r.run_date, amount: null, status: 'recorded', detail, journal_id: null, created_by: this.actor, created_at: this.now() }
      this.assetEvents.push(ev)
    }
    for (const ln of all) {
      if (ln.result === 'not_checked') continue
      if (r.subject === 'assets') event(ln.entity_id, agrees(ln) ? { result: 'located', verification: r.verify_no, verified_by: r.performed_by_name } : { result: ln.result, note: ln.note, verification: r.verify_no, verified_by: r.performed_by_name })
      if (agrees(ln)) continue
      const diff = r.subject === 'inventory' ? round2(D(ln.found_qty ?? 0).minus(ln.book_qty ?? 0).times(D(ln.book_qty ?? 0).isZero() ? 0 : D(ln.book_value ?? 0).div(ln.book_qty!)))
        : r.subject === 'cash' ? D(ln.found_value ?? 0).minus(ln.book_value ?? 0) : D(ln.book_value ?? 0).neg()
      const material = this.isMaterial(r.company_id, diff)
      const found = r.subject === 'inventory' ? `at ${D(ln.found_qty ?? 0)} against ${D(ln.book_qty ?? 0)} in the books`
        : r.subject === 'cash' ? `at ${D(ln.found_value ?? 0)} against ${D(ln.book_value ?? 0)} in the books` : `to be ${ln.result.replace(/_/g, ' ')}, while the books carry it at ${D(ln.book_value ?? 0)}`
      this.raise(r.company_id, 'verification_difference', material || ln.result === 'missing' ? 'priority' : 'review', `VERIFICATION — ${ln.label}: ${ln.result.replace(/_/g, ' ')}`,
        `Verification ${r.verify_no} of ${r.run_date} found ${ln.label} ${found}. ${ln.note ?? ''} The books have not been changed. Whether this is an error of recording, of counting or a loss is for a person to establish.`,
        { run_id: r.id, line_id: ln.id, result: ln.result, difference: diff.toString(), above_materiality: material, rule: 'what was found differs from what the books say' }, ln.entity, ln.entity_id, 'verify:' + ln.id)
    }
    const differ = all.filter((l) => !agrees(l) && l.result !== 'not_checked')
    const summary = {
      lines: all.length, agree: all.filter(agrees).length, differ: differ.length, not_checked: open,
      book_value: all.reduce((s, l) => s.plus(l.book_value ?? 0), ZERO).toString(), book_value_of_differences: differ.reduce((s, l) => s.plus(l.book_value ?? 0), ZERO).toString(),
      method: 'Agreement = items found as the books describe them ÷ items checked. Items not checked are counted in neither.',
    }
    Object.assign(r, { status: 'completed', summary, note: blank(note) ? r.note : note, completed_at: this.now() })
    this.log(r.company_id, 'verification_runs', r.id, 'update', null, { status: 'completed', summary }, note ?? null)
    return summary
  }

  // ------------------------------------------------------------ confirmation of balances
  protected partyBalance(companyId: ID, partyId: ID, controls: string[], to: string, sign: 1 | -1) {
    const posted = this.postedSet(to)
    let b = ZERO
    for (const l of this.lines) {
      if (l.company_id !== companyId || l.party_id !== partyId || !posted.has(l.journal_id)) continue
      if (controls.includes(this.account(l.account_id)?.control_type ?? '')) b = b.plus(D(l.debit).minus(l.credit).times(sign))
    }
    return b
  }
  protected icBalance(companyId: ID, counter: ID, to: string) {
    const posted = this.postedSet(to)
    let b = ZERO
    for (const l of this.lines) {
      if (l.company_id !== companyId || !posted.has(l.journal_id)) continue
      const a = this.account(l.account_id)
      if (a?.control_type === 'intercompany' && a.counterparty_company_id === counter) b = b.plus(l.debit).minus(l.credit)
    }
    return b
  }
  protected confirmation(id: ID) {
    const c = this.confirmations.find((x) => x.id === id) ?? fail('confirmation not found.')
    if (!this.canViewLevel(c.confidentiality)) fail('you are not cleared for this record.', '42501')
    return c
  }
  async listConfirmations(companyIds: ID[]) { return this.confirmations.filter((c) => companyIds.includes(c.company_id) && this.canViewLevel(c.confidentiality)).sort((a, b) => b.as_of.localeCompare(a.as_of) || b.confirm_no.localeCompare(a.confirm_no)) }
  async saveConfirmation(p: ConfirmationInput): Promise<ID> {
    const co = this.company(p.company_id)
    if (!['bank', 'customer', 'vendor', 'loan', 'deposit', 'investment', 'intercompany'].includes(p.subject)) fail('state what is confirmed.')
    if (blank(p.as_of)) fail('state the date as at which the balance is confirmed.')
    let book: Decimal; let basis: string; let label: string; let entity: string; let entityId: ID | null = p.entity_id ?? null
    let party: ID | null = p.party_id ?? null; let ccy = co.base_currency; let other: Decimal | null = null
    const cleared = <T extends { confidentiality?: string }>(x: T | undefined, what: string): T => { if (!x || !this.canViewLevel(x.confidentiality ?? 'internal')) fail(`choose the ${what}.`); return x! }
    if (p.subject === 'bank') {
      const ba = this.bankAccounts.find((b) => b.id === p.entity_id && b.company_id === p.company_id) ?? fail('choose the bank account.')
      entity = 'bank_accounts'; label = ba.name + (ba.account_no_masked ? ' · ' + ba.account_no_masked : ''); ccy = ba.currency
      book = this.ledgerAt(p.company_id, ba.ledger_account_id, p.as_of)
      basis = 'Balance of the bank ledger in the books, from posted entries up to the date'
    } else if (p.subject === 'customer' || p.subject === 'vendor') {
      const pt = this.parties.find((x) => x.id === party) ?? fail('choose the party.')
      label = pt.display_name; entity = 'party'; entityId = pt.id
      book = p.subject === 'customer' ? this.partyBalance(p.company_id, pt.id, ['receivable', 'advance_received'], p.as_of, 1) : this.partyBalance(p.company_id, pt.id, ['payable', 'advance_paid'], p.as_of, -1)
      basis = p.subject === 'customer' ? 'Owed to us by the party: receivables less advances received, from posted entries up to the date' : 'Owed by us to the party: payables less advances paid, from posted entries up to the date'
    } else if (p.subject === 'loan') {
      const ln = cleared(this.loans.find((x) => x.id === p.entity_id && x.company_id === p.company_id), 'loan')
      entity = 'loans'; label = `${ln.loan_no} · ${ln.name}`; party = ln.party_id; ccy = ln.currency
      const posted = this.postedSet(p.as_of)
      book = this.lines.filter((l) => l.company_id === p.company_id && l.account_id === ln.loan_account_id && l.party_id === ln.party_id && posted.has(l.journal_id))
        .reduce((s, l) => s.plus(D(l.credit).minus(l.debit).times(ln.direction === 'borrowed' ? 1 : -1)), ZERO)
      basis = 'Principal outstanding with this party in the loan ledger, from posted entries up to the date'
    } else if (p.subject === 'deposit') {
      const fd = cleared(this.deposits.find((x) => x.id === p.entity_id && x.company_id === p.company_id), 'deposit')
      entity = 'fixed_deposits'; label = `${fd.fd_no} · ${fd.bank_name}`; party = fd.bank_party_id ?? null; ccy = fd.currency
      book = ['active', 'closed'].includes(fd.status) && fd.start_date <= p.as_of && (!fd.closed_on || fd.closed_on > p.as_of) ? D(fd.principal) : ZERO
      basis = 'Principal of the deposit as placed, where it stood on the date'
    } else if (p.subject === 'investment') {
      const h = cleared(this.holdings.find((x) => x.id === p.entity_id && x.company_id === p.company_id), 'investment')
      entity = 'holdings'; label = `${h.holding_no} · ${h.name}`; party = h.investee_party_id; ccy = h.currency
      book = this.holdingTxns.filter((t) => t.holding_id === h.id && t.status === 'posted' && t.txn_date <= p.as_of).reduce((s, t) => s.plus(t.kind === 'purchase' ? D(t.quantity ?? 0) : t.kind === 'sale' ? D(t.quantity ?? 0).neg() : 0), ZERO)
      basis = 'Quantity held, from purchases and sales posted up to the date. The balance confirmed is a quantity, not an amount'
    } else {
      const cc = this.companies.find((c) => c.id === p.counter_company_id && c.id !== p.company_id) ?? fail('choose the other company of the group.')
      label = cc.name; entity = 'companies'; entityId = cc.id
      book = this.icBalance(p.company_id, cc.id, p.as_of)
      basis = 'Net balance with the other company in our intercompany ledgers (receivable positive), from posted entries up to the date'
      other = this.icBalance(cc.id, p.company_id, p.as_of).neg()      // in the demo every person may read every company
    }
    const agrees = other !== null && round2(other).eq(round2(book))
    const c: Confirmation = {
      id: uid(), company_id: p.company_id, confirm_no: this.docNo(p.company_id, 'confirmation', 'CONF', p.as_of), subject: p.subject, party_id: party, counter_company_id: p.subject === 'intercompany' ? p.counter_company_id ?? null : null,
      entity, entity_id: entityId, label, as_of: p.as_of, currency: ccy, book_balance: book.toDecimalPlaces(4).toString(), book_basis: basis, confirmed_balance: other?.toString() ?? null,
      difference: other ? other.minus(book).toString() : null, status: other === null ? 'drafted' : agrees ? 'agreed' : 'difference', contact: p.contact ?? null, sent_on: null,
      sent_how: other !== null ? 'Read from the books of the other company' : null, received_on: other !== null ? today() : null, document_id: null, explanation: null, confidentiality: p.confidentiality ?? 'internal', created_by: this.actor, created_at: this.now(),
    }
    this.confirmations.push(c)
    if (other !== null && !agrees) this.confirmationAlert(c)
    this.log(p.company_id, 'confirmations', c.id, 'insert', null, c, null)
    return c.id
  }
  protected confirmationAlert(c: Confirmation) {
    const material = this.isMaterial(c.company_id, c.difference)
    this.raise(c.company_id, 'confirmation_difference', material ? 'priority' : 'review', `CONFIRMATION — ${c.label} differs by ${D(c.difference).abs()}`,
      `Confirmation ${c.confirm_no} as at ${c.as_of}: the books show ${c.book_balance} and the other side confirms ${c.confirmed_balance}, a difference of ${c.difference}. A difference is often timing — items in transit, or recorded on one side only. It is for a person to reconcile.`,
      { confirmation_id: c.id, book_balance: c.book_balance, confirmed_balance: c.confirmed_balance, difference: c.difference, above_materiality: material, basis: c.book_basis, rule: 'the balance confirmed differs from the books' }, 'confirmations', c.id, 'confirm:' + c.id)
  }
  /** NUMERO prepares a confirmation and records the reply. A person sends it and receives the answer. */
  async updateConfirmation(p: ConfirmationAction): Promise<string> {
    const c = this.confirmation(p.id)
    if (c.status === 'cancelled') fail('this confirmation was cancelled.')
    if (p.action === 'sent') {
      if (c.status !== 'drafted') fail(`this confirmation is already ${c.status}.`)
      if (blank(p.sent_how)) fail('record how and to whom it was sent.')
      Object.assign(c, { status: 'sent', sent_on: p.sent_on ?? today(), sent_how: p.sent_how, contact: p.contact ?? c.contact })
      return 'sent'
    }
    if (p.action === 'reply') {
      if (p.confirmed_balance === undefined || p.confirmed_balance === null || blank(p.confirmed_balance)) fail('state the balance the other side confirms.')
      if (!['drafted', 'sent', 'no_reply'].includes(c.status)) fail('a reply is already recorded.')
      if (p.document_id && !this.documents.some((d) => d.id === p.document_id && d.company_id === c.company_id)) fail('the document belongs to another company.')
      const bal = D(p.confirmed_balance).toDecimalPlaces(4)
      const agrees = round2(bal).eq(round2(c.book_balance))
      Object.assign(c, { confirmed_balance: bal.toString(), difference: bal.minus(c.book_balance).toString(), received_on: p.received_on ?? today(), document_id: p.document_id ?? null, status: agrees ? 'agreed' : 'difference' })
      if (!agrees) this.confirmationAlert(c)
      return c.status
    }
    if (p.action === 'explained' || p.action === 'disputed') {
      if (!['difference', 'explained', 'disputed'].includes(c.status)) fail('there is no difference to explain.')
      if (blank(p.explanation)) fail('record the explanation.')
      Object.assign(c, { status: p.action, explanation: p.explanation })
      return p.action
    }
    if (p.action === 'no_reply') {
      if (c.status !== 'sent') fail('only a confirmation that was sent can be marked as unanswered.')
      Object.assign(c, { status: 'no_reply', explanation: p.explanation ?? null })
      return 'no_reply'
    }
    if (p.action === 'cancel') {
      if (blank(p.explanation)) fail('a reason is required.')
      Object.assign(c, { status: 'cancelled', explanation: p.explanation })
      return 'cancelled'
    }
    return fail('unknown action.')
  }

  // ------------------------------------------------------------ reclassification
  async listReclassifications(f: { companyIds: ID[]; journalId?: ID }) {
    return this.reclassifications.filter((r) => f.companyIds.includes(r.company_id) && (!f.journalId || r.journal_id === f.journalId || r.new_journal_id === f.journalId)).sort((a, b) => b.requested_at.localeCompare(a.requested_at))
  }
  async proposeReclassification(p: ReclassificationInput): Promise<ID> {
    const l = this.lines.find((x) => x.id === p.line_id) ?? fail('entry line not found.')
    const j = this.journal(l.journal_id)
    if (!this.canViewLevel(j.confidentiality)) fail('you are not cleared for this entry.', '42501')
    if (j.status !== 'posted') fail(`only a posted entry is reclassified. This entry is ${j.status}.`)
    if (blank(p.reason)) fail('a reclassification records its reason.')
    const from = this.account(l.account_id)!
    const to = this.postingAccount(l.company_id, p.to_account_id, 'choose an active posting account of this company.')
    if (to.id === from.id) fail('the entry is already in that ledger.')
    if (CONTROL.includes(from.control_type ?? '') || CONTROL.includes(to.control_type ?? ''))
      fail('bank, cash, party, tax and intercompany ledgers record what happened with someone else. They are corrected by reversing the source document, not by reclassification.')
    const side: 'debit' | 'credit' = D(l.debit).gt(0) ? 'debit' : 'credit'
    const lineAmt = Decimal.max(l.debit, l.credit)
    const amt = round2(p.amount ?? lineAmt)
    const done = this.reclassifications.filter((r) => r.line_id === l.id && ['proposed', 'posted'].includes(r.status)).reduce((s, r) => s.plus(r.amount), ZERO)
    if (amt.lte(0) || amt.gt(lineAmt.minus(done))) fail(`the line carries ${lineAmt}, of which ${done} has been reclassified already. At most ${lineAmt.minus(done)} can be moved.`)
    const date = p.date ?? today()
    const r: Reclassification = { id: uid(), company_id: l.company_id, journal_id: j.id, line_id: l.id, from_account_id: from.id, to_account_id: to.id, amount: amt.toString(), side, reclass_date: date, reason: p.reason.trim(), status: 'proposed', new_journal_id: null, requested_by: this.actor, requested_at: this.now() }
    this.reclassifications.push(r)
    const other = side === 'debit' ? 'credit' : 'debit'
    try {
      r.new_journal_id = this.proposePosting(l.company_id, 'adjustment', date, `Reclassification of ${amt} from ${from.name} to ${to.name} — entry ${j.voucher_no ?? ''} — ${p.reason.trim()}`, 'reclassification', r.id, [
        { account_id: to.id, [side]: amt.toString(), party_id: l.party_id ?? undefined, dims: l.dims, description: `Reclassified from ${from.name}` } as JournalLineInput,
        { account_id: from.id, [other]: amt.toString(), party_id: l.party_id ?? undefined, dims: l.dims, description: `Reclassified to ${to.name}` } as JournalLineInput,
      ], { original_journal: j.id, original_voucher: j.voucher_no, original_line: l.id, from_account: from.id, to_account: to.id, amount: amt.toString(), reason: p.reason.trim(), rule: 'The original entry is unchanged. This entry moves the amount and both remain on record.' }, j.confidentiality)
    } catch (e) { this.reclassifications = this.reclassifications.filter((x) => x.id !== r.id); throw e }
    return r.new_journal_id
  }

  // ------------------------------------------------------------ allocation of cost
  async listAllocations(companyIds: ID[]) { return this.allocations.filter((a) => companyIds.includes(a.company_id)).sort((a, b) => b.period_to.localeCompare(a.period_to) || b.alloc_no.localeCompare(a.alloc_no)) }
  async saveAllocation(p: AllocationInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.name)) fail('a name is required.')
    if (blank(p.period_from) || blank(p.period_to) || p.period_to < p.period_from) fail('state the period.')
    if (!['headcount', 'revenue', 'area', 'usage', 'equal', 'manual'].includes(p.driver)) fail('state the driver the cost is shared by.')
    const amt = round2(p.amount ?? 0)
    if (amt.lte(0)) fail('the amount must be greater than zero.')
    const a = this.account(p.source_account_id)
    if (!a || a.company_id !== p.company_id || a.is_group || !a.is_active || !['expense', 'income'].includes(a.type)) fail('an allocation shares out an income or expense ledger of this company.')
    const type = p.dimension_type
    if (!type || !this.orgUnitTypes.some((t) => t.key === type)) fail('state the kind of unit the cost is shared between: department, project, branch and so on.')
    const unit = (id: ID | null | undefined, msg: string) => { const u = this.orgUnits.find((x) => x.id === id && x.company_id === p.company_id); if (!u || u.type_key !== type) fail(msg); return u! }
    const src = p.source_org_unit_id ? unit(p.source_org_unit_id, `the unit that holds the cost must be a ${type} of this company.`) : null
    // what the source holds in the period
    const posted = new Set(this.journals.filter((j) => (j.status === 'posted' || j.status === 'reversed') && j.journal_date >= p.period_from && j.journal_date <= p.period_to).map((j) => j.id))
    let pool = ZERO
    for (const l of this.lines) {
      if (l.company_id !== p.company_id || l.account_id !== a!.id || !posted.has(l.journal_id)) continue
      if (src ? Object.values(l.dims).includes(src.id) : !l.dims[type]) pool = pool.plus(l.debit).minus(l.credit)
    }
    if (a!.type === 'income') pool = pool.neg()
    if (amt.gt(pool)) fail(`${a!.name} holds ${pool} for the period${src ? ' in ' + src.name : ' without a ' + type}. No more than that can be shared out.`)
    if (!p.recipients?.length) fail('name the units that receive the cost.')
    const vals = p.recipients.map((r) => {
      const u = unit(r.org_unit_id, `every recipient must be a ${type} of this company.`)
      if (u.id === src?.id) fail('the unit that holds the cost cannot also receive it.')
      const v = p.driver === 'equal' ? D(1) : r.driver_value === undefined || r.driver_value === null ? null : D(r.driver_value)
      if (v === null || v.lt(0)) fail(`${u.name} needs the value of its driver.`)
      return { u, v: v! }
    })
    const total = vals.reduce((s, x) => s.plus(x.v), ZERO)
    if (total.lte(0)) fail('the drivers add up to nothing, so there is nothing to share by.')
    let left = amt
    const recipients: AllocationRecipient[] = vals.map((x, i) => {
      const share = i === vals.length - 1 ? left : round2(amt.times(x.v).div(total))
      left = left.minus(share)
      return { org_unit_id: x.u.id, name: x.u.name, driver_value: x.v.toString(), share_pct: x.v.times(100).div(total).toDecimalPlaces(4).toString(), amount: share.toFixed(2) }
    })
    const fields = {
      status: 'draft' as const, name: p.name.trim(), period_from: p.period_from, period_to: p.period_to, source_account_id: a!.id, source_org_unit_id: src?.id ?? null, dimension_type: type, pool_balance: pool.toString(), amount: amt.toString(),
      driver: p.driver, driver_note: p.driver_note ?? null, formula: `Share of a unit = ${amt} × its ${p.driver} ÷ total ${p.driver} of ${total}`, recipients, journal_id: null,
    }
    if (!p.id) {
      const al: Allocation = { id: uid(), company_id: p.company_id, alloc_no: this.docNo(p.company_id, 'allocation', 'ALLOC', p.period_to), created_by: this.actor, created_at: this.now(), ...fields }
      this.allocations.push(al)
      return al.id
    }
    const al = this.allocations.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('allocation not found.')
    if (!['draft', 'rejected'].includes(al.status)) fail(`only a draft can be edited. This allocation is ${al.status}.`)
    Object.assign(al, fields)
    return al.id
  }
  async proposeAllocation(id: ID): Promise<ID> {
    const al = this.allocations.find((x) => x.id === id) ?? fail('allocation not found.')
    if (!['draft', 'rejected'].includes(al.status)) fail(`this allocation is ${al.status}.`)
    const a = this.account(al.source_account_id)!
    const out = a.type === 'expense' ? 'credit' : 'debit'; const into = a.type === 'expense' ? 'debit' : 'credit'
    const lines: JournalLineInput[] = [
      { account_id: a.id, [out]: String(al.amount), dims: al.source_org_unit_id ? { [al.dimension_type]: al.source_org_unit_id } : {}, description: `Shared out — ${al.name}` } as JournalLineInput,
      ...al.recipients.filter((r) => D(r.amount ?? 0).gt(0)).map((r) => ({ account_id: a.id, [into]: String(r.amount), dims: { [al.dimension_type]: r.org_unit_id }, description: `${al.name} — ${r.share_pct}% by ${al.driver}` }) as JournalLineInput),
    ]
    const j = this.proposePosting(al.company_id, 'adjustment', al.period_to, `Allocation ${al.alloc_no} · ${al.name} — ${al.amount} of ${a.name} shared by ${al.driver}`, 'allocation', al.id, lines,
      { amount: al.amount, driver: al.driver, formula: al.formula, period_from: al.period_from, period_to: al.period_to }, 'internal')
    Object.assign(al, { status: 'proposed', journal_id: j })
    return j
  }
}
