"""KSIC(한국표준산업분류) 11차 5자리 룩업.

- 데이터 출처: `data/ksic/ksic11.json` (scripts/seed-ksic.py 가 생성).
- 정규화 매칭(공백/구두점/괄호 제거 후 동치 비교) → 부분 포함 top-1 폴백.
- 동률 다수면 코드를 비워(`None`) 신뢰도 0 으로 반환 — 잘못된 임의 선택 방지.

연간보고서는 업종명만 적혀 있고 코드가 없는 경우가 대부분이라, 이름 → 코드를 자동
매핑하기 위한 가벼운 사전(dict)에 가까운 구조로 설계한다. 별도 DB 테이블은 두지 않고
프로세스 메모리에 1회 로드한다(엔트리 1,205개, 수백 KB).
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path
from typing import List, Optional, Tuple, Dict


# 백엔드 모듈 위치 기준으로 repo root 의 data/ksic/ksic11.json 을 찾는다.
# 배포 환경에서 경로가 달라질 수 있어 환경변수 KSIC_JSON_PATH 로 override 허용.
import os as _os

_DEFAULT_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent / "data" / "ksic" / "ksic11.json"
)


def _data_path() -> Path:
    override = _os.environ.get("KSIC_JSON_PATH")
    return Path(override) if override else _DEFAULT_PATH


# 매칭용 정규화: 공백 + 일반 구두점/괄호/하이픈/가운데점 제거. 한글/영문/숫자만 남긴다.
_NOISE = re.compile(r"[\s·•\-‐‑‒–—―−.,:;()\[\]{}（）「」『』〈〉《》/&]+")


def _normalize(name: str) -> str:
    if not name:
        return ""
    return _NOISE.sub("", name).lower()


@functools.lru_cache(maxsize=1)
def _load_index() -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    """JSON 로드 + 정규화 이름 → 코드 dict.

    동일 정규화 이름이 여러 코드에 매핑되는 경우(예: 5자리·4자리가 같은 한글명)는
    첫 항목만 dict 에 들어가지만, 본 모듈은 5자리만 적재되어 있어 충돌이 거의 없다.
    """
    path = _data_path()
    if not path.exists():
        return [], {}
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return [], {}
    if not isinstance(items, list):
        return [], {}

    by_norm: Dict[str, str] = {}
    cleaned: List[Dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        code = str(it.get("code") or "").strip()
        name = str(it.get("name") or "").strip()
        if not (code and name):
            continue
        norm = _normalize(name)
        cleaned.append({"code": code, "name": name, "name_eng": str(it.get("name_eng") or "")})
        by_norm.setdefault(norm, code)
    return cleaned, by_norm


def lookup_industry(name: Optional[str]) -> Tuple[Optional[str], Optional[str], float]:
    """업종명 → (code, canonical_name, confidence).

    매칭 단계:
        1) 정규화 동치 매칭 → confidence 0.95
        2) 정규화 이름이 다른 항목의 정규화 이름을 포함/포함되는 경우 → 후보군 추출.
           단일 후보면 채택(0.6), 다수 매칭이면 코드 비움(0.0, 신뢰도 0).
        3) 모두 실패하면 (None, name, 0.0) 반환.

    매칭 실패 시 호출자(연간보고서 파서)는 industry_code 를 비우고 industry_name 만
    저장하도록 처리하므로, 본 함수는 임의 선택을 피하는 보수적 매칭만 수행한다.
    """
    if not name:
        return None, None, 0.0
    items, by_norm = _load_index()
    if not items:
        return None, None, 0.0

    norm_query = _normalize(name)
    if not norm_query:
        return None, None, 0.0

    # 1) 정확(=정규화 후 동치) 매칭.
    code = by_norm.get(norm_query)
    if code:
        canonical = next((it["name"] for it in items if it["code"] == code), name)
        return code, canonical, 0.95

    # 2) 부분 포함 매칭 — 양방향(쿼리⊆카탈로그 / 카탈로그⊆쿼리) 모두 후보로 모은다.
    #    문서에서 업종명 끝에 "제조업" 등이 추가/생략되는 표기 차이를 흡수.
    candidates: List[Dict[str, str]] = []
    seen_codes: set[str] = set()
    for it in items:
        norm_it = _normalize(it["name"])
        if not norm_it:
            continue
        if norm_query in norm_it or norm_it in norm_query:
            if it["code"] not in seen_codes:
                candidates.append(it)
                seen_codes.add(it["code"])

    if len(candidates) == 1:
        only = candidates[0]
        return only["code"], only["name"], 0.6

    # 3) 다수/없음 → 코드 비움 (신뢰도 0). 호출자는 industry_name 만 저장.
    return None, name, 0.0


def get_canonical_by_code(code: Optional[str]) -> Optional[str]:
    """이미 5자리 코드를 알고 있는 경우 KSIC 11차 정식 명칭 반환 (없으면 None).

    검토결과서/연간보고서에서 4자리 코드(상위 분류) 만 적힌 케이스가 적지 않다.
    이때는 prefix 매칭으로 최적 5자리 후보를 추정한다 — `lookup_industry_by_4digit_prefix`.
    """
    if not code:
        return None
    items, _by_norm = _load_index()
    for it in items:
        if it["code"] == code:
            return it["name"]
    return None


def _name_overlap_score(query: str, candidate: str) -> float:
    """정규화 이름 두 개의 유사도 0.0~1.0.

    문자 집합 Jaccard 유사도 + prefix 일치 보너스. 한국어 업종명은 토큰화가 까다로워
    문자 단위가 가장 안정적이다(예: '제조업' 접미사 일치 등).
    """
    if not query or not candidate:
        return 0.0
    q = set(query)
    c = set(candidate)
    if not q or not c:
        return 0.0
    inter = len(q & c)
    union = len(q | c)
    jaccard = inter / union if union else 0.0
    # 앞쪽 일치 보너스 — '합성수지및플라스틱물질제조업' 처럼 핵심 토큰이 앞쪽에 몰린 경우 우선.
    common_prefix = 0
    for a, b in zip(query, candidate):
        if a == b:
            common_prefix += 1
        else:
            break
    prefix_bonus = min(common_prefix / max(len(query), 1), 0.3)
    return min(1.0, jaccard + prefix_bonus)


def _resolve_prefix_candidates(
    prefix: str,
    name: Optional[str],
    *,
    single_confidence: float,
    score_threshold: float,
    margin_threshold: float,
    confidence_floor: float,
    confidence_ceiling: float,
) -> Tuple[Optional[str], Optional[str], float]:
    """KSIC prefix 후보군 + (옵션) 이름으로 5자리 코드 1개를 정한다.

    `lookup_industry_by_3digit_prefix` 와 `lookup_industry_by_4digit_prefix` 가
    동일한 흐름(prefix → 후보 모으기 → 단일이면 채택, 다수면 이름 fuzzy 1위 채택)으로
    동작하므로 임계치만 다른 헬퍼로 분리한다. 임계치는 prefix 자릿수가 짧을수록
    보수적으로(=후보가 많은 만큼 더 높은 점수/마진을 요구) 호출 측에서 결정.
    """
    items, _by_norm = _load_index()
    if not items:
        return None, None, 0.0
    candidates = [it for it in items if it["code"].startswith(prefix)]
    if not candidates:
        return None, None, 0.0
    if len(candidates) == 1:
        only = candidates[0]
        return only["code"], only["name"], single_confidence
    if not name:
        return None, None, 0.0
    norm_q = _normalize(name)
    if not norm_q:
        return None, None, 0.0
    scored = sorted(
        ((_name_overlap_score(norm_q, _normalize(c["name"])), c) for c in candidates),
        key=lambda t: t[0],
        reverse=True,
    )
    top_score, top = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    if top_score >= score_threshold and (top_score - second_score) >= margin_threshold:
        confidence = min(confidence_ceiling, confidence_floor + 0.4 * top_score)
        return top["code"], top["name"], confidence
    return None, None, 0.0


def lookup_industry_by_4digit_prefix(
    code4: str, name: Optional[str] = None
) -> Tuple[Optional[str], Optional[str], float]:
    """4자리 코드 + (가능하면) 이름으로 5자리 KSIC 코드 추정.

    동작:
      - 4자리 prefix 인 5자리 코드 후보를 모은다.
      - 후보가 1개 → 자동 채택(이름 매칭과 무관, confidence=0.7)
      - 후보가 여러 개 + 이름이 주어졌을 때 → 이름 정규화 유사도 1위 채택
        · 1위 점수 ≥ 0.55 그리고 (1위 - 2위 ≥ 0.05) → confidence = 0.55 + 0.4*score (상한 0.85)
        · 그렇지 않으면 4자리 그대로 보존 (None, None, 0.0)
      - 후보가 여러 개 + 이름 없음 → 4자리 보존 (None, None, 0.0)
      - 후보 0개 → (None, None, 0.0)

    호출자는 (None, None, 0.0) 인 경우 4자리를 needsReview 표시로 그대로 둘 수 있다.
    """
    if not code4 or not re.fullmatch(r"\d{4}", code4):
        return None, None, 0.0
    return _resolve_prefix_candidates(
        code4,
        name,
        single_confidence=0.7,
        score_threshold=0.55,
        margin_threshold=0.05,
        confidence_floor=0.55,
        confidence_ceiling=0.85,
    )


def lookup_industry_by_3digit_prefix(
    code3: str, name: Optional[str] = None
) -> Tuple[Optional[str], Optional[str], float]:
    """3자리 코드 + (가능하면) 이름으로 5자리 KSIC 코드 추정.

    `1차 철강 제조업(241)` 처럼 상위 3자리(소분류) 만 적힌 검토결과서/연간보고서를
    위한 폴백. 3자리 prefix 는 4자리에 비해 후보 수가 평균 7~10배 많아 임의 채택의
    위험이 크므로 4자리보다 한 단계 더 보수적인 임계치를 사용한다.

    임계치(차이점):
      - 후보 1개 → 자동 채택(0.65)         · 4자리는 0.7
      - 다수 매칭 시 1위 점수 ≥ 0.65       · 4자리는 0.55
      - 1위-2위 마진 ≥ 0.10                · 4자리는 0.05
      - confidence_floor = 0.5             · 4자리는 0.55
    """
    if not code3 or not re.fullmatch(r"\d{3}", code3):
        return None, None, 0.0
    return _resolve_prefix_candidates(
        code3,
        name,
        single_confidence=0.65,
        score_threshold=0.65,
        margin_threshold=0.10,
        confidence_floor=0.5,
        confidence_ceiling=0.8,
    )
