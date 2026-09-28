# Requirements of phases 1 and 2 whose record may have changed because of what phase 3 built

Chosen by key words in the text of the requirement or in its note. Being listed here proves nothing: most of these records will not change.

### 696 DIVIDEND / DISTRIBUTION PIPELINE

Phase 2 · module Forward · recorded status: PARTIAL

Track:
Proposed
Board Approved
Declared
Payable
Paid

Recorded note: Built: a Dividend / Distribution register item with amount, date, declaration date and approval reference, shown in Forward as EXPECTED. Not built: the stages proposed, board approved, declared, payable and paid as a tracked pipeline — the state is chosen from the list the database accepts, which has proposed, approved, due and paid but neither declared nor payable; any posting of the dividend.

### 697 CSR / DONATION

Phase 2 · module Forward · recorded status: PARTIAL

Track where applicable:
Proposal
Beneficiary
Purpose
Approval
Commitment
Payment
Supporting Documents
Compliance Classification

Recorded note: Built: a CSR / Donation Commitment register item with beneficiary (party), purpose, approval reference, committed amount and date, and supporting documents. Not built: proposal and approval as a workflow; a link to the payment; compliance classification.

### 712 CONTRACT RENEWAL WARNING

Phase 2 · module Forward · recorded status: PARTIAL

Alert:
90 days
60 days
30 days
7 days
before configured renewal/expiry.

Recorded note: Built: a warning is shown from 90 days before a renewal, cancel-by, end or watched date, for information; its level rises at 60 days (review), at 30 days (priority) and at 7 days (critical), and it stays critical once the date has passed (tested). Not built: alerts as messages — the warning is one line in Forward whose level changes, seen by a person who opens Forward or asks NUMI, and nothing is stored or sent at the four points; configuration of the notice periods.

### 713 SUBSCRIPTION RENEWAL WARNING

Phase 2 · module Forward · recorded status: IMPLEMENTED

Before renewal show:
Cost
Usage if integration provides it
Owner
Cancellation Deadline

Recorded note: Before a renewal or a cancel-by date Forward shows the cost and frequency of the subscription, its owner (or that none is recorded), the cancel-by date and whether it renews automatically. Usage is not shown: no integration provides it. The test of early warnings does not assert a subscription renewal specifically.

### 715 BANK GUARANTEE EXPIRY WARNING

Phase 2 · module Forward · recorded status: PARTIAL

Notify responsible users well before expiry.

Recorded note: Built: a warning for the expiry and the claim expiry of a guarantee from 90 days before, naming the recorded owner (tested). Not built: notifying the responsible user. The warning is visible only to a person who opens Forward or asks NUMI; nothing is sent.

### 721 NUMERO FORWARD CALENDAR

Phase 1 · module Forward · recorded status: PARTIAL

Create visual calendar showing:
Collections
Payments
Payroll
Taxes
Rent
EMIs
Subscriptions
Insurance
Contract Milestones
Renewals
Capital Calls
Distributions
Project Payments
Guarantee Expiry

Recorded note: Built: a visual month calendar in Forward with collections, payments, payroll, rent, loan instalments, subscriptions, insurance premiums, capital calls, distributions and project payments under work orders, each day showing inflow, outflow and the number of contingent items, and each event opening its record. Not built: dates that carry no amount are not on the calendar — guarantee expiry, renewals and tax deadlines recorded without an amount are raised as early warnings instead; contract milestones as dated events (a contract carries its milestones as text and an amount by frequency).

### 724 FRAUD & ANOMALY DEFENCE SYSTEM

Phase 1 · module Sentinel · recorded status: PARTIAL

Create:
NUMERO SENTINEL
A continuous financial-integrity and anomaly-detection layer.
Sentinel must examine authorized transactional and master data for patterns that may require investigation.
Critical principle:
ANOMALY ≠ FRAUD
NUMERO must never automatically accuse an employee, vendor, customer or other Party of fraud merely because something is unusual.
Use:
ANOMALY
CONTROL EXCEPTION
REVIEW REQUIRED
POTENTIAL DUPLICATE
POTENTIAL CONFLICT
INVESTIGATION
until appropriate humans establish facts.

Recorded note: Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.

### 725 SENTINEL MONITORING

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor relevant:
Invoices
Payments
Receipts
Expenses
Payroll
Vendor Masters
Customer Masters
Bank Accounts
Journals
Refunds
Credit Notes
Purchase Orders
Goods Receipts
Inventory
Corporate Cards
Petty Cash
Commissions
Loans
Assets
Intercompany Transactions
User Activity
Approval Activity

Recorded note: (none)

### 740 INVOICE SEQUENCE ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Identify unusual patterns such as repeated invoice numbers or suspicious numbering changes.

Recorded note: (none)

### 741 PRICE ANOMALY

Phase 1 · module Sentinel · recorded status: PLANNED

Compare same item/service historical price.
Example:
Previous average: ₹100
Current: ₹165
Flag significant variance.

