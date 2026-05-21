"""sigungu.topojson.json → 시도(KOSTAT code 앞 2자리)별 시군구 명칭 사전 dump."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
P_SIDO = ROOT / "frontend" / "public" / "geo" / "sido.topojson.json"
P_SGG = ROOT / "frontend" / "public" / "geo" / "sigungu.topojson.json"
OUT = ROOT / "scripts" / "_sigungu-dump.txt"

import io
_out = io.StringIO()
_builtin_print = print
def _p(s: str = "") -> None:
    _builtin_print(s)
    _out.write(s + "\n")

print = _p  # type: ignore

sido_topo = json.loads(P_SIDO.read_text(encoding="utf-8"))
sgg_topo = json.loads(P_SGG.read_text(encoding="utf-8"))

# topojson 구조: objects.<key>.geometries[].properties{ code, name }
sido_key = next(iter(sido_topo["objects"].keys()))
sgg_key = next(iter(sgg_topo["objects"].keys()))

print(f"sido objects key   : {sido_key}")
print(f"sigungu objects key: {sgg_key}")
print()

print("=== SIDO ===")
sido_by_code: dict[str, str] = {}
for g in sido_topo["objects"][sido_key]["geometries"]:
    p = g.get("properties", {})
    code = str(p.get("code", ""))
    name = p.get("name", "")
    sido_by_code[code] = name
    print(f"  {code:<3} {name}")

print()
print("=== SIGUNGU (시도별 그룹) ===")
groups: dict[str, list[str]] = defaultdict(list)
seen: set[tuple[str, str]] = set()
for g in sgg_topo["objects"][sgg_key]["geometries"]:
    p = g.get("properties", {})
    code = str(p.get("code", ""))
    name = p.get("name", "")
    sido_code = code[:2]
    key = (sido_code, name)
    if key in seen:
        continue
    seen.add(key)
    groups[sido_code].append(name)

for sido_code, names in sorted(groups.items()):
    sido_name = sido_by_code.get(sido_code, sido_code)
    names_sorted = sorted(set(names))
    print(f"\n  [{sido_code} {sido_name}]  ({len(names_sorted)}개)")
    for n in names_sorted:
        print(f"    - {n}")

print()
print("=== 모든 시군구 명칭 중 합성형(OO시+OO구) 패턴 ===")
import re

pat = re.compile(r"^([가-힣]+시)([가-힣]+구)$")
composite = [n for ns in groups.values() for n in set(ns) if pat.match(n)]
for n in sorted(set(composite)):
    m = pat.match(n)
    print(f"  {n}  -> primary={m.group(1)}  sub={m.group(2)}")

OUT.write_text(_out.getvalue(), encoding="utf-8")
