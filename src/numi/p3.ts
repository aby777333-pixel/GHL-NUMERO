import type { ID } from '@/engine/types'
import type { Shock } from '@/engine/p3Types'
import { exposureTotals, lossExposure, reorderList, stockAgainstBooks, unitCost } from '@/engine/stock'
import { carryingAmount, fundSummary, valuedWhenHeld } from '@/engine/invest'
import { DIMENSIONS } from '@/engine/reality'
import { simulate } from '@/engine/twin'
import { ATTENTION, burnRate, yearOnYear } from '@/engine/analysis'
import { loadReality } from '@/lib/realityData'
import { loadTwin } from '@/lib/twinData'
import { monthlySeries } from '@/lib/data'
import { D, sum, ZERO } from '@/lib/money'
import { addMonths, fmtDate, startOfMonth, today } from '@/lib/dates'
import type { NumiAnswer, NumiContext, NumiFact } from './engine'

// =====================================================================
// NUMI — stock, investments, reality, simulations and the platform.
//
//  * The rules of NUMI hold: it reads through the person's own data
//    layer, checks the permission before it reads (an empty list proves
//    nothing), answers only from records, and never acts.
//  * What is at stake in stock is EXPOSURE, not loss.
//  * A difference between realities is stated as a fact. What it means
//    is for a person to decide.
//  * A "what if" is a SIMULATION. It is worked out beside the books,
//    says what it assumed, and changes nothing.
// =====================================================================

type Ans = Omit<NumiAnswer, 'intent' | 'scope'>
const blank = { facts: [] as NumiFact[], evidence: [] as { label: string; to: string }[], assumptions: [] as string[], followUps: [] as string[], basis: 'FACT' as const, truth: 'ACTUAL' as const }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const refused = (what: string, perm: string): Ans => ({
  ...blank,
  headline: `You are not authorised to see ${what}.`,
  narrative: `That information needs the ${perm} permission in the selected companies. I answer only from what your account may read, and I cannot say whether such records exist.`,
  followUps: ['How much cash do we have across the group?', 'What requires approval?'],
  speak: `You are not authorised to see ${what}.`,
})

