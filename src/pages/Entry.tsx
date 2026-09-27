import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Building, CircleHelp, Coins, FileInput, FileOutput, HandCoins, Landmark, PenLine, PiggyBank, Receipt, RotateCcw,
  Send, ShieldCheck, Sparkles, UserRound, Wallet, Wand2,
} from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Account, ID, JournalInput } from '@/engine/types'
import { parseTransaction, proposeJournal } from '@/engine/nlp'
import { D, parseAmount } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import { cx, Field, Modal, Money, Note, PageHeader, Panel, Section, Spinner } from '@/ui/kit'

interface Kind {
  key: string; label: string; icon: ReactNode; hint: string; voucher: string
  debit?: (a: Account) => boolean; credit?: (a: Account) => boolean
  debitLabel?: string; creditLabel?: string; party?: 'debit' | 'credit'; to?: string
}
const isBank = (a: Account) => a.control_type === 'bank' || a.control_type === 'cash'
const sub = (...s: string[]) => (a: Account) => s.includes(a.subtype)
const KINDS: Kind[] = [
  { key: 'expense', label: 'Expense', icon: <ArrowUpRight size={16} />, voucher: 'payment', hint: 'Money spent on running the business.', debit: (a) => a.type === 'expense', credit: isBank, debitLabel: 'What was it for?', creditLabel: 'Paid from', party: 'debit' },
  { key: 'income', label: 'Income', icon: <ArrowDownLeft size={16} />, voucher: 'receipt', hint: 'Money earned and received directly.', debit: isBank, credit: (a) => a.type === 'income', debitLabel: 'Received into', creditLabel: 'What was it for?', party: 'credit' },
  { key: 'sale', label: 'Sale', icon: <FileOutput size={16} />, voucher: 'sales', hint: 'Raise an invoice to a customer.', to: '/invoices/new' },
  { key: 'purchase', label: 'Purchase', icon: <FileInput size={16} />, voucher: 'purchase', hint: 'Record a supplier bill.', to: '/bills/new' },
  { key: 'receipt', label: 'Receipt', icon: <HandCoins size={16} />, voucher: 'receipt', hint: 'A customer paid an invoice.', to: '/payments?new=in' },
  { key: 'payment', label: 'Payment', icon: <Banknote size={16} />, voucher: 'payment', hint: 'Pay a supplier bill.', to: '/payments?new=out' },
  { key: 'transfer', label: 'Transfer', icon: <ArrowLeftRight size={16} />, voucher: 'contra', hint: 'Move money between your own bank and cash accounts.', debit: isBank, credit: isBank, debitLabel: 'Into', creditLabel: 'Out of' },
  { key: 'advance', label: 'Advance', icon: <Wallet size={16} />, voucher: 'payment', hint: 'An advance is not an expense: it stays recoverable until settled.', debit: sub('advance'), credit: isBank, debitLabel: 'Advance account', creditLabel: 'Paid from', party: 'debit' },
  { key: 'deposit', label: 'Deposit paid', icon: <ShieldCheck size={16} />, voucher: 'payment', hint: 'A refundable deposit is an asset, never an expense.', debit: sub('deposit'), credit: isBank, debitLabel: 'Deposit account', creditLabel: 'Paid from', party: 'debit' },
  { key: 'reimbursement', label: 'Reimbursement', icon: <UserRound size={16} />, voucher: 'expense', hint: 'An employee spent their own money: the expense is recognised and the employee becomes payable.', debit: (a) => a.type === 'expense', credit: sub('employee_payable'), debitLabel: 'What was it for?', creditLabel: 'Owed through', party: 'credit' },
  { key: 'refund', label: 'Refund received', icon: <RotateCcw size={16} />, voucher: 'receipt', hint: 'Money returned to you; it reduces the original cost.', debit: isBank, credit: (a) => a.type === 'expense' || a.subtype === 'advance' || a.subtype === 'deposit', debitLabel: 'Received into', creditLabel: 'Original account refunded', party: 'credit' },
  { key: 'loan_in', label: 'Loan received', icon: <Landmark size={16} />, voucher: 'receipt', hint: 'Borrowed money is a liability, not income.', debit: isBank, credit: sub('loan', 'short_term_borrowing'), debitLabel: 'Received into', creditLabel: 'Loan account', party: 'credit' },
  { key: 'loan_out', label: 'Loan repayment', icon: <Landmark size={16} />, voucher: 'payment', hint: 'Principal repaid. Record interest separately as a finance cost.', debit: sub('loan', 'short_term_borrowing'), credit: isBank, debitLabel: 'Loan account', creditLabel: 'Paid from', party: 'debit' },
  { key: 'investment', label: 'Investment', icon: <PiggyBank size={16} />, voucher: 'payment', hint: 'Money placed in an investment or deposit.', debit: sub('investment'), credit: isBank, debitLabel: 'Investment account', creditLabel: 'Paid from' },
  { key: 'capital', label: 'Capital contribution', icon: <Coins size={16} />, voucher: 'receipt', hint: 'Money introduced by the owners.', debit: isBank, credit: sub('capital', 'reserves'), debitLabel: 'Received into', creditLabel: 'Capital account', party: 'credit' },
  { key: 'withdrawal', label: 'Withdrawal', icon: <ArrowUpRight size={16} />, voucher: 'payment', hint: 'Money taken out by the owners. Kept separate from company expenses.', debit: (a) => a.type === 'equity', credit: isBank, debitLabel: 'Equity account', creditLabel: 'Paid from', party: 'debit' },
  { key: 'asset', label: 'Asset purchase', icon: <Building size={16} />, voucher: 'payment', hint: 'A long-lived asset is capitalised, then depreciated over its life.', debit: sub('fixed_asset'), credit: (a) => isBank(a) || a.subtype === 'payable', debitLabel: 'Asset account', creditLabel: 'Paid from / owed to', party: 'credit' },
  { key: 'liability', label: 'Liability', icon: <Receipt size={16} />, voucher: 'accrual', hint: 'A cost incurred but not yet billed or paid.', debit: (a) => a.type === 'expense', credit: sub('accrued', 'provision', 'other_liability'), debitLabel: 'What was incurred?', creditLabel: 'Liability account' },
  { key: 'intercompany', label: 'Intercompany', icon: <ArrowLeftRight size={16} />, voucher: 'intercompany', hint: 'Money moved to another group company. Record the mirror entry in that company too.', debit: (a) => a.control_type === 'intercompany' && a.type === 'asset', credit: isBank, debitLabel: 'Due from which company?', creditLabel: 'Paid from' },
  { key: 'unknown', label: 'I don\'t know what this is', icon: <CircleHelp size={16} />, voucher: 'journal', hint: 'Park it under "Needs classification" so Finance can investigate. It will stay visible until it is resolved.', debit: (a) => isBank(a) || a.subtype === 'suspense', credit: (a) => isBank(a) || a.subtype === 'suspense', debitLabel: 'Debit (money came into / or suspense)', creditLabel: 'Credit (money left / or suspense)' },
  { key: 'adjustment', label: 'Adjustment', icon: <PenLine size={16} />, voucher: 'adjustment', hint: 'Open the full journal screen.', to: '/journals/new' },
]

