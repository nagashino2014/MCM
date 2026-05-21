"""
RAG 심층 분석 모듈

Chain-of-Thought 기반 4단계 분석 파이프라인:
1. 사실 확인 (Fact Check)
2. 배경 분석 (Trend Analysis)
3. 영향 분석 (Impact Assessment)
4. 대응 전략 (Response Strategy)

고급 RAG 기법 지원:
- Hybrid Search (시맨틱 + BM25)
- Re-ranking (Cross-Encoder)
- Query Decomposition
- Multi-hop RAG
"""

import numpy as np
from typing import List, Dict, Any, Optional, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime
import json
import re
from collections import Counter


# ============================================================
# 타입 정의
# ============================================================

@dataclass
class AnalysisStep:
    """분석 단계 정의"""
    id: str
    name: str
    method: str
    prompt_key: str
    description: str


@dataclass
class AnalysisContext:
    """분석 컨텍스트"""
    issue_id: str
    issue_title: str
    issue_summary: str
    keywords: List[str]
    sources: List[Dict[str, str]]
    related_chunks: List[Dict[str, Any]]
    profile_context: Optional[str] = None  # 사업장 프로파일 컨텍스트


@dataclass
class StepResult:
    """단계별 분석 결과"""
    step_id: str
    step_name: str
    method: str
    content: str
    sources: List[str]
    confidence: float
    input_tokens: int
    output_tokens: int
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class AnalysisResult:
    """전체 분석 결과"""
    issue_id: str
    steps: List[StepResult]
    summary: str
    recommendations: List[str]
    total_input_tokens: int
    total_output_tokens: int
    total_cost: float
    model: str
    completed_at: str = field(default_factory=lambda: datetime.now().isoformat())


# ============================================================
# 분석 단계 정의
# ============================================================

STANDARD_ANALYSIS_STEPS: List[AnalysisStep] = [
    AnalysisStep(
        id="fact_check",
        name="데이터 수집",
        method="Retrieval",
        prompt_key="factCheck",
        description="관련 문서를 수집하고 핵심 사실을 확인합니다."
    ),
    AnalysisStep(
        id="trend_analysis",
        name="초기 분석",
        method="Chain-of-Thought",
        prompt_key="trendAnalysis",
        description="배경과 맥락을 분석합니다."
    ),
    AnalysisStep(
        id="impact_assessment",
        name="심층 추론",
        method="Multi-step Reasoning",
        prompt_key="impactAssessment",
        description="산업/기업에 미치는 영향을 분석합니다."
    ),
    AnalysisStep(
        id="response_strategy",
        name="결론 도출",
        method="Synthesis",
        prompt_key="responseStrategy",
        description="대응 전략과 권고사항을 도출합니다."
    ),
]

EXTENDED_ANALYSIS_STEPS: List[AnalysisStep] = STANDARD_ANALYSIS_STEPS + [
    AnalysisStep(
        id="risk_assessment",
        name="리스크 평가",
        method="Risk Assessment",
        prompt_key="impactAssessment",
        description="비용/운영/행정 리스크를 평가합니다."
    ),
    AnalysisStep(
        id="action_planning",
        name="실행 계획",
        method="Action Planning",
        prompt_key="responseStrategy",
        description="구체적인 실행 계획을 수립합니다."
    ),
]


# ============================================================
# 프롬프트 템플릿
# ============================================================