Recorded note: (none)

### 742 QUANTITY ANOMALY

Phase 1 · module Sentinel · recorded status: PLANNED

Compare ordered/received/invoiced quantities.

Recorded note: (none)

### 746 REFUND ANOMALY

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor:
Repeated Refunds
High Refund Amount
Refund to Different Bank Account
Refund Without Original Transaction

Recorded note: (none)

### 747 CREDIT NOTE ANOMALY

Phase 1 · module Sentinel · recorded status: PLANNED

Identify unusual volume/value of credit notes by:
Customer
Employee
Branch
Period

Recorded note: (none)

### 748 DISCOUNT ANOMALY

Phase 1 · module Sentinel · recorded status: PLANNED

Flag discounts significantly outside configured/historical norms.

Recorded note: (none)

### 752 PAYROLL ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Detect potential issues such as:
Duplicate Employee Payment
Salary After Recorded Exit Date
Unusual Salary Change
Duplicate Bank Account
Unexpected Bonus
Unusual Overtime
Large Reimbursement
Require human review.

Recorded note: (none)

### 754 TRAVEL ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Examples:
Duplicate Hotel Claim
Duplicate Flight Claim
Hotel + Per Diem conflict according to company policy
Travel Expense Outside Approved Trip
Cancelled Ticket Still Claimed

Recorded note: (none)

### 755 FUEL ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Examples:
Fuel Quantity exceeds plausible configured vehicle capacity
Fuel purchases too close together
Fuel while vehicle recorded inactive
Unexpected mileage pattern
These require review and should account for incomplete data.

Recorded note: (none)

### 756 PETTY CASH ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Detect:
Repeated Round Amounts
Repeated Missing Receipts
Frequent Cash Top-Ups
Negative Cash
Physical Cash Difference

Recorded note: (none)

### 757 CORPORATE CARD ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor:
Unrecognized Merchant
Duplicate Charge
Cash Withdrawal where prohibited
Personal Expense
Foreign Transaction
Large Charge
Unsubmitted Receipt

Recorded note: (none)

### 758 PROCUREMENT ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Identify patterns:
Repeated Single-Vendor Procurement
Repeated Emergency Purchases
PO Created After Invoice
Invoice Before Vendor Approval
Multiple Quotes with suspiciously identical data where detectable
Repeated Purchase Just Below Approval Threshold

Recorded note: (none)

### 759 COMMISSION ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Detect:
Duplicate Commission
Commission Above Contracted Rule
Commission Without Underlying Transaction
Commission Paid After Cancellation
Unexpected Manual Override

Recorded note: (none)

### 760 INVENTORY ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor:
Unexpected Stock Adjustment
Repeated Damage
Negative Inventory
Large Shrinkage
Unusual Write-Off
Warehouse Variance

Recorded note: (none)

### 761 ASSET ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Examples:
Asset Missing
Asset Sold Below Recorded threshold requiring review
Duplicate Asset
Asset Purchase Without Approval
Unexpected Disposal

Recorded note: (none)

### 762 CASH ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor:
Large Cash Withdrawal
Large Cash Payment
Repeated Cash Payments
Cash Transactions Just Below Approval Threshold
Unreconciled Cash

Recorded note: (none)

### 763 BANK ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Monitor:
Unknown Beneficiary
Unexpected Bank Charge
Duplicate Debit
Large Transfer
Transfer to Newly Added Beneficiary
Unusual Cross-Company Movement

Recorded note: (none)

### 764 REVENUE ANOMALIES

Phase 1 · module Sentinel · recorded status: PLANNED

Identify:
Unusual Revenue Spike
Revenue Reversal
Invoice Without Supporting Order/Contract where required
Large Credit Note
Unexpected Customer Concentration

Recorded note: (none)

### 773 ANOMALY BASELINES

Phase 1 · module Sentinel · recorded status: PLANNED

Sentinel should understand normal patterns by:
Company
Vendor
Employee
Account
Department
Project
Transaction Type
Season
Do not compare unrelated companies blindly.

Recorded note: (none)

### 776 AI ANOMALY DETECTION

Phase 1 · module Sentinel · recorded status: PLANNED

AI can identify complex patterns not covered by simple rules.
But AI must provide:
Evidence
Reason
Relevant Transactions
Confidence
and never issue unsupported accusations.

Recorded note: (none)

### 778 SENTINEL CASE MANAGEMENT

Phase 1 · module Sentinel · recorded status: PARTIAL

When serious anomaly appears:
Create:
CASE
Case ID
Issue
Transactions
People
Parties
Documents
Timeline
Financial Exposure
Investigator
Status

Recorded note: No investigation workspace.

### 782 CASE CONFIDENTIALITY

Phase 1 · module Black Vault · recorded status: PLANNED

Sentinel investigations default to highly restricted access.
Possible:
Super Admin
Legal
Compliance
Internal Audit
Authorized Investigator

