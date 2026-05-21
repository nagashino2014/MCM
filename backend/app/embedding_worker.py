"""
임베딩 백그라운드 Worker

Threading을 사용하여 백그라운드에서 임베딩 작업을 처리합니다.
Docker 환경에서 안정적으로 동작합니다.
"""

import os
import json
import time
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

from .job_store import (
    Job, JobType, JobStatus, JobResult, JobProgress,
    load_job, start_job, update_job_progress, complete_job, fail_job,
    is_cancelled, clear_cancellation, request_cancellation
)
from .vectordb import get_vectordb


# ============================================================
# 설정
# ============================================================

# 배치 크기
HUGGINGFACE_BATCH_SIZE = 32
OPENAI_BATCH_SIZE = 100

# 데이터 디렉토리
def get_frontend_dir() -> Path:
    """프론트엔드 디렉토리 경로"""
    return Path(__file__).parent.parent.parent / "frontend"


def load_env_file() -> Dict[str, str]:
    """frontend/.env.local 파일에서 환경 변수 로드"""
    env_vars = {}
    env_file = get_frontend_dir() / ".env.local"
    
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        env_vars[key.strip()] = value.strip()
        except Exception as e:
            print(f"[EmbeddingWorker] Failed to load .env.local: {e}")
    
    return env_vars


def get_openai_api_key() -> Optional[str]:
    """OpenAI API 키 조회 (환경 변수 또는 .env.local)"""
    # 1. 환경 변수에서 먼저 확인
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        return api_key
    
    # 2. frontend/.env.local에서 확인
    env_vars = load_env_file()
    return env_vars.get("OPENAI_API_KEY")


def get_data_dir() -> Path:
    """데이터 디렉토리 경로"""
    # frontend/data
    frontend_data = get_frontend_dir() / "data"
    if frontend_data.exists():
        return frontend_data
    
    # Docker 환경
    return Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))


def get_chunk_data_dir() -> Path:
    """청크 데이터 디렉토리 경로 (분산 저장)"""
    # frontend/chunk
    frontend_chunk = get_frontend_dir() / "chunk"
    if frontend_chunk.exists():
        return frontend_chunk
    
    # Docker 환경
    data_dir = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
    chunk_dir = data_dir / "chunk"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    return chunk_dir


def get_chunking_index_path() -> Path:
    """청킹 인덱스 파일 경로"""
    return get_data_dir() / "chunking-index.json"


def get_embeddings_dir() -> Path:
    """임베딩 디렉토리 경로"""
    data_dir = get_data_dir()
    embeddings_dir = data_dir / "embeddings"
    embeddings_dir.mkdir(parents=True, exist_ok=True)
    return embeddings_dir


# ============================================================
# 청크 로드
# ============================================================

def load_chunking_index() -> Dict[str, Any]:
    """청킹 인덱스 로드"""
    index_path = get_chunking_index_path()
    
    print(f"[EmbeddingWorker] Looking for chunking index at: {index_path}")
    print(f"[EmbeddingWorker] Index exists: {index_path.exists()}")
    
    if not index_path.exists():
        print(f"[EmbeddingWorker] Chunking index not found!")
        return {"documents": [], "settings": {}}
    
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"[EmbeddingWorker] Loaded {len(data.get('documents', []))} documents from index")
        return data
    except Exception as e:
        print(f"[EmbeddingWorker] Failed to load chunking index: {e}")
        return {"documents": [], "settings": {}}


def get_chunk_file_path(org_name: str, board_name: str, date_folder: str) -> Path:
    """청크 파일 경로 생성"""
    # 파일명에 사용할 수 없는 문자 치환 (Windows 호환)
    safe_org = org_name.replace("<", "_").replace(">", "_").replace(":", "_").replace('"', "_")
    safe_org = safe_org.replace("/", "_").replace("\\", "_").replace("|", "_").replace("?", "_").replace("*", "_")
    safe_board = board_name.replace("<", "_").replace(">", "_").replace(":", "_").replace('"', "_")
    safe_board = safe_board.replace("/", "_").replace("\\", "_").replace("|", "_").replace("?", "_").replace("*", "_")
    safe_date = date_folder.replace("<", "_").replace(">", "_").replace(":", "_").replace('"', "_")
    safe_date = safe_date.replace("/", "_").replace("\\", "_").replace("|", "_").replace("?", "_").replace("*", "_")
    
    chunk_dir = get_chunk_data_dir()
    return chunk_dir / org_name / board_name / date_folder / f"{safe_org}_{safe_board}_{safe_date}_chunks.json"


