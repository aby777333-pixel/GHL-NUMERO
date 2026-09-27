# NUMERO IMPLEMENTATION STATUS

Release 0.2.0 — Phase 1 (foundation) and Phase 2 (operations). 27 September 2026.

This report follows the rule of the specification: *do not claim something is complete when it is not*. A placeholder does not count. A screen without an engine does not count.

## The honest number

| Status | Requirements | Share | After Phase 1 |
|---|---:|---:|---:|
| **TESTED** — built, and covered by an automated test | {TESTED} | {TESTED_PCT} | 74 |
| **IMPLEMENTED** — built and exercised end to end | {IMPLEMENTED} | {IMPLEMENTED_PCT} | 159 |
| **PARTIAL** — part works; the ledger note says what does not | {PARTIAL} | {PARTIAL_PCT} | 127 |
| **BLOCKED** — needs something only the owner can supply | {BLOCKED} | {BLOCKED_PCT} | 1 |
| **PLANNED** — not built | {PLANNED} | {PLANNED_PCT} | 1,555 |
| **Total indexed** | **1,916** | | |

Nothing has been dropped. Every requirement keeps its number, its text and its status in the requirement ledger (Build → Requirement Ledger in the application, or `docs/NUMERO_REQUIREMENTS.md`).

### Phase 2 by module

{PHASE2_TABLE}

Each of the 446 Phase 2 requirements was assessed on its own text against the code, by a reviewer instructed to choose the lower status when in doubt. A requirement that lists several capabilities is PARTIAL unless all of them exist. {UPDATED} Phase 1 records were corrected because Phase 2 built something their note said was missing. The reason each PLANNED Phase 2 requirement is not built is recorded in `docs/requirement-planned-notes.json`.

**Read the number with care.** Phase 2 built the engines the specification asks for in these modules. Many requirements in the same modules describe things that were deliberately not attempted — reading documents automatically, notifications, statutory calculation, scenario modelling, builders — and they remain PLANNED or PARTIAL.

## Implemented in Phase 2

**The rule behind everything: an operation never writes to the ledger**
- Every operational event *proposes* an accounting entry. The entry passes the same approval rules as any journal, cannot be edited by hand, is posted on its final approval, and updates its source record in the same transaction. Rejecting or reversing it reaches the source record too.
- Approval, release of money, expense, accounting and settlement are separate recorded events.
- Approvals now cover journals, proposed entries, advances, expense claims, requisitions and purchase orders, in one inbox.
- Account mapping: the ledger each engine uses is chosen by a person, per company. A missing mapping makes the operation refuse with an explanation.

**Expenses and advances**
- Advances: requested, approved (a lower amount may be approved), released, settled through claims, returned. An advance is never an expense.
- Advance memory: before another advance is approved the approver sees what is already on record for that person — as facts, without a conclusion.
- Expense claims with policy by category. Flags (outside policy, evidence missing, late, possible duplicate, weekend) inform the approver and never reject. Line-by-line approval; a flagged line needs the approver's comment.
- Settlement against an advance, reimbursement due, return due. Recovery of an advance through payroll.
- Unsettled advances by age, with follow-up.
- Petty cash boxes; cash counts by denomination that never change the books; fund transfers, including between group companies.

**Purchase to pay**
- Requisition → request for quotation → quotations → a person selects the vendor and records why → purchase order → goods or service receipt → vendor's bill → three-way comparison.
- A purchase order is a commitment. Open commitments are shown and included in Forward, labelled COMMITTED.
- The three-way comparison and the credit limit flag; they never block.

**Fixed assets**
- Register with categories, custodian, location, tag, warranty; straight-line and written-down-value depreciation with part months; monthly runs in order; disposal with gain or loss; impairment; assignment, transfer, maintenance and physical verification; twelve-month depreciation forecast; agreement of the register with the ledger.

**Treasury**
- Loans taken and given, with schedule by equal instalment, equal principal or bullet; interest recorded as actually charged; debt maturity ladder.
- Fixed deposits: placement, maturity value, lien, closure with interest as actually received and tax deducted.
- Cash position by company and ledger; liquidity ladder; guarantees, facilities and covenants (as registers); currency exposure from open documents.

**Payroll and people cost**
- Employees; salary structures with effective dates, entered by one person and approved by another; an approved salary is never overwritten.
- Payroll runs: pro-rata, adjustments, recoveries; every person left out is listed with the reason. The journal is confidential and charged by department — no individual salary reaches the general ledger.
- Salary data is restricted by default, including in the audit trail. Finance roles do not see it unless granted.
- People cost: by department and person (for those authorised), workforce outside payroll, cost against revenue, new-hire cost model.

