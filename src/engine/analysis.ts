// Analysis over the books: year on year, burn rate, unusual entries, the books of an
// earlier system beside NUMERO's, and how a rule would have behaved.
// Pure calculation. Where the data is not enough to say something, it says that instead.

import Decimal from 'decimal.js'
import { D, ZERO } from '@/lib/money'
import { daysBetween, fiscalYearOf } from '@/lib/dates'
import type { Account, Alert, ApprovalRequest, ApprovalRule, ID, LedgerLine, LedgerMonthlyRow } from './types'
import type { RegisterItem } from './opsTypes'
import type { AttentionClass, AttentionRule, FactRow, LegacyBalance } from './p3Types'

// ------------------------------------------------------------------ year on year
export interface YearRow { key: string; label: string; byYear: Record<number, Decimal>; changes: Record<number, { amount: Decimal; pct: Decimal | null }> }
export interface YearOnYear { years: number[]; complete: Record<number, { months: number; complete: boolean }>; rows: YearRow[]; notes: string[] }
type Monthly = Pick<LedgerMonthlyRow, 'account_id' | 'month' | 'debit' | 'credit'> | Pick<FactRow, 'account_id' | 'month' | 'debit' | 'credit'>
/** Fiscal year against fiscal year, as many years as the books hold. A year that is not complete is marked, never scaled up. */
export function yearOnYear(rows: Monthly[], accounts: Account[], fyStartMonth: number, asOf: string): YearOnYear {
  const acc = new Map(accounts.map((a) => [a.id, a]))
  const sections: { key: string; label: string; test: (a: Account) => boolean; sign: 1 | -1 }[] = [
    { key: 'revenue', label: 'Revenue', test: (a) => a.type === 'income' && a.subtype === 'revenue', sign: -1 },
    { key: 'cogs', label: 'Cost of goods sold', test: (a) => a.type === 'expense' && a.subtype === 'cogs', sign: 1 },
    { key: 'employee', label: 'Employee costs', test: (a) => a.type === 'expense' && a.subtype === 'employee_cost', sign: 1 },
    { key: 'opex', label: 'Other operating expenses', test: (a) => a.type === 'expense' && !['cogs', 'employee_cost', 'depreciation', 'finance_cost', 'exceptional', 'tax_expense'].includes(a.subtype), sign: 1 },
    { key: 'other_income', label: 'Other income', test: (a) => a.type === 'income' && a.subtype !== 'revenue', sign: -1 },
    { key: 'depreciation', label: 'Depreciation', test: (a) => a.type === 'expense' && a.subtype === 'depreciation', sign: 1 },
    { key: 'finance', label: 'Finance costs', test: (a) => a.type === 'expense' && a.subtype === 'finance_cost', sign: 1 },
    { key: 'exceptional', label: 'Exceptional items', test: (a) => a.type === 'expense' && a.subtype === 'exceptional', sign: 1 },
    { key: 'tax', label: 'Tax expense', test: (a) => a.type === 'expense' && a.subtype === 'tax_expense', sign: 1 },
  ]
  const months = new Map<number, Set<string>>()
  const tot = new Map<string, Map<number, Decimal>>()
  for (const r of rows) {
    const a = acc.get(r.account_id)
    if (!a || (a.type !== 'income' && a.type !== 'expense')) continue
    const fy = fiscalYearOf(r.month, fyStartMonth)
    months.set(fy, (months.get(fy) ?? new Set()).add(r.month.slice(0, 7)))
    const s = sections.find((x) => x.test(a))
    if (!s) continue
    const v = D(r.debit).minus(r.credit).times(s.sign)
    const m = tot.get(s.key) ?? new Map<number, Decimal>()
    m.set(fy, (m.get(fy) ?? ZERO).plus(v)); tot.set(s.key, m)
  }
  const years = [...months.keys()].sort()
  const thisFy = fiscalYearOf(asOf, fyStartMonth)
  const complete = Object.fromEntries(years.map((y) => [y, { months: months.get(y)!.size, complete: y < thisFy && months.get(y)!.size === 12 }]))
  const of = (k: string, y: number) => tot.get(k)?.get(y) ?? ZERO
  const derived = (key: string, label: string, f: (y: number) => Decimal): YearRow => row(key, label, Object.fromEntries(years.map((y) => [y, f(y)])))
  function row(key: string, label: string, byYear: Record<number, Decimal>): YearRow {
    const changes: YearRow['changes'] = {}
    years.forEach((y, i) => {
      if (i === 0) return
      const prev = byYear[years[i - 1]] ?? ZERO; const cur = byYear[y] ?? ZERO
      changes[y] = { amount: cur.minus(prev), pct: prev.isZero() ? null : cur.minus(prev).times(100).div(prev.abs()).toDecimalPlaces(1) }
    })
    return { key, label, byYear, changes }
  }
  const gross = (y: number) => of('revenue', y).minus(of('cogs', y))
  const operating = (y: number) => gross(y).minus(of('employee', y)).minus(of('opex', y))
  const pbt = (y: number) => operating(y).plus(of('other_income', y)).minus(of('depreciation', y)).minus(of('finance', y)).minus(of('exceptional', y))
  const rowsOut: YearRow[] = [
    row('revenue', 'Revenue', Object.fromEntries(years.map((y) => [y, of('revenue', y)]))), row('cogs', 'Cost of goods sold', Object.fromEntries(years.map((y) => [y, of('cogs', y)]))),
    derived('gross_profit', 'Gross profit', gross), row('employee', 'Employee costs', Object.fromEntries(years.map((y) => [y, of('employee', y)]))),
    row('opex', 'Other operating expenses', Object.fromEntries(years.map((y) => [y, of('opex', y)]))), derived('operating_profit', 'Operating profit', operating),
    derived('pbt', 'Profit before tax', pbt), derived('pat', 'Profit after tax', (y) => pbt(y).minus(of('tax', y))),
  ]
  const notes: string[] = []
  if (years.length < 2) notes.push('The books hold one fiscal year only. There is nothing to compare it with yet.')
  for (const y of years) if (!complete[y].complete) notes.push(`FY${y} holds ${complete[y].months} month(s) of entries${y === thisFy ? ' so far' : ''}. It is compared as it stands, not scaled to a full year.`)
  return { years, complete, rows: rowsOut, notes }
}

