# NUMERO ARCHITECTURE

> ONE FINANCIAL UNIVERSE. UNLIMITED COMPANIES. UNLIMITED ACCOUNTING STRUCTURES.

This document describes what is **actually built**. Anything not described here is not built; its status is in the requirement ledger.

## 1. Build order (spec: Final Build Directive, 1530)

Foundation first, decoration last:

1. Database integrity → 2. Accounting engine → 3. Tenant architecture → 4. Permissions → 5. Audit → 6. Posting → 7. Reconciliation → 8. Workflow → 9. Security → 10. Interface.

## 2. System shape

```
Browser (React + TypeScript, Vite)
│
├── src/engine      pure logic, no I/O: reports, templates, language parser,
│                   forward.ts (what is coming), ops.ts (advances, assets, matching, debt, people cost),
│                   stock.ts, invest.ts, reality.ts, twin.ts, analysis.ts, features.ts (Phase 3)
├── src/api/types   NumeroApi = CoreApi (ledger) + OpsApi (operations) + Phase3Api — the single data contract
│     ├── supabaseCore → supabaseOps → supabaseP3 → supabase.ts   LIVE  → Supabase (Postgres 17 + Row Level Security + RPC)
│     └── demoCore → demoOps → demoOpsB → demoInventory → demoInvest → demoControl → demoPlatform → demo.ts
│                                                          DEMO  → in-browser engine with labelled sample data
├── src/lib         data helpers shared by screens and NUMI (forwardData.ts, twinData.ts, realityData.ts,
│                   sandbox.ts, workflow.ts, data.ts)
├── src/numi        NUMI answer engine (reads through NumeroApi only)
├── src/voice       provider-agnostic voice gateway + command interpreter
├── src/ui          design system, charts, shell, command palette
└── src/pages       screens
```

The interface never talks to the database directly. Every screen, NUMI, the command palette and voice all go through `NumeroApi`, so **permissions are enforced once, at the data layer**, and NUMI can never see more than the person asking.

## 3. Database (Supabase project `GHL NUMERO`, region ap-south-1)

| Migration | Contents |
|---|---|
| `0001_core_tenancy_audit` | groups, profiles, companies, roles, permissions, memberships, append-only audit log, bootstrap, access grants |
| `0002_ledger_engine` | currencies, dimensions (org units), party universe, chart of accounts, fiscal periods, journals, journal lines, approvals, Black Vault, integrity guards, journal workflow |
| `0003_documents_banking_budgets` | tax engine, invoices/bills/notes, payments, banking and reconciliation, budgets, company creation, party creation, bank-detail change protection |
| `0004_reporting_sentinel_numi` | ledger reporting functions, time machine, drill-down with restricted masking, Sentinel rules, NUMI learned rules, voice audit, dynamic field definitions, requirement ledger |
| `0005_party_on_document_lines` | revenue and expense lines of approved documents carry the party, for spend analysis and the money map |
| `0006_workflow_registers_documents` | new permissions and roles, the general approval engine, **the proposal engine** (`workflow_postings`, `propose_posting`, `wf_dispatch`), account mapping, registers (kinds as data), follow-ups, document vault with private storage, custom field values |
| `0007_assets_purchasing` | fixed-asset register, depreciation runs, disposal, impairment, asset events; purchase-to-pay documents, receipts, vendor selection, bill-to-order link, three-way alerts, credit-limit alert |
| `0008_expenses_advances_cash` | expense categories and policy, advances, expense claims, reimbursement, cash boxes and counts, fund transfers (including between companies), promises to pay |
| `0009_treasury_payroll` | loans and schedules, fixed deposits, employees, salary structures, payroll runs, salary payment, payroll privacy in the audit trail |
| `0010_money_ledger_null_safety` | every "must be a bank or cash ledger" check made safe against a ledger with no control type (also corrects Phase 1 payments) |
| `0011_review_corrections` | corrections found when every requirement was reviewed against the code: loan recovery through payroll reaches the instalment schedule; an advance to a vendor sits in the vendor advances ledger; a claim or advance linked to a register item carries its dimension; the cash box limit for a single payment is checked; a later approver cannot raise an advance; stored files an uploader may read or, if never registered, remove |
| `0012_follow_up_confidentiality` | a follow-up takes the confidentiality of the record it is linked to |
| `0013_review_corrections_2` | found when the corrections were reviewed: a custom field that belongs to one sub-type is asked only of that sub-type; a follow-up follows its record when the record is reclassified; a claim or an advance is at least as confidential as the register item it names |
| `0014_inventory` | Phase 3 permissions and roles; stock categories, locations, items, lots and serial numbers, stock documents (receipt, issue, transfer, return, adjustment, landed cost), the stock ledger with its cost layers, holds, stock counts, the history of a unit that was sold |
| `0015_investments_funds` | who owns what (corporate links, shareholders), holdings and their transactions and valuations, funds, commitments, capital calls, units, distributions, net asset value, management fee |
| `0016_reality_control` | materiality, cases with an append-only history, physical verification, confirmations from outside, reclassification, allocation of shared costs |
| `0017_scenarios_flows` | saved simulations and their runs (always labelled SIMULATION), drivers approved by a second person; workflow definitions with versions, cases and their steps |
| `0018_platform` | notifications and the rules of attention, message templates and prepared communications, the integrations register, capability switches, recorded backups and restore tests, imports with validation, legacy balances for the parallel run, monthly facts for analysis, system health; travel booking detail on claim lines; the register kind for generators |
| `0019_corrections_after_assessment` | found when release 0.3.0 was assessed: stock moved between two places keeps the age of its receipt; a stock document is not dated in the future; system health compares a stock ledger that holds no item; the class of an alert follows its amount or its difference; a Group Super Admin is told of an approval that waits only when it is classed for the owner or nobody else could approve it; a verification opened by mistake can be cancelled; a statement line matched in part is not reconciled, in system health too; `api_row_probe`, with which the application measures how many rows the API hands over to one request |

