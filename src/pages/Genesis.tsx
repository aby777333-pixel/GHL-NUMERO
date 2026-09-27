import { useEffect, useState, type ReactNode } from 'react'
import { BrainCircuit, FormInput, Layers, Percent, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import type { Confidentiality, CustomFieldDef, ID, NumiRule, OrgUnit, TaxCode, TypeDef } from '@/engine/types'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, parseAmount } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, StatusChip, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type Tab = 'structure' | 'fields' | 'party_types' | 'tax' | 'rules' | 'controls'

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const nice = (s: string) => s.replace(/_/g, ' ')

const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
/** Record types a field can be defined for, and the ones whose record screens show and save the values today. */
const ENTITIES = ['invoices', 'register_items', 'fixed_assets', 'party', 'journal', 'payment', 'org_unit', 'company']
const SHOWN_ON_SCREEN = ['invoices', 'register_items', 'fixed_assets', 'party']
const ENTITY_LABEL: Record<string, string> = { invoices: 'invoices and bills', register_items: 'register items', fixed_assets: 'fixed assets', party: 'party', journal: 'journal', payment: 'payment', org_unit: 'organisation unit', company: 'company' }
const FIELD_TYPES = [
  'text', 'number', 'currency', 'percentage', 'date', 'time', 'datetime', 'dropdown', 'multi_select', 'checkbox', 'radio', 'boolean', 'calculated', 'formula',
  'lookup', 'relationship', 'attachment', 'document', 'image', 'signature', 'url', 'email', 'phone', 'location', 'tax', 'reference', 'auto_number',
]
const WITH_OPTIONS = ['dropdown', 'multi_select', 'radio']
const PARTY_CATEGORIES = ['customer', 'vendor', 'employee', 'agent', 'broker', 'contractor', 'consultant', 'freelancer', 'partner', 'investor', 'bank', 'government', 'group', 'other']
const TAX_KINDS = ['gst', 'tds', 'tcs', 'vat', 'cess', 'other']

export default function Genesis() {
  const [tab, setTab] = useState<Tab>('structure')
  return (
    <div>
      <PageHeader eyebrow="No-code configuration" title="NUMERO Genesis Builder"
        subtitle="Shape the structure, fields, party types, tax rates and controls of your financial universe. Every change is recorded in the audit trail." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'structure', label: 'Structure' }, { key: 'fields', label: 'Custom fields' }, { key: 'party_types', label: 'Party types' },
        { key: 'tax', label: 'Tax codes' }, { key: 'rules', label: 'Learned rules' }, { key: 'controls', label: 'Controls' },
      ]} />
      {tab === 'structure' && <StructureTab />}
      {tab === 'fields' && <FieldsTab />}
      {tab === 'party_types' && <PartyTypesTab />}
      {tab === 'tax' && <TaxTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'controls' && <ControlsTab />}
    </div>
  )
}

function CompanyPicker({ value, onChange }: { value: ID; onChange: (id: ID) => void }) {
  const companies = useApp((s) => s.companies)
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted">
      Company
      <select className="field sm" style={{ width: 260 }} value={value} onChange={(e) => onChange(e.target.value)}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
      </select>
    </label>
  )
}

function useCompanyChoice(): [ID, (id: ID) => void] {
  const companies = useApp((s) => s.companies)
  const scope = useApp((s) => s.scope)
  const [id, setId] = useState<ID>(scope[0] ?? companies[0]?.id ?? '')
  useEffect(() => { if (!companies.some((c) => c.id === id) && companies[0]) setId(companies[0].id) }, [companies, id])
  return [id, setId]
}

const NoCompany = () => <Panel><Empty title="No company has been created yet" body="Create a company first; its structure and tax configuration are set up here." /></Panel>

