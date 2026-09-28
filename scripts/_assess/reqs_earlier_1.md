# Requirements of phases 1 and 2 whose record may have changed because of what phase 3 built

Chosen by key words in the text of the requirement or in its note. Being listed here proves nothing: most of these records will not change.

### 1 CORE ARCHITECTURE

Phase 1 · module Multi-Company · recorded status: IMPLEMENTED

The hierarchy should support:
Umbrella / Group
→ Legal Entity / Company
→ Business Unit
→ Branch
→ Department
→ Division
→ Cost Centre
→ Profit Centre
→ Project
→ Property / Site
→ Fund / Scheme
→ Portfolio
→ Warehouse
→ Store
→ Team
Allow additional hierarchy levels to be created without modifying source code.
Each company must remain independently accounted for while allowing authorized Group Super Admins to see consolidated information.
Companies must never accidentally share financial data.
Use strict tenant isolation and granular permissions.

Recorded note: Hierarchy levels are data; new levels need no code.

### 2 OWNER SUPER ADMIN

Phase 1 · module Multi-Company · recorded status: PARTIAL

Create a supreme Group Super Admin / Owner Console.
The Super Admin can:
Create companies.
Archive companies.
Create company groups.
Clone company configurations.
Create branches.
Create departments.
Create users.
Create roles.
Create custom roles.
Assign accountants.
Assign auditors.
Assign finance managers.
Assign department heads.
Control every permission.
View every company.
View consolidated accounts.
Drill from group numbers into individual transactions.
Approve/reject transactions.
Lock accounting periods.
Reopen periods with authorization.
Control integrations.
Control AI permissions.
Control banking access.
Control reports.
Control exports.
Control audit access.
Control sensitive-data visibility.
Impersonate authorized application roles for troubleshooting, with full audit logging.
The Owner Dashboard should provide an immediate financial picture of the entire group.

Recorded note: Built: create/archive/clone companies, units, access grants, period lock/reopen, approve/reject, consolidated view, drill-down. Not built: custom-role editor, impersonation, integration/AI/export controls.

### 3 COMPANY CREATION WIZARD

Phase 1 · module Multi-Company · recorded status: IMPLEMENTED

When adding a company, ask:
Company Name
Legal Name
Business Type
Industry
Country
State
Registered Address
Operating Locations
Tax Jurisdiction
PAN
GSTIN
CIN / LLPIN
Registration Numbers
Financial Year
Base Currency
Additional Currencies
Accounting Method
Inventory Required?
Payroll Required?
Projects Required?
Cost Centres Required?
Warehouses Required?
Fixed Assets Required?
Investment Accounting Required?
Fund Accounting Required?
Import/Export Required?
Construction Accounting Required?
Property Accounting Required?
Manufacturing Required?
Brokerage Required?
Healthcare / Medical Equipment Required?
Custom Requirements?
NUMERO should then recommend a suitable accounting configuration.
Nothing recommended by AI should become active without user confirmation.

Recorded note: Recommendation is labelled; nothing is created before confirmation.

### 5 CUSTOM MODULE BUILDER

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Do not restrict customization to fields.
Allow authorized administrators to create entire custom modules.
Example:
A future business may need:
Aircraft → Flight → Fuel Cost → Maintenance → Revenue
NUMERO should allow this structure to be created without rebuilding the application.
Custom modules should support:
Records
Relationships
Fields
Forms
Workflows
Approvals
Documents
Accounting mappings
Reports
Dashboards
APIs
Permissions

Recorded note: Built: a Group Super Admin can define a new kind of record (a register kind) with its own fields, reference prefix, category and optional cost-tracking dimension. Records of that kind can be created, edited, searched, given documents and follow-ups, and they appear in Forward. T70–T73 test the register engine on the supplied kinds. Not built: relationships between custom records, a form designer, workflows, approvals, accounting mappings, reports, dashboards, APIs and permissions per custom module. No automated test covers creating a kind.

### 6 ACCOUNTING ENGINE

Phase 1 · module Accounting · recorded status: PARTIAL

Build a complete double-entry accounting engine.
Every financial transaction must ultimately produce balanced journal entries.
Support:
Chart of Accounts
General Ledger
Sub Ledgers
Journal Entries
Contra Entries
Receipts
Payments
Purchases
Sales
Credit Notes
Debit Notes
Cash Book
Bank Book
Petty Cash
Day Book
Trial Balance
Profit & Loss
Balance Sheet
Cash Flow Statement
Fund Flow
Retained Earnings
Opening Balances
Closing Balances
Accruals
Prepayments
Provisions
Adjustments
Depreciation
Amortization
Write-offs
Bad Debts
Suspense Accounts
Sundry Debtors
Sundry Creditors
Accounts Receivable
Accounts Payable
Loans
Advances
Deposits
Security Deposits
Inter-company Accounts
Inter-branch Accounts
Never silently alter posted accounting records.
Corrections must occur through controlled reversal/adjustment procedures.
Maintain immutable audit history.

Recorded note: Built: double entry, journals, contra, receipts, payments, purchases, sales, notes, cash/bank book, day book, TB, P&L, BS, cash flow, control accounts, advances, loans, intercompany, suspense (Phase 1, tested). Phase 2 adds depreciation by straight-line or written-down value, calculated for a month when a person starts the run and posted on approval (T30–T38); asset disposal (T39–T41) and impairment; loan disbursement and instalments (T84–T90); fixed deposit placement and closure (T91–T93); entries for advances, expense claims, fund transfers and payroll. Every one is proposed by the operation and reaches the ledger only on approval. Not built: fund flow; accrual and prepayment schedules; runs that start by themselves (a person starts each depreciation run); impairment has no dedicated test.

### 8 TRANSACTION COMMAND CENTRE

Phase 1 · module Consolidation · recorded status: IMPLEMENTED

Create one unified transaction screen.
Users should be able to enter:
Income
Expense
Purchase
Sale
Payment
Receipt
Transfer
Refund
Advance
Reimbursement
Loan
Investment
Capital contribution
Withdrawal
Asset purchase
Liability
Intercompany transaction
Adjustment
NUMERO determines the accounting treatment based on rules and asks for confirmation where required.

Recorded note: 19 transaction types plus free-text entry.

### 9 BANKING & RECONCILIATION

Phase 1 · module Reconciliation · recorded status: PARTIAL

Support multiple:
Banks
Accounts
Currencies
Credit cards
Corporate cards
UPI accounts
Payment gateways
Wallets
Petty cash accounts
Where supported by authorized providers, integrate bank feeds through secure APIs.
Also support:
CSV imports
Excel imports
Bank statement imports
Build intelligent reconciliation.
Match transactions using:
Amount
Date
Reference
Narration
Invoice
Party
Historical patterns
Show:
Matched
Suggested Match
Partially Matched
Duplicate
Unmatched
Needs Review
Never let AI silently delete or alter banking transactions.

Recorded note: Built: CSV import with validation preview, matching on amount/date/reference, six statuses. Not built: bank feed APIs, Excel import, party/historical-pattern matching.

### 11 ACCOUNTS RECEIVABLE

Phase 1 · module Accounts Receivable · recorded status: PARTIAL

Customer master.
Invoices.
Recurring invoices.
Payment schedules.
Receipts.
Partial payments.
Credit limits.
Credit periods.
Outstanding balances.
Ageing:
0–30
31–60
61–90
90+
Automatically identify overdue accounts.
Send authorized reminders through available channels.
Track promises to pay.

Recorded note: Built: customer master, invoices, partial payments, credit terms, ageing, overdue (Phase 1); promises to pay recorded against an invoice or a customer with amount, date, person and channel, closed with an outcome, shown in Forward as PROMISED and raised as a warning when the date passes; an invoice that takes a customer beyond the configured credit limit is recorded and flagged, not blocked (T74). Not built: recurring invoices, payment schedules, reminders sent through any channel. Saving a promise has no dedicated automated test.

### 12 ACCOUNTS PAYABLE

Phase 1 · module Accounts Payable · recorded status: PARTIAL

Vendor master.
Purchase bills.
Payment terms.
Due dates.
Partial payments.
Advances.
Vendor credits.
Purchase orders.
Three-way matching:
PO → Goods Receipt → Invoice
Detect:
Duplicate bills
Unexpected price changes
Payment anomalies
Missing documentation

Recorded note: Built: bills, terms, partial payments, advances, duplicate-bill detection (Phase 1); purchase requisitions, requests for quotation, vendor quotations with a recorded selection, purchase orders, goods and service receipts, a bill linked to its order, and the three-way comparison of ordered, received and billed, which shows quantity differences, the price difference between a bill and its order, and charges that are not on the order (T94–T106). Not built: detection of a price change against earlier purchases (only a bill against its own order is compared); missing-documentation detection for bills.

