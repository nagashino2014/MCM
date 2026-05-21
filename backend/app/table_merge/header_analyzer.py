"""
Header Analyzer Module

표의 헤더를 분석하고 시그니처를 생성하여 표 연속성 판단에 활용합니다.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from difflib import SequenceMatcher

from .config import CrossPageMergeConfig


@dataclass
class HeaderSignature:
    """헤더 시그니처 - 표 식별을 위한 고유 정보"""
    column_count: int                          # 열 개수
    column_names: List[str]                    # 열 이름 목록
    column_widths_ratio: List[float] = field(default_factory=list)  # 상대적 열 너비 비율
    nested_header_depth: int = 1               # 다단 헤더 깊이
    fingerprint: str = ""                      # 헤더 고유 식별자 (해시)
    raw_header_rows: List[List[str]] = field(default_factory=list)  # 원본 헤더 행들
    
    def __post_init__(self):
        """fingerprint 자동 생성"""
        if not self.fingerprint:
            self.fingerprint = self._generate_fingerprint()
    
    def _generate_fingerprint(self) -> str:
        """헤더 고유 식별자 생성"""
        # 열 이름을 정규화하여 해시 생성
        normalized_names = [self._normalize_text(name) for name in self.column_names]
        content = f"{self.column_count}|{'|'.join(normalized_names)}"
        return hashlib.md5(content.encode('utf-8')).hexdigest()[:16]
    
    @staticmethod
    def _normalize_text(text: str) -> str:
        """텍스트 정규화 (공백, 특수문자 제거)"""
        if not text:
            return ""
        # 공백, 줄바꿈 제거
        text = re.sub(r'\s+', '', text)
        # 특수문자 제거 (한글, 영문, 숫자만 유지)
        text = re.sub(r'[^\w가-힣]', '', text)
        return text.lower()
    
    def to_dict(self) -> Dict[str, Any]:
        """딕셔너리로 변환"""
        return {
            "column_count": self.column_count,
            "column_names": self.column_names,
            "column_widths_ratio": self.column_widths_ratio,
            "nested_header_depth": self.nested_header_depth,
            "fingerprint": self.fingerprint,
        }


class HeaderAnalyzer:
    """헤더 분석기 - 표의 헤더를 분석하고 비교"""
    
    def __init__(self, config: CrossPageMergeConfig = None):
        self.config = config or CrossPageMergeConfig()
    
    def extract_header_signature(
        self,
        rows: List[List[str]],
        column_widths: List[float] = None
    ) -> HeaderSignature:
        """
        표에서 헤더 시그니처 추출
        
        Args:
            rows: 표의 전체 행 데이터
            column_widths: 각 열의 너비 (픽셀 또는 비율)
            
        Returns:
            HeaderSignature: 추출된 헤더 시그니처
        """
        if not rows:
            return HeaderSignature(column_count=0, column_names=[])
        
        # 헤더 행 감지
        header_rows, header_depth = self._detect_header_rows(rows)
        
        # 열 이름 추출 (다단 헤더 병합)
        column_names = self._merge_header_rows(header_rows)
        
        # 열 너비 비율 계산
        width_ratios = self._calculate_width_ratios(column_widths) if column_widths else []
        
        return HeaderSignature(
            column_count=len(rows[0]) if rows else 0,
            column_names=column_names,
            column_widths_ratio=width_ratios,
            nested_header_depth=header_depth,
            raw_header_rows=header_rows,
        )
    
    def _detect_header_rows(self, rows: List[List[str]]) -> Tuple[List[List[str]], int]:
        """
        헤더 행 감지
        
        헤더 판단 기준:
        1. 숫자보다 텍스트가 많음
        2. 셀 내용이 짧음 (단어 수준)
        3. 특정 키워드 포함 (번호, 항목, 구분 등)
        
        Returns:
            Tuple[헤더 행 목록, 헤더 깊이]
        """
        if not rows:
            return [], 0
        
        header_rows = []
        max_header_depth = min(self.config.max_header_row_count, len(rows))
        
        for i in range(max_header_depth):
            row = rows[i]
            if self._is_header_row(row, i):
                header_rows.append(row)
            else:
                break
        
        # 최소 1개의 헤더 행은 있다고 가정
        if not header_rows and rows:
            header_rows = [rows[0]]
        
        return header_rows, len(header_rows)
    
    def _is_header_row(self, row: List[str], row_index: int) -> bool:
        """행이 헤더인지 판단"""
        if not row:
            return False
        
        # 첫 번째 행은 높은 확률로 헤더
        if row_index == 0:
            return True
        
        # 셀 특성 분석
        numeric_cells = 0
        text_cells = 0
        empty_cells = 0
        header_keywords = 0
        
        header_keyword_patterns = [
            r'번호', r'항목', r'구분', r'분류', r'명칭', r'단위',
            r'합계', r'소계', r'총', r'계',
            r'no\.?', r'item', r'category', r'name', r'unit',
        ]
        
        for cell in row:
            cell_text = str(cell).strip()
            
            if not cell_text:
                empty_cells += 1
                continue
            
            # 숫자 셀 판단
            if re.match(r'^[\d,.\-+%]+$', cell_text):
                numeric_cells += 1
            else:
                text_cells += 1
            
            # 헤더 키워드 확인
            cell_lower = cell_text.lower()
            for pattern in header_keyword_patterns:
                if re.search(pattern, cell_lower):
                    header_keywords += 1
                    break
        
        total_cells = len(row) - empty_cells
        if total_cells == 0:
            return False
        
        # 판단 기준
        # 1. 텍스트 셀이 숫자 셀보다 많으면 헤더
        # 2. 헤더 키워드가 있으면 헤더
        # 3. 대부분 비어있으면 헤더 아님
        
        if header_keywords > 0:
            return True
        
        if empty_cells > len(row) * 0.7:
            return False
        
        return text_cells > numeric_cells
    
    def _merge_header_rows(self, header_rows: List[List[str]]) -> List[str]:
        """
        다단 헤더를 단일 열 이름으로 병합
        
        예: [["", "2024년", "2024년"], ["항목", "상반기", "하반기"]]
        → ["항목", "2024년_상반기", "2024년_하반기"]
        """
        if not header_rows:
            return []
        
        if len(header_rows) == 1:
            return [str(cell).strip() for cell in header_rows[0]]
        
        # 다단 헤더 병합
        col_count = max(len(row) for row in header_rows)
        merged_names = []
        
        for col_idx in range(col_count):
            parts = []
            prev_part = ""
            
            for row in header_rows:
                if col_idx < len(row):
                    cell = str(row[col_idx]).strip()
                    # 빈 셀이면 이전 값 유지 (병합 셀 처리)
                    if cell and cell != prev_part:
                        parts.append(cell)
                        prev_part = cell
            
            merged_name = "_".join(parts) if parts else f"col_{col_idx}"
            merged_names.append(merged_name)
        
        return merged_names
    
    def _calculate_width_ratios(self, widths: List[float]) -> List[float]:
        """열 너비를 비율로 변환 (합계 = 1.0)"""
        if not widths:
            return []
        
        total = sum(widths)
        if total == 0:
            return [1.0 / len(widths)] * len(widths)
        
        return [w / total for w in widths]
    
    def compare_signatures(
        self,
        sig1: HeaderSignature,
        sig2: HeaderSignature
    ) -> Tuple[float, Dict[str, float]]:
        """
        두 헤더 시그니처 비교
        
        Returns:
            Tuple[종합 유사도, 세부 점수 딕셔너리]
        """
        scores = {}
        
        # 1. 열 개수 일치도
        if sig1.column_count == 0 or sig2.column_count == 0:
            scores["column_count"] = 0.0
        else:
            count_diff = abs(sig1.column_count - sig2.column_count)
            max_count = max(sig1.column_count, sig2.column_count)
            scores["column_count"] = 1.0 - (count_diff / max_count)
        
        # 2. 열 이름 유사도
        scores["column_names"] = self._compare_column_names(
            sig1.column_names, sig2.column_names
        )
        
        # 3. 열 너비 비율 유사도
        if sig1.column_widths_ratio and sig2.column_widths_ratio:
            scores["width_ratio"] = self._compare_width_ratios(
                sig1.column_widths_ratio, sig2.column_widths_ratio
            )
        else:
            scores["width_ratio"] = 1.0  # 너비 정보 없으면 무시
        
        # 4. fingerprint 일치
        scores["fingerprint"] = 1.0 if sig1.fingerprint == sig2.fingerprint else 0.0
        
        # 종합 점수 계산 (가중 평균)
        weights = {
            "column_count": 0.25,
            "column_names": 0.45,
            "width_ratio": 0.15,
            "fingerprint": 0.15,
        }
        
        overall = sum(scores[k] * weights[k] for k in scores)
        
        return overall, scores
    
    def _compare_column_names(
        self,
        names1: List[str],
        names2: List[str]
    ) -> float:
        """열 이름 유사도 계산"""
        if not names1 or not names2:
            return 0.0
        
        # 정규화된 이름 비교
        norm1 = [HeaderSignature._normalize_text(n) for n in names1]
        norm2 = [HeaderSignature._normalize_text(n) for n in names2]
        
        # 길이가 다르면 짧은 쪽 기준으로 비교
        min_len = min(len(norm1), len(norm2))
        max_len = max(len(norm1), len(norm2))
        
        if min_len == 0:
            return 0.0
        
        # 각 열별 유사도 계산
        matches = 0
        for i in range(min_len):
            # 완전 일치
            if norm1[i] == norm2[i]:
                matches += 1
            else:
                # 부분 일치 (SequenceMatcher 사용)
                ratio = SequenceMatcher(None, norm1[i], norm2[i]).ratio()
                if ratio >= 0.8:  # 80% 이상 유사하면 부분 일치
                    matches += ratio
        
        # 길이 차이 패널티 적용
        length_penalty = min_len / max_len
        
        return (matches / min_len) * length_penalty
    
    def _compare_width_ratios(
        self,
        ratios1: List[float],
        ratios2: List[float]
    ) -> float:
        """열 너비 비율 유사도 계산"""
        if len(ratios1) != len(ratios2):
            # 길이가 다르면 짧은 쪽 기준
            min_len = min(len(ratios1), len(ratios2))
            ratios1 = ratios1[:min_len]
            ratios2 = ratios2[:min_len]
        
        if not ratios1:
            return 0.0
        
        # 각 열별 비율 차이 계산
        tolerance = self.config.min_width_ratio_tolerance
        matches = 0
        
        for r1, r2 in zip(ratios1, ratios2):
            diff = abs(r1 - r2)
            if diff <= tolerance:
                matches += 1 - (diff / tolerance)
        
        return matches / len(ratios1)
    
    def is_same_table_header(
        self,
        sig1: HeaderSignature,
        sig2: HeaderSignature
    ) -> bool:
        """두 헤더가 동일한 표의 헤더인지 판단"""
        similarity, _ = self.compare_signatures(sig1, sig2)
        return similarity >= self.config.header_similarity_threshold
