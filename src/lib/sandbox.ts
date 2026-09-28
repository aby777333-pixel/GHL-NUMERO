import type { NumeroApi } from '@/api/types'
import { DemoEngine } from '@/api/demo'
import type { Company, ID, JournalLineInput, SessionInfo } from '@/engine/types'
import { D, ZERO } from './money'
import { addDays, addMonths, endOfMonth, startOfMonth, today } from './dates'

// NUMERO SANDBOX (spec 634, 1423, 1424, 1425, 1838).
//
// A sandbox is a second set of books that lives in the memory of the browser. It is built
// from the configuration of the real books — companies, ledgers, account mapping, tax codes,
// parties, approval rules, fields, workflows — and from their figures: the balances of a year
// ago as one entry, and what moved in each ledger since as one entry a month. Whatever is
// tried there runs on the engine NUMERO carries in the browser, which keeps the rules of the
// database and is tested against the same cases.
//
// What it keeps, without exception:
//   * it reads the real books and never writes to them;
//   * it holds no connection to them once it is built;
//   * it is discarded when the person leaves it or reloads the page;
//   * it copies no salary, no confidential record, no document and no history of transactions.

export type Can = (perm: string, companyId?: ID) => boolean

/** every entry the build makes begins with this, so that it can be told from what the person does afterwards */
export const BUILD = 'Sandbox build —'

export interface SandboxReport {
  built_at: string
  as_of: string
  /** the first day of the twelve months whose movement was brought in, month by month */
  history_from: string
  /** rows of the audit trail written while the sandbox was built; what the person does comes after them */
  audit_rows: number
  companies: { id: ID; code: string; name: string; ledgers: number; entries: number; opening_lines: number; opening_total: string; note: string | null }[]
  copied: { what: string; count: number }[]
  /** what was left out, and why */
  left_out: string[]
}

export { SANDBOX_PEOPLE } from './sandboxPeople'

const PERSON: Record<ID, string> = { 'demo-accountant': 'Sandbox Preparer', 'demo-finance': 'Sandbox Finance Head', 'demo-cfo': 'Sandbox Second Approver', 'demo-owner': 'Sandbox Group Super Admin' }

/** The same engine as the sample books, with the people of the sandbox named as what they are. */
export class SandboxEngine extends DemoEngine {
  override async getSession(): Promise<SessionInfo | null> {
    const s = await super.getSession()
    return s ? { ...s, user: { ...s.user, name: PERSON[this.actor] ?? s.user.name, email: 'sandbox@numero.invalid' } } : s
  }
  protected override log(...args: Parameters<DemoEngine['log']>) {
    super.log(...args)
    const last = this.audit[this.audit.length - 1]
    if (last) last.actor_name = PERSON[this.actor] ?? last.actor_name
  }
}

