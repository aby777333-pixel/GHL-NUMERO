# Requirements of phases 1 and 2 whose record may have changed because of what phase 3 built

Chosen by key words in the text of the requirement or in its note. Being listed here proves nothing: most of these records will not change.

### 320 FRAUD INCIDENT REGISTER

Phase 1 · module Sentinel · recorded status: PLANNED

NUMERO must support recording suspected or confirmed fraud incidents.
Examples:
Duplicate Payment
Fake Invoice
Unauthorized Payment
Expense Fraud
Procurement Fraud
Asset Theft
Payroll Fraud
Vendor Fraud
Card Misuse
Identity Misuse
Accounting Manipulation
Use statuses:
Reported
Under Review
Investigating
Substantiated
Unsubstantiated
Closed
Do not label a person guilty merely because an anomaly exists.

Recorded note: (none)

### 324 UNDER-THE-TABLE / OFF-BOOK TRANSACTIONS

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

If management discovers an off-book or concealed transaction, NUMERO should help bring it INTO the controlled record.
The objective is:
RECORD → PRESERVE → INVESTIGATE → RECONCILE → CORRECT
Not:
HIDE → DISGUISE → DELETE
Maintain original evidence and corrective accounting entries.

Recorded note: Built: an incident of type 'Off-book transaction reported'; original evidence is attached and can be neither deleted nor altered (T68, T69); follow-ups record the steps of the investigation and their outcome; correcting entries are ordinary journals under approval, and those tagged to the incident's dimension are listed on its page. Not built: the five stages (record, preserve, investigate, reconcile, correct) as a guided workflow; a direct link from the incident to the correcting journals.

### 335 LEGAL CASE COSTING

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Track:
Case
Law Firm
Court Fees
Consultants
Travel
Settlement
Other Costs
Show:
Total Legal Spend
Outstanding
Recoveries

Recorded note: Built: a legal case record with case number, forum, legal status, probability as assessed by counsel, potential amount (CONTINGENT and kept out of projected cash, tested), next hearing (watched) and attachments. Not built: legal spend by law firm, court fees, consultants, travel and settlement; total legal spend, outstanding and recoveries. The legal kind creates no cost dimension, so spending cannot be traced to a case.

### 336 SETTLEMENTS

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Track:
Commercial Settlement
Employee Settlement
Customer Settlement
Vendor Settlement
Insurance Settlement
Legal Settlement
Highly confidential where required.

Recorded note: Built: a settlement can be recorded as an Exceptional Transaction with nature Settlement, amount, party, voucher reference, the approver's name, an explanation (required) and a confidentiality level up to super-admin only. Not built: the kind of settlement (commercial, employee, customer, vendor, insurance, legal) as a field; any posting or approval workflow for the settlement itself. No test covers this.

### 337 WRITE-OFFS

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Track:
Bad Debt
Inventory
Asset
Advance
Receivable
Other
Require:
Reason
Evidence
Approval
Large write-offs can require Super Admin authorization.

Recorded note: Built: a Write-off Request register item with what is to be written off and the justification (both required), recovery efforts, the approver's name and the voucher number; an asset write-off is a proposed entry that another person must approve (T32); any write-off journal follows the amount-based approval rules for journals. Not built: the type of write-off as a field; mandatory evidence; an approval workflow on the request itself (the approver is a typed name); write-off functions for bad debts, advances and receivables; a rule that sends large write-offs to the Super Admin.

### 339 THEFT & LOSS

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Track:
Cash Theft
Inventory Theft
Equipment Theft
Vehicle Theft
Data/Financial Incident where relevant
Financial impact:
Original Value
Recovered Value
Insurance
Net Loss

Recorded note: Built: theft and cyber incidents are recorded with estimated loss, recovered amount and insurance claim reference; a cash count records the difference from the books and raises an alert (T62, T63). Not built: the kinds of theft as separate choices; original value, insurance recovery and net loss as figures (net loss is not calculated).

### 342 REVENUE 360°

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Do not focus only on expenditure.
Revenue categories may include:
Product Sales
Service Revenue
Brokerage
Commission
Rental
Subscription
Consulting
Construction
Property Sales
Investment Income
Interest
Dividend
Royalty
Management Fee
Referral Fee
Asset Sale
Recovery
Refund
Rebate
Other Income
Unlimited custom categories.

Recorded note: (none)

### 344 CANCELLATION LOSS ANALYSIS

Phase 2 · module Expenses · recorded status: PLANNED

Show:
Flight Cancellation Loss
Hotel Cancellation Loss
Contract Cancellation Penalty
Subscription Cancellation Fee
Customer Cancellation Loss
This helps identify avoidable leakage.

Recorded note: No cancellation loss report. A loss can be recorded as an exceptional-transaction register item; nothing adds them up by type.

### 345 NO-SHOW COST

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Unused Flight
Unused Hotel
Unused Event Ticket
Unused Booking
Mark:
NO-SHOW / UNUSED
Show annual cost.

Recorded note: Built: an exceptional-transaction register item with nature 'No-show cost', amount and explanation. Not built: unused flight, hotel, ticket and booking as types; annual cost.

### 346 WASTAGE

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Food Waste where recorded
Material Waste
Inventory Expiry
Damaged Stock
Unused Subscription
Unused Booking
Construction Waste
Do not invent estimated losses without labeling methodology.

Recorded note: Built: an exceptional-transaction register item with nature 'Wastage', amount and a required explanation; an 'Expired / Damaged Stock' ledger in the wellness template. NUMERO estimates no loss: every amount is typed by a person. Not built: the seven types of wastage; a wastage report.

### 347 DEPARTMENTAL BUDGET CONTROL

Phase 1 · module Budgeting · recorded status: PARTIAL

Each department receives configurable:
Annual Budget
Quarterly Budget
Monthly Budget
Categories:
Staff
Travel
Food
Software
Marketing
Equipment
Office
Training
Entertainment
Other

Recorded note: By account. Department budgets need the dimension editor.

### 355 EXCEPTION 360°

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Each exceptional event should show:
Financial Impact
Company
People Involved
Parties
Transactions
Documents
Approvals
Timeline
Recovery
Insurance
Legal Status where applicable

Recorded note: Built: each event has a 360 page with amount, company, one party, documents, follow-ups, history of changes, recovered amount, insurance claim reference and, for incidents, the posted entries tagged to its dimension. Not built: people involved as linked persons (names are typed); approvals (register items have no approval workflow); legal status; transactions for exceptional transactions, disputes and write-offs (these kinds have no cost dimension).

### 356 SUPER ADMIN ACCESS DELEGATION

Phase 1 · module Approvals · recorded status: PARTIAL

