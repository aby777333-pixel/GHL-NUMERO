# Phase 3 requirements (98)


## Inventory

### 24 INVENTORY

Prompt I · spec line 230

Where enabled:
Items
SKUs
Categories
Warehouses
Lots
Batches
Serial numbers
Expiry dates
Stock movements
Stock valuation
Transfers
Returns
Damaged goods
Reorder levels
Support configurable valuation methods where accounting standards permit.

### 28 MEDICAL MACHINERY

Prompt I · spec line 249

Track equipment using:
Manufacturer
Model
Serial Number
Import Details
Purchase Cost
Landed Cost
Sale Price
Installation
Warranty
AMC
Service Contract
Customer Location
Engineer Visits
Spare Parts
Accounting should connect sales, inventory, warranty obligations and service revenue.

### 29 WELLNESS / MEDICINES

Prompt I · spec line 253

Where legally applicable and required, support:
Products
Batch numbers
Expiry dates
Suppliers
Purchase cost
Inventory
Sales
Returns
Damaged/expired stock
Tax classifications
Do not attempt to replace regulated pharmaceutical compliance systems unless explicitly integrated and validated.

### 153 MULTIPLE OFFICES PER COMPANY

Prompt II · spec line 1098

A company may operate:
50 branches
20 warehouses
10 construction sites
5 regional offices
NUMERO must handle this without creating separate companies unnecessarily.

### 482 MATERIALITY ENGINE

Prompt V · spec line 3065

Allow company-specific materiality thresholds.
Example:
A ₹5,000 difference may be important for one entity but immaterial for another.
Do not use materiality to erase or falsify transactions.

### 568 PHYSICAL STOCK COUNT

Prompt VI · spec line 4614

Workflow:
Freeze / Snapshot
↓
Count
↓
Difference
↓
Review
↓
Approved Adjustment

### 570 STOCK LOSS

Prompt VI · spec line 4629

Track:
Damage
Expiry
Theft
Breakage
Obsolescence
Shrinkage
Require approved adjustment.

### 571 MANUFACTURING OPTIONAL MODULE

Prompt VI · spec line 4633

If future companies manufacture products, support:
BOM
Raw Material
WIP
Finished Goods
Production Orders
Material Consumption
Labour
Machine Cost
Overhead
Scrap
Wastage
Yield

### 573 LANDED COST ENGINE

Prompt VI · spec line 4639

Allocate total landed cost across inventory using configurable methods.
Example:
Purchase Cost
Freight
Insurance
Customs
Clearing
Port Charges
= LANDED COST

### 635 FINANCIAL IMPORT VALIDATION

Prompt VI · spec line 5096

Before importing:
Preview
Validate
Duplicate Check
Balance Check
Mapping Check
Then:
COMMIT IMPORT

### 700 INVENTORY LOSS EXPOSURE

Prompt VII · spec line 5736

Identify recorded conditions such as:
Near Expiry
Expired
Damaged
Obsolete
Slow Moving
Missing
Estimate financial exposure separately from posted loss.

### 1275 NUMERO DATA WAREHOUSE

Prompt X · spec line 11382

Create scalable analytical architecture for historical group financial information.
Do not make operational ledger queries carry every analytical workload.

### 1387 INVENTORY VERIFICATION

Prompt XI · spec line 12357

Book Quantity vs Physical Quantity.

### 1503 FEATURE INVENTORY

Prompt XII · spec line 13339

Maintain living inventory of every NUMERO capability.
Organize by:
Accounting
Banking
Treasury
Payroll
People Cost
Expenses
Revenue
Tax
Audit
Projects
Assets
Inventory
Parties
Documents
Forward
Sentinel
Reality
Truth
Digital Twin
NUMI
Security
Integrations
etc.

### 1509 NEVER TRUST MEMORY ALONE

Prompt XII · spec line 13404

For important implementation decisions:
Consult the specification files and existing code.


## Investments

### 30 INVESTMENT / AIF ACCOUNTING

Prompt I · spec line 257

Create an optional specialized module for investment businesses.
Support structures such as:
Funds
Schemes
Investors
Capital commitments
Capital calls
Contributions
Units
Investment transactions
Portfolio companies
Expenses
Management fees
Distributions
Realized gains/losses
Unrealized gains/losses
NAV calculations
Investor statements
Maintain approval, valuation and audit trails.
Do not treat the investment accounting module as interchangeable with ordinary commercial accounting.
Design interfaces so SEBI/AIF-specific reporting and controls can be configured separately and validated by qualified professionals.

