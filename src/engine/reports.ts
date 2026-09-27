import Decimal from 'decimal.js'
import { D, ZERO, sum } from '@/lib/money'
import type { Account, Company, ID, LedgerBalanceRow } from './types'

// Financial statements are derived ONLY from posted ledger balances.
// Every line carries the account ids behind it so any number can be drilled
// down to account → transaction → document (spec 73, 512).

export interface AccountBal {
  account: Account
  /** Dr-positive balances */
  opening: Decimal
  debit: Decimal
  credit: Decimal
  closing: Decimal
}

export interface ReportLine {
  key: string
  label: string
  code?: string
  amount: Decimal
  accountIds: ID[]
  kind: 'section' | 'account' | 'subtotal' | 'total' | 'computed'
  level: number
  explain?: string
  children?: ReportLine[]
  /** statement line is a derived figure, not a ledger balance */
  formula?: string
}

export function joinBalances(accounts: Account[], rows: LedgerBalanceRow[]): AccountBal[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const out: AccountBal[] = []
  for (const r of rows) {
    const account = byId.get(r.account_id)
    if (!account) continue
    const opening = D(r.opening_debit).minus(D(r.opening_credit))
    const debit = D(r.period_debit)
    const credit = D(r.period_credit)
    out.push({ account, opening, debit, credit, closing: opening.plus(debit).minus(credit) })
  }
  return out
}

const CURRENT_ASSETS = ['cash', 'bank', 'receivable', 'inventory', 'advance', 'prepaid', 'tax_receivable', 'intercompany_receivable', 'other_current_asset']
const CURRENT_LIABS = ['payable', 'accrued', 'tax_payable', 'employee_payable', 'advance_received', 'short_term_borrowing', 'intercompany_payable', 'provision', 'suspense']
export const isCurrentAsset = (a: Account) => a.type === 'asset' && CURRENT_ASSETS.includes(a.subtype)
export const isCurrentLiability = (a: Account) => a.type === 'liability' && CURRENT_LIABS.includes(a.subtype)
export const isCash = (a: Account) => a.type === 'asset' && (a.subtype === 'cash' || a.subtype === 'bank')
export const isBorrowing = (a: Account) => a.type === 'liability' && (a.subtype === 'loan' || a.subtype === 'short_term_borrowing')

type Pick = (b: AccountBal) => Decimal

/** Groups balances of the same ledger (code + name) across companies into one statement line. */
function lines(bals: AccountBal[], filter: (a: Account) => boolean, pick: Pick, level = 1): ReportLine[] {
  const m = new Map<string, ReportLine>()
  for (const b of bals) {
    if (!filter(b.account)) continue
    const amt = pick(b)
    const key = `${b.account.code}|${b.account.name}`
    const cur = m.get(key)
    if (cur) {
      cur.amount = cur.amount.plus(amt)
      cur.accountIds.push(b.account.id)
    } else {
      m.set(key, { key, label: b.account.name, code: b.account.code, amount: amt, accountIds: [b.account.id], kind: 'account', level })
    }
  }
  return [...m.values()].filter((l) => !l.amount.isZero()).sort((x, y) => (x.code ?? '').localeCompare(y.code ?? ''))
}

function section(key: string, label: string, children: ReportLine[], explain?: string, level = 0): ReportLine {
  return {
    key, label, kind: 'section', level, explain, children,
    amount: sum(children.map((c) => c.amount)),
    accountIds: children.flatMap((c) => c.accountIds),
  }
}
const line1 = (x: ReportLine): ReportLine => x
const computed = (key: string, label: string, amount: Decimal, formula: string, explain?: string, kind: ReportLine['kind'] = 'subtotal'): ReportLine => ({
  key, label, amount, accountIds: [], kind, level: 0, formula, explain,
})

// ---------------------------------------------------------------- Trial balance
export interface TrialBalanceRow {
  account: Account
  companyId: ID
  openingDr: Decimal; openingCr: Decimal
  periodDr: Decimal; periodCr: Decimal
  closingDr: Decimal; closingCr: Decimal
}
export interface TrialBalance {
  rows: TrialBalanceRow[]
  totals: Omit<TrialBalanceRow, 'account' | 'companyId'>
  balanced: boolean
  difference: Decimal
}
const split = (v: Decimal) => (v.gte(0) ? [v, ZERO] : [ZERO, v.abs()])

