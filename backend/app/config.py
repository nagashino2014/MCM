"""
설정 관리 모듈
"""
import os
from pathlib import Path
from pydantic import BaseModel
from typing import Optional

# 기본 경로 설정
BASE_DIR = Path(__file__).parent.parent
IS_DOCKER = os.environ.get("DOCKER_ENV") == "true"

if IS_DOCKER:
    # Docker 환경: 볼륨 마운트 경로 사용
    FRONTEND_DIR = Path("/app")
    SCRAPING_DATA_DIR = Path("/app/save/ScrapingData")
    EXTRACTED_DATA_DIR = Path("/app/save/ExtractedData")
else:
    # 로컬 환경: 상대 경로 사용
    FRONTEND_DIR = BASE_DIR.parent / "frontend"
    SCRAPING_DATA_DIR = FRONTEND_DIR / "save" / "ScrapingData"
    EXTRACTED_DATA_DIR = FRONTEND_DIR / "save" / "ExtractedData"

# 디렉토리 생성 (객체 스토리지 모드가 아닌 경우에만 로컬 디렉토리 생성)
USE_R2 = bool(os.environ.get("R2_ENDPOINT"))
USE_OBJECT_STORAGE = USE_R2 or bool(os.environ.get("MCM_STORAGE_BUCKET") or os.environ.get("S3_BUCKET_NAME"))
if not USE_OBJECT_STORAGE:
    EXTRACTED_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Cloudflare R2 설정 ─────────────────────────────────────
R2_ENDPOINT = os.environ.get("R2_ENDPOINT")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "webscraper-data")


class OCRSettings(BaseModel):
    """OCR 설정"""
    engine: str = "paddleocr"  # paddleocr, hybrid, easyocr, tesseract
    use_gpu: bool = True  # GPU 사용 (CUDA 설치 필요)
    languages: list[str] = ["korean", "en"]
    det_db_thresh: float = 0.3          # 문자 감지 민감도 (낮을수록 더 많이 감지)
    det_db_box_thresh: float = 0.5      # 박스 감지 민감도
    drop_score: float = 0.5             # 신뢰도 임계값 (이하는 버림)
    confidence_threshold: float = 0.5   # OCR 결과 신뢰도 임계값


class PDFSettings(BaseModel):
    """PDF 추출 설정"""
    prefer_text_layer: bool = True
    enable_ocr: bool = True
    extract_image_text: bool = False
    render_dpi: int = 300
    ocr_languages: list[str] = ["kor", "eng"]
    # 추출 전략 옵션
    force_ocr_mode: bool = False          # 강제 OCR 모드 (텍스트 레이어 무시)
    hybrid_extraction: bool = False       # 하이브리드 추출 (텍스트+OCR 병합)
    page_optimal_method: bool = False     # 페이지별 최적 방법 자동 선택
    # 페이지 범위 추출 (1-indexed, 미지정 시 전체 페이지)
    start_page: Optional[int] = None      # 시작 페이지 (예: 1)
    end_page: Optional[int] = None        # 종료 페이지 (예: 10)
    # 표 추출 설정
    extract_tables: bool = True           # 표 구조 추출 활성화
    table_output_format: str = "markdown" # markdown, html, csv
    min_table_rows: int = 2               # 최소 행 수 (노이즈 필터링)
    min_table_cols: int = 2               # 최소 열 수


class HWPSettings(BaseModel):
    """HWP/HWPX 추출 설정"""
    preserve_table_structure: bool = True   # 표 구조 유지
    convert_bullets: bool = True            # 글머리 기호 변환
    include_footnotes: bool = True          # 각주/미주 포함
    encoding: str = "auto"                  # auto, utf-8, euc-kr
    # 표 추출 설정
    extract_tables: bool = True             # 표 구조 추출 활성화
    table_output_format: str = "markdown"   # markdown, html, csv
    min_table_rows: int = 2                 # 최소 행 수 (노이즈 필터링)
    min_table_cols: int = 2                 # 최소 열 수


class XLSXSettings(BaseModel):
    """XLSX 추출 설정"""
    # 표 추출 설정
    extract_tables: bool = True             # 표 구조 추출 활성화
    table_output_format: str = "markdown"   # markdown, html, csv
    min_table_rows: int = 2                 # 최소 행 수 (노이즈 필터링)
    min_table_cols: int = 2                 # 최소 열 수
    max_rows: int = 10000                   # 최대 행 수 제한
    max_cols: int = 100                     # 최대 열 수 제한
    
    # JSON 구조화 변환 설정
    output_mode: str = "structured"         # "text" | "structured" (JSON 구조화)
    preserve_multi_header: bool = True      # 다중 헤더 구조 보존
    detect_header_rows: int = 5             # 헤더 감지 최대 행 수
    
    # 시트별 청킹 설정
    chunk_large_sheets: bool = True         # 대용량 시트 청킹 활성화
    chunk_row_size: int = 500               # 청크당 행 수
    include_header_in_chunks: bool = True   # 각 청크에 헤더 포함
    
    # 스트리밍 처리 설정
    streaming_threshold_mb: float = 5.0     # 스트리밍 처리 임계값 (MB)
    read_only_mode: bool = True             # 읽기 전용 모드 (메모리 효율)


