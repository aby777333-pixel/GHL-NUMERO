import type Decimal from 'decimal.js'
import type { NumeroApi } from '@/api/types'
import type { Account, ID, LedgerBalanceRow } from '@/engine/types'
import type { DocumentRecord } from '@/engine/opsTypes'
import { buildForward, type CoveredOccurrence, type ForwardEvent, type ForwardInput } from '@/engine/forward'
import { isCash } from '@/engine/reports'
import { D, ZERO } from '@/lib/money'
import { addDays, today } from '@/lib/dates'

// One loader for everything that looks ahead. Each source is read through the same
// authorised data layer as its own screen. A source the person may not read is left
// out and NAMED, so a forward figure never silently pretends to be complete.
//
// In the live system the database answers an unauthorised read with no rows, not
// with an error. An empty list therefore proves nothing: the permission is checked
// here, before the read, and the refusal is reported whichever way it arrives.

export type Can = (perm: string, companyId?: ID) => boolean

export interface ForwardData {
  asOf: string
  input: ForwardInput
  events: ForwardEvent[]
  /** scheduled occurrences left out because the document for that period is already recorded */
  covered: CoveredOccurrence[]
  documents: DocumentRecord[]
  balances: LedgerBalanceRow[]
  /** ACTUAL: ledger balance of cash and bank accounts today */
  openingCash: Decimal
  /** sources this person is not authorised to read, in some or all of the companies; their amounts are not in the figures */
  missing: string[]
}

export async function loadForward(api: NumeroApi, companyIds: ID[], accounts: Account[], horizonDays = 1826, can?: Can): Promise<ForwardData> {
  const asOf = today()
  const missing = new Set<string>()
  /** reads a source in the companies where the person holds the permission; names it when any company is left out */
  const read = async <T,>(label: string, perm: string | string[] | null, load: (ids: ID[]) => Promise<T[]>): Promise<T[]> => {
    const ids = perm && can ? companyIds.filter((c) => [perm].flat().some((p) => can(p, c))) : companyIds
    if (ids.length < companyIds.length) missing.add(label)
    if (!ids.length) return []
    try { return await load(ids) } catch { missing.add(label); return [] }
  }

  const [sales, bills, payments, promises, purchaseDocs, registerItems, registerKinds, loans, loanSchedule, deposits, claims, advances, payrollRuns, documents, balances] = await Promise.all([
    read('sales invoices', 'invoice.view', (ids) => api.listInvoices({ companyIds: ids, docTypes: ['sales_invoice', 'credit_note'] })),
    read('purchase bills', 'bill.view', (ids) => api.listInvoices({ companyIds: ids, docTypes: ['purchase_bill', 'debit_note'] })),
    read('payments and receipts', 'payment.view', (ids) => api.listPayments({ companyIds: ids })),
    read('promises to pay', 'invoice.view', (ids) => api.listPromises({ companyIds: ids })),
    read('purchase orders', 'purchase.view', (ids) => api.listPurchaseDocs({ companyIds: ids })),
    read('registers', 'register.view', (ids) => api.listRegisterItems({ companyIds: ids })),
    read('registers', null, () => api.listRegisterKinds()),
    read('loans', 'treasury.view', (ids) => api.listLoans(ids)),
    read('loans', 'treasury.view', (ids) => api.listLoanSchedule({ companyIds: ids })),
    read('fixed deposits', 'treasury.view', (ids) => api.listFixedDeposits(ids)),
    read('expense claims', ['expense.view', 'expense.approve'], (ids) => api.listClaims({ companyIds: ids })),
    read('advances', ['expense.view', 'expense.approve'], (ids) => api.listAdvances({ companyIds: ids })),
    read('payroll', 'payroll.view', (ids) => api.listPayrollRuns(ids)),
    read('documents', 'document.view', (ids) => api.listDocuments({ companyIds: ids })),
    read('cash and bank balances', 'report.view', (ids) => api.ledgerBalances(ids, '1990-01-01', asOf)),
  ])

  const cashIds = new Set(accounts.filter((a) => companyIds.includes(a.company_id) && isCash(a)).map((a) => a.id))
  const openingCash = balances.filter((b) => cashIds.has(b.account_id)).reduce((s, b) => s.plus(D(b.opening_debit)).plus(D(b.period_debit)).minus(D(b.opening_credit)).minus(D(b.period_credit)), ZERO)
  const input: ForwardInput = { asOf, until: addDays(asOf, horizonDays), invoices: [...sales, ...bills], payments, promises, purchaseDocs, registerItems, registerKinds, loans, loanSchedule, deposits, payrollRuns, claims, advances }
  const built = buildForward(input)
  return { asOf, input, events: built.events, covered: built.covered, documents, balances, openingCash, missing: [...missing] }
}
