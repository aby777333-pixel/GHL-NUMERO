import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { can, capOn, useApp } from '@/store/app'
import { capability, capabilityOfPath } from '@/engine/features'
import { Background } from '@/ui/Background'
import { Shell } from '@/ui/Shell'
import { CommandPalette } from '@/ui/CommandPalette'
import { NumiPanel } from '@/numi/NumiPanel'
import { Empty, ErrorBox, Loading, Logo, PageHeader, Panel, Toasts } from '@/ui/kit'
import Welcome from '@/pages/Welcome'
import Onboarding from '@/pages/Onboarding'

const Home = lazy(() => import('@/pages/Home'))
const Cockpit = lazy(() => import('@/pages/Cockpit'))
const MoneyMap = lazy(() => import('@/pages/MoneyMap'))
const Forward = lazy(() => import('@/pages/Forward'))
const Entry = lazy(() => import('@/pages/Entry'))
const Journals = lazy(() => import('@/pages/Journals'))
const JournalEditor = lazy(() => import('@/pages/JournalEditor'))
const JournalDetail = lazy(() => import('@/pages/JournalDetail'))
const Ledger = lazy(() => import('@/pages/Ledger'))
const Accounts = lazy(() => import('@/pages/Accounts'))
const Reports = lazy(() => import('@/pages/Reports'))
const ReportView = lazy(() => import('@/pages/ReportView'))
const Documents = lazy(() => import('@/pages/Documents'))
const DocumentEditor = lazy(() => import('@/pages/DocumentEditor'))
const Payments = lazy(() => import('@/pages/Payments'))
const Banking = lazy(() => import('@/pages/Banking'))
const Budgets = lazy(() => import('@/pages/Budgets'))
const PeriodClose = lazy(() => import('@/pages/PeriodClose'))
const Parties = lazy(() => import('@/pages/Parties'))
const Party360 = lazy(() => import('@/pages/Party360'))
const Owed = lazy(() => import('@/pages/Owed'))
const Approvals = lazy(() => import('@/pages/Approvals'))
const Sentinel = lazy(() => import('@/pages/Sentinel'))
const Audit = lazy(() => import('@/pages/Audit'))
const VaultPage = lazy(() => import('@/pages/Vault'))
const Companies = lazy(() => import('@/pages/Companies'))
const Genesis = lazy(() => import('@/pages/Genesis'))
const Team = lazy(() => import('@/pages/Team'))
const Calculators = lazy(() => import('@/pages/Calculators'))
const Requirements = lazy(() => import('@/pages/Requirements'))
const Settings = lazy(() => import('@/pages/Settings'))
// operations (Phase 2)
const Registers = lazy(() => import('@/pages/Registers'))
const Register360 = lazy(() => import('@/pages/Register360'))
const Tasks = lazy(() => import('@/pages/Tasks'))
const Inbox = lazy(() => import('@/pages/Inbox'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const ClaimEditor = lazy(() => import('@/pages/ClaimEditor'))
const Advance360 = lazy(() => import('@/pages/Advance360'))
const Cash = lazy(() => import('@/pages/Cash'))
const Assets = lazy(() => import('@/pages/Assets'))
const Asset360 = lazy(() => import('@/pages/Asset360'))
const Purchasing = lazy(() => import('@/pages/Purchasing'))
const PurchaseEditor = lazy(() => import('@/pages/PurchaseEditor'))
const PurchaseDetail = lazy(() => import('@/pages/PurchaseDetail'))
const Treasury = lazy(() => import('@/pages/Treasury'))
const Loan360 = lazy(() => import('@/pages/Loan360'))
const Payroll = lazy(() => import('@/pages/Payroll'))
const PayrollRun = lazy(() => import('@/pages/PayrollRun'))
const PeopleCost = lazy(() => import('@/pages/PeopleCost'))
// inventory, investments, reality, simulations, the studio and the platform (Phase 3)
const Inventory = lazy(() => import('@/pages/Inventory'))
const InvItem360 = lazy(() => import('@/pages/InvItem360'))
const StockDocEditor = lazy(() => import('@/pages/StockDocEditor'))
const StockCount = lazy(() => import('@/pages/StockCount'))
const InvUnit360 = lazy(() => import('@/pages/InvUnit360'))
const Investments = lazy(() => import('@/pages/Investments'))
const Holding360 = lazy(() => import('@/pages/Holding360'))
const Fund360 = lazy(() => import('@/pages/Fund360'))
const Distribution360 = lazy(() => import('@/pages/Distribution360'))
const Reality = lazy(() => import('@/pages/Reality'))
const Case360 = lazy(() => import('@/pages/Case360'))
const Verification360 = lazy(() => import('@/pages/Verification360'))
const Control = lazy(() => import('@/pages/Control'))
const Twin = lazy(() => import('@/pages/Twin'))
const Sandbox = lazy(() => import('@/pages/Sandbox'))
const Studio = lazy(() => import('@/pages/Studio'))
const FlowDesigner = lazy(() => import('@/pages/FlowDesigner'))
const FlowCase360 = lazy(() => import('@/pages/FlowCase360'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Communications = lazy(() => import('@/pages/Communications'))
const SystemHealth = lazy(() => import('@/pages/SystemHealth'))
const Imports = lazy(() => import('@/pages/Imports'))
const Analysis = lazy(() => import('@/pages/Analysis'))
const Features = lazy(() => import('@/pages/Features'))

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
  render() {
    if (this.state.error) return <ErrorBox message={this.state.error} retry={() => this.setState({ error: null })} />
    return this.props.children
  }
}

/**
 * A screen the person's role does not include. The database would simply return nothing,
 * and an empty screen would read as "there are none" — so the screen says what is true instead.
 * The permissions named on each route are the ones the database accepts for reading that data; a person who may
 * only create (an employee entering a claim) reaches the screen and sees the records they entered themselves.
 *
 * `cap` names the capability a Group Super Admin can switch off (System Health, Capabilities). A capability that is
 * switched off is said to be switched off: its records are still there, and nobody's permission has changed.
 */
/** Every screen honours its switch, whether it is reached from the menu, by its address, by a command or by voice. */
function CapGate({ children }: { children: ReactNode }) {
  useApp((s) => s.flags)
  useApp((s) => s.scope)
  const { pathname } = useLocation()
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const key = capabilityOfPath(pathname)
  // System Health holds the switches: a Group Super Admin can always reach it to switch a capability back on
  if (key === 'system' && admin) return <>{children}</>
  if (key && !capOn(key)) return <Need what={capability(key)?.label ?? 'This screen'} cap={key}>{children}</Need>
  return <>{children}</>
}

function Need({ perm, what, cap, children }: { perm?: string | string[]; what: string; cap?: string; children: ReactNode }) {
  useApp((s) => s.session)
  useApp((s) => s.scope)
  useApp((s) => s.flags)
  if (cap && !capOn(cap)) {
    return (
      <div>
        <PageHeader eyebrow="Switched off" title={what} />
        <Panel>
          <Empty icon={<Lock size={20} />} title={`${capability(cap)?.label ?? what} is switched off`}
            body="A Group Super Admin has switched this capability off for the group, for the companies selected, or for your role. Its records are kept and are still part of the books. It is switched on again under System Health, Capabilities." />
        </Panel>
      </div>
    )
  }
  const perms = perm === undefined ? [] : Array.isArray(perm) ? perm : [perm]
  if (!perms.length || perms.some((p) => can(p))) return <>{children}</>
  return (
    <div>
      <PageHeader eyebrow="Restricted" title={what} />
      <Panel>
        <Empty icon={<Lock size={20} />} title={`Your role does not include ${what.toLowerCase()}`}
          body={<>This screen needs the <span className="num text-ink">{perms.join(' or ')}</span> permission in at least one of the selected companies. A Group Super Admin can grant it under Team &amp; Access. Records you cannot see still exist and are still part of the books.</>} />
      </Panel>
    </div>
  )
}

function Boot({ label }: { label: string }) {
  return (
    <div className="relative z-10 grid h-full place-items-center">
      <div className="text-center">
        <Logo size={84} animate className="mx-auto" />
        <div className="wordmark mt-6 text-[17px]"><span className="text-ink2">GHL</span> <span className="goldtext">NUMERO</span></div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted"><span className="lamp gold pulse" />{label}</div>
      </div>
    </div>
  )
}

export default function App() {
  const status = useApp((s) => s.status)
  const error = useApp((s) => s.error)
  const init = useApp((s) => s.init)
  const leave = useApp((s) => s.leave)
  const effects = useApp((s) => s.effects)
  const uiMode = useApp((s) => s.uiMode)

  useEffect(() => { void init() }, [init])
  useEffect(() => { document.documentElement.classList.toggle('fx-off', effects === 'off') }, [effects])

  let body: ReactNode
  if (status === 'boot') body = <Boot label="Initialising financial universe" />
  else if (status === 'error') body = (
    <div className="relative z-10 grid h-full place-items-center px-5">
      <div className="w-full max-w-[560px]">
        <ErrorBox message={error ?? 'Unknown error'} retry={() => void init()} />
        <div className="text-center"><button className="btn ghost" onClick={() => void leave()}>Return to the start</button></div>
      </div>
    </div>
  )
  else if (status === 'signed_out') body = <Welcome />
  else if (status === 'needs_bootstrap') body = <Onboarding />
  else body = (
    <Shell>
      <Boundary>
        <Suspense fallback={<Loading rows={7} />}>
          <CapGate>
          <Routes>
            <Route path="/" element={uiMode === 'accounting' ? <Navigate to="/journals" replace /> : <Home />} />
            <Route path="/home" element={<Home />} />
            <Route path="/cockpit" element={<Cockpit />} />
            <Route path="/money-map" element={<MoneyMap />} />
            <Route path="/forward" element={<Forward />} />
            <Route path="/entry" element={<Entry />} />
            <Route path="/journals" element={<Journals />} />
            <Route path="/journals/new" element={<JournalEditor />} />
            <Route path="/journals/:id/edit" element={<JournalEditor />} />
            <Route path="/journals/:id" element={<JournalDetail />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:key" element={<ReportView />} />
            <Route path="/invoices" element={<Documents kind="sales" />} />
            <Route path="/invoices/new" element={<DocumentEditor kind="sales" />} />
            <Route path="/invoices/:id" element={<DocumentEditor kind="sales" />} />
            <Route path="/bills" element={<Documents kind="purchase" />} />
            <Route path="/bills/new" element={<DocumentEditor kind="purchase" />} />
            <Route path="/bills/:id" element={<DocumentEditor kind="purchase" />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/banking" element={<Banking />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/close" element={<PeriodClose />} />
            <Route path="/parties" element={<Parties />} />
            <Route path="/parties/owed" element={<Owed />} />
            <Route path="/parties/:id" element={<Party360 />} />
            <Route path="/registers" element={<Need perm="register.view" what="Registers"><Registers /></Need>} />
            <Route path="/registers/:id" element={<Need perm="register.view" what="Registers"><Register360 /></Need>} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/inbox" element={<Need perm={['document.view', 'document.upload']} what="The document inbox"><Inbox /></Need>} />
            <Route path="/expenses" element={<Need perm={['expense.view', 'expense.approve', 'expense.create']} what="Expenses and advances"><Expenses /></Need>} />
            <Route path="/expenses/claims/new" element={<Need perm={['expense.view', 'expense.approve', 'expense.create']} what="Expenses and advances"><ClaimEditor /></Need>} />
            <Route path="/expenses/claims/:id" element={<Need perm={['expense.view', 'expense.approve', 'expense.create']} what="Expenses and advances"><ClaimEditor /></Need>} />
            <Route path="/expenses/advances/:id" element={<Need perm={['expense.view', 'expense.approve', 'expense.create']} what="Expenses and advances"><Advance360 /></Need>} />
            <Route path="/cash" element={<Need perm={['treasury.view', 'expense.approve']} what="Cash and fund transfers"><Cash /></Need>} />
            <Route path="/assets" element={<Need perm="asset.view" what="Fixed assets"><Assets /></Need>} />
            <Route path="/assets/:id" element={<Need perm="asset.view" what="Fixed assets"><Asset360 /></Need>} />
            <Route path="/purchasing" element={<Need perm={['purchase.view', 'purchase.create']} what="Purchasing"><Purchasing /></Need>} />
            <Route path="/purchasing/new" element={<Need perm={['purchase.view', 'purchase.create']} what="Purchasing"><PurchaseEditor /></Need>} />
            <Route path="/purchasing/:id/edit" element={<Need perm={['purchase.view', 'purchase.create']} what="Purchasing"><PurchaseEditor /></Need>} />
            <Route path="/purchasing/:id" element={<Need perm={['purchase.view', 'purchase.create']} what="Purchasing"><PurchaseDetail /></Need>} />
            <Route path="/treasury" element={<Need perm="treasury.view" what="Treasury"><Treasury /></Need>} />
            <Route path="/treasury/loans/:id" element={<Need perm="treasury.view" what="Treasury"><Loan360 /></Need>} />
            <Route path="/payroll" element={<Need perm="payroll.view" what="Payroll"><Payroll /></Need>} />
            <Route path="/payroll/runs/:id" element={<Need perm="payroll.view" what="Payroll"><PayrollRun /></Need>} />
            <Route path="/payroll/people-cost" element={<Need perm="payroll.view" what="People cost"><PeopleCost /></Need>} />
            <Route path="/people-cost" element={<Need perm="payroll.view" what="People cost"><PeopleCost /></Need>} />
            <Route path="/inventory" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><Inventory /></Need>} />
            <Route path="/inventory/items/:id" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><InvItem360 /></Need>} />
            <Route path="/inventory/docs/new" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><StockDocEditor /></Need>} />
            <Route path="/inventory/docs/:id" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><StockDocEditor /></Need>} />
            <Route path="/inventory/counts/:id" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><StockCount /></Need>} />
            <Route path="/inventory/units/:id" element={<Need perm="inventory.view" what="Inventory" cap="inventory"><InvUnit360 /></Need>} />
            <Route path="/investments" element={<Need perm="investment.view" what="Investments and funds" cap="investments"><Investments /></Need>} />
            <Route path="/investments/holdings/:id" element={<Need perm="investment.view" what="Investments and funds" cap="investments"><Holding360 /></Need>} />
            <Route path="/investments/funds/:id" element={<Need perm="investment.view" what="Investments and funds" cap="investments"><Fund360 /></Need>} />
            <Route path="/investments/calls/:id" element={<Need perm="investment.view" what="Investments and funds" cap="investments"><Fund360 /></Need>} />
            <Route path="/investments/distributions/:id" element={<Need perm="investment.view" what="Investments and funds" cap="investments"><Distribution360 /></Need>} />
            <Route path="/reality" element={<Need perm="reality.view" what="Reality" cap="reality"><Reality /></Need>} />
            <Route path="/reality/cases/:id" element={<Need perm="reality.view" what="Reality" cap="reality"><Case360 /></Need>} />
            <Route path="/reality/verifications/:id" element={<Need perm="reality.view" what="Reality" cap="reality"><Verification360 /></Need>} />
            <Route path="/control" element={<Need perm={['allocation.manage', 'journal.view', 'reality.view']} what="Allocations and reclassification" cap="control"><Control /></Need>} />
            <Route path="/twin" element={<Need perm="scenario.view" what="The digital twin" cap="twin"><Twin /></Need>} />
            <Route path="/sandbox" element={<Need perm="scenario.manage" what="The sandbox" cap="sandbox"><Sandbox /></Need>} />
            <Route path="/studio" element={<Need perm="flow.view" what="The scenario studio" cap="studio"><Studio /></Need>} />
            <Route path="/studio/flows/new" element={<Need perm="flow.configure" what="The scenario studio" cap="studio"><FlowDesigner /></Need>} />
            <Route path="/studio/flows/:id" element={<Need perm="flow.view" what="The scenario studio" cap="studio"><FlowDesigner /></Need>} />
            <Route path="/studio/cases/:id" element={<Need perm="flow.view" what="The scenario studio" cap="studio"><FlowCase360 /></Need>} />
            <Route path="/notifications" element={<Need what="Notifications" cap="notifications"><Notifications /></Need>} />
            <Route path="/communications" element={<Need perm={['communication.send', 'party.view']} what="Communications" cap="communications"><Communications /></Need>} />
            <Route path="/system" element={<Need perm={['system.health', 'integration.manage']} what="System health" cap="system"><SystemHealth /></Need>} />
            <Route path="/imports" element={<Need perm="import.manage" what="Imports and the parallel run" cap="imports"><Imports /></Need>} />
            <Route path="/imports/:id" element={<Need perm="import.manage" what="Imports and the parallel run" cap="imports"><Imports /></Need>} />
            <Route path="/analysis" element={<Need perm={['report.view', 'register.view', 'sentinel.view']} what="Analysis" cap="analysis"><Analysis /></Need>} />
            <Route path="/features" element={<Features />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/sentinel" element={<Sentinel />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/vault" element={<VaultPage />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/genesis" element={<Genesis />} />
            <Route path="/team" element={<Team />} />
            <Route path="/calculators" element={<Calculators />} />
            <Route path="/requirements" element={<Requirements />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </CapGate>
        </Suspense>
      </Boundary>
      <NumiPanel />
      <CommandPalette />
    </Shell>
  )

  return (
    <BrowserRouter>
      <Background />
      {body}
      <Toasts />
    </BrowserRouter>
  )
}
