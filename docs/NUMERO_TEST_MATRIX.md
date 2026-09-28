# NUMERO TEST MATRIX

REQUIREMENT → TEST. A requirement is marked **TESTED** in the ledger only if it appears here.

Two suites cover the two implementations of the engine.

| Suite | Runs against | How to run |
|---|---|---|
| `tests/sql/engine_invariants.sql` | The real Postgres database, inside a transaction that always rolls back | Run the file in the Supabase SQL editor. Results arrive in the error message; every line must start with `PASS`. |
| `tests/engine.test.ts` | The TypeScript ledger engine and the seeded demo universe | `npm test` |
| `tests/commands.test.ts` | Voice / command interpreter | `npm test` |
| `tests/sql/phase2_flow.sql` (T29–T81) | The real database: proposal engine, assets, advances, claims, cash, transfers, documents, registers, privileges | as above |
| `tests/sql/phase2_treasury_purchasing.sql` (T82–T109) | The real database: account mapping, loans, deposits, purchase-to-pay, vendor selection, salary approval | as above |
| `tests/sql/phase2_payroll.sql` (T110–T129) | The real database: payroll, privacy, follow-ups, custom values | as above |
| `tests/sql/phase2_corrections.sql` (T130–T149) | The real database: the corrections found in the requirement review | as above |
| `tests/sql/phase2_corrections_2.sql` (T150–T155) | The real database: what the review of those corrections found | as above |
| `tests/ops.test.ts` | The operations engine in TypeScript and the seeded demo universe | `npm test` |
| `tests/forward.test.ts` | Forward: events, horizons, warnings, advance memory | `npm test` |
| `tests/numiOps.test.ts` | NUMI on operations, permission handling, commands on operations | `npm test` |
| `tests/sql/phase3_inventory.sql` (T160–T189, T272–T274) | The real database: items, lots, stock documents, costing, reservation, counts, landed cost, reversal, the stock ledger against the general ledger | as above |
| `tests/sql/phase3_investments.sql` (T190–T213) | The real database: corporate structure, holdings, valuations, funds, calls, units, net asset value, fee, distributions | as above |
| `tests/sql/phase3_control.sql` (T220–T239, T275) | The real database: materiality, cases, verification, confirmations, reclassification, allocation | as above |
| `tests/sql/phase3_platform.sql` (T240–T279) | The real database: notifications, simulations, drivers, workflows, communications, integrations, capability switches, health, backups, imports, facts, travel detail | as above |
| `tests/p3.test.ts` | Inventory, investments and funds in the TypeScript engine | `npm test` |
| `tests/p3control.test.ts` | Control, platform, the digital twin, reality, exposure, analysis in the TypeScript engine | `npm test` |
| `tests/p3app.test.ts` | The sample books after the Phase 3 seed, the loaders, NUMI and commands on Phase 3, capability switches, the sandbox | `npm test` |

Last run (28 September 2026): database 289 of 289 passed in eleven scripts, all run after the last migration piece (p3_27), every run rolled back, database verified empty afterwards · application 461 of 461 passed in eight files.

The database suites create their own users and companies inside one transaction and end by raising an exception that carries the results, so nothing they do can remain. Posted journals and audit rows cannot be deleted; a test that committed would leave them for ever.

## Accounting

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Debit = credit for every posted journal | 6, 377, 1521 | T07, T18 | every posted journal balances; unbalanced journal refused |
| A line is one-sided | 6 | constraint | a line cannot carry both a debit and a credit |
| Posting only after approval | 66 | T04 | posting controls |
| Posting is idempotent | 91, 1436 | T06, T16e | posting is idempotent; idempotency key prevents duplicate drafts |
| Posted records are immutable | 67, 1276 | T10a, T10b, T10c | posted journals cannot be edited; posted lines are frozen |
| Correction by reversal | 67, 1375 | T15a, T15b | reversal restores the balance; cannot reverse twice or reverse a reversal |
| Reversal needs a reason | 45 | reverse_journal | reason is required |
| Group headings cannot receive postings | 370 | T08 | group headings refused |
| Trial balance ties | 376 | T18 | per company and for the group |
| Balance sheet equation | 382 | — | assets = liabilities + equity, per company and group |
| P&L result equals balance-sheet current profit | 388 | — | yes |
| Cash flow explains all cash movement | 384, 654 | — | unexplained difference is zero |
| Control account = subledger | 373, 396 | T17b | receivable and payable control accounts reconcile |
| Open documents = control balance | 459 | T17b | receivables exactly; payables within rounding of foreign-currency bills |

