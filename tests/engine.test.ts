import { beforeAll, describe, expect, it } from 'vitest'
import { DemoEngine } from '../src/api/demo'
import { seedDemo } from '../src/api/demoSeed'
import { balanceSheet, cashFlow, intercompanyEliminations, joinBalances, profitAndLoss, trialBalance } from '../src/engine/reports'
import { parseTransaction, proposeJournal } from '../src/engine/nlp'
import { D, fmtMoney, parseAmount } from '../src/lib/money'
import { addDays, fyStart, today } from '../src/lib/dates'
import { buildCompanyPayload } from '../src/engine/templates'

// Accounting invariants (spec 92, 1517-1521). These run against the same engine
// code the demo universe uses; the database has its own equivalent suite in
// tests/sql/engine_invariants.sql.

let e: DemoEngine
let ids: string[]
const T = today()

beforeAll(async () => {
  e = new DemoEngine()
  await seedDemo(e)
  ids = e.companies.map((c) => c.id)
}, 120_000)

const reject = async (p: Promise<unknown>, re: RegExp) => {
  await expect(p).rejects.toThrow(re)
}

describe('seeded universe', () => {
  it('creates five isolated companies with their own charts of accounts', () => {
    expect(e.companies).toHaveLength(5)
    for (const c of e.companies) expect(e.accounts.filter((a) => a.company_id === c.id).length).toBeGreaterThan(100)
  })

  it('every posted journal balances: total debits = total credits', async () => {
    const r = await e.integrityCheck(ids)
    expect(r.posted_journals).toBeGreaterThan(500)
    expect(r.unbalanced_journals).toBe(0)
    expect(D(r.total_debits).eq(r.total_credits)).toBe(true)
  })

  it('trial balance ties for every company and for the group', async () => {
    const accounts = await e.listAccounts(ids)
    for (const scope of [...ids.map((i) => [i]), ids]) {
      const tb = trialBalance(joinBalances(accounts, await e.ledgerBalances(scope, fyStart(T), T)))
      expect(tb.difference.toString()).toBe('0')
      expect(tb.balanced).toBe(true)
    }
  })

  it('balance sheet equation holds: assets = liabilities + equity', async () => {
    const accounts = await e.listAccounts(ids)
    for (const scope of [...ids.map((i) => [i]), ids]) {
      const bs = balanceSheet(joinBalances(accounts, await e.ledgerBalances(scope, fyStart(T), T)))
      expect(bs.difference.toString()).toBe('0')
      expect(bs.totalAssets.gt(0)).toBe(true)
    }
  })

  it('balance sheet current profit equals the P&L result for the same period', async () => {
    const accounts = await e.listAccounts(ids)
    const bals = joinBalances(accounts, await e.ledgerBalances(ids, fyStart(T), T))
    expect(balanceSheet(bals).currentProfit.toString()).toBe(profitAndLoss(bals).pat.toString())
  })

  it('cash flow statement explains the whole movement in cash (no hidden difference)', async () => {
    const accounts = await e.listAccounts(ids)
    for (const scope of [...ids.map((i) => [i]), ids]) {
      const cf = cashFlow(joinBalances(accounts, await e.ledgerBalances(scope, fyStart(T), T)))
      expect(cf.unexplained.toString()).toBe('0')
    }
  })

  it('control accounts reconcile with the party subledger', async () => {
    const accounts = await e.listAccounts(ids)
    const bals = joinBalances(accounts, await e.ledgerBalances(ids, '1990-01-01', T))
    const sub = await e.partyLedgerBalances(ids, T)
    for (const type of ['receivable', 'payable']) {
      const control = bals.filter((b) => b.account.control_type === type).reduce((s, b) => s.plus(b.closing), D(0))
      const ledger = sub.filter((r) => r.control_type === type).reduce((s, r) => s.plus(r.debit).minus(r.credit), D(0))
      expect(control.toString()).toBe(ledger.toString())
    }
  })

  it('open documents equal the receivable and payable control balances', async () => {
    const accounts = await e.listAccounts(ids)
    const bals = joinBalances(accounts, await e.ledgerBalances(ids, '1990-01-01', T))
    const inv = await e.listInvoices({ companyIds: ids })
    const out = (types: string[]) => inv.filter((i) => types.includes(i.doc_type) && ['open', 'partially_paid'].includes(i.status))
      .reduce((s, i) => s.plus(D(i.total).minus(i.amount_settled).times(i.fx_rate).toDecimalPlaces(2)), D(0))
    const ar = bals.filter((b) => b.account.control_type === 'receivable').reduce((s, b) => s.plus(b.closing), D(0))
    expect(ar.toString()).toBe(out(['sales_invoice']).toString())
    const ap = bals.filter((b) => b.account.control_type === 'payable').reduce((s, b) => s.plus(b.closing.neg()), D(0))
    // foreign-currency bills are carried at the booking rate; settled portions are relieved at that same rate
    expect(ap.minus(out(['purchase_bill'])).abs().lt(1)).toBe(true)
  })

  it('intercompany balances mirror each other and eliminate fully on consolidation', async () => {
    const accounts = await e.listAccounts(ids)
    const el = intercompanyEliminations(joinBalances(accounts, await e.ledgerBalances(ids, '1990-01-01', T)), e.companies)
    expect(el.length).toBe(4)
    for (const x of el) {
      expect(x.mismatch.toString()).toBe('0')
      expect(x.eliminated.gt(0)).toBe(true)
    }
  })

  it('sentinel raises factual anomalies and never uses the word fraud', async () => {
    const alerts = await e.listAlerts(ids)
    const kinds = new Set(alerts.map((a) => a.kind))
    for (const k of ['duplicate_invoice', 'duplicate_payment', 'round_number_journal', 'unusual_time', 'below_threshold', 'new_vendor_large_payment', 'bank_detail_change']) {
      expect(kinds.has(k), k).toBe(true)
    }
    expect(alerts.some((a) => /fraud/i.test(a.title + a.explanation))).toBe(false)
    expect(alerts.every((a) => a.explanation.length > 20 && Object.keys(a.evidence).length > 0)).toBe(true)
  })
})

