import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Decimal from 'decimal.js'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, ExternalLink, ListChecks, PackageCheck, ShieldAlert } from 'lucide-react'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { loadForward } from '@/lib/forwardData'
import type { PayrollRun } from '@/engine/opsTypes'
import {
  calendarMonth, cashHorizon, earlyWarnings, openCommitments, CERTAINTY_MEANING, CERTAINTY_ORDER, HORIZONS,
  type ForwardCertainty, type ForwardEvent, type ForwardSource, type ForwardWarning, type HorizonRow, type WarningLevel,
} from '@/engine/forward'
import { D, sum, ZERO } from '@/lib/money'
import { addDays, addMonths, daysBetween, fmtDate, parseISO, startOfMonth, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Section, StatusChip, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Waterfall, type Step } from '@/ui/charts'
import { useCompanyName, usePartyName } from '@/ui/ops'

const THRESHOLD_KEY = 'numero.cashThreshold'
const FIVE_YEARS = 1826
const PRIORITY_DAYS = 60
const MAX_BARS = 5

const CERT_CLS: Record<ForwardCertainty, string> = {
  DUE: 'pos', CONTRACTED: 'cyan', COMMITTED: 'cyan', SCHEDULED: 'cyan', EXPECTED: 'gold', PROBABLE: 'gold', POSSIBLE: 'warn', CONTINGENT: 'warn', FORECAST: 'violet',
}
const SOURCE_LABEL: Record<ForwardSource, string> = {
  invoice: 'Sales invoice', bill: 'Purchase bill', purchase_order: 'Purchase order', register: 'Register', loan: 'Loan', deposit: 'Fixed deposit',
  payroll: 'Payroll', claim: 'Expense claim', advance: 'Advance', document: 'Document',
}
const LEVELS: { key: WarningLevel; label: string; lamp: string }[] = [
  { key: 'critical', label: 'Critical', lamp: 'neg' },
  { key: 'priority', label: 'Priority', lamp: 'warn' },
  { key: 'review', label: 'For review', lamp: 'cyan' },
  { key: 'info', label: 'For information', lamp: '' },
]
const WEATHER: { key: string; label: string; sub: string }[] = [
  { key: 'today', label: 'Today', sub: 'dated today or already overdue' },
  { key: '7d', label: 'Next 7 days', sub: 'includes today and anything overdue' },
  { key: '30d', label: 'Next 30 days', sub: 'includes the next 7 days' },
  { key: '90d', label: 'Next 90 days', sub: 'includes the next 30 days' },
]
const CONFIDENCE_CLS: Record<HorizonRow['confidence'], string> = { HIGH: 'pos', MEDIUM: 'warn', LOW: 'neg' }
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const foot = 'border-t border-line2 px-[14px] py-[10px]'

/** Privacy mode hides figures inside sentences written by the engine; dates stay readable. */
const maskFigures = (s: string) => s.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) => (i % 2 ? part : part.replace(/\d[\d,]*(\.\d+)?/g, '••'))).join('')

const readThreshold = () => { try { return localStorage.getItem(THRESHOLD_KEY) ?? '' } catch { return '' } }

function CertaintyChip({ value }: { value: ForwardCertainty }) {
  return <span className={cx('chip', CERT_CLS[value])} title={CERTAINTY_MEANING[value] ?? 'Certainty as recorded on the source record.'}>{value}</span>
}

function ExpectedDate({ e }: { e: ForwardEvent }) {
  if (!e.expected_date) return <span className="text-muted">—</span>
  const promised = (e.expected_basis ?? '').startsWith('PROMISED')
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={e.expected_basis}>
      <span className="num text-[12.5px]">{fmtDate(e.expected_date)}</span>
      <span className={cx('chip', promised ? 'cyan' : 'violet')}>{promised ? 'PROMISED' : 'ESTIMATE'}</span>
    </span>
  )
}

type Commitment = ReturnType<typeof openCommitments>[number]