## Periods

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Locked period refuses postings | 55, 399 | T14a | locked periods refuse postings |
| Reopening requires a reason | 399 | T14b, T14c | yes |

## Tax, documents, payments

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Invoice posting: receivable, revenue, tax | 69, 16 | T16d | invoice approval posts receivable, revenue and tax |
| Tax rates are data, versioned by date | 16, 1235 | — | tax rates are versioned by effective date |
| Allocation cannot exceed outstanding | 459 | T17a | yes |
| Allocation cannot cross parties | 172 | save_payment | yes |
| Partial settlement | 11 | T17b | seeded partial payments reconcile |
| Foreign-currency settlement difference | 17, 457 | — | seeded USD bills settle with exchange difference; books balance |

## Permissions and isolation

| Requirement | Spec | Database test |
|---|---|---|
| Company A user cannot read Company B | 92, 1485, 1519 | T11a, T11b |
| Reporting functions return nothing for unauthorised companies | 80 | T11c, T11d |
| Cannot write into another company | 92 | T11e |
| Cannot use another company's account | 92 | T11f |
| Cannot open another company's journal | 92 | T11g |
| User without membership sees nothing | 43 | T12 |
| Anonymous sees nothing | 65 | T13 |
| Cannot promote oneself | 594 | T24 |
| Client cannot change journal status directly | 67 | T09 |
| Bootstrap only once | 2 | T02 |

## Controls

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Maker cannot approve own entry | 66, 411 | T03, T16c | maker-checker enforced |
| Owner self-approval only when configured; recorded as override | 66 | T19a | yes |
| Bank detail change needs second verification | 109 | T22, T23 | payments cannot use unverified details |
| Blocked party cannot transact | 167 | save_invoice / save_payment | yes |
| Duplicate party surfaced, never merged | 138 | T16b | yes |
| Reconciliation never forces a mismatched amount | 391 | set_bank_match | yes |
| Audit trail is append-only | 45, 359 | T10d | — |

## Black Vault

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Restricted detail hidden from uncleared users | 331, 352 | T19b | yes |
| Totals still include restricted entries | 330, 358 | T19b | yes |
| Masked bucket returned so drill-down ties | 352 | T19b | yes |
| Opening a restricted record returns RESTRICTED | 332 | T19c | — |
| Uncleared user cannot create restricted records | 326 | T19d | — |

## Sentinel

| Requirement | Spec | Test |
|---|---|---|
| Duplicate invoice, duplicate payment, round number, unusual time, below threshold, new vendor large payment, bank detail change | 40, 726–734 | application: sentinel raises factual anomalies |
| Never labelled as fraud | 40, 855 | T20 · application |
| Every alert carries explanation and evidence | 801 | application |

## Time machine

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Books as known at an earlier moment | 88, 505 | T21 | reconstructed books balance |

## NUMI and voice

| Requirement | Spec | Test |
|---|---|---|
| Parses a sentence into a balanced proposal | 38 | application |
| Asks instead of guessing a party | 178, 653 | application |
| Learned preferences cited with counts | 37, 81 | application |
| Never invents an amount | 915 | application |
| Sensitive voice commands never executed (14 phrasings) | 39, 1613 | commands |
| Instruction embedded in dictated text is inert | 80, 923, 1523 | commands |
| Navigation, theme, privacy, mode, period, company by voice | 39, 63 | commands (27 routes) |

## Money

| Requirement | Spec | Test |
|---|---|---|
| Decimal arithmetic | 91 | application |
| Indian number formatting, lakh / crore | 78 | application |
| Privacy masking | 77 | application |
| Spoken amounts | 1607 | application |
| Every template maps only to accounts it contains | 83 | application (12 templates) |

## Operations never write to the ledger

