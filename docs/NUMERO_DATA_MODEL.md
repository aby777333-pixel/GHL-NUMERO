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

## Operations (Phase 2)

Every table below carries `company_id`, has Row Level Security enabled, and has **no client write policy** unless stated: records change only through the functions listed at the end.

### The proposal engine and approvals

| Table | Purpose |
|---|---|
| `workflow_postings` | Ties a proposed journal to the operational record that proposed it: `source`, `source_id`, `payload`, status `pending`, `posted`, `voided`, `reversed`. One pending proposal per source record |
| `approval_requests`, `approval_actions` | Now serve journals, advances, expense claims, requisitions, purchase orders, capital calls and distributions |
| `company_account_map` | Which ledger plays which role for the posting engines (30 roles: 20 of Phase 2 and 10 of Phase 3 — goods received not invoiced, landed cost clearing, stock lost, stock found, gain or loss on investments, changes in fair value, income from investments, distributions payable, management fees, management fees owed), per company |

### Registers, follow-ups, documents

| Table | Purpose |
|---|---|
| `register_kinds` | What can be registered. Data, not code: category, direction, default certainty, reference prefix, optional dimension type, and the field schema. 50 system kinds; a group may add its own or make its own version of a system kind |
| `register_sequences` | Gap-free reference numbers per company and prefix (`SUB-00001`, `EMP-00001`) |
| `register_items` | One obligation, income stream, exposure, asset, incident or path: party, ledger, amount, frequency, dates, renewal, escalation, certainty, confidentiality, kind-specific `data`, optional `org_unit_id` for cost tracking |
| `tasks` | Follow-ups linked to any record. Closing requires the outcome. A follow-up takes the confidentiality of the record it is linked to, keeps to it when the record is reclassified, and is read under the same rule |
| `documents` | One stored file: name, size, SHA-256 fingerprint, storage path, kind, party, date, amount, reference, expiry, `duplicate_of`, status. Never deleted; recorded facts cannot be altered |
| `document_links` | A document attached to any record (`entity`, `entity_id`) |
| `custom_field_values` | Values of the fields defined in `custom_field_defs`, per record |

Storage bucket `numero-documents` is private. Paths begin with the company id; storage policies apply `document.view` and `document.upload` to that company.

### Fixed assets

| Table | Purpose |
|---|---|
| `asset_categories` | Asset, accumulated-depreciation and expense ledgers; default method, life, rate, residual value |
| `fixed_assets` | The register: cost, residual value, method (straight line, written down value, none), life or rate, accumulated depreciation, impairment, department, custodian, location, serial number, tag, vendor, source bill, warranty, status |
| `depreciation_runs`, `depreciation_lines` | One run per company and month, in order. Each line keeps the opening book value, the amount and the basis of the calculation |
| `asset_events` | Assignment, transfer, maintenance, physical verification, impairment, disposal, note |

### Purchase-to-pay

| Table | Purpose |
|---|---|
| `purchase_docs`, `purchase_doc_lines` | Requisition, request for quotation, quotation, purchase order, goods receipt, service receipt — one table, linked by `parent_id`; receipt lines point to order lines through `source_line_id` |
| `invoices.po_id`, `invoice_lines.po_line_id` | The vendor's bill linked to the order and its lines |

None of these writes to the ledger.

### Expenses, advances, cash

| Table | Purpose |
|---|---|
| `expense_categories` | Ledger and policy per category: limit per item, limit per day, receipt required above, maximum age, guidance |
| `advances` | Requested, approved, released, settled and returned amounts, kept separately; expected settlement date; review flag; last follow-up. An advance that names a register item is at least as confidential as that item (so is an expense claim) |
| `expense_claims`, `expense_claim_lines` | Claim header and lines. Each line keeps the claimed and the approved amount, who paid, whether a receipt is attached, the policy flags and the approver's note |
| `cash_boxes`, `cash_counts` | Petty cash boxes with custodian, float and limits; a payment above the limit for a single payment is raised for review. Counts are append-only: counted, book balance at that moment, difference, denominations, witness |
| `fund_transfers` | Movement between the company's own ledgers, or between two group companies (two journals) |
| `collection_promises` | What a customer said they would pay, and when; and whether it was kept |

### Treasury

| Table | Purpose |
|---|---|
| `loans`, `loan_schedule` | Loans taken and given; schedule by equal instalment, equal principal or bullet; each instalment keeps its journal, and `recovered`: the principal already recovered through payroll |
| `fixed_deposits` | Principal, rate, compounding, maturity value (calculated), lien, auto-renewal, placement and closure journals, proceeds and tax deducted |

Guarantees, credit facilities, letters of credit and covenants are register items, not tables of their own.

### Payroll

