import { useMemo, useState } from 'react'
import { ShieldAlert, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { fmtDate, today } from '@/lib/dates'
import type { ID, Member, Role } from '@/engine/types'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Note, PageHeader, Panel, ReasonDialog, Tabs } from '@/ui/kit'
import { DataTable, type Column } from '@/ui/DataTable'

type TabKey = 'members' | 'roles' | 'sod'
const MODULES = ['company', 'account', 'journal', 'invoice', 'bill', 'payment', 'party', 'bank', 'budget', 'period', 'report', 'audit', 'sentinel', 'vault', 'numi', 'tax', 'approval', 'field']
const BY_DESIGN = ['owner', 'group_cfo']
const words = (s: string) => s.replace(/[._]/g, ' ')

interface Rule { key: string; title: string; why: string; all: string[]; any?: string[] }
const RULES: Rule[] = [
  { key: 'a', title: 'Create, approve and post journals', why: 'One role can record an entry, approve it and place it in the ledger.', all: ['journal.create', 'journal.approve', 'journal.post'] },
  { key: 'b', title: 'Maintain parties, verify their bank details and approve payments', why: 'One role can set up a payee, confirm the payee\'s bank account and release money to it.', any: ['party.create', 'party.edit'], all: ['party.bank.verify', 'payment.approve'] },
  { key: 'c', title: 'Create and approve payments', why: 'One role can both raise a payment and approve it.', all: ['payment.create', 'payment.approve'] },
  { key: 'd', title: 'Create and approve invoices', why: 'One role can both raise a sales invoice and approve it.', all: ['invoice.create', 'invoice.approve'] },
  { key: 'e', title: 'Create and approve bills', why: 'One role can both enter a purchase bill and approve it.', all: ['bill.create', 'bill.approve'] },
]
interface Conflict { id: string; role: Role; rule: Rule; held: string[]; byDesign: boolean }

const access = (m: Member, now: string): { label: string; cls: string; rank: number } => {
  if (m.valid_to && m.valid_to.slice(0, 10) < now) return { label: `expired ${fmtDate(m.valid_to)}`, cls: 'neg', rank: 3 }
  if (m.valid_from && m.valid_from.slice(0, 10) > now) return { label: `starts ${fmtDate(m.valid_from)}`, cls: 'cyan', rank: 2 }
  if (m.valid_to) return { label: `expires ${fmtDate(m.valid_to)}`, cls: 'warn', rank: 1 }
  return { label: 'standing access', cls: 'pos', rank: 0 }
}