| Requirement | Database test | Application test |
|---|---|---|
| An operation only proposes; nothing reaches the ledger before approval | T31, T120 | ops: proposal is pending, ledger unchanged |
| The proposer cannot approve the proposed entry | T32, T86 | ops |
| A proposed entry cannot be edited by hand | T33 | ops |
| Final approval posts the entry and updates the source record | T35, T88 | ops |
| Reversing the entry reverses the source record | T38, T76, T77 | ops |
| One pending entry per record | T87 | ops |
| Nobody approves what they cannot read | T116 | engine: clearance check |
| Internal posting functions cannot be called by a signed-in user, nor anything anonymously | T78, T79 | — |
| Every table has Row Level Security; every policy names a permission | T80, T81 | — |
| Every posted journal balances, including all proposed entries | T36, T113, T129 | every posted journal balances |
| Account mapping accepts only active posting ledgers | T82, T83 | ops |
| Money moves only through bank or cash ledgers | T39, T45 | ops |

## Advances and expenses

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| An advance is not an expense | 1556–1560 | T46, T47 | ops; NUMI states it |
| Approval moves no money; a lower amount may be approved | 1558 | T42, T43 | ops |
| Release cannot exceed the approved amount | 1558 | T44 | ops |
| Partial settlement leaves RETURN DUE; return cannot exceed the balance | 1561 | T52, T53, T54 | ops |
| Excess expense becomes a reimbursement due | 678 | T56, T58 | ops |
| Policy flags are recorded and never reject | 1568 | T48, T49 | ops |
| Approving a flagged line needs the approver's comment | 1568 | T50 | ops |
| Advance memory: facts shown before another advance is approved | 1562–1563 | T55 | forward: advance memory; numiOps |
| An employee sees only their own claims, and cannot approve | 43 | T59, T60, T61 | — |
| A claim cannot be reversed while its reimbursement is pending | — | T57 | ops |
| Recovery through payroll cannot exceed the unsettled advance | — | T109, T121 | ops |

## Cash, transfers, documents, registers

| Requirement | Database test | Application test |
|---|---|---|
| A cash count records the difference and never changes the books | T62 | ops |
| A cash count cannot be altered afterwards | T63 | — |
| A transfer touches neither income nor expense | T64 | ops |
| A transfer between companies has two entries; one side alone raises an alert | T65 | ops |
| An identical file is kept and flagged, never discarded | T66 | ops |
| A document sits in its own company, cannot be deleted, facts cannot be altered | T67, T68, T69 | — |
| Required fields of a register kind are enforced | T70 | ops |
| Reference numbers, default certainty, cost-tracking dimension | T71, T72, T73 | ops |
| Credit limit: recorded and flagged, not blocked | T74 | ops |
| Closing a follow-up requires its outcome | T126 | — |
| Custom values: required fields enforced, only defined fields stored | T127, T128 | — |

## Fixed assets

| Requirement | Database test | Application test |
|---|---|---|
| Straight-line and written-down-value depreciation, part month | T30 | ops |
| Months are depreciated in order; an earlier month cannot be reversed while a later one stands | T34, T37 | ops |
| Depreciation carries the department | T36 | ops |
| Disposal removes cost and accumulated depreciation; gain or loss = proceeds − book value | T40, T41 | ops |
| Register agrees with the ledger | — | ops: reconciliation on the seeded company |

## Purchase-to-pay

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| A requisition needs its reason; the requester cannot approve it | 522 | T94, T96 | ops |
| An order needs an approved requisition or the selected quotation | 524 | T95, T106 | ops |
| An approved order is a commitment: no journal | 526, 672 | T97 | forward: commitments |
| Receipts cannot exceed the order | 527 | T98 | ops |
| A bill links only to an order of the same vendor; lines are traceable | 521 | T99, T101 | ops |
| Three-way comparison flags, never blocks | 529 | T100, T102 | ops: threeWayMatch |
| A receipt cannot be cancelled once a bill stands | — | T103 | — |
| A person chooses the vendor and records why; the record says whether it was the lowest | 525 | T104, T105 | ops: compareQuotations |

## Treasury

| Requirement | Database test | Application test |
|---|---|---|
| A loan taken sits in a liability ledger | T84 | ops |
| Schedule: instalments, interest, principal sums to the loan, closes at zero | T85 | ops |
| Instalments in order; interest as actually charged | T89, T90 | ops |
| Deposit maturity value by compounding | T91 | ops |
| A deposit under lien cannot be closed until release is confirmed | T92 | ops |
| Interest on closure = proceeds + tax deducted − principal | T93 | ops |

