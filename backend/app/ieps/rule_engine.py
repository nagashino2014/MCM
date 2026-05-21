"""IEPS 검토결과서 필드 추출 룰 엔진.

6가지 locator(`rightOfKeyword`, `leftOfKeyword`, `sameRowNext`, `nextLine`,
`nextChunk`, `regex`)를 지원하며, 9개 필수 항목(결정번호/상호/사업자등록번호/
사업장소재지/전화번호/업종/허가일자/종 규모/생산품)에 대한 빌트인 규칙과
정규화 로직을 함께 제공합니다. 페이지별 텍스트만 있으면 동작하므로 PDF/OCR
파이프라인과 분리되어 있습니다.

설계 핵심:
  - IEPS 검토결과서는 보통 11페이지(±1~2) 부근에 워드프로세서 변환 텍스트로
    "1. 허가결정" 페이지가 있고, 그 페이지에 "허가대상 사업장의 현황은 다음과
    같다." 라는 고유 앵커 문장이 등장한다. 이 페이지가 PDF 표지/갑지(스캔)
    페이지보다 OCR 품질이 훨씬 좋아 파싱 정확도가 높다.
  - 따라서 규칙은 페이지 범위를 정적으로 못박지 않고, 매번 그 앵커 문장을
    가진 페이지를 찾아 해당 페이지에서만 우선 추출한다(찾지 못하면 기존
    page_range로 fallback).
  - 업종/생산품/종 규모는 한 라벨에 여러 줄/여러 항목이 묶여 있는 경우가
    잦으므로 `nextChunk` locator로 묶음을 한꺼번에 가져와 정규화 단계에서
    배열로 분해한다.
"""
from __future__ import annotations

import re
from typing import List, Optional, Dict, Tuple, Any

from .models import ExtractionRule, ParsedField, ResultType


# ---------------------------------------------------------------------------
# 정규식 사전 (필수 9 항목)
# ---------------------------------------------------------------------------

# 결정번호는 4자리가 표준이지만, 일부 PDF 에서 5자리(예: '제00321-01호') 변형이 관찰된다.
# 페이지 번호('5/113') 같은 짧은 숫자 충돌을 막기 위해 자릿수는 3~5 로만 허용한다.
RE_DECISION_NO = re.compile(r"제\s*\d{3,5}\s*-\s*\d+\s*호")
# IEPS 검토결과서 PDF의 dash 가 워드프로세서 변환 과정에서 ASCII hyphen(-),
# EN DASH(–, U+2013), EM DASH(—, U+2014), MINUS SIGN(−, U+2212), HYPHEN(‐, U+2010)
# 등으로 섞여 추출되는 사례가 있음 → 사업자등록번호 정규식은 모든 변형을 허용한다.
_DASH_CHARS = r"\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212"
RE_BIZ_REG_NO = re.compile(rf"\d{{3}}\s*[{_DASH_CHARS}]\s*\d{{2}}\s*[{_DASH_CHARS}]\s*\d{{5}}")
RE_PHONE = re.compile(
    rf"(?:\+?\d{{1,3}}[\s{_DASH_CHARS}]?)?(?:0\d{{1,2}}|\d{{2,3}})[\s{_DASH_CHARS})]?\d{{3,4}}[\s{_DASH_CHARS}]?\d{{4}}"
)
# 업종은 두 가지 표기 모두 등장: "24121 열간압연..." (코드 앞) / "지정외폐기물처리업(38210)" (코드 뒤)
RE_INDUSTRY_CODE_NAME = re.compile(r"(\d{5})\s*[\)\.\-:·]?\s*([가-힣A-Za-z0-9·\(\)/&\s]{2,60}?)(?=$|[\.,;)\]]|\n)")
RE_INDUSTRY_CODE_FIRST = re.compile(r"(\d{5})\s*[,\.\s]+\s*([가-힣A-Za-z0-9·\(\)/&\s]{2,80}?)(?=$|[\.;]|\n)")
RE_INDUSTRY_NAME_FIRST = re.compile(r"([가-힣A-Za-z0-9·/&\s]{2,80}?)\s*\((\d{5})\)")
# 4자리 코드(상위분류) — `(2411)`, `[3821]` 등. 5자리 매칭이 모두 실패한 뒤 폴백으로 사용.
RE_INDUSTRY_NAME_FIRST_4 = re.compile(r"([가-힣A-Za-z0-9·/&\s]{2,80}?)\s*[\(\[]\s*(\d{4})\s*[\)\]]")
# 3자리 코드(소분류) — `1차 철강 제조업(241)` 등. 4자리도 모두 실패한 뒤 마지막 폴백.
RE_INDUSTRY_NAME_FIRST_3 = re.compile(r"([가-힣A-Za-z0-9·/&\s]{2,80}?)\s*[\(\[]\s*(\d{3})\s*[\)\]]")
# `5자리, 콤마 분리된 다중어 이름` — `24212, 알루미늄, 제련, 정련및합금제조업` 처럼 PDF 추출
# 과정에서 표 셀 사이 공백/줄바꿈이 콤마로 변환된 평탄형. 두 번째 그룹의 콤마/공백을 제거해
# KSIC 정규화 매칭에 넘긴다.
RE_INDUSTRY_CODE_COMMA_NAME = re.compile(r"^\s*(\d{5})\s*,\s*([가-힣A-Za-z0-9·/&\s,，]{2,120})\s*$")
# `이름 외 N종` 접미 — `복합비료 및 기타 화학비료 제조업 외 4종` → 정리 후 이름 lookup.
RE_TRAILING_OTHERS = re.compile(r"\s*외\s*\d+\s*종\s*$")
# 한국 산업명 어미 — 코드/괄호 없이도 KSIC 이름 lookup 을 시도할 만한 후보 라인 식별용.
# (예: `합성수지 및 기타플라스틱물질 제조`, `복합비료 및 기타 화학비료 제조업`).
RE_INDUSTRY_NAME_SUFFIX = re.compile(r"(?:제조업?|공급업|판매업|운송업|보관업|처리업|발전업|광업|어업|농업|임업)\s*$")
# 대괄호 5자리 — `[20493]`. 정규 괄호 케이스는 RE_INDUSTRY_NAME_FIRST 가 잡지만 대괄호는 별도.
RE_INDUSTRY_NAME_FIRST_BRACKET = re.compile(r"([가-힣A-Za-z0-9·/&\s]{2,80}?)\s*\[\s*(\d{5})\s*\]")
# 괄호 안 `(코드, 생산품, ...)` 또는 `(코드, 생산품)` 분해 — 코드 추출 후 잔여 콤마 토큰을
# products 로 사용한다. `합성수지 및 플라스틱 물질 제조업 (20202, 폴리올, PESOL, PUR-A)`.
RE_INDUSTRY_NAME_FIRST_PARENS_RICH = re.compile(
    r"([가-힣A-Za-z0-9·/&\s]{2,80}?)\s*\(\s*(\d{4,5})\s*,\s*([^)]+?)\s*\)"
)
# `(생산품, 생산품)` — 코드 없이 괄호 안에 생산품만. 이름은 제조업으로 끝나는 한국어 문구.
RE_INDUSTRY_NAME_FIRST_PRODUCTS_ONLY = re.compile(
    r"([가-힣A-Za-z0-9·/&\s]{2,80}?제조업?)\s*\(\s*([^()]+?)\s*\)"
)
# `코드 이름 : 생산품, 생산품` — `20129 기타 기초 무기화학 물질 제조업 : 과산화수소`
RE_INDUSTRY_CODE_NAME_COLON_PRODUCTS = re.compile(
    r"(\d{5})\s*([가-힣A-Za-z0-9·/&\s]{2,60}?)\s*[:：]\s*([^/\n]+)$"
)
# 슬래시 + 줄바꿈을 추가 항목 구분자로 사용 (콤마는 _ITEM_SEPARATOR 가 처리).
RE_INDUSTRY_LIST_SPLITTER = re.compile(r"\s*/\s*|\n")
# 진짜 허가일자는 (a) "...년..월..일부로 ... 허가한다" 의 부로 직전 또는
# (b) 페이지 하단 "환경부 장관" 직전의 날짜 — 두 형태 모두 매칭한다.
RE_PERMIT_DATE_BURO = re.compile(
    r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?\s*부로"
)
RE_PERMIT_DATE_MINISTER = re.compile(
    r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?\s*\n?\s*환경부"
)
RE_PERMIT_DATE_ANCHOR = re.compile(
    r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?\s*(?:부로|\n?\s*환경부)"
)
RE_PERMIT_DATE = re.compile(
    r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?"
)
RE_AIR_CLASS = re.compile(r"대\s*기\s*[:：]?\s*(?:특\s*)?([1-5])\s*(?:\(\s*특\s*\)\s*)?종")
RE_WATER_CLASS = re.compile(
    r"(?:수\s*질|폐\s*수)\s*[:：]?\s*(?:특\s*)?([1-5])\s*(?:\(\s*특\s*\)\s*)?종"
)
RE_AIR_AMOUNT = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:톤/년|t/y|ton/year)")
RE_WATER_AMOUNT = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:m\^?3\s*/?\s*일|㎥\s*/?\s*일|m³\s*/?\s*일|tonn?e?/day)")

# 표 형태 분할 토큰 (탭/2칸이상 공백/세로줄)
TABLE_SPLITTER = re.compile(r"\t+|\s{2,}|\|")

# "1. 허가결정" 페이지 앵커 — 이 문장이 들어 있는 페이지를 갑지 정보의 기준 페이지로 사용한다.
ANCHOR_DECISION_PAGE = "허가대상사업장의현황"

# "배출시설등 설치·운영허가 명세서" 갑지 페이지 앵커 — 보통 5p 부근에 있으며,
# 이 페이지는 다음과 같은 매우 일관된 4줄 포맷으로 워드프로세서 텍스트가 추출된다:
#     제0255-01호                    (← 결정번호)
#     배출시설등 설치·운영허가 명세서  (← 앵커)
#     - 케이알에너지㈜ -              (← 상호 — 양옆 dash 제거 후 사용)
#     2020. 12.
#     환경부
# OCR 영향이 거의 없는 텍스트 레이어이므로 결정번호/상호 추출 신뢰도가 가장 높다.
ANCHOR_SUMMARY_PAGE = "배출시설등설치"
ANCHOR_SUMMARY_PAGE_ALT = "운영허가명세서"