### 16 GST & INDIA TAX ARCHITECTURE

Phase 1 · module Tax · recorded status: PARTIAL

Design for Indian accounting first, while keeping the tax engine extensible internationally.
Support applicable configurations for:
GST
CGST
SGST
IGST
Cess
HSN
SAC
Reverse Charge
Input Tax Credit
TDS
TCS
PAN
TAN
Maintain configurable tax rules because regulations change.
Do not hard-code tax percentages permanently.
Include workflows for applicable GST and TDS reporting and reconciliation.
Compliance reports must identify their data source, period and calculation rules.
Tax filings should remain human-reviewable before submission.

Recorded note: Built: CGST/SGST/IGST codes with effective dates, HSN/SAC, sales and purchase registers (Phase 1); tax deducted at source is recorded as an amount entered by a person — on the closure of a fixed deposit, to the ledger mapped as tax deducted receivable (T93), and as a salary deduction, to the ledger mapped as tax deducted payable (T115); tax and compliance deadlines can be recorded in the registers and are raised as warnings in Forward. Not built: TDS/TCS sections, rates and calculation; reverse charge; ITC reconciliation; return workflows.

### 17 MULTI-CURRENCY

Phase 1 · module Assets · recorded status: PARTIAL

Support unlimited currencies.
Store:
Transaction Currency
Base Currency
Exchange Rate
Base Currency Value
Support:
Exchange gains
Exchange losses
Revaluation
Historical rates
Settlement rates
Exchange-rate providers should be configurable.

Recorded note: Built: transaction currency, rate, base value, exchange difference on settlement. Not built: period-end revaluation, rate providers.

### 18 INTERCOMPANY ACCOUNTING

Phase 1 · module Consolidation · recorded status: PARTIAL

This is extremely important.
If Company A pays an expense for Company B, NUMERO should create appropriate due-to / due-from accounting entries.
Support:
Intercompany loans
Intercompany expenses
Intercompany revenue
Shared expenses
Management fees
Asset transfers
Employee cost allocation
Centralized procurement
Group treasury
During consolidated reporting, support elimination entries.

Recorded note: Built: due-to/due-from ledgers, mismatch detection, balance elimination (Phase 1); a transfer of money between two group companies proposes both entries, one in each company's books, each approved separately, and a priority alert is raised when only one side stands (T65). Not built: the mirror entry for an expense one company pays for another, and for intercompany revenue, management fees and asset transfers; shared-cost and employee-cost allocation.

### 22 TREASURY MANAGEMENT

Phase 2 · module Treasury · recorded status: PARTIAL

Create a Treasury Console covering:
Cash positions
Banks
Deposits
Loans
Borrowings
Interest
Fixed deposits
Investments
FX exposure
Payment obligations
Liquidity
Owner sees total group liquidity.

Recorded note: Built: cash and bank positions by company and ledger, fixed deposits, loans taken and given with interest, payment obligations on loans, a liquidity ladder, forex exposure from open documents, and totals across the selected companies of the group (not converted when the companies keep different currencies). Not built: investments other than fixed deposits.

### 23 FIXED ASSETS

Phase 2 · module Assets · recorded status: PARTIAL

Asset register.
Track:
Purchase value
Capitalization date
Useful life
Depreciation method
Residual value
Location
Department
Custodian
Serial number
Warranty
AMC
Insurance
Maintenance
Transfer history
Disposal
Support configurable depreciation rules.

Recorded note: Built: purchase value, in-service date, useful life, method, residual value, location, department, custodian, serial number, warranty, maintenance, transfer history, disposal, and depreciation rules by category (depreciation and disposal tested). Not built: AMC and insurance on the asset; they are separate register items with no link to the asset.

### 27 IMPORT / EXPORT

Phase 1 · module Reports · recorded status: PLANNED

Track:
Purchase Order
Supplier
Country
Currency
Incoterms
Shipment
Container
Bill of Lading / Airway Bill
Customs
Freight
Insurance
Duty
Clearing charges
Port charges
Landed cost
Allocate landed costs intelligently across inventory.

Recorded note: (none)

### 32 PAYROLL ACCOUNTING

Phase 2 · module Payroll · recorded status: PARTIAL

Optional payroll integration/module:
Employees
Salary structures
Allowances
Deductions
Bonuses
Incentives
Reimbursements
Loans
Advances
Employer contributions
Payroll liabilities
Department allocation
Project allocation
Generate payroll accounting entries automatically after approval.

Recorded note: Built: employees, salary structures, allowances, deductions, bonuses and incentives, advance recovery, loan recovery applied to the instalment schedule of the loan, employer contributions, payroll liabilities, cost by department, and the accounting entry proposed and posted after approval (all tested). Not built: allocation to projects; reimbursements through payroll (claims are paid separately).

### 36 AI ACCOUNTING COPILOT

Phase 1 · module NUMI · recorded status: PARTIAL

The AI should assist with:
Account classification
Ledger suggestions
Journal suggestions
Invoice extraction
Receipt extraction
Bank reconciliation
Duplicate detection
Anomaly detection
Cash-flow forecasting
Budget analysis
Variance explanations
Expense analysis
Revenue analysis
Tax-data preparation
Report explanation
Missing-document detection
Collections prioritization
CRITICAL:
AI may recommend.
AI must not silently manipulate books.
High-impact actions require explicit permission and appropriate approval.

Recorded note: Built: classification, ledger and journal suggestions, duplicate and anomaly detection, variance explanation (Phase 1); answers on cash ahead from recorded documents and registers, labelled FORECAST, and on advances, claims, commitments, debt, deposits, assets and payroll totals. Not built: invoice and receipt extraction; statistical forecasting; missing-document detection across the books (only an expense-claim line without a receipt is flagged, by the claim engine).

### 39 VOICE ACCOUNTING

Phase 1 · module Voice · recorded status: IMPLEMENTED

Optional voice interface:
"Numero, show today's collections."
"Numero, what payments are due tomorrow?"
"Numero, compare all companies."
"Numero, prepare this month's expense report."
Never execute sensitive financial actions solely because a voice command was recognized.
Require appropriate authentication/confirmation.

Recorded note: Command interpretation is tested. Microphone capture could not be exercised in the build environment: verify in Chrome or Edge.

### 40 AI FINANCIAL WATCHTOWER

Phase 1 · module NUMI · recorded status: PARTIAL

Continuously evaluate permitted financial data for anomalies.
Examples:
Unexpected expense spike
Duplicate invoice
Duplicate payment
Unusual vendor
Unexpected bank charge
Invoice-number duplication
Revenue decline
Cash shortage
Large overdue receivable
Unusual journal entry
Round-number payment anomaly
Expense outside normal hours
Payment just below approval threshold
New vendor receiving immediate large payment
Do not automatically label anomalies as fraud.
Display:
ANOMALY DETECTED
Then explain exactly why it was flagged.

Recorded note: Built: 8 Sentinel rules, run on demand (Phase 1); since Phase 2 further factual alerts are raised by the engine at the moment of the event and appear in the same list — a cash count that differs from the books, a bill above its order or ahead of its receipt, one side of an intercompany transfer standing alone, a customer beyond the credit limit, an identical file uploaded twice, an asset reported missing or damaged, a payment from a cash box above its limit for a single payment (T136); Forward raises a cash shortfall, a large share of receivables with one customer and a large share of payables with one vendor when it is opened. Not built: continuous evaluation of the Sentinel rules; expense-spike, revenue-decline and unusual-vendor rules.

### 42 APPROVAL ENGINE

Phase 1 · module Approvals · recorded status: PARTIAL

Build a visual workflow builder.
Example:
Expense < ₹25,000
→ Manager
₹25,000–₹1 lakh
→ Manager → Finance
₹1 lakh–₹10 lakh
→ Finance → CFO
₹10 lakh
→ CFO → Owner
Rules must support:
Company
Amount
Account
Department
Project
Vendor
Transaction Type
Risk Score

Recorded note: Built: the approval engine chooses a multi-step rule by company, amount and kind of record, and since Phase 2 applies it to journals, entries proposed by operations, advances, expense claims, requisitions and purchase orders; the configured rules are listed on the Approvals screen, where a Group Super Admin or a holder of the permission approval.configure adds and changes them in a form (name, kind of record, company, amount from and to, steps by role in order, in force or not); a rule of two steps is tested on an advance, where a later step may lower the amount authorised and may not raise it (T139 to T141). Not built: a visual builder (the editor is a form); rules on account, department, project, vendor or risk score. The rule editor has no automated test: the tests save their rule through the data layer.

### 46 FINANCIAL CONTROL CENTRE

Phase 1 · module Consolidation · recorded status: IMPLEMENTED

