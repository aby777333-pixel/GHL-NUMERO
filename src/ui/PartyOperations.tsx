import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { can, useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import type { ID, Party } from '@/engine/types'
import type { Advance, ExpenseClaim, Loan, PurchaseDoc, RegisterItem } from '@/engine/opsTypes'
import { advanceMemory, advanceOutstanding } from '@/engine/ops'
import { sum } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { ErrorBox, Loading, Money, Note, Panel, StatusChip } from './kit'
import { Attachments, CustomFields } from './ops'
import { Promises } from './records'

const KIND: Record<string, string> = { requisition: 'Requisition', rfq: 'Request for quotation', quotation: 'Quotation', purchase_order: 'Purchase order', goods_receipt: 'Goods receipt', service_receipt: 'Service receipt' }

/** Each list is read only when the viewer holds the permission for it; a refusal never hides the rest. */
const safe = <T,>(allowed: boolean, load: () => Promise<T[]>) => (allowed ? load().catch(() => [] as T[]) : Promise.resolve([] as T[]))

function List<T>({ title, rows, empty, render }: { title: string; rows: T[]; empty: string; render: (r: T) => { key: string; to: string; left: ReactNode; sub: ReactNode; right: ReactNode } }) {
  const nav = useNavigate()
  return (
    <section>
      <div className="eyebrow mb-2.5">{title} <span className="num text-muted">· {rows.length}</span></div>
      <Panel className="p-1.5" lit={false}>
        {!rows.length ? <div className="px-3 py-3 text-[12.5px] text-muted">{empty}</div> : rows.map((r) => {
          const v = render(r)
          return (
            <button key={v.key} className="flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2" onClick={() => nav(v.to)}>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-ink">{v.left}</span>
                <span className="block truncate text-[11.5px] text-muted">{v.sub}</span>
              </span>
              <span className="flex flex-none items-center gap-2 text-[12.5px]">{v.right}</span>
            </button>
          )
        })}
      </Panel>
    </section>
  )
}

/** Everything operational that involves one party, in the companies currently selected. */
export function PartyOperations({ party, companyIds }: { party: Party; companyIds: ID[] }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const key = companyIds.join(',')
  const seeExpenses = can('expense.view') || can('expense.approve') || can('expense.create'), seePurchases = can('purchase.view') || can('purchase.create'), seeTreasury = can('treasury.view'), seeRegisters = can('register.view')

  const data = useAsync(async () => {
    const [advances, claims, purchases, loans, items] = await Promise.all([
      safe<Advance>(seeExpenses, () => api.listAdvances({ companyIds, partyId: party.id })),
      safe<ExpenseClaim>(seeExpenses, () => api.listClaims({ companyIds, partyId: party.id })),
      safe<PurchaseDoc>(seePurchases, () => api.listPurchaseDocs({ companyIds, partyId: party.id })),
      safe<Loan>(seeTreasury, async () => (await api.listLoans(companyIds)).filter((l) => l.party_id === party.id)),
      safe<RegisterItem>(seeRegisters, async () => (await api.listRegisterItems({ companyIds })).filter((r) => r.party_id === party.id)),
    ])
    return { advances, claims, purchases, loans, items }
  }, [api, key, party.id])

  if (data.error) return <ErrorBox message={data.error} retry={data.reload} />
  if (!data.data) return <Panel><Loading rows={5} label="Loading operations" /></Panel>
  const d = data.data
  const held = sum(d.advances.map((a) => advanceOutstanding(a)))
  const memory = d.advances.length ? advanceMemory(d.advances, d.claims, party.id, today()) : []
  const roleCompanies = [...new Set(party.roles.map((r) => r.company_id))].filter((c) => companyIds.includes(c))
  const customerOf = [...new Set(party.roles.filter((r) => /customer|client|tenant|debtor/i.test(r.type_key)).map((r) => r.company_id))].filter((c) => companyIds.includes(c))
  const home = roleCompanies[0]
  const name = (cid: ID) => companies.find((c) => c.id === cid)?.name ?? 'Company'
  const hidden = [!seeExpenses && 'advances and claims', !seePurchases && 'purchasing', !seeTreasury && 'loans', !seeRegisters && 'registers'].filter(Boolean)

  return (
    <div className="space-y-5">
      {hidden.length > 0 && <Note>Your role does not include access to {hidden.join(', ')}. Those records are not shown here; they exist whether or not you can see them.</Note>}

      {held.gt(0) && (
        <Note kind="warn">
          <strong className="text-ink">{party.display_name} holds <Money value={held} className="text-ink" /> in unsettled advances.</strong> An advance is money held by a person, not an expense.
          {memory.filter((m) => m.kind !== 'open_advance').map((m, i) => <span key={i} className="mt-1 block">{m.text}</span>)}
        </Note>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {seeExpenses && <List title="Advances" rows={d.advances} empty="No advance is recorded for this party."
          render={(a) => ({ key: a.id, to: '/expenses/advances/' + a.id, left: <><span className="num text-gold">{a.advance_no}</span> · {a.purpose}</>, sub: <>Released <Money value={a.released_amount} currency={a.currency} /> · unsettled <Money value={advanceOutstanding(a)} currency={a.currency} />{a.expected_settlement_date ? <> · settle by {fmtDate(a.expected_settlement_date)}</> : null}</>, right: <StatusChip status={a.status} /> })} />}
        {seeExpenses && <List title="Expense claims" rows={d.claims} empty="No expense claim is recorded for this party."
          render={(c) => ({ key: c.id, to: '/expenses/claims/' + c.id, left: <><span className="num text-gold">{c.claim_no}</span> · {c.title}</>, sub: <>{fmtDate(c.created_at.slice(0, 10))}{c.flagged_lines ? <> · {c.flagged_lines} flagged line{c.flagged_lines === 1 ? '' : 's'}</> : null}</>, right: <><Money value={c.total} currency={c.currency} /><StatusChip status={c.status} /></> })} />}
        {seePurchases && <List title="Purchasing" rows={d.purchases} empty="No purchasing document is recorded for this party."
          render={(p) => ({ key: p.id, to: '/purchasing/' + p.id, left: <><span className="num text-gold">{p.doc_no}</span> · {p.title ?? KIND[p.kind]}</>, sub: <>{KIND[p.kind]} · {fmtDate(p.doc_date)}</>, right: <><Money value={p.total} currency={p.currency} /><StatusChip status={p.status} /></> })} />}
        {seeTreasury && <List title="Loans" rows={d.loans} empty="No loan is recorded with this party."
          render={(l) => ({ key: l.id, to: '/treasury/loans/' + l.id, left: <><span className="num text-gold">{l.loan_no}</span> · {l.name}</>, sub: <>{l.direction === 'borrowed' ? 'Loan taken' : 'Loan given'} · {String(l.rate_pct)}% · {l.tenure_months} months</>, right: <><Money value={l.principal} currency={l.currency} /><StatusChip status={l.status} /></> })} />}
        {seeRegisters && <List title="Contracts, obligations and other register items" rows={d.items} empty="No register item names this party."
          render={(r) => ({ key: r.id, to: '/registers/' + r.id, left: <><span className="num text-gold">{r.ref_no}</span> · {r.title}</>, sub: <>{r.kind.replace(/_/g, ' ')}{r.next_due ? <> · next due {fmtDate(r.next_due)}</> : null}</>, right: <>{r.amount != null && <Money value={r.amount} currency={r.currency} />}<StatusChip status={r.status} /></> })} />}
      </div>

      {customerOf.map((cid) => (
        <Promises key={cid} companyId={cid} partyId={party.id} />
      ))}
      {customerOf.length > 1 && <div className="text-[11.5px] text-muted">Promises are kept per company: {customerOf.map(name).join(', ')}.</div>}

      {home && <CustomFields companyId={home} entity="party" entityId={party.id} scopeKey={[...new Set(party.roles.filter((r) => companyIds.includes(r.company_id)).map((r) => r.type_key))]} readOnly={!can('party.edit', home)} />}

      {home && <Attachments companyId={home} entity="parties" entityId={party.id} title={`Documents held for this party${roleCompanies.length > 1 ? ` (${name(home)})` : ''}`} />}
    </div>
  )
}
