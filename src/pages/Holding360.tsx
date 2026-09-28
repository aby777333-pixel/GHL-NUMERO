import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Briefcase, Check, ExternalLink, Pencil, Scale, ShoppingCart, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { Holding, HoldingTxn, HoldingTxnInput } from '@/engine/p3Types'
import { holdingPosition } from '@/engine/invest'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, ZERO, fmtMoney, round2 } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, Spinner, StatusChip, Truth } from '@/ui/kit'
import { Attachments, ProposedNote, Stat, useAccountName, useCompanyName, useMoneyLedgers, usePartyName } from '@/ui/ops'
import { DemoTag, digits, Fact, History, human, NoAccess, Tile } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { TrendChart } from '@/ui/charts'
import { fmtQty, HoldingForm, INSTRUMENT_LABEL, MEASUREMENT_LABEL, useInvesteeName, useOwnWork, valuedWhenHeld } from './Investments'

// =====================================================================
// Holding 360: one investment, what the books carry it at, what it has
// been valued at, and everything that was done with it.
// Buying, selling, income and a write-down each PROPOSE an entry. A
// valuation of a holding carried at cost stands beside the books and
// posts nothing; at fair value it proposes an entry for the change.
// =====================================================================

type TxnKind = HoldingTxnInput['kind']
const KIND_LABEL: Record<HoldingTxn['kind'], string> = { purchase: 'Purchase', sale: 'Sale', income: 'Income', valuation: 'Valuation', write_down: 'Write-down' }
const STATUS_LABEL: Record<HoldingTxn['status'], string> = {
  proposed: 'awaiting approval', posted: 'posted', rejected: 'rejected', reversed: 'reversed', recorded: 'recorded — awaiting a decision', approved: 'approved — beside the books',
}
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
/** a valuation of a holding carried at cost is approved beside the books; at fair value its entry is posted */
const statusOf = (t: HoldingTxn) => (t.status === 'approved' && text(t.detail.measurement) === 'fair_value' ? 'approved' : STATUS_LABEL[t.status])
const BACK = '/investments?tab=holdings'

export default function Holding360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('investment.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Investments · Investment" title="Investments" perm="investment.view" back={BACK} />
  return <HoldingView key={id} id={id} ids={ids} />
}

