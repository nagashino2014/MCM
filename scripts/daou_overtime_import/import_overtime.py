# -*- coding: utf-8 -*-
"""
다우오피스 초과근무 신청 → MCM 전자결재 문서(frm-overtime-request) 적재.

parse_overtime.py 로 추출한 신청 내역을 approval_docs/approval_steps 에 넣어
급여대장 초과근무수당 산정을 '신청 × 근태' 대조로 검증할 수 있게 한다.

멱등: doc_id = ovt-daou-<다우문서ID>. 재실행 시 UPDATE.
사용: python import_overtime.py [--apply]   (기본 dry-run)
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import psycopg  # noqa: E402
from parse_overtime import DOCS_DIR, SERVICE_CLASS_MAP, hours_between, load_targets, parse_doc  # noqa: E402

FORM_ID = "frm-overtime-request"


def db_conn():
    pw = open(os.path.expandvars(r"%TEMP%\pl_pgpass.txt"), encoding="utf-8-sig").read().strip()
    return psycopg.connect(f"postgresql://mcm:{pw}@localhost:15432/mcm?sslmode=require")


def approver_of(detail: dict, drafter_name: str | None) -> tuple[str | None, str | None]:
    """다우 결재선에서 승인자(기안자 제외 첫 COMPLETE) 이름·완료시각."""
    flow = (detail.get("data") or {}).get("apprFlow") or {}
    for g in flow.get("activityGroups") or []:
        for a in g.get("activities") or []:
            name = a.get("userName")
            if not name or name == drafter_name:
                continue
            if a.get("status") == "COMPLETE":
                return name, a.get("completedAt")
    return None, None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--from", dest="date_from", default="2026-04-26")
    ap.add_argument("--to", dest="date_to", default="2026-05-27")
    ap.add_argument("--work-from", dest="work_from", default="2026-04-26")
    ap.add_argument("--work-to", dest="work_to", default="2026-05-25")
    args = ap.parse_args()

    docs = load_targets(args.date_from, args.date_to)
    with db_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT version FROM approval_forms WHERE form_id=%s", [FORM_ID])
        form_version = int(cur.fetchone()[0])
        cur.execute(
            """SELECT p.name, p.employee_id, p.dept_id, d.dept_name, pos.position_name, u.user_id
                 FROM employee_profiles p
                 LEFT JOIN departments d ON d.dept_id = p.dept_id
                 LEFT JOIN positions pos ON pos.position_id = p.position_id
                 LEFT JOIN users u ON u.employee_id = p.employee_id OR u.user_id = p.user_id"""
        )
        people: dict[str, dict] = {}
        for name, emp_id, dept_id, dept_name, position, user_id in cur.fetchall():
            cur_rec = people.get(name)
            if cur_rec and cur_rec.get("user_id") and not user_id:
                continue
            people[name] = {
                "employee_id": emp_id, "dept_id": dept_id, "dept_name": dept_name,
                "position": position, "user_id": user_id,
            }

        rows, skipped = [], []
        for d in docs:
            did = d["documentId"]
            path = os.path.join(DOCS_DIR, did, "detail.json")
            if not os.path.isfile(path):
                skipped.append((d.get("docNum"), "detail 없음"))
                continue
            detail = json.load(open(path, encoding="utf-8"))
            document = (detail.get("data") or {}).get("document") or {}
            p = parse_doc(document.get("docBodyContent") or "")
            start = p.get("startDate")
            if not start or not (args.work_from <= start <= args.work_to):
                continue  # 근무일 귀속 기간 밖
            name = d.get("drafterName") or p.get("applicantName")
            emp = people.get(name or "")
            if not emp or not emp.get("user_id"):
                skipped.append((d.get("docNum"), f"직원/계정 미매칭: {name}"))
                continue
            appr_name, appr_at = approver_of(detail, name)
            appr = people.get(appr_name or "")
            hours = hours_between(p.get("timeStart"), p.get("timeEnd"))
            rows.append({
                "doc_id": f"ovt-daou-{did}",
                "doc_no": p.get("docNum") if (p.get("docNum") or "").startswith("2026-") else d.get("docNum"),
                "title": d.get("title") or p.get("projectName") or "초과근무 신청",
                "status": "rejected" if d.get("docStatus") == "RETURN" else "approved",
                "drafter": name, "emp": emp,
                "appr_name": appr_name, "appr": appr, "appr_at": appr_at,
                "submitted_at": d.get("draftedAt"),
                "completed_at": d.get("latestActivityCompletedAt") or appr_at,
                "field_values": {
                    "field_9": {"title": p.get("projectName") or d.get("title") or "", "manual": True},
                    "company_name": {"name": p.get("companyName") or "", "manual": True},
                    "service_class": SERVICE_CLASS_MAP.get((p.get("serviceClass") or "").strip(), "기타"),
                    "work_period": {"from": start, "to": p.get("endDate") or start},
                    "work_time": {"start": p.get("timeStart"), "end": p.get("timeEnd")},
                    "apply_hours": hours,
                    "reason": p.get("reason") or "",
                },
                "hours": hours,
                "work_date": start,
            })

        print(f"적재 대상 {len(rows)}건 · 스킵 {len(skipped)}건")
        for s in skipped:
            print("  스킵:", s)
        by_person: dict[str, float] = {}
        for r in rows:
            by_person[r["drafter"]] = round(by_person.get(r["drafter"], 0) + (r["hours"] or 0), 2)
        print("인원별:", json.dumps(by_person, ensure_ascii=False))
        print("승인자 매칭 실패:", [r["doc_no"] for r in rows if r["appr_name"] and not r["appr"]][:5])

        if not args.apply:
            print("\n(dry-run) --apply 로 실제 적재")
            return

        now = datetime.now(timezone.utc).isoformat()
        for r in rows:
            emp = r["emp"]
            cur.execute(
                """INSERT INTO approval_docs
                     (doc_id, doc_no, form_id, form_version, title, urgent, status,
                      drafter_user_id, drafter_employee_id, drafter_name, drafter_position,
                      dept_id, dept_name, field_values, submitted_at, completed_at, created_at, updated_at)
                   VALUES (%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
                   ON CONFLICT (doc_id) DO UPDATE SET
                     field_values = EXCLUDED.field_values, status = EXCLUDED.status,
                     title = EXCLUDED.title, updated_at = EXCLUDED.updated_at""",
                [
                    r["doc_id"], r["doc_no"], FORM_ID, form_version, r["title"], r["status"],
                    emp["user_id"], emp["employee_id"], r["drafter"], emp["position"],
                    emp["dept_id"], emp["dept_name"], json.dumps(r["field_values"], ensure_ascii=False),
                    r["submitted_at"], r["completed_at"], now, now,
                ],
            )
            cur.execute("DELETE FROM approval_steps WHERE doc_id=%s", [r["doc_id"]])
            if r["appr"] and r["appr"].get("user_id"):
                cur.execute(
                    """INSERT INTO approval_steps
                         (step_id, doc_id, step_order, step_type, mode, assignee_user_id, assignee_name,
                          assignee_position, status, acted_at, created_at, activated_at)
                       VALUES (%s,%s,1,'approve','single',%s,%s,%s,%s,%s,%s,%s)""",
                    [
                        f"{r['doc_id']}-s1", r["doc_id"], r["appr"]["user_id"], r["appr_name"],
                        r["appr"].get("position"),
                        "rejected" if r["status"] == "rejected" else "approved",
                        r["appr_at"], now, r["submitted_at"],
                    ],
                )
        conn.commit()
        cur.execute("SELECT count(*) FROM approval_docs WHERE form_id=%s AND doc_id LIKE 'ovt-daou-%%'", [FORM_ID])
        print("적재 완료. 총 문서:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
