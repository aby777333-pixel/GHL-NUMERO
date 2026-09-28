import Decimal from 'decimal.js'
import { D, ZERO, round2, sum } from '@/lib/money'
import { addMonths, daysBetween, endOfMonth, parseISO, startOfMonth, today } from '@/lib/dates'
import type { Confidentiality, ID, JournalLineInput, Num } from '@/engine/types'
import type {
  Advance, AdvanceInput, CashBox, CashBoxInput, CashCount, CashCountInput, ClaimLineDecision, CollectionPromise, CollectionPromiseInput,
  Employee, EmployeeInput, ExpenseCategory, ExpenseCategoryInput, ExpenseClaim, ExpenseClaimInput, ExpenseClaimLine, FixedDeposit,
  FixedDepositInput, FundTransfer, FundTransferInput, Loan, LoanInput, LoanInstalment, MoneyMoveInput, PayrollException, PayrollLine,
  PayrollRun, PayrollRunInput, SalaryComponent, SalaryStructure, SalaryStructureInput, WorkflowPosting,
} from '@/engine/opsTypes'
import type { CoreApi } from './types'
import type { OpsApi } from './opsApi'
import { DemoOpsA, money } from './demoOps'
import { CONF_RANK as RANK, fail, uid } from './demoCore'
import { BOOKING_PARTS } from '@/engine/p3Types'

export { uid, DEMO_USERS, DemoCore } from './demoCore'
export { DemoOpsA } from './demoOps'

// =====================================================================
// DEMO OPERATIONS ENGINE — part B
// NUMERO Flow (advances, claims, cash, transfers), treasury and payroll.
// Mirrors migrations 0008 and 0009. All data it holds is SAMPLE DATA.
// =====================================================================

type WfEvent = 'posted' | 'voided' | 'reversed'
const mon = (d: string) => new Date(d + 'T00:00:00').toLocaleString('en-GB', { month: 'short', year: 'numeric' })
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const isWeekend = (d: string) => { const n = parseISO(d).getDay(); return n === 0 || n === 6 }

export class DemoOpsB extends DemoOpsA implements CoreApi, OpsApi {
  expenseCategories: ExpenseCategory[] = []
  advances: Advance[] = []
  claims: ExpenseClaim[] = []
  claimLines: ExpenseClaimLine[] = []
  cashBoxes: CashBox[] = []
  cashCounts: CashCount[] = []
  transfers: FundTransfer[] = []
  promises: CollectionPromise[] = []
  loans: Loan[] = []
  loanSchedule: LoanInstalment[] = []
  deposits: FixedDeposit[] = []
  employees: Employee[] = []
  salaryStructures: SalaryStructure[] = []
  payrollRuns: PayrollRun[] = []
  payrollLines: PayrollLine[] = []

  constructor() {
    super()
    const h = this.handlers
    h.advance_release = (w, e) => this.wfAdvanceRelease(w, e)
    h.advance_return = (w, e) => this.wfAdvanceReturn(w, e)
    h.expense_claim = (w, e, reason) => this.wfExpenseClaim(w, e, reason)
    h.claim_payment = (w, e) => this.wfClaimPayment(w, e)
    h.fund_transfer = (w, e) => this.wfFundTransfer(w, e)
    h.fund_transfer_in = (w, e) => this.wfFundTransfer(w, e)
    h.loan_disbursement = (w, e) => this.wfLoanDisbursement(w, e)
    h.loan_instalment = (w, e) => this.wfLoanInstalment(w, e)
    h.fd_placement = (w, e) => this.wfFdPlacement(w, e)
    h.fd_closure = (w, e) => this.wfFdClosure(w, e)
    h.payroll = (w, e) => this.wfPayroll(w, e)
    h.payroll_payment = (w, e) => this.wfPayrollPayment(w, e)
  }

  // ------------------------------------------------------------ expense policy
  async listExpenseCategories(companyIds: ID[]) { return this.expenseCategories.filter((c) => companyIds.includes(c.company_id)) }
  async saveExpenseCategory(p: ExpenseCategoryInput): Promise<ID> {
    if (blank(p.name)) fail('the category needs a name.')
    this.postingAccount(p.company_id, p.account_id, 'choose an active posting account of this company.')
    const ex = p.id ? this.expenseCategories.find((c) => c.id === p.id && c.company_id === p.company_id) ?? fail('category not found.') : undefined
    const row: ExpenseCategory = {
      id: ex?.id ?? uid(), company_id: p.company_id, name: p.name.trim(), account_id: p.account_id, limit_per_item: p.limit_per_item ?? null, limit_per_day: p.limit_per_day ?? null,
      receipt_required_above: p.receipt_required_above ?? null, max_age_days: p.max_age_days ?? null, guidance: p.guidance ?? null, is_active: p.is_active ?? ex?.is_active ?? true,
    }
    if (ex) { const old = { ...ex }; Object.assign(ex, row); this.log(p.company_id, 'expense_categories', ex.id, 'update', old, row, p.reason ?? null) }
    else { this.expenseCategories.push(row); this.log(p.company_id, 'expense_categories', row.id, 'insert', null, row, null) }
    return row.id
  }

