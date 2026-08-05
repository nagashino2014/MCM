# -*- coding: utf-8 -*-
"""
과거 발송 공문 백필 — V: 드라이브의 발신 공문을 MCM 공문 대장(official_letters)으로 이관한다.

  소스: V:\\업무자료\\각종보고양식\\대외공문 일람\\발신 공문\\{연도}\\({공문번호}){제목}\\ 폴더
        (일부는 연도 폴더 루트에 hwp/pdf 파일이 직접 있음 — 파일 단위도 스캔)
  파싱: 폴더/파일명에서 공문번호·제목, hwp 원문(olefile+zlib)에서 수신/참조/시행일/담당자를
        베스트에포트로 추출. 실패 필드는 빈 값 → 앱의 '발송공문' 탭 수신처 편집에서 사후 보완.
  업로드: POST {base}/api/letters/import (multipart) — 공문 hwp/pdf + 동봉 첨부 전체.
        letter_no UNIQUE 라 재실행 멱등(이미 등록된 번호는 skipped).

사용:
  (A) API 모드 — 앱 경유(권장, 운영 중 재실행):
      python scripts/import_letters.py --base-url https://koensain.app --cookie "authjs.session-token=..." [--year 2026] [--dry-run]
      세션 쿠키는 브라우저 개발자도구에서 복사(approval.manage 권한 계정).
  (B) direct 모드 — S3(boto3)+DB(psql) 직접 적재(초기 일괄 백필용, 세션 불필요):
      SSM 포트포워딩 터널(localhost:15432)과 PGPASSWORD 환경변수를 준비한 뒤
      AWS_PROFILE=mcm-kesi-staging python scripts/import_letters.py --direct --bucket mcm-ieps-staging-data [--year 2026]
"""

import argparse
import json
import re
import struct
import sys
import zlib
from pathlib import Path

# Windows 콘솔(cp949) 대비 — 출력 인코딩 고정
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import olefile
except ImportError:
    print("pip install olefile 후 실행하세요.")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("pip install requests 후 실행하세요.")
    sys.exit(1)

SOURCE_ROOT = Path(r"V:\업무자료\각종보고양식\대외공문 일람\발신 공문")
LETTER_NO_RE = re.compile(r"\((\d{4}-대외-\d+)\)\s*(.+?)$")

# ── hwp 텍스트 추출(HWP 5.x BodyText 레코드 파싱 — 세션 검증 완료 파서) ──


def extract_hwp_text(path: Path) -> list[str]:
    ole = olefile.OleFileIO(str(path))
    try:
        header = ole.openstream("FileHeader").read()
        compressed = bool(header[36] & 1)
        out: list[str] = []
        for entry in ole.listdir():
            if entry[0] != "BodyText":
                continue
            data = ole.openstream(entry).read()
            if compressed:
                data = zlib.decompress(data, -15)
            i = 0
            while i < len(data):
                hdr = struct.unpack("<I", data[i : i + 4])[0]
                tag = hdr & 0x3FF
                size = (hdr >> 20) & 0xFFF
                i += 4
                if size == 0xFFF:
                    size = struct.unpack("<I", data[i : i + 4])[0]
                    i += 4
                if tag == 67:  # PARA_TEXT
                    text = ""
                    j = 0
                    payload = data[i : i + size]
                    while j < len(payload) - 1:
                        ch = struct.unpack("<H", payload[j : j + 2])[0]
                        if ch in (10, 13):
                            text += "\n"
                            j += 2
                        elif ch < 32:
                            j += 16 if ch in (1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23) else 2
                        else:
                            text += chr(ch)
                            j += 2
                    out.append(text)
                i += size
        return out
    finally:
        ole.close()


LABEL_RE = re.compile(r"^\s*(수\s*신|참\s*조|발\s*신|시\s*행|담\s*당)\s*:\s*(.*)$")