## Payroll and privacy

| Requirement | Spec | Database test | Application test |
|---|---|---|---|
| Payroll permissions are not given to finance roles by default | 32 | T29, T117 | — |
| Calculation from approved salaries, pro-rata, adjustments | 1619 | T110 | ops |
| Nobody is dropped silently | 1623 | T111 | ops |
| One regular payroll per month | — | T112 | ops |
| Journal is confidential, by department, balanced | 1197 | T113, T114, T115 | ops |
| Entering and approving a salary are separate | — | T107 | ops |
| An approved salary is never overwritten; a revision is a new record | — | T108, T125 | ops |
| The audit trail hides payroll rows | — | T118 | — |
| The confidential journal is invisible without clearance | 331 | T119 | — |
| Private is not false: totals include payroll | 330 | T122 | — |
| Payroll cannot be reversed once paid or while payment is pending | — | T123, T124 | ops |
| NUMI never states an individual's pay | 916 | — | numiOps |

## Forward

| Requirement | Spec | Test |
|---|---|---|
| Every event carries a certainty; firm and uncertain are separated | 666–671 | forward |
| Contingent amounts are beside the projection, not inside it | 671 | forward; numiOps |
| Overdue items move to today; nothing unrecorded is included | 700 | forward |
| Estimated collection dates are labelled and optional | 687 | forward |
| Escalation, frequency, end date and auto-renewal of register items | 675 | forward |
| Early warnings state facts and assumptions, never a conclusion | 722 | forward |
| Sources a person may not read are named | 916 | numiOps |

## NUMI and commands on operations

| Requirement | Test |
|---|---|
| Figures agree with the engines, to the rupee | numiOps (advances, commitments, debt, assets) |
| A refusal is reported as a refusal, with no figures | numiOps |
| An empty answer from the database is never read as "none exist" | numiOps |
| Partial permission: the answer says what is left out | numiOps |
| 22 new navigation phrases; 5 earlier ones keep their meaning | numiOps |
| 14 sensitive phrasings are never executed (release, settle, reimburse, run payroll, dispose, repay, break a deposit, place an order, select a vendor, approve) | numiOps |
| Every workflow source has a label, a rule and a link | numiOps |

## Corrections found in the requirement review

Every requirement of Phase 2 was assessed against the code. The assessment found defects; each was corrected and given a test.

| Requirement | Database test | Application test |
|---|---|---|
| A loan recovered through payroll reaches its instalment schedule; nothing changes before approval | T130, T131 | ops: corrections |
| An instalment takes only the principal not yet recovered; principal repaid never exceeds the amount disbursed | T132 | ops; forward |
| Reversing a payroll takes the recovery back, and refuses past a later instalment | T133 | ops (two tests) |
| An advance to a vendor sits in the vendor advances ledger; an employee's in employee advances | T134, T138 | ops |
| A claim linked to a trip carries the trip into its entry | T135 | ops |
| A payment from a cash box above its limit is raised for review, still recorded, and nothing is raised within the limit | T136, T137 | ops |
| Several approvals: the amount authorised is kept; a later step may lower it, not raise it; rejection keeps nothing | T139–T142 | ops |
| A follow-up is as confidential as its record; a payroll follow-up needs the payroll permission | T143–T146 | ops |
| Only a stored file that never became a document can be removed | T147 | — |
| The new internal functions cannot be called by a signed-in user | T148 | — |
| A scheduled occurrence already billed is not counted twice; an unrelated bill covers nothing | — | forward (two tests) |
| A guarantee given is contingent, beside the projection | — | forward |
| Records without an exchange rate say which currency they are in | — | forward |
| Notices rise at 60, 30 and 7 days | — | forward |
| Dependence on one vendor is stated | — | forward |
| People cost follows the department on the payroll line | — | forward |
| The wording of the specification's example questions is recognised (13 questions) | — | numiOps |
| A narrower question gets the narrower figure | — | numiOps |

## Found when the corrections were reviewed

The corrections were reviewed in their turn. What that found was corrected in migration 0013 and in the application.

