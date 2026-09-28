import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type Decimal from 'decimal.js'
import {
  AlertTriangle, Archive, ArrowRight, BadgeCheck, Banknote, Bell, BookOpenCheck, Check, CircleDashed, Copy, Eye, GitCompareArrows, Globe2, Hourglass,
  MessageSquarePlus, Paperclip, PencilLine, Play, Plus, Scale, Sparkles, Workflow, type LucideIcon,
} from 'lucide-react'
import type { Confidentiality, ID } from '@/engine/types'
import { DOCUMENT_KINDS } from '@/engine/opsTypes'
import {
  FLOW_ACTIONS, FLOW_LINKS, FLOW_TRIGGERS_WORKING,
  type FlowAction, type FlowCase, type FlowCaseInput, type FlowCaseStep, type FlowDef, type FlowDefinition, type FlowFieldDef, type FlowLink, type FlowStepDef, type FlowTrigger,
} from '@/engine/p3Types'
import { can, useApp, useCurrency, useScopeIds } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { D, ZERO } from '@/lib/money'
import { daysBetween, fmtDate, today } from '@/lib/dates'
import { cx, Drawer, Empty, ErrorBox, Field, Loading, Modal, Money, Note, PageHeader, Panel, Section, Spinner, StatusChip, Tabs } from '@/ui/kit'
import { Stat, useCompanyName, usePartyName } from '@/ui/ops'
import { DemoTag, NoAccess, Tile, digits, human, useCompanyChoices, useCompanyCode } from '@/ui/p3'
import { DataTable, type Column } from '@/ui/DataTable'
import { BarChart, Meter } from '@/ui/charts'

// =====================================================================
// Scenario Studio (spec 1768-1772, 1809, 1820, 1828): ways of working a
// company designs for itself, and the cases that follow them.
// A workflow POSTS NOTHING and RELEASES NO MONEY. A step that releases
// money or recognises cost points to the record that does so.
// Approval is not release; release is not expense; expense is not settlement.
// =====================================================================

// ------------------------------------------------------------------ the nine kinds of step
export type Tone = '' | 'pos' | 'warn' | 'cyan' | 'violet' | 'gold'
export const toneVar = (t: Tone) => (t ? `var(--${t})` : 'var(--ink-2)')

export interface ActionMeta { label: string; tone: Tone; icon: LucideIcon; says: string }
export const ACTION_META: Record<FlowAction, ActionMeta> = {
  request: { label: 'Request', tone: '', icon: MessageSquarePlus, says: 'Someone asks. A request commits nothing and releases nothing.' },
  approval: { label: 'Approval', tone: 'cyan', icon: BadgeCheck, says: 'A second person agrees. Approval is not release: no money moves because of it.' },
  fund_release: { label: 'Release of money', tone: 'gold', icon: Banknote, says: 'Money is released by the record this step points to — an advance, a payment, a fund transfer. The workflow itself releases nothing.' },
  evidence: { label: 'Evidence', tone: 'violet', icon: Paperclip, says: 'Receipts and documents are attached to the case. Evidence is not an expense until a claim or an entry recognises it.' },
  settlement: { label: 'Settlement', tone: 'pos', icon: Scale, says: 'What was released is accounted for by the record this step points to. Expense is not settlement: the step is complete only when it points to that record.' },
  accounting: { label: 'Accounting', tone: 'warn', icon: BookOpenCheck, says: 'Cost or income is recognised by the record this step points to. Its entry reaches the ledger only when a second person approves it.' },
  reconciliation: { label: 'Reconciliation', tone: 'cyan', icon: GitCompareArrows, says: 'What the books say is compared with the bank, the cash or the count.' },
  review: { label: 'Review', tone: '', icon: Eye, says: 'A person looks at what was done. A review changes nothing by itself.' },
  notice: { label: 'Notice', tone: 'violet', icon: Bell, says: 'Someone is told. NUMERO sends nothing outside itself: a person sends the message.' },
}
const UNKNOWN_ACTION: ActionMeta = { label: 'Unknown kind', tone: '', icon: CircleDashed, says: 'This kind of step is not one the studio knows.' }
export const actionMeta = (a: string): ActionMeta => (ACTION_META as Record<string, ActionMeta>)[a] ?? { ...UNKNOWN_ACTION, label: human(a) || UNKNOWN_ACTION.label }
/** the kinds of step that release money or recognise cost: they must point to the record that does so */
export const NEEDS_RECORD: FlowAction[] = ['fund_release', 'accounting', 'settlement']

export function ActionChip({ action, className }: { action: string; className?: string }) {
  const m = actionMeta(action)
  const Icon = m.icon
  return <span className={cx('chip', m.tone, className)} title={m.says}><Icon size={11} /> {m.label}</span>
}

/** The round mark of a step on a path. The icon says which kind of step it is; the ring says where the case stands. */
export function ActionNode({ action, size = 36, state = 'plain', title }: { action: string; size?: number; state?: 'plain' | 'pending' | 'active' | 'done' | 'skipped'; title?: string }) {
  const m = actionMeta(action)
  const Icon = m.icon
  const c = toneVar(m.tone)
  const dim = state === 'pending' || state === 'skipped'
  return (
    <span className="relative grid flex-none place-items-center rounded-full border" title={title ?? m.label}
      style={{
        width: size, height: size, color: dim ? 'var(--muted)' : c, borderStyle: state === 'skipped' ? 'dashed' : 'solid',
        borderColor: dim ? 'var(--line-strong)' : `color-mix(in srgb, ${c} 45%, transparent)`,
        background: dim ? 'var(--surface-solid)' : `color-mix(in srgb, ${c} 13%, var(--surface-solid))`,
        boxShadow: state === 'active' ? `0 0 0 4px color-mix(in srgb, ${c} 16%, transparent), 0 0 22px -4px ${c}` : undefined,
      }}>
      <Icon size={Math.round(size * 0.44)} />
      {state === 'done' && <span className="absolute -bottom-0.5 -right-0.5 grid h-[15px] w-[15px] place-items-center rounded-full" style={{ background: 'var(--pos)', color: 'var(--bg)' }}><Check size={10} strokeWidth={3} /></span>}
    </span>
  )
}

/** A path in one line: the kinds of step, in order. */
export function PathStrip({ steps, size = 22, wrap = true }: { steps: { action: string; name: string; optional?: boolean }[]; size?: number; wrap?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-y-1', wrap && 'flex-wrap')}>
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="inline-block h-px w-2.5" style={{ background: 'var(--line-strong)' }} />}
          <ActionNode action={s.action} size={size} state={s.optional ? 'skipped' : 'plain'} title={`${i + 1}. ${s.name} · ${actionMeta(s.action).label}${s.optional ? ' · optional' : ''}`} />
        </span>
      ))}
    </span>
  )
}

// ------------------------------------------------------------------ records a step can point to
export interface LinkMeta { one: string; many: string; perms: string[]; where: string }
export const LINK_META: Record<FlowLink, LinkMeta> = {
  advances: { one: 'advance', many: 'advances', perms: ['expense.view'], where: 'Expenses' },
  expense_claims: { one: 'expense claim', many: 'expense claims', perms: ['expense.view'], where: 'Expenses' },
  purchase_docs: { one: 'purchasing document', many: 'purchasing documents', perms: ['purchase.view'], where: 'Purchasing' },
  register_items: { one: 'register item', many: 'register items', perms: ['register.view'], where: 'Registers' },
  journals: { one: 'accounting entry', many: 'accounting entries', perms: ['journal.view'], where: 'Journals' },
  fund_transfers: { one: 'fund transfer', many: 'fund transfers', perms: ['treasury.view'], where: 'Cash and fund transfers' },
  invoices: { one: 'invoice, bill or note', many: 'invoices, bills and notes', perms: ['invoice.view', 'bill.view'], where: 'Invoices and Bills' },
  payments: { one: 'payment or receipt', many: 'payments and receipts', perms: ['payment.view'], where: 'Payments' },
  fixed_assets: { one: 'fixed asset', many: 'fixed assets', perms: ['asset.view'], where: 'Fixed assets' },
  loans: { one: 'loan', many: 'loans', perms: ['treasury.view'], where: 'Treasury' },
  stock_docs: { one: 'stock document', many: 'stock documents', perms: ['inventory.view'], where: 'Inventory' },
  cases: { one: 'reality case', many: 'reality cases', perms: ['reality.view'], where: 'Reality' },
}
export const linkMeta = (l: string): LinkMeta => (LINK_META as Record<string, LinkMeta>)[l] ?? { one: human(l), many: human(l), perms: [], where: '' }

// ------------------------------------------------------------------ triggers
export const TRIGGER_META: Record<FlowTrigger, { label: string; says: string }> = {
  manual: { label: 'By a person', says: 'A person starts the case in the studio.' },
  form: { label: 'By a form', says: 'A person fills in the form of the workflow and starts the case.' },
  voice: { label: 'By voice', says: 'A person would ask for the case aloud.' },
  document_upload: { label: 'When a document is uploaded', says: 'A document arriving in the inbox would start the case.' },
  email: { label: 'By e-mail', says: 'An e-mail would start the case.' },
  api: { label: 'By another system', says: 'Another system would start the case through the API.' },
  schedule: { label: 'On a schedule', says: 'The case would start on set dates.' },
  event: { label: 'When an event occurs', says: 'Something recorded in NUMERO would start the case.' },
  bank_transaction: { label: 'When a bank transaction arrives', says: 'A line of a bank statement would start the case.' },
  invoice: { label: 'When an invoice is recorded', says: 'An invoice or a bill would start the case.' },
  contract: { label: 'When a contract is recorded', says: 'A contract entered in a register would start the case.' },
  numi_detection: { label: 'When NUMI notices something', says: 'Something NUMI notices would start the case.' },
}
export const INTENT_NOTE = 'recorded as intent — starts nothing today'
export const triggerWorks = (t: string) => (FLOW_TRIGGERS_WORKING as string[]).includes(t)
export const triggerLabel = (t: string) => (TRIGGER_META as Record<string, { label: string }>)[t]?.label ?? human(t)
export function TriggerChip({ trigger }: { trigger: string }) {
  const works = triggerWorks(trigger)
  const says = (TRIGGER_META as Record<string, { says: string }>)[trigger]?.says ?? ''
  return <span className={cx('chip', works ? 'pos' : 'warn')} title={works ? `${says} This way of starting works today.` : `${says} This is ${INTENT_NOTE}. A person starts each case.`}>{triggerLabel(trigger)}</span>
}

