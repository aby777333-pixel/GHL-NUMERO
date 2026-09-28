import { D } from '@/lib/money'
import { addDays, addMonths, endOfMonth, startOfMonth } from '@/lib/dates'
import type { ID } from '@/engine/types'
import type { RegisterItemInput, SalaryComponent } from '@/engine/opsTypes'
import type { DemoEngine } from './demo'

// =====================================================================
// SAMPLE DATA for the operations modules (phase 2). Fictional, in memory
// only, and produced by driving the same engine a person would use:
// request → approval → proposed journal → approval → posting.
// =====================================================================

export interface SeedCtx {
  e: DemoEngine
  C: Record<string, ID>
  P: Record<string, ID>
  START: string
  TODAY: string
  MAKER: ID
  CHECKER: ID
  OWNER: ID
  /** the month whose salaries are posted through payroll instead of a direct journal */
  payrollMonth: string
  rand: () => number
  as: <T>(actor: ID, date: string, fn: () => Promise<T>, time?: string) => Promise<T>
  acc: (co: string, code: string) => ID
  bank: (co: string) => ID
  dim: (co: string, key: string, code: string) => Record<string, ID>
  party: (co: string, type_key: string, display_name: string, o?: { kind?: 'person' | 'organization'; date?: string }) => Promise<ID>
  tax: (co: string, code: string) => ID
}

