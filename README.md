# GHL NUMERO

**The Financial Operating System** — one financial universe, unlimited companies.

A multi-company accounting, finance and control platform built on a real double-entry ledger engine. Every posted entry balances, posted history is immutable, every sensitive action is attributed, companies are isolated at the database layer, and every figure drills down to the transaction behind it.

> The three phases of a specification with 1,916 numbered requirements have been worked through. Many requirements are built only in part, and many are not built at all. What is built, what is partial and what is planned is tracked honestly in the requirement ledger. See [Implementation status](docs/NUMERO_IMPLEMENTATION_STATUS.md).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5177 and choose **Explore the demo universe** — five sample companies and a fund, with a year of fictional transactions, running on the accounting engine inside the browser. Nothing is saved.

To use your real books, create an account on the same screen. The first person to sign in with the designated owner email initialises the group and becomes Group Super Admin.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 5177 |
| `npm run build` | Type-check and production build into `dist/` |
| `npm test` | Accounting engine, operations, inventory, investments, control, the digital twin, Forward, NUMI, the command interpreter, capability switches and the sandbox |
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

Database rules are tested by the eleven scripts in `tests/sql/`. Each runs inside a transaction that **always rolls back**, so it can be run against the real database without leaving a single row behind. Results are returned in the error message; every line must start with `PASS`.

Files are stored in the private bucket `numero-documents`, created by migration 0006.

## What it does

| Area | Screens |
|---|---|
| **Command** | Command Centre · Cockpit · Money Map · Forward (what is agreed, committed, due and at risk) · Analysis (year on year, burn rate, unusual entries, compliance deadlines, what is for the owner) · Registers (subscriptions, insurance, rent, contracts, guarantees, legal matters, vehicles, incidents and more) |
| **Transact** | Transaction Centre · Journals · Sales & Billing · Purchase Bills · Payments & Receipts · Banking |
| **Operate** | Expenses & Advances · Purchasing (requisition to three-way comparison) · Inventory (items, lots and serial numbers, stock documents, landed cost, counts, exposure to loss, units sold and their service history) · Cash & Transfers · Treasury (loans, deposits, facilities, currency exposure) · Investments & Funds (holdings, commitments, capital calls, units, distributions, net asset value, who owns what) · Fixed Assets · Payroll · People Cost |
| **Books** | General Ledger · Chart of Accounts and account mapping · Reports · Budgets · Allocations and reclassification · Imports and the parallel run · Period Close |
| **People** | People & Parties · Communications (prepared here, sent by a person) |
| **Control** | Approvals (journals, proposed entries, advances, claims, requisitions, orders, capital calls, distributions) · Notifications · Follow-ups · Document Inbox · Sentinel · Reality (five realities set against each other, cases, physical verification, confirmations) · Audit Trail · Black Vault |
| **Simulate** | Digital Twin (what-if on a model built from the books, comparison, valuation by three methods, rules tried on history) · Scenario Studio (ways of working designed step by step and followed case by case) · Sandbox (a copy in the memory of the browser) |
| **Build** | Companies · Genesis Builder · Team & Access · System Health (health, backups, integrations register, capability switches, analytical store) · Calculators · Capabilities · Requirement Ledger · Settings |

An operation never writes to the ledger. Releasing an advance, paying a reimbursement, running depreciation or payroll, paying a loan instalment: each **proposes** an accounting entry, which a second person approves before it reaches the books. NUMERO records that money moved. It never moves money.

The same holds for stock and investments: a stock document, a purchase or sale of an investment, a receipt of capital, a distribution, a fee, a reclassification and an allocation each propose an entry. The stock ledger and the general ledger therefore say the same value. A simulation is never an actual: everything the Digital Twin produces is marked SIMULATION and changes nothing. NUMERO sends nothing outside itself: a message is prepared here and sent by a person.

## Using it

| | |
|---|---|
| **Search and commands** | `Ctrl K` or `/` |
| **Ask NUMI** | `Ctrl /` |
| **Voice** | `Alt V`, then e.g. “Numero, show the balance sheet” |
| **Go to** | `g` then `h` home · `j` journals · `l` ledger · `r` reports · `p` parties · `b` banking · `a` approvals · `s` sentinel · `e` entry · `c` cockpit · `k` inventory · `v` investments · `y` reality · `t` digital twin |
| **New journal** | `n` |
| **Theme** | sun / moon button, or say “dark mode” / “light mode” |
| **Privacy mode** | eye button, or say “hide the numbers” |
| **Command / Accounting mode** | switch in the top bar |
| **Time machine** | period picker → choose a date |

Voice can navigate, answer questions and prepare drafts. It can never approve, post, release, pay or move money, change the stock, declare a distribution, commit an import or send a message.

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
* What is at stake is exposure. It is not loss until a loss is posted.
* A difference between two records is a fact. What it means is for a person to establish.
* A simulation is never an actual.
* A screen never says "none" to a person who is simply not allowed to look.
* Nothing is dropped silently. If something is not built, the ledger says so.