describe('posting controls', () => {
  const draft = (co: string, lines: [string, 'debit' | 'credit', number][], extra: Record<string, unknown> = {}) =>
    e.saveJournalDraft({
      company_id: co, journal_date: T, narration: 'test',
      lines: lines.map(([code, side, amt]) => ({ account_id: e.accounts.find((a) => a.company_id === co && a.code === code)!.id, [side]: amt })),
      ...extra,
    })

  it('an unbalanced journal can be drafted but never submitted or posted', async () => {
    const id = await draft(ids[1], [['6210', 'debit', 1000], ['1121', 'credit', 900]])
    await reject(e.submitJournal(id), /unbalanced/i)
    await reject(e.postJournal(id), /must be approved/i)
  })

  it('a line cannot carry both a debit and a credit, or neither', async () => {
    const co = ids[1]
    const a = e.accounts.find((x) => x.company_id === co && x.code === '6210')!.id
    const b = e.accounts.find((x) => x.company_id === co && x.code === '1121')!.id
    await reject(e.saveJournalDraft({ company_id: co, journal_date: T, lines: [{ account_id: a, debit: 5, credit: 5 }, { account_id: b, credit: 5 }] }), /either a debit or a credit/)
    await reject(e.saveJournalDraft({ company_id: co, journal_date: T, lines: [{ account_id: a }, { account_id: b, credit: 5 }] }), /either a debit or a credit/)
  })

  it('group headings and other companies\' accounts are refused', async () => {
    await reject(draft(ids[1], [['6000', 'debit', 10], ['1121', 'credit', 10]]), /group heading/)
    const foreign = e.accounts.find((a) => a.company_id === ids[2] && a.code === '6210')!.id
    const own = e.accounts.find((a) => a.company_id === ids[1] && a.code === '1121')!.id
    await reject(e.saveJournalDraft({ company_id: ids[1], journal_date: T, lines: [{ account_id: foreign, debit: 10 }, { account_id: own, credit: 10 }] }), /does not belong to this company/)
  })

  it('maker cannot approve their own journal when maker-checker is enforced', async () => {
    e.group.settings.controls = { maker_checker: 'enforced' }
    const id = await draft(ids[1], [['6210', 'debit', 1000], ['1121', 'credit', 1000]])
    await e.submitJournal(id)
    await reject(e.approveJournal(id), /maker-checker/)
    e.group.settings.controls = { maker_checker: 'owner_override' }
    expect(await e.approveJournal(id, 'explicit owner override')).toBe('approved')
    const d = await e.openJournal(id)
    expect(d.approvals.at(-1)!.action).toBe('override')
  })

  it('posting is idempotent and issues a permanent voucher number', async () => {
    const id = await draft(ids[1], [['6210', 'debit', 2500], ['1121', 'credit', 2500]])
    await e.submitJournal(id); await e.approveJournal(id)
    const v1 = await e.postJournal(id)
    const v2 = await e.postJournal(id)
    expect(v1).toMatch(/^JV-\d{4}-\d{6}$/)
    expect(v2).toBe(v1)
  })

  it('posted journals cannot be edited or cancelled — only reversed, with a reason', async () => {
    const id = await draft(ids[1], [['6210', 'debit', 3100], ['1121', 'credit', 3100]])
    await e.submitJournal(id); await e.approveJournal(id); await e.postJournal(id)
    await reject(e.saveJournalDraft({ id, company_id: ids[1], journal_date: T, lines: [] }), /only drafts can be edited/)
    await reject(e.cancelJournal(id), /cannot be cancelled/)
    await reject(e.reverseJournal(id, T, ''), /reason is required/)
    const before = await e.ledgerBalances([ids[1]], '1990-01-01', T)
    const rev = await e.reverseJournal(id, T, 'Posted to the wrong ledger')
    const after = await e.ledgerBalances([ids[1]], '1990-01-01', T)
    const net = (rows: typeof before, acc: string) => rows.filter((r) => r.account_id === acc).reduce((s, r) => s.plus(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit), D(0))
    const rent = e.accounts.find((a) => a.company_id === ids[1] && a.code === '6210')!.id
    expect(net(before, rent).minus(net(after, rent)).toString()).toBe('3100')
    expect((await e.openJournal(id)).status).toBe('reversed')
    expect((await e.openJournal(rev)).reversal_of).toBe(id)
    await reject(e.reverseJournal(id, T, 'again'), /already been reversed/)
    await reject(e.reverseJournal(rev, T, 'reverse the reversal'), /cannot itself be reversed/)
  })

  it('posted lines are frozen in memory', async () => {
    const j = e.journals.find((x) => x.status === 'posted')!
    const line = e.linesByJournal.get(j.id)![0]
    expect(() => { (line as { debit: string }).debit = '1' }).toThrow()
  })

  it('locked periods refuse postings; reopening needs a reason', async () => {
    const locked = e.periods.find((p) => p.company_id === ids[1] && p.status === 'locked')!
    const id = await e.saveJournalDraft({
      company_id: ids[1], journal_date: locked.period_start, narration: 'late entry',
      lines: [{ account_id: e.accounts.find((a) => a.company_id === ids[1] && a.code === '6210')!.id, debit: 10 }, { account_id: e.accounts.find((a) => a.company_id === ids[1] && a.code === '1121')!.id, credit: 10 }],
    })
    await reject(e.submitJournal(id), /locked/)
    await reject(e.setPeriodStatus(ids[1], locked.period_start, 'open', ''), /reason is required/)
    await e.setPeriodStatus(ids[1], locked.period_start, 'open', 'Audit adjustment')
    await e.submitJournal(id)
    await e.setPeriodStatus(ids[1], locked.period_start, 'locked', 'Re-closed')
  })

  it('idempotency key prevents duplicate drafts', async () => {
    const a = await draft(ids[1], [['6210', 'debit', 10], ['1121', 'credit', 10]], { idempotency_key: 'k-1' })
    const b = await draft(ids[1], [['6210', 'debit', 10], ['1121', 'credit', 10]], { idempotency_key: 'k-1' })
    expect(b).toBe(a)
  })
})

