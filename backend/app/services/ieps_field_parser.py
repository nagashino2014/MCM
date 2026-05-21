"""IEPS 검토결과서 필드 파서.

`ExtractionService`로 PDF에서 페이지별 텍스트를 추출한 뒤, IEPS 룰 엔진을 호출해
ParsedDocument 결과를 만들어 반환한다. PDF 페이지 범위는 `CollectionConfig`의
`extractionRange.startPage` / `endPage` 값을 적용하되, 변경허가 검토결과서처럼
"1. 허가결정" 페이지(=핵심 사업장 메타가 있는 페이지)가 사용자 지정 endPage 보다
뒤에 있는 케이스를 위해 PDF 내 SUMMARY/DECISION 앵커 위치를 사전 탐색해 endPage 를
자동 확장한다. (anchor 미발견·스캔본 등은 사용자 지정 그대로 사용.)
"""
from __future__ import annotations

import copy
from pathlib import Path
from typing import List, Tuple, Optional

from ..config import ExtractionConfig, default_config
from ..extractors.base import ExtractionStatus, ExtractionResult
from ..ieps.models import CollectionConfig, ParsedDocument, ExtractionRule
from ..ieps.rule_engine import (
    run_rules,
    merge_with_builtin,
    BUILTIN_RULES,
    _find_summary_page,
    _find_decision_page,
)
from .extraction_service import ExtractionService


# 변경허가가 여러 차례 누적된 검토결과서 PDF 에서도 1페이지 메타(=DECISION 앵커)는
# 통상 30~50p 안쪽에 등장한다. anchor 가 더 뒤에 있을 때를 대비해 보수적으로 80p 까지
# 자동 확장 허용 — 그 이상으로 anchor 가 밀린 PDF 는 사용자 검수가 필요한 비정형 사례.
_ANCHOR_RANGE_CAP_PAGES = 80
# anchor 페이지 본문이 다음 페이지로 이어지는 경우(표/조항 등) 대비, anchor 직후 N 페이지
# 까지 추출 범위에 포함시킨다.
_ANCHOR_TAIL_BUFFER_PAGES = 5


