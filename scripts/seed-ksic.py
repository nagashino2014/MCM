"""KSIC 11차 5자리 세세분류표를 data/ksic/ksic11.json 으로 시드한다.

사용법:
    python scripts/seed-ksic.py
    python scripts/seed-ksic.py --zip path/to/11th.zip
    python scripts/seed-ksic.py --xlsx path/to/KSIC_11th.xlsx

동작:
    1) (기본) https://github.com/urbanjj/KSIC (GPL-3.0) 의 data-raw/11th.zip 을 다운로드.
       사내 프록시/SSL 환경에서 다운로드가 실패하면 미리 받아둔 파일을 --zip / --xlsx 로 전달.
    2) zip 안의 KSIC_11th.xlsx (통계청 제11차 분류표 가공본) 에서 5자리 세세분류만 추출
    3) [{"code": "01110", "name": "곡물 및 기타 식량작물 재배업", "name_eng": "..."}, ...]
       형식의 JSON 으로 data/ksic/ksic11.json 에 저장

이 스크립트는 1회성 시드 용도이며, 산출 JSON 만 git 으로 추적한다. 외부 의존성은
표준 라이브러리 + openpyxl(이미 backend/requirements.txt 에 포함) 만 사용한다.

데이터 출처:
    - 통계청 KSIC 제11차(2024.7 시행) 세세분류표
    - GitHub: urbanjj/KSIC (GPL-3.0). 통계분류포털(kssc.kostat.go.kr) 원자료를 가공한 사본.
"""
from __future__ import annotations

import argparse
import io
import json
import ssl
import sys
import urllib.request
import zipfile
from pathlib import Path

import openpyxl

ZIP_URL = "https://raw.githubusercontent.com/urbanjj/KSIC/main/data-raw/11th.zip"
EXCEL_NAME_IN_ZIP = "11th/KSIC_11th.xlsx"
ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "ksic" / "ksic11.json"


def _download_zip(url: str, insecure: bool = False) -> bytes:
    print(f"[seed-ksic] downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "MCM-seed-ksic/1.0"})
    ctx = ssl._create_unverified_context() if insecure else None
    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
        return resp.read()


def _extract_excel(zip_bytes: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        # zip 내부 경로가 OS/패키저에 따라 / 또는 \ 로 들어올 수 있어 normalize 후 매칭.
        target = EXCEL_NAME_IN_ZIP.replace("\\", "/")
        for name in zf.namelist():
            if name.replace("\\", "/") == target:
                return zf.read(name)
        raise FileNotFoundError(
            f"{target} not in archive. found={zf.namelist()}"
        )


def _parse_5digit_rows(xlsx_bytes: bytes) -> list[dict[str, str]]:
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    ws = wb.active
    items: list[dict[str, str]] = []
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        code = row[0]
        if code is None:
            continue
        s = str(code).strip()
        if not (s.isdigit() and len(s) == 5):
            continue
        name_kr = (row[1] or "").strip() if len(row) > 1 else ""
        name_en = (row[2] or "").strip() if len(row) > 2 else ""
        items.append({"code": s, "name": name_kr, "name_eng": name_en})
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", dest="zip_path", help="로컬 11th.zip 경로 (네트워크 없이 시드)")
    parser.add_argument("--xlsx", dest="xlsx_path", help="로컬 KSIC_11th.xlsx 직접 지정")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="HTTPS 인증서 검증 무시 (사내 프록시 환경 폴백). 다운로드 실패 시 자동 재시도에도 사용됨.",
    )
    args = parser.parse_args()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    xlsx_bytes: bytes
    if args.xlsx_path:
        xlsx_bytes = Path(args.xlsx_path).read_bytes()
    else:
        if args.zip_path:
            zip_bytes = Path(args.zip_path).read_bytes()
        else:
            try:
                zip_bytes = _download_zip(ZIP_URL, insecure=args.insecure)
            except Exception as exc:
                # 일부 Windows 환경에서 시스템 CA 체인이 깨져 있어 SSL 검증이 실패하는 경우
                # 한 번 더 검증 우회로 재시도한다(GPL-3.0 공개 자료라 무결성 위험 낮음).
                print(f"[seed-ksic] download failed ({exc}); retrying insecure", file=sys.stderr)
                try:
                    zip_bytes = _download_zip(ZIP_URL, insecure=True)
                except Exception as exc2:
                    print(f"[seed-ksic] download failed: {exc2}", file=sys.stderr)
                    return 1
        xlsx_bytes = _extract_excel(zip_bytes)

    items = _parse_5digit_rows(xlsx_bytes)
    if len(items) < 1000:
        print(f"[seed-ksic] suspicious count: {len(items)}", file=sys.stderr)
        return 2
    OUT_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[seed-ksic] wrote {len(items)} entries → {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