DEFAULT_ANALYSIS_PROMPTS: Dict[str, str] = {
    "factCheck": """## Step 1: 사실 확인 (Fact Check)

다음 이슈에 대해 정확한 사실 관계를 확인하세요.

**이슈**: {issue_title}
**요약**: {summary}
**키워드**: {keywords}

**참고 자료**:
{context}

**확인 사항**:
1. 정확한 법령명/고시명 (약칭이 아닌 정식 명칭)
2. 시행일/예고 기간/의견 제출 마감일
3. 주요 변경 조항 (변경 전 → 변경 후 비교표)
4. 적용 대상 및 범위
5. 관련 부처/기관

각 사실에 대해 출처를 명시하세요.
""",

    "trendAnalysis": """## Step 2: 배경 분석 (Trend Analysis)

다음 이슈의 발생 배경을 분석하세요.

**이슈**: {issue_title}
**이전 분석 결과**: {previous_analysis}

**참고 자료**:
{context}

**분석 항목**:
1. **국내 정책 기조**: 이 변화가 발생한 국내 배경
2. **국제 동향**: 관련 국제 기준/협약 (EU, UN, 주요국 정책)
3. **산업계 동향**: 산업계 요구 및 사회적 압력
4. **기존 규제 연관성**: 기존 규제와의 연관성 및 변화 방향

출처를 명시하여 작성해 주세요.
""",

    "impactAssessment": """## Step 3: 영향 분석 (Impact Assessment)

다음 이슈가 산업계에 미치는 영향을 분석하세요.

**이슈**: {issue_title}
**이전 분석 결과**: {previous_analysis}

**참고 자료**:
{context}

{profile_context}

**분석 항목**:
1. **영향 대상**: 영향받는 산업/업종/기업 유형
2. **비용 영향**: 예상되는 비용/투자 규모 (CAPEX/OPEX)
3. **운영 영향**: 공정/설비/인력에 대한 영향
4. **시간 영향**: 시행까지 남은 준비 기간
5. **제재 리스크**: 비준수 시 제재/불이익

가능하면 정량적 데이터를 포함해 주세요.
""",

    "responseStrategy": """## Step 4: 대응 전략 (Response Strategy)

다음 이슈에 대한 대응 전략을 제시하세요.

**이슈**: {issue_title}
**이전 분석 결과**: {previous_analysis}

**참고 자료**:
{context}

{profile_context}

**대응 전략**:

### 1. 단기 대응 (3개월 이내)
- 즉시 조치가 필요한 사항
- 현황 파악 및 점검 사항
- 관련 부서 공유 사항

### 2. 중기 대응 (1년 이내)
- 시스템/프로세스 개선 사항
- 인력/조직 대응 사항
- 설비/장비 검토 사항

### 3. 장기 대응 (1년 이상)
- 전략적 투자 방향
- 기회 요인 활용 방안
- 산업 트렌드 대응

**권고사항**: 우선순위가 높은 3-5개 핵심 조치사항

실행 가능한 구체적 조치를 제시해 주세요.
""",
}

SYSTEM_PROMPT = """당신은 환경/에너지 규제 분석 전문가입니다.
선택된 이슈에 대해 단계별로 심층 분석을 수행합니다.
정확한 법령명, 시행일, 변경 사항을 파악하고 대응 전략을 제시합니다.

분석 원칙:
1. 사실에 기반한 분석 (출처 명시)
2. 정량적 데이터 활용 (가능한 경우)
3. 구체적이고 실행 가능한 권고
4. 업종/사업장 특성 고려

응답은 마크다운 형식으로 구조화하여 작성합니다."""


# ============================================================
# 유틸리티 함수
# ============================================================

def extract_sources_from_content(content: str) -> List[str]:
    """분석 결과에서 출처 추출"""
    sources = []
    
    # 다양한 출처 패턴 매칭
    patterns = [
        r'\[출처[:\s]*([^\]]+)\]',
        r'출처[:\s]+([^\n]+)',
        r'참고[:\s]+([^\n]+)',
        r'\(([^)]*(?:법|령|규정|고시|지침)[^)]*)\)',
        r'「([^」]+)」',
        r'『([^』]+)』',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, content)
        for match in matches:
            source = match.strip()
            if source and len(source) < 200 and source not in sources:
                sources.append(source)
    
    return sources[:15]  # 최대 15개