### 456 DIVIDENDS / DISTRIBUTIONS

Prompt V · spec line 2967

Track:
Declaration
Approval
Shareholder/Investor Entitlement
Payment
Tax treatment where applicable

### 561 CORPORATE STRUCTURE REGISTER

Prompt VI · spec line 4586

Create:
GHL CORPORATE TREE
Track:
Holding Company
Subsidiary
Associate
JV
SPV
Investment Entity
Operating Company

### 1350 GROUP INVESTMENT MAP

Prompt XI · spec line 12107

Show investments held by each company.


## Digital Twin

### 54 SCENARIO LAB

Prompt I · spec line 436

Authorized users can create hypothetical scenarios without changing real books.
Examples:
"What happens if revenue drops 20%?"
"What happens if expenses rise 15%?"
"What happens if collections are delayed 30 days?"
"What happens if we purchase ₹5 crore of equipment?"
"What happens if interest rates rise?"
Create:
Base
Optimistic
Conservative
Custom
Clearly label scenarios as simulations.

### 89 FINANCIAL DIGITAL TWIN

Prompt I · spec line 668

Create a financial model of the group based on actual accounting records and approved assumptions.
The Owner can test hypothetical decisions without touching real books.
Example:
Acquire property
Hire 100 employees
Open new branch
Borrow ₹10 crore
Increase marketing
Delay project
Lose major customer
NUMERO calculates modeled financial consequences and clearly distinguishes simulations from recorded accounting facts.

### 427 SCENARIO ENGINE 2.0

Prompt V · spec line 2817

Create:
WHAT IF?
Examples:
Revenue drops 10%.
Revenue grows 25%.
Customer payments delay 45 days.
Fuel rises 20%.
Payroll increases 15%.
Marketing doubles.
Interest rate increases.
New ₹50 crore project starts.

### 428 SCENARIO COMPARISON

Prompt V · spec line 2829

Show side-by-side:
BASE CASE
SCENARIO A
SCENARIO B
SCENARIO C
Compare:
Revenue
Profit
Cash
Debt
Working Capital

### 508 FINANCIAL DIGITAL TWIN 2.0

Prompt V · spec line 3240

Combine:
Actual Accounting
Budget
Commitments
Contracts
Orders
Loans
Payroll
Subscriptions
Projects
Forecasts
into a modeled financial representation of each company and the Group.
Never mix simulated numbers with actual accounting records.

### 634 SANDBOX ENVIRONMENT

Prompt VI · spec line 5090

Create safe:
NUMERO SANDBOX
Test:
New Accounting Rules
Integrations
Import Mapping
Reports
Automation
without affecting production books.

### 815 THE "WHAT IF THIS GOES WRONG?" ENGINE

Prompt VII · spec line 6643

Example:
"What happens if our top 3 customers pay 60 days late?"
Simulate:
Cash
Working Capital
Borrowing Requirement
Payment Coverage
Clearly mark simulation.

### 1285 VALUATION LAB

Prompt X · spec line 11454

Support configurable analysis such as:
DCF
Comparable Inputs
Asset-Based Analysis
Scenario Valuation
All assumptions explicit.

### 1295 FINANCIAL DIGITAL TWIN 2.0

Prompt X · spec line 11552

Create a continuously updated:
NUMERO DIGITAL TWIN
Represent:
Companies
Cash
People
Payroll
Assets
Liabilities
Debt
Contracts
Projects
Properties
Inventory
Investments
Receivables
Payables
Commitments
Taxes
Forecasts

### 1296 DIGITAL TWIN SIMULATION

Prompt X · spec line 11573

Ask:
"What happens if sales fall 25%, collections are delayed 45 days and we invest ₹5 crore?"
Run simulation.
Never alter actual books.

### 1297 MULTI-SHOCK SIMULATION

Prompt X · spec line 11578

Combine:
Revenue Shock
Margin Shock
Interest Shock
FX Shock
Payroll Increase
Cost Increase
Collection Delay
CAPEX
Project Overrun

### 1358 GROUP DIGITAL TWIN

Prompt XI · spec line 12143

Simulate group-wide scenarios.
Example:
"What happens if group collections are delayed 30 days?"

### 1359 COMPANY DIGITAL TWIN

Prompt XI · spec line 12147

Each company also has independent simulation.