Create a visually powerful owner dashboard.
At the top:
TOTAL GROUP CASH
TOTAL REVENUE
TOTAL EXPENSE
NET PROFIT / LOSS
RECEIVABLES
PAYABLES
ASSETS
LIABILITIES
BORROWINGS
INVESTMENTS
WORKING CAPITAL
Then show every company as a financial card.
Example:
GHL India Ventures
Revenue
Expense
Cash
Receivables
Payables
Profit/Loss
Jamin Bazaar
Revenue
Expense
Cash
Receivables
Payables
Profit/Loss
etc.
Clicking a company enters its financial universe.

Recorded note: (none)

### 48 PROFITABILITY INTELLIGENCE

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Calculate profitability by:
Company
Branch
Department
Project
Product
Service
Property
Customer
Vendor relationship
Salesperson
Channel
Campaign
Allow cost allocation rules for shared expenses.

Recorded note: (none)

### 49 FINANCIAL CALENDAR

Phase 1 · module Forward · recorded status: PARTIAL

Show:
Invoice dates
Collection dates
Payment dates
EMIs
Loan repayments
Tax deadlines
Payroll
Subscriptions
Rent
Insurance
Renewals
Contracts
Budgets
Audit deadlines

Recorded note: Built: a month calendar in Forward that places on their dates the collections and payments due on invoices and bills, loan instalments, payroll, subscriptions, rent, insurance premiums, contract amounts, purchase commitments and maturing deposits, each with its certainty and a link to its record. Not built: a date is placed on the calendar only when it carries an amount, so tax and audit deadlines, renewals and expiries recorded without an amount are raised as early warnings and are not on the calendar; budgets; invoice dates (a document is placed on its due date, not its issue date).

### 51 STANDARD REPORT LIBRARY

Phase 1 · module Reports · recorded status: PARTIAL

Include:
Profit & Loss
Balance Sheet
Trial Balance
Cash Flow
General Ledger
Day Book
Cash Book
Bank Book
Journal Register
Purchase Register
Sales Register
Receivables Ageing
Payables Ageing
Expense Report
Revenue Report
Tax Reports
Asset Register
Inventory Valuation
Project Profitability
Cost Centre Report
Budget vs Actual
Intercompany Report
Consolidated Group Report

Recorded note: Built: 17 of the 23 listed reports in the report library (Phase 1); the asset register — cost, accumulated depreciation and book value of every asset, with export — on the Fixed assets screen (Phase 2), not in the report library. Not built: inventory valuation, project profitability, cost-centre report, tax returns, fund flow.

### 52 EXECUTIVE MORNING BRIEF

Phase 1 · module NUMI · recorded status: PLANNED

NUMERO AI can generate an optional daily Owner Brief:
"Good morning.
Group cash position: ₹...
Collections yesterday: ₹...
Payments yesterday: ₹...
Receivables due today: ₹...
Payments due today: ₹...
Largest expense yesterday: ...
New anomalies: ...
Companies requiring attention: ..."
Every figure should link to its source data.

Recorded note: (none)

### 53 FINANCIAL HEALTH INDICATORS

Phase 1 · module System Health · recorded status: IMPLEMENTED

Show factual financial metrics rather than opaque AI scores.
Examples:
Current Ratio
Quick Ratio
Debt-to-Equity
Gross Margin
Net Margin
Receivable Days
Payable Days
Inventory Days
Cash Conversion Cycle
Burn Rate
Runway
Allow company-specific metric definitions.

Recorded note: Company-specific metric definitions are not built.

### 58 DATA IMPORT & MIGRATION

Phase 1 · module Reports · recorded status: PARTIAL

Import from:
CSV
Excel
Existing accounting software exports
Bank statements
ERP exports
Build mapping tools for:
Accounts
Customers
Vendors
Products
Opening balances
Invoices
Bills
Journal entries
Validate before committing.

Recorded note: Bank statement CSV only.

### 59 INTEGRATION HUB

Phase 1 · module Reports · recorded status: PLANNED

Create an API-first architecture.
Potential integrations:
Banks
Payment gateways
CRM
HRMS
Payroll
E-commerce
POS
Inventory
Project management
Document storage
Email
WhatsApp
SMS
Google Workspace
Microsoft 365
BI systems
Government/tax services where authorized APIs exist
Provide:
REST APIs
Webhooks
API keys
OAuth where applicable
Integration logs

Recorded note: (none)

### 64 MOBILE APPLICATION

Phase 1 · module UI/UX · recorded status: PLANNED

Mobile app should support:
Dashboard
Approvals
Expense capture
Receipt scan
Invoice view
Collections
Payments
Notifications
AI Assistant
Reports
Voice queries
Use biometric authentication where available.

Recorded note: (none)

### 65 SECURITY

Phase 1 · module Security · recorded status: PARTIAL

Financial data requires serious security.
Implement:
Encryption in transit
Encryption at rest
MFA
Passkeys where supported
Session management
Device management
Role-based permissions
Tenant isolation
Field-level restrictions
IP restrictions where required
API rate limiting
Secure secret management
Backups
Point-in-time recovery
Disaster recovery
Security monitoring
Never expose credentials in frontend code.

Recorded note: Not configured: MFA, passkeys, IP restriction, rate limiting, backup testing.

### 68 DATABASE ARCHITECTURE

Phase 1 · module Genesis Builder · recorded status: IMPLEMENTED

Design for millions of transactions.
Use proper relational accounting architecture.
Core entities may include:
Organizations
Companies
Branches
Departments
Users
Roles
Permissions
Accounts
Ledgers
Journals
Journal Lines
Transactions
Customers
Vendors
Invoices
Bills
Payments
Receipts
Banks
Bank Transactions
Reconciliations
Currencies
Exchange Rates
Taxes
Assets
Inventory
Projects
Cost Centres
Budgets
Documents
Approvals
Audit Logs
Custom Fields
Custom Modules
AI Suggestions
AI Feedback
Alerts
Do not build the accounting engine from giant JSON blobs.
Use transactional database integrity.
Debit must equal credit.

Recorded note: (none)

### 75 COCKPIT MODE

Phase 1 · module Budgeting · recorded status: IMPLEMENTED

Create an optional immersive NUMERO COMMAND CENTRE for the Owner.
Imagine a modern aircraft cockpit translated into financial software.
Panels:
GROUP CASH
REVENUE
EXPENDITURE
PROFIT
RECEIVABLES
PAYABLES
TREASURY
TAX
RISK
APPROVALS
ANOMALIES
AI
Indicators should illuminate when attention is required.
This should feel serious and powerful, not like a game.

Recorded note: (none)

### 78 MULTI-LANGUAGE / INTERNATIONALIZATION

Phase 1 · module UI/UX · recorded status: PARTIAL

Architect the UI for multiple languages.
Support international:
Currencies
Date formats
Number formats
Tax configurations
Accounting configurations
Do not hard-code India-only assumptions into the core engine.
India-specific capabilities should operate as modules/configurations.

Recorded note: Interface text is English only.

### 79 BACKUP & DISASTER RECOVERY

Phase 2 · module Incidents & Exceptions · recorded status: PLANNED

Implement:
Automated backups
Encrypted backups
Versioned backups
Point-in-time recovery
Restore testing
Disaster recovery procedures
Financial records are mission-critical.

Recorded note: No backup schedule, backup encryption, versioning, point-in-time recovery, restore test or written recovery procedure is set up or documented in the project. Settings lists scheduled encrypted backups with restore testing as planned. What the hosting provider does by default has not been verified, and no live account exists yet.

### 81 AI CONFIDENCE & EVIDENCE

Phase 1 · module NUMI · recorded status: IMPLEMENTED

When AI proposes classifications or identifies anomalies, show useful supporting information.
Example:
Suggested: Marketing Expense
Reason:
Vendor historically classified as advertising
14 previous approved transactions
Invoice description contains "campaign management"
User:
Approve
Modify
Reject
Capture feedback.

Recorded note: (none)

### 85 FUTURE MODULES

Phase 2 · module Forward · recorded status: IMPLEMENTED

Architect GHL NUMERO so future modules can be added without rewriting the core:
ESG accounting
Carbon accounting
Advanced treasury
Investor reporting
Fund administration
AI forecasting
Global taxation
Procurement marketplace
Contract intelligence
Insurance management
Corporate secretarial tracking
Board reporting
Virtual CFO
Data warehouse
Advanced analytics

Recorded note: Shown by how phase 2 was added: assets, purchasing, advances, cash, treasury and payroll each propose entries through one posting engine, which finds the handler of a module by its name, so a new module adds its own tables and its own handler. The journal functions were extended once, in migration 0006, to call that dispatcher; migrations 0007 to 0009 did not touch them. Register kinds and their fields are data. None of the fifteen future modules listed is itself built; insurance policies and contracts exist only as register kinds.

