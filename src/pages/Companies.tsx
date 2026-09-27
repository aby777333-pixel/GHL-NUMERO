import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Building2, Check, Copy, Lock, LogIn, Plus, Search, Sparkles } from 'lucide-react'
import { useApp } from '@/store/app'
import { useAction } from '@/hooks/useAsync'
import { BASE_ACCOUNT_MAP, buildCompanyPayload, chartFor, COMPANY_TEMPLATES, INDIA_GST_CODES, recommendTemplate } from '@/engine/templates'
import type { Company, CompanyCreatePayload, ID, TemplateAccount } from '@/engine/types'
import { cx, Empty, Field, Modal, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip, Truth } from '@/ui/kit'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'SAR', 'CNY']
const BUSINESS_TYPES = ['Private Limited Company', 'Public Limited Company', 'Limited Liability Partnership', 'Partnership Firm', 'Sole Proprietorship', 'One Person Company', 'Trust', 'Society', 'Section 8 Company', 'Branch / Liaison Office', 'Other']
const CAPABILITIES: { key: string; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'projects', label: 'Projects' },
  { key: 'cost_centres', label: 'Cost centres' },
  { key: 'warehouses', label: 'Warehouses' },
  { key: 'fixed_assets', label: 'Fixed assets' },
  { key: 'investments', label: 'Investment accounting' },
  { key: 'fund_accounting', label: 'Fund accounting' },
  { key: 'import_export', label: 'Import / Export' },
  { key: 'construction', label: 'Construction' },
  { key: 'property', label: 'Property' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'brokerage', label: 'Brokerage' },
  { key: 'healthcare', label: 'Healthcare / medical equipment' },
]
const MAP_LABEL: Record<string, string> = {
  ar_control: 'receivables control', ap_control: 'payables control', customer_advances: 'customer advances', vendor_advances: 'vendor advances',
  fx_gain_loss: 'exchange differences', retained_earnings: 'retained earnings', suspense: 'suspense', intercompany_receivable: 'intercompany receivables', intercompany_payable: 'intercompany payables',
}
const GST_CODES = new Set(INDIA_GST_CODES.flatMap((t) => t.components.flatMap((c) => [c.output_code, c.input_code])).filter((c): c is string => !!c))
const templateOf = (key?: string | null) => COMPANY_TEMPLATES.find((t) => t.key === key)
const words = (s: string) => s.replace(/_/g, ' ')

const suggestCode = (name: string) => {
  const parts = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return (parts.length === 1 ? parts[0].slice(0, 3) : parts.map((p) => p[0]).join('')).slice(0, 6)
}

