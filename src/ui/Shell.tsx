import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, ArrowLeftRight, BadgeCheck, Banknote, BookOpen, BookText, Boxes, Building2, Calculator, CalendarClock, ChevronDown, ChevronsLeft, ClipboardList, Coins, Compass, Eye, EyeOff,
  FileBarChart2, FileInput, FileOutput, FolderKanban, Gauge, HandCoins, History, Inbox, Landmark, LayoutDashboard, ListChecks, ListTree, Lock, LogOut, Moon, Network, PenLine, PiggyBank, Radar, Receipt,
  ScrollText, Search, Settings, ShieldAlert, ShoppingCart, Sparkles, Sun, Users, UsersRound, Vault, Wallet, Wand2, X,
} from 'lucide-react'
import { can, useApp, usePeriod, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { fmtDate, today, type PeriodKey } from '@/lib/dates'
import { cx, KeyHint, Logo, Wordmark } from './kit'
import { VoiceOrb } from '@/voice/VoiceControl'

// `perm`: the entry is shown only to people who hold that permission in a company they can see.
interface Item { to: string; label: string; icon: ReactNode; badge?: 'approvals' | 'alerts' | 'tasks'; end?: boolean; perm?: string | string[] }
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Command', items: [
    { to: '/', label: 'Command Centre', icon: <LayoutDashboard size={16} />, end: true },
    { to: '/cockpit', label: 'Cockpit', icon: <Gauge size={16} /> },
    { to: '/money-map', label: 'Money Map', icon: <Network size={16} /> },
    { to: '/forward', label: 'Forward', icon: <Compass size={16} /> },
    { to: '/registers', label: 'Registers', icon: <FolderKanban size={16} />, perm: 'register.view' },
  ] },
  { group: 'Transact', items: [
    { to: '/entry', label: 'Transaction Centre', icon: <Wand2 size={16} /> },
    { to: '/journals', label: 'Journals', icon: <PenLine size={16} /> },
    { to: '/invoices', label: 'Sales & Billing', icon: <FileOutput size={16} /> },
    { to: '/bills', label: 'Purchase Bills', icon: <FileInput size={16} /> },
    { to: '/payments', label: 'Payments & Receipts', icon: <Banknote size={16} /> },
    { to: '/banking', label: 'Banking', icon: <Landmark size={16} /> },
  ] },
  { group: 'Operate', items: [
    { to: '/expenses', label: 'Expenses & Advances', icon: <HandCoins size={16} />, perm: ['expense.view', 'expense.approve', 'expense.create'] },
    { to: '/purchasing', label: 'Purchasing', icon: <ShoppingCart size={16} />, perm: ['purchase.view', 'purchase.create'] },
    { to: '/cash', label: 'Cash & Transfers', icon: <ArrowLeftRight size={16} />, perm: ['treasury.view', 'expense.approve'] },
    { to: '/treasury', label: 'Treasury', icon: <PiggyBank size={16} />, perm: 'treasury.view' },
    { to: '/assets', label: 'Fixed Assets', icon: <Boxes size={16} />, perm: 'asset.view' },
    { to: '/payroll', label: 'Payroll', icon: <Coins size={16} />, perm: 'payroll.view' },
    { to: '/people-cost', label: 'People Cost', icon: <UsersRound size={16} />, perm: 'payroll.view' },
  ] },
  { group: 'Books', items: [
    { to: '/ledger', label: 'General Ledger', icon: <BookText size={16} /> },
    { to: '/accounts', label: 'Chart of Accounts', icon: <ListTree size={16} /> },
    { to: '/reports', label: 'Reports', icon: <FileBarChart2 size={16} /> },
    { to: '/budgets', label: 'Budgets', icon: <Wallet size={16} /> },
    { to: '/close', label: 'Period Close', icon: <Lock size={16} /> },
  ] },
  { group: 'People', items: [
    { to: '/parties', label: 'People & Parties', icon: <Users size={16} /> },
  ] },
  { group: 'Control', items: [
    { to: '/approvals', label: 'Approvals', icon: <BadgeCheck size={16} />, badge: 'approvals' },
    { to: '/tasks', label: 'Follow-ups', icon: <ListChecks size={16} />, badge: 'tasks' },
    { to: '/inbox', label: 'Document Inbox', icon: <Inbox size={16} />, perm: ['document.view', 'document.upload'] },
    { to: '/sentinel', label: 'Sentinel', icon: <Radar size={16} />, badge: 'alerts' },
    { to: '/audit', label: 'Audit Trail', icon: <ScrollText size={16} /> },
    { to: '/vault', label: 'Black Vault', icon: <Vault size={16} /> },
  ] },
  { group: 'Build', items: [
    { to: '/companies', label: 'Companies', icon: <Building2 size={16} /> },
    { to: '/genesis', label: 'Genesis Builder', icon: <Activity size={16} /> },
    { to: '/team', label: 'Team & Access', icon: <ShieldAlert size={16} /> },
    { to: '/calculators', label: 'Calculators', icon: <Calculator size={16} /> },
    { to: '/requirements', label: 'Requirement Ledger', icon: <ClipboardList size={16} /> },
    { to: '/settings', label: 'Settings', icon: <Settings size={16} /> },
  ] },
]
export const ALL_NAV = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })))

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: 'this_quarter', label: 'This quarter' }, { key: 'last_quarter', label: 'Last quarter' },
  { key: 'fy', label: 'This financial year' }, { key: 'last_fy', label: 'Last financial year' }, { key: 'last_12', label: 'Last 12 months' }, { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom range' },
]

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [open])
  return { open, setOpen, ref }
}