Recorded note: (none)

### 783 INVESTIGATION INDEPENDENCE

Phase 1 · module Audit · recorded status: PLANNED

Where configured, users involved in a flagged transaction should not be able to alter investigation evidence or close their own case.

Recorded note: (none)

### 786 CONTROL REMEDIATION

Phase 1 · module Approvals · recorded status: PLANNED

After case:
What control failed?
What changed?
Who approved remediation?
When implemented?

Recorded note: (none)

### 787 SENTINEL LEARNING

Phase 1 · module Sentinel · recorded status: PLANNED

When investigators mark:
False Positive
Valid Exception
Control Failure
Substantiated Issue
use this feedback to improve suggestions where technically appropriate.
Never weaken mandatory controls merely because anomalies are frequently dismissed.

Recorded note: (none)

### 788 FRAUD TREND ANALYSIS

Phase 1 · module Sentinel · recorded status: PLANNED

Authorized management can analyze:
Cases by Company
Type
Financial Exposure
Recovery
Control Failure
Period
Do not expose confidential case information beyond permissions.

Recorded note: (none)

### 794 CRITICAL PAYMENT INTERCEPT

Phase 1 · module Sentinel · recorded status: PLANNED

For configured high-risk patterns, NUMERO can:
HOLD FOR REVIEW
before internal payment workflow completion.
Examples:
New Vendor + Large Payment
Bank Details Just Changed
Possible Duplicate Invoice
Missing Required Approval
The authorized human decides.

Recorded note: (none)

### 795 NEVER SECRETLY BLOCK ACCOUNTING

Phase 1 · module Black Vault · recorded status: IMPLEMENTED

Sentinel can block workflow according to configured controls.
It must explain:
What Rule Triggered
Why
What Is Required
Who Can Resolve

Recorded note: (none)

### 796 WHISTLEBLOWER LINK

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

Where a lawful whistleblower system exists, authorized compliance users may link a report to:
Transaction
Vendor
Employee
Case
Document
Keep identities restricted.

Recorded note: Built: an incident of type 'Whistleblower report' with one party, attached documents and a confidentiality level that limits who can read it. Not built: links to a transaction, an employee or a case; protection of the identity of the reporter apart from the record (the 'reported by' field is visible to everyone who can read the incident); linkage to a separate whistleblower system.

### 798 EXTORTION / COERCION CASE LINK

Phase 2 · module Incidents & Exceptions · recorded status: PARTIAL

If extortion/coercion is reported:
Create protected incident.
Link:
Payments
Communications
Documents
Insurance
Legal Review
Do not provide functionality to facilitate or disguise unlawful payments.

Recorded note: Built: a protected incident (confidentiality level) of type 'Extortion / coercion reported' with attached documents, insurance claim reference, report to authorities and reviewer. NUMERO has no function that facilitates or disguises a payment. Not built: links to payments and communications; insurance and legal review as linked records (text fields only).

### 802 SENTINEL CONTROL LIBRARY

Phase 1 · module Sentinel · recorded status: PLANNED

Provide configurable control templates for:
Procurement
Vendor
Payments
Payroll
Expenses
Corporate Cards
Petty Cash
Revenue
Refunds
Inventory
Assets
Journals
Banking
Intercompany

Recorded note: (none)

### 804 SENTINEL SIMULATION

Phase 1 · module Sentinel · recorded status: PLANNED

Before activating a new fraud-control rule:
Run it against historical data.
Show:
How many alerts would have occurred?
Which transactions?
Estimated operational impact?
Then management decides.

Recorded note: (none)

### 809 ANOTHER EXAMPLE

Phase 1 · module Sentinel · recorded status: PLANNED

FORWARD:
Subscription renews tomorrow for ₹12 lakh.
SENTINEL:
No recorded usage/owner information for 8 months where usage integration exists.
NUMERO:
REVIEW BEFORE RENEWAL
Do not automatically cancel.

Recorded note: (none)

### 811 NUMERO FINANCIAL RADAR

Phase 1 · module Sentinel · recorded status: PLANNED

Create one visual radar combining:
CASH
COLLECTIONS
PAYMENTS
COMMITMENTS
PAYROLL
TAX
DEBT
CONTRACTS
PROJECTS
RENEWALS
ANOMALIES
AUDIT

Recorded note: (none)

### 814 THE "CAN WE AFFORD IT?" ENGINE

Phase 2 · module Forward · recorded status: PLANNED

Owner asks:
"Can we afford to spend ₹5 crore on a new project?"
NUMERO does NOT give a simplistic yes/no.
Instead show:
Current Cash
Committed Outflows
Expected Collections
Debt Obligations
Payroll
Tax
Minimum Cash Policy
Forecast Position
Scenario with ₹5 crore investment
Then management decides.

