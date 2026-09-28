// The living inventory of what NUMERO can do (spec 1503), and the switch that turns a
// capability on or off for the group, a company or a role (spec 1428).
//
// The inventory is written by hand and kept beside the code, because it has to say what a
// screen does NOT do as plainly as what it does. "state" is one of:
//   working         the screen and the engine behind it are built and tested
//   partial         part of what the specification asks is built; "limits" says what is not
//   recorded only   NUMERO keeps the record; the act itself happens outside NUMERO
//   not connected   the place for it exists; nothing outside NUMERO is connected to it

import type { ID } from './types'
import type { FeatureFlag } from './p3Types'

export type CapabilityState = 'working' | 'partial' | 'recorded only' | 'not connected'
export interface Capability {
  /** the key a feature flag names */
  key: string
  area: string
  label: string
  to: string
  perm?: string | string[]
  what: string
  state: CapabilityState
  limits?: string
  /** a capability the application cannot be run without is never switched off */
  core?: boolean
}

export const AREAS = ['Command', 'Accounting', 'Banking', 'Revenue', 'Purchasing', 'Expenses', 'Treasury', 'Assets', 'Inventory', 'Payroll', 'People Cost', 'Investments', 'Parties', 'Documents', 'Tax', 'Forward', 'Sentinel', 'Reality', 'Truth', 'Digital Twin', 'Scenario Studio', 'NUMI', 'Audit', 'Security', 'Integrations', 'Platform'] as const

