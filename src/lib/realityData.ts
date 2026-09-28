import type { NumeroApi } from '@/api/types'
import type { Account, ID } from '@/engine/types'
import type { Case, Materiality } from '@/engine/p3Types'
import { findDifferences, type Finding, type HealthRow, lastSheets, notChecked, realityHealth, type RealityInput } from '@/engine/reality'
import { D } from './money'
import { today } from './dates'
import type { Can } from './forwardData'

// One loader for NUMERO Reality. Each source is read through the same authorised data
// layer as its own screen. A source the person may not read is left out and NAMED:
// a chain that could not be looked at is never shown as a chain that agrees.

export interface RealityData {
  asOf: string
  input: RealityInput
  findings: Finding[]
  health: HealthRow[]
  /** what was never verified, counted or imported at all */
  unchecked: string[]
  /** sources this person may not read in some or all of the companies */
  missing: string[]
  materiality: Materiality[]
  /** cases already opened on a difference, by the key of the difference */
  cases: Map<string, Case>
}

export async function loadReality(api: NumeroApi, accounts: Account[], companyIds: ID[], can?: Can): Promise<RealityData> {
  const asOf = today()
  const missing = new Set<string>()
  const read = async <T,>(label: string, perm: string | string[] | null, load: (ids: ID[]) => Promise<T[]>): Promise<T[]> => {
    const ids = perm && can ? companyIds.filter((c) => [perm].flat().some((p) => can(p, c))) : companyIds
    if (ids.length < companyIds.length) missing.add(label)
    if (!ids.length) return []
    try { return await load(ids) } catch { missing.add(label); return [] }
  }
  /** lists that are read record by record: one refusal names the source and leaves the rest standing */
  const each = async <P extends { id: ID }, T>(label: string, parents: P[], load: (p: P) => Promise<T[]>): Promise<T[]> =>
    (await Promise.all(parents.map((p) => load(p).catch(() => { missing.add(label); return [] as T[] })))).flat()

  const [purchaseDocs, invoices, payments, stockDocs, advances, claims, assets, cashBoxes, ledger, invItems, invCategories, stockCounts, bankAccounts, verifications, materiality, cases] = await Promise.all([
    read('purchase orders and receipts', 'purchase.view', (ids) => api.listPurchaseDocs({ companyIds: ids })),
    read('invoices and bills', ['invoice.view', 'bill.view'], (ids) => api.listInvoices({ companyIds: ids })),
    read('payments and receipts', 'payment.view', (ids) => api.listPayments({ companyIds: ids })),
    read('stock documents', 'inventory.view', (ids) => api.listStockDocs({ companyIds: ids })),
    read('advances', ['expense.view', 'expense.approve'], (ids) => api.listAdvances({ companyIds: ids })),
    read('expense claims', ['expense.view', 'expense.approve'], (ids) => api.listClaims({ companyIds: ids })),
    read('fixed assets', 'asset.view', (ids) => api.listAssets(ids)),
    read('cash boxes', 'treasury.view', (ids) => api.listCashBoxes(ids)),
    read('the ledger', 'report.view', (ids) => api.ledgerBalances(ids, '1990-01-01', asOf)),
    read('stock items', 'inventory.view', (ids) => api.listInvItems(ids)),
    read('stock items', 'inventory.view', (ids) => api.listInvCategories(ids)),
    read('stock counts', 'inventory.view', (ids) => api.listStockCounts(ids)),
    read('bank accounts', 'bank.view', (ids) => api.listBankAccounts(ids)),
    read('verifications', 'reality.view', (ids) => api.listVerifications(ids)),
    read('materiality', 'reality.view', (ids) => api.listMateriality(ids)),
    read('cases', 'reality.view', (ids) => api.listCases({ companyIds: ids })),
  ])
  const [assetEvents, cashCounts, bankTxns] = await Promise.all([
    each('asset verifications', assets, (a) => api.listAssetEvents(a.id)),
    each('cash counts', cashBoxes, (b) => api.listCashCounts(b.id)),
    each('bank statements', bankAccounts.filter((b) => b.kind === 'bank'), (b) => api.listBankTransactions(b.id)),
  ])

  // the size of what a sheet found is on its lines: they are read for the last sheet of each place, where it found differences
  const differing = lastSheets({ verifications }).filter((r) => Number((r.summary as { differ?: number }).differ ?? 0) > 0)
  const withLines = await Promise.all(differing.map((r) => api.getVerification(r.id).catch(() => { missing.add('verification sheets'); return null })))
  const sheets = verifications.map((r) => withLines.find((x) => x?.id === r.id) ?? r)

  const input: RealityInput = {
    asOf, materiality: Object.fromEntries(materiality.map((m) => [m.company_id, D(m.amount).toNumber()])),
    purchaseDocs, invoices, payments, stockDocs, advances, claims, assets, assetEvents, cashBoxes, cashCounts, ledger,
    accounts: accounts.filter((a) => companyIds.includes(a.company_id)), invItems, invCategories, stockCounts, bankAccounts: bankAccounts.filter((b) => b.kind === 'bank'), bankTxns, verifications: sheets,
  }
  const findings = findDifferences(input)
  const byKey = new Map<string, Case>()
  for (const c of cases) if (c.dedupe_key) byKey.set(c.dedupe_key, c)
  // a case opened on a line of a sheet is a case of that sheet: Reality shows it against the sheet, and offers no second one
  for (const c of cases) for (const l of c.links ?? []) if (l.entity === 'verification_runs' && !byKey.has('verification:' + l.entity_id)) byKey.set('verification:' + l.entity_id, c)
  return { asOf, input, findings, health: realityHealth(input, findings), unchecked: notChecked(input), missing: [...missing], materiality, cases: byKey }
}
