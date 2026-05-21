"""
PDF 표 구분선 검출기 (Line Detector)

표의 구분선(테두리)을 검출하는 모듈입니다.

지원 방식:
1. 이미지 기반: Hough Transform으로 직선 검출 (스캔 PDF용)
2. 벡터 기반: PyMuPDF의 get_drawings()로 직접 추출 (디지털 PDF용)
3. 하이브리드: 두 방식을 결합하여 최적의 결과 도출

사용 예시:
    detector = TableLineDetector()
    
    # 이미지에서 검출
    lines = detector.detect_from_image(image)
    
    # PDF 벡터에서 검출
    lines = detector.detect_from_vector(page)
    
    # 하이브리드 검출
    lines = detector.detect_hybrid(page)
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Union
import numpy as np
import cv2

# PyMuPDF import (fitz)
try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False
    fitz = None


@dataclass
class Line:
    """
    검출된 선 정보
    
    Attributes:
        start: 시작점 좌표 (x1, y1)
        end: 끝점 좌표 (x2, y2)
        orientation: 선 방향 ('horizontal' | 'vertical')
        thickness: 선 두께 (픽셀)
        confidence: 검출 신뢰도 (0.0 ~ 1.0)
    """
    start: Tuple[float, float]
    end: Tuple[float, float]
    orientation: str
    thickness: float = 1.0
    confidence: float = 1.0
    
    @property
    def length(self) -> float:
        """선의 길이"""
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        return (dx ** 2 + dy ** 2) ** 0.5
    
    @property
    def position(self) -> float:
        """
        선의 기준 위치
        - 수평선: y 좌표
        - 수직선: x 좌표
        """
        if self.orientation == 'horizontal':
            return (self.start[1] + self.end[1]) / 2
        else:
            return (self.start[0] + self.end[0]) / 2
    
    @property
    def span(self) -> Tuple[float, float]:
        """
        선이 커버하는 범위
        - 수평선: (x_min, x_max)
        - 수직선: (y_min, y_max)
        """
        if self.orientation == 'horizontal':
            return (min(self.start[0], self.end[0]), max(self.start[0], self.end[0]))
        else:
            return (min(self.start[1], self.end[1]), max(self.start[1], self.end[1]))
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'start': list(self.start),
            'end': list(self.end),
            'orientation': self.orientation,
            'thickness': self.thickness,
            'confidence': self.confidence,
            'length': self.length
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Line':
        """딕셔너리에서 생성"""
        return cls(
            start=tuple(data['start']),
            end=tuple(data['end']),
            orientation=data['orientation'],
            thickness=data.get('thickness', 1.0),
            confidence=data.get('confidence', 1.0)
        )


@dataclass
class TableLines:
    """
    테이블의 모든 구분선
    
    Attributes:
        horizontal: 수평선 목록
        vertical: 수직선 목록
        bbox: 테이블 전체 경계 (x0, y0, x1, y1)
        detection_method: 사용된 검출 방법
        page_size: 페이지 크기 (width, height)
    """
    horizontal: List[Line] = field(default_factory=list)
    vertical: List[Line] = field(default_factory=list)
    bbox: Tuple[float, float, float, float] = (0, 0, 0, 0)
    detection_method: str = 'unknown'
    page_size: Optional[Tuple[float, float]] = None
    
    @property
    def row_count(self) -> int:
        """추정 행 수 (수평선 수 - 1)"""
        return max(0, len(self.horizontal) - 1)
    
    @property
    def col_count(self) -> int:
        """추정 열 수 (수직선 수 - 1)"""
        return max(0, len(self.vertical) - 1)
    
    @property
    def total_lines(self) -> int:
        """총 선 개수"""
        return len(self.horizontal) + len(self.vertical)
    
    def is_valid_table(self) -> bool:
        """유효한 테이블 구조인지 확인"""
        # 최소 2x2 테이블 (수평선 2개, 수직선 2개 이상)
        if len(self.horizontal) < 2 or len(self.vertical) < 2:
            return False
        
        # ======================================
        # 제목 텍스트 박스 필터링 (핵심)
        # ======================================
        # 수직선이 정확히 2개 = 열이 1개뿐 = 텍스트 박스
        # 실제 표는 최소 2열 이상이므로 수직선이 3개 이상이어야 함
        if len(self.vertical) == 2:
            # 수직선 2개 = 좌우 테두리만 = 단일 열 = 표가 아님
            print(f"[TABLE FILTER] 수직선 2개(단일 열) → 텍스트 박스로 간주")
            return False
        
        # 수평선 2개 + 수직선 3개 = 1행 2열 → 너무 작음, 표가 아닐 가능성
        if len(self.horizontal) == 2 and len(self.vertical) == 3:
            # 1행짜리 2열 표는 보통 표가 아님 (헤더/라벨 박스일 가능성)
            if self.bbox:
                width = self.bbox[2] - self.bbox[0]
                height = self.bbox[3] - self.bbox[1]
                if width > 0 and height > 0 and width / height > 4:
                    print(f"[TABLE FILTER] 1행 2열 + 넓은 비율 → 텍스트 박스로 간주")
                    return False
        
        # 수평선 2-4개 + 수직선 3-4개이고 비율이 넓으면 텍스트 박스
        if len(self.horizontal) <= 4 and len(self.vertical) <= 4:
            if self.bbox:
                width = self.bbox[2] - self.bbox[0]
                height = self.bbox[3] - self.bbox[1]
                if width > 0 and height > 0 and width / height > 5:
                    print(f"[TABLE FILTER] 작은 그리드 + 매우 넓은 비율 → 텍스트 박스로 간주")
                    return False
        
        return True
    
    def split_into_separate_tables(self, gap_threshold: float = 30.0) -> List['TableLines']:
        """
        별도 표 영역으로 분리
        
        다음 기준으로 별도 표로 분리합니다:
        1. 수평선 간격이 gap_threshold 이상
        2. 평균 간격 대비 2배 이상 큰 간격
        3. 분리된 영역 중 텍스트 박스(1-2행)는 필터링
        
        Args:
            gap_threshold: 별도 표로 간주할 최소 간격 (픽셀)
            
        Returns:
            분리된 TableLines 목록 (텍스트 박스 제외)
        """
        if len(self.horizontal) < 3:
            return [self]
        
        # 수평선을 위치 순으로 정렬
        sorted_h_lines = sorted(self.horizontal, key=lambda l: l.position)
        
        # 간격 계산
        gaps = []
        for i in range(1, len(sorted_h_lines)):
            gap = sorted_h_lines[i].position - sorted_h_lines[i-1].position
            gaps.append((i, gap))
        
        if not gaps:
            return [self]
        
        # 평균 간격 계산
        avg_gap = sum(g[1] for g in gaps) / len(gaps)
        
        # 동적 threshold: max(기본값, 평균의 2배)
        dynamic_threshold = max(gap_threshold, avg_gap * 2)
        
        # 간격이 큰 지점 찾기
        split_indices = []
        for i, gap in gaps:
            if gap > dynamic_threshold:
                split_indices.append(i)
        
        if not split_indices:
            return [self]
        
        # 별도 표로 분리
        tables = []
        prev_idx = 0
        
        for split_idx in split_indices:
            table_lines = self._create_subtable(sorted_h_lines[prev_idx:split_idx])
            if table_lines and table_lines.is_valid_table():
                tables.append(table_lines)
            prev_idx = split_idx
        
        # 마지막 영역
        table_lines = self._create_subtable(sorted_h_lines[prev_idx:])
        if table_lines and table_lines.is_valid_table():
            tables.append(table_lines)
        
        return tables if tables else [self]
    
    def _create_subtable(self, h_lines_subset: List['Line']) -> Optional['TableLines']:
        """
        수평선 서브셋으로 서브테이블 생성
        
        Args:
            h_lines_subset: 수평선 서브셋
            
        Returns:
            TableLines 또는 None
        """
        if len(h_lines_subset) < 2:
            return None
        
        y_min = h_lines_subset[0].position
        y_max = h_lines_subset[-1].position
        
        # 해당 영역의 수직선 필터링
        v_lines_subset = [
            v for v in self.vertical 
            if v.span[0] <= y_max and v.span[1] >= y_min
        ]
        
        if len(v_lines_subset) < 2:
            return None
        
        # bbox 계산
        x_coords = [v.position for v in v_lines_subset]
        new_bbox = (min(x_coords), y_min, max(x_coords), y_max)
        
        return TableLines(
            horizontal=h_lines_subset,
            vertical=v_lines_subset,
            bbox=new_bbox,
            detection_method=self.detection_method,
            page_size=self.page_size
        )
    
    def get_grid_points(self) -> List[Tuple[float, float]]:
        """모든 교차점 반환"""
        points = []
        for h_line in self.horizontal:
            h_y = h_line.position
            for v_line in self.vertical:
                v_x = v_line.position
                # 교차 여부 확인
                h_span = h_line.span
                v_span = v_line.span
                if h_span[0] <= v_x <= h_span[1] and v_span[0] <= h_y <= v_span[1]:
                    points.append((v_x, h_y))
        return points
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'horizontal': [line.to_dict() for line in self.horizontal],
            'vertical': [line.to_dict() for line in self.vertical],
            'bbox': list(self.bbox),
            'detection_method': self.detection_method,
            'page_size': list(self.page_size) if self.page_size else None,
            'row_count': self.row_count,
            'col_count': self.col_count
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'TableLines':
        """딕셔너리에서 생성"""
        return cls(
            horizontal=[Line.from_dict(l) for l in data.get('horizontal', [])],
            vertical=[Line.from_dict(l) for l in data.get('vertical', [])],
            bbox=tuple(data.get('bbox', (0, 0, 0, 0))),
            detection_method=data.get('detection_method', 'unknown'),
            page_size=tuple(data['page_size']) if data.get('page_size') else None
        )


@dataclass
class LineDetectorConfig:
    """
    선 검출기 설정
    
    Attributes:
        min_line_length: 최소 선 길이 (픽셀)
        thickness_range: 선 두께 허용 범위 (min, max)
        angle_tolerance: 수평/수직 허용 각도 (도)
        hough_threshold: Hough 변환 임계값
        min_line_gap: 최소 선 간격 (픽셀)
        merge_tolerance: 유사 선 병합 허용 오차 (픽셀)
        dpi: PDF → 이미지 변환 해상도
    """
    min_line_length: int = 30
    thickness_range: Tuple[int, int] = (1, 10)
    angle_tolerance: float = 2.0
    hough_threshold: int = 80
    min_line_gap: int = 5
    merge_tolerance: float = 5.0
    dpi: int = 150
    
    # 전처리 옵션
    adaptive_threshold_block_size: int = 11
    adaptive_threshold_c: int = 2
    morph_kernel_length: int = 40
    morph_iterations: int = 2
    
    # 노이즈 필터링
    min_confidence: float = 0.5
    filter_short_lines: bool = True
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'min_line_length': self.min_line_length,
            'thickness_range': list(self.thickness_range),
            'angle_tolerance': self.angle_tolerance,
            'hough_threshold': self.hough_threshold,
            'min_line_gap': self.min_line_gap,
            'merge_tolerance': self.merge_tolerance,
            'dpi': self.dpi
        }


class TableLineDetector:
    """
    표 구분선 검출기
    
    PDF 페이지나 이미지에서 표의 수평/수직 구분선을 검출합니다.
    
    사용 예시:
        detector = TableLineDetector()
        
        # 이미지에서 검출
        lines = detector.detect_from_image(cv2_image)
        
        # PDF 페이지에서 검출 (벡터 방식)
        lines = detector.detect_from_vector(fitz_page)
        
        # 하이브리드 검출 (벡터 + 이미지)
        lines = detector.detect_hybrid(fitz_page)
    """
    
    def __init__(self, config: Optional[LineDetectorConfig] = None):
        """
        Args:
            config: 선 검출기 설정 (None이면 기본값 사용)
        """
        self.config = config or LineDetectorConfig()
    
    def detect_from_image(self, image: np.ndarray) -> TableLines:
        """
        이미지에서 표 구분선 검출 (Hough Transform 방식)
        
        처리 과정:
        1. 그레이스케일 변환
        2. 이진화 (Adaptive Threshold)
        3. 모폴로지 연산으로 수평/수직선 분리 검출
        4. Hough Line Transform으로 직선 추출
        5. 중복 선 병합
        
        Args:
            image: BGR 또는 그레이스케일 이미지 (numpy 배열)
            
        Returns:
            TableLines: 검출된 수평/수직 선 목록
        """
        if image is None or image.size == 0:
            return TableLines(detection_method='hough')
        
        # 1. 그레이스케일 변환
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        page_size = (image.shape[1], image.shape[0])  # (width, height)
        
        # 2. 이진화 (Adaptive Threshold)
        binary = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            self.config.adaptive_threshold_block_size,
            self.config.adaptive_threshold_c
        )
        
        # 3. 수평선 검출
        h_lines = self._detect_horizontal_lines(binary)
        
        # 4. 수직선 검출
        v_lines = self._detect_vertical_lines(binary)
        
        # 5. 중복 선 병합
        h_lines = self._merge_similar_lines(h_lines, 'horizontal')
        v_lines = self._merge_similar_lines(v_lines, 'vertical')
        
        # 6. 짧은 선 필터링
        if self.config.filter_short_lines:
            h_lines = [l for l in h_lines if l.length >= self.config.min_line_length]
            v_lines = [l for l in v_lines if l.length >= self.config.min_line_length]
        
        # 7. 신뢰도 기반 필터링
        h_lines = [l for l in h_lines if l.confidence >= self.config.min_confidence]
        v_lines = [l for l in v_lines if l.confidence >= self.config.min_confidence]
        
        # 8. 위치순 정렬
        h_lines.sort(key=lambda l: l.position)
        v_lines.sort(key=lambda l: l.position)
        
        # 9. bbox 계산
        bbox = self._calculate_bbox(h_lines, v_lines)
        
        return TableLines(
            horizontal=h_lines,
            vertical=v_lines,
            bbox=bbox,
            detection_method='hough',
            page_size=page_size
        )
    
    def detect_from_vector(self, page) -> TableLines:
        """
        PDF 벡터 그래픽에서 직접 선 추출
        
        장점: 이미지 변환 없이 정확한 좌표 획득
        
        Args:
            page: PyMuPDF 페이지 객체 (fitz.Page)
            
        Returns:
            TableLines: 추출된 구분선
        """
        if not HAS_FITZ:
            raise ImportError("PyMuPDF(fitz)가 설치되지 않았습니다. pip install PyMuPDF")
        
        h_lines = []
        v_lines = []
        page_size = (page.rect.width, page.rect.height)
        
        # 벡터 드로잉 추출
        drawings = page.get_drawings()
        
        for drawing in drawings:
            for item in drawing.get("items", []):
                if item[0] == "l":  # line
                    line_info = self._process_vector_line(item, drawing)
                    if line_info:
                        if line_info.orientation == 'horizontal':
                            h_lines.append(line_info)
                        else:
                            v_lines.append(line_info)
                
                elif item[0] == "re":  # rectangle
                    # 사각형의 4변을 선으로 분해
                    rect_lines = self._process_vector_rect(item, drawing)
                    for line in rect_lines:
                        if line.orientation == 'horizontal':
                            h_lines.append(line)
                        else:
                            v_lines.append(line)
        
        # 중복 선 병합
        h_lines = self._merge_similar_lines(h_lines, 'horizontal')
        v_lines = self._merge_similar_lines(v_lines, 'vertical')
        
        # 짧은 선 필터링
        if self.config.filter_short_lines:
            h_lines = [l for l in h_lines if l.length >= self.config.min_line_length]
            v_lines = [l for l in v_lines if l.length >= self.config.min_line_length]
        
        # 위치순 정렬
        h_lines.sort(key=lambda l: l.position)
        v_lines.sort(key=lambda l: l.position)
        
        # bbox 계산
        bbox = self._calculate_bbox(h_lines, v_lines)
        
        return TableLines(
            horizontal=h_lines,
            vertical=v_lines,
            bbox=bbox,
            detection_method='vector',
            page_size=page_size
        )
    
    def detect_hybrid(self, page, use_image_fallback: bool = True) -> TableLines:
        """
        하이브리드 방식으로 선 검출
        
        전략:
        1. 벡터 방식 먼저 시도
        2. 결과가 부족하면 이미지 방식으로 보완
        3. 두 결과를 병합
        
        Args:
            page: PyMuPDF 페이지 객체 (fitz.Page)
            use_image_fallback: 벡터 검출 실패 시 이미지 방식 사용
            
        Returns:
            TableLines: 병합된 검출 결과
        """
        if not HAS_FITZ:
            raise ImportError("PyMuPDF(fitz)가 설치되지 않았습니다. pip install PyMuPDF")
        
        # 1. 벡터 방식 시도
        vector_lines = self.detect_from_vector(page)
        
        # 충분한 선이 검출되었는지 확인
        if vector_lines.is_valid_table():
            return vector_lines
        
        # 2. 이미지 방식으로 보완
        if use_image_fallback:
            # PDF 페이지를 이미지로 변환
            mat = fitz.Matrix(self.config.dpi / 72, self.config.dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            # numpy 배열로 변환
            img = np.frombuffer(pix.samples, dtype=np.uint8)
            img = img.reshape(pix.height, pix.width, pix.n)
            
            # RGB로 변환 (필요시)
            if pix.n == 4:  # RGBA
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            elif pix.n == 1:  # Grayscale
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            
            # 이미지에서 선 검출
            image_lines = self.detect_from_image(img)
            
            # 좌표 스케일 조정 (이미지 좌표 → PDF 좌표)
            scale = 72 / self.config.dpi
            image_lines = self._scale_lines(image_lines, scale)
            
            # 3. 결과 병합
            return self._merge_line_results(vector_lines, image_lines)
        
        return vector_lines
    
    def detect_from_pdf_page(
        self, 
        pdf_path: str, 
        page_num: int = 0,
        method: str = 'hybrid'
    ) -> TableLines:
        """
        PDF 파일의 특정 페이지에서 선 검출
        
        Args:
            pdf_path: PDF 파일 경로
            page_num: 페이지 번호 (0-based)
            method: 검출 방법 ('vector', 'image', 'hybrid')
            
        Returns:
            TableLines: 검출된 선 목록
        """
        if not HAS_FITZ:
            raise ImportError("PyMuPDF(fitz)가 설치되지 않았습니다. pip install PyMuPDF")
        
        doc = fitz.open(pdf_path)
        
        try:
            if page_num < 0 or page_num >= len(doc):
                raise ValueError(f"잘못된 페이지 번호: {page_num}. 총 {len(doc)} 페이지.")
            
            page = doc[page_num]
            
            if method == 'vector':
                return self.detect_from_vector(page)
            elif method == 'image':
                mat = fitz.Matrix(self.config.dpi / 72, self.config.dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img = np.frombuffer(pix.samples, dtype=np.uint8)
                img = img.reshape(pix.height, pix.width, pix.n)
                if pix.n >= 3:
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                lines = self.detect_from_image(img)
                # 좌표 스케일 조정
                return self._scale_lines(lines, 72 / self.config.dpi)
            else:  # hybrid
                return self.detect_hybrid(page)
        finally:
            doc.close()
    
    # ==================== 내부 메서드 ====================
    
    def _detect_horizontal_lines(self, binary: np.ndarray) -> List[Line]:
        """수평선 검출"""
        # 수평선 검출용 커널 (가로로 긴 사각형)
        kernel_length = max(self.config.morph_kernel_length, binary.shape[1] // 30)
        horizontal_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (kernel_length, 1)
        )
        
        # 수평선 마스크 생성 (모폴로지 열기 연산)
        horizontal_mask = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, 
            horizontal_kernel, 
            iterations=self.config.morph_iterations
        )
        
        # Hough Transform으로 직선 검출
        return self._detect_lines_hough(horizontal_mask, 'horizontal')
    
    def _detect_vertical_lines(self, binary: np.ndarray) -> List[Line]:
        """수직선 검출"""
        # 수직선 검출용 커널 (세로로 긴 사각형)
        kernel_length = max(self.config.morph_kernel_length, binary.shape[0] // 30)
        vertical_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (1, kernel_length)
        )
        
        # 수직선 마스크 생성
        vertical_mask = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, 
            vertical_kernel, 
            iterations=self.config.morph_iterations
        )
        
        # Hough Transform으로 직선 검출
        return self._detect_lines_hough(vertical_mask, 'vertical')
    
    def _detect_lines_hough(
        self, 
        mask: np.ndarray, 
        orientation: str
    ) -> List[Line]:
        """Hough Transform으로 선 검출"""
        lines = cv2.HoughLinesP(
            mask,
            rho=1,
            theta=np.pi / 180,
            threshold=self.config.hough_threshold,
            minLineLength=self.config.min_line_length,
            maxLineGap=self.config.min_line_gap
        )
        
        result = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                
                # 방향 검증
                if orientation == 'horizontal':
                    # 수평선: y 좌표 차이가 작아야 함
                    angle = abs(np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi)
                    if angle > self.config.angle_tolerance and angle < (180 - self.config.angle_tolerance):
                        continue
                else:
                    # 수직선: x 좌표 차이가 작아야 함
                    angle = abs(np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi)
                    if abs(angle - 90) > self.config.angle_tolerance:
                        continue
                
                # 신뢰도 계산 (선 길이 기반)
                length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
                confidence = min(1.0, length / (self.config.min_line_length * 3))
                
                result.append(Line(
                    start=(float(x1), float(y1)),
                    end=(float(x2), float(y2)),
                    orientation=orientation,
                    thickness=1.0,
                    confidence=confidence
                ))
        
        return result
    
    def _process_vector_line(self, item, drawing: dict) -> Optional[Line]:
        """벡터 라인 아이템 처리"""
        try:
            p1, p2 = item[1], item[2]
            
            # None 체크
            if p1 is None or p2 is None:
                return None
            
            # 좌표 추출 (None 체크 포함)
            x1 = getattr(p1, 'x', None)
            y1 = getattr(p1, 'y', None)
            x2 = getattr(p2, 'x', None)
            y2 = getattr(p2, 'y', None)
            
            if any(v is None for v in [x1, y1, x2, y2]):
                return None
            
            thickness = drawing.get("width", 1.0) or 1.0
            
            # 방향 판별
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            
            if dy < self.config.angle_tolerance and dx >= self.config.min_line_length:
                # 수평선
                return Line(
                    start=(float(x1), float(y1)),
                    end=(float(x2), float(y2)),
                    orientation='horizontal',
                    thickness=float(thickness),
                    confidence=1.0
                )
            elif dx < self.config.angle_tolerance and dy >= self.config.min_line_length:
                # 수직선
                return Line(
                    start=(float(x1), float(y1)),
                    end=(float(x2), float(y2)),
                    orientation='vertical',
                    thickness=float(thickness),
                    confidence=1.0
                )
            
            return None
        except (TypeError, AttributeError, ValueError) as e:
            # 좌표 처리 중 오류 발생 시 무시
            return None
    
    def _process_vector_rect(self, item, drawing: dict) -> List[Line]:
        """벡터 사각형 아이템 처리 (4변을 선으로 분해)"""
        try:
            rect = item[1]  # fitz.Rect
            
            if rect is None:
                return []
            
            # 좌표 추출 (None 체크 포함)
            x0 = getattr(rect, 'x0', None)
            y0 = getattr(rect, 'y0', None)
            x1 = getattr(rect, 'x1', None)
            y1 = getattr(rect, 'y1', None)
            
            if any(v is None for v in [x0, y0, x1, y1]):
                return []
            
            thickness = drawing.get("width", 1.0) or 1.0
            width = abs(x1 - x0)
            height = abs(y1 - y0)
            
            lines = []
            
            # 상단 수평선
            if width >= self.config.min_line_length:
                lines.append(Line(
                    start=(float(x0), float(y0)),
                    end=(float(x1), float(y0)),
                    orientation='horizontal',
                    thickness=float(thickness),
                    confidence=1.0
                ))
                # 하단 수평선
                lines.append(Line(
                    start=(float(x0), float(y1)),
                    end=(float(x1), float(y1)),
                    orientation='horizontal',
                    thickness=float(thickness),
                    confidence=1.0
                ))
            
            # 좌측 수직선
            if height >= self.config.min_line_length:
                lines.append(Line(
                    start=(float(x0), float(y0)),
                    end=(float(x0), float(y1)),
                    orientation='vertical',
                    thickness=float(thickness),
                    confidence=1.0
                ))
                # 우측 수직선
                lines.append(Line(
                    start=(float(x1), float(y0)),
                    end=(float(x1), float(y1)),
                    orientation='vertical',
                    thickness=float(thickness),
                    confidence=1.0
                ))
            
            return lines
        except (TypeError, AttributeError, ValueError) as e:
            # 좌표 처리 중 오류 발생 시 빈 리스트 반환
            return []
    
    def _merge_similar_lines(
        self, 
        lines: List[Line], 
        orientation: str
    ) -> List[Line]:
        """비슷한 위치의 선들을 병합"""
        if not lines:
            return []
        
        tolerance = self.config.merge_tolerance
        
        # 위치 기준 정렬
        if orientation == 'horizontal':
            lines.sort(key=lambda l: l.start[1])  # y 좌표 기준
        else:
            lines.sort(key=lambda l: l.start[0])  # x 좌표 기준
        
        merged = []
        current_group = [lines[0]]
        
        for line in lines[1:]:
            if orientation == 'horizontal':
                diff = abs(line.start[1] - current_group[-1].start[1])
            else:
                diff = abs(line.start[0] - current_group[-1].start[0])
            
            if diff <= tolerance:
                current_group.append(line)
            else:
                # 그룹 병합
                merged.append(self._merge_line_group(current_group, orientation))
                current_group = [line]
        
        if current_group:
            merged.append(self._merge_line_group(current_group, orientation))
        
        return merged
    
    def _merge_line_group(
        self, 
        group: List[Line], 
        orientation: str
    ) -> Line:
        """선 그룹을 하나의 선으로 병합"""
        if len(group) == 1:
            return group[0]
        
        # 평균 위치 계산
        if orientation == 'horizontal':
            y = sum(l.start[1] for l in group) / len(group)
            x1 = min(min(l.start[0], l.end[0]) for l in group)
            x2 = max(max(l.start[0], l.end[0]) for l in group)
            return Line(
                start=(x1, y),
                end=(x2, y),
                orientation='horizontal',
                thickness=max(l.thickness for l in group),
                confidence=max(l.confidence for l in group)
            )
        else:
            x = sum(l.start[0] for l in group) / len(group)
            y1 = min(min(l.start[1], l.end[1]) for l in group)
            y2 = max(max(l.start[1], l.end[1]) for l in group)
            return Line(
                start=(x, y1),
                end=(x, y2),
                orientation='vertical',
                thickness=max(l.thickness for l in group),
                confidence=max(l.confidence for l in group)
            )
    
    def _calculate_bbox(
        self, 
        h_lines: List[Line], 
        v_lines: List[Line]
    ) -> Tuple[float, float, float, float]:
        """테이블 전체 경계 계산"""
        if not h_lines and not v_lines:
            return (0, 0, 0, 0)
        
        all_x = []
        all_y = []
        
        for line in h_lines + v_lines:
            all_x.extend([line.start[0], line.end[0]])
            all_y.extend([line.start[1], line.end[1]])
        
        return (min(all_x), min(all_y), max(all_x), max(all_y))
    
    def _scale_lines(self, lines: TableLines, scale: float) -> TableLines:
        """선 좌표 스케일 조정"""
        def scale_line(line: Line) -> Line:
            return Line(
                start=(line.start[0] * scale, line.start[1] * scale),
                end=(line.end[0] * scale, line.end[1] * scale),
                orientation=line.orientation,
                thickness=line.thickness * scale,
                confidence=line.confidence
            )
        
        return TableLines(
            horizontal=[scale_line(l) for l in lines.horizontal],
            vertical=[scale_line(l) for l in lines.vertical],
            bbox=tuple(v * scale for v in lines.bbox),
            detection_method=lines.detection_method,
            page_size=tuple(v * scale for v in lines.page_size) if lines.page_size else None
        )
    
    def _merge_line_results(
        self, 
        vector_lines: TableLines, 
        image_lines: TableLines
    ) -> TableLines:
        """벡터와 이미지 검출 결과 병합"""
        # 두 결과의 선들을 합침
        all_h_lines = vector_lines.horizontal + image_lines.horizontal
        all_v_lines = vector_lines.vertical + image_lines.vertical
        
        # 중복 제거 (병합)
        merged_h = self._merge_similar_lines(all_h_lines, 'horizontal')
        merged_v = self._merge_similar_lines(all_v_lines, 'vertical')
        
        # 위치순 정렬
        merged_h.sort(key=lambda l: l.position)
        merged_v.sort(key=lambda l: l.position)
        
        # bbox 계산
        bbox = self._calculate_bbox(merged_h, merged_v)
        
        return TableLines(
            horizontal=merged_h,
            vertical=merged_v,
            bbox=bbox,
            detection_method='hybrid',
            page_size=vector_lines.page_size or image_lines.page_size
        )


# ==================== 유틸리티 함수 ====================

def visualize_lines(
    image: np.ndarray, 
    lines: TableLines,
    h_color: Tuple[int, int, int] = (0, 255, 0),
    v_color: Tuple[int, int, int] = (255, 0, 0),
    thickness: int = 2,
    show_intersections: bool = True
) -> np.ndarray:
    """
    검출된 선을 이미지에 시각화
    
    Args:
        image: 원본 이미지 (BGR)
        lines: 검출된 선 정보
        h_color: 수평선 색상 (BGR)
        v_color: 수직선 색상 (BGR)
        thickness: 선 두께
        show_intersections: 교차점 표시 여부
        
    Returns:
        np.ndarray: 선이 그려진 이미지
    """
    result = image.copy()
    
    # 수평선 그리기 (녹색)
    for line in lines.horizontal:
        pt1 = (int(line.start[0]), int(line.start[1]))
        pt2 = (int(line.end[0]), int(line.end[1]))
        cv2.line(result, pt1, pt2, h_color, thickness)
    
    # 수직선 그리기 (빨간색)
    for line in lines.vertical:
        pt1 = (int(line.start[0]), int(line.start[1]))
        pt2 = (int(line.end[0]), int(line.end[1]))
        cv2.line(result, pt1, pt2, v_color, thickness)
    
    # 교차점 표시 (파란색 원)
    if show_intersections:
        for point in lines.get_grid_points():
            cv2.circle(result, (int(point[0]), int(point[1])), 5, (255, 0, 0), -1)
    
    return result


def detect_tables_in_page(
    page,
    detector: Optional[TableLineDetector] = None,
    min_lines: int = 4
) -> List[TableLines]:
    """
    페이지 내 여러 테이블 검출
    
    Args:
        page: PyMuPDF 페이지 객체
        detector: 선 검출기 (None이면 기본 생성)
        min_lines: 테이블로 인정할 최소 선 개수
        
    Returns:
        List[TableLines]: 검출된 테이블별 선 정보
    """
    if detector is None:
        detector = TableLineDetector()
    
    # 전체 선 검출
    all_lines = detector.detect_hybrid(page)
    
    if not all_lines.is_valid_table():
        return []
    
    # TODO: 여러 테이블 분리 로직 (클러스터링 기반)
    # 현재는 단일 테이블로 반환
    return [all_lines] if all_lines.total_lines >= min_lines else []


# 직접 실행 테스트용
if __name__ == "__main__":
    import sys
    
    print("=" * 60)
    print("PDF 표 구분선 검출기 테스트")
    print("=" * 60)
    
    # 설정 출력
    config = LineDetectorConfig()
    print(f"\n기본 설정:")
    print(f"  - 최소 선 길이: {config.min_line_length}px")
    print(f"  - 허용 각도: {config.angle_tolerance}°")
    print(f"  - Hough 임계값: {config.hough_threshold}")
    print(f"  - 병합 허용 오차: {config.merge_tolerance}px")
    print(f"  - DPI: {config.dpi}")
    
    # 테스트 이미지 생성 (간단한 표 형태)
    print(f"\n테스트 이미지 생성 중...")
    
    test_image = np.ones((400, 600, 3), dtype=np.uint8) * 255
    
    # 수평선 그리기
    cv2.line(test_image, (50, 50), (550, 50), (0, 0, 0), 2)
    cv2.line(test_image, (50, 150), (550, 150), (0, 0, 0), 2)
    cv2.line(test_image, (50, 250), (550, 250), (0, 0, 0), 2)
    cv2.line(test_image, (50, 350), (550, 350), (0, 0, 0), 2)
    
    # 수직선 그리기
    cv2.line(test_image, (50, 50), (50, 350), (0, 0, 0), 2)
    cv2.line(test_image, (200, 50), (200, 350), (0, 0, 0), 2)
    cv2.line(test_image, (400, 50), (400, 350), (0, 0, 0), 2)
    cv2.line(test_image, (550, 50), (550, 350), (0, 0, 0), 2)
    
    # 검출 테스트
    detector = TableLineDetector()
    lines = detector.detect_from_image(test_image)
    
    print(f"\n검출 결과:")
    print(f"  - 수평선: {len(lines.horizontal)}개")
    print(f"  - 수직선: {len(lines.vertical)}개")
    print(f"  - 추정 행 수: {lines.row_count}")
    print(f"  - 추정 열 수: {lines.col_count}")
    print(f"  - 유효 테이블: {lines.is_valid_table()}")
    print(f"  - bbox: {lines.bbox}")
    
    # 수평선 상세
    print(f"\n수평선 상세:")
    for i, line in enumerate(lines.horizontal):
        print(f"  [{i}] y={line.position:.1f}, x={line.span[0]:.1f}~{line.span[1]:.1f}, "
              f"길이={line.length:.1f}, 신뢰도={line.confidence:.2f}")
    
    # 수직선 상세
    print(f"\n수직선 상세:")
    for i, line in enumerate(lines.vertical):
        print(f"  [{i}] x={line.position:.1f}, y={line.span[0]:.1f}~{line.span[1]:.1f}, "
              f"길이={line.length:.1f}, 신뢰도={line.confidence:.2f}")
    
    # 교차점
    grid_points = lines.get_grid_points()
    print(f"\n교차점: {len(grid_points)}개")
    
    # 시각화 테스트
    vis_image = visualize_lines(test_image, lines)
    print(f"\n시각화 이미지 생성 완료: {vis_image.shape}")
    
    print("\n테스트 완료!")
