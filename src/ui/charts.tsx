import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmtMoney } from '@/lib/money'
import { useApp, useCurrency } from '@/store/app'
import { cx } from './kit'

// Hand-built SVG charts: light, theme-aware, and every mark can be clicked to drill down.

const PALETTE = ['var(--gold)', 'var(--cyan)', 'var(--pos)', 'var(--violet)', 'var(--warn)', 'var(--neg)', '#7dd3c8', '#c9a0ff', '#8fb4ff', '#e3a3c0']
export const colorAt = (i: number) => PALETTE[i % PALETTE.length]

function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(640)
  const obs = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect()
    if (!el) return
    setW(el.clientWidth || 640)
    obs.current = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))))
    obs.current.observe(el)
  }, [])
  return [ref, w]
}

const useFmt = () => {
  const privacy = useApp((s) => s.privacy)
  const currency = useCurrency()
  return (v: number, compact = true) => fmtMoney(v, { currency, compact, mask: privacy })
}

export function Sparkline({ values, color = 'var(--gold)', height = 34, width = 110 }: { values: number[]; color?: string; height?: number; width?: number }) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 8)] as const)
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs><linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L ${width - 2} ${height} L 2 ${height} Z`} fill={`url(#s${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={color} />
    </svg>
  )
}

export interface Series { name: string; color?: string; values: number[]; dashed?: boolean }

export function TrendChart({ labels, series, height = 250, onPoint, zeroLine = true }: { labels: string[]; series: Series[]; height?: number; onPoint?: (index: number) => void; zeroLine?: boolean }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const fmt = useFmt()
  const id = useId().replace(/:/g, '')
  const pad = { l: 58, r: 14, t: 14, b: 28 }
  const all = series.flatMap((s) => s.values)
  const max = Math.max(1, ...all), min = Math.min(0, ...all)
  const span = max - min || 1
  const n = labels.length
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b)
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))))
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={height} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - pad.l) / Math.max(1, w - pad.l - pad.r)) * (n - 1))
          setHover(Math.max(0, Math.min(n - 1, i)))
        }}
        onClick={() => hover !== null && onPoint?.(hover)} style={{ cursor: onPoint ? 'pointer' : 'default' }}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`a${id}${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color ?? colorAt(si)} stopOpacity=".22" /><stop offset="1" stopColor={s.color ?? colorAt(si)} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '2 5'} />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">{fmt(t)}</text>
          </g>
        ))}
        {zeroLine && min < 0 && <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />}
        {labels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{l}</text>)}
        {series.map((s, si) => {
          const c = s.color ?? colorAt(si)
          const d = s.values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')
          return (
            <g key={si}>
              {!s.dashed && n > 1 && <path d={`${d} L ${x(n - 1)} ${y(min)} L ${x(0)} ${y(min)} Z`} fill={`url(#a${id}${si})`} />}
              <path d={d} fill="none" stroke={c} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 5' : undefined} />
            </g>
          )
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" />
            {series.map((s, si) => <circle key={si} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="3.6" fill="var(--bg)" stroke={s.color ?? colorAt(si)} strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="panel pointer-events-none absolute top-2 z-10 min-w-[170px] px-3 py-2 text-[12px]" style={{ left: Math.min(Math.max(8, x(hover) + 12), w - 190), background: 'var(--surface-solid)' }}>
          <div className="mb-1 text-muted">{labels[hover]}</div>
          {series.map((s, si) => (
            <div key={si} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink2"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color ?? colorAt(si) }} />{s.name}</span>
              <span className="num">{fmt(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      <Legend items={series.map((s, i) => ({ label: s.name, color: s.color ?? colorAt(i) }))} />
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11.5px] text-ink2">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  )
}

export interface BarDatum { label: string; values: { key: string; value: number; color?: string }[] }
export function BarChart({ data, height = 250, onBar, stacked = false }: { data: BarDatum[]; height?: number; onBar?: (label: string, key: string) => void; stacked?: boolean }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<string | null>(null)
  const fmt = useFmt()
  const pad = { l: 58, r: 10, t: 12, b: 30 }
  const keys = data[0]?.values.map((v) => v.key) ?? []
  const totals = data.map((d) => (stacked ? d.values.reduce((s, v) => s + Math.max(0, v.value), 0) : Math.max(...d.values.map((v) => v.value), 0)))
  const max = Math.max(1, ...totals)
  const min = Math.min(0, ...data.flatMap((d) => d.values.map((v) => v.value)))
  const span = max - min || 1
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b)
  const band = (w - pad.l - pad.r) / Math.max(1, data.length)
  const inner = Math.min(band * 0.72, 64)
  const bw = stacked ? inner : inner / Math.max(1, keys.length)
  const step = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 80))))
  return (
    <div ref={ref} className="w-full select-none">
      <svg width={w} height={height}>
        {Array.from({ length: 5 }, (_, i) => min + (span * i) / 4).map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">{fmt(t)}</text>
          </g>
        ))}
        {data.map((d, di) => {
          const x0 = pad.l + di * band + (band - inner) / 2
          let acc = 0
          return (
            <g key={d.label}>
              {d.values.map((v, vi) => {
                const c = v.color ?? colorAt(vi)
                const id = d.label + '|' + v.key
                const top = stacked ? y(acc + Math.max(0, v.value)) : y(Math.max(0, v.value))
                const h = Math.abs(y(v.value) - y(0))
                const bx = stacked ? x0 : x0 + vi * bw
                if (stacked) acc += Math.max(0, v.value)
                return (
                  <rect key={v.key} x={bx + 1} y={v.value >= 0 ? top : y(0)} width={Math.max(2, bw - 2)} height={Math.max(1, h)} rx={Math.min(4, bw / 3)}
                    fill={c} opacity={hover && hover !== id ? 0.35 : 0.9} style={{ cursor: onBar ? 'pointer' : 'default', transition: 'opacity .15s' }}
                    onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => onBar?.(d.label, v.key)}>
                    <title>{`${d.label} · ${v.key}: ${fmt(v.value, false)}`}</title>
                  </rect>
                )
              })}
              {di % step === 0 && <text x={pad.l + di * band + band / 2} y={height - 9} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label.length > 12 ? d.label.slice(0, 11) + '…' : d.label}</text>}
            </g>
          )
        })}
      </svg>
      <Legend items={keys.map((k, i) => ({ label: k, color: data[0].values[i].color ?? colorAt(i) }))} />
    </div>
  )
}

