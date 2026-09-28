import type { NumeroApi } from '@/api/types'
import type { Account, Company, ID } from '@/engine/types'
import type { TwinDriver } from '@/engine/p3Types'
import type { TwinBase, TwinCategory, TwinCustomer } from '@/engine/twin'
import { balanceSheet, isBorrowing, joinBalances, profitAndLoss } from '@/engine/reports'
import { openCommitments } from '@/engine/forward'
import { balancesAsOf } from './data'
import { D } from './money'
import { addMonths, endOfMonth, startOfMonth, today } from './dates'
import type { Can } from './forwardData'

// The starting point of the digital twin, read from the books.
//
// Every figure is read through the same authorised data layer as its own screen.
// What the person may not read is left out and NAMED; what the books do not hold
// is said in the notes of the model. Nothing is invented to fill a gap.

export interface TwinData {
  base: TwinBase
  drivers: TwinDriver[]
  /** sources this person may not read in some or all of the companies */
  missing: string[]
}

const monthsApart = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))

export async function loadTwin(api: NumeroApi, companies: Company[], accounts: Account[], companyIds: ID[], o: { can?: Can; basisMonths?: number; asOf?: string } = {}): Promise<TwinData> {
  const asOf = o.asOf ?? today()
  const want = Math.max(1, Math.min(24, Math.round(o.basisMonths ?? 6)))
  const can = o.can
  const missing = new Set<string>()
  const notes: string[] = []
  const read = async <T,>(label: string, perm: string | string[] | null, load: (ids: ID[]) => Promise<T[]>): Promise<T[]> => {
    const ids = perm && can ? companyIds.filter((c) => [perm].flat().some((p) => can(p, c))) : companyIds
    if (ids.length < companyIds.length) missing.add(label)
    if (!ids.length) return []
    try { return await load(ids) } catch { missing.add(label); return [] }
  }

  const scopeCompanies = companies.filter((c) => companyIds.includes(c.id))
  const acc = accounts.filter((a) => companyIds.includes(a.company_id))
  const byId = new Map(acc.map((a) => [a.id, a]))
  // rates are averaged over complete months: the month in progress would understate them
  const to = endOfMonth(addMonths(startOfMonth(asOf), -1))
  const from = startOfMonth(addMonths(to, -(want - 1)))

  const [monthly, period, position, sales, bills, parties, employees, loans, schedule, purchaseDocs, drivers] = await Promise.all([
    read('the ledger', 'report.view', (ids) => api.ledgerMonthly(ids, from, to)),
    read('the ledger', 'report.view', (ids) => api.ledgerBalances(ids, from, to)),
    read('the ledger', 'report.view', (ids) => balancesAsOf(api, scopeCompanies, ids, asOf)),
    read('sales invoices', 'invoice.view', (ids) => api.listInvoices({ companyIds: ids, docTypes: ['sales_invoice'] })),
    read('purchase bills', 'bill.view', (ids) => api.listInvoices({ companyIds: ids, docTypes: ['purchase_bill'] })),
    read('parties', null, () => api.listParties()),
    read('employees', 'payroll.view', (ids) => api.listEmployees(ids)),
    read('loans', 'treasury.view', (ids) => api.listLoans(ids)),
    read('loans', 'treasury.view', (ids) => api.listLoanSchedule({ companyIds: ids })),
    read('purchase orders', 'purchase.view', (ids) => api.listPurchaseDocs({ companyIds: ids })),
    read('approved drivers', null, () => (can && !companyIds.some((c) => can('scenario.view', c)) ? Promise.resolve([]) : api.listTwinDrivers())),
  ])

  // the months that carry entries: books younger than the basis are averaged over the months they have
  const seen = new Set(monthly.map((r) => r.month.slice(0, 7)))
  const n = Math.max(1, Math.min(want, seen.size))
  if (!seen.size) notes.push(`No posted entries were found between ${from} and ${to}. Every monthly rate is zero.`)
  else if (seen.size < want) notes.push(`The books hold ${seen.size} complete month(s) in the period asked for (${want}). The rates are averaged over ${seen.size}.`)

  const pl = profitAndLoss(joinBalances(acc, period))
  const bs = balanceSheet(joinBalances(acc, position))
  const per = (v: { toNumber(): number }) => Math.round((v.toNumber() / n) * 100) / 100

  // operating expenses, ledger by ledger: the same ledger of several companies is one line
  const cat = new Map<string, TwinCategory>()
  for (const r of period) {
    const a = byId.get(r.account_id)
    if (!a || a.type !== 'expense' || ['cogs', 'employee_cost', 'depreciation', 'finance_cost', 'tax_expense', 'exceptional'].includes(a.subtype)) continue
    const v = (Number(r.period_debit) - Number(r.period_credit)) / n
    const c = cat.get(a.code) ?? { key: a.code, label: a.name, monthly: 0 }
    cat.set(a.code, { ...c, monthly: Math.round((c.monthly + v) * 100) / 100 })
  }

  // customers: what they were billed in the period, and what they owe today
  const name = new Map(parties.map((p) => [p.id, p.display_name]))
  const cust = new Map<ID, TwinCustomer>()
  for (const i of sales) {
    if (['draft', 'cancelled'].includes(i.status)) continue
    const c = cust.get(i.party_id) ?? { id: i.party_id, name: name.get(i.party_id) ?? 'Customer', monthlyRevenue: 0, receivable: 0 }
    if (i.doc_date >= from && i.doc_date <= to) c.monthlyRevenue += D(i.subtotal).times(i.fx_rate).toNumber() / n
    if (['open', 'partially_paid'].includes(i.status)) c.receivable += D(i.total).minus(i.amount_settled).times(i.fx_rate).toNumber()
    cust.set(i.party_id, c)
  }
  const customers = [...cust.values()].filter((c) => c.monthlyRevenue > 0 || c.receivable > 0).map((c) => ({ ...c, monthlyRevenue: Math.round(c.monthlyRevenue * 100) / 100, receivable: Math.round(c.receivable * 100) / 100 }))
    .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue).slice(0, 25)
  if (missing.has('sales invoices')) notes.push('Sales invoices could not be read in every company, so an assumption about a named customer may find nothing to act on.')

  // borrowings: what the loan register has scheduled, month by month
  const borrowed = new Set(loans.filter((l) => (l.direction ?? 'borrowed') === 'borrowed').map((l) => l.id))
  const debtRepayments: number[] = []
  let scheduled = 0
  for (const s of schedule) {
    if (!borrowed.has(s.loan_id) || s.status === 'paid') continue
    const principal = D(s.principal).toNumber()
    scheduled += principal
    const idx = Math.max(0, monthsApart(asOf, s.due_date) - 1)
    if (idx < 60) debtRepayments[idx] = Math.round(((debtRepayments[idx] ?? 0) + principal) * 100) / 100
  }
  for (let i = 0; i < debtRepayments.length; i++) debtRepayments[i] = debtRepayments[i] ?? 0
  const debt = bs.borrowings.toNumber()
  if (debt - scheduled > 1) {
    const ledgers = [...new Set(position.map((r) => byId.get(r.account_id)).filter((a) => a && isBorrowing(a)).map((a) => a!.name))].join(', ')
    notes.push(`Borrowings of ${Math.round(debt - scheduled).toLocaleString('en-IN')} are in the books (${ledgers}) without a repayment schedule in the loan register. The model charges interest on them and does not repay them.`)
  }

  // firm one-off amounts: open orders for assets. Orders for goods and services are part of the monthly rates already.
  const committedOut: number[] = []
  let assetOrders = 0
  for (const c of openCommitments(purchaseDocs, bills)) {
    const forAsset = (c.po.lines ?? []).some((l) => l.account_id && byId.get(l.account_id)?.type === 'asset' && byId.get(l.account_id)?.subtype === 'fixed_asset')
    if (!forAsset) continue
    const idx = Math.max(0, Math.min(59, monthsApart(asOf, c.po.required_date ?? asOf) - 1))
    committedOut[idx] = Math.round(((committedOut[idx] ?? 0) + c.openBase.toNumber()) * 100) / 100
    assetOrders++
  }
  for (let i = 0; i < committedOut.length; i++) committedOut[i] = committedOut[i] ?? 0
  notes.push(assetOrders
    ? `${assetOrders} open order(s) for assets are added as one-off payments. Open orders for goods and services are taken to be inside the monthly rates.`
    : 'Open orders for goods and services are taken to be inside the monthly rates; no open order for an asset was found.')

  const active = employees.filter((e) => e.status === 'active').length
  if (missing.has('employees')) notes.push('Employee records could not be read. People hired in a simulation are modelled by their cost only.')
  if (scopeCompanies.length > 1) notes.push('Charges between companies of the group are inside both income and expense. They cancel in profit and in cash; revenue and expenses each include them.')
  if (pl.exceptional.abs().gt(0)) notes.push(`Exceptional items of ${Math.round(pl.exceptional.toNumber()).toLocaleString('en-IN')} in the period are left out of the monthly rates: they are not expected to repeat.`)

  const base: TwinBase = {
    asOf, currency: scopeCompanies[0]?.base_currency ?? 'INR',
    scope: scopeCompanies.length === 1 ? scopeCompanies[0].name : `${scopeCompanies.length} companies`,
    basisMonths: n,
    revenue: per(pl.revenue), cogs: per(pl.cogs), payroll: per(pl.employeeCost), opex: per(pl.opex), otherIncome: per(pl.otherIncome),
    depreciation: per(pl.depreciation), financeCost: per(pl.financeCost), tax: per(pl.tax),
    categories: [...cat.values()].filter((c) => c.monthly !== 0).sort((a, b) => b.monthly - a.monthly),
    cash: bs.cash.toNumber(), receivables: bs.receivables.toNumber(), payables: bs.payables.toNumber(), inventory: bs.inventory.toNumber(), debt, fixedAssets: bs.fixedAssetsNet.toNumber(),
    headcount: missing.has('employees') || !employees.length ? null : active,
    customers, debtRepayments, committedOut, committedIn: [], notes,
  }
  if (new Set(scopeCompanies.map((c) => c.base_currency)).size > 1) base.notes.push('The companies chosen keep their books in different currencies. Their figures are added as they stand, without conversion.')
  return { base, drivers, missing: [...missing] }
}