**Forward, registers, documents, follow-ups**
- Forward rebuilt on recorded facts: invoices, bills, promises, commitments, registers, loans, deposits, payroll, claims, advances. Every amount carries its certainty; contingent amounts stand beside the projection, never inside it; sources a person may not read are named.
- Cash horizon from today to five years, money weather, calendar, early warnings with their assumptions, payment priority view.
- Registers: 50 kinds (subscriptions, insurance, rent, leases, contracts, guarantees, legal matters, vehicles, incidents, disputes, trips, events and more), each with its own fields. Kinds are data: a Group Super Admin can add one without code.
- Document vault: private storage, fingerprint, possible-duplicate detection, classification by a person, links to any record. Attachments on journals, invoices, bills, claims, advances, purchasing documents, assets, loans, parties and register items.
- Follow-ups linked to any record; closing one requires its outcome.
- Promises to pay on receivables.
- Custom fields are now rendered and saved on register items, fixed assets, invoices, bills and parties. A field that belongs to one sub-type (a register kind, a document type, a party type) is asked only of records of that sub-type.

**NUMI and voice**
- Twelve new kinds of question on operations, each agreeing with the engines to the rupee.
- NUMI checks permission before it reads, reports a refusal as a refusal, names what it could not see, and never states what an individual is paid.
- 22 new spoken or typed navigation phrases; releasing, settling, reimbursing, running payroll, disposing, repaying, breaking a deposit, placing an order and selecting a vendor are never executed from a command.

## Defects found by the review, and corrected

Assessing each requirement against the code found defects as well as statuses. They were corrected the same day, each with a test, rather than recorded and left.

| Found | Corrected |
|---|---|
| A staff loan recovered through payroll raised the amount repaid but left the instalment due; recording the instalment later counted its principal twice | The recovery is applied to the instalment schedule; an instalment takes only what is not yet recovered; reversing the payroll takes the recovery back |
| Every advance, including an advance to a vendor, was posted to the employee advances ledger | The ledger follows the recipient |
| A claim or advance linked to a trip, event or vehicle did not carry that link into the books, so the item's page could not show its cost | The entry carries the item's dimension; the item's page lists its claims and advances |
| The "maximum single payment" of a cash box was stored and never checked | A payment above it is raised for review, and still recorded |
| In an approval of several steps only the last approver's amount was kept | The amount authorised at each step is kept; a later step may lower it, not raise it |
| A follow-up on a confidential record, or on payroll, could be read by anyone in the company | A follow-up is read under the same rule as its record |
| Forward counted a scheduled rent and the landlord's bill for the same month as two payments | A scheduled occurrence already billed is left out, and the screen lists what was left out |
| Guarantees given were missing from Forward's contingent figure | They are shown as contingent, beside the projection |
| Forward said all amounts were in the base currency; register items, loans, claims and advances are not converted | The screen counts such items and names their currencies |
| The vendor side of "dependence on one party", present in Phase 1, was lost when Forward was rebuilt | Restored |
| People cost by department used each person's present department for earlier months | It uses the department recorded on the payroll line |
| People cost read only the first 1,000 ledger entries of the period | It reads up to 20,000, page by page |
| A custom field defined in Genesis never appeared on a record: the record types offered did not match the screens | They match; fields appear on invoices, bills, register items, fixed assets and parties |
| The register item "State" accepted free text that the live database would refuse | A list of the accepted values |
| Loan kinds on screen differed from the database | They agree |
| Approval rules could not be edited from any screen | An editor on the Approvals screen |
| A salary component could not name its ledger; the asset form could not name the bill it was bought on; an opening balance journal could not be entered | All three can |
| A dropped file bypassed the list of accepted file types; a file whose registration was refused stayed in storage | Checked on drop; removed on refusal |
| NUMI answered a question about fuel with the whole of travel, and did not recognise the wording of several example questions in the specification | Corrected, with a test for each |
| An employee, who may enter claims but not view everyone's, could not open the Expenses screen | Screens follow the database's own read rules |

The corrections were then reviewed in their turn. That second review found eight more, corrected in migration 0013 and in the application:

| Found | Corrected |
|---|---|
| A required custom field that belongs to one kind of record (vehicles, say) blocked saving on every other kind, where the screen does not even show it | A field is asked only of the sub-type it belongs to |
| A follow-up kept the confidentiality its record had on the day the follow-up was written; raising the level of the record later left the follow-up readable | A follow-up follows its record |
| A claim or an advance linked to a confidential trip or meeting was readable by everyone who may read expenses, and its entry carried the tag of the confidential item | It takes the level of the item when that is the higher |
| The page of a trip, event or vehicle counted an advance not yet settled inside its total, as if it were cost | Cost recorded is shown apart from advances still held |
| Forward let a debit note or a credit note stand for the bill of the period, and a purchase bill stand for income | Only a purchase bill covers a payment, and only a sales invoice covers a receipt |
| NUMI read "profit" as a question about IT and "loads" as one about ads | Patterns match whole words |
| NUMI answered "Which department overspent?" with total spending | It is answered from the budget: the lines over budget, by ledger and company. Budgets are not kept by department, and the answer does not pretend otherwise |
| Only trips, paths and events could be named on a claim or an advance | Any register item that tracks its own cost can be named: vehicles, properties, incidents, work orders and contracts too |

## Phase 1 gaps closed in Phase 2

- Reversing the journal of an invoice or a payment now keeps the document truthful (the invoice is cancelled or reopened).
- A ledger with no control type can no longer be used as a bank ledger in a payment.
- Account mapping can be edited.
- Documents can be attached.
- The approval inbox handles more than journals.
- Nobody can approve an entry they are not cleared to read.

## Verification performed

| What | How | Result |
|---|---|---|
| Database rules, Phase 1 | `engine_invariants.sql` (T01–T24, 44 checks), `document_posting.sql` (T25–T28) — **re-run after the last migration (0013)**, rolled back | 48 of 48 pass |
| Database rules, Phase 2 | `phase2_flow.sql` (T29–T81), `phase2_treasury_purchasing.sql` (T82–T109), `phase2_payroll.sql` (T110–T129), `phase2_corrections.sql` (T130–T149), `phase2_corrections_2.sql` (T150–T155) — **all re-run after the last migration (0013)**, rolled back | 127 of 127 pass |
| Database left clean | row counts after the last test | 0 groups, 0 companies, 0 journals, 0 audit rows, 0 users, 0 alerts, 0 follow-ups, 0 documents; owner email setting intact |
| Row Level Security | catalogue query | 77 tables, all with RLS enabled; 103 policies |
| Supabase security advisor | advisor run after the final migration | no warnings; 5 informational notes for internal tables that intentionally have no client policy |
| Application engines | `npm test` | 262 of 262 pass |
| Type safety | `tsc` strict | no errors |
| Production build | `npm run build` | succeeds; neither the specification nor the requirement ledger is in the output; the demo engine is a separate file loaded only on entering the demo |
| Every new screen | 21 list screens and 37 detail and entry screens loaded in the browser, demo mode | no load error |
| Advance to settlement | driven through the screens: request → approved for ₹75,000 of ₹90,000 → release proposed → entry approved and posted → claim of ₹31,300 with two flagged lines → one line reduced by the approver → entry approved → advance partly settled by ₹23,300 | works |
| Purchase to pay | order of 40 units → approved → receipt of 25 → order partly received → three-way comparison "not billed" | works |
| Payroll | run calculated for 9 people, 1 listed as not included → entry proposed → two approval steps → posted | works |
| Depreciation, loan instalment, deposit closure, cash count, fund transfer, asset disposal preview | each driven through its screen | work |
| Registers, documents, follow-ups, account mapping, approval rules | item recorded with kind-specific fields; three files uploaded, identical content flagged and kept; follow-up closed with outcome; mapping changed; a two-step rule for advances added | work |
| NUMI | advances, cash in 30 days, salary of a named person | first two answered from the records; the third declined |
| Light theme, phone width | Payroll, Forward, Fixed Assets in light theme; Expenses at 375 px | render correctly, no horizontal overflow |

## Not verified — please check these yourself

| Item | Why it could not be verified here |
|---|---|
| **Signing in to the live system through the interface** | Creating an account or typing a password into a cloud service is something only you should do. The database behind it is tested; the sign-in screens have not been exercised with a real account. |
| **The Phase 2 screens against the live database** | They were exercised in demo mode. The live data layer (`src/api/supabase.ts`) is type-checked and calls database functions that are tested, but no screen has been driven against the live database, because no account exists yet. Expect small mismatches to surface on first use; report them. |
| **Uploading a file to live storage** | Same reason. The bucket, its policies and the registration function exist and are tested at the database level. |
| **Permission refusals in the screens** | In the demo every user holds every permission. Refusals are tested against the database (for example T59–T61, T117–T119); the screens that depend on them are type-checked only. |
| **Microphone capture** | The build environment has no microphone. |
| **Email confirmation** | Depends on the Site URL configured in your Supabase project. |
| **Behaviour on a phone** | One screen was checked at phone width. Wide tables scroll sideways inside their panel. |

