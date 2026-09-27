import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ArrowRightLeft, BadgeCheck, Calculator, Coins, History, Pencil, Plus, Save, Vault } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { ID } from '@/engine/types'
import type { CashBox, CashBoxInput, CashCount, CashCountInput, FundTransfer, FundTransferInput } from '@/engine/opsTypes'
import { D, fmtMoney, sum, ZERO } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Spinner, StatusChip, Tabs, Truth } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'
import { ProposedEntries, ProposedNote, useAccountName, useCompanyName, usePartyName, useUnitName } from '@/ui/ops'

type TabKey = 'boxes' | 'transfers'
const DENOMINATIONS = ['500', '200', '100', '50', '20', '10', '5', '2', '1']
const KIND: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash_withdrawal: 'Cash withdrawn from bank', cash_deposit: 'Cash deposited in bank',
  petty_cash_topup: 'Petty cash top-up', intercompany: 'Transfer between group companies',
}
const TRANSFER_STATUS: Record<FundTransfer['status'], { label: string; text: string }> = {
  proposed: { label: 'proposed', text: 'The entry awaits approval. Nothing has reached the ledger.' },
  part_posted: { label: 'one side posted', text: 'One of the two entries is posted; the other still awaits approval. Until both are posted the intercompany balances do not agree.' },
  posted: { label: 'posted', text: 'Approved and posted to the ledger.' },
  rejected: { label: 'rejected', text: 'An entry of this transfer was rejected. The transfer is not in the ledger as proposed.' },
  reversed: { label: 'reversed', text: 'The transfer was posted and later reversed.' },
}
const kindName = (k: string) => KIND[k] ?? k.replace(/_/g, ' ')
const numeric = (s: string) => s.replace(/[^\d.]/g, '')
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(D(v)))

interface TransferSeed { company_id: ID; to_ledger_id: ID; amount: string; purpose: string; box: CashBox }

