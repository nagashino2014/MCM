"""
표 구조 복원 통합 서비스

PDF에서 선 검출 기반으로 표 구조를 분석하고 복원하는 통합 서비스입니다.
기존 pdfplumber 방식과 함께 사용하여 표 추출 품질을 향상시킵니다.

사용 예시:
    from app.table_recovery import TableRecoveryService
    
    service = TableRecoveryService()
    
    # PDF에서 표 추출
    tables = service.extract_tables_from_pdf(pdf_path, page_num=0)
    
    # 기존 pdfplumber 결과 개선
    improved = service.improve_table_extraction(plumber_page, plumber_table)
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Any
from pathlib import Path
import json

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False
    fitz = None

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False
    pdfplumber = None

from .line_detector import TableLineDetector, LineDetectorConfig, TableLines
from .cell_segmentor import TableCellSegmentor, SegmentorConfig, CellBbox, MergedCell
from .coordinate_manager import CoordinateManager, TableStructureMetadata
from .text_mapper import CellTextMapper, TextMapperConfig, WordInfo
from .table_builder import TableBuilder, Table, TableCell


@dataclass
class TableRecoveryConfig:
    """
    표 복원 서비스 설정
    
    Attributes:
        enable_line_detection: 선 검출 기반 복원 활성화
        enable_cache: 메타데이터 캐싱 활성화
        cache_dir: 캐시 디렉토리
        detection_method: 선 검출 방법 ('vector', 'image', 'hybrid')
        min_confidence: 최소 신뢰도
        fallback_to_pdfplumber: 실패 시 pdfplumber로 폴백
    """
    enable_line_detection: bool = True
    enable_cache: bool = True
    cache_dir: str = "./table_cache"
    detection_method: str = "hybrid"
    min_confidence: float = 0.5
    fallback_to_pdfplumber: bool = True
    dpi: int = 150
    
    # 선 검출 설정
    min_line_length: int = 30
    merge_tolerance: float = 5.0
    hough_threshold: int = 80


@dataclass
class RecoveredTable:
    """
    복원된 표 결과
    
    Attributes:
        table: 복원된 표 객체
        markdown: 마크다운 문자열
        html: HTML 문자열
        metadata: 메타데이터 (셀 좌표 등)
        recovery_method: 사용된 복원 방법
        confidence: 복원 신뢰도
    """
    table: Table
    markdown: str
    html: str
    metadata: Optional[TableStructureMetadata]
    recovery_method: str
    confidence: float
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return {
            'rows': self.table.rows,
            'cols': self.table.cols,
            'cells': [c.to_dict() for c in self.table.cells],
            'markdown': self.markdown,
            'recovery_method': self.recovery_method,
            'confidence': self.confidence
        }


class TableRecoveryService:
    """
    표 구조 복원 통합 서비스
    
    선 검출 기반의 표 구조 복원과 기존 pdfplumber 방식을 결합하여
    최적의 표 추출 결과를 제공합니다.
    
    사용 예시:
        service = TableRecoveryService()
        
        # PDF 파일에서 표 추출
        tables = service.extract_tables_from_pdf("document.pdf", page_num=0)
        
        # 마크다운으로 출력
        for table in tables:
            print(table.markdown)
    """
    
    def __init__(self, config: Optional[TableRecoveryConfig] = None):
        """
        Args:
            config: 서비스 설정 (None이면 기본값 사용)
        """
        self.config = config or TableRecoveryConfig()
        
        # 컴포넌트 초기화
        self._init_components()
    
    def _init_components(self):
        """내부 컴포넌트 초기화"""
        # 선 검출기
        line_config = LineDetectorConfig(
            min_line_length=self.config.min_line_length,
            merge_tolerance=self.config.merge_tolerance,
            hough_threshold=self.config.hough_threshold,
            dpi=self.config.dpi
        )
        self.line_detector = TableLineDetector(config=line_config)
        
        # 셀 분할기
        self.cell_segmentor = TableCellSegmentor()
        
        # 좌표 관리자
        if self.config.enable_cache:
            cache_path = Path(self.config.cache_dir)
            self.coord_manager = CoordinateManager(cache_dir=cache_path)
        else:
            self.coord_manager = None
        
        # 텍스트 매퍼
        self.text_mapper = CellTextMapper()
        
        # 표 구성기
        self.table_builder = TableBuilder()
    
    def extract_tables_from_pdf(
        self,
        pdf_path: str,
        page_num: int = 0,
        use_cache: bool = True
    ) -> List[RecoveredTable]:
        """
        PDF 파일에서 표 추출
        
        Args:
            pdf_path: PDF 파일 경로
            page_num: 페이지 번호 (0-based)
            use_cache: 캐시 사용 여부
            
        Returns:
            추출된 표 목록
        """
        if not HAS_FITZ:
            print("[WARNING] PyMuPDF not installed. Using pdfplumber fallback.")
            return self._extract_with_pdfplumber(pdf_path, page_num)
        
        results = []
        
        try:
            doc = fitz.open(pdf_path)
            
            if page_num < 0 or page_num >= len(doc):
                doc.close()
                return []
            
            page = doc[page_num]
            
            # 캐시 확인
            if use_cache and self.coord_manager:
                pdf_hash = CoordinateManager.create_pdf_hash(pdf_path)
                cached = self.coord_manager.find_cached(pdf_hash, page_num + 1)
                
                if cached:
                    # 캐시된 메타데이터로 표 복원
                    table = self._build_table_from_cache(page, cached)
                    if table:
                        results.append(table)
                        doc.close()
                        return results
            
            # 선 검출 기반 추출
            if self.config.enable_line_detection:
                line_tables = self._extract_with_line_detection(page, pdf_path, page_num)
                results.extend(line_tables)
            
            # pdfplumber 폴백
            if not results and self.config.fallback_to_pdfplumber:
                plumber_tables = self._extract_with_pdfplumber(pdf_path, page_num)
                results.extend(plumber_tables)
            
            doc.close()
            
        except Exception as e:
            print(f"[TableRecovery ERROR] {e}")
            # 폴백
            if self.config.fallback_to_pdfplumber:
                return self._extract_with_pdfplumber(pdf_path, page_num)
        
        return results
    
    def extract_tables_from_page(
        self,
        page,
        pdf_path: Optional[str] = None,
        page_num: int = 0
    ) -> List[RecoveredTable]:
        """
        PyMuPDF 페이지 객체에서 표 추출
        
        Args:
            page: fitz.Page 객체
            pdf_path: PDF 파일 경로 (캐싱용)
            page_num: 페이지 번호
            
        Returns:
            추출된 표 목록
        """
        return self._extract_with_line_detection(page, pdf_path, page_num)
    
    def improve_pdfplumber_table(
        self,
        plumber_page,
        plumber_table: List[List[str]],
        table_bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> Optional[RecoveredTable]:
        """
        pdfplumber로 추출한 표를 선 검출 기반으로 개선
        
        기존 pdfplumber 결과가 붕괴된 경우 선 검출을 통해 복원 시도
        
        Args:
            plumber_page: pdfplumber 페이지 객체
            plumber_table: pdfplumber로 추출한 표 데이터
            table_bbox: 표의 bbox (선택)
            
        Returns:
            개선된 표 또는 None
        """
        if not self._is_collapsed_table(plumber_table):
            # 붕괴되지 않은 표는 그대로 반환
            return self._convert_plumber_to_recovered(plumber_table)
        
        # 붕괴된 표 감지 - 선 검출로 복원 시도
        try:
            # pdfplumber 페이지에서 PDF 바이트 추출
            # (이 부분은 pdfplumber의 내부 구조에 따라 다를 수 있음)
            
            # 텍스트와 좌표 추출
            words = plumber_page.extract_words()
            word_infos = [WordInfo.from_pdfplumber_word(w) for w in words]
            
            # bbox 영역 필터링
            if table_bbox:
                word_infos = self.text_mapper.filter_words_by_bbox(
                    word_infos, table_bbox, margin=5
                )
            
            if not word_infos:
                return None
            
            # 간단한 그리드 기반 복원
            return self._reconstruct_from_words(word_infos, table_bbox)
            
        except Exception as e:
            print(f"[TableRecovery] Improvement failed: {e}")
            return None
    
    def get_table_structure(
        self,
        pdf_path: str,
        page_num: int = 0
    ) -> Optional[TableStructureMetadata]:
        """
        표 구조 메타데이터만 추출 (텍스트 없이)
        
        선 검출 기반으로 셀 좌표 정보만 추출합니다.
        나중에 OCR이나 다른 방식으로 텍스트를 매핑할 때 사용.
        
        Args:
            pdf_path: PDF 파일 경로
            page_num: 페이지 번호
            
        Returns:
            표 구조 메타데이터
        """
        if not HAS_FITZ:
            return None
        
        try:
            doc = fitz.open(pdf_path)
            page = doc[page_num]
            
            # 선 검출
            lines = self.line_detector.detect_hybrid(page)
            
            if not lines.is_valid_table():
                doc.close()
                return None
            
            # 셀 분할
            cells = self.cell_segmentor.segment_cells(
                lines.horizontal, lines.vertical
            )
            
            if not cells:
                doc.close()
                return None
            
            # 병합 셀 감지
            merged = self.cell_segmentor.detect_merged_cells(cells, lines)
            
            # 메타데이터 생성
            pdf_hash = CoordinateManager.create_pdf_hash(pdf_path)
            metadata = self.coord_manager.create_metadata(
                pdf_hash=pdf_hash,
                page_num=page_num + 1,
                table_index=0,
                cells=cells,
                merged_cells=merged,
                detection_method=self.config.detection_method,
                bbox=lines.bbox,
                page_size=lines.page_size
            ) if self.coord_manager else None
            
            doc.close()
            return metadata
            
        except Exception as e:
            print(f"[TableRecovery] Structure extraction failed: {e}")
            return None
    
    # ==================== 내부 메서드 ====================
    
    def _extract_with_line_detection(
        self,
        page,
        pdf_path: Optional[str],
        page_num: int
    ) -> List[RecoveredTable]:
        """선 검출 기반 표 추출"""
        results = []
        
        try:
            # 1. 선 검출
            print(f"[LineDetection] Page {page_num}: 선 검출 시작")
            try:
                lines = self.line_detector.detect_hybrid(page)
            except Exception as e:
                print(f"[LineDetection] Page {page_num}: 선 검출 중 오류 - {e}")
                return []
            
            print(f"[LineDetection] Page {page_num}: H={len(lines.horizontal)}, V={len(lines.vertical)}, "
                  f"valid={lines.is_valid_table()}")
            
            if not lines.is_valid_table():
                print(f"[LineDetection] Page {page_num}: 유효한 표 선 미감지")
                return []
            
            # 1.5. 별도 표 영역 분리 (제목 박스와 실제 표가 합쳐지는 문제 방지)
            separate_tables = lines.split_into_separate_tables(gap_threshold=40.0)
            if len(separate_tables) > 1:
                print(f"[LineDetection] Page {page_num}: {len(separate_tables)}개의 별도 표 영역 감지")
                # 각 분리된 표에 대해 재귀적으로 처리
                for table_idx, table_lines in enumerate(separate_tables):
                    if table_lines.is_valid_table():
                        sub_results = self._process_single_table(page, table_lines, pdf_path, page_num, table_idx)
                        results.extend(sub_results)
                return results
            
            # 단일 표인 경우 계속 진행
            lines = separate_tables[0] if separate_tables else lines
            
            # 2. 셀 분할
            cells = self.cell_segmentor.segment_cells(
                lines.horizontal, lines.vertical
            )
            
            print(f"[LineDetection] Page {page_num}: 셀 {len(cells) if cells else 0}개 분할됨")
            
            if not cells:
                print(f"[LineDetection] Page {page_num}: 셀 분할 실패")
                return []
            
            # 1셀 표(텍스트 박스) 필터링 - 셀이 1개뿐이면 표가 아님
            if len(cells) == 1:
                print(f"[LineDetection] Page {page_num}: 1셀 표(텍스트 박스) 스킵")
                return []
            
            # 2셀 이하인 경우도 의심 (헤더+데이터 1행이 최소)
            if len(cells) <= 2:
                # 셀 크기 비율 확인 - 하나의 셀이 너무 크면 텍스트 박스일 가능성
                cell_sizes = [(c.x1 - c.x0) * (c.y1 - c.y0) for c in cells]
                max_size = max(cell_sizes)
                min_size = min(cell_sizes)
                if max_size > min_size * 10:  # 한 셀이 다른 셀의 10배 이상이면
                    print(f"[LineDetection] Page {page_num}: 불균형 셀 크기 - 텍스트 박스로 간주하여 스킵")
                    return []
            
            # 3. 병합 셀 감지
            merged = self.cell_segmentor.detect_merged_cells(cells, lines)
            
            # 4. 텍스트 추출 및 매핑
            cell_texts = self._extract_and_map_text(page, cells, merged)
            
            # 5. 메타데이터 생성
            pdf_hash = ""
            if pdf_path:
                pdf_hash = CoordinateManager.create_pdf_hash(pdf_path)
            
            metadata = None
            if self.coord_manager:
                metadata = self.coord_manager.create_metadata(
                    pdf_hash=pdf_hash,
                    page_num=page_num + 1,
                    table_index=0,
                    cells=cells,
                    merged_cells=merged,
                    detection_method=self.config.detection_method,
                    bbox=lines.bbox,
                    page_size=lines.page_size
                )
                
                # 캐시 저장
                if self.config.enable_cache and metadata:
                    self.coord_manager.save_to_json(metadata)
            
            # 6. 표 구성
            if metadata:
                table = self.table_builder.build_table(metadata, cell_texts)
            else:
                # 메타데이터 없이 직접 표 구성
                table = self._build_table_directly(cells, merged, cell_texts)
            
            if table and table.cell_count > 0:
                # 신뢰도 계산
                confidence = self._calculate_confidence(lines, cells, cell_texts)
                
                results.append(RecoveredTable(
                    table=table,
                    markdown=table.to_markdown(),
                    html=table.to_html(include_style=False),
                    metadata=metadata,
                    recovery_method="line_detection",
                    confidence=confidence
                ))
        
        except Exception as e:
            print(f"[LineDetection ERROR] {e}")
        
        return results
    
    def _process_single_table(
        self,
        page,
        lines: 'TableLines',
        pdf_path: Optional[str],
        page_num: int,
        table_idx: int = 0
    ) -> List[RecoveredTable]:
        """단일 표 영역 처리"""
        results = []
        
        try:
            # 셀 분할
            cells = self.cell_segmentor.segment_cells(
                lines.horizontal, lines.vertical
            )
            
            if not cells or len(cells) < 2:
                return []
            
            # 1셀 표 필터링
            if len(cells) == 1:
                return []
            
            # 병합 셀 감지
            merged = self.cell_segmentor.detect_merged_cells(cells, lines)
            
            # 텍스트 추출 및 매핑
            cell_texts = self._extract_and_map_text(page, cells, merged)
            
            # 메타데이터 생성
            pdf_hash = CoordinateManager.create_pdf_hash(pdf_path) if pdf_path else ""
            
            metadata = None
            if self.coord_manager:
                metadata = self.coord_manager.create_metadata(
                    pdf_hash=pdf_hash,
                    page_num=page_num + 1,
                    table_index=table_idx,
                    cells=cells,
                    merged_cells=merged,
                    detection_method=self.config.detection_method,
                    bbox=lines.bbox,
                    page_size=lines.page_size
                )
            
            # 표 구성
            if metadata:
                table = self.table_builder.build_table(metadata, cell_texts)
            else:
                table = self._build_table_directly(cells, merged, cell_texts)
            
            if table and table.cell_count > 0:
                confidence = self._calculate_confidence(lines, cells, cell_texts)
                
                results.append(RecoveredTable(
                    table=table,
                    markdown=table.to_markdown(),
                    html=table.to_html(include_style=False),
                    metadata=metadata,
                    recovery_method="line_detection",
                    confidence=confidence
                ))
        
        except Exception as e:
            print(f"[LineDetection] 단일 표 처리 오류: {e}")
        
        return results
    
    def _extract_with_pdfplumber(
        self,
        pdf_path: str,
        page_num: int
    ) -> List[RecoveredTable]:
        """pdfplumber 기반 표 추출"""
        if not HAS_PDFPLUMBER:
            return []
        
        results = []
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                if page_num >= len(pdf.pages):
                    return []
                
                page = pdf.pages[page_num]
                tables = page.extract_tables()
                
                for idx, table_data in enumerate(tables):
                    if not table_data or len(table_data) < 2:
                        continue
                    
                    recovered = self._convert_plumber_to_recovered(
                        table_data, table_index=idx
                    )
                    if recovered:
                        results.append(recovered)
        
        except Exception as e:
            print(f"[pdfplumber ERROR] {e}")
        
        return results
    
    def _extract_and_map_text(
        self,
        page,
        cells: List[CellBbox],
        merged: List[MergedCell]
    ) -> Dict[Tuple[int, int], str]:
        """페이지에서 텍스트 추출 및 셀에 매핑"""
        cell_texts = {}
        
        try:
            # PyMuPDF에서 텍스트 블록 추출
            blocks = page.get_text("dict")["blocks"]
            
            words = []
            for block in blocks:
                if block.get("type") == 0:  # text block
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            if text:
                                bbox = span.get("bbox", (0, 0, 0, 0))
                                words.append(WordInfo(
                                    text=text,
                                    x0=bbox[0],
                                    y0=bbox[1],
                                    x1=bbox[2],
                                    y1=bbox[3]
                                ))
            
            # 셀 메타데이터 생성 (매핑용)
            cells_meta = []
            
            # 병합 셀 좌표 추적
            merged_coords = set()
            for mc in merged:
                for r in range(mc.row_start, mc.row_end + 1):
                    for c in range(mc.col_start, mc.col_end + 1):
                        merged_coords.add((r, c))
                
                cells_meta.append({
                    'row_span': [mc.row_start, mc.row_end],
                    'col_span': [mc.col_start, mc.col_end],
                    'bbox': [mc.bbox.x0, mc.bbox.y0, mc.bbox.x1, mc.bbox.y1]
                })
            
            # 일반 셀
            for cell in cells:
                if (cell.row_idx, cell.col_idx) not in merged_coords:
                    cells_meta.append({
                        'row_span': [cell.row_idx, cell.row_idx],
                        'col_span': [cell.col_idx, cell.col_idx],
                        'bbox': [cell.x0, cell.y0, cell.x1, cell.y1]
                    })
            
            # 텍스트 매핑
            cell_texts = self.text_mapper.map_text_to_cells(words, cells_meta)
            
        except Exception as e:
            print(f"[TextMapping ERROR] {e}")
        
        return cell_texts
    
    def _build_table_directly(
        self,
        cells: List[CellBbox],
        merged: List[MergedCell],
        cell_texts: Dict[Tuple[int, int], str]
    ) -> Table:
        """메타데이터 없이 직접 표 구성"""
        if not cells:
            return Table(rows=0, cols=0)
        
        total_rows = max(c.row_idx for c in cells) + 1
        total_cols = max(c.col_idx for c in cells) + 1
        
        table_cells = []
        
        # 병합 셀 좌표 추적
        merged_coords = set()
        for mc in merged:
            for r in range(mc.row_start, mc.row_end + 1):
                for c in range(mc.col_start, mc.col_end + 1):
                    merged_coords.add((r, c))
            
            table_cells.append(TableCell(
                row=mc.row_start,
                col=mc.col_start,
                rowspan=mc.rowspan,
                colspan=mc.colspan,
                text=cell_texts.get((mc.row_start, mc.col_start), ""),
                bbox=(mc.bbox.x0, mc.bbox.y0, mc.bbox.x1, mc.bbox.y1)
            ))
        
        # 일반 셀
        for cell in cells:
            if (cell.row_idx, cell.col_idx) not in merged_coords:
                table_cells.append(TableCell(
                    row=cell.row_idx,
                    col=cell.col_idx,
                    rowspan=1,
                    colspan=1,
                    text=cell_texts.get((cell.row_idx, cell.col_idx), ""),
                    bbox=(cell.x0, cell.y0, cell.x1, cell.y1)
                ))
        
        return Table(
            rows=total_rows,
            cols=total_cols,
            cells=table_cells
        )
    
    def _build_table_from_cache(
        self,
        page,
        metadata: TableStructureMetadata
    ) -> Optional[RecoveredTable]:
        """캐시된 메타데이터로 표 복원"""
        try:
            # 텍스트 추출 및 매핑
            cell_texts = self._extract_text_with_metadata(page, metadata)
            
            # 표 구성
            table = self.table_builder.build_table(metadata, cell_texts)
            
            return RecoveredTable(
                table=table,
                markdown=table.to_markdown(),
                html=table.to_html(include_style=False),
                metadata=metadata,
                recovery_method="cached",
                confidence=1.0
            )
        except Exception as e:
            print(f"[Cache Build ERROR] {e}")
            return None
    
    def _extract_text_with_metadata(
        self,
        page,
        metadata: TableStructureMetadata
    ) -> Dict[Tuple[int, int], str]:
        """메타데이터를 사용하여 텍스트 추출"""
        cell_texts = {}
        
        try:
            # PyMuPDF에서 텍스트 추출
            blocks = page.get_text("dict")["blocks"]
            
            words = []
            for block in blocks:
                if block.get("type") == 0:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            if text:
                                bbox = span.get("bbox", (0, 0, 0, 0))
                                words.append(WordInfo(
                                    text=text,
                                    x0=bbox[0],
                                    y0=bbox[1],
                                    x1=bbox[2],
                                    y1=bbox[3]
                                ))
            
            # 메타데이터의 셀 정보로 매핑
            cell_texts = self.text_mapper.map_text_to_cells(words, metadata.cells)
            
        except Exception as e:
            print(f"[TextExtract ERROR] {e}")
        
        return cell_texts
    
    def _convert_plumber_to_recovered(
        self,
        table_data: List[List[str]],
        table_index: int = 0
    ) -> Optional[RecoveredTable]:
        """pdfplumber 표 데이터를 RecoveredTable로 변환"""
        if not table_data:
            return None
        
        # 데이터 정리
        cleaned = []
        for row in table_data:
            cleaned_row = []
            for cell in row:
                if cell is None:
                    cleaned_row.append("")
                else:
                    cleaned_row.append(str(cell).strip())
            cleaned.append(cleaned_row)
        
        # Table 객체 생성
        table = self.table_builder.build_from_grid(cleaned)
        
        return RecoveredTable(
            table=table,
            markdown=table.to_markdown(),
            html=table.to_html(include_style=False),
            metadata=None,
            recovery_method="pdfplumber",
            confidence=0.7
        )
    
    def _reconstruct_from_words(
        self,
        words: List[WordInfo],
        bbox: Optional[Tuple[float, float, float, float]]
    ) -> Optional[RecoveredTable]:
        """단어 목록에서 표 재구성"""
        if not words:
            return None
        
        # 간단한 그리드 기반 클러스터링
        # y 좌표로 행 그룹화
        sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
        
        rows = []
        current_row = [sorted_words[0]]
        current_y = sorted_words[0].y0
        
        for word in sorted_words[1:]:
            if word.y0 - current_y > 15:  # 새 행
                rows.append(current_row)
                current_row = [word]
                current_y = word.y0
            else:
                current_row.append(word)
        
        if current_row:
            rows.append(current_row)
        
        if len(rows) < 2:
            return None
        
        # 각 행을 x 좌표로 정렬하여 텍스트 추출
        grid = []
        for row in rows:
            row.sort(key=lambda w: w.x0)
            grid.append([w.text for w in row])
        
        # 열 수 정규화
        max_cols = max(len(r) for r in grid)
        normalized = []
        for row in grid:
            normalized.append(row + [''] * (max_cols - len(row)))
        
        # Table 생성
        table = self.table_builder.build_from_grid(normalized)
        
        return RecoveredTable(
            table=table,
            markdown=table.to_markdown(),
            html=table.to_html(include_style=False),
            metadata=None,
            recovery_method="word_clustering",
            confidence=0.5
        )
    
    def _is_collapsed_table(self, table: List[List[str]]) -> bool:
        """표가 붕괴되었는지 확인"""
        if len(table) > 5:
            return False
        
        for row in table:
            for cell in row:
                if not cell:
                    continue
                
                # 많은 항목이 한 셀에 있으면 붕괴된 것
                items = str(cell).split()
                if len(items) > 10:
                    return True
                
                # 연속 번호 패턴
                import re
                numbers = re.findall(r'\b(\d+)\b', str(cell))
                if len(numbers) >= 5:
                    try:
                        nums = [int(n) for n in numbers[:10]]
                        if nums == list(range(nums[0], nums[0] + len(nums))):
                            return True
                    except:
                        pass
        
        return False
    
    def _calculate_confidence(
        self,
        lines: TableLines,
        cells: List[CellBbox],
        cell_texts: Dict[Tuple[int, int], str]
    ) -> float:
        """복원 신뢰도 계산"""
        confidence = 0.5  # 기본값
        
        # 선 검출 품질
        if lines.is_valid_table():
            confidence += 0.2
        
        # 셀 수
        if len(cells) >= 4:
            confidence += 0.1
        
        # 텍스트 매핑 비율
        if cells:
            mapped_ratio = len(cell_texts) / len(cells)
            confidence += mapped_ratio * 0.2
        
        return min(confidence, 1.0)


# 편의 함수
def extract_tables_from_pdf(
    pdf_path: str,
    page_num: int = 0,
    config: Optional[TableRecoveryConfig] = None
) -> List[RecoveredTable]:
    """
    PDF에서 표 추출 (편의 함수)
    
    Args:
        pdf_path: PDF 파일 경로
        page_num: 페이지 번호 (0-based)
        config: 설정 (선택)
        
    Returns:
        추출된 표 목록
    """
    service = TableRecoveryService(config=config)
    return service.extract_tables_from_pdf(pdf_path, page_num)


def get_table_structure(
    pdf_path: str,
    page_num: int = 0
) -> Optional[TableStructureMetadata]:
    """
    표 구조만 추출 (편의 함수)
    
    Args:
        pdf_path: PDF 파일 경로
        page_num: 페이지 번호
        
    Returns:
        표 구조 메타데이터
    """
    service = TableRecoveryService()
    return service.get_table_structure(pdf_path, page_num)