  // ------------------------------------------------------------ advances
  protected advance(id: ID) { return this.advances.find((a) => a.id === id) ?? fail('advance not found.') }
  protected outstanding(a: Advance) { return D(a.released_amount).minus(a.settled_amount).minus(a.returned_amount) }
  protected refreshAdvance(id: ID) {
    const a = this.advance(id)
    if (['draft', 'requested', 'rejected', 'cancelled'].includes(a.status)) return
    const out = this.outstanding(a)
    a.status = a.review_flag && out.gt(0) ? a.review_flag
      : D(a.released_amount).isZero() ? 'approved'
      : out.lte(0) && D(a.settled_amount).isZero() ? 'returned'
      : out.lte(0) ? 'settled'
      : a.settlement_closed ? 'return_due'
      : D(a.settled_amount).gt(0) || D(a.returned_amount).gt(0) ? 'partially_settled'
      : D(a.released_amount).lt(a.approved_amount) ? 'partially_released'
      : 'released'
  }
  async listAdvances(f: { companyIds: ID[]; partyId?: ID }) {
    return this.advances.filter((a) => f.companyIds.includes(a.company_id) && (!f.partyId || a.recipient_party_id === f.partyId) && this.canViewLevel(a.confidentiality))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async saveAdvance(p: AdvanceInput): Promise<ID> {
    const c = this.company(p.company_id)
    const pt = this.needParty(p.recipient_party_id, 'choose who receives the advance.')
    if (['blocked', 'suspended', 'terminated'].includes(pt.status)) fail(`${pt.display_name} is ${pt.status} — a new advance is not permitted.`)
    if (blank(p.purpose)) fail('the purpose of the advance is required.')
    const amt = money(p.requested_amount)
    if (amt.lte(0)) fail('the amount must be greater than zero.')
    this.needDims(p.company_id, p.dims, 'a selected dimension belongs to another company.')
    if (p.register_item_id && !this.registerItems.some((r) => r.id === p.register_item_id && r.company_id === p.company_id)) fail('the linked trip or path belongs to another company.')
    if (!p.id) {
      const a: Advance = {
        id: uid(), company_id: p.company_id, advance_no: this.docNo(p.company_id, 'advance', 'ADV', this.now().slice(0, 10)), recipient_party_id: pt.id, recipient_type: p.recipient_type ?? 'employee',
        purpose: p.purpose.trim(), register_item_id: p.register_item_id ?? null, dims: p.dims ?? {}, currency: p.currency ?? c.base_currency, requested_amount: amt.toString(), approved_amount: '0',
        released_amount: '0', settled_amount: '0', returned_amount: '0', expected_settlement_date: p.expected_settlement_date ?? null, released_on: null, payment_method: p.payment_method ?? null,
        settlement_closed: false, review_flag: null, status: 'draft', last_follow_up: null, notes: p.notes ?? null, confidentiality: this.withItem(p.confidentiality, p.register_item_id), created_by: this.actor, created_at: this.now(),
      }
      this.advances.push(a)
      this.log(p.company_id, 'advances', a.id, 'insert', null, a, null)
      return a.id
    }
    const a = this.advances.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('advance not found.')
    if (!['draft', 'rejected'].includes(a.status)) fail(`only a draft request can be edited. This advance is ${a.status}.`)
    Object.assign(a, { status: 'draft', recipient_party_id: pt.id, recipient_type: p.recipient_type ?? a.recipient_type, purpose: p.purpose.trim(), register_item_id: p.register_item_id ?? null, dims: p.dims ?? {}, requested_amount: amt.toString(), expected_settlement_date: p.expected_settlement_date ?? null, payment_method: p.payment_method ?? null, notes: p.notes ?? null })
    return a.id
  }
  async submitAdvance(id: ID) {
    const a = this.advance(id)
    if (a.status !== 'draft') fail(`this advance is ${a.status}.`)
    this.openRequest(a.company_id, 'advance', a.id, a.requested_amount, `${a.advance_no} · ${this.partyName(a.recipient_party_id)} · ${a.purpose}`)
    a.status = 'requested'
    this.log(a.company_id, 'advances', id, 'requested', null, { advance_no: a.advance_no, amount: a.requested_amount }, null)
  }
  async approveAdvance(id: ID, amount?: Num, comment?: string): Promise<'approved' | 'pending'> {
    const a = this.advance(id)
    if (a.status !== 'requested') fail(`this advance is ${a.status} and is not awaiting approval.`)
    const amt = money(amount ?? a.requested_amount)
    if (amt.lte(0) || amt.gt(a.requested_amount)) fail(`the approved amount must be greater than zero and cannot exceed the requested ${D(a.requested_amount)}.`)
    if (D(a.approved_amount).gt(0) && amt.gt(a.approved_amount)) fail(`an earlier approver authorised ${D(a.approved_amount)}. A later step may lower the amount, not raise it.`)
    // the approver must have seen the recipient's unsettled history (spec 1562): it is recorded with the decision
    const open = this.advances.filter((x) => x.recipient_party_id === a.recipient_party_id && x.company_id === a.company_id && x.id !== a.id && this.outstanding(x).gt(0))
    const res = this.decideRequest('advance', a.id, a.created_by, 'advance', comment)
    if (res === 'approved') Object.assign(a, { status: 'approved', approved_amount: amt.toString(), approved_by: this.actor, approved_at: this.now() })
    else a.approved_amount = amt.toString()
    this.log(a.company_id, 'advances', id, res === 'approved' ? 'approved' : 'approval_step', null, {
      approved_amount: amt.toString(), requested_amount: a.requested_amount, recipient_open_advances: open.length, recipient_unsettled_amount: sum(open.map((x) => this.outstanding(x))).toString(),
      note: 'Approval authorises the advance. It does not release money.',
    }, comment ?? null)
    return res
  }
  async rejectAdvance(id: ID, comment: string) {
    const a = this.advance(id)
    if (a.status !== 'requested') fail('this advance is not awaiting approval.')
    this.refuseRequest('advance', a.id, 'advance', comment)
    Object.assign(a, { status: 'rejected', approved_amount: '0' })
    this.log(a.company_id, 'advances', id, 'rejected', null, null, comment)
  }
  /** a claim or an advance is at least as confidential as the register item it is linked to */
  protected withItem(own: Confidentiality | undefined, itemId: ID | null | undefined): Confidentiality {
    const mine = own ?? 'internal'
    const item = itemId ? this.registerItems.find((r) => r.id === itemId)?.confidentiality : undefined
    return item && RANK[item] > RANK[mine] ? item : mine
  }
  /** an advance to a vendor sits in the vendor advances ledger; every other advance is held by a person */
  protected advanceAccount(a: Pick<Advance, 'company_id' | 'recipient_type'>): ID {
    return this.mapAccount(a.company_id, a.recipient_type === 'vendor' ? 'vendor_advances' : 'employee_advances')
  }
  /** the dimension of a linked register item (a trip, an event, a vehicle, a path), as line tags */
  protected itemDims(itemId: ID | null | undefined): Record<string, ID> {
    const item = itemId ? this.registerItems.find((r) => r.id === itemId) : undefined
    const unit = item?.org_unit_id ? this.orgUnits.find((u) => u.id === item.org_unit_id && u.status === 'active') : undefined
    return unit ? { [unit.type_key]: unit.id } : {}
  }
  /** Records that money was handed over. Proposes: Dr Advances (recipient) / Cr Bank or Cash. */
  async releaseAdvance(id: ID, m: MoneyMoveInput): Promise<ID> {
    const a = this.advance(id)
    if (!['approved', 'partially_released'].includes(a.status)) fail(`this advance is ${a.status} and cannot be released.`)
    if (!m.date) fail('the release date is required.')
    const amt = money(m.amount)
    const room = D(a.approved_amount).minus(a.released_amount).minus(this.pendingAmount('advance_release', a.id))
    if (amt.lte(0) || amt.gt(room)) fail(`the release must be greater than zero and cannot exceed the unreleased approved amount of ${room}.`)
    const bank = this.bankLedger(a.company_id, m.bank_ledger_id, 'choose the bank or cash ledger the money was paid from.')
    const adv = this.advanceAccount(a)
    const name = this.partyName(a.recipient_party_id)
    const j = this.proposePosting(a.company_id, 'payment', m.date, `Advance ${a.advance_no} released to ${name} — ${a.purpose}`, 'advance_release', a.id, [
      { account_id: adv, party_id: a.recipient_party_id, debit: amt.toString(), description: `Advance held by ${name} — not yet an expense`, dims: { ...this.itemDims(a.register_item_id), ...a.dims } },
      { account_id: bank.id, credit: amt.toString(), description: m.reference ?? a.advance_no },
    ], { amount: amt.toString(), date: m.date, method: m.method ?? null, reference: m.reference ?? null }, a.confidentiality)
    if (m.method) a.payment_method = m.method
    return j
  }
  protected wfAdvanceRelease(w: WorkflowPosting, event: WfEvent) {
    const a = this.advance(w.source_id)
    const amt = D(w.payload.amount as Num)
    if (event === 'posted') { a.released_amount = D(a.released_amount).plus(amt).toString(); a.released_on = a.released_on ?? (w.payload.date as string); this.refreshAdvance(a.id) }
    else if (event === 'reversed') {
      if (D(a.released_amount).minus(amt).lt(D(a.settled_amount).plus(a.returned_amount))) fail('settlements or returns have been recorded against this release. Reverse those first.')
      a.released_amount = D(a.released_amount).minus(amt).toString(); this.refreshAdvance(a.id)
    }
  }
  /** Unused money handed back. Proposes: Dr Bank or Cash / Cr Advances (recipient). */
  async returnAdvance(id: ID, m: MoneyMoveInput): Promise<ID> {
    const a = this.advance(id)
    if (!m.date) fail('the date of return is required.')
    const amt = money(m.amount)
    const room = this.outstanding(a).minus(this.pendingAmount('advance_return', a.id))
    if (amt.lte(0) || amt.gt(room)) fail(`the return must be greater than zero and cannot exceed the unsettled balance of ${room}.`)
    const bank = this.bankLedger(a.company_id, m.bank_ledger_id, 'choose the bank or cash ledger that received the money.')
    return this.proposePosting(a.company_id, 'receipt', m.date, `Unused advance ${a.advance_no} returned by ${this.partyName(a.recipient_party_id)}`, 'advance_return', a.id, [
      { account_id: bank.id, debit: amt.toString(), description: m.reference ?? a.advance_no },
      { account_id: this.advanceAccount(a), party_id: a.recipient_party_id, credit: amt.toString(), description: 'Advance returned', dims: { ...this.itemDims(a.register_item_id), ...a.dims } },
    ], { amount: amt.toString(), date: m.date, method: m.method ?? null }, a.confidentiality)
  }
  protected wfAdvanceReturn(w: WorkflowPosting, event: WfEvent) {
    const a = this.advance(w.source_id)
    const amt = D(w.payload.amount as Num)
    if (event === 'posted') a.returned_amount = D(a.returned_amount).plus(amt).toString()
    else if (event === 'reversed') a.returned_amount = Decimal.max(D(a.returned_amount).minus(amt), 0).toString()
    else return
    this.refreshAdvance(a.id)
  }
  async flagAdvance(id: ID, flag: 'disputed' | 'under_review' | 'follow_up' | 'cancelled' | null, note: string) {
    const a = this.advance(id)
    if (blank(note)) fail('a note is required.')
    if (flag === 'follow_up') a.last_follow_up = this.now().slice(0, 10)
    else if (flag === 'cancelled') {
      if (D(a.released_amount).gt(0) || this.pendingAmount('advance_release', a.id).gt(0)) fail('money has been released against this advance. It cannot be cancelled; record its settlement or return.')
      this.cancelRequests('advance', a.id)
      a.status = 'cancelled'
    } else { a.review_flag = flag; this.refreshAdvance(id) }
    this.log(a.company_id, 'advances', id, flag ?? 'review_cleared', null, null, note)
  }

  // ------------------------------------------------------------ expense claims
  protected claim(id: ID) { return this.claims.find((c) => c.id === id) ?? fail('claim not found.') }
  protected linesOf(claimId: ID) { return this.claimLines.filter((l) => l.claim_id === claimId).sort((a, b) => a.line_no - b.line_no) }
  async listClaims(f: { companyIds: ID[]; partyId?: ID; advanceId?: ID }) {
    return this.claims.filter((c) => f.companyIds.includes(c.company_id) && (!f.partyId || c.claimant_party_id === f.partyId) && (!f.advanceId || c.advance_id === f.advanceId) && this.canViewLevel(c.confidentiality))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async getClaim(id: ID) { const c = this.claim(id); return { ...c, lines: this.linesOf(id) } }
  async saveClaim(p: ExpenseClaimInput): Promise<ID> {
    const co = this.company(p.company_id)
    const pt = this.needParty(p.claimant_party_id, 'choose the person who incurred the expense.')
    if (blank(p.title)) fail('the claim needs a title.')
    if (p.advance_id) {
      const adv = this.advances.find((a) => a.id === p.advance_id)
      if (!adv || adv.company_id !== p.company_id || adv.recipient_party_id !== pt.id) fail('the advance being settled belongs to a different person or company.')
      if (this.outstanding(adv!).lte(0)) fail(`advance ${adv!.advance_no} has no unsettled balance.`)
    }
    const ex = p.id ? this.claims.find((c) => c.id === p.id && c.company_id === p.company_id) ?? fail('claim not found.') : undefined
    if (ex && !['draft', 'rejected'].includes(ex.status)) fail(`only a draft claim can be edited. This claim is ${ex.status}.`)
    if (!p.lines?.length) fail('the claim needs at least one expense line.')
    const claimId = ex?.id ?? uid()
    const now = this.now().slice(0, 10)
    let total = ZERO, flagged = 0
    const rows: ExpenseClaimLine[] = p.lines.map((l, i) => {
      const no = i + 1
      if (!l.expense_date) fail(`line ${no} needs the date of the expense.`)
      if (l.expense_date > now) fail(`line ${no} is dated in the future.`)
      if (blank(l.description)) fail(`line ${no} needs a description.`)
      const amt = money(l.amount)
      if (amt.lte(0)) fail(`line ${no} amount must be greater than zero.`)
      const cat = l.category_id ? this.expenseCategories.find((c) => c.id === l.category_id && c.company_id === p.company_id) ?? fail(`line ${no} uses an unknown expense category.`) : undefined
      const acc = this.postingAccount(p.company_id, l.account_id ?? cat?.account_id, `line ${no} needs a category or an active posting account of this company.`)
      let led: ID | null = null
      if ((l.paid_by ?? 'claimant') === 'company') {
        const a = l.paid_from_ledger_id ? this.account(l.paid_from_ledger_id) : undefined
        if (!a || a.company_id !== p.company_id || a.is_group) fail(`line ${no} was paid by the company — choose the card, cash or bank ledger it was paid from.`)
        led = a!.id
      }
      this.needDims(p.company_id, l.dims, `line ${no} references a dimension outside this company.`)
      if (l.document_id && !this.documents.some((d) => d.id === l.document_id && d.company_id === p.company_id)) fail(`line ${no} references a document of another company.`)
      const receipt = !!l.has_receipt || !!l.document_id

      // policy flags: facts for the approver, never an automatic rejection
      const flags: string[] = []
      if (cat?.limit_per_item != null && amt.gt(cat.limit_per_item)) flags.push(`OUTSIDE POLICY — above the limit of ${D(cat.limit_per_item)} per item`)
      if (cat?.limit_per_day != null) {
        const day = sum(p.lines.filter((x) => x.category_id === l.category_id && x.expense_date === l.expense_date).map((x) => x.amount))
        if (day.gt(cat.limit_per_day)) flags.push(`OUTSIDE POLICY — ${day} claimed for the day against a daily limit of ${D(cat.limit_per_day)}`)
      }
      if (!receipt && (cat?.receipt_required_above == null || amt.gt(cat.receipt_required_above))) flags.push('EVIDENCE MISSING — no receipt attached')
      const age = daysBetween(l.expense_date, now)
      if (cat?.max_age_days != null && age > cat.max_age_days) flags.push(`LATE CLAIM — expense is ${age} days old (policy ${cat.max_age_days})`)
      const dup = this.claimLines.some((o) => {
        const oc = this.claims.find((c) => c.id === o.claim_id)
        return !!oc && oc.company_id === p.company_id && oc.claimant_party_id === pt.id && oc.id !== claimId && !['rejected', 'cancelled'].includes(oc.status)
          && o.expense_date === l.expense_date && D(o.amount).eq(amt) && (o.merchant ?? '').toLowerCase() === (l.merchant ?? '').trim().toLowerCase()
      })
      if (dup) flags.push('POSSIBLE DUPLICATE — same person, date, amount and merchant on another claim')
      if (isWeekend(l.expense_date)) flags.push('WEEKEND — expense dated on a Saturday or Sunday')

      total = total.plus(amt)
      if (flags.length) flagged++
      return { id: uid(), claim_id: claimId, company_id: p.company_id, line_no: no, expense_date: l.expense_date, category_id: cat?.id ?? null, account_id: acc.id, description: l.description.trim(), merchant: (l.merchant ?? '').trim() || null, amount: amt.toString(), approved_amount: amt.toString(), paid_by: l.paid_by ?? 'claimant', paid_from_ledger_id: led, has_receipt: receipt, document_id: l.document_id ?? null, flags, approver_note: null, dims: l.dims ?? {}, detail: this.checkTravelDetail(l.detail, amt, no) }
    })
    let c: ExpenseClaim
    if (ex) {
      c = ex
      Object.assign(c, { status: 'draft', claimant_party_id: pt.id, title: p.title.trim(), purpose: p.purpose ?? null, advance_id: p.advance_id ?? null, final_settlement: !!p.final_settlement, register_item_id: p.register_item_id ?? null, notes: p.notes ?? null })
      this.claimLines = this.claimLines.filter((l) => l.claim_id !== c.id)
    } else {
      c = {
        id: claimId, company_id: p.company_id, claim_no: this.docNo(p.company_id, 'expense_claim', 'EXP', now), claimant_party_id: pt.id, title: p.title.trim(), purpose: p.purpose ?? null, advance_id: p.advance_id ?? null,
        final_settlement: !!p.final_settlement, register_item_id: p.register_item_id ?? null, currency: p.currency ?? co.base_currency, total: '0', approved_total: '0', advance_applied: '0', payable: '0', flagged_lines: 0,
        status: 'draft', journal_id: null, payment_journal_id: null, paid_on: null, notes: p.notes ?? null, decision_note: null, confidentiality: this.withItem(p.confidentiality, p.register_item_id), created_by: this.actor, created_at: this.now(),
      }
      this.claims.push(c)
      this.log(p.company_id, 'expense_claims', c.id, 'insert', null, { claim_no: c.claim_no, title: c.title }, null)
    }
    this.claimLines.push(...rows)
    Object.assign(c, { total: total.toString(), approved_total: total.toString(), flagged_lines: flagged })
    return c.id
  }
  /** A booking records its operator, reference, route and class; where its parts are given, they add up to the line. */
  protected checkTravelDetail(d: ExpenseClaimLine['detail'] | undefined, amount: Decimal, line: number): NonNullable<ExpenseClaimLine['detail']> {
    if (!d || typeof d !== 'object' || !Object.keys(d).length) return {}
    const x = d as Record<string, unknown>
    if (!['air', 'train', 'bus', 'cab', 'hotel'].includes(String(x.kind))) fail(`line ${line} — the booking is by air, train, bus, cab or a hotel stay.`)
    let sum = ZERO; let any = false
    for (const k of BOOKING_PARTS) {
      if (blank(x[k])) continue
      if (!/^-?\d+(\.\d+)?$/.test(String(x[k]).trim())) fail(`line ${line} — "${k.replace(/_/g, ' ')}" is not an amount.`)
      const v = round2(String(x[k]).trim())
      if (v.lt(0)) fail(`line ${line} — "${k.replace(/_/g, ' ')}" cannot be negative.`)
      sum = sum.plus(v); any = true
    }
    if (any && !sum.eq(round2(amount))) fail(`line ${line} — the parts of the booking add up to ${sum}, and the line is ${round2(amount)}. They must agree.`)
    if (x.kind === 'hotel' && x.check_in && x.check_out && String(x.check_out) < String(x.check_in)) fail(`line ${line} — the stay ends before it begins.`)
    return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined)) as NonNullable<ExpenseClaimLine['detail']>
  }
  async submitClaim(id: ID) {
    const c = this.claim(id)
    if (c.status !== 'draft') fail(`this claim is ${c.status}.`)
    this.openRequest(c.company_id, 'expense_claim', c.id, c.total, `${c.claim_no} · ${this.partyName(c.claimant_party_id)} · ${c.title}${c.flagged_lines > 0 ? ` · ${c.flagged_lines} line(s) flagged` : ''}`)
    c.status = 'submitted'
    this.log(c.company_id, 'expense_claims', id, 'submitted', null, { claim_no: c.claim_no, total: c.total, flagged_lines: c.flagged_lines }, null)
  }
  /** Builds and proposes the accounting entry of an approved claim. */
  protected proposeClaimPosting(id: ID): ID {
    const c = this.claim(id)
    if (c.status !== 'approved') fail('only an approved claim can be posted.')
    const name = this.partyName(c.claimant_party_id)
    const lines = this.linesOf(id).filter((l) => D(l.approved_amount).gt(0))
    if (!lines.length) fail('nothing was approved on this claim.')
    const date = lines.map((l) => l.expense_date).sort().pop()!
    const jl: JournalLineInput[] = []
    let claimant = ZERO
    const companyPaid = new Map<ID, Decimal>()
    for (const l of lines) {
      jl.push({ account_id: l.account_id, party_id: c.claimant_party_id, debit: l.approved_amount, description: `${l.description}${l.merchant ? ' · ' + l.merchant : ''} · ${l.expense_date}`, dims: { ...this.itemDims(c.register_item_id), ...l.dims } })
      if (l.paid_by === 'company') companyPaid.set(l.paid_from_ledger_id!, (companyPaid.get(l.paid_from_ledger_id!) ?? ZERO).plus(l.approved_amount))
      else claimant = claimant.plus(l.approved_amount)
    }
    for (const [ledger, amt] of companyPaid) jl.push({ account_id: ledger, credit: amt.toString(), description: `Paid by the company — ${c.claim_no}` })
    let apply = ZERO
    if (c.advance_id && claimant.gt(0)) {
      const adv = this.advance(c.advance_id)
      apply = Decimal.min(claimant, Decimal.max(this.outstanding(adv), 0))
      if (apply.gt(0)) jl.push({ account_id: this.advanceAccount(adv), party_id: c.claimant_party_id, credit: apply.toString(), description: `Settled against advance ${adv.advance_no}`, dims: { ...this.itemDims(adv.register_item_id), ...adv.dims } })
    }
    const payable = claimant.minus(apply)
    if (payable.gt(0)) jl.push({ account_id: this.mapAccount(c.company_id, 'employee_payable'), party_id: c.claimant_party_id, credit: payable.toString(), description: `Reimbursement due to ${name}` })
    const j = this.proposePosting(c.company_id, 'expense', date, `Expense claim ${c.claim_no} · ${name} · ${c.title}`, 'expense_claim', c.id, jl,
      { advance_id: c.advance_id, advance_applied: apply.toString(), payable: payable.toString(), final_settlement: c.final_settlement }, c.confidentiality)
    Object.assign(c, { journal_id: j, advance_applied: apply.toString(), payable: payable.toString() })
    return j
  }
  async approveClaim(id: ID, comment?: string, decisions?: ClaimLineDecision[]): Promise<'approved' | 'pending'> {
    const c = this.claim(id)
    if (c.status === 'approved' && !c.journal_id) { this.proposeClaimPosting(id); return 'approved' } // the entry was rejected earlier; it is issued again
    if (c.status !== 'submitted') fail(`this claim is ${c.status} and is not awaiting approval.`)
    const lines = this.linesOf(id)
    const next = new Map(lines.map((l) => [l.id, { amount: D(l.approved_amount), note: l.approver_note }]))
    for (const x of decisions ?? []) {
      const ln = lines.find((l) => l.id === x.line_id) ?? fail('a line decision refers to a line that is not on this claim.')
      const amt = money(x.approved_amount)
      if (amt.lt(0) || amt.gt(ln.amount)) fail(`line ${ln.line_no} — the approved amount must be between zero and the claimed ${D(ln.amount)}.`)
      if (amt.lt(ln.amount) && blank(x.note)) fail(`line ${ln.line_no} — give the reason for approving less than was claimed.`)
      next.set(ln.id, { amount: amt, note: x.note ?? null })
    }
    if (lines.some((l) => l.flags.length && next.get(l.id)!.amount.gt(0)) && blank(comment)) fail('this claim has flagged lines. Record your reason for approving them.')
    const total = sum([...next.values()].map((v) => v.amount))
    // everything that can refuse is checked before anything is recorded (the database does this in one transaction)
    const req = this.approvalRequests.find((r) => r.entity === 'expense_claim' && r.entity_id === id && r.status === 'pending') ?? fail('this expense claim is not awaiting approval.')
    if (req.current_step >= req.steps.length && total.lte(0)) fail('nothing is approved on this claim. Reject it instead.')
    const res = this.decideRequest('expense_claim', c.id, c.created_by, 'expense claim', comment)
    lines.forEach((l) => { const v = next.get(l.id)!; l.approved_amount = v.amount.toString(); l.approver_note = v.note ?? null })
    c.approved_total = total.toString()
    if (res === 'approved') {
      Object.assign(c, { status: 'approved', decision_note: comment ?? null, approved_by: this.actor, approved_at: this.now() })
      this.proposeClaimPosting(id)
    }
    this.log(c.company_id, 'expense_claims', id, res === 'approved' ? 'approved' : 'approval_step', null, { claimed: c.total, approved: total.toString(), flagged_lines: c.flagged_lines, note: 'Approval accepts the expense. The accounting entry is approved separately; payment is a further step.' }, comment ?? null)
    return res
  }
  async rejectClaim(id: ID, comment: string) {
    const c = this.claim(id)
    if (c.status !== 'submitted') fail('this claim is not awaiting approval.')
    this.refuseRequest('expense_claim', c.id, 'expense claim', comment)
    Object.assign(c, { status: 'rejected', decision_note: comment })
    this.log(c.company_id, 'expense_claims', id, 'rejected', null, null, comment)
  }
  async cancelClaim(id: ID, reason: string) {
    const c = this.claim(id)
    if (!['draft', 'submitted', 'rejected'].includes(c.status) && !(c.status === 'approved' && !c.journal_id)) fail(`this claim is ${c.status} and can no longer be cancelled. Reverse its journal instead.`)
    if (blank(reason)) fail('a reason is required.')
    this.cancelRequests('expense_claim', c.id)
    Object.assign(c, { status: 'cancelled', decision_note: reason })
    this.log(c.company_id, 'expense_claims', id, 'cancelled', null, null, reason)
  }
  protected wfExpenseClaim(w: WorkflowPosting, event: WfEvent, reason?: string) {
    const c = this.claim(w.source_id)
    const apply = D((w.payload.advance_applied as Num) ?? 0), payable = D((w.payload.payable as Num) ?? 0)
    const advId = w.payload.advance_id as ID | null
    if (event === 'posted') {
      Object.assign(c, { status: payable.gt(0) ? 'posted' : 'paid', paid_on: payable.gt(0) ? null : this.now().slice(0, 10) })
      if (advId) { const a = this.advance(advId); a.settled_amount = D(a.settled_amount).plus(apply).toString(); a.settlement_closed = a.settlement_closed || !!w.payload.final_settlement; this.refreshAdvance(advId) }
    } else if (event === 'voided') Object.assign(c, { journal_id: null, advance_applied: '0', payable: '0' })
    else {
      if (c.status === 'paid' && c.payment_journal_id) fail('this claim has been reimbursed. Reverse the reimbursement first.')
      if (this.postings.some((x) => x.source === 'claim_payment' && x.source_id === c.id && x.status === 'pending')) fail('a reimbursement for this claim is awaiting approval. Reject it first.')
      Object.assign(c, { status: 'cancelled', decision_note: 'Accounting entry reversed: ' + (reason ?? '') })
      if (advId) { const a = this.advance(advId); a.settled_amount = Decimal.max(D(a.settled_amount).minus(apply), 0).toString(); a.settlement_closed = false; this.refreshAdvance(advId) }
    }
  }
  /** Reimbursement. Proposes: Dr Reimbursements payable (claimant) / Cr Bank or Cash. */
  async payClaim(id: ID, m: Omit<MoneyMoveInput, 'amount'>): Promise<ID> {
    const c = this.claim(id)
    if (c.status !== 'posted' || D(c.payable).lte(0)) fail(`this claim is ${c.status} and has nothing awaiting reimbursement.`)
    if (!m.date) fail('the payment date is required.')
    const bank = this.bankLedger(c.company_id, m.bank_ledger_id, 'choose the bank or cash ledger the reimbursement was paid from.')
    return this.proposePosting(c.company_id, 'payment', m.date, `Reimbursement of ${c.claim_no} to ${this.partyName(c.claimant_party_id)}`, 'claim_payment', c.id, [
      { account_id: this.mapAccount(c.company_id, 'employee_payable'), party_id: c.claimant_party_id, debit: c.payable, description: `Reimbursement — ${c.claim_no}` },
      { account_id: bank.id, credit: c.payable, description: m.reference ?? c.claim_no },
    ], { amount: c.payable, date: m.date, reference: m.reference ?? null }, c.confidentiality)
  }
  protected wfClaimPayment(w: WorkflowPosting, event: WfEvent) {
    const c = this.claim(w.source_id)
    if (event === 'posted') Object.assign(c, { status: 'paid', payment_journal_id: w.journal_id, paid_on: w.payload.date })
    else if (event === 'reversed') Object.assign(c, { status: 'posted', payment_journal_id: null, paid_on: null })
  }

