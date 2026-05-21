"""
PDF 표 구조 복원 라이브러리

PDF에서 셀 구분선을 검출하여 표 구조를 분석하고 복원합니다.

모듈 구성:
1. line_detector: 표 구분선(수평/수직선) 검출
2. cell_segmentor: 교차점 기반 셀 영역 분할
3. coordinate_manager: 좌표 정보 JSON 저장/로드
4. text_mapper: OCR 텍스트를 셀에 매핑
5. table_builder: 최종 표 구조 구성

사용 예시:
    from app.table_recovery import TableLineDetector, TableCellSegmentor
    
    detector = TableLineDetector()
    lines = detector.detect_from_image(image)
    
    segmentor = TableCellSegmentor()
    cells = segmentor.segment_cells(lines.horizontal, lines.vertical)
"""

from .line_detector import (
    Line,
    TableLines,
    LineDetectorConfig,
    TableLineDetector
)

from .cell_segmentor import (
    CellBbox,
    MergedCell,
    GridInfo,
    SegmentorConfig,
    TableCellSegmentor
)

from .coordinate_manager import (
    CellCoordinate,
    TableStructureMetadata,
    CoordinateManager
)

from .text_mapper import (
    WordInfo,
    TextMapperConfig,
    CellTextMapper
)

from .table_builder import (
    TableCell,
    Table,
    TableBuilder
)

from .table_recovery_service import (
    TableRecoveryConfig,
    RecoveredTable,
    TableRecoveryService,
    extract_tables_from_pdf,
    get_table_structure
)

__all__ = [
    # Line Detector
    'Line',
    'TableLines',
    'LineDetectorConfig',
    'TableLineDetector',
    # Cell Segmentor
    'CellBbox',
    'MergedCell',
    'GridInfo',
    'SegmentorConfig',
    'TableCellSegmentor',
    # Coordinate Manager
    'CellCoordinate',
    'TableStructureMetadata',
    'CoordinateManager',
    # Text Mapper
    'WordInfo',
    'TextMapperConfig',
    'CellTextMapper',
    # Table Builder
    'TableCell',
    'Table',
    'TableBuilder',
    # Table Recovery Service
    'TableRecoveryConfig',
    'RecoveredTable',
    'TableRecoveryService',
    'extract_tables_from_pdf',
    'get_table_structure'
]

__version__ = '1.0.0'