export default function Companies() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const isAdmin = useApp((s) => !!s.session?.isGroupAdmin)
  const scope = useApp((s) => s.scope)
  const [params, setParams] = useSearchParams()
  const { act, busy } = useAction()
  const [wizard, setWizard] = useState<{ clone?: Company } | null>(null)
  const [pending, setPending] = useState<{ company: Company; to: Company['status'] } | null>(null)

  const wantsNew = params.get('new') === '1'
  useEffect(() => { if (wantsNew && isAdmin) setWizard((w) => w ?? {}) }, [wantsNew, isAdmin])
  const closeWizard = () => {
    setWizard(null)
    if (wantsNew) { const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }) }
  }

  const enter = (id: ID) => { useApp.getState().setScope([id]); nav('/') }
  const adminOnly = 'Only a group administrator can do this'
  const active = companies.filter((c) => c.status === 'active')
  const archived = companies.filter((c) => c.status === 'archived')

  const createBtn = (
    <button className="btn primary" disabled={!isAdmin} title={isAdmin ? 'Create a company from a recommended configuration' : 'Only a group administrator can create a company'} onClick={() => setWizard({})}>
      <Plus size={15} /> Create company
    </button>
  )

  const card = (c: Company) => (
    <Panel key={c.id} className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num rounded-md border border-gold/30 bg-goldsoft px-1.5 py-[1px] text-[10.5px] text-gold">{c.code}</span>
            <StatusChip status={c.status} />
            {scope.length === 1 && scope[0] === c.id && <span className="chip cyan">in view</span>}
          </div>
          <div className="display mt-1.5 truncate text-[16px] font-medium">{c.name}</div>
          {c.legal_name && c.legal_name !== c.name && <div className="truncate text-[12px] text-muted">{c.legal_name}</div>}
        </div>
        <Building2 size={18} className="flex-none text-muted" />
      </div>
      <div className="hairline my-3" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
        {([
          ['Industry', c.industry || 'Not recorded'],
          ['Country', [c.country, c.state].filter(Boolean).join(' · ')],
          ['Base currency', c.base_currency],
          ['Fiscal year starts', MONTHS[c.fy_start_month - 1] ?? String(c.fy_start_month)],
          ['Template', templateOf(c.template_key)?.name ?? (c.template_key ? words(c.template_key) : 'Not recorded')],
          ['Accounting method', c.accounting_method],
        ] as [string, string][]).map(([l, v]) => (
          <div key={l} className="min-w-0"><div className="text-[10.5px] uppercase tracking-[0.1em] text-muted">{l}</div><div className="truncate text-ink2" title={v}>{v}</div></div>
        ))}
      </div>
      <div className="no-print mt-4 flex flex-wrap items-center gap-2">
        <button className="btn sm primary" onClick={() => enter(c.id)} title="Work in this company only"><LogIn size={13} /> Enter</button>
        <button className="btn sm" disabled={!isAdmin} title={isAdmin ? 'Start a new company with the same chart of accounts and units' : adminOnly} onClick={() => setWizard({ clone: c })}><Copy size={13} /> Clone configuration</button>
        {c.status === 'active'
          ? <button className="btn sm ghost" disabled={!isAdmin || busy} title={isAdmin ? 'Archive this company. All of its history is kept.' : adminOnly} onClick={() => setPending({ company: c, to: 'archived' })}><Archive size={13} /> Archive</button>
          : <button className="btn sm ghost" disabled={!isAdmin || busy} title={isAdmin ? 'Return this company to active use' : adminOnly} onClick={() => setPending({ company: c, to: 'active' })}><ArchiveRestore size={13} /> Restore</button>}
      </div>
    </Panel>
  )

  return (
    <div>
      <PageHeader eyebrow="Group structure" title="Companies"
        subtitle={<><span className="num">{active.length}</span> active · <span className="num">{archived.length}</span> archived. Each company keeps its own books; the group view combines them.</>}
        actions={createBtn} />

      {companies.length === 0 && (
        <Panel><Empty icon={<Building2 size={20} />} title="No companies yet" body="Create the first company from a template. NUMERO recommends a chart of accounts and tax configuration, and nothing becomes active until you confirm it." action={createBtn} /></Panel>
      )}

      {active.length > 0 && <div className="stagger grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{active.map(card)}</div>}

      {archived.length > 0 && (
        <Section title="Archived — history is kept in full" className="mt-6">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{archived.map(card)}</div>
        </Section>
      )}

      {!isAdmin && companies.length > 0 && <Note className="mt-4">Creating, cloning, archiving and restoring companies is reserved for group administrators.</Note>}

      {wizard && <Wizard key={wizard.clone?.id ?? 'new'} clone={wizard.clone} onClose={closeWizard} />}

      <ReasonDialog open={!!pending} required={false} danger={pending?.to === 'archived'}
        title={pending?.to === 'archived' ? `Archive ${pending.company.name}` : `Restore ${pending?.company.name ?? ''}`}
        confirm={pending?.to === 'archived' ? 'Archive company' : 'Restore company'}
        body={pending?.to === 'archived'
          ? 'The company leaves the active group view. Archived companies keep all history: every journal, document, balance and audit record stays exactly as it is, and the company can be restored.'
          : 'The company returns to active use with all of its history.'}
        extra={<Note kind="warn" className="mb-4">The change of status is recorded in the audit trail. The company record has no field for a reason, so text entered below is not stored with it.</Note>}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending
          if (!p) return
          setPending(null)
          void act(async () => { await api.updateCompany(p.company.id, { status: p.to }); await useApp.getState().refreshMaster() }, p.to === 'archived' ? `${p.company.name} archived — history kept` : `${p.company.name} restored`)
        }} />
    </div>
  )
}