// ------------------------------------------------------------------ burn rate
export interface BurnRate {
  consuming: boolean
  /** average fall in cash per month over the months measured; zero or negative when cash rose */
  monthlyBurn: Decimal
  months: { month: string; change: Decimal }[]
  cash: Decimal
  /** months the cash in hand would last at this rate */
  runway: Decimal | null
  says: string
  formula: string
}
/** For a company that consumes cash: how much a month, and for how long what it holds would last. */
export function burnRate(cashByMonth: { month: string; closing: Decimal.Value }[], window = 6): BurnRate {
  const pts = [...cashByMonth].sort((a, b) => a.month.localeCompare(b.month))
  const formula = 'Monthly burn = (cash at the start − cash at the end) ÷ months measured. Runway = cash in hand ÷ monthly burn.'
  if (pts.length < 3) return { consuming: false, monthlyBurn: ZERO, months: [], cash: D(pts[pts.length - 1]?.closing ?? 0), runway: null, formula, says: 'The books hold fewer than three months of cash balances. A burn rate from so little would be false precision.' }
  const use = pts.slice(-(window + 1))
  const months = use.slice(1).map((p, i) => ({ month: p.month, change: D(p.closing).minus(use[i].closing) }))
  const burn = D(use[0].closing).minus(use[use.length - 1].closing).div(months.length).toDecimalPlaces(2)
  const cash = D(use[use.length - 1].closing)
  const consuming = burn.gt(0)
  const runway = consuming && cash.gt(0) ? cash.div(burn).toDecimalPlaces(1) : null
  return {
    consuming, monthlyBurn: burn, months, cash, runway, formula,
    says: consuming ? `Cash fell by ${burn.toFixed(2)} a month on average over ${months.length} month(s).${runway ? ` At that rate what is in hand lasts ${runway} month(s).` : ' Nothing is left in hand.'}`
      : `Cash rose by ${burn.neg().toFixed(2)} a month on average over ${months.length} month(s). This company is not consuming cash.`,
  }
}