export const CAPABILITIES: Capability[] = [
  // ------------------------------------------------------------ command
  { key: 'home', area: 'Command', label: 'Command Centre', to: '/', core: true, state: 'working', what: 'The position of the group today: cash, receivables, payables, profit, what needs attention.' },
  { key: 'cockpit', area: 'Command', label: 'Cockpit', to: '/cockpit', state: 'working', what: 'Ratios and trends of the companies selected, each with its formula.' },
  { key: 'money_map', area: 'Command', label: 'Money Map', to: '/money-map', state: 'working', what: 'Where money came from and where it went, drawn from posted entries.' },
  { key: 'analysis', area: 'Command', label: 'Analysis', to: '/analysis', perm: 'report.view', state: 'working', what: 'Year on year, burn rate, entries unusual for their ledger, compliance deadlines, and what is for the owner to see.', limits: 'Unusual entries are found by a statistical rule (median and spread of the ledger). It is a prompt to look, not a finding.' },
  // ------------------------------------------------------------ accounting
  { key: 'entry', area: 'Accounting', label: 'Transaction Centre', to: '/entry', state: 'working', what: 'A transaction described in words becomes a draft entry for a person to check.', limits: 'Suggestions come from rules and from what was approved before. No language model is connected.' },
  { key: 'journals', area: 'Accounting', label: 'Journals', to: '/journals', core: true, state: 'working', what: 'Double-entry journals: draft, submit, approve by a second person, post, reverse. Posted entries cannot be changed.' },
  { key: 'ledger', area: 'Accounting', label: 'General Ledger', to: '/ledger', core: true, state: 'working', what: 'Every posted line, with its source.' },
  { key: 'accounts', area: 'Accounting', label: 'Chart of Accounts', to: '/accounts', core: true, state: 'working', what: 'Ledgers of each company and the roles they play for the engines (account mapping).' },
  { key: 'reports', area: 'Accounting', label: 'Reports', to: '/reports', perm: 'report.view', state: 'partial', what: 'Trial balance, profit and loss, balance sheet, cash flow, ageing, consolidation with intercompany eliminations.', limits: 'Statutory formats (Schedule III, tax audit) are not produced.' },
  { key: 'budgets', area: 'Accounting', label: 'Budgets', to: '/budgets', state: 'working', what: 'Budgets by ledger and month, approval, and actual against budget.' },
  { key: 'close', area: 'Accounting', label: 'Period Close', to: '/close', state: 'working', what: 'Checklist of the close, soft close and lock of a month.' },
  { key: 'control', area: 'Accounting', label: 'Allocations & Reclassification', to: '/control', perm: ['allocation.manage', 'journal.view'], state: 'working', what: 'A shared cost divided between units by a recorded driver; a posted line moved to the ledger it belongs in. Both propose an entry and leave the original untouched.' },
  { key: 'imports', area: 'Accounting', label: 'Imports & Parallel Run', to: '/imports', perm: 'import.manage', state: 'working', what: 'Journals and opening balances brought in from a file after validation; the trial balance of the earlier system compared with NUMERO.', limits: 'Files are read as CSV. Entries arrive as drafts and go through approval like any other.' },
  // ------------------------------------------------------------ banking, revenue, purchasing
  { key: 'banking', area: 'Banking', label: 'Banking', to: '/banking', state: 'partial', what: 'Bank statements imported from a file and matched to the books.', limits: 'No bank is connected. Statements are imported as files.' },
  { key: 'payments', area: 'Banking', label: 'Payments & Receipts', to: '/payments', state: 'recorded only', what: 'Payments and receipts recorded against invoices and bills.', limits: 'NUMERO records that money moved. It does not move money.' },
  { key: 'invoices', area: 'Revenue', label: 'Sales & Billing', to: '/invoices', state: 'partial', what: 'Sales invoices and credit notes with tax, approval and posting.', limits: 'E-invoicing and e-way bills are not connected.' },
  { key: 'bills', area: 'Purchasing', label: 'Purchase Bills', to: '/bills', state: 'working', what: 'Vendor bills with tax, approval and posting; comparison with the order and the receipt.' },
  { key: 'purchasing', area: 'Purchasing', label: 'Purchasing', to: '/purchasing', perm: ['purchase.view', 'purchase.create'], state: 'working', what: 'Requisition, request for quotation, quotations compared, a vendor chosen by a person, order, receipt.' },
  // ------------------------------------------------------------ operations
  { key: 'expenses', area: 'Expenses', label: 'Expenses & Advances', to: '/expenses', perm: ['expense.view', 'expense.approve', 'expense.create'], state: 'working', what: 'Advances, expense claims with policy checks that flag and never reject, travel bookings with their parts, settlement.' },
  { key: 'cash', area: 'Treasury', label: 'Cash & Transfers', to: '/cash', perm: ['treasury.view', 'expense.approve'], state: 'working', what: 'Cash boxes, cash counts, transfers between accounts and between companies.' },
  { key: 'treasury', area: 'Treasury', label: 'Treasury', to: '/treasury', perm: 'treasury.view', state: 'working', what: 'Deposits, loans with their schedules, facilities and guarantees, foreign currency exposure.' },
  { key: 'assets', area: 'Assets', label: 'Fixed Assets', to: '/assets', perm: 'asset.view', state: 'working', what: 'Asset register, depreciation runs, disposal, impairment, verification.' },
  { key: 'inventory', area: 'Inventory', label: 'Inventory', to: '/inventory', perm: 'inventory.view', state: 'partial', what: 'Items, lots and serial numbers, receipts, issues, transfers, returns, adjustments, landed cost, stock counts, exposure to loss, reorder list, units sold and their service history.', limits: 'Manufacturing (bills of material, work in progress) is not built. Bar-code scanning is not connected.' },
  { key: 'payroll', area: 'Payroll', label: 'Payroll', to: '/payroll', perm: 'payroll.view', state: 'partial', what: 'Employees, salary structures approved by a second person, monthly runs, payment.', limits: 'Statutory returns and tax computation of employees are not produced.' },
  { key: 'people_cost', area: 'People Cost', label: 'People Cost', to: '/people-cost', perm: 'payroll.view', state: 'working', what: 'What people cost, by department, without showing any one salary.' },
  { key: 'investments', area: 'Investments', label: 'Investments & Funds', to: '/investments', perm: 'investment.view', state: 'partial', what: 'Holdings at cost or fair value, funds with commitments, capital calls, units, distributions, net asset value, management fee; who owns what in the group.', limits: 'Net asset value is an accounting figure from the books, not a regulatory valuation. Carried interest and waterfalls are not computed.' },
  { key: 'parties', area: 'Parties', label: 'People & Parties', to: '/parties', core: true, state: 'working', what: 'One identity for each party across the companies, with everything known about it.' },
  { key: 'registers', area: 'Documents', label: 'Registers', to: '/registers', perm: 'register.view', state: 'working', what: 'Contracts, subscriptions, insurance, compliance, guarantees, vehicles and every other commitment, with their dates.' },
  { key: 'inbox', area: 'Documents', label: 'Document Inbox', to: '/inbox', perm: ['document.view', 'document.upload'], state: 'partial', what: 'Documents uploaded, classified by a person, linked to their records; duplicates flagged.', limits: 'Documents are not read by machine (no OCR is connected).' },
  { key: 'tax', area: 'Tax', label: 'Tax codes', to: '/accounts', state: 'partial', what: 'GST codes and their ledgers; tax on documents; tax deducted at source on payments that state it.', limits: 'Returns are not prepared or filed. No tax portal is connected.' },
  // ------------------------------------------------------------ looking ahead and looking again
  { key: 'forward', area: 'Forward', label: 'Forward', to: '/forward', state: 'working', what: 'Every known future money event, each marked with how certain it is.' },
  { key: 'sentinel', area: 'Sentinel', label: 'Sentinel', to: '/sentinel', state: 'working', what: 'Rules that watch the books and raise what deserves a look. An alert states facts; a person decides what they mean.' },
  { key: 'reality', area: 'Reality', label: 'Reality', to: '/reality', perm: 'reality.view', state: 'partial', what: 'What the documents say, what was done, what was posted, what the bank shows and what physically exists, set against each other; cases; physical verification; confirmations from outside.', limits: 'Differences are found between records NUMERO holds, along eight chains that are fixed: purchases, sales, advances, assets, cash boxes, stock, bank statements and verification sheets. Workflows, fields and kinds of register of your own are not read. Reports show the reconciliation of the records they rest on as they stand today, not as at the date of the report. What nobody recorded cannot be found.' },
  { key: 'vault', area: 'Truth', label: 'Black Vault', to: '/vault', state: 'working', what: 'Records classified above the ordinary: private, never false, and always inside the totals.' },
  { key: 'twin', area: 'Digital Twin', label: 'Digital Twin', to: '/twin', perm: 'scenario.view', state: 'working', what: 'A model of a company or the group built from the books, on which assumptions are tried: revenue, margins, payroll, delays in collection, rates, borrowing, a customer lost. Valuation by three methods.', limits: 'The model is arithmetic on monthly rates. It is a simulation, not a forecast, and it learns nothing by itself.' },
  { key: 'sandbox', area: 'Digital Twin', label: 'Sandbox', to: '/sandbox', perm: 'scenario.manage', state: 'working', what: 'A copy of the configuration in the memory of the browser, in which entries, rules and settings can be tried. Nothing done there reaches the books.', limits: 'The sandbox runs on the engine NUMERO carries in the browser, not on the database. It brings in the chart, the parties and the rules, the balances of a year ago and the movement of each month since. It does not copy the transactions themselves, salaries, confidential records, documents or roles, and no outside system can be tried in it because none is connected.' },
  { key: 'studio', area: 'Scenario Studio', label: 'Scenario Studio', to: '/studio', perm: 'flow.view', state: 'partial', what: 'A way of working designed step by step — request, approval, release, evidence, settlement — and followed case by case.', limits: 'A workflow posts nothing and releases nothing: each step points to the record that does. Cases are started by a person; triggers by e-mail, schedule or bank transaction are recorded as intent and start nothing.' },
  { key: 'numi', area: 'NUMI', label: 'NUMI', to: '/', state: 'partial', what: 'Questions in plain words answered from the records the person may read, with the source of every figure.', limits: 'NUMI works by rules over the records. No language model is connected. It recommends and never posts.' },
  { key: 'voice', area: 'NUMI', label: 'Voice commands', to: '/settings', state: 'partial', what: 'Navigation and questions by voice. A command never approves, posts or pays.', limits: 'Uses the speech recognition of the browser. No speech service is connected.' },
  // ------------------------------------------------------------ control
  { key: 'approvals', area: 'Audit', label: 'Approvals', to: '/approvals', core: true, state: 'working', what: 'Everything that waits for a second person, with the rule that sent it there.' },
  { key: 'tasks', area: 'Audit', label: 'Follow-ups', to: '/tasks', state: 'working', what: 'What someone has to do, by when, and about which record.' },
  { key: 'audit', area: 'Audit', label: 'Audit Trail', to: '/audit', core: true, state: 'working', what: 'Who did what, when, and why. It cannot be edited.' },
  { key: 'team', area: 'Security', label: 'Team & Access', to: '/team', core: true, state: 'working', what: 'Roles, permissions by company, clearance for confidential records.', limits: 'Sign-in, multi-factor authentication and password rules are those of the authentication service.' },
  // ------------------------------------------------------------ platform
  { key: 'notifications', area: 'Platform', label: 'Notifications', to: '/notifications', state: 'partial', what: 'What waits for the person, inside the application, by class of attention.', limits: 'Notices are shown in the application only. E-mail, push, SMS and WhatsApp are recorded as preferences; nothing is sent through them.' },
  { key: 'communications', area: 'Integrations', label: 'Communications', to: '/communications', perm: ['communication.send', 'party.view'], state: 'recorded only', what: 'Reminders, statements and confirmations prepared from templates, and a record of what a person sent.', limits: 'NUMERO sends nothing. A person sends the message from their own mailbox and records that they did.' },
  { key: 'integrations', area: 'Integrations', label: 'Integrations register', to: '/system?tab=integrations', perm: 'integration.manage', state: 'not connected', what: 'What NUMERO is, or is planned to be, connected to; what each connection may do; where its secret is kept.', limits: 'No outside system is connected. The register holds no secret.' },
  { key: 'system', area: 'Platform', label: 'System Health', to: '/system', perm: 'system.health', state: 'partial', what: 'The state of the posting engine, the stock ledger against the books, bank statements, the audit trail, backups, the analytical store.', limits: 'Backups are made by the database provider; a person records that one was made and that one was restored. Queues and background jobs do not exist.' },
  { key: 'companies', area: 'Platform', label: 'Companies', to: '/companies', core: true, state: 'working', what: 'Companies of the group, created from templates, cloned, archived.' },
  { key: 'genesis', area: 'Platform', label: 'Genesis Builder', to: '/genesis', state: 'partial', what: 'Kinds of party and of unit, and fields of your own, without code. Kinds of register are defined under Registers.', limits: 'Fields defined for journals, payments, units and companies are kept but no screen shows them yet.' },
  { key: 'calculators', area: 'Platform', label: 'Calculators', to: '/calculators', state: 'working', what: 'Loan, deposit, tax and margin calculators. They calculate; they record nothing.' },
  { key: 'features', area: 'Platform', label: 'Capabilities', to: '/features', core: true, state: 'working', what: 'This list.' },
  { key: 'requirements', area: 'Platform', label: 'Requirement Ledger', to: '/requirements', core: true, state: 'working', what: 'Every requirement of the specification with its honest status.' },
  { key: 'settings', area: 'Platform', label: 'Settings', to: '/settings', core: true, state: 'working', what: 'Theme, effects, language of voice, privacy mode.' },
]