def load_chunk_file(org_name: str, board_name: str, date_folder: str) -> List[Dict[str, Any]]:
    """청크 파일 로드"""
    file_path = get_chunk_file_path(org_name, board_name, date_folder)
    
    if not file_path.exists():
        return []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        if isinstance(data, dict) and "chunks" in data:
            return data["chunks"]
        elif isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"[EmbeddingWorker] Failed to load chunk file {file_path}: {e}")
        return []


def load_all_chunks() -> List[Dict[str, Any]]:
    """모든 청크 로드 (인덱스 기반)"""
    all_chunks = []
    index = load_chunking_index()
    documents = index.get("documents", [])
    
    if not documents:
        print("[EmbeddingWorker] No documents in chunking index")
        return all_chunks
    
    # 문서별로 고유한 폴더 경로 수집
    folder_paths = set()
    for doc in documents:
        org_name = doc.get("org_name", "")
        board_name = doc.get("board_name", "")
        date_folder = doc.get("date_folder", "")
        if org_name and board_name and date_folder:
            folder_paths.add((org_name, board_name, date_folder))
    
    print(f"[EmbeddingWorker] Found {len(folder_paths)} chunk folders to load")
    print(f"[EmbeddingWorker] Chunk data dir: {get_chunk_data_dir()}")
    
    # 각 폴더의 청크 로드
    for org_name, board_name, date_folder in folder_paths:
        file_path = get_chunk_file_path(org_name, board_name, date_folder)
        print(f"[EmbeddingWorker] Loading: {file_path} (exists: {file_path.exists()})")
        chunks = load_chunk_file(org_name, board_name, date_folder)
        if chunks:
            print(f"[EmbeddingWorker] Loaded {len(chunks)} chunks from {org_name}/{board_name}/{date_folder}")
        all_chunks.extend(chunks)
    
    print(f"[EmbeddingWorker] Total chunks loaded: {len(all_chunks)}")
    return all_chunks


def load_chunks_by_ids(chunk_ids: List[str]) -> List[Dict[str, Any]]:
    """ID로 청크 로드"""
    all_chunks = load_all_chunks()
    chunk_map = {c.get("chunk_id"): c for c in all_chunks}
    return [chunk_map[cid] for cid in chunk_ids if cid in chunk_map]


def load_chunks_by_doc_ids(doc_ids: List[str]) -> List[Dict[str, Any]]:
    """문서 ID로 청크 로드"""
    all_chunks = load_all_chunks()
    # metadata.doc_id 또는 doc_id 체크
    result = []
    for c in all_chunks:
        doc_id = c.get("doc_id") or (c.get("metadata", {}).get("doc_id"))
        if doc_id in doc_ids:
            result.append(c)
    return result


# ============================================================
# 임베딩 존재 확인
# ============================================================