Recorded note: No answer to 'can we afford it' and no scenario with a proposed spend. Forward shows the ingredients (cash, committed outflows, expected collections, debt, payroll) separately; the minimum cash threshold is kept in the browser only.

### 816 FUTURE FINANCIAL STRESS TEST

Phase 2 · module Forward · recorded status: PLANNED

Scenarios:
Revenue -10%
Revenue -30%
Receivable Delay
Interest Increase
FX Movement
Fuel Increase
Payroll Increase
Construction Overrun
Unexpected ₹1 crore Expense

Recorded note: No stress test or scenario of any kind.

### 823 FINAL DIRECTIVE

Phase 1 · module Engineering Governance · recorded status: PLANNED

When GHL NUMERO is complete, the Super Admin should be able to ask:
"WHAT HAS HAPPENED?"
NUMERO shows actual accounting.
"WHAT IS HAPPENING?"
NUMERO shows current financial position.
"WHAT HAVE WE ALREADY COMMITTED TO?"
NUMERO shows contracts, POs and obligations.
"WHAT IS COMING?"
NUMERO FORWARD shows expected inflows and outflows.
"WHAT COULD GO WRONG?"
NUMERO shows transparent scenarios and early warnings.
"DOES ANYTHING LOOK WRONG?"
NUMERO SENTINEL shows anomalies and control exceptions.
"WHY?"
NUMERO shows evidence.
"WHO NEEDS TO ACT?"
NUMERO identifies the responsible authorized person.
"CAN I SEE THE ORIGINAL?"
NUMERO opens the transaction, contract, invoice, receipt, approval or other source evidence.

Recorded note: (none)

### 824 NUMI PHILOSOPHY

Phase 1 · module NUMI · recorded status: PLANNED

The user should never have to think:
"Where is that function?"
Instead they should be able to tell NUMI:
"Do this."
"Find this."
"Calculate this."
"Explain this."
"Prepare this."
"Show me this."
"Compare this."
"Check this."
"Why did this happen?"
"What am I missing?"
"What needs attention?"
"What happens next?"
"Help me."
NUMI finds the correct NUMERO capability.

Recorded note: (none)

### 828 NUMI ACTION LEVELS

Phase 1 · module NUMI · recorded status: PLANNED

Every AI capability belongs to one of these levels.
LEVEL 1 — EXPLAIN
Read and explain.
LEVEL 2 — SUGGEST
Recommend possible action.
LEVEL 3 — PREPARE
Create drafts, reports, journals, reconciliations, workflows, etc.
LEVEL 4 — EXECUTE ROUTINE AUTHORIZED ACTION
Execute explicitly permitted low-risk/routine actions.
LEVEL 5 — APPROVAL REQUIRED
Prepare consequential action and route to authorized human.
NUMI must never bypass required approval.

Recorded note: (none)

### 838 NUMI SAVINGS ENGINE

Phase 1 · module NUMI · recorded status: PLANNED

User:
"WHERE CAN WE SAVE MONEY?"
NUMI analyzes factual expenditure patterns.
Possible areas:
Unused Software
Duplicate Subscriptions
Cancellation Fees
Late Fees
Excess Banking Charges
Recurring Services
Travel Patterns
Vendor Pricing
Utility Trends
Unused Assets
Inventory Waste
Expired Stock
Unclaimed Refunds
Old Advances
Excess Cloud Costs where data exists
Procurement Price Variance

Recorded note: (none)

### 845 NUMI MARGIN ENGINE

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"Where are we making the most money?"
Analyze profitability by:
Company
Project
Customer
Product
Service
Property
Office
Department
Channel
Contract
Use recorded allocation methodology.

Recorded note: (none)

### 846 NUMI LOSS ENGINE

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"Where are we losing money?"
Show:
Loss-making Projects
Negative-margin Customers
Products
Contracts
Departments where applicable
Properties
Branches
Explain cost allocation assumptions.

Recorded note: (none)

### 850 NUMI SCENARIO LAB

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"What if revenue falls 20%?"
"What if we hire 50 employees?"
"What if rent increases 15%?"
"What if we buy a ₹10 crore property?"
"What if collections are delayed 60 days?"
NUMI creates simulations.
Never modify actual books.

Recorded note: (none)

### 851 NUMI SENTINEL ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

User may ask:
"Is anyone defrauding us?"
NUMI must NOT simply name a person.
Instead respond with evidence-based review information.
Example:
"I found 8 high-attention control exceptions and 23 lower-level anomalies. These patterns require investigation and do not by themselves establish fraud."
Then show relevant cases.

Recorded note: (none)

### 852 NUMI FRAUD REVIEW

Phase 1 · module NUMI · recorded status: PLANNED

Analyze authorized data for:
Duplicate Invoices
Duplicate Payments
Threshold Splitting
Unusual Vendors
Bank Changes
Missing GRNs
Unexpected Refunds
Manual Journals
Expense Anomalies
Payroll Exceptions
Card Exceptions
Petty Cash Exceptions
Commission Exceptions
Inventory Loss
Asset Disposals
User Permission Conflicts

