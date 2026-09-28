import Decimal from 'decimal.js'
import { D, ZERO, round2 } from '@/lib/money'
import { addDays, daysBetween, today } from '@/lib/dates'
import type { ID, JournalLineInput } from '@/engine/types'
import type { WorkflowPosting } from '@/engine/opsTypes'
import type {
  CapitalCall, CapitalCallInput, CapitalCallLine, CapitalReceiptInput, CommitmentInput, CorporateLink, CorporateLinkInput, Distribution, DistributionInput,
  DistributionLine, DistributionPaymentInput, EquityHolder, EquityHolderInput, Fund, FundCommitment, FundFee, FundInput, Holding, HoldingInput, HoldingTxn,
  HoldingTxnInput, HoldingValuationInput, NavRun, UnitAllotment,
} from '@/engine/p3Types'
import { DemoInventory } from './demoInventory'
import { fail, uid } from './demoCore'

// =====================================================================
// DEMO ENGINE — INVESTMENTS, FUNDS, CORPORATE STRUCTURE. Mirrors
// migration 0015. All data it holds is SAMPLE DATA.
//
// Nothing here claims to meet SEBI / AIF reporting rules. Those are
// configured separately and validated by qualified professionals.
// =====================================================================

type WfEvent = 'posted' | 'voided' | 'reversed'
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
const RELATIONS = ['subsidiary', 'associate', 'joint_venture', 'spv', 'investment_entity', 'operating_company', 'holding_company', 'branch']

export class DemoInvest extends DemoInventory {
  corporateLinks: CorporateLink[] = []
  equityHolders: EquityHolder[] = []
  holdings: Holding[] = []
  holdingTxns: HoldingTxn[] = []
  funds: Fund[] = []
  commitments: FundCommitment[] = []
  capitalCalls: CapitalCall[] = []
  capitalCallLines: CapitalCallLine[] = []
  unitAllotments: UnitAllotment[] = []
  distributions: Distribution[] = []
  distributionLines: DistributionLine[] = []
  navRuns: NavRun[] = []
  fundFees: FundFee[] = []

  constructor() {
    super()
    const h = this.handlers
    h.holding_txn = (w, e) => this.wfHoldingTxn(w, e)
    h.capital_receipt = (w, e) => this.wfCapitalReceipt(w, e)
    h.distribution = (w, e) => this.wfDistribution(w, e)
    h.distribution_payment = (w, e) => this.wfDistributionPayment(w, e)
    h.fund_fee = (w, e) => { const f = this.fundFees.find((x) => x.id === w.source_id); if (f) f.status = e === 'posted' ? 'posted' : e === 'voided' ? 'rejected' : 'reversed' }
  }

  protected override confidentialRecords() {
    return { ...super.confidentialRecords(), holdings: this.holdings, funds: this.funds, fund_distributions: this.distributions }
  }

  // ------------------------------------------------------------ corporate structure
  async listCorporateLinks() { return [...this.corporateLinks] }
  async saveCorporateLink(p: CorporateLinkInput): Promise<ID> {
    const pc = p.parent_company_id ?? null; const pp = p.parent_party_id ?? null; const cc = p.child_company_id ?? null; const cp = p.child_party_id ?? null
    if ((pc === null) === (pp === null)) fail('name the owner: a company of the group, or an outside party.')
    if ((cc === null) === (cp === null)) fail('name what is owned: a company of the group, or an outside party.')
    if (pc && pc === cc) fail('a company cannot own itself.')
    if ((pc && !this.companies.some((c) => c.id === pc)) || (cc && !this.companies.some((c) => c.id === cc)) || (pp && !this.parties.some((x) => x.id === pp)) || (cp && !this.parties.some((x) => x.id === cp)))
      fail('both sides must belong to this group.')
    if (!RELATIONS.includes(p.relation)) fail('state the relation.')
    const pct = p.ownership_pct === null || p.ownership_pct === undefined ? null : D(p.ownership_pct)
    if (pct && (pct.lt(0) || pct.gt(100))) fail('ownership is a percentage between 0 and 100.')
    const live = this.corporateLinks.filter((l) => !l.effective_to && l.id !== p.id)
    if (pc && cc) {
      // what is owned cannot, through its own holdings, own its owner
      const seen = new Set<ID>(); const queue = [cc]
      while (queue.length) {
        const cur = queue.shift()!
        for (const l of live) if (l.parent_company_id === cur && l.child_company_id && !seen.has(l.child_company_id)) { seen.add(l.child_company_id); queue.push(l.child_company_id) }
      }
      if (seen.has(pc)) fail('this would make a company, through the companies it owns, the owner of its own owner.')
    }
    if (pct && !p.effective_to) {
      const other = live.filter((l) => (l.child_company_id ?? null) === cc && (l.child_party_id ?? null) === cp).reduce((s, l) => s.plus(l.ownership_pct ?? 0), ZERO)
      if (other.plus(pct).gt(100)) fail(`other owners already hold ${other}%. With this ${pct}% the total would exceed the whole.`)
    }
    const fields = { parent_company_id: pc, parent_party_id: pp, child_company_id: cc, child_party_id: cp, relation: p.relation, ownership_pct: pct?.toString() ?? null, voting_pct: p.voting_pct ?? null, effective_from: p.effective_from ?? null, effective_to: p.effective_to ?? null, note: p.note ?? null }
    if (!p.id) {
      const l: CorporateLink = { id: uid(), group_id: this.group.id, ...fields, created_at: this.now() }
      this.corporateLinks.push(l)
      this.log(pc ?? cc, 'corporate_links', l.id, 'insert', null, l, null)
      return l.id
    }
    const l = this.corporateLinks.find((x) => x.id === p.id) ?? fail('record not found.')
    const old = { ...l }
    Object.assign(l, fields)
    this.log(pc ?? cc, 'corporate_links', l.id, 'update', old, l, p.reason ?? null)
    return l.id
  }
  async listEquityHolders(companyIds: ID[]) { return this.equityHolders.filter((e) => companyIds.includes(e.company_id)).sort((a, b) => D(b.quantity).cmp(a.quantity)) }
  async saveEquityHolder(p: EquityHolderInput): Promise<ID> {
    this.company(p.company_id)
    if (!p.holder_party_id) fail('name the holder.')
    this.needParty(p.holder_party_id, 'unknown holder .')
    if (D(p.quantity ?? -1).lt(0)) fail('the number of shares cannot be negative.')
    const cls = blank(p.share_class) ? 'Equity' : p.share_class!.trim()
    let e = this.equityHolders.find((x) => x.company_id === p.company_id && x.holder_party_id === p.holder_party_id && x.share_class === cls)
    const old = e ? { ...e } : null
    if (!e) { e = { id: uid(), company_id: p.company_id, holder_party_id: p.holder_party_id, share_class: cls, quantity: '0', paid_up: '0', note: null, updated_at: this.now() }; this.equityHolders.push(e) }
    Object.assign(e, { quantity: D(p.quantity).toString(), paid_up: D(p.paid_up ?? 0).toString(), note: p.note ?? null, updated_at: this.now() })
    this.log(p.company_id, 'equity_holders', e.id, old ? 'update' : 'insert', old, e, p.reason ?? null)
    return e.id
  }

