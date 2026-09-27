import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileLock2, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import type { Confidentiality, Journal } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { D, ZERO } from '@/lib/money'
import { fmtDate } from '@/lib/dates'
import { cx, ErrorBox, Loading, Money, Note, PageHeader, Panel, Section, StatusChip } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

const LIMIT = 500

const LEVELS: { key: Confidentiality; label: string; chip: string; text: string }[] = [
  { key: 'internal', label: 'Internal', chip: '', text: 'The normal level. Visible to everyone whose role gives access to the company and to that kind of record. Internal records are not part of the vault.' },
  { key: 'confidential', label: 'Confidential', chip: 'cyan', text: 'Detail is visible only to group administrators and to people holding a vault grant for the company at this level or higher.' },
  { key: 'highly_confidential', label: 'Highly confidential', chip: 'violet', text: 'Detail is visible only to group administrators and to people holding a vault grant at highly confidential or restricted level.' },
  { key: 'restricted', label: 'Restricted', chip: 'warn', text: 'Detail is visible only to group administrators and to people holding a vault grant at restricted level, the highest level a grant can give.' },
  { key: 'super_admin_only', label: 'Super admin only', chip: 'gold', text: 'Detail is visible to group administrators only. No vault grant can open it.' },
]
const levelOf = (k: Confidentiality) => LEVELS.find((l) => l.key === k) ?? LEVELS[0]

const PRINCIPLES: { title: string; text: string }[] = [
  { title: 'Private is not false', text: 'A confidential record is a real accounting entry. It is posted, balanced and reported like every other entry; only the view of its detail is limited.' },
  { title: 'Evidence is never deleted', text: 'Restricted records, their supporting documents and their history are kept. A correction is made by reversal, never by removal.' },
  { title: 'Access to restricted records is logged', text: 'Each time the detail of a restricted record is opened, who opened it and when is written to an append-only log.' },
  { title: 'NUMI never reveals restricted detail to unauthorised users', text: 'Answers are built from what the person asking is cleared to see. Totals still include restricted amounts; the detail behind them stays closed.' },
]

