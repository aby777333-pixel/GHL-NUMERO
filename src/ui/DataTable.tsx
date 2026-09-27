import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useApp } from '@/store/app'
import { downloadCsv } from '@/lib/data'
import { cx, Empty } from './kit'

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  width?: number | string
  render: (row: T, index: number) => ReactNode
  /** value used for sorting; omit to make the column unsortable */
  sort?: (row: T) => string | number
  /** plain value for CSV export; omit to leave the column out of exports */
  csv?: (row: T) => string | number | null | undefined
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRow?: (row: T) => void
  pageSize?: number
  empty?: { title: string; body?: string; icon?: ReactNode; action?: ReactNode }
  footer?: ReactNode
  exportName?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  maxHeight?: number | string
  toolbar?: ReactNode
  /** server-side total when rows are only one page of a larger result */
  totalCount?: number
  rowClass?: (row: T) => string | undefined
}

/**
 * Tables never truncate silently (spec 1536): the pager always states how many
 * records exist, and exports contain every row in the current filter.
 */
export function DataTable<T>({ columns, rows, rowKey, onRow, pageSize = 50, empty, footer, exportName, initialSort, maxHeight, toolbar, totalCount, rowClass }: Props<T>) {
  const uiMode = useApp((s) => s.uiMode)
  const mode = useApp((s) => s.mode)
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const f = col.sort
    return [...rows].sort((a, b) => {
      const x = f(a), y = f(b)
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return sort.dir === 'asc' ? r : -r
    })
  }, [rows, sort, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => { if (page > pages - 1) setPage(0) }, [pages, page])
  const view = sorted.slice(page * pageSize, page * pageSize + pageSize)

  const doExport = () => {
    const cols = columns.filter((c) => c.csv)
    downloadCsv(`${exportName}${mode === 'demo' ? '-DEMO' : ''}`, cols.map((c) => c.header), sorted.map((r) => cols.map((c) => c.csv!(r))))
    useApp.getState().toast('ok', 'Export ready', `${sorted.length.toLocaleString()} row${sorted.length === 1 ? '' : 's'} exported${mode === 'demo' ? ' (sample data)' : ''}.`)
  }

  return (
    <div className="flex min-h-0 flex-col">
      {(toolbar || exportName) && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {exportName && rows.length > 0 && <button className="btn sm ghost" onClick={doExport} title="Export every row in the current filter"><Download size={13} /> Export CSV</button>}
        </div>
      )}
      <div className="min-h-0 overflow-auto" style={{ maxHeight }}>
        {rows.length === 0 ? (
          <Empty title={empty?.title ?? 'Nothing to show'} body={empty?.body} icon={empty?.icon} action={empty?.action} />
        ) : (
          <table className={cx('table', uiMode === 'accounting' && 'dense')}>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key
                  return (
                    <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left', cursor: c.sort ? 'pointer' : 'default' }} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      onClick={c.sort ? () => setSort(active ? (sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }) : undefined}>
                      <span className={cx('inline-flex items-center gap-1', active && 'text-gold')}>{c.header}{active && (sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={rowKey(r)} className={cx(onRow && 'rowlink', rowClass?.(r))} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
                  onKeyDown={onRow ? (e) => { if (e.key === 'Enter') onRow(r) } : undefined}>
                  {columns.map((c) => <td key={c.key} className={cx(c.align === 'right' && 'r', c.className)} style={{ textAlign: c.align }}>{c.render(r, page * pageSize + i)}</td>)}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
          <span>
            Showing <span className="num text-ink2">{(page * pageSize + 1).toLocaleString()}–{Math.min(sorted.length, (page + 1) * pageSize).toLocaleString()}</span> of <span className="num text-ink2">{sorted.length.toLocaleString()}</span>
            {totalCount !== undefined && totalCount > sorted.length && <> loaded · <span className="num text-warn">{totalCount.toLocaleString()}</span> match in total — narrow the filter or load more</>}
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-1.5">
              <button className="btn sm icon ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
              <span className="num">{page + 1} / {pages}</span>
              <button className="btn sm icon ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