def calculate_confidence(content: str, sources: List[str]) -> float:
    """분석 결과의 신뢰도 계산"""
    score = 0.5  # 기본 점수
    
    # 출처가 있으면 점수 증가
    score += min(len(sources) * 0.05, 0.2)
    
    # 구체적 날짜/숫자가 있으면 점수 증가
    if re.search(r'\d{4}년', content):
        score += 0.05
    if re.search(r'\d+[만억]?\s*원', content):
        score += 0.05
    if re.search(r'\d+(?:\.\d+)?%', content):
        score += 0.05
    
    # 법령명이 있으면 점수 증가
    if re.search(r'법|령|규정|고시|지침', content):
        score += 0.1
    
    return min(1.0, score)


def build_context_from_chunks(chunks: List[Dict[str, Any]], max_length: int = 8000) -> str:
    """청크들로부터 컨텍스트 문자열 생성"""
    context_parts = []
    current_length = 0
    
    for i, chunk in enumerate(chunks):
        content = chunk.get("content", "")
        metadata = chunk.get("metadata", {})
        
        source = metadata.get("org_name", "")
        board = metadata.get("board_name", "")
        source_info = f"[{source} - {board}]" if source else ""
        
        chunk_text = f"### 문서 {i+1} {source_info}\n{content}\n"
        
        if current_length + len(chunk_text) > max_length:
            break
        
        context_parts.append(chunk_text)
        current_length += len(chunk_text)
    
    return "\n---\n".join(context_parts)


def decompose_query(issue_title: str, issue_summary: str) -> List[str]:
    """복잡한 질문을 서브 질문으로 분해 (Query Decomposition)"""
    queries = [
        f"{issue_title} 관련 법령 현황",
        f"{issue_title} 시행일 및 적용 범위",
        f"{issue_title} 산업 영향",
        f"{issue_title} 대응 방안",
    ]
    
    # 키워드 기반 추가 쿼리
    keywords = re.findall(r'[가-힣]{2,}', issue_summary)[:5]
    for kw in keywords:
        if len(kw) >= 3:
            queries.append(f"{kw} 규제 동향")
    
    return queries[:6]  # 최대 6개


# ============================================================
# Hybrid Search (강화된 버전)
# ============================================================

# BM25 라이브러리 사용 가능 여부 확인
try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except ImportError:
    BM25_AVAILABLE = False


