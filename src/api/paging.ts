import { NumeroError } from '@/engine/types'

// =====================================================================
// READING LISTS TO THEIR END
// The API of the database hands over a page of rows to one request and
// says nothing of the rest. A list cut short in silence would be a false
// list: every list of the live data layer is read through these readers.
// They know nothing of the database: they are given a query that can be
// asked for a part of itself, and the size of a page.
// =====================================================================

export interface PageError { message: string; code?: string; details?: string | null; hint?: string | null }
/** what a list can be asked for a part of */
export interface Pageable {
  range(from: number, to: number): PromiseLike<{ data: unknown; error: PageError | null }>
  order(column: string): unknown
}

export function readers(page: () => Promise<number>, raise: (e: PageError) => never) {
  /** Pages of a list are parts of one list only when its order is complete: the key of the table is added after the order asked for. */
  const settled = (query: Pageable, key: string[]): Pageable => {
    let out = query
    for (const k of key) out = out.order(k) as Pageable
    return out
  }
  /**
   * Reads a list to its end, a page at a time. A list longer than `cap` is refused with an explanation;
   * it is never cut.
   */
  async function all<T>(query: Pageable, cap = 20000, key: string[] = ['id']): Promise<T[]> {
    const out: T[] = []
    const list = settled(query, key)
    const size = Math.max(1, await page())
    for (let from = 0; ; from += size) {
      const { data, error } = await list.range(from, from + size - 1)
      if (error) raise(error)
      const rows = (data ?? []) as T[]
      out.push(...rows)
      if (out.length > cap) throw new NumeroError(`More than ${cap.toLocaleString('en-IN')} records match, and a list cut short would be a false list. Narrow what is asked for: fewer companies, or a shorter period where the list has one.`)
      if (rows.length < size) return out
    }
  }
  /** The first `n` rows of a list that is shown in part: the newest notices, the latest movements. The caller says how many. */
  async function first<T>(query: Pageable, n: number, key: string[] = ['id']): Promise<T[]> {
    const out: T[] = []
    const list = settled(query, key)
    const size = Math.max(1, await page())
    for (let from = 0; from < n; from += size) {
      const want = Math.min(size, n - from)
      const { data, error } = await list.range(from, from + want - 1)
      if (error) raise(error)
      const rows = (data ?? []) as T[]
      out.push(...rows)
      if (rows.length < want) break
    }
    return out
  }
  return { all, first }
}
