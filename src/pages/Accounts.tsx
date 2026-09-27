import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Decimal from 'decimal.js'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, ListTree, Pencil, Plus, Search } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { downloadCsv, ledgerLink } from '@/lib/data'
import { D, ZERO } from '@/lib/money'
import { fmtDate, today } from '@/lib/dates'
import type { Account, AccountType, Company, ID } from '@/engine/types'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Tabs, Truth } from '@/ui/kit'
import { AccountMapping } from '@/ui/AccountMapping'

const TYPES: { key: AccountType; label: string; hint: string }[] = [
  { key: 'asset', label: 'Assets', hint: 'What the company owns or is owed' },
  { key: 'liability', label: 'Liabilities', hint: 'What the company owes' },
  { key: 'equity', label: 'Equity', hint: 'What belongs to the owners' },
  { key: 'income', label: 'Income', hint: 'What the company earns' },
  { key: 'expense', label: 'Expenses', hint: 'What the company spends' },
]
const SUBTYPES: Record<AccountType, string[]> = {
  asset: ['cash', 'bank', 'receivable', 'inventory', 'advance', 'deposit', 'prepaid', 'tax_receivable', 'intercompany_receivable', 'other_current_asset', 'investment', 'fixed_asset', 'accumulated_depreciation'],
  liability: ['payable', 'accrued', 'tax_payable', 'employee_payable', 'advance_received', 'intercompany_payable', 'provision', 'suspense', 'loan', 'short_term_borrowing', 'other_liability'],
  equity: ['capital', 'reserves', 'retained_earnings', 'drawings'],
  income: ['revenue', 'other_income'],
  expense: ['cogs', 'employee_cost', 'operating_expense', 'finance_cost', 'depreciation', 'tax_expense', 'exceptional'],
}
const CONTROL_TYPES = ['none', 'bank', 'cash', 'receivable', 'payable', 'tax', 'intercompany', 'suspense', 'advance_paid', 'advance_received']
const words = (s: string) => s.replace(/_/g, ' ')
const debitNatured = (t: AccountType) => t === 'asset' || t === 'expense'
/** balances are held Dr-positive and presented in the natural sign of the account type */
const natural = (t: AccountType, drPositive: Decimal) => (debitNatured(t) ? drPositive : drPositive.neg())

interface Node { account: Account; children: Node[]; own: Decimal; total: Decimal; postingIds: ID[] }
interface FlatRow { node: Node; depth: number }