| Requirement | Database test | Application test |
|---|---|---|
| A required field of one sub-type does not block a record of another, and is still required where it belongs | T150, T151 | ops: second review |
| A field required of one party type is asked of that type only | T154 | ops: second review |
| When a record is reclassified its follow-ups follow | T152 | ops: second review |
| A claim or an advance is at least as confidential as the item it is linked to | T153 | ops: second review |
| The new internal functions cannot be called by a signed-in user | T155 | — |
| A claim linked to a property or an incident carries that record into its entry | — | ops: second review |
| Only the bill itself stands for the period: a debit note or a credit note covers nothing | — | forward: second review |
| NUMI matches whole words; a question about overspending is a budget question; a named category is still found | — | numiOps: whole words only (three tests) |

## Stock (Phase 3)

| Requirement | Database test | Application test |
|---|---|---|
| Inventory cannot be maintained without the permission | T160 | — |
| An item takes the valuation method of its category | T162 | p3: inventory |
| A receipt proposes its entry; the proposer cannot approve it; on approval the quantity is in stock | T163, T164, T165 | p3: inventory |
| Weighted average and first in, first out give the cost they should | T166, T167 | p3: inventory |
| Stock awaiting approval on one document cannot be issued on another; rejecting releases it | T168, T169 | p3: inventory |
| A lot is created with its receipt; expiry follows shelf life | T171 | p3: inventory |
| A transfer changes place, not value, and proposes nothing | T173 | p3: inventory |
| A condition noted on stock cannot exceed the stock and changes no value | T175 | p3: inventory |
| A loss is charged only when approved, with its reason | T176 | p3: inventory |
| A count: counted by one, reviewed by another, the books unchanged by counting; a count that agrees proposes nothing | T177, T178, T180, T181 | p3: inventory |
| Landed cost joins the stock still on hand; the share of what has left is a cost at once | T182 | p3: inventory |
| A receipt cannot be reversed once its goods have left; reversing an issue brings the stock back | T183, T184 | p3: inventory |
| Stock received against a goods receipt takes the vendor and the rate of the order | T185 | — |
| **The stock ledger and the general ledger agree** | T186 | p3: inventory · p3app: sample books |
| Exposure is beside the loss posted, never inside it | — | p3control: exposure · p3app: sample books |
| Internal functions are not callable; every table has row level security | T188, T189 | — |

## Investments and funds (Phase 3)

| Requirement | Database test | Application test |
|---|---|---|
| Owners cannot hold more than the whole; a company cannot own its own owner | T190, T191 | p3: investments |
| A purchase changes the holding only when its entry is approved | T193 | p3: investments |
| A sale releases the carrying amount and records the gain or loss | T195 | p3: investments |
| Income with tax deducted | T196 | p3: investments |
| A valuation of a holding carried at cost posts nothing; at fair value it proposes the change | T198, T199 | p3: investments |
| A fund is confidential: a person who is not cleared reads nothing | T200 | p3: funds |
| A call makes the amount owed and posts nothing; units are issued when the money is posted | T201, T203 | p3: funds · p3app: sample books |
| Net asset value comes from the books and is approved by a second person | T204 | p3: funds |
| The fee follows its formula; the same days cannot be charged twice; it is owed on a ledger of its own | T205 | p3: funds · p3app: sample books |
| Entitlement follows the units held on the record date; declaring pays nothing; tax is withheld on payment | T206, T208, T209 | p3: funds |
| A dividend cannot be declared while no shareholder is on record | T210 | — |

## Reality and control (Phase 3)

| Requirement | Database test | Application test |
|---|---|---|
| Materiality is set with its basis, by a person with the permission | T220, T221 | p3control: control |
| The same difference, found again, is the same case | T223 | p3control: control |
| A change of status needs its note; closing needs the resolution | T224 | p3control: control |
| The history of a case cannot be rewritten, even by a privileged role | T225 | — |
| Verification lists what the books carry; a missing asset raises an alert and stays in the books | T227, T228 | p3control: control |
| Cash verification, confirmation with a difference | T230, T231, T232 | p3control: control |
| Between companies the other side is read from its own books, only by a person who may read them | T233, T234 | p3control: control |
| A reclassification leaves the original line as it was | T235 | p3control: control |
| A shared cost divided by its driver | T237 | p3control: control |
| Five realities, five counts; nothing is called fraud; what cannot be read is named | — | p3control: reality · p3app: loaders |

## Simulations, the studio and the platform (Phase 3)

