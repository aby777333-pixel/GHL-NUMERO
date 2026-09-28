import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, FileUp, FlaskConical, ListTree, LogOut, Orbit, PenLine, ShieldCheck, Workflow } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { SANDBOX_PEOPLE } from '@/lib/sandboxPeople'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { Empty, Money, Note, PageHeader, Panel, Section, Spinner } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { DemoTag, Fact, human, NoAccess } from '@/ui/p3'
import type { AuditEntry } from '@/engine/types'

// =====================================================================
// NUMERO Sandbox (spec 634, 1423, 1424, 1425, 1838).
// A copy of the configuration and the figures, held in the memory of
// the browser. Whatever is tried there runs on the engine NUMERO carries
// in the browser, under the rules of the database, and reaches nothing:
// not the books, not the database.
// =====================================================================

const TRY: { icon: typeof PenLine; title: string; text: string; to: string }[] = [
  { icon: PenLine, title: 'An accounting entry', text: 'Prepare an entry, send it for approval, approve it as a second person and post it. See what it does to the reports.', to: '/journals/new' },
  { icon: BadgeCheck, title: 'An approval rule', text: 'Change who approves what, above which amount, then submit an entry and watch which steps it is given.', to: '/approvals' },
  { icon: ListTree, title: 'Account mapping', text: 'Point a role of the engines — goods received, stock lost, fees owed — to another ledger and post a document that uses it.', to: '/accounts' },
  { icon: FileUp, title: 'An import and its mapping', text: 'Bring in a file, map its columns and its account codes, and read the checks. Entries arrive as drafts.', to: '/imports' },
  { icon: Workflow, title: 'A workflow', text: 'Design a way of working in the Scenario Studio, make it active and follow a case through its steps.', to: '/studio' },
  { icon: Orbit, title: 'Simulations', text: 'Run the Digital Twin on the figures of the sandbox as often as you like. It rests on the monthly movement that was brought in. Nothing it produces is an actual.', to: '/twin' },
]

