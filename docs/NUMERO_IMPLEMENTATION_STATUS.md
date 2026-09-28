# NUMERO IMPLEMENTATION STATUS

Release 0.3.0 — Phase 1 (foundation), Phase 2 (operations) and Phase 3 (stock, investments, reality, simulation, platform). 28 September 2026.

Phase 3 is the last phase in the requirement ledger. That does not make NUMERO complete: read the number below.

This report follows the rule of the specification: *do not claim something is complete when it is not*. A placeholder does not count. A screen without an engine does not count.

## The honest number

| Status | Requirements | Share | After Phase 2 | After Phase 1 |
|---|---:|---:|---:|---:|
| **TESTED** — built, and covered by an automated test | 143 | 7.5% | 111 | 74 |
| **IMPLEMENTED** — built and exercised end to end | 199 | 10.4% | 182 | 159 |
| **PARTIAL** — part works; the ledger note says what does not | 594 | 31.0% | 417 | 127 |
| **BLOCKED** — needs something only the owner can supply | 1 | 0.1% | 1 | 1 |
| **PLANNED** — not built | 979 | 51.1% | 1,205 | 1,555 |
| **Total indexed** | **1,916** | | | |

**All three phases have been worked through, and 979 of the 1,916 requirements are still not built; of those that are, 594 are built in part.** The phases of the ledger say in which release a requirement was taken up, not that it was finished there. What is missing is named requirement by requirement in the ledger, and by theme under "Known limitations" and "Not built" below.

### By phase

| Phase | Requirements | Tested | Implemented | Partial | Planned or blocked |
|---|---:|---:|---:|---:|---:|
| 1 | 1372 | 79 | 158 | 242 | 893 |
| 2 | 446 | 36 | 23 | 304 | 83 |
| 3 | 98 | 28 | 18 | 48 | 4 |
| **All** | **1916** | **143** | **199** | **594** | **980** |

Nothing has been dropped. Every requirement keeps its number, its text and its status in the requirement ledger (Build → Requirement Ledger in the application, or `docs/NUMERO_REQUIREMENTS.md`).

### Phase 3 by module

| Module | Requirements | Tested | Implemented | Partial | Planned or blocked |
|---|---:|---:|---:|---:|---:|
| Digital Twin | 28 | 8 | 7 | 13 | 0 |
| Reality | 22 | 4 | 5 | 12 | 1 |
| General | 16 | 7 | 2 | 5 | 2 |
| Inventory | 15 | 6 | 3 | 5 | 1 |
| System Health | 9 | 1 | 0 | 8 | 0 |
| Investments | 4 | 2 | 1 | 1 | 0 |
| Integrations | 4 | 0 | 0 | 4 | 0 |
| **All of Phase 3** | **98** | **28** | **18** | **48** | **4** |

