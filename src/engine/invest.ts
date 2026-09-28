// Investments, funds and the corporate structure. Pure calculation over records.
//
// Nothing here is a regulatory computation. Multiples and net asset values are
// arithmetic on what the books and the registers hold, each with its formula.

import Decimal from 'decimal.js'
import { D, ZERO } from '@/lib/money'
import { daysBetween } from '@/lib/dates'
import type { Company, ID, Party } from './types'
import type { CapitalCall, CorporateLink, CorporateRelation, Distribution, DistributionLine, Fund, FundCommitment, Holding, NavRun, UnitAllotment, HoldingTxn } from './p3Types'

export const carryingAmount = (h: Pick<Holding, 'cost' | 'fv_adjustment'>) => D(h.cost).plus(h.fv_adjustment)

export interface HoldingPosition {
  holding: Holding
  carrying: Decimal
  /** the latest approved valuation, where one exists */
  valuation: Decimal | null
  valuationAge: number | null
  /** valuation − carrying amount. For a holding at cost this stands beside the books; it is not in them. */
  beside: Decimal | null
  inBooks: 'cost' | 'fair value'
  costPerUnit: Decimal | null
  says: string
}
export function holdingPosition(h: Holding, asOf: string): HoldingPosition {
  const carrying = carryingAmount(h)
  const valuation = h.fair_value === null ? null : D(h.fair_value)
  const age = h.fair_value_date ? daysBetween(h.fair_value_date, asOf) : null
  const beside = valuation === null || h.measurement === 'fair_value' ? null : valuation.minus(carrying)
  return {
    holding: h, carrying, valuation, valuationAge: age, beside, inBooks: h.measurement === 'cost' ? 'cost' : 'fair value', costPerUnit: D(h.quantity).isZero() ? null : D(h.cost).div(h.quantity),
    says: h.measurement === 'fair_value'
      ? valuation === null ? 'Carried at fair value, but no valuation is on record: the books show what was paid.' : `Carried at fair value. The last valuation is of ${h.fair_value_date}${age !== null && age > 92 ? `, ${age} days ago` : ''}.`
      : valuation === null ? 'Carried at cost. No valuation is on record.' : `Carried at cost. A valuation of ${h.fair_value_date} puts it at ${valuation.toFixed(2)}; that figure is not in the books.`,
  }
}

/**
 * Holdings whose valuation on record was made when a different quantity was held, with that quantity.
 * A sale or a purchase after the valuation does not restate it, so it no longer describes what is held.
 */
export function valuedWhenHeld(holdings: Holding[], txns: HoldingTxn[]): Map<ID, Decimal> {
  const m = new Map<ID, Decimal>()
  for (const h of holdings) {
    if (h.fair_value === null || !h.fair_value_date) continue
    const t = txns.find((x) => x.holding_id === h.id && x.kind === 'valuation' && (x.status === 'posted' || x.status === 'approved') && x.txn_date === h.fair_value_date && x.quantity !== null && D(x.fair_value).eq(D(h.fair_value)))
    if (t && !D(t.quantity).eq(h.quantity)) m.set(h.id, D(t.quantity))
  }
  return m
}

/** Investments held by each company: the group investment map. */
export function investmentMap(holdings: Holding[], companies: Company[], parties: Party[], asOf: string) {
  const name = (h: Holding) => h.investee_company_id ? companies.find((c) => c.id === h.investee_company_id)?.name ?? h.name : parties.find((p) => p.id === h.investee_party_id)?.display_name ?? h.name
  return companies.map((c) => {
    const hs = holdings.filter((h) => h.company_id === c.id && h.status === 'active').map((h) => ({ ...holdingPosition(h, asOf), investee: name(h), inGroup: !!h.investee_company_id }))
    return {
      company: c, holdings: hs, carrying: hs.reduce((s, h) => s.plus(h.carrying), ZERO), atCost: hs.filter((h) => h.holding.measurement === 'cost').reduce((s, h) => s.plus(h.carrying), ZERO),
      inGroup: hs.filter((h) => h.inGroup).reduce((s, h) => s.plus(h.carrying), ZERO), notValued: hs.filter((h) => h.valuation === null).length,
    }
  }).filter((x) => x.holdings.length)
}

