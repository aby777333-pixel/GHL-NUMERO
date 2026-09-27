# GHL NUMERO

**The Financial Operating System** — one financial universe, unlimited companies.

A multi-company accounting, finance and control platform built on a real double-entry ledger engine. Every posted entry balances, posted history is immutable, every sensitive action is attributed, companies are isolated at the database layer, and every figure drills down to the transaction behind it.

> Phases 1 and 2 of a specification with 1,916 numbered requirements are built. What is built, what is partial and what is planned is tracked honestly in the requirement ledger. See [Implementation status](docs/NUMERO_IMPLEMENTATION_STATUS.md).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5177 and choose **Explore the demo universe** — five sample companies with a year of fictional transactions, running on the accounting engine inside the browser. Nothing is saved.

To use your real books, create an account on the same screen. The first person to sign in with the designated owner email initialises the group and becomes Group Super Admin.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 5177 |
| `npm run build` | Type-check and production build into `dist/` |
| `npm test` | Accounting engine, operations engine, Forward, NUMI and command-interpreter tests |
| `npm run typecheck` | TypeScript only |
| `npm run ledger` | Rebuild the requirement ledger from the master specification |

## Configuration

Copy `.env.example` to `.env`. Both values are publishable: they are designed to be present in the browser, and the data is protected by Row Level Security. **No secret key belongs in this project's front end.**

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Database

Migrations live in `supabase/migrations/` and are applied in order. They are non-destructive: nothing is dropped.

Database rules are tested by the seven scripts in `tests/sql/`. Each runs inside a transaction that **always rolls back**, so it can be run against the real database without leaving a single row behind. Results are returned in the error message; every line must start with `PASS`.

Files are stored in the private bucket `numero-documents`, created by migration 0006.

## What it does

| Area | Screens |
|---|---|
| **Command** | Command Centre · Cockpit · Money Map · Forward (what is agreed, committed, due and at risk) · Registers (subscriptions, insurance, rent, contracts, guarantees, legal matters, vehicles, incidents and more) |
| **Transact** | Transaction Centre · Journals · Sales & Billing · Purchase Bills · Payments & Receipts · Banking |
| **Operate** | Expenses & Advances · Purchasing (requisition to three-way comparison) · Cash & Transfers · Treasury (loans, deposits, facilities, currency exposure) · Fixed Assets · Payroll · People Cost |
| **Books** | General Ledger · Chart of Accounts and account mapping · Reports · Budgets · Period Close |
| **Control** | Approvals (journals, proposed entries, advances, claims, requisitions, orders) · Follow-ups · Document Inbox · Sentinel · Audit Trail · Black Vault |
| **Build** | Companies · Genesis Builder · Team & Access · Calculators · Requirement Ledger · Settings |

An operation never writes to the ledger. Releasing an advance, paying a reimbursement, running depreciation or payroll, paying a loan instalment: each **proposes** an accounting entry, which a second person approves before it reaches the books. NUMERO records that money moved. It never moves money.

## Using it

| | |
|---|---|
| **Search and commands** | `Ctrl K` or `/` |
| **Ask NUMI** | `Ctrl /` |
| **Voice** | `Alt V`, then e.g. “Numero, show the balance sheet” |
| **Go to** | `g` then `h` home · `j` journals · `l` ledger · `r` reports · `p` parties · `b` banking · `a` approvals · `s` sentinel · `e` entry · `c` cockpit |
| **New journal** | `n` |
| **Theme** | sun / moon button, or say “dark mode” / “light mode” |
| **Privacy mode** | eye button, or say “hide the numbers” |
| **Command / Accounting mode** | switch in the top bar |
| **Time machine** | period picker → choose a date |

Voice can navigate, answer questions and prepare drafts. It can never approve, post, release, pay or move money.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/NUMERO_ARCHITECTURE.md) | How the system is built and which invariants it enforces |
| [Data model](docs/NUMERO_DATA_MODEL.md) | Tables and their relationships |
| [Permissions](docs/NUMERO_PERMISSIONS.md) | Roles, permissions and isolation rules |
| [AI specification](docs/NUMERO_AI_SPEC.md) | What NUMI does and what it must never do |
| [Test matrix](docs/NUMERO_TEST_MATRIX.md) | Which requirement is covered by which test |
| [Implementation status](docs/NUMERO_IMPLEMENTATION_STATUS.md) | Built, partial, planned — and known limitations |

The master specification (`GHL NUMERO PROMPT.docx`, `docs/NUMERO_MASTER_SPEC.md`) and the requirement ledger generated from it are tracked in this private repository. They are served to the application by the development server only and are never part of a production build.

## Principles

* Accounting correctness takes priority over visual effects.
* AI may recommend. AI must not silently change the books.
* Private is not the same as false: confidentiality controls who can see detail; it never removes anything from the ledgers.
* ACTUAL, BUDGET, EXPECTED, FORECAST, ESTIMATE and SIMULATION are never mixed without a label.
* Approval, fund transfer, expense, accounting classification and settlement are five different events.
* An advance is money held by a person. It is not an expense.
* A purchase order is a commitment. It is not a cost.
* A flag informs a person. It never decides.
* A screen never says "none" to a person who is simply not allowed to look.
* Nothing is dropped silently. If something is not built, the ledger says so.
