import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'
import { useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ApprovalRule, ID } from '@/engine/types'
import { D } from '@/lib/money'
import { APPROVAL_ENTITIES } from '@/lib/workflow'
import { Drawer, Field, Note, Spinner } from './kit'

/** What an approval rule can apply to. A journal includes every entry proposed by an operation. */
const ENTITIES: { key: string; label: string }[] = [
  { key: 'journal', label: 'Journals and entries proposed by operations' },
  ...Object.entries(APPROVAL_ENTITIES).map(([key, v]) => ({ key, label: v.label + 's' })),
]
const ANY = '*'

interface Form { id?: ID; name: string; entity: string; company_id: string; min_amount: string; max_amount: string; steps: string[]; is_active: boolean }
const blank = (): Form => ({ name: '', entity: 'journal', company_id: '', min_amount: '0', max_amount: '', steps: [ANY], is_active: true })
const digits = (s: string) => s.replace(/[^\d.]/g, '')

/**
 * Approval rules decide how many people must approve, and in which role, by kind of record and by amount.
 * A rule changes what happens to requests opened from now on; requests already open keep the steps they were given.
 */
export function ApprovalRuleEditor({ open, rule, onClose }: { open: boolean; rule: ApprovalRule | null; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const { act, busy } = useAction()
  const roles = useAsync(() => api.listRoles(), [api])
  const [f, setF] = useState<Form>(blank)
  useEffect(() => {
    if (!open) return
    setF(rule ? { id: rule.id, name: rule.name, entity: rule.entity, company_id: rule.company_id ?? '', min_amount: D(rule.min_amount).toString(), max_amount: rule.max_amount === null ? '' : D(rule.max_amount).toString(), steps: rule.steps.length ? [...rule.steps] : [ANY], is_active: rule.is_active } : blank())
  }, [open, rule])

  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))
  const step = (i: number, v: string) => set({ steps: f.steps.map((s, k) => (k === i ? v : s)) })
  const move = (i: number, by: number) => { const s = [...f.steps]; const [x] = s.splice(i, 1); s.splice(i + by, 0, x); set({ steps: s }) }

  const problems: string[] = []
  if (!f.name.trim()) problems.push('Give the rule a name.')
  if (f.max_amount.trim() !== '' && D(f.max_amount).lte(D(f.min_amount || 0))) problems.push('The upper amount must be greater than the lower amount.')
  if (!f.steps.length) problems.push('A rule needs at least one step.')

  const save = async () => {
    const r = await act(async () => {
      await api.saveApprovalRule({ id: f.id, name: f.name.trim(), entity: f.entity, company_id: f.company_id || null, min_amount: f.min_amount.trim() === '' ? 0 : f.min_amount, max_amount: f.max_amount.trim() === '' ? null : f.max_amount, steps: f.steps, is_active: f.is_active })
      return true
    }, rule ? 'Rule updated' : 'Rule added')
    if (r) onClose()
  }

  return (
    <Drawer open={open} onClose={onClose} width={620} title={rule ? 'Edit approval rule' : 'New approval rule'} subtitle="Who must approve, by kind of record and by amount"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save rule</button></>}>
      <Note className="mb-4">
        A rule applies to requests opened from now on. Requests already waiting keep the steps they were given. The person who prepared a record can never approve it, whatever the rule says, and the same person cannot approve two steps of one request.
      </Note>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: payments above ₹10 lakh" autoFocus /></Field>
        <Field label="Applies to"><select className="field" value={f.entity} onChange={(e) => set({ entity: e.target.value })}>{ENTITIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
        <Field label="Company" hint="Left empty, the rule applies to every company of the group"><select className="field" value={f.company_id} onChange={(e) => set({ company_id: e.target.value })}><option value="">All companies</option>{companies.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="From amount" hint="In the base currency of the company"><input className="field num" inputMode="decimal" value={f.min_amount} onChange={(e) => set({ min_amount: digits(e.target.value) })} /></Field>
        <Field label="To below" hint="Left empty: and above"><input className="field num" inputMode="decimal" value={f.max_amount} onChange={(e) => set({ max_amount: digits(e.target.value) })} /></Field>
      </div>

      <div className="eyebrow mb-2 mt-5">Steps, in order</div>
      <div className="rounded-xl border border-line">
        {f.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
            <span className="num w-14 flex-none text-[12px] text-muted">Step {i + 1}</span>
            <select className="field sm flex-1" value={s} onChange={(e) => step(i, e.target.value)} aria-label={`Step ${i + 1}: role required`}>
              <option value={ANY}>Any authorised approver</option>
              {(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              {s !== ANY && !(roles.data ?? []).some((r) => r.key === s) && <option value={s}>{s.replace(/_/g, ' ')}</option>}
            </select>
            <button className="btn ghost icon sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}><ArrowUp size={13} /></button>
            <button className="btn ghost icon sm" disabled={i === f.steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}><ArrowDown size={13} /></button>
            <button className="btn ghost icon sm" disabled={f.steps.length <= 1} onClick={() => set({ steps: f.steps.filter((_, k) => k !== i) })} aria-label={`Remove step ${i + 1}`}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button className="btn sm mt-2" disabled={f.steps.length >= 6} onClick={() => set({ steps: [...f.steps, ANY] })}><Plus size={13} /> Add a step</button>

      <label className="mt-5 flex items-center gap-2 text-[13px] text-ink2">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> The rule is in force
      </label>
      <div className="mt-1 text-[11.5px] text-muted">A rule is never deleted. One that is no longer wanted is switched off, and its history stays in the audit trail.</div>

      {problems.length > 0 && f.name && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Drawer>
  )
}