# nextChunk 매처가 "다음 라벨"로 인식할 단어 집합. 라벨 직전에서 chunk 수집을 멈춘다.
# (한국어 PDF 추출 결과는 공백이 사라지는 경우가 많아 공백 제거 비교를 사용한다.)
IEPS_DECISION_LABELS = [
    "상호",
    "사업장",
    "대표자",
    "사업자등록",
    "법인등록",
    "전화번호",
    "사업장소재",
    "업종",
    "종규모",
    "종 규모",
    "생산품",
    "통합허가에",
    "허가일자",
    "환경부장관",
    "환경부 장관",
    "이허가",
    "이 허가",
]


# ---------------------------------------------------------------------------
# 9개 빌트인 규칙 정의
# ---------------------------------------------------------------------------

BUILTIN_RULES: List[ExtractionRule] = [
    ExtractionRule(
        id="decision_no",
        label="결정번호",
        keyword="결정번호",
        locator="regex",
        regex=RE_DECISION_NO.pattern,
        page_range=[1, 25],
        result_type="string",
        required=True,
        builtin=True,
        note="제 OOOO-O호 형식. 표지/갑지 상단 또는 1.허가결정 페이지에 등장.",
    ),
    ExtractionRule(
        # IEPS 검토결과서 갑지의 표가 텍스트로 풀리면 "상호(사업장)" 헤더 다음 줄에 회사명이 떨어진다.
        id="company_name",
        label="상호",
        keyword="상호(사업장)",
        auxiliary_keyword="상호",
        locator="nextLine",
        page_range=[5, 25],
        result_type="string",
        required=True,
        builtin=True,
    ),
    ExtractionRule(
        id="business_registration_no",
        label="사업자등록번호",
        keyword="사업자등록번호",
        # 페이지 텍스트 어디에서도 OOO-OO-OOOOO 형식만 매칭 → 법인번호(OOOOOO-OOOOOOO)와 자릿수로 자동 구분
        locator="regex",
        regex=RE_BIZ_REG_NO.pattern,
        page_range=[5, 25],
        result_type="string",
        required=True,
        builtin=True,
    ),
    ExtractionRule(
        id="site_address",
        label="사업장소재지",
        keyword="사업장소재지",
        auxiliary_keyword="소재지",
        locator="nextLine",
        page_range=[5, 25],
        result_type="string",
        required=True,
        builtin=True,
    ),
    ExtractionRule(
        id="phone_number",
        label="전화번호",
        keyword="전화번호",
        locator="nextLine",
        page_range=[5, 25],
        result_type="string",
        required=False,
        builtin=True,
    ),
    ExtractionRule(
        # 업종은 라벨 다음 줄에 1~5개의 업종이 줄바꿈으로 나열되는 경우가 많으므로 nextChunk로 묶어서 받는다.
        id="industry_code_name",
        label="업종",
        keyword="업종",
        locator="nextChunk",
        page_range=[5, 25],
        result_type="codeName",
        required=True,
        builtin=True,
        note="5자리 업종코드 + 업종명. '코드 명칭' / '명칭(코드)' 두 표기 모두 매칭. 다중 업종은 배열로 반환.",
    ),
    ExtractionRule(
        # "...일부로 허가한다" / "...일\n환경부 장관" 두 형태 모두 매칭하는 정규식 사용.
        id="permit_date",
        label="허가일자",
        keyword="허가",
        auxiliary_keyword="환경부",
        locator="regex",
        regex=RE_PERMIT_DATE_ANCHOR.pattern,
        page_range=[5, 25],
        result_type="date",
        required=True,
        builtin=True,
        note="'YYYY년 MM월 DD일부로 ... 허가한다' 또는 페이지 하단 '환경부 장관' 직전 날짜.",
    ),
    ExtractionRule(
        # 종 규모는 "대기/수질"이 한 줄에 같이 있거나 두 줄로 분리된 경우 모두 발생.
        # nextChunk로 라벨 다음의 묶음을 받아 정규화에서 air/water 양쪽 추출.
        id="permit_scale",
        label="종 규모",
        keyword="종 규모",
        auxiliary_keyword="종규모",
        locator="nextChunk",
        page_range=[5, 25],
        result_type="string",
        required=True,
        builtin=True,
        note="대기 O종/수질 O종 + 발생량. 두 줄 분리 형태도 처리.",
    ),
    ExtractionRule(
        # 생산품도 라벨 다음에 콤마/줄바꿈으로 다수 항목이 나열되는 경우가 잦다.
        id="product_output",
        label="생산품",
        keyword="생산품",
        auxiliary_keyword="생산량",
        locator="nextChunk",
        page_range=[5, 25],
        result_type="string",
        required=False,
        builtin=True,
        note="여러 생산품(콤마/줄바꿈 구분)은 배열로 반환.",
    ),
]

BUILTIN_RULES_BY_ID: Dict[str, ExtractionRule] = {r.id: r for r in BUILTIN_RULES}

# 갑지/허가결정 페이지에서 추출하는 규칙 — 앵커 페이지가 발견되면 이 규칙들의 page_range는
# 그 페이지로 동적 override 된다(첨부 1번 스샷의 ㈜카프로 등 PDF에서 갑지 위치가 다른 경우 대비).
DECISION_PAGE_RULE_IDS = {
    "company_name",
    "business_registration_no",
    "site_address",
    "phone_number",
    "industry_code_name",
    "permit_date",
    "permit_scale",
    "product_output",
}


# ---------------------------------------------------------------------------
# 페이지/라인 보조 함수
# ---------------------------------------------------------------------------

