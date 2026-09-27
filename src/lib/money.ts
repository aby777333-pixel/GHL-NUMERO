import Decimal from 'decimal.js'

// Decimal-safe monetary arithmetic (spec 91). Floating point is never used for money.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type Money = Decimal
export const D = (v: Decimal.Value | null | undefined): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0)
  try {
    return new Decimal(typeof v === 'string' ? v.replace(/,/g, '') : v)
  } catch {
    return new Decimal(0)
  }
}
export const ZERO = new Decimal(0)
export const sum = (xs: Decimal.Value[]): Decimal => xs.reduce<Decimal>((a, b) => a.plus(D(b)), ZERO)
export const round2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2)

const SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'CHF ', SAR: 'SAR ', CNY: '¥',
}
export const symbolOf = (ccy = 'INR') => SYMBOLS[ccy] ?? ccy + ' '

export interface FmtOpts {
  currency?: string
  compact?: boolean
  decimals?: number
  sign?: boolean
  mask?: boolean
  bare?: boolean // no currency symbol
}

/** Full-precision grouping. Indian grouping (lakh/crore) for INR, western otherwise. */
export function groupDigits(intPart: string, indian: boolean): string {
  if (!indian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (intPart.length <= 3) return intPart
  const last3 = intPart.slice(-3)
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return rest + ',' + last3
}

export function fmtMoney(v: Decimal.Value | null | undefined, o: FmtOpts = {}): string {
  const ccy = o.currency ?? 'INR'
  const sym = o.bare ? '' : symbolOf(ccy)
  if (o.mask) return sym + '••••••••'
  const d = D(v)
  const neg = d.isNegative() && !d.isZero()
  const abs = d.abs()
  let body: string
  if (o.compact) {
    body = compact(abs, ccy === 'INR')
  } else {
    const dec = o.decimals ?? 2
    const fixed = abs.toFixed(dec)
    const [i, f] = fixed.split('.')
    body = groupDigits(i, ccy === 'INR') + (f ? '.' + f : '')
  }
  const s = neg ? '−' : o.sign && !d.isZero() ? '+' : ''
  return s + sym + body
}

function compact(abs: Decimal, indian: boolean): string {
  const trim = (x: Decimal, dp: number) => x.toDecimalPlaces(dp).toString()
  if (indian) {
    if (abs.gte(1e7)) return trim(abs.div(1e7), 2) + ' Cr'
    if (abs.gte(1e5)) return trim(abs.div(1e5), 2) + ' L'
    if (abs.gte(1e3)) return trim(abs.div(1e3), 1) + ' K'
    return trim(abs, 0)
  }
  if (abs.gte(1e9)) return trim(abs.div(1e9), 2) + ' B'
  if (abs.gte(1e6)) return trim(abs.div(1e6), 2) + ' M'
  if (abs.gte(1e3)) return trim(abs.div(1e3), 1) + ' K'
  return trim(abs, 0)
}

export const fmtPct = (v: Decimal.Value | null | undefined, dp = 1) => {
  if (v === null || v === undefined) return '—'
  const d = D(v)
  return (d.isNegative() ? '−' : '') + d.abs().toFixed(dp) + '%'
}

export const pctChange = (now: Decimal.Value, before: Decimal.Value): Decimal | null => {
  const b = D(before)
  if (b.isZero()) return null
  return D(now).minus(b).div(b.abs()).times(100)
}

/**
 * Parses spoken / typed amounts. Never guesses: returns null when no amount is found.
 * "₹45,000" · "45k" · "1.2 lakh" · "5 crore" · "₹4.8 lakh" · "2,50,000" · "10 lakhs"
 */
export function parseAmount(text: string): Decimal | null {
  const t = text.toLowerCase().replace(/,/g, '')
  const m = t.match(/(?:₹|rs\.?|inr|rupees?)?\s*(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousand|k|million|mn|m|billion|bn)?\b/)
  if (!m) return null
  let n = new Decimal(m[1])
  const unit = m[2]
  if (unit) {
    if (/^cr|crore/.test(unit)) n = n.times(1e7)
    else if (/^(lakh|lac|l$)/.test(unit)) n = n.times(1e5)
    else if (/^(thousand|k)/.test(unit)) n = n.times(1e3)
    else if (/^(million|mn|m$)/.test(unit)) n = n.times(1e6)
    else if (/^(billion|bn)/.test(unit)) n = n.times(1e9)
  }
  return n
}
