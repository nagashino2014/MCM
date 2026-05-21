"""Integrated permit target industry matching helpers.

The IEPS annual reports usually contain one of the legally scoped integrated
permit target industries rather than arbitrary KSIC names.  This module keeps a
small deterministic target-industry dictionary ahead of the broad KSIC lookup.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .ksic_lookup import get_canonical_by_code


_NOISE = re.compile(r"[\s·•\-‐‑‒–—―−.,:;()\[\]{}（）「」『』〈〉《》/&]+")


def _norm(value: str) -> str:
    return _NOISE.sub("", value or "").lower()


TARGET_INDUSTRIES: List[Dict[str, Any]] = [
    {
        "label": "화력 발전업",
        "aliases": ["화력 발전업", "화력발전", "발전업"],
        "exactCodes": ["35113"],
    },
    {
        "label": "기타 발전업",
        "aliases": ["기타 발전업"],
        "exactCodes": ["35119"],
    },
    {
        "label": "증기, 냉온수 및 공기조절 공급업",
        "aliases": ["증기", "냉온수", "공기조절 공급업", "증기 냉온수 공급업"],
        "exactCodes": ["35300"],
    },
    {
        "label": "폐기물 처리업",
        "aliases": ["폐기물 처리업", "지정 외 폐기물 처리업", "지정 폐기물 처리업"],
        "exactCodes": ["38210", "38220"],
    },
    {
        "label": "석유화학계 기초 화학물질 제조업",
        "aliases": ["석유화학계", "석유화학계 기초 화학 물질 제조업"],
        "exactCodes": ["20111"],
    },
    {
        "label": "합성고무 및 합성수지 제조업",
        "aliases": ["합성고무", "합성수지", "기타 플라스틱 물질 제조업"],
        "exactCodes": ["20301", "20302"],
    },
    {
        "label": "1차 철강 제조업",
        "aliases": ["1차 철강", "일차 철강", "철강 제조업"],
        "prefixCodes": ["241"],
    },
    {
        "label": "1차 비철금속 제조업",
        "aliases": ["1차 비철", "일차 비철", "비철금속 제조업"],
        "prefixCodes": ["242"],
    },
    {
        "label": "석유 정제품 제조업",
        "aliases": ["석유 정제품", "석유정제품"],
        "prefixCodes": ["192"],
    },
    {
        "label": "비료 및 질소화합물 제조업",
        "aliases": ["비료", "질소화합물"],
        "prefixCodes": ["202"],
    },
    {
        "label": "기초화학물질 제조업",
        "aliases": ["기초화학물질", "기초 화학 물질 제조업"],
        "prefixCodes": ["201"],
    },
    {
        "label": "기타 기초 무기화학 물질 제조업",
        "aliases": ["기타 기초 무기화학", "무기화학 물질 제조업"],
        "exactCodes": ["20129"],
    },
    {
        "label": "무기 안료용 금속 산화물 및 관련 제품 제조업",
        "aliases": ["무기 안료", "금속 산화물"],
        "exactCodes": ["20131"],
    },
    {
        "label": "석탄화학계 화합물 및 기타 기초 유기화학 물질 제조업",
        "aliases": ["석탄화학계", "기타 기초 유기화학"],
        "exactCodes": ["20119"],
    },
    {
        "label": "합성염료, 유연제 및 기타 착색제 제조업",
        "aliases": ["합성염료", "유연제", "착색제"],
        "exactCodes": ["20132"],
    },
    {
        "label": "화학 살균ㆍ살충제 및 농업용 약제 제조업",
        "aliases": ["농약", "살균제", "살충제", "농업용 약제"],
        "exactCodes": ["20412"],
    },
    {
        "label": "일반용 도료 및 관련제품 제조업",
        "aliases": ["도료", "페인트"],
        "exactCodes": ["20421"],
    },
    {
        "label": "요업용 도포제 및 관련제품 제조업",
        "aliases": ["유약", "요업용 도포제"],
        "exactCodes": ["20422"],
    },
    {
        "label": "계면활성제 제조업",
        "aliases": ["계면활성제"],
        "exactCodes": ["20431"],
    },
    {
        "label": "치약, 비누 및 기타 세제 제조업",
        "aliases": ["치약", "비누", "세제"],
        "exactCodes": ["20432"],
    },
    {
        "label": "화장품 제조업",
        "aliases": ["화장품"],
        "exactCodes": ["20433"],
    },
    {
        "label": "접착제 및 젤라틴 제조업",
        "aliases": ["접착제", "젤라틴"],
        "exactCodes": ["20492"],
    },
    {
        "label": "화약 및 불꽃제품 제조업",
        "aliases": ["화약", "불꽃제품"],
        "exactCodes": ["20493"],
    },
    {
        "label": "기타 분류 안된 화학제품 제조업",
        "aliases": ["기타 분류 안된 화학제품", "기타 화학제품"],
        "exactCodes": ["20499"],
    },
    {
        "label": "펄프, 종이 및 판지 제조업",
        "aliases": ["펄프", "신문용지", "인쇄지", "판지", "기타 종이"],
        "prefixCodes": ["1711"],
        "exactCodes": ["17121", "17122", "17123", "17129"],
    },
    {
        "label": "기타 종이 및 판지제품 제조업",
        "aliases": ["기타 종이 및 판지제품", "종이제품"],
        "prefixCodes": ["179"],
    },
    {
        "label": "전자부품 제조업",
        "aliases": ["평판", "회로기판", "기타 전자부품"],
        "prefixCodes": ["2621", "2692"],
        "exactCodes": ["26221", "26929"],
    },
    {
        "label": "도축, 육류가공 및 저장처리업",
        "aliases": ["도축", "육류가공", "저장처리업"],
        "prefixCodes": ["101"],
    },
    {
        "label": "알코올음료 제조업",
        "aliases": ["알코올음료", "주류", "음료 제조업"],
        "prefixCodes": ["111"],
    },
    {
        "label": "섬유제품 염색, 정리 및 마무리 가공업",
        "aliases": ["섬유제품 염색", "정리 및 마무리 가공"],
        "prefixCodes": ["134"],
    },
    {
        "label": "플라스틱제품 제조업",
        "aliases": ["플라스틱제품"],
        "prefixCodes": ["222"],
    },
    {
        "label": "반도체 제조업",
        "aliases": ["반도체"],
        "prefixCodes": ["261"],
    },
    {
        "label": "자동차 부품 제조업",
        "aliases": ["자동차부품", "자동차 부품"],
        "prefixCodes": ["303"],
    },
    {
        "label": "시멘트 제조업",
        "aliases": ["시멘트", "시멘트 제조업"],
        "exactCodes": ["23311"],
    },
    {
        "label": "이차전지 제조업",
        "aliases": ["이차전지", "2차전지", "축전지", "리튬이온 전지", "배터리"],
        "exactCodes": ["28202", "28209"],
    },
]


def _entry_to_matches(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for code in entry.get("exactCodes") or []:
        matches.append(
            {
                "code": code,
                "name": get_canonical_by_code(code) or entry["label"],
                "products": [],
                "matchSource": "integrated_permit_target",
            }
        )
    for prefix in entry.get("prefixCodes") or []:
        matches.append(
            {
                "code": None,
                "prefixCode": prefix,
                "name": entry["label"],
                "products": [],
                "matchSource": "integrated_permit_target",
            }
        )
    return matches


def match_integrated_permit_industries(text: Optional[str]) -> List[Dict[str, Any]]:
    """Return deterministic target-industry matches for an annual-report industry text."""
    if not text:
        return []
    normalized = _norm(text)
    if not normalized:
        return []

    matches: List[Dict[str, Any]] = []
    seen: set[tuple[Optional[str], Optional[str]]] = set()

    for entry in TARGET_INDUSTRIES:
        terms = [entry["label"], *(entry.get("aliases") or [])]
        if not any((term_norm := _norm(term)) and (term_norm in normalized or normalized in term_norm) for term in terms):
            continue
        for match in _entry_to_matches(entry):
            key = (match.get("code"), match.get("prefixCode"))
            if key in seen:
                continue
            seen.add(key)
            matches.append(match)
    return matches