export default function Vault() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const isAdmin = useApp((s) => s.session?.isGroupAdmin) ?? false
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const allowed = isAdmin || can('vault.view')
  const [level, setLevel] = useState<Confidentiality | null>(null)

  const main = useAsync(async () => {
    if (!allowed) return null
    const res = await api.listJournals({ companyIds: ids, limit: LIMIT })
    return { rows: res.rows.filter((j) => j.confidentiality !== 'internal'), examined: res.rows.length, total: res.total }
  }, [api, idsKey, allowed])

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])

  if (!allowed) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface2 text-gold"><Lock size={24} aria-hidden="true" /></div>
          <h1 className="display m-0 text-[20px] font-medium tracking-[0.18em] text-ink">RESTRICTED</h1>
          <p className="mx-auto mb-0 mt-2 max-w-sm text-[13.5px] text-muted">Your account is not authorised to view confidential records.</p>
        </div>
      </div>
    )
  }

  const d = main.data
  const records = d?.rows ?? []
  const value = records.reduce((s, j) => s.plus(D(j.total)), ZERO)
  const posted = records.filter((j) => j.status === 'posted' || j.status === 'reversed')
  const postedValue = posted.reduce((s, j) => s.plus(D(j.total)), ZERO)
  const vaultLevels = LEVELS.filter((l) => l.key !== 'internal')
  const rows = level ? records.filter((j) => j.confidentiality === level) : records

  const columns: Column<Journal>[] = [
    { key: 'date', header: 'Date', width: 118, render: (j) => <span className="num text-[12.5px]">{fmtDate(j.journal_date)}</span>, sort: (j) => j.journal_date },
    { key: 'no', header: 'Voucher no', render: (j) => <span className="num text-[12.5px] text-gold">{j.voucher_no ?? 'Not yet numbered'}</span>, sort: (j) => j.voucher_no ?? '' },
    { key: 'company', header: 'Company', render: (j) => <span className="text-ink2" title={companyById.get(j.company_id)?.name}>{companyById.get(j.company_id)?.code ?? '—'}</span>, sort: (j) => companyById.get(j.company_id)?.name ?? '' },
    { key: 'narration', header: 'Narration', render: (j) => <span className="text-ink">{j.narration || <span className="text-muted">No narration was entered</span>}</span> },
    { key: 'level', header: 'Level', render: (j) => <span className={cx('chip', levelOf(j.confidentiality).chip)}>{levelOf(j.confidentiality).label}</span>, sort: (j) => LEVELS.findIndex((l) => l.key === j.confidentiality) },
    { key: 'total', header: 'Total', align: 'right', render: (j) => <Money value={j.total} currency={companyById.get(j.company_id)?.base_currency} />, sort: (j) => D(j.total).toNumber() },
    { key: 'status', header: 'Status', render: (j) => <StatusChip status={j.status} />, sort: (j) => j.status },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Private"
        title="Black Vault"
        subtitle={<>Confidential accounting records of the selected compan{ids.length === 1 ? 'y' : 'ies'} that your account is cleared to see.</>}
      />

      <Note kind="warn" className="mb-4">
        Confidential is not the same as hidden from the books. Every record here is fully included in the ledgers, financial statements and statutory reporting. The vault controls who can see the detail — it never creates a second set of books.
      </Note>

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} label="Loading the vault" /></Panel>}

      {d && (
        <>
          {d.total > d.examined && (
            <Note className="mb-4">
              The latest {d.examined.toLocaleString()} of {d.total.toLocaleString()} journals were examined. Confidential records among older journals are not counted on this screen.
            </Note>
          )}

          <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Panel className={cx('p-4', level === null && 'border-gold/40')} onClick={() => setLevel(null)} title="Show every restricted record">
              <div className="flex items-center gap-2 text-muted"><span className="text-gold"><FileLock2 size={16} /></span><span className="eyebrow truncate">Restricted records</span></div>
              <div className="num mt-2.5 text-[22px] leading-none">{records.length.toLocaleString()}</div>
              <div className="mt-2 text-[11px] text-muted"><span className="num text-ink2">{posted.length.toLocaleString()}</span> posted to the books</div>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-muted"><span className="text-gold"><KeyRound size={16} /></span><span className="eyebrow truncate">Total value</span></div>
              <Money value={value} compact className="mt-2.5 block text-[22px] leading-none" />
              <div className="mt-2 text-[11px] text-muted">of which posted <Money value={postedValue} compact className="text-ink2" /></div>
            </Panel>
            {vaultLevels.map((l) => {
              const list = records.filter((j) => j.confidentiality === l.key)
              const on = level === l.key
              return (
                <Panel key={l.key} className={cx('p-4', on && 'border-gold/50')} onClick={() => setLevel(on ? null : l.key)} title={on ? 'Click to clear this filter' : `Show only ${l.label.toLowerCase()} records`}>
                  <div className="flex items-center gap-2"><span className={cx('chip', l.chip)}>{l.label}</span></div>
                  <div className="num mt-2.5 text-[22px] leading-none">{list.length.toLocaleString()}</div>
                  <div className="mt-2 text-[11px] text-muted"><Money value={list.reduce((s, j) => s.plus(D(j.total)), ZERO)} compact className="text-ink2" /> in value</div>
                </Panel>
              )
            })}
          </div>

          <Panel lit={false} className="mb-6">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(j) => j.id}
              onRow={(j) => nav('/journals/' + j.id)}
              initialSort={{ key: 'date', dir: 'desc' }}
              toolbar={level ? <button className="chip gold" onClick={() => setLevel(null)} title="Clear this filter">Level: {levelOf(level).label} ×</button> : <span className="text-[12px] text-muted">Opening a record is written to the access log.</span>}
              empty={records.length === 0
                ? { title: 'The vault is empty', body: 'No journal in the selected companies is marked above the internal level.', icon: <ShieldCheck size={20} /> }
                : { title: 'No record at this level', body: 'No restricted record in the selected companies carries this level.', icon: <ShieldCheck size={20} /> }}
            />
          </Panel>
        </>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Confidentiality levels">
          <Panel lit={false} className="px-5 py-2">
            {LEVELS.map((l, i) => (
              <div key={l.key} className="flex items-start gap-3.5 border-b border-line py-3 last:border-0">
                <span className="num mt-[3px] w-4 flex-none text-[11.5px] text-muted">{i + 1}</span>
                <div className="min-w-0">
                  <span className={cx('chip', l.chip)}>{l.label}</span>
                  <p className="mb-0 mt-1.5 text-[12.5px] leading-relaxed text-ink2">{l.text}</p>
                </div>
              </div>
            ))}
          </Panel>
        </Section>
        <Section title="Principles">
          <Panel lit={false} className="px-5 py-2">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
                <span className="lamp gold mt-[7px] flex-none" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink">{p.title}</div>
                  <p className="mb-0 mt-1 text-[12.5px] leading-relaxed text-ink2">{p.text}</p>
                </div>
              </div>
            ))}
          </Panel>
        </Section>
      </div>
    </div>
  )
}