Super Admin can grant restricted access.
Example:
Legal Counsel:
Legal cases only.
CFO:
Confidential financial transactions.
Auditor:
Selected records for specified period.
Access can be:
Permanent
Temporary
Case-specific
Read-only

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 357 BREAK-GLASS ACCESS

Phase 1 · module Black Vault · recorded status: PLANNED

For emergencies, create controlled emergency-access functionality where appropriate.
Require:
Reason
Strong Authentication
Explicit Confirmation
Notify designated governance users where configured.
Record immutable audit event.

Recorded note: (none)

### 360 NUMERO FINANCIAL TRUTH PRINCIPLE

Phase 1 · module Truth · recorded status: IMPLEMENTED

GHL NUMERO should distinguish:
PRIVATE
from
FALSE.
PRIVATE means:
Access controlled.
FALSE means:
The accounting record does not reflect reality.
NUMERO supports the first.
NUMERO must be designed to prevent the second.

Recorded note: (none)

### 361 CUSTOM EVERYTHING

Phase 2 · module Genesis Builder · recorded status: PARTIAL

The Super Admin must be able to add:
New Expense Type
New Revenue Type
New Party Type
New Incident Type
New Entertainment Type
New Department
New Office
New Cost Centre
New Project
New Subscription Type
New Utility
New Allowance
New Confidentiality Level
New Approval Workflow
New Custom Field
WITHOUT CODING.

Recorded note: Built: all of the following without coding — expense categories (covers expense and entertainment types), revenue ledgers in the chart of accounts, party types, departments, offices, cost centres and projects (organisation units and new structure levels), incident types and subscription plans (options of a register kind, edited by a Group Super Admin), utilities (register items), allowances (freely named salary components), approval rules (kind of record, company, amount band and steps by role, added and changed on the Approvals page), custom fields (defined in Genesis; those defined for invoices and bills, register items, fixed assets and parties appear on those records, where their values are entered). Not built: new confidentiality levels (the five levels are fixed in the database); an approval workflow beyond such a rule (conditions other than amount, steps taken side by side); custom fields on journals, payments, organisation units and companies, which can be defined but are shown on no screen. The approval rule editor and the custom fields on a party were read in the code; neither has an automated test.

### 362 "I DON'T KNOW WHAT THIS IS" TRANSACTION

Phase 1 · module Approvals · recorded status: PARTIAL

Create a useful temporary workflow:
NEEDS CLASSIFICATION
When an employee/accountant genuinely does not know how to classify something:
Place it in:
Needs Classification
NOT a fake ledger category.
Finance investigates.
AI suggests possibilities.
Authorized user classifies.
Maintain history.

Recorded note: Parks the item in suspense. AI suggestions for it not built.

### 368 FINAL NUMERO PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

GHL NUMERO must be built around a simple reality:
Businesses are messy.
Money moves through:
Banks.
Cash.
Cards.
Employees.
Offices.
Vehicles.
Restaurants.
Hotels.
Airlines.
Software.
Subscriptions.
Vendors.
Agents.
Brokers.
Government.
Customers.
Investors.
Projects.
Accidents.
Insurance.
Refunds.
Cancellations.
Emergencies.
Mistakes.
Losses.
Recoveries.
Disputes.
And sometimes situations that are uncomfortable, confidential, disputed or under investigation.
NUMERO must not pretend those events do not exist.
It must provide a secure, accurate, configurable and auditable mechanism for recording legitimate financial reality.
It must protect confidentiality.
It must preserve evidence.
It must maintain accounting integrity.
It must NEVER turn confidentiality into concealment or false accounting.

Recorded note: (none)

### 373 SUBLEDGERS

Phase 1 · module Accounting · recorded status: PARTIAL

Maintain detailed subledgers for:
Customers
Vendors
Employees
Banks
Assets
Loans
Investors
Agents
Brokers
Contractors
Projects
Properties
Inventory
Control accounts must reconcile with their subledgers.

Recorded note: Built: the party subledger, reconciled with its control accounts (Phase 1); since Phase 2 a fixed asset register compared with its ledgers, ledger by ledger, with any difference shown; a loan register with its schedule; advances held, person by person. Not built: subledgers for inventory, investors, projects and properties; a comparison of the loan register with the loan ledger.

### 374 JOURNAL ENGINE

Phase 1 · module Accounting · recorded status: IMPLEMENTED

Support:
General Journal
Adjustment Journal
Accrual Journal
Depreciation Journal
Reclassification Journal
Intercompany Journal
Closing Journal
Reversal Journal
Correction Journal
Foreign Exchange Journal
Consolidation Journal

Recorded note: (none)

### 381 BALANCE SHEET

Phase 1 · module Reports · recorded status: IMPLEMENTED

Create:
BALANCE SHEET
ASSETS
Current Assets
Cash & Bank
Receivables
Inventory
Advances
Deposits
Prepaid Expenses
Investments
Fixed Assets
Other Assets
LIABILITIES
Payables
Accrued Expenses
Taxes Payable
Loans
Borrowings
Employee Payables
Other Liabilities
EQUITY
Capital
Share Capital where applicable
Reserves
Retained Earnings
Current Profit/Loss
Other applicable equity accounts

Recorded note: (none)

### 386 FUND FLOW

Phase 1 · module Reports · recorded status: PLANNED

Provide fund-flow analysis where useful.
Show movement in:
Working Capital
Sources of Funds
Applications of Funds

Recorded note: (none)

### 387 STATEMENT OF CHANGES IN EQUITY

Phase 1 · module Reports · recorded status: PLANNED

Track:
Opening Equity
Capital Introduced
Profit/Loss
Dividends/Distributions
Reserves
Other Adjustments
Closing Equity
according to entity structure.

Recorded note: (none)

### 389 ACCOUNT RECONCILIATION ENGINE

Phase 1 · module Reconciliation · recorded status: PARTIAL

Create:
NUMERO RECONCILE
Reconcile:
Bank
Cash
Credit Cards
Payment Gateways
Receivables
Payables
Inventory
Loans
Intercompany
Payroll
Taxes
Fixed Assets
Advances
Deposits

Recorded note: Built: bank (Phase 1); cash, as a physical count compared with the book balance (T62); fixed assets, as the register compared with its ledgers. Intercompany differences are shown in the consolidation report. Not built: credit cards, payment gateways, receivables, payables, inventory, loans, payroll, taxes, advances and deposits as reconciliations of their own.

### 396 CONTROL ACCOUNT RECONCILIATION

Phase 1 · module Reconciliation · recorded status: PARTIAL

Automatically compare:
Accounts Receivable Control
against
Customer Subledger Total.
Likewise:
Accounts Payable Control
Payroll Control
Inventory Control
Fixed Asset Control

