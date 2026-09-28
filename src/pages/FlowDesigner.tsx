import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Copy, FileText, Flag, GitBranch, Globe2, ListChecks, Lock, PencilLine, Play, Plus, Save, Trash2, Workflow, X, Zap } from 'lucide-react'
import type { ID, Role } from '@/engine/types'
import type { RegisterKind } from '@/engine/opsTypes'
import { FLOW_ACTIONS, FLOW_LINKS, FLOW_TRIGGERS, type FlowAction, type FlowDef, type FlowDefInput, type FlowDefinition, type FlowFieldDef, type FlowLink, type FlowTrigger } from '@/engine/p3Types'
import { can, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { fmtDateTime } from '@/lib/dates'
import { cx, Empty, ErrorBox, Field, Loading, Note, PageHeader, Panel, Section, Spinner, StatusChip } from '@/ui/kit'
import { useCompanyName } from '@/ui/ops'
import { DemoTag, Fact, NoAccess, human } from '@/ui/p3'
import {
  ACTION_META, ActionChip, ActionNode, DOC_KINDS, FLOW_EXAMPLES, INTENT_NOTE, NEEDS_RECORD, Refusal, StatusDialog, TRIGGER_META, TriggerChip,
  actionMeta, adaptExample, checkDefinition, docKindName, linkMeta, plural, slug, toneVar, triggerLabel, triggerWorks, type Problem,
} from './Studio'

// =====================================================================
// The workflow designer (spec 1768, 1770-1772, 1820, 1828).
// A workflow describes who does what, in which order, and which record
// each step points to. It posts nothing and releases no money.
// A workflow in use is never edited: a change is its next version.
// =====================================================================

type FieldType = NonNullable<FlowFieldDef['type']>
const FIELD_TYPES: [FieldType, string][] = [['text', 'Text'], ['number', 'Number'], ['money', 'Money'], ['date', 'Date'], ['select', 'A list to choose from'], ['boolean', 'Yes or no']]

interface StepDraft { uid: string; key: string; keyAuto: boolean; name: string; action: FlowAction; actor_role: string; links_to: FlowLink | ''; required_documents: string[]; optional: boolean; guidance: string }
interface FieldDraft { uid: string; key: string; keyAuto: boolean; label: string; type: FieldType; options: string; required: boolean }
type TextPart = 'money_flow' | 'accounting' | 'settlement' | 'notifications' | 'numi' | 'sentinel' | 'reports'
interface Draft extends Record<TextPart, string> {
  name: string; key: string; keyAuto: boolean; category: string; description: string; company_id: ID | null; trigger_kind: FlowTrigger
  steps: StepDraft[]; fields: FieldDraft[]; actors: string; register_kind: string
}

/** The parts of a definition that are words, not rules. Each says what it describes, and that it sets nothing up. */
const DESCRIBED: { key: TextPart | 'actors'; label: string; hint: string; rows: number }[] = [
  { key: 'actors', label: 'Actors', rows: 1, hint: 'The people who take part, separated by commas. This describes the way of working; it gives nobody a role or a permission.' },
  { key: 'money_flow', label: 'Money flow', rows: 2, hint: 'From where to where the money goes. This describes; money moves only through the records the steps point to.' },
  { key: 'accounting', label: 'Accounting', rows: 2, hint: 'How the cost or the income is recognised. This describes; entries are proposed by the records and approved by a second person.' },
  { key: 'settlement', label: 'Settlement', rows: 2, hint: 'By when, and how, what was released is accounted for. This describes; it sets no due date and sends no reminder.' },
  { key: 'notifications', label: 'Notifications', rows: 2, hint: 'Who should be told, and of what. This describes; no notification is set up from it.' },
  { key: 'numi', label: 'NUMI behaviour', rows: 2, hint: 'What NUMI should be able to answer about these cases. This describes; it changes nothing in NUMI.' },
  { key: 'sentinel', label: 'Sentinel rules', rows: 2, hint: 'What should be raised for review. This describes; no alert rule is set up from it.' },
  { key: 'reports', label: 'Reports', rows: 2, hint: 'What the people who follow this workflow want to see. This describes; no report is set up from it.' },
]
const TEXT_PARTS: TextPart[] = ['money_flow', 'accounting', 'settlement', 'notifications', 'numi', 'sentinel', 'reports']

let seq = 0
const uidOf = () => `n${++seq}`
const keyOnly = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48)
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const emptyDraft = (companyId: ID | null): Draft => ({
  name: '', key: '', keyAuto: true, category: '', description: '', company_id: companyId, trigger_kind: 'manual',
  steps: [{ uid: uidOf(), key: 'request', keyAuto: true, name: 'Request', action: 'request', actor_role: '*', links_to: '', required_documents: [], optional: false, guidance: '' }],
  fields: [], actors: '', register_kind: '', money_flow: '', accounting: '', settlement: '', notifications: '', numi: '', sentinel: '', reports: '',
})

const fromDefinition = (d: FlowDefinition): Pick<Draft, 'steps' | 'fields' | 'actors' | 'register_kind' | TextPart> => ({
  steps: (d.steps ?? []).map((s) => ({
    uid: uidOf(), key: s.key ?? '', keyAuto: false, name: s.name ?? '', action: s.action, actor_role: s.actor_role ?? '*', links_to: s.links_to ?? '',
    required_documents: Array.isArray(s.required_documents) ? [...s.required_documents] : [], optional: !!s.optional, guidance: s.guidance ?? '',
  })),
  fields: (d.fields ?? []).map((f) => ({ uid: uidOf(), key: f.key ?? '', keyAuto: false, label: f.label ?? '', type: f.type ?? 'text', options: (f.options ?? []).join(', '), required: !!f.required })),
  actors: (d.actors ?? []).join(', '), register_kind: d.register_kind ?? '',
  money_flow: d.money_flow ?? '', accounting: d.accounting ?? '', settlement: d.settlement ?? '', notifications: d.notifications ?? '', numi: d.numi ?? '', sentinel: d.sentinel ?? '', reports: d.reports ?? '',
})
const fromDef = (d: FlowDef): Draft => ({ name: d.name, key: d.key, keyAuto: false, category: d.category ?? '', description: d.description ?? '', company_id: d.company_id, trigger_kind: d.trigger_kind, ...fromDefinition(d.definition) })