The numbered files in `supabase/migrations/` are rebuilt from the migrations recorded in the database, so the repository and the database say the same thing.

### Two schemas

* `public` — tables and thin RPC wrappers. Exposed through the API. Every table has Row Level Security enabled.
* `numero_private` — all `SECURITY DEFINER` logic. **Not exposed through the API.** Anonymous users have no access to it at all.

### Invariants enforced by the database itself

These hold no matter what client, script or future module writes to the database.

| Invariant | Mechanism |
|---|---|
| Total debits = total credits for every posted journal | `assert_balanced` runs in the posting function **and again** in a trigger on the status change |
| A line is either a debit or a credit | `CHECK ((debit = 0) <> (credit = 0))` |
| Posted journals and lines are immutable | `guard_journal`, `guard_journal_line`, `guard_journal_dim` triggers refuse UPDATE/DELETE — including for privileged roles |
| Journals are never deleted | DELETE always raises; drafts are cancelled and kept |
| Status changes only through controlled functions | trigger refuses status changes made by client roles |
| Corrections are reversals | `reverse_journal` posts an equal and opposite journal and links both |
| No posting into a locked period | `assert_period_open` in every posting path |
| Reopening a period needs a reason | `set_period_status` |
| Maker ≠ checker | `check_maker_checker`; Owner self-approval only if explicitly configured, recorded as `override` |
| Idempotent posting | unique `(company_id, idempotency_key)`; event postings use keys such as `invoice:<id>` |
| Audit trail is append-only | trigger refuses UPDATE/DELETE/TRUNCATE on `audit_log`, `vault_access_log`, `voice_audit`, `numi_log` |
| Bank statement lines are evidence | facts cannot be altered or deleted after import |
| Approved budgets are never overwritten | `guard_budget`; revisions are new versions |
| Tax rates are data with effective dates | `tax_code_components.effective_from / effective_to`; no rate exists in code |
| Privilege fields cannot be self-assigned | `guard_profile` |

### Tenant isolation

* Every business table carries `company_id`. Policies call `numero_private.has_company_access()` / `can(company, permission)`.
* Group Super Admins see all companies of their group. Everyone else sees only companies they hold a membership in, within the validity dates of that membership (temporary access expires on its own).
* Reporting functions filter the requested company list to the ones the caller may read **before** aggregating, so an unauthorised company contributes nothing — not even a total.
* One party, many roles: a party is visible to a user only through a relationship with a company that user can access.

### Black Vault — private is not false (spec 325–360)

* Journals and documents carry a confidentiality level.
* Row Level Security hides restricted **detail** from uncleared users.
* Reporting totals are computed by definer functions that include **every** posted line, so statements stay truthful.
* Drill-down returns a masked bucket — count and total of restricted entries — so every drill-down still ties to the report.
* Opening a restricted record, successfully or not, is written to `vault_access_log`.

