# Requirements of phases 1 and 2 whose record may have changed because of what phase 3 built

Chosen by key words in the text of the requirement or in its note. Being listed here proves nothing: most of these records will not change.

### 1482 PRESERVE NEGATIVE REQUIREMENTS

Phase 1 · module UI/UX · recorded status: PLANNED

Requirements describing what NUMERO must NOT do are equally important.
Examples:
Do not silently post.
Do not silently alter accounting history.
Do not bypass approval.
Do not expose Black Vault data.
Do not declare anomaly as fraud.
Do not mix forecast with actual.
Do not release money autonomously.
Do not hide reconciliation differences.
These are product requirements.

Recorded note: (none)

### 1484 PRESERVE MULTI-COMPANY ARCHITECTURE

Phase 1 · module Multi-Company · recorded status: PLANNED

Never accidentally implement a module as single-company-only.
Every applicable capability must be designed with:
Group
Company
Branch
Office
Department
Project
Cost Centre
Profit Centre
and other relevant scopes.

Recorded note: (none)

### 1488 PRESERVE SENTINEL

Phase 1 · module Sentinel · recorded status: PLANNED

Do not reduce Sentinel to simple duplicate detection.
Preserve the broader anomaly, control and investigation architecture.

Recorded note: (none)

### 1490 PRESERVE TRUTH STATES

Phase 1 · module Truth · recorded status: PLANNED

Never collapse:
ACTUAL
RECONCILED
UNRECONCILED
COMMITTED
EXPECTED
FORECAST
ESTIMATE
SIMULATION
CONTINGENT
DISPUTED
into one number.

Recorded note: (none)

### 1495 PRESERVE CONFIGURABILITY

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Where previous prompts specify:
Custom Fields
Custom Modules
Custom Workflows
Custom Reports
Custom Dashboards
Custom Roles
Custom Approvals
Custom Categories
Custom Formulas
Custom Company Templates
retain them.

Recorded note: Built: custom field definitions and values (values tested in T127–T128), custom record kinds (register kinds), custom categories (expense and asset categories), approval rules by kind of record, company and amount, added and changed on the Approvals page by a Group Super Admin or a holder of the permission approval.configure, a new company created by cloning an existing one. Not built: custom workflows, custom reports, custom dashboards, custom roles, custom formulas, company templates defined by the Super Admin.

### 1497 NO DESTRUCTIVE REFACTORING

Phase 1 · module Engineering Governance · recorded status: PLANNED

Before major refactor:
Identify:
What currently works
Dependencies
Database Impact
API Impact
Permission Impact
Accounting Impact
Migration Requirements
Tests Required
Then refactor safely.

Recorded note: (none)

### 1498 DATABASE MIGRATIONS MUST BE NON-DESTRUCTIVE BY DEFAULT

Phase 1 · module Reports · recorded status: IMPLEMENTED

Never casually:
Drop Tables
Drop Columns
Delete Data
Reset Production Data
Recreate Database
Remove Historical Records.
Use controlled migrations.

Recorded note: (none)

### 1499 SCHEMA EVOLUTION

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO will continuously grow.
Design database/schema so new:
Companies
Modules
Fields
Workflows
Countries
Integrations
AI Capabilities
can be added without destroying historical data.

Recorded note: (none)

### 1517 TEST EVERY CRITICAL REQUIREMENT

Phase 1 · module UI/UX · recorded status: PARTIAL

Tests should cover applicable:
Accounting
Permissions
Tenant Isolation
Approvals
Reconciliation
Audit
Security
AI Boundaries
Integrations
Migration
Multi-Company
Concurrency
Idempotency

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 1518 REGRESSION PROTECTION

Phase 1 · module Engineering Governance · recorded status: PLANNED

When implementing a new additive prompt:
Run regression tests.
New functionality must not silently break existing NUMERO capabilities.

Recorded note: (none)

### 1526 CLAUDE CODE MAY IDENTIFY MISSING REQUIREMENTS

Phase 1 · module UI/UX · recorded status: PLANNED

If implementation reveals a genuine missing capability:
Propose it.
Do not silently invent consequential accounting/business behavior.

Recorded note: (none)

### 1530 BUILD FOUNDATION BEFORE DECORATION

Phase 1 · module Reports · recorded status: IMPLEMENTED

Priority:
Database Integrity
Accounting Engine
Tenant Architecture
Permissions
Audit
Posting
Reconciliation
Workflow
Security
then UI polish.

Recorded note: (none)

### 1534 ACCESSIBILITY

Phase 1 · module Security · recorded status: PARTIAL

Design important workflows to remain usable with appropriate accessibility practices.

Recorded note: Not audited against WCAG.

### 1538 NUMERO MASTER BUILD CHECKLIST

Phase 1 · module UI/UX · recorded status: PLANNED

Before major release verify:
Multi-Company
Accounting
Reconciliation
Banking
AR
AP
Payroll
People Cost
Tax
Treasury
Assets
Inventory
Projects
Documents
Audit
Forward
Sentinel
Reality
Truth
Digital Twin
NUMI
Black Vault
Permissions
Security
Integrations
Migration
System Health

Recorded note: (none)

### 1539 RELEASE REQUIREMENT REPORT

Phase 1 · module Reports · recorded status: IMPLEMENTED

Every release should produce:
Implemented
Improved
Fixed
Deferred
Known Limitations
Migration Changes
Security Changes
Accounting Changes

Recorded note: (none)

### 1540 NO SILENT BREAKING CHANGE

Phase 1 · module Approvals · recorded status: PLANNED

If change affects:
Accounting
Reports
API
Database
Workflow
Permissions
Integrations
notify through appropriate development/release documentation.

