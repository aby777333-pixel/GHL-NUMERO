import type { NumeroApi } from '@/api/types'
import type { Account, Company, ID, Invoice, LedgerBalanceRow } from '@/engine/types'
import { balanceSheet, cashFlow, joinBalances, profitAndLoss, trialBalance, bucketOf, DEFAULT_BUCKETS, type AccountBal } from '@/engine/reports'
import { D, ZERO } from '@/lib/money'
import { daysBetween, fyStart, monthsInRange, today } from '@/lib/dates'
import Decimal from 'decimal.js'

/** Balance-sheet balances honour each company's own fiscal year start. */
export async function balancesAsOf(api: NumeroApi, companies: Company[], ids: ID[], asOf: string, knownAt?: string | null): Promise<LedgerBalanceRow[]> {
  const byStart = new Map<number, ID[]>()
  for (const c of companies.filter((x) => ids.includes(x.id))) byStart.set(c.fy_start_month, [...(byStart.get(c.fy_start_month) ?? []), c.id])
  const parts = await Promise.all([...byStart.entries()].map(([m, list]) => api.ledgerBalances(list, fyStart(asOf, m), asOf, { knownAt: knownAt ?? undefined })))
  return parts.flat()
}

export async function statements(api: NumeroApi, companies: Company[], accounts: Account[], ids: ID[], from: string, to: string, knownAt?: string | null) {
  const [periodRows, bsRows] = await Promise.all([
    api.ledgerBalances(ids, from, to, { knownAt: knownAt ?? undefined }),
    balancesAsOf(api, companies, ids, to > today() ? today() : to, knownAt),
  ])
  const period = joinBalances(accounts, periodRows)
  const position = joinBalances(accounts, bsRows)
  return { period, position, pl: profitAndLoss(period), bs: balanceSheet(position), cf: cashFlow(period), tb: trialBalance(period) }
}

/** Per-company headline figures for company cards and comparisons. */
export async function companyFigures(api: NumeroApi, companies: Company[], accounts: Account[], ids: ID[], from: string, to: string, knownAt?: string | null) {
  const [periodRows, bsRows] = await Promise.all([
    api.ledgerBalances(ids, from, to, { knownAt: knownAt ?? undefined }),
    balancesAsOf(api, companies, ids, to > today() ? today() : to, knownAt),
  ])
  return ids.map((id) => {
    const acc = accounts.filter((a) => a.company_id === id)
    const pl = profitAndLoss(joinBalances(acc, periodRows.filter((r) => r.company_id === id)))
    const bs = balanceSheet(joinBalances(acc, bsRows.filter((r) => r.company_id === id)))
    const cf = cashFlow(joinBalances(acc, periodRows.filter((r) => r.company_id === id)))
    return { company: companies.find((c) => c.id === id)!, pl, bs, cf }
  })
}

export interface MonthlySeries { months: string[]; income: number[]; expense: number[]; profit: number[]; cash: number[] }
export async function monthlySeries(api: NumeroApi, accounts: Account[], ids: ID[], from: string, to: string): Promise<MonthlySeries> {
  const end = to > today() ? today() : to
  const months = monthsInRange(from, end)
  const [rows, open] = await Promise.all([api.ledgerMonthly(ids, from, end), api.ledgerBalances(ids, from, end)])
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const idx = new Map(months.map((m, i) => [m, i]))
  const income = months.map(() => 0), expense = months.map(() => 0), cashMove = months.map(() => 0)
  for (const r of rows) {
    const a = byId.get(r.account_id); const i = idx.get(r.month.slice(0, 10))
    if (!a || i === undefined) continue
    const net = Number(r.debit) - Number(r.credit)
    if (a.type === 'income') income[i] -= net
    else if (a.type === 'expense') expense[i] += net
    if (a.type === 'asset' && (a.subtype === 'cash' || a.subtype === 'bank')) cashMove[i] += net
  }
  let run = open.reduce((s, r) => {
    const a = byId.get(r.account_id)
    return a && a.type === 'asset' && (a.subtype === 'cash' || a.subtype === 'bank') ? s + Number(r.opening_debit) - Number(r.opening_credit) : s
  }, 0)
  const cash = cashMove.map((m) => (run += m))
  return { months, income, expense, profit: income.map((v, i) => v - expense[i]), cash }
}

// ---------------------------------------------------------------- open documents and ageing
export interface OpenDoc { invoice: Invoice; outstanding: Decimal; outstandingBase: Decimal; daysOverdue: number; bucket: string; side: 'in' | 'out' }
export function openDocuments(invoices: Invoice[], asOf = today()): OpenDoc[] {
  return invoices
    .filter((i) => (i.status === 'open' || i.status === 'partially_paid') && (i.doc_type === 'sales_invoice' || i.doc_type === 'purchase_bill'))
    .map((invoice) => {
      const outstanding = D(invoice.total).minus(invoice.amount_settled)
      const daysOverdue = daysBetween(invoice.due_date ?? invoice.doc_date, asOf)
      return { invoice, outstanding, outstandingBase: outstanding.times(invoice.fx_rate).toDecimalPlaces(2), daysOverdue, bucket: bucketOf(daysOverdue).key, side: invoice.doc_type === 'sales_invoice' ? ('in' as const) : ('out' as const) }
    })
    .filter((d) => d.outstanding.gt(0))
}
export function ageingTotals(docs: OpenDoc[]) {
  const t = Object.fromEntries(DEFAULT_BUCKETS.map((b) => [b.key, ZERO])) as Record<string, Decimal>
  for (const d of docs) t[d.bucket] = t[d.bucket].plus(d.outstandingBase)
  return t
}
export const sumBase = (docs: OpenDoc[]) => docs.reduce((s, d) => s.plus(d.outstandingBase), ZERO)

export const accountIdsWhere = (bals: AccountBal[], f: (a: Account) => boolean) => bals.filter((b) => f(b.account)).map((b) => b.account.id)

/** Builds a link into the general ledger that reproduces a figure. */
export function ledgerLink(o: { accounts?: ID[]; party?: ID; from?: string; to?: string; min?: number; q?: string; unit?: ID }) {
  const p = new URLSearchParams()
  if (o.accounts?.length) p.set('accounts', o.accounts.join(','))
  if (o.party) p.set('party', o.party)
  if (o.from) p.set('from', o.from)
  if (o.to) p.set('to', o.to)
  if (o.min) p.set('min', String(o.min))
  if (o.q) p.set('q', o.q)
  if (o.unit) p.set('unit', o.unit)
  return '/ledger?' + p.toString()
}

export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name.endsWith('.csv') ? name : name + '.csv'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Minimal CSV parser supporting quoted fields; returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}
