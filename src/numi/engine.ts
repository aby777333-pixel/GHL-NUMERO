import Decimal from 'decimal.js'
import type { NumeroApi } from '@/api/types'
import type { Account, Company, ID, Party, TruthState } from '@/engine/types'
import { intercompanyEliminations, joinBalances, isCash } from '@/engine/reports'
import { D, ZERO, parseAmount, pctChange, fmtPct } from '@/lib/money'
import { addDays, fmtDate, previousPeriod, resolvePeriod, today, type Period } from '@/lib/dates'
import { companyFigures, ledgerLink, openDocuments, statements, sumBase } from '@/lib/data'

// =====================================================================
// NUMI — evidence-linked answers from the authorised books.
//
//  * NUMI reads through the same data layer as every screen, so it can
//    never see more than the person asking (permission mirror, spec 916).
//  * It answers only from recorded data. When it cannot answer, it says
//    so; it never invents a number (spec 915).
//  * Every answer states its basis (FACT / INFERENCE / SUGGESTION), its
//    scope and period, and links to the records behind it.
//  * It never posts, approves or moves money.
// =====================================================================

export interface NumiFact { label: string; amount?: Decimal.Value; text?: string; to?: string; note?: string; tone?: 'pos' | 'neg' | 'warn' }
export interface NumiAnswer {
  intent: string
  headline: string
  narrative?: string
  facts: NumiFact[]
  evidence: { label: string; to: string }[]
  basis: 'FACT' | 'INFERENCE' | 'SUGGESTION'
  truth: TruthState
  scope: string
  assumptions: string[]
  followUps: string[]
  speak: string
}

export interface NumiContext {
  api: NumeroApi
  companies: Company[]
  accounts: Account[]
  parties: Party[]
  scopeIds: ID[]
  period: Period
  screen: string
  money: (v: Decimal.Value, compact?: boolean) => string
}

const lc = (s: string) => s.toLowerCase()

function scopeFrom(q: string, c: NumiContext): { ids: ID[]; label: string; named: Company | null } {
  const t = lc(q)
  const named = c.companies.find((x) => t.includes(lc(x.name)) || new RegExp(`\\b${lc(x.code)}\\b`).test(t)) ?? null
  if (named && c.scopeIds.length && !c.companies.some((x) => x.id === named.id)) return { ids: c.scopeIds, label: 'your authorised companies', named: null }
  if (named) return { ids: [named.id], label: named.name, named }
  const all = c.companies.filter((x) => x.status === 'active').map((x) => x.id)
  const ids = c.scopeIds.length ? c.scopeIds : all
  return { ids, label: ids.length === 1 ? c.companies.find((x) => x.id === ids[0])!.name : ids.length === all.length ? 'the whole group' : `${ids.length} selected companies`, named: null }
}
function periodFrom(q: string, c: NumiContext): Period {
  const t = lc(q), m = c.companies[0]?.fy_start_month ?? 4
  if (/\bthis month\b/.test(t)) return resolvePeriod('this_month', m)
  if (/\b(last|previous) month\b/.test(t)) return resolvePeriod('last_month', m)
  if (/\bthis quarter\b/.test(t)) return resolvePeriod('this_quarter', m)
  if (/\b(last|previous) quarter\b/.test(t)) return resolvePeriod('last_quarter', m)
  if (/\b(last|previous) (financial |fiscal )?year\b/.test(t)) return resolvePeriod('last_fy', m)
  if (/\b(this|current) (financial |fiscal )?year\b|\bthis fy\b/.test(t)) return resolvePeriod('fy', m)
  return c.period
}
const periodText = (p: Period) => `${p.label} (${fmtDate(p.from)} – ${fmtDate(p.to > today() ? today() : p.to)})`

const CATEGORY: [RegExp, RegExp, string][] = [
  [/\bmarketing|advertis\w*|ads?\b/, /advertis|agency|events|print|marketing/i, 'Marketing'],
  [/\btravel|trip|hotel|flight|airfare|taxi|fuel\b/, /airfare|hotel|conveyance|fuel|meals|toll|travel/i, 'Travel'],
  [/\bsalar\w*|payroll|staff|employee cost|people cost\b/, /salaries|employer|welfare|bonus/i, 'Employee cost'],
  [/\brent\b/, /^rent$/i, 'Rent'],
  [/\blegal\b/, /legal/i, 'Legal'],
  [/\bprofessional|consult\w*|audit fee\b/, /legal|audit|consultancy/i, 'Professional fees'],
  [/\bsoftware|subscription|saas|cloud|technology|it\b/, /software|cloud/i, 'Technology'],
  [/\belectricity|utilit\w*|water\b/, /electricity|water/i, 'Utilities'],
  [/\blogistics|freight|courier|transport\w*\b/, /freight|courier|clearing/i, 'Logistics'],
  [/\binterest|finance cost\b/, /interest/i, 'Finance cost'],
  [/\bcommission|brokerage\b/, /commission|brokerage/i, 'Commission'],
  [/\bfood|meal|pantry|lunch\b/, /meals|pantry|welfare/i, 'Food'],
]

