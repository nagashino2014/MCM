"""
선 검출기(Line Detector) 테스트

다양한 시나리오에서 선 검출기의 동작을 검증합니다.
"""

import pytest
import numpy as np
import cv2
from pathlib import Path

from app.table_recovery.line_detector import (
    Line,
    TableLines,
    LineDetectorConfig,
    TableLineDetector,
    visualize_lines
)


class TestLine:
    """Line 데이터클래스 테스트"""
    
    def test_horizontal_line_properties(self):
        """수평선 속성 테스트"""
        line = Line(
            start=(10, 50),
            end=(100, 50),
            orientation='horizontal',
            thickness=2.0,
            confidence=0.9
        )
        
        assert line.orientation == 'horizontal'
        assert line.length == 90.0
        assert line.position == 50.0
        assert line.span == (10, 100)
    
    def test_vertical_line_properties(self):
        """수직선 속성 테스트"""
        line = Line(
            start=(50, 10),
            end=(50, 100),
            orientation='vertical',
            thickness=2.0,
            confidence=0.9
        )
        
        assert line.orientation == 'vertical'
        assert line.length == 90.0
        assert line.position == 50.0
        assert line.span == (10, 100)
    
    def test_line_to_dict_and_back(self):
        """Line 직렬화/역직렬화 테스트"""
        original = Line(
            start=(10.5, 20.5),
            end=(100.5, 20.5),
            orientation='horizontal',
            thickness=1.5,
            confidence=0.85
        )
        
        # 딕셔너리로 변환
        data = original.to_dict()
        assert 'start' in data
        assert 'end' in data
        assert 'orientation' in data
        
        # 다시 Line으로 복원
        restored = Line.from_dict(data)
        assert restored.start == original.start
        assert restored.end == original.end
        assert restored.orientation == original.orientation


class TestTableLines:
    """TableLines 데이터클래스 테스트"""
    
    def test_row_col_count(self):
        """행/열 수 계산 테스트"""
        h_lines = [
            Line(start=(0, 0), end=(100, 0), orientation='horizontal'),
            Line(start=(0, 50), end=(100, 50), orientation='horizontal'),
            Line(start=(0, 100), end=(100, 100), orientation='horizontal'),
        ]
        v_lines = [
            Line(start=(0, 0), end=(0, 100), orientation='vertical'),
            Line(start=(50, 0), end=(50, 100), orientation='vertical'),
            Line(start=(100, 0), end=(100, 100), orientation='vertical'),
        ]
        
        lines = TableLines(horizontal=h_lines, vertical=v_lines)
        
        assert lines.row_count == 2  # 3개 수평선 - 1
        assert lines.col_count == 2  # 3개 수직선 - 1
        assert lines.total_lines == 6
    
    def test_is_valid_table(self):
        """유효 테이블 판정 테스트"""
        # 유효한 테이블 (2x2 이상)
        valid_lines = TableLines(
            horizontal=[
                Line(start=(0, 0), end=(100, 0), orientation='horizontal'),
                Line(start=(0, 50), end=(100, 50), orientation='horizontal'),
            ],
            vertical=[
                Line(start=(0, 0), end=(0, 50), orientation='vertical'),
                Line(start=(100, 0), end=(100, 50), orientation='vertical'),
            ]
        )
        assert valid_lines.is_valid_table() == True
        
        # 유효하지 않은 테이블 (선이 부족)
        invalid_lines = TableLines(
            horizontal=[Line(start=(0, 0), end=(100, 0), orientation='horizontal')],
            vertical=[]
        )
        assert invalid_lines.is_valid_table() == False
    
    def test_to_dict_and_back(self):
        """TableLines 직렬화/역직렬화 테스트"""
        original = TableLines(
            horizontal=[
                Line(start=(0, 0), end=(100, 0), orientation='horizontal'),
            ],
            vertical=[
                Line(start=(0, 0), end=(0, 100), orientation='vertical'),
            ],
            bbox=(0, 0, 100, 100),
            detection_method='hough',
            page_size=(200, 300)
        )
        
        data = original.to_dict()
        restored = TableLines.from_dict(data)
        
        assert len(restored.horizontal) == len(original.horizontal)
        assert len(restored.vertical) == len(original.vertical)
        assert restored.detection_method == original.detection_method


