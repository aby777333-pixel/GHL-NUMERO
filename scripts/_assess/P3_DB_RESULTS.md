# Database suites — results of the final run, 28 September 2026, after migration pieces p3_01 … p3_27

Every suite runs in one transaction that is rolled back. All eleven were run after the last migration piece
(p3_27). 289 checks, 289 pass.

| Suite | Checks | Result |
|---|---:|---|
| `tests/sql/engine_invariants.sql` (T01–T24) | 44 | all pass |
| `tests/sql/document_posting.sql` (T25–T28) | 4 | all pass |
| `tests/sql/phase2_flow.sql` (T29–T81) | 53 | all pass |
| `tests/sql/phase2_treasury_purchasing.sql` (T82–T109) | 28 | all pass |
| `tests/sql/phase2_payroll.sql` (T110–T129) | 20 | all pass |
| `tests/sql/phase2_corrections.sql` (T130–T149) | 20 | all pass |
| `tests/sql/phase2_corrections_2.sql` (T150–T155) | 6 | all pass |
| `tests/sql/phase3_inventory.sql` (T160–T189, T272–T274) | 33 | all pass |
| `tests/sql/phase3_investments.sql` (T190–T213) | 24 | all pass |
| `tests/sql/phase3_control.sql` (T220–T239, T275) | 21 | all pass |
| `tests/sql/phase3_platform.sql` (T240–T271, T276–T279) | 36 | all pass |

Checks added after the assessment of release 0.3.0:

* T213 a fee is charged only for days that have passed
* T269 a driver in use stays in use while its successor awaits approval, and leaves when the successor is approved
* T270 owner override is the owner's alone: another person still cannot approve the case they started
* T271 the person who started a case states their own request and goes no further; a person without the permission completes nothing
* T272 stock moved to another place is as old as its receipt, and a transfer is not stock leaving
* T273 a stock document is not dated on a day that has not come
* T274 a stock ledger that holds no item is compared with the books all the same
* T275 a sheet opened by mistake is cancelled with its reason, keeps what was entered on it and raises nothing; a completed sheet stays
* T276 of the approvals that wait, the owner was told of none that were routine, and is told of the one the rules class for the owner
* T277 an alert that carries a difference and no amount is classed by its size, whichever way it points
* T278 the measure of a page returns 1,001 numbers to a signed-in person, reads no table, and cannot be called by someone who is not signed in
* T279 a statement line matched in part is not reconciled: system health counts it and the person who reconciles is told

Application tests (`npm test`): 461 of 461 pass, in 8 files.
