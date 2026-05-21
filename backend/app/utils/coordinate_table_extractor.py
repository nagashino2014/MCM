# -*- coding: utf-8 -*-
"""
좌표 기반 PDF 테이블 추출기

pdfplumber의 기본 테이블 추출이 실패하는 경우를 위한 
저수준 좌표 기반 테이블 재구성 모듈

주요 기능:
1. 테이블 영역 내 단어들의 좌표 추출
2. y 좌표 기반 행 그룹화
3. x 좌표 기반 열 그룹화
4. 셀 병합 감지 및 처리
5. 마크다운 테이블 생성
"""

import re
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass, field
from collections import defaultdict
import statistics


@dataclass
class WordInfo:
    """단어 정보"""
    text: str
    x0: float  # 왼쪽 x 좌표
    y0: float  # 위쪽 y 좌표 (PDF는 아래가 0)
    x1: float  # 오른쪽 x 좌표
    y1: float  # 아래쪽 y 좌표
    
    @property
    def center_x(self) -> float:
        return (self.x0 + self.x1) / 2
    
    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2
    
    @property
    def width(self) -> float:
        return self.x1 - self.x0
    
    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass
class CellInfo:
    """셀 정보"""
    row_idx: int
    col_idx: int
    words: List[WordInfo] = field(default_factory=list)
    x0: float = 0
    y0: float = 0
    x1: float = 0
    y1: float = 0
    
    @property
    def text(self) -> str:
        """셀 내 단어들을 공백으로 연결"""
        # x 좌표 순으로 정렬하여 텍스트 생성
        sorted_words = sorted(self.words, key=lambda w: (w.y0, w.x0))
        return ' '.join(w.text for w in sorted_words)


@dataclass
class TableInfo:
    """테이블 정보"""
    bbox: Tuple[float, float, float, float]  # (x0, y0, x1, y1)
    cells: List[List[CellInfo]] = field(default_factory=list)
    row_boundaries: List[float] = field(default_factory=list)  # y 좌표 경계
    col_boundaries: List[float] = field(default_factory=list)  # x 좌표 경계


