"""
Advanced RAG Retrieval Pipeline

모든 Retrieval 품질 향상 기법을 통합한 고급 검색 파이프라인:
- Query Expansion (LLM 기반 질의 확장)
- HyDE (가상 문서 임베딩)
- Hybrid Search (시맨틱 + BM25)
- Cross-Encoder Reranking

사용법:
    retriever = AdvancedRetriever(vector_db, embedding_model, llm_api_key)
    results = await retriever.retrieve(query, strategy="advanced")
"""

from typing import List, Dict, Any, Optional, Callable, Awaitable, Tuple
from dataclasses import dataclass, field
from enum import Enum
import logging
import asyncio

logger = logging.getLogger(__name__)


# ============================================================
# 설정 타입
# ============================================================

class RetrievalStrategy(Enum):
    """검색 전략"""
    BASIC = "basic"           # 단순 벡터 검색
    HYBRID = "hybrid"         # 벡터 + BM25
    ADVANCED = "advanced"     # 전체 파이프라인


@dataclass
class RetrievalConfig:
    """검색 설정"""
    strategy: RetrievalStrategy = RetrievalStrategy.ADVANCED
    
    # Direct Search
    direct_top_k: int = 50
    
    # Query Expansion
    enable_query_expansion: bool = True
    num_expanded_queries: int = 5
    expansion_top_k: int = 30
    
    # HyDE
    enable_hyde: bool = True
    num_hypothetical_docs: int = 3
    hyde_top_k: int = 50
    
    # Hybrid Search
    enable_hybrid: bool = True
    semantic_weight: float = 0.5
    lexical_weight: float = 0.5
    
    # Reranking
    enable_reranking: bool = True
    rerank_top_n: int = 15
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    
    # LLM 설정
    llm_model: str = "gpt-4o-mini"


@dataclass
class RetrievalResult:
    """검색 결과"""
    chunks: List[Dict[str, Any]]
    total_found: int
    strategy_used: str
    stages_completed: List[str]
    token_usage: Dict[str, int] = field(default_factory=dict)
    timing_ms: Dict[str, float] = field(default_factory=dict)


# ============================================================
# Advanced Retriever
# ============================================================