// ------------------------------------------------------------------ creation wizard
interface Identity {
  name: string; code: string; legal_name: string; business_type: string; industry: string; country: string; state: string; registered_address: string
  pan: string; gstin: string; cin: string; fy_start_month: number; base_currency: string; accounting_method: 'accrual' | 'cash'
}
const STEPS = ['Identity', 'What does the business do?', 'Review configuration', 'Confirm']

function Wizard({ clone, onClose }: { clone?: Company; onClose: () => void }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const allAccounts = useApp((s) => s.accounts)
  const allUnits = useApp((s) => s.orgUnits)
  const { act, busy } = useAction()

  const [step, setStep] = useState(0)
  const [codeTouched, setCodeTouched] = useState(false)
  const [id, setId] = useState<Identity>({
    name: '', code: '', legal_name: '', business_type: clone?.business_type ?? '', industry: clone?.industry ?? '', country: clone?.country ?? 'IN', state: clone?.state ?? '',
    registered_address: '', pan: '', gstin: '', cin: '', fy_start_month: clone?.fy_start_month ?? 4, base_currency: clone?.base_currency ?? 'INR',
    accounting_method: clone?.accounting_method === 'cash' ? 'cash' : 'accrual',
  })
  const [caps, setCaps] = useState<Record<string, boolean>>({})
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<string | null>(clone ? clone.template_key ?? 'custom' : null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [wantGst, setWantGst] = useState(true)
  const [q, setQ] = useState('')
  const [reviewed, setReviewed] = useState(false)

  const set = <K extends keyof Identity>(k: K, v: Identity[K]) => setId((s) => ({ ...s, [k]: v }))
  const setName = (v: string) => setId((s) => ({ ...s, name: v, code: codeTouched ? s.code : suggestCode(v) }))

  const recommended = recommendTemplate(`${id.industry} ${id.business_type} ${description}`)
  const templateKey = picked ?? recommended
  const template = templateOf(templateKey) ?? COMPANY_TEMPLATES[COMPANY_TEMPLATES.length - 1]

  /** when cloning, the chart and units come from the existing company instead of the template */
  const cloned = useMemo(() => {
    if (!clone) return null
    const src = allAccounts.filter((a) => a.company_id === clone.id)
    const byId = new Map(src.map((a) => [a.id, a]))
    const kept = src.filter((a) => a.is_active || a.is_group)
    const codes = new Set(kept.map((a) => a.code))
    const accounts: TemplateAccount[] = kept.map((a) => {
      const parent = a.parent_id ? byId.get(a.parent_id)?.code : undefined
      return {
        code: a.code, name: a.name, type: a.type, subtype: a.subtype, parent_code: parent && codes.has(parent) ? parent : undefined,
        is_group: a.is_group || undefined, control_type: a.control_type ?? undefined, description: a.description ?? undefined,
      }
    }).sort((x, y) => x.code.localeCompare(y.code))
    const units = allUnits.filter((u) => u.company_id === clone.id && u.status === 'active')
    const unitById = new Map(units.map((u) => [u.id, u]))
    const orgUnits = units.map((u) => ({ type_key: u.type_key, code: u.code, name: u.name, parent_code: u.parent_id ? unitById.get(u.parent_id)?.code : undefined }))
    return { accounts, orgUnits, skipped: src.length - kept.length }
  }, [clone, allAccounts, allUnits])

  const chart = useMemo(() => cloned?.accounts ?? chartFor(templateKey), [cloned, templateKey])
  const orgUnits = cloned?.orgUnits ?? template.orgUnits
  const chartCodes = useMemo(() => new Set(chart.map((a) => a.code)), [chart])
  const gstAvailable = [...GST_CODES].every((c) => chartCodes.has(c))
  const includeGst = wantGst && gstAvailable

  const mapKeyOf = useMemo(() => new Map(Object.entries(BASE_ACCOUNT_MAP).map(([k, code]) => [code, k])), [])
  const hasChildren = useMemo(() => new Set(chart.map((a) => a.parent_code).filter((c): c is string => !!c)), [chart])
  const lockReason = (a: TemplateAccount): string | null => {
    if (a.is_group) return 'Heading — organises the accounts beneath it'
    const k = mapKeyOf.get(a.code)
    if (k) return `Required by the posting engine for ${MAP_LABEL[k] ?? words(k)}`
    if (includeGst && GST_CODES.has(a.code)) return 'Used by the India GST tax codes'
    if (hasChildren.has(a.code)) return 'Other accounts sit beneath this account'
    return null
  }
  const isOut = (a: TemplateAccount) => excluded.has(a.code) && lockReason(a) === null
  const finalAccounts = chart.filter((a) => !isOut(a))
  const outCount = chart.length - finalAccounts.length
  const accountMap = Object.fromEntries(Object.entries(BASE_ACCOUNT_MAP).filter(([, code]) => finalAccounts.some((a) => a.code === code)))
  const unmapped = Object.keys(BASE_ACCOUNT_MAP).filter((k) => !(k in accountMap))

  const capOn = (key: string) => caps[key] ?? !!template.modules[key]
  const modules = Object.fromEntries(CAPABILITIES.filter((c) => capOn(c.key) || c.key in template.modules || c.key in caps).map((c) => [c.key, capOn(c.key)]))

  const code = id.code.trim().toUpperCase()
  const codeTaken = companies.some((c) => c.code.toUpperCase() === code)
  const panOdd = id.pan.trim() !== '' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(id.pan.trim().toUpperCase())
  const gstinOdd = id.gstin.trim() !== '' && !/^[0-9]{2}[A-Z0-9]{13}$/.test(id.gstin.trim().toUpperCase())
  const problems: string[] = []
  if (!id.name.trim()) problems.push('Enter the company name.')
  if (!/^[A-Z0-9-]{2,10}$/.test(code)) problems.push('The code must be 2 to 10 letters or digits.')
  else if (codeTaken) problems.push(`The code ${code} is already used by another company.`)
  if (!id.country.trim()) problems.push('Enter the country.')

  const needle = q.trim().toLowerCase()
  const shownChart = needle ? chart.filter((a) => a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle) || words(a.subtype).includes(needle) || a.type.includes(needle)) : chart
  const toggleOut = (c: string) => setExcluded((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })

  const canNext = step === 0 ? problems.length === 0 : true
  const taxCodes = includeGst ? INDIA_GST_CODES : []

  const create = async () => {
    if (!reviewed || problems.length) return
    const text = (v: string) => v.trim() || null
    const company: CompanyCreatePayload['company'] = {
      name: id.name.trim(), code, legal_name: text(id.legal_name), business_type: text(id.business_type), industry: text(id.industry),
      country: id.country.trim().toUpperCase(), state: text(id.state), registered_address: text(id.registered_address),
      pan: text(id.pan.toUpperCase()), gstin: text(id.gstin.toUpperCase()), cin: text(id.cin.toUpperCase()),
      fy_start_month: id.fy_start_month, base_currency: id.base_currency, accounting_method: id.accounting_method, modules,
    }
    const built = buildCompanyPayload(company, template.key, { includeGst, accounts: finalAccounts })
    const payload: CompanyCreatePayload = { ...built, account_map: accountMap, org_units: orgUnits }
    const newId = await act(async () => {
      const n = await api.createCompany(payload)
      await useApp.getState().refreshMaster()
      return n
    }, `${company.name} created with ${finalAccounts.length} accounts`)
    if (newId) { useApp.getState().setScope([newId]); onClose(); nav('/') }
  }

  const rows: [string, string][] = [
    ['Company', `${id.name.trim()} (${code})`],
    ['Legal name', id.legal_name.trim() || 'Not entered'],
    ['Business type · industry', [id.business_type, id.industry].map((s) => s.trim()).filter(Boolean).join(' · ') || 'Not entered'],
    ['Country · state', [id.country, id.state].map((s) => s.trim()).filter(Boolean).join(' · ')],
    ['Fiscal year starts', MONTHS[id.fy_start_month - 1]],
    ['Base currency', id.base_currency],
    ['Accounting method', id.accounting_method],
    ['Template', clone ? `${template.name} — chart cloned from ${clone.name}` : template.name],
    ['Chart of accounts', `${finalAccounts.filter((a) => !a.is_group).length} posting accounts under ${finalAccounts.filter((a) => a.is_group).length} headings · ${outCount} excluded`],
    ['Engine account mapping', `${Object.keys(accountMap).length} of ${Object.keys(BASE_ACCOUNT_MAP).length} mapped`],
    ['Tax codes', taxCodes.length ? `${taxCodes.length} India GST codes` : 'None'],
    ['Departments / units', orgUnits.length ? orgUnits.map((u) => u.name).join(', ') : 'None'],
    ['Capabilities', Object.entries(modules).filter(([, v]) => v).map(([k]) => CAPABILITIES.find((c) => c.key === k)?.label ?? words(k)).join(', ') || 'None selected'],
  ]

  return (
    <Modal open onClose={onClose} width={1000} title={clone ? `New company — cloned from ${clone.name}` : 'Create company'}
      subtitle={<>Step <span className="num">{step + 1}</span> of <span className="num">{STEPS.length}</span> · {STEPS[step]}</>}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => (
            <button key={s} disabled={i > step && !canNext} onClick={() => (i <= step || problems.length === 0) && setStep(i)} aria-current={i === step ? 'step' : undefined}
              className={cx('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors disabled:opacity-50', i === step ? 'border-gold/50 bg-goldsoft text-ink' : i < step ? 'border-pos/30 bg-possoft text-pos' : 'border-line bg-surface text-muted')}>
              {i < step ? <Check size={12} /> : <span className="num">{i + 1}</span>}<span className="hidden md:inline">{s}</span>
            </button>
          ))}
        </div>
        {step === 0 && problems.length > 0 && <span className="text-[12px] text-muted">{problems[0]}</span>}
        <button className="btn ghost" onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? 'Cancel' : <><ArrowLeft size={14} /> Back</>}</button>
        {step < STEPS.length - 1
          ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next <ArrowRight size={14} /></button>
          : <button className="btn primary" disabled={!reviewed || problems.length > 0 || busy} title={reviewed ? undefined : 'Confirm that you have reviewed the configuration'} onClick={() => void create()}><Check size={14} /> Create company</button>}
      </>}>

      {step === 0 && (
        <div>
          {clone && <Note className="mb-4">The new company starts with the chart of accounts and units of <b>{clone.name}</b>. No transactions, balances, parties or documents are copied.</Note>}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Company name" className="lg:col-span-2"><input className="field" autoFocus value={id.name} onChange={(e) => setName(e.target.value)} placeholder="Name used across NUMERO" /></Field>
            <Field label="Code" hint={codeTaken ? `${code} is already in use` : 'Suggested from the initials; you can change it'}>
              <input className={cx('field num', codeTaken && 'border-neg')} value={id.code} onChange={(e) => { setCodeTouched(true); set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10)) }} />
            </Field>
            <Field label="Legal name" className="lg:col-span-2"><input className="field" value={id.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="As registered" /></Field>
            <Field label="Business type">
              <select className="field" value={id.business_type} onChange={(e) => set('business_type', e.target.value)}>
                <option value="">Select…</option>
                {id.business_type && !BUSINESS_TYPES.includes(id.business_type) && <option value={id.business_type}>{id.business_type}</option>}
                {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Industry"><input className="field" value={id.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Real estate, Trading, Software" /></Field>
            <Field label="Country" hint="Two-letter country code"><input className="field num" value={id.country} onChange={(e) => set('country', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} /></Field>
            <Field label="State"><input className="field" value={id.state} onChange={(e) => set('state', e.target.value)} /></Field>
            <Field label="Registered address" className="sm:col-span-2 lg:col-span-3"><textarea className="field" rows={2} value={id.registered_address} onChange={(e) => set('registered_address', e.target.value)} /></Field>
            <Field label="PAN" hint={panOdd ? 'This does not look like a PAN (AAAAA9999A)' : undefined}><input className={cx('field num', panOdd && 'border-warn')} value={id.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
            <Field label="GSTIN" hint={gstinOdd ? 'This does not look like a 15-character GSTIN' : undefined}><input className={cx('field num', gstinOdd && 'border-warn')} value={id.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
            <Field label="CIN"><input className="field num" value={id.cin} onChange={(e) => set('cin', e.target.value.toUpperCase())} /></Field>
            <Field label="Financial year starts in">
              <select className="field" value={id.fy_start_month} onChange={(e) => set('fy_start_month', Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Base currency">
              <select className="field" value={id.base_currency} onChange={(e) => set('base_currency', e.target.value)}>
                {!CURRENCIES.includes(id.base_currency) && <option value={id.base_currency}>{id.base_currency}</option>}
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Accounting method">
              <select className="field" value={id.accounting_method} onChange={(e) => set('accounting_method', e.target.value === 'cash' ? 'cash' : 'accrual')}>
                <option value="accrual">Accrual</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="eyebrow mb-2">Capabilities required</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <label key={c.key} className={cx('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] transition-colors', capOn(c.key) ? 'border-gold/40 bg-goldsoft text-ink' : 'border-line bg-surface text-ink2 hover:border-line2')}>
                <input type="checkbox" checked={capOn(c.key)} onChange={(e) => setCaps((s) => ({ ...s, [c.key]: e.target.checked }))} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.key in template.modules && caps[c.key] === undefined && <span className="text-[10.5px] text-muted">from template</span>}
              </label>
            ))}
          </div>
          <Field label="Describe the business" className="mt-4" hint="In your own words: what the company sells, buys, builds or manages">
            <textarea className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. We develop residential plots and villas and earn rental income from two commercial properties." />
          </Field>

          <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles size={15} className="text-gold" />
              <span className="eyebrow">Recommendation</span>
              <Truth state="AI ESTIMATE" />
            </div>
            <div className="mt-1.5 text-[14px] text-ink">NUMERO recommends: <b>{templateOf(recommended)?.name}</b></div>
            <div className="mt-1 text-[12.5px] text-ink2">{templateOf(recommended)?.description}</div>
            <div className="mt-2 text-[12px] text-muted">
              This is a recommendation only, derived from the industry, business type and description entered. You decide which template to use.
              {clone && ' Because this company is cloned, the chart of accounts and units come from the source company; the template sets the default capabilities only.'}
            </div>
            {picked !== null && picked !== recommended && <button className="btn sm mt-2.5" onClick={() => setPicked(recommended)}>Use the recommended template</button>}
          </div>

          <div className="eyebrow mb-2 mt-4">Choose a template</div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {COMPANY_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => setPicked(t.key)} aria-pressed={templateKey === t.key}
                className={cx('rounded-xl border px-3.5 py-3 text-left transition-colors', templateKey === t.key ? 'border-gold/50 bg-goldsoft' : 'border-line bg-surface hover:border-line2')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium text-ink">{t.name}</span>
                  {t.key === recommended && <span className="chip violet">recommended</span>}
                  {templateKey === t.key && <span className="chip gold">selected</span>}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-muted">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Note className="mb-3.5">Nothing becomes active until you confirm. Everything remains editable afterwards.</Note>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-[12.5px] text-ink2">
              {clone ? <>Chart cloned from <b className="text-ink">{clone.name}</b></> : <>Chart for <b className="text-ink">{template.name}</b></>} ·{' '}
              <span className="num text-ink">{finalAccounts.length}</span> of <span className="num">{chart.length}</span> accounts will be created · <span className="num">{outCount}</span> excluded
            </div>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="field sm" style={{ width: 260, paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the chart…" aria-label="Search the chart" />
            </div>
          </div>
          {cloned && cloned.skipped > 0 && <Note className="mb-3"><span className="num">{cloned.skipped}</span> inactive account{cloned.skipped === 1 ? '' : 's'} of the source company {cloned.skipped === 1 ? 'is' : 'are'} not carried over.</Note>}
          {unmapped.length > 0 && <Note kind="warn" className="mb-3">The source chart has no account with the standard code for: {unmapped.map((k) => MAP_LABEL[k] ?? words(k)).join(', ')}. These engine mappings will be left unset and can be configured after creation.</Note>}

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[40vh] overflow-auto">
              {shownChart.length === 0 ? <Empty title="No account matches" body="Clear the search to see the whole chart." /> : (
                <table className="table">
                  <thead><tr><th style={{ width: 70 }}>Include</th><th style={{ width: 80 }}>Code</th><th>Account</th><th>Type</th><th>Subtype</th><th>Control</th></tr></thead>
                  <tbody>
                    {shownChart.map((a) => {
                      const why = lockReason(a)
                      const out = isOut(a)
                      return (
                        <tr key={a.code} className={cx(out && 'opacity-50')}>
                          <td>
                            {why
                              ? <span className="inline-flex items-center gap-1 text-muted" title={`Cannot be excluded. ${why}.`}><Lock size={13} /></span>
                              : <input type="checkbox" checked={!out} onChange={() => toggleOut(a.code)} aria-label={`Include ${a.name}`} />}
                          </td>
                          <td className="num text-[12px] text-muted">{a.code}</td>
                          <td>
                            <div className={cx(a.is_group ? 'font-medium text-ink' : 'text-ink2', out && 'line-through')}>{a.name}</div>
                            {why && <div className="text-[11.5px] text-muted">Locked: {why}</div>}
                          </td>
                          <td><span className="chip">{a.type}</span></td>
                          <td className="text-[12.5px] text-ink2">{words(a.subtype)}</td>
                          <td>{a.control_type ? <span className="chip cyan">{words(a.control_type)}</span> : <span className="text-muted">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <label className="flex items-start gap-2.5 text-[13px] text-ink">
                <input type="checkbox" className="mt-[3px]" checked={includeGst} disabled={!gstAvailable} onChange={(e) => setWantGst(e.target.checked)} />
                <span>Include India GST tax codes
                  <span className="block text-[12px] text-muted">
                    {gstAvailable
                      ? <><span className="num">{INDIA_GST_CODES.length}</span> codes: {INDIA_GST_CODES.map((t) => t.code).join(', ')}. Rates are recommendations and must be confirmed against current law by a qualified professional.</>
                      : 'Not available: this chart does not contain the standard input and output tax accounts that the codes post to.'}
                  </span>
                </span>
              </label>
            </div>
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="text-[13px] text-ink">Departments and units that will be created</div>
              {orgUnits.length === 0 ? <div className="mt-1 text-[12px] text-muted">None.</div> : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {orgUnits.map((u) => <span key={u.type_key + u.code} className="chip" title={words(u.type_key)}><span className="num">{u.code}</span> {u.name}</span>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="overflow-hidden rounded-xl border border-line">
            {rows.map(([l, v]) => (
              <div key={l} className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                <span className="text-muted">{l}</span>
                <span className="max-w-[640px] text-right text-ink">{v}</span>
              </div>
            ))}
          </div>
          <Note className="mt-3.5">Nothing becomes active until you confirm. Everything remains editable afterwards. The company starts with no transactions and no balances.</Note>
          <label className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink">
            <input type="checkbox" className="mt-[3px]" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            <span>I have reviewed this configuration<span className="block text-[12px] text-muted">Required. The chart of accounts, tax codes and units listed above will be created for {id.name.trim() || 'the company'}.</span></span>
          </label>
          {problems.length > 0 && <Note kind="warn" className="mt-3">{problems.join(' ')}</Note>}
        </div>
      )}
    </Modal>
  )
}