class DOCXSettings(BaseModel):
    """DOCX 추출 설정"""
    # 표 추출 설정
    extract_tables: bool = True             # 표 구조 추출 활성화
    table_output_format: str = "markdown"   # markdown, html, csv
    min_table_rows: int = 2                 # 최소 행 수 (노이즈 필터링)
    min_table_cols: int = 2                 # 최소 열 수


class PreprocessingSettings(BaseModel):
    """전처리 설정"""
    enabled: bool = True
    adaptive_preprocessing: bool = True
    deskew: bool = True                   # 기울기 보정
    denoise: bool = True                  # 노이즈 제거
    binarize: bool = False                # 이미지 이진화
    contrast_enhancement: bool = True     # 대비 강화
    target_dpi: int = 300                 # 렌더링 DPI


class EncodingSettings(BaseModel):
    """인코딩 복구 설정"""
    auto_detect: bool = True              # 인코딩 자동 감지
    force_encoding: str = "auto"          # 강제 인코딩 (auto, utf-8, euc-kr, cp949, utf-16)
    fix_utf16_errors: bool = True         # UTF-16 오류 복구
    remove_broken_chars: bool = True      # 깨진 문자 제거
    try_multiple_encodings: bool = True   # 여러 인코딩 시도


class RetryStrategySettings(BaseModel):
    """재추출 전략 설정"""
    enable_progressive_retry: bool = False    # 단계적 재시도 활성화
    multi_engine_comparison: bool = False     # 다중 엔진 비교 (최고 품질 선택)
    quality_based_adjustment: bool = False    # 품질 항목별 자동 조정
    max_progressive_levels: int = 3           # 최대 단계적 재시도 레벨
    engines_to_compare: list[str] = ["paddleocr", "easyocr", "tesseract"]  # 비교할 엔진 목록


class TableNormalizationSettings(BaseModel):
    """표 정규화 설정"""
    enabled: bool = True                      # 표 정규화 활성화
    flatten_headers: bool = True              # 다중 헤더 병합 (예: 2024년_금액)
    flatten_hierarchy: bool = True            # 계층 구조 평탄화 (예: 전자부품 > 반도체)
    hierarchy_separator: str = " > "          # 계층 구분자
    fill_empty_cells: bool = True             # 빈 셀 채우기
    empty_cell_strategy: str = "dash"         # inherit(위 셀 상속), dash(-), null
    normalize_column_count: bool = True       # 열 수 정규화
    remove_decoration_chars: bool = True      # 장식 문자 제거 (ㅇ, -, ㆍ, ※ 등)
    min_data_rows: int = 1                    # 최소 데이터 행 수 (헤더 제외)
    max_header_rows: int = 3                  # 최대 헤더 행 수


class PostprocessingSettings(BaseModel):
    """후처리 설정"""
    remove_headers: bool = True
    remove_page_numbers: bool = True
    normalize_whitespace: bool = True
    normalize_special_chars: bool = True
    ocr_error_correction: bool = True
    domain_term_correction: bool = True


class QualityValidationSettings(BaseModel):
    """품질 검증 설정"""
    enabled: bool = True
    pass_threshold: float = 0.85
    llm_fallback_threshold: float = 0.50
    auto_llm_fallback: bool = True


class ProcessingSettings(BaseModel):
    """처리 설정"""
    concurrent_files: int = 2              # 대용량 파일 처리 시 메모리 절약
    timeout_seconds: int = 600             # 10분으로 증가 (대용량 PDF용)
    auto_retry: bool = True
    max_retries: int = 2
    large_file_threshold_mb: float = 5.0   # 이 크기 이상은 대용량 파일로 처리
    large_file_timeout_seconds: int = 900  # 대용량 파일 15분 타임아웃


class ExtractionConfig(BaseModel):
    """전체 추출 설정"""
    ocr: OCRSettings = OCRSettings()
    pdf: PDFSettings = PDFSettings()
    hwp: HWPSettings = HWPSettings()
    xlsx: XLSXSettings = XLSXSettings()
    docx: DOCXSettings = DOCXSettings()
    preprocessing: PreprocessingSettings = PreprocessingSettings()
    encoding: EncodingSettings = EncodingSettings()
    postprocessing: PostprocessingSettings = PostprocessingSettings()
    table_normalization: TableNormalizationSettings = TableNormalizationSettings()
    quality_validation: QualityValidationSettings = QualityValidationSettings()
    processing: ProcessingSettings = ProcessingSettings()
    retry_strategy: RetryStrategySettings = RetryStrategySettings()


# 기본 설정 인스턴스
default_config = ExtractionConfig()
