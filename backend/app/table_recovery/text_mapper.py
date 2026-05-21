"""
텍스트 매퍼 (Text Mapper)

OCR/텍스트 추출 결과를 셀에 매핑하는 모듈입니다.

주요 기능:
1. 텍스트(단어)를 해당 셀에 매핑
2. 셀 내 여러 줄 텍스트 처리
3. 텍스트 읽기 순서 정렬 (y → x)
4. 겹치는 영역 기반 귀속 판정

사용 예시:
    from app.table_recovery import CellTextMapper
    
    mapper = CellTextMapper()
    
    # 단어 목록을 셀에 매핑
    cell_texts = mapper.map_text_to_cells(words, cells_metadata)
    
    # 셀 내 멀티라인 텍스트 처리
    text = mapper.handle_multiline_cells(bbox, words)
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Any
import re


@dataclass
class WordInfo:
    """
    단어 정보 (좌표 포함)
    
    Attributes:
        text: 단어 텍스트
        x0: 좌측 x 좌표
        y0: 상단 y 좌표
        x1: 우측 x 좌표
        y1: 하단 y 좌표
        confidence: OCR 신뢰도 (선택)
    """
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float = 1.0
    
    @property
    def width(self) -> float:
        """단어 너비"""
        return self.x1 - self.x0
    
    @property
    def height(self) -> float:
        """단어 높이"""
        return self.y1 - self.y0
    
    @property
    def area(self) -> float:
        """단어 영역 면적"""
        return self.width * self.height
    
    @property
    def center(self) -> Tuple[float, float]:
        """단어 중심점"""
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)
    
    @property
    def bbox(self) -> Tuple[float, float, float, float]:
        """bbox 튜플"""
        return (self.x0, self.y0, self.x1, self.y1)
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'text': self.text,
            'x0': self.x0,
            'y0': self.y0,
            'x1': self.x1,
            'y1': self.y1,
            'confidence': self.confidence
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'WordInfo':
        """딕셔너리에서 생성"""
        return cls(
            text=data['text'],
            x0=data['x0'],
            y0=data['y0'],
            x1=data['x1'],
            y1=data['y1'],
            confidence=data.get('confidence', 1.0)
        )
    
    @classmethod
    def from_pdfplumber_word(cls, word: dict) -> 'WordInfo':
        """pdfplumber 단어 객체에서 생성"""
        return cls(
            text=word.get('text', ''),
            x0=float(word.get('x0', 0)),
            y0=float(word.get('top', 0)),
            x1=float(word.get('x1', 0)),
            y1=float(word.get('bottom', 0))
        )
    
    @classmethod
    def from_ocr_result(cls, box: List, text: str, confidence: float = 1.0) -> 'WordInfo':
        """
        OCR 결과(box 좌표)에서 생성
        
        Args:
            box: [[x0,y0], [x1,y0], [x1,y1], [x0,y1]] 형식
            text: 인식된 텍스트
            confidence: 신뢰도
        """
        if len(box) >= 4:
            x_coords = [p[0] for p in box]
            y_coords = [p[1] for p in box]
            return cls(
                text=text,
                x0=min(x_coords),
                y0=min(y_coords),
                x1=max(x_coords),
                y1=max(y_coords),
                confidence=confidence
            )
        return cls(text=text, x0=0, y0=0, x1=0, y1=0, confidence=confidence)


@dataclass
class TextMapperConfig:
    """
    텍스트 매퍼 설정
    
    Attributes:
        overlap_threshold: 셀 귀속 판정을 위한 최소 겹침 비율
        line_threshold: 줄 구분 임계값 (y 좌표 차이)
        word_spacing_threshold: 단어 간격 임계값
        min_word_confidence: 최소 단어 신뢰도
        prefer_center_point: 중심점 기반 매핑 우선
    """
    overlap_threshold: float = 0.5
    line_threshold: float = 10.0
    word_spacing_threshold: float = 5.0
    min_word_confidence: float = 0.3
    prefer_center_point: bool = True


class CellTextMapper:
    """
    OCR/텍스트 추출 결과를 셀에 매핑
    
    텍스트(단어)를 해당 셀에 배치하고 읽기 순서대로 정렬합니다.
    
    사용 예시:
        mapper = CellTextMapper()
        
        # 단어를 셀에 매핑
        cell_texts = mapper.map_text_to_cells(words, cells)
        
        # 결과: {(row, col): "텍스트 내용", ...}
    """
    
    def __init__(self, config: Optional[TextMapperConfig] = None):
        """
        Args:
            config: 매퍼 설정 (None이면 기본값 사용)
        """
        self.config = config or TextMapperConfig()
    
    def map_text_to_cells(
        self, 
        words: List[WordInfo],
        cells: List[Dict[str, Any]]
    ) -> Dict[Tuple[int, int], str]:
        """
        텍스트를 해당 셀에 매핑
        
        매핑 전략:
        1. 단어 중심점이 셀 영역 내에 있으면 해당 셀에 배치
        2. 경계에 걸친 단어는 더 많이 겹치는 셀에 배치
        3. 셀 내 단어들은 y→x 순서로 정렬하여 연결
        
        Args:
            words: OCR 결과 (좌표 포함)
            cells: 셀 메타데이터 목록 (row_span, col_span, bbox 포함)
            
        Returns:
            Dict[(row, col), text]: 셀별 텍스트
        """
        # 셀별 단어 수집
        cell_words: Dict[Tuple[int, int], List[WordInfo]] = {}
        
        for word in words:
            # 신뢰도 필터링
            if word.confidence < self.config.min_word_confidence:
                continue
            
            # 빈 텍스트 스킵
            if not word.text.strip():
                continue
            
            # 최적 셀 찾기
            best_cell = None
            best_score = 0
            
            for cell in cells:
                row_span = cell.get('row_span', [0, 0])
                col_span = cell.get('col_span', [0, 0])
                bbox = cell.get('bbox', [0, 0, 0, 0])
                
                # 점수 계산 (겹침 비율 또는 중심점 포함 여부)
                if self.config.prefer_center_point:
                    score = self._calculate_center_score(word, bbox)
                else:
                    score = self._calculate_overlap(word, bbox)
                
                if score > best_score:
                    best_score = score
                    best_cell = (row_span[0], col_span[0])
            
            # 임계값 이상인 경우만 매핑
            if best_cell and best_score > 0:
                if best_cell not in cell_words:
                    cell_words[best_cell] = []
                cell_words[best_cell].append(word)
        
        # 각 셀의 단어들을 읽기 순서로 정렬하여 텍스트 생성
        result = {}
        for cell_key, words_list in cell_words.items():
            text = self._words_to_text(words_list)
            result[cell_key] = text
        
        return result
    
    def map_words_to_cell(
        self,
        words: List[WordInfo],
        bbox: Tuple[float, float, float, float]
    ) -> List[WordInfo]:
        """
        특정 셀에 속하는 단어들 추출
        
        Args:
            words: 전체 단어 목록
            bbox: 셀 경계 (x0, y0, x1, y1)
            
        Returns:
            해당 셀에 속하는 단어 목록
        """
        result = []
        
        for word in words:
            if self.config.prefer_center_point:
                score = self._calculate_center_score(word, list(bbox))
            else:
                score = self._calculate_overlap(word, list(bbox))
            
            if score > 0:
                result.append(word)
        
        return result
    
    def handle_multiline_cells(
        self, 
        bbox: Tuple[float, float, float, float],
        words: List[WordInfo],
        line_threshold: Optional[float] = None
    ) -> str:
        """
        셀 내 여러 줄 텍스트 처리
        
        줄바꿈 감지: y 좌표 차이가 임계값 이상이면 새 줄
        
        Args:
            bbox: 셀 경계 (x0, y0, x1, y1)
            words: 셀 내 단어들
            line_threshold: 줄 구분 임계값 (None이면 설정값 사용)
            
        Returns:
            str: 줄바꿈이 포함된 텍스트
        """
        if not words:
            return ""
        
        threshold = line_threshold or self.config.line_threshold
        
        # y 좌표로 정렬
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        
        lines = []
        current_line = [sorted_words[0]]
        current_y = sorted_words[0].y0
        
        for word in sorted_words[1:]:
            if word.y0 - current_y > threshold:
                # 새 줄
                lines.append(current_line)
                current_line = [word]
                current_y = word.y0
            else:
                current_line.append(word)
        
        if current_line:
            lines.append(current_line)
        
        # 각 줄을 x 좌표로 정렬하여 텍스트 생성
        text_lines = []
        for line in lines:
            line.sort(key=lambda w: w.x0)
            text_lines.append(' '.join(w.text for w in line))
        
        return '\n'.join(text_lines)
    
    def extract_words_from_pdfplumber(self, page) -> List[WordInfo]:
        """
        pdfplumber 페이지에서 단어 추출
        
        Args:
            page: pdfplumber 페이지 객체
            
        Returns:
            단어 정보 목록
        """
        words = []
        
        for word in page.extract_words():
            words.append(WordInfo.from_pdfplumber_word(word))
        
        return words
    
    def extract_words_from_ocr_result(
        self, 
        ocr_result: List[Tuple]
    ) -> List[WordInfo]:
        """
        PaddleOCR/EasyOCR 결과에서 단어 추출
        
        Args:
            ocr_result: OCR 결과 [(box, (text, confidence)), ...]
            
        Returns:
            단어 정보 목록
        """
        words = []
        
        for item in ocr_result:
            if len(item) >= 2:
                box = item[0]
                text_conf = item[1]
                
                if isinstance(text_conf, tuple):
                    text, confidence = text_conf
                else:
                    text = str(text_conf)
                    confidence = 1.0
                
                word = WordInfo.from_ocr_result(box, text, confidence)
                if word.text.strip():
                    words.append(word)
        
        return words
    
    def merge_adjacent_words(
        self, 
        words: List[WordInfo],
        spacing_threshold: Optional[float] = None
    ) -> List[WordInfo]:
        """
        인접한 단어들 병합
        
        같은 줄에서 가까이 있는 단어들을 하나로 합침
        
        Args:
            words: 단어 목록
            spacing_threshold: 단어 간격 임계값
            
        Returns:
            병합된 단어 목록
        """
        if not words:
            return []
        
        threshold = spacing_threshold or self.config.word_spacing_threshold
        
        # y 좌표로 그룹화 (같은 줄)
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        
        merged = []
        current = sorted_words[0]
        
        for word in sorted_words[1:]:
            # 같은 줄인지 확인
            same_line = abs(word.y0 - current.y0) < self.config.line_threshold
            # 인접한지 확인
            adjacent = (word.x0 - current.x1) < threshold
            
            if same_line and adjacent:
                # 병합
                current = WordInfo(
                    text=current.text + ' ' + word.text,
                    x0=current.x0,
                    y0=min(current.y0, word.y0),
                    x1=word.x1,
                    y1=max(current.y1, word.y1),
                    confidence=min(current.confidence, word.confidence)
                )
            else:
                merged.append(current)
                current = word
        
        merged.append(current)
        return merged
    
    def filter_words_by_bbox(
        self,
        words: List[WordInfo],
        bbox: Tuple[float, float, float, float],
        margin: float = 0
    ) -> List[WordInfo]:
        """
        특정 영역 내 단어만 필터링
        
        Args:
            words: 전체 단어 목록
            bbox: 필터링 영역 (x0, y0, x1, y1)
            margin: 영역 확장 여유
            
        Returns:
            해당 영역 내 단어 목록
        """
        x0, y0, x1, y1 = bbox
        result = []
        
        for word in words:
            # 중심점이 영역 내에 있는지 확인
            cx, cy = word.center
            if (x0 - margin <= cx <= x1 + margin and
                y0 - margin <= cy <= y1 + margin):
                result.append(word)
        
        return result
    
    # ==================== 내부 메서드 ====================
    
    def _calculate_overlap(
        self, 
        word: WordInfo, 
        bbox: List[float]
    ) -> float:
        """단어와 셀의 겹침 비율 계산"""
        if len(bbox) < 4:
            return 0.0
        
        x0, y0, x1, y1 = bbox
        
        # 겹치는 영역 계산
        overlap_x0 = max(word.x0, x0)
        overlap_y0 = max(word.y0, y0)
        overlap_x1 = min(word.x1, x1)
        overlap_y1 = min(word.y1, y1)
        
        if overlap_x0 >= overlap_x1 or overlap_y0 >= overlap_y1:
            return 0.0
        
        overlap_area = (overlap_x1 - overlap_x0) * (overlap_y1 - overlap_y0)
        word_area = word.area
        
        if word_area == 0:
            return 0.0
        
        return overlap_area / word_area
    
    def _calculate_center_score(
        self,
        word: WordInfo,
        bbox: List[float]
    ) -> float:
        """중심점 기반 점수 계산"""
        if len(bbox) < 4:
            return 0.0
        
        x0, y0, x1, y1 = bbox
        cx, cy = word.center
        
        # 중심점이 셀 내부에 있으면 1.0
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            return 1.0
        
        # 겹침 비율로 폴백
        return self._calculate_overlap(word, bbox) * 0.5
    
    def _words_to_text(self, words: List[WordInfo]) -> str:
        """단어 목록을 텍스트로 변환"""
        if not words:
            return ""
        
        # y → x 순서로 정렬
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        
        # 줄 단위로 그룹화
        lines = []
        current_line = [sorted_words[0]]
        current_y = sorted_words[0].y0
        
        for word in sorted_words[1:]:
            if word.y0 - current_y > self.config.line_threshold:
                lines.append(current_line)
                current_line = [word]
                current_y = word.y0
            else:
                current_line.append(word)
        
        if current_line:
            lines.append(current_line)
        
        # 각 줄을 x 좌표로 정렬하여 텍스트 생성
        text_lines = []
        for line in lines:
            line.sort(key=lambda w: w.x0)
            text_lines.append(' '.join(w.text for w in line))
        
        return ' '.join(text_lines)


# ==================== 유틸리티 함수 ====================

def create_word_info_from_dict(data: dict) -> WordInfo:
    """딕셔너리에서 WordInfo 생성"""
    return WordInfo.from_dict(data)


def merge_cell_texts(
    cell_texts: Dict[Tuple[int, int], str],
    total_rows: int,
    total_cols: int
) -> List[List[str]]:
    """
    셀 텍스트를 2D 그리드로 변환
    
    Args:
        cell_texts: 셀별 텍스트 {(row, col): text}
        total_rows: 총 행 수
        total_cols: 총 열 수
        
    Returns:
        2D 텍스트 그리드
    """
    grid = [['' for _ in range(total_cols)] for _ in range(total_rows)]
    
    for (row, col), text in cell_texts.items():
        if 0 <= row < total_rows and 0 <= col < total_cols:
            grid[row][col] = text
    
    return grid


def clean_cell_text(text: str) -> str:
    """
    셀 텍스트 정리
    
    - 연속 공백 제거
    - 줄바꿈 처리
    - 특수문자 정리
    """
    if not text:
        return ""
    
    # 연속 공백 → 단일 공백
    text = re.sub(r'\s+', ' ', text)
    
    # 앞뒤 공백 제거
    text = text.strip()
    
    return text


# 직접 실행 테스트용
if __name__ == "__main__":
    print("=" * 60)
    print("텍스트 매퍼(Text Mapper) 테스트")
    print("=" * 60)
    
    # 테스트 단어 데이터
    words = [
        WordInfo(text="이름", x0=10, y0=10, x1=50, y1=30),
        WordInfo(text="나이", x0=110, y0=10, x1=150, y1=30),
        WordInfo(text="직업", x0=210, y0=10, x1=250, y1=30),
        WordInfo(text="홍길동", x0=10, y0=60, x1=60, y1=80),
        WordInfo(text="30", x0=110, y0=60, x1=140, y1=80),
        WordInfo(text="개발자", x0=210, y0=60, x1=270, y1=80),
    ]
    
    # 테스트 셀 메타데이터
    cells = [
        {'row_span': [0, 0], 'col_span': [0, 0], 'bbox': [0, 0, 100, 50]},
        {'row_span': [0, 0], 'col_span': [1, 1], 'bbox': [100, 0, 200, 50]},
        {'row_span': [0, 0], 'col_span': [2, 2], 'bbox': [200, 0, 300, 50]},
        {'row_span': [1, 1], 'col_span': [0, 0], 'bbox': [0, 50, 100, 100]},
        {'row_span': [1, 1], 'col_span': [1, 1], 'bbox': [100, 50, 200, 100]},
        {'row_span': [1, 1], 'col_span': [2, 2], 'bbox': [200, 50, 300, 100]},
    ]
    
    # 매퍼 생성 및 매핑
    mapper = CellTextMapper()
    cell_texts = mapper.map_text_to_cells(words, cells)
    
    print("\n매핑 결과:")
    for (row, col), text in sorted(cell_texts.items()):
        print(f"  ({row}, {col}): {text}")
    
    # 그리드로 변환
    grid = merge_cell_texts(cell_texts, 2, 3)
    
    print("\n2D 그리드:")
    for row in grid:
        print(f"  {row}")
    
    print("\n테스트 완료!")
