"""Generates the register-kind seed SQL from src/engine/registerKinds.json.

The JSON file is the single source for both the demo engine and the database,
so the two can never drift apart. Usage:
    python scripts/gen_register_kinds_sql.py            # prints the SQL
"""
import json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
kinds = json.loads((root / 'src/engine/registerKinds.json').read_text(encoding='utf8'))

def q(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"

rows = []
for k in kinds:
    fields = json.dumps(k.get('fields', []), ensure_ascii=False).replace("'", "''")
    rows.append(f"  ({q(k['key'])}, {q(k['name'])}, {q(k['category'])}, {q(k['direction'])}, {q(k['certainty'])}, "
                f"{q(k.get('dimension_type'))}, {q(k['prefix'])}, {k['sort']}, '{fields}'::jsonb)")

sql = ("-- ---------- register kinds (generated from src/engine/registerKinds.json) ----------\n"
       "insert into public.register_kinds(key, name, category, direction, default_certainty, dimension_type, prefix, sort, fields) values\n"
       + ",\n".join(rows)
       + "\non conflict (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update set\n"
         "  name = excluded.name, category = excluded.category, direction = excluded.direction,\n"
         "  default_certainty = excluded.default_certainty, dimension_type = excluded.dimension_type,\n"
         "  prefix = excluded.prefix, sort = excluded.sort, fields = excluded.fields;\n")
sys.stdout.reconfigure(encoding='utf8')
print(sql)