Recorded note: Built: receivable and payable control accounts compared with the party subledger in a test, with no screen (Phase 1); fixed asset ledgers compared with the asset register on screen and in a test (Phase 2). Not built: a screen for the receivable and payable comparison; payroll control and inventory control.

### 397 MONTH-END CLOSE

Phase 1 · module Period Close · recorded status: PARTIAL

Create:
NUMERO CLOSE
Checklist:
Bank Reconciled
Cash Counted
Credit Cards Reconciled
Receivables Reviewed
Payables Reviewed
Accruals Posted
Prepayments Updated
Inventory Checked
Depreciation Posted
Payroll Posted
Taxes Reviewed
Intercompany Reconciled
Suspense Cleared
Advances Reviewed
FX Revaluation Completed
Documents Checked
Exceptional Transactions Reviewed

Recorded note: 12 computed checks of 17 listed.

### 400 YEAR-END CLOSE

Phase 1 · module Period Close · recorded status: PLANNED

Support:
Year-end Adjustments
Depreciation
Accruals
Provisions
Tax Adjustments
Inventory Adjustments
Audit Adjustments
Closing Entries
Retained Earnings Transfer
Opening Balances

Recorded note: (none)

### 403 AUDIT UNIVERSE

Phase 1 · module Audit · recorded status: PLANNED

Create:
NUMERO AUDIT
Support:
Internal Audit
External Audit
Statutory Audit
Tax Audit
Management Audit
Process Audit
Project Audit
Inventory Audit
Vendor Audit
Expense Audit
Revenue Audit

Recorded note: (none)

### 424 REVENUE FORECAST

Phase 2 · module Forward · recorded status: PARTIAL

Sources:
Contracts
Orders
Subscriptions
Rentals
Project Milestones
Recurring Customers
Approved Pipeline assumptions where integrated
Distinguish:
Contracted Revenue
Expected Revenue
AI/Statistical Forecast

Recorded note: Built: expected inflows from contracts, sales orders, tenant leases and quotations recorded in the registers, labelled CONTRACTED, COMMITTED or POSSIBLE. Not built: subscription income and recurring customers as sources; milestones as dated amounts (text only); a statistical forecast; a forecast of revenue as recognised in the books (these are expected receipts). A quotation counts at its full amount in the all-in projection; the probability recorded by a person is shown, not applied.

### 426 BALANCE SHEET FORECAST

Phase 2 · module Forward · recorded status: PLANNED

Project:
Cash
Receivables
Inventory
Assets
Payables
Borrowings
Equity
based on transparent assumptions.

Recorded note: No projected balance sheet. Forward projects cash only.

### 430 WORKING CAPITAL

Phase 2 · module Treasury · recorded status: PARTIAL

Dashboard:
Receivables
Inventory
Payables
Working Capital
Track trends.

Recorded note: Built: working capital as a figure on the Command Centre, and receivable days, payable days, inventory days and the cash conversion cycle with their formulas. Not built: a working capital dashboard; trends of receivables, inventory, payables and working capital.

### 432 FINANCIAL RATIOS

Phase 1 · module Reports · recorded status: IMPLEMENTED

Provide standard applicable ratios.
Liquidity:
Current Ratio
Quick Ratio
Profitability:
Gross Margin
Operating Margin
Net Margin
ROA
ROE
Leverage:
Debt/Equity
Interest Coverage
Efficiency:
Receivable Days
Payable Days
Inventory Turnover
Never hide calculations.

Recorded note: Formula and inputs always shown.

### 446 CAPEX REQUEST

Phase 1 · module Budgeting · recorded status: PLANNED

Workflow:
Request Asset
Business Justification
Cost
Vendor Quotes
Approval
Purchase
Capitalization

Recorded note: (none)

### 448 ASSET REVALUATION / IMPAIRMENT

Phase 2 · module Assets · recorded status: PARTIAL

Where applicable, support controlled accounting adjustments with professional approval.
Never let AI independently change asset values.

Recorded note: Built: impairment with its basis and the name of the assessor, proposed as an entry that a second person approves. NUMI cannot change an asset value: it has no means of writing. Not built: revaluation upwards. No automated test covers impairment.

### 454 DIRECTOR / SHAREHOLDER ACCOUNTS

Phase 2 · module Treasury · recorded status: PARTIAL

Where applicable track:
Capital Introduced
Loans from Directors
Loans to Directors where lawful
Reimbursements
Dividends
Withdrawals/Drawings where applicable
Keep separate from normal company expenses.

Recorded note: Built: loans from and to directors, and from and to shareholders (both kinds are offered on the loan screen), as loans in their own liability or asset ledger, apart from expenses (T84: a loan taken must sit in a liability ledger); capital infusion and dividend as register items; reimbursements through expense claims. Not built: a director or shareholder account view; drawings. No test uses the director or the shareholder kind of loan.

### 457 FOREX ACCOUNTING

Phase 1 · module Treasury · recorded status: PARTIAL

Track:
Original Currency
Transaction Rate
Settlement Rate
Gain/Loss
Perform approved period-end revaluation.

Recorded note: Settlement difference only.

### 462 INVENTORY RECONCILIATION

Phase 1 · module Reconciliation · recorded status: PLANNED

Compare:
Book Quantity
Physical Quantity
Difference
Value Difference
Require approved adjustment.

Recorded note: (none)

### 465 TAX RECONCILIATION

Phase 1 · module Reconciliation · recorded status: PLANNED

Provide configurable reconciliation workflows for applicable taxes.
Example:
Books
Tax Register
Filed/Reported Data
Flag differences.

Recorded note: (none)

### 471 COST CENTRE ACCOUNTING

Phase 1 · module Accounting · recorded status: PLANNED

Track cost accumulation and allocation.

Recorded note: (none)

### 480 CASH RUNWAY

Phase 1 · module Expenses · recorded status: PARTIAL

Based on selected assumptions:
Current Cash / Estimated Net Cash Burn.
Clearly label assumptions and limitations.

Recorded note: Run-rate based.

### 481 FINANCIAL ALERT ENGINE

Phase 1 · module Reconciliation · recorded status: PLANNED

Alerts may include:
Cash Below Threshold
Receivable Overdue
Large Payment Due
Budget Exceeded
Expense Spike
Margin Decline
Suspense Too Old
Bank Not Reconciled
Period Not Closed
Loan Payment Due
Tax Deadline
Negative Cash Projection

Recorded note: (none)

### 485 REPORT SIGN-OFF

Phase 1 · module Audit · recorded status: PLANNED

Configured workflow:
Prepared By
Reviewed By
Approved By
Store digital sign-off.

Recorded note: (none)

### 486 BOARD FINANCIAL PACK