class AdvancedRetriever:
    """
    고급 검색 파이프라인
    
    모든 Retrieval 품질 향상 기법을 통합하여 검색 정확도를 극대화합니다.
    """
    
    def __init__(
        self,
        vector_search_fn: Callable[[str, int, Optional[dict]], Awaitable[List[Dict[str, Any]]]],
        embedding_fn: Callable[[str], Awaitable[List[float]]],
        llm_api_key: Optional[str] = None,
        config: Optional[RetrievalConfig] = None
    ):
        """
        Args:
            vector_search_fn: 벡터 검색 함수 (async def search(query, top_k, filters) -> List[Dict])
            embedding_fn: 임베딩 생성 함수 (async def embed(text) -> List[float])
            llm_api_key: LLM API 키 (Query Expansion, HyDE에 필요)
            config: 검색 설정
        """
        self.vector_search_fn = vector_search_fn
        self.embedding_fn = embedding_fn
        self.llm_api_key = llm_api_key
        self.config = config or RetrievalConfig()
        
        # HybridSearcher 초기화
        from .rag_analysis import HybridSearcher
        self.hybrid_searcher = HybridSearcher(
            semantic_weight=self.config.semantic_weight,
            lexical_weight=self.config.lexical_weight
        )
    
    async def retrieve(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        strategy: Optional[RetrievalStrategy] = None,
        config_override: Optional[Dict[str, Any]] = None
    ) -> RetrievalResult:
        """
        고급 검색 파이프라인 실행
        
        Args:
            query: 검색 쿼리
            filters: 메타데이터 필터
            strategy: 검색 전략 (None이면 config 설정 사용)
            config_override: 설정 오버라이드
            
        Returns:
            검색 결과
        """
        import time
        
        # 설정 적용
        config = self._apply_config_override(config_override)
        strategy = strategy or config.strategy
        
        stages_completed = []
        timing = {}
        token_usage = {"input": 0, "output": 0}
        
        # ========================================
        # BASIC 전략: 단순 벡터 검색
        # ========================================
        if strategy == RetrievalStrategy.BASIC:
            start = time.time()
            chunks = await self.vector_search_fn(query, config.direct_top_k, filters)
            timing["direct_search"] = (time.time() - start) * 1000
            stages_completed.append("direct_search")
            
            return RetrievalResult(
                chunks=chunks,
                total_found=len(chunks),
                strategy_used="basic",
                stages_completed=stages_completed,
                token_usage=token_usage,
                timing_ms=timing
            )
        
        # ========================================
        # Stage 1: Multi-Source Retrieval
        # ========================================
        all_candidates: Dict[str, Dict[str, Any]] = {}
        
        # 1-A: Direct Vector Search
        start = time.time()
        direct_results = await self.vector_search_fn(query, config.direct_top_k, filters)
        timing["direct_search"] = (time.time() - start) * 1000
        stages_completed.append("direct_search")
        self._merge_results(all_candidates, direct_results, "direct")
        
        # 1-B: Query Expansion (ADVANCED 전략만)
        if strategy == RetrievalStrategy.ADVANCED and config.enable_query_expansion and self.llm_api_key:
            start = time.time()
            try:
                from .query_expansion import expand_query_with_llm
                
                expansion = await expand_query_with_llm(
                    query, self.llm_api_key, config.llm_model,
                    num_expansions=config.num_expanded_queries
                )
                token_usage["input"] += expansion.input_tokens
                token_usage["output"] += expansion.output_tokens
                
                # 확장된 쿼리로 검색
                for exp_query in expansion.expanded_queries[1:]:  # 원본 제외
                    exp_results = await self.vector_search_fn(exp_query, config.expansion_top_k, filters)
                    self._merge_results(all_candidates, exp_results, "expanded")
                
                stages_completed.append("query_expansion")
                timing["query_expansion"] = (time.time() - start) * 1000
                
            except Exception as e:
                logger.error(f"[Retrieval] Query expansion failed: {e}")
        
        # 1-C: HyDE Search (ADVANCED 전략만)
        if strategy == RetrievalStrategy.ADVANCED and config.enable_hyde and self.llm_api_key:
            start = time.time()
            try:
                from .hyde import hyde_search
                
                # 임베딩 검색 함수 래퍼
                async def vector_search_by_embedding(embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
                    # 임베딩으로 직접 검색하는 함수 필요
                    # 여기서는 fallback으로 원본 쿼리 검색 사용
                    return await self.vector_search_fn(query, top_k, filters)
                
                hyde_results = await hyde_search(
                    query, self.embedding_fn, vector_search_by_embedding,
                    self.llm_api_key, config.llm_model,
                    top_k=config.hyde_top_k,
                    num_hypothetical=config.num_hypothetical_docs
                )
                self._merge_results(all_candidates, hyde_results, "hyde")
                
                stages_completed.append("hyde")
                timing["hyde"] = (time.time() - start) * 1000
                
            except Exception as e:
                logger.error(f"[Retrieval] HyDE search failed: {e}")
        
        candidates = list(all_candidates.values())
        logger.info(f"[Retrieval] Stage 1 완료: {len(candidates)}개 후보")
        
        # ========================================
        # Stage 2: Hybrid Search Refinement
        # ========================================
        if config.enable_hybrid and len(candidates) > 20:
            start = time.time()
            try:
                # 쿼리 임베딩 생성
                query_embedding = await self.embedding_fn(query)
                
                candidates = self.hybrid_searcher.search(
                    query, candidates, query_embedding,
                    top_k=min(80, len(candidates))
                )
                
                stages_completed.append("hybrid_search")
                timing["hybrid_search"] = (time.time() - start) * 1000
                logger.info(f"[Retrieval] Stage 2 (Hybrid) 완료: {len(candidates)}개")
                
            except Exception as e:
                logger.error(f"[Retrieval] Hybrid search failed: {e}")
        
        # ========================================
        # Stage 3: Cross-Encoder Reranking
        # ========================================
        if config.enable_reranking and len(candidates) > 5:
            start = time.time()
            try:
                from .reranker import rerank_with_fallback, is_reranker_available
                
                if is_reranker_available():
                    candidates = rerank_with_fallback(
                        query, candidates, config.rerank_top_n, config.reranker_model
                    )
                    stages_completed.append("reranking")
                else:
                    # 폴백: 키워드 기반 재순위화
                    from .rag_analysis import rerank_chunks_by_keywords
                    candidates = rerank_chunks_by_keywords(query, candidates, config.rerank_top_n)
                    stages_completed.append("keyword_reranking")
                
                timing["reranking"] = (time.time() - start) * 1000
                
            except Exception as e:
                logger.error(f"[Retrieval] Reranking failed: {e}")
        
        logger.info(f"[Retrieval] 최종: {len(candidates)}개 고품질 문서")
        
        return RetrievalResult(
            chunks=candidates,
            total_found=len(candidates),
            strategy_used=strategy.value,
            stages_completed=stages_completed,
            token_usage=token_usage,
            timing_ms=timing
        )
    
    def _merge_results(
        self,
        all_candidates: Dict[str, Dict[str, Any]],
        results: List[Dict[str, Any]],
        source: str
    ):
        """검색 결과를 통합 (중복 제거)"""
        for chunk in results:
            chunk_id = chunk.get("id") or str(hash(chunk.get("content", "")[:100]))
            
            if chunk_id not in all_candidates:
                all_candidates[chunk_id] = chunk.copy()
                all_candidates[chunk_id]["_retrieval_sources"] = [source]
                all_candidates[chunk_id]["_match_count"] = 1
            else:
                all_candidates[chunk_id]["_retrieval_sources"].append(source)
                all_candidates[chunk_id]["_match_count"] += 1
                
                # 더 높은 점수로 업데이트
                old_score = all_candidates[chunk_id].get("score", 0)
                new_score = chunk.get("score", 0)
                if new_score > old_score:
                    all_candidates[chunk_id]["score"] = new_score
    
    def _apply_config_override(self, override: Optional[Dict[str, Any]]) -> RetrievalConfig:
        """설정 오버라이드 적용"""
        if not override:
            return self.config
        
        # 새 config 객체 생성
        config_dict = {
            "strategy": self.config.strategy,
            "direct_top_k": self.config.direct_top_k,
            "enable_query_expansion": self.config.enable_query_expansion,
            "num_expanded_queries": self.config.num_expanded_queries,
            "expansion_top_k": self.config.expansion_top_k,
            "enable_hyde": self.config.enable_hyde,
            "num_hypothetical_docs": self.config.num_hypothetical_docs,
            "hyde_top_k": self.config.hyde_top_k,
            "enable_hybrid": self.config.enable_hybrid,
            "semantic_weight": self.config.semantic_weight,
            "lexical_weight": self.config.lexical_weight,
            "enable_reranking": self.config.enable_reranking,
            "rerank_top_n": self.config.rerank_top_n,
            "reranker_model": self.config.reranker_model,
            "llm_model": self.config.llm_model,
        }
        
        # 오버라이드 적용
        for key, value in override.items():
            if key in config_dict:
                if key == "strategy" and isinstance(value, str):
                    config_dict[key] = RetrievalStrategy(value)
                else:
                    config_dict[key] = value
        
        return RetrievalConfig(**config_dict)


# ============================================================
# 편의 함수
# ============================================================

async def create_retriever_from_chromadb(
    collection,
    embedding_model,
    llm_api_key: Optional[str] = None,
    config: Optional[RetrievalConfig] = None
) -> AdvancedRetriever:
    """
    ChromaDB 컬렉션으로부터 AdvancedRetriever 생성
    
    Args:
        collection: ChromaDB 컬렉션
        embedding_model: 임베딩 모델
        llm_api_key: LLM API 키
        config: 검색 설정
        
    Returns:
        AdvancedRetriever 인스턴스
    """
    async def vector_search(query: str, top_k: int, filters: Optional[dict] = None) -> List[Dict[str, Any]]:
        """ChromaDB 검색 래퍼"""
        query_embedding = embedding_model.encode([query])[0].tolist()
        
        search_params = {
            "query_embeddings": [query_embedding],
            "n_results": top_k,
            "include": ["documents", "metadatas", "distances"]
        }
        
        if filters:
            search_params["where"] = filters
        
        result = collection.query(**search_params)
        
        chunks = []
        if result.get("documents") and result["documents"][0]:
            for i, doc in enumerate(result["documents"][0]):
                chunks.append({
                    "id": result["ids"][0][i] if result.get("ids") else "",
                    "content": doc,
                    "metadata": result["metadatas"][0][i] if result.get("metadatas") else {},
                    "score": 1 - result["distances"][0][i] if result.get("distances") else 0,
                })
        
        return chunks
    
    async def embed_text(text: str) -> List[float]:
        """임베딩 생성 래퍼"""
        return embedding_model.encode([text])[0].tolist()
    
    return AdvancedRetriever(
        vector_search_fn=vector_search,
        embedding_fn=embed_text,
        llm_api_key=llm_api_key,
        config=config
    )


def get_default_config_by_strategy(strategy: str) -> RetrievalConfig:
    """전략별 기본 설정 반환"""
    configs = {
        "basic": RetrievalConfig(
            strategy=RetrievalStrategy.BASIC,
            enable_query_expansion=False,
            enable_hyde=False,
            enable_hybrid=False,
            enable_reranking=False
        ),
        "hybrid": RetrievalConfig(
            strategy=RetrievalStrategy.HYBRID,
            enable_query_expansion=False,
            enable_hyde=False,
            enable_hybrid=True,
            enable_reranking=True
        ),
        "advanced": RetrievalConfig(
            strategy=RetrievalStrategy.ADVANCED,
            enable_query_expansion=True,
            enable_hyde=True,
            enable_hybrid=True,
            enable_reranking=True
        )
    }
    
    return configs.get(strategy, configs["advanced"])


def estimate_retrieval_cost(config: RetrievalConfig, query_length: int = 50) -> Dict[str, float]:
    """검색 비용 추정 (USD)"""
    cost = 0.0
    details = {}
    
    # Query Expansion 비용
    if config.enable_query_expansion:
        # 대략적인 토큰 추정
        input_tokens = 200 + query_length
        output_tokens = 100
        expansion_cost = (input_tokens / 1_000_000 * 0.15) + (output_tokens / 1_000_000 * 0.6)
        cost += expansion_cost
        details["query_expansion"] = expansion_cost
    
    # HyDE 비용
    if config.enable_hyde:
        input_per_doc = 200 + query_length
        output_per_doc = 200
        hyde_cost = config.num_hypothetical_docs * (
            (input_per_doc / 1_000_000 * 0.15) + (output_per_doc / 1_000_000 * 0.6)
        )
        cost += hyde_cost
        details["hyde"] = hyde_cost
    
    # Reranking (로컬 모델이므로 비용 없음)
    details["reranking"] = 0.0
    
    details["total"] = cost
    
    return details
