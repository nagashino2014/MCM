"""
ChromaDB 벡터 데이터베이스 관리 모듈

임베딩 벡터를 효율적으로 저장하고 검색하는 기능을 제공합니다.
ChromaDB가 설치되지 않은 경우 graceful하게 처리합니다.
"""

import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path

# ChromaDB 가용성 체크
CHROMADB_AVAILABLE = False
chromadb = None
Settings = None

try:
    import chromadb as _chromadb
    from chromadb.config import Settings as _Settings
    chromadb = _chromadb
    Settings = _Settings
    CHROMADB_AVAILABLE = True
    print("[ChromaDB] 모듈 로드 성공")
except ImportError:
    print("[ChromaDB] 모듈이 설치되지 않았습니다. Vector DB 기능이 비활성화됩니다.")
    print("[ChromaDB] 설치하려면: pip install chromadb (Visual C++ Build Tools 필요)")
    CHROMADB_AVAILABLE = False

# ============================================================================
# 설정
# ============================================================================

# ChromaDB 저장 경로
IS_DOCKER = os.environ.get("DOCKER_ENV") == "true"
if IS_DOCKER:
    # Docker 환경: 볼륨 마운트 경로 사용
    DATA_DIR = Path("/app/frontend_data")
else:
    # 로컬 환경: 상대 경로 사용
    DATA_DIR = Path(__file__).parent.parent.parent / "frontend" / "data"
CHROMA_DIR = DATA_DIR / "chromadb"

# 컬렉션 이름
COLLECTION_NAME = "document_embeddings"

# 사업장 프로파일 전용 컬렉션
PROFILE_COLLECTION_NAME = "site_profile_documents"

# 거리 측정 방식 (cosine: 코사인 유사도, l2: 유클리드 거리, ip: 내적)
# OpenAI 임베딩은 정규화된 벡터를 출력하므로 cosine 권장
DISTANCE_METRIC = "cosine"

# ============================================================================
# ChromaDB 클라이언트 초기화
# ============================================================================

_client = None
_collection = None
_profile_collection = None  # 사업장 프로파일 전용 컬렉션


def is_available() -> bool:
    """ChromaDB 사용 가능 여부"""
    return CHROMADB_AVAILABLE


def get_client():
    """ChromaDB 클라이언트 싱글톤"""
    global _client
    
    if not CHROMADB_AVAILABLE:
        return None
        
    if _client is None:
        # 디렉토리 생성
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        
        _client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True,
            )
        )
        print(f"[ChromaDB] 초기화 완료: {CHROMA_DIR}")
    return _client


def get_collection():
    """임베딩 컬렉션 싱글톤"""
    global _collection
    
    if not CHROMADB_AVAILABLE:
        return None
        
    if _collection is None:
        client = get_client()
        if client is None:
            return None
        
        # 기존 컬렉션 확인
        try:
            existing = client.get_collection(name=COLLECTION_NAME)
            current_metric = existing.metadata.get("hnsw:space", "unknown")
            print(f"[ChromaDB] 기존 컬렉션 발견: metric={current_metric}, count={existing.count()}")
            
            # 거리 측정 방식이 다르면 경고
            if current_metric != DISTANCE_METRIC:
                print(f"[ChromaDB] ⚠️ 경고: 거리 측정 방식 불일치!")
                print(f"[ChromaDB]   현재 컬렉션: {current_metric}")
                print(f"[ChromaDB]   설정값: {DISTANCE_METRIC}")
                print(f"[ChromaDB]   새 거리 방식을 적용하려면 컬렉션을 초기화해야 합니다.")
            
            _collection = existing
        except Exception:
            # 컬렉션이 없으면 새로 생성
            _collection = client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={
                    "description": "Document chunk embeddings for RAG",
                    "hnsw:space": DISTANCE_METRIC,
                }
            )
            print(f"[ChromaDB] 새 컬렉션 생성: metric={DISTANCE_METRIC}")
        
        print(f"[ChromaDB] 컬렉션 '{COLLECTION_NAME}' 준비 완료 (metric: {DISTANCE_METRIC}, 현재 {_collection.count()}개 벡터)")
    return _collection


# 별칭 (embedding_worker에서 사용)
get_vectordb = get_collection