  // ------------------------------------------------------------ cash boxes and counts
  protected override confidentialRecords() {
    return { advances: this.advances, expense_claims: this.claims, loans: this.loans, fixed_deposits: this.deposits, employees: this.employees }
  }
  protected override checkCashBoxLimit(companyId: ID, journalId: ID, narration: string, source: string) {
    for (const l of this.linesByJournal.get(journalId) ?? []) {
      const b = this.cashBoxes.find((x) => x.company_id === companyId && x.is_active && x.ledger_account_id === l.account_id)
      if (!b || b.max_single_payment == null || D(b.max_single_payment).lte(0) || D(l.credit).lte(b.max_single_payment)) continue
      this.raise(companyId, 'cash_box_limit_exceeded', 'review', 'CASH BOX — payment above the limit for a single payment',
        `A payment of ${round2(D(l.credit))} from cash box "${b.name}" is above its limit of ${round2(D(b.max_single_payment))} for a single payment. Entry: ${narration || 'no narration'}. The payment is recorded; whether it is in order is for a person to decide.`,
        { box_id: b.id, journal_id: journalId, amount: round2(D(l.credit)).toString(), limit: round2(D(b.max_single_payment)).toString(), source, rule: 'a single payment from a cash box above its configured limit is raised for review' },
        'journals', journalId, `cashboxlimit:${journalId}:${b.id}`)
    }
  }
  async listCashBoxes(companyIds: ID[]) { return this.cashBoxes.filter((b) => companyIds.includes(b.company_id)) }
  async saveCashBox(p: CashBoxInput): Promise<ID> {
    if (blank(p.name)) fail('the cash box needs a name.')
    const a = this.account(p.ledger_account_id)
    if (!a || a.company_id !== p.company_id || a.control_type !== 'cash' || a.is_group) fail('choose a cash ledger of this company.')
    if (p.custodian_party_id) this.needParty(p.custodian_party_id, 'unknown custodian.')
    this.needUnit(p.company_id, p.org_unit_id)
    const ex = p.id ? this.cashBoxes.find((b) => b.id === p.id && b.company_id === p.company_id) ?? fail('cash box not found.') : undefined
    const row: CashBox = { id: ex?.id ?? uid(), company_id: p.company_id, name: p.name.trim(), ledger_account_id: p.ledger_account_id, custodian_party_id: p.custodian_party_id ?? null, custodian_name: p.custodian_name ?? null, org_unit_id: p.org_unit_id ?? null, float_amount: p.float_amount ?? 0, min_balance: p.min_balance ?? 0, max_single_payment: p.max_single_payment ?? null, is_active: p.is_active ?? ex?.is_active ?? true }
    if (ex) { const old = { ...ex }; Object.assign(ex, row); this.log(p.company_id, 'cash_boxes', ex.id, 'update', old, row, null) }
    else { this.cashBoxes.push(row); this.log(p.company_id, 'cash_boxes', row.id, 'insert', null, row, null) }
    return row.id
  }
  async listCashCounts(boxId: ID) { return this.cashCounts.filter((c) => c.box_id === boxId).sort((a, b) => b.count_date.localeCompare(a.count_date) || b.created_at.localeCompare(a.created_at)) }
  async recordCashCount(p: CashCountInput) {
    const b = this.cashBoxes.find((x) => x.id === p.box_id) ?? fail('cash box not found.')
    if (!p.count_date || p.count_date > this.now().slice(0, 10)) fail('the count date is missing or in the future.')
    const den = p.denominations && Object.keys(p.denominations).length ? p.denominations : null
    const counted = den ? sum(Object.entries(den).map(([k, v]) => D(k).times(v))) : p.counted_total != null ? D(p.counted_total) : null
    if (!counted || counted.lt(0)) fail('enter the cash counted.')
    const book = this.ledgerBalance(b.company_id, b.ledger_account_id, p.count_date)
    const diff = round2(counted!.minus(book))
    const row: CashCount = { id: uid(), box_id: b.id, company_id: b.company_id, count_date: p.count_date, denominations: den ?? {}, counted_total: round2(counted!).toString(), book_balance: round2(book).toString(), difference: diff.toString(), note: p.note ?? null, witness_name: p.witness_name ?? null, counted_by: this.actor, created_at: this.now() }
    Object.freeze(row) // a cash count is a record of what was found
    this.cashCounts.push(row)
    if (!diff.isZero()) {
      this.raise(b.company_id, 'cash_count_difference', diff.abs().gte(1000) ? 'priority' : 'review', 'CASH COUNT — counted cash differs from the books',
        `Cash box "${b.name}" was counted at ${round2(counted!)} on ${p.count_date}. The books show ${round2(book)}. Difference ${diff}${diff.lt(0) ? ' (cash short).' : ' (cash over).'} The books have not been changed; any adjustment needs an approved journal.`,
        { cash_count_id: row.id, box_id: b.id, counted: row.counted_total, book: row.book_balance, difference: row.difference, rule: 'counted cash ≠ ledger balance on the count date' }, 'cash_counts', row.id, 'cashcount:' + row.id)
    }
    this.log(b.company_id, 'cash_counts', row.id, 'cash_counted', null, { box: b.name, counted: row.counted_total, book: row.book_balance, difference: row.difference }, p.note ?? null)
    return { id: row.id, counted_total: row.counted_total, book_balance: row.book_balance, difference: row.difference }
  }

