# NUMERO TEST MATRIX

REQUIREMENT → TEST. A requirement is marked **TESTED** in the ledger only if it appears here.

Two suites cover the two implementations of the engine.

| Suite | Runs against | How to run |
|---|---|---|
| `tests/sql/engine_invariants.sql` | The real Postgres database, inside a transaction that always rolls back | Run the file in the Supabase SQL editor. Results arrive in the error message; every line must start with `PASS`. |
| `tests/engine.test.ts` | The TypeScript ledger engine and the seeded demo universe | `npm test` |
| `tests/commands.test.ts` | Voice / command interpreter | `npm test` |

Last run: database 44 of 44 passed · application 97 of 97 passed.

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

## Not yet covered by automated tests

Interface behaviour in the browser · concurrency under load · migration and import · consolidation with minority interests · currency translation. These are verified manually or not yet built; none is marked TESTED.
