import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Building2, HandCoins, Handshake, HardHat, Landmark, Plus, Receipt, Search, Shapes, Truck, UserRound, Users } from 'lucide-react'
import type { CreatePartyResult, PartyInput } from '@/api/types'
import type { ID, Party } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D } from '@/lib/money'
import { fmtDate } from '@/lib/dates'
import { cx, ErrorBox, Field, Loading, Modal, Note, PageHeader, Panel, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type GroupKey = 'customer' | 'vendor' | 'employee' | 'broker' | 'contractor' | 'consultant' | 'bank' | 'government' | 'other'
type TabKey = 'all' | GroupKey
type StatusFilter = 'all' | Party['status']

/** Presentation grouping of the party-type categories that the API returns. */
const GROUPS: { key: GroupKey; tab: string; tile: string | null; cats: string[]; icon: ReactNode }[] = [
  { key: 'customer', tab: 'Customers', tile: 'Customers', cats: ['customer'], icon: <HandCoins size={16} /> },
  { key: 'vendor', tab: 'Vendors', tile: 'Vendors', cats: ['vendor'], icon: <Truck size={16} /> },
  { key: 'employee', tab: 'Employees', tile: 'Employees', cats: ['employee'], icon: <UserRound size={16} /> },
  { key: 'broker', tab: 'Brokers & Agents', tile: 'Brokers & agents', cats: ['broker', 'agent'], icon: <Handshake size={16} /> },
  { key: 'contractor', tab: 'Contractors', tile: 'Contractors', cats: ['contractor'], icon: <HardHat size={16} /> },
  { key: 'consultant', tab: 'Consultants', tile: 'Consultants & freelancers', cats: ['consultant', 'freelancer'], icon: <Briefcase size={16} /> },
  { key: 'bank', tab: 'Banks', tile: 'Banks', cats: ['bank'], icon: <Landmark size={16} /> },
  { key: 'government', tab: 'Government', tile: null, cats: ['government'], icon: <Building2 size={16} /> },
  { key: 'other', tab: 'Other', tile: 'Other', cats: [], icon: <Shapes size={16} /> },
]
const groupOfCategory = (category: string | undefined): GroupKey => GROUPS.find((g) => g.cats.includes(category ?? ''))?.key ?? 'other'

const STATUSES: Party['status'][] = ['active', 'suspended', 'blocked', 'inactive', 'terminated']

interface Form {
  company_id: ID
  type_key: string
  kind: 'person' | 'organization'
  display_name: string
  legal_name: string
  pan: string
  gstin: string
  email: string
  phone: string
  credit_days: string
  credit_limit: string
}
const blank = (company_id: ID, type_key: string): Form => ({ company_id, type_key, kind: 'organization', display_name: '', legal_name: '', pan: '', gstin: '', email: '', phone: '', credit_days: '', credit_limit: '' })

type Duplicate = Extract<CreatePartyResult, { status: 'possible_duplicate' }>

export default function Parties() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session) // permissions are read through can(); re-render when the session changes
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const { act, busy } = useAction()

  const [tab, setTab] = useState<TabKey>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(blank('', ''))
  const [dup, setDup] = useState<Duplicate | null>(null)

  const types = useAsync(() => api.listPartyTypes(), [api])
  const typeByKey = useMemo(() => new Map((types.data ?? []).map((t) => [t.key, t])), [types.data])
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const scopedCompanies = companies.filter((c) => ids.includes(c.id))
  const creatable = scopedCompanies.filter((c) => can('party.create', c.id))
  const mayCreate = creatable.length > 0

  const scoped = useMemo(
    () => parties.filter((p) => p.roles.some((r) => ids.includes(r.company_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parties, idsKey],
  )
  const rolesInScope = (p: Party) => p.roles.filter((r) => ids.includes(r.company_id))
  const groupsOf = (p: Party) => new Set(rolesInScope(p).map((r) => groupOfCategory(typeByKey.get(r.type_key)?.category)))
  const roleLabel = (r: Party['roles'][number]) => `${typeByKey.get(r.type_key)?.name ?? r.type_key.replace(/_/g, ' ')} · ${companyById.get(r.company_id)?.code ?? '—'}`

  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<GroupKey, number>
    for (const p of scoped) for (const g of groupsOf(p)) c[g] += 1
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, typeByKey])
  const activeCount = scoped.filter((p) => p.status === 'active').length

  const needle = q.trim().toLowerCase()
  const rows = scoped.filter((p) => {
    if (tab !== 'all' && !groupsOf(p).has(tab)) return false
    if (status !== 'all' && p.status !== status) return false
    if (!needle) return true
    return [p.display_name, p.legal_name, p.party_no, p.gstin, p.pan, p.email, p.phone].some((v) => (v ?? '').toLowerCase().includes(needle))
  })

  const startAdd = () => {
    const firstType = (types.data ?? []).find((t) => (tab === 'all' ? true : groupOfCategory(t.category) === tab)) ?? types.data?.[0]
    setForm(blank(creatable[0]?.id ?? '', firstType?.key ?? ''))
    setDup(null)
    setOpen(true)
  }
  const close = () => { setOpen(false); setDup(null) }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setDup(null) }

  const creditDays = form.credit_days.trim() === '' ? undefined : Number(form.credit_days)
  const creditDaysValid = creditDays === undefined || (Number.isInteger(creditDays) && creditDays >= 0)
  const creditLimitValid = form.credit_limit.trim() === '' || /^\d[\d,]*(\.\d+)?$/.test(form.credit_limit.trim())
  const valid = !!form.company_id && !!form.type_key && !!form.display_name.trim() && creditDaysValid && creditLimitValid

  const build = (force: boolean): PartyInput => ({
    company_id: form.company_id,
    type_key: form.type_key,
    kind: form.kind,
    display_name: form.display_name.trim(),
    legal_name: form.legal_name.trim() || undefined,
    pan: form.pan.trim().toUpperCase() || undefined,
    gstin: form.gstin.trim().toUpperCase() || undefined,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    credit_days: creditDays,
    credit_limit: form.credit_limit.trim() ? D(form.credit_limit.trim()).toNumber() : undefined,
    force: force ? true : undefined,
  })

  const submit = async (force: boolean) => {
    if (!valid) return
    const r = await act(async () => {
      const res = await api.createParty(build(force))
      if (res.status === 'created') await useApp.getState().refreshMaster()
      return res
    })
    if (!r) return
    if (r.status === 'possible_duplicate') { setDup(r); return }
    useApp.getState().toast('ok', 'Party created', `${form.display_name.trim()} · ${r.party_no}`)
    close()
    nav('/parties/' + r.id)
  }

  const hasRoleHere = (partyId: ID) => parties.find((p) => p.id === partyId)?.roles.some((r) => r.company_id === form.company_id && r.type_key === form.type_key) ?? false
  const adoptExisting = async (partyId: ID) => {
    if (hasRoleHere(partyId)) { close(); nav('/parties/' + partyId); return }
    const ok = await act(async () => {
      await api.addPartyRole(partyId, form.company_id, form.type_key)
      await useApp.getState().refreshMaster()
      return true
    }, 'Relationship added to the existing party')
    if (ok) { close(); nav('/parties/' + partyId) }
  }

  const columns: Column<Party>[] = [
    { key: 'no', header: 'Party no', width: 170, render: (p) => <span className="num text-[12.5px] text-gold">{p.party_no}</span>, sort: (p) => p.party_no, csv: (p) => p.party_no },
    {
      key: 'name', header: 'Name', sort: (p) => p.display_name.toLowerCase(), csv: (p) => p.display_name,
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{p.display_name}</div>
          {p.legal_name && p.legal_name !== p.display_name && <div className="truncate text-[11.5px] text-muted">{p.legal_name}</div>}
        </div>
      ),
    },
    { key: 'kind', header: 'Kind', width: 120, render: (p) => <span className="text-ink2">{p.kind === 'person' ? 'Person' : 'Organization'}</span>, sort: (p) => p.kind, csv: (p) => p.kind },
    {
      key: 'roles', header: 'Roles', csv: (p) => rolesInScope(p).map(roleLabel).join('; '),
      render: (p) => <div className="flex flex-wrap gap-1">{rolesInScope(p).map((r) => <span key={r.id} className="chip">{roleLabel(r)}</span>)}</div>,
    },
    { key: 'status', header: 'Status', width: 120, render: (p) => <StatusChip status={p.status} />, sort: (p) => p.status, csv: (p) => p.status },
    {
      key: 'tax', header: 'GSTIN / PAN', width: 190, csv: (p) => [p.gstin, p.pan].filter(Boolean).join(' / '),
      render: (p) => (p.gstin || p.pan ? <div className="num text-[12px] text-ink2">{p.gstin && <div>{p.gstin}</div>}{p.pan && <div className={p.gstin ? 'text-muted' : ''}>{p.pan}</div>}</div> : <span className="text-muted">—</span>),
    },
    { key: 'created', header: 'Created', width: 120, render: (p) => <span className="num text-[12.5px] text-ink2">{fmtDate(p.created_at)}</span>, sort: (p) => p.created_at, csv: (p) => p.created_at.slice(0, 10) },
  ]

  const tabs: { key: TabKey; label: string; count: number }[] = [{ key: 'all', label: 'All', count: scoped.length }, ...GROUPS.map((g) => ({ key: g.key as TabKey, label: g.tab, count: counts[g.key] }))]
  const formCompany = companyById.get(form.company_id)

  return (
    <div>
      <PageHeader
        eyebrow="Party Universe"
        title="People & Parties"
        subtitle={<>Every customer, vendor, employee, broker, contractor and institution the selected compan{ids.length === 1 ? 'y deals' : 'ies deal'} with — one identity per party, with a role in each company.</>}
        actions={<>
          <button className="btn" onClick={() => nav('/parties/owed?side=in')}><HandCoins size={14} /> Who owes us?</button>
          <button className="btn" onClick={() => nav('/parties/owed?side=out')}><Receipt size={14} /> Who do we owe?</button>
          <button className="btn primary" onClick={startAdd} disabled={!mayCreate || !types.data?.length}
            title={mayCreate ? 'Add a new party' : 'Your role does not include the permission to create parties (party.create) in the selected companies.'}>
            <Plus size={14} /> Add party
          </button>
        </>}
      />

      {types.error && <ErrorBox message={types.error} retry={types.reload} />}
      {types.loading && !types.data && <Panel><Loading rows={5} label="Loading parties" /></Panel>}

      {types.data && (
        <>
          <div className="stagger mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Panel className={cx('p-4', tab === 'all' && status === 'active' && 'border-gold/40')} onClick={() => { setTab('all'); setStatus('active') }} title="Show every active party">
              <div className="flex items-center gap-2 text-muted"><span className="text-gold"><Users size={16} /></span><span className="eyebrow truncate">Total active parties</span></div>
              <div className="num mt-2.5 text-[22px] leading-none">{activeCount.toLocaleString()}</div>
              <div className="mt-2 text-[11px] text-muted"><span className="num">{scoped.length.toLocaleString()}</span> in total, all statuses</div>
            </Panel>
            {GROUPS.filter((g) => g.tile).map((g) => (
              <Panel key={g.key} className={cx('p-4', tab === g.key && 'border-gold/40')} onClick={() => { setTab(g.key); setStatus('all') }} title={`Show ${g.tile!.toLowerCase()}`}>
                <div className="flex items-center gap-2 text-muted"><span className="text-gold">{g.icon}</span><span className="eyebrow truncate">{g.tile}</span></div>
                <div className="num mt-2.5 text-[22px] leading-none">{counts[g.key].toLocaleString()}</div>
                <div className="mt-2 text-[11px] text-muted">{counts[g.key] === 1 ? 'party holds' : 'parties hold'} this kind of role</div>
              </Panel>
            ))}
          </div>

          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          <Panel lit={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              onRow={(p) => nav('/parties/' + p.id)}
              exportName="parties"
              initialSort={{ key: 'name', dir: 'asc' }}
              toolbar={<>
                <div className="relative min-w-[240px] flex-1 md:max-w-[420px]">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm w-full" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, party number, GSTIN, PAN, email or phone" aria-label="Search parties" />
                </div>
                <select className="field sm" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
                {(needle || status !== 'all' || tab !== 'all') && <button className="btn sm ghost" onClick={() => { setQ(''); setStatus('all'); setTab('all') }}>Clear filters</button>}
              </>}
              empty={scoped.length === 0
                ? { title: 'No parties yet', body: 'No party has a role in the selected companies. Add the first customer, vendor or employee to begin.', icon: <Users size={20} />, action: mayCreate ? <button className="btn primary" onClick={startAdd}><Plus size={14} /> Add party</button> : undefined }
                : { title: 'No party matches this filter', body: 'Change the category, status or search text to see more.', icon: <Search size={20} /> }}
            />
          </Panel>
        </>
      )}

      <Modal open={open} onClose={close} title="Add party" width={720}
        subtitle="One identity per party across the group. NUMERO checks for an existing record before creating a new one."
        footer={dup ? (
          <>
            <button className="btn ghost" onClick={() => setDup(null)} disabled={busy}>Back to the form</button>
            <button className="btn danger" onClick={() => submit(true)} disabled={busy || !valid} title="Create a separate party even though similar records exist">Create anyway</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={() => submit(false)} disabled={busy || !valid}>{busy ? 'Checking…' : 'Create party'}</button>
          </>
        )}>
        {dup ? (
          <div>
            <div className="rounded-xl border border-warn/30 bg-warnsoft p-4">
              <div className="eyebrow text-warn">Possible duplicate</div>
              <div className="display mt-1 text-[15px] font-medium text-ink">A matching party may already exist — nothing has been created</div>
              <p className="mb-0 mt-1.5 text-[12.5px] text-ink2">
                The name, PAN or GSTIN entered for <span className="text-ink">{form.display_name.trim()}</span> matches the record{dup.candidates.length === 1 ? '' : 's'} below. Using the existing party keeps one history and one balance for the same counterparty.
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-line">
              {dup.candidates.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">No matching record is visible to your account.</div>}
              {dup.candidates.map((c) => {
                const here = hasRoleHere(c.id)
                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
                    <div className="min-w-0">
                      <button className="link text-[13.5px]" onClick={() => { close(); nav('/parties/' + c.id) }}>{c.display_name}</button>
                      <div className="num mt-0.5 text-[11.5px] text-gold">{c.party_no}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn sm ghost" onClick={() => { close(); nav('/parties/' + c.id) }}>Open</button>
                      <button className="btn sm good" disabled={busy} onClick={() => adoptExisting(c.id)}
                        title={here ? 'This party already has this role in the chosen company' : `Add the role "${typeByKey.get(form.type_key)?.name ?? form.type_key}" in ${formCompany?.name ?? 'the chosen company'} to this existing party`}>
                        {here ? 'Use existing party' : `Use existing party · add role in ${formCompany?.code ?? 'company'}`}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {dup.restricted_matches > 0 && (
              <Note kind="warn" className="mt-3">
                {dup.restricted_matches} further matching record{dup.restricted_matches === 1 ? '' : 's'} exist{dup.restricted_matches === 1 ? 's' : ''} that your account cannot view. Ask a group administrator before creating a separate party.
              </Note>
            )}
            <div className="mt-3 text-[12px] text-muted">Choose “Use existing party” to continue with a record above, or “Create anyway” if this is genuinely a different party. The decision is recorded in the audit trail.</div>
          </div>
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Company">
              <select className="field" value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
                {creatable.length === 0 && <option value="">No company available</option>}
                {creatable.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </Field>
            <Field label="Party type">
              <select className="field" value={form.type_key} onChange={(e) => set('type_key', e.target.value)}>
                {(types.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Kind">
              <select className="field" value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>
                <option value="organization">Organization</option>
                <option value="person">Person</option>
              </select>
            </Field>
            <Field label="Display name (required)">
              <input className="field" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} autoFocus />
            </Field>
            <Field label="Legal name" className="md:col-span-2">
              <input className="field" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
            </Field>
            <Field label="PAN">
              <input className="field num" value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} />
            </Field>
            <Field label="GSTIN">
              <input className="field num" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} />
            </Field>
            <Field label="Email">
              <input className="field" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className="field" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Credit days" hint={creditDaysValid ? 'Number of days allowed for payment' : 'Enter a whole number of days'}>
              <input className="field num" type="number" min={0} step={1} value={form.credit_days} onChange={(e) => set('credit_days', e.target.value)} />
            </Field>
            <Field label={`Credit limit${formCompany ? ` (${formCompany.base_currency})` : ''}`} hint={creditLimitValid ? 'Leave empty for no limit' : 'Enter an amount using digits only'}>
              <input className="field num" inputMode="decimal" value={form.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
