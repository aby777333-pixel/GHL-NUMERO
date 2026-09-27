import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { can, useApp } from '@/store/app'
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
 */
function Need({ perm, what, children }: { perm: string | string[]; what: string; children: ReactNode }) {
  useApp((s) => s.session)
  useApp((s) => s.scope)
  const perms = Array.isArray(perm) ? perm : [perm]
  if (perms.some((p) => can(p))) return <>{children}</>
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