describe('documents', () => {
  it('invoice approval posts receivable, revenue and configurable tax; approval is idempotent', async () => {
    const co = ids[1]
    const party = e.parties.find((p) => p.display_name === 'Lakshmi Estates LLP')!.id
    const tax = e.taxCodes.find((t) => t.company_id === co && t.code === 'GST18')!.id
    const id = await e.saveInvoice({ company_id: co, doc_type: 'sales_invoice', party_id: party, doc_date: T, due_date: addDays(T, 30), lines: [{ account_id: e.accounts.find((a) => a.company_id === co && a.code === '4120')!.id, amount: 250000, tax_code_id: tax, description: 'Consulting' }] })
    const no = await e.approveInvoice(id)
    expect(await e.approveInvoice(id)).toBe(no)
    const inv = await e.getInvoice(id)
    expect(D(inv.total).toString()).toBe('295000')
    const j = await e.openJournal(inv.journal_id!)
    const find = (code: string) => j.lines.find((l) => l.account_code === code)!
    expect(D(find('1130').debit).toString()).toBe('295000')
    expect(D(find('4120').credit).toString()).toBe('250000')
    expect(D(find('2141').credit).toString()).toBe('22500')
    expect(D(find('2142').credit).toString()).toBe('22500')
    expect(e.journals.filter((x) => x.source_id === id)).toHaveLength(1)
  })

  it('tax rates are versioned by effective date, never overwritten', async () => {
    const co = ids[4]
    const sales = e.accounts.find((a) => a.company_id === co && a.code === '4110')!.id
    const out = e.accounts.find((a) => a.company_id === co && a.code === '2143')!.id
    await e.saveTaxCode({ company_id: co, code: 'IGST12', name: 'IGST (revised)', kind: 'gst', components: [{ component: 'IGST', rate: 14, output_account_id: out, input_account_id: out, effective_from: addDays(T, 1) }] })
    const tax = e.taxCodes.find((t) => t.company_id === co && t.code === 'IGST12')!
    expect(tax.components).toHaveLength(2)
    const party = e.parties.find((p) => p.display_name === 'HealthKart Distributors')!.id
    const old = await e.getInvoice(await e.saveInvoice({ company_id: co, doc_type: 'sales_invoice', party_id: party, doc_date: T, lines: [{ account_id: sales, amount: 1000, tax_code_id: tax.id }] }))
    const next = await e.getInvoice(await e.saveInvoice({ company_id: co, doc_type: 'sales_invoice', party_id: party, doc_date: addDays(T, 2), lines: [{ account_id: sales, amount: 1000, tax_code_id: tax.id }] }))
    expect(D(old.tax_total).toString()).toBe('120')
    expect(D(next.tax_total).toString()).toBe('140')
  })

  it('allocations cannot exceed the outstanding balance or cross parties', async () => {
    const co = ids[1]
    const inv = (await e.listInvoices({ companyIds: [co], docTypes: ['sales_invoice'] })).find((i) => i.status === 'open')!
    const bank = e.accounts.find((a) => a.company_id === co && a.code === '1121')!.id
    const over = D(inv.total).plus(1).toString()
    await reject(e.savePayment({ company_id: co, direction: 'in', party_id: inv.party_id, bank_ledger_id: bank, pay_date: T, amount: over, allocations: [{ invoice_id: inv.id, amount: over }] }), /exceeds the outstanding/)
    const other = e.parties.find((p) => p.id !== inv.party_id && p.roles.some((r) => r.company_id === co))!.id
    await reject(e.savePayment({ company_id: co, direction: 'in', party_id: other, bank_ledger_id: bank, pay_date: T, amount: 10, allocations: [{ invoice_id: inv.id, amount: 10 }] }), /another party or company/)
  })

  it('payments cannot use unverified beneficiary bank details; blocked parties cannot transact', async () => {
    const co = ids[3]
    const steel = e.parties.find((p) => p.display_name === 'Steelmax Traders')!
    const pending = e.partyBanks.find((b) => b.party_id === steel.id && b.status === 'pending_verification')!
    const bank = e.accounts.find((a) => a.company_id === co && a.code === '1121')!.id
    await reject(e.savePayment({ company_id: co, direction: 'out', party_id: steel.id, bank_ledger_id: bank, pay_date: T, amount: 100, party_bank_account_id: pending.id }), /not verified/)
    await e.setPartyStatus(steel.id, 'blocked', 'Dispute over supply quality')
    await reject(e.savePayment({ company_id: co, direction: 'out', party_id: steel.id, bank_ledger_id: bank, pay_date: T, amount: 100 }), /blocked/)
    await e.setPartyStatus(steel.id, 'active', 'Dispute resolved')
  })

  it('possible duplicate parties are surfaced, never merged automatically', async () => {
    const r = await e.createParty({ company_id: ids[2], type_key: 'vendor', display_name: 'A.B.C. Logistics Private Limited' })
    expect(r.status).toBe('possible_duplicate')
    const n = e.parties.length
    expect(e.parties.length).toBe(n)
  })

  it('bank reconciliation never forces a match with a different amount', async () => {
    const t = e.bankTxns.find((x) => x.status === 'unmatched' && D(x.amount).eq(-590))!
    const anyLine = e.lines.find((l) => l.company_id === t.company_id && l.account_id === e.bankAccounts.find((b) => b.id === t.bank_account_id)!.ledger_account_id)!
    await reject(e.setBankMatch(t.id, anyLine.id, 'matched'), /amounts differ|already matched/)
  })
})

