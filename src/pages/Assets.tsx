import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { BadgeCheck, Boxes, Calculator, ExternalLink, FolderTree, Plus, Save, Scale, XCircle } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Account, Company, Confidentiality, ID } from '@/engine/types'
import type { AssetCategory, AssetCategoryInput, DepreciationLine, DepreciationRun, FixedAsset, FixedAssetInput } from '@/engine/opsTypes'
import { assetReconciliation, bookValue, depreciationForecast } from '@/engine/ops'
import { D, ZERO, fmtMoney, round2, sum } from '@/lib/money'
import { addMonths, fmtDate, fmtDateTime, fmtMonth, startOfMonth, today } from '@/lib/dates'
import { ledgerLink } from '@/lib/data'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { ProposedEntries, ProposedNote, Stat, useAccountName, usePartyName, useUnitName } from '@/ui/ops'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart } from '@/ui/charts'

// =====================================================================
// Fixed assets: the register, monthly depreciation, the comparison of
// the register with the books, and the categories that drive both.
// Depreciation is calculated here and PROPOSED as an accounting entry;
// it reaches the ledger only after a second person approves it.
// =====================================================================

const TAB_KEYS = ['register', 'depreciation', 'reconciliation', 'categories'] as const
type TabKey = typeof TAB_KEYS[number]
type Method = FixedAsset['method']

const METHOD_LABEL: Record<Method, string> = { slm: 'Straight line', wdv: 'Written down value', none: 'Not depreciated' }
const methodLabel = (m: string) => METHOD_LABEL[m as Method] ?? m
const RUN_LABEL: Record<DepreciationRun['status'], string> = { draft: 'draft', proposed: 'awaiting approval', posted: 'posted', reversed: 'reversed', cancelled: 'cancelled' }
const CONFIDENTIALITY: { key: Confidentiality; label: string }[] = [
  { key: 'internal', label: 'Internal' }, { key: 'confidential', label: 'Confidential' }, { key: 'highly_confidential', label: 'Highly confidential' },
  { key: 'restricted', label: 'Restricted' }, { key: 'super_admin_only', label: 'Super administrator only' },
]
const humanise = (s: string) => s.replace(/_/g, ' ')
const digits = (s: string) => s.replace(/[^\d.]/g, '')
const whole = (s: string) => s.replace(/[^\d]/g, '')
const foot = 'border-t border-line2 px-[14px] py-[10px]'
const NO_MANAGE = 'Your role does not include the permission to manage fixed assets (asset.manage).'

// ------------------------------------------------------------------ asset form (also used by the asset page)
interface AssetForm {
  company_id: ID; category_id: ID; name: string; description: string; acquisition_date: string; in_service_date: string
  cost: string; salvage_value: string; method: Method; life_months: string; wdv_rate: string; opening_accumulated: string
  org_unit_id: ID; custodian_party_id: ID; location: string; serial_no: string; vendor_party_id: ID; source_invoice_id: ID; warranty_until: string
  confidentiality: Confidentiality; notes: string
}
const blankAsset = (company: ID): AssetForm => ({
  company_id: company, category_id: '', name: '', description: '', acquisition_date: today(), in_service_date: '', cost: '', salvage_value: '', method: 'slm', life_months: '', wdv_rate: '',
  opening_accumulated: '', org_unit_id: '', custodian_party_id: '', location: '', serial_no: '', vendor_party_id: '', source_invoice_id: '', warranty_until: '', confidentiality: 'internal', notes: '',
})
const text = (v: Decimal.Value | null | undefined) => (v === null || v === undefined || v === '' ? '' : D(v).toString())
const fromAsset = (a: FixedAsset): AssetForm => ({
  company_id: a.company_id, category_id: a.category_id, name: a.name, description: a.description ?? '', acquisition_date: a.acquisition_date, in_service_date: a.in_service_date ?? '',
  cost: text(a.cost), salvage_value: text(a.salvage_value), method: a.method, life_months: a.life_months != null ? String(a.life_months) : '', wdv_rate: text(a.wdv_rate),
  opening_accumulated: D(a.opening_accumulated).isZero() ? '' : text(a.opening_accumulated), org_unit_id: a.org_unit_id ?? '', custodian_party_id: a.custodian_party_id ?? '', location: a.location ?? '',
  serial_no: a.serial_no ?? '', vendor_party_id: a.vendor_party_id ?? '', source_invoice_id: a.source_invoice_id ?? '', warranty_until: a.warranty_until ?? '', confidentiality: a.confidentiality, notes: a.notes ?? '',
})

