"""
문서 분류기 모듈

LLM을 사용하여 문서를 유형별/분야별로 분류합니다.

문서 유형 (doc_type):
- notice: 공고, 고시
- press_release: 보도자료
- legislation: 법령, 고시, 지침
- meeting: 회의록, 의사록
- report: 보고서, 연구자료
- guideline: 가이드라인, 매뉴얼
- other: 기타

분야 (sectors):
- air: 대기
- water: 수질
- waste: 폐기물
- climate: 기후변화
- energy: 에너지
- chemical: 화학물질
- general: 일반

출처 수준 (source_depth):
- headquarters: 본부/중앙부처
- agency: 산하기관
- local: 지방자치단체

규제 단계 (regulation_phase):
- proposal: 입법예고
- enacted: 제정
- enforced: 시행
- audit: 점검/감사
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import re
import json


@dataclass
class DocumentClassification:
    """문서 분류 결과"""
    doc_type: str
    sectors: List[str]
    source_depth: str
    regulation_phase: Optional[str]
    confidence: float
    keywords: List[str]


# ============================================================
# 키워드 기반 분류 (LLM 없이)
# ============================================================

DOC_TYPE_KEYWORDS = {
    "notice": ["공고", "고시", "입찰", "모집", "알림", "안내", "공지"],
    "press_release": ["보도자료", "언론보도", "브리핑", "보도", "해명자료"],
    "legislation": ["법률", "법령", "규정", "규칙", "조례", "훈령", "예규", "고시안", "시행령", "시행규칙"],
    "meeting": ["회의록", "의사록", "회의", "심의", "자문회의", "위원회"],
    "report": ["보고서", "연구", "결과보고", "실적", "통계", "현황", "분석"],
    "guideline": ["가이드라인", "지침", "매뉴얼", "안내서", "해설서", "표준"],
}

SECTOR_KEYWORDS = {
    "air": ["대기", "미세먼지", "배출가스", "대기오염", "대기질", "온실가스", "배출권", "탄소", "질소산화물", "황산화물"],
    "water": ["수질", "폐수", "하수", "수처리", "방류", "상수", "지하수", "해양", "수자원"],
    "waste": ["폐기물", "폐기", "재활용", "순환자원", "자원순환", "생산자책임", "EPR"],
    "climate": ["기후", "기후변화", "탄소중립", "넷제로", "온실가스", "RE100", "ESG", "녹색"],
    "energy": ["에너지", "신재생", "태양광", "풍력", "전력", "연료전지", "수소"],
    "chemical": ["화학물질", "유해화학", "REACH", "물질안전", "MSDS", "화관법", "화평법"],
}

SOURCE_DEPTH_KEYWORDS = {
    "headquarters": ["환경부", "산업통상자원부", "국무조정실", "기획재정부", "국토교통부", "해양수산부"],
    "agency": ["한국환경공단", "한국에너지공단", "환경산업기술원", "국립환경과학원", "연구원", "진흥원", "공단"],
    "local": ["시청", "군청", "구청", "도청", "광역시", "특별시", "지방", "지자체"],
}

REGULATION_PHASE_KEYWORDS = {
    "proposal": ["예고", "의견수렴", "예고안", "입법예고", "행정예고"],
    "enacted": ["제정", "공포", "개정", "시행령"],
    "enforced": ["시행", "적용", "발효"],
    "audit": ["점검", "감사", "단속", "지도", "위반"],
}


def classify_document_by_keywords(
    content: str,
    metadata: Dict[str, Any]
) -> DocumentClassification:
    """
    키워드 기반 문서 분류 (간단하고 빠름)
    
    Args:
        content: 문서 내용
        metadata: 문서 메타데이터 (org_name, board_name 등)
    
    Returns:
        분류 결과
    """
    content_lower = content.lower()
    org_name = metadata.get("org_name", "")
    board_name = metadata.get("board_name", "")
    full_text = f"{org_name} {board_name} {content}"
    
    # 문서 유형 분류
    doc_type = "other"
    doc_type_score = 0
    for dtype, keywords in DOC_TYPE_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in full_text)
        if score > doc_type_score:
            doc_type_score = score
            doc_type = dtype
    
    # 분야 분류 (다중 선택 가능)
    sectors = []
    for sector, keywords in SECTOR_KEYWORDS.items():
        if any(kw in full_text for kw in keywords):
            sectors.append(sector)
    if not sectors:
        sectors = ["general"]
    
    # 출처 수준 분류
    source_depth = "headquarters"
    for depth, keywords in SOURCE_DEPTH_KEYWORDS.items():
        if any(kw in org_name for kw in keywords):
            source_depth = depth
            break
    
    # 규제 단계 분류
    regulation_phase = None
    for phase, keywords in REGULATION_PHASE_KEYWORDS.items():
        if any(kw in full_text for kw in keywords):
            regulation_phase = phase
            break
    
    # 주요 키워드 추출
    found_keywords = []
    all_keywords = []
    for kw_list in [*DOC_TYPE_KEYWORDS.values(), *SECTOR_KEYWORDS.values()]:
        all_keywords.extend(kw_list)
    
    for kw in set(all_keywords):
        if kw in full_text:
            found_keywords.append(kw)
    
    # 신뢰도 계산
    confidence = min(1.0, (doc_type_score + len(sectors)) / 5)
    
    return DocumentClassification(
        doc_type=doc_type,
        sectors=sectors,
        source_depth=source_depth,
        regulation_phase=regulation_phase,
        confidence=confidence,
        keywords=found_keywords[:10]
    )


# ============================================================
# LLM 기반 분류 (더 정확함)
# ============================================================

def get_classification_prompt(content: str, metadata: Dict[str, Any]) -> str:
    """LLM 분류를 위한 프롬프트 생성"""
    org_name = metadata.get("org_name", "")
    board_name = metadata.get("board_name", "")
    
    return f"""다음 환경/에너지 정책 문서를 분류해 주세요.

