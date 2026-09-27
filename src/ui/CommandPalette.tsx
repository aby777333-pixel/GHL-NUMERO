import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Building2, CornerDownLeft, FileText, Search, Sparkles, Terminal, User } from 'lucide-react'
import { useApp, useScopeIds } from '@/store/app'
import { useCommandRunner } from '@/voice/VoiceControl'
import { ROUTES } from '@/voice/commands'
import { fmtDate } from '@/lib/dates'
import { cx, KeyHint, Money, Portal, Spinner } from './kit'

interface Hit { id: string; kind: string; icon: ReactNode; title: string; sub?: string; right?: ReactNode; run: () => void }

/** Universal command palette and global search (spec 62, 63, 609, 627). Results are permission-aware
 *  because they come through the same data layer as every other screen. */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPalette)
  const api = useApp((s) => s.api)
  const companies = useApp((s) => s.companies)
  const parties = useApp((s) => s.parties)
  const accounts = useApp((s) => s.accounts)
  const setScope = useApp((s) => s.setScope)
  const askNumi = useApp((s) => s.askNumi)
  const ids = useScopeIds()
  const nav = useNavigate()
  const run = useCommandRunner()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [remote, setRemote] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setSel(0); setRemote([]); setTimeout(() => input.current?.focus(), 40) } }, [open])

  const done = (fn: () => void) => () => { fn(); setOpen(false) }

  const local = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase()
    const out: Hit[] = []
    const routes = ROUTES.filter((r) => !t || r.label.toLowerCase().includes(t) || r.keys.includes(t) || t.split(' ').every((w) => r.keys.includes(w) || r.label.toLowerCase().includes(w)))
    for (const r of routes.slice(0, t ? 6 : 9)) out.push({ id: 'r' + r.to, kind: 'Go to', icon: <ArrowRight size={15} />, title: r.label, run: done(() => nav(r.to)) })
    if (!t) return out
    for (const c of companies.filter((c) => (c.name + ' ' + c.code).toLowerCase().includes(t)).slice(0, 4)) {
      out.push({ id: 'c' + c.id, kind: 'Company', icon: <Building2 size={15} />, title: c.name, sub: `${c.code} · ${c.industry ?? 'Company'}`, run: done(() => { setScope([c.id]); nav('/') }) })
    }
    for (const p of parties.filter((p) => (p.display_name + ' ' + p.party_no + ' ' + (p.gstin ?? '') + ' ' + (p.pan ?? '')).toLowerCase().includes(t)).slice(0, 6)) {
      out.push({ id: 'p' + p.id, kind: 'Party', icon: <User size={15} />, title: p.display_name, sub: `${p.party_no} · ${[...new Set(p.roles.map((r) => r.type_key.replace(/_/g, ' ')))].join(', ')}`, run: done(() => nav('/parties/' + p.id)) })
    }
    for (const a of accounts.filter((a) => ids.includes(a.company_id) && !a.is_group && (a.name + ' ' + a.code).toLowerCase().includes(t)).slice(0, 5)) {
      out.push({ id: 'a' + a.id, kind: 'Ledger', icon: <FileText size={15} />, title: `${a.code} · ${a.name}`, sub: companies.find((c) => c.id === a.company_id)?.name, run: done(() => nav('/ledger?accounts=' + a.id)) })
    }
    return out
  }, [q, companies, parties, accounts, ids, nav, setScope]) // eslint-disable-line react-hooks/exhaustive-deps

  // transactions, invoices and amounts are searched in the ledger itself
  useEffect(() => {
    const t = q.trim()
    if (!open || !api || t.length < 3) { setRemote([]); return }
    let live = true
    setBusy(true)
    const h = setTimeout(async () => {
      try {
        const amount = Number(t.replace(/[,₹\s]/g, ''))
        const isAmount = Number.isFinite(amount) && amount > 0 && /^[\d,.₹\s]+$/.test(t)
        const [lines, invs] = await Promise.all([
          api.ledgerLines(isAmount ? { company_ids: ids, min_amount: amount, limit: 60 } : { company_ids: ids, q: t, limit: 8 }),
          api.listInvoices({ companyIds: ids }),
        ])
        if (!live) return
        const seen = new Set<string>()
        const hits: Hit[] = []
        for (const l of lines.rows) {
          if (isAmount && Number(l.debit) !== amount && Number(l.credit) !== amount) continue
          if (seen.has(l.journal_id)) continue
          seen.add(l.journal_id)
          hits.push({ id: 'j' + l.journal_id, kind: 'Transaction', icon: <Terminal size={15} />, title: l.narration ?? l.account_name, sub: `${l.voucher_no} · ${fmtDate(l.journal_date)} · ${l.company_name}`, right: <Money value={Number(l.debit) || Number(l.credit)} compact />, run: done(() => nav('/journals/' + l.journal_id)) })
          if (hits.length >= 6) break
        }
        for (const i of invs.filter((i) => ((i.doc_no ?? '') + ' ' + (i.reference ?? '')).toLowerCase().includes(t.toLowerCase())).slice(0, 5)) {
          hits.push({ id: 'i' + i.id, kind: i.doc_type === 'sales_invoice' ? 'Invoice' : 'Bill', icon: <FileText size={15} />, title: `${i.doc_no ?? 'Draft'}${i.reference ? ' · ' + i.reference : ''}`, sub: `${parties.find((p) => p.id === i.party_id)?.display_name ?? ''} · ${fmtDate(i.doc_date)}`, right: <Money value={i.total} currency={i.currency} compact />, run: done(() => nav((i.doc_type === 'sales_invoice' ? '/invoices/' : '/bills/') + i.id)) })
        }
        setRemote(hits)
      } catch { if (live) setRemote([]) } finally { if (live) setBusy(false) }
    }, 220)
    return () => { live = false; clearTimeout(h) }
  }, [q, open, api, ids.join(','), parties, nav]) // eslint-disable-line react-hooks/exhaustive-deps

  const typed = q.trim()
  const hits: Hit[] = [
    ...local,
    ...remote,
    ...(typed ? [
      { id: 'cmd', kind: 'Command', icon: <Terminal size={15} />, title: `Run “${typed}”`, sub: 'Interpreted exactly like a voice command', run: () => { const r = run(typed, 'text'); useApp.getState().toast(r.sensitive ? 'warn' : r.command.type === 'unknown' ? 'info' : 'ok', r.reply); setOpen(false) } },
      { id: 'ask', kind: 'NUMI', icon: <Sparkles size={15} />, title: `Ask NUMI: “${typed}”`, sub: 'Answered from your authorised books', run: done(() => askNumi(typed)) },
    ] : []),
  ]
  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, hits.length - 1))) }, [hits.length])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, hits.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + hits.length) % Math.max(1, hits.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); hits[sel]?.run() }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <motion.div className="no-print fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[7px]" onClick={() => setOpen(false)} />
          <motion.div role="dialog" aria-label="Search and commands" className="panel relative w-full max-w-[680px] overflow-hidden" style={{ background: 'var(--surface-solid)' }}
            initial={{ y: -14, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -8, scale: 0.985, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              {busy ? <Spinner size={17} /> : <Search size={17} className="text-muted" />}
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0) }} onKeyDown={key} placeholder="Search transactions, parties, invoices, amounts — or type a command"
                className="h-[54px] flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted" aria-label="Search NUMERO" />
              <KeyHint>Esc</KeyHint>
            </div>
            <div ref={list} className="max-h-[52vh] overflow-auto p-1.5">
              {hits.map((h, i) => (
                <button key={h.id} data-i={i} onMouseEnter={() => setSel(i)} onClick={h.run}
                  className={cx('flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors', sel === i ? 'bg-goldsoft' : 'bg-transparent')}>
                  <span className={cx('grid h-8 w-8 flex-none place-items-center rounded-lg border border-line', sel === i ? 'text-gold' : 'text-muted')}>{h.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{h.title}</span>
                    {h.sub && <span className="block truncate text-[11.5px] text-muted">{h.sub}</span>}
                  </span>
                  {h.right && <span className="flex-none text-[12.5px]">{h.right}</span>}
                  <span className="flex-none text-[10px] uppercase tracking-[0.12em] text-muted">{h.kind}</span>
                  {sel === i && <CornerDownLeft size={13} className="flex-none text-gold" />}
                </button>
              ))}
              {!hits.length && <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing found in the records you are permitted to see.</div>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span><KeyHint>↑</KeyHint> <KeyHint>↓</KeyHint> move</span><span><KeyHint>Enter</KeyHint> open</span>
              <span><KeyHint>g</KeyHint> then <KeyHint>j</KeyHint> journals · <KeyHint>l</KeyHint> ledger · <KeyHint>r</KeyHint> reports</span><span><KeyHint>n</KeyHint> new journal</span><span><KeyHint>Alt V</KeyHint> voice</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Portal>
  )
}