Each of the 98 Phase 3 requirements was assessed on its own text against the code by one of three reviewers, each instructed to choose the lower status when in doubt, and the records were read again after the corrections listed below. In addition, 545 requirements of Phases 1 and 2 that mention something Phase 3 built were read again; 210 of their records changed (`docs/requirement-updated-in-phase3.json`), and the others stand as they were. Five of those records were lowered, not raised, because they had been recorded as implemented although parts of what they ask were never built: 53 (financial health indicators), 504 (the owner's control tower), 1579 (fraud is not an expense category — nothing refuses a ledger so named), 1640 and 1641 (investment and business calculators — IRR, XIRR, NPV, payback, yield, working capital, unit economics and pricing are missing). All five are now PARTIAL, with what is missing named.

### Phase 2 by module

| Module | Requirements | Tested | Implemented | Partial | Planned or blocked |
|---|---:|---:|---:|---:|---:|
| Expenses | 121 | 6 | 6 | 87 | 22 |
| Forward | 103 | 20 | 10 | 62 | 11 |
| Genesis Builder | 70 | 0 | 2 | 39 | 29 |
| Treasury | 38 | 4 | 2 | 30 | 2 |
| Incidents & Exceptions | 33 | 1 | 0 | 30 | 2 |
| Payroll | 22 | 4 | 0 | 17 | 1 |
| People Cost | 17 | 1 | 1 | 11 | 4 |
| Assets | 15 | 0 | 1 | 11 | 3 |
| Documents | 14 | 0 | 0 | 8 | 6 |
| Projects | 13 | 0 | 1 | 9 | 3 |
| **All of Phase 2** | **446** | **36** | **23** | **304** | **83** |

Each of the 446 Phase 2 requirements was assessed on its own text against the code, by a reviewer instructed to choose the lower status when in doubt. A requirement that lists several capabilities is PARTIAL unless all of them exist. 61 Phase 1 records were corrected because Phase 2 built something their note said was missing. The reason each PLANNED Phase 2 requirement is not built is recorded in `docs/requirement-planned-notes.json`.

**Read the number with care.** Phase 2 built the engines the specification asks for in these modules. Many requirements in the same modules describe things that were deliberately not attempted — reading documents automatically, notifications, statutory calculation, scenario modelling, builders — and they remain PLANNED or PARTIAL.

## Implemented in Phase 3

**The rule of Phase 2 holds throughout: an operation never writes to the ledger.** A stock document, a purchase or sale of an investment, money received on a capital call, a distribution and its payment, a management fee, a reclassification and an allocation each *propose* an entry, which passes approval like any other. Eight new sources of proposed entries were added; capital calls and distributions are approved in the same inbox.

**Inventory**
- Items, categories, locations of six kinds, lots with manufacture and expiry dates, serial-numbered units.
- Stock documents: receipt, issue, transfer, return in, return out, adjustment, landed cost. Weighted average or first in, first out, by category. Stock awaiting approval on one document cannot be used on another.
- Stock counts: the location is frozen or a snapshot is taken; counted by one person, reviewed by another; a difference reaches the books only through an approved adjustment that states its reason.
- Landed cost shared by value, quantity or weight; the share of goods that have left is a cost at once.
- Exposure to loss — expired, near expiry, damaged, obsolete, in quarantine, missing, slow-moving — marked EXPOSURE, beside the loss actually posted, never inside it.
- The page of a unit: supplier, import details, costs, sale, warranty, service contract, service history.
- The stock ledger is set against the general ledger on the Inventory screen, in Reality and in System Health.

**Investments and funds**
- Corporate structure: who owns what, with ownership and voting percentages and the percentage held through every level; shareholders by class.
- Holdings: purchase, sale with the gain or loss shown before it is proposed, income with tax deducted, valuation by a stated method, recorded by one person and approved by another. A holding carried at cost keeps its valuation beside the books.
- Funds: investors and commitments, capital calls (a call makes an amount owed and posts nothing), units issued when the money is posted, net asset value from the books of the fund, management fee by formula, distributions by units held on the record date, investor statements, the three multiples with their formulas.
- Funds and holdings are confidential by default.

**NUMERO Reality**
- Five realities — document, operation, accounting, cash, physical — set against each other along eight fixed chains. Five separate counts, never one score. What was never checked is listed as never checked.
- A difference is a fact with its readings side by side; what it means is decided by a person in a case, whose history can only be added to. Nothing is called fraud.
- Physical verification of assets, stock, cash and documents; confirmations from outside (bank, customer, vendor, loan, deposit, investment, between companies of the group).
- Materiality threshold by company, with its basis.
- Reports show the reconciliation status of the records they rest on.
- Reclassification that leaves the original entry as it was; allocation of a shared cost by a stated driver.

**Digital Twin and simulations**
- A model built from the books: monthly rates averaged over complete months, cash, receivables, payables, debt with its schedule, open orders for assets, headcount.
- Sixteen kinds of assumption, combined freely; five adverse cases; softer and harder cases; comparison of up to four scenarios; valuation by three methods, always a range.
- Drivers proposed by one person and approved by another before a simulation may use them.
- Everything is marked SIMULATION. A saved result cannot be relabelled. Nothing is posted.
- Rules tried on history: an approval rule against past requests, a Sentinel threshold against past alerts.

**Scenario Studio**
- Ways of working designed step by step — request, evidence, approval, release, settlement, accounting and others — with a form, required documents per step and the role each step is for; versions; cloning.
- Cases follow a workflow step by step. A step that releases or settles money is complete only when it points to the record that does. A workflow posts nothing and releases nothing.

**Sandbox**
- A copy of the configuration and the figures in the memory of the browser, on which every screen works. Entries, rules, mappings, imports and workflows can be tried; nothing reaches the books or the database.

**Platform**
- Notices in the application, by class of attention; rules of attention by kind and amount; preferences by kind, with governance notices that cannot be switched off.
- Communications prepared from versioned templates; a person sends them by their own means and records that they did.
- Register of integrations (intent, risk, test in a sandbox); capability switches by group, company and role; recorded backups and restore tests; system health in sections, without a score.
- Imports of journals and opening balances from a file, with validation of every row, as drafts; the trial balance of the earlier system kept beside the books (parallel run).
- Analysis: year on year, burn and runway, entries unusual for their ledger, deadlines across companies, what needs the owner.
- Travel bookings on a claim line (air, train, bus, cab, hotel) with their parts.

**NUMI and voice**
- Fourteen new kinds of question (what-if, stock, exposure, reorder, funds, investments, reality, cases, confirmations, burn, year on year, system health, notices), each from the engines, each saying what it could not read.
- 45 new destinations for spoken or typed navigation. Changing stock, declaring or paying a distribution, calling capital, committing an import, reclassifying, sending a message and switching a capability are never executed from a command.

## Defects found by the assessment of Phase 3, and corrected

Assessing each requirement against the code found defects as well as statuses. They were corrected the same day. The full list, with the place and the test of each, is `scripts/_assess/P3_CORRECTIONS.md`.

| Found | Corrected |
|---|---|
| The live data layer cut lists at fixed numbers, and the API hands over at most a page of rows to one request; a screen said no list is shortened in silence | Every list is read to its end page by page, or refused above its ceiling; the size of a page is measured in every session; lists shown in part say how many |
| Stock moved to another place of the company looked newly received, so slow-moving stock was hidden by moving it | The age of stock is that of its receipt by the company |
| A stock document could be dated in the future | Refused |
| The page of a unit looked for its movements among the newest of its item | Movements are asked for by lot |
| A fund counted commitments that had ended on one side of a subtraction only | A commitment that has ended counts for what was called of it |
| System health skipped a stock ledger that held no item | It compares every stock ledger |
| Three screens allowed what the database refuses, or refused what it allows (communications, a link of the corporate structure, starting a workflow case) | Screens follow the rules of the database |
| A person could not state their own request in a workflow | The person who started a case completes its own request and evidence steps |
| Paying suppliers later was treated as harmful in the standard cases | It helps cash |
| A driver was used whatever its unit | Only in its own unit; otherwise the value typed is used and the model says why |
| The trial of an approval rule added amounts of different currencies | Shown currency by currency |
| The sandbox listed the entries of its own build as the work of the person, and gave the twin no history | The build is set apart; a year of monthly movement is brought in |
| A scenario built on some companies was kept as "the group" without a word | The dialog says so and names the companies |
| Physical reality counted orders as differing but not as checked | Counted on both sides |
| The key of a difference changed when another reality began to differ, so its case was lost from sight | The key is that of the record |
| A sale in a foreign currency was stated as it stands | Stated in the currency of the company |
| Verifications of stock, cash and documents never reached Reality | The last sheet of each place is a check |
| A verification opened by mistake could not be cancelled | It can, with a reason |
| The class of an alert was worked out in two ways | One way: the amount, or else the difference, by its size |
| A Group Super Admin was sent a notice of every approval that waits | Only of what the rules class for the owner, or when nobody else could approve |
| Cases of two kinds were offered to people the database would refuse | The form offers the kinds a person may open |
| The list of capabilities marked Inventory and Reality as working | Partial, with their limits |
| Reports showed no reconciliation status (recorded as not built) | Built, for the period of the report |
| NUMI took a figure for a subject of another clause, read "sooner" as "later", and read a rate of exchange as interest | Read clause by clause, in its own direction; what cannot be read is named |
| A capability switched off still opened by address, command or voice; the switches of NUMI and voice did nothing | Every screen honours its switch however it is reached; System Health, where switches are set, always opens for a Group Super Admin |
| A verification sheet with items left unchecked counted as agreeing; what a sheet found was measured by the value of the items, not the size of the difference | Neither any more |
| Where no materiality threshold was set, screens said "above the threshold" | They say that no threshold is set and that every difference counts |

The records were then read a second time against the corrected code, which found a further round of small defects, corrected the same way; `scripts/_assess/P3_CORRECTIONS.md` lists them (R1–R25).

**A fault made while correcting.** The correction of the notices was written from the text of a migration file that a later correction had superseded. For the time between two migration pieces, no notice was written at all, silently. The database suite found it at once and the next piece corrected it. The database held no company and no user at the time.

## Migration changes in release 0.3.0

Every change to the database is a new migration; nothing earlier was dropped or rewritten, and no record was changed.

| File | What it adds |
|---|---|
| `0014_inventory.sql` | permissions and roles of Phase 3; categories, locations, items, lots, stock documents, the stock ledger, counts, conditions noted on stock |
| `0015_investments_funds.sql` | corporate structure, shareholders, holdings, valuations, funds, commitments, capital calls, units, net asset value, fees, distributions; later corrections of the fee |
| `0016_reality_control.sql` | materiality, cases, verification, confirmations, reclassification, allocation |
| `0017_scenarios_flows.sql` | saved simulations and drivers; workflows, cases and steps; later corrections of drivers and of who completes a step |
| `0018_platform.sql` | notices and rules of attention, templates and communications, integrations, capability switches, backups, system health, imports, the analytical store, travel detail |
| `0019_corrections_after_assessment.sql` | the corrections found by the assessment: age of stock, dates of stock documents, system health, notices to the owner, class of alerts, cancelling a verification, lines matched in part, the measure of a page of the API |

## Security changes in release 0.3.0

- Every new table is under row level security (128 tables, 154 policies); every internal function is closed to signed-in users and all functions to anonymous callers, tested per module.
- Funds and holdings are confidential by default; their entries carry their level, so they are approved only by people cleared for it.
- Screens now ask for the permission the database asks for: communications, the corporate structure, workflow cases, cases of incidents.
- The live data layer reads every list to its end or refuses it; a list is never cut short in silence.
- The register of integrations refuses anything that looks like a secret; an integration that can move money is high risk and needs a recorded test in a sandbox.
- A capability switched off is off wherever its screen is reached from.
- No secret is in the application or its build; only the publishable key is used in the browser.

## Accounting changes in release 0.3.0

- New ledger roles, mapped per company: goods received not invoiced, landed cost clearing, stock loss and gain, gain or loss on investments, unrealised gain or loss, investment income, distributions payable, management fee expense and payable.
- Eight new sources of proposed entries: stock documents, investment transactions, money received on capital calls, distributions and their payment, management fees, reclassification, allocation. Each passes approval like any journal.
- Stock is valued at weighted average or first in, first out by category; landed cost joins the stock still on hand.
- A holding carried at cost keeps its valuation beside the books; a holding at fair value posts the change on approval.
- A capital call posts nothing; units are issued when the money is posted. Net asset value is computed from the books of the fund.
- A reclassification never changes the original entry; an allocation leaves the total of the ledger unchanged.

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

## Verification performed for release 0.3.0

| What | How | Result |
|---|---|---|
| Database rules, all phases | eleven scripts in `tests/sql/`, each in one transaction that is rolled back — **all run after the last migration piece (p3_27)** | 289 of 289 checks pass |
| Database left clean | row counts after the last test | 0 groups, 0 companies, 0 journals, 0 users, 0 alerts, 0 follow-ups, 0 documents, 0 notices, 0 stock movements; 1 audit row, written when migration p3_15 added a register kind; owner email setting intact |
| Row Level Security | catalogue query | 128 tables, all with RLS enabled; 154 policies |
| Supabase security advisor | advisor run after the last migration piece | no warnings; 5 informational notes for internal tables that intentionally have no client policy |
| Application engines | `npm test` | 461 of 461 pass, in 8 files |
| Type safety | `tsc` strict | no errors |
| Production build | `npm run build` | succeeds; neither the specification nor the requirement ledger is in the output; no secret key; the sample-data engine and the sandbox are separate files, loaded only when used |
| Every Phase 3 screen | the 24 screens of Phase 3, lists and the detail and entry screens behind them, loaded in the browser on the sample data | no load error, no error in the console |
| Stock receipt, end to end | driven through the screens: receipt prepared → entry proposed → approved in the inbox → quantity in stock 305 → 345; the stock ledger still equals the books | works |
| Sandbox | entered, an entry prepared and approved as a second person, left; the books were as before | works |
| Cancelling a verification | driven through the screen: reason required, sheet cancelled, actions withdrawn | works |
| A capability switch | Payroll switched off for the group under System Health › Capabilities, with its reason; then Payroll opened by its address and a payroll run by its address | the menu entry is gone, both addresses show "switched off", System Health still opens |
| Reconciliation status on reports | balance sheet, profit and loss, cash book, ageing | shown, with the differences of the sample data; absent on a report that rests on no record |
| Phone width (375 px) | 24 screens measured in a desktop browser | no screen wider than the display; wide tables scroll inside their panel |
| Light theme | Inventory, Reality, Digital Twin: colours of the background and of 366 pieces of text measured | light background, dark text, nothing pale on pale |

## Verification performed for release 0.2.0

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
| **Every screen against the live database** | The screens of all three phases were exercised on the sample data. The live data layer (`src/api/supabase*.ts`) is type-checked and calls database functions that are tested, and its paged readers are tested, but no screen has been driven against the live database, because no account exists yet. Expect small mismatches to surface on first use; report them. |
| **Reading long lists from the live database** | The readers are tested against a query that answers as the API does. That each list of the live data layer reads the right table in the right order is type-checked only. |
| **Uploading a file to live storage** | Same reason. The bucket, its policies and the registration function exist and are tested at the database level. |
| **Permission refusals in the screens** | In the demo every user holds every permission. Refusals are tested against the database (for example T59–T61, T117–T119); the screens that depend on them are type-checked only. |
| **Microphone capture** | The build environment has no microphone. |
| **Email confirmation** | Depends on the Site URL configured in your Supabase project. |
| **Behaviour on a phone** | Widths were measured in a desktop browser set to 375 px. No screen was used on a telephone. |
| **Load** | No load test was run. No figure exists for large volumes, and none is claimed. |

## Set-up steps only the owner can take

One list for all three phases, in the order in which they are taken. Nothing in it can be done for you: each step needs your account, your decision, or a key that is yours.

**To enter the live system**

1. **Supabase → Authentication → URL Configuration.** Set *Site URL* to the address where the application runs (for use on this computer, `http://localhost:5177`) and add the same address to *Redirect URLs*. Without it the confirmation e-mail leads nowhere.
2. **Create your account** on the welcome screen of the application, with the owner e-mail recorded in the database, confirm it from the e-mail, sign in, and initialise the group. That account becomes Group Super Admin. Only one group can be initialised.
3. **Supabase → Authentication.** Enable multi-factor authentication and leaked-password protection, and set the password rules you want.
4. **Supabase → Settings → API.** Leave *Max rows* as it is. The application measures it in every session and reads lists in pages of that size, so any value works; a very small one makes every list slow.

**To set up the books**

5. **Create the companies** (Companies → New company), from a template or as a copy of the configuration of a company that exists.
6. **Chart of Accounts → Account mapping**, for each company: confirm the ledger for each role before the first document of its kind. Companies created from a template arrive mapped. The roles added in Phase 3 are: goods received not invoiced, landed cost clearing, stock loss, stock gain, gain or loss on investments, unrealised gain or loss, investment income, distributions payable, management fee expense, management fees payable. A missing role makes the operation refuse with an explanation; it never guesses.
7. **Inventory → Categories**: for each category, the stock ledger and the ledger of the cost of goods sold. These are chosen by category, not in the account mapping.
8. **Opening position.** Bring in the opening balances from a file (Imports), which arrive as one draft entry and pass approval; bring in the trial balance of the earlier system beside the books if you want a parallel run. Opening stock is taken on with a stock receipt whose other ledger is the one that carries the opening value, so that the stock ledger and the books agree from the first day.
9. **Team & Access.** Invite each person and give each a role in each company. Decide in particular: who holds the payroll roles; who is cleared for confidential entries (Black Vault) — funds, holdings and payroll are confidential, and until someone other than you is cleared, their entries can be approved only by a Group Super Admin; who holds the three roles added in Phase 3 (Store Keeper, Investment Manager, IT Administrator); who reviews alerts (`sentinel.review`), since only they open incidents.
10. **Approvals → Rules.** Decide who approves what, above which amount, in how many steps. Until you do, one approval by a second person is asked for.
11. **Thresholds, which are your judgement and nobody else's:** materiality for each company (Reality), the thresholds of Sentinel (Genesis Builder), and the rules of attention (Notifications → Rules) — which kind of notice, above which amount, is classed for the owner. Without a rule of attention you are told of no routine approval.
12. **Load the requirement ledger** into the database from Build → Requirement Ledger (live mode, Group Super Admin).

**To keep the system safe**

13. **Backups.** Backups are made by Supabase, according to the plan of your project; NUMERO makes none and sees none. Check in the Supabase dashboard that backups exist for your plan, restore one into a test project once, and record both under System Health → Backups. Until a restore has been tested, NUMERO reports recovery as unproven.
14. **Keep the repository private.** It holds the specification. If it is ever to be made public, the specification must first be removed from its history.
15. **Where the application is hosted**, give it only the address of the project and the publishable key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). The service-role key never belongs in the application or in its hosting.

