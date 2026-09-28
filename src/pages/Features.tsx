import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, LayoutList, Lock, Search } from 'lucide-react'
import { can, capOn, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { AREAS, CAPABILITIES, type Capability, type CapabilityState } from '@/engine/features'
import { cx, Note, PageHeader, Panel } from '@/ui/kit'
import { Meter } from '@/ui/charts'

// =====================================================================
// Capabilities (spec 1503): the living inventory of what NUMERO can do,
// area by area. It says what each screen does NOT do as plainly as what
// it does, and sets it beside the requirement ledger, which keeps the
// status of every single requirement.
// =====================================================================

const STATE: Record<CapabilityState, { cls: string; label: string; meaning: string }> = {
  working: { cls: 'pos', label: 'working', meaning: 'The screen and the engine behind it are built and tested.' },
  partial: { cls: 'warn', label: 'partial', meaning: 'Part of what the specification asks is built. The limits are stated.' },
  'recorded only': { cls: 'cyan', label: 'recorded only', meaning: 'NUMERO keeps the record. The act itself happens outside NUMERO.' },
  'not connected': { cls: '', label: 'not connected', meaning: 'The place for it exists. Nothing outside NUMERO is connected to it.' },
}
const DONE = ['IMPLEMENTED', 'TESTED']
const norm = (s: string) => (s ?? '').toUpperCase().replace(/_/g, ' ').trim()

export default function Features() {
  useApp((s) => s.session)
  useApp((s) => s.flags)
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const [q, setQ] = useState('')
  const [state, setState] = useState<CapabilityState | ''>('')
  const reqs = useAsync(() => api.listRequirements(), [api])

  const byModule = useMemo(() => {
    const m = new Map<string, { total: number; done: number; partial: number }>()
    for (const r of reqs.data?.requirements ?? []) {
      const k = r.module || 'General'
      const x = m.get(k) ?? { total: 0, done: 0, partial: 0 }
      x.total++
      if (DONE.includes(norm(r.status))) x.done++
      else if (norm(r.status) === 'PARTIAL') x.partial++
      m.set(k, x)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [reqs.data])

  const shown = CAPABILITIES.filter((c) => (!state || c.state === state) && (!q.trim() || (c.label + c.area + c.what + (c.limits ?? '')).toLowerCase().includes(q.toLowerCase())))
  const areas = AREAS.filter((a) => shown.some((c) => c.area === a))
  const count = (s: CapabilityState) => CAPABILITIES.filter((c) => c.state === s).length
  const mayOpen = (c: Capability) => (!c.perm || [c.perm].flat().some((p) => can(p))) && capOn(c.key)

  return (
    <div>
      <PageHeader eyebrow="Build" title="Capabilities" subtitle="Everything NUMERO can do, area by area, with what each capability does not do. Kept beside the code and changed with it." />

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(STATE) as CapabilityState[]).map((s) => (
          <Panel key={s} className={cx('p-4', state === s && 'attention')} onClick={() => setState(state === s ? '' : s)} title={STATE[s].meaning}>
            <div className="eyebrow">{STATE[s].label}</div>
            <div className="display mt-1.5 text-[22px] font-medium text-ink"><span className="num">{count(s)}</span> <span className="text-[13px] text-muted">of {CAPABILITIES.length}</span></div>
            <div className="mt-1 text-[11.5px] text-muted">{STATE[s].meaning}</div>
          </Panel>
        ))}
      </div>

      <Panel className="mb-4 flex flex-wrap items-center gap-2 p-3" lit={false}>
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field sm" style={{ paddingLeft: 32 }} placeholder="Search capabilities…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search capabilities" />
        </div>
        <select className="field sm" style={{ width: 190 }} value={state} onChange={(e) => setState(e.target.value as CapabilityState | '')} aria-label="State">
          <option value="">Every state</option>
          {(Object.keys(STATE) as CapabilityState[]).map((s) => <option key={s} value={s}>{STATE[s].label}</option>)}
        </select>
        <span className="text-[12px] text-muted">{shown.length} of {CAPABILITIES.length} shown</span>
      </Panel>

      <div className="space-y-4">
        {areas.map((a) => (
          <section key={a}>
            <div className="eyebrow mb-2.5">{a}</div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {shown.filter((c) => c.area === a).map((c) => {
                const open = mayOpen(c)
                const off = !capOn(c.key)
                return (
                  <Panel key={c.key} className="flex flex-col p-4" onClick={open ? () => nav(c.to) : undefined} title={open ? undefined : off ? 'This capability is switched off for you or for the companies selected' : 'Your role does not include this screen'}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{c.label}</div>
                      <span className={cx('chip', STATE[c.state].cls)} title={STATE[c.state].meaning}>{STATE[c.state].label}</span>
                      {open ? <ArrowUpRight size={14} className="mt-[3px] flex-none text-muted" /> : <Lock size={13} className="mt-[3px] flex-none text-muted" />}
                    </div>
                    <div className="mt-1.5 text-[12.5px] text-ink2">{c.what}</div>
                    {c.limits && <div className="mt-2 border-t border-line pt-2 text-[12px] text-muted"><span className="text-warn">What it does not do.</span> {c.limits}</div>}
                    {off && <div className="mt-2 text-[11.5px] text-warn">Switched off for the companies selected.</div>}
                  </Panel>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-6">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="eyebrow">Requirements of the specification, by module</div>
          <button className="btn sm ghost" onClick={() => nav('/requirements')}><LayoutList size={13} /> Open the requirement ledger</button>
        </div>
        <Panel className="p-4" lit={false}>
          {reqs.error ? <div className="text-[12.5px] text-muted">The requirement ledger could not be read: {reqs.error}</div>
            : !reqs.data ? <div className="text-[12.5px] text-muted">Loading…</div>
            : !byModule.length ? <div className="text-[12.5px] text-muted">The requirement ledger holds no requirement.</div>
            : (
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
                {byModule.map(([m, x]) => (
                  <div key={m}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="truncate text-ink2">{m}</span>
                      <span className="num flex-none text-muted">{x.done} built · {x.partial} partial · {x.total - x.done - x.partial} not built</span>
                    </div>
                    <Meter value={x.done} max={x.total} tone={x.done === x.total ? 'pos' : 'gold'} />
                  </div>
                ))}
              </div>
            )}
        </Panel>
        <Note className="mt-3">"Built" counts requirements whose status in the ledger is IMPLEMENTED or TESTED. A requirement that is partly built is counted as partial, never as built. Source of the ledger: {reqs.data?.source || 'not loaded'}.</Note>
      </section>
    </div>
  )
}
