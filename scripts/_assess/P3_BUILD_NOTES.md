# Phase 3 — what each screen does and does not do (from the builders' reports; for the requirement assessment)

State at the time of writing: DB 18 migration pieces p3_01..p3_18 applied; local files 0014-0018 written; 277/277 DB checks pass (11 suites); 418 app tests pass (8 files).
Screens verified by type-check only until the browser check is done.

## Imports.tsx (947 lines), Analysis.tsx (818 lines) — DONE, tsc clean
- 635 import validation: CSV only (no Excel), max 5,000 rows, SHA-256 fingerprint, column mapping, account-code mapping, 4 checks, every row with error, commit (journals arrive as DRAFTS), discard with reason, sample CSVs. Not: re-map a staged batch; commit takes no reason.
- 1370 parallel run: closing balances only (not movements); per committed file; tolerance; links to ledger. Needs report.view for NUMERO side.
- 476 year on year: from facts store or ledger (source named); part years marked, not scaled; no drill from figure to ledgers; other income/depreciation/finance/exceptional as one net line.
- 479 burn: net burn only (engine has no gross burn); runway formula; window 3/6/12; "No burn" when cash rose.
- 775 statistical detection: median/MAD; latest 5,000 lines; only entries ABOVE usual; no "mark as looked at".
- 608 owner attention: classes open alerts + unread notices; owner_action and critical in full; does not review/close; rules edited under Notifications.
- 1354 compliance view: overdue/this week/this month/later, matrix by company (table), list; cannot know unrecorded deadlines, cannot mark as met.
- 1678 false precision: part years marked, burn refused under 3 months, ESTIMATE marks, partial examination stated.
- 1363 Genesis: belongs to /genesis; only opening balances import touches it.

## Notifications.tsx (468), Communications.tsx (557), SystemHealth.tsx (938) — DONE, tsc clean
- 60 smart emailer: prepare from template with typed placeholders, preview, copy, mailto link, record sent / not sent; templates versioned. Not: sends nothing, no PDF attachment, placeholders not filled from books; only an open sales invoice of the party can be linked.
- 61 notification engine: inbox by class, filters, mark read/unread, refresh (what has fallen due), preference matrix kind x channel with governance kinds locked. Not: no e-mail/push/SMS/WhatsApp delivery; cash-flow warnings and collection-overdue notices are not raised by the engine. Engine raises kinds: approval_waiting, approval_waiting_long, alert, follow_up_assigned, follow_up_due, reconciliation_incomplete, case_assigned.
- 608 attention rules: list/add/replace/remove, order explained; does not reclassify notices already raised.
- 598 / 1277 integrations register: all fields, HIGH RISK, no-secret warning, sandbox-test rule. Connects/tests/calls nothing.
- 592 / 1432 backups: days since last successful backup / restore test, forms; "not recorded" when none. Does not see/make/restore a backup.
- 1429 / 1430 health: one panel per section, counts by state, no score. No AI or API section (engine reports none).
- 1280 observability: maps six items to engine figures; abnormal volumes not measured; failed jobs not connected.
- 1434 / 1535: volumes counted + measured load time of health report; load tests not run.
- 1428 feature flags: group / company / role / company+role, core locked; no per-user switch.
- 1275 data warehouse: per company refresh state, refresh button; totals shown in /analysis.

## Reality.tsx (1028), Case360.tsx (412), Verification360.tsx (354), Control.tsx (733) — DONE, tsc clean
- 575 asset verification: located/transferred/damaged/missing/disposed; note required unless located. Not: scheduling periodic verifications.
- 1385 physical verification: assets, inventory (location), cash, documents; save, complete, summary. Not: cancel a run (no API).
- 1389 confirmations: seven subjects; sent/reply/explain/dispute/unanswered/cancel; investment = quantity. Sends nothing, produces no letter (Communications prepares letters).
- 1454/1460/1468: loadReality; differences most valuable first; drawer with readings side by side. Compares on load, not continuously.
- 1455-1459 five realities: five panels. Not covered: card, wallet, payment gateway, contracts, policies (engine has no readings).
- 1461 exception example: purchase finding shows order/receipt/books/payment/stock readings.
- 1462 reality case: open a case copies readings, explanation, amount, links. Does not add vendor/approvals/documents automatically.
- 1464 health: five gauges, no score; never checked + cannot read beside them.
- 1465 company reality: table per company. 1466 group reality: whole selection row + company filter.
- 1489 preserve: five dimensions separate everywhere.
- 1557 fund movement types: only allocation between units here (others in Cash/Expenses/Treasury).
- 1581 never reclassify to hide: original + new classification, reason, who, when, links; fixed ledgers refused.
- 1676 report reality link: NOT done (reports screens unchanged).
- 1729 flow + reality: advance findings show approval, release, return, evidence, expense.
- 1899 dynamic reality: NOT done (engine has no custom scenario input); case by hand with kind other.
- 482 materiality: threshold per company; % recorded but NOT used in comparison.
- 780 case status: eight statuses; note required; closing needs resolution; reopen recorded; no enforced order.
- 1245 allocation transparency: source, amount, driver, formula, recipients, period before proposing.
- Open question from builder: permission for proposeReclassification (gated on journal.view + (journal.create or allocation.manage)).

