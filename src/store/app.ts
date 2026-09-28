import { create } from 'zustand'
import type { NumeroApi } from '@/api/types'
import { SupabaseApi, liveConfigured } from '@/api/supabase'
import { authLinkIn, clearAuthLinkFromAddress } from '@/api/auth'
import type { Account, Company, ID, OrgUnit, Party, SessionInfo } from '@/engine/types'
import type { FeatureFlag } from '@/engine/p3Types'
import { capabilityOn } from '@/engine/features'
import { resolvePeriod, today, type Period, type PeriodKey } from '@/lib/dates'
import type { SandboxReport } from '@/lib/sandbox'
import { setExportMark } from '@/lib/data'

export type Theme = 'dark' | 'light'
export type UiMode = 'command' | 'accounting'
export type Effects = 'full' | 'subtle' | 'off'
export type Status = 'boot' | 'signed_out' | 'needs_bootstrap' | 'no_access' | 'ready' | 'error'

const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem('numero.' + k) ?? d } catch { return d } },
  set: (k: string, v: string) => { try { localStorage.setItem('numero.' + k, v) } catch { /* private mode */ } },
}

export interface Toast { id: number; kind: 'ok' | 'error' | 'info' | 'warn'; title: string; body?: string }

interface AppState {
  api: NumeroApi | null
  mode: 'demo' | 'live' | null
  status: Status
  error: string | null
  session: SessionInfo | null
  /** set while the person works in the sandbox: the real books wait here, untouched, until they leave */
  sandbox: { real: NumeroApi; scope: ID[]; report: SandboxReport } | null
  /** the person came back through a link to set a new password, and has not set it yet */
  recovery: boolean
  /** what an email link brought back that the sign-in page should say: an expired link, for instance */
  authMessage: string | null

  companies: Company[]
  accounts: Account[]
  parties: Party[]
  orgUnits: OrgUnit[]
  /** capabilities switched on or off for the group, a company or a role */
  flags: FeatureFlag[]
  /** the roles the person holds, company by company, where they can be read */
  roles: Record<ID, string[]>

  /** selected companies; empty = the whole authorised group */
  scope: ID[]
  periodKey: PeriodKey
  custom: { from: string; to: string }
  /** Time machine: view the books as of this date / as known at this moment */
  asOf: string | null
  knownAt: string | null

  theme: Theme
  uiMode: UiMode
  effects: Effects
  privacy: boolean
  simple: boolean
  voiceLang: string
  voiceReplies: boolean

  version: number
  toasts: Toast[]
  numiOpen: boolean
  numiSeed: string | null
  paletteOpen: boolean

  init(): Promise<void>
  enterDemo(): Promise<void>
  enterLive(): Promise<void>
  leave(): Promise<void>
  enterSandbox(): Promise<void>
  leaveSandbox(): Promise<void>
  sandboxActAs(person: ID): Promise<void>
  refreshSession(): Promise<void>
  refreshMaster(): Promise<void>
  endRecovery(): void
  touch(): void
  setScope(ids: ID[]): void
  setPeriod(k: PeriodKey, custom?: { from: string; to: string }): void
  setAsOf(date: string | null, knownAt?: string | null): void
  setTheme(t: Theme, origin?: { x: number; y: number }): void
  setUiMode(m: UiMode): void
  setEffects(e: Effects): void
  setPrivacy(p: boolean): void
  setSimple(s: boolean): void
  setVoice(lang: string, replies: boolean): void
  toast(kind: Toast['kind'], title: string, body?: string): void
  dismiss(id: number): void
  askNumi(seed?: string): void
  closeNumi(): void
  setPalette(open: boolean): void
}

let toastId = 0
let unsub: (() => void) | null = null