| Table | Purpose |
|---|---|
| `employees` | Employment record of a party: number, designation, department, office, type, dates, status, confidentiality |
| `salary_structures` | Components with an effective date. Draft → approved or rejected. An approved structure can never be changed; a revision is a new row |
| `payroll_runs`, `payroll_lines` | One regular run per company and month. Lines keep days paid, components and their origin. People left out are listed in `exceptions` with the reason |

Payroll tables are readable only with `payroll.view`. Payroll rows of the audit trail are hidden from everyone else.

## Inventory, investments, control, simulations, platform (Phase 3)

The rules of Phase 2 hold: every table carries `company_id` (or `group_id` where it belongs to the group), has Row Level Security enabled, and changes only through functions.

### Inventory

| Table | Purpose |
|---|---|
| `inv_categories` | Which stock ledger and which cost-of-sales ledger a category of items uses, and how it is valued (weighted average or first in, first out) |
| `warehouses` | Places where stock is kept: warehouse, store, site, office, in transit, service van |
| `inv_items` | The item, how it is tracked (none, lot, serial number), reorder level, shelf life, and its running balance: quantity and value on hand, quantity and value reserved by documents awaiting approval |
| `inv_lots` | A lot or a serial-numbered unit: dates of manufacture and expiry, supplier, import details, landed cost; and for a unit that was sold — to whom, on which invoice, installed where, warranty until |
| `inv_unit_events` | Service history of a unit: installation, engineer visit, spare part, warranty claim, service contract, relocation |
| `stock_docs`, `stock_doc_lines` | Receipt, issue, transfer, return in, return out, adjustment, landed cost. Draft → proposed → posted, rejected, reversed or cancelled |
| `inv_movements` | **The stock ledger.** One row for every quantity that moved, with its value. A receipt is a layer with what remains of it. Rows are never deleted; a movement whose entry was rejected is kept as rejected |
| `inv_layer_usage` | Which receipts an outgoing quantity was taken from, so that a rejected document gives back exactly what it took |
| `inv_holds` | Stock noted as damaged, expired, obsolete, held for inspection or missing. It stays in the books at cost until an adjustment is approved |
| `stock_counts`, `stock_count_lines` | A count of one place: book quantity at the time, quantity counted, reason for each difference; counted by one person, reviewed by another |

### Investments and funds

| Table | Purpose |
|---|---|
| `corporate_links` | Who owns what: a company of the group or an outside party owns a company or an outside party, by how much, from when. No company can own its own owner; owners cannot add up to more than the whole |
| `equity_holders` | Shareholders of a company, by class |
| `holdings`, `holding_txns` | An investment carried at cost or at fair value; its purchases, sales, income, write-downs and valuations |
| `funds`, `fund_commitments` | A fund kept in the books of its own company; what each investor committed, was called for, contributed, holds in units, received |
| `capital_calls`, `capital_call_lines`, `unit_allotments` | A call of a percentage of every commitment; what each investor owes and has paid; units allotted for money received |
| `fund_distributions`, `distribution_lines` | A dividend of a company or a distribution of a fund: who is entitled to how much, tax deducted, paid or not |
| `nav_runs` | Net asset value on a date, worked out from posted entries, with its basis. Approved by a second person. An accounting figure, not a regulatory valuation |
| `fund_fees` | Management fee of a period: basis × rate × days ÷ 365 |

### Reality and control

| Table | Purpose |
|---|---|
| `materiality` | The amount above which a difference is material, per company, with its basis |
| `cases`, `case_events` | A difference being looked into: status, class of attention, owner, linked records. `case_events` is append-only |
| `verification_runs`, `verification_lines` | Physical verification of assets, stock, cash or documents: what the books say and what was found |
| `confirmations` | What the other side says a balance is: bank, customer, vendor, loan, deposit, investment, another company of the group. `difference` is a generated column |
| `reclassifications` | A posted line moved to another ledger by a new entry; the original is unchanged |
| `allocations` | A shared cost divided between units by a driver, with every recipient's share |

### Simulations and the scenario studio

| Table | Purpose |
|---|---|
| `scenarios` | A named set of assumptions, private or shared |
| `scenario_runs` | The figures a simulation started from and arrived at. `CHECK (label = 'SIMULATION')`. Never updated |
| `twin_drivers` | An assumption with its basis, proposed by one person and approved by another |
| `flow_defs` | A way of working, step by step, with versions. Draft → active → retired |
| `flow_cases`, `flow_case_steps` | One case following a workflow; each step done by whom and when, and the record it points to |

### Platform