Phase 2 · module Forward · recorded status: PLANNED

Generate:
Executive Summary
P&L
Balance Sheet
Cash Flow
Budget vs Actual
Forecast
Working Capital
Major Investments
Major Risks/Exceptions
Management Commentary

Recorded note: No board pack is generated. The statements exist as separate reports from phase 1; management commentary, major investments and a forecast section do not exist.

### 490 FINANCIAL DOCUMENT PACK

Phase 2 · module Documents · recorded status: PLANNED

One-click generation of approved:
P&L
Balance Sheet
Cash Flow
Trial Balance
General Ledger
Receivables
Payables
Bank Reconciliation
Fixed Assets
Inventory
Tax Reports

Recorded note: No one-click document pack. Each report is opened and exported on its own.

### 503 ACCOUNTING INTEGRITY DASHBOARD

Phase 1 · module Reports · recorded status: PARTIAL

Show:
Debit/Credit Integrity
Bank Reconciliation Status
Suspense Balance
Intercompany Differences
Unclosed Periods
Missing Documents
Unapproved Journals
Control Account Differences
The ideal state:
ALL BOOKS BALANCED

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 504 FINANCIAL CONTROL TOWER

Phase 1 · module NUMI · recorded status: IMPLEMENTED

Create the ultimate Owner view:
GHL NUMERO CONTROL TOWER
Across every authorized company:
TOTAL CASH
TOTAL REVENUE
TOTAL EXPENDITURE
TOTAL PROFIT
TOTAL ASSETS
TOTAL LIABILITIES
TOTAL DEBT
TOTAL RECEIVABLES
TOTAL PAYABLES
TOTAL INVESTMENTS
TOTAL COMMITTED EXPENDITURE
FORECAST CASH
Then:
COMPANIES
DEPARTMENTS
PROJECTS
BANKS
CUSTOMERS
VENDORS
PEOPLE
ASSETS
INVESTMENTS
TAX
AUDIT
FORECAST
BLACK VAULT
ASK NUMERO

Recorded note: (none)

### 506 FINANCIAL CHANGE EXPLAINER

Phase 2 · module Treasury · recorded status: PARTIAL

Ask:
"What changed between these two Balance Sheets?"
NUMERO identifies actual movements.
Cash
Receivables
Inventory
Assets
Loans
Payables
Equity

Recorded note: Built: NUMI compares the profit and loss of two periods and names the ledgers that moved; the cash flow statement shows the movement in receivables, payables, fixed assets and borrowings for a period. Not built: a comparison of two balance sheets.

### 511 NO SILENT AUTO-POSTING OF MATERIAL JUDGMENTS

Phase 1 · module Accounting · recorded status: IMPLEMENTED

AI can automate routine rules according to configured permissions.
But judgments involving:
Material Adjustments
Provisions
Write-offs
Asset Revaluation
Tax Positions
Audit Adjustments
Exceptional Transactions
must require appropriate human authorization.

Recorded note: (none)

### 513 FINAL ACCOUNTING DIRECTIVE

Phase 1 · module Accounting · recorded status: PLANNED

GHL NUMERO must answer three different questions.
THE PAST
What happened?
Where did the money go?
Where did it come from?
Who authorized it?
What accounting entry recorded it?
Can we prove it?
THE PRESENT
How much cash do we have?
Are we profitable?
What do customers owe us?
What do we owe?
What assets and liabilities exist?
Are the books balanced?
Are accounts reconciled?
THE FUTURE
What money is expected?
What payments are coming?
What commitments exist?
What does the forecast show?
What happens under different scenarios?
Where could liquidity become tight?
What assumptions drive the answer?

Recorded note: (none)

### 514 FINAL COMPLETENESS PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO must bring together:
BOOKKEEPING
ACCOUNTING
EXPENSE MANAGEMENT
REVENUE MANAGEMENT
BANKING
CASH
PETTY CASH
PAYROLL ACCOUNTING
VENDORS
CUSTOMERS
EMPLOYEES
BROKERS
AGENTS
FREELANCERS
CONTRACTORS
OFFICES
VEHICLES
TRAVEL
INVENTORY
ASSETS
LOANS
INVESTMENTS
PROJECTS
PROPERTIES
TAX
BUDGETING
FORECASTING
TREASURY
RECONCILIATION
P&L
BALANCE SHEET
CASH FLOW
TRIAL BALANCE
AUDITING
CONTROLS
CONSOLIDATION
FINANCIAL ANALYSIS
AI
CONFIDENTIAL FINANCE
EXCEPTION MANAGEMENT
DOCUMENTS
APPROVALS
AND COMPLETE AUDITABILITY.
All inside one coherent architecture.

Recorded note: (none)

### 515 THE NUMERO TEST

Phase 1 · module Engineering Governance · recorded status: PLANNED

At any moment the Group Super Admin should be able to ask:
"Numero, tell me the complete financial position of everything I own and operate."
NUMERO should be capable of answering from authorized data:
How much cash exists.
Where it is.
How much came in.
How much went out.
What revenue was earned.
What expenses were incurred.
What profit/loss resulted.
What assets exist.
What liabilities exist.
Who owes money.
Who must be paid.
What loans exist.
What investments exist.
What taxes may be due.
What budgets remain.
What commitments exist.
What is reconciled.
What is not reconciled.
What is under audit.
What is unusual.
What is confidential.
What requires approval.
What is expected tomorrow.
What is expected next month.
What the forecast indicates.
And the evidence supporting every material answer.

Recorded note: (none)

### 516 NUMERO UNIVERSAL INBOX

Phase 2 · module Documents · recorded status: PARTIAL

Create:
NUMERO INBOX
This becomes the universal financial intake point for the entire GHL ecosystem.
Accept:
Invoices
Bills
Receipts
Credit Notes
Debit Notes
Purchase Orders
Contracts
Bank Statements
Credit Card Statements
Expense Receipts
Travel Bills
Hotel Bills
Fuel Receipts
Utility Bills
Tax Documents
Insurance Documents
Claims
Payroll Documents
Spreadsheets
CSV Files
PDFs
Images
Scanned Documents
Authorized Emails
Authorized API Data

Recorded note: Built: one inbox per company for uploaded files (PDF, images, spreadsheets, CSV, Word, saved e-mail files, text), each fingerprinted, classified by a person into one of 23 kinds and linked to a record; documents cannot be deleted or altered (tested). Not built: intake of authorised e-mails and of data through an interface; claims and statements are stored as files only. Upload to the live storage bucket was not exercised against the live system.

### 518 DOCUMENT-TO-ACCOUNTING PIPELINE

Phase 2 · module Forward · recorded status: PARTIAL

