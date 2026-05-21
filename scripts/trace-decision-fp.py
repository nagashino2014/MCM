"""신승에너지/이수화학 false positive 원인 추적."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import fitz

TARGETS = [
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\012-02. 배출시설등 설치·운영허가(변경) 검토결과서((주)신승에너지).pdf",
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\0699-01. 배출시설등 설치 운영허가 검토결과서_(주)이수화학 온산공장(비공개).pdf",
]

DECISION_NO_RE = re.compile(r"제\s*\d{3,5}\s*-\s*\d+\s*호")
BARE_RE = re.compile(r"(?<![\d/])(\d{3,5}\s*-\s*\d{1,2})(?![\d/])")
BIZNO_RE = re.compile(r"\d{3}\s*-\s*\d{2}\s*-\s*\d{5}")

for path in TARGETS:
    p = Path(path)
    print("=" * 90)
    print(p.name)
    print("=" * 90)
    doc = fitz.open(str(p))
    for i in range(min(10, len(doc))):
        text = doc[i].get_text()
        print(f"--- page {i + 1} ({len(text)}자) ---")
        # 첫 1200자
        print(text[:1200].replace("\n", "⏎"))
        print(">> RE_DECISION_NO 매치:", [m.group(0) for m in DECISION_NO_RE.finditer(text)])
        print(">> BARE_RE 매치 :", [m.group(1) for m in BARE_RE.finditer(text)])
        print(">> BIZNO_RE 매치:", [m.group(0) for m in BIZNO_RE.finditer(text)])
        print()
    doc.close()
