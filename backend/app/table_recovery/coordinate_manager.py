"""
좌표 관리자 (Coordinate Manager)

셀 좌표 정보를 JSON으로 저장/로드하는 모듈입니다.

주요 기능:
1. 표 구조 메타데이터 JSON 저장
2. 캐시된 메타데이터 로드
3. PDF 해시 기반 캐시 관리
4. 메타데이터 버전 관리

사용 예시:
    from app.table_recovery import CoordinateManager, TableStructureMetadata
    
    manager = CoordinateManager(cache_dir="./cache")
    
    # 메타데이터 저장
    metadata = manager.create_metadata(pdf_hash, page_num, cells, merged_cells)
    path = manager.save_to_json(metadata)
    
    # 메타데이터 로드
    cached = manager.find_cached(pdf_hash, page_num)
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Tuple
from pathlib import Path
import json
import hashlib
from datetime import datetime

from .cell_segmentor import CellBbox, MergedCell


@dataclass
class CellCoordinate:
    """
    셀 좌표 정보
    
    Attributes:
        row_start: 시작 행 인덱스
        row_end: 종료 행 인덱스 (병합 셀의 경우 row_end > row_start)
        col_start: 시작 열 인덱스
        col_end: 종료 열 인덱스
        bbox: 경계 상자 (x0, y0, x1, y1)
        confidence: 검출 신뢰도
        text: 매핑된 텍스트 (선택적)
    """
    row_start: int
    row_end: int
    col_start: int
    col_end: int
    bbox: Tuple[float, float, float, float]
    confidence: float = 1.0
    text: str = ""
    
    @property
    def is_merged(self) -> bool:
        """병합 셀 여부"""
        return self.row_end > self.row_start or self.col_end > self.col_start
    
    @property
    def rowspan(self) -> int:
        """행 병합 수"""
        return self.row_end - self.row_start + 1
    
    @property
    def colspan(self) -> int:
        """열 병합 수"""
        return self.col_end - self.col_start + 1
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'row_span': [self.row_start, self.row_end],
            'col_span': [self.col_start, self.col_end],
            'bbox': list(self.bbox),
            'is_merged': self.is_merged,
            'confidence': self.confidence,
            'text': self.text
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'CellCoordinate':
        """딕셔너리에서 생성"""
        row_span = data['row_span']
        col_span = data['col_span']
        return cls(
            row_start=row_span[0],
            row_end=row_span[1],
            col_start=col_span[0],
            col_end=col_span[1],
            bbox=tuple(data['bbox']),
            confidence=data.get('confidence', 1.0),
            text=data.get('text', '')
        )


@dataclass 
class TableStructureMetadata:
    """
    표 구조 메타데이터 (JSON 저장용)
    
    Attributes:
        pdf_hash: PDF 파일 해시 (SHA-256 앞 16자)
        page_num: 페이지 번호 (1-based)
        table_index: 페이지 내 테이블 인덱스 (0-based)
        total_rows: 총 행 수
        total_cols: 총 열 수
        cells: 셀 정보 목록
        row_heights: 각 행의 높이
        col_widths: 각 열의 너비
        detection_method: 사용된 검출 방법 ("vector", "hough", "hybrid")
        created_at: 생성 시각 (ISO 8601)
        version: 메타데이터 스키마 버전
    """
    pdf_hash: str
    page_num: int
    table_index: int
    total_rows: int
    total_cols: int
    cells: List[Dict[str, Any]]
    row_heights: List[float]
    col_widths: List[float]
    detection_method: str
    created_at: str
    version: str = "1.0"
    
    # 선택적 필드
    bbox: Optional[Tuple[float, float, float, float]] = None
    page_size: Optional[Tuple[float, float]] = None
    
    @property
    def cell_count(self) -> int:
        """셀 수"""
        return len(self.cells)
    
    @property
    def merged_cell_count(self) -> int:
        """병합 셀 수"""
        return sum(1 for c in self.cells if c.get('is_merged', False))
    
    def get_cell(self, row: int, col: int) -> Optional[Dict]:
        """특정 위치의 셀 정보 반환"""
        for cell in self.cells:
            row_span = cell.get('row_span', [row, row])
            col_span = cell.get('col_span', [col, col])
            if row_span[0] <= row <= row_span[1] and col_span[0] <= col <= col_span[1]:
                return cell
        return None
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환 (JSON 저장용)"""
        data = {
            'pdf_hash': self.pdf_hash,
            'page_num': self.page_num,
            'table_index': self.table_index,
            'detection_info': {
                'method': self.detection_method,
                'created_at': self.created_at,
                'version': self.version
            },
            'structure': {
                'rows': self.total_rows,
                'cols': self.total_cols,
                'row_heights': self.row_heights,
                'col_widths': self.col_widths
            },
            'cells': self.cells
        }
        
        if self.bbox:
            data['bbox'] = list(self.bbox)
        if self.page_size:
            data['page_size'] = list(self.page_size)
        
        return data
    
    @classmethod
    def from_dict(cls, data: dict) -> 'TableStructureMetadata':
        """딕셔너리에서 생성"""
        detection_info = data.get('detection_info', {})
        structure = data.get('structure', {})
        
        return cls(
            pdf_hash=data['pdf_hash'],
            page_num=data['page_num'],
            table_index=data['table_index'],
            total_rows=structure.get('rows', 0),
            total_cols=structure.get('cols', 0),
            cells=data.get('cells', []),
            row_heights=structure.get('row_heights', []),
            col_widths=structure.get('col_widths', []),
            detection_method=detection_info.get('method', 'unknown'),
            created_at=detection_info.get('created_at', ''),
            version=detection_info.get('version', '1.0'),
            bbox=tuple(data['bbox']) if 'bbox' in data else None,
            page_size=tuple(data['page_size']) if 'page_size' in data else None
        )