Workflow:
DOCUMENT RECEIVED
↓
DOCUMENT CLASSIFIED
↓
DATA EXTRACTED
↓
PARTY IDENTIFIED
↓
COMPANY IDENTIFIED
↓
DUPLICATE CHECK
↓
PO / CONTRACT MATCH
↓
TAX CHECK
↓
ACCOUNTING SUGGESTION
↓
APPROVAL
↓
POSTING
↓
PAYMENT / COLLECTION
↓
RECONCILIATION
↓
ARCHIVE
↓
AUDIT TRAIL

Recorded note: Built: a document is received by upload, classified and linked to a party and a record by a person, checked for an identical file (T66); a bill is compared with its purchase order and receipts (T100 to T102); entries go through approval and posting; documents are kept permanently with an audit trail (T68). Not built: data extraction, automatic identification of party or company, contract match, tax check on the document, accounting suggestion from the document.

### 519 EMAIL-TO-NUMERO

Phase 2 · module Documents · recorded status: PLANNED

Support dedicated authorized finance inbox integrations.
Examples:
bills@company
expenses@company
invoices@company
NUMERO can ingest permitted attachments and route them into NUMERO INBOX.
Email itself remains linked as supporting evidence where permitted.

Recorded note: No e-mail intake. A saved e-mail file can be uploaded by a person.

### 527 GOODS RECEIPT

Phase 1 · module Accounts Payable · recorded status: PLANNED

Create:
GRN
Record:
Goods Received
Quantity
Condition
Warehouse
Date
Receiver
PO Reference

Recorded note: (none)

### 533 COLLECTION WORKFLOW

Phase 1 · module Approvals · recorded status: PLANNED

Invoice Due
↓
Reminder
↓
Follow-up
↓
Promise to Pay
↓
Payment
or
↓
Dispute / Escalation

Recorded note: (none)

### 537 PDC REGISTER

Phase 1 · module Banking · recorded status: PLANNED

Create:
POST-DATED CHEQUE REGISTER
Track upcoming cheque dates.
Notify responsible users.

Recorded note: (none)

### 538 PAYMENT FACTORY

Phase 1 · module Banking · recorded status: PLANNED

Create centralized:
NUMERO PAY
Across authorized GHL companies.
Workflow:
Approved Payables
↓
Payment Proposal
↓
Finance Review
↓
Maker
↓
Checker
↓
Authorized Signatory
↓
Bank / Payment Provider
↓
Payment Confirmation
↓
Accounting
↓
Reconciliation

Recorded note: (none)

### 543 PAYROLL UNIVERSE

Phase 2 · module Payroll · recorded status: PARTIAL

Create:
NUMERO PAYROLL FINANCE
This may integrate with HR systems while maintaining accounting controls.

Recorded note: Built: employees, salaries with approval and history, monthly runs, journals by department, payment of salaries, privacy; all tested. Not built: integration with an HR system, statutory calculations, payslips, attendance and leave.

### 552 TREASURY COMMAND CENTRE

Phase 2 · module Treasury · recorded status: PARTIAL

Create:
NUMERO TREASURY
Show:
Cash
Banks
Fixed Deposits
Loans
Credit Facilities
Investments
FX
Guarantees
Letters of Credit
Upcoming Payments
Expected Collections

Recorded note: Built: cash, banks, fixed deposits, loans, credit facilities, guarantees, letters of credit and forex exposure on one page, with loan instalments falling due. Facilities, guarantees and letters of credit are register records. Not built: investments; upcoming payments other than loan instalments and expected collections are on the Forward page, not here.

### 556 CREDIT FACILITY REGISTER

Phase 2 · module Treasury · recorded status: PARTIAL

Track:
Sanctioned Limit
Utilized
Available
Interest
Expiry
Security
Covenants

Recorded note: Built: sanctioned limit, drawn amount as last updated by a person, security, review date with a warning. Not built: the available amount, the interest rate, a link to covenants, utilisation taken from the ledger.

### 557 BANK GUARANTEES

Phase 1 · module Banking · recorded status: PLANNED

Track:
BG Number
Bank
Beneficiary
Amount
Purpose
Issue Date
Expiry
Margin
Charges
Alerts before expiry.

Recorded note: (none)

### 558 LETTERS OF CREDIT

Phase 2 · module Treasury · recorded status: PARTIAL

Track:
LC
Applicant
Beneficiary
Bank
Amount
Currency
Shipment
Expiry
Documents
Charges

Recorded note: Built: LC number, issuing bank, party, amount, currency, margin, settlement date, expiry, attached documents. Not built: applicant and beneficiary as separate fields, shipment, charges.

### 560 INVESTMENT TREASURY

Phase 2 · module Treasury · recorded status: PARTIAL

Track authorized corporate investments:
Deposits
Bonds
Funds
Equity
Other Investments
Separate accounting from valuation assumptions.

Recorded note: Built: fixed deposits, with the maturity value labelled as calculated and the interest taken from what the bank paid. Not built: bonds, funds, equity and other investments.

### 562 OWNERSHIP

Phase 1 · module Consolidation · recorded status: PLANNED

Store:
Shareholders
Ownership %
Effective Date
Changes
Historical ownership must remain available.

Recorded note: (none)

### 567 INVENTORY ADVANCED

Phase 2 · module Expenses · recorded status: PLANNED

Expand inventory to support:
Batch
Lot
Serial Number
Expiry
Warehouse
Bin
Goods in Transit
Consignment
Reserved Stock
Damaged Stock
Obsolete Stock
Expired Stock

Recorded note: No inventory module: no batch, lot, serial number, expiry, warehouse, bin or stock status.

### 569 INVENTORY AGEING

Phase 1 · module Reports · recorded status: PLANNED

Show:
0–30
31–60
61–90
91–180
180+
and appropriate expiry views.

Recorded note: (none)

### 572 IMPORT / EXPORT ADVANCED

Phase 1 · module Reports · recorded status: PLANNED

Expand to:
Shipment
Container
BL / AWB
Freight
Insurance
Customs
Duty
CHA
Port Charges
Demurrage
Detention
Warehouse
Inland Transport

Recorded note: (none)

### 574 ASSET LIFECYCLE

Phase 2 · module Assets · recorded status: PARTIAL

Full lifecycle:
Request
↓
Approval
↓
Purchase
↓
Receipt
↓
Capitalization
↓
Assignment
↓
Maintenance
↓
Transfer
↓
Impairment / Revaluation where applicable
↓
Sale / Disposal / Scrap

Recorded note: Built: request, approval, purchase order and receipt (purchase-to-pay); registration of the asset, which can name the vendor's bill it was bought on, and the page of the asset opens that bill; assignment, maintenance, transfer, impairment; sale, scrap and write-off. Not built: capitalisation that follows from the purchase — the asset is registered by hand, and the bill is chosen by a person, not proposed from the receipt or the order; revaluation. No automated test covers the link to the bill.

