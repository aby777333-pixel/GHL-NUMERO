# NUMERO DATA MODEL

Relational, transactional, with integrity in the database. The accounting engine is not built from JSON blobs: amounts, accounts, parties and dimensions are columns and rows. JSON is used only for configuration and free-form evidence.

Money is `numeric(20,4)`. Exchange rates are `numeric(20,8)`.

## Tenancy

```
groups ──< companies ──< org_units (self-referencing hierarchy, typed)
   │            │
   │            └──< memberships >── roles ──< role_permissions
   └──< profiles (one per signed-in user)
```

`org_unit_types` defines the hierarchy levels as data: business unit, branch, office, department, division, cost centre, profit centre, project, property, fund, portfolio, warehouse, store, team, vehicle, trip, campaign, contract, event, path. Groups add their own levels without code.

## Ledger

```
companies ──< accounts (tree: parent_id, is_group)
          ──< fiscal_periods (open | soft_closed | locked)
          ──< journals ──< journal_lines ──< journal_line_dims >── org_units
                              │
                              ├── accounts
                              └── parties
```

| Table | Notes |
|---|---|
| `accounts` | `type` (asset, liability, equity, income, expense), `subtype` (drives statement sections), `control_type` (bank, cash, receivable, payable, tax, intercompany, suspense, advances), `counterparty_company_id` for intercompany ledgers |
| `company_account_map` | Which ledger plays which system role: `ar_control`, `ap_control`, `customer_advances`, `vendor_advances`, `fx_gain_loss`, `retained_earnings`, `suspense` … |
| `journals` | `status` draft → submitted → approved → posted → reversed; `origin` human / ai_suggested / system / import; `source` + `source_id` link to the originating document; `confidentiality`; `idempotency_key`; full responsibility chain (created, submitted, approved, posted: who and when) |
| `journal_lines` | one side only; `debit`/`credit` in base currency; original `txn_currency`, `txn_amount`, `fx_rate` |
| `journal_line_dims` | unlimited tags per line, one per dimension type |
| `voucher_types`, `voucher_sequences` | 21 voucher types; gap-free numbering per company, type and fiscal year, assigned at posting |

## Parties

```
groups ──< parties ──< party_roles >── companies
                   ──< party_bank_accounts (pending_verification | verified | superseded | rejected)
```

One master identity (`NUM-VEN-000245`), many company-specific relationships. `party_types` is data: 27 system types, unlimited custom types.

## Documents

```
invoices ──< invoice_lines ── tax_codes ──< tax_code_components (rate, accounts, effective dates)
    │
payments ──< payment_allocations >── invoices
```

`invoices.doc_type`: sales_invoice, purchase_bill, credit_note, debit_note. Approval creates and posts the journal and stores its id.

## Banking

```
bank_accounts ── accounts (ledger)
      └──< bank_transactions ── journal_lines (matched_line_id, unique)
```

Statuses: unmatched, suggested, matched, partial, duplicate, needs_review.

## Control

| Table | Purpose |
|---|---|
| `approval_rules`, `approval_requests`, `approval_actions` | Configurable multi-step approval |
| `alerts` | Sentinel anomalies with explanation, evidence and review status |
| `vault_grants`, `vault_access_log` | Confidential access and its log |
| `audit_log` | Who, what, when, company, old value, new value, reason. Append-only |
| `budgets`, `budget_lines` | Versioned budgets by account, dimension and month |

## Intelligence and configuration

| Table | Purpose |
|---|---|
| `numi_rules` | Learned classification preferences |
| `numi_log`, `voice_audit` | Append-only logs of questions and voice commands |
| `custom_field_defs`, `custom_field_values` | Dynamic field engine |
| `exchange_rates` | Rates by date and type |
| `requirement_ledger` | The specification index, visible to Group Super Admins |
| `app_config` | Deployment settings; no client access |

## Functions callable by the application

`bootstrap_group` · `grant_membership` · `create_company` · `create_party` · `add_party_role` · `set_party_status` · `add_party_bank` · `verify_party_bank` · `save_journal_draft` · `submit_journal` · `approve_journal` · `reject_journal` · `cancel_journal` · `post_journal` · `reverse_journal` · `set_period_status` · `save_invoice` · `approve_invoice` · `save_payment` · `approve_payment` · `import_bank_transactions` · `suggest_bank_matches` · `set_bank_match` · `ledger_balances` · `ledger_monthly` · `ledger_lines` · `party_ledger_balances` · `open_journal` · `integrity_check` · `run_sentinel` · `review_alert` · `numi_learn`

Each is a thin wrapper in `public` around the implementation in `numero_private`.

## Schema evolution

Migrations are additive. New companies, modules, fields, workflows, countries and integrations are added as rows or new tables; nothing in the ledger needs to be rebuilt.