export const useApp = create<AppState>((set, get) => ({
  api: null, mode: null, status: 'boot', error: null, session: null, sandbox: null, recovery: false, authMessage: null,
  companies: [], accounts: [], parties: [], orgUnits: [], flags: [], roles: {},
  scope: [], periodKey: (ls.get('period', 'fy') as PeriodKey), custom: { from: today().slice(0, 8) + '01', to: today() },
  asOf: null, knownAt: null,
  theme: ls.get('theme', 'dark') as Theme,
  uiMode: ls.get('uimode', 'command') as UiMode,
  effects: ls.get('effects', 'full') as Effects,
  privacy: false,
  simple: ls.get('simple', '0') === '1',
  voiceLang: ls.get('voicelang', 'en-IN'),
  voiceReplies: ls.get('voicereplies', '1') === '1',
  version: 0, toasts: [], numiOpen: false, numiSeed: null, paletteOpen: false,

  async init() {
    const want = ls.get('mode', '')
    try {
      // a link from a confirmation or password email opens the live system, whatever this browser did before
      const link = liveConfigured ? authLinkIn(window.location.href) : null
      if (link?.present) {
        set({ recovery: link.recovery && !link.error, authMessage: link.error })
        if (link.error) { clearAuthLinkFromAddress(); ls.set('mode', 'live'); return set({ status: 'signed_out' }) }
        return await get().enterLive()
      }
      if (want === 'demo') return await get().enterDemo()
      if (want === 'live' && liveConfigured) return await get().enterLive()
      set({ status: 'signed_out' })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  async enterDemo() {
    set({ status: 'boot', error: null })
    // the demo engine and its sample data are loaded only when someone enters the demo
    const { getDemoEngine } = await import('@/api/demoSeed')
    const api = await getDemoEngine()
    await api.signIn()
    unsub?.(); unsub = null
    ls.set('mode', 'demo')
    set({ api, mode: 'demo', scope: [] })
    await get().refreshSession()
  },

  async enterLive() {
    if (!liveConfigured) throw new Error('The live database is not configured.')
    const api = new SupabaseApi()
    unsub?.()
    unsub = api.onAuthChange((event) => { if (event === 'PASSWORD_RECOVERY') set({ recovery: true }); void get().refreshSession() })
    ls.set('mode', 'live')
    set({ api, mode: 'live', scope: [] })
    await get().refreshSession()
    // the session an email link carried has been read: the link leaves the address bar
    if (authLinkIn(window.location.href).present) clearAuthLinkFromAddress()
  },

  async leave() {
    const { api } = get()
    try { await api?.signOut() } catch { /* already signed out */ }
    unsub?.(); unsub = null
    ls.set('mode', '')
    setExportMark('')
    set({ api: null, mode: null, session: null, sandbox: null, status: 'signed_out', companies: [], accounts: [], parties: [], orgUnits: [], scope: [], numiOpen: false, recovery: false, authMessage: null })
  },

  /**
   * The sandbox: a copy of the configuration and the balances, in the memory of this browser.
   * The real books are set aside, not changed; every screen then works on the copy.
   */
  async enterSandbox() {
    const { api, session, companies, sandbox, scope } = get()
    if (!api || !session || sandbox) return
    const { buildSandbox } = await import('@/lib/sandbox')
    const built = await buildSandbox(api, session, companies, can)
    setExportMark('SANDBOX')
    set({ api: built.engine, sandbox: { real: api, scope, report: built.report }, scope: [], asOf: null, knownAt: null, numiOpen: false })
    await get().refreshSession()
  },
  async leaveSandbox() {
    const { sandbox } = get()
    if (!sandbox) return
    // the copy is dropped with everything that was tried in it
    setExportMark('')
    set({ api: sandbox.real, sandbox: null, scope: sandbox.scope, numiOpen: false })
    await get().refreshSession()
  },
  async sandboxActAs(person) {
    const { api, sandbox } = get()
    if (!api || !sandbox) return
    ;(api as unknown as { actor: ID }).actor = person
    await get().refreshSession()
    get().touch()
  },

  async refreshSession() {
    const { api } = get()
    if (!api) return
    try {
      const session = await api.getSession()
      if (!session) return set({ session: null, status: 'signed_out' })
      if (!session.group) return set({ session, status: 'needs_bootstrap' })
      set({ session })
      await get().refreshMaster()
      set({ status: 'ready', error: null })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  endRecovery() { set({ recovery: false }) },

  async refreshMaster() {
    const { api } = get()
    if (!api) return
    const companies = await api.listCompanies()
    const ids = companies.map((c) => c.id)
    const [accounts, parties, orgUnits, flags, members] = await Promise.all([
      api.listAccounts(ids), api.listParties(), api.listOrgUnits(ids),
      // a person who may not read the switches or the team sees every capability their permissions allow
      api.listFeatureFlags().catch(() => []), api.listMembers().catch(() => []),
    ])
    const me = get().session?.user.id
    const roles: Record<ID, string[]> = {}
    for (const m of members) if (m.user_id === me) roles[m.company_id] = [...(roles[m.company_id] ?? []), m.role_key]
    const scope = get().scope.filter((id) => ids.includes(id))
    set({ companies, accounts, parties, orgUnits, flags, roles, scope, version: get().version + 1 })
  },

  touch: () => set({ version: get().version + 1 }),
  setScope: (scope) => set({ scope }),
  setPeriod: (periodKey, custom) => { ls.set('period', periodKey); set({ periodKey, custom: custom ?? get().custom }) },
  setAsOf: (asOf, knownAt = null) => set({ asOf, knownAt }),
  setTheme(theme, origin) {
    ls.set('theme', theme)
    const root = document.documentElement
    const apply = () => { root.className = theme + (get().effects === 'off' ? ' fx-off' : ''); set({ theme }) }
    type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> }
    const vt = (document as unknown as { startViewTransition?: (cb: () => void) => Transition }).startViewTransition
    const animate = origin && vt && get().effects !== 'off' && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animate) return apply()
    root.style.setProperty('--vx', origin.x + 'px')
    root.style.setProperty('--vy', origin.y + 'px')
    try {
      // the reveal is decoration: if the browser abandons it, the theme has still been applied
      const t = vt.call(document, apply)
      for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => undefined)
    } catch {
      apply()
    }
  },
  setUiMode: (uiMode) => { ls.set('uimode', uiMode); set({ uiMode }) },
  setEffects(effects) {
    ls.set('effects', effects)
    document.documentElement.classList.toggle('fx-off', effects === 'off')
    set({ effects })
  },
  setPrivacy: (privacy) => set({ privacy }),
  setSimple: (simple) => { ls.set('simple', simple ? '1' : '0'); set({ simple }) },
  setVoice: (voiceLang, voiceReplies) => { ls.set('voicelang', voiceLang); ls.set('voicereplies', voiceReplies ? '1' : '0'); set({ voiceLang, voiceReplies }) },
  toast(kind, title, body) {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, kind, title, body }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 9000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  askNumi: (seed) => {
    // a capability switched off is off wherever it is asked from
    if (!capOn('numi')) { get().toast('info', 'NUMI is switched off', 'A Group Super Admin can switch it on under System Health, Capabilities.'); return }
    set({ numiOpen: true, numiSeed: seed ?? null })
  },
  closeNumi: () => set({ numiOpen: false, numiSeed: null }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
}))

// ------------------------------------------------------------------ selectors
export const useScopeIds = (): ID[] => {
  const scope = useApp((s) => s.scope)
  const companies = useApp((s) => s.companies)
  return scope.length ? scope : companies.filter((c) => c.status === 'active').map((c) => c.id)
}
export const usePeriod = (): Period => {
  const key = useApp((s) => s.periodKey)
  const custom = useApp((s) => s.custom)
  const companies = useApp((s) => s.companies)
  const fyStartMonth = companies[0]?.fy_start_month ?? 4
  return resolvePeriod(key, fyStartMonth, today(), custom)
}
export const useCurrency = (): string => {
  const scope = useApp((s) => s.scope)
  const companies = useApp((s) => s.companies)
  const group = useApp((s) => s.session?.group)
  if (scope.length === 1) return companies.find((c) => c.id === scope[0])?.base_currency ?? 'INR'
  return group?.base_currency ?? 'INR'
}
export const can = (perm: string, companyId?: ID): boolean => {
  const { session, companies, scope } = useApp.getState()
  if (!session) return false
  if (session.isGroupAdmin) return true
  const ids = companyId ? [companyId] : scope.length ? scope : companies.map((c) => c.id)
  return ids.some((id) => session.permissions[id]?.includes(perm))
}
/** Is the capability switched on for this person, in the companies they are looking at? */
export const capOn = (key: string): boolean => {
  const { flags, roles, companies, scope } = useApp.getState()
  return capabilityOn(flags, key, scope.length ? scope : companies.map((c) => c.id), roles)
}
export const getApi = (): NumeroApi => {
  const api = useApp.getState().api
  if (!api) throw new Error('Not connected.')
  return api
}