  // ------------------------------------------------------------ holdings
  protected holding(id: ID) { return this.holdings.find((h) => h.id === id) ?? fail('investment not found.') }
  async listHoldings(companyIds: ID[]) { return this.holdings.filter((h) => companyIds.includes(h.company_id) && this.canViewLevel(h.confidentiality)).sort((a, b) => a.holding_no.localeCompare(b.holding_no)) }
  async saveHolding(p: HoldingInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.name)) fail('a name is required.')
    this.clearance(p.confidentiality)
    if (p.investee_party_id) this.needParty(p.investee_party_id, 'unknown investee .')
    if (p.investee_company_id && !this.companies.some((c) => c.id === p.investee_company_id && c.id !== p.company_id)) fail('the company invested in must be another company of this group.')
    const a = this.account(p.investment_account_id)
    if (!a || a.company_id !== p.company_id || a.is_group || !a.is_active || a.type !== 'asset') fail('choose the asset ledger that carries this investment.')
    if (p.income_account_id) this.invAccount(p.company_id, p.income_account_id, 'income from the investment')
    if (p.gain_account_id) this.invAccount(p.company_id, p.gain_account_id, 'gain or loss on sale')
    if (p.fv_account_id) this.invAccount(p.company_id, p.fv_account_id, 'changes in fair value')
    this.needUnit(p.company_id, p.org_unit_id)
    if (p.fund_id && !this.funds.some((f) => f.id === p.fund_id && f.company_id === p.company_id)) fail('the fund belongs to another company.')
    const measurement = p.measurement ?? 'cost'
    if (!['cost', 'fair_value'].includes(measurement)) fail('an investment is carried at cost or at fair value.')
    if (!p.id) {
      const h: Holding = {
        id: uid(), company_id: p.company_id, holding_no: this.docNo(p.company_id, 'holding', 'INV', today()), name: p.name.trim(), investee_party_id: p.investee_party_id ?? null, investee_company_id: p.investee_company_id ?? null,
        instrument: p.instrument ?? 'equity', measurement, investment_account_id: a!.id, income_account_id: p.income_account_id ?? null, gain_account_id: p.gain_account_id ?? null, fv_account_id: p.fv_account_id ?? null,
        org_unit_id: p.org_unit_id ?? null, fund_id: p.fund_id ?? null, currency: p.currency ?? this.company(p.company_id).base_currency, quantity: '0', cost: '0', fv_adjustment: '0', fair_value: null, fair_value_date: null,
        realised_gain: '0', income_received: '0', acquired_on: null, exited_on: null, status: 'active', confidentiality: p.confidentiality ?? 'internal', notes: p.notes ?? null, created_at: this.now(),
      }
      this.holdings.push(h)
      this.log(p.company_id, 'holdings', h.id, 'insert', null, h, null)
      return h.id
    }
    const h = this.holdings.find((x) => x.id === p.id && x.company_id === p.company_id) ?? fail('investment not found.')
    if (!this.canViewLevel(h.confidentiality)) fail('you are not cleared to change this record.', '42501')
    if ((h.investment_account_id !== a!.id || h.measurement !== measurement) && (!D(h.cost).isZero() || !D(h.fv_adjustment).isZero() || this.holdingTxns.some((t) => t.holding_id === h.id && t.status === 'proposed')))
      fail('the ledger and the measurement of an investment cannot change while it carries a balance.')
    const old = { ...h }
    Object.assign(h, {
      name: p.name.trim(), investee_party_id: p.investee_party_id ?? null, investee_company_id: p.investee_company_id ?? null, instrument: p.instrument ?? h.instrument, measurement, investment_account_id: a!.id,
      income_account_id: p.income_account_id ?? null, gain_account_id: p.gain_account_id ?? null, fv_account_id: p.fv_account_id ?? null, org_unit_id: p.org_unit_id ?? null, fund_id: p.fund_id ?? null,
      confidentiality: p.confidentiality ?? h.confidentiality, notes: p.notes ?? null,
    })
    this.log(p.company_id, 'holdings', h.id, 'update', old, h, p.reason ?? null)
    return h.id
  }
  async listHoldingTxns(f: { holdingId?: ID; companyIds?: ID[] }) {
    const seen = new Set(this.holdings.filter((h) => this.canViewLevel(h.confidentiality)).map((h) => h.id))
    return this.holdingTxns.filter((t) => seen.has(t.holding_id) && (!f.holdingId || t.holding_id === f.holdingId) && (!f.companyIds || f.companyIds.includes(t.company_id)))
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_at.localeCompare(a.created_at))
  }
  protected holdingReady(h: Holding) {
    if (!this.canViewLevel(h.confidentiality)) fail('you are not cleared for this investment.', '42501')
    if (this.holdingTxns.some((t) => t.holding_id === h.id && t.status === 'proposed')) fail('an entry for this investment is already awaiting approval. Approve or reject it first.')
  }

  async proposeHoldingTxn(p: HoldingTxnInput): Promise<ID> {
    const h = this.holding(p.holding_id)
    if (!['purchase', 'sale', 'income', 'write_down'].includes(p.kind)) fail('unknown transaction.')
    if (blank(p.date)) fail('the date is required.')
    const amt = round2(p.amount ?? 0)
    if (amt.lte(0)) fail('the amount must be greater than zero.')
    if (h.status !== 'active' && p.kind !== 'income') fail(`this investment is ${h.status.replace(/_/g, ' ')}.`)
    this.holdingReady(h)
    const dims = this.dimOf(h.org_unit_id)
    const party = h.investee_party_id ?? undefined
    const bank = p.kind === 'write_down' ? null : this.bankLedger(h.company_id, p.bank_ledger_id, 'choose the bank or cash ledger the money went through.')
    const qty = p.quantity === undefined || p.quantity === null ? null : D(p.quantity)
    let lines: JournalLineInput[]; let what: string
    let cost: Decimal | null = null; let fv: Decimal | null = null; let gain: Decimal | null = null
    const tax = round2(p.tax_deducted ?? 0)
    const gainAcc = () => h.gain_account_id ?? this.mapAccount(h.company_id, 'investment_gain_loss')

    if (p.kind === 'purchase') {
      if (!qty || qty.lte(0)) fail('state the quantity bought.')
      lines = [
        { account_id: h.investment_account_id, debit: amt.toString(), party_id: party, dims, description: `Investment acquired — ${h.holding_no} ${h.name}` },
        { account_id: bank!.id, credit: amt.toString(), description: p.reference ?? h.holding_no },
      ]
      what = `Investment acquired: ${qty} of ${h.name}`
    } else if (p.kind === 'sale') {
      if (!qty || qty.lte(0) || qty.gt(h.quantity)) fail(`the quantity sold must be greater than zero and cannot exceed the ${h.quantity} held.`)
      const all = qty!.eq(h.quantity)
      cost = all ? D(h.cost) : round2(D(h.cost).times(qty!).div(h.quantity))
      fv = all ? D(h.fv_adjustment) : round2(D(h.fv_adjustment).times(qty!).div(h.quantity))
      gain = amt.minus(cost).minus(fv)
      const carried = cost.plus(fv)
      lines = [{ account_id: bank!.id, debit: amt.toString(), description: p.reference ?? `Proceeds — ${h.holding_no}` }]
      if (!carried.isZero()) lines.push({ account_id: h.investment_account_id, [carried.gt(0) ? 'credit' : 'debit']: carried.abs().toString(), party_id: party, dims, description: `Carrying amount of ${qty} sold — ${h.holding_no}` } as JournalLineInput)
      if (!gain.isZero()) lines.push({ account_id: gainAcc(), [gain.gt(0) ? 'credit' : 'debit']: gain.abs().toString(), dims, description: `${gain.gt(0) ? 'Gain' : 'Loss'} on sale — ${h.holding_no}` } as JournalLineInput)
      what = `Investment sold: ${qty} of ${h.name}`
    } else if (p.kind === 'income') {
      if (tax.lt(0) || tax.gte(amt)) fail('tax deducted must be less than the income.')
      const kind = (p.income_kind ?? 'income').replace(/^\w/, (m) => m.toUpperCase())
      lines = [
        { account_id: bank!.id, debit: amt.minus(tax).toString(), description: p.reference ?? `Income — ${h.holding_no}` },
        { account_id: h.income_account_id ?? this.mapAccount(h.company_id, 'investment_income'), credit: amt.toString(), party_id: party, dims, description: `${kind} from ${h.name}` },
      ]
      if (tax.gt(0)) lines.push({ account_id: this.mapAccount(h.company_id, 'tds_receivable'), debit: tax.toString(), party_id: party, description: `Tax deducted at source — ${h.holding_no}` })
      what = `${kind} received from ${h.name}`
    } else {
      if (blank(p.reason)) fail('the basis of the write-down must be recorded.')
      const carried = D(h.cost).plus(h.fv_adjustment)
      if (amt.gt(carried)) fail(`the write-down cannot exceed the carrying amount of ${carried}.`)
      lines = [
        { account_id: gainAcc(), debit: amt.toString(), dims, description: `Write-down — ${h.holding_no} — ${p.reason}` },
        { account_id: h.investment_account_id, credit: amt.toString(), party_id: party, dims, description: `Write-down — ${h.holding_no}` },
      ]
      what = `Investment written down: ${h.name} — ${p.reason}`
    }
    const t: HoldingTxn = {
      id: uid(), holding_id: h.id, company_id: h.company_id, kind: p.kind, txn_date: p.date, quantity: qty?.toString() ?? null, amount: amt.toString(), cost_released: cost?.toString() ?? null, gain: gain?.toString() ?? null, fair_value: null,
      status: 'proposed', journal_id: null, detail: { reference: p.reference, reason: p.reason, tax_deducted: tax.isZero() ? undefined : tax.toString(), income_kind: p.income_kind, fv_released: fv?.toString(), counterparty: p.counterparty },
      decided_by: null, decided_at: null, created_by: this.actor, created_at: this.now(),
    }
    this.holdingTxns.push(t)
    try {
      t.journal_id = this.proposePosting(h.company_id, 'journal', p.date, what, 'holding_txn', t.id, lines,
        { holding_id: h.id, kind: p.kind, amount: amt.toString(), quantity: qty?.toString() ?? null, cost_released: cost?.toString() ?? null, fv_released: fv?.toString() ?? null, gain: gain?.toString() ?? null }, h.confidentiality)
    } catch (e) { this.holdingTxns = this.holdingTxns.filter((x) => x.id !== t.id); throw e }
    return t.journal_id
  }

  protected wfHoldingTxn(w: WorkflowPosting, event: WfEvent) {
    const t = this.holdingTxns.find((x) => x.id === w.source_id) ?? fail('transaction not found.')
    const h = this.holding(t.holding_id)
    if (event === 'voided') { t.status = 'rejected'; return }
    const s = event === 'posted' ? 1 : -1
    const n = (k: string) => D((w.payload[k] as string | null) ?? 0)
    const qty = n('quantity'); const amt = n('amount'); const cost = n('cost_released'); const fv = n('fv_released'); const gain = n('gain')
    if (t.kind === 'purchase') {
      if (s === -1 && D(h.quantity).minus(qty).lt(0)) fail('units of this purchase have since been sold. The purchase cannot be reversed.')
      Object.assign(h, { quantity: D(h.quantity).plus(qty.times(s)).toString(), cost: D(h.cost).plus(amt.times(s)).toString(), acquired_on: h.acquired_on ?? t.txn_date })
    } else if (t.kind === 'sale') {
      const left = D(h.quantity).minus(qty.times(s))
      Object.assign(h, {
        quantity: left.toString(), cost: D(h.cost).minus(cost.times(s)).toString(), fv_adjustment: D(h.fv_adjustment).minus(fv.times(s)).toString(), realised_gain: D(h.realised_gain).plus(gain.times(s)).toString(),
        status: left.isZero() ? 'exited' : 'active', exited_on: left.isZero() ? t.txn_date : null,
      })
    } else if (t.kind === 'income') h.income_received = D(h.income_received).plus(amt.times(s)).toString()
    else if (t.kind === 'write_down') {
      if (h.measurement === 'cost') h.cost = D(h.cost).minus(amt.times(s)).toString()
      else h.fv_adjustment = D(h.fv_adjustment).minus(amt.times(s)).toString()
    } else if (t.kind === 'valuation') {
      h.fv_adjustment = D(h.fv_adjustment).plus(amt.times(s)).toString()
      if (s === 1) Object.assign(h, { fair_value: t.fair_value, fair_value_date: t.txn_date })
    }
    t.status = event === 'posted' ? 'posted' : 'reversed'
  }

  async recordHoldingValuation(p: HoldingValuationInput): Promise<ID> {
    const h = this.holding(p.holding_id)
    if (!this.canViewLevel(h.confidentiality)) fail('you are not cleared for this investment.', '42501')
    if (h.status !== 'active') fail(`this investment is ${h.status.replace(/_/g, ' ')}.`)
    if (blank(p.date) || p.fair_value === undefined || p.fair_value === null || D(p.fair_value).lt(0)) fail('a valuation needs its date and its value.')
    if (blank(p.method) || blank(p.valuer) || blank(p.basis)) fail('a valuation states its method, who made it and the assumptions it rests on.')
    this.holdingReady(h)
    const fv = round2(p.fair_value)
    const carried = D(h.cost).plus(h.fv_adjustment)
    const diff = fv.minus(carried)
    const t: HoldingTxn = {
      id: uid(), holding_id: h.id, company_id: h.company_id, kind: 'valuation', txn_date: p.date, quantity: h.quantity, amount: diff.toString(), cost_released: null, gain: null, fair_value: fv.toString(), status: 'recorded', journal_id: null,
      detail: { method: p.method, valuer: p.valuer, basis: p.basis, document_id: p.document_id, carrying_amount: carried.toString(), measurement: h.measurement }, decided_by: null, decided_at: null, created_by: this.actor, created_at: this.now(),
    }
    this.holdingTxns.push(t)
    if (h.measurement === 'fair_value' && !diff.isZero()) {
      const dims = this.dimOf(h.org_unit_id)
      const up = diff.gt(0)
      try {
        t.journal_id = this.proposePosting(h.company_id, 'adjustment', p.date, `Fair value of ${h.name} ${up ? 'rose' : 'fell'} to ${fv} — ${p.method}, ${p.valuer}`, 'holding_txn', t.id, [
          { account_id: h.investment_account_id, [up ? 'debit' : 'credit']: diff.abs().toString(), party_id: h.investee_party_id ?? undefined, dims, description: `Change in fair value — ${h.holding_no}` } as JournalLineInput,
          { account_id: h.fv_account_id ?? this.mapAccount(h.company_id, 'unrealised_gain_loss'), [up ? 'credit' : 'debit']: diff.abs().toString(), dims, description: `Unrealised ${up ? 'gain' : 'loss'} — ${h.holding_no}` } as JournalLineInput,
        ], { holding_id: h.id, kind: 'valuation', amount: diff.toString() }, h.confidentiality)
      } catch (e) { this.holdingTxns = this.holdingTxns.filter((x) => x.id !== t.id); throw e }
      t.status = 'proposed'
    }
    return t.id
  }
  async decideHoldingValuation(txnId: ID, decision: 'approved' | 'rejected', note?: string) {
    const t = this.holdingTxns.find((x) => x.id === txnId && x.kind === 'valuation') ?? fail('valuation not found.')
    const h = this.holding(t.holding_id)
    if (t.status !== 'recorded') fail(`this valuation is ${t.status}.`)
    if (!['approved', 'rejected'].includes(decision)) fail('the decision is approved or rejected.')
    if (decision === 'rejected' && blank(note)) fail('a reason is required to reject.')
    this.makerChecker(t.created_by, 'valuation')
    Object.assign(t, { status: decision, decided_by: this.actor, decided_at: this.now(), detail: { ...t.detail, decision_note: note } })
    if (decision === 'approved') Object.assign(h, { fair_value: t.fair_value, fair_value_date: t.txn_date })
    this.log(h.company_id, 'holding_txns', t.id, 'valuation_' + decision, null, { holding: h.holding_no, fair_value: t.fair_value, carrying_amount: D(h.cost).plus(h.fv_adjustment).toString(), rule: 'This investment is carried at cost. The valuation is recorded beside the books; the books are unchanged.' }, note ?? null)
  }

  // ------------------------------------------------------------ funds
  protected fund(id: ID | undefined | null, _what = '') {
    const f = this.funds.find((x) => x.id === id) ?? fail('fund not found.')
    if (!this.canViewLevel(f.confidentiality)) fail('you are not cleared for this fund.', '42501')
    return f
  }
  protected visibleFunds() { return new Set(this.funds.filter((f) => this.canViewLevel(f.confidentiality)).map((f) => f.id)) }
  async listFunds(companyIds: ID[]) { return this.funds.filter((f) => companyIds.includes(f.company_id) && this.canViewLevel(f.confidentiality)).sort((a, b) => a.name.localeCompare(b.name)) }
  async saveFund(p: FundInput): Promise<ID> {
    this.company(p.company_id)
    if (blank(p.name)) fail('a name is required.')
    this.clearance(p.confidentiality ?? 'confidential')
    if (p.manager_party_id) this.needParty(p.manager_party_id, 'unknown manager .')
    const a = this.account(p.capital_account_id)
    if (!a || a.company_id !== p.company_id || a.is_group || !a.is_active || a.type !== 'equity') fail('choose the equity ledger that carries the capital of the investors.')
    if (!p.id) {
      const f: Fund = {
        id: uid(), company_id: p.company_id, name: p.name.trim(), scheme: p.scheme ?? null, structure: p.structure ?? 'other', manager_party_id: p.manager_party_id ?? null, currency: p.currency ?? this.company(p.company_id).base_currency,
        unit_face_value: D(p.unit_face_value ?? 100).toString(), fee_pct: p.fee_pct ?? null, fee_basis: p.fee_basis ?? 'committed', capital_account_id: a!.id, commitment_period_end: p.commitment_period_end ?? null, term_end: p.term_end ?? null,
        status: p.status ?? 'open', units_outstanding: '0', confidentiality: p.confidentiality ?? 'confidential', notes: p.notes ?? null, created_at: this.now(),
      }
      this.funds.push(f)
      this.log(p.company_id, 'funds', f.id, 'insert', null, f, null)
      return f.id
    }
    const f = this.fund(p.id)
    if (f.capital_account_id !== a!.id && !D(f.units_outstanding).isZero()) fail('the capital ledger of a fund cannot change once units have been issued.')
    const old = { ...f }
    Object.assign(f, { name: p.name.trim(), scheme: p.scheme ?? null, structure: p.structure ?? f.structure, manager_party_id: p.manager_party_id ?? null, fee_pct: p.fee_pct ?? null, fee_basis: p.fee_basis ?? f.fee_basis, capital_account_id: a!.id, commitment_period_end: p.commitment_period_end ?? null, term_end: p.term_end ?? null, status: p.status ?? f.status, confidentiality: p.confidentiality ?? f.confidentiality, notes: p.notes ?? null })
    this.log(p.company_id, 'funds', f.id, 'update', old, f, p.reason ?? null)
    return f.id
  }
  async listCommitments(f: { fundId?: ID; companyIds?: ID[] }) {
    const seen = this.visibleFunds()
    return this.commitments.filter((c) => seen.has(c.fund_id) && (!f.fundId || c.fund_id === f.fundId) && (!f.companyIds || f.companyIds.includes(c.company_id))).sort((a, b) => a.commitment_date.localeCompare(b.commitment_date))
  }
  async saveCommitment(p: CommitmentInput): Promise<ID> {
    const f = this.fund(p.fund_id)
    if (!p.investor_party_id) fail('name the investor.')
    this.needParty(p.investor_party_id, 'unknown investor .')
    const amt = round2(p.committed_amount ?? 0)
    if (amt.lte(0)) fail('the commitment must be greater than zero.')
    const cls = blank(p.unit_class) ? 'A' : p.unit_class!.trim()
    if (!p.id) {
      if (this.commitments.some((c) => c.fund_id === f.id && c.investor_party_id === p.investor_party_id && c.unit_class === cls)) fail('this investor already has a commitment in this class. Change that commitment instead.')
      const c: FundCommitment = { id: uid(), fund_id: f.id, company_id: f.company_id, investor_party_id: p.investor_party_id, unit_class: cls, committed_amount: amt.toString(), commitment_date: p.commitment_date ?? today(), status: 'active', called_amount: '0', contributed_amount: '0', units: '0', distributed_amount: '0', note: p.note ?? null }
      this.commitments.push(c)
      this.log(f.company_id, 'fund_commitments', c.id, 'insert', null, c, null)
      return c.id
    }
    const c = this.commitments.find((x) => x.id === p.id && x.fund_id === f.id) ?? fail('commitment not found.')
    if (amt.lt(c.called_amount)) fail(`${c.called_amount} has already been called on this commitment. It cannot be lowered below that.`)
    const old = { ...c }
    Object.assign(c, { committed_amount: amt.toString(), status: p.status ?? c.status, note: p.note ?? null })
    this.log(f.company_id, 'fund_commitments', c.id, 'update', old, c, p.reason ?? null)
    return c.id
  }

  protected call(id: ID) { return this.capitalCalls.find((c) => c.id === id) ?? fail('capital call not found.') }
  protected withCallLines(c: CapitalCall): CapitalCall { return { ...c, lines: this.capitalCallLines.filter((l) => l.call_id === c.id) } }
  async listCapitalCalls(f: { fundId?: ID; companyIds?: ID[] }) {
    const seen = this.visibleFunds()
    return this.capitalCalls.filter((c) => seen.has(c.fund_id) && (!f.fundId || c.fund_id === f.fundId) && (!f.companyIds || f.companyIds.includes(c.company_id)))
      .sort((a, b) => b.call_date.localeCompare(a.call_date)).map((c) => this.withCallLines(c))
  }
  async saveCapitalCall(p: CapitalCallInput): Promise<ID> {
    const f = this.fund(p.fund_id)
    if (!['forming', 'open'].includes(f.status)) fail(`this fund is ${f.status.replace(/_/g, ' ')}. Capital can no longer be called.`)
    if (blank(p.call_date) || blank(p.due_date)) fail('the date of the call and the date by which it is due are required.')
    const pct = D(p.pct ?? 0)
    if (pct.lte(0) || pct.gt(100)) fail('state the share of the commitment that is called, as a percentage.')
    if (blank(p.purpose)) fail('a capital call states its purpose.')
    let c = p.id ? this.call(p.id) : undefined
    if (c && (c.fund_id !== f.id || !['draft', 'rejected'].includes(c.status))) fail(`only a draft can be edited. This call is ${c.status}.`)
    const id = c?.id ?? uid()
    const lines: CapitalCallLine[] = []
    let total = ZERO
    for (const cm of this.commitments.filter((x) => x.fund_id === f.id && x.status === 'active').sort((a, b) => a.commitment_date.localeCompare(b.commitment_date))) {
      const inDraft = this.capitalCallLines.filter((l) => l.commitment_id === cm.id && l.call_id !== id && ['draft', 'submitted'].includes(this.call(l.call_id).status)).reduce((s, l) => s.plus(l.amount), ZERO)
      const amt = Decimal.min(round2(D(cm.committed_amount).times(pct).div(100)), D(cm.committed_amount).minus(cm.called_amount).minus(inDraft))
      if (amt.gt(0)) { lines.push({ id: uid(), call_id: id, company_id: f.company_id, commitment_id: cm.id, investor_party_id: cm.investor_party_id, amount: amt.toString(), received_amount: '0', units_allotted: '0', status: 'due' }); total = total.plus(amt) }
    }
    if (!lines.length) fail('nothing is left to call: every commitment has been called in full.')
    const fields = { status: 'draft' as const, call_date: p.call_date, due_date: p.due_date, pct: pct.toString(), unit_price: D(p.unit_price ?? f.unit_face_value).toString(), purpose: p.purpose.trim(), total_amount: total.toString() }
    if (!c) {
      c = { id, fund_id: f.id, company_id: f.company_id, call_no: this.docNo(f.company_id, 'capital_call', 'CALL', p.call_date), decision_note: null, created_by: this.actor, created_at: this.now(), ...fields }
      this.capitalCalls.push(c)
    } else {
      Object.assign(c, fields)
      this.capitalCallLines = this.capitalCallLines.filter((l) => l.call_id !== id)
    }
    this.capitalCallLines.push(...lines)
    return id
  }
  async submitCapitalCall(id: ID) {
    const c = this.call(id); const f = this.fund(c.fund_id)
    if (c.status !== 'draft') fail(`only a draft can be submitted. This call is ${c.status}.`)
    this.openRequest(c.company_id, 'capital_call', c.id, c.total_amount, `Capital call ${c.call_no} — ${f.name} — ${c.purpose}`)
    c.status = 'submitted'
  }
  async decideCapitalCall(id: ID, decision: 'approved' | 'rejected', comment?: string): Promise<'approved' | 'pending' | 'rejected'> {
    const c = this.call(id); this.fund(c.fund_id)
    if (c.status !== 'submitted') fail(`this call is not awaiting approval. It is ${c.status}.`)
    if (decision === 'rejected') {
      this.refuseRequest('capital_call', c.id, 'capital call', comment ?? '')
      Object.assign(c, { status: 'rejected', decision_note: comment ?? null })
      return 'rejected'
    }
    const v = this.decideRequest('capital_call', c.id, c.created_by, 'capital call', comment)
    if (v === 'approved') {
      // the call is now owed by the investors: what has been called rises. No money has moved and nothing is posted.
      for (const l of this.capitalCallLines.filter((x) => x.call_id === c.id)) { const cm = this.commitments.find((x) => x.id === l.commitment_id)!; cm.called_amount = D(cm.called_amount).plus(l.amount).toString() }
      Object.assign(c, { status: 'approved', approved_by: this.actor, approved_at: this.now(), decision_note: comment ?? null })
    }
    return v
  }
  async proposeCapitalReceipt(p: CapitalReceiptInput): Promise<ID> {
    const l = this.capitalCallLines.find((x) => x.id === p.line_id) ?? fail('that line of the capital call was not found.')
    const c = this.call(l.call_id); const f = this.fund(c.fund_id)
    if (c.status !== 'approved') fail(`money is received against a capital call that has been approved. This call is ${c.status}.`)
    if (blank(p.date)) fail('the date is required.')
    const amt = round2(p.amount ?? 0)
    const pend = this.unitAllotments.filter((a) => a.call_line_id === l.id && a.status === 'proposed').reduce((s, a) => s.plus(a.amount), ZERO)
    const room = D(l.amount).minus(l.received_amount).minus(pend)
    if (amt.lte(0) || amt.gt(room)) fail(`${l.amount} was called, ${l.received_amount} has been received and ${pend} awaits approval. The receipt cannot exceed ${room}.`)
    const bank = this.bankLedger(f.company_id, p.bank_ledger_id, 'choose the bank ledger that received the money.', true)
    const units = amt.div(c.unit_price).toDecimalPlaces(4)
    const a: UnitAllotment = { id: uid(), fund_id: f.id, company_id: f.company_id, commitment_id: l.commitment_id, call_line_id: l.id, allot_date: p.date, amount: amt.toString(), unit_price: c.unit_price, units: units.toString(), journal_id: null, status: 'proposed' }
    this.unitAllotments.push(a)
    try {
      a.journal_id = this.proposePosting(f.company_id, 'receipt', p.date, `Capital received on call ${c.call_no} — ${f.name} — ${units} units at ${c.unit_price}`, 'capital_receipt', a.id, [
        { account_id: bank.id, debit: amt.toString(), description: p.reference ?? c.call_no },
        { account_id: f.capital_account_id, credit: amt.toString(), party_id: l.investor_party_id, description: `Capital contributed — ${c.call_no}` },
      ], { line_id: l.id, amount: amt.toString(), units: units.toString(), reference: p.reference }, f.confidentiality)
    } catch (e) { this.unitAllotments = this.unitAllotments.filter((x) => x.id !== a.id); throw e }
    return a.journal_id
  }
  protected wfCapitalReceipt(w: WorkflowPosting, event: WfEvent) {
    const a = this.unitAllotments.find((x) => x.id === w.source_id) ?? fail('allotment not found.')
    if (event === 'voided') { a.status = 'rejected'; return }
    const s = event === 'posted' ? 1 : -1
    const l = this.capitalCallLines.find((x) => x.id === a.call_line_id)!
    l.received_amount = D(l.received_amount).plus(D(a.amount).times(s)).toString()
    l.units_allotted = D(l.units_allotted).plus(D(a.units).times(s)).toString()
    l.status = D(l.received_amount).gte(l.amount) ? 'received' : D(l.received_amount).gt(0) ? 'part_received' : 'due'
    const cm = this.commitments.find((x) => x.id === a.commitment_id)!
    cm.contributed_amount = D(cm.contributed_amount).plus(D(a.amount).times(s)).toString(); cm.units = D(cm.units).plus(D(a.units).times(s)).toString()
    const f = this.funds.find((x) => x.id === a.fund_id)!
    f.units_outstanding = D(f.units_outstanding).plus(D(a.units).times(s)).toString()
    a.status = event === 'posted' ? 'posted' : 'reversed'
    const c = this.call(l.call_id)
    if (['approved', 'closed'].includes(c.status)) c.status = this.capitalCallLines.some((x) => x.call_id === c.id && D(x.received_amount).lt(x.amount)) ? 'approved' : 'closed'
  }
  async listUnitAllotments(fundId: ID) { this.fund(fundId); return this.unitAllotments.filter((a) => a.fund_id === fundId).sort((a, b) => a.allot_date.localeCompare(b.allot_date)) }

  // ------------------------------------------------------------ dividends and distributions
  protected distribution(id: ID) {
    const d = this.distributions.find((x) => x.id === id) ?? fail('record not found.')
    if (!this.canViewLevel(d.confidentiality)) fail('you are not cleared for this record.', '42501')
    return d
  }
  async listDistributions(companyIds: ID[]) { return this.distributions.filter((d) => companyIds.includes(d.company_id) && this.canViewLevel(d.confidentiality)).sort((a, b) => b.declaration_date.localeCompare(a.declaration_date)) }
  async getDistribution(id: ID) { const d = this.distribution(id); return { ...d, lines: this.distributionLines.filter((l) => l.distribution_id === id) } }
  async saveDistribution(p: DistributionInput): Promise<ID> {
    this.company(p.company_id)
    if (!['dividend', 'distribution', 'return_of_capital'].includes(p.kind)) fail('state whether this is a dividend, a distribution or a return of capital.')
    if (blank(p.declaration_date) || blank(p.record_date)) fail('the date of declaration and the record date are required.')
    const total = round2(p.total_amount ?? 0)
    if (total.lte(0)) fail('the amount must be greater than zero.')
    const taxPct = D(p.tax_pct ?? 0)
    if (taxPct.lt(0) || taxPct.gte(100)) fail('the rate of tax deducted is a percentage below 100.')
    const f = p.fund_id ? this.fund(p.fund_id) : undefined
    if (f && f.company_id !== p.company_id) fail('the fund belongs to another company.')
    if (!f && p.kind !== 'dividend') fail('a distribution or a return of capital belongs to a fund. A company declares a dividend.')
    const a = this.account(p.source_account_id)
    if (!a || a.company_id !== p.company_id || a.is_group || !a.is_active || a.type !== 'equity') fail('choose the equity ledger the amount is paid out of.')
    let d = p.id ? this.distribution(p.id) : undefined
    if (d && !['draft', 'rejected'].includes(d.status)) fail(`only a draft can be edited. This one is ${d.status}.`)
    // entitlement: in proportion to the units or shares held on the record date
    const holders: { party: ID; commitment: ID | null; units: Decimal }[] = f
      ? this.commitments.filter((c) => c.fund_id === f.id).map((c) => ({ party: c.investor_party_id, commitment: c.id, units: this.unitAllotments.filter((u) => u.commitment_id === c.id && u.status === 'posted' && u.allot_date <= p.record_date).reduce((s, u) => s.plus(u.units), ZERO) }))
      : [...this.equityHolders.filter((e) => e.company_id === p.company_id).reduce((m, e) => m.set(e.holder_party_id, (m.get(e.holder_party_id) ?? ZERO).plus(e.quantity)), new Map<ID, Decimal>())].map(([party, units]) => ({ party, commitment: null, units }))
    const entitled = holders.filter((h) => h.units.gt(0)).sort((x, y) => y.units.cmp(x.units) || x.party.localeCompare(y.party))
    if (!entitled.length) fail(`nobody holds ${f ? 'units of this fund' : 'shares of this company'} on the record date, so nobody is entitled. Record the holders first.`)
    const id = d?.id ?? uid()
    const units = entitled.reduce((s, h) => s.plus(h.units), ZERO)
    let left = total
    const lines: DistributionLine[] = entitled.map((h, i) => {
      const gross = i === entitled.length - 1 ? left : round2(total.times(h.units).div(units))
      left = left.minus(gross)
      const tax = round2(gross.times(taxPct).div(100))
      return { id: uid(), distribution_id: id, company_id: p.company_id, holder_party_id: h.party, commitment_id: h.commitment, units: h.units.toString(), gross_amount: gross.toString(), tax_deducted: tax.toString(), net_amount: gross.minus(tax).toString(), status: 'entitled', paid_on: null, payment_journal_id: null }
    })
    const fields = { status: 'draft' as const, fund_id: f?.id ?? null, kind: p.kind, declaration_date: p.declaration_date, record_date: p.record_date, payment_date: p.payment_date ?? null, total_amount: total.toString(), tax_pct: taxPct.toString(), source_account_id: a!.id, notes: p.notes ?? null }
    if (!d) {
      d = { id, company_id: p.company_id, dist_no: this.docNo(p.company_id, 'distribution', p.kind === 'dividend' ? 'DIV' : 'DIST', p.declaration_date), journal_id: null, decision_note: null, confidentiality: f?.confidentiality ?? 'confidential', created_by: this.actor, created_at: this.now(), ...fields }
      this.distributions.push(d)
    } else {
      Object.assign(d, fields)
      this.distributionLines = this.distributionLines.filter((l) => l.distribution_id !== id)
    }
    this.distributionLines.push(...lines)
    this.log(p.company_id, 'fund_distributions', id, 'draft_saved', null, { dist_no: d.dist_no, kind: d.kind, total_amount: d.total_amount, holders: lines.length }, null)
    return id
  }
  async submitDistribution(id: ID) {
    const d = this.distribution(id)
    if (d.status !== 'draft') fail(`only a draft can be submitted. This one is ${d.status}.`)
    this.openRequest(d.company_id, 'distribution', d.id, d.total_amount, `${d.kind.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())} ${d.dist_no}`)
    d.status = 'submitted'
    this.log(d.company_id, 'fund_distributions', d.id, 'submitted', null, { dist_no: d.dist_no, total_amount: d.total_amount }, null)
  }
  async decideDistribution(id: ID, decision: 'approved' | 'rejected', comment?: string): Promise<'approved' | 'pending' | 'rejected'> {
    const d = this.distribution(id)
    const what = d.kind.replace(/_/g, ' ')
    if (d.status !== 'submitted') fail(`this is not awaiting approval. It is ${d.status}.`)
    if (decision === 'rejected') {
      this.refuseRequest('distribution', d.id, what, comment ?? '')
      Object.assign(d, { status: 'rejected', decision_note: comment ?? null })
      return 'rejected'
    }
    const pay = this.mapAccount(d.company_id, 'distribution_payable')
    const v = this.decideRequest('distribution', d.id, d.created_by, what, comment)
    if (v === 'approved') {
      const label = what.replace(/^\w/, (m) => m.toUpperCase())
      Object.assign(d, { status: 'approved', approved_by: this.actor, approved_at: this.now(), decision_note: comment ?? null })
      d.journal_id = this.proposePosting(d.company_id, 'journal', d.declaration_date, `${label} ${d.dist_no} declared: ${d.total_amount} to the holders on record on ${d.record_date}`, 'distribution', d.id, [
        { account_id: d.source_account_id, debit: d.total_amount as string, description: `${label} declared — ${d.dist_no}` },
        ...this.distributionLines.filter((l) => l.distribution_id === d.id).map((l) => ({ account_id: pay, credit: l.gross_amount as string, party_id: l.holder_party_id, description: `Entitlement — ${d.dist_no}` })),
      ], { amount: d.total_amount }, d.confidentiality)
    }
    return v
  }
  protected wfDistribution(w: WorkflowPosting, event: WfEvent) {
    const d = this.distributions.find((x) => x.id === w.source_id) ?? fail('record not found.')
    if (event === 'posted') d.status = 'declared'
    else if (event === 'voided') Object.assign(d, { status: 'rejected', journal_id: null, decision_note: 'The accounting entry of the declaration was rejected.' })
    else {
      if (this.distributionLines.some((l) => l.distribution_id === d.id && l.status !== 'entitled')) fail('payments have been made or proposed on this declaration. Reverse them first.')
      d.status = 'cancelled'
    }
  }
  async proposeDistributionPayment(p: DistributionPaymentInput): Promise<ID> {
    const d = this.distribution(p.distribution_id)
    const what = d.kind.replace(/_/g, ' ')
    if (!['declared', 'part_paid'].includes(d.status)) fail(`payment follows the declaration. This ${what} is ${d.status}.`)
    if (blank(p.date)) fail('the date of payment is required.')
    const bank = this.bankLedger(d.company_id, p.bank_ledger_id, 'choose the bank ledger the payment was made from.', true)
    const chosen = this.distributionLines.filter((l) => l.distribution_id === d.id && l.status === 'entitled' && (!p.line_ids || p.line_ids.includes(l.id)))
    if (!chosen.length) fail('nothing is left to pay on this declaration.')
    const pay = this.mapAccount(d.company_id, 'distribution_payable')
    const gross = chosen.reduce((s, l) => s.plus(l.gross_amount), ZERO); const tax = chosen.reduce((s, l) => s.plus(l.tax_deducted), ZERO)
    const lines: JournalLineInput[] = [
      ...chosen.map((l) => ({ account_id: pay, debit: l.gross_amount as string, party_id: l.holder_party_id, description: `Paid — ${d.dist_no}` })),
      { account_id: bank.id, credit: gross.minus(tax).toString(), description: p.reference ?? d.dist_no },
    ]
    if (tax.gt(0)) lines.push({ account_id: this.mapAccount(d.company_id, 'tds_payable'), credit: tax.toString(), description: `Tax deducted at source — ${d.dist_no}` })
    const j = this.proposePosting(d.company_id, 'payment', p.date, `${what.replace(/^\w/, (m) => m.toUpperCase())} ${d.dist_no} paid to ${chosen.length} holder(s)`, 'distribution_payment', d.id, lines,
      { line_ids: chosen.map((l) => l.id), amount: gross.toString(), date: p.date }, d.confidentiality)
    chosen.forEach((l) => Object.assign(l, { status: 'payment_proposed', payment_journal_id: j }))
    return j
  }
  protected wfDistributionPayment(w: WorkflowPosting, event: WfEvent) {
    const ids = (w.payload.line_ids as ID[]) ?? []
    const lines = this.distributionLines.filter((l) => ids.includes(l.id))
    if (event === 'voided') { lines.forEach((l) => Object.assign(l, { status: 'entitled', payment_journal_id: null })); return }
    const s = event === 'posted' ? 1 : -1
    for (const l of lines) {
      Object.assign(l, { status: s === 1 ? 'paid' : 'entitled', paid_on: s === 1 ? (w.payload.date as string) : null, payment_journal_id: s === 1 ? w.journal_id : null })
      const cm = this.commitments.find((x) => x.id === l.commitment_id)
      if (cm) cm.distributed_amount = D(cm.distributed_amount).plus(D(l.gross_amount).times(s)).toString()
    }
    const d = this.distributions.find((x) => x.id === w.source_id)!
    const all = this.distributionLines.filter((l) => l.distribution_id === d.id)
    d.status = all.every((l) => l.status === 'paid') ? 'paid' : all.some((l) => l.status === 'paid') ? 'part_paid' : 'declared'
  }

  // ------------------------------------------------------------ net asset value
  async listNavRuns(fundId: ID) { this.fund(fundId); return this.navRuns.filter((n) => n.fund_id === fundId).sort((a, b) => b.nav_date.localeCompare(a.nav_date) || b.prepared_at.localeCompare(a.prepared_at)) }
  async prepareNav(fundId: ID, navDate: string, note?: string): Promise<ID> {
    const f = this.fund(fundId)
    if (blank(navDate)) fail('the date is required.')
    if (this.funds.filter((x) => x.company_id === f.company_id && x.status !== 'wound_up').length > 1)
      fail("the net asset value is worked out from the books of the fund's company. Several funds share this company, so their net assets cannot be told apart. Give each fund a company of its own.")
    const posted = this.postedSet(navDate)
    let assets = ZERO; let liab = ZERO
    for (const l of this.lines) {
      if (l.company_id !== f.company_id || !posted.has(l.journal_id)) continue
      const t = this.account(l.account_id)?.type
      if (t === 'asset') assets = assets.plus(l.debit).minus(l.credit)
      else if (t === 'liability') liab = liab.plus(l.credit).minus(l.debit)
    }
    const units = this.unitAllotments.filter((u) => u.fund_id === f.id && u.status === 'posted' && u.allot_date <= navDate).reduce((s, u) => s.plus(u.units), ZERO)
    const hs = this.holdings.filter((h) => h.company_id === f.company_id && h.status === 'active')
    const stale = hs.filter((h) => h.measurement === 'cost' || !h.fair_value_date || h.fair_value_date < addDays(navDate, -92)).length
    this.navRuns.forEach((n) => { if (n.fund_id === f.id && n.nav_date === navDate && n.status === 'draft') n.status = 'superseded' })
    const n: NavRun = {
      id: uid(), fund_id: f.id, company_id: f.company_id, nav_date: navDate, total_assets: assets.toString(), total_liabilities: liab.toString(), net_assets: assets.minus(liab).toString(), units: units.toString(),
      nav_per_unit: units.gt(0) ? assets.minus(liab).div(units).toDecimalPlaces(6).toString() : null,
      basis: {
        formula: 'Net asset value per unit = (assets − liabilities, from posted entries up to the date) ÷ units issued up to the date', holdings_not_at_recent_fair_value: stale,
        holdings_carried_at_cost: hs.filter((h) => h.measurement === 'cost').reduce((s, h) => s.plus(h.cost), ZERO).toString(),
        entries_awaiting_approval: this.journals.filter((j) => j.company_id === f.company_id && j.status === 'submitted' && j.journal_date <= navDate).length,
        caution: 'This is an accounting figure from the books as they stand. It is not a regulatory valuation. Holdings carried at cost, or valued more than three months before the date, are included at their book amount.',
      },
      status: 'draft', note: note ?? null, prepared_by: this.actor, prepared_at: this.now(), approved_by: null, approved_at: null,
    }
    this.navRuns.push(n)
    return n.id
  }
  async decideNav(id: ID, decision: 'approved' | 'rejected', note?: string) {
    const n = this.navRuns.find((x) => x.id === id) ?? fail('record not found.')
    this.fund(n.fund_id)
    if (n.status !== 'draft') fail(`this net asset value is ${n.status}.`)
    if (!['approved', 'rejected'].includes(decision)) fail('the decision is approved or rejected.')
    if (decision === 'rejected' && blank(note)) fail('a reason is required to reject.')
    this.makerChecker(n.prepared_by, 'net asset value')
    if (decision === 'approved') this.navRuns.forEach((x) => { if (x.fund_id === n.fund_id && x.nav_date === n.nav_date && x.status === 'approved') x.status = 'superseded' })
    Object.assign(n, { status: decision, approved_by: this.actor, approved_at: this.now(), note: note ?? n.note })
  }

  // ------------------------------------------------------------ management fee
  async listFundFees(fundId: ID) { this.fund(fundId); return this.fundFees.filter((x) => x.fund_id === fundId).sort((a, b) => b.period_from.localeCompare(a.period_from)) }
  async proposeFundFee(fundId: ID, from: string, to: string): Promise<ID> {
    const f = this.fund(fundId)
    if (blank(from) || blank(to) || to < from) fail('state the period the fee covers.')
    if (to > today()) fail('a fee is charged for days that have passed. The period ends after today.')
    if (f.fee_pct === null || D(f.fee_pct).isZero()) fail('this fund records no rate of management fee.')
    if (!f.manager_party_id) fail('this fund names no manager to whom the fee is owed.')
    if (this.fundFees.some((x) => x.fund_id === f.id && ['proposed', 'posted'].includes(x.status) && x.period_from <= to && x.period_to >= from)) fail('a fee has already been proposed or posted for part of this period.')
    const cms = this.commitments.filter((c) => c.fund_id === f.id)
    const nav = this.navRuns.filter((n) => n.fund_id === f.id && n.status === 'approved' && n.nav_date <= to).sort((a, b) => b.nav_date.localeCompare(a.nav_date))[0]
    const basis = f.fee_basis === 'committed' ? cms.filter((c) => c.status === 'active').reduce((s, c) => s.plus(c.committed_amount), ZERO)
      : f.fee_basis === 'contributed' ? cms.reduce((s, c) => s.plus(c.contributed_amount), ZERO) : nav ? D(nav.net_assets) : null
    if (basis === null) fail(`the fee of this fund rests on its net asset value, and no approved net asset value exists up to ${to}.`)
    const days = daysBetween(from, to) + 1
    const amt = round2(basis!.times(f.fee_pct!).div(100).times(days).div(365))
    if (amt.lte(0)) fail(`the fee works out to nothing: the basis is ${basis}.`)
    const fee: FundFee = { id: uid(), fund_id: f.id, company_id: f.company_id, period_from: from, period_to: to, basis: f.fee_basis, basis_amount: basis!.toString(), rate: f.fee_pct!, amount: amt.toString(), status: 'proposed', journal_id: null, created_at: this.now() }
    this.fundFees.push(fee)
    try {
      fee.journal_id = this.proposePosting(f.company_id, 'journal', to, `Management fee of ${f.name}, ${from} to ${to}: ${f.fee_pct}% a year on ${f.fee_basis} capital of ${basis}`, 'fund_fee', fee.id, [
        { account_id: this.mapAccount(f.company_id, 'management_fee_expense'), debit: amt.toString(), description: `Management fee — ${f.name}` },
        { account_id: this.mapAccount(f.company_id, 'management_fee_payable'), credit: amt.toString(), party_id: f.manager_party_id!, description: `Management fee payable — ${f.name}` },
      ], { amount: amt.toString(), formula: 'basis × rate × days ÷ 365', basis: basis!.toString(), rate: f.fee_pct, days }, f.confidentiality)
    } catch (e) { this.fundFees = this.fundFees.filter((x) => x.id !== fee.id); throw e }
    return fee.journal_id
  }
}