export interface Slice { label: string; value: number; color?: string; id?: string }
export function Donut({ data, size = 190, centre, onSlice, thickness = 22 }: { data: Slice[]; size?: number; centre?: ReactNode; onSlice?: (s: Slice) => void; thickness?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const fmt = useFmt()
  const clean = data.filter((d) => d.value > 0)
  const total = clean.reduce((s, d) => s + d.value, 0) || 1
  const r = size / 2 - thickness / 2 - 4
  const C = 2 * Math.PI * r
  let off = 0
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
          {clean.map((d, i) => {
            const len = (d.value / total) * C
            const el = (
              <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color ?? colorAt(i)} strokeWidth={hover === i ? thickness + 5 : thickness}
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off}
                style={{ cursor: onSlice ? 'pointer' : 'default', transition: 'stroke-width .18s, opacity .18s' }} opacity={hover !== null && hover !== i ? 0.4 : 1}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSlice?.(d)}>
                <title>{`${d.label}: ${fmt(d.value, false)}`}</title>
              </circle>
            )
            off += len
            return el
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {hover !== null ? (
            <div><div className="max-w-[110px] truncate text-[11px] text-muted">{clean[hover].label}</div><div className="num text-[15px]">{fmt(clean[hover].value)}</div><div className="num text-[11px] text-gold">{((clean[hover].value / total) * 100).toFixed(1)}%</div></div>
          ) : centre}
        </div>
      </div>
      <div className="min-w-[160px] flex-1">
        {clean.slice(0, 9).map((d, i) => (
          <button key={d.label} className={cx('flex w-full items-center justify-between gap-3 rounded-md px-2 py-[5px] text-left text-[12.5px] transition-colors hover:bg-surface2', !onSlice && 'cursor-default')}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSlice?.(d)}>
            <span className="flex min-w-0 items-center gap-2 text-ink2"><i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: d.color ?? colorAt(i) }} /><span className="truncate">{d.label}</span></span>
            <span className="num flex-none text-ink">{((d.value / total) * 100).toFixed(1)}%</span>
          </button>
        ))}
        {clean.length > 9 && <div className="px-2 pt-1 text-[11.5px] text-muted">+ {clean.length - 9} more, all included in the total</div>}
      </div>
    </div>
  )
}