Recorded note: (none)

### 1541 DATA MIGRATION MUST BE REVERSIBLE WHERE PRACTICABLE

Phase 1 · module Reports · recorded status: PLANNED

For high-risk migrations:
Backup
Validate
Migrate
Verify
Provide rollback/recovery strategy where technically appropriate.

Recorded note: (none)

### 1548 ZERO-OMISSION AUDIT BY MODULE

Phase 1 · module Audit · recorded status: PLANNED

Allow:
"Audit Payroll against the master specification."
"Audit NUMI."
"Audit Forward."
"Audit Multi-Company."
"Audit Sentinel."
"Audit Reality."

Recorded note: (none)

### 1551 NEVER MARK A FEATURE COMPLETE FROM APPEARANCE ALONE

Phase 1 · module Approvals · recorded status: PLANNED

A button existing does not mean feature works.
Test the full workflow.

Recorded note: (none)

### 1554 CLAUDE CODE MASTER RULE

Phase 1 · module Engineering Governance · recorded status: PLANNED

When uncertain whether to:
KEEP
or
REMOVE
a previously requested capability:
KEEP IT.
If implementation must change:
Preserve its intended business function.

Recorded note: (none)

### 1555 CLAUDE CODE FINAL INSTRUCTION

Phase 1 · module Engineering Governance · recorded status: PLANNED

DO NOT BUILD A SMALLER VERSION OF NUMERO THAN THE SPECIFICATION.
DO NOT DECIDE THAT A FEATURE IS UNIMPORTANT.
DO NOT REMOVE REQUIREMENTS TO MAKE DEVELOPMENT EASIER.
DO NOT SUBSTITUTE GENERIC PLACEHOLDERS FOR DETAILED REQUIREMENTS.
DO NOT SILENTLY IGNORE OLD PROMPTS.
DO NOT TREAT THE LATEST PROMPT AS THE WHOLE PRODUCT.
DO NOT CLAIM SOMETHING IS COMPLETE WHEN IT IS NOT.
INSTEAD:
READ EVERYTHING AVAILABLE.
INDEX EVERYTHING.
PRESERVE EVERYTHING.
MAP EVERYTHING.
BUILD ADDITIVELY.
REUSE ARCHITECTURE.
KEEP COMPANIES ISOLATED.
KEEP ACCOUNTING BALANCED.
KEEP HISTORY IMMUTABLE.
KEEP AI PERMISSION-AWARE.
TEST EVERYTHING CRITICAL.
REPORT WHAT REMAINS.
THE NUMERO PROMPT LAW
NOTHING PREVIOUSLY SPECIFIED DISAPPEARS SIMPLY BECAUSE A NEW PROMPT ARRIVES.
Every new prompt expands the universe.
It does not erase the universe behind it.
FINAL CLAUDE CODE PRE-FLIGHT CHECK
Before beginning any substantial NUMERO task, answer internally:
Have I read the relevant master specifications?
Have I checked the existing implementation?
What existing functionality could this change affect?
What new requirements am I adding?
What existing requirements must remain untouched?
Does this work across multiple companies?
Are permissions enforced at the data layer?
Does accounting remain balanced?
Is audit history preserved?
Are actual, forecast, estimate and simulation still separated?
Can NUMI access only what the user may access?
Have I preserved Forward, Sentinel, Truth, Reality, Control and Black Vault requirements?
Have I considered migration and existing data?
Have I added appropriate tests?
Am I silently omitting anything?
If #15 is YES:
STOP.
Identify the omission.
Preserve it.
Then continue.
FINAL DIRECTIVE TO CLAUDE CODE
You are not being asked to reinterpret NUMERO into a smaller product.
You are being asked to BUILD THE SPECIFIED NUMERO UNIVERSE.
The specification is cumulative.
The architecture may evolve.
The implementation may improve.
The code may be refactored.
The UI may become better.
The database may scale.
The AI may become smarter.
But:
THE FUNCTIONAL REQUIREMENTS MUST SURVIVE.
NO SILENT OMISSIONS.
NO SILENT DELETIONS.
NO SILENT SIMPLIFICATIONS.
NO LOST FEATURES.
NO LOST CONTROLS.
NO LOST EDGE CASES.
NO LOST ACCOUNTING INTEGRITY.
NO LOST SECURITY.
NO LOST HISTORY.
NO LOST NUMERO.
When implementation must be phased:
DEFER IT, DOCUMENT IT, TRACK IT.
DO NOT DELETE IT.

Recorded note: (none)

### 1556 NUMERO FLOW

Phase 1 · module Approvals · recorded status: PLANNED

Create a universal:
MONEY MOVEMENT & SETTLEMENT ENGINE
NUMERO must understand that:
APPROVAL
≠
FUND TRANSFER
≠
EXPENSE
≠
INVOICE
≠
ACCOUNTING CLASSIFICATION
≠
SETTLEMENT.
These are separate events.

Recorded note: (none)

### 1570 INTERNAL FUND TRANSFER

Phase 1 · module Banking · recorded status: IMPLEMENTED

Admin can initiate controlled transfer/reallocation where authorized.
Always distinguish:
PHYSICAL CASH MOVEMENT
BANK TRANSFER
ACCOUNTING RECLASSIFICATION
BUDGET REALLOCATION
COST ALLOCATION.
They are not the same thing.

Recorded note: (none)

### 1571 RECLASSIFICATION ENGINE

Phase 1 · module Accounting · recorded status: PLANNED