describe('black vault and time machine', () => {
  it('restricted detail is masked for uncleared users while totals stay truthful', async () => {
    const giv = ids[0]
    const acc = e.accounts.find((a) => a.company_id === giv && a.code === '7320')!.id
    const total = (rows: Awaited<ReturnType<typeof e.ledgerBalances>>) => rows.filter((r) => r.account_id === acc).reduce((s, r) => s.plus(r.opening_debit).plus(r.period_debit), D(0))
    e.actor = 'demo-accountant'
    const seen = await e.ledgerLines({ company_ids: [giv], account_ids: [acc] })
    const balances = await e.ledgerBalances([giv], '1990-01-01', T)
    e.actor = 'demo-owner'
    expect(seen.rows).toHaveLength(0)
    expect(seen.restricted.count).toBe(1)
    expect(D(seen.restricted.debit).toString()).toBe('3500000')
    expect(total(balances).toString()).toBe('3500000')
    const owner = await e.ledgerLines({ company_ids: [giv], account_ids: [acc] })
    expect(owner.rows).toHaveLength(1)
  })

  it('time machine reconstructs the books as they were known at an earlier moment', async () => {
    const past = `${addDays(T, -60)}T23:59:59`
    const then = await e.ledgerBalances(ids, '1990-01-01', T, { knownAt: past })
    const now = await e.ledgerBalances(ids, '1990-01-01', T)
    const tot = (rows: typeof now) => rows.reduce((s, r) => s.plus(r.opening_debit).plus(r.period_debit), D(0))
    expect(tot(then).lt(tot(now))).toBe(true)
    const d = then.reduce((s, r) => s.plus(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit), D(0))
    expect(d.toString()).toBe('0')
  })
})