export function trialBalance(bals: AccountBal[]): TrialBalance {
  const rows = bals
    .map((b) => {
      const [openingDr, openingCr] = split(b.opening)
      const [closingDr, closingCr] = split(b.closing)
      return { account: b.account, companyId: b.account.company_id, openingDr, openingCr, periodDr: b.debit, periodCr: b.credit, closingDr, closingCr }
    })
    .filter((r) => !(r.openingDr.isZero() && r.openingCr.isZero() && r.periodDr.isZero() && r.periodCr.isZero()))
    .sort((x, y) => x.account.code.localeCompare(y.account.code))
  const t = (k: keyof Omit<TrialBalanceRow, 'account' | 'companyId'>) => sum(rows.map((r) => r[k]))
  const totals = { openingDr: t('openingDr'), openingCr: t('openingCr'), periodDr: t('periodDr'), periodCr: t('periodCr'), closingDr: t('closingDr'), closingCr: t('closingCr') }
  const difference = totals.closingDr.minus(totals.closingCr)
  return { rows, totals, balanced: difference.isZero() && totals.periodDr.eq(totals.periodCr), difference }
}

// ---------------------------------------------------------------- Profit & Loss
export interface ProfitAndLoss {
  lines: ReportLine[]
  revenue: Decimal; cogs: Decimal; grossProfit: Decimal
  employeeCost: Decimal; opex: Decimal; operatingProfit: Decimal
  otherIncome: Decimal; depreciation: Decimal; financeCost: Decimal; exceptional: Decimal
  pbt: Decimal; tax: Decimal; pat: Decimal
  totalIncome: Decimal; totalExpense: Decimal
}

const incomeAmt: Pick = (b) => b.credit.minus(b.debit)
const expenseAmt: Pick = (b) => b.debit.minus(b.credit)