def get_profile_collection():
    """사업장 프로파일 전용 컬렉션 싱글톤"""
    global _profile_collection
    
    if not CHROMADB_AVAILABLE:
        return None
        
    if _profile_collection is None:
        client = get_client()
        if client is None:
            return None
        
        # 기존 컬렉션 확인
        try:
            existing = client.get_collection(name=PROFILE_COLLECTION_NAME)
            current_metric = existing.metadata.get("hnsw:space", "unknown")
            print(f"[ChromaDB] 프로파일 컬렉션 발견: metric={current_metric}, count={existing.count()}")
            _profile_collection = existing
        except Exception:
            # 컬렉션이 없으면 새로 생성
            _profile_collection = client.get_or_create_collection(
                name=PROFILE_COLLECTION_NAME,
                metadata={
                    "description": "Site profile document embeddings for integrated environmental permit",
                    "hnsw:space": DISTANCE_METRIC,
                }
            )
            print(f"[ChromaDB] 프로파일 컬렉션 생성: metric={DISTANCE_METRIC}")
        
        print(f"[ChromaDB] 프로파일 컬렉션 '{PROFILE_COLLECTION_NAME}' 준비 완료 (현재 {_profile_collection.count()}개 벡터)")
    return _profile_collection


# ============================================================================
# 사업장 프로파일 벡터DB 함수
# ============================================================================

def add_profile_embeddings(
    ids: List[str],
    embeddings: List[List[float]],
    documents: List[str],
    metadatas: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    사업장 프로파일 임베딩 벡터 추가
    
    Args:
        ids: 청크 ID 목록
        embeddings: 임베딩 벡터 목록
        documents: 원본 텍스트 목록
        metadatas: 메타데이터 목록 (profile_id, industry_code 등)
    
    Returns:
        성공/실패 정보
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_profile_collection()
    if collection is None:
        return {"success": False, "error": "프로파일 컬렉션을 초기화할 수 없습니다."}
    
    try:
        # 메타데이터 기본값 설정
        if metadatas is None:
            metadatas = [{} for _ in ids]
        
        # 메타데이터 값 정제
        cleaned_metadatas = []
        for meta in metadatas:
            cleaned = {}
            for k, v in meta.items():
                if v is None:
                    cleaned[k] = ""
                elif isinstance(v, (str, int, float, bool)):
                    cleaned[k] = v
                elif isinstance(v, list):
                    cleaned[k] = ",".join(str(x) for x in v)  # 리스트는 문자열로 변환
                else:
                    cleaned[k] = str(v)
            cleaned_metadatas.append(cleaned)
        
        # 기존 ID 확인
        existing_ids = set()
        try:
            result = collection.get(ids=ids)
            existing_ids = set(result["ids"])
        except Exception:
            pass
        
        new_ids = [i for i in ids if i not in existing_ids]
        update_ids = [i for i in ids if i in existing_ids]
        
        # 새 항목 추가
        if new_ids:
            new_indices = [ids.index(i) for i in new_ids]
            collection.add(
                ids=new_ids,
                embeddings=[embeddings[i] for i in new_indices],
                documents=[documents[i] for i in new_indices],
                metadatas=[cleaned_metadatas[i] for i in new_indices]
            )
        
        # 기존 항목 업데이트
        if update_ids:
            update_indices = [ids.index(i) for i in update_ids]
            collection.update(
                ids=update_ids,
                embeddings=[embeddings[i] for i in update_indices],
                documents=[documents[i] for i in update_indices],
                metadatas=[cleaned_metadatas[i] for i in update_indices]
            )
        
        return {
            "success": True,
            "added": len(new_ids),
            "updated": len(update_ids),
            "total": collection.count()
        }
        
    except Exception as e:
        print(f"[ChromaDB] 프로파일 임베딩 추가 오류: {e}")
        return {"success": False, "error": str(e)}


def search_profile_similar(
    query_embedding: List[float],
    n_results: int = 10,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    사업장 프로파일 유사도 검색
    
    Args:
        query_embedding: 쿼리 임베딩 벡터
        n_results: 반환할 결과 수
        where: 메타데이터 필터 (예: {"profile_id": "xxx"})
        where_document: 문서 내용 필터
    
    Returns:
        유사한 청크 목록
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "results": [], "count": 0}
    
    collection = get_profile_collection()
    if collection is None:
        return {"success": False, "error": "프로파일 컬렉션 초기화 실패", "results": [], "count": 0}
    
    try:
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where,
            where_document=where_document,
            include=["embeddings", "documents", "metadatas", "distances"]
        )
        
        items = []
        if result["ids"] and result["ids"][0]:
            for i, chunk_id in enumerate(result["ids"][0]):
                distance = result["distances"][0][i] if result["distances"] else None
                similarity = (1 - distance) if distance is not None else None
                
                items.append({
                    "chunk_id": chunk_id,
                    "document": result["documents"][0][i] if result["documents"] else None,
                    "metadata": result["metadatas"][0][i] if result["metadatas"] else None,
                    "distance": distance,
                    "similarity": similarity
                })
        
        return {"success": True, "results": items, "count": len(items)}
        
    except Exception as e:
        print(f"[ChromaDB] 프로파일 검색 오류: {e}")
        return {"success": False, "error": str(e), "results": [], "count": 0}


