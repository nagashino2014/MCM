"""
HyDE (Hypothetical Document Embeddings) 모듈

LLM을 사용하여 가상의 정답 문서를 생성하고,
그 임베딩으로 실제 문서를 검색하여 정확도를 향상시킵니다.

핵심 아이디어:
- 짧은 질문과 긴 문서 사이의 임베딩 공간 불일치 문제 해결
- 질문 대신 "정답처럼 보이는 가상 문서"로 검색
- 문서-문서 비교로 더 정확한 매칭
"""

from typing import List, Dict, Any, Optional, Callable, Awaitable
import logging
import asyncio

logger = logging.getLogger(__name__)


# ============================================================
# 가상 문서 생성
# ============================================================

async def generate_hypothetical_document(
    query: str,
    api_key: str,
    model: str = "gpt-4o-mini",
    document_type: str = "정책 문서",
    domain: str = "환경/에너지 규제",
    max_tokens: int = 500
) -> str:
    """
    질문에 대한 가상의 정답 문서 생성
    
    Args:
        query: 검색 질의
        api_key: OpenAI API 키
        model: 사용할 LLM 모델
        document_type: 생성할 문서 유형 (정책 문서, 보도자료, 연구보고서 등)
        domain: 문서 도메인
        max_tokens: 최대 생성 토큰 수
        
    Returns:
        생성된 가상 문서
    """
    prompt = f"""당신은 {domain} 분야의 {document_type} 작성 전문가입니다.

다음 질문에 대한 답변이 될 수 있는 상세한 문서를 작성하세요.
실제 정부/기관에서 발행했을 법한 공식적인 문체로 작성하고,
구체적인 수치, 날짜, 기관명, 법령명을 포함하세요.

질문: {query}

문서 작성 지침:
1. 300-500자 분량
2. 구체적인 규제 내용, 수치, 기준 포함
3. 관련 법령/고시명 언급
4. 영향받는 업종/대상 명시
5. 시행일자나 적용시기 포함
6. 전문적이고 객관적인 어조 유지

문서:"""

    try:
        import httpx
        
        # 모델 이름 매핑
        model_map = {
            "gpt-5-mini": "gpt-4o-mini",
            "gpt-5.2": "gpt-4o",
        }
        actual_model = model_map.get(model, model)
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json={
                    "model": actual_model,
                    "messages": [
                        {"role": "system", "content": f"{domain} 분야 문서 작성 전문가입니다."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.5,  # 약간의 다양성
                    "max_tokens": max_tokens
                }
            )
        
        if response.status_code != 200:
            logger.error(f"[HyDE] API error: {response.status_code}")
            return ""
        
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        return content.strip()
        
    except Exception as e:
        logger.error(f"[HyDE] Document generation failed: {e}")
        return ""


async def generate_multiple_hypothetical_documents(
    query: str,
    api_key: str,
    model: str = "gpt-4o-mini",
    num_docs: int = 3,
    document_types: Optional[List[str]] = None
) -> List[str]:
    """
    여러 유형의 가상 문서 생성
    
    Args:
        query: 검색 질의
        api_key: API 키
        model: LLM 모델
        num_docs: 생성할 문서 수
        document_types: 문서 유형 리스트
        
    Returns:
        가상 문서 리스트
    """
    if document_types is None:
        document_types = ["정책 문서", "보도자료", "연구보고서", "가이드라인", "고시문"]
    
    # 요청할 문서 유형 선택
    types_to_generate = document_types[:num_docs]
    
    # 병렬로 생성
    tasks = [
        generate_hypothetical_document(query, api_key, model, doc_type)
        for doc_type in types_to_generate
    ]
    
    documents = await asyncio.gather(*tasks)
    
    # 빈 문서 제거
    return [doc for doc in documents if doc]


# ============================================================
# HyDE 검색
# ============================================================

async def hyde_search(
    query: str,
    embedding_fn: Callable[[str], Awaitable[List[float]]],
    vector_search_fn: Callable[[List[float], int], Awaitable[List[Dict[str, Any]]]],
    api_key: str,
    model: str = "gpt-4o-mini",
    top_k: int = 50,
    num_hypothetical: int = 3,
    document_types: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    HyDE 방식으로 검색 수행
    
    Args:
        query: 검색 질의
        embedding_fn: 임베딩 생성 함수 (async def embed(text) -> List[float])
        vector_search_fn: 벡터 검색 함수 (async def search(embedding, top_k) -> List[Dict])
        api_key: LLM API 키
        model: LLM 모델
        top_k: 가상 문서당 검색 결과 수
        num_hypothetical: 생성할 가상 문서 수
        document_types: 문서 유형 리스트
        
    Returns:
        검색 결과 (중복 제거됨)
    """
    if document_types is None:
        document_types = ["정책 문서", "보도자료", "연구보고서"]
    
    all_results: Dict[str, Dict[str, Any]] = {}
    
    logger.info(f"[HyDE] Generating {num_hypothetical} hypothetical documents")
    
    # 가상 문서 생성
    hypothetical_docs = await generate_multiple_hypothetical_documents(
        query, api_key, model, num_hypothetical, document_types
    )
    
    if not hypothetical_docs:
        logger.warning("[HyDE] No hypothetical documents generated")
        return []
    
    logger.info(f"[HyDE] Generated {len(hypothetical_docs)} documents, searching...")
    
    # 각 가상 문서로 검색
    for i, hypo_doc in enumerate(hypothetical_docs):
        try:
            # 가상 문서 임베딩
            hypo_embedding = await embedding_fn(hypo_doc)
            
            # 임베딩으로 검색
            results = await vector_search_fn(hypo_embedding, top_k)
            
            # 결과 통합 (중복 제거)
            for chunk in results:
                chunk_id = chunk.get("id") or str(hash(chunk.get("content", "")[:100]))
                
                if chunk_id not in all_results:
                    all_results[chunk_id] = chunk.copy()
                    all_results[chunk_id]["hyde_match_count"] = 1
                else:
                    all_results[chunk_id]["hyde_match_count"] += 1
                    # 더 높은 점수로 업데이트
                    old_score = all_results[chunk_id].get("score", 0)
                    new_score = chunk.get("score", 0)
                    if new_score > old_score:
                        all_results[chunk_id]["score"] = new_score
                        
        except Exception as e:
            logger.error(f"[HyDE] Search with doc {i} failed: {e}")
            continue
    
    # 여러 가상 문서에서 검색된 결과 우선 정렬
    sorted_results = sorted(
        all_results.values(),
        key=lambda x: (x.get("hyde_match_count", 0), x.get("score", 0)),
        reverse=True
    )
    
    # 로깅
    multi_matched = sum(1 for r in sorted_results if r.get("hyde_match_count", 1) > 1)
    if multi_matched > 0:
        logger.info(f"[HyDE] {multi_matched} documents matched by multiple hypothetical docs")
    
    return sorted_results[:top_k]


# ============================================================
# HyDE + Direct Search 결합
# ============================================================

async def hybrid_hyde_search(
    query: str,
    embedding_fn: Callable[[str], Awaitable[List[float]]],
    vector_search_fn: Callable[[List[float], int], Awaitable[List[Dict[str, Any]]]],
    text_search_fn: Callable[[str, int], Awaitable[List[Dict[str, Any]]]],
    api_key: str,
    model: str = "gpt-4o-mini",
    top_k: int = 50,
    num_hypothetical: int = 2,
    hyde_weight: float = 0.4,
    direct_weight: float = 0.6
) -> List[Dict[str, Any]]:
    """
    HyDE 검색과 직접 검색을 결합
    
    Args:
        query: 검색 질의
        embedding_fn: 임베딩 함수
        vector_search_fn: 벡터 검색 함수 (임베딩으로 검색)
        text_search_fn: 텍스트 검색 함수 (쿼리로 직접 검색)
        api_key: LLM API 키
        model: LLM 모델
        top_k: 최종 결과 수
        num_hypothetical: 가상 문서 수
        hyde_weight: HyDE 검색 가중치
        direct_weight: 직접 검색 가중치
        
    Returns:
        결합된 검색 결과
    """
    from .query_expansion import reciprocal_rank_fusion
    
    # HyDE 검색과 직접 검색 병렬 수행
    hyde_task = hyde_search(
        query, embedding_fn, vector_search_fn, api_key, model,
        top_k=top_k, num_hypothetical=num_hypothetical
    )
    
    direct_task = text_search_fn(query, top_k)
    
    hyde_results, direct_results = await asyncio.gather(hyde_task, direct_task)
    
    # RRF로 융합
    combined = reciprocal_rank_fusion(
        [direct_results, hyde_results],
        weights=[direct_weight, hyde_weight]
    )
    
    return combined[:top_k]


# ============================================================
# 토큰 사용량 추정
# ============================================================

def estimate_hyde_token_usage(
    query_length: int,
    num_hypothetical: int = 3,
    avg_doc_length: int = 400
) -> Dict[str, int]:
    """
    HyDE 토큰 사용량 추정
    
    Args:
        query_length: 쿼리 길이 (문자 수)
        num_hypothetical: 가상 문서 수
        avg_doc_length: 평균 가상 문서 길이
        
    Returns:
        예상 토큰 사용량
    """
    # 프롬프트 기본 길이 (한국어 기준 대략적 추정)
    prompt_base = 200  # 고정 프롬프트 부분
    query_tokens = query_length // 2  # 한국어 대략 2자당 1토큰
    
    input_per_doc = prompt_base + query_tokens
    output_per_doc = avg_doc_length // 2
    
    return {
        "total_input": input_per_doc * num_hypothetical,
        "total_output": output_per_doc * num_hypothetical,
        "estimated_cost_usd": (
            (input_per_doc * num_hypothetical / 1_000_000 * 0.15) +  # gpt-4o-mini input
            (output_per_doc * num_hypothetical / 1_000_000 * 0.6)   # gpt-4o-mini output
        )
    }
