# -*- coding: utf-8 -*-
"""
다우오피스 '초과/휴일근무신청' 문서 → MCM 초과근무 신청서(frm-overtime-request) 마이그레이션.

목적: 급여대장의 초과근무수당을 '신청 기록 × 근태 기록' 대조로 산정하려면 앱에 신청 데이터가 있어야 한다.
      전자결재 이관(9월 예정) 전에 검증용으로 특정 기간분만 정식 양식으로 적재한다.

원본: data/daou/docs/<documentId>/detail.json 의 docBodyContent(HTML 표).
사용: python parse_overtime.py --from 2026-04-26 --to 2026-05-27 [--apply]
      (--apply 없으면 dry-run 리포트만 출력)
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from html import unescape

DAOU_ROOT = r"C:\CodingProject\MCM\data\daou"
DOCS_DIR = os.path.join(DAOU_ROOT, "docs")
LIST_PATH = os.path.join(DAOU_ROOT, "documents.jsonl")

# 다우 용역분류 → MCM service_class 옵션(141 마이그레이션 기준)
SERVICE_CLASS_MAP = {
    "통합환경허가": "통합허가",
    "통합허가": "통합허가",
    "장외&화관법": "장외&화관법",
    "장외영향평가": "장외&화관법",
    "화관법": "장외&화관법",
    "HAPs": "HAPs",
    "ESG탄소중립": "ESG탄소중립",
}


def html_tokens(html: str) -> list[str]:
    """표 HTML → 셀 텍스트 토큰 배열(빈 셀 제거)."""
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", "\x01", text)
    text = unescape(text).replace("\xa0", " ")
    parts = [p.strip() for p in text.split("\x01")]
    return [p for p in parts if p and p not in {"~", "|"}]


# 표의 다른 레이블 — 값이 빈 셀일 때 다음 레이블을 값으로 잘못 취하는 것을 막는다.
LABELS = {
    "문서번호", "작성일자", "신청부서", "신청자", "담당 프로젝트", "업체명", "용역분류",
    "일시", "사유", "시간", "기사용시간", "신청시간", "잔여시간", "초과/휴일근무 신청",
    "신청", "승인", "합의", "전결", "(용역명)", "(구체적으로", "기술할 것)",
}


def find_after(tokens: list[str], label: str, max_ahead: int = 4) -> str | None:
    """레이블 토큰 다음에 오는 첫 값 토큰(다른 레이블·안내문은 값으로 보지 않는다)."""
    for i, t in enumerate(tokens):
        if t == label or t.startswith(label):
            for j in range(i + 1, min(i + 1 + max_ahead, len(tokens))):
                v = tokens[j]
                if not v or v == label or v in LABELS or v.startswith("(") or v.startswith("※"):
                    continue
                return v
    return None


DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def parse_doc(html: str) -> dict:
    tokens = html_tokens(html)
    joined = " ".join(tokens)

    # 일시: '일시' 이후 첫 두 날짜 = 시작/종료
    dates: list[str] = []
    try:
        idx = next(i for i, t in enumerate(tokens) if t == "일시")
    except StopIteration:
        idx = -1
    if idx >= 0:
        for t in tokens[idx : idx + 12]:
            for m in DATE_RE.finditer(t):
                dates.append(m.group(0))
    start_date = dates[0] if dates else None
    end_date = dates[1] if len(dates) > 1 else start_date

    # 시간: '일시' 이후 '<숫자>시 ... <숫자>분' 패턴 4개(시작시, 시작분, 종료시, 종료분)
    nums: list[str] = []
    if idx >= 0:
        for t in tokens[idx : idx + 24]:
            m = re.fullmatch(r"(\d{1,2})\s*(시|분)?", t)
            if m and m.group(1):
                nums.append(m.group(1))
    time_start = time_end = None
    if len(nums) >= 4:
        time_start = f"{int(nums[0]):02d}:{int(nums[1]):02d}"
        time_end = f"{int(nums[2]):02d}:{int(nums[3]):02d}"

    reason = None
    for i, t in enumerate(tokens):
        if t.startswith("사유"):
            for j in range(i + 1, min(i + 6, len(tokens))):
                v = tokens[j]
                if v.startswith("(") or v in {"기술할 것", "구체적으로"}:
                    continue
                if v.startswith("※"):
                    break
                reason = v
                break
            break

    return {
        "docNum": find_after(tokens, "문서번호"),
        "draftDate": (DATE_RE.search(find_after(tokens, "작성일자") or "") or [None])
        and (DATE_RE.search(find_after(tokens, "작성일자") or "").group(0) if DATE_RE.search(find_after(tokens, "작성일자") or "") else None),
        "deptName": find_after(tokens, "신청부서"),
        "applicantName": find_after(tokens, "신청자"),
        "projectName": find_after(tokens, "담당 프로젝트", max_ahead=3),
        "companyName": find_after(tokens, "업체명"),
        "serviceClass": find_after(tokens, "용역분류"),
        "startDate": start_date,
        "endDate": end_date,
        "timeStart": time_start,
        "timeEnd": time_end,
        "reason": reason,
        "hasRuleNote": "초과근무수당의 지급 상한" in joined,
    }


def hours_between(t1: str | None, t2: str | None) -> float | None:
    if not t1 or not t2:
        return None
    h1, m1 = (int(x) for x in t1.split(":"))
    h2, m2 = (int(x) for x in t2.split(":"))
    mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    if mins <= 0:  # 자정 넘김
        mins += 24 * 60
    return round(mins / 60, 2)


def load_targets(date_from: str, date_to: str) -> list[dict]:
    out = []
    with open(LIST_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            if "초과" not in (d.get("formName") or ""):
                continue
            drafted = (d.get("draftedAt") or "")[:10]
            if date_from <= drafted <= date_to:
                out.append(d)
    out.sort(key=lambda d: d.get("draftedAt") or "")
    return out


def main() -> None:
    # 콘솔 인코딩은 직접 실행할 때만 바꾼다(모듈로 import 될 때 재래핑하면 stdout 이 닫힌다).
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="date_from", default="2026-04-26")
    ap.add_argument("--to", dest="date_to", default="2026-05-27")
    ap.add_argument("--work-from", dest="work_from", default="2026-04-26", help="근무일 귀속 시작(이 기간 밖 근무일은 제외)")
    ap.add_argument("--work-to", dest="work_to", default="2026-05-25", help="근무일 귀속 종료")
    ap.add_argument("--json-out", dest="json_out", default=None)
    args = ap.parse_args()

    docs = load_targets(args.date_from, args.date_to)
    rows, problems = [], []
    for d in docs:
        did = d["documentId"]
        detail_path = os.path.join(DOCS_DIR, did, "detail.json")
        if not os.path.isfile(detail_path):
            problems.append((d.get("docNum"), "detail.json 없음"))
            continue
        detail = json.load(open(detail_path, encoding="utf-8"))
        document = (detail.get("data") or {}).get("document") or {}
        parsed = parse_doc(document.get("docBodyContent") or "")
        parsed["documentId"] = did
        parsed["docStatus"] = d.get("docStatus")
        parsed["title"] = d.get("title")
        parsed["drafterName"] = d.get("drafterName") or parsed.get("applicantName")
        parsed["drafterDept"] = d.get("drafterDeptName") or parsed.get("deptName")
        parsed["drafterPosition"] = d.get("drafterPositionName")
        parsed["draftedAt"] = d.get("draftedAt")
        parsed["completedAt"] = d.get("latestActivityCompletedAt")
        parsed["hours"] = hours_between(parsed.get("timeStart"), parsed.get("timeEnd"))
        rows.append(parsed)
        if not parsed.get("startDate") or not parsed.get("timeStart"):
            problems.append((d.get("docNum"), "일시/시간 파싱 실패"))

    in_window = [r for r in rows if r.get("startDate") and args.work_from <= r["startDate"] <= args.work_to]

    print(f"신청일 {args.date_from}~{args.date_to} 초과근무 신청: {len(rows)}건")
    print(f"근무일 {args.work_from}~{args.work_to} 귀속: {len(in_window)}건")
    print(f"상태: " + ", ".join(f"{s}={sum(1 for r in rows if r['docStatus'] == s)}" for s in sorted({r["docStatus"] for r in rows})))
    print(f"파싱 문제: {len(problems)}건 {problems[:5]}")
    print()
    print(f"{'문서번호':<26}{'신청자':<7}{'근무일':<12}{'시간':<14}{'h':>5}  용역/사유")
    for r in sorted(in_window, key=lambda x: (x["startDate"], x.get("timeStart") or "")):
        print(
            f"{(r['docNum'] or '-'):<26}{(r['drafterName'] or '-'):<7}{r['startDate']:<12}"
            f"{(r['timeStart'] or '-') + '~' + (r['timeEnd'] or '-'):<14}{(r['hours'] or 0):>5}  "
            f"{(r.get('projectName') or r.get('title') or '')[:34]}"
        )
    by_person: dict[str, float] = {}
    for r in in_window:
        by_person[r["drafterName"] or "-"] = round(by_person.get(r["drafterName"] or "-", 0) + (r["hours"] or 0), 2)
    print("\n인원별 신청시간 합계(h):")
    for n, h in sorted(by_person.items(), key=lambda x: -x[1]):
        print(f"  {n:<8}{h:>7}")
    print(f"\n합계 {round(sum(by_person.values()), 2)}h · 인원 {len(by_person)}명")

    if args.json_out:
        json.dump(in_window, open(args.json_out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\nJSON 저장: {args.json_out}")


if __name__ == "__main__":
    main()