Authorized users may reclassify transactions according to accounting policy.
Possible legitimate classifications may include:
Travel
Meals
Accommodation
Transport
Fuel
Marketing
Advertising
Software
Subscription
Professional Fees
Office Expense
Pantry
Utilities
Project Expense
Construction
Repairs
Maintenance
Training
Seminar
Conference
Employee Welfare
Client Entertainment
Charity
Donation
CSR where applicable
Miscellaneous
Suspense
Advance
Deposit
Asset
Inventory
Loan
Intercompany
Refund
Recovery
Write-Off
Other Configured Category.

Recorded note: (none)

### 1574 NUMI CLASSIFICATION SUGGESTION

Phase 1 · module NUMI · recorded status: PLANNED

NUMI may say:
"Based on the invoice and previous approved transactions from this vendor, Travel → Hotel Accommodation appears likely."
Show confidence/evidence.
Human confirms where required.

Recorded note: (none)

### 1579 FRAUD IS NOT AN EXPENSE CATEGORY

Phase 1 · module Sentinel · recorded status: IMPLEMENTED

Do NOT allow "Fraud" to become a casual ledger used to move unexplained money.
Instead support:
SUSPECTED LOSS / FRAUD INCIDENT CASE
linked to the actual accounting transaction.

Recorded note: (none)

### 1580 FRAUD-RELATED FINANCIAL TREATMENT

Phase 1 · module Sentinel · recorded status: PLANNED

If investigation establishes financial loss:
Record appropriate accounting treatment according to approved accounting policy.
Maintain linkage to:
Sentinel Case
Investigation
Evidence
Recovery
Insurance Claim
Write-Off
Legal Action where applicable.

Recorded note: (none)

### 1582 RECLASSIFICATION HISTORY

Phase 1 · module Accounting · recorded status: PLANNED

Never destroy previous classification.

Recorded note: (none)

### 1597 DOCUMENT ROUTING

Phase 2 · module Expenses · recorded status: PLANNED

NUMI can suggest routing:
Marketing Invoice → Marketing
Hotel → Travel
Cloud Hosting → Technology
Legal Invoice → Legal/Professional Fees
Human/configured rules remain authoritative.

Recorded note: NUMI does not suggest routing of documents. A person classifies and links each document.

### 1604 VOICE RECLASSIFICATION

Phase 1 · module Voice · recorded status: PLANNED

"Move this from miscellaneous to client entertainment."
NUMI shows accounting impact and prepares change.
Authorization rules apply.

Recorded note: (none)

### 1609 SARVAM AI INTEGRATION LAYER

Phase 1 · module Voice · recorded status: BLOCKED

Add an optional integration adapter for:
SARVAM AI
for supported Indian-language speech and language capabilities.
Possible uses:
Speech-to-Text
Text-to-Speech
Translation
Language Understanding
Voice Interface
subject to current API capabilities, licensing and configured availability.

Recorded note: Needs a Sarvam API key, stored as a server-side secret behind an authenticated function.

### 1610 PROVIDER-AGNOSTIC VOICE ARCHITECTURE

Phase 1 · module Voice · recorded status: IMPLEMENTED

Do NOT hard-code NUMI to Sarvam alone.
Create:
VOICE / LANGUAGE PROVIDER GATEWAY
Possible providers can be configured/replaced.
Sarvam can be a preferred Indian-language integration where appropriate.

Recorded note: (none)

### 1612 VOICE PRIVACY

Phase 1 · module Voice · recorded status: PARTIAL

Financial voice data may contain:
Salary
Banking
Customer
Vendor
Investment
Confidential Information.
Apply:
Encryption
Access Controls
Retention Policy
Consent where required
Provider Security Controls.

Recorded note: Retention policy and consent prompts not built.

### 1615 VOICE AUDIT

Phase 1 · module Voice · recorded status: IMPLEMENTED

Record appropriate:
Transcript
Parsed Intent
User
Action
Confirmation
Result
subject to privacy/retention policy.

Recorded note: (none)

### 1619 REPORT TYPES

Phase 1 · module Reports · recorded status: PLANNED

Include, without limitation:
Accounting Reports
Management Reports
Operational Finance Reports
Treasury Reports
Payroll Reports
People Cost Reports
Expense Reports
Revenue Reports
AR Reports
AP Reports
Tax Reports
Audit Reports
Bank Reports
Reconciliation Reports
Budget Reports
Forecast Reports
Project Reports
Property Reports
Inventory Reports
Asset Reports
Procurement Reports
Sales Reports
Commission Reports
Advance Reports
Petty Cash Reports
Travel Reports
Vehicle Reports
Subscription Reports
Contract Reports
Compliance Reports
Sentinel Reports
Forward Reports
Reality Reports
Truth Reports
NUMI Reports
Custom Reports.

Recorded note: (none)

### 1620 ACCOUNTING REPORT LIBRARY

Phase 1 · module Reports · recorded status: PARTIAL

Include:
Trial Balance
General Ledger
Journal Register
Day Book
Cash Book
Bank Book
Sales Register
Purchase Register
Receipts
Payments
Contra
P&L
Balance Sheet
Cash Flow
Fund Flow
Changes in Equity
Schedules

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 1640 INVESTMENT CALCULATORS

Phase 1 · module Reports · recorded status: IMPLEMENTED

ROI
IRR
XIRR
NPV
CAGR
Payback
Yield
Scenario Return.

Recorded note: (none)

### 1641 BUSINESS CALCULATORS

Phase 1 · module Reports · recorded status: IMPLEMENTED

Break-Even
Contribution
Working Capital
Cash Conversion Cycle
Runway
Burn
Unit Economics
Pricing
Margin.

Recorded note: (none)

### 1642 REAL ESTATE CALCULATORS

Phase 1 · module Reports · recorded status: PLANNED