### 90 ZERO-AMBIGUITY PRINCIPLE

Phase 1 · module Truth · recorded status: IMPLEMENTED

NUMERO should always distinguish between:
ACTUAL
BUDGET
FORECAST
AI ESTIMATE
SIMULATION
Never mix these categories visually or mathematically without clear labeling.

Recorded note: (none)

### 95 THE NUMERO PARTY UNIVERSE

Phase 1 · module Parties · recorded status: IMPLEMENTED

GHL NUMERO must understand that money does not merely move between ledger accounts.
Money moves between PEOPLE, COMPANIES, OFFICES, VENDORS, CONTRACTORS, EMPLOYEES, CUSTOMERS, AGENTS, BANKS, GOVERNMENTS, PARTNERS and hundreds of other counterparties.
Create a universal architecture called:
NUMERO PARTY UNIVERSE
Every person or organization interacting financially with any GHL company can exist as a Party.
A Party may be:
Employee
Director
Founder
Shareholder
Investor
Customer
Client
Lead
Prospect
Vendor
Supplier
Manufacturer
Distributor
Dealer
Wholesaler
Retailer
Agent
Broker
Sub-Broker
Referral Partner
Introducer
Channel Partner
Promoter
Affiliate
Franchisee
Consultant
Advisor
Freelancer
Independent Contractor
Contractor
Subcontractor
Architect
Engineer
Lawyer
Chartered Accountant
Auditor
Company Secretary
Tax Consultant
Recruiter
HR Vendor
Staffing Agency
Marketing Agency
Advertising Agency
PR Agency
Creative Agency
Software Vendor
SaaS Provider
Cloud Provider
IT Vendor
Developer
Designer
Content Writer
Influencer
Media Partner
Photographer
Videographer
Event Vendor
Travel Agent
Hotel
Landlord
Tenant
Property Owner
Property Buyer
Property Seller
Property Broker
Construction Vendor
Material Supplier
Labour Contractor
Transporter
Logistics Provider
Courier
Freight Forwarder
Customs Broker
Clearing Agent
CHA
Shipping Line
Airline Cargo Provider
Warehouse Operator
Insurance Company
Insurance Broker
Bank
NBFC
Lender
Borrower
Payment Gateway
Fintech Provider
Depository
Custodian
Fund Administrator
Portfolio Company
Government Department
Regulator
Municipality
Utility Provider
Hospital
Doctor
Clinic
Medical Equipment Supplier
Pharmacy
Laboratory
Maintenance Provider
AMC Provider
Security Agency
Housekeeping Vendor
Catering Vendor
Facility Management Company
Training Provider
University
Institution
Association
NGO
Trust
Society
Related Party
Group Company
Subsidiary
Associate
Joint Venture
Special Purpose Vehicle
Foreign Entity
Importer
Exporter
Custom Third Party
And unlimited future party types.
Admins must be able to create entirely new party classifications.

Recorded note: 27 system types; custom types without code.

### 99 ORGANIZATION 360°

Phase 1 · module Reports · recorded status: PLANNED

Organizations require their own relationship structure.
Example:
ABC Logistics Pvt Ltd
Contacts:
Managing Director
Accounts Contact
Operations Contact
Sales Contact
Locations:
Head Office
Warehouse
Branch
Contracts:
3
Invoices:
127
Payments:
₹...
Outstanding:
₹...
NUMERO should understand that people work inside organizations.

Recorded note: (none)

### 101 OFFICE UNIVERSE

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Support unlimited:
Head Offices
Regional Offices
Branch Offices
Sales Offices
Site Offices
Project Offices
Warehouses
Factories
Clinics
Stores
Showrooms
Temporary Offices
Construction Sites
Remote Teams
Virtual Offices
Each location receives its own configurable structure.

Recorded note: (none)

### 105 CONSULTANT MANAGEMENT

Phase 1 · module Parties · recorded status: PLANNED

Support:
Legal consultants
Financial consultants
Technology consultants
Marketing consultants
Strategy consultants
Engineering consultants
Medical consultants
Investment consultants
Property consultants
Track engagement, retainer, project fee, deliverables, invoices and payments.

Recorded note: (none)

### 108 VENDOR ONBOARDING

Phase 1 · module Accounts Payable · recorded status: PLANNED

Workflow:
Vendor Requested
→ Details Submitted
→ Documents Collected
→ Tax Verification
→ Bank Details Verified
→ Department Approval
→ Finance Approval
→ Vendor Activated
Configurable by company.

Recorded note: (none)

### 115 LABOUR & WORKFORCE COSTING

Phase 2 · module People Cost · recorded status: PARTIAL

Where applicable:
Permanent Staff
Temporary Staff
Contract Labour
Daily Wage Labour
Agency Staff
Allocate labour costs to:
Company
Site
Project
Department
Work Order
Cost Centre

Recorded note: Built: each employee carries an employment type (permanent, contract, consultant, freelancer, agency, temporary, intern, advisor), a department and an office; payroll cost is charged to the company and to the department (T114) and People cost shows it by department. Not built: a daily-wage type; allocation of labour cost to site, project, work order or cost centre. The office recorded on the employee is not used in any cost figure.

### 116 HR VENDOR MANAGEMENT

Phase 1 · module Accounts Payable · recorded status: PLANNED

Support:
Recruitment agencies
Staffing agencies
Payroll providers
Background verification providers
Training companies
Employee-benefit providers
Track:
Candidates
Placements
Replacement guarantee periods
Placement fees
Invoices
Payments
Refunds / Credits

Recorded note: (none)

### 117 LOGISTICS UNIVERSE

Phase 2 · module Forward · recorded status: PLANNED

Support:
Transporters
Fleet Providers
Couriers
Freight Forwarders
Shipping Lines
Customs Brokers
Clearing Agents
Warehouse Providers
Last-mile Providers
Track:
Shipment
Origin
Destination
Consignment
Container
Vehicle
Tracking Number
Weight
Volume
Freight
Fuel Surcharge
Insurance
Customs
Handling
Warehousing
Demurrage
Detention
Delivery
Tie every logistics cost into landed cost/project cost/product profitability where appropriate.

Recorded note: No shipment, consignment, container or freight record exists. A logistics provider can be recorded only as an ordinary vendor, and landed cost is not calculated.

### 119 LANDLORD & LEASE MANAGEMENT

Phase 1 · module Parties · recorded status: PLANNED

Track:
Landlords
Properties
Offices
Warehouses
Sites
Lease Start
Lease End
Lock-in
Rent
Deposit
Escalation
Maintenance
Utilities
Renewal
NUMERO automatically projects upcoming rental obligations.

Recorded note: (none)

### 121 INVESTOR 360°

Phase 1 · module Parties · recorded status: PLANNED

For investment entities, where authorized:
Investor
Commitment
Contribution
Capital Calls
Units
Distributions
Statements
Documents
KYC Status
Maintain strict privacy controls.

Recorded note: (none)

### 125 CONTRACT UNIVERSE

Phase 2 · module Forward · recorded status: PARTIAL

Create:
CONTRACT 360°
Store:
Contract Number
Parties
Company
Department
Project
Start Date
End Date
Value
Currency
Payment Terms
Milestones
Renewal
Termination
Attachments
Invoices
Payments
Provide alerts for:
Upcoming Renewal
Expiry
Payment Milestone
Security Deposit Release
Retention Release

Recorded note: Built: a contract is a register item with its own 360 page: reference, one party, company, start and end date, amount and frequency, total value, currency, milestones as text, retention %, renewal date, automatic renewal, cancel-by date, attachments, follow-ups, history, the coming payment schedule, and the posted entries tagged to the contract's dimension. Warnings are shown for renewal, cancel-by and end dates inside 90 days. Not built: the counterparty's own contract number as a field, more than one party, department and project, payment terms, milestones as dated records, termination terms, a list of the invoices and payments of the contract (only ledger entries tagged to its dimension), and alerts for payment milestones, security deposit release and retention release (these can be recorded as separate register items, which then appear in Forward on their date).

### 126 MONEY RELATIONSHIP GRAPH

Phase 1 · module Parties · recorded status: PARTIAL

Create one of NUMERO's signature capabilities:
MONEY GRAPH
Select any Party.
NUMERO visually displays permitted money flows.
Example:
GHL
→ ₹25L → Vendor A
Vendor A
→ Services → Project X
Project X
→ ₹1.4Cr → Revenue
Or:
Customer
→ Jamin Bazaar
→ Broker Commission
→ Broker
→ Sub-Broker
Click any connection to inspect its transactions.

Recorded note: Group-wide flows. Selecting a single party as the centre is not built.

### 131 CORPORATE CARD MANAGEMENT

Phase 2 · module Expenses · recorded status: PARTIAL