def get_existing_embedding_ids() -> set:
    """기존 임베딩 ID 목록"""
    embeddings_dir = get_embeddings_dir()
    existing_ids = set()
    
    try:
        for file_path in embeddings_dir.glob("*.json"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                if isinstance(data, dict) and "chunk_id" in data:
                    existing_ids.add(data["chunk_id"])
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "chunk_id" in item:
                            existing_ids.add(item["chunk_id"])
            except:
                pass
    except:
        pass
    
    # ChromaDB에서도 확인
    try:
        vectordb = get_vectordb()
        if vectordb:
            result = vectordb.get(include=[])
            if result and result.get("ids"):
                existing_ids.update(result["ids"])
    except:
        pass
    
    return existing_ids


# ============================================================
# HuggingFace 임베딩 생성
# ============================================================

# 모델 캐시
_embedding_models = {}
_model_lock = threading.Lock()


def get_huggingface_model(model_name: str):
    """HuggingFace 모델 로드 (캐시)"""
    with _model_lock:
        if model_name in _embedding_models:
            return _embedding_models[model_name]
        
        try:
            from sentence_transformers import SentenceTransformer
            
            model_map = {
                "ko-sroberta": "jhgan/ko-sroberta-multitask",
                "bge-m3": "BAAI/bge-m3",
            }
            
            model_id = model_map.get(model_name, model_name)
            print(f"[EmbeddingWorker] Loading model: {model_id}")
            
            model = SentenceTransformer(model_id)
            _embedding_models[model_name] = model
            
            print(f"[EmbeddingWorker] Model loaded: {model_id}")
            return model
        except Exception as e:
            print(f"[EmbeddingWorker] Failed to load model {model_name}: {e}")
            raise


def generate_huggingface_embeddings(
    chunks: List[Dict[str, Any]],
    model_name: str,
    job_id: str,
    on_progress: callable
) -> Dict[str, Any]:
    """HuggingFace 모델로 임베딩 생성"""
    results = []
    errors = []
    start_time = time.time()
    
    print(f"[EmbeddingWorker] Starting embedding generation for {len(chunks)} chunks")
    
    try:
        model = get_huggingface_model(model_name)
        total_batches = (len(chunks) + HUGGINGFACE_BATCH_SIZE - 1) // HUGGINGFACE_BATCH_SIZE
        print(f"[EmbeddingWorker] Total batches: {total_batches}")
        
        for i in range(0, len(chunks), HUGGINGFACE_BATCH_SIZE):
            # 취소 확인
            if is_cancelled(job_id):
                print(f"[EmbeddingWorker] Job cancelled at batch {i // HUGGINGFACE_BATCH_SIZE + 1}")
                return {
                    "success": False,
                    "results": results,
                    "errors": [{"chunk_id": "cancelled", "error": "작업이 취소되었습니다."}],
                    "processing_time_ms": int((time.time() - start_time) * 1000),
                }
            
            batch = chunks[i:i + HUGGINGFACE_BATCH_SIZE]
            texts = [c.get("content", "") for c in batch]
            batch_num = i // HUGGINGFACE_BATCH_SIZE + 1
            
            # 매 10번째 배치마다 로그 출력
            if batch_num % 10 == 1 or batch_num == total_batches:
                print(f"[EmbeddingWorker] Processing batch {batch_num}/{total_batches} ({len(results)} completed)")
            
            on_progress(i + len(batch), f"배치 {batch_num}/{total_batches} 처리 중...")
            
            try:
                embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
                
                for j, chunk in enumerate(batch):
                    results.append({
                        "chunk_id": chunk.get("chunk_id"),
                        "embedding": embeddings[j].tolist(),
                        "model": model_name,
                        "tokens_used": 0,
                        "created_at": datetime.now().isoformat(),
                    })
            except Exception as e:
                error_msg = str(e)
                print(f"[EmbeddingWorker] Batch {batch_num} error: {error_msg}")
                for chunk in batch:
                    errors.append({"chunk_id": chunk.get("chunk_id"), "error": error_msg})
        
        print(f"[EmbeddingWorker] Embedding generation complete: {len(results)} success, {len(errors)} errors")
        return {
            "success": len(errors) == 0,
            "results": results,
            "errors": errors,
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }
    
    except Exception as e:
        error_msg = str(e)
        print(f"[EmbeddingWorker] Fatal error: {error_msg}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "results": results,
            "errors": [{"chunk_id": c.get("chunk_id"), "error": error_msg} for c in chunks],
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }


# ============================================================
# OpenAI 임베딩 생성
# ============================================================

# Rate Limit 설정
OPENAI_MAX_RETRIES = 5  # 최대 재시도 횟수
OPENAI_INITIAL_DELAY = 1.0  # 초기 대기 시간 (초)
OPENAI_MAX_DELAY = 60.0  # 최대 대기 시간 (초)
OPENAI_BATCH_DELAY = 0.5  # 배치 간 기본 대기 시간 (초)


def generate_openai_embeddings(
    chunks: List[Dict[str, Any]],
    model_name: str,
    api_key: str,
    job_id: str,
    on_progress: callable
) -> Dict[str, Any]:
    """OpenAI API로 임베딩 생성 (Rate Limit 처리 포함)"""
    import httpx
    
    results = []
    errors = []
    total_tokens = 0
    start_time = time.time()
    retry_count = 0  # 전체 재시도 횟수 추적
    
    # 모델 ID 매핑
    model_map = {
        "openai-small": "text-embedding-3-small",
        "openai-large": "text-embedding-3-large",
        "openai-ada": "text-embedding-ada-002",
    }
    openai_model = model_map.get(model_name, "text-embedding-3-small")
    
    # 비용 계산 (1K 토큰당)
    cost_map = {
        "text-embedding-3-small": 0.00002,
        "text-embedding-3-large": 0.00013,
        "text-embedding-ada-002": 0.0001,
    }
    cost_per_1k = cost_map.get(openai_model, 0.00002)
    
    def call_openai_with_retry(client, texts: List[str], batch_info: str) -> tuple:
        """Rate Limit 처리와 함께 OpenAI API 호출"""
        nonlocal retry_count
        
        for attempt in range(OPENAI_MAX_RETRIES):
            try:
                response = client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "input": texts,
                        "model": openai_model,
                    }
                )
                
                if response.status_code == 200:
                    return response.json(), None
                
                # Rate Limit (429) 처리
                if response.status_code == 429:
                    retry_count += 1
                    delay = min(OPENAI_INITIAL_DELAY * (2 ** attempt), OPENAI_MAX_DELAY)
                    
                    # Retry-After 헤더가 있으면 사용
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            delay = float(retry_after)
                        except ValueError:
                            pass
                    
                    print(f"[EmbeddingWorker] Rate limit hit at {batch_info}, waiting {delay:.1f}s (attempt {attempt + 1}/{OPENAI_MAX_RETRIES})")
                    time.sleep(delay)
                    continue
                
                # 다른 에러
                error_msg = f"OpenAI API error: {response.status_code}"
                try:
                    error_data = response.json()
                    if "error" in error_data:
                        error_msg = f"OpenAI API error: {error_data['error'].get('message', response.status_code)}"
                except:
                    pass
                
                return None, error_msg
                
            except Exception as e:
                if attempt < OPENAI_MAX_RETRIES - 1:
                    delay = min(OPENAI_INITIAL_DELAY * (2 ** attempt), OPENAI_MAX_DELAY)
                    print(f"[EmbeddingWorker] Request error at {batch_info}: {e}, retrying in {delay:.1f}s")
                    time.sleep(delay)
                    continue
                return None, str(e)
        
        return None, f"Rate limit exceeded after {OPENAI_MAX_RETRIES} retries"
    
    try:
        with httpx.Client(timeout=120.0) as client:
            total_batches = (len(chunks) + OPENAI_BATCH_SIZE - 1) // OPENAI_BATCH_SIZE
            
            for i in range(0, len(chunks), OPENAI_BATCH_SIZE):
                # 취소 확인
                if is_cancelled(job_id):
                    return {
                        "success": False,
                        "results": results,
                        "errors": [{"chunk_id": "cancelled", "error": "작업이 취소되었습니다."}],
                        "total_tokens": total_tokens,
                        "estimated_cost": total_tokens * cost_per_1k / 1000,
                        "processing_time_ms": int((time.time() - start_time) * 1000),
                    }
                
                batch = chunks[i:i + OPENAI_BATCH_SIZE]
                texts = [c.get("content", "") for c in batch]
                batch_num = i // OPENAI_BATCH_SIZE + 1
                
                on_progress(i + len(batch), f"OpenAI 배치 {batch_num}/{total_batches} 처리 중...")
                
                # Rate Limit 처리와 함께 API 호출
                batch_info = f"batch {batch_num}/{total_batches}"
                data, error = call_openai_with_retry(client, texts, batch_info)
                
                if error:
                    print(f"[EmbeddingWorker] {batch_info} failed: {error}")
                    for chunk in batch:
                        errors.append({"chunk_id": chunk.get("chunk_id"), "error": error})
                else:
                    embeddings_data = data.get("data", [])
                    usage = data.get("usage", {})
                    total_tokens += usage.get("total_tokens", 0)
                    
                    for j, chunk in enumerate(batch):
                        if j < len(embeddings_data):
                            results.append({
                                "chunk_id": chunk.get("chunk_id"),
                                "embedding": embeddings_data[j]["embedding"],
                                "model": openai_model,
                                "tokens_used": usage.get("total_tokens", 0) // len(batch),
                                "created_at": datetime.now().isoformat(),
                            })
                        else:
                            errors.append({"chunk_id": chunk.get("chunk_id"), "error": "No embedding returned"})
                
                # 배치 간 지연 (Rate Limit 방지)
                if batch_num < total_batches:
                    time.sleep(OPENAI_BATCH_DELAY)
        
        print(f"[EmbeddingWorker] OpenAI embedding complete: {len(results)} success, {len(errors)} errors, {retry_count} retries")
        
        return {
            "success": len(errors) == 0,
            "results": results,
            "errors": errors,
            "total_tokens": total_tokens,
            "estimated_cost": total_tokens * cost_per_1k / 1000,
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }
    
    except Exception as e:
        error_msg = str(e)
        return {
            "success": False,
            "results": results,
            "errors": [{"chunk_id": c.get("chunk_id"), "error": error_msg} for c in chunks],
            "total_tokens": total_tokens,
            "estimated_cost": total_tokens * cost_per_1k / 1000,
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }


