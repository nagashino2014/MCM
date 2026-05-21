"""IEPS 연간(점검)보고서 PDF 파서.

연간보고서는 검토결과서와 다른 페이지 구성을 갖는다 — 1페이지에 사업장 개요(명칭·
소재지·업종·종 규모) 표와 자유 텍스트 요약이 함께 등장하고, 2페이지에 "주요 생산품
및 생산량"이 콤마/줄바꿈으로 나열된다. 검토결과서와 달리 결정번호/허가일자가 없고,
대기·수질 오염물질 배출량은 기재되지 않은 경우가 많다.

설계 핵심:
  - 검토결과서용 룰 엔진(`rule_engine.py`)과 결과 타입(`ParsedDocument`/`ParsedField`)
    을 그대로 공유한다 → 후속 DB 적재(`upsertParsedDocument`) 코드를 재사용.
  - 9개 빌트인 룰의 id 와 동일한 식별자를 사용해 동일 컬럼(facilities/permits/...)
    으로 매핑된다(decision_no/permit_date 는 발견되지 않으므로 None).
  - 업종명만 추출되고 코드가 없으므로, KSIC 11차 룩업으로 자동 보강한다.
  - 누락 항목은 value=None + error="값을 찾지 못함" 으로 두어 needs_review 로만 표시.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..config import ExtractionConfig, default_config
from ..extractors.base import ExtractionStatus, ExtractionResult
from .integrated_permit_industries import match_integrated_permit_industries
from .ksic_lookup import lookup_industry
from .ksic_llm_reviewer import review_ksic_with_llm
from .models import (
    CollectionConfig,
    ExtractionRange,
    ParsedDocument,
    ParsedField,
)
# 검토결과서용 룰 엔진의 업종 줄 파서를 재사용해 IndustryEntry({code, name, products}) 형식과
# KSIC 11차 룩업·4자리 prefix 매칭·생산품 부속 분해 로직을 일관되게 공유한다. 연간보고서는
# 업종 표기 패턴이 검토결과서보다 단순하지만, 동일 사업장을 두 출처에서 파싱했을 때 동일한
# normalized 형태가 나와야 facility/permit/parsed_fields 적재 흐름이 깨끗하다.
from .rule_engine import (
    _DASH_CHARS as DASH_CHARS,
    _normalize_industry_line as _normalize_industry_line_review,
)


# ---------------------------------------------------------------------------
# 정규식
# ---------------------------------------------------------------------------

RE_BIZ_REG_NO = re.compile(
    rf"\d{{3}}\s*[{DASH_CHARS}]\s*\d{{2}}\s*[{DASH_CHARS}]\s*\d{{5}}"
)

# "회사명 (123-45-67890)" 형식에서 회사명 + 사업자번호 분리.
RE_NAME_WITH_BRN = re.compile(
    rf"^(?P<name>.+?)\s*[\(（]\s*(?P<brn>\d{{3}}\s*[{DASH_CHARS}]\s*\d{{2}}\s*[{DASH_CHARS}]\s*\d{{5}})\s*[\)）]\s*$"
)

# 종 규모 — 체크박스가 `[√] 대기 1종`, `[ ] √ 대기 종 1` 등으로 추출된다.
CHECK_MARK_CLASS = r"√✓☑■●VvOoㅇXx"
# 체크박스가 사라진 텍스트(예: "대기 1종, 수질 1종") 폴백 — 단순 첫 매칭.
RE_AIR_CLASS = re.compile(r"대\s*기\s*(?:([1-5])\s*종|종\s*([1-5]))")
RE_WATER_CLASS = re.compile(r"수\s*질\s*(?:([1-5])\s*종|종\s*([1-5]))")

# 발생량 (있을 때만): "먼지 230.9톤/년", "SOx 731.87톤/년", "NOx 5,527.91톤/년", "(폐수배출량 : 890.5㎥/일)"
RE_AIR_AMOUNT = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:톤/년|t/y|ton/year)")
RE_NAMED_AIR_AMOUNT = re.compile(
    r"(먼지|SOx|SOX|황산화물|NOx|NOX|질소산화물)\s*[:：]?\s*"
    r"([\d,]+(?:\.\d+)?)\s*(?:톤\s*/?\s*년|t/y|ton/year)",
    re.IGNORECASE,
)
RE_WATER_AMOUNT = re.compile(
    r"([\d,]+(?:\.\d+)?)\s*(?:m\^?3/일|㎥/일|m³/일|ton?n?e?/day)"
)
RE_WATER_AMOUNT_CONTEXT = re.compile(
    r"폐\s*수\s*배\s*출\s*량[^0-9]{0,20}([\d,]+(?:\.\d+)?)[^0-9]{0,20}(?:㎥|m\^?3|m³)",
    re.IGNORECASE,
)

# 라벨 인식: 공백/구두점에 무관하게 비교하기 위한 정규화 토큰.
LABEL_BUSINESS_NAME = ("사업장명칭", "사업장명")
LABEL_SITE_ADDRESS = ("사업장소재지", "소재지")
LABEL_INDUSTRY = ("업종명", "업종")
LABEL_SCALE = ("종규모",)
LABEL_PRODUCT = ("주요생산품및생산량", "주요생산품", "생산품")

# 다음 라벨로 인식해 chunk 수집을 종료할 토큰들.
NEXT_LABEL_TOKENS = (
    "사업장명칭",
    "사업장명",
    "사업장소재지",
    "업종명",
    "종규모",
    "매체별인허가",
    "배출구현황",
    "주요생산품",
    "허가조건",
    "이행사항",
    "사업자등록번호",
    "법인등록번호",
    "전화번호",
    "대표자",
)

SECTION_BREAK_RE = re.compile(
    r"^\s*\d+(?:\.\d+)*\s*[.)]?\s*(?:허가조건|허가배출기준|자가측정|시설\s*설치|사후\s*모니터링)"
)


def _strip_ws(text: str) -> str:
    return "".join((text or "").split())


def _match_label_prefix(line: str, labels: Tuple[str, ...]) -> Optional[Tuple[str, int]]:
    """라인 시작부에서 공백이 흩어진 라벨을 찾고 원본 라벨 끝 위치를 반환."""
    if not line:
        return None
    start = 0
    while start < len(line) and line[start].isspace():
        start += 1
    for label in sorted(labels, key=len, reverse=True):
        cur = start
        matched = True
        for ch in label:
            while cur < len(line) and line[cur].isspace():
                cur += 1
            if cur >= len(line) or line[cur] != ch:
                matched = False
                break
            cur += 1
        if matched:
            return label, cur
    return None


def _normalize_pages(pages: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
    cleaned: List[Tuple[int, str]] = []
    for page_num, text in pages:
        cleaned.append((int(page_num), text or ""))
    cleaned.sort(key=lambda x: x[0])
    return cleaned


def _select_pages(
    pages: List[Tuple[int, str]], page_range: Optional[List[int]]
) -> List[Tuple[int, str]]:
    if not page_range or len(page_range) < 2:
        return pages
    start, end = int(page_range[0]), int(page_range[1])
    if start > end:
        start, end = end, start
    return [(p, t) for (p, t) in pages if start <= p <= end]


def _is_label_line(line: str, labels: Tuple[str, ...]) -> bool:
    """`labels` 중 하나가 라인 시작부에 있으면 라벨 행으로 본다."""
    return _match_label_prefix(line, labels) is not None


def _is_next_label(line: str, current: Tuple[str, ...]) -> bool:
    s = _strip_ws(line)
    if not s:
        return False
    if SECTION_BREAK_RE.search(line):
        return True
    cur_tokens = {_strip_ws(c) for c in current}
    for tok in NEXT_LABEL_TOKENS:
        if tok in cur_tokens:
            continue
        if _match_label_prefix(line, (tok,)):
            return True
    return False


def _collect_after_label(
    text: str, labels: Tuple[str, ...]
) -> Optional[Tuple[int, str, str]]:
    """페이지 텍스트에서 `labels` 라인 이후의 chunk(다음 라벨 직전까지) 를 수집.

    반환: (line_idx, joined_value, source_line) 또는 None.
    같은 줄 라벨 뒤에 값이 있는 경우(예: '업종명: 화력 발전업')도 처리한다.
    """
    if not text:
        return None
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        label_match = _match_label_prefix(line, labels)
        if not label_match:
            continue
        # 라벨과 같은 줄에 값이 있으면 그 부분을 chunk 첫 토큰으로 사용.
        same_line_value = ""
        _label, label_end = label_match
        same_line_value = line[label_end:].lstrip(" :：\t-·▪•").strip()
        collected: List[str] = []
        if same_line_value:
            collected.append(same_line_value)
        for j in range(idx + 1, len(lines)):
            nxt = lines[j].strip()
            if not nxt:
                if collected:
                    break
                continue
            if _is_next_label(nxt, labels):
                break
            collected.append(nxt)
            if len(collected) >= 12:
                break
        if collected:
            return idx, "\n".join(collected), line
    return None


# ---------------------------------------------------------------------------
# 필드별 정규화
# ---------------------------------------------------------------------------

def _split_name_and_brn(text: str) -> Tuple[Optional[str], Optional[str]]:
    """'한국서부발전(주) 군산발전본부 (401-85-07386)' → (이름, 사업자번호) 분리.

    괄호 안에 사업자번호 패턴이 있으면 분리, 없으면 (text, None).
    회사명 자체가 '(주)' 등을 포함할 수 있어 사업자번호가 들어 있는 마지막 괄호만
    벗겨내도록 정규식 매칭 우선.
    """
    if not text:
        return None, None
    # 다중 라인일 수 있으므로 각 라인에서 시도하되, 첫 매칭만 사용.
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        m = RE_NAME_WITH_BRN.match(s)
        if m:
            name = m.group("name").strip()
            brn = re.sub(rf"[{DASH_CHARS}\s]", "", m.group("brn"))
            # ASCII hyphen 으로 통일 후 OOO-OO-OOOOO 포맷 복원.
            brn_compact = re.sub(r"\D", "", brn)
            if len(brn_compact) == 10:
                brn_formatted = f"{brn_compact[0:3]}-{brn_compact[3:5]}-{brn_compact[5:10]}"
            else:
                brn_formatted = m.group("brn")
            return name, brn_formatted
        # 사업자번호가 같은 줄에 별도로 있을 수도 있음
        m2 = RE_BIZ_REG_NO.search(s)
        if m2:
            brn = re.sub(r"\D", "", m2.group(0))
            brn_formatted = (
                f"{brn[0:3]}-{brn[3:5]}-{brn[5:10]}" if len(brn) == 10 else m2.group(0)
            )
            name = s.replace(m2.group(0), "").strip(" ()（）-:：")
            return name or None, brn_formatted
    # 못 찾으면 첫 비어있지 않은 라인을 이름으로.
    first = next((ln.strip() for ln in text.splitlines() if ln.strip()), None)
    return first, None


def _class_match_value(match: re.Match[str]) -> int:
    for group in match.groups():
        if group and group.isdigit():
            return int(group)
    return 0


def _extract_checked_class(text: str, media_pattern: str) -> Optional[int]:
    """체크박스가 붙은 대기/수질 등급을 우선 추출."""
    checked_patterns = (
        rf"\[\s*[{CHECK_MARK_CLASS}]\s*\]\s*{media_pattern}\s*(?:([1-5])\s*종|종\s*([1-5]))",
        rf"\[\s*\]\s*[{CHECK_MARK_CLASS}]\s*{media_pattern}\s*(?:([1-5])\s*종|종\s*([1-5]))",
        rf"[{CHECK_MARK_CLASS}]\s*{media_pattern}\s*(?:([1-5])\s*종|종\s*([1-5]))",
    )
    for pattern in checked_patterns:
        match = re.search(pattern, text)
        if match:
            value = _class_match_value(match)
            if value:
                return value
    return None


def _has_class_options(text: str, media_pattern: str) -> bool:
    return bool(
        re.search(rf"\[[^\]]*\]\s*(?:[{CHECK_MARK_CLASS}]\s*)?{media_pattern}", text)
        or re.search(rf"[{CHECK_MARK_CLASS}]\s*{media_pattern}", text)
    )


def _parse_scale(text: str) -> Dict[str, Any]:
    """종 규모 텍스트에서 air_class / water_class + (있을 때) 발생량 추출.

    체크박스 표기("[√] 대기 1종 [ ] 대기 2종") 가 있으면 체크된 항목을 우선,
    체크박스가 사라진 자유 텍스트("대기 1종, 수질 1종") 는 첫 매칭을 사용한다.
    """
    if not text:
        return {}
    flat = re.sub(r"\s+", " ", text)
    out: Dict[str, Any] = {}
    air_class = _extract_checked_class(flat, r"대\s*기")
    water_class = _extract_checked_class(flat, r"수\s*질")
    if air_class is None and not _has_class_options(flat, r"대\s*기"):
        air = RE_AIR_CLASS.search(flat)
        air_class = _class_match_value(air) if air else None
    if water_class is None and not _has_class_options(flat, r"수\s*질"):
        water = RE_WATER_CLASS.search(flat)
        water_class = _class_match_value(water) if water else None
    if air_class:
        out["air_class"] = air_class
    if water_class:
        out["water_class"] = water_class
    for pollutant, amount in RE_NAMED_AIR_AMOUNT.findall(flat):
        key = pollutant.upper()
        if key in ("SOX", "황산화물"):
            out["sox_ton_per_year"] = _to_float(amount)
        elif key in ("NOX", "질소산화물"):
            out["nox_ton_per_year"] = _to_float(amount)
        else:
            out["dust_ton_per_year"] = _to_float(amount)
    air_amount = RE_AIR_AMOUNT.search(flat)
    if air_amount:
        out["air_amount_ton_per_year"] = _to_float(air_amount.group(1))
    water_amount = RE_WATER_AMOUNT_CONTEXT.search(flat) or RE_WATER_AMOUNT.search(flat)
    if water_amount:
        out["wastewater_m3_per_day"] = _to_float(water_amount.group(1))
    return out


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# 항목 구분 콤마(공백/줄바꿈/끝이 따라옴) — 천 단위 콤마는 분리 대상 아님.
_ITEM_SEPARATOR = re.compile(r",(?=\s|$)|，(?=\s|$)")


def _parse_products(text: str) -> List[Dict[str, Any]]:
    """주요 생산품 텍스트 → [{product_name, amount, unit}, ...].

    연간보고서 본문은 보통 단위/생산량 없이 '에틸렌, 프로필렌, ...' 처럼 콤마 나열만
    되는 경우가 많다. 양/단위가 따라붙는 경우(검토결과서 양식과 동일) 도 같이 처리.
    """
    if not text:
        return []
    flat = " ".join(ln.strip() for ln in text.splitlines() if ln.strip())
    flat = re.sub(r"\s+", " ", flat).strip()
    if not flat:
        return []

    items: List[Dict[str, Any]] = []
    for raw in _ITEM_SEPARATOR.split(flat):
        seg = raw.strip(" .·-")
        if not seg:
            continue
        # 본문 문장/페이지 마커 제거.
        if re.search(r"(허가|환경부|배출구|매체별|법|조항|등$)", seg):
            continue
        if not re.search(r"[가-힣A-Za-z]", seg):
            continue
        if len(seg) < 2 or len(seg) > 60:
            continue

        m = re.match(
            r"^(.+?)\s*[（(:：]\s*([\d,]+(?:\.\d+)?)\s*([가-힣A-Za-z/㎡㎥³²]+)\s*[)）]?\s*$",
            seg,
        )
        if m:
            items.append(
                {
                    "product_name": m.group(1).strip().rstrip(":：").strip(),
                    "amount": _to_float(m.group(2)),
                    "unit": m.group(3).strip() or None,
                }
            )
            continue
        m2 = re.match(
            r"^(.+?)\s+([\d,]+(?:\.\d+)?)\s*([가-힣A-Za-z/㎡㎥³²]+)\s*$", seg
        )
        if m2:
            items.append(
                {
                    "product_name": m2.group(1).strip(),
                    "amount": _to_float(m2.group(2)),
                    "unit": m2.group(3).strip() or None,
                }
            )
            continue
        # 단위 없는 단순 품목명만 있는 케이스.
        items.append({"product_name": seg, "amount": None, "unit": None})

    # 동일 product_name 중복 제거.
    seen: set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for it in items:
        key = (it.get("product_name") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(it)
    return deduped


# ---------------------------------------------------------------------------
# 메인 파이프라인
# ---------------------------------------------------------------------------

def _build_field(
    rule_id: str,
    label: str,
    value: Optional[str],
    normalized: Any,
    page: Optional[int],
    source_line: Optional[str],
    confidence: float,
    needs_review: bool,
    error: Optional[str] = None,
) -> ParsedField:
    return ParsedField(
        ruleId=rule_id,
        label=label,
        value=value[:300] if value else None,
        normalized=normalized,
        sourcePage=page,
        sourceText=(source_line or "").strip()[:300] if source_line else None,
        confidence=round(confidence, 3),
        needsReview=needs_review,
        error=error,
    )


def _missing_field(rule_id: str, label: str, required: bool) -> ParsedField:
    return _build_field(
        rule_id=rule_id,
        label=label,
        value=None,
        normalized=None,
        page=None,
        source_line=None,
        confidence=0.0,
        needs_review=required,
        error="값을 찾지 못함",
    )


def _build_extraction_config(
    base: ExtractionConfig, start_page: Optional[int], end_page: Optional[int]
) -> ExtractionConfig:
    cfg = copy.deepcopy(base)
    cfg.pdf.start_page = start_page if start_page and start_page > 0 else None
    cfg.pdf.end_page = end_page if end_page and end_page > 0 else None
    cfg.pdf.extract_tables = False
    return cfg


def _result_to_pages(result: ExtractionResult) -> List[Tuple[int, str]]:
    if result.pages:
        return [(p.page_num, p.text or "") for p in result.pages]
    return [(1, result.text or "")]


def parse_annual_report_pdf(
    pdf_path: str,
    config: CollectionConfig,
    base_extraction_config: Optional[ExtractionConfig] = None,
) -> ParsedDocument:
    """연간(점검)보고서 단일 PDF 에서 사업장 데이터 추출 → ParsedDocument 반환."""
    pdf_file = Path(pdf_path)

    # 검토결과서와 별도의 페이지 범위를 사용. 미설정 시 1~2p.
    extraction_range: ExtractionRange = (
        config.annual_report_extraction_range
        or ExtractionRange(mode="partial", startPage=1, endPage=2)
    )
    if extraction_range.mode == "partial":
        start_page = extraction_range.start_page or 1
        end_page = extraction_range.end_page or 2
    else:
        start_page, end_page = None, None

    runtime_cfg = _build_extraction_config(
        base_extraction_config or default_config, start_page, end_page
    )
    # 늦은 import — extraction_service 가 무거운 의존성을 끌어와 모듈 로드 시간을 늘린다.
    from ..services.extraction_service import ExtractionService

    service = ExtractionService(runtime_cfg)

    try:
        result = service.extract_file(str(pdf_file))
    except Exception as exc:  # 안전망
        return ParsedDocument(
            pdfPath=str(pdf_file),
            extractionStatus="failed",
            errorMessage=f"PDF 추출 중 예외 발생: {exc}",
            missingRequired=[
                "company_name",
                "business_registration_no",
                "site_address",
                "industry_code_name",
                "permit_scale",
            ],
        )

    pages = _normalize_pages(_result_to_pages(result))
    target_pages = _select_pages(pages, [start_page, end_page] if start_page and end_page else None)

    fields: List[ParsedField] = []

    # ─── 1) 사업장 명칭 + 사업자등록번호 ─────────────────────────────
    name_chunk = None
    for page_num, text in target_pages:
        hit = _collect_after_label(text, LABEL_BUSINESS_NAME)
        if hit:
            name_chunk = (page_num, *hit)
            break
    if name_chunk:
        page_num, _idx, joined, source_line = name_chunk
        company_name, brn = _split_name_and_brn(joined)
        if company_name:
            fields.append(
                _build_field(
                    "company_name",
                    "상호",
                    company_name,
                    company_name,
                    page_num,
                    source_line,
                    confidence=0.85,
                    needs_review=False,
                )
            )
        else:
            fields.append(_missing_field("company_name", "상호", required=True))
        if brn:
            fields.append(
                _build_field(
                    "business_registration_no",
                    "사업자등록번호",
                    brn,
                    brn,
                    page_num,
                    source_line,
                    confidence=0.95,
                    needs_review=False,
                )
            )
        else:
            # 같은 페이지의 다른 라인에서 사업자번호를 한 번 더 시도.
            brn_text = next(
                (
                    re.sub(r"\D", "", m.group(0))
                    for m in (RE_BIZ_REG_NO.search(t) for _p, t in target_pages)
                    if m
                ),
                None,
            )
            if brn_text and len(brn_text) == 10:
                brn_formatted = f"{brn_text[0:3]}-{brn_text[3:5]}-{brn_text[5:10]}"
                fields.append(
                    _build_field(
                        "business_registration_no",
                        "사업자등록번호",
                        brn_formatted,
                        brn_formatted,
                        None,
                        None,
                        confidence=0.85,
                        needs_review=False,
                    )
                )
            else:
                fields.append(
                    _missing_field("business_registration_no", "사업자등록번호", required=True)
                )
    else:
        fields.append(_missing_field("company_name", "상호", required=True))
        fields.append(_missing_field("business_registration_no", "사업자등록번호", required=True))

    # ─── 2) 사업장 소재지 ───────────────────────────────────────────
    address_hit = None
    for page_num, text in target_pages:
        hit = _collect_after_label(text, LABEL_SITE_ADDRESS)
        if hit:
            address_hit = (page_num, *hit)
            break
    if address_hit:
        page_num, _idx, joined, source_line = address_hit
        # 다중 라인 합치고 공백 정리.
        addr = re.sub(r"\s+", " ", joined.replace("\n", " ")).strip()
        if addr:
            fields.append(
                _build_field(
                    "site_address",
                    "사업장소재지",
                    addr,
                    addr,
                    page_num,
                    source_line,
                    confidence=0.85,
                    needs_review=False,
                )
            )
        else:
            fields.append(_missing_field("site_address", "사업장소재지", required=True))
    else:
        fields.append(_missing_field("site_address", "사업장소재지", required=True))

    # ─── 3) 업종명 → KSIC 11차 코드 자동 매핑 ───────────────────────
    industry_hit = None
    for page_num, text in target_pages:
        hit = _collect_after_label(text, LABEL_INDUSTRY)
        if hit:
            industry_hit = (page_num, *hit)
            break
    if industry_hit:
        page_num, _idx, joined, source_line = industry_hit
        # 라인별로 검토결과서 룰엔진의 _normalize_industry_line 을 그대로 적용한다.
        # 코드+이름+생산품 추출 + KSIC 11차 룩업/4자리 prefix 보강이 모두 포함된다.
        # 매칭 실패 시 폴백으로 첫 라인을 이름만 가지고 lookup_industry 시도.
        entries: List[Dict[str, Any]] = []
        for ln in joined.splitlines():
            ln = ln.strip()
            if not ln:
                continue
            for chunk in re.split(r"\s+/\s+", ln):
                chunk = chunk.strip()
                if not chunk:
                    continue
                e = _normalize_industry_line_review(chunk)
                if e and e not in entries:
                    entries.append(e)

        first_line = next(
            (ln.strip() for ln in joined.splitlines() if ln.strip()), joined.strip()
        )

        target_entries = match_integrated_permit_industries(joined)
        if target_entries:
            normalized: Any = target_entries if len(target_entries) > 1 else target_entries[0]
            fields.append(
                _build_field(
                    "industry_code_name",
                    "업종",
                    first_line,
                    normalized,
                    page_num,
                    source_line,
                    confidence=0.88,
                    needs_review=False,
                )
            )
        elif entries:
            normalized = entries if len(entries) > 1 else entries[0]
            has_code = any(e.get("code") for e in entries)
            if not has_code:
                llm_entry = review_ksic_with_llm(joined)
                if llm_entry:
                    normalized = llm_entry
                    has_code = bool(llm_entry.get("code") or llm_entry.get("prefixCode"))
            fields.append(
                _build_field(
                    "industry_code_name",
                    "업종",
                    first_line,
                    normalized,
                    page_num,
                    source_line,
                    confidence=0.9 if has_code else 0.5,
                    needs_review=not has_code,
                    error=None if has_code else "KSIC 코드 매칭 실패",
                )
            )
        else:
            # 룰엔진이 못 잡은 자유 텍스트 폴백 — 이름만으로 단일 KSIC 매칭 시도.
            code, canonical, conf = lookup_industry(first_line)
            llm_entry = None if code else review_ksic_with_llm(joined)
            normalized = {
                "code": code,
                "name": canonical or first_line,
                "products": [],
            }
            if llm_entry:
                normalized = llm_entry
                conf = max(conf, float(llm_entry.get("llmConfidence") or 0.0))
            fields.append(
                _build_field(
                    "industry_code_name",
                    "업종",
                    first_line,
                    normalized,
                    page_num,
                    source_line,
                    confidence=conf if code else 0.4,
                    needs_review=not (code or llm_entry),
                    error=None if (code or llm_entry) else "KSIC 코드 매칭 실패",
                )
            )
    else:
        fields.append(_missing_field("industry_code_name", "업종", required=True))

    # ─── 4) 종 규모 (대기/수질) + 발생량 (있을 때만) ───────────────
    scale_hit = None
    for page_num, text in target_pages:
        hit = _collect_after_label(text, LABEL_SCALE)
        if hit:
            scale_hit = (page_num, *hit)
            break
    if scale_hit:
        page_num, _idx, joined, source_line = scale_hit
        scale = _parse_scale(joined)
        if scale:
            fields.append(
                _build_field(
                    "permit_scale",
                    "종 규모",
                    joined,
                    scale,
                    page_num,
                    source_line,
                    # 0.6 + 0.1 × 채워진 항목 수 (max 4) → 0.7~1.0. 0.95 로 상한.
                    confidence=min(0.95, 0.6 + 0.1 * len(scale)),
                    needs_review=False,
                )
            )
        else:
            fields.append(_missing_field("permit_scale", "종 규모", required=True))
    else:
        fields.append(_missing_field("permit_scale", "종 규모", required=True))

    # ─── 5) 주요 생산품 (2페이지) ──────────────────────────────────
    product_hit = None
    for page_num, text in target_pages:
        hit = _collect_after_label(text, LABEL_PRODUCT)
        if hit:
            product_hit = (page_num, *hit)
            break
    if product_hit:
        page_num, _idx, joined, source_line = product_hit
        items = _parse_products(joined)
        if items:
            normalized_items: Any = items if len(items) > 1 else items[0]
            fields.append(
                _build_field(
                    "product_output",
                    "생산품",
                    joined,
                    normalized_items,
                    page_num,
                    source_line,
                    confidence=0.75,
                    needs_review=False,
                )
            )
        else:
            fields.append(
                _build_field(
                    "product_output",
                    "생산품",
                    joined,
                    None,
                    page_num,
                    source_line,
                    confidence=0.3,
                    needs_review=False,
                    error="생산품 항목 분리 실패",
                )
            )
    # 생산품 미발견은 needs_review 표시 없이 그냥 비움 — 검토결과서와 달리 연간보고서는
    # 기재되지 않는 경우가 많아 "정상" 시나리오로 간주.

    # ─── 결정번호/허가일자/전화번호: 연간보고서엔 통상 없음 → 빈 필드. ─────
    fields.append(
        _build_field(
            "decision_no",
            "결정번호",
            None,
            None,
            None,
            None,
            confidence=0.0,
            needs_review=False,
            error="연간보고서에는 결정번호가 없음",
        )
    )
    fields.append(
        _build_field(
            "permit_date",
            "허가일자",
            None,
            None,
            None,
            None,
            confidence=0.0,
            needs_review=False,
            error="연간보고서에는 허가일자가 없음",
        )
    )

    by_id = {f.rule_id: f for f in fields}
    required_ids = ("company_name", "business_registration_no", "site_address", "industry_code_name", "permit_scale")
    missing_required = [rid for rid in required_ids if by_id.get(rid) is None or by_id[rid].value is None]

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
        fullText=None,
        errorMessage=result.error_message,
    )