Track company cards.
Card
Holder
Company
Department
Limit
Transactions
Receipts
Unsubmitted Receipts
Personal Expense Recovery
Approvals

Recorded note: Built: a card recorded as a register item (last four digits, holder, company, limit, statement day, payment due day); an expense claim line marked 'paid by the company' from the card's ledger, with receipt flag and approval. Not built: department on the card, card transactions, list of transactions without a receipt, personal expense recovery, card statement import.

### 133 TRAVEL EXPENSE MANAGEMENT

Phase 2 · module Expenses · recorded status: PARTIAL

Trip-based accounting.
Trip:
Coimbatore → Dubai
Attach:
Flight
Hotel
Taxi
Visa
Meals
Client Meeting
Conference
Forex
Calculate total trip cost.
Allocate to company/project/customer where appropriate.

Recorded note: Built: a trip register item with its own reference and cost-tracking tag; an advance and an expense claim can be linked to the trip, and the accounting entry of a linked claim or advance carries the trip's tag (tested, T135); the trip page lists the linked claims and advances and shows, from the posted entries tagged to the trip, the cost recorded on expense ledgers apart from the advances still held by people, so that an advance released for the trip is not counted as cost before a claim is approved (the split is calculated on the page and has no test of its own); receipts are attached to the claim; claim lines can be allocated to a department and a project; the claim shows its own total. Not built: cost by flight, hotel, taxi, visa and the other headings; a vendor's bill tagged to the trip (a bill line carries a project only); allocation to a customer; forex lines.

### 136 INSURANCE REGISTER

Phase 2 · module Expenses · recorded status: PARTIAL

Track corporate policies:
Property
Vehicle
Equipment
Employee
Marine
Professional
Liability
Other applicable coverage
Track:
Premium
Coverage
Start
Expiry
Insurer
Broker
Claims

Recorded note: Built: insurance policy register item with policy number, cover type (vehicle, office, equipment, marine, liability, health, life, fire, other), premium, sum insured, start date, expiry, insurer as the party; expiry warning in Forward (tested: insurance_expiry). Not built: broker; 'property', 'employee' and 'professional' as named cover types; claims linked to the policy (an insurance claim is a separate register item that carries the policy number as text).

### 139 CONFLICT / DUPLICATION INDICATORS

Phase 1 · module Sentinel · recorded status: PARTIAL

Where configured and legally appropriate, NUMERO can flag patterns for human review.
Example:
Same bank account attached to apparently unrelated vendors.
Same tax identifier used by multiple records.
Same invoice number repeatedly submitted.
Do not automatically accuse anyone of wrongdoing.
Flag factual anomalies.

Recorded note: Shared bank account and shared tax identifier checks not built.

### 141 DOCUMENT EXPIRY ENGINE

Phase 2 · module Documents · recorded status: PARTIAL

Track expiry dates for documents where relevant.
Examples:
Contract
Insurance
Licence
Certification
Vendor registration
AMC
Notify responsible users before expiry.

Recorded note: Built: an expiry date recorded on a document by the person who classifies it; days remaining shown in the Inbox; a warning in Forward from 90 days before expiry, critical once expired (tested: document_expiry); watched expiry dates on register items for contracts, insurance, licences, guarantees and maintenance contracts. Not built: notification of the responsible user (no message leaves the application and a document has no responsible-user field); vendor registration expiry as a specific item.

### 143 COMMUNICATION HISTORY

Phase 1 · module Black Vault · recorded status: PLANNED

Where authorized integrations exist, associate relevant communications with Party records.
Email
Messages
Calls
Meeting Notes
Payment Reminders
Statements
Do not indiscriminately ingest private communications.
Respect integration scopes and user permissions.

Recorded note: (none)

### 145 ACTION & FOLLOW-UP ENGINE

Phase 2 · module Forward · recorded status: PARTIAL

Financial records can generate tasks.
Example:
Invoice overdue.
→ Create collection task.
Vendor document expired.
→ Create renewal task.
Payment requires approval.
→ Notify approver.
Contract expires in 30 days.
→ Notify contract owner.

Recorded note: Built: a person creates a follow-up from an advance, from a register item or from the Follow-ups screen; it is linked to the record, has an owner, a due date and a priority, and cannot be closed without its outcome (T126). Passed promises, expiring documents and contracts that end are shown as warnings in Forward, and requests awaiting approval are listed in the approval inbox. Not built: tasks generated by the records themselves (no collection task for an overdue invoice, no renewal task for an expired document); a follow-up cannot be created from an invoice or bill screen; nothing notifies an approver or a contract owner.

### 152 SHARED SERVICE CENTRE

Phase 1 · module Reports · recorded status: PLANNED

Allow GHL to operate centralized functions:
Finance
HR
IT
Legal
Marketing
Procurement
Administration
Costs can be allocated to companies using configurable allocation rules.
Example:
Marketing Team Cost:
30% Company A
25% Company B
20% Company C
25% Company D
Keep allocation rules versioned and explainable.

Recorded note: (none)

### 161 BULK PARTY IMPORT

Phase 1 · module Parties · recorded status: PLANNED

Upload CSV/Excel containing:
Employees
Vendors
Customers
Brokers
Agents
Freelancers
Contractors
Consultants
NUMERO maps columns and previews changes before import.

Recorded note: (none)

### 175 UNIVERSAL SETTLEMENT ENGINE

Phase 1 · module Incidents & Exceptions · recorded status: PARTIAL

One Party may simultaneously owe money and be owed money.
Example:
Vendor has:
₹8 lakh payable
but
₹2 lakh recoverable.
NUMERO displays both separately and, only where legally/accountingly appropriate and authorized, can propose a settlement/netting workflow.
Never silently net unrelated balances.

Recorded note: Both balances shown separately. Netting workflow not built.

### 176 PARTY STATEMENT GENERATOR

Phase 1 · module Reports · recorded status: IMPLEMENTED

Generate professional statements for:
Customer
Vendor
Broker
Agent
Contractor
Employee
Intercompany Party
Show:
Opening Balance
Transactions
Debit
Credit
Running Balance
Closing Balance

Recorded note: CSV.

### 182 NUMERO EXPENSE UNIVERSE

Phase 2 · module Expenses · recorded status: PARTIAL

Create a universal expense architecture.
Possible categories include:
Travel
Airfare
Train
Bus
Taxi
Cab
Auto
Fuel
Toll
Parking
Vehicle Hire
Vehicle Maintenance
Hotel
Accommodation
Meals
Food
Client Entertainment
Employee Welfare
Office Supplies
Stationery
Printing
Courier
Postage
Telephone
Mobile
Internet
Electricity
Water
Rent
Maintenance
Repairs
Cleaning
Security
Subscriptions
Software
Marketing
Advertising
Professional Fees
Legal Fees
Audit Fees
Consultancy
Recruitment
Training
Insurance
Licences
Taxes
Government Fees
Bank Charges
Interest
Commission
Brokerage
Freight
Logistics
Customs
Warehouse
Construction Materials
Equipment Rental
Tools
Medical Expenses where company policy permits
Miscellaneous
And unlimited custom categories.
Every company can maintain its own expense taxonomy.

Recorded note: Built: each company keeps its own expense categories, without a limit on their number, each mapped to a ledger and able to be switched off; the chart template supplies about forty expense ledgers (travel, fuel, toll and parking, hotel, meals, office supplies, pantry, printing, courier, telephone, electricity, water, rent, repairs, security, software, marketing, legal, audit, consultancy, insurance, bank charges, interest, commission, freight, fines). Not built: categories are used on expense claims only (bills and journals are classified by ledger); no category is preloaded in a new company; no sub-category level.

### 190 FASTAG / TOLL MANAGEMENT

Phase 2 · module Expenses · recorded status: PLANNED

Track:
Vehicle
FASTag Account
Toll Plaza
Date
Amount
Trip
Project
Import statements where possible.

Recorded note: No toll register and no statement import. A toll is an ordinary expense line; the vehicle register holds the FASTag number as text.

### 193 VEHICLE DOCUMENT ALERTS

Phase 2 · module Expenses · recorded status: PARTIAL

Notify before expiry of:
Insurance
Registration
Permit
Pollution Certificate
Fitness Certificate
Lease
Warranty
Service Due Date

Recorded note: Built: warnings inside the application before and after expiry of vehicle insurance, permit, pollution certificate, fitness certificate and road tax, and before the next service date (tested with an expired pollution certificate). Not built: registration, lease and warranty expiry on a vehicle; any notification outside the application.

### 196 TRAVEL REQUEST

Phase 2 · module Expenses · recorded status: PARTIAL

Employee creates:
Destination
Purpose
Dates
Project
Customer
Estimated Cost
Estimated:
Flight
Train
Taxi
Hotel
Meals
Local Travel
Visa
Insurance
Other
Then:
Request
→ Manager Approval
→ Budget Check
→ Finance Approval where required
→ Booking / Advance