| Table | Purpose |
|---|---|
| `notifications`, `notification_prefs`, `attention_rules` | What waits for a person, inside the application; which notices a person wants; who attends to what above which amount |
| `message_templates`, `communications` | Templates with versions; a message prepared for a person to send, whose text cannot be changed afterwards, and the record that it was sent |
| `integrations` | The register of what is connected or planned: scope, risk, environment, where the secret is kept. Never the secret |
| `feature_flags` | A capability switched on or off for the group, a company or a role |
| `backup_checks` | A backup or a restore test, recorded by a person with its evidence. Never changed |
| `import_batches`, `legacy_balances` | A file staged with its checks, then committed or discarded; the trial balance of an earlier system, kept beside the books |
| `fact_ledger_monthly`, `fact_refresh` | Monthly totals by ledger and unit for analysis over years. Derived from posted entries; can always be rebuilt |
| `expense_claim_lines.detail` | The booking behind a travel expense: operator, reference, route, class, and the parts the amount is made of |

## Functions callable by the application

`bootstrap_group` · `grant_membership` · `create_company` · `create_party` · `add_party_role` · `set_party_status` · `add_party_bank` · `verify_party_bank` · `save_journal_draft` · `submit_journal` · `approve_journal` · `reject_journal` · `cancel_journal` · `post_journal` · `reverse_journal` · `set_period_status` · `save_invoice` · `approve_invoice` · `save_payment` · `approve_payment` · `import_bank_transactions` · `suggest_bank_matches` · `set_bank_match` · `ledger_balances` · `ledger_monthly` · `ledger_lines` · `party_ledger_balances` · `open_journal` · `integrity_check` · `run_sentinel` · `review_alert` · `numi_learn`

Added in Phase 2:

`set_account_map` · `save_register_kind` · `save_register_item` · `save_task` · `register_document` · `classify_document` · `link_document` · `save_custom_values` · `save_asset_category` · `save_asset` · `record_asset_event` · `create_depreciation_run` · `propose_depreciation_run` · `cancel_depreciation_run` · `propose_asset_disposal` · `propose_asset_impairment` · `save_purchase_doc` · `submit_purchase_doc` · `approve_purchase_doc` · `reject_purchase_doc` · `select_quotation` · `cancel_purchase_doc` · `link_bill_to_po` · `save_expense_category` · `save_advance` · `submit_advance` · `approve_advance` · `reject_advance` · `release_advance` · `return_advance` · `flag_advance` · `save_claim` · `submit_claim` · `approve_claim` · `reject_claim` · `cancel_claim` · `pay_claim` · `save_cash_box` · `record_cash_count` · `propose_fund_transfer` · `save_promise` · `save_loan` · `disburse_loan` · `pay_loan_instalment` · `save_fixed_deposit` · `place_fixed_deposit` · `close_fixed_deposit` · `save_employee` · `save_salary_structure` · `decide_salary_structure` · `create_payroll_run` · `propose_payroll_run` · `cancel_payroll_run` · `pay_payroll_run`

Added in Phase 3:

`save_inv_category` · `save_warehouse` · `save_inv_item` · `save_inv_lot` · `record_unit_event` · `stock_on_hand` · `save_stock_doc` · `propose_stock_doc` · `cancel_stock_doc` · `create_stock_count` · `record_stock_count` · `review_stock_count` · `propose_stock_count` · `cancel_stock_count` · `save_inv_hold` · `release_inv_hold` · `save_corporate_link` · `save_equity_holder` · `save_holding` · `propose_holding_txn` · `record_holding_valuation` · `decide_holding_valuation` · `save_fund` · `save_commitment` · `save_capital_call` · `submit_capital_call` · `decide_capital_call` · `propose_capital_receipt` · `save_distribution` · `submit_distribution` · `decide_distribution` · `propose_distribution_payment` · `prepare_nav` · `decide_nav` · `propose_fund_fee` · `set_materiality` · `open_case` · `update_case` · `open_verification` · `record_verification` · `complete_verification` · `cancel_verification` · `save_confirmation` · `update_confirmation` · `propose_reclassification` · `save_allocation` · `propose_allocation` · `save_scenario` · `save_scenario_run` · `save_twin_driver` · `decide_twin_driver` · `save_flow_def` · `set_flow_status` · `clone_flow_def` · `start_flow_case` · `complete_flow_step` · `cancel_flow_case` · `refresh_notifications` · `mark_notifications` · `set_notification_pref` · `save_attention_rule` · `save_message_template` · `prepare_communication` · `mark_communication` · `save_integration` · `set_feature_flag` · `record_backup_check` · `stage_import` · `commit_import` · `discard_import` · `refresh_facts` · `system_health`

Functions that must never be called by a client — `propose_posting`, `wf_dispatch`, every `wf_<source>` handler, `open_request`, `decide_request`, `apply_loan_recovery`, `advance_account`, `item_dims`, `record_scopes`, `follow_ups_follow_record`, `inherit_item_confidentiality` — are listed in `numero_private.internal_functions`; `lock_internals()` removes execute rights on them at the end of every migration. Tests T78, T79 and T148 verify it.

Each is a thin wrapper in `public` around the implementation in `numero_private`.

## Schema evolution

Migrations are additive. New companies, modules, fields, workflows, countries and integrations are added as rows or new tables; nothing in the ledger needs to be rebuilt.