# ============================================================
# ChromaDB 저장
# ============================================================

def get_embedding_stats_path() -> Path:
    """임베딩 통계 파일 경로"""
    return get_data_dir() / "embedding-stats.json"


def update_embedding_stats(processed: int, failed: int, tokens: int, cost: float) -> None:
    """임베딩 통계 파일 업데이트"""
    stats_path = get_embedding_stats_path()
    
    # 기존 통계 로드
    stats = {
        "total_embeddings": 0,
        "total_failed": 0,
        "total_cost": 0,
        "total_tokens": 0,
        "last_updated": None
    }
    
    if stats_path.exists():
        try:
            with open(stats_path, "r", encoding="utf-8") as f:
                stats = json.load(f)
        except Exception as e:
            print(f"[EmbeddingWorker] Failed to load embedding stats: {e}")
    
    # 통계 업데이트
    stats["total_embeddings"] = stats.get("total_embeddings", 0) + processed
    stats["total_failed"] = stats.get("total_failed", 0) + failed
    stats["total_cost"] = stats.get("total_cost", 0) + cost
    stats["total_tokens"] = stats.get("total_tokens", 0) + tokens
    stats["last_updated"] = datetime.now().isoformat()
    
    # 저장
    try:
        stats_path.parent.mkdir(parents=True, exist_ok=True)
        with open(stats_path, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2, ensure_ascii=False)
        print(f"[EmbeddingWorker] Updated embedding stats: +{processed} processed, +{failed} failed")
    except Exception as e:
        print(f"[EmbeddingWorker] Failed to save embedding stats: {e}")


