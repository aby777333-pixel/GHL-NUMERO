import { D, round2 } from '@/lib/money'
import { addDays, addMonths, endOfMonth, fiscalYearOf, parseISO, startOfMonth, today } from '@/lib/dates'
import { buildCompanyPayload } from '@/engine/templates'
import type { ID, JournalLineInput } from '@/engine/types'
import { DemoEngine } from './demo'
import { seedDemoOps } from './demoSeedOps'
import { finishDemoP3, seedDemoP3, type StockEvent } from './demoSeedP3'

// =====================================================================
// SAMPLE DATA for the demo universe. Everything generated here is
// fictional and exists only in the browser's memory. Every figure is
// produced by posting real double-entry journals through the engine,
// so the books balance and every number drills down to its source.
// =====================================================================

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function seedDemo(e: DemoEngine): Promise<void> {
  const rand = mulberry32(777333)
  // +370 keeps routine amounts from being suspiciously round
  const between = (min: number, max: number, step = 1000) => Math.round((min + rand() * (max - min)) / step) * step + 370
  const days = (min: number, max: number) => Math.round(min + rand() * (max - min))
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const TODAY = today()
  const START = startOfMonth(addMonths(TODAY, -11))
  const at = (date: string, time = '10:30:00') => `${date}T${time}`
  const MAKER = 'demo-accountant', CHECKER = 'demo-finance', OWNER = 'demo-owner'
  // salaries of this month are posted through the payroll run, not by a direct journal
  const payrollMonth = startOfMonth(addMonths(TODAY, -1))

  const as = async <T,>(actor: ID, date: string, fn: () => Promise<T>, time?: string): Promise<T> => {
    const prevA = e.actor, prevC = e.clock
    e.actor = actor; e.clock = at(date, time)
    try { return await fn() } finally { e.actor = prevA; e.clock = prevC }
  }

  // ---------------------------------------------------------------- companies
  const C: Record<string, ID> = {}
  const defs: [string, string, string, Record<string, unknown>][] = [
    ['GIV', 'GHL India Ventures', 'holding', { industry: 'Investment holding', business_type: 'Holding company' }],
    ['JB', 'Jamin Bazaar', 'real_estate', { industry: 'Real estate', business_type: 'Property development' }],
    ['GMED', 'GHL Medical Equipment', 'medical_equipment', { industry: 'Medical machinery', business_type: 'Import & distribution' }],
    ['GCON', 'GHL Constructions', 'construction', { industry: 'Construction', business_type: 'Contracting' }],
    ['GWELL', 'GHL Wellness', 'wellness', { industry: 'Wellness products', business_type: 'Trading' }],
    // a fund keeps books of its own: its net asset value is worked out from them
    ['GGF', 'GHL Growth Fund I', 'aif', { industry: 'Alternative investment fund', business_type: 'Category II AIF', legal_name: 'GHL Growth Fund I — a scheme of GHL Investment Trust' }],
  ]
  for (const [code, name, template, extra] of defs) {
    e.clock = at(START, '09:00:00')
    C[code] = await e.createCompany(buildCompanyPayload({ code, name, legal_name: name + ' Private Limited', country: 'IN', state: 'Tamil Nadu', base_currency: 'INR', fy_start_month: 4, ...extra }, template))
  }
  const acc = (co: string, code: string): ID => {
    const a = e.accounts.find((x) => x.company_id === C[co] && x.code === code)
    if (!a) throw new Error(`seed: account ${co}/${code} missing`)
    return a.id
  }

  // rename primary bank, add petty cash box, second bank and intercompany ledgers
  for (const co of Object.keys(C)) {
    const primary = e.accounts.find((a) => a.company_id === C[co] && a.code === '1121')!
    primary.name = 'HDFC Current Account'
    e.bankAccounts.push({ id: 'bank-' + co, company_id: C[co], ledger_account_id: primary.id, name: 'HDFC Current Account', bank_name: 'HDFC Bank', account_no_masked: '••••' + (co === 'GGF' ? '6120' : String(1000 + Math.floor(rand() * 8999))), ifsc: 'HDFC0000' + (co === 'GGF' ? '417' : String(100 + Math.floor(rand() * 899))), currency: 'INR', kind: 'bank', is_active: true })
    e.bankAccounts.push({ id: 'cash-' + co, company_id: C[co], ledger_account_id: acc(co, '1115'), name: 'Head Office Petty Cash', bank_name: null, account_no_masked: null, currency: 'INR', kind: 'petty_cash', is_active: true })
  }
  const addAcc = (co: string, code: string, name: string, type: 'asset' | 'liability', subtype: string, parent: string, counterparty?: string) => {
    e.accounts.push({ id: `acc-${co}-${code}`, company_id: C[co], code, name, type, subtype, parent_id: acc(co, parent), is_group: false, currency: null, control_type: counterparty ? 'intercompany' : 'bank', counterparty_company_id: counterparty ? C[counterparty] : null, is_active: true })
  }
  addAcc('JB', '1122', 'ICICI Collection Account', 'asset', 'bank', '1120')
  e.bankAccounts.push({ id: 'bank2-JB', company_id: C.JB, ledger_account_id: acc('JB', '1122'), name: 'ICICI Collection Account', bank_name: 'ICICI Bank', account_no_masked: '••••4471', ifsc: 'ICIC0001204', currency: 'INR', kind: 'bank', is_active: true })
  const SUBS = ['JB', 'GCON', 'GMED', 'GWELL']
  SUBS.forEach((sub, i) => {
    addAcc('GIV', '119' + (i + 1), `Due from ${e.company(C[sub]).name}`, 'asset', 'intercompany_receivable', '1100', sub)
    addAcc(sub, '2181', 'Due to GHL India Ventures', 'liability', 'intercompany_payable', '2100', 'GIV')
  })

  // extra projects / departments used as dimensions
  const addUnit = (co: string, type_key: string, code: string, name: string) =>
    e.orgUnits.push({ id: `ou-${co}-${code}`, company_id: C[co], type_key, parent_id: null, code, name, status: 'active', confidentiality: 'internal', meta: {} })
  addUnit('JB', 'project', 'PRJ-RUBYCON', 'Project Rubycon')
  addUnit('JB', 'office', 'CBE', 'Coimbatore Office')
  addUnit('GCON', 'project', 'PRJ-SKYLINE', 'Skyline Towers')
  addUnit('GCON', 'project', 'PRJ-NH44', 'NH-44 Flyover Package')
  addUnit('GMED', 'department', 'SVC', 'Service & AMC')
  for (const co of Object.keys(C)) addUnit(co, 'department', 'SAL', 'Sales')
  const dim = (co: string, key: string, code: string): Record<string, ID> => {
    const u = e.orgUnits.find((x) => x.company_id === C[co] && x.code === code)
    return u ? { [key]: u.id } : {}
  }

  // ---------------------------------------------------------------- approval rules
  e.approvalRules.push(
    { id: 'rule-1', group_id: e.group.id, company_id: null, entity: 'journal', name: 'Journals up to ₹10 lakh', min_amount: 0, max_amount: 1000000, steps: ['finance_head'], is_active: true },
    { id: 'rule-2', group_id: e.group.id, company_id: null, entity: 'journal', name: 'Journals ₹10 lakh – ₹1 crore', min_amount: 1000000, max_amount: 10000000, steps: ['finance_head', 'group_cfo'], is_active: true },
    { id: 'rule-3', group_id: e.group.id, company_id: null, entity: 'journal', name: 'Journals above ₹1 crore', min_amount: 10000000, max_amount: null, steps: ['group_cfo', 'owner'], is_active: true },
  )

  // ---------------------------------------------------------------- posting helpers
  interface PostOpts { vtype?: string; source?: string; conf?: 'internal' | 'restricted' | 'confidential'; time?: string; maker?: ID; purpose?: string }
  const post = async (co: string, date: string, narration: string, lines: JournalLineInput[], o: PostOpts = {}): Promise<ID> => {
    const maker = o.maker ?? MAKER
    const id = await as(maker, date, () => e.saveJournalDraft({ company_id: C[co], journal_date: date, narration, purpose: o.purpose, voucher_type: o.vtype ?? 'journal', source: o.source ?? 'manual', confidentiality: o.conf, lines }), o.time)
    await as(maker, date, () => e.submitJournal(id), o.time)
    // a restricted entry can be approved only by someone cleared to read it
    const approvers = o.conf === 'restricted' ? [OWNER, OWNER] : [CHECKER, OWNER, MAKER].filter((a) => a !== maker)
    for (let i = 0; i < 4 && e.journals.find((j) => j.id === id)!.status === 'submitted'; i++) {
      await as(approvers[i % 2], date, () => e.approveJournal(id, 'Reviewed against supporting document'), o.time)
    }
    await as(maker, date, () => e.postJournal(id), o.time)
    return id
  }
  const dr = (account_id: ID, amount: number | string, extra: Partial<JournalLineInput> = {}): JournalLineInput => ({ account_id, debit: String(amount), ...extra })
  const cr = (account_id: ID, amount: number | string, extra: Partial<JournalLineInput> = {}): JournalLineInput => ({ account_id, credit: String(amount), ...extra })
  const bank = (co: string) => acc(co, '1121')

  // ---------------------------------------------------------------- parties
  const party = async (co: string, type_key: string, display_name: string, o: { kind?: 'person' | 'organization'; gstin?: string; pan?: string; date?: string; credit_days?: number; credit_limit?: number } = {}): Promise<ID> => {
    const existing = e.parties.find((p) => p.display_name === display_name)
    if (existing) { await as(OWNER, o.date ?? START, () => e.addPartyRole(existing.id, C[co], type_key)); return existing.id }
    const r = await as(MAKER, o.date ?? START, () => e.createParty({ company_id: C[co], type_key, display_name, kind: o.kind, gstin: o.gstin, pan: o.pan, credit_days: o.credit_days, credit_limit: o.credit_limit, force: true }))
    if (r.status !== 'created') throw new Error('seed: party ' + display_name)
    return r.id
  }
  const P = {
    rajesh: await party('JB', 'customer', 'Rajesh Kumar', { kind: 'person', pan: 'ABCPK1234F', credit_days: 30 }),
    rajeshN: await party('JB', 'customer', 'Rajesh Kumar Nair', { kind: 'person', credit_days: 30 }),
    lakshmi: await party('JB', 'customer', 'Lakshmi Estates LLP', { gstin: '33AAEFL1234K1Z5', credit_days: 45, credit_limit: 50000000 }),
    sundaram: await party('JB', 'customer', 'Sundaram Holdings', { gstin: '33AABCS9876M1Z2', credit_days: 45 }),
    legal: await party('JB', 'vendor', 'Shree Legal Associates', { gstin: '33AAPFS4521B1Z8' }),
    meta: await party('JB', 'vendor', 'Meta Platforms India', { gstin: '06AABCF5150G1ZZ' }),
    google: await party('JB', 'vendor', 'Google India', { gstin: '29AACCG0527D1Z8' }),
    survey: await party('JB', 'vendor', 'Coimbatore Land Surveyors'),
    abcCons: await party('JB', 'consultant', 'ABC Consultants', { gstin: '33AAGFA1122C1Z4' }),
    landOwner: await party('JB', 'vendor', 'Palani Agro Lands'),
    broker: await party('JB', 'broker', 'Prime Realty Brokers', { gstin: '33AAHFP7788D1Z1' }),
    tnInfra: await party('GCON', 'customer', 'Tamil Nadu Infra Corporation', { gstin: '33AAACT1111A1Z9', credit_days: 60 }),
    cement: await party('GCON', 'supplier', 'UltraBuild Cement', { gstin: '33AAACU2222B1Z7' }),
    steel: await party('GCON', 'supplier', 'Steelmax Traders', { gstin: '33AAACS3333C1Z5' }),
    labour: await party('GCON', 'contractor', 'Sri Murugan Labour Contractors'),
    equip: await party('GCON', 'vendor', 'KK Equipment Rentals', { gstin: '33AAACK4444D1Z3' }),
    apollo: await party('GMED', 'customer', 'Apollo Care Hospital', { gstin: '33AAACA5555E1Z1', credit_days: 45 }),
    cityDiag: await party('GMED', 'customer', 'City Diagnostics Centre', { gstin: '33AAACC6666F1Z9', credit_days: 30 }),
    kovai: await party('GMED', 'customer', 'Kovai Medical Trust', { credit_days: 60 }),
    shenzhen: await party('GMED', 'supplier', 'Shenzhen MedTech Co'),
    abcLog: await party('GMED', 'transporter', 'ABC Logistics Pvt Ltd', { gstin: '33AAACA7777G1Z7' }),
    retail: await party('GWELL', 'customer', 'Wellness Retail Chain', { gstin: '33AAACW8888H1Z5', credit_days: 30 }),
    healthkart: await party('GWELL', 'customer', 'HealthKart Distributors', { gstin: '27AAACH9999J1Z3', credit_days: 30 }),
    herbals: await party('GWELL', 'supplier', 'Himalaya Herbals Supply', { gstin: '05AAACH1212K1Z1' }),
    pack: await party('GWELL', 'vendor', 'PackRight Packaging', { gstin: '33AAACP3434L1Z9' }),
    aws: await party('GIV', 'vendor', 'AWS India', { gstin: '07AAKCA5678M1Z7' }),
    advisory: await party('GIV', 'consultant', 'Meridian Advisory LLP', { gstin: '33AAQFM5656N1Z5' }),
    hdfc: await party('GCON', 'lender', 'HDFC Bank'),
  }
  // the same parties serve several companies under ONE master identity
  await party('GCON', 'customer', 'Sundaram Holdings')
  await party('GWELL', 'transporter', 'ABC Logistics Pvt Ltd')
  await party('GCON', 'transporter', 'ABC Logistics Pvt Ltd')
  await party('JB', 'transporter', 'ABC Logistics Pvt Ltd')
  await party('GIV', 'investor', 'Rajesh Kumar')

  const tax = (co: string, code: string) => e.taxCodes.find((t) => t.company_id === C[co] && t.code === code)!.id

  // ---------------------------------------------------------------- documents
  interface Doc { id: ID; co: string; party: ID; date: string; dir: 'in' | 'out'; payAfter: number }
  const openDocs: Doc[] = []
  interface InvOpts { reference?: string; currency?: string; fx?: number; dueDays?: number; payAfter?: number | null; narration?: string }
  const invoice = async (co: string, doc_type: 'sales_invoice' | 'purchase_bill', partyId: ID, date: string, lines: { account: string; amount: number; tax?: string; desc: string; dims?: Record<string, ID> }[], o: InvOpts = {}) => {
    const id = await as(MAKER, date, () => e.saveInvoice({
      company_id: C[co], doc_type, party_id: partyId, doc_date: date, due_date: addDays(date, o.dueDays ?? 30), currency: o.currency, fx_rate: o.fx,
      reference: o.reference, narration: o.narration ?? lines[0].desc,
      lines: lines.map((l) => ({ account_id: acc(co, l.account), amount: Math.round(l.amount * 100) / 100, tax_code_id: l.tax ? tax(co, l.tax) : null, description: l.desc, dims: l.dims })),
    }))
    await as(CHECKER, date, () => e.approveInvoice(id))
    if (o.payAfter !== null) openDocs.push({ id, co, party: partyId, date, dir: doc_type === 'sales_invoice' ? 'in' : 'out', payAfter: o.payAfter ?? 35 })
    return id
  }
  const pay = async (co: string, dir: 'in' | 'out', partyId: ID, date: string, amount: number | string, narration: string, allocations: { invoice_id: ID; amount: string }[] = [], currency?: string, fx?: number) => {
    const id = await as(MAKER, date, () => e.savePayment({ company_id: C[co], direction: dir, party_id: partyId, bank_ledger_id: bank(co), pay_date: date, amount, currency, fx_rate: fx, reference: 'UTR' + Math.floor(1e9 + rand() * 9e9), narration, allocations }))
    await as(CHECKER, date, () => e.approvePayment(id))
    return id
  }
  const settle = async (upTo: string) => {
    for (let i = openDocs.length - 1; i >= 0; i--) {
      const d = openDocs[i]
      const payDate = addDays(d.date, d.payAfter)
      if (payDate > upTo || payDate > TODAY) continue
      const inv = e.invoices.find((x) => x.id === d.id)!
      const outstanding = D(inv.total).minus(inv.amount_settled)
      const partial = rand() < 0.12
      const amount = partial ? round2(outstanding.times(0.6)) : outstanding
      await pay(d.co, d.dir, d.party, payDate, amount.toString(), `${d.dir === 'in' ? 'Receipt against' : 'Payment of'} ${inv.doc_no}`,
        [{ invoice_id: inv.id, amount: amount.toString() }], inv.currency, inv.currency === 'INR' ? 1 : Number(inv.fx_rate) + 0.35)
      if (partial) { d.date = payDate; d.payAfter = 40 } else openDocs.splice(i, 1)
    }
  }

  // ---------------------------------------------------------------- opening funding (recorded as opening entries)
  const open = (co: string, narration: string, lines: JournalLineInput[]) => post(co, START, narration, lines, { vtype: 'opening', source: 'opening', time: '09:30:00' })
  await open('GIV', 'Share capital introduced by promoters', [dr(bank('GIV'), 400000000), cr(acc('GIV', '3100'), 400000000)])
  await open('GIV', 'Fixed deposits placed with HDFC Bank', [dr(acc('GIV', '1210'), 120000000), cr(bank('GIV'), 120000000)])
  await open('JB', 'Share capital introduced', [dr(bank('JB'), 60000000), cr(acc('JB', '3100'), 60000000)])
  await open('GCON', 'Share capital introduced', [dr(bank('GCON'), 50000000), cr(acc('GCON', '3100'), 50000000)])
  await open('GMED', 'Share capital introduced', [dr(bank('GMED'), 40000000), cr(acc('GMED', '3100'), 40000000)])
  await open('GWELL', 'Share capital introduced', [dr(bank('GWELL'), 15000000), cr(acc('GWELL', '3100'), 15000000)])
  const fund = async (sub: string, amount: number, idx: number) => {
    await post('GIV', addDays(START, 2), `Intercompany loan to ${e.company(C[sub]).name}`, [dr(acc('GIV', '119' + idx), amount), cr(bank('GIV'), amount)], { vtype: 'intercompany', source: 'opening' })
    await post(sub, addDays(START, 2), 'Intercompany loan received from GHL India Ventures', [dr(bank(sub), amount), cr(acc(sub, '2181'), amount)], { vtype: 'intercompany', source: 'opening' })
  }
  await fund('JB', 50000000, 1)
  await fund('GCON', 30000000, 2)
  await fund('GMED', 20000000, 3)
  await fund('GWELL', 5000000, 4)
  await open('GCON', 'Term loan disbursed by HDFC Bank', [dr(bank('GCON'), 80000000), cr(acc('GCON', '2210'), 80000000, { party_id: P.hdfc })])
  await open('JB', 'Land bank acquired — Project Monarch', [dr(acc('JB', '1141'), 75000000, { dims: dim('JB', 'project', 'PRJ-MONARCH') }), cr(bank('JB'), 75000000)])
  await open('GCON', 'Plant and equipment purchased', [dr(acc('GCON', '1320'), 42000000), cr(bank('GCON'), 42000000)])
  await open('GMED', 'Demo equipment and service vehicles purchased', [dr(acc('GMED', '1320'), 9000000), dr(acc('GMED', '1340'), 3600000), cr(bank('GMED'), 12600000)])
  await open('GMED', 'Opening stock of equipment purchased', [dr(acc('GMED', '1140'), 26000000), cr(bank('GMED'), 26000000)])
  await open('GWELL', 'Opening stock purchased', [dr(acc('GWELL', '1140'), 6000000), cr(bank('GWELL'), 6000000)])
  await open('GIV', 'Office fit-out and IT equipment', [dr(acc('GIV', '1330'), 4800000), dr(acc('GIV', '1350'), 2400000), cr(bank('GIV'), 7200000)])
  await open('JB', 'Office security deposit paid to landlord', [dr(acc('JB', '1160'), 1200000), cr(bank('JB'), 1200000)])

  // ---------------------------------------------------------------- monthly operations
  const months: string[] = []
  for (let m = START; m <= TODAY; m = addMonths(m, 1)) months.push(m)
  const day = (m: string, d: number) => { const x = addDays(m, d - 1); return x > endOfMonth(m) ? endOfMonth(m) : x }
  const ok = (d: string) => d <= TODAY
  // The day the stock ledger begins. Until then the two trading companies kept their stock in the general ledger only;
  // from this day goods reach the books through stock documents, and what happened is handed to the inventory sample data.
  const CUT = addDays(TODAY, -35)
  const stockEvents: StockEvent[] = []

  const expense = async (co: string, date: string, code: string, amount: number, narration: string, o: { dept?: string; project?: string; partyId?: ID; from?: ID } = {}) => {
    if (!ok(date)) return
    const dims = { ...(o.dept ? dim(co, 'department', o.dept) : {}), ...(o.project ? dim(co, 'project', o.project) : {}) }
    await post(co, date, narration, [dr(acc(co, code), amount, { dims, party_id: o.partyId, description: narration }), cr(o.from ?? bank(co), amount)], { vtype: 'payment', source: 'expense', purpose: narration })
  }

  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi]
    const growth = 1 + mi * 0.025
    await settle(endOfMonth(m))

    // ----- GHL India Ventures (holding)
    if (ok(day(m, 5))) {
      for (const [sub, fee, idx] of [['JB', 500370, 1], ['GCON', 300370, 2]] as const) {
        await post('GIV', day(m, 5), `Management fee — ${e.company(C[sub]).name}`, [dr(acc('GIV', '119' + idx), fee), cr(acc('GIV', '4160'), fee)], { vtype: 'intercompany', source: 'intercompany' })
        await post(sub, day(m, 5), 'Management fee charged by GHL India Ventures', [dr(acc(sub, '6530'), fee, { dims: dim(sub, 'department', 'ADM') }), cr(acc(sub, '2181'), fee)], { vtype: 'intercompany', source: 'intercompany' })
      }
    }
    if (ok(endOfMonth(m))) await post('GIV', endOfMonth(m), 'Interest accrued on fixed deposits', [dr(acc('GIV', '1210'), 712370), cr(acc('GIV', '4910'), 712370)], { vtype: 'accrual', source: 'system' })
    await expense('GIV', day(m, 28), '6110', 1180370 + mi * 12000, 'Salaries for the month', { dept: 'FIN' })
    await expense('GIV', day(m, 3), '6210', 185370, 'Office rent — head office', { dept: 'ADM' })
    await expense('GIV', day(m, 12), '6620', between(64000, 118000), 'AWS cloud infrastructure', { dept: 'ADM', partyId: P.aws })
    await expense('GIV', day(m, 14), '6610', between(38000, 72000), 'Software subscriptions', { dept: 'ADM' })
    if (mi % 3 === 2) await expense('GIV', day(m, 20), '6520', 450370, 'Statutory audit fee — quarterly', { dept: 'FIN', partyId: P.advisory })
    if (ok(endOfMonth(m))) await post('GIV', endOfMonth(m), 'Depreciation for the month', [dr(acc('GIV', '7100'), 60370), cr(acc('GIV', '1390'), 60370)], { vtype: 'depreciation', source: 'system' })

    // ----- Jamin Bazaar (real estate)
    if (mi > 0 && mi % 4 === 3 && ok(day(m, 2))) {
      await invoice('JB', 'purchase_bill', P.landOwner, day(m, 2), [{ account: '1141', amount: 30000370, desc: 'Land parcel acquired — Project Rubycon', dims: dim('JB', 'project', 'PRJ-RUBYCON') }], { reference: 'PAL/' + m.slice(0, 7), payAfter: 15 })
    }
    const nSales = 2 + Math.floor(rand() * 2)
    for (let i = 0; i < nSales; i++) {
      const d = day(m, 4 + i * 8 + Math.floor(rand() * 4))
      if (!ok(d)) continue
      const buyer = pick([P.rajesh, P.lakshmi, P.sundaram, P.lakshmi, P.rajeshN])
      const amount = Math.round(between(4200000, 11800000, 50000) * growth)
      const project = rand() < 0.6 ? 'PRJ-MONARCH' : 'PRJ-RUBYCON'
      const label = project === 'PRJ-MONARCH' ? 'Project Monarch' : 'Project Rubycon'
      await invoice('JB', 'sales_invoice', buyer, d, [{ account: '4130', amount, desc: `Plot sale — ${label}`, dims: dim('JB', 'project', project) }], { dueDays: 30, payAfter: buyer === P.sundaram ? 95 : days(18, 50) })
      if (ok(addDays(d, 1))) await post('JB', addDays(d, 1), `Land cost released to cost of sales — ${label}`, [dr(acc('JB', '5040'), Math.round(amount * 0.46), { dims: dim('JB', 'project', project) }), cr(acc('JB', '1141'), Math.round(amount * 0.46))], { vtype: 'adjustment', source: 'system' })
      if (ok(addDays(d, 3))) await invoice('JB', 'purchase_bill', P.broker, addDays(d, 3), [{ account: '6800', amount: Math.round(amount * 0.02), tax: 'GST18', desc: `Brokerage on plot sale — ${label}`, dims: dim('JB', 'project', project) }], { reference: 'PRB/' + Math.floor(1000 + rand() * 8999), payAfter: 25 })
    }
    if (ok(day(m, 9))) await invoice('JB', 'purchase_bill', P.meta, day(m, 9), [{ account: '6310', amount: between(380000, 620000) * growth, tax: 'IGST18', desc: 'Facebook & Instagram campaign management', dims: dim('JB', 'department', 'MKT') }], { reference: 'META-' + m.slice(0, 7), payAfter: 20 })
    if (ok(day(m, 11))) await invoice('JB', 'purchase_bill', P.google, day(m, 11), [{ account: '6310', amount: between(260000, 470000) * growth, tax: 'IGST18', desc: 'Google Ads — search & display', dims: dim('JB', 'department', 'MKT') }], { reference: 'GADS-' + m.slice(0, 7), payAfter: 20 })
    if (ok(day(m, 16))) await invoice('JB', 'purchase_bill', P.survey, day(m, 16), [{ account: '5050', amount: between(900000, 2100000), tax: 'GST18', desc: 'Layout development & surveying', dims: dim('JB', 'project', 'PRJ-MONARCH') }], { reference: 'CLS/' + Math.floor(100 + rand() * 899), payAfter: 40 })
    if (mi % 2 === 0 && ok(day(m, 18))) await invoice('JB', 'purchase_bill', P.legal, day(m, 18), [{ account: '5060', amount: between(180000, 420000), tax: 'GST18', desc: 'Title verification and approvals', dims: dim('JB', 'project', 'PRJ-MONARCH') }], { reference: 'SLA/' + fiscalYearOf(m) + '/' + (100 + mi), payAfter: 30 })
    if (m !== payrollMonth) await expense('JB', day(m, 28), '6110', 1420370 + mi * 15000, 'Salaries for the month', { dept: 'ADM' })
    await expense('JB', day(m, 3), '6210', 210370, 'Office rent — Coimbatore', { dept: 'ADM' })
    await expense('JB', day(m, 7), '6220', between(28000, 61000), 'Electricity — Coimbatore office', { dept: 'ADM' })
    await expense('JB', day(m, 8), '6230', between(9000, 16000), 'Broadband and telephone', { dept: 'ADM' })
    await expense('JB', day(m, 13), '6440', between(22000, 58000), 'Fuel — site visit vehicles', { dept: 'SAL' })
    if (mi % 2 === 0 && ok(day(m, 2))) await post('JB', day(m, 2), 'Petty cash replenishment', [dr(acc('JB', '1115'), 50370), cr(bank('JB'), 50370)], { vtype: 'contra', source: 'system' })
    await expense('JB', day(m, 15), '6450', between(8000, 21000), 'Client lunch and site refreshments', { dept: 'SAL', from: mi % 2 === 0 ? acc('JB', '1115') : undefined })
    if (mi % 3 === 1) await expense('JB', day(m, 21), '6420', between(42000, 96000), 'Hotel — investor meet, Chennai', { dept: 'SAL' })

    // ----- GHL Constructions
    if (ok(day(m, 6))) await invoice('GCON', 'sales_invoice', P.tnInfra, day(m, 6), [{ account: '4150', amount: Math.round(between(14500000, 26500000, 100000) * growth), tax: 'GST18', desc: 'Running bill — NH-44 Flyover Package', dims: dim('GCON', 'project', 'PRJ-NH44') }], { dueDays: 45, payAfter: days(40, 70) })
    if (ok(day(m, 19))) await invoice('GCON', 'sales_invoice', P.sundaram, day(m, 19), [{ account: '4150', amount: Math.round(between(6200000, 11800000, 100000) * growth), tax: 'GST18', desc: 'Progress billing — Skyline Towers', dims: dim('GCON', 'project', 'PRJ-SKYLINE') }], { dueDays: 45, payAfter: 88 })
    if (ok(day(m, 8))) await invoice('GCON', 'purchase_bill', P.cement, day(m, 8), [{ account: '5070', amount: Math.round(between(5200000, 8800000, 50000) * growth), tax: 'GST28', desc: 'Cement supply', dims: dim('GCON', 'project', 'PRJ-NH44') }], { reference: 'UBC/' + Math.floor(1e4 + rand() * 9e4), payAfter: 35 })
    if (ok(day(m, 10))) await invoice('GCON', 'purchase_bill', P.steel, day(m, 10), [{ account: '5070', amount: Math.round(between(4100000, 7400000, 50000) * growth), tax: 'GST18', desc: 'TMT steel', dims: dim('GCON', 'project', pick(['PRJ-NH44', 'PRJ-SKYLINE'])) }], { reference: 'SMX/' + Math.floor(1e4 + rand() * 9e4), payAfter: 35 })
    if (ok(day(m, 24))) await invoice('GCON', 'purchase_bill', P.labour, day(m, 24), [{ account: '5080', amount: Math.round(between(3200000, 5200000, 50000) * growth), desc: 'Labour contract — monthly certification', dims: dim('GCON', 'project', 'PRJ-NH44') }], { reference: 'SML/' + m.slice(0, 7), payAfter: 12 })
    if (ok(day(m, 14))) await invoice('GCON', 'purchase_bill', P.equip, day(m, 14), [{ account: '5090', amount: between(650000, 1350000), tax: 'GST18', desc: 'Crane and excavator hire', dims: dim('GCON', 'project', 'PRJ-SKYLINE') }], { reference: 'KKE/' + Math.floor(100 + rand() * 899), payAfter: 30 })
    await expense('GCON', day(m, 28), '6110', 1960370 + mi * 20000, 'Salaries for the month', { dept: 'ADM' })
    await expense('GCON', day(m, 3), '6210', 165370, 'Office rent', { dept: 'ADM' })
    await expense('GCON', day(m, 17), '6440', between(140000, 260000), 'Diesel — site equipment and vehicles', { project: 'PRJ-NH44' })
    await expense('GCON', day(m, 22), '6700', between(45000, 110000), 'Vehicle servicing and repairs', { dept: 'ADM' })
    if (ok(day(m, 10))) {
      const outstanding = 80000000 - mi * 1333370
      const interest = Math.round((outstanding * 0.105) / 12)
      await post('GCON', day(m, 10), 'Term loan EMI — HDFC Bank', [dr(acc('GCON', '2210'), 1333370, { party_id: P.hdfc, description: 'Principal' }), dr(acc('GCON', '7010'), interest, { description: 'Interest' }), cr(bank('GCON'), 1333370 + interest)], { vtype: 'payment', source: 'loan' })
    }
    if (ok(endOfMonth(m))) await post('GCON', endOfMonth(m), 'Depreciation for the month', [dr(acc('GCON', '7100'), 350370), cr(acc('GCON', '1390'), 350370)], { vtype: 'depreciation', source: 'system' })

    // ----- GHL Medical Equipment
    const nMed = 1 + Math.floor(rand() * 2)
    for (let i = 0; i < nMed; i++) {
      const d = day(m, 7 + i * 11)
      if (!ok(d)) continue
      const cust = pick([P.apollo, P.cityDiag, P.kovai])
      const amount = Math.round(between(3800000, 8600000, 50000) * growth)
      const sold = await invoice('GMED', 'sales_invoice', cust, d, [
        { account: '4170', amount, tax: 'GST12', desc: 'Diagnostic imaging equipment', dims: dim('GMED', 'department', 'SAL') },
        { account: '4120', amount: Math.round(amount * 0.03), tax: 'GST18', desc: 'Installation and commissioning', dims: dim('GMED', 'department', 'SVC') },
      ], { dueDays: 45, payAfter: cust === P.kovai ? 110 : days(30, 60) })
      if (d >= CUT) stockEvents.push({ kind: 'sale', co: 'GMED', date: d, invoice: sold, party: cust, cost: Math.round(amount * 0.62) })
      else await post('GMED', d, 'Cost of equipment sold', [dr(acc('GMED', '5010'), Math.round(amount * 0.62)), cr(acc('GMED', '1140'), Math.round(amount * 0.62))], { vtype: 'adjustment', source: 'system' })
    }
    if (ok(day(m, 5))) await invoice('GMED', 'sales_invoice', pick([P.apollo, P.cityDiag]), day(m, 5), [{ account: '4180', amount: between(480000, 820000), tax: 'GST18', desc: 'Annual maintenance contract — monthly billing', dims: dim('GMED', 'department', 'SVC') }], { dueDays: 30, payAfter: days(20, 40) })
    if (ok(day(m, 4))) {
      const usd = between(42000, 78000, 500)
      const fx = Number((84.2 + mi * 0.12).toFixed(2))
      // with the stock ledger in place the bill clears what the receipt recorded, and duty and freight join the cost of the goods
      const stocked = day(m, 4) >= CUT
      const duty = Math.round(usd * fx * 0.075)
      const bill = await invoice('GMED', 'purchase_bill', P.shenzhen, day(m, 4), [{ account: stocked ? '2125' : '1140', amount: usd, desc: 'Imported equipment — CIF Chennai' }], { reference: 'SZM-' + Math.floor(1e5 + rand() * 9e5), currency: 'USD', fx, payAfter: 45, dueDays: 60 })
      await expense('GMED', day(m, 9), stocked ? '2127' : '5100', duty, 'Customs duty on import consignment')
      let freight = 0
      if (ok(day(m, 9))) {
        freight = between(85000, 190000)
        await invoice('GMED', 'purchase_bill', P.abcLog, day(m, 9), [{ account: stocked ? '2127' : '5030', amount: freight, tax: 'GST18', desc: 'Port clearance and inland freight' }], { reference: 'ABCL/' + Math.floor(1e4 + rand() * 9e4), payAfter: 25 })
      }
      if (stocked) stockEvents.push({ kind: 'purchase', co: 'GMED', date: day(m, 4), bill, party: P.shenzhen, charges: ok(day(m, 9)) ? { date: day(m, 9), duty, freight, carrier: P.abcLog } : undefined })
    }
    await expense('GMED', day(m, 28), '6110', 1240370 + mi * 10000, 'Salaries for the month', { dept: 'ADM' })
    await expense('GMED', day(m, 3), '6210', 142370, 'Office and warehouse rent', { dept: 'ADM' })
    await expense('GMED', day(m, 18), '6410', between(36000, 92000), 'Airfare — service engineer visits', { dept: 'SVC' })
    // depreciation of GHL Medical Equipment comes from its asset register (see demoSeedOps)

    // ----- GHL Wellness
    for (const [cust, dd] of [[P.retail, 6], [P.healthkart, 17]] as const) {
      const d = day(m, dd)
      if (!ok(d)) continue
      const amount = Math.round(between(980000, 1860000, 10000) * growth)
      const sold = await invoice('GWELL', 'sales_invoice', cust, d, [{ account: '4110', amount, tax: 'GST12', desc: 'Wellness products — monthly supply', dims: dim('GWELL', 'department', 'SAL') }], { dueDays: 30, payAfter: days(22, 45) })
      if (d >= CUT) stockEvents.push({ kind: 'sale', co: 'GWELL', date: d, invoice: sold, party: cust, cost: Math.round(amount * 0.58) })
      else await post('GWELL', d, 'Cost of goods sold', [dr(acc('GWELL', '5010'), Math.round(amount * 0.58)), cr(acc('GWELL', '1140'), Math.round(amount * 0.58))], { vtype: 'adjustment', source: 'system' })
    }
    if (ok(day(m, 3))) {
      const stocked = day(m, 3) >= CUT
      const bill = await invoice('GWELL', 'purchase_bill', P.herbals, day(m, 3), [{ account: stocked ? '2125' : '1140', amount: Math.round(between(1500000, 2350000, 10000) * growth), tax: 'GST12', desc: 'Herbal formulations — batch purchase' }], { reference: 'HHS/' + Math.floor(1e4 + rand() * 9e4), payAfter: 30 })
      if (stocked) stockEvents.push({ kind: 'purchase', co: 'GWELL', date: day(m, 3), bill, party: P.herbals })
    }
    if (ok(day(m, 12))) await invoice('GWELL', 'purchase_bill', P.pack, day(m, 12), [{ account: '5020', amount: between(120000, 260000), tax: 'GST18', desc: 'Packaging material' }], { reference: 'PRP/' + Math.floor(1e3 + rand() * 9e3), payAfter: 30 })
    await expense('GWELL', day(m, 28), '6110', 640370 + mi * 6000, 'Salaries for the month', { dept: 'ADM' })
    await expense('GWELL', day(m, 3), '6210', 78370, 'Store rent', { dept: 'ADM' })
    await expense('GWELL', day(m, 10), '6310', between(160000, 310000), 'Instagram and marketplace advertising', { dept: 'MKT' })
    await expense('GWELL', day(m, 20), '6260', between(28000, 66000), 'Courier charges — customer orders', { dept: 'SAL' })
  }
  await settle(TODAY)

  // ---------------------------------------------------------------- deliberate review items (for Sentinel, Vault, Suspense)
  const recent = (n: number) => { const d = addDays(TODAY, -n); return d < START ? START : d }
  let sunday = recent(9)
  while (parseISO(sunday).getDay() !== 0) sunday = addDays(sunday, -1)
  await post('JB', sunday, 'Advance to site supervisor for land registration expenses', [dr(acc('JB', '1155'), 1000000, { dims: dim('JB', 'project', 'PRJ-RUBYCON') }), cr(bank('JB'), 1000000)], { time: '23:42:00', purpose: 'Registration expenses for Rubycon phase 2' })
  await post('JB', recent(16), 'Consultancy retainer — strategy review', [dr(acc('JB', '6530'), 980000, { party_id: P.abcCons, dims: dim('JB', 'department', 'ADM') }), cr(bank('JB'), 980000)], { purpose: 'Strategy consulting' })
  await invoice('JB', 'purchase_bill', P.legal, recent(20), [{ account: '6510', amount: 236000, tax: 'GST18', desc: 'Legal opinion — boundary dispute' }], { reference: 'SLA/2026/118', payAfter: null })
  await invoice('JB', 'purchase_bill', P.legal, recent(12), [{ account: '6510', amount: 236000, tax: 'GST18', desc: 'Legal opinion — boundary dispute' }], { reference: 'SLA/2026/118', payAfter: null })
  const quick = await party('GCON', 'vendor', 'Quick Fix Enterprises', { date: recent(14) })
  await pay('GCON', 'out', quick, recent(12), 750000, 'Advance for emergency shuttering repairs')
  for (const n of [8, 6]) await pay('GMED', 'out', P.abcLog, recent(n), 125000, 'Freight advance')
  await post('JB', recent(5), 'Unidentified credit received by NEFT — payer not yet known', [dr(bank('JB'), 240000), cr(acc('JB', '2190'), 240000)], { vtype: 'receipt', source: 'bank' })
  await post('GIV', recent(30), 'Legal settlement — confidential matter', [dr(acc('GIV', '7320'), 3500000), cr(bank('GIV'), 3500000)], { conf: 'restricted', maker: OWNER, purpose: 'Commercial settlement under board approval', source: 'vault' })

  // bank details awaiting independent verification
  await as(MAKER, recent(3), () => e.addPartyBank({ company_id: C.GCON, party_id: P.steel, bank_name: 'Axis Bank', account_no: '918020045511220', ifsc: 'UTIB0000123', beneficiary_name: 'Steelmax Traders' }))

  // journals waiting in the approval inbox, and a draft
  const pending = async (co: string, narration: string, lines: JournalLineInput[], submit = true) => {
    const id = await as(MAKER, recent(1), () => e.saveJournalDraft({ company_id: C[co], journal_date: recent(1), narration, lines }))
    if (submit) await as(MAKER, recent(1), () => e.submitJournal(id))
  }
  await pending('JB', 'Accrual — electricity for the month (bill awaited)', [dr(acc('JB', '6220'), 46200, { dims: dim('JB', 'department', 'ADM') }), cr(acc('JB', '2120'), 46200)])
  await pending('GCON', 'Mobilisation advance to labour contractor', [dr(acc('GCON', '1156'), 1850000, { party_id: P.labour }), cr(bank('GCON'), 1850000)])
  await pending('GMED', 'Warranty provision for equipment sold this quarter', [dr(acc('GMED', '5020'), 384000), cr(acc('GMED', '2196'), 384000)])
  await pending('JB', 'Prepaid insurance — annual premium (draft)', [dr(acc('JB', '1170'), 318000), cr(bank('JB'), 318000)], false)

  // ---------------------------------------------------------------- bank statement (Jamin Bazaar · HDFC)
  const bankLedger = bank('JB')
  const from = recent(50)
  const posted = new Map(e.journals.filter((j) => j.status === 'posted' && j.journal_date >= from).map((j) => [j.id, j]))
  const rows: { txn_date: string; amount: string; narration: string; reference: string }[] = []
  for (const l of e.lines) {
    const j = posted.get(l.journal_id)
    if (!j || l.company_id !== C.JB || l.account_id !== bankLedger || rand() < 0.12) continue
    const shifted = addDays(j.journal_date, rand() < 0.3 ? 1 : 0)
    rows.push({ txn_date: shifted > TODAY ? j.journal_date : shifted, amount: D(l.debit).minus(l.credit).toString(), narration: (j.narration ?? '').toUpperCase().slice(0, 60), reference: 'HDFC' + Math.floor(1e8 + rand() * 9e8) })
  }
  rows.push({ txn_date: recent(18), amount: '-590', narration: 'SMS ALERT CHARGES INCL GST', reference: 'CHG' + Math.floor(1e6 + rand() * 9e6) })
  rows.push({ txn_date: recent(9), amount: '-1180', narration: 'CHEQUE BOOK ISSUE CHARGES', reference: 'CHG' + Math.floor(1e6 + rand() * 9e6) })
  rows.push({ txn_date: recent(4), amount: '18250', narration: 'INT ON SWEEP DEPOSIT', reference: 'INT' + Math.floor(1e6 + rand() * 9e6) })
  if (rows.length > 4) rows.push({ ...rows[2] })
  await as(MAKER, TODAY, () => e.importBankTransactions('bank-JB', rows))
  await as(MAKER, TODAY, async () => {
    const sugs = await e.suggestBankMatches('bank-JB')
    const used = new Set<ID>(), done = new Set<ID>()
    for (const s of sugs) {
      if (s.score < 80 || used.has(s.line_id) || done.has(s.txn_id) || s.journal_date > recent(12)) continue
      used.add(s.line_id); done.add(s.txn_id)
      await e.setBankMatch(s.txn_id, s.line_id, 'matched', 'Matched on amount and date')
    }
  })

  // ---------------------------------------------------------------- approved budgets for the current fiscal year
  const fy = fiscalYearOf(TODAY)
  const fyFrom = `${fy}-04-01`
  const budgetDate = fyFrom < START ? START : fyFrom
  for (const co of Object.keys(C)) {
    const actual = new Map<ID, number>()
    for (const l of e.lines) {
      if (l.company_id !== C[co]) continue
      const a = e.account(l.account_id)!
      if (a.type !== 'expense') continue
      actual.set(a.id, (actual.get(a.id) ?? 0) + Number(l.debit) - Number(l.credit))
    }
    const lines = [...actual.entries()].filter(([, v]) => v > 0).flatMap(([account_id, v]) => {
      const monthly = Math.round(((v / months.length) * (0.88 + rand() * 0.3)) / 1000) * 1000
      return Array.from({ length: 12 }, (_, i) => ({ account_id, period_month: addMonths(fyFrom, i), amount: String(monthly) }))
    })
    if (!lines.length) continue
    const bid = await as(CHECKER, budgetDate, () => e.saveBudget({ company_id: C[co], name: 'Operating budget', fy, kind: 'opex', limit_mode: 'soft', lines }))
    await as(OWNER, budgetDate, () => e.setBudgetStatus(bid, 'approved'))
  }

  // ---------------------------------------------------------------- learned preferences, custom fields, team
  e.numiRules.push(
    { id: 'nr-1', company_id: C.JB, pattern: 'facebook', party_id: P.meta, account_id: acc('JB', '6310'), approved_count: 14, status: 'active', last_used_at: at(recent(9)) },
    { id: 'nr-2', company_id: C.JB, pattern: 'google ads', party_id: P.google, account_id: acc('JB', '6310'), approved_count: 12, status: 'active', last_used_at: at(recent(11)) },
    { id: 'nr-3', company_id: C.GIV, pattern: 'aws', party_id: P.aws, account_id: acc('GIV', '6620'), approved_count: 11, status: 'active', last_used_at: at(recent(15)) },
  )
  e.customFields.push(
    { id: 'cf-1', group_id: e.group.id, company_id: null, entity: 'party', scope_key: 'broker', key: 'rera_licence', label: 'RERA licence number', field_type: 'text', options: [], rules: {}, is_required: false, status: 'active', version: 1 },
    { id: 'cf-2', group_id: e.group.id, company_id: null, entity: 'party', scope_key: 'broker', key: 'commission_pct', label: 'Commission %', field_type: 'percentage', options: [], rules: { min: 0, max: 10 }, is_required: false, status: 'active', version: 1 },
    { id: 'cf-3', group_id: e.group.id, company_id: C.GCON, entity: 'party', scope_key: 'contractor', key: 'retention_pct', label: 'Retention %', field_type: 'percentage', options: [], rules: {}, is_required: true, status: 'active', version: 1 },
  )
  e.members.push(
    { id: 'm-1', user_id: 'demo-accountant', email: 'priya@demo.numero', full_name: 'Priya Raman', company_id: C.JB, role_key: 'accountant' },
    { id: 'm-2', user_id: 'demo-accountant', email: 'priya@demo.numero', full_name: 'Priya Raman', company_id: C.GCON, role_key: 'accountant' },
    { id: 'm-3', user_id: 'demo-finance', email: 'arun@demo.numero', full_name: 'Arun Mehta', company_id: C.JB, role_key: 'finance_head' },
    { id: 'm-4', user_id: 'demo-finance', email: 'arun@demo.numero', full_name: 'Arun Mehta', company_id: C.GMED, role_key: 'finance_head' },
  )

  // ---------------------------------------------------------------- operations: assets, payroll, advances, purchasing, treasury, registers
  const ctx = { e, C, P, START, TODAY, MAKER, CHECKER, OWNER, payrollMonth, rand, as, acc, bank, dim, party, tax }
  await seedDemoOps(ctx)

  // ---------------------------------------------------------------- stock, investments and funds, reality and control, the platform
  await seedDemoP3(ctx, stockEvents, CUT)

  // ---------------------------------------------------------------- sentinel run + period close state
  for (const co of Object.keys(C)) await as(OWNER, TODAY, () => e.runSentinel(C[co]))
  const lockBefore = startOfMonth(addMonths(TODAY, -2))
  for (const co of Object.keys(C)) {
    for (const m of months) {
      const closedOn = addDays(endOfMonth(m), 12) > TODAY ? TODAY : addDays(endOfMonth(m), 12)
      if (m < lockBefore) await as(OWNER, closedOn, () => e.setPeriodStatus(C[co], m, 'locked', 'Month-end close approved'))
      else if (m === lockBefore) await as(CHECKER, TODAY, () => e.setPeriodStatus(C[co], m, 'soft_closed', 'Provisional close — pending final review'))
    }
  }
  await finishDemoP3(ctx)
  e.actor = OWNER
  e.clock = null
}

let instance: Promise<DemoEngine> | null = null
/** Builds the demo universe once. Any seeding failure rejects loudly rather than showing partial books. */
export function getDemoEngine(): Promise<DemoEngine> {
  if (!instance) {
    const e = new DemoEngine()
    instance = seedDemo(e).then(() => e)
  }
  return instance
}
export function resetDemoEngine() { instance = null }