// ------------------------------------------------------------------ funds
export interface FundSummary {
  committed: Decimal; called: Decimal; contributed: Decimal; uncalled: Decimal; outstandingCalls: Decimal; distributed: Decimal; units: Decimal
  nav: NavRun | null
  /** each multiple carries its formula; none is shown where its divisor is zero */
  multiples: { key: 'dpi' | 'rvpi' | 'tvpi'; label: string; value: Decimal | null; formula: string }[]
  notes: string[]
}
export function fundSummary(fund: Fund, commitments: FundCommitment[], navRuns: NavRun[]): FundSummary {
  const cs = commitments.filter((c) => c.fund_id === fund.id)
  const s = (k: keyof FundCommitment) => cs.reduce((t, c) => t.plus(D(c[k] as string)), ZERO)
  // a commitment that has ended can be called no further: what was called of it is all that it was good for
  const ended = cs.filter((c) => c.status !== 'active')
  const committed = cs.reduce((t, c) => t.plus(c.status === 'active' ? c.committed_amount : c.called_amount), ZERO)
  const called = s('called_amount'); const contributed = s('contributed_amount'); const distributed = s('distributed_amount')
  const nav = navRuns.filter((n) => n.fund_id === fund.id && n.status === 'approved').sort((a, b) => b.nav_date.localeCompare(a.nav_date))[0] ?? null
  const div = (a: Decimal, b: Decimal) => (b.isZero() ? null : a.div(b).toDecimalPlaces(4))
  const dpi = div(distributed, contributed); const rvpi = nav ? div(D(nav.net_assets), contributed) : null
  const notes: string[] = []
  if (!nav) notes.push('No net asset value has been approved, so the value still held cannot be stated.')
  if (contributed.isZero()) notes.push('No capital has been contributed yet.')
  if (ended.length) notes.push(`${ended.length} commitment(s) have ended. They count for what was called of them, and nothing of them remains to be called.`)
  return {
    committed, called, contributed, uncalled: committed.minus(called), outstandingCalls: called.minus(contributed), distributed, units: D(fund.units_outstanding), nav,
    multiples: [
      { key: 'dpi', label: 'Distributed to paid-in', value: dpi, formula: 'distributions paid ÷ capital contributed' },
      { key: 'rvpi', label: 'Residual value to paid-in', value: rvpi, formula: 'net assets at the last approved valuation ÷ capital contributed' },
      { key: 'tvpi', label: 'Total value to paid-in', value: dpi !== null && rvpi !== null ? dpi.plus(rvpi) : null, formula: '(distributions paid + net assets) ÷ capital contributed' },
    ],
    notes,
  }
}

