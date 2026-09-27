import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BarChart3, BookText, CalendarClock, FileSpreadsheet, GitMerge, HeartPulse, Landmark, ListOrdered, PenLine, Scale, ScrollText, Wallet, Waves } from 'lucide-react'
import { PageHeader, Panel, Section } from '@/ui/kit'

interface R { to: string; title: string; body: string; icon: ReactNode }
const GROUPS: { title: string; items: R[] }[] = [
  { title: 'Financial statements', items: [
    { to: '/reports/pnl', title: 'Profit & Loss', body: 'Revenue, costs and profit for the period, with comparison and drill-down.', icon: <BarChart3 size={17} /> },
    { to: '/reports/balance-sheet', title: 'Balance Sheet', body: 'Assets, liabilities and equity. The equation is validated continuously.', icon: <Scale size={17} /> },
    { to: '/reports/cash-flow', title: 'Cash Flow', body: 'Operating, investing and financing activities, reconciled to cash.', icon: <Waves size={17} /> },
    { to: '/reports/trial-balance', title: 'Trial Balance', body: 'Opening, period and closing debits and credits for every ledger.', icon: <ListOrdered size={17} /> },
  ] },
  { title: 'Group', items: [
    { to: '/reports/consolidated', title: 'Group Consolidation', body: 'Company columns, intercompany eliminations and the consolidated total.', icon: <GitMerge size={17} /> },
    { to: '/reports/ratios', title: 'Financial Health', body: 'Transparent indicators. Every ratio shows its formula and inputs.', icon: <HeartPulse size={17} /> },
  ] },
  { title: 'Where money moved', items: [
    { to: '/reports/money-went', title: 'Where did the money go?', body: 'Expenditure broken down by category, company, party and transaction.', icon: <ArrowUpRight size={17} /> },
    { to: '/reports/money-came', title: 'Where did the money come from?', body: 'Income broken down by type, company, customer and transaction.', icon: <ArrowDownLeft size={17} /> },
  ] },
  { title: 'Receivables & payables', items: [
    { to: '/reports/ageing', title: 'Ageing Analysis', body: 'Outstanding invoices and bills by age bucket.', icon: <CalendarClock size={17} /> },
    { to: '/parties/owed?side=in', title: 'Who owes us?', body: 'Every party that owes money, with ageing.', icon: <ArrowDownLeft size={17} /> },
    { to: '/parties/owed?side=out', title: 'Who do we owe?', body: 'Every obligation, by time horizon.', icon: <ArrowUpRight size={17} /> },
  ] },
  { title: 'Books & registers', items: [
    { to: '/ledger', title: 'General Ledger', body: 'Every posted line, filterable and exportable.', icon: <BookText size={17} /> },
    { to: '/journals', title: 'Journal Register / Day Book', body: 'All vouchers in date order.', icon: <PenLine size={17} /> },
    { to: '/reports/cash-book', title: 'Cash Book & Bank Book', body: 'Movements on cash and bank ledgers with running totals.', icon: <Landmark size={17} /> },
    { to: '/reports/registers', title: 'Sales & Purchase Registers', body: 'Invoices and bills with tax, by date.', icon: <FileSpreadsheet size={17} /> },
    { to: '/budgets', title: 'Budget vs Actual', body: 'Approved budget against posted actuals.', icon: <Wallet size={17} /> },
    { to: '/audit', title: 'Audit Trail Report', body: 'Who did what, when, and why.', icon: <ScrollText size={17} /> },
  ] },
]

export default function Reports() {
  const nav = useNavigate()
  return (
    <div>
      <PageHeader eyebrow="Report library" title="Reports" subtitle="Every report is built from posted ledger entries for the companies and period you have selected. Any figure can be clicked through to the transactions behind it." />
      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} className="mb-6">
          <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {g.items.map((r) => (
              <Panel key={r.to} className="p-4" onClick={() => nav(r.to)}>
                <div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/25 bg-goldsoft text-gold">{r.icon}</span><span className="display text-[14.5px] font-medium">{r.title}</span></div>
                <div className="mt-2 text-[12.5px] leading-relaxed text-muted">{r.body}</div>
              </Panel>
            ))}
          </div>
        </Section>
      ))}
      <div className="text-[12px] text-muted">The drag-and-drop report builder, scheduled delivery and PDF / Excel output are planned and tracked in the requirement ledger. CSV export and print are available on every report today.</div>
    </div>
  )
}