Where relevant:
Property Cost
Land Cost Allocation
Project Cost
Plot/Unit Cost
Rental Yield
Cash Flow
ROI
Development Margin.

Recorded note: (none)

### 1649 REPORT UPLOAD

Phase 1 · module Reports · recorded status: PLANNED

Users may upload external reports.
NUMERO stores them in controlled document system.
Possible uses:
Compare External vs NUMERO
Audit
Reference
Migration
Board Records.

Recorded note: (none)

### 1656 REPORT DISTRIBUTION

Phase 1 · module Reports · recorded status: PLANNED

Send through authorized configured channels:
In-App
Email
Other Approved Integrations.
Sensitive reports must respect security.

Recorded note: (none)

### 1659 NUMI PROACTIVE REPORT

Phase 1 · module NUMI · recorded status: PLANNED

NUMI may say:
"I generated an overdue-advance report because unsettled employee advances increased materially this month."
Subject to notification preferences.

Recorded note: (none)

### 1663 REPORT TO ACTION

Phase 1 · module Reports · recorded status: PLANNED

From report:
Create Task
Request Evidence
Open Investigation
Create Watch
Prepare Reclassification
Request Approval
Follow Up
Create Forecast Scenario.

Recorded note: (none)

### 1673 REPORT ANOMALY LINK

Phase 1 · module Sentinel · recorded status: PLANNED

Sentinel alerts can appear contextually in reports.

Recorded note: (none)

### 1675 REPORT TRUTH LINK

Phase 1 · module Truth · recorded status: PLANNED

Actual/forecast/estimate/simulation must remain visually distinct.

Recorded note: (none)

### 1677 REPORT DATA QUALITY

Phase 1 · module Reports · recorded status: PLANNED

Warn if:
Missing Data
Stale Integration
Unreconciled Bank
Open Period
Missing Documents
Incomplete Department Submission
could materially affect report.

Recorded note: (none)

### 1683 REPORT IMPORT COMPARISON

Phase 1 · module Reports · recorded status: PLANNED

Upload external report.
Ask NUMI:
"Compare this with NUMERO."
NUMI identifies differences.

Recorded note: (none)

### 1695 NUMI MISSING-EVIDENCE FOLLOW-UP

Phase 1 · module NUMI · recorded status: PLANNED

NUMI can automatically prepare/send authorized reminders.

Recorded note: (none)

### 1696 EVIDENCE DEADLINE

Phase 1 · module Audit · recorded status: PLANNED

Policy can specify:
Receipt due within X days.
Invoice due within Y days.

Recorded note: (none)

### 1699 LATE INVOICE HANDLING

Phase 1 · module Accounts Receivable · recorded status: PLANNED

If invoice arrives after close:
NUMERO applies controlled late-document workflow.
Never silently rewrite closed period.

Recorded note: (none)

### 1702 FUND MOVEMENT TIMELINE

Phase 1 · module Reconciliation · recorded status: PLANNED

Every amount can show:
REQUESTED
↓
APPROVED
↓
RELEASED
↓
USED
↓
EVIDENCED
↓
CLASSIFIED
↓
POSTED
↓
SETTLED
↓
RECONCILED.

Recorded note: (none)

### 1703 "WHERE DID THIS ADVANCE GO?"

Phase 2 · module Expenses · recorded status: PARTIAL

NUMI answers with evidence.
Example:
₹1,00,000 Released
₹42,000 Travel
₹28,000 Hotel
₹8,000 Food
₹22,000 Returned
Settlement Complete.

Recorded note: Built: for a named person NUMI states the unsettled total and lists each advance with amount released, unsettled balance and status, with links (tested); the advance page shows released, settled, returned and the settlement claims. Not built: NUMI's answer for one advance broken down by travel, hotel and food, ending with 'Settlement complete'.

### 1705 ACCOUNTABLE MONEY

Phase 2 · module Projects · recorded status: PARTIAL

Create concept:
ACCOUNTABLE FUNDS
Money released to a person/department/project that has not yet completed its financial lifecycle.

Recorded note: Built: money released to a person, department or project and not yet settled or returned is tracked as 'unsettled advances' and is never counted as an expense (tested). Not built: the name ACCOUNTABLE FUNDS; cash box floats included in the same total; totals by department and by project.

### 1707 HANDOVER OF ACCOUNTABLE FUNDS

Phase 1 · module Approvals · recorded status: PLANNED

If employee changes role/leaves:
Open accountable funds must be resolved or formally transferred according to approved workflow.

Recorded note: (none)

### 1708 NUMI BEFORE NEW FUND RELEASE

Phase 1 · module NUMI · recorded status: PLANNED

Before release, check:
Existing Advances
Missing Evidence
Overdue Settlement
Budget
Purpose
Department
Cash
Approval
Sentinel
Beneficiary Changes

Recorded note: (none)

### 1710 FUND MOVEMENT SENTINEL

Phase 1 · module Sentinel · recorded status: PLANNED

Watch:
Repeated Advances
Split Advances
Round Amounts
Unusual Timing
Repeated Missing Evidence
Rapid Reclassification
Frequent Suspense
Frequent Miscellaneous
Repeated Returns
Unusual Beneficiary
Bank Detail Changes.
Again:
ANOMALY ≠ FRAUD.

Recorded note: (none)

### 1711 RECLASSIFICATION SENTINEL

Phase 1 · module Sentinel · recorded status: PLANNED

Watch unusual patterns such as:
Expense repeatedly moved after approval
Large transactions moved into Miscellaneous
Old Suspense suddenly cleared into unusual accounts
Frequent classification changes before close.
Surface for review.

Recorded note: (none)

### 1713 REPORT-BASED SENTINEL

