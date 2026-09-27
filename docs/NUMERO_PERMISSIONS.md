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
| Employee | Company visibility and NUMI |
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
```

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

## Direct table writes

Clients can write directly only to configuration and draft-like tables, under permission-checked policies: companies (update), accounts, org units, tax codes, bank accounts, budgets in draft, approval rules, custom fields, roles, learned-rule status, exchange rates.

Accounting records — journals, journal lines, invoices, payments, bank transactions, parties, alerts, audit — have **no** client write policy. They change only through workflow functions.

## NUMI and voice

NUMI and voice hold no credentials of their own. They run as the signed-in person, through the same data layer, and are subject to exactly the same policies. Restricted totals are disclosed only in the form: “N entries totalling X relate to restricted transactions that your account is not authorised to view.”
