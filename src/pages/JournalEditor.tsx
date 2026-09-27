import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Plus, Save, Scale, Send, Trash2 } from 'lucide-react'
import { can, useApp, useScopeIds } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import type { Confidentiality, ID, JournalInput } from '@/engine/types'
import { D, fmtMoney, sum } from '@/lib/money'
import { today } from '@/lib/dates'
import { cx, ErrorBox, Field, Loading, Money, Note, PageHeader, Panel, Spinner } from '@/ui/kit'

interface Row { key: number; account_id: ID | ''; party_id: ID | ''; description: string; debit: string; credit: string; dims: Record<string, ID> }
let k = 0
const blank = (): Row => ({ key: ++k, account_id: '', party_id: '', description: '', debit: '', credit: '', dims: {} })

/** Professional journal entry: keyboard-first, balance shown continuously, nothing posts without approval. */
export default function JournalEditor() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const accounts = useApp((s) => s.accounts)
  const parties = useApp((s) => s.parties)
  const orgUnits = useApp((s) => s.orgUnits)
  const isAdmin = useApp((s) => s.session?.isGroupAdmin)
  const ids = useScopeIds()
  const { act, busy } = useAction()

  const [companyId, setCompanyId] = useState<ID>(sp.get('company') ?? ids[0] ?? '')
  const [date, setDate] = useState(today())
  const [vtype, setVtype] = useState('journal')
  const [narration, setNarration] = useState('')
  const [purpose, setPurpose] = useState('')
  const [conf, setConf] = useState<Confidentiality>('internal')
  const [rows, setRows] = useState<Row[]>([blank(), blank()])
  const [dimTypes, setDimTypes] = useState<string[]>(['department', 'project'])
  const loaded = useRef(false)

  const vt = useAsync(() => api.listVoucherTypes(), [api])
  const ut = useAsync(() => api.listOrgUnitTypes(), [api])
  const existing = useAsync(async () => (id ? api.openJournal(id) : null), [api, id])

  useEffect(() => {
    const j = existing.data
    if (!j || loaded.current) return
    loaded.current = true
    setCompanyId(j.company_id); setDate(j.journal_date); setVtype(j.voucher_type); setNarration(j.narration ?? ''); setPurpose(j.purpose ?? ''); setConf(j.confidentiality)
    setRows(j.lines.map((l) => ({ key: ++k, account_id: l.account_id, party_id: l.party_id ?? '', description: l.description ?? '', debit: D(l.debit).isZero() ? '' : D(l.debit).toString(), credit: D(l.credit).isZero() ? '' : D(l.credit).toString(), dims: Object.fromEntries(Object.entries(l.dims).map(([t, u]) => [t, u.id])) })))
    const used = new Set(j.lines.flatMap((l) => Object.keys(l.dims)))
    if (used.size) setDimTypes([...new Set([...used])])
  }, [existing.data])

  const company = companies.find((c) => c.id === companyId)
  const accs = useMemo(() => accounts.filter((a) => a.company_id === companyId && !a.is_group && a.is_active).sort((a, b) => a.code.localeCompare(b.code)), [accounts, companyId])
  const pts = useMemo(() => parties.filter((p) => p.roles.some((r) => r.company_id === companyId) && p.status !== 'terminated').sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, companyId])
  const units = useMemo(() => orgUnits.filter((u) => u.company_id === companyId && u.status === 'active'), [orgUnits, companyId])
  const availableDims = (ut.data ?? []).filter((t) => units.some((u) => u.type_key === t.key))

  const filled = rows.filter((r) => r.account_id || r.debit || r.credit)
  const totalDr = sum(filled.map((r) => r.debit || 0))
  const totalCr = sum(filled.map((r) => r.credit || 0))
  const diff = totalDr.minus(totalCr)
  const problems: string[] = []
  if (!companyId) problems.push('Choose a company.')
  if (filled.length < 2) problems.push('A journal needs at least two lines.')
  filled.forEach((r, i) => {
    if (!r.account_id) problems.push(`Line ${i + 1}: choose a ledger account.`)
    const d = D(r.debit), c = D(r.credit)
    if (d.gt(0) && c.gt(0)) problems.push(`Line ${i + 1}: enter a debit or a credit, not both.`)
    if (d.isZero() && c.isZero()) problems.push(`Line ${i + 1}: enter an amount.`)
    if (d.lt(0) || c.lt(0)) problems.push(`Line ${i + 1}: amounts cannot be negative.`)
    const a = accs.find((x) => x.id === r.account_id)
    if (a && (a.control_type === 'receivable' || a.control_type === 'payable') && !r.party_id) problems.push(`Line ${i + 1}: ${a.name} is a control account — choose the party so the subledger stays reconciled.`)
  })
  const balanced = diff.isZero() && totalDr.gt(0)
  const canSubmit = balanced && problems.length === 0 && Boolean(narration.trim())

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () => setRows((rs) => [...rs, blank()])
  const balanceInto = (key: number) => {
    const others = rows.filter((r) => r.key !== key)
    const d = sum(others.map((r) => r.debit || 0)).minus(sum(others.map((r) => r.credit || 0)))
    if (d.isZero()) return
    set(key, d.gt(0) ? { credit: d.toString(), debit: '' } : { debit: d.abs().toString(), credit: '' })
  }

  const payload = (): JournalInput => ({
    id, company_id: companyId, journal_date: date, voucher_type: vtype, narration: narration.trim(), purpose: purpose.trim() || undefined, confidentiality: conf,
    lines: filled.map((r) => ({ account_id: r.account_id as ID, party_id: r.party_id || null, description: r.description.trim() || narration.trim(), debit: r.debit || 0, credit: r.credit || 0, dims: r.dims })),
  })

  const save = async (submit: boolean) => {
    const saved = await act(async () => {
      const jid = await api.saveJournalDraft(payload())
      if (submit) await api.submitJournal(jid)
      return jid
    }, submit ? 'Submitted for approval' : 'Draft saved')
    if (saved) nav('/journals/' + saved)
  }

  if (id && existing.loading && !existing.data) return <Panel><Loading rows={6} /></Panel>
  if (id && existing.error) return <ErrorBox message={existing.error} retry={existing.reload} />
  if (id && existing.data && !['draft', 'rejected'].includes(existing.data.status)) {
    return <Note kind="warn">This journal is {existing.data.status}. Only drafts can be edited; posted journals are corrected by reversal. <button className="link ml-2" onClick={() => nav('/journals/' + id)}>Open the record</button></Note>
  }

  return (
    <div>
      <PageHeader eyebrow="Journal engine" title={id ? 'Edit draft journal' : 'New journal'}
        subtitle="Nothing is posted from this screen. A draft is saved, submitted for approval, approved by a second person, and only then posted."
        actions={<button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>} />

      <Panel className="mb-4 p-5" lit={false}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Company">
            <select className="field" value={companyId} disabled={Boolean(id)} onChange={(e) => { setCompanyId(e.target.value); setRows([blank(), blank()]) }}>
              <option value="">Choose…</option>
              {companies.filter((c) => c.status === 'active' && can('journal.create', c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Voucher type">
            <select className="field" value={vtype} onChange={(e) => setVtype(e.target.value)}>
              {(vt.data ?? [{ key: 'journal', name: 'Journal Voucher' }]).filter((v) => !['reversal', 'sales', 'purchase', 'opening'].includes(v.key) || v.key === vtype).map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Confidentiality" hint={conf !== 'internal' ? 'Detail is hidden from uncleared users; totals still appear in every statement.' : undefined}>
            <select className="field" value={conf} onChange={(e) => setConf(e.target.value as Confidentiality)} disabled={!isAdmin && !can('vault.view', companyId)} title={!isAdmin && !can('vault.view', companyId) ? 'You are not cleared to create confidential records' : undefined}>
              {(['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only'] as const).map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Narration — what happened?" className="md:col-span-2"><input className="field" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Office rent for September — Coimbatore" /></Field>
          <Field label="Business purpose — why?" className="md:col-span-2"><input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Recorded with the entry and shown to the approver" /></Field>
        </div>
        {availableDims.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="eyebrow">Tag lines by</span>
            {availableDims.map((t) => (
              <button key={t.key} aria-pressed={dimTypes.includes(t.key)} onClick={() => setDimTypes((d) => (d.includes(t.key) ? d.filter((x) => x !== t.key) : [...d, t.key]))}
                className={cx('chip cursor-pointer', dimTypes.includes(t.key) && 'gold')}>{t.name}</button>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="mb-4 overflow-hidden" lit={false}>
        <div className="overflow-auto">
          <table className="table dense" style={{ minWidth: 900 + dimTypes.length * 150 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th><th style={{ minWidth: 250 }}>Ledger account</th><th style={{ minWidth: 190 }}>Party</th>
                {dimTypes.map((t) => <th key={t} style={{ minWidth: 150 }}>{ut.data?.find((x) => x.key === t)?.name ?? t}</th>)}
                <th style={{ minWidth: 200 }}>Line description</th><th className="r" style={{ width: 150 }}>Debit</th><th className="r" style={{ width: 150 }}>Credit</th><th style={{ width: 78 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="num text-muted">{i + 1}</td>
                  <td>
                    <select className="field sm" value={r.account_id} onChange={(e) => set(r.key, { account_id: e.target.value })} aria-label={`Line ${i + 1} account`}>
                      <option value="">Choose account…</option>
                      {(['asset', 'liability', 'equity', 'income', 'expense'] as const).map((t) => (
                        <optgroup key={t} label={t.toUpperCase()}>{accs.filter((a) => a.type === t).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="field sm" value={r.party_id} onChange={(e) => set(r.key, { party_id: e.target.value })} aria-label={`Line ${i + 1} party`}>
                      <option value="">—</option>
                      {pts.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}
                    </select>
                  </td>
                  {dimTypes.map((t) => (
                    <td key={t}>
                      <select className="field sm" value={r.dims[t] ?? ''} onChange={(e) => { const dims = { ...r.dims }; if (e.target.value) dims[t] = e.target.value; else delete dims[t]; set(r.key, { dims }) }} aria-label={`Line ${i + 1} ${t}`}>
                        <option value="">—</option>
                        {units.filter((u) => u.type_key === t).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                  ))}
                  <td><input className="field sm" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} placeholder={narration || 'Optional'} aria-label={`Line ${i + 1} description`} /></td>
                  <td><input className="field sm num text-right" inputMode="decimal" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value.replace(/[^\d.]/g, ''), credit: e.target.value ? '' : r.credit })} onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) addRow() }} placeholder="0.00" aria-label={`Line ${i + 1} debit`} /></td>
                  <td><input className="field sm num text-right" inputMode="decimal" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value.replace(/[^\d.]/g, ''), debit: e.target.value ? '' : r.debit })} onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) addRow() }} placeholder="0.00" aria-label={`Line ${i + 1} credit`} /></td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn ghost icon sm" title="Fill this line with the balancing amount" onClick={() => balanceInto(r.key)} aria-label="Balance into this line"><Scale size={13} /></button>
                      <button className="btn ghost icon sm" title="Duplicate line" onClick={() => setRows((rs) => { const at = rs.findIndex((x) => x.key === r.key); const c = [...rs]; c.splice(at + 1, 0, { ...r, key: ++k }); return c })} aria-label="Duplicate line"><Copy size={13} /></button>
                      <button className="btn ghost icon sm" title="Remove line" disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove line"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4 + dimTypes.length} className="px-3 py-3"><button className="btn sm" onClick={addRow}><Plus size={13} /> Add line</button></td>
                <td className="r px-3 py-3"><div className="eyebrow">Total debit</div><div className="num text-[14px]">{fmtMoney(totalDr, { currency: company?.base_currency })}</div></td>
                <td className="r px-3 py-3"><div className="eyebrow">Total credit</div><div className="num text-[14px]">{fmtMoney(totalCr, { currency: company?.base_currency })}</div></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <Panel className="p-4" lit={false} attention={!balanced && totalDr.plus(totalCr).gt(0)}>
          <div className="flex flex-wrap items-center gap-4">
            <span className={cx('lamp', balanced ? 'pos' : 'warn', !balanced && 'pulse')} />
            <div>
              <div className={cx('display text-[15px] font-medium', balanced ? 'text-pos' : 'text-warn')}>{balanced ? 'Balanced — debits equal credits' : totalDr.plus(totalCr).isZero() ? 'Enter the lines' : 'Not balanced'}</div>
              {!balanced && !diff.isZero() && <div className="text-[12.5px] text-ink2">Difference <Money value={diff.abs()} currency={company?.base_currency} /> — {diff.gt(0) ? 'credits are short' : 'debits are short'}. An unbalanced journal can be saved as a draft but can never be submitted or posted.</div>}
            </div>
          </div>
          {problems.length > 0 && totalDr.plus(totalCr).gt(0) && (
            <ul className="mb-0 mt-3 list-none space-y-1 p-0 text-[12.5px] text-ink2">{problems.slice(0, 6).map((p) => <li key={p} className="flex gap-2"><span className="text-warn">•</span>{p}</li>)}</ul>
          )}
          {balanced && !narration.trim() && <div className="mt-2 text-[12.5px] text-warn">Add a narration so the approver and the auditor know what this entry is.</div>}
        </Panel>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn" disabled={busy || !companyId || filled.length === 0 || filled.some((r) => !r.account_id)} onClick={() => void save(false)}>{busy ? <Spinner /> : <Save size={15} />} Save draft</button>
          <button className="btn primary" disabled={busy || !canSubmit || !can('journal.submit', companyId)} title={!can('journal.submit', companyId) ? 'You are not authorised to submit journals' : undefined} onClick={() => void save(true)}>{busy ? <Spinner /> : <Send size={15} />} Submit for approval</button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted"><Check size={13} className="text-pos" /> Press Enter in the last amount field to add a line. The scale button fills the balancing amount.</div>
    </div>
  )
}