### 1423 ACCOUNTING SANDBOX

Prompt XI · spec line 12625

Allow finance team to test accounting scenarios without touching books.

### 1424 CONFIGURATION SANDBOX

Prompt XI · spec line 12627

Test:
Workflow
Approval
Accounting Mapping
Automation
Integration
before production.

### 1425 DIGITAL TWIN SANDBOX

Prompt XI · spec line 12635

Run unlimited simulations isolated from actuals.

### 1543 REAL MONEY SAFETY

Prompt XII · spec line 13623

Treat integrations capable of moving money as HIGH RISK.
Development/testing must use appropriate sandbox/test environments whenever available.

### 1768 DYNAMIC SCENARIO BUILDER

Prompt XIV · spec line 15789

Create:
NUMERO SCENARIO STUDIO
A scenario means a business situation with its own workflow.

### 1769 SCENARIO EXAMPLES

Prompt XIV · spec line 15793

Employee Travel
Petty Purchase
Emergency Cash
Site Advance
Client Entertainment
Charitable Donation
Vendor Advance
Refund
Insurance Claim
Accident
Asset Purchase
Project Launch
Event
Seminar
Customer Refund
Custom.

### 1770 CREATE SCENARIO

Prompt XIV · spec line 15810

Admin clicks:
+ NEW SCENARIO
Define:
Trigger
Actors
Path
Form
Fields
Money Flow
Approval
Accounting
Documents
Settlement
Notifications
NUMI Behavior
Sentinel Rules
Reports.

### 1771 SCENARIO START TRIGGER

Prompt XIV · spec line 15828

Possible:
Manual
Voice
Form
Document Upload
Email
API
Schedule
Event
Bank Transaction
Invoice
Contract
NUMI Detection.

### 1772 SCENARIO WORKFLOW

Prompt XIV · spec line 15842

Example:
EMPLOYEE REQUEST
↓
MANAGER APPROVAL
↓
FINANCE
↓
FUND RELEASE
↓
EVIDENCE
↓
SETTLEMENT
↓
ACCOUNTING
↓
RECONCILIATION.

### 1798 RULE SIMULATION

Prompt XIV · spec line 16030

Before activation:
Show how rule would have behaved against historical authorized data.

### 1809 SCENARIO DASHBOARD

Prompt XIV · spec line 16084

Example:
TRAVEL
Upcoming Trips
Advances
Expense
Settlement
Overdue Evidence.

### 1820 DOCUMENT REQUIREMENT BY SCENARIO

Prompt XIV · spec line 16161

Each scenario determines what documents are required.

### 1828 CLONE SCENARIO

Prompt XIV · spec line 16198

Clone workflow and modify.

### 1838 CONFIGURATION SANDBOX

Prompt XIV · spec line 16220

Test configuration before production.

### 1901 DYNAMIC DIGITAL TWIN

Prompt XIV · spec line 16518

Configured financial drivers can be used in simulations where appropriate.


## Reality

### 575 ASSET PHYSICAL VERIFICATION

Prompt VI · spec line 4670

Periodic asset verification.
Status:
Located
Transferred
Damaged
Missing
Disposed

### 1385 PHYSICAL VERIFICATION ENGINE

Prompt XI · spec line 12343

Create:
NUMERO VERIFY
Verify physical:
Inventory
Assets
Cash
Documents where appropriate

### 1389 CONFIRMATION ENGINE

Prompt XI · spec line 12364

Create:
NUMERO CONFIRM
For:
Banks
Customers
Vendors
Loans
Deposits
Investments
Intercompany

### 1454 NUMERO REALITY ENGINE

Prompt XI · spec line 12831

Create one of the most important NUMERO systems:
NUMERO REALITY
NUMERO must reconcile five forms of reality.

### 1455 DOCUMENT REALITY

Prompt XI · spec line 12835

What do:
Contracts
Invoices
Receipts
POs
Agreements
Policies
say?

### 1456 OPERATIONAL REALITY

Prompt XI · spec line 12844

What was actually:
Ordered
Delivered
Built
Sold
Worked
Consumed
Completed
Received?

### 1457 ACCOUNTING REALITY

Prompt XI · spec line 12854

What was posted to books?

### 1458 CASH REALITY

Prompt XI · spec line 12856

What actually entered/left:
Bank
Cash
Card
Wallet
Payment Gateway?

### 1459 PHYSICAL REALITY