function HoldingView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const investee = useInvesteeName()
  const ownWork = useOwnWork()
  const { act, busy } = useAction()
  const idsKey = ids.join(',')
  const asOf = today()

  const [editing, setEditing] = useState(false)
  const [doing, setDoing] = useState<TxnKind | null>(null)
  const [valuing, setValuing] = useState(false)
  const [deciding, setDeciding] = useState<{ txn: HoldingTxn; decision: 'approved' | 'rejected' } | null>(null)

  const main = useAsync(async () => {
    const holding = (await api.listHoldings(ids)).find((h) => h.id === id) ?? null
    if (!holding) return { holding, txns: [], funds: [] }
    const [txns, funds] = await Promise.all([api.listHoldingTxns({ holdingId: id, companyIds: [holding.company_id] }), api.listFunds([holding.company_id])])
    return { holding, txns, funds }
  }, [api, id, idsKey])

  const h = main.data?.holding ?? null
  const txns = useMemo(() => main.data?.txns ?? [], [main.data])
  const pos = useMemo(() => (h ? holdingPosition(h, asOf) : null), [h, asOf])
  // the quantity held when the valuation on record was made, where it differs from what is held now
  const heldThen = useMemo(() => (h ? valuedWhenHeld([h], txns).get(h.id) ?? null : null), [h, txns])

  // the carrying amount over time, rebuilt from the posted transactions; shown only when it arrives at the figure in the books
  const trail = useMemo(() => {
    if (!h) return []
    let cost = ZERO, change = ZERO
    const points: { date: string; cost: number; carrying: number }[] = []
    for (const t of txns.filter((x) => x.status === 'posted' && x.kind !== 'income').sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at))) {
      if (t.kind === 'purchase') cost = cost.plus(t.amount)
      else if (t.kind === 'sale') { cost = cost.minus(D(t.cost_released)); change = change.minus(D(text(t.detail.fv_released))) }
      else if (t.kind === 'write_down') { if (h.measurement === 'cost') cost = cost.minus(t.amount); else change = change.minus(t.amount) }
      else change = change.plus(t.amount)
      points.push({ date: t.txn_date, cost: cost.toNumber(), carrying: cost.plus(change).toNumber() })
    }
    return cost.eq(h.cost) && change.eq(h.fv_adjustment) ? points : []
  }, [h, txns])

  const back = <button className="btn ghost" onClick={() => nav(BACK)}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Investments · Investment" title="Investment" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (!main.data) return <div><PageHeader eyebrow="Investments · Investment" title="Investment" actions={back} /><Panel><Loading rows={7} label="Loading the investment" /></Panel></div>
  if (!h || !pos) {
    return (
      <div>
        <PageHeader eyebrow="Investments · Investment" title="Investment" actions={back} />
        <Panel><Empty icon={<Briefcase size={20} />} title="Investment not found or not shared with you" body="This investment does not exist in the companies you can access, or it is classified above your clearance." action={<button className="btn" onClick={() => nav(BACK)}><ArrowLeft size={14} /> Back to Investments</button>} /></Panel>
      </div>
    )
  }

  const manage = can('investment.manage', h.company_id)
  const approve = can('investment.approve', h.company_id)
  const pending = txns.find((t) => t.status === 'proposed') ?? null
  const atCost = h.measurement === 'cost'
  const fund = h.fund_id ? main.data.funds.find((f) => f.id === h.fund_id) ?? null : null
  const why = (kind: TxnKind | 'valuation') =>
    !manage ? 'You need the permission investment.manage in this company'
      : pending ? 'An entry for this investment is already awaiting approval. Approve or reject it first.'
      : h.status !== 'active' && kind !== 'income' ? `This investment is ${human(h.status)}.`
      : kind === 'sale' && D(h.quantity).lte(0) ? 'Nothing is held that could be sold.'
      : kind === 'write_down' && pos.carrying.lte(0) ? 'The carrying amount is nil.'
      : undefined
  const whyNotDecide = (t: HoldingTxn) => (!approve ? 'You need the permission investment.approve in this company' : ownWork(t.created_by) ? 'You recorded this valuation. A second person decides on it.' : undefined)

  const moves = txns.filter((t) => t.kind !== 'valuation')
  const valuations = txns.filter((t) => t.kind === 'valuation')
  const waiting = valuations.filter((t) => t.status === 'recorded')
  const entry = (t: HoldingTxn) => (t.journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + t.journal_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">{t.kind === 'valuation' ? 'none — beside the books' : '—'}</span>)

  const moveColumns: Column<HoldingTxn>[] = [
    { key: 'date', header: 'Date', render: (t) => <span className="num text-[12.5px]">{fmtDate(t.txn_date)}</span>, sort: (t) => t.txn_date, csv: (t) => t.txn_date },
    {
      key: 'kind', header: 'What', sort: (t) => t.kind, csv: (t) => [KIND_LABEL[t.kind], text(t.detail.income_kind), text(t.detail.reference), text(t.detail.reason), text(t.detail.counterparty)].filter(Boolean).join(' · '),
      render: (t) => (
        <div className="min-w-0">
          <div className="text-ink">{t.kind === 'income' && text(t.detail.income_kind) ? `${human(text(t.detail.income_kind)).replace(/^\w/, (m) => m.toUpperCase())} received` : KIND_LABEL[t.kind]}</div>
          <div className="text-[11px] text-muted">{[text(t.detail.reference), text(t.detail.reason), text(t.detail.counterparty)].filter(Boolean).join(' · ')}{text(t.detail.tax_deducted) && <> · tax deducted <Money value={text(t.detail.tax_deducted)} currency={h.currency} /></>}</div>
        </div>
      ),
    },
    { key: 'qty', header: 'Quantity', align: 'right', render: (t) => (t.quantity === null ? <span className="text-muted">—</span> : <span className="num">{t.kind === 'sale' ? '−' : ''}{fmtQty(t.quantity, h.currency)}</span>), sort: (t) => D(t.quantity).toNumber(), csv: (t) => (t.quantity === null ? '' : D(t.quantity).toString()) },
    { key: 'amount', header: 'Amount', align: 'right', render: (t) => <Money value={t.amount} currency={h.currency} className="text-ink" />, sort: (t) => D(t.amount).toNumber(), csv: (t) => D(t.amount).toFixed(2) },
    {
      key: 'released', header: 'Carrying amount released', align: 'right', sort: (t) => D(t.cost_released).plus(D(text(t.detail.fv_released))).toNumber(), csv: (t) => (t.kind === 'sale' ? D(t.cost_released).plus(D(text(t.detail.fv_released))).toFixed(2) : ''),
      render: (t) => (t.kind === 'sale' ? <span title={`Cost ${D(t.cost_released).toFixed(2)} + change in fair value ${D(text(t.detail.fv_released)).toFixed(2)}`}><Money value={D(t.cost_released).plus(D(text(t.detail.fv_released)))} currency={h.currency} dim /></span> : <span className="text-muted">—</span>),
    },
    { key: 'gain', header: 'Gain or loss', align: 'right', render: (t) => (t.gain === null ? <span className="text-muted">—</span> : <Money value={t.gain} currency={h.currency} colored sign />), sort: (t) => D(t.gain).toNumber(), csv: (t) => (t.gain === null ? '' : D(t.gain).toFixed(2)) },
    { key: 'status', header: 'Status', render: (t) => <StatusChip status={t.status} label={STATUS_LABEL[t.status]} />, sort: (t) => t.status, csv: (t) => STATUS_LABEL[t.status] },
    { key: 'entry', header: 'Entry', render: entry },
  ]

  const valuationColumns: Column<HoldingTxn>[] = [
    { key: 'date', header: 'As of', render: (t) => <span className="num text-[12.5px]">{fmtDate(t.txn_date)}</span>, sort: (t) => t.txn_date, csv: (t) => t.txn_date },
    { key: 'fv', header: 'Fair value', align: 'right', render: (t) => <Money value={t.fair_value} currency={h.currency} className="text-ink" />, sort: (t) => D(t.fair_value).toNumber(), csv: (t) => D(t.fair_value).toFixed(2) },
    { key: 'carried', header: 'Carrying amount at the time', align: 'right', render: (t) => (text(t.detail.carrying_amount) ? <Money value={text(t.detail.carrying_amount)} currency={h.currency} dim /> : <span className="text-muted">—</span>), sort: (t) => D(text(t.detail.carrying_amount)).toNumber(), csv: (t) => (text(t.detail.carrying_amount) ? D(text(t.detail.carrying_amount)).toFixed(2) : '') },
    { key: 'diff', header: 'Difference', align: 'right', render: (t) => <Money value={t.amount} currency={h.currency} colored sign />, sort: (t) => D(t.amount).toNumber(), csv: (t) => D(t.amount).toFixed(2) },
    {
      key: 'how', header: 'Method, valuer and basis', csv: (t) => [text(t.detail.method), text(t.detail.valuer), text(t.detail.basis)].filter(Boolean).join(' · '),
      render: (t) => (
        <div className="min-w-[220px] max-w-[420px]">
          <div className="text-ink">{text(t.detail.method) || 'Method not recorded'}</div>
          <div className="text-[11.5px] text-ink2">{text(t.detail.valuer) || 'Valuer not recorded'}</div>
          {text(t.detail.basis) && <div className="mt-0.5 text-[11.5px] text-muted">{text(t.detail.basis)}</div>}
          {text(t.detail.decision_note) && <div className="mt-0.5 text-[11.5px] text-muted">Decision: {text(t.detail.decision_note)}</div>}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sort: (t) => t.status, csv: (t) => statusOf(t),
      render: (t) => <div><StatusChip status={t.status} label={statusOf(t)} />{t.decided_at && <div className="mt-0.5 text-[11px] text-muted">decided {fmtDateTime(t.decided_at)}</div>}</div>,
    },
    { key: 'entry', header: 'Entry', render: entry },
    {
      key: 'act', header: '', align: 'right',
      render: (t) => (t.status === 'recorded' ? (
        <span className="flex justify-end gap-1.5">
          <button className="btn sm good" disabled={!!whyNotDecide(t) || busy} title={whyNotDecide(t) ?? 'The fair value is shown beside the books from then on'} onClick={() => setDeciding({ txn: t, decision: 'approved' })}><Check size={13} /> Approve</button>
          <button className="btn sm danger" disabled={!!whyNotDecide(t) || busy} title={whyNotDecide(t)} onClick={() => setDeciding({ txn: t, decision: 'rejected' })}><X size={13} /> Reject</button>
        </span>
      ) : null),
    },
  ]

  const decide = async (note: string) => {
    if (!deciding) return
    const { txn, decision } = deciding
    const ok = await act(async () => { await api.decideHoldingValuation(txn.id, decision, note || undefined); return true }, decision === 'approved' ? 'Valuation approved — the books are unchanged' : 'Valuation rejected')
    if (ok) setDeciding(null)
  }

  return (
    <div>
      <PageHeader
        eyebrow={`Investments · ${INSTRUMENT_LABEL[h.instrument]}`}
        title={`${h.holding_no} · ${h.name}`}
        subtitle={<>
          Held by {companyName(h.company_id)}{investee(h) ? <> in {h.investee_party_id ? <button className="link" onClick={() => nav('/parties/' + h.investee_party_id)}>{investee(h)}</button> : investee(h)}</> : null} · carried at {MEASUREMENT_LABEL[h.measurement]}
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          {back}
          <button className="btn" disabled={!manage} title={manage ? undefined : 'You need the permission investment.manage in this company'} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
          <button className="btn" disabled={!!why('valuation')} title={why('valuation') ?? (atCost ? 'Kept beside the books; posts nothing' : 'Proposes an entry for the change in fair value')} onClick={() => setValuing(true)}><Scale size={14} /> Record a valuation</button>
          <button className="btn" disabled={!!why('write_down')} title={why('write_down') ?? 'Proposes the entry of the write-down'} onClick={() => setDoing('write_down')}><TrendingDown size={14} /> Write down</button>
          <button className="btn" disabled={!!why('income')} title={why('income') ?? 'Proposes the entry of the income received'} onClick={() => setDoing('income')}><Wallet size={14} /> Income</button>
          <button className="btn" disabled={!!why('sale')} title={why('sale') ?? 'Proposes the entry of the sale'} onClick={() => setDoing('sale')}><TrendingUp size={14} /> Sell</button>
          <button className="btn primary" disabled={!!why('purchase')} title={why('purchase') ?? 'Proposes the entry of the purchase'} onClick={() => setDoing('purchase')}><ShoppingCart size={15} /> Buy</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={h.status} />
        <span className={cx('chip', atCost ? '' : 'cyan')}>carried at {MEASUREMENT_LABEL[h.measurement]}</span>
        {h.investee_company_id && <span className="chip gold">in a company of the group</span>}
        {h.confidentiality !== 'internal' && <span className="chip violet">{human(h.confidentiality)}</span>}
        {pending && <span className="chip warn">{KIND_LABEL[pending.kind].toLowerCase()} awaiting approval</span>}
        {waiting.length > 0 && <span className="chip warn">{waiting.length} valuation{waiting.length === 1 ? '' : 's'} awaiting a decision</span>}
      </div>

      <Note className="mb-4" kind={pos.valuationAge !== null && pos.valuationAge > 92 && !atCost ? 'warn' : 'info'}>
        {atCost
          ? pos.valuation === null ? 'Carried at cost. No valuation is on record.' : <>Carried at cost. A valuation as of {fmtDate(h.fair_value_date)} puts it at <Money value={pos.valuation} currency={h.currency} />; that figure is not in the books.</>
          : pos.valuation === null ? 'Carried at fair value, but no valuation is on record: the books show what was paid.' : <>Carried at fair value. The last valuation is as of {fmtDate(h.fair_value_date)}{pos.valuationAge !== null && pos.valuationAge > 92 ? `, ${pos.valuationAge} days ago` : ''}.</>}
      </Note>
      {heldThen && <Note kind="warn" className="mb-4">The valuation on record was made when <span className="num">{fmtQty(heldThen, h.currency)}</span> were held; <span className="num">{fmtQty(h.quantity, h.currency)}</span> are held now. It has not been restated, so it does not describe what is held today and is not compared with the carrying amount. Record a new valuation.</Note>}
      {pending && <Note kind="warn" className="mb-4">An entry for this investment is awaiting approval{pending.journal_id ? <> — <button className="link" onClick={() => nav('/journals/' + pending.journal_id)}>open it</button></> : null}. Nothing else can be proposed until a second person approves or rejects it. The figures below do not include it.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Quantity held" sub={pos.costPerUnit ? <span>cost for each: <Money value={pos.costPerUnit} currency={h.currency} decimals={4} /> · cost ÷ quantity</span> : 'Nothing is held'}><span className="num">{fmtQty(h.quantity, h.currency)}</span></Tile>
        <Stat label="Cost" value={h.cost} currency={h.currency} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> what was paid for what is still held</span>} />
        <Stat label="Carrying amount in the books" value={pos.carrying} currency={h.currency} tone="gold"
          sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> cost{atCost ? '' : <> + posted changes in fair value <Money value={h.fv_adjustment} currency={h.currency} compact sign /></>}</span>} />
        <Tile label="Latest approved fair value"
          sub={pos.valuation === null ? 'No valuation has been approved' : <span className={cx((heldThen || (pos.valuationAge !== null && pos.valuationAge > 92)) && 'text-warn')}>as of {fmtDate(h.fair_value_date)}{pos.valuationAge !== null ? ` · ${pos.valuationAge} day${pos.valuationAge === 1 ? '' : 's'} ago` : ''} · {heldThen ? `of ${fmtQty(heldThen, h.currency)} held then` : atCost ? 'beside the books' : 'its change is in the books'}</span>}>
          {pos.valuation === null ? <span className="text-muted">—</span> : <Money value={pos.valuation} currency={h.currency} compact />}
        </Tile>
        <Tile label={atCost ? 'Fair value less carrying amount' : 'Unrealised change in the books'} tone={(atCost ? (heldThen ? null : pos.beside) : D(h.fv_adjustment))?.isNegative() ? 'text-neg' : (atCost ? (heldThen ? null : pos.beside) : D(h.fv_adjustment))?.gt(0) ? 'text-pos' : undefined}
          sub={atCost ? (heldThen ? 'Not stated: the valuation is of a different quantity.' : 'Beside the books. It is not in them and is not added to them.') : 'The sum of the changes in fair value that have been posted.'}>
          <span className="flex items-center gap-2">
            {atCost ? (pos.beside === null || heldThen ? <span className="text-muted">—</span> : <Money value={pos.beside} currency={h.currency} compact sign />) : <Money value={h.fv_adjustment} currency={h.currency} compact sign />}
            {atCost && pos.beside !== null && !heldThen && <Explain title="Fair value less carrying amount" text="This investment is carried at cost. The approved valuation is kept beside the books so that the two can be compared. The difference is not a gain or a loss in the books." formula="latest approved fair value − carrying amount in the books" inputs={[{ label: 'Latest approved fair value', value: pos.valuation ?? 0 }, { label: 'Carrying amount in the books', value: pos.carrying }]} source={`Source: the valuation of ${fmtDate(h.fair_value_date)} and the posted entries of this investment.`} />}
          </span>
        </Tile>
        <Stat label="Income received" value={h.income_received} currency={h.currency} sub="dividends, interest and distributions, before tax deducted" />
        <Tile label="Realised gain or loss" tone={D(h.realised_gain).isNegative() ? 'text-neg' : D(h.realised_gain).gt(0) ? 'text-pos' : undefined} sub="proceeds less the carrying amount released, on what was sold">
          <Money value={h.realised_gain} currency={h.currency} compact sign />
        </Tile>
        <Tile label={h.status === 'active' ? 'Held since' : 'Held from and to'} sub={h.status === 'active' ? (h.acquired_on ? 'date of the first purchase posted' : 'No purchase has been posted') : human(h.status)}>
          <span className="num text-[18px]">{fmtDate(h.acquired_on)}{h.exited_on ? ` – ${fmtDate(h.exited_on)}` : ''}</span>
        </Tile>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          {trail.length > 1 && (
            <Section title="What the books carried it at" right={<Truth state="ACTUAL" />}>
              <Panel className="p-4" lit={false}>
                <TrendChart height={220} labels={trail.map((p) => fmtDate(p.date))}
                  series={atCost ? [{ name: 'Cost, which is the carrying amount', values: trail.map((p) => p.cost) }] : [{ name: 'Carrying amount in the books', values: trail.map((p) => p.carrying) }, { name: 'Cost', values: trail.map((p) => p.cost), color: 'var(--cyan)', dashed: true }]} />
              </Panel>
              <div className="mt-2 text-[11.5px] text-muted">Rebuilt from the posted transactions of this investment, one point for each. It arrives at the carrying amount in the books today.</div>
            </Section>
          )}

          <Section title="Transactions">
            <Panel lit={false}>
              <DataTable columns={moveColumns} rows={moves} rowKey={(t) => t.id} exportName={`investment-transactions-${h.holding_no}`} initialSort={{ key: 'date', dir: 'desc' }}
                rowClass={(t) => (t.status === 'proposed' ? 'bg-warnsoft' : undefined)}
                toolbar={<span className="text-[12px] text-muted">Each transaction proposes an accounting entry. The figures of the investment change only when that entry is approved and posted.</span>}
                empty={{ title: 'Nothing has been recorded', body: 'Record the purchase to propose its accounting entry. The investment carries a cost once that entry is approved.', icon: <ShoppingCart size={20} />, action: <button className="btn sm" disabled={!!why('purchase')} title={why('purchase')} onClick={() => setDoing('purchase')}><ShoppingCart size={13} /> Buy</button> }} />
            </Panel>
          </Section>

          <Section title="Valuations">
            <Panel lit={false}>
              <DataTable columns={valuationColumns} rows={valuations} rowKey={(t) => t.id} exportName={`investment-valuations-${h.holding_no}`} initialSort={{ key: 'date', dir: 'desc' }}
                toolbar={<span className="text-[12px] text-muted">{atCost
                  ? 'This investment is carried at cost. A valuation is kept beside the books and posts nothing; a second person approves or rejects it.'
                  : 'This investment is carried at fair value. A valuation proposes an entry for the change, which a second person approves in the approval inbox.'}</span>}
                empty={{ title: 'No valuation is on record', body: 'A valuation states its date, the fair value, the method, who made it and the assumptions it rests on.', icon: <Scale size={20} />, action: <button className="btn sm" disabled={!!why('valuation')} title={why('valuation')} onClick={() => setValuing(true)}><Scale size={13} /> Record a valuation</button> }} />
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">Difference = fair value − carrying amount in the books on the day the valuation was recorded. A valuation is an opinion of value with a date; it is not a price at which the investment can be sold.</div>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Held by">{companyName(h.company_id)}</Fact>
              <Fact label="Invested in">{h.investee_party_id ? <button className="link text-left" onClick={() => nav('/parties/' + h.investee_party_id)}>{partyName(h.investee_party_id)}</button> : h.investee_company_id ? <>{companyName(h.investee_company_id)} <span className="text-[11.5px] text-muted">· a company of the group</span></> : 'No single investee is named'}</Fact>
              <Fact label="Instrument">{INSTRUMENT_LABEL[h.instrument]}</Fact>
              <Fact label="Carried in the books at">{atCost ? 'Cost' : 'Fair value'}</Fact>
              <Fact label="Currency"><span className="num">{h.currency}</span></Fact>
              <Fact label="Fund">{fund ? <button className="link text-left" onClick={() => nav('/investments/funds/' + fund.id)}>{fund.name}</button> : h.fund_id ? 'A fund that is not shared with you' : 'Not part of a fund'}</Fact>
              <Fact label="Asset ledger" className="sm:col-span-2"><button className="link text-left" onClick={() => nav(ledgerLink({ accounts: [h.investment_account_id] }))}>{accountName(h.investment_account_id)}</button></Fact>
              <Fact label="Income ledger">{h.income_account_id ? accountName(h.income_account_id) : 'From the account map: income from investments'}</Fact>
              <Fact label="Gain or loss ledger">{h.gain_account_id ? accountName(h.gain_account_id) : 'From the account map: gain or loss on investments'}</Fact>
              <Fact label="Fair value ledger" className="sm:col-span-2">{h.fv_account_id ? accountName(h.fv_account_id) : 'From the account map: changes in fair value'}</Fact>
              {h.notes && <Fact label="Notes" className="sm:col-span-2">{h.notes}</Fact>}
            </Panel>
          </Section>

          <Attachments companyId={h.company_id} entity="holdings" entityId={h.id} title="Evidence — agreements, contract notes, valuation reports" />
          <History entity="holdings" entityId={h.id} />
        </div>
      </div>

      <HoldingForm open={editing} holding={h} companyIds={[h.company_id]} funds={main.data.funds} onClose={() => setEditing(false)} />
      <TxnModal kind={doing} h={h} onClose={() => setDoing(null)} />
      <ValuationModal open={valuing} h={h} onClose={() => setValuing(false)} />
      <ReasonDialog open={!!deciding} required={deciding?.decision === 'rejected'} danger={deciding?.decision === 'rejected'}
        title={deciding?.decision === 'approved' ? 'Approve this valuation' : 'Reject this valuation'} confirm={deciding?.decision === 'approved' ? 'Approve' : 'Reject'}
        body={deciding && (deciding.decision === 'approved'
          ? <>The fair value of <Money value={deciding.txn.fair_value} currency={h.currency} /> as of {fmtDate(deciding.txn.txn_date)} will be shown as the latest valuation of this investment. {atCost ? 'It stands beside the books. The books are unchanged: this investment is carried at cost.' : 'It equals the carrying amount, so nothing is posted.'}</>
          : <>The valuation of <Money value={deciding.txn.fair_value} currency={h.currency} /> as of {fmtDate(deciding.txn.txn_date)} will be kept on record as rejected. It will not be shown as the fair value of the investment.</>)}
        onCancel={() => setDeciding(null)} onConfirm={(r) => void decide(r)} />
    </div>
  )
}

// =====================================================================
// Buy, sell, income, write-down: each proposes one entry
// =====================================================================
const TXN_TITLE: Record<TxnKind, string> = { purchase: 'Record a purchase', sale: 'Record a sale', income: 'Record income received', write_down: 'Write down the investment' }
const TXN_DONE: Record<TxnKind, string> = { purchase: 'Purchase proposed — awaiting approval', sale: 'Sale proposed — awaiting approval', income: 'Income proposed — awaiting approval', write_down: 'Write-down proposed — awaiting approval' }
const INCOME_KINDS: NonNullable<HoldingTxnInput['income_kind']>[] = ['dividend', 'interest', 'distribution']

function TxnModal({ kind, h, onClose }: { kind: TxnKind | null; h: Holding; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const ledgers = useMoneyLedgers(h.company_id)
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [quantity, setQuantity] = useState('')
  const [bank, setBank] = useState('')
  const [reference, setReference] = useState('')
  const [tax, setTax] = useState('')
  const [incomeKind, setIncomeKind] = useState<NonNullable<HoldingTxnInput['income_kind']>>('dividend')
  const [reason, setReason] = useState('')
  const [counterparty, setCounterparty] = useState('')
  // the last kind stays on screen while the dialog closes
  const [shown, setShown] = useState<TxnKind>('purchase')
  useEffect(() => {
    if (!kind) return
    setShown(kind); setDate(today()); setAmount(''); setQuantity(''); setReference(''); setTax(''); setReason(''); setCounterparty('')
    setIncomeKind(h.instrument === 'debt' || h.instrument === 'convertible' ? 'interest' : h.instrument === 'units' ? 'distribution' : 'dividend')
    setBank(ledgers.find((l) => l.control_type === 'bank')?.id ?? ledgers[0]?.id ?? '')
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = kind ?? shown

  const amt = round2(amount || 0), qty = D(quantity), held = D(h.quantity), taxed = round2(tax || 0)
  const carrying = D(h.cost).plus(h.fv_adjustment)
  // a sale releases the carrying amount in proportion to the quantity sold; the whole of it when everything is sold
  const all = qty.eq(held)
  const share = (v: typeof h.cost) => (held.isZero() ? ZERO : all ? D(v) : round2(D(v).times(qty).div(held)))
  const costReleased = share(h.cost), changeReleased = share(h.fv_adjustment)
  const gain = amt.minus(costReleased).minus(changeReleased)

  const problems: string[] = []
  if (!date) problems.push('Choose the date.')
  if (amt.lte(0)) problems.push(k === 'sale' ? 'Enter the proceeds of the sale.' : k === 'income' ? 'Enter the income, before tax deducted.' : 'Enter the amount.')
  if (k === 'purchase' && qty.lte(0)) problems.push('State the quantity bought.')
  if (k === 'sale' && (qty.lte(0) || qty.gt(held))) problems.push(`The quantity sold must be greater than zero and cannot exceed the ${fmtQty(held, h.currency)} held.`)
  if (k === 'income' && taxed.gte(amt) && amt.gt(0)) problems.push('Tax deducted must be less than the income.')
  if (k === 'write_down' && amt.gt(carrying)) problems.push(`The write-down cannot exceed the carrying amount of ${fmtMoney(carrying, { currency: h.currency })}.`)
  if (k === 'write_down' && !reason.trim()) problems.push('Record the basis of the write-down.')
  if (k !== 'write_down' && !bank) problems.push('Choose the bank or cash ledger the money went through.')

  const submit = async () => {
    const input: HoldingTxnInput = {
      holding_id: h.id, kind: k, date, amount: amt.toString(), reference: reference.trim() || undefined,
      ...(k === 'purchase' || k === 'sale' ? { quantity: qty.toString() } : {}),
      ...(k !== 'write_down' ? { bank_ledger_id: bank } : { reason: reason.trim() }),
      ...(k === 'income' ? { income_kind: incomeKind, tax_deducted: taxed.toString() } : {}),
      ...(k === 'sale' && counterparty.trim() ? { counterparty: counterparty.trim() } : {}),
    }
    const j = await act(() => api.proposeHoldingTxn(input), TXN_DONE[k])
    if (j) onClose()
  }
  const money = (v: Parameters<typeof Money>[0]['value'], cls?: string) => <Money value={v} currency={h.currency} className={cls} />
  const touched = amount !== '' || quantity !== '' || reason !== ''
  const known = amount !== '' && qty.gt(0)

  return (
    <Modal open={!!kind} onClose={onClose} title={TXN_TITLE[k]} subtitle={`${h.holding_no} · ${h.name}`} width={580}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={problems.length > 0 || busy} title={problems[0]} onClick={() => void submit()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Propose the entry</button></>}>
      <ProposedNote>{k === 'write_down'
        ? 'This proposes an accounting entry. The carrying amount is lowered only after a second person approves it in the approval inbox. No money moves.'
        : undefined}</ProposedNote>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={k === 'purchase' ? 'Date of the purchase' : k === 'sale' ? 'Date of the sale' : k === 'income' ? 'Date the money was received' : 'Date of the write-down'}><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {k === 'income' && <Field label="Kind of income"><select className="field" value={incomeKind} onChange={(e) => setIncomeKind(e.target.value as typeof incomeKind)}>{INCOME_KINDS.map((x) => <option key={x} value={x}>{x.replace(/^\w/, (m) => m.toUpperCase())}</option>)}</select></Field>}
        {(k === 'purchase' || k === 'sale') && <Field label={k === 'purchase' ? 'Quantity bought' : 'Quantity sold'} hint={k === 'sale' ? `${fmtQty(held, h.currency)} held` : 'Shares, units or other count'}><input className="field num" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(digits(e.target.value))} autoFocus /></Field>}
        <Field label={k === 'purchase' ? 'Amount paid' : k === 'sale' ? 'Proceeds received' : k === 'income' ? 'Income, before tax deducted' : 'Amount written down'} hint={k === 'write_down' ? `Up to the carrying amount of ${fmtMoney(carrying, { currency: h.currency })}` : undefined}>
          <input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(digits(e.target.value))} autoFocus={k === 'income' || k === 'write_down'} />
        </Field>
        {k === 'income' && <Field label="Tax deducted at source" hint="As stated by the payer; leave empty when none was deducted"><input className="field num" inputMode="decimal" value={tax} onChange={(e) => setTax(digits(e.target.value))} /></Field>}
        {k !== 'write_down' && (
          <Field label={k === 'purchase' ? 'Bank or cash ledger the money was paid from' : 'Bank or cash ledger that received the money'} className="sm:col-span-2" hint={ledgers.length ? undefined : 'This company has no bank or cash ledger.'}>
            <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Choose…</option>{ledgers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select>
          </Field>
        )}
        {k === 'sale' && <Field label="Sold to (optional)"><input className="field" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></Field>}
        {k === 'write_down'
          ? <Field label="Basis of the write-down" className="sm:col-span-2" hint="Why the investment is worth less than the books show, and on what evidence. It is written into the entry."><textarea className="field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          : <Field label="Reference" className={k === 'sale' ? undefined : 'sm:col-span-2'} hint="Agreement, contract note, UTR or advice number"><input className="field" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
      </div>

      <Panel className="mt-4 space-y-1.5 p-3.5 text-[12.5px] text-ink2" lit={false}>
        <div className="eyebrow">What the entry will say — calculated before it is proposed</div>
        {k === 'purchase' && <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Cost after approval = cost</span>{money(h.cost)}<span>+ amount paid</span>{money(amt)}<span>=</span>{money(D(h.cost).plus(amt), 'font-medium text-ink')}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Quantity after approval =</span><span className="num">{fmtQty(held, h.currency)}</span><span>+</span><span className="num">{fmtQty(qty, h.currency)}</span><span>=</span><span className="num font-medium text-ink">{fmtQty(held.plus(qty), h.currency)}</span>{qty.gt(0) && amt.gt(0) && <span className="text-muted">· this purchase costs <Money value={amt.div(qty)} currency={h.currency} decimals={4} /> for each</span>}</div>
          <div className="text-[11.5px] text-muted">On approval: {accountName(h.investment_account_id)} is debited and the bank or cash ledger is credited.</div>
        </>}
        {k === 'sale' && <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Cost released = cost</span>{money(h.cost)}<span>×</span><span className="num">{fmtQty(qty, h.currency)}</span><span>÷</span><span className="num">{fmtQty(held, h.currency)}</span><span>=</span>{money(costReleased, 'text-ink')}</div>
          {!D(h.fv_adjustment).isZero() && <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Change in fair value released =</span>{money(h.fv_adjustment)}<span>×</span><span className="num">{fmtQty(qty, h.currency)}</span><span>÷</span><span className="num">{fmtQty(held, h.currency)}</span><span>=</span>{money(changeReleased, 'text-ink')}</div>}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Carrying amount released =</span>{money(costReleased.plus(changeReleased), 'text-ink')}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{known && gain.isNegative() ? 'Loss' : 'Gain or loss'} = proceeds</span>{money(amt)}<span>− cost released</span>{money(costReleased)}<span>− change in fair value released</span>{money(changeReleased)}<span>=</span>
            {!known ? <span className="text-muted">enter the quantity and the proceeds</span> : <Money value={gain} currency={h.currency} sign className={cx('font-medium', gain.isNegative() ? 'text-neg' : 'text-pos')} />}
          </div>
          <div className="text-[11.5px] text-muted">The amounts released are in proportion to the quantity sold, rounded to two decimals; when everything is sold the whole carrying amount is released. On approval {!known ? 'a gain is credited, or a loss is debited,' : gain.isNegative() ? 'the loss is debited' : 'the gain is credited'} to {h.gain_account_id ? accountName(h.gain_account_id) : 'the ledger set for gain or loss on investments in the account map'}.{all && held.gt(0) ? ' Nothing will remain: the investment becomes exited.' : ''}</div>
        </>}
        {k === 'income' && <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Money received = income</span>{money(amt)}<span>− tax deducted</span>{money(taxed)}<span>=</span>{money(amt.minus(taxed), 'font-medium text-ink')}</div>
          <div className="text-[11.5px] text-muted">On approval: the bank or cash ledger is debited with the money received, {taxed.gt(0) ? 'the tax deducted is debited to the ledger of tax receivable, ' : ''}and {h.income_account_id ? accountName(h.income_account_id) : 'the ledger set for income from investments in the account map'} is credited with the income.</div>
        </>}
        {k === 'write_down' && <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Carrying amount after approval =</span>{money(carrying)}<span>− written down</span>{money(amt)}<span>=</span>{money(carrying.minus(amt), cx('font-medium', carrying.minus(amt).isNegative() ? 'text-neg' : 'text-ink'))}</div>
          <div className="text-[11.5px] text-muted">On approval: the loss is debited to {h.gain_account_id ? accountName(h.gain_account_id) : 'the ledger set for gain or loss on investments in the account map'} and {accountName(h.investment_account_id)} is credited. A write-down is a judgement recorded by a person with its basis.</div>
        </>}
      </Panel>
      {problems.length > 0 && touched && <div className="mt-3 text-[12px] text-warn">{problems[0]}</div>}
    </Modal>
  )
}

// =====================================================================
// A valuation: beside the books at cost, an entry at fair value
// =====================================================================
function ValuationModal({ open, h, onClose }: { open: boolean; h: Holding; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const accountName = useAccountName()
  const { act, busy } = useAction()
  const [date, setDate] = useState(today())
  const [value, setValue] = useState('')
  const [method, setMethod] = useState('')
  const [valuer, setValuer] = useState('')
  const [basis, setBasis] = useState('')
  useEffect(() => { if (open) { setDate(today()); setValue(''); setMethod(''); setValuer(''); setBasis('') } }, [open])

  const atCost = h.measurement === 'cost'
  const carrying = D(h.cost).plus(h.fv_adjustment)
  const fair = round2(value || 0)
  const diff = fair.minus(carrying)
  const entered = value !== ''
  const posts = !atCost && entered && !diff.isZero()
  const problems: string[] = []
  if (!date) problems.push('Choose the date the valuation is of.')
  if (value === '') problems.push('Enter the fair value.')
  if (!method.trim()) problems.push('State the method.')
  if (!valuer.trim()) problems.push('State who made the valuation.')
  if (!basis.trim()) problems.push('State the assumptions the valuation rests on.')

  const submit = async () => {
    const id = await act(() => api.recordHoldingValuation({ holding_id: h.id, date, fair_value: fair.toString(), method: method.trim(), valuer: valuer.trim(), basis: basis.trim() }),
      posts ? 'Valuation recorded — its entry awaits approval' : 'Valuation recorded — it awaits the decision of a second person')
    if (id) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a valuation" subtitle={`${h.holding_no} · ${h.name} · carried at ${MEASUREMENT_LABEL[h.measurement]}`} width={600}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={problems.length > 0 || busy} title={problems[0]} onClick={() => void submit()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} {atCost || (entered && !posts) ? 'Record the valuation' : 'Propose the entry'}</button></>}>
      {atCost
        ? <Note className="mb-4">This investment is <span className="font-medium text-ink">carried at cost</span>. The valuation is kept beside the books and posts nothing. A second person approves or rejects it; once approved it is shown as the fair value, with its date, next to the carrying amount.</Note>
        : <ProposedNote>This investment is <span className="font-medium text-ink">carried at fair value</span>. Recording the valuation proposes an accounting entry for the change. The carrying amount changes only after a second person approves that entry in the approval inbox. No money moves.</ProposedNote>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valuation as of"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Fair value" hint="Of the whole holding, not of one share or unit"><input className="field num" inputMode="decimal" value={value} onChange={(e) => setValue(digits(e.target.value))} autoFocus /></Field>
        <Field label="Method" hint="For example: price of the latest funding round, discounted cash flow, closing price on the exchange"><input className="field" value={method} onChange={(e) => setMethod(e.target.value)} /></Field>
        <Field label="Valuer" hint="The person or firm that made the valuation"><input className="field" value={valuer} onChange={(e) => setValuer(e.target.value)} /></Field>
        <Field label="Basis" className="sm:col-span-2" hint="The assumptions the valuation rests on. Attach the report under Evidence."><textarea className="field" rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} /></Field>
      </div>
      <Panel className="mt-4 space-y-1.5 p-3.5 text-[12.5px] text-ink2" lit={false}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>Difference = fair value</span><Money value={fair} currency={h.currency} /><span>− carrying amount in the books</span><Money value={carrying} currency={h.currency} /><span>=</span>
          {value === '' ? <span className="text-muted">enter the fair value</span> : <Money value={diff} currency={h.currency} sign className={cx('font-medium', diff.isNegative() ? 'text-neg' : diff.gt(0) ? 'text-pos' : 'text-ink')} />}
        </div>
        <div className="text-[11.5px] text-muted">
          {atCost ? 'Nothing is posted. The difference stands beside the books and is not a gain or a loss in them.'
            : !entered ? 'The entry proposed will be for this difference: a rise is an unrealised gain, a fall an unrealised loss. Nothing has been sold.'
            : diff.isZero() ? 'The fair value equals the carrying amount: there is no change to post. The valuation is kept on record and awaits the decision of a second person.'
            : `On approval: ${accountName(h.investment_account_id)} is ${diff.isNegative() ? 'credited' : 'debited'} and ${h.fv_account_id ? accountName(h.fv_account_id) : 'the ledger set for changes in fair value in the account map'} is ${diff.isNegative() ? 'debited' : 'credited'} with the change. It is an unrealised ${diff.isNegative() ? 'loss' : 'gain'}: nothing has been sold.`}
        </div>
      </Panel>
      {problems.length > 0 && value !== '' && <div className="mt-3 text-[12px] text-warn">{problems[0]}</div>}
    </Modal>
  )
}