  // ------------------------------------------------------------ fund transfers
  async listFundTransfers(companyIds: ID[]) { return this.transfers.filter((t) => companyIds.includes(t.company_id) || companyIds.includes(t.to_company_id)).sort((a, b) => b.transfer_date.localeCompare(a.transfer_date) || b.transfer_no.localeCompare(a.transfer_no)) }
  protected icAccount(companyId: ID, counterparty: ID, side: 'receivable' | 'payable'): ID {
    const a = this.accounts.filter((x) => x.company_id === companyId && x.control_type === 'intercompany' && x.counterparty_company_id === counterparty && x.type === (side === 'receivable' ? 'asset' : 'liability') && !x.is_group && x.is_active).sort((x, y) => x.code.localeCompare(y.code))[0]
    return a?.id ?? this.mapAccount(companyId, 'intercompany_' + side)
  }
  async proposeFundTransfer(p: FundTransferInput): Promise<ID> {
    const from = this.company(p.company_id)
    const toCompany = p.to_company_id ?? p.company_id
    const to = this.company(toCompany)
    const amt = money(p.amount)
    if (amt.lte(0)) fail('the amount must be greater than zero.')
    if (!p.transfer_date) fail('the transfer date is required.')
    if (blank(p.purpose)) fail('the purpose of the transfer is required.')
    const f = this.account(p.from_ledger_id), t = this.account(p.to_ledger_id)
    if (!f || f.company_id !== p.company_id || !['bank', 'cash'].includes(f.control_type ?? '') || f.is_group) fail('choose the bank or cash ledger the money leaves from.')
    if (!t || t.company_id !== toCompany || !['bank', 'cash'].includes(t.control_type ?? '') || t.is_group) fail('choose the bank or cash ledger the money arrives in.')
    if (f!.id === t!.id) fail('the source and the destination are the same ledger.')
    const inter = toCompany !== p.company_id
    const kind = inter ? 'intercompany' : p.kind ?? (f!.control_type === 'bank' && t!.control_type === 'cash' ? 'cash_withdrawal' : f!.control_type === 'cash' && t!.control_type === 'bank' ? 'cash_deposit' : 'bank_transfer')
    const row: FundTransfer = { id: uid(), company_id: p.company_id, transfer_no: this.docNo(p.company_id, 'fund_transfer', 'FT', p.transfer_date), kind, from_ledger_id: f!.id, to_company_id: toCompany, to_ledger_id: t!.id, amount: amt.toString(), transfer_date: p.transfer_date, purpose: p.purpose.trim(), reference: p.reference ?? null, status: 'proposed', journal_id: null, to_journal_id: null, created_by: this.actor, created_at: this.now() }
    const ref = p.reference ?? row.transfer_no
    if (!inter) {
      row.journal_id = this.proposePosting(p.company_id, 'contra', p.transfer_date, `Transfer ${row.transfer_no} · ${f!.name} → ${t!.name} — ${row.purpose}`, 'fund_transfer', row.id, [
        { account_id: t!.id, debit: amt.toString(), description: ref }, { account_id: f!.id, credit: amt.toString(), description: ref },
      ], { amount: amt.toString(), side: 'both' })
    } else {
      // both ledgers are resolved before either entry is proposed, so a missing mapping leaves nothing behind
      const recv = this.icAccount(p.company_id, toCompany, 'receivable'), pay = this.icAccount(toCompany, p.company_id, 'payable')
      this.assertPeriodOpen(toCompany, p.transfer_date)
      row.journal_id = this.proposePosting(p.company_id, 'intercompany', p.transfer_date, `Transfer ${row.transfer_no} to ${to.name} — ${row.purpose}`, 'fund_transfer', row.id, [
        { account_id: recv, debit: amt.toString(), description: `Due from ${to.name}` }, { account_id: f!.id, credit: amt.toString(), description: ref },
      ], { amount: amt.toString(), side: 'out' })
      row.to_journal_id = this.proposePosting(toCompany, 'intercompany', p.transfer_date, `Transfer ${row.transfer_no} from ${from.name} — ${row.purpose}`, 'fund_transfer_in', row.id, [
        { account_id: t!.id, debit: amt.toString(), description: ref }, { account_id: pay, credit: amt.toString(), description: `Due to ${from.name}` },
      ], { amount: amt.toString(), side: 'in' })
    }
    this.transfers.push(row)
    this.log(p.company_id, 'fund_transfers', row.id, 'insert', null, row, null)
    return row.id
  }
  protected wfFundTransfer(w: WorkflowPosting, event: WfEvent) {
    const t = this.transfers.find((x) => x.id === w.source_id)
    if (!t) return
    const legs = this.postings.filter((x) => (x.source === 'fund_transfer' || x.source === 'fund_transfer_in') && x.source_id === t.id)
    const states = legs.map((x) => (x.id === w.id ? event : x.status))
    t.status = states.includes('reversed') ? 'reversed' : states.includes('voided') ? 'rejected' : states.includes('pending') && states.includes('posted') ? 'part_posted' : states.includes('pending') ? 'proposed' : 'posted'
    if (t.to_company_id !== t.company_id && (event === 'voided' || event === 'reversed')) {
      const other = legs.find((x) => x.id !== w.id)?.status
      if (other === 'pending' || other === 'posted') {
        this.raise(w.company_id, 'intercompany_one_sided', 'priority', `INTERCOMPANY — one side of a transfer was ${event}`,
          `Transfer ${t.transfer_no} of ${D(t.amount)} has two entries, one in each company. This entry was ${event} while the entry in the other company is ${other}. Until both agree, intercompany balances will not match.`,
          { transfer_id: t.id, this_journal: w.journal_id, other_state: other, rule: 'both legs of an intercompany transfer must share the same outcome' }, 'fund_transfers', t.id, `ictransfer:${w.id}:${event}`)
      }
    }
  }

