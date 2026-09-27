# Brief: assessing requirement status honestly (GHL NUMERO, Phase 2)

Project root: `C:\Users\GIO4X\Documents\GHL NUMERO`.

GHL NUMERO is built from a master specification of 1,916 numbered requirements. The specification has a binding
"Zero-Omission Directive": **never claim something is complete when it is not; a screen without an engine is not
complete; a TODO is not an implementation; nothing may be silently dropped.** The requirement ledger is the record
the owner relies on. An over-claimed status is a defect. An under-claimed status is only a small loss. When in doubt,
choose the lower status and say exactly what is missing.

Your task is to ASSESS and RECORD. You do not write product code. You read the requirement, find the code and tests
that implement it, and record a status with evidence.

## Status rules (exact)

| Status | Meaning |
|---|---|
| `TESTED` | The engine exists (database function and/or demo engine), a screen exposes it, AND an automated test covers the behaviour the requirement describes. The evidence MUST name the test (file and test id or test name). |
| `IMPLEMENTED` | Engine and screen exist and the workflow works end to end, but no automated test covers this specific requirement. |
| `PARTIAL` | Some of the requirement works. The note MUST say, in plain words, "Built: … Not built: …". |
| `BLOCKED` | Cannot proceed without something only the owner can provide. Rare. |
| (no entry) | PLANNED — not built. Leave the requirement out of `ENTRIES` and put it in `PLANNED` with a short reason. |

A requirement that lists many capabilities (for example "the system must support A, B, C, D, E") is `PARTIAL`
unless ALL of them are built. Say which are built and which are not. Do not round up.

A requirement that is a principle (for example "an advance is not an expense", "AI must never move money") is
`TESTED` only when a test asserts it, `IMPLEMENTED` when the code demonstrably behaves that way.

## What exists (verify in the code before you rely on it)

Database (live, Postgres): `supabase/migrations/0006_…` to `0010_…`. Logic is in schema `numero_private`; public
functions are thin wrappers. The same rules are mirrored in the in-browser demo engine
(`src/api/demoCore.ts`, `src/api/demoOps.ts`, `src/api/demo.ts`). The data contract is `src/api/opsApi.ts`.
Types: `src/engine/opsTypes.ts`. Pure engines: `src/engine/forward.ts`, `src/engine/ops.ts`.
Register kinds (50, data-driven): `src/engine/registerKinds.json`.

Screens (all in `src/pages/`): `Forward`, `Registers`, `Register360`, `Tasks`, `Inbox`, `Expenses`, `ClaimEditor`,
`Advance360`, `Cash`, `Assets`, `Asset360`, `Purchasing`, `PurchaseEditor`, `PurchaseDetail`, `Treasury`, `Loan360`,
`Payroll`, `PayrollRun`, `PeopleCost`, plus changes to `Approvals` (all approval entities, workflow journals),
`Accounts` (Account mapping tab, `src/ui/AccountMapping.tsx`), `DocumentEditor` (purchase order link with
three-way comparison, promises to pay, attachments, custom fields), `Party360` (Operations tab,
`src/ui/PartyOperations.tsx`), `JournalDetail` (source record of a proposed entry, attachments).
Shared parts: `src/ui/ops.tsx`, `src/ui/records.tsx`, `src/lib/workflow.ts`, `src/lib/forwardData.ts`.
NUMI (assistant) operations answers: `src/numi/ops.ts`. Voice and command routes: `src/voice/commands.ts`.

Automated tests:
- `tests/sql/phase2_flow.sql` — T29 to T81 (53 checks, all pass)
- `tests/sql/phase2_treasury_purchasing.sql` — T82 to T109 (28 checks, all pass)
- `tests/sql/phase2_payroll.sql` — T110 to T129 (20 checks, all pass)
- `tests/ops.test.ts` (43), `tests/forward.test.ts` (19), `tests/numiOps.test.ts` (62), plus Phase 1
  `tests/engine.test.ts` (35), `tests/commands.test.ts` (62). All 224 pass.
Each SQL check has an id and a sentence after it, for example `PASS T92 a deposit under lien cannot be closed…`.
Read the test files to find which check covers which requirement. Cite ids.

