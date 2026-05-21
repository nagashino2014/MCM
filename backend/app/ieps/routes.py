"""IEPS 전용 FastAPI 라우터.

엔드포인트:
    POST /ieps/parse          - 단일 PDF 파싱 (documentType=review_report|annual_report)
    POST /ieps/parse-batch    - 다건 PDF 파싱
    GET  /ieps/health         - 상태 확인
    GET  /ieps/builtin-rules  - 9개 빌트인 규칙 조회
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.ieps_field_parser import parse_pdf
from .annual_report_parser import parse_annual_report_pdf
from .models import CollectionConfig, ParsedDocument, ExtractionRule
from .rule_engine import BUILTIN_RULES


# 클라이언트가 보내는 문서 종류 — 검토결과서(통합·변경허가)와 연간(점검)보고서는
# PDF 페이지 구성과 추출 룰이 달라 별도 파이프라인으로 분기한다.
DocumentType = Literal["review_report", "annual_report"]


router = APIRouter(tags=["ieps"])


class ParseRequest(BaseModel):
    pdf_path: str = Field(..., alias="pdfPath", description="추출할 IEPS PDF 경로")
    config: CollectionConfig
    # 클라이언트가 명시적으로 지정. 미지정 시 기존 동작(검토결과서) 유지로 하위 호환.
    document_type: DocumentType = Field(default="review_report", alias="documentType")

    class Config:
        populate_by_name = True


class BatchItem(BaseModel):
    pdf_path: str = Field(..., alias="pdfPath")
    post_id: Optional[str] = Field(default=None, alias="postId")
    document_type: DocumentType = Field(default="review_report", alias="documentType")

    class Config:
        populate_by_name = True


class BatchParseRequest(BaseModel):
    items: List[BatchItem]
    config: CollectionConfig


class BatchParseResponseItem(BaseModel):
    post_id: Optional[str] = Field(default=None, alias="postId")
    pdf_path: str = Field(..., alias="pdfPath")
    parsed: ParsedDocument

    class Config:
        populate_by_name = True


@router.get("/health")
def ieps_health():
    return {"status": "ok", "module": "ieps", "builtin_rules": len(BUILTIN_RULES)}


@router.get("/builtin-rules", response_model=List[ExtractionRule])
def get_builtin_rules() -> List[ExtractionRule]:
    return list(BUILTIN_RULES)


def _dispatch_parse(pdf_path: str, config: CollectionConfig, document_type: DocumentType) -> ParsedDocument:
    """문서 종류에 따라 검토결과서 룰 엔진 또는 연간보고서 파서로 분기."""
    if document_type == "annual_report":
        return parse_annual_report_pdf(pdf_path, config)
    return parse_pdf(pdf_path, config)


@router.post("/parse", response_model=ParsedDocument)
def parse_single(req: ParseRequest) -> ParsedDocument:
    pdf_path = Path(req.pdf_path)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF not found: {req.pdf_path}")
    return _dispatch_parse(str(pdf_path), req.config, req.document_type)


@router.post("/parse-batch", response_model=List[BatchParseResponseItem])
def parse_batch(req: BatchParseRequest) -> List[BatchParseResponseItem]:
    results: List[BatchParseResponseItem] = []
    for item in req.items:
        pdf_path = Path(item.pdf_path)
        if not pdf_path.exists():
            results.append(
                BatchParseResponseItem(
                    postId=item.post_id,
                    pdfPath=str(pdf_path),
                    parsed=ParsedDocument(
                        pdfPath=str(pdf_path),
                        extractionStatus="failed",
                        errorMessage="PDF not found",
                    ),
                )
            )
            continue
        parsed = _dispatch_parse(str(pdf_path), req.config, item.document_type)
        results.append(
            BatchParseResponseItem(
                postId=item.post_id,
                pdfPath=str(pdf_path),
                parsed=parsed,
            )
        )
    return results