export async function seedDemoOps(x: SeedCtx): Promise<void> {
  const { e, C, P, START, TODAY, MAKER, CHECKER, OWNER, as, acc, bank, dim, party, tax, rand } = x
  const ago = (n: number) => { const d = addDays(TODAY, -n); return d < START ? START : d }
  const ahead = (n: number) => addDays(TODAY, n)
  const hex = () => Array.from({ length: 64 }, () => Math.floor(rand() * 16).toString(16)).join('')

  /** approves a proposed journal with people who did not prepare it, as many steps as its rule asks for */
  const approve = async (journalId: ID, date: string) => {
    const j = e.journals.find((q) => q.id === journalId)!
    const d = date > TODAY ? TODAY : date
    const people = (j.confidentiality === 'internal' ? [CHECKER, OWNER, MAKER] : [CHECKER, OWNER]).filter((p) => p !== j.created_by)
    for (let i = 0; i < 4 && j.status === 'submitted'; i++) await as(people[i % people.length], d, () => e.approveJournal(journalId, 'Checked against the source record'))
    if (j.status !== 'posted') throw new Error('seed: workflow journal did not post — ' + j.narration)
  }

  // ---------------------------------------------------------------- fixed assets (GHL Medical Equipment)
  const plant = await as(MAKER, START, () => e.saveAssetCategory({ company_id: C.GMED, name: 'Plant & demonstration equipment', asset_account_id: acc('GMED', '1320'), accum_account_id: acc('GMED', '1390'), expense_account_id: acc('GMED', '7100'), method: 'slm', life_months: 96, wdv_rate: null }))
  const vehicles = await as(MAKER, START, () => e.saveAssetCategory({ company_id: C.GMED, name: 'Vehicles', asset_account_id: acc('GMED', '1340'), accum_account_id: acc('GMED', '1390'), expense_account_id: acc('GMED', '7100'), method: 'wdv', life_months: null, wdv_rate: 15 }))
  const svc = dim('GMED', 'department', 'SVC').department ?? null
  const sal = dim('GMED', 'department', 'SAL').department ?? null
  const assets: ID[] = []
  for (const [name, cat, cost, unit, serial, location] of [
    ['CT scanner — demonstration unit', plant, 5400000, sal, 'CT-DX-88213', 'Experience centre, Chennai'],
    ['Ultrasound system — demonstration unit', plant, 3600000, sal, 'US-LG-40177', 'Experience centre, Chennai'],
    ['Service van TN-38-CK-2210', vehicles, 2100000, svc, 'MA3FJEB1S00412', 'Service depot, Coimbatore'],
    ['Service van TN-38-CK-2264', vehicles, 1500000, svc, 'MA3FJEB1S00498', 'Service depot, Coimbatore'],
  ] as const) {
    assets.push(await as(MAKER, START, () => e.saveAsset({ company_id: C.GMED, name, category_id: cat, acquisition_date: START, cost, org_unit_id: unit, serial_no: serial, location, warranty_until: addMonths(START, 24) })))
  }
  for (let m = startOfMonth(START); endOfMonth(m) <= TODAY; m = addMonths(m, 1)) {
    const run = await as(MAKER, endOfMonth(m), () => e.createDepreciationRun(C.GMED, m))
    const j = await as(MAKER, endOfMonth(m), () => e.proposeDepreciationRun(run))
    await approve(j, addDays(endOfMonth(m), 2))
  }
  await as(MAKER, ago(40), () => e.recordAssetEvent({ asset_id: assets[2], event_type: 'maintenance', event_date: ago(40), amount: 18400, detail: { work: 'Scheduled service and brake pads', vendor: 'Authorised service centre', next_due: ahead(140) } }))
  await as(MAKER, ago(12), () => e.recordAssetEvent({ asset_id: assets[0], event_type: 'verification', event_date: ago(12), detail: { result: 'located', verified_by: 'Internal audit', note: 'Tag intact' } }))
  await as(MAKER, ago(12), () => e.recordAssetEvent({ asset_id: assets[3], event_type: 'verification', event_date: ago(12), detail: { result: 'damaged', verified_by: 'Internal audit', note: 'Rear panel damaged; repair estimate awaited' } }))

  // ---------------------------------------------------------------- people and payroll (Jamin Bazaar)
  const staff: { key: string; name: string; title: string; dept: string; gross: number; tax: number; conf?: 'restricted'; approved?: boolean }[] = [
    { key: 'md', name: 'Vikram Subramanian', title: 'Managing Director', dept: 'ADM', gross: 600000, tax: 150000, conf: 'restricted' },
    { key: 'saleshead', name: 'Anitha Krishnan', title: 'Head of Sales', dept: 'SAL', gross: 320000, tax: 62000 },
    { key: 'fin', name: 'Karthik Narayanan', title: 'Finance Manager', dept: 'FIN', gross: 260000, tax: 44000 },
    { key: 'pm', name: 'Deepa Venkatesh', title: 'Project Manager', dept: 'ADM', gross: 240000, tax: 38000 },
    { key: 'legal', name: 'Mohammed Irfan', title: 'Legal Officer', dept: 'ADM', gross: 190000, tax: 24000 },
    { key: 'exec1', name: 'Suresh Babu', title: 'Sales Executive', dept: 'SAL', gross: 150000, tax: 14000 },
    { key: 'exec2', name: 'Meena Rajagopal', title: 'Sales Executive', dept: 'SAL', gross: 150000, tax: 14000 },
    { key: 'site', name: 'Murugan Selvam', title: 'Site Supervisor', dept: 'ADM', gross: 120000, tax: 8000 },
    { key: 'admin', name: 'Lakshmi Priya', title: 'Office Administrator', dept: 'ADM', gross: 80000, tax: 0 },
    { key: 'trainee', name: 'Arjun Prakash', title: 'Management Trainee', dept: 'SAL', gross: 45000, tax: 0, approved: false },
  ]
  const S: Record<string, { party: ID; emp: ID }> = {}
  for (const s of staff) {
    const pid = await party('JB', 'employee', s.name, { kind: 'person' })
    const who = s.conf ? OWNER : MAKER
    const joined = s.key === 'trainee' ? addDays(x.payrollMonth, 10) : addMonths(START, -14)
    const emp = await as(who, START, () => e.saveEmployee({ company_id: C.JB, party_id: pid, join_date: joined, designation: s.title, department_id: dim('JB', 'department', s.dept).department ?? null, confidentiality: s.conf ?? 'internal', payment_method: 'Bank transfer' }))
    const basic = Math.round(s.gross * 0.5)
    const components: SalaryComponent[] = [
      { name: 'Basic salary', kind: 'earning', amount: basic },
      { name: 'House rent allowance', kind: 'earning', amount: Math.round(s.gross * 0.3) },
      { name: 'Special allowance', kind: 'earning', amount: s.gross - basic - Math.round(s.gross * 0.3) },
      { name: 'Provident fund — employee', kind: 'deduction', type: 'statutory', amount: Math.round(basic * 0.12) },
      { name: 'Income tax deducted', kind: 'deduction', type: 'tax', amount: s.tax },
      { name: 'Provident fund — employer', kind: 'employer', type: 'statutory', amount: Math.round(basic * 0.12) },
    ]
    const st = await as(who, s.key === 'trainee' ? joined : START, () => e.saveSalaryStructure({ employee_id: emp, effective_from: s.key === 'trainee' ? joined : START, reason: s.key === 'trainee' ? 'Joining salary — offer letter awaited' : 'Salary at the start of the year', components }))
    if (s.approved !== false) await as(s.conf ? OWNER : CHECKER, START, () => e.decideSalaryStructure(st, 'approved', 'As per appointment letter'))
    S[s.key] = { party: pid, emp }
  }
  // an increment approved for a future date: history is added to, never overwritten
  const rev = await as(MAKER, ago(6), () => e.saveSalaryStructure({ employee_id: S.exec1.emp, effective_from: startOfMonth(addMonths(TODAY, 1)), reason: 'Annual increment — performance review', components: [
    { name: 'Basic salary', kind: 'earning', amount: 84000 }, { name: 'House rent allowance', kind: 'earning', amount: 50400 }, { name: 'Special allowance', kind: 'earning', amount: 33600 },
    { name: 'Provident fund — employee', kind: 'deduction', type: 'statutory', amount: 10080 }, { name: 'Income tax deducted', kind: 'deduction', type: 'tax', amount: 17000 },
    { name: 'Provident fund — employer', kind: 'employer', type: 'statutory', amount: 10080 },
  ] }))
  await as(CHECKER, ago(5), () => e.decideSalaryStructure(rev, 'approved', 'Approved in the review meeting'))

  // ---------------------------------------------------------------- expense policy, advances and claims (Jamin Bazaar)
  const cat: Record<string, ID> = {}
  for (const [name, code, perItem, perDay, receipt, guidance] of [
    ['Airfare', '6410', 18000, null, 0, 'Economy class. Book at least seven days ahead where possible.'],
    ['Hotel', '6420', 6500, null, 0, 'Per night, including taxes.'],
    ['Local conveyance', '6430', 2500, 4000, 500, 'Taxi, auto and metro within the city.'],
    ['Fuel', '6440', 6000, null, 300, 'Company vehicles and approved personal vehicles only.'],
    ['Meals', '6450', 1200, 1800, 500, 'Per person. Alcohol is not reimbursed.'],
    ['Toll & parking', '6460', 1000, null, 200, null],
    ['Client entertainment', '6850', 15000, null, 0, 'Record the client and the business purpose.'],
  ] as const) {
    cat[name] = await as(CHECKER, START, () => e.saveExpenseCategory({ company_id: C.JB, name, account_id: acc('JB', code), limit_per_item: perItem, limit_per_day: perDay, receipt_required_above: receipt, max_age_days: 60, guidance }))
  }
  const rubycon = dim('JB', 'project', 'PRJ-RUBYCON')
  const salesDept = dim('JB', 'department', 'SAL')
  const advance = async (who: ID, purpose: string, amount: number, requested: string, o: { approve?: number | false; release?: string; settleBy?: string; dims?: Record<string, ID>; type?: string } = {}) => {
    const id = await as(MAKER, requested, () => e.saveAdvance({ company_id: C.JB, recipient_party_id: who, purpose, requested_amount: amount, expected_settlement_date: o.settleBy ?? addDays(requested, 21), dims: o.dims ?? {}, recipient_type: o.type ?? 'employee', payment_method: 'Bank transfer' }))
    await as(MAKER, requested, () => e.submitAdvance(id))
    if (o.approve === false) return id
    const granted = typeof o.approve === 'number' ? o.approve : amount
    await as(CHECKER, addDays(requested, 1) > TODAY ? TODAY : addDays(requested, 1), () => e.approveAdvance(id, granted, 'Purpose and estimate reviewed'))
    if (o.release) {
      const j = await as(MAKER, o.release, () => e.releaseAdvance(id, { amount: granted, bank_ledger_id: bank('JB'), date: o.release!, reference: 'UTR' + Math.floor(1e9 + rand() * 9e9), method: 'Bank transfer' }))
      await approve(j, o.release)
    }
    return id
  }
  const adv1 = await advance(S.site.party, 'Registration and stamp duty incidentals — Rubycon phase 2', 150000, ago(44), { release: ago(42), settleBy: ago(20), dims: rubycon, type: 'site' })
  await advance(S.exec1.party, 'Travel advance — investor roadshow, Bengaluru and Hyderabad', 60000, ago(78), { release: ago(76), settleBy: ago(55), dims: salesDept, type: 'travel' })
  await advance(S.exec1.party, 'Travel advance — property expo, Kochi', 90000, ago(2), { approve: false, dims: salesDept, type: 'travel' })
  await advance(S.pm.party, 'Site survey consumables', 25000, ago(4), { dims: rubycon, type: 'project' })

  const claim = async (who: ID, title: string, date: string, lines: Parameters<DemoEngine['saveClaim']>[0]['lines'], o: { advance?: ID; final?: boolean; stop?: 'draft' | 'submitted' | 'posted'; comment?: string } = {}) => {
    const id = await as(MAKER, date, () => e.saveClaim({ company_id: C.JB, claimant_party_id: who, title, advance_id: o.advance ?? null, final_settlement: o.final, lines }))
    if (o.stop === 'draft') return id
    await as(MAKER, date, () => e.submitClaim(id))
    if (o.stop === 'submitted') return id
    await as(CHECKER, date, () => e.approveClaim(id, o.comment ?? 'Receipts checked against the claim'))
    await approve(e.claims.find((c) => c.id === id)!.journal_id!, date)
    if (o.stop === 'posted') return id
    const c = e.claims.find((q) => q.id === id)!
    if (c.status === 'posted') { const j = await as(MAKER, date, () => e.payClaim(id, { bank_ledger_id: bank('JB'), date, reference: 'UTR' + Math.floor(1e9 + rand() * 9e9) })); await approve(j, date) }
    return id
  }
  const c1 = await claim(S.site.party, 'Registration incidentals — Rubycon phase 2', ago(18), [
    { expense_date: ago(38), account_id: acc('JB', '5060'), description: 'Document writer and registration handling charges', merchant: 'Sri Balaji Document Writers', amount: 64000, has_receipt: true, dims: rubycon },
    { expense_date: ago(37), account_id: acc('JB', '5060'), description: 'Encumbrance certificates and certified copies', merchant: 'Sub-Registrar Office', amount: 28400, has_receipt: true, dims: rubycon },
    { expense_date: ago(36), category_id: cat['Local conveyance'], description: 'Vehicle hire for site and registrar visits', merchant: 'Kovai Cabs', amount: 3600, has_receipt: true, dims: rubycon },
    { expense_date: ago(36), category_id: cat['Meals'], description: 'Meals for the survey team (6 people)', merchant: 'Annapoorna', amount: 4400, has_receipt: true, dims: rubycon },
    { expense_date: ago(35), account_id: acc('JB', '5060'), description: 'Notary and affidavit charges', amount: 18000, dims: rubycon },
  ], { advance: adv1, final: true, comment: 'Meals cover six people; notary receipt to follow — confirmed by the project manager' })
  await claim(S.fin.party, 'Statutory audit visit — Chennai', ago(24), [
    { expense_date: ago(30), category_id: cat['Airfare'], description: 'Coimbatore – Chennai – Coimbatore', merchant: 'IndiGo', amount: 9850, has_receipt: true, detail: { kind: 'air', operator: 'IndiGo', booking_ref: 'QX7L2M', origin: 'Coimbatore', destination: 'Chennai', class: 'Economy', travel_date: ago(30), purpose: 'Statutory audit visit', base_fare: 7420, taxes: 1580, booking_charges: 350, seat: 500 } },
    { expense_date: ago(30), category_id: cat['Hotel'], description: 'One night', merchant: 'Residency Towers', amount: 5900, has_receipt: true, detail: { kind: 'hotel', operator: 'Residency Towers', booking_ref: 'RT-88214', city: 'Chennai', check_in: ago(30), check_out: ago(29), room_charges: 4600, taxes: 552, meals: 748 } },
    { expense_date: ago(29), category_id: cat['Local conveyance'], description: 'Airport transfers', merchant: 'Ola', amount: 1850, has_receipt: true },
    { expense_date: ago(29), category_id: cat['Meals'], description: 'Working lunch', amount: 1050, has_receipt: true },
  ])
  const c3 = await claim(S.exec2.party, 'Client site visits — Lakshmi Estates', ago(3), [
    { expense_date: ago(9), category_id: cat['Hotel'], description: 'Two nights, Chennai', merchant: 'The Park', amount: 17800, has_receipt: true, dims: salesDept },
    { expense_date: ago(9), category_id: cat['Client entertainment'], description: 'Dinner with the client team', merchant: 'Dakshin', amount: 11200, has_receipt: true, dims: salesDept },
    { expense_date: ago(8), category_id: cat['Local conveyance'], description: 'Taxi — full day', amount: 3900, dims: salesDept },
    { expense_date: ago(8), category_id: cat['Fuel'], description: 'Fuel', merchant: 'Indian Oil', amount: 2400, has_receipt: true, dims: salesDept },
  ], { stop: 'submitted' })
  await claim(S.saleshead.party, 'Property expo — stall expenses', ago(1), [
    { expense_date: ago(5), category_id: cat['Client entertainment'], description: 'Refreshments for visitors', amount: 6200, has_receipt: true, dims: salesDept },
  ], { stop: 'draft' })

  // salary advance recovered through payroll
  const salAdv = await advance(S.admin.party, 'Salary advance — medical expenses', 40000, addDays(x.payrollMonth, -12), { release: addDays(x.payrollMonth, -10), settleBy: addMonths(x.payrollMonth, 4) })

  // payroll for the last completed month, posted and paid through the workflow
  const payDay = endOfMonth(x.payrollMonth)
  const run = await as(MAKER, payDay, () => e.createPayrollRun({ company_id: C.JB, month: x.payrollMonth, notes: 'Regular monthly payroll', adjustments: [
    { employee_id: S.saleshead.emp, name: 'Sales incentive — quarter', kind: 'earning', type: 'incentive', amount: 85000 },
    { employee_id: S.exec2.emp, name: 'Sales incentive — quarter', kind: 'earning', type: 'incentive', amount: 32000 },
    { employee_id: S.admin.emp, name: 'Salary advance recovery (1 of 4)', kind: 'deduction', type: 'advance_recovery', amount: 10000, advance_id: salAdv },
  ] }))
  await approve(await as(MAKER, payDay, () => e.proposePayrollRun(run)), payDay)
  await approve(await as(MAKER, payDay, () => e.payPayrollRun(run, { bank_ledger_id: bank('JB'), date: payDay, reference: 'BULK-SAL-' + x.payrollMonth.slice(0, 7) })), payDay)

  // ---------------------------------------------------------------- petty cash and fund transfers
  const box = await as(CHECKER, START, () => e.saveCashBox({ company_id: C.JB, name: 'Head Office Petty Cash', ledger_account_id: acc('JB', '1115'), custodian_party_id: S.admin.party, custodian_name: 'Lakshmi Priya', float_amount: 50000, min_balance: 10000, max_single_payment: 5000 }))
  const topUp = await as(MAKER, ago(11), () => e.proposeFundTransfer({ company_id: C.JB, from_ledger_id: bank('JB'), to_ledger_id: acc('JB', '1115'), amount: 25000, transfer_date: ago(11), purpose: 'Petty cash top-up to float', reference: 'CHQ 004471' }))
  await approve(e.transfers.find((t) => t.id === topUp)!.journal_id!, ago(11))
  const book = (await e.ledgerBalances([C.JB], '1990-01-01', ago(5))).filter((b) => b.account_id === acc('JB', '1115')).reduce((s, b) => s.plus(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), D(0))
  await as(CHECKER, ago(5), () => e.recordCashCount({ box_id: box, count_date: ago(5), counted_total: book.minus(350).toString(), note: 'Surprise count. Custodian states a courier payment of 350 is awaiting its voucher.', witness_name: 'Karthik Narayanan' }))
  await as(MAKER, TODAY, () => e.proposeFundTransfer({ company_id: C.GIV, to_company_id: C.GWELL, from_ledger_id: bank('GIV'), to_ledger_id: bank('GWELL'), amount: 2000000, transfer_date: TODAY, purpose: 'Working capital support for festival season stock', reference: 'RTGS — to be released' }))

  // ---------------------------------------------------------------- purchase-to-pay (GHL Constructions)
  const skyline = dim('GCON', 'project', 'PRJ-SKYLINE')
  const salem = await party('GCON', 'supplier', 'Salem Steel Syndicate', { date: ago(30) })
  const req = await as(MAKER, ago(28), () => e.savePurchaseDoc({ company_id: C.GCON, kind: 'requisition', doc_date: ago(28), title: 'TMT steel for Skyline Towers — level 9 to 12', reason: 'Slab cycle for levels 9–12 begins next month; stock on site covers only level 8', required_date: ago(6), dims: skyline, lines: [{ description: 'TMT bars Fe 550D, 12 mm and 16 mm', quantity: 40, unit: 'MT', rate: 58000, account_id: acc('GCON', '5070'), dims: skyline }] }))
  await as(MAKER, ago(28), () => e.submitPurchaseDoc(req))
  await as(CHECKER, ago(27), () => e.approvePurchaseDoc(req, 'Within the project budget'))
  const rfq = await as(MAKER, ago(26), () => e.savePurchaseDoc({ company_id: C.GCON, kind: 'rfq', doc_date: ago(26), parent_id: req, title: 'RFQ — TMT steel 40 MT', valid_until: ago(16), lines: [{ description: 'TMT bars Fe 550D, 12 mm and 16 mm', quantity: 40, unit: 'MT' }] }))
  await as(MAKER, ago(26), () => e.submitPurchaseDoc(rfq))
  const quote = (vendor: ID, rate: number, delivery: string, terms: string, warranty: string) => as(MAKER, ago(22), async () => {
    const id = await e.savePurchaseDoc({ company_id: C.GCON, kind: 'quotation', doc_date: ago(22), party_id: vendor, parent_id: rfq, valid_until: ahead(8), delivery_terms: delivery, payment_terms: terms, warranty, lines: [{ description: 'TMT bars Fe 550D, 12 mm and 16 mm', quantity: 40, unit: 'MT', rate, tax_code_id: tax('GCON', 'GST18'), account_id: acc('GCON', '5070') }] })
    await e.submitPurchaseDoc(id)
    return id
  })
  const q1 = await quote(P.steel, 58500, 'Delivered to site within 5 days', '35 days credit', 'Mill test certificate with every lot')
  await quote(salem, 57200, 'Ex-works Salem; delivery 21 days', '50% advance, balance on delivery', 'Mill test certificate on request')
  await as(CHECKER, ago(20), () => e.selectQuotation(q1, 'Delivery in 5 days keeps the slab cycle on schedule; existing credit terms avoid an advance. The price difference is 1,300 per MT.'))
  const po = await as(MAKER, ago(19), () => e.savePurchaseDoc({ company_id: C.GCON, kind: 'purchase_order', doc_date: ago(19), party_id: P.steel, parent_id: q1, title: 'TMT steel for Skyline Towers', required_date: ago(6), delivery_terms: 'Delivered to site within 5 days', payment_terms: '35 days credit', dims: skyline, lines: [{ description: 'TMT bars Fe 550D, 12 mm and 16 mm', quantity: 40, unit: 'MT', rate: 58500, tax_code_id: tax('GCON', 'GST18'), account_id: acc('GCON', '5070'), dims: skyline }] }))
  await as(MAKER, ago(19), () => e.submitPurchaseDoc(po))
  await as(CHECKER, ago(18), () => e.approvePurchaseDoc(po, 'Vendor selection recorded; within budget'))
  const poLine = (await e.getPurchaseDoc(po)).lines![0].id
  const grn = await as(MAKER, ago(10), () => e.savePurchaseDoc({ company_id: C.GCON, kind: 'goods_receipt', doc_date: ago(10), parent_id: po, title: 'First lot received at site', lines: [{ description: 'TMT bars Fe 550D, 12 mm and 16 mm', quantity: 25, source_line_id: poLine, condition: 'Good. Weighbridge slip attached.' }] }))
  await as(MAKER, ago(10), () => e.submitPurchaseDoc(grn))
  const bill = await as(MAKER, ago(8), () => e.saveInvoice({ company_id: C.GCON, doc_type: 'purchase_bill', party_id: P.steel, doc_date: ago(8), due_date: ahead(27), reference: 'SMX/' + Math.floor(1e4 + rand() * 9e4), narration: 'TMT steel — first lot against purchase order', lines: [{ account_id: acc('GCON', '5070'), quantity: 25, rate: 58500, tax_code_id: tax('GCON', 'GST18'), description: 'TMT bars Fe 550D, 12 mm and 16 mm', dims: skyline }] }))
  await as(MAKER, ago(8), () => e.linkBillToPo(bill, po))
  await as(CHECKER, ago(8), () => e.approveInvoice(bill))
  const po2 = await as(MAKER, ago(2), () => e.savePurchaseDoc({ company_id: C.GCON, kind: 'purchase_order', doc_date: ago(2), party_id: P.equip, title: 'Tower crane hire — 3 months', required_date: ahead(12), payment_terms: 'Monthly in arrears', dims: skyline, lines: [{ description: 'Tower crane hire with operator', quantity: 3, unit: 'month', rate: 385000, tax_code_id: tax('GCON', 'GST18'), account_id: acc('GCON', '5090'), dims: skyline }] }))
  await as(MAKER, ago(2), () => e.submitPurchaseDoc(po2))

  // ---------------------------------------------------------------- treasury
  const kotak = await party('GMED', 'lender', 'Kotak Mahindra Bank')
  const loanStart = ago(155)
  const loan = await as(MAKER, loanStart, () => e.saveLoan({ company_id: C.GMED, name: 'Vehicle loan — service vans', kind: 'vehicle_loan', party_id: kotak, principal: 2400000, rate_pct: 9.5, start_date: loanStart, first_due_date: addMonths(loanStart, 1), tenure_months: 36, loan_account_id: acc('GMED', '2210'), interest_account_id: acc('GMED', '7010'), sanction_ref: 'KMB/VL/2291', security: 'Hypothecation of the two service vans' }))
  await approve(await as(MAKER, loanStart, () => e.disburseLoan(loan, { amount: 2400000, bank_ledger_id: bank('GMED'), date: loanStart })), loanStart)
  for (const s of (await e.listLoanSchedule({ loanId: loan })).filter((r) => r.due_date <= ago(3))) {
    await approve(await as(MAKER, s.due_date, () => e.payLoanInstalment(s.id, { bank_ledger_id: bank('GMED'), date: s.due_date, reference: 'ECS ' + s.due_date })), s.due_date)
  }
  await as(MAKER, ago(3), () => e.saveLoan({ company_id: C.JB, name: 'Staff loan — two-wheeler', kind: 'employee_loan', direction: 'lent', party_id: S.site.party, principal: 120000, rate_pct: 0, start_date: TODAY, first_due_date: endOfMonth(addMonths(TODAY, 1)), tenure_months: 12, repayment: 'equal_principal', loan_account_id: acc('JB', '1195'), interest_account_id: acc('JB', '4910'), notes: 'To be recovered from salary' }))

  const fd1Start = ago(95)
  const fd1 = await as(MAKER, fd1Start, () => e.saveFixedDeposit({ company_id: C.GIV, bank_party_id: null, bank_name: 'HDFC Bank', reference: 'FD 5012 8841 7730', principal: 20000000, rate_pct: 7.1, compounding: 'quarterly', start_date: fd1Start, maturity_date: addMonths(fd1Start, 12), fd_account_id: acc('GIV', '1210'), interest_account_id: acc('GIV', '4910') }))
  await approve(await as(MAKER, fd1Start, () => e.placeFixedDeposit(fd1, { bank_ledger_id: bank('GIV') })), fd1Start)
  const fd2Start = addDays(ahead(20), -365) < addDays(START, 5) ? addDays(START, 5) : addDays(ahead(20), -365)
  const fd2 = await as(MAKER, fd2Start, () => e.saveFixedDeposit({ company_id: C.GIV, bank_name: 'ICICI Bank', reference: 'FD 0098 2210 4456', principal: 10000000, rate_pct: 6.8, compounding: 'quarterly', start_date: fd2Start, maturity_date: ahead(20), fd_account_id: acc('GIV', '1210'), interest_account_id: acc('GIV', '4910'), lien_marked: true, lien_note: 'Margin for performance guarantee issued for GHL Constructions' }))
  await approve(await as(MAKER, fd2Start, () => e.placeFixedDeposit(fd2, { bank_ledger_id: bank('GIV') })), fd2Start)

  // ---------------------------------------------------------------- registers: what has been agreed, and what could go wrong
  const reg = (co: string, p: Omit<RegisterItemInput, 'company_id'>, date = START) => as(p.confidentiality && p.confidentiality !== 'internal' ? CHECKER : MAKER, date, () => e.saveRegisterItem({ ...p, company_id: C[co] }))
  const nextOn = (day: number) => { const d = addDays(startOfMonth(TODAY), day - 1); return d >= TODAY ? d : addDays(startOfMonth(addMonths(TODAY, 1)), day - 1) }
  const R: Record<string, ID> = {}
  R.aws = await reg('GIV', { kind: 'subscription', title: 'AWS cloud infrastructure', party_id: P.aws, account_id: acc('GIV', '6620'), amount: 96000, frequency: 'monthly', start_date: START, next_due: nextOn(12), certainty: 'expected', auto_renew: true, owner_name: 'Arun Mehta', data: { plan: 'Pay as you go', used_by: 'Group IT', payment_method: 'Corporate card' }, notes: 'Amount varies with usage; the figure is the recent monthly average.' })
  R.m365 = await reg('GIV', { kind: 'software_licence', title: 'Microsoft 365 Business — 60 seats', account_id: acc('GIV', '6610'), amount: 540000, frequency: 'yearly', start_date: addDays(ahead(24), -365), next_due: ahead(24), renewal_date: ahead(24), cancel_by: ahead(10), auto_renew: true, owner_name: 'Arun Mehta', data: { seats: 60, used_by: 'All companies', licence_key_ref: 'MSFT-CSP-77120' } })
  R.dno = await reg('GIV', { kind: 'insurance', title: 'Directors and officers liability cover', account_id: acc('GIV', '6290'), amount: 380000, frequency: 'yearly', start_date: addDays(ahead(52), -365), end_date: ahead(52), next_due: ahead(45), renewal_date: ahead(52), owner_name: 'Arun Mehta', confidentiality: 'confidential', data: { policy_no: 'DNO/2291/0048', cover_type: 'Liability', sum_insured: 100000000, insured_object: 'Directors and key officers of the group', expiry: ahead(52) } }, ago(300))
  R.rent = await reg('GIV', { kind: 'rent', title: 'Head office rent — Anna Salai', account_id: acc('GIV', '6210'), amount: 185370, frequency: 'monthly', start_date: START, next_due: nextOn(3), end_date: addMonths(START, 36), certainty: 'contracted', escalation_pct: 5, escalation_date: addMonths(START, 12), escalation_months: 12, owner_name: 'Karthik Narayanan', data: { premises: '4th floor, Anna Salai, Chennai', deposit: 1112220, lock_in_until: addMonths(START, 24), notice_days: 90 } })
  await reg('GIV', { kind: 'compliance', title: 'GST return and payment — GSTR-3B', amount: 0, frequency: 'monthly', start_date: START, next_due: nextOn(20), owner_name: 'Karthik Narayanan', data: { requirement: 'GST', period_covered: 'Previous month', reviewer: 'Meridian Advisory LLP', estimate_basis: 'Amount is taken from the GST ledgers at filing; no estimate is recorded here' } })
  await reg('GIV', { kind: 'compliance', title: 'TDS payment', amount: 0, frequency: 'monthly', start_date: START, next_due: nextOn(7), owner_name: 'Karthik Narayanan', data: { requirement: 'TDS', period_covered: 'Previous month', reviewer: 'Meridian Advisory LLP' } })
  R.legal = await reg('JB', { kind: 'legal_claim', title: 'Boundary dispute — Survey No. 214, Project Monarch', party_id: P.legal, amount: 4200000, direction: 'out', frequency: 'once', next_due: ahead(160), certainty: 'contingent', state: 'disputed', owner_name: 'Mohammed Irfan', data: { case_no: 'O.S. 418/2026', forum: 'District Munsif Court, Coimbatore', legal_status: 'Written statement filed; evidence stage', probability_class: 'Possible', assessed_by: 'Shree Legal Associates', accounting_treatment: 'Disclosed as a contingent liability; no provision', next_hearing: ahead(33) }, notes: 'The amount is the claim as filed by the plaintiff. It is not a forecast of the outcome.' }, ago(120))
  R.innova = await reg('JB', { kind: 'vehicle', title: 'Toyota Innova Crysta — TN-38-BX-4471', account_id: acc('JB', '6700'), owner_name: 'Lakshmi Priya', data: { registration_no: 'TN38BX4471', make_model: 'Toyota Innova Crysta 2.4 GX', fuel_type: 'Diesel', ownership: 'Owned', driver: 'Pool vehicle — sales', fastag_id: '34161FA820328', odometer: 61240, insurance_expiry: ahead(18), puc_expiry: ago(5), fitness_expiry: ahead(410), next_service: ahead(26) } })
  await reg('JB', { kind: 'quotation', title: 'Bulk booking — 14 plots, Project Rubycon', party_id: P.lakshmi, amount: 25000000, direction: 'in', frequency: 'once', next_due: ahead(45), certainty: 'possible', state: 'negotiating', probability: 40, owner_name: 'Anitha Krishnan', data: { items: '14 plots, phase 2', valid_until: ahead(21) }, notes: 'Probability entered by the Head of Sales. Not booked as revenue.' }, ago(12))
  R.trip = await reg('JB', { kind: 'trip', title: 'Property expo — Kochi', amount: 140000, direction: 'out', frequency: 'once', start_date: ahead(9), end_date: ahead(12), next_due: ahead(9), certainty: 'expected', owner_name: 'Anitha Krishnan', data: { traveller: 'Suresh Babu, Meena Rajagopal', from_place: 'Coimbatore', to_place: 'Kochi', purpose: 'Stall at the South India Property Expo', travel_mode: 'Road', per_diem: 1500 } }, ago(3))
  // the travel advance requested for that trip names it, so the trip's page shows the money handed over for it
  { const a = e.advances.find((x) => /property expo, Kochi/.test(x.purpose)); if (a) a.register_item_id = R.trip }
  await reg('JB', { kind: 'path', title: 'Site petty path — Rubycon', owner_name: 'Murugan Selvam', amount: 0, data: { path_type: 'Site', purpose: 'Small site purchases and labour refreshments', monthly_limit: 60000, evidence_rule: 'Receipt above a limit', settlement_rule: 'Settle monthly', settle_within_days: 7 } })
  R.bg = await reg('GCON', { kind: 'bank_guarantee', title: 'Performance guarantee — NH-44 Flyover Package', party_id: P.tnInfra, amount: 12000000, start_date: addMonths(START, -2), end_date: ahead(41), owner_name: 'Arun Mehta', data: { guarantee_type: 'Performance', beneficiary: 'Tamil Nadu Infra Corporation', issuing_bank: 'ICICI Bank', margin_amount: 10000000, commission: 180000, expiry: ahead(41), claim_expiry: ahead(71) }, notes: 'Margin is held as a fixed deposit in GHL India Ventures.' })
  R.nh44 = await reg('GCON', { kind: 'contract_revenue', title: 'NH-44 Flyover Package — EPC contract', party_id: P.tnInfra, account_id: acc('GCON', '4150'), amount: 21000000, direction: 'in', frequency: 'monthly', start_date: START, next_due: nextOn(6), end_date: addMonths(START, 30), total_value: 480000000, certainty: 'expected', org_unit_id: dim('GCON', 'project', 'PRJ-NH44').project, owner_name: 'Project Director', data: { milestones: 'Monthly running bills on certified work', retention_pct: 5, recognition_basis: 'Percentage of completion, certified monthly' }, notes: 'Monthly amount is the average of recent running bills. Contract value is not revenue until work is certified.' })
  await reg('GCON', { kind: 'credit_facility', title: 'Cash credit — HDFC Bank', party_id: P.hdfc, amount: 0, owner_name: 'Arun Mehta', data: { facility_type: 'Cash credit', sanctioned_limit: 50000000, drawn: 0, security: 'Hypothecation of receivables and stock', review_date: ahead(64) } })
  await reg('GMED', { kind: 'insurance', title: 'Marine cargo open policy — imports', account_id: acc('GMED', '6290'), amount: 265000, frequency: 'yearly', start_date: addDays(ahead(75), -365), end_date: ahead(75), next_due: ahead(68), renewal_date: ahead(75), owner_name: 'Imports desk', data: { policy_no: 'MCO/88/4471', cover_type: 'Marine', sum_insured: 60000000, insured_object: 'Imported equipment in transit', expiry: ahead(75) } }, ago(290))
  await reg('GMED', { kind: 'incident', title: 'Service van rear panel damaged in depot', amount: 0, owner_name: 'Service manager', state: 'under_review', data: { incident_type: 'Damage', incident_date: ago(14), location: 'Service depot, Coimbatore', reported_by: 'Internal audit — asset verification', estimated_loss: 42000, recovered: 0, reviewed_by: 'Finance Head' } }, ago(12))
  await reg('GWELL', { kind: 'domain_hosting', title: 'ghlwellness.in — domain and hosting', account_id: acc('GWELL', '6610'), amount: 18500, frequency: 'yearly', next_due: ahead(6), renewal_date: ahead(6), auto_renew: false, data: { domain: 'ghlwellness.in', registrar: 'GoDaddy', expiry: ahead(6) } }, ago(200))
  await reg('GWELL', { kind: 'write_off', title: 'Expired stock — batch HW-2291', amount: 92400, state: 'under_review', owner_name: 'Store manager', data: { what: 'Herbal supplement, 420 units past expiry', justification: 'Cannot be sold; supplier will not take it back', efforts: 'Return requested from the supplier and declined in writing' }, notes: 'The stock adjustment that writes it off is waiting in the approval inbox.' }, ago(2))

  // ---------------------------------------------------------------- documents (descriptions only — sample files are not stored)
  const doc = (co: string, name: string, kind: string, date: string, o: { party?: ID; amount?: number; ref?: string; entity?: string; id?: ID; sha?: string; expires?: string } = {}) =>
    as(MAKER, date, async () => e.registerDocument({ company_id: C[co], name, mime: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', size_bytes: Math.floor(60000 + rand() * 900000), sha256: o.sha ?? hex(), doc_kind: kind, party_id: o.party ?? null, doc_date: date, amount: o.amount ?? null, currency: o.amount ? 'INR' : null, reference: o.ref ?? null, expires_on: o.expires ?? null, entity: o.entity, entity_id: o.id }).id)
  const sameFile = hex()
  await doc('JB', 'registration-handling-receipt.pdf', 'expense_receipt', ago(38), { amount: 64000, entity: 'expense_claims', id: c1 })
  await doc('JB', 'encumbrance-certificates.pdf', 'expense_receipt', ago(37), { amount: 28400, entity: 'expense_claims', id: c1 })
  await doc('JB', 'hotel-the-park.pdf', 'expense_receipt', ago(9), { amount: 17800, entity: 'expense_claims', id: c3, sha: sameFile })
  await doc('JB', 'hotel-the-park (1).pdf', 'unclassified', ago(3), { sha: sameFile })
  await doc('GCON', 'PO-steelmax-signed.pdf', 'purchase_order', ago(18), { party: P.steel, amount: 2761200, entity: 'purchase_docs', id: po })
  await doc('GCON', 'weighbridge-slip-lot-1.jpg', 'delivery_note', ago(10), { party: P.steel, entity: 'purchase_docs', id: grn })
  await doc('GCON', 'steelmax-tax-invoice.pdf', 'bill', ago(8), { party: P.steel, amount: 1725750, entity: 'invoices', id: bill })
  await doc('GCON', 'performance-guarantee-nh44.pdf', 'contract', ago(200), { party: P.tnInfra, amount: 12000000, entity: 'register_items', id: R.bg, expires: ahead(41) })
  await doc('GIV', 'head-office-lease-deed.pdf', 'contract', START, { entity: 'register_items', id: R.rent, expires: addMonths(START, 36) })
  await doc('GIV', 'dno-policy-schedule.pdf', 'insurance_policy', ago(300), { entity: 'register_items', id: R.dno, expires: ahead(52) })
  await doc('JB', 'innova-insurance-policy.pdf', 'insurance_policy', ago(340), { entity: 'register_items', id: R.innova, expires: ahead(18) })
  await doc('GMED', 'kotak-loan-sanction-letter.pdf', 'loan_document', loanStart, { party: kotak, amount: 2400000, entity: 'loans', id: loan })
  await doc('GWELL', 'whatsapp-image-receipt.jpg', 'unclassified', ago(1))

  // ---------------------------------------------------------------- follow-ups and promises
  const open60 = e.invoices.filter((i) => i.company_id === C.GCON && i.doc_type === 'sales_invoice' && ['open', 'partially_paid'].includes(i.status) && i.party_id === P.sundaram).sort((a, b) => a.doc_date.localeCompare(b.doc_date))
  if (open60[0]) {
    await as(MAKER, ago(15), () => e.savePromise({ company_id: C.GCON, party_id: P.sundaram, invoice_id: open60[0].id, promised_amount: D(open60[0].total).minus(open60[0].amount_settled).toString(), promised_date: ago(4), contact_person: 'Mr. Raghavan, Accounts', channel: 'Phone call', notes: 'Said the payment is in the next cheque run.' }))
    if (open60[1]) await as(MAKER, ago(2), () => e.savePromise({ company_id: C.GCON, party_id: P.sundaram, invoice_id: open60[1].id, promised_amount: D(open60[1].total).minus(open60[1].amount_settled).toString(), promised_date: ahead(9), contact_person: 'Mr. Raghavan, Accounts', channel: 'Email' }))
  }
  const task = (co: string, title: string, due: string, o: { entity?: string; id?: ID; owner?: string; priority?: 'low' | 'normal' | 'high' | 'critical'; detail?: string } = {}) =>
    as(MAKER, ago(3), () => e.saveTask({ company_id: C[co], title, due_date: due, entity: o.entity ?? null, entity_id: o.id ?? null, owner_name: o.owner ?? null, priority: o.priority ?? 'normal', detail: o.detail ?? null }))
  await task('JB', 'Collect the unused balance of the registration advance', ahead(3), { entity: 'advances', id: adv1, owner: 'Karthik Narayanan', priority: 'high', detail: 'Settlement closed; the balance is to be returned to the bank account.' })
  await task('JB', 'Renew the pollution certificate for the Innova', ahead(1), { entity: 'register_items', id: R.innova, owner: 'Lakshmi Priya', priority: 'high' })
  await task('GCON', 'Decide whether the performance guarantee needs an extension', ahead(14), { entity: 'register_items', id: R.bg, owner: 'Arun Mehta', detail: 'The margin deposit matures before the guarantee expires.' })
  await task('GIV', 'Review Microsoft 365 seat count before renewal', ahead(8), { entity: 'register_items', id: R.m365, owner: 'Arun Mehta' })
  await task('GCON', 'Ask Steelmax for the delivery date of the remaining 15 MT', ahead(2), { entity: 'purchase_docs', id: po, owner: 'Purchase desk' })
}
