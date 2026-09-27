# Corrections made after the first assessment (27 September 2026, 15:00–15:25)

The four assessors reported defects as well as statuses. The defects below were then corrected in the code.
The status files were written BEFORE these corrections, so some of their notes now describe a defect that no
longer exists, or say "Not built" about something that now is. Those notes must be brought up to date.

Nothing in this list may be taken on trust. Open the file, read the code, then change the note.

## Database (migrations `0011_review_corrections.sql`, `0012_follow_up_confidentiality.sql`)

| # | Correction | Where | Tests |
|---|---|---|---|
| 1 | A loan recovered through payroll reaches its instalment schedule (`loan_schedule.recovered`); an instalment takes only the principal not yet recovered; reversing the payroll takes the recovery back, and refuses if an instalment was recorded after it | `numero_private.apply_loan_recovery`, `wf_payroll`, `pay_loan_instalment`; demo `applyLoanRecovery` in `src/api/demo.ts`; `src/engine/ops.ts` `principalDue`, `instalmentDue`; `src/pages/Loan360.tsx` | `tests/sql/phase2_corrections.sql` T130–T133 · `tests/ops.test.ts › corrections from the requirement review` (two tests) · `tests/forward.test.ts › an instalment partly recovered through payroll…` |
| 2 | An advance to a vendor posts to the vendor advances ledger | `numero_private.advance_account`; demo `advanceAccount` | T134, T138 · `tests/ops.test.ts › an advance to a vendor…` |
| 3 | A claim or advance linked to a register item (trip, event, vehicle, path) carries that item's dimension into its accounting entry; the item's page lists the linked claims and advances | `numero_private.item_dims`; demo `itemDims`; `src/pages/Register360.tsx` section "Claims and advances linked to this item" | T135 · `tests/ops.test.ts › a claim linked to a trip…` |
| 4 | Cash box "maximum single payment" is checked: a payment above it, proposed by any operation, raises the alert `cash_box_limit_exceeded` for review and is still recorded. It does not cover manual journals or Phase 1 payments | trigger `workflow_postings_cash_box_limit`; demo `checkCashBoxLimit` | T136, T137 · `tests/ops.test.ts › a payment from a cash box above its limit…` |
| 5 | Advance approval in several steps keeps the amount authorised at each step; a later step may lower it, not raise it; rejection resets it | `approve_advance`, `reject_advance`; demo | T139–T142 · `tests/ops.test.ts › in an approval of several steps…` |
| 6 | A person who may only upload can open the files they uploaded; a stored file that never became a document can be removed by its uploader (the live client does so when registration is refused) | storage policies in 0011; `src/api/supabase.ts` `uploadDocument` | T147 (the helper only; storage itself was not exercised) |
| 7 | A follow-up takes the confidentiality of the record it is linked to and is read under the same rule; a follow-up on payroll needs `payroll.view` | migration 0012; demo `recordConfidentiality` in `src/api/demoOps.ts` | T143–T146 · `tests/ops.test.ts › a follow-up is as confidential…` |

## Engines

| # | Correction | Where | Tests |
|---|---|---|---|
| 8 | Forward: a scheduled occurrence of a register item is left out when a bill or invoice from the same party is recorded for that period (no double counting). What was left out is listed on the screen. This is an inference from party and date | `buildForward`, `CoveredOccurrence` in `src/engine/forward.ts`; note on `src/pages/Forward.tsx` | `tests/forward.test.ts › a scheduled occurrence that has already been billed…`, `› a bill from another party…` |
| 9 | Forward: a register item with no direction and certainty `contingent` (guarantees given, claims against the company) is shown as CONTINGENT, beside the projection | `src/engine/forward.ts` | `tests/forward.test.ts › a guarantee given is contingent…`, and the sample-universe contingent test (now 1.62 crore) |
| 10 | Forward: events from records without an exchange rate carry their currency; the screen warns how many items are counted at face value and in which currencies. Still NOT converted | `ForwardEvent.currency`; `src/pages/Forward.tsx` | `tests/forward.test.ts › records that carry no exchange rate…` |
| 11 | Notices rise at 60, 30 and 7 days (info up to 90) | `noticeLevel` in `src/engine/forward.ts` | `tests/forward.test.ts › notices rise at 60, 30 and 7 days` |
| 12 | Dependence on one vendor (payable concentration) is a warning again, beside dependence on one customer | `earlyWarnings` kind `payable_concentration` | `tests/forward.test.ts › dependence on one vendor…` |
| 13 | People cost by department uses the department recorded on the payroll line. The People Cost screen reads the ledger page by page, up to 20,000 entries, instead of the first 1,000 | `peopleCost` in `src/engine/ops.ts`; `src/pages/PeopleCost.tsx` | `tests/forward.test.ts › people cost follows the department recorded on the payroll line…` |
| 14 | Forward screen states its assumptions: payroll at net pay (remittances not projected); POSSIBLE and PROBABLE counted in full in "Projected (all)"; a scheduled item whose date has passed stays overdue until a person acts | `src/pages/Forward.tsx` | none (these are stated limitations, not corrections of behaviour) |

## Screens