export default function Entry() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const ids = useScopeIds()
  const { act, busy } = useAction()
  const [text, setText] = useState(sp.get('text') ?? '')
  const [submitted, setSubmitted] = useState(sp.get('text') ?? '')
  const [ov, setOv] = useState<{ companyId?: ID; accountId?: ID; bankId?: ID; partyId?: ID | null; amount?: string; date?: string; kind?: 'outflow' | 'inflow' }>({})
  const [kind, setKind] = useState<Kind | null>(null)

  useEffect(() => { const t = sp.get('text'); if (t) { setText(t); setSubmitted(t); setOv({}) } }, [sp])
  const rules = useAsync(() => api.listNumiRules(companies.map((c) => c.id)), [api, companies.length])

  const parsed = useMemo(() => {
    if (!submitted.trim()) return null
    return parseTransaction(submitted, { companies: companies.filter((c) => c.status === 'active'), defaultCompanyId: ov.companyId ?? (ids.length === 1 ? ids[0] : undefined), accounts, parties, orgUnits, rules: rules.data ?? [] })
  }, [submitted, companies, accounts, parties, orgUnits, rules.data, ids, ov.companyId])

  const eff = parsed ? { ...parsed, amount: ov.amount !== undefined ? parseAmount(ov.amount) : parsed.amount, date: ov.date ?? parsed.date, kind: ov.kind ?? parsed.kind } : null
  const companyId = eff?.company?.id
  const accs = accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active)
  const proposal: JournalInput | null = eff ? proposeJournal(eff, { accountId: ov.accountId, bankId: ov.bankId, partyId: ov.partyId }) : null
  const accName = (id: ID) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} · ${a.name}` : '—' }
  const chosenAccount = ov.accountId ?? eff?.account?.item.id
  const open = eff ? eff.questions.filter((qn) => {
    if (/amount/i.test(qn)) return !eff.amount
    if (/Which company|belong to/i.test(qn)) return !eff.company
    if (/going out|coming in/i.test(qn)) return eff.kind === 'unknown'
    if (/bank or cash|Which account/i.test(qn)) return !(ov.bankId ?? eff.bank)
    if (/ledger should/i.test(qn)) return !chosenAccount
    if (/^Which /.test(qn) && /records match/.test(qn)) return ov.partyId === undefined
    return true
  }) : []

  const save = async (submit: boolean) => {
    if (!proposal || !eff) return
    const id = await act(async () => {
      const jid = await api.saveJournalDraft(proposal)
      // NUMI learns only from classifications a person has approved
      const acc = accounts.find((a) => a.id === chosenAccount)
      const partyId = ov.partyId === undefined ? eff.party?.id ?? null : ov.partyId
      const pattern = partyId ? parties.find((p) => p.id === partyId)?.display_name.toLowerCase() : acc?.name.toLowerCase().split(' ')[0]
      if (acc && pattern) await api.numiLearn(proposal.company_id, pattern, partyId, acc.id).catch(() => undefined)
      if (submit) await api.submitJournal(jid)
      return jid
    }, submit ? 'Draft created and submitted for approval' : 'Draft created — nothing has been posted')
    if (id) nav('/journals/' + id)
  }

  return (
    <div>
      <PageHeader eyebrow="Transaction Command Centre" title="Record a transaction"
        subtitle="Describe what happened in your own words, or choose a transaction type. NUMERO proposes the accounting treatment; a person confirms it; an approver releases it." />

      <Panel className="mb-5 p-5" hud>
        <form onSubmit={(e) => { e.preventDefault(); setOv({}); setSubmitted(text) }}>
          <div className="mb-2 flex items-center gap-2 text-gold"><Wand2 size={16} /><span className="eyebrow">Describe it</span></div>
          <textarea className="field text-[15px]" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Describe the transaction"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setOv({}); setSubmitted(text) } }}
            placeholder="Paid ₹45,000 to ABC Consultants from HDFC for legal fees for Project Monarch" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {['Paid ₹45,000 to ABC Consultants from HDFC for legal fees for Project Monarch for Jamin Bazaar', 'Paid 85,000 for Facebook and Google advertising for Jamin Bazaar from HDFC', 'Received ₹1,25,000 from Rajesh for Jamin Bazaar'].map((x) => (
                <button type="button" key={x} className="max-w-[340px] truncate rounded-full border border-line bg-surface px-3 py-1 text-[11.5px] text-ink2 hover:border-gold/40 hover:text-ink" onClick={() => { setText(x); setOv({}); setSubmitted(x) }}>{x}</button>
              ))}
            </div>
            <button className="btn primary" disabled={!text.trim()}><Sparkles size={15} /> Propose the entry</button>
          </div>
        </form>
      </Panel>

      {eff && (
        <div className="mb-6 grid gap-4 xl:grid-cols-[1fr_1.15fr] fade-up">
          <Panel className="p-5" lit={false}>
            <div className="mb-3 flex items-center justify-between"><div className="eyebrow">What NUMI understood</div><span className="chip violet">AI ESTIMATE — confirm before use</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company">
                <select className="field sm" value={companyId ?? ''} onChange={(e) => setOv({ companyId: e.target.value })}>
                  <option value="">Choose…</option>{companies.filter((c) => c.status === 'active' && can('journal.create', c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Direction">
                <select className="field sm" value={eff.kind} onChange={(e) => setOv({ ...ov, kind: e.target.value as 'outflow' | 'inflow' })}>
                  {eff.kind === 'unknown' && <option value="unknown">Choose…</option>}{eff.kind === 'transfer' && <option value="transfer">Transfer — use the Transfer form below</option>}
                  <option value="outflow">Money went out</option><option value="inflow">Money came in</option>
                </select>
              </Field>
              <Field label="Amount"><input className="field sm num" value={ov.amount ?? (eff.amount ? eff.amount.toString() : '')} onChange={(e) => setOv({ ...ov, amount: e.target.value })} placeholder="Not stated" /></Field>
              <Field label="Date"><input type="date" className="field sm" value={eff.date} max={today()} onChange={(e) => setOv({ ...ov, date: e.target.value })} /></Field>
              <Field label={eff.kind === 'inflow' ? 'Received into' : 'Paid from'}>
                <select className="field sm" value={ov.bankId ?? eff.bank?.id ?? ''} onChange={(e) => setOv({ ...ov, bankId: e.target.value })}>
                  <option value="">Choose…</option>{accs.filter(isBank).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Party">
                <select className="field sm" value={ov.partyId === undefined ? eff.party?.id ?? '' : ov.partyId ?? ''} onChange={(e) => setOv({ ...ov, partyId: e.target.value || null })}>
                  <option value="">No party</option>
                  {(eff.partyCandidates.length > 1 ? eff.partyCandidates : parties.filter((p) => p.roles.some((r) => r.company_id === companyId))).map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
                </select>
              </Field>
              <Field label="Classified under" className="sm:col-span-2" hint={eff.account && (ov.accountId ?? eff.account.item.id) === eff.account.item.id ? `Reason: ${eff.account.reason}.` : undefined}>
                <select className="field sm" value={chosenAccount ?? ''} onChange={(e) => setOv({ ...ov, accountId: e.target.value })}>
                  <option value="">Choose a ledger…</option>
                  {[eff.account, ...eff.accountAlternatives].filter(Boolean).length > 0 && <optgroup label="SUGGESTED">{[eff.account, ...eff.accountAlternatives].filter(Boolean).map((s) => <option key={'s' + s!.item.id} value={s!.item.id}>{s!.item.code} · {s!.item.name} — {s!.confidence}</option>)}</optgroup>}
                  <optgroup label="ALL">{accs.filter((a) => a.type === (eff.kind === 'inflow' ? 'income' : 'expense')).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
                </select>
              </Field>
            </div>
            {eff.dims.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{eff.dims.map((d) => <span key={d.unit.id} className="chip cyan" title={d.reason}>{d.unit.type_key.replace(/_/g, ' ')}: {d.unit.name}</span>)}</div>}
            {eff.facts.length > 0 && <ul className="mb-0 mt-4 list-none space-y-1 p-0 text-[12px] text-muted">{eff.facts.map((f) => <li key={f} className="flex gap-2"><span className="text-pos">•</span>{f}</li>)}</ul>}
          </Panel>

          <Panel className="p-5" lit={false} attention={open.length > 0}>
            <div className="mb-3 flex items-center justify-between"><div className="eyebrow">Proposed double entry</div>{proposal && <span className="chip pos">balanced</span>}</div>
            {open.length > 0 && (
              <Note kind="warn" className="mb-3">
                <b className="text-ink">NUMI needs you to decide — it will not guess:</b>
                <ul className="mb-0 mt-1 list-disc pl-4">{open.map((o) => <li key={o}>{o}</li>)}</ul>
              </Note>
            )}
            {proposal ? (
              <>
                <table className="table dense">
                  <thead><tr><th>Ledger</th><th>Party</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                  <tbody>
                    {proposal.lines.map((l, i) => (
                      <tr key={i}><td>{accName(l.account_id)}</td><td className="text-ink2">{l.party_id ? parties.find((p) => p.id === l.party_id)?.display_name : '—'}</td>
                        <td className="r">{D(l.debit).gt(0) && <Money value={l.debit} />}</td><td className="r">{D(l.credit).gt(0) && <Money value={l.credit} />}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 text-[12px] text-muted">{eff.company?.name} · {fmtDate(eff.date)} · recorded as “proposed by NUMI, approved by a person”.</div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button className="btn" disabled={busy} onClick={() => void save(false)}>{busy ? <Spinner /> : <PenLine size={15} />} Save as draft</button>
                  <button className="btn primary" disabled={busy || !can('journal.submit', companyId)} onClick={() => void save(true)}>{busy ? <Spinner /> : <Send size={15} />} Confirm and submit for approval</button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-[13px] text-muted">{eff.kind === 'transfer' ? 'This looks like a transfer between your own accounts. Use the Transfer form below.' : 'The entry will appear here once the open points are resolved.'}</div>
            )}
          </Panel>
        </div>
      )}

      <Section title="Or choose what kind of transaction it is">
        <div className="stagger grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {KINDS.map((k) => (
            <Panel key={k.key} className="p-3.5" onClick={() => (k.to ? nav(k.to) : setKind(k))}>
              <div className="flex items-center gap-2 text-gold">{k.icon}<span className="text-[13px] font-medium text-ink">{k.label}</span></div>
              <div className="mt-1 text-[11.5px] leading-snug text-muted">{k.hint}</div>
            </Panel>
          ))}
        </div>
      </Section>

      {kind && <Guided kind={kind} onClose={() => setKind(null)} defaultCompany={ids.length === 1 ? ids[0] : ''} />}
    </div>
  )
}

function Guided({ kind, onClose, defaultCompany }: { kind: Kind; onClose: () => void; defaultCompany: ID }) {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const { act, busy } = useAction()
  const [companyId, setCompanyId] = useState(defaultCompany)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [dr, setDr] = useState('')
  const [cr, setCr] = useState('')
  const [party, setParty] = useState('')
  const [narration, setNarration] = useState('')
  const accs = accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active).sort((a, b) => a.code.localeCompare(b.code))
  const amt = parseAmount(amount)
  const ok = companyId && amt && amt.gt(0) && dr && cr && dr !== cr && narration.trim()
  const drs = accs.filter(kind.debit ?? (() => true)), crs = accs.filter(kind.credit ?? (() => true))

  const go = async (submit: boolean) => {
    const id = await act(async () => {
      const jid = await api.saveJournalDraft({
        company_id: companyId, journal_date: date, voucher_type: kind.voucher, narration: narration.trim(), purpose: narration.trim(),
        lines: [
          { account_id: dr, debit: amt!.toFixed(2), party_id: kind.party === 'debit' && party ? party : null, description: narration.trim() },
          { account_id: cr, credit: amt!.toFixed(2), party_id: kind.party === 'credit' && party ? party : null, description: narration.trim() },
        ],
      })
      if (submit) await api.submitJournal(jid)
      return jid
    }, submit ? 'Submitted for approval' : 'Draft saved')
    if (id) { onClose(); nav('/journals/' + id) }
  }

  return (
    <Modal open onClose={onClose} title={kind.label} subtitle={kind.hint} width={620}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!ok || busy} onClick={() => void go(false)}>Save draft</button><button className="btn primary" disabled={!ok || busy || !can('journal.submit', companyId)} onClick={() => void go(true)}>{busy ? <Spinner /> : <Send size={15} />} Submit for approval</button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Company"><select className="field" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDr(''); setCr('') }}><option value="">Choose…</option>{companies.filter((c) => c.status === 'active' && can('journal.create', c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount" hint={amt ? undefined : 'You can type 45,000 or 1.2 lakh or 5 crore'}><input className="field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus /></Field>
        {kind.party && <Field label="Party"><select className="field" value={party} onChange={(e) => setParty(e.target.value)}><option value="">No party</option>{parties.filter((p) => p.roles.some((r) => r.company_id === companyId)).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></Field>}
        <Field label={kind.debitLabel ?? 'Debit'} hint={companyId && !drs.length ? 'No matching ledger exists in this company. Add one under Chart of Accounts.' : undefined}><select className="field" value={dr} onChange={(e) => setDr(e.target.value)}><option value="">Choose…</option>{drs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
        <Field label={kind.creditLabel ?? 'Credit'} hint={companyId && !crs.length ? 'No matching ledger exists in this company. Add one under Chart of Accounts.' : undefined}><select className="field" value={cr} onChange={(e) => setCr(e.target.value)}><option value="">Choose…</option>{crs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
        <Field label="What happened, and why?" className="sm:col-span-2"><input className="field" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Shown to the approver and kept with the entry" /></Field>
      </div>
      {amt && dr && cr && (
        <div className={cx('mt-4 rounded-xl border border-line p-3 text-[12.5px]')}>
          <div className="eyebrow mb-1.5">Accounting treatment</div>
          <div className="flex justify-between"><span>Dr {accounts.find((a) => a.id === dr)?.name}</span><Money value={amt} /></div>
          <div className="flex justify-between pl-5 text-ink2"><span>Cr {accounts.find((a) => a.id === cr)?.name}</span><Money value={amt} /></div>
        </div>
      )}
    </Modal>
  )
}