const Pop = ({ children, align = 'left', width = 300 }: { children: ReactNode; align?: 'left' | 'right'; width?: number }) => (
  <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}
    className={cx('panel absolute top-[calc(100%+8px)] z-50 overflow-hidden p-1.5', align === 'right' ? 'right-0' : 'left-0')} style={{ width, background: 'var(--surface-solid)' }}>
    {children}
  </motion.div>
)

function CompanySwitcher() {
  const companies = useApp((s) => s.companies)
  const scope = useApp((s) => s.scope)
  const setScope = useApp((s) => s.setScope)
  const group = useApp((s) => s.session?.group)
  const { open, setOpen, ref } = usePopover()
  const [q, setQ] = useState('')
  const active = companies.filter((c) => c.status === 'active')
  const list = active.filter((c) => (c.name + c.code).toLowerCase().includes(q.toLowerCase()))
  const label = scope.length === 0 ? `${group?.name ?? 'Group'} · all companies` : scope.length === 1 ? companies.find((c) => c.id === scope[0])?.name ?? '' : `${scope.length} companies`
  const toggle = (id: string) => setScope(scope.includes(id) ? scope.filter((x) => x !== id) : [...scope, id])
  return (
    <div className="relative" ref={ref}>
      <button className="btn max-w-[260px] min-w-0" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title="Choose which companies you are looking at">
        <span className={cx('lamp', scope.length ? 'cyan' : 'gold')} />
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="flex-none text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <Pop width={330}>
            <input className="field sm mb-1.5" placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <button className={cx('navlink w-full', scope.length === 0 && 'active')} onClick={() => { setScope([]); setOpen(false) }}>
              <Building2 size={15} /><span className="flex-1 text-left">{group?.name ?? 'Group'} — consolidated view</span><span className="num text-[11px] text-muted">{active.length}</span>
            </button>
            <div className="hairline my-1.5" />
            <div className="max-h-[300px] overflow-auto">
              {list.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <button className={cx('navlink min-w-0 flex-1', scope.length === 1 && scope[0] === c.id && 'active')} onClick={() => { setScope([c.id]); setOpen(false) }}>
                    <span className="num w-12 flex-none text-[10.5px] text-gold">{c.code}</span><span className="truncate">{c.name}</span>
                  </button>
                  <input type="checkbox" className="mr-2 h-3.5 w-3.5 accent-[var(--gold)]" checked={scope.includes(c.id)} onChange={() => toggle(c.id)} title="Include in a multi-company selection" aria-label={`Include ${c.name}`} />
                </div>
              ))}
              {!list.length && <div className="px-3 py-4 text-center text-[12.5px] text-muted">No company matches.</div>}
            </div>
          </Pop>
        )}
      </AnimatePresence>
    </div>
  )
}