Recorded note: Built: a trip record with traveller, from, to, purpose, dates, client or project (text) and one estimated amount; an advance request linked to the trip, which goes through approval. Not built: the trip request itself has no approval; estimated cost by flight, train, taxi, hotel, meals, visa, insurance; budget check; booking; an employee cannot create the trip (it needs the register.manage permission).

### 198 TRIP 360°

Phase 2 · module Expenses · recorded status: PARTIAL

Show:
Traveller
Company
Department
Purpose
Destination
Dates
Budget
Advance
Airfare
Hotel
Food
Taxi
Fuel
Other Costs
Total Actual Cost
Amount Reimbursable
Amount Recoverable

Recorded note: Built: the trip page shows traveller, company, purpose, from, to, dates, mode, daily allowance as typed, the one estimated amount, attached documents, the advances and claims linked to the trip with their amount and status, and the posted entries tagged to the trip, with the cost recorded on expense ledgers shown apart from the advances still held (the entry of a linked claim or advance carries the tag; tested, T135; the split itself has no test). Not built: department and budget; airfare, hotel, food, taxi, fuel and other costs as separate figures; amount reimbursable and amount recoverable on the trip page (they are shown on the claim and on the advance).

### 199 AIR TRAVEL

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Airline
PNR
Flight
Origin
Destination
Travel Date
Class
Base Fare
Taxes
Baggage
Seat
Cancellation Fee
Change Fee
Travel Agent
Invoice

Recorded note: Built: a flight recorded as an expense claim line (airline as merchant, date, amount, ticket attached) or as a travel agent's bill with tax, under the 'Airfare' ledger. Not built: PNR, flight, origin, destination, class, base fare and taxes split on a claim, baggage, seat, cancellation fee, change fee.

### 201 TAXI / CAB / LOCAL TRANSPORT

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Uber
Ola
Taxi
Auto
Metro
Bus
Rental Car
Other
Record:
Origin
Destination
Purpose
Fare
Tip where policy permits
Toll
Parking
Receipt

Recorded note: Built: local transport recorded as an expense claim line with provider as merchant, purpose, fare and receipt, under the 'Local Conveyance' or 'Toll & Parking' ledger. Not built: mode of transport, origin, destination, tip, toll and parking as separate fields.

### 202 HOTEL / ACCOMMODATION

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Hotel
City
Check-in
Check-out
Nights
Room Rate
Taxes
Meals
Laundry
Other Charges
Total
Invoice
Associate with traveller and Trip ID.

Recorded note: Built: a hotel stay recorded as an expense claim line (hotel as merchant, date, total, invoice attached) for the traveller, on a claim linked to the trip, under the 'Hotel & Accommodation' ledger. Not built: city, check-in, check-out, nights, room rate, taxes, meals, laundry and other charges as fields.

### 203 COMPANY GUEST HOUSE

Phase 2 · module Projects · recorded status: PARTIAL

Support company-owned or leased accommodation.
Track:
Property
Rooms
Guest
Check-in
Check-out
Purpose
Associated Company
Project
Allocate operating costs appropriately.

Recorded note: Built: a guest house recorded as a property register item (type 'Guest house') with its own cost-tracking tag; journal entries tagged to it are listed with totals. Not built: rooms, guests, check-in and check-out, purpose of stay, associated company or project, allocation of operating costs.

### 209 TRAVEL POLICY ENGINE

Phase 2 · module Expenses · recorded status: PARTIAL

Different employees may have different entitlements.
Example:
Management
Business Class under configured conditions
5-star accommodation limit
Manager
Economy
₹X hotel limit
Employee
Economy
₹Y hotel limit
Policies must be configurable.

Recorded note: Built: limits per expense category and company (per item, per day, receipt threshold, maximum age), changed by an authorised person with a reason. Not built: different entitlements by management level, role or grade; class of air travel; hotel star limit.

### 211 PETTY CASH UNIVERSE

Phase 2 · module Expenses · recorded status: PARTIAL

Create:
NUMERO PETTY CASH
Petty cash can exist at:
Company
Branch
Office
Project
Construction Site
Warehouse
Department
Event
Each cash box has:
Custodian
Opening Balance
Cash Added
Cash Spent
Closing Balance
Physical Count
Difference

Recorded note: Built: a cash box can belong to any unit of the company (branch, office, project, site, warehouse, department, event) and has a custodian, a float, a book balance, physical counts and the difference (tested); cash added is recorded as a fund transfer. Not built: opening balance, cash added and cash spent shown per box for a period (available only in the general ledger of its cash ledger).

### 213 PETTY CASH TOP-UP

Phase 2 · module Expenses · recorded status: PARTIAL

When balance falls below configurable threshold:
Notify Finance.
Example:
Opening Float: ₹25,000
Current Cash: ₹4,300
Minimum: ₹5,000
NUMERO:
PETTY CASH REPLENISHMENT REQUIRED

Recorded note: Built: a minimum balance per cash box; the box is marked BELOW MINIMUM on the Cash screen with the amount needed to reach the float; 'Top up' records a transfer that is approved before it posts (the transfer is tested, the marker is not). Not built: notification to Finance and an alert record; the marker is seen only by a person who opens the Cash screen.

### 219 MISSING RECEIPT WORKFLOW

Phase 1 · module Approvals · recorded status: PLANNED

If receipt unavailable:
Employee selects:
RECEIPT MISSING
Provide reason.
Approval rules determine whether it can be accepted.
Maintain audit history.

Recorded note: (none)

### 221 UNEXPLAINED CARD TRANSACTIONS

Phase 2 · module Expenses · recorded status: PLANNED

Show:
RECEIPT / PURPOSE REQUIRED
Employee receives notification.
Escalate if unresolved according to policy.

Recorded note: Card transactions are not recorded, so there is nothing to mark as unexplained. No notification or escalation exists.

### 222 PERSONAL EXPENSE ON COMPANY CARD

Phase 2 · module Expenses · recorded status: PLANNED

Allow employee to mark:
PERSONAL / RECOVERABLE
NUMERO records employee receivable.
Recovery may be made through authorized settlement/payroll workflows.

Recorded note: No PERSONAL / RECOVERABLE marking on a card expense and no employee receivable created from it.

### 224 INTERNET

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Office Broadband
Employee Internet Reimbursement
Mobile Data
Backup Connection
Leased Line

Recorded note: Built: each connection recorded as a subscription or utility register item; employee internet reimbursement as an expense claim; ledger 'Telephone & Internet'. Not built: the five types (office broadband, employee reimbursement, mobile data, backup connection, leased line) as categories.

### 225 UTILITIES

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Electricity
Water
Gas
Generator Fuel
Internet
Telephone
By:
Office
Warehouse
Factory
Site
Property

Recorded note: Built: ledgers for electricity, water and utilities, telephone and internet, fuel; utility register item with connection number and premises; a journal line tagged to an office, warehouse, site or property, and the ledger filtered by that tag. Not built: gas and generator fuel ledgers in the template; a bill line tagged to an office or site (bills carry a project tag only); a utilities report by location.

### 229 PRINTING & STATIONERY

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Business Cards
Brochures
Letterheads
Forms
Printing
Photocopies
Signage
Allocate to company/project/campaign.

Recorded note: Built: ledger 'Printing & Stationery'; allocation of a line to a company and a project. Not built: the seven items as categories; allocation to a campaign from a bill or claim (a campaign tag can be placed on a journal only).

### 231 EVENT EXPENSES

Phase 2 · module Expenses · recorded status: PARTIAL

Create Event ID.
Track:
Venue
Food
Travel
Hotel
Advertising
Printing
Decoration
AV Equipment
Staff
Security
Gifts
Transportation
Compare:
Event Budget
Committed Cost
Actual Cost

Recorded note: Built: an event register item with reference EVT-00001, type, venue, attendees, one expected amount and its own cost-tracking tag; an expense claim or an advance can be linked to the event, and its accounting entry then carries the event's tag (the rule is tested on a trip, T135); the event page lists the linked claims and advances and the ledger entries tagged to the event, with totals. Not built: cost by venue, food, travel, hotel and the other headings; comparison of event budget, committed cost and actual cost; the event on a single claim line or on a vendor's bill (a claim is linked as a whole; a bill line carries a project only).

### 239 RENT & LEASE EXPENSE

Phase 2 · module Expenses · recorded status: IMPLEMENTED

Track:
Office Rent
Warehouse Rent
Vehicle Lease
Equipment Lease
Property Lease
Automatically create scheduled obligations.

Recorded note: Rent and lease register items (premises or leased object as text) produce a schedule of future payments with escalation, shown on the item and in Forward; the schedule engine is tested. The schedule is worked out from the record each time it is shown. No bill or journal is created automatically.