def _sniff_pages_pymupdf(pdf_path: str) -> List[Tuple[int, str]]:
    """PyMuPDF 로 페이지별 텍스트 레이어만 cheap 하게 sniff.

    실 추출 단계의 `ExtractionService` (text_layer / OCR / 표 복원 등) 보다 가볍게
    동작하여 anchor 페이지 위치 판단용. 스캔본/이미지 PDF 면 대부분의 페이지가
    빈 문자열이라 anchor 검색이 실패하고 호출자는 사용자 지정 범위를 그대로 쓴다.
    PyMuPDF 미설치 환경(테스트 등) 에서도 안전하게 빈 리스트 반환.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return []
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return []
    out: List[Tuple[int, str]] = []
    try:
        for i, page in enumerate(doc):
            try:
                txt = page.get_text() or ""
            except Exception:
                txt = ""
            out.append((i + 1, txt))
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return out


def _resolve_extraction_range_by_anchor(
    pdf_path: str,
    requested_start: Optional[int],
    requested_end: Optional[int],
) -> Tuple[Optional[int], Optional[int]]:
    """사용자 지정 [startPage, endPage] 가 SUMMARY/DECISION 앵커 페이지를 포함하지
    않으면 endPage 를 자동 확장한다.

    동작 (한 줄로):
      anchor 가 requested_end 보다 뒤에 있을 때만 anchor + buffer 까지 확장하고,
      그 외(미발견/이미 포함/스캔본)에는 사용자 지정값을 그대로 반환한다.

    파라미터:
      requested_start, requested_end : `extractionRange.mode == "partial"` 일 때만
        의미 있는 1-indexed 값. mode == "all" (양쪽 None) 인 경우는 어차피 전체
        추출이므로 호출자가 이 함수를 건너뛴다.
    """
    pages = _sniff_pages_pymupdf(pdf_path)
    if not pages:
        return requested_start, requested_end
    # 텍스트 레이어가 비어 있는 스캔본 PDF — anchor 검색이 의미 없으므로 손대지 않음.
    if not any((t or "").strip() for _, t in pages):
        return requested_start, requested_end

    summary_pg = _find_summary_page(pages)
    decision_pg = _find_decision_page(pages)

    # 두 anchor 모두 미발견 — 비정형 PDF 또는 부록류. 기존 동작 유지.
    if summary_pg is None and decision_pg is None:
        return requested_start, requested_end

    # 더 뒤쪽에 있는 anchor 를 기준으로 확장. (변경허가 검토결과서는 보통
    # SUMMARY 5~7p < DECISION 13p+ 인 구조라 max 를 잡아야 둘 다 포함된다.)
    candidates = [pg for pg in (summary_pg, decision_pg) if pg is not None]
    target_pg = max(candidates)

    # 요청 범위가 이미 anchor 페이지를 포함 → 손대지 않음.
    if requested_end is not None and target_pg <= requested_end:
        return requested_start, requested_end

    # anchor + buffer 까지 확장. 단 PDF 페이지 수와 안전 cap 으로 상한.
    new_end = min(target_pg + _ANCHOR_TAIL_BUFFER_PAGES, _ANCHOR_RANGE_CAP_PAGES, len(pages))
    if requested_end is not None and new_end <= requested_end:
        # 확장 결과가 오히려 작거나 같다면 요청 그대로 둔다(이론상 cap 충돌).
        return requested_start, requested_end
    return requested_start, new_end


def _build_config_with_range(
    base: ExtractionConfig, start_page: Optional[int], end_page: Optional[int]
) -> ExtractionConfig:
    """기본 ExtractionConfig를 깊은 복사한 뒤 PDF 페이지 범위만 덮어쓴다."""
    cfg = copy.deepcopy(base)
    if start_page and start_page > 0:
        cfg.pdf.start_page = start_page
    else:
        cfg.pdf.start_page = None
    if end_page and end_page > 0:
        cfg.pdf.end_page = end_page
    else:
        cfg.pdf.end_page = None
    # IEPS 룰 엔진은 페이지 텍스트만 입력으로 받으므로(아래 _result_to_pages 참조)
    # 표 구조 추출/선 검출/표 복원 단계는 IEPS 파싱 결과에 영향이 없고 시간만 소모한다.
    # 100페이지 넘는 PDF에서는 페이지마다 [TABLE RECOVERY]/[LineDetection] 이 반복되어
    # 동적 타임아웃이 2400초까지 잡혔던 것이 큰 병목 → 일괄 비활성화한다.
    cfg.pdf.extract_tables = False
    return cfg


def _result_to_pages(result: ExtractionResult) -> List[Tuple[int, str]]:
    """ExtractionResult.pages를 [(page_num, text), ...] 으로 변환."""
    if result.pages:
        return [(p.page_num, p.text or "") for p in result.pages]
    # pages가 비어있는 경우 전체 텍스트를 단일 페이지로 본다.
    return [(1, result.text or "")]


def parse_pdf(
    pdf_path: str,
    config: CollectionConfig,
    base_extraction_config: Optional[ExtractionConfig] = None,
) -> ParsedDocument:
    """단일 PDF에 IEPS 추출 규칙을 적용해 결과 반환."""
    pdf_file = Path(pdf_path)

    extraction_range = config.extraction_range
    if extraction_range and extraction_range.mode == "partial":
        start_page = extraction_range.start_page or 1
        end_page = extraction_range.end_page or 10
    else:
        start_page, end_page = None, None

    # anchor-aware 보정 — 변경허가가 누적된 검토결과서는 1페이지 메타가 13p 이후로 밀리는
    # 케이스가 많아 partial 모드에서는 anchor 위치를 미리 살펴 endPage 를 자동 확장한다.
    # mode == "all" 인 전수 추출에는 영향 없음(양쪽 None 이라 분기 건너뜀).
    if start_page is not None and end_page is not None:
        start_page, end_page = _resolve_extraction_range_by_anchor(
            str(pdf_file), start_page, end_page
        )

    runtime_cfg = _build_config_with_range(
        base_extraction_config or default_config, start_page, end_page
    )
    service = ExtractionService(runtime_cfg)

    try:
        result = service.extract_file(str(pdf_file))
    except Exception as exc:  # 안전망
        return ParsedDocument(
            pdfPath=str(pdf_file),
            extractionStatus="failed",
            errorMessage=f"PDF 추출 중 예외 발생: {exc}",
            missingRequired=[r.id for r in BUILTIN_RULES if r.required],
        )

    pages = _result_to_pages(result)

    rules = config.extraction_rules or []
    if not rules:
        rules = list(BUILTIN_RULES)
    else:
        rules = merge_with_builtin(rules)

    fields = run_rules(pages, rules, config.active_rule_ids)

    by_id = {f.rule_id: f for f in fields}
    missing_required: List[str] = []
    for rule in rules:
        if not rule.required:
            continue
        field = by_id.get(rule.id)
        if field is None or field.value is None:
            missing_required.append(rule.id)

    return ParsedDocument(
        pdfPath=str(pdf_file),
        pageCount=result.page_count,
        pagesProcessed=len(pages),
        extractionStatus=(
            "completed" if result.status == ExtractionStatus.COMPLETED else result.status.value
        ),
        extractionMethod=result.extraction_method.value if result.extraction_method else None,
        qualityScore=result.quality_score,
        fields=fields,
        missingRequired=missing_required,
        fullText=None,  # 텍스트는 별도 저장. API 응답 부피 줄이기 위해 기본 미포함.
        errorMessage=result.error_message,
    )