**Only if you want them**

16. **Speech in Indian languages (Sarvam).** Needs your API key, kept as a secret on a server behind a function that is not written yet. Until then speech uses what the browser offers. This is the one requirement recorded as BLOCKED.
17. **Sending e-mail, SMS or WhatsApp; bank feeds; tax portals; reading documents; a language model for NUMI.** None is connected. Each needs an account with a provider, and keys, that only you can obtain, and then the work of connecting it. An integration that can move money is tried in the sandbox of its provider first, and the register of integrations requires the record of that trial.

## Known limitations

### Phase 3

- **Nothing leaves the application, and nothing is connected.** Notices are seen on screen. Communications are prepared; a person sends them. The register of integrations records intent.
- **Nothing runs on a schedule.** A person starts every count, verification, refresh of the monthly totals and health report. What falls due is found when a person opens the application.
- **Manufacturing is not built**: no bill of material, no work in progress.
- **Inventory.** Value is kept on the item, not by location. No bar codes, price lists or unit conversions. Landed cost in a foreign currency, and tying a charge to the bill of its vendor, are not built. The windows for near expiry (60 days) and slow-moving stock (180 days, or as set on the item) cannot be changed on a screen. The database accepts a stock document dated one day ahead of its own date, because its day is that of UTC.
- **Funds.** Net asset value is an accounting figure from the books of the fund. Carried interest, waterfalls, redemption and transfer of units, and reporting to a regulator are not built. Tax on a distribution is one rate for all holders.
- **Reality** compares records NUMERO holds, along eight fixed chains, as they stand today. Workflows, fields and kinds of register of your own are not read. Cards, wallets, payment gateways and contracts have no readings. The percentage of materiality is recorded and not used; the amount is. Differences are listed by amount, each in the currency of its company.
- **The reconciliation status on a report** is that of today, not of the date of the report, and is not printed.
- **The Digital Twin is arithmetic on monthly rates read from the books**, not a forecast learned from data. Budgets, contracts, registers and subscriptions are not in the model. A group twin adds its companies; it does not consolidate them. A scenario belongs to one company or to the group; one built on some companies is kept for the group, and says so.
- **The Scenario Studio** follows a straight line of steps. No branching, no conditions, no steps in parallel. A case is started by a person; other triggers are recorded as intent and start nothing. What a workflow says about accounting, notices or reports is text: it configures nothing.
- **The sandbox** runs on the engine NUMERO carries in the browser, not on the database. It brings in balances and monthly movement, not the transactions themselves, and no salary, confidential record or document. In it every person holds every permission.
- **Imports** read CSV, not Excel; at most 5,000 rows a file; journals and opening balances only.
- **Analysis.** Unusual entries are measured by ledger, above the usual only, over at most the latest 5,000 lines of the period. Burn is net burn. Deadlines are those people recorded; NUMERO holds no calendar of statutory dates.
- **Departments** cannot be cloned or configured by a Department Admin: permissions are held by company.
- **Fields of your own** defined for journals, payments, units and companies are kept and shown on no screen.

