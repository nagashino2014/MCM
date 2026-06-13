"""Pre-download OCR models used by the business certificate ensemble.

This runs during Docker build so production requests do not spend their first
OCR call downloading EasyOCR/PaddleOCR models.
"""

from __future__ import annotations

import os
import ssl
from pathlib import Path


def _allow_insecure_model_downloads() -> None:
    """Allow model downloads in build networks with missing custom CA roots."""
    if os.getenv("MCM_ALLOW_INSECURE_OCR_MODEL_DOWNLOAD") != "1":
        return

    ssl._create_default_https_context = ssl._create_unverified_context

    try:
        import urllib3  # type: ignore

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass

    try:
        import requests  # type: ignore

        original_request = requests.sessions.Session.request

        def request_without_verify(self, method, url, **kwargs):  # type: ignore[no-untyped-def]
            kwargs.setdefault("verify", False)
            return original_request(self, method, url, **kwargs)

        requests.sessions.Session.request = request_without_verify
    except Exception:
        pass


def _preload_easyocr() -> None:
    import easyocr  # type: ignore

    model_dir = Path(os.getenv("MCM_EASYOCR_MODEL_DIR", "/app/ocr-models/easyocr"))
    model_dir.mkdir(parents=True, exist_ok=True)
    easyocr.Reader(
        ["ko", "en"],
        gpu=False,
        model_storage_directory=str(model_dir),
        download_enabled=True,
    )
    print(f"[OCR MODEL PRELOAD] EasyOCR models ready: {model_dir}")


def _preload_paddleocr() -> None:
    from paddleocr import PaddleOCR  # type: ignore

    PaddleOCR(
        use_angle_cls=True,
        lang="korean",
        ocr_version=os.getenv("MCM_PADDLEOCR_VERSION", "PP-OCRv3"),
        show_log=False,
    )
    print("[OCR MODEL PRELOAD] PaddleOCR models ready")


def main() -> None:
    _allow_insecure_model_downloads()
    _preload_easyocr()
    _preload_paddleocr()


if __name__ == "__main__":
    main()