Recorded note: (none)

### 853 NUMI INVESTIGATION ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

For authorized investigators:
"Build a timeline for this case."
NUMI organizes:
Vendor Creation
Bank Change
Invoice
Approval
Payment
Emails/Documents available to the case
System Activity
Recovery
Evidence

Recorded note: (none)

### 856 NUMI AUDIT ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"Prepare us for audit."
NUMI checks:
Bank Reconciliations
Customer/Vendor Confirmations
Missing Documents
Manual Journals
Fixed Assets
Inventory
Suspense
Intercompany
Payroll
Tax Reconciliations
Open Advances
Period Locks
Audit Queries

Recorded note: (none)

### 859 NUMI UNIVERSAL RECONCILER

Phase 1 · module NUMI · recorded status: PLANNED

Can assist with:
Bank
Cards
Cash
Customer
Vendor
Intercompany
Payroll
Tax
Inventory
Assets
Investments
Advances

Recorded note: (none)

### 860 NUMI BOOKKEEPING ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

NUMI can prepare:
Journals
Accruals
Prepayments
Recurring Entries
Depreciation
Reclassifications
Reversals
based on configured policies.
Approvals remain enforced.

Recorded note: (none)

### 863 NUMI YEAR-END ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Assist with:
Year-End Checklist
Audit Preparation
Asset Verification
Inventory
Accruals
Provisions
Intercompany
Tax
Closing Journals
Financial Statement Preparation
Never independently make material accounting judgments.

Recorded note: (none)

### 864 NUMI TAX ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

NUMI can:
Organize tax-related transactions
Identify missing tax data
Prepare reconciliations
Estimate upcoming liabilities
Track deadlines
Explain differences
Actual statutory filing/tax positions remain subject to configured approvals and professional validation.

Recorded note: (none)

### 865 NUMI PAYROLL FINANCE ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Ask:
"What's next month's expected payroll?"
"Who has outstanding advances?"
"Show payroll vs last month."
"Find payroll anomalies."
NUMI uses authorized payroll financial data.

Recorded note: (none)

### 873 NUMI INVESTMENT ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Authorized questions:
"Show our investments."
"What's maturing?"
"Show realized/unrealized values according to approved records."
"Show expected investor flows."
No autonomous investment decisions or trading.

Recorded note: (none)

### 877 NUMI REPORT BUILDER

Phase 1 · module NUMI · recorded status: PLANNED

User:
"Make a report of all travel expenditure by employee for FY2026."
NUMI builds report.
User:
"Add department."
"Add hotels."
"Show chart."
"Save this report."

Recorded note: (none)

### 880 NUMI WORKFLOW BUILDER

Phase 1 · module NUMI · recorded status: PLANNED

User:
"Any expense above ₹5 lakh should require CFO approval."
NUMI translates into proposed workflow.
Show rule.
Human confirms.
Then activate.

Recorded note: (none)

### 881 NUMI AUTOMATION BUILDER

Phase 1 · module NUMI · recorded status: PLANNED

User:
"Every Monday send me overdue receivables."
NUMI creates proposed scheduled workflow through authorized notification infrastructure.

Recorded note: (none)

### 883 NUMI MODULE BUILDER

Phase 1 · module NUMI · recorded status: PLANNED

Super Admin:
"Create a new module for event expenses."
NUMI can propose:
Data Model
Fields
Workflow
Permissions
Reports
Accounting Mapping
Integrations
Before implementation.

Recorded note: (none)

### 885 NUMI EXCEL / CSV ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Upload spreadsheet.
Ask:
"What is this?"
NUMI analyzes structure.
Then:
Map
Validate
Preview
Import
subject to authorization.

Recorded note: (none)

### 890 NUMI TEACH ME

Phase 1 · module NUMI · recorded status: PLANNED

Create:
TEACH ME
NUMI can explain:
Accounting
NUMERO Features
Processes
Reports
Controls
Workflows
using the current screen/context.

Recorded note: (none)

### 892 NUMI PROACTIVE ASSISTANCE

Phase 1 · module NUMI · recorded status: PLANNED

NUMI should not require a question every time.
It can surface relevant information:
"12 invoices are overdue."
"3 subscriptions renew this week."
"Bank reconciliation has 8 differences."
"One insurance policy expires in 14 days."
"Two high-attention Sentinel cases require review."
Avoid notification spam.

Recorded note: (none)

### 894 NUMI PRIORITY ENGINE

Phase 1 · module NUMI · recorded status: PLANNED

Prioritize using transparent criteria:
Amount
Due Date
Materiality
Risk
Compliance Deadline
Cash Impact
Customer Impact
Control Exception
Approval Requirement

Recorded note: (none)

### 905 MEMORY SCOPES

Phase 1 · module Sentinel · recorded status: PLANNED