## Twin.tsx (801), TwinParts.tsx (1029) — DONE, tsc clean
- 54 scenario lab: any number of assumptions; kinds base/optimistic/conservative/custom; quick starts; everything marked SIMULATION. Not: a question typed in words on this screen (NUMI answers "what if" questions separately).
- 89 digital twin: starts from the books via loadTwin + approved drivers; buy an asset, hire, borrow, raise marketing, lose a customer. Not: "open a new branch", "delay a project" as kinds.
- 427 scenario engine 2.0: all 16 kinds of SHOCK_KINDS. Category shocks only for ledgers that exist.
- 428 comparison: two to four columns via compare(), differences against the first, one cash chart.
- 508: starting point shows ledger, invoices, bills, headcount, loan schedule, open asset orders. Not: budgets, contracts/registers, subscriptions, forecasts combined into the model.
- 815 what if this goes wrong: five adverse presets + one button adding four together; cash, working capital, borrowing requirement, coverage.
- 1285 valuation lab: DCF, multiples, net assets; editable inputs, formulas, intermediate figures; a range, never one number.
- 1295: cash, people, payroll, fixed assets, borrowings, inventory, receivables, payables, tax, commitments. Not: contracts, projects, properties, investments, forecasts as separate items; re-read on load, not continuously.
- 1296 / 1297 multi-shock: assumptions combine; recalculated as they change; all nine shocks of 1297 available.
- 1358 / 1359: one company = company twin, several = group twin; added, not consolidated.
- 1543 real money safety: the screen only reads (apart from saving scenarios/runs/drivers); the requirement itself concerns integrations (register: high risk + sandbox test rule).
- 1798 rule simulation: approval rule tried on past requests (steps counted, roles not compared).
- 1799 false-positive review: threshold tried per alert kind; does not change the real threshold.
- 1901 dynamic twin: drivers library with propose/approve/retire; an assumption can name a driver.
- 1678: simulated amounts rounded, compact; ratios to one decimal.

## Studio.tsx (1339), FlowDesigner.tsx (710), FlowCase360.tsx (514) — DONE, tsc clean
- 1768 dynamic scenario builder: dashboard, workflows, cases; visual designer. Not: branching or parallel steps (the path is a straight line).
- 1769 examples: 19 starting points + empty canvas; roles/register kinds that do not exist are replaced before saving and the person is told.
- 1770 create scenario: trigger, path, form fields, approval steps, documents per step; actors, money flow, accounting, settlement, notifications, NUMI, Sentinel, reports, register kind as TEXT that describes and configures nothing.
- 1771 start trigger: 12 selectable; 10 marked "recorded as intent — starts nothing today". A case starts only from a person.
- 1772 workflow: ordered cards; add/remove/move/edit; nine step kinds; release/settlement/accounting step must point to its record.
- 1809 dashboard: figures listed + step view of one workflow. Not: "overdue evidence" (no due date per step) — shows how long a case has waited.
- 1820 documents by scenario: kinds per step; on the case each required kind attached or missing; checks kind only, not content.
- 1828 clone: dialog + "Clone to change".
- 1826 / 1886 / 1887: only that a workflow can be cloned for a company; cloning a department and department/company customisation belong to Genesis Builder (not built here).
- 1729 flow + reality: a recorded step shows its record as a link with a factual caution; does not reconcile approval, release, evidence, accounting, bank against each other.