## 문서 정보
- 출처 기관: {org_name}
- 게시판: {board_name}
- 내용 (일부):
{content[:1500]}

## 분류 기준

1. **문서 유형** (하나 선택):
   - notice: 공고, 고시, 모집 안내
   - press_release: 보도자료
   - legislation: 법령, 고시, 지침
   - meeting: 회의록, 의사록
   - report: 보고서, 연구자료
   - guideline: 가이드라인, 매뉴얼
   - other: 기타

2. **분야** (복수 선택 가능):
   - air: 대기환경
   - water: 수질환경
   - waste: 폐기물/자원순환
   - climate: 기후변화/탄소중립
   - energy: 에너지
   - chemical: 화학물질
   - general: 일반/기타

3. **출처 수준** (하나 선택):
   - headquarters: 중앙부처
   - agency: 산하기관
   - local: 지방자치단체

4. **규제 단계** (해당 시):
   - proposal: 입법예고
   - enacted: 제정/개정
   - enforced: 시행
   - audit: 점검/감사
   - null: 해당 없음

## 응답 형식 (JSON)
```json
{{
  "doc_type": "notice",
  "sectors": ["air", "climate"],
  "source_depth": "headquarters",
  "regulation_phase": "proposal",
  "confidence": 0.9,
  "keywords": ["탄소중립", "배출권"]
}}
```"""


def parse_llm_classification(response: str) -> Optional[DocumentClassification]:
    """LLM 응답 파싱"""
    try:
        # JSON 추출
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            return None
        
        data = json.loads(json_match.group())
        
        return DocumentClassification(
            doc_type=data.get("doc_type", "other"),
            sectors=data.get("sectors", ["general"]),
            source_depth=data.get("source_depth", "headquarters"),
            regulation_phase=data.get("regulation_phase"),
            confidence=data.get("confidence", 0.5),
            keywords=data.get("keywords", [])
        )
    except (json.JSONDecodeError, KeyError):
        return None


async def classify_document_with_llm(
    content: str,
    metadata: Dict[str, Any],
    llm_callback  # async def callback(prompt: str) -> str
) -> DocumentClassification:
    """
    LLM을 사용한 정밀 문서 분류
    
    Args:
        content: 문서 내용
        metadata: 문서 메타데이터
        llm_callback: LLM 호출 함수
    
    Returns:
        분류 결과
    """
    prompt = get_classification_prompt(content, metadata)
    
    try:
        response = await llm_callback(prompt)
        result = parse_llm_classification(response)
        
        if result:
            return result
    except Exception as e:
        print(f"[Classifier] LLM error: {e}")
    
    # LLM 실패 시 키워드 기반 폴백
    return classify_document_by_keywords(content, metadata)


# ============================================================
# 배치 분류
# ============================================================

def classify_chunks_batch(
    chunks: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    청크 배치 분류 (키워드 기반)
    
    Args:
        chunks: 청크 목록 (content, metadata 포함)
    
    Returns:
        분류된 메타데이터가 추가된 청크 목록
    """
    results = []
    
    for chunk in chunks:
        content = chunk.get("content", "")
        metadata = chunk.get("metadata", {})
        
        classification = classify_document_by_keywords(content, metadata)
        
        # 메타데이터 업데이트
        updated_metadata = {
            **metadata,
            "doc_type": classification.doc_type,
            "sectors": classification.sectors,
            "source_depth": classification.source_depth,
            "regulation_phase": classification.regulation_phase,
            "classification_keywords": classification.keywords,
        }
        
        results.append({
            **chunk,
            "metadata": updated_metadata,
        })
    
    return results


def get_classification_stats(classifications: List[DocumentClassification]) -> Dict[str, Any]:
    """분류 통계 생성"""
    from collections import Counter
    
    doc_types = Counter(c.doc_type for c in classifications)
    all_sectors = [s for c in classifications for s in c.sectors]
    sectors = Counter(all_sectors)
    source_depths = Counter(c.source_depth for c in classifications)
    
    return {
        "total": len(classifications),
        "by_doc_type": dict(doc_types),
        "by_sector": dict(sectors),
        "by_source_depth": dict(source_depths),
        "avg_confidence": sum(c.confidence for c in classifications) / len(classifications) if classifications else 0,
    }
