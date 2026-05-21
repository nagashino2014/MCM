"""
Query Expansion 모듈

LLM을 사용하여 검색 질의를 확장하고, 여러 질의로 검색한 결과를 통합합니다.

주요 기능:
- 동의어/유사어 생성 (NOx → 질소산화물)
- 상위/하위 개념 추가 (철강업 → 제철소, 제강업)
- 관련 법령/규제명 포함
- 다중 질의 검색 결과 통합
"""

from typing import List, Dict, Any, Optional, Callable, Awaitable
import re
import json
import logging
import asyncio
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ExpansionResult:
    """질의 확장 결과"""
    original_query: str
    expanded_queries: List[str]
    input_tokens: int
    output_tokens: int


# ============================================================
# LLM 기반 질의 확장
# ============================================================

async def expand_query_with_llm(
    query: str,
    api_key: str,
    model: str = "gpt-4o-mini",
    num_expansions: int = 5,
    domain: str = "환경/에너지 정책"
) -> ExpansionResult:
    """
    LLM을 사용하여 질의 확장
    
    Args:
        query: 원본 검색 질의
        api_key: OpenAI API 키
        model: 사용할 모델
        num_expansions: 생성할 확장 질의 수
        domain: 검색 도메인 (프롬프트에 반영)
        
    Returns:
        ExpansionResult 객체
    """
    prompt = f"""다음 질문과 관련된 문서를 검색하기 위한 다양한 검색 질의를 {num_expansions}개 생성하세요.

도메인: {domain}
원본 질문: {query}

생성 지침:
1. 동의어와 유사 표현 사용 (예: NOx → 질소산화물, GHG → 온실가스)
2. 상위/하위 개념 포함 (예: 철강업 → 제철소, 제강업)
3. 관련 법령/규제명 포함 (예: 대기환경보전법, 기후위기대응법)
4. 구체적 영향/결과 표현 (예: 영향 → 비용증가, 설비투자, 인력확충)
5. 다른 관점에서의 표현 (예: 규제 강화 → 사업자 대응, 산업계 영향)

JSON 배열 형식으로만 응답하세요:
["질의1", "질의2", "질의3", "질의4", "질의5"]"""

    try:
        import httpx
        
        # 모델 이름 매핑
        model_map = {
            "gpt-5-mini": "gpt-4o-mini",
            "gpt-5.2": "gpt-4o",
        }
        actual_model = model_map.get(model, model)
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json={
                    "model": actual_model,
                    "messages": [
                        {"role": "system", "content": "검색 질의 확장 전문가입니다. JSON 배열 형식으로만 응답합니다."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 500
                }
            )
        
        if response.status_code != 200:
            logger.error(f"[QueryExpansion] API error: {response.status_code}")
            return ExpansionResult(
                original_query=query,
                expanded_queries=[query],
                input_tokens=0,
                output_tokens=0
            )
        
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage", {})
        
        # JSON 파싱
        expanded = parse_json_array(content)
        
        # 원본 질의를 첫 번째로 포함
        all_queries = [query] + [q for q in expanded if q != query]
        
        return ExpansionResult(
            original_query=query,
            expanded_queries=all_queries[:num_expansions + 1],
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0)
        )
        
    except Exception as e:
        logger.error(f"[QueryExpansion] LLM expansion failed: {e}")
        return ExpansionResult(
            original_query=query,
            expanded_queries=[query],
            input_tokens=0,
            output_tokens=0
        )


def parse_json_array(text: str) -> List[str]:
    """텍스트에서 JSON 배열 파싱"""
    # JSON 배열 추출 시도
    array_match = re.search(r'\[.*\]', text, re.DOTALL)
    if array_match:
        try:
            parsed = json.loads(array_match.group())
            if isinstance(parsed, list):
                return [str(item) for item in parsed if item]
        except json.JSONDecodeError:
            pass
    
    # 줄 단위 추출 시도
    lines = text.strip().split('\n')
    queries = []
    for line in lines:
        # 번호나 따옴표 제거
        cleaned = re.sub(r'^[\d\.\-\*\s]+', '', line)
        cleaned = cleaned.strip('"\'')
        if cleaned and len(cleaned) > 3:
            queries.append(cleaned)
    
    return queries[:10]


# ============================================================
# 규칙 기반 질의 확장 (LLM 없이)
# ============================================================