## Investments.tsx (1122), Fund360.tsx (930), Holding360.tsx (494), Distribution360.tsx (284) — DONE, tsc clean
- 30 investment / AIF accounting: funds (scheme, structure, manager, fee, capital ledger); investors and commitments; investor statement (screen + CSV); capital calls (% of commitment, preview, submit, approve/reject, money received per line, unit allotments); holdings (buy, sell with gain/loss shown before proposing, income, write-down, valuation); NAV prepare/approve with basis notes; management fee with formula; DPI/RVPI/TVPI with formulas. Not: fund expenses screen (ordinary entries of the fund's company); carried interest / waterfall; redemption or transfer of units; regulator reporting; PDF statements or sending; reversing a posted transaction from these screens (done from the journal).
- 456 dividends / distributions: declaration with entitlement preview; status trail; per holder gross/tax/net; submit, approve/reject; payment to all or chosen holders. Not: per-holder tax rates or tax certificates; cancel button for a draft (no API).
- 561 corporate structure register: indented tree with relation, ownership %, voting %, percentage held through every level; companies outside the tree; register of all links incl. ended; add/edit link with reason; shareholders per company with share of class. Not: drawn chart; tree as of today only; links cannot be deleted (ended by date).
- 1350 group investment map: FlowMap investor -> investee, by-company summary, table of every holding. Not: currency conversion; only active holdings shared with the person.

## Inventory.tsx (1100), InvItem360.tsx (356), StockDocEditor.tsx (869), StockCount.tsx (370), InvUnit360.tsx (384) — DONE, tsc clean
- 24 inventory: items/SKUs, categories, locations, lots, serial numbers, expiry dates, movements with running quantity, valuation (weighted average or FIFO), transfers, both returns, damaged goods as noted conditions, reorder levels, stock ledger against the books. Not: value per location (engine keeps value on the item); barcodes, price lists, unit conversions; dimensions on stock documents not editable.
- 28 medical machinery: unit page with manufacturer, model, serial, supplier, import details, purchase cost, landed cost, sale invoice, installation, warranty, service contract link, customer location, service history with cost split. Not: warranty provision or service revenue calculation; a spare-part event takes nothing out of stock; import details entered on the unit page after receipt.
- 29 wellness / medicines: lot numbers, manufacture and expiry dates with days left, supplier per lot, returns, expired and damaged stock, tax code and HSN, link from issue to invoice. Not: regulated pharmaceutical compliance.
- 153 multiple offices: stock locations only (six kinds, linked to a branch/site/office, address, keeper).
- 568 physical stock count: freeze or snapshot, blind count by default, save progress, complete, add stock found, review or recount by a second person, propose adjustment, cancel. Not: separate sheets for several counters.
- 570 stock loss: every adjustment line carries a reason; loss reaches books only through an approved entry; posted loss by reason for the period.
- 571 manufacturing: NOT BUILT (no engine, no screen).
- 573 landed cost: charges (name, amount, ledger, party), shared by value/quantity/weight; ESTIMATE preview; actual share that joined stock vs expensed. Not: foreign currency charges; linking a charge to a vendor's bill.
- 700 loss exposure: seven headings marked EXPOSURE beside posted loss marked ACTUAL; note a condition, release, write off through adjustment. Not: changing the 60-day near-expiry window or 180-day slow-moving default.
- 1387 inventory verification: book vs physical line by line via counts; assets/cash/documents verification is under Reality.

## Written by the lead (not by a builder)
- Sandbox.tsx + src/lib/sandbox.ts + store (634, 1423, 1424, 1425, 1838): copy of configuration + balances in browser memory; every screen works on the copy; act as preparer/approver; exports marked -SANDBOX; tests in tests/p3app.test.ts "the sandbox". Not: copies no history of transactions, no salaries, no confidential records, no documents; integrations cannot be tried (none connected).
- Features.tsx + src/engine/features.ts (1503): inventory of 50+ capabilities by area with state and limits; requirement counts by module from the ledger.
- Capability switches in menu and routes (1428): src/store/app.ts capOn, src/App.tsx Need cap=, src/ui/Shell.tsx.
- Notification bell + refresh on arrival (61): src/ui/Shell.tsx.
- Approvals inbox: capital calls and distributions (30, 456): src/pages/Approvals.tsx.
- Travel booking detail on a claim line (199-202; 200 TRAIN / BUS is Phase 3): src/pages/ClaimEditor.tsx; DB check_travel_detail T265; air, train, bus, cab, hotel with operator, booking reference, origin, destination, class, fare parts (base fare, taxes, booking charges…).
- Generator / backup power (304): register kind `generator` in src/engine/registerKinds.json (fields as in the json), org unit type equipment; T265.
- NUMI Phase 3 intents: src/numi/p3.ts; voice routes and sensitive verbs: src/voice/commands.ts; tests in tests/p3app.test.ts.
- Command Centre strip "Beside the ledger": src/ui/HomeBeyond.tsx.

## Defects reported by the assessor of part B (Digital Twin), 27 Sep — each to be corrected or recorded
1. local migrations lag p3_19..p3_21 -> re-extract. 2. standardCases: supplier payment delay inverted. 3. NUMI what-if patterns (collections delayed N days; top 3 customers; says what it left out). 4. sandbox trail lists the build's own entries. 5. twin in sandbox has no history to average. 6. "the same engine" wording on live books. 7. start_flow_case permission (flow.view in DB, flow.manage on screen). 8. driver unit not checked against the assumption. 9. test title claims more than it asserts (p3app twin). 10. a partial selection saved as "the group". 11. rule trial adds currencies.

## Defects reported by the assessor of part A (Inventory, Investments, System Health, Integrations), 27 Sep
A1 local migrations lag (same as B1). A2 SystemHealth.tsx:289 says no list is shortened in silence; supabaseP3.ts caps lists (and the API caps at 1,000 rows). A3 InvUnit360.tsx:82 reads newest 2,000 movements of the item then filters by lot. A4 InvItem360.tsx:69 truncation warning tests >= 5000. A5 slow-moving clock resets on transfer (0014:1309 transfer_in counted as last_in; stock.ts:107). A6 fundSummary committed over active only, called/contributed/distributed over all. A7 future-dated stock documents accepted. A8 permission mismatches: Communications.tsx:55 invoice.view; features.ts sandbox perm; Investments.tsx:529 corporate link save gate. A9 system_health stock check skips a stock ledger without items (0018:920).