class CoordinateManager:
    """
    좌표 정보 저장/로드 관리자
    
    PDF 표 구조 메타데이터를 JSON 파일로 관리합니다.
    캐싱을 통해 동일 PDF의 재분석을 방지합니다.
    
    사용 예시:
        manager = CoordinateManager(cache_dir="./table_cache")
        
        # 메타데이터 생성 및 저장
        metadata = manager.create_metadata(...)
        path = manager.save_to_json(metadata)
        
        # 캐시에서 로드
        cached = manager.find_cached(pdf_hash, page_num)
    """
    
    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Args:
            cache_dir: 메타데이터 캐시 디렉토리 (None이면 ./table_cache 사용)
        """
        if cache_dir is None:
            self.cache_dir = Path("./table_cache")
        elif isinstance(cache_dir, str):
            self.cache_dir = Path(cache_dir)
        else:
            self.cache_dir = cache_dir
        
        # 캐시 디렉토리 생성
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def save_to_json(
        self, 
        metadata: TableStructureMetadata, 
        path: Optional[Path] = None
    ) -> Path:
        """
        메타데이터를 JSON 파일로 저장
        
        Args:
            metadata: 표 구조 메타데이터
            path: 저장 경로 (None이면 캐시 디렉토리에 자동 생성)
            
        Returns:
            Path: 저장된 파일 경로
        """
        if path is None:
            filename = self._generate_cache_filename(
                metadata.pdf_hash, 
                metadata.page_num, 
                metadata.table_index
            )
            path = self.cache_dir / filename
        elif isinstance(path, str):
            path = Path(path)
        
        # 딕셔너리로 변환
        data = metadata.to_dict()
        
        # JSON 저장
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return path
    
    def load_from_json(self, path: Path) -> Optional[TableStructureMetadata]:
        """
        JSON 파일에서 메타데이터 로드
        
        Args:
            path: JSON 파일 경로
            
        Returns:
            TableStructureMetadata: 로드된 메타데이터 또는 None
        """
        if isinstance(path, str):
            path = Path(path)
        
        if not path.exists():
            return None
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            return TableStructureMetadata.from_dict(data)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"메타데이터 로드 실패: {e}")
            return None
    
    def find_cached(
        self, 
        pdf_hash: str, 
        page_num: int, 
        table_index: int = 0
    ) -> Optional[TableStructureMetadata]:
        """
        캐시에서 메타데이터 검색
        
        Args:
            pdf_hash: PDF 파일 해시
            page_num: 페이지 번호
            table_index: 테이블 인덱스
            
        Returns:
            캐시된 메타데이터 또는 None
        """
        filename = self._generate_cache_filename(pdf_hash, page_num, table_index)
        path = self.cache_dir / filename
        return self.load_from_json(path)
    
    def find_all_cached_for_pdf(self, pdf_hash: str) -> List[TableStructureMetadata]:
        """
        특정 PDF의 모든 캐시된 메타데이터 검색
        
        Args:
            pdf_hash: PDF 파일 해시
            
        Returns:
            해당 PDF의 모든 메타데이터 목록
        """
        results = []
        pattern = f"{pdf_hash}_p*_t*.json"
        
        for path in self.cache_dir.glob(pattern):
            metadata = self.load_from_json(path)
            if metadata:
                results.append(metadata)
        
        return sorted(results, key=lambda m: (m.page_num, m.table_index))
    
    def delete_cached(
        self, 
        pdf_hash: str, 
        page_num: Optional[int] = None,
        table_index: Optional[int] = None
    ) -> int:
        """
        캐시된 메타데이터 삭제
        
        Args:
            pdf_hash: PDF 파일 해시
            page_num: 페이지 번호 (None이면 모든 페이지)
            table_index: 테이블 인덱스 (None이면 모든 테이블)
            
        Returns:
            삭제된 파일 수
        """
        deleted_count = 0
        
        if page_num is not None and table_index is not None:
            # 특정 파일만 삭제
            filename = self._generate_cache_filename(pdf_hash, page_num, table_index)
            path = self.cache_dir / filename
            if path.exists():
                path.unlink()
                deleted_count = 1
        else:
            # 패턴 매칭으로 삭제
            if page_num is not None:
                pattern = f"{pdf_hash}_p{page_num}_t*.json"
            else:
                pattern = f"{pdf_hash}_p*_t*.json"
            
            for path in self.cache_dir.glob(pattern):
                path.unlink()
                deleted_count += 1
        
        return deleted_count
    
    def create_metadata(
        self,
        pdf_hash: str,
        page_num: int,
        table_index: int,
        cells: List[CellBbox],
        merged_cells: List[MergedCell],
        detection_method: str,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        page_size: Optional[Tuple[float, float]] = None
    ) -> Optional[TableStructureMetadata]:
        """
        셀 정보로부터 메타데이터 생성
        
        Args:
            pdf_hash: PDF 해시
            page_num: 페이지 번호
            table_index: 테이블 인덱스
            cells: 셀 목록
            merged_cells: 병합 셀 목록
            detection_method: 검출 방법
            bbox: 테이블 경계 (선택)
            page_size: 페이지 크기 (선택)
            
        Returns:
            TableStructureMetadata: 생성된 메타데이터 또는 None
        """
        if not cells:
            return None
        
        # 행/열 수 계산
        total_rows = max(c.row_idx for c in cells) + 1
        total_cols = max(c.col_idx for c in cells) + 1
        
        # 행 높이, 열 너비 계산
        row_heights = self._calculate_row_heights(cells, total_rows)
        col_widths = self._calculate_col_widths(cells, total_cols)
        
        # 셀 정보 변환
        cell_data = self._convert_cells_to_data(cells, merged_cells)
        
        return TableStructureMetadata(
            pdf_hash=pdf_hash,
            page_num=page_num,
            table_index=table_index,
            total_rows=total_rows,
            total_cols=total_cols,
            cells=cell_data,
            row_heights=row_heights,
            col_widths=col_widths,
            detection_method=detection_method,
            created_at=datetime.now().isoformat(),
            bbox=bbox,
            page_size=page_size
        )
    
    @staticmethod
    def create_pdf_hash(pdf_path: str) -> str:
        """
        PDF 파일의 해시 생성
        
        Args:
            pdf_path: PDF 파일 경로
            
        Returns:
            str: SHA-256 해시 (처음 16자)
        """
        with open(pdf_path, 'rb') as f:
            content = f.read()
        
        return hashlib.sha256(content).hexdigest()[:16]
    
    @staticmethod
    def create_content_hash(content: bytes) -> str:
        """
        바이트 콘텐츠의 해시 생성
        
        Args:
            content: 바이트 데이터
            
        Returns:
            str: SHA-256 해시 (처음 16자)
        """
        return hashlib.sha256(content).hexdigest()[:16]
    
    # ==================== 내부 메서드 ====================
    
    def _generate_cache_filename(
        self, 
        pdf_hash: str, 
        page_num: int, 
        table_index: int
    ) -> str:
        """캐시 파일명 생성"""
        return f"{pdf_hash}_p{page_num}_t{table_index}.json"
    
    def _calculate_row_heights(
        self, 
        cells: List[CellBbox], 
        total_rows: int
    ) -> List[float]:
        """각 행의 높이 계산"""
        row_heights = []
        
        for row in range(total_rows):
            row_cells = [c for c in cells if c.row_idx == row]
            if row_cells:
                row_heights.append(max(c.height for c in row_cells))
            else:
                row_heights.append(0)
        
        return row_heights
    
    def _calculate_col_widths(
        self, 
        cells: List[CellBbox], 
        total_cols: int
    ) -> List[float]:
        """각 열의 너비 계산"""
        col_widths = []
        
        for col in range(total_cols):
            col_cells = [c for c in cells if c.col_idx == col]
            if col_cells:
                col_widths.append(max(c.width for c in col_cells))
            else:
                col_widths.append(0)
        
        return col_widths
    
    def _convert_cells_to_data(
        self, 
        cells: List[CellBbox], 
        merged_cells: List[MergedCell]
    ) -> List[Dict[str, Any]]:
        """셀 정보를 딕셔너리 리스트로 변환"""
        cell_data = []
        
        # 병합 셀에 포함된 좌표 추적
        merged_coords = set()
        for mc in merged_cells:
            for r in range(mc.row_start, mc.row_end + 1):
                for c in range(mc.col_start, mc.col_end + 1):
                    merged_coords.add((r, c))
            
            # 병합 셀 데이터 추가
            cell_data.append({
                'row_span': [mc.row_start, mc.row_end],
                'col_span': [mc.col_start, mc.col_end],
                'bbox': [mc.bbox.x0, mc.bbox.y0, mc.bbox.x1, mc.bbox.y1],
                'is_merged': mc.is_merged
            })
        
        # 일반 셀 처리 (병합 셀에 포함되지 않은 것만)
        for cell in cells:
            if (cell.row_idx, cell.col_idx) not in merged_coords:
                cell_data.append({
                    'row_span': [cell.row_idx, cell.row_idx],
                    'col_span': [cell.col_idx, cell.col_idx],
                    'bbox': [cell.x0, cell.y0, cell.x1, cell.y1],
                    'is_merged': False
                })
        
        return cell_data


# ==================== 유틸리티 함수 ====================

def export_metadata_to_csv(
    metadata: TableStructureMetadata, 
    output_path: Path
) -> Path:
    """
    메타데이터를 CSV로 내보내기
    
    Args:
        metadata: 표 구조 메타데이터
        output_path: 출력 파일 경로
        
    Returns:
        저장된 파일 경로
    """
    import csv
    
    if isinstance(output_path, str):
        output_path = Path(output_path)
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        
        # 헤더
        writer.writerow([
            'row_start', 'row_end', 'col_start', 'col_end',
            'x0', 'y0', 'x1', 'y1', 'is_merged', 'text'
        ])
        
        # 데이터
        for cell in metadata.cells:
            row_span = cell.get('row_span', [0, 0])
            col_span = cell.get('col_span', [0, 0])
            bbox = cell.get('bbox', [0, 0, 0, 0])
            
            writer.writerow([
                row_span[0], row_span[1],
                col_span[0], col_span[1],
                bbox[0], bbox[1], bbox[2], bbox[3],
                cell.get('is_merged', False),
                cell.get('text', '')
            ])
    
    return output_path


def validate_metadata(metadata: TableStructureMetadata) -> Tuple[bool, List[str]]:
    """
    메타데이터 유효성 검증
    
    Returns:
        Tuple[bool, List[str]]: (유효 여부, 오류 메시지 목록)
    """
    errors = []
    
    # 1. 필수 필드 확인
    if not metadata.pdf_hash:
        errors.append("PDF 해시가 비어있습니다.")
    
    if metadata.page_num < 1:
        errors.append(f"잘못된 페이지 번호: {metadata.page_num}")
    
    if metadata.total_rows < 1:
        errors.append(f"잘못된 행 수: {metadata.total_rows}")
    
    if metadata.total_cols < 1:
        errors.append(f"잘못된 열 수: {metadata.total_cols}")
    
    # 2. 셀 범위 확인
    for i, cell in enumerate(metadata.cells):
        row_span = cell.get('row_span', [])
        col_span = cell.get('col_span', [])
        
        if len(row_span) != 2 or len(col_span) != 2:
            errors.append(f"셀 {i}: 잘못된 span 형식")
            continue
        
        if row_span[0] < 0 or row_span[1] >= metadata.total_rows:
            errors.append(f"셀 {i}: 행 범위 초과 ({row_span})")
        
        if col_span[0] < 0 or col_span[1] >= metadata.total_cols:
            errors.append(f"셀 {i}: 열 범위 초과 ({col_span})")
    
    # 3. 셀 중복 확인
    occupied = set()
    for cell in metadata.cells:
        row_span = cell.get('row_span', [0, 0])
        col_span = cell.get('col_span', [0, 0])
        
        for r in range(row_span[0], row_span[1] + 1):
            for c in range(col_span[0], col_span[1] + 1):
                if (r, c) in occupied:
                    errors.append(f"셀 중복: ({r}, {c})")
                occupied.add((r, c))
    
    return len(errors) == 0, errors


# 직접 실행 테스트용
if __name__ == "__main__":
    print("=" * 60)
    print("좌표 관리자(Coordinate Manager) 테스트")
    print("=" * 60)
    
    # 테스트용 셀 데이터 생성
    from .cell_segmentor import CellBbox, MergedCell
    
    cells = [
        CellBbox(row_idx=0, col_idx=0, x0=0, y0=0, x1=100, y1=50),
        CellBbox(row_idx=0, col_idx=1, x0=100, y0=0, x1=200, y1=50),
        CellBbox(row_idx=0, col_idx=2, x0=200, y0=0, x1=300, y1=50),
        CellBbox(row_idx=1, col_idx=0, x0=0, y0=50, x1=100, y1=100),
        CellBbox(row_idx=1, col_idx=1, x0=100, y0=50, x1=200, y1=100),
        CellBbox(row_idx=1, col_idx=2, x0=200, y0=50, x1=300, y1=100),
    ]
    
    merged_cells = []  # 병합 셀 없음
    
    # 관리자 생성
    manager = CoordinateManager(cache_dir=Path("./test_cache"))
    
    # 메타데이터 생성
    metadata = manager.create_metadata(
        pdf_hash="abc123def456",
        page_num=1,
        table_index=0,
        cells=cells,
        merged_cells=merged_cells,
        detection_method="test"
    )
    
    print(f"\n생성된 메타데이터:")
    print(f"  - PDF 해시: {metadata.pdf_hash}")
    print(f"  - 페이지: {metadata.page_num}")
    print(f"  - 구조: {metadata.total_rows}행 x {metadata.total_cols}열")
    print(f"  - 셀 수: {metadata.cell_count}")
    print(f"  - 병합 셀 수: {metadata.merged_cell_count}")
    
    # JSON 저장
    path = manager.save_to_json(metadata)
    print(f"\n저장 경로: {path}")
    
    # JSON 로드
    loaded = manager.load_from_json(path)
    print(f"\n로드된 메타데이터:")
    print(f"  - 구조: {loaded.total_rows}행 x {loaded.total_cols}열")
    
    # 유효성 검증
    is_valid, errors = validate_metadata(loaded)
    print(f"\n유효성 검증: {'통과' if is_valid else '실패'}")
    if errors:
        for err in errors:
            print(f"  - {err}")
    
    # 정리
    import shutil
    shutil.rmtree("./test_cache", ignore_errors=True)
    
    print("\n테스트 완료!")