export interface InvestorStatement {
  commitment: FundCommitment
  committed: Decimal; called: Decimal; contributed: Decimal; uncalled: Decimal; owing: Decimal; units: Decimal; sharePct: Decimal | null
  distributedGross: Decimal; taxDeducted: Decimal; distributedNet: Decimal
  /** units × the last approved net asset value per unit */
  value: Decimal | null
  navDate: string | null
  lines: { date: string; what: string; amount: Decimal; units: Decimal | null; kind: 'call' | 'contribution' | 'distribution' }[]
}
export function investorStatement(c: FundCommitment, fund: Fund, calls: CapitalCall[], allotments: UnitAllotment[], distributions: (Distribution & { lines?: DistributionLine[] })[], navRuns: NavRun[]): InvestorStatement {
  const nav = navRuns.filter((n) => n.fund_id === fund.id && n.status === 'approved' && n.nav_per_unit !== null).sort((a, b) => b.nav_date.localeCompare(a.nav_date))[0]
  const lines: InvestorStatement['lines'] = []
  for (const call of calls.filter((x) => x.fund_id === fund.id && ['approved', 'closed'].includes(x.status)))
    for (const l of call.lines ?? []) if (l.commitment_id === c.id) lines.push({ date: call.call_date, what: `Capital call ${call.call_no} — ${call.purpose}`, amount: D(l.amount), units: null, kind: 'call' })
  for (const a of allotments.filter((x) => x.commitment_id === c.id && x.status === 'posted')) lines.push({ date: a.allot_date, what: `Contribution received — ${D(a.units)} units at ${D(a.unit_price)}`, amount: D(a.amount), units: D(a.units), kind: 'contribution' })
  let gross = ZERO; let tax = ZERO
  for (const d of distributions.filter((x) => x.fund_id === fund.id)) for (const l of d.lines ?? []) {
    if (l.commitment_id !== c.id || l.status !== 'paid') continue
    gross = gross.plus(l.gross_amount); tax = tax.plus(l.tax_deducted)
    lines.push({ date: l.paid_on ?? d.declaration_date, what: `${d.kind.replace(/_/g, ' ')} ${d.dist_no} paid`, amount: D(l.net_amount), units: null, kind: 'distribution' })
  }
  const units = D(c.units); const total = D(fund.units_outstanding)
  return {
    commitment: c, committed: D(c.committed_amount), called: D(c.called_amount), contributed: D(c.contributed_amount), uncalled: c.status === 'active' ? D(c.committed_amount).minus(c.called_amount) : ZERO, owing: D(c.called_amount).minus(c.contributed_amount), units,
    sharePct: total.isZero() ? null : units.times(100).div(total).toDecimalPlaces(4), distributedGross: gross, taxDeducted: tax, distributedNet: gross.minus(tax),
    value: nav ? units.times(nav.nav_per_unit!).toDecimalPlaces(2) : null, navDate: nav?.nav_date ?? null, lines: lines.sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// ------------------------------------------------------------------ corporate structure
export interface CorpNode {
  key: string
  kind: 'company' | 'party'
  id: ID
  name: string
  inNumero: boolean
  relation: CorporateRelation | null
  /** held directly by the node above */
  directPct: Decimal | null
  /** held by the top of the tree, through every level: the product of the percentages on the way down */
  effectivePct: Decimal | null
  children: CorpNode[]
}
export const RELATION_LABEL: Record<CorporateRelation, string> = {
  subsidiary: 'Subsidiary', associate: 'Associate', joint_venture: 'Joint venture', spv: 'Special purpose vehicle', investment_entity: 'Investment entity', operating_company: 'Operating company', holding_company: 'Holding company', branch: 'Branch',
}
/** The group as a tree. An entity with no owner on record stands at the top. An entity with two owners appears under each. */
export function corporateTree(links: CorporateLink[], companies: Company[], parties: Party[], asOf: string): { roots: CorpNode[]; unplaced: Company[]; notes: string[] } {
  const live = links.filter((l) => (!l.effective_from || l.effective_from <= asOf) && (!l.effective_to || l.effective_to >= asOf))
  const keyOf = (c: ID | null, p: ID | null) => (c ? 'c:' + c : 'p:' + p)
  const nameOf = (k: string) => (k.startsWith('c:') ? companies.find((c) => c.id === k.slice(2))?.name : parties.find((p) => p.id === k.slice(2))?.display_name) ?? 'Unknown'
  const childrenOf = new Map<string, CorporateLink[]>()
  const owned = new Set<string>()
  for (const l of live) {
    const pk = keyOf(l.parent_company_id, l.parent_party_id); const ck = keyOf(l.child_company_id, l.child_party_id)
    childrenOf.set(pk, [...(childrenOf.get(pk) ?? []), l]); owned.add(ck)
  }
  const notes: string[] = []
  const build = (k: string, link: CorporateLink | null, above: Decimal | null, path: string[]): CorpNode => {
    const direct = link?.ownership_pct === null || link?.ownership_pct === undefined ? null : D(link.ownership_pct)
    const eff = link === null ? D(100) : direct === null || above === null ? null : above.times(direct).div(100).toDecimalPlaces(4)
    const kids = path.includes(k) ? [] : (childrenOf.get(k) ?? []).map((l) => build(keyOf(l.child_company_id, l.child_party_id), l, eff, [...path, k]))
    return { key: k + ':' + path.join('>'), kind: k.startsWith('c:') ? 'company' : 'party', id: k.slice(2), name: nameOf(k), inNumero: k.startsWith('c:'), relation: link?.relation ?? null, directPct: direct, effectivePct: eff, children: kids }
  }
  const tops = [...childrenOf.keys()].filter((k) => !owned.has(k))
  const roots = tops.map((k) => build(k, null, D(100), []))
  const placed = new Set<string>()
  const walk = (n: CorpNode) => { placed.add(n.kind === 'company' ? 'c:' + n.id : 'p:' + n.id); n.children.forEach(walk) }
  roots.forEach(walk)
  const unplaced = companies.filter((c) => !placed.has('c:' + c.id))
  if (unplaced.length) notes.push(`${unplaced.length} compan${unplaced.length === 1 ? 'y has' : 'ies have'} no owner and no holding on record, and stand${unplaced.length === 1 ? 's' : ''} outside the tree.`)
  if (live.some((l) => l.ownership_pct === null)) notes.push('Some links carry no percentage. Holdings through them cannot be worked out and are left blank.')
  return { roots, unplaced, notes }
}
