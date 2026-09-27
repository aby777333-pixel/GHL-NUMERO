# Requirement status — phase 2 — Genesis Builder, Treasury, Payroll, Assets. Assessed against the code on 2026-09-27.
#
# Rules applied: TESTED only where a named automated test covers the behaviour; a requirement that lists
# several capabilities is PARTIAL unless every one is built; a field that records a choice but drives
# nothing is not an engine. Where there was doubt, the lower status was chosen.
#
# Records corrected on 2026-09-27 after the review corrections (scripts/_assess/CORRECTIONS.md):
# 32, 361, 454, 544, 547, 549, 555, 574, 689, 695, 1199, 1204, 1205, 1495, 1758, 1761, 1808, 1915.

M6 = "supabase/migrations/0006_workflow_registers_documents.sql"
M7 = "supabase/migrations/0007_assets_purchasing.sql"
M8 = "supabase/migrations/0008_expenses_advances_cash.sql"
M9 = "supabase/migrations/0009_treasury_payroll.sql"
T1 = "tests/sql/phase2_flow.sql"
T2 = "tests/sql/phase2_treasury_purchasing.sql"
T3 = "tests/sql/phase2_payroll.sql"
OPS = "tests/ops.test.ts"
FWD = "tests/forward.test.ts"
NUMI = "tests/numiOps.test.ts"
KINDS = "src/engine/registerKinds.json"
M11 = "supabase/migrations/0011_review_corrections.sql"  # corrections made after the first assessment
C11 = "tests/sql/phase2_corrections.sql"  # T130 to T149

