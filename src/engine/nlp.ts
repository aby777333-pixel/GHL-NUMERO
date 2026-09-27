import Decimal from 'decimal.js'
import { parseAmount } from '@/lib/money'
import { addDays, today } from '@/lib/dates'
import type { Account, Company, ID, JournalInput, NumiRule, OrgUnit, Party } from './types'

// Natural-language transactions (spec 38, 178, 653, 1602).
// The parser PROPOSES. It never posts, never invents a party or an amount,
// and turns every ambiguity into a question for the human.

export interface Suggestion<T> { item: T; reason: string; confidence: 'learned' | 'keyword' | 'name' }

export interface ParsedTransaction {
  text: string
  kind: 'outflow' | 'inflow' | 'transfer' | 'unknown'
  amount: Decimal | null
  date: string
  company: Company | null
  party: Party | null
  partyCandidates: Party[]
  partyText: string | null
  bank: Account | null
  bankCandidates: Account[]
  account: Suggestion<Account> | null
  accountAlternatives: Suggestion<Account>[]
  dims: { unit: OrgUnit; reason: string }[]
  description: string
  questions: string[]
  facts: string[]
}

const KEYWORDS: [RegExp, RegExp][] = [
  [/\b(facebook|google|meta|instagram|linkedin|youtube)\b.*\b(ad|ads|advertis\w*)|\badvertis\w*|\bad campaign|\bdigital market\w*/, /digital advertising|advertis/i],
  [/\blegal|lawyer|advocate|court\b/, /legal/i],
  [/\baudit\b/, /audit/i],
  [/\bconsult\w*|advisory|retainer\b/, /consultancy|consult/i],
  [/\brent\b|\blease\b/, /^rent$|rent/i],
  [/\bsalar(y|ies)|wages|payroll\b/, /salaries|wages/i],
  [/\bbonus|incentive\b/, /bonus/i],
  [/\bfuel|petrol|diesel\b/, /fuel/i],
  [/\bhotel|accommodation|stay\b/, /hotel/i],
  [/\bflight|airfare|air ticket|airline\b/, /airfare/i],
  [/\btaxi|uber|ola|cab|auto|metro\b/, /local conveyance|conveyance/i],
  [/\btoll|parking|fastag\b/, /toll/i],
  [/\blunch|dinner|breakfast|meal|food|restaurant\b/, /meals/i],
  [/\bclient (dinner|lunch|entertainment)|entertain\w*\b/, /client entertainment/i],
  [/\btea|coffee|pantry|snacks\b/, /pantry/i],
  [/\belectricity|power bill|eb bill\b/, /electricity/i],
  [/\bwater\b/, /water/i],
  [/\binternet|broadband|telephone|mobile bill|phone bill\b/, /telephone|internet/i],
  [/\baws|azure|gcp|cloud|hosting\b/, /cloud/i],
  [/\bsoftware|subscription|saas|licen[cs]e\b/, /software/i],
  [/\bcourier|postage|shipping label\b/, /courier/i],
  [/\bprinting|stationery|brochure\b/, /printing/i],
  [/\boffice supplies|supplies\b/, /office supplies/i],
  [/\binsurance|premium\b/, /insurance/i],
  [/\brepair|maintenance|service charge\b/, /repairs/i],
  [/\bsecurity guard|housekeeping|cleaning\b/, /housekeeping/i],
  [/\bcommission|brokerage\b/, /commission/i],
  [/\binterest\b/, /interest/i],
  [/\bbank charge|bank fee\b/, /bank charges/i],
  [/\bfine|penalty|late fee\b/, /fines/i],
  [/\bfreight|transport\w*|logistics\b/, /freight/i],
  [/\bcustoms|duty\b/, /customs/i],
  [/\bmaterial|cement|steel|sand\b/, /material/i],
  [/\blabou?r|subcontract\w*\b/, /labour/i],
  [/\bevent|sponsorship|exhibition\b/, /events/i],
  [/\bsale|sold|invoice\b/, /sales|service revenue/i],
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export interface ParseContext {
  companies: Company[]
  defaultCompanyId?: ID
  accounts: Account[]
  parties: Party[]
  orgUnits: OrgUnit[]
  rules: NumiRule[]
  refDate?: string
}

export function parseTransaction(text: string, ctx: ParseContext): ParsedTransaction {
  const t = text.trim()
  const low = t.toLowerCase()
  const questions: string[] = []
  const facts: string[] = []

  // ---- direction
  let kind: ParsedTransaction['kind'] = 'unknown'
  if (/\b(transfer(red)?|moved|deposited into|withdrew|withdrawn)\b/.test(low)) kind = 'transfer'
  else if (/\b(paid|pay|spent|bought|purchased|gave|settled|reimbursed)\b/.test(low)) kind = 'outflow'
  else if (/\b(received|receive|got|collected|credited|earned)\b/.test(low)) kind = 'inflow'
  if (kind === 'unknown') questions.push('Was this money going out (paid) or coming in (received)?')

  // ---- amount
  const amount = parseAmount(t)
  if (!amount || amount.lte(0)) questions.push('What was the amount?')
  else facts.push(`Amount read as ${amount.toFixed(2)}`)

  // ---- date
  const ref = ctx.refDate ?? today()
  let date = ref
  if (/\byesterday\b/.test(low)) date = addDays(ref, -1)
  else if (/\bday before yesterday\b/.test(low)) date = addDays(ref, -2)
  const dm = low.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/)
  if (dm) date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`

  // ---- company
  let company: Company | null = null
  const cHits = ctx.companies.filter((c) => low.includes(c.name.toLowerCase()) || new RegExp(`\\b${c.code.toLowerCase()}\\b`).test(low))
  if (cHits.length === 1) { company = cHits[0]; facts.push(`Company named in the sentence: ${company.name}`) }
  else if (cHits.length > 1) questions.push(`Which company: ${cHits.map((c) => c.name).join(' or ')}?`)
  else if (ctx.defaultCompanyId) company = ctx.companies.find((c) => c.id === ctx.defaultCompanyId) ?? null
  if (!company && cHits.length === 0) questions.push('Which company does this belong to?')

  const accounts = company ? ctx.accounts.filter((a) => a.company_id === company!.id && !a.is_group && a.is_active) : []
  const units = company ? ctx.orgUnits.filter((u) => u.company_id === company!.id && u.status === 'active') : []

  // ---- party: text after "to"/"from" up to a stop word; resolved against the master, never invented
  let partyText: string | null = null
  const pm = t.match(/\b(?:to|from|by)\s+((?:[A-Z][\w&.'-]*\s?){1,5})/)
  if (pm) partyText = pm[1].trim().replace(/\s+(for|from|using|via|on|at)$/i, '')
  let partyCandidates: Party[] = []
  if (company) {
    const scoped = ctx.parties.filter((p) => p.roles.some((r) => r.company_id === company!.id) && p.status !== 'terminated')
    const n = norm(t)
    partyCandidates = scoped.filter((p) => n.includes(norm(p.display_name)))
    if (!partyCandidates.length && partyText) {
      const first = norm(partyText).split(' ')[0]
      if (first && first.length > 2) partyCandidates = scoped.filter((p) => norm(p.display_name).split(' ').includes(first))
    }
  }
  let party: Party | null = null
  if (partyCandidates.length === 1) { party = partyCandidates[0]; facts.push(`Party matched to ${party.display_name} (${party.party_no})`) }
  else if (partyCandidates.length > 1) questions.push(`Which ${partyText ?? 'party'}? ${partyCandidates.length} records match: ${partyCandidates.map((p) => `${p.display_name} (${p.party_no})`).join(', ')}.`)
  else if (partyText) facts.push(`"${partyText}" is not in the party master — no party will be attached unless you create or choose one.`)

  // ---- bank / cash ledger
  const bankLedgers = accounts.filter((a) => a.control_type === 'bank' || a.control_type === 'cash')
  let bankCandidates = bankLedgers.filter((a) => norm(a.name).split(' ').some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`).test(low) && !['bank', 'account', 'cash', 'primary', 'current'].includes(w)))
  if (!bankCandidates.length && /\bcash\b/.test(low)) bankCandidates = bankLedgers.filter((a) => a.control_type === 'cash' && !/petty/i.test(a.name))
  if (!bankCandidates.length && /\bpetty\b/.test(low)) bankCandidates = bankLedgers.filter((a) => /petty/i.test(a.name))
  let bank: Account | null = null
  if (bankCandidates.length === 1) { bank = bankCandidates[0]; facts.push(`Paid through: ${bank.name}`) }
  else if (bankCandidates.length > 1) questions.push(`Which account: ${bankCandidates.map((a) => a.name).join(' or ')}?`)
  else if (bankLedgers.length === 1) { bank = bankLedgers[0]; facts.push(`Only one bank/cash ledger exists: ${bank.name}`) }
  else if (company) questions.push('Which bank or cash account was used?')

  // ---- classification: learned rules first, then keywords
  const sugg: Suggestion<Account>[] = []
  const wantType = kind === 'inflow' ? 'income' : 'expense'
  for (const r of ctx.rules.filter((x) => x.status === 'active' && company && x.company_id === company.id)) {
    const hit = (party && r.party_id === party.id) || (r.pattern && low.includes(r.pattern))
    const acc = accounts.find((a) => a.id === r.account_id)
    if (hit && acc) {
      sugg.push({ item: acc, confidence: 'learned', reason: `${r.approved_count} previous approved transaction${r.approved_count === 1 ? '' : 's'} matching "${r.pattern}" were classified here` })
    }
  }
  for (const [textRe, nameRe] of KEYWORDS) {
    if (!textRe.test(low)) continue
    for (const acc of accounts.filter((a) => a.type === wantType && nameRe.test(a.name))) {
      if (!sugg.some((s) => s.item.id === acc.id)) {
        const word = low.match(textRe)?.[0] ?? ''
        sugg.push({ item: acc, confidence: 'keyword', reason: `The description contains "${word.trim()}"` })
      }
    }
  }
  // learned preferences first; then ledgers whose full name is literally in the sentence; then keyword matches
  const rank = (s: Suggestion<Account>) => (s.confidence === 'learned' ? 0 : norm(t).includes(norm(s.item.name)) ? 1 : 2)
  sugg.sort((x, y) => rank(x) - rank(y))
  for (const s of sugg) if (rank(s) === 1) { s.confidence = 'name'; s.reason = `The description names the ledger "${s.item.name}"` }
  const account = sugg[0] ?? null
  if (!account && company && kind !== 'transfer') questions.push(`Which ${wantType} ledger should this be classified under?`)

  // ---- dimensions (project, department, office …) named in the sentence
  const dims: ParsedTransaction['dims'] = []
  for (const u of units) {
    const nm = norm(u.name)
    if (nm.length > 2 && norm(t).includes(nm) && !dims.some((d) => d.unit.type_key === u.type_key)) {
      dims.push({ unit: u, reason: `"${u.name}" is named in the sentence` })
    }
  }
  const prj = t.match(/\bproject\s+([A-Z][\w-]*)/i)
  if (prj && !dims.some((d) => d.unit.type_key === 'project')) facts.push(`Project "${prj[1]}" is not in the project master — no project tag will be added.`)

  return {
    text: t, kind, amount: amount && amount.gt(0) ? amount : null, date, company, party, partyCandidates, partyText,
    bank, bankCandidates, account, accountAlternatives: sugg.slice(1, 5), dims,
    description: t.replace(/\s+/g, ' ').slice(0, 240), questions, facts,
  }
}