def _normalize_pages(pages: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
    """[(page_num_1indexed, text), ...] 형식으로 정렬/정규화."""
    cleaned: List[Tuple[int, str]] = []
    for page_num, text in pages:
        if text is None:
            text = ""
        cleaned.append((int(page_num), text))
    cleaned.sort(key=lambda item: item[0])
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


def _split_columns(line: str) -> List[str]:
    """표/탭 기반 줄을 컬럼 단위로 자른다."""
    return [c.strip() for c in TABLE_SPLITTER.split(line) if c.strip()]


def _line_iter(pages: List[Tuple[int, str]]):
    """(page_num, line_idx, line_text) iterator."""
    for page_num, text in pages:
        for idx, raw in enumerate(text.splitlines()):
            yield page_num, idx, raw


def _strip_ws(text: str) -> str:
    """공백을 모두 제거 — PDF 추출 결과에서 한국어 사이 공백이 사라지는 경우 비교용."""
    return "".join(text.split())


# anchor 검색 전용 정규화 — PDF 글리프 분리로 anchor 단어 사이에 가운데점/하이픈/구두점이
# 끼어드는 경우(예: '배출시설등 설치 \n 운 \n · \n 영 허가 명세서')도 anchor 키워드 검사에서
# 매칭되도록 anchor 의 의미를 깨뜨리지 않는 기호류는 모두 제거한다.
# (라벨/값 추출용 _strip_ws 는 부작용을 피하기 위해 그대로 둔다.)
_ANCHOR_NOISE_CHARS = re.compile(
    r"[\s·•\-\u2010-\u2015\u2212"          # 공백, 가운데점, ASCII/유니코드 dash
    r"\.,:;\u00b7"                            # 마침표/쉼표/콜론/중점
    r"\(\)\[\]\{\}\u3008-\u300f"            # 괄호 류 (전각 포함)
    r"\u2022"                                  # bullet
    r"]"
)


def _strip_anchor(text: str) -> str:
    """anchor 매칭용 정규화: 공백 + 가운데점 + dash + 구두점 + 괄호류 모두 제거."""
    return _ANCHOR_NOISE_CHARS.sub("", text)


def _find_decision_page(pages: List[Tuple[int, str]]) -> Optional[int]:
    """'허가대상 사업장의 현황은 다음과 같다.' 앵커가 있는 페이지 번호 반환.

    이 앵커는 IEPS 검토결과서의 "1. 허가결정" 페이지에만 등장하는 고유 문장이며,
    워드프로세서 변환 텍스트라 OCR 갑지보다 추출 품질이 훨씬 높다.
    """
    for page_num, text in pages:
        if not text:
            continue
        if ANCHOR_DECISION_PAGE in _strip_anchor(text):
            return page_num
    return None


def _find_summary_page(pages: List[Tuple[int, str]]) -> Optional[int]:
    """'배출시설등 설치·운영허가 명세서' 갑지 페이지 번호 반환 (보통 5p).

    부록/이행 PDF 같은 비정형 케이스에서는 anchor 두 단어가 같은 페이지의 다른
    줄로 흩어져 있는 경우(예: '배출시설등설치 \\n 운 \\n · \\n 영허가명세서')도
    있고, 글리프 깨짐으로 anchor 단어 사이에 가운데점·하이픈·괄호 같은 기호가
    끼어드는 경우도 있다. anchor 검색 전용 정규화(_strip_anchor)로 모두 제거 후 검사.
    """
    for page_num, text in pages:
        if not text:
            continue
        ws = _strip_anchor(text)
        if ANCHOR_SUMMARY_PAGE in ws and ANCHOR_SUMMARY_PAGE_ALT in ws:
            return page_num
    return None


# 명세서 갑지 페이지의 본문 라인을 기호/괄호 양옆에서 정리할 때 쓰는 패턴.
_SUMMARY_LINE_TRIM = re.compile(rf"^[\s{_DASH_CHARS}·•\-‐‑‒–—―−]+|[\s{_DASH_CHARS}·•\-‐‑‒–—―−]+$")

# 회사명 후보 거부 패턴 — 페이지 번호("- 4 -", "(2)"), 단독 기호/숫자, 짧은 라벨(상호/사업장 등)
_PAGE_NUM_LIKE = re.compile(r"^[\s\-‐‑‒–—―−·•\(\)\[\]]*\d{1,3}[\s\-‐‑‒–—―−·•\(\)\[\]]*$")
_COMPANY_REJECT_LABELS = {
    "상호", "상호사업장", "사업장", "사업장명", "대표자", "사업자등록", "법인등록",
    "전화번호", "사업장소재", "업종", "종규모", "종 규모", "생산품", "허가일자",
    "환경부", "환경부장관", "환경부 장관", "비공개", "관인",
    "(", ")", "[", "]", "{", "}", "·", "-", "—", "–",
}


def _is_valid_company_candidate(cand: str) -> bool:
    """anchor 직후 라인이 진짜 회사명인지 휴리스틱 검증.

    부록 PDF의 갑지에는 anchor 직후 라인이 단일 기호('[' / '(' / '·')거나
    페이지 번호('- 4 -') 또는 표 라벨('상호사업장')만 있는 경우가 많아,
    이런 라인은 명시적으로 거부하고 다음 후보 라인으로 폴백시킨다.
    """
    if not cand:
        return False
    s = cand.strip()
    if not s:
        return False
    # 한글/영문 글자가 최소 2자 이상 — 단일 기호/숫자/페이지번호 등 거부.
    letters = re.findall(r"[가-힣A-Za-z]", s)
    if len(letters) < 2:
        return False
    # 페이지 번호 패턴 ("- 4 -", "(2)" 등)
    if _PAGE_NUM_LIKE.match(s):
        return False
    # 표 라벨/문서 라벨 — 공백 제거 후 동일 비교.
    s_ws = _strip_ws(s)
    if s_ws in {_strip_ws(lbl) for lbl in _COMPANY_REJECT_LABELS}:
        return False
    return True


def _extract_from_summary_page(
    text: str, rule_id: str
) -> Optional[Tuple[str, str]]:
    """명세서 갑지 페이지(=`_find_summary_page`)의 4줄 정형 포맷에서 항목 추출.

    반환: (value, source_line) 또는 None
    rule_id 별 추출 규칙:
      - decision_no  : 페이지 첫 줄(또는 "제 OOOO-OO 호" 첫 매칭) 사용.
      - company_name : "배출시설등 설치·운영허가 명세서" anchor 직후의 라인을
                       양옆 dash/공백 제거 후 사용. 단일 기호/페이지번호/표 라벨이면
                       다음 라인으로 폴백. 줄바꿈 분리 anchor (부록 갑지 등) 대응.
    """
    if not text:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None

    if rule_id == "decision_no":
        # (1) 정상 패턴 '제 OOOO-OO 호'
        for ln in lines[:4]:
            m = RE_DECISION_NO.search(ln)
            if m:
                return m.group(0).strip(), ln
        # (2) 글리프 깨짐 폴백 — 갑지 1~3행에 한해 '제'/'호' 누락된 'OOOO-OO' 매칭.
        # 케이이씨/일부 표지에서 '제1241-01호' 가 PyMuPDF 추출 시 '1241-01' 만
        # 떨어져 나오는 케이스 대응. 페이지 번호('5/113' 등)와 구분하기 위해
        # 3~5자리-2자리 숫자 패턴(앞은 발행번호, 뒤는 차수)만 채택.
        # 일부 PDF 에 '제00321-01호'(5자리) 변형이 있어 자릿수 폭을 동일하게 맞춤.
        _RE_DECISION_NO_BARE = re.compile(r"^\s*(\d{3,5}\s*-\s*\d{1,2})\s*$")
        for ln in lines[:3]:
            m = _RE_DECISION_NO_BARE.match(ln)
            if m:
                core = re.sub(r"\s+", "", m.group(1))
                return f"제{core}호", ln
        return None

    if rule_id == "company_name":
        # (1) 우선 단일 라인에 anchor 두 단어가 모두 있는 경우(정상 명세서 갑지).
        anchor_end_idx: Optional[int] = None
        for idx, ln in enumerate(lines):
            ws = _strip_anchor(ln)
            if ANCHOR_SUMMARY_PAGE in ws and ANCHOR_SUMMARY_PAGE_ALT in ws:
                anchor_end_idx = idx
                break
        # (2) 줄바꿈/글리프 깨짐으로 anchor 두 단어가 분리된 경우 — 연속 라인 그룹을 합쳐
        # 검사. 부록·OCR 갑지에서 자주 발생: '배출시설등설치 \\n 운 \\n · \\n 영허가명세서'.
        if anchor_end_idx is None:
            window = 6  # 연속 6줄까지 묶어서 anchor 두 단어 동시 매칭 여부 확인
            for i in range(len(lines)):
                joined = _strip_anchor("".join(lines[i : i + window]))
                if ANCHOR_SUMMARY_PAGE in joined and ANCHOR_SUMMARY_PAGE_ALT in joined:
                    # anchor가 끝나는 라인 인덱스를 정확히 찾기 — anchor 두 단어가 모두
                    # 들어가는 가장 짧은 prefix 라인 인덱스 = anchor 종료점.
                    for end in range(i, min(i + window, len(lines))):
                        prefix_ws = _strip_anchor("".join(lines[i : end + 1]))
                        if (
                            ANCHOR_SUMMARY_PAGE in prefix_ws
                            and ANCHOR_SUMMARY_PAGE_ALT in prefix_ws
                        ):
                            anchor_end_idx = end
                            break
                    break
        if anchor_end_idx is None:
            return None

        # anchor 종료 라인 직후의 후보 라인들을 순서대로 검증.
        # 부록의 경우 anchor 직후가 빈 토큰/기호/페이지번호인 경우가 많아 최대 5라인까지 검색.
        for offset in range(1, 6):
            j = anchor_end_idx + offset
            if j >= len(lines):
                break
            cand = _SUMMARY_LINE_TRIM.sub("", lines[j]).strip()
            if not _is_valid_company_candidate(cand):
                continue
            return cand, lines[j]
        return None

    return None


# ---------------------------------------------------------------------------
# decision_page (= 11p '1.허가결정') 전용 표 추출
# ---------------------------------------------------------------------------
# IEPS 검토결과서의 허가결정 페이지는 워드 표(2열 또는 임베디드 sub-table) 구조다.
# PyMuPDF 텍스트 추출 결과는 셀 단위로 텍스트가 분리되어 다음과 같이 흘러나오는 경우가 많다:
#   상호사업장        ← 라벨 (괄호도 글리프 분리됨)
#   (
#   )
#   주식회사 케이이씨 구미사업장
#   대표자 성명        ← 다음 라벨
#   ...
# 이때 `nextLine` locator 는 라벨 직후 1줄만 보므로 `(` 같은 노이즈를 값으로 잡는다.
# 따라서 "라벨 다음 → 다음 라벨 등장 전까지의 모든 라인" 을 모아 후처리하는 함수를 둔다.
# ---------------------------------------------------------------------------

# 라벨 토큰 — 표 안에서 행을 구분하는 좌측 라벨들 (공백 제거 비교 대상).
_DECISION_PAGE_ROW_LABELS = (
    "상호사업장",            # '상호(사업장)'
    "대표자성명",
    "법인등록번호사업자등록번호",  # '법인등록번호 / 사업자등록번호' 한 셀에 2줄로 들어가는 변형
    "법인등록번호",
    "사업자등록번호",
    "전화번호",
    "사업장소재지",
    "업종",
    "종규모",
    "통합허가에포함되는환경허가의종류",
    "통합허가에포함되는",         # 분할 변형
    "환경허가의종류",
    "생산품",
    "허가일자",
    "허가대상사업장의현황은다음과같다",  # anchor (이전 행과 분리할 때 stop 신호)
)


def _is_decision_page_row_label(line: str) -> bool:
    if not line:
        return False
    ws = _strip_ws(line)
    return ws in _DECISION_PAGE_ROW_LABELS


def _collect_decision_row_value(lines: List[str], label_idx: int) -> Tuple[str, str]:
    """label_idx 다음 라인부터 다음 라벨 등장 전까지의 모든 라인을 합쳐 반환.

    반환: (joined_value, source_line) — joined 은 줄바꿈으로 연결된 원형, source_line 은 첫 줄.
    """
    parts: List[str] = []
    j = label_idx + 1
    n = len(lines)
    while j < n:
        cur = lines[j]
        if _is_decision_page_row_label(cur):
            break
        parts.append(cur)
        j += 1
    joined = "\n".join(parts).strip()
    first = parts[0] if parts else ""
    return joined, first


# 빈 괄호/단일 기호 토큰 제거 — 결정페이지 표가 글리프 분리로 '(', ')' 가 별도 라인이라
# 합치고 나면 '( )' 같은 잔류물이 남는다. company_name / site_address 정리에 공통 사용.
_RE_EMPTY_PARENS = re.compile(r"\(\s*\)|（\s*）")
# 헤더 잔재 — "( 사업장 )" 가 그대로 합쳐진 경우 제거.
_RE_LABEL_PAREN_SAEUPJANG = re.compile(r"\(\s*사업장\s*\)")


def _strip_decision_join_noise(text: str) -> str:
    """`( )` / `(  )` / `( 사업장 )` 같이 표 헤더·글리프 잔여 토큰을 제거하고 공백 정리."""
    s = _RE_LABEL_PAREN_SAEUPJANG.sub("", text)
    s = _RE_EMPTY_PARENS.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = _SUMMARY_LINE_TRIM.sub("", s).strip()
    return s


def _join_decision_company(joined: str) -> Optional[str]:
    if not joined:
        return None
    flat = re.sub(r"\s+", " ", joined.replace("\n", " ")).strip()
    flat = _strip_decision_join_noise(flat)
    if re.fullmatch(r"\(|\)|·|-+|", flat):
        return None
    if not _is_valid_company_candidate(flat):
        return None
    return flat


def _join_decision_address(joined: str) -> Optional[str]:
    """주소 라인들을 합쳐 '경상북도 구미시 수출대로 41(공단동)' 류 복원.

    PyMuPDF 가 셀을 좌→우 순으로 읽지 못하면 동 이름이 번지보다 먼저 나오는 경우가
    있다(예: '경상북도 구미시 수출대로 / 공단동 / 41( / )'). 이런 경우 단순 평탄화로
    '… 공단동 41( )' 형태가 되는데, 그래도 사람이 보기에 자명하므로 그대로 둔다.
    """
    if not joined:
        return None
    flat = re.sub(r"\s+", " ", joined.replace("\n", " ")).strip()
    flat = _strip_decision_join_noise(flat)
    if not flat:
        return None
    return flat


def _extract_from_decision_page(text: str, rule_id: str) -> Optional[Tuple[str, str]]:
    """`_find_decision_page` 가 식별한 페이지 텍스트에서 표의 행 단위로 값 추출.

    `nextLine` locator 가 단일 다음 줄만 보는 한계를 보완해, 라벨 ~ 다음 라벨 사이의
    모든 라인을 결합해 값으로 사용한다. 회사명/주소 위주로 사용되며, 다른 필드는
    기존 locator 경로가 텍스트 그대로(여러 줄 포함) 잡고 있어 원래 흐름을 따른다.
    """
    if not text:
        return None
    lines = [ln.rstrip() for ln in text.splitlines()]
    if not lines:
        return None

    # permit_date — 글리프 깨짐으로 부로/환경부 anchor 매칭이 깨지는 케이스를 위한 폴백.
    # 평탄 텍스트 '허가한다 YYYY MM DD' 시퀀스에서 추출.
    if rule_id == "permit_date":
        text_flat = re.sub(r"\s+", " ", text)
        m = re.search(r"허가한다[^0-9]{0,30}(\d{4})\s+(\d{1,2})\s+(\d{1,2})", text_flat)
        if m:
            y, mo, d = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
            return f"{y}년 {mo}월 {d}일", text_flat[max(0, m.start() - 10) : m.end() + 10]
        return None

    # rule_id → 매칭할 라벨 목록
    label_targets: Tuple[str, ...] = ()
    if rule_id == "company_name":
        label_targets = ("상호사업장",)
    elif rule_id == "site_address":
        label_targets = ("사업장소재지",)
    else:
        return None

    for i, ln in enumerate(lines):
        if _strip_ws(ln) in label_targets:
            joined, first = _collect_decision_row_value(lines, i)
            if rule_id == "company_name":
                value = _join_decision_company(joined)
                if value:
                    return value, first or joined
            elif rule_id == "site_address":
                value = _join_decision_address(joined)
                if value:
                    return value, first or joined
    return None


# ---------------------------------------------------------------------------
# 표지 결정번호 폴백 (decision_no 전용)
# ---------------------------------------------------------------------------

# PyMuPDF 추출 시 표지 갑지 표가 셀 단위로 분리되어 다음과 같이 흩어지는 케이스가 다수다:
#     '제'  '호'  '0557-02'
# 이 때 `_extract_from_summary_page` 의 첫 3~4 행 검색만으로는 채택되지 않거나,
# `_find_summary_page` 의 명세서 anchor 자체가 깨져서 갑지를 못 찾는 경우가 있다.
# 이 폴백은 표지(1~3p) 전체에서 다음 두 단계를 시도한다:
#   (a) 표준 정규식 `제\s*NNNN-NN\s*호` 직접 매치
#   (b) 같은 페이지 내에 '제' / '호' 토큰이 모두 존재하면, 단독 'NNNN-NN' 매치를
#       페이지 번호(예: '5/113') 와 구분해서 채택.

_RE_DECISION_NO_BARE_COVER = re.compile(r"(?<![\d/])(\d{3,5}\s*-\s*\d{1,2})(?![\d/])")


def _extract_decision_no_from_cover(
    pages: List[Tuple[int, str]],
) -> Optional[Tuple[int, str, str]]:
    """표지(1~3p) 에서 결정번호 폴백 추출.

    반환: (page_num, value, source_line) 또는 None
    """
    cover_pages = [(p, t) for (p, t) in pages if 1 <= p <= 3 and t]
    for page_num, text in cover_pages:
        # (a) 정상 정규식 매치 — 셀 분리 안 된 PDF.
        m = RE_DECISION_NO.search(text)
        if m:
            value = re.sub(r"\s+", "", m.group(0))
            return page_num, value, m.group(0)

        # (b) 셀 분리 폴백 — '제' 토큰 인접성 검증.
        # 사업자등록번호('114-81-54648') 같은 동일 형태의 다른 NNN-NN 패턴을 잘못
        # 채택하지 않도록, 매치 직전 30자 이내에 '제' 토큰이 있을 때만 받아들인다.
        # PyMuPDF 가 셀 분리한 경우(예: '제\n호\n0557-02')에도 '제'가 매치 앞 몇 글자
        # 안에 떨어져 있어 통과한다.
        for m_bare in _RE_DECISION_NO_BARE_COVER.finditer(text):
            lookback_start = max(0, m_bare.start() - 30)
            if "제" not in text[lookback_start:m_bare.start()]:
                continue
            core = re.sub(r"\s+", "", m_bare.group(1))
            return page_num, f"제{core}호", m_bare.group(1)
    return None


# ---------------------------------------------------------------------------
# 표지 처분사항 표 폴백 (permit_date 전용)
# ---------------------------------------------------------------------------

# IEPS 검토결과서 표지(보통 1p) 에는 처분/변경 이력이 누적된 표가 있다.
#   2019.05.31   허 가              환경부 장관
#   2020.10.15   변경허가(...)       환경부 장관
# 본문 1.허가결정 단락이 '년 월 일' 형태로 비공개 마스킹되어 있는 PDF 가 다수라,
# 본문 정규식이 실패해도 표지 표에서 가장 최근 허가 일자를 폴백으로 채택한다.
# - '변경신고' 줄은 허가일자가 아니므로 제외한다.
# - 통합허가(-01호) 검토결과서의 표는 보통 1~2 행만 있어 '마지막=첫'이 되어 안전하다.

_RE_COVER_DATE_ONLY = re.compile(
    r"^\s*(\d{4})\s*[\.\-/]\s*(\d{1,2})\s*[\.\-/]\s*(\d{1,2})\s*\.?\s*$"
)
_RE_COVER_DATE_INLINE = re.compile(
    r"(\d{4})\s*[\.\-/]\s*(\d{1,2})\s*[\.\-/]\s*(\d{1,2})\s*\.?(?=\s|$)"
)
# '허가' 라벨 — 단독 '허 가', '최초 통합허가', 'N차 변경허가', '변경허가(...)' 등.
_RE_COVER_PERMIT_LABEL = re.compile(
    r"(?:최\s*초\s*통\s*합\s*허\s*가|변\s*경\s*허\s*가|^\s*허\s*가\b|^\s*허\s*가\s*$|차\s*변\s*경\s*허\s*가)"
)
_RE_COVER_REPORT_LABEL = re.compile(r"변\s*경\s*신\s*고")


def _extract_permit_date_from_cover(
    pages: List[Tuple[int, str]],
) -> Optional[Tuple[str, str]]:
    """표지(1~5p) 처분/변경사항 표에서 가장 최근 허가 일자를 추출.

    매치 정책:
      - 표지 표는 시간순 누적이라 가장 마지막 '허가' 일자를 채택.
      - '변경신고' 만 붙어 있는 줄은 허가일자가 아니므로 제외.
      - 패턴 A : 줄 전체가 'YYYY.MM.DD' (PyMuPDF 셀 분리 케이스). 다음 1~2 줄 안에서 라벨 검색.
      - 패턴 B : 한 줄에 'YYYY.MM.DD ... 변경허가' 가 같이 있음 (한화에어로스페이스 형).

    반환: (raw_value, source_line) 또는 None
      raw_value 는 `_normalize_value` 가 그대로 처리할 수 있도록 'YYYY년 MM월 DD일' 형식.
    """
    cover_pages = [t for (p, t) in pages if 1 <= p <= 5 and t]
    if not cover_pages:
        return None
    raw_lines = "\n".join(cover_pages).splitlines()
    lines = [ln.strip() for ln in raw_lines]
    n = len(lines)

    matches: List[Tuple[str, str, str, str]] = []
    for i, ln in enumerate(lines):
        if not ln:
            continue
        # 패턴 A: 줄이 날짜만으로 구성. 다음 1~2 줄에서 라벨 확인.
        m_a = _RE_COVER_DATE_ONLY.match(ln)
        if m_a:
            label_window = " ".join(lines[i + 1 : min(i + 3, n)])
            if _RE_COVER_REPORT_LABEL.search(label_window):
                continue
            if _RE_COVER_PERMIT_LABEL.search(label_window):
                matches.append((m_a.group(1), m_a.group(2), m_a.group(3), label_window[:60]))
            continue
        # 패턴 B: 한 줄에 날짜 + 라벨 동시.
        m_b = _RE_COVER_DATE_INLINE.search(ln)
        if m_b:
            tail = ln[m_b.end():]
            if _RE_COVER_REPORT_LABEL.search(tail):
                continue
            if _RE_COVER_PERMIT_LABEL.search(tail):
                matches.append((m_b.group(1), m_b.group(2), m_b.group(3), tail.strip()[:60]))

    if not matches:
        return None
    y, mo, d, label = matches[-1]
    raw_value = f"{y}년 {mo.zfill(2)}월 {d.zfill(2)}일"
    return raw_value, label


# ---------------------------------------------------------------------------
# Locator 별 매처
# ---------------------------------------------------------------------------

def _match_right_of_keyword(
    pages: List[Tuple[int, str]], keyword: str
) -> Optional[Tuple[int, str, str]]:
    if not keyword:
        return None
    pattern = re.compile(re.escape(keyword) + r"\s*[:：]?\s*(.+)")
    for page_num, _, line in _line_iter(pages):
        m = pattern.search(line)
        if m:
            value = m.group(1).strip().strip(":：").strip()
            if value:
                return page_num, value, line
    return None


def _match_left_of_keyword(
    pages: List[Tuple[int, str]], keyword: str
) -> Optional[Tuple[int, str, str]]:
    if not keyword:
        return None
    pattern = re.compile(r"(.+?)\s*[:：]?\s*" + re.escape(keyword))
    for page_num, _, line in _line_iter(pages):
        m = pattern.search(line)
        if m:
            value = m.group(1).strip().strip(":：").strip()
            if value:
                return page_num, value, line
    return None


def _match_same_row_next(
    pages: List[Tuple[int, str]], keyword: str
) -> Optional[Tuple[int, str, str]]:
    """탭/공백으로 구분된 같은 행에서 키워드 다음 칸을 찾는다."""
    if not keyword:
        return None
    for page_num, _, line in _line_iter(pages):
        if keyword not in line:
            continue
        cols = _split_columns(line)
        for i, col in enumerate(cols):
            if keyword in col and i + 1 < len(cols):
                return page_num, cols[i + 1], line
    return None


def _match_next_line(
    pages: List[Tuple[int, str]], keyword: str
) -> Optional[Tuple[int, str, str]]:
    if not keyword:
        return None
    for page_num, text in pages:
        lines = text.splitlines()
        for idx, line in enumerate(lines):
            if keyword in line and idx + 1 < len(lines):
                value = lines[idx + 1].strip()
                if value:
                    return page_num, value, line
    return None


_BODY_STOP_PATTERN = re.compile(
    r"(이검토결과서|이허가에|법에서|결과서에|준수하여야|사항을준수|허가한다|보고한다|통합법제\d+조|"
    r"각법에서|정하여|정한사항|환경부장관)"
)


def _is_next_label_line(line: str, current_keyword: str) -> bool:
    """nextChunk가 멈춰야 할 '다음 라벨' 라인인지 판정.

    공백을 제거한 라인이 IEPS_DECISION_LABELS 중 하나로 시작하고, 라벨 길이를
    크게 넘지 않으면 라벨 행으로 본다. 또한 본문 종결문/법령 인용("이검토결과서…",
    "통합법 제10조…", "환경부 장관" 등)으로 시작하는 라인도 chunk 종료로 본다.
    """
    if not line:
        return False
    stripped = _strip_ws(line)
    if not stripped:
        return False
    if _BODY_STOP_PATTERN.search(stripped):
        return True
    cur = _strip_ws(current_keyword) if current_keyword else ""
    for lbl in IEPS_DECISION_LABELS:
        ws_lbl = _strip_ws(lbl)
        if ws_lbl == cur:
            continue
        if ws_lbl in ("통합허가에", "통합허가에포함되는", "환경허가의종류") and stripped.startswith(ws_lbl):
            return True
        if stripped.startswith(ws_lbl) and len(stripped) <= len(ws_lbl) + 8:
            return True
    return False


def _match_next_chunk(
    pages: List[Tuple[int, str]], keyword: str
) -> Optional[Tuple[int, str, str]]:
    """keyword 매칭 라인 다음부터 빈 줄/다음 라벨 직전까지의 라인들을 묶어 반환한다.

    같은 줄에 keyword 뒤로 값이 함께 있는 경우(예: "종 규모  대기 1종 ...")도
    그 부분을 chunk의 첫 줄로 포함한다.
    """
    if not keyword:
        return None
    for page_num, text in pages:
        lines = text.splitlines()
        for idx, line in enumerate(lines):
            if keyword not in line:
                continue
            collected: List[str] = []
            after = line.split(keyword, 1)[1].lstrip(" :：\t").strip()
            if after:
                collected.append(after)
            for j in range(idx + 1, len(lines)):
                nxt = lines[j].strip()
                if not nxt:
                    if collected:
                        break
                    continue
                if _is_next_label_line(nxt, keyword):
                    break
                collected.append(nxt)
                # IEPS 갑지 표가 라벨/값/라벨/값/... 로 alternating 추출되는 PDF에서
                # chunk가 너무 커지지 않도록 안전 상한을 둔다.
                if len(collected) >= 12:
                    break
            if collected:
                return page_num, "\n".join(collected), line
    return None


def _match_regex(
    pages: List[Tuple[int, str]], pattern: str, keyword: Optional[str] = None
) -> Optional[Tuple[int, str, str]]:
    if not pattern:
        return None
    try:
        regex = re.compile(pattern)
    except re.error:
        return None
    # 1차: 줄 단위 매칭 (대부분의 정규식이 한 줄에 완결)
    for page_num, _, line in _line_iter(pages):
        if keyword and keyword not in line and not regex.search(line):
            continue
        m = regex.search(line)
        if m:
            value = m.group(0)
            return page_num, value.strip(), line
    # 2차: 페이지 전체 매칭 — IEPS 검토결과서처럼 표/문장이 줄바꿈으로 끊겨 있는 경우
    # (예: "...2020년11월30일\n부로 ... 허가한다") `\s*`가 \n을 흡수하여 매칭됨.
    for page_num, text in pages:
        if not text:
            continue
        m = regex.search(text)
        if m:
            value = m.group(0)
            start = m.start()
            line_start = text.rfind("\n", 0, start) + 1
            nl = text.find("\n", m.end())
            line_end = nl if nl >= 0 else len(text)
            source_line = text[line_start:line_end].strip()
            return page_num, value.strip(), source_line
    return None


# ---------------------------------------------------------------------------
# 정규화 함수 (결과 후처리)
# ---------------------------------------------------------------------------

def _split_products_csv(blob: str) -> List[str]:
    """업종 표기에 부속된 생산품 콤마 나열을 토큰 리스트로 분해.

    - 천 단위 콤마는 분리하지 않는다 (생산품에 숫자 단위가 따라오지 않음).
    - 빈 토큰/너무 긴 토큰(설명 문장으로 추정) 제거.
    """
    if not blob:
        return []
    parts = [t.strip(" .·-") for t in re.split(r"[,，]", blob)]
    out: List[str] = []
    for p in parts:
        if not p:
            continue
        if len(p) > 30:
            continue
        if not re.search(r"[가-힣A-Za-z]", p):
            continue
        out.append(p)
    return out


def _attach_ksic(entry: Dict[str, Any]) -> Dict[str, Any]:
    """{code, name, products} 엔트리에 KSIC 11차 룩업을 적용해 코드/공식명을 보강.

    - code 가 5자리이고 KSIC 표에 존재하면 공식명으로 name 갱신 (없으면 그대로).
    - code 가 4자리면 prefix + 이름 fuzzy 로 5자리 추정 (single → 자동, 다수 → 이름 매칭).
    - code 가 없으면 이름 기반 lookup_industry 시도.
    호출 실패 시 입력 엔트리를 그대로 반환한다 (KSIC 모듈 로드 실패 등 안전망).
    """
    try:
        from .ksic_lookup import (
            lookup_industry,
            lookup_industry_by_4digit_prefix,
            lookup_industry_by_3digit_prefix,
            get_canonical_by_code,
        )
    except Exception:  # 모듈 누락/순환 import 안전망
        return entry

    code = (entry.get("code") or "").strip() or None
    name = (entry.get("name") or "").strip() or None

    if code and len(code) == 5:
        canonical = get_canonical_by_code(code)
        if canonical:
            entry["name"] = canonical
        return entry
    if code and len(code) == 4:
        new_code, canonical, _conf = lookup_industry_by_4digit_prefix(code, name)
        if new_code:
            entry["code"] = new_code
            entry["name"] = canonical or name or entry.get("name")
        return entry
    if code and len(code) == 3:
        new_code, canonical, _conf = lookup_industry_by_3digit_prefix(code, name)
        if new_code:
            entry["code"] = new_code
            entry["name"] = canonical or name or entry.get("name")
        return entry
    if not code and name:
        new_code, canonical, _conf = lookup_industry(name)
        if new_code:
            entry["code"] = new_code
            entry["name"] = canonical or name
    return entry


def _normalize_industry_line(line: str) -> Optional[Dict[str, Any]]:
    """업종 한 줄 → {code, name, products} 파싱.

    매칭 우선순위(좁은 패턴 → 넓은 패턴):
      1. `이름 (5자리코드, 생산품, ...)` — 괄호에 코드+생산품 부속
      2. `(5자리코드) 이름`             — 코드가 괄호 안에 먼저 옴
      3. `이름 (5자리코드)`             — 정규 괄호
      4. `이름 [5자리코드]`             — 대괄호
      5. `5자리코드 이름`               — 코드 → 이름 (콤마 시작 포함)
      6. `5자리코드` + 임의 lookahead   — 광범위 폴백
      7. 코드+이름 + ` : 생산품, ...`   — 콜론으로 부속 생산품
      8. `5자리, 다중어 이름`           — `24212, 알루미늄, 제련, 정련및합금제조업` 평탄형
      9. `이름 (4자리코드, ...)`        — 4자리 폴백 (KSIC prefix 룩업 위임)
     10. `이름 [4자리코드]`             — 4자리 + 대괄호
     11. `(4자리코드) 이름`             — 4자리 코드 선행
     12. `이름 (3자리코드)` / `[3자리]` — 3자리 폴백 (KSIC prefix 룩업 위임)
     13. `(3자리코드) 이름`             — 3자리 코드 선행
     14. `이름 (생산품, 생산품)`        — 코드 없이 생산품만 부속 (제조업 끝나는 한국어)
     15. 코드/괄호 없는 순수 이름       — `이름 외 N종` 접미 정리 후 KSIC 이름 lookup
    """
    s = line.strip().strip(",.")
    if not s:
        return None
    products: List[str] = []

    # 1) 이름 (5자리코드, 생산품, ...)
    m = RE_INDUSTRY_NAME_FIRST_PARENS_RICH.search(s)
    if m:
        code_str = m.group(2)
        # 5자리만 가져옴; 4자리면 fall-through 처리 후 4자리 분기에서 받게 한다.
        if len(code_str) == 5:
            products = _split_products_csv(m.group(3))
            return _attach_ksic(
                {"code": code_str, "name": m.group(1).strip(), "products": products}
            )

    # 2) (코드) 이름
    m = re.match(r"\(\s*(\d{5})\s*\)\s*(.+)", s)
    if m:
        return _attach_ksic(
            {"code": m.group(1), "name": m.group(2).strip().strip(",."), "products": []}
        )

    # 3) 이름 (코드)
    m = RE_INDUSTRY_NAME_FIRST.search(s)
    if m:
        return _attach_ksic(
            {"code": m.group(2), "name": m.group(1).strip(), "products": []}
        )

    # 4) 이름 [코드]
    m = RE_INDUSTRY_NAME_FIRST_BRACKET.search(s)
    if m:
        return _attach_ksic(
            {"code": m.group(2), "name": m.group(1).strip(), "products": []}
        )

    # 7) 코드 이름 : 생산품 — `20129 ... 제조업 : 과산화수소` (콜론 구분자가 항목 분리에 우선)
    m = RE_INDUSTRY_CODE_NAME_COLON_PRODUCTS.search(s)
    if m:
        products = _split_products_csv(m.group(3))
        return _attach_ksic(
            {"code": m.group(1), "name": m.group(2).strip(), "products": products}
        )

    # 5) 코드 → 이름 (콤마/공백/마침표 구분, 콤마 시작 표기 포함)
    m = RE_INDUSTRY_CODE_FIRST.search(s)
    if m:
        return _attach_ksic(
            {
                "code": m.group(1),
                "name": m.group(2).strip().strip(","),
                "products": [],
            }
        )

    # 6) 광범위 폴백 — 코드 + 임의 짧은 이름
    m = RE_INDUSTRY_CODE_NAME.search(s)
    if m:
        return _attach_ksic(
            {"code": m.group(1), "name": m.group(2).strip(), "products": []}
        )

    # 8) 5자리 코드 + 콤마로 평탄화된 다중어 이름 — `24212, 알루미늄, 제련, ...제조업`.
    #    PDF 의 표 셀이 한 줄로 합쳐지면서 공백이 콤마로 변환된 케이스. 이름 안의 콤마/공백을
    #    공백 1개로 정리해 KSIC 정규화 매칭(공백 제거 후 동치)에 그대로 넘긴다.
    m = RE_INDUSTRY_CODE_COMMA_NAME.match(s)
    if m:
        name_raw = m.group(2)
        cleaned_name = re.sub(r"[,，]", " ", name_raw)
        cleaned_name = re.sub(r"\s+", " ", cleaned_name).strip()
        return _attach_ksic(
            {"code": m.group(1), "name": cleaned_name, "products": []}
        )

    # 9) 4자리 코드 폴백 — `이름 (2411)` / `이름 (2411, 생산품)`
    m = RE_INDUSTRY_NAME_FIRST_PARENS_RICH.search(s)
    if m and len(m.group(2)) == 4:
        products = _split_products_csv(m.group(3))
        return _attach_ksic(
            {"code": m.group(2), "name": m.group(1).strip(), "products": products}
        )
    m = RE_INDUSTRY_NAME_FIRST_4.search(s)
    if m:
        return _attach_ksic(
            {"code": m.group(2), "name": m.group(1).strip(), "products": []}
        )
    # 11) (4자리) 이름
    m = re.match(r"\(\s*(\d{4})\s*\)\s*(.+)", s)
    if m:
        return _attach_ksic(
            {"code": m.group(1), "name": m.group(2).strip().strip(",."), "products": []}
        )

    # 12) 3자리 코드 폴백 — `1차 철강 제조업(241)` / `[241]`
    m = RE_INDUSTRY_NAME_FIRST_3.search(s)
    if m:
        return _attach_ksic(
            {"code": m.group(2), "name": m.group(1).strip(), "products": []}
        )
    # 13) (3자리) 이름
    m = re.match(r"\(\s*(\d{3})\s*\)\s*(.+)", s)
    if m:
        return _attach_ksic(
            {"code": m.group(1), "name": m.group(2).strip().strip(",."), "products": []}
        )

    # 14) 코드 없이 `이름 (생산품, 생산품)` — KSIC lookup 으로 코드 보강
    m = RE_INDUSTRY_NAME_FIRST_PRODUCTS_ONLY.search(s)
    if m:
        # 괄호 안이 코드 토큰이면 다른 패턴이 먼저 매칭되었어야 하므로 여기 도달하지 않는다.
        products = _split_products_csv(m.group(2))
        if products:
            return _attach_ksic(
                {"code": None, "name": m.group(1).strip(), "products": products}
            )

    # 15) 코드/괄호 없는 순수 이름 — `이름 외 N종` 접미 정리 후 KSIC 이름 lookup.
    #     `복합비료 및 기타 화학비료 제조업 외 4종` / `합성수지 및 기타플라스틱물질 제조`.
    cleaned = RE_TRAILING_OTHERS.sub("", s).strip()
    if cleaned and RE_INDUSTRY_NAME_SUFFIX.search(cleaned):
        return _attach_ksic({"code": None, "name": cleaned, "products": []})
    return None


# 항목 구분용 콤마(공백/줄바꿈/끝이 따라옴) — 천 단위 콤마(`3,182`)는 분리 대상에서 제외.
_ITEM_SEPARATOR = re.compile(r",(?=\s|$)|，(?=\s|$)")


def _normalize_product_segment(seg: str) -> Optional[Dict[str, Any]]:
    """생산품 단일 항목 → {product_name, amount, unit}.

    지원 패턴 예시:
      - "냉연강판 (714 톤/일)"
      - "스틸코드: 116.4 톤/일"
      - "전기: 3,182MWh/일(최대)"   (천 단위 콤마 + 후행 괄호 주석)
      - "BW선 104.87 톤/일"
      - "카프로릭탐"               (양/단위 없음)

    nextChunk 가 너무 많이 가져와서 본문 문장/시설명/날짜 같은 노이즈가
    섞여 들어올 수 있어, 명백한 비-생산품 라인은 None 으로 거른다.
    """
    s = seg.strip()
    s = re.sub(r"\s*등$", "", s)
    s = s.strip(" .")
    if not s:
        return None
    # 1) 시설/공정 설명 (대괄호/꺽쇠 시작) — 생산품이 아니라 본문 텍스트로 본다.
    if s.startswith("[") or s.startswith("〔") or s.startswith("「"):
        return None
    # 2) 너무 짧거나 너무 긴 라인은 제외 (생산품명은 보통 2~40자)
    if len(s) < 2 or len(s) > 60:
        return None
    # 3) 날짜 단편 ("2020년", "11월30일", "11월 30일") — 페이지 하단 허가일자가 빨려 들어온 경우.
    if re.fullmatch(r"\d+\s*[년월일/.\-]\s*\d*\s*[년월일]?\s*", s):
        return None
    if re.fullmatch(r"\d{4}\s*[\.년\-/]\s*\d{1,2}\s*[\.월\-/]\s*\d{1,2}\s*[\.일]?\s*", s):
        return None
    # 4) 본문 종결어/법령 인용/페이지 푸터 — 생산품 라인이 아님.
    if re.search(
        r"(허가한다|보고한다|환경부|장관|법인등록|이\s*허가|통합허가|허가신청|"
        r"이검토|결과서|기재|준수|사항|법에서|통합법|정한|시행|이행|조항|제\s*\d+\s*조|제\s*\d+\s*항)",
        s,
    ):
        return None
    # 5) 숫자만/기호만 있는 라인 제외
    if not re.search(r"[가-힣A-Za-z]", s):
        return None

    # 후행 괄호 주석 (예: "...(최대)", "(연간)") — 단위 매칭에 방해가 되므로 제거 후 시도.
    # 다만 괄호 안에 숫자가 있으면 진짜 단위 표기(예: "TR(11톤/년)")일 가능성이 높으므로 보존.
    _PAREN_HAS_NUM = re.compile(r"[（(][^()（）]*\d[^()（）]*[)）]\s*$")
    if _PAREN_HAS_NUM.search(s):
        s_clean = s
    else:
        s_clean = re.sub(r"\s*[（(][^()（）]{0,12}[)）]\s*$", "", s).strip()

    # 패턴 우선순위:
    #  (a) "이름:  수량 단위"
    #  (b) "이름 (수량 단위)"
    #  (c) "이름  수량 단위"
    for pat in (
        r"^(.+?)\s*[:：]\s*([\d,]+(?:\.\d+)?)\s*([가-힣A-Za-z/㎡㎥³²]+)\s*$",
        r"^(.+?)\s*[（(]\s*([\d,]+(?:\.\d+)?)\s*([가-힣A-Za-z/㎡㎥³²]+)\s*[)）]\s*$",
        r"^(.+?)\s+([\d,]+(?:\.\d+)?)\s*([가-힣A-Za-z/㎡㎥³²]+)\s*$",
    ):
        m = re.match(pat, s_clean)
        if m:
            return {
                "product_name": m.group(1).strip().rstrip(":：").strip(),
                "amount": _to_float(m.group(2)),
                "unit": m.group(3).strip() or None,
            }
    return {"product_name": s_clean or s, "amount": None, "unit": None}


def _normalize_value(rule: ExtractionRule, value: str) -> Tuple[Any, float]:
    """값을 정규화하고 confidence 보정값을 함께 반환."""
    if value is None:
        return None, 0.0

    text = value.strip()

    if rule.id == "decision_no":
        m = RE_DECISION_NO.search(text)
        if m:
            return re.sub(r"\s+", "", m.group(0)), 0.95
        return text, 0.5

    if rule.id == "business_registration_no":
        m = RE_BIZ_REG_NO.search(text)
        if m:
            cleaned = re.sub(r"\s+", "", m.group(0))
            # PDF에 EN DASH 등 unicode dash 가 섞여 있어도 DB에는 ASCII hyphen 으로 통일.
            cleaned = re.sub(rf"[{_DASH_CHARS}]", "-", cleaned)
            return cleaned, 0.95
        return text, 0.4

    if rule.id == "company_name":
        # PDF별 표기 차이를 통일 ('주식회사', '(주)', '㈜' → '㈜'). 유한회사는 그대로.
        normalized_name = _normalize_company_name(text)
        if normalized_name:
            return normalized_name, 0.85
        return text, 0.5

    if rule.id == "phone_number":
        m = RE_PHONE.search(text)
        if m:
            phone = re.sub(r"\s+", "", m.group(0))
            return phone, 0.85
        return text, 0.5

    if rule.id == "industry_code_name":
        # 다중 라인 + 슬래시 + 콤마 다단 분리. 업종명에 자체적으로 콤마가 들어가는 경우
        # (예: "(35300) 증기, 냉·온수 및 공기조절 공급업")가 있으므로 라인/슬래시 chunk
        # 통째 매칭을 먼저 시도하고, 실패할 때만 콤마 분리 폴백.
        items: List[Dict[str, Any]] = []

        def _add(entry: Optional[Dict[str, Any]]) -> None:
            if not entry:
                return
            # 동일 코드 엔트리 발견 시 products 만 합쳐 dedupe — 다중 라인 표기 흡수.
            for ex in items:
                if ex.get("code") and ex.get("code") == entry.get("code"):
                    seen = set(ex.get("products") or [])
                    for p in entry.get("products") or []:
                        if p not in seen:
                            ex.setdefault("products", []).append(p)
                            seen.add(p)
                    return
            items.append(entry)

        raw_lines = [ln.strip() for ln in text.split("\n")]
        # (a) 라인 단위 매칭 + 슬래시 chunk 분해 + 콤마 split 폴백.
        for line in raw_lines:
            if not line:
                continue
            for chunk in re.split(r"\s+/\s+", line):
                chunk = chunk.strip()
                if not chunk:
                    continue
                parsed_chunk = _normalize_industry_line(chunk)
                if parsed_chunk:
                    _add(parsed_chunk)
                    continue
                for seg in _ITEM_SEPARATOR.split(chunk):
                    _add(_normalize_industry_line(seg))
        # (b) 인접 라인 페어링 — 표 셀 분리로 "이름" 라인 + "코드" 라인이 별도 행에
        # 나오는 케이스(케이이씨 11p 형). 패턴: 한글/영문 이름 라인 ↔ 5자리 코드 라인.
        if not items:
            i = 0
            n = len(raw_lines)
            while i < n - 1:
                a = raw_lines[i].strip().strip(",.")
                b = raw_lines[i + 1].strip().strip(",.")
                if not a or not b:
                    i += 1
                    continue
                m_code = re.fullmatch(r"(\d{5})", b)
                if (
                    m_code
                    and re.search(r"[가-힣]", a)
                    and not re.search(r"\d{5}", a)
                ):
                    _add(_attach_ksic({"code": m_code.group(1), "name": a, "products": []}))
                    i += 2
                    continue
                m_code_a = re.fullmatch(r"(\d{5})", a)
                if (
                    m_code_a
                    and re.search(r"[가-힣]", b)
                    and not re.search(r"\d{5}", b)
                ):
                    _add(_attach_ksic({"code": m_code_a.group(1), "name": b, "products": []}))
                    i += 2
                    continue
                i += 1
        if items:
            if len(items) == 1:
                return items[0], 0.9
            return items, 0.9
        return text, 0.4

    if rule.id == "permit_date" or rule.result_type == "date":
        # 부로/환경부 컨텍스트 정규식 우선, 못 찾으면 일반 날짜 정규식 fallback.
        m = RE_PERMIT_DATE_ANCHOR.search(text) or RE_PERMIT_DATE.search(text)
        if m:
            y, mo, d = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
            return f"{y}-{mo}-{d}", 0.9
        # 글리프 깨짐 폴백 — 결정페이지 1번 항목 "...년 ...월 ...일 허가한다" 가
        # PyMuPDF 추출 시 라벨과 숫자가 분리되는 케이스. 평탄화 텍스트에서
        # "허가한다" 토큰 직후의 'YYYY MM DD' 3숫자 시퀀스를 채택.
        text_flat = re.sub(r"\s+", " ", text)
        m2 = re.search(r"허가한다[^0-9]{0,10}(\d{4})\s+(\d{1,2})\s+(\d{1,2})", text_flat)
        if m2:
            y, mo, d = m2.group(1), m2.group(2).zfill(2), m2.group(3).zfill(2)
            return f"{y}-{mo}-{d}", 0.75
        return text, 0.4

    if rule.id == "permit_scale":
        # 다중 라인 텍스트 안에서 air/water/amount 모두 추출. 두 줄 분리 형태도 처리됨.
        # 표 셀 분리로 라벨/단위/숫자가 모두 별도 라인일 수 있어, 줄바꿈을 공백으로 평탄화한
        # 보조 텍스트(text_flat)를 함께 검색해 매칭률을 높인다.
        # 예: '대기 종\n톤년\n수질 종\n일\n2\n(20.1\n/\n),\n1\n(2,222.9\n/\n)\n㎥'
        #   → '대기 종 톤년 수질 종 일 2 (20.1 / ), 1 (2,222.9 / ) ㎥'
        text_flat = re.sub(r"\s+", " ", text)
        sources = (text, text_flat)
        air = next((m for m in (RE_AIR_CLASS.search(s) for s in sources) if m), None)
        water = next((m for m in (RE_WATER_CLASS.search(s) for s in sources) if m), None)
        air_amount = next((m for m in (RE_AIR_AMOUNT.search(s) for s in sources) if m), None)
        water_amount = next((m for m in (RE_WATER_AMOUNT.search(s) for s in sources) if m), None)
        result: Dict[str, Any] = {}
        if air:
            result["air_class"] = int(air.group(1))
        if water:
            result["water_class"] = int(water.group(1))
        if air_amount:
            result["air_amount_ton_per_year"] = _to_float(air_amount.group(1))
        if water_amount:
            result["wastewater_m3_per_day"] = _to_float(water_amount.group(1))

        # 글리프 깨짐 폴백 — 표 셀 분리로 등급 숫자(2종, 1종)와 발생량(20.1톤/년,
        # 2,222.9㎥/일)이 모두 단편화되는 경우.
        # 평탄 텍스트 예: '대기 종 톤년 수질 종 일 2 (20.1 / ), 1 (2,222.9 / ) ㎥'
        # → '대기 종' 과 '수질 종' 라벨이 있고 그 뒤로 'N (X.X' 패턴이 두 번 등장.
        # 첫 번째를 대기, 두 번째를 수질로 위치 기반 페어링한다.
        if (
            "대기" in text_flat
            and "수질" in text_flat
            and (
                "air_class" not in result
                or "water_class" not in result
                or "air_amount_ton_per_year" not in result
                or "wastewater_m3_per_day" not in result
            )
        ):
            pairs = list(
                re.finditer(r"(\d+)\s*\(\s*([\d,]+(?:\.\d+)?)\s*/", text_flat)
            )
            if len(pairs) >= 1:
                result.setdefault("air_class", int(pairs[0].group(1)))
                result.setdefault("air_amount_ton_per_year", _to_float(pairs[0].group(2)))
            if len(pairs) >= 2:
                result.setdefault("water_class", int(pairs[1].group(1)))
                result.setdefault("wastewater_m3_per_day", _to_float(pairs[1].group(2)))

        # 표 셀 추출 순서가 더 심하게 깨진 경우:
        #   대기 종 / 2 / (24.81 톤년 / 수질 종 / ... / ), / 3 / (247.28 ... 일 /)
        # 이 때 '대기 2종' / '수질 3종' 형태가 아니므로 라벨 뒤의 "N (" 페어 순서로
        # 첫 번째는 대기, 두 번째는 수질 등급으로만 회수한다.
        if (
            "대기" in text_flat
            and "수질" in text_flat
            and ("air_class" not in result or "water_class" not in result)
        ):
            class_pairs = list(re.finditer(r"\b([1-5])\s*\(", text_flat))
            if len(class_pairs) >= 1:
                result.setdefault("air_class", int(class_pairs[0].group(1)))
            if len(class_pairs) >= 2:
                result.setdefault("water_class", int(class_pairs[1].group(1)))

        if result:
            confidence = 0.6 + 0.1 * len(result)
            return result, min(confidence, 0.95)
        return text, 0.4

    if rule.id == "product_output":
        # 항목 구분 콤마(공백/끝이 따라옴)만 분리하여 천 단위 콤마(`3,182`)는 보존.
        # 결정페이지 표가 셀 분리로 단위(예: '톤/년')가 별도 라인으로 떨어지는 경우
        # 단순 라인 단위 처리는 단위만 product_name 으로 잡혀 노이즈가 된다.
        # → 단위 단독 라인 / 슬래시 단독 라인 / 빈 라인 / 단일 기호 라인은 사전 제거하고,
        #    남은 텍스트를 공백으로 평탄화한 후 항목 콤마로 split 한다.
        _UNIT_ONLY = re.compile(r"^[가-힣A-Za-z㎡㎥³²/]{1,4}$")
        cleaned_lines: List[str] = []
        for raw_line in text.split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            # '·' / '-' / '(' 단독 라인만 제거. '/' 와 ')' 는 단위 괄호 일부일 수 있어 보존.
            if line in ("·", "-", "("):
                continue
            if _UNIT_ONLY.fullmatch(line) and re.fullmatch(r"[가-힣]+", line):
                # '톤년', '일' 같이 한글 단독 단위 라인은 다음 라인에서 단위로 합쳐지지 않는 한 노이즈.
                continue
            cleaned_lines.append(line)
        flat = " ".join(cleaned_lines)
        flat = re.sub(r"\s+", " ", flat).strip()
        # 결정페이지 nextChunk 가 본문(허가 본문 단락)까지 가져오는 경우, 본문 시작 마커
        # 직전에서 잘라 노이즈를 차단한다. 마커 후보: "이 허가는", "허가일자", 표 종료 후 본문.
        for marker in ("이 허가는", "이허가는", "허가일자"):
            mi = flat.find(marker)
            if mi >= 0:
                flat = flat[:mi].strip()
                break
        # 결정페이지 표 분리 케이스 — 'TR(11 /), IC(5 /), MOS(5 /)' 처럼 단위가 슬래시
        # 뒤에서 끊긴 형태가 자주 나온다. 공백+슬래시+공백+`)` 패턴을 '/년)' 으로 복원해
        # _normalize_product_segment 가 수량/단위를 정확히 잡도록 한다.
        flat = re.sub(r"\(\s*([\d,]+(?:\.\d+)?)\s*/\s*\)", r"(\1톤/년)", flat)
        items: List[Dict[str, Any]] = []
        # (a) 평탄 텍스트에서 항목 콤마 분리.
        for seg in _ITEM_SEPARATOR.split(flat):
            parsed = _normalize_product_segment(seg)
            if parsed and parsed not in items:
                items.append(parsed)
        # (b) 평탄화 결과가 비었거나 한 개도 못 잡으면 라인 단위 fallback (이전 동작 유지).
        if not items:
            for raw_line in text.split("\n"):
                line = raw_line.strip()
                if not line:
                    continue
                for seg in _ITEM_SEPARATOR.split(line):
                    parsed = _normalize_product_segment(seg)
                    if parsed and parsed not in items:
                        items.append(parsed)
        if items:
            if len(items) == 1:
                return items[0], 0.75
            return items, 0.8
        return text, 0.4

    # 사용자 정의 규칙: result_type 기반 정규화
    if rule.result_type == "number":
        n = _to_float(text)
        return n, 0.7 if n is not None else 0.3

    if rule.result_type == "codeName":
        m = RE_INDUSTRY_CODE_NAME.search(text)
        if m:
            return {"code": m.group(1), "name": m.group(2).strip()}, 0.7
        return text, 0.5

    return text, 0.6


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# 법인격 통일 규칙: '(주)', '주식회사' → '㈜' 로 일관 표기. '유한회사'/'(유)'는 그대로.
_RE_PAREN_JU = re.compile(r"\(\s*주식회사\s*\)|\(\s*주\s*\)")
_RE_JUSIK = re.compile(r"주식회사")
_RE_HUYU = re.compile(r"유한\s*회사|\(\s*유\s*\)")


def _normalize_company_name(name: Optional[str]) -> Optional[str]:
    """상호 표기 통일. PDF 마다 '(주)/㈜/주식회사'가 혼재돼 있어 DB에 단일 표기로 저장.

    - 유한회사/(유): '유한회사' 로 통일하여 보존 (㈜ 변환 적용 안 함).
    - 주식회사 / (주) / (주식회사): 모두 '㈜' 로 변환.
    - 양옆/연속 공백 정리는 하되, 회사명 내부 공백(예: "케이지동부제철㈜ 인천공장")은 보존.
    """
    if not name:
        return name
    s = name.strip()
    if not s:
        return s
    # 유한회사 / (유) 가 들어 있으면 ㈜ 변환은 적용하지 않고 표기만 '유한회사'로 통일.
    if _RE_HUYU.search(s):
        s = _RE_HUYU.sub("유한회사", s)
        return re.sub(r"\s+", " ", s).strip()
    # ㈜ 변환: '(주)', '(주식회사)' → '㈜', 그 후 '주식회사' → '㈜'.
    s = _RE_PAREN_JU.sub("㈜", s)
    s = _RE_JUSIK.sub("㈜", s)
    # 다중 공백 정리 (양옆 공백 trim + 내부 연속 공백 1칸으로).
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# 메인 엔진
# ---------------------------------------------------------------------------

def _dispatch_locator(
    pages: List[Tuple[int, str]], rule: ExtractionRule, keyword: Optional[str] = None
) -> Optional[Tuple[int, str, str]]:
    """rule.locator 에 따라 적절한 매처 호출."""
    kw = keyword if keyword is not None else (rule.keyword or "")
    if rule.locator == "rightOfKeyword":
        return _match_right_of_keyword(pages, kw)
    if rule.locator == "leftOfKeyword":
        return _match_left_of_keyword(pages, kw)
    if rule.locator == "sameRowNext":
        return _match_same_row_next(pages, kw)
    if rule.locator == "nextLine":
        return _match_next_line(pages, kw)
    if rule.locator == "nextChunk":
        return _match_next_chunk(pages, kw)
    if rule.locator == "regex":
        return _match_regex(pages, rule.regex or "", keyword if keyword is not None else rule.keyword)
    return None


# 명세서 갑지 페이지에서만 추출하는 룰 (decision_no, company_name).
SUMMARY_PAGE_RULE_IDS = {"decision_no", "company_name"}


def apply_rule(
    pages: List[Tuple[int, str]],
    rule: ExtractionRule,
    decision_page: Optional[int] = None,
    summary_page: Optional[int] = None,
) -> ParsedField:
    """단일 규칙에 대해 페이지 텍스트를 검색 → ParsedField 반환.

    추출 우선순위:
      1) `summary_page` 가 발견된 경우 + rule.id ∈ SUMMARY_PAGE_RULE_IDS:
         그 페이지의 4줄 정형 포맷에서 직접 추출(가장 신뢰도 높음).
      2) `decision_page` 가 발견된 경우 + rule.id ∈ DECISION_PAGE_RULE_IDS:
         그 페이지로 page_range 를 동적 override 하여 locator 매처 실행.
      3) 그래도 못 찾으면 rule.page_range / 전체 페이지로 fallback.
    """
    # (1) 명세서 갑지 우선 — decision_no / company_name 만 해당.
    if summary_page is not None and rule.id in SUMMARY_PAGE_RULE_IDS:
        summary_text = next((t for (p, t) in pages if p == summary_page), "")
        direct = _extract_from_summary_page(summary_text, rule.id)
        if direct is not None:
            value, source_line = direct
            normalized, confidence = _normalize_value(rule, value)
            # 명세서 갑지에서 직접 매칭한 경우는 신뢰도 추가 보정 (텍스트 레이어 + 정형 포맷).
            confidence = max(confidence, 0.9)
            needs_review = (rule.required and confidence < 0.6) or normalized is None
            return ParsedField(
                ruleId=rule.id,
                label=rule.label,
                value=value[:300],
                normalized=normalized,
                sourcePage=summary_page,
                sourceText=source_line.strip()[:300],
                confidence=round(confidence, 3),
                needsReview=needs_review,
            )

    # (1.5) decision_no 한정 표지 폴백 — 명세서 갑지를 못 찾았거나 갑지에서 추출 실패한 경우,
    # 표지(1~3p) 에서 셀 분리/anchor 깨짐을 흡수하는 폴백을 시도. PyMuPDF 가 갑지 표를
    # 셀 단위로 흩어 놓아 `_find_summary_page` 가 매치 못 하거나 첫 3~4 행에 결정번호가
    # 떨어지지 않는 케이스(SK실트론/한화에어로스페이스/이수스페셜티 등) 다수 회수.
    if rule.id == "decision_no":
        cover = _extract_decision_no_from_cover(pages)
        if cover is not None:
            page_num, value, source_line = cover
            normalized, confidence = _normalize_value(rule, value)
            # 갑지 직접 매치(0.9) 보다 한 단계 낮춰 표지 폴백임을 신뢰도에 반영.
            confidence = max(confidence, 0.85)
            needs_review = (rule.required and confidence < 0.6) or normalized is None
            return ParsedField(
                ruleId=rule.id,
                label=rule.label,
                value=value[:300],
                normalized=normalized,
                sourcePage=page_num,
                sourceText=source_line.strip()[:300],
                confidence=round(confidence, 3),
                needsReview=needs_review,
            )

    # (2) 허가결정 페이지 우선.
    if decision_page is not None and rule.id in DECISION_PAGE_RULE_IDS:
        target_pages: List[Tuple[int, str]] = [(p, t) for (p, t) in pages if p == decision_page]
        # company_name / site_address / permit_date 는 표 셀 분리로 nextLine·anchor 정규식
        # 매칭이 깨지므로 결정페이지 전용 행/평탄 텍스트 추출을 먼저 시도한다(케이이씨 구미사업장 형 PDF 대응).
        if rule.id in ("company_name", "site_address", "permit_date") and target_pages:
            decision_text = target_pages[0][1]
            direct_dp = _extract_from_decision_page(decision_text, rule.id)
            if direct_dp is not None:
                value, source_line = direct_dp
                normalized, confidence = _normalize_value(rule, value)
                confidence = max(confidence, 0.85)
                needs_review = (rule.required and confidence < 0.6) or normalized is None
                return ParsedField(
                    ruleId=rule.id,
                    label=rule.label,
                    value=value[:300],
                    normalized=normalized,
                    sourcePage=decision_page,
                    sourceText=(source_line or "").strip()[:300],
                    confidence=round(confidence, 3),
                    needsReview=needs_review,
                )
    else:
        target_pages = _select_pages(pages, rule.page_range)

    candidate = _dispatch_locator(target_pages, rule)

    # 1차 매칭 실패 시 보조 키워드로 한 번 더 시도
    if candidate is None and rule.auxiliary_keyword:
        candidate = _dispatch_locator(target_pages, rule, rule.auxiliary_keyword)

    # (3) 그래도 없으면 page_range 무시하고 전체에서 한 번 더 탐색
    if candidate is None:
        candidate = _dispatch_locator(pages, rule)
        if candidate is None and rule.auxiliary_keyword:
            candidate = _dispatch_locator(pages, rule, rule.auxiliary_keyword)

    # (4) permit_date 최종 폴백 — 표지 처분/변경사항 표에서 가장 최근 허가 일자.
    # 변경허가 검토결과서 다수가 본문 1.허가결정 단락의 'YYYY년 MM월 DD일' 숫자를
    # 비공개 마스킹 처리해 정규식(부로/환경부 anchor)이 0으로 매치되는데,
    # 동일 PDF 의 표지(처분사항 표)는 마스킹되지 않아 회수할 수 있다.
    if candidate is None and rule.id == "permit_date":
        cover_match = _extract_permit_date_from_cover(pages)
        if cover_match is not None:
            cover_value, cover_source = cover_match
            normalized, confidence = _normalize_value(rule, cover_value)
            # 표지 표 자체는 신뢰도 높지만 본문 직접 매치보다 한 단계 낮춰 보수적으로 표시.
            confidence = max(confidence, 0.8)
            needs_review = (rule.required and confidence < 0.6) or normalized is None
            return ParsedField(
                ruleId=rule.id,
                label=rule.label,
                value=cover_value[:300],
                normalized=normalized,
                sourcePage=None,
                sourceText=cover_source[:300],
                confidence=round(confidence, 3),
                needsReview=needs_review,
            )

    if candidate is None:
        return ParsedField(
            ruleId=rule.id,
            label=rule.label,
            value=None,
            normalized=None,
            sourcePage=None,
            sourceText=None,
            confidence=0.0,
            needsReview=rule.required,
            error="값을 찾지 못함",
        )

    page_num, value, source_line = candidate
    normalized, confidence = _normalize_value(rule, value)
    needs_review = (rule.required and confidence < 0.6) or normalized is None
    return ParsedField(
        ruleId=rule.id,
        label=rule.label,
        value=value[:300],
        normalized=normalized,
        sourcePage=page_num,
        sourceText=source_line.strip()[:300],
        confidence=round(confidence, 3),
        needsReview=needs_review,
    )


def run_rules(
    pages: List[Tuple[int, str]],
    rules: List[ExtractionRule],
    active_rule_ids: Optional[List[str]] = None,
) -> List[ParsedField]:
    """다수 규칙을 페이지 텍스트에 적용."""
    pages = _normalize_pages(pages)
    decision_page = _find_decision_page(pages)
    summary_page = _find_summary_page(pages)
    if active_rule_ids:
        active = set(active_rule_ids)
        rules = [r for r in rules if r.id in active]
    results: List[ParsedField] = []
    for rule in rules:
        try:
            results.append(apply_rule(pages, rule, decision_page, summary_page))
        except Exception as exc:  # pragma: no cover - 안전망
            results.append(
                ParsedField(
                    ruleId=rule.id,
                    label=rule.label,
                    value=None,
                    normalized=None,
                    confidence=0.0,
                    needsReview=True,
                    error=f"규칙 실행 실패: {exc}",
                )
            )
    return results


def merge_with_builtin(rules: List[ExtractionRule]) -> List[ExtractionRule]:
    """사용자 규칙에 9개 빌트인 규칙이 없으면 보강한다."""
    by_id = {r.id: r for r in rules}
    merged: List[ExtractionRule] = []
    for builtin in BUILTIN_RULES:
        merged.append(by_id.get(builtin.id, builtin))
    for rule in rules:
        if rule.id not in BUILTIN_RULES_BY_ID:
            merged.append(rule)
    return merged
