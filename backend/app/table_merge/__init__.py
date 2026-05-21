"""
Cross-page Table Merging Module

여러 페이지에 걸쳐 분절된 표를 자동으로 감지하고 병합하는 모듈입니다.
통합환경관리 계획서와 같은 대용량 표 문서의 정확한 RAG/벡터 DB화를 지원합니다.
"""

from .config import CrossPageMergeConfig
from .header_analyzer import HeaderAnalyzer, HeaderSignature
from .continuity_detector import ContinuityDetector, TableContinuityScore
from .duplicate_remover import DuplicateHeaderRemover
from .merge_engine import TableMergeEngine, TableMergeResult, MergeLogEntry
from .cross_page_merger import CrossPageTableMerger

__all__ = [
    # Config
    "CrossPageMergeConfig",
    # Header Analysis
    "HeaderAnalyzer",
    "HeaderSignature",
    # Continuity Detection
    "ContinuityDetector",
    "TableContinuityScore",
    # Duplicate Header Removal
    "DuplicateHeaderRemover",
    # Merge Engine
    "TableMergeEngine",
    "TableMergeResult",
    "MergeLogEntry",
    # Main Orchestrator
    "CrossPageTableMerger",
]
