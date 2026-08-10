"""
오피스·한글 문서 → PDF 변환 (LibreOffice headless)

전자결재 첨부서류를 결재자가 브라우저에서 그대로 확인할 수 있도록 PDF 로 변환한다.
지원: docx / xlsx / pptx / hwpx (hwpx 는 H2Orestart 확장이 설치된 경우에만).
변환 결과 캐시는 호출 측(Next.js)이 S3 에 보관하므로 여기서는 상태를 두지 않는다.

LibreOffice 는 프로필 디렉터리를 동시 점유하면 실패하므로 요청마다 임시 프로필을 쓴다
(-env:UserInstallation). 변환은 CPU 를 쓰는 동기 작업이라 호출 측에서 스레드로 돌린다.
"""
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

# 변환 가능한 확장자 — 프론트 화이트리스트(lib/approval/attachments.ts)와 맞춘다.
CONVERTIBLE_EXTS = {"hwpx", "docx", "xlsx", "pptx", "doc", "hwp", "odt", "ods", "odp", "rtf", "txt", "csv"}

# 변환 1건 상한(초) — 대용량 표·이미지 문서 대비. 초과하면 실패로 응답한다.
CONVERT_TIMEOUT_SEC = int(os.getenv("MCM_OFFICE_CONVERT_TIMEOUT", "120"))


class ConvertError(RuntimeError):
    """변환 실패 — 호출 측은 이 메시지를 그대로 사용자에게 보여준다."""


def soffice_path() -> str | None:
    """LibreOffice 실행 파일 경로(미설치면 None)."""
    env = os.getenv("MCM_SOFFICE_PATH")
    if env and Path(env).exists():
        return env
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    # Windows 개발 환경 기본 설치 경로
    for candidate in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def is_available() -> bool:
    return soffice_path() is not None


def convert_to_pdf(data: bytes, filename: str) -> bytes:
    """
    문서 바이트 → PDF 바이트. 실패 시 ConvertError.
    filename 은 확장자 판별용으로만 쓰며, 임시 디렉터리 안에서만 사용한다.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in CONVERTIBLE_EXTS:
        raise ConvertError(f"변환을 지원하지 않는 형식입니다: .{ext}")

    exe = soffice_path()
    if not exe:
        raise ConvertError("문서 변환기(LibreOffice)가 설치되어 있지 않습니다.")

    with tempfile.TemporaryDirectory(prefix="mcm-convert-") as tmp:
        tmp_dir = Path(tmp)
        # 원본 파일명은 신뢰하지 않는다 — 확장자만 살려 임의 이름으로 쓴다.
        src = tmp_dir / f"src.{ext}"
        src.write_bytes(data)
        out_dir = tmp_dir / "out"
        out_dir.mkdir()
        profile = tmp_dir / f"profile-{uuid.uuid4().hex[:8]}"

        cmd = [
            exe,
            f"-env:UserInstallation=file:///{profile.as_posix().lstrip('/')}",
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            "--nologo",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir),
            str(src),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=CONVERT_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            raise ConvertError("변환 시간이 초과되었습니다. 파일이 너무 크거나 복잡합니다.")

        produced = next(iter(out_dir.glob("*.pdf")), None)
        if produced is None:
            detail = (proc.stderr or proc.stdout or b"").decode("utf-8", "ignore").strip()
            hint = ""
            if ext in ("hwp", "hwpx"):
                hint = " (한글 문서 변환에는 H2Orestart 확장이 필요합니다)"
            raise ConvertError(f"변환에 실패했습니다{hint}. {detail[:300]}".strip())
        return produced.read_bytes()