## Set-up steps only the owner can take

1. **Supabase → Authentication → URL Configuration**: set *Site URL* to where the application runs (for local use `http://localhost:5177`) and add the same address to *Redirect URLs*.
2. **Create your account** on the welcome screen with the owner email, confirm it, sign in, and initialise the group. That account becomes Group Super Admin.
3. **Supabase → Authentication**: enable multi-factor authentication and leaked-password protection.
4. **Chart of Accounts → Account mapping**, for each company: confirm the ledger for each role before the first advance, payroll run or disposal. Companies created from a template arrive with the roles mapped.
5. **Team & Access**: decide who holds the payroll roles, and who is cleared for confidential entries. Until someone other than you is cleared, payroll entries can be approved only by a Group Super Admin.
6. **Load the requirement ledger** into the database from Build → Requirement Ledger (live mode, Group Super Admin).

## Known limitations

- **Nothing is read automatically.** Documents are stored, fingerprinted, classified and linked by a person. There is no OCR and no email intake.
- **Nothing leaves the application.** No email, SMS or push notification. Warnings and follow-ups are seen on screen.
- **Nothing runs on a schedule.** A person starts each depreciation run, payroll run and Sentinel run. There are no recurring invoices.
- **Statutory amounts are not calculated.** Provident fund, tax deducted and similar amounts are whatever the company records. Professional review remains necessary.
- **Currencies.** Register items, advances and claims carry a currency but no exchange rate; a figure in another currency is counted at face value and the screen says so. Totals across companies with different base currencies are added as recorded, with a notice.
- **Budgets.** Hard limits are not enforced. Budget context on a purchase order is information and covers the ledger across all departments.
- **Bill lines are matched to order lines by position** when a bill is linked to an order. There is no screen to map them by hand, although the engine accepts a mapping.
- **Forward.** A scheduled occurrence is treated as billed when a document from the same party falls in the same period; that is an inference. Payroll is projected at net pay. An amount marked possible or probable is counted in full. A scheduled item whose date has passed stays overdue until a person acts. The budget-exhaustion calculation exists in the engine and is shown on no screen.
- **Cash box limit** is checked for payments proposed by operations, not for manual journals or for payments and receipts entered under Payments.
- **A salary deduction or employer contribution** is credited to the ledger mapped for it; it cannot have a ledger of its own.
- **Trips, events, vehicles, properties and incidents** are linked to a claim or an advance as a whole, not to a single line. A vendor's bill cannot name one: a bill line carries a department and a project only.
- **Payslips, attendance, leave** are not built.
- **Guarantees, facilities, letters of credit, covenants and incidents are registers.** They are recorded, dated, followed up and shown in Forward; they have no posting engine of their own.
- **Payroll approval needs clearance.** The payroll journal is confidential; the payroll officer who proposes it cannot open it afterwards unless cleared. This is intended.
- **In the demo, only one company has its assets registered.** The reconciliation screen therefore shows a difference between register and ledger for the others. That is the screen doing its work.
- Amounts cross the API as JSON numbers: exact to four decimals up to about ₹100 billion per figure.
- Consolidation: no ownership percentages, non-controlling interests or currency translation.
- Lists load up to 500 or 1,000 rows at a time; each screen states the total.
- The interface text is English only.
- NUMI is rule-based. It answers a fixed set of question kinds and says so when it cannot answer.
- Sarvam speech is **blocked** until an API key is provided and stored as a server-side secret.

## Deferred to later phases

Still Phase 2 in the ledger, not built in this release — see `docs/requirement-planned-notes.json` for each: document reading and email intake; notifications and reminders; recurring documents and scheduled runs; statutory engines; corporate cards, mileage and per-diem engines; project accounting; incident workflows with postings (write-offs, recoveries, insurance claims); Genesis form, workflow, rule, report and role builders; scenario modelling in Forward.

Phase 3 — inventory and landed cost, investment and fund accounting, digital twin and scenarios, reality engine, integrations, mobile application, language-model reasoning for NUMI.

Each deferred requirement remains in the ledger with its phase.