export default function Sandbox() {
  useApp((s) => s.session)
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const sandbox = useApp((s) => s.sandbox)
  const companies = useApp((s) => s.companies)
  const enterSandbox = useApp((s) => s.enterSandbox)
  const leaveSandbox = useApp((s) => s.leaveSandbox)
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)
  // the build wrote its own rows to the trail; what the person does comes after them
  const built = sandbox?.report.audit_rows ?? 0
  const TRAIL = 500
  const trail = useAsync(async () => (sandbox ? (await api.listAudit({ limit: TRAIL })).filter((a) => Number(a.id) > built) : []), [api, built])

  if (!sandbox && !companies.some((c) => can('scenario.manage', c.id))) return <NoAccess eyebrow="Simulate" title="The sandbox" perm="scenario.manage" />

  const enter = async () => {
    setBusy(true)
    try { await enterSandbox(); toast('ok', 'You are in the sandbox', 'Nothing done here reaches the books.') }
    catch (e) { toast('error', 'The sandbox could not be built', e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (!sandbox) {
    return (
      <div>
        <PageHeader eyebrow="Simulate" title="Sandbox" subtitle={<>Try an entry, a rule, a mapping, an import or a workflow on a copy, before it is done in the books. <DemoTag className="ml-1" /></>}
          actions={<button className="btn primary" disabled={busy} onClick={() => void enter()}>{busy ? <Spinner /> : <FlaskConical size={15} />} Enter the sandbox</button>} />
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Section title="What the sandbox is">
            <Panel className="space-y-3 p-5 text-[13px] text-ink2" lit={false}>
              <p>The sandbox is a second set of books that exists only in the memory of this browser. It is built from the configuration of the books you are allowed to see, and from their figures: the balances of a year ago as one entry, and what moved in each ledger since as one entry a month.</p>
              <p>Every screen of NUMERO then works on that copy, on the engine NUMERO carries in the browser. It keeps the rules of the database — balanced entries, a second person for every approval, locked periods — and is tested against the same cases; it is not the database itself. You can act as the person who prepares, and then as the person who approves.</p>
              <p className="text-ink">Nothing done in the sandbox reaches the books or the database. It is discarded when you leave it or reload the page.</p>
            </Panel>
          </Section>
          <Section title="What is copied, and what is not">
            <Panel className="grid gap-4 p-5 sm:grid-cols-2" lit={false}>
              <Fact label="Copied">Companies, ledgers, account mapping, tax codes, units, parties, approval rules, fields of your own, periods and their locks, categories, stock items without stock, workflows, templates, thresholds.</Fact>
              <Fact label="Brought in as figures">The balance of every ledger you may read a year ago, and its movement month by month since. What customers owe and vendors are owed today arrives party by party.</Fact>
              <Fact label="Never copied">Employees, salaries and payroll. Records of the Black Vault. Documents. Bank statements.</Fact>
              <Fact label="Not copied">The transactions themselves: journals, invoices, bills, payments, stock movements, assets, loans, investments. Their value is inside the figures. Roles are not copied: in the sandbox every person holds every permission.</Fact>
            </Panel>
          </Section>
        </div>
        <Section title="What can be tried" className="mt-4">
          <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {TRY.map((t) => (
              <Panel key={t.title} className="p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><t.icon size={15} className="text-cyan" /> {t.title}</div>
                <div className="mt-1.5 text-[12.5px] text-muted">{t.text}</div>
              </Panel>
            ))}
          </div>
        </Section>
        <Note className="mt-4">An integration that can move money is never tried against a real bank from here. NUMERO connects to no bank; where one is connected in future, its sandbox is the place to try it, and the integrations register records that it was.</Note>
      </div>
    )
  }

  const r = sandbox.report
  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', render: (a) => <span className="num text-[12.5px]">{fmtDateTime(a.at)}</span>, sort: (a) => a.at, csv: (a) => a.at },
    { key: 'who', header: 'Acting as', render: (a) => <span className="text-ink2">{a.actor_name ?? '—'}</span>, csv: (a) => a.actor_name ?? '' },
    { key: 'what', header: 'What was done', render: (a) => <span className="text-ink">{human(a.action)} <span className="text-muted">· {human(a.entity)}</span></span>, sort: (a) => a.action, csv: (a) => `${a.action} ${a.entity}` },
    { key: 'why', header: 'Reason given', render: (a) => <span className="text-muted">{a.reason ?? '—'}</span>, csv: (a) => a.reason ?? '' },
    { key: 'open', header: '', align: 'right', render: (a) => (a.entity === 'journals' && a.entity_id ? <button className="link text-[12.5px]" onClick={() => nav('/journals/' + a.entity_id)}>Open the entry</button> : null) },
  ]
  const mine = trail.data ?? []

  return (
    <div>
      <PageHeader eyebrow="Simulate" title="Sandbox" subtitle={<>You are working on a copy built on {fmtDateTime(r.built_at)} from the books as they stood on {fmtDate(r.as_of)}, with the movement of each month since {fmtDate(r.history_from)}.</>}
        actions={<button className="btn" onClick={() => void leaveSandbox()}><LogOut size={15} /> Leave the sandbox and discard it</button>} />
      <Note kind="good" className="mb-4"><ShieldCheck size={14} className="mr-1 inline" /> Nothing done here reaches the books. The real books are set aside untouched and return as they were when you leave.</Note>

      <Section title="What can be tried">
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TRY.map((t) => (
            <Panel key={t.title} className="p-4" onClick={() => nav(t.to)}>
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><t.icon size={15} className="text-cyan" /> {t.title} <ArrowRight size={13} className="ml-auto text-muted" /></div>
              <div className="mt-1.5 text-[12.5px] text-muted">{t.text}</div>
            </Panel>
          ))}
        </div>
      </Section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Section title="Companies of the sandbox">
          <Panel lit={false}>
            <DataTable rows={r.companies} rowKey={(c) => c.id} pageSize={25}
              columns={[
                { key: 'co', header: 'Company', render: (c) => <span><span className="num text-gold">{c.code}</span> <span className="text-ink">· {c.name}</span></span> },
                { key: 'ledgers', header: 'Ledgers', align: 'right', render: (c) => <span className="num">{c.ledgers}</span> },
                { key: 'entries', header: 'Entries brought in', align: 'right', render: (c) => <span className="num">{c.entries}</span> },
                { key: 'total', header: 'Balances of a year ago', align: 'right', render: (c) => (c.opening_lines ? <Money value={c.opening_total} /> : <span className="text-muted">—</span>) },
                { key: 'note', header: 'Note', render: (c) => <span className="text-[12px] text-warn">{c.note ?? ''}</span> },
              ]} />
          </Panel>
        </Section>
        <Section title="People of the sandbox">
          <Panel className="space-y-2.5 p-4 text-[12.5px]" lit={false}>
            {SANDBOX_PEOPLE.map((p) => <div key={p.id} className="flex items-start gap-2"><span className="lamp cyan mt-[5px]" /><span className="text-ink2">{p.label}</span></div>)}
            <div className="border-t border-line pt-2.5 text-muted">Choose who you act as in the bar at the top. In the sandbox every person holds every permission, so that every screen can be tried; the rule that a second person approves applies as it is configured in the books.</div>
          </Panel>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Section title="What was copied">
          <Panel className="grid gap-x-6 gap-y-2 p-4 text-[12.5px] sm:grid-cols-2" lit={false}>
            {r.copied.map((c) => <div key={c.what} className="flex justify-between gap-3"><span className="text-ink2">{c.what}</span><span className="num text-ink">{c.count.toLocaleString()}</span></div>)}
          </Panel>
        </Section>
        <Section title="What was left out">
          <Panel className="space-y-2 p-4 text-[12.5px] text-ink2" lit={false}>
            {r.left_out.map((t, i) => <div key={i}>{t}</div>)}
          </Panel>
        </Section>
      </div>

      <Section title="What you have done in the sandbox" className="mt-4">
        <Panel lit={false}>
          <DataTable columns={columns} rows={mine} rowKey={(a) => String(a.id)} pageSize={25} exportName="sandbox-trail" initialSort={{ key: 'at', dir: 'desc' }}
            toolbar={<span className="text-[12px] text-muted">A record of what was tried, to carry over by hand what proved right. It is discarded with the sandbox.{mine.length >= TRAIL ? ` Only the latest ${TRAIL} are listed.` : ''}</span>}
            empty={{ title: 'Nothing has been tried yet', body: 'What you do in the sandbox is listed here.', icon: <FlaskConical size={20} /> }} />
        </Panel>
      </Section>
      {trail.error && <Panel className="mt-3"><Empty title="The trail could not be read" body={trail.error} /></Panel>}
    </div>
  )
}
