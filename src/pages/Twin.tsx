import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, Camera, CloudLightning, FilePlus2, FlaskConical, FolderOpen, GitCompareArrows, Plus, Save, Trash2 } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { Scenario, ScenarioRun, Shock, ShockKind, TwinDriver } from '@/engine/p3Types'
import { compare, driverFits, simulate, standardCases, SHOCK_KINDS, type TwinBase, type TwinResult } from '@/engine/twin'
import { loadTwin } from '@/lib/twinData'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { fmtMoney } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { DemoTag, MissingSources, NoAccess, Simulated, SimulationBanner, digits, signed, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { TrendChart } from '@/ui/charts'
import {
  BaseFacts, BOOKS_CONTINUE, DriversTab, KIND_SPEC, ResultView, RulesTab, Sentences, Sim, TOP3, ValuationTab,
  checkDraft, driverValue, fromShock, kindOf, newDraft, num, one, readResult, toShock, useWho, type Draft,
} from './TwinParts'

// =====================================================================
// Digital twin — the scenario lab (spec 54, 89, 427, 428, 508, 815,
// 1285, 1295-1297, 1358, 1359, 1798, 1799, 1901).
// A model of a company or of the group, built from the books, on which
// a decision can be tried before it is taken.
// EVERYTHING on this screen is a SIMULATION. It is never added to, or
// shown as, an actual. Nothing here posts, approves, pays or changes a
// budget or a forecast. NUMERO never moves money.
// =====================================================================

type TabKey = 'model' | 'compare' | 'saved' | 'drivers' | 'valuation' | 'rules'
type CaseKey = 'typed' | 'optimistic' | 'conservative'
interface Meta { name: string; kind: Scenario['kind']; description: string; shared: boolean }
interface Candidate { key: string; name: string; sub: string; shocks: Shock[] }

const KIND_LABEL: Record<Scenario['kind'], string> = { base: 'Base', optimistic: 'Optimistic', conservative: 'Conservative', custom: 'Custom' }
const CASES: { key: CaseKey; label: string; tip: string }[] = [
  { key: 'typed', label: 'As typed', tip: 'The assumptions exactly as they are entered below' },
  { key: 'optimistic', label: 'Optimistic', tip: 'Each adverse assumption is halved; each favourable one is raised by half. Amounts of money, people hired and projects are left as typed.' },
  { key: 'conservative', label: 'Conservative', tip: 'Each adverse assumption is raised by half; each favourable one is halved. Amounts of money, people hired and projects are left as typed.' },
]
const LINES = ['var(--cyan)', 'var(--violet)', 'var(--gold)', 'var(--pos)']
const clampHorizon = (s: string) => Math.max(1, Math.min(60, Math.round(num(s) ?? 12)))
const normal = (s: Shock[]) => JSON.stringify(s.map((x) => toShock(fromShock(x))))

export default function Twin() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('scenario.view', id))
  if (!ids.length) return <NoAccess eyebrow="Simulations" title="Digital twin" perm="scenario.view" />
  return <TwinView ids={ids} leftOut={scope.length - ids.length} />
}

