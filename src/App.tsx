import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from '@/store/app'
import { Background } from '@/ui/Background'
import { Shell } from '@/ui/Shell'
import { CommandPalette } from '@/ui/CommandPalette'
import { NumiPanel } from '@/numi/NumiPanel'
import { ErrorBox, Loading, Logo, Toasts } from '@/ui/kit'
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

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
  render() {
    if (this.state.error) return <ErrorBox message={this.state.error} retry={() => this.setState({ error: null })} />
    return this.props.children
  }
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
