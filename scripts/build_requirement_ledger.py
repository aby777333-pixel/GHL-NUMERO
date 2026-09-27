"""
NUMERO REQUIREMENT LEDGER builder  (spec sections 1500-1508, 1547)

Reads the master prompt (.docx), preserves it verbatim as docs/NUMERO_MASTER_SPEC.md,
and indexes every numbered requirement into:

  docs/requirements.json          (served to the in-app Requirement Ledger by the DEV server only)
  docs/NUMERO_REQUIREMENTS.md     (human-readable ledger)
  docs/NUMERO_SPEC_INDEX.md       (section -> line index of the master spec)

Implementation status is NEVER inferred. It comes only from docs/requirement-status.json,
which is maintained by hand as evidence is produced. Anything not listed there is PLANNED.

Usage:  python scripts/build_requirement_ledger.py
"""
import html
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCX = ROOT / "GHL NUMERO PROMPT.docx"
STATUS_FILE = ROOT / "docs" / "requirement-status.json"

PROMPTS = [
    ("I", "Master Prompt — Core Financial Operating System"),
    ("II", "People, Parties, Offices, Vendors, Agents, Relationships"),
    ("III", "Expenses, Vehicles, Travel, Petty Cash, Everyday Money"),
    ("IV", "Operations, Exceptions, Incidents, Confidential Finance, Black Vault"),
    ("V", "Accounting Core, Reports, Audit, Forecasting, Close, CFO Intelligence"),
    ("VI", "Documents, Purchase-to-Pay, Order-to-Cash, Payroll, Treasury, Autopilot"),
    ("VII", "NUMERO Forward + NUMERO Sentinel"),
    ("VIII", "NUMI — Intelligence & Assistant"),
    ("IX", "NUMI Companion — Memory, Decisions, Proactive Intelligence"),
    ("X", "NUMERO Omega — Control Tower, Truth, People Cost, FP&A, Governance"),
    ("XI", "Multi-Company, Genesis Migration, Corrections, Reality Engine"),
    ("XII", "Claude Code Zero-Omission Directive"),
    ("XIII", "NUMERO Flow + NUMERO Reports + Voice"),
    ("XIV", "NUMERO Genesis Builder — Dynamic No-Code Configuration"),
]

