import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Lock, Pencil, Plus, Save, Search, Settings2, Trash2 } from 'lucide-react'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Confidentiality, ID } from '@/engine/types'
import type { Certainty, Frequency, RegisterCategory, RegisterField, RegisterItem, RegisterItemInput, RegisterKind } from '@/engine/opsTypes'
import { CERTAINTY_MEANING, PER_YEAR, type ForwardCertainty } from '@/engine/forward'
import { D, sum } from '@/lib/money'
import { addDays, fmtDate, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { Stat, useCompanyName, usePartyName } from '@/ui/ops'

type Tab = 'all' | RegisterCategory
type Direction = RegisterItem['direction']

const CATEGORIES: { key: RegisterCategory; label: string; about: string }[] = [
  { key: 'obligation', label: 'Obligations', about: 'What the business has agreed to pay' },
  { key: 'income', label: 'Income', about: 'What the business has agreed to receive' },
  { key: 'pipeline', label: 'Pipeline', about: 'What may become business; not yet agreed' },
  { key: 'exposure', label: 'Exposure', about: 'What could become payable or receivable' },
  { key: 'asset', label: 'Assets', about: 'Things the business holds and must look after' },
  { key: 'incident', label: 'Incidents', about: 'Events recorded for review by a person' },
  { key: 'path', label: 'Paths', about: 'Trips, events and other journeys of money' },
  { key: 'other', label: 'Other', about: 'Everything else' },
]
const CERTAINTIES: Certainty[] = ['contracted', 'committed', 'scheduled', 'expected', 'probable', 'possible', 'contingent', 'forecast']
const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: 'once', label: 'Once' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }, { key: 'quarterly', label: 'Quarterly' }, { key: 'half_yearly', label: 'Half-yearly' }, { key: 'yearly', label: 'Yearly' },
]
const STATUSES: RegisterItem['status'][] = ['draft', 'active', 'paused', 'ended', 'cancelled', 'closed']
/** the states the database accepts for a register item (migration 0006) */
const STATES = ['active', 'proposed', 'negotiating', 'quoted', 'approved', 'contracted', 'committed', 'ordered', 'delivered', 'invoiced', 'due', 'paid', 'received', 'overdue', 'disputed', 'under_review', 'resolved', 'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'forecast', 'contingent', 'cancelled', 'closed']
const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'SAR', 'CNY']
const FIELD_TYPES: RegisterField['type'][] = ['text', 'number', 'money', 'date', 'select', 'boolean']
const CERT_CLS: Record<Certainty, string> = { contracted: 'cyan', committed: 'cyan', scheduled: 'cyan', expected: 'gold', probable: 'gold', possible: 'warn', contingent: 'warn', forecast: 'violet' }
const DIRECTION_LABEL: Record<Direction, string> = { out: 'Money goes out', in: 'Money comes in', none: 'No money movement' }

const meaning = (c: Certainty) => CERTAINTY_MEANING[c.toUpperCase() as ForwardCertainty] ?? ''
const freqLabel = (f: Frequency) => FREQUENCIES.find((x) => x.key === f)?.label ?? f
const num = (v: string) => v.replace(/[^\d.]/g, '')
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

function CertaintyChip({ value }: { value: Certainty }) {
  return <span className={cx('chip', CERT_CLS[value])} title={meaning(value)}>{value.toUpperCase()}</span>
}

/** Dates on an item that a person should see coming: renewal, end, and the kind's watched date fields. */
function watchedDates(item: RegisterItem, kind: RegisterKind | undefined): string[] {
  const out: string[] = []
  if (item.renewal_date) out.push(item.renewal_date)
  if (item.end_date) out.push(item.end_date)
  for (const f of kind?.fields ?? []) { const v = item.data[f.key]; if (f.alert && typeof v === 'string' && v) out.push(v) }
  return out
}