// ---------------------------------------------------------------- structure
function StructureTab() {
  const api = useApp((s) => s.api)!
  const isAdmin = useApp((s) => s.session?.isGroupAdmin ?? false)
  const [companyId, setCompanyId] = useCompanyChoice()
  const { act, busy } = useAction()
  const [unitOpen, setUnitOpen] = useState(false)
  const [levelOpen, setLevelOpen] = useState(false)
  const [unit, setUnit] = useState({ type_key: '', code: '', name: '', parent_id: '', confidentiality: 'internal' as Confidentiality })
  const [level, setLevel] = useState('')

  const data = useAsync(async () => {
    const [units, types] = await Promise.all([companyId ? api.listOrgUnits([companyId]) : Promise.resolve([] as OrgUnit[]), api.listOrgUnitTypes()])
    return { units, types: [...types].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) }
  }, [api, companyId])

  if (!companyId) return <NoCompany />
  const mayConfigure = can('orgunit.configure', companyId)
  const units = data.data?.units ?? []
  const types = data.data?.types ?? []
  const typeName = (k: string) => types.find((t) => t.key === k)?.name ?? nice(k)
  const groups: { key: string; name: string; units: OrgUnit[] }[] = [
    ...types.map((t) => ({ key: t.key, name: t.name, units: units.filter((u) => u.type_key === t.key) })),
    ...[...new Set(units.filter((u) => !types.some((t) => t.key === u.type_key)).map((u) => u.type_key))].map((k) => ({ key: k, name: nice(k), units: units.filter((u) => u.type_key === k) })),
  ]

  const branch = (list: OrgUnit[], parent: OrgUnit | null, depth: number): ReactNode =>
    list
      .filter((u) => (parent ? u.parent_id === parent.id : !u.parent_id || !list.some((x) => x.id === u.parent_id)))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((u) => {
        const outside = !parent && u.parent_id ? units.find((x) => x.id === u.parent_id) : undefined
        return (
          <div key={u.id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-[13px]" style={{ paddingLeft: 16 + depth * 22 }}>
              {depth > 0 && <span className="text-muted">└</span>}
              <span className="num rounded-md border border-line bg-surface px-1.5 py-[1px] text-[10.5px] text-gold">{u.code}</span>
              <span className="text-ink">{u.name}</span>
              {outside && <span className="text-[11.5px] text-muted">under {typeName(outside.type_key)} · {outside.name}</span>}
              <span className="ml-auto flex items-center gap-2">
                {u.confidentiality !== 'internal' && <span className="chip warn">{nice(u.confidentiality)}</span>}
                <StatusChip status={u.status} />
              </span>
            </div>
            {branch(list, u, depth + 1)}
          </div>
        )
      })

  const saveUnit = async () => {
    const id = await act(async () => {
      const r = await api.createOrgUnit({ company_id: companyId, type_key: unit.type_key, code: unit.code.trim().toUpperCase(), name: unit.name.trim(), parent_id: unit.parent_id || null, confidentiality: unit.confidentiality })
      await useApp.getState().refreshMaster()
      return r
    }, 'Unit created')
    if (id) setUnitOpen(false)
  }
  const saveLevel = async () => {
    const ok = await act(async () => { await api.createOrgUnitType({ key: slug(level), name: level.trim() }); return true }, 'Structure level created')
    if (ok) { setLevelOpen(false); setLevel('') }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && <button className="btn" onClick={() => setLevelOpen(true)}><Layers size={14} /> New structure level</button>}
          {mayConfigure && <button className="btn primary" disabled={!types.length} onClick={() => { setUnit({ type_key: types[0]?.key ?? '', code: '', name: '', parent_id: '', confidentiality: 'internal' }); setUnitOpen(true) }}><Plus size={14} /> Create</button>}
        </div>
      </div>
      {!mayConfigure && <Note className="mb-3">You can view the structure of this company. Creating units needs the “orgunit.configure” permission.</Note>}
      {data.error && <ErrorBox message={data.error} retry={data.reload} />}
      {data.loading && !data.data && <Panel><Loading /></Panel>}
      {data.data && (units.length === 0 ? (
        <Panel><Empty icon={<Layers size={20} />} title="No units have been created for this company" body="Branches, departments, cost centres, projects and any other level you define appear here." /></Panel>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {groups.filter((g) => g.units.length).map((g) => (
            <Panel key={g.key} className="overflow-hidden" lit={false}>
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <div className="eyebrow">{g.name}</div>
                <span className="num text-[11.5px] text-muted">{g.units.length}</span>
              </div>
              {branch(g.units, null, 0)}
            </Panel>
          ))}
        </div>
      ))}
      {data.data && groups.some((g) => !g.units.length) && (
        <div className="mt-3 text-[11.5px] text-muted">Levels with no units in this company: {groups.filter((g) => !g.units.length).map((g) => g.name).join(', ')}.</div>
      )}

      <Modal open={unitOpen} onClose={() => setUnitOpen(false)} title="Create a unit" subtitle="A branch, department, cost centre, project or any other level of the structure" width={560}
        footer={<><button className="btn ghost" onClick={() => setUnitOpen(false)}>Cancel</button><button className="btn primary" disabled={busy || !unit.type_key || !unit.code.trim() || !unit.name.trim()} onClick={() => void saveUnit()}>Create unit</button></>}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Level"><select className="field" value={unit.type_key} onChange={(e) => setUnit({ ...unit, type_key: e.target.value })}>{types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
          <Field label="Code" hint="Short and unique within the company"><input className="field num" value={unit.code} onChange={(e) => setUnit({ ...unit, code: e.target.value })} placeholder="e.g. FIN" /></Field>
          <Field label="Name" className="sm:col-span-2"><input className="field" value={unit.name} onChange={(e) => setUnit({ ...unit, name: e.target.value })} placeholder="e.g. Finance & Accounts" /></Field>
          <Field label="Reports to (optional)">
            <select className="field" value={unit.parent_id} onChange={(e) => setUnit({ ...unit, parent_id: e.target.value })}>
              <option value="">Directly under the company</option>
              {[...units].sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.id} value={u.id}>{typeName(u.type_key)} · {u.name}</option>)}
            </select>
          </Field>
          <Field label="Confidentiality"><select className="field" value={unit.confidentiality} onChange={(e) => setUnit({ ...unit, confidentiality: e.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{nice(c)}</option>)}</select></Field>
        </div>
      </Modal>

      <Modal open={levelOpen} onClose={() => setLevelOpen(false)} title="New structure level" subtitle="Adds a level to the hierarchy for the whole group, without changing any code" width={460}
        footer={<><button className="btn ghost" onClick={() => setLevelOpen(false)}>Cancel</button><button className="btn primary" disabled={busy || !slug(level)} onClick={() => void saveLevel()}>Create level</button></>}>
        <Field label="Name" hint={slug(level) ? `Key: ${slug(level)}` : 'For example: Region, Fund, Warehouse'}><input className="field" autoFocus value={level} onChange={(e) => setLevel(e.target.value)} /></Field>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------- custom fields
interface FieldForm { id?: ID; entity: string; scope_key: string; label: string; key: string; keyEdited: boolean; field_type: string; options: string[]; is_required: boolean; company_id: string; status: CustomFieldDef['status']; rules: Record<string, unknown> }
const blankField = (): FieldForm => ({ entity: 'invoices', scope_key: '', label: '', key: '', keyEdited: false, field_type: 'text', options: [''], is_required: false, company_id: '', status: 'active', rules: {} })

function FieldsTab() {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const { act, busy } = useAction()
  const list = useAsync(() => api.listCustomFields(), [api])
  const [form, setForm] = useState<FieldForm | null>(null)
  const mayConfigure = can('field.configure')
  const companyName = (id: ID | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Company outside your access' : 'Whole group')

  const edit = (f: CustomFieldDef) => setForm({
    id: f.id, entity: f.entity, scope_key: f.scope_key ?? '', label: f.label, key: f.key, keyEdited: true, field_type: f.field_type,
    options: f.options.length ? f.options.map(String) : [''], is_required: f.is_required, company_id: f.company_id ?? '', status: f.status, rules: f.rules,
  })
  const hasOptions = form ? WITH_OPTIONS.includes(form.field_type) : false
  const cleanOptions = form ? form.options.map((o) => o.trim()).filter(Boolean) : []
  const valid = form !== null && form.label.trim() !== '' && slug(form.key) !== '' && (!hasOptions || cleanOptions.length > 0)

  const save = async () => {
    if (!form) return
    const ok = await act(async () => {
      await api.saveCustomField({
        id: form.id, company_id: form.company_id || null, entity: form.entity, scope_key: form.scope_key.trim() || null, key: slug(form.key), label: form.label.trim(),
        field_type: form.field_type, options: hasOptions ? cleanOptions : [], rules: form.rules, is_required: form.is_required, status: form.status,
      })
      return true
    }, form.id ? 'Field updated — a new version was saved' : 'Field created')
    if (ok) setForm(null)
  }

  const cols: Column<CustomFieldDef>[] = [
    { key: 'entity', header: 'Record type', render: (f) => <span className="text-ink">{ENTITY_LABEL[f.entity] ?? nice(f.entity)}{!SHOWN_ON_SCREEN.includes(f.entity) && <span className="ml-1.5 text-[11px] text-muted">not yet shown</span>}</span>, sort: (f) => f.entity, csv: (f) => f.entity },
    { key: 'scope', header: 'Applies to', render: (f) => <span className="text-ink2">{f.scope_key ? nice(f.scope_key) : 'All'}<span className="text-muted"> · {companyName(f.company_id)}</span></span>, sort: (f) => f.scope_key ?? '', csv: (f) => f.scope_key ?? 'all' },
    { key: 'key', header: 'Key', render: (f) => <span className="num text-[12.5px] text-gold">{f.key}</span>, sort: (f) => f.key, csv: (f) => f.key },
    { key: 'label', header: 'Label', render: (f) => f.label, sort: (f) => f.label, csv: (f) => f.label },
    { key: 'type', header: 'Type', render: (f) => <span className="chip cyan">{nice(f.field_type)}</span>, sort: (f) => f.field_type, csv: (f) => f.field_type },
    { key: 'required', header: 'Required', render: (f) => (f.is_required ? <span className="chip gold">required</span> : <span className="text-muted">optional</span>), sort: (f) => (f.is_required ? 1 : 0), csv: (f) => (f.is_required ? 'yes' : 'no') },
    { key: 'status', header: 'Status', render: (f) => <StatusChip status={f.status} />, sort: (f) => f.status, csv: (f) => f.status },
    { key: 'version', header: 'Version', align: 'right', render: (f) => <span className="num">v{f.version}</span>, sort: (f) => f.version, csv: (f) => f.version },
  ]

  return (
    <div>
      <Note kind="warn" className="mb-3">Fields defined for <strong className="text-ink">invoices and bills, register items, fixed assets and parties</strong> appear on those records under “Additional information” (for a party: on its Operations tab), where their values are entered and saved. Fields defined for the other record types are saved and versioned, but no screen shows them yet.</Note>
      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading /></Panel>}
      {list.data && (
        <Panel className="overflow-hidden" lit={false}>
          <DataTable columns={cols} rows={list.data} rowKey={(f) => f.id} onRow={mayConfigure ? edit : undefined} exportName="custom-fields" initialSort={{ key: 'entity', dir: 'asc' }}
            toolbar={<>
              <span className="text-[12.5px] text-muted">{list.data.length} field definition{list.data.length === 1 ? '' : 's'}{mayConfigure ? ' · click a row to edit' : ''}</span>
              {mayConfigure && <button className="btn sm primary ml-auto" onClick={() => setForm(blankField())}><Plus size={13} /> Create field</button>}
            </>}
            empty={{ title: 'No custom fields have been defined', body: 'Create a field to capture information that is specific to your business.', icon: <FormInput size={20} /> }} />
        </Panel>
      )}
      {!mayConfigure && <div className="mt-2 text-[11.5px] text-muted">Creating and editing fields needs the “field.configure” permission.</div>}

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Edit field' : 'Create field'} subtitle={form?.id ? 'Saving creates a new version of the definition' : 'Define a field without changing any code'} width={680}
        footer={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={busy || !valid} onClick={() => void save()}>{form?.id ? 'Save new version' : 'Create field'}</button></>}>
        {form && (
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Record type"><select className="field" value={form.entity} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, entity: e.target.value })}>{[...new Set([...ENTITIES, form.entity])].map((x) => <option key={x} value={x}>{ENTITY_LABEL[x] ?? nice(x)}{SHOWN_ON_SCREEN.includes(x) ? '' : ' — not yet shown on its screen'}</option>)}</select></Field>
            <Field label="Applies to (optional)" hint="A sub-type key, for example a party type such as “broker”. Leave empty for all."><input className="field" value={form.scope_key} onChange={(e) => setForm({ ...form, scope_key: e.target.value })} /></Field>
            <Field label="Label"><input className="field" autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, key: form.keyEdited ? form.key : slug(e.target.value) })} placeholder="e.g. RERA registration number" /></Field>
            <Field label="Key" hint={form.id ? 'The key of an existing field cannot change' : 'Generated from the label; used in exports and rules'}><input className="field num" value={form.key} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, key: e.target.value, keyEdited: true })} onBlur={() => setForm({ ...form, key: slug(form.key) })} /></Field>
            <Field label="Field type"><select className="field" value={form.field_type} onChange={(e) => setForm({ ...form, field_type: e.target.value })}>{FIELD_TYPES.map((x) => <option key={x} value={x}>{nice(x)}</option>)}</select></Field>
            <Field label="Company"><select className="field" value={form.company_id} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, company_id: e.target.value })}><option value="">Whole group</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            {hasOptions && (
              <div className="sm:col-span-2">
                <span className="label">Options</span>
                <div className="space-y-2">
                  {form.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="field sm" value={o} placeholder={`Option ${i + 1}`} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                      <button className="btn sm icon ghost" aria-label="Remove option" disabled={form.options.length === 1} onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
                <button className="btn sm ghost mt-2" onClick={() => setForm({ ...form, options: [...form.options, ''] })}><Plus size={13} /> Add option</button>
              </div>
            )}
            <label className="flex items-center gap-2.5 text-[13px] text-ink2"><input type="checkbox" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} /> This field is required</label>
            {form.id && <Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CustomFieldDef['status'] })}>{(['draft', 'active', 'inactive'] as const).map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------- party types
function PartyTypesTab() {
  const api = useApp((s) => s.api)!
  const isAdmin = useApp((s) => s.session?.isGroupAdmin ?? false)
  const { act, busy } = useAction()
  const list = useAsync(() => api.listPartyTypes(), [api])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', key: '', keyEdited: false, prefix: '', category: 'customer' })
  const valid = f.name.trim() !== '' && slug(f.key) !== '' && /^[A-Z]{3}$/.test(f.prefix)

  const save = async () => {
    const ok = await act(async () => { await api.createPartyType({ key: slug(f.key), name: f.name.trim(), prefix: f.prefix, category: f.category }); return true }, 'Party type created')
    if (ok) setOpen(false)
  }

  const cols: Column<TypeDef>[] = [
    { key: 'name', header: 'Party type', render: (t) => <span className="text-ink">{t.name}</span>, sort: (t) => t.name, csv: (t) => t.name },
    { key: 'key', header: 'Key', render: (t) => <span className="num text-[12.5px] text-gold">{t.key}</span>, sort: (t) => t.key, csv: (t) => t.key },
    { key: 'prefix', header: 'Number prefix', render: (t) => <span className="num">{t.prefix ?? '—'}</span>, sort: (t) => t.prefix ?? '', csv: (t) => t.prefix },
    { key: 'category', header: 'Category', render: (t) => (t.category ? <span className="chip cyan">{nice(t.category)}</span> : <span className="text-muted">—</span>), sort: (t) => t.category ?? '', csv: (t) => t.category },
    { key: 'origin', header: 'Defined by', render: (t) => (t.group_id ? <span className="chip gold">your group</span> : <span className="chip">system</span>), sort: (t) => (t.group_id ? 1 : 0), csv: (t) => (t.group_id ? 'group' : 'system') },
  ]

  return (
    <div>
      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading /></Panel>}
      {list.data && (
        <Panel className="overflow-hidden" lit={false}>
          <DataTable columns={cols} rows={list.data} rowKey={(t) => t.key} exportName="party-types" pageSize={100}
            toolbar={<>
              <span className="text-[12.5px] text-muted">{list.data.length} party type{list.data.length === 1 ? '' : 's'}</span>
              {isAdmin && <button className="btn sm primary ml-auto" onClick={() => { setF({ name: '', key: '', keyEdited: false, prefix: '', category: 'customer' }); setOpen(true) }}><Plus size={13} /> New party type</button>}
            </>}
            empty={{ title: 'No party types are defined', icon: <Users size={20} /> }} />
        </Panel>
      )}
      {!isAdmin && <div className="mt-2 text-[11.5px] text-muted">Only a group administrator can add party types.</div>}

      <Modal open={open} onClose={() => setOpen(false)} title="New party type" subtitle="A new kind of person or organisation the group deals with" width={560}
        footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy || !valid} onClick={() => void save()}>Create party type</button></>}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Name"><input className="field" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: f.keyEdited ? f.key : slug(e.target.value) })} placeholder="e.g. Channel Partner" /></Field>
          <Field label="Key" hint="Generated from the name"><input className="field num" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value, keyEdited: true })} onBlur={() => setF({ ...f, key: slug(f.key) })} /></Field>
          <Field label="Number prefix" hint="Exactly three letters, used in party numbers"><input className="field num" maxLength={3} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} placeholder="CHP" /></Field>
          <Field label="Category"><select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{PARTY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------- tax codes
interface CompForm { component: string; rate: string; output_account_id: string; input_account_id: string; effective_from: string }
const blankComp = (): CompForm => ({ component: '', rate: '', output_account_id: '', input_account_id: '', effective_from: today() })
const rateOf = (s: string): number | null => { const t = s.trim().replace(/%$/, ''); if (!t || !/^\d+(\.\d+)?$/.test(t)) return null; return D(t).toNumber() }

function TaxTab() {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const [companyId, setCompanyId] = useCompanyChoice()
  const { act, busy } = useAction()
  const list = useAsync(() => (companyId ? api.listTaxCodes([companyId]) : Promise.resolve([] as TaxCode[])), [api, companyId])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ code: '', name: '', kind: 'gst' })
  const [comps, setComps] = useState<CompForm[]>([blankComp()])

  if (!companyId) return <NoCompany />
  const mayConfigure = can('tax.configure', companyId)
  const accName = (id?: ID | null) => { const a = id ? accounts.find((x) => x.id === id) : undefined; return a ? `${a.code} · ${a.name}` : '—' }
  const own = accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active)
  const taxFirst = (type: 'asset' | 'liability') => own.filter((a) => a.type === type).sort((a, b) => Number(b.control_type === 'tax') - Number(a.control_type === 'tax') || a.code.localeCompare(b.code))
  const valid = f.code.trim() !== '' && f.name.trim() !== '' && comps.length > 0 && comps.every((c) => c.component.trim() !== '' && rateOf(c.rate) !== null && c.effective_from !== '')
  const setComp = (i: number, patch: Partial<CompForm>) => setComps(comps.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const start = (t?: TaxCode) => {
    setF(t ? { code: t.code, name: t.name, kind: t.kind } : { code: '', name: '', kind: 'gst' })
    const current = t ? t.components.filter((c) => !c.effective_to) : []
    setComps(current.length ? current.map((c) => ({ component: c.component, rate: String(c.rate), output_account_id: c.output_account_id ?? '', input_account_id: c.input_account_id ?? '', effective_from: today() })) : [blankComp()])
    setOpen(true)
  }
  const save = async () => {
    const id = await act(() => api.saveTaxCode({
      company_id: companyId, code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind,
      components: comps.map((c) => ({ component: c.component.trim(), rate: rateOf(c.rate) ?? 0, output_account_id: c.output_account_id || null, input_account_id: c.input_account_id || null, effective_from: c.effective_from })),
    }), 'Tax code saved')
    if (id) setOpen(false)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        {mayConfigure && <button className="btn primary" onClick={() => start()}><Plus size={14} /> New tax code / new rate version</button>}
      </div>
      <Note className="mb-3">Rates are data with effective dates. A new rate applies from its effective date onwards — it never rewrites invoices dated before it, and earlier rates stay on record.</Note>
      {!mayConfigure && <Note className="mb-3">Changing tax configuration needs the “tax.configure” permission for this company.</Note>}
      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading /></Panel>}
      {list.data && list.data.length === 0 && <Panel><Empty icon={<Percent size={20} />} title="No tax codes are configured for this company" body="Tax codes decide which tax is calculated on invoices and bills, and which ledgers it is posted to." /></Panel>}
      <div className="space-y-3">
        {(list.data ?? []).map((t) => (
          <Panel key={t.id} className="overflow-hidden" lit={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[11px] text-gold">{t.code}</span>
                <span className="text-[13.5px] text-ink">{t.name}</span>
                <span className="chip cyan">{t.kind}</span>
                <span className="text-[11.5px] text-muted">{t.jurisdiction}</span>
                {!t.is_active && <StatusChip status="inactive" />}
              </div>
              {mayConfigure && <button className="btn sm ghost" onClick={() => start(t)}>New rate version</button>}
            </div>
            {t.components.length === 0 ? <div className="px-4 py-3 text-[12.5px] text-muted">This code has no components.</div> : (
              <table className="table">
                <thead><tr><th>Component</th><th className="r">Rate</th><th>Effective from</th><th>Effective to</th><th>Output ledger</th><th>Input ledger</th></tr></thead>
                <tbody>
                  {[...t.components].sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? '') || a.component.localeCompare(b.component)).map((c, i) => (
                    <tr key={c.id ?? `${c.component}-${i}`} className={cx(c.effective_to && 'opacity-60')}>
                      <td className="text-ink">{c.component}</td>
                      <td className="r"><span className="num">{D(c.rate).toString()}%</span></td>
                      <td><span className="num text-[12.5px]">{fmtDate(c.effective_from)}</span></td>
                      <td>{c.effective_to ? <span className="num text-[12.5px]">{fmtDate(c.effective_to)}</span> : <span className="chip pos">current</span>}</td>
                      <td className="text-ink2">{accName(c.output_account_id)}</td>
                      <td className="text-ink2">{accName(c.input_account_id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Tax code / rate version" subtitle="Saving an existing code adds a new rate version from the effective date; earlier rates are end-dated, never overwritten" width={860}
        footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy || !valid} onClick={() => void save()}>Save tax code</button></>}>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="Code"><input className="field num" autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. GST18" /></Field>
          <Field label="Name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. GST 18%" /></Field>
          <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{[...new Set([...TAX_KINDS, f.kind])].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select></Field>
        </div>
        <div className="eyebrow mb-2 mt-5">Components</div>
        <div className="space-y-2">
          {comps.map((c, i) => (
            <div key={i} className="grid items-end gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[1fr_90px_1.4fr_1.4fr_150px_30px]">
              <Field label="Component"><input className="field sm" value={c.component} onChange={(e) => setComp(i, { component: e.target.value })} placeholder="CGST" /></Field>
              <Field label="Rate %"><input className="field sm num" inputMode="decimal" value={c.rate} onChange={(e) => setComp(i, { rate: e.target.value })} placeholder="9" /></Field>
              <Field label="Output ledger (sales)"><select className="field sm" value={c.output_account_id} onChange={(e) => setComp(i, { output_account_id: e.target.value })}><option value="">Not set</option>{taxFirst('liability').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
              <Field label="Input ledger (purchases)"><select className="field sm" value={c.input_account_id} onChange={(e) => setComp(i, { input_account_id: e.target.value })}><option value="">Not set</option>{taxFirst('asset').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
              <Field label="Effective from"><input type="date" className="field sm" value={c.effective_from} onChange={(e) => setComp(i, { effective_from: e.target.value })} /></Field>
              <button className="btn sm icon ghost" aria-label="Remove component" disabled={comps.length === 1} onClick={() => setComps(comps.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <button className="btn sm ghost mt-2" onClick={() => setComps([...comps, blankComp()])}><Plus size={13} /> Add component</button>
        {comps.some((c) => c.rate.trim() !== '' && rateOf(c.rate) === null) && <div className="mt-2 text-[12px] text-neg">A rate must be a number such as 9 or 2.5.</div>}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------- learned rules
function RulesTab() {
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const list = useAsync(() => api.listNumiRules(ids), [api, ids.join(',')])

  const cols: Column<NumiRule>[] = [
    { key: 'pattern', header: 'When the description contains', render: (r) => <span className="num text-[12.5px] text-ink">{r.pattern}</span>, sort: (r) => r.pattern, csv: (r) => r.pattern },
    {
      key: 'account', header: 'Suggest ledger', sort: (r) => accounts.find((a) => a.id === r.account_id)?.name ?? '', csv: (r) => accounts.find((a) => a.id === r.account_id)?.name ?? r.account_id,
      render: (r) => { const a = accounts.find((x) => x.id === r.account_id); return a ? <span><span className="text-muted">→ </span><span className="text-ink">{a.name}</span> <span className="num text-[11.5px] text-muted">{a.code}</span></span> : <span className="text-muted">Ledger outside your access</span> },
    },
    { key: 'party', header: 'Party', render: (r) => (r.party_id ? parties.find((p) => p.id === r.party_id)?.display_name ?? '—' : <span className="text-muted">any</span>), csv: (r) => (r.party_id ? parties.find((p) => p.id === r.party_id)?.display_name ?? '' : '') },
    { key: 'company', header: 'Company', render: (r) => <span className="text-ink2">{companies.find((c) => c.id === r.company_id)?.name ?? '—'}</span>, sort: (r) => companies.find((c) => c.id === r.company_id)?.name ?? '', csv: (r) => companies.find((c) => c.id === r.company_id)?.name ?? '' },
    { key: 'count', header: 'Times approved', align: 'right', render: (r) => <span className="num">{r.approved_count.toLocaleString()}</span>, sort: (r) => r.approved_count, csv: (r) => r.approved_count },
    { key: 'used', header: 'Last used', render: (r) => <span className="num text-[12.5px]">{fmtDateTime(r.last_used_at)}</span>, sort: (r) => r.last_used_at, csv: (r) => r.last_used_at },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status === 'active' ? 'active' : 'inactive'} label={r.status} />, sort: (r) => r.status, csv: (r) => r.status },
    {
      key: 'action', header: '', align: 'right',
      render: (r) => can('account.configure', r.company_id) ? (
        <button className={cx('btn sm', r.status === 'active' ? 'danger' : 'good')} disabled={busy}
          onClick={(e) => { e.stopPropagation(); void act(() => api.setNumiRuleStatus(r.id, r.status === 'active' ? 'disabled' : 'active'), r.status === 'active' ? 'Rule disabled' : 'Rule enabled') }}>
          {r.status === 'active' ? 'Disable' : 'Enable'}
        </button>
      ) : null,
    },
  ]

  return (
    <div>
      <Note className="mb-3">NUMI learns only from classifications a human approved. It never teaches itself from its own suggestions, and a rule only proposes a ledger — a person still reviews every entry. Administrators can inspect or disable any rule here.</Note>
      {list.error && <ErrorBox message={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Panel><Loading /></Panel>}
      {list.data && (
        <Panel className="overflow-hidden" lit={false}>
          <DataTable columns={cols} rows={list.data} rowKey={(r) => r.id} exportName="numi-learned-rules" initialSort={{ key: 'count', dir: 'desc' }}
            toolbar={<span className="text-[12.5px] text-muted">{list.data.length} learned rule{list.data.length === 1 ? '' : 's'} · {list.data.filter((r) => r.status === 'active').length} active</span>}
            empty={{ title: 'NUMI has not learned any rules yet', body: 'Rules appear after a person approves a classification in the Transaction Centre.', icon: <BrainCircuit size={20} /> }} />
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- controls
function ControlsTab() {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const settings = useApp((s) => s.session?.group?.settings)
  const isAdmin = session?.isGroupAdmin ?? false
  const { act, busy } = useAction()
  const [ask, setAsk] = useState<'enforced' | 'owner_override' | null>(null)
  const sentinel = settings?.sentinel
  const [s, setS] = useState({ large: '', unit: '', tz: '' })
  useEffect(() => {
    setS({ large: sentinel?.large_payment !== undefined ? String(sentinel.large_payment) : '', unit: sentinel?.round_number_unit !== undefined ? String(sentinel.round_number_unit) : '', tz: sentinel?.timezone ?? '' })
  }, [sentinel?.large_payment, sentinel?.round_number_unit, sentinel?.timezone])

  if (!settings) return <Panel><Empty title="Group settings are not available" body="Sign in to a group to see its controls." /></Panel>
  const mc = settings.controls?.maker_checker
  const large = s.large.trim() ? parseAmount(s.large) : null
  const unit = s.unit.trim() ? parseAmount(s.unit) : null
  const sentinelValid = (s.large.trim() === '' || (large !== null && large.gt(0))) && (s.unit.trim() === '' || (unit !== null && unit.gt(0)))
  const sentinelDirty = s.tz.trim() !== (sentinel?.timezone ?? '') || (large ? large.toNumber() : undefined) !== sentinel?.large_payment || (unit ? unit.toNumber() : undefined) !== sentinel?.round_number_unit

  const changeMode = async (next: 'enforced' | 'owner_override', reason: string) => {
    setAsk(null)
    await act(async () => {
      // the settings API has no reason parameter; the reason travels inside the settings so that it reaches the audit record of this change
      await api.updateGroupSettings({ controls: { maker_checker: next }, last_controls_change: { setting: 'maker_checker', from: mc ?? null, to: next, reason, by: session?.user.email ?? null, at: new Date().toISOString() } })
      await useApp.getState().refreshSession()
    }, next === 'enforced' ? 'Maker-checker is now enforced' : 'Owner override is now allowed')
  }
  const saveSentinel = async () => {
    await act(async () => {
      await api.updateGroupSettings({ sentinel: { ...(s.tz.trim() ? { timezone: s.tz.trim() } : {}), ...(large ? { large_payment: large.toNumber() } : {}), ...(unit ? { round_number_unit: unit.toNumber() } : {}) } })
      await useApp.getState().refreshSession()
    }, 'Sentinel thresholds saved')
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><div className="eyebrow">Segregation of duties</div><div className="display mt-0.5 text-[15px]">Maker-checker</div></div>
          <ShieldCheck size={17} className="text-gold" />
        </div>
        <div className="flex items-center gap-2.5">
          <span className={cx('lamp', mc === 'enforced' ? 'pos' : mc === 'owner_override' ? 'warn' : '')} />
          <span className="text-[14px] text-ink">{mc === 'enforced' ? 'Enforced' : mc === 'owner_override' ? 'Owner override allowed' : 'Not set'}</span>
        </div>
        <p className="mb-0 mt-2 text-[12.5px] leading-relaxed text-muted">
          {mc === 'enforced'
            ? 'Nobody — including the owner — can approve what they created.'
            : mc === 'owner_override'
              ? 'Only the Group Super Admin may approve their own entries, and each such approval is recorded in the audit trail as an override. Everyone else remains subject to maker-checker.'
              : 'No maker-checker mode has been recorded for this group.'}
        </p>
        {isAdmin ? (
          <div className="mt-4 flex items-center rounded-[11px] border border-line bg-surface p-[3px]" role="group" aria-label="Maker-checker mode" style={{ width: 'fit-content' }}>
            {([['enforced', 'Enforced'], ['owner_override', 'Owner override']] as ['enforced' | 'owner_override', string][]).map(([k, l]) => (
              <button key={k} disabled={busy} aria-pressed={mc === k} onClick={() => { if (mc !== k) setAsk(k) }} className={cx('h-[28px] rounded-lg px-3 text-[11.5px] font-medium transition-colors', mc === k ? 'border border-line2 bg-surface2 text-ink' : 'text-muted')}>{l}</button>
            ))}
          </div>
        ) : <div className="mt-3 text-[11.5px] text-muted">Only a group administrator can change this control.</div>}
      </Panel>

      <Panel className="p-5">
        <div className="mb-3"><div className="eyebrow">Sentinel thresholds</div><div className="display mt-0.5 text-[15px]">What counts as unusual</div></div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Large payment amount" hint={large ? undefined : 'Accepts shorthand such as “5 lakh” or “2 cr”'}>
            <input className="field num" disabled={!isAdmin} value={s.large} onChange={(e) => setS({ ...s, large: e.target.value })} placeholder="Not set" />
            {large && <span className="mt-1 block text-[11.5px] text-muted">Sentinel flags a payment of <Money value={large} /> or more made to a newly created party</span>}
          </Field>
          <Field label="Round-number unit" hint={unit ? undefined : 'Manual journals that total an exact multiple of this unit are flagged'}>
            <input className="field num" disabled={!isAdmin} value={s.unit} onChange={(e) => setS({ ...s, unit: e.target.value })} placeholder="Not set" />
            {unit && <span className="mt-1 block text-[11.5px] text-muted">Manual journals totalling an exact multiple of <Money value={unit} /> are flagged for review</span>}
          </Field>
          <Field label="Timezone" hint="The timezone Sentinel is configured with for checks on entries posted at unusual hours" className="sm:col-span-2">
            <input className="field" disabled={!isAdmin} value={s.tz} onChange={(e) => setS({ ...s, tz: e.target.value })} placeholder="e.g. Asia/Kolkata" />
          </Field>
        </div>
        {!sentinelValid && <div className="mt-2 text-[12px] text-neg">Enter amounts greater than zero, for example 500000 or “5 lakh”.</div>}
        {isAdmin ? <button className="btn primary mt-4" disabled={busy || !sentinelValid || !sentinelDirty} onClick={() => void saveSentinel()}>Save thresholds</button> : <div className="mt-3 text-[11.5px] text-muted">Only a group administrator can change these thresholds.</div>}
      </Panel>

      <ReasonDialog open={ask !== null} onCancel={() => setAsk(null)} danger={ask === 'owner_override'}
        title={ask === 'owner_override' ? 'Allow owner override?' : 'Enforce maker-checker?'}
        confirm={ask === 'owner_override' ? 'Allow owner override' : 'Enforce maker-checker'}
        body={ask === 'owner_override'
          ? 'The Group Super Admin will be able to approve entries they created themselves. Each such approval is recorded as an override. Everyone else remains subject to maker-checker.'
          : 'Nobody — including the owner — will be able to approve what they created.'}
        onConfirm={(reason) => { if (ask) void changeMode(ask, reason) }} />
    </div>
  )
}