/**
 * The capability a screen belongs to, found from its address: the capability whose own address is the longest
 * beginning of it. Capabilities that cannot be switched off, and those that are not a screen, are not looked for.
 */
export function capabilityOfPath(path: string): string | null {
  let best: { key: string; len: number } | null = null
  for (const c of CAPABILITIES) {
    // a capability that is a tab of another screen (an address with a query) does not govern that screen
    if (c.core || c.key === 'numi' || c.key === 'voice' || c.key === 'tax' || c.to.includes('?')) continue
    const to = c.to
    if (to === '/' || !(path === to || path.startsWith(to + '/'))) continue
    if (!best || to.length > best.len) best = { key: c.key, len: to.length }
  }
  return best?.key ?? null
}
export const capability = (key: string) => CAPABILITIES.find((c) => c.key === key)

/**
 * Is a capability switched on for this person?
 * The most specific switch decides: company and role, then company, then role, then the group.
 * Where no switch exists the capability is on. It is shown when it is on in at least one of the companies.
 */
export function capabilityOn(flags: FeatureFlag[], key: string, companyIds: ID[], roleKeys: Record<ID, string[]> = {}): boolean {
  const c = capability(key)
  if (c?.core) return true
  const mine = flags.filter((f) => f.module === key)
  if (!mine.length) return true
  const inCompany = (company: ID | null) => {
    const roles = company ? roleKeys[company] ?? [] : Object.values(roleKeys).flat()
    const pick = (co: ID | null, withRole: boolean) => mine.filter((f) => (f.company_id ?? null) === co && (withRole ? f.role_key !== null && roles.includes(f.role_key) : f.role_key === null))
    for (const set of [pick(company, true), pick(company, false), pick(null, true), pick(null, false)]) {
      // where two switches of the same rank disagree, the capability stays on: a person with two roles keeps what either role was given
      if (set.length) return set.some((f) => f.enabled)
    }
    return true
  }
  return companyIds.length ? companyIds.some((id) => inCompany(id)) : inCompany(null)
}