export async function buildSandbox(api: NumeroApi, session: SessionInfo, companies: Company[], can: Can): Promise<{ engine: SandboxEngine; report: SandboxReport }> {
  const e = new SandboxEngine()
  const asOf = today()
  const left: string[] = []
  const copied: SandboxReport['copied'] = []
  const ids = companies.filter((c) => c.status === 'active').map((c) => c.id)
  const idsWith = (perm: string | string[]) => ids.filter((id) => [perm].flat().some((p) => can(p, id)))

  /** reads a source; a refusal names the source instead of stopping the build */
  const read = async <T,>(what: string, load: () => Promise<T[]>, perm?: string | string[]): Promise<T[]> => {
    if (perm && !idsWith(perm).length) { left.push(`${what}: your role does not read them.`); return [] }
    try {
      const rows = await load()
      // copies, so that nothing done in the sandbox can reach an object of the real books
      const out = JSON.parse(JSON.stringify(rows)) as T[]
      if (out.length) copied.push({ what, count: out.length })
      return out
    } catch (err) {
      left.push(`${what}: ${err instanceof Error ? err.message : 'could not be read'}.`)
      return []
    }
  }

  if (session.group) e.group = JSON.parse(JSON.stringify(session.group))
  e.companies = await read('companies', async () => companies.filter((c) => ids.includes(c.id)))
  e.accounts = await read('ledgers', () => api.listAccounts(ids))
  for (const m of await read('account mapping', () => api.listAccountMap(ids))) e.accountMap.set(m.company_id, { ...(e.accountMap.get(m.company_id) ?? {}), [m.key]: m.account_id })
  e.orgUnits = await read('departments, projects and other units', () => api.listOrgUnits(ids))
  const unitTypes = await read('kinds of unit', () => api.listOrgUnitTypes()); if (unitTypes.length) e.orgUnitTypes = unitTypes
  const partyTypes = await read('kinds of party', () => api.listPartyTypes()); if (partyTypes.length) e.partyTypes = partyTypes
  e.taxCodes = await read('tax codes', () => api.listTaxCodes(ids))
  e.parties = await read('parties', () => api.listParties())
  e.bankAccounts = await read('bank accounts and cash boxes of the ledger', () => api.listBankAccounts(ids))
  e.approvalRules = await read('approval rules', () => api.listApprovalRules())
  e.customFields = await read('fields of your own', () => api.listCustomFields())
  e.periods = await read('accounting periods and their locks', () => api.listPeriods(ids))
  const kinds = await read('kinds of register', () => api.listRegisterKinds()); if (kinds.length) e.registerKinds = kinds
  e.expenseCategories = await read('expense categories and their limits', () => api.listExpenseCategories(idsWith(['expense.view', 'expense.approve', 'expense.create'])), ['expense.view', 'expense.approve', 'expense.create'])
  e.assetCategories = await read('asset categories', () => api.listAssetCategories(idsWith('asset.view')), 'asset.view')
  e.invCategories = await read('stock categories', () => api.listInvCategories(idsWith('inventory.view')), 'inventory.view')
  e.warehouses = await read('stock locations', () => api.listWarehouses(idsWith('inventory.view')), 'inventory.view')
  // items arrive without stock: the movements that built the stock are history, and history is not copied
  e.invItems = (await read('stock items', () => api.listInvItems(idsWith('inventory.view')), 'inventory.view')).map((i) => ({ ...i, qty_on_hand: '0', value_on_hand: '0', qty_reserved: '0', value_reserved: '0' }))
  e.flowDefs = await read('workflows of the scenario studio', () => api.listFlowDefs(), 'flow.view')
  e.messageTemplates = await read('message templates', () => api.listMessageTemplates(), 'communication.send')
  e.attentionRules = await read('attention rules', () => api.listAttentionRules())
  e.twinDrivers = await read('drivers of the digital twin', () => api.listTwinDrivers(), 'scenario.view')
  e.scenarios = await read('saved simulations', () => api.listScenarios(), 'scenario.view')
  e.materiality = await read('materiality thresholds', () => api.listMateriality(idsWith('reality.view')), 'reality.view')

  left.push(
    'Journals, invoices, bills, payments and every other transaction are not copied. The balances of a year ago arrive as one entry, and what moved since as one entry a month, without parties, documents, departments or projects.',
    'Employees, salaries and payroll: never copied.',
    'Records classified above the ordinary (Black Vault), documents and bank statements: never copied.',
    'Stock quantities, fixed assets, loans, deposits, investments and funds: their value is inside the balances; the records themselves are not copied, so their screens start empty.',
    'Roles and permissions: in the sandbox every person holds every permission.',
  )

  // ------------------------------------------------------------ balances and the movement of the last twelve months
  // One entry brings in the balances as they stood a year ago; one entry a month brings in what moved in each ledger since.
  // The reports of the sandbox therefore show the year, month by month, and the digital twin has months to rest on.
  // What is NOT brought in is the transactions themselves: a month is one entry, without parties, documents or tags.
  const readable = idsWith('report.view')
  const from = startOfMonth(addMonths(asOf, -12))
  const opened = addDays(from, -1)
  const [balances, monthly, byParty] = readable.length
    ? await Promise.all([api.ledgerBalances(readable, '1990-01-01', opened).catch(() => []), api.ledgerMonthly(readable, from, asOf).catch(() => []), api.partyLedgerBalances(readable, asOf).catch(() => [])])
    : [[], [], []]
  const report: SandboxReport = { built_at: new Date().toISOString(), as_of: asOf, history_from: from, audit_rows: 0, companies: [], copied, left_out: left }
  const approvers = ['demo-finance', 'demo-cfo', 'demo-owner']
  // months that are locked in the books are opened while the sandbox is built, and locked again afterwards
  const locks = e.periods.map((p) => [p, p.status] as const)
  e.periods.forEach((p) => { p.status = 'open' })

  for (const c of e.companies) {
    const ledgers = e.accounts.filter((a) => a.company_id === c.id)
    const usable = new Set(ledgers.filter((a) => !a.is_group && a.is_active).map((a) => a.id))
    const row = { id: c.id, code: c.code, name: c.name, ledgers: ledgers.length, entries: 0, opening_lines: 0, opening_total: '0', note: null as string | null }
    report.companies.push(row)
    if (!readable.includes(c.id)) { row.note = 'Your role does not read the ledger of this company. It starts empty.'; continue }
    const suspense = e.accountMap.get(c.id)?.suspense ?? ledgers.find((a) => a.subtype === 'suspense' && !a.is_group)?.id
    const notes: string[] = []
    const line = (account_id: ID, net: ReturnType<typeof D>, description: string, party_id?: ID): JournalLineInput | null => {
      const v = net.toDecimalPlaces(2)
      return v.isZero() ? null : { account_id, party_id, description, ...(v.gt(0) ? { debit: v.toString() } : { credit: v.neg().toString() }) }
    }
    /** posts one entry of the build through the engine: prepared by one person, approved by others, as any entry */
    const enter = async (date: string, voucher_type: string, narration: string, raw: (JournalLineInput | null)[]): Promise<string | null> => {
      const lines = raw.filter((l): l is JournalLineInput => !!l)
      // entries the person is not cleared to read are missing from what was read: the entry is closed on the suspense ledger, and says so
      const diff = lines.reduce((t, l) => t.plus(D(l.debit)).minus(D(l.credit)), ZERO)
      if (!diff.isZero()) {
        if (!suspense) { notes.push(`What you may read for ${date} does not add up to zero (difference ${diff.toFixed(2)}) and the company has no suspense ledger: that entry was left out.`); return null }
        lines.push(line(suspense, diff.neg(), 'Difference between what you may read and what balances')!)
        notes.push(`What you may read for ${date} differs by ${diff.abs().toFixed(2)}: some entries are outside your clearance. The difference is held in the suspense ledger of the sandbox.`)
      }
      if (lines.length < 2) return null
      e.actor = 'demo-accountant'
      const id = await e.saveJournalDraft({ company_id: c.id, journal_date: date, voucher_type, source: 'opening', narration, lines })
      await e.submitJournal(id)
      for (let k = 0; k < approvers.length && e.journals.find((x) => x.id === id)!.status === 'submitted'; k++) { e.actor = approvers[k]; await e.approveJournal(id, 'Brought into the sandbox') }
      e.actor = 'demo-owner'
      await e.postJournal(id)
      row.entries++
      return e.journals.find((x) => x.id === id)!.total as string
    }
    try {
      const total = await enter(opened, 'opening', `${BUILD} balances as the books stood on ${opened}`,
        balances.filter((b) => b.company_id === c.id && usable.has(b.account_id)).map((b) => line(b.account_id, D(b.opening_debit).plus(b.period_debit).minus(b.opening_credit).minus(b.period_credit), 'Balance brought into the sandbox')))
      if (total) { row.opening_total = total; row.opening_lines = e.linesByJournal.get(e.journals[e.journals.length - 1].id)?.length ?? 0 }
      const months = [...new Set(monthly.filter((m) => m.company_id === c.id).map((m) => m.month.slice(0, 7)))].sort()
      for (const m of months) {
        const last = endOfMonth(m + '-01')
        await enter(last > asOf ? asOf : last, 'journal', `${BUILD} what moved in each ledger in ${m}, as one entry`,
          monthly.filter((x) => x.company_id === c.id && x.month.slice(0, 7) === m && usable.has(x.account_id)).map((x) => line(x.account_id, D(x.debit).minus(x.credit), `Movement of ${m}`)))
      }
      // what customers owe and what vendors are owed is set against each party, inside the ledger that carries it: the ledger itself does not change
      const main = ['receivable', 'payable']
      const controls = [...main, ...new Set(byParty.filter((x) => x.company_id === c.id && !main.includes(x.control_type)).map((x) => x.control_type))]
      for (const control of controls) {
        const carrier = ledgers.filter((a) => a.control_type === control && usable.has(a.id))
        if (carrier.length !== 1) {
          // the books state what a party owes by kind of ledger, not by ledger: with several ledgers of one kind the share of each cannot be known
          if (carrier.length > 1 && main.includes(control)) notes.push(`Several ledgers carry what is ${control}: the balances of the parties were not brought in.`)
          else if (byParty.some((x) => x.company_id === c.id && x.control_type === control)) report.left_out.push(`${c.code}: balances by party in ledgers of the kind "${control.replace(/_/g, ' ')}" — ${carrier.length > 1 ? 'several ledgers carry them' : 'you may not read the ledger that carries them'}. The ledgers themselves hold their balances.`)
          continue
        }
        const parts = byParty.filter((x) => x.company_id === c.id && x.control_type === control && e.parties.some((q) => q.id === x.party_id)).map((x) => ({ party: x.party_id, net: D(x.debit).minus(x.credit).toDecimalPlaces(2) })).filter((x) => !x.net.isZero())
        if (!parts.length) continue
        const all = parts.reduce((t, x) => t.plus(x.net), ZERO)
        await enter(asOf, 'journal', `${BUILD} ${control === 'receivable' ? 'what each party owes' : control === 'payable' ? 'what each party is owed' : `the balance of each party in ${carrier[0].name}`}, as the books stand on ${asOf}`,
          [...parts.map((x) => line(carrier[0].id, x.net, 'Balance of the party', x.party)), line(carrier[0].id, all.neg(), 'Set against the parties')])
      }
      if (!row.entries) notes.push('The books of this company hold no balance. It starts empty.')
    } catch (err) {
      notes.push(`An entry of the build was refused: ${err instanceof Error ? err.message : String(err)} What had been brought in until then stays.`)
    }
    row.note = notes.length ? [...new Set(notes)].join(' ') : null
  }
  for (const [p, status] of locks) p.status = status
  report.audit_rows = e.audit.length
  // the person enters as the one who prepares: approving then needs a second person, as in the real books
  e.actor = 'demo-accountant'
  e.notifications = []
  return { engine: e, report }
}
