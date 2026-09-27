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
├── src/engine      pure accounting logic: reports, templates, language parser   (no I/O)
├── src/api/types   NumeroApi — the single data contract
│     ├── supabase.ts   LIVE  → Supabase (Postgres 17 + Row Level Security + RPC)
│     └── demo.ts       DEMO  → in-browser ledger engine with labelled sample data
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

Deterministic answer engine (`src/numi/engine.ts`). No external model is called in this phase.

* Reads only through `NumeroApi` → permission mirror.
* Every answer states basis (FACT / INFERENCE / SUGGESTION), truth state, scope and period, assumptions, and links to evidence.
* If it cannot answer from recorded data it says so. It never invents a number.
* It has no write path to posting, approval or payment.
* Learned classification rules come only from classifications a person approved; administrators can inspect and disable them.

## 6. Voice

`src/voice/gateway.ts` — provider gateway. `BrowserSpeechProvider` works today. `SarvamProvider` is an adapter that reports itself unavailable until a server-side key is configured.

`src/voice/commands.ts` — pure interpreter. **Sensitive verbs are matched first** (transfer, pay, approve, reject, post, reverse, delete, write off, lock, reopen) and are never turned into actions: the relevant screen opens and the person must act. Every voice command is written to `voice_audit`.

## 7. Demo universe

`src/api/demo.ts` is a complete ledger engine in TypeScript with the same invariants as the database. `src/api/demoSeed.ts` builds five fictional companies with twelve months of activity **by posting real journals through that engine**. A gold banner marks every screen as sample data; exports are suffixed `-DEMO`.

## 8. Known architectural limits in this phase

* Monetary values cross the API as JSON numbers. Exact to 4 decimals up to roughly ₹100 billion per figure; beyond that the RPCs should return text.
* Consolidation does not yet apply ownership percentages, non-controlling interests, currency translation, or elimination of intercompany income and expense.
* Documents cannot yet be attached; the source of a manual journal is recorded in its narration.
* No external model, OCR, bank feed, email or messaging integration is connected.