export function profitAndLoss(bals: AccountBal[]): ProfitAndLoss {
  const st = (sub: string[]) => (a: Account) => sub.includes(a.subtype)
  const inc = (sub: string[]) => lines(bals, (a) => a.type === 'income' && st(sub)(a), incomeAmt)
  const exp = (sub: string[]) => lines(bals, (a) => a.type === 'expense' && st(sub)(a), expenseAmt)

  const sRev = section('revenue', 'Revenue from operations', inc(['revenue']), 'Income earned from the normal business of the company during the period.')
  const sCogs = section('cogs', 'Cost of goods sold', exp(['cogs']), 'Direct costs of producing or buying what was sold.')
  const sEmp = section('employee', 'Employee costs', exp(['employee_cost']), 'Salaries, employer contributions, bonuses and staff welfare.')
  const sOpex = section('opex', 'Other operating expenses', exp(['operating_expense']), 'Day-to-day running costs: rent, marketing, travel, professional fees, technology and administration.')
  const sOther = section('other_income', 'Other income', inc(['other_income']), 'Income outside normal operations: interest, exchange gains, recoveries.')
  const sDep = section('depreciation', 'Depreciation & amortisation', exp(['depreciation']), 'The portion of long-lived asset cost recognised as an expense this period. No cash leaves the bank for this line.')
  const sFin = section('finance', 'Finance costs', exp(['finance_cost']), 'Interest on borrowings and exchange differences.')
  const sExc = section('exceptional', 'Exceptional items', exp(['exceptional']), 'Unusual items such as write-offs and losses, shown separately so they do not distort normal performance.')
  const sTax = section('tax', 'Tax expense', exp(['tax_expense']), 'Income tax recognised for the period.')
  // any expense/income with an unrecognised subtype is never dropped
  const known = ['revenue', 'other_income', 'cogs', 'employee_cost', 'operating_expense', 'depreciation', 'finance_cost', 'exceptional', 'tax_expense']
  const strayInc = lines(bals, (a) => a.type === 'income' && !known.includes(a.subtype), incomeAmt)
  const strayExp = lines(bals, (a) => a.type === 'expense' && !known.includes(a.subtype), expenseAmt)
  sOther.children!.push(...strayInc); sOther.amount = sum(sOther.children!.map((c) => c.amount)); sOther.accountIds = sOther.children!.flatMap((c) => c.accountIds)
  sOpex.children!.push(...strayExp); sOpex.amount = sum(sOpex.children!.map((c) => c.amount)); sOpex.accountIds = sOpex.children!.flatMap((c) => c.accountIds)

  const grossProfit = sRev.amount.minus(sCogs.amount)
  const operatingProfit = grossProfit.minus(sEmp.amount).minus(sOpex.amount)
  const pbt = operatingProfit.plus(sOther.amount).minus(sDep.amount).minus(sFin.amount).minus(sExc.amount)
  const pat = pbt.minus(sTax.amount)

  return {
    lines: [
      sRev, sCogs,
      computed('gross_profit', 'Gross profit', grossProfit, 'Revenue − Cost of goods sold', 'What is left from sales after paying the direct cost of what was sold.'),
      sEmp, sOpex,
      computed('operating_profit', 'Operating profit (EBITDA)', operatingProfit, 'Gross profit − Employee costs − Other operating expenses', 'Profit from running the business before financing, depreciation, exceptional items and tax.'),
      sOther, sDep, sFin, sExc,
      computed('pbt', 'Profit before tax', pbt, 'Operating profit + Other income − Depreciation − Finance costs − Exceptional items'),
      sTax,
      computed('pat', 'Profit after tax', pat, 'Profit before tax − Tax expense', 'The final profit or loss recorded for the period.', 'total'),
    ],
    revenue: sRev.amount, cogs: sCogs.amount, grossProfit, employeeCost: sEmp.amount, opex: sOpex.amount, operatingProfit,
    otherIncome: sOther.amount, depreciation: sDep.amount, financeCost: sFin.amount, exceptional: sExc.amount,
    pbt, tax: sTax.amount, pat,
    totalIncome: sRev.amount.plus(sOther.amount),
    totalExpense: sCogs.amount.plus(sEmp.amount).plus(sOpex.amount).plus(sDep.amount).plus(sFin.amount).plus(sExc.amount).plus(sTax.amount),
  }
}

// ---------------------------------------------------------------- Balance sheet
export interface BalanceSheet {
  assets: ReportLine[]
  liabilities: ReportLine[]
  equity: ReportLine[]
  totalAssets: Decimal
  totalLiabilities: Decimal
  totalEquity: Decimal
  currentAssets: Decimal
  currentLiabilities: Decimal
  cash: Decimal
  receivables: Decimal
  payables: Decimal
  inventory: Decimal
  borrowings: Decimal
  investments: Decimal
  fixedAssetsNet: Decimal
  workingCapital: Decimal
  retainedUnclosed: Decimal
  currentProfit: Decimal
  balanced: boolean
  difference: Decimal
}

/**
 * bals must be fetched with `from` = start of the fiscal year containing the as-of date:
 *   opening  = everything before the fiscal year
 *   period   = fiscal year to date
 * Income/expense balances from earlier years that were never closed are presented as
 * retained earnings; the current year's result is shown as "Current period profit / (loss)".
 */