Prompt XI · spec line 12863

What actually exists?
Inventory
Assets
Equipment
Property
Cash

### 1460 REALITY RECONCILIATION

Prompt XI · spec line 12870

Continuously compare:
DOCUMENT
↔
OPERATION
↔
ACCOUNTING
↔
CASH
↔
PHYSICAL

### 1461 REALITY EXCEPTION EXAMPLE

Prompt XI · spec line 12881

PO:
100 units.
Invoice:
100 units.
Warehouse:
82 units received.
Books:
100 units expense/inventory.
Bank:
100 units paid.
NUMERO must detect:
REALITY DOES NOT RECONCILE.

### 1462 REALITY CASE

Prompt XI · spec line 12894

Create exception linking:
PO
Invoice
GRN
Inventory
Payment
Accounting
Vendor
Approvals
Documents

### 1464 REALITY HEALTH

Prompt XI · spec line 12909

Show:
Document Match
Operational Match
Accounting Match
Cash Match
Physical Match
Do not create misleading composite scores without transparent methodology.

### 1465 COMPANY REALITY

Prompt XI · spec line 12917

Every company has independent Reality Engine.

### 1466 GROUP REALITY

Prompt XI · spec line 12919

Super Admin sees authorized consolidated exception view across all companies.

### 1468 THE NUMERO REALITY PRINCIPLE

Prompt XI · spec line 12933

The books saying something happened is not enough.
NUMERO should ask:
DOES THE DOCUMENT AGREE?
DOES THE OPERATION AGREE?
DOES THE ACCOUNTING AGREE?
DOES THE CASH AGREE?
DOES THE PHYSICAL WORLD AGREE?
If not:
FIND THE DIFFERENCE.

### 1489 PRESERVE REALITY ENGINE

Prompt XII · spec line 13212

Maintain:
DOCUMENT REALITY
OPERATIONAL REALITY
ACCOUNTING REALITY
CASH REALITY
PHYSICAL REALITY.

### 1557 FUND MOVEMENT TYPES

Prompt XIII · spec line 13874

Support controlled internal movement such as:
Bank → Bank
Bank → Petty Cash
Bank → Employee Advance
Bank → Department Advance
Bank → Project Advance
Bank → Site Advance
Bank → Travel Advance
Bank → Procurement Advance
Bank → Vendor Advance
Bank → Corporate Card
Cash → Cash Box
Company → Company
Branch → Branch
Office → Office
Department → Department Allocation
Project → Project Allocation
Cost Centre → Cost Centre Reallocation
and other configurable legitimate flows.
Accounting treatment must reflect the economic reality.

### 1581 NEVER RECLASSIFY TO HIDE REALITY

Prompt XIII · spec line 14154

Admin authority does not mean ability to falsify accounting.
Reclassification must preserve:
Original Classification
New Classification
Reason
User
Date
Approval
Accounting Effect

### 1676 REPORT REALITY LINK

Prompt XIII · spec line 14893

Show reconciliation status where relevant.

### 1729 NUMERO FLOW + REALITY

Prompt XIII · spec line 15239

Fund settlement must reconcile:
APPROVAL
↔
MONEY RELEASED
↔
EVIDENCE
↔
ACTUAL USE
↔
ACCOUNTING
↔
BANK/CASH
↔
RETURN/RECOVERY.

### 1899 DYNAMIC REALITY

Prompt XIV · spec line 16514

Custom financial scenarios can participate in Reality reconciliation.


## System Health

### 304 GENERATOR / BACKUP POWER

Prompt IV · spec line 2098

Track:
Generator
Diesel
Maintenance
Operating Hours
Repairs
Associate costs with office/site.

### 592 BACKUP HEALTH

Prompt VI · spec line 4738

Owner/IT dashboard:
Last Backup
Backup Status
Last Restore Test
Recovery Readiness

### 1280 DATA OBSERVABILITY

Prompt X · spec line 11414

Monitor:
Missing Data
Stale Feeds
Abnormal Volumes
Failed Jobs
Posting Failures
Reconciliation Failures

### 1428 FEATURE FLAGS

Prompt XI · spec line 12648

Enable new capabilities by:
Group
Company
User Group
Module
before wider rollout.

### 1429 NUMERO SYSTEM HEALTH

Prompt XI · spec line 12655

Create:
NUMERO HEALTH
Monitor NUMERO itself.

### 1430 HEALTH COMPONENTS