class HybridSearcher:
    """
    고급 하이브리드 검색기
    
    시맨틱 검색(벡터)과 어휘 검색(BM25)을 결합하여 검색 품질 향상
    """
    
    def __init__(
        self,
        semantic_weight: float = 0.5,
        lexical_weight: float = 0.5,
        rrf_k: int = 60
    ):
        """
        Args:
            semantic_weight: 시맨틱 검색 가중치
            lexical_weight: 어휘 검색 가중치
            rrf_k: RRF 파라미터 (기본 60)
        """
        self.semantic_weight = semantic_weight
        self.lexical_weight = lexical_weight
        self.rrf_k = rrf_k
        self.bm25 = None
        self.corpus = []
        self.chunk_map = {}
    
    def _tokenize_korean(self, text: str) -> List[str]:
        """한국어 토크나이징 (형태소 분석 없이)"""
        # 한글, 영어, 숫자 추출 (2글자 이상)
        tokens = re.findall(r'[가-힣]+|[a-zA-Z]+|[0-9]+', text.lower())
        return [t for t in tokens if len(t) >= 2]
    
    def index_chunks(self, chunks: List[Dict[str, Any]], content_key: str = "content"):
        """청크를 BM25 인덱스에 추가"""
        self.corpus = []
        self.chunk_map = {}
        
        for i, chunk in enumerate(chunks):
            content = chunk.get(content_key, "")
            if isinstance(content, str):
                tokens = self._tokenize_korean(content)
            else:
                tokens = self._tokenize_korean(str(content))
            self.corpus.append(tokens)
            self.chunk_map[i] = chunk
        
        if BM25_AVAILABLE and self.corpus:
            self.bm25 = BM25Okapi(self.corpus)
    
    def compute_bm25_scores(self, query: str) -> List[float]:
        """BM25 점수 계산"""
        if not BM25_AVAILABLE or self.bm25 is None:
            # 폴백: 간단한 TF 기반 점수
            return calculate_bm25_scores_simple(query, [" ".join(tokens) for tokens in self.corpus])
        
        query_tokens = self._tokenize_korean(query)
        return self.bm25.get_scores(query_tokens).tolist()
    
    def reciprocal_rank_fusion(
        self,
        semantic_results: List[Tuple[int, float]],
        lexical_results: List[Tuple[int, float]],
        top_k: int = 50
    ) -> List[Tuple[int, float]]:
        """
        Reciprocal Rank Fusion (RRF) - 두 검색 결과 융합
        
        Args:
            semantic_results: 시맨틱 검색 결과 [(인덱스, 점수), ...]
            lexical_results: 어휘 검색 결과 [(인덱스, 점수), ...]
            top_k: 반환할 결과 수
            
        Returns:
            융합된 결과 [(인덱스, RRF점수), ...]
        """
        from collections import defaultdict
        
        rrf_scores = defaultdict(float)
        
        # 시맨틱 검색 RRF 점수
        for rank, (idx, _) in enumerate(semantic_results):
            rrf_scores[idx] += self.semantic_weight / (self.rrf_k + rank + 1)
        
        # 어휘 검색 RRF 점수
        for rank, (idx, _) in enumerate(lexical_results):
            rrf_scores[idx] += self.lexical_weight / (self.rrf_k + rank + 1)
        
        # 점수순 정렬
        sorted_results = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
        return sorted_results[:top_k]
    
    def search(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        query_embedding: Optional[List[float]] = None,
        top_k: int = 50,
        content_key: str = "content",
        embedding_key: str = "embedding"
    ) -> List[Dict[str, Any]]:
        """
        하이브리드 검색 수행
        
        Args:
            query: 검색 쿼리
            chunks: 청크 목록
            query_embedding: 쿼리 임베딩 (없으면 시맨틱 검색 생략)
            top_k: 반환할 결과 수
            content_key: 콘텐츠 필드명
            embedding_key: 임베딩 필드명
            
        Returns:
            정렬된 청크 목록
        """
        if not chunks:
            return []
        
        # BM25 인덱싱
        self.index_chunks(chunks, content_key)
        
        # 시맨틱 점수 계산
        semantic_results = []
        if query_embedding:
            query_vec = np.array(query_embedding)
            for i, chunk in enumerate(chunks):
                embedding = chunk.get(embedding_key)
                if embedding:
                    chunk_vec = np.array(embedding)
                    similarity = np.dot(query_vec, chunk_vec) / (
                        np.linalg.norm(query_vec) * np.linalg.norm(chunk_vec) + 1e-10
                    )
                    semantic_results.append((i, float(similarity)))
                else:
                    semantic_results.append((i, 0.0))
            # 점수순 정렬
            semantic_results.sort(key=lambda x: x[1], reverse=True)
        
        # BM25 점수 계산
        bm25_scores = self.compute_bm25_scores(query)
        lexical_results = [(i, score) for i, score in enumerate(bm25_scores)]
        lexical_results.sort(key=lambda x: x[1], reverse=True)
        
        # RRF 융합 또는 단일 검색 결과 사용
        if query_embedding and semantic_results:
            fused = self.reciprocal_rank_fusion(semantic_results, lexical_results, top_k)
        else:
            fused = lexical_results[:top_k]
        
        # 결과 생성
        results = []
        for idx, rrf_score in fused:
            chunk = chunks[idx].copy()
            chunk["hybrid_score"] = rrf_score
            if query_embedding and semantic_results:
                # 원래 시맨틱 점수도 포함
                for sem_idx, sem_score in semantic_results:
                    if sem_idx == idx:
                        chunk["semantic_score"] = sem_score
                        break
            results.append(chunk)
        
        return results