export function balanceSheet(bals: AccountBal[]): BalanceSheet {
  const dr: Pick = (b) => b.closing
  const cr: Pick = (b) => b.closing.neg()
  const A = (sub: string[]) => lines(bals, (a) => a.type === 'asset' && sub.includes(a.subtype), dr)
  const L = (sub: string[]) => lines(bals, (a) => a.type === 'liability' && sub.includes(a.subtype), cr)
  const E = (sub: string[]) => lines(bals, (a) => a.type === 'equity' && sub.includes(a.subtype), cr)

  const knownA = ['cash', 'bank', 'receivable', 'inventory', 'advance', 'deposit', 'prepaid', 'tax_receivable', 'intercompany_receivable', 'other_current_asset', 'investment', 'fixed_asset', 'accumulated_depreciation']
  const knownL = ['payable', 'accrued', 'tax_payable', 'employee_payable', 'advance_received', 'intercompany_payable', 'provision', 'suspense', 'loan', 'short_term_borrowing']
  const knownE = ['capital', 'reserves', 'retained_earnings', 'drawings']

  const assets = [
    section('cash', 'Cash & bank', A(['cash', 'bank']), 'Money held in cash and in bank accounts.'),
    section('receivables', 'Receivables', A(['receivable']), 'Money customers currently owe the company for recorded sales and invoices.'),
    section('inventory', 'Inventory & work-in-progress', A(['inventory']), 'Goods held for sale and projects in progress, at recorded cost.'),
    section('advances', 'Advances, deposits & prepaid', A(['advance', 'deposit', 'prepaid']), 'Money paid ahead of receiving goods or services, and refundable deposits. These are not expenses.'),
    section('tax_assets', 'Tax credits receivable', A(['tax_receivable']), 'Input tax credits and tax deducted at source that can be recovered or set off.'),
    section('ic_recv', 'Due from group companies', A(['intercompany_receivable']), 'Amounts other companies in the group owe this company.'),
    section('investments', 'Investments', A(['investment']), 'Investments and fixed deposits at recorded value.'),
    section('fixed', 'Fixed assets (net)', A(['fixed_asset', 'accumulated_depreciation']), 'Long-lived assets at cost less accumulated depreciation.'),
    section('other_assets', 'Other assets', lines(bals, (a) => a.type === 'asset' && (a.subtype === 'other_current_asset' || !knownA.includes(a.subtype)), dr)),
  ].filter((s) => s.children!.length)

  const liabilities = [
    section('payables', 'Payables', L(['payable']), 'Money the company owes suppliers for recorded bills.'),
    section('accrued', 'Accrued expenses & provisions', L(['accrued', 'provision']), 'Costs incurred but not yet billed, and provisions for expected obligations.'),
    section('tax_liab', 'Taxes payable', L(['tax_payable']), 'Taxes collected or deducted that are owed to the authorities.'),
    section('employee', 'Employee payables', L(['employee_payable']), 'Salaries and reimbursements owed to employees.'),
    section('cust_adv', 'Advances from customers', L(['advance_received']), 'Money received before goods or services were delivered.'),
    section('ic_pay', 'Due to group companies', L(['intercompany_payable']), 'Amounts this company owes other companies in the group.'),
    section('suspense', 'Suspense — needs classification', L(['suspense']), 'Transactions not yet classified. This should be cleared, not used as permanent storage.'),
    section('borrowings', 'Borrowings', L(['loan', 'short_term_borrowing']), 'Loans and credit facilities outstanding.'),
    section('other_liab', 'Other liabilities', lines(bals, (a) => a.type === 'liability' && !knownL.includes(a.subtype), cr)),
  ].filter((s) => s.children!.length)

  const pl = bals.filter((b) => b.account.type === 'income' || b.account.type === 'expense')
  const retainedUnclosed = sum(pl.map((b) => b.opening.neg()))
  const currentProfit = sum(pl.map((b) => b.credit.minus(b.debit)))

  const equity: ReportLine[] = [
    section('capital', 'Capital', E(['capital']), 'Money invested by the owners.'),
    section('reserves', 'Reserves & retained earnings', [
      ...E(['reserves', 'retained_earnings']),
      ...(retainedUnclosed.isZero() ? [] : [{
        key: 're_unclosed', label: 'Accumulated result of earlier years (not yet closed to retained earnings)', amount: retainedUnclosed,
        accountIds: pl.map((b) => b.account.id), kind: 'computed' as const, level: 1,
        formula: 'Σ (income − expense) recorded before the current fiscal year',
      }]),
    ], 'Profits kept in the business from earlier periods.'),
    section('drawings', 'Drawings & other equity', lines(bals, (a) => a.type === 'equity' && (a.subtype === 'drawings' || !knownE.includes(a.subtype)), cr)),
    line1({
      key: 'current_profit', label: 'Current period profit / (loss)', amount: currentProfit, accountIds: pl.map((b) => b.account.id),
      kind: 'computed', level: 0, formula: 'Income − Expenses for the fiscal year to date',
      explain: 'The result of the current fiscal year so far, as shown in the Profit & Loss statement.',
    }),
  ].filter((s) => s.kind === 'computed' || s.children!.length)

  const tot = (xs: ReportLine[]) => sum(xs.map((x) => x.amount))
  const totalAssets = tot(assets)
  const totalLiabilities = tot(liabilities)
  const totalEquity = tot(equity)
  const pickSum = (f: (a: Account) => boolean, p: Pick) => sum(bals.filter((b) => f(b.account)).map(p))
  const currentAssets = pickSum(isCurrentAsset, dr)
  const currentLiabilities = pickSum(isCurrentLiability, cr)
  const difference = totalAssets.minus(totalLiabilities).minus(totalEquity)

  return {
    assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity,
    currentAssets, currentLiabilities,
    cash: pickSum(isCash, dr),
    receivables: pickSum((a) => a.type === 'asset' && a.subtype === 'receivable', dr),
    payables: pickSum((a) => a.type === 'liability' && a.subtype === 'payable', cr),
    inventory: pickSum((a) => a.type === 'asset' && a.subtype === 'inventory', dr),
    borrowings: pickSum(isBorrowing, cr),
    investments: pickSum((a) => a.type === 'asset' && a.subtype === 'investment', dr),
    fixedAssetsNet: pickSum((a) => a.type === 'asset' && (a.subtype === 'fixed_asset' || a.subtype === 'accumulated_depreciation'), dr),
    workingCapital: currentAssets.minus(currentLiabilities),
    retainedUnclosed, currentProfit,
    balanced: difference.isZero(), difference,
  }
}

