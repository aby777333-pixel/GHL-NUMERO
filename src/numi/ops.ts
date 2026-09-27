import Decimal from 'decimal.js'
import type { ID } from '@/engine/types'
import { advanceAge, advanceAgeing, advanceMemory, advanceOutstanding, assetReconciliation, bookValue, debtLadder, isOverdue, loanPosition } from '@/engine/ops'
import { cashHorizon, earlyWarnings, FIRM, openCommitments } from '@/engine/forward'
import { loadForward } from '@/lib/forwardData'
import { D, sum, ZERO } from '@/lib/money'
import { addDays, daysBetween, fmtDate, startOfMonth, today } from '@/lib/dates'
import type { NumiAnswer, NumiContext, NumiFact } from './engine'

// =====================================================================
// NUMI — operations. Questions about what surrounds the ledger:
// advances, claims, commitments, debt, deposits, assets, payroll, and
// what is coming.
//
//  * Same rules as the rest of NUMI: it reads through the person's own
//    authorised data layer, answers only from records, labels anything
//    that is not ACTUAL, and never acts.
//  * A refusal by the data layer is reported as a refusal. NUMI does not
//    work around a permission, and it does not say whether records exist.
//    The live database answers an unauthorised read with no rows rather
//    than an error, so an empty list proves nothing: the permission is
//    checked first and "none recorded" is said only to a person who may look.
//  * Payroll answers are totals. NUMI never states an individual salary.
//  * Patterns about a person are facts for review, never a conclusion
//    about anyone's conduct.
// =====================================================================

type Ans = Omit<NumiAnswer, 'intent' | 'scope'>
const blank = { facts: [] as NumiFact[], evidence: [] as { label: string; to: string }[], assumptions: [] as string[], followUps: [] as string[], basis: 'FACT' as const, truth: 'ACTUAL' as const }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const refused = (what: string, perm: string): Ans => ({
  ...blank, basis: 'FACT',
  headline: `You are not authorised to see ${what}.`,
  narrative: `That information needs the ${perm} permission in the selected companies. I answer only from what your account may read, and I cannot say whether such records exist.`,
  followUps: ['How much cash do we have across the group?', 'What requires approval?'],
  speak: `You are not authorised to see ${what}.`,
})