def hybrid_search(
    query: str,
    chunks: List[Dict[str, Any]],
    query_embedding: List[float],
    alpha: float = 0.5,
    top_k: int = 10
) -> List[Dict[str, Any]]:
    """
    Hybrid Search (시맨틱 + BM25)
    
    Args:
        query: 검색 쿼리
        chunks: 청크 목록 (content, embedding 포함)
        query_embedding: 쿼리 임베딩
        alpha: 시맨틱/키워드 가중치 (0~1, 높을수록 시맨틱 중심)
        top_k: 반환할 결과 수
    
    Returns:
        정렬된 청크 목록
    """
    if not chunks:
        return []
    
    # HybridSearcher 사용
    searcher = HybridSearcher(
        semantic_weight=alpha,
        lexical_weight=(1 - alpha)
    )
    
    return searcher.search(query, chunks, query_embedding, top_k)


def calculate_bm25_scores_simple(query: str, documents: List[str], k1: float = 1.5, b: float = 0.75) -> List[float]:
    """간단한 BM25 점수 계산 (라이브러리 없이)"""
    # 쿼리 토큰화
    query_terms = set(re.findall(r'[가-힣a-zA-Z0-9]+', query.lower()))
    
    # 문서 길이
    doc_lengths = [len(doc) for doc in documents]
    avg_doc_length = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 1
    
    # 각 문서의 BM25 점수
    scores = []
    for doc, doc_len in zip(documents, doc_lengths):
        doc_terms = re.findall(r'[가-힣a-zA-Z0-9]+', doc.lower())
        term_freq = Counter(doc_terms)
        
        score = 0.0
        for term in query_terms:
            tf = term_freq.get(term, 0)
            if tf > 0:
                # IDF는 간단히 1로 설정 (전체 문서 수가 적을 때)
                idf = 1.0
                numerator = tf * (k1 + 1)
                denominator = tf + k1 * (1 - b + b * doc_len / avg_doc_length)
                score += idf * numerator / denominator
        
        scores.append(score)
    
    return scores


# Legacy alias
def calculate_bm25_scores(query: str, documents: List[str], k1: float = 1.5, b: float = 0.75) -> List[float]:
    """BM25 점수 계산 (하위 호환성)"""
    return calculate_bm25_scores_simple(query, documents, k1, b)


def normalize_scores(scores: List[float]) -> List[float]:
    """점수 정규화 (0~1)"""
    if not scores:
        return []
    
    min_score = min(scores)
    max_score = max(scores)
    
    if max_score - min_score < 1e-10:
        return [0.5] * len(scores)
    
    return [(s - min_score) / (max_score - min_score) for s in scores]


# ============================================================
# Re-ranking (Cross-Encoder 지원)
# ============================================================

def rerank_chunks(
    query: str,
    chunks: List[Dict[str, Any]],
    top_n: int = 5,
    use_cross_encoder: bool = True,
    model_name: str = "BAAI/bge-reranker-v2-m3"
) -> List[Dict[str, Any]]:
    """
    Cross-Encoder 기반 Re-ranking
    
    Args:
        query: 검색 쿼리
        chunks: 후보 청크 목록
        top_n: 반환할 결과 수
        use_cross_encoder: Cross-Encoder 모델 사용 여부
        model_name: Cross-Encoder 모델명
    
    Returns:
        재순위화된 청크 목록
    """
    if not chunks:
        return []
    
    # Cross-Encoder 사용 시도
    if use_cross_encoder:
        try:
            from .reranker import rerank_with_fallback, is_reranker_available
            
            if is_reranker_available():
                return rerank_with_fallback(query, chunks, top_n, model_name)
        except ImportError:
            pass
        except Exception as e:
            print(f"[Rerank] Cross-Encoder failed: {e}, using keyword fallback")
    
    # 폴백: 키워드 기반 재순위화
    return rerank_chunks_by_keywords(query, chunks, top_n)