Memory must be scoped.
Possible:
USER MEMORY
TEAM MEMORY
COMPANY MEMORY
GROUP MEMORY
MODULE MEMORY
CASE MEMORY
No cross-company leakage.

Recorded note: (none)

### 919 NUMI ACTION SECURITY

Phase 1 · module NUMI · recorded status: PLANNED

Before consequential action, show:
ACTION
IMPACT
COMPANY
AMOUNT
RECORDS AFFECTED
APPROVAL REQUIRED
Then require appropriate confirmation/approval.

Recorded note: (none)

### 924 NUMI TOOL AUTHORIZATION

Phase 1 · module NUMI · recorded status: PLANNED

Every AI tool/action requires explicit capability permission.
Example:
Read Ledger
Allowed.
Prepare Journal
Allowed.
Post Journal
Maybe not.
Release Payment
Not allowed without required human authorization.

Recorded note: (none)

### 927 NUMI BULK ACTIONS

Phase 1 · module NUMI · recorded status: PLANNED

Example:
"Prepare reminders for all invoices overdue 60+ days."
NUMI previews:
87 Customers
₹X Outstanding
Then authorized user approves execution.

Recorded note: (none)

### 928 NUMI COMMUNICATION ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

Prepare:
Payment Reminders
Collection Emails
Vendor Queries
Missing Document Requests
Internal Approval Requests
Audit Responses
Never send externally without configured authorization.

Recorded note: (none)

### 931 NUMI DECISION PACK

Phase 1 · module NUMI · recorded status: PLANNED

User:
"We are considering opening another office."
NUMI can prepare:
Current Office Costs
Comparable Cost Structure
Cash Position
Committed Obligations
Scenario Inputs
Break-even assumptions
Decision remains human.

Recorded note: (none)

### 932 NUMI VENDOR NEGOTIATION PACK

Phase 1 · module NUMI · recorded status: PLANNED

Before vendor negotiation:
Historical Spend
Price Changes
Volume
Alternative Approved Vendors where data exists
Contract Expiry
Payment History
Open Issues

Recorded note: (none)

### 937 NUMI "FIND"

Phase 1 · module NUMI · recorded status: PLANNED

Find:
Transaction
Invoice
Payment
Vendor
Employee
Contract
Asset
Property
Project
Document
Case

Recorded note: (none)

### 938 NUMI "CALCULATE"

Phase 1 · module NUMI · recorded status: IMPLEMENTED

Calculate authorized financial analysis.
Examples:
P&L
Margins
Ratios
Run Rate
Burn Rate
Runway
Break-Even
Working Capital
Cash Conversion Cycle
Forecast
Variance
Interest
Depreciation

Recorded note: (none)

### 941 NUMI "DO"

Phase 1 · module NUMI · recorded status: PLANNED

If permitted:
Save Draft
Create Task
Create Reminder
Route Approval
Generate Report
Match Transactions
Send Authorized Notification
Update Allowed Configuration
Always audit.

Recorded note: (none)

### 942 NUMI VOICE

Phase 1 · module NUMI · recorded status: IMPLEMENTED

Optional voice interaction.
Example:
"Numi, how much did we spend yesterday?"
"Numi, open Jamin Bazaar P&L."
"Numi, show payments above ₹10 lakh."
Sensitive actions require authentication/confirmation.

Recorded note: (none)

### 945 NUMI PERSONALITIES BY ROLE

Phase 1 · module NUMI · recorded status: PLANNED

Not cosmetic personalities.
Functional modes:
OWNER NUMI
CFO NUMI
ACCOUNTANT NUMI
AUDITOR NUMI
DEPARTMENT NUMI
EMPLOYEE NUMI
Each gets appropriate capabilities.

Recorded note: (none)

### 947 CFO NUMI

Phase 1 · module NUMI · recorded status: PLANNED

Advanced:
Forecast
Treasury
Working Capital
Debt
Consolidation
Scenario
Capital Allocation Analysis

Recorded note: (none)

### 950 NUMI AGENT ARCHITECTURE

Phase 1 · module NUMI · recorded status: PLANNED

Under one NUMI interface, create specialized internal AI agents.
Possible agents:
Accounting Agent
Reconciliation Agent
Document Agent
Forecast Agent
Treasury Agent
Collections Agent
Procurement Agent
Payroll Agent
Tax Support Agent
Audit Agent
Sentinel Agent
Contract Agent
Data Quality Agent
Reporting Agent
Workflow Agent
Knowledge Agent

Recorded note: (none)

### 951 NUMI ORCHESTRATOR

Phase 1 · module NUMI · recorded status: PLANNED

User should not need to select agent.
NUMI determines which specialist capabilities are required.
Example:
"Why is cash low?"
NUMI may consult:
Cash
Receivables
Payables
Payroll
Tax
Debt
Forecast
and synthesize evidence.

Recorded note: (none)

### 954 NUMI MODEL GOVERNANCE

