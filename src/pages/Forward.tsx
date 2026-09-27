import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowUpRight, CalendarClock, HandCoins, Receipt } from 'lucide-react'
import { useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { openDocuments, statements, sumBase, type OpenDoc } from '@/lib/data'
import { ZERO } from '@/lib/money'
import { addDays, addMonths, fmtDate, startOfMonth, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Loading, Money, Note, PageHeader, Panel, Section, Truth } from '@/ui/kit'
import { Waterfall, type Step } from '@/ui/charts'

interface Horizon { key: string; label: string; end: (t: string) => string }
const HORIZONS: Horizon[] = [
  { key: 'd7', label: '7 days', end: (t) => addDays(t, 7) },
  { key: 'd30', label: '30 days', end: (t) => addDays(t, 30) },
  { key: 'd60', label: '60 days', end: (t) => addDays(t, 60) },
  { key: 'd90', label: '90 days', end: (t) => addDays(t, 90) },
  { key: 'm6', label: '6 months', end: (t) => addMonths(t, 6) },
  { key: 'm12', label: '12 months', end: (t) => addMonths(t, 12) },
]
const WEEKS = 12

const dueOf = (d: OpenDoc) => d.invoice.due_date ?? d.invoice.doc_date
const docPath = (d: OpenDoc) => (d.invoice.doc_type === 'sales_invoice' ? '/invoices/' : '/bills/') + d.invoice.id

export default function Forward() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const ids = useScopeIds()
  const currency = useCurrency()
  const [hz, setHz] = useState('d30')

  const main = useAsync(async () => {
    const t = today()
    const accs = accounts.filter((a) => ids.includes(a.company_id))
    const [invoices, st] = await Promise.all([
      api.listInvoices({ companyIds: ids }),
      statements(api, companies, accs, ids, startOfMonth(t), t),
    ])
    return { docs: openDocuments(invoices, t), cash: st.bs.cash, asAt: t }
  }, [api, ids.join(','), accounts.length])

  const partyName = (id: string) => parties.find((p) => p.id === id)?.display_name ?? 'Unknown party'
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? ''

  const d = main.data
  const t = d?.asAt ?? today()
  const docs = d?.docs ?? []
  const ins = docs.filter((x) => x.side === 'in')
  const outs = docs.filter((x) => x.side === 'out')

  const horizons = HORIZONS.map((h) => {
    const end = h.end(t)
    const inflow = sumBase(ins.filter((x) => dueOf(x) <= end))
    const outflow = sumBase(outs.filter((x) => dueOf(x) <= end))
    return { ...h, endDate: end, inflow, outflow, net: inflow.minus(outflow), count: docs.filter((x) => dueOf(x) <= end).length }
  })
  const selected = horizons.find((h) => h.key === hz) ?? horizons[1]

  const overdueIn = ins.filter((x) => x.daysOverdue > 0)
  const overdueOut = outs.filter((x) => x.daysOverdue > 0)

  // weekly calendar and running position
  let run = d?.cash ?? ZERO
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = addDays(t, i * 7)
    const end = addDays(start, 6)
    const due = docs.filter((x) => dueOf(x) >= start && dueOf(x) <= end).sort((a, b) => dueOf(a).localeCompare(dueOf(b)))
    // overdue documents have no future due date; they are assumed to settle in the first week
    const counted = i === 0 ? [...docs.filter((x) => dueOf(x) < start), ...due] : due
    const inflow = sumBase(counted.filter((x) => x.side === 'in'))
    const outflow = sumBase(counted.filter((x) => x.side === 'out'))
    run = run.plus(inflow).minus(outflow)
    return { index: i, start, end, due, inflow, outflow, position: run }
  })
  const shortfall = weeks.find((w) => w.position.lt(0))
  const lowest = weeks.reduce<(typeof weeks)[number] | null>((m, w) => (m === null || w.position.lt(m.position) ? w : m), null)
  const beyond = docs.filter((x) => dueOf(x) > addDays(t, WEEKS * 7 - 1))

  const concentration = (list: OpenDoc[]) => {
    const total = sumBase(list)
    if (total.lte(0)) return null
    const by = new Map<string, Decimal>()
    for (const x of list) by.set(x.invoice.party_id, (by.get(x.invoice.party_id) ?? ZERO).plus(x.outstandingBase))
    const [id, amount] = [...by.entries()].sort((a, b) => b[1].cmp(a[1]))[0]
    return { id, amount, total, pct: amount.div(total).times(100), parties: by.size }
  }
  const topCustomer = concentration(ins)
  const topVendor = concentration(outs)

  const steps: Step[] = d ? [
    { label: 'Cash today', value: d.cash.toNumber(), kind: 'start' },
    { label: 'Expected collections', value: selected.inflow.toNumber(), kind: 'in' },
    { label: 'Expected payments', value: selected.outflow.toNumber(), kind: 'out' },
    { label: 'Expected position', value: d.cash.plus(selected.net).toNumber(), kind: 'end' },
  ] : []

  const assumptions = (
    <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-4">
      <li>Every open invoice and bill is settled in full, exactly on its due date.</li>
      <li>Documents that are already overdue are settled within the first week.</li>
      <li>Only recorded invoices and bills are counted. Salaries, taxes, loan repayments and any sale or purchase not yet recorded as a document are not included.</li>
      <li>Foreign-currency documents are converted at the rate recorded on the document.</li>
    </ul>
  )

  return (
    <div>
      <PageHeader
        eyebrow="What is coming"
        title="Forward"
        truth="EXPECTED"
        subtitle={<>Known future money from recorded documents as at {fmtDate(t)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · figures in {currency}</>}
        actions={mode === 'demo' ? <Truth state="DEMO" /> : undefined}
      />

      <Note className="mb-5">
        Everything on this screen is EXPECTED: it comes from recorded invoices and bills and their due dates. It is not a forecast and not a guarantee. Statistical forecasting is planned and is tracked in the requirement ledger.
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} /></Panel>}

      {d && docs.length === 0 && (
        <Panel className="mb-5">
          <Empty icon={<CalendarClock size={20} />} title="No open invoices or bills" body="Nothing is outstanding in the selected companies, so there is no known future money to show." />
        </Panel>
      )}

      {d && docs.length > 0 && (
        <>
          {/* horizons */}
          <Section title="Horizons — open documents falling due, including those already overdue" className="mb-5">
            <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              {horizons.map((h) => (
                <Panel key={h.key} className={cx('p-4', hz === h.key && 'border-gold/40')} onClick={() => setHz(h.key)} title="Select this horizon for the waterfall below">
                  <div className="flex items-center justify-between gap-2">
                    <span className="eyebrow">Next {h.label}</span>
                    <Truth state="EXPECTED" />
                  </div>
                  <div className="mt-3 space-y-1.5 text-[12.5px]">
                    <div className="flex items-center justify-between gap-2"><span className="text-muted">Inflow</span><Money value={h.inflow} compact className="text-pos" /></div>
                    <div className="flex items-center justify-between gap-2"><span className="text-muted">Outflow</span><Money value={h.outflow} compact className="text-neg" /></div>
                    <div className="hairline" />
                    <div className="flex items-center justify-between gap-2"><span className="text-ink2">Net</span><Money value={h.net} compact sign colored className="text-[14px]" /></div>
                  </div>
                  <div className="mt-2 text-[11px] text-muted"><span className="num">{h.count}</span> document{h.count === 1 ? '' : 's'} due by {fmtDate(h.endDate)}</div>
                </Panel>
              ))}
            </div>
          </Section>

          <div className="mb-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            {/* waterfall */}
            <Panel className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div><div className="eyebrow">Cash horizon waterfall</div><div className="display mt-0.5 text-[15px]">Next {selected.label} · to {fmtDate(selected.endDate)}</div></div>
                <Truth state="EXPECTED" />
              </div>
              <Waterfall steps={steps} height={260} onStep={(s) => { if (s.kind === 'in') nav('/parties/owed?side=in'); else if (s.kind === 'out') nav('/parties/owed?side=out'); else if (s.kind === 'start') nav('/banking') }} />
              <div className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Cash today <Truth state="ACTUAL" /></span><Money value={d.cash} /></div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Collections <Truth state="EXPECTED" /></span><Money value={selected.inflow} /></div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Payments <Truth state="EXPECTED" /></span><Money value={selected.outflow} /></div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan/25 bg-cyansoft px-3 py-2"><span className="flex items-center gap-2 text-ink2">Position if everything is paid on its due date <Truth state="EXPECTED" /></span><Money value={d.cash.plus(selected.net)} className={d.cash.plus(selected.net).lt(0) ? 'text-neg' : undefined} /></div>
              </div>
              <div className="mt-3 text-[12px] leading-relaxed text-muted">
                Only the starting cash is a recorded fact. The closing bar is an EXPECTED position, not a balance in the books. It assumes every open invoice and bill due by {fmtDate(selected.endDate)} — including those already overdue — is settled in full on its due date, and that no other money moves.
              </div>
            </Panel>

            <div className="space-y-4">
              {/* overdue: facts */}
              <Panel className="p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><div className="eyebrow">Already overdue</div><div className="display mt-0.5 text-[15px]">Past their due date today</div></div>
                  <Truth state="ACTUAL" />
                </div>
                <div className="space-y-1.5">
                  <button onClick={() => nav('/parties/owed?side=in')} className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line2 hover:bg-surface2">
                    <span className={cx('lamp', overdueIn.length ? 'neg' : 'pos')} /><span className="text-muted"><HandCoins size={15} /></span>
                    <span className="min-w-0 flex-1 text-[13px]"><span className="num font-semibold text-ink">{overdueIn.length}</span> <span className="text-ink2">overdue receivable{overdueIn.length === 1 ? '' : 's'}</span></span>
                    <Money value={sumBase(overdueIn)} className="text-[12.5px]" />
                    <ArrowUpRight size={14} className="text-muted group-hover:text-gold" />
                  </button>
                  <button onClick={() => nav('/parties/owed?side=out')} className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line2 hover:bg-surface2">
                    <span className={cx('lamp', overdueOut.length ? 'warn' : 'pos')} /><span className="text-muted"><Receipt size={15} /></span>
                    <span className="min-w-0 flex-1 text-[13px]"><span className="num font-semibold text-ink">{overdueOut.length}</span> <span className="text-ink2">overdue payable{overdueOut.length === 1 ? '' : 's'}</span></span>
                    <Money value={sumBase(overdueOut)} className="text-[12.5px]" />
                    <ArrowUpRight size={14} className="text-muted group-hover:text-gold" />
                  </button>
                </div>
                <div className="mt-2.5 text-[11.5px] text-muted">These are recorded documents whose due date has passed. The amounts are outstanding balances in the books.</div>
              </Panel>

              {/* concentration: facts */}
              <Panel className="p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><div className="eyebrow">Concentration</div><div className="display mt-0.5 text-[15px]">Dependence on one party</div></div>
                  <Truth state="ACTUAL" />
                </div>
                <div className="space-y-2 text-[13px] text-ink2">
                  {topCustomer ? (
                    <div>
                      Customer <button className="link" onClick={() => nav('/parties/' + topCustomer.id)}>{partyName(topCustomer.id)}</button> accounts for <span className="num text-ink">{topCustomer.pct.toFixed(1)}%</span> of outstanding receivables
                      <span className="text-muted"> (<Money value={topCustomer.amount} compact /> of <Money value={topCustomer.total} compact /> across {topCustomer.parties} customer{topCustomer.parties === 1 ? '' : 's'}).</span>
                    </div>
                  ) : <div className="text-muted">No receivable is outstanding.</div>}
                  {topVendor ? (
                    <div>
                      Vendor <button className="link" onClick={() => nav('/parties/' + topVendor.id)}>{partyName(topVendor.id)}</button> accounts for <span className="num text-ink">{topVendor.pct.toFixed(1)}%</span> of outstanding payables
                      <span className="text-muted"> (<Money value={topVendor.amount} compact /> of <Money value={topVendor.total} compact /> across {topVendor.parties} vendor{topVendor.parties === 1 ? '' : 's'}).</span>
                    </div>
                  ) : <div className="text-muted">No payable is outstanding.</div>}
                </div>
              </Panel>
            </div>
          </div>

          {/* shortfall */}
          <Section title="Cash shortfall warning" className="mb-5" right={<Truth state="EXPECTED" />}>
            {shortfall ? (
              <Note kind="warn">
                <div className="font-medium text-ink">CASH SHORTFALL WARNING</div>
                <div className="mt-1">
                  If every recorded document is settled on its due date, the expected position falls below zero in the week of <span className="num text-ink">{fmtDate(shortfall.start)} – {fmtDate(shortfall.end)}</span> (week {shortfall.index + 1}), reaching <Money value={shortfall.position} className="text-neg" />.
                  {lowest && lowest.index !== shortfall.index && <> The lowest point in the next {WEEKS} weeks is <Money value={lowest.position} className="text-neg" /> in the week of {fmtDate(lowest.start)}.</>}
                </div>
                <div className="mt-2 text-ink2">This is an expectation built on these assumptions, not a recorded fact:</div>
                {assumptions}
              </Note>
            ) : (
              <Note kind="good">
                <div>
                  On recorded documents alone, the expected position does not fall below zero in any of the next {WEEKS} weeks.
                  {lowest && <> Its lowest point is <Money value={lowest.position} /> in the week of {fmtDate(lowest.start)}.</>}
                </div>
                <div className="mt-2 text-ink2">This is not an assurance. It rests on these assumptions:</div>
                {assumptions}
              </Note>
            )}
          </Section>

          {/* calendar */}
          <Section title={`Calendar — documents falling due in the next ${WEEKS} weeks`} right={<Truth state="EXPECTED" />}>
            <div className="space-y-3">
              {weeks.map((w) => (
                <Panel key={w.start} className="overflow-hidden" lit={false}>
                  <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-b border-line px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="num rounded-md border border-line bg-surface px-1.5 py-[1px] text-[10.5px] text-muted">W{w.index + 1}</span>
                      <span className="text-[13px] text-ink">{fmtDate(w.start)} – {fmtDate(w.end)}</span>
                      <span className="text-[11.5px] text-muted">{w.due.length} document{w.due.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
                      <span>In <Money value={sumBase(w.due.filter((x) => x.side === 'in'))} compact className="text-pos" /></span>
                      <span>Out <Money value={sumBase(w.due.filter((x) => x.side === 'out'))} compact className="text-neg" /></span>
                      <span title="Cash today plus cumulative expected inflows less cumulative expected outflows, overdue documents included in week 1">Expected position <Money value={w.position} compact className={w.position.lt(0) ? 'text-neg' : 'text-ink2'} /></span>
                    </div>
                  </div>
                  {w.due.length === 0 ? (
                    <div className="px-4 py-3 text-[12.5px] text-muted">No recorded document falls due in this week.</div>
                  ) : (
                    <table className="table">
                      <tbody>
                        {w.due.map((x) => (
                          <tr key={x.invoice.id} className="rowlink" tabIndex={0} onClick={() => nav(docPath(x))} onKeyDown={(e) => { if (e.key === 'Enter') nav(docPath(x)) }}>
                            <td style={{ width: 64 }}><span className={cx('chip', x.side === 'in' ? 'pos' : 'neg')}>{x.side === 'in' ? 'IN' : 'OUT'}</span></td>
                            <td><div className="truncate text-ink">{partyName(x.invoice.party_id)}</div><div className="truncate text-[11.5px] text-muted">{companyName(x.invoice.company_id)}</div></td>
                            <td><span className="num text-[12.5px] text-gold">{x.invoice.doc_no ?? '—'}</span></td>
                            <td><span className="num text-[12.5px]">{fmtDate(dueOf(x))}</span></td>
                            <td className="r"><Money value={x.outstandingBase} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              ))}
            </div>
            <div className="mt-2.5 text-[11.5px] text-muted">
              {overdueIn.length + overdueOut.length > 0 && <>{overdueIn.length + overdueOut.length} overdue document{overdueIn.length + overdueOut.length === 1 ? ' is' : 's are'} listed under “Already overdue”, not in the calendar. </>}
              {beyond.length > 0 ? <>{beyond.length} open document{beyond.length === 1 ? ' falls' : 's fall'} due after week {WEEKS} (<Money value={sumBase(beyond)} compact />) and {beyond.length === 1 ? 'is' : 'are'} counted in the longer horizons above.</> : <>No open document falls due after week {WEEKS}.</>}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
