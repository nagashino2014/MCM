#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""근로계약서 PDF 스캔본 → labor_contracts 적재 (PL-P2, 블루프린트 §3-2).

원본: V:\\업무자료\\경리업무\\근로계약서 (연도 폴더 + 잡폴더, PDF 스캔본, 하위 폴더 사본 중복)
대상: 현 재직자(employee_profiles.status='active')의 계약서만 — 퇴사자·인턴 스캔본 제외(§1-2 확정).

단계:
  1. inventory  — 재귀 수집, sha256 dedup, 파일명 파싱(성명·직급·날짜·종류)
  2. filter     — DB 재직자 명단과 성명 매칭
  3. extract    — Claude 멀티모달(PDF 직접 입력). 기본 claude-haiku-4-5,
                  검증 실패·저신뢰 시 claude-opus-5 재시도(문서 추출 아키텍처 관례)
  4. verify     — 파일명 메타 vs 추출값 교차 검증, 연봉=월급여×12 대조 → 불일치는 검수 플래그
  5. tag        — 사람별 시간순 정렬 → 일반/승진 자동판정(§1-3: 입사일 작성 아님 + 직전 계약보다
                  직급 상승 = 승진). 직급 서열은 positions.rank_order.
  6. load       — labor_contracts UPSERT(contract_id = 'lc-'+sha16, 멱등) + 원본 S3 업로드

사용법:
  DATABASE_URL=... python scripts/labor_contract_import/import_contracts.py --dry-run   # 1~2단계만
  DATABASE_URL=... ANTHROPIC_API_KEY=... AWS_PROFILE=mcm-kesi-staging \\
      python scripts/labor_contract_import/import_contracts.py                          # 전체
  --limit N  : 추출 대상 N건만(파일럿)
리포트: scripts/labor_contract_import/CONTRACT_IMPORT_REPORT.md
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import psycopg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

BASE = Path(r"V:\업무자료\경리업무\근로계약서")
REPORT_PATH = Path(__file__).parent / "CONTRACT_IMPORT_REPORT.md"
S3_BUCKET = "mcm-ieps-staging-data"
MODEL_PRIMARY = "claude-haiku-4-5"
MODEL_RETRY = "claude-opus-5"

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "employee_name": {"type": "string", "description": "근로자(을) 성명"},
        "contract_date": {"type": "string", "description": "계약서 작성일 YYYY-MM-DD (하단 날짜)"},
        "first_hired_at": {"type": ["string", "null"], "description": "최초입사일 YYYY-MM-DD"},
        "effective_from": {"type": ["string", "null"], "description": "연봉계약 기간 시작 YYYY-MM-DD"},
        "effective_to": {"type": ["string", "null"], "description": "연봉계약 기간 종료 YYYY-MM-DD"},
        "duty": {"type": ["string", "null"], "description": "담당 업무"},
        "position": {"type": ["string", "null"], "description": "직위 (예: 차장)"},
        "annual_salary": {"type": ["number", "null"], "description": "연봉총액(원)"},
        "monthly_salary": {"type": ["number", "null"], "description": "월 급여(원)"},
        "wage_components": {
            "type": "object",
            "description": "월 임금 구성표의 항목명→금액. 값이 있는 항목만. 예: {\"기본급\": 3971667}",
            "additionalProperties": False,
            "properties": {},
        },
        "work_hours": {"type": ["string", "null"], "description": "근로시간 요약 (예: '09:00~18:00, 주40시간')"},
        "probation": {"type": "boolean", "description": "수습 조항 적용 여부(신입/경력 3년 미만 문구가 실제 적용되는 계약인지가 아니라 별도 수습 명시 여부)"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"], "description": "판독 신뢰도"},
    },
    "required": ["employee_name", "contract_date", "confidence"],
    "additionalProperties": False,
}

EXTRACT_PROMPT = (
    "이 문서는 (주)한국환경안전연구원의 근로계약서(또는 임원/고문/연봉 계약서) 스캔본이다. "
    "다음 필드를 추출하라. 금액은 숫자만(콤마 제거), 날짜는 YYYY-MM-DD. "
    "wage_components 는 '월 임금액의 구성' 표에서 값이 기입된 항목만 {항목명: 금액} 으로. "
    "항목명은 표 헤더 그대로(기본급/식대/차량유지비/양육수당/연구수당/업무수당/자격수당/"
    "고정연장수당/고정휴일수당/고정야간수당/연차수당 등). "
    "스캔 품질로 판독이 불확실한 필드가 있으면 confidence 를 낮춰라."
)