### 240 DEPOSITS

Phase 1 · module Expenses · recorded status: PARTIAL

Track refundable deposits separately from expenses.
Examples:
Office Deposit
Electricity Deposit
Rental Deposit
Vendor Deposit
Hotel Deposit
Never automatically treat a refundable deposit as an expense.

Recorded note: Built: a deposit paid is recorded in a deposit ledger, not as an expense (Phase 1); since Phase 2 a security deposit paid or received can be recorded in the registers with the holder, the refund conditions, the amount and the expected date, and rent and lease items carry the deposit paid. Not built: a link between a register item and the deposit ledger — a security deposit item has no cost-tracking dimension, so the register is not reconciled with the books; ageing of deposits.

### 242 INSURANCE EXPENSES

Phase 2 · module Expenses · recorded status: PARTIAL

Track premiums:
Vehicle
Property
Equipment
Marine
Liability
Employee-related coverage
Other
Allocate prepaid portions appropriately where required.

Recorded note: Built: premiums recorded per policy with cover type; ledgers 'Insurance' and 'Prepaid Expenses'. Not built: allocation of the prepaid portion over the period of cover (a person writes each journal).

### 248 COST PER EMPLOYEE

Phase 2 · module People Cost · recorded status: PARTIAL

Where management has appropriate permission, calculate company-incurred costs such as:
Salary
Employer Costs
Travel
Reimbursements
Equipment
Training
Allocated Benefits
Keep this confidential.

Recorded note: Built: per person, salary, variable pay and employer cost from posted payroll, plus direct costs, which are expense entries recorded against the person (for example approved travel claims), shown by ledger. The page needs the payroll permission (T117); restricted records are left out and the page says so. Not built: allocated benefits; equipment held as fixed assets; fixed headings for travel, reimbursements, equipment and training (direct costs are grouped by ledger name). Direct costs are read from the ledger entries of the period page by page, up to 20,000 entries; the page warns when the period holds more. No test covers that reading.

### 249 EMPLOYEE BENEFITS

Phase 2 · module Expenses · recorded status: PARTIAL

Track applicable company benefits:
Insurance
Food
Travel
Phone
Internet
Accommodation
Vehicle
Training
Other

Recorded note: Built: employer-paid components of a salary structure are carried into payroll and people cost; expenses recorded against a person appear as that person's direct cost by ledger (tested). Not built: a benefits register by type (insurance, food, travel, phone, internet, accommodation, vehicle, training).

### 250 TRAINING & EDUCATION

Phase 2 · module Forward · recorded status: PARTIAL

Track:
Course
Employee
Provider
Fee
Travel
Hotel
Certification
Renewal

Recorded note: Built: a training can be recorded as a register item of kind Event with type Training, with provider (party), fee, dates, venue, number of attendees and its own cost dimension, so that travel and hotel entries tagged to it are totalled on its page. Not built: a training register with course, named employees, certification and certification renewal.

### 255 TRAVEL ALLOWANCE

Phase 2 · module Expenses · recorded status: PARTIAL

Support:
TA
DA
Per Diem
Mileage
Hotel Allowance
Meal Allowance
Local Conveyance
International Allowance

Recorded note: Built: a fixed monthly allowance (travel, daily, conveyance, meal) entered as a named earning in an approved salary structure and paid through payroll. Not built: per diem, mileage, hotel, local conveyance and international allowances worked out per day or per trip.

### 256 EXPENSE POLICY BUILDER

Phase 2 · module Expenses · recorded status: PARTIAL

Super Admin can configure:
Maximum Hotel Rate
Meal Limit
Mileage Rate
Air Travel Class
Daily Allowance
Receipt Threshold
Approval Threshold
Cash Expense Limit
Entertainment Limit
By:
Company
Role
Employee Grade
City
Country
Department
Project

Recorded note: Built: by company and category — maximum per item (hotel rate, entertainment limit), maximum per day (meal limit), receipt threshold, maximum age of a claim, guidance text; changed by a person with the approval permission, with a reason (not only the Super Admin). Not built: mileage rate, air travel class, daily allowance, cash expense limit, approval threshold on this screen; policy by role, employee grade, city, country, department or project.

### 258 SPLIT EXPENSE

Phase 1 · module Expenses · recorded status: PARTIAL

One expense may belong to several entities.
Example:
₹1,00,000 hotel bill for employees from:
Company A 40%
Company B 30%
Company C 30%
NUMERO splits appropriately.

Recorded note: No percentage-split helper.

### 259 SPLIT BY PROJECT

Phase 2 · module Projects · recorded status: PARTIAL

One vendor invoice:
Project Monarch 50%
Project Rubycon 30%
Head Office 20%
NUMERO creates allocation entries.

Recorded note: Built: one vendor bill entered as several lines, each tagged to a project; the posted entry carries the project on each line. Not built: a split by percentage; a line for head office (only projects can be chosen on a bill line); allocation entries created by NUMERO.

### 260 SHARED EXPENSE ALLOCATION

Phase 2 · module Expenses · recorded status: PLANNED

Allocate shared costs by:
Fixed %
Employee Count
Revenue
Floor Area
Usage
Headcount
Transaction Volume
Custom Formula
Maintain versioned allocation rules.

Recorded note: No allocation of shared costs and no allocation rules. People cost states that shared costs are not allocated.

### 265 EXPENSE ANOMALY ENGINE

Phase 1 · module Sentinel · recorded status: PLANNED

Examples:
Fuel expense unusually high.
Same hotel invoice submitted twice.
Meal significantly above configured policy.
Corporate card transaction has no receipt.
Unusual weekend transaction.
Multiple small payments just below approval threshold.
Present facts and comparisons.
Do not accuse automatically.

Recorded note: (none)

### 266 EXPENSE SEARCH

Phase 2 · module Expenses · recorded status: PARTIAL

Ask:
"Show all fuel expenses last month."
"How much did we spend on hotels this year?"
"Show Coimbatore office food expenses."
"How much did Project Monarch spend on taxis?"
"How much are employees waiting for in reimbursements?"
"Show unclosed travel advances."
"How much did each vehicle cost us this year?"

Recorded note: Built: NUMI answers spending by category and period from the ledger; a question about fuel, hotels, airfare or local conveyance is answered with that category alone as the headline figure (tested for fuel); reimbursements awaiting approval and payable; unsettled and overdue advances (tested). The seven example questions were put to NUMI on the sample data on 2026-09-27: fuel last month, hotels this year, reimbursements awaited and unsettled advances were answered as asked. Not built: answers for one office, one project or one vehicle — 'Show Coimbatore office food expenses' and 'How much did Project Monarch spend on taxis?' are answered for the whole group, and the scope line says so; 'How much did each vehicle cost us this year?' is answered with total expense by company; travel advances are not separated from other advances.

### 267 NUMERO AI TRAVEL ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"How much did our Dubai trip cost?"
NUMERO responds using recorded data:
Flights
Hotels
Meals
Taxi
Visa
Forex Charges
Other Expenses
Total.
Then allow drill-down to receipts.

Recorded note: (none)

### 270 DAILY EXPENSE PULSE

Phase 2 · module Expenses · recorded status: PLANNED

Optional daily owner summary:
Yesterday:
Bank Expenses
Cash Expenses
Corporate Card
Fuel
Travel
Food
Hotel
Petty Cash
Vendor Payments
Employee Reimbursements
Highlight factual anomalies separately.

Recorded note: No daily summary of yesterday's expenses.

### 272 THE "WHERE DID THE MONEY GO?" SCREEN

Phase 1 · module Treasury · recorded status: IMPLEMENTED

Create a major NUMERO screen:
WHERE DID THE MONEY GO?
Start:
₹100 Crore Total Outflow
Break into:
Purchases
Payroll
Projects
Property
Marketing
Travel
Vehicles
Rent
Professional Fees
Taxes
Interest
Technology
Administration
Other
Click category.
Example:
Travel ₹1.2 crore
↓
Flights ₹45L
Hotels ₹32L
Food ₹12L
Taxi ₹7L
Other ₹24L
Click Hotels.
↓
By Company
↓
By Employee
↓
By Trip
↓
By Hotel
↓
Invoice
This drill-down architecture should work everywhere.

Recorded note: (none)

### 281 OPERATING COST COMMAND CENTRE

Phase 1 · module Budgeting · recorded status: PLANNED

Owner sees:
OFFICE COSTS
TRAVEL
VEHICLES
FUEL
FOOD
HOTELS
PETTY CASH
SOFTWARE
UTILITIES
RENT
MARKETING
PROFESSIONAL FEES
LOGISTICS
EMPLOYEE EXPENSES
Compare:
This Month
Last Month
Budget
Same Period Last Year where data exists

