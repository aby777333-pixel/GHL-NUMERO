# NUMERO IMPLEMENTATION STATUS

Release 0.1.0 — Phase 1 foundation.

This report follows the rule of the specification: *do not claim something is complete when it is not*. A placeholder does not count. A screen without an engine does not count.

## The honest number

| Status | Requirements | Share |
|---|---:|---:|
| **TESTED** — built, and covered by an automated test | 74 | 3.9% |
| **IMPLEMENTED** — built and exercised end to end | 159 | 8.3% |
| **PARTIAL** — part works; the ledger note says what does not | 127 | 6.6% |
| **BLOCKED** — needs something only the owner can supply | 1 | 0.1% |
| **PLANNED** — not built | 1,555 | 81.2% |
| **Total indexed** | **1,916** | |

Nothing has been dropped. Every requirement keeps its number, its text and its status in the requirement ledger (Build → Requirement Ledger in the application, or `docs/NUMERO_REQUIREMENTS.md`).

Phase 1 was deliberately the foundation the specification asks to be built first: database integrity, the accounting engine, tenant isolation, permissions, the audit trail, posting and reconciliation — then the interface around them.

## Implemented in this release

**Foundation**
- Multi-company tenancy with Row Level Security on all 48 tables; 74 policies; no function callable anonymously
- Double-entry ledger engine: balanced postings, immutable posted history, reversal-only correction, gap-free voucher numbering, idempotent posting
- Maker-checker, multi-step approval rules by amount, Owner self-approval only when explicitly configured
- Period soft close and lock; reopening requires a reason
- Append-only audit trail with who, what, when, before, after and reason
- 14 system roles, 44 permissions, temporary access with automatic expiry

**Accounting**
- Chart of accounts with 12 company templates; 21 voucher types
- Sales invoices, purchase bills, credit and debit notes with configurable, date-versioned tax (CGST, SGST, IGST)
- Receipts and payments with allocation, advances, and exchange difference on settlement
- Bank statement import (CSV) with validation preview, match suggestions and six reconciliation statuses
- Budgets with versions, budget-versus-actual and overrun thresholds
- Party universe: one identity, many company relationships; duplicate detection; bank-detail change protection

**Reporting** — every line drills down to the ledger, the voucher and the source document
- Profit & Loss with comparison and common-size · Balance Sheet with live equation check · Cash Flow (indirect) with the unexplained difference always shown · Trial Balance
- Group consolidation with intercompany elimination and mismatch detection
- Ageing · Cash and bank book · Sales and purchase registers · Financial ratios with formula and inputs
- Where did the money go? · Where did the money come from? · Money Map · Forward (expected cash from recorded documents)
- Time machine: the books as of any date

**Control**
- Sentinel: eight factual anomaly rules, each with its explanation and the rule that raised it
- Black Vault: restricted detail is masked; totals always include it; access is logged
- Segregation-of-duties conflicts computed from role permissions
- Month-end close checklist computed from the data

**Intelligence and interface**
- NUMI: 16 kinds of question answered from recorded data, each with basis, scope, assumptions and evidence links
- Natural-language transactions: a sentence becomes a proposed balanced draft; ambiguity becomes a question
- Voice navigation with a provider gateway; sensitive commands are never executed
- Command palette and global search · keyboard navigation
- Command mode and Accounting mode · Simple and Professional presentation · Cockpit
- Dark and light themes · privacy mode · three levels of visual effects, honouring reduced-motion
- Calculator centre: ten calculators with formula and inputs shown
- Genesis Builder: structure levels and units, custom field definitions, party types, tax codes, learned rules, control settings

## Verification performed

| What | How | Result |
|---|---|---|
| Database invariants | `tests/sql/engine_invariants.sql`, `tests/sql/document_posting.sql` against the live database, rolled back | 48 of 48 pass |
| Database left clean | row counts after the tests | 0 groups, 0 companies, 0 journals, 0 audit rows, 0 users |
| Accounting engine and language parser | `npm test` | 97 of 97 pass |
| Anonymous access to the live API | direct requests with the publishable key | every table returns empty; every function returns permission denied |
| Supabase security advisor | advisor run after the final migration | no warnings; 4 informational notes for internal tables that intentionally have no client policy |
| Type safety | `tsc` strict | no errors |
| Production build | `npm run build` | succeeds; the requirement ledger is not in the output |
| Every screen | 42 routes loaded in the browser in demo mode | no load error, no console error |
| Journal workflow | driven in the browser: describe → draft → submit → approve → post → reverse | works; voucher `PV-2026-000079`, reversal `RJ-2026-000001` |
| Invoice and receipt | driven in the browser | ₹2,50,000 + CGST ₹22,500 + SGST ₹22,500; partial receipt left the invoice partially paid |
| Company wizard | driven in the browser | company created with 115 accounts |
| NUMI | ten questions asked in the browser | nine answered from the books; the tenth correctly declined |
| Privacy mode | browser | 56 of 56 figures masked |
| Theme, command palette | browser | work |

## Not verified — please check these yourself

| Item | Why it could not be verified here |
|---|---|
| **Signing in to the live system through the interface** | Creating an account or typing a password into a cloud service is something only you should do. The database behind it is tested; the sign-in screens are type-checked but have not been exercised with a real account. |
| **Microphone capture** | The build environment has no microphone. The command interpreter is tested; speech recognition itself needs Chrome or Edge with microphone permission. |
| **Email confirmation** | Supabase sends the confirmation link to the Site URL configured in your project. See below. |
| **Behaviour on a phone** | Layouts are responsive, but were checked at desktop width only. |

## Set-up steps only the owner can take

1. **Supabase → Authentication → URL Configuration**: set *Site URL* to where the application runs (for local use `http://localhost:5177`) and add the same address to *Redirect URLs*. Without this the confirmation email links to the wrong place.
2. **Create your account** on the welcome screen with the owner email, confirm it, sign in, and initialise the group. That account becomes Group Super Admin.
3. **Supabase → Authentication**: enable multi-factor authentication and leaked-password protection.
4. **Load the requirement ledger** into the database from Build → Requirement Ledger (live mode, Group Super Admin).

## Known limitations

- Amounts cross the API as JSON numbers: exact to four decimals up to about ₹100 billion per figure.
- Consolidation: no ownership percentages, non-controlling interests or currency translation; intercompany income and expense are not eliminated. The report says so on screen.
- Hard budget limits are stored but not enforced when posting.
- Custom fields can be defined and versioned but are not yet rendered inside forms.
- Documents cannot be attached yet.
- The approval inbox handles journals. Invoices and payments use single-step maker-checker.
- Lists load up to 500 or 1,000 rows at a time; each screen states the total and offers to load more or narrow the filter.
- The interface text is English only.
- NUMI is rule-based. It answers a fixed set of question kinds and says so when it cannot answer.
- Sarvam speech is **blocked** until an API key is provided and stored as a server-side secret.

## Deferred to later phases

Phase 2 — expense operations (travel, fleet, petty cash, cards), purchase orders and three-way match, payroll and people cost, fixed-asset register and depreciation schedules, treasury, document vault and extraction, NUMERO Forward commitments, Genesis form and workflow builders.

Phase 3 — inventory and landed cost, investment and fund accounting, digital twin and scenarios, reality engine, integrations, mobile application, language-model reasoning for NUMI.

Each deferred requirement remains in the ledger with its phase.