/** Builds the proposed double entry. Returns null while anything essential is unresolved. */
export function proposeJournal(p: ParsedTransaction, overrides: { accountId?: ID; bankId?: ID; partyId?: ID | null } = {}): JournalInput | null {
  const accountId = overrides.accountId ?? p.account?.item.id
  const bankId = overrides.bankId ?? p.bank?.id
  if (!p.company || !p.amount || !accountId || !bankId || p.kind === 'unknown' || p.kind === 'transfer') return null
  const partyId = overrides.partyId === undefined ? p.party?.id ?? null : overrides.partyId
  const dims = Object.fromEntries(p.dims.map((d) => [d.unit.type_key, d.unit.id]))
  const amt = p.amount.toFixed(2)
  const out = p.kind === 'outflow'
  return {
    company_id: p.company.id,
    voucher_type: out ? 'payment' : 'receipt',
    journal_date: p.date,
    narration: p.description,
    purpose: p.description,
    origin: 'ai_suggested',
    lines: out
      ? [
          { account_id: accountId, party_id: partyId, description: p.description, debit: amt, dims },
          { account_id: bankId, description: p.description, credit: amt },
        ]
      : [
          { account_id: bankId, description: p.description, debit: amt },
          { account_id: accountId, party_id: partyId, description: p.description, credit: amt, dims },
        ],
  }
}
