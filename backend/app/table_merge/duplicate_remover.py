"""
Duplicate Header Remover Module

페이지가 넘어갈 때 반복되는 헤더 행을 감지하고 제거합니다.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, Any
from difflib import SequenceMatcher
import re

from .config import CrossPageMergeConfig
from .header_analyzer import HeaderSignature


@dataclass
class RemovalResult:
    """헤더 제거 결과"""
    removed_rows: int = 0                     # 제거된 행 수
    removed_indices: List[int] = None         # 제거된 행 인덱스
    original_row_count: int = 0               # 원본 행 수
    cleaned_rows: List[List[str]] = None      # 정리된 행 데이터
    
    def __post_init__(self):
        if self.removed_indices is None:
            self.removed_indices = []
        if self.cleaned_rows is None:
            self.cleaned_rows = []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "removed_rows": self.removed_rows,
            "removed_indices": self.removed_indices,
            "original_row_count": self.original_row_count,
        }


class DuplicateHeaderRemover:
    """중복 헤더 제거기"""
    
    def __init__(self, config: CrossPageMergeConfig = None):
        self.config = config or CrossPageMergeConfig()
    
    def remove_duplicate_headers(
        self,
        rows: List[List[str]],
        reference_header: HeaderSignature,
        is_first_table: bool = False
    ) -> RemovalResult:
        """
        표에서 중복된 헤더 행 제거
        
        Args:
            rows: 표 행 데이터
            reference_header: 참조 헤더 시그니처 (첫 번째 표의 헤더)
            is_first_table: 첫 번째 표인지 여부 (첫 표는 헤더 유지)
            
        Returns:
            RemovalResult: 제거 결과
        """
        result = RemovalResult(original_row_count=len(rows))
        
        if not rows or not reference_header:
            result.cleaned_rows = rows
            return result
        
        # 첫 번째 표는 헤더 유지
        if is_first_table:
            result.cleaned_rows = rows
            return result
        
        # 참조 헤더 행들
        ref_header_rows = reference_header.raw_header_rows
        if not ref_header_rows:
            result.cleaned_rows = rows
            return result
        
        # 중복 헤더 감지 및 제거
        rows_to_remove = []
        
        for i in range(min(len(ref_header_rows), len(rows))):
            if self._is_duplicate_header_row(rows[i], ref_header_rows[i]):
                rows_to_remove.append(i)
            else:
                # 연속된 헤더만 제거 (중간에 데이터 행이 나오면 중단)
                break
        
        # 행 제거
        result.removed_indices = rows_to_remove
        result.removed_rows = len(rows_to_remove)
        result.cleaned_rows = [
            row for i, row in enumerate(rows) if i not in rows_to_remove
        ]
        
        return result
    
    def _is_duplicate_header_row(
        self,
        row: List[str],
        ref_row: List[str]
    ) -> bool:
        """행이 중복 헤더인지 판단"""
        if len(row) != len(ref_row):
            return False
        
        matches = 0
        total = len(row)
        
        for cell, ref_cell in zip(row, ref_row):
            # 정규화된 비교
            norm_cell = self._normalize_cell(cell)
            norm_ref = self._normalize_cell(ref_cell)
            
            if norm_cell == norm_ref:
                matches += 1
            elif norm_cell and norm_ref:
                # 부분 일치 확인 (90% 이상)
                ratio = SequenceMatcher(None, norm_cell, norm_ref).ratio()
                if ratio >= 0.9:
                    matches += 1
        
        # 90% 이상 일치하면 중복 헤더로 판단
        return matches >= total * 0.9
    
    def _normalize_cell(self, text: str) -> str:
        """셀 텍스트 정규화"""
        if text is None:
            return ""
        text = str(text).strip()
        # 공백, 줄바꿈 정규화
        text = re.sub(r'\s+', ' ', text)
        return text.lower()
    
    def remove_headers_from_continuation_tables(
        self,
        tables_rows: List[List[List[str]]],
        reference_header: HeaderSignature
    ) -> Tuple[List[List[List[str]]], List[RemovalResult]]:
        """
        연속 표 목록에서 중복 헤더 일괄 제거
        
        Args:
            tables_rows: 연속 표들의 행 데이터 목록
            reference_header: 참조 헤더 (첫 번째 표)
            
        Returns:
            Tuple[정리된 표 목록, 제거 결과 목록]
        """
        if not tables_rows:
            return [], []
        
        cleaned_tables = []
        removal_results = []
        
        for i, rows in enumerate(tables_rows):
            is_first = (i == 0)
            result = self.remove_duplicate_headers(rows, reference_header, is_first)
            cleaned_tables.append(result.cleaned_rows)
            removal_results.append(result)
        
        return cleaned_tables, removal_results
    
    def detect_repeated_header_pattern(
        self,
        all_rows: List[List[str]],
        expected_header_depth: int = 1
    ) -> List[int]:
        """
        병합된 표 전체에서 반복된 헤더 패턴 감지
        
        이미 병합된 표에서 중간에 삽입된 헤더를 찾습니다.
        
        Args:
            all_rows: 전체 행 데이터
            expected_header_depth: 예상 헤더 행 수
            
        Returns:
            List[int]: 중복 헤더로 감지된 행 인덱스 목록
        """
        if len(all_rows) < expected_header_depth + 1:
            return []
        
        # 첫 N행을 헤더로 가정
        header_rows = all_rows[:expected_header_depth]
        
        duplicate_indices = []
        
        # 헤더 이후 행들에서 헤더 반복 패턴 찾기
        i = expected_header_depth
        while i < len(all_rows):
            # 현재 위치에서 헤더가 반복되는지 확인
            is_header_repeat = True
            
            for j, header_row in enumerate(header_rows):
                if i + j >= len(all_rows):
                    is_header_repeat = False
                    break
                
                if not self._is_duplicate_header_row(all_rows[i + j], header_row):
                    is_header_repeat = False
                    break
            
            if is_header_repeat:
                # 헤더 반복 감지됨
                for j in range(expected_header_depth):
                    if i + j < len(all_rows):
                        duplicate_indices.append(i + j)
                i += expected_header_depth
            else:
                i += 1
        
        return duplicate_indices
    
    def clean_merged_table(
        self,
        merged_rows: List[List[str]],
        header_depth: int = 1
    ) -> Tuple[List[List[str]], int]:
        """
        병합된 표에서 중간에 삽입된 중복 헤더 제거
        
        Args:
            merged_rows: 병합된 표의 전체 행
            header_depth: 헤더 행 수
            
        Returns:
            Tuple[정리된 행, 제거된 행 수]
        """
        duplicate_indices = self.detect_repeated_header_pattern(merged_rows, header_depth)
        
        if not duplicate_indices:
            return merged_rows, 0
        
        cleaned_rows = [
            row for i, row in enumerate(merged_rows) if i not in duplicate_indices
        ]
        
        return cleaned_rows, len(duplicate_indices)
