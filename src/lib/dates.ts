// Date helpers work on ISO date strings (YYYY-MM-DD) to avoid timezone drift in accounting dates.

export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const today = () => iso(new Date())
export const parseISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export const addDays = (s: string, n: number) => {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export const addMonths = (s: string, n: number) => {
  const d = parseISO(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return iso(d)
}
export const startOfMonth = (s: string) => s.slice(0, 8) + '01'
export const endOfMonth = (s: string) => {
  const d = parseISO(s)
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}
export const daysBetween = (a: string, b: string) =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)

/** Fiscal year label number: the calendar year in which the fiscal year starts. */
export const fiscalYearOf = (date: string, fyStartMonth = 4) => {
  const d = parseISO(date)
  return d.getMonth() + 1 >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1
}
export const fyStart = (date: string, fyStartMonth = 4) => `${fiscalYearOf(date, fyStartMonth)}-${pad(fyStartMonth)}-01`
export const fyEnd = (date: string, fyStartMonth = 4) => addDays(addMonths(fyStart(date, fyStartMonth), 12), -1)
export const fyLabel = (date: string, fyStartMonth = 4) => {
  const y = fiscalYearOf(date, fyStartMonth)
  return fyStartMonth === 1 ? `FY ${y}` : `FY ${y}-${String(y + 1).slice(2)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (s?: string | null) => {
  if (!s) return '—'
  const d = parseISO(s)
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
export const fmtMonth = (s: string) => {
  const d = parseISO(s)
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}
export const fmtDateTime = (s?: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'last_12' | 'all' | 'custom'
export interface Period { key: PeriodKey; from: string; to: string; label: string }

export function resolvePeriod(key: PeriodKey, fyStartMonth = 4, ref = today(), custom?: { from: string; to: string }): Period {
  const som = startOfMonth(ref)
  const fys = fyStart(ref, fyStartMonth)
  const monthsIntoFy = (parseISO(som).getFullYear() - parseISO(fys).getFullYear()) * 12 + parseISO(som).getMonth() - parseISO(fys).getMonth()
  const qStart = addMonths(fys, Math.floor(monthsIntoFy / 3) * 3)
  switch (key) {
    case 'this_month': return { key, from: som, to: endOfMonth(ref), label: 'This month' }
    case 'last_month': { const f = addMonths(som, -1); return { key, from: f, to: endOfMonth(f), label: 'Last month' } }
    case 'this_quarter': return { key, from: qStart, to: addDays(addMonths(qStart, 3), -1), label: 'This quarter' }
    case 'last_quarter': { const f = addMonths(qStart, -3); return { key, from: f, to: addDays(qStart, -1), label: 'Last quarter' } }
    case 'fy': return { key, from: fys, to: fyEnd(ref, fyStartMonth), label: fyLabel(ref, fyStartMonth) }
    case 'last_fy': { const f = addMonths(fys, -12); return { key, from: f, to: addDays(fys, -1), label: fyLabel(f, fyStartMonth) } }
    case 'last_12': return { key, from: addMonths(som, -11), to: endOfMonth(ref), label: 'Last 12 months' }
    case 'all': return { key, from: '1990-01-01', to: '2999-12-31', label: 'All time' }
    case 'custom': return { key, from: custom?.from ?? som, to: custom?.to ?? ref, label: 'Custom range' }
  }
}

/** The immediately preceding period of equal length (for comparisons). */
export function previousPeriod(p: Period): { from: string; to: string } {
  const len = daysBetween(p.from, p.to) + 1
  if (p.from.endsWith('-01') && p.to === endOfMonth(p.to)) {
    const months = (parseISO(p.to).getFullYear() - parseISO(p.from).getFullYear()) * 12 + parseISO(p.to).getMonth() - parseISO(p.from).getMonth() + 1
    const from = addMonths(p.from, -months)
    return { from, to: endOfMonth(addMonths(from, months - 1)) }
  }
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) }
}

export const monthsInRange = (from: string, to: string): string[] => {
  const out: string[] = []
  let m = startOfMonth(from)
  while (m <= to) {
    out.push(m)
    m = addMonths(m, 1)
  }
  return out
}