def rerank_chunks_by_keywords(
    query: str,
    chunks: List[Dict[str, Any]],
    top_n: int = 5
) -> List[Dict[str, Any]]:
    """
    키워드 매칭 기반 재순위화 (Cross-Encoder 폴백)
    
    Args:
        query: 검색 쿼리
        chunks: 후보 청크 목록
        top_n: 반환할 결과 수
    
    Returns:
        재순위화된 청크 목록
    """
    if not chunks:
        return []
    
    query_terms = set(re.findall(r'[가-힣]{2,}', query))
    
    scored_chunks = []
    for chunk in chunks:
        content = chunk.get("content", "")
        
        # 키워드 매칭 점수
        keyword_score = sum(1 for term in query_terms if term in content)
        
        # 문서 시작 부분 매칭 가중치
        start_match = sum(1 for term in query_terms if term in content[:200])
        
        # 제목/헤더 매칭 (대괄호, 제목 등)
        header_match = sum(1 for term in query_terms 
                          if re.search(rf'\[.*{term}.*\]|^.*{term}.*$', content, re.MULTILINE))
        
        total_score = keyword_score + start_match * 0.5 + header_match * 0.3
        scored_chunks.append((chunk, total_score))
    
    # 점수순 정렬
    scored_chunks.sort(key=lambda x: x[1], reverse=True)
    
    return [chunk for chunk, score in scored_chunks[:top_n]]


# ============================================================
# Multi-hop RAG
# ============================================================

async def multi_hop_analysis(
    context: AnalysisContext,
    llm_callback: Callable,
    search_callback: Callable,
    max_hops: int = 3
) -> Tuple[str, List[str]]:
    """
    Multi-hop RAG: 반복적으로 검색하며 정보를 축적
    
    Args:
        context: 분석 컨텍스트
        llm_callback: LLM 호출 함수
        search_callback: 검색 함수
        max_hops: 최대 반복 횟수
    
    Returns:
        (축적된 분석 결과, 수집된 출처 목록)
    """
    accumulated_info = []
    all_sources = []
    
    # 초기 쿼리
    queries = decompose_query(context.issue_title, context.issue_summary)
    
    for hop in range(max_hops):
        # 각 쿼리로 검색
        for query in queries[:2]:  # 라운드당 2개 쿼리
            try:
                chunks = await search_callback(query)
                if chunks:
                    context_text = build_context_from_chunks(chunks, max_length=2000)
                    accumulated_info.append(f"### {query}\n{context_text}")
                    
                    # 출처 수집
                    for chunk in chunks:
                        meta = chunk.get("metadata", {})
                        source = f"{meta.get('org_name', '')} - {meta.get('board_name', '')}"
                        if source and source not in all_sources:
                            all_sources.append(source)
            except Exception as e:
                print(f"[Multi-hop] Search error: {e}")
        
        # 중간 분석으로 후속 쿼리 생성
        if hop < max_hops - 1 and accumulated_info:
            try:
                follow_up_prompt = f"""지금까지 수집된 정보를 바탕으로, 
"{context.issue_title}"에 대해 추가로 확인이 필요한 사항을 2개 질문 형태로 제시하세요.

수집된 정보:
{accumulated_info[-1][:1000]}

JSON 형식으로 응답: {{"queries": ["질문1", "질문2"]}}"""
                
                response = await llm_callback(follow_up_prompt)
                parsed = json.loads(re.search(r'\{.*\}', response, re.DOTALL).group())
                queries = parsed.get("queries", [])[:2]
            except:
                break  # 후속 쿼리 생성 실패 시 종료
    
    return "\n\n".join(accumulated_info), all_sources


# ============================================================
# 심층 분석 파이프라인
# ============================================================