| Requirement | Database test | Application test |
|---|---|---|
| A person is told of an entry that waits for them, and reads only their own notices | T240, T241 | p3control: platform |
| A simulation belongs to the person who built it; a saved result is labelled SIMULATION and cannot be changed | T242, T243, T244 | p3control: twin · p3app: sample books |
| An assumption is used only after a second person approves it | T246 | p3control: twin |
| A simulation leaves the books as they were | — | p3app: loaders, NUMI |
| A workflow is checked when designed; its form is enforced; a step that releases money points to the record that does | T247, T248, T250 | p3control: platform |
| The person who started a case cannot approve it | T249 | p3control: platform |
| Evidence is required where the step asks for it; a workflow in use is changed by a new version | T251, T252 | p3control: platform |
| NUMERO prepares, a person sends; what was prepared cannot be rewritten | T255, T256 | p3control: platform |
| The register holds no secret; an integration that can move money is high risk | T257 | p3control: platform |
| A capability is switched by a Group Super Admin only; the most specific switch decides; core capabilities cannot be switched off | T258 | p3app: capability switches |
| With nothing on record, backups are "not recorded" | T259, T260 | p3control: platform |
| A file that fails its checks cannot be committed; staging adds nothing to the books | T261, T262 | p3control: platform |
| The earlier system's trial balance is kept beside the books | T263 | p3control: analysis |
| Monthly totals agree with posted entries | T264 | p3control: platform |
| A booking's parts add up to its line | T265 | ops |
| Every function a read rule relies on can be run by a signed-in user | T266, T267, T268 | — |
| The sandbox reads the books and writes nothing to them; balances are those of the books; salaries and history stay behind | — | p3app: the sandbox |
| A command never issues stock, pays a distribution, commits an import or sends a message | — | p3app: commands |

## Found by the assessment of Phase 3, and corrected

Every correction, with its place and its test, is listed in `scripts/_assess/P3_CORRECTIONS.md`.

| Requirement | Database test | Application test |
|---|---|---|
| A fee is charged only for days that have passed | T213 | p3: funds |
| A driver in use stays until its successor is approved; a driver supplies an assumption only in its own unit | T269 | p3control: a driver supplies an assumption only in its own unit |
| Owner override is the owner's alone | T270 | p3control: platform |
| The person who started a case states their own request and goes no further | T271 | — |
| Stock moved to another place keeps the age of its receipt | T272 | p3: stock moved to another place… |
| A stock document is not dated in the future | T273 | p3: a stock document is not dated… |
| A stock ledger with no item is compared with the books | T274 | p3: system health compares… |
| A verification opened by mistake is cancelled with its reason | T275 | p3control: a verification opened by mistake… |
| The owner is told of what the rules class for the owner, not of every approval | T276 | p3control: the owner is not told of every approval… |
| The class of an alert follows its amount or its difference | T277 | p3control: the class of an alert… |
| The size of a page of the API is measured, not assumed; lists are read to their end or refused | T278 | p3app: a list of the live books is read to its end (six tests) |
| A statement line matched in part is not reconciled, everywhere | T279 | p3control: a statement line matched in part… |
| A difference keeps its key; a sale in another currency is stated in the currency of the company; verification sheets reach Reality, measured by the size of the difference; a sheet with unchecked items does not agree | — | p3control: what the assessment found · what the second reading found |
| A report states the reconciliation of the records it rests on, for its period | — | p3control: a report states the reconciliation… · the reconciliation of a report is that of its period |
| NUMI reads a figure in its own clause and in its own direction; a rate of exchange or of tax is not interest | — | p3app: which way a figure points… (five tests) |
| A capability switch governs its screens however they are reached | — | p3app: a switch governs its screens… |
| A commitment that has ended counts for what was called of it | — | p3control: a commitment that has ended… · an investor whose commitment has ended… |
| A rule tried on history does not add currencies | — | p3control: a rule tried on history… |

## Not yet covered by automated tests

Interface behaviour in the browser (the screens of Phase 3 were opened and used by hand in the demo; no automated browser test exists) · concurrency under load · import of large files · consolidation with minority interests · currency translation · file upload to live storage · impairment and loans given (engine exists, no dedicated test) · permission refusals in the application (the demo gives every user every permission; refusals are tested against the database). These are verified manually or not yet built; none is marked TESTED.
