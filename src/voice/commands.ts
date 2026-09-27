import type { Company } from '@/engine/types'
import type { PeriodKey } from '@/lib/dates'

// Voice and command-bar intent parsing. Pure and testable: it returns WHAT should
// happen; the shell decides how. Sensitive verbs are never turned into actions.

export type Command =
  | { type: 'navigate'; to: string; label: string }
  | { type: 'company'; companyId: string | null; label: string }
  | { type: 'theme'; theme: 'dark' | 'light' | 'toggle' }
  | { type: 'privacy'; on: boolean }
  | { type: 'uimode'; mode: 'command' | 'accounting' }
  | { type: 'period'; key: PeriodKey; label: string }
  | { type: 'ask'; question: string }
  | { type: 'entry'; text: string }
  | { type: 'back' }
  | { type: 'stop' }
  | { type: 'help' }
  | { type: 'sensitive'; to: string; verb: string }
  | { type: 'unknown'; text: string }

export interface Interpreted { command: Command; intent: string; reply: string; sensitive: boolean }

export const ROUTES: { to: string; label: string; re: RegExp; keys: string }[] = [
  { to: '/', label: 'Group Command Centre', re: /\b(home|dashboard|command cent(re|er)|control tower|overview)\b/, keys: 'home dashboard command centre control tower' },
  { to: '/cockpit', label: 'Cockpit', re: /\bcockpit\b/, keys: 'cockpit immersive' },
  { to: '/entry', label: 'Transaction Command Centre', re: /\b(record|enter|new|add|create)\b.*\b(expense|transaction|entry|receipt|payment)\b|\bquick entry\b|\bi spent\b/, keys: 'record expense transaction quick entry i spent money' },
  { to: '/journals/new', label: 'New journal', re: /\b(new|create|add)\b.*\bjournal\b/, keys: 'new journal voucher' },
  { to: '/journals', label: 'Journals & vouchers', re: /\b(journals?|vouchers?|day book)\b/, keys: 'journals vouchers day book' },
  { to: '/ledger', label: 'General ledger', re: /\b(general ledger|ledger)\b/, keys: 'general ledger' },
  { to: '/accounts', label: 'Chart of accounts', re: /\bchart of accounts\b|\baccounts list\b/, keys: 'chart of accounts' },
  { to: '/reports/pnl', label: 'Profit & Loss', re: /\b(p ?(&|and|n) ?l|profit (and|&) loss|income statement)\b/, keys: 'profit and loss p&l income statement' },
  { to: '/reports/balance-sheet', label: 'Balance Sheet', re: /\bbalance sheet\b/, keys: 'balance sheet' },
  { to: '/reports/trial-balance', label: 'Trial Balance', re: /\btrial balance\b/, keys: 'trial balance' },
  { to: '/reports/cash-flow', label: 'Cash Flow', re: /\bcash ?flow\b/, keys: 'cash flow statement' },
  { to: '/reports/ageing', label: 'Ageing', re: /\bage?ing\b/, keys: 'ageing receivables payables' },
  { to: '/reports/consolidated', label: 'Group consolidation', re: /\bconsolidat\w*\b|\bintercompany\b/, keys: 'consolidation consolidated group intercompany eliminations' },
  { to: '/reports/ratios', label: 'Financial health', re: /\b(ratios?|financial health|health indicators?)\b/, keys: 'ratios financial health indicators' },
  { to: '/reports/money-went', label: 'Where did the money go?', re: /\bwhere did (the|our) money go\b|\bmoney (went|go)\b/, keys: 'where did the money go spend' },
  { to: '/reports/money-came', label: 'Where did the money come from?', re: /\bwhere did (the|our) money come\b/, keys: 'where did the money come from revenue' },
  { to: '/reports', label: 'Report library', re: /\breports?\b/, keys: 'reports library' },
  { to: '/money-map', label: 'Financial Command Map', re: /\b(money|command|flow) map\b|\bmoney graph\b/, keys: 'money map graph flow command map' },
  { to: '/parties/owed?side=in', label: 'Who owes us?', re: /\bwho owes (us|me)\b|\bowe us\b/, keys: 'who owes us money receivable' },
  { to: '/parties/owed?side=out', label: 'Who do we owe?', re: /\bwho do (we|i) owe\b|\bwe owe\b/, keys: 'who do we owe money payable' },
  { to: '/parties', label: 'People & Parties', re: /\b(parties|party|people|vendors?|customers?|brokers?|contractors?)\b/, keys: 'people parties vendors customers brokers' },
  { to: '/invoices', label: 'Sales & billing', re: /\b(sales )?invoices?\b|\bbilling\b/, keys: 'sales invoices billing' },
  { to: '/bills', label: 'Purchase bills', re: /\b(purchase )?bills?\b|\bpurchases?\b/, keys: 'purchase bills payables' },
  { to: '/payments', label: 'Payments & receipts', re: /\b(payments?|receipts?|collections?)\b/, keys: 'payments receipts collections' },
  { to: '/banking', label: 'Banking & reconciliation', re: /\b(bank(ing)?|reconcil\w*)\b/, keys: 'banking reconciliation bank statement' },
  { to: '/budgets', label: 'Budgets', re: /\bbudgets?\b/, keys: 'budget vs actual' },
  { to: '/forward', label: 'NUMERO Forward', re: /\b(forward|upcoming|obligations?|what is coming)\b/, keys: 'forward upcoming obligations cash horizon' },
  { to: '/approvals', label: 'Approvals', re: /\bapprovals?\b|\bwaiting for (my )?approval\b/, keys: 'approvals inbox' },
  { to: '/sentinel', label: 'Sentinel', re: /\b(sentinel|anomal\w*|unusual|watchtower|alerts?)\b/, keys: 'sentinel anomalies alerts watchtower' },
  { to: '/audit', label: 'Audit trail', re: /\baudit\b/, keys: 'audit trail' },
  { to: '/close', label: 'Period close', re: /\b(period|month|year)[- ]?(end )?close\b|\bclose the (month|period|year)\b|\block (the )?period\b/, keys: 'period close month end lock' },
  { to: '/vault', label: 'Black Vault', re: /\b(black )?vault\b|\bconfidential\b/, keys: 'black vault confidential private' },
  { to: '/companies', label: 'Companies', re: /\bcompanies\b|\badd company\b|\bcreate company\b/, keys: 'companies create company' },
  { to: '/calculators', label: 'Calculators', re: /\bcalculators?\b/, keys: 'calculators gst emi' },
  { to: '/genesis', label: 'Genesis Builder', re: /\b(genesis|custom fields?|departments?|configuration|no[- ]code)\b/, keys: 'genesis builder custom fields departments configuration' },
  { to: '/team', label: 'Team & access', re: /\b(team|users?|roles?|permissions?|access)\b/, keys: 'team users roles permissions access' },
  { to: '/requirements', label: 'Requirement ledger', re: /\brequirements?\b|\bzero[- ]omission\b/, keys: 'requirement ledger zero omission' },
  { to: '/settings', label: 'Settings', re: /\bsettings?\b|\bpreferences\b/, keys: 'settings preferences' },
]

