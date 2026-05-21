"""
백그라운드 작업 관리 시스템

파일 기반 Job Store로 임베딩 등 장시간 작업을 관리합니다.
Docker 환경에서 볼륨 마운트를 통해 영속성을 보장합니다.
"""

import json
import os
import uuid
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Literal
from dataclasses import dataclass, field, asdict
from enum import Enum


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobType(str, Enum):
    EMBEDDING = "embedding"
    CHUNKING = "chunking"
    ANALYSIS = "analysis"


@dataclass
class JobProgress:
    current: int = 0
    total: int = 0
    percentage: int = 0
    current_item: Optional[str] = None
    message: Optional[str] = None


@dataclass
class JobResult:
    success: bool = False
    processed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: List[Dict[str, str]] = field(default_factory=list)
    data: Optional[Dict[str, Any]] = None


@dataclass
class Job:
    id: str
    type: JobType
    status: JobStatus
    progress: JobProgress
    params: Dict[str, Any]
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[JobResult] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ============================================================
# 파일 경로
# ============================================================

def get_jobs_dir() -> Path:
    """Jobs 디렉토리 경로 반환"""
    # Docker 환경에서는 /app/data/jobs
    # 로컬 환경에서는 backend/data/jobs
    base_dir = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
    jobs_dir = base_dir / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    return jobs_dir


def get_job_file_path(job_id: str) -> Path:
    """Job 파일 경로 반환"""
    return get_jobs_dir() / f"{job_id}.json"


def get_active_jobs_file() -> Path:
    """활성 작업 목록 파일 경로"""
    return get_jobs_dir() / "active-jobs.json"


# ============================================================
# Job 직렬화/역직렬화
# ============================================================

def job_to_dict(job: Job) -> Dict[str, Any]:
    """Job을 딕셔너리로 변환"""
    d = {
        "id": job.id,
        "type": job.type.value if isinstance(job.type, JobType) else job.type,
        "status": job.status.value if isinstance(job.status, JobStatus) else job.status,
        "progress": asdict(job.progress) if job.progress else None,
        "params": job.params,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "result": asdict(job.result) if job.result else None,
        "error": job.error,
        "metadata": job.metadata,
    }
    return d


def dict_to_job(d: Dict[str, Any]) -> Job:
    """딕셔너리를 Job으로 변환"""
    progress_data = d.get("progress") or {}
    result_data = d.get("result")
    
    return Job(
        id=d["id"],
        type=JobType(d["type"]) if d.get("type") else JobType.EMBEDDING,
        status=JobStatus(d["status"]) if d.get("status") else JobStatus.PENDING,
        progress=JobProgress(
            current=progress_data.get("current", 0),
            total=progress_data.get("total", 0),
            percentage=progress_data.get("percentage", 0),
            current_item=progress_data.get("current_item"),
            message=progress_data.get("message"),
        ),
        params=d.get("params", {}),
        created_at=d.get("created_at", datetime.now().isoformat()),
        started_at=d.get("started_at"),
        completed_at=d.get("completed_at"),
        result=JobResult(
            success=result_data.get("success", False),
            processed=result_data.get("processed", 0),
            failed=result_data.get("failed", 0),
            skipped=result_data.get("skipped", 0),
            errors=result_data.get("errors", []),
            data=result_data.get("data"),
        ) if result_data else None,
        error=d.get("error"),
        metadata=d.get("metadata"),
    )


# ============================================================
# Job CRUD
# ============================================================

_job_lock = threading.Lock()


def create_job(
    job_type: JobType,
    params: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None
) -> Job:
    """새 작업 생성"""
    job = Job(
        id=str(uuid.uuid4()),
        type=job_type,
        status=JobStatus.PENDING,
        progress=JobProgress(),
        params=params,
        created_at=datetime.now().isoformat(),
        metadata=metadata,
    )
    
    save_job(job)
    add_to_active_jobs(job.id)
    
    return job


def save_job(job: Job) -> None:
    """작업 저장"""
    with _job_lock:
        file_path = get_job_file_path(job.id)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(job_to_dict(job), f, ensure_ascii=False, indent=2)


def load_job(job_id: str) -> Optional[Job]:
    """작업 로드"""
    file_path = get_job_file_path(job_id)
    
    try:
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return dict_to_job(data)
    except Exception as e:
        print(f"[JobStore] Failed to load job {job_id}: {e}")
    
    return None


def delete_job(job_id: str) -> bool:
    """작업 삭제"""
    file_path = get_job_file_path(job_id)
    
    try:
        if file_path.exists():
            file_path.unlink()
            remove_from_active_jobs(job_id)
            return True
    except Exception as e:
        print(f"[JobStore] Failed to delete job {job_id}: {e}")
    
    return False


# ============================================================
# 활성 작업 관리
# ============================================================

def load_active_jobs() -> List[str]:
    """활성 작업 ID 목록 로드"""
    file_path = get_active_jobs_file()
    try:
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
    except:
        pass
    return []


def save_active_jobs(job_ids: List[str]) -> None:
    """활성 작업 ID 목록 저장"""
    with _job_lock:
        file_path = get_active_jobs_file()
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(job_ids, f)


def add_to_active_jobs(job_id: str) -> None:
    """활성 작업에 추가"""
    active_jobs = load_active_jobs()
    if job_id not in active_jobs:
        active_jobs.append(job_id)
        save_active_jobs(active_jobs)


