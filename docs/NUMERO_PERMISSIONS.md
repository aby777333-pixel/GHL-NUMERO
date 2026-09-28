# NUMERO PERMISSIONS

Permissions are enforced **in the database** by Row Level Security and by checks inside every workflow function. The interface hides or disables what a person cannot do, but that is a courtesy: the database is the authority.

## Who is who

| Level | Meaning |
|---|---|
| **Group Super Admin** | `profiles.is_group_super_admin`. Holds every permission in every company of the group. Set only by the bootstrap function; cannot be self-assigned. |
| **Member** | A row in `memberships`: user × company × role, optionally with `valid_from` / `valid_to`. Temporary access ends by itself. |
| **No membership** | A signed-in user with no membership sees nothing. |
| **Anonymous** | No access to any table or function. |

## Bootstrap

`bootstrap_group` succeeds only when all of these hold:

1. the caller is signed in and belongs to no group;
2. if `app_config.owner_email` is set, the caller's email matches it;
3. no group exists yet (unless `app_config.allow_multiple_groups` is true).

`app_config` has no client-facing policy at all; it can only be read by server-side functions.

## System roles

Seeded per group by `seed_roles`. Custom roles can be added; the role and permission tables are ordinary data.

| Role | Summary |
|---|---|
| Owner, Group CFO | Every permission |
| Finance Head | Everything except company configuration, reopening periods, vault, field configuration |
| Company Director | View and approve; cannot create or post |
| Accountant | Create, submit and post journals; create documents and payments; bank import and reconciliation. **Cannot approve.** |
| Junior Accountant | Create and submit only |
| Auditor | Read-only, including audit trail and Sentinel |
| Tax Consultant | Read ledgers, documents and reports |
| Department Head, Project Manager | Budgets and reports |
| Purchase Manager, Sales Manager | Their own documents and parties |
| Employee | Company visibility and NUMI. Phase 2: may enter their own advances and claims and upload documents; sees only what they entered |
| Payroll Officer | Prepares employees, salaries and payroll runs. **Cannot approve a salary.** Not cleared for confidential journals unless granted |
| HR Head | Payroll, including salary approval; approves expense claims |
| Read Only | Every `*.view` permission |

## Permission strings

```
company.view  company.configure
account.view  account.configure   orgunit.configure
journal.view  journal.create  journal.edit  journal.submit
journal.approve  journal.reject  journal.post  journal.reverse
invoice.view  invoice.create  invoice.approve
bill.view     bill.create     bill.approve
payment.view  payment.create  payment.approve
party.view    party.create    party.edit    party.bank.verify
bank.view     bank.import     bank.reconcile
budget.view   budget.edit     budget.approve
period.lock   period.reopen
report.view   report.export   audit.view
sentinel.view sentinel.review
vault.view    numi.use
tax.configure approval.configure field.configure

# Phase 2
register.view   register.manage
document.view   document.upload
asset.view      asset.manage
purchase.view   purchase.create   purchase.approve
expense.view    expense.create    expense.approve
treasury.view   treasury.manage
payroll.view    payroll.manage    payroll.approve

# Phase 3
inventory.view    inventory.manage    inventory.count    inventory.approve
investment.view   investment.manage   investment.approve
reality.view      reality.manage
scenario.view     scenario.manage
flow.view         flow.manage         flow.configure
allocation.manage import.manage
system.health     integration.manage  communication.send
```

### Who holds the Phase 2 permissions by default

| Role | Registers | Documents | Assets | Purchasing | Expenses | Treasury | Payroll |
|---|---|---|---|---|---|---|---|
| Owner, Group CFO | all | all | all | all | all | all | **all** |
| Finance Head | all | all | all | all | all | all | none |
| Company Director | view | view | view | view, approve | view, create, approve | view | none |
| Accountant | view, manage | view, upload | view, manage | view, create | view, create | view, manage | none |
| Junior Accountant | view | view, upload | view | view | view, create | — | none |
| Auditor, Read Only | view | view | view | view | view | view | none |
| Tax Consultant | view | view | — | — | — | — | none |
| Department Head | view | upload | — | view, create | create, approve | — | none |
| Project Manager | view | upload | — | view, create | create | — | none |
| Purchase Manager | view | view, upload | — | view, create | create | — | none |
| Sales Manager | view, manage | upload | — | — | create | — | none |
| Payroll Officer | — | upload | — | — | create | — | view, manage |
| HR Head | — | upload | — | — | create, approve | — | view, manage, approve |
| Employee | — | upload | — | — | create | — | none |