ENTRIES = [
    # (status, requirement number, evidence, notes)

    # ------------------------------------------------------------------ GENESIS BUILDER
    ("PARTIAL", 5,
     f"src/pages/Registers.tsx (Register kinds) · {M6} register_kinds, save_register_item · src/pages/Register360.tsx · {T1} T70–T73",
     "Built: a Group Super Admin can define a new kind of record (a register kind) with its own fields, reference prefix, category and optional "
     "cost-tracking dimension. Records of that kind can be created, edited, searched, given documents and follow-ups, and they appear in Forward. "
     "T70–T73 test the register engine on the supplied kinds. Not built: relationships between custom records, a form designer, workflows, approvals, "
     "accounting mappings, reports, dashboards, APIs and permissions per custom module. No automated test covers creating a kind."),
    ("PARTIAL", 157,
     "src/pages/Genesis.tsx (Party types) · src/pages/Party360.tsx (Add relationship)",
     "Built: a Group Super Admin can add any number of party types without code; a party type is the relationship between a party and a company "
     "(customer, vendor, broker and so on). Not built: relationship types between two parties (works for, introduced by, referred by, owns, "
     "parent company of, and the rest of the list). No table or screen holds a party-to-party relationship."),
    ("PARTIAL", 361,
     f"src/pages/Expenses.tsx (Categories) · src/pages/Accounts.tsx · src/pages/Genesis.tsx · src/pages/Registers.tsx (Register kinds) · src/pages/Payroll.tsx · src/ui/ApprovalRuleEditor.tsx · src/ui/ops.tsx (CustomFields) · {T1} T70 · {OPS} 'policy flags inform the approver and never reject on their own'",
     "Built: all of the following without coding — expense categories (covers expense and entertainment types), revenue ledgers in the chart of accounts, party types, "
     "departments, offices, cost centres and projects (organisation units and new structure levels), incident types and subscription plans "
     "(options of a register kind, edited by a Group Super Admin), utilities (register items), allowances (freely named salary components), "
     "approval rules (kind of record, company, amount band and steps by role, added and changed on the Approvals page), custom fields "
     "(defined in Genesis; those defined for invoices and bills, register items, fixed assets and parties appear on those records, where "
     "their values are entered). Not built: new confidentiality levels (the five levels are fixed in the database); an approval workflow "
     "beyond such a rule (conditions other than amount, steps taken side by side); custom fields on journals, payments, organisation units "
     "and companies, which can be defined but are shown on no screen. The approval rule editor and the custom fields on a party were read "
     "in the code; neither has an automated test."),
    ("PARTIAL", 509,
     "src/ui/DataTable.tsx · src/pages/ReportView.tsx · src/pages/Ledger.tsx · src/pages/Home.tsx · src/ui/charts.tsx",
     "Built: filters and search on every list, sorting, comparison of the profit and loss with the previous period, charts, drill-down from a "
     "figure to the ledger and the journal, CSV export of the rows in the current filter. Not built: pivot-style analysis, grouping chosen by "
     "the user, formulas, custom reports, Excel (xlsx) export."),
    ("PARTIAL", 1495,
     f"src/pages/Genesis.tsx · src/pages/Registers.tsx (Register kinds) · src/pages/Expenses.tsx (Categories) · src/pages/Assets.tsx (Categories) · src/pages/Companies.tsx · src/ui/ApprovalRuleEditor.tsx · src/pages/Approvals.tsx · {T3} T127–T128",
     "Built: custom field definitions and values (values tested in T127–T128), custom record kinds (register kinds), custom categories "
     "(expense and asset categories), approval rules by kind of record, company and amount, added and changed on the Approvals page by a "
     "Group Super Admin or a holder of the permission approval.configure, a new company created by cloning an existing one. Not built: "
     "custom workflows, custom reports, custom dashboards, custom roles, custom formulas, company templates defined by the Super Admin."),
    ("PARTIAL", 1572,
     f"src/pages/Expenses.tsx (Categories) · numero_private.save_expense_category · src/pages/ClaimEditor.tsx · {T1} T48–T49 · {OPS} 'policy flags inform the approver and never reject on their own'",
     "Built: expense categories are data. For each category an authorised person sets the name, the ledger it posts to, the limit per item and "
     "per day, the amount above which a receipt is expected, the maximum age of an expense and guidance text. The policy flags are tested. "
     "Not built: subcategories, tax treatment, default department or cost centre, approval route and confidentiality per category."),
    ("PARTIAL", 1573,
     "src/pages/Entry.tsx · src/pages/ClaimEditor.tsx · tests/engine.test.ts 'uses learned, explainable preferences first'",
     "Built: in the Transaction Centre NUMI proposes a ledger from classifications a person approved earlier (tested). Not built: search inside "
     "the category or ledger selector, recent categories, frequently used categories, favourites, a hierarchy in the selector. The selectors "
     "are plain lists."),
    ("PARTIAL", 1737,
     "src/pages/Genesis.tsx · src/pages/Registers.tsx (Register kinds) · src/ui/AccountMapping.tsx · src/pages/Expenses.tsx · src/pages/Assets.tsx",
     "Built: a Genesis Builder screen for structure levels and units, custom field definitions with versions, party types, tax codes with dated "
     "rates, learned rules and controls; register kinds with their own fields; expense and asset categories; the account mapping. Not built: "
     "form builder, workflow builder, status builder, rule and formula builder, report and dashboard builder, menu and page builder, custom "
     "roles editor, conditional field rules."),
    ("PARTIAL", 1742,
     f"{KINDS} (kind 'path') · src/pages/Registers.tsx · src/pages/Register360.tsx · {M6} save_register_item · src/pages/ClaimEditor.tsx · src/pages/Expenses.tsx",
     "Built: a financial path is a register item of the kind Financial Path. Any number can be created without code; each gets its own "
     "cost-tracking dimension, and an advance or an expense claim can be linked to it. The list of path types can be extended by a Group Super "
     "Admin. Not built: a path builder. A path does not decide who may use it, where money may come from or go, which workflow or approval "
     "applies, or how it is accounted. No automated test creates a path."),
    ("PARTIAL", 1743,
     f"{KINDS} (kind 'path') · src/pages/Register360.tsx · {M6} save_register_item",
     "Built: a path records its type, purpose, monthly limit, the evidence expected and the settlement rule, and its required fields are enforced; "
     "spending tagged to its dimension is totalled on its page. Not built: who can use it, allowed sources and destinations of money, who "
     "approves, how it is accounted, how it is settled, how it is reported, what NUMI should watch. The monthly limit, evidence rule and "
     "settlement rule are recorded as text and nothing applies them."),
    ("PARTIAL", 1744,
     f"{KINDS} (kind 'path', type Personal) · src/pages/Registers.tsx · src/ui/ops.tsx (Attachments)",
     "Built: a path of type Personal with person (party), purpose, amount, company and attached evidence. A Group Super Admin can add further "
     "fields to the kind. Not built: as supplied fields, funding source, recoverable or not, company expense or not, director or employee account, "
     "approval and settlement on the path. The accounting treatment is decided on each journal, not by the path."),
    ("PARTIAL", 1745,
     f"{M6} propose_posting, register_items · {T1} T47 · {T3} T122",
     "Built: a path is a label and a cost dimension only. It cannot post, hide or reclassify an entry; every entry is a journal approved by a "
     "second person. Money given to a person is held as an advance and is not an expense (T47). Confidential entries stay inside the totals "
     "(T122). Not built: any check that is specific to a personal path, such as a director or employee account treatment or a Sentinel rule on "
     "spending tagged to a personal path."),
    ("PARTIAL", 1746,
     f"src/pages/Cash.tsx · {M8} cash_boxes, record_cash_count · src/pages/ClaimEditor.tsx · {T1} T62–T63",
     "Built: petty cash boxes with custodian, ledger, float, minimum balance and unit; cash counts (tested T62–T63); expense claims with "
     "purpose, amount, receipt, department, project and category. Not built: a petty path that ties the cash box to its spending and asks for "
     "these items as one configured form; a settlement date on petty spending."),
    ("PARTIAL", 1747,
     f"{KINDS} (kind 'trip') · src/pages/Expenses.tsx · src/pages/ClaimEditor.tsx · src/pages/Advance360.tsx · {T1} T42–T58",
     "Built: a Trip register item (traveller, from, to, purpose, mode, daily allowance), an advance and an expense claim linked to the trip, claim "
     "lines by category with receipts, and settlement of the advance (tested T42–T58). Not built: a configured travel path that requires these "
     "items; flight, hotel, taxi and meals are claim lines under categories the company defines, not fields of the path."),
    ("PARTIAL", 1748,
     f"{KINDS} (kinds 'path', 'work_order') · src/pages/Registers.tsx · src/pages/Register360.tsx",
     "Built: a path of type Site and a Work Order register item (work completed, certified, retention, cost to complete) with a project "
     "dimension, party (contractor) and documents. Not built: site manager, material, labour and work reference as fields supplied with the "
     "path; a configured form that requires them."),
    ("PARTIAL", 1749,
     f"{KINDS} (kinds 'path', 'csr_donation') · src/pages/Registers.tsx",
     "Built: a path of type Charity and a CSR / Donation Commitment register item with recipient (party), purpose, amount, approval reference "
     "and attached evidence. Not built: tax treatment and initiative as fields; an approval step on the commitment itself."),
    ("PARTIAL", 1750,
     f"{KINDS} (kinds 'path', 'incident', 'exception') · src/pages/Registers.tsx · src/pages/Tasks.tsx",
     "Built: a path of type Emergency; an Incident and an Exceptional Transaction register item with type, reason, amount, reported by, "
     "approved by, evidence and follow-ups. Not built: an emergency approver route and a final classification step."),
    ("PARTIAL", 1751,
     f"{KINDS} (kind 'path') · src/pages/Registers.tsx",
     "Built: a person with the register permission creates a path such as 'VIP client hospitality' without a developer; it gets a reference, a "
     "cost dimension and its own page. Not built: the path carries no workflow, approval, accounting or settlement behaviour of its own."),
    ("PARTIAL", 1752,
     f"{KINDS} (kind 'path') · src/pages/Registers.tsx (Register kinds) · {M6} register_items",
     "Built: name (title), code (reference number), description (purpose and notes), company, fields (defined on the kind), evidence and "
     "settlement (recorded choices), confidentiality, owner. Not built: icon, department scope, allowed users, transaction types, source "
     "accounts, destination types, forms, approval, accounting, reports, alerts, NUMI rules."),
    ("PARTIAL", 1758,
     "src/pages/Registers.tsx (Register kinds, DynamicField) · src/pages/Genesis.tsx (Custom fields) · src/ui/ops.tsx (CustomFields) · src/ui/PartyOperations.tsx",
     "Built: a Group Super Admin adds a dropdown field with its options to a register kind, and the field appears as a dropdown on items of that "
     "kind. A dropdown custom field with options can be defined in Genesis for invoices and bills, register items, fixed assets and parties, "
     "and appears as a dropdown under 'Additional information' on those records (for a party, on its Operations tab). Not built: changing "
     "the options of the dropdowns that are part of the supplied screens; a dropdown custom field on journals, payments, organisation units "
     "and companies (Genesis accepts the definition and labels it 'not yet shown on its screen'); a multi-select field is shown as a "
     "dropdown that takes one value. No automated test covers dropdown options."),
    ("PARTIAL", 1761,
     "src/pages/Registers.tsx (Register kinds) · src/pages/Genesis.tsx (Custom fields) · src/ui/ops.tsx (CustomFields)",
     "Built: a Group Super Admin adds an option to a dropdown field of a register kind without code; the change is written to the audit trail. "
     "A holder of the permission field.configure adds an option to a dropdown custom field in Genesis, which saves a new version of the "
     "field; on invoices and bills, register items, fixed assets and parties the new option is then offered. Not built: adding options to "
     "the supplied dropdowns; any approval of a new option. No automated test covers adding an option."),
    ("PARTIAL", 1787,
     f"src/pages/Registers.tsx (Register kinds) · {M6} register_kinds · src/api/supabase.ts saveRegisterKind",
     "Built: a Group Super Admin creates a new kind of business object (for example Grant, Membership, Campaign) with a key, name, category, "
     "direction of money, default certainty, reference prefix, fields and an optional cost dimension. Items of the kind can then be recorded. "
     "Not built: accounting behaviour, approval, statuses or relationships of the new object. No automated test covers creating a kind."),
    ("PARTIAL", 1789,
     f"src/ui/AccountMapping.tsx · numero_private.set_account_map · {T2} T82–T83 · src/pages/Expenses.tsx (Categories) · src/pages/Assets.tsx (Categories)",
     "Built: the account mapping (ledger role to ledger) edited on screen and tested (T82–T83); expense category to ledger; asset category to "
     "its three ledgers. Not built: mapping by scenario, by path or by transaction type."),
    ("PARTIAL", 1792,
     f"src/pages/Expenses.tsx (Categories) · numero_private.save_claim · {OPS} 'policy flags inform the approver and never reject on their own' · {T1} T70",
     "Built: for each expense category the company sets the amount above which a receipt is expected; a line without one is flagged EVIDENCE "
     "MISSING for the approver (tested). Required fields of a register kind are enforced (T70). Not built: evidence rules by path or scenario, "
     "rules that name the kind of document required, rules that make evidence mandatory rather than flagged."),
    ("PARTIAL", 1802,
     f"src/pages/Registers.tsx · src/pages/Register360.tsx · {M6} audit_register_kinds, audit_custom_values · src/engine/forward.ts",
     "Built: a new register kind is available in the register list, its search and filters, the CSV export of the list, Forward, the audit "
     "trail and follow-ups. Custom field values are written to the audit trail. Not built: reports, NUMI answers, API, permissions and "
     "workflow for custom kinds and custom fields."),
    ("PARTIAL", 1808,
     f"src/pages/Register360.tsx · src/pages/Cash.tsx · {C11} T135",
     "Built: every path, trip and event has its own page with what is recorded, its schedule, the entries posted against its dimension with "
     "totals, the expense claims and advances linked to it with their amount and status, documents and follow-ups. The entry of a linked "
     "claim or advance carries the dimension of the item (T135, tested on a trip). Petty cash boxes show float, book balance and cash "
     "counts. Not built: a path dashboard with today's spend, missing receipts, unsettled amounts and top categories."),
    ("PARTIAL", 1821,
     f"src/pages/Registers.tsx (Register kinds) · {M6} register_sequences · {T1} T71",
     "Built: the reference prefix of a register kind is set by a Group Super Admin; items are numbered PREFIX-00001 per company (T71). "
     "Not built: numbering patterns with company code, year or path; changing the numbering of invoices, journals, advances, loans and other "
     "supplied documents."),
    ("PARTIAL", 1823,
     "src/pages/Companies.tsx · src/engine/templates.ts",
     "Built: a new company can be created by cloning the chart of accounts and units of an existing company, or from one of the supplied "
     "templates. Not built: a Super Admin cannot save a named, reusable company template; the templates are part of the program."),
    ("PARTIAL", 1853,
     f"{M6} audit_register_items · {M8} audit_advances, audit_expense_claims · src/pages/Register360.tsx · src/pages/Audit.tsx",
     "Built: every change to a path record, and to the path linked on an advance or claim, is kept in the audit trail with the old and new "
     "values, the user and the date, and the reason when one was entered. Not built: a required reason for a change of path; a history of "
     "path changes shown as such; moving a posted entry from one path to another."),
    ("PARTIAL", 1854,
     "src/pages/Accounts.tsx · src/pages/Genesis.tsx (Structure)",
     "Built: the chart of accounts is a hierarchy of headings and ledgers to any depth; organisation units have levels defined by the group and "
     "a parent unit. Not built: a classification tree for categories (expense categories are a flat list); a single money tree that joins "
     "category, path and ledger."),
    ("PARTIAL", 1860,
     f"{M6} register_items.owner_name, tasks · src/pages/Registers.tsx · src/pages/Tasks.tsx",
     "Built: every register item (including a path) and every follow-up carries an owner; an item without one is marked 'no owner recorded'. "
     "Not built: an owner on departments, scenarios, workflows, categories, forms and reports."),
    ("PARTIAL", 1861,
     f"src/engine/forward.ts earlyWarnings · src/pages/Expenses.tsx · {FWD} 'early warnings state facts, rules and assumptions'",
     "Built: each advance carries an expected settlement date; an advance unsettled past that date (or 30 days after release when none was "
     "recorded) raises a warning (tested). Expense categories carry a maximum age in days. Not built: configurable service-level rules such as "
     "'settle within 7 days after the trip'; the 'settle within (days)' field of a path is recorded and nothing applies it."),
    ("PARTIAL", 1863,
     "src/pages/Expenses.tsx (Categories) · src/pages/ClaimEditor.tsx",
     "Built: guidance text on an expense category, shown to the person entering a claim line. Not built: help text on custom fields, on the "
     "fields of a register kind, or on forms."),
    ("PARTIAL", 1877,
     f"{M6} register_kinds_write policy, save_custom_values, audit triggers · {T3} T127–T128 · {T2} T82 · {T1} T80",
     "Built: configuration is limited by permission (register kinds by the Group Super Admin only), written to the audit trail, kept inside "
     "the group (row level security on every table, T80), checked for required information (T127) and unable to post to the ledger. "
     "Not built: approval of a configuration change before it takes effect; evidence attached to a configuration change."),
    ("PARTIAL", 1903,
     f"{KINDS} (kind 'path') · src/pages/Registers.tsx · src/pages/Register360.tsx · src/pages/ClaimEditor.tsx",
     "Built: paths as records with their own cost dimension, to which advances, claims and journal lines can be tagged. Not built: a money "
     "path engine. A path has no rules that are applied to a transaction."),
    ("IMPLEMENTED", 1909,
     f"{M6} propose_posting, set_account_map, save_custom_values · {T2} T82–T83, T86 · {T1} T33 · {T3} T128",
     "What can be configured today (register kinds, custom fields, categories, account mapping) cannot post to the ledger or bypass approval: "
     "the account mapping accepts only active posting ledgers (T82), custom values are stored against defined fields only (T128), a journal "
     "proposed by an operation cannot be edited by hand (T33) and is subject to maker-checker (T86). No test states the principle as a whole. "
     "Most of the no-code builder is not built, so the principle covers only the configuration that exists."),
    ("PARTIAL", 1915,
     "src/pages/Companies.tsx · src/pages/Genesis.tsx · src/pages/Registers.tsx · src/pages/Expenses.tsx · src/pages/Assets.tsx · src/ui/ApprovalRuleEditor.tsx",
     "Built: without coding, a company, a department, a sub-department, a path (as a register item), a category, a field (shown and filled "
     "in on invoices and bills, register items, fixed assets and parties; on other record types it can be defined and is shown nowhere), "
     "an approval route (a rule by kind of record, company and amount with its steps by role, added and changed on the Approvals page). "
     "Not built: a scenario, a form, a document type, a workflow, a status, a rule, a "
     "calculator, a report, a dashboard, an automation, a NUMI rule (learned rules can only be disabled), a Sentinel rule (two thresholds "
     "only), a template."),

    # ------------------------------------------------------------------ TREASURY
    ("PARTIAL", 22,
     f"src/pages/Treasury.tsx · src/pages/Loan360.tsx · {M9} · {T2} T84–T93 · {OPS} 'loan schedule, disbursement and instalments in order' · {FWD} 'loan position and debt ladder'",
     "Built: cash and bank positions by company and ledger, fixed deposits, loans taken and given with interest, payment obligations on loans, "
     "a liquidity ladder, forex exposure from open documents, and totals across the selected companies of the group (not converted when the "
     "companies keep different currencies). Not built: investments other than fixed deposits."),
    ("PARTIAL", 33,
     f"{M9} loans, loan_schedule, disburse_loan, pay_loan_instalment · src/pages/Loan360.tsx · {T2} T84–T90 · {OPS} 'loan schedule, disbursement and instalments in order'",
     "Built: lender or borrower, principal, rate, tenure, instalment (equal instalments, equal principal or bullet), security "
     "(text), disbursement, repayment in order, principal outstanding, repayment schedule; all tested. Not built: interest accrued but not yet due. "
     "Interest reaches the books only when an instalment is recorded."),
    ("PARTIAL", 103,
     "src/ui/PartyOperations.tsx · src/pages/Party360.tsx · src/pages/PeopleCost.tsx · src/pages/Ledger.tsx",
     "Built: for a person, the advances, expense claims, loans and register items that name them, the ledger entries recorded against them, "
     "and (for holders of the payroll permission) salary, variable pay, employer cost and direct costs. Not built: one employee financial "
     "ledger that joins these; company assets issued, corporate cards and petty cash held shown on the person's page; final settlement."),
    ("PARTIAL", 293,
     f"{KINDS} (kind 'event') · src/pages/Register360.tsx",
     "Built: a seminar is an Event register item (type, venue, number attending, purpose, organiser as party) with its own cost dimension; "
     "the page totals every posted entry tagged to it, which is the total seminar cost when entries are tagged. Not built: the employees "
     "attending as a list; registration fees, travel, hotel, food, transport, materials and sponsorship as separate figures."),
    ("PARTIAL", 338,
     f"{KINDS} (kinds 'bad_debt', 'write_off', 'recovery') · src/pages/Registers.tsx",
     "Built: register items for a doubtful debt (customer, invoices concerned as text, provision, assessment), a write-off request "
     "(justification, recovery efforts, approved by, journal reference, recovered afterwards) and a recovery case. Invoices are never deleted, "
     "so the receivable history stays. Not built: a link to the invoice record, original, recovered and written-off amounts drawn from the "
     "books, and an approval step; the write-off itself is a manual journal."),
    ("PARTIAL", 430,
     "src/pages/Home.tsx · src/pages/ReportView.tsx (Financial Health) · src/engine/reports.ts",
     "Built: working capital as a figure on the Command Centre, and receivable days, payable days, inventory days and the cash conversion "
     "cycle with their formulas. Not built: a working capital dashboard; trends of receivables, inventory, payables and working capital."),
    ("PARTIAL", 452,
     f"{M9} · src/pages/Loan360.tsx · {T2} T85, T88–T90",
     "Built: principal, interest, instalment, repayment, outstanding principal, all tested; the interest the lender actually charged can replace "
     "the scheduled figure (T90). Not built: accrued interest; reconciliation of the loan with the lender's statement."),
    ("PARTIAL", 453,
     f"{M9} build_loan_schedule, save_fixed_deposit · src/pages/Calculators.tsx · {T2} T85, T91",
     "Built: reducing balance (loan schedule, T85), simple and compound interest (fixed deposit maturity value, T91), with the formulas shown in "
     "the calculators. Not built: custom contractual calculations; the formula of the maturity value is not shown on the deposit itself."),
    ("PARTIAL", 454,
     f"{M9} loans.kind · src/pages/Treasury.tsx · {KINDS} (kinds 'capital_infusion', 'dividend') · {T2} T84",
     "Built: loans from and to directors, and from and to shareholders (both kinds are offered on the loan screen), as loans in their own "
     "liability or asset ledger, apart from expenses (T84: a loan taken must sit in a liability ledger); capital infusion and dividend as "
     "register items; reimbursements through expense claims. Not built: a director or shareholder account view; drawings. No test uses "
     "the director or the shareholder kind of loan."),
    ("PARTIAL", 455,
     f"src/engine/templates.ts · {KINDS} (kinds 'capital_infusion', 'capital_call')",
     "Built: share capital and reserves ledgers in the supplied charts of accounts, moved by journals; register items for capital infusions "
     "and capital calls, which post nothing. Not built: a capital register showing additional capital, contributions, withdrawals, reserves and "
     "premium as separate movements."),
    ("PARTIAL", 475,
     "src/lib/data.ts monthlySeries · src/pages/Home.tsx · src/pages/Cockpit.tsx",
     "Built: twelve-month trend of income, expense and cash. Not built: trends of margin, debt, receivables and working capital."),
    ("PARTIAL", 489,
     f"{KINDS} (kind 'covenant') · src/pages/Treasury.tsx (Facilities and guarantees) · src/engine/forward.ts earlyWarnings · {FWD} 'early warnings state facts, rules and assumptions'",
     "Built: a covenant is recorded with its threshold as text and its next test date; a warning is raised as the date approaches. "
     "Not built: comparison of the threshold with the actual ratio, and any alert of a recorded or projected breach."),
    ("PARTIAL", 506,
     f"src/numi/engine.ts · src/pages/ReportView.tsx · {NUMI} 'a question about why a figure changed is still a comparison'",
     "Built: NUMI compares the profit and loss of two periods and names the ledgers that moved; the cash flow statement shows the movement in "
     "receivables, payables, fixed assets and borrowings for a period. Not built: a comparison of two balance sheets."),
    ("TESTED", 549,
     f"{OPS} 'a loan recovered through payroll reaches its instalment schedule and is never counted twice', 'reversing the payroll takes the recovery back from the schedule' · {FWD} 'an instalment partly recovered through payroll is projected for what remains' · {C11} T130–T133 · {M11} apply_loan_recovery · {M9} loans (direction 'lent', kind 'employee_loan'), create_payroll_run, wf_payroll · src/pages/Payroll.tsx (LoanPicker) · src/pages/Loan360.tsx",
     "A loan given to an employee has principal, interest, an instalment schedule and the principal outstanding. A recovery through payroll "
     "cannot exceed the outstanding principal, is credited to the loan ledger against the person and, once the payroll entry is approved, is "
     "applied to the instalments in order: an instalment whose principal is recovered in full and that carries no interest is paid by it, and "
     "an instalment recorded afterwards takes only the principal not yet recovered, so nothing is counted twice. Reversing the payroll takes "
     "the recovery back, and is refused when an instalment was recorded after it. The page of the loan shows what was recovered through "
     "payroll on each instalment. Limits: a recovery through payroll covers principal only — the interest of an instalment is recorded with "
     "the instalment itself; the test loan carries no interest. The database checks T130–T133 were read, not run, in this review; the "
     "application tests were run."),
    ("PARTIAL", 552,
     f"src/pages/Treasury.tsx · {T2} T84–T93 · {FWD} 'loan position and debt ladder'",
     "Built: cash, banks, fixed deposits, loans, credit facilities, guarantees, letters of credit and forex exposure on one page, with loan "
     "instalments falling due. Facilities, guarantees and letters of credit are register records. Not built: investments; upcoming payments "
     "other than loan instalments and expected collections are on the Forward page, not here."),
    ("TESTED", 554,
     f"{T2} T91–T93 · {OPS} 'fixed deposit: maturity value, lien, and interest as actually paid' · src/pages/Treasury.tsx · {M9} fixed_deposits",
     "Bank, principal, rate, compounding, start, maturity, calculated maturity value, lien with its note, and a 'renews automatically' flag. "
     "A deposit under lien cannot be closed until the lien is confirmed released (T92). Renewal instructions are the flag and free-text notes "
     "only; a renewal is recorded by a person as a closure and a new deposit."),
    ("PARTIAL", 555,
     f"src/pages/Treasury.tsx · {M9} loans.kind · {KINDS} (kind 'credit_facility')",
     "Built: term, working capital, vehicle, equipment and intercompany loans; the kinds offered on the screen are the ones the database "
     "accepts. Overdraft and cash credit can be recorded as credit facility register items, which have no postings. Not built: overdraft and "
     "cash credit as running accounts; a kind for property loans (a loan against property is recorded as a term loan or as 'other', with "
     "the property named as security)."),
    ("PARTIAL", 556,
     f"{KINDS} (kind 'credit_facility') · src/pages/Treasury.tsx (Facilities and guarantees)",
     "Built: sanctioned limit, drawn amount as last updated by a person, security, review date with a warning. Not built: the available amount, "
     "the interest rate, a link to covenants, utilisation taken from the ledger."),
    ("PARTIAL", 558,
     f"{KINDS} (kind 'letter_of_credit') · src/pages/Treasury.tsx (Facilities and guarantees)",
     "Built: LC number, issuing bank, party, amount, currency, margin, settlement date, expiry, attached documents. Not built: applicant and "
     "beneficiary as separate fields, shipment, charges."),
    ("PARTIAL", 559,
     "src/pages/Treasury.tsx (Forex exposure) · src/lib/data.ts openDocuments",
     "Built: by currency, the receivable, payable and net of open invoices and bills, with due dates, at the rate recorded on each document. "
     "Nothing is hedged or executed. Not built: exposure from loans, deposits, purchase orders, register items and bank balances in a foreign "
     "currency. No automated test covers this view."),
    ("PARTIAL", 560,
     f"{M9} fixed_deposits · src/pages/Treasury.tsx · {T2} T91–T93",
     "Built: fixed deposits, with the maturity value labelled as calculated and the interest taken from what the bank paid. Not built: bonds, "
     "funds, equity and other investments."),
    ("PARTIAL", 615,
     "src/pages/Forward.tsx (Cash horizon) · src/ui/charts.tsx Waterfall · src/pages/ReportView.tsx (Cash Book)",
     "Built: a waterfall from cash today through inflows and outflows by category to projected cash, for a chosen horizon including today; a "
     "cash book with opening, money in, money out and closing. Not built: a waterfall of the actual movements of one day split into "
     "collections, vendor payments, payroll, tax, loans and expenses."),
    ("TESTED", 617,
     f"{FWD} 'contingent amounts are reported beside the projection, never inside it', 'daily balance ends where the horizon ends' · src/engine/forward.ts cashHorizon · src/pages/Forward.tsx (All horizons) · src/pages/Treasury.tsx (Liquidity ladder)",
     "Inflows, outflows and projected cash for today, 7, 14, 30, 60 and 90 days, 6 and 12 months, 3 and 5 years, starting from cash in the "
     "books. Firm and uncertain amounts are shown apart; contingent amounts are left out of the projection."),
    ("PARTIAL", 626,
     "src/pages/Forward.tsx (Calendar, All events) · src/pages/MoneyMap.tsx",
     "Built: a calendar and a list of future money in and out by date and category (payroll, taxes, loans) for the selected companies; the "
     "Money Map of past flows. Not built: a timeline of past and future money on one line; large transactions and exceptional events marked."),
    ("IMPLEMENTED", 689,
     f"{KINDS} (kinds 'bank_guarantee', 'corporate_guarantee') · src/pages/Registers.tsx · src/pages/Treasury.tsx · src/engine/forward.ts · {FWD} 'early warnings state facts, rules and assumptions', 'a guarantee given is contingent: beside the projection, never inside it'",
     "Bank and corporate guarantees with amount, beneficiary (required), expiry and claim expiry; performance and financial are types of a bank "
     "guarantee. The total outstanding is shown as CONTINGENT, and in Forward a guarantee given is a contingent amount dated at its expiry, "
     "beside the projection and never inside it. The tests cover the expiry warning and that exposure; no test records a guarantee through "
     "the register with its beneficiary and type, so the status is IMPLEMENTED and not TESTED. A guarantee is a record: invocation "
     "has no accounting of its own."),
    ("PARTIAL", 695,
     f"{KINDS} (kind 'capital_infusion') · src/pages/Registers.tsx",
     "Built: a capital infusion register item with party (the source), amount, instrument and a state chosen from the list the database "
     "accepts, which includes proposed, approved, committed and received. Not built: the amounts proposed, "
     "approved, committed and received as separate figures; a link to the receipt in the books."),
    ("PARTIAL", 1223,
     f"{M9} payroll_runs.run_type, create_payroll_run · src/pages/Payroll.tsx",
     "Built: a 'full and final' payroll run made of amounts entered by a person for the employee (salary due, bonus, commission, advance "
     "recovery, loan recovery, other deductions), posted through approval. Not built: calculation of salary due, leave encashment, asset "
     "recovery, a settlement statement. No automated test covers this run type."),
    ("PARTIAL", 1252,
     f"src/pages/Treasury.tsx · {FWD} 'loan position and debt ladder'",
     "Built: banks, cash, deposits, loans, facilities, forex, letters of credit, bank guarantees, debt service within 30 and 90 days and "
     "maturities on one page. Not built: investments."),
    ("TESTED", 1253,
     f"{FWD} 'loan position and debt ladder' · src/engine/ops.ts debtLadder, loanPosition · src/pages/Treasury.tsx",
     "Instalments due within 30 and 90 days are on the Position tab (principal and interest). The ladder on the Loans tab shows principal and "
     "interest overdue, within 1 year, 1–2, 2–3, 3–5 and beyond 5 years. The test checks that the ladder adds up to the principal outstanding."),
    ("PARTIAL", 1254,
     f"{KINDS} (kind 'covenant') · {M9} loans.covenants · src/pages/Loan360.tsx",
     "Built: covenants recorded in the lender's own words, with a threshold and a test date. Not built: an engine. No ratio is calculated "
     "against a covenant."),
    ("PARTIAL", 1256,
     f"{M9} loans.kind · {KINDS} (kinds 'capital_infusion', 'capital_call', 'dividend')",
     "Built: director and shareholder loans; register items for capital contributions and dividends. Not built: shareholders, share classes, "
     "premium and ownership percentages."),
    ("PARTIAL", 1257,
     f"{KINDS} (kinds 'capital_infusion', 'dividend') · src/pages/Registers.tsx",
     "Built: capital infusion and dividend recorded as register items with an approval reference; they post nothing. Not built: rights issue, "
     "bonus issue, buyback and capital reduction as supplied kinds; legal or accounting validation steps."),
    ("PARTIAL", 1348,
     "src/pages/Treasury.tsx (Loans) · src/pages/Loan360.tsx",
     "Built: across the selected companies, each loan with borrower company, lender, outstanding and rate; maturity and security on the loan "
     "page. Not built: one map with collateral and guarantee beside each loan; a link between a loan and a facility or guarantee."),
    ("PARTIAL", 1349,
     f"{KINDS} (kind 'corporate_guarantee') · src/pages/Treasury.tsx",
     "Built: a corporate guarantee with amount, in favour of, on behalf of (text) and expiry, counted as contingent exposure. Not built: the "
     "guaranteed company as a linked record; a group map of who guarantees whom."),
    ("IMPLEMENTED", 1413,
     f"src/pages/Forward.tsx (Cash horizon) · src/engine/forward.ts cashHorizon · {FWD} 'contingent amounts are reported beside the projection, never inside it'",
     "From cash today through collections, deposits maturing, vendor payments, purchase commitments, payroll, taxes and loan repayments to "
     "projected cash, with firm and uncertain amounts shown apart and the certainty of every event visible. The test covers the projection; "
     "no test covers the split by category. 'Other liquid resources' are deposits maturing; nothing else can be configured."),
    ("PARTIAL", 1441,
     "src/ui/kit.tsx Explain · src/engine/reports.ts · src/pages/PeopleCost.tsx",
     "Built: figures such as ratios, people cost and working capital carry their formula, inputs and source on screen. Not built: one "
     "authoritative dictionary of what revenue, expense, cash, debt, payroll, EBITDA and outstanding mean."),

    # ------------------------------------------------------------------ PAYROLL
    ("PARTIAL", 32,
     f"{M9} · {M11} apply_loan_recovery · src/pages/Payroll.tsx · src/pages/PayrollRun.tsx · {T3} T110–T124 · {T2} T107–T109 · {C11} T130–T133 · {OPS} 'a loan recovered through payroll reaches its instalment schedule and is never counted twice'",
     "Built: employees, salary structures, allowances, deductions, bonuses and incentives, advance recovery, loan recovery applied to the "
     "instalment schedule of the loan, employer contributions, payroll liabilities, cost by department, and the accounting entry proposed "
     "and posted after approval (all tested). Not built: allocation to projects; reimbursements through payroll (claims are paid separately)."),
    ("PARTIAL", 300,
     f"src/pages/PeopleCost.tsx · src/pages/PayrollRun.tsx · src/pages/Ledger.tsx · {T3} T114",
     "Built: departments are a dimension on entries; payroll cost by department (T114), people cost by department, ledger entries filtered by "
     "department. Not built: a department page showing budget, actual, committed, revenue, travel, food, software, subscriptions, equipment, "
     "vendor spend and petty cash."),
    ("PARTIAL", 543,
     f"{M9} · src/pages/Payroll.tsx · src/pages/PayrollRun.tsx · src/pages/PeopleCost.tsx · {T3} T110–T125 · {T2} T107–T109",
     "Built: employees, salaries with approval and history, monthly runs, journals by department, payment of salaries, privacy; all tested. "
     "Not built: integration with an HR system, statutory calculations, payslips, attendance and leave."),
    ("PARTIAL", 544,
     f"{M9} save_salary_structure, propose_payroll_run · src/pages/Payroll.tsx · {T3} T110, T115",
     "Built: freely named components of kind earning, deduction or employer cost, with types fixed, bonus, incentive, commission, overtime, "
     "arrears and other (tested with basic, HRA, provident fund and tax). An earning or an employer cost can name the expense ledger it is "
     "charged to, so a reimbursement paid with salary can have a ledger of its own; left empty, the ledger mapped for payroll is used. "
     "Loan and advance recovery are monthly adjustments on a run. "
     "Not built: components as a percentage or formula; a ledger of its own for a deduction (deductions are credited to the ledgers mapped "
     "for tax deducted and statutory dues). No automated test covers a component that names its own ledger."),
    ("TESTED", 545,
     f"{T3} T113–T115, T120–T121, T124 · {OPS} 'the payroll journal is confidential, by department, and names no one', 'payment settles the payable; a paid payroll cannot be reversed' · src/pages/PayrollRun.tsx",
     "The approved payroll entry debits salary, bonus and employer contributions by department and credits net salaries payable, tax deducted, "
     "statutory dues and recoveries. Nothing reaches the ledger before approval (T120). The bank payment is a second entry (T124)."),
    ("PARTIAL", 547,
     f"{M9} create_payroll_run, propose_payroll_run · src/pages/Payroll.tsx · {T3} T110, T114",
     "Built: bonus, incentive and commission as named components or monthly adjustments, charged to the bonus ledger (or, for a component "
     "of a salary structure, to the expense ledger named on it) and counted as variable pay (tested with the bonus ledger). Not built: a "
     "register or report of bonuses by kind (performance, festival, retention, joining); the kind is the name typed by a person."),
    ("PARTIAL", 548,
     f"{M8} advances · {M9} create_payroll_run, wf_payroll · {T2} T109 · {T3} T121",
     "Built: the advance, its recovery from salary (never more than the unsettled balance), and the outstanding amount; all tested. "
     "Not built: a recovery schedule. Each recovery is entered on the run of the month."),
    ("PARTIAL", 550,
     f"{M9} payroll_runs.run_type, create_payroll_run · src/pages/Payroll.tsx",
     "Built: a 'full and final' run in which a person enters salary due, bonus, reimbursement, loan recovery, advance recovery and other "
     "deductions for the leaver; it is posted through approval. Not built: leave encashment, asset recovery, calculation of the amounts, a "
     "settlement statement. No automated test covers this run type."),
    ("PARTIAL", 709,
     "src/engine/forward.ts earlyWarnings · src/pages/Forward.tsx (Early warnings)",
     "Built: a warning that states current cash, the next payroll and how many times cash covers it, raised when the cover is below two. "
     "Not built: a payroll coverage view that is always shown; upcoming collections are not counted in the ratio. No automated test covers "
     "this warning."),
    ("PARTIAL", 1198,
     f"{M9} employees, salary_structures · src/pages/Payroll.tsx · {T3} T117",
     "Built: employee, company, office, department, designation, employment type, salary structure with effective date, payment method, "
     "under payroll permission (T117). Not built: currency, cost centre and project allocation on the employee."),
    ("TESTED", 1199,
     f"{T3} T110 · {OPS} 'calculates from approved salaries, pro-rata, and lists anyone left out' · src/pages/Payroll.tsx · {M9} save_salary_structure",
     "Any allowance is a freely named earning on the salary structure. Amounts are fixed monthly amounts and are reduced for part of a month. "
     "An earning is charged to the salary ledger (bonus, incentive and commission to the bonus ledger) unless the component names an expense "
     "ledger of its own; no test covers a component that names its own ledger."),
    ("PARTIAL", 1200,
     f"{M9} create_payroll_run · src/pages/Payroll.tsx · src/pages/PeopleCost.tsx · {T3} T110 · {FWD} 'people cost: salary is not the whole cost, and shared costs are not invented'",
     "Built: variable pay as named components or adjustments of type bonus, incentive or commission, totalled as variable pay per person and "
     "department (tested). Not built: tracking by kind of bonus; the kind is the name typed by a person."),
    ("PARTIAL", 1201,
     f"{M9} create_payroll_run · src/pages/Payroll.tsx",
     "Built: overtime as an amount on a payroll run, charged to the person's department. Not built: hours, rate, approval of overtime, project."),
    ("PARTIAL", 1202,
     f"{M9} create_payroll_run, save_salary_structure · src/pages/Payroll.tsx",
     "Built: arrears as an amount entered on a run; supplementary runs; a salary revision with its effective date. Not built: calculation of "
     "arrears from a retroactive revision. No automated test covers arrears or a supplementary run."),
    ("TESTED", 1203,
     f"{T2} T108 · {T3} T125 · {OPS} 'an approved salary is never overwritten; a revision adds history' · src/pages/Payroll.tsx (Salaries)",
     "An approved salary cannot be changed or deleted. A revision is a new record with its effective date, reason, approver and date; the "
     "audit entry names the salary it follows."),
    ("PARTIAL", 1204,
     f"{M9} create_payroll_run, propose_payroll_run · {M11} apply_loan_recovery · {T2} T109 · {T3} T115, T121 · {C11} T130–T133 · {OPS} 'a loan recovered through payroll reaches its instalment schedule and is never counted twice'",
     "Built: salary advance recovery, tax and statutory deductions, other deductions, and employee loan recovery, which is applied to the "
     "instalment schedule of the loan when the payroll entry is approved (all tested). "
     "Not built: an insurance deduction posted to its own ledger (every deduction is credited to the ledger mapped for its type)."),
    ("PARTIAL", 1205,
     f"{M9} save_salary_structure, propose_payroll_run · src/pages/Payroll.tsx · {T3} T110, T115",
     "Built: employer contributions as employer-cost components, debited to the employer contribution ledger, or to the expense ledger "
     "named on the component, and credited to statutory dues (tested with the mapped ledger). Not built: provisions for gratuity and bonus "
     "in their own liability ledgers; every employer cost is credited to the statutory dues ledger."),
    ("PARTIAL", 1220,
     f"{M9} employees.status · src/pages/PeopleCost.tsx (New-hire cost model) · {FWD} 'new-hire cost model'",
     "Built: an employee can be recorded as planned, with joining date, department and office, and is left out of payroll; a first-year cost "
     "estimate for new hires (tested), which is not saved. Not built: open positions without a named person, a headcount plan, planned hires "
     "in the payroll forecast."),
    ("TESTED", 1227,
     f"{T3} T116–T119, T122 · {NUMI} 'gives totals and never names a person', 'declines to state what an individual is paid, even for a person who may see payroll' · {OPS} 'a restricted salary is invisible to a person without clearance' · src/pages/Payroll.tsx",
     "Payroll tables are readable only with the payroll permission; a finance head without it sees no employee, salary or run (T117) and no "
     "payroll rows in the audit trail (T118). Records above a person's clearance are not sent. NUMI gives totals and declines individual pay."),
    ("PARTIAL", 1420,
     f"src/pages/PayrollRun.tsx · {M9} · {T3} T111, T113, T124",
     "Built: the chain from employee to run to approval to journal to payment is linked and visible; people left out of a run are listed "
     "(T111). Not built: a consistency check that compares the payroll register with the bank payment, the statutory dues and the ledger."),
    ("PARTIAL", 1639,
     f"src/pages/Calculators.tsx · src/pages/PeopleCost.tsx · src/pages/Payroll.tsx · {FWD} 'new-hire cost model'",
     "Built: commission calculator, new-hire cost (tested), payroll forecast, cost per person from posted payroll, and net pay and annual cost "
     "on the salary form. Not built: increment and bonus calculators; an employer cost calculator."),

    # ------------------------------------------------------------------ ASSETS
    ("PARTIAL", 23,
     f"{M7} fixed_assets, asset_categories, asset_events · src/pages/Assets.tsx · src/pages/Asset360.tsx · {T1} T30–T41 · {OPS} 'written-down value and part-month depreciation'",
     "Built: purchase value, in-service date, useful life, method, residual value, location, department, custodian, serial number, warranty, "
     "maintenance, transfer history, disposal, and depreciation rules by category (depreciation and disposal tested). Not built: AMC and "
     "insurance on the asset; they are separate register items with no link to the asset."),
    ("PARTIAL", 135,
     f"{KINDS} (kind 'amc') · src/pages/Registers.tsx · src/engine/forward.ts earlyWarnings",
     "Built: what is covered (text), vendor, start and end, cost, frequency, visits per year, renewal date and a warning before the cover ends. "
     "Not built: a log of visits, parts, a link to the asset record."),
    ("IMPLEMENTED", 234,
     f"src/pages/Assets.tsx · src/pages/Asset360.tsx · {M7} save_asset, record_asset_event",
     "IT equipment is recorded in the asset register under a category the company defines, with custodian (a person) and department or office; "
     "assignment and transfer are recorded with the earlier holder kept. No automated test covers assignment to a person or office."),
    ("PARTIAL", 237,
     f"src/pages/Asset360.tsx (Record an event) · {M7} record_asset_event",
     "Built: maintenance on a fixed asset with date, work done, vendor (text), cost and next due date. Not built: a link to the vendor's bill; "
     "repairs of vehicles and property kept in the registers; repairs of offices and furniture that are not fixed assets."),
    ("PARTIAL", 447,
     f"{M7} create_depreciation_run · src/pages/Assets.tsx · {T1} T30, T34–T38 · {OPS} 'written-down value and part-month depreciation'",
     "Built: straight line and written down value, by month, with part-month charge, cost, useful life, residual value, "
     "accumulated depreciation and book value; all tested. Not built: any other method."),
    ("PARTIAL", 448,
     f"{M7} propose_asset_impairment · src/pages/Asset360.tsx",
     "Built: impairment with its basis and the name of the assessor, proposed as an entry that a second person approves. NUMI cannot change an "
     "asset value: it has no means of writing. Not built: revaluation upwards. No automated test covers impairment."),
    ("PARTIAL", 574,
     f"src/pages/Purchasing.tsx · src/pages/Assets.tsx · src/pages/Asset360.tsx · {M7} · {T2} T94–T103 · {T1} T30–T41",
     "Built: request, approval, purchase order and receipt (purchase-to-pay); registration of the asset, which can name the vendor's bill it "
     "was bought on, and the page of the asset opens that bill; assignment, maintenance, transfer, "
     "impairment; sale, scrap and write-off. Not built: capitalisation that follows from the purchase — the asset is registered by hand, "
     "and the bill is chosen by a person, not proposed from the receipt or the order; revaluation. No automated test covers the link to "
     "the bill."),
    ("PARTIAL", 1207,
     f"src/pages/Assets.tsx · {M7} fixed_assets.custodian_party_id · {KINDS} (kind 'software_licence')",
     "Built: each asset has a custodian, and the register can be searched by custodian. Not built: the cost of equipment per employee; "
     "software licences linked to a person (the register holds 'used by' as text)."),
    ("PARTIAL", 1289,
     f"src/pages/Asset360.tsx (Asset tag) · {M7} fixed_assets.tag_code",
     "Built: each asset has a tag code that can be printed as text, and the register can be searched by it; the asset page shows identity, "
     "purchase, cost, location, custodian, depreciation, warranty and maintenance. Not built: a QR image, scanning, AMC and insurance on the "
     "asset."),
    ("PARTIAL", 1351,
     f"src/pages/Assets.tsx · src/pages/Registers.tsx · {KINDS} (kinds 'vehicle', 'property')",
     "Built: the asset register across the selected companies shows the owning company of each asset; vehicles and properties are register "
     "items with their company. Not built: one group map of ownership; investments."),
    ("PARTIAL", 1386,
     f"{M7} record_asset_event · src/pages/Asset360.tsx · {OPS} 'a missing asset raises a factual alert and changes nothing in the books'",
     "Built: a physical verification of one asset with its result; an asset reported missing, damaged or disposed raises an alert "
     "and the books are not changed (the missing case is tested). Not built: a count of a whole category against the books; a list of assets not yet verified."),
    ("PARTIAL", 1421,
     f"src/engine/ops.ts assetReconciliation · src/pages/Assets.tsx (Reconciliation) · {OPS} 'the asset register agrees with the general ledger'",
     "Built: the register compared with the ledger, ledger by ledger, with every difference shown (tested); verification alerts; custodian, "
     "depreciation, maintenance and disposal on each asset. Not built: a check that every purchase posted to a fixed asset ledger has a "
     "register entry; a check for assets without a custodian or a verification."),
]