// ------------------------------------------------------------------ unusual entries
export interface Unusual { line: LedgerLine; account_id: ID; amount: number; median: number; spread: number; score: number; samples: number; why: string }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
/**
 * Entries that are far from what the same ledger usually carries.
 * Method: the distance of an entry from the median of its ledger, measured in units of the median distance
 * of all entries from that median (a robust z-score; one large entry cannot hide itself by moving the average).
 * It says what is unusual and why. It does not say that anything is wrong.
 */
export function unusualEntries(lines: LedgerLine[], accounts: Account[], opts: { minSamples?: number; threshold?: number; types?: Account['type'][] } = {}): Unusual[] {
  const min = opts.minSamples ?? 8; const th = opts.threshold ?? 3.5
  const types = opts.types ?? ['expense']
  const acc = new Map(accounts.map((a) => [a.id, a]))
  const by = new Map<ID, LedgerLine[]>()
  for (const l of lines) { const a = acc.get(l.account_id); if (a && types.includes(a.type)) by.set(l.account_id, [...(by.get(l.account_id) ?? []), l]) }
  const out: Unusual[] = []
  for (const [accountId, ls] of by) {
    if (ls.length < min) continue
    const amounts = ls.map((l) => Math.abs(D(l.debit).minus(l.credit).toNumber()))
    const med = median(amounts)
    const mad = median(amounts.map((a) => Math.abs(a - med)))
    if (mad === 0) continue        // every entry is the same amount: a different one would be seen, but there is no spread to measure by
    ls.forEach((l, i) => {
      const score = (0.6745 * (amounts[i] - med)) / mad
      if (score < th) return
      const name = acc.get(accountId)?.name ?? 'this ledger'
      out.push({ line: l, account_id: accountId, amount: amounts[i], median: med, spread: mad, score: Math.round(score * 10) / 10, samples: ls.length,
        why: `${name} usually carries about ${Math.round(med).toLocaleString('en-IN')} an entry (the median of ${ls.length}). This entry is ${Math.round(amounts[i]).toLocaleString('en-IN')}, ${Math.round(amounts[i] / Math.max(med, 1) * 10) / 10} times that. It is unusual for this ledger; whether it is in order is for a person to say.` })
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

// ------------------------------------------------------------------ parallel run
export interface ParallelRow { code: string; name: string; account: Account | null; legacy: Decimal; numero: Decimal; difference: Decimal; state: 'agrees' | 'differs' | 'not mapped' | 'only in NUMERO' }
/** The trial balance of the earlier system beside NUMERO's, ledger by ledger, as at one date. Debit positive. */
export function parallelRun(legacy: LegacyBalance[], numero: { account_id: ID; closing: Decimal.Value }[], accounts: Account[], tolerance: Decimal.Value = 1) {
  const acc = new Map(accounts.map((a) => [a.id, a]))
  const mine = new Map(numero.map((n) => [n.account_id, D(n.closing)]))
  const seen = new Set<ID>()
  const rows: ParallelRow[] = []
  const byAccount = new Map<string, { legacy: Decimal; codes: string[]; names: string[]; account_id: ID | null }>()
  for (const l of legacy) {
    const k = l.account_id ?? 'x:' + l.legacy_code
    const cur = byAccount.get(k) ?? { legacy: ZERO, codes: [], names: [], account_id: l.account_id }
    byAccount.set(k, { legacy: cur.legacy.plus(l.debit).minus(l.credit), codes: [...cur.codes, l.legacy_code], names: [...cur.names, l.legacy_name ?? ''], account_id: l.account_id })
  }
  for (const v of byAccount.values()) {
    const a = v.account_id ? acc.get(v.account_id) ?? null : null
    const n = a ? mine.get(a.id) ?? ZERO : ZERO
    if (a) seen.add(a.id)
    const diff = n.minus(v.legacy)
    rows.push({ code: v.codes.join(', '), name: a ? `${a.code} · ${a.name}` : v.names.filter(Boolean).join(', ') || v.codes.join(', '), account: a, legacy: v.legacy, numero: n, difference: diff, state: !a ? 'not mapped' : diff.abs().lte(tolerance) ? 'agrees' : 'differs' })
  }
  for (const [id, n] of mine) {
    const a = acc.get(id)
    if (seen.has(id) || n.isZero() || !a) continue
    rows.push({ code: '—', name: `${a.code} · ${a.name}`, account: a, legacy: ZERO, numero: n, difference: n, state: 'only in NUMERO' })
  }
  const count = (s: ParallelRow['state']) => rows.filter((r) => r.state === s).length
  return {
    rows: rows.sort((a, b) => b.difference.abs().cmp(a.difference.abs())),
    agrees: count('agrees'), differs: count('differs'), notMapped: count('not mapped'), onlyHere: count('only in NUMERO'),
    legacyTotal: legacy.reduce((s, l) => s.plus(l.debit).minus(l.credit), ZERO), totalDifference: rows.reduce((s, r) => s.plus(r.difference.abs()), ZERO),
    ready: rows.length > 0 && count('differs') === 0 && count('not mapped') === 0 && count('only in NUMERO') === 0,
  }
}

// ------------------------------------------------------------------ rule simulation
export interface RuleTrial { rule: Pick<ApprovalRule, 'name' | 'entity' | 'company_id' | 'min_amount' | 'max_amount' | 'steps'>; examined: number; caught: number; amount: Decimal; /** the same amount, company by company: companies keep their books in their own currency */ amounts: { company_id: ID; amount: Decimal }[]; stepsAdded: number; examples: ApprovalRequest[]; says: string }
/** How an approval rule would have behaved against the requests already on record. Nothing is changed by trying it. */
export function tryApprovalRule(rule: RuleTrial['rule'], history: ApprovalRequest[]): RuleTrial {
  const same = history.filter((r) => r.entity === rule.entity && (!rule.company_id || r.company_id === rule.company_id))
  const hit = same.filter((r) => D(r.amount).gte(rule.min_amount) && (rule.max_amount === null || rule.max_amount === undefined || D(r.amount).lt(rule.max_amount)))
  const added = hit.reduce((s, r) => s + Math.max(0, rule.steps.length - r.steps.length), 0)
  const by = new Map<ID, Decimal>()
  for (const r of hit) by.set(r.company_id, (by.get(r.company_id) ?? ZERO).plus(r.amount))
  return {
    rule, examined: same.length, caught: hit.length, amount: hit.reduce((s, r) => s.plus(r.amount), ZERO), amounts: [...by].map(([company_id, amount]) => ({ company_id, amount })), stepsAdded: added, examples: [...hit].sort((a, b) => D(b.amount).cmp(a.amount)).slice(0, 10),
    says: !same.length ? `No ${rule.entity.replace(/_/g, ' ')} has asked for approval yet, so there is nothing to try this rule against.`
      : `Of ${same.length} request(s) on record, this rule would have applied to ${hit.length}. It asks for ${rule.steps.length} approval(s); that is ${added} more approval(s) than those requests went through.`,
  }
}
export interface ThresholdTrial { threshold: number; examined: number; flagged: number; alreadyClosedAsFalse: number; says: string }
/** How a change of threshold would have changed what Sentinel raised: the alerts on record are counted above and below it. */
export function tryThreshold(alerts: Alert[], kind: string, threshold: number, amountOf: (a: Alert) => number | null): ThresholdTrial {
  const same = alerts.filter((a) => a.kind === kind)
  const withAmount = same.filter((a) => amountOf(a) !== null)
  const flagged = withAmount.filter((a) => Math.abs(amountOf(a)!) >= threshold)
  const falsePos = withAmount.filter((a) => a.status === 'false_positive')
  const spared = falsePos.filter((a) => Math.abs(amountOf(a)!) < threshold).length
  return {
    threshold, examined: withAmount.length, flagged: flagged.length, alreadyClosedAsFalse: falsePos.length,
    says: !withAmount.length ? 'No alert of this kind carries an amount, so a threshold has nothing to act on.'
      : `Of ${withAmount.length} alert(s) on record, ${flagged.length} would still have been raised at this threshold. ${falsePos.length} of them were closed as not a concern; this threshold would have spared ${spared} of those.`,
  }
}

// ------------------------------------------------------------------ who attends to what
export const ATTENTION: { key: AttentionClass; label: string; meaning: string; rank: number }[] = [
  { key: 'information', label: 'Information', meaning: 'For the record. Nobody needs to act.', rank: 0 },
  { key: 'finance_action', label: 'Finance action', meaning: 'The finance team acts.', rank: 1 },
  { key: 'management_action', label: 'Management action', meaning: 'A head of department or of the company decides.', rank: 2 },
  { key: 'owner_action', label: 'Owner action', meaning: 'Only the owner can decide this.', rank: 3 },
  { key: 'critical', label: 'Critical', meaning: 'Act now.', rank: 4 },
]
const DEFAULT_CLASS: Record<Alert['attention'], AttentionClass> = { info: 'information', review: 'finance_action', priority: 'management_action', critical: 'critical' }
/** The class of an alert: the rule of the group for its kind and amount, or else the class its seriousness implies. */
export function attentionOf(a: Pick<Alert, 'kind' | 'attention' | 'evidence'>, rules: AttentionRule[]): AttentionClass {
  const amount = Math.abs(Number((a.evidence as { amount?: number | string; difference?: number | string })?.amount ?? (a.evidence as { difference?: number | string })?.difference ?? 0)) || 0
  const r = rules.filter((x) => (x.kind === a.kind || x.kind === '*') && amount >= Number(x.min_amount)).sort((x, y) => Number(y.kind === a.kind) - Number(x.kind === a.kind) || Number(y.min_amount) - Number(x.min_amount))[0]
  return r?.class ?? DEFAULT_CLASS[a.attention]
}
/** What the owner is shown first: only what needs the owner, or is critical. Routine bookkeeping stays with the finance team. */
export function forOwner<T extends { class: AttentionClass }>(items: T[]) {
  return { owner: items.filter((i) => i.class === 'owner_action' || i.class === 'critical'), others: items.filter((i) => i.class !== 'owner_action' && i.class !== 'critical') }
}

// ------------------------------------------------------------------ deadlines across companies
export interface Deadline { item: RegisterItem; due: string; days: number; state: 'overdue' | 'this week' | 'this month' | 'later' }
export function complianceView(items: RegisterItem[], asOf: string, kinds: string[] = ['compliance']): { rows: Deadline[]; byCompany: { company_id: ID; overdue: number; week: number; month: number; later: number }[] } {
  const rows = items.filter((i) => kinds.includes(i.kind) && i.status === 'active' && i.next_due && !['paid', 'closed', 'resolved', 'cancelled'].includes(i.state)).map((i) => {
    const days = daysBetween(asOf, i.next_due!)
    return { item: i, due: i.next_due!, days, state: days < 0 ? 'overdue' : days <= 7 ? 'this week' : days <= 31 ? 'this month' : 'later' } as Deadline
  }).sort((a, b) => a.due.localeCompare(b.due))
  const m = new Map<ID, { company_id: ID; overdue: number; week: number; month: number; later: number }>()
  for (const r of rows) {
    const c = m.get(r.item.company_id) ?? { company_id: r.item.company_id, overdue: 0, week: 0, month: 0, later: 0 }
    c[r.state === 'overdue' ? 'overdue' : r.state === 'this week' ? 'week' : r.state === 'this month' ? 'month' : 'later']++
    m.set(r.item.company_id, c)
  }
  return { rows, byCompany: [...m.values()] }
}