**Salary data is restricted by default.** A Finance Head does not see employees, salaries or payroll runs unless the Owner grants a payroll role. The payroll journal is confidential: it is approved by a person who is cleared to read it (a Group Super Admin, or a person with a Black Vault grant for the confidential level).

### Who holds the Phase 3 permissions by default

Three roles were added: **Store Keeper**, **Investment Manager**, **IT Administrator**.

| Role | Inventory | Investments | Reality | Simulations | Scenario Studio | Allocation, imports | Platform |
|---|---|---|---|---|---|---|---|
| Owner, Group CFO | all | all | all | all | all | both | health, integrations, communications |
| Finance Head | all | all | all | all | all | both | health, communications |
| Company Director | view, approve | view, approve | view | view, manage | view, manage | — | — |
| Accountant | view, manage, count | view, manage | view, manage | view | view, manage | both | communications |
| Junior Accountant | view, count | — | view | — | view, manage | — | — |
| Auditor | view | view | view, manage | view | view | — | health |
| Read Only | view | view | view | view | view | — | — |
| Tax Consultant | view | — | — | — | — | — | — |
| Department Head, Project Manager | view | — | — | view | view, manage | — | — |
| Purchase Manager | view, manage, count | — | — | — | view, manage | — | — |
| Sales Manager | view | — | — | — | view, manage | — | communications |
| Store Keeper | view, manage, count | — | — | — | view | — | — |
| Investment Manager | — | view, manage | — | view, manage | view | — | — |
| IT Administrator | — | — | — | — | — | — | health, integrations |
| Payroll Officer, Employee | — | — | — | — | view | — | — |
| HR Head | — | — | — | — | view, manage | — | — |

What these permissions do not grant:

| Control | Rule |
|---|---|
| Counting and reviewing stock | The person who counted cannot review the count. A difference is adjusted only with its reason, and the adjustment is an entry that a second person approves. |
| An accountant and a simulation | An accountant reads simulations and cannot build or save them (`scenario.manage`). |
| A fund, a holding | Confidential by default. A person without clearance is not shown the record and is not told that it exists. The entries it proposes carry its level, so they are approved by people cleared for it. |
| A valuation | Recorded by one person, approved by another. For a holding carried at cost it posts nothing. |
| A driver of the digital twin | Used by a simulation only after a second person approved it. |
| A workflow for the whole group | Designed by a Group Super Admin. A company's own workflow needs `flow.configure` in that company. |
| Starting a workflow case | Anyone who reads workflows (`flow.view`) may start a case: an employee raises their own request. The person who started a case completes its own `request` and `evidence` steps; every other step, and cancelling the case, needs `flow.manage`. |
| Approving inside a workflow case | The person who started the case cannot complete its approval step. Where the group allows an owner override, the override is the Group Super Admin's alone. |
| A case | Its history is append-only. A change of status needs a note; closing needs a resolution. A case raised from an alert, and an incident, are opened and worked with `sentinel.review`; every other kind with `reality.manage`. The form offers a person the kinds they may open. |
| A verification sheet | Opened, filled in, completed and cancelled with `reality.manage`. Only an open sheet is cancelled, with a reason; a completed sheet stays as it was found. |
| A link of the corporate structure | Saved by a person who holds `investment.manage` in the company that owns or in the company that is owned. A link between two outside parties is saved by a Group Super Admin. |
| Communications | Read with `communication.send` or `party.view`; prepared and marked as sent with `communication.send`. |
| A notice of an approval that waits | Written for the people who hold the permission to approve, never for the person who asked. A Group Super Admin is told only when the rules of the group class the request as owner action or critical, or when nobody else could approve it. |
| A reclassification | Bank, cash, party, tax and intercompany ledgers cannot be reclassified. The original entry is never changed. |
| Capability switches, attention rules | Changed by a Group Super Admin only. |
| An integration that can move money | High risk. A recorded test in a sandbox is required before production, and only a Group Super Admin makes it active. No secret is ever stored. |
| A backup record, a saved simulation, a prepared communication | Cannot be changed after it is recorded. |
| The sandbox | Every person of the sandbox holds every permission, so that every screen can be tried. Maker-checker and periods apply as configured. Nothing done there reaches the books. |

