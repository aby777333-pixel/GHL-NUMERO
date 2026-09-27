"""Dev helper: rebuild local migration files from what was actually applied.

Phase 2 migrations were applied in 18 pieces (p2_01 … p2_18). This script takes the
saved result of

    select name, version, array_to_string(statements, E'\\n;;;NUMERO_STMT;;;\\n') as sql
    from supabase_migrations.schema_migrations where name like 'p2\\_%' order by version

and writes the four local files, so that the repository holds exactly what the
database holds.

usage: python scripts/extract_migrations.py <saved-result>
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

FILES = {
    "0006_workflow_registers_documents.sql": range(1, 7),
    "0007_assets_purchasing.sql": range(7, 11),
    "0008_expenses_advances_cash.sql": range(11, 15),
    "0009_treasury_payroll.sql": range(15, 19),
}
by_no = {int(r["name"].split("_")[1]): r for r in rows}
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