# Ordered keyword rules -> module. First match wins (title is weighted first).
MODULE_RULES = [
    ("NUMI", r"\bnumi\b|numero ai|ask numero|ai cfo|copilot|ai financial|ai accounting|ai security|ai confidence|ai must|ai cannot"),
    ("Voice", r"\bvoice\b|sarvam|speech"),
    ("Sentinel", r"sentinel|anomal|fraud|duplicate|ghost vendor|collusion|watchtower|risk rule|suspicious|leakage"),
    ("Forward", r"forward|forecast|commitment|obligation|pipeline|early-warning|warning|horizon|money weather|future|renewal"),
    ("Black Vault", r"vault|confidential|sealed|restricted|secret|break-glass|private"),
    ("Reality", r"\breality\b|physical verification|confirmation engine"),
    ("Truth", r"truth|trust this number|provenance|lineage|zero-ambiguity|source of truth|traceab"),
    ("Digital Twin", r"digital twin|scenario|simulation|what if|stress test|sandbox"),
    ("Genesis Builder", r"dynamic|no-code|form builder|field engine|custom module|custom field|path\b|genesis builder|dropdown|menu builder|page builder|custom "),
    ("Multi-Company", r"multi-company|company creation|company wizard|company onboarding|company switcher|company clone|company template|template marketplace|unlimited company|add company|group super admin|company super admin|owner super admin|core architecture|hierarchy|company archive|acquisition"),
    ("Consolidation", r"consolidat|intercompany|inter-company|eliminat|due to / due from|group p&l|group balance|group cash|group trial|ownership"),
    ("Reconciliation", r"reconcil|matching|open item|suspense|unidentified"),
    ("Banking", r"\bbank|cheque|pdc|payment factory|payment batch|beneficiar|upi|autopay"),
    ("Treasury", r"treasury|liquidity|fixed deposit|loan|borrowing|emi|covenant|guarantee|letters of credit|forex|fx |interest|debt|credit facility|capital"),
    ("Tax", r"\bgst\b|\btds\b|\btcs\b|\btax\b|compliance calendar|regulatory|statutory|transfer-pricing"),
    ("Payroll", r"payroll|salary|bonus|full & final|employer cost|overtime|arrears|headcount"),
    ("People Cost", r"people cost|workforce|staff cost|cost per employee|employee cost|true employee"),
    ("Audit", r"audit|auditor|sign-off|internal control|segregation of duties|maker-checker|maker|evidence|legal hold|retention"),
    ("Approvals", r"approval|approve|workflow|delegation|escalation|four-eyes|quorum"),
    ("Security", r"security|permission|role-based|encryption|mfa|privileged|masking|api security|tenant|isolation|privacy|access"),
    ("Period Close", r"\bclose\b|period lock|year-end|month-end|soft close|hard close|closing"),
    ("Budgeting", r"budget|capex|zero-based|fp&a|driver-based|long-range|break-even|unit economics|kpi"),
    ("Reports", r"report|statement|trial balance|profit & loss|p&l|balance sheet|cash flow|fund flow|dashboard|board pack|export|calculator|ratio|ageing|comparison|heatmap|cost dna"),
    ("Accounts Receivable", r"receivable|customer|collection|invoice|billing|order-to-cash|promise-to-pay|credit control|sales|quotation|revenue"),
    ("Accounts Payable", r"payable|vendor|purchase|procure|requisition|rfq|goods receipt|three-way|bill\b|supplier"),
    ("Expenses", r"expense|travel|trip|fuel|vehicle|fleet|petty cash|reimbursement|per diem|allowance|hotel|food|meal|pantry|toll|parking|mileage|receipt|corporate card|credit card|subscription|software|utilities|electricity|rent|courier|stationery|event|gift|hospitality|entertainment|seminar|conference|meeting cost|outing|festival|advance|deposit|fine|insurance|cancellation|refund|no-show|wastage"),
    ("Parties", r"party|parties|broker|agent|contractor|freelancer|consultant|landlord|investor|counterparty|relationship|referral|commission|portal|contact"),
    ("Assets", r"asset|depreciation|impairment|revaluation|amc|warranty|equipment|maintenance"),
    ("Inventory", r"inventory|stock|warehouse|landed cost|manufacturing|import|export|batch|medicine|wellness|medical"),
    ("Projects", r"project|construction|boq|retention|real estate|property|site\b|lease|tenant"),
    ("Investments", r"aif|fund accounting|investment|nav|capital call|distribution|dividend"),
    ("Documents", r"document|inbox|intake|ocr|upload|scan|email-to-numero|correspondence"),
    ("Incidents & Exceptions", r"incident|accident|claim|damage|loss|theft|extortion|bribery|off-book|whistleblower|legal case|settlement|write-off|bad debt|dispute|recovery|exception|emergency|disaster|unplanned|unexpected"),
    ("Integrations", r"integration|api|webhook|import|migration|emailer|notification|connectivity|data warehouse"),
    ("Accounting", r"accounting|ledger|journal|voucher|chart of accounts|double-entry|debit|credit|accrual|prepaid|provision|posting|immutab|idempoten|reclassif|correction|restatement|policy"),
    ("Search & Command", r"search|command palette|command bar|reference number"),
    ("UI/UX", r"ui|ux|cockpit|mode|mobile|home screen|language|internationalization|accessib|responsive|theme"),
    ("System Health", r"backup|disaster recovery|health|observability|continuity|scale|feature flag|performance"),
    ("Engineering Governance", r"claude code|requirement|omission|additive|regression|test|migration|release|mvp|phase|refactor|schema|secrets|principle|directive|final"),
]