| # | Correction | Where |
|---|---|---|
| 15 | Register item "State" is a list of the values the database accepts | `src/pages/Registers.tsx` (`STATES`) |
| 16 | Genesis custom fields can be defined for `invoices`, `register_items`, `fixed_assets` and `party`, which are exactly the record types whose screens show and save the values; the other types are labelled "not yet shown on its screen". Party fields appear on the party's Operations tab | `src/pages/Genesis.tsx`, `src/ui/ops.tsx` `CustomFields`, `src/ui/PartyOperations.tsx` |
| 17 | Loan kinds offered on screen match the database | `src/pages/Treasury.tsx` `LOAN_KINDS` |
| 18 | A salary component that is an earning or an employer cost can name the expense ledger it is charged to. Deductions and employer contributions are still CREDITED to the mapped ledgers only | `src/pages/Payroll.tsx` |
| 19 | The asset form can name the bill the asset was bought on | `src/pages/Assets.tsx` |
| 20 | Approval rules can be added and edited (name, record kind, company, amount range, steps by role, in force or not) by a Group Super Admin or a holder of `approval.configure` | `src/ui/ApprovalRuleEditor.tsx`, `src/pages/Approvals.tsx` |
| 21 | The opening voucher type can be chosen in the journal editor | `src/pages/JournalEditor.tsx` |
| 22 | Dropped files are checked against the same list of accepted types as chosen files | `src/pages/Inbox.tsx` |
| 23 | A link that knows only an invoice id (from a follow-up) lands on the right screen for a sales invoice or a purchase bill | `src/pages/DocumentEditor.tsx` |
| 24 | Screens and navigation follow the database's own read rules: a person who may only create (an employee) reaches Expenses, Purchasing and the Inbox and sees their own records | `src/App.tsx` `Need`, `src/ui/Shell.tsx`, `src/pages/Inbox.tsx` |

## NUMI

| # | Correction | Where | Tests |
|---|---|---|---|
| 25 | A question about fuel, hotel, airfare or local conveyance is answered for that category, not for all travel | `CATEGORY` in `src/numi/engine.ts` | `tests/numiOps.test.ts › a narrower question gets the narrower figure` |
| 26 | The wording of the specification's example questions is recognised: money made this week, money we actually have, consolidated P&L, unreconciled transactions, audit exceptions, working capital, actual against budget, cash needed next month, contracts renewing next month, uncommitted. "This week", "last week", "today", "yesterday" are periods | `src/numi/engine.ts`, `src/numi/ops.ts` | `tests/numiOps.test.ts › the wording of the specification's own example questions` (13 tests) |

## Reported and NOT corrected — these remain true limitations

- `budgetExhaustion` is called by no screen and no NUMI answer.
- An amount marked POSSIBLE or PROBABLE is counted in full; the recorded probability is shown, not applied.
- Forward projects payroll at net pay only.
- Nothing converts currencies for register items, loans, deposits, claims and advances.
- A scheduled occurrence in the past stays overdue until a person edits the item; `next_due` does not advance by itself.
- Each salary deduction and employer contribution is credited to the mapped ledger; it cannot have a ledger of its own.
- Fixed deposit "renewal instructions" are a yes/no flag and notes.
- The storage bucket does not restrict file types; the screen does.
- The cash box limit is not checked for manual journals or for Phase 1 payments and receipts.
- Trip, event and vehicle cannot be chosen as a tag on an individual claim line (only department and project); the link is at claim level.
- Bill lines are matched to order lines by position.
- Backups and disaster recovery, notifications, OCR, scheduled runs, statutory engines, builders: not built (see the brief).

## Third round: found when the corrections above were reviewed (27 September 2026, 15:40–16:10)

Migration `0013_review_corrections_2.sql`; database tests `tests/sql/phase2_corrections_2.sql` T150–T155.

| # | Correction | Where | Tests |
|---|---|---|---|
| 27 | A required custom field limited to one sub-type (register kind, document type, party type) is asked only of records of that sub-type | `numero_private.record_scopes`, `save_custom_values`; demo `recordScopes` in `src/api/demoOps.ts` | T150, T151, T154 · `tests/ops.test.ts › second review of the corrections` (two tests) |
| 28 | A follow-up follows its record when the record is reclassified | trigger `follow_ups_follow_record`; demo `listTasks` reads the level of the live record | T152 · `tests/ops.test.ts › a follow-up stays as confidential as its record…` |
| 29 | A claim or an advance is at least as confidential as the register item it names | trigger `inherit_item_confidentiality`; demo `withItem` in `src/api/demo.ts` | T153 · `tests/ops.test.ts › a claim or an advance is at least as confidential…` |
| 30 | The page of a register item shows cost recorded on expense ledgers apart from advances still held | `src/pages/Register360.tsx` | none: the split is calculated on the page |
| 31 | Forward: only a purchase bill covers a scheduled payment and only a sales invoice a scheduled receipt; debit and credit notes cover nothing | `buildForward` in `src/engine/forward.ts` | `tests/forward.test.ts › only the bill itself stands for the period…` |
| 32 | NUMI patterns match whole words ("profit" is not "IT"); a question about overspending is answered from the budget | `CATEGORY` and the spending branch in `src/numi/engine.ts` | `tests/numiOps.test.ts › whole words only` (three tests) |
| 33 | Any register item that tracks its own cost can be named on a claim or an advance (vehicles, properties, incidents, work orders, contracts), not only trips, paths and events | `src/pages/ClaimEditor.tsx`, `src/pages/Expenses.tsx` | `tests/ops.test.ts › a claim linked to a property or an incident…` |

Requirement records rewritten for this round: 25, 133, 186, 198, 252, 292, 295, 296, 341 (part A); 243, 317, 322, 334, 674 (part B);
4, 498, 830 (Phase 1), and 158 added to the Phase 1 updates. No status was raised: every change is to a note or to the evidence.

Still true after this round: 'Which department overspent?' is answered by ledger and company, because budgets are not kept by department;
'How much did each vehicle cost us this year?' is answered with total expense by company; a vendor's bill cannot name a register item.

## Test totals now

- Application: 262 tests, all pass (`npm test`).
- Database: 175 checks in seven scripts, all pass; all seven re-run after migration 0013, every run rolled back.