  // ------------------------------------------------------------ promise-to-pay
  async listPromises(f: { companyIds: ID[]; partyId?: ID }) { return this.promises.filter((p) => f.companyIds.includes(p.company_id) && (!f.partyId || p.party_id === f.partyId)).sort((a, b) => a.promised_date.localeCompare(b.promised_date)) }
  async savePromise(p: CollectionPromiseInput): Promise<ID> {
    if (p.id) {
      const pr = this.promises.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('promise not found.')
      if (pr.status !== 'open') fail(`this promise is already ${pr.status}.`)
      if (!p.status || !['kept', 'partly_kept', 'broken', 'cancelled'].includes(p.status)) fail('record whether the promise was kept, partly kept, broken or cancelled.')
      Object.assign(pr, { status: p.status, outcome_note: p.outcome_note ?? null })
      this.log(p.company_id, 'collection_promises', pr.id, 'update', { status: 'open' }, { status: p.status }, p.outcome_note ?? null)
      return pr.id
    }
    this.needParty(p.party_id, 'choose the customer.')
    if (p.invoice_id) { const inv = this.invoices.find((i) => i.id === p.invoice_id); if (!inv || inv.company_id !== p.company_id || inv.party_id !== p.party_id) fail('the invoice belongs to another customer or company.') }
    if (D(p.promised_amount).lte(0) || !p.promised_date) fail('the promised amount and date are required.')
    const row: CollectionPromise = { id: uid(), company_id: p.company_id, party_id: p.party_id!, invoice_id: p.invoice_id ?? null, promised_amount: money(p.promised_amount).toString(), promised_date: p.promised_date!, contact_person: p.contact_person ?? null, channel: p.channel ?? null, notes: p.notes ?? null, status: 'open', outcome_note: null, created_by: this.actor, created_at: this.now() }
    this.promises.push(row)
    this.log(p.company_id, 'collection_promises', row.id, 'insert', null, row, null)
    return row.id
  }