/** Reads the assumptions out of a "what if" question. What it cannot read, it does not guess. */
export function shocksFrom(text: string, customers: { id: ID; name: string }[]): Shock[] {
  const t = text.toLowerCase()
  const out: Shock[] = []
  const down = /\b(fall|falls|fell|drop|drops|dropped|decline|declines|down|lose|loses|lost|less|lower|decrease|decreases|shrink|shrinks|cut)\b/
  const later = /\b(late|later|longer|delay\w*|slow\w*|more)\b/
  const sooner = /\b(soon|sooner|early|earlier|fast|faster|quick|quicker|quickly|less|fewer)\b/
  /**
   * A question is read clause by clause: a subject and its figure must stand in the same clause, and which way the
   * figure points is read in that clause and nowhere else. "Revenue drops and expenses rise 15%" says nothing of how
   * much revenue drops; "sales fall" says nothing about interest rates.
   */
  const clauses = t.split(/,(?!\d)|;|\.(?!\d)|\band\b|\bwhile\b|\bplus\b|\bbut\b/).map((c) => c.trim()).filter(Boolean)
  const part = (re: RegExp, skip?: RegExp) => {
    for (const c of clauses) {
      if (skip && skip.test(c)) continue
      const m = re.exec(c)
      if (m) return { value: Number(m[m.length - 1].replace(/,/g, '')), words: c }
    }
    return null
  }
  const pct = (re: RegExp, skip?: RegExp) => { const p = part(re, skip); return p ? (down.test(p.words) ? -p.value : p.value) : null }
  /** days: later is more, sooner is less; a number of days that says neither is not read */
  const days = (re: RegExp) => { const p = part(re); return !p ? null : sooner.test(p.words) && !later.test(p.words) ? -p.value : later.test(p.words) ? p.value : null }

  const rev = pct(/\b(?:revenue|sales|turnover)\b[^.%]*?(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/)
  if (rev !== null) out.push({ kind: 'revenue_pct', value: rev, from_month: 1, label: `Revenue ${rev < 0 ? 'falls' : 'rises'} by ${Math.abs(rev)}%` })
  const pay = pct(/\b(?:salar(?:y|ies)|payroll|wages)\b[^.%]*?(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/)
  if (pay !== null) out.push({ kind: 'payroll_pct', value: pay, from_month: 1, label: `Payroll ${pay < 0 ? 'falls' : 'rises'} by ${Math.abs(pay)}%` })
  const exp = pct(/\b(?:expenses?|costs?|overheads?)\b[^.%]*?(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/)
  if (exp !== null && pay === null) out.push({ kind: 'expense_pct', value: exp, from_month: 1, label: `Operating expenses ${exp < 0 ? 'fall' : 'rise'} by ${Math.abs(exp)}%` })
  const who = '(?:customers?|clients?|debtors?|collections?|receivables?)'
  const late = days(new RegExp(`\\b${who}\\b[^.,;]*?(\\d+)\\s*days?`)) ?? days(new RegExp(`(\\d+)\\s*days?\\s*(?:late|later|longer|delay|sooner|earlier)\\b[^.,;]*\\b${who}`))
  if (late !== null) {
    const top = /\b(top|largest|biggest)\s*(3|three)\b/.test(t)
    out.push({ kind: 'collection_delay_days', value: late, from_month: 1, target: top ? 'top3' : undefined, label: `${top ? 'The three largest customers' : 'Customers'} pay ${Math.abs(late)} days ${late < 0 ? 'sooner' : 'later'}` })
  }
  const wait = days(/\b(?:suppliers?|vendors?|creditors?|payables?)\b[^.,;]*?(\d+)\s*days?/)
  if (wait !== null) out.push({ kind: 'payment_delay_days', value: wait, from_month: 1, label: `Suppliers are paid ${Math.abs(wait)} days ${wait < 0 ? 'sooner' : 'later'}` })
  // a rate of exchange, of tax or of growth is not the rate of interest: it is not read here
  const rate = pct(/\b(?:interest|rates?)\b[^.,;]*?(\d+(?:\.\d+)?)\s*(?:points?|%|percent|per cent)/, /\b(exchange|tax|gst|tds|fx|currency|conversion|growth|tax)\s+rates?\b(?![^]*\binterest\b)/)
  if (rate !== null) out.push({ kind: 'interest_rate_pts', value: rate, from_month: 1, label: `Interest rates ${rate < 0 ? 'fall' : 'rise'} by ${Math.abs(rate)} points` })
  const hires = t.match(/\bhire\s+(\d+)\b[^.]*?(?:at|for|costing)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/)
  if (hires) out.push({ kind: 'new_hires', value: Number(hires[1]), extra: Number(hires[2].replace(/,/g, '')), from_month: 1, label: `${hires[1]} people are hired` })
  const lost = customers.filter((c) => c.name.length > 3 && t.includes(c.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0]
  if (lost && /\b(lose|lost|loses|stops?|leaves?|without|goes away|walks away)\b/.test(t)) out.push({ kind: 'lose_customer', value: 100, from_month: 1, target: lost.name, target_id: lost.id, label: `${lost.name} is lost` })
  return out
}
/** The parts of a question, split at "and" and at commas, in which no assumption could be read. */
export function unread(text: string, customers: { id: ID; name: string }[]): string[] {
  return text.replace(/^\s*(what if|what happens if|simulate|stress test)\b[\s:,]*/i, '').replace(/\?+\s*$/, '').split(/\s*(?:,|;|\band\b|\bwhile\b|\bplus\b)\s*/i)
    .map((p) => p.trim()).filter((p) => p.length > 3 && !shocksFrom(p, customers).length)
}

export async function askP3(question: string, c: NumiContext, scope: { ids: ID[]; label: string }): Promise<(Ans & { intent: string; scope: string }) | null> {
  const t = question.toLowerCase()
  const M = c.money
  const all = scope.ids
  const asOf = today()
  const idsFor = (perm: string) => (c.can ? all.filter((id) => c.can!(perm, id)) : all)
  const leftOut = (ids: ID[], perm: string) => (ids.length < all.length ? [`${all.length - ids.length} of the ${all.length} selected companies are not included: your role there does not include ${perm}.`] : [])
  const party = (id: ID | null | undefined) => (id ? c.parties.find((p) => p.id === id)?.display_name ?? 'a party not shared with you' : '—')
  const company = (id: ID) => c.companies.find((x) => x.id === id)?.name ?? ''
  const out = (intent: string, a: Ans, period?: string) => ({ ...a, intent, scope: period ? `${scope.label} · ${period}` : `${scope.label} · as at ${fmtDate(asOf)}` })

  // ---------------------------------------------------------------- what if: a simulation, never an actual
  if (/^what if\b|\bwhat happens if\b|\bsimulat\w+|\bstress test\b/.test(t)) {
    const ids = idsFor('scenario.view')
    if (!ids.length) return out('what_if', refused('simulations', 'scenario.view'))
    const twin = await loadTwin(c.api, c.companies, c.accounts, ids, { can: c.can })
    const shocks = shocksFrom(question, twin.base.customers)
    const left = shocks.length ? unread(question, twin.base.customers) : []
    if (!shocks.length) {
      return out('what_if', {
        ...blank, basis: 'SUGGESTION', truth: 'SIMULATION',
        headline: 'I could not read an assumption in that question.',
        narrative: 'I can try a change in revenue, payroll or expenses by a percentage, customers paying later by a number of days, interest rates moving by points, people being hired at a monthly cost, or a named customer being lost. Anything else is built in the Digital Twin, where every assumption is set out.',
        evidence: [{ label: 'Open the Digital Twin', to: '/twin' }],
        followUps: ['What if revenue falls by 20%?', 'What if customers pay 30 days later?', 'What if interest rates rise by 2 points?'],
        speak: 'I could not read an assumption in that question.',
      })
    }
    const base = simulate(twin.base, [], 12, 'Books continue as they are', twin.drivers)
    const r = simulate(twin.base, shocks, 12, 'What if', twin.drivers)
    const gap = r.totals.closingCash - base.totals.closingCash
    return out('what_if', {
      ...blank, basis: 'INFERENCE', truth: 'SIMULATION',
      headline: `SIMULATION: after 12 months cash would be about ${M(r.totals.closingCash)}, ${M(Math.abs(gap))} ${gap < 0 ? 'less' : 'more'} than if the books continued as they are.`,
      narrative: `${left.length ? `I could not read an assumption in: "${left.join('", "')}". It is not in this result. ` : ''}${r.totals.lowestCash < 0 ? `Cash would fall below zero in month ${r.totals.lowestCashMonth}; about ${M(r.totals.borrowingRequirement)} would have to be found. ` : ''}This is arithmetic on the monthly rates of the last ${twin.base.basisMonths} month(s). It is not a forecast and it is not in the books.`,
      facts: [
        { label: 'Cash today — ACTUAL', amount: twin.base.cash, to: '/banking' },
        { label: 'Cash after 12 months if the books continue as they are — SIMULATION', amount: Math.round(base.totals.closingCash), to: '/twin' },
        { label: 'Cash after 12 months with these assumptions — SIMULATION', amount: Math.round(r.totals.closingCash), tone: r.totals.closingCash < base.totals.closingCash ? 'neg' : 'pos', to: '/twin' },
        { label: 'Lowest cash on the way — SIMULATION', amount: Math.round(r.totals.lowestCash), note: `in month ${r.totals.lowestCashMonth}`, tone: r.totals.lowestCash < 0 ? 'neg' : undefined, to: '/twin' },
        { label: 'Profit over the 12 months — SIMULATION', amount: Math.round(r.totals.profit), note: `against ${M(Math.round(base.totals.profit))} if nothing changes`, to: '/twin' },
        ...r.effects.map((e) => ({ label: e.label, text: e.text, note: e.formula })),
      ],
      assumptions: [...r.assumptions, ...r.notes, ...(twin.missing.length ? [`Not read, because your account may not read them in every selected company: ${twin.missing.join(', ')}.`] : []), ...leftOut(ids, 'scenario.view')],
      evidence: [{ label: 'Build it in the Digital Twin', to: '/twin' }],
      followUps: ['How much cash will we have in 30 days?', 'What is our burn rate?'],
      speak: `This is a simulation. After twelve months cash would be about ${M(r.totals.closingCash)}.`,
    }, 'the next 12 months')
  }

  // ---------------------------------------------------------------- stock
  const aboutStock = /\b(stock|inventory|warehouse|godown)\b|\bin stock\b|\bon hand\b|\bre-?order\w*|\blots?\b.*\bexpir/.test(t) && !/\bstock (market|exchange)\b|\bshares?\b/.test(t)
  if (aboutStock) {
    const ids = idsFor('inventory.view')
    if (!ids.length) return out('stock', refused('stock', 'inventory.view'))
    let items, rows, lots, holds, cats, docs
    try { [items, rows, lots, holds, cats, docs] = await Promise.all([c.api.listInvItems(ids), c.api.stockOnHand(ids), c.api.listInvLots({ companyIds: ids }), c.api.listInvHolds(ids), c.api.listInvCategories(ids), c.api.listStockDocs({ companyIds: ids })]) } catch { return out('stock', refused('stock', 'inventory.view')) }
    const gaps = leftOut(ids, 'inventory.view')

    if (/\bre-?order\w*|\brunning (low|out)\b|\blow (on )?stock\b|\bneed to (order|buy)\b|\bshort of\b/.test(t)) {
      const list = reorderList(items, rows)
      return out('reorder', {
        ...blank, basis: 'SUGGESTION',
        headline: list.length ? `${plural(list.length, 'item is', 'items are')} at or below the level at which more is ordered.` : 'No item is at or below its reorder level.',
        narrative: 'This is a suggestion from the levels recorded on the items. A person decides what to order and places the order.',
        facts: list.slice(0, 10).map((r) => ({ label: `${r.item.sku} · ${r.item.name}`, text: `${r.free} ${r.item.unit} free, level ${r.level}`, note: `${company(r.item.company_id)} · suggested order ${r.suggested} ${r.item.unit}${r.pendingIn.gt(0) ? ` · ${r.pendingIn} arriving, awaiting approval` : ''}`, tone: 'warn' as const, to: '/inventory/items/' + r.item.id })),
        assumptions: ['Free = in stock − awaiting approval on documents going out.', 'Items without a reorder level are not considered.', ...gaps],
        evidence: [{ label: 'Reorder list', to: '/inventory?tab=reorder' }], followUps: ['What is the value of our stock?', 'How much stock is at risk?'],
        speak: list.length ? `${list.length} items are at or below their reorder level.` : 'No item is at or below its reorder level.',
      })
    }

    if (/\bexpir\w*|\bdamaged?\b|\bobsolete\b|\bslow[- ]?moving\b|\bat risk\b|\bexposure\b|\bwrite[- ]?off\b|\bloss(es)?\b|\bquarantine\b/.test(t)) {
      const ex = lossExposure(items, rows, lots, holds, asOf)
      const tot = exposureTotals(ex)
      const total = sum(tot.map((x) => x.value))
      return out('stock_exposure', {
        ...blank, basis: 'INFERENCE', truth: 'AI ESTIMATE',
        headline: ex.length ? `EXPOSURE: stock carried at about ${M(total)} is expired, close to expiry, damaged, held or not moving.` : 'No stock is recorded as expired, close to expiry, damaged, held or not moving.',
        narrative: 'This is what is at stake, not what has been lost. The stock is still in the books at its cost. A loss exists only when an adjustment is approved and posted.',
        facts: [
          ...tot.map((x) => ({ label: `${x.label} — EXPOSURE`, amount: x.value, note: plural(x.lines, 'line'), tone: 'warn' as const, to: '/inventory?tab=exposure' })),
          ...ex.slice(0, 6).map((r) => ({ label: `${r.item.sku} · ${r.item.name}${r.lot ? ' · ' + r.lot.lot_no : ''}`, amount: r.value, note: r.says, to: '/inventory/items/' + r.item.id })),
        ],
        assumptions: ['Exposure = quantity × the cost at which the item is carried. It is an estimate.', 'One quantity is counted under one heading only, the most serious.', ...gaps],
        evidence: [{ label: 'Exposure to loss', to: '/inventory?tab=exposure' }], followUps: ['Which items need to be reordered?', 'What is the value of our stock?'],
        speak: ex.length ? `Stock carried at about ${M(total)} is exposed. It is not a loss.` : 'No stock is recorded as exposed.',
      })
    }

    const named = items.filter((i) => i.name.length > 3 && (t.includes(i.name.toLowerCase()) || t.includes(i.sku.toLowerCase()))).sort((a, b) => b.name.length - a.name.length)[0]
    if (named) {
      const here = rows.filter((r) => r.item_id === named.id && !D(r.qty).isZero())
      return out('stock_item', {
        ...blank,
        headline: `${D(named.qty_on_hand)} ${named.unit} of ${named.name} are in stock, carried at ${M(named.value_on_hand, false)}.`,
        narrative: D(named.qty_reserved).gt(0) ? `${D(named.qty_reserved)} of them are on documents awaiting approval and are not free.` : undefined,
        facts: [
          { label: 'Cost of one', amount: unitCost(named), note: named.valuation_method === 'fifo' ? 'Average of what is in stock; each unit leaves at the cost it came in at (first in, first out)' : 'Weighted average = value ÷ quantity' },
          ...here.slice(0, 8).map((r) => ({ label: `In ${r.warehouse_id === here[0].warehouse_id ? 'this place' : 'another place'}`, text: `${D(r.qty)} ${named.unit}`, note: lots.find((l) => l.id === r.lot_id)?.lot_no, to: '/inventory/items/' + named.id })),
        ],
        assumptions: gaps, evidence: [{ label: 'Open the item', to: '/inventory/items/' + named.id }], followUps: ['Which items need to be reordered?'],
        speak: `${D(named.qty_on_hand)} ${named.unit} of ${named.name} are in stock.`,
      })
    }

    const value = sum(items.map((i) => i.value_on_hand))
    const stocked = items.filter((i) => D(i.qty_on_hand).gt(0))
    const waiting = docs.filter((d) => d.status === 'proposed')
    const mayBooks = !c.can || ids.every((id) => c.can!('report.view', id))
    const books = mayBooks ? stockAgainstBooks(items, cats, await c.api.ledgerBalances(ids, '1990-01-01', asOf), c.accounts) : []
    const differ = books.filter((b) => !b.agrees)
    return out('stock', {
      ...blank,
      headline: `${plural(stocked.length, 'item is', 'items are')} in stock, carried at ${M(value, false)}.`,
      narrative: !mayBooks ? 'Your role does not include the ledger in every company, so I have not compared the stock ledger with the books.' : differ.length ? `The stock ledger and the books differ on ${plural(differ.length, 'ledger')}. The difference is shown, not hidden.` : books.length ? 'The stock ledger agrees with the books.' : undefined,
      facts: [
        ...[...stocked].sort((a, b) => D(b.value_on_hand).cmp(a.value_on_hand)).slice(0, 6).map((i) => ({ label: `${i.sku} · ${i.name}`, amount: i.value_on_hand, note: `${D(i.qty_on_hand)} ${i.unit} · ${company(i.company_id)}`, to: '/inventory/items/' + i.id })),
        ...differ.map((b) => ({ label: `Stock ledger and books differ: ${b.account?.name ?? 'stock'}`, amount: b.difference, note: `stock ledger ${M(b.stock, false)}, books ${M(b.books, false)}`, tone: 'neg' as const, to: '/reality?tab=differences' })),
        ...(waiting.length ? [{ label: 'Stock documents awaiting approval', text: String(waiting.length), to: '/approvals' }] : []),
      ],
      assumptions: ['Value is what the stock ledger carries: the cost of what came in, less the cost of what left.', ...gaps],
      evidence: [{ label: 'Inventory', to: '/inventory' }], followUps: ['How much stock is at risk?', 'Which items need to be reordered?'],
      speak: `${stocked.length} items are in stock, carried at ${M(value)}.`,
    })
  }

  // ---------------------------------------------------------------- funds: commitments, calls, net asset value
  if (/\bfunds?\b|\bnav\b|\bnet asset value\b|\bcapital calls?\b|\binvestors?\b|\bdrawdowns?\b|\bunit ?holders?\b/.test(t) && !/\bfund(s)? transfers?\b|\btransfer\b|\bfunds? (available|in hand|position)\b|\bprovident\b/.test(t)) {
    const ids = idsFor('investment.view')
    if (!ids.length) return out('funds', refused('funds', 'investment.view'))
    let funds, commitments, calls
    try { [funds, commitments, calls] = await Promise.all([c.api.listFunds(ids), c.api.listCommitments({ companyIds: ids }), c.api.listCapitalCalls({ companyIds: ids })]) } catch { return out('funds', refused('funds', 'investment.view')) }
    if (!funds.length) return out('funds', { ...blank, headline: 'No fund is shared with you in the selected companies.', narrative: 'Funds are confidential by default. One that is classified above your clearance is not shown to you, and I cannot say whether it exists.', evidence: [{ label: 'Investments and funds', to: '/investments?tab=funds' }], speak: 'No fund is shared with you.' })
    const facts: NumiFact[] = []
    for (const f of funds.slice(0, 4)) {
      const s = fundSummary(f, commitments.filter((k) => k.fund_id === f.id), await c.api.listNavRuns(f.id))
      const due = calls.filter((k) => k.fund_id === f.id && k.status === 'approved').flatMap((k) => k.lines ?? []).filter((l) => l.status !== 'received')
      facts.push(
        { label: `${f.name} — committed`, amount: s.committed, note: `called ${M(s.called, false)} · contributed ${M(s.contributed, false)} · distributed ${M(s.distributed, false)}`, to: '/investments/funds/' + f.id },
        ...(s.nav?.nav_per_unit ? [{ label: `${f.name} — net asset value of a unit`, text: D(s.nav.nav_per_unit).toFixed(4), note: `approved as at ${fmtDate(s.nav.nav_date)} · an accounting figure from the books, not a regulatory valuation`, to: '/investments/funds/' + f.id + '?tab=nav' }] : [{ label: `${f.name} — net asset value`, text: 'none approved', to: '/investments/funds/' + f.id + '?tab=nav' }]),
        ...(due.length ? [{ label: `${f.name} — called and not yet received`, amount: sum(due.map((l) => D(l.amount).minus(l.received_amount))), note: due.slice(0, 4).map((l) => party(l.investor_party_id)).join(', '), tone: 'warn' as const, to: '/investments/funds/' + f.id + '?tab=calls' }] : []),
      )
    }
    const committed = sum(commitments.map((k) => k.committed_amount)), contributed = sum(commitments.map((k) => k.contributed_amount))
    return out('funds', {
      ...blank,
      headline: `${plural(funds.length, 'fund')}: ${M(committed, false)} committed by investors, ${M(contributed, false)} contributed.`,
      narrative: 'A commitment is a promise by an investor. A call makes part of it owed. Only money received is capital in the books.',
      facts,
      assumptions: ['Funds classified above your clearance are not shown to you and are not in these figures.', ...leftOut(ids, 'investment.view')],
      evidence: [{ label: 'Investments and funds', to: '/investments?tab=funds' }], followUps: ['What are our investments worth?'],
      speak: `${M(committed)} is committed by investors and ${M(contributed)} has been contributed.`,
    })
  }

  // ---------------------------------------------------------------- investments
  if (/\binvestments?\b|\bholdings?\b|\bportfolio\b|\bfair value\b|\bsubsidiar(y|ies)\b.*\bown\b|\bwho owns\b/.test(t)) {
    const ids = idsFor('investment.view')
    if (!ids.length) return out('investments', refused('investments', 'investment.view'))
    let hs
    try { hs = (await c.api.listHoldings(ids)).filter((h) => h.status === 'active') } catch { return out('investments', refused('investments', 'investment.view')) }
    const carried = sum(hs.map((h) => carryingAmount(h))), cost = sum(hs.map((h) => h.cost))
    // a valuation made when a different quantity was held no longer describes what is held
    const outdated = valuedWhenHeld(hs, await c.api.listHoldingTxns({ companyIds: ids }).catch(() => []))
    const valued = hs.filter((h) => h.fair_value !== null && !outdated.has(h.id))
    return out('investments', {
      ...blank,
      headline: hs.length ? `${plural(hs.length, 'investment')} carried in the books at ${M(carried, false)}, against a cost of ${M(cost, false)}.` : 'No investment is shared with you in the selected companies.',
      narrative: hs.length ? 'An investment is carried at cost, or at fair value where that was chosen. A valuation of an investment carried at cost is kept beside the books and changes nothing in them.' : undefined,
      facts: [
        ...[...hs].sort((a, b) => carryingAmount(b).cmp(carryingAmount(a))).slice(0, 8).map((h) => ({ label: `${h.holding_no} · ${h.name}`, amount: carryingAmount(h), to: '/investments/holdings/' + h.id,
          note: `${company(h.company_id)} · carried at ${h.measurement === 'cost' ? 'cost' : 'fair value'}${h.fair_value === null ? ' · never valued' : outdated.has(h.id) ? ` · valued at ${M(h.fair_value, false)} on ${fmtDate(h.fair_value_date)}, when ${outdated.get(h.id)} were held; ${D(h.quantity)} are held now` : ` · last valued at ${M(h.fair_value, false)} on ${fmtDate(h.fair_value_date)}`}` })),
        ...(hs.length ? [{ label: 'Income received from investments', amount: sum(hs.map((h) => h.income_received)) }, { label: 'Gain or loss realised on sales', amount: sum(hs.map((h) => h.realised_gain)) }] : []),
      ],
      assumptions: [`${valued.length} of ${hs.length} investments carry a valuation that describes what is held today.`, 'Investments classified above your clearance are not shown to you and are not in these figures.', ...leftOut(ids, 'investment.view')],
      evidence: [{ label: 'Investments', to: '/investments' }, { label: 'Who owns what', to: '/investments?tab=structure' }], followUps: ['How are our funds doing?'],
      speak: hs.length ? `${hs.length} investments are carried at ${M(carried)}.` : 'No investment is shared with you.',
    })
  }

  // ---------------------------------------------------------------- reality: do the records agree with each other
  if (/\brealit(y|ies)\b|\b(do|does) (the )?(books|records|stock|bank|cash).*\b(agree|match|tally)\b|\bmismatch\w*|\bdiscrepanc\w+|\bphysical(ly)? verif\w+|\bconfirmations?\b|\bopen cases?\b|\bcases?\b.*\b(open|investigat)/.test(t)) {
    const ids = idsFor('reality.view')
    if (!ids.length) return out('reality', refused('the comparison of realities', 'reality.view'))
    if (/\bconfirmations?\b/.test(t)) {
      const cs = await c.api.listConfirmations(ids)
      const open = cs.filter((k) => ['difference', 'disputed', 'no_reply', 'sent', 'drafted'].includes(k.status))
      return out('confirmations', {
        ...blank,
        headline: `${plural(cs.length, 'confirmation')} on record; ${cs.filter((k) => k.status === 'difference' || k.status === 'disputed').length} show a difference that is not explained.`,
        narrative: 'A confirmation is what the other side says the balance is. NUMERO prepares the request; a person sends it and records the reply.',
        facts: open.slice(0, 10).map((k) => ({ label: `${k.confirm_no} · ${k.label}`, amount: k.difference ?? undefined, text: k.difference === null ? k.status.replace(/_/g, ' ') : undefined, note: `${k.subject} · as at ${fmtDate(k.as_of)} · books ${M(k.book_balance, false)}${k.confirmed_balance !== null ? ` · confirmed ${M(k.confirmed_balance, false)}` : ''} · ${k.status.replace(/_/g, ' ')}`, tone: k.status === 'difference' || k.status === 'disputed' ? 'warn' as const : undefined, to: '/reality?tab=confirmations' })),
        assumptions: leftOut(ids, 'reality.view'), evidence: [{ label: 'Confirmations', to: '/reality?tab=confirmations' }], followUps: ['Do the records agree with each other?'],
        speak: `${cs.length} confirmations are on record.`,
      })
    }
    if (/\bcases?\b/.test(t)) {
      const cases = await c.api.listCases({ companyIds: ids, openOnly: true })
      return out('cases', {
        ...blank,
        headline: cases.length ? `${plural(cases.length, 'case is', 'cases are')} open.` : 'No case is open.',
        narrative: 'A case is a difference being looked into by a person. Its status says how far the work has come, not what anyone did.',
        facts: cases.slice(0, 10).map((k) => ({ label: `${k.case_no} · ${k.title}`, amount: k.amount ?? undefined, note: `${company(k.company_id)} · ${k.status.replace(/_/g, ' ')} · ${ATTENTION.find((a) => a.key === k.attention)?.label ?? k.attention}${k.owner_name ? ' · with ' + k.owner_name : ''}`, to: '/reality/cases/' + k.id })),
        assumptions: ['Cases classified above your clearance are not shown to you.', ...leftOut(ids, 'reality.view')], evidence: [{ label: 'Cases', to: '/reality?tab=cases' }], followUps: ['Do the records agree with each other?'],
        speak: cases.length ? `${cases.length} cases are open.` : 'No case is open.',
      })
    }
    const r = await loadReality(c.api, c.accounts, ids, c.can)
    const material = r.findings.filter((f) => f.material)
    return out('reality', {
      ...blank, basis: 'FACT',
      headline: r.findings.length ? `${plural(r.findings.length, 'difference')} between what the records say; ${material.length} above the threshold of materiality.` : 'The records that were compared agree with each other.',
      narrative: 'Five realities are compared: what the documents say, what was done, what was posted, what the bank and the cash box show, and what physically exists. They are counted separately. A difference is a fact; what it means is for a person to establish.',
      facts: [
        ...r.health.map((h) => ({ label: `${DIMENSIONS.find((d) => d.key === h.dimension)?.label ?? h.dimension} reality`, text: `${h.agree} of ${h.checked} agree`, note: h.differ ? `${h.differ} differ` : undefined, tone: h.differ ? 'warn' as const : 'pos' as const, to: '/reality' })),
        ...r.findings.slice(0, 6).map((f) => ({ label: f.title, amount: f.amount, note: `${company(f.company_id)} · ${f.differs.join(', ')} · ${f.material ? 'above the threshold' : 'below the threshold'}`, tone: 'warn' as const, to: '/reality?tab=differences' })),
        ...r.unchecked.map((u) => ({ label: 'Never checked', text: u, tone: 'warn' as const, to: '/reality' })),
      ],
      assumptions: ['Only records NUMERO holds can be compared. What nobody recorded cannot be found.', ...(r.missing.length ? [`Not compared, because your account may not read them in every selected company: ${r.missing.join(', ')}.`] : []), ...leftOut(ids, 'reality.view')],
      evidence: [{ label: 'Reality', to: '/reality' }], followUps: ['Which cases are open?', 'Show the confirmations'],
      speak: r.findings.length ? `${r.findings.length} differences were found between the records.` : 'The records that were compared agree.',
    })
  }

  // ---------------------------------------------------------------- burn rate
  if (/\bburn(ing)?( rate)?\b|\bcash burn\b|\bhow long will (the |our )?(cash|money) last\b/.test(t)) {
    const ids = idsFor('report.view')
    if (!ids.length) return out('burn', refused('the ledger', 'report.view'))
    const from = startOfMonth(addMonths(asOf, -12)), to = startOfMonth(asOf) > from ? addMonths(startOfMonth(asOf), 0) : asOf
    const s = await monthlySeries(c.api, c.accounts, ids, from, to)
    const complete = s.months.map((m, i) => ({ month: m, closing: s.cash[i] })).filter((p) => p.month < startOfMonth(asOf))
    const b = burnRate(complete, 6)
    return out('burn', {
      ...blank, basis: 'INFERENCE',
      headline: b.consuming ? `Cash has fallen by about ${M(b.monthlyBurn)} a month${b.runway ? `; at that rate what is in hand lasts about ${b.runway} months` : ''}.` : b.months.length ? 'Cash has risen over the months measured. The selected companies are not consuming cash.' : 'There are too few months in the books to work out a burn rate.',
      narrative: 'This is an average of what happened in complete months. It is not a forecast: Forward and the Digital Twin look ahead.',
      facts: [
        { label: 'Cash at the end of the last complete month', amount: b.cash, to: '/banking' },
        ...b.months.map((m) => ({ label: `Change in ${fmtDate(m.month).replace(/^\d+\s/, '')}`, amount: m.change, tone: m.change.lt(0) ? 'neg' as const : 'pos' as const })),
      ],
      assumptions: [b.formula, 'Cash is the balance of bank and cash ledgers. Money borrowed or put in by owners is inside it.', ...leftOut(ids, 'report.view')],
      evidence: [{ label: 'Burn rate', to: '/analysis?tab=burn' }], followUps: ['How much cash will we have in 30 days?', 'What if revenue falls by 20%?'],
      speak: b.consuming ? `Cash has fallen by about ${M(b.monthlyBurn)} a month.` : 'The selected companies are not consuming cash.',
    }, 'the last six complete months')
  }

  // ---------------------------------------------------------------- year on year
  if (/\byear[- ]on[- ]year\b|\byear over year\b|\byoy\b|\b(against|versus|vs\.?|compared (with|to)) (the )?(last|previous|prior) year\b/.test(t)) {
    const ids = idsFor('report.view')
    if (!ids.length) return out('year_on_year', refused('the ledger', 'report.view'))
    const fy = c.companies.find((x) => ids.includes(x.id))?.fy_start_month ?? 4
    const rows = await c.api.ledgerMonthly(ids, '1990-01-01', asOf)
    const y = yearOnYear(rows, c.accounts.filter((a) => ids.includes(a.company_id)), fy, asOf)
    const last = y.years[y.years.length - 1], prev = y.years[y.years.length - 2]
    return out('year_on_year', {
      ...blank,
      headline: prev === undefined ? 'The books hold one financial year. There is nothing to compare it with yet.' : `Financial year ${last} against ${prev}${y.complete[last]?.complete ? '' : ` — ${last} holds ${y.complete[last]?.months} month(s) and is not complete`}.`,
      narrative: prev !== undefined && !y.complete[last]?.complete ? 'A year that is not complete is shown as it stands. It is not scaled up to twelve months.' : undefined,
      facts: prev === undefined ? y.rows.slice(0, 6).map((r) => ({ label: r.label, amount: r.byYear[last] }))
        : y.rows.map((r) => ({ label: r.label, amount: r.byYear[last], note: `${prev}: ${M(r.byYear[prev] ?? ZERO, false)} · change ${M(r.changes[last]?.amount ?? ZERO, false)}${r.changes[last]?.pct ? ` (${r.changes[last]!.pct!.toFixed(1)}%)` : ''}`, to: '/analysis?tab=years' })),
      assumptions: [...y.notes, ...leftOut(ids, 'report.view')],
      evidence: [{ label: 'Year on year', to: '/analysis?tab=years' }], followUps: ['What is our burn rate?', 'Compare this quarter with last quarter'],
      speak: prev === undefined ? 'The books hold one financial year.' : `Financial year ${last} against ${prev}.`,
    }, 'financial years in the books')
  }

  // ---------------------------------------------------------------- system health
  if (/\bsystem (health|status)\b|\bis (the system|numero|everything) (ok|okay|healthy|working|fine)\b|\bbackups?\b|\bintegrations?\b|\bwhat is connected\b/.test(t)) {
    if (c.can && !c.companies.some((x) => c.can!('system.health', x.id))) return out('system_health', refused('the health of the system', 'system.health'))
    let h
    try { h = await c.api.systemHealth() } catch { return out('system_health', refused('the health of the system', 'system.health')) }
    const rows = Object.entries(h)
    const bad = rows.filter(([, s]) => s.state === 'attention' || s.state === 'failure')
    const n = (s: string) => rows.filter(([, x]) => x.state === s).length
    return out('system_health', {
      ...blank,
      headline: bad.length ? `${plural(bad.length, 'part of the system needs', 'parts of the system need')} attention.` : 'Nothing that is measured needs attention.',
      narrative: `${n('ok')} in order, ${n('attention')} need attention, ${n('failure')} failing, ${n('not_recorded')} not recorded, ${n('not_connected')} not connected. What is not recorded or not connected is not counted as in order.`,
      facts: rows.map(([k, s]) => ({ label: k.replace(/_/g, ' '), text: s.state.replace(/_/g, ' '), note: s.explanation, tone: s.state === 'ok' ? 'pos' as const : s.state === 'failure' ? 'neg' as const : s.state === 'attention' ? 'warn' as const : undefined, to: '/system' })),
      evidence: [{ label: 'System health', to: '/system' }], followUps: ['Are the books balanced?'],
      speak: bad.length ? `${bad.length} parts of the system need attention.` : 'Nothing that is measured needs attention.',
    })
  }

  // ---------------------------------------------------------------- what waits for the person
  if (/\bnotifications?\b|\bwhat('?s| is) waiting for me\b|\bwhat needs my attention\b|\banything for me\b/.test(t)) {
    const ns = await c.api.listNotifications({ unreadOnly: true, limit: 200 })
    return out('notifications', {
      ...blank,
      headline: ns.length ? `${plural(ns.length, 'notice is', 'notices are')} waiting for you.` : 'Nothing is waiting for you.',
      facts: [
        ...ATTENTION.filter((a) => ns.some((x) => x.class === a.key)).map((a) => ({ label: a.label, text: String(ns.filter((x) => x.class === a.key).length), note: a.meaning, to: '/notifications' })),
        ...ns.slice(0, 6).map((x) => ({ label: x.title, text: x.body ?? undefined, to: '/notifications' })),
      ],
      assumptions: ['Notices are shown inside the application. Nothing is sent by e-mail, SMS or WhatsApp.'],
      evidence: [{ label: 'Notifications', to: '/notifications' }, { label: 'Approval inbox', to: '/approvals' }], followUps: ['What requires approval?'],
      speak: ns.length ? `${ns.length} notices are waiting for you.` : 'Nothing is waiting for you.',
    })
  }

  return null
}

/** Questions NUMI can answer about stock, investments, reality and simulations; shown with the honest fallback. */
export const P3_PROMPTS = ['What is the value of our stock?', 'How much stock is at risk?', 'Which items need to be reordered?', 'What are our investments worth?', 'How are our funds doing?', 'Do the records agree with each other?', 'Which cases are open?', 'What if revenue falls by 20%?', 'What is our burn rate?', 'Is the system healthy?']

export function p3Prompts(screen: string): string[] | null {
  if (screen.startsWith('/inventory')) return ['What is the value of our stock?', 'How much stock is at risk?', 'Which items need to be reordered?']
  if (screen.startsWith('/investments')) return ['What are our investments worth?', 'How are our funds doing?']
  if (screen.startsWith('/reality') || screen.startsWith('/control')) return ['Do the records agree with each other?', 'Which cases are open?', 'Show the confirmations']
  if (screen.startsWith('/twin') || screen.startsWith('/sandbox')) return ['What if revenue falls by 20%?', 'What if customers pay 30 days later?', 'What is our burn rate?']
  if (screen.startsWith('/analysis')) return ['What is our burn rate?', 'Show year on year', 'How much cash will we have in 30 days?']
  if (screen.startsWith('/system') || screen.startsWith('/notifications')) return ['Is the system healthy?', 'What is waiting for me?']
  return null
}