# wage_components 는 자유 키라 strict 불가 — properties 빈 object 로 두면 additionalProperties=False 에 막힌다.
# 따라서 wage_components 만 문자열(JSON)로 받는 우회 대신, schema 에서 wage_components 를 제거하고
# 프롬프트로 JSON 문자열 필드를 받는다.
EXTRACT_SCHEMA["properties"]["wage_components"] = {
    "type": "string",
    "description": "월 임금 구성표를 JSON 문자열로. 예: '{\"기본급\": 3971667, \"식대\": 100000}'. 없으면 '{}'",
}

def parse_fname(stem: str) -> tuple[str | None, str | None, str | None]:
    """파일명 → (성명, 직급, 날짜). 표기 변형이 많아(연도별 담당자 상이) 관대하게:
    날짜는 파일명 어디서든, 이름은 ①선두 한글 토큰 ②괄호 안 한글 토큰 순으로 찾는다.
    실패 시 filter 단계에서 재직자 명단 포함 검색으로 폴백."""
    if not re.search(r"근로계약서|근로게약서|임원계약서|고문계약서", stem):
        return None, None, None
    date = None
    dm = re.search(r"(\d{2,4})[.](\d{1,2})[.](\d{1,2})", stem)
    if dm:
        y = int(dm.group(1))
        y = y + 2000 if y < 100 else y
        try:
            date = f"{y}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
        except ValueError:
            date = None
    m = re.match(r"^(?P<name>[가-힣]{2,4})\s+(?P<pos>[가-힣()]{2,12})?", stem)
    if m:
        return m.group("name"), (m.group("pos") or "").strip("() ") or None, date
    m = re.search(r"\(\s*(?P<name>[가-힣]{2,4})", stem)
    if m:
        return m.group("name"), None, date
    return None, None, None


def kind_of(filename: str) -> str:
    if "임원계약서" in filename:
        return "executive"
    if "고문계약서" in filename:
        return "advisor"
    if "승진" in filename:
        return "promotion"
    if re.search(r"~\s*\d{4}", filename):
        return "fixed_term"
    return "regular"


def parse_date_token(tok: str) -> str | None:
    m = re.match(r"(\d{4})[.](\d{1,2})[.](\d{1,2})", tok)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def inventory() -> tuple[list[dict], list[str]]:
    """PDF 재귀 수집 + sha dedup + 파일명 파싱."""
    seen_sha: dict[str, str] = {}
    items, skipped = [], []
    for p in sorted(BASE.rglob("*.pdf")):
        rel = str(p.relative_to(BASE))
        if "인턴계약서" in rel:
            skipped.append(f"{rel} — 인턴 제외")
            continue
        data = p.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        if sha in seen_sha:
            skipped.append(f"{rel} — 중복({seen_sha[sha]})")
            continue
        seen_sha[sha] = rel
        name, pos, fdate = parse_fname(p.stem)
        items.append({
            "path": p, "rel": rel, "sha": sha, "size": len(data),
            "fname_name": name, "fname_pos": pos,
            "fname_date": fdate, "kind": kind_of(p.name),
        })
    return items, skipped


def load_active_employees(dsn: str) -> tuple[dict[str, str], dict[str, int]]:
    """성명→employee_id (재직자), 직급명→rank_order."""
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT employee_id, name FROM employee_profiles WHERE status = 'active'")
        emp = {re.sub(r"\s+", "", n): eid for eid, n in cur.fetchall()}
        cur.execute("SELECT position_name, rank_order FROM positions")
        ranks = {n: r for n, r in cur.fetchall()}
    return emp, ranks