export async function askOps(question: string, c: NumiContext, scope: { ids: ID[]; label: string }): Promise<(Ans & { intent: string; scope: string }) | null> {
  const t = question.toLowerCase()
  const M = c.money
  const all = scope.ids
  const asOf = today()
  /** the selected companies in which this person holds the permission */
  const idsFor = (perm: string) => (c.can ? all.filter((id) => c.can!(perm, id)) : all)
  /** expense records are readable by viewers and approvers; a person who may only create reads the records they entered */
  const expenseIds = () => { const seen = all.filter((id) => !c.can || c.can('expense.view', id) || c.can('expense.approve', id)); return seen.length ? { ids: seen, ownOnly: false } : { ids: idsFor('expense.create'), ownOnly: !!c.can } }
  const OWN_ONLY = 'Your role lets you enter expenses, not view them all: only the records you entered yourself are counted.'
  const leftOut = (ids: ID[], perm: string) => (ids.length < all.length ? [`${all.length - ids.length} of the ${all.length} selected companies are not included: your role there does not include ${perm}.`] : [])
  const party = (id: ID | null | undefined) => (id ? c.parties.find((p) => p.id === id)?.display_name ?? 'a party not shared with you' : '—')
  const company = (id: ID) => c.companies.find((x) => x.id === id)?.name ?? ''
  const out = (intent: string, a: Ans, period?: string) => ({ ...a, intent, scope: period ? `${scope.label} · ${period}` : `${scope.label} · as at ${fmtDate(asOf)}` })
  const named = c.parties.filter((p) => p.display_name.length > 3 && t.includes(p.display_name.toLowerCase())).sort((a, b) => b.display_name.length - a.display_name.length)[0]

  // ---------------------------------------------------------------- advances
  if (/\badvances?\b/.test(t) && !/\b(customer|vendor|supplier) advances?\b|\badvance tax\b/.test(t)) {
    const { ids, ownOnly } = expenseIds()
    if (!ids.length) return out('advances', refused('advances', 'expense.view'))
    let advances, claims
    try { [advances, claims] = await Promise.all([c.api.listAdvances({ companyIds: ids }), c.api.listClaims({ companyIds: ids })]) } catch { return out('advances', refused('advances', 'expense.view')) }
    if (named) {
      const mine = advances.filter((a) => a.recipient_party_id === named.id)
      const memory = advanceMemory(advances, claims, named.id, asOf)
      const held = sum(mine.map((a) => advanceOutstanding(a)))
      return out('advance_memory', {
        ...blank,
        headline: mine.length ? `${named.display_name} holds ${M(held, false)} in unsettled advances.` : `No advance is recorded for ${named.display_name}.`,
        narrative: 'This is what the records show. An advance is money held by a person, not an expense; it becomes an expense only through an approved settlement.',
        facts: [
          ...memory.map((m) => ({ label: m.kind.replace(/_/g, ' '), text: m.text, to: m.advance_id ? '/expenses/advances/' + m.advance_id : undefined, tone: m.kind === 'clean' || m.kind === 'none' ? 'pos' as const : 'warn' as const })),
          ...mine.slice(-6).map((a) => ({ label: `${a.advance_no} · ${a.purpose}`, amount: advanceOutstanding(a), note: `${a.status.replace(/_/g, ' ')} · released ${M(a.released_amount, false)}`, to: '/expenses/advances/' + a.id })),
        ],
        assumptions: ['Only advances in the selected companies are counted.', 'These are facts for a person to review. They are not a conclusion about anyone.', ...(ownOnly ? [OWN_ONLY] : leftOut(ids, 'expense.view'))],
        evidence: [{ label: 'Open the party', to: '/parties/' + named.id }, { label: 'Unsettled advances', to: '/expenses?tab=unsettled' }],
        followUps: ['Who holds unsettled advances?', 'Which advances are overdue?'],
        speak: mine.length ? `${named.display_name} holds ${M(held)} in unsettled advances.` : `No advance is recorded for ${named.display_name}.`,
      })
    }
    const age = advanceAgeing(advances, asOf)
    const open = advances.filter((a) => advanceOutstanding(a).gt(0))
    const late = /\b(overdue|late|past|not settled|unsettled for)\b/.test(t)
    const list = (late ? age.overdue : open).sort((a, b) => advanceOutstanding(b).cmp(advanceOutstanding(a)))
    const waiting = advances.filter((a) => a.status === 'requested')
    return out('advances', {
      ...blank,
      headline: late
        ? (age.overdue.length ? `${plural(age.overdue.length, 'advance is', 'advances are')} past the expected settlement date, totalling ${M(sum(age.overdue.map((a) => advanceOutstanding(a))), false)}.` : 'No advance is past its expected settlement date.')
        : (age.count ? `${M(age.total, false)} is held in ${plural(age.count, 'unsettled advance')}.` : 'No advance is unsettled.'),
      narrative: 'An advance is money held by a person. It is not an expense until an approved settlement says so, and it is not counted in the Profit & Loss.',
      facts: [
        ...age.buckets.filter((b) => b.count).map((b) => ({ label: `Held for ${b.label}`, amount: b.amount, note: plural(b.count, 'advance'), to: '/expenses?tab=unsettled' })),
        ...list.slice(0, 6).map((a) => ({ label: `${party(a.recipient_party_id)} · ${a.advance_no}`, amount: advanceOutstanding(a), to: '/expenses/advances/' + a.id, tone: isOverdue(a, asOf) ? 'warn' as const : undefined,
          note: `${a.purpose} · held ${advanceAge(a, asOf)} days${a.expected_settlement_date ? ` · settle by ${fmtDate(a.expected_settlement_date)}` : ' · no settlement date'}${claims.some((k) => k.advance_id === a.id && !['draft', 'rejected', 'cancelled'].includes(k.status)) ? '' : ' · no claim submitted'}` })),
        ...(waiting.length ? [{ label: 'Requests awaiting approval', text: String(waiting.length), to: '/approvals' }] : []),
      ],
      assumptions: ['Unsettled = released − settled by approved claims − returned.', 'Age is counted from the release date.', ...(ownOnly ? [OWN_ONLY] : leftOut(ids, 'expense.view'))],
      evidence: [{ label: 'Unsettled advances', to: '/expenses?tab=unsettled' }, { label: 'All advances', to: '/expenses?tab=advances' }],
      followUps: ['Which advances are overdue?', 'Which expense claims are waiting?'],
      speak: age.count ? `${M(age.total)} is held in ${age.count} unsettled advances.` : 'No advance is unsettled.',
    })
  }

  // ---------------------------------------------------------------- expense claims / reimbursements
  if (/\b(expense )?claims?\b|\breimburs\w*/.test(t) && !/\b(legal|insurance|warranty) claims?\b/.test(t)) {
    const { ids, ownOnly } = expenseIds()
    if (!ids.length) return out('claims', refused('expense claims', 'expense.view'))
    let claims
    try { claims = await c.api.listClaims({ companyIds: ids }) } catch { return out('claims', refused('expense claims', 'expense.view')) }
    const waiting = claims.filter((k) => k.status === 'submitted')
    const payable = claims.filter((k) => k.status === 'posted' && D(k.payable).gt(0))
    const flagged = waiting.filter((k) => k.flagged_lines > 0)
    return out('claims', {
      ...blank,
      headline: `${plural(waiting.length, 'claim is', 'claims are')} waiting for approval; ${M(sum(payable.map((k) => k.payable)), false)} is payable to employees.`,
      narrative: 'Approval, accounting and payment are separate events: a claim is approved, its entry is approved and posted, and only then is the reimbursement paid.',
      facts: [
        { label: 'CLAIM PENDING — awaiting approval', amount: sum(waiting.map((k) => k.total)), note: plural(waiting.length, 'claim'), to: '/expenses?tab=claims' },
        { label: 'PAYABLE — approved and posted, not yet paid', amount: sum(payable.map((k) => k.payable)), note: plural(payable.length, 'claim'), to: '/expenses?tab=claims' },
        ...(flagged.length ? [{ label: 'Waiting claims with policy flags', text: String(flagged.length), note: 'A flag informs the approver. It never rejects a claim.', tone: 'warn' as const, to: '/expenses?tab=claims' }] : []),
        ...[...waiting, ...payable].slice(0, 6).map((k) => ({ label: `${party(k.claimant_party_id)} · ${k.claim_no}`, amount: k.status === 'posted' ? k.payable : k.total, note: `${k.title} · ${k.status === 'posted' ? 'payable' : 'awaiting approval'}`, to: '/expenses/claims/' + k.id })),
      ],
      assumptions: ownOnly ? [OWN_ONLY] : leftOut(ids, 'expense.view'),
      evidence: [{ label: 'Expense claims', to: '/expenses?tab=claims' }, { label: 'Approval inbox', to: '/approvals' }],
      followUps: ['Who holds unsettled advances?', 'What requires approval?'],
      speak: `${waiting.length} claims are waiting for approval.`,
    })
  }

  // ---------------------------------------------------------------- commitments / purchase orders
  if (/\b(un)?commit(ted|ments?)\b|\bpurchase orders?\b|\bopen (orders?|pos?)\b|\bordered but not\b/.test(t)) {
    const ids = idsFor('purchase.view')
    if (!ids.length) return out('commitments', refused('purchasing records', 'purchase.view'))
    let docs, bills
    try { [docs, bills] = await Promise.all([c.api.listPurchaseDocs({ companyIds: ids }), c.api.listInvoices({ companyIds: ids, docTypes: ['purchase_bill'] })]) } catch { return out('commitments', refused('purchasing records', 'purchase.view')) }
    const billsSeen = !c.can || ids.every((id) => c.can!('bill.view', id))
    const open = openCommitments(docs, bills).sort((a, b) => b.openBase.cmp(a.openBase))
    const total = sum(open.map((o) => o.openBase))
    const waiting = docs.filter((d) => (d.kind === 'purchase_order' || d.kind === 'requisition') && d.status === 'submitted')
    return out('commitments', {
      ...blank, truth: 'COMMITTED',
      headline: open.length ? `${M(total, false)} is committed on ${plural(open.length, 'open purchase order')} and not yet billed.` : 'No purchase order has an unbilled balance.',
      narrative: 'An approved order is a commitment, not a cost. It is not in the Profit & Loss; it becomes a cost when the vendor\'s bill is approved.',
      facts: [
        ...open.slice(0, 8).map((o) => ({ label: `${party(o.po.party_id)} · ${o.po.doc_no}`, amount: o.openBase, note: `${o.po.title ?? 'Purchase order'} · ordered ${M(o.ordered, false)} · billed ${M(o.billed, false)} · ${o.po.status.replace(/_/g, ' ')}`, to: '/purchasing/' + o.po.id })),
        ...(waiting.length ? [{ label: 'Requisitions and orders awaiting approval', text: String(waiting.length), amount: sum(waiting.map((w) => D(w.total).times(w.fx_rate))), to: '/approvals' }] : []),
      ],
      assumptions: ['Open commitment = ordered value − value already billed against the order, with tax in proportion.', 'Orders awaiting approval are not commitments and are shown separately.', ...(billsSeen ? [] : ['Your role does not include purchase bills in every company, so the billed part may be understated and the open commitment overstated.']), ...leftOut(ids, 'purchase.view')],
      evidence: [{ label: 'Commitments', to: '/purchasing?tab=commitments' }, { label: 'Purchase orders', to: '/purchasing?tab=purchase_order' }],
      followUps: ['What payments are due this week?', 'How much cash will we have in 30 days?'],
      speak: open.length ? `${M(total)} is committed on open purchase orders.` : 'No open commitments.',
    })
  }

  // ---------------------------------------------------------------- debt / loans
  if (/\b(loans?|debt|borrow\w*|emi|instal?ments?|repayments?)\b/.test(t) && !/\bcalculat|\bemi (on|for|of)\b/.test(t)) {
    const ids = idsFor('treasury.view')
    if (!ids.length) return out('debt', refused('loans', 'treasury.view'))
    let loans, schedule
    try { [loans, schedule] = await Promise.all([c.api.listLoans(ids), c.api.listLoanSchedule({ companyIds: ids })]) } catch { return out('debt', refused('loans', 'treasury.view')) }
    const taken = loans.filter((l) => l.status === 'active' && l.direction === 'borrowed')
    const given = loans.filter((l) => l.status === 'active' && l.direction === 'lent')
    const pos = taken.map((l) => ({ l, p: loanPosition(l, schedule, asOf) }))
    const owed = sum(pos.map((x) => x.p.outstanding))
    const ladder = debtLadder(loans, schedule, asOf).filter((b) => b.instalments)
    const overdue = sum(pos.map((x) => x.p.overdueAmount))
    return out('debt', {
      ...blank,
      headline: taken.length ? `${M(owed, false)} of principal is outstanding on ${plural(taken.length, 'loan')}; ${M(sum(pos.map((x) => x.p.dueIn30)), false)} falls due within 30 days.` : 'No active borrowing is recorded.',
      narrative: overdue.gt(0) ? `${M(overdue, false)} of instalments are past their due date and not recorded as paid.` : undefined,
      facts: [
        ...pos.map(({ l, p }) => ({ label: `${l.loan_no} · ${l.name}`, amount: p.outstanding, to: '/treasury/loans/' + l.id, tone: p.overdue.length ? 'warn' as const : undefined,
          note: `${party(l.party_id)} · ${String(l.rate_pct)}% ${l.rate_type}${p.next ? ` · next ${M(p.next.total, false)} on ${fmtDate(p.next.due_date)}` : ''}${p.overdue.length ? ` · ${plural(p.overdue.length, 'instalment')} overdue` : ''}` })),
        ...ladder.map((b) => ({ label: `Principal falling due: ${b.label.toLowerCase()}`, amount: b.principal, note: `${plural(b.instalments, 'instalment')} · interest ${M(b.interest, false)} per schedule` })),
        ...(given.length ? [{ label: 'Loans given to others (an asset, not debt)', amount: sum(given.map((l) => loanPosition(l, schedule, asOf).outstanding)), note: plural(given.length, 'loan'), to: '/treasury?tab=loans' }] : []),
      ],
      assumptions: ['Outstanding = disbursed − principal repaid, from posted entries.', 'Future interest follows the recorded schedule; on a floating-rate loan it is indicative.', 'Loans classified above your clearance are not shown to you and are not in these figures.', ...leftOut(ids, 'treasury.view')],
      evidence: [{ label: 'Treasury — loans', to: '/treasury?tab=loans' }],
      followUps: ['How much cash will we have in 30 days?', 'Show fixed deposits'],
      speak: taken.length ? `${M(owed)} of principal is outstanding on ${taken.length} loans.` : 'No active borrowing is recorded.',
    })
  }

  // ---------------------------------------------------------------- fixed deposits
  if (/\b(fixed )?deposits?\b|\bfds?\b|\bmatur\w+/.test(t) && !/\bsecurity deposit|\bcustomer deposit/.test(t)) {
    const ids = idsFor('treasury.view')
    if (!ids.length) return out('deposits', refused('fixed deposits', 'treasury.view'))
    let fds
    try { fds = await c.api.listFixedDeposits(ids) } catch { return out('deposits', refused('fixed deposits', 'treasury.view')) }
    const active = fds.filter((f) => f.status === 'active').sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))
    const soon = active.filter((f) => daysBetween(asOf, f.maturity_date) <= 30)
    const lien = active.filter((f) => f.lien_marked)
    return out('deposits', {
      ...blank,
      headline: active.length ? `${M(sum(active.map((f) => f.principal)), false)} is held in ${plural(active.length, 'fixed deposit')}${soon.length ? `; ${plural(soon.length, 'matures', 'mature')} within 30 days` : ''}.` : 'No active fixed deposit is recorded.',
      narrative: lien.length ? `${M(sum(lien.map((f) => f.principal)), false)} is under lien and is not freely available.` : undefined,
      facts: active.slice(0, 8).map((f) => ({ label: `${f.fd_no} · ${f.bank_name}`, amount: f.principal, to: '/treasury?tab=deposits&deposit=' + f.id, tone: daysBetween(asOf, f.maturity_date) <= 30 ? 'warn' as const : undefined,
        note: `${String(f.rate_pct)}% · matures ${fmtDate(f.maturity_date)} (${daysBetween(asOf, f.maturity_date)} days)${f.lien_marked ? ' · UNDER LIEN' : ''}${f.auto_renew ? ' · renews automatically' : ''} · ${company(f.company_id)}` })),
      assumptions: ['Principal is the amount placed. The maturity value is calculated from the recorded rate and is confirmed only by the bank.', ...leftOut(ids, 'treasury.view')],
      evidence: [{ label: 'Treasury — deposits', to: '/treasury?tab=deposits' }],
      followUps: ['How much debt do we have?', 'How much cash do we have across the group?'],
      speak: active.length ? `${M(sum(active.map((f) => f.principal)))} is held in fixed deposits.` : 'No active fixed deposit is recorded.',
    })
  }

  // ---------------------------------------------------------------- fixed assets / depreciation
  if (/\b(fixed )?assets?\b.*\b(register|book value|worth|own|list)\b|\bbook value\b|\bdepreciat\w+|\bfixed assets?\b|\basset register\b/.test(t)) {
    const ids = idsFor('asset.view')
    if (!ids.length) return out('assets', refused('the fixed asset register', 'asset.view'))
    let assets, cats, runs
    try { [assets, cats, runs] = await Promise.all([c.api.listAssets(ids), c.api.listAssetCategories(ids), c.api.listDepreciationRuns(ids)]) } catch { return out('assets', refused('the fixed asset register', 'asset.view')) }
    const active = assets.filter((a) => a.status === 'active')
    const cost = sum(active.map((a) => a.cost)), acc = sum(active.map((a) => a.accumulated_depreciation)), net = sum(active.map((a) => bookValue(a)))
    const rec = assetReconciliation(assets, cats, await c.api.ledgerBalances(ids, '1990-01-01', asOf), c.accounts).filter((r) => !D(r.difference).isZero())
    const posted = runs.filter((r) => r.status === 'posted').sort((a, b) => b.period_month.localeCompare(a.period_month))
    const waiting = runs.filter((r) => r.status === 'proposed' || r.status === 'draft')
    const byCat = cats.map((k) => ({ k, rows: active.filter((a) => a.category_id === k.id) })).filter((x) => x.rows.length).sort((a, b) => sum(b.rows.map(bookValue)).cmp(sum(a.rows.map(bookValue))))
    return out('assets', {
      ...blank,
      headline: active.length ? `${plural(active.length, 'asset')} in the register, with a book value of ${M(net, false)}.` : 'The fixed asset register is empty.',
      narrative: rec.length ? `The register and the ledger disagree on ${plural(rec.length, 'ledger')}. The difference is shown, not hidden.` : active.length ? 'The register agrees with the ledger.' : undefined,
      facts: [
        { label: 'Cost', amount: cost, to: '/assets' }, { label: 'Accumulated depreciation', amount: acc, to: '/assets?tab=depreciation' }, { label: 'Book value', amount: net, to: '/assets' },
        ...byCat.slice(0, 5).map((x) => ({ label: x.k.name, amount: sum(x.rows.map(bookValue)), note: `${plural(x.rows.length, 'asset')} · book value` })),
        ...(posted[0] ? [{ label: 'Last month depreciated', text: fmtDate(posted[0].period_month).replace(/^\d+\s/, ''), amount: posted[0].total, to: '/assets?tab=depreciation' }] : []),
        ...(waiting.length ? [{ label: 'Depreciation runs not yet posted', text: String(waiting.length), tone: 'warn' as const, to: '/assets?tab=depreciation' }] : []),
        ...rec.slice(0, 3).map((r) => ({ label: `Register and ledger differ: ${r.name}`, amount: r.difference, tone: 'neg' as const, to: '/assets?tab=reconciliation' })),
      ],
      assumptions: ['Book value = cost − accumulated depreciation, from the asset register.', ...leftOut(ids, 'asset.view')],
      evidence: [{ label: 'Fixed assets', to: '/assets' }, { label: 'Register and ledger', to: '/assets?tab=reconciliation' }],
      followUps: ['Explain this balance sheet in simple English', 'Are the books balanced?'],
      speak: active.length ? `${active.length} assets with a book value of ${M(net)}.` : 'The fixed asset register is empty.',
    })
  }

  // ---------------------------------------------------------------- payroll (totals only)
  if (/\bpayroll\b|\bsalar(y|ies)\b|\bpeople cost\b|\bheadcount\b|\bwage/.test(t)) {
    if (named || /\b(how much|what) (does|is|do)\b.*\b(earn|paid|salary of|make)\b|\bsalary of\b|\bwho (earns|is paid)\b|\bhighest paid\b/.test(t)) {
      return out('payroll_private', {
        ...blank, basis: 'FACT',
        headline: 'I do not state what an individual is paid.',
        narrative: 'Salary records are restricted. A person who is authorised can see them on the payroll screens, where each view is governed by their permissions. I can give payroll totals.',
        evidence: [{ label: 'Payroll', to: '/payroll' }], followUps: ['What was the payroll cost last month?'],
        speak: 'I do not state what an individual is paid.',
      })
    }
    const ids = idsFor('payroll.view')
    if (!ids.length) return out('payroll', refused('payroll', 'payroll.view'))
    let runs
    try { runs = await c.api.listPayrollRuns(ids) } catch { return out('payroll', refused('payroll', 'payroll.view')) }
    const done = runs.filter((r) => r.status === 'posted' || r.status === 'paid').sort((a, b) => b.period_month.localeCompare(a.period_month))
    const last = done[0]
    const month = last ? done.filter((r) => r.period_month === last.period_month) : []
    const cost = sum(month.map((r) => D(r.gross).plus(r.employer_cost)))
    const unpaid = done.filter((r) => r.status === 'posted')
    const open = runs.filter((r) => r.status === 'draft' || r.status === 'proposed')
    const left = month.reduce((n, r) => n + r.exceptions.length, 0)
    return out('payroll', {
      ...blank,
      headline: last ? `Payroll for ${fmtDate(last.period_month).replace(/^\d+\s/, '')} cost ${M(cost, false)} for ${plural(month.reduce((n, r) => n + r.headcount, 0), 'person', 'people')}.` : 'No payroll run has been posted.',
      narrative: 'These are totals. The payroll journal is confidential and is charged by department; no individual salary appears in the general ledger.',
      facts: last ? [
        { label: 'Gross pay', amount: sum(month.map((r) => r.gross)), to: '/payroll/runs/' + last.id },
        { label: 'Employer cost on top', amount: sum(month.map((r) => r.employer_cost)) },
        { label: 'Deductions and recoveries', amount: sum(month.map((r) => r.deductions)) },
        { label: 'Net pay', amount: sum(month.map((r) => r.net)) },
        ...(unpaid.length ? [{ label: 'Salaries payable — posted, not yet paid', amount: sum(unpaid.map((r) => r.net)), tone: 'warn' as const, to: '/payroll' }] : []),
        ...(open.length ? [{ label: 'Runs not yet posted', text: String(open.length), to: '/payroll' }] : []),
        ...(left ? [{ label: 'People not included in the run', text: String(left), note: 'Each is listed on the run with the reason.', tone: 'warn' as const, to: '/payroll/runs/' + last.id }] : []),
      ] : [],
      assumptions: ['Cost = gross pay + employer cost, from posted payroll runs.', ...leftOut(ids, 'payroll.view')],
      evidence: [{ label: 'Payroll', to: '/payroll' }, { label: 'People cost', to: '/people-cost' }],
      followUps: ['How much cash will we have in 30 days?', 'Why did employee cost increase?'],
      speak: last ? `Payroll cost ${M(cost)}.` : 'No payroll run has been posted.',
    }, last ? `payroll month ${fmtDate(startOfMonth(last.period_month))}` : undefined)
  }

  // ---------------------------------------------------------------- follow-ups
  if (/\bfollow[- ]?ups?\b|\btasks?\b|\bto[- ]?do\b/.test(t)) {
    const tasks = (await c.api.listTasks({ companyIds: all })).filter((k) => k.status === 'open' || k.status === 'in_progress')
    const late = tasks.filter((k) => k.due_date && k.due_date < asOf)
    return out('tasks', {
      ...blank,
      headline: tasks.length ? `${plural(tasks.length, 'follow-up is', 'follow-ups are')} open; ${late.length} past the due date.` : 'No follow-up is open.',
      facts: [...late, ...tasks.filter((k) => !late.includes(k))].slice(0, 8).map((k) => ({ label: k.title, text: k.due_date ? `due ${fmtDate(k.due_date)}` : 'no due date', note: [k.owner_name, k.priority].filter(Boolean).join(' · '), tone: late.includes(k) ? 'warn' as const : undefined, to: '/tasks' })),
      evidence: [{ label: 'Follow-ups', to: '/tasks' }], followUps: ['What requires approval?'],
      speak: `${tasks.length} follow-ups are open.`,
    })
  }

  // ---------------------------------------------------------------- looking ahead
  const ahead = /\b(forecast|run(ning)? (out|short)|shortfall|runway|what is coming|upcoming|coming up|next \d+ days|in \d+ days|next (week|month|quarter|year)|renew\w*|expir\w+|obligations?|early warning|cash (position )?(in|after|by)\b|(need|have|will we) .*\bnext (week|month|quarter))/.test(t)
  if (ahead) {
    const f = await loadForward(c.api, all, c.accounts, 1826, c.can)
    const days = Math.min(1826, Math.max(1, Number(t.match(/(\d+)\s*days?/)?.[1] ?? (/\bweek\b/.test(t) ? 7 : /\bnext month\b/.test(t) ? 61 : /\bquarter\b/.test(t) ? 90 : /\byear\b/.test(t) ? 365 : 30))))
    const until = addDays(asOf, days)
    const warnings = earlyWarnings({ ...f.input, events: f.events, openingCash: f.openingCash, documents: f.documents, partyName: party })
    const gaps = f.missing.length ? [`Not included, because your account may not read them in every selected company: ${f.missing.join(', ')}.`] : []

    if (/\brenew\w*\b|\bexpir\w+/.test(t)) {
      const kinds = ['renewal', 'insurance_expiry', 'guarantee_expiry', 'subscription_renewal', 'document_expiry', 'deposit_maturity', 'tax_deadline']
      const list = warnings.filter((w) => kinds.includes(w.kind)).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      return out('renewals', {
        ...blank, truth: 'FORECAST', basis: 'FACT',
        headline: list.length ? `${plural(list.length, 'renewal or expiry')} need attention.` : 'No renewal or expiry is close.',
        facts: list.slice(0, 10).map((w) => ({ label: w.title, text: w.date ? fmtDate(w.date) : undefined, amount: w.amount, note: w.detail, to: w.link, tone: w.level === 'critical' || w.level === 'priority' ? 'neg' as const : 'warn' as const })),
        assumptions: ['Dates are those recorded on the register items, documents and deposits.', ...gaps],
        evidence: [{ label: 'Forward', to: '/forward' }, { label: 'Registers', to: '/registers' }], followUps: ['How much cash will we have in 30 days?'],
        speak: list.length ? `${list.length} renewals or expiries need attention.` : 'No renewal or expiry is close.',
      })
    }

    const within = f.events.filter((e) => e.date <= until && e.certainty !== 'CONTINGENT')
    const firm = within.filter((e) => FIRM.includes(e.certainty))
    const tot = (xs: typeof within, d: 'in' | 'out') => sum(xs.filter((e) => e.direction === d).map((e) => e.amount))
    const projected = f.openingCash.plus(tot(within, 'in')).minus(tot(within, 'out'))
    const projectedFirm = f.openingCash.plus(tot(firm, 'in')).minus(tot(firm, 'out'))
    const row = cashHorizon(f.events, f.openingCash, asOf).find((h) => h.until >= until)
    const contingent = sum(f.events.filter((e) => e.date <= until && e.certainty === 'CONTINGENT').map((e) => e.amount))
    const biggest = within.filter((e) => e.direction === 'out').sort((a, b) => b.amount.cmp(a.amount)).slice(0, 4)
    const top = warnings.filter((w) => w.level === 'critical' || w.level === 'priority').slice(0, 3)
    const short = projected.lt(0) || projectedFirm.lt(0)
    return out('cash_ahead', {
      ...blank, truth: 'FORECAST', basis: 'INFERENCE',
      headline: `If everything recorded happens on its date, cash in ${days} days would be ${M(projected, false)}.`,
      narrative: `${short ? 'On these records cash would fall below zero. ' : ''}Counting only what is due, contracted, committed or scheduled, it would be ${M(projectedFirm, false)}. This is a projection from recorded documents and registers, not a prediction.`,
      facts: [
        { label: 'Cash and bank today — ACTUAL', amount: f.openingCash, to: '/banking' },
        { label: `Inflows to ${fmtDate(until)} — firm`, amount: tot(firm, 'in'), tone: 'pos', to: '/forward' },
        { label: 'Inflows — expected, probable or possible', amount: tot(within, 'in').minus(tot(firm, 'in')), note: 'Not firm. Shown separately on purpose.', to: '/forward' },
        { label: `Outflows to ${fmtDate(until)} — firm`, amount: tot(firm, 'out'), tone: 'neg', to: '/forward' },
        { label: 'Outflows — expected, probable or possible', amount: tot(within, 'out').minus(tot(firm, 'out')), to: '/forward' },
        { label: 'Projected cash — FORECAST', amount: projected, tone: projected.lt(0) ? 'neg' : undefined, note: row ? `Confidence ${row.confidence}. ${row.confidenceWhy}` : undefined, to: '/forward' },
        ...(contingent.gt(0) ? [{ label: 'CONTINGENT — not in the projection', amount: contingent, note: 'Guarantees, claims and disputes that may or may not become payable.', tone: 'warn' as const, to: '/registers' }] : []),
        ...biggest.map((e) => ({ label: `Largest outflow: ${e.label}`, amount: e.amount, note: `${fmtDate(e.date)} · ${e.certainty}`, to: e.link })),
        ...top.map((w) => ({ label: w.title, text: w.date ? fmtDate(w.date) : undefined, note: w.detail, tone: 'neg' as const, to: w.link ?? '/forward' })),
      ],
      assumptions: ['Overdue items are assumed to move today.', 'Receipts are placed on their due dates, not on the dates customers usually pay.', 'Nothing that is not recorded is included: no new sales, no new purchases.', ...gaps],
      evidence: [{ label: 'Forward', to: '/forward' }], followUps: ['Which renewals are coming up?', 'What payments are due this week?', 'How much debt do we have?'],
      speak: `Projected cash in ${days} days is ${M(projected)}. This is a forecast.`,
    }, `today to ${fmtDate(until)}`)
  }

  return null
}

