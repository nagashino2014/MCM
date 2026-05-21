"""
Table Merge Engine Module

실제 표 병합 작업을 수행합니다.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime
import json

from .config import CrossPageMergeConfig
from .header_analyzer import HeaderAnalyzer, HeaderSignature
from .continuity_detector import TableCandidate, TableContinuityScore
from .duplicate_remover import DuplicateHeaderRemover


@dataclass
class MergeLogEntry:
    """병합 로그 항목"""
    timestamp: str = ""
    action: str = ""                          # "merge", "skip", "header_removed"
    source_tables: List[int] = field(default_factory=list)  # 원본 표 인덱스
    source_pages: List[int] = field(default_factory=list)   # 원본 페이지
    result_table_index: int = -1              # 결과 표 인덱스
    confidence: float = 0.0
    details: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "action": self.action,
            "source_tables": self.source_tables,
            "source_pages": self.source_pages,
            "result_table_index": self.result_table_index,
            "confidence": self.confidence,
            "details": self.details,
        }


@dataclass
class MergeStatistics:
    """병합 통계"""
    total_tables_input: int = 0               # 입력 표 수
    total_tables_output: int = 0              # 출력 표 수
    tables_merged: int = 0                    # 병합된 표 수
    merge_groups: int = 0                     # 병합 그룹 수
    headers_removed: int = 0                  # 제거된 중복 헤더 수
    total_rows_input: int = 0                 # 입력 행 수
    total_rows_output: int = 0                # 출력 행 수
    processing_time_ms: int = 0               # 처리 시간
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_tables_input": self.total_tables_input,
            "total_tables_output": self.total_tables_output,
            "tables_merged": self.tables_merged,
            "merge_groups": self.merge_groups,
            "headers_removed": self.headers_removed,
            "total_rows_input": self.total_rows_input,
            "total_rows_output": self.total_rows_output,
            "processing_time_ms": self.processing_time_ms,
        }


@dataclass
class MergedTableData:
    """병합된 표 데이터"""
    rows: List[List[str]]                     # 병합된 행 데이터
    table_index: int                          # 결과 표 인덱스
    
    # 병합 메타데이터
    is_merged: bool = False                   # 병합된 표 여부
    page_num: int = 0                         # 시작 페이지
    page_span: List[int] = field(default_factory=list)  # 걸쳐있는 페이지 목록
    original_table_indices: List[int] = field(default_factory=list)  # 원본 표 인덱스
    merge_confidence: float = 0.0             # 병합 신뢰도
    header_signature: str = ""                # 헤더 시그니처 해시
    
    # 기존 TableData 호환 필드
    semantic_text: str = ""
    structured_data: Optional[Dict[str, Any]] = None
    markdown: str = ""
    bbox: Optional[Tuple[float, ...]] = None
    row_count: int = 0
    col_count: int = 0
    confidence: float = 0.0
    extraction_method: str = ""
    
    def __post_init__(self):
        if self.rows:
            self.row_count = len(self.rows)
            self.col_count = len(self.rows[0]) if self.rows else 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "table_index": self.table_index,
            "is_merged": self.is_merged,
            "page_num": self.page_num,
            "page_span": self.page_span,
            "original_table_indices": self.original_table_indices,
            "merge_confidence": self.merge_confidence,
            "header_signature": self.header_signature,
            "row_count": self.row_count,
            "col_count": self.col_count,
        }


@dataclass
class TableMergeResult:
    """표 병합 결과"""
    merged_tables: List[MergedTableData] = field(default_factory=list)
    merge_log: List[MergeLogEntry] = field(default_factory=list)
    statistics: MergeStatistics = field(default_factory=MergeStatistics)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "merged_tables": [t.to_dict() for t in self.merged_tables],
            "merge_log": [e.to_dict() for e in self.merge_log],
            "statistics": self.statistics.to_dict(),
        }


class TableMergeEngine:
    """표 병합 엔진"""
    
    def __init__(self, config: CrossPageMergeConfig = None):
        self.config = config or CrossPageMergeConfig()
        self.header_analyzer = HeaderAnalyzer(config)
        self.duplicate_remover = DuplicateHeaderRemover(config)
    
    def merge_table_chain(
        self,
        tables: List[TableCandidate],
        continuity_scores: List[TableContinuityScore] = None
    ) -> MergedTableData:
        """
        연속된 표 체인을 하나의 표로 병합
        
        Args:
            tables: 병합할 표 목록 (연속성 확인됨)
            continuity_scores: 연속성 점수 목록 (선택)
            
        Returns:
            MergedTableData: 병합된 표
        """
        if not tables:
            return MergedTableData(rows=[], table_index=0)
        
        if len(tables) == 1:
            # 단일 표는 병합 없이 반환
            table = tables[0]
            return MergedTableData(
                rows=table.rows,
                table_index=table.table_index,
                is_merged=False,
                page_num=table.page_num,
                page_span=[table.page_num],
                original_table_indices=[table.table_index],
                merge_confidence=1.0,
                header_signature=table.header_signature.fingerprint if table.header_signature else "",
                bbox=table.bbox,
                confidence=table.confidence,
                extraction_method=table.extraction_method,
            )
        
        # 첫 번째 표의 헤더 시그니처 추출
        first_table = tables[0]
        if not first_table.header_signature:
            first_table.header_signature = self.header_analyzer.extract_header_signature(
                first_table.rows, first_table.column_widths
            )
        
        reference_header = first_table.header_signature
        
        # 중복 헤더 제거하며 행 병합
        merged_rows = []
        original_indices = []
        page_span = []
        total_confidence = 0.0
        
        for i, table in enumerate(tables):
            is_first = (i == 0)
            
            # 중복 헤더 제거
            removal_result = self.duplicate_remover.remove_duplicate_headers(
                table.rows,
                reference_header,
                is_first_table=is_first
            )
            
            # 행 추가
            merged_rows.extend(removal_result.cleaned_rows)
            original_indices.append(table.table_index)
            
            if table.page_num not in page_span:
                page_span.append(table.page_num)
            
            # 신뢰도 누적
            if continuity_scores and i > 0 and i - 1 < len(continuity_scores):
                total_confidence += continuity_scores[i - 1].overall_score
        
        # 평균 병합 신뢰도
        avg_confidence = total_confidence / (len(tables) - 1) if len(tables) > 1 else 1.0
        
        # 병합 후 중간에 남은 중복 헤더 제거
        if self.config.enable_header_dedup:
            header_depth = reference_header.nested_header_depth
            merged_rows, removed_count = self.duplicate_remover.clean_merged_table(
                merged_rows, header_depth
            )
        
        return MergedTableData(
            rows=merged_rows,
            table_index=first_table.table_index,
            is_merged=True,
            page_num=first_table.page_num,
            page_span=sorted(page_span),
            original_table_indices=original_indices,
            merge_confidence=avg_confidence,
            header_signature=reference_header.fingerprint,
            bbox=first_table.bbox,
            confidence=first_table.confidence,
            extraction_method=first_table.extraction_method,
        )
    
    def merge_all_chains(
        self,
        tables: List[TableCandidate],
        chains: List[List[int]],
        continuity_scores: Dict[Tuple[int, int], TableContinuityScore] = None
    ) -> TableMergeResult:
        """
        모든 체인에 대해 병합 수행
        
        Args:
            tables: 전체 표 목록
            chains: 연속 표 인덱스 그룹 목록
            continuity_scores: 연속성 점수 딕셔너리 {(표1인덱스, 표2인덱스): 점수}
            
        Returns:
            TableMergeResult: 전체 병합 결과
        """
        import time
        start_time = time.time()
        
        result = TableMergeResult()
        result.statistics.total_tables_input = len(tables)
        result.statistics.total_rows_input = sum(len(t.rows) for t in tables)
        
        merged_table_index = 0
        
        for chain in chains:
            chain_tables = [tables[i] for i in chain]
            
            # 연속성 점수 추출
            chain_scores = []
            if continuity_scores and len(chain) > 1:
                for i in range(len(chain) - 1):
                    key = (chain[i], chain[i + 1])
                    if key in continuity_scores:
                        chain_scores.append(continuity_scores[key])
            
            # 체인 병합
            merged = self.merge_table_chain(chain_tables, chain_scores)
            merged.table_index = merged_table_index
            result.merged_tables.append(merged)
            
            # 로그 기록
            if len(chain) > 1:
                log_entry = MergeLogEntry(
                    action="merge",
                    source_tables=chain,
                    source_pages=[tables[i].page_num for i in chain],
                    result_table_index=merged_table_index,
                    confidence=merged.merge_confidence,
                    details={
                        "source_row_counts": [len(tables[i].rows) for i in chain],
                        "result_row_count": len(merged.rows),
                    }
                )
                result.merge_log.append(log_entry)
                result.statistics.tables_merged += len(chain)
                result.statistics.merge_groups += 1
            
            merged_table_index += 1
        
        # 통계 업데이트
        result.statistics.total_tables_output = len(result.merged_tables)
        result.statistics.total_rows_output = sum(len(t.rows) for t in result.merged_tables)
        result.statistics.headers_removed = (
            result.statistics.total_rows_input - result.statistics.total_rows_output
        )
        result.statistics.processing_time_ms = int((time.time() - start_time) * 1000)
        
        return result
    
    def generate_semantic_text(self, merged: MergedTableData) -> str:
        """
        병합된 표에서 RAG용 시맨틱 텍스트 생성
        
        헤더:값 형태로 선형화하여 검색에 최적화된 텍스트 생성
        """
        if not merged.rows:
            return ""
        
        # 헤더 추출
        header_sig = self.header_analyzer.extract_header_signature(merged.rows)
        headers = header_sig.column_names
        data_rows = merged.rows[header_sig.nested_header_depth:]
        
        lines = []
        
        # 병합 정보 추가
        if merged.is_merged:
            lines.append(f"[병합된 표: {len(merged.page_span)}페이지에 걸침, "
                        f"페이지 {merged.page_span[0]}-{merged.page_span[-1]}]")
        
        # 각 데이터 행을 헤더:값 형태로 변환
        for row_idx, row in enumerate(data_rows):
            row_parts = []
            for col_idx, cell in enumerate(row):
                cell_text = str(cell).strip()
                if cell_text:
                    header = headers[col_idx] if col_idx < len(headers) else f"열{col_idx+1}"
                    row_parts.append(f"{header}: {cell_text}")
            
            if row_parts:
                lines.append(" | ".join(row_parts))
        
        return "\n".join(lines)
    
    def generate_markdown(self, merged: MergedTableData) -> str:
        """병합된 표를 마크다운 형식으로 변환"""
        if not merged.rows:
            return ""
        
        lines = []
        
        # 병합 정보 주석
        if merged.is_merged:
            lines.append(f"<!-- 병합된 표: 페이지 {merged.page_span}, "
                        f"신뢰도 {merged.merge_confidence:.2f} -->")
        
        # 헤더
        if merged.rows:
            header_row = merged.rows[0]
            lines.append("| " + " | ".join(str(c) for c in header_row) + " |")
            lines.append("| " + " | ".join(["---"] * len(header_row)) + " |")
            
            # 데이터 행
            for row in merged.rows[1:]:
                lines.append("| " + " | ".join(str(c) for c in row) + " |")
        
        return "\n".join(lines)