def extract_one(client, pdf_bytes: bytes, model: str) -> dict:
    b64 = base64.standard_b64encode(pdf_bytes).decode()
    response = client.messages.create(
        model=model,
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
                {"type": "text", "text": EXTRACT_PROMPT},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": EXTRACT_SCHEMA}},
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("모델이 요청을 거절했습니다 (refusal)")
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    try:
        data["wage_components"] = json.loads(data.get("wage_components") or "{}")
    except (TypeError, json.JSONDecodeError):
        data["wage_components"] = {}
    return data


def verify(item: dict, data: dict) -> list[str]:
    issues = []
    if item["fname_name"] and re.sub(r"\s+", "", data.get("employee_name") or "") != item["fname_name"]:
        issues.append(f"성명 불일치: 파일명 {item['fname_name']} vs 추출 {data.get('employee_name')}")
    ann, mon = data.get("annual_salary"), data.get("monthly_salary")
    if ann and mon and abs(ann - mon * 12) > 2000:
        issues.append(f"연봉({ann:,.0f}) ≠ 월급여×12({mon * 12:,.0f})")
    if data.get("confidence") == "low":
        issues.append("저신뢰 판독")
    if not data.get("contract_date"):
        issues.append("작성일 미추출")
    return issues


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="inventory+filter 까지만")
    ap.add_argument("--limit", type=int, default=0, help="추출 대상 N건 제한(파일럿)")
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL 환경변수가 필요합니다.")

    items, skipped = inventory()
    employees, ranks = load_active_employees(dsn)

    targets, excluded = [], []
    for it in items:
        name = it["fname_name"]
        if not name or name not in employees:
            # 폴백: 파일명(stem)에 재직자 성명이 유일하게 포함되면 그 사람으로
            stem = it["path"].stem
            hits = [n for n in employees if n in re.sub(r"\s+", "", stem)]
            if len(hits) == 1:
                name = hits[0]
                it["fname_name"] = name
            elif len(hits) > 1:
                excluded.append(f"{it['rel']} — 복수 재직자명 포함{hits}(수동 확인)")
                continue
            elif not it["fname_name"]:
                excluded.append(f"{it['rel']} — 파일명에서 성명 파싱 실패(수동 확인)")
                continue
            else:
                excluded.append(f"{it['rel']} — 재직자 아님({it['fname_name']})")
                continue
        it["employee_id"] = employees[name]
        targets.append(it)

    rep = [
        "# 근로계약서 데이터화 리포트",
        f"\n생성: {datetime.now().strftime('%Y-%m-%d %H:%M')} · 모드: {'dry-run' if args.dry_run else 'extract+load'}",
        f"\n## 요약\n- PDF {len(items)}건(중복 제외) / 재직자 대상 {len(targets)}건 / 제외 {len(excluded)}건 / 수집 스킵 {len(skipped)}건",
    ]

    if args.dry_run:
        rep.append("\n## 대상(재직자) 목록")
        rep += [f"- {t['rel']} [{t['kind']}]" for t in targets]
        rep.append("\n## 제외")
        rep += [f"- {x}" for x in excluded]
        REPORT_PATH.write_text("\n".join(rep), encoding="utf-8")
        print(f"리포트: {REPORT_PATH}")
        print(f"PDF {len(items)} / 대상 {len(targets)} / 제외 {len(excluded)}")
        return

    import ssl

    import anthropic
    import boto3

    # 로컬 PC는 Avast 가 TLS 를 가로채고, Python 3.13 은 기본 STRICT 검증이라
    # Avast 루트 인증서(Basic Constraints not critical)가 거부된다 → 완화(opendart 동일 사례).
    ctx = ssl.create_default_context()
    avast_pem = r"C:\ProgramData\Avast Software\Avast\wscert.pem"
    if os.path.exists(avast_pem):
        ctx.load_verify_locations(avast_pem)
    ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    client = anthropic.Anthropic(http_client=anthropic.DefaultHttpxClient(verify=ctx))
    s3 = boto3.Session(profile_name=os.environ.get("AWS_PROFILE", "mcm-kesi-staging")).client("s3")
    now = datetime.now().astimezone().isoformat()

    if args.limit:
        targets = targets[: args.limit]

    results, failed = [], []
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT contract_id, file_sha256 FROM labor_contracts WHERE source = 'imported'")
        existing = {sha: cid for cid, sha in cur.fetchall()}

        for i, it in enumerate(targets, 1):
            contract_id = "lc-" + it["sha"][:16]
            if it["sha"] in existing:
                print(f"[{i}/{len(targets)}] {it['rel']} — 기존 적재, 스킵")
                continue
            print(f"[{i}/{len(targets)}] {it['rel']} 추출 중...")
            pdf = it["path"].read_bytes()
            model_used = MODEL_PRIMARY
            try:
                data = extract_one(client, pdf, MODEL_PRIMARY)
                issues = verify(it, data)
                if issues:
                    # 저신뢰·불일치 → 상위 모델 재시도(문서 추출 아키텍처의 재분석 경로)
                    model_used = MODEL_RETRY
                    data2 = extract_one(client, pdf, MODEL_RETRY)
                    issues2 = verify(it, data2)
                    if len(issues2) < len(issues):
                        data, issues = data2, issues2
            except Exception as e:
                failed.append((it["rel"], str(e)[:200]))
                continue

            # 원본 S3 업로드
            safe_name = re.sub(r"[^\w가-힣().~-]+", "_", it["path"].name)
            key = f"employees/{it['fname_name']}/labor-contract/{it['sha'][:12]}-{safe_name}"
            s3.put_object(Bucket=S3_BUCKET, Key=key, Body=pdf, ContentType="application/pdf")

            cur.execute(
                """INSERT INTO labor_contracts
                     (contract_id, employee_id, kind, contract_date, effective_from, effective_to,
                      position_name, duty, first_hired_at, annual_salary, monthly_salary,
                      wage_components, work_hours, probation, source,
                      file_storage_provider, file_storage_bucket, file_storage_key, file_sha256,
                      status, extraction_meta, note, created_at, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,'imported',
                           's3',%s,%s,%s,'imported',%s::jsonb,%s,%s,%s)
                   ON CONFLICT (contract_id) DO NOTHING""",
                (
                    contract_id, it["employee_id"], it["kind"],
                    data.get("contract_date") or it["fname_date"],
                    data.get("effective_from"), data.get("effective_to"),
                    data.get("position") or it["fname_pos"], data.get("duty"),
                    data.get("first_hired_at"), data.get("annual_salary"), data.get("monthly_salary"),
                    json.dumps(data.get("wage_components") or {}, ensure_ascii=False),
                    json.dumps({"summary": data.get("work_hours")}, ensure_ascii=False),
                    1 if data.get("probation") else 0,
                    S3_BUCKET, key, it["sha"],
                    json.dumps({"model": model_used, "confidence": data.get("confidence"),
                                "source_file": it["rel"], "raw": data}, ensure_ascii=False),
                    "; ".join(verify(it, data)) or None,
                    now, now,
                ),
            )
            conn.commit()
            results.append((it, data, verify(it, data), model_used))

        # 일반/승진 태그 자동판정 — 사람별 시간순, 직전 계약 직급과 비교(§1-3)
        cur.execute(
            """SELECT contract_id, employee_id, contract_date, position_name, kind
                 FROM labor_contracts WHERE source = 'imported'
                ORDER BY employee_id, contract_date NULLS LAST"""
        )
        rows = cur.fetchall()
        prev: dict[str, int] = {}
        for cid, eid, cdate, pos, kind in rows:
            rank = ranks.get(pos or "", None)
            prev_rank = prev.get(eid)
            tag = "승진" if (kind == "promotion" or (prev_rank is not None and rank is not None and rank > prev_rank)) else "일반"
            cur.execute("UPDATE labor_contracts SET tag=%s WHERE contract_id=%s", (tag, cid))
            if rank is not None:
                prev[eid] = rank
        conn.commit()

    rep.append(f"\n## 추출 결과\n- 신규 적재 {len(results)}건 / 실패 {len(failed)}건")
    review = [(it, d, iss, m) for it, d, iss, m in results if iss]
    rep.append(f"- 검수 필요(불일치·저신뢰) {len(review)}건")
    if failed:
        rep.append("\n## 실패")
        rep += [f"- {r} — {e}" for r, e in failed]
    if review:
        rep.append("\n## 검수 필요 상세")
        for it, d, iss, m in review:
            rep.append(f"- {it['rel']} [{m}]: {'; '.join(iss)}")
    rep.append("\n## 제외")
    rep += [f"- {x}" for x in excluded]
    REPORT_PATH.write_text("\n".join(rep), encoding="utf-8")
    print(f"\n리포트: {REPORT_PATH}")
    print(f"적재 {len(results)} / 실패 {len(failed)} / 검수 필요 {len(review)}")


if __name__ == "__main__":
    main()