# 환경/에너지 분야 동의어 사전
SYNONYM_DICT = {
    "NOx": ["질소산화물", "질소산화물질", "NOx"],
    "SOx": ["황산화물", "황산화물질", "SOx"],
    "PM": ["미세먼지", "분진", "입자상물질"],
    "GHG": ["온실가스", "온실가스배출", "탄소배출"],
    "CO2": ["이산화탄소", "탄소", "CO2"],
    "배출권": ["탄소배출권", "배출허용량", "할당량"],
    "RPS": ["신재생에너지의무비율", "재생에너지의무공급비율", "RPS"],
    "REC": ["재생에너지인증서", "신재생에너지공급인증서", "REC"],
    "ESG": ["환경사회지배구조", "지속가능경영", "ESG"],
    "CBAM": ["탄소국경조정", "탄소국경세", "CBAM"],
    "철강업": ["제철업", "제강업", "철강산업", "철강업종"],
    "석유화학": ["정유", "화학", "석유화학산업"],
    "발전": ["발전소", "발전업", "전력생산"],
    "규제": ["법령", "고시", "기준", "지침"],
    "강화": ["상향", "개정", "신설", "확대"],
    "영향": ["파급", "리스크", "대응", "비용"],
}


def expand_query_by_rules(query: str, max_expansions: int = 5) -> List[str]:
    """
    규칙 기반 질의 확장 (동의어 사전 활용)
    
    LLM을 사용할 수 없거나 빠른 확장이 필요할 때 사용
    
    Args:
        query: 원본 검색 질의
        max_expansions: 최대 확장 수
        
    Returns:
        확장된 질의 리스트 (원본 포함)
    """
    expanded = [query]
    
    # 동의어 대체
    for term, synonyms in SYNONYM_DICT.items():
        if term.lower() in query.lower():
            for syn in synonyms:
                if syn.lower() != term.lower():
                    new_query = re.sub(
                        re.escape(term), 
                        syn, 
                        query, 
                        flags=re.IGNORECASE
                    )
                    if new_query not in expanded:
                        expanded.append(new_query)
                        
        # 동의어가 쿼리에 있는 경우도 확인
        for syn in synonyms:
            if syn in query and syn != term:
                new_query = query.replace(syn, term)
                if new_query not in expanded:
                    expanded.append(new_query)
    
    # 키워드 조합으로 추가 질의 생성
    keywords = extract_keywords(query)
    if len(keywords) >= 2:
        # 키워드 + 관련 용어 조합
        additional_terms = ["규제", "정책", "동향", "현황", "대응", "영향"]
        for term in additional_terms:
            if term not in query:
                new_query = f"{' '.join(keywords[:2])} {term}"
                if new_query not in expanded:
                    expanded.append(new_query)
    
    return expanded[:max_expansions + 1]


def extract_keywords(text: str) -> List[str]:
    """텍스트에서 키워드 추출"""
    # 한글 단어 추출 (2글자 이상)
    words = re.findall(r'[가-힣]{2,}', text)
    
    # 불용어 제거
    stopwords = {
        "있다", "하다", "되다", "이다", "등", "및", "위해", "대한", "또는",
        "따라", "통해", "경우", "이상", "이하", "해당", "관한", "위한"
    }
    
    return [w for w in words if w not in stopwords]


# ============================================================
# 다중 질의 검색 및 결과 통합
# ============================================================

async def multi_query_retrieval(
    queries: List[str],
    search_fn: Callable[[str, int], Awaitable[List[Dict[str, Any]]]],
    top_k_per_query: int = 30,
    max_total: int = 80,
    deduplicate: bool = True
) -> List[Dict[str, Any]]:
    """
    여러 질의로 검색 후 결과 통합
    
    Args:
        queries: 검색 질의 리스트
        search_fn: 검색 함수 (async def search(query, top_k) -> List[Dict])
        top_k_per_query: 질의당 검색 결과 수
        max_total: 최대 반환 결과 수
        deduplicate: 중복 제거 여부
        
    Returns:
        통합된 검색 결과
    """
    all_results: Dict[str, Dict[str, Any]] = {}
    query_sources: Dict[str, List[str]] = {}  # 어떤 질의에서 검색되었는지
    
    # 병렬로 검색 수행
    async def search_single(query: str) -> List[Dict[str, Any]]:
        try:
            return await search_fn(query, top_k_per_query)
        except Exception as e:
            logger.error(f"[MultiQuery] Search failed for '{query}': {e}")
            return []
    
    # 모든 질의에 대해 병렬 검색
    search_tasks = [search_single(q) for q in queries]
    results_list = await asyncio.gather(*search_tasks)
    
    # 결과 통합
    for query, results in zip(queries, results_list):
        for chunk in results:
            # 청크 ID 추출 (없으면 콘텐츠 해시 사용)
            chunk_id = chunk.get("id") or str(hash(chunk.get("content", "")[:100]))
            
            if deduplicate:
                if chunk_id not in all_results:
                    all_results[chunk_id] = chunk.copy()
                    all_results[chunk_id]["_matched_queries"] = 1
                    query_sources[chunk_id] = [query]
                else:
                    # 여러 질의에서 검색된 경우 점수 보너스
                    all_results[chunk_id]["_matched_queries"] += 1
                    query_sources[chunk_id].append(query)
                    
                    # 더 높은 점수로 업데이트
                    old_score = all_results[chunk_id].get("score", 0)
                    new_score = chunk.get("score", 0)
                    if new_score > old_score:
                        all_results[chunk_id]["score"] = new_score
            else:
                all_results[f"{chunk_id}_{query}"] = chunk
    
    # 여러 질의에서 매칭된 문서 우선 + 점수 순 정렬
    sorted_results = sorted(
        all_results.values(),
        key=lambda x: (x.get("_matched_queries", 1), x.get("score", 0)),
        reverse=True
    )
    
    # 로깅
    multi_matched = sum(1 for r in sorted_results if r.get("_matched_queries", 1) > 1)
    if multi_matched > 0:
        logger.info(f"[MultiQuery] {multi_matched} documents matched by multiple queries")
    
    return sorted_results[:max_total]


