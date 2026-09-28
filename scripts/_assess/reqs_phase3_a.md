# Phase 3 requirements, part A: Inventory, Investments, System Health, Integrations

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