export default function Cash() {
  const [sp, setSp] = useSearchParams()
  const tab: TabKey = sp.get('tab') === 'transfers' ? 'transfers' : 'boxes'
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const privacy = useApp((s) => s.privacy)
  const ids = useScopeIds()
  const idsKey = ids.join(',')
  const partyName = usePartyName()
  const companyName = useCompanyName()
  const accountName = useAccountName()
  const unitName = useUnitName()
  const asOf = today()

  const [boxForm, setBoxForm] = useState<CashBox | 'new' | null>(null)
  const [counting, setCounting] = useState<CashBox | null>(null)
  const [historyOf, setHistoryOf] = useState<CashBox | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [seed, setSeed] = useState<TransferSeed | null>(null)
  const [detail, setDetail] = useState<FundTransfer | null>(null)

  const boxes = useAsync(async () => {
    const list = await api.listCashBoxes(ids)
    const owners = [...new Set(list.map((b) => b.company_id))]
    const [rows, counts] = await Promise.all([
      owners.length ? api.ledgerBalances(owners, '1990-01-01', asOf).then((r) => ({ rows: r, error: null as string | null }), (e: unknown) => ({ rows: [], error: e instanceof Error ? e.message : String(e) })) : Promise.resolve({ rows: [], error: null as string | null }),
      Promise.all(list.map((b) => api.listCashCounts(b.id).catch(() => [] as CashCount[]))),
    ])
    const balance = new Map<ID, Decimal>()
    if (!rows.error) for (const b of list) {
      balance.set(b.id, sum(rows.rows.filter((r) => r.company_id === b.company_id && r.account_id === b.ledger_account_id).map((r) => D(r.opening_debit).plus(r.period_debit).minus(r.opening_credit).minus(r.period_credit))))
    }
    return { list, balance, balanceError: rows.error, last: new Map(list.map((b, i) => [b.id, counts[i][0] as CashCount | undefined])) }
  }, [api, idsKey, asOf])
  const transfers = useAsync(() => api.listFundTransfers(ids), [api, idsKey])

  const ccy = (companyId: ID) => companies.find((c) => c.id === companyId)?.base_currency ?? 'INR'
  const code = (companyId: ID) => companies.find((c) => c.id === companyId)?.code ?? '—'
  const mayManage = can('treasury.manage')
  const mayTransfer = can('payment.create')
  const go = (k: TabKey) => setSp({ tab: k }, { replace: true })
  const newTransfer = (s: TransferSeed | null) => { setSeed(s); setTransferOpen(true) }

  const columns: Column<FundTransfer>[] = [
    { key: 'no', header: 'Transfer no', render: (t) => <span className="num text-[12.5px] text-gold">{t.transfer_no}</span>, sort: (t) => t.transfer_no, csv: (t) => t.transfer_no },
    { key: 'date', header: 'Date', render: (t) => <span className="num text-[12.5px]">{fmtDate(t.transfer_date)}</span>, sort: (t) => t.transfer_date, csv: (t) => t.transfer_date },
    { key: 'kind', header: 'Kind', render: (t) => <span className="text-[12.5px] text-ink2">{kindName(t.kind)}</span>, sort: (t) => kindName(t.kind), csv: (t) => kindName(t.kind) },
    { key: 'from', header: 'From', render: (t) => <span className="text-[12.5px]"><span className="text-muted">{code(t.company_id)} · </span>{accountName(t.from_ledger_id)}</span>, sort: (t) => accountName(t.from_ledger_id), csv: (t) => `${companyName(t.company_id)} — ${accountName(t.from_ledger_id)}` },
    { key: 'to', header: 'To', render: (t) => <span className="text-[12.5px]"><span className="text-muted">{code(t.to_company_id)} · </span>{accountName(t.to_ledger_id)}</span>, sort: (t) => accountName(t.to_ledger_id), csv: (t) => `${companyName(t.to_company_id)} — ${accountName(t.to_ledger_id)}` },
    { key: 'amount', header: 'Amount', align: 'right', render: (t) => <Money value={t.amount} currency={ccy(t.company_id)} />, sort: (t) => D(t.amount).toNumber(), csv: (t) => D(t.amount).toFixed(2) },
    { key: 'purpose', header: 'Purpose', render: (t) => <span className="text-ink2">{t.purpose}</span>, sort: (t) => t.purpose.toLowerCase(), csv: (t) => t.purpose },
    { key: 'status', header: 'Status', render: (t) => <span title={TRANSFER_STATUS[t.status].text}><StatusChip status={t.status} label={TRANSFER_STATUS[t.status].label} /></span>, sort: (t) => t.status, csv: (t) => TRANSFER_STATUS[t.status].label },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="NUMERO Flow"
        title="Cash and fund transfers"
        subtitle={<>Cash boxes, cash counts and movements of money between the company's own bank and cash ledgers. NUMERO records that money moved; it never moves money. · {ids.length} compan{ids.length === 1 ? 'y' : 'ies'}</>}
        actions={<>
          <button className="btn" disabled={!mayManage} title={mayManage ? 'Set up a petty cash box or a cash counter' : 'You are not authorised to manage cash boxes'} onClick={() => setBoxForm('new')}><Plus size={15} /> Add cash box</button>
          <button className="btn primary" disabled={!mayTransfer} title={mayTransfer ? 'Record a movement between two bank or cash ledgers' : 'You are not authorised to record fund transfers'} onClick={() => newTransfer(null)}><ArrowRightLeft size={15} /> New transfer</button>
        </>}
      />

      <Tabs<TabKey>
        tabs={[{ key: 'boxes', label: 'Cash boxes', count: boxes.data?.list.length }, { key: 'transfers', label: 'Fund transfers', count: transfers.data?.length }]}
        value={tab} onChange={go}
      />

      {tab === 'boxes' && (
        <>
          {boxes.error && <ErrorBox message={boxes.error} retry={boxes.reload} />}
          {!boxes.error && !boxes.data && <Panel><Loading rows={5} label="Loading cash boxes" /></Panel>}
          {boxes.data?.balanceError && <Note kind="warn" className="mb-4">The book balances could not be read: {boxes.data.balanceError}</Note>}
          {boxes.data && boxes.data.list.length === 0 && (
            <Panel>
              <Empty icon={<Vault size={20} />} title="No cash box is set up"
                body="A cash box is a petty cash float or a cash counter, kept by a named custodian and tied to a cash ledger. Once it is set up, its book balance is shown here and physical counts can be recorded against it."
                action={mayManage ? <button className="btn sm primary" onClick={() => setBoxForm('new')}><Plus size={13} /> Add cash box</button> : undefined} />
            </Panel>
          )}
          {boxes.data && boxes.data.list.length > 0 && (
            <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {boxes.data.list.map((b) => {
                const currency = ccy(b.company_id)
                const balance = boxes.data!.balance.get(b.id)
                const below = !!balance && balance.lt(b.min_balance)
                const need = balance ? D(b.float_amount).minus(balance) : ZERO
                const last = boxes.data!.last.get(b.id)
                const mayCount = can('treasury.manage', b.company_id) || can('expense.approve', b.company_id)
                const mayEdit = can('treasury.manage', b.company_id)
                const mayTopUp = can('payment.create', b.company_id)
                return (
                  <Panel key={b.id} className="flex flex-col p-5" attention={below}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="display truncate text-[16px] font-medium text-ink">{b.name}</div>
                        <div className="mt-0.5 text-[12px] text-muted">{companyName(b.company_id)}</div>
                      </div>
                      <div className="flex flex-none items-center gap-1.5">
                        {!b.is_active && <StatusChip status="inactive" />}
                        <button className="btn ghost icon sm" disabled={!mayEdit} aria-label={`Edit ${b.name}`} title={mayEdit ? 'Edit this cash box' : 'You are not authorised to manage cash boxes of this company'} onClick={() => setBoxForm(b)}><Pencil size={13} /></button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center gap-2"><span className="eyebrow">Book balance today</span><Truth state="ACTUAL" /></div>
                      {balance ? <Money value={balance} currency={currency} className={cx('mt-1 block text-[24px] leading-none', below && 'text-warn')} /> : <div className="mt-1 text-[13px] text-muted">Not available to you</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {below && <span className="chip warn" title={`The book balance is under the minimum of ${fmtMoney(b.min_balance, { currency, mask: privacy })}`}>BELOW MINIMUM</span>}
                        {balance && need.gt(0) && <span className="text-[12px] text-ink2">Top-up to float would need <Money value={need} currency={currency} className="text-ink" /></span>}
                      </div>
                    </div>

                    <div className="mt-4 space-y-1.5 text-[12.5px]">
                      <Line label="Custodian" value={b.custodian_name || (b.custodian_party_id ? partyName(b.custodian_party_id) : '—')} />
                      <Line label="Ledger" value={accountName(b.ledger_account_id)} />
                      {b.org_unit_id && <Line label="Unit" value={unitName(b.org_unit_id)} />}
                      <Line label="Float" value={<Money value={b.float_amount} currency={currency} />} />
                      <Line label="Minimum balance" value={<Money value={b.min_balance} currency={currency} />} />
                      <Line label="Maximum single payment" value={b.max_single_payment == null ? 'No limit set' : <Money value={b.max_single_payment} currency={currency} />} />
                    </div>

                    <div className="hairline my-4" />
                    <div className="text-[12.5px]">
                      <div className="eyebrow mb-1">Last count</div>
                      {last ? (
                        <div className="text-ink2">
                          {fmtDate(last.count_date)} · counted <Money value={last.counted_total} currency={currency} className="text-ink" /> · difference{' '}
                          <Money value={last.difference} currency={currency} sign className={cx(D(last.difference).isZero() ? 'text-pos' : 'text-warn')} />
                          {!D(last.difference).isZero() && <span className="text-muted"> ({D(last.difference).lt(0) ? 'cash short' : 'cash over'})</span>}
                        </div>
                      ) : <div className="text-muted">No count has been recorded for this box.</div>}
                    </div>

                    <div className="no-print mt-4 flex flex-wrap gap-2 pt-1">
                      <button className="btn sm primary" disabled={!mayCount} title={mayCount ? 'Record the cash physically counted in this box' : 'You are not authorised to record cash counts for this company'} onClick={() => setCounting(b)}><Calculator size={13} /> Record a cash count</button>
                      <button className="btn sm" onClick={() => setHistoryOf(b)}><History size={13} /> Count history</button>
                      <button className="btn sm" disabled={!mayTopUp} title={mayTopUp ? 'Record money moved into this box from a bank or another cash ledger' : 'You are not authorised to record fund transfers for this company'}
                        onClick={() => newTransfer({ company_id: b.company_id, to_ledger_id: b.ledger_account_id, amount: need.gt(0) ? need.toDecimalPlaces(2).toString() : '', purpose: `Top-up of ${b.name}`, box: b })}><Coins size={13} /> Top up</button>
                    </div>
                  </Panel>
                )
              })}
            </div>
          )}
          {boxes.data && boxes.data.list.length > 0 && <div className="mt-3 text-[11.5px] text-muted">The book balance is the balance of the cash ledger from posted accounting entries up to {fmtDate(asOf)}. A cash count compares it with the cash physically found; it never changes the books.</div>}
        </>
      )}

      {tab === 'transfers' && (
        <>
          {transfers.error && <ErrorBox message={transfers.error} retry={transfers.reload} />}
          {!transfers.error && !transfers.data && <Panel><Loading rows={6} label="Loading fund transfers" /></Panel>}
          {transfers.data && (
            <Panel lit={false}>
              <DataTable columns={columns} rows={transfers.data} rowKey={(t) => t.id} onRow={setDetail} exportName="fund-transfers"
                toolbar={<span className="text-[12px] text-muted">A fund transfer moves money between the company's own pockets. It is not an expense.</span>}
                empty={{
                  title: 'No fund transfers', icon: <ArrowRightLeft size={20} />,
                  body: 'No transfer between bank and cash ledgers is recorded for the selected companies. Record a transfer after money has moved, for example cash withdrawn from the bank for the petty cash box.',
                  action: mayTransfer ? <button className="btn sm primary" onClick={() => newTransfer(null)}><ArrowRightLeft size={13} /> New transfer</button> : undefined,
                }} />
            </Panel>
          )}
        </>
      )}

      <BoxDrawer target={boxForm} onClose={() => setBoxForm(null)} companyIds={ids} />
      <CountDialog box={counting} onClose={() => setCounting(null)} />
      <TransferDrawer open={transferOpen} seed={seed} onClose={() => setTransferOpen(false)} companyIds={ids} onSaved={() => { setTransferOpen(false); go('transfers') }} />

      <Drawer open={!!historyOf} onClose={() => setHistoryOf(null)} title={historyOf ? `Count history — ${historyOf.name}` : 'Count history'} subtitle={historyOf ? companyName(historyOf.company_id) : undefined} width={860}>
        {historyOf && <CountHistory box={historyOf} currency={ccy(historyOf.company_id)} />}
      </Drawer>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail ? detail.transfer_no : 'Fund transfer'} subtitle={detail ? kindName(detail.kind) : undefined} width={600}>
        {detail && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusChip status={detail.status} label={TRANSFER_STATUS[detail.status].label} />
              <span className="text-[12px] text-muted">{TRANSFER_STATUS[detail.status].text}</span>
            </div>
            <Panel lit={false} className="p-4">
              <div className="flex items-baseline justify-between gap-3"><span className="eyebrow">Amount</span><Money value={detail.amount} currency={ccy(detail.company_id)} className="display text-[22px] text-gold" /></div>
              <div className="mt-3 space-y-1.5 text-[12.5px]">
                <Line label="Date" value={fmtDate(detail.transfer_date)} />
                <Line label="From" value={`${companyName(detail.company_id)} — ${accountName(detail.from_ledger_id)}`} />
                <Line label="To" value={`${companyName(detail.to_company_id)} — ${accountName(detail.to_ledger_id)}`} />
                <Line label="Purpose" value={detail.purpose} />
                <Line label="Reference" value={detail.reference || '—'} />
                <Line label="Recorded" value={fmtDateTime(detail.created_at)} />
              </div>
            </Panel>
            {detail.to_company_id !== detail.company_id && <Note className="mt-4">A transfer between companies creates two entries, one in each company's books, through their intercompany ledgers. Each is approved separately.</Note>}
            <ProposedEntries className="mt-4" companyIds={[...new Set([detail.company_id, detail.to_company_id])]} sourceId={detail.id} sources={['fund_transfer', 'fund_transfer_in']} />
            <div className="mt-4 text-[11.5px] text-muted">A fund transfer moves money between the company's own pockets. It is not an expense, not a budget reallocation and not a cost allocation.</div>
          </>
        )}
      </Drawer>
    </div>
  )
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="flex-none text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-ink2">{value}</span>
    </div>
  )
}

// ------------------------------------------------------------------ count history
function CountHistory({ box, currency }: { box: CashBox; currency: string }) {
  const api = useApp((s) => s.api)!
  const counts = useAsync(() => api.listCashCounts(box.id), [api, box.id])
  const columns: Column<CashCount>[] = [
    { key: 'date', header: 'Date', render: (c) => <span className="num text-[12.5px]">{fmtDate(c.count_date)}</span>, sort: (c) => c.count_date, csv: (c) => c.count_date },
    { key: 'counted', header: 'Counted', align: 'right', render: (c) => <Money value={c.counted_total} currency={currency} />, sort: (c) => D(c.counted_total).toNumber(), csv: (c) => D(c.counted_total).toFixed(2) },
    { key: 'books', header: 'Books', align: 'right', render: (c) => <Money value={c.book_balance} currency={currency} />, sort: (c) => D(c.book_balance).toNumber(), csv: (c) => D(c.book_balance).toFixed(2) },
    { key: 'difference', header: 'Difference', align: 'right', render: (c) => <Money value={c.difference} currency={currency} sign className={cx(D(c.difference).isZero() ? 'text-pos' : 'text-warn')} />, sort: (c) => D(c.difference).toNumber(), csv: (c) => D(c.difference).toFixed(2) },
    {
      key: 'notes', header: 'Notes and coins', csv: (c) => Object.entries(c.denominations ?? {}).map(([d, n]) => `${d} x ${n}`).join('; '),
      render: (c) => { const e = Object.entries(c.denominations ?? {}).filter(([, n]) => Number(n) > 0).sort((x, y) => Number(y[0]) - Number(x[0])); return e.length ? <span className="num text-[11.5px] text-ink2">{e.map(([d, n]) => `${d}×${n}`).join(' · ')}</span> : <span className="text-[11.5px] text-muted">total entered</span> },
    },
    { key: 'witness', header: 'Witness', render: (c) => <span className="text-[12.5px] text-ink2">{c.witness_name || '—'}</span>, sort: (c) => c.witness_name ?? '', csv: (c) => c.witness_name ?? '' },
    { key: 'note', header: 'Note', render: (c) => <span className="text-[12.5px] text-ink2">{c.note || '—'}</span>, csv: (c) => c.note ?? '' },
    { key: 'at', header: 'Recorded', render: (c) => <span className="num text-[11.5px] text-muted">{fmtDateTime(c.created_at)}</span>, sort: (c) => c.created_at, csv: (c) => c.created_at },
  ]
  if (counts.error) return <ErrorBox message={counts.error} retry={counts.reload} />
  if (!counts.data) return <Loading rows={4} label="Loading cash counts" />
  return (
    <>
      <Note className="mb-4">A cash count is a record of what was found. It cannot be edited afterwards, and it does not change the books. A difference is corrected only by an approved journal.</Note>
      <Panel lit={false}>
        <DataTable columns={columns} rows={counts.data} rowKey={(c) => c.id} exportName={`cash-counts-${box.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          empty={{ title: 'No count recorded', body: 'No cash count has been recorded for this box. Record a count to compare the cash physically found with the books.', icon: <Calculator size={20} /> }} />
      </Panel>
    </>
  )
}

// ------------------------------------------------------------------ cash count
interface CountResult { counted_total: string | number; book_balance: string | number; difference: string | number }

function CountDialog({ box, onClose }: { box: CashBox | null; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const currency = useApp((s) => s.companies.find((c) => c.id === box?.company_id)?.base_currency ?? 'INR')
  const { act, busy } = useAction()
  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<'notes' | 'total'>('notes')
  const [pieces, setPieces] = useState<Record<string, string>>({})
  const [total, setTotal] = useState('')
  const [witness, setWitness] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<CountResult | null>(null)
  useEffect(() => { if (box) { setDate(today()); setMode('notes'); setPieces({}); setTotal(''); setWitness(''); setNote(''); setResult(null) } }, [box])

  const running = sum(DENOMINATIONS.map((d) => D(d).times(D(pieces[d] || 0))))
  const entered = DENOMINATIONS.some((d) => D(pieces[d] || 0).gt(0))
  const counted = mode === 'notes' ? running : D(total || 0)
  const problem = !date ? 'Choose the date of the count.'
    : date > today() ? 'The date of the count is in the future.'
    : mode === 'notes' && !entered ? 'Enter the number of notes and coins found. If the box was empty, enter the total directly as 0.'
    : mode === 'total' && total.trim() === '' ? 'Enter the cash counted.'
    : null

  const record = async () => {
    if (!box) return
    const input: CashCountInput = { box_id: box.id, count_date: date, note: note.trim() || undefined, witness_name: witness.trim() || undefined }
    if (mode === 'notes') input.denominations = Object.fromEntries(DENOMINATIONS.filter((d) => D(pieces[d] || 0).gt(0)).map((d) => [d, D(pieces[d]).toNumber()]))
    else input.counted_total = D(total).toDecimalPlaces(2).toString()
    const r = await act(() => api.recordCashCount(input), 'Cash count recorded')
    if (r) setResult(r)
  }
  const diff = D(result?.difference)

  return (
    <Modal open={!!box} onClose={onClose} title={result ? 'Cash count recorded' : 'Record a cash count'} subtitle={box?.name} width={600}
      footer={result ? <button className="btn primary" onClick={onClose}>Close</button> : <>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void record()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Record count</button>
      </>}>
      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="Counted" value={<Money value={result.counted_total} currency={currency} />} />
            <Figure label="Books" value={<Money value={result.book_balance} currency={currency} />} />
            <Figure label="Difference" value={<Money value={result.difference} currency={currency} sign className={diff.isZero() ? 'text-pos' : 'text-warn'} />} sub={diff.isZero() ? 'counted cash agrees with the books' : diff.lt(0) ? 'cash short' : 'cash over'} />
          </div>
          <Note kind={diff.isZero() ? 'good' : 'warn'} className="mt-4">The books have not been changed. A difference is corrected only by an approved journal.{!diff.isZero() && ' The difference has been raised for review.'}</Note>
        </>
      ) : (
        <>
          <Note className="mb-4">Count the cash physically in the box and enter what was found. The count is compared with the balance of the cash ledger on the date of the count.</Note>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of the count"><input type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="How the cash is entered">
              <select className="field" value={mode} onChange={(e) => setMode(e.target.value as 'notes' | 'total')}><option value="notes">By notes and coins</option><option value="total">Total entered directly</option></select>
            </Field>
          </div>

          {mode === 'notes' ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              <table className="table dense">
                <thead><tr><th>Note or coin</th><th className="r" style={{ width: 140 }}>Number found</th><th className="r" style={{ width: 160 }}>Value</th></tr></thead>
                <tbody>
                  {DENOMINATIONS.map((d) => (
                    <tr key={d}>
                      <td className="num">{fmtMoney(d, { currency, decimals: 0 })}</td>
                      <td><input className="field sm num text-right" inputMode="numeric" value={pieces[d] ?? ''} aria-label={`Number of ${d} notes or coins`} onChange={(e) => setPieces((p) => ({ ...p, [d]: e.target.value.replace(/\D/g, '') }))} /></td>
                      <td className="r"><Money value={D(d).times(D(pieces[d] || 0))} currency={currency} dim /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td className="border-t border-line2 px-[14px] py-[10px] font-medium text-ink2" colSpan={2}>Total counted</td><td className="r border-t border-line2 px-[14px] py-[10px]"><Money value={running} currency={currency} className="font-medium text-ink" /></td></tr></tfoot>
              </table>
            </div>
          ) : (
            <Field label={`Cash counted (${currency})`} className="mt-4"><input className="field num" inputMode="decimal" autoFocus value={total} onChange={(e) => setTotal(numeric(e.target.value))} /></Field>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Witness" hint="The person who was present at the count."><input className="field" value={witness} onChange={(e) => setWitness(e.target.value)} /></Field>
            <Field label="Note"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink2"><span>Cash counted</span><Money value={counted} currency={currency} className="text-ink" /></div>
          {problem && (entered || total !== '') && <div className="mt-2 text-[12px] text-warn">{problem}</div>}
        </>
      )}
    </Modal>
  )
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line px-3.5 py-3">
      <div className="eyebrow">{label}</div>
      <div className="display mt-1 text-[18px]">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ cash box
interface BoxForm { company_id: ID; name: string; ledger_account_id: ID | ''; custodian_party_id: ID | ''; custodian_name: string; org_unit_id: ID | ''; float_amount: string; min_balance: string; max_single_payment: string; is_active: boolean }

function BoxDrawer({ target, onClose, companyIds }: { target: CashBox | 'new' | null; onClose: () => void; companyIds: ID[] }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const { act, busy } = useAction()
  const existing = target && target !== 'new' ? target : null
  const blank = (): BoxForm => ({ company_id: companyIds.find((id) => can('treasury.manage', id)) ?? companyIds[0] ?? '', name: '', ledger_account_id: '', custodian_party_id: '', custodian_name: '', org_unit_id: '', float_amount: '', min_balance: '', max_single_payment: '', is_active: true })
  const [f, setF] = useState<BoxForm>(blank)
  useEffect(() => {
    if (!target) return
    setF(existing ? {
      company_id: existing.company_id, name: existing.name, ledger_account_id: existing.ledger_account_id, custodian_party_id: existing.custodian_party_id ?? '', custodian_name: existing.custodian_name ?? '', org_unit_id: existing.org_unit_id ?? '',
      float_amount: text(existing.float_amount), min_balance: text(existing.min_balance), max_single_payment: text(existing.max_single_payment), is_active: existing.is_active,
    } : blank())
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const choices = companies.filter((c) => c.status === 'active' && (companyIds.includes(c.id) || c.id === f.company_id))
  const company = companies.find((c) => c.id === f.company_id)
  const ledgers = accounts.filter((a) => a.company_id === f.company_id && !a.is_group && a.control_type === 'cash' && (a.is_active || a.id === f.ledger_account_id)).sort((a, b) => a.code.localeCompare(b.code))
  const people = parties.filter((p) => p.kind === 'person' && (p.roles.some((r) => r.company_id === f.company_id) || p.id === f.custodian_party_id)).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const units = orgUnits.filter((u) => u.company_id === f.company_id && (u.status === 'active' || u.id === f.org_unit_id)).sort((a, b) => a.name.localeCompare(b.name))
  const allowed = can('treasury.manage', f.company_id || undefined)
  const problem = !f.company_id ? 'Choose the company.'
    : !f.name.trim() ? 'Give the cash box a name.'
    : !f.ledger_account_id ? 'Choose the cash ledger of this box.'
    : f.min_balance !== '' && f.float_amount !== '' && D(f.min_balance).gt(f.float_amount) ? 'The minimum balance is above the float.'
    : null
  const set = (patch: Partial<BoxForm>) => setF((x) => ({ ...x, ...patch }))

  const save = async () => {
    const input: CashBoxInput = {
      id: existing?.id, company_id: f.company_id, name: f.name.trim(), ledger_account_id: f.ledger_account_id as ID, custodian_party_id: f.custodian_party_id || null, custodian_name: f.custodian_name.trim() || null, org_unit_id: f.org_unit_id || null,
      float_amount: D(f.float_amount).toDecimalPlaces(2).toString(), min_balance: D(f.min_balance).toDecimalPlaces(2).toString(), max_single_payment: f.max_single_payment.trim() === '' ? null : D(f.max_single_payment).toDecimalPlaces(2).toString(), is_active: f.is_active,
    }
    const id = await act(() => api.saveCashBox(input), existing ? 'Cash box updated' : 'Cash box added')
    if (id) onClose()
  }

  return (
    <Drawer open={!!target} onClose={onClose} title={existing ? `Edit ${existing.name}` : 'Add cash box'} subtitle="A petty cash float or cash counter tied to a cash ledger"
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !!problem || !allowed} title={allowed ? problem ?? undefined : 'You are not authorised to manage cash boxes of this company'} onClick={() => void save()}>{busy ? <Spinner /> : <Save size={15} />} Save</button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2">
          <select className="field" value={f.company_id} disabled={!!existing} onChange={(e) => set({ company_id: e.target.value, ledger_account_id: '', custodian_party_id: '', org_unit_id: '' })}>
            <option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Name"><input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Head office petty cash" /></Field>
        <Field label="Cash ledger" hint={ledgers.length ? 'The book balance of the box is the balance of this ledger.' : 'This company has no cash ledger. Add one under Chart of Accounts first.'}>
          <select className="field" value={f.ledger_account_id} onChange={(e) => set({ ledger_account_id: e.target.value })}><option value="">Choose…</option>{ledgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        </Field>
        <Field label="Custodian" hint="The person who keeps the cash and answers for it.">
          <select className="field" value={f.custodian_party_id} onChange={(e) => set({ custodian_party_id: e.target.value })}><option value="">Not in the party register</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
        </Field>
        <Field label="Custodian name" hint="Used when the custodian is not in the party register, or to show a different name."><input className="field" value={f.custodian_name} onChange={(e) => set({ custodian_name: e.target.value })} /></Field>
        <Field label="Department, office or site" className="sm:col-span-2">
          <select className="field" value={f.org_unit_id} onChange={(e) => set({ org_unit_id: e.target.value })}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.type_key.replace(/_/g, ' ')}</option>)}</select>
        </Field>
        <Field label={`Float${company ? ` (${company.base_currency})` : ''}`} hint="The amount the box is topped up to."><input className="field num" inputMode="decimal" value={f.float_amount} onChange={(e) => set({ float_amount: numeric(e.target.value) })} /></Field>
        <Field label={`Minimum balance${company ? ` (${company.base_currency})` : ''}`} hint="The box is marked BELOW MINIMUM when the books fall under this."><input className="field num" inputMode="decimal" value={f.min_balance} onChange={(e) => set({ min_balance: numeric(e.target.value) })} /></Field>
        <Field label={`Maximum single payment${company ? ` (${company.base_currency})` : ''}`} hint="Leave empty for no limit."><input className="field num" inputMode="decimal" value={f.max_single_payment} onChange={(e) => set({ max_single_payment: numeric(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink2"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active</label>
      </div>
      {problem && f.name && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Drawer>
  )
}

// ------------------------------------------------------------------ fund transfer
interface TransferForm { company_id: ID; from_ledger_id: ID | ''; to_company_id: ID; to_ledger_id: ID | ''; amount: string; date: string; purpose: string; reference: string }

function TransferDrawer({ open, seed, onClose, onSaved, companyIds }: { open: boolean; seed: TransferSeed | null; onClose: () => void; onSaved: () => void; companyIds: ID[] }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const start = (): TransferForm => {
    const company = seed?.company_id ?? companyIds.find((id) => can('payment.create', id)) ?? companyIds[0] ?? ''
    return { company_id: company, from_ledger_id: '', to_company_id: company, to_ledger_id: seed?.to_ledger_id ?? '', amount: seed?.amount ?? '', date: today(), purpose: seed?.purpose ?? '', reference: '' }
  }
  const [f, setF] = useState<TransferForm>(start)
  useEffect(() => { if (open) setF(start()) }, [open, seed]) // eslint-disable-line react-hooks/exhaustive-deps

  const money = useMemo(() => accounts.filter((a) => !a.is_group && a.is_active && (a.control_type === 'bank' || a.control_type === 'cash')).sort((a, b) => a.code.localeCompare(b.code)), [accounts])
  const fromChoices = companies.filter((c) => c.status === 'active' && (companyIds.includes(c.id) || c.id === f.company_id))
  const toChoices = companies.filter((c) => c.status === 'active')
  const fromLedgers = money.filter((a) => a.company_id === f.company_id)
  const toLedgers = money.filter((a) => a.company_id === f.to_company_id && a.id !== f.from_ledger_id)
  const from = companies.find((c) => c.id === f.company_id), to = companies.find((c) => c.id === f.to_company_id)
  const between = !!f.company_id && !!f.to_company_id && f.company_id !== f.to_company_id
  const topUp = !!seed && !between && f.to_ledger_id === seed.to_ledger_id
  const allowed = can('payment.create', f.company_id || undefined) && (!between || can('payment.create', f.to_company_id))
  const problem = !f.company_id ? 'Choose the company the money leaves from.'
    : !f.from_ledger_id ? 'Choose the bank or cash ledger the money leaves from.'
    : !f.to_company_id ? 'Choose the company the money arrives in.'
    : !f.to_ledger_id ? 'Choose the bank or cash ledger the money arrives in.'
    : f.from_ledger_id === f.to_ledger_id ? 'The source and the destination are the same ledger.'
    : D(f.amount).lte(0) ? 'Enter the amount.'
    : !f.date ? 'Choose the date of the transfer.'
    : f.date > today() ? 'The date is in the future. Record a transfer after the money has moved.'
    : !f.purpose.trim() ? 'State the purpose of the transfer.'
    : between && from && to && from.base_currency !== to.base_currency ? `The two companies keep their books in different currencies (${from.base_currency} and ${to.base_currency}).`
    : null
  const set = (patch: Partial<TransferForm>) => setF((x) => ({ ...x, ...patch }))

  const save = async () => {
    const input: FundTransferInput = {
      company_id: f.company_id, to_company_id: f.to_company_id, from_ledger_id: f.from_ledger_id as ID, to_ledger_id: f.to_ledger_id as ID, amount: D(f.amount).toDecimalPlaces(2).toString(),
      transfer_date: f.date, purpose: f.purpose.trim(), reference: f.reference.trim() || undefined, kind: topUp ? 'petty_cash_topup' : undefined,
    }
    const id = await act(() => api.proposeFundTransfer(input), between ? 'Transfer recorded. Its two entries wait in the approval inbox.' : 'Transfer recorded. Its entry waits in the approval inbox.')
    if (id) onSaved()
  }

  return (
    <Drawer open={open} onClose={onClose} title={seed ? `Top up ${seed.box.name}` : 'New transfer'} subtitle="Money moved between the company's own bank and cash ledgers" width={620}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !!problem || !allowed} title={allowed ? problem ?? undefined : between ? 'You need the authority to record payments in both companies' : 'You are not authorised to record fund transfers for this company'} onClick={() => void save()}>{busy ? <Spinner /> : <BadgeCheck size={15} />} Record transfer</button>
      </>}>
      <ProposedNote />
      <Note className="mb-4">A fund transfer moves money between the company's own pockets. It is not an expense, not a budget reallocation and not a cost allocation.</Note>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From company">
          <select className="field" value={f.company_id} onChange={(e) => setF((x) => ({ ...x, company_id: e.target.value, from_ledger_id: '', to_company_id: x.to_company_id === x.company_id ? e.target.value : x.to_company_id, to_ledger_id: x.to_company_id === x.company_id ? '' : x.to_ledger_id }))}>
            <option value="">Choose…</option>{fromChoices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="From ledger" hint={f.company_id && !fromLedgers.length ? 'This company has no bank or cash ledger.' : undefined}>
          <select className="field" value={f.from_ledger_id} onChange={(e) => set({ from_ledger_id: e.target.value, to_ledger_id: e.target.value === f.to_ledger_id ? '' : f.to_ledger_id })}>
            <option value="">Choose…</option>{fromLedgers.filter((a) => a.id !== f.to_ledger_id).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} ({a.control_type})</option>)}
          </select>
        </Field>
        <Field label="To company">
          <select className="field" value={f.to_company_id} onChange={(e) => set({ to_company_id: e.target.value, to_ledger_id: '' })}>
            <option value="">Choose…</option>{toChoices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.id === f.company_id ? ' (same company)' : ''}</option>)}
          </select>
        </Field>
        <Field label="To ledger" hint={f.to_company_id && !toLedgers.length ? 'No other bank or cash ledger is available in this company.' : undefined}>
          <select className="field" value={f.to_ledger_id} onChange={(e) => set({ to_ledger_id: e.target.value })}>
            <option value="">Choose…</option>{toLedgers.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} ({a.control_type})</option>)}
          </select>
        </Field>
      </div>
      {between && <Note kind="warn" className="mt-4">A transfer between companies creates two entries, one in each company's books, through their intercompany ledgers. Each is approved separately.</Note>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={`Amount${from ? ` (${from.base_currency})` : ''}`}><input className="field num" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: numeric(e.target.value) })} /></Field>
        <Field label="Date the money moved"><input type="date" className="field" value={f.date} max={today()} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Purpose (required)" className="sm:col-span-2"><input className="field" value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="Why was the money moved?" /></Field>
        <Field label="Reference" className="sm:col-span-2" hint="UTR, cheque number or cash voucher number"><input className="field" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
      </div>
      {topUp && <div className="mt-3 text-[12px] text-muted">This transfer is recorded as a petty cash top-up of {seed!.box.name}.</div>}
      {problem && (f.amount || f.purpose || f.from_ledger_id) && <div className="mt-3 text-[12px] text-warn">{problem}</div>}
    </Drawer>
  )
}