/** Questions NUMI can answer about operations; shown with the honest fallback. */
export const OPS_PROMPTS = ['Who holds unsettled advances?', 'Which expense claims are waiting?', 'How much is committed on purchase orders?', 'How much debt do we have?', 'Show fixed deposits', 'What is the book value of our assets?', 'What was the payroll cost last month?', 'How much cash will we have in 30 days?', 'Which renewals are coming up?']

export function opsPrompts(screen: string): string[] | null {
  if (screen.startsWith('/expenses')) return ['Who holds unsettled advances?', 'Which advances are overdue?', 'Which expense claims are waiting?']
  if (screen.startsWith('/purchasing')) return ['How much is committed on purchase orders?', 'What payments are due this week?']
  if (screen.startsWith('/treasury') || screen.startsWith('/cash')) return ['How much debt do we have?', 'Show fixed deposits', 'How much cash will we have in 30 days?']
  if (screen.startsWith('/assets')) return ['What is the book value of our assets?', 'Are the books balanced?']
  if (screen.startsWith('/payroll') || screen.startsWith('/people-cost')) return ['What was the payroll cost last month?', 'How much cash will we have in 30 days?']
  if (screen.startsWith('/forward') || screen.startsWith('/registers')) return ['How much cash will we have in 30 days?', 'Which renewals are coming up?', 'How much is committed on purchase orders?']
  if (screen.startsWith('/tasks') || screen.startsWith('/inbox')) return ['Which follow-ups are open?', 'Which renewals are coming up?']
  return null
}

export type { Decimal }