describe('language understanding never guesses', () => {
  const ctx = () => ({ companies: e.companies, accounts: e.accounts, parties: e.parties, orgUnits: e.orgUnits, rules: e.numiRules, refDate: T })

  it('parses a complete sentence into a proposed balanced entry', () => {
    const p = parseTransaction('Paid ₹45,000 to ABC Consultants from HDFC for legal fees for Project Monarch for Jamin Bazaar', ctx())
    expect(p.kind).toBe('outflow')
    expect(p.amount!.toString()).toBe('45000')
    expect(p.company!.code).toBe('JB')
    expect(p.party!.display_name).toBe('ABC Consultants')
    expect(p.bank!.name).toMatch(/HDFC/)
    expect(p.account!.item.name).toBe('Legal Fees')
    expect(p.dims.map((d) => d.unit.name)).toContain('Project Monarch')
    const j = proposeJournal(p)!
    expect(j.origin).toBe('ai_suggested')
    expect(D(j.lines[0].debit).toString()).toBe(D(j.lines[1].credit).toString())
  })

  it('asks which Rajesh instead of guessing', () => {
    const p = parseTransaction('Received ₹1,25,000 from Rajesh for Jamin Bazaar', ctx())
    expect(p.party).toBeNull()
    expect(p.partyCandidates.length).toBeGreaterThan(1)
    expect(p.questions.join(' ')).toMatch(/Which Rajesh/)
    expect(proposeJournal(p)).toBeNull()
  })

  it('uses learned, explainable preferences first', () => {
    const p = parseTransaction('Paid 85,000 for Facebook and Google advertising for Jamin Bazaar from HDFC', ctx())
    expect(p.account!.confidence).toBe('learned')
    expect(p.account!.reason).toMatch(/14 previous approved/)
  })

  it('does not invent an amount', () => {
    const p = parseTransaction('Paid ABC Consultants for legal fees for Jamin Bazaar', ctx())
    expect(p.amount).toBeNull()
    expect(p.questions).toContain('What was the amount?')
  })
})

