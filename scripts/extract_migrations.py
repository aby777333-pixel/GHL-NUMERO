"""Dev helper: rebuild local migration files from what was actually applied.

Phase 2 migrations were applied in 18 pieces (p2_01 ... p2_18) and Phase 3 migrations in
27 pieces (p3_01 ... p3_27). This script takes the saved result of

    select name, version, array_to_string(statements, E'\\n;;;NUMERO_STMT;;;\\n') as sql
    from supabase_migrations.schema_migrations where name like 'p2\\_%' order by version

(or 'p3\\_%') and writes the local files, so that the repository holds exactly what the
database holds.

usage: python scripts/extract_migrations.py <saved-result> [p2|p3]
"""
import json, pathlib, re, sys

raw = open(sys.argv[1], encoding="utf8").read()
try:
    data = json.loads(raw)
    if isinstance(data, list):
        data = json.loads(data[0]["text"])
    inner = data["result"]
except Exception:
    inner = raw
m = re.search(r"<untrusted-data-[^>]+>\s*(\[.*\])\s*</untrusted-data-", inner, flags=re.S)
rows = json.loads(m.group(1))

PHASES = {
    "p2": {
        "0006_workflow_registers_documents.sql": [1, 2, 3, 4, 5, 6],
        "0007_assets_purchasing.sql": [7, 8, 9, 10],
        "0008_expenses_advances_cash.sql": [11, 12, 13, 14],
        "0009_treasury_payroll.sql": [15, 16, 17, 18],
    },
    # a correction is kept with the part it corrects: 16, 17, 19, 20, 22 and 23 belong to scenarios and flows, 18 and 21 to the funds.
    # 24 corrects several parts at once after the assessment of release 0.3.0 and stands by itself, last, with 25 which corrects it, 26, the measure of a page of the API, and 27, found when the records were read a second time.
    "p3": {
        "0014_inventory.sql": [1, 2, 3, 4, 5],
        "0015_investments_funds.sql": [6, 7, 8, 18, 21],
        "0016_reality_control.sql": [9, 10],
        "0017_scenarios_flows.sql": [11, 16, 17, 19, 20, 22, 23],
        "0018_platform.sql": [12, 13, 14, 15],
        "0019_corrections_after_assessment.sql": [24, 25, 26, 27],
    },
}
FILES = PHASES[sys.argv[2] if len(sys.argv) > 2 else "p2"]

by_no = {int(r["name"].split("_")[1]): r for r in rows}
used = [n for nums in FILES.values() for n in nums]
missing = sorted(set(by_no) - set(used))
if missing:
    sys.exit(f"pieces applied to the database and not placed in any file: {missing}")
out = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations"
for fname, nums in FILES.items():
    parts = []
    for n in nums:
        r = by_no[n]
        sql = r["sql"].replace("\n;;;NUMERO_STMT;;;\n", "\n\n").replace("\r\n", "\n").strip()
        parts.append(f"-- >>> applied as migration {r['version']} · {r['name']}\n{sql}\n")
    text = "\n".join(parts)
    (out / fname).write_text(text, encoding="utf8", newline="\n")
    print(fname, len(text), "chars,", text.count("\n"), "lines, pieces", list(nums))