class CoordinateTableExtractor:
    """
    좌표 기반 PDF 테이블 추출기
    
    pdfplumber의 기본 추출이 실패하는 복잡한 표를 처리합니다.
    """
    
    def __init__(
        self,
        row_tolerance: float = 5.0,      # 같은 행으로 간주할 y 좌표 허용 오차
        col_tolerance: float = 10.0,     # 같은 열로 간주할 x 좌표 허용 오차
        min_row_gap: float = 3.0,        # 최소 행 간격
        min_col_gap: float = 5.0,        # 최소 열 간격
        merge_threshold: float = 0.8,    # 셀 병합 감지 임계값
        verbose: bool = False
    ):
        self.row_tolerance = row_tolerance
        self.col_tolerance = col_tolerance
        self.min_row_gap = min_row_gap
        self.min_col_gap = min_col_gap
        self.merge_threshold = merge_threshold
        self.verbose = verbose
    
    def extract_table_with_coordinates(
        self,
        plumber_page,
        table_bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> Optional[TableInfo]:
        """
        좌표 기반으로 테이블 추출
        
        Args:
            plumber_page: pdfplumber page 객체
            table_bbox: 테이블 영역 (x0, y0, x1, y1), None이면 전체 페이지
            
        Returns:
            TableInfo: 추출된 테이블 정보
        """
        print(f"[COORD DEBUG] extract_table_with_coordinates 시작 - bbox: {table_bbox}")
        
        # 1. 단어 추출
        words = self._extract_words(plumber_page, table_bbox)
        
        if not words:
            print(f"[COORD DEBUG] 단어 추출 실패 - 추출된 단어 없음")
            return None
        
        print(f"[COORD DEBUG] 추출된 단어 수: {len(words)}")
        # 처음 5개 단어 샘플 출력
        for i, w in enumerate(words[:5]):
            print(f"[COORD DEBUG]   단어 {i}: '{w.text}' @ ({w.x0:.1f}, {w.y0:.1f}) - ({w.x1:.1f}, {w.y1:.1f})")
        
        if self.verbose:
            print(f"[COORD] 추출된 단어 수: {len(words)}")
        
        # 2. y 좌표 기반 행 그룹화
        row_groups = self._group_words_by_row(words)
        
        print(f"[COORD DEBUG] 행 그룹화 결과: {len(row_groups)}개 행")
        for i, group in enumerate(row_groups[:5]):  # 처음 5개 행만
            group_texts = [w.text for w in group[:5]]  # 각 행의 처음 5개 단어만
            print(f"[COORD DEBUG]   행 {i}: {len(group)}단어 - {group_texts}...")
        
        if self.verbose:
            print(f"[COORD] 감지된 행 수: {len(row_groups)}")
        
        # 3. x 좌표 기반 열 경계 감지
        col_boundaries = self._detect_column_boundaries(words, row_groups)
        
        print(f"[COORD DEBUG] 열 경계: {len(col_boundaries)-1}개 열")
        print(f"[COORD DEBUG]   경계값: {[round(b, 1) for b in col_boundaries[:10]]}...")
        
        if self.verbose:
            print(f"[COORD] 감지된 열 수: {len(col_boundaries) - 1}")
        
        # 4. 셀 구성
        cells = self._construct_cells(row_groups, col_boundaries)
        
        print(f"[COORD DEBUG] 셀 구성 완료: {len(cells)}행")
        
        # 5. TableInfo 생성
        if table_bbox is None:
            table_bbox = (
                min(w.x0 for w in words),
                min(w.y0 for w in words),
                max(w.x1 for w in words),
                max(w.y1 for w in words)
            )
        
        row_boundaries = [min(w.y0 for w in group) for group in row_groups]
        row_boundaries.append(max(w.y1 for group in row_groups for w in group))
        
        return TableInfo(
            bbox=table_bbox,
            cells=cells,
            row_boundaries=sorted(row_boundaries),
            col_boundaries=col_boundaries
        )
    
    def _extract_words(
        self,
        plumber_page,
        bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> List[WordInfo]:
        """페이지에서 단어와 좌표 추출"""
        words = []
        
        try:
            # pdfplumber의 extract_words() 사용
            raw_words = plumber_page.extract_words(
                keep_blank_chars=False,
                x_tolerance=3,
                y_tolerance=3,
                extra_attrs=['fontname', 'size']
            )
            
            for w in raw_words:
                x0 = float(w['x0'])
                y0 = float(w['top'])
                x1 = float(w['x1'])
                y1 = float(w['bottom'])
                text = w['text'].strip()
                
                if not text:
                    continue
                
                # bbox 필터링
                if bbox:
                    bx0, by0, bx1, by1 = bbox
                    # 단어가 bbox 내에 있는지 확인
                    if x0 < bx0 or x1 > bx1 or y0 < by0 or y1 > by1:
                        continue
                
                words.append(WordInfo(
                    text=text,
                    x0=x0, y0=y0, x1=x1, y1=y1
                ))
        except Exception as e:
            if self.verbose:
                print(f"[COORD ERROR] 단어 추출 실패: {e}")
        
        return words
    
    def _group_words_by_row(self, words: List[WordInfo]) -> List[List[WordInfo]]:
        """
        y 좌표 기반으로 단어들을 행으로 그룹화
        
        클러스터링 알고리즘 사용:
        1. y 좌표로 정렬
        2. 인접한 단어들의 y 좌표 차이가 tolerance 이내면 같은 행
        """
        if not words:
            return []
        
        # y 좌표로 정렬
        sorted_words = sorted(words, key=lambda w: w.y0)
        
        # 행 그룹화
        rows = []
        current_row = [sorted_words[0]]
        current_y = sorted_words[0].y0
        
        for word in sorted_words[1:]:
            # y 좌표 차이 계산
            y_diff = abs(word.y0 - current_y)
            
            if y_diff <= self.row_tolerance:
                # 같은 행
                current_row.append(word)
            else:
                # 새로운 행
                if current_row:
                    rows.append(current_row)
                current_row = [word]
                current_y = word.y0
        
        # 마지막 행 추가
        if current_row:
            rows.append(current_row)
        
        # 각 행 내에서 x 좌표로 정렬
        for row in rows:
            row.sort(key=lambda w: w.x0)
        
        return rows
    
    def _detect_column_boundaries(
        self,
        words: List[WordInfo],
        row_groups: List[List[WordInfo]]
    ) -> List[float]:
        """
        x 좌표 기반으로 열 경계 감지
        
        전략:
        1. 모든 단어의 x0, x1 좌표 수집
        2. 빈 공간(gap) 분석으로 열 구분선 추정
        3. 열 경계 좌표 반환
        """
        if not words:
            return []
        
        # 전체 x 범위
        min_x = min(w.x0 for w in words)
        max_x = max(w.x1 for w in words)
        
        # 각 행에서 단어 사이의 gap 분석
        all_gaps = []
        
        for row in row_groups:
            if len(row) < 2:
                continue
            
            # 행 내에서 인접 단어 사이의 gap
            for i in range(len(row) - 1):
                gap_start = row[i].x1
                gap_end = row[i + 1].x0
                gap_size = gap_end - gap_start
                
                if gap_size > self.min_col_gap:
                    gap_center = (gap_start + gap_end) / 2
                    all_gaps.append((gap_center, gap_size))
        
        if not all_gaps:
            # gap이 없으면 단일 열로 처리
            return [min_x, max_x]
        
        # gap 위치들을 클러스터링하여 열 경계 결정
        gap_positions = [g[0] for g in all_gaps]
        col_boundaries = self._cluster_boundaries(gap_positions, self.col_tolerance)
        
        # 시작과 끝 경계 추가
        boundaries = [min_x] + sorted(col_boundaries) + [max_x]
        
        return boundaries
    
    def _cluster_boundaries(
        self,
        positions: List[float],
        tolerance: float
    ) -> List[float]:
        """
        비슷한 위치들을 클러스터링하여 대표값 반환
        """
        if not positions:
            return []
        
        sorted_pos = sorted(positions)
        clusters = []
        current_cluster = [sorted_pos[0]]
        
        for pos in sorted_pos[1:]:
            if pos - current_cluster[-1] <= tolerance:
                current_cluster.append(pos)
            else:
                # 클러스터 완료 - 중앙값 사용
                clusters.append(statistics.median(current_cluster))
                current_cluster = [pos]
        
        # 마지막 클러스터
        if current_cluster:
            clusters.append(statistics.median(current_cluster))
        
        return clusters
    
    def _construct_cells(
        self,
        row_groups: List[List[WordInfo]],
        col_boundaries: List[float]
    ) -> List[List[CellInfo]]:
        """
        행 그룹과 열 경계를 사용하여 셀 구성
        """
        if not row_groups or len(col_boundaries) < 2:
            return []
        
        num_cols = len(col_boundaries) - 1
        cells = []
        
        for row_idx, row_words in enumerate(row_groups):
            row_cells = []
            
            for col_idx in range(num_cols):
                col_start = col_boundaries[col_idx]
                col_end = col_boundaries[col_idx + 1]
                
                # 이 열에 속하는 단어들 찾기
                cell_words = []
                for word in row_words:
                    word_center = word.center_x
                    # 단어 중심이 열 범위 내에 있으면 해당 열에 배치
                    if col_start <= word_center < col_end:
                        cell_words.append(word)
                
                cell = CellInfo(
                    row_idx=row_idx,
                    col_idx=col_idx,
                    words=cell_words,
                    x0=col_start,
                    y0=min(w.y0 for w in row_words) if row_words else 0,
                    x1=col_end,
                    y1=max(w.y1 for w in row_words) if row_words else 0
                )
                row_cells.append(cell)
            
            cells.append(row_cells)
        
        return cells
    
    def table_to_markdown(self, table_info: TableInfo) -> str:
        """
        TableInfo를 마크다운 테이블로 변환
        """
        if not table_info.cells:
            return ""
        
        lines = []
        num_cols = len(table_info.cells[0]) if table_info.cells else 0
        
        for row_idx, row_cells in enumerate(table_info.cells):
            cell_texts = []
            for cell in row_cells:
                text = cell.text.strip()
                # 파이프 이스케이프
                text = text.replace('|', '\\|')
                cell_texts.append(text)
            
            # 열 수 맞춤
            while len(cell_texts) < num_cols:
                cell_texts.append('')
            
            lines.append('| ' + ' | '.join(cell_texts) + ' |')
            
            # 첫 번째 행 다음에 구분선 추가
            if row_idx == 0:
                lines.append('|' + '|'.join(['---'] * num_cols) + '|')
        
        return '\n'.join(lines)
    
    def reprocess_collapsed_table(
        self,
        plumber_page,
        original_table_data: List[List[str]],
        table_bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> Optional[str]:
        """
        붕괴된 표(모든 데이터가 하나의 행으로 압축)를 좌표 기반으로 재처리
        
        Args:
            plumber_page: pdfplumber page 객체
            original_table_data: 원래 추출된 표 데이터 (붕괴 상태)
            table_bbox: 테이블 영역
            
        Returns:
            str: 재구성된 마크다운 테이블
        """
        print(f"[COORD DEBUG] reprocess_collapsed_table 호출 - 원본: {len(original_table_data)}행, bbox: {table_bbox}")
        
        # 붕괴 여부 확인 (행이 2개 이하이고 내용이 많은 경우)
        if len(original_table_data) > 3:
            print(f"[COORD DEBUG] 원본이 이미 {len(original_table_data)}행으로 충분함")
            return None  # 이미 충분한 행이 있음
        
        # 좌표 기반 재추출
        table_info = self.extract_table_with_coordinates(plumber_page, table_bbox)
        
        if not table_info or not table_info.cells:
            print(f"[COORD DEBUG] 좌표 기반 추출 실패 - table_info: {table_info is not None}, cells: {len(table_info.cells) if table_info else 0}")
            return None
        
        print(f"[COORD DEBUG] 좌표 기반 추출 완료 - {len(table_info.cells)}행 x {len(table_info.col_boundaries)-1}열")
        
        # 행 수가 원래보다 많으면 좌표 기반 결과 사용
        if len(table_info.cells) > len(original_table_data):
            print(f"[COORD DEBUG] 좌표 기반 결과 채택: {len(original_table_data)}행 → {len(table_info.cells)}행")
            return self.table_to_markdown(table_info)
        
        print(f"[COORD DEBUG] 좌표 기반 결과 거부: 원본({len(original_table_data)}행) >= 좌표({len(table_info.cells)}행)")
        return None


class CollapsedTableReconstructor:
    """
    붕괴된 표 재구성기
    
    pdfplumber가 행을 제대로 분리하지 못한 경우,
    좌표 정보와 텍스트 패턴을 조합하여 재구성
    """
    
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.coord_extractor = CoordinateTableExtractor(verbose=verbose)
    
    def should_reprocess(self, table_data: List[List[str]]) -> bool:
        """
        표가 붕괴되었는지 확인
        
        조건:
        1. 행 수가 3개 이하
        2. 특정 셀에 공백으로 구분된 많은 항목이 있음
        3. 번호 패턴이 연속으로 나열됨 (1 2 3 4...)
        """
        if len(table_data) > 3:
            return False
        
        for row in table_data:
            for cell in row:
                if not cell:
                    continue
                
                # 공백으로 분리된 항목 수 확인
                items = cell.split()
                if len(items) > 10:
                    return True
                
                # 연속 번호 패턴 확인 (1 2 3 4 5...)
                numbers = re.findall(r'\b(\d+)\b', cell)
                if len(numbers) >= 5:
                    # 연속 번호인지 확인
                    try:
                        nums = [int(n) for n in numbers[:10]]
                        if nums == list(range(nums[0], nums[0] + len(nums))):
                            return True
                    except:
                        pass
        
        return False
    
    def reconstruct_with_coordinates(
        self,
        plumber_page,
        table_bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> Optional[str]:
        """
        좌표 기반으로 표 재구성
        """
        table_info = self.coord_extractor.extract_table_with_coordinates(
            plumber_page, table_bbox
        )
        
        if table_info and len(table_info.cells) > 1:
            return self.coord_extractor.table_to_markdown(table_info)
        
        return None
    
    def reconstruct_with_text_patterns(
        self,
        collapsed_row: List[str],
        expected_cols: int = 4
    ) -> Optional[List[List[str]]]:
        """
        텍스트 패턴을 분석하여 표 재구성 (좌표 정보 없이)
        
        전략:
        1. 번호 열에서 행 수 추정
        2. 글머리 기호(•)로 설명 열 분리
        3. 각 열의 항목 수를 맞춤
        """
        if not collapsed_row:
            return None
        
        # 각 열 분석
        col_items = []
        for cell in collapsed_row:
            if not cell:
                col_items.append([])
                continue
            
            # 번호 패턴 분리
            numbers = re.findall(r'\b(\d+)\b', cell)
            if len(numbers) >= 5:
                # 연속 번호 감지
                try:
                    nums = [int(n) for n in numbers]
                    if nums == list(range(nums[0], nums[0] + len(nums))):
                        col_items.append(numbers)
                        continue
                except:
                    pass
            
            # 글머리 기호로 분리
            if '•' in cell:
                items = [item.strip() for item in cell.split('•') if item.strip()]
                col_items.append(items)
                continue
            
            # 공백 기반 분리 (키워드 패턴)
            # 특정 키워드로 끝나는 패턴: "설비", "장치", "시스템", "사업"
            keyword_pattern = r'([가-힣]+(?:설비|장치|시스템|사업|이용|전환|기타))'
            keywords = re.findall(keyword_pattern, cell)
            if len(keywords) >= 3:
                col_items.append(keywords)
                continue
            
            # 그 외는 단일 항목으로 처리
            col_items.append([cell])
        
        # 행 수 결정 (가장 많은 항목을 가진 열 기준)
        if not col_items:
            return None
        
        max_rows = max(len(items) for items in col_items)
        if max_rows <= 1:
            return None
        
        # 행 재구성
        reconstructed = []
        for row_idx in range(max_rows):
            row = []
            for col_items_list in col_items:
                if row_idx < len(col_items_list):
                    row.append(col_items_list[row_idx])
                else:
                    row.append('')
            reconstructed.append(row)
        
        return reconstructed


def create_coordinate_table_extractor(config=None) -> CoordinateTableExtractor:
    """설정 기반 CoordinateTableExtractor 생성"""
    if config is None:
        return CoordinateTableExtractor()
    
    return CoordinateTableExtractor(
        row_tolerance=getattr(config, 'row_tolerance', 5.0),
        col_tolerance=getattr(config, 'col_tolerance', 10.0),
        min_row_gap=getattr(config, 'min_row_gap', 3.0),
        min_col_gap=getattr(config, 'min_col_gap', 5.0),
        verbose=getattr(config, 'verbose', False)
    )