Phase 1 · module Sentinel · recorded status: PLANNED

User:
"Show every expense reclassified more than twice."
Generate.

Recorded note: (none)

### 1714 NUMI MEMORY + FUND HISTORY

Phase 1 · module NUMI · recorded status: PLANNED

NUMI remembers approved historical patterns.
Example:
"Last three travel advances to this person averaged ₹38,000. Current request is ₹1,20,000."
This is context, not automatic rejection.

Recorded note: (none)

### 1716 UNIVERSAL FINANCIAL COMMAND BAR

Phase 1 · module Search & Command · recorded status: IMPLEMENTED

From anywhere:
ASK NUMI / DO WITH NUMI
Examples:
"Create invoice."
"Upload this bill."
"Settle this advance."
"Reclassify this."
"Generate report."
"Calculate margin."
"Show proof."
"Find missing invoice."
"Compare."
"Export."
"Explain."

Recorded note: (none)

### 1717 NUMI MULTIMODAL

Phase 1 · module NUMI · recorded status: PLANNED

NUMI should accept authorized:
Text
Voice
PDF
Image
Spreadsheet
Document
Screenshot
Structured Data
and supported integrations.

Recorded note: (none)

### 1725 SARVAM + NUMI EXPERIENCE

Phase 1 · module NUMI · recorded status: PLANNED

Where Sarvam or another configured Indian-language provider is available:
User may speak naturally in supported language.
Example Tamil speech.
Provider transcribes.
NUMI understands financial intent.
NUMERO performs permitted workflow.
NUMI responds in preferred language.

Recorded note: (none)

### 1728 VOICE NUMBERS CONFIRMATION

Phase 1 · module Voice · recorded status: IMPLEMENTED

For consequential financial commands:
Repeat parsed amount/currency before execution.

Recorded note: (none)

### 1732 NUMERO FLOW + SENTINEL

Phase 1 · module Sentinel · recorded status: PLANNED

Unusual fund behavior becomes reviewable exception.

Recorded note: (none)

### 1734 FINAL FUND MOVEMENT PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO should always know:
WHO REQUESTED THE MONEY?
WHO APPROVED IT?
WHO RECEIVED IT?
WHERE DID IT COME FROM?
WHY WAS IT RELEASED?
WHAT WAS IT ACTUALLY USED FOR?
WHAT EVIDENCE EXISTS?
HOW WAS IT CLASSIFIED?
WAS ANYTHING RETURNED?
IS ANYTHING STILL OUTSTANDING?
WHO IS RESPONSIBLE?
IS IT RECONCILED?

Recorded note: (none)

### 1736 FINAL NUMI PRINCIPLE

Phase 1 · module NUMI · recorded status: PLANNED

NUMI should transform:
INFORMATION INTO UNDERSTANDING.
UNDERSTANDING INTO PREPARATION.
PREPARATION INTO CONTROLLED ACTION.
ACTION INTO FOLLOW-UP.
FOLLOW-UP INTO ACCOUNTABILITY.
ACCOUNTABILITY INTO ORGANIZATIONAL MEMORY.
CLAUDE CODE ZERO-OMISSION REMINDER
THIS ENTIRE ADDITIVE SPECIFICATION MUST BE ADDED TO THE EXISTING NUMERO REQUIREMENT LEDGER.
DO NOT IMPLEMENT ONLY:
ADVANCES
or
VOICE
or
REPORTS.
Implement and track the complete requirement union.
If a feature cannot be implemented in the current development phase:
MARK IT:
DEFERRED
with requirement ID and reason.
DO NOT DELETE IT.
DO NOT FORGET IT.
DO NOT SILENTLY SUBSTITUTE A PLACEHOLDER.

Recorded note: (none)

### 1737 NUMERO DYNAMIC UNIVERSE

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Create:
NUMERO GENESIS BUILDER
A no-code / low-code architecture builder for authorized administrators.
It allows NUMERO itself to evolve without rewriting source code for ordinary business configuration.

Recorded note: Built: a Genesis Builder screen for structure levels and units, custom field definitions with versions, party types, tax codes with dated rates, learned rules and controls; register kinds with their own fields; expense and asset categories; the account mapping. Not built: form builder, workflow builder, status builder, rule and formula builder, report and dashboard builder, menu and page builder, custom roles editor, conditional field rules.

### 1738 SUPER ADMIN CAN CREATE DEPARTMENTS

Phase 1 · module Treasury · recorded status: IMPLEMENTED

Super Admin can click:
+ CREATE DEPARTMENT
Examples:
Finance
Accounts
Sales
Marketing
Technology
HR
Legal
Operations
Administration
Customer Support
Procurement
Construction
Projects
Investments
Treasury
Management
Personal Office
Chairman's Office
Custom.
These are examples only.
Admin can create anything.

Recorded note: (none)

### 1742 DYNAMIC FINANCIAL PATHS

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Create:
NUMERO PATH BUILDER
Admin can create custom financial paths.
Examples:
PERSONAL
PETTY CASH
TRAVEL
PROJECT
SITE
DEPARTMENT
DIRECTOR
EXECUTIVE
EMERGENCY
CHARITY
DONATION
CSR
MARKETING
EVENT
PROCUREMENT
CUSTOMER
VENDOR
BROKER
AGENT
EMPLOYEE
INVESTMENT
LEGAL
CONFIDENTIAL
BLACK VAULT
OTHER.
These are NOT fixed options.
Admin may create unlimited paths.

Recorded note: Built: a financial path is a register item of the kind Financial Path. Any number can be created without code; each gets its own cost-tracking dimension, and an advance or an expense claim can be linked to it. The list of path types can be extended by a Group Super Admin. Not built: a path builder. A path does not decide who may use it, where money may come from or go, which workflow or approval applies, or how it is accounted. No automated test creates a path.

