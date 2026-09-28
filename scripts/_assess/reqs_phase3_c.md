# Phase 3 requirements, part C: Reality, General

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