### 576 PROPERTY & LEASE MANAGEMENT

Phase 2 · module Projects · recorded status: IMPLEMENTED

Track:
Owned Property
Leased Property
Rental Property
Office
Warehouse
Land
Commercial Unit

Recorded note: Property register item with type owned, leased, rental, office, warehouse, land, commercial unit or guest house, address, area and property tax date; rent, lease and tenant-lease register items for the agreements. One type is chosen per property, so 'leased' and 'office' cannot both be recorded. No automated test covers the property kind.

### 581 AIF / FUND ACCOUNTING ADVANCED

Phase 2 · module Expenses · recorded status: PARTIAL

For appropriate entities support configurable:
Investor Commitments
Capital Calls
Contributions
Units
Investor Capital Accounts
Portfolio Investments
Valuation Inputs
NAV Workflow
Management Fees
Expenses
Distributions
Realized Gain/Loss
Unrealized Gain/Loss
Regulatory and valuation processes must be professionally validated.

Recorded note: Built: a fund company template with ledgers for unit capital, portfolio investments, management fees, realised and unrealised gains; a 'fund' tag; capital call register item (commitment, called to date) and distribution register item that appear in Forward. Not built: units, investor capital accounts, contributions per investor, valuation inputs, NAV workflow.

### 582 TAX & COMPLIANCE CALENDAR

Phase 1 · module Tax · recorded status: PLANNED

Create:
NUMERO COMPLIANCE
Track company-specific applicable deadlines.
Examples:
GST
TDS
Payroll-related obligations
Income Tax
Corporate Filings
Audit
Licences
Insurance
Contract Renewals

Recorded note: (none)

### 585 TRANSFER-PRICING SUPPORT

Phase 1 · module Tax · recorded status: PLANNED

For appropriate intercompany transactions maintain:
Transaction Type
Companies
Basis
Allocation
Supporting Calculation
Documentation Reference
Professional tax review remains required.

Recorded note: (none)

### 590 DIGITAL SIGN-OFF

Phase 1 · module Audit · recorded status: PLANNED

Important workflows can require authenticated sign-off:
Financial Statements
Reconciliations
Journals
Payment Batches
Budgets
Forecasts
Close
Audit Responses

Recorded note: (none)

### 591 DISASTER RECOVERY

Phase 2 · module Incidents & Exceptions · recorded status: PLANNED

Implement serious business continuity.
Encrypted Backups
Point-in-Time Recovery
Backup Replication
Restore Testing
Recovery Procedures

Recorded note: No encrypted backup, point-in-time recovery, backup replication, restore test or recovery procedure is set up or documented in the project. No live account exists yet.

### 596 API SECURITY

Phase 1 · module Security · recorded status: PLANNED

Implement:
OAuth where appropriate
Scoped Tokens
API Keys
Rate Limits
Webhook Signatures
Secret Rotation
Integration Logs

Recorded note: (none)

### 597 NUMERO INTEGRATION HUB

Phase 1 · module Reports · recorded status: PLANNED

Connect NUMERO with authorized:
Banks
Payment Gateways
HRMS
CRM
Payroll
E-commerce
POS
Logistics
Inventory
Google Workspace
Microsoft 365
Document Storage
Communication Providers
Government/Tax APIs where supported
Other GHL Systems

Recorded note: (none)

### 600 AUTOPILOT CONTROL LEVELS

Phase 1 · module Approvals · recorded status: PLANNED

Super Admin chooses level.
LEVEL 0 — OFF
Manual.
LEVEL 1 — OBSERVE
AI analyzes only.
LEVEL 2 — SUGGEST
AI proposes actions.
LEVEL 3 — PREPARE
AI prepares drafts.
LEVEL 4 — AUTOMATE APPROVED ROUTINES
Only specifically authorized deterministic/routine workflows can execute automatically.
Material judgments and money movement remain controlled.

Recorded note: (none)

### 603 NUMERO FINANCIAL INTEGRITY ENGINE

Phase 1 · module Reconciliation · recorded status: PLANNED

Create one of the most important components:
FINANCIAL INTEGRITY
Continuously evaluate reconciliation status.

Recorded note: (none)

### 604 UNIVERSAL RECONCILIATION

Phase 1 · module Reconciliation · recorded status: PLANNED

Attempt to reconcile:
BANK ↔ BOOKS
CASH ↔ BOOKS
CARD ↔ EXPENSE
CUSTOMER ↔ RECEIVABLE
VENDOR ↔ PAYABLE
INVENTORY ↔ LEDGER
ASSET REGISTER ↔ LEDGER
PAYROLL ↔ BANK ↔ LEDGER
TAX ↔ BOOKS ↔ FILED/REPORTED DATA
COMPANY A ↔ COMPANY B
ADVANCE ↔ SETTLEMENT
PO ↔ GRN ↔ INVOICE ↔ PAYMENT
INVOICE ↔ RECEIPT ↔ BANK
CONTRACT ↔ BILLING ↔ PAYMENT
INVESTMENT RECORD ↔ ACCOUNTING

Recorded note: (none)

### 609 NUMERO COMMAND

Phase 1 · module NUMI · recorded status: IMPLEMENTED

Create universal natural-language financial command interface.
ASK NUMERO
Examples:
"Show every rupee spent on travel from April to September."
"Split it by company."
"Now by employee."
"Show hotels."
"Show top 10."
"Compare with last year."
"Open the largest invoice."
The conversation retains financial query context.

Recorded note: (none)

### 614 ASK NUMERO — FORECAST

Phase 1 · module NUMI · recorded status: PLANNED

"What happens if collections are delayed 30 days?"
Run simulation.
Clearly label:
SIMULATION
Do not alter books.

Recorded note: (none)

### 619 NUMERO CONTROL ROOM

Phase 2 · module Forward · recorded status: PARTIAL

Create Owner-level:
FINANCIAL CONTROL ROOM
Panels:
CASH
PROFIT
REVENUE
EXPENSE
RECEIVABLES
PAYABLES
TREASURY
DEBT
INVESTMENTS
TAX
PAYROLL
PROJECTS
ASSETS
INVENTORY
BUDGET
FORECAST
AUDIT
FINANCIAL INTEGRITY
AUTOPILOT
BLACK VAULT

Recorded note: Built: panels for cash, profit, revenue, expenditure, receivables, payables, treasury (borrowings and investments together), tax, risk, approvals, anomalies, NUMI and integrity. Not built: panels for payroll, projects, assets, inventory, budget, forecast, audit, autopilot and black vault; debt and investments as separate panels.