async def run_deep_analysis(
    context: AnalysisContext,
    steps: List[AnalysisStep],
    llm_callback: Callable,
    search_callback: Optional[Callable] = None,
    prompts: Dict[str, str] = None,
    progress_callback: Optional[Callable] = None
) -> AnalysisResult:
    """
    심층 분석 파이프라인 실행
    
    Args:
        context: 분석 컨텍스트
        steps: 실행할 분석 단계 목록
        llm_callback: LLM 호출 함수 (async def callback(system, user) -> (content, input_tokens, output_tokens))
        search_callback: 검색 함수 (선택, async def callback(query) -> chunks)
        prompts: 커스텀 프롬프트 (선택)
        progress_callback: 진행 상황 콜백 (선택)
    
    Returns:
        분석 결과
    """
    prompts = prompts or DEFAULT_ANALYSIS_PROMPTS
    step_results: List[StepResult] = []
    previous_analysis = ""
    total_input = 0
    total_output = 0
    
    # 기본 컨텍스트 구성
    base_context = build_context_from_chunks(context.related_chunks)
    
    for i, step in enumerate(steps):
        if progress_callback:
            await progress_callback(step.name, int((i / len(steps)) * 100))
        
        # 프롬프트 구성
        prompt_template = prompts.get(step.prompt_key, DEFAULT_ANALYSIS_PROMPTS.get(step.prompt_key, ""))
        
        prompt = prompt_template.format(
            issue_title=context.issue_title,
            summary=context.issue_summary,
            keywords=", ".join(context.keywords),
            context=base_context,
            previous_analysis=previous_analysis,
            profile_context=context.profile_context or ""
        )
        
        try:
            # LLM 호출
            content, input_tokens, output_tokens = await llm_callback(SYSTEM_PROMPT, prompt)
            
            # 출처 추출
            sources = extract_sources_from_content(content)
            
            # 신뢰도 계산
            confidence = calculate_confidence(content, sources)
            
            step_result = StepResult(
                step_id=step.id,
                step_name=step.name,
                method=step.method,
                content=content,
                sources=sources,
                confidence=confidence,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )
            
            step_results.append(step_result)
            total_input += input_tokens
            total_output += output_tokens
            
            # 다음 단계를 위해 이전 분석 결과 업데이트
            previous_analysis = f"### {step.name} 결과 요약\n{content[:500]}..."
            
        except Exception as e:
            print(f"[Analysis] Step {step.name} error: {e}")
            step_results.append(StepResult(
                step_id=step.id,
                step_name=step.name,
                method="Error",
                content=f"분석 중 오류 발생: {str(e)}",
                sources=[],
                confidence=0.0,
                input_tokens=0,
                output_tokens=0
            ))
    
    if progress_callback:
        await progress_callback("완료", 100)
    
    # 최종 요약 및 권고사항 추출
    summary = ""
    recommendations = []
    
    if step_results:
        last_result = step_results[-1]
        summary = last_result.content[:500] if last_result.content else ""
        
        # 권고사항 추출
        rec_patterns = [
            r'권고사항[:\s]*(.*?)(?:\n\n|\Z)',
            r'조치사항[:\s]*(.*?)(?:\n\n|\Z)',
            r'\d+\.\s+(.+?)(?:\n|$)',
        ]
        for pattern in rec_patterns:
            matches = re.findall(pattern, last_result.content, re.DOTALL)
            for match in matches:
                if len(match) > 10:
                    recommendations.append(match.strip()[:200])
    
    return AnalysisResult(
        issue_id=context.issue_id,
        steps=step_results,
        summary=summary,
        recommendations=recommendations[:5],
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_cost=0.0,  # 호출자가 계산
        model=""  # 호출자가 설정
    )


# ============================================================
# 편의 함수
# ============================================================

def get_analysis_steps(depth: str = "standard") -> List[AnalysisStep]:
    """분석 깊이에 따른 단계 반환"""
    if depth == "quick":
        return STANDARD_ANALYSIS_STEPS[:2]
    elif depth == "deep":
        return EXTENDED_ANALYSIS_STEPS
    else:
        return STANDARD_ANALYSIS_STEPS


def format_analysis_for_report(result: AnalysisResult) -> str:
    """분석 결과를 보고서 형식으로 포맷"""
    sections = []
    
    for step in result.steps:
        section = f"""## {step.step_name}

{step.content}

---
*분석 방법: {step.method} | 신뢰도: {step.confidence:.0%}*
"""
        sections.append(section)
    
    if result.recommendations:
        rec_section = "## 권고사항\n\n"
        for i, rec in enumerate(result.recommendations, 1):
            rec_section += f"{i}. {rec}\n"
        sections.append(rec_section)
    
    return "\n\n".join(sections)