/** Adds an asset to the register, or edits one. Registering an asset does not write to the ledger. */
export function AssetFormDrawer({ open, onClose, asset, companyIds, onSaved, onOpenCategories }: {
  open: boolean; onClose: () => void; asset?: FixedAsset | null; companyIds: ID[]; onSaved?: (id: ID) => void; onOpenCategories?: () => void
}) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const { act, busy } = useAction()
  const [f, setF] = useState<AssetForm>(() => blankAsset(companyIds[0] ?? ''))
  const set = (patch: Partial<AssetForm>) => setF((x) => ({ ...x, ...patch }))

  useEffect(() => {
    if (!open) return
    setF(asset ? fromAsset(asset) : blankAsset(companyIds.find((c) => can('asset.manage', c)) ?? companyIds[0] ?? ''))
  }, [open, asset?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useAsync<AssetCategory[]>(async () => (open && f.company_id ? api.listAssetCategories([f.company_id]) : []), [api, open, f.company_id])
  const bills = useAsync(async () => (open && f.company_id && f.vendor_party_id && can('bill.view', f.company_id)
    ? (await api.listInvoices({ companyIds: [f.company_id], docTypes: ['purchase_bill'], partyId: f.vendor_party_id })).filter((b) => b.status !== 'cancelled') : []), [api, open, f.company_id, f.vendor_party_id])
  const categories = (cats.data ?? []).filter((c) => c.company_id === f.company_id && (c.is_active || c.id === f.category_id)).sort((a, b) => a.name.localeCompare(b.name))
  const category = categories.find((c) => c.id === f.category_id)
  const company = companies.find((c) => c.id === f.company_id)
  const currency = company?.base_currency
  const companyOptions = companies.filter((c) => (c.status === 'active' && companyIds.includes(c.id)) || c.id === f.company_id)
  const people = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === f.company_id) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, f.company_id])
  const units = useMemo(() => orgUnits.filter((u) => u.company_id === f.company_id && (u.status === 'active' || u.id === f.org_unit_id)).sort((a, b) => a.type_key.localeCompare(b.type_key) || a.name.localeCompare(b.name)), [orgUnits, f.company_id, f.org_unit_id])
  const unitTypes = [...new Set(units.map((u) => u.type_key))]

  const pickCategory = (id: ID) => {
    const c = (cats.data ?? []).find((x) => x.id === id)
    if (!c) return set({ category_id: id })
    set({ category_id: id, method: c.method, life_months: c.life_months != null ? String(c.life_months) : '', wdv_rate: text(c.wdv_rate) })
  }

  const cost = D(f.cost)
  const residual = f.salvage_value.trim() !== '' ? D(f.salvage_value) : category ? round2(cost.times(category.salvage_pct).div(100)) : ZERO
  const opening = D(f.opening_accumulated)
  const depreciable = cost.minus(residual).minus(opening)
  const monthly = f.method === 'slm' && Number(f.life_months) > 0 ? round2(cost.minus(residual).div(Number(f.life_months)))
    : f.method === 'wdv' && D(f.wdv_rate).gt(0) ? round2(cost.minus(opening).times(D(f.wdv_rate)).div(1200)) : null

  const problems: string[] = []
  if (!f.company_id) problems.push('Choose the company.')
  if (!f.category_id) problems.push('Choose the category.')
  if (!f.name.trim()) problems.push('Give the asset a name.')
  if (!f.acquisition_date) problems.push('Enter the acquisition date.')
  if (cost.lte(0)) problems.push('Enter the cost.')
  if (cost.gt(0) && residual.gte(cost)) problems.push('The residual value must be lower than the cost.')
  if (cost.gt(0) && opening.gt(cost.minus(residual))) problems.push('Opening accumulated depreciation exceeds the depreciable amount.')
  if (f.method === 'slm' && !(Number(f.life_months) > 0)) problems.push('Straight-line depreciation needs a useful life in months.')
  if (f.method === 'wdv' && !D(f.wdv_rate).gt(0)) problems.push('Written-down-value depreciation needs an annual rate.')
  if (f.in_service_date && f.acquisition_date && f.in_service_date < f.acquisition_date) problems.push('The in-service date is before the acquisition date.')

  const allowed = !!f.company_id && can('asset.manage', f.company_id)
  const save = async () => {
    const input: FixedAssetInput = {
      id: asset?.id, company_id: f.company_id, name: f.name.trim(), category_id: f.category_id, description: f.description.trim() || null,
      acquisition_date: f.acquisition_date, in_service_date: f.in_service_date || null, cost: f.cost,
      ...(f.salvage_value.trim() !== '' ? { salvage_value: f.salvage_value } : {}),
      method: f.method, life_months: f.life_months ? Number(f.life_months) : null, wdv_rate: f.wdv_rate || null, opening_accumulated: f.opening_accumulated || 0,
      org_unit_id: f.org_unit_id || null, custodian_party_id: f.custodian_party_id || null, location: f.location.trim() || null, serial_no: f.serial_no.trim() || null,
      vendor_party_id: f.vendor_party_id || null, source_invoice_id: f.source_invoice_id || null, warranty_until: f.warranty_until || null, confidentiality: f.confidentiality, notes: f.notes.trim() || null,
    }
    const id = await act(() => api.saveAsset(input), asset ? 'Asset updated' : 'Asset added to the register')
    if (id) { onSaved?.(id); onClose() }
  }

  return (
    <Drawer open={open} onClose={onClose} width={680} title={asset ? `Edit ${asset.asset_no}` : 'Add asset'}
      subtitle={asset ? asset.name : 'The register records the asset. The purchase itself reaches the books through the vendor\'s bill or a journal.'}
      footer={<>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" disabled={busy || problems.length > 0 || !allowed} title={allowed ? undefined : NO_MANAGE} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {asset ? 'Save changes' : 'Add to register'}</button>
      </>}>
      {asset && <Note className="mb-4">Once depreciation has been proposed or posted for an asset, its cost, dates, category and method can no longer be changed. Custodian, location and notes stay editable.</Note>}
      {f.company_id && cats.data && categories.length === 0 && (
        <Note kind="warn" className="mb-4">
          {company?.name ?? 'This company'} has no asset category yet. A category names the ledgers an asset posts to and its default method.{' '}
          {onOpenCategories ? <button className="link" onClick={() => { onClose(); onOpenCategories() }}>Open the Categories tab</button> : 'Add one under Fixed assets → Categories.'}
        </Note>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <select className="field" value={f.company_id} disabled={!!asset} onChange={(e) => set({ company_id: e.target.value, category_id: '', org_unit_id: '', custodian_party_id: '', vendor_party_id: '', source_invoice_id: '' })}>
            <option value="">Choose…</option>{companyOptions.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Category" hint={category ? `Default: ${methodLabel(category.method)}${category.method === 'slm' && category.life_months ? `, ${category.life_months} months` : ''}${category.method === 'wdv' && category.wdv_rate != null ? `, ${D(category.wdv_rate)}% a year` : ''}` : 'Choosing a category fills the method, life and rate. They stay editable.'}>
          <select className="field" value={f.category_id} onChange={(e) => pickCategory(e.target.value)}>
            <option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
        <Field label="Name" className="sm:col-span-2"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="field" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Acquisition date"><input type="date" className="field" value={f.acquisition_date} onChange={(e) => set({ acquisition_date: e.target.value })} /></Field>
        <Field label="In-service date" hint="Depreciation starts from this date. Left empty, the acquisition date is used."><input type="date" className="field" value={f.in_service_date} min={f.acquisition_date || undefined} onChange={(e) => set({ in_service_date: e.target.value })} /></Field>
        <Field label={`Cost${currency ? ` (${currency})` : ''}`}><input className="field num" inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: digits(e.target.value) })} /></Field>
        <Field label="Residual value" hint={f.salvage_value.trim() === '' && category ? `Left empty, the category's ${D(category.salvage_pct)}% is used: ${fmtMoney(residual, { currency })}.` : 'The value expected at the end of the asset\'s life. It is never depreciated.'}>
          <input className="field num" inputMode="decimal" value={f.salvage_value} onChange={(e) => set({ salvage_value: digits(e.target.value) })} />
        </Field>
        <Field label="Method">
          <select className="field" value={f.method} onChange={(e) => set({ method: e.target.value as Method })}>
            {(['slm', 'wdv', 'none'] as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        {f.method === 'slm' && <Field label="Useful life in months"><input className="field num" inputMode="numeric" value={f.life_months} onChange={(e) => set({ life_months: whole(e.target.value) })} /></Field>}
        {f.method === 'wdv' && <Field label="Annual rate %"><input className="field num" inputMode="decimal" value={f.wdv_rate} onChange={(e) => set({ wdv_rate: digits(e.target.value) })} /></Field>}
        {f.method === 'none' && <Field label="Depreciation"><div className="field flex items-center text-muted">No depreciation is calculated</div></Field>}
        <Field label="Opening accumulated depreciation" hint="For assets brought in from an earlier system"><input className="field num" inputMode="decimal" value={f.opening_accumulated} onChange={(e) => set({ opening_accumulated: digits(e.target.value) })} /></Field>
        <Field label="Department or location" hint={units.length ? 'Depreciation is charged to this dimension.' : 'This company has no organisation units.'}>
          <select className="field" value={f.org_unit_id} onChange={(e) => set({ org_unit_id: e.target.value })}>
            <option value="">—</option>
            {unitTypes.map((t) => <optgroup key={t} label={humanise(t)}>{units.filter((u) => u.type_key === t).map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Custodian">
          <select className="field" value={f.custodian_party_id} onChange={(e) => set({ custodian_party_id: e.target.value })}>
            <option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
          </select>
        </Field>
        <Field label="Location"><input className="field" value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Where the asset is kept" /></Field>
        <Field label="Serial number"><input className="field num" value={f.serial_no} onChange={(e) => set({ serial_no: e.target.value })} /></Field>
        <Field label="Vendor">
          <select className="field" value={f.vendor_party_id} onChange={(e) => set({ vendor_party_id: e.target.value, source_invoice_id: '' })}>
            <option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
          </select>
        </Field>
        <Field label="Bought on bill" hint={!f.vendor_party_id ? 'Choose the vendor to see their bills' : bills.data && !bills.data.length ? 'No bill from this vendor is recorded' : 'Links the asset to the bill it was bought on'}>
          <select className="field" value={f.source_invoice_id} disabled={!f.vendor_party_id} onChange={(e) => set({ source_invoice_id: e.target.value })}>
            <option value="">—</option>{(bills.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.doc_no ?? 'draft'} · {fmtDate(b.doc_date)} · {fmtMoney(b.total, { currency: b.currency })}</option>)}
          </select>
        </Field>
        <Field label="Warranty until"><input type="date" className="field" value={f.warranty_until} onChange={(e) => set({ warranty_until: e.target.value })} /></Field>
        <Field label="Confidentiality">
          <select className="field" value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value as Confidentiality })}>
            {CONFIDENTIALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="field" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>

      {cost.gt(0) && (
        <Panel className="mt-4 p-4 text-[12.5px]" lit={false}>
          <div className="eyebrow mb-2">What this means</div>
          <div className="flex justify-between py-0.5"><span className="text-ink2">Amount still to be depreciated</span><Money value={Decimal.max(depreciable, 0)} currency={currency} /></div>
          {monthly && <div className="flex justify-between py-0.5"><span className="text-ink2">Indicative charge for a full month</span><Money value={monthly} currency={currency} /></div>}
          <div className="mt-1.5 text-[11.5px] text-muted">
            {f.method === 'slm' ? '(Cost − residual value) ÷ useful life in months.' : f.method === 'wdv' ? 'Book value × annual rate ÷ 12; the charge falls as the book value falls.' : 'This asset is recorded in the register and is not depreciated.'}
            {' '}The figure posted is the one calculated by the monthly depreciation run.
          </div>
        </Panel>
      )}
      {problems.length > 0 && (f.name.trim() || f.cost) && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}

// ------------------------------------------------------------------ page
export default function Assets() {
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const tab: TabKey = TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'register'
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  useApp((s) => s.session)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const [adding, setAdding] = useState(false)

  const main = useAsync(async () => {
    const [assets, categories] = await Promise.all([api.listAssets(ids), api.listAssetCategories(ids)])
    return { assets, categories }
  }, [api, idsKey])

  const scoped = companies.filter((c) => ids.includes(c.id))
  const currencies = [...new Set(scoped.map((c) => c.base_currency))]
  const manageIds = scoped.filter((c) => c.status === 'active' && can('asset.manage', c.id)).map((c) => c.id)
  const go = (k: TabKey) => setSp(k === 'register' ? {} : { tab: k }, { replace: true })

  // while another selection is loading, never show records of companies that are no longer selected
  const d = useMemo(() => (main.data ? { assets: main.data.assets.filter((a) => ids.includes(a.company_id)), categories: main.data.categories.filter((c) => ids.includes(c.company_id)) } : undefined), [main.data, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = (d?.assets ?? []).filter((a) => a.status === 'active')
  const gone = (d?.assets ?? []).filter((a) => a.status !== 'active')
  const cost = sum(active.map((a) => a.cost))
  const accumulated = sum(active.map((a) => a.accumulated_depreciation))
  const book = sum(active.map((a) => bookValue(a)))
  const single = currencies.length === 1 ? currencies[0] : undefined

  if (!can('asset.view')) {
    return (
      <div>
        <PageHeader eyebrow="Operations" title="Fixed assets" />
        <Panel><Empty icon={<Boxes size={20} />} title="The asset register is not available to your role" body="Your role does not include the permission to view fixed assets (asset.view) in the selected companies." /></Panel>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Fixed assets" truth="ACTUAL"
        subtitle={<>
          The register of what the business owns, its depreciation and its agreement with the books · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}
          {mode === 'demo' && <span className="ml-2 align-middle"><Truth state="DEMO" /></span>}
        </>}
        actions={<button className="btn primary" disabled={manageIds.length === 0} title={manageIds.length ? 'Add an asset to the register' : NO_MANAGE} onClick={() => setAdding(true)}><Plus size={15} /> Add asset</button>} />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading the asset register" /></Panel>}

      {d && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Active assets" value={active.length} count sub="in the register" onClick={() => go('register')} />
            <Stat label="Cost" value={cost.toString()} currency={single} sub="ACTUAL · as recorded in the register" />
            <Stat label="Accumulated depreciation" value={accumulated.toString()} currency={single} sub="ACTUAL · posted depreciation and impairment" />
            <Stat label="Book value" value={book.toString()} currency={single} tone="gold" sub="ACTUAL · cost less accumulated depreciation" />
            <Stat label="Disposed or written off" value={gone.length} count sub={`${gone.filter((a) => a.status === 'disposed').length} disposed · ${gone.filter((a) => a.status === 'written_off').length} written off`} />
          </div>
          {currencies.length > 1 && <Note kind="warn" className="mb-4">The selected companies keep their books in different currencies ({currencies.join(', ')}). The totals above add the figures as recorded, without conversion. Select one company for a total in a single currency.</Note>}

          <Tabs<TabKey> value={tab} onChange={go} tabs={[
            { key: 'register', label: 'Register', count: d.assets.length },
            { key: 'depreciation', label: 'Depreciation' },
            { key: 'reconciliation', label: 'Reconciliation' },
            { key: 'categories', label: 'Categories', count: d.categories.length },
          ]} />

          {tab === 'register' && <RegisterTab assets={d.assets} categories={d.categories} canAdd={manageIds.length > 0} onAdd={() => setAdding(true)} />}
          {tab === 'depreciation' && <DepreciationTab companies={scoped} assets={d.assets} />}
          {tab === 'reconciliation' && <ReconciliationTab ids={ids} assets={d.assets} categories={d.categories} />}
          {tab === 'categories' && <CategoriesTab companies={scoped} assets={d.assets} categories={d.categories} />}
        </>
      )}

      <AssetFormDrawer open={adding} onClose={() => setAdding(false)} companyIds={manageIds} onOpenCategories={() => go('categories')} />
    </div>
  )
}

// ------------------------------------------------------------------ register
function RegisterTab({ assets, categories, canAdd, onAdd }: { assets: FixedAsset[]; categories: AssetCategory[]; canAdd: boolean; onAdd: () => void }) {
  const nav = useNavigate()
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const unitName = useUnitName()
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const coById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const catName = (id: ID) => catById.get(id)?.name ?? '—'
  const ccy = (a: FixedAsset) => coById.get(a.company_id)?.base_currency

  const needle = q.trim().toLowerCase()
  const rows = assets.filter((a) => (!status || a.status === status) && (!category || a.category_id === category)
    && (!needle || [a.asset_no, a.name, a.serial_no, a.location, a.tag_code, a.description, a.custodian_party_id ? partyName(a.custodian_party_id) : ''].some((v) => (v ?? '').toLowerCase().includes(needle))))
  const filtered = Boolean(status || category || needle)
  const oneCurrency = new Set(rows.map((a) => ccy(a))).size <= 1

  const columns: Column<FixedAsset>[] = [
    { key: 'no', header: 'Asset no', render: (a) => <span className="num text-[12.5px] text-gold">{a.asset_no}</span>, sort: (a) => a.asset_no, csv: (a) => a.asset_no },
    { key: 'name', header: 'Name', render: (a) => <div className="min-w-0"><div className="truncate text-ink">{a.name}</div>{a.serial_no && <div className="num text-[11px] text-muted">{a.serial_no}</div>}</div>, sort: (a) => a.name.toLowerCase(), csv: (a) => a.name },
    { key: 'category', header: 'Category', render: (a) => <span className="text-ink2">{catName(a.category_id)}</span>, sort: (a) => catName(a.category_id), csv: (a) => catName(a.category_id) },
    { key: 'company', header: 'Company', render: (a) => <span className="text-ink2" title={coById.get(a.company_id)?.name}>{coById.get(a.company_id)?.code ?? '—'}</span>, sort: (a) => coById.get(a.company_id)?.name ?? '', csv: (a) => coById.get(a.company_id)?.name ?? '' },
    { key: 'unit', header: 'Department / location', render: (a) => <div className="min-w-0 text-[12.5px]"><div className="truncate text-ink2">{unitName(a.org_unit_id)}</div>{a.location && <div className="truncate text-[11px] text-muted">{a.location}</div>}</div>, sort: (a) => unitName(a.org_unit_id), csv: (a) => [a.org_unit_id ? unitName(a.org_unit_id) : '', a.location ?? ''].filter(Boolean).join(' · ') },
    { key: 'custodian', header: 'Custodian', render: (a) => <span className="text-ink2">{partyName(a.custodian_party_id)}</span>, sort: (a) => partyName(a.custodian_party_id), csv: (a) => (a.custodian_party_id ? partyName(a.custodian_party_id) : '') },
    { key: 'acquired', header: 'Acquired', render: (a) => <span className="num text-[12.5px]">{fmtDate(a.acquisition_date)}</span>, sort: (a) => a.acquisition_date, csv: (a) => a.acquisition_date },
    { key: 'method', header: 'Method', render: (a) => <span className="text-[12.5px] text-ink2">{methodLabel(a.method)}</span>, sort: (a) => a.method, csv: (a) => methodLabel(a.method) },
    { key: 'cost', header: 'Cost', align: 'right', render: (a) => <Money value={a.cost} currency={ccy(a)} />, sort: (a) => D(a.cost).toNumber(), csv: (a) => D(a.cost).toFixed(2) },
    { key: 'accum', header: 'Accumulated', align: 'right', render: (a) => <Money value={a.accumulated_depreciation} currency={ccy(a)} dim />, sort: (a) => D(a.accumulated_depreciation).toNumber(), csv: (a) => D(a.accumulated_depreciation).toFixed(2) },
    { key: 'book', header: 'Book value', align: 'right', render: (a) => <Money value={bookValue(a)} currency={ccy(a)} className="text-ink" />, sort: (a) => bookValue(a).toNumber(), csv: (a) => bookValue(a).toFixed(2) },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} />, sort: (a) => a.status, csv: (a) => humanise(a.status) },
  ]

  return (
    <Panel lit={false}>
      <DataTable<FixedAsset> columns={columns} rows={rows} rowKey={(a) => a.id} onRow={(a) => nav('/assets/' + a.id)} exportName="asset-register" initialSort={{ key: 'no', dir: 'asc' }}
        toolbar={<>
          <input className="field sm" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, serial, location" aria-label="Search the register" />
          <select className="field sm" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">Every status</option><option value="active">Active</option><option value="disposed">Disposed</option><option value="written_off">Written off</option>
          </select>
          <select className="field sm" style={{ width: 210 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="">Every category</option>{[...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {filtered && <button className="btn sm ghost" onClick={() => { setQ(''); setStatus(''); setCategory('') }}>Clear filters</button>}
        </>}
        footer={oneCurrency ? <tr>
          <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={8}>Total · {rows.length.toLocaleString()} asset{rows.length === 1 ? '' : 's'}{filtered ? ' in this filter' : ''}</td>
          <td className={cx(foot, 'r')}><Money value={sum(rows.map((a) => a.cost))} currency={rows[0] ? ccy(rows[0]) : undefined} /></td>
          <td className={cx(foot, 'r')}><Money value={sum(rows.map((a) => a.accumulated_depreciation))} currency={rows[0] ? ccy(rows[0]) : undefined} dim /></td>
          <td className={cx(foot, 'r')}><Money value={sum(rows.map((a) => bookValue(a)))} currency={rows[0] ? ccy(rows[0]) : undefined} className="font-medium text-ink" /></td>
          <td className={foot} />
        </tr> : undefined}
        empty={{
          title: filtered ? 'No asset matches this filter' : 'No asset is registered',
          body: filtered ? 'Clear the filter to see the whole register.' : 'Add the assets the business owns. Each one needs a category, which names the ledgers it posts to and its depreciation method.',
          icon: <Boxes size={20} />,
          action: filtered ? <button className="btn sm" onClick={() => { setQ(''); setStatus(''); setCategory('') }}>Clear filters</button>
            : <button className="btn sm" disabled={!canAdd} title={canAdd ? undefined : NO_MANAGE} onClick={onAdd}><Plus size={13} /> Add asset</button>,
        }} />
    </Panel>
  )
}

// ------------------------------------------------------------------ depreciation
function DepreciationTab({ companies, assets }: { companies: Company[]; assets: FixedAsset[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const { act, busy } = useAction()
  const key = companies.map((c) => c.id).join(',')
  const [company, setCompany] = useState<ID>(companies[0]?.id ?? '')
  const [runId, setRunId] = useState<ID | null>(null)
  const [month, setMonth] = useState('')
  useEffect(() => { if (!companies.some((c) => c.id === company)) { setCompany(companies[0]?.id ?? ''); setRunId(null); setMonth('') } }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const runs = useAsync<DepreciationRun[]>(async () => (company ? api.listDepreciationRuns([company]) : []), [api, company])
  const runList = useMemo(() => (runs.data ?? []).filter((r) => r.company_id === company), [runs.data, company])
  const run = runList.find((r) => r.id === runId) ?? null
  const lines = useAsync<DepreciationLine[]>(async () => (runId ? api.getDepreciationLines({ runId }) : []), [api, runId])

  // lines of the run being shown only: a slower answer for another run is never displayed under this one
  const runLines = lines.data && !(lines.loading && lines.data.some((l) => l.run_id !== runId)) ? lines.data.filter((l) => l.run_id === runId) : undefined
  const co = companies.find((c) => c.id === company)
  const currency = co?.base_currency
  const allowed = !!company && can('asset.manage', company)
  const own = useMemo(() => assets.filter((a) => a.company_id === company), [assets, company])
  const assetById = useMemo(() => new Map(own.map((a) => [a.id, a])), [own])

  // the month a person would normally calculate next: the one after the latest run still standing
  const live = runList.filter((r) => ['draft', 'proposed', 'posted'].includes(r.status)).map((r) => r.period_month).sort()
  const firstInService = own.filter((a) => a.status === 'active' && a.method !== 'none').map((a) => a.in_service_date ?? a.acquisition_date).sort()[0]
  const suggested = (live.length ? addMonths(live[live.length - 1], 1) : startOfMonth(firstInService ?? today())).slice(0, 7)
  const chosen = month || suggested

  const calculate = async () => {
    const id = await act(() => api.createDepreciationRun(company, chosen + '-01'), `Depreciation calculated for ${fmtMonth(chosen + '-01')}. Nothing has been posted.`)
    if (id) { setRunId(id); setMonth('') }
  }

  // FORECAST: starts after the latest posted month so that a month already in the books is not counted twice
  const posted = runList.filter((r) => r.status === 'posted').map((r) => r.period_month).sort()
  const thisMonth = startOfMonth(today())
  const from = posted.length && addMonths(posted[posted.length - 1], 1) > thisMonth ? addMonths(posted[posted.length - 1], 1) : thisMonth
  const forecast = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => addMonths(from, i))
    const totals = months.map(() => ZERO)
    for (const a of own) depreciationForecast(a, from, 12).forEach((m, i) => { totals[i] = totals[i].plus(m.amount) })
    return { months, totals, total: sum(totals) }
  }, [own, from])

  const runColumns: Column<DepreciationRun>[] = [
    { key: 'month', header: 'Month', render: (r) => <span className="num text-ink">{fmtMonth(r.period_month)}</span>, sort: (r) => r.period_month, csv: (r) => r.period_month.slice(0, 7) },
    { key: 'assets', header: 'Assets', align: 'right', render: (r) => <span className="num">{r.asset_count}</span>, sort: (r) => r.asset_count, csv: (r) => r.asset_count },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <Money value={r.total} currency={currency} />, sort: (r) => D(r.total).toNumber(), csv: (r) => D(r.total).toFixed(2) },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} label={RUN_LABEL[r.status]} />, sort: (r) => r.status, csv: (r) => RUN_LABEL[r.status] },
    { key: 'calculated', header: 'Calculated', render: (r) => <span className="num text-[12px] text-ink2">{fmtDateTime(r.created_at)}</span>, sort: (r) => r.created_at, csv: (r) => r.created_at },
    {
      key: 'journal', header: 'Accounting entry', align: 'right',
      render: (r) => (r.journal_id ? <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); nav('/journals/' + r.journal_id) }}><ExternalLink size={13} /> Open</button> : <span className="text-[12px] text-muted">none yet</span>),
    },
  ]
  const lineColumns: Column<DepreciationLine>[] = [
    {
      key: 'asset', header: 'Asset', sort: (l) => assetById.get(l.asset_id)?.asset_no ?? '', csv: (l) => { const a = assetById.get(l.asset_id); return a ? `${a.asset_no} ${a.name}` : 'Asset not shared with you' },
      render: (l) => { const a = assetById.get(l.asset_id); return a ? <div className="min-w-0"><div className="truncate text-ink">{a.name}</div><div className="num text-[11px] text-gold">{a.asset_no}</div></div> : <span className="text-muted">Asset not shared with you</span> },
    },
    { key: 'opening', header: 'Opening book value', align: 'right', render: (l) => <Money value={l.opening_book_value} currency={currency} />, sort: (l) => D(l.opening_book_value).toNumber(), csv: (l) => D(l.opening_book_value).toFixed(2) },
    { key: 'method', header: 'Method', render: (l) => <span className="text-[12.5px] text-ink2">{methodLabel(l.method)}</span>, sort: (l) => l.method, csv: (l) => methodLabel(l.method) },
    { key: 'amount', header: 'Depreciation', align: 'right', render: (l) => <Money value={l.amount} currency={currency} className="text-ink" />, sort: (l) => D(l.amount).toNumber(), csv: (l) => D(l.amount).toFixed(2) },
    { key: 'basis', header: 'How it was calculated', render: (l) => <span className="num text-[12px] text-ink2">{l.basis}</span>, csv: (l) => l.basis },
  ]

  if (!companies.length) return <Panel><Empty icon={<Calculator size={20} />} title="No company is selected" body="Select a company to calculate its depreciation." /></Panel>

  return (
    <div className="space-y-4">
      <Panel className="p-4" lit={false}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Company" className="min-w-[240px]">
            <select className="field" value={company} onChange={(e) => { setCompany(e.target.value); setRunId(null); setMonth('') }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Month to calculate">
            <input type="month" className="field num" value={chosen} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <button className="btn primary" disabled={busy || !allowed || !chosen} title={allowed ? 'Calculates one month for every asset in service. Nothing is posted.' : NO_MANAGE} onClick={() => void calculate()}>
            {busy ? <Spinner /> : <Calculator size={15} />} Calculate a month
          </button>
        </div>
        <div className="mt-3 text-[12px] text-muted">Months are calculated in order, one company at a time, so that each month starts from the correct book value. Calculating a month writes nothing to the ledger.</div>
      </Panel>

      {runs.error && <ErrorBox message={runs.error} retry={runs.reload} />}
      <Section title="Depreciation runs">
        <Panel lit={false}>
          {!runs.data && !runs.error ? <Loading rows={4} label="Loading depreciation runs" /> : (
            <DataTable<DepreciationRun> columns={runColumns} rows={runList} rowKey={(r) => r.id} onRow={(r) => setRunId(r.id === runId ? null : r.id)} pageSize={12}
              exportName={`depreciation-runs-${co?.code ?? ''}`} rowClass={(r) => (r.id === runId ? 'bg-surface2' : undefined)}
              empty={{ title: 'No month has been calculated', body: 'Choose the first month above and calculate it. The result is a draft you can review line by line before proposing its accounting entry.', icon: <Calculator size={20} /> }} />
          )}
        </Panel>
      </Section>

      {run && (
        <Section title={`${fmtMonth(run.period_month)} · line by line`} right={<StatusChip status={run.status} label={RUN_LABEL[run.status]} />}>
          {run.status === 'draft' && (
            <>
              <ProposedNote>Proposing prepares one accounting entry for the month: depreciation expense is debited and accumulated depreciation is credited. It reaches the ledger only after a second person approves it in the approval inbox.</ProposedNote>
              <div className="no-print mb-3 flex flex-wrap gap-2">
                <button className="btn good" disabled={busy || !allowed || D(run.total).lte(0)} title={!allowed ? NO_MANAGE : D(run.total).lte(0) ? 'There is nothing to depreciate in this month' : undefined}
                  onClick={() => void act(() => api.proposeDepreciationRun(run.id), 'Accounting entry proposed — awaiting approval')}><BadgeCheck size={15} /> Propose the accounting entry</button>
                <button className="btn danger" disabled={busy || !allowed} title={allowed ? 'Discards this calculation. Nothing has been posted.' : NO_MANAGE}
                  onClick={() => void act(() => api.cancelDepreciationRun(run.id), 'Run cancelled')}><XCircle size={15} /> Cancel run</button>
              </div>
            </>
          )}
          {run.status === 'proposed' && <Note kind="warn" className="mb-3">The accounting entry for this month is awaiting approval. Book values change only when it is posted.</Note>}
          {run.status === 'reversed' && <Note className="mb-3">The accounting entry for this month was posted and later reversed. The depreciation has been taken back out of the book values.</Note>}
          <Panel lit={false}>
            {lines.error ? <ErrorBox message={lines.error} retry={lines.reload} /> : !runLines ? <Loading rows={4} /> : (
              <DataTable<DepreciationLine> columns={lineColumns} rows={runLines} rowKey={(l) => l.id} onRow={(l) => { if (assetById.has(l.asset_id)) nav('/assets/' + l.asset_id) }}
                exportName={`depreciation-${co?.code ?? ''}-${run.period_month.slice(0, 7)}`} initialSort={{ key: 'asset', dir: 'asc' }}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={3}>Total · {runLines.length} asset{runLines.length === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r')}><Money value={sum(runLines.map((l) => l.amount))} currency={currency} className="font-medium text-ink" /></td>
                  <td className={foot} />
                </tr>}
                empty={{ title: 'Nothing to depreciate in this month', body: 'No asset of this company was in service with an amount left to depreciate.', icon: <Calculator size={20} /> }} />
            )}
          </Panel>
          <ProposedEntries className="mt-4" companyIds={[company]} sourceId={run.id} sources={['depreciation']} />
        </Section>
      )}

      <Section title="Depreciation in the next 12 months" right={<Truth state="FORECAST" />}>
        <Panel className="p-5" lit={false}>
          {forecast.total.isZero() ? (
            <Empty icon={<Calculator size={20} />} title="Nothing to forecast" body="No active asset of this company has an amount left to depreciate under its recorded method." />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[12.5px] text-ink2">{fmtMonth(forecast.months[0])} to {fmtMonth(forecast.months[11])}</div>
                <div className="text-[12.5px] text-ink2">Twelve months in total <Money value={forecast.total} currency={currency} className="ml-1 text-ink" /></div>
              </div>
              <BarChart height={230} data={forecast.months.map((m, i) => ({ label: fmtMonth(m), values: [{ key: 'Forecast depreciation', value: forecast.totals[i].toNumber(), color: 'var(--violet)' }] }))} />
            </>
          )}
          <div className="mt-3 text-[12px] text-muted">Calculated from each asset's recorded method. Additions and disposals not yet recorded are not included.</div>
        </Panel>
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ reconciliation
type ReconRow = ReturnType<typeof assetReconciliation>[number]

function ReconciliationTab({ ids, assets, categories }: { ids: ID[]; assets: FixedAsset[]; categories: AssetCategory[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const companies = useApp((s) => s.companies)
  const idsKey = ids.join(',')
  const asOf = today()
  const balances = useAsync(() => api.ledgerBalances(ids, '1990-01-01', asOf), [api, idsKey, asOf])
  const coById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const rows = useMemo(() => (balances.data ? assetReconciliation(assets, categories, balances.data, accounts.filter((a) => ids.includes(a.company_id))) : []), [balances.data, assets, categories, accounts, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const differing = rows.filter((r) => !r.difference.isZero())
  const ccy = (r: ReconRow) => coById.get(r.company_id)?.base_currency

  const columns: Column<ReconRow>[] = [
    { key: 'ledger', header: 'Ledger', render: (r) => <span><span className="num mr-1.5 text-[11.5px] text-muted">{r.code}</span><span className="text-ink">{r.name}</span></span>, sort: (r) => r.code, csv: (r) => `${r.code} ${r.name}` },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2" title={coById.get(r.company_id)?.name}>{coById.get(r.company_id)?.code ?? '—'}</span>, sort: (r) => coById.get(r.company_id)?.name ?? '', csv: (r) => coById.get(r.company_id)?.name ?? '' },
    { key: 'kind', header: 'Kind', render: (r) => <span className={cx('chip', r.kind === 'cost' ? 'cyan' : '')}>{r.kind === 'cost' ? 'cost' : 'accumulated depreciation'}</span>, sort: (r) => r.kind, csv: (r) => (r.kind === 'cost' ? 'cost' : 'accumulated depreciation') },
    { key: 'register', header: 'In the register', align: 'right', render: (r) => <Money value={r.register} currency={ccy(r)} />, sort: (r) => r.register.toNumber(), csv: (r) => r.register.toFixed(2) },
    { key: 'books', header: 'In the ledger', align: 'right', render: (r) => <Money value={r.ledger} currency={ccy(r)} />, sort: (r) => r.ledger.toNumber(), csv: (r) => r.ledger.toFixed(2) },
    {
      key: 'difference', header: 'Difference', align: 'right', sort: (r) => r.difference.abs().toNumber(), csv: (r) => r.difference.toFixed(2),
      render: (r) => (r.difference.isZero() ? <span className="chip pos">agrees</span> : <Money value={r.difference} currency={ccy(r)} sign className="font-medium text-warn" />),
    },
    { key: 'assets', header: 'Assets', align: 'right', render: (r) => (r.kind === 'cost' ? <span className="num">{r.assets}</span> : <span className="text-muted">—</span>), sort: (r) => r.assets, csv: (r) => (r.kind === 'cost' ? r.assets : '') },
  ]

  return (
    <div className="space-y-4">
      <Note kind={differing.length ? 'warn' : 'info'}>
        A difference means the register and the books disagree. It is shown, never hidden. Typical causes: an asset bought but not registered, or a manual journal to a fixed-asset ledger.
      </Note>
      {balances.error && <ErrorBox message={balances.error} retry={balances.reload} />}
      {!balances.error && !balances.data && <Panel><Loading rows={5} label="Comparing the register with the ledger" /></Panel>}
      {balances.data && (
        <>
          <Panel lit={false}>
            <DataTable<ReconRow> columns={columns} rows={rows} rowKey={(r) => r.account_id} onRow={(r) => nav(ledgerLink({ accounts: [r.account_id], to: asOf }))} exportName="asset-register-reconciliation"
              initialSort={{ key: 'ledger', dir: 'asc' }} rowClass={(r) => (r.difference.isZero() ? undefined : 'bg-warnsoft')}
              toolbar={<span className="text-[12.5px] text-ink2">As at {fmtDate(asOf)} · {rows.length} ledger{rows.length === 1 ? '' : 's'} · {differing.length ? <span className="text-warn">{differing.length} with a difference</span> : <span className="text-pos">register and books agree</span>}</span>}
              empty={{ title: 'Nothing to compare', body: 'No asset is registered and no fixed-asset ledger carries a balance in the selected companies.', icon: <Scale size={20} /> }} />
          </Panel>
          <div className="text-[11.5px] text-muted">
            Register figures are the cost and accumulated depreciation of active assets, grouped by the ledgers named on each asset's category. Ledger figures are the balances of posted entries up to {fmtDate(asOf)}. Difference = register − ledger. Click a row to open the ledger.
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ categories
interface CategoryForm { id?: ID; company_id: ID; name: string; asset_account_id: ID; accum_account_id: ID; expense_account_id: ID; method: Method; life_months: string; wdv_rate: string; salvage_pct: string; is_active: boolean }

function CategoriesTab({ companies, assets, categories }: { companies: Company[]; assets: FixedAsset[]; categories: AssetCategory[] }) {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const [form, setForm] = useState<CategoryForm | null>(null)
  const set = (patch: Partial<CategoryForm>) => setForm((x) => (x ? { ...x, ...patch } : x))

  const coById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const manage = companies.filter((c) => c.status === 'active' && can('asset.manage', c.id))
  const used = useMemo(() => { const m = new Map<ID, number>(); for (const a of assets) m.set(a.category_id, (m.get(a.category_id) ?? 0) + 1); return m }, [assets])

  const openNew = () => setForm({ company_id: manage[0]?.id ?? '', name: '', asset_account_id: '', accum_account_id: '', expense_account_id: '', method: 'slm', life_months: '', wdv_rate: '', salvage_pct: '', is_active: true })
  const openEdit = (c: AssetCategory) => setForm({ id: c.id, company_id: c.company_id, name: c.name, asset_account_id: c.asset_account_id, accum_account_id: c.accum_account_id, expense_account_id: c.expense_account_id, method: c.method, life_months: c.life_months != null ? String(c.life_months) : '', wdv_rate: text(c.wdv_rate), salvage_pct: D(c.salvage_pct).isZero() ? '' : text(c.salvage_pct), is_active: c.is_active })

  const posting = (f: (a: Account) => boolean, keep: ID) => accounts.filter((a) => a.company_id === form?.company_id && !a.is_group && ((a.is_active && f(a)) || a.id === keep)).sort((a, b) => a.code.localeCompare(b.code))
  const assetLedgers = form ? posting((a) => a.subtype === 'fixed_asset', form.asset_account_id) : []
  const accumLedgers = form ? posting((a) => a.subtype === 'accumulated_depreciation', form.accum_account_id) : []
  const expenseLedgers = form ? posting((a) => a.type === 'expense', form.expense_account_id) : []
  const depreciationLedgers = expenseLedgers.filter((a) => a.subtype === 'depreciation')
  const otherExpense = expenseLedgers.filter((a) => a.subtype !== 'depreciation')

  const problems: string[] = []
  if (form) {
    if (!form.company_id) problems.push('Choose the company.')
    if (!form.name.trim()) problems.push('Give the category a name.')
    if (!form.asset_account_id) problems.push('Choose the asset ledger.')
    if (!form.accum_account_id) problems.push('Choose the accumulated depreciation ledger.')
    if (!form.expense_account_id) problems.push('Choose the depreciation expense ledger.')
    if (form.method === 'slm' && !(Number(form.life_months) > 0)) problems.push('Straight-line depreciation needs a useful life in months.')
    if (form.method === 'wdv' && !D(form.wdv_rate).gt(0)) problems.push('Written-down-value depreciation needs an annual rate.')
    if (D(form.salvage_pct).gte(100)) problems.push('The residual percentage must be below 100.')
  }
  const allowed = !!form?.company_id && can('asset.manage', form.company_id)

  const save = async () => {
    if (!form) return
    const input: AssetCategoryInput = {
      id: form.id, company_id: form.company_id, name: form.name.trim(), asset_account_id: form.asset_account_id, accum_account_id: form.accum_account_id, expense_account_id: form.expense_account_id,
      method: form.method, life_months: form.life_months ? Number(form.life_months) : null, wdv_rate: form.wdv_rate || null, salvage_pct: form.salvage_pct || 0, is_active: form.is_active,
    }
    const id = await act(() => api.saveAssetCategory(input), form.id ? 'Category updated' : 'Category added')
    if (id) setForm(null)
  }

  const columns: Column<AssetCategory>[] = [
    { key: 'name', header: 'Category', render: (c) => <span className="text-ink">{c.name}</span>, sort: (c) => c.name.toLowerCase(), csv: (c) => c.name },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={coById.get(c.company_id)?.name}>{coById.get(c.company_id)?.code ?? '—'}</span>, sort: (c) => coById.get(c.company_id)?.name ?? '', csv: (c) => coById.get(c.company_id)?.name ?? '' },
    { key: 'asset', header: 'Asset ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.asset_account_id)}</span>, sort: (c) => accountName(c.asset_account_id), csv: (c) => accountName(c.asset_account_id) },
    { key: 'accum', header: 'Accumulated depreciation ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.accum_account_id)}</span>, sort: (c) => accountName(c.accum_account_id), csv: (c) => accountName(c.accum_account_id) },
    { key: 'expense', header: 'Expense ledger', render: (c) => <span className="text-[12.5px] text-ink2">{accountName(c.expense_account_id)}</span>, sort: (c) => accountName(c.expense_account_id), csv: (c) => accountName(c.expense_account_id) },
    { key: 'method', header: 'Method', render: (c) => <span className="text-ink2">{methodLabel(c.method)}</span>, sort: (c) => c.method, csv: (c) => methodLabel(c.method) },
    { key: 'life', header: 'Life (months)', align: 'right', render: (c) => (c.life_months != null ? <span className="num">{c.life_months}</span> : <span className="text-muted">—</span>), sort: (c) => c.life_months ?? 0, csv: (c) => c.life_months ?? '' },
    { key: 'rate', header: 'Rate % a year', align: 'right', render: (c) => (c.wdv_rate != null ? <span className="num">{D(c.wdv_rate).toString()}</span> : <span className="text-muted">—</span>), sort: (c) => D(c.wdv_rate).toNumber(), csv: (c) => (c.wdv_rate != null ? D(c.wdv_rate).toString() : '') },
    { key: 'residual', header: 'Residual %', align: 'right', render: (c) => <span className="num">{D(c.salvage_pct).toString()}</span>, sort: (c) => D(c.salvage_pct).toNumber(), csv: (c) => D(c.salvage_pct).toString() },
    { key: 'assets', header: 'Assets', align: 'right', render: (c) => <span className="num">{used.get(c.id) ?? 0}</span>, sort: (c) => used.get(c.id) ?? 0, csv: (c) => used.get(c.id) ?? 0 },
    { key: 'active', header: 'Status', render: (c) => <StatusChip status={c.is_active ? 'active' : 'inactive'} />, sort: (c) => (c.is_active ? 'a' : 'i'), csv: (c) => (c.is_active ? 'active' : 'inactive') },
  ]

  return (
    <>
      <Panel lit={false}>
        <DataTable<AssetCategory> columns={columns} rows={categories} rowKey={(c) => c.id} exportName="asset-categories" initialSort={{ key: 'name', dir: 'asc' }}
          onRow={(c) => { if (can('asset.manage', c.company_id)) openEdit(c); else useApp.getState().toast('info', 'Read only', NO_MANAGE) }}
          toolbar={<button className="btn sm" disabled={manage.length === 0} title={manage.length ? 'Add a category' : NO_MANAGE} onClick={openNew}><Plus size={13} /> Add category</button>}
          empty={{
            title: 'No asset category yet', icon: <FolderTree size={20} />,
            body: 'A category names the three ledgers its assets use — the asset, its accumulated depreciation and the depreciation expense — and the default method. Add one before registering assets.',
            action: <button className="btn sm" disabled={manage.length === 0} title={manage.length ? undefined : NO_MANAGE} onClick={openNew}><Plus size={13} /> Add category</button>,
          }} />
      </Panel>

      <Drawer open={!!form} onClose={() => setForm(null)} width={600} title={form?.id ? 'Edit category' : 'Add category'} subtitle="The ledgers named here receive the accounting entries proposed for assets of this category."
        footer={<>
          <button className="btn ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || problems.length > 0 || !allowed} title={allowed ? undefined : NO_MANAGE} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save category</button>
        </>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company">
              <select className="field" value={form.company_id} disabled={!!form.id} onChange={(e) => set({ company_id: e.target.value, asset_account_id: '', accum_account_id: '', expense_account_id: '' })}>
                <option value="">Choose…</option>{companies.filter((c) => manage.some((m) => m.id === c.id) || c.id === form.company_id).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Vehicles" /></Field>
            <Field label="Asset ledger" className="sm:col-span-2" hint={assetLedgers.length ? 'Posting ledgers of the kind "fixed asset".' : 'This company has no posting ledger of the kind "fixed asset". Add one in the chart of accounts.'}>
              <select className="field" value={form.asset_account_id} onChange={(e) => set({ asset_account_id: e.target.value })}>
                <option value="">Choose…</option>{assetLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Accumulated depreciation ledger" className="sm:col-span-2" hint={accumLedgers.length ? 'Posting ledgers of the kind "accumulated depreciation".' : 'This company has no posting ledger of the kind "accumulated depreciation". Add one in the chart of accounts.'}>
              <select className="field" value={form.accum_account_id} onChange={(e) => set({ accum_account_id: e.target.value })}>
                <option value="">Choose…</option>{accumLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Depreciation expense ledger" className="sm:col-span-2">
              <select className="field" value={form.expense_account_id} onChange={(e) => set({ expense_account_id: e.target.value })}>
                <option value="">Choose…</option>
                {depreciationLedgers.length > 0 && <optgroup label="Depreciation">{depreciationLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>}
                {otherExpense.length > 0 && <optgroup label="Other expense ledgers">{otherExpense.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>}
              </select>
            </Field>
            <Field label="Default method">
              <select className="field" value={form.method} onChange={(e) => set({ method: e.target.value as Method })}>
                {(['slm', 'wdv', 'none'] as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </Field>
            <Field label="Residual %" hint="Share of the cost that is never depreciated."><input className="field num" inputMode="decimal" value={form.salvage_pct} onChange={(e) => set({ salvage_pct: digits(e.target.value) })} /></Field>
            <Field label="Useful life in months" hint="Used by the straight-line method."><input className="field num" inputMode="numeric" value={form.life_months} onChange={(e) => set({ life_months: whole(e.target.value) })} /></Field>
            <Field label="Written-down-value rate % a year" hint="Used by the written-down-value method."><input className="field num" inputMode="decimal" value={form.wdv_rate} onChange={(e) => set({ wdv_rate: digits(e.target.value) })} /></Field>
            {form.id && (
              <Field label="Status" className="sm:col-span-2" hint="An inactive category stays on its existing assets and is no longer offered for new ones.">
                <select className="field" value={form.is_active ? 'active' : 'inactive'} onChange={(e) => set({ is_active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select>
              </Field>
            )}
            {form.id && (used.get(form.id) ?? 0) > 0 && <Note className="sm:col-span-2">{used.get(form.id)} asset{used.get(form.id) === 1 ? '' : 's'} use this category. Changing the method, life or rate here affects only assets added afterwards; each asset keeps its own recorded method.</Note>}
            {problems.length > 0 && form.name.trim() && <Note kind="warn" className="sm:col-span-2"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
          </div>
        )}
      </Drawer>
    </>
  )
}
