"""Common document OCR candidate generation.

This module keeps OCR engine outputs as candidates instead of collapsing them
into a single winner. Downstream callers can vote per field, line, table, or
layout block depending on the document type.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import asdict, dataclass, field
from concurrent.futures import TimeoutError, ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None  # type: ignore

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover
    np = None  # type: ignore

from .business_certificate_ocr import (
    _business_certificate_text_score,
    _easyocr_ocr,
    _enhance_variants,
    _paddle_ocr,
    _render_page_gray,
    _score_text,
    _tesseract_available,
    _tesseract_ocr,
)


@dataclass
class OcrCandidate:
    engine: str
    text: str
    page_index: int = 0
    variant: Optional[str] = None
    confidence: float = 0.0
    score: int = 0
    elapsed_ms: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DocumentOcrResult:
    text: str
    method: str
    quality_score: float
    page_count: int
    candidates: List[OcrCandidate]
    warning: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "method": self.method,
            "quality_score": self.quality_score,
            "page_count": self.page_count,
            "candidates": [asdict(candidate) for candidate in self.candidates],
            "warning": self.warning,
        }


def extract_document_ocr_candidates(
    pdf_bytes: bytes,
    filename: Optional[str] = None,
    *,
    max_pages: int = 1,
    include_vlm: bool = True,
    engines: Optional[List[str]] = None,
    prefer_text_layer: bool = False,
    tesseract_mode: str = "full",
) -> DocumentOcrResult:
    started = time.time()
    candidates: List[OcrCandidate] = []
    requested_engines = _normalize_engines(engines)

    if fitz is None or np is None:
        return DocumentOcrResult(
            text="",
            method="none",
            quality_score=0.0,
            page_count=0,
            candidates=[],
            warning="OCR 의존 라이브러리(PyMuPDF/numpy)가 설치되지 않았습니다.",
        )

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        return DocumentOcrResult(
            text="",
            method="none",
            quality_score=0.0,
            page_count=0,
            candidates=[],
            warning=f"PDF 열기 실패: {exc}",
        )

    try:
        page_count = min(doc.page_count, max_pages)
        for page_index in range(page_count):
            page = doc.load_page(page_index)
            layer_text = ""
            try:
                layer_text = page.get_text("text") or ""
            except Exception:
                layer_text = ""
            _append_candidate(candidates, "text_layer", layer_text, page_index, None, 0)
            if prefer_text_layer and _is_sufficient_business_certificate_text(layer_text):
                print(
                    f"[DOCUMENT OCR] file={filename or '-'} page={page_index + 1} "
                    "text_layer_fast_path=true"
                )
                continue

            gray = _render_page_gray(page)
            if gray is None:
                continue

            variants = _enhance_variants(gray)
            candidates.extend(
                _run_parallel_engine_candidates(
                    variants,
                    page_index,
                    pdf_bytes=pdf_bytes,
                    filename=filename,
                    include_vlm=include_vlm,
                    requested_engines=requested_engines,
                )
            )

            if _should_run_tesseract(requested_engines, tesseract_mode, candidates) and _tesseract_available():
                candidates.extend(_run_tesseract_candidates(variants, page_index, _effective_tesseract_mode(tesseract_mode)))
    finally:
        try:
            doc.close()
        except Exception:
            pass

    ordered = sorted(candidates, key=lambda item: item.score, reverse=True)
    best = ordered[0] if ordered else None
    text = best.text if best else ""
    score = _score_text(text)
    method = "+".join(sorted({candidate.engine for candidate in candidates})) if candidates else "none"
    warning = None if text else "OCR 결과가 비어 있습니다. 스캔 화질이 매우 낮을 수 있어 수동 입력이 필요합니다."

    elapsed_ms = _elapsed_ms(started)
    print(
        f"[DOCUMENT OCR] file={filename or '-'} pages={max_pages} candidates={len(candidates)} "
        f"best={best.engine if best else 'none'} score={best.score if best else 0} {elapsed_ms}ms"
    )

    return DocumentOcrResult(
        text=text,
        method=method,
        quality_score=max(0.0, min(1.0, score / 60.0)),
        page_count=max_pages,
        candidates=ordered,
        warning=warning,
    )


def _append_candidate(
    candidates: List[OcrCandidate],
    engine: str,
    text: str,
    page_index: int,
    variant: Optional[str],
    elapsed_ms: int,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    clean_text = (text or "").strip()
    if not clean_text:
        return
    score = _business_certificate_text_score(clean_text)
    candidates.append(
        OcrCandidate(
            engine=engine,
            text=clean_text,
            page_index=page_index,
            variant=variant,
            confidence=max(0.0, min(1.0, score / 800.0)),
            score=score,
            elapsed_ms=elapsed_ms,
            metadata=metadata or {},
        )
    )


def _run_tesseract_candidates(variants: List[Any], page_index: int, mode: str = "full") -> List[OcrCandidate]:
    candidates: List[OcrCandidate] = []
    max_workers = max(1, min(4, int(os.getenv("MCM_TESSERACT_WORKERS", "3"))))
    selected_variants = _select_tesseract_variants(variants, mode)
    psms = _select_tesseract_psms(mode)
    jobs = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for variant_label, img in selected_variants:
            for psm in psms:
                jobs.append((variant_label, psm, executor.submit(_run_tesseract_one, img, psm)))
        for variant_label, psm, future in jobs:
            text, elapsed_ms = future.result()
            _append_candidate(candidates, "tesseract", text, page_index, variant_label, elapsed_ms, {"psm": psm})
    return candidates


def _run_parallel_engine_candidates(
    variants: List[Any],
    page_index: int,
    *,
    pdf_bytes: bytes,
    filename: Optional[str],
    include_vlm: bool,
    requested_engines: set[str],
) -> List[OcrCandidate]:
    candidates: List[OcrCandidate] = []
    jobs: Dict[Any, str] = {}
    max_workers = max(1, min(3, int(os.getenv("MCM_NON_TESSERACT_WORKERS", "3"))))
    total_timeout = max(1.0, float(os.getenv("MCM_OCR_ENSEMBLE_TIMEOUT", "60")))
    executor = ThreadPoolExecutor(max_workers=max_workers)
    try:
        if "easyocr" in requested_engines:
            jobs[executor.submit(_run_easyocr_candidate, variants, page_index)] = "easyocr"
        if "paddleocr" in requested_engines:
            jobs[executor.submit(_run_paddleocr_candidate, variants, page_index)] = "paddleocr"
        if include_vlm and "vlm" in requested_engines:
            jobs[executor.submit(_call_vlm_ocr, pdf_bytes, filename, page_index)] = "vlm"

        completed = set()
        try:
            completed_iter = as_completed(jobs, timeout=total_timeout)
            for future in completed_iter:
                engine = jobs[future]
                completed.add(future)
                started = time.time()
                try:
                    candidate = future.result(timeout=0)
                except Exception as exc:
                    print(f"[DOCUMENT OCR] {engine} failed: {exc}")
                    continue
                if candidate:
                    candidates.append(candidate)
                elapsed = time.time() - started
                if elapsed > 1.0:
                    print(f"[DOCUMENT OCR] {engine} result collection delayed {elapsed:.1f}s")
        except TimeoutError:
            pass

        for future, engine in jobs.items():
            if future not in completed:
                print(f"[DOCUMENT OCR] {engine} timeout within ensemble budget {total_timeout}s")
                future.cancel()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    return candidates


def _run_easyocr_candidate(variants: List[Any], page_index: int) -> Optional[OcrCandidate]:
    engine_started = time.time()
    easy_text = _easyocr_ocr(variants)
    if easy_text is None:
        return None
    return _candidate_from_text("easyocr", easy_text, page_index, "best", _elapsed_ms(engine_started))


def _run_paddleocr_candidate(variants: List[Any], page_index: int) -> Optional[OcrCandidate]:
    engine_started = time.time()
    paddle_text = _paddle_ocr(variants)
    if paddle_text is None:
        return None
    return _candidate_from_text("paddleocr", paddle_text, page_index, "best", _elapsed_ms(engine_started))


def _candidate_from_text(
    engine: str,
    text: str,
    page_index: int,
    variant: Optional[str],
    elapsed_ms: int,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[OcrCandidate]:
    clean_text = (text or "").strip()
    if not clean_text:
        return None
    score = _business_certificate_text_score(clean_text)
    return OcrCandidate(
        engine=engine,
        text=clean_text,
        page_index=page_index,
        variant=variant,
        confidence=max(0.0, min(1.0, score / 800.0)),
        score=score,
        elapsed_ms=elapsed_ms,
        metadata=metadata or {},
    )


def _engine_timeout(engine: str) -> float:
    key = f"MCM_{engine.upper()}_TIMEOUT"
    default = {
        "easyocr": "60",
        "paddleocr": "60",
        "vlm": os.getenv("MCM_VLM_OCR_TIMEOUT", "45"),
    }.get(engine, "25")
    return max(1.0, float(os.getenv(key, default)))


def _should_run_tesseract(requested_engines: set[str], mode: str, candidates: List[OcrCandidate]) -> bool:
    if "tesseract" not in requested_engines:
        return False
    normalized = (mode or "").lower()
    if normalized == "disabled":
        return False
    if normalized != "fallback":
        return True
    threshold = int(os.getenv("MCM_TESSERACT_FALLBACK_SCORE", "650"))
    best_score = max((candidate.score for candidate in candidates), default=0)
    return best_score < threshold


def _effective_tesseract_mode(mode: str) -> str:
    return "quick" if (mode or "").lower() == "fallback" else mode


def _select_tesseract_variants(variants: List[Any], mode: str) -> List[Any]:
    if mode != "quick":
        return variants
    preferred_labels = [
        label.strip()
        for label in os.getenv("MCM_TESSERACT_QUICK_VARIANTS", "adaptive,sharpened,otsu").split(",")
        if label.strip()
    ]
    selected = [item for item in variants if str(item[0]) in preferred_labels]
    return (selected or variants)[: max(1, int(os.getenv("MCM_TESSERACT_QUICK_VARIANT_LIMIT", "3")))]


def _select_tesseract_psms(mode: str) -> tuple[int, ...]:
    if mode != "quick":
        return (4, 6, 3)
    raw = os.getenv("MCM_TESSERACT_QUICK_PSMS", "6,4")
    psms = tuple(int(item) for item in raw.split(",") if item.strip().isdigit())
    return psms or (6,)


def _run_tesseract_one(img: Any, psm: int) -> tuple[str, int]:
    started = time.time()
    return _tesseract_ocr(img, psm), _elapsed_ms(started)


def _normalize_engines(engines: Optional[List[str]]) -> set[str]:
    values = engines or ["tesseract", "easyocr", "paddleocr", "vlm"]
    return {value.strip().lower() for value in values if value.strip()}


def _is_sufficient_business_certificate_text(text: str) -> bool:
    clean_text = (text or "").strip()
    if not clean_text:
        return False
    score = _business_certificate_text_score(clean_text)
    required_score = int(os.getenv("MCM_BIZCERT_TEXT_LAYER_FAST_SCORE", "700"))
    compact_text = re.sub(r"\s+", "", clean_text)
    required_labels = (
        "등록번호",
        "법인명",
        "상호",
        "사업장소재지",
        "소재지",
        "사업의종류",
        "법인등록번호",
    )
    label_hits = sum(1 for label in required_labels if label in compact_text)
    return score >= required_score and label_hits >= 4


def _call_vlm_ocr(pdf_bytes: bytes, filename: Optional[str], page_index: int) -> Optional[OcrCandidate]:
    url = os.getenv("MCM_VLM_OCR_URL")
    if not url:
        return None
    started = time.time()
    try:
        import httpx  # type: ignore

        files = {"file": (filename or "document.pdf", pdf_bytes, "application/pdf")}
        data = {
            "page_index": str(page_index),
            "mode": "document_ocr",
            "prompt": (
                "Extract Korean document text, layout blocks, and tables. "
                "Preserve business registration certificate fields when present."
            ),
        }
        with httpx.Client(timeout=float(os.getenv("MCM_VLM_OCR_TIMEOUT", "60"))) as client:
            res = client.post(url, files=files, data=data)
        if res.status_code >= 400:
            print(f"[DOCUMENT OCR] VLM OCR HTTP {res.status_code}: {res.text[:300]}")
            return None
        body = res.json()
        text = str(body.get("text") or body.get("markdown") or "")
        if not text.strip():
            return None
        return OcrCandidate(
            engine=str(body.get("engine") or "vlm"),
            text=text.strip(),
            page_index=page_index,
            variant="remote",
            confidence=float(body.get("confidence") or 0.0),
            score=_business_certificate_text_score(text),
            elapsed_ms=_elapsed_ms(started),
            metadata={"url": url, "model": body.get("model")},
        )
    except Exception as exc:
        print(f"[DOCUMENT OCR] VLM OCR 사용 불가: {exc}")
        return None


def _elapsed_ms(started: float) -> int:
    return int((time.time() - started) * 1000)