export default function Accounts() {
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const mode = useApp((s) => s.mode)
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const ids = useScopeIds()
  const [params, setParams] = useSearchParams()
  const view: 'chart' | 'mapping' = params.get('tab') === 'mapping' ? 'mapping' : 'chart'

  const scoped = companies.filter((c) => ids.includes(c.id))
  const [companyId, setCompanyId] = useState<ID>('')
  const cid = scoped.some((c) => c.id === companyId) ? companyId : scoped[0]?.id ?? ''
  const company = scoped.find((c) => c.id === cid)
  const asAt = today()

  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showInactive, setShowInactive] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)

  const bal = useAsync(async () => (cid ? { cid, rows: await api.ledgerBalances([cid], '1990-01-01', asAt) } : null), [api, cid, asAt])
  const balances = bal.data && bal.data.cid === cid ? bal.data.rows : null

  const own = useMemo(() => accounts.filter((a) => a.company_id === cid), [accounts, cid])

  const tree = useMemo(() => {
    const closing = new Map<ID, Decimal>()
    for (const r of balances ?? []) {
      const v = D(r.opening_debit).plus(D(r.period_debit)).minus(D(r.opening_credit)).minus(D(r.period_credit))
      closing.set(r.account_id, (closing.get(r.account_id) ?? ZERO).plus(v))
    }
    const byId = new Map(own.map((a) => [a.id, a]))
    const kids = new Map<ID, Account[]>()
    const roots: Account[] = []
    for (const a of own) {
      // an account whose parent is missing, or is itself, is shown at the top of its type rather than lost
      if (a.parent_id && a.parent_id !== a.id && byId.has(a.parent_id)) kids.set(a.parent_id, [...(kids.get(a.parent_id) ?? []), a])
      else roots.push(a)
    }
    const seen = new Set<ID>()
    const build = (a: Account): Node => {
      seen.add(a.id)
      const children = (kids.get(a.id) ?? []).filter((c) => !seen.has(c.id)).sort((x, y) => x.code.localeCompare(y.code)).map(build)
      const ownBal = closing.get(a.id) ?? ZERO
      return {
        account: a, children, own: ownBal,
        total: children.reduce((s, c) => s.plus(c.total), ownBal),
        postingIds: [...(a.is_group ? [] : [a.id]), ...(a.is_group && !ownBal.isZero() ? [a.id] : []), ...children.flatMap((c) => c.postingIds)],
      }
    }
    const byType = TYPES.map((t) => ({ ...t, nodes: roots.filter((a) => a.type === t.key).sort((x, y) => x.code.localeCompare(y.code)).map(build) }))
    // accounts caught in a circular parent chain are still shown, at the top of their type
    for (const a of own) if (!seen.has(a.id)) byType.find((t) => t.key === a.type)?.nodes.push(build(a))
    return byType.map((t) => ({ ...t, total: t.nodes.reduce((s, n) => s.plus(n.total), ZERO), postingIds: t.nodes.flatMap((n) => n.postingIds) }))
  }, [own, balances])

  const needle = q.trim().toLowerCase()
  const hit = (a: Account) => a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle) || words(a.subtype).includes(needle)
  const usable = (a: Account) => showInactive || a.is_active

  /** search keeps ancestors of a match, and everything beneath a matching heading */
  const flatten = (nodes: Node[], depth: number, underMatch: boolean): FlatRow[] => nodes.flatMap((n) => {
    if (!usable(n.account)) return []
    const self = !needle || hit(n.account)
    const below = flatten(n.children, depth + 1, underMatch || (!!needle && self))
    if (needle && !self && !underMatch && below.length === 0) return []
    const open = needle ? true : !collapsed.has(n.account.id)
    return [{ node: n, depth }, ...(open ? below : [])]
  })

  const groupIds = own.filter((a) => a.is_group || own.some((c) => c.parent_id === a.id)).map((a) => a.id)
  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const mayConfigure = !!cid && can('account.configure', cid)
  const whyNot = 'You need the "account.configure" permission for this company'

  const exportCsv = () => {
    const byId = new Map(own.map((a) => [a.id, a]))
    const closing = new Map(tree.flatMap((t) => { const out: [ID, Decimal][] = []; const walk = (n: Node) => { out.push([n.account.id, n.account.is_group ? n.total : n.own]); n.children.forEach(walk) }; t.nodes.forEach(walk); return out }))
    const rows = [...own].sort((a, b) => a.code.localeCompare(b.code)).map((a) => [
      a.code, a.name, a.type, a.subtype, a.control_type ?? '', a.parent_id ? byId.get(a.parent_id)?.code ?? '' : '', a.is_group ? 'heading' : 'posting', a.is_active ? 'active' : 'inactive',
      balances ? natural(a.type, closing.get(a.id) ?? ZERO).toFixed(2) : '', a.description ?? '',
    ])
    downloadCsv(`chart-of-accounts-${company?.code ?? 'company'}${mode === 'demo' ? '-DEMO' : ''}`, ['Code', 'Name', 'Type', 'Subtype', 'Control type', 'Parent code', 'Kind', 'Status', `Closing balance as at ${asAt} (natural sign)`, 'Description'], rows)
    useApp.getState().toast('ok', 'Export ready', `${rows.length.toLocaleString()} account${rows.length === 1 ? '' : 's'} exported${mode === 'demo' ? ' (sample data)' : ''}.`)
  }

  if (!scoped.length) {
    return (
      <div>
        <PageHeader eyebrow="Ledger structure" title="Chart of Accounts" />
        <Panel><Empty icon={<ListTree size={20} />} title="No company in scope" body="Choose a company to see its chart of accounts." /></Panel>
      </div>
    )
  }

  const sections = tree.map((t) => ({ ...t, rows: flatten(t.nodes, 0, false) }))
  const shownCount = sections.reduce((n, s) => n + s.rows.length, 0)

  return (
    <div>
      <PageHeader eyebrow="Ledger structure" title="Chart of Accounts" truth={mode === 'demo' ? 'DEMO' : undefined}
        subtitle={<>{company?.name} · <span className="num">{own.length}</span> accounts · balances as at {fmtDate(asAt)} from posted entries</>}
        actions={<>
          {scoped.length > 1 && (
            <select className="field sm" style={{ width: 240 }} value={cid} onChange={(e) => { setCompanyId(e.target.value); setCollapsed(new Set()) }} aria-label="Company">
              {scoped.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          )}
          <button className="btn" disabled={!own.length} onClick={exportCsv} title="Export the whole chart of this company"><Download size={14} /> Export CSV</button>
          <button className="btn primary" disabled={!mayConfigure} title={mayConfigure ? 'Add an account to this company' : whyNot} onClick={() => setAdding(true)}><Plus size={15} /> Add account</button>
        </>} />

      <Tabs<'chart' | 'mapping'> tabs={[{ key: 'chart', label: 'Chart of accounts' }, { key: 'mapping', label: 'Account mapping' }]} value={view}
        onChange={(k) => setParams(k === 'chart' ? {} : { tab: k }, { replace: true })} />

      {view === 'mapping' && company && <AccountMapping key={company.id} company={company} />}

      {view === 'chart' && bal.error && <ErrorBox message={bal.error} retry={bal.reload} />}

      {view === 'chart' && <Panel lit={false} className="overflow-hidden">
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="field sm" style={{ width: 280, paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code, name or subtype…" aria-label="Search accounts" />
          </div>
          <button className="btn sm ghost" onClick={() => setCollapsed(new Set())}><ChevronsUpDown size={13} /> Expand all</button>
          <button className="btn sm ghost" onClick={() => setCollapsed(new Set([...TYPES.map((t) => 'type:' + t.key), ...groupIds]))}><ChevronsDownUp size={13} /> Collapse all</button>
          <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive accounts</label>
          <span className="ml-auto flex items-center gap-2 text-[11.5px] text-muted"><Truth state="ACTUAL" /> Headings show the total of the accounts beneath them</span>
        </div>

        {own.length === 0 ? (
          <Empty icon={<ListTree size={20} />} title="This company has no accounts" body="Add the first account, or create the company from a template to receive a recommended chart." />
        ) : needle && shownCount === 0 ? (
          <Empty title="No account matches" body="Try a different code or name." />
        ) : (
          <div className="overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Subtype</th>
                  <th>Control</th>
                  <th style={{ textAlign: 'right' }}>Closing balance</th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              {sections.map((s) => {
                const key = 'type:' + s.key
                const open = needle ? true : !collapsed.has(key)
                if (needle && s.rows.length === 0) return null
                return (
                  <tbody key={s.key}>
                    <tr className="rowlink" onClick={() => toggle(key)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') toggle(key) }}>
                      <td colSpan={3} className="bg-surface">
                        <span className="flex items-center gap-2">
                          {open ? <ChevronDown size={15} className="text-gold" /> : <ChevronRight size={15} className="text-gold" />}
                          <span className="display text-[14px] font-medium text-ink">{s.label}</span>
                          <span className="text-[11.5px] text-muted">{s.hint} · {debitNatured(s.key) ? 'debit' : 'credit'} balances shown as positive</span>
                        </span>
                      </td>
                      <td className="r bg-surface">
                        {balances
                          ? <button className="drill" onClick={(e) => { e.stopPropagation(); nav(ledgerLink({ accounts: s.postingIds, to: asAt })) }} title="Open the ledger lines behind this total" disabled={!s.postingIds.length}><Money value={natural(s.key, s.total)} currency={company?.base_currency} className="font-medium" /></button>
                          : <span className="text-muted">…</span>}
                      </td>
                      <td className="bg-surface" />
                    </tr>
                    {open && s.rows.length === 0 && (
                      <tr><td colSpan={5} className="text-[12.5px] text-muted">No {s.label.toLowerCase()} accounts.</td></tr>
                    )}
                    {open && s.rows.map(({ node, depth }) => {
                      const a = node.account
                      const parent = a.is_group || node.children.length > 0
                      const isOpen = needle ? true : !collapsed.has(a.id)
                      const value = natural(a.type, parent ? node.total : node.own)
                      const go = () => (parent ? toggle(a.id) : nav(ledgerLink({ accounts: [a.id] })))
                      return (
                        <tr key={a.id} className={cx('rowlink', !a.is_active && 'opacity-60')} onClick={go} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go() }}
                          title={parent ? undefined : 'Open the ledger of this account'}>
                          <td>
                            <span className="flex items-center gap-2" style={{ paddingLeft: 22 + depth * 20 }}>
                              {parent ? (isOpen ? <ChevronDown size={14} className="flex-none text-muted" /> : <ChevronRight size={14} className="flex-none text-muted" />) : <span className="inline-block w-[14px] flex-none" />}
                              <span className="num flex-none text-[12px] text-muted">{a.code}</span>
                              <span className={cx('truncate', parent ? 'font-medium text-ink' : 'text-ink2')}>{a.name}</span>
                              {a.is_group && <span className="chip">heading</span>}
                              {!a.is_active && <span className="chip neg">inactive</span>}
                            </span>
                          </td>
                          <td><span className="chip">{words(a.subtype)}</span></td>
                          <td>{a.control_type ? <span className="chip cyan">{words(a.control_type)}</span> : <span className="text-muted">—</span>}</td>
                          <td className="r">
                            {!balances ? <span className="text-muted">…</span> : parent ? (
                              <button className="drill" disabled={!node.postingIds.length} onClick={(e) => { e.stopPropagation(); nav(ledgerLink({ accounts: node.postingIds, to: asAt })) }} title="Total of the accounts beneath this heading — open the ledger lines behind it">
                                <Money value={value} currency={company?.base_currency} className="font-medium" dim />
                              </button>
                            ) : <Money value={value} currency={company?.base_currency} dim />}
                          </td>
                          <td className="r">
                            <button className="btn sm icon ghost no-print" disabled={!mayConfigure} aria-label={`Edit ${a.name}`} title={mayConfigure ? 'Edit this account' : whyNot} onClick={(e) => { e.stopPropagation(); setEditing(a) }}><Pencil size={13} /></button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
        {bal.loading && !balances && !bal.error && <Loading rows={2} label="Loading balances" />}
      </Panel>}

      {view === 'chart' && <Note className="mt-4">Accounts are never deleted. An account that is no longer needed is deactivated: it stops accepting new entries, while its history, balance and audit trail remain exactly as they were.</Note>}

      {adding && company && <AccountModal key="new" company={company} own={own} onClose={() => setAdding(false)} />}
      {editing && company && <AccountModal key={editing.id} company={company} own={own} account={editing} balance={tree.flatMap((t) => find(t.nodes, editing.id)).map((n) => natural(n.account.type, n.account.is_group ? n.total : n.own))[0]} onClose={() => setEditing(null)} />}
    </div>
  )
}

const find = (nodes: Node[], id: ID): Node[] => nodes.flatMap((n) => (n.account.id === id ? [n] : find(n.children, id)))

// ------------------------------------------------------------------ add / edit
function AccountModal({ company, own, account, balance, onClose }: { company: Company; own: Account[]; account?: Account; balance?: Decimal; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const { act, busy } = useAction()
  const editing = !!account

  const [code, setCode] = useState(account?.code ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'expense')
  const [subtype, setSubtype] = useState(account?.subtype ?? SUBTYPES.expense[2])
  const [parentId, setParentId] = useState<ID>(account?.parent_id ?? '')
  const [isGroup, setIsGroup] = useState(account?.is_group ?? false)
  const [control, setControl] = useState(account?.control_type ?? 'none')
  const [counterparty, setCounterparty] = useState<ID>(account?.counterparty_company_id ?? '')
  const [description, setDescription] = useState(account?.description ?? '')
  const [active, setActive] = useState(account?.is_active ?? true)

  const descendants = useMemo(() => {
    const out = new Set<ID>()
    if (!account) return out
    const walk = (id: ID) => own.filter((a) => a.parent_id === id && !out.has(a.id)).forEach((a) => { out.add(a.id); walk(a.id) })
    walk(account.id)
    return out
  }, [own, account])
  const parents = own.filter((a) => a.is_group && a.type === type && a.id !== account?.id && !descendants.has(a.id) && (a.is_active || a.id === parentId)).sort((a, b) => a.code.localeCompare(b.code))
  const others = companies.filter((c) => c.id !== company.id)

  const changeType = (t: AccountType) => { setType(t); setSubtype(SUBTYPES[t][0]); setParentId('') }
  const duplicate = !editing && own.some((a) => a.code.trim().toLowerCase() === code.trim().toLowerCase() && code.trim() !== '')
  const problems: string[] = []
  if (!code.trim()) problems.push('Enter an account code.')
  if (duplicate) problems.push(`Code ${code.trim()} is already used in this company.`)
  if (!name.trim()) problems.push('Enter an account name.')
  if (!editing && control === 'intercompany' && !counterparty) problems.push('Choose the counterparty company for an intercompany account.')

  const save = async () => {
    if (problems.length) return
    if (account) {
      const patch: Partial<Account> = {}
      if (name.trim() !== account.name) patch.name = name.trim()
      if ((description.trim() || null) !== (account.description ?? null)) patch.description = description.trim() || null
      if ((parentId || null) !== account.parent_id) patch.parent_id = parentId || null
      if (active !== account.is_active) patch.is_active = active
      if (!Object.keys(patch).length) { onClose(); return }
      const ok = await act(async () => { await api.updateAccount(account.id, patch); await useApp.getState().refreshMaster(); return true },
        patch.is_active === false ? 'Account deactivated — its history is kept' : patch.is_active === true ? 'Account reactivated' : 'Account updated')
      if (ok) onClose()
      return
    }
    const id = await act(async () => {
      const n = await api.createAccount({
        company_id: company.id, code: code.trim(), name: name.trim(), type, subtype, parent_id: parentId || null, is_group: isGroup,
        control_type: control === 'none' ? null : control, counterparty_company_id: control === 'intercompany' ? counterparty || null : null,
        description: description.trim() || null,
      })
      await useApp.getState().refreshMaster()
      return n
    }, `Account ${code.trim()} added`)
    if (id) onClose()
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${account?.code} · ${account?.name}` : 'Add account'} subtitle={`${company.code} · ${company.name}`} width={680}
      footer={<>
        {problems.length > 0 && <span className="mr-auto text-[12px] text-muted">{problems[0]}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={problems.length > 0 || busy} onClick={() => void save()}>{editing ? 'Save changes' : 'Add account'}</button>
      </>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Code" hint={editing ? 'The code of an existing account is not changed here' : undefined}>
          <input className={cx('field num', duplicate && 'border-neg')} value={code} disabled={editing} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 6235" />
        </Field>
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office Maintenance" /></Field>
        <Field label="Type" hint={editing ? 'The type and subtype decide where the account appears in the statements and are fixed once created' : undefined}>
          <select className="field" value={type} disabled={editing} onChange={(e) => changeType(e.target.value as AccountType)}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Subtype">
          <select className="field" value={subtype} disabled={editing} onChange={(e) => setSubtype(e.target.value)}>
            {!SUBTYPES[type].includes(subtype) && <option value={subtype}>{words(subtype)}</option>}
            {SUBTYPES[type].map((s) => <option key={s} value={s}>{words(s)}</option>)}
          </select>
        </Field>
        <Field label="Parent heading" hint="Heading accounts of the same type">
          <select className="field" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">No parent — top level</option>
            {parents.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Control type">
          <select className="field" value={control ?? 'none'} disabled={editing} onChange={(e) => setControl(e.target.value)}>
            {control && !CONTROL_TYPES.includes(control) && <option value={control}>{words(control)}</option>}
            {CONTROL_TYPES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
          </select>
        </Field>
        {control === 'intercompany' && (
          <Field label="Counterparty company" hint="The group company on the other side of this balance" className="sm:col-span-2">
            <select className="field" value={counterparty} disabled={editing} onChange={(e) => setCounterparty(e.target.value)}>
              <option value="">Select a company…</option>
              {others.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Description" className="sm:col-span-2">
          <textarea className="field" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is recorded in this account?" />
        </Field>
        {!editing && (
          <label className="flex items-start gap-2.5 text-[13px] text-ink2 sm:col-span-2">
            <input type="checkbox" className="mt-[3px]" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} />
            <span>This is a group heading<span className="block text-[12px] text-muted">A heading organises other accounts and shows their total. Entries are posted to the accounts beneath it, not to the heading.</span></span>
          </label>
        )}
        {editing && (
          <label className="flex items-start gap-2.5 text-[13px] text-ink2 sm:col-span-2">
            <input type="checkbox" className="mt-[3px]" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active<span className="block text-[12px] text-muted">Untick to deactivate. The account is never deleted: its entries, balance and audit trail are kept, and it can be reactivated at any time.</span></span>
          </label>
        )}
      </div>
      {editing && !active && account?.is_active && balance && !balance.isZero() && (
        <Note kind="warn" className="mt-3.5">This account carries a balance of <Money value={balance} currency={company.base_currency} />. Deactivating it does not remove or move that balance.</Note>
      )}
    </Modal>
  )
}
