import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Ban, Check, CornerUpLeft, FileText, Lock, PenLine, Send, Sparkles, Stamp, Undo2, X } from 'lucide-react'
import { can, useApp } from '@/store/app'
import { useAction, useAsync } from '@/hooks/useAsync'
import { D, sum } from '@/lib/money'
import { fmtDate, fmtDateTime, today } from '@/lib/dates'
import { ledgerLink } from '@/lib/data'
import { cx, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, ReasonDialog, Section, StatusChip } from '@/ui/kit'

/** One journal, with its full responsibility chain and the answers to WHAT / WHO / WHERE / WHY / WHEN / HOW / PROOF. */
export default function JournalDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const api = useApp((s) => s.api)!
  const askNumi = useApp((s) => s.askNumi)
  const { act, busy } = useAction()
  const [dlg, setDlg] = useState<'' | 'reject' | 'cancel' | 'reverse' | 'approve'>('')
  const [revDate, setRevDate] = useState(today())
  const [comment, setComment] = useState('')

  const res = useAsync(() => api.openJournal(id), [api, id])
  const src = useAsync(async () => {
    const j = res.data
    if (!j || j.restricted || !j.source_id) return null
    if (j.source === 'invoice') { const i = await api.getInvoice(j.source_id); return { label: `${i.doc_type === 'sales_invoice' || i.doc_type === 'credit_note' ? 'Invoice' : 'Bill'} ${i.doc_no ?? ''}`, to: (i.doc_type === 'sales_invoice' || i.doc_type === 'credit_note' ? '/invoices/' : '/bills/') + i.id } }
    if (j.source === 'payment' || j.source === 'receipt') return { label: j.source === 'receipt' ? 'Receipt record' : 'Payment record', to: '/payments?open=' + j.source_id }
    if (j.source === 'reversal') return { label: 'Original journal', to: '/journals/' + j.source_id }
    return null
  }, [api, res.data?.id, res.data?.source_id])

  if (res.error) return <ErrorBox message={res.error} retry={res.reload} />
  if (!res.data) return <Panel><Loading rows={7} /></Panel>
  const j = res.data

  if (j.restricted) {
    return (
      <div>
        <PageHeader eyebrow="Journal" title="Restricted record" actions={<button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>} />
        <Panel><Empty icon={<Lock size={20} />} title="RESTRICTED" body="Your account is not authorised to view this record. It is fully included in the ledgers and financial statements; only its detail is restricted. This access attempt has been logged." /></Panel>
      </div>
    )
  }

  const dr = sum(j.lines.map((l) => l.debit)), cr = sum(j.lines.map((l) => l.credit))
  const who = (uid?: string | null) => (uid ? j.people[uid] ?? 'Unknown user' : null)
  const co = j.company_id
  const done = (msg: string) => () => { setDlg(''); setComment(''); return msg }

  const chain: { label: string; who: string | null; at?: string | null; icon: ReactNode; done: boolean }[] = [
    { label: 'Created by', who: who(j.created_by), at: j.created_at, icon: <PenLine size={14} />, done: true },
    { label: 'Submitted by', who: who(j.submitted_by), at: j.submitted_at, icon: <Send size={14} />, done: Boolean(j.submitted_at) },
    { label: 'Approved by', who: who(j.approved_by), at: j.approved_at, icon: <BadgeCheck size={14} />, done: Boolean(j.approved_at) },
    { label: 'Posted by', who: who(j.posted_by), at: j.posted_at, icon: <Stamp size={14} />, done: Boolean(j.posted_at) },
  ]
  const dims = [...new Set(j.lines.flatMap((l) => Object.entries(l.dims).map(([t, u]) => `${t.replace(/_/g, ' ')}: ${u.name}`)))]
  const partiesIn = [...new Map(j.lines.filter((l) => l.party_id).map((l) => [l.party_id!, l.party_name])).entries()]

  return (
    <div>
      <PageHeader eyebrow={`${j.voucher_type.replace(/_/g, ' ')} · ${j.company_name}`} title={j.voucher_no ?? 'Draft journal'}
        subtitle={j.narration ?? 'No narration recorded'}
        actions={<>
          <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft size={15} /> Back</button>
          <button className="btn" onClick={() => askNumi(`Explain journal ${j.voucher_no ?? ''}: ${j.narration ?? ''}`)}><Sparkles size={15} className="text-gold" /> Ask NUMI</button>
          {(j.status === 'draft' || j.status === 'rejected') && <button className="btn" disabled={!can('journal.create', co)} onClick={() => nav(`/journals/${j.id}/edit`)}><PenLine size={15} /> Edit</button>}
          {j.status === 'draft' && <button className="btn primary" disabled={busy || !can('journal.submit', co) || !dr.eq(cr) || dr.isZero()} title={!dr.eq(cr) ? 'An unbalanced journal cannot be submitted' : undefined}
            onClick={() => void act(() => api.submitJournal(j.id), 'Submitted for approval')}><Send size={15} /> Submit for approval</button>}
          {j.status === 'submitted' && <>
            <button className="btn danger" disabled={busy || !can('journal.reject', co)} onClick={() => setDlg('reject')}><X size={15} /> Reject</button>
            <button className="btn good" disabled={busy || !can('journal.approve', co)} title={can('journal.approve', co) ? undefined : 'You are not authorised to approve journals'} onClick={() => setDlg('approve')}><Check size={15} /> Approve</button>
          </>}
          {j.status === 'approved' && <button className="btn primary" disabled={busy || !can('journal.post', co)} onClick={() => void act(() => api.postJournal(j.id), (v) => `Posted as ${v}`)}><Stamp size={15} /> Post to ledger</button>}
          {['draft', 'rejected', 'submitted', 'approved'].includes(j.status) && <button className="btn ghost" disabled={busy} onClick={() => setDlg('cancel')}><Ban size={15} /> Cancel</button>}
          {j.status === 'posted' && !j.reversal_of && <button className="btn danger" disabled={busy || !can('journal.reverse', co)} title={can('journal.reverse', co) ? 'Posts an equal and opposite journal; the original is kept' : 'You are not authorised to reverse journals'} onClick={() => setDlg('reverse')}><Undo2 size={15} /> Reverse</button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip status={j.status} />
        <span className="chip">{fmtDate(j.journal_date)}</span>
        <span className={cx('chip', j.origin === 'ai_suggested' ? 'violet' : '')} title="Where the entry came from">{j.origin === 'ai_suggested' ? 'Proposed by NUMI, approved by a person' : j.origin === 'system' ? 'Generated from a business event' : j.origin === 'import' ? 'Imported' : 'Entered by a person'}</span>
        {j.confidentiality !== 'internal' && <span className="chip gold"><Lock size={10} /> {j.confidentiality.replace(/_/g, ' ')}</span>}
        {j.reversed_by && <button className="chip violet cursor-pointer" onClick={() => nav('/journals/' + j.reversed_by)}>Reversed by another journal →</button>}
        {j.reversal_of && <button className="chip violet cursor-pointer" onClick={() => nav('/journals/' + j.reversal_of)}>← Reversal of an earlier journal</button>}
      </div>

      {j.status === 'posted' && <Note kind="good" className="mb-4">This entry is posted and permanent. It cannot be edited or deleted. If it is wrong, reverse it and post a correct entry — both remain visible.</Note>}
      {j.status === 'rejected' && <Note kind="warn" className="mb-4">This journal was rejected. It can be edited and submitted again.</Note>}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Panel className="overflow-hidden" lit={false}>
            <div className="overflow-auto">
              <table className="table">
                <thead><tr><th style={{ width: 40 }}>#</th><th>Ledger account</th><th>Party</th><th>Tags</th><th>Description</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                <tbody>
                  {j.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num text-muted">{l.line_no}</td>
                      <td><span className="drill" onClick={() => nav(ledgerLink({ accounts: [l.account_id] }))}><span className="num text-[11.5px] text-gold">{l.account_code}</span> {l.account_name}</span></td>
                      <td>{l.party_id ? <span className="drill" onClick={() => nav('/parties/' + l.party_id)}>{l.party_name}</span> : <span className="text-muted">—</span>}</td>
                      <td><div className="flex flex-wrap gap-1">{Object.entries(l.dims).map(([t, u]) => <span key={t} className="chip cursor-pointer" title={t.replace(/_/g, ' ')} onClick={() => nav(ledgerLink({ unit: u.id }))}>{u.name}</span>)}</div></td>
                      <td className="text-ink2">{l.description ?? ''}{l.txn_currency && l.txn_currency !== 'INR' && l.txn_amount != null && <div className="num text-[11px] text-muted">{l.txn_currency} {D(l.txn_amount).toFixed(2)} @ {D(l.fx_rate).toString()}</div>}</td>
                      <td className="r">{D(l.debit).isZero() ? '' : <Money value={l.debit} />}</td>
                      <td className="r">{D(l.credit).isZero() ? '' : <Money value={l.credit} />}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="px-3.5 py-3"><span className={cx('flex items-center gap-2 text-[12.5px]', dr.eq(cr) ? 'text-pos' : 'text-neg')}><span className={cx('lamp', dr.eq(cr) ? 'pos' : 'neg')} />{dr.eq(cr) ? 'Debits equal credits' : 'NOT BALANCED — this entry cannot be posted'}</span></td>
                    <td className="r px-3.5 py-3"><Money value={dr} className="font-semibold" /></td>
                    <td className="r px-3.5 py-3"><Money value={cr} className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Section title="The why engine — what this entry answers">
            <Panel className="p-4" lit={false}>
              <div className="grid gap-x-6 gap-y-3.5 md:grid-cols-2">
                <Why q="What happened?" a={j.narration ?? 'Not recorded'} missing={!j.narration} />
                <Why q="Why — business purpose?" a={j.purpose ?? 'Not recorded'} missing={!j.purpose} />
                <Why q="Where — company and tags?" a={[j.company_name, ...dims].join(' · ')} />
                <Why q="Who — counterparty?" a={partiesIn.length ? partiesIn.map(([, n]) => n).join(', ') : 'No party attached'} missing={!partiesIn.length} />
                <Why q="When?" a={`Dated ${fmtDate(j.journal_date)}${j.posted_at ? ' · posted ' + fmtDateTime(j.posted_at) : ''}`} />
                <Why q="How — through which account?" a={j.lines.filter((l) => /bank|cash/i.test(l.account_name)).map((l) => l.account_name).join(', ') || 'No bank or cash account involved'} />
                <Why q="Proof — source document?" a={src.data ? src.data.label : j.source === 'manual' ? 'Manual entry — no source document linked' : `Source: ${j.source}`} missing={!src.data && j.source === 'manual'} to={src.data?.to} nav={nav} />
                <Why q="Rule applied?" a={j.source === 'invoice' ? 'InvoiceApproved → control account, revenue or expense, tax' : j.source === 'receipt' ? 'PaymentReceived → debit bank, credit receivable' : j.source === 'payment' ? 'PaymentMade → debit payable, credit bank' : j.source === 'reversal' ? 'Reversal → equal and opposite of the original' : 'Entered directly as a journal'} />
              </div>
              {(!j.purpose || (!src.data && j.source === 'manual')) && <div className="mt-3 text-[11.5px] text-muted">Document attachment is planned for the next phase; until then, record the reference of the supporting document in the narration.</div>}
            </Panel>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Responsibility chain">
            <Panel className="p-4" lit={false}>
              {chain.map((c, i) => (
                <div key={c.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cx('grid h-7 w-7 place-items-center rounded-full border', c.done ? 'border-gold/40 bg-goldsoft text-gold' : 'border-line text-muted')}>{c.icon}</span>
                    {i < chain.length - 1 && <span className={cx('my-1 w-px flex-1', c.done ? 'bg-gold/40' : 'bg-line')} style={{ minHeight: 18 }} />}
                  </div>
                  <div className="pb-3">
                    <div className="eyebrow">{c.label}</div>
                    <div className={cx('text-[13px]', c.done ? 'text-ink' : 'text-muted')}>{c.done ? c.who ?? 'Recorded' : 'Not yet'}</div>
                    {c.done && c.at && <div className="num text-[11px] text-muted">{fmtDateTime(c.at)}</div>}
                  </div>
                </div>
              ))}
            </Panel>
          </Section>

          {j.approvals.length > 0 && (
            <Section title="Approval decisions">
              <Panel className="p-1.5" lit={false}>
                {j.approvals.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg px-2.5 py-2">
                    <span className={cx('lamp mt-[6px]', a.action === 'reject' ? 'neg' : a.action === 'override' ? 'warn' : 'pos')} />
                    <div className="min-w-0 text-[12.5px]">
                      <div><b className="font-medium text-ink">{a.actor}</b> <span className="text-ink2">{a.action === 'override' ? 'approved their own entry (Owner override)' : a.action === 'approve' ? 'approved' : 'rejected'}</span> <span className="text-muted">· step {a.step}</span></div>
                      {a.comment && <div className="text-ink2">“{a.comment}”</div>}
                      <div className="num text-[11px] text-muted">{fmtDateTime(a.at)}</div>
                    </div>
                  </div>
                ))}
              </Panel>
            </Section>
          )}

          <Section title="History — nothing here can be erased">
            <Panel className="max-h-[340px] overflow-auto p-1.5" lit={false}>
              {j.history.length ? j.history.map((h, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg px-2.5 py-2">
                  <FileText size={13} className="mt-[3px] flex-none text-muted" />
                  <div className="min-w-0 text-[12.5px]">
                    <div><span className="text-ink">{h.action.replace(/_/g, ' ')}</span>{h.actor && <span className="text-muted"> · {h.actor}</span>}</div>
                    {h.reason && <div className="text-ink2">Reason: {h.reason}</div>}
                    <div className="num text-[11px] text-muted">{fmtDateTime(h.at)}</div>
                  </div>
                </div>
              )) : <div className="px-3 py-5 text-center text-[12.5px] text-muted">No history entries are visible to your account.</div>}
            </Panel>
          </Section>
        </div>
      </div>

      <Modal open={dlg === 'approve'} onClose={() => setDlg('')} title="Approve this journal" width={500}
        footer={<><button className="btn ghost" onClick={() => setDlg('')}>Cancel</button><button className="btn good" disabled={busy} onClick={() => void act(async () => { const r = await api.approveJournal(j.id, comment.trim() || undefined); setDlg(''); setComment(''); return r }, (r) => (r === 'approved' ? 'Approved — ready to post' : 'Approved this step; a further approval is required'))}><Check size={15} /> Approve</button></>}>
        <div className="mb-3 text-[13px] text-ink2">You are approving <b className="text-ink">{j.narration}</b> for <Money value={dr} />. Your name and the time are recorded permanently.</div>
        <Note className="mb-3">The person who created an entry cannot approve it, unless the Owner has explicitly enabled Owner self-approval. The engine enforces this.</Note>
        <Field label="Comment (optional)"><textarea className="field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </Modal>
      <ReasonDialog open={dlg === 'reject'} title="Reject this journal" confirm="Reject" danger onCancel={() => setDlg('')} onConfirm={(r) => void act(() => api.rejectJournal(j.id, r).then(done('')), 'Rejected')} body="The maker will see your reason and can correct and resubmit the entry." />
      <ReasonDialog open={dlg === 'cancel'} title="Cancel this journal" confirm="Cancel journal" danger required={false} onCancel={() => setDlg('')} onConfirm={(r) => void act(() => api.cancelJournal(j.id, r).then(done('')), 'Cancelled')} body="A cancelled draft is kept in history with its audit record; it is never deleted." />
      <ReasonDialog open={dlg === 'reverse'} title={`Reverse ${j.voucher_no}`} confirm="Post reversal" danger onCancel={() => setDlg('')}
        onConfirm={(r) => void act(async () => { const nid = await api.reverseJournal(j.id, revDate, r); setDlg(''); nav('/journals/' + nid); return nid }, 'Reversal posted')}
        body={<>An equal and opposite journal for <Money value={dr} /> will be posted. The original stays in the books, marked as reversed.</>}
        extra={<Field label="Reversal date" className="mb-3" hint="Must fall in an open accounting period."><input type="date" className="field" value={revDate} onChange={(e) => setRevDate(e.target.value)} /></Field>} />
    </div>
  )
}

function Why({ q, a, missing, to, nav }: { q: string; a: string; missing?: boolean; to?: string; nav?: (to: string) => void }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{q}</div>
      <div className={cx('text-[13px]', missing ? 'text-warn' : 'text-ink')}>
        {to && nav ? <span className="drill inline-flex items-center gap-1" onClick={() => nav(to)}>{a} <CornerUpLeft size={11} className="rotate-180" /></span> : a}
      </div>
    </div>
  )
}
