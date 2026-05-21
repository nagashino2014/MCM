"""
Cross-page Table Merger - Main Orchestrator

여러 페이지에 걸친 표를 자동으로 감지하고 병합하는 메인 모듈입니다.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
import logging

from .config import CrossPageMergeConfig
from .header_analyzer import HeaderAnalyzer, HeaderSignature
from .continuity_detector import ContinuityDetector, TableCandidate, TableContinuityScore
from .duplicate_remover import DuplicateHeaderRemover
from .merge_engine import TableMergeEngine, TableMergeResult, MergedTableData, MergeLogEntry

# 로거 설정
logger = logging.getLogger(__name__)


class CrossPageTableMerger:
    """
    Cross-page 표 병합 메인 오케스트레이터
    
    PDF, HWP/HWPX, DOCX 파일에서 추출된 표들 중 여러 페이지에 걸쳐
    분절된 표를 자동으로 감지하고 하나로 병합합니다.
    
    사용 예시:
    ```python
    config = CrossPageMergeConfig(enabled=True)
    merger = CrossPageTableMerger(config)
    result = merger.process(extraction_result)
    ```
    """
    
    def __init__(self, config: CrossPageMergeConfig = None):
        self.config = config or CrossPageMergeConfig()
        self.header_analyzer = HeaderAnalyzer(config)
        self.continuity_detector = ContinuityDetector(config)
        self.duplicate_remover = DuplicateHeaderRemover(config)
        self.merge_engine = TableMergeEngine(config)
    
    def process(
        self,
        extraction_result: Any,
        page_height: float = None
    ) -> Any:
        """
        추출 결과에서 Cross-page 표 병합 수행
        
        Args:
            extraction_result: ExtractionResult 객체
            page_height: 페이지 높이 (위치 분석용, PDF 전용)
            
        Returns:
            ExtractionResult: 병합된 표가 포함된 결과
        """
        if not self.config.enabled:
            logger.debug("Cross-page merge disabled")
            return extraction_result
        
        # 모든 페이지에서 표 후보 추출
        candidates = self._extract_table_candidates(extraction_result)
        
        if len(candidates) < 2:
            logger.debug(f"Not enough tables for merging: {len(candidates)}")
            return extraction_result
        
        logger.info(f"Processing {len(candidates)} tables for cross-page merge")
        
        # 연속성 분석 및 체인 찾기
        chains, continuity_scores = self._analyze_continuity(candidates, page_height)
        
        # 표 병합 수행
        merge_result = self.merge_engine.merge_all_chains(
            candidates, chains, continuity_scores
        )
        
        # 결과를 ExtractionResult에 반영
        updated_result = self._update_extraction_result(
            extraction_result, merge_result
        )
        
        # 통계 로깅
        stats = merge_result.statistics
        logger.info(
            f"Merge complete: {stats.total_tables_input} -> {stats.total_tables_output} tables, "
            f"{stats.merge_groups} merge groups, {stats.headers_removed} headers removed"
        )
        
        return updated_result
    
    def _extract_table_candidates(self, extraction_result: Any) -> List[TableCandidate]:
        """ExtractionResult에서 표 후보 추출"""
        candidates = []
        
        # ExtractionResult의 pages에서 표 추출
        if hasattr(extraction_result, 'pages'):
            for page in extraction_result.pages:
                page_num = page.page_num if hasattr(page, 'page_num') else 0
                
                if hasattr(page, 'tables'):
                    for table in page.tables:
                        candidate = self._create_candidate_from_tabledata(
                            table, page_num
                        )
                        if candidate:
                            candidates.append(candidate)
        
        # 페이지 순서로 정렬
        candidates.sort(key=lambda c: (c.page_num, c.table_index))
        
        return candidates
    
    def _create_candidate_from_tabledata(
        self,
        table_data: Any,
        page_num: int
    ) -> Optional[TableCandidate]:
        """TableData에서 TableCandidate 생성"""
        if not hasattr(table_data, 'rows') or not table_data.rows:
            return None
        
        candidate = TableCandidate(
            table_index=table_data.table_index if hasattr(table_data, 'table_index') else 0,
            page_num=page_num,
            rows=table_data.rows,
            bbox=table_data.bbox if hasattr(table_data, 'bbox') else None,
            row_count=table_data.row_count if hasattr(table_data, 'row_count') else len(table_data.rows),
            col_count=table_data.col_count if hasattr(table_data, 'col_count') else (len(table_data.rows[0]) if table_data.rows else 0),
            confidence=table_data.confidence if hasattr(table_data, 'confidence') else 0.0,
            extraction_method=table_data.extraction_method if hasattr(table_data, 'extraction_method') else "",
        )
        
        # 헤더 시그니처 미리 계산
        candidate.header_signature = self.header_analyzer.extract_header_signature(
            candidate.rows, candidate.column_widths
        )
        
        return candidate
    
    def _analyze_continuity(
        self,
        candidates: List[TableCandidate],
        page_height: float = None
    ) -> Tuple[List[List[int]], Dict[Tuple[int, int], TableContinuityScore]]:
        """
        연속성 분석 및 체인 찾기
        
        Returns:
            Tuple[체인 목록, 연속성 점수 딕셔너리]
        """
        continuity_scores = {}
        
        # 인접한 표 쌍에 대해 연속성 분석
        for i in range(len(candidates) - 1):
            table1 = candidates[i]
            table2 = candidates[i + 1]
            
            score = self.continuity_detector.detect_continuity(
                table1, table2, page_height
            )
            
            continuity_scores[(i, i + 1)] = score
            
            if self.config.debug_mode:
                logger.debug(
                    f"Continuity [{i}]->[{i+1}]: "
                    f"page {table1.page_num}->{table2.page_num}, "
                    f"score={score.overall_score:.3f}, "
                    f"is_continuation={score.is_continuation}"
                )
        
        # 체인 구성
        chains = self._build_chains(candidates, continuity_scores)
        
        return chains, continuity_scores
    
    def _build_chains(
        self,
        candidates: List[TableCandidate],
        continuity_scores: Dict[Tuple[int, int], TableContinuityScore]
    ) -> List[List[int]]:
        """연속성 점수를 기반으로 체인 구성"""
        if not candidates:
            return []
        
        chains = []
        current_chain = [0]
        
        for i in range(1, len(candidates)):
            key = (i - 1, i)
            score = continuity_scores.get(key)
            
            if score and score.is_continuation:
                current_chain.append(i)
            else:
                chains.append(current_chain)
                current_chain = [i]
        
        chains.append(current_chain)
        
        return chains
    
    def _update_extraction_result(
        self,
        original_result: Any,
        merge_result: TableMergeResult
    ) -> Any:
        """병합 결과를 ExtractionResult에 반영"""
        from ..extractors.base import TableData
        
        # 병합된 표들로 새 TableData 목록 생성
        new_tables = []
        
        for merged in merge_result.merged_tables:
            # 시맨틱 텍스트 및 마크다운 생성
            semantic_text = self.merge_engine.generate_semantic_text(merged)
            markdown = self.merge_engine.generate_markdown(merged)
            
            table_data = TableData(
                table_index=merged.table_index,
                rows=merged.rows,
                semantic_text=semantic_text,
                markdown=markdown,
                bbox=merged.bbox,
                row_count=merged.row_count,
                col_count=merged.col_count,
                confidence=merged.confidence,
                extraction_method=merged.extraction_method,
                # Cross-page 필드 직접 설정
                page_num=merged.page_num,
                page_span=merged.page_span,
                is_merged=merged.is_merged,
                original_table_indices=merged.original_table_indices,
                header_signature=merged.header_signature,
                merge_confidence=merged.merge_confidence,
            )
            
            new_tables.append(table_data)
        
        # structured_tables 업데이트
        if hasattr(original_result, 'structured_tables'):
            original_result.structured_tables = [
                self._create_structured_table(merged)
                for merged in merge_result.merged_tables
            ]
        
        # pages의 tables 업데이트 (단순화: 모든 병합된 표를 첫 페이지에 배치)
        # 실제로는 page_span에 따라 적절히 분배해야 함
        if hasattr(original_result, 'pages') and original_result.pages:
            # 기존 표 제거
            for page in original_result.pages:
                if hasattr(page, 'tables'):
                    page.tables = []
            
            # 병합된 표를 시작 페이지에 배치
            for table_data in new_tables:
                merge_meta = getattr(table_data, '_merge_metadata', {})
                start_page = merge_meta.get('page_num', 1)
                
                for page in original_result.pages:
                    if page.page_num == start_page:
                        if not hasattr(page, 'tables'):
                            page.tables = []
                        page.tables.append(table_data)
                        break
        
        # 병합 로그 저장
        if self.config.save_merge_log and hasattr(original_result, 'metadata'):
            if original_result.metadata is None:
                original_result.metadata = {}
            original_result.metadata['cross_page_merge'] = {
                'statistics': merge_result.statistics.to_dict(),
                'log': [entry.to_dict() for entry in merge_result.merge_log],
            }
        
        return original_result
    
    def _create_structured_table(self, merged: MergedTableData) -> Dict[str, Any]:
        """병합된 표에서 구조화된 데이터 생성"""
        return {
            "table_index": merged.table_index,
            "rows": merged.rows,
            "row_count": merged.row_count,
            "col_count": merged.col_count,
            "confidence": merged.confidence,
            "extraction_method": merged.extraction_method,
            # 병합 메타데이터
            "is_merged": merged.is_merged,
            "page_num": merged.page_num,
            "page_span": merged.page_span,
            "original_table_indices": merged.original_table_indices,
            "merge_confidence": merged.merge_confidence,
            "header_signature": merged.header_signature,
        }
    
    def merge_tables_directly(
        self,
        tables: List[Dict[str, Any]],
        page_height: float = None
    ) -> TableMergeResult:
        """
        표 데이터를 직접 병합 (ExtractionResult 없이)
        
        Args:
            tables: 표 데이터 딕셔너리 목록
                각 항목: {"rows": [[...]], "page_num": int, "bbox": tuple, ...}
            page_height: 페이지 높이
            
        Returns:
            TableMergeResult: 병합 결과
        """
        candidates = []
        
        for i, table in enumerate(tables):
            candidate = TableCandidate(
                table_index=table.get("table_index", i),
                page_num=table.get("page_num", i),
                rows=table.get("rows", []),
                bbox=table.get("bbox"),
                column_widths=table.get("column_widths", []),
                row_count=len(table.get("rows", [])),
                col_count=len(table.get("rows", [[]])[0]) if table.get("rows") else 0,
                confidence=table.get("confidence", 0.0),
                extraction_method=table.get("extraction_method", ""),
            )
            
            # 헤더 시그니처 계산
            if candidate.rows:
                candidate.header_signature = self.header_analyzer.extract_header_signature(
                    candidate.rows, candidate.column_widths
                )
            
            candidates.append(candidate)
        
        if len(candidates) < 2:
            # 병합할 표가 없음
            return TableMergeResult(
                merged_tables=[
                    MergedTableData(
                        rows=c.rows,
                        table_index=c.table_index,
                        is_merged=False,
                        page_num=c.page_num,
                        page_span=[c.page_num],
                        original_table_indices=[c.table_index],
                    )
                    for c in candidates
                ]
            )
        
        # 연속성 분석
        chains, continuity_scores = self._analyze_continuity(candidates, page_height)
        
        # 병합 수행
        return self.merge_engine.merge_all_chains(candidates, chains, continuity_scores)