// ------------------------------------------------------------------ small shared parts
export const CONFIDENTIALITY: Confidentiality[] = ['internal', 'confidential', 'highly_confidential', 'restricted', 'super_admin_only']
export const DOC_KINDS = DOCUMENT_KINDS.filter((k) => k.key !== 'unclassified')
export const docKindName = (k: string) => DOCUMENT_KINDS.find((x) => x.key === k)?.name ?? human(k)
export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`
export const daysText = (n: number) => (n <= 0 ? 'today' : `${n.toLocaleString()} day${n === 1 ? '' : 's'}`)

export const activeStepOf = (c: FlowCase): FlowCaseStep | null => (c.status !== 'open' ? null : c.steps?.find((s) => s.status === 'active') ?? c.steps?.find((s) => s.step_no === c.current_step) ?? null)
/** the moment the case arrived at the step it waits at: when the step before it was recorded, or when the case was started */
export const waitingSince = (c: FlowCase): string => (c.steps ?? []).reduce((last, s) => (s.done_at && s.done_at > last ? s.done_at : last), c.started_at)

/** A write whose refusal stays on the screen, in the engine's own words, until the person acts again. */
export function useRefusing() {
  const toast = useApp((s) => s.toast)
  const touch = useApp((s) => s.touch)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true); setRefusal(null)
    try {
      const r = await fn()
      if (ok) toast('ok', typeof ok === 'function' ? ok(r) : ok)
      touch()
      return r
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setRefusal(m)
      toast('error', 'Action refused', m)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [toast, touch])
  const clear = useCallback(() => setRefusal(null), [])
  return { run, busy, refusal, clear }
}
export function Refusal({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null
  return (
    <div role="alert" className={cx('flex items-start gap-2.5 rounded-xl border border-neg/30 bg-negsoft px-3.5 py-2.5 text-[12.5px] text-ink2', className)}>
      <AlertTriangle size={15} className="mt-[2px] flex-none text-neg" />
      <div className="min-w-0"><div className="font-medium text-ink">Refused</div><div className="break-words">{message}</div></div>
    </div>
  )
}

// ------------------------------------------------------------------ the rules a definition must keep
export interface Problem { at: 'flow' | 'step' | 'field'; index: number; text: string }
const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/**
 * The rules the engine applies when a workflow is saved or made active, in the same order.
 * `roles` is the list of role keys of the group; when it could not be read, roles are left to the engine.
 * The last two rules (one key per field, a list needs choices) are the designer's own.
 */
export function checkDefinition(d: FlowDefinition, roles: Set<string> | null): Problem[] {
  const out: Problem[] = []
  const steps = Array.isArray(d.steps) ? d.steps : []
  if (!steps.length) out.push({ at: 'flow', index: -1, text: 'A workflow needs at least one step.' })
  const keys = new Set<string>()
  steps.forEach((s, i) => {
    const name = isBlank(s.name) ? `Step ${i + 1}` : `"${s.name.trim()}"`
    if (isBlank(s.name)) out.push({ at: 'step', index: i, text: `Step ${i + 1} needs a name.` })
    if (isBlank(s.key)) out.push({ at: 'step', index: i, text: `${name} needs a key.` })
    else if (keys.has(s.key)) out.push({ at: 'step', index: i, text: `Two steps share the key "${s.key}".` })
    if (!isBlank(s.key)) keys.add(s.key)
    if (!s.action || !(FLOW_ACTIONS as readonly string[]).includes(s.action)) out.push({ at: 'step', index: i, text: `${name} — choose what kind of step it is.` })
    const role = s.actor_role ?? '*'
    if (role !== '*' && roles && !roles.has(role)) out.push({ at: 'step', index: i, text: `${name} names a role that does not exist in this group: ${role}.` })
    if (s.links_to && !(FLOW_LINKS as readonly string[]).includes(s.links_to)) out.push({ at: 'step', index: i, text: `${name} points to a kind of record that a workflow cannot link: ${s.links_to}.` })
    if (s.required_documents !== undefined && !Array.isArray(s.required_documents)) out.push({ at: 'step', index: i, text: `${name} — the required documents must be a list.` })
    if (NEEDS_RECORD.includes(s.action) && !s.links_to)
      out.push({ at: 'step', index: i, text: `${name} releases money or recognises cost. It must point to the record that does so (an advance, a claim, a transfer, an entry), because a workflow itself posts nothing.` })
  })
  const fieldKeys = new Set<string>()
  ;(d.fields ?? []).forEach((f, i) => {
    if (isBlank(f.key) || isBlank(f.label)) out.push({ at: 'field', index: i, text: `Field ${i + 1} of the form needs a key and a label.` })
    else if (fieldKeys.has(f.key)) out.push({ at: 'field', index: i, text: `Two fields of the form share the key "${f.key}". The answer to one would overwrite the other.` })
    if (!isBlank(f.key)) fieldKeys.add(f.key)
    if (f.type === 'select' && !(f.options ?? []).some((o) => !isBlank(o))) out.push({ at: 'field', index: i, text: `"${f.label || `Field ${i + 1}`}" is a list to choose from, and has no choices.` })
  })
  return out
}

// ------------------------------------------------------------------ examples (spec 1769): starting points, nothing more
export interface FlowExample { key: string; name: string; category: string; description: string; trigger_kind: FlowTrigger; definition: FlowDefinition }

const st = (key: string, name: string, action: FlowAction, o: Omit<FlowStepDef, 'key' | 'name' | 'action'> = {}): FlowStepDef => ({ key, name, action, actor_role: '*', ...o })
const fd = (key: string, label: string, type: NonNullable<FlowFieldDef['type']> = 'text', required = false, options?: string[]): FlowFieldDef => ({ key, label, type, ...(required ? { required } : {}), ...(options ? { options } : {}) })

export const FLOW_EXAMPLES: FlowExample[] = [
  {
    key: 'site_imprest', name: 'Site imprest, request to settlement', category: 'Advances', trigger_kind: 'manual',
    description: 'Money handed to a site for small purchases: the request, its approval, the release, the receipts and the settlement.',
    definition: {
      steps: [
        st('request', 'Request for site imprest', 'request', { guidance: 'State the site, the period and what the money is for.' }),
        st('approval', 'Approval by the finance head', 'approval', { actor_role: 'finance_head', guidance: 'Approve the purpose and the amount. Approval releases no money.' }),
        st('release', 'Release of the advance', 'fund_release', { actor_role: 'accountant', links_to: 'advances', guidance: 'Record the advance under Expenses, then point to it here.' }),
        st('evidence', 'Receipts collected at the site', 'evidence', { required_documents: ['expense_receipt'], guidance: 'Attach the receipts of what was spent.' }),
        st('settlement', 'Settlement through an expense claim', 'settlement', { links_to: 'expense_claims', guidance: 'Point to the claim that settled the advance.' }),
        st('accounting', 'Entry of the claim', 'accounting', { actor_role: 'accountant', links_to: 'journals', guidance: 'Point to the entry the claim proposed. It reaches the ledger when a second person approves it.' }),
        st('reconciliation', 'Balance returned and matched to the bank', 'reconciliation', { actor_role: 'accountant', optional: true, guidance: 'Only when money came back from the site.' }),
      ],
      fields: [fd('site', 'Site', 'text', true), fd('period', 'Period covered', 'text', true), fd('estimate', 'Estimate', 'money')],
      actors: ['Site supervisor', 'Finance head', 'Accountant'],
      money_flow: 'Bank → site supervisor (advance) → vendors at the site. Any balance returns to the bank.',
      accounting: 'The advance is an asset until it is settled. Cost is recognised by the expense claim, ledger by ledger.',
      settlement: 'Within 21 days of release, by an expense claim with receipts.',
      notifications: 'The approver is told when a request waits. The requester is told when the settlement date has passed.',
      numi: 'Answers what is outstanding by site and by person, from the advances on record.',
      sentinel: 'An advance older than its settlement date is raised as an alert.',
      reports: 'Advances outstanding by site and by person.',
    },
  },
  {
    key: 'travel_advance', name: 'Employee travel: advance, trip and settlement', category: 'Travel', trigger_kind: 'form',
    description: 'A trip from the request to the settlement of the advance, with tickets and bills as evidence.',
    definition: {
      steps: [
        st('request', 'Travel request', 'request', { guidance: 'Where, when, why and the estimate.' }),
        st('approval', 'Approval of the trip', 'approval', { guidance: 'By a person other than the traveller. Approval releases no money.' }),
        st('finance', 'Finance checks earlier advances', 'review', { actor_role: 'finance_head', guidance: 'Is an earlier advance of the traveller still unsettled?' }),
        st('release', 'Release of the travel advance', 'fund_release', { actor_role: 'accountant', links_to: 'advances' }),
        st('evidence', 'Tickets and bills', 'evidence', { required_documents: ['travel_ticket', 'expense_receipt'], guidance: 'Attach the tickets and the bills of the trip.' }),
        st('settlement', 'Settlement through an expense claim', 'settlement', { links_to: 'expense_claims', guidance: 'Point to the claim that settled the advance.' }),
        st('accounting', 'Entry of the claim', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
        st('reconciliation', 'Balance returned or paid, matched to the bank', 'reconciliation', { actor_role: 'accountant', optional: true }),
      ],
      fields: [
        fd('destination', 'Destination', 'text', true), fd('purpose', 'Purpose of the trip', 'text', true), fd('travel_from', 'Leaves on', 'date', true), fd('travel_to', 'Returns on', 'date', true),
        fd('mode', 'Mode of travel', 'select', false, ['Air', 'Train', 'Bus', 'Car', 'Other']), fd('estimate', 'Estimate', 'money'), fd('billable', 'To be billed to a client', 'boolean'),
      ],
      actors: ['Traveller', 'Manager', 'Finance head', 'Accountant'],
      money_flow: 'Bank → traveller (advance) → airline, hotel, transport. Any balance returns to the bank; any shortfall is paid on the claim.',
      accounting: 'The advance is an asset until the claim recognises the cost of the trip.',
      settlement: 'Within 10 days of the return, by an expense claim with tickets and bills.',
      notifications: 'The traveller is told when the settlement date approaches.',
      numi: 'Answers what a trip cost against its estimate.',
      sentinel: 'A second advance to a person whose earlier advance is unsettled is raised for review.',
      reports: 'Trips by person and by purpose; advances unsettled after the return.',
    },
  },
  {
    key: 'vendor_onboarding', name: 'A new vendor is taken on', category: 'Purchasing', trigger_kind: 'form',
    description: 'Documents, bank details verified by a second person, approval, and the first order.',
    definition: {
      steps: [
        st('details', 'Vendor details and documents', 'request', { required_documents: ['tax_document'], guidance: 'Tax registration, address and what they supply.' }),
        st('bank', 'Bank details verified by a second person', 'review', { actor_role: 'finance_head', guidance: 'Call the vendor on a number already known. Do not use the number on the request.' }),
        st('approval', 'Approval of the vendor', 'approval', { actor_role: 'finance_head' }),
        st('terms', 'Vendor told of the terms', 'notice', { optional: true, guidance: 'A person sends the terms. NUMERO sends nothing.' }),
        st('first_order', 'First purchase order', 'request', { links_to: 'purchase_docs', optional: true, guidance: 'Point to the first order placed with the vendor.' }),
      ],
      fields: [fd('supplies', 'What they supply', 'text', true), fd('gstin', 'GSTIN'), fd('pan', 'PAN'), fd('terms', 'Payment terms', 'select', false, ['Advance', 'On delivery', '15 days', '30 days', '45 days', '60 days']), fd('msme', 'Registered as a small enterprise', 'boolean')],
      actors: ['Purchase manager', 'Finance head'],
      money_flow: 'None. Taking on a vendor releases no money.',
      accounting: 'None until the first bill.',
      settlement: 'Not applicable.',
      notifications: 'The finance head is told when bank details wait to be verified.',
      sentinel: 'A change of bank details of a vendor is raised for verification before any payment.',
      reports: 'Vendors taken on, and how long each took.',
    },
  },
  {
    key: 'asset_purchase', name: 'Purchase of an asset', category: 'Assets', trigger_kind: 'manual',
    description: 'From the requisition to the asset in the register, with the order, the bill and the payment each on its own step.',
    definition: {
      steps: [
        st('requisition', 'Requisition with quotations', 'request', { links_to: 'purchase_docs', required_documents: ['quotation'], guidance: 'Point to the requisition and attach the quotations received.' }),
        st('approval', 'Approval of the purchase', 'approval', { actor_role: 'group_cfo', guidance: 'Approval commits nothing to the vendor and releases no money.' }),
        st('order', 'Purchase order placed with the vendor', 'notice', { links_to: 'purchase_docs', guidance: 'Point to the purchase order. A person sends it to the vendor.' }),
        st('delivery', 'Delivery and installation', 'evidence', { required_documents: ['delivery_note'] }),
        st('bill', 'Bill of the vendor recorded', 'accounting', { actor_role: 'accountant', links_to: 'invoices', guidance: 'Point to the purchase bill.' }),
        st('payment', 'Payment to the vendor', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('register', 'Asset entered in the asset register', 'accounting', { actor_role: 'accountant', links_to: 'fixed_assets' }),
        st('tag', 'Asset seen and tagged', 'review', { optional: true, required_documents: ['photo'] }),
      ],
      fields: [fd('asset', 'What is to be bought', 'text', true), fd('reason', 'Why it is needed', 'text', true), fd('estimate', 'Estimate', 'money', true), fd('location', 'Where it will be kept'), fd('life', 'Useful life in years', 'number')],
      actors: ['Requester', 'Group CFO', 'Purchase manager', 'Accountant'],
      money_flow: 'Bank → vendor, against the bill.',
      accounting: 'The cost is an asset, not an expense. Depreciation starts when the asset is put to use.',
      settlement: 'The vendor is paid against the bill; an advance to the vendor is adjusted against it.',
      notifications: 'The requester is told when the asset is delivered.',
      sentinel: 'A bill above the approved estimate is raised for review.',
      reports: 'Assets bought against the capital budget.',
    },
  },
  {
    key: 'petty_cash_replenishment', name: 'Petty cash replenishment', category: 'Cash', trigger_kind: 'manual',
    description: 'The cash box is counted, what was spent is recognised, and the box is topped up from the bank.',
    definition: {
      steps: [
        st('count', 'Cash counted and top-up requested', 'request', { guidance: 'State the cash counted and the float the box should hold.' }),
        st('vouchers', 'Vouchers of what was spent', 'evidence', { required_documents: ['expense_receipt'] }),
        st('settlement', 'Spending recognised through an expense claim', 'settlement', { links_to: 'expense_claims' }),
        st('approval', 'Approval of the top-up', 'approval', { actor_role: 'finance_head', guidance: 'Approval releases no money.' }),
        st('transfer', 'Transfer from the bank to the cash box', 'fund_release', { actor_role: 'accountant', links_to: 'fund_transfers' }),
        st('recount', 'Cash counted after the top-up', 'reconciliation', { guidance: 'The cash in the box is compared with the ledger of the box.' }),
      ],
      fields: [fd('box', 'Cash box', 'text', true), fd('counted', 'Cash counted', 'money', true), fd('float', 'Float the box should hold', 'money', true), fd('period', 'Period covered')],
      actors: ['Cashier', 'Finance head', 'Accountant'],
      money_flow: 'Bank → cash box. The top-up is a transfer, not an expense.',
      accounting: 'The expense is what was spent from the box, recognised by the claim. The transfer moves money between two ledgers of the company.',
      settlement: 'The top-up brings the box back to its float.',
      notifications: 'The cashier is told when the transfer is approved.',
      sentinel: 'A difference between the cash counted and the ledger of the box is raised as a difference.',
      reports: 'Petty cash spent by head and by month.',
    },
  },
  {
    key: 'customer_refund', name: 'Customer refund', category: 'Customers', trigger_kind: 'manual',
    description: 'Money returned to a customer: the check against the original invoice, the credit note and the payment.',
    definition: {
      steps: [
        st('request', 'Refund requested', 'request', { guidance: 'State the invoice, the reason and the amount.' }),
        st('check', 'Original invoice and receipt checked', 'review', { actor_role: 'accountant', links_to: 'invoices', guidance: 'Point to the invoice the customer paid.' }),
        st('approval', 'Approval of the refund', 'approval', { actor_role: 'finance_head', guidance: 'Approval releases no money.' }),
        st('credit_note', 'Credit note recorded', 'accounting', { actor_role: 'accountant', links_to: 'invoices', guidance: 'Point to the credit note.' }),
        st('payment', 'Refund paid to the customer', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('bank', 'Payment matched to the bank statement', 'reconciliation', { actor_role: 'accountant', optional: true }),
        st('told', 'Customer told', 'notice', { optional: true }),
      ],
      fields: [fd('reason', 'Reason', 'select', true, ['Goods returned', 'Service not delivered', 'Paid twice', 'Price corrected', 'Other']), fd('invoice_no', 'Invoice number', 'text', true), fd('refund', 'Amount to be refunded', 'money', true), fd('to_account', 'Account the money returns to')],
      actors: ['Sales manager', 'Accountant', 'Finance head'],
      money_flow: 'Bank → customer, to the account the money came from.',
      accounting: 'The credit note reduces revenue and the amount the customer owes. The payment clears what is then owed to the customer.',
      settlement: 'The refund is settled when the payment is allocated to the credit note.',
      notifications: 'The customer is told by a person once the payment has left.',
      sentinel: 'A refund to an account other than the one the money came from is raised for review.',
      reports: 'Refunds by reason and by customer.',
    },
  },
  {
    key: 'security_deposit', name: 'Security deposit paid to a landlord', category: 'Property', trigger_kind: 'contract',
    description: 'A refundable deposit under a lease: approved, paid, recorded as an asset and entered in the register with its refund date.',
    definition: {
      steps: [
        st('request', 'Deposit asked for under the lease', 'request', { required_documents: ['contract'], guidance: 'Attach the lease or the letter that asks for the deposit.' }),
        st('approval', 'Approval of the deposit', 'approval', { actor_role: 'group_cfo', guidance: 'Approval releases no money.' }),
        st('payment', 'Deposit paid to the landlord', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('accounting', 'Deposit recorded as an asset', 'accounting', { actor_role: 'accountant', links_to: 'journals', guidance: 'A refundable deposit is not rent.' }),
        st('receipt', 'Receipt of the landlord', 'evidence', { required_documents: ['receipt'] }),
        st('register', 'Deposit entered in the register', 'review', { links_to: 'register_items', guidance: 'Point to the register item that carries the refund date.' }),
      ],
      fields: [fd('premises', 'Premises', 'text', true), fd('lease_from', 'Lease begins', 'date', true), fd('lease_to', 'Lease ends', 'date'), fd('months', 'Months of rent held as deposit', 'number'), fd('refundable', 'Refundable in full', 'boolean')],
      actors: ['Administration', 'Group CFO', 'Accountant'],
      money_flow: 'Bank → landlord. The money comes back at the end of the lease, less what the lease allows the landlord to keep.',
      accounting: 'A refundable deposit is an asset until it is returned or adjusted. It is not an expense.',
      settlement: 'At the end of the lease: returned in full, or adjusted against dues with the difference explained.',
      notifications: 'The owner of the lease is told 60 days before it ends.',
      sentinel: 'A deposit still in the books after its lease has ended is raised for review.',
      reports: 'Deposits held by landlords, with the dates they fall due for refund.',
      register_kind: 'lease',
    },
  },
  {
    key: 'salary_advance', name: 'Salary advance', category: 'People', trigger_kind: 'form',
    description: 'An advance against salary: approved, released, and recovered through payroll.',
    definition: {
      steps: [
        st('request', 'Request for an advance against salary', 'request', { guidance: 'State the reason and over how many months it is to be recovered.' }),
        st('approval', 'Approval by the finance head', 'approval', { actor_role: 'finance_head', guidance: 'Approval releases no money.' }),
        st('undertaking', 'Signed undertaking of the employee', 'evidence', { required_documents: ['other'], guidance: 'Attach the signed undertaking as a document of the kind Other.' }),
        st('release', 'Advance paid to the employee', 'fund_release', { actor_role: 'accountant', links_to: 'advances' }),
        st('recovery', 'Recovery through payroll', 'settlement', { actor_role: 'accountant', links_to: 'journals', guidance: 'Point to the payroll entry that carries the last recovery.' }),
        st('closed', 'Balance confirmed as nil', 'review', { optional: true }),
      ],
      fields: [fd('reason', 'Reason', 'text', true), fd('months', 'Months over which it is recovered', 'number', true), fd('monthly', 'Recovery each month', 'money')],
      actors: ['Employee', 'Finance head', 'Payroll officer', 'Accountant'],
      money_flow: 'Bank → employee. It comes back through deductions from salary.',
      accounting: 'The advance is an asset, a sum the employee owes, until payroll recovers it. It is not a salary cost.',
      settlement: 'By deduction from salary over the months agreed; in full from the final settlement if the employee leaves.',
      notifications: 'The payroll officer is told of the recovery to make each month.',
      sentinel: 'An advance to an employee who has given notice is raised for review.',
      reports: 'Salary advances outstanding by person.',
    },
  },
  {
    key: 'petty_purchase', name: 'Petty purchase', category: 'Expenses', trigger_kind: 'manual',
    description: 'A small purchase paid by a person and claimed back.',
    definition: {
      steps: [
        st('request', 'What is to be bought, and why', 'request'),
        st('approval', 'Approval', 'approval', { guidance: 'By a person other than the buyer. Approval releases no money.' }),
        st('bill', 'Bill of the purchase', 'evidence', { required_documents: ['expense_receipt'] }),
        st('claim', 'Cost recognised through an expense claim', 'accounting', { links_to: 'expense_claims' }),
        st('paid', 'Reimbursement paid', 'fund_release', { actor_role: 'accountant', links_to: 'journals', guidance: 'Point to the entry of the payment of the claim.' }),
      ],
      fields: [fd('item', 'What is bought', 'text', true), fd('estimate', 'Estimate', 'money', true), fd('needed_by', 'Needed by', 'date')],
      actors: ['Buyer', 'Approver', 'Accountant'],
      money_flow: 'The buyer pays the shop. The company pays the buyer on the claim.',
      accounting: 'The cost is recognised by the claim, under the head of what was bought.',
      settlement: 'The claim is paid in the next payment run.',
      sentinel: 'The same bill claimed twice is raised as a possible duplicate.',
      reports: 'Petty purchases by head and by person.',
    },
  },
  {
    key: 'emergency_cash', name: 'Emergency cash', category: 'Cash', trigger_kind: 'manual',
    description: 'Money needed at once: the approval is still given by a second person, and the evidence follows.',
    definition: {
      steps: [
        st('request', 'What happened and what is needed', 'request'),
        st('approval', 'Approval by the owner', 'approval', { actor_role: 'owner', guidance: 'Urgency does not remove the second person. Approval releases no money.' }),
        st('release', 'Cash released as an advance', 'fund_release', { actor_role: 'accountant', links_to: 'advances' }),
        st('evidence', 'Bills of what was spent', 'evidence', { required_documents: ['expense_receipt'] }),
        st('settlement', 'Settlement through an expense claim', 'settlement', { links_to: 'expense_claims' }),
        st('review', 'Why it was urgent, and what would avoid the next one', 'review', { actor_role: 'group_cfo' }),
      ],
      fields: [fd('what', 'What happened', 'text', true), fd('needed_by', 'Needed by', 'date', true), fd('needed', 'Amount needed', 'money', true)],
      actors: ['Requester', 'Owner', 'Accountant', 'Group CFO'],
      money_flow: 'Bank or cash box → requester (advance) → whoever is paid.',
      accounting: 'The advance is an asset until the claim recognises the cost.',
      settlement: 'Within 7 days, by an expense claim with bills.',
      notifications: 'The owner is told at once.',
      sentinel: 'Emergency cash asked for by the same person more than twice in a quarter is raised for review.',
      reports: 'Emergency cash by cause.',
    },
  },
  {
    key: 'client_entertainment', name: 'Client entertainment', category: 'Expenses', trigger_kind: 'manual',
    description: 'Hospitality for a client: who was entertained and why, the bills, the claim and its entry.',
    definition: {
      steps: [
        st('request', 'Who is entertained, and why', 'request'),
        st('approval', 'Approval', 'approval', { guidance: 'By a person other than the host. Approval releases no money.' }),
        st('bills', 'Bills of the occasion', 'evidence', { required_documents: ['expense_receipt'] }),
        st('claim', 'Settlement through an expense claim', 'settlement', { links_to: 'expense_claims' }),
        st('entry', 'Entry of the claim', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
        st('tax', 'Tax treatment looked at', 'review', { actor_role: 'accountant', optional: true }),
      ],
      fields: [fd('client', 'Client', 'text', true), fd('occasion', 'Occasion', 'text', true), fd('people', 'Number of people', 'number'), fd('estimate', 'Estimate', 'money')],
      actors: ['Host', 'Approver', 'Accountant'],
      money_flow: 'The host pays. The company pays the host on the claim.',
      accounting: 'Recognised under business promotion. Tax credit on such costs may be restricted.',
      settlement: 'By an expense claim with bills that name the people present.',
      sentinel: 'Entertainment above the limit of the policy is raised for review.',
      reports: 'Entertainment by client and by host.',
    },
  },
  {
    key: 'charitable_donation', name: 'Charitable donation', category: 'Donations', trigger_kind: 'manual',
    description: 'A donation: approved by the owner, paid, and supported by the receipt of the recipient.',
    definition: {
      steps: [
        st('request', 'Recipient and purpose', 'request'),
        st('approval', 'Approval by the owner', 'approval', { actor_role: 'owner', guidance: 'Approval releases no money.' }),
        st('payment', 'Donation paid', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('receipt', 'Receipt and certificate of the recipient', 'evidence', { required_documents: ['receipt', 'tax_document'] }),
        st('entry', 'Entry of the donation', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
      ],
      fields: [fd('recipient', 'Recipient', 'text', true), fd('purpose', 'Purpose', 'text', true), fd('donation', 'Amount', 'money', true), fd('exempt', 'The recipient holds a tax exemption certificate', 'boolean')],
      actors: ['Owner', 'Accountant'],
      money_flow: 'Bank → recipient. Donations are paid through the bank, not in cash.',
      accounting: 'Recognised as a donation. Whether it is deductible depends on the certificate of the recipient.',
      settlement: 'Complete when the receipt is on file.',
      sentinel: 'A donation without a receipt after 30 days is raised for follow-up.',
      reports: 'Donations by recipient and by year.',
    },
  },
  {
    key: 'vendor_advance', name: 'Advance to a vendor', category: 'Purchasing', trigger_kind: 'manual',
    description: 'Money paid to a vendor before delivery, and its adjustment against the bill.',
    definition: {
      steps: [
        st('request', 'Advance asked against a purchase order', 'request', { links_to: 'purchase_docs', guidance: 'Point to the purchase order.' }),
        st('approval', 'Approval by the finance head', 'approval', { actor_role: 'finance_head', guidance: 'Approval releases no money.' }),
        st('payment', 'Advance paid to the vendor', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('delivery', 'Goods or service received', 'evidence', { required_documents: ['delivery_note'] }),
        st('adjusted', 'Advance adjusted against the bill', 'settlement', { actor_role: 'accountant', links_to: 'invoices', guidance: 'Point to the bill of the vendor.' }),
        st('statement', 'Statement of the vendor agreed', 'reconciliation', { optional: true }),
      ],
      fields: [fd('order_no', 'Purchase order number', 'text', true), fd('share', 'Share of the order paid in advance, in %', 'number'), fd('delivery_by', 'Delivery promised by', 'date'), fd('security', 'Security held, if any')],
      actors: ['Purchase manager', 'Finance head', 'Accountant'],
      money_flow: 'Bank → vendor, before delivery.',
      accounting: 'An advance to a vendor is an asset until the bill arrives. It is not a purchase.',
      settlement: 'Adjusted against the bill; returned by the vendor if the order is cancelled.',
      sentinel: 'An advance to a vendor with no delivery after the promised date is raised for follow-up.',
      reports: 'Advances to vendors outstanding, by age.',
    },
  },
  {
    key: 'supplier_refund', name: 'Refund due from a supplier', category: 'Purchasing', trigger_kind: 'manual',
    description: 'Money a supplier owes back: the debit note, the follow-up and the receipt.',
    definition: {
      steps: [
        st('claim', 'Refund claimed from the supplier', 'request', { guidance: 'State the bill, the reason and the amount.' }),
        st('debit_note', 'Debit note recorded', 'accounting', { actor_role: 'accountant', links_to: 'invoices', guidance: 'Point to the debit note.' }),
        st('told', 'Supplier told', 'notice', { guidance: 'A person sends the debit note. NUMERO sends nothing.' }),
        st('received', 'Refund received', 'settlement', { actor_role: 'accountant', links_to: 'payments', guidance: 'Point to the receipt.' }),
        st('bank', 'Receipt matched to the bank statement', 'reconciliation', { actor_role: 'accountant', optional: true }),
      ],
      fields: [fd('reason', 'Reason', 'select', true, ['Goods returned', 'Short supply', 'Paid twice', 'Price corrected', 'Other']), fd('bill_no', 'Bill number', 'text', true), fd('refund', 'Amount due back', 'money', true)],
      actors: ['Purchase manager', 'Accountant'],
      money_flow: 'Supplier → bank.',
      accounting: 'The debit note reduces the purchase and what is owed to the supplier.',
      settlement: 'Received in the bank, or adjusted against the next bill of the supplier.',
      sentinel: 'A refund not received after 45 days is raised for follow-up.',
      reports: 'Refunds due from suppliers, by age.',
    },
  },
  {
    key: 'insurance_claim', name: 'Insurance claim', category: 'Insurance', trigger_kind: 'manual',
    description: 'A loss covered by a policy: the insurer is told, the proof is gathered, and the amount received is recorded.',
    definition: {
      steps: [
        st('told', 'Insurer told of the loss', 'notice', { required_documents: ['insurance_policy'], guidance: 'A person tells the insurer, within the time the policy allows.' }),
        st('proof', 'Proof of the loss', 'evidence', { required_documents: ['photo'] }),
        st('filed', 'Claim filed', 'request', { guidance: 'State the claim number given by the insurer in the note.' }),
        st('survey', 'Survey and assessment', 'review', { optional: true }),
        st('received', 'Claim amount received', 'settlement', { actor_role: 'accountant', links_to: 'payments', guidance: 'Point to the receipt from the insurer.' }),
        st('entry', 'Loss and recovery recognised', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
      ],
      fields: [fd('policy_no', 'Policy number', 'text', true), fd('loss_date', 'Date of the loss', 'date', true), fd('what', 'What was lost or damaged', 'text', true), fd('estimate', 'Estimate of the loss', 'money')],
      actors: ['Administration', 'Accountant', 'Finance head'],
      money_flow: 'Insurer → bank.',
      accounting: 'The loss is recognised when it occurs. The recovery is recognised when the insurer admits the claim.',
      settlement: 'What the insurer pays; the difference from the loss stays a cost.',
      sentinel: 'A claim not filed within the time of the policy is raised as critical.',
      reports: 'Claims filed, admitted and received.',
      register_kind: 'insurance',
    },
  },
  {
    key: 'accident', name: 'Accident', category: 'Incidents', trigger_kind: 'manual',
    description: 'An accident at a site or on the road: the facts first, then the cost of repair or treatment.',
    definition: {
      steps: [
        st('reported', 'Accident reported', 'notice', { guidance: 'What happened, where and when, as facts.' }),
        st('proof', 'Photographs and statements', 'evidence', { required_documents: ['photo'] }),
        st('facts', 'Facts recorded in a case', 'review', { links_to: 'cases', optional: true, guidance: 'Point to the case under Reality, where one was opened.' }),
        st('approval', 'Approval of the cost of repair or treatment', 'approval', { guidance: 'Approval releases no money.' }),
        st('payment', 'Payment made', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('entry', 'Entry of the cost', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
        st('insurer', 'Insurer told, where a policy applies', 'notice', { optional: true }),
      ],
      fields: [fd('on', 'Date of the accident', 'date', true), fd('place', 'Place', 'text', true), fd('what', 'What happened', 'text', true), fd('injured', 'A person was injured', 'boolean'), fd('estimate', 'Estimate of the cost', 'money')],
      actors: ['Site supervisor', 'Administration', 'Accountant'],
      money_flow: 'Bank → hospital, workshop or the person affected.',
      accounting: 'The cost is recognised when it is incurred; a recovery from the insurer is a separate matter.',
      settlement: 'Closed when the cost is paid and any claim on the insurer is filed.',
      sentinel: 'An accident with an injury is raised as critical.',
      reports: 'Accidents by site, with their cost.',
    },
  },
  {
    key: 'project_launch', name: 'Project launch', category: 'Projects', trigger_kind: 'manual',
    description: 'A project from the proposal to its first funds: budget approved, cost codes in place, team told.',
    definition: {
      steps: [
        st('proposal', 'Project proposed with its budget', 'request', { required_documents: ['board_resolution'], guidance: 'Attach the approval note or the resolution.' }),
        st('approval', 'Approval by the owner', 'approval', { actor_role: 'owner', guidance: 'Approval releases no money.' }),
        st('codes', 'Budget and cost codes set up', 'review', { actor_role: 'accountant', guidance: 'The budget is entered under Budgets and the project under Registers.' }),
        st('funds', 'Opening funds moved to the project', 'fund_release', { actor_role: 'accountant', links_to: 'fund_transfers', optional: true }),
        st('told', 'Team told', 'notice', { optional: true }),
      ],
      fields: [fd('project', 'Project', 'text', true), fd('starts', 'Starts on', 'date', true), fd('budget', 'Budget', 'money', true), fd('sponsor', 'Sponsor')],
      actors: ['Project manager', 'Owner', 'Accountant'],
      money_flow: 'Company bank → project bank account, where the project has one.',
      accounting: 'Moving funds to a project is a transfer between two ledgers, not a cost.',
      settlement: 'Not applicable at the launch.',
      sentinel: 'Cost recorded against a project before its budget is approved is raised for review.',
      reports: 'Projects launched, with budget against cost to date.',
    },
  },
  {
    key: 'event', name: 'Event', category: 'Events', trigger_kind: 'manual',
    description: 'An event the company holds: the estimate, the advance, the bills and the cost against the estimate.',
    definition: {
      steps: [
        st('request', 'Event proposed with its estimate', 'request'),
        st('approval', 'Approval', 'approval', { actor_role: 'finance_head', guidance: 'Approval releases no money.' }),
        st('release', 'Advance released to the organiser', 'fund_release', { actor_role: 'accountant', links_to: 'advances' }),
        st('bills', 'Bills of the event', 'evidence', { required_documents: ['expense_receipt'] }),
        st('settlement', 'Settlement through an expense claim', 'settlement', { links_to: 'expense_claims' }),
        st('review', 'Cost against the estimate', 'review', { actor_role: 'finance_head' }),
      ],
      fields: [fd('event', 'Event', 'text', true), fd('on', 'Date', 'date', true), fd('venue', 'Venue'), fd('people', 'People expected', 'number'), fd('estimate', 'Estimate', 'money', true)],
      actors: ['Organiser', 'Finance head', 'Accountant'],
      money_flow: 'Bank → organiser (advance) → venue, caterer and others.',
      accounting: 'The advance is an asset until the claim recognises the cost of the event.',
      settlement: 'Within 10 days of the event, by an expense claim with bills.',
      sentinel: 'Cost above the estimate by more than a tenth is raised for review.',
      reports: 'Events with estimate against cost.',
    },
  },
  {
    key: 'seminar', name: 'Seminar or training', category: 'Events', trigger_kind: 'form',
    description: 'A seminar a person attends: the fee paid to the organiser, the receipt and the entry.',
    definition: {
      steps: [
        st('request', 'Seminar and the reason to attend', 'request'),
        st('approval', 'Approval', 'approval', { guidance: 'By a person other than the one who attends. Approval releases no money.' }),
        st('fee', 'Fee paid to the organiser', 'fund_release', { actor_role: 'accountant', links_to: 'payments' }),
        st('receipt', 'Receipt of the organiser', 'evidence', { required_documents: ['receipt'] }),
        st('entry', 'Entry of the fee', 'accounting', { actor_role: 'accountant', links_to: 'journals' }),
        st('shared', 'What was learnt, shared with the team', 'review', { optional: true }),
      ],
      fields: [fd('title', 'Seminar', 'text', true), fd('organiser', 'Organiser', 'text', true), fd('from', 'From', 'date', true), fd('to', 'To', 'date'), fd('fee', 'Fee', 'money', true)],
      actors: ['Attendee', 'Approver', 'Accountant'],
      money_flow: 'Bank → organiser.',
      accounting: 'Recognised as training cost in the month of the seminar.',
      settlement: 'Complete when the receipt is on file.',
      reports: 'Training cost by person and by department.',
    },
  },
]

/**
 * An example is written for any group. A role it names may not exist in this one, and a register
 * kind it names may not either: those are replaced before anything is saved, and the person is told.
 */
export function adaptExample(ex: FlowExample, roles: Set<string> | null, registerKinds: Set<string> | null): { definition: FlowDefinition; replaced: { step: string; role: string }[]; droppedKind: string | null } {
  const replaced: { step: string; role: string }[] = []
  const d: FlowDefinition = JSON.parse(JSON.stringify(ex.definition))
  d.steps = d.steps.map((s) => {
    const role = s.actor_role ?? '*'
    if (role === '*' || roles?.has(role)) return s
    replaced.push({ step: s.name, role })
    return { ...s, actor_role: '*' }
  })
  let droppedKind: string | null = null
  if (d.register_kind && !registerKinds?.has(d.register_kind)) { droppedKind = d.register_kind; delete d.register_kind }
  return { definition: d, replaced, droppedKind }
}

// ------------------------------------------------------------------ making a workflow active, or retiring it
/** There is no reason to give: the engine records who changed the status and when, and nothing else. */
export function StatusDialog({ def, to, defs, openCases, onClose, onDone }: { def: FlowDef | null; to: 'active' | 'retired'; defs: FlowDef[]; openCases?: number; onClose: () => void; onDone?: () => void }) {
  const api = useApp((s) => s.api)!
  const companyName = useCompanyName()
  const { run, busy, refusal, clear } = useRefusing()
  useEffect(() => { if (def) clear() }, [def?.id, to]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!def) return null
  const other = defs.find((x) => x.id !== def.id && x.key === def.key && (x.company_id ?? null) === (def.company_id ?? null) && x.status === 'active')
  const whose = def.company_id ? companyName(def.company_id) : 'the whole group'
  const problems = to === 'active' ? checkDefinition(def.definition, null) : []
  const confirm = async () => {
    const ok = await run(async () => { await api.setFlowStatus(def.id, to); return true }, to === 'active' ? `Version ${def.version} of ${def.name} is active` : `Version ${def.version} of ${def.name} is retired`)
    if (ok) { onClose(); onDone?.() }
  }
  return (
    <Modal open onClose={onClose} width={540} title={to === 'active' ? 'Make this workflow active' : 'Retire this workflow'} subtitle={<>{def.name} · <span className="num">{def.key}</span> · version <span className="num">{def.version}</span> · {whose}</>}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={cx('btn', to === 'active' ? 'primary' : 'danger')} disabled={busy} onClick={() => void confirm()}>{busy ? <Spinner /> : to === 'active' ? <Play size={15} /> : <Archive size={15} />} {to === 'active' ? 'Make active' : 'Retire'}</button>
      </>}>
      {to === 'active' ? (
        <ul className="m-0 list-disc space-y-1.5 pl-4 text-[13px] text-ink2">
          <li>New cases of <span className="text-ink">{def.name}</span> follow version <span className="num">{def.version}</span> from now on.</li>
          {other ? <li>Version <span className="num">{other.version}</span> is active now. The engine retires it at the same moment: a key has one active version for {whose}.</li> : <li>No other version of this key is active for {whose}.</li>}
          <li>Cases already started keep the steps they started with.</li>
          <li>Once active, this version is no longer edited. A change is saved as the next version.</li>
          {!triggerWorks(def.trigger_kind) && <li>Its trigger, <span className="text-ink">{triggerLabel(def.trigger_kind).toLowerCase()}</span>, is {INTENT_NOTE}. A person starts each case.</li>}
          <li>Making a workflow active posts nothing and moves no money.</li>
        </ul>
      ) : (
        <ul className="m-0 list-disc space-y-1.5 pl-4 text-[13px] text-ink2">
          <li>No new case can be started on version <span className="num">{def.version}</span> of <span className="text-ink">{def.name}</span>.</li>
          <li>{openCases === undefined ? 'Cases already started' : openCases === 0 ? 'No case is open on it in the companies selected. Cases started elsewhere' : `${plural(openCases, 'case is', 'cases are')} open on it in the companies selected. They`} keep their steps and can still be completed.</li>
          <li>The workflow stays on record. It can be made active again, or cloned.</li>
        </ul>
      )}
      {problems.length > 0 && <Note kind="warn" className="mt-4">The engine checks the workflow again before it makes it active. It will refuse this one: {problems[0].text}</Note>}
      <Refusal message={refusal} className="mt-4" />
    </Modal>
  )
}

// =====================================================================
// The page
// =====================================================================
type TabKey = 'dashboard' | 'workflows' | 'cases'
const TABS: { key: TabKey; label: string }[] = [{ key: 'dashboard', label: 'Dashboard' }, { key: 'workflows', label: 'Workflows' }, { key: 'cases', label: 'Cases' }]
const foot = 'border-t border-line2 px-[14px] py-[10px]'

export default function Studio() {
  useApp((s) => s.session)
  const scope = useScopeIds()
  const ids = scope.filter((id) => can('flow.view', id))
  if (!ids.length) return <NoAccess eyebrow="Scenario Studio" title="The Scenario Studio" perm="flow.view" />
  return <StudioView ids={ids} />
}

interface FlowRow { flowId: ID; def: FlowDef | null; open: FlowCase[]; completed: number; cancelled: number; amounts: Map<string, Decimal>; withAmount: number; oldest: number | null }

function StudioView({ ids }: { ids: ID[] }) {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const currency = useCurrency()
  const companyCode = useCompanyCode()
  const companyName = useCompanyName()
  const partyName = usePartyName()
  const idsKey = ids.join(',')
  const asOf = today()

  const wanted = sp.get('tab')
  const tab: TabKey = TABS.find((t) => t.key === wanted)?.key ?? 'dashboard'
  const go = (next: Record<string, string>) => setSp(next, { replace: true })
  const filter = { flow: sp.get('flow') ?? '', status: sp.get('status') ?? '', company: sp.get('company') ?? '', waiting: sp.get('waiting') ?? '' }
  const setFilter = (patch: Partial<typeof filter>) => {
    const next: Record<string, string> = { tab: 'cases' }
    for (const [k, v] of Object.entries({ ...filter, ...patch })) if (v) next[k] = v
    go(next)
  }

  const [starting, setStarting] = useState<{ flowId?: ID } | null>(null)
  const [cloning, setCloning] = useState<FlowDef | null>(null)
  const [changing, setChanging] = useState<{ def: FlowDef; to: 'active' | 'retired' } | null>(null)
  const [lens, setLens] = useState<ID>('')

  const main = useAsync(async () => {
    const [defs, cases] = await Promise.all([api.listFlowDefs(), api.listFlowCases({ companyIds: ids })])
    return { defs: defs.filter((d) => d.company_id === null || ids.includes(d.company_id)), cases }
  }, [api, idsKey])
  // the roles of the group decide which examples can be used as they are; a person who cannot list them still sees the library
  const roles = useAsync(() => api.listRoles().then((r) => new Set(r.map((x) => x.key)), () => null), [api])

  const defs = useMemo(() => main.data?.defs ?? [], [main.data])
  const cases = useMemo(() => main.data?.cases ?? [], [main.data])
  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs])
  const ccyOf = useMemo(() => { const m = new Map(companies.map((c) => [c.id, c.base_currency])); return (id: ID) => m.get(id) ?? currency }, [companies, currency])
  const flowName = (id: ID) => { const d = defById.get(id); return d ? `${d.name} · v${d.version}` : 'A workflow not shared with you' }

  // a case is started by anyone who reads workflows: an employee raises their own request. Working on the cases of others needs flow.manage.
  const manageIds = ids.filter((id) => can('flow.manage', id) || can('flow.view', id))
  const mayDesign = admin || companies.some((c) => c.status === 'active' && can('flow.configure', c.id))
  const mayChange = (d: FlowDef) => (d.company_id ? can('flow.configure', d.company_id) : admin)
  const whyNotChange = (d: FlowDef) => (mayChange(d) ? undefined : d.company_id ? 'You need the permission flow.configure in the company of this workflow' : 'A workflow for the whole group is changed by a Group Super Admin')
  const noManage = manageIds.length ? undefined : 'You need the permission flow.view to start a case'
  const noDesign = mayDesign ? undefined : 'You need the permission flow.configure to design a workflow'

  const open = useMemo(() => cases.filter((c) => c.status === 'open'), [cases])
  const completed = cases.filter((c) => c.status === 'completed')
  const cancelled = cases.filter((c) => c.status === 'cancelled')
  const age = (c: FlowCase) => daysBetween(c.started_at.slice(0, 10), asOf)
  const waited = (c: FlowCase) => daysBetween(waitingSince(c).slice(0, 10), asOf)
  const byStatus = { draft: defs.filter((d) => d.status === 'draft').length, active: defs.filter((d) => d.status === 'active').length, retired: defs.filter((d) => d.status === 'retired').length }

  const openAmounts = useMemo(() => {
    const m = new Map<string, Decimal>()
    for (const c of open) if (c.amount !== null && c.amount !== undefined) m.set(ccyOf(c.company_id), (m.get(ccyOf(c.company_id)) ?? ZERO).plus(D(c.amount)))
    return m
  }, [open, ccyOf])
  const openWithAmount = open.filter((c) => c.amount !== null && c.amount !== undefined).length
  const oneCurrency = openAmounts.size <= 1
  const oldestOpen = open.reduce<FlowCase | null>((a, c) => (!a || c.started_at < a.started_at ? c : a), null)

  const waitingAt = useMemo(() => FLOW_ACTIONS.map((action) => {
    const rows = open.filter((c) => activeStepOf(c)?.action === action)
    return { action, count: rows.length, longest: rows.reduce((n, c) => Math.max(n, daysBetween(waitingSince(c).slice(0, 10), asOf)), 0) }
  }), [open, asOf])

  const flowRows: FlowRow[] = useMemo(() => {
    const m = new Map<ID, FlowRow>()
    const row = (flowId: ID) => { let r = m.get(flowId); if (!r) { r = { flowId, def: defById.get(flowId) ?? null, open: [], completed: 0, cancelled: 0, amounts: new Map(), withAmount: 0, oldest: null }; m.set(flowId, r) } return r }
    for (const d of defs) if (d.status === 'active') row(d.id)
    for (const c of cases) {
      const r = row(c.flow_id)
      if (c.status === 'completed') r.completed += 1
      else if (c.status === 'cancelled') r.cancelled += 1
      else {
        r.open.push(c)
        const n = daysBetween(c.started_at.slice(0, 10), asOf)
        r.oldest = r.oldest === null ? n : Math.max(r.oldest, n)
        if (c.amount !== null && c.amount !== undefined) { r.withAmount += 1; r.amounts.set(ccyOf(c.company_id), (r.amounts.get(ccyOf(c.company_id)) ?? ZERO).plus(D(c.amount))) }
      }
    }
    return [...m.values()].sort((a, b) => b.open.length - a.open.length || (a.def?.name ?? '').localeCompare(b.def?.name ?? ''))
  }, [defs, cases, defById, asOf, ccyOf])
  const mostOpen = Math.max(1, ...flowRows.map((r) => r.open.length))
  const chartRows = flowRows.filter((r) => [...r.amounts.values()].some((v) => v.gt(0)))
  const chartable = oneCurrency && chartRows.length > 1 && [...openAmounts.keys()].every((c) => c === currency)

  const longest = useMemo(() => [...open].sort((a, b) => a.started_at.localeCompare(b.started_at)).slice(0, 10), [open])

  const lensChoices = flowRows.filter((r) => r.def)
  const lensRow = lensChoices.find((r) => r.flowId === lens) ?? lensChoices[0] ?? null

  const shown = cases.filter((c) => (!filter.flow || c.flow_id === filter.flow) && (!filter.status || c.status === filter.status) && (!filter.company || c.company_id === filter.company) && (!filter.waiting || activeStepOf(c)?.action === filter.waiting))
  const filtered = !!(filter.flow || filter.status || filter.company || filter.waiting)
  const shownAmounts = new Map<string, Decimal>()
  for (const c of shown) if (c.amount !== null && c.amount !== undefined) shownAmounts.set(ccyOf(c.company_id), (shownAmounts.get(ccyOf(c.company_id)) ?? ZERO).plus(D(c.amount)))

  const amountsOf = (m: Map<string, Decimal>) => (m.size === 0 ? <span className="text-muted">—</span> : <span className="inline-flex flex-col items-end">{[...m.entries()].map(([c, v]) => <Money key={c} value={v} currency={c} />)}</span>)
  const amountsCsv = (m: Map<string, Decimal>) => [...m.entries()].map(([c, v]) => `${c} ${v.toFixed(2)}`).join('; ')

  // ---------------------------------------------------------------- columns
  const flowColumns: Column<FlowRow>[] = [
    { key: 'flow', header: 'Workflow', render: (r) => <div className="min-w-0"><div className="truncate text-ink">{r.def?.name ?? 'A workflow not shared with you'}</div>{r.def && <div className="text-[11px] text-muted"><span className="num">{r.def.key}</span> · v{r.def.version} · {r.def.company_id ? companyCode(r.def.company_id) : 'whole group'} · {r.def.status}</div>}</div>, sort: (r) => (r.def?.name ?? '').toLowerCase(), csv: (r) => (r.def ? `${r.def.name} v${r.def.version}` : 'Not shared') },
    { key: 'open', header: 'Open cases', width: 210, render: (r) => <div className="flex items-center gap-2.5"><span className="num w-7 text-right text-ink">{r.open.length}</span><span className="min-w-[90px] flex-1"><Meter value={r.open.length} max={mostOpen} tone="gold" height={5} /></span></div>, sort: (r) => r.open.length, csv: (r) => r.open.length },
    { key: 'oldest', header: 'Open longest', align: 'right', render: (r) => (r.oldest === null ? <span className="text-muted">—</span> : <span className="num text-[12.5px]">{daysText(r.oldest)}</span>), sort: (r) => r.oldest ?? -1, csv: (r) => r.oldest ?? '' },
    { key: 'amount', header: 'Amount in open cases', align: 'right', render: (r) => <div>{amountsOf(r.amounts)}{r.open.length > r.withAmount && <div className="text-[11px] text-muted">{plural(r.open.length - r.withAmount, 'case')} without an amount</div>}</div>, sort: (r) => [...r.amounts.values()].reduce((a, v) => a + v.toNumber(), 0), csv: (r) => amountsCsv(r.amounts) },
    { key: 'completed', header: 'Completed', align: 'right', render: (r) => <span className="num">{r.completed}</span>, sort: (r) => r.completed, csv: (r) => r.completed },
    { key: 'cancelled', header: 'Cancelled', align: 'right', render: (r) => <span className={cx('num', !r.cancelled && 'text-muted')}>{r.cancelled}</span>, sort: (r) => r.cancelled, csv: (r) => r.cancelled },
  ]

  const stepCell = (c: FlowCase) => {
    const s = activeStepOf(c)
    if (!s) return <span className="text-muted">—</span>
    return <div className="min-w-0"><ActionChip action={s.action} /><div className="mt-0.5 truncate text-[11.5px] text-ink2">{s.step_no}. {s.name}</div></div>
  }
  const caseColumns: Column<FlowCase>[] = [
    { key: 'no', header: 'Number', render: (c) => <span className="num text-[12.5px] text-gold">{c.case_no}</span>, sort: (c) => c.case_no, csv: (c) => c.case_no },
    { key: 'title', header: 'Title', render: (c) => <div className="min-w-0 max-w-[340px]"><div className="truncate text-ink">{c.title}</div>{c.confidentiality !== 'internal' && <div className="text-[11px] text-violet">{human(c.confidentiality)}</div>}</div>, sort: (c) => c.title.toLowerCase(), csv: (c) => c.title },
    { key: 'flow', header: 'Workflow', render: (c) => <span className="text-[12.5px] text-ink2">{flowName(c.flow_id)}</span>, sort: (c) => flowName(c.flow_id).toLowerCase(), csv: (c) => flowName(c.flow_id) },
    { key: 'company', header: 'Company', render: (c) => <span className="text-ink2" title={companyName(c.company_id)}>{companyCode(c.company_id)}</span>, sort: (c) => companyName(c.company_id), csv: (c) => companyName(c.company_id) },
    { key: 'party', header: 'Party', render: (c) => (c.party_id ? <span className="text-ink2">{partyName(c.party_id)}</span> : <span className="text-muted">—</span>), sort: (c) => partyName(c.party_id).toLowerCase(), csv: (c) => (c.party_id ? partyName(c.party_id) : '') },
    { key: 'amount', header: 'Amount', align: 'right', render: (c) => (c.amount === null || c.amount === undefined ? <span className="text-muted">—</span> : <Money value={c.amount} currency={ccyOf(c.company_id)} />), sort: (c) => D(c.amount).toNumber(), csv: (c) => (c.amount === null || c.amount === undefined ? '' : D(c.amount).toFixed(2)) },
    { key: 'step', header: 'Waiting at', render: stepCell, sort: (c) => activeStepOf(c)?.step_no ?? 99, csv: (c) => { const s = activeStepOf(c); return s ? `${s.step_no}. ${s.name} (${actionMeta(s.action).label})` : '' } },
    { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} />, sort: (c) => c.status, csv: (c) => c.status },
    { key: 'started', header: 'Started', render: (c) => <div><div className="num text-[12.5px]">{fmtDate(c.started_at.slice(0, 10))}</div>{c.status === 'open' && <div className="text-[11px] text-muted">open for {daysText(age(c))}</div>}</div>, sort: (c) => c.started_at, csv: (c) => c.started_at },
  ]
  const longestColumns: Column<FlowCase>[] = [
    caseColumns[0], caseColumns[1], caseColumns[2], caseColumns[3], caseColumns[6],
    { key: 'age', header: 'Open for', align: 'right', render: (c) => <span className="num text-[12.5px] text-ink">{daysText(age(c))}</span>, sort: (c) => age(c), csv: (c) => age(c) },
    { key: 'waited', header: 'At this step for', align: 'right', render: (c) => <span className="num text-[12.5px]">{daysText(waited(c))}</span>, sort: (c) => waited(c), csv: (c) => waited(c) },
    caseColumns[5],
  ]

  const openOn = (d: FlowDef) => cases.filter((c) => c.flow_id === d.id && c.status === 'open').length
  const defColumns: Column<FlowDef>[] = [
    { key: 'name', header: 'Workflow', render: (d) => <div className="min-w-0 max-w-[300px]"><div className="truncate text-ink">{d.name}</div>{d.description && <div className="truncate text-[11.5px] text-muted" title={d.description}>{d.description}</div>}<div className="mt-1.5"><PathStrip steps={d.definition.steps ?? []} size={20} wrap={false} /></div></div>, sort: (d) => d.name.toLowerCase(), csv: (d) => d.name },
    { key: 'key', header: 'Key', render: (d) => <span className="num text-[12.5px] text-gold">{d.key}</span>, sort: (d) => d.key, csv: (d) => d.key },
    { key: 'version', header: 'Ver.', align: 'right', width: 56, render: (d) => <span className="num" title={`Version ${d.version}`}>{d.version}</span>, sort: (d) => d.version, csv: (d) => d.version },
    { key: 'category', header: 'Category', render: (d) => <span className="text-[12.5px] text-ink2">{d.category}</span>, sort: (d) => d.category.toLowerCase(), csv: (d) => d.category },
    { key: 'company', header: 'For', render: (d) => (d.company_id ? <span className="text-ink2" title={companyName(d.company_id)}>{companyCode(d.company_id)}</span> : <span className="chip gold"><Globe2 size={11} /> whole group</span>), sort: (d) => (d.company_id ? companyName(d.company_id) : ''), csv: (d) => (d.company_id ? companyName(d.company_id) : 'Whole group') },
    { key: 'trigger', header: 'Trigger', render: (d) => <div><TriggerChip trigger={d.trigger_kind} />{!triggerWorks(d.trigger_kind) && <div className="mt-0.5 text-[11px] text-warn">{INTENT_NOTE}</div>}</div>, sort: (d) => d.trigger_kind, csv: (d) => `${triggerLabel(d.trigger_kind)}${triggerWorks(d.trigger_kind) ? '' : ` (${INTENT_NOTE})`}` },
    { key: 'steps', header: 'Steps', align: 'right', render: (d) => <span className="num">{d.definition.steps?.length ?? 0}</span>, sort: (d) => d.definition.steps?.length ?? 0, csv: (d) => d.definition.steps?.length ?? 0 },
    { key: 'cases', header: 'Open cases', align: 'right', render: (d) => (openOn(d) ? <button className="link num text-[12.5px]" onClick={(e) => { e.stopPropagation(); go({ tab: 'cases', flow: d.id, status: 'open' }) }}>{openOn(d)}</button> : <span className="num text-muted">0</span>), sort: (d) => openOn(d), csv: (d) => openOn(d) },
    { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status} label={d.status === 'draft' ? 'draft — not in use' : undefined} />, sort: (d) => d.status, csv: (d) => d.status },
    {
      key: 'act', header: '', align: 'right',
      render: (d) => (
        <span className="no-print inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="btn sm icon ghost" onClick={() => nav('/studio/flows/' + d.id)} aria-label={`Open ${d.name}`} title={d.status === 'draft' && mayChange(d) ? 'Open in the designer' : 'Open'}>{d.status === 'draft' && mayChange(d) ? <PencilLine size={13} /> : <Eye size={13} />}</button>
          <button className="btn sm icon ghost" disabled={!mayDesign} aria-label={`Clone ${d.name}`} title={noDesign ?? 'Clone: make a copy under a new key'} onClick={() => setCloning(d)}><Copy size={13} /></button>
          {d.status !== 'active' && <button className="btn sm good" disabled={!mayChange(d)} title={whyNotChange(d) ?? 'New cases will follow this version'} onClick={() => setChanging({ def: d, to: 'active' })}><Play size={13} /> Make active</button>}
          {d.status === 'active' && <button className="btn sm" disabled={!mayChange(d)} title={whyNotChange(d) ?? 'No new case can be started on it'} onClick={() => setChanging({ def: d, to: 'retired' })}><Archive size={13} /> Retire</button>}
        </span>
      ),
    },
  ]

  const d = main.data

  return (
    <div>
      <PageHeader
        eyebrow="Scenario Studio"
        title="Ways of working, and the cases that follow them"
        subtitle={<>
          {plural(ids.length, 'company', 'companies')} · a workflow says who does what, in which order, and which record each step points to. It posts nothing and releases no money.
          <DemoTag className="ml-2" />
        </>}
        actions={<>
          <button className="btn" disabled={!manageIds.length} title={noManage} onClick={() => setStarting({})}><Play size={15} /> Start a case</button>
          <button className="btn primary" disabled={!mayDesign} title={noDesign} onClick={() => nav('/studio/flows/new')}><Plus size={15} /> Design a workflow</button>
        </>}
      />

      {main.error && <ErrorBox message={main.error} retry={main.reload} />}
      {!main.error && !d && <Panel><Loading rows={6} label="Loading the studio" /></Panel>}

      {d && (
        <>
          <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Workflows in use" tone="text-gold" onClick={() => go({ tab: 'workflows' })} sub={`${plural(byStatus.draft, 'draft')} · ${byStatus.retired.toLocaleString()} retired`}><span className="num">{byStatus.active}</span></Tile>
            <Tile label="Open cases" onClick={() => go({ tab: 'cases', status: 'open' })} sub={oldestOpen ? `the oldest has been open for ${daysText(age(oldestOpen))}` : 'no case is open'}><span className="num">{open.length}</span></Tile>
            <Tile label="Completed" tone="text-pos" onClick={() => go({ tab: 'cases', status: 'completed' })} sub={`${cancelled.length.toLocaleString()} cancelled`}><span className="num">{completed.length}</span></Tile>
            {oneCurrency ? (
              <Stat label="Amount in open cases" value={[...openAmounts.values()][0] ?? ZERO} currency={[...openAmounts.keys()][0] ?? currency} onClick={() => go({ tab: 'cases', status: 'open' })}
                sub={`stated on ${openWithAmount.toLocaleString()} of ${plural(open.length, 'open case')} · not money released`} />
            ) : (
              <Tile label="Amount in open cases" sub="The companies selected keep their books in different currencies. The amounts are shown by workflow, each in its own currency.">
                <span className="text-[14px] text-ink2">Not added</span>
              </Tile>
            )}
          </div>

          <Tabs<TabKey> tabs={TABS.map((t) => ({ ...t, count: t.key === 'workflows' ? defs.length : t.key === 'cases' ? cases.length : undefined }))} value={tab} onChange={(k) => go({ tab: k })} />

          {tab === 'dashboard' && (
            <div className="space-y-4">
              <Note>
                Every figure here counts the workflows and the cases you may read in the {plural(ids.length, 'company', 'companies')} selected. A case above your clearance is not sent to you and is not counted.
                The amount of a case is what was stated when it was started. It is not an amount approved, released or spent: those are on the records the steps point to.
              </Note>

              <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
                <Section title="Workflows by status">
                  <Panel className="p-4" lit={false}>
                    {defs.length === 0 ? <div className="text-[12.5px] text-muted">No workflow has been designed.</div> : (
                      <>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface2" role="img" aria-label={`${byStatus.active} active, ${byStatus.draft} draft, ${byStatus.retired} retired`}>
                          <span style={{ width: `${(byStatus.active / defs.length) * 100}%`, background: 'var(--pos)' }} />
                          <span style={{ width: `${(byStatus.draft / defs.length) * 100}%`, background: 'var(--gold)' }} />
                          <span style={{ width: `${(byStatus.retired / defs.length) * 100}%`, background: 'var(--muted)' }} />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3">
                          {([['active', 'Active', 'var(--pos)', 'new cases follow them'], ['draft', 'Draft', 'var(--gold)', 'not in use'], ['retired', 'Retired', 'var(--muted)', 'no new case']] as const).map(([k, label, c, sub]) => (
                            <div key={k} className="min-w-0">
                              <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{label}</div>
                              <div className="num display mt-0.5 text-[20px] text-ink">{byStatus[k]}</div>
                              <div className="text-[11px] text-muted">{sub}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 border-t border-line pt-2.5 text-[11.5px] text-muted">Each version of a workflow is counted once: {plural(defs.length, 'version')} of {plural(new Set(defs.map((x) => `${x.company_id ?? ''}|${x.key}`)).size, 'workflow')}.</div>
                      </>
                    )}
                  </Panel>
                </Section>

                <Section title="Open cases waiting at each kind of step">
                  <Panel className="p-3" lit={false}>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
                      {waitingAt.map((w) => (
                        <button key={w.action} disabled={!w.count} onClick={() => go({ tab: 'cases', status: 'open', waiting: w.action })} title={actionMeta(w.action).says}
                          className={cx('flex min-w-0 flex-col items-center gap-1.5 rounded-xl border border-line px-2 py-3 text-center transition-colors', w.count ? 'hover:border-line2 hover:bg-surface2' : 'cursor-default opacity-60')}>
                          <ActionNode action={w.action} size={34} state={w.count ? 'plain' : 'pending'} />
                          <span className="num display text-[18px] leading-none text-ink">{w.count}</span>
                          <span className="text-[11px] leading-tight text-ink2">{actionMeta(w.action).label}</span>
                          <span className="text-[10.5px] leading-tight text-muted">{w.count ? `longest ${daysText(w.longest)}` : 'none'}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-2.5 px-1 text-[11.5px] text-muted">
                      A case is counted at the step that is in turn. "Longest" is the time since the step before it was recorded, or since the case was started. The engine holds no due date for a step, so nothing here is called overdue.
                    </div>
                  </Panel>
                </Section>
              </div>

              <Section title="By workflow: open, completed and cancelled cases, and the amount in open cases">
                <Panel lit={false}>
                  <DataTable columns={flowColumns} rows={flowRows} rowKey={(r) => r.flowId} onRow={(r) => go({ tab: 'cases', flow: r.flowId })} exportName="studio-cases-by-workflow"
                    footer={<tr>
                      <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')}>Total · {plural(flowRows.length, 'workflow')}</td>
                      <td className={foot}><span className="num text-ink">{open.length}</span></td>
                      <td className={foot} />
                      <td className={cx(foot, 'r')}>{amountsOf(openAmounts)}</td>
                      <td className={cx(foot, 'r')}><span className="num">{completed.length}</span></td>
                      <td className={cx(foot, 'r')}><span className="num">{cancelled.length}</span></td>
                    </tr>}
                    empty={{ title: 'No workflow is active and no case exists', body: 'Design a workflow, make it active, and start a case on it.', icon: <Workflow size={20} /> }} />
                </Panel>
                {chartable && (
                  <Panel className="mt-3 p-4" lit={false}>
                    <BarChart height={220} data={chartRows.map((r) => ({ label: r.def?.name ?? 'Not shared', values: [{ key: 'Amount in open cases', value: (r.amounts.get(currency) ?? ZERO).toNumber() }] }))}
                      onBar={(label) => { const r = chartRows.find((x) => (x.def?.name ?? 'Not shared') === label); if (r) go({ tab: 'cases', flow: r.flowId, status: 'open' }) }} />
                    <div className="mt-1 text-[11.5px] text-muted">Amount in open cases = the sum of the amounts stated on the open cases of a workflow. Cases without an amount add nothing.</div>
                  </Panel>
                )}
              </Section>

              {lensRow?.def && (
                <Section title="One workflow, step by step"
                  right={<select className="field sm" style={{ width: 300 }} value={lensRow.flowId} onChange={(e) => setLens(e.target.value)} aria-label="Workflow to look at">{lensChoices.map((r) => <option key={r.flowId} value={r.flowId}>{r.def!.name} · v{r.def!.version} · {r.open.length} open</option>)}</select>}>
                  <Panel className="overflow-x-auto p-4" lit={false}>
                    <div className="flex min-w-max items-start">
                      {(lensRow.def.definition.steps ?? []).map((s, i, all) => {
                        const here = lensRow.open.filter((c) => activeStepOf(c)?.step_key === s.key)
                        const longestHere = here.reduce((n, c) => Math.max(n, waited(c)), 0)
                        return (
                          <div key={s.key + i} className="flex items-start">
                            <button className={cx('flex w-[132px] flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-center transition-colors', here.length ? 'hover:bg-surface2' : 'cursor-default')} disabled={!here.length}
                              onClick={() => go({ tab: 'cases', flow: lensRow.flowId, status: 'open', waiting: s.action })} title={actionMeta(s.action).says}>
                              <ActionNode action={s.action} size={40} state={here.length ? 'active' : 'pending'} />
                              <span className="num display text-[18px] leading-none text-ink">{here.length}</span>
                              <span className="text-[11.5px] leading-tight text-ink2">{s.name}</span>
                              <span className="text-[10.5px] leading-tight text-muted">{actionMeta(s.action).label}{s.optional ? ' · optional' : ''}{s.links_to ? ` · ${linkMeta(s.links_to).one}` : ''}</span>
                              {here.length > 0 && <span className="text-[10.5px] text-warn">longest {daysText(longestHere)}</span>}
                            </button>
                            {i < all.length - 1 && <ArrowRight size={14} className="mt-[22px] flex-none text-muted" />}
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-2 text-[11.5px] text-muted">The figure under each step is the number of open cases of this version that wait there. {plural(lensRow.completed, 'case')} of it {lensRow.completed === 1 ? 'is' : 'are'} completed and {lensRow.cancelled.toLocaleString()} cancelled.</div>
                  </Panel>
                </Section>
              )}

              <Section title="Cases open longest">
                <Panel lit={false}>
                  <DataTable columns={longestColumns} rows={longest} rowKey={(c) => c.id} onRow={(c) => nav('/studio/cases/' + c.id)} exportName="studio-cases-open-longest"
                    toolbar={<span className="text-[12px] text-muted">The ten open cases that were started first{open.length > 10 ? `, of ${open.length.toLocaleString()} open` : ''}. Open for = today less the day the case was started.</span>}
                    empty={{ title: 'No case is open', body: 'Every case in the companies selected is completed or cancelled, or none has been started.', icon: <Hourglass size={20} /> }} />
                </Panel>
              </Section>
            </div>
          )}

          {tab === 'workflows' && (
            <div className="space-y-4">
              <Panel lit={false}>
                <DataTable columns={defColumns} rows={defs} rowKey={(x) => x.id} onRow={(x) => nav('/studio/flows/' + x.id)} exportName="studio-workflows" initialSort={{ key: 'key', dir: 'asc' }}
                  toolbar={<span className="text-[12px] text-muted">A workflow in use is never edited: a change is saved as its next version, and cases already started keep the steps they started with. Workflows of the whole group and of the companies selected are listed.</span>}
                  empty={{ title: 'No workflow has been designed', body: 'Start from an example below, or from an empty canvas. Nothing is saved until you save it.', icon: <Workflow size={20} />, action: <button className="btn sm" disabled={!mayDesign} title={noDesign} onClick={() => nav('/studio/flows/new')}><Plus size={13} /> Design a workflow</button> }} />
              </Panel>

              <Section title="Examples to start from" right={<span className="text-[11.5px] text-muted">{FLOW_EXAMPLES.length} examples · choosing one opens the designer filled in · nothing is saved until you save</span>}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ExampleCard title="An empty canvas" category="Custom" description="A workflow of your own, from the first step." disabled={!mayDesign} why={noDesign} onUse={() => nav('/studio/flows/new')}
                    foot={<span className="text-[11.5px] text-muted">One step to begin with; you add the rest.</span>} icon={<Plus size={16} />} />
                  {FLOW_EXAMPLES.map((ex) => {
                    const fit = adaptExample(ex, roles.data ?? null, null)
                    const docs = new Set(fit.definition.steps.flatMap((s) => s.required_documents ?? []))
                    const taken = defs.filter((x) => x.key === ex.key)
                    return (
                      <ExampleCard key={ex.key} title={ex.name} category={ex.category} description={ex.description} disabled={!mayDesign} why={noDesign} onUse={() => nav('/studio/flows/new?example=' + ex.key)} icon={<Sparkles size={15} />}
                        foot={<>
                          <PathStrip steps={ex.definition.steps} />
                          <div className="mt-2 text-[11.5px] text-muted">
                            {plural(ex.definition.steps.length, 'step')} · {plural(ex.definition.fields?.length ?? 0, 'field')} in the form · {docs.size ? `${plural(docs.size, 'kind')} of document required` : 'no document required'}
                          </div>
                          {!triggerWorks(ex.trigger_kind) && <div className="mt-1 text-[11.5px] text-warn">Trigger: {triggerLabel(ex.trigger_kind).toLowerCase()} — {INTENT_NOTE}.</div>}
                          {!roles.loading && fit.replaced.length > 0 && <div className="mt-1 text-[11.5px] text-muted">{roles.data ? `${plural(new Set(fit.replaced.map((r) => r.role)).size, 'role')} it names ${new Set(fit.replaced.map((r) => r.role)).size === 1 ? 'does' : 'do'} not exist in this group` : 'The roles of this group could not be read'}: those steps open to anyone authorised.</div>}
                          {taken.length > 0 && <div className="mt-1 text-[11.5px] text-muted">The key <span className="num text-ink2">{ex.key}</span> is already in use here ({taken.map((x) => `v${x.version} ${x.status}`).join(', ')}).</div>}
                        </>} />
                    )
                  })}
                </div>
              </Section>
            </div>
          )}

          {tab === 'cases' && (
            <Panel lit={false}>
              <DataTable columns={caseColumns} rows={shown} rowKey={(c) => c.id} onRow={(c) => nav('/studio/cases/' + c.id)} exportName="studio-cases" initialSort={{ key: 'started', dir: 'desc' }}
                toolbar={<>
                  <select className="field sm" style={{ width: 230 }} value={filter.flow} onChange={(e) => setFilter({ flow: e.target.value })} aria-label="Workflow">
                    <option value="">Every workflow</option>
                    {flowRows.filter((r) => r.open.length + r.completed + r.cancelled > 0 || r.flowId === filter.flow).map((r) => <option key={r.flowId} value={r.flowId}>{r.def ? `${r.def.name} · v${r.def.version}` : 'A workflow not shared with you'}</option>)}
                  </select>
                  <select className="field sm" style={{ width: 140 }} value={filter.status} onChange={(e) => setFilter({ status: e.target.value })} aria-label="Status">
                    <option value="">Every status</option><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select>
                  <select className="field sm" style={{ width: 190 }} value={filter.company} onChange={(e) => setFilter({ company: e.target.value })} aria-label="Company">
                    <option value="">Every company selected</option>
                    {companies.filter((c) => ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </select>
                  <select className="field sm" style={{ width: 190 }} value={filter.waiting} onChange={(e) => setFilter({ waiting: e.target.value })} aria-label="Kind of step the case waits at">
                    <option value="">Waiting at any step</option>
                    {FLOW_ACTIONS.map((a) => <option key={a} value={a}>Waiting at: {actionMeta(a).label.toLowerCase()}</option>)}
                  </select>
                  {filtered && <button className="btn sm ghost" onClick={() => go({ tab: 'cases' })}>Clear</button>}
                  <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setStarting({ flowId: filter.flow || undefined })}><Play size={13} /> Start a case</button>
                </>}
                footer={<tr>
                  <td className={cx(foot, 'text-[12.5px] font-medium text-ink2')} colSpan={5}>{plural(shown.length, 'case')}{filtered ? ` of ${cases.length.toLocaleString()}` : ''}</td>
                  <td className={cx(foot, 'r')}>{amountsOf(shownAmounts)}</td>
                  <td className={foot} colSpan={3} />
                </tr>}
                empty={filtered
                  ? { title: 'No case matches', body: 'No case you may read in the companies selected matches these filters.', icon: <Hourglass size={20} />, action: <button className="btn sm" onClick={() => go({ tab: 'cases' })}>Clear the filters</button> }
                  : { title: 'No case has been started', body: 'A case follows an active workflow, step by step. Cases above your clearance are not sent to you.', icon: <Hourglass size={20} />, action: <button className="btn sm" disabled={!manageIds.length} title={noManage} onClick={() => setStarting({})}><Play size={13} /> Start a case</button> }} />
            </Panel>
          )}
        </>
      )}

      <StartCase open={!!starting} presetFlow={starting?.flowId} defs={defs} companyIds={manageIds} onClose={() => setStarting(null)} onStarted={(id) => nav('/studio/cases/' + id)} />
      <CloneDialog def={cloning} defs={defs} onClose={() => setCloning(null)} onCloned={(id) => nav('/studio/flows/' + id)} />
      <StatusDialog def={changing?.def ?? null} to={changing?.to ?? 'active'} defs={defs} openCases={changing ? openOn(changing.def) : undefined} onClose={() => setChanging(null)} />
    </div>
  )
}

function ExampleCard({ title, category, description, foot: footer, icon, disabled, why, onUse }: { title: string; category: string; description: string; foot: ReactNode; icon: ReactNode; disabled: boolean; why?: string; onUse: () => void }) {
  return (
    <Panel className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="display text-[14px] font-medium text-ink">{title}</div>
          <div className="mt-1 text-[12.5px] text-muted">{description}</div>
        </div>
        <span className="chip flex-none">{category}</span>
      </div>
      <div className="mt-3 min-w-0 flex-1">{footer}</div>
      <div className="mt-3 flex justify-end">
        <button className="btn sm" disabled={disabled} title={why} onClick={onUse}>{icon} Use as a starting point</button>
      </div>
    </Panel>
  )
}

// =====================================================================
// A copy of a workflow (spec 1828): a draft under a new key
// =====================================================================
function CloneDialog({ def, defs, onClose, onCloned }: { def: FlowDef | null; defs: FlowDef[]; onClose: () => void; onCloned: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const companies = useApp((s) => s.companies)
  const admin = useApp((s) => !!s.session?.isGroupAdmin)
  const companyName = useCompanyName()
  const { run, busy, refusal, clear } = useRefusing()
  const targets = useMemo(() => companies.filter((c) => c.status === 'active' && can('flow.configure', c.id)), [companies])
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [target, setTarget] = useState<string>('')
  useEffect(() => {
    if (!def) return
    clear()
    setName(`${def.name} (copy)`)
    setKey(slug(`${def.key}_copy`))
    setTarget(def.company_id && targets.some((c) => c.id === def.company_id) ? def.company_id : !def.company_id && admin ? 'group' : targets[0]?.id ?? (admin ? 'group' : ''))
  }, [def?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const companyId: ID | null = target === 'group' ? null : target
  const siblings = defs.filter((x) => x.key === key && (x.company_id ?? null) === companyId)
  const next = Math.max(0, ...siblings.map((x) => x.version)) + 1
  const whose = companyId ? companyName(companyId) : 'the whole group'
  const problems: string[] = []
  if (!name.trim()) problems.push('Give the copy a name.')
  if (!key.trim()) problems.push('Give the copy a key.')
  if (!target) problems.push('Choose the company the copy is for.')
  if (target === 'group' && !admin) problems.push('A workflow for the whole group is designed by a Group Super Admin. Choose a company.')

  const save = async () => {
    if (!def) return
    const id = await run(() => api.cloneFlowDef(def.id, key, name.trim(), companyId), 'The copy is saved as a draft')
    if (id) { onClose(); onCloned(id) }
  }

  return (
    <Modal open={!!def} onClose={onClose} width={560} title="Clone this workflow" subtitle={def ? <>{def.name} · <span className="num">{def.key}</span> · version <span className="num">{def.version}</span> · {def.company_id ? companyName(def.company_id) : 'whole group'}</> : undefined}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void save()}>{busy ? <Spinner /> : <Copy size={15} />} Save the copy as a draft</button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name of the copy" className="sm:col-span-2"><input className="field" value={name} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Key of the copy" hint="Small letters, figures and underscores. The numbers of its cases begin with its first four characters.">
          <input className="field num" value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48))} />
        </Field>
        <Field label="For" hint={admin ? undefined : 'A workflow for the whole group is designed by a Group Super Admin.'}>
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose…</option>
            {admin && <option value="group">The whole group</option>}
            {targets.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
      </div>
      <Note className="mt-4">
        {def && <>The copy carries the {plural(def.definition.steps?.length ?? 0, 'step')}, the form and the description of the workflow it is copied from, and remembers where it came from. </>}
        {target && key.trim() ? (siblings.length
          ? <>The key <span className="num text-ink">{key}</span> already exists for {whose} ({siblings.map((x) => `version ${x.version}, ${x.status}`).join('; ')}). The copy is saved as version <span className="num text-ink">{next}</span> of that key, as a draft.</>
          : <>It is saved as version <span className="num text-ink">1</span> of <span className="num text-ink">{key}</span> for {whose}, as a draft.</>) : null}
        {' '}A draft is changed freely in the designer. The workflow it is copied from is not changed, and no case is copied.
      </Note>
      {problems.length > 0 && <div className="mt-3 text-[12px] text-warn">{problems[0]}</div>}
      <Refusal message={refusal} className="mt-3" />
    </Modal>
  )
}

// =====================================================================
// A new case
// =====================================================================
type Answer = string | boolean
const blankAnswer = (v: Answer | undefined) => v === undefined || (typeof v === 'string' && v.trim() === '')

function StartCase({ open, presetFlow, defs, companyIds, onClose, onStarted }: { open: boolean; presetFlow?: ID; defs: FlowDef[]; companyIds: ID[]; onClose: () => void; onStarted: (id: ID) => void }) {
  const api = useApp((s) => s.api)!
  const parties = useApp((s) => s.parties)
  const companies = useApp((s) => s.companies)
  const choices = useCompanyChoices(companyIds)
  const { run, busy, refusal, clear } = useRefusing()

  const usable = useMemo(() => defs.filter((d) => d.status === 'active' && (d.company_id === null || companyIds.includes(d.company_id))).sort((a, b) => a.name.localeCompare(b.name)), [defs, companyIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [flowId, setFlowId] = useState<ID>('')
  const [companyId, setCompanyId] = useState<ID>('')
  const [title, setTitle] = useState('')
  const [partyId, setPartyId] = useState<ID>('')
  const [amount, setAmount] = useState('')
  const [itemId, setItemId] = useState<ID>('')
  const [level, setLevel] = useState<Confidentiality>('internal')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})

  const def = usable.find((d) => d.id === flowId) ?? null
  const companyFor = (d: FlowDef | null, current: ID) => (d?.company_id ? d.company_id : choices.some((c) => c.id === current) ? current : choices.length === 1 ? choices[0].id : '')
  useEffect(() => {
    if (!open) return
    clear()
    const first = usable.find((d) => d.id === presetFlow) ?? (usable.length === 1 ? usable[0] : null)
    setFlowId(first?.id ?? ''); setCompanyId(companyFor(first, '')); setTitle(''); setPartyId(''); setAmount(''); setItemId(''); setLevel('internal'); setAnswers({})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const chooseFlow = (id: ID) => { const d = usable.find((x) => x.id === id) ?? null; setFlowId(id); setCompanyId(companyFor(d, companyId)); setAnswers({}); setItemId('') }

  const fields = def?.definition.fields ?? []
  const companyChoices = def?.company_id ? choices.filter((c) => c.id === def.company_id) : choices
  const currency = companies.find((c) => c.id === companyId)?.base_currency
  const partyChoices = useMemo(() => parties.filter((p) => p.status !== 'terminated' && p.roles.some((r) => r.company_id === companyId)).sort((a, b) => a.display_name.localeCompare(b.display_name)), [parties, companyId])
  const readsRegisters = !!companyId && can('register.view', companyId)
  const items = useAsync(async () => (open && readsRegisters ? api.listRegisterItems({ companyIds: [companyId] }) : null), [api, open, companyId, readsRegisters])
  const wantedKind = def?.definition.register_kind
  const itemChoices = useMemo(() => [...(items.data ?? [])].filter((r) => r.status !== 'cancelled').sort((a, b) => Number(b.kind === wantedKind) - Number(a.kind === wantedKind) || a.ref_no.localeCompare(b.ref_no)), [items.data, wantedKind])

  const missing = fields.filter((f) => f.required && blankAnswer(answers[f.key]))
  const problems: string[] = []
  if (!def) problems.push('Choose the workflow the case follows.')
  if (!companyId) problems.push('Choose the company.')
  if (!title.trim()) problems.push('Give the case a title.')
  if (missing.length) problems.push(`Required information is missing — ${missing.map((f) => f.label).join(', ')}.`)
  const touched = !!(title || amount || Object.keys(answers).length)

  const answer = (k: string, v: Answer | undefined) => setAnswers((a) => { const n = { ...a }; if (v === undefined) delete n[k]; else n[k] = v; return n })
  const start = async () => {
    if (!def) return
    const data: Record<string, unknown> = {}
    for (const f of fields) { const v = answers[f.key]; if (!blankAnswer(v)) data[f.key] = typeof v === 'string' ? v.trim() : v }
    const input: FlowCaseInput = { flow_id: def.id, company_id: companyId, title: title.trim(), party_id: partyId || null, ...(amount.trim() ? { amount: D(amount).toString() } : {}), register_item_id: itemId || null, data, confidentiality: level }
    const id = await run(() => api.startFlowCase(input), 'Case started')
    if (id) { onClose(); onStarted(id) }
  }

  return (
    <Drawer open={open} onClose={onClose} width={640} title="Start a case" subtitle="Starting a case records that it began, and by whom. It approves nothing, posts nothing and moves no money."
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void start()}>{busy ? <Spinner /> : <Play size={15} />} Start the case</button>
      </>}>
      {usable.length === 0 ? (
        <Empty icon={<Workflow size={20} />} title="No active workflow to start" body="A case can be started only on an active workflow of the whole group, or of a company in which you read workflows (flow.view). Drafts and retired workflows start nothing." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Workflow" className="sm:col-span-2" hint="Only active workflows are listed.">
              <select className="field" value={flowId} onChange={(e) => chooseFlow(e.target.value)}>
                <option value="">Choose…</option>
                {usable.map((d) => <option key={d.id} value={d.id}>{d.name} · v{d.version} · {d.company_id ? companies.find((c) => c.id === d.company_id)?.code ?? 'one company' : 'whole group'}</option>)}
              </select>
            </Field>
            {def && (
              <div className="sm:col-span-2">
                <Panel className="p-3.5" lit={false}>
                  <div className="flex flex-wrap items-center gap-2"><PathStrip steps={def.definition.steps ?? []} /><span className="text-[11.5px] text-muted">{plural(def.definition.steps?.length ?? 0, 'step')}</span></div>
                  {def.description && <div className="mt-2 text-[12.5px] text-ink2">{def.description}</div>}
                  {!triggerWorks(def.trigger_kind) && <div className="mt-2 text-[11.5px] text-warn">The trigger of this workflow, {triggerLabel(def.trigger_kind).toLowerCase()}, is {INTENT_NOTE}. A person starts each case, here.</div>}
                  {def.definition.steps?.some((s) => s.action === 'approval') && <div className="mt-2 text-[11.5px] text-muted">The person who starts a case cannot approve it: the approval steps are for a second person.</div>}
                </Panel>
              </div>
            )}
            <Field label="Company" hint={def?.company_id ? 'This workflow belongs to one company.' : undefined}>
              <select className="field" value={companyId} disabled={!!def?.company_id} onChange={(e) => { setCompanyId(e.target.value); setPartyId(''); setItemId('') }}>
                <option value="">Choose…</option>
                {companyChoices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="Confidentiality" hint="People without clearance for the level chosen do not receive the case. The engine refuses a level you are not cleared for yourself.">
              <select className="field" value={level} onChange={(e) => setLevel(e.target.value as Confidentiality)}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
            </Field>
            <Field label="Title" className="sm:col-span-2" hint="What the case is about, in a line."><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Party (optional)" hint={companyId ? 'The person or organisation the case concerns.' : 'Choose the company first.'}>
              <select className="field" value={partyId} disabled={!companyId} onChange={(e) => setPartyId(e.target.value)}><option value="">None</option>{partyChoices.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.party_no}</option>)}</select>
            </Field>
            <Field label={`Amount (optional${currency ? `, ${currency}` : ''})`} hint="What the case is about. It is not an amount approved or released.">
              <input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(digits(e.target.value))} />
            </Field>
            <Field label="Register item (optional)" className="sm:col-span-2"
              hint={!companyId ? 'Choose the company first.' : !readsRegisters ? 'Your role does not read the registers of this company, so their items cannot be listed here.' : items.error ? `The registers could not be read: ${items.error}` : wantedKind ? `The contract, lease or policy the case belongs to. This workflow expects an item of the kind ${human(wantedKind)}; those are listed first.` : 'The contract, lease, project or policy the case belongs to.'}>
              <select className="field" value={itemId} disabled={!readsRegisters || !items.data} onChange={(e) => setItemId(e.target.value)}>
                <option value="">{readsRegisters && !items.data && !items.error ? 'Loading…' : 'None'}</option>
                {itemChoices.map((r) => <option key={r.id} value={r.id}>{r.ref_no} · {r.title} · {human(r.kind)}</option>)}
              </select>
            </Field>
          </div>

          {def && (
            <div className="mt-5">
              <div className="eyebrow mb-2.5">The form of this workflow</div>
              {fields.length === 0 ? <div className="text-[12.5px] text-muted">This workflow asks for nothing more at the start.</div> : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((f) => {
                    const v = answers[f.key]
                    const label = f.label + (f.required ? ' *' : '')
                    const text = typeof v === 'string' ? v : ''
                    const type = f.type ?? 'text'
                    return (
                      <Field key={f.key} label={label}>
                        {type === 'boolean' ? <select className="field" value={v === undefined ? '' : String(v)} onChange={(e) => answer(f.key, e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select>
                          : type === 'select' ? <select className="field" value={text} onChange={(e) => answer(f.key, e.target.value || undefined)}><option value="">—</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                          : type === 'date' ? <input type="date" className="field" value={text} onChange={(e) => answer(f.key, e.target.value || undefined)} />
                          : type === 'number' || type === 'money' ? <input className="field num" inputMode="decimal" value={text} onChange={(e) => answer(f.key, digits(e.target.value) || undefined)} />
                          : <input className="field" value={text} onChange={(e) => answer(f.key, e.target.value === '' ? undefined : e.target.value)} />}
                      </Field>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {problems.length > 0 && touched && <Note kind="warn" className="mt-4"><ul className="m-0 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
          <Refusal message={refusal} className="mt-4" />
        </>
      )}
    </Drawer>
  )
}
