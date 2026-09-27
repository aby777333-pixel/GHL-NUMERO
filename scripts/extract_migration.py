"""Dev helper: write a migration file from a saved `schema_migrations` query result.
usage: python scripts/extract_migration.py <saved-result> <output.sql>"""
import json, re, sys
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
sql = rows[0]["sql"].replace("\n;;;NUMERO_STMT;;;\n", "\n\n").replace("\r\n", "\n")
open(sys.argv[2], "w", encoding="utf8", newline="\n").write(sql.rstrip() + "\n")
print(rows[0]["name"], len(sql), "chars,", sql.count("\n"), "lines ->", sys.argv[2])