### 1744 PERSONAL PATH

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Example configuration:
PERSONAL
This could be used only where the organization legitimately tracks authorized personal/director-related financial items.
Possible fields:
Person
Purpose
Amount
Company
Funding Source
Recoverable?
Company Expense?
Director/Employee Account?
Evidence
Approval
Settlement.
Accounting treatment must reflect reality.

Recorded note: Built: a path of type Personal with person (party), purpose, amount, company and attached evidence. A Group Super Admin can add further fields to the kind. Not built: as supplied fields, funding source, recoverable or not, company expense or not, director or employee account, approval and settlement on the path. The accounting treatment is decided on each journal, not by the path.

### 1747 TRAVEL PATH

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Could require:
Traveler
Trip
Destination
Purpose
Advance
Flight
Hotel
Taxi
Meals
Receipts
Settlement.

Recorded note: Built: a Trip register item (traveller, from, to, purpose, mode, daily allowance), an advance and an expense claim linked to the trip, claim lines by category with receipts, and settlement of the advance (tested T42–T58). Not built: a configured travel path that requires these items; flight, hotel, taxi and meals are claim lines under categories the company defines, not fields of the path.

### 1751 ADMIN CAN CREATE ANY PATH

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Example:
VIP CLIENT HOSPITALITY
Admin creates path.
No developer required.

Recorded note: Built: a person with the register permission creates a path such as 'VIP client hospitality' without a developer; it gets a reference, a cost dimension and its own page. Not built: the path carries no workflow, approval, accounting or settlement behaviour of its own.

### 1754 FIELD TYPES

Phase 1 · module Voice · recorded status: PARTIAL

Support:
Single-Line Text
Multi-Line Text
Rich Text
Number
Decimal
Currency
Percentage
Date
Time
Date-Time
Duration
Boolean
Checkbox
Radio
Dropdown
Multi-Select
Tags
Lookup
Relationship
User
Employee
Customer
Vendor
Party
Company
Department
Office
Project
Property
Account
Ledger
Bank
Asset
Inventory Item
Contract
Invoice
Document
URL
Email
Phone
Address
Location
Country
State
Tax ID
Auto Number
Formula
Calculated Field
Attachment
Image
PDF
Document
Signature
Voice
Audio
Video
Barcode
QR
Custom Reference
Status
Rating where appropriate
Other extensible types.

Recorded note: Built: 27 field types can be chosen when a field is defined (Phase 1); on invoices and bills, register items, fixed assets and parties a defined field is shown with an input for text, number, money, percentage, date, yes/no or a single choice from options, and every other type is entered as plain text; the fields of a register kind use six types (text, number, money, date, choice, yes/no). Not built: working inputs for the other listed types, among them time, date-time, multi-select (shown as a single choice), lookup and relationship, formula and calculated, attachment, image, signature, address and location, barcode and QR, rating; the listed types beyond the 27.

### 1759 NESTED DROPDOWNS

Phase 2 · module Genesis Builder · recorded status: PLANNED

Example:
EXPENSE
↓
TRAVEL
↓
HOTEL
↓
DOMESTIC / INTERNATIONAL.

Recorded note: Nested dropdowns are not built. A dropdown is one flat list of options.

### 1765 FORM TEMPLATES

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Examples:
Expense
Advance
Invoice
Travel
Petty Cash
Purchase Request
Donation
Project Expense
Emergency Fund
Custom.

Recorded note: (none)

### 1773 DYNAMIC WORKFLOW BUILDER

Phase 2 · module Genesis Builder · recorded status: PLANNED

Create:
NUMERO FLOW STUDIO
Visual workflow builder.

Recorded note: No workflow builder exists.

### 1774 WORKFLOW NODES

Phase 1 · module Approvals · recorded status: PLANNED

Start
Form
Condition
Approval
Calculation
Document Request
NUMI Analysis
Sentinel Check
Accounting Entry
Notification
Task
Wait
Timer
Escalation
Webhook
Integration
Settlement
Reconciliation
End.

Recorded note: (none)

### 1789 DYNAMIC LEDGER MAPPING

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Admin/authorized Finance can map:
Scenario
Category
Path
Transaction Type
to appropriate ledger/accounting rules.

Recorded note: Built: the account mapping (ledger role to ledger) edited on screen and tested (T82–T83); expense category to ledger; asset category to its three ledgers. Not built: mapping by scenario, by path or by transaction type.

### 1792 DYNAMIC EVIDENCE RULES

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Example:
Petty expense under ₹500:
Receipt optional according to policy.
Travel above configured amount:
Invoice mandatory.
Donation:
Recipient evidence mandatory.
Fully configurable.

Recorded note: Built: for each expense category the company sets the amount above which a receipt is expected; a line without one is flagged EVIDENCE MISSING for the approver (tested). Required fields of a register kind are enforced (T70). Not built: evidence rules by path or scenario, rules that name the kind of document required, rules that make evidence mandatory rather than flagged.

### 1794 DYNAMIC SETTLEMENT RULES

Phase 2 · module Genesis Builder · recorded status: PLANNED

Admin defines whether scenario requires:
Return
Reimbursement
Invoice
Receipt
Approval
Bank Match
No Settlement
Other.

Recorded note: Not built. A Financial Path has a 'settlement rule' field that records a choice as text; nothing applies it.

### 1800 DYNAMIC NOTIFICATION RULES

Phase 2 · module Genesis Builder · recorded status: PLANNED

Example:
Notify CFO if department exceeds 90% of monthly budget.