Prompt XI · spec line 12659

Database
Posting Engine
Queues
Bank Feeds
Integrations
Storage
Backups
AI
Notifications
Reconciliation Jobs
API

### 1432 BACKUP VERIFICATION

Prompt XI · spec line 12675

Backups must be periodically tested for restorability.

### 1434 SCALE ARCHITECTURE

Prompt XI · spec line 12679

Design for:
Millions of Transactions
Millions of Journal Lines
Many Companies
Years of History
without compromising accounting integrity.

### 1535 PERFORMANCE

Prompt XII · spec line 13550

Do not solve performance problems by silently limiting financial history or hiding records.
Use proper architecture.


## Integrations

### 60 SMART EMAILER

Prompt I · spec line 474

Provide financial communications for authorized workflows.
Examples:
Invoices
Payment reminders
Statements
Receipts
Approval requests
Reports
Templates should be company-specific.
Maintain communication history.

### 61 NOTIFICATION ENGINE

Prompt I · spec line 480

Notifications through permitted channels:
In-app
Email
Push
SMS
WhatsApp where integrated
Examples:
Payment due
Collection overdue
Approval waiting
Bank reconciliation incomplete
Cash-flow warning
Anomaly detected
Tax deadline approaching
Users control notification preferences subject to mandatory governance alerts.

### 598 GHL ECOSYSTEM CONNECTIVITY

Prompt VI · spec line 4760

NUMERO should be architected to integrate with authorized internal GHL platforms.
Possible examples:
GHL ONE
Jamin Bazaar
GHL India Ventures
777 Raptor
Future GHL companies/platforms
Each integration must have scoped permissions and independent authentication.

### 1277 NUMERO API FABRIC

Prompt X · spec line 11387

Controlled integration layer for:
Banks
CRM
HR
Payroll
POS
ERP
E-Commerce
Logistics
GHL ONE
Jamin Bazaar
777 Raptor
Future GHL Systems


## General

### 200 TRAIN / BUS

Prompt III · spec line 1454

Track:
Operator
Booking Reference
Origin
Destination
Class
Fare
Taxes
Booking Charges

### 476 YEAR-ON-YEAR ANALYSIS

Prompt V · spec line 3040

Compare:
FY2026 vs FY2025
and multiple years where data exists.

### 479 BURN RATE

Prompt V · spec line 3055

For cash-consuming companies calculate:
Monthly Cash Burn.

### 608 OWNER ATTENTION ENGINE

Prompt VI · spec line 4858

Do not overwhelm Owner with routine bookkeeping.
Classify:
INFORMATION
FINANCE ACTION
MANAGEMENT ACTION
OWNER ACTION
CRITICAL

### 775 STATISTICAL DETECTION

Prompt VII · spec line 6287

Use statistical methods to identify unusual deviations from historical behaviour.
Explain why something is unusual.

### 780 CASE STATUS

Prompt VII · spec line 6330

Possible:
Open
Triage
Under Review
Investigating
Substantiated
Unsubstantiated
Remediated
Closed

### 1245 ALLOCATION TRANSPARENCY

Prompt X · spec line 11098

Every allocated cost must explain:
Source
Amount
Driver
Formula
Recipients
Period

### 1354 GROUP COMPLIANCE VIEW

Prompt XI · spec line 12124

Show deadlines across companies.

### 1363 NUMERO GENESIS

Prompt XI · spec line 12162

Create:
NUMERO GENESIS
The controlled starting point for every new company entering NUMERO.

### 1370 PARALLEL RUN

Prompt XI · spec line 12221

Allow legacy system and NUMERO to operate in parallel during transition.

### 1513 TODO IS NOT IMPLEMENTATION

Prompt XII · spec line 13423

A placeholder, comment, mock button or empty screen does not count as implemented.

### 1678 DO NOT GENERATE FALSE PRECISION

Prompt XIII · spec line 14904

If data incomplete:
Say so.

### 1799 FALSE-POSITIVE REVIEW

Prompt XIV · spec line 16033

Allow adjustment.

### 1826 CLONE DEPARTMENT

Prompt XIV · spec line 16194

Clone configured department.

### 1886 DEPARTMENT CUSTOMIZATION

Prompt XIV · spec line 16481

Department Admin may configure permitted department-specific items.

### 1887 COMPANY CUSTOMIZATION

Prompt XIV · spec line 16483

Company Admin configures company-level structure subject to authority.