export default function Forward() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const privacy = useApp((s) => s.privacy)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const currency = useCurrency()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const asOf = today()
  const until = addDays(asOf, FIVE_YEARS)
  const payrollAllowed = can('payroll.view')

  const [hz, setHz] = useState('30d')
  const [useExpectedDates, setUseExpectedDates] = useState(false)
  const [threshold, setThreshold] = useState(readThreshold)
  const [openWarning, setOpenWarning] = useState<string | null>(null)
  const [month, setMonth] = useState(startOfMonth(asOf))
  const [day, setDay] = useState<string | null>(null)
  const [fDirection, setFDirection] = useState<'' | 'in' | 'out'>('')
  const [fCertainty, setFCertainty] = useState<'' | ForwardCertainty>('')
  const [fSource, setFSource] = useState<'' | ForwardSource>('')

  // every source is read where the person holds its permission; a source left out is named on screen
  const main = useAsync(async () => {
    const f = await loadForward(api, ids, accounts, FIVE_YEARS, can)
    const i = f.input
    return {
      invoices: i.invoices ?? [], payments: i.payments ?? [], promises: i.promises ?? [], purchaseDocs: i.purchaseDocs ?? [], registerItems: i.registerItems ?? [], registerKinds: i.registerKinds ?? [],
      loans: i.loans ?? [], loanSchedule: i.loanSchedule ?? [], deposits: i.deposits ?? [], claims: i.claims ?? [], advances: i.advances ?? [], payrollRuns: i.payrollRuns ?? [],
      documents: f.documents, balances: f.balances, missing: f.missing, covered: f.covered, events: f.events,
    }
  }, [api, idsKey, asOf, accounts.length])

  const d = main.data
  const mask = (s: string) => (privacy ? maskFigures(s) : s)

  const openingCash = useMemo(() => {
    const money = new Set(accounts.filter((a) => a.subtype === 'cash' || a.subtype === 'bank').map((a) => a.id))
    return sum((d?.balances ?? []).filter((r) => money.has(r.account_id)).map((r) => D(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit)))
  }, [d, accounts])

  const events = useMemo(() => d?.events ?? [], [d])

  const rows = useMemo(() => cashHorizon(events, openingCash, asOf, { useExpectedDates }), [events, openingCash, asOf, useExpectedDates])
  const selected = rows.find((r) => r.key === hz) ?? rows[3]

  const warnings = useMemo(() => (d ? earlyWarnings({
    asOf, until, events, openingCash, cashThreshold: D(threshold || 0), documents: d.documents, partyName,
    registerItems: d.registerItems, registerKinds: d.registerKinds, deposits: d.deposits, advances: d.advances, promises: d.promises,
    invoices: d.invoices, payments: d.payments, purchaseDocs: d.purchaseDocs, loans: d.loans, loanSchedule: d.loanSchedule, payrollRuns: d.payrollRuns, claims: d.claims,
  }) : []), [d, events, openingCash, threshold, partyName, asOf, until])
  const undatedWarnings = warnings.filter((w) => !w.date).length
  const companies = useApp((x) => x.companies)
  const baseOf = useMemo(() => new Map(companies.map((c) => [c.id, c.base_currency])), [companies])
  const foreign = useMemo(() => events.filter((e) => e.currency && e.currency !== baseOf.get(e.company_id)), [events, baseOf])

  const commitments = useMemo(() => (d ? openCommitments(d.purchaseDocs, d.invoices) : []), [d])
  const commitmentsBase = sum(commitments.map((c) => c.openBase))

  const priority = useMemo(() => {
    const end = addDays(asOf, PRIORITY_DAYS)
    return events.filter((e) => e.direction === 'out' && e.date <= end)
  }, [events, asOf])
  const priorityFirm = sum(priority.filter((e) => e.certainty !== 'CONTINGENT').map((e) => e.amount))
  const priorityContingent = sum(priority.filter((e) => e.certainty === 'CONTINGENT').map((e) => e.amount))

  const cal = useMemo(() => calendarMonth(events, month), [events, month])
  const sources = useMemo(() => [...new Set(events.map((e) => e.source))].sort(), [events])
  const shown = events.filter((e) => (!fDirection || e.direction === fDirection) && (!fCertainty || e.certainty === fCertainty) && (!fSource || e.source === fSource))
  const shownIn = sum(shown.filter((e) => e.direction === 'in' && e.certainty !== 'CONTINGENT').map((e) => e.amount))
  const shownOut = sum(shown.filter((e) => e.direction === 'out' && e.certainty !== 'CONTINGENT').map((e) => e.amount))
  const shownContingent = sum(shown.filter((e) => e.certainty === 'CONTINGENT').map((e) => e.amount))

  const steps: Step[] = useMemo(() => {
    if (!selected) return []
    const used = new Set<string>(['Cash today', 'Projected cash'])
    const unique = (label: string, dir: 'in' | 'out') => {
      let l = label
      for (let n = 1; used.has(l); n++) l = n === 1 ? `${label} (${dir})` : `${label} (${dir} ${n})`
      used.add(l)
      return l
    }
    const side = (dir: 'in' | 'out'): Step[] => {
      const list = selected.byCategory.filter((c) => c.direction === dir && c.amount.gt(0))
      const out: Step[] = list.slice(0, MAX_BARS).map((c) => ({ label: unique(c.category, dir), value: c.amount.toNumber(), kind: dir }))
      const rest = list.slice(MAX_BARS)
      if (rest.length) out.push({ label: unique(`+${rest.length} more ${dir === 'in' ? 'inflows' : 'outflows'}`, dir), value: sum(rest.map((c) => c.amount)).toNumber(), kind: dir })
      return out
    }
    return [{ label: 'Cash today', value: openingCash.toNumber(), kind: 'start' }, ...side('in'), ...side('out'), { label: 'Projected cash', value: selected.projected.toNumber(), kind: 'end' }]
  }, [selected, openingCash])

  const changeThreshold = (v: string) => {
    const clean = v.replace(/[^\d.]/g, '')
    setThreshold(clean)
    try { localStorage.setItem(THRESHOLD_KEY, clean) } catch { /* storage is unavailable; the value applies to this visit only */ }
  }
  const go = (link?: string) => { if (link && link !== '/forward') nav(link) }

  const horizonColumns: Column<HorizonRow>[] = [
    { key: 'label', header: 'Horizon', render: (r) => <button className="link" onClick={() => setHz(r.key)}>{r.label}</button>, csv: (r) => r.label },
    { key: 'until', header: 'Until', render: (r) => <span className="num text-[12.5px]">{fmtDate(r.until)}</span>, csv: (r) => r.until },
    { key: 'fin', header: 'Firm inflow', align: 'right', render: (r) => <Money value={r.firmInflow} dim />, csv: (r) => r.firmInflow.toFixed(2) },
    { key: 'sin', header: 'Other inflow', align: 'right', render: (r) => <Money value={r.softInflow} dim />, csv: (r) => r.softInflow.toFixed(2) },
    { key: 'fout', header: 'Firm outflow', align: 'right', render: (r) => <Money value={r.firmOutflow} dim />, csv: (r) => r.firmOutflow.toFixed(2) },
    { key: 'sout', header: 'Other outflow', align: 'right', render: (r) => <Money value={r.softOutflow} dim />, csv: (r) => r.softOutflow.toFixed(2) },
    { key: 'proj', header: 'Projected cash', align: 'right', render: (r) => <Money value={r.projected} className={cx('font-medium', r.projected.lt(0) ? 'text-neg' : 'text-ink')} />, csv: (r) => r.projected.toFixed(2) },
    { key: 'conf', header: 'Confidence', render: (r) => <span className={cx('chip', CONFIDENCE_CLS[r.confidence])} title={r.confidenceWhy}>{r.confidence}</span>, csv: (r) => r.confidence },
  ]

  const commitmentColumns: Column<Commitment>[] = [
    { key: 'order', header: 'Order', sort: (c) => c.po.doc_no, csv: (c) => c.po.doc_no, render: (c) => <div className="min-w-0"><div className="num text-[12.5px] text-gold">{c.po.doc_no}</div>{c.po.title && <div className="truncate text-[11.5px] text-muted">{c.po.title}</div>}</div> },
    { key: 'vendor', header: 'Vendor', sort: (c) => partyName(c.po.party_id).toLowerCase(), csv: (c) => partyName(c.po.party_id), render: (c) => <span className="text-ink2">{partyName(c.po.party_id)}</span> },
    { key: 'ordered', header: 'Ordered', align: 'right', sort: (c) => c.ordered.toNumber(), csv: (c) => c.ordered.toFixed(2), render: (c) => <Money value={c.ordered} currency={c.po.currency} /> },
    { key: 'billed', header: 'Billed', align: 'right', sort: (c) => c.billed.toNumber(), csv: (c) => c.billed.toFixed(2), render: (c) => <Money value={c.billed} currency={c.po.currency} dim /> },
    { key: 'open', header: 'Open', align: 'right', sort: (c) => c.open.toNumber(), csv: (c) => c.open.toFixed(2), render: (c) => <Money value={c.open} currency={c.po.currency} className="font-medium text-ink" /> },
    { key: 'base', header: `Open with tax, in ${currency}`, align: 'right', sort: (c) => c.openBase.toNumber(), csv: (c) => c.openBase.toFixed(2), render: (c) => <Money value={c.openBase} /> },
    { key: 'label', header: 'Label', csv: () => 'COMMITTED', render: () => <CertaintyChip value="COMMITTED" /> },
  ]

  const overdueChip = (e: ForwardEvent) => {
    if (!e.overdue) return <span className="text-muted">—</span>
    const n = daysBetween(e.date, asOf)
    return <span className="chip neg">overdue {n} day{n === 1 ? '' : 's'}</span>
  }

  const priorityColumns: Column<ForwardEvent>[] = [
    { key: 'date', header: 'Due date', sort: (e) => e.date, csv: (e) => e.date, render: (e) => <span className="num text-[12.5px]">{fmtDate(e.date)}</span> },
    { key: 'what', header: 'What', sort: (e) => e.label.toLowerCase(), csv: (e) => e.label, render: (e) => <div className="min-w-0"><div className="truncate text-ink">{e.label}</div><div className="truncate text-[11.5px] text-muted">{e.category} · {companyName(e.company_id)}</div></div> },
    { key: 'party', header: 'Party', sort: (e) => partyName(e.party_id).toLowerCase(), csv: (e) => (e.party_id ? partyName(e.party_id) : ''), render: (e) => <span className="text-ink2">{partyName(e.party_id)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: (e) => e.amount.toNumber(), csv: (e) => e.amount.toFixed(2), render: (e) => <Money value={e.amount} /> },
    { key: 'certainty', header: 'Certainty', sort: (e) => CERTAINTY_ORDER.indexOf(e.certainty), csv: (e) => e.certainty, render: (e) => <CertaintyChip value={e.certainty} /> },
    { key: 'overdue', header: 'Overdue', sort: (e) => (e.overdue ? daysBetween(e.date, asOf) : 0), csv: (e) => (e.overdue ? `${daysBetween(e.date, asOf)} days` : ''), render: overdueChip },
  ]

  const eventColumns: Column<ForwardEvent>[] = [
    { key: 'date', header: 'Date', sort: (e) => e.date, csv: (e) => e.date, render: (e) => <div><span className="num text-[12.5px]">{fmtDate(e.date)}</span>{e.overdue && <div className="mt-0.5"><span className="chip neg">overdue</span></div>}</div> },
    { key: 'expected', header: 'Expected date', sort: (e) => e.expected_date ?? '', csv: (e) => (e.expected_date ? `${e.expected_date} — ${e.expected_basis ?? ''}` : ''), render: (e) => <ExpectedDate e={e} /> },
    { key: 'label', header: 'What', sort: (e) => e.label.toLowerCase(), csv: (e) => e.label, render: (e) => <div className="min-w-0 max-w-[280px]"><div className="truncate text-ink" title={e.label}>{e.label}</div><div className="truncate text-[11.5px] text-muted">{SOURCE_LABEL[e.source]} · {companyName(e.company_id)}</div></div> },
    { key: 'party', header: 'Party', sort: (e) => partyName(e.party_id).toLowerCase(), csv: (e) => (e.party_id ? partyName(e.party_id) : ''), render: (e) => <span className="text-ink2">{partyName(e.party_id)}</span> },
    { key: 'category', header: 'Category', sort: (e) => e.category, csv: (e) => e.category, render: (e) => <span className="text-[12.5px] text-ink2">{e.category}</span> },
    { key: 'certainty', header: 'Certainty', sort: (e) => CERTAINTY_ORDER.indexOf(e.certainty), csv: (e) => e.certainty, render: (e) => <CertaintyChip value={e.certainty} /> },
    { key: 'direction', header: 'Direction', sort: (e) => e.direction, csv: (e) => (e.direction === 'in' ? 'Inflow' : 'Outflow'), render: (e) => <span className="chip">{e.direction === 'in' ? 'IN' : 'OUT'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: (e) => e.amount.toNumber(), csv: (e) => e.amount.toFixed(2), render: (e) => <Money value={e.amount} className={e.direction === 'in' ? 'text-pos' : 'text-neg'} /> },
    { key: 'basis', header: 'How this was arrived at', csv: (e) => e.basis, render: (e) => <span className="block max-w-[340px] text-[12px] leading-snug text-muted">{mask(e.basis)}</span> },
  ]

  // calendar geometry: weeks start on Monday
  const monthDate = parseISO(month)
  const daysInMonth = Number(cal.to.slice(8, 10))
  const lead = (monthDate.getDay() + 6) % 7
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(cal.from, i))]
  const dayEvents = day ? cal.days.get(day) ?? [] : []
  const tot = (list: ForwardEvent[], dir: 'in' | 'out') => sum(list.filter((e) => e.direction === dir && e.certainty !== 'CONTINGENT').map((e) => e.amount))
  const monthIn = sum([...cal.days.values()].map((l) => tot(l, 'in')))
  const monthOut = sum([...cal.days.values()].map((l) => tot(l, 'out')))
  const moveMonth = (n: number) => { setMonth(addMonths(month, n)); setDay(null) }

  const nothing = !!d && events.length === 0 && warnings.length === 0

  return (
    <div>
      <PageHeader
        eyebrow="Forward"
        title="NUMERO FORWARD"
        truth="FORECAST"
        subtitle={<>What has been agreed, what is committed, what is due, what could go wrong. Every figure comes from recorded documents and registers, and each carries its own certainty. As at {fmtDate(asOf)} · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'} · figures in {currency}.</>}
        actions={mode === 'demo' ? <Truth state="DEMO" /> : undefined}
      />

      {d && foreign.length > 0 && (
        <Note kind="warn" className="mb-4">
          <strong className="text-ink">{foreign.length} item{foreign.length === 1 ? ' is' : 's are'} recorded in another currency and counted at face value.</strong> Register items, loans, deposits, claims and advances carry a currency but no exchange rate, so NUMERO cannot convert them: {[...new Set(foreign.map((e) => e.currency))].join(', ')}. Treat the totals as approximate until these are reviewed.
        </Note>
      )}
      {d && d.covered.length > 0 && (
        <Note className="mb-4">
          {d.covered.length} scheduled occurrence{d.covered.length === 1 ? ' was' : 's were'} left out because a bill or invoice from the same party is already recorded for that period: counting both would count the same money twice. For example {d.covered.slice(0, 3).map((c) => `${c.ref_no} on ${fmtDate(c.date)} (${c.doc_no ?? 'document without a number'})`).join('; ')}. This is an inference from the party and the date; if the document is for something else, the schedule is understated.
        </Note>
      )}
      <Note className="mb-4">
        <strong className="text-ink">What this projection assumes.</strong> Payroll is projected at net pay; remittances of tax deducted and statutory dues are not projected. An amount marked POSSIBLE or PROBABLE is counted in full in “Projected (all)”: a recorded probability is shown, never applied. A scheduled item whose date has passed stays overdue until a person records the bill or moves the date.
      </Note>
      {d && d.missing.length > 0 && (
        <Note kind="warn" className="mb-4">
          <strong className="text-ink">These figures are incomplete for you.</strong> Not included, because your role does not allow you to read them in every selected company: {d.missing.join(', ')}.{!payrollAllowed && ' Payroll is not included: you do not have payroll access.'} What you cannot see still exists and still affects cash.
        </Note>
      )}
      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={7} label="Loading recorded documents and registers" /></Panel>}

      {nothing && (
        <Panel className="mb-5">
          <Empty icon={<Compass size={20} />} title="Nothing is recorded that reaches into the future"
            body="Forward is built from open invoices and bills, approved purchase orders, register items, loans, deposits, payroll, claims and advances. Record any of these and they appear here with their certainty."
            action={<button className="btn" onClick={() => nav('/registers')}>Open the registers</button>} />
        </Panel>
      )}

      {d && !nothing && selected && (
        <>
          {/* ------------------------------------------------ money weather */}
          <Section title="Money weather" className="mb-5" right={<span className="flex items-center gap-2">{useExpectedDates && <span className="chip violet" title="Collections are placed on their estimated or promised dates">ESTIMATE — collection dates</span>}<Truth state="FORECAST" /></span>}>
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {WEATHER.map((w) => {
                const h = rows.find((r) => r.key === w.key)
                if (!h) return null
                const net = h.inflow.minus(h.outflow)
                const n = warnings.filter((x) => x.date && x.date <= h.until).length
                return (
                  <Panel key={w.key} className={cx('p-4', hz === w.key && 'border-gold/40')} onClick={() => setHz(w.key)} title="Select this horizon for the cash horizon below">
                    <div className="flex items-center justify-between gap-2"><span className="eyebrow">{w.label}</span><span className="num text-[11px] text-muted">to {fmtDate(h.until)}</span></div>
                    <div className="mt-3 space-y-1.5 text-[12.5px]">
                      <div className="flex items-baseline justify-between gap-2"><span className="text-muted">Expected inflows</span><Money value={h.inflow} compact className="text-pos" /></div>
                      <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted"><span>of which firm</span><Money value={h.firmInflow} compact /></div>
                      <div className="flex items-baseline justify-between gap-2"><span className="text-muted">Expected outflows</span><Money value={h.outflow} compact className="text-neg" /></div>
                      <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted"><span>of which firm</span><Money value={h.firmOutflow} compact /></div>
                      <div className="hairline" />
                      <div className="flex items-baseline justify-between gap-2"><span className="text-ink2">Net position</span><Money value={net} compact sign colored className="text-[14px]" /></div>
                      <div className="flex items-baseline justify-between gap-2"><span className="text-ink2">Projected cash</span><Money value={h.projected} compact className={h.projected.lt(0) ? 'text-neg' : 'text-ink'} /></div>
                    </div>
                    <div className="mt-2.5 text-[11px] leading-snug text-muted"><span className="num text-ink2">{n}</span> warning{n === 1 ? '' : 's'} dated on or before {fmtDate(h.until)} · {w.sub}</div>
                  </Panel>
                )
              })}
            </div>
            <div className="mt-2 text-[11.5px] text-muted">
              Figures include every certainty except CONTINGENT. The firm part is what is DUE, CONTRACTED, COMMITTED or SCHEDULED; the rest is expected, probable, possible or forecast.
              {undatedWarnings > 0 && <> {undatedWarnings} warning{undatedWarnings === 1 ? ' has' : 's have'} no date and {undatedWarnings === 1 ? 'is' : 'are'} not counted in these windows.</>}
            </div>
          </Section>

          {/* ------------------------------------------------ cash horizon */}
          <Section title="Cash horizon" className="mb-5">
            <Panel className="p-5" lit={false}>
              <div className="no-print mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Horizon">
                {HORIZONS.map((h) => <button key={h.key} className={cx('chip', hz === h.key && 'gold')} aria-pressed={hz === h.key} onClick={() => setHz(h.key)}>{h.label}</button>)}
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="display text-[15px]">{selected.label} · to {fmtDate(selected.until)}</div>
                    <span className="flex items-center gap-2">{useExpectedDates && <span className="chip violet">ESTIMATE</span>}<Truth state="FORECAST" /></span>
                  </div>
                  <Waterfall steps={steps} height={280} />
                  <div className="mt-3 grid gap-4 text-[12.5px] sm:grid-cols-2">
                    {(['in', 'out'] as const).map((dir) => {
                      const list = selected.byCategory.filter((c) => c.direction === dir && c.amount.gt(0))
                      return (
                        <div key={dir}>
                          <div className="eyebrow mb-1.5">{dir === 'in' ? 'Inflows by category' : 'Outflows by category'}</div>
                          {list.length === 0 ? <div className="text-muted">None recorded in this horizon.</div> : list.map((c) => (
                            <div key={c.category} className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0"><span className="truncate text-ink2">{c.category}</span><Money value={c.amount} className={dir === 'in' ? 'text-pos' : 'text-neg'} /></div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2.5 text-[12.5px]">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Cash today <Truth state="ACTUAL" /></span><Money value={openingCash} /></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Projected (firm only) <span className="chip cyan" title="Opening cash plus what is DUE, CONTRACTED, COMMITTED or SCHEDULED">FIRM</span></span><Money value={selected.projectedFirm} className={selected.projectedFirm.lt(0) ? 'text-neg' : undefined} /></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"><span className="flex items-center gap-2 text-ink2">Projected (all) <Truth state="FORECAST" /></span><Money value={selected.projected} className={selected.projected.lt(0) ? 'text-neg' : undefined} /></div>
                  <div className="rounded-lg border border-line bg-surface px-3 py-2">
                    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-ink2">Contingent <Truth state="CONTINGENT" /></span><Money value={selected.contingent} dim /></div>
                    <div className="mt-1 text-[11.5px] text-muted">Contingent amounts dated inside this horizon, inflows and outflows together. They are not part of the projection.</div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface px-3 py-2">
                    <div className="flex items-center gap-2"><span className="text-ink2">Confidence</span><span className={cx('chip', CONFIDENCE_CLS[selected.confidence])}>{selected.confidence}</span></div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{selected.confidenceWhy}</div>
                  </div>
                  <label className="no-print flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
                    <input type="checkbox" className="mt-[3px]" checked={useExpectedDates} onChange={(e) => setUseExpectedDates(e.target.checked)} />
                    <span>
                      <span className="text-ink2">Use estimated collection dates</span>
                      {useExpectedDates && <span className="chip violet ml-2">ESTIMATE</span>}
                      <span className="mt-0.5 block text-[11.5px] text-muted">Places each receivable on the date the customer promised, or on the date suggested by that customer's past payments. The contractual due date is never replaced in the records.</span>
                    </span>
                  </label>
                  <Field label="Warn me when cash may fall below" hint={`In ${currency}. Kept in this browser only. Leave empty to be warned when cash may fall below zero.`}>
                    <input className="field num" inputMode="decimal" value={threshold} onChange={(e) => changeThreshold(e.target.value)} placeholder="0" />
                  </Field>
                </div>
              </div>
              <div className="mt-4 text-[12px] leading-relaxed text-muted">
                Only the starting cash is a recorded fact: the ledger balance of bank and cash accounts as at {fmtDate(asOf)}. Everything after it is a projection that assumes each amount moves on its date. NUMERO records and projects; it does not move money.
              </div>
            </Panel>
          </Section>

          <Section title="All horizons" className="mb-5" right={<span className="flex items-center gap-2">{useExpectedDates && <span className="chip violet">ESTIMATE — collection dates</span>}<Truth state="FORECAST" /></span>}>
            <Panel lit={false}>
              <DataTable columns={horizonColumns} rows={rows} rowKey={(r) => r.key} exportName="forward-horizons" />
            </Panel>
          </Section>

          {/* ------------------------------------------------ early warnings */}
          <Section title={`Early warnings · ${warnings.length}`} className="mb-5">
            {warnings.length === 0 ? (
              <Panel lit={false}><Empty icon={<ShieldAlert size={20} />} title="No warning arises from the recorded data" body="Warnings are raised from recorded dates and amounts: cash falling below the threshold, payroll cover, loan instalments, renewals and expiries, maturing deposits, unsettled advances, concentration of receivables and promises that have passed. This is not an assurance that nothing can go wrong." /></Panel>
            ) : (
              <div className="space-y-4">
                {LEVELS.map((lv) => {
                  const list = warnings.filter((w) => w.level === lv.key)
                  if (!list.length) return null
                  return (
                    <div key={lv.key}>
                      <div className="mb-2 flex items-center gap-2"><StatusChip status={lv.key} label={lv.label} /><span className="text-[11.5px] text-muted"><span className="num">{list.length}</span> for a person to review</span></div>
                      <div className="space-y-2">
                        {list.map((w) => <WarningCard key={w.id} w={w} lamp={lv.lamp} open={openWarning === w.id} onToggle={() => setOpenWarning(openWarning === w.id ? null : w.id)} onOpen={w.link && w.link !== '/forward' ? () => go(w.link) : undefined} mask={mask} />)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-2 text-[11.5px] text-muted">Each warning states recorded facts and the assumptions behind it. What to do about it is decided by a person.</div>
          </Section>

          {/* ------------------------------------------------ calendar */}
          <Section title="Calendar" className="mb-5" right={<Truth state="FORECAST" />}>
            <Panel className="p-4" lit={false}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button className="btn sm icon ghost" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
                  <div className="display min-w-[150px] text-center text-[15px]">{MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}</div>
                  <button className="btn sm icon ghost" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={15} /></button>
                  {month !== startOfMonth(asOf) && <button className="btn sm" onClick={() => { setMonth(startOfMonth(asOf)); setDay(null) }}>This month</button>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
                  <span>In <Money value={monthIn} compact className="text-pos" /></span>
                  <span>Out <Money value={monthOut} compact className="text-neg" /></span>
                  <span>contingent amounts are left out of the totals</span>
                </div>
              </div>
              <div className="overflow-auto">
                <div className="grid min-w-[700px] grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((w) => <div key={w} className="eyebrow px-1 pb-1 text-center">{w}</div>)}
                  {cells.map((c, i) => {
                    if (!c) return <div key={'b' + i} />
                    const list = cal.days.get(c) ?? []
                    const inflow = tot(list, 'in'), outflow = tot(list, 'out')
                    const contingent = list.filter((e) => e.certainty === 'CONTINGENT').length
                    const on = day === c
                    return (
                      <button key={c} onClick={() => setDay(on ? null : c)} aria-pressed={on} aria-label={`${fmtDate(c)}: ${list.length} event${list.length === 1 ? '' : 's'}`}
                        className={cx('min-h-[84px] rounded-lg border p-2 text-left transition-colors', on ? 'border-gold/60 bg-surface2' : 'border-line bg-surface hover:border-line2', c === asOf && !on && 'border-cyan/40')}>
                        <div className="flex items-center justify-between gap-1">
                          <span className={cx('num text-[12px]', c === asOf ? 'text-cyan' : 'text-ink2')}>{Number(c.slice(8, 10))}</span>
                          {list.length > 0 && <span className="num rounded-full bg-surface2 px-1.5 text-[10.5px] text-ink2">{list.length}</span>}
                        </div>
                        {list.length > 0 && (
                          <div className="mt-1.5 space-y-0.5 text-[11px]">
                            {inflow.gt(0) && <div className="flex justify-between gap-1"><span className="text-muted">In</span><Money value={inflow} compact className="text-pos" /></div>}
                            {outflow.gt(0) && <div className="flex justify-between gap-1"><span className="text-muted">Out</span><Money value={outflow} compact className="text-neg" /></div>}
                            {contingent > 0 && <div className="text-warn">{contingent} contingent</div>}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-4">
                {!day ? <div className="text-[12.5px] text-muted">Choose a day to list what falls on it. Events are placed on their contractual or scheduled date.</div> : (
                  <>
                    <div className="eyebrow mb-2">{fmtDate(day)} · {dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}</div>
                    {dayEvents.length === 0 ? <div className="text-[12.5px] text-muted">Nothing recorded falls on this day.</div> : (
                      <div className="overflow-auto rounded-lg border border-line">
                        <table className="table dense">
                          <thead><tr><th>What</th><th>Party</th><th>Category</th><th>Certainty</th><th className="r">Inflow</th><th className="r">Outflow</th></tr></thead>
                          <tbody>
                            {dayEvents.map((e) => (
                              <tr key={e.id} className={cx(e.link && 'rowlink')} tabIndex={e.link ? 0 : undefined} onClick={() => go(e.link)} onKeyDown={(k) => { if (k.key === 'Enter') go(e.link) }}>
                                <td><div className="text-ink">{e.label}</div><div className="text-[11.5px] text-muted">{mask(e.basis)}</div></td>
                                <td className="text-ink2">{partyName(e.party_id)}</td>
                                <td className="text-ink2">{e.category}</td>
                                <td><CertaintyChip value={e.certainty} /></td>
                                <td className="r">{e.direction === 'in' ? <Money value={e.amount} className="text-pos" /> : <span className="text-muted">—</span>}</td>
                                <td className="r">{e.direction === 'out' ? <Money value={e.amount} className="text-neg" /> : <span className="text-muted">—</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Panel>
          </Section>

          {/* ------------------------------------------------ commitments */}
          <Section title="Commitments — approved orders not yet billed" className="mb-5" right={<CertaintyChip value="COMMITTED" />}>
            <Note className="mb-3">An approved order is a commitment, not a cost. It becomes a cost only when the goods or services are billed.</Note>
            <Panel lit={false}>
              <DataTable
                columns={commitmentColumns} rows={commitments} rowKey={(c) => c.po.id} onRow={(c) => nav('/purchasing/' + c.po.id)} exportName="forward-commitments" initialSort={{ key: 'base', dir: 'desc' }}
                footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>Total open · {commitments.length} order{commitments.length === 1 ? '' : 's'} · COMMITTED</td><td className={cx(foot, 'r')}><Money value={commitmentsBase} className="font-medium text-ink" /></td><td className={foot} /></tr>}
                empty={{ title: 'No open commitment', body: 'Approved purchase orders that are not yet fully billed appear here. Raise and approve a purchase order in Purchasing to record a commitment.', icon: <PackageCheck size={20} /> }}
              />
            </Panel>
          </Section>

          {/* ------------------------------------------------ payment priority */}
          <Section title={`Payment priority view — outflows to ${fmtDate(addDays(asOf, PRIORITY_DAYS))}`} className="mb-5">
            <Note className="mb-3">NUMERO shows what is due. Which obligations to pay, and when, is decided by a person.</Note>
            <Panel lit={false}>
              <DataTable
                columns={priorityColumns} rows={priority} rowKey={(e) => e.id} onRow={(e) => go(e.link)} exportName="forward-payment-priority" initialSort={{ key: 'date', dir: 'asc' }}
                footer={<tr><td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {priority.length} outflow{priority.length === 1 ? '' : 's'}{priorityContingent.gt(0) ? ' · contingent amounts are left out of this total' : ''}</td><td className={cx(foot, 'r')}><Money value={priorityFirm} className="font-medium text-ink" /></td><td className={foot} colSpan={2} /></tr>}
                empty={{ title: 'No outflow falls due in the next 60 days', body: 'Bills, instalments, register items, payroll, claims and advances with a date in the next 60 days appear here, together with anything already overdue.', icon: <ListChecks size={20} /> }}
              />
            </Panel>
          </Section>

          {/* ------------------------------------------------ all events */}
          <Section title="All events — the next five years" right={<Truth state="FORECAST" />}>
            <Panel lit={false}>
              <DataTable
                columns={eventColumns} rows={shown} rowKey={(e) => e.id} onRow={(e) => go(e.link)} exportName="forward-events"
                toolbar={<>
                  <select className="field sm" style={{ width: 150 }} value={fDirection} onChange={(e) => setFDirection(e.target.value as '' | 'in' | 'out')} aria-label="Filter by direction"><option value="">All directions</option><option value="in">Inflows</option><option value="out">Outflows</option></select>
                  <select className="field sm" style={{ width: 170 }} value={fCertainty} onChange={(e) => setFCertainty(e.target.value as '' | ForwardCertainty)} aria-label="Filter by certainty"><option value="">All certainties</option>{CERTAINTY_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <select className="field sm" style={{ width: 170 }} value={fSource} onChange={(e) => setFSource(e.target.value as '' | ForwardSource)} aria-label="Filter by source"><option value="">All sources</option>{sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
                  {(fDirection || fCertainty || fSource) && <button className="btn sm ghost" onClick={() => { setFDirection(''); setFCertainty(''); setFSource('') }}>Clear filters</button>}
                </>}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={7}>{shown.length.toLocaleString()} event{shown.length === 1 ? '' : 's'} · inflows <Money value={shownIn} className="text-pos" /> · outflows <Money value={shownOut} className="text-neg" />{shownContingent.gt(0) && <> · CONTINGENT, shown separately: <Money value={shownContingent} /></>}</td>
                  <td className={cx(foot, 'r')}><Money value={shownIn.minus(shownOut)} sign colored className="font-medium" /></td>
                  <td className={foot} />
                </tr>}
                empty={{ title: 'No event matches the filter', body: 'Clear the filters to see every recorded event.', icon: <CalendarDays size={20} />, action: <button className="btn sm" onClick={() => { setFDirection(''); setFCertainty(''); setFSource('') }}>Clear filters</button> }}
              />
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">
              Invoices, bills and purchase orders are in the base currency of their company, at the exchange rate recorded on the document. An expected date marked ESTIMATE or PROMISED never replaces the contractual date. The net figure leaves out contingent amounts.
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function WarningCard({ w, lamp, open, onToggle, onOpen, mask }: { w: ForwardWarning; lamp: string; open: boolean; onToggle: () => void; onOpen?: () => void; mask: (s: string) => string }) {
  const amount: Decimal | undefined = w.amount
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span className={cx('lamp mt-[6px]', lamp)} />
        <div className="min-w-0 flex-1">
          {onOpen
            ? <button className="block w-full text-left text-[13px] font-medium text-ink hover:text-gold" onClick={onOpen}>{mask(w.title)}</button>
            : <div className="text-[13px] font-medium text-ink">{mask(w.title)}</div>}
          <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink2">{mask(w.detail)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
            {w.date && <span>Date <span className="num text-ink2">{fmtDate(w.date)}</span></span>}
            {amount && <span>{w.kind === 'cash_shortfall' ? 'Projected cash' : 'Amount'} <Money value={amount} className={amount.lt(ZERO) ? 'text-neg' : 'text-ink2'} /></span>}
            {w.assumptions.length > 0 && (
              <button className="no-print inline-flex items-center gap-1 text-ink2 hover:text-gold" onClick={onToggle} aria-expanded={open}>
                {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Assumptions ({w.assumptions.length})
              </button>
            )}
            {onOpen && <button className="no-print inline-flex items-center gap-1 text-ink2 hover:text-gold" onClick={onOpen}><ExternalLink size={12} /> Open the record</button>}
          </div>
          {open && w.assumptions.length > 0 && (
            <ul className="m-0 mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-ink2">{w.assumptions.map((a) => <li key={a}>{mask(a)}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  )
}
