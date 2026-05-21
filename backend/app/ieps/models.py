"""IEPS 수집/추출 설정 및 결과 Pydantic 모델.

프로토타입 HTML(`prototype/ieps-dashboard.html`)에서 사용하는 `CollectionConfig`/
`ExtractionRule` JSON 스키마와 1:1 대응되도록 정의되어 있어 다음 라운드 프론트엔드와
바로 직렬화/역직렬화가 가능합니다.
"""
from __future__ import annotations

from typing import List, Optional, Literal, Any, Dict
from pydantic import BaseModel, Field


# 6종 locator: 우측/좌측/같은 행 다음 칸/다음 줄/다음 라벨까지 청크/정규식 매칭
# nextChunk: 키워드 매칭 라인 다음부터 빈 줄 또는 다음 라벨이 등장하기 직전까지의 모든 라인을
# 묶어서 반환한다. 업종/생산품/종 규모처럼 IEPS 갑지에서 한 라벨에 여러 줄이 묶여 있는
# 경우(다중 항목)에 사용한다.
Locator = Literal[
    "rightOfKeyword",
    "leftOfKeyword",
    "sameRowNext",
    "nextLine",
    "nextChunk",
    "regex",
]

# 결과 형식 4종: 문자열/숫자/날짜/코드+명칭(업종)
ResultType = Literal["string", "number", "date", "codeName"]


class ExtractionRange(BaseModel):
    """검토결과서 PDF 추출 페이지 범위."""
    mode: Literal["partial", "full"] = "partial"
    start_page: Optional[int] = Field(default=1, alias="startPage")
    end_page: Optional[int] = Field(default=10, alias="endPage")

    class Config:
        populate_by_name = True


class ExtractionRule(BaseModel):
    """단일 추출 항목 규칙."""
    id: str
    label: str                                              # 표시명 (예: 결정번호)
    keyword: Optional[str] = None                           # 1차 검색 키워드
    auxiliary_keyword: Optional[str] = Field(default=None, alias="auxKeyword")
    locator: Locator = "rightOfKeyword"
    regex: Optional[str] = None                             # locator=="regex"일 때 필수
    page_range: Optional[List[int]] = Field(default=None, alias="pageRange")
    result_type: ResultType = Field(default="string", alias="resultType")
    required: bool = False
    note: Optional[str] = None
    builtin: bool = False                                   # 9개 기본 규칙 여부

    class Config:
        populate_by_name = True


class CollectionConfig(BaseModel):
    """프로토타입의 수집 옵션 카드와 동일한 스키마."""
    collection_range: Optional[Dict[str, Any]] = Field(default=None, alias="collectionRange")
    filters: Optional[List[str]] = None
    # 검토결과서(통합·변경허가) PDF 페이지 범위. 두 문서 종류는 갑지/허가결정 구조가 동일.
    extraction_range: ExtractionRange = Field(
        default_factory=ExtractionRange, alias="extractionRange"
    )
    # 연간보고서 PDF 페이지 범위. 사업장 개요(1p) + 주요 생산품(2p) 정형 표.
    # None 이면 클라이언트가 누락한 옛 저장본 → 호출 측에서 (1, 2) 디폴트로 채운다.
    annual_report_extraction_range: Optional[ExtractionRange] = Field(
        default=None, alias="annualReportExtractionRange"
    )
    extraction_rules: List[ExtractionRule] = Field(
        default_factory=list, alias="extractionRules"
    )
    active_rule_ids: Optional[List[str]] = Field(default=None, alias="activeRuleIds")

    class Config:
        populate_by_name = True


class ParsedField(BaseModel):
    """단일 필드 추출 결과."""
    rule_id: str = Field(..., alias="ruleId")
    label: str
    value: Optional[str] = None                             # 원본에서 발견한 값
    normalized: Optional[Any] = None                        # 정규화된 값
    source_page: Optional[int] = Field(default=None, alias="sourcePage")
    source_text: Optional[str] = Field(default=None, alias="sourceText")
    confidence: float = 0.0
    needs_review: bool = Field(default=False, alias="needsReview")
    error: Optional[str] = None

    class Config:
        populate_by_name = True


class ParsedDocument(BaseModel):
    """PDF 1건의 파싱 결과."""
    pdf_path: str = Field(..., alias="pdfPath")
    page_count: int = Field(default=0, alias="pageCount")
    pages_processed: int = Field(default=0, alias="pagesProcessed")
    extraction_status: str = Field(default="completed", alias="extractionStatus")
    extraction_method: Optional[str] = Field(default=None, alias="extractionMethod")
    quality_score: float = Field(default=0.0, alias="qualityScore")
    fields: List[ParsedField] = Field(default_factory=list)
    missing_required: List[str] = Field(default_factory=list, alias="missingRequired")
    full_text: Optional[str] = Field(default=None, alias="fullText")
    error_message: Optional[str] = Field(default=None, alias="errorMessage")

    class Config:
        populate_by_name = True
