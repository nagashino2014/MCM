"""
셀 분할기 (Cell Segmentor)

교차점 기반으로 셀 영역을 분할하는 모듈입니다.

주요 기능:
1. 수평/수직 선의 교차점 계산
2. 교차점을 그리드로 정렬 (클러스터링)
3. 인접한 4개 교차점으로 셀 영역 정의
4. 병합 셀 감지 (내부에 구분선이 없는 영역)

사용 예시:
    from app.table_recovery import TableLineDetector, TableCellSegmentor
    
    # 선 검출
    detector = TableLineDetector()
    lines = detector.detect_from_image(image)
    
    # 셀 분할
    segmentor = TableCellSegmentor()
    cells = segmentor.segment_cells(lines.horizontal, lines.vertical)
    merged = segmentor.detect_merged_cells(cells, lines)
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Set, Dict
import math

from .line_detector import Line, TableLines


@dataclass
class CellBbox:
    """
    셀 경계 상자
    
    Attributes:
        row_idx: 행 인덱스 (0-based)
        col_idx: 열 인덱스 (0-based)
        x0: 좌측 x 좌표
        y0: 상단 y 좌표
        x1: 우측 x 좌표
        y1: 하단 y 좌표
    """
    row_idx: int
    col_idx: int
    x0: float
    y0: float
    x1: float
    y1: float
    
    @property
    def width(self) -> float:
        """셀 너비"""
        return self.x1 - self.x0
    
    @property
    def height(self) -> float:
        """셀 높이"""
        return self.y1 - self.y0
    
    @property
    def area(self) -> float:
        """셀 면적"""
        return self.width * self.height
    
    @property
    def center(self) -> Tuple[float, float]:
        """셀 중심점"""
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)
    
    @property
    def bbox(self) -> Tuple[float, float, float, float]:
        """bbox 튜플 반환"""
        return (self.x0, self.y0, self.x1, self.y1)
    
    def contains_point(self, x: float, y: float, margin: float = 0) -> bool:
        """점이 셀 내부에 있는지 확인"""
        return (self.x0 - margin <= x <= self.x1 + margin and 
                self.y0 - margin <= y <= self.y1 + margin)
    
    def overlaps(self, other: 'CellBbox') -> bool:
        """다른 셀과 겹치는지 확인"""
        return not (self.x1 < other.x0 or self.x0 > other.x1 or
                    self.y1 < other.y0 or self.y0 > other.y1)
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'row_idx': self.row_idx,
            'col_idx': self.col_idx,
            'x0': self.x0,
            'y0': self.y0,
            'x1': self.x1,
            'y1': self.y1,
            'width': self.width,
            'height': self.height,
            'center': list(self.center)
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'CellBbox':
        """딕셔너리에서 생성"""
        return cls(
            row_idx=data['row_idx'],
            col_idx=data['col_idx'],
            x0=data['x0'],
            y0=data['y0'],
            x1=data['x1'],
            y1=data['y1']
        )


@dataclass
class MergedCell:
    """
    병합된 셀 정보
    
    Attributes:
        row_start: 시작 행 인덱스
        row_end: 종료 행 인덱스 (포함)
        col_start: 시작 열 인덱스
        col_end: 종료 열 인덱스 (포함)
        bbox: 병합된 셀의 경계 상자
    """
    row_start: int
    row_end: int
    col_start: int
    col_end: int
    bbox: CellBbox
    
    @property
    def rowspan(self) -> int:
        """행 병합 수"""
        return self.row_end - self.row_start + 1
    
    @property
    def colspan(self) -> int:
        """열 병합 수"""
        return self.col_end - self.col_start + 1
    
    @property
    def is_merged(self) -> bool:
        """실제 병합 셀인지 (1x1이 아닌지)"""
        return self.rowspan > 1 or self.colspan > 1
    
    def contains_cell(self, row: int, col: int) -> bool:
        """특정 셀 좌표가 이 병합 셀에 포함되는지"""
        return (self.row_start <= row <= self.row_end and
                self.col_start <= col <= self.col_end)
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'row_span': [self.row_start, self.row_end],
            'col_span': [self.col_start, self.col_end],
            'bbox': [self.bbox.x0, self.bbox.y0, self.bbox.x1, self.bbox.y1],
            'rowspan': self.rowspan,
            'colspan': self.colspan,
            'is_merged': self.is_merged
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'MergedCell':
        """딕셔너리에서 생성"""
        row_span = data['row_span']
        col_span = data['col_span']
        bbox_data = data['bbox']
        
        return cls(
            row_start=row_span[0],
            row_end=row_span[1],
            col_start=col_span[0],
            col_end=col_span[1],
            bbox=CellBbox(
                row_idx=row_span[0],
                col_idx=col_span[0],
                x0=bbox_data[0],
                y0=bbox_data[1],
                x1=bbox_data[2],
                y1=bbox_data[3]
            )
        )


@dataclass
class GridInfo:
    """
    그리드 정보
    
    Attributes:
        x_coords: 수직선 x 좌표 목록 (정렬됨)
        y_coords: 수평선 y 좌표 목록 (정렬됨)
        intersections: 교차점 목록
    """
    x_coords: List[float] = field(default_factory=list)
    y_coords: List[float] = field(default_factory=list)
    intersections: List[Tuple[float, float]] = field(default_factory=list)
    
    @property
    def row_count(self) -> int:
        """행 수"""
        return max(0, len(self.y_coords) - 1)
    
    @property
    def col_count(self) -> int:
        """열 수"""
        return max(0, len(self.x_coords) - 1)
    
    @property
    def cell_count(self) -> int:
        """총 셀 수"""
        return self.row_count * self.col_count
    
    def get_row_heights(self) -> List[float]:
        """각 행의 높이"""
        if len(self.y_coords) < 2:
            return []
        return [self.y_coords[i+1] - self.y_coords[i] 
                for i in range(len(self.y_coords) - 1)]
    
    def get_col_widths(self) -> List[float]:
        """각 열의 너비"""
        if len(self.x_coords) < 2:
            return []
        return [self.x_coords[i+1] - self.x_coords[i] 
                for i in range(len(self.x_coords) - 1)]


@dataclass
class SegmentorConfig:
    """
    셀 분할기 설정
    
    Attributes:
        intersection_tolerance: 교차점 클러스터링 허용 오차
        coordinate_tolerance: 좌표 클러스터링 허용 오차
        min_cell_width: 최소 셀 너비
        min_cell_height: 최소 셀 높이
        merge_detection_margin: 병합 셀 감지 여유 (선 두께 고려)
    """
    intersection_tolerance: float = 5.0
    coordinate_tolerance: float = 5.0
    min_cell_width: float = 10.0
    min_cell_height: float = 10.0
    merge_detection_margin: float = 3.0


class TableCellSegmentor:
    """
    교차점 기반 셀 영역 분할기
    
    수평선과 수직선의 교차점을 분석하여 테이블의 셀 영역을 구획합니다.
    
    사용 예시:
        segmentor = TableCellSegmentor()
        
        # 기본 셀 분할
        cells = segmentor.segment_cells(h_lines, v_lines)
        
        # 병합 셀 감지
        merged = segmentor.detect_merged_cells(cells, table_lines)
        
        # 그리드 정보 추출
        grid = segmentor.extract_grid_info(h_lines, v_lines)
    """
    
    def __init__(self, config: Optional[SegmentorConfig] = None):
        """
        Args:
            config: 분할기 설정 (None이면 기본값 사용)
        """
        self.config = config or SegmentorConfig()
    
    def segment_cells(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> List[CellBbox]:
        """
        수평/수직 선의 교차점으로 셀 영역 계산
        
        알고리즘:
        1. 모든 교차점 계산
        2. 교차점들을 그리드로 정렬 (클러스터링)
        3. 인접한 4개 교차점으로 셀 영역 정의
        
        Args:
            h_lines: 수평선 목록
            v_lines: 수직선 목록
            
        Returns:
            List[CellBbox]: 셀 경계 상자 목록
        """
        # 1. 교차점 계산
        intersections = self._find_intersections(h_lines, v_lines)
        
        if len(intersections) < 4:
            return []
        
        # 2. 좌표 클러스터링 및 정렬
        grid_x = self._cluster_coordinates([p[0] for p in intersections])
        grid_y = self._cluster_coordinates([p[1] for p in intersections])
        
        if len(grid_x) < 2 or len(grid_y) < 2:
            return []
        
        # 3. 셀 생성
        cells = []
        for row_idx in range(len(grid_y) - 1):
            for col_idx in range(len(grid_x) - 1):
                cell = CellBbox(
                    row_idx=row_idx,
                    col_idx=col_idx,
                    x0=grid_x[col_idx],
                    y0=grid_y[row_idx],
                    x1=grid_x[col_idx + 1],
                    y1=grid_y[row_idx + 1]
                )
                
                # 최소 크기 필터링
                if (cell.width >= self.config.min_cell_width and 
                    cell.height >= self.config.min_cell_height):
                    cells.append(cell)
        
        return cells
    
    def segment_from_table_lines(self, lines: TableLines) -> List[CellBbox]:
        """
        TableLines 객체에서 직접 셀 분할
        
        Args:
            lines: 테이블 선 정보
            
        Returns:
            List[CellBbox]: 셀 경계 상자 목록
        """
        return self.segment_cells(lines.horizontal, lines.vertical)
    
    def extract_grid_info(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> GridInfo:
        """
        그리드 정보 추출
        
        Args:
            h_lines: 수평선 목록
            v_lines: 수직선 목록
            
        Returns:
            GridInfo: 그리드 좌표 및 교차점 정보
        """
        intersections = self._find_intersections(h_lines, v_lines)
        
        x_coords = self._cluster_coordinates([p[0] for p in intersections])
        y_coords = self._cluster_coordinates([p[1] for p in intersections])
        
        return GridInfo(
            x_coords=x_coords,
            y_coords=y_coords,
            intersections=intersections
        )
    
    def detect_merged_cells(
        self, 
        cells: List[CellBbox], 
        lines: TableLines
    ) -> List[MergedCell]:
        """
        병합 셀 감지
        
        조건: 내부에 구분선이 없는 연속된 셀 영역
        
        알고리즘:
        1. 각 셀에 대해 오른쪽/아래쪽으로 확장 시도
        2. 확장 가능 조건: 경계에 구분선이 없음
        3. 확장된 영역을 병합 셀로 기록
        
        Args:
            cells: 기본 셀 목록
            lines: 테이블 구분선 정보
            
        Returns:
            List[MergedCell]: 병합 셀 목록 (1x1 셀 포함)
        """
        if not cells:
            return []
        
        # 셀 맵 생성 (빠른 조회용)
        cell_map: Dict[Tuple[int, int], CellBbox] = {}
        for cell in cells:
            cell_map[(cell.row_idx, cell.col_idx)] = cell
        
        # 최대 행/열 인덱스
        max_row = max(c.row_idx for c in cells)
        max_col = max(c.col_idx for c in cells)
        
        merged_cells = []
        visited: Set[Tuple[int, int]] = set()
        
        # 행/열 순서대로 순회
        for row in range(max_row + 1):
            for col in range(max_col + 1):
                key = (row, col)
                if key in visited or key not in cell_map:
                    continue
                
                cell = cell_map[key]
                
                # 오른쪽/아래로 확장 시도
                row_end, col_end = self._expand_merged_region(
                    cell, cell_map, lines, max_row, max_col
                )
                
                # 병합 영역의 모든 셀 마킹
                for r in range(row, row_end + 1):
                    for c in range(col, col_end + 1):
                        visited.add((r, c))
                
                # 병합 셀 bbox 계산
                merged_bbox = self._calculate_merged_bbox(
                    row, row_end, col, col_end, cell_map
                )
                
                if merged_bbox:
                    merged_cells.append(MergedCell(
                        row_start=row,
                        row_end=row_end,
                        col_start=col,
                        col_end=col_end,
                        bbox=merged_bbox
                    ))
        
        return merged_cells
    
    def get_cell_at_position(
        self, 
        cells: List[CellBbox], 
        x: float, 
        y: float
    ) -> Optional[CellBbox]:
        """
        특정 좌표에 해당하는 셀 찾기
        
        Args:
            cells: 셀 목록
            x: x 좌표
            y: y 좌표
            
        Returns:
            해당 위치의 셀 또는 None
        """
        for cell in cells:
            if cell.contains_point(x, y):
                return cell
        return None
    
    def get_cell_by_index(
        self, 
        cells: List[CellBbox], 
        row: int, 
        col: int
    ) -> Optional[CellBbox]:
        """
        행/열 인덱스로 셀 찾기
        
        Args:
            cells: 셀 목록
            row: 행 인덱스
            col: 열 인덱스
            
        Returns:
            해당 인덱스의 셀 또는 None
        """
        for cell in cells:
            if cell.row_idx == row and cell.col_idx == col:
                return cell
        return None
    
    # ==================== 내부 메서드 ====================
    
    def _find_intersections(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> List[Tuple[float, float]]:
        """모든 교차점 찾기"""
        intersections = []
        
        for h_line in h_lines:
            h_y = h_line.position  # 수평선의 y 좌표
            h_x_min, h_x_max = h_line.span
            
            for v_line in v_lines:
                v_x = v_line.position  # 수직선의 x 좌표
                v_y_min, v_y_max = v_line.span
                
                # 교차 여부 확인
                if (h_x_min <= v_x <= h_x_max and 
                    v_y_min <= h_y <= v_y_max):
                    intersections.append((v_x, h_y))
        
        return intersections
    
    def _cluster_coordinates(self, coords: List[float]) -> List[float]:
        """
        좌표 클러스터링 및 정렬
        
        비슷한 좌표를 그룹화하여 평균값으로 대체
        """
        if not coords:
            return []
        
        tolerance = self.config.coordinate_tolerance
        coords = sorted(set(coords))
        
        if len(coords) == 1:
            return coords
        
        clusters = []
        current_cluster = [coords[0]]
        
        for coord in coords[1:]:
            if coord - current_cluster[-1] <= tolerance:
                current_cluster.append(coord)
            else:
                # 클러스터 평균으로 대체
                clusters.append(sum(current_cluster) / len(current_cluster))
                current_cluster = [coord]
        
        if current_cluster:
            clusters.append(sum(current_cluster) / len(current_cluster))
        
        return clusters
    
    def _expand_merged_region(
        self,
        start_cell: CellBbox,
        cell_map: Dict[Tuple[int, int], CellBbox],
        lines: TableLines,
        max_row: int,
        max_col: int
    ) -> Tuple[int, int]:
        """
        병합 영역 확장
        
        Returns:
            (row_end, col_end): 확장된 영역의 종료 인덱스
        """
        row_start = start_cell.row_idx
        col_start = start_cell.col_idx
        row_end = row_start
        col_end = col_start
        
        # 오른쪽으로 확장
        while col_end < max_col:
            if self._can_merge_right(start_cell, col_end, cell_map, lines):
                col_end += 1
            else:
                break
        
        # 아래쪽으로 확장 (오른쪽 확장 범위 전체가 아래로 확장 가능해야 함)
        while row_end < max_row:
            can_expand_down = True
            for c in range(col_start, col_end + 1):
                if not self._can_merge_down(row_start, row_end, c, cell_map, lines):
                    can_expand_down = False
                    break
            
            if can_expand_down:
                row_end += 1
            else:
                break
        
        return row_end, col_end
    
    def _can_merge_right(
        self, 
        start_cell: CellBbox, 
        current_col: int,
        cell_map: Dict[Tuple[int, int], CellBbox], 
        lines: TableLines
    ) -> bool:
        """오른쪽 셀과 병합 가능 여부"""
        # 오른쪽 셀이 존재하는지 확인
        right_key = (start_cell.row_idx, current_col + 1)
        if right_key not in cell_map:
            return False
        
        # 현재 셀의 오른쪽 경계
        current_cell = cell_map.get((start_cell.row_idx, current_col))
        if not current_cell:
            return False
        
        right_x = current_cell.x1
        margin = self.config.merge_detection_margin
        
        # 해당 x 좌표에 수직선이 있는지 확인
        for v_line in lines.vertical:
            if abs(v_line.position - right_x) < margin:
                # 선이 셀 영역과 겹치는지 확인
                v_y_min, v_y_max = v_line.span
                
                if (v_y_min <= current_cell.y0 + margin and 
                    v_y_max >= current_cell.y1 - margin):
                    return False  # 구분선 있음 → 병합 불가
        
        return True
    
    def _can_merge_down(
        self, 
        row_start: int,
        current_row: int,
        col: int,
        cell_map: Dict[Tuple[int, int], CellBbox], 
        lines: TableLines
    ) -> bool:
        """아래쪽 셀과 병합 가능 여부"""
        # 아래쪽 셀이 존재하는지 확인
        down_key = (current_row + 1, col)
        if down_key not in cell_map:
            return False
        
        # 현재 셀의 아래쪽 경계
        current_cell = cell_map.get((current_row, col))
        if not current_cell:
            return False
        
        bottom_y = current_cell.y1
        margin = self.config.merge_detection_margin
        
        # 해당 y 좌표에 수평선이 있는지 확인
        for h_line in lines.horizontal:
            if abs(h_line.position - bottom_y) < margin:
                # 선이 셀 영역과 겹치는지 확인
                h_x_min, h_x_max = h_line.span
                
                if (h_x_min <= current_cell.x0 + margin and 
                    h_x_max >= current_cell.x1 - margin):
                    return False  # 구분선 있음 → 병합 불가
        
        return True
    
    def _calculate_merged_bbox(
        self,
        row_start: int,
        row_end: int,
        col_start: int,
        col_end: int,
        cell_map: Dict[Tuple[int, int], CellBbox]
    ) -> Optional[CellBbox]:
        """병합된 셀의 bbox 계산"""
        x0 = float('inf')
        y0 = float('inf')
        x1 = float('-inf')
        y1 = float('-inf')
        
        found_any = False
        
        for row in range(row_start, row_end + 1):
            for col in range(col_start, col_end + 1):
                cell = cell_map.get((row, col))
                if cell:
                    found_any = True
                    x0 = min(x0, cell.x0)
                    y0 = min(y0, cell.y0)
                    x1 = max(x1, cell.x1)
                    y1 = max(y1, cell.y1)
        
        if not found_any:
            return None
        
        return CellBbox(
            row_idx=row_start,
            col_idx=col_start,
            x0=x0, y0=y0, x1=x1, y1=y1
        )


# ==================== 유틸리티 함수 ====================

def cells_to_grid(cells: List[CellBbox]) -> List[List[Optional[CellBbox]]]:
    """
    셀 목록을 2D 그리드로 변환
    
    Args:
        cells: 셀 목록
        
    Returns:
        2D 리스트 (grid[row][col] = CellBbox 또는 None)
    """
    if not cells:
        return []
    
    max_row = max(c.row_idx for c in cells)
    max_col = max(c.col_idx for c in cells)
    
    grid = [[None for _ in range(max_col + 1)] for _ in range(max_row + 1)]
    
    for cell in cells:
        grid[cell.row_idx][cell.col_idx] = cell
    
    return grid


def visualize_cells(
    image,
    cells: List[CellBbox],
    color: Tuple[int, int, int] = (0, 255, 0),
    thickness: int = 2,
    show_indices: bool = True
):
    """
    셀 영역을 이미지에 시각화
    
    Args:
        image: 원본 이미지 (BGR)
        cells: 셀 목록
        color: 셀 테두리 색상
        thickness: 테두리 두께
        show_indices: 인덱스 표시 여부
        
    Returns:
        셀이 그려진 이미지
    """
    import cv2
    import numpy as np
    
    result = image.copy()
    
    for cell in cells:
        # 셀 테두리 그리기
        pt1 = (int(cell.x0), int(cell.y0))
        pt2 = (int(cell.x1), int(cell.y1))
        cv2.rectangle(result, pt1, pt2, color, thickness)
        
        # 인덱스 표시
        if show_indices:
            center = cell.center
            text = f"({cell.row_idx},{cell.col_idx})"
            cv2.putText(
                result, text,
                (int(center[0] - 20), int(center[1] + 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1
            )
    
    return result


def visualize_merged_cells(
    image,
    merged_cells: List[MergedCell],
    color: Tuple[int, int, int] = (255, 0, 255),
    thickness: int = 3
):
    """
    병합 셀을 이미지에 시각화
    
    Args:
        image: 원본 이미지 (BGR)
        merged_cells: 병합 셀 목록
        color: 테두리 색상
        thickness: 테두리 두께
        
    Returns:
        병합 셀이 강조된 이미지
    """
    import cv2
    
    result = image.copy()
    
    for mc in merged_cells:
        if mc.is_merged:  # 실제 병합 셀만 표시
            bbox = mc.bbox
            pt1 = (int(bbox.x0), int(bbox.y0))
            pt2 = (int(bbox.x1), int(bbox.y1))
            cv2.rectangle(result, pt1, pt2, color, thickness)
            
            # 병합 정보 표시
            text = f"{mc.rowspan}x{mc.colspan}"
            cv2.putText(
                result, text,
                (int(bbox.center[0] - 15), int(bbox.center[1] + 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2
            )
    
    return result


# 직접 실행 테스트용
if __name__ == "__main__":
    import numpy as np
    import cv2
    from .line_detector import TableLineDetector
    
    print("=" * 60)
    print("셀 분할기(Cell Segmentor) 테스트")
    print("=" * 60)
    
    # 테스트 이미지 생성 (3x4 테이블)
    print("\n테스트 이미지 생성 중...")
    
    image = np.ones((400, 500, 3), dtype=np.uint8) * 255
    
    # 수평선 (4개 → 3행)
    for y in [50, 150, 250, 350]:
        cv2.line(image, (50, y), (450, y), (0, 0, 0), 2)
    
    # 수직선 (5개 → 4열)
    for x in [50, 150, 250, 350, 450]:
        cv2.line(image, (x, 50), (x, 350), (0, 0, 0), 2)
    
    # 선 검출
    detector = TableLineDetector()
    lines = detector.detect_from_image(image)
    
    print(f"검출된 선: 수평 {len(lines.horizontal)}개, 수직 {len(lines.vertical)}개")
    
    # 셀 분할
    segmentor = TableCellSegmentor()
    cells = segmentor.segment_cells(lines.horizontal, lines.vertical)
    
    print(f"\n분할된 셀 수: {len(cells)}개")
    print(f"예상 셀 수: {lines.row_count} x {lines.col_count} = {lines.row_count * lines.col_count}개")
    
    # 그리드 정보
    grid = segmentor.extract_grid_info(lines.horizontal, lines.vertical)
    print(f"\n그리드 정보:")
    print(f"  - 행 수: {grid.row_count}")
    print(f"  - 열 수: {grid.col_count}")
    print(f"  - 행 높이: {grid.get_row_heights()}")
    print(f"  - 열 너비: {grid.get_col_widths()}")
    
    # 셀 상세 정보
    print(f"\n셀 상세:")
    for cell in cells[:6]:  # 처음 6개만
        print(f"  [{cell.row_idx},{cell.col_idx}] "
              f"bbox=({cell.x0:.0f},{cell.y0:.0f},{cell.x1:.0f},{cell.y1:.0f}) "
              f"size={cell.width:.0f}x{cell.height:.0f}")
    
    if len(cells) > 6:
        print(f"  ... ({len(cells) - 6}개 더)")
    
    # 병합 셀 감지 (이 테스트에서는 병합 없음)
    merged = segmentor.detect_merged_cells(cells, lines)
    actual_merged = [m for m in merged if m.is_merged]
    print(f"\n병합 셀 수: {len(actual_merged)}개")
    
    print("\n테스트 완료!")