const toDefinition = (d: Draft): FlowDefinition => {
  const out: FlowDefinition = {
    steps: d.steps.map((s) => ({
      key: s.key.trim(), name: s.name.trim(), action: s.action, actor_role: s.actor_role || '*',
      ...(s.links_to ? { links_to: s.links_to } : {}),
      ...(s.required_documents.length ? { required_documents: s.required_documents } : {}),
      ...(s.optional ? { optional: true } : {}),
      ...(s.guidance.trim() ? { guidance: s.guidance.trim() } : {}),
    })),
  }
  if (d.fields.length) {
    out.fields = d.fields.map((f) => {
      const options = f.options.split(',').map((o) => o.trim()).filter(Boolean)
      return { key: f.key.trim(), label: f.label.trim(), type: f.type, ...(f.type === 'select' ? { options } : {}), ...(f.required ? { required: true } : {}) }
    })
  }
  const actors = d.actors.split(',').map((a) => a.trim()).filter(Boolean)
  if (actors.length) out.actors = actors
  for (const k of TEXT_PARTS) if (d[k].trim()) out[k] = d[k].trim()
  if (d.register_kind.trim()) out.register_kind = d.register_kind.trim()
  return out
}
/** what the design is, apart from its name, its key and its company */
const bodyOf = (d: Draft) => JSON.stringify({ category: d.category.trim(), description: d.description.trim(), trigger_kind: d.trigger_kind, definition: toDefinition(d) })
const sigOf = (d: Draft) => JSON.stringify({ name: d.name.trim(), key: d.key, company_id: d.company_id, body: bodyOf(d) })

interface Carried { carry?: Draft; refusal?: string }

export default function FlowDesigner() {
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const viewIds = companies.map((c) => c.id).filter((c) => can('flow.view', c))
  const designIds = companies.filter((c) => c.status === 'active').map((c) => c.id).filter((c) => can('flow.configure', c))
  const example = id ? null : sp.get('example')
  const clone = id ? null : sp.get('clone')
  if (id ? !viewIds.length : !designIds.length && !admin) return <NoAccess eyebrow="Scenario Studio · Designer" title="The workflow designer" perm={id ? 'flow.view' : 'flow.configure'} back="/studio?tab=workflows" />
  return <Designer key={`${id ?? 'new'}|${example ?? ''}|${clone ?? ''}`} id={id ?? null} exampleKey={example} cloneId={clone} viewIds={viewIds} designIds={designIds} />
}

