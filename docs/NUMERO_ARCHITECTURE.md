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
│                   forward.ts (what is coming), ops.ts (advances, assets, matching, debt, people cost)
├── src/api/types   NumeroApi = CoreApi (ledger) + OpsApi (operations) — the single data contract
│     ├── supabaseCore.ts → supabase.ts   LIVE  → Supabase (Postgres 17 + Row Level Security + RPC)
│     └── demoCore.ts → demoOps.ts → demo.ts   DEMO  → in-browser engine with labelled sample data
├── src/lib         data helpers shared by screens and NUMI (forwardData.ts, workflow.ts, data.ts)
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

Documents that are **not** accounting events never touch the ledger at all: requisitions, requests for quotation, quotations, purchase orders, goods and service receipts, register items, promises to pay, cash counts, follow-ups, documents. A purchase order is a COMMITMENT; the cost arises with the vendor's bill.

### The general approval engine (Phase 2)

`open_request`, `decide_request`, `refuse_request` give advances, expense claims, requisitions and purchase orders the same multi-step, amount-based approval as journals. The approval inbox lists all of them; each can be decided there or on its own screen.

### Account mapping

The posting engines never choose a ledger. Each uses the ledger a person has mapped to a role (`company_account_map`, edited under Chart of Accounts → Account mapping). A role with no ledger makes the operation **refuse with an explanation**; nothing is posted to a guessed account.

### Registers: kinds are data

Subscriptions, insurance, rent, leases, contracts, guarantees, legal matters, vehicles, incidents, trips and so on are rows of `register_kinds`, each with its own field schema. The 50 system kinds are generated from `src/engine/registerKinds.json`, the single source for the database and the demo. A group can add kinds or make its own version of a system kind without code. A kind may create a dimension (org unit) so that spending can be traced to the item.

### Documents

Files live in a private storage bucket, `numero-documents`, under `{company_id}/…`; storage policies apply the same company permissions as the tables. `register_document` records the SHA-256 fingerprint; identical content is **kept and flagged** POSSIBLE DUPLICATE. Documents are never deleted and their recorded facts cannot be altered. Reading a document's contents automatically is not built: classification is done by a person.

### What a person may not see

The database answers an unauthorised read with **no rows, not an error**. An empty list therefore proves nothing. Wherever "none" would be a statement — NUMI, Forward, the operations screens — the permission is checked first: the screen says the role does not include it, Forward names the sources left out of its figures, and NUMI says it is not authorised and does not say whether records exist.

## 4. Reporting model

The database returns **per-account aggregates**; statements are composed in `src/engine/reports.ts`.

* `ledger_balances(companies, from, to, known_at, dimension)` → opening and period debits/credits per account.
* Profit & Loss, Balance Sheet, Cash Flow (indirect), Trial Balance, ratios and consolidation are pure functions of those balances, so the same code serves live and demo data and is unit-tested.
* Every statement line carries the account ids behind it → click → general ledger → voucher → source document.
* Balance sheet: income/expense of earlier, unclosed years is presented as accumulated result; the current year as "Current period profit / (loss)". The equation is checked and displayed on every render.
* Cash flow always displays the unexplained difference, even when zero.

### Time machine (spec 88, 505)

Two independent axes: **journal date** (`to`) and **knowledge date** (`known_at` = posted on or before). Choosing a date in the period picker reconstructs the books from the entries that existed on that date.

## 5. NUMI

Deterministic answer engine (`src/numi/engine.ts`, and `src/numi/ops.ts` for operations). No external model is called.

* Reads only through `NumeroApi` → permission mirror.
* Every answer states basis (FACT / INFERENCE / SUGGESTION), truth state, scope and period, assumptions, and links to evidence.
* If it cannot answer from recorded data it says so. It never invents a number.
* It has no write path to posting, approval or payment.
* Learned classification rules come only from classifications a person approved; administrators can inspect and disable them.
* It checks the person's permission before it reads, and reports a refusal as a refusal.
* It gives payroll totals and never states what an individual is paid.
* Observations about a person's advances are facts from the records, stated without a conclusion.

## 6. Voice

`src/voice/gateway.ts` — provider gateway. `BrowserSpeechProvider` works today. `SarvamProvider` is an adapter that reports itself unavailable until a server-side key is configured.

`src/voice/commands.ts` — pure interpreter. **Sensitive verbs are matched first** (transfer, pay, approve, reject, post, reverse, delete, write off, lock, reopen; and in operations: release or settle an advance, reimburse, run payroll, dispose of an asset, repay a loan, break a deposit, place an order, select a vendor) and are never turned into actions: the relevant screen opens and the person must act. Every voice command is written to `voice_audit`.

## 7. Demo universe

`src/api/demoCore.ts`, `demoOps.ts` and `demo.ts` are a complete engine in TypeScript with the same rules as the database, including the proposal engine. `src/api/demoSeed.ts` and `demoSeedOps.ts` build five fictional companies with twelve months of activity **by posting real journals and running real workflows through that engine**. In the demo every user holds every permission; permission refusals are tested against the database. A gold banner marks every screen as sample data; exports are suffixed `-DEMO`.

## 8. Known architectural limits in this phase

* Monetary values cross the API as JSON numbers. Exact to 4 decimals up to roughly ₹100 billion per figure; beyond that the RPCs should return text.
* Consolidation does not yet apply ownership percentages, non-controlling interests, currency translation, or elimination of intercompany income and expense.
* No external model, OCR, bank feed, email or messaging integration is connected. Nothing leaves the application: warnings and follow-ups are shown on screen only.
* Nothing runs on a schedule. A person starts each depreciation run, payroll run and Sentinel run.
* Register items, advances and claims carry a currency but no exchange rate. A figure in another currency is counted at face value, and the screens say so.
* Statutory amounts in payroll are whatever the company records. NUMERO does not calculate what the law requires.
* Hard budget limits are not enforced; budget context on a purchase order is information.
* Forward leaves out a scheduled occurrence when a bill or invoice from the same party is recorded for that period. That is an inference from party and date; the screen lists what was left out.
* An amount marked POSSIBLE or PROBABLE is counted in full; a recorded probability is shown, never applied.