def parse_letter_meta(hwp_path: Path) -> dict:
    """hwp 원문에서 수신/참조/시행일/담당/유형을 베스트에포트 파싱."""
    meta: dict = {"letterKind": "general", "recipients": [], "ccRefs": [], "issueDate": None, "drafterName": None}
    try:
        paras = extract_hwp_text(hwp_path)
    except Exception as e:  # noqa: BLE001
        print(f"    ! hwp 파싱 실패({e}) — 메타 없이 등록")
        return meta
    lines: list[str] = []
    for p in paras:
        lines.extend(p.split("\n"))
    saw_balsin = False
    for line in lines:
        m = LABEL_RE.match(line)
        if not m:
            continue
        label = re.sub(r"\s+", "", m.group(1))
        value = m.group(2).strip()
        if label == "발신":
            saw_balsin = True
            meta["letterKind"] = "proof"
        elif label == "수신" and value:
            # 일반형: 수신 = 기관명. 내용증명형(발신 등장 후)의 수신은 주소라 스킵.
            if not saw_balsin:
                meta["recipients"].append({"name": "", "facilityName": value, "email": ""})
        elif label == "참조" and value:
            # "발전운영실 발전운영그룹 김은지 사원" → 부서(앞) + 성명·직함(뒤 2토큰) 근사 분리
            toks = value.split()
            if len(toks) >= 2:
                meta["ccRefs"].append({
                    "name": toks[-2] if len(toks) >= 2 else value,
                    "title": toks[-1] if len(toks) >= 2 else "",
                    "deptName": " ".join(toks[:-2]),
                    "email": "",
                })
            else:
                meta["ccRefs"].append({"name": value, "email": ""})
        elif label == "시행":
            dm = re.search(r"\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\)", value)
            if dm:
                meta["issueDate"] = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
        elif label == "담당" and not meta["drafterName"]:
            # 하단 고정부 형식: "이 재 영 부장   대 표 이 사 : 이 유 억" — 앞쪽 성명만
            dm = re.match(r"((?:[가-힣]\s*){2,4}?)\s*(?:부장|차장|과장|대리|사원|팀장|이사|상무|전무)\b", value)
            if dm:
                name = re.sub(r"\s+", "", dm.group(1))
                if 2 <= len(name) <= 4:
                    meta["drafterName"] = name
    return meta


def find_letter_files(folder: Path, letter_no: str) -> tuple[Path | None, Path | None, list[Path]]:
    """폴더에서 공문 본체 hwp/pdf(파일명에 공문번호 포함)와 나머지 첨부를 분류."""
    hwp = pdf = None
    attach: list[Path] = []
    for f in sorted(folder.iterdir()):
        if not f.is_file() or f.name.startswith("~$") or f.suffix.lower() == ".bak":
            continue
        is_main = letter_no in f.name
        if is_main and f.suffix.lower() == ".hwp" and hwp is None:
            hwp = f
        elif is_main and f.suffix.lower() == ".pdf" and pdf is None:
            pdf = f
        else:
            attach.append(f)
    return hwp, pdf, attach


def iter_letters(root: Path, year_filter: str | None):
    """연도 폴더를 순회하며 (letter_no, title, hwp, pdf, attach[]) 를 산출."""
    for year_dir in sorted(root.iterdir()):
        if not year_dir.is_dir():
            continue
        if year_filter and year_dir.name != year_filter:
            continue
        seen: set[str] = set()
        for entry in sorted(year_dir.iterdir()):
            m = LETTER_NO_RE.match(entry.name if entry.is_dir() else entry.stem)
            if not m:
                continue
            letter_no, title = m.group(1), m.group(2).strip()
            if entry.is_dir():
                hwp, pdf, attach = find_letter_files(entry, letter_no)
            else:
                if letter_no in seen:
                    continue
                # 루트 산재 파일 — 같은 번호의 hwp/pdf 짝을 조합
                hwp = entry if entry.suffix.lower() == ".hwp" else None
                pdf = entry if entry.suffix.lower() == ".pdf" else None
                sibling = entry.with_suffix(".pdf" if hwp else ".hwp")
                if sibling.exists():
                    if hwp is None:
                        hwp = sibling
                    else:
                        pdf = sibling
                attach = []
            if letter_no in seen:
                print(f"  ⚠ 중복 공문번호 스킵(원본 정리 필요): {letter_no} — {entry.name}")
                continue
            seen.add(letter_no)
            yield letter_no, title, hwp, pdf, attach