Recorded note: No configurable notification rules exist. Warnings are raised by fixed rules and shown inside the application only.

### 1801 DYNAMIC REPORTS

Phase 2 · module Genesis Builder · recorded status: PLANNED

Every custom field/object/path/scenario should automatically become available to report builder where permission allows.

Recorded note: No report builder exists, so custom fields, kinds and paths cannot be added to a report.

### 1802 NO DEAD CUSTOM DATA

Phase 2 · module Genesis Builder · recorded status: PARTIAL

If Admin creates:
Event Type
it should not disappear into an isolated table.
It should become available to:
Search
Reports
NUMI
API
Audit
Permissions
Workflow
where appropriate.

Recorded note: Built: a new register kind is available in the register list, its search and filters, the CSV export of the list, Forward, the audit trail and follow-ups. Custom field values are written to the audit trail. Not built: reports, NUMI answers, API, permissions and workflow for custom kinds and custom fields.

### 1805 DYNAMIC DASHBOARD

Phase 2 · module Genesis Builder · recorded status: PLANNED

Admin can build dashboards for custom departments/scenarios.

Recorded note: No dashboard builder exists for departments or scenarios.

### 1815 DYNAMIC PERMISSIONS

Phase 2 · module Genesis Builder · recorded status: PLANNED

For every custom object define:
View
Create
Edit
Submit
Approve
Reject
Post
Reclassify
Settle
Export
Delete Draft
Configure.

Recorded note: Permissions cannot be set per custom object. The register permissions apply to every register kind alike.

### 1818 DYNAMIC CONFIDENTIALITY

Phase 1 · module Black Vault · recorded status: PLANNED

Any:
Field
Form
Record
Path
Scenario
Document
Report
may be:
NORMAL
INTERNAL
CONFIDENTIAL
RESTRICTED
SUPER ADMIN ONLY
BLACK VAULT.

Recorded note: (none)

### 1823 DYNAMIC COMPANY TEMPLATE BUILDER

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Super Admin can create reusable company templates.

Recorded note: Built: a new company can be created by cloning the chart of accounts and units of an existing company, or from one of the supplied templates. Not built: a Super Admin cannot save a named, reusable company template; the templates are part of the program.

### 1824 TEMPLATE MAY INCLUDE

Phase 1 · module NUMI · recorded status: PLANNED

Departments
Chart of Accounts
Fields
Forms
Paths
Scenarios
Workflows
Approvals
Reports
Dashboards
NUMI Rules
Sentinel Rules
Document Rules.

Recorded note: (none)

### 1825 TEMPLATE MARKETPLACE INTERNAL

Phase 1 · module Multi-Company · recorded status: PLANNED

Maintain library:
Real Estate Company
Construction Company
Technology Company
Investment Company
Trading Company
Custom Group Template.

Recorded note: (none)

### 1839 TEST TRANSACTION

Phase 1 · module Engineering Governance · recorded status: PLANNED

Admin can simulate scenario.

Recorded note: (none)

### 1840 NUMI TESTS SCENARIO

Phase 1 · module NUMI · recorded status: PLANNED

"Run a ₹5 lakh test travel advance through this workflow."
Show expected route.

Recorded note: (none)

### 1842 FORMULA VALIDATION

Phase 1 · module Approvals · recorded status: PLANNED

Example:
Settlement Total cannot exceed approved amount without reimbursement workflow.

Recorded note: (none)

### 1845 AUTOMATION ACTIONS

Phase 1 · module NUMI · recorded status: PLANNED

Create Task
Notify
Request Document
Route Approval
Generate Report
Prepare Journal
Create Follow-Up
Call Webhook
Run NUMI Analysis.

Recorded note: (none)

### 1850 DYNAMIC PATH ROUTING

Phase 2 · module Genesis Builder · recorded status: PLANNED

Example:
Money Requested
↓
PERSONAL?
PETTY?
TRAVEL?
PROJECT?
SITE?
OTHER?
Each path invokes its own workflow.

Recorded note: A path does not invoke a workflow. Advances and claims follow the same fixed workflow whatever path they are linked to.

### 1854 DYNAMIC FINANCIAL TREE

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Create hierarchy such as:
MONEY
↓
EXPENSE
↓
TRAVEL
↓
DOMESTIC
↓
HOTEL.
Or any Admin-defined hierarchy.

Recorded note: Built: the chart of accounts is a hierarchy of headings and ledgers to any depth; organisation units have levels defined by the group and a parent unit. Not built: a classification tree for categories (expense categories are a flat list); a single money tree that joins category, path and ledger.

### 1860 DYNAMIC OWNER

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Every:
Department
Path
Scenario
Workflow
Category
Form
Report
can have responsible owner.

Recorded note: Built: every register item (including a path) and every follow-up carries an owner; an item without one is marked 'no owner recorded'. Not built: an owner on departments, scenarios, workflows, categories, forms and reports.

### 1865 DYNAMIC TRAINING

Phase 2 · module Genesis Builder · recorded status: PLANNED

When new workflow published:
NUMI can explain to affected authorized users:
What changed
How to use it
What documents are required
Who approves.

Recorded note: No workflow can be published, and NUMI has no explanation of configuration changes.

### 1871 NUMI DYNAMIC WORKFLOW ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

NUMI understands the configuration rather than relying on hard-coded workflows.

Recorded note: (none)

### 1872 CONFIGURATION KNOWLEDGE GRAPH

Phase 1 · module Reports · recorded status: PLANNED

NUMI knows relationships between:
Company
Department
Path
Scenario
Form
Field
Workflow
Account
Report
Permission.

Recorded note: (none)

### 1873 SUPER ADMIN CONFIGURATION COCKPIT