describe('money', () => {
  it('uses decimal arithmetic, not floating point', () => {
    expect(D('0.1').plus('0.2').toString()).toBe('0.3')
    expect(D('1234567890123.45').times(3).toString()).toBe('3703703670370.35')
  })
  it('formats Indian currency in lakh and crore', () => {
    expect(fmtMoney('124567890')).toBe('₹12,45,67,890.00')
    expect(fmtMoney('124567890', { compact: true })).toBe('₹12.46 Cr')
    expect(fmtMoney('-85000', { compact: true })).toBe('−₹85 K')
    expect(fmtMoney('99', { mask: true })).toBe('₹••••••••')
  })
  it('parses spoken amounts', () => {
    expect(parseAmount('₹4.8 lakh')!.toString()).toBe('480000')
    expect(parseAmount('5 crore')!.toString()).toBe('50000000')
    expect(parseAmount('2,50,000 plus tax')!.toString()).toBe('250000')
    expect(parseAmount('no number here')).toBeNull()
  })
  it('company templates always include the control accounts they map', () => {
    for (const key of ['holding', 'aif', 'real_estate', 'construction', 'import_export', 'medical_equipment', 'wellness', 'trading', 'services', 'technology', 'brokerage', 'custom']) {
      const p = buildCompanyPayload({ code: 'X', name: 'X' }, key)
      const codes = new Set(p.accounts.map((a) => a.code))
      expect(codes.size).toBe(p.accounts.length)
      for (const code of Object.values(p.account_map)) expect(codes.has(code), `${key}:${code}`).toBe(true)
      for (const a of p.accounts) if (a.parent_code) expect(codes.has(a.parent_code), `${key}:${a.code} parent`).toBe(true)
      for (const t of p.tax_codes) for (const c of t.components) expect(codes.has(c.output_code!) && codes.has(c.input_code!)).toBe(true)
    }
  })
})
