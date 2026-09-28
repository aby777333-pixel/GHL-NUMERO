import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, Check, CheckCircle2, Circle, CircleDot, ExternalLink, HandCoins, Pencil, Send, X } from 'lucide-react'
import type { ID } from '@/engine/types'
import type { Distribution, DistributionLine } from '@/engine/p3Types'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import { D, sum } from '@/lib/money'
import { fmtDate } from '@/lib/dates'
import { cx, Empty, ErrorBox, Explain, Loading, Money, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip, Truth } from '@/ui/kit'
import { ApprovalTrail, Attachments, MoneyMoveDialog, ProposedEntries, Stat, useAccountName, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, Fact, foot, History, human, NoAccess } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { Donut } from '@/ui/charts'
import { DIST_KIND_LABEL, DIST_STATUS_LABEL, DistributionForm, fmtQty, pctText, useOwnWork } from './Investments'

// =====================================================================
// Distribution 360: one dividend or distribution — who is entitled to
// how much and why, and how far it has come.
// DECLARATION ≠ APPROVAL ≠ PAYMENT. Approving proposes the entry of the
// declaration; the declaration stands when that entry is posted; each
// payment to holders PROPOSES its own entry. Declaring pays nothing.
// =====================================================================

const BACK = '/investments?tab=distributions'
const STEPS: { key: string; label: string; says: string }[] = [
  { key: 'draft', label: 'Draft', says: 'Entitlements worked out. Nothing is declared.' },
  { key: 'submitted', label: 'Submitted', says: 'Awaiting the approval of a second person.' },
  { key: 'approved', label: 'Approved', says: 'The entry of the declaration is proposed.' },
  { key: 'declared', label: 'Declared', says: 'That entry is posted: the amounts are owed.' },
  { key: 'paid', label: 'Paid', says: 'Payment recorded and posted, holder by holder.' },
]
const STEP_OF: Record<Distribution['status'], number> = { draft: 0, submitted: 1, approved: 2, declared: 3, part_paid: 4, paid: 4, rejected: -1, cancelled: -1 }

export default function Distribution360() {
  const { id } = useParams<{ id: string }>()
  useApp((s) => s.session)
  const companies = useApp((s) => s.companies)
  const ids = companies.map((c) => c.id).filter((cid) => can('investment.view', cid))
  if (!ids.length || !id) return <NoAccess eyebrow="Investments · Dividend or distribution" title="Dividends and distributions" perm="investment.view" back={BACK} />
  return <DistributionView key={id} id={id} ids={ids} />
}