export default function Team() {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const isAdmin = useApp((s) => !!s.session?.isGroupAdmin)
  const { act, busy } = useAction()
  const [tab, setTab] = useState<TabKey>('members')
  const [granting, setGranting] = useState(false)
  const [revoking, setRevoking] = useState<Member | null>(null)
  const [companyFilter, setCompanyFilter] = useState<ID>('')

  const main = useAsync(async () => {
    const [members, roles] = await Promise.all([api.listMembers(), api.listRoles()])
    return { members, roles }
  }, [api])

  const d = main.data
  const now = today()
  const roles = useMemo(() => d?.roles ?? [], [d])
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? words(key)
  const companyName = (id: ID) => companies.find((c) => c.id === id)?.name ?? 'Unknown company'
  const adminOnly = 'Only a group administrator can change access'
  const members = (d?.members ?? []).filter((m) => !companyFilter || m.company_id === companyFilter)

  const matrix = useMemo(() => {
    const perms = [...new Set(roles.flatMap((r) => r.permissions))]
    const prefix = (p: string) => p.split('.')[0]
    const extra = [...new Set(perms.map(prefix).filter((m) => !MODULES.includes(m)))].sort()
    return [...MODULES, ...extra]
      .map((m) => ({ module: m, perms: perms.filter((p) => prefix(p) === m).sort() }))
      .filter((g) => g.perms.length > 0)
  }, [roles])
  const held = useMemo(() => new Map(roles.map((r) => [r.key, new Set(r.permissions)])), [roles])
  const permCount = matrix.reduce((n, g) => n + g.perms.length, 0)

  const conflicts = useMemo<Conflict[]>(() => roles.flatMap((role) => {
    const has = new Set(role.permissions)
    return RULES.flatMap((rule) => {
      const anyHeld = (rule.any ?? []).filter((p) => has.has(p))
      if (!rule.all.every((p) => has.has(p)) || (rule.any && anyHeld.length === 0)) return []
      return [{ id: role.key + ':' + rule.key, role, rule, held: [...anyHeld, ...rule.all], byDesign: BY_DESIGN.includes(role.key) }]
    })
  }), [roles])
  const unexpected = conflicts.filter((c) => !c.byDesign)
  const membersIn = (roleKey: string) => (d?.members ?? []).filter((m) => m.role_key === roleKey && access(m, now).rank < 3).length

  const memberColumns: Column<Member>[] = [
    { key: 'email', header: 'Email', sort: (m) => m.email, csv: (m) => m.email, render: (m) => <span className="text-ink">{m.email}</span> },
    { key: 'name', header: 'Name', sort: (m) => m.full_name, csv: (m) => m.full_name, render: (m) => <span className="text-ink2">{m.full_name || '—'}</span> },
    { key: 'company', header: 'Company', sort: (m) => companyName(m.company_id), csv: (m) => companyName(m.company_id), render: (m) => <span className="text-ink2">{companyName(m.company_id)}</span> },
    { key: 'role', header: 'Role', sort: (m) => roleName(m.role_key), csv: (m) => roleName(m.role_key), render: (m) => <span className="chip gold">{roleName(m.role_key)}</span> },
    { key: 'from', header: 'Valid from', sort: (m) => m.valid_from ?? '', csv: (m) => m.valid_from, render: (m) => <span className="num text-[12px] text-ink2">{m.valid_from ? fmtDate(m.valid_from) : 'No start date'}</span> },
    { key: 'to', header: 'Valid to', sort: (m) => m.valid_to ?? '9999', csv: (m) => m.valid_to, render: (m) => <span className="num text-[12px] text-ink2">{m.valid_to ? fmtDate(m.valid_to) : 'No end date'}</span> },
    { key: 'access', header: 'Access', sort: (m) => access(m, now).rank, csv: (m) => access(m, now).label, render: (m) => { const a = access(m, now); return <span className={cx('chip', a.cls)}>{a.label}</span> } },
    {
      key: 'actions', header: '', align: 'right',
      render: (m) => <button className="btn sm ghost" disabled={!isAdmin || busy} title={isAdmin ? 'Remove this person\'s access to the company' : adminOnly} onClick={() => setRevoking(m)}><UserMinus size={13} /> Revoke</button>,
    },
  ]

  const conflictColumns: Column<Conflict>[] = [
    { key: 'finding', header: 'Finding', csv: () => 'SEGREGATION-OF-DUTIES CONFLICT', render: (c) => <span className={cx('chip', c.byDesign ? '' : 'neg')}>SEGREGATION-OF-DUTIES CONFLICT</span> },
    { key: 'role', header: 'Role', sort: (c) => c.role.name, csv: (c) => c.role.name, render: (c) => <div><span className="font-medium text-ink">{c.role.name}</span>{c.byDesign && <span className="chip gold ml-2">by design</span>}</div> },
    { key: 'rule', header: 'Combined abilities', sort: (c) => c.rule.key, csv: (c) => c.rule.title, render: (c) => <div className="min-w-[240px]"><div className="text-ink">{c.rule.title}</div><div className="text-[12px] text-muted">{c.rule.why}</div></div> },
    { key: 'perms', header: 'Permissions held', csv: (c) => c.held.join(' + '), render: (c) => <div className="flex flex-wrap gap-1">{c.held.map((p) => <span key={p} className="num rounded-full border border-line bg-surface px-1.5 py-[1px] text-[10.5px] text-ink2">{p}</span>)}</div> },
    { key: 'members', header: 'Members', align: 'right', sort: (c) => membersIn(c.role.key), csv: (c) => membersIn(c.role.key), render: (c) => <span className="num">{membersIn(c.role.key)}</span> },
  ]

  const grantBtn = (
    <button className="btn primary" disabled={!isAdmin || !d || companies.length === 0} title={isAdmin ? 'Give a person access to a company' : adminOnly} onClick={() => setGranting(true)}>
      <UserPlus size={15} /> Grant access
    </button>
  )

  return (
    <div>
      <PageHeader eyebrow="Governance" title="Team & Access"
        subtitle="Who can see and do what, company by company. Access is granted through roles; every role is a fixed set of permissions."
        actions={grantBtn} />

      {!isAdmin && <Note className="mb-4">You are viewing access in read-only mode. Granting and revoking access is reserved for group administrators.</Note>}
      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {main.loading && !d && <Panel><Loading rows={6} /></Panel>}

      {d && (
        <>
          <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
            { key: 'members', label: 'Members', count: d.members.length },
            { key: 'roles', label: 'Roles & permissions', count: roles.length },
            { key: 'sod', label: 'Segregation of duties', count: conflicts.length },
          ]} />

          {tab === 'members' && (
            <Panel lit={false} className="overflow-hidden">
              <DataTable<Member> columns={memberColumns} rows={members} rowKey={(m) => m.id} exportName="team-access" initialSort={{ key: 'email', dir: 'asc' }}
                rowClass={(m) => (access(m, now).rank === 3 ? 'opacity-60' : undefined)}
                toolbar={(
                  <select className="field sm" style={{ width: 240 }} value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company">
                    <option value="">All companies</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </select>
                )}
                empty={d.members.length
                  ? { title: 'No members in this company', body: 'Choose another company, or grant access to this one.' }
                  : { title: 'No access has been granted yet', body: 'Members appear here once a person who has signed up is given a role in a company.', icon: <Users size={20} />, action: grantBtn }} />
            </Panel>
          )}

          {tab === 'roles' && (
            <>
              <Note className="mb-4">Roles and their permissions are read-only in this phase. The matrix shows what each role holds; it cannot be changed here.</Note>
              {roles.length === 0 ? <Panel><Empty icon={<ShieldCheck size={20} />} title="No roles are defined" /></Panel> : (
                <Panel lit={false} className="overflow-hidden">
                  <div className="border-b border-line px-4 py-3 text-[12.5px] text-ink2"><span className="num text-ink">{permCount}</span> permissions across <span className="num text-ink">{roles.length}</span> roles. A filled dot means the role holds the permission.</div>
                  <div className="overflow-auto" style={{ maxHeight: '68vh' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ position: 'sticky', left: 0, zIndex: 3, minWidth: 210 }}>Permission</th>
                          {roles.map((r) => <th key={r.key} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 86, lineHeight: 1.25 }} title={`${r.name} · ${r.permissions.length} permissions`}>{r.name}</th>)}
                        </tr>
                      </thead>
                      {matrix.map((g) => (
                        <tbody key={g.module}>
                          <tr>
                            <td colSpan={roles.length + 1} className="bg-surface"><span className="eyebrow text-gold">{words(g.module)}</span></td>
                          </tr>
                          {g.perms.map((p) => (
                            <tr key={p}>
                              <td style={{ position: 'sticky', left: 0, background: 'var(--surface-solid)' }}><span className="num text-[12px] text-ink2">{p}</span></td>
                              {roles.map((r) => {
                                const on = held.get(r.key)?.has(p) ?? false
                                return (
                                  <td key={r.key} style={{ textAlign: 'center' }} title={`${r.name} ${on ? 'holds' : 'does not hold'} ${p}`}>
                                    <span aria-label={on ? 'held' : 'not held'} className={cx('inline-block h-2.5 w-2.5 rounded-full', on ? 'bg-gold' : 'border border-line2')} />
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      ))}
                    </table>
                  </div>
                </Panel>
              )}
            </>
          )}

          {tab === 'sod' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Panel className="p-4">
                  <div className="flex items-center gap-2"><ShieldAlert size={16} className={unexpected.length ? 'text-neg' : 'text-pos'} /><span className="eyebrow">Conflicts outside Owner and Group CFO</span></div>
                  <div className={cx('num mt-2 text-[22px] leading-none', unexpected.length ? 'text-neg' : 'text-pos')}>{unexpected.length}</div>
                </Panel>
                <Panel className="p-4">
                  <div className="eyebrow">Conflicts held by design</div>
                  <div className="num mt-2 text-[22px] leading-none text-ink">{conflicts.length - unexpected.length}</div>
                </Panel>
                <Panel className="p-4">
                  <div className="eyebrow">Roles examined</div>
                  <div className="num mt-2 text-[22px] leading-none text-ink">{roles.length}</div>
                </Panel>
              </div>
              <Panel lit={false} className="mb-4 overflow-hidden">
                <DataTable<Conflict> columns={conflictColumns} rows={conflicts} rowKey={(c) => c.id} exportName="segregation-of-duties"
                  empty={{ title: 'No role combines conflicting abilities', body: 'None of the five combinations examined is held by a single role.', icon: <ShieldCheck size={20} /> }} />
              </Panel>
              <div className="space-y-2">
                <Note>These findings are computed from the permissions of each role. They describe what a role is able to do; they do not mean that anyone has done it.</Note>
                <Note kind="good">Maker-checker in the ledger engine still applies to every role: a person cannot approve their own work, whatever permissions their role holds.</Note>
                <Note>The Owner and Group CFO roles hold every permission by design, so they appear in every combination. Their rows are marked “by design”.</Note>
              </div>
            </>
          )}
        </>
      )}

      {granting && d && <GrantModal roles={roles} onClose={() => setGranting(false)} />}

      <ReasonDialog open={!!revoking} required={false} danger title="Revoke access" confirm="Revoke access"
        body={revoking ? <>{revoking.full_name || revoking.email} will lose the role <b>{roleName(revoking.role_key)}</b> in <b>{companyName(revoking.company_id)}</b>. Everything this person recorded stays in the books under their name.</> : undefined}
        extra={<Note kind="warn" className="mb-4">The removal is recorded in the audit trail. The access record has no field for a reason, so text entered below is not stored with it.</Note>}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const m = revoking
          if (!m) return
          setRevoking(null)
          void act(() => api.revokeMembership(m.id), `Access revoked for ${m.email}`)
        }} />
    </div>
  )
}

