# Brief: records of phases 1 and 2 that phase 3 may have changed (GHL NUMERO)

Project root: `C:\Users\GIO4X\Documents\GHL NUMERO`.

Read `scripts/_assess/STATUS_BRIEF_P3.md` first. Its status rules, its list of what exists and its list of facts
apply here without change. Then read `scripts/_assess/P3_CORRECTIONS.md`: it lists what was corrected and built
after that brief was written (for example, reports now show their reconciliation status; lists of the live data
layer are read in pages; the owner is no longer told of every routine approval; a verification can be cancelled).
`scripts/_assess/P3_BUILD_NOTES.md` says what each Phase 3 screen does and does not do, as claimed by its builders.

## The task

Phase 3 (release 0.3.0) built inventory, investments and funds, NUMERO Reality, the Digital Twin, the Scenario
Studio (workflows designed step by step), the sandbox, notifications, communications prepared from templates, the
register of integrations, capability switches, recorded backups, system health, imports with validation, the
parallel run, analysis (year on year, burn, unusual entries, deadlines, owner attention) and travel booking detail.

Some requirements that belong to phases 1 and 2 ask for these very things. Their records in the requirement ledger
were written before Phase 3 existed, so they may now say "not built" of something that is built. Such a record is
out of date. Your task is to bring your list of candidates up to date — **and to leave every record alone that
Phase 3 did not change.**

You are given a list of candidate requirements, each with its text, its recorded status and its recorded note. The
list was made by key words. **Being on the list proves nothing; expect most records to stay as they are.**

For each candidate:

1. Read the requirement text. Decide what it asks for.
2. Ask: did Phase 3 build any of it? Look in the code, not in the descriptions. Open the page and the engine.
3. If Phase 3 changed nothing that the requirement asks for → put its number in `UNCHANGED`.
4. If Phase 3 built part or all of it → write a new record in `UPDATES`.

## Rules for a new record

* The new record **replaces** the old one. The full old record (status, evidence, notes) is in
  `docs/requirement-status.json` under the requirement number; a requirement that is not there is PLANNED and its
  reason is in `docs/requirement-planned-notes.json`. Carry over from the old record everything that is still
  true — evidence and note — and add what Phase 3 built. Do not lose what Phase 1 or 2 had recorded.
* The note must contain the words "Phase 3" and say what Phase 3 added.
* Status rules are those of `STATUS_BRIEF_P3.md`. A requirement that lists many capabilities is `PARTIAL` unless
  ALL of them are built. `PARTIAL` notes say "Built: … Not built: …". `TESTED` names the test. When in doubt, the
  lower status.
* A requirement recorded as PLANNED becomes `PARTIAL` as soon as a real part of it works through a screen. It
  does not become `PARTIAL` because a related screen exists: the thing the requirement asks for must be there.
* **Do not raise a status because of wording.** "Notification" in a requirement that asks for an e-mail or an SMS
  is not met by an in-app notice: nothing leaves the application. "Workflow builder" that asks for branching,
  conditions or automatic start is met only in the part the Scenario Studio really does (a straight line of steps,
  started by a person). "Scenario" in the sense of a financial simulation is the Digital Twin; "scenario" in the
  sense of a way of working is the Scenario Studio. "Integration" is met by nothing: no system is connected; the
  register records intent.
* Do not lower a status. If you find that an existing record claims more than the code does, leave the record in
  `UNCHANGED` and say so in your final report, with the requirement number, the claim and what you found.
* Evidence names files that exist (paths from the project root, such as `src/pages/Inventory.tsx`) and tests by
  file and name or id. Line numbers are welcome.
* Write in plain words. No marketing words. Say what it does and what it does not.

## The file you write

One file, the only file you may create or change. Python, UTF-8:

```python
# Records of phases 1 and 2 brought up to date after phase 3 — part N. Assessed against the code on 2026-09-27.
UPDATES = [
    # (status, requirement number, evidence, notes)
    ("PARTIAL", 61, "src/pages/Notifications.tsx · src/api/demoPlatform.ts · supabase/migrations/0018_platform.sql · tests/sql/phase3_platform.sql T240 T241",
     "Built: … (Phase 3) … Not built: …"),
]
UNCHANGED = [12, 15, 19]   # looked at; Phase 3 changed nothing these requirements ask for
```

Every candidate number of your list appears exactly once, in `UPDATES` or in `UNCHANGED`.

Check your file before you finish, from the project root:

```
python scripts/check_status_updates.py scripts/status_phase3_updates_N.py scripts/_assess/reqs_earlier_N.md
```

It must print `OK: every candidate is recorded once.` Correct the file until it does.

## What you do not do

You do not change product code, tests, documents or any other file. You do not run the application, the test
suites, git or the database. You read, and you write your one file.

## Your final report

Counts (updated by status, unchanged); the five updates you consider the most significant, one line each; any
existing record that claims more than the code does; any defect of the product you noticed while reading.