def save_to_chromadb(results: List[Dict[str, Any]], chunks: List[Dict[str, Any]]) -> int:
    """임베딩을 ChromaDB에 저장"""
    try:
        vectordb = get_vectordb()
        if not vectordb:
            print("[EmbeddingWorker] ChromaDB not available")
            return 0
        
        chunk_map = {c.get("chunk_id"): c for c in chunks}
        saved_count = 0
        
        # 디버그: 첫 번째 청크의 구조 확인
        if chunks:
            first_chunk = chunks[0]
            print(f"[EmbeddingWorker] DEBUG - First chunk keys: {list(first_chunk.keys())}")
            if "metadata" in first_chunk:
                print(f"[EmbeddingWorker] DEBUG - First chunk metadata keys: {list(first_chunk['metadata'].keys())}")
                print(f"[EmbeddingWorker] DEBUG - org_name: {first_chunk['metadata'].get('org_name', 'NOT_FOUND')}")
        
        # 배치로 저장
        batch_size = 1000
        for i in range(0, len(results), batch_size):
            batch = results[i:i + batch_size]
            
            ids = []
            embeddings = []
            documents = []
            metadatas = []
            
            for result in batch:
                chunk_id = result.get("chunk_id")
                chunk = chunk_map.get(chunk_id, {})
                
                # 청크 메타데이터 추출 (metadata 속성 또는 직접 접근)
                chunk_metadata = chunk.get("metadata", {})
                
                ids.append(chunk_id)
                embeddings.append(result.get("embedding"))
                documents.append(chunk.get("content", ""))
                
                # 전체 메타데이터 저장 (검색 필터 및 표 재조합에 필요)
                metadata = {
                    # 기본 메타데이터
                    "doc_id": chunk_metadata.get("doc_id") or chunk.get("doc_id", ""),
                    "org_name": chunk_metadata.get("org_name", ""),
                    "board_name": chunk_metadata.get("board_name", ""),
                    "date_folder": chunk_metadata.get("date_folder", ""),
                    "source_file": chunk_metadata.get("source_file", ""),
                    "chunk_type": chunk_metadata.get("chunk_type") or chunk.get("chunk_type", "text"),
                    "chunk_index": chunk_metadata.get("chunk_index") or chunk.get("chunk_index", 0),
                    "total_chunks": chunk_metadata.get("total_chunks", 0),
                    "token_count": chunk.get("token_count", 0),
                    "model": result.get("model", ""),
                    "created_at": result.get("created_at", ""),
                }
                
                # 표 관련 메타데이터 (있는 경우에만 추가)
                if chunk_metadata.get("table_id"):
                    metadata["table_id"] = chunk_metadata["table_id"]
                if chunk_metadata.get("table_title"):
                    metadata["table_title"] = chunk_metadata["table_title"]
                if chunk_metadata.get("total_rows") is not None:
                    metadata["total_rows"] = chunk_metadata["total_rows"]
                if chunk_metadata.get("total_cols") is not None:
                    metadata["total_cols"] = chunk_metadata["total_cols"]
                if chunk_metadata.get("headers"):
                    # ChromaDB는 리스트를 직접 저장할 수 없으므로 JSON 문자열로 변환
                    metadata["headers"] = json.dumps(chunk_metadata["headers"], ensure_ascii=False)
                if chunk_metadata.get("row_start") is not None:
                    metadata["row_start"] = chunk_metadata["row_start"]
                if chunk_metadata.get("row_end") is not None:
                    metadata["row_end"] = chunk_metadata["row_end"]
                if chunk_metadata.get("is_first_chunk") is not None:
                    metadata["is_first_chunk"] = chunk_metadata["is_first_chunk"]
                if chunk_metadata.get("is_last_chunk") is not None:
                    metadata["is_last_chunk"] = chunk_metadata["is_last_chunk"]
                
                metadatas.append(metadata)
            
            try:
                vectordb.upsert(
                    ids=ids,
                    embeddings=embeddings,
                    documents=documents,
                    metadatas=metadatas,
                )
                saved_count += len(batch)
            except Exception as e:
                print(f"[EmbeddingWorker] ChromaDB upsert error: {e}")
        
        print(f"[EmbeddingWorker] Saved {saved_count} embeddings to ChromaDB")
        return saved_count
    
    except Exception as e:
        print(f"[EmbeddingWorker] ChromaDB save error: {e}")
        return 0