def delete_profile_embeddings(
    ids: Optional[List[str]] = None,
    where: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    사업장 프로파일 임베딩 삭제
    
    Args:
        ids: 삭제할 청크 ID 목록
        where: 메타데이터 필터로 삭제 (예: {"profile_id": "xxx"})
    
    Returns:
        삭제 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_profile_collection()
    if collection is None:
        return {"success": False, "error": "프로파일 컬렉션 초기화 실패"}
    
    try:
        before_count = collection.count()
        
        if ids:
            collection.delete(ids=ids)
        elif where:
            collection.delete(where=where)
        else:
            return {"success": False, "error": "ids 또는 where 조건이 필요합니다."}
        
        after_count = collection.count()
        
        return {
            "success": True,
            "deleted": before_count - after_count,
            "remaining": after_count
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_profile_embeddings_by_profile(profile_id: str) -> Dict[str, Any]:
    """
    특정 프로파일의 모든 임베딩 조회
    
    Args:
        profile_id: 사업장 프로파일 ID
    
    Returns:
        해당 프로파일의 모든 청크
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "chunks": []}
    
    collection = get_profile_collection()
    if collection is None:
        return {"success": False, "error": "프로파일 컬렉션 초기화 실패", "chunks": []}
    
    try:
        result = collection.get(
            where={"profile_id": profile_id},
            include=["documents", "metadatas"]
        )
        
        chunks = []
        if result["ids"]:
            for i, chunk_id in enumerate(result["ids"]):
                chunks.append({
                    "chunk_id": chunk_id,
                    "document": result["documents"][i] if result["documents"] else "",
                    "metadata": result["metadatas"][i] if result["metadatas"] else {}
                })
        
        return {"success": True, "chunks": chunks, "count": len(chunks), "profile_id": profile_id}
        
    except Exception as e:
        return {"success": False, "error": str(e), "chunks": []}


def get_profile_collection_stats() -> Dict[str, Any]:
    """
    사업장 프로파일 컬렉션 통계 조회
    
    Returns:
        통계 정보 (총 문서 수, 프로파일별 분포, 업종별 분포 등)
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다.",
            "total_embeddings": 0
        }
    
    collection = get_profile_collection()
    if collection is None:
        return {"success": False, "error": "프로파일 컬렉션 초기화 실패", "total_embeddings": 0}
    
    try:
        count = collection.count()
        
        # 샘플 메타데이터로 통계 추정
        sample = collection.peek(limit=min(count, 1000)) if count > 0 else {"metadatas": []}
        
        profile_counts = {}
        industry_counts = {}
        
        if sample.get("metadatas"):
            for meta in sample["metadatas"]:
                if meta:
                    profile = meta.get("profile_name", "unknown")
                    industry = meta.get("industry_code", "unknown")
                    profile_counts[profile] = profile_counts.get(profile, 0) + 1
                    industry_counts[industry] = industry_counts.get(industry, 0) + 1
        
        return {
            "success": True,
            "total_embeddings": count,
            "collection_name": PROFILE_COLLECTION_NAME,
            "profile_distribution": profile_counts,
            "industry_distribution": industry_counts
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "total_embeddings": 0}


def clear_profile_collection() -> Dict[str, Any]:
    """
    프로파일 컬렉션 전체 초기화
    
    Returns:
        초기화 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    global _profile_collection
    client = get_client()
    if client is None:
        return {"success": False, "error": "ChromaDB 클라이언트 초기화 실패"}
    
    try:
        collection = get_profile_collection()
        before_count = collection.count() if collection else 0
        
        client.delete_collection(name=PROFILE_COLLECTION_NAME)
        _profile_collection = None
        
        # 새 컬렉션 생성
        get_profile_collection()
        
        return {
            "success": True,
            "deleted": before_count,
            "message": f"프로파일 컬렉션 '{PROFILE_COLLECTION_NAME}'이 초기화되었습니다."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# 메타데이터 처리 헬퍼 함수
# ============================================================================

def _prepare_chunk_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    청크 메타데이터를 ChromaDB 호환 형식으로 변환
    
    ChromaDB는 str, int, float, bool만 지원하므로:
    - None → ""
    - list → JSON 문자열
    - dict → JSON 문자열
    - 기타 → str()
    
    Cross-page 병합 메타데이터도 처리:
    - is_merged_table: bool
    - merge_source_pages: list → JSON 문자열
    - merge_source_count: int
    - merge_confidence: float
    - original_table_indices: list → JSON 문자열
    - header_signature: str
    
    Args:
        metadata: 원본 메타데이터
        
    Returns:
        ChromaDB 호환 메타데이터
    """
    if not metadata:
        return {}
    
    cleaned = {}
    
    for k, v in metadata.items():
        if v is None:
            cleaned[k] = ""
        elif isinstance(v, (str, int, float, bool)):
            cleaned[k] = v
        elif isinstance(v, list):
            # 리스트는 JSON 문자열로 변환
            cleaned[k] = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, dict):
            # 딕셔너리도 JSON 문자열로 변환
            cleaned[k] = json.dumps(v, ensure_ascii=False)
        else:
            cleaned[k] = str(v)
    
    # Cross-page 병합 메타데이터 명시적 처리
    # (이미 위에서 처리되지만, 타입 안전성을 위해 추가 검증)
    if metadata.get("is_merged_table"):
        cleaned["is_merged_table"] = True
        
        # page_span이 문자열이면 유지, 리스트면 JSON으로 변환
        if "page_span" in metadata:
            page_span = metadata["page_span"]
            if isinstance(page_span, list):
                cleaned["merge_source_pages"] = json.dumps(page_span, ensure_ascii=False)
            else:
                cleaned["merge_source_pages"] = str(page_span)
        
        # merge_source_count
        if "merge_source_count" not in cleaned and "page_span" in metadata:
            page_span = metadata["page_span"]
            if isinstance(page_span, list):
                cleaned["merge_source_count"] = len(page_span)
        
        # original_table_indices
        if "original_table_indices" in metadata:
            indices = metadata["original_table_indices"]
            if isinstance(indices, list):
                cleaned["original_table_indices"] = json.dumps(indices, ensure_ascii=False)
            else:
                cleaned["original_table_indices"] = str(indices)
    
    return cleaned


