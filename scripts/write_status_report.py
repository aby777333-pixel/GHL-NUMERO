"""
Writes docs/NUMERO_IMPLEMENTATION_STATUS.md from its template and the recorded statuses.

The figures in the report are never typed by hand: they are counted from
docs/requirement-status.json (what is recorded) and docs/requirements.json
(every requirement, with its module and phase).

Run:  python scripts/status_map.py && python scripts/build_requirement_ledger.py && python scripts/write_status_report.py
"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
reqs = json.loads((ROOT / "docs" / "requirements.json").read_text(encoding="utf8"))
reqs = reqs["requirements"] if isinstance(reqs, dict) else reqs
status = json.loads((ROOT / "docs" / "requirement-status.json").read_text(encoding="utf8"))

ORDER = ["TESTED", "IMPLEMENTED", "PARTIAL", "BLOCKED", "PLANNED"]
of = lambda r: status.get(str(r["no"]), {}).get("status", "PLANNED")
total = len(reqs)
count = {k: sum(1 for r in reqs if of(r) == k) for k in ORDER}
assert sum(count.values()) == total, "every requirement must have exactly one status"
pct = lambda n: f"{n * 100 / total:.1f}%"

values = {"PLANNED": f"{count['PLANNED']:,}", "PLANNED_PCT": pct(count["PLANNED"])}
for k in ORDER[:-1]:
    values[k] = f"{count[k]:,}"
    values[k + "_PCT"] = pct(count[k])

phase2 = [r for r in reqs if r.get("phase") == 2]
rows = ["| Module | Requirements | Tested | Implemented | Partial | Planned or blocked |", "|---|---:|---:|---:|---:|---:|"]
for m in sorted({r["module"] for r in phase2}, key=lambda m: -sum(1 for r in phase2 if r["module"] == m)):
    rs = [r for r in phase2 if r["module"] == m]
    c = {k: sum(1 for r in rs if of(r) == k) for k in ORDER}
    rows.append(f"| {m} | {len(rs)} | {c['TESTED']} | {c['IMPLEMENTED']} | {c['PARTIAL']} | {c['PLANNED'] + c['BLOCKED']} |")
c = {k: sum(1 for r in phase2 if of(r) == k) for k in ORDER}
rows.append(f"| **All of Phase 2** | **{len(phase2)}** | **{c['TESTED']}** | **{c['IMPLEMENTED']}** | **{c['PARTIAL']}** | **{c['PLANNED'] + c['BLOCKED']}** |")
values["PHASE2_TABLE"] = "\n".join(rows)

phase3 = [r for r in reqs if r.get("phase") == 3]
rows = ["| Module | Requirements | Tested | Implemented | Partial | Planned or blocked |", "|---|---:|---:|---:|---:|---:|"]
for m in sorted({r["module"] for r in phase3}, key=lambda m: -sum(1 for r in phase3 if r["module"] == m)):
    rs = [r for r in phase3 if r["module"] == m]
    c = {k: sum(1 for r in rs if of(r) == k) for k in ORDER}
    rows.append(f"| {m} | {len(rs)} | {c['TESTED']} | {c['IMPLEMENTED']} | {c['PARTIAL']} | {c['PLANNED'] + c['BLOCKED']} |")
c = {k: sum(1 for r in phase3 if of(r) == k) for k in ORDER}
rows.append(f"| **All of Phase 3** | **{len(phase3)}** | **{c['TESTED']}** | **{c['IMPLEMENTED']}** | **{c['PARTIAL']}** | **{c['PLANNED'] + c['BLOCKED']}** |")
values["PHASE3_TABLE"] = "\n".join(rows)

rows = ["| Phase | Requirements | Tested | Implemented | Partial | Planned or blocked |", "|---|---:|---:|---:|---:|---:|"]
for ph in sorted({r.get("phase") for r in reqs}, key=lambda x: (x is None, x)):
    rs = [r for r in reqs if r.get("phase") == ph]
    c = {k: sum(1 for r in rs if of(r) == k) for k in ORDER}
    rows.append(f"| {ph if ph is not None else 'not assigned'} | {len(rs)} | {c['TESTED']} | {c['IMPLEMENTED']} | {c['PARTIAL']} | {c['PLANNED'] + c['BLOCKED']} |")
rows.append(f"| **All** | **{total}** | **{count['TESTED']}** | **{count['IMPLEMENTED']}** | **{count['PARTIAL']}** | **{count['PLANNED'] + count['BLOCKED']}** |")
values["PHASES_TABLE"] = "\n".join(rows)

spec = importlib.util.spec_from_file_location("p1", ROOT / "scripts" / "status_phase1_updates.py")
p1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p1)
values["UPDATED"] = str(len(p1.UPDATES) + len(getattr(p1, "REVERT_TO_PLANNED", [])))
values["UPDATED_P3"] = str(len(json.loads((ROOT / "docs" / "requirement-updated-in-phase3.json").read_text(encoding="utf8"))))

# what was verified, as recorded by the person who verified it: scripts/_assess/verification.json
for k, v in json.loads((ROOT / "scripts" / "_assess" / "verification.json").read_text(encoding="utf8")).items():
    values["V_" + k] = str(v)

import re
text = (ROOT / "scripts" / "_assess" / "IMPLEMENTATION_STATUS.template.md").read_text(encoding="utf8")
for k, v in values.items():
    text = text.replace("{" + k + "}", v)
left = re.findall(r"\{[A-Z][A-Z0-9_]*\}", text)
assert not left, f"figures of the report that were not filled in: {sorted(set(left))}"
(ROOT / "docs" / "NUMERO_IMPLEMENTATION_STATUS.md").write_text(text, encoding="utf8", newline="\n")
print("status report written:", {k: count[k] for k in ORDER}, "of", total)