export interface Step { label: string; value: number; kind: 'start' | 'in' | 'out' | 'end' }
export function Waterfall({ steps, height = 240, onStep }: { steps: Step[]; height?: number; onStep?: (s: Step) => void }) {
  const [ref, w] = useWidth()
  const fmt = useFmt()
  const pad = { l: 58, r: 10, t: 22, b: 40 }
  let run = 0
  const bars = steps.map((s) => {
    if (s.kind === 'start' || s.kind === 'end') { run = s.value; return { ...s, a: 0, b: s.value } }
    const a = run; run += s.kind === 'in' ? s.value : -s.value
    return { ...s, a, b: run }
  })
  const vals = bars.flatMap((b) => [b.a, b.b])
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals)
  const span = max - min || 1
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b)
  const band = (w - pad.l - pad.r) / Math.max(1, bars.length)
  const bw = Math.min(band * 0.62, 70)
  const col = (k: Step['kind']) => (k === 'in' ? 'var(--pos)' : k === 'out' ? 'var(--neg)' : 'var(--gold)')
  return (
    <div ref={ref} className="w-full select-none">
      <svg width={w} height={height}>
        {Array.from({ length: 5 }, (_, i) => min + (span * i) / 4).map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" className="num">{fmt(t)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + i * band + (band - bw) / 2
          const top = y(Math.max(b.a, b.b)), h = Math.max(2, Math.abs(y(b.a) - y(b.b)))
          return (
            <g key={b.label} style={{ cursor: onStep ? 'pointer' : 'default' }} onClick={() => onStep?.(b)}>
              {i > 0 && <line x1={pad.l + (i - 1) * band + (band + bw) / 2} x2={x} y1={y(bars[i - 1].b)} y2={y(bars[i - 1].b)} stroke="var(--line-strong)" strokeDasharray="3 3" />}
              <rect x={x} y={top} width={bw} height={h} rx="5" fill={col(b.kind)} opacity=".88"><title>{`${b.label}: ${fmt(b.value, false)}`}</title></rect>
              <text x={x + bw / 2} y={top - 6} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)" className="num">{(b.kind === 'out' ? '−' : '') + fmt(b.value)}</text>
              <text x={x + bw / 2} y={height - 22} textAnchor="middle" fontSize="10" fill="var(--muted)">{b.label.length > 14 ? b.label.slice(0, 13) + '…' : b.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function Gauge({ value, label, sub, tone = 'gold', size = 132 }: { value: number; label: string; sub?: string; tone?: 'gold' | 'pos' | 'warn' | 'neg' | 'cyan'; size?: number }) {
  const v = Math.max(0, Math.min(1, value))
  const r = size / 2 - 12
  const arc = Math.PI * 1.5 * r
  const c = `var(--${tone})`
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="7" strokeDasharray={`${arc} ${2 * Math.PI * r}`} strokeLinecap="round" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth="7" strokeDasharray={`${arc * v} ${2 * Math.PI * r}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.7,.2,1)', filter: `drop-shadow(0 0 6px ${c})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-[19px] leading-none">{label}</div>
          {sub && <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

export function Meter({ value, max, tone = 'gold', height = 6 }: { value: number; max: number; tone?: 'gold' | 'pos' | 'warn' | 'neg' | 'cyan'; height?: number }) {
  const p = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max))
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface2" style={{ height }} role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: `var(--${tone})`, boxShadow: `0 0 12px var(--${tone})`, transition: 'width .9s cubic-bezier(.2,.7,.2,1)' }} />
    </div>
  )
}

// ---------------------------------------------------------------- money flow map
export interface FlowNode { id: string; label: string; column: number; value: number; tone?: string; sub?: string }
export interface FlowLink { from: string; to: string; value: number; label?: string }
export function FlowMap({ nodes, links, height = 460, onNode, onLink, columns }: { nodes: FlowNode[]; links: FlowLink[]; height?: number; onNode?: (n: FlowNode) => void; onLink?: (l: FlowLink) => void; columns: string[] }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<string | null>(null)
  const effects = useApp((s) => s.effects)
  const fmt = useFmt()
  const nodeW = 150, gapY = 10, top = 34
  const colX = (c: number) => (columns.length <= 1 ? 0 : (c / (columns.length - 1)) * (w - nodeW))
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; h: number; n: FlowNode }>()
    columns.forEach((_, c) => {
      const col = nodes.filter((n) => n.column === c).sort((a, b) => b.value - a.value)
      const total = col.reduce((s, n) => s + n.value, 0) || 1
      const avail = height - top - gapY * Math.max(0, col.length - 1)
      let y = top
      col.forEach((n) => {
        const h = Math.max(34, (n.value / total) * avail)
        pos.set(n.id, { x: colX(c), y, h, n })
        y += h + gapY
      })
      // squeeze if minimum heights overflow
      const over = y - gapY - height
      if (over > 0) {
        const k = (height - top - gapY * Math.max(0, col.length - 1)) / (y - gapY - top - gapY * Math.max(0, col.length - 1))
        let yy = top
        col.forEach((n) => { const p = pos.get(n.id)!; p.h = Math.max(22, p.h * k); p.y = yy; yy += p.h + gapY })
      }
    })
    return pos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, w, height, columns.length])
  const maxLink = Math.max(1, ...links.map((l) => l.value))
  return (
    <div ref={ref} className="w-full select-none overflow-hidden">
      <svg width={w} height={height}>
        {columns.map((c, i) => <text key={c} x={colX(i) + nodeW / 2} y={16} textAnchor="middle" fontSize="10" letterSpacing="1.6" fill="var(--muted)">{c.toUpperCase()}</text>)}
        {links.map((l, i) => {
          const a = layout.get(l.from), b = layout.get(l.to)
          if (!a || !b) return null
          const x1 = a.x + nodeW, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2
          const mx = (x1 + x2) / 2
          const sw = 1.5 + (l.value / maxLink) * 16
          const id = l.from + '>' + l.to
          const on = hover === id || hover === l.from || hover === l.to
          const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
          return (
            <g key={i} style={{ cursor: onLink ? 'pointer' : 'default' }} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => onLink?.(l)}>
              <path d={d} fill="none" stroke={on ? 'var(--gold)' : 'var(--cyan)'} strokeOpacity={hover && !on ? 0.06 : on ? 0.6 : 0.2} strokeWidth={sw} strokeLinecap="round" style={{ transition: 'stroke-opacity .2s' }}>
                <title>{`${a.n.label} → ${b.n.label}: ${fmt(l.value, false)}`}</title>
              </path>
              {effects === 'full' && (
                <circle r="2.4" fill="var(--gold-2)" opacity={hover && !on ? 0 : 0.9}>
                  <animateMotion dur={`${3.5 + (i % 5) * 0.6}s`} repeatCount="indefinite" path={d} begin={`${(i % 7) * 0.4}s`} />
                </circle>
              )}
            </g>
          )
        })}
        {[...layout.values()].map(({ x, y, h, n }) => (
          <g key={n.id} style={{ cursor: onNode ? 'pointer' : 'default' }} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => onNode?.(n)}>
            <rect x={x} y={y} width={nodeW} height={h} rx="9" fill="var(--surface-solid)" stroke={hover === n.id ? 'var(--gold)' : 'var(--line-strong)'} style={{ transition: 'stroke .2s' }} />
            <rect x={x} y={y} width="3" height={h} rx="1.5" fill={n.tone ?? 'var(--gold)'} />
            <text x={x + 12} y={y + Math.min(h / 2, 18) + (h > 40 ? -2 : 4)} fontSize="11.5" fill="var(--ink)">{n.label.length > 20 ? n.label.slice(0, 19) + '…' : n.label}</text>
            {h > 40 && <text x={x + 12} y={y + Math.min(h / 2, 18) + 14} fontSize="10.5" fill="var(--muted)" className="num">{fmt(n.value)}</text>}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function Heatmap({ rows, cols, value, onCell }: { rows: string[]; cols: string[]; value: (r: number, c: number) => number; onCell?: (r: number, c: number) => void }) {
  const fmt = useFmt()
  const max = Math.max(1, ...rows.flatMap((_, r) => cols.map((_, c) => value(r, c))))
  return (
    <div className="overflow-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <thead><tr><th />{cols.map((c) => <th key={c} className="px-1 pb-1 text-center text-[10px] font-medium text-muted">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="max-w-[170px] truncate pr-2 text-right text-[11.5px] text-ink2">{r}</td>
              {cols.map((c, ci) => {
                const v = value(ri, ci)
                return (
                  <td key={c} onClick={() => v > 0 && onCell?.(ri, ci)} title={`${r} · ${c}: ${fmt(v, false)}`}
                    className={cx('num h-8 min-w-[52px] rounded-md text-center text-[10.5px] transition-transform', v > 0 && onCell && 'cursor-pointer hover:scale-[1.06]')}
                    style={{ background: v > 0 ? `color-mix(in srgb, var(--gold) ${8 + (v / max) * 72}%, transparent)` : 'var(--surface)', color: v / max > 0.55 ? '#17120a' : 'var(--ink-2)' }}>
                    {v > 0 ? fmt(v) : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