Workflows exercised end to end through the screens in the browser (demo mode) — these support `IMPLEMENTED`:
advance request → approval with a lower amount → release proposed → entry approved and posted → claim against the
advance with policy flags → line-level approval with reduced amount → entry approved → advance partly settled;
purchase order → approval → goods receipt of part → three-way comparison; payroll run calculated → entry proposed →
two-step approval → posted; depreciation month calculated; loan instalment proposed; fixed deposit closure proposed
with live interest calculation; cash count with denominations; fund transfer; register item created with
kind-specific fields and shown in its 360° page; document upload with duplicate detection; follow-up created and
closed with an outcome; asset disposal preview; approvals inbox for an advance and for proposed entries; NUMI
answers on advances, cash ahead and the salary refusal.

## What is known NOT to exist (do not claim any of these)

- Reading document contents: OCR, extraction of fields from invoices or receipts, email intake, WhatsApp intake,
  scanning. Documents are stored, fingerprinted (SHA-256), classified and linked BY A PERSON. A file-name
  suggestion exists and is labelled SUGGESTION.
- Any movement of money, bank API, payment gateway, payout file. By design NUMERO records that money moved.
- Notifications leaving the application: email, SMS, WhatsApp, push, reminders, escalation timers. Warnings and
  follow-ups are shown inside the application only.
- Scheduled or automatic runs (cron): recurring invoices, automatic depreciation each month, automatic accruals.
  A person starts each run.
- Statutory calculation engines (provident fund, ESI, professional tax, income-tax slabs, TDS sections, gratuity
  formulas). Amounts are whatever the company records in the salary structure or adjustment.
- Payslip documents, attendance, leave, timesheets, recruitment.
- Corporate card feeds or statement import for cards; mileage and per-diem rate engines.
- Hard budget limits that block a transaction. Budget context on a purchase order is information only.
- Exchange-rate providers; conversion of register items, advances and claims into a base currency (they carry a
  currency but no rate).
- Statistical or machine-learning forecasting, scenario simulation, what-if modelling. Forward projects from
  recorded documents and registers only; the only estimate is the customer's usual payment delay
  (`paymentBehaviour`), labelled ESTIMATE.
- Drag-and-drop form builder, workflow builder, formula builder, custom report builder, custom dashboards,
  custom roles editor.
- A live file upload to Supabase Storage and a live sign-in were NOT exercised (no account exists yet). The code
  path exists (`src/api/supabase.ts`); say "not exercised against the live system" where it matters.
- Microphone capture was not exercised.

If you believe one of these does exist, show the file and line in your note. Otherwise treat it as not built.

## How to work

1. Read your requirement file (path below). It lists each requirement: number, module, title, text.
2. For each requirement, search the code (Grep) for the capability. Read the function, not just its name.
3. Decide the status by the rules above. Write evidence as short references a person can open:
   `tests/sql/phase2_flow.sql T41 · src/pages/Advance360.tsx · numero_private.release_advance`.
4. Notes are plain, precise English. No marketing words. For `PARTIAL` always "Built: … Not built: …".
5. Do not edit any file except your output file. Do not run git. Do not start servers. Do not modify tests.

## Output

Write ONE Python file (path below) of exactly this shape, valid Python, UTF-8:

```python
# Requirement status — phase 2 — <your modules>. Assessed against the code on 2026-09-27.
ENTRIES = [
    # (status, requirement number, evidence, notes)
    ("TESTED", 131, "tests/sql/phase2_flow.sql T44 · src/pages/Advance360.tsx", "An advance is recorded as money held by a person; the expense ledger is untouched until a claim is approved."),
    ("PARTIAL", 132, "src/pages/ClaimEditor.tsx · numero_private.save_claim", "Built: … Not built: …"),
]
PLANNED = {
    # requirement number: why it is not built
    140: "Reading receipts automatically (OCR) is not built.",
}
```

Every requirement in your file must appear exactly once, in `ENTRIES` or in `PLANNED`. At the end, run
`python <your output file>` to prove it parses, and run the check script given below; fix what it reports.

## Final report

Reply with: counts by status; the five requirements you were least certain about and why; anything in the code
that contradicts the specification or looks wrong (file and line). Do not pad the report.