### 625 COLLECTION CALENDAR

Phase 1 · module Accounts Receivable · recorded status: PARTIAL

Show expected:
Customer Collections
Rent
Commission
Investment-related Receipts
Other Receipts

Recorded note: Built: the Forward calendar places on their dates the expected customer collections (the promised or estimated date is shown beside the due date), tenant rent, contracted inflows, maturing deposits, capital calls, advances to be returned and other recorded inflows. Not built: a register kind for commission receivable or for investment income — they can be recorded only under another kind; an inflow recorded without an amount is not placed; amounts of register items, loans, deposits and advances held in another currency are not converted (Forward states how many such items it counts at face value, and in which currencies).

### 626 MONEY TIMELINE

Phase 2 · module Treasury · recorded status: PARTIAL

Choose company.
Visual timeline:
Money In
Money Out
Large Transactions
Payroll
Tax
Investments
Loans
Exceptional Events

Recorded note: Built: a calendar and a list of future money in and out by date and category (payroll, taxes, loans) for the selected companies; the Money Map of past flows. Not built: a timeline of past and future money on one line; large transactions and exceptional events marked.

### 631 DATA PROVENANCE

Phase 1 · module Truth · recorded status: PLANNED

NUMERO should know whether data came from:
Manual Entry
Bank Feed
CSV Import
API
OCR
Email
Integration
AI Extraction

Recorded note: (none)

### 633 CONFIGURATION VERSIONING

Phase 1 · module Reports · recorded status: PARTIAL

Version changes to:
Chart of Accounts
Tax Rules
Approval Rules
Accounting Policies
Expense Policies
Commission Rules
Allocation Rules
AI Automation Rules

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 636 MASS CORRECTION

Phase 1 · module Accounting · recorded status: PLANNED

Authorized Finance users can correct large imported datasets through controlled workflows.
Never silently overwrite posted history.

Recorded note: (none)

### 637 OPENING BALANCE MIGRATION

Phase 1 · module Reports · recorded status: PLANNED

Support migration from old systems.
Import:
Opening Assets
Liabilities
Equity
Receivables
Payables
Inventory
Loans
Fixed Assets
Require balancing.

Recorded note: (none)

### 638 LEGACY ACCOUNTING MIGRATION

Phase 1 · module Reports · recorded status: PLANNED

Provide mapping framework for imports from systems such as:
Tally
ERP exports
Excel
CSV
Other accounting systems
Do not depend on one vendor-specific format.

Recorded note: (none)

### 640 YEAR-END READINESS

Phase 1 · module Period Close · recorded status: PLANNED

Similar dashboard for annual close.
Include:
Audit Queries
Asset Verification
Inventory Count
Tax Review
Intercompany Confirmation
Balance Confirmations
Accruals
Provisions

Recorded note: (none)

### 642 BANK CONFIRMATION TRACKER

Phase 1 · module Banking · recorded status: PLANNED

Track audit confirmation requests.
Bank
Account
Requested
Received
Difference

Recorded note: (none)

### 643 CUSTOMER/VENDOR BALANCE CONFIRMATION

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Generate statements/confirmation requests.
Track:
Sent
Confirmed
Difference
Resolved

Recorded note: (none)

### 644 MANAGEMENT REPRESENTATION WORKFLOW

Phase 1 · module Approvals · recorded status: PLANNED

Where appropriate, provide document workflow for management representation and financial sign-off.

Recorded note: (none)

### 645 NUMERO BOARDROOM

Phase 2 · module Forward · recorded status: PLANNED

Create:
BOARDROOM MODE
A clean executive presentation of approved financial information.
Revenue
Profit
Cash
Debt
Working Capital
Budget
Forecast
Major Projects
Capital Allocation
Key Exceptions
No accounting clutter.

Recorded note: No boardroom mode. Home has a Simple presentation level, which changes wording only and is not an executive presentation of approved figures.

### 646 NUMERO ACCOUNTANT DESK

Phase 1 · module Reconciliation · recorded status: PLANNED

Professional workspace:
Journal
Ledger
Trial Balance
Reconciliation
Close
Tax
Assets
Inventory
Reports
Audit

Recorded note: (none)

### 656 NUMERO NEVER CONFUSES FORECAST WITH FACT

Phase 1 · module Forward · recorded status: IMPLEMENTED

Every value must have state:
ACTUAL
COMMITTED
BUDGET
FORECAST
SIMULATION
AI ESTIMATE
These states must remain visually distinct.

Recorded note: (none)

### 660 THE FINAL NUMERO LOOP

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO should ultimately operate this complete financial loop:
CAPTURE
Everything entering the financial universe.
↓
UNDERSTAND
Document, Party, Company, Purpose, Tax, Project.
↓
VERIFY
Duplicates, Policy, Contract, PO, Evidence.
↓
APPROVE
Correct authority.
↓
ACCOUNT
Double-entry posting.
↓
PAY / COLLECT
Controlled money movement.
↓
RECONCILE
Compare reality with books.
↓
REPORT
P&L, Balance Sheet, Cash Flow and management information.
↓
AUDIT
Preserve evidence and accountability.
↓
FORECAST
Understand likely future financial position.
↓
ALERT
Surface items requiring attention.
↓
LEARN
Improve suggestions from approved historical decisions.
↓
REPEAT
Continuously.

Recorded note: (none)

### 662 FINAL MASTER PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

GHL NUMERO is not merely:
ACCOUNTING SOFTWARE.
It is:
BOOKKEEPING
ACCOUNTING
FINANCE
TREASURY
PROCUREMENT
EXPENSE MANAGEMENT
REVENUE MANAGEMENT
PAYROLL ACCOUNTING
ASSET MANAGEMENT
INVENTORY
PROJECT ACCOUNTING
BANKING
COLLECTIONS
PAYMENTS
BUDGETING
FORECASTING
TAX SUPPORT
COMPLIANCE
AUDIT
DOCUMENT INTELLIGENCE
FINANCIAL CONTROLS
AI
MANAGEMENT INTELLIGENCE
COMPLETE FINANCIAL TRACEABILITY.

Recorded note: (none)

### 663 THE FUNDAMENTAL CHANGE

Phase 1 · module Sentinel · recorded status: PLANNED

Traditional accounting asks:
WHAT HAPPENED?
NUMERO must additionally ask:
WHAT HAS ALREADY BEEN AGREED?
WHAT MONEY IS COMMITTED?
WHAT MONEY MAY COME IN?
WHAT MONEY WILL PROBABLY GO OUT?
WHAT IS DUE SOON?
WHAT COULD GO WRONG?
WHAT DOES NOT LOOK NORMAL?
WHAT REQUIRES HUMAN ATTENTION?
NUMERO therefore operates across four financial dimensions:
PAST
Actual recorded financial events.
PRESENT
Current financial position.
FUTURE
Commitments, obligations, expected inflows/outflows and forecasts.
EXCEPTIONS
Anomalies, mismatches, control failures and potential fraud.