export default function Registers() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const isGroupAdmin = useApp((s) => s.session?.isGroupAdmin ?? false)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const currency = useCurrency()
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const t = today()
  const in30 = addDays(t, 30)
  const mayView = can('register.view')
  const mayManage = can('register.manage')

  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [soonOnly, setSoonOnly] = useState(false)
  const [kindsOpen, setKindsOpen] = useState(false)

  const kindFilter = sp.get('kind') ?? ''
  const editId = sp.get('edit')
  const creating = sp.has('new')
  const newKind = sp.get('new') ?? ''
  const patch = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(p)) { if (v === null) n.delete(k); else n.set(k, v) }
    setSp(n, { replace: true })
  }

  const main = useAsync(async () => {
    if (!mayView) return { items: [] as RegisterItem[], kinds: [] as RegisterKind[] }
    const [items, kinds] = await Promise.all([api.listRegisterItems({ companyIds: ids }), api.listRegisterKinds()])
    return { items, kinds }
  }, [api, idsKey, mayView])

  const d = main.data
  const kinds = useMemo(() => d?.kinds ?? [], [d])
  const items = useMemo(() => d?.items ?? [], [d])
  const kindBy = useMemo(() => new Map(kinds.map((k) => [k.key, k])), [kinds])
  const categoryOf = (i: RegisterItem): RegisterCategory => kindBy.get(i.kind)?.category ?? 'other'
  const kindName = (key: string) => kindBy.get(key)?.name ?? key.replace(/_/g, ' ')

  const active = items.filter((i) => i.status === 'active')
  const sameCurrency = (i: RegisterItem) => i.currency === currency
  const recurring = active.filter((i) => i.direction === 'out' && PER_YEAR[i.frequency] > 0 && (i.certainty === 'scheduled' || i.certainty === 'contracted'))
  const recurringOther = active.filter((i) => i.direction === 'out' && PER_YEAR[i.frequency] > 0 && i.certainty !== 'scheduled' && i.certainty !== 'contracted').length
  const annualised = sum(recurring.filter(sameCurrency).map((i) => D(i.amount).times(PER_YEAR[i.frequency])))
  const recurringForeign = recurring.filter((i) => !sameCurrency(i)).length
  const isSoon = (i: RegisterItem) => i.status === 'active' && watchedDates(i, kindBy.get(i.kind)).some((x) => x >= t && x <= in30)
  const soon = items.filter(isSoon)
  const contingent = active.filter((i) => i.certainty === 'contingent')
  const contingentTotal = sum(contingent.filter(sameCurrency).map((i) => i.amount))
  const contingentForeign = contingent.filter((i) => !sameCurrency(i)).length

  const needle = q.trim().toLowerCase()
  const base = items.filter((i) => (!kindFilter || i.kind === kindFilter) && (!soonOnly || isSoon(i))
    && (!needle || [i.ref_no, i.title, kindName(i.kind), i.party_id ? partyName(i.party_id) : '', i.owner_name ?? '', i.notes ?? ''].some((s) => s.toLowerCase().includes(needle))))
  const shown = base.filter((i) => tab === 'all' || categoryOf(i) === tab)
  const kindOptions = kinds.filter((k) => tab === 'all' || k.category === tab)

  const columns: Column<RegisterItem>[] = [
    { key: 'ref', header: 'Reference', sort: (i) => i.ref_no, csv: (i) => i.ref_no, render: (i) => <div><span className="num text-[12.5px] text-gold">{i.ref_no}</span>{ids.length > 1 && <div className="truncate text-[11px] text-muted">{companyName(i.company_id)}</div>}</div> },
    { key: 'title', header: 'Title', sort: (i) => i.title.toLowerCase(), csv: (i) => i.title, render: (i) => <div className="max-w-[300px] truncate text-ink" title={i.title}>{i.title}</div> },
    { key: 'kind', header: 'Kind', sort: (i) => kindName(i.kind), csv: (i) => kindName(i.kind), render: (i) => <span className="text-[12.5px] text-ink2">{kindName(i.kind)}</span> },
    { key: 'party', header: 'Party', sort: (i) => partyName(i.party_id).toLowerCase(), csv: (i) => (i.party_id ? partyName(i.party_id) : ''), render: (i) => <span className="text-ink2">{partyName(i.party_id)}</span> },
    {
      key: 'amount', header: 'Amount and frequency', align: 'right', sort: (i) => D(i.amount).toNumber(), csv: (i) => `${D(i.amount).toFixed(2)} ${i.currency} ${freqLabel(i.frequency)} ${i.direction}`,
      render: (i) => (D(i.amount).isZero() && i.direction === 'none' ? <span className="text-muted">—</span> : <div><Money value={i.amount} currency={i.currency} /><div className="text-[11px] text-muted">{freqLabel(i.frequency).toLowerCase()} · {i.direction === 'in' ? 'in' : i.direction === 'out' ? 'out' : 'no movement'}</div></div>),
    },
    { key: 'due', header: 'Next due', sort: (i) => i.next_due ?? '9999', csv: (i) => i.next_due ?? '', render: (i) => (i.next_due ? <span className={cx('num text-[12.5px]', i.status === 'active' && i.next_due < t && 'text-neg')}>{fmtDate(i.next_due)}</span> : <span className="text-muted">—</span>) },
    { key: 'certainty', header: 'Certainty', sort: (i) => CERTAINTIES.indexOf(i.certainty), csv: (i) => i.certainty.toUpperCase(), render: (i) => <CertaintyChip value={i.certainty} /> },
    { key: 'status', header: 'Status', sort: (i) => i.status, csv: (i) => (i.state && i.state !== i.status ? `${i.status} (${i.state})` : i.status), render: (i) => <div><StatusChip status={i.status} />{i.state && i.state !== i.status && <div className="mt-0.5 text-[11px] text-muted">{i.state.replace(/_/g, ' ')}</div>}</div> },
    { key: 'owner', header: 'Owner', sort: (i) => (i.owner_name ?? '').toLowerCase(), csv: (i) => i.owner_name ?? '', render: (i) => (i.owner_name ? <span className="text-ink2">{i.owner_name}</span> : <span className="text-[12px] text-warn">no owner recorded</span>) },
  ]

  const closeDrawer = () => patch({ edit: null, new: null })

  return (
    <div>
      <PageHeader
        eyebrow="Registers"
        title="Registers"
        subtitle={<>Everything that can create a future financial consequence: subscriptions, insurance, rent, leases, contracts, guarantees, claims, vehicles, incidents and more. {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}.{mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}</>}
        actions={<>
          {isGroupAdmin && <button className="btn" onClick={() => setKindsOpen(true)}><Settings2 size={15} /> Register kinds</button>}
          <button className="btn primary" disabled={!mayManage} title={mayManage ? 'Record a new register item' : 'You are not authorised to manage the registers'} onClick={() => patch({ new: kindFilter, edit: null })}><Plus size={15} /> New item</button>
        </>}
      />

      {!mayView && <Panel><Empty icon={<Lock size={20} />} title="You do not have access to the registers" body="Viewing the registers needs the permission “register.view” in at least one of the selected companies. Ask a Group Super Admin to grant it." /></Panel>}
      {mayView && main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {mayView && !main.error && !d && <Panel><Loading rows={6} label="Loading the registers" /></Panel>}

      {mayView && d && (
        <>
          <div className="stagger mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Active items" value={active.length} count sub={`${items.length.toLocaleString()} recorded in all, of every status`} />
            <Stat label="Recurring outflow per year" value={annualised.toString()} currency={currency} tone="gold"
              sub={<>SCHEDULED / CONTRACTED — annualised. Amount × occurrences a year, before any escalation.{recurringOther > 0 && <> {recurringOther} recurring item{recurringOther === 1 ? '' : 's'} of another certainty {recurringOther === 1 ? 'is' : 'are'} not included.</>}{recurringForeign > 0 && <> {recurringForeign} item{recurringForeign === 1 ? '' : 's'} in another currency {recurringForeign === 1 ? 'is' : 'are'} not included.</>}</>} />
            <Stat label="Dates inside 30 days" value={soon.length} count tone={soon.length ? 'warn' : undefined} onClick={() => setSoonOnly((v) => !v)}
              sub={<>Active items with a renewal, end or watched date by {fmtDate(in30)}. {soonOnly ? 'Click to show everything.' : 'Click to list them.'}</>} />
            <Stat label="Contingent exposure" value={contingentTotal.toString()} currency={currency} tone="warn"
              sub={<>CONTINGENT — {contingent.length} active item{contingent.length === 1 ? '' : 's'}. Depends on an uncertain event; never part of projected cash.{contingentForeign > 0 && <> {contingentForeign} in another currency {contingentForeign === 1 ? 'is' : 'are'} not included.</>}</>} />
          </div>

          <Tabs<Tab>
            tabs={[{ key: 'all', label: 'All', count: base.length }, ...CATEGORIES.map((c) => ({ key: c.key as Tab, label: c.label, count: base.filter((i) => categoryOf(i) === c.key).length }))]}
            value={tab}
            onChange={(k) => { setTab(k); if (kindFilter && k !== 'all' && kindBy.get(kindFilter)?.category !== k) patch({ kind: null }) }}
          />

          <Panel lit={false}>
            <DataTable
              columns={columns} rows={shown} rowKey={(i) => i.id} onRow={(i) => nav('/registers/' + i.id)} exportName="registers" initialSort={{ key: 'ref', dir: 'asc' }}
              toolbar={<>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="field sm" style={{ width: 230, paddingLeft: 28 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, title, party, owner" aria-label="Search the registers" />
                </div>
                <select className="field sm" style={{ width: 220 }} value={kindFilter} onChange={(e) => patch({ kind: e.target.value || null })} aria-label="Filter by kind">
                  <option value="">All kinds</option>
                  {kindFilter && !kindOptions.some((k) => k.key === kindFilter) && <option value={kindFilter}>{kindName(kindFilter)}</option>}
                  {kindOptions.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
                </select>
                {soonOnly && <button className="chip gold" onClick={() => setSoonOnly(false)}>Dates inside 30 days — clear</button>}
              </>}
              empty={items.length === 0
                ? { title: 'Nothing is recorded in the registers', body: 'Record each subscription, policy, lease, contract, guarantee or claim once. NUMERO then shows what falls due, what renews and what could go wrong.', icon: <FolderKanban size={20} />, action: mayManage ? <button className="btn sm" onClick={() => patch({ new: '', edit: null })}><Plus size={13} /> New item</button> : undefined }
                : { title: 'No item matches', body: 'No register item matches the tab, kind and search you have chosen. Clear them to see everything.', icon: <Search size={20} />, action: <button className="btn sm" onClick={() => { setQ(''); setSoonOnly(false); setTab('all'); patch({ kind: null }) }}>Clear filters</button> }}
            />
          </Panel>
          <div className="mt-2 text-[11.5px] text-muted">Amounts are shown in the currency recorded on each item. A register item is a record of what was agreed; it does not post to the ledger and it does not move money.</div>
        </>
      )}

      <ItemDrawer open={creating || !!editId} editId={editId} initialKind={newKind} kinds={kinds} kindsLoading={main.loading && !d} onClose={closeDrawer} onSaved={(id) => nav('/registers/' + id)} />
      {isGroupAdmin && <KindsDrawer open={kindsOpen} kinds={kinds} onClose={() => setKindsOpen(false)} />}
    </div>
  )
}

// ====================================================================== item editor
interface Form {
  company_id: ID; kind: string; title: string; party_id: string; account_id: string; direction: Direction; amount: string; currency: string; frequency: Frequency
  start_date: string; end_date: string; next_due: string; total_value: string; certainty: Certainty; state: string; status: RegisterItem['status']
  auto_renew: boolean; renewal_date: string; cancel_by: string; escalation_pct: string; escalation_date: string; escalation_months: string; probability: string
  owner_name: string; confidentiality: Confidentiality; notes: string; data: Record<string, unknown>; create_dimension: boolean; reason: string
}
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const emptyForm = (companyId: ID, currency: string, kind?: RegisterKind): Form => ({
  company_id: companyId, kind: kind?.key ?? '', title: '', party_id: '', account_id: '', direction: kind?.direction ?? 'out', amount: '', currency, frequency: 'once',
  start_date: '', end_date: '', next_due: '', total_value: '', certainty: kind?.default_certainty ?? 'expected', state: 'active', status: 'active',
  auto_renew: false, renewal_date: '', cancel_by: '', escalation_pct: '', escalation_date: '', escalation_months: '', probability: '',
  owner_name: '', confidentiality: 'internal', notes: '', data: {}, create_dimension: true, reason: '',
})
const formOf = (i: RegisterItem): Form => ({
  company_id: i.company_id, kind: i.kind, title: i.title, party_id: i.party_id ?? '', account_id: i.account_id ?? '', direction: i.direction, amount: s(i.amount), currency: i.currency, frequency: i.frequency,
  start_date: i.start_date ?? '', end_date: i.end_date ?? '', next_due: i.next_due ?? '', total_value: s(i.total_value), certainty: i.certainty, state: i.state ?? '', status: i.status,
  auto_renew: i.auto_renew, renewal_date: i.renewal_date ?? '', cancel_by: i.cancel_by ?? '', escalation_pct: s(i.escalation_pct), escalation_date: i.escalation_date ?? '', escalation_months: s(i.escalation_months), probability: s(i.probability),
  owner_name: i.owner_name ?? '', confidentiality: i.confidentiality, notes: i.notes ?? '', data: { ...(i.data ?? {}) }, create_dimension: false, reason: '',
})

function ItemDrawer({ open, editId, initialKind, kinds, kindsLoading, onClose, onSaved }: { open: boolean; editId: string | null; initialKind: string; kinds: RegisterKind[]; kindsLoading: boolean; onClose: () => void; onSaved: (id: ID) => void }) {
  const api = useApp((st) => st.api)!
  const companies = useApp((st) => st.companies)
  const accounts = useApp((st) => st.accounts)
  const parties = useApp((st) => st.parties)
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const choices = companies.filter((c) => c.status === 'active' && ids.includes(c.id))
  const baseOf = (id: ID) => companies.find((c) => c.id === id)?.base_currency ?? 'INR'

  const [form, setForm] = useState<Form>(() => emptyForm(ids[0] ?? '', baseOf(ids[0] ?? '')))
  const filled = useRef<string | null>(null)
  const loaded = useAsync(async () => (open && editId ? api.getRegisterItem(editId) : null), [api, open, editId])
  const item = editId && loaded.data && loaded.data.id === editId ? loaded.data : null

  useEffect(() => {
    if (!open) { filled.current = null; return }
    if (editId) {
      if (item && filled.current !== 'edit:' + editId) { filled.current = 'edit:' + editId; setForm(formOf(item)) }
      return
    }
    const key = 'new:' + initialKind + ':' + kinds.length
    if (filled.current === key) return
    filled.current = key
    const first = ids[0] ?? ''
    setForm(emptyForm(first, baseOf(first), kinds.find((k) => k.key === initialKind)))
  }, [open, editId, item, initialKind, kinds]) // eslint-disable-line react-hooks/exhaustive-deps

  const kind = kinds.find((k) => k.key === form.kind)
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }))
  const setData = (key: string, v: unknown) => setForm((f) => ({ ...f, data: { ...f.data, [key]: v } }))
  const chooseKind = (k: RegisterKind) => set({ kind: k.key, direction: k.direction, certainty: k.default_certainty, data: {}, create_dimension: true })

  const pts = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === form.company_id) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, form.company_id])
  const accs = useMemo(() => accounts.filter((a) => a.company_id === form.company_id && !a.is_group && a.is_active).sort((a, b) => a.code.localeCompare(b.code)), [accounts, form.company_id])
  const allowed = can('register.manage', form.company_id || undefined)

  const problems: string[] = []
  if (!form.company_id) problems.push('Choose the company.')
  if (!form.title.trim()) problems.push('Enter a title.')
  if (form.start_date && form.end_date && form.end_date < form.start_date) problems.push('The end date is before the start date.')
  if (form.probability !== '' && (D(form.probability).lt(0) || D(form.probability).gt(100))) problems.push('Probability must be between 0 and 100.')
  if (form.direction !== 'none' && form.amount !== '' && D(form.amount).lt(0)) problems.push('The amount cannot be negative.')
  for (const f of kind?.fields ?? []) if (f.required && isBlank(form.data[f.key])) problems.push(`${f.label} is required.`)

  const payload = (): RegisterItemInput => {
    const data: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(form.data)) {
      if (isBlank(v)) continue
      const f = kind?.fields.find((x) => x.key === k)
      data[k] = f?.type === 'number' && typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : v
    }
    const input: RegisterItemInput = {
      company_id: form.company_id, kind: form.kind, title: form.title.trim(), party_id: form.party_id || null, account_id: form.account_id || null, direction: form.direction,
      amount: form.amount.trim() === '' ? 0 : form.amount.trim(), currency: form.currency, frequency: form.frequency, start_date: orNull(form.start_date), end_date: orNull(form.end_date), next_due: orNull(form.next_due),
      total_value: orNull(form.total_value), certainty: form.certainty, state: STATES.includes(form.state) ? form.state : 'active', status: form.status, auto_renew: form.auto_renew, renewal_date: orNull(form.renewal_date), cancel_by: orNull(form.cancel_by),
      escalation_pct: orNull(form.escalation_pct), escalation_date: orNull(form.escalation_date), escalation_months: form.escalation_months.trim() === '' ? null : Math.max(1, Math.round(Number(form.escalation_months))),
      probability: orNull(form.probability), owner_name: orNull(form.owner_name), confidentiality: form.confidentiality, notes: orNull(form.notes), data,
    }
    if (item) { input.id = item.id; input.org_unit_id = item.org_unit_id; input.owner_user = item.owner_user; if (form.reason.trim()) input.reason = form.reason.trim() }
    else if (kind?.dimension_type) input.create_dimension = form.create_dimension
    return input
  }
  const save = async () => {
    const id = await act(() => api.saveRegisterItem(payload()), item ? 'Changes saved' : 'Register item recorded')
    if (id) { onClose(); onSaved(id) }
  }

  const choosing = !editId && !form.kind
  const title = editId ? (item ? `Edit ${item.ref_no}` : 'Edit register item') : kind ? `New ${kind.name.toLowerCase()}` : 'New register item'

  return (
    <Drawer open={open} onClose={onClose} width={760} title={title}
      subtitle={choosing ? 'Choose what kind of item this is' : kind ? `${CATEGORIES.find((c) => c.key === kind.category)?.label ?? 'Register'} · reference prefix ${kind.prefix}` : undefined}
      footer={choosing || (editId && !item) ? <button className="btn ghost" onClick={onClose}>Cancel</button> : <>
        {!editId && <button className="btn ghost mr-auto" onClick={() => set({ kind: '', data: {} })}><ArrowLeft size={14} /> Change kind</button>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || problems.length > 0 || !allowed} title={allowed ? undefined : 'You are not authorised to manage the registers of this company'} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {item ? 'Save changes' : 'Record item'}</button>
      </>}>
      {editId && loaded.error && <ErrorBox message={loaded.error} retry={loaded.reload} />}
      {editId && !loaded.error && !item && <Loading rows={6} label="Loading the register item" />}

      {choosing && (kindsLoading ? <Loading rows={5} /> : kinds.length === 0 ? (
        <Empty icon={<FolderKanban size={20} />} title="No register kind is defined" body="A Group Super Admin defines the kinds of register item under “Register kinds”." />
      ) : (
        <div className="space-y-5">
          {CATEGORIES.map((c) => {
            const list = kinds.filter((k) => k.category === c.key && k.is_active)
            if (!list.length) return null
            return (
              <div key={c.key}>
                <div className="eyebrow">{c.label}</div>
                <div className="mb-2 text-[11.5px] text-muted">{c.about}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((k) => (
                    <button key={k.key} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-gold/50 hover:bg-surface2" onClick={() => chooseKind(k)}>
                      <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-ink">{k.name}</span><span className="num text-[10.5px] text-gold">{k.prefix}</span></div>
                      <div className="mt-0.5 text-[11.5px] text-muted">{DIRECTION_LABEL[k.direction]} · usually {k.default_certainty.toUpperCase()}</div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {!choosing && (!editId || item) && (
        <div className="space-y-6">
          {!allowed && <Note kind="warn">You are not authorised to manage the registers of this company. You can read this form but not save it.</Note>}
          <div>
            <div className="eyebrow mb-2.5">What it is</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company">
                <select className="field" value={form.company_id} disabled={!!editId} onChange={(e) => set({ company_id: e.target.value, party_id: '', account_id: '', currency: baseOf(e.target.value) })}>
                  <option value="">Choose…</option>
                  {editId && !choices.some((c) => c.id === form.company_id) && <option value={form.company_id}>{companies.find((c) => c.id === form.company_id)?.name ?? 'Company'}</option>}
                  {choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Kind"><input className="field" value={kind?.name ?? form.kind} disabled readOnly /></Field>
              <Field label="Title *" className="sm:col-span-2"><input className="field" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="What a colleague would call it" autoFocus={!editId} /></Field>
              <Field label="Party" hint="Optional. The other side of the agreement.">
                <select className="field" value={form.party_id} onChange={(e) => set({ party_id: e.target.value })}><option value="">None</option>{pts.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
              </Field>
              <Field label="Ledger account" hint="Optional. The ledger this item is normally recorded in.">
                <select className="field" value={form.account_id} onChange={(e) => set({ account_id: e.target.value })}><option value="">None</option>{accs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
              </Field>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2.5">Money and dates</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Direction"><select className="field" value={form.direction} onChange={(e) => set({ direction: e.target.value as Direction })}>{(['out', 'in', 'none'] as Direction[]).map((x) => <option key={x} value={x}>{DIRECTION_LABEL[x]}</option>)}</select></Field>
              <Field label="Amount" hint="Of one occurrence"><input className="field num" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: num(e.target.value) })} /></Field>
              <Field label="Currency"><select className="field" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>{[...new Set([form.currency, ...CURRENCIES])].filter(Boolean).map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Frequency"><select className="field" value={form.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>{FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
              <Field label="Start date"><input type="date" className="field" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
              <Field label="End date"><input type="date" className="field" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></Field>
              <Field label="Next due" hint={editId ? undefined : 'If empty, the start date is used'}><input type="date" className="field" value={form.next_due} onChange={(e) => set({ next_due: e.target.value })} /></Field>
              <Field label="Total value" hint="Of the whole agreement, if known"><input className="field num" inputMode="decimal" value={form.total_value} onChange={(e) => set({ total_value: num(e.target.value) })} /></Field>
              <Field label="Certainty" hint={meaning(form.certainty)}><select className="field" value={form.certainty} onChange={(e) => set({ certainty: e.target.value as Certainty })}>{CERTAINTIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select></Field>
              <Field label="Status" hint="Only active items appear in Forward"><select className="field" value={form.status} onChange={(e) => set({ status: e.target.value as RegisterItem['status'] })}>{STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
              <Field label="State" hint="Where it stands in its life" className="sm:col-span-2"><select className="field" value={STATES.includes(form.state) ? form.state : 'active'} onChange={(e) => set({ state: e.target.value })}>{STATES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></Field>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2.5">Renewal and escalation</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-3">
                <input type="checkbox" className="mt-[3px]" checked={form.auto_renew} onChange={(e) => set({ auto_renew: e.target.checked })} />
                <span className="text-[13px] text-ink2">Renews automatically unless cancelled<span className="block text-[11.5px] text-muted">An item that renews automatically keeps falling due after its end date.</span></span>
              </label>
              <Field label="Renewal date"><input type="date" className="field" value={form.renewal_date} onChange={(e) => set({ renewal_date: e.target.value })} /></Field>
              <Field label="Cancel by" hint="Last day to give notice"><input type="date" className="field" value={form.cancel_by} onChange={(e) => set({ cancel_by: e.target.value })} /></Field>
              <div className="hidden sm:block" />
              <Field label="Escalation %" hint="Agreed increase, if any"><input className="field num" inputMode="decimal" value={form.escalation_pct} onChange={(e) => set({ escalation_pct: num(e.target.value) })} /></Field>
              <Field label="First escalation on"><input type="date" className="field" value={form.escalation_date} onChange={(e) => set({ escalation_date: e.target.value })} /></Field>
              <Field label="Then every N months" hint="If empty, every 12 months"><input className="field num" inputMode="numeric" value={form.escalation_months} onChange={(e) => set({ escalation_months: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2.5">Responsibility</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Probability %" hint="Only if a person has assessed it. NUMERO does not estimate probability."><input className="field num" inputMode="decimal" value={form.probability} onChange={(e) => set({ probability: num(e.target.value) })} /></Field>
              <Field label="Owner name" hint="The person who answers for this item"><input className="field" value={form.owner_name} onChange={(e) => set({ owner_name: e.target.value })} /></Field>
              <Field label="Confidentiality"><select className="field" value={form.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></Field>
              <Field label="Notes" className="sm:col-span-3"><textarea className="field" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          </div>

          {kind && kind.fields.length > 0 && (
            <div>
              <div className="eyebrow mb-2.5">{kind.name} — details</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {kind.fields.map((f) => <DynamicField key={f.key} f={f} value={form.data[f.key]} onChange={(v) => setData(f.key, v)} />)}
              </div>
            </div>
          )}

          {!editId && kind?.dimension_type && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3">
              <input type="checkbox" className="mt-[3px]" checked={form.create_dimension} onChange={(e) => set({ create_dimension: e.target.checked })} />
              <span className="text-[13px] text-ink2">Create a cost-tracking dimension<span className="block text-[11.5px] text-muted">Adds a “{kind.dimension_type.replace(/_/g, ' ')}” with this item's reference, so that entries can be tagged to it and its actual cost traced. Without it, spending cannot be traced to this item.</span></span>
            </label>
          )}

          {editId && <Field label="Reason for the change" hint="Optional. Recorded in the history of this item."><textarea className="field" rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>}

          {problems.length > 0 && (form.title.trim() !== '' || !!editId) && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
        </div>
      )}
    </Drawer>
  )
}

function DynamicField({ f, value, onChange }: { f: RegisterField; value: unknown; onChange: (v: unknown) => void }) {
  const label = f.label + (f.required ? ' *' : '')
  const text = s(value)
  const hint = f.alert ? 'Watched: a warning is raised as this date approaches.' : undefined
  if (f.type === 'boolean') {
    return <Field label={label}><select className="field" value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></Field>
  }
  if (f.type === 'select') {
    const options = f.options ?? []
    return <Field label={label}><select className="field" value={text} onChange={(e) => onChange(e.target.value || null)}><option value="">—</option>{text && !options.includes(text) && <option value={text}>{text}</option>}{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
  }
  if (f.type === 'date') return <Field label={label} hint={hint}><input type="date" className="field" value={text} onChange={(e) => onChange(e.target.value || null)} /></Field>
  if (f.type === 'number' || f.type === 'money') return <Field label={label} hint={f.type === 'money' ? 'An amount of money' : undefined}><input className="field num" inputMode="decimal" value={text} onChange={(e) => onChange(num(e.target.value))} /></Field>
  return <Field label={label}><input className="field" value={text} onChange={(e) => onChange(e.target.value)} /></Field>
}

// ====================================================================== register kinds (Group Super Admin)
interface FieldRow { id: number; key: string; label: string; type: RegisterField['type']; options: string; required: boolean; alert: boolean }
interface KindForm { existing: RegisterKind | null; key: string; name: string; category: RegisterCategory; direction: Direction; default_certainty: Certainty; prefix: string; dimension_type: string; sort: string; fields: FieldRow[] }
let rowId = 0
const rowOf = (f: RegisterField): FieldRow => ({ id: ++rowId, key: f.key, label: f.label, type: f.type, options: (f.options ?? []).join(', '), required: !!f.required, alert: !!f.alert })
const kindFormOf = (k: RegisterKind | null, nextSort: number): KindForm => (k
  ? { existing: k, key: k.key, name: k.name, category: k.category, direction: k.direction, default_certainty: k.default_certainty, prefix: k.prefix, dimension_type: k.dimension_type ?? '', sort: String(k.sort), fields: k.fields.map(rowOf) }
  : { existing: null, key: '', name: '', category: 'obligation', direction: 'out', default_certainty: 'expected', prefix: '', dimension_type: '', sort: String(nextSort), fields: [] })

function KindsDrawer({ open, kinds, onClose }: { open: boolean; kinds: RegisterKind[]; onClose: () => void }) {
  const api = useApp((st) => st.api)!
  const { act, busy } = useAction()
  const [form, setForm] = useState<KindForm | null>(null)
  const unitTypes = useAsync(async () => (open ? api.listOrgUnitTypes() : []), [api, open])
  useEffect(() => { if (!open) setForm(null) }, [open])

  const set = (p: Partial<KindForm>) => setForm((f) => (f ? { ...f, ...p } : f))
  const setRow = (id: number, p: Partial<FieldRow>) => setForm((f) => (f ? { ...f, fields: f.fields.map((r) => (r.id === id ? { ...r, ...p } : r)) } : f))
  const isSystem = (k: RegisterKind) => k.group_id === null || k.group_id === undefined
  const nextSort = kinds.reduce((m, k) => Math.max(m, k.sort), 0) + 10

  const problems: string[] = []
  if (form) {
    if (!/^[a-z][a-z0-9_]*$/.test(form.key)) problems.push('The key must start with a letter and use only lower-case letters, digits and underscores.')
    if (!form.existing && kinds.some((k) => k.key === form.key)) problems.push('A kind with this key already exists. Edit that kind instead.')
    if (!form.name.trim()) problems.push('Enter a name.')
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(form.prefix)) problems.push('The prefix must be 2 to 8 capital letters or digits, starting with a letter.')
    if (form.sort.trim() === '' || !Number.isFinite(Number(form.sort))) problems.push('Enter a number for the sort order.')
    const seen = new Set<string>()
    form.fields.forEach((r, i) => {
      if (!/^[a-z][a-z0-9_]*$/.test(r.key)) problems.push(`Field ${i + 1}: the key must start with a letter and use only lower-case letters, digits and underscores.`)
      else if (seen.has(r.key)) problems.push(`Field ${i + 1}: the key “${r.key}” is used twice.`)
      seen.add(r.key)
      if (!r.label.trim()) problems.push(`Field ${i + 1}: enter a label.`)
      if (r.type === 'select' && !r.options.split(',').some((o) => o.trim())) problems.push(`Field ${i + 1}: list the options, separated by commas.`)
    })
  }

  const save = async () => {
    if (!form) return
    const fields: RegisterField[] = form.fields.map((r) => {
      const f: RegisterField = { key: r.key, label: r.label.trim(), type: r.type }
      if (r.type === 'select') f.options = r.options.split(',').map((o) => o.trim()).filter(Boolean)
      if (r.required) f.required = true
      if (r.alert && r.type === 'date') f.alert = true
      return f
    })
    const own = form.existing && !isSystem(form.existing) ? form.existing.id : undefined
    let ok = false
    await act(async () => {
      await api.saveRegisterKind({ id: own, key: form.key, name: form.name.trim(), category: form.category, direction: form.direction, default_certainty: form.default_certainty, dimension_type: form.dimension_type || null, prefix: form.prefix, fields, sort: Number(form.sort), is_active: form.existing?.is_active ?? true })
      ok = true
    }, form.existing ? 'Register kind saved' : 'Register kind added')
    if (ok) setForm(null)
  }

  return (
    <Drawer open={open} onClose={onClose} width={820} title={form ? (form.existing ? `Edit kind — ${form.existing.name}` : 'New register kind') : 'Register kinds'}
      subtitle={form ? undefined : 'The kinds of item the registers can hold, and the information each one asks for'}
      footer={form ? <>
        <button className="btn ghost mr-auto" onClick={() => setForm(null)}><ArrowLeft size={14} /> All kinds</button>
        <button className="btn primary" disabled={busy || problems.length > 0} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save kind</button>
      </> : <>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={() => setForm(kindFormOf(null, nextSort))}><Plus size={15} /> Add a kind</button>
      </>}>
      {!form && (
        <>
          <Note className="mb-4">Kinds marked “system” are supplied with NUMERO. Editing a system kind creates your group's own version of it, which then takes the place of the system kind for your group. The system kind itself is never changed.</Note>
          {kinds.length === 0 ? <Empty icon={<FolderKanban size={20} />} title="No register kind is defined" body="Add a kind to start recording items of that kind." /> : (
            <div className="space-y-4">
              {CATEGORIES.map((c) => {
                const list = kinds.filter((k) => k.category === c.key)
                if (!list.length) return null
                return (
                  <div key={c.key}>
                    <div className="eyebrow mb-1.5">{c.label}</div>
                    <div className="rounded-xl border border-line">
                      {list.map((k) => (
                        <div key={k.key} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                          <span className="num w-[52px] flex-none text-[11px] text-gold">{k.prefix}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-ink">{k.name}</div>
                            <div className="truncate text-[11.5px] text-muted">{k.key} · {DIRECTION_LABEL[k.direction].toLowerCase()} · {k.default_certainty.toUpperCase()} · {k.fields.length} field{k.fields.length === 1 ? '' : 's'}{k.dimension_type ? ` · dimension: ${k.dimension_type.replace(/_/g, ' ')}` : ''}</div>
                          </div>
                          <span className={cx('chip', !isSystem(k) && 'gold')}>{isSystem(k) ? 'system' : 'your group'}</span>
                          <button className="btn sm icon ghost" onClick={() => setForm(kindFormOf(k, nextSort))} aria-label={`Edit ${k.name}`}><Pencil size={13} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {form && (
        <div className="space-y-6">
          {form.existing && isSystem(form.existing) && <Note>This is a system kind. Saving creates your group's own version of “{form.existing.name}”; the system kind is left as it is.</Note>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Key" hint={form.existing ? 'The key identifies the kind and cannot be changed' : 'For example equipment_hire'}><input className="field num" value={form.key} disabled={!!form.existing} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>
            <Field label="Name" className="sm:col-span-2"><input className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Category"><select className="field" value={form.category} onChange={(e) => set({ category: e.target.value as RegisterCategory })}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
            <Field label="Direction"><select className="field" value={form.direction} onChange={(e) => set({ direction: e.target.value as Direction })}>{(['out', 'in', 'none'] as Direction[]).map((x) => <option key={x} value={x}>{DIRECTION_LABEL[x]}</option>)}</select></Field>
            <Field label="Default certainty" hint={meaning(form.default_certainty)}><select className="field" value={form.default_certainty} onChange={(e) => set({ default_certainty: e.target.value as Certainty })}>{CERTAINTIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select></Field>
            <Field label="Reference prefix" hint="Items are numbered PREFIX-00001"><input className="field num" value={form.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} /></Field>
            <Field label="Dimension type" hint="If set, a new item can create its own cost-tracking dimension">
              <select className="field" value={form.dimension_type} onChange={(e) => set({ dimension_type: e.target.value })}>
                <option value="">None</option>
                {form.dimension_type && !(unitTypes.data ?? []).some((u) => u.key === form.dimension_type) && <option value={form.dimension_type}>{form.dimension_type.replace(/_/g, ' ')}</option>}
                {(unitTypes.data ?? []).map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Sort order" hint="Lower numbers are listed first"><input className="field num" inputMode="numeric" value={form.sort} onChange={(e) => set({ sort: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="eyebrow">Fields asked for on each item</div>
              <button className="btn sm" onClick={() => set({ fields: [...form.fields, { id: ++rowId, key: '', label: '', type: 'text', options: '', required: false, alert: false }] })}><Plus size={13} /> Add field</button>
            </div>
            {form.fields.length === 0 ? <div className="rounded-xl border border-line px-3 py-3 text-[12.5px] text-muted">This kind asks for no information beyond the standard form. Add a field to ask for more.</div> : (
              <div className="overflow-auto rounded-xl border border-line">
                <table className="table dense" style={{ minWidth: 720 }}>
                  <thead><tr><th style={{ width: 150 }}>Key</th><th>Label</th><th style={{ width: 120 }}>Type</th><th style={{ width: 190 }}>Options</th><th style={{ width: 74 }}>Required</th><th style={{ width: 74 }}>Watched</th><th style={{ width: 40 }} /></tr></thead>
                  <tbody>
                    {form.fields.map((r, i) => (
                      <tr key={r.id}>
                        <td><input className="field sm num" value={r.key} onChange={(e) => setRow(r.id, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} aria-label={`Field ${i + 1} key`} /></td>
                        <td><input className="field sm" value={r.label} onChange={(e) => setRow(r.id, { label: e.target.value })} aria-label={`Field ${i + 1} label`} /></td>
                        <td><select className="field sm" value={r.type} onChange={(e) => setRow(r.id, { type: e.target.value as RegisterField['type'] })} aria-label={`Field ${i + 1} type`}>{FIELD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                        <td><input className="field sm" value={r.options} disabled={r.type !== 'select'} placeholder={r.type === 'select' ? 'One, Two, Three' : ''} onChange={(e) => setRow(r.id, { options: e.target.value })} aria-label={`Field ${i + 1} options, separated by commas`} /></td>
                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.required} onChange={(e) => setRow(r.id, { required: e.target.checked })} aria-label={`Field ${i + 1} is required`} /></td>
                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.alert && r.type === 'date'} disabled={r.type !== 'date'} title={r.type === 'date' ? 'Raise a warning as this date approaches' : 'Only a date can be watched'} onChange={(e) => setRow(r.id, { alert: e.target.checked })} aria-label={`Field ${i + 1} is a watched date`} /></td>
                        <td><button className="btn ghost icon sm" onClick={() => set({ fields: form.fields.filter((x) => x.id !== r.id) })} aria-label={`Remove field ${i + 1}`}><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 text-[11.5px] text-muted">Options are typed as text separated by commas. Removing a field does not erase what was already recorded on existing items; it only stops asking for it.</div>
          </div>

          {problems.length > 0 && (form.key !== '' || form.name !== '') && <Note kind="warn"><ul className="m-0 list-disc pl-4">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
        </div>
      )}
    </Drawer>
  )
}
