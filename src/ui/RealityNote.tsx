import { useNavigate } from 'react-router-dom'
import { ArrowRight, ScanSearch } from 'lucide-react'
import { can, capOn, useApp, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { loadReality } from '@/lib/realityData'
import { realityOfReport, type Chain } from '@/engine/reality'
import { fmtDate } from '@/lib/dates'
import { cx, Money, Spinner } from '@/ui/kit'

// =====================================================================
// Reconciliation status on a report (spec 1676).
// A report states what the books say. This strip states, beside it,
// whether the records the report rests on agree with each other: the
// documents, what was done, the books, the bank and what was found.
// It reads the same comparison as NUMERO Reality, as the records stand
// today. It changes no figure of the report.
// =====================================================================

const CHAIN_WORDS: Record<Chain, [string, string]> = {
  purchase: ['purchase order', 'purchase orders'], sale: ['sales invoice', 'sales invoices'], advance: ['advance', 'advances'], asset: ['fixed asset', 'fixed assets'],
  cash: ['cash box', 'cash boxes'], stock: ['stock ledger', 'stock ledgers'], bank: ['bank account', 'bank accounts'], verification: ['verification', 'verifications'],
}

export function RealityNote({ report, from, to, className }: { report: string; /** the first day of a report of a period; none for a report as at a day */ from?: string; to: string; className?: string }) {
  useApp((s) => s.session)
  useApp((s) => s.flags)
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const scope = useScopeIds()
  const on = capOn('reality')
  const ids = on ? scope.filter((id) => can('reality.view', id)) : []
  const key = ids.join(',')
  const relevant = realityOfReport(report, []) !== null
  const data = useAsync(async () => (relevant && ids.length ? loadReality(api, accounts, ids, can) : null), [api, key, report, relevant])

  if (!relevant || !on) return null
  const frame = 'no-print mb-4 rounded-xl border border-line px-4 py-3 text-[12.5px] text-ink2'
  if (!ids.length) return <div className={cx(frame, className)}><span className="eyebrow mr-2">Reconciliation</span>Not shown: your role does not read NUMERO Reality (reality.view) in the companies selected.</div>
  if (data.loading && !data.data) return <div className={cx(frame, 'flex items-center gap-2', className)}><Spinner size={13} /> <span className="eyebrow">Reconciliation</span> setting the records of this report against each other…</div>
  if (data.error || !data.data) return <div className={cx(frame, className)}><span className="eyebrow mr-2">Reconciliation</span>The comparison could not be made: {data.error ?? 'no answer'}. The figures of the report are not affected.</div>

  const d = data.data
  const r = realityOfReport(report, d.findings, { from, to })!
  const ccy = (id: string) => companies.find((c) => c.id === id)?.base_currency
  const leftOut = scope.length - ids.length
  const earlier = to < d.asOf
  const records = from ? <>the records of {fmtDate(from)} to {fmtDate(to)}</> : <>the records up to {fmtDate(to)}</>
  const open = (chain?: Chain) => nav('/reality?tab=differences' + (chain ? '&chain=' + chain : ''))

  return (
    <div className={cx('no-print mb-4 rounded-xl border px-4 py-3 text-[12.5px]', r.findings.length ? 'border-warn/30 bg-warnsoft' : 'border-line', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-ink"><ScanSearch size={14} className={r.findings.length ? 'text-warn' : 'text-pos'} /><span className="eyebrow">Reconciliation</span></span>
        <span className="min-w-0 flex-1 text-ink2">
          {r.findings.length
            ? <>Of {records} that this report rests on, <strong className="text-ink">{r.findings.length}</strong> {r.findings.length === 1 ? 'does' : 'do'} not agree with {r.findings.length === 1 ? 'its' : 'their'} other records{r.material ? <>, <strong className="text-ink">{r.material}</strong> above the threshold of {r.material === 1 ? 'its' : 'their'} company</> : <>, none above the threshold of its company</>}.</>
            : <>Among {records} that this report rests on, nothing was found to differ.</>}
          {' '}Compared as the records stand on {fmtDate(d.asOf)}{earlier ? <>, not as they stood on {fmtDate(to)}</> : null}.
        </span>
        <button className="btn sm" onClick={() => open()}>Open Reality <ArrowRight size={12} /></button>
      </div>
      {r.byChain.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.byChain.map((c) => (
            <button key={c.chain} className="chip warn" title="Open these differences in NUMERO Reality" onClick={() => open(c.chain)}>
              {c.count} {CHAIN_WORDS[c.chain][c.count === 1 ? 0 : 1]}{c.material ? ` · ${c.material} above the threshold` : ''}
            </button>
          ))}
        </div>
      )}
      {r.findings.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[12px] text-ink2">
          {r.findings.slice(0, 3).map((f) => <div key={f.key} className="flex flex-wrap items-baseline gap-x-2"><span className="min-w-0">{f.title}</span><Money value={f.amount} currency={ccy(f.company_id)} className="text-ink" />{d.cases.get(f.key) && <span className="text-muted">· case {d.cases.get(f.key)!.case_no}</span>}</div>)}
          {r.findings.length > 3 && <div className="text-muted">and {r.findings.length - 3} more, in NUMERO Reality.</div>}
        </div>
      )}
      {(d.unchecked.length > 0 || d.missing.length > 0 || leftOut > 0 || r.findings.some((f) => !d.materiality.some((m) => m.company_id === f.company_id))) && (
        <div className="mt-1 text-[11.5px] text-muted">
          {d.unchecked.length > 0 && <>Not looked at: {d.unchecked.join(' ')} </>}
          {d.missing.length > 0 && <>Your role does not read {d.missing.join(', ')} in every company selected; what they would add is not compared. </>}
          {leftOut > 0 && <>{leftOut} of the companies selected {leftOut === 1 ? 'is' : 'are'} left out: your role does not read Reality there. </>}
          {r.findings.some((f) => !d.materiality.some((m) => m.company_id === f.company_id)) && <>A company concerned has no threshold set: there, every difference counts as above it. </>}
          What was never checked is not counted as agreeing. How many records were checked in each reality is shown in NUMERO Reality, for the books as a whole.
        </div>
      )}
    </div>
  )
}