function DistributionView({ id, ids }: { id: ID; ids: ID[] }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const ownWork = useOwnWork()
  const { act, busy } = useAction()
  const idsKey = ids.join(',')

  const [editing, setEditing] = useState(false)
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [chosen, setChosen] = useState<ID[]>([])
  const [paying, setPaying] = useState<ID[] | null>(null)

  const main = useAsync(async () => {
    // the list returns only what is shared with the person; the detail is read only for a record found there
    const found = (await api.listDistributions(ids)).find((x) => x.id === id)
    if (!found) return null
    const [dist, funds] = await Promise.all([api.getDistribution(id), api.listFunds([found.company_id])])
    return { dist, funds }
  }, [api, id, idsKey])

  const dist = main.data?.dist ?? null
  const lines = useMemo(() => [...(dist?.lines ?? [])].sort((a, b) => D(b.units).cmp(a.units)), [dist])
  const units = useMemo(() => sum(lines.map((l) => l.units)), [lines])

  const back = <button className="btn ghost" onClick={() => nav(BACK)}><ArrowLeft size={15} /> Back</button>
  if (main.error) return <div><PageHeader eyebrow="Investments · Dividend or distribution" title="Dividend or distribution" actions={back} /><ErrorBox message={main.error} retry={main.reload} /></div>
  if (main.data === undefined) return <div><PageHeader eyebrow="Investments · Dividend or distribution" title="Dividend or distribution" actions={back} /><Panel><Loading rows={7} label="Loading the declaration" /></Panel></div>
  if (!main.data || !dist) {
    return (
      <div>
        <PageHeader eyebrow="Investments · Dividend or distribution" title="Dividend or distribution" actions={back} />
        <Panel><Empty icon={<HandCoins size={20} />} title="Not found or not shared with you" body="This dividend or distribution does not exist in the companies you can access, or it is classified above your clearance." action={<button className="btn" onClick={() => nav(BACK)}><ArrowLeft size={14} /> Back to Investments</button>} /></Panel>
      </div>
    )
  }

  const fund = dist.fund_id ? main.data.funds.find((f) => f.id === dist.fund_id) ?? null : null
  const what = DIST_KIND_LABEL[dist.kind].toLowerCase()
  const held = dist.fund_id ? 'units' : 'shares'
  const ccy = fund?.currency ?? companies.find((c) => c.id === dist.company_id)?.base_currency
  const manage = can('investment.manage', dist.company_id)
  const approve = can('investment.approve', dist.company_id)
  const noManage = manage ? undefined : 'You need the permission investment.manage in this company'
  const whyNotDecide = !approve ? 'You need the permission investment.approve in this company' : ownWork(dist.created_by) ? `You prepared this ${what}. A second person decides on it.` : undefined

  const step = STEP_OF[dist.status]
  const payable = dist.status === 'declared' || dist.status === 'part_paid'
  const of = (status: DistributionLine['status']) => lines.filter((l) => l.status === status)
  const net = (ls: DistributionLine[]) => sum(ls.map((l) => l.net_amount))
  const unpaid = of('entitled')
  const picked = unpaid.filter((l) => chosen.includes(l.id))
  const tax = sum(lines.map((l) => l.tax_deducted))
  const shareOf = (l: DistributionLine) => (units.isZero() ? null : D(l.units).times(100).div(units))
  const payingLines = paying ? unpaid.filter((l) => paying.includes(l.id)) : []
  const toggle = (lineId: ID) => setChosen((c) => (c.includes(lineId) ? c.filter((x) => x !== lineId) : [...c, lineId]))
  const lineLabel = (l: DistributionLine) => (l.status === 'paid' ? 'paid' : l.status === 'payment_proposed' ? 'payment awaiting approval' : payable ? 'entitled — not yet paid' : 'entitled')

  const decide = async (comment: string) => {
    if (!deciding) return
    const r = await act(() => api.decideDistribution(dist.id, deciding, comment || undefined), (v) => (v === 'approved' ? 'Approved — the entry of the declaration is proposed and awaits approval' : v === 'pending' ? 'Approved at this step — a further approval is needed' : 'Rejected'))
    if (r) setDeciding(null)
  }

  const columns: Column<DistributionLine>[] = [
    ...(payable && unpaid.length > 0 ? [{
      key: 'pick', header: 'Pay', width: 52,
      render: (l: DistributionLine) => (l.status === 'entitled' ? <input type="checkbox" checked={chosen.includes(l.id)} disabled={!manage} onChange={() => toggle(l.id)} onClick={(e) => e.stopPropagation()} aria-label={`Choose ${partyName(l.holder_party_id)} for payment`} /> : null),
    }] : []),
    { key: 'holder', header: 'Holder', render: (l) => <button className="link text-left" onClick={() => nav('/parties/' + l.holder_party_id)}>{partyName(l.holder_party_id)}</button>, sort: (l) => partyName(l.holder_party_id).toLowerCase(), csv: (l) => partyName(l.holder_party_id) },
    { key: 'units', header: dist.fund_id ? 'Units held on the record date' : 'Shares held', align: 'right', render: (l) => <span className="num">{fmtQty(l.units, ccy)}</span>, sort: (l) => D(l.units).toNumber(), csv: (l) => D(l.units).toString() },
    { key: 'share', header: 'Part of the whole', align: 'right', render: (l) => <span className="num text-ink2">{pctText(shareOf(l), 4)}</span>, sort: (l) => shareOf(l)?.toNumber() ?? 0, csv: (l) => shareOf(l)?.toDecimalPlaces(4).toString() ?? '' },
    { key: 'gross', header: 'Entitled to, before tax', align: 'right', render: (l) => <Money value={l.gross_amount} currency={ccy} className="text-ink" />, sort: (l) => D(l.gross_amount).toNumber(), csv: (l) => D(l.gross_amount).toFixed(2) },
    { key: 'tax', header: 'Tax deducted', align: 'right', render: (l) => <Money value={l.tax_deducted} currency={ccy} dim />, sort: (l) => D(l.tax_deducted).toNumber(), csv: (l) => D(l.tax_deducted).toFixed(2) },
    { key: 'net', header: 'Payable', align: 'right', render: (l) => <Money value={l.net_amount} currency={ccy} className="text-ink" />, sort: (l) => D(l.net_amount).toNumber(), csv: (l) => D(l.net_amount).toFixed(2) },
    { key: 'status', header: 'Status', render: (l) => <StatusChip status={l.status} label={lineLabel(l)} />, sort: (l) => l.status, csv: (l) => lineLabel(l) },
    { key: 'paid', header: 'Paid on', render: (l) => (l.paid_on ? <span className="num text-[12.5px]">{fmtDate(l.paid_on)}</span> : <span className="text-muted">—</span>), sort: (l) => l.paid_on ?? '', csv: (l) => l.paid_on ?? '' },
    { key: 'entry', header: 'Payment entry', render: (l) => (l.payment_journal_id ? <button className="link inline-flex items-center gap-1 text-[12.5px]" onClick={() => nav('/journals/' + l.payment_journal_id)}>Open <ExternalLink size={11} /></button> : <span className="text-muted">—</span>) },
  ]
  const lead = payable && unpaid.length > 0 ? 1 : 0

  return (
    <div>
      <PageHeader
        eyebrow={`Investments · ${DIST_KIND_LABEL[dist.kind]}`}
        title={`${dist.dist_no} · ${DIST_KIND_LABEL[dist.kind]}`}
        subtitle={<>
          Declared by {fund ? <button className="link" onClick={() => nav('/investments/funds/' + fund.id)}>{fund.name}</button> : companyName(dist.company_id)} to its {dist.fund_id ? 'unit holders' : 'shareholders'} · record date {fmtDate(dist.record_date)}. Declaring pays nothing; payment is recorded holder by holder.
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          {back}
          {(dist.status === 'draft' || dist.status === 'rejected') && <button className="btn" disabled={!manage} title={noManage} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
          {dist.status === 'draft' && <button className="btn primary" disabled={!manage || busy} title={noManage} onClick={() => void act(async () => { await api.submitDistribution(dist.id); return true }, 'Submitted — awaiting approval')}><Send size={15} /> Submit for approval</button>}
          {dist.status === 'submitted' && <>
            <button className="btn danger" disabled={!!whyNotDecide || busy} title={whyNotDecide} onClick={() => setDeciding('rejected')}><X size={15} /> Reject</button>
            <button className="btn good" disabled={!!whyNotDecide || busy} title={whyNotDecide} onClick={() => setDeciding('approved')}><Check size={15} /> Approve</button>
          </>}
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={dist.status} label={DIST_STATUS_LABEL[dist.status]} />
        <span className={cx('chip', dist.kind === 'dividend' ? 'gold' : dist.kind === 'return_of_capital' ? 'violet' : 'cyan')}>{DIST_KIND_LABEL[dist.kind]}</span>
        {dist.confidentiality !== 'internal' && <span className="chip violet">{human(dist.confidentiality)}</span>}
        {of('payment_proposed').length > 0 && <span className="chip warn">payment to {of('payment_proposed').length} holder{of('payment_proposed').length === 1 ? '' : 's'} awaiting approval</span>}
        <ApprovalTrail companyId={dist.company_id} entity="distribution" entityId={dist.id} />
      </div>

      <Panel className="mb-4 p-4" lit={false}>
        {step < 0 ? (
          <div className="text-[12.5px] text-ink2">
            <span className={cx('font-medium', dist.status === 'rejected' ? 'text-neg' : 'text-ink')}>{dist.status === 'rejected' ? 'Rejected.' : 'Cancelled.'}</span> {dist.decision_note ?? (dist.status === 'cancelled' ? 'The entry of the declaration was reversed.' : 'No reason is recorded.')}
            {dist.status === 'rejected' && ' Nothing is declared and nothing is owed. Editing it makes it a draft again.'}
          </div>
        ) : (
          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-5">
            {STEPS.map((s, i) => {
              const done = i < step || dist.status === 'paid'
              const here = i === step && !done
              return (
                <li key={s.key} className={cx('flex items-start gap-2.5 rounded-xl border px-3 py-2.5', here ? 'border-line2 bg-surface2' : 'border-line')}>
                  <span className={cx('mt-[2px] flex-none', done ? 'text-pos' : here ? 'text-gold' : 'text-muted')}>{done ? <CheckCircle2 size={16} /> : here ? <CircleDot size={16} /> : <Circle size={16} />}</span>
                  <span className="min-w-0">
                    <span className={cx('block text-[12.5px] font-medium', done || here ? 'text-ink' : 'text-muted')}>{s.key === 'paid' && dist.status === 'part_paid' ? 'Paid in part' : s.label}</span>
                    <span className="block text-[11.5px] text-muted">{s.key === 'paid' && dist.status === 'part_paid' ? `${of('paid').length} of ${lines.length} holders paid.` : s.says}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </Panel>

      {dist.status === 'approved' && <Note kind="warn" className="mb-4">Approved{dist.decision_note ? ` — ${dist.decision_note}` : ''}. The entry of the declaration has been proposed and awaits approval in the approval inbox{dist.journal_id ? <> — <button className="link" onClick={() => nav('/journals/' + dist.journal_id)}>open the entry</button></> : null}. Until it is posted nothing is owed to the holders and no payment can be recorded.</Note>}
      {dist.status === 'draft' && <Note className="mb-4">A draft. The entitlements below were worked out when it was saved. Nothing is declared until it is submitted, approved by a second person, and its entry is posted.</Note>}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label={step >= 3 ? 'Declared' : 'To be declared'} value={dist.total_amount} currency={ccy} tone="gold" sub={`before tax · to ${lines.length} holder${lines.length === 1 ? '' : 's'}`} />
        <Stat label="Tax deducted" value={tax} currency={ccy} sub={<span>at <span className="num">{pctText(dist.tax_pct)}</span> · the rate entered on the declaration</span>} />
        <Stat label="Payable to holders" value={net(lines)} currency={ccy} sub="entitlement − tax deducted" />
        <Stat label="Paid" value={net(of('paid'))} currency={ccy} tone={of('paid').length ? 'pos' : undefined} sub={<span className="flex flex-wrap items-center gap-1.5"><Truth state="ACTUAL" /> {of('paid').length} holder{of('paid').length === 1 ? '' : 's'} · from posted entries</span>} />
        <Stat label="Payment awaiting approval" value={net(of('payment_proposed'))} currency={ccy} tone={of('payment_proposed').length ? 'warn' : undefined} sub={`${of('payment_proposed').length} holder${of('payment_proposed').length === 1 ? '' : 's'} · not in the ledger`} />
        <Stat label="Not yet paid" value={net(unpaid)} currency={ccy} tone={payable && unpaid.length ? 'warn' : undefined} sub={payable ? `${unpaid.length} holder${unpaid.length === 1 ? '' : 's'} · no payment recorded` : 'Payment follows the declaration'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title="Who is entitled, to how much, and why" right={<Explain title="How each entitlement is worked out"
            text={dist.fund_id ? 'A fund distributes to its unit holders in proportion to the units each of them held on the record date. Units count once the money paid for them was approved and posted on or before that date.' : 'A company pays a dividend to the shareholders on its register, in proportion to the shares each of them holds. All classes of share are counted together.'}
            formula={`entitlement = amount declared × ${held} held ÷ all ${held} held; tax = entitlement × rate; payable = entitlement − tax`}
            inputs={[{ label: 'Amount declared', value: dist.total_amount }, { label: 'Tax deducted', value: tax }, { label: 'Payable to holders', value: net(lines) }]}
            source={`Source: ${dist.fund_id ? 'the units issued by the fund up to the record date' : 'the register of shareholders of the company'}, as they stood when the draft was saved. Each entitlement is rounded to two decimals and the last holder takes the remainder, so that the lines add up to the amount declared.`} />}>
            <Panel lit={false}>
              <DataTable columns={columns} rows={lines} rowKey={(l) => l.id} exportName={`entitlements-${dist.dist_no}`} pageSize={100}
                rowClass={(l) => (chosen.includes(l.id) && l.status === 'entitled' ? 'bg-surface2' : undefined)}
                toolbar={payable ? <>
                  <button className="btn sm primary" disabled={!manage || !unpaid.length || busy} title={noManage ?? (unpaid.length ? 'Proposes one entry for the payment to every holder not yet paid' : 'Nothing is left to pay')} onClick={() => setPaying(unpaid.map((l) => l.id))}><Banknote size={13} /> Record payment to all not yet paid ({unpaid.length})</button>
                  <button className="btn sm" disabled={!manage || !picked.length || busy} title={noManage ?? (picked.length ? 'Proposes one entry for the payment to the holders chosen' : 'Choose holders in the first column')} onClick={() => setPaying(picked.map((l) => l.id))}><Banknote size={13} /> Record payment to the chosen ({picked.length})</button>
                  <span className="text-[12px] text-muted">Recording a payment proposes an entry. A holder is marked paid when that entry is approved.</span>
                </> : <span className="text-[12px] text-muted">{step < 3 && step >= 0 ? 'Payment can be recorded once the declaration is posted.' : dist.status === 'paid' ? 'Every holder has been paid.' : 'No payment can be recorded.'}</span>}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={1 + lead}>Total · {lines.length} holder{lines.length === 1 ? '' : 's'}</td>
                  <td className={cx(foot, 'r num')}>{fmtQty(units, ccy)}</td>
                  <td className={foot} />
                  <td className={cx(foot, 'r')}><Money value={sum(lines.map((l) => l.gross_amount))} currency={ccy} className="font-medium text-ink" /></td>
                  <td className={cx(foot, 'r')}><Money value={tax} currency={ccy} /></td>
                  <td className={cx(foot, 'r')}><Money value={net(lines)} currency={ccy} className="font-medium text-ink" /></td>
                  <td className={foot} colSpan={3} />
                </tr>}
                empty={{ title: 'Nobody is entitled', body: 'No holder was on record when this was saved.' }} />
            </Panel>
            <div className="mt-2 text-[11.5px] text-muted">
              Entitlement = amount declared × {held} held ÷ <span className="num">{fmtQty(units, ccy)}</span> {held}{dist.fund_id ? ` held on ${fmtDate(dist.record_date)}` : ' on the register'}. Tax = entitlement × <span className="num">{pctText(dist.tax_pct)}</span>. Payable = entitlement − tax.
              The rate of tax is the one entered on the declaration; NUMERO does not decide which rate applies to which holder.
            </div>
          </Section>

          {lines.length > 1 && (
            <Section title="Entitlement by holder">
              <Panel className="p-4" lit={false}>
                <Donut data={lines.map((l) => ({ id: l.id, label: partyName(l.holder_party_id), value: D(l.gross_amount).toNumber() }))} onSlice={(s) => { const l = lines.find((x) => x.id === s.id); if (l) nav('/parties/' + l.holder_party_id) }}
                  centre={<div><div className="text-[11px] text-muted">{step >= 3 ? 'Declared' : 'To be declared'}</div><Money value={dist.total_amount} currency={ccy} compact className="text-[15px]" /></div>} />
              </Panel>
            </Section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="Facts">
            <Panel className="grid gap-4 p-4 sm:grid-cols-2" lit={false}>
              <Fact label="Company">{companyName(dist.company_id)}</Fact>
              <Fact label="Declared by">{fund ? <button className="link text-left" onClick={() => nav('/investments/funds/' + fund.id)}>{fund.name}</button> : dist.fund_id ? 'A fund that is not shared with you' : 'The company, to its shareholders'}</Fact>
              <Fact label="Kind">{DIST_KIND_LABEL[dist.kind]}</Fact>
              <Fact label="Rate of tax deducted"><span className="num">{pctText(dist.tax_pct)}</span></Fact>
              <Fact label="Date of declaration"><span className="num">{fmtDate(dist.declaration_date)}</span></Fact>
              <Fact label="Record date"><span className="num">{fmtDate(dist.record_date)}</span></Fact>
              <Fact label="Payment date intended">{dist.payment_date ? <span className="num">{fmtDate(dist.payment_date)}</span> : 'Not set'}</Fact>
              <Fact label="Entry of the declaration">{dist.journal_id ? <button className="link inline-flex items-center gap-1" onClick={() => nav('/journals/' + dist.journal_id)}>Open <ExternalLink size={11} /></button> : 'None yet — proposed on approval'}</Fact>
              <Fact label="Equity ledger it is paid out of" className="sm:col-span-2"><button className="link text-left" onClick={() => nav(ledgerLink({ accounts: [dist.source_account_id] }))}>{accountName(dist.source_account_id)}</button></Fact>
              {dist.decision_note && <Fact label="Note of the decision" className="sm:col-span-2">{dist.decision_note}</Fact>}
              {dist.notes && <Fact label="Notes" className="sm:col-span-2">{dist.notes}</Fact>}
            </Panel>
          </Section>

          <ProposedEntries companyIds={[dist.company_id]} sourceId={dist.id} sources={['distribution', 'distribution_payment']} />
          <Attachments companyId={dist.company_id} entity="fund_distributions" entityId={dist.id} title="Evidence — resolution, payment advice, tax certificates" />
          <History entity="fund_distributions" entityId={dist.id} />
        </div>
      </div>

      <DistributionForm open={editing} distribution={dist} companyIds={[dist.company_id]} funds={main.data.funds} onClose={() => setEditing(false)} />

      <ReasonDialog open={!!deciding} required={deciding === 'rejected'} danger={deciding === 'rejected'}
        title={deciding === 'approved' ? `Approve ${dist.dist_no}` : `Reject ${dist.dist_no}`} confirm={deciding === 'approved' ? 'Approve' : 'Reject'}
        body={deciding === 'approved'
          ? <>Approving this {what} of <Money value={dist.total_amount} currency={ccy} /> proposes the entry of the declaration: {accountName(dist.source_account_id)} is debited and what is owed to each of the {lines.length} holder{lines.length === 1 ? '' : 's'} is credited. That entry is approved separately in the approval inbox. Approving pays nothing.</>
          : <>The {what} goes back to the person who prepared it, with your reason. Nothing is declared.</>}
        onCancel={() => setDeciding(null)} onConfirm={(r) => void decide(r)} />

      <MoneyMoveDialog open={!!paying} companyId={dist.company_id} bankOnly amountEditable={false} amount={net(payingLines).toString()} title="Record payment to holders" confirm="Propose the entry" busy={busy}
        subtitle={`${dist.dist_no} · ${payingLines.length} holder${payingLines.length === 1 ? '' : 's'}`}
        note="This proposes one accounting entry for a payment that has already been made from the bank account. The holders are marked paid only after a second person approves it in the approval inbox. NUMERO records that money moved; it does not move money."
        extra={(
          <Panel className="space-y-2 p-3.5 text-[12.5px] text-ink2" lit={false}>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><span>Amount = entitlement</span><Money value={sum(payingLines.map((l) => l.gross_amount))} currency={ccy} /><span>− tax deducted</span><Money value={sum(payingLines.map((l) => l.tax_deducted))} currency={ccy} /><span>=</span><Money value={net(payingLines)} currency={ccy} className="font-medium text-ink" /></div>
            <div className="max-h-[150px] overflow-auto rounded-lg border border-line">
              {payingLines.map((l) => <div key={l.id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5 last:border-0"><span>{partyName(l.holder_party_id)}</span><Money value={l.net_amount} currency={ccy} /></div>)}
            </div>
            <div className="text-[11.5px] text-muted">The amount cannot be changed: it is what is payable to the holders chosen. On approval what is owed to them is debited, the bank ledger is credited with the amount paid, and the tax deducted is credited to the ledger of tax payable. The method chosen above is written into the reference of the entry.</div>
          </Panel>
        )}
        onCancel={() => setPaying(null)}
        onConfirm={(v) => { if (!paying) return; void act(() => api.proposeDistributionPayment({ distribution_id: dist.id, bank_ledger_id: v.bank_ledger_id, date: v.date, line_ids: payingLines.map((l) => l.id), reference: [v.reference.trim(), v.method].filter(Boolean).join(' · ') || undefined }), 'Payment proposed — awaiting approval').then((j) => { if (j) { setPaying(null); setChosen([]) } }) }} />
    </div>
  )
}