// ---------------------------------------------------------------- Cash flow (indirect)
export interface CashFlow {
  lines: ReportLine[]
  operating: Decimal; investing: Decimal; financing: Decimal
  netChange: Decimal
  openingCash: Decimal; closingCash: Decimal
  /** closing − opening − netChange. Always displayed; never hidden (spec 654). */
  unexplained: Decimal
}

/** bals: opening = position at period start, period = movement in the period. */
export function cashFlow(bals: AccountBal[]): CashFlow {
  const move: Pick = (b) => b.debit.minus(b.credit) // Dr-positive movement
  const mv = (f: (a: Account) => boolean) => sum(bals.filter((b) => f(b.account)).map(move))
  const ids = (f: (a: Account) => boolean) => bals.filter((b) => f(b.account) && !move(b).isZero()).map((b) => b.account.id)
  const isPL = (a: Account) => a.type === 'income' || a.type === 'expense'
  const sub = (type: Account['type'], subs: string[]) => (a: Account) => a.type === type && subs.includes(a.subtype)

  const pat = mv(isPL).neg()
  const dep = mv(sub('expense', ['depreciation']))
  const line = (key: string, label: string, f: (a: Account) => boolean, sign: 1 | -1, explain?: string): ReportLine => ({
    key, label, amount: mv(f).times(sign), accountIds: ids(f), kind: 'account', level: 1, explain,
  })

  const assetWC = ['receivable', 'inventory', 'advance', 'prepaid', 'tax_receivable', 'intercompany_receivable', 'other_current_asset', 'deposit']
  const liabWC = ['payable', 'accrued', 'tax_payable', 'employee_payable', 'advance_received', 'intercompany_payable', 'provision', 'suspense', 'other_liability']
  const covered = (a: Account) =>
    isPL(a) || isCash(a) || sub('asset', [...assetWC, 'fixed_asset', 'accumulated_depreciation', 'investment'])(a) ||
    sub('liability', [...liabWC, 'loan', 'short_term_borrowing'])(a) || a.type === 'equity'

  const op: ReportLine[] = [
    line1({ key: 'pat', label: 'Profit after tax', amount: pat, accountIds: ids(isPL), kind: 'computed', level: 1, formula: 'From the Profit & Loss statement' }),
    line1({ key: 'dep', label: 'Add back: depreciation (non-cash)', amount: dep, accountIds: ids(sub('expense', ['depreciation'])), kind: 'computed', level: 1 }),
    line('recv', '(Increase) / decrease in receivables', sub('asset', ['receivable']), -1, 'When customers owe more, profit has not yet turned into cash.'),
    line('inv', '(Increase) / decrease in inventory', sub('asset', ['inventory']), -1),
    line('adv', '(Increase) / decrease in advances, deposits & prepaid', sub('asset', ['advance', 'prepaid', 'deposit', 'other_current_asset']), -1),
    line('taxa', '(Increase) / decrease in tax credits', sub('asset', ['tax_receivable']), -1),
    line('icr', '(Increase) / decrease in dues from group companies', sub('asset', ['intercompany_receivable']), -1),
    line('pay', 'Increase / (decrease) in payables', sub('liability', ['payable']), -1, 'When suppliers are owed more, cash has been retained.'),
    line('acc', 'Increase / (decrease) in accruals, provisions & other liabilities', sub('liability', ['accrued', 'provision', 'suspense', 'other_liability']), -1),
    line('taxl', 'Increase / (decrease) in taxes payable', sub('liability', ['tax_payable']), -1),
    line('emp', 'Increase / (decrease) in employee payables', sub('liability', ['employee_payable']), -1),
    line('cadv', 'Increase / (decrease) in customer advances', sub('liability', ['advance_received']), -1),
    line('icp', 'Increase / (decrease) in dues to group companies', sub('liability', ['intercompany_payable']), -1),
    line('other', 'Other unclassified movements', (a) => !covered(a), -1),
  ].filter((l) => !l.amount.isZero() || l.key === 'pat')

  const fixedNet = mv(sub('asset', ['fixed_asset', 'accumulated_depreciation']))
  const inv: ReportLine[] = [
    line1({ key: 'capex', label: 'Purchase of fixed assets (net of disposals)', amount: fixedNet.plus(dep).neg(), accountIds: ids(sub('asset', ['fixed_asset', 'accumulated_depreciation'])), kind: 'computed', level: 1, formula: '−(Δ net fixed assets + depreciation charged)' }),
    line('invest', '(Purchase) / sale of investments', sub('asset', ['investment']), -1),
  ].filter((l) => !l.amount.isZero())

  const fin: ReportLine[] = [
    line('borrow', 'Proceeds from / (repayment of) borrowings', sub('liability', ['loan', 'short_term_borrowing']), -1),
    line('equity', 'Capital introduced / (withdrawn)', (a) => a.type === 'equity', -1),
  ].filter((l) => !l.amount.isZero())

  const sOp = section('operating', 'Operating activities', op, 'Cash generated or used by the day-to-day business.')
  const sInv = section('investing', 'Investing activities', inv, 'Cash spent on, or received from, long-term assets and investments.')
  const sFin = section('financing', 'Financing activities', fin, 'Cash from owners and lenders, and repayments to them.')
  const openingCash = sum(bals.filter((b) => isCash(b.account)).map((b) => b.opening))
  const closingCash = sum(bals.filter((b) => isCash(b.account)).map((b) => b.closing))
  const netChange = sOp.amount.plus(sInv.amount).plus(sFin.amount)

  return {
    lines: [sOp, sInv, sFin],
    operating: sOp.amount, investing: sInv.amount, financing: sFin.amount,
    netChange, openingCash, closingCash,
    unexplained: closingCash.minus(openingCash).minus(netChange),
  }
}

