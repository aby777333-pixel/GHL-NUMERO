"""Checks one phase-2 status file against its requirement list. Usage: python scripts/check_status_part.py <status file> <requirements .md>"""
import importlib.util, re, sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("part", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
want = [int(n) for n in re.findall(r"^### (\d+) ", Path(sys.argv[2]).read_text(encoding="utf8"), re.M)]
have = [e[1] for e in m.ENTRIES] + list(m.PLANNED)
problems = []
for n in want:
    if have.count(n) == 0: problems.append(f"{n}: missing")
    if have.count(n) > 1: problems.append(f"{n}: recorded more than once")
for n in have:
    if n not in want: problems.append(f"{n}: not in this requirement list")
for status, no, evidence, notes in m.ENTRIES:
    if status not in ("TESTED", "IMPLEMENTED", "PARTIAL", "BLOCKED"): problems.append(f"{no}: unknown status {status}")
    if not evidence.strip(): problems.append(f"{no}: no evidence")
    if status == "TESTED" and not re.search(r"tests/", evidence): problems.append(f"{no}: TESTED without a named test")
    if status == "PARTIAL" and not ("Built:" in notes and "Not built:" in notes): problems.append(f"{no}: PARTIAL note must say 'Built: … Not built: …'")
    for f in re.findall(r"(?:src|tests|supabase|scripts)/[\w./-]+\.\w+", evidence):
        if not Path(f).exists(): problems.append(f"{no}: evidence names a file that does not exist: {f}")
counts = {}
for e in m.ENTRIES: counts[e[0]] = counts.get(e[0], 0) + 1
counts["PLANNED"] = len(m.PLANNED)
print(counts)
print("\n".join(problems) if problems else "OK: every requirement is recorded once, with evidence.")
sys.exit(1 if problems else 0)
