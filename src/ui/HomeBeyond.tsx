import { useNavigate } from 'react-router-dom'
import { Bell, Package, ScanSearch, TrendingUp } from 'lucide-react'
import { can, capOn, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { exposureTotals, lossExposure } from '@/engine/stock'
import { carryingAmount } from '@/engine/invest'
import { loadReality } from '@/lib/realityData'
import { sum } from '@/lib/money'
import { today } from '@/lib/dates'
import { Money, Panel, Section, Truth } from './kit'
import { Exposure } from './p3'

// What stands beside the ledger, on the Command Centre: stock, investments, the agreement of the
// records with each other, and what waits for the person. Each tile is shown only to a person who
// may read what it counts, and only while its capability is switched on. A tile that could not be
// read is left out; it never shows a zero that would read as "there is none".

export function HomeBeyond() {
  useApp((s) => s.session)
  useApp((s) => s.flags)
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const currency = useCurrency()
  const key = ids.join(',')
  const stockIds = capOn('inventory') ? ids.filter((id) => can('inventory.view', id)) : []
  const investIds = capOn('investments') ? ids.filter((id) => can('investment.view', id)) : []
  const realityIds = capOn('reality') ? ids.filter((id) => can('reality.view', id)) : []

  const stock = useAsync(async () => {
    if (!stockIds.length) return null
    const [items, rows, lots, holds] = await Promise.all([api.listInvItems(stockIds), api.stockOnHand(stockIds), api.listInvLots({ companyIds: stockIds }), api.listInvHolds(stockIds)])
    if (!items.length) return null
    const ex = exposureTotals(lossExposure(items, rows, lots, holds, today()))
    return { value: sum(items.map((i) => i.value_on_hand)), items: items.filter((i) => Number(i.qty_on_hand) > 0).length, exposure: sum(ex.map((x) => x.value)), lines: ex.reduce((n, x) => n + x.lines, 0) }
  }, [api, key, stockIds.length])
  const invest = useAsync(async () => {
    if (!investIds.length) return null
    const hs = (await api.listHoldings(investIds)).filter((h) => h.status === 'active')
    return hs.length ? { carried: sum(hs.map((h) => carryingAmount(h))), count: hs.length } : null
  }, [api, key, investIds.length])
  const reality = useAsync(async () => {
    if (!realityIds.length) return null
    const r = await loadReality(api, accounts, realityIds, can)
    const unset = [...new Set(r.findings.map((f) => f.company_id))].filter((c) => !r.materiality.some((m) => m.company_id === c)).length
    return { differ: r.findings.length, material: r.findings.filter((f) => f.material).length, unchecked: r.unchecked.length, missing: r.missing.length, unset }
  }, [api, key, realityIds.length, accounts.length])
  const notices = useAsync(async () => (capOn('notifications') ? (await api.listNotifications({ unreadOnly: true, limit: 200 })).length : null), [api, key])

  const s = stock.data, h = invest.data, r = reality.data, n = notices.data
  if (!s && !h && !r && !n) return null
  const left = ids.length - Math.min(stockIds.length || ids.length, investIds.length || ids.length, realityIds.length || ids.length)

  return (
    <Section title="Beside the ledger" className="mb-5" right={left > 0 ? <span className="text-[11.5px] text-muted">Your role does not read every company selected; what it does not read is not counted.</span> : undefined}>
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {s && (
          <Panel className="p-4" onClick={() => nav('/inventory')} title="Open the inventory">
            <div className="flex items-center gap-2 text-muted"><Package size={15} className="text-gold" /><span className="eyebrow">Stock carried</span></div>
            <div className="display mt-1.5 text-[22px] font-medium text-ink"><Money value={s.value} currency={currency} compact /></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted"><Truth state="ACTUAL" /> {s.items} item{s.items === 1 ? '' : 's'} in stock, at cost</div>
          </Panel>
        )}
        {s && s.lines > 0 && (
          <Panel className="p-4" onClick={() => nav('/inventory?tab=exposure')} title="Expired, close to expiry, damaged, held or not moving. Still in the books at cost.">
            <div className="flex items-center gap-2 text-muted"><Package size={15} className="text-warn" /><span className="eyebrow">Stock at stake</span></div>
            <div className="display mt-1.5 text-[22px] font-medium text-warn"><Money value={s.exposure} currency={currency} compact /></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted"><Exposure /> {s.lines} line{s.lines === 1 ? '' : 's'}. Not a loss.</div>
          </Panel>
        )}
        {h && (
          <Panel className="p-4" onClick={() => nav('/investments')} title="Open investments and funds">
            <div className="flex items-center gap-2 text-muted"><TrendingUp size={15} className="text-gold" /><span className="eyebrow">Investments carried</span></div>
            <div className="display mt-1.5 text-[22px] font-medium text-ink"><Money value={h.carried} currency={currency} compact /></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted"><Truth state="ACTUAL" /> {h.count} holding{h.count === 1 ? '' : 's'}, as the books carry them</div>
          </Panel>
        )}
        {r && (
          <Panel className="p-4" onClick={() => nav('/reality?tab=differences')} attention={r.material > 0} title="Documents, operations, books, cash and what physically exists, set against each other">
            <div className="flex items-center gap-2 text-muted"><ScanSearch size={15} className={r.differ ? 'text-warn' : 'text-pos'} /><span className="eyebrow">Records that differ</span></div>
            <div className="display mt-1.5 text-[22px] font-medium text-ink"><span className="num">{r.differ}</span> <span className="text-[13px] text-muted">{r.unset ? `${r.material} material` : `${r.material} above the threshold`}</span></div>
            {r.unset > 0 && <div className="mt-0.5 text-[11.5px] text-warn">No threshold is set in {r.unset} of the companies concerned: there, every difference counts as material.</div>}
            <div className="mt-1 text-[11.5px] text-muted">{r.unchecked + r.missing > 0 ? `${r.unchecked + r.missing} thing${r.unchecked + r.missing === 1 ? ' was' : 's were'} never checked or could not be read.` : 'Everything that can be compared was compared.'}</div>
          </Panel>
        )}
        {!!n && (
          <Panel className="p-4" onClick={() => nav('/notifications')} title="Open your notifications">
            <div className="flex items-center gap-2 text-muted"><Bell size={15} className="text-gold" /><span className="eyebrow">Waiting for you</span></div>
            <div className="display mt-1.5 text-[22px] font-medium text-ink"><span className="num">{n}</span> <span className="text-[13px] text-muted">unread</span></div>
            <div className="mt-1 text-[11.5px] text-muted">Shown inside NUMERO. Nothing is sent by e-mail or message.</div>
          </Panel>
        )}
      </div>
    </Section>
  )
}