Recorded note: (none)

### 284 COMMITMENT ACCOUNTING VIEW

Phase 2 · module Forward · recorded status: PARTIAL

NUMERO should understand money that has not yet left the bank but is already economically committed.
Examples:
Approved Purchase Order
Signed Contract
Hotel Booking
Flight Booking
Vehicle Order
Construction Work Order
Software Renewal
Show separately:
Actual Spent
Committed
Forecast
Budget Remaining

Recorded note: Built: an approved purchase order is COMMITTED for its unbilled part and is no cost until billed (tested); signed contracts, software renewals, work orders and trips are register items with a certainty; Forward and Purchasing list commitments apart from actual figures; a purchase order shows budget, actual, this order and budget left, for information. Not built: one view showing Actual spent, Committed, Forecast and Budget remaining side by side; the budget context of an order counts that order only, not other open orders; hotel, flight and vehicle bookings have no record of their own.

### 285 TOTAL COST OF ACTIVITY

Phase 1 · module Accounts Payable · recorded status: PLANNED

NUMERO should calculate complete activity cost.
Example:
Business trip.
Flight ₹28,000
Hotel ₹24,000
Food ₹8,000
Taxi ₹4,500
Visa ₹7,000
Allowance ₹5,000
TRUE TRIP COST = ₹76,500
Example:
Company Vehicle.
Purchase/Lease
Fuel
Driver
Insurance
Maintenance
Tolls
Parking
Repairs
= TOTAL VEHICLE COST
This principle should apply throughout NUMERO.

Recorded note: (none)

### 286 NUMERO MICRO-TO-MACRO PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO must understand BOTH:
₹80 cup of tea
AND
₹80 crore investment.
Both belong somewhere.
Both require appropriate accounting treatment.
But controls should be proportionate.
Do not make a ₹100 office purchase require the same workflow as a ₹10 crore transaction.

Recorded note: (none)

### 291 HOSPITALITY & ENTERTAINMENT

Phase 2 · module Expenses · recorded status: PARTIAL

Create legitimate business hospitality categories.
Examples:
Client Dinner
Customer Entertainment
Investor Hospitality
Business Dinner
Executive Dinner
Corporate Event
Hotel Hospitality
Conference Hospitality
VIP Hospitality
Employee Celebration
Team Entertainment
Capture:
Host
Guests/Party where policy requires
Purpose
Venue
Date
Amount
Receipt
Company
Department
Project
Approver

Recorded note: Built: hospitality categories created by the company; on a claim: host (the claimant), purpose, venue (merchant), date, amount, receipt, company, department, project, approver. Not built: guests or party; the eleven categories preloaded.

### 293 SEMINARS

Phase 2 · module Treasury · recorded status: PARTIAL

Track:
Seminar
Organizer
Venue
Employees Attending
Registration Fees
Travel
Hotel
Food
Transport
Materials
Sponsorship
Calculate:
TOTAL SEMINAR COST

Recorded note: Built: a seminar is an Event register item (type, venue, number attending, purpose, organiser as party) with its own cost dimension; the page totals every posted entry tagged to it, which is the total seminar cost when entries are tagged. Not built: the employees attending as a list; registration fees, travel, hotel, food, transport, materials and sponsorship as separate figures.

### 295 MEETING COSTING

Phase 2 · module Expenses · recorded status: PARTIAL

Create optional Meeting ID.
Meeting can contain:
Room/Venue
Travel
Food
Hotel
Equipment
Printing
Video Conferencing
External Consultants
Other Costs
NUMERO can calculate:
TOTAL MEETING COST

Recorded note: Built: an optional meeting recorded as an event register item with a reference and its own tag; journal entries tagged to it, and the entries of expense claims linked to it, are added up on its page, where the cost recorded on expense ledgers is shown apart from advances still held. Not built: meeting cost that arrives on a vendor's bill (a bill line carries a project only, so such cost reaches the meeting only through a hand-written journal); cost by room, travel, food, equipment and the other headings.

### 300 DEPARTMENT 360°

Phase 2 · module Payroll · recorded status: PARTIAL

Every department becomes its own financial dimension.
Examples:
Finance
HR
IT
Sales
Marketing
Operations
Customer Support
Management
Legal
Compliance
Administration
Procurement
Design
Content
Engineering
Projects
Each department should show:
Budget
Actual Expenses
Committed Expenses
Revenue where relevant
Payroll Allocation
Travel
Food
Software
Subscriptions
Equipment
Vendor Spend
Petty Cash

Recorded note: Built: departments are a dimension on entries; payroll cost by department (T114), people cost by department, ledger entries filtered by department. Not built: a department page showing budget, actual, committed, revenue, travel, food, software, subscriptions, equipment, vendor spend and petty cash.

### 306 STAFF COST UNIVERSE

Phase 2 · module People Cost · recorded status: PARTIAL

Staff cost should include much more than salary.
Track where authorized:
Salary
Employer Contributions
Bonus
Incentive
Commission
Insurance
Travel
Food
Accommodation
Vehicle
Phone
Internet
Training
Equipment
Reimbursement
Benefits
Allow confidential access restrictions.

Recorded note: Built: salary, employer contributions and variable pay (bonus, incentive, commission, overtime and arrears together as one figure) from posted payroll; other costs only where an expense entry names the person, shown by ledger; access limited to holders of the payroll permission, with restricted records withheld. Not built: bonus, incentive and commission as separate figures; insurance, food, accommodation, vehicle, phone, internet, training, equipment and benefits as tracked headings; a cost not recorded against the person is not counted. Direct costs are read from the ledger entries of the period page by page, up to 20,000 entries; the page warns when the period holds more.

### 309 CANCELLATION MANAGEMENT

Phase 2 · module Expenses · recorded status: PARTIAL

Track financial consequences of:
Hotel Cancellation
Flight Cancellation
Software Cancellation
Contract Cancellation
Event Cancellation
Vendor Cancellation
Customer Cancellation
Order Cancellation
Booking Cancellation
Record:
Original Value
Refund
Cancellation Fee
Penalty
Non-refundable Amount
Credit Received
Outstanding Refund

Recorded note: Built: an exceptional-transaction register item with nature 'Cancellation loss', amount, explanation, approved by, voucher reference and attached documents; customer refund due as a register item. Not built: type of cancellation; original value, refund, fee, penalty, non-refundable amount, credit received and outstanding refund as fields.

### 310 REFUND UNIVERSE

Phase 2 · module Expenses · recorded status: PARTIAL

Track:
Customer Refund
Vendor Refund
Travel Refund
Hotel Refund
Tax Refund
Insurance Refund
Deposit Refund
Subscription Refund
Employee Refund
Every refund links back to the originating transaction where possible.

Recorded note: Built: customer refund due as a register item with reason and original reference (text); 'Refund received' in the guided entry, which reduces the original cost; credit notes and debit notes. Not built: the nine refund types; a link from the refund to the originating transaction (the reference is text only).

### 311 SUDDEN / UNPLANNED EXPENSES

Phase 2 · module Expenses · recorded status: PARTIAL

Create:
UNPLANNED EXPENSE
Examples:
Emergency Repair
Unexpected Travel
Medical Emergency related to company responsibility
Equipment Failure
Accident
Legal Emergency
Urgent Procurement
Natural Disaster
Security Incident
Unexpected Government Charge
Record:
Reason
Amount
Who Authorized
Source of Funds
Evidence
Budget Impact

Recorded note: Built: an exceptional-transaction register item with nature 'Emergency expenditure' or 'Unplanned expense', explanation (required), amount, approved by, voucher reference, attached evidence. Not built: source of funds, budget impact.

### 318 INSURANCE CLAIMS

Phase 2 · module Expenses · recorded status: PARTIAL

Workflow:
Incident
→ Claim Created
→ Documents Submitted
→ Survey
→ Claim Approved/Rejected
→ Settlement Received
Track:
Claim Amount
Approved Amount
Deductible
Settlement
Outstanding

Recorded note: Built: insurance claim register item with policy number, claim number, amount claimed, amount approved by the insurer, amount received, attached documents; an incident register item that carries the claim reference. Not built: the workflow steps (documents submitted, survey, approved or rejected, settlement received) as defined stages; deductible; outstanding as a figure.

### 319 DAMAGE / LOSS REGISTER

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Track:
Inventory Damage
Equipment Damage
Vehicle Damage
Property Damage
Transit Damage
Theft
Loss
Connect to asset/inventory accounting.

Recorded note: Built: damage, theft and loss are recorded as incidents with estimated loss and recovery; separately, an asset found missing at verification raises an alert, and an asset can be written off through a proposed entry that needs approval. Not built: a link between the incident and the asset or its write-off entry; inventory (no inventory records exist); the listed kinds of damage as separate choices.