Recorded note: (none)

### 664 NUMERO FORWARD

Phase 1 · module Forward · recorded status: PARTIAL

Create:
NUMERO FORWARD
A dedicated financial-future engine.
NUMERO FORWARD monitors everything capable of creating future financial consequences.

Recorded note: Built: a dedicated engine that builds every known future money event from open invoices and bills, promises to pay, approved purchase orders, the registers (50 kinds, and any the administrator adds), loans, deposits, payroll, claims and advances, each with its source, certainty and basis; cash horizons, calendar, early warnings, commitments and payment priority on the Forward screen; a source the viewer may not read is named on screen, not silently left out. Not built: monitoring that runs by itself and notifies anyone — Forward is calculated when it is opened or asked; statistical forecasts and scenarios; tax worked out from the books; conversion of register items, loans, deposits, advances and claims held in another currency (Forward states how many such items it counts at face value, and in which currencies).

### 666 FINANCIAL CERTAINTY LEVELS

Phase 2 · module Forward · recorded status: PARTIAL

Future amounts must NOT all be treated equally.
Classify appropriately as:
ACTUAL
Already occurred.
CONTRACTED
Legally/commercially committed according to recorded contract.
COMMITTED
Approved obligation such as PO.
SCHEDULED
Known recurring payment.
EXPECTED
Reasonably expected from documented business activity.
FORECAST
Model-derived estimate.
CONTINGENT
Dependent on uncertain future event.
SIMULATION
What-if only.
Never mix these categories.

Recorded note: Built: every future amount carries one of DUE, CONTRACTED, COMMITTED, SCHEDULED, EXPECTED, PROBABLE, POSSIBLE, CONTINGENT or FORECAST; ACTUAL is used only for the cash of today; contingent amounts are kept out of every projection (tested); firm and other amounts are shown as separate figures. Not built: SIMULATION, because no what-if exists. The all-in projection adds firm, expected, possible and forecast amounts into one figure, labelled FORECAST, with the firm-only figure beside it.

### 667 PRE-ACCOUNTING EVENT ENGINE

Phase 2 · module Expenses · recorded status: IMPLEMENTED

NUMERO must understand commercial events before journals exist.
Examples:
Quotation
Negotiation
Letter of Intent
Contract
Purchase Requisition
Purchase Order
Sales Order
Booking
Subscription
Lease
Employee Claim
Payroll Run
Commission Entitlement
Capital Call
Loan Schedule
Insurance Renewal
Tax Estimate
Construction Certification
Guarantee
Legal Claim

Recorded note: Quotations, negotiations, contracts, requisitions, purchase orders, sales orders, subscriptions, leases, employee claims, payroll runs, commission, capital calls, loan schedules, insurance renewals, tax deadlines, guarantees and legal claims are recorded and shown in Forward without a journal (tested for the sources Forward reads). Letter of intent and booking have no kind of their own; they are recorded as 'Other' or as a kind added by the Group Super Admin. Construction certification is a typed field on a work order.

### 681 INVESTOR FLOW FORECAST

Phase 2 · module Forward · recorded status: PARTIAL

For appropriate investment entities:
Expected Capital Calls
Expected Contributions
Expected Distributions
Management Fees
Fund Expenses
Portfolio Investment Commitments
Keep forecasts separate from actual investor accounting.

Recorded note: Built: capital calls (with total commitment and called to date), capital infusions and dividends or distributions are register items shown in Forward as EXPECTED, apart from the books. Not built: management fees, fund expenses and portfolio investment commitments as kinds; investor accounting itself.

### 683 CREDIT CARD FUTURE OBLIGATION

Phase 2 · module Forward · recorded status: PARTIAL

Track:
Current Unbilled
Statement Amount
Payment Due
Expected Recurring Charges
Available Limit

Recorded note: Built: a Credit / Corporate Card register item with card holder, last four digits, limit, statement day, payment due day and an expected payment amount and date entered by a person, shown in Forward as EXPECTED. Not built: current unbilled amount, statement amount, expected recurring charges and available limit; there is no card feed or statement import.

### 685 INSURANCE RENEWAL FORECAST

Phase 2 · module Forward · recorded status: PARTIAL

Track:
Premium
Policy Expiry
Renewal Date
Expected Premium
Coverage
Claims

Recorded note: Built: an insurance policy with premium and frequency, policy expiry (watched), renewal date, cover type, sum insured and what is insured; expiry and renewal raise warnings (tested). Not built: an expected renewal premium separate from the current premium (only an agreed escalation percentage); claims listed against the policy (an insurance claim item carries the policy number as text).

### 689 GUARANTEE REGISTER

Phase 2 · module Treasury · recorded status: IMPLEMENTED

Track:
Bank Guarantees
Corporate Guarantees
Performance Guarantees
Financial Guarantees
Amount
Beneficiary
Expiry
Potential Exposure

Recorded note: Bank and corporate guarantees with amount, beneficiary (required), expiry and claim expiry; performance and financial are types of a bank guarantee. The total outstanding is shown as CONTINGENT, and in Forward a guarantee given is a contingent amount dated at its expiry, beside the projection and never inside it. The tests cover the expiry warning and that exposure; no test records a guarantee through the register with its beneficiary and type, so the status is IMPLEMENTED and not TESTED. A guarantee is a record: invocation has no accounting of its own.

### 690 LC / BG FORWARD VIEW

Phase 2 · module Forward · recorded status: PARTIAL

Show upcoming:
LC Settlement
BG Expiry
Margin Requirements
Fees
Potential Cash Requirement

Recorded note: Built: warnings for guarantee expiry and claim expiry (tested) and for the settlement date and expiry of a letter of credit; the amount of a letter of credit is a COMMITTED outflow in Forward; a guarantee given is shown in Forward as a CONTINGENT amount dated at its expiry, beside the projection and never inside it, as the cash that would be needed if it were called (tested); Registers totals contingent exposure. Not built: margin and fees in the forward view (they are recorded on the item only).

### 695 CAPITAL INFUSION

Phase 2 · module Treasury · recorded status: PARTIAL

Track:
Proposed
Approved
Committed
Received
By:
Shareholder
Investor
Group Company
Other approved source

Recorded note: Built: a capital infusion register item with party (the source), amount, instrument and a state chosen from the list the database accepts, which includes proposed, approved, committed and received. Not built: the amounts proposed, approved, committed and received as separate figures; a link to the receipt in the books.