Phase 1 · module NUMI · recorded status: PLANNED

Record:
AI Capability Version
Rules Version
Prompt/Policy Version where applicable
Output
User Decision
This is important for financial auditability.

Recorded note: (none)

### 955 NUMI EVALUATION SYSTEM

Phase 1 · module NUMI · recorded status: PLANNED

Continuously test:
Classification Accuracy
Extraction Accuracy
Reconciliation Match Quality
Forecast Accuracy
False Positive Rate
User Corrections
Permission Safety

Recorded note: (none)

### 957 NUMI HUMAN OVERRIDE

Phase 1 · module NUMI · recorded status: PLANNED

Authorized human decisions take precedence over AI suggestions.
Record disagreement for learning/evaluation.

Recorded note: (none)

### 960 NUMI AUTONOMY BOUNDARY

Phase 1 · module NUMI · recorded status: PLANNED

NUMI may become highly autonomous for:
Reading
Organizing
Calculating
Matching
Preparing
Monitoring
Explaining
Drafting
Routine authorized processing
But deliberately conservative for:
Money Movement
Material Journals
Write-Offs
Tax Positions
Legal Conclusions
Fraud Conclusions
Asset Valuation
Investment Decisions
Sensitive Personnel Actions

Recorded note: (none)

### 962 NUMI "ARE YOU SURE?"

Phase 1 · module NUMI · recorded status: PLANNED

For high-impact actions:
NUMI must present consequences before confirmation.

Recorded note: (none)

### 964 NUMI SYSTEM ASSISTANT

Phase 1 · module NUMI · recorded status: PLANNED

NUMI also helps operate NUMERO itself.
Examples:
"Create a new company."
"Add a department."
"Give CFO access to this report."
"Create approval workflow."
"Add expense category."
All subject to Super Admin permissions.

Recorded note: (none)

### 965 NUMI CONFIGURATION ADVISOR

Phase 1 · module NUMI · recorded status: PLANNED

When setting up new company:
NUMI asks relevant questions.
Industry?
Country?
Currency?
Tax?
Inventory?
Payroll?
Projects?
Branches?
Then proposes configuration.

Recorded note: (none)

### 967 NUMI SEARCHES THE ENTIRE AUTHORIZED NUMERO UNIVERSE

Phase 1 · module NUMI · recorded status: PLANNED

One search can traverse:
Transactions
Accounts
People
Parties
Companies
Documents
Contracts
Projects
Properties
Assets
Inventory
Payments
Receipts
Audit
Sentinel
Forward

Recorded note: (none)

### 971 NUMI WATCHLISTS

Phase 1 · module NUMI · recorded status: PLANNED

Possible watchlists:
Large Payments
New Vendors
High Expenses
Overdue Customers
Cash Threshold
Budget Overrun
Project Margin
Subscription Renewal
Insurance Expiry
Sentinel Cases

Recorded note: (none)

### 984 NUMI SUPER ADMIN MODE

Phase 1 · module NUMI · recorded status: PLANNED

For Group Super Admin only:
NUMI PRIME
Subject to Black Vault permissions.
Can analyze the entire authorized group.
Companies
Cash
People
Departments
Projects
Investments
Debt
Contracts
Commitments
Sentinel
Forward
Audit
Black Vault

Recorded note: (none)

### 990 NUMI COMMAND EXAMPLES

Phase 1 · module NUMI · recorded status: PLANNED

The user should eventually be able to say:
"Calculate this week's P&L."
"Explain why profit fell."
"Where can we save?"
"Where might we make more?"
"Show possible fraud/control exceptions."
"Who owes us?"
"Who do we owe?"
"What's due tomorrow?"
"What's coming next month?"
"Prepare payroll."
"Reconcile the bank."
"Find missing receipts."
"Prepare month-end."
"Prepare audit."
"Show all debt."
"Show our investments."
"Find unused subscriptions."
"Show unbilled revenue."
"Find unusual payments."
"Explain this contract."
"Prepare next year's budget."
"Forecast cash."
"Show me what doesn't reconcile."
"Show me what I should worry about."
"What am I missing?"
"I'm stuck."
"Fix what you safely can."

Recorded note: (none)

### 997 NUMI + NUMERO

Phase 1 · module NUMI · recorded status: PLANNED

NUMERO is the financial system of record.
NUMI is the intelligence operating across it.
NUMERO remembers what happened.
NUMI helps explain why.
NUMERO records what exists.
NUMI finds what matters.
NUMERO FORWARD sees what is coming.
NUMI explains its implications.
NUMERO SENTINEL finds anomalies.
NUMI helps investigate them.
NUMERO stores evidence.
NUMI connects it.
NUMERO enforces authority.
NUMI works within it.
GHL NUMERO + NUMI
NUMERO KNOWS EVERY NUMBER.
NUMI HELPS YOU UNDERSTAND WHAT TO DO WITH THEM.
ASK IT.
SHOW IT.
GIVE IT A DOCUMENT.
TELL IT WHAT YOU NEED.
OR JUST PRESS:
I'M STUCK.
NUMI
ASK. UNDERSTAND. SUGGEST. PREPARE. PROCESS. VERIFY. LEARN. ACT WITHIN AUTHORITY.