### Event-driven accounting (spec 69)

| Event | Posting |
|---|---|
| InvoiceApproved | Dr Receivable (party) · Cr Revenue lines · Cr Output tax by component |
| BillApproved | Dr Expense/Asset lines · Dr Input tax · Cr Payable (party) |
| PaymentReceived | Dr Bank · Cr Receivable · Cr Customer advance (unallocated part) · exchange difference |
| PaymentMade | Dr Payable · Dr Vendor advance (unallocated part) · Cr Bank · exchange difference |

### Operations never write to the ledger: the proposal engine (Phase 2)

APPROVAL ≠ FUND TRANSFER ≠ EXPENSE ≠ ACCOUNTING CLASSIFICATION ≠ SETTLEMENT. Each is a separate, recorded event.

An operational record — an advance, a claim, a depreciation run, a loan instalment, a payroll run — has **no write path to the ledger**. It calls one function:

```
numero_private.propose_posting(company, voucher type, date, narration, source, source_id, lines, payload, confidentiality)
```

which

1. creates a journal with origin `system`, writes its lines and asserts that it balances;
2. opens an approval request under the same amount-based rules as any journal, and sets the journal to `submitted`;
3. records a row in `workflow_postings` (`pending`) that ties the journal to its source record.

From there the journal is an ordinary journal in the approval inbox, with three differences:

| Rule | Mechanism |
|---|---|
| It cannot be edited by hand | `save_journal_draft` refuses a journal that has a workflow posting. To change it: reject it and issue it again from the source record. |
| On its final approval it is posted at once | `approve_journal` posts it and calls `wf_dispatch(journal, 'posted')`, which runs `numero_private.wf_<source>(posting, event)` to update the source record in the same transaction |
| Rejection, cancellation and reversal reach the source | `wf_dispatch(…, 'voided' | 'reversed')`. A handler may refuse by raising — for example, a depreciation month cannot be reversed while a later month stands |

Only one pending proposal can exist for a source record at a time. The proposer cannot approve their own proposal (maker-checker applies unchanged). A person cannot approve an entry they are not cleared to read.

| Source | Proposed entry | When posted |
|---|---|---|
| `depreciation` | Dr depreciation expense (by department) · Cr accumulated depreciation, by category | each asset's accumulated depreciation rises; the month is closed for depreciation |
| `asset_disposal` | Dr bank (proceeds) · Dr accumulated depreciation · Dr/Cr gain or loss · Cr asset at cost | the asset leaves the register |
| `asset_impairment` | Dr impairment loss · Cr accumulated depreciation | book value falls |
| `advance_release` | Dr advances held by the person · Cr bank or cash | released amount rises. **No expense.** |
| `advance_return` | Dr bank or cash · Cr advances held by the person | returned amount rises |
| `expense_claim` | Dr each expense ledger · Cr advance settled · Cr reimbursement payable · Cr company card or cash for lines the company paid | expense recognised; advance settled by the approved amount |
| `claim_payment` | Dr reimbursement payable · Cr bank or cash | claim is settled |
| `fund_transfer` / `fund_transfer_in` | one entry inside a company; two entries between companies, through the intercompany ledgers | transfer posted; one side standing alone raises an alert |
| `loan_disbursement`, `loan_instalment` | principal to or from the loan ledger; interest **as actually charged** to the interest ledger | schedule and loan balances updated |
| `fd_placement`, `fd_closure` | deposit placed; on closure interest = proceeds + tax deducted − principal | deposit active or closed |
| `payroll` | Dr salary cost **by department** · Cr deductions payable · Cr net salaries payable. Confidential. No person is named on a salary line. | salaries payable; advance and loan recoveries applied |
| `payroll_payment` | Dr net salaries payable · Cr bank | run is paid |

Phase 3 adds these sources, under the same rules:

| Source | Proposed entry | When posted |
|---|---|---|
| `stock_doc` — receipt | Dr stock · Cr goods received, not invoiced (or the ledger the document names) | the quantity enters the stock ledger as a layer at its cost |
| `stock_doc` — issue, return to vendor | Dr cost of sales (or goods received, not invoiced) · Cr stock, at the cost the stock ledger gives: first in first out, or weighted average | the quantity leaves; the layers it came from are reduced |
| `stock_doc` — return from customer | Dr stock · Cr cost of sales | the quantity returns as a new layer |
| `stock_doc` — adjustment, stock count | Dr stock lost · Cr stock, or Dr stock · Cr stock found; every line carries its reason | book quantity becomes what was counted |
| `stock_doc` — landed cost | Dr stock for the part of the receipt still in stock · Dr cost of sales for the part that has left · Cr landed cost clearing, charge by charge | the cost of the layer rises |
| `holding_txn` | purchase, sale (carrying amount released, gain or loss), income with tax deducted, write-down, change in fair value | quantity, cost and fair value of the holding |
| `capital_receipt` | Dr bank · Cr capital of the investors | units allotted at the price of the call |
| `distribution` | Dr the equity ledger it is paid out of · Cr payable to each holder | declared. Nothing is paid. |
| `distribution_payment` | Dr payable to the holder · Cr bank · Cr tax deducted | the holders chosen are paid |
| `fund_fee` | Dr management fees · Cr management fees owed to the manager (a ledger of its own, not the vendor control ledger) | the period is charged |
| `reclassification` | the amount leaves the ledger it was posted to and enters the one it belongs in | the original entry is unchanged; the line records what was moved |
| `allocation` | Cr the unit that holds the cost · Dr each unit that shares it, same ledger | the cost is shared by the driver recorded |

A transfer of stock between two places of one company changes place, not value: it proposes nothing and is recorded at once. A stock document that carries no value records quantities only.

**The stock ledger and the general ledger say the same value**, because a quantity changes value only through a stock document, and every stock document proposes its own entry. A journal typed by hand into a stock ledger makes them differ; the difference is shown on the inventory screen, in Reality and in System Health. It is never adjusted away.

Documents that are **not** accounting events never touch the ledger at all: a capital call (approving it makes the amount owed by the investors and posts nothing), a valuation of a holding carried at cost, a net asset value, a case, a verification, a confirmation, a simulation, a workflow case, a notification, a prepared communication, a staged import. And, from Phase 2: requisitions, requests for quotation, quotations, purchase orders, goods and service receipts, register items, promises to pay, cash counts, follow-ups, documents. A purchase order is a COMMITMENT; the cost arises with the vendor's bill.

### The general approval engine (Phase 2)

`open_request`, `decide_request`, `refuse_request` give advances, expense claims, requisitions, purchase orders, capital calls and distributions the same multi-step, amount-based approval as journals. The approval inbox lists all of them; each can be decided there or on its own screen.

### Account mapping

The posting engines never choose a ledger. Each uses the ledger a person has mapped to a role (`company_account_map`, edited under Chart of Accounts → Account mapping). A role with no ledger makes the operation **refuse with an explanation**; nothing is posted to a guessed account.

### Registers: kinds are data

Subscriptions, insurance, rent, leases, contracts, guarantees, legal matters, vehicles, incidents, trips and so on are rows of `register_kinds`, each with its own field schema. The 51 system kinds are generated from `src/engine/registerKinds.json`, the single source for the database and the demo. A group can add kinds or make its own version of a system kind without code. A kind may create a dimension (org unit) so that spending can be traced to the item.

### Documents

Files live in a private storage bucket, `numero-documents`, under `{company_id}/…`; storage policies apply the same company permissions as the tables. `register_document` records the SHA-256 fingerprint; identical content is **kept and flagged** POSSIBLE DUPLICATE. Documents are never deleted and their recorded facts cannot be altered. Reading a document's contents automatically is not built: classification is done by a person.

### What a person may not see

The database answers an unauthorised read with **no rows, not an error**. An empty list therefore proves nothing. Wherever "none" would be a statement — NUMI, Forward, the operations screens — the permission is checked first: the screen says the role does not include it, Forward names the sources left out of its figures, and NUMI says it is not authorised and does not say whether records exist.

### A simulation is never an actual (Phase 3)

`src/engine/twin.ts` is pure arithmetic. It is given a starting point read from the books (`src/lib/twinData.ts`) and a list of assumptions, and returns month-by-month figures labelled `SIMULATION`, with the formula of every assumption and a note for everything it could not model. It has no write path. A saved run (`scenario_runs`) carries a `CHECK (label = 'SIMULATION')` and cannot be updated. An assumption may name a driver; the driver's value is used only if a second person approved it.

### Reality: five counts, never one score (Phase 3)