PLANNED = {
    # requirement number: why it is not built

    # ------------------------------------------------------------------ GENESIS BUILDER
    84: "No dashboard builder exists. The dashboards are the same for every user.",
    1243: "No allocation of shared costs exists. People cost states that shared costs are not allocated.",
    1759: "Nested dropdowns are not built. A dropdown is one flat list of options.",
    1760: "Dependent dropdowns are not built. No field changes its options according to another field.",
    1762: "No approval step exists before a new dropdown option becomes active.",
    1763: "No form builder exists. There is no drag and drop of fields.",
    1773: "No workflow builder exists.",
    1783: "No status builder exists. The statuses of every record are fixed in the program and the database.",
    1785: "Transaction types cannot be created by an administrator. The Transaction Centre has a fixed list.",
    1794: "Not built. A Financial Path has a 'settlement rule' field that records a choice as text; nothing applies it.",
    1800: "No configurable notification rules exist. Warnings are raised by fixed rules and shown inside the application only.",
    1801: "No report builder exists, so custom fields, kinds and paths cannot be added to a report.",
    1803: "Calculators are fixed. An administrator cannot define a formula calculator.",
    1805: "No dashboard builder exists for departments or scenarios.",
    1807: "No department workspace exists. Ledger entries can be filtered by department; there is no department home page.",
    1810: "No menu builder exists. The navigation is fixed and shows what each person's permissions allow.",
    1814: "No page builder exists.",
    1815: "Permissions cannot be set per custom object. The register permissions apply to every register kind alike.",
    1819: "Document types are a fixed list in the program. An administrator cannot add one.",
    1827: "A path cannot be cloned. No copy action exists on a register item.",
    1844: "No automations exist. Nothing runs on a trigger; a person starts every action.",
    1847: "No rule engine (when, if, then, else) exists.",
    1850: "A path does not invoke a workflow. Advances and claims follow the same fixed workflow whatever path they are linked to.",
    1865: "No workflow can be published, and NUMI has no explanation of configuration changes.",
    1866: "Display names of concepts such as Department cannot be renamed by an administrator.",
    1867: "Labels have no translations.",
    1869: "Reading document contents is not built, so an uploaded invoice cannot fill any field.",
    1890: "No API for custom fields or custom objects is offered.",
    1891: "No webhooks exist.",
    1892: "No import maps columns to custom fields. The only import is the bank statement CSV.",
    1893: "Custom field values and the fields of a register kind are not included in exports.",
    1894: "Custom field values and the fields of a register kind are not searched.",
    1895: "No report includes custom fields.",

    # ------------------------------------------------------------------ TREASURY
    1249: "Sensitivity analysis is not built. No what-if modelling exists.",
    1284: "No M&A workspace exists.",

    # ------------------------------------------------------------------ PAYROLL
    1221: "Vacancies are not tracked. There is no record of a planned role without a named person, and no vacancy cost.",

    # ------------------------------------------------------------------ ASSETS
    233: "No register of uniforms, safety equipment or other issued items exists. A Group Super Admin could define a register kind for it; none is supplied.",
    1287: "No comparison of repair against replacement exists. Maintenance events with their cost are listed on the asset; replacement cost, downtime, remaining life and a NUMI summary are not built.",
    1325: "An asset belongs to one company and its department must be of that company. Use by another company cannot be recorded.",
}