PHASE_BY_MODULE = {
    "Accounting": 1, "Multi-Company": 1, "Security": 1, "Audit": 1, "Approvals": 1, "Reports": 1,
    "Period Close": 1, "Parties": 1, "Accounts Receivable": 1, "Accounts Payable": 1, "Banking": 1,
    "Reconciliation": 1, "Consolidation": 1, "Tax": 1, "Budgeting": 1, "Black Vault": 1, "Sentinel": 1,
    "NUMI": 1, "Voice": 1, "UI/UX": 1, "Search & Command": 1, "Engineering Governance": 1, "Truth": 1,
    "Forward": 2, "Expenses": 2, "Documents": 2, "Genesis Builder": 2, "Treasury": 2, "Payroll": 2,
    "People Cost": 2, "Assets": 2, "Projects": 2, "Incidents & Exceptions": 2,
    "Inventory": 3, "Investments": 3, "Digital Twin": 3, "Reality": 3, "Integrations": 3, "System Health": 3,
}


def extract_paragraphs(docx: Path):
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf8")
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        # keep line breaks inside a paragraph as separators so list items stay distinct
        p = re.sub(r"<w:br[^>]*/>", "<w:t>\n</w:t>", p)
        t = "".join(html.unescape(m) for m in re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
        if t.strip():
            out.append(t.strip())
    return out


def classify(title: str, text: str) -> str:
    t = title.lower()
    for module, pat in MODULE_RULES:
        if re.search(pat, t):
            return module
    body = text.lower()[:600]
    for module, pat in MODULE_RULES:
        if re.search(pat, body):
            return module
    return "General"


def main():
    if not DOCX.exists():
        sys.exit(f"Master prompt not found: {DOCX}")
    paras = extract_paragraphs(DOCX)

    # --- prompt boundaries -------------------------------------------------
    boundaries = [0]
    for i, p in enumerate(paras):
        if re.match(r"^ADDITIVE MASTER PROMPT( [IVX]+)?$", p.strip()):
            boundaries.append(i)
    # The docx contains Additive Prompt V twice (verbatim duplicate). Detect it.
    sec_re = re.compile(r"^(\d{1,4})\. (.+)$")

    def prompt_index(line_no: int) -> int:
        idx = 0
        for b_i, b in enumerate(boundaries):
            if line_no >= b:
                idx = b_i
        return idx

    # map boundary index -> prompt label, collapsing the duplicated prompt V
    labels, seen_first_sections = [], {}
    label_i = 0
    for b_i, b in enumerate(boundaries):
        nxt = boundaries[b_i + 1] if b_i + 1 < len(boundaries) else len(paras)
        first_sec = next((sec_re.match(x).group(1) for x in paras[b:nxt] if sec_re.match(x)), None)
        if first_sec is not None and first_sec in seen_first_sections:
            labels.append((seen_first_sections[first_sec], True))
            continue
        lab = PROMPTS[min(label_i, len(PROMPTS) - 1)]
        if first_sec is not None:
            seen_first_sections[first_sec] = lab
        labels.append((lab, False))
        label_i += 1

    # --- sections ----------------------------------------------------------
    sections, current = [], None
    for i, p in enumerate(paras):
        m = sec_re.match(p)
        bi = prompt_index(i)
        if m and len(m.group(2)) < 120 and m.group(2).upper() == m.group(2):
            if current:
                sections.append(current)
            (plabel, ptitle), dup = labels[bi]
            current = {"no": int(m.group(1)), "title": m.group(2).strip(), "prompt": plabel,
                       "promptTitle": ptitle, "line": i + 1, "lines": [], "duplicate": dup}
        elif current is not None:
            if re.match(r"^ADDITIVE MASTER PROMPT", p) or p == "GHL NUMERO":
                sections.append(current)
                current = None
            else:
                current["lines"].append(p)
    if current:
        sections.append(current)

    status_map = json.loads(STATUS_FILE.read_text(encoding="utf8")) if STATUS_FILE.exists() else {}

    reqs, seen = [], set()
    for s in sections:
        if s["duplicate"]:
            continue  # verbatim duplicate copy of Prompt V — indexed once, noted in ledger header
        key = s["no"]
        if key in seen:
            continue
        seen.add(key)
        text = "\n".join(s["lines"]).strip()
        module = classify(s["title"], text)
        ov = status_map.get(str(s["no"]), {})
        reqs.append({
            "id": f"REQ-{s['no']:04d}",
            "no": s["no"],
            "prompt": s["prompt"],
            "promptTitle": s["promptTitle"],
            "title": s["title"],
            "module": ov.get("module", module),
            "text": text,
            "specLine": s["line"],
            "status": ov.get("status", "PLANNED"),
            "phase": ov.get("phase", PHASE_BY_MODULE.get(module, 3)),
            "evidence": ov.get("evidence", ""),
            "notes": ov.get("notes", ""),
        })
    reqs.sort(key=lambda r: r["no"])

    numbers = [r["no"] for r in reqs]
    missing = sorted(set(range(min(numbers), max(numbers) + 1)) - set(numbers))

    (ROOT / "public").mkdir(exist_ok=True)
    (ROOT / "docs").mkdir(exist_ok=True)
    counts = {}
    for r in reqs:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    payload = {
        "generatedFrom": DOCX.name,
        "total": len(reqs),
        "statusCounts": counts,
        "unnumberedInSpec": missing,
        "note": "Additive Prompt V appears twice verbatim in the source document; it is indexed once.",
        "requirements": reqs,
    }
    (ROOT / "docs" / "requirements.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")

    # --- master spec (verbatim) -------------------------------------------
    md = ["# GHL NUMERO — MASTER SPECIFICATION (verbatim)", "",
          "> Generated from `GHL NUMERO PROMPT.docx` by `scripts/build_requirement_ledger.py`.",
          "> This file preserves the complete cumulative specification. Do not edit by hand.", ""]
    for p in paras:
        m = sec_re.match(p)
        if re.match(r"^ADDITIVE MASTER PROMPT", p):
            md.append(f"\n---\n\n## {p}\n")
        elif m and m.group(2).upper() == m.group(2) and len(m.group(2)) < 120:
            md.append(f"\n### {p}\n")
        else:
            md.append(p.replace("\n", "  \n") + "\n")
    (ROOT / "docs" / "NUMERO_MASTER_SPEC.md").write_text("\n".join(md), encoding="utf8")

    # --- ledger markdown ---------------------------------------------------
    led = ["# NUMERO REQUIREMENT LEDGER", "",
           f"Total indexed requirements: **{len(reqs)}**  ",
           "Status counts: " + ", ".join(f"**{k}** {v}" for k, v in sorted(counts.items())), "",
           "Statuses: NOT STARTED · PLANNED · IN PROGRESS · PARTIAL · IMPLEMENTED · TESTED · BLOCKED · NEEDS CLARIFICATION · FUTURE PHASE. Nothing is ever dropped silently.", "",
           f"Section numbers absent from the source document itself: {missing or 'none'}", "",
           "| ID | Prompt | Module | Requirement | Status | Phase | Evidence |", "|---|---|---|---|---|---|---|"]
    for r in reqs:
        led.append(f"| {r['id']} | {r['prompt']} | {r['module']} | {r['title'].replace('|', '/')} | {r['status']} | {r['phase']} | {r['evidence'].replace('|', '/')} |")
    (ROOT / "docs" / "NUMERO_REQUIREMENTS.md").write_text("\n".join(led), encoding="utf8")

    idx = ["# NUMERO SPECIFICATION INDEX", "", "| Section | Title | Prompt | Line in master spec source |", "|---|---|---|---|"]
    for r in reqs:
        idx.append(f"| {r['no']} | {r['title'].replace('|', '/')} | {r['prompt']} | {r['specLine']} |")
    (ROOT / "docs" / "NUMERO_SPEC_INDEX.md").write_text("\n".join(idx), encoding="utf8")

    print(f"requirements: {len(reqs)}  statuses: {counts}  missing numbers: {missing}")
    by_prompt = {}
    for r in reqs:
        by_prompt[r["prompt"]] = by_prompt.get(r["prompt"], 0) + 1
    print("by prompt:", by_prompt)


if __name__ == "__main__":
    main()