`src/engine/reality.ts` sets five realities against each other — document, operation, accounting, cash, physical — along eight chains that are fixed (purchase, sale, advance, asset, cash box, stock, bank, and the last completed verification sheet of each place). A difference is returned with both readings and what each says, under a key that is the key of its record, so that a case opened on it stays with it while what differs changes. Amounts are stated in the currency of the company; differences are listed by amount, which across companies with different currencies is the order of the figures and not of their worth. `realityHealth` returns five separate counts. A chain that was never checked is listed as never checked; a source the person may not read is named. The engine states facts; a person decides what they mean, in a case whose history is append-only.

**Who is told.** A notice is written for the people who hold the permission to act, never for the person whose action it is. Of an approval that waits, a Group Super Admin is told only when the rules of the group class it as owner action or critical, or when nobody else could approve it: the owner is not to be overwhelmed with routine bookkeeping. The inbox of approvals still shows every request. The class of an alert is worked out from its amount or, where it carries none, from its difference, by its size.

### Nothing leaves NUMERO (Phase 3)

Notifications are rows shown inside the application; preferences for other channels are recorded and deliver nothing. A communication is prepared from a template and its text is fixed; a person sends it from their own mailbox and records that they did. The integrations register holds no secret, refuses text that looks like one, and treats an integration that can move money as high risk. Backups are made by the database provider; a person records that one was made and that one was restored, and System Health shows "not recorded" until someone has.

### Capability switches (Phase 3)

`feature_flags` switches a capability on or off for the group, a company or a role. The most specific switch decides (company and role, then company, then role, then the group); no switch means on. The menu and the routes honour it. Switching a capability off hides its screens: it removes no data and changes no permission. What the application cannot be run without — journals, the ledger, the chart, parties, approvals, the audit trail, team and access — cannot be switched off.

### The sandbox (Phase 3)

`src/lib/sandbox.ts` builds a second engine in the memory of the browser from the configuration the person may read and from the figures of the ledger: the balances of a year ago as one entry per company, what moved in each ledger since as one entry a month, and what each party owes or is owed today inside the ledger that carries it. The Digital Twin therefore has the same months to average in the sandbox as in the books. The application is then pointed at that engine; the real one is set aside untouched. It copies no salary, no confidential record, no document and no history of transactions. Exports made there are marked `-SANDBOX`. It is discarded on leaving or reloading. It works the same in the demo and against the live database, because it reads through `NumeroApi` and writes only to itself.

### Reading lists from the database (Phase 3)

The API of the database hands over a page of rows to one request — 1,000 unless the 'Max rows' setting of the project was changed — also for a function that returns rows. A list cut short in silence would be a false list, so every list of the live data layer goes through one of three readers (`src/api/paging.ts`, `src/api/supabaseCore.ts`). The size of a page is measured once in every session (`apiPage` asks `public.api_row_probe` for 1,001 numbers and counts what arrives), never assumed:

| Reader | What it does |
|---|---|
| `all(query, ceiling)` | reads to the end page by page, in a complete order (the key of the table is added after the order asked for). A list longer than its ceiling — 20,000 rows unless stated — is **refused with a message**, never cut |
| `first(query, n)` | the first `n` rows of a list that is shown in part: the newest notices, the latest movements. The screen names the number |
| `rpcAll(function, arguments, order)` | the same for `ledger_balances`, `ledger_monthly`, `party_ledger_balances` and `stock_on_hand`; ceiling 200,000 rows |

The readers are tested against a query that answers as the API does (`tests/p3app.test.ts`), and the measure in the database (T278). That each list of the live data layer uses them with the right key is type-checked only: that code runs against the live database alone.

## 4. Reporting model

Every report of the library that rests on records shows the reconciliation status of those records under its heading (`src/ui/RealityNote.tsx`, `realityOfReport` in `src/engine/reality.ts`): what NUMERO Reality finds to differ among them, as the records stand today. It changes no figure of the report.

The database returns **per-account aggregates**; statements are composed in `src/engine/reports.ts`.

* `ledger_balances(companies, from, to, known_at, dimension)` → opening and period debits/credits per account.
* Profit & Loss, Balance Sheet, Cash Flow (indirect), Trial Balance, ratios and consolidation are pure functions of those balances, so the same code serves live and demo data and is unit-tested.
* Every statement line carries the account ids behind it → click → general ledger → voucher → source document.
* Balance sheet: income/expense of earlier, unclosed years is presented as accumulated result; the current year as "Current period profit / (loss)". The equation is checked and displayed on every render.
* Cash flow always displays the unexplained difference, even when zero.