const base = (intent: string, scope: string, p?: Period): Pick<NumiAnswer, 'intent' | 'scope' | 'assumptions' | 'followUps' | 'evidence' | 'facts' | 'basis' | 'truth'> => ({
  intent, scope: p ? `${scope} · ${periodText(p)}` : scope, assumptions: [], followUps: [], evidence: [], facts: [], basis: 'FACT', truth: 'ACTUAL',
})

export async function askNumi(question: string, c: NumiContext): Promise<NumiAnswer> {
  const q = question.trim()
  const t = lc(q)
  const sc = scopeFrom(q, c)
  const p = periodFrom(q, c)
  const to = p.to > today() ? today() : p.to
  const accs = c.accounts.filter((a) => sc.ids.includes(a.company_id))
  const M = c.money

  // ---------------------------------------------------------------- calculators
  const gst = t.match(/(\d+(?:\.\d+)?)\s*%\s*(gst|tax|igst|vat)?\s*(on|of)\b(.+)/)
  if (gst && parseAmount(gst[4])) {
    const amt = parseAmount(gst[4])!, rate = D(gst[1])
    const tax = amt.times(rate).div(100).toDecimalPlaces(2)
    return {
      ...base('calculate', 'Calculation — not taken from the books'), truth: 'AI ESTIMATE', basis: 'FACT',
      headline: `${rate}% on ${M(amt, false)} is ${M(tax, false)}.`,
      facts: [{ label: 'Base amount', amount: amt }, { label: `${rate}% ${gst[2] ? gst[2].toUpperCase() : ''}`.trim(), amount: tax }, { label: 'Total including tax', amount: amt.plus(tax) },
        ...(/gst/.test(gst[2] ?? '') ? [{ label: 'If intra-state: CGST + SGST', text: `${M(tax.div(2), false)} + ${M(tax.div(2), false)}` }] : [])],
      assumptions: ['Arithmetic only. The rate that actually applies to a transaction comes from the tax codes configured for the company.'],
      evidence: [{ label: 'Open calculators', to: '/calculators' }], followUps: ['Show tax codes'], speak: `${rate} percent on ${M(amt)} is ${M(tax)}.`,
    }
  }

  // ---------------------------------------------------------------- integrity
  if (/\b(books|accounts)\b.*\bbalanc\w*|\bdebits?\b.*\bcredits?\b|\bintegrity\b/.test(t)) {
    const r = await c.api.integrityCheck(sc.ids)
    const ok = r.unbalanced_journals === 0 && D(r.total_debits).eq(r.total_credits)
    return {
      ...base('integrity', sc.label), headline: ok ? 'All books are balanced.' : 'An integrity problem was detected.',
      narrative: `${r.posted_journals.toLocaleString()} posted journals were re-added line by line. Total debits ${ok ? 'equal' : 'do NOT equal'} total credits.`,
      facts: [{ label: 'Total debits', amount: r.total_debits }, { label: 'Total credits', amount: r.total_credits }, { label: 'Unbalanced posted journals', text: String(r.unbalanced_journals), tone: r.unbalanced_journals ? 'neg' : 'pos' },
        { label: 'Awaiting approval', text: String(r.awaiting_approval), to: '/approvals' }, { label: 'Unreconciled bank lines', text: String(r.unreconciled_bank_lines), to: '/banking' }, { label: 'Open Sentinel alerts', text: String(r.open_alerts), to: '/sentinel' }],
      evidence: [{ label: 'Trial balance', to: '/reports/trial-balance' }], followUps: ['What requires approval?', 'Show unusual transactions'], speak: ok ? 'All books are balanced.' : 'An integrity problem was detected.',
    }
  }

  // ---------------------------------------------------------------- anomalies / duplicates
  if (/\bunusual|anomal\w*|suspicious|duplicate|odd\b/.test(t)) {
    const all = (await c.api.listAlerts(sc.ids)).filter((a) => a.status === 'open' || a.status === 'reviewing')
    const dup = /duplicate/.test(t)
    const list = dup ? all.filter((a) => a.kind.startsWith('duplicate')) : all
    return {
      ...base('anomalies', sc.label), basis: 'FACT',
      headline: list.length ? `${list.length} ${dup ? 'possible duplicate' : 'open anomaly'} item${list.length === 1 ? '' : 's'} need human review.` : `No open ${dup ? 'duplicate candidates' : 'anomalies'}.`,
      narrative: 'These are factual patterns, each with the rule that flagged it. None of them is a conclusion about anyone\'s conduct.',
      facts: list.slice(0, 8).map((a) => ({ label: a.title.replace('ANOMALY DETECTED — ', ''), text: a.explanation, to: '/sentinel?alert=' + a.id, tone: a.attention === 'priority' || a.attention === 'critical' ? 'neg' as const : 'warn' as const })),
      evidence: [{ label: 'Open Sentinel', to: '/sentinel' }], followUps: ['Find duplicate invoices', 'Are the books balanced?'], speak: list.length ? `${list.length} items need review.` : 'Nothing unusual is open.',
    }
  }

  // ---------------------------------------------------------------- approvals
  if (/\bapprov\w*|waiting for me|pending\b/.test(t) && !/budget/.test(t)) {
    const r = (await c.api.listApprovalRequests(sc.ids)).filter((x) => x.status === 'pending')
    return {
      ...base('approvals', sc.label), headline: r.length ? `${r.length} item${r.length === 1 ? ' is' : 's are'} waiting for approval.` : 'Nothing is waiting for approval.',
      facts: r.slice(0, 8).map((x) => ({ label: x.summary ?? x.entity, amount: x.amount, to: `/journals/${x.entity_id}`, note: `Step ${x.current_step} of ${x.steps.length} · ${c.companies.find((k) => k.id === x.company_id)?.name ?? ''}` })),
      evidence: [{ label: 'Approval inbox', to: '/approvals' }], followUps: ['Show unusual transactions'],
      assumptions: ['I can show and explain these. Approving them is your decision and requires your own action on the approval screen.'],
      speak: r.length ? `${r.length} items are waiting for approval.` : 'Nothing is waiting for approval.',
    }
  }

  // ---------------------------------------------------------------- intercompany
  if (/\bintercompany|inter-company|group compan\w* owe\b/.test(t)) {
    const all = c.companies.map((x) => x.id)
    const rows = await c.api.ledgerBalances(all, '1990-01-01', today())
    const el = intercompanyEliminations(joinBalances(c.accounts, rows), c.companies)
    const name = (id: ID) => c.companies.find((x) => x.id === id)?.name ?? '—'
    const bad = el.filter((e) => !e.mismatch.isZero())
    return {
      ...base('intercompany', 'All authorised group companies'),
      headline: el.length ? `${el.length} intercompany balance${el.length === 1 ? '' : 's'}; ${bad.length ? `${bad.length} do not agree between the two companies` : 'both sides agree on every one'}.` : 'No intercompany balances are recorded.',
      facts: el.map((e) => ({ label: `${name(e.toCompany)} owes ${name(e.fromCompany)}`, amount: e.receivable, note: e.mismatch.isZero() ? 'Both ledgers agree' : `Difference of ${M(e.mismatch.abs(), false)} between the two ledgers`, tone: e.mismatch.isZero() ? undefined : 'neg' as const })),
      evidence: [{ label: 'Group consolidation', to: '/reports/consolidated' }], followUps: ['Show consolidated balance sheet'], speak: `${el.length} intercompany balances.`,
    }
  }

  // ---------------------------------------------------------------- receivables
  if (/\bowes? us\b|\bowe us\b|receivable|haven'?t paid|not paid|overdue|outstanding from|collections?\b/.test(t)) {
    const docs = openDocuments(await c.api.listInvoices({ companyIds: sc.ids, docTypes: ['sales_invoice'] }))
    const days = Number(t.match(/(\d+)\s*days?/)?.[1] ?? 0)
    const list = days ? docs.filter((d) => d.daysOverdue >= days) : docs
    const byParty = new Map<ID, Decimal>()
    for (const d of list) byParty.set(d.invoice.party_id, (byParty.get(d.invoice.party_id) ?? ZERO).plus(d.outstandingBase))
    const top = [...byParty.entries()].sort((a, b) => b[1].cmp(a[1]))
    const overdue = sumBase(docs.filter((d) => d.daysOverdue > 0))
    const name = (id: ID) => c.parties.find((x) => x.id === id)?.display_name ?? 'Unknown party'
    return {
      ...base('receivables', sc.label + ` · as at ${fmtDate(today())}`),
      headline: days ? `${top.length} customer${top.length === 1 ? '' : 's'} ${top.length === 1 ? 'has' : 'have'} invoices ${days}+ days overdue, totalling ${M(sumBase(list))}.`
        : top.length ? `${name(top[0][0])} owes the most: ${M(top[0][1])}. Total owed to us is ${M(sumBase(docs))}.` : 'No customer invoices are outstanding.',
      narrative: docs.length ? `${M(overdue)} of the total is past its due date.` : undefined,
      facts: top.slice(0, 8).map(([id, v]) => ({ label: name(id), amount: v, to: `/parties/${id}` })),
      evidence: [{ label: 'Who owes us?', to: '/parties/owed?side=in' }, { label: 'Receivables ageing', to: '/reports/ageing' }],
      assumptions: ['Based on open invoices and their recorded due dates. Overdue days are counted from the due date to today.'],
      followUps: ["Which customers haven't paid for 60 days?", 'What payments are due this week?'], speak: top.length ? `${name(top[0][0])} owes the most, ${M(top[0][1])}.` : 'Nothing is outstanding.',
    }
  }

  // ---------------------------------------------------------------- payables / due
  if (/\bwe owe\b|\bdo i owe\b|payable|payments? (are )?due|due (this|next|today|tomorrow)|bills? due\b/.test(t)) {
    const docs = openDocuments(await c.api.listInvoices({ companyIds: sc.ids, docTypes: ['purchase_bill'] }))
    const horizon = /today/.test(t) ? 0 : /tomorrow/.test(t) ? 1 : /this week|7 days|week/.test(t) ? 7 : /month|30 days/.test(t) ? 30 : null
    const list = horizon === null ? docs : docs.filter((d) => (d.invoice.due_date ?? d.invoice.doc_date) <= addDays(today(), horizon))
    const name = (id: ID) => c.parties.find((x) => x.id === id)?.display_name ?? 'Unknown party'
    const sorted = [...list].sort((a, b) => (a.invoice.due_date ?? '').localeCompare(b.invoice.due_date ?? ''))
    return {
      ...base('payables', sc.label + ` · as at ${fmtDate(today())}`), truth: horizon === null ? 'ACTUAL' : 'EXPECTED',
      headline: list.length ? `${list.length} bill${list.length === 1 ? '' : 's'} totalling ${M(sumBase(list))} ${horizon === null ? 'are outstanding' : `fall due ${horizon === 0 ? 'today or earlier' : `within ${horizon} day${horizon === 1 ? '' : 's'} (including already overdue)`}`}.` : 'No bills match.',
      facts: sorted.slice(0, 8).map((d) => ({ label: `${name(d.invoice.party_id)} · ${d.invoice.doc_no}`, amount: d.outstandingBase, note: d.daysOverdue > 0 ? `${d.daysOverdue} days overdue` : `Due ${fmtDate(d.invoice.due_date)}`, tone: d.daysOverdue > 0 ? 'neg' as const : undefined, to: `/parties/${d.invoice.party_id}` })),
      evidence: [{ label: 'Who do we owe?', to: '/parties/owed?side=out' }, { label: 'NUMERO Forward', to: '/forward' }],
      assumptions: ['These are recorded obligations. I can prepare a payment proposal, but only an authorised person can approve a payment.'],
      followUps: ['How much cash do we have?', 'Which company owes us the most money?'], speak: `${list.length} bills totalling ${M(sumBase(list))}.`,
    }
  }

  // ---------------------------------------------------------------- payments to a party
  const partyHit = c.parties.filter((x) => x.display_name.length > 3 && t.includes(lc(x.display_name))).sort((a, b) => b.display_name.length - a.display_name.length)[0]
  if (partyHit && /\bpaid|pay|spent|spend|received|everything|transactions?|history\b/.test(t)) {
    const control = c.accounts.filter((a) => sc.ids.includes(a.company_id) && a.control_type && ['receivable', 'payable', 'advance_paid', 'advance_received', 'intercompany'].includes(a.control_type)).map((a) => a.id)
    const r = await c.api.ledgerLines({ company_ids: sc.ids, party_id: partyHit.id, account_ids: control, limit: 1000 })
    const byCo = new Map<ID, { d: Decimal; c: Decimal }>()
    for (const l of r.rows) { const x = byCo.get(l.company_id) ?? { d: ZERO, c: ZERO }; x.d = x.d.plus(l.debit); x.c = x.c.plus(l.credit); byCo.set(l.company_id, x) }
    const pays = await c.api.listPayments({ companyIds: sc.ids, partyId: partyHit.id })
    const out = pays.filter((x) => x.direction === 'out' && x.status === 'posted').reduce((s, x) => s.plus(D(x.amount).times(x.fx_rate)), ZERO)
    const inn = pays.filter((x) => x.direction === 'in' && x.status === 'posted').reduce((s, x) => s.plus(D(x.amount).times(x.fx_rate)), ZERO)
    return {
      ...base('party', `${partyHit.display_name} (${partyHit.party_no}) · ${sc.label} · all dates`),
      headline: `${partyHit.display_name}: ${M(out)} paid to them and ${M(inn)} received from them, across ${byCo.size} compan${byCo.size === 1 ? 'y' : 'ies'} you can see.`,
      facts: [{ label: 'Total paid', amount: out }, { label: 'Total received', amount: inn }, { label: 'Ledger entries', text: String(r.total) },
        ...[...byCo.keys()].map((id) => ({ label: c.companies.find((k) => k.id === id)?.name ?? '', text: 'has a relationship with this party', to: `/parties/${partyHit.id}` }))],
      evidence: [{ label: 'Party 360°', to: `/parties/${partyHit.id}` }, { label: 'Ledger entries', to: ledgerLink({ party: partyHit.id }) }],
      assumptions: r.restricted.count ? [`${r.restricted.count} further entr${r.restricted.count === 1 ? 'y is' : 'ies are'} restricted and not shown to your account.`] : [],
      followUps: ['Who do we owe money to?'], speak: `${M(out)} paid to ${partyHit.display_name}.`,
    }
  }

  // ---------------------------------------------------------------- cash
  if (/\bcash\b|\bmoney (do )?we have\b|\bbank balance\b|\bliquidity\b/.test(t) && !/flow|forecast|runway/.test(t)) {
    const consuming = /consum|burn|using/.test(t)
    const figs = await companyFigures(c.api, c.companies, c.accounts, sc.ids, p.from, p.to)
    if (consuming) {
      const rows = figs.map((f) => ({ f, change: f.cf.closingCash.minus(f.cf.openingCash) })).sort((a, b) => a.change.cmp(b.change))
      const worst = rows[0]
      return {
        ...base('cash_consumption', sc.label, p),
        headline: worst && worst.change.lt(0) ? `${worst.f.company.name} consumed the most cash: ${M(worst.change.abs())} in ${p.label.toLowerCase()}.` : 'No company reduced its cash in this period.',
        facts: rows.map((r) => ({ label: r.f.company.name, amount: r.change, note: `Operating ${M(r.f.cf.operating)} · Investing ${M(r.f.cf.investing)} · Financing ${M(r.f.cf.financing)}`, tone: r.change.lt(0) ? 'neg' as const : 'pos' as const, to: '/reports/cash-flow' })),
        evidence: [{ label: 'Cash flow statement', to: '/reports/cash-flow' }], followUps: ['How much cash do we have across the group?'], speak: worst ? `${worst.f.company.name} consumed the most cash.` : 'No company consumed cash.',
      }
    }
    const total = figs.reduce((s, f) => s.plus(f.bs.cash), ZERO)
    const bal = joinBalances(accs, await c.api.ledgerBalances(sc.ids, '1990-01-01', today()))
    const cashAcc = bal.filter((b) => isCash(b.account) && !b.closing.isZero()).sort((a, b) => b.closing.cmp(a.closing))
    return {
      ...base('cash', sc.label + ` · as at ${fmtDate(today())}`),
      headline: `Cash and bank balances total ${M(total)} across ${figs.length} compan${figs.length === 1 ? 'y' : 'ies'}.`,
      narrative: 'This is the balance in the books. Whether it agrees with the bank depends on reconciliation, shown separately.',
      facts: figs.sort((a, b) => b.bs.cash.cmp(a.bs.cash)).map((f) => ({ label: f.company.name, amount: f.bs.cash, to: ledgerLink({ accounts: cashAcc.filter((b) => b.account.company_id === f.company.id).map((b) => b.account.id) }) })),
      evidence: [{ label: 'Bank accounts & reconciliation', to: '/banking' }, { label: 'Balance sheet', to: '/reports/balance-sheet' }],
      followUps: ['Which company is consuming the most cash?', 'What payments are due this week?'], speak: `Cash and bank balances total ${M(total)}.`,
    }
  }

  // ---------------------------------------------------------------- compare periods / why did X change
  const cat = CATEGORY.find(([re]) => re.test(t))
  if (/\bcompare|versus|vs\b|\bwhy\b|\bincrease|decrease|rise|fall|fell|drop|changed?\b/.test(t)) {
    const prev = previousPeriod(p)
    const [now, was] = await Promise.all([statements(c.api, c.companies, accs, sc.ids, p.from, p.to), statements(c.api, c.companies, accs, sc.ids, prev.from, prev.to)])
    if (cat || /expense|cost|spend/.test(t)) {
      const match = (a: Account) => a.type === 'expense' && (!cat || cat[1].test(a.name))
      const cur = new Map<string, { v: Decimal; ids: ID[] }>(), old = new Map<string, Decimal>()
      for (const b of now.period.filter((x) => match(x.account))) { const k = b.account.name; const e = cur.get(k) ?? { v: ZERO, ids: [] }; e.v = e.v.plus(b.debit).minus(b.credit); e.ids.push(b.account.id); cur.set(k, e) }
      for (const b of was.period.filter((x) => match(x.account))) old.set(b.account.name, (old.get(b.account.name) ?? ZERO).plus(b.debit).minus(b.credit))
      const names = new Set([...cur.keys(), ...old.keys()])
      const rows = [...names].map((n) => ({ n, now: cur.get(n)?.v ?? ZERO, was: old.get(n) ?? ZERO, ids: cur.get(n)?.ids ?? [] })).map((r) => ({ ...r, diff: r.now.minus(r.was) })).sort((a, b) => b.diff.abs().cmp(a.diff.abs()))
      const tn = rows.reduce((s, r) => s.plus(r.now), ZERO), tw = rows.reduce((s, r) => s.plus(r.was), ZERO)
      const ch = pctChange(tn, tw)
      const label = cat ? cat[2] : 'Total expense'
      return {
        ...base('variance', sc.label, p), basis: 'FACT',
        headline: `${label} was ${M(tn)} against ${M(tw)} in the previous period${ch ? ` (${ch.gt(0) ? '+' : ''}${fmtPct(ch)})` : ''}.`,
        narrative: rows.length ? `The largest movement was ${rows[0].n}: ${rows[0].diff.gte(0) ? 'up' : 'down'} ${M(rows[0].diff.abs())}.` : 'No entries were recorded under this category in either period.',
        facts: rows.slice(0, 7).filter((r) => !r.diff.isZero()).map((r) => ({ label: r.n, amount: r.diff, note: `${M(r.was)} → ${M(r.now)}`, tone: r.diff.gt(0) ? 'neg' as const : 'pos' as const, to: ledgerLink({ accounts: r.ids, from: p.from, to }) })),
        assumptions: [`Compared with the immediately preceding period of equal length (${fmtDate(prev.from)} – ${fmtDate(prev.to)}).`, 'I report which recorded ledgers moved. I do not claim to know the business reason behind the movement.'],
        evidence: [{ label: 'Profit & Loss with comparison', to: '/reports/pnl' }], followUps: ['Show expenses above ₹1 lakh', 'Are we profitable?'], speak: `${label} was ${M(tn)} against ${M(tw)} previously.`,
      }
    }
    const lines: [string, Decimal, Decimal][] = [['Revenue', now.pl.revenue, was.pl.revenue], ['Gross profit', now.pl.grossProfit, was.pl.grossProfit], ['Operating expenses', now.pl.opex.plus(now.pl.employeeCost), was.pl.opex.plus(was.pl.employeeCost)], ['Operating profit', now.pl.operatingProfit, was.pl.operatingProfit], ['Profit after tax', now.pl.pat, was.pl.pat]]
    const gm = (x: typeof now) => (x.pl.revenue.isZero() ? null : x.pl.grossProfit.div(x.pl.revenue).times(100))
    const a = gm(now), b = gm(was)
    return {
      ...base('compare', sc.label, p),
      headline: `Revenue ${now.pl.revenue.gte(was.pl.revenue) ? 'rose' : 'fell'} to ${M(now.pl.revenue)} from ${M(was.pl.revenue)}; profit after tax moved to ${M(now.pl.pat)} from ${M(was.pl.pat)}.`,
      narrative: a && b ? `Gross margin is ${fmtPct(a)} against ${fmtPct(b)} previously.` : undefined,
      facts: lines.map(([l, n, w]) => ({ label: l, amount: n, note: `Previously ${M(w)}${pctChange(n, w) ? ` · ${pctChange(n, w)!.gt(0) ? '+' : ''}${fmtPct(pctChange(n, w)!)}` : ''}` })),
      assumptions: [`Compared with the immediately preceding period of equal length (${fmtDate(prev.from)} – ${fmtDate(prev.to)}).`],
      evidence: [{ label: 'Profit & Loss', to: '/reports/pnl' }], followUps: ['Why did marketing expense increase?', 'What changed in gross margin?'], speak: `Revenue is ${M(now.pl.revenue)}, profit after tax ${M(now.pl.pat)}.`,
    }
  }

  // ---------------------------------------------------------------- expenses above / spend
  if (/\bexpenses?|spend|spent|cost\b/.test(t)) {
    const min = /\babove|over|more than|greater than|exceed\w*\b/.test(t) ? parseAmount(t.split(/above|over|more than|greater than|exceed\w*/)[1] ?? '') : null
    const ids = accs.filter((a) => a.type === 'expense' && !a.is_group && (!cat || cat[1].test(a.name))).map((a) => a.id)
    if (min) {
      const r = await c.api.ledgerLines({ company_ids: sc.ids, account_ids: ids, from: p.from, to, min_amount: min.toNumber(), limit: 200 })
      return {
        ...base('expenses_above', sc.label, p),
        headline: `${r.total} expense entr${r.total === 1 ? 'y' : 'ies'} of ${M(min, false)} or more, totalling ${M(D(r.sum_debit).minus(r.sum_credit))}.`,
        facts: r.rows.filter((l) => D(l.debit).gt(0)).slice(0, 8).map((l) => ({ label: `${l.narration ?? l.account_name}`, amount: l.debit, note: `${fmtDate(l.journal_date)} · ${l.voucher_no} · ${l.company_name}`, to: `/journals/${l.journal_id}` })),
        assumptions: r.restricted.count ? [`${r.restricted.count} further entr${r.restricted.count === 1 ? 'y' : 'ies'} totalling ${M(D(r.restricted.debit))} relate to restricted transactions that your account is not authorised to view.`] : [],
        evidence: [{ label: 'Open in the ledger', to: ledgerLink({ accounts: ids, from: p.from, to, min: min.toNumber() }) }], followUps: ['Where did the money go?'], speak: `${r.total} entries of ${M(min)} or more.`,
      }
    }
    const figs = await companyFigures(c.api, c.companies, c.accounts, sc.ids, p.from, p.to)
    const s = await statements(c.api, c.companies, accs, sc.ids, p.from, p.to)
    const rows = s.period.filter((b) => b.account.type === 'expense' && (!cat || cat[1].test(b.account.name)))
    const total = rows.reduce((x, b) => x.plus(b.debit).minus(b.credit), ZERO)
    const byName = new Map<string, { v: Decimal; ids: ID[] }>()
    for (const b of rows) { const e = byName.get(b.account.name) ?? { v: ZERO, ids: [] }; e.v = e.v.plus(b.debit).minus(b.credit); e.ids.push(b.account.id); byName.set(b.account.name, e) }
    const top = [...byName.entries()].sort((a, b) => b[1].v.cmp(a[1].v))
    return {
      ...base('spend', sc.label, p),
      headline: `${cat ? cat[2] + ' spending' : 'Total expense'} recorded is ${M(total)}.`,
      facts: (cat || figs.length === 1 ? top.slice(0, 8).map(([n, e]) => ({ label: n, amount: e.v, to: ledgerLink({ accounts: e.ids, from: p.from, to }) }))
        : figs.sort((a, b) => b.pl.totalExpense.cmp(a.pl.totalExpense)).map((f) => ({ label: f.company.name, amount: f.pl.totalExpense, to: '/reports/money-went' }))),
      evidence: [{ label: 'Where did the money go?', to: '/reports/money-went' }, { label: 'Profit & Loss', to: '/reports/pnl' }],
      followUps: ['Show expenses above ₹1 lakh', 'Compare this quarter with last quarter'], speak: `${cat ? cat[2] : 'Total'} expense is ${M(total)}.`,
    }
  }

  // ---------------------------------------------------------------- balance sheet in plain English
  if (/\bbalance sheet\b|\bfinancial position\b|\bwhat do we own\b|\bassets?\b|\bliabilit\w*\b/.test(t)) {
    const s = await statements(c.api, c.companies, accs, sc.ids, p.from, p.to)
    const b = s.bs
    return {
      ...base('balance_sheet', sc.label + ` · as at ${fmtDate(to)}`),
      headline: `The business owns ${M(b.totalAssets)} and owes ${M(b.totalLiabilities)}; the owners' share is ${M(b.totalEquity)}.`,
      narrative: `Of what it owns, ${M(b.cash)} is cash, ${M(b.receivables)} is owed by customers, ${M(b.inventory)} is stock and work in progress, and ${M(b.fixedAssetsNet)} is long-term assets. Of what it owes, ${M(b.payables)} is due to suppliers and ${M(b.borrowings)} is borrowed. ${b.balanced ? 'The two sides agree exactly.' : 'WARNING: the two sides do not agree — see the integrity dashboard.'}`,
      facts: [{ label: 'Total assets', amount: b.totalAssets }, { label: 'Total liabilities', amount: b.totalLiabilities }, { label: 'Equity', amount: b.totalEquity }, { label: 'Working capital', amount: b.workingCapital, note: 'Current assets less current liabilities' }],
      evidence: [{ label: 'Balance sheet', to: '/reports/balance-sheet' }], followUps: ['How much cash do we have?', 'Which company owes us the most money?'], speak: `The business owns ${M(b.totalAssets)} and owes ${M(b.totalLiabilities)}.`,
    }
  }

  // ---------------------------------------------------------------- profit / revenue / margin
  if (/\bprofit\w*|revenue|sales|income|margin|loss|earn\w*\b/.test(t)) {
    const figs = await companyFigures(c.api, c.companies, c.accounts, sc.ids, p.from, p.to)
    const s = await statements(c.api, c.companies, accs, sc.ids, p.from, p.to)
    const pl = s.pl
    const gm = pl.revenue.isZero() ? null : pl.grossProfit.div(pl.revenue).times(100)
    return {
      ...base('profit', sc.label, p),
      headline: `${pl.pat.gte(0) ? 'Profit' : 'Loss'} after tax is ${M(pl.pat.abs())} on revenue of ${M(pl.revenue)}.`,
      narrative: gm ? `Gross margin is ${fmtPct(gm)}. Operating profit before depreciation, finance cost and tax is ${M(pl.operatingProfit)}.` : undefined,
      facts: figs.length > 1 ? figs.sort((a, b) => b.pl.pat.cmp(a.pl.pat)).map((f) => ({ label: f.company.name, amount: f.pl.pat, note: `Revenue ${M(f.pl.revenue)}`, tone: f.pl.pat.lt(0) ? 'neg' as const : 'pos' as const }))
        : [{ label: 'Revenue', amount: pl.revenue }, { label: 'Cost of goods sold', amount: pl.cogs }, { label: 'Gross profit', amount: pl.grossProfit }, { label: 'Operating expenses', amount: pl.opex.plus(pl.employeeCost) }, { label: 'Profit after tax', amount: pl.pat }],
      assumptions: figs.length > 1 ? ['Company figures are shown before intercompany eliminations.'] : [],
      evidence: [{ label: 'Profit & Loss', to: '/reports/pnl' }], followUps: ['Compare this quarter with last quarter', 'What changed in gross margin?'], speak: `${pl.pat.gte(0) ? 'Profit' : 'Loss'} after tax is ${M(pl.pat.abs())}.`,
    }
  }

  // ---------------------------------------------------------------- budget
  if (/\bbudget|overspen\w*\b/.test(t)) {
    const budgets = (await c.api.listBudgets(sc.ids)).filter((b) => b.status === 'approved')
    if (!budgets.length) return { ...base('budget', sc.label), headline: 'No approved budget exists for the selected companies.', evidence: [{ label: 'Budgets', to: '/budgets' }], followUps: [], speak: 'No approved budget exists.' }
    const rows = await c.api.ledgerBalances(sc.ids, p.from, to)
    const act = new Map(rows.map((r) => [r.account_id, D(r.period_debit).minus(r.period_credit)]))
    const over: NumiFact[] = []
    for (const b of budgets) {
      const bl = (await c.api.getBudgetLines(b.id)).filter((l) => l.period_month >= p.from.slice(0, 8) + '01' && l.period_month <= to)
      const byAcc = new Map<ID, Decimal>()
      for (const l of bl) byAcc.set(l.account_id, (byAcc.get(l.account_id) ?? ZERO).plus(l.amount))
      for (const [id, bud] of byAcc) {
        const a = act.get(id) ?? ZERO
        if (a.gt(bud) && bud.gt(0)) over.push({ label: `${c.accounts.find((x) => x.id === id)?.name} · ${c.companies.find((x) => x.id === b.company_id)?.name}`, amount: a.minus(bud), note: `Actual ${M(a)} against budget ${M(bud)}`, tone: 'neg', to: '/budgets' })
      }
    }
    over.sort((x, y) => D(y.amount!).cmp(D(x.amount!)))
    return {
      ...base('budget', sc.label, p), headline: over.length ? `${over.length} budget line${over.length === 1 ? ' is' : 's are'} over budget.` : 'Every budget line is within budget.',
      facts: over.slice(0, 8), assumptions: ['ACTUAL figures come from posted entries; BUDGET figures come from the approved budget version. They are different kinds of number and are shown separately.'],
      evidence: [{ label: 'Budget vs actual', to: '/budgets' }], followUps: ['Why did marketing expense increase?'], speak: over.length ? `${over.length} budget lines are over budget.` : 'Everything is within budget.',
    }
  }

  // ---------------------------------------------------------------- honest fallback
  return {
    ...base('unknown', sc.label), basis: 'SUGGESTION', truth: 'ACTUAL',
    headline: 'I cannot answer that from the books yet.',
    narrative: 'I only answer from recorded, authorised accounting data and I will not guess. Here is what I can answer today.',
    followUps: ['How much cash do we have across the group?', 'Which company owes us the most money?', 'What payments are due this week?', 'Show expenses above ₹1 lakh', 'Compare this quarter with last quarter', 'Why did marketing expense increase?', 'Which company is consuming the most cash?', 'Show intercompany balances', 'Show unusual transactions', 'Find duplicate invoices', 'Explain this balance sheet in simple English', 'Are the books balanced?'],
    speak: 'I cannot answer that from the books yet.',
  }
}