PATH_UNSAFE_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def sanitize_segment(value: str) -> str:
    """frontend sanitizeFilename 과 동일 규칙(NFKC + 경로 불용문자 → _)."""
    import unicodedata

    v = unicodedata.normalize("NFKC", value or "")
    v = PATH_UNSAFE_RE.sub("_", v).strip()
    return re.sub(r"\s+", " ", v)[:200]


class DirectSink:
    """direct 모드 — S3 업로드(boto3) + official_letters INSERT(psql, letter_no 멱등)."""

    CONTENT_TYPES = {".hwp": "application/x-hwp", ".hwpx": "application/vnd.hancom.hwpx", ".pdf": "application/pdf"}

    def __init__(self, bucket: str, pg_conn: str):
        import boto3  # noqa: PLC0415

        self.s3 = boto3.client("s3")
        self.bucket = bucket
        self.pg_conn = pg_conn

    def upload(self, path: Path, prefix: str) -> dict:
        name = sanitize_segment(path.name)
        key = f"{prefix}/{name}"
        self.s3.upload_file(
            str(path), self.bucket, key,
            ExtraArgs={"ContentType": self.CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream"), "CacheControl": "private, max-age=86400"},
        )
        return {"name": name, "key": key}

    def insert(self, meta: dict, pdf_key: str | None, hwp_key: str | None, attach_keys: list[dict]) -> bool:
        import subprocess
        import tempfile
        import uuid

        def q(v) -> str:
            if v is None:
                return "NULL"
            return "'" + str(v).replace("'", "''") + "'"

        now = __import__("datetime").datetime.now().isoformat()
        letter_id = "ltr-" + uuid.uuid4().hex[:14]
        year = re.match(r"^(\d{4})", meta["letterNo"]).group(1)
        sql = (
            "INSERT INTO official_letters (letter_id, doc_id, source, letter_no, year, title, letter_kind, "
            "recipients, cc_refs, drafter_name, issue_date, pdf_key, hwp_key, attach_keys, send_status, created_at, updated_at) VALUES ("
            f"{q(letter_id)}, NULL, 'imported', {q(meta['letterNo'])}, {q(year)}, {q(meta['title'])}, {q(meta.get('letterKind') or 'general')}, "
            f"{q(json.dumps(meta.get('recipients') or [], ensure_ascii=False))}::jsonb, "
            f"{q(json.dumps(meta.get('ccRefs') or [], ensure_ascii=False))}::jsonb, "
            f"{q(meta.get('drafterName'))}, {q(meta.get('issueDate'))}, {q(pdf_key)}, {q(hwp_key)}, "
            f"{q(json.dumps(attach_keys, ensure_ascii=False))}::jsonb, 'archived', {q(now)}, {q(now)}) "
            "ON CONFLICT (letter_no) DO NOTHING RETURNING letter_id;"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
            f.write(sql)
            sql_path = f.name
        try:
            out = subprocess.run(
                ["psql", self.pg_conn, "-t", "-q", "-v", "ON_ERROR_STOP=1", "-f", sql_path],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env={**__import__("os").environ, "PGCLIENTENCODING": "UTF8"},
            )
            if out.returncode != 0:
                raise RuntimeError(out.stderr.strip()[:300])
            # RETURNING 행(ltr- id) 존재 = 신규 insert. -q 없이는 명령 태그(INSERT 0 0)가
            # stdout 에 섞여 충돌 스킵도 신규로 오판된다.
            return "ltr-" in out.stdout
        finally:
            Path(sql_path).unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=None, help="API 모드: 예 https://koensain.app")
    ap.add_argument("--cookie", default=None, help="API 모드: 로그인 세션 쿠키(approval.manage 권한)")
    ap.add_argument("--direct", action="store_true", help="direct 모드: S3+DB 직접 적재(세션 불필요)")
    ap.add_argument("--bucket", default="mcm-ieps-staging-data", help="direct 모드 S3 버킷")
    ap.add_argument("--pg-conn", default="host=localhost port=15432 dbname=mcm user=mcm sslmode=require", help="direct 모드 psql 접속 문자열(PGPASSWORD 는 env)")
    ap.add_argument("--year", default=None, help="특정 연도 폴더만(예: 2026)")
    ap.add_argument("--dry-run", action="store_true", help="업로드 없이 파싱 결과만 출력")
    ap.add_argument("--max-attach-mb", type=float, default=50.0, help="첨부 1건 용량 상한(초과 시 제외, 기본 50MB)")
    args = ap.parse_args()

    if not SOURCE_ROOT.exists():
        print(f"소스 경로가 없습니다: {SOURCE_ROOT}")
        sys.exit(1)
    if not args.dry_run and not args.direct and not (args.base_url and args.cookie):
        print("API 모드는 --base-url·--cookie 가 필요합니다(또는 --direct / --dry-run).")
        sys.exit(1)

    sink = DirectSink(args.bucket, args.pg_conn) if args.direct and not args.dry_run else None
    session = None
    if not args.direct and not args.dry_run:
        session = requests.Session()
        session.headers["Cookie"] = args.cookie

    total = ok = skipped = failed = 0
    for letter_no, title, hwp, pdf, attach in iter_letters(SOURCE_ROOT, args.year):
        total += 1
        print(f"[{letter_no}] {title}")
        meta = parse_letter_meta(hwp) if hwp else {"letterKind": "general", "recipients": [], "ccRefs": [], "issueDate": None, "drafterName": None}
        meta.update({"letterNo": letter_no, "title": title})
        print(f"    수신 {len(meta['recipients'])} · 참조 {len(meta['ccRefs'])} · 시행 {meta['issueDate']} · 담당 {meta['drafterName']} · {meta['letterKind']}")
        if args.dry_run:
            continue

        if sink:
            # direct 모드 — S3 업로드 후 DB insert(멱등)
            try:
                prefix = f"letters/{letter_no[:4]}/{sanitize_segment(letter_no)}"
                hwp_up = sink.upload(hwp, prefix) if hwp else None
                pdf_up = sink.upload(pdf, prefix) if pdf else None
                attach_ups = []
                for a in attach:
                    if a.stat().st_size > args.max_attach_mb * 1024 * 1024:
                        print(f"    ! 첨부 용량 초과 제외: {a.name}")
                        continue
                    attach_ups.append(sink.upload(a, prefix))
                inserted = sink.insert(meta, pdf_up["key"] if pdf_up else None, hwp_up["key"] if hwp_up else None, attach_ups)
                if inserted:
                    ok += 1
                    print(f"    → 등록 완료 (첨부 {len(attach_ups)}건)")
                else:
                    skipped += 1
                    print("    → 스킵(이미 등록됨)")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"    ✗ 실패: {e}")
            continue

        files = []
        opened = []
        try:
            if hwp:
                fh = open(hwp, "rb")
                opened.append(fh)
                files.append(("hwp", (hwp.name, fh, "application/x-hwp")))
            if pdf:
                fh = open(pdf, "rb")
                opened.append(fh)
                files.append(("pdf", (pdf.name, fh, "application/pdf")))
            for a in attach:
                if a.stat().st_size > args.max_attach_mb * 1024 * 1024:
                    print(f"    ! 첨부 용량 초과 제외: {a.name}")
                    continue
                fh = open(a, "rb")
                opened.append(fh)
                files.append(("attach", (a.name, fh, "application/octet-stream")))
            res = session.post(
                args.base_url.rstrip("/") + "/api/letters/import",
                data={"meta": json.dumps(meta, ensure_ascii=False)},
                files=files,
                timeout=300,
            )
            body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
            if res.status_code == 200 and body.get("skipped"):
                skipped += 1
                print("    → 스킵(이미 등록됨)")
            elif res.status_code == 200:
                ok += 1
                print(f"    → 등록 완료 (첨부 {body.get('files', {}).get('attachCount', 0)}건)")
            else:
                failed += 1
                print(f"    ✗ 실패 {res.status_code}: {body.get('error') or res.text[:200]}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"    ✗ 예외: {e}")
        finally:
            for fh in opened:
                fh.close()

    print(f"\n완료 — 대상 {total} · 등록 {ok} · 스킵 {skipped} · 실패 {failed}")
    if not args.dry_run:
        print("수신처 메일주소는 원본에 없으므로 앱 '양식별 문서 조회 > 발송공문' 탭의 수신처 편집에서 보완하세요.")


if __name__ == "__main__":
    main()