const SENSITIVE: { re: RegExp; to: string; verb: string }[] = [
  { re: /\b(transfer|send|release|wire|remit)\b.*\b(money|funds?|rupees?|lakhs?|crores?|₹|\d)/, to: '/payments', verb: 'move money' },
  { re: /\b(approve|reject)\b/, to: '/approvals', verb: 'approve or reject' },
  { re: /\bpost\b.*\b(journal|entry|voucher|it|this)\b/, to: '/journals', verb: 'post an entry' },
  { re: /\b(reverse|delete|cancel|write[- ]?off)\b/, to: '/journals', verb: 'change accounting records' },
  { re: /\b(lock|reopen|unlock)\b.*\bperiod\b/, to: '/close', verb: 'lock or reopen a period' },
  { re: /\b(pay)\b.*\b(vendor|supplier|bill|salary|salaries|invoice|him|her|them)\b/, to: '/payments', verb: 'make a payment' },
]

const WAKE = /^\s*(hey|ok|okay|hi|hello)?\s*,?\s*(numero|numeral|new mero|numi|nummy|noomi|numy)\b[\s,.:!-]*/i
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}&%₹.,' -]/gu, ' ').replace(/\s+/g, ' ').trim()

export function interpret(raw: string, companies: Company[]): Interpreted {
  const text = raw.replace(WAKE, '').trim()
  const t = norm(text)
  const make = (command: Command, intent: string, reply: string, sensitive = false): Interpreted => ({ command, intent, reply, sensitive })
  if (!t) return make({ type: 'help' }, 'wake', 'I am listening. Try “show the balance sheet” or “how much cash do we have”.')

  // 1. sensitive verbs are never executed from a spoken or typed command
  for (const s of SENSITIVE) {
    if (s.re.test(t)) {
      return make({ type: 'sensitive', to: s.to, verb: s.verb }, 'sensitive:' + s.verb,
        `I cannot ${s.verb} from a command alone. I have opened the screen so you can review and confirm it yourself.`, true)
    }
  }

  if (/^(stop|cancel|never ?mind|stop listening|that'?s all)\b/.test(t)) return make({ type: 'stop' }, 'stop', 'Stopped.')
  if (/^(go )?back\b/.test(t)) return make({ type: 'back' }, 'back', 'Going back.')
  if (/^(help|what can (you|i) (do|say))\b/.test(t)) return make({ type: 'help' }, 'help', 'You can ask me to open any screen, switch company, change the period, or answer a question about the books.')

  // 2. appearance and modes
  if (/\b(dark|night)\s*(mode|theme)\b|\bgo dark\b/.test(t)) return make({ type: 'theme', theme: 'dark' }, 'theme', 'Dark mode.')
  if (/\b(light|white|day|bright)\s*(mode|theme)\b/.test(t)) return make({ type: 'theme', theme: 'light' }, 'theme', 'Light mode.')
  if (/\b(toggle|switch|change)\b.*\b(theme|mode)\b/.test(t) && !/account|command/.test(t)) return make({ type: 'theme', theme: 'toggle' }, 'theme', 'Theme switched.')
  if (/\b(hide|mask|conceal)\b.*\b(numbers?|figures?|amounts?)\b|\bprivacy( mode)? on\b|\bprivacy mode\b/.test(t)) return make({ type: 'privacy', on: true }, 'privacy', 'Figures hidden.')
  if (/\b(show|reveal|unmask)\b.*\b(numbers?|figures?|amounts?)\b|\bprivacy( mode)? off\b/.test(t)) return make({ type: 'privacy', on: false }, 'privacy', 'Figures visible.')
  if (/\baccount(ing|ant) mode\b/.test(t)) return make({ type: 'uimode', mode: 'accounting' }, 'uimode', 'Accounting mode.')
  if (/\bcommand mode\b/.test(t)) return make({ type: 'uimode', mode: 'command' }, 'uimode', 'Command mode.')

  // 3. questions and calculations go to NUMI, which answers from the books
  const isQuestion = /^(how|what|why|which|who|when|where|is|are|do|does|did|can|compare|explain|find|calculate|tell me|give me|list)\b/.test(t) || /\?$/.test(text)
  const navWhere = /^where did (the|our) money (go|come)/.test(t)
  const navWho = /^who (owes (us|me)|do (we|i) owe)\b/.test(t)
  if (isQuestion && !navWhere && !navWho) return make({ type: 'ask', question: text }, 'ask', 'Let me check the books.')

  // 4. a described transaction becomes a DRAFT for review, never a posting
  if (/^(paid|spent|received|bought|purchased|collected)\b/.test(t) || (/(₹|rs\.?|rupees|\d)/.test(t) && /\b(paid|spent|received|lunch|dinner|fuel|hotel|taxi|flight)\b/.test(t))) {
    return make({ type: 'entry', text }, 'entry', 'I have prepared a draft for you to review. Nothing has been posted.')
  }

  // 5. company switching
  if (/\b(all companies|whole group|group view|entire group|consolidated view)\b/.test(t)) return make({ type: 'company', companyId: null, label: 'the whole group' }, 'company', 'Showing the whole group.')
  const open = /^(open|show|switch to|go to|select|enter)\b/.test(t)
  const hit = companies.find((c) => t.includes(c.name.toLowerCase()) || new RegExp(`\\b${c.code.toLowerCase()}\\b`).test(t))
  if (hit && (open || t.split(' ').length <= 4)) return make({ type: 'company', companyId: hit.id, label: hit.name }, 'company', `Opening ${hit.name}.`)

  // 6. period
  const periods: [RegExp, PeriodKey, string][] = [
    [/\bthis month\b/, 'this_month', 'this month'], [/\b(last|previous) month\b/, 'last_month', 'last month'],
    [/\bthis quarter\b/, 'this_quarter', 'this quarter'], [/\b(last|previous) quarter\b/, 'last_quarter', 'last quarter'],
    [/\b(this|current) (financial |fiscal )?year\b/, 'fy', 'this financial year'], [/\b(last|previous) (financial |fiscal )?year\b/, 'last_fy', 'last financial year'],
    [/\b(last )?(12|twelve) months\b/, 'last_12', 'the last twelve months'], [/\ball time\b/, 'all', 'all time'],
  ]
  const p = periods.find(([re]) => re.test(t))
  // the most specific phrase wins: "requirement ledger" must not open the general ledger
  const route = ROUTES.map((r) => ({ r, m: t.match(r.re) })).filter((x) => x.m).sort((a, b) => b.m![0].length - a.m![0].length)[0]?.r
  if (p && !route) return make({ type: 'period', key: p[1], label: p[2] }, 'period', `Period set to ${p[2]}.`)

  // 7. navigation
  if (route) return make({ type: 'navigate', to: route.to, label: route.label }, 'navigate:' + route.to, `Opening ${route.label}.`)
  if (isQuestion) return make({ type: 'ask', question: text }, 'ask', 'Let me check the books.')

  return make({ type: 'unknown', text }, 'unknown', 'I did not understand that. Try “open the ledger”, “dark mode”, or ask a question about the books.')
}