Recorded note: (none)

### 998 NUMI KNOWS THE BUSINESS

Phase 1 · module NUMI · recorded status: PLANNED

NUMI should progressively understand the authorized structure of the entire organization.
Companies
Businesses
Brands
Offices
Departments
Employees
Directors
Shareholders
Investors
Customers
Vendors
Agents
Brokers
Projects
Properties
Assets
Banks
Loans
Contracts
Products
Services
Revenue Models
Cost Structures
Accounting Policies
Budgets
Targets
Risks
Commitments

Recorded note: (none)

### 1010 NUMI THINK WITH ME

Phase 1 · module NUMI · recorded status: PLANNED

Create mode:
THINK WITH ME
The user may say:
"I'm thinking about opening another office."
NUMI does not immediately recommend yes/no.
It helps structure the question.
Possible considerations:
Current Office Utilization
Expected Rent
Deposit
Staff
Utilities
Furniture
Equipment
Travel Savings
Expected Revenue
Cash
Commitments
Break-Even
Risks
Then builds scenarios.

Recorded note: (none)

### 1011 NUMI CHALLENGE MY THINKING

Phase 1 · module NUMI · recorded status: PLANNED

Optional mode:
CHALLENGE THIS
User:
"I want to buy a ₹10 crore building."
NUMI respectfully examines:
Cash
Debt
Opportunity Cost
Rent Alternative
Future Obligations
Liquidity
Forecast
Scenario Outcomes
NUMI provides evidence and trade-offs.
Human decides.

Recorded note: (none)

### 1014 NUMI PRE-MORTEM

Phase 1 · module NUMI · recorded status: PLANNED

Before major decision:
"Assume this project failed. What are plausible financial reasons?"
NUMI explores scenario risks such as:
Cost Overrun
Collection Delay
Revenue Shortfall
Working Capital
Debt
Supplier Dependency
Schedule Delay
FX
Regulatory Costs
based on available context.

Recorded note: (none)

### 1016 NUMI LESSONS LEARNED

Phase 1 · module NUMI · recorded status: PLANNED

Record approved lessons.
Example:
"Future construction contracts should include stronger milestone controls."
NUMI may suggest this lesson when a similar authorized workflow is created later.

Recorded note: (none)

### 1022 IDEA-TO-BUSINESS-CASE

Phase 1 · module NUMI · recorded status: PLANNED

User:
"Could we centralize procurement?"
NUMI can prepare business case using actual group data.

Recorded note: (none)

### 1024 NUMI RISK MEMORY

Phase 1 · module NUMI · recorded status: PLANNED

Same for risks.
Risk
Potential Impact
Evidence
Mitigation
Owner
Deadline
Status

Recorded note: (none)

### 1025 NUMI OPEN LOOPS

Phase 1 · module NUMI · recorded status: PLANNED

Create:
OPEN LOOPS
NUMI remembers unresolved matters.
Examples:
Payment Awaiting Approval
Customer Promise
Audit Query
Missing Invoice
Insurance Claim
Refund
Vendor Dispute
Contract Renewal
Unresolved Sentinel Case

Recorded note: (none)

### 1026 "WHAT HAVE WE FORGOTTEN?"

Phase 1 · module NUMI · recorded status: PLANNED

Owner asks:
"WHAT HAVE WE FORGOTTEN?"
NUMI searches open loops.
This should become one of NUMI's strongest capabilities.

Recorded note: (none)

### 1029 NUMI DEADLINE MEMORY

Phase 1 · module NUMI · recorded status: PLANNED

Track:
Payment
Collection
Contract
Tax
Audit
Project
Insurance
Renewal
Loan
Guarantee
Employee Claim

Recorded note: (none)

### 1035 NUMI MEETING MEMORY

Phase 1 · module NUMI · recorded status: PLANNED

For meetings documented through authorized systems:
Capture:
Decisions
Actions
Financial Commitments
Owners
Deadlines
Do not silently record private meetings without consent/configuration.

Recorded note: (none)

### 1039 NUMI EVENING WRAP

Phase 1 · module NUMI · recorded status: PLANNED

Optional:
BEFORE YOU LEAVE
Today:
Money In
Money Out
Approvals
Collections
Major Events
Unresolved Items
Tomorrow:
Payments
Collections
Deadlines
Meetings
Risks

Recorded note: (none)

### 1042 NUMI QUARTERLY STRATEGIC REVIEW

Phase 1 · module NUMI · recorded status: PLANNED

Combine:
Financials
Forecast
Projects
Customers
Vendors
Capital
Debt
Investments
Risks
Opportunities
Goals

Recorded note: (none)