def remove_from_active_jobs(job_id: str) -> None:
    """활성 작업에서 제거"""
    active_jobs = load_active_jobs()
    if job_id in active_jobs:
        active_jobs.remove(job_id)
        save_active_jobs(active_jobs)


# ============================================================
# 작업 상태 업데이트
# ============================================================

def start_job(job_id: str, total: int) -> Optional[Job]:
    """작업 시작"""
    job = load_job(job_id)
    if not job:
        return None
    
    job.status = JobStatus.RUNNING
    job.started_at = datetime.now().isoformat()
    job.progress = JobProgress(current=0, total=total, percentage=0)
    
    save_job(job)
    return job


def update_job_progress(
    job_id: str,
    current: int,
    current_item: Optional[str] = None,
    message: Optional[str] = None
) -> Optional[Job]:
    """진행률 업데이트"""
    job = load_job(job_id)
    if not job:
        return None
    
    job.progress.current = current
    job.progress.percentage = int((current / job.progress.total) * 100) if job.progress.total > 0 else 0
    job.progress.current_item = current_item
    job.progress.message = message
    
    save_job(job)
    return job


def complete_job(job_id: str, result: JobResult) -> Optional[Job]:
    """작업 완료"""
    job = load_job(job_id)
    if not job:
        return None
    
    job.status = JobStatus.COMPLETED
    job.completed_at = datetime.now().isoformat()
    job.progress.current = job.progress.total
    job.progress.percentage = 100
    job.result = result
    
    save_job(job)
    remove_from_active_jobs(job_id)
    
    return job


def fail_job(job_id: str, error: str, partial_result: Optional[JobResult] = None) -> Optional[Job]:
    """작업 실패"""
    job = load_job(job_id)
    if not job:
        return None
    
    job.status = JobStatus.FAILED
    job.completed_at = datetime.now().isoformat()
    job.error = error
    if partial_result:
        job.result = partial_result
    
    save_job(job)
    remove_from_active_jobs(job_id)
    
    return job


def cancel_job(job_id: str) -> Optional[Job]:
    """작업 취소"""
    job = load_job(job_id)
    if not job:
        return None
    
    # 이미 완료된 작업은 취소 불가
    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
        return job
    
    job.status = JobStatus.CANCELLED
    job.completed_at = datetime.now().isoformat()
    
    save_job(job)
    remove_from_active_jobs(job_id)
    
    return job


# ============================================================
# 작업 목록 조회
# ============================================================

def list_active_jobs() -> List[Dict[str, Any]]:
    """활성 작업 목록 조회"""
    active_job_ids = load_active_jobs()
    jobs = []
    
    for job_id in active_job_ids:
        job = load_job(job_id)
        if job:
            jobs.append({
                "id": job.id,
                "type": job.type.value,
                "status": job.status.value,
                "progress": asdict(job.progress),
                "created_at": job.created_at,
                "completed_at": job.completed_at,
            })
    
    return jobs


def list_jobs_by_type(job_type: JobType, limit: int = 10) -> List[Dict[str, Any]]:
    """타입별 작업 목록 조회"""
    jobs_dir = get_jobs_dir()
    jobs = []
    
    try:
        for file_path in jobs_dir.glob("*.json"):
            if file_path.name == "active-jobs.json":
                continue
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                if data.get("type") == job_type.value:
                    jobs.append({
                        "id": data["id"],
                        "type": data["type"],
                        "status": data["status"],
                        "progress": data.get("progress", {}),
                        "created_at": data.get("created_at"),
                        "completed_at": data.get("completed_at"),
                    })
            except:
                pass
    except Exception as e:
        print(f"[JobStore] Failed to list jobs: {e}")
    
    # 최신순 정렬
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    
    return jobs[:limit]


def has_running_job(job_type: JobType) -> bool:
    """실행 중인 작업 확인"""
    active_jobs = list_active_jobs()
    return any(
        job["type"] == job_type.value and job["status"] == JobStatus.RUNNING.value
        for job in active_jobs
    )


def cleanup_old_jobs(max_age_days: int = 7) -> int:
    """오래된 완료 작업 정리"""
    from datetime import timedelta
    
    jobs_dir = get_jobs_dir()
    cutoff_date = datetime.now() - timedelta(days=max_age_days)
    deleted_count = 0
    
    try:
        for file_path in jobs_dir.glob("*.json"):
            if file_path.name == "active-jobs.json":
                continue
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                status = data.get("status")
                completed_at = data.get("completed_at")
                
                if status in ("completed", "failed", "cancelled") and completed_at:
                    completed_date = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                    if completed_date.replace(tzinfo=None) < cutoff_date:
                        file_path.unlink()
                        deleted_count += 1
            except:
                pass
    except Exception as e:
        print(f"[JobStore] Failed to cleanup jobs: {e}")
    
    return deleted_count


# ============================================================
# 취소 요청 관리 (메모리 기반)
# ============================================================

_cancelled_jobs: set = set()
_cancelled_lock = threading.Lock()


def request_cancellation(job_id: str) -> None:
    """작업 취소 요청"""
    with _cancelled_lock:
        _cancelled_jobs.add(job_id)


def is_cancelled(job_id: str) -> bool:
    """취소 요청 확인"""
    with _cancelled_lock:
        return job_id in _cancelled_jobs


def clear_cancellation(job_id: str) -> None:
    """취소 요청 제거"""
    with _cancelled_lock:
        _cancelled_jobs.discard(job_id)