# ============================================================================
# 임베딩 저장/조회/검색
# ============================================================================

def add_embeddings(
    ids: List[str],
    embeddings: List[List[float]],
    documents: List[str],
    metadatas: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    임베딩 벡터 추가
    
    Args:
        ids: 청크 ID 목록
        embeddings: 임베딩 벡터 목록
        documents: 원본 텍스트 목록
        metadatas: 메타데이터 목록 (선택)
    
    Returns:
        성공/실패 정보
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다."
        }
    
    collection = get_collection()
    if collection is None:
        return {
            "success": False,
            "error": "ChromaDB 컬렉션을 초기화할 수 없습니다."
        }
    
    try:
        # 메타데이터 기본값 설정
        if metadatas is None:
            metadatas = [{} for _ in ids]
        
        # 메타데이터 값 정제 (ChromaDB는 str, int, float, bool만 지원)
        cleaned_metadatas = []
        for meta in metadatas:
            cleaned = _prepare_chunk_metadata(meta)
            cleaned_metadatas.append(cleaned)
        
        # 기존 ID가 있으면 업데이트, 없으면 추가
        existing_ids = set()
        try:
            result = collection.get(ids=ids)
            existing_ids = set(result["ids"])
        except Exception:
            pass
        
        new_ids = [i for i in ids if i not in existing_ids]
        update_ids = [i for i in ids if i in existing_ids]
        
        # 새 항목 추가
        if new_ids:
            new_indices = [ids.index(i) for i in new_ids]
            collection.add(
                ids=new_ids,
                embeddings=[embeddings[i] for i in new_indices],
                documents=[documents[i] for i in new_indices],
                metadatas=[cleaned_metadatas[i] for i in new_indices]
            )
        
        # 기존 항목 업데이트
        if update_ids:
            update_indices = [ids.index(i) for i in update_ids]
            collection.update(
                ids=update_ids,
                embeddings=[embeddings[i] for i in update_indices],
                documents=[documents[i] for i in update_indices],
                metadatas=[cleaned_metadatas[i] for i in update_indices]
            )
        
        return {
            "success": True,
            "added": len(new_ids),
            "updated": len(update_ids),
            "total": collection.count()
        }
        
    except Exception as e:
        print(f"[ChromaDB] 임베딩 추가 오류: {e}")
        return {
            "success": False,
            "error": str(e)
        }