function TwinView({ ids, leftOut }: { ids: ID[]; leftOut: number }) {
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const idsKey = ids.join(',')
  const single = ids.length === 1 ? companies.find((c) => c.id === ids[0]) ?? null : null
  const codes = companies.filter((c) => ids.includes(c.id)).map((c) => c.code)

  const wanted = sp.get('tab')
  const scenarioParam = sp.get('scenario')
  const tab: TabKey = (['model', 'compare', 'saved', 'drivers', 'valuation', 'rules'] as TabKey[]).find((t) => t === wanted) ?? 'model'
  const go = (k: TabKey) => { const n = new URLSearchParams(sp); n.set('tab', k); setSp(n, { replace: true }) }

  const [basis, setBasis] = useState(6)
  const [horizonText, setHorizonText] = useState('12')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [caseKey, setCaseKey] = useState<CaseKey>('typed')
  const [meta, setMeta] = useState<Meta>({ name: '', kind: 'custom', description: '', shared: false })
  const [loadedId, setLoadedId] = useState<ID | null>(null)
  const [dialog, setDialog] = useState<null | 'scenario' | 'run'>(null)
  const opened = useRef<string | null>(null)

  // the starting point is read once for the companies and the months chosen; the model itself runs on screen
  const twin = useAsync(() => loadTwin(api, companies, accounts, ids, { can, basisMonths: basis }), [api, idsKey, basis, accounts.length, companies.length])
  const scenarios = useAsync(() => api.listScenarios(), [api])

  const mayManage = ids.some((id) => can('scenario.manage', id))
  const noManage = mayManage ? undefined : 'Your role does not include scenario.manage in the selected companies'
  const base = twin.data?.base ?? null
  const missing = twin.data?.missing ?? []
  // a company twin reads the drivers of that company first, then those of the group; a group twin reads those of the group
  const drivers = useMemo(() => (twin.data?.drivers ?? []).filter((d) => !d.company_id || (ids.length === 1 && d.company_id === ids[0])).sort((a, b) => Number(!!b.company_id) - Number(!!a.company_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [twin.data, idsKey])

  const H = clampHorizon(horizonText)
  const horizonProblem = num(horizonText) === null || (num(horizonText) as number) < 1 || (num(horizonText) as number) > 60 ? 'The model looks between 1 and 60 months ahead.' : null
  const checks = useMemo(() => new Map(drafts.map((d) => [d.id, base ? checkDraft(d, base, H) : { blocking: [], warnings: [] }])), [drafts, base, H])
  const blocked = drafts.filter((d) => (checks.get(d.id)?.blocking.length ?? 0) > 0).length
  const typed = useMemo(() => drafts.filter((d) => !(checks.get(d.id)?.blocking.length)).map(toShock), [drafts, checks])
  const cases = useMemo(() => standardCases(typed), [typed])
  const shocks = useMemo(() => (caseKey === 'typed' ? typed : cases.find((c) => c.kind === caseKey)?.shocks ?? typed), [caseKey, typed, cases])
  const name = meta.name.trim() || 'Scenario in the lab'
  const resultName = caseKey === 'typed' ? name : `${name} — ${caseKey}`

  const baseCase = useMemo(() => (base ? simulate(base, [], H, BOOKS_CONTINUE, drivers) : null), [base, H, drivers])
  const result = useMemo(() => (base ? simulate(base, shocks, H, resultName, drivers) : null), [base, shocks, H, resultName, drivers])

  const loaded = loadedId ? (scenarios.data ?? []).find((s) => s.id === loadedId) ?? null : null
  const mine = !!loaded && !!session && loaded.created_by === session.user.id
  const canOverwrite = !!loaded && (mine || !!session?.isGroupAdmin)
  const changed = !loaded || loaded.horizon_months !== H || normal(loaded.shocks) !== JSON.stringify(shocks)

  const load = (s: Scenario) => {
    opened.current = s.id
    setLoadedId(s.id); setDrafts(s.shocks.map(fromShock)); setHorizonText(String(s.horizon_months)); setCaseKey('typed')
    setMeta({ name: s.name, kind: s.kind, description: s.description ?? '', shared: s.shared })
  }
  // a saved scenario named in the address is loaded into the lab once; what is typed afterwards is not overwritten
  useEffect(() => {
    if (!scenarioParam || !scenarios.data || opened.current === scenarioParam) return
    const s = scenarios.data.find((x) => x.id === scenarioParam)
    if (s) load(s)
  }, [scenarioParam, scenarios.data])
  const notFound = !!scenarioParam && !!scenarios.data && !scenarios.data.some((s) => s.id === scenarioParam)

  const point = (id: ID | null, to: TabKey = 'model') => {
    const n = new URLSearchParams(sp)
    n.set('tab', to)
    if (id) n.set('scenario', id); else n.delete('scenario')
    setSp(n, { replace: true })
  }
  const startNew = () => {
    opened.current = null
    setLoadedId(null); setDrafts([]); setCaseKey('typed'); setMeta({ name: '', kind: 'custom', description: '', shared: false })
    point(null)
  }

  const runInput = (scenarioId: ID, note: string) => {
    if (!base || !result) throw new Error('The model has not been read yet.')
    return { scenario_id: scenarioId, company_ids: ids, as_of: base.asOf, base: { ...base }, result: { ...result, shocks, case: caseKey, missing }, note: note.trim() || undefined }
  }
  const saveScenario = async (asNew: boolean, withRun: boolean, note: string) => {
    const id = await act(() => api.saveScenario({
      id: !asNew && canOverwrite && loaded ? loaded.id : undefined, company_id: ids.length === 1 ? ids[0] : null, name: meta.name.trim(), kind: meta.kind,
      description: meta.description.trim() || null, horizon_months: H, shared: meta.shared, status: 'saved', shocks,
    }), 'Scenario saved. It is a simulation: nothing in the books has changed')
    if (!id) return
    // what was saved is what the lab now holds: a softened or hardened case becomes the assumptions as typed
    opened.current = id
    setLoadedId(id); setDrafts(shocks.map(fromShock)); setCaseKey('typed'); point(id)
    if (withRun) await act(() => api.saveScenarioRun(runInput(id, note)), 'Result saved as a run, labelled SIMULATION')
    setDialog(null)
  }
  const saveRun = async (note: string) => {
    if (!loaded) return
    const id = await act(() => api.saveScenarioRun(runInput(loaded.id, note)), 'Result saved as a run, labelled SIMULATION')
    if (id) setDialog(null)
  }

  const candidates: Candidate[] = useMemo(() => {
    const out: Candidate[] = [{ key: 'base', name: BOOKS_CONTINUE, sub: 'no assumption: the base case', shocks: [] }]
    if (typed.length) {
      out.push({ key: 'lab', name: `${name} (in the lab)`, sub: `${typed.length} assumption${typed.length === 1 ? '' : 's'}, as typed`, shocks: typed })
      for (const c of cases) out.push({ key: 'lab:' + c.kind, name: `${name} — ${c.kind}`, sub: c.kind === 'optimistic' ? 'adverse assumptions halved' : 'adverse assumptions raised by half', shocks: c.shocks })
    }
    const seen = new Set(out.map((c) => c.name))
    for (const s of scenarios.data ?? []) {
      if (s.status === 'archived') continue
      let label = `${s.name} (saved)`
      for (let i = 2; seen.has(label); i++) label = `${s.name} (saved, ${i})`
      seen.add(label)
      out.push({ key: 'saved:' + s.id, name: label, sub: `${KIND_LABEL[s.kind]} · ${s.shocks.length} assumption${s.shocks.length === 1 ? '' : 's'} · saved for ${s.horizon_months} months`, shocks: s.shocks })
    }
    return out
  }, [typed, cases, name, scenarios.data])

  const savedCount = (scenarios.data ?? []).filter((s) => s.status !== 'archived').length
  const saveProblem = !mayManage ? noManage : !base ? 'The starting point has not been read' : horizonProblem ?? (blocked ? 'Complete or remove the assumptions marked before saving' : undefined)
  // a run carries figures of the books: it is saved, and later shown, only where the person reads the books of every company in it
  const runProblem = ids.every((id) => can('report.view', id)) ? undefined : 'A run holds figures of the books. Saving one needs the permission report.view in every company selected.'

  return (
    <div>
      <PageHeader
        eyebrow="Simulations"
        title="Digital twin"
        subtitle={<>
          {single ? <><strong className="font-medium text-ink2">Company twin</strong> — {single.name}.</> : <><strong className="font-medium text-ink2">Group twin</strong> — {ids.length} companies together ({codes.join(', ')}).</>}
          {' '}A model built from the books, on which a decision can be tried before it is taken. Nothing here reaches the books. <DemoTag className="ml-1" />
        </>}
        actions={tab === 'model' ? <>
          <button className="btn ghost" onClick={startNew} disabled={!drafts.length && !loaded}><FilePlus2 size={15} /> New scenario</button>
          <button className="btn" disabled={busy || !!saveProblem || !!runProblem || !loaded || changed} title={saveProblem ?? runProblem ?? (!loaded ? 'Save the scenario first: a run belongs to a saved scenario' : changed ? 'The assumptions have changed since the scenario was saved. Save the scenario first.' : 'Keeps the figures of this result as a record labelled SIMULATION')} onClick={() => setDialog('run')}><Camera size={15} /> Save this result</button>
          <button className="btn primary" disabled={busy || !!saveProblem} title={saveProblem} onClick={() => setDialog('scenario')}><Save size={15} /> Save scenario</button>
        </> : undefined}
      />

      <Tabs<TabKey>
        tabs={[
          { key: 'model', label: 'Scenario lab' }, { key: 'compare', label: 'Compare' }, { key: 'saved', label: 'Saved scenarios', count: scenarios.data ? savedCount : undefined },
          { key: 'drivers', label: 'Assumptions library' }, { key: 'valuation', label: 'Valuation lab' }, { key: 'rules', label: 'Try a rule' },
        ]}
        value={tab} onChange={go}
      />

      {leftOut > 0 && <Note kind="warn" className="mb-4">{leftOut} of the companies selected {leftOut === 1 ? 'is' : 'are'} left out of this twin: your role does not include scenario.view there. {leftOut === 1 ? 'Its' : 'Their'} books are not in any figure on this screen.</Note>}

      {tab === 'drivers' && <DriversTab />}
      {tab === 'rules' && <RulesTab ids={ids} />}
      {tab === 'saved' && <SavedTab scenarios={scenarios} currentId={loadedId} mayManage={mayManage} noManage={noManage} onOpen={(id) => { const s = scenarios.data?.find((x) => x.id === id); if (s) load(s); point(id) }} />}

      {(tab === 'model' || tab === 'compare' || tab === 'valuation') && (
        <>
          {twin.error && <ErrorBox message={twin.error} retry={twin.reload} />}
          {!twin.error && !base && <Panel><Loading rows={7} label="Reading the starting point from the books" /></Panel>}
          {base && baseCase && result && tab === 'model' && (
            <div>
              <SimulationBanner />
              {!mayManage && <Note className="mb-4">You can build a scenario and run the model on this screen. Saving a scenario or a result needs the permission <span className="num text-ink">scenario.manage</span>; what you build here is kept only while this page is open.</Note>}
              {notFound && <Note kind="warn" className="mb-4">The scenario you were sent to was not found, or it is private to the person who built it. <button className="link" onClick={() => point(null)}>Dismiss</button></Note>}
              {loaded && (
                <Note className="mb-4">
                  Opened from the saved scenario <strong className="text-ink">{loaded.name}</strong> ({KIND_LABEL[loaded.kind]}, {loaded.shared ? 'shared' : 'private'}, saved for {loaded.company_id ? companies.find((c) => c.id === loaded.company_id)?.name ?? 'a company not shared with you' : 'the group'}).
                  {(loaded.company_id ?? null) !== (ids.length === 1 ? ids[0] : null) && <> The selection now is {single ? single.name : `${ids.length} companies`}: the assumptions are applied to the books of the selection now.</>}
                  {!canOverwrite && <> It was built by someone else: saving keeps a copy under your name.</>}
                  {changed && <> The assumptions differ from what is saved.</>}
                </Note>
              )}
              <MissingSources missing={missing} className="mb-4" />

              <StartingPoint base={base} H={H} basis={basis} setBasis={setBasis} loading={twin.loading} />

              <Builder base={base} drivers={drivers} drafts={drafts} setDrafts={setDrafts} checks={checks} H={H} horizonText={horizonText} setHorizonText={setHorizonText} horizonProblem={horizonProblem}
                caseKey={caseKey} setCaseKey={setCaseKey} shocks={shocks} blocked={blocked} />

              <div className="mb-3 mt-6 flex flex-wrap items-center gap-2">
                <h2 className="display m-0 text-[17px] font-medium text-ink">The result</h2>
                <Simulated />
                <span className="text-[12px] text-muted">{resultName} · {H} month{H === 1 ? '' : 's'} from {fmtDate(base.asOf)} · recalculated as the assumptions change · amounts rounded</span>
              </div>
              {blocked > 0 && <Note kind="warn" className="mb-4">{blocked} assumption{blocked === 1 ? ' is' : 's are'} incomplete and {blocked === 1 ? 'is' : 'are'} not in this result. {blocked === 1 ? 'It is' : 'They are'} marked above.</Note>}
              <ResultView result={result} against={baseCase} startCash={base.cash} exportName={`SIMULATION-digital-twin-${slug(resultName)}`} />
            </div>
          )}
          {base && tab === 'compare' && <CompareTab base={base} drivers={drivers} candidates={candidates} defaultHorizon={H} missing={missing} />}
          {base && tab === 'valuation' && <><MissingSources missing={missing} className="mb-4" /><ValuationTab base={base} drivers={drivers} shocks={shocks} scenarioName={resultName} ids={ids} /></>}
        </>
      )}

      <SaveDialog open={dialog === 'scenario'} busy={busy} meta={meta} setMeta={setMeta} H={H} count={shocks.length} caseKey={caseKey} scope={single ? single.name : `the group — ${ids.length} companies`}
        kept={ids.length > 1 && ids.length < companies.length ? `A scenario belongs to one company or to the group. This one is kept for the group, although it was built on ${ids.length} of its ${companies.length} companies (${codes.join(', ')}). Every saved run records the companies it was run on.` : undefined}
        loaded={loaded} canOverwrite={canOverwrite} runProblem={runProblem} onCancel={() => setDialog(null)} onSave={(asNew, withRun, note) => void saveScenario(asNew, withRun, note)} />
      <RunDialog open={dialog === 'run'} busy={busy} name={loaded?.name ?? ''} onCancel={() => setDialog(null)} onSave={(note) => void saveRun(note)} />
    </div>
  )
}

/** the size of an assumption in its own unit; an amount of money is hidden in privacy mode */
const shockValue = (s: Shock, currency: string, privacy: boolean) => {
  const unit = kindOf(s.kind)?.unit
  const v = Number.isFinite(s.value) ? s.value : 0
  const withSign = `${v > 0 ? '+' : ''}${v}`
  return unit === 'amount' ? (currency ? fmtMoney(v, { currency, compact: true, mask: privacy }) : String(v)) : unit === 'percent' ? `${withSign}%` : unit === 'points' ? `${withSign} points` : unit === 'days' ? `${withSign} days` : String(v)
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scenario'

// ------------------------------------------------------------------ the starting point
function StartingPoint({ base, H, basis, setBasis, loading }: { base: TwinBase; H: number; basis: number; setBasis: (n: number) => void; loading: boolean }) {
  const c = base.currency
  const total = (xs: number[]) => xs.slice(0, H).reduce((s, v) => s + (v ?? 0), 0)
  const repay = total(base.debtRepayments), out = total(base.committedOut), inn = total(base.committedIn)
  const cell = 'flex items-baseline justify-between gap-3 border-b border-line py-[7px] text-[12.5px] last:border-0'
  return (
    <Section title="The starting point — what the books say" className="mb-5"
      right={
        <span className="flex items-center gap-2 text-[12px] text-muted">
          {loading && <Spinner size={13} />}
          <label htmlFor="twin-basis">Rates averaged over</label>
          <select id="twin-basis" className="field sm" style={{ width: 130 }} value={basis} onChange={(e) => setBasis(Number(e.target.value))}>
            {[3, 6, 12].map((n) => <option key={n} value={n}>the last {n} months</option>)}
          </select>
        </span>
      }>
      <Panel className="p-4" lit={false}>
        <BaseFacts base={base} currency={c} />
        <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-line pt-4 md:grid-cols-3">
          <div className="min-w-0">
            <div className="mb-1 text-[11.5px] font-medium text-ink2">Already firm, over the {H} month{H === 1 ? '' : 's'} ahead</div>
            <div className={cell}><span className="text-ink2">Repayments of borrowings, as scheduled</span><Money value={repay} currency={c} decimals={0} /></div>
            <div className={cell}><span className="text-ink2">Open orders for assets</span><Money value={out} currency={c} decimals={0} /></div>
            {inn !== 0 && <div className={cell}><span className="text-ink2">Firm one-off receipts</span><Money value={inn} currency={c} decimals={0} /></div>}
            <div className="mt-1 text-[11.5px] text-muted">From the loan register and the purchase orders. They enter every simulation in the month they fall due.</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[11.5px] font-medium text-ink2">Largest customers, by what they were billed</div>
            {base.customers.length === 0 ? <div className="text-[12.5px] text-muted">The books show no customer in the months the model rests on.</div>
              : base.customers.slice(0, 4).map((k) => <div key={k.id} className={cell}><span className="min-w-0 truncate text-ink2">{k.name}</span><span className="flex-none text-muted"><span className="num text-ink2">{base.revenue > 0 ? one((k.monthlyRevenue / base.revenue) * 100) : '—'}%</span> of revenue</span></div>)}
            {base.customers.length > 4 && <div className="mt-1 text-[11.5px] text-muted">and {base.customers.length - 4} more, all available to an assumption</div>}
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[11.5px] font-medium text-ink2">Largest kinds of operating expense, a month</div>
            {base.categories.length === 0 ? <div className="text-[12.5px] text-muted">No operating expense ledger carries a balance in those months.</div>
              : base.categories.slice(0, 4).map((k) => <div key={k.key} className={cell}><span className="min-w-0 truncate text-ink2">{k.label}</span><Money value={k.monthly} currency={c} decimals={0} /></div>)}
            {base.categories.length > 4 && <div className="mt-1 text-[11.5px] text-muted">and {base.categories.length - 4} more, all available to an assumption</div>}
          </div>
        </div>
        {base.basisMonths < basis && <div className="mt-3 text-[11.5px] text-warn">The books hold {base.basisMonths} complete month{base.basisMonths === 1 ? '' : 's'} of the {basis} asked for. The rates are the average of {base.basisMonths}.</div>}
      </Panel>
    </Section>
  )
}

// ------------------------------------------------------------------ the assumptions
interface BuilderProps {
  base: TwinBase; drivers: TwinDriver[]; drafts: Draft[]; setDrafts: (f: (d: Draft[]) => Draft[]) => void; checks: Map<string, { blocking: string[]; warnings: string[] }>
  H: number; horizonText: string; setHorizonText: (s: string) => void; horizonProblem: string | null; caseKey: CaseKey; setCaseKey: (k: CaseKey) => void; shocks: Shock[]; blocked: number
}
function Builder({ base, drivers, drafts, setDrafts, checks, H, horizonText, setHorizonText, horizonProblem, caseKey, setCaseKey, shocks, blocked }: BuilderProps) {
  const privacy = useApp((s) => s.privacy)
  const c = base.currency
  const add = (...list: Draft[]) => setDrafts((d) => [...d, ...list])
  const change = (id: string, p: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const top = base.customers[0]
  const category = (re: RegExp) => base.categories.find((k) => re.test(k.label))
  const fuel = category(/fuel|diesel|petrol/i), marketing = category(/marketing|advertis|promotion/i)
  const big = (v: number) => fmtMoney(v, { currency: c, compact: true })

  const wrong: { key: string; label: string; off?: string; make: () => Draft }[] = [
    { key: 'lost', label: top ? `Largest customer is lost — ${top.name}` : 'Largest customer is lost', off: top ? undefined : 'The books show no customer to lose', make: () => newDraft('lose_customer', { value: '100', target: top?.name ?? '', targetId: top?.id ?? '' }) },
    { key: 'late', label: 'Customers pay 30 days later', make: () => newDraft('collection_delay_days', { value: '30' }) },
    { key: 'rates', label: 'Interest rates rise 2 points', make: () => newDraft('interest_rate_pts', { value: '2' }) },
    { key: 'overrun', label: 'Costs of sale overrun 10%', make: () => newDraft('project_overrun_pct', { value: '10' }) },
    { key: 'top3', label: 'The three largest customers pay 60 days late', off: base.customers.length ? undefined : 'The books show no customers', make: () => newDraft('collection_delay_days', { value: '60', target: TOP3 }) },
  ]
  const examples: { key: string; label: string; make: () => Draft }[] = [
    { key: 'rev-', label: 'Revenue falls 20%', make: () => newDraft('revenue_pct', { value: '-20' }) },
    { key: 'rev+', label: 'Revenue grows 25%', make: () => newDraft('revenue_pct', { value: '25' }) },
    { key: 'exp', label: 'Expenses rise 15%', make: () => newDraft('expense_pct', { value: '15' }) },
    { key: 'pay', label: 'Payroll rises 15%', make: () => newDraft('payroll_pct', { value: '15' }) },
    ...(fuel ? [{ key: 'fuel', label: `${fuel.label} rises 20%`, make: () => newDraft('category_pct', { value: '20', target: fuel.key }) }] : []),
    ...(marketing ? [{ key: 'mkt', label: `${marketing.label} doubles`, make: () => newDraft('category_pct', { value: '100', target: marketing.key }) }] : []),
    { key: 'capex', label: `An asset of ${big(50000000)} is bought`, make: () => newDraft('capex', { value: '50000000', extra: '120' }) },
    { key: 'loan', label: `${big(100000000)} is borrowed`, make: () => newDraft('new_borrowing', { value: '100000000', months: '60' }) },
    { key: 'hire', label: '100 people are hired', make: () => newDraft('new_hires', { value: '100' }) },
    { key: 'project', label: `A project of ${big(500000000)} starts`, make: () => newDraft('new_project', { value: '500000000', months: '24' }) },
  ]
  const together = wrong.slice(0, 4).filter((w) => !w.off)

  return (
    <Section title="Assumptions — what is being tried" className="mb-2"
      right={<span className="text-[12px] text-muted">{drafts.length === 0 ? 'none: the books continue as they are' : `${drafts.length} in the lab${blocked ? ` · ${blocked} incomplete` : ''}`}</span>}>
      <Panel className="p-4" lit={false}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xl border border-line p-3.5" style={{ background: 'var(--warn-soft)' }}>
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink"><CloudLightning size={15} className="text-warn" /> What if this goes wrong?</div>
            <div className="flex flex-wrap gap-1.5">
              {wrong.map((w) => <button key={w.key} className="btn sm" disabled={!!w.off} title={w.off ?? 'Adds this assumption to the lab'} onClick={() => add(w.make())}><Plus size={12} /> {w.label}</button>)}
            </div>
            <button className="btn sm primary mt-2.5" disabled={!together.length} onClick={() => add(...together.map((w) => w.make()))} title="Adds them as separate assumptions; each can then be changed or removed">
              <CloudLightning size={13} /> All of the first {together.length} together
            </button>
          </div>
          <div className="min-w-0 rounded-xl border border-line p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink"><FlaskConical size={15} className="text-violet" /> Or start from a decision</div>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((w) => <button key={w.key} className="btn sm ghost" title="Adds this assumption to the lab; change the figures to your own" onClick={() => add(w.make())}><Plus size={12} /> {w.label}</button>)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-4">
          <div>
            <label className="label" htmlFor="twin-horizon">Months to look ahead (1 to 60)</label>
            <div className="flex items-center gap-1.5">
              <input id="twin-horizon" className="field sm num" style={{ width: 84 }} inputMode="numeric" value={horizonText} onChange={(e) => setHorizonText(e.target.value.replace(/\D/g, '').slice(0, 2))} />
              {[12, 24, 36, 60].map((n) => <button key={n} className={cx('btn sm', H === n && !horizonProblem ? '' : 'ghost')} aria-pressed={H === n} onClick={() => setHorizonText(String(n))}>{n}</button>)}
            </div>
            {horizonProblem && <div className="mt-1 text-[11.5px] text-warn">{horizonProblem} {H} is used.</div>}
          </div>
          <div>
            <div className="label">Case</div>
            <div className="inline-flex gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Case">
              {CASES.map((k) => (
                <button key={k.key} aria-pressed={caseKey === k.key} title={k.tip} disabled={k.key !== 'typed' && !drafts.length} onClick={() => setCaseKey(k.key)}
                  className={cx('h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40', caseKey === k.key ? 'border-line2 bg-surface2 text-ink' : 'border-transparent text-muted hover:text-ink2')}>{k.label}</button>
              ))}
            </div>
          </div>
          <div className="min-w-[220px] flex-1 text-[11.5px] leading-relaxed text-muted">{CASES.find((k) => k.key === caseKey)?.tip}.</div>
        </div>

        {drafts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-line2 px-4 py-6 text-center">
            <div className="text-[13px] text-ink2">No assumption yet. The result below is the base case: the books continuing as they have been.</div>
            <div className="mt-3"><button className="btn sm primary" onClick={() => add(newDraft('revenue_pct'))}><Plus size={13} /> Add an assumption</button></div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {drafts.map((d, i) => (
              <AssumptionRow key={d.id} n={i + 1} d={d} base={base} drivers={drivers} check={checks.get(d.id) ?? { blocking: [], warnings: [] }}
                onChange={(p) => change(d.id, p)} onRemove={() => setDrafts((xs) => xs.filter((x) => x.id !== d.id))} />
            ))}
            <button className="btn sm" disabled={drafts.length >= 24} onClick={() => add(newDraft('revenue_pct'))}><Plus size={13} /> Add an assumption</button>
          </div>
        )}
        {caseKey !== 'typed' && drafts.length > 0 && (
          <div className="mt-4 rounded-xl border border-line px-3.5 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink2"><Simulated label={caseKey.toUpperCase()} /> The values the model uses in this case</div>
            <div className="flex flex-wrap gap-1.5">
              {shocks.map((s, i) => <span key={i} className="chip">{s.label ?? kindOf(s.kind)?.label ?? s.kind}: <span className="num">{shockValue(s, c, privacy)}</span></span>)}
            </div>
            <div className="mt-1.5 text-[11.5px] text-muted">The figures typed above are not changed. Saving the scenario in this case saves these values.</div>
          </div>
        )}
      </Panel>
    </Section>
  )
}

function AssumptionRow({ n, d, base, drivers, check, onChange, onRemove }: { n: number; d: Draft; base: TwinBase; drivers: TwinDriver[]; check: { blocking: string[]; warnings: string[] }; onChange: (p: Partial<Draft>) => void; onRemove: () => void }) {
  const privacy = useApp((s) => s.privacy)
  const spec = KIND_SPEC[d.kind]
  const k = kindOf(d.kind)
  const driver = d.driver ? drivers.find((x) => x.key === d.driver) ?? null : null
  // a driver supplies the value only when it is approved and stated in the unit of the assumption: the engine applies the same rule
  const fits = (x: TwinDriver) => !k || driverFits(x.unit, k.unit)
  const supplies = !!driver && driver.status === 'approved' && fits(driver)
  const unitWord = (u: string) => (u === 'rate' ? 'percent a year' : u === 'points' ? 'percentage points' : u === 'amount' ? 'an amount' : u === 'count' ? 'a count' : u)
  const money = k?.unit === 'amount'
  const clean = spec.min !== undefined && spec.min >= 0 ? digits : signed
  const share = (v: number) => (base.revenue > 0 ? `${one((v / base.revenue) * 100)}% of revenue` : 'no revenue in the books')
  const customerValue = d.target === TOP3 ? TOP3 : d.targetId && base.customers.some((x) => x.id === d.targetId) ? d.targetId : d.target ? 'other' : ''
  const typedAmount = num(d.value)

  return (
    <div className={cx('rounded-xl border p-3.5', check.blocking.length ? 'border-warn/50' : 'border-line')} style={check.blocking.length ? { background: 'var(--warn-soft)' } : undefined}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="num grid h-6 w-6 flex-none place-items-center rounded-full border border-line2 text-[11px] text-ink2">{n}</span>
        <select className="field sm" style={{ width: 'auto', minWidth: 230 }} value={d.kind} aria-label={`Assumption ${n}: what changes`}
          onChange={(e) => onChange({ kind: e.target.value as ShockKind, target: '', targetId: '', extra: '', months: e.target.value === 'new_project' ? '12' : '', driver: '' })}>
          {SHOCK_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
        </select>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted">{k?.hint}</span>
        <button className="btn ghost icon sm" onClick={onRemove} aria-label={`Remove assumption ${n}`}><Trash2 size={13} /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={spec.value} hint={money && typedAmount !== null && typedAmount !== 0 ? `${fmtMoney(typedAmount, { currency: base.currency, compact: true, mask: privacy })} in ${base.currency}` : undefined}>
          <input className={cx('field num', supplies && 'opacity-60')} inputMode="decimal" value={d.value} onChange={(e) => onChange({ value: clean(e.target.value) })} />
        </Field>
        <Field label={spec.once ? 'In month' : 'From month'} hint="1 = next month">
          <input className="field num" inputMode="numeric" value={d.from} onChange={(e) => onChange({ from: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
        </Field>
        {spec.target === 'category' && (
          <Field label="Kind of expense" hint="Operating expense ledgers that carry a balance">
            <select className="field" value={d.target} onChange={(e) => onChange({ target: e.target.value })}>
              <option value="">Choose…</option>
              {base.categories.map((x) => <option key={x.key} value={x.key}>{x.label} — {fmtMoney(x.monthly, { currency: base.currency, compact: true, mask: privacy })} a month</option>)}
              {d.target && !base.categories.some((x) => x.key === d.target) && <option value={d.target}>{d.target} — not in these books</option>}
            </select>
          </Field>
        )}
        {spec.target === 'customer' && (
          <Field label={spec.targetRequired ? 'Customer' : 'Which customers'} hint={base.customers.length ? 'The 25 largest by what they were billed' : 'The books show no customers'}>
            <select className="field" value={customerValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === '' || v === TOP3) return onChange({ target: v, targetId: '' })
                const cu = base.customers.find((x) => x.id === v)
                if (cu) onChange({ target: cu.name, targetId: cu.id })
              }}>
              <option value="">{spec.targetRequired ? 'Choose…' : 'All customers'}</option>
              <option value={TOP3}>The three largest customers together</option>
              {base.customers.map((x) => <option key={x.id} value={x.id}>{x.name} — {share(x.monthlyRevenue)}</option>)}
              {customerValue === 'other' && <option value="other">{d.target} — not in these books</option>}
            </select>
          </Field>
        )}
        {spec.extra && <Field label={spec.extra.label} hint={spec.extra.hint}><input className="field num" inputMode="decimal" value={d.extra} onChange={(e) => onChange({ extra: (spec.extra?.min !== undefined && spec.extra.min >= 0 ? digits : signed)(e.target.value) })} /></Field>}
        {spec.months && <Field label={spec.months.label} hint={spec.months.hint}><input className="field num" inputMode="numeric" value={d.months} onChange={(e) => onChange({ months: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>}
        <Field label="Label (optional)" hint="How this assumption is named in the result"><input className="field" value={d.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={80} /></Field>
        <Field label="Approved driver (optional)" hint={drivers.length ? 'An approved driver in the unit of this assumption replaces the value typed' : 'The assumptions library holds no driver for this selection'}>
          <select className="field" value={d.driver} disabled={!drivers.length && !d.driver} onChange={(e) => { const x = drivers.find((y) => y.key === e.target.value); onChange({ driver: e.target.value, ...(x && d.value.trim() === '' ? { value: String(Number(x.value)) } : {}) }) }}>
            <option value="">None — use the value typed</option>
            {drivers.filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i).map((x) => <option key={x.id} value={x.key}>{x.name} = {driverValue(x)}{!fits(x) ? ` — in ${unitWord(x.unit)}, not used here` : x.status === 'approved' ? '' : ` — ${x.status}, not used`}</option>)}
            {d.driver && !drivers.some((x) => x.key === d.driver) && <option value={d.driver}>{d.driver} — not in the library</option>}
          </select>
        </Field>
      </div>

      {d.driver && (
        <div className={cx('mt-2 text-[11.5px]', supplies ? 'text-violet' : 'text-warn')}>
          {supplies && driver ? <>The approved driver "{driver.name}" supplies the value: <span className="num">{driverValue(driver)}</span>. The value typed is set aside.</>
            : driver && !fits(driver) ? <>The driver "{driver.name}" is stated in {unitWord(driver.unit)}, and this assumption is in {unitWord(k?.unit ?? '')}. It is not used. The value typed is used, and the result says so.</>
            : <>The driver "{d.driver}" is {driver ? driver.status : 'not in the library'}, so it is not used. The value typed is used, and the result says so.</>}
        </div>
      )}
      {check.blocking.length > 0 && <><ul className="m-0 mt-2 list-disc pl-5 text-[12px] text-warn">{check.blocking.map((p) => <li key={p}>{p}</li>)}</ul><div className="mt-1 text-[11.5px] text-muted">Until this is complete, the assumption is not in the result.</div></>}
      {check.blocking.length === 0 && check.warnings.length > 0 && <ul className="m-0 mt-2 list-disc pl-5 text-[12px] text-muted">{check.warnings.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>
  )
}

// ------------------------------------------------------------------ saving
function SaveDialog({ open, busy, meta, setMeta, H, count, caseKey, scope, kept, loaded, canOverwrite, runProblem, onCancel, onSave }: {
  open: boolean; busy: boolean; meta: Meta; setMeta: (m: Meta) => void; H: number; count: number; caseKey: CaseKey; scope: string; kept?: string; loaded: Scenario | null; canOverwrite: boolean; runProblem?: string
  onCancel: () => void; onSave: (asNew: boolean, withRun: boolean, note: string) => void
}) {
  const [withRun, setWithRun] = useState(true)
  const [note, setNote] = useState('')
  const [asNew, setAsNew] = useState(false)
  useEffect(() => {
    if (!open) return
    setNote(''); setWithRun(!runProblem); setAsNew(!canOverwrite)
    // the kind follows the case being looked at, unless the person has already chosen one for a saved scenario
    if (caseKey !== 'typed') setMeta({ ...meta, kind: caseKey })
    else if (!loaded && count === 0) setMeta({ ...meta, kind: 'base' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const problem = !meta.name.trim() ? 'Give the scenario a name.' : null
  const copy = asNew || !canOverwrite
  return (
    <Modal open={open} onClose={onCancel} title="Save the scenario" subtitle="A scenario is a set of assumptions. Saving it changes nothing in the books." width={620}
      footer={<>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => onSave(copy, withRun && !runProblem, note)}>{busy ? <Spinner /> : <Save size={15} />} {loaded ? (copy ? 'Save as a new scenario' : 'Save the changes') : 'Save scenario'}</button>
      </>}>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[12.5px] text-ink2">
        <Simulated /><span>{count} assumption{count === 1 ? '' : 's'} · {H} month{H === 1 ? '' : 's'} ahead · for {scope}</span>
        {kept && <span className="basis-full text-[12px] text-warn">{kept}</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="field" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="For example: two large customers pay late" autoFocus maxLength={120} /></Field>
        <Field label="Kind" hint="How the scenario is labelled in lists and comparisons">
          <select className="field" value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as Scenario['kind'] })}>{(Object.keys(KIND_LABEL) as Scenario['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        </Field>
        <Field label="Who can open it" hint="A private scenario is seen only by you">
          <select className="field" value={meta.shared ? 'shared' : 'private'} onChange={(e) => setMeta({ ...meta, shared: e.target.value === 'shared' })}><option value="private">Private — only me</option><option value="shared">Shared — everyone who reads simulations</option></select>
        </Field>
        <Field label="Description (optional)" className="sm:col-span-2"><textarea className="field" rows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="The decision or the risk this scenario is about" /></Field>
      </div>
      {loaded && canOverwrite && (
        <label className="mt-4 flex items-start gap-2 text-[13px] text-ink2">
          <input type="checkbox" className="mt-[3px]" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
          <span>Save as a new scenario and leave "{loaded.name}" as it is</span>
        </label>
      )}
      {loaded && !canOverwrite && <Note className="mt-4">"{loaded.name}" was built by someone else. A scenario is changed by the person who built it; this saves a copy under your name.</Note>}
      <label className="mt-4 flex items-start gap-2 text-[13px] text-ink2">
        <input type="checkbox" className="mt-[3px]" checked={withRun && !runProblem} disabled={!!runProblem} onChange={(e) => setWithRun(e.target.checked)} />
        <span>Also keep the result as a run<span className="block text-[11.5px] text-muted">A run is a record of the figures of today, with the starting point they came from. It is labelled SIMULATION and cannot be changed afterwards.</span>{runProblem && <span className="block text-[11.5px] text-warn">{runProblem}</span>}</span>
      </label>
      {withRun && !runProblem && <Field label="Note on the run (optional)" className="mt-3"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was run, or for whom" maxLength={200} /></Field>}
      {problem && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Modal>
  )
}

function RunDialog({ open, busy, name, onCancel, onSave }: { open: boolean; busy: boolean; name: string; onCancel: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  useEffect(() => { if (open) setNote('') }, [open])
  return (
    <Modal open={open} onClose={onCancel} title="Save this result as a run" subtitle={`Of the scenario "${name}"`} width={520}
      footer={<><button className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => onSave(note)}>{busy ? <Spinner /> : <Camera size={15} />} Save the run</button></>}>
      <Note className="mb-4">The figures on screen are kept as they are now, with the starting point read from the books today. The record is labelled SIMULATION. It cannot be changed afterwards, and it never enters the books, a budget or a forecast.</Note>
      <Field label="Note (optional)"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was run, or for whom" maxLength={200} autoFocus /></Field>
    </Modal>
  )
}

// ------------------------------------------------------------------ comparison
interface CmpRow { key: string; label: string; unit: 'money' | 'months' | 'ratio'; values: (number | null)[]; changes: (number | null)[]; better: 'higher' | 'lower'; formula?: string }

function CompareTab({ base, drivers, candidates, defaultHorizon, missing }: { base: TwinBase; drivers: TwinDriver[]; candidates: Candidate[]; defaultHorizon: number; missing: string[] }) {
  const c = base.currency
  const [first, setFirst] = useState('base')
  const [others, setOthers] = useState<string[]>(() => candidates.filter((x) => x.key === 'lab').map((x) => x.key))
  const [horizonText, setHorizonText] = useState(String(defaultHorizon))
  const H = clampHorizon(horizonText)

  const ref = candidates.find((x) => x.key === first) ?? candidates[0]
  const picked = [ref, ...others.map((k) => candidates.find((x) => x.key === k)).filter((x): x is Candidate => !!x && x.key !== ref.key)].slice(0, 4)
  const results = useMemo(() => picked.map((p) => simulate(base, p.shocks, H, p.name, drivers)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, drivers, H, picked.map((p) => p.key + JSON.stringify(p.shocks)).join('|')])
  const toggle = (k: string) => setOthers((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : xs.length >= 3 ? xs : [...xs, k]))
  const full = picked.length >= 4

  const rows: CmpRow[] = useMemo(() => {
    // a ratio is shown to one decimal, and its difference is taken from the figures as shown
    const diff = (vs: (number | null)[]) => vs.map((v, i) => (i === 0 || v === null || vs[0] === null ? null : Math.round((v - (vs[0] as number)) * 10) / 10))
    const cov = results.map((r) => (r.totals.lowestCoverage === null ? null : Math.round(r.totals.lowestCoverage * 10) / 10))
    const left = results.map((r) => r.totals.monthsOfCashLeft)
    return [
      ...compare(results).map((r): CmpRow => ({ ...r, unit: 'money' })),
      { key: 'lowestCoverage', label: 'Lowest payment coverage', unit: 'ratio', values: cov, changes: diff(cov), better: 'higher', formula: '(cash at the start of the month + cash in) ÷ cash out, lowest month' },
      { key: 'monthsOfCashLeft', label: 'Months before cash falls below zero', unit: 'months', values: left, changes: left.map(() => null), better: 'higher', formula: 'empty where cash stays above zero for the whole horizon' },
    ]
  }, [results])

  const tone = (r: CmpRow, v: number | null) => (v === null || v === 0 ? 'text-muted' : (r.better === 'higher' ? v > 0 : v < 0) ? 'text-pos' : 'text-neg')
  const show = (r: CmpRow, v: number | null, strong = false) => (v === null ? <span className="text-muted">{r.unit === 'months' ? `more than ${H}` : '—'}</span>
    : r.unit === 'money' ? <Sim value={v} currency={c} className={strong ? 'text-ink' : undefined} /> : r.unit === 'ratio' ? <span className="num">{one(v)}×</span> : <span className="num">{v}</span>)
  const columns: Column<CmpRow>[] = [
    { key: 'label', header: 'Figure', render: (r) => <div className="min-w-0"><div className="text-ink">{r.label}</div>{r.formula && <div className="text-[11px] text-muted">{r.formula}</div>}</div>, csv: (r) => r.label },
    ...results.flatMap((res, i): Column<CmpRow>[] => [
      { key: 'v' + i, header: i === 0 ? `${res.name} · the reference` : res.name, align: 'right', render: (r) => show(r, r.values[i], true), csv: (r) => (r.values[i] === null ? '' : r.unit === 'ratio' ? one(r.values[i]) : Math.round(r.values[i] as number)) },
      ...(i === 0 ? [] : [{
        key: 'd' + i, header: 'Difference against the reference', align: 'right' as const, csv: (r: CmpRow) => (r.changes[i] === null ? '' : r.unit === 'ratio' ? one(r.changes[i]) : Math.round(r.changes[i] as number)),
        render: (r: CmpRow) => { const v = r.changes[i]; return v === null ? <span className="text-muted">—</span> : r.unit === 'money' ? <Sim value={v} currency={c} sign className={tone(r, v)} /> : <span className={cx('num', tone(r, v))}>{v > 0 ? '+' : v < 0 ? '−' : ''}{one(Math.abs(v))}</span> },
      }]),
    ]),
  ]

  return (
    <div>
      <SimulationBanner>Every column on this screen is a simulation, the reference included. All of them start from the same books, as at {fmtDate(base.asOf)}, and run over the same {H} month{H === 1 ? '' : 's'}, so that they can be set side by side. Nothing here is posted, and no entry, budget or forecast is changed.</SimulationBanner>
      <MissingSources missing={missing} className="mb-4" />

      <Section title="What is compared" className="mb-4" right={<span className="text-[12px] text-muted">{picked.length} of 4 chosen</span>}>
        <Panel className="p-4" lit={false}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_160px_1fr]">
            <Field label="The reference — the first column" hint="Differences are measured against it">
              <select className="field" value={ref.key} onChange={(e) => { setFirst(e.target.value); setOthers((xs) => xs.filter((x) => x !== e.target.value)) }}>{candidates.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
            </Field>
            <Field label="Months to look ahead" hint="1 to 60, the same for all"><input className="field num" inputMode="numeric" value={horizonText} onChange={(e) => setHorizonText(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
            <div className="min-w-0 self-end text-[11.5px] leading-relaxed text-muted">A saved scenario is run here on the books of the selection now and over the months chosen here, whatever it was saved for. Its assumptions are not changed.</div>
          </div>
          <div className="label mt-4">Set beside it — up to three</div>
          {candidates.length <= 1 ? <div className="text-[12.5px] text-muted">There is nothing to compare the base case with yet. Add an assumption in the scenario lab, or save a scenario.</div> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {candidates.filter((x) => x.key !== ref.key).map((x) => {
                const on = others.includes(x.key)
                return (
                  <button key={x.key} aria-pressed={on} disabled={!on && full} onClick={() => toggle(x.key)} title={!on && full ? 'Four are chosen. Remove one to add another.' : undefined}
                    className={cx('flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-45', on ? 'border-violet/60 bg-surface2' : 'border-line hover:bg-surface2')}>
                    <span aria-hidden="true" className={cx('mt-[3px] grid h-4 w-4 flex-none place-items-center rounded border text-[10px]', on ? 'border-violet text-violet' : 'border-line2')}>{on ? '✓' : ''}</span>
                    <span className="min-w-0"><span className="block truncate text-[12.5px] text-ink">{x.name}</span><span className="block text-[11.5px] text-muted">{x.sub}</span></span>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>
      </Section>

      {picked.length < 2 ? <Panel><Empty icon={<GitCompareArrows size={20} />} title="Choose at least two" body="A comparison needs the reference and at least one scenario beside it." /></Panel> : (
        <>
          <Section title="Cash, month by month" right={<Simulated />} className="mb-4">
            <Panel className="p-4" lit={false}>
              <TrendChart labels={['Today', ...results[0].months.map((m) => m.label)]} height={300}
                series={results.map((r, i) => ({ name: r.name, color: LINES[i % LINES.length], dashed: i === 0, values: [base.cash, ...r.months.map((m) => m.cash)] }))} />
              <div className="mt-2 text-[11.5px] text-muted">The first point is the cash in the books today (<span className="text-pos">ACTUAL</span>); it is the same for every line. Every later point is simulated. The dashed line is the reference.</div>
            </Panel>
          </Section>
          <Section title="Side by side" right={<Simulated />}>
            <Panel lit={false}>
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} exportName="SIMULATION-scenario-comparison"
                toolbar={<span className="text-[12px] text-muted">Revenue, profit, cash, borrowings and working capital over {H} month{H === 1 ? '' : 's'}. Green is the better side of the reference, red the worse. Amounts are rounded; coverage is to one decimal.</span>} />
            </Panel>
          </Section>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {results.slice(1).map((r) => (
              <Section key={r.name} title={`What "${r.name}" assumes`} right={<Simulated />}>
                <Panel className="p-4" lit={false}>
                  <Sentences items={r.effects.map((e) => `${e.text} Formula: ${e.formula}.`)} empty="No assumption: the books continue as they are." />
                  {r.notes.length > base.notes.length && <div className="mt-3 border-t border-line pt-3"><div className="mb-1 text-[11.5px] font-medium text-ink2">Said by the model about this scenario</div><Sentences items={r.notes.slice(base.notes.length)} empty="" /></div>}
                </Panel>
              </Section>
            ))}
          </div>
          <Section title="What the model could not read, or had to assume — for every column" className="mt-4">
            <Panel className="p-4" lit={false}><Sentences items={[...results[0].assumptions.slice(0, 4), ...base.notes]} empty="The model reported no gap in what it read." /></Panel>
          </Section>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ saved scenarios and their runs
interface SavedRow { s: Scenario; runs: ScenarioRun[] | null }

function SavedTab({ scenarios, currentId, mayManage, noManage, onOpen }: { scenarios: { data: Scenario[] | undefined; error: string | null; reload: () => void }; currentId: ID | null; mayManage: boolean; noManage?: string; onOpen: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const session = useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const code = useCompanyCode()
  const who = useWho()
  const { act, busy } = useAction()
  const [archived, setArchived] = useState(false)
  const [asking, setAsking] = useState<Scenario | null>(null)
  const [openRuns, setOpenRuns] = useState<ID | null>(null)
  const [runId, setRunId] = useState<ID | null>(null)

  const list = scenarios.data
  const key = (list ?? []).map((s) => s.id).join(',')
  // a run list that cannot be read is shown as not read, never as "none"
  const runs = useAsync(async () => new Map(await Promise.all((list ?? []).map(async (s) => [s.id, await api.listScenarioRuns(s.id).then((r) => r, () => null)] as const))), [api, key])
  const rows: SavedRow[] = (list ?? []).filter((s) => archived || s.status !== 'archived').map((s) => ({ s, runs: runs.data ? runs.data.get(s.id) ?? null : null }))
  const hidden = (list ?? []).filter((s) => s.status === 'archived').length
  const may = (s: Scenario) => mayManage && (!!session?.isGroupAdmin || s.created_by === session?.user.id)
  const why = (s: Scenario) => noManage ?? (may(s) ? undefined : 'A scenario is changed by the person who built it')
  const setStatus = (s: Scenario, status: Scenario['status']) => act(() => api.saveScenario({ id: s.id, company_id: s.company_id, name: s.name, kind: s.kind, description: s.description, horizon_months: s.horizon_months, shared: s.shared, shocks: s.shocks, status }), status === 'archived' ? 'Scenario archived' : 'Scenario restored')

  // a run is shown only to a person who reads the books of every company in it: an empty list may hide runs of others
  const readsAll = companies.every((c) => can('scenario.view', c.id) && can('report.view', c.id))
  const scopeOf = (s: Scenario) => (s.company_id ? companies.find((c) => c.id === s.company_id)?.name ?? 'A company not shared with you' : 'The group')
  const columns: Column<SavedRow>[] = [
    { key: 'name', header: 'Scenario', render: ({ s }) => <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5 text-ink">{s.name}{s.id === currentId && <span className="chip violet">in the lab</span>}</div>{s.description && <div className="line-clamp-2 text-[11.5px] text-muted">{s.description}</div>}</div>, sort: ({ s }) => s.name.toLowerCase(), csv: ({ s }) => s.name },
    { key: 'mark', header: 'Label', render: () => <Simulated />, csv: () => 'SIMULATION' },
    { key: 'kind', header: 'Kind', render: ({ s }) => <span className={cx('chip', s.kind === 'optimistic' ? 'pos' : s.kind === 'conservative' ? 'warn' : s.kind === 'base' ? 'cyan' : '')}>{KIND_LABEL[s.kind]}</span>, sort: ({ s }) => s.kind, csv: ({ s }) => KIND_LABEL[s.kind] },
    { key: 'scope', header: 'Built for', render: ({ s }) => (s.company_id ? <span className="text-ink2" title={scopeOf(s)}>{code(s.company_id)} · company twin</span> : <span className="text-ink2">group twin</span>), sort: ({ s }) => scopeOf(s), csv: ({ s }) => scopeOf(s) },
    { key: 'horizon', header: 'Looks ahead', align: 'right', render: ({ s }) => <span className="num">{s.horizon_months} mo</span>, sort: ({ s }) => s.horizon_months, csv: ({ s }) => s.horizon_months },
    { key: 'n', header: 'Assumptions', align: 'right', render: ({ s }) => <span className="num" title={s.shocks.map((x) => x.label ?? kindOf(x.kind)?.label ?? x.kind).join(' · ')}>{s.shocks.length}</span>, sort: ({ s }) => s.shocks.length, csv: ({ s }) => s.shocks.map((x) => `${x.label ?? kindOf(x.kind)?.label ?? x.kind} ${shockValue(x, '', false)}`).join('; ') },
    { key: 'by', header: 'Built by', render: ({ s }) => <div><div className="text-ink2">{who(s.created_by)}</div><div className="num text-[11.5px] text-muted">changed {fmtDateTime(s.updated_at)}</div></div>, sort: ({ s }) => s.updated_at, csv: ({ s }) => `${who(s.created_by)}; changed ${s.updated_at}` },
    { key: 'shared', header: 'Seen by', render: ({ s }) => <span className={cx('chip', s.shared && 'cyan')}>{s.shared ? 'shared' : 'private'}</span>, sort: ({ s }) => Number(s.shared), csv: ({ s }) => (s.shared ? 'Shared' : 'Private') },
    { key: 'status', header: 'Status', render: ({ s }) => <StatusChip status={s.status} />, sort: ({ s }) => s.status, csv: ({ s }) => s.status },
    {
      key: 'runs', header: 'Runs saved', align: 'right', sort: ({ runs: r }) => r?.length ?? -1, csv: ({ runs: r }) => (r ? (r.length || readsAll ? r.length : 'none shown') : 'not read'),
      render: ({ s, runs: r }) => (r === null ? <span className="text-muted">{runs.loading ? '…' : 'not read'}</span> : r.length === 0 ? <span className="text-muted" title={readsAll ? undefined : 'Runs that hold figures of a company you may not read are not shown'}>{readsAll ? 'none' : 'none shown'}</span>
        : <button className="link num text-[12.5px]" onClick={(e) => { e.stopPropagation(); setOpenRuns(s.id); setRunId(r[0].id) }}>{r.length}{r.length >= 50 ? '+' : ''} · open</button>),
    },
    {
      key: 'act', header: '', align: 'right',
      render: ({ s }) => (
        <span className="flex flex-nowrap items-center justify-end gap-1.5">
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); onOpen(s.id) }} title="Loads its assumptions into the scenario lab"><FolderOpen size={13} /> Open</button>
          {s.status === 'archived'
            ? <button className="btn sm ghost" disabled={busy || !may(s)} title={why(s)} onClick={(e) => { e.stopPropagation(); void setStatus(s, 'saved') }}><ArchiveRestore size={13} /> Restore</button>
            : <button className="btn sm ghost" disabled={busy || !may(s)} title={why(s)} onClick={(e) => { e.stopPropagation(); setAsking(s) }}><Archive size={13} /> Archive</button>}
        </span>
      ),
    },
  ]

  const shown = openRuns ? (list ?? []).find((s) => s.id === openRuns) ?? null : null
  const shownRuns = shown ? runs.data?.get(shown.id) ?? [] : []
  const run = shownRuns.find((r) => r.id === runId) ?? shownRuns[0] ?? null

  return (
    <div>
      <SimulationBanner>A saved scenario is a set of assumptions; a saved run is a record of the figures one of them gave on a day. Both are simulations. Neither is part of the books, a budget or a forecast, and opening one changes nothing.</SimulationBanner>
      {scenarios.error && <ErrorBox message={scenarios.error} retry={scenarios.reload} />}
      {!scenarios.error && !list && <Panel><Loading rows={5} label="Loading the saved scenarios" /></Panel>}
      {list && (
        <Panel lit={false}>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.s.id} exportName="SIMULATION-saved-scenarios" onRow={(r) => onOpen(r.s.id)}
            toolbar={<>
              <span className="text-[12px] text-muted">Your own scenarios and those shared with everyone who reads simulations. A private scenario of someone else is not listed.{!readsAll && ' A run is shown only where you read the books of every company in it; others may exist.'}</span>
              {hidden > 0 && <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show {hidden} archived</label>}
            </>}
            empty={{ title: hidden && !archived ? 'Every saved scenario is archived' : 'No scenario has been saved', body: 'Build one in the scenario lab and save it. Saving needs the permission scenario.manage.', icon: <FlaskConical size={20} /> }} />
        </Panel>
      )}

      <Modal open={!!asking} onClose={() => setAsking(null)} title="Archive this scenario" width={500}
        footer={<><button className="btn ghost" onClick={() => setAsking(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => { const s = asking; if (!s) return; void setStatus(s, 'archived').then(() => setAsking(null)) }}><Archive size={14} /> Archive</button></>}>
        {asking && <div className="space-y-2 text-[13px] text-ink2"><p className="m-0">"{asking.name}" leaves the list of saved scenarios and the comparison. Its assumptions and the runs saved from it are kept, and it can be restored at any time.</p><p className="m-0 text-[12.5px] text-muted">Nothing in the books is affected: a scenario was never part of them.</p></div>}
      </Modal>

      <Drawer open={!!shown} onClose={() => setOpenRuns(null)} width={1120} title={shown ? <span className="flex flex-wrap items-center gap-2"><span className="truncate">{shown.name}</span><Simulated /></span> : ''} subtitle={shown ? `${shownRuns.length}${shownRuns.length >= 50 ? ' most recent' : ''} saved run${shownRuns.length === 1 ? '' : 's'} · each is shown exactly as it was saved` : undefined}>
        {shown && (
          <div>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {shownRuns.map((r) => (
                <button key={r.id} aria-pressed={run?.id === r.id} onClick={() => setRunId(r.id)} className={cx('rounded-lg border px-3 py-1.5 text-left text-[12px] transition-colors', run?.id === r.id ? 'border-violet/60 bg-surface2 text-ink' : 'border-line text-ink2 hover:bg-surface2')}>
                  <span className="num block">{fmtDateTime(r.created_at)}</span><span className="block text-[11px] text-muted">{who(r.created_by)}</span>
                </button>
              ))}
            </div>
            {run ? <RunView run={run} /> : <Empty title="No run is saved" body="Open the scenario in the lab and save its result." />}
          </div>
        )}
      </Drawer>
    </div>
  )
}

function RunView({ run }: { run: ScenarioRun }) {
  const companies = useApp((s) => s.companies)
  const who = useWho()
  const result: TwinResult | null = readResult(run.result)
  const base = (run.base ?? {}) as Partial<TwinBase>
  const names = run.company_ids.map((id) => companies.find((c) => c.id === id)?.name ?? 'a company not shared with you')
  const left = Array.isArray(run.result.missing) ? run.result.missing.map(String) : []
  const kept = Array.isArray(run.result.shocks) ? (run.result.shocks as Shock[]).filter((s) => !!s && typeof s === 'object' && typeof s.value === 'number') : []
  const privacy = useApp((s) => s.privacy)
  const currency = typeof base.currency === 'string' ? base.currency : result?.currency ?? 'INR'
  return (
    <div>
      <SimulationBanner>
        <strong className="text-ink">Saved {fmtDateTime(run.created_at)} by {who(run.created_by)}</strong>, from the books as at {fmtDate(run.as_of)}, for {names.join(', ')}. These are the figures exactly as they were saved. They cannot be changed. The books have moved on since; this record has not.
      </SimulationBanner>
      {run.note && <Note className="mb-4">Note saved with the run: {run.note}</Note>}
      <MissingSources missing={left} className="mb-4" />
      <Section title={`The starting point as saved — the books as at ${fmtDate(run.as_of)}`} className="mb-4">
        <Panel className="p-4" lit={false}><BaseFacts base={base} currency={currency} /></Panel>
      </Section>
      {kept.length > 0 && (
        <Section title="Assumptions as saved" right={<Simulated />} className="mb-4">
          <Panel className="flex flex-wrap gap-1.5 p-4" lit={false}>
            {kept.map((s, i) => <span key={i} className="chip">{s.label ?? kindOf(s.kind)?.label ?? String(s.kind)}: <span className="num">{shockValue(s, currency, privacy)}</span>{s.from_month && s.from_month > 1 ? ` from month ${s.from_month}` : ''}</span>)}
          </Panel>
        </Section>
      )}
      {result ? <ResultView result={result} startCash={typeof base.cash === 'number' ? base.cash : undefined} exportName={`SIMULATION-run-${run.created_at.slice(0, 10)}-${slug(result.name)}`} />
        : <Panel><Empty title="This run cannot be shown" body="The record does not hold a result in the form this screen reads. It is kept as it was saved; nothing has been changed or filled in." /></Panel>}
    </div>
  )
}