### Time machine (spec 88, 505)

Two independent axes: **journal date** (`to`) and **knowledge date** (`known_at` = posted on or before). Choosing a date in the period picker reconstructs the books from the entries that existed on that date.

## 5. NUMI

Deterministic answer engine (`src/numi/engine.ts`, `src/numi/ops.ts` for operations, `src/numi/p3.ts` for stock, investments, reality, simulations and the platform). No external model is called.

* Reads only through `NumeroApi` → permission mirror.
* Every answer states basis (FACT / INFERENCE / SUGGESTION), truth state, scope and period, assumptions, and links to evidence.
* If it cannot answer from recorded data it says so. It never invents a number.
* It has no write path to posting, approval or payment.
* Learned classification rules come only from classifications a person approved; administrators can inspect and disable them.
* It checks the person's permission before it reads, and reports a refusal as a refusal.
* It gives payroll totals and never states what an individual is paid.
* Observations about a person's advances are facts from the records, stated without a conclusion.
* What is at stake in stock is called EXPOSURE and is said not to be a loss.
* A "what if" is answered as a SIMULATION, with the assumptions it read from the question; an assumption it cannot read is not guessed.

## 6. Voice

`src/voice/gateway.ts` — provider gateway. `BrowserSpeechProvider` works today. `SarvamProvider` is an adapter that reports itself unavailable until a server-side key is configured.

`src/voice/commands.ts` — pure interpreter. **Sensitive verbs are matched first** (transfer, pay, approve, reject, post, reverse, delete, write off, lock, reopen; and in operations: release or settle an advance, reimburse, run payroll, dispose of an asset, repay a loan, break a deposit, place an order, select a vendor; and in Phase 3: issue, transfer, adjust or write off stock, declare or pay a distribution, buy or sell an investment, call capital, commit an import, reclassify or allocate, send a message, switch a capability or an integration) and are never turned into actions: the relevant screen opens and the person must act. Every voice command is written to `voice_audit`.

## 7. Demo universe

`src/api/demoCore.ts` … `demoPlatform.ts` and `demo.ts` are a complete engine in TypeScript with the same rules as the database, including the proposal engine. `src/api/demoSeed.ts`, `demoSeedOps.ts` and `demoSeedP3.ts` build six fictional companies — five operating companies and a fund, which keeps books of its own — with twelve months of activity **by posting real journals and running real workflows through that engine**. The two trading companies kept their stock in the general ledger only until 35 days ago; on that day the stock was taken on into the stock ledger (quantities as counted, value as the books carried it), and since then goods reach the books through stock documents. In the demo every user holds every permission; permission refusals are tested against the database. A gold banner marks every screen as sample data; exports are suffixed `-DEMO`.

## 8. Known architectural limits in this phase

* Monetary values cross the API as JSON numbers. Exact to 4 decimals up to roughly ₹100 billion per figure; beyond that the RPCs should return text.
* Consolidation does not yet apply ownership percentages, non-controlling interests, currency translation, or elimination of intercompany income and expense.
* No external model, OCR, bank feed, email or messaging integration is connected. Nothing leaves the application: warnings, follow-ups and notifications are shown on screen only.
* A workflow of the Scenario Studio is started by a person. Triggers by e-mail, schedule, bank transaction or detection are recorded as intent and start nothing.
* The digital twin is arithmetic on monthly rates. It does not learn, and it does not model seasonality, price and volume separately, or tax law.
* Net asset value is an accounting figure from the books of the fund's company. It is not a regulatory valuation, and carried interest is not computed.
* Manufacturing (bills of material, work in progress) is not built.
* The role of a person is read from the team list. Where a person may not read that list, a capability switched off for a role is not applied to them; switches for the group and for a company always are.
* Nothing runs on a schedule. A person starts each depreciation run, payroll run and Sentinel run.
* Register items, advances and claims carry a currency but no exchange rate. A figure in another currency is counted at face value, and the screens say so.
* Statutory amounts in payroll are whatever the company records. NUMERO does not calculate what the law requires.
* Hard budget limits are not enforced; budget context on a purchase order is information.
* Forward leaves out a scheduled occurrence when a bill or invoice from the same party is recorded for that period. That is an inference from party and date; the screen lists what was left out.
* An amount marked POSSIBLE or PROBABLE is counted in full; a recorded probability is shown, never applied.