// ------------------------------------------------------------------ grant
function GrantModal({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const { act, busy } = useAction()
  const active = companies.filter((c) => c.status === 'active')
  const [email, setEmail] = useState('')
  const [companyId, setCompanyId] = useState<ID>(active[0]?.id ?? companies[0]?.id ?? '')
  const [roleKey, setRoleKey] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const role = roles.find((r) => r.key === roleKey)
  const mail = email.trim().toLowerCase()
  const problems: string[] = []
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) problems.push('Enter the email address the person signed up with.')
  if (!companyId) problems.push('Choose a company.')
  if (!role) problems.push('Choose a role.')
  if (from && to && to < from) problems.push('The end date is before the start date.')
  if (to && to < today()) problems.push('The end date is in the past.')

  const save = async () => {
    if (problems.length || !role) return
    const ok = await act(async () => { await api.grantMembership(mail, companyId, role.key, from || undefined, to || undefined); return true }, `${role.name} access granted to ${mail}`)
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} title="Grant access" subtitle="Gives one person one role in one company" width={600}
      footer={<>
        {problems.length > 0 && <span className="mr-auto text-[12px] text-muted">{problems[0]}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={problems.length > 0 || busy} onClick={() => void save()}><UserPlus size={14} /> Grant access</button>
      </>}>
      <Note className="mb-4">The person must already have signed up with this email address. Access cannot be granted to an address that has no account.</Note>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Email" className="sm:col-span-2"><input className="field" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" /></Field>
        <Field label="Company">
          <select className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.status === 'archived' ? ' (archived)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Role" hint={role ? `${role.permissions.length} permissions` : undefined}>
          <select className="field" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            <option value="">Select a role…</option>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Valid from (optional)" hint="Leave empty to start immediately"><input className="field num" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Valid to (optional)" hint="Set an end date for temporary access"><input className="field num" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {role && BY_DESIGN.includes(role.key) && <Note kind="warn" className="mt-3.5">The {role.name} role holds every permission in the company, including approval, posting, period locking and configuration.</Note>}
    </Modal>
  )
}