Phase 1 · module Budgeting · recorded status: PLANNED

Create:
BUILD NUMERO
Central Admin screen.
Cards:
COMPANIES
DEPARTMENTS
PATHS
SCENARIOS
FORMS
FIELDS
WORKFLOWS
CATEGORIES
ACCOUNTS
APPROVALS
DOCUMENT TYPES
REPORTS
DASHBOARDS
CALCULATORS
NUMI RULES
SENTINEL RULES
AUTOMATIONS
PERMISSIONS
TEMPLATES.

Recorded note: (none)

### 1874 NUMI BUILD WITH ME

Phase 1 · module NUMI · recorded status: PLANNED

Super Admin can simply say:
"NUMI, BUILD THIS WITH ME."
Example:
"I need a new department called Events. They need a ₹2 lakh monthly budget, petty cash, event advances, vendor invoices, manager approval up to ₹50,000 and CFO approval above that."
NUMI generates proposed:
Department
Budget
Cost Centre
Paths
Forms
Fields
Workflow
Approval Rules
Reports
Permissions.
Admin reviews.
Then publishes.

Recorded note: (none)

### 1891 DYNAMIC WEBHOOK

Phase 2 · module Genesis Builder · recorded status: PLANNED

Custom scenario events can emit webhooks.

Recorded note: No webhooks exist.

### 1892 DYNAMIC IMPORT

Phase 2 · module Genesis Builder · recorded status: PLANNED

CSV/Excel import can map columns to custom fields.

Recorded note: No import maps columns to custom fields. The only import is the bank statement CSV.

### 1905 UNIVERSAL WORKFLOW PRINCIPLE

Phase 1 · module Approvals · recorded status: PLANNED

NUMERO should not require developers to predict every approval process.
Provide:
WORKFLOW ENGINE.

Recorded note: (none)

### 1912 ARCHITECTURAL TARGET

Phase 1 · module NUMI · recorded status: PLANNED

Build reusable core engines:
ENTITY ENGINE
FIELD ENGINE
FORM ENGINE
PATH ENGINE
SCENARIO ENGINE
WORKFLOW ENGINE
RULE ENGINE
APPROVAL ENGINE
DOCUMENT ENGINE
ACCOUNTING MAPPING ENGINE
SETTLEMENT ENGINE
PERMISSION ENGINE
REPORT ENGINE
CALCULATION ENGINE
NOTIFICATION ENGINE
AI/NUMI METADATA ENGINE.

Recorded note: (none)

### 1913 TEMPLATE OVER ENGINE

Phase 1 · module Accounts Receivable · recorded status: PLANNED

Example:
PETTY CASH
should largely be a configured template using the engines above.
Likewise:
TRAVEL ADVANCE
SITE ADVANCE
CHARITY
EMERGENCY FUND
DEPARTMENT INVOICE
etc.

Recorded note: (none)

### 1914 WHY THIS MATTERS

Phase 1 · module Multi-Company · recorded status: PLANNED

Today the business may need:
Personal
Petty
Travel.
Tomorrow:
Film Production Advance
International Exhibition Fund
Medical Equipment Demo Expense
Land Acquisition Due Diligence
Fund Investor Event
Raptor Technology Conference
or something nobody has imagined yet.
NUMERO should adapt.

Recorded note: (none)

### 1915 FINAL DYNAMIC NUMERO TEST

Phase 2 · module Genesis Builder · recorded status: PARTIAL

Super Admin should be able to create, without coding:
A COMPANY
A DEPARTMENT
A SUB-DEPARTMENT
A PATH
A CATEGORY
A SCENARIO
A FORM
A FIELD
A DOCUMENT TYPE
A WORKFLOW
AN APPROVAL ROUTE
A STATUS
A RULE
A CALCULATOR
A REPORT
A DASHBOARD
AN AUTOMATION
A NUMI RULE
A SENTINEL RULE
A TEMPLATE.

Recorded note: Built: without coding, a company, a department, a sub-department, a path (as a register item), a category, a field (shown and filled in on invoices and bills, register items, fixed assets and parties; on other record types it can be defined and is shown nowhere), an approval route (a rule by kind of record, company and amount with its steps by role, added and changed on the Approvals page). Not built: a scenario, a form, a document type, a workflow, a status, a rule, a calculator, a report, a dashboard, an automation, a NUMI rule (learned rules can only be disabled), a Sentinel rule (two thresholds only), a template.

### 1916 FINAL PRINCIPLE

Phase 1 · module Engineering Governance · recorded status: PLANNED

NUMERO must not merely be:
CONFIGURABLE SOFTWARE.
It should become:
A CONFIGURABLE FINANCIAL OPERATING SYSTEM.
The accounting core remains rigid where truth requires rigidity.
The business layer remains flexible where business requires flexibility.
RIGID FINANCIAL INTEGRITY.
FLEXIBLE BUSINESS ARCHITECTURE.
CLAUDE CODE ZERO-OMISSION REMINDER
Add ALL requirements in this specification to the NUMERO Requirement Ledger.
Do not simply create a:
"Custom Fields" page
and claim this prompt is implemented.
The requirement is the COMPLETE configurable architecture:
DEPARTMENTS
PATHS
SCENARIOS
FIELDS
FORMS
WORKFLOWS
RULES
APPROVALS
DOCUMENTS
ACCOUNTING MAPPINGS
REPORTS
CALCULATORS
DASHBOARDS
PERMISSIONS
NUMI
SENTINEL
FORWARD
REALITY
TRUTH
DIGITAL TWIN.
If implementation is phased:
TRACK EVERYTHING.
DO NOT OMIT ANYTHING.

Recorded note: (none)