function Designer({ id, exampleKey, cloneId, viewIds, designIds }: { id: ID | null; exampleKey: string | null; cloneId: ID | null; viewIds: ID[]; designIds: ID[] }) {
  const nav = useNavigate()
  const location = useLocation()
  const carried = (location.state ?? null) as Carried | null
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const toast = useApp((s) => s.toast)
  const touch = useApp((s) => s.touch)
  const effects = useApp((s) => s.effects)
  const companyName = useCompanyName()
  const viewKey = viewIds.join(',')

  const source = useAsync(async () => {
    const [defs, roles, kinds] = await Promise.all([
      api.listFlowDefs(),
      // the roles and the register kinds help the person choose; the designer still works for someone who cannot list them
      api.listRoles().then((r) => r as Role[] | null, () => null),
      api.listRegisterKinds().then((r) => r.filter((k) => k.is_active) as RegisterKind[] | null, () => null),
    ])
    return { defs: defs.filter((d) => d.company_id === null || viewIds.includes(d.company_id)), roles, kinds }
  }, [api, viewKey])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [versioning, setVersioning] = useState(false)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [adapted, setAdapted] = useState<{ replaced: { step: string; role: string }[]; droppedKind: string | null; rolesRead: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(carried?.refusal ?? null)
  const [changing, setChanging] = useState<'active' | 'retired' | null>(null)

  const defs = useMemo(() => source.data?.defs ?? [], [source.data])
  const def = id ? defs.find((x) => x.id === id) ?? null : null
  const cloneSource = cloneId ? defs.find((x) => x.id === cloneId) ?? null : null
  const roleSet = useMemo(() => (source.data?.roles ? new Set(source.data.roles.map((r) => r.key)) : null), [source.data])

  // the design is filled in once, from what is on record, from an example or from the workflow that is copied
  useEffect(() => {
    if (draft || !source.data) return
    const home: ID | null = designIds[0] ?? null
    if (id) {
      if (!def) return
      const onRecord = fromDef(def)
      setBaseline(sigOf(onRecord))
      setDraft(carried?.carry && def.status === 'draft' ? { ...carried.carry, key: def.key, keyAuto: false, company_id: def.company_id } : onRecord)
      return
    }
    if (cloneId) {
      if (!cloneSource) { setNotice('The workflow to copy was not found, or it is not shared with you. The canvas is empty.'); setDraft(emptyDraft(home)); return }
      const copy = fromDef(cloneSource)
      const target = cloneSource.company_id ? (designIds.includes(cloneSource.company_id) ? cloneSource.company_id : home) : admin ? null : home
      setBaseline(bodyOf(copy))
      setDraft({ ...copy, name: `${cloneSource.name} (copy)`, key: slug(`${cloneSource.key}_copy`), company_id: target })
      return
    }
    if (exampleKey) {
      const ex = FLOW_EXAMPLES.find((x) => x.key === exampleKey)
      if (!ex) { setNotice('The example asked for does not exist. The canvas is empty.'); setDraft(emptyDraft(home)); return }
      const kinds = source.data.kinds ? new Set(source.data.kinds.map((k) => k.key)) : null
      const fit = adaptExample(ex, roleSet, kinds)
      setAdapted({ replaced: fit.replaced, droppedKind: fit.droppedKind, rolesRead: !!roleSet })
      setDraft({ name: ex.name, key: ex.key, keyAuto: false, category: ex.category, description: ex.description, company_id: home, trigger_kind: ex.trigger_kind, ...fromDefinition(fit.definition) })
      return
    }
    const blank = emptyDraft(home)
    setOpened(new Set(blank.steps.map((s) => s.uid)))
    setDraft(blank)
  }, [source.data, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = <button className="btn ghost" onClick={() => nav('/studio?tab=workflows')}><ArrowLeft size={15} /> Back</button>
  const eyebrow = 'Scenario Studio · Designer'
  if (source.error) return <div><PageHeader eyebrow={eyebrow} title="Workflow" actions={back} /><ErrorBox message={source.error} retry={source.reload} /></div>
  if (!source.data) return <div><PageHeader eyebrow={eyebrow} title="Workflow" actions={back} /><Panel><Loading rows={7} label="Loading the designer" /></Panel></div>
  if (id && !def) {
    return (
      <div>
        <PageHeader eyebrow={eyebrow} title="Workflow" actions={back} />
        <Panel><Empty icon={<Workflow size={20} />} title="Workflow not found or not shared with you" body="This workflow does not exist, or it belongs to a company in which your role does not read workflows." action={<button className="btn" onClick={() => nav('/studio?tab=workflows')}><ArrowLeft size={14} /> Back to the studio</button>} /></Panel>
      </div>
    )
  }
  if (!draft) return <div><PageHeader eyebrow={eyebrow} title="Workflow" actions={back} /><Panel><Loading rows={7} label="Loading the designer" /></Panel></div>

  // ---------------------------------------------------------------- where the design stands
  const mode: 'new' | 'clone' | 'draft' | 'version' | 'locked' = !def ? (cloneSource ? 'clone' : 'new') : def.status === 'draft' ? 'draft' : versioning ? 'version' : 'locked'
  const target = draft.company_id
  const mayTarget = target ? can('flow.configure', target) : admin
  const editable = mode !== 'locked' && mayTarget
  const readOnly = !editable
  const identityFixed = mode === 'draft' || mode === 'version'
  const whose = target ? companyName(target) : 'the whole group'
  const siblings = defs.filter((x) => x.key === draft.key && (x.company_id ?? null) === target)
  const nextVersion = Math.max(0, ...siblings.map((x) => x.version)) + 1
  const otherActive = def ? defs.find((x) => x.id !== def.id && x.key === def.key && (x.company_id ?? null) === (def.company_id ?? null) && x.status === 'active') ?? null : null
  const clonedFrom = def?.cloned_from ? defs.find((x) => x.id === def.cloned_from) ?? null : null
  const targets = companies.filter((c) => c.status === 'active' && designIds.includes(c.id))

  const definition = toDefinition(draft)
  const dirty = mode === 'clone' || mode === 'new' ? true : sigOf(draft) !== baseline
  const changedBody = mode === 'clone' && bodyOf(draft) !== baseline

  const problems: Problem[] = []
  if (!draft.name.trim()) problems.push({ at: 'flow', index: -1, text: 'The workflow needs a name.' })
  if (!draft.key.trim()) problems.push({ at: 'flow', index: -1, text: 'The workflow needs a key.' })
  const choosesTarget = mode === 'new' || mode === 'clone'
  if (choosesTarget && target === null && !admin) problems.push({ at: 'flow', index: -1, text: designIds.length ? 'A workflow for the whole group is designed by a Group Super Admin. Choose a company.' : 'A workflow for the whole group is designed by a Group Super Admin.' })
  if (choosesTarget && target !== null && !can('flow.configure', target)) problems.push({ at: 'flow', index: -1, text: 'You need the permission flow.configure in the company chosen.' })
  problems.push(...checkDefinition(definition, roleSet))
  const stepProblems = (i: number) => problems.filter((p) => p.at === 'step' && p.index === i)
  const fieldProblems = (i: number) => problems.filter((p) => p.at === 'field' && p.index === i)
  const canSave = editable && !busy && problems.length === 0 && dirty
  const whyNotSave = !editable ? undefined : problems.length ? problems[0].text : !dirty ? 'Nothing has been changed.' : undefined

  // ---------------------------------------------------------------- changing the design
  const set = (patch: Partial<Draft>) => { setRefusal(null); setDraft((x) => (x ? { ...x, ...patch } : x)) }
  const setStep = (uid: string, patch: Partial<StepDraft>) => set({ steps: draft.steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)) })
  const setField = (uid: string, patch: Partial<FieldDraft>) => set({ fields: draft.fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)) })
  const freeKey = (base: string, taken: string[]) => { const b = slug(base) || 'step'; if (!taken.includes(b)) return b; let n = 2; while (taken.includes(`${b}_${n}`)) n += 1; return `${b}_${n}` }
  const addStep = (action: FlowAction) => {
    const name = ACTION_META[action].label
    const s: StepDraft = { uid: uidOf(), key: freeKey(name, draft.steps.map((x) => x.key)), keyAuto: true, name, action, actor_role: '*', links_to: '', required_documents: [], optional: false, guidance: '' }
    set({ steps: [...draft.steps, s] })
    setOpened((o) => new Set(o).add(s.uid))
  }
  const move = <T,>(list: T[], i: number, by: number): T[] => { const j = i + by; if (j < 0 || j >= list.length) return list; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n }
  const toggle = (uid: string) => setOpened((o) => { const n = new Set(o); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  const showStep = (uid: string) => { setOpened((o) => new Set(o).add(uid)); window.setTimeout(() => document.getElementById('step-' + uid)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60) }
  const addField = () => set({ fields: [...draft.fields, { uid: uidOf(), key: '', keyAuto: true, label: '', type: 'text', options: '', required: false }] })

  // ---------------------------------------------------------------- saving
  const input: FlowDefInput = { company_id: target, key: draft.key.trim(), name: draft.name.trim(), description: draft.description.trim() || undefined, category: draft.category.trim() || undefined, trigger_kind: draft.trigger_kind, definition }
  const save = async () => {
    setBusy(true); setRefusal(null)
    try {
      if (mode === 'clone' && cloneSource) {
        const copyId = await api.cloneFlowDef(cloneSource.id, input.key, input.name, target)
        if (changedBody) {
          try { await api.saveFlowDef({ ...input, id: copyId }) } catch (e) {
            // the copy exists; the changes were refused. They are carried to the draft so that nothing typed is lost.
            touch()
            toast('warn', 'The copy is saved, without your changes', 'The changes made here were refused. They are still on the screen, on the draft of the copy.')
            nav('/studio/flows/' + copyId, { replace: true, state: { carry: draft, refusal: msgOf(e) } satisfies Carried })
            return
          }
        }
        touch(); toast('ok', 'The copy is saved as a draft')
        nav('/studio/flows/' + copyId, { replace: true })
      } else if (mode === 'draft' && def) {
        await api.saveFlowDef({ ...input, id: def.id })
        setBaseline(sigOf(draft))
        touch(); toast('ok', 'Draft saved', `Version ${def.version} of ${input.name} was changed in place.`)
      } else if (mode === 'version' && def) {
        const newId = await api.saveFlowDef({ ...input, id: def.id })
        touch(); toast('ok', `Version ${nextVersion} saved as a draft`, `Version ${def.version} stays ${def.status} until the new version is made active.`)
        nav('/studio/flows/' + newId, { replace: true })
      } else {
        const newId = await api.saveFlowDef(input)
        touch(); toast('ok', 'Saved as a draft', `Version ${nextVersion} of ${input.key}, for ${whose}.`)
        nav('/studio/flows/' + newId, { replace: true })
      }
    } catch (e) {
      setRefusal(msgOf(e))
      toast('error', 'Action refused', msgOf(e))
    } finally {
      setBusy(false)
    }
  }
  const stopVersioning = () => { if (def) setDraft(fromDef(def)); setVersioning(false); setRefusal(null) }

  const happens: ReactNode = (() => {
    if (mode === 'locked' && def) return <>Version <span className="num text-ink">{def.version}</span> is {def.status}. A workflow that is or was in use is never edited: cases already started keep the steps they started with. To change it, prepare its next version, or clone it under a new key.</>
    if (!mayTarget && mode === 'draft') return <>Your role does not design workflows {target ? `in ${whose}` : 'of the whole group'}. The draft is shown as it is on record.</>
    if (mode === 'draft' && def) return <>Saving changes this draft in place. It stays version <span className="num text-ink">{def.version}</span> of <span className="num text-ink">{def.key}</span>. Its key and its company were decided when it was first saved and are not changed. No case can be started on it until it is made active.</>
    if (mode === 'version' && def) return <>Version <span className="num text-ink">{def.version}</span> is not changed. Saving records what is on this screen as version <span className="num text-ink">{nextVersion}</span> of <span className="num text-ink">{def.key}</span>, a draft, for {whose}. {def.status === 'active' ? <>New cases keep following version {def.version} until version {nextVersion} is made active; at that moment the engine retires version {def.version}.</> : <>Version {def.version} stays retired.</>} Cases already started keep the steps they started with.</>
    if (mode === 'clone' && cloneSource) return <>Saving makes a copy of <span className="text-ink">{cloneSource.name}</span> (version {cloneSource.version}) as a draft, {siblings.length ? <>version <span className="num text-ink">{nextVersion}</span> of the key <span className="num text-ink">{draft.key}</span>, which already exists for {whose}</> : <>version <span className="num text-ink">1</span> of <span className="num text-ink">{draft.key || 'its key'}</span> for {whose}</>}{changedBody ? ', and then records on that copy the changes made here' : ''}. The workflow it is copied from is not changed, and no case is copied.</>
    if (siblings.length) return <>The key <span className="num text-ink">{draft.key}</span> already exists for {whose} ({siblings.map((x) => `version ${x.version}, ${x.status}`).join('; ')}). Saving records this design as version <span className="num text-ink">{nextVersion}</span> of that key, as a draft. The earlier versions are not changed.</>
    return <>Saving records this design as a draft: version <span className="num text-ink">1</span> of <span className="num text-ink">{draft.key || 'its key'}</span>, for {whose}. A draft is changed freely. No case can be started on it until it is made active.</>
  })()

  const title = draft.name.trim() || (mode === 'new' ? 'A new workflow' : 'Workflow')
  const categories = [...new Set([...defs.map((x) => x.category), ...FLOW_EXAMPLES.map((x) => x.category)].filter(Boolean))].sort()
  const docCount = new Set(draft.steps.flatMap((s) => s.required_documents)).size

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={<>
          {mode === 'new' && (exampleKey && adapted ? 'Started from an example. Nothing is saved until you save.' : 'A new way of working. Nothing is saved until you save.')}
          {mode === 'clone' && cloneSource && <>A copy of {cloneSource.name}, version {cloneSource.version}. Nothing is saved until you save.</>}
          {def && <><span className="num">{def.key}</span> · version <span className="num">{def.version}</span> · {def.company_id ? companyName(def.company_id) : 'the whole group'} ·</>}
          {' '}A workflow posts nothing and releases no money.
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          {back}
          {def && mode !== 'version' && <button className="btn" disabled={!designIds.length && !admin} title={!designIds.length && !admin ? 'You need the permission flow.configure to design a workflow' : 'Make a copy under a new key, and change the copy'} onClick={() => nav('/studio/flows/new?clone=' + def.id)}><Copy size={14} /> Clone to change</button>}
          {mode === 'locked' && def && <button className="btn" disabled={!mayTarget} title={mayTarget ? `Version ${def.version} is not changed` : 'You need the permission to design this workflow'} onClick={() => setVersioning(true)}><GitBranch size={14} /> Prepare version {nextVersion}</button>}
          {mode === 'locked' && def?.status === 'active' && <button className="btn" disabled={!mayTarget} onClick={() => setChanging('retired')}><Archive size={14} /> Retire</button>}
          {def && def.status !== 'active' && mode !== 'version' && <button className="btn good" disabled={!mayTarget || (mode === 'draft' && (dirty || problems.length > 0))} title={!mayTarget ? 'You need the permission to design this workflow' : mode === 'draft' && dirty ? 'Save your changes first' : problems[0]?.text} onClick={() => setChanging('active')}><Play size={14} /> Make active</button>}
          {mode === 'version' && <button className="btn ghost" onClick={stopVersioning}><X size={14} /> Leave version {def?.version} as it is</button>}
          {editable && <button className="btn primary" disabled={!canSave} title={whyNotSave} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {mode === 'draft' ? 'Save the draft' : mode === 'version' ? `Save as version ${nextVersion}` : 'Save as a draft'}</button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {def ? <StatusChip status={def.status} label={def.status === 'draft' ? 'draft — not in use' : undefined} /> : <span className="chip">not saved</span>}
        {def && <span className="chip">version {def.version}</span>}
        {mode === 'version' && <span className="chip gold">preparing version {nextVersion}</span>}
        <span className={cx('chip', !target && 'gold')}>{target ? companyName(target) : <><Globe2 size={11} /> whole group</>}</span>
        <TriggerChip trigger={draft.trigger_kind} />
        <span className="chip">{plural(draft.steps.length, 'step')}</span>
        {readOnly && <span className="chip"><Lock size={11} /> read only</span>}
        {editable && def && dirty && <span className="chip warn">changes not saved</span>}
      </div>

      {notice && <Note kind="warn" className="mb-4">{notice}</Note>}
      {carried?.carry && mode === 'draft' && <Note kind="warn" className="mb-4">The copy was saved as it is in the workflow it was copied from. The changes you made were refused and are not on record; they are still on this screen. Correct what was refused and save the draft.</Note>}
      {adapted && (adapted.replaced.length > 0 || adapted.droppedKind) && (
        <Note className="mb-4">
          {adapted.replaced.length > 0 && <div>{adapted.rolesRead ? 'The example names roles that do not exist in this group' : 'The roles of this group could not be read, so the roles the example names were not kept'}: {adapted.replaced.map((r) => `${human(r.role)} (${r.step})`).join('; ')}. Those steps are open to anyone authorised. Choose a role on a step where you want one.</div>}
          {adapted.droppedKind && <div>The example names the register kind {human(adapted.droppedKind)}, which {source.data.kinds ? 'does not exist in this group' : 'could not be checked'}. It was left out.</div>}
        </Note>
      )}
      {mode === 'locked' && def && <Note className="mb-4">{happens}{otherActive && def.status !== 'active' ? <> Version {otherActive.version} of this key is the active one.</> : null}</Note>}

      <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
        <div className="min-w-0 space-y-5">
          {/* ------------------------------------------------ identity */}
          <Section title="What this workflow is">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Field label="Name" className="sm:col-span-2">
                <input className="field" value={draft.name} disabled={readOnly} placeholder="Site imprest, request to settlement" onChange={(e) => set({ name: e.target.value, ...(draft.keyAuto && !identityFixed ? { key: slug(e.target.value) } : {}) })} />
              </Field>
              <Field label="Key" hint={identityFixed || mode === 'locked' ? 'Decided when the workflow was first saved. Versions of a workflow share its key; a new key needs a clone.' : 'Generated from the name; you may change it. Versions of a workflow share its key, and the numbers of its cases begin with its first four characters.'}>
                <input className="field num" value={draft.key} disabled={readOnly || identityFixed} onChange={(e) => set({ key: keyOnly(e.target.value), keyAuto: false })} />
              </Field>
              <Field label="Category" hint="A word to group workflows by: Advances, Travel, Purchasing…">
                <input className="field" list="flow-categories" value={draft.category} disabled={readOnly} onChange={(e) => set({ category: e.target.value })} />
                <datalist id="flow-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="For" className="sm:col-span-2" hint={identityFixed || mode === 'locked' ? 'Decided when the workflow was first saved.' : admin ? 'A workflow for the whole group can be followed in every company. A workflow of a company is followed in that company only.' : 'A workflow for the whole group is designed by a Group Super Admin.'}>
                <select className="field" value={target ?? 'group'} disabled={readOnly || identityFixed} onChange={(e) => set({ company_id: e.target.value === 'group' ? null : e.target.value })}>
                  {(admin || target === null) && <option value="group">The whole group</option>}
                  {targets.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  {target !== null && !targets.some((c) => c.id === target) && <option value={target}>{companyName(target)}</option>}
                </select>
              </Field>
              <Field label="Description" className="sm:col-span-2" hint="What the workflow is for, in a sentence or two.">
                <textarea className="field" rows={2} value={draft.description} disabled={readOnly} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              {def && (
                <div className="grid gap-4 border-t border-line pt-4 sm:col-span-2 sm:grid-cols-3">
                  <Fact label="First saved"><span className="num text-[12.5px]">{fmtDateTime(def.created_at)}</span></Fact>
                  <Fact label="Made active">{def.activated_at ? <span className="num text-[12.5px]">{fmtDateTime(def.activated_at)}</span> : 'Never'}</Fact>
                  <Fact label="Copied from or version before">{clonedFrom ? <button className="link" onClick={() => nav('/studio/flows/' + clonedFrom.id)}>{clonedFrom.name} · v{clonedFrom.version}</button> : def.cloned_from ? 'A workflow not shared with you' : 'Designed from the start'}</Fact>
                </div>
              )}
            </Panel>
          </Section>

          {/* ------------------------------------------------ trigger */}
          <Section title="How a case starts" right={<span className="text-[11.5px] text-muted">{FLOW_TRIGGERS.filter(triggerWorks).length} of {FLOW_TRIGGERS.length} ways start a case today</span>}>
            <Panel className="p-3" lit={false}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Trigger">
                {FLOW_TRIGGERS.map((t) => {
                  const on = draft.trigger_kind === t
                  const works = triggerWorks(t)
                  return (
                    <button key={t} role="radio" aria-checked={on} disabled={readOnly} onClick={() => set({ trigger_kind: t })} title={TRIGGER_META[t].says}
                      className={cx('flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors', on ? 'border-gold bg-goldsoft' : 'border-line', !readOnly && !on && 'hover:border-line2 hover:bg-surface2', readOnly && !on && 'opacity-55')}>
                      <span className={cx('mt-[3px] grid h-4 w-4 flex-none place-items-center rounded-full border', on ? 'border-gold text-gold' : 'border-line2 text-transparent')}><Check size={10} strokeWidth={3} /></span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] text-ink">{triggerLabel(t)}</span>
                        <span className={cx('block text-[11px]', works ? 'text-pos' : 'text-warn')}>{works ? 'starts a case today' : INTENT_NOTE}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {!triggerWorks(draft.trigger_kind) && (
                <Note kind="warn" className="mt-3">
                  <span className="text-ink">{triggerLabel(draft.trigger_kind)}</span> is {INTENT_NOTE}. {TRIGGER_META[draft.trigger_kind]?.says} NUMERO does not do that yet: a person starts each case of this workflow in the studio.
                </Note>
              )}
            </Panel>
          </Section>

          {/* ------------------------------------------------ the path */}
          <Section title="The path" right={<span className="text-[11.5px] text-muted">{plural(draft.steps.length, 'step')} · {plural(draft.steps.filter((s) => s.links_to).length, 'points', 'point')} to a record · {plural(docCount, 'kind')} of document required</span>}>
            <div>
              <Rail icon={<Zap size={16} />} tone="var(--gold)" line>
                <div className="pb-3 pt-1.5">
                  <div className="text-[12.5px] text-ink">A case starts · {triggerLabel(draft.trigger_kind).toLowerCase()}</div>
                  <div className="text-[11.5px] text-muted">{triggerWorks(draft.trigger_kind) ? 'The person who starts it cannot approve it.' : `The trigger is ${INTENT_NOTE}; a person starts the case. The person who starts it cannot approve it.`}</div>
                </div>
              </Rail>

              {draft.steps.map((s, i) => (
                  <motion.div key={s.uid} id={'step-' + s.uid} layout={effects === 'off' ? false : 'position'} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
                    <Rail node={<ActionNode action={s.action} size={40} state={s.optional ? 'skipped' : 'plain'} />} line>
                      <StepCard step={s} index={i} count={draft.steps.length} open={opened.has(s.uid)} readOnly={readOnly} roles={source.data!.roles} problems={stepProblems(i)}
                        onToggle={() => toggle(s.uid)} onChange={(patch) => setStep(s.uid, patch)}
                        onMove={(by) => set({ steps: move(draft.steps, i, by) })}
                        onRemove={() => set({ steps: draft.steps.filter((x) => x.uid !== s.uid) })} />
                    </Rail>
                  </motion.div>
              ))}

              {editable && (
                <Rail icon={<Plus size={16} />} tone="var(--ink-2)" dashed line>
                  <div className="pb-3">
                    <Panel className="p-3" lit={false}>
                      <div className="mb-2 text-[11.5px] text-muted">Add a step at the end. Choose what kind of step it is; the kinds are kept apart because approval is not release, release is not expense, and expense is not settlement.</div>
                      <div className="flex flex-wrap gap-1.5">
                        {FLOW_ACTIONS.map((a) => {
                          const m = ACTION_META[a]
                          const Icon = m.icon
                          return (
                            <button key={a} className="btn sm" title={m.says} onClick={() => addStep(a)} style={{ color: toneVar(m.tone), borderColor: `color-mix(in srgb, ${toneVar(m.tone)} 30%, transparent)` }}>
                              <Icon size={13} /> {m.label}
                            </button>
                          )
                        })}
                      </div>
                    </Panel>
                  </div>
                </Rail>
              )}

              <Rail icon={<Flag size={15} />} tone="var(--pos)">
                <div className="pt-1.5">
                  <div className="text-[12.5px] text-ink">The case is completed</div>
                  <div className="text-[11.5px] text-muted">When the last step is recorded or, where it is optional, skipped with a reason. Completing a case posts nothing: what reached the ledger did so through the records the steps point to.</div>
                </div>
              </Rail>
            </div>
          </Section>

          {/* ------------------------------------------------ the form */}
          <Section title="What the case asks for at the start" right={editable ? <button className="btn sm" onClick={addField}><Plus size={13} /> Add a field</button> : undefined}>
            <Panel lit={false}>
              <div className="border-b border-line px-4 py-2.5 text-[11.5px] text-muted">Every case already has a title, a company, a party, an amount and a confidentiality level. These fields are what this workflow asks for in addition. A required field must be answered before the case can be started.</div>
              {draft.fields.length === 0 ? <div className="px-4 py-4 text-[12.5px] text-muted">This workflow asks for nothing more at the start.</div> : (
                <div className="divide-y divide-line">
                  {draft.fields.map((f, i) => {
                    const bad = fieldProblems(i)
                    return (
                      <div key={f.uid} className="px-4 py-3">
                        <div className="grid items-end gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                          <Field label={`Field ${i + 1} · label`}><input className="field sm" value={f.label} disabled={readOnly} onChange={(e) => setField(f.uid, { label: e.target.value, ...(f.keyAuto ? { key: slug(e.target.value) } : {}) })} /></Field>
                          <Field label="Key"><input className="field sm num" value={f.key} disabled={readOnly} onChange={(e) => setField(f.uid, { key: keyOnly(e.target.value), keyAuto: false })} /></Field>
                          <Field label="Kind of answer"><select className="field sm" value={f.type} disabled={readOnly} onChange={(e) => setField(f.uid, { type: e.target.value as FieldType })}>{FIELD_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                          <div className="flex items-center gap-1 pb-[1px]">
                            <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-ink2"><input type="checkbox" checked={f.required} disabled={readOnly} onChange={(e) => setField(f.uid, { required: e.target.checked })} /> required</label>
                            {editable && <>
                              <button className="btn sm icon ghost" disabled={i === 0} aria-label={`Move field ${i + 1} up`} onClick={() => set({ fields: move(draft.fields, i, -1) })}><ArrowUp size={13} /></button>
                              <button className="btn sm icon ghost" disabled={i === draft.fields.length - 1} aria-label={`Move field ${i + 1} down`} onClick={() => set({ fields: move(draft.fields, i, 1) })}><ArrowDown size={13} /></button>
                              <button className="btn sm icon ghost" aria-label={`Remove field ${i + 1}`} onClick={() => set({ fields: draft.fields.filter((x) => x.uid !== f.uid) })}><Trash2 size={13} /></button>
                            </>}
                          </div>
                        </div>
                        {f.type === 'select' && <Field label="Choices, separated by commas" className="mt-3"><input className="field sm" value={f.options} disabled={readOnly} placeholder="Air, Train, Bus" onChange={(e) => setField(f.uid, { options: e.target.value })} /></Field>}
                        {bad.map((p) => <div key={p.text} className="mt-2 text-[11.5px] text-neg">{p.text}</div>)}
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </Section>

          {/* ------------------------------------------------ described */}
          <Section title="The way of working, described">
            <Note className="mb-3">These parts DESCRIBE the way of working for the people who follow it. They configure nothing by themselves: no permission, due date, notification, alert rule or report is set up from them. What a case must do is decided by the steps above.</Note>
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              {DESCRIBED.map((p) => (
                <Field key={p.key} label={p.label} hint={p.hint} className={p.key === 'actors' ? 'sm:col-span-2' : undefined}>
                  {p.rows === 1
                    ? <input className="field" value={draft[p.key]} disabled={readOnly} onChange={(e) => set({ [p.key]: e.target.value } as Partial<Draft>)} />
                    : <textarea className="field" rows={p.rows} value={draft[p.key]} disabled={readOnly} onChange={(e) => set({ [p.key]: e.target.value } as Partial<Draft>)} />}
                </Field>
              ))}
              <Field label="Register kind" hint="The kind of register item a case of this workflow usually belongs to — a lease, a policy, a project. This describes; it links nothing. When a case is started, items of this kind are listed first.">
                {source.data.kinds ? (
                  <select className="field" value={draft.register_kind} disabled={readOnly} onChange={(e) => set({ register_kind: e.target.value })}>
                    <option value="">None</option>
                    {source.data.kinds.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
                    {draft.register_kind && !source.data.kinds.some((k) => k.key === draft.register_kind) && <option value={draft.register_kind}>{human(draft.register_kind)} — not a register kind of this group</option>}
                  </select>
                ) : <input className="field num" value={draft.register_kind} disabled={readOnly} onChange={(e) => set({ register_kind: keyOnly(e.target.value) })} />}
              </Field>
            </Panel>
          </Section>
        </div>

        {/* ---------------------------------------------------- the rail on the right */}
        <div className="min-w-0 space-y-4 self-start xl:sticky xl:top-2">
          <Section title="Path at a glance">
            <Panel className="p-4" lit={false}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted"><Zap size={12} className="text-gold" /> {triggerLabel(draft.trigger_kind)}{!triggerWorks(draft.trigger_kind) && <span className="normal-case tracking-normal text-warn">· intent</span>}</div>
              {draft.steps.length === 0 && <div className="mt-3 text-[12.5px] text-muted">No step yet.</div>}
              {draft.steps.map((s, i) => {
                const bad = stepProblems(i).length > 0
                return (
                  <div key={s.uid}>
                    <div className="ml-[13px] h-3.5 w-px" style={{ background: 'var(--line-strong)' }} />
                    <button className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-surface2" onClick={() => showStep(s.uid)} title="Show this step">
                      <ActionNode action={s.action} size={26} state={s.optional ? 'skipped' : 'plain'} />
                      <span className="min-w-0 flex-1">
                        <span className={cx('block truncate text-[12px] uppercase tracking-[0.06em]', bad ? 'text-neg' : 'text-ink')}>{s.name.trim() || `Step ${i + 1}`}</span>
                        <span className="block truncate text-[11px] text-muted">{actionMeta(s.action).label}{s.links_to ? ` → ${linkMeta(s.links_to).one}` : ''}{s.required_documents.length ? ` · ${plural(s.required_documents.length, 'document')}` : ''}{s.optional ? ' · optional' : ''}</span>
                      </span>
                      <span className="num text-[11px] text-muted">{i + 1}</span>
                    </button>
                  </div>
                )
              })}
              {draft.steps.length > 0 && <><div className="ml-[13px] h-3.5 w-px" style={{ background: 'var(--line-strong)' }} /><div className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.12em] text-muted"><Flag size={12} className="text-pos" /> Case completed</div></>}
            </Panel>
          </Section>

          <Section title={readOnly ? 'The rules it keeps' : 'Before it can be saved'}>
            <Panel className="p-4" lit={false}>
              {problems.length === 0 ? (
                <div className="flex items-start gap-2.5 text-[12.5px] text-ink2"><ListChecks size={16} className="mt-[1px] flex-none text-pos" /><span>{readOnly ? 'This workflow keeps every rule of the engine.' : 'Nothing stands in the way. The engine checks the same rules again when you save, and its answer is final.'}</span></div>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {problems.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink2">
                      <span className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: 'var(--neg)' }} />
                      {p.at === 'step' && draft.steps[p.index] ? <button className="text-left hover:text-ink" onClick={() => showStep(draft.steps[p.index].uid)}>{p.text}</button> : <span>{p.text}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!source.data.roles && <div className="mt-3 border-t border-line pt-2.5 text-[11.5px] text-muted">The roles of this group could not be read with your role, so a role named on a step is checked by the engine only.</div>}
            </Panel>
          </Section>

          {mode !== 'locked' && (
            <Section title="What saving does">
              <Panel className="p-4" lit={false}>
                <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink2"><FileText size={16} className="mt-[2px] flex-none text-gold" /><span>{happens}</span></div>
                <div className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] text-muted">Saving a workflow posts nothing, releases no money and starts no case.</div>
                <Refusal message={refusal} className="mt-3" />
                {editable && (
                  <button className="btn primary mt-3 w-full" disabled={!canSave} title={whyNotSave} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} {mode === 'draft' ? 'Save the draft' : mode === 'version' ? `Save as version ${nextVersion}` : 'Save as a draft'}</button>
                )}
                {editable && whyNotSave && <div className="mt-2 text-[11.5px] text-warn">{whyNotSave}{problems.length > 1 ? ` And ${plural(problems.length - 1, 'more point')}.` : ''}</div>}
              </Panel>
            </Section>
          )}
        </div>
      </div>

      <StatusDialog def={changing && def ? def : null} to={changing ?? 'active'} defs={defs} onClose={() => setChanging(null)} />
    </div>
  )
}

/** One stop on the path: the mark on the left, the line that runs on to the next stop, and what belongs to the stop. */
function Rail({ node, icon, tone, dashed, line, children }: { node?: ReactNode; icon?: ReactNode; tone?: string; dashed?: boolean; line?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-10 flex-none flex-col items-center">
        {node ?? (
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full border" style={{ color: tone, borderStyle: dashed ? 'dashed' : 'solid', borderColor: `color-mix(in srgb, ${tone ?? 'var(--ink-2)'} 45%, transparent)`, background: 'var(--surface-solid)' }}>{icon}</span>
        )}
        {line && <span className="w-px flex-1" style={{ background: 'var(--line-strong)', minHeight: 10 }} />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function StepCard({ step, index, count, open, readOnly, roles, problems, onToggle, onChange, onMove, onRemove }: {
  step: StepDraft; index: number; count: number; open: boolean; readOnly: boolean; roles: Role[] | null; problems: Problem[]
  onToggle: () => void; onChange: (patch: Partial<StepDraft>) => void; onMove: (by: number) => void; onRemove: () => void
}) {
  const m = actionMeta(step.action)
  const needs = NEEDS_RECORD.includes(step.action)
  const roleName = (k: string) => (k === '*' ? 'anyone authorised' : roles?.find((r) => r.key === k)?.name ?? human(k))
  const free = DOC_KINDS.filter((k) => !step.required_documents.includes(k.key))
  const label = step.name.trim() || `Step ${index + 1}`
  return (
    <div className="pb-3">
      <Panel lit={false} className={cx('overflow-hidden', problems.length > 0 && 'border-neg/40')}>
        <div className="flex items-start gap-2 px-3.5 py-2.5">
          <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} step ${index + 1}, ${label}`}>
            <span className="num mt-[2px] w-5 flex-none text-[12px] text-gold">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className={cx('block truncate text-[13.5px] font-medium', step.name.trim() ? 'text-ink' : 'text-muted')}>{label}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <ActionChip action={step.action} />
                <span className="chip" title="Who acts at this step">{roleName(step.actor_role || '*')}</span>
                {step.links_to && <span className="chip cyan" title="The step is complete only when it points to this record">→ {linkMeta(step.links_to).one}</span>}
                {step.required_documents.length > 0 && <span className="chip violet" title={step.required_documents.map(docKindName).join(', ')}>{plural(step.required_documents.length, 'document')} required</span>}
                {step.optional && <span className="chip">optional</span>}
                {problems.length > 0 && <span className="chip neg">{plural(problems.length, 'point')} to correct</span>}
              </span>
            </span>
          </button>
          <span className="no-print flex flex-none items-center gap-0.5">
            {!readOnly && <>
              <button className="btn sm icon ghost" disabled={index === 0} aria-label={`Move step ${index + 1} up`} title="Move up" onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
              <button className="btn sm icon ghost" disabled={index === count - 1} aria-label={`Move step ${index + 1} down`} title="Move down" onClick={() => onMove(1)}><ArrowDown size={13} /></button>
              <button className="btn sm icon ghost" aria-label={`Remove step ${index + 1}`} title="Remove this step" onClick={onRemove}><Trash2 size={13} /></button>
            </>}
            <button className="btn sm icon ghost" onClick={onToggle} aria-label={open ? 'Close' : readOnly ? 'Show the details' : 'Edit'} title={open ? 'Close' : readOnly ? 'Show the details' : 'Edit'}>{open ? <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} /> : readOnly ? <ChevronDown size={14} /> : <PencilLine size={13} />}</button>
          </span>
        </div>

        {open && (
          <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
            <Field label="Name of the step" className="sm:col-span-2">
              <input className="field" value={step.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value, ...(step.keyAuto ? { key: slug(e.target.value) } : {}) })} />
            </Field>

            <div className="sm:col-span-2">
              <span className="label">Kind of step</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of step">
                {FLOW_ACTIONS.map((a) => {
                  const am = ACTION_META[a]
                  const Icon = am.icon
                  const on = step.action === a
                  const c = toneVar(am.tone)
                  return (
                    <button key={a} role="radio" aria-checked={on} disabled={readOnly} onClick={() => onChange({ action: a })} title={am.says}
                      className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors', !on && !readOnly && 'hover:bg-surface2', !on && readOnly && 'opacity-45')}
                      style={on ? { color: c, borderColor: c, background: `color-mix(in srgb, ${c} 13%, transparent)` } : { color: 'var(--ink-2)', borderColor: 'var(--line)' }}>
                      <Icon size={13} /> {am.label}
                    </button>
                  )
                })}
              </div>
              <span className="mt-1.5 block text-[11.5px] text-muted">{m.says}</span>
            </div>

            <Field label="Key" hint="Generated from the name; you may change it. Cases record the key of each step.">
              <input className="field num" value={step.key} disabled={readOnly} onChange={(e) => onChange({ key: keyOnly(e.target.value), keyAuto: false })} />
            </Field>
            <Field label="Who acts" hint={step.action === 'approval' ? 'Whoever is chosen, the person who started the case cannot approve it.' : 'A role, or anyone who may work on cases in the company.'}>
              <select className="field" value={step.actor_role || '*'} disabled={readOnly} onChange={(e) => onChange({ actor_role: e.target.value })}>
                <option value="*">Anyone authorised</option>
                {(roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                {step.actor_role && step.actor_role !== '*' && !(roles ?? []).some((r) => r.key === step.actor_role) && <option value={step.actor_role}>{human(step.actor_role)}{roles ? ' — not a role of this group' : ''}</option>}
              </select>
            </Field>

            <Field label={needs ? 'Record the step points to (required)' : 'Record the step points to (optional)'} className="sm:col-span-2"
              hint={needs ? `${m.label} happens through a record, never through the workflow. The step is complete only when it points to that record.` : step.links_to ? 'The step is complete only when it points to a record of this kind.' : 'Leave empty when the step is complete by being recorded.'}>
              <select className="field" value={step.links_to} disabled={readOnly} onChange={(e) => onChange({ links_to: e.target.value as FlowLink | '' })}>
                <option value="">{needs ? 'Choose…' : 'None'}</option>
                {FLOW_LINKS.map((l) => <option key={l} value={l}>{linkMeta(l).one.replace(/^./, (c) => c.toUpperCase())} · {linkMeta(l).where}</option>)}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <span className="label">Documents required at this step</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {step.required_documents.length === 0 && <span className="text-[12.5px] text-muted">None.</span>}
                {step.required_documents.map((k) => (
                  <span key={k} className="chip violet">
                    {docKindName(k)}
                    {!readOnly && <button className="-mr-1 grid h-4 w-4 place-items-center rounded-full hover:bg-surface2" aria-label={`Do not require ${docKindName(k)}`} onClick={() => onChange({ required_documents: step.required_documents.filter((x) => x !== k) })}><X size={10} /></button>}
                  </span>
                ))}
                {!readOnly && free.length > 0 && (
                  <select className="field sm" style={{ width: 230 }} value="" aria-label="Require a kind of document" onChange={(e) => { if (e.target.value) onChange({ required_documents: [...step.required_documents, e.target.value] }) }}>
                    <option value="">Require a kind of document…</option>
                    {free.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
                  </select>
                )}
              </div>
              <span className="mt-1.5 block text-[11.5px] text-muted">A document of each kind must be attached to the case before the step can be completed. The engine checks the kind, not the content.</span>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink2 sm:col-span-2">
              <input type="checkbox" className="mt-[3px]" checked={step.optional} disabled={readOnly} onChange={(e) => onChange({ optional: e.target.checked })} />
              <span><span className="text-ink">Optional</span><span className="block text-[11.5px] text-muted">An optional step can be skipped, with a reason. Every other step must be completed in its turn.</span></span>
            </label>

            <Field label="Guidance" className="sm:col-span-2" hint="Shown to the person whose turn it is.">
              <textarea className="field" rows={2} value={step.guidance} disabled={readOnly} onChange={(e) => onChange({ guidance: e.target.value })} />
            </Field>

            {problems.length > 0 && <div className="space-y-1 sm:col-span-2">{problems.map((p) => <div key={p.text} className="text-[11.5px] text-neg">{p.text}</div>)}</div>}
          </div>
        )}
      </Panel>
    </div>
  )
}