# ============================================================
# 임베딩 작업 실행
# ============================================================

def run_embedding_job(job_id: str) -> None:
    """임베딩 작업 실행 (메인 함수)"""
    job = load_job(job_id)
    if not job:
        print(f"[EmbeddingWorker] Job not found: {job_id}")
        return
    
    params = job.params
    model = params.get("model", "ko-sroberta")
    api_key = params.get("api_key")
    chunk_ids = params.get("chunk_ids", [])
    doc_ids = params.get("doc_ids", [])
    skip_existing = params.get("skip_existing", True)
    
    print(f"[EmbeddingWorker] Starting job {job_id}, model={model}")
    
    try:
        # 청크 로드
        if chunk_ids:
            chunks = load_chunks_by_ids(chunk_ids)
        elif doc_ids:
            chunks = load_chunks_by_doc_ids(doc_ids)
        else:
            chunks = load_all_chunks()
        
        print(f"[EmbeddingWorker] Loaded {len(chunks)} chunks")
        
        if not chunks:
            fail_job(job_id, "임베딩할 청크가 없습니다.")
            return
        
        # 기존 임베딩 제외
        skipped_count = 0
        if skip_existing:
            existing_ids = get_existing_embedding_ids()
            original_count = len(chunks)
            chunks = [c for c in chunks if c.get("chunk_id") not in existing_ids]
            skipped_count = original_count - len(chunks)
            print(f"[EmbeddingWorker] Skipped {skipped_count} existing embeddings")
        
        if not chunks:
            complete_job(job_id, JobResult(
                success=True,
                processed=0,
                failed=0,
                skipped=skipped_count,
            ))
            return
        
        # 작업 시작
        start_job(job_id, len(chunks))
        
        # 진행률 콜백
        def on_progress(current: int, message: str):
            update_job_progress(job_id, current, message=message)
        
        # 모델별 임베딩 생성
        is_huggingface = model in ("ko-sroberta", "bge-m3")
        is_openai = model.startswith("openai")
        
        if is_huggingface:
            result = generate_huggingface_embeddings(chunks, model, job_id, on_progress)
        elif is_openai:
            if not api_key:
                api_key = get_openai_api_key()
            if not api_key:
                fail_job(job_id, "OpenAI API 키가 필요합니다. frontend/.env.local에 OPENAI_API_KEY를 설정하세요.")
                return
            print(f"[EmbeddingWorker] Using OpenAI API with model: {model}")
            result = generate_openai_embeddings(chunks, model, api_key, job_id, on_progress)
        else:
            fail_job(job_id, f"지원하지 않는 모델: {model}")
            return
        
        # 취소 확인
        if is_cancelled(job_id):
            fail_job(job_id, "작업이 취소되었습니다.", JobResult(
                success=False,
                processed=len(result.get("results", [])),
                failed=len(result.get("errors", [])),
                skipped=skipped_count,
                errors=result.get("errors", [])[:10],
            ))
            clear_cancellation(job_id)
            return
        
        # ChromaDB에 저장
        chromadb_saved = 0
        if result.get("results"):
            chromadb_saved = save_to_chromadb(result["results"], chunks)
        
        # 통계 파일 업데이트
        processed_count = len(result.get("results", []))
        failed_count = len(result.get("errors", []))
        update_embedding_stats(
            processed_count,
            failed_count,
            result.get("total_tokens", 0),
            result.get("estimated_cost", 0)
        )
        
        # 작업 완료
        complete_job(job_id, JobResult(
            success=result.get("success", False),
            processed=processed_count,
            failed=failed_count,
            skipped=skipped_count,
            errors=result.get("errors", [])[:10],
            data={
                "total_tokens": result.get("total_tokens", 0),
                "estimated_cost": result.get("estimated_cost", 0),
                "chromadb_saved": chromadb_saved,
                "processing_time_ms": result.get("processing_time_ms", 0),
            }
        ))
        
        print(f"[EmbeddingWorker] Job {job_id} completed: {processed_count} processed, {failed_count} failed")
    
    except Exception as e:
        error_msg = str(e)
        print(f"[EmbeddingWorker] Job {job_id} failed: {error_msg}")
        fail_job(job_id, error_msg)
    finally:
        clear_cancellation(job_id)


# ============================================================
# Worker 시작 (Threading)
# ============================================================

_worker_threads: Dict[str, threading.Thread] = {}


def start_embedding_worker(job_id: str) -> bool:
    """임베딩 워커 시작 (새 스레드에서)"""
    if job_id in _worker_threads and _worker_threads[job_id].is_alive():
        print(f"[EmbeddingWorker] Worker already running for job {job_id}")
        return False
    
    def worker_thread():
        try:
            run_embedding_job(job_id)
        except Exception as e:
            print(f"[EmbeddingWorker] Worker thread error: {e}")
        finally:
            # 정리
            if job_id in _worker_threads:
                del _worker_threads[job_id]
    
    thread = threading.Thread(target=worker_thread, daemon=True)
    _worker_threads[job_id] = thread
    thread.start()
    
    print(f"[EmbeddingWorker] Started worker thread for job {job_id}")
    return True


def cancel_embedding_worker(job_id: str) -> bool:
    """임베딩 워커 취소"""
    request_cancellation(job_id)
    return True