function PeriodPicker() {
  const period = usePeriod()
  const key = useApp((s) => s.periodKey)
  const custom = useApp((s) => s.custom)
  const setPeriod = useApp((s) => s.setPeriod)
  const asOf = useApp((s) => s.asOf)
  const setAsOf = useApp((s) => s.setAsOf)
  const { open, setOpen, ref } = usePopover()
  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} title={`${fmtDate(period.from)} – ${fmtDate(period.to)}`}>
        <CalendarClock size={15} className="text-muted" />
        <span>{period.label}</span>
        {asOf && <span className="chip violet">as of {fmtDate(asOf)}</span>}
        <ChevronDown size={14} className="text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <Pop width={310}>
            {PERIODS.map((p) => (
              <button key={p.key} className={cx('navlink w-full', key === p.key && 'active')} onClick={() => { setPeriod(p.key); if (p.key !== 'custom') setOpen(false) }}>{p.label}</button>
            ))}
            {key === 'custom' && (
              <div className="grid grid-cols-2 gap-2 px-1.5 pb-1 pt-2">
                <label><span className="label">From</span><input type="date" className="field sm" value={custom.from} max={custom.to} onChange={(e) => setPeriod('custom', { ...custom, from: e.target.value })} /></label>
                <label><span className="label">To</span><input type="date" className="field sm" value={custom.to} min={custom.from} onChange={(e) => setPeriod('custom', { ...custom, to: e.target.value })} /></label>
              </div>
            )}
            <div className="hairline my-1.5" />
            <div className="px-1.5 pb-1.5">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] text-ink2"><History size={14} className="text-violet" /> Time machine</div>
              <div className="flex items-center gap-2">
                <input type="date" className="field sm" value={asOf ?? ''} max={today()} onChange={(e) => setAsOf(e.target.value || null, e.target.value ? e.target.value + 'T23:59:59' : null)} aria-label="Show the books as of" />
                {asOf && <button className="btn sm ghost" onClick={() => setAsOf(null)}>Clear</button>}
              </div>
              <div className="mt-1.5 text-[11px] text-muted">Reconstructs every figure from the entries that existed on that date.</div>
            </div>
          </Pop>
        )}
      </AnimatePresence>
    </div>
  )
}