### Phases 1 and 2

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
- Lists of the live books are read to their end, up to 20,000 records (200,000 for ledger totals), and refused above that. Lists of the latest records are read up to a stated number.
- The interface text is English only.
- NUMI is rule-based. It answers a fixed set of question kinds and says so when it cannot answer.
- Sarvam speech is **blocked** until an API key is provided and stored as a server-side secret.

## Not built

No later phase exists in the ledger. What is not built stays in it, each requirement with its number, its text and, where one was recorded, the reason: `docs/NUMERO_REQUIREMENTS.md`, `docs/requirement-planned-notes.json`, and Build → Requirement Ledger in the application. By theme, the largest parts are:

- reading documents automatically and taking in e-mail;
- everything that needs a connection to the outside: bank feeds, tax portals, e-mail and messages, payment gateways, a language model for NUMI;
- statutory engines (tax computation, returns, provident fund and the like);
- recurring documents and anything that runs on a schedule;
- project accounting, manufacturing, corporate cards, mileage and per-diem engines;
- the builders of Genesis for forms, rules, reports and roles; departments as units that can be cloned and configured;
- consolidation with ownership percentages, non-controlling interests and currency translation;
- a mobile application.

Each of these is a piece of work of its own. None is hidden behind a screen that pretends to do it.
