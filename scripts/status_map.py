"""
Maintains docs/requirement-status.json — the ONLY source of implementation status.

Rules (spec 1512-1515, 1551):
  TESTED       engine + screen exist AND an automated test covers the requirement
  IMPLEMENTED  engine + screen exist and the workflow was exercised end to end
  PARTIAL      some of the requirement works; the note says exactly what does not
  BLOCKED      cannot proceed without something only the owner can provide
  (absent)     PLANNED — not built. Nothing is dropped.

Run:  python scripts/status_map.py && python scripts/build_requirement_ledger.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = "tests/sql/engine_invariants.sql"
DB2 = "tests/sql/document_posting.sql"
APP = "tests/engine.test.ts"
CMD = "tests/commands.test.ts"

S = {}


def put(status, no, evidence, notes=""):
    S[str(no)] = {"status": status, "evidence": evidence, "notes": notes, "phase": 1}


T = lambda no, ev, n="": put("TESTED", no, ev, n)
I = lambda no, ev, n="": put("IMPLEMENTED", no, ev, n)
P = lambda no, ev, n="Partly built: only what the named screen or function shows. The rest of this requirement is not built yet.": put("PARTIAL", no, ev, n)
B = lambda no, ev, n: put("BLOCKED", no, ev, n)

# ----------------------------------------------------------------- PROMPT I
I(1, "org_unit_types, org_units, RLS · Genesis › Structure", "Hierarchy levels are data; new levels need no code.")
P(2, "Companies, Team, PeriodClose, Genesis", "Built: create/archive/clone companies, units, access grants, period lock/reopen, approve/reject, consolidated view, drill-down. Not built: custom-role editor, impersonation, integration/AI/export controls.")
I(3, "src/pages/Companies.tsx wizard · create_company", "Recommendation is labelled; nothing is created before confirmation.")
P(4, "custom_field_defs · Genesis › Custom fields", "27 field types can be defined and versioned. Not built: rendering in transaction forms, drag-and-drop form builder, conditional rules.")
P(6, f"{DB} · {APP}", "Built and tested: double entry, journals, contra, receipts, payments, purchases, sales, notes, cash/bank book, day book, TB, P&L, BS, cash flow, control accounts, advances, loans, intercompany, suspense. Not built: fund flow, automated depreciation/accrual/prepayment schedules.")
T(7, f"{APP} › learned preferences · src/engine/templates.ts")
I(8, "src/pages/Entry.tsx", "19 transaction types plus free-text entry.")
P(9, "src/pages/Banking.tsx · import_bank_transactions, suggest_bank_matches", "Built: CSV import with validation preview, matching on amount/date/reference, six statuses. Not built: bank feed APIs, Excel import, party/historical-pattern matching.")
P(10, "cash ledgers, cash book report", "Not built: physical cash count, daily cash reconciliation, employee advance register.")
P(11, "Documents, DocumentEditor, Owed, ReportView › Ageing", "Built: customer master, invoices, partial payments, credit terms, ageing, overdue. Not built: recurring invoices, payment schedules, reminders, promise-to-pay.")
P(12, "Documents, DocumentEditor, Payments", "Built: bills, terms, partial payments, advances, duplicate-bill detection. Not built: purchase orders, goods receipt, three-way match, price-change detection.")
P(13, "src/pages/Entry.tsx", "Built: guided expense entry with approval. Not built: employee submission, receipt photo, OCR, email ingestion.")
P(15, "Documents, DocumentEditor", "Built: invoice → receipt, credit notes. Not built: quotation, proforma, sales order, recurring/milestone billing.")
P(16, "tax_codes, tax_code_components · Genesis › Tax codes · ReportView › Registers", "Built: CGST/SGST/IGST codes with effective dates, HSN/SAC, sales and purchase registers. Not built: TDS/TCS, reverse charge, ITC reconciliation, return workflows.")
P(17, f"{APP} · approve_payment", "Built: transaction currency, rate, base value, exchange difference on settlement. Not built: period-end revaluation, rate providers.")
P(18, "intercompany ledgers · ReportView › Consolidation", "Built: due-to/due-from ledgers, mismatch detection, balance elimination. Not built: automatic mirror entry in the other company, shared-cost allocation.")
P(19, "ReportView › Consolidation", "Not built: ownership %, non-controlling interests, currency translation, elimination of intercompany income/expense.")
P(20, "src/pages/Budgets.tsx", "Built: budget by company, account and month; variance; versions. Not built: rolling forecast, budgets by branch/project in the editor.")
P(21, "src/pages/Forward.tsx", "Built: expected receipts and payments from recorded documents over six horizons. Not built: payroll, EMI, tax, contract and statistical forecasts.")
I(35, "src/numi/engine.ts · verified in browser", "All 14 example questions are answered from recorded data. Deterministic engine; no external model.")
P(36, "src/engine/nlp.ts · Sentinel", "Built: classification, ledger and journal suggestions, duplicate and anomaly detection, variance explanation. Not built: invoice/receipt extraction, forecasting, missing-document detection.")
T(37, f"{APP} · Genesis › Learned rules")
T(38, f"{APP} › language understanding")
I(39, f"src/voice · {CMD}", "Command interpretation is tested. Microphone capture could not be exercised in the build environment: verify in Chrome or Edge.")
P(40, "run_sentinel · src/pages/Sentinel.tsx", "8 rules, run on demand. Not built: continuous evaluation, expense-spike, revenue-decline and unusual-vendor rules.")
P(41, f"{DB} T03 T22 T10", "Built: maker-checker, bank-change verification, backdating alert, immutable history, audit export. Not built: multi-approval rules for payments.")
P(42, "approval_rules · Approvals", "Built: multi-step rules by company and amount. Not built: visual builder; rules on account, department, vendor, risk score.")
P(43, f"{DB} T11-T13", "Built: group, company and module level. Not built: branch, department, account and field level.")
P(44, "auditor role", "Read-only access exists. Not built: sampling tools, query mechanism.")
T(45, f"{DB} T10d", "Device and session metadata are not recorded.")
I(46, "src/pages/Home.tsx")
I(47, "src/pages/MoneyMap.tsx")
P(49, "src/pages/Forward.tsx", "Shows invoice and bill due dates only.")
P(51, "src/pages/ReportView.tsx", "17 of 23 listed reports. Not built: asset register, inventory valuation, project profitability, cost-centre report, tax returns, fund flow.")
I(53, "ReportView › Financial Health", "Company-specific metric definitions are not built.")
T(55, f"{DB} T14 · src/pages/PeriodClose.tsx")
P(56, "suspense ledger · PeriodClose checklist", "No dedicated suspense dashboard yet.")
P(57, "src/pages/Owed.tsx · Party360", "Documents and advances per party. Deposits register not built.")
P(58, "Banking › Import", "Bank statement CSV only.")
I(62, "src/ui/CommandPalette.tsx")
T(63, CMD)
P(65, "Row Level Security, roles, numero_private schema", "Not configured: MFA, passkeys, IP restriction, rate limiting, backup testing.")
T(66, f"{DB} T03 T19a · {DB2} T25")
T(67, f"{DB} T10 T15 · {APP}")
I(68, "supabase/migrations")
T(69, f"{DB} T16d T17b")
I(70, "Explain this · JournalDetail › why engine")
P(72, "JournalEditor validation · PeriodClose", "No data-quality dashboard yet.")
I(73, "ledgerLink drill-down on every report line")
I(74, "src/styles/index.css · src/ui")
I(75, "src/pages/Cockpit.tsx")
P(76, "DataTable dense mode, shortcuts, filters", "Not built: bulk actions, saved views, split-screen documents, spreadsheet-style entry.")
I(77, "privacy mode · verified in browser: 56 of 56 figures masked")
P(78, "currency and number formats, voice languages", "Interface text is English only.")
T(80, f"{DB} T11c T11d T19b")
I(81, "Entry › suggestion reasons")
T(82, f"{CMD} › sensitive commands")
T(83, f"{APP} › templates", "12 templates.")
P(86, "src/numi/engine.ts", "Decision support from recorded figures only.")
I(87, "Shell › Ask NUMI · contextualPrompts")
T(88, f"{DB} T21 · {APP}")
I(90, "Truth chip on every figure class")
I(91, "decimal.js, numeric(20,4), FOR UPDATE, idempotency keys")
P(92, "docs/NUMERO_TEST_MATRIX.md", "Not covered: depreciation, currency translation.")
I(93, "src/pages/Home.tsx")

# ----------------------------------------------------------------- PROMPT II
I(95, "party_types · Parties", "27 system types; custom types without code.")
I(96, "party_roles")
T(97, f"{DB} T16a")
P(98, "src/pages/Party360.tsx", "Not built: contracts, projects, tasks, communication.")
P(106, "Parties", "Not built: contracts, pricing, certifications per vendor.")
P(107, "Party360", "Not built: open POs, disputes, price history.")
T(109, f"{DB} T22 T23 · {APP}")
P(120, "Party360", "Not built: orders, projects, contracts.")
P(126, "src/pages/MoneyMap.tsx", "Group-wide flows. Selecting a single party as the centre is not built.")
P(127, "src/pages/Owed.tsx", "Built from supplier bills. Employees, government and refunds are not included.")
P(128, "src/pages/Owed.tsx", "Built from customer invoices.")
P(129, "advance ledgers · Payments", "No advances command centre yet.")
T(138, f"{DB} T16b · {APP}")
P(139, "Sentinel duplicate invoice", "Shared bank account and shared tax identifier checks not built.")
I(156, "Genesis › Party types")
P(158, "custom_field_defs scope_key", "Definitions only.")
I(162, "journal_line_dims + party on every line · migration 0005")
I(163, "JournalDetail › why engine")
I(164, "Party360 tiles", "Each figure kept separate.")
P(165, "Forward › concentration", "Receivables and payables only.")
T(166, APP)
T(167, APP, "One block covers all new documents and payments; per-activity blocks not built.")
I(169, "src/pages/Parties.tsx")
P(171, "JournalDetail › responsibility chain", "Created, submitted, approved, posted. Requested-by and received-by not recorded.")
I(172, "parties RLS through party_roles")
P(175, "Party360 note", "Both balances shown separately. Netting workflow not built.")
I(176, "Party360 › Download statement", "CSV.")
T(178, f"{APP} › which Rajesh")
I(179, "CommandPalette")

# ----------------------------------------------------------------- PROMPT III / IV
P(240, "Entry › Deposit paid", "No deposit register.")
P(258, "multi-line journals with tags", "No percentage-split helper.")
I(272, "ReportView › money-went")
I(273, "ReportView › money-came")
P(274, "src/pages/Entry.tsx", "No receipt upload.")
P(275, "JournalDetail")
P(288, "Accounts", "Accounting mapping per category not built.")
I(325, "src/pages/Vault.tsx")
P(326, "vault_grants", "Grants table and enforcement exist. No screen to issue grants yet.")
I(327, "five confidentiality levels")
P(329, "vault_access_log", "Logged in the live database. The demo engine does not log access.")
T(330, f"{DB} T19b · {APP}")
T(331, f"{DB} T19b · {APP}")
P(333, "org_units.confidentiality")
P(347, "Budgets", "By account. Department budgets need the dimension editor.")
P(348, "Budgets › overrun alerts", "Actual only; committed spending not tracked.")
P(349, "budgets.limit_mode", "Stored and shown. Hard limits are not enforced on posting.")
P(350, "Vault")
T(352, f"{DB} T19b")
T(353, f"{DB} T11 T19")
P(356, "memberships valid_from / valid_to")
T(358, f"{DB} T19b")
T(359, f"{DB} T10")
I(360, "architecture")
P(362, "Entry › I don't know what this is", "Parks the item in suspense. AI suggestions for it not built.")
I(366, "Home › Cost DNA")

# ----------------------------------------------------------------- PROMPT V
T(369, f"{DB} · {APP}")
I(370, "src/pages/Accounts.tsx")
T(371, APP)
I(372, "src/pages/Ledger.tsx")
P(373, f"{APP}", "Party subledger only.")
I(374, "21 voucher types")
I(375, "voucher_types, voucher_sequences")
T(376, f"{DB} T18 · {APP}")
T(377, f"{DB} T07")
I(378, "ReportView › P&L")
P(379, "ReportView › P&L", "Previous period only. Budget and forecast comparison not built.")
I(380, "Statement drill-down")
I(381, "ReportView › Balance Sheet")
T(382, APP)
I(383, "Statement drill-down")
T(384, APP, "Indirect method.")
P(385, "ReportView › Cash book")
P(388, "reports.ts", "Presented correctly. Closing entries are manual.")
P(389, "Banking", "Bank only.")
I(390, "src/pages/Banking.tsx")
T(391, APP)
I(392, "Banking header", "Always displayed.")
T(393, APP)
P(396, APP, "Tested. No screen yet.")
P(397, "src/pages/PeriodClose.tsx", "12 computed checks of 17 listed.")
I(398, "PeriodClose gauge")
T(399, f"{DB} T14")
I(401, "PROVISIONAL label")
I(402, "FINAL label")
I(407, "src/pages/Audit.tsx")
I(412, "Team › Segregation of duties")
P(413, "Sentinel", "Year-end rule not built.")
P(420, "Forward › shortfall warning", "From recorded documents only.")
P(422, "Forward")
I(431, "ReportView › ratios")
I(432, "ReportView › ratios", "Formula and inputs always shown.")
I(436, "Home › Simple")
I(437, "NUMI balance sheet")
P(438, "NUMI compare")
P(439, "NUMI budget")
P(441, "Budgets")
I(442, "Budgets › start from zero")
I(443, "guard_budget · Budgets")
P(444, "Budgets", "Committed and forecast columns not built.")
P(445, "budgets.kind")
P(457, "approve_payment", "Settlement difference only.")
P(460, "ReportView › Ageing", "Buckets are fixed.")
P(466, "ReportView › Consolidation")
P(467, "reports.ts intercompanyEliminations", "Balances only.")
I(477, "common-size toggle")
P(480, "ratios › runway", "Run-rate based.")
P(491, "DataTable CSV · print", "Excel and PDF files not built.")
I(497, "ReportView › ratios")
P(498, "NUMI")
I(501, "Explain component")
P(502, "Home", "Home screen only.")
P(503, "Home, Cockpit, NUMI integrity")
I(504, "Home, Cockpit")
P(505, "time machine", "Comparing two dates side by side not built.")
I(510, "answer structure")
I(511, "no posting path without human approval")
P(512, "drill-down", "Bank-event link exists only through reconciliation.")

# ----------------------------------------------------------------- PROMPT VI
T(540, f"{DB} T22 · {APP}")
I(542, "no code path")
I(589, "memberships validity")
P(595, "privacy mode, masked account numbers")
I(609, "CommandPalette")
P(624, "Forward")
P(625, "Forward")
I(627, "CommandPalette")
I(632, "journals.origin")
P(633, "tax codes, budgets, custom fields")
T(653, APP)
T(654, APP)
T(655, DB)
I(656, "Truth chips")
T(657, DB)
T(658, CMD)
I(659, "engine first")

# ----------------------------------------------------------------- PROMPT VII
P(664, "src/pages/Forward.tsx")
I(703, "Forward › waterfall")
I(708, "Forward › shortfall warning", "From recorded documents.")
P(716, "Forward")
P(717, "Forward")
P(721, "Forward")
P(724, "Sentinel")
T(726, APP)
T(727, APP)
T(730, f"{DB} T20 · {APP}")
T(731, APP)
I(732, "run_sentinel")
T(733, APP)
T(734, f"{DB} T23 · {APP}")
I(750, "run_sentinel")
T(751, f"{DB} T14a")
T(770, f"{DB} T03")
I(774, "run_sentinel")
I(777, "alerts.attention")
P(778, "review statuses", "No investigation workspace.")
I(795, "alerts never block posting")
I(801, "Sentinel drawer")
P(803, "Genesis › Controls", "Thresholds only.")
I(805, "false_positive status")
T(821, APP)

# ----------------------------------------------------------------- PROMPT VIII / IX
I(829, "CommandPalette")
P(830, "src/numi/engine.ts", "16 intents.")
T(831, APP)
I(835, "NUMI")
I(836, "NUMI")
T(855, f"{DB} T20 · {APP}")
I(903, "numi_learn")
I(907, "Genesis › Learned rules")
I(913, "evidence links")
T(915, APP)
T(916, f"{DB} T11")
T(917, f"{DB} T19")
I(920, "Entry › proposed double entry")
I(921, "no code path")
P(923, CMD, "No document ingestion exists yet, so nothing is read from documents.")
I(938, "NUMI calculate")
I(942, "VoiceOrb")
P(944, "voice languages", "Recognition language can be chosen; commands are understood in English.")
I(956, "honest fallback")
I(958, "architecture")
I(959, "architecture")
I(991, "NumiAnswer")
I(992, "Shell")
I(1081, "basis chip")
I(1134, "no write path")
I(1163, "assumptions")
I(1164, "scope line")
I(1165, "deterministic engine")

# ----------------------------------------------------------------- PROMPT X / XI
I(1191, "Home, Cockpit")
I(1192, "drill-down")
I(1194, "Truth chips")
P(1267, "Team › Segregation of duties", "Role-level detection.")
T(1276, DB)
P(1290, "Approvals", "Journals only.")
P(1291, "Sentinel")
T(1304, DB)
I(1305, "Companies")
I(1306, "architecture")
I(1307, "templates")
I(1308, "Companies wizard")
P(1309, "recommendTemplate", "Keyword recommendation.")
I(1310, "templates")
I(1311, "custom template")
P(1312, "Companies › Clone", "Chart and units. Account map and tax codes come from the standard set.")
I(1313, "per-company chart, tax, units")
I(1316, "Shell › CompanySwitcher")
I(1317, "CommandPalette")
T(1318, f"{DB} T11")
T(1319, f"{DB} T11")
I(1320, "profiles.is_group_super_admin")
I(1322, "group_cfo role")
P(1330, "intercompany ledgers")
I(1331, "intercompany ledgers")
T(1332, APP)
T(1333, APP)
P(1336, "balances only")
P(1337, "ReportView › Consolidation")
I(1342, "Consolidation › P&L")
I(1343, "Consolidation › Balance sheet")
P(1344, "Cash flow for all companies", "No eliminations.")
I(1345, "Trial balance for all companies")
I(1346, "Home cards, consolidation columns")
I(1360, "Companies › Archive")
T(1375, f"{DB} T15")
T(1435, f"{DB} T10d")
T(1436, f"{DB} T06 T16e")
I(1440, "CommandPalette")

# ----------------------------------------------------------------- PROMPT XII
I(1498, "migrations are additive")
I(1500, "scripts/build_requirement_ledger.py")
I(1501, "scripts/status_map.py")
P(1502, "docs/NUMERO_TEST_MATRIX.md", "Requirement → test. Code and screen references are in the evidence column.")
I(1507, "docs/")
I(1508, "docs/NUMERO_SPEC_INDEX.md")
I(1512, "docs/NUMERO_IMPLEMENTATION_STATUS.md")
I(1516, "DEMO banner, DEMO truth chip, -DEMO export suffix")
P(1517, "tests/")
T(1519, DB)
P(1520, DB, "Owner, accountant, outsider, anonymous. Auditor and restricted user not yet.")
T(1521, f"{DB} · {APP}")
T(1522, DB)
P(1523, CMD)
I(1524, "engine refusals are shown verbatim")
I(1530, "build order")
I(1532, "Shell mode switch")
P(1534, "labels, keyboard, focus rings, reduced motion", "Not audited against WCAG.")
I(1536, "DataTable")
I(1537, "DataTable export")
I(1539, "docs/NUMERO_IMPLEMENTATION_STATUS.md")
I(1544, "only the publishable key is in the client")
P(1547, "scripts/", "Ledger generation only. No automatic code comparison.")

# ----------------------------------------------------------------- PROMPT XIII / XIV
I(1559, "Entry › Advance · Payments")
I(1570, "Entry › Transfer")
P(1576, "suspense ledger")
I(1579, "no such category exists")
P(1600, "src/voice")
T(1602, CMD)
I(1605, "voice navigation to reports")
I(1606, "voice → NUMI")
I(1607, "voice → NUMI calculate")
P(1608, "VOICE_LANGUAGES")
B(1609, "src/voice/gateway.ts SarvamProvider", "Needs a Sarvam API key, stored as a server-side secret behind an authenticated function.")
I(1610, "src/voice/gateway.ts")
I(1611, "resolveProvider")
P(1612, "voice_audit", "Retention policy and consent prompts not built.")
T(1613, CMD)
I(1614, "no voice-only action exists")
I(1615, "voice_audit")
P(1616, "Reports")
P(1620, "ReportView")
I(1629, "Statement")
I(1635, "src/pages/Calculators.tsx")
I(1636, "Calculators")
I(1637, "Calculators")
I(1638, "Calculators")
I(1640, "Calculators")
I(1641, "Calculators")
I(1644, "Calculators")
P(1645, "NUMI calculate", "Percentage / tax only.")
I(1646, "formula and inputs shown")
P(1647, "CSV, print")
I(1716, "CommandPalette")
P(1718, "contextualPrompts")
I(1726, "engine is language independent")
I(1727, "interpreter")
I(1728, "draft shows the amount for confirmation")
I(1738, "Genesis › Structure")
P(1739, "Genesis", "Name, code, parent, confidentiality. Budget and rule steps not in the wizard.")
I(1740, "org_units.parent_id")
P(1753, "custom_field_defs")
P(1754, "27 field types")
P(1830, "version columns")
T(1878, DB)
T(1879, DB)
T(1880, DB)
T(1881, DB)
T(1882, DB)
T(1883, DB)

# ----------------------------------------------------------------- PHASE 2
# Assessed requirement by requirement against the code; each part is checked by scripts/check_status_part.py.
# A requirement listed under PLANNED in a part has no status here: it is not built, and it stays in the ledger.
import importlib.util


def _part(name):
    f = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(name[:-3], f)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# Phase 1 requirements whose status or note changed because of what phase 2 built
_p1 = _part("status_phase1_updates.py")
for status, no, evidence, notes in _p1.UPDATES:
    assert str(no) in S, f"{no} has no phase 1 record to update"
    S[str(no)] = {"status": status, "evidence": evidence, "notes": notes, "phase": 1}
# a phase 1 claim that no longer holds is withdrawn: the requirement is PLANNED again, and stays in the ledger
for no in getattr(_p1, "REVERT_TO_PLANNED", []):
    S.pop(str(no), None)

PLANNED_NOTES = {}
for part in ("status_phase2_a.py", "status_phase2_b.py", "status_phase2_c.py"):
    m = _part(part)
    for status, no, evidence, notes in m.ENTRIES:
        assert str(no) not in S, f"{no} is recorded twice"
        S[str(no)] = {"status": status, "evidence": evidence, "notes": notes, "phase": 2}
    PLANNED_NOTES.update({str(k): v for k, v in m.PLANNED.items()})

# ----------------------------------------------------------------- PHASE 3
# Assessed the same way, in three parts, after the screens were built; re-read after the corrections listed in
# scripts/_assess/P3_CORRECTIONS.md.
for part in ("status_phase3_a.py", "status_phase3_b.py", "status_phase3_c.py"):
    m = _part(part)
    for status, no, evidence, notes in m.ENTRIES:
        assert str(no) not in S, f"{no} is recorded twice"
        S[str(no)] = {"status": status, "evidence": evidence, "notes": notes, "phase": 3}
    for k, v in m.PLANNED.items():
        assert str(k) not in S, f"{k} is recorded with a status and as planned"
        PLANNED_NOTES[str(k)] = v

# Requirements of phases 1 and 2 whose record changed because of what phase 3 built
# (scripts/_assess/STATUS_BRIEF_P3_UPDATES.md; each part is checked by scripts/check_status_updates.py)
_reqs = json.loads((ROOT / "docs" / "requirements.json").read_text(encoding="utf8"))
_phase = {int(r["no"]): r.get("phase") for r in (_reqs["requirements"] if isinstance(_reqs, dict) else _reqs)}
P3_UPDATED = []
for part in sorted((ROOT / "scripts").glob("status_phase3_updates_*.py")):
    m = _part(part.name)
    for status, no, evidence, notes in m.UPDATES:
        assert _phase[int(no)] in (1, 2), f"{no} is not a requirement of phase 1 or 2"
        assert int(no) not in P3_UPDATED, f"{no} is updated twice"
        S[str(no)] = {"status": status, "evidence": evidence, "notes": notes, "phase": _phase[int(no)]}
        PLANNED_NOTES.pop(str(no), None)
        P3_UPDATED.append(int(no))
(ROOT / "docs" / "requirement-updated-in-phase3.json").write_text(json.dumps(sorted(P3_UPDATED)), encoding="utf8")
(ROOT / "docs" / "requirement-planned-notes.json").write_text(json.dumps(dict(sorted(PLANNED_NOTES.items(), key=lambda kv: int(kv[0]))), indent=1, ensure_ascii=False), encoding="utf8")

out = ROOT / "docs" / "requirement-status.json"
out.write_text(json.dumps(dict(sorted(S.items(), key=lambda kv: int(kv[0]))), indent=1, ensure_ascii=False), encoding="utf8")
counts = {}
for v in S.values():
    counts[v["status"]] = counts.get(v["status"], 0) + 1
print(len(S), "requirements with recorded status:", counts)