// ---------------------------------------------------------------- Ratios (always with formula + inputs)
export interface Ratio {
  key: string; label: string; group: string
  value: Decimal | null
  unit: 'x' | '%' | 'days' | 'months' | 'amount'
  formula: string
  inputs: { label: string; value: Decimal }[]
  note?: string
}

export function ratios(pl: ProfitAndLoss, bs: BalanceSheet, periodDays: number, avgMonthlyBurn?: Decimal): Ratio[] {
  const div = (a: Decimal, b: Decimal) => (b.isZero() ? null : a.div(b))
  const pct = (a: Decimal, b: Decimal) => (b.isZero() ? null : a.div(b).times(100))
  const costBase = pl.cogs.plus(pl.opex)
  const out: Ratio[] = [
    { key: 'current', label: 'Current ratio', group: 'Liquidity', unit: 'x', value: div(bs.currentAssets, bs.currentLiabilities), formula: 'Current assets ÷ Current liabilities', inputs: [{ label: 'Current assets', value: bs.currentAssets }, { label: 'Current liabilities', value: bs.currentLiabilities }] },
    { key: 'quick', label: 'Quick ratio', group: 'Liquidity', unit: 'x', value: div(bs.currentAssets.minus(bs.inventory), bs.currentLiabilities), formula: '(Current assets − Inventory) ÷ Current liabilities', inputs: [{ label: 'Current assets', value: bs.currentAssets }, { label: 'Inventory', value: bs.inventory }, { label: 'Current liabilities', value: bs.currentLiabilities }] },
    { key: 'gross_margin', label: 'Gross margin', group: 'Profitability', unit: '%', value: pct(pl.grossProfit, pl.revenue), formula: 'Gross profit ÷ Revenue × 100', inputs: [{ label: 'Gross profit', value: pl.grossProfit }, { label: 'Revenue', value: pl.revenue }] },
    { key: 'op_margin', label: 'Operating margin', group: 'Profitability', unit: '%', value: pct(pl.operatingProfit, pl.revenue), formula: 'Operating profit ÷ Revenue × 100', inputs: [{ label: 'Operating profit', value: pl.operatingProfit }, { label: 'Revenue', value: pl.revenue }] },
    { key: 'net_margin', label: 'Net margin', group: 'Profitability', unit: '%', value: pct(pl.pat, pl.revenue), formula: 'Profit after tax ÷ Revenue × 100', inputs: [{ label: 'Profit after tax', value: pl.pat }, { label: 'Revenue', value: pl.revenue }] },
    { key: 'roa', label: 'Return on assets', group: 'Profitability', unit: '%', value: pct(pl.pat, bs.totalAssets), formula: 'Profit after tax ÷ Total assets × 100', inputs: [{ label: 'Profit after tax', value: pl.pat }, { label: 'Total assets', value: bs.totalAssets }], note: 'Period profit against closing assets; not annualised.' },
    { key: 'roe', label: 'Return on equity', group: 'Profitability', unit: '%', value: pct(pl.pat, bs.totalEquity), formula: 'Profit after tax ÷ Total equity × 100', inputs: [{ label: 'Profit after tax', value: pl.pat }, { label: 'Total equity', value: bs.totalEquity }], note: 'Period profit against closing equity; not annualised.' },
    { key: 'de', label: 'Debt to equity', group: 'Leverage', unit: 'x', value: div(bs.borrowings, bs.totalEquity), formula: 'Borrowings ÷ Total equity', inputs: [{ label: 'Borrowings', value: bs.borrowings }, { label: 'Total equity', value: bs.totalEquity }] },
    { key: 'icr', label: 'Interest coverage', group: 'Leverage', unit: 'x', value: div(pl.operatingProfit.minus(pl.depreciation), pl.financeCost), formula: '(Operating profit − Depreciation) ÷ Finance costs', inputs: [{ label: 'Operating profit', value: pl.operatingProfit }, { label: 'Depreciation', value: pl.depreciation }, { label: 'Finance costs', value: pl.financeCost }] },
    { key: 'dso', label: 'Receivable days', group: 'Efficiency', unit: 'days', value: pl.revenue.isZero() ? null : bs.receivables.div(pl.revenue).times(periodDays), formula: 'Receivables ÷ Revenue × days in period', inputs: [{ label: 'Receivables', value: bs.receivables }, { label: 'Revenue', value: pl.revenue }, { label: 'Days in period', value: D(periodDays) }] },
    { key: 'dpo', label: 'Payable days', group: 'Efficiency', unit: 'days', value: costBase.isZero() ? null : bs.payables.div(costBase).times(periodDays), formula: 'Payables ÷ (COGS + Operating expenses) × days in period', inputs: [{ label: 'Payables', value: bs.payables }, { label: 'COGS + Operating expenses', value: costBase }, { label: 'Days in period', value: D(periodDays) }] },
    { key: 'dio', label: 'Inventory days', group: 'Efficiency', unit: 'days', value: pl.cogs.isZero() ? null : bs.inventory.div(pl.cogs).times(periodDays), formula: 'Inventory ÷ COGS × days in period', inputs: [{ label: 'Inventory', value: bs.inventory }, { label: 'COGS', value: pl.cogs }, { label: 'Days in period', value: D(periodDays) }] },
  ]
  const dso = out.find((r) => r.key === 'dso')!.value
  const dpo = out.find((r) => r.key === 'dpo')!.value
  const dio = out.find((r) => r.key === 'dio')!.value
  out.push({
    key: 'ccc', label: 'Cash conversion cycle', group: 'Efficiency', unit: 'days',
    value: dso && dpo ? dso.plus(dio ?? ZERO).minus(dpo) : null,
    formula: 'Receivable days + Inventory days − Payable days',
    inputs: [{ label: 'Receivable days', value: dso ?? ZERO }, { label: 'Inventory days', value: dio ?? ZERO }, { label: 'Payable days', value: dpo ?? ZERO }],
  })
  if (avgMonthlyBurn) {
    out.push({
      key: 'runway', label: 'Cash runway', group: 'Liquidity', unit: 'months',
      value: avgMonthlyBurn.lte(0) ? null : bs.cash.div(avgMonthlyBurn),
      formula: 'Cash & bank ÷ Average monthly net cash burn',
      inputs: [{ label: 'Cash & bank', value: bs.cash }, { label: 'Average monthly net cash burn', value: avgMonthlyBurn }],
      note: avgMonthlyBurn.lte(0) ? 'Cash is not being consumed on average in the selected period.' : 'Run-rate extrapolation of recorded history. This is not a forecast.',
    })
  }
  return out
}

