"""
RAG 이슈 발굴 모듈

K-Means 클러스터링을 사용하여 유사한 청크를 그룹화하고,
각 클러스터에서 주요 이슈를 발굴합니다.
"""

import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import json

# ============================================================
# 타입 정의
# ============================================================

@dataclass
class ChunkData:
    """청크 데이터"""
    id: str
    content: str
    embedding: List[float]
    metadata: Dict[str, Any]


@dataclass
class ClusterResult:
    """클러스터링 결과"""
    cluster_id: int
    chunk_ids: List[str]
    centroid: List[float]
    size: int
    representative_chunks: List[ChunkData]  # 중심에 가까운 청크들
    keywords: List[str]
    

@dataclass
class IssueCandidate:
    """이슈 후보"""
    cluster_id: int
    title: str
    summary: str
    keywords: List[str]
    representative_chunk_ids: List[str]
    cluster_size: int
    sources: List[Dict[str, str]]
    score: Dict[str, float]


# ============================================================
# K-Means 클러스터링
# ============================================================

def cluster_embeddings(
    chunks: List[ChunkData],
    n_clusters: int = 15,
    min_cluster_size: int = 3,
    random_state: int = 42
) -> Tuple[List[ClusterResult], Dict[str, Any]]:
    """
    임베딩 벡터를 K-Means로 클러스터링
    
    Args:
        chunks: 청크 데이터 목록
        n_clusters: 클러스터 수
        min_cluster_size: 최소 클러스터 크기
        random_state: 랜덤 시드
    
    Returns:
        (클러스터 결과 목록, 통계 정보)
    """
    if len(chunks) < n_clusters:
        n_clusters = max(2, len(chunks) // 3)
    
    # 임베딩 행렬 생성
    embeddings = np.array([chunk.embedding for chunk in chunks])
    
    # K-Means 클러스터링
    kmeans = KMeans(
        n_clusters=n_clusters,
        random_state=random_state,
        n_init=10,
        max_iter=300
    )
    labels = kmeans.fit_predict(embeddings)
    centroids = kmeans.cluster_centers_
    
    # 실루엣 점수 계산 (클러스터 품질)
    silhouette = silhouette_score(embeddings, labels) if n_clusters > 1 else 0.0
    
    # 클러스터별 결과 정리
    cluster_results: List[ClusterResult] = []
    
    for cluster_id in range(n_clusters):
        # 해당 클러스터의 청크 인덱스
        cluster_indices = np.where(labels == cluster_id)[0]
        
        if len(cluster_indices) < min_cluster_size:
            continue
        
        # 클러스터 내 청크들
        cluster_chunks = [chunks[i] for i in cluster_indices]
        cluster_chunk_ids = [chunk.id for chunk in cluster_chunks]
        
        # 중심과의 거리 계산
        cluster_embeddings = embeddings[cluster_indices]
        centroid = centroids[cluster_id]
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        
        # 가장 가까운 5개 청크를 대표 후보로 선정
        closest_indices = np.argsort(distances)[:5]
        representative_candidates = [cluster_chunks[i] for i in closest_indices]
        
        # 키워드 추출 (개선된 TF-IDF 기반) - 대표 청크 선정에 사용하기 위해 먼저 추출
        keywords = extract_keywords_enhanced(cluster_chunks)
        
        # Cross-Encoder로 대표 청크 재선정 (사용 가능한 경우)
        representative_chunks = select_representative_chunks(
            representative_candidates,
            keywords,
            top_n=3
        )
        if not representative_chunks:
            representative_chunks = representative_candidates[:3]
        
        cluster_results.append(ClusterResult(
            cluster_id=cluster_id,
            chunk_ids=cluster_chunk_ids,
            centroid=centroid.tolist(),
            size=len(cluster_chunks),
            representative_chunks=representative_chunks,
            keywords=keywords[:10]
        ))
    
    # 크기순 정렬
    cluster_results.sort(key=lambda x: x.size, reverse=True)
    
    stats = {
        "total_chunks": len(chunks),
        "num_clusters": len(cluster_results),
        "silhouette_score": float(silhouette),
        "avg_cluster_size": np.mean([c.size for c in cluster_results]) if cluster_results else 0,
    }
    
    return cluster_results, stats


def extract_keywords_simple(chunks: List[ChunkData], top_n: int = 10) -> List[str]:
    """
    간단한 TF 기반 키워드 추출
    """
    from collections import Counter
    import re
    
    # 모든 텍스트 합치기
    all_text = " ".join(chunk.content for chunk in chunks)
    
    # 한글 단어 추출 (2글자 이상)
    words = re.findall(r'[가-힣]{2,}', all_text)
    
    # 불용어 제거
    stopwords = {
        "있다", "하다", "되다", "이다", "등", "및", "위해", "대한", "또는", "관련",
        "따라", "통해", "의해", "경우", "이상", "이하", "해당", "따른", "대해",
        "있는", "하는", "되는", "것이", "수행", "기준", "내용", "항목", "사항",
        "년도", "기관", "관한", "위한", "시행", "규정", "법률", "제도", "정책",
    }
    words = [w for w in words if w not in stopwords]
    
    # 빈도 계산
    counter = Counter(words)
    
    return [word for word, _ in counter.most_common(top_n)]


def extract_keywords_enhanced(chunks: List[ChunkData], top_n: int = 10) -> List[str]:
    """
    개선된 키워드 추출 (TF-IDF 유사 방식)
    
    - 문서 빈도를 고려하여 특정 클러스터에 특화된 키워드 추출
    - 명사구 패턴 매칭으로 복합 키워드 추출
    """
    from collections import Counter
    import re
    import math
    
    # 모든 텍스트
    all_text = " ".join(chunk.content for chunk in chunks)
    
    # 불용어
    stopwords = {
        "있다", "하다", "되다", "이다", "등", "및", "위해", "대한", "또는", "관련",
        "따라", "통해", "의해", "경우", "이상", "이하", "해당", "따른", "대해",
        "있는", "하는", "되는", "것이", "수행", "기준", "내용", "항목", "사항",
        "년도", "기관", "관한", "위한", "시행", "규정", "법률", "제도", "정책",
        "것으로", "것을", "것은", "것이", "바와", "함께", "대하여", "통하여",
    }
    
    # 단어 추출 (2-5글자 한글)
    words = re.findall(r'[가-힣]{2,5}', all_text)
    words = [w for w in words if w not in stopwords]
    
    # 단어 빈도
    word_freq = Counter(words)
    
    # 문서별 빈도 (IDF 계산용)
    doc_freq = Counter()
    for chunk in chunks:
        chunk_words = set(re.findall(r'[가-힣]{2,5}', chunk.content))
        for word in chunk_words:
            if word not in stopwords:
                doc_freq[word] += 1
    
    # TF-IDF 유사 점수 계산
    num_docs = len(chunks)
    scores = {}
    for word, tf in word_freq.items():
        df = doc_freq.get(word, 1)
        # IDF: 모든 문서에 나타나는 단어는 낮은 점수
        idf = math.log(num_docs / df + 1)
        # 단어 길이 보너스 (3-4글자 선호)
        length_bonus = 1.2 if 3 <= len(word) <= 4 else 1.0
        scores[word] = tf * idf * length_bonus
    
    # 복합 키워드 추출 (명사+명사 패턴)
    compound_patterns = [
        r'([가-힣]{2,4})규제',
        r'([가-힣]{2,4})법',
        r'([가-힣]{2,4})정책',
        r'배출([가-힣]{2,3})',
        r'([가-힣]{2,4})기준',
        r'([가-힣]{2,4})의무',
    ]
    
    for pattern in compound_patterns:
        matches = re.findall(pattern, all_text)
        for match in matches:
            if match not in stopwords:
                # 복합 키워드에 보너스
                if match in scores:
                    scores[match] *= 1.3
    
    # 점수순 정렬
    sorted_keywords = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    
    return [word for word, _ in sorted_keywords[:top_n]]


def select_representative_chunks(
    candidates: List[ChunkData],
    cluster_keywords: List[str],
    top_n: int = 3
) -> List[ChunkData]:
    """
    Cross-Encoder를 사용하여 클러스터 대표 청크 선정
    
    Args:
        candidates: 대표 후보 청크들
        cluster_keywords: 클러스터 키워드
        top_n: 선정할 대표 청크 수
        
    Returns:
        선정된 대표 청크들
    """
    if len(candidates) <= top_n:
        return candidates
    
    try:
        from .reranker import is_reranker_available, rerank_chunks
        
        if is_reranker_available() and cluster_keywords:
            # 클러스터 키워드를 쿼리로 사용
            query = " ".join(cluster_keywords[:5])
            
            # 청크를 딕셔너리 형태로 변환
            chunk_dicts = [
                {"id": c.id, "content": c.content, "metadata": c.metadata}
                for c in candidates
            ]
            
            # Cross-Encoder로 재순위화
            reranked = rerank_chunks(query, chunk_dicts, top_n=top_n)
            
            # 원래 ChunkData 형태로 복원
            reranked_ids = [r["id"] for r in reranked]
            result = []
            for chunk_id in reranked_ids:
                for c in candidates:
                    if c.id == chunk_id:
                        result.append(c)
                        break
            
            return result if result else candidates[:top_n]
            
    except Exception as e:
        print(f"[Discovery] Representative selection fallback: {e}")
    
    # 폴백: 원래 순서 유지
    return candidates[:top_n]


# ============================================================
# 이슈 후보 생성 (LLM 없이 기본 정보만)
# ============================================================

def generate_issue_candidates(
    clusters: List[ClusterResult],
    num_issues: int = 10
) -> List[IssueCandidate]:
    """
    클러스터에서 이슈 후보 생성 (LLM 호출 전)
    
    Args:
        clusters: 클러스터 결과 목록
        num_issues: 생성할 이슈 수
    
    Returns:
        이슈 후보 목록
    """
    candidates: List[IssueCandidate] = []
    
    for cluster in clusters[:num_issues]:
        # 대표 청크에서 제목 추출 시도
        title = f"클러스터 {cluster.cluster_id + 1}: {', '.join(cluster.keywords[:3])}"
        
        # 대표 청크 내용 요약 (앞부분)
        summaries = []
        for chunk in cluster.representative_chunks[:2]:
            content = chunk.content[:200].strip()
            if content:
                summaries.append(content)
        summary = " | ".join(summaries) if summaries else "요약 없음"
        
        # 출처 정보 수집
        sources = []
        seen_sources = set()
        for chunk in cluster.representative_chunks:
            meta = chunk.metadata
            source_key = f"{meta.get('org_name', '')}_{meta.get('board_name', '')}"
            if source_key not in seen_sources:
                seen_sources.add(source_key)
                sources.append({
                    "orgName": meta.get("org_name", ""),
                    "boardName": meta.get("board_name", ""),
                    "dateFolder": meta.get("date_folder", ""),
                    "docTitle": meta.get("source_file", ""),
                })
        
        candidates.append(IssueCandidate(
            cluster_id=cluster.cluster_id,
            title=title,
            summary=summary,
            keywords=cluster.keywords,
            representative_chunk_ids=[c.id for c in cluster.representative_chunks],
            cluster_size=cluster.size,
            sources=sources[:5],
            score={
                "total": 0.5,  # LLM 평가 전 기본값
                "legalMandatory": 0.0,
                "novelty": 0.0,
                "impact": 0.0,
                "international": 0.0,
            }
        ))
    
    return candidates


# ============================================================
# LLM 기반 이슈 요약 및 평가
# ============================================================

def build_summarization_prompt(cluster: ClusterResult) -> str:
    """
    클러스터 요약을 위한 프롬프트 생성
    """
    chunks_text = ""
    for i, chunk in enumerate(cluster.representative_chunks[:3], 1):
        meta = chunk.metadata
        source = f"[출처: {meta.get('org_name', '')} - {meta.get('board_name', '')}]"
        chunks_text += f"\n### 문서 {i} {source}\n{chunk.content[:500]}\n"
    
    prompt = f"""다음은 환경/에너지 정책 관련 문서 클러스터입니다.

## 관련 키워드
{', '.join(cluster.keywords[:10])}

## 대표 문서들
{chunks_text}

## 요청사항
위 문서들을 분석하여 다음 형식으로 응답해 주세요:

1. **이슈 제목**: 핵심을 담은 간결한 제목 (20자 이내)
2. **요약**: 2-3문장으로 핵심 내용 요약
3. **중요도 평가** (각 0.0~1.0 점수):
   - 법적 강제성: (법률/고시/규정 등 강제성 여부)
   - 신규성: (새로운 정책/규제인지)
   - 파급력: (산업/기업에 미치는 영향 범위)
   - 국제 동향: (국제 기준/협약 관련성)

JSON 형식으로 응답:
```json
{{
  "title": "이슈 제목",
  "summary": "요약 내용",
  "scores": {{
    "legalMandatory": 0.0,
    "novelty": 0.0,
    "impact": 0.0,
    "international": 0.0
  }}
}}
```"""
    
    return prompt


def parse_llm_response(response: str) -> Optional[Dict[str, Any]]:
    """
    LLM 응답에서 JSON 파싱
    """
    import re
    
    # JSON 블록 추출
    json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # JSON 블록 없이 직접 파싱 시도
    try:
        # { 로 시작하는 부분 찾기
        start = response.find('{')
        end = response.rfind('}') + 1
        if start >= 0 and end > start:
            return json.loads(response[start:end])
    except json.JSONDecodeError:
        pass
    
    return None


def calculate_total_score(scores: Dict[str, float], weights: Dict[str, float]) -> float:
    """
    가중치를 적용한 총점 계산
    """
    total = 0.0
    for key, weight in weights.items():
        total += scores.get(key, 0.0) * weight
    return min(1.0, max(0.0, total))


# ============================================================
# 전체 이슈 발굴 파이프라인
# ============================================================

async def discover_issues_pipeline(
    chunks: List[Dict[str, Any]],
    config: Dict[str, Any],
    llm_callback,  # async def callback(prompt: str) -> str
    progress_callback = None  # async def callback(step: str, progress: int)
) -> Dict[str, Any]:
    """
    이슈 발굴 전체 파이프라인
    
    Args:
        chunks: 청크 데이터 (id, content, embedding, metadata)
        config: 발굴 설정
        llm_callback: LLM 호출 콜백
        progress_callback: 진행 상황 콜백
    
    Returns:
        발굴 결과
    """
    # 청크 데이터 변환
    chunk_objects = [
        ChunkData(
            id=c["id"],
            content=c.get("content", ""),
            embedding=c["embedding"],
            metadata=c.get("metadata", {})
        )
        for c in chunks if c.get("embedding")
    ]
    
    if not chunk_objects:
        return {"success": False, "error": "임베딩된 청크가 없습니다."}
    
    # Step 1: 클러스터링
    if progress_callback:
        await progress_callback("클러스터링 수행 중...", 10)
    
    clusters, cluster_stats = cluster_embeddings(
        chunk_objects,
        n_clusters=config.get("numClusters", 15),
        min_cluster_size=config.get("minClusterSize", 3)
    )
    
    if not clusters:
        return {"success": False, "error": "유효한 클러스터가 생성되지 않았습니다."}
    
    # Step 2: 이슈 후보 생성
    if progress_callback:
        await progress_callback("이슈 후보 생성 중...", 30)
    
    num_issues = config.get("numIssues", 10)
    candidates = generate_issue_candidates(clusters, num_issues)
    
    # Step 3: LLM으로 요약 및 평가
    issues = []
    total_input_tokens = 0
    total_output_tokens = 0
    
    weights = config.get("scoreWeights", {
        "legalMandatory": 0.40,
        "novelty": 0.25,
        "impact": 0.20,
        "international": 0.15,
    })
    
    for i, candidate in enumerate(candidates):
        progress = 30 + int((i + 1) / len(candidates) * 60)
        if progress_callback:
            await progress_callback(f"이슈 {i+1}/{len(candidates)} 분석 중...", progress)
        
        # 프롬프트 생성
        cluster = next((c for c in clusters if c.cluster_id == candidate.cluster_id), None)
        if not cluster:
            continue
        
        prompt = build_summarization_prompt(cluster)
        
        # LLM 호출
        try:
            response = await llm_callback(prompt)
            parsed = parse_llm_response(response)
            
            if parsed:
                candidate.title = parsed.get("title", candidate.title)
                candidate.summary = parsed.get("summary", candidate.summary)
                
                scores = parsed.get("scores", {})
                candidate.score = {
                    "legalMandatory": scores.get("legalMandatory", 0.0),
                    "novelty": scores.get("novelty", 0.0),
                    "impact": scores.get("impact", 0.0),
                    "international": scores.get("international", 0.0),
                    "total": 0.0,
                }
                candidate.score["total"] = calculate_total_score(candidate.score, weights)
            
            # 토큰 사용량 추정 (실제로는 API 응답에서 가져와야 함)
            total_input_tokens += len(prompt) // 4
            total_output_tokens += len(response) // 4
            
        except Exception as e:
            print(f"[Discovery] LLM error for cluster {candidate.cluster_id}: {e}")
            # LLM 실패 시 기본값 유지
        
        issues.append({
            "clusterId": candidate.cluster_id,
            "title": candidate.title,
            "summary": candidate.summary,
            "keywords": candidate.keywords,
            "representativeChunkIds": candidate.representative_chunk_ids,
            "clusterSize": candidate.cluster_size,
            "sources": candidate.sources,
            "score": candidate.score,
            "status": "discovered",
        })
    
    # 점수순 정렬
    issues.sort(key=lambda x: x["score"]["total"], reverse=True)
    
    if progress_callback:
        await progress_callback("완료", 100)
    
    return {
        "success": True,
        "issues": issues,
        "stats": {
            **cluster_stats,
            "num_issues": len(issues),
        },
        "tokenUsage": {
            "input": total_input_tokens,
            "output": total_output_tokens,
        }
    }
