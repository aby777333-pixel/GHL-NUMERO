# Brief: assessing requirement status honestly (GHL NUMERO, Phase 3)

Project root: `C:\Users\GIO4X\Documents\GHL NUMERO`.

GHL NUMERO is built from a master specification of 1,916 numbered requirements. The specification has a binding
"Zero-Omission Directive": **never claim something is complete when it is not; a screen without an engine is not
complete; a TODO is not an implementation; nothing may be silently dropped.** The requirement ledger is the record
the owner relies on. An over-claimed status is a defect. An under-claimed status is only a small loss. When in doubt,
choose the lower status and say exactly what is missing.

Your task is to ASSESS and RECORD. You do not write product code and you do not change any file except the one
status file assigned to you. You read each requirement, find the code and the tests that implement it, and record
a status with evidence.

## Status rules (exact)

| Status | Meaning |
|---|---|
| `TESTED` | The engine exists (database function and/or demo engine), a screen exposes it, AND an automated test covers the behaviour the requirement describes. The evidence MUST name the test (file and test id or test name). |
| `IMPLEMENTED` | Engine and screen exist and the workflow works end to end, but no automated test covers this specific requirement. |
| `PARTIAL` | Some of the requirement works. The note MUST say, in plain words, "Built: … Not built: …". |
| `BLOCKED` | Cannot proceed without something only the owner can provide. Rare. |
| (no entry) | PLANNED — not built. Leave the requirement out of `ENTRIES` and put it in `PLANNED` with a short reason. |

A requirement that lists many capabilities (for example "track A, B, C, D, E") is `PARTIAL` unless ALL of them are
built. Say which are built and which are not. Do not round up. Check every item of every list in the requirement
against the fields and functions that really exist.

A requirement that is a principle (for example "a simulation is never an actual", "integrations that can move money
are high risk") is `TESTED` only when a test asserts it, `IMPLEMENTED` when the code demonstrably behaves that way.

A screen was built for every area, but **a screen alone proves nothing**: open the page file and check that the
control the requirement needs is really there and really calls the engine. Equally, an engine with no screen is at
most `PARTIAL`.

## What exists (verify in the code before you rely on it)

Database (live, Postgres 17): `supabase/migrations/0014_inventory.sql`, `0015_investments_funds.sql`,
`0016_reality_control.sql`, `0017_scenarios_flows.sql`, `0018_platform.sql`. Logic is in schema `numero_private`;
public functions are thin wrappers. The same rules are mirrored in the in-browser demo engine:
`src/api/demoInventory.ts`, `src/api/demoInvest.ts`, `src/api/demoControl.ts`, `src/api/demoPlatform.ts`.
Data contract: `src/api/p3Api.ts`. Types: `src/engine/p3Types.ts`.
Pure engines: `src/engine/stock.ts`, `src/engine/invest.ts`, `src/engine/reality.ts`, `src/engine/twin.ts`,
`src/engine/analysis.ts`, `src/engine/features.ts`.
Loaders: `src/lib/twinData.ts`, `src/lib/realityData.ts`, `src/lib/sandbox.ts`. Sources of proposed entries and
approval entities: `src/lib/workflow.ts`.
NUMI (assistant): `src/numi/p3.ts`. Voice and command routes and the list of sensitive verbs: `src/voice/commands.ts`.
Sample data: `src/api/demoSeedP3.ts` (and the changes in `src/api/demoSeed.ts`).

Screens (all in `src/pages/`): `Inventory`, `InvItem360`, `StockDocEditor`, `StockCount`, `InvUnit360`,
`Investments`, `Holding360`, `Fund360`, `Distribution360`, `Reality`, `Case360`, `Verification360`, `Control`,
`Twin` (+ `TwinParts`), `Sandbox`, `Studio`, `FlowDesigner`, `FlowCase360`, `Notifications`, `Communications`,
`SystemHealth`, `Imports`, `Analysis`, `Features`; changes to `Approvals` (capital calls, distributions),
`ClaimEditor` (travel booking detail), `src/ui/Shell.tsx` (menu, notification bell, capability switches, sandbox bar),
`src/App.tsx` (routes and gates), `src/store/app.ts` (capability switches, sandbox).

Automated tests (all pass):
- `tests/sql/phase3_inventory.sql` — T160 to T189 (30 checks)
- `tests/sql/phase3_investments.sql` — T190 to T212 (23 checks)
- `tests/sql/phase3_control.sql` — T220 to T239 (20 checks)
- `tests/sql/phase3_platform.sql` — T240 to T268 (29 checks)
- `tests/p3.test.ts` (inventory, investments, funds), `tests/p3control.test.ts` (control, platform, twin, reality,
  exposure, invest, analysis), `tests/p3app.test.ts` (sample books, loaders, NUMI, commands, capability switches, sandbox)
Each SQL check has an id and a sentence after it, for example `PASS T186 the stock ledger and the general ledger
agree…`. Read the test files to find which check covers which requirement. Cite ids and test names.

What the people who built the screens reported about each requirement — what the screen does and what it does NOT
do — is in `scripts/_assess/P3_BUILD_NOTES.md`. Treat it as a claim to be checked against the code, not as evidence.

## Facts that are true across Phase 3 (verified; use them, and check anything else)

- Nothing leaves the application: no e-mail, SMS, WhatsApp or push is sent; no bank, tax portal, OCR, speech service,
  language model or GHL system is connected. The integrations register records intent only.
- Nothing runs on a schedule. A person starts every count, run, refresh and simulation.
- The digital twin is arithmetic on monthly rates read from the books. It is not a learned or statistical forecast.
- Manufacturing (bills of material, work in progress) is not built.
- A workflow of the Scenario Studio is started by a person (triggers `manual` and `form`). Other triggers are recorded
  as intent and start nothing. A workflow posts nothing and releases nothing.
- Backups are made by the database provider. NUMERO keeps a record that a person enters.
- Net asset value is an accounting figure from the books of the fund's company; carried interest and waterfalls are
  not computed; there is no investor portal.
- The screens were exercised in the demo (in-browser engine). No screen has been driven against the live database,
  because no account exists there. The database functions themselves are tested directly.

## What you write

One Python file, in exactly the format of `scripts/status_phase2_a.py` (read it first):

```python
# Requirement status — phase 3 — <modules>. Assessed against the code on 2026-09-27.
ENTRIES = [
    # (status, requirement number, evidence, notes)
    ("PARTIAL", 24, "src/pages/Inventory.tsx · src/api/demoInventory.ts · tests/sql/phase3_inventory.sql T166 T167", "Built: … Not built: …"),
]
PLANNED = {
    571: "Manufacturing is not built: no bill of materials, no work in progress, no production order.",
}
```

Rules of the file:
- every requirement of your list appears exactly once, in `ENTRIES` or in `PLANNED`;
- evidence names real files (paths that exist) and, for TESTED, a test with its id or name;
- a PARTIAL note contains both "Built:" and "Not built:";
- notes are plain statements of fact, in the present tense, without praise;
- never the word "fraud".

Validate with `python scripts/check_status_part.py <your status file> <your requirements .md>` until it prints OK.
Do not run the test suites, do not start a server, do not run git.

## Final report

The counts by status, the list of requirement numbers you marked PLANNED with a one-line reason each, and any defect
you noticed in the product while reading the code (a control that calls nothing, a figure with a wrong formula, a
statement on a screen that is not true). Defects matter more than statuses: report each with file and line.
