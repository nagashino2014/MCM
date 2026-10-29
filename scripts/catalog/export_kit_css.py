#!/usr/bin/env python3
"""회사소개서 지면 키트 CSS 재export — 디자인 시스템 아티팩트 bundle.css → frontend/public/catalog-kit/kesi-catalog.css

kesi-catalog.css 는 디자인 시스템(claude.ai/artifact/AovTvRBgpnUv7r6CQvxp8B) project/components/bundle.css 의 사본이라
손으로 고치지 않는다. 디자인 시스템 쪽 bundle.css 를 고친 뒤 이 스크립트로 사본을 다시 만든다.
  - 원본 첫 줄의 Google Fonts @import 만 뺀다(PDF 변환기는 외부 네트워크를 막고, 기본 서체 Pretendard 는 print-kit 이 직접 싣는다).
  - 머리말 3줄에 아티팩트 version(publish 결과의 version)과 날짜를 적는다.

실행(저장소 루트): python scripts/catalog/export_kit_css.py <bundle.css> --version 1793264639-c595 --date 2026-10-29
검증: git diff 로 기존 규칙이 바뀌지 않고 추가만 됐는지 본다(기존 standard 문서 렌더 불변).
"""
import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "frontend", "public", "catalog-kit", "kesi-catalog.css")
ARTIFACT = "https://claude.ai/artifact/AovTvRBgpnUv7r6CQvxp8B"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle", help="디자인 시스템 project/components/bundle.css 파일 경로")
    ap.add_argument("--version", required=True, help="아티팩트 version(예: 1793264639-c595)")
    ap.add_argument("--date", required=True, help="재export 날짜(YYYY-MM-DD)")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    src = open(a.bundle, encoding="utf-8").read().replace("\r\n", "\n")
    lines = src.split("\n")
    if not lines[0].startswith("@import url('https://fonts.googleapis.com"):
        print("첫 줄이 Google Fonts @import 가 아닙니다 — 원본 bundle.css 가 맞는지 확인하세요.", file=sys.stderr)
        return 2
    body = "\n".join(lines[1:])
    if re.search(r"@import\s+url\(", body):
        print("본문에 @import 가 남아 있습니다.", file=sys.stderr)
        return 2
    header = (
        f"/* KESI 회사소개서 디자인 시스템 컴포넌트 CSS(kc-*) — 디자인 시스템 아티팩트 project/components/bundle.css(version {a.version}, {a.date}) 사본.\n"
        f"   {ARTIFACT} — 손으로 고치지 않는다(문서 보정은 lib/catalog/render/print-overrides.ts, 재export 는 scripts/catalog/export_kit_css.py).\n"
        "   PDF 는 외부 네트워크를 막으므로 원본 첫 줄의 Google Fonts @import 만 뺐다(기본 서체 Pretendard 는 print-kit 이 직접 싣는다). */\n"
    )
    out = header + body
    if not out.endswith("\n"):
        out += "\n"
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print(f"wrote {os.path.relpath(a.out, ROOT)} ({len(out.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