class TestLineDetectorConfig:
    """설정 클래스 테스트"""
    
    def test_default_config(self):
        """기본 설정값 테스트"""
        config = LineDetectorConfig()
        
        assert config.min_line_length == 30
        assert config.dpi == 150
        assert config.hough_threshold == 80
        assert config.merge_tolerance == 5.0
    
    def test_custom_config(self):
        """커스텀 설정 테스트"""
        config = LineDetectorConfig(
            min_line_length=50,
            dpi=300,
            hough_threshold=100
        )
        
        assert config.min_line_length == 50
        assert config.dpi == 300
        assert config.hough_threshold == 100


class TestTableLineDetector:
    """선 검출기 테스트"""
    
    @pytest.fixture
    def simple_table_image(self):
        """간단한 3x3 테이블 이미지 생성"""
        image = np.ones((300, 400, 3), dtype=np.uint8) * 255
        
        # 수평선 (4개)
        for y in [50, 100, 150, 200]:
            cv2.line(image, (50, y), (350, y), (0, 0, 0), 2)
        
        # 수직선 (4개)
        for x in [50, 150, 250, 350]:
            cv2.line(image, (x, 50), (x, 200), (0, 0, 0), 2)
        
        return image
    
    @pytest.fixture
    def detector(self):
        """기본 검출기"""
        return TableLineDetector()
    
    def test_detect_from_simple_image(self, detector, simple_table_image):
        """간단한 이미지에서 선 검출 테스트"""
        lines = detector.detect_from_image(simple_table_image)
        
        assert lines.detection_method == 'hough'
        assert len(lines.horizontal) == 4
        assert len(lines.vertical) == 4
        assert lines.is_valid_table()
        assert lines.row_count == 3
        assert lines.col_count == 3
    
    def test_detect_empty_image(self, detector):
        """빈 이미지 처리 테스트"""
        empty_image = np.ones((100, 100, 3), dtype=np.uint8) * 255
        lines = detector.detect_from_image(empty_image)
        
        assert len(lines.horizontal) == 0
        assert len(lines.vertical) == 0
        assert not lines.is_valid_table()
    
    def test_detect_none_image(self, detector):
        """None 이미지 처리 테스트"""
        lines = detector.detect_from_image(None)
        
        assert len(lines.horizontal) == 0
        assert len(lines.vertical) == 0
    
    def test_grayscale_image(self, detector):
        """그레이스케일 이미지 처리 테스트"""
        gray_image = np.ones((200, 300), dtype=np.uint8) * 255
        
        # 수평선
        cv2.line(gray_image, (50, 50), (250, 50), 0, 2)
        cv2.line(gray_image, (50, 150), (250, 150), 0, 2)
        
        # 수직선
        cv2.line(gray_image, (50, 50), (50, 150), 0, 2)
        cv2.line(gray_image, (250, 50), (250, 150), 0, 2)
        
        lines = detector.detect_from_image(gray_image)
        
        assert len(lines.horizontal) == 2
        assert len(lines.vertical) == 2
    
    def test_custom_config(self):
        """커스텀 설정으로 검출 테스트"""
        config = LineDetectorConfig(
            min_line_length=100,  # 긴 선만 검출
            hough_threshold=50
        )
        detector = TableLineDetector(config=config)
        
        # 짧은 선만 있는 이미지
        image = np.ones((200, 200, 3), dtype=np.uint8) * 255
        cv2.line(image, (10, 50), (60, 50), (0, 0, 0), 2)  # 50px (필터링됨)
        cv2.line(image, (10, 100), (160, 100), (0, 0, 0), 2)  # 150px (검출됨)
        
        lines = detector.detect_from_image(image)
        
        # 긴 선만 검출됨
        assert len(lines.horizontal) == 1
        assert lines.horizontal[0].length >= 100
    
    def test_merge_similar_lines(self, detector):
        """유사 선 병합 테스트"""
        image = np.ones((200, 400, 3), dtype=np.uint8) * 255
        
        # 비슷한 y 좌표의 수평선 (병합되어야 함)
        cv2.line(image, (50, 50), (150, 50), (0, 0, 0), 2)
        cv2.line(image, (160, 52), (350, 52), (0, 0, 0), 2)  # y=52 (y=50과 병합)
        
        # 다른 y 좌표의 수평선
        cv2.line(image, (50, 150), (350, 150), (0, 0, 0), 2)
        
        lines = detector.detect_from_image(image)
        
        # 병합 후 2개의 수평선
        assert len(lines.horizontal) == 2
    
    def test_bbox_calculation(self, detector, simple_table_image):
        """bbox 계산 테스트"""
        lines = detector.detect_from_image(simple_table_image)
        
        x0, y0, x1, y1 = lines.bbox
        
        # bbox가 테이블을 감싸는지 확인
        assert x0 <= 60  # 약 50
        assert y0 <= 60  # 약 50
        assert x1 >= 340  # 약 350
        assert y1 >= 190  # 약 200


