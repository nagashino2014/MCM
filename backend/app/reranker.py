"""
Cross-Encoder 기반 Reranking 모듈

벡터 검색 후 Cross-Encoder로 재순위화하여 검색 정확도를 향상시킵니다.

사용 모델:
- BAAI/bge-reranker-v2-m3 (다국어, 한국어 지원 우수)
- BAAI/bge-reranker-large (영어 중심, 성능 최고)
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

# 모델 캐싱을 위한 전역 변수
_reranker_model = None
_reranker_tokenizer = None
_current_model_name = None


@dataclass
class RerankedResult:
    """리랭킹 결과"""
    chunk: Dict[str, Any]
    original_rank: int           # 원래 순위
    original_score: float        # 벡터 유사도 점수
    rerank_score: float          # Cross-Encoder 점수
    rank_change: int             # 순위 변동 (양수: 상승, 음수: 하락)


def is_reranker_available() -> bool:
    """Reranker 사용 가능 여부 확인"""
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        return True
    except ImportError:
        return False


def load_reranker(model_name: str = "BAAI/bge-reranker-v2-m3") -> Tuple[Any, Any]:
    """
    Reranker 모델 로드 (최초 1회만)
    
    Args:
        model_name: 사용할 모델 이름
        
    Returns:
        (model, tokenizer) 튜플
    """
    global _reranker_model, _reranker_tokenizer, _current_model_name
    
    # 이미 같은 모델이 로드되어 있으면 재사용
    if _reranker_model is not None and _current_model_name == model_name:
        return _reranker_model, _reranker_tokenizer
    
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        
        logger.info(f"[Reranker] Loading model: {model_name}")
        
        _reranker_tokenizer = AutoTokenizer.from_pretrained(model_name)
        _reranker_model = AutoModelForSequenceClassification.from_pretrained(model_name)
        
        # GPU 사용 가능하면 GPU로 이동
        if torch.cuda.is_available():
            _reranker_model = _reranker_model.cuda()
            logger.info("[Reranker] Using GPU")
        else:
            logger.info("[Reranker] Using CPU")
        
        _reranker_model.eval()
        _current_model_name = model_name
        
        return _reranker_model, _reranker_tokenizer
        
    except Exception as e:
        logger.error(f"[Reranker] Failed to load model: {e}")
        raise


def compute_rerank_scores(
    query: str,
    documents: List[str],
    model_name: str = "BAAI/bge-reranker-v2-m3",
    batch_size: int = 8,
    max_length: int = 512
) -> List[float]:
    """
    Cross-Encoder로 Query-Document 쌍의 관련성 점수 계산
    
    Args:
        query: 검색 쿼리
        documents: 문서 목록
        model_name: 모델 이름
        batch_size: 배치 크기
        max_length: 최대 토큰 길이
        
    Returns:
        각 문서의 관련성 점수 리스트
    """
    if not documents:
        return []
    
    try:
        import torch
        
        model, tokenizer = load_reranker(model_name)
        scores = []
        
        # 배치 단위로 처리
        for i in range(0, len(documents), batch_size):
            batch_docs = documents[i:i + batch_size]
            
            # Query-Document 쌍 생성
            pairs = [[query, doc] for doc in batch_docs]
            
            with torch.no_grad():
                # 토크나이징
                inputs = tokenizer(
                    pairs,
                    padding=True,
                    truncation=True,
                    max_length=max_length,
                    return_tensors="pt"
                )
                
                # GPU로 이동
                if torch.cuda.is_available():
                    inputs = {k: v.cuda() for k, v in inputs.items()}
                
                # 추론
                outputs = model(**inputs)
                
                # 점수 계산 (sigmoid로 0~1 범위로 변환)
                batch_scores = torch.sigmoid(outputs.logits.squeeze(-1)).cpu().tolist()
                
                # 단일 항목인 경우 리스트로 변환
                if isinstance(batch_scores, float):
                    batch_scores = [batch_scores]
                
                scores.extend(batch_scores)
        
        return scores
        
    except Exception as e:
        logger.error(f"[Reranker] Score computation failed: {e}")
        # 실패 시 기본 점수 반환
        return [0.5] * len(documents)


def rerank_chunks(
    query: str,
    chunks: List[Dict[str, Any]],
    top_n: int = 15,
    model_name: str = "BAAI/bge-reranker-v2-m3",
    content_key: str = "content",
    score_key: str = "score",
    max_content_length: int = 2000
) -> List[RerankedResult]:
    """
    청크 리스트를 Cross-Encoder로 리랭킹
    
    Args:
        query: 검색 쿼리
        chunks: 청크 목록 (content, score 등 포함)
        top_n: 반환할 결과 수
        model_name: 모델 이름
        content_key: 청크 내 콘텐츠 필드명
        score_key: 청크 내 원래 점수 필드명
        max_content_length: 최대 콘텐츠 길이
        
    Returns:
        리랭킹된 결과 리스트
    """
    if not chunks:
        return []
    
    # 문서 내용 추출 (길이 제한)
    documents = []
    for chunk in chunks:
        content = chunk.get(content_key, "")
        if isinstance(content, str):
            documents.append(content[:max_content_length])
        else:
            documents.append(str(content)[:max_content_length])
    
    # Cross-Encoder 점수 계산
    rerank_scores = compute_rerank_scores(query, documents, model_name)
    
    # 원래 순위와 점수 저장
    scored_chunks = []
    for original_rank, (chunk, rerank_score) in enumerate(zip(chunks, rerank_scores)):
        original_score = chunk.get(score_key, 0.0)
        if isinstance(original_score, (int, float)):
            original_score = float(original_score)
        else:
            original_score = 0.0
            
        scored_chunks.append({
            "chunk": chunk,
            "original_rank": original_rank,
            "original_score": original_score,
            "rerank_score": rerank_score
        })
    
    # Cross-Encoder 점수로 정렬
    scored_chunks.sort(key=lambda x: x["rerank_score"], reverse=True)
    
    # 결과 생성
    results = []
    for new_rank, item in enumerate(scored_chunks[:top_n]):
        rank_change = item["original_rank"] - new_rank
        
        results.append(RerankedResult(
            chunk=item["chunk"],
            original_rank=item["original_rank"],
            original_score=item["original_score"],
            rerank_score=item["rerank_score"],
            rank_change=rank_change
        ))
    
    return results


def rerank_with_fallback(
    query: str,
    chunks: List[Dict[str, Any]],
    top_n: int = 15,
    model_name: str = "BAAI/bge-reranker-v2-m3"
) -> List[Dict[str, Any]]:
    """
    Reranking 수행 (실패 시 원본 순서 유지)
    
    Args:
        query: 검색 쿼리
        chunks: 청크 목록
        top_n: 반환할 결과 수
        model_name: 모델 이름
        
    Returns:
        리랭킹된 청크 목록 (원래 형식 유지)
    """
    if not is_reranker_available():
        logger.warning("[Reranker] Reranker not available, returning original order")
        return chunks[:top_n]
    
    try:
        results = rerank_chunks(query, chunks, top_n, model_name)
        
        # 리랭킹 결과를 청크 형식으로 변환
        reranked_chunks = []
        for result in results:
            chunk = result.chunk.copy()
            chunk["rerank_score"] = result.rerank_score
            chunk["original_rank"] = result.original_rank
            chunk["rank_change"] = result.rank_change
            reranked_chunks.append(chunk)
        
        # 순위 상승 통계 로깅
        promoted = sum(1 for r in results if r.rank_change > 5)
        if promoted > 0:
            logger.info(f"[Reranker] {promoted} documents promoted by >5 ranks")
        
        return reranked_chunks
        
    except Exception as e:
        logger.error(f"[Reranker] Reranking failed: {e}, returning original order")
        return chunks[:top_n]


def get_reranker_stats() -> Dict[str, Any]:
    """현재 Reranker 상태 정보 반환"""
    global _reranker_model, _current_model_name
    
    return {
        "available": is_reranker_available(),
        "loaded": _reranker_model is not None,
        "model_name": _current_model_name,
        "device": "cuda" if _reranker_model is not None and next(_reranker_model.parameters()).is_cuda else "cpu"
    }


# ============================================================
# 간단한 키워드 기반 Fallback Reranker (모델 없이 사용)
# ============================================================

def simple_rerank_by_keywords(
    query: str,
    chunks: List[Dict[str, Any]],
    top_n: int = 15,
    content_key: str = "content"
) -> List[Dict[str, Any]]:
    """
    키워드 매칭 기반 간단한 재순위화 (Cross-Encoder 없이)
    
    Cross-Encoder 모델을 사용할 수 없는 환경에서 폴백으로 사용
    """
    import re
    
    # 쿼리에서 키워드 추출 (한글 2글자 이상)
    query_terms = set(re.findall(r'[가-힣]{2,}', query))
    
    scored_chunks = []
    for chunk in chunks:
        content = chunk.get(content_key, "")
        if not isinstance(content, str):
            content = str(content)
        
        # 키워드 매칭 점수
        keyword_score = sum(1 for term in query_terms if term in content)
        
        # 문서 시작 부분 매칭 가중치 (중요 정보가 앞에 있을 확률 높음)
        start_match = sum(1 for term in query_terms if term in content[:200])
        
        # 제목/헤더 매칭 (대괄호, 제목 등)
        header_match = sum(1 for term in query_terms 
                         if re.search(rf'\[.*{term}.*\]|^.*{term}.*$', content, re.MULTILINE))
        
        total_score = keyword_score + start_match * 0.5 + header_match * 0.3
        
        chunk_copy = chunk.copy()
        chunk_copy["keyword_score"] = total_score
        scored_chunks.append((chunk_copy, total_score))
    
    # 점수순 정렬
    scored_chunks.sort(key=lambda x: x[1], reverse=True)
    
    return [chunk for chunk, _ in scored_chunks[:top_n]]