### What a person who may only create can see

| Records | Readable with | Otherwise |
|---|---|---|
| Advances, expense claims | `expense.view` or `expense.approve` | the records the person entered themselves |
| Purchasing documents | `purchase.view` | the documents the person prepared |
| Documents | `document.view` | the files the person uploaded |
| Cash boxes and counts | `treasury.view` or `expense.approve` | nothing |
| Follow-ups | any access to the company, and clearance for the record the follow-up is linked to, as that record is classified now (a follow-up follows its record when the record is reclassified); a follow-up on payroll needs `payroll.view` | nothing |
| Expense categories | any access to the company | — |

The screens follow the same rules: a screen a role does not include says so instead of appearing empty.

## Controls that permissions alone do not grant

| Control | Rule |
|---|---|
| Maker-checker | The creator of a journal, document, payment or bank-detail change cannot approve it — even with the approve permission. |
| Owner self-approval | Only if the group setting `controls.maker_checker` is `owner_override`, only for the Group Super Admin, and recorded as `override`. |
| One approver, one step | The same person cannot approve two steps of one request. |
| Approval routing | `approval_rules` choose the steps by entity, company and amount. A step may require a specific role. |
| Bank-detail change | New details are `pending_verification` and cannot be used by a payment until a second person verifies them. Earlier details are kept. |
| Blocked party | No new documents or payments. History is untouched. |
| Locked period | No posting by anyone. Reopening needs `period.reopen` and a reason. |
| Confidentiality | A user can only create or see records at levels they are cleared for (`vault_grants`). `super_admin_only` cannot be granted. |
| Nobody approves what they cannot read | `approve_journal` refuses an approver who is not cleared for the journal's confidentiality level. |
| Proposed entries | An entry proposed by an operation is subject to maker-checker like any journal: the person who recorded the release, the payment or the run cannot approve its entry. It cannot be edited by hand. |
| Entering and approving a salary | Different permissions (`payroll.manage`, `payroll.approve`), and the person who entered a salary cannot approve it. |
| Vendor selection | Made by a person with `purchase.approve`, with a recorded reason. The record states whether the chosen quotation was the lowest. |
| Policy flags | Inform the approver. They never reject a claim. Approving a flagged line requires a comment. |
| Approved amount | An advance may be approved for less than requested, never more. Where several approvals are needed, a later approver may lower the amount an earlier approver authorised, not raise it. Release cannot exceed the approved amount; return cannot exceed the unsettled balance. |
| Cash box limit | A single payment from a cash box above its limit is recorded and raised for review. It is not blocked. |
| Approval rules | Added and edited by a Group Super Admin or a holder of `approval.configure`, on the Approvals screen. A rule is switched off, never deleted. |
| Money ledgers | Release, return, reimbursement, transfer, loan, deposit and salary payments accept only a ledger whose control type is bank or cash. |

## Direct table writes

Clients can write directly only to configuration and draft-like tables, under permission-checked policies: companies (update), accounts, org units, tax codes, bank accounts, budgets in draft, approval rules, custom fields, roles, learned-rule status, exchange rates.

Accounting records — journals, journal lines, invoices, payments, bank transactions, parties, alerts, audit — have **no** client write policy. They change only through workflow functions.

The same is true of every operational table added in Phase 2. Files are written to the private storage bucket under the uploader's company path, with `document.upload`; the record of the file is created by `register_document`. A person reads every file with `document.view`, and otherwise the files they uploaded. A stored file can be removed only by its uploader and only if it never became a document.

## NUMI and voice

NUMI checks the person's permission before it reads, because the database answers an unauthorised read with no rows rather than an error: without the permission NUMI says it is not authorised and does not say whether records exist. It gives payroll totals to people with `payroll.view` and never states what an individual is paid, to anyone.

NUMI and voice hold no credentials of their own. They run as the signed-in person, through the same data layer, and are subject to exactly the same policies. Restricted totals are disclosed only in the form: “N entries totalling X relate to restricted transactions that your account is not authorised to view.”