function UserMenu() {
  const session = useApp((s) => s.session)
  const mode = useApp((s) => s.mode)
  const leave = useApp((s) => s.leave)
  const nav = useNavigate()
  const { open, setOpen, ref } = usePopover()
  const initials = (session?.user.name ?? '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="relative" ref={ref}>
      <button className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-surface2 text-[11.5px] font-semibold text-gold transition-colors hover:border-gold" onClick={() => setOpen(!open)} aria-label="Account menu">{initials}</button>
      <AnimatePresence>
        {open && (
          <Pop align="right" width={260}>
            <div className="px-2.5 py-2">
              <div className="truncate text-[13px] font-medium">{session?.user.name}</div>
              <div className="truncate text-[12px] text-muted">{session?.user.email}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {session?.isGroupAdmin && <span className="chip gold">Group Super Admin</span>}
                <span className={cx('chip', mode === 'demo' ? 'gold' : 'pos')}>{mode === 'demo' ? 'Demo universe' : 'Live books'}</span>
              </div>
            </div>
            <div className="hairline my-1" />
            <button className="navlink w-full" onClick={() => { nav('/settings'); setOpen(false) }}><Settings size={15} /> Settings</button>
            <button className="navlink w-full" onClick={() => { void leave() }}><LogOut size={15} /> {mode === 'demo' ? 'Leave the demo' : 'Sign out'}</button>
          </Pop>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const mode = useApp((s) => s.mode)
  const api = useApp((s) => s.api)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const privacy = useApp((s) => s.privacy)
  const setPrivacy = useApp((s) => s.setPrivacy)
  const uiMode = useApp((s) => s.uiMode)
  const setUiMode = useApp((s) => s.setUiMode)
  const askNumi = useApp((s) => s.askNumi)
  const setPalette = useApp((s) => s.setPalette)
  const asOf = useApp((s) => s.asOf)
  const ids = useScopeIds()
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)

  const counts = useAsync(async () => {
    if (!api || !ids.length) return { approvals: 0, alerts: 0, tasks: 0 }
    const [a, b, t] = await Promise.all([api.listApprovalRequests(ids), api.listAlerts(ids), api.listTasks({ companyIds: ids }).catch(() => [])])
    return {
      approvals: a.filter((x) => x.status === 'pending').length,
      alerts: b.filter((x) => x.status === 'open' || x.status === 'reviewing').length,
      tasks: t.filter((x) => (x.status === 'open' || x.status === 'in_progress') && !!x.due_date && x.due_date < today()).length,
    }
  }, [api, ids.join(',')])

  useEffect(() => { setMobile(false) }, [loc.pathname])

  // keyboard: power users operate without menus (spec 63, 76)
  useEffect(() => {
    let g = 0
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); askNumi(); return }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); setPalette(true); return }
      const now = Date.now()
      if (e.key === 'g') { g = now; return }
      if (now - g < 900) {
        const map: Record<string, string> = { h: '/', j: '/journals', l: '/ledger', r: '/reports', p: '/parties', b: '/banking', a: '/approvals', s: '/sentinel', e: '/entry', c: '/cockpit', i: '/invoices' }
        if (map[e.key]) { e.preventDefault(); nav(map[e.key]) }
        g = 0
      }
      if (e.key === 'n') { e.preventDefault(); nav('/journals/new') }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [nav, setPalette, askNumi])

  const session = useApp((s) => s.session)
  const groups = useMemo(() => {
    const order = uiMode === 'accounting' ? ['Transact', 'Books', 'Operate', 'People', 'Control', 'Command', 'Build'] : NAV.map((g) => g.group)
    return order
      .map((name) => NAV.find((g) => g.group === name)!)
      .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || [i.perm].flat().some((p) => can(p))) }))
      .filter((g) => g.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode, session, ids.join(',')])

  const side = (
    <aside className={cx('no-print relative z-20 flex h-full flex-none flex-col border-r border-line bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] backdrop-blur-xl transition-[width] duration-300', collapsed ? 'w-[68px]' : 'w-[244px]')}>
      <div className={cx('flex h-[64px] flex-none items-center gap-3 border-b border-line', collapsed ? 'justify-center px-0' : 'px-4')}>
        <button onClick={() => nav('/')} className="flex items-center gap-3 bg-transparent p-0" style={{ border: 0 }} aria-label="GHL NUMERO home">
          <Logo size={34} />
          {!collapsed && <Wordmark />}
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3" aria-label="Main">
        {groups.map((g) => (
          <div key={g.group} className="mb-3.5">
            {!collapsed && <div className="eyebrow mb-1 px-2.5">{g.group}</div>}
            {g.items.map((i) => {
              const n = i.badge ? counts.data?.[i.badge] ?? 0 : 0
              return (
                <NavLink key={i.to} to={i.to} end={i.end} title={collapsed ? i.label : undefined} className={({ isActive }) => cx('navlink', isActive && 'active', collapsed && 'justify-center px-0')}>
                  <span className="relative">{i.icon}{collapsed && n > 0 && <span className="lamp warn pulse absolute -right-1 -top-1" style={{ width: 6, height: 6 }} />}</span>
                  {!collapsed && <span className="flex-1 truncate">{i.label}</span>}
                  {!collapsed && n > 0 && <span title={i.badge === 'tasks' ? 'Follow-ups past their due date' : undefined} className={cx('num rounded-full px-1.5 text-[10.5px] font-semibold', i.badge === 'approvals' ? 'bg-goldsoft text-gold' : 'bg-warnsoft text-warn')}>{n}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="flex-none border-t border-line p-2.5">
        <button className={cx('navlink w-full', collapsed && 'justify-center px-0')} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
          <ChevronsLeft size={16} className={cx('transition-transform duration-300', collapsed && 'rotate-180')} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )

  return (
    <div className="relative z-10 flex h-full w-full">
      <div className="hidden h-full lg:block">{side}</div>
      <AnimatePresence>
        {mobile && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobile(false)} />
            <motion.div className="absolute bottom-0 left-0 top-0" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} style={{ background: 'var(--bg)' }}>{side}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'demo' && (
          <div className="no-print flex flex-none items-center justify-center gap-2 border-b border-gold/25 bg-goldsoft px-4 py-[5px] text-center text-[11.5px] text-gold">
            <Sparkles size={13} />
            <span><b className="font-semibold tracking-wide">DEMO UNIVERSE</b> — every figure here is sample data held in this browser only. Nothing is saved to your real books.</span>
          </div>
        )}
        {asOf && (
          <div className="no-print flex flex-none items-center justify-center gap-2 border-b border-violet/25 px-4 py-[5px] text-center text-[11.5px] text-violet" style={{ background: 'color-mix(in srgb, var(--violet) 10%, transparent)' }}>
            <History size={13} /> <span><b className="font-semibold tracking-wide">TIME MACHINE</b> — showing the books as they stood on {fmtDate(asOf)}.</span>
          </div>
        )}
        <header className="no-print relative z-30 flex h-[64px] flex-none items-center gap-2.5 border-b border-line bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] px-4 backdrop-blur-xl">
          <button className="btn icon ghost lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu"><BookOpen size={17} /></button>
          <CompanySwitcher />
          <div className="hidden md:block"><PeriodPicker /></div>
          <button className="btn ghost ml-1 hidden min-w-[220px] flex-1 justify-start text-muted min-[1720px]:flex" style={{ maxWidth: 420 }} onClick={() => setPalette(true)}>
            <Search size={15} /> <span className="flex-1 text-left">Search NUMERO or type a command…</span> <KeyHint>Ctrl K</KeyHint>
          </button>
          <div className="min-w-0 flex-1 min-[1720px]:hidden" />
          <button className="btn icon ghost flex-none min-[1720px]:hidden" onClick={() => setPalette(true)} aria-label="Search" title="Search and commands (Ctrl K)"><Search size={16} /></button>

          <div className="hidden flex-none items-center rounded-[11px] border border-line bg-surface p-[3px] md:flex" role="group" aria-label="Interface mode">
            {(['command', 'accounting'] as const).map((m) => (
              <button key={m} onClick={() => setUiMode(m)} className={cx('relative h-[28px] rounded-lg px-3 text-[11.5px] font-medium uppercase tracking-[0.08em] transition-colors', uiMode === m ? 'text-ink' : 'text-muted hover:text-ink2')} aria-pressed={uiMode === m}
                title={m === 'command' ? 'Command mode — the owner\'s view' : 'Accounting mode — dense tables and fast entry'}>
                {uiMode === m && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-lg border border-line2 bg-surface2" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative">{m}</span>
              </button>
            ))}
          </div>

          <button className={cx('btn icon', privacy ? 'primary' : 'ghost')} onClick={() => setPrivacy(!privacy)} aria-pressed={privacy} aria-label="Privacy mode" title={privacy ? 'Privacy mode is ON — figures are hidden' : 'Hide all figures (privacy mode)'}>
            {privacy ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button className="btn icon ghost" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={(e) => setTheme(theme === 'dark' ? 'light' : 'dark', { x: e.clientX, y: e.clientY })}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -80, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 80, opacity: 0, scale: 0.6 }} transition={{ duration: 0.22 }} className="grid place-items-center">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <VoiceOrb />
          <button className="btn primary flex-none" onClick={() => askNumi()} title="Ask NUMI (Ctrl + /)"><Sparkles size={15} /> <span className="hidden sm:inline">Ask NUMI</span></button>
          <UserMenu />
        </header>

        <main className="relative min-h-0 flex-1 overflow-auto" id="main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
              className={cx('mx-auto w-full px-5 py-6', uiMode === 'accounting' ? 'max-w-none' : 'max-w-[1560px]')}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

export const CloseX = ({ onClick }: { onClick: () => void }) => <button className="btn ghost icon sm" onClick={onClick} aria-label="Close"><X size={15} /></button>
export { Receipt }