/** Questions that make sense on the current screen (spec 87, 1718). */
export function contextualPrompts(screen: string): string[] {
  if (screen.startsWith('/reports/pnl')) return ['Why did expenses increase?', 'What changed in gross margin?', 'Compare this quarter with last quarter']
  if (screen.startsWith('/reports/balance-sheet')) return ['Explain this balance sheet in simple English', 'Which company owes us the most money?']
  if (screen.startsWith('/reports/cash-flow') || screen.startsWith('/banking')) return ['How much cash do we have across the group?', 'Which company is consuming the most cash?']
  if (screen.startsWith('/parties')) return ['Who owes us money?', 'Who do we owe money to?', "Which customers haven't paid for 60 days?"]
  if (screen.startsWith('/sentinel')) return ['Show unusual transactions', 'Find duplicate invoices']
  if (screen.startsWith('/budgets')) return ['Which budget lines are overspent?', 'Why did marketing expense increase?']
  if (screen.startsWith('/approvals')) return ['What requires approval?', 'Show unusual transactions']
  if (screen.startsWith('/journals') || screen.startsWith('/ledger')) return ['Are the books balanced?', 'Show expenses above ₹1 lakh']
  return ['How much cash do we have across the group?', 'Are we profitable?', 'What payments are due this week?', 'Which company owes us the most money?', 'Show unusual transactions']
}