# ============================================================
# Reciprocal Rank Fusion (RRF)
# ============================================================

def reciprocal_rank_fusion(
    result_lists: List[List[Dict[str, Any]]],
    weights: Optional[List[float]] = None,
    k: int = 60,
    id_key: str = "id",
    content_key: str = "content"
) -> List[Dict[str, Any]]:
    """
    여러 검색 결과 리스트를 RRF로 융합
    
    Args:
        result_lists: 검색 결과 리스트들
        weights: 각 리스트의 가중치 (None이면 균등)
        k: RRF 파라미터 (기본 60)
        id_key: ID 필드명
        content_key: 콘텐츠 필드명 (ID 없을 때 해시용)
        
    Returns:
        융합된 결과 리스트
    """
    if not result_lists:
        return []
    
    # 가중치 기본값
    if weights is None:
        weights = [1.0] * len(result_lists)
    
    # 결과별 RRF 점수 계산
    rrf_scores: Dict[str, float] = {}
    chunk_map: Dict[str, Dict[str, Any]] = {}
    
    for weight, results in zip(weights, result_lists):
        for rank, chunk in enumerate(results):
            # 청크 식별자
            chunk_id = chunk.get(id_key) or str(hash(chunk.get(content_key, "")[:100]))
            
            # RRF 점수 누적
            rrf_score = weight / (k + rank + 1)
            rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0) + rrf_score
            
            # 청크 정보 저장 (처음 등장한 것 사용)
            if chunk_id not in chunk_map:
                chunk_map[chunk_id] = chunk.copy()
    
    # RRF 점수 기준 정렬
    sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
    
    # 결과 생성
    fused_results = []
    for chunk_id in sorted_ids:
        chunk = chunk_map[chunk_id]
        chunk["rrf_score"] = rrf_scores[chunk_id]
        fused_results.append(chunk)
    
    return fused_results


# ============================================================
# 편의 함수
# ============================================================

async def expand_and_search(
    query: str,
    search_fn: Callable[[str, int], Awaitable[List[Dict[str, Any]]]],
    api_key: Optional[str] = None,
    use_llm: bool = True,
    num_expansions: int = 5,
    top_k_per_query: int = 30,
    max_total: int = 80
) -> List[Dict[str, Any]]:
    """
    질의 확장 후 다중 검색 수행 (편의 함수)
    
    Args:
        query: 원본 검색 질의
        search_fn: 검색 함수
        api_key: LLM API 키 (LLM 확장 시 필요)
        use_llm: LLM 사용 여부
        num_expansions: 확장 질의 수
        top_k_per_query: 질의당 결과 수
        max_total: 최대 결과 수
        
    Returns:
        통합된 검색 결과
    """
    # 질의 확장
    if use_llm and api_key:
        expansion = await expand_query_with_llm(query, api_key, num_expansions=num_expansions)
        queries = expansion.expanded_queries
    else:
        queries = expand_query_by_rules(query, max_expansions=num_expansions)
    
    logger.info(f"[QueryExpansion] Expanded to {len(queries)} queries")
    
    # 다중 검색
    return await multi_query_retrieval(
        queries,
        search_fn,
        top_k_per_query=top_k_per_query,
        max_total=max_total
    )