def get_embeddings(ids: List[str]) -> Dict[str, Any]:
    """
    ID로 임베딩 조회
    
    Args:
        ids: 조회할 청크 ID 목록
    
    Returns:
        임베딩 정보
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        result = collection.get(
            ids=ids,
            include=["embeddings", "documents", "metadatas"]
        )
        
        return {
            "success": True,
            "ids": result["ids"],
            "embeddings": result["embeddings"],
            "documents": result["documents"],
            "metadatas": result["metadatas"]
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def search_similar(
    query_embedding: List[float],
    n_results: int = 10,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    유사도 검색
    
    Args:
        query_embedding: 쿼리 임베딩 벡터
        n_results: 반환할 결과 수
        where: 메타데이터 필터 (예: {"org_name": "산업통상자원부"})
        where_document: 문서 내용 필터
    
    Returns:
        유사한 청크 목록
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "results": [], "count": 0}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패", "results": [], "count": 0}
    
    try:
        # 컬렉션 정보 로깅
        coll_count = collection.count()
        coll_metadata = collection.metadata
        print(f"[ChromaDB] Search: collection has {coll_count} items, metadata={coll_metadata}")
        
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where,
            where_document=where_document,
            include=["embeddings", "documents", "metadatas", "distances"]
        )
        
        # 원시 결과 로깅
        print(f"[ChromaDB] Raw query result: ids count={len(result['ids'][0]) if result['ids'] and result['ids'][0] else 0}")
        if result["distances"] and result["distances"][0]:
            distances = result["distances"][0][:5]
            print(f"[ChromaDB] First 5 distances: {distances}")
        
        # 결과 정리
        items = []
        if result["ids"] and result["ids"][0]:
            for i, chunk_id in enumerate(result["ids"][0]):
                distance = result["distances"][0][i] if result["distances"] else None
                # 코사인 거리: distance = 1 - cosine_similarity, 범위 [0, 2]
                # 유사도로 변환: similarity = 1 - distance = cosine_similarity
                similarity = (1 - distance) if distance is not None else None
                
                items.append({
                    "chunk_id": chunk_id,
                    "document": result["documents"][0][i] if result["documents"] else None,
                    "metadata": result["metadatas"][0][i] if result["metadatas"] else None,
                    "distance": distance,
                    "similarity": similarity
                })
        
        print(f"[ChromaDB] Returning {len(items)} results")
        
        return {
            "success": True,
            "results": items,
            "count": len(items)
        }
        
    except Exception as e:
        print(f"[ChromaDB] Search error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


def delete_embeddings(ids: List[str]) -> Dict[str, Any]:
    """
    임베딩 삭제
    
    Args:
        ids: 삭제할 청크 ID 목록
    
    Returns:
        삭제 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        collection.delete(ids=ids)
        return {
            "success": True,
            "deleted": len(ids),
            "total": collection.count()
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def get_stats() -> Dict[str, Any]:
    """
    ChromaDB 통계 조회
    
    Returns:
        통계 정보
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다.",
            "total_embeddings": 0,
            "collection_name": COLLECTION_NAME,
            "storage_path": str(CHROMA_DIR),
            "chromadb_available": False
        }
    
    collection = get_collection()
    if collection is None:
        return {
            "success": False,
            "error": "ChromaDB 컬렉션 초기화 실패",
            "total_embeddings": 0,
            "chromadb_available": False
        }
    
    try:
        count = collection.count()
        
        # 샘플 메타데이터로 기관별 통계 추정
        sample = collection.peek(limit=min(count, 1000))
        
        org_counts = {}
        model_counts = {}
        
        if sample["metadatas"]:
            for meta in sample["metadatas"]:
                if meta:
                    org = meta.get("org_name", "unknown")
                    model = meta.get("model", "unknown")
                    org_counts[org] = org_counts.get(org, 0) + 1
                    model_counts[model] = model_counts.get(model, 0) + 1
        
        return {
            "success": True,
            "total_embeddings": count,
            "collection_name": COLLECTION_NAME,
            "storage_path": str(CHROMA_DIR),
            "org_distribution": org_counts,
            "model_distribution": model_counts,
            "chromadb_available": True
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "chromadb_available": True
        }


def check_exists(ids: List[str]) -> Dict[str, bool]:
    """
    ID 존재 여부 확인
    
    Args:
        ids: 확인할 ID 목록
    
    Returns:
        ID별 존재 여부
    """
    if not CHROMADB_AVAILABLE:
        return {id: False for id in ids}
    
    collection = get_collection()
    if collection is None:
        return {id: False for id in ids}
    
    try:
        result = collection.get(ids=ids)
        existing = set(result["ids"])
        return {id: id in existing for id in ids}
    except Exception:
        return {id: False for id in ids}


# ============================================================================
# 인덱스 관리 기능
# ============================================================================

def delete_by_filter(where: Dict[str, Any]) -> Dict[str, Any]:
    """
    메타데이터 조건으로 임베딩 삭제
    
    Args:
        where: 메타데이터 필터 (예: {"org_name": "산업통상자원부"})
    
    Returns:
        삭제 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패"}
    
    try:
        # 삭제 전 개수 확인
        before_count = collection.count()
        
        # 조건에 맞는 항목 삭제
        collection.delete(where=where)
        
        # 삭제 후 개수 확인
        after_count = collection.count()
        deleted = before_count - after_count
        
        return {
            "success": True,
            "deleted": deleted,
            "remaining": after_count
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def clear_collection() -> Dict[str, Any]:
    """
    컬렉션의 모든 데이터 삭제 (초기화)
    
    Returns:
        초기화 결과
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다."}
    
    global _collection
    client = get_client()
    if client is None:
        return {"success": False, "error": "ChromaDB 클라이언트 초기화 실패"}
    
    try:
        # 삭제 전 개수 확인
        collection = get_collection()
        before_count = collection.count() if collection else 0
        
        # 컬렉션 삭제 후 재생성
        client.delete_collection(name=COLLECTION_NAME)
        _collection = None
        
        # 새 컬렉션 생성
        new_collection = get_collection()
        
        # 임베딩 통계 파일 초기화
        try:
            stats_file = DATA_DIR / "embedding-stats.json"
            if stats_file.exists():
                stats_file.unlink()
                print(f"[ChromaDB] embedding-stats.json 초기화 완료")
        except Exception as stats_error:
            print(f"[ChromaDB] embedding-stats.json 초기화 실패: {stats_error}")
        
        return {
            "success": True,
            "deleted": before_count,
            "message": f"컬렉션 '{COLLECTION_NAME}'이 초기화되었습니다."
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def get_collection_info() -> Dict[str, Any]:
    """
    컬렉션 상세 정보 조회
    
    Returns:
        컬렉션 정보 (이름, 벡터 수, 차원 등)
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다.",
            "collections": []
        }
    
    client = get_client()
    if client is None:
        return {"success": False, "error": "ChromaDB 클라이언트 초기화 실패", "collections": []}
    
    try:
        collections = []
        
        # 현재 컬렉션 정보
        collection = get_collection()
        if collection:
            count = collection.count()
            
            # 샘플 데이터로 차원 확인
            dimension = 0
            if count > 0:
                sample = collection.peek(limit=1)
                if sample["embeddings"] and len(sample["embeddings"]) > 0:
                    dimension = len(sample["embeddings"][0])
            
            collections.append({
                "name": COLLECTION_NAME,
                "count": count,
                "dimension": dimension,
                "storage_path": str(CHROMA_DIR),
                "distance_metric": DISTANCE_METRIC,  # 거리 측정 방식
            })
        
        return {
            "success": True,
            "collections": collections
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "collections": []
        }


# ============================================================================
# 표 재조합 기능
# ============================================================================

def get_table_chunks(table_id: str) -> Dict[str, Any]:
    """
    table_id로 관련 테이블 청크 모두 조회 (표 재조합용)
    
    Args:
        table_id: 테이블 ID
    
    Returns:
        테이블 청크 목록 (chunk_index 순서대로 정렬)
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB가 설치되지 않았습니다.", "chunks": []}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "ChromaDB 컬렉션 초기화 실패", "chunks": []}
    
    try:
        # table_id로 검색
        result = collection.get(
            where={"table_id": table_id},
            include=["documents", "metadatas"]
        )
        
        if not result["ids"]:
            return {"success": True, "chunks": [], "count": 0}
        
        # 청크 정리 및 정렬
        chunks = []
        for i, chunk_id in enumerate(result["ids"]):
            chunks.append({
                "chunk_id": chunk_id,
                "document": result["documents"][i] if result["documents"] else "",
                "metadata": result["metadatas"][i] if result["metadatas"] else {},
                "chunk_index": result["metadatas"][i].get("chunk_index", 0) if result["metadatas"] else 0
            })
        
        # chunk_index로 정렬
        chunks.sort(key=lambda x: x["chunk_index"])
        
        return {
            "success": True,
            "chunks": chunks,
            "count": len(chunks),
            "table_id": table_id
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "chunks": []
        }


def reconstruct_table(table_id: str) -> Dict[str, Any]:
    """
    분할된 테이블 청크를 병합하여 전체 테이블 재조합
    
    Args:
        table_id: 테이블 ID
    
    Returns:
        재조합된 테이블 마크다운
    """
    result = get_table_chunks(table_id)
    
    if not result["success"]:
        return result
    
    chunks = result["chunks"]
    
    if not chunks:
        return {
            "success": True,
            "table_id": table_id,
            "content": "",
            "total_chunks": 0
        }
    
    # 마크다운 테이블 병합
    merged_content = []
    table_title = None
    headers = None
    
    for chunk in chunks:
        metadata = chunk.get("metadata", {})
        document = chunk.get("document", "")
        
        # 첫 번째 청크에서 제목과 헤더 정보 추출
        if chunk.get("chunk_index", 0) == 0 or metadata.get("is_first_chunk"):
            table_title = metadata.get("table_title", "")
            headers = metadata.get("headers", [])
        
        merged_content.append(document)
    
    return {
        "success": True,
        "table_id": table_id,
        "table_title": table_title,
        "headers": headers,
        "content": "\n".join(merged_content),
        "total_chunks": len(chunks)
    }


# ============================================================================
# 마이그레이션 유틸리티
# ============================================================================

def migrate_from_json(json_path: str) -> Dict[str, Any]:
    """
    기존 JSON 파일에서 ChromaDB로 마이그레이션
    
    Args:
        json_path: embedding-data.json 파일 경로
    
    Returns:
        마이그레이션 결과
    """
    if not CHROMADB_AVAILABLE:
        return {
            "success": False,
            "error": "ChromaDB가 설치되지 않았습니다. Visual C++ Build Tools를 설치한 후 'pip install chromadb'를 실행해주세요."
        }
    
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        embeddings_data = data.get("embeddings", {})
        
        if not embeddings_data:
            return {
                "success": True,
                "migrated": 0,
                "message": "마이그레이션할 데이터가 없습니다."
            }
        
        # 배치 단위로 처리
        batch_size = 100
        items = list(embeddings_data.items())
        total_migrated = 0
        
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            
            ids = []
            embeddings = []
            documents = []
            metadatas = []
            
            for chunk_id, embed_data in batch:
                ids.append(chunk_id)
                embeddings.append(embed_data.get("embedding", []))
                documents.append("")  # 원본 텍스트는 청킹 데이터에서 가져와야 함
                metadatas.append({
                    "model": embed_data.get("model", ""),
                    "tokens_used": embed_data.get("tokens_used", 0),
                    "created_at": embed_data.get("created_at", "")
                })
            
            result = add_embeddings(ids, embeddings, documents, metadatas)
            if result["success"]:
                total_migrated += result.get("added", 0) + result.get("updated", 0)
            
            print(f"[마이그레이션] {min(i + batch_size, len(items))}/{len(items)} 처리 완료")
        
        return {
            "success": True,
            "migrated": total_migrated,
            "total_in_db": get_collection().count()
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================================
# 확장 메타데이터 지원 (Phase 2-B)
# ============================================================================

# 지원되는 메타데이터 필드
EXTENDED_METADATA_SCHEMA = {
    "doc_type": {
        "description": "문서 유형",
        "values": ["notice", "press_release", "legislation", "meeting", "report", "guideline", "other"],
    },
    "sectors": {
        "description": "분야 (다중 선택)",
        "values": ["air", "water", "waste", "climate", "energy", "chemical", "general"],
    },
    "source_depth": {
        "description": "출처 수준",
        "values": ["headquarters", "agency", "local"],
    },
    "regulation_phase": {
        "description": "규제 단계",
        "values": ["proposal", "enacted", "enforced", "audit"],
    },
}


def build_extended_filter(
    doc_types: Optional[List[str]] = None,
    sectors: Optional[List[str]] = None,
    source_depths: Optional[List[str]] = None,
    regulation_phases: Optional[List[str]] = None,
    filter_logic: str = "and"  # "and" or "or"
) -> Optional[Dict[str, Any]]:
    """
    확장 메타데이터 필터 조건 생성
    
    Args:
        doc_types: 문서 유형 필터
        sectors: 분야 필터
        source_depths: 출처 수준 필터
        regulation_phases: 규제 단계 필터
        filter_logic: 필터 조합 방식 ("and" 또는 "or")
    
    Returns:
        ChromaDB where 절
    """
    conditions = []
    
    if doc_types and len(doc_types) > 0:
        if len(doc_types) == 1:
            conditions.append({"doc_type": doc_types[0]})
        else:
            conditions.append({"doc_type": {"$in": doc_types}})
    
    if source_depths and len(source_depths) > 0:
        if len(source_depths) == 1:
            conditions.append({"source_depth": source_depths[0]})
        else:
            conditions.append({"source_depth": {"$in": source_depths}})
    
    if regulation_phases and len(regulation_phases) > 0:
        if len(regulation_phases) == 1:
            conditions.append({"regulation_phase": regulation_phases[0]})
        else:
            conditions.append({"regulation_phase": {"$in": regulation_phases}})
    
    # sectors는 개별 필드로 저장됨 (sector_air, sector_water 등)
    if sectors and len(sectors) > 0:
        sector_conditions = []
        for sector in sectors:
            sector_conditions.append({f"sector_{sector}": True})
        if len(sector_conditions) == 1:
            conditions.extend(sector_conditions)
        else:
            # 분야는 OR 조합
            conditions.append({"$or": sector_conditions})
    
    if not conditions:
        return None
    
    if len(conditions) == 1:
        return conditions[0]
    
    if filter_logic == "or":
        return {"$or": conditions}
    else:
        return {"$and": conditions}


def get_metadata_statistics() -> Dict[str, Any]:
    """
    확장 메타데이터 통계 조회
    
    Returns:
        각 메타데이터 필드별 값 분포
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB not available"}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "Collection not available"}
    
    try:
        count = collection.count()
        if count == 0:
            return {
                "success": True,
                "total": 0,
                "doc_types": {},
                "source_depths": {},
                "sectors": {},
            }
        
        # 샘플링 (최대 5000개)
        sample = collection.peek(limit=min(count, 5000))
        metadatas = sample.get("metadatas", [])
        
        # 통계 계산
        from collections import Counter
        
        doc_types = Counter(m.get("doc_type") for m in metadatas if m.get("doc_type"))
        source_depths = Counter(m.get("source_depth") for m in metadatas if m.get("source_depth"))
        
        # sector 필드들 집계
        sectors = Counter()
        for m in metadatas:
            for key in m:
                if key.startswith("sector_") and m[key]:
                    sector = key.replace("sector_", "")
                    sectors[sector] += 1
        
        return {
            "success": True,
            "total": count,
            "sampled": len(metadatas),
            "doc_types": dict(doc_types),
            "source_depths": dict(source_depths),
            "sectors": dict(sectors),
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def update_chunk_metadata(
    chunk_id: str,
    metadata_updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    청크 메타데이터 업데이트
    """
    if not CHROMADB_AVAILABLE:
        return {"success": False, "error": "ChromaDB not available"}
    
    collection = get_collection()
    if collection is None:
        return {"success": False, "error": "Collection not available"}
    
    try:
        result = collection.get(ids=[chunk_id], include=["metadatas"])
        if not result.get("ids"):
            return {"success": False, "error": "Chunk not found"}
        
        current_metadata = result["metadatas"][0] if result.get("metadatas") else {}
        updated_metadata = {**current_metadata, **metadata_updates}
        
        # sectors를 개별 필드로 변환
        if "sectors" in metadata_updates:
            sectors = metadata_updates["sectors"]
            for sector in EXTENDED_METADATA_SCHEMA["sectors"]["values"]:
                updated_metadata[f"sector_{sector}"] = sector in sectors
        
        collection.update(ids=[chunk_id], metadatas=[updated_metadata])
        return {"success": True, "chunk_id": chunk_id}
        
    except Exception as e:
        return {"success": False, "error": str(e)}