class TestVisualization:
    """시각화 함수 테스트"""
    
    def test_visualize_lines(self):
        """선 시각화 테스트"""
        # 원본 이미지
        image = np.ones((200, 200, 3), dtype=np.uint8) * 255
        
        # 테스트용 선
        lines = TableLines(
            horizontal=[
                Line(start=(10, 50), end=(190, 50), orientation='horizontal'),
                Line(start=(10, 150), end=(190, 150), orientation='horizontal'),
            ],
            vertical=[
                Line(start=(50, 10), end=(50, 190), orientation='vertical'),
                Line(start=(150, 10), end=(150, 190), orientation='vertical'),
            ]
        )
        
        # 시각화
        result = visualize_lines(image, lines)
        
        # 결과가 같은 크기인지 확인
        assert result.shape == image.shape
        
        # 원본과 다른지 확인 (선이 그려졌으므로)
        assert not np.array_equal(result, image)


class TestIntegration:
    """통합 테스트"""
    
    def test_complex_table(self):
        """복잡한 테이블 검출 테스트"""
        # 5x4 테이블 생성
        image = np.ones((500, 600, 3), dtype=np.uint8) * 255
        
        # 수평선 (6개)
        y_positions = [50, 100, 200, 300, 400, 450]
        for y in y_positions:
            cv2.line(image, (50, y), (550, y), (0, 0, 0), 2)
        
        # 수직선 (5개)
        x_positions = [50, 150, 300, 450, 550]
        for x in x_positions:
            cv2.line(image, (x, 50), (x, 450), (0, 0, 0), 2)
        
        detector = TableLineDetector()
        lines = detector.detect_from_image(image)
        
        assert lines.is_valid_table()
        assert len(lines.horizontal) == 6
        assert len(lines.vertical) == 5
        assert lines.row_count == 5
        assert lines.col_count == 4
    
    def test_noisy_image(self):
        """노이즈가 있는 이미지 테스트"""
        # 노이즈 추가된 이미지
        image = np.ones((300, 400, 3), dtype=np.uint8) * 255
        
        # 명확한 테이블 선
        cv2.line(image, (50, 50), (350, 50), (0, 0, 0), 3)
        cv2.line(image, (50, 200), (350, 200), (0, 0, 0), 3)
        cv2.line(image, (50, 50), (50, 200), (0, 0, 0), 3)
        cv2.line(image, (350, 50), (350, 200), (0, 0, 0), 3)
        
        # 노이즈 (짧은 선분들)
        np.random.seed(42)
        for _ in range(20):
            x1, y1 = np.random.randint(0, 400), np.random.randint(0, 300)
            x2, y2 = x1 + np.random.randint(5, 15), y1 + np.random.randint(5, 15)
            cv2.line(image, (x1, y1), (x2, y2), (0, 0, 0), 1)
        
        config = LineDetectorConfig(min_line_length=50)
        detector = TableLineDetector(config=config)
        lines = detector.detect_from_image(image)
        
        # 노이즈는 필터링되고 메인 선만 검출
        assert len(lines.horizontal) == 2
        assert len(lines.vertical) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