// ---------------------------------------------------------------- Consolidation
export interface Elimination {
  fromCompany: ID
  toCompany: ID
  receivable: Decimal
  payable: Decimal
  eliminated: Decimal
  mismatch: Decimal
}

/**
 * Intercompany balances between companies that are both in the consolidation scope.
 * Accounts flagged control_type = 'intercompany' with a counterparty are paired:
 * A's receivable from B against B's payable to A. Mismatches are reported, never forced.
 */
export function intercompanyEliminations(bals: AccountBal[], companies: Company[]): Elimination[] {
  const inScope = new Set(companies.map((c) => c.id))
  const recv = new Map<string, Decimal>()
  const pay = new Map<string, Decimal>()
  for (const b of bals) {
    const a = b.account
    if (a.control_type !== 'intercompany' || !a.counterparty_company_id || !inScope.has(a.counterparty_company_id)) continue
    if (a.type === 'asset') {
      const k = `${a.company_id}>${a.counterparty_company_id}`
      recv.set(k, (recv.get(k) ?? ZERO).plus(b.closing))
    } else if (a.type === 'liability') {
      const k = `${a.counterparty_company_id}>${a.company_id}` // creditor > debtor
      pay.set(k, (pay.get(k) ?? ZERO).plus(b.closing.neg()))
    }
  }
  const keys = new Set([...recv.keys(), ...pay.keys()])
  return [...keys].map((k) => {
    const [fromCompany, toCompany] = k.split('>')
    const receivable = recv.get(k) ?? ZERO
    const payable = pay.get(k) ?? ZERO
    const eliminated = Decimal.min(receivable, payable)
    return { fromCompany, toCompany, receivable, payable, eliminated: eliminated.lt(0) ? ZERO : eliminated, mismatch: receivable.minus(payable) }
  }).filter((e) => !e.receivable.isZero() || !e.payable.isZero())
}

// ---------------------------------------------------------------- Ageing
export interface AgeBucket { key: string; label: string; from: number; to: number | null }
export const DEFAULT_BUCKETS: AgeBucket[] = [
  { key: 'current', label: 'Not yet due', from: -99999, to: 0 },
  { key: 'b30', label: '1–30', from: 1, to: 30 },
  { key: 'b60', label: '31–60', from: 31, to: 60 },
  { key: 'b90', label: '61–90', from: 61, to: 90 },
  { key: 'b180', label: '91–180', from: 91, to: 180 },
  { key: 'b180p', label: '180+', from: 181, to: null },
]
export const bucketOf = (daysOverdue: number, buckets = DEFAULT_BUCKETS) =>
  buckets.find((b) => daysOverdue >= b.from && (b.to === null || daysOverdue <= b.to)) ?? buckets[buckets.length - 1]