  // ------------------------------------------------------------ loans
  protected loan(id: ID) { return this.loans.find((l) => l.id === id) ?? fail('loan not found.') }
  protected buildSchedule(l: Loan) {
    this.loanSchedule = this.loanSchedule.filter((s) => s.loan_id !== l.id)
    const r = D(l.rate_pct).div(1200), n = l.tenure_months
    let bal = D(l.principal)
    const f = r.plus(1).pow(n)
    const emi = l.repayment === 'emi' ? (r.isZero() ? round2(bal.div(n)) : round2(bal.times(r).times(f).div(f.minus(1)))) : ZERO
    for (let i = 1; i <= n; i++) {
      const interest = round2(bal.times(r))
      const principal = l.repayment === 'emi' ? (i === n ? bal : Decimal.min(emi.minus(interest), bal)) : l.repayment === 'equal_principal' ? (i === n ? bal : round2(D(l.principal).div(n))) : i === n ? bal : ZERO
      this.loanSchedule.push({ id: uid(), loan_id: l.id, company_id: l.company_id, instalment_no: i, due_date: addMonths(l.first_due_date, i - 1), opening_principal: bal.toString(), principal: principal.toString(), interest: interest.toString(), total: principal.plus(interest).toString(), closing_principal: bal.minus(principal).toString(), recovered: '0', status: 'due', journal_id: null, paid_on: null })
      bal = bal.minus(principal)
    }
  }
  async listLoans(companyIds: ID[]) { return this.loans.filter((l) => companyIds.includes(l.company_id) && this.canViewLevel(l.confidentiality)).sort((a, b) => a.loan_no.localeCompare(b.loan_no)) }
  async listLoanSchedule(f: { loanId?: ID; companyIds?: ID[] }) {
    const visible = new Set((await this.listLoans(f.companyIds ?? this.companies.map((c) => c.id))).map((l) => l.id))
    return this.loanSchedule.filter((s) => visible.has(s.loan_id) && (!f.loanId || s.loan_id === f.loanId)).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.instalment_no - b.instalment_no)
  }
  async saveLoan(p: LoanInput): Promise<ID> {
    const c = this.company(p.company_id)
    if (blank(p.name)) fail('the loan needs a name.')
    this.needParty(p.party_id, 'choose the lender or borrower.')
    const la = this.account(p.loan_account_id), ia = this.account(p.interest_account_id)
    if (!la || la.company_id !== p.company_id || la.is_group || !ia || ia.company_id !== p.company_id || ia.is_group) fail('choose posting accounts of this company for the loan and its interest.')
    const dir = p.direction ?? 'borrowed'
    if ((dir === 'borrowed' && la!.type !== 'liability') || (dir === 'lent' && la!.type !== 'asset')) fail('a loan taken sits in a liability ledger; a loan given sits in an asset ledger.')
    if (!p.start_date || !p.first_due_date || p.first_due_date < p.start_date) fail('the start date and first due date are required, and the first instalment cannot fall before the start.')
    if (D(p.principal).lte(0) || !(p.tenure_months > 0)) fail('the principal and the tenure must be greater than zero.')
    if (!p.id) {
      const l: Loan = {
        id: uid(), company_id: p.company_id, loan_no: this.docNo(p.company_id, 'loan', 'LN', p.start_date), name: p.name.trim(), direction: dir, kind: p.kind ?? 'term_loan', party_id: p.party_id, principal: money(p.principal).toString(),
        currency: p.currency ?? c.base_currency, rate_pct: p.rate_pct ?? 0, rate_type: p.rate_type ?? 'fixed', rate_reset_date: p.rate_reset_date ?? null, start_date: p.start_date, first_due_date: p.first_due_date, tenure_months: p.tenure_months,
        repayment: p.repayment ?? 'emi', loan_account_id: la!.id, interest_account_id: ia!.id, disbursed_amount: '0', principal_repaid: '0', interest_paid: '0', sanction_ref: p.sanction_ref ?? null, security: p.security ?? null,
        covenants: p.covenants ?? null, status: 'draft', confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, created_by: this.actor, created_at: this.now(),
      }
      this.loans.push(l)
      this.buildSchedule(l)
      this.log(p.company_id, 'loans', l.id, 'insert', null, l, null)
      return l.id
    }
    const l = this.loans.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('loan not found.')
    if (l.status === 'closed' || l.status === 'cancelled') fail(`this loan is ${l.status}.`)
    const locked = D(l.disbursed_amount).gt(0) || this.loanSchedule.some((s) => s.loan_id === l.id && s.status !== 'due') || this.postings.some((w) => w.source === 'loan_disbursement' && w.source_id === l.id && w.status === 'pending')
    if (locked && (!money(p.principal).eq(l.principal) || !D(p.rate_pct ?? 0).eq(l.rate_pct) || p.tenure_months !== l.tenure_months || p.first_due_date !== l.first_due_date || (p.repayment ?? 'emi') !== l.repayment || dir !== l.direction || la!.id !== l.loan_account_id)) {
      fail('money has already moved on this loan. Its amount, rate, tenure and accounts can no longer be changed here.')
    }
    const old = { ...l }
    Object.assign(l, { name: p.name.trim(), kind: p.kind ?? l.kind, party_id: p.party_id, principal: money(p.principal).toString(), rate_pct: p.rate_pct ?? 0, rate_type: p.rate_type ?? l.rate_type, rate_reset_date: p.rate_reset_date ?? null, start_date: p.start_date, first_due_date: p.first_due_date, tenure_months: p.tenure_months, repayment: p.repayment ?? 'emi', direction: dir, loan_account_id: la!.id, interest_account_id: ia!.id, sanction_ref: p.sanction_ref ?? null, security: p.security ?? null, covenants: p.covenants ?? null, confidentiality: p.confidentiality ?? l.confidentiality, notes: p.notes ?? null })
    if (!locked) this.buildSchedule(l)
    this.log(p.company_id, 'loans', l.id, 'update', old, { ...l }, null)
    return l.id
  }
  async disburseLoan(loanId: ID, m: MoneyMoveInput): Promise<ID> {
    const l = this.loan(loanId)
    if (!['draft', 'active'].includes(l.status)) fail(`this loan is ${l.status}.`)
    if (!m.date) fail('the date is required.')
    const amt = money(m.amount)
    const room = D(l.principal).minus(l.disbursed_amount)
    if (amt.lte(0) || amt.gt(room)) fail(`the amount must be greater than zero and cannot exceed the undisbursed ${room}.`)
    const bank = this.bankLedger(l.company_id, m.bank_ledger_id, 'choose a bank or cash ledger of this company.')
    const name = this.partyName(l.party_id)
    const lines: JournalLineInput[] = l.direction === 'borrowed'
      ? [{ account_id: bank.id, debit: amt.toString(), description: `Loan received — ${l.loan_no}` }, { account_id: l.loan_account_id, party_id: l.party_id, credit: amt.toString(), description: `Principal owed to ${name}` }]
      : [{ account_id: l.loan_account_id, party_id: l.party_id, debit: amt.toString(), description: `Principal due from ${name}` }, { account_id: bank.id, credit: amt.toString(), description: `Loan given — ${l.loan_no}` }]
    return this.proposePosting(l.company_id, l.direction === 'borrowed' ? 'receipt' : 'payment', m.date, `Loan ${l.loan_no} · ${l.name} — disbursement`, 'loan_disbursement', l.id, lines, { amount: amt.toString(), date: m.date }, l.confidentiality)
  }
  protected wfLoanDisbursement(w: WorkflowPosting, event: WfEvent) {
    const l = this.loan(w.source_id)
    const amt = D(w.payload.amount as Num)
    if (event === 'posted') { l.disbursed_amount = D(l.disbursed_amount).plus(amt).toString(); l.status = 'active' }
    else if (event === 'reversed') {
      if (D(l.principal_repaid).gt(D(l.disbursed_amount).minus(amt))) fail('repayments have been recorded against this disbursement. Reverse those first.')
      l.disbursed_amount = D(l.disbursed_amount).minus(amt).toString()
      if (D(l.disbursed_amount).lte(0)) l.status = 'draft'
    }
  }
  async payLoanInstalment(scheduleId: ID, m: Omit<MoneyMoveInput, 'amount'> & { interest?: Num }): Promise<ID> {
    const s = this.loanSchedule.find((x) => x.id === scheduleId) ?? fail('instalment not found.')
    const l = this.loan(s.loan_id)
    if (l.status !== 'active') fail(`this loan is ${l.status} — record its disbursement first.`)
    if (s.status !== 'due') fail(`this instalment is already ${s.status}.`)
    if (this.loanSchedule.some((x) => x.loan_id === l.id && x.instalment_no < s.instalment_no && x.status === 'due')) fail('an earlier instalment is still unpaid. Instalments are recorded in order.')
    if (!m.date) fail('the payment date is required.')
    const bank = this.bankLedger(l.company_id, m.bank_ledger_id, 'choose a bank or cash ledger of this company.')
    // the lender's statement is the authority for interest: the scheduled figure can be replaced by the charged figure
    const interest = money(m.interest ?? s.interest)
    if (interest.lt(0)) fail('interest cannot be negative.')
    const principal = Decimal.max(D(s.principal).minus(D(s.recovered)), 0)
    const total = principal.plus(interest)
    if (total.lte(0)) fail('this instalment has no amount.')
    const side = l.direction === 'borrowed' ? 'debit' : 'credit'
    const parts: JournalLineInput[] = []
    if (principal.gt(0)) parts.push({ account_id: l.loan_account_id, party_id: l.party_id, [side]: principal.toString(), description: `Principal — instalment ${s.instalment_no}` })
    if (interest.gt(0)) parts.push({ account_id: l.interest_account_id, [side]: interest.toString(), description: `Interest — instalment ${s.instalment_no}` })
    const bankLine: JournalLineInput = { account_id: bank.id, [side === 'debit' ? 'credit' : 'debit']: total.toString(), description: m.reference ?? l.loan_no }
    const j = this.proposePosting(l.company_id, l.direction === 'borrowed' ? 'payment' : 'receipt', m.date, `Loan ${l.loan_no} · instalment ${s.instalment_no} of ${l.tenure_months} · ${this.partyName(l.party_id)}`, 'loan_instalment', s.id,
      l.direction === 'borrowed' ? [...parts, bankLine] : [bankLine, ...parts], { loan_id: l.id, principal: principal.toString(), interest: interest.toString(), scheduled_interest: s.interest, date: m.date }, l.confidentiality)
    s.status = 'proposed'; s.journal_id = j
    return j
  }
  protected wfLoanInstalment(w: WorkflowPosting, event: WfEvent) {
    const s = this.loanSchedule.find((x) => x.id === w.source_id)!
    const l = this.loan(w.payload.loan_id as ID)
    const pri = D(w.payload.principal as Num), int = D(w.payload.interest as Num)
    if (event === 'posted') {
      s.status = 'paid'; s.paid_on = w.payload.date as string
      l.principal_repaid = D(l.principal_repaid).plus(pri).toString(); l.interest_paid = D(l.interest_paid).plus(int).toString()
      if (!this.loanSchedule.some((x) => x.loan_id === l.id && x.status !== 'paid')) l.status = 'closed'
    } else if (event === 'voided') { s.status = 'due'; s.journal_id = null }
    else {
      if (this.loanSchedule.some((x) => x.loan_id === l.id && x.instalment_no > s.instalment_no && x.status !== 'due')) fail('later instalments have been recorded. Reverse the most recent instalment first.')
      Object.assign(s, { status: 'due', journal_id: null, paid_on: null })
      Object.assign(l, { principal_repaid: Decimal.max(D(l.principal_repaid).minus(pri), 0).toString(), interest_paid: Decimal.max(D(l.interest_paid).minus(int), 0).toString(), status: 'active' })
    }
  }

  // ------------------------------------------------------------ fixed deposits
  protected deposit(id: ID) { return this.deposits.find((d) => d.id === id) ?? fail('deposit not found.') }
  async listFixedDeposits(companyIds: ID[]) { return this.deposits.filter((d) => companyIds.includes(d.company_id) && this.canViewLevel(d.confidentiality)).sort((a, b) => a.maturity_date.localeCompare(b.maturity_date)) }
  async saveFixedDeposit(p: FixedDepositInput): Promise<ID> {
    const c = this.company(p.company_id)
    if (blank(p.bank_name)) fail('the bank is required.')
    const principal = money(p.principal)
    if (principal.lte(0)) fail('the principal must be greater than zero.')
    if (!p.start_date || !p.maturity_date || p.maturity_date <= p.start_date) fail('the maturity date must be after the start date.')
    const fa = this.account(p.fd_account_id), ia = this.account(p.interest_account_id)
    if (!fa || fa.company_id !== p.company_id || fa.is_group || fa.type !== 'asset' || !ia || ia.company_id !== p.company_id || ia.is_group) fail('choose an asset ledger for the deposit and a posting ledger for its interest.')
    const rate = D(p.rate_pct ?? 0), comp = p.compounding ?? 'quarterly'
    const years = D(daysBetween(p.start_date, p.maturity_date)).div(365)
    const n = { simple: 0, monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 }[comp]
    const maturity = round2(p.maturity_amount != null ? D(p.maturity_amount) : n === 0 ? principal.times(rate.div(100).times(years).plus(1)) : principal.times(Decimal.pow(rate.div(100).div(n).plus(1), years.times(n))))
    if (!p.id) {
      const d: FixedDeposit = {
        id: uid(), company_id: p.company_id, fd_no: this.docNo(p.company_id, 'fixed_deposit', 'FD', p.start_date), bank_party_id: p.bank_party_id ?? null, bank_name: p.bank_name.trim(), reference: p.reference ?? null, principal: principal.toString(),
        currency: p.currency ?? c.base_currency, rate_pct: rate.toString(), compounding: comp, start_date: p.start_date, maturity_date: p.maturity_date, maturity_amount: maturity.toString(), fd_account_id: fa!.id, interest_account_id: ia!.id,
        lien_marked: !!p.lien_marked, lien_note: p.lien_note ?? null, auto_renew: !!p.auto_renew, status: 'draft', placement_journal_id: null, closure_journal_id: null, closed_on: null, proceeds: null, tax_deducted: null,
        confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, created_by: this.actor, created_at: this.now(),
      }
      this.deposits.push(d)
      this.log(p.company_id, 'fixed_deposits', d.id, 'insert', null, d, null)
      return d.id
    }
    const d = this.deposits.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('deposit not found.')
    if (d.status === 'closed' || d.status === 'cancelled') fail(`this deposit is ${d.status}.`)
    if (d.status === 'active' && (!principal.eq(d.principal) || fa!.id !== d.fd_account_id || p.start_date !== d.start_date)) fail('this deposit has been placed. Its principal, start date and ledger can no longer be changed.')
    const old = { ...d }
    Object.assign(d, { bank_party_id: p.bank_party_id ?? null, bank_name: p.bank_name.trim(), reference: p.reference ?? null, principal: principal.toString(), rate_pct: rate.toString(), compounding: comp, start_date: p.start_date, maturity_date: p.maturity_date, maturity_amount: maturity.toString(), fd_account_id: fa!.id, interest_account_id: ia!.id, lien_marked: !!p.lien_marked, lien_note: p.lien_note ?? null, auto_renew: !!p.auto_renew, confidentiality: p.confidentiality ?? d.confidentiality, notes: p.notes ?? null })
    this.log(p.company_id, 'fixed_deposits', d.id, 'update', old, { ...d }, null)
    return d.id
  }
  async placeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date?: string }): Promise<ID> {
    const d = this.deposit(fdId)
    if (d.status !== 'draft') fail(`this deposit is already ${d.status}.`)
    const date = m.date ?? d.start_date
    const bank = this.bankLedger(d.company_id, m.bank_ledger_id, 'choose the bank ledger the deposit was funded from.', true)
    const ref = `Deposit ${d.reference ?? d.fd_no}`
    return this.proposePosting(d.company_id, 'contra', date, `Fixed deposit ${d.fd_no} placed with ${d.bank_name}`, 'fd_placement', d.id, [
      { account_id: d.fd_account_id, debit: d.principal, description: ref }, { account_id: bank.id, credit: d.principal, description: ref },
    ], { date }, d.confidentiality)
  }
  protected wfFdPlacement(w: WorkflowPosting, event: WfEvent) {
    const d = this.deposit(w.source_id)
    if (event === 'posted') Object.assign(d, { status: 'active', placement_journal_id: w.journal_id })
    else if (event === 'reversed') {
      if (d.status === 'closed') fail('this deposit has been closed. Reverse its closure first.')
      Object.assign(d, { status: 'draft', placement_journal_id: null })
    }
  }
  /** Maturity or premature closure. Interest is what the bank actually paid, not what was expected. */
  async closeFixedDeposit(fdId: ID, m: { bank_ledger_id: ID; date: string; proceeds: Num; tax_deducted?: Num; lien_released?: boolean }): Promise<ID> {
    const d = this.deposit(fdId)
    if (d.status !== 'active') fail(`this deposit is ${d.status} and cannot be closed.`)
    if (d.lien_marked && m.lien_released !== true) fail(`this deposit is under lien (${d.lien_note ?? 'no note'}). Confirm that the lien has been released before closing it.`)
    if (!m.date || m.date < d.start_date) fail('the closure date is missing or before the start date.')
    const proceeds = money(m.proceeds), tds = money(m.tax_deducted)
    if (proceeds.lte(0) || tds.lt(0)) fail('enter the amount received and any tax deducted.')
    const bank = this.bankLedger(d.company_id, m.bank_ledger_id, 'choose the bank ledger that received the proceeds.', true)
    const interest = proceeds.plus(tds).minus(d.principal)
    const lines: JournalLineInput[] = [{ account_id: bank.id, debit: proceeds.toString(), description: `Proceeds of ${d.fd_no}` }]
    if (tds.gt(0)) lines.push({ account_id: this.mapAccount(d.company_id, 'tds_receivable'), debit: tds.toString(), party_id: d.bank_party_id, description: `Tax deducted at source on interest — ${d.fd_no}` })
    if (interest.lt(0)) lines.push({ account_id: d.interest_account_id, debit: interest.neg().toString(), description: `Shortfall on premature closure — ${d.fd_no}` })
    lines.push({ account_id: d.fd_account_id, credit: d.principal, description: `Deposit closed — ${d.fd_no}` })
    if (interest.gt(0)) lines.push({ account_id: d.interest_account_id, credit: interest.toString(), description: `Interest earned — ${d.fd_no}` })
    return this.proposePosting(d.company_id, 'receipt', m.date, `Fixed deposit ${d.fd_no}${m.date < d.maturity_date ? ' closed before maturity' : ' matured'} · ${d.bank_name}`, 'fd_closure', d.id, lines,
      { date: m.date, proceeds: proceeds.toString(), tax_deducted: tds.toString(), interest: interest.toString() }, d.confidentiality)
  }
  protected wfFdClosure(w: WorkflowPosting, event: WfEvent) {
    const d = this.deposit(w.source_id)
    if (event === 'posted') Object.assign(d, { status: 'closed', closure_journal_id: w.journal_id, closed_on: w.payload.date, proceeds: w.payload.proceeds, tax_deducted: w.payload.tax_deducted })
    else if (event === 'reversed') Object.assign(d, { status: 'active', closure_journal_id: null, closed_on: null, proceeds: null, tax_deducted: null })
  }

  // ------------------------------------------------------------ payroll
  protected visibleEmployee(e: Employee) { return this.canViewLevel(e.confidentiality) }
  async listEmployees(companyIds: ID[]) { return this.employees.filter((e) => companyIds.includes(e.company_id) && this.visibleEmployee(e)).sort((a, b) => a.emp_no.localeCompare(b.emp_no)) }
  async saveEmployee(p: EmployeeInput): Promise<ID> {
    const pt = this.needParty(p.party_id, 'choose the person from the party register.')
    if (!p.join_date) fail('the joining date is required.')
    if (p.exit_date && p.exit_date < p.join_date) fail('the exit date is before the joining date.')
    this.needUnit(p.company_id, p.department_id, 'the selected department or office belongs to another company.')
    this.needUnit(p.company_id, p.office_id, 'the selected department or office belongs to another company.')
    this.clearance(p.confidentiality)
    if (!pt.roles.some((r) => r.company_id === p.company_id && r.type_key === 'employee')) pt.roles.push({ id: uid(), party_id: pt.id, company_id: p.company_id, type_key: 'employee', status: 'active' })
    if (!p.id) {
      if (this.employees.some((e) => e.company_id === p.company_id && e.party_id === p.party_id)) fail('That record already exists (duplicate value).', '23505')
      const no = (p.emp_no ?? '').trim() || `EMP-${String(this.nextSeq(`reg:${p.company_id}:EMP`)).padStart(5, '0')}`
      const e: Employee = { id: uid(), company_id: p.company_id, party_id: p.party_id, emp_no: no, designation: p.designation ?? null, department_id: p.department_id ?? null, office_id: p.office_id ?? null, employment_type: p.employment_type ?? 'permanent', join_date: p.join_date, exit_date: p.exit_date ?? null, status: p.status ?? 'active', payment_method: p.payment_method ?? null, confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, created_by: this.actor, created_at: this.now() }
      this.employees.push(e)
      this.log(p.company_id, 'employees', e.id, 'insert', null, e, null)
      return e.id
    }
    const e = this.employees.find((x) => x.id === p.id && x.company_id === p.company_id && this.visibleEmployee(x)) ?? fail('employee record not found, or you are not cleared to change it.')
    const old = { ...e }
    Object.assign(e, { designation: p.designation ?? null, department_id: p.department_id ?? null, office_id: p.office_id ?? null, employment_type: p.employment_type ?? e.employment_type, join_date: p.join_date, exit_date: p.exit_date ?? null, status: p.status ?? e.status, payment_method: p.payment_method ?? null, confidentiality: p.confidentiality ?? e.confidentiality, notes: p.notes ?? null })
    this.log(p.company_id, 'employees', e.id, 'update', old, { ...e }, null)
    return e.id
  }
  async listSalaryStructures(f: { companyIds?: ID[]; employeeId?: ID }) {
    const visible = new Set(this.employees.filter((e) => this.visibleEmployee(e) && (!f.companyIds || f.companyIds.includes(e.company_id))).map((e) => e.id))
    return this.salaryStructures.filter((s) => visible.has(s.employee_id) && (!f.employeeId || s.employee_id === f.employeeId)).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  }
  async saveSalaryStructure(p: SalaryStructureInput): Promise<ID> {
    const e = this.employees.find((x) => x.id === p.employee_id) ?? fail('employee not found.')
    if (!this.visibleEmployee(e)) fail('you are not authorised to maintain this salary.', '42501')
    if (!p.effective_from) fail('the effective date is required.')
    if (blank(p.reason)) fail('record the reason for this salary or revision.')
    let g = ZERO, d = ZERO, em = ZERO
    const clean: SalaryComponent[] = []
    for (const c of p.components ?? []) {
      const amt = money(c.amount)
      if (blank(c.name) || amt.lt(0)) fail('every salary component needs a name and an amount that is not negative.')
      if (!['earning', 'deduction', 'employer'].includes(c.kind)) fail(`component "${c.name}" must be an earning, a deduction or an employer cost.`)
      if (c.account_id) { const a = this.account(c.account_id); if (!a || a.company_id !== e.company_id || a.is_group) fail(`component "${c.name}" points to a ledger outside this company.`) }
      if (amt.isZero()) continue
      clean.push({ key: c.key || c.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: c.name.trim(), kind: c.kind, type: c.type ?? (c.kind === 'earning' ? 'fixed' : 'statutory'), amount: amt.toString(), account_id: c.account_id ?? null })
      if (c.kind === 'earning') g = g.plus(amt); else if (c.kind === 'deduction') d = d.plus(amt); else em = em.plus(amt)
    }
    if (g.lte(0)) fail('the salary needs at least one earning.')
    if (d.gt(g)) fail('deductions exceed earnings.')
    const totals = { components: clean, monthly_gross: g.toString(), monthly_deductions: d.toString(), monthly_employer: em.toString(), monthly_net: g.minus(d).toString(), annual_ctc: g.plus(em).times(12).toString(), effective_from: p.effective_from, reason: p.reason.trim() }
    if (!p.id) {
      const s: SalaryStructure = { id: uid(), employee_id: e.id, company_id: e.company_id, ...totals, status: 'draft', decision_note: null, created_by: this.actor, created_at: this.now() }
      this.salaryStructures.push(s)
      this.log(e.company_id, 'salary_structures', s.id, 'insert', null, { employee_id: e.id, effective_from: s.effective_from }, null)
      return s.id
    }
    const s = this.salaryStructures.find((x) => x.id === p.id && x.employee_id === e.id) ?? fail('salary record not found.')
    if (s.status === 'approved') fail('an approved salary is never overwritten. Record a revision with a new effective date.')
    Object.assign(s, totals, { status: 'draft' })
    return s.id
  }
  async decideSalaryStructure(id: ID, decision: 'approved' | 'rejected', comment?: string) {
    const s = this.salaryStructures.find((x) => x.id === id) ?? fail('salary record not found.')
    const e = this.employees.find((x) => x.id === s.employee_id)!
    if (!this.visibleEmployee(e)) fail('you are not authorised to approve this salary.', '42501')
    if (s.status !== 'draft') fail(`this salary record is already ${s.status}.`)
    if (decision === 'rejected') {
      if (blank(comment)) fail('a reason is required to reject.')
      Object.assign(s, { status: 'rejected', decision_note: comment })
      this.log(s.company_id, 'salary_structures', id, 'rejected', null, null, comment ?? null)
      return
    }
    if (decision !== 'approved') fail('the decision must be approved or rejected.')
    const action = this.makerChecker(s.created_by, 'salary')
    if (this.salaryStructures.some((x) => x.employee_id === s.employee_id && x.status === 'approved' && x.effective_from === s.effective_from)) fail('an approved salary already exists with this effective date. Choose a different effective date.')
    const prev = this.salaryStructures.filter((x) => x.employee_id === s.employee_id && x.status === 'approved' && x.effective_from < s.effective_from).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
    Object.assign(s, { status: 'approved', decision_note: comment ?? null, approved_by: this.actor, approved_at: this.now() })
    Object.freeze(s) // an approved salary is history
    this.log(s.company_id, 'salary_structures', id, 'approved', prev ? { previous_structure: prev.id, previous_effective_from: prev.effective_from } : null, { effective_from: s.effective_from, approval: action }, comment ?? s.reason)
  }
  async listPayrollRuns(companyIds: ID[]) { return this.payrollRuns.filter((r) => companyIds.includes(r.company_id)).sort((a, b) => b.period_month.localeCompare(a.period_month) || b.run_no.localeCompare(a.run_no)) }
  async getPayrollLines(f: { runId?: ID; companyIds?: ID[]; from?: string; to?: string }) {
    const runs = new Map(this.payrollRuns.map((r) => [r.id, r]))
    const visible = new Set(this.employees.filter((e) => this.visibleEmployee(e)).map((e) => e.id))
    return this.payrollLines.filter((l) => {
      const r = runs.get(l.run_id)
      return !!r && visible.has(l.employee_id) && (!f.runId || l.run_id === f.runId) && (!f.companyIds || f.companyIds.includes(l.company_id)) && (!f.from || r.period_month >= startOfMonth(f.from)) && (!f.to || r.period_month <= f.to)
    })
  }
  /** Calculates a payroll run from approved salaries. Nothing is posted here. Anyone left out is listed in `exceptions`. */
  async createPayrollRun(p: PayrollRunInput): Promise<ID> {
    this.company(p.company_id)
    const type = p.run_type ?? 'regular'
    if (!p.month) fail('choose the payroll month.')
    if (!['regular', 'supplementary', 'full_and_final'].includes(type)) fail('unknown run type.')
    const start = startOfMonth(p.month), end = endOfMonth(p.month)
    const dim = daysBetween(start, end) + 1
    this.assertPeriodOpen(p.company_id, end)
    if (type === 'regular' && this.payrollRuns.some((r) => r.company_id === p.company_id && r.period_month === start && r.run_type === 'regular' && ['draft', 'proposed', 'posted', 'paid'].includes(r.status))) fail(`the regular payroll for ${mon(start)} already exists.`)
    const adjustments = p.adjustments ?? []
    const runId = uid()
    const lines: PayrollLine[] = []
    const exceptions: PayrollException[] = []
    let tg = ZERO, td = ZERO, te = ZERO
    const staff = this.employees
      .filter((e) => e.company_id === p.company_id && e.status !== 'planned' && e.join_date <= end && (!e.exit_date || e.exit_date >= start) && (type === 'regular' || adjustments.some((a) => a.employee_id === e.id)))
      .sort((a, b) => a.emp_no.localeCompare(b.emp_no))
    for (const e of staff) {
      const name = this.partyName(e.party_id)
      const comp: SalaryComponent[] = []
      let g = ZERO, d = ZERO, em = ZERO, days = ZERO
      let structure: SalaryStructure | undefined
      const add = (kind: string, amt: Decimal) => { if (kind === 'earning') g = g.plus(amt); else if (kind === 'deduction') d = d.plus(amt); else em = em.plus(amt) }
      if (type === 'regular') {
        structure = this.salaryStructures.filter((s) => s.employee_id === e.id && s.status === 'approved' && s.effective_from <= end).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
        if (!structure) { exceptions.push({ employee_id: e.id, emp_no: e.emp_no, name, reason: 'NOT INCLUDED — no approved salary is effective in this month' }); continue }
        const from = e.join_date > start ? e.join_date : start
        const to = e.exit_date && e.exit_date < end ? e.exit_date : end
        days = Decimal.max(D(daysBetween(from, to) + 1).minus(p.unpaid_days?.[e.id] ?? 0), 0)
        if (days.lte(0)) { exceptions.push({ employee_id: e.id, emp_no: e.emp_no, name, reason: 'NOT INCLUDED — no paid days in this month' }); continue }
        const factor = days.div(dim)
        for (const c of structure.components) {
          const amt = round2(D(c.amount).times(factor))
          if (amt.isZero()) continue
          comp.push({ ...c, amount: amt.toString(), source: 'structure' })
          add(c.kind, amt)
        }
      }
      for (const a of adjustments.filter((x) => x.employee_id === e.id)) {
        const amt = money(a.amount)
        if (amt.lte(0) || blank(a.name) || !['earning', 'deduction', 'employer'].includes(a.kind)) fail(`every adjustment for ${name} needs a name, a kind and an amount greater than zero.`)
        if (a.type === 'advance_recovery') {
          const adv = this.advances.find((x) => x.id === a.advance_id)
          if (!adv || adv.company_id !== p.company_id || adv.recipient_party_id !== e.party_id) fail(`the advance being recovered from ${name} belongs to someone else.`)
          if (amt.gt(this.outstanding(adv!))) fail(`the recovery from ${name} exceeds the unsettled balance of advance ${adv!.advance_no}.`)
        } else if (a.type === 'loan_recovery') {
          const ln = this.loans.find((x) => x.id === a.loan_id)
          if (!ln || ln.company_id !== p.company_id || ln.party_id !== e.party_id || ln.direction !== 'lent') fail(`the loan being recovered from ${name} is not a loan given to that person.`)
          if (amt.gt(D(ln!.disbursed_amount).minus(ln!.principal_repaid))) fail(`the recovery from ${name} exceeds the outstanding principal of loan ${ln!.loan_no}.`)
        }
        comp.push({ key: a.type ?? 'adjustment', name: a.name.trim(), kind: a.kind, type: a.type ?? 'other', amount: amt.toString(), source: 'adjustment', advance_id: a.advance_id ?? null, loan_id: a.loan_id ?? null, note: a.note ?? null })
        add(a.kind, amt)
      }
      if (g.isZero() && d.isZero() && em.isZero()) continue
      if (d.gt(g)) fail(`deductions for ${name} (${d}) exceed earnings (${g}). Reduce the recoveries for this month.`)
      lines.push({ id: uid(), run_id: runId, company_id: p.company_id, employee_id: e.id, party_id: e.party_id, department_id: e.department_id, structure_id: structure?.id ?? null, days_in_month: dim, days_paid: days.toString(), gross: g.toString(), deductions: d.toString(), employer_cost: em.toString(), net: g.minus(d).toString(), components: comp })
      tg = tg.plus(g); td = td.plus(d); te = te.plus(em)
    }
    const run: PayrollRun = { id: runId, company_id: p.company_id, run_no: this.docNo(p.company_id, 'payroll_run', 'PAY', end), period_month: start, run_type: type, status: 'draft', headcount: lines.length, gross: tg.toString(), deductions: td.toString(), employer_cost: te.toString(), net: tg.minus(td).toString(), exceptions, journal_id: null, payment_journal_id: null, paid_on: null, notes: p.notes ?? null, created_by: this.actor, created_at: this.now() }
    this.payrollRuns.push(run)
    this.payrollLines.push(...lines)
    this.log(p.company_id, 'payroll_runs', run.id, 'calculated', null, { month: start, headcount: run.headcount, gross: run.gross, net: run.net, not_included: exceptions.length }, null)
    return run.id
  }
  async proposePayrollRun(runId: ID): Promise<ID> {
    const r = this.payrollRuns.find((x) => x.id === runId) ?? fail('payroll run not found.')
    if (r.status !== 'draft') fail(`this payroll run is ${r.status}.`)
    if (r.headcount === 0) fail('this payroll run has nobody in it.')
    const label = mon(r.period_month)
    const lines = this.payrollLines.filter((l) => l.run_id === runId)
    // debits: cost by department, never by person
    const dr = new Map<string, { account: ID; unit: ID | null; bucket: string; amount: Decimal }>()
    const cr = new Map<string, { type: string; party: ID | null; loan: ID | null; amount: Decimal }>()
    for (const l of lines) for (const c of l.components) {
      const amt = D(c.amount)
      if (c.kind === 'earning' || c.kind === 'employer') {
        const bucket = c.kind === 'employer' ? 'employer' : ['bonus', 'incentive', 'commission'].includes(c.type ?? '') ? 'bonus' : 'salary'
        const account = c.account_id ?? this.mapAccount(r.company_id, bucket === 'employer' ? 'employer_contribution_expense' : bucket === 'bonus' ? 'bonus_expense' : 'salary_expense')
        const k = `${bucket}|${account}|${l.department_id ?? ''}`
        const cur = dr.get(k) ?? { account, unit: l.department_id, bucket, amount: ZERO }
        cur.amount = cur.amount.plus(amt); dr.set(k, cur)
      }
      if (c.kind === 'deduction' || c.kind === 'employer') {
        const type = c.kind === 'employer' ? 'statutory' : c.type ?? 'statutory'
        const recovery = type === 'advance_recovery' || type === 'loan_recovery'
        const k = `${type}|${recovery ? l.party_id : ''}|${c.advance_id ?? ''}|${c.loan_id ?? ''}`
        const cur = cr.get(k) ?? { type, party: recovery ? l.party_id : null, loan: c.loan_id ?? null, amount: ZERO }
        cur.amount = cur.amount.plus(amt); cr.set(k, cur)
      }
    }
    const names: Record<string, string> = { employer: 'Employer contributions', bonus: 'Bonus and incentives', salary: 'Salaries' }
    const jl: JournalLineInput[] = [...dr.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((g) => ({ account_id: g.account, debit: g.amount.toString(), description: `${names[g.bucket]} — ${label}`, dims: this.dimOf(g.unit) }))
    // credits: net pay in one line; dues to authorities by type; recoveries against the person's own balance
    if (D(r.net).gt(0)) jl.push({ account_id: this.mapAccount(r.company_id, 'salaries_payable'), credit: r.net, description: `Net salaries payable — ${label} · ${r.headcount} people` })
    for (const g of [...cr.values()].sort((a, b) => a.type.localeCompare(b.type))) {
      const [account, text] = g.type === 'advance_recovery' ? [this.mapAccount(r.company_id, 'employee_advances'), 'Advance recovered from salary']
        : g.type === 'loan_recovery' ? [this.loan(g.loan!).loan_account_id, 'Loan recovered from salary']
        : g.type === 'tax' ? [this.mapAccount(r.company_id, 'tds_payable'), 'Tax deducted from salaries']
        : [this.mapAccount(r.company_id, 'statutory_payable'), 'Statutory and other dues — payroll']
      jl.push({ account_id: account, party_id: g.party, credit: g.amount.toString(), description: `${text} — ${label}` })
    }
    const j = this.proposePosting(r.company_id, 'journal', endOfMonth(r.period_month), `Payroll ${r.run_no} — ${label}${r.run_type === 'regular' ? '' : ` (${r.run_type.replace(/_/g, ' ')})`}`, 'payroll', r.id, jl, { month: r.period_month, net: r.net, gross: r.gross }, 'confidential')
    r.status = 'proposed'; r.journal_id = j
    return j
  }
  async cancelPayrollRun(runId: ID, reason?: string) {
    const r = this.payrollRuns.find((x) => x.id === runId) ?? fail('payroll run not found.')
    if (r.status !== 'draft') fail('only a draft run can be cancelled. Reject or reverse its journal instead.')
    r.status = 'cancelled'
    r.notes = [r.notes, 'Cancelled: ' + (reason ?? 'no reason given')].filter(Boolean).join(' · ')
    this.log(r.company_id, 'payroll_runs', r.id, 'cancelled', null, null, reason ?? null)
  }
  /**
   * A loan recovered through payroll reaches its instalment schedule: the recovery is applied to the unpaid
   * instalments in order, and taken back latest first when the payroll is reversed.
   */
  protected applyLoanRecovery(loanId: ID, amount: Decimal, date: string, journalId: ID) {
    const l = this.loan(loanId)
    let left = amount.abs()
    if (left.isZero()) return
    const rows = this.loanSchedule.filter((s) => s.loan_id === loanId).sort((a, b) => a.instalment_no - b.instalment_no)
    if (amount.gt(0)) {
      if (rows.some((s) => s.status === 'proposed')) fail(`an instalment of loan ${l.loan_no} is awaiting approval. Approve or reject it before a recovery through payroll is posted.`)
      const outstanding = D(l.disbursed_amount).minus(l.principal_repaid)
      if (amount.gt(outstanding)) fail(`the recovery of ${amount} exceeds the outstanding principal of loan ${l.loan_no} (${outstanding}).`)
      for (const s of rows) {
        if (left.lte(0)) break
        if (s.status !== 'due' || D(s.principal).lte(s.recovered)) continue
        const take = Decimal.min(left, D(s.principal).minus(s.recovered))
        s.recovered = D(s.recovered).plus(take).toString()
        if (D(s.recovered).gte(s.principal) && D(s.interest).isZero()) Object.assign(s, { status: 'paid', paid_on: date, journal_id: journalId })
        left = left.minus(take)
      }
      l.principal_repaid = D(l.principal_repaid).plus(amount).toString()
      if (l.status === 'active' && D(l.disbursed_amount).minus(l.principal_repaid).lte(0) && rows.every((s) => s.status === 'paid')) l.status = 'closed'
    } else {
      for (const s of [...rows].reverse()) {
        if (left.lte(0)) break
        if (D(s.recovered).lte(0)) continue
        const byInstalment = s.status === 'paid' && this.postings.some((x) => x.journal_id === s.journal_id && x.source === 'loan_instalment')
        if (s.status === 'proposed' || byInstalment) fail(`instalment ${s.instalment_no} of loan ${l.loan_no} was recorded after this recovery. Reverse that instalment first.`)
        const take = Decimal.min(left, D(s.recovered))
        Object.assign(s, { recovered: D(s.recovered).minus(take).toString(), status: 'due', paid_on: null, journal_id: null })
        left = left.minus(take)
      }
      l.principal_repaid = Decimal.max(D(l.principal_repaid).plus(amount), 0).toString()
      if (l.status === 'closed') l.status = 'active'
    }
  }
  protected wfPayroll(w: WorkflowPosting, event: WfEvent) {
    const r = this.payrollRuns.find((x) => x.id === w.source_id)!
    if (event === 'voided') { r.status = 'draft'; r.journal_id = null; return }
    if (event === 'reversed' && (r.status === 'paid' || this.postings.some((x) => x.source === 'payroll_payment' && x.source_id === r.id && x.status === 'pending'))) fail('salaries for this run have been paid or a payment is awaiting approval. Reverse or reject that first.')
    const sign = event === 'posted' ? 1 : -1
    for (const l of this.payrollLines.filter((x) => x.run_id === r.id)) for (const c of l.components) {
      if (c.type === 'advance_recovery' && c.advance_id) { const a = this.advance(c.advance_id); a.returned_amount = Decimal.max(D(a.returned_amount).plus(D(c.amount).times(sign)), 0).toString(); this.refreshAdvance(a.id) }
      else if (c.type === 'loan_recovery' && c.loan_id) this.applyLoanRecovery(c.loan_id, D(c.amount).times(sign), endOfMonth(r.period_month), w.journal_id)
    }
    r.status = event === 'posted' ? (D(r.net).gt(0) ? 'posted' : 'paid') : 'reversed'
  }
  /** Payment of net salaries. Proposes: Dr Salaries payable / Cr Bank. */
  async payPayrollRun(runId: ID, m: Omit<MoneyMoveInput, 'amount'>): Promise<ID> {
    const r = this.payrollRuns.find((x) => x.id === runId) ?? fail('payroll run not found.')
    if (r.status !== 'posted') fail(`this payroll run is ${r.status} and has no salaries awaiting payment.`)
    if (!m.date) fail('the payment date is required.')
    const bank = this.bankLedger(r.company_id, m.bank_ledger_id, 'choose the bank or cash ledger salaries were paid from.')
    const label = mon(r.period_month)
    return this.proposePosting(r.company_id, 'payment', m.date, `Salaries paid — ${r.run_no} · ${label}`, 'payroll_payment', r.id, [
      { account_id: this.mapAccount(r.company_id, 'salaries_payable'), debit: r.net, description: `Net salaries — ${label}` },
      { account_id: bank.id, credit: r.net, description: m.reference ?? r.run_no },
    ], { date: m.date, amount: r.net }, 'confidential')
  }
  protected wfPayrollPayment(w: WorkflowPosting, event: WfEvent) {
    const r = this.payrollRuns.find((x) => x.id === w.source_id)!
    if (event === 'posted') Object.assign(r, { status: 'paid', payment_journal_id: w.journal_id, paid_on: w.payload.date })
    else if (event === 'reversed') Object.assign(r, { status: 'posted', payment_journal_id: null, paid_on: null })
  }
}

export { today }
