"""
Continuity Detector Module

페이지 경계에서 표의 연속성을 감지합니다.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
import re

from .config import CrossPageMergeConfig
from .header_analyzer import HeaderAnalyzer, HeaderSignature


@dataclass
class TableContinuityScore:
    """표 연속성 점수"""
    column_match_score: float = 0.0       # 열 구조 일치도 (0.0~1.0)
    position_continuity: float = 0.0      # 위치 연속성 점수
    header_repetition: bool = False       # 헤더 반복 여부
    header_similarity: float = 0.0        # 헤더 유사도
    data_pattern_match: float = 0.0       # 데이터 패턴 일치도
    page_gap: int = 1                     # 페이지 간격
    overall_score: float = 0.0            # 종합 점수
    is_continuation: bool = False         # 연속 표 판정 결과
    
    # 상세 정보
    details: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """딕셔너리로 변환"""
        return {
            "column_match_score": self.column_match_score,
            "position_continuity": self.position_continuity,
            "header_repetition": self.header_repetition,
            "header_similarity": self.header_similarity,
            "data_pattern_match": self.data_pattern_match,
            "page_gap": self.page_gap,
            "overall_score": self.overall_score,
            "is_continuation": self.is_continuation,
            "details": self.details,
        }


@dataclass
class TableCandidate:
    """병합 후보 표 정보"""
    table_index: int                       # 원본 표 인덱스
    page_num: int                          # 페이지 번호
    rows: List[List[str]]                  # 표 데이터
    header_signature: Optional[HeaderSignature] = None
    bbox: Optional[Tuple[float, ...]] = None  # 표 위치 (x0, y0, x1, y1)
    column_widths: List[float] = field(default_factory=list)
    
    # 메타데이터
    row_count: int = 0
    col_count: int = 0
    confidence: float = 0.0
    extraction_method: str = ""


class ContinuityDetector:
    """표 연속성 감지기"""
    
    def __init__(self, config: CrossPageMergeConfig = None):
        self.config = config or CrossPageMergeConfig()
        self.header_analyzer = HeaderAnalyzer(config)
    
    def detect_continuity(
        self,
        table1: TableCandidate,
        table2: TableCandidate,
        page_height: float = None
    ) -> TableContinuityScore:
        """
        두 표의 연속성 감지
        
        Args:
            table1: 이전 페이지의 표
            table2: 다음 페이지의 표
            page_height: 페이지 높이 (위치 분석용)
            
        Returns:
            TableContinuityScore: 연속성 점수
        """
        score = TableContinuityScore()
        
        # 1. 페이지 간격 확인
        score.page_gap = abs(table2.page_num - table1.page_num)
        if score.page_gap > self.config.max_merge_gap_pages + 1:
            score.details["rejection_reason"] = "페이지 간격 초과"
            return score
        
        # 2. 열 구조 일치도
        score.column_match_score = self._calculate_column_match(table1, table2)
        
        # 3. 헤더 분석
        if table1.header_signature is None:
            table1.header_signature = self.header_analyzer.extract_header_signature(
                table1.rows, table1.column_widths
            )
        if table2.header_signature is None:
            table2.header_signature = self.header_analyzer.extract_header_signature(
                table2.rows, table2.column_widths
            )
        
        score.header_similarity, header_details = self.header_analyzer.compare_signatures(
            table1.header_signature, table2.header_signature
        )
        score.details["header_comparison"] = header_details
        
        # 4. 헤더 반복 감지
        score.header_repetition = self._detect_header_repetition(table1, table2)
        
        # 5. 위치 연속성 (bbox 정보가 있는 경우)
        if table1.bbox and table2.bbox and page_height:
            score.position_continuity = self._calculate_position_continuity(
                table1.bbox, table2.bbox, page_height
            )
        else:
            score.position_continuity = 0.5  # 위치 정보 없으면 중립값
        
        # 6. 데이터 패턴 일치도
        if self.config.enable_data_pattern_analysis:
            score.data_pattern_match = self._analyze_data_patterns(table1, table2)
        
        # 7. 종합 점수 계산
        score.overall_score = self._calculate_overall_score(score)
        
        # 8. 연속 표 판정
        score.is_continuation = self._judge_continuation(score)
        
        return score
    
    def _calculate_column_match(
        self,
        table1: TableCandidate,
        table2: TableCandidate
    ) -> float:
        """열 구조 일치도 계산"""
        if not table1.rows or not table2.rows:
            return 0.0
        
        col1 = len(table1.rows[0]) if table1.rows else 0
        col2 = len(table2.rows[0]) if table2.rows else 0
        
        if col1 == 0 or col2 == 0:
            return 0.0
        
        # 열 개수 일치도
        count_score = min(col1, col2) / max(col1, col2)
        
        # 열 너비 비율 일치도 (있는 경우)
        if table1.column_widths and table2.column_widths:
            width_score = self._compare_column_widths(
                table1.column_widths, table2.column_widths
            )
            return count_score * 0.6 + width_score * 0.4
        
        return count_score
    
    def _compare_column_widths(
        self,
        widths1: List[float],
        widths2: List[float]
    ) -> float:
        """열 너비 비교"""
        if len(widths1) != len(widths2):
            min_len = min(len(widths1), len(widths2))
            widths1 = widths1[:min_len]
            widths2 = widths2[:min_len]
        
        if not widths1:
            return 0.0
        
        # 비율로 정규화
        total1 = sum(widths1) or 1
        total2 = sum(widths2) or 1
        ratios1 = [w / total1 for w in widths1]
        ratios2 = [w / total2 for w in widths2]
        
        # 비율 차이 계산
        tolerance = self.config.min_width_ratio_tolerance
        matches = 0
        
        for r1, r2 in zip(ratios1, ratios2):
            diff = abs(r1 - r2)
            if diff <= tolerance:
                matches += 1 - (diff / tolerance)
        
        return matches / len(ratios1)
    
    def _detect_header_repetition(
        self,
        table1: TableCandidate,
        table2: TableCandidate
    ) -> bool:
        """table2의 첫 행이 table1의 헤더와 동일한지 확인"""
        if not table1.rows or not table2.rows:
            return False
        
        if not table1.header_signature or not table1.header_signature.raw_header_rows:
            return False
        
        # table2의 첫 몇 행과 table1의 헤더 비교
        header_rows = table1.header_signature.raw_header_rows
        
        for i, header_row in enumerate(header_rows):
            if i >= len(table2.rows):
                break
            
            table2_row = table2.rows[i]
            
            # 행 비교 (정규화된 텍스트)
            if self._rows_match(header_row, table2_row):
                return True
        
        return False
    
    def _rows_match(self, row1: List[str], row2: List[str]) -> bool:
        """두 행이 일치하는지 확인"""
        if len(row1) != len(row2):
            return False
        
        matches = 0
        for c1, c2 in zip(row1, row2):
            # 정규화된 비교
            n1 = self._normalize_cell(c1)
            n2 = self._normalize_cell(c2)
            
            if n1 == n2:
                matches += 1
            elif n1 and n2:
                # 부분 일치 확인
                from difflib import SequenceMatcher
                ratio = SequenceMatcher(None, n1, n2).ratio()
                if ratio >= 0.9:
                    matches += 1
        
        return matches >= len(row1) * 0.9
    
    def _normalize_cell(self, text: str) -> str:
        """셀 텍스트 정규화"""
        if not text:
            return ""
        text = str(text).strip()
        text = re.sub(r'\s+', '', text)
        return text.lower()
    
    def _calculate_position_continuity(
        self,
        bbox1: Tuple[float, ...],
        bbox2: Tuple[float, ...],
        page_height: float
    ) -> float:
        """
        위치 기반 연속성 계산
        
        table1이 페이지 하단에 있고, table2가 페이지 상단에 있으면 연속 가능성 높음
        """
        if not bbox1 or not bbox2 or not page_height:
            return 0.5
        
        x0_1, y0_1, x1_1, y1_1 = bbox1[:4]
        x0_2, y0_2, x1_2, y1_2 = bbox2[:4]
        
        score = 0.0
        
        # 1. table1이 페이지 하단에 있는지 (y1이 페이지 높이의 85% 이상)
        bottom_threshold = page_height * self.config.pdf_page_bottom_threshold
        if y1_1 >= bottom_threshold:
            score += 0.4
        
        # 2. table2가 페이지 상단에 있는지 (y0이 페이지 높이의 15% 이하)
        top_threshold = page_height * self.config.pdf_page_top_threshold
        if y0_2 <= top_threshold:
            score += 0.4
        
        # 3. 수평 위치(x) 일치도
        x_overlap = min(x1_1, x1_2) - max(x0_1, x0_2)
        x_union = max(x1_1, x1_2) - min(x0_1, x0_2)
        if x_union > 0:
            x_ratio = x_overlap / x_union
            score += x_ratio * 0.2
        
        return min(score, 1.0)
    
    def _analyze_data_patterns(
        self,
        table1: TableCandidate,
        table2: TableCandidate
    ) -> float:
        """
        데이터 패턴 분석
        
        각 열의 데이터 유형, 형식 패턴 등을 비교하여 일치도 계산
        """
        if not table1.rows or not table2.rows:
            return 0.0
        
        # 데이터 행만 추출 (헤더 제외)
        data1 = self._get_data_rows(table1)
        data2 = self._get_data_rows(table2)
        
        if not data1 or not data2:
            return 0.5  # 데이터 없으면 중립값
        
        col_count = min(len(data1[0]), len(data2[0]))
        if col_count == 0:
            return 0.0
        
        # 각 열별 데이터 패턴 비교
        pattern_scores = []
        
        for col_idx in range(col_count):
            col_data1 = [row[col_idx] for row in data1 if col_idx < len(row)]
            col_data2 = [row[col_idx] for row in data2 if col_idx < len(row)]
            
            pattern1 = self._detect_column_pattern(col_data1)
            pattern2 = self._detect_column_pattern(col_data2)
            
            if pattern1 == pattern2:
                pattern_scores.append(1.0)
            elif pattern1["type"] == pattern2["type"]:
                pattern_scores.append(0.7)
            else:
                pattern_scores.append(0.0)
        
        return sum(pattern_scores) / len(pattern_scores) if pattern_scores else 0.0
    
    def _get_data_rows(self, table: TableCandidate) -> List[List[str]]:
        """헤더를 제외한 데이터 행 추출"""
        if not table.rows:
            return []
        
        header_depth = 1
        if table.header_signature:
            header_depth = table.header_signature.nested_header_depth
        
        return table.rows[header_depth:]
    
    def _detect_column_pattern(self, col_data: List[str]) -> Dict[str, Any]:
        """열의 데이터 패턴 감지"""
        if not col_data:
            return {"type": "empty"}
        
        numeric_count = 0
        text_count = 0
        date_count = 0
        percentage_count = 0
        
        for cell in col_data:
            cell = str(cell).strip()
            if not cell:
                continue
            
            # 퍼센트
            if re.match(r'^[\d,.]+\s*%$', cell):
                percentage_count += 1
            # 숫자 (정수, 소수, 천단위 구분)
            elif re.match(r'^[\d,.\-+]+$', cell):
                numeric_count += 1
            # 날짜 패턴
            elif re.match(r'^\d{4}[-/년]\d{1,2}[-/월]?\d{0,2}', cell):
                date_count += 1
            else:
                text_count += 1
        
        total = numeric_count + text_count + date_count + percentage_count
        if total == 0:
            return {"type": "empty"}
        
        # 가장 많은 유형 결정
        if percentage_count / total > 0.5:
            return {"type": "percentage", "ratio": percentage_count / total}
        elif numeric_count / total > 0.5:
            return {"type": "numeric", "ratio": numeric_count / total}
        elif date_count / total > 0.5:
            return {"type": "date", "ratio": date_count / total}
        else:
            return {"type": "text", "ratio": text_count / total}
    
    def _calculate_overall_score(self, score: TableContinuityScore) -> float:
        """종합 점수 계산"""
        weights = {
            "column_match": 0.30,
            "header_similarity": 0.25,
            "position": 0.20,
            "data_pattern": 0.15,
            "header_repetition": 0.10,
        }
        
        overall = (
            score.column_match_score * weights["column_match"] +
            score.header_similarity * weights["header_similarity"] +
            score.position_continuity * weights["position"] +
            score.data_pattern_match * weights["data_pattern"] +
            (1.0 if score.header_repetition else 0.0) * weights["header_repetition"]
        )
        
        # 페이지 간격 패널티
        if score.page_gap > 1:
            overall *= 0.9 ** (score.page_gap - 1)
        
        return overall
    
    def _judge_continuation(self, score: TableContinuityScore) -> bool:
        """연속 표 여부 최종 판정"""
        # 필수 조건: 열 구조 최소 일치도
        if score.column_match_score < self.config.min_column_match_threshold:
            score.details["rejection_reason"] = "열 구조 불일치"
            return False
        
        # 종합 점수 기준
        if score.overall_score >= self.config.merge_confidence_threshold:
            return True
        
        # 헤더 반복이 감지되면 임계값 낮춤
        if score.header_repetition and score.overall_score >= self.config.merge_confidence_threshold * 0.85:
            return True
        
        # Cross-page 표 특성 처리:
        # 열 구조가 완벽하게 일치하고 (>=0.95), 데이터 패턴도 유사하면 (>=0.50)
        # 헤더 유사도가 낮더라도 연속으로 판정
        # (연속 페이지에서 헤더 없이 데이터만 이어지는 경우)
        if (score.column_match_score >= 0.95 and 
            score.data_pattern_match >= 0.50 and 
            score.page_gap == 1):
            # 완화된 임계값 적용 (기본 임계값의 85%)
            relaxed_threshold = self.config.merge_confidence_threshold * 0.85
            if score.overall_score >= relaxed_threshold:
                score.details["continuation_reason"] = "열 구조 완벽 일치 + 데이터 패턴 유사 (Cross-page 표)"
                return True
        
        score.details["rejection_reason"] = f"종합 점수 부족 ({score.overall_score:.2f})"
        return False
    
    def find_continuation_chains(
        self,
        tables: List[TableCandidate],
        page_height: float = None
    ) -> List[List[int]]:
        """
        연속된 표 체인 찾기
        
        Args:
            tables: 전체 표 목록 (페이지 순서대로)
            page_height: 페이지 높이
            
        Returns:
            List[List[int]]: 연속된 표 인덱스 그룹 목록
            예: [[0, 1, 2], [5, 6]] - 표 0,1,2가 연속, 표 5,6이 연속
        """
        if len(tables) < 2:
            return [[i] for i in range(len(tables))]
        
        # 표를 페이지 순서로 정렬
        sorted_tables = sorted(tables, key=lambda t: (t.page_num, t.table_index))
        
        chains = []
        current_chain = [0]
        
        for i in range(1, len(sorted_tables)):
            prev_table = sorted_tables[current_chain[-1]]
            curr_table = sorted_tables[i]
            
            score = self.detect_continuity(prev_table, curr_table, page_height)
            
            if score.is_continuation:
                current_chain.append(i)
            else:
                chains.append(current_chain)
                current_chain = [i]
        
        chains.append(current_chain)
        
        return chains
