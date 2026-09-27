import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, Link2 } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { ledgerLink } from '@/lib/data'
import type { Company } from '@/engine/types'
import { ACCOUNT_MAP_KEYS } from '@/engine/opsTypes'
import { ErrorBox, Loading, Note, Panel, Spinner } from './kit'

/**
 * Account mapping: which ledger plays which role for the posting engines.
 * An operation (a bill, an advance, a payroll run) never chooses ledgers on its own —
 * it uses the ledger a person has mapped to the role. A role with no ledger makes the
 * operation refuse, with an explanation, instead of posting to a guessed account.
 */
export function AccountMapping({ company }: { company: Company }) {
  const api = useApp((s) => s.api)!
  const nav = useNavigate()
  const accounts = useApp((s) => s.accounts)
  const { act, busy } = useAction()
  const [saving, setSaving] = useState<string | null>(null)
  const map = useAsync(() => api.listAccountMap([company.id]), [api, company.id])

  const posting = useMemo(() => accounts.filter((a) => a.company_id === company.id && !a.is_group && a.is_active).sort((a, b) => a.code.localeCompare(b.code)), [accounts, company.id])
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const mapped = new Map((map.data ?? []).map((m) => [m.key, m.account_id]))
  const known = new Set(ACCOUNT_MAP_KEYS.map((k) => k.key))
  const extra = (map.data ?? []).filter((m) => !known.has(m.key))
  const rows = [...ACCOUNT_MAP_KEYS, ...extra.map((m) => ({ key: m.key, label: m.key.replace(/_/g, ' '), usedBy: 'Defined for this company' }))]
  const missing = ACCOUNT_MAP_KEYS.filter((k) => !mapped.has(k.key))
  const may = can('account.configure', company.id)

  const set = async (key: string, accountId: string) => {
    if (!accountId) return
    setSaving(key)
    await act(() => api.setAccountMap(company.id, key, accountId), 'Mapping saved. It applies to entries proposed from now on.')
    setSaving(null)
  }

  if (map.error) return <ErrorBox message={map.error} retry={map.reload} />
  if (!map.data) return <Panel><Loading rows={6} label="Loading the account mapping" /></Panel>

  return (
    <div>
      <Note className="mb-4">
        <strong className="text-ink">What this is.</strong> Each role below is a ledger the posting engines use when an operation proposes an accounting entry. Changing a mapping affects entries proposed from now on; entries already posted are never altered. Every change is recorded in the audit trail.
      </Note>
      {missing.length > 0 && (
        <Note kind="warn" className="mb-4">
          <strong className="text-ink">{missing.length} role{missing.length === 1 ? ' has' : 's have'} no ledger.</strong> An operation that needs {missing.length === 1 ? 'it' : 'one of them'} will refuse and explain why, rather than post to a guessed account: {missing.map((m) => m.label).join('; ')}.
        </Note>
      )}
      <Panel lit={false} className="overflow-hidden">
        <div className="overflow-auto">
          <table className="table">
            <thead><tr><th>Role</th><th>Used by</th><th style={{ minWidth: 320 }}>Ledger</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>
              {rows.map((k) => {
                const id = mapped.get(k.key) ?? ''
                const a = id ? byId.get(id) : undefined
                const stale = !!id && (!a || !a.is_active || a.is_group)
                return (
                  <tr key={k.key}>
                    <td>
                      <div className="text-ink">{k.label}</div>
                      <div className="num text-[11px] text-muted">{k.key}</div>
                    </td>
                    <td className="text-[12.5px] text-ink2">{k.usedBy}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <select className="field sm" value={id} disabled={!may || busy} title={may ? undefined : 'You need the "account.configure" permission for this company'} onChange={(e) => void set(k.key, e.target.value)} aria-label={`Ledger for ${k.label}`}>
                          <option value="">{id ? 'Choose…' : 'Not mapped'}</option>
                          {stale && a && <option value={a.id}>{a.code} · {a.name} (inactive)</option>}
                          {posting.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                        </select>
                        {saving === k.key && <Spinner size={13} />}
                      </div>
                      {stale && <div className="mt-1 flex items-center gap-1 text-[11.5px] text-warn"><AlertTriangle size={11} /> The mapped ledger is inactive or is a heading. Choose an active posting ledger.</div>}
                    </td>
                    <td className="r">
                      {!id ? <span className="chip warn">not mapped</span>
                        : <button className="btn sm ghost" onClick={() => nav(ledgerLink({ accounts: [id] }))} title="Open the ledger of this account"><Link2 size={12} /> Ledger</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted"><Check size={12} className="text-pos" /> {rows.length - missing.length} of {rows.length} roles mapped for {company.name}.</div>
    </div>
  )
}
