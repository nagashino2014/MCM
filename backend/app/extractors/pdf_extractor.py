"""
PDF 텍스트 추출 모듈
- PyMuPDF를 사용한 텍스트 레이어 추출
- PaddleOCR/EasyOCR/Tesseract를 사용한 스캔 문서 OCR
- 품질 검증 및 후처리 통합
- 모든 설정 옵션 반영
"""
import fitz  # PyMuPDF
import io
import time
import re
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, List, Tuple, Callable, Dict
import numpy as np

import pdfplumber

from .base import (
    BaseExtractor, 
    ExtractionResult, 
    ExtractionStatus,
    ExtractionMethod,
    PageResult,
    QualityDetails,
    TableData,
    detect_utf16_misencoding,
    try_fix_utf16_misencoding,
    clean_binary_garbage,
    apply_encoding_recovery,
    quick_validate_text_quality,
    recover_encoding_with_retry,
    fix_jieut_to_zero
)
from ..config import ExtractionConfig, default_config
from ..utils.pdf_table_restorer import PDFTableRestorer
from ..utils.coordinate_table_extractor import (
    CoordinateTableExtractor,
    CollapsedTableReconstructor
)
# 새로운 선 검출 기반 표 복원 라이브러리
from ..table_recovery import (
    TableRecoveryService,
    TableRecoveryConfig,
    RecoveredTable,
    TableBuilder
)

# OCR 엔진 인스턴스 캐시 (설정별로 다르게 관리)
_ocr_engines = {}
# 사용 불가능한 OCR 엔진 캐시 (중복 오류 방지)
_unavailable_engines = set()


def get_ocr_engine(engine_type: str, config: ExtractionConfig):
    """
    OCR 엔진 인스턴스 가져오기 (설정 기반)
    
    지원 엔진:
    - paddleocr: PaddleOCR (기본, 한국어 최적화)
    - easyocr: EasyOCR (범용)
    - hybrid: PaddleOCR + EasyOCR 결합
    - tesseract: Tesseract OCR (선택적)
    """
    global _ocr_engines, _unavailable_engines
    
    cache_key = f"{engine_type}_{config.ocr.use_gpu}"
    
    # 이미 사용 불가능으로 확인된 엔진은 바로 None 반환
    if engine_type in _unavailable_engines:
        return None
    
    if cache_key in _ocr_engines:
        return _ocr_engines[cache_key]
    
    engine = None
    
    if engine_type == "paddleocr":
        try:
            from paddleocr import PaddleOCR
            # PaddleOCR 버전에 따라 drop_score 인자가 지원되지 않을 수 있음
            # drop_score 없이 먼저 시도 (최신 버전 호환성)
            try:
                engine = PaddleOCR(
                    lang='korean',
                    use_angle_cls=True,
                    use_gpu=config.ocr.use_gpu,
                    show_log=False,
                    ocr_version='PP-OCRv3',
                    det_db_thresh=config.ocr.det_db_thresh,
                    det_db_box_thresh=config.ocr.det_db_box_thresh
                )
            except Exception as e:
                print(f"[OCR WARNING] PaddleOCR 기본 초기화 실패: {e}")
                # 최소 설정으로 재시도
                try:
                    engine = PaddleOCR(
                        lang='korean',
                        use_angle_cls=True,
                        use_gpu=False,
                        show_log=False
                    )
                except Exception as e2:
                    print(f"[OCR ERROR] PaddleOCR 초기화 실패: {e2}")
                    _unavailable_engines.add(engine_type)
                    return None
        except ImportError:
            print("[WARNING] PaddleOCR not installed.")
            _unavailable_engines.add(engine_type)
            return None
    
    elif engine_type == "easyocr":
        try:
            import easyocr
            # 언어 매핑 (EasyOCR 형식)
            lang_map = {
                "korean": "ko", 
                "en": "en", 
                "kor": "ko", 
                "eng": "en",
                "chi_sim": "ch_sim",  # 중국어 간체
                "chi_tra": "ch_tra",  # 중국어 번체
                "ja": "ja",           # 일본어
                "japanese": "ja",
            }
            languages = [lang_map.get(l, l) for l in config.ocr.languages]
            # 지원되지 않는 언어 필터링
            supported_languages = []
            for lang in languages:
                try:
                    # EasyOCR에서 실제 지원하는지 확인
                    if lang in ['ko', 'en', 'ch_sim', 'ch_tra', 'ja']:
                        supported_languages.append(lang)
                except:
                    pass
            if not supported_languages:
                supported_languages = ['ko', 'en']  # 기본값
            engine = easyocr.Reader(supported_languages, gpu=config.ocr.use_gpu)
        except Exception as e:
            print(f"[OCR ERROR] EasyOCR 초기화 실패: {e}")
            _unavailable_engines.add(engine_type)
            return None
    
    elif engine_type == "tesseract":
        try:
            import pytesseract
            # Tesseract 실행 가능 여부 확인
            pytesseract.get_tesseract_version()
            # Tesseract는 함수로 호출하므로 설정만 반환
            engine = {
                "type": "tesseract",
                "lang": "+".join(config.pdf.ocr_languages)
            }
        except ImportError:
            print("[WARNING] pytesseract not installed.")
            _unavailable_engines.add(engine_type)
            return None
        except Exception as e:
            print(f"[WARNING] Tesseract not available: {e}")
            _unavailable_engines.add(engine_type)
            return None
    
    elif engine_type == "hybrid":
        # Hybrid는 paddleocr과 easyocr 모두 필요
        paddle = get_ocr_engine("paddleocr", config)
        easy = get_ocr_engine("easyocr", config)
        if paddle and easy:
            engine = {"paddle": paddle, "easy": easy}
    
    if engine:
        _ocr_engines[cache_key] = engine
    
    return engine


class TimeoutError(Exception):
    """타임아웃 예외"""
    pass


class PDFExtractor(BaseExtractor):
    """
    PDF 텍스트 추출기
    
    추출 전략:
    1. 텍스트 레이어 우선 추출 (PyMuPDF) - prefer_text_layer 옵션
    2. 텍스트가 없거나 품질이 낮으면 OCR 적용 - enable_ocr 옵션
    3. 품질 검증 후 필요시 후처리 - quality_validation.enabled 옵션
    
    설정 옵션:
    - OCR: engine, use_gpu, languages, det_db_thresh, det_db_box_thresh, drop_score
    - PDF: prefer_text_layer, enable_ocr, extract_image_text, render_dpi, ocr_languages
    - 전처리: enabled, adaptive_preprocessing, deskew, denoise, contrast_enhancement
    - 후처리: remove_headers, remove_page_numbers, normalize_whitespace, etc.
    - 품질검증: enabled, pass_threshold, llm_fallback_threshold, auto_llm_fallback
    - 처리: timeout_seconds
    """
    
    SUPPORTED_FORMATS = ["pdf"]
    
    # 깨진 문자 패턴 (OCR 오류 또는 인코딩 문제)
    BROKEN_CHAR_PATTERN = re.compile(r'[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]')
    
    # 한글 패턴
    KOREAN_PATTERN = re.compile(r'[가-힣]')
    
    # 연속 반복 패턴 (OCR 오류)
    REPETITION_PATTERN = re.compile(r'(.)\1{4,}')
    
    # 페이지 번호 패턴
    PAGE_NUMBER_PATTERNS = [
        re.compile(r'^\s*-\s*\d+\s*-\s*$', re.MULTILINE),
        re.compile(r'^\s*\d+\s*/\s*\d+\s*$', re.MULTILINE),
        re.compile(r'^\s*\[\s*\d+\s*\]\s*$', re.MULTILINE),
        re.compile(r'^\s*페이지\s*\d+\s*$', re.MULTILINE),
        re.compile(r'^\s*Page\s*\d+\s*$', re.MULTILINE | re.IGNORECASE),
    ]
    
    # 도메인 용어 교정 사전
    DOMAIN_CORRECTIONS = {
        '환겸부': '환경부',
        '법렁': '법령',
        '시햄': '시행',
        '규젱': '규정',
        '과학기숮': '과학기술',
        '정보봉신': '정보통신',
        '교육븜': '교육부',
        '농렴축산': '농림축산',
        '복지븜': '복지부',
        '국방븜': '국방부',
        '외교븜': '외교부',
    }
    
    def __init__(self, config: Optional[ExtractionConfig] = None):
        self.config = config or default_config
        self._extraction_start_time = None
        self._table_restorer = PDFTableRestorer(
            auto_detect_header=True,
            restore_merged_cells=True,
            normalize_columns=True,
            fill_category_column=True
        )
        # 좌표 기반 테이블 추출기 (붕괴된 표 복구용)
        self._coord_extractor = CoordinateTableExtractor(
            row_tolerance=5.0,
            col_tolerance=10.0,
            verbose=False
        )
        self._table_reconstructor = CollapsedTableReconstructor(verbose=False)
        
        # 선 검출 기반 표 복원 서비스 (새로운 라이브러리)
        self._table_recovery_service = TableRecoveryService(
            config=TableRecoveryConfig(
                enable_line_detection=True,
                enable_cache=True,
                cache_dir="./table_cache",
                detection_method="hybrid",
                fallback_to_pdfplumber=True,
                dpi=self.config.pdf.render_dpi
            )
        )
    
    def update_config(self, config: ExtractionConfig):
        """설정 업데이트"""
        self.config = config
    
    def supports(self, file_format: str) -> bool:
        """PDF 형식 지원 여부"""
        return file_format.lower() in self.SUPPORTED_FORMATS
    
    def extract(self, file_path: str, progress_callback: Optional[Callable] = None) -> ExtractionResult:
        """
        PDF 파일에서 텍스트 추출
        
        Args:
            file_path: PDF 파일 경로
            progress_callback: 진행률 콜백 함수 (page_num, total_pages, status)
            
        Returns:
            ExtractionResult: 추출 결과
        """
        self._extraction_start_time = time.time()
        start_time = self._extraction_start_time
        file_path = Path(file_path)
        
        # 파일 존재 확인
        if not file_path.exists():
            return ExtractionResult(
                file_path=str(file_path),
                file_format="pdf",
                status=ExtractionStatus.FAILED,
                error_message=f"File not found: {file_path}"
            )
        
        # 파일 크기에 따른 기본 타임아웃 설정
        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        large_threshold = getattr(self.config.processing, 'large_file_threshold_mb', 5.0)
        large_timeout = getattr(self.config.processing, 'large_file_timeout_seconds', 900)
        
        if file_size_mb >= large_threshold:
            base_timeout = large_timeout
        else:
            base_timeout = self.config.processing.timeout_seconds
        
        try:
            # PDF 문서 열기
            doc = fitz.open(str(file_path))
            pages: List[PageResult] = []
            all_text_parts: List[str] = []
            total_pages = len(doc)
            
            # 동적 타임아웃 계산: 페이지 수와 이미지 비율 고려
            timeout_seconds = base_timeout
            
            # 1. 페이지 수가 30 이상이면 +300초
            if total_pages >= 30:
                timeout_seconds += 300
            
            # 2. 이미지 페이지 비율 측정 (샘플링: 처음 10페이지만 확인)
            sample_pages = min(10, total_pages)
            ocr_needed_count = 0
            for i in range(sample_pages):
                page_text = doc[i].get_text("text").strip()
                if len(page_text) < 50:  # 텍스트가 거의 없으면 이미지 페이지로 간주
                    ocr_needed_count += 1
            
            image_ratio = ocr_needed_count / sample_pages if sample_pages > 0 else 0
            
            # 이미지 비율에 따른 타임아웃 조정 (100% 이미지 PDF 대폭 증가)
            if image_ratio >= 0.9:
                # 100% 이미지 PDF: 페이지당 30초 + 기본 타임아웃
                timeout_seconds = base_timeout + (total_pages * 30)
                timeout_seconds = min(timeout_seconds, 3600)  # 최대 1시간
            elif image_ratio >= 0.5:
                # 50% 이상 이미지: 페이지당 15초 추가
                timeout_seconds = base_timeout + (total_pages * 15)
                timeout_seconds = min(timeout_seconds, 2400)  # 최대 40분
            elif image_ratio >= 0.2:
                # 20% 이상 이미지: 타임아웃 50% 증가
                timeout_seconds = int(timeout_seconds * 1.5)
            
            # 디버그: PDF 정보 출력
            print(f"[PDF DEBUG] 파일: {file_path.name}, 페이지: {total_pages}, 크기: {file_size_mb:.1f}MB")
            print(f"[PDF DEBUG] 동적 타임아웃: {timeout_seconds}초 (기본={base_timeout}초, 페이지={total_pages}, 이미지비율={image_ratio:.0%})")
            
            # 첫 페이지에서 텍스트 레이어 존재 여부 확인
            first_page_text = doc[0].get_text("text").strip() if total_pages > 0 else ""
            has_text_layer = len(first_page_text) > 50
            is_full_image_pdf = image_ratio >= 0.9  # 90% 이상이면 완전 이미지 PDF
            print(f"[PDF DEBUG] 텍스트 레이어: {'있음' if has_text_layer else '없음 (OCR 필요)'}, 첫 페이지 텍스트 길이: {len(first_page_text)}")

            # 페이지 범위 옵션 적용 (1-indexed). 미지정 시 전체 페이지.
            page_start_idx, page_stop_idx = self._resolve_page_range(total_pages)
            if (page_start_idx, page_stop_idx) != (0, total_pages):
                print(f"[PDF DEBUG] 페이지 범위 추출: {page_start_idx + 1}~{page_stop_idx}p (전체 {total_pages}p 중)")

            # 100% 이미지 PDF인 경우 병렬 OCR 모드 사용
            if is_full_image_pdf and self.config.pdf.enable_ocr:
                print(f"[PDF DEBUG] 100% 이미지 PDF 감지 - 병렬 OCR 모드 사용 (최대 {self._get_ocr_workers()}개 워커)")
                doc.close()
                return self._extract_full_image_pdf(
                    str(file_path), total_pages, timeout_seconds, 
                    start_time, progress_callback
                )
            
            # 중간 결과 저장용 변수
            partial_extraction = False
            last_progress_time = time.time()
            
            for page_num in range(page_start_idx, page_stop_idx):
                page_start = time.time()
                
                # 타임아웃 체크
                elapsed = time.time() - start_time
                if elapsed > timeout_seconds:
                    doc.close()
                    print(f"[PDF DEBUG] 타임아웃! {page_num}/{total_pages} 페이지 처리 완료, 경과: {elapsed:.1f}초")
                    partial_extraction = True
                    
                    # 부분 추출된 텍스트가 있으면 저장 (최소 10% 이상 추출된 경우)
                    if page_num >= total_pages * 0.1 and all_text_parts:
                        print(f"[PDF DEBUG] 부분 추출 결과 저장: {page_num}/{total_pages} 페이지 ({page_num/total_pages*100:.0f}%)")
                        break  # 루프 종료 후 부분 결과 반환
                    else:
                        return ExtractionResult(
                            file_path=str(file_path),
                            file_format="pdf",
                            status=ExtractionStatus.FAILED,
                            error_message=f"Extraction timeout after {timeout_seconds}s (processed {page_num}/{total_pages} pages, {page_num/total_pages*100:.0f}%)",
                            processing_time_ms=int(elapsed * 1000)
                        )
                
                page = doc[page_num]
                page_result = self._extract_page(page, page_num + 1, str(file_path))
                pages.append(page_result)
                all_text_parts.append(page_result.text)
                
                # 디버그: 페이지 처리 시간 (느린 페이지만 출력)
                page_elapsed = time.time() - page_start
                if page_elapsed > 5.0:  # 5초 이상 걸린 페이지만 출력
                    print(f"[PDF DEBUG] 페이지 {page_num+1}/{total_pages}: {page_elapsed:.1f}초 소요")
                
                # 진행률 콜백 (10페이지마다 또는 10초마다)
                current_time = time.time()
                if progress_callback and (page_num % 10 == 0 or current_time - last_progress_time > 10):
                    progress_callback(page_num + 1, total_pages, "extracting")
                    last_progress_time = current_time
            
            doc.close()
            
            # 전체 텍스트 결합
            full_text = "\n\n".join(all_text_parts)
            
            # 후처리 적용 (설정에 따라)
            corrections = []
            if any([
                self.config.postprocessing.remove_headers,
                self.config.postprocessing.remove_page_numbers,
                self.config.postprocessing.normalize_whitespace,
                self.config.postprocessing.normalize_special_chars,
                self.config.postprocessing.ocr_error_correction,
                self.config.postprocessing.domain_term_correction
            ]):
                full_text, corrections = self._apply_postprocessing(full_text)
            
            # PDF 표 구조 복원 (병합 셀 처리, 열 정렬 등)
            if self.config.pdf.extract_tables:
                try:
                    full_text = self._table_restorer.restore_tables(full_text)
                except Exception as e:
                    print(f"[PDF TABLE RESTORE] 표 복원 중 오류: {e}")
            
            # 인코딩 품질 검증 및 자동 복구
            is_valid, quality_score, error_reason = quick_validate_text_quality(full_text)
            
            if not is_valid or quality_score < 0.5:
                # 인코딩 오류 감지 - 복구 시도
                print(f"[PDF] 인코딩 품질 낮음 ({quality_score:.2f}): {error_reason}")
                
                recovered_text, recovery_corrections = recover_encoding_with_retry(full_text)
                _, new_score, _ = quick_validate_text_quality(recovered_text)
                
                if new_score > quality_score:
                    full_text = recovered_text
                    corrections.extend(recovery_corrections)
                    print(f"[PDF] 인코딩 복구 성공: {quality_score:.2f} -> {new_score:.2f}")
            
            # 품질 검증 (설정에 따라)
            if self.config.quality_validation.enabled:
                quality_details = self._validate_quality(full_text)
            else:
                # 품질 검증 비활성화 시 기본값
                quality_details = QualityDetails(overall_score=1.0)
            
            # 주요 추출 방법 결정
            primary_method = self._get_primary_method(pages)
            
            # 토큰 수 계산
            token_count = self._count_tokens(full_text)
            
            # 처리 시간 계산
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            # 품질 점수에 따른 상태 결정
            # 텍스트가 실제로 추출되었으면 COMPLETED로 처리 (품질 점수는 참고용)
            if full_text and len(full_text.strip()) > 0:
                status = ExtractionStatus.COMPLETED
                if quality_details.overall_score < self.config.quality_validation.pass_threshold:
                    print(f"[PDF] 품질 점수 낮음 ({quality_details.overall_score:.2f}) 하지만 텍스트 추출됨, COMPLETED 처리")
                if partial_extraction:
                    print(f"[PDF] 부분 추출: {len(pages)}/{total_pages} 페이지")
            else:
                status = ExtractionStatus.FAILED
            
            # 부분 추출 정보 추가
            extraction_note = None
            if partial_extraction:
                extraction_note = f"Partial extraction: {len(pages)}/{total_pages} pages ({len(pages)/total_pages*100:.0f}%)"
            
            # 에러 메시지에 부분 추출 정보 포함
            error_msg = extraction_note if partial_extraction and status == ExtractionStatus.FAILED else None
            
            return ExtractionResult(
                file_path=str(file_path),
                file_format="pdf",
                status=status,
                text=full_text,
                pages=pages,
                page_count=len(pages),
                quality_score=quality_details.overall_score,
                quality_details=quality_details,
                extraction_method=primary_method,
                char_count=len(full_text),
                token_count=token_count,
                processing_time_ms=processing_time_ms,
                corrections=corrections,
                error_message=error_msg
            )
            
        except Exception as e:
            return ExtractionResult(
                file_path=str(file_path),
                file_format="pdf",
                status=ExtractionStatus.FAILED,
                error_message=str(e),
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _get_ocr_workers(self) -> int:
        """OCR 병렬 처리 워커 수 결정"""
        # GPU 사용 시 1개 (GPU 메모리 공유), CPU 시 최대 4개
        if self.config.ocr.use_gpu:
            return 1  # GPU는 병렬 처리 시 메모리 충돌 가능
        return min(4, max(1, self.config.processing.concurrent_files))

    def _resolve_page_range(self, total_pages: int) -> Tuple[int, int]:
        """
        설정의 start_page/end_page(1-indexed)를 0-indexed [start, stop) 범위로 변환.
        값이 None이거나 비정상이면 전체 페이지 범위를 반환한다.
        """
        cfg = self.config.pdf
        try:
            start_idx = (cfg.start_page - 1) if cfg.start_page else 0
            stop_idx = cfg.end_page if cfg.end_page else total_pages
        except Exception:
            return 0, total_pages

        start_idx = max(0, min(start_idx, total_pages))
        stop_idx = max(0, min(stop_idx, total_pages))
        if stop_idx <= start_idx:
            return 0, total_pages
        return start_idx, stop_idx
    
    def _extract_full_image_pdf(
        self, 
        file_path: str, 
        total_pages: int,
        timeout_seconds: int,
        start_time: float,
        progress_callback: Optional[Callable] = None
    ) -> ExtractionResult:
        """
        100% 이미지 PDF 전용 추출 메소드
        - 병렬 OCR 처리 (CPU 모드에서)
        - 중간 결과 저장
        - 향상된 이미지 전처리
        """
        pages: List[PageResult] = [None] * total_pages  # 페이지 순서 유지용
        completed_pages = 0
        partial_extraction = False
        
        def process_single_page(page_info: Tuple[int, bytes]) -> Tuple[int, PageResult]:
            """단일 페이지 OCR 처리"""
            page_num, img_bytes = page_info
            
            # 이미지 전처리 (OCR 정확도 향상)
            if self.config.preprocessing.enabled:
                img_bytes = self._preprocess_image(img_bytes)
            
            # OCR 수행
            ocr_text, confidence = self._ocr_from_bytes(img_bytes)
            
            return page_num, PageResult(
                page_num=page_num + 1,
                text=ocr_text.strip() if ocr_text else "",
                method=self._get_ocr_method(),
                confidence=confidence,
                has_images=True,
                has_tables=False
            )
        
        try:
            # PDF를 페이지별 이미지로 변환
            doc = fitz.open(file_path)
            page_images: List[Tuple[int, bytes]] = []
            
            page_start_idx, page_stop_idx = self._resolve_page_range(total_pages)
            range_total = page_stop_idx - page_start_idx
            if (page_start_idx, page_stop_idx) != (0, total_pages):
                print(f"[PDF OCR] 페이지 범위 추출: {page_start_idx + 1}~{page_stop_idx}p (전체 {total_pages}p 중)")
            print(f"[PDF OCR] 페이지 이미지 변환 중... ({range_total}페이지)")
            dpi = self.config.pdf.render_dpi
            
            for page_num in range(page_start_idx, page_stop_idx):
                # 타임아웃 체크
                if time.time() - start_time > timeout_seconds * 0.1:  # 이미지 변환에 10% 시간 할당
                    processed_in_range = page_num - page_start_idx
                    if processed_in_range < range_total * 0.5:  # 50% 미만이면 계속 진행
                        pass
                    else:
                        break
                
                page = doc[page_num]
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                page_images.append((page_num, img_bytes))
            
            doc.close()
            print(f"[PDF OCR] {len(page_images)}페이지 이미지 변환 완료")
            
            # OCR 처리 (순차 또는 병렬)
            workers = self._get_ocr_workers()
            
            if workers == 1:
                # 순차 처리 (GPU 모드)
                for i, page_info in enumerate(page_images):
                    # 타임아웃 체크
                    elapsed = time.time() - start_time
                    if elapsed > timeout_seconds:
                        partial_extraction = True
                        print(f"[PDF OCR] 타임아웃! {completed_pages}/{total_pages} 페이지 완료")
                        break
                    
                    page_num, result = process_single_page(page_info)
                    pages[page_num] = result
                    completed_pages += 1
                    
                    # 진행률 콜백
                    if progress_callback and (completed_pages % 5 == 0):
                        progress_callback(completed_pages, total_pages, "ocr_processing")
                    
                    # 10페이지마다 진행 상황 출력
                    if completed_pages % 10 == 0:
                        print(f"[PDF OCR] {completed_pages}/{total_pages} 페이지 완료 ({elapsed:.0f}초 경과)")
            else:
                # 병렬 처리 (CPU 모드)
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    futures = {executor.submit(process_single_page, pi): pi[0] for pi in page_images}
                    
                    for future in as_completed(futures):
                        # 타임아웃 체크
                        elapsed = time.time() - start_time
                        if elapsed > timeout_seconds:
                            partial_extraction = True
                            print(f"[PDF OCR] 타임아웃! {completed_pages}/{total_pages} 페이지 완료")
                            executor.shutdown(wait=False, cancel_futures=True)
                            break
                        
                        try:
                            page_num, result = future.result(timeout=60)  # 페이지당 최대 60초
                            pages[page_num] = result
                            completed_pages += 1
                            
                            if progress_callback and (completed_pages % 5 == 0):
                                progress_callback(completed_pages, total_pages, "ocr_processing")
                        except Exception as e:
                            print(f"[PDF OCR ERROR] 페이지 처리 실패: {e}")
            
            # None인 페이지 제거 (처리되지 않은 페이지)
            pages = [p for p in pages if p is not None]
            
            if not pages:
                return ExtractionResult(
                    file_path=file_path,
                    file_format="pdf",
                    status=ExtractionStatus.FAILED,
                    error_message="No pages could be extracted via OCR",
                    processing_time_ms=int((time.time() - start_time) * 1000)
                )
            
            # 텍스트 결합
            all_text_parts = [p.text for p in pages]
            full_text = "\n\n".join(all_text_parts)
            
            # 이미지 PDF에서 표 구조 복원 시도
            if self.config.pdf.extract_tables:
                full_text = self._restore_tables_from_ocr_text(full_text)
            
            # 후처리
            corrections = []
            if any([
                self.config.postprocessing.normalize_whitespace,
                self.config.postprocessing.ocr_error_correction,
                self.config.postprocessing.domain_term_correction
            ]):
                full_text, corrections = self._apply_postprocessing(full_text)
            
            # PDF 표 구조 복원 (병합 셀 처리, 열 정렬 등)
            if self.config.pdf.extract_tables:
                try:
                    full_text = self._table_restorer.restore_tables(full_text)
                except Exception as e:
                    print(f"[PDF TABLE RESTORE] 표 복원 중 오류: {e}")
            
            # 품질 검증
            quality_details = self._validate_quality(full_text) if self.config.quality_validation.enabled else QualityDetails(overall_score=1.0)
            
            # 상태 결정 - 텍스트가 추출되었으면 COMPLETED
            if full_text and len(full_text.strip()) > 0:
                status = ExtractionStatus.COMPLETED
                if partial_extraction:
                    extraction_ratio = len(pages) / total_pages
                    print(f"[PDF OCR] 부분 추출: {len(pages)}/{total_pages} 페이지 ({extraction_ratio*100:.0f}%), 품질: {quality_details.overall_score:.2f}")
            else:
                status = ExtractionStatus.FAILED
            
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            return ExtractionResult(
                file_path=file_path,
                file_format="pdf",
                status=status,
                text=full_text,
                pages=pages,
                page_count=len(pages),
                quality_score=quality_details.overall_score,
                quality_details=quality_details,
                extraction_method=self._get_ocr_method(),
                char_count=len(full_text),
                token_count=self._count_tokens(full_text),
                processing_time_ms=processing_time_ms,
                corrections=corrections,
                error_message=f"Partial extraction: {len(pages)}/{total_pages} pages" if partial_extraction else None
            )
            
        except Exception as e:
            return ExtractionResult(
                file_path=file_path,
                file_format="pdf",
                status=ExtractionStatus.FAILED,
                error_message=f"Full image PDF extraction failed: {str(e)}",
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _ocr_from_bytes(self, img_bytes: bytes) -> Tuple[str, Optional[float]]:
        """바이트 이미지에서 직접 OCR 수행"""
        engine_type = self.config.ocr.engine
        
        try:
            if engine_type == "paddleocr":
                return self._ocr_with_paddle(img_bytes)
            elif engine_type == "easyocr":
                return self._ocr_with_easyocr(img_bytes)
            elif engine_type == "tesseract":
                return self._ocr_with_tesseract(img_bytes)
            elif engine_type == "hybrid":
                return self._ocr_with_hybrid(img_bytes)
            else:
                return self._ocr_with_paddle(img_bytes)
        except Exception as e:
            print(f"[OCR ERROR] {e}")
            return "", None
    
    def _restore_tables_from_ocr_text(self, text: str) -> str:
        """
        OCR 텍스트에서 표 구조 감지 및 복원
        
        패턴 기반으로 표를 감지:
        1. 연속된 짧은 줄들 (셀 데이터)
        2. 숫자/날짜가 많은 영역
        3. 반복되는 구조 패턴
        """
        if not text:
            return text
        
        lines = text.split('\n')
        result_lines = []
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # 표 시작 가능성 감지: 짧은 줄이 연속으로 나오는 경우
            potential_table_lines = []
            j = i
            
            while j < len(lines):
                current_line = lines[j].strip()
                
                # 표 행 후보 조건: 짧은 줄(5~100자) 또는 탭/공백으로 구분된 데이터
                is_short_line = 5 <= len(current_line) <= 100
                has_tab_separator = '\t' in current_line
                has_multiple_spaces = '  ' in current_line
                has_numbers = bool(re.search(r'\d', current_line))
                
                # 표 행으로 판단
                if current_line and (has_tab_separator or (is_short_line and (has_multiple_spaces or has_numbers))):
                    potential_table_lines.append(current_line)
                    j += 1
                else:
                    # 빈 줄이면 계속 확인
                    if not current_line and potential_table_lines:
                        j += 1
                        continue
                    break
            
            # 최소 3줄 이상이면 표로 처리
            if len(potential_table_lines) >= 3:
                table_markdown = self._convert_text_lines_to_table(potential_table_lines)
                if table_markdown:
                    result_lines.append("")
                    result_lines.append(table_markdown)
                    result_lines.append("")
                    i = j
                    continue
            
            result_lines.append(line)
            i += 1
        
        return '\n'.join(result_lines)
    
    def _convert_text_lines_to_table(self, lines: List[str]) -> Optional[str]:
        """
        텍스트 줄들을 마크다운 표로 변환
        
        구분자 감지:
        1. 탭 문자
        2. 연속 공백 (2개 이상)
        3. 고정 너비 패턴
        """
        if len(lines) < 2:
            return None
        
        # 구분자 감지
        separators = ['\t', '  ', ' | ']
        best_separator = None
        best_col_count = 0
        
        for sep in separators:
            col_counts = [len(line.split(sep)) for line in lines[:5]]
            if col_counts:
                avg_cols = sum(col_counts) / len(col_counts)
                # 일관된 열 수를 가진 구분자 선택
                if avg_cols >= 2 and max(col_counts) - min(col_counts) <= 2:
                    if avg_cols > best_col_count:
                        best_col_count = avg_cols
                        best_separator = sep
        
        if not best_separator or best_col_count < 2:
            # 고정 너비 패턴 시도
            return self._try_fixed_width_table(lines)
        
        # 표 생성
        rows = []
        for line in lines:
            cells = [cell.strip() for cell in line.split(best_separator)]
            if any(cells):  # 빈 줄 제외
                rows.append(cells)
        
        if len(rows) < 2:
            return None
        
        # 열 수 정규화
        max_cols = max(len(row) for row in rows)
        normalized_rows = []
        for row in rows:
            normalized_row = row + [''] * (max_cols - len(row))
            normalized_rows.append(normalized_row)
        
        # 마크다운 생성
        md_lines = []
        
        # 헤더 행
        header = normalized_rows[0]
        md_lines.append('| ' + ' | '.join(header) + ' |')
        
        # 구분선
        md_lines.append('|' + '|'.join(['---'] * max_cols) + '|')
        
        # 데이터 행
        for row in normalized_rows[1:]:
            md_lines.append('| ' + ' | '.join(row) + ' |')
        
        return '\n'.join(md_lines)
    
    def _try_fixed_width_table(self, lines: List[str]) -> Optional[str]:
        """고정 너비 패턴으로 표 파싱 시도"""
        if len(lines) < 2:
            return None
        
        # 첫 번째 줄에서 열 위치 추정
        first_line = lines[0]
        
        # 공백 패턴 분석
        space_positions = []
        in_space = False
        space_start = 0
        
        for pos, char in enumerate(first_line):
            if char == ' ':
                if not in_space:
                    in_space = True
                    space_start = pos
            else:
                if in_space and pos - space_start >= 2:  # 2칸 이상 공백
                    space_positions.append((space_start, pos))
                in_space = False
        
        if len(space_positions) < 1:
            return None
        
        # 열 분리 위치 결정
        col_breaks = [0] + [p[1] for p in space_positions] + [max(len(l) for l in lines)]
        
        # 각 줄을 열로 분리
        rows = []
        for line in lines:
            cells = []
            for i in range(len(col_breaks) - 1):
                start = col_breaks[i]
                end = col_breaks[i + 1]
                cell = line[start:end].strip() if start < len(line) else ""
                cells.append(cell)
            if any(cells):
                rows.append(cells)
        
        if len(rows) < 2:
            return None
        
        # 마크다운 생성
        max_cols = max(len(row) for row in rows)
        md_lines = []
        
        header = rows[0] + [''] * (max_cols - len(rows[0]))
        md_lines.append('| ' + ' | '.join(header) + ' |')
        md_lines.append('|' + '|'.join(['---'] * max_cols) + '|')
        
        for row in rows[1:]:
            normalized_row = row + [''] * (max_cols - len(row))
            md_lines.append('| ' + ' | '.join(normalized_row) + ' |')
        
        return '\n'.join(md_lines)
    
    def _extract_page(self, page: fitz.Page, page_num: int, pdf_path: str) -> PageResult:
        """
        단일 페이지에서 텍스트 추출
        
        전략 (설정 기반):
        1. force_ocr_mode=True면 텍스트 레이어 무시하고 OCR만 사용
        2. hybrid_extraction=True면 텍스트 레이어 + OCR 결과 병합
        3. page_optimal_method=True면 페이지별 최적 방법 자동 선택
        4. 기존 방식: prefer_text_layer 먼저 시도 후 필요시 OCR
        """
        text = ""
        text_layer_text = ""
        ocr_text = ""
        method = ExtractionMethod.TEXT_LAYER
        confidence = None
        tables = []
        
        # 강제 OCR 모드: 텍스트 레이어 무시
        if self.config.pdf.force_ocr_mode:
            if self.config.pdf.enable_ocr:
                ocr_text, confidence = self._ocr_page(page)
                text = ocr_text if ocr_text else ""
                method = self._get_ocr_method()
        
        # 하이브리드 추출: 텍스트 레이어 + OCR 결과 병합
        elif self.config.pdf.hybrid_extraction:
            # 텍스트 레이어 추출
            text_layer_text = page.get_text("text")
            
            # OCR 추출
            if self.config.pdf.enable_ocr:
                ocr_text, confidence = self._ocr_page(page)
            
            # 두 결과 병합 (더 나은 결과 선택 또는 보완)
            text = self._merge_hybrid_results(text_layer_text, ocr_text)
            method = ExtractionMethod.HYBRID
        
        # 페이지별 최적 방법 자동 선택
        elif self.config.pdf.page_optimal_method:
            text, method, confidence = self._auto_select_optimal_method(page)
        
        # 기존 방식
        else:
            # 1단계: 텍스트 레이어 추출 (prefer_text_layer 옵션)
            if self.config.pdf.prefer_text_layer:
                text = page.get_text("text")
                method = ExtractionMethod.TEXT_LAYER
            
            # 2단계: OCR 적용 여부 결정
            should_ocr = self._should_apply_ocr(text)
            
            if should_ocr and self.config.pdf.enable_ocr:
                ocr_text, ocr_confidence = self._ocr_page(page)
                
                # OCR 결과가 더 좋으면 교체
                if ocr_text:
                    if not text or len(ocr_text.strip()) > len(text.strip()) * 0.8:
                        text = ocr_text
                        method = self._get_ocr_method()
                        confidence = ocr_confidence
                    elif self.config.ocr.engine == "hybrid":
                        # Hybrid 모드: 두 결과 병합
                        text = self._merge_texts(text, ocr_text)
                        method = ExtractionMethod.HYBRID
        
        # 3단계: 이미지 내 텍스트 추출 (extract_image_text 옵션)
        if self.config.pdf.extract_image_text:
            image_text = self._extract_image_text(page)
            if image_text:
                text = f"{text}\n\n[이미지 텍스트]\n{image_text}"
        
        # 4단계: 표 구조 추출 (extract_tables 옵션)
        if self.config.pdf.extract_tables:
            tables = self._extract_tables_from_page(page_num, pdf_path)
            
            # 표가 있으면 텍스트와 병합
            if tables:
                text = self._merge_text_and_tables(text, tables)
        
        # 이미지/테이블 존재 여부 확인
        has_images = len(page.get_images()) > 0
        has_tables = len(tables) > 0 or self._detect_tables(page)
        
        return PageResult(
            page_num=page_num,
            text=text.strip(),
            method=method,
            confidence=confidence,
            has_images=has_images,
            has_tables=has_tables,
            tables=tables
        )
    
    def _merge_hybrid_results(self, text_layer: str, ocr_text: str) -> str:
        """
        텍스트 레이어와 OCR 결과를 하이브리드 병합
        
        전략:
        1. 둘 다 있으면 품질 비교 후 더 나은 결과 선택
        2. 한쪽만 있으면 해당 결과 사용
        3. 품질이 비슷하면 텍스트 레이어 우선 (정확도 높음)
        """
        if not text_layer and not ocr_text:
            return ""
        if not text_layer:
            return ocr_text
        if not ocr_text:
            return text_layer
        
        # 품질 비교
        text_layer_quality = self._quick_quality_check(text_layer)
        ocr_quality = self._quick_quality_check(ocr_text)
        
        # 품질 차이가 크면 더 좋은 결과 선택
        if text_layer_quality > ocr_quality + 0.2:
            return text_layer
        elif ocr_quality > text_layer_quality + 0.2:
            return ocr_text
        
        # 품질이 비슷하면 더 긴 결과 선택 (정보량 기준)
        if len(text_layer) > len(ocr_text) * 1.2:
            return text_layer
        elif len(ocr_text) > len(text_layer) * 1.2:
            return ocr_text
        
        # 기본적으로 텍스트 레이어 우선
        return text_layer
    
    def _auto_select_optimal_method(self, page: fitz.Page) -> Tuple[str, ExtractionMethod, Optional[float]]:
        """
        페이지별 최적 추출 방법 자동 선택
        
        전략:
        1. 먼저 텍스트 레이어 추출 및 품질 평가
        2. 품질이 낮으면 OCR 시도
        3. 둘 다 시도 후 더 나은 결과 선택
        """
        # 텍스트 레이어 추출
        text_layer = page.get_text("text")
        text_layer_quality = self._quick_quality_check(text_layer)
        
        # 텍스트 레이어 품질이 좋으면 바로 반환
        if text_layer_quality > 0.8 and len(text_layer.strip()) > 100:
            return text_layer, ExtractionMethod.TEXT_LAYER, None
        
        # OCR 시도
        if self.config.pdf.enable_ocr:
            ocr_text, ocr_confidence = self._ocr_page(page)
            ocr_quality = self._quick_quality_check(ocr_text)
            
            # 더 나은 결과 선택
            if ocr_quality > text_layer_quality:
                return ocr_text, self._get_ocr_method(), ocr_confidence
        
        # 텍스트 레이어 반환 (기본)
        return text_layer, ExtractionMethod.TEXT_LAYER, None
    
    def _quick_quality_check(self, text: str) -> float:
        """빠른 품질 평가 (0~1)"""
        if not text or len(text.strip()) < 10:
            return 0.0
        
        # 한글 비율
        korean_ratio = self._calculate_korean_ratio(text)
        
        # 깨진 문자 비율
        broken_ratio = self._calculate_broken_ratio(text)
        
        # 점수 계산
        score = korean_ratio * 0.5 + (1 - broken_ratio) * 0.5
        return min(max(score, 0.0), 1.0)
    
    def _should_apply_ocr(self, text: str) -> bool:
        """OCR 적용 여부 결정"""
        # OCR 비활성화
        if not self.config.pdf.enable_ocr:
            return False
        
        # 텍스트 레이어 미사용 시 무조건 OCR
        if not self.config.pdf.prefer_text_layer:
            return True
        
        # 텍스트가 없거나 너무 짧음
        if not text or len(text.strip()) < 50:
            return True
        
        # 깨진 문자 비율 체크
        broken_ratio = self._calculate_broken_ratio(text)
        if broken_ratio > 0.1:  # 10% 이상 깨진 문자
            return True
        
        # 한글 비율 체크 (너무 낮으면 OCR 시도)
        korean_ratio = self._calculate_korean_ratio(text)
        if korean_ratio < 0.3 and len(text) > 100:  # 한글이 30% 미만
            return True
        
        return False
    
    def _get_ocr_method(self) -> ExtractionMethod:
        """현재 OCR 엔진에 따른 추출 방법 반환"""
        engine = self.config.ocr.engine
        if engine == "paddleocr":
            return ExtractionMethod.PADDLEOCR
        elif engine == "easyocr":
            return ExtractionMethod.EASYOCR
        elif engine == "tesseract":
            return ExtractionMethod.TESSERACT
        elif engine == "hybrid":
            return ExtractionMethod.HYBRID
        return ExtractionMethod.PADDLEOCR
    
    def _ocr_page(self, page: fitz.Page) -> Tuple[str, Optional[float]]:
        """
        설정된 OCR 엔진으로 페이지 OCR
        
        Returns:
            Tuple[str, Optional[float]]: (추출된 텍스트, 평균 신뢰도)
        """
        engine_type = self.config.ocr.engine
        ocr_start = time.time()
        
        try:
            # 고해상도 이미지로 변환
            dpi = self.config.pdf.render_dpi
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            # PNG 바이트로 변환
            img_bytes = pix.tobytes("png")
            img_size_kb = len(img_bytes) / 1024
            
            # 전처리 적용 (설정에 따라)
            if self.config.preprocessing.enabled:
                img_bytes = self._preprocess_image(img_bytes)
            
            # OCR 엔진별 처리
            result = None
            if engine_type == "paddleocr":
                result = self._ocr_with_paddle(img_bytes)
            elif engine_type == "easyocr":
                result = self._ocr_with_easyocr(img_bytes)
            elif engine_type == "tesseract":
                result = self._ocr_with_tesseract(img_bytes)
            elif engine_type == "hybrid":
                result = self._ocr_with_hybrid(img_bytes)
            else:
                # 기본: PaddleOCR
                result = self._ocr_with_paddle(img_bytes)
            
            # 디버그: OCR 시간 (느린 경우만 출력)
            ocr_elapsed = time.time() - ocr_start
            if ocr_elapsed > 10.0:  # 10초 이상 걸린 경우만 출력
                text_len = len(result[0]) if result and result[0] else 0
                print(f"[OCR DEBUG] 페이지 OCR: {ocr_elapsed:.1f}초, 이미지: {img_size_kb:.0f}KB, 결과: {text_len}자")
            
            return result if result else ("", None)
                
        except Exception as e:
            print(f"[OCR ERROR] {e}")
            return "", None
    
    def _ocr_with_paddle(self, img_bytes: bytes) -> Tuple[str, Optional[float]]:
        """PaddleOCR로 OCR 수행"""
        ocr = get_ocr_engine("paddleocr", self.config)
        if ocr is None:
            return "", None
        
        img_array = self._bytes_to_numpy(img_bytes)
        result = ocr.ocr(img_array, cls=True)
        
        if not result or not result[0]:
            return "", None
        
        lines = []
        confidences = []
        
        for line in result[0]:
            if line and len(line) >= 2:
                text_info = line[1]
                if isinstance(text_info, tuple) and len(text_info) >= 2:
                    text, conf = text_info[0], text_info[1]
                    if conf >= self.config.ocr.drop_score:
                        lines.append(text)
                        confidences.append(conf)
        
        full_text = "\n".join(lines)
        avg_confidence = sum(confidences) / len(confidences) if confidences else None
        
        return full_text, avg_confidence
    
    def _ocr_with_easyocr(self, img_bytes: bytes) -> Tuple[str, Optional[float]]:
        """EasyOCR로 OCR 수행"""
        ocr = get_ocr_engine("easyocr", self.config)
        if ocr is None:
            return "", None
        
        img_array = self._bytes_to_numpy(img_bytes)
        result = ocr.readtext(img_array)
        
        if not result:
            return "", None
        
        lines = []
        confidences = []
        
        for detection in result:
            if len(detection) >= 2:
                text = detection[1]
                conf = detection[2] if len(detection) >= 3 else 0.5
                if conf >= self.config.ocr.drop_score:
                    lines.append(text)
                    confidences.append(conf)
        
        full_text = "\n".join(lines)
        avg_confidence = sum(confidences) / len(confidences) if confidences else None
        
        return full_text, avg_confidence
    
    def _ocr_with_tesseract(self, img_bytes: bytes) -> Tuple[str, Optional[float]]:
        """Tesseract로 OCR 수행"""
        global _unavailable_engines
        
        # 이미 사용 불가능으로 확인된 경우 바로 반환
        if "tesseract" in _unavailable_engines:
            return "", None
        
        try:
            import pytesseract
            from PIL import Image
            
            img = Image.open(io.BytesIO(img_bytes))
            lang = "+".join(self.config.pdf.ocr_languages)
            
            # OCR 수행
            text = pytesseract.image_to_string(img, lang=lang)
            
            # Tesseract는 신뢰도를 별도로 제공
            data = pytesseract.image_to_data(img, lang=lang, output_type=pytesseract.Output.DICT)
            confidences = [int(c) for c in data['conf'] if int(c) > 0]
            avg_confidence = sum(confidences) / len(confidences) / 100 if confidences else None
            
            return text, avg_confidence
            
        except ImportError:
            _unavailable_engines.add("tesseract")
            return "", None
        except Exception as e:
            # Tesseract가 설치되지 않은 오류인 경우 캐시
            if "not installed" in str(e).lower() or "not in your path" in str(e).lower():
                _unavailable_engines.add("tesseract")
            return "", None
    
    def _ocr_with_hybrid(self, img_bytes: bytes) -> Tuple[str, Optional[float]]:
        """
        Hybrid OCR: PaddleOCR + EasyOCR 결합
        
        전략:
        1. 두 엔진으로 각각 OCR 수행
        2. 결과 비교 및 병합
        3. 신뢰도 높은 결과 우선
        """
        paddle_text, paddle_conf = self._ocr_with_paddle(img_bytes)
        easy_text, easy_conf = self._ocr_with_easyocr(img_bytes)
        
        # 둘 다 결과가 없으면
        if not paddle_text and not easy_text:
            return "", None
        
        # 하나만 결과가 있으면 해당 결과 사용
        if not paddle_text:
            return easy_text, easy_conf
        if not easy_text:
            return paddle_text, paddle_conf
        
        # 둘 다 있으면 품질 비교
        paddle_quality = self._quick_quality_check(paddle_text)
        easy_quality = self._quick_quality_check(easy_text)
        
        # 품질이 더 높은 결과 선택 (신뢰도 가중)
        paddle_score = paddle_quality * (paddle_conf or 0.5)
        easy_score = easy_quality * (easy_conf or 0.5)
        
        if paddle_score >= easy_score:
            return paddle_text, paddle_conf
        else:
            return easy_text, easy_conf
    
    def _quick_quality_check(self, text: str) -> float:
        """빠른 품질 검사 (0-1)"""
        if not text:
            return 0.0
        
        korean_ratio = self._calculate_korean_ratio(text)
        broken_ratio = self._calculate_broken_ratio(text)
        
        return max(0, min(1, korean_ratio - broken_ratio * 2))
    
    def _merge_texts(self, text1: str, text2: str) -> str:
        """두 텍스트 병합 (중복 제거)"""
        if not text1:
            return text2
        if not text2:
            return text1
        
        # 간단한 병합: 더 긴 텍스트 기준
        if len(text2) > len(text1) * 1.2:
            return text2
        return text1
    
    def _extract_image_text(self, page: fitz.Page) -> str:
        """페이지 내 이미지에서 텍스트 추출"""
        texts = []
        
        try:
            images = page.get_images()
            for img_idx, img in enumerate(images[:5]):  # 최대 5개 이미지
                xref = img[0]
                base_image = page.parent.extract_image(xref)
                
                if base_image:
                    img_bytes = base_image["image"]
                    
                    # 전처리 후 OCR
                    if self.config.preprocessing.enabled:
                        img_bytes = self._preprocess_image(img_bytes)
                    
                    ocr_text, _ = self._ocr_with_paddle(img_bytes)
                    if ocr_text and len(ocr_text.strip()) > 10:
                        texts.append(ocr_text)
        except Exception as e:
            print(f"[IMAGE EXTRACT ERROR] {e}")
        
        return "\n".join(texts)
    
    def _preprocess_image(self, img_bytes: bytes) -> bytes:
        """
        이미지 전처리 (OCR 정확도 향상)
        - 적응형 이진화 (adaptive_preprocessing)
        - 노이즈 제거 (denoise)
        - 대비 향상 (contrast_enhancement)
        - 기울기 보정 (deskew)
        """
        try:
            import cv2
            
            # 바이트를 numpy 배열로 변환
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                return img_bytes
            
            # 그레이스케일 변환
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # 대비 향상 (CLAHE) - contrast_enhancement 옵션
            if self.config.preprocessing.contrast_enhancement:
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                gray = clahe.apply(gray)
            
            # 노이즈 제거 - denoise 옵션
            if self.config.preprocessing.denoise:
                gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
            
            # 적응형 이진화 - adaptive_preprocessing 옵션
            if self.config.preprocessing.adaptive_preprocessing:
                # 이미지 품질 분석
                hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
                binary_ratio = (hist[0] + hist[255]) / hist.sum()
                
                # 스캔 문서로 판단되면 이진화 적용
                if binary_ratio > 0.5:
                    gray = cv2.adaptiveThreshold(
                        gray, 255, 
                        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                        cv2.THRESH_BINARY, 11, 2
                    )
            
            # 기울기 보정 - deskew 옵션
            if self.config.preprocessing.deskew:
                gray = self._deskew_image(gray)
            
            # PNG로 인코딩
            _, buffer = cv2.imencode('.png', gray)
            return buffer.tobytes()
            
        except ImportError:
            print("[WARNING] OpenCV not installed. Skipping preprocessing.")
            return img_bytes
        except Exception as e:
            print(f"[PREPROCESS ERROR] {e}")
            return img_bytes
    
    def _deskew_image(self, image: np.ndarray) -> np.ndarray:
        """이미지 기울기 보정"""
        try:
            import cv2
            
            # 좌표 찾기
            coords = np.column_stack(np.where(image > 0))
            if len(coords) == 0:
                return image
            
            # 최소 면적 사각형으로 각도 계산
            angle = cv2.minAreaRect(coords)[-1]
            
            if angle < -45:
                angle = 90 + angle
            
            # 작은 각도만 보정
            if abs(angle) > 10:
                return image
            
            # 회전 적용
            (h, w) = image.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            rotated = cv2.warpAffine(
                image, M, (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE
            )
            
            return rotated
            
        except Exception:
            return image
    
    def _bytes_to_numpy(self, img_bytes: bytes) -> np.ndarray:
        """바이트를 numpy 배열로 변환"""
        try:
            import cv2
            nparr = np.frombuffer(img_bytes, np.uint8)
            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except ImportError:
            # PIL 사용
            from PIL import Image
            img = Image.open(io.BytesIO(img_bytes))
            return np.array(img)
    
    def _detect_tables(self, page: fitz.Page) -> bool:
        """페이지 내 테이블 존재 여부 감지"""
        drawings = page.get_drawings()
        
        h_lines = 0
        v_lines = 0
        
        for drawing in drawings:
            for item in drawing.get("items", []):
                if item[0] == "l":  # line
                    p1, p2 = item[1], item[2]
                    if abs(p1.y - p2.y) < 2:  # 수평선
                        h_lines += 1
                    elif abs(p1.x - p2.x) < 2:  # 수직선
                        v_lines += 1
        
        return h_lines >= 3 and v_lines >= 3
    
    def _extract_tables_from_page(self, page_num: int, pdf_path: str) -> List[TableData]:
        """
        페이지 내 표 추출 (선 검출 기반 + pdfplumber 하이브리드)
        
        전략:
        1. 선 검출 기반 표 복원 먼저 시도 (새로운 라이브러리)
        2. 실패 시 pdfplumber로 폴백
        3. 두 결과 중 더 나은 것 선택
        
        Args:
            page_num: 1-based 페이지 번호
            pdf_path: PDF 파일 경로
            
        Returns:
            List[TableData]: 추출된 표 목록
        """
        tables = []
        
        # 1단계: 선 검출 기반 표 복원 시도 (새로운 라이브러리)
        print(f"[TABLE RECOVERY] Page {page_num}: 선 검출 기반 복원 시도 시작")
        try:
            recovered_tables = self._table_recovery_service.extract_tables_from_pdf(
                pdf_path, 
                page_num=page_num - 1  # 0-based로 변환
            )
            
            print(f"[TABLE RECOVERY] Page {page_num}: 복원된 표 {len(recovered_tables)}개")
            
            for idx, recovered in enumerate(recovered_tables):
                print(f"[TABLE RECOVERY] Table {idx}: {recovered.table.rows}x{recovered.table.cols}, "
                      f"method={recovered.recovery_method}, conf={recovered.confidence:.2f}")
                
                if recovered.confidence >= 0.5:  # 신뢰도 50% 이상으로 낮춤
                    # RecoveredTable을 TableData로 변환 (RAG 최적화)
                    table_obj = recovered.table
                    table_data = TableData(
                        table_index=idx,
                        rows=table_obj.to_2d_grid(),
                        semantic_text=table_obj.to_semantic_text(),
                        structured_data=table_obj.to_structured_dict(),
                        markdown=recovered.markdown,  # 호환성용
                        row_count=table_obj.rows,
                        col_count=table_obj.cols,
                        bbox=None,
                        confidence=recovered.confidence,
                        extraction_method=recovered.recovery_method,
                        page_num=page_num  # Cross-page 병합용 페이지 번호
                    )
                    tables.append(table_data)
                    print(f"[TABLE] 선 검출 기반 복원 성공: Page {page_num}, "
                          f"{table_obj.rows}x{table_obj.cols}, "
                          f"신뢰도={recovered.confidence:.2f}")
                else:
                    print(f"[TABLE RECOVERY] 신뢰도 부족으로 스킵: {recovered.confidence:.2f} < 0.5")
            
            # 선 검출로 충분한 표를 찾았으면 반환
            if tables:
                return tables
            else:
                print(f"[TABLE RECOVERY] 선 검출 결과 없음, pdfplumber 폴백")
                
        except Exception as e:
            import traceback
            print(f"[TABLE RECOVERY ERROR] Page {page_num}: {e}")
            print(f"[TABLE RECOVERY TRACE] {traceback.format_exc()}")
        
        # 2단계: pdfplumber로 폴백
        try:
            with pdfplumber.open(pdf_path) as pdf:
                if page_num <= len(pdf.pages):
                    plumber_page = pdf.pages[page_num - 1]
                    
                    # 향상된 표 추출 설정
                    table_settings = {
                        "vertical_strategy": "lines",      # 선 기반 감지 (셀 구분선 있는 표)
                        "horizontal_strategy": "lines",
                        "snap_tolerance": 5,               # 선 정렬 허용 오차
                        "join_tolerance": 5,               # 선 연결 허용 오차
                        "edge_min_length": 10,             # 최소 선 길이
                        "min_words_vertical": 1,           # 최소 단어 수
                        "min_words_horizontal": 1,
                    }
                    
                    # 선 기반으로만 시도 (text 전략은 일반 텍스트를 표로 오인하므로 비활성화)
                    raw_tables = plumber_page.extract_tables(table_settings)
                    
                    # 참고: text 전략은 비활성화됨
                    # 선 기반 검출이 실패하면 표가 없는 것으로 처리
                    # 이전에 text 전략이 일반 텍스트를 표로 오인하는 문제가 있었음
                    
                    # find_tables로 bbox 정보도 함께 가져오기
                    table_finder_results = []
                    try:
                        table_finder_results = plumber_page.find_tables(table_settings)
                    except:
                        pass
                    
                    for idx, table in enumerate(raw_tables):
                        if self._is_valid_table(table):
                            # 표 정리 (None 값, 빈 문자열 처리)
                            cleaned_table = self._clean_table_data(table)
                            
                            # 표의 위치 정보 (bbox) 저장
                            bbox = None
                            if idx < len(table_finder_results):
                                bbox = table_finder_results[idx].bbox
                            
                            # 디버그: 원본 표 정보
                            print(f"[TABLE DEBUG] Page {page_num}, Table {idx}: 원본 {len(cleaned_table)}행 x {len(cleaned_table[0]) if cleaned_table else 0}열")
                            if cleaned_table and len(cleaned_table) <= 3:
                                for row_idx, row in enumerate(cleaned_table):
                                    cell_preview = [f"'{c[:30]}...'" if len(c) > 30 else f"'{c}'" for c in row]
                                    print(f"[TABLE DEBUG]   Row {row_idx}: {cell_preview}")
                            
                            # 표 붕괴 감지 및 좌표 기반 재추출
                            final_table = cleaned_table
                            is_collapsed, collapse_reason = self._is_collapsed_table_debug(cleaned_table)
                            
                            if is_collapsed:
                                print(f"[TABLE DEBUG] 붕괴 감지됨 - 이유: {collapse_reason}")
                                
                                # 1차 시도: 선 검출 기반 표 복원 (새로운 라이브러리)
                                line_recovery_success = False
                                try:
                                    recovered = self._recover_collapsed_table_with_lines(
                                        pdf_path, page_num - 1, bbox
                                    )
                                    if recovered:
                                        recovered_grid = recovered.table.to_2d_grid()
                                        if recovered_grid and len(recovered_grid) > len(cleaned_table):
                                            final_table = recovered_grid
                                            line_recovery_success = True
                                            print(f"[TABLE] 선 검출 기반 복원 성공: "
                                                  f"{len(cleaned_table)}행 → {len(recovered_grid)}행, "
                                                  f"신뢰도={recovered.confidence:.2f}")
                                except Exception as e:
                                    print(f"[TABLE LINE RECOVERY ERROR] {e}")
                                
                                # 2차 시도: 텍스트 패턴 기반 행 분리 (선 없는 표용)
                                if not line_recovery_success:
                                    try:
                                        pattern_result = self._recover_collapsed_table_by_pattern(
                                            cleaned_table
                                        )
                                        if pattern_result and len(pattern_result) > len(cleaned_table):
                                            final_table = pattern_result
                                            line_recovery_success = True
                                            print(f"[TABLE] 패턴 기반 복원 성공: "
                                                  f"{len(cleaned_table)}행 → {len(pattern_result)}행")
                                    except Exception as e:
                                        print(f"[TABLE PATTERN RECOVERY ERROR] {e}")
                                
                                # 3차 시도: 기존 좌표 기반 재추출 (폴백)
                                if not line_recovery_success:
                                    try:
                                        coord_result = self._coord_extractor.reprocess_collapsed_table(
                                            plumber_page,
                                            cleaned_table,
                                            bbox
                                        )
                                        if coord_result:
                                            coord_rows = self._parse_markdown_to_rows(coord_result)
                                            print(f"[TABLE DEBUG] 좌표 기반 결과: {len(coord_rows) if coord_rows else 0}행")
                                            if coord_rows and len(coord_rows) > len(cleaned_table):
                                                final_table = coord_rows
                                                print(f"[TABLE] 좌표 기반 재추출 성공: {len(cleaned_table)}행 → {len(coord_rows)}행")
                                            else:
                                                print(f"[TABLE DEBUG] 좌표 기반 결과가 원본보다 좋지 않음")
                                        else:
                                            print(f"[TABLE DEBUG] 좌표 기반 재추출 결과 없음")
                                    except Exception as e:
                                        print(f"[TABLE COORD ERROR] {e}")
                            else:
                                print(f"[TABLE DEBUG] 붕괴 아님 - 이유: {collapse_reason}")
                            
                            # 2D 그리드를 Table 객체로 변환하여 선형화
                            table_builder = TableBuilder()
                            table_obj = table_builder.build_from_grid(final_table, header_rows=1)
                            
                            tables.append(TableData(
                                table_index=idx,
                                rows=final_table,
                                semantic_text=table_obj.to_semantic_text(),
                                structured_data=table_obj.to_structured_dict(),
                                markdown=self._table_to_markdown(final_table),  # 호환성용
                                row_count=len(final_table),
                                col_count=len(final_table[0]) if final_table else 0,
                                bbox=bbox,
                                confidence=0.5,  # pdfplumber 기본 신뢰도
                                extraction_method="pdfplumber",
                                page_num=page_num  # Cross-page 병합용 페이지 번호
                            ))
        except Exception as e:
            print(f"[TABLE EXTRACT ERROR] Page {page_num}: {e}")
        
        return tables
    
    def _clean_table_data(self, table: List[List]) -> List[List[str]]:
        """표 데이터 정리 (None 값, 줄바꿈 처리)"""
        cleaned = []
        for row in table:
            cleaned_row = []
            for cell in row:
                if cell is None:
                    cleaned_row.append("")
                else:
                    # 줄바꿈을 공백으로, 여러 공백을 하나로
                    text = str(cell).replace('\n', ' ')
                    text = re.sub(r'\s+', ' ', text).strip()
                    cleaned_row.append(text)
            cleaned.append(cleaned_row)
        return cleaned
    
    def _is_collapsed_table(self, table: List[List[str]]) -> bool:
        """
        표가 붕괴되었는지 확인 (모든 데이터가 적은 행에 압축된 경우)
        
        조건:
        1. 행 수가 3개 이하
        2. 특정 셀에 공백으로 구분된 많은 항목이 있음
        3. 연속 번호 패턴이 한 셀에 나열됨 (1 2 3 4...)
        """
        is_collapsed, _ = self._is_collapsed_table_debug(table)
        return is_collapsed
    
    def _is_collapsed_table_debug(self, table: List[List[str]]) -> Tuple[bool, str]:
        """
        표가 붕괴되었는지 확인 (디버그 버전 - 이유 반환)
        """
        if len(table) > 3:
            return False, f"행 수가 {len(table)}개로 3개 초과"
        
        for row_idx, row in enumerate(table):
            for cell_idx, cell in enumerate(row):
                if not cell:
                    continue
                
                # 공백으로 분리된 항목 수 확인 (너무 많으면 붕괴된 것)
                items = cell.split()
                if len(items) > 10:
                    return True, f"Row{row_idx}/Cell{cell_idx}: 항목 수 {len(items)}개 > 10"
                
                # 연속 번호 패턴 확인 (1 2 3 4 5...)
                numbers = re.findall(r'\b(\d+)\b', cell)
                if len(numbers) >= 5:
                    try:
                        nums = [int(n) for n in numbers[:10]]
                        # 연속 번호인지 확인
                        if nums == list(range(nums[0], nums[0] + len(nums))):
                            return True, f"Row{row_idx}/Cell{cell_idx}: 연속 번호 패턴 {nums[:5]}..."
                    except:
                        pass
                
                # 글머리 기호가 여러 개 있는 경우
                bullet_count = cell.count('•') + cell.count('·') + cell.count('-')
                if bullet_count >= 3:
                    return True, f"Row{row_idx}/Cell{cell_idx}: 글머리 기호 {bullet_count}개"
        
        return False, "붕괴 조건 미충족"
    
    def _recover_collapsed_table_by_pattern(
        self,
        collapsed_table: List[List[str]]
    ) -> Optional[List[List[str]]]:
        """
        텍스트 패턴 기반으로 붕괴된 표 복원 (선 없는 표용)
        
        연속 번호 패턴 (1, 2, 3, ...) 또는 글머리 기호(•)를 기준으로
        셀 내용을 분리하여 행을 재구성합니다.
        
        Args:
            collapsed_table: 붕괴된 표 데이터
            
        Returns:
            복원된 표 데이터 또는 None
        """
        if not collapsed_table or len(collapsed_table) < 2:
            return None
        
        # 헤더와 데이터 분리
        header = collapsed_table[0]
        data_row = collapsed_table[1] if len(collapsed_table) > 1 else []
        
        if len(header) < 2 or len(data_row) < 2:
            return None
        
        # 연속 번호가 있는 열 찾기
        number_col_idx = -1
        number_sequence = []
        
        for col_idx, cell in enumerate(data_row):
            if not cell:
                continue
            
            numbers = re.findall(r'\b(\d+)\b', str(cell))
            if len(numbers) >= 5:
                try:
                    nums = [int(n) for n in numbers]
                    # 1부터 시작하는 연속 번호인지 확인
                    if nums[0] == 1 and nums == list(range(1, len(nums) + 1)):
                        number_col_idx = col_idx
                        number_sequence = nums
                        break
                except:
                    pass
        
        if number_col_idx == -1 or len(number_sequence) < 3:
            # 연속 번호를 찾지 못한 경우 글머리 기호로 분리 시도
            return self._split_by_bullets(collapsed_table)
        
        print(f"[PATTERN RECOVERY] 연속 번호 감지: 열 {number_col_idx}, 1~{len(number_sequence)}")
        
        # 각 열의 텍스트를 번호 개수만큼 분리
        num_rows = len(number_sequence)
        restored_rows = [header]  # 헤더 유지
        
        for row_num in range(num_rows):
            new_row = []
            
            for col_idx, cell in enumerate(data_row):
                if not cell:
                    new_row.append("")
                    continue
                
                if col_idx == number_col_idx:
                    # 번호 열은 단일 번호로
                    new_row.append(str(row_num + 1))
                else:
                    # 다른 열은 공백으로 분리된 항목 중 해당 번호의 항목
                    items = self._split_cell_items(str(cell), num_rows)
                    if row_num < len(items):
                        new_row.append(items[row_num])
                    else:
                        new_row.append("")
            
            restored_rows.append(new_row)
        
        return restored_rows if len(restored_rows) > 2 else None
    
    def _split_cell_items(self, cell_text: str, expected_count: int) -> List[str]:
        """
        셀 텍스트를 예상 개수만큼 항목으로 분리
        
        분리 기준:
        1. 글머리 기호 (•, -, ·)
        2. 줄바꿈
        3. 번호 패턴 앞
        """
        if not cell_text:
            return [""] * expected_count
        
        items = []
        
        # 글머리 기호로 분리 시도
        bullet_pattern = r'[•·▪▸►◆◇○●]\s*'
        bullet_splits = re.split(bullet_pattern, cell_text)
        bullet_splits = [s.strip() for s in bullet_splits if s.strip()]
        
        if len(bullet_splits) >= expected_count * 0.5:
            items = bullet_splits
        else:
            # 공백으로 분리된 단어들을 그룹화
            words = cell_text.split()
            
            if len(words) <= expected_count:
                items = words
            else:
                # 단어 개수를 expected_count로 나눠서 그룹화
                words_per_item = max(1, len(words) // expected_count)
                for i in range(0, len(words), words_per_item):
                    chunk = ' '.join(words[i:i + words_per_item])
                    items.append(chunk)
        
        # 부족한 경우 빈 문자열로 채움
        while len(items) < expected_count:
            items.append("")
        
        return items[:expected_count]
    
    def _split_by_bullets(
        self,
        collapsed_table: List[List[str]]
    ) -> Optional[List[List[str]]]:
        """
        글머리 기호를 기준으로 표 분리
        """
        if not collapsed_table or len(collapsed_table) < 2:
            return None
        
        header = collapsed_table[0]
        data_row = collapsed_table[1]
        
        # 글머리 기호가 가장 많은 열 찾기
        max_bullets = 0
        max_bullet_col = -1
        bullet_pattern = r'[•·▪▸►◆◇○●]'
        
        for col_idx, cell in enumerate(data_row):
            if not cell:
                continue
            bullets = len(re.findall(bullet_pattern, str(cell)))
            if bullets > max_bullets:
                max_bullets = bullets
                max_bullet_col = col_idx
        
        if max_bullets < 3:
            return None
        
        print(f"[PATTERN RECOVERY] 글머리 기호 감지: 열 {max_bullet_col}, {max_bullets}개")
        
        # 글머리 기호 열의 항목 개수를 기준으로 분리
        bullet_cell = str(data_row[max_bullet_col])
        bullet_items = re.split(bullet_pattern, bullet_cell)
        bullet_items = [s.strip() for s in bullet_items if s.strip()]
        
        num_rows = len(bullet_items)
        if num_rows < 3:
            return None
        
        restored_rows = [header]
        
        for row_num in range(num_rows):
            new_row = []
            
            for col_idx, cell in enumerate(data_row):
                if not cell:
                    new_row.append("")
                    continue
                
                if col_idx == max_bullet_col:
                    # 글머리 기호 열
                    if row_num < len(bullet_items):
                        new_row.append(bullet_items[row_num])
                    else:
                        new_row.append("")
                else:
                    # 다른 열
                    items = self._split_cell_items(str(cell), num_rows)
                    if row_num < len(items):
                        new_row.append(items[row_num])
                    else:
                        new_row.append("")
            
            restored_rows.append(new_row)
        
        return restored_rows if len(restored_rows) > 2 else None
    
    def _recover_collapsed_table_with_lines(
        self,
        pdf_path: str,
        page_num: int,
        bbox: Optional[Tuple[float, float, float, float]] = None
    ) -> Optional['RecoveredTable']:
        """
        선 검출 기반으로 붕괴된 표 복원
        
        PyMuPDF를 사용하여 PDF에서 직접 선을 검출하고,
        검출된 선을 기반으로 표 구조를 재구성합니다.
        
        Args:
            pdf_path: PDF 파일 경로
            page_num: 페이지 번호 (0-based)
            bbox: 표의 위치 (선택)
            
        Returns:
            RecoveredTable 또는 None
        """
        try:
            doc = fitz.open(pdf_path)
            page = doc[page_num]
            
            # 선 검출
            lines = self._table_recovery_service.line_detector.detect_hybrid(page)
            
            if not lines.is_valid_table():
                doc.close()
                print(f"[LINE RECOVERY] 유효한 표 선 미감지 (H={len(lines.horizontal)}, V={len(lines.vertical)})")
                return None
            
            print(f"[LINE RECOVERY] 선 감지됨 - H={len(lines.horizontal)}, V={len(lines.vertical)}")
            
            # 셀 분할
            cells = self._table_recovery_service.cell_segmentor.segment_cells(
                lines.horizontal, lines.vertical
            )
            
            if not cells:
                doc.close()
                print(f"[LINE RECOVERY] 셀 분할 실패")
                return None
            
            print(f"[LINE RECOVERY] 셀 분할 완료 - {len(cells)}개 셀")
            
            # 병합 셀 감지
            merged = self._table_recovery_service.cell_segmentor.detect_merged_cells(cells, lines)
            
            # 텍스트 추출 및 매핑
            cell_texts = self._extract_text_for_cells(page, cells, merged)
            
            # 표 구성
            table = self._build_table_from_cells(cells, merged, cell_texts)
            
            doc.close()
            
            if table and table.rows > 0 and table.cols > 0:
                # RecoveredTable 생성
                from ..table_recovery import RecoveredTable
                
                confidence = self._calculate_table_confidence(cells, cell_texts)
                
                return RecoveredTable(
                    table=table,
                    markdown=table.to_markdown(),
                    html=table.to_html(include_style=False),
                    metadata=None,
                    recovery_method="line_detection_recovery",
                    confidence=confidence
                )
            
            return None
            
        except Exception as e:
            print(f"[LINE RECOVERY ERROR] {e}")
            return None
    
    def _extract_text_for_cells(
        self,
        page: fitz.Page,
        cells: List,
        merged: List
    ) -> Dict[Tuple[int, int], str]:
        """페이지에서 텍스트 추출하여 셀에 매핑"""
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
                                words.append({
                                    'text': text,
                                    'x0': bbox[0],
                                    'y0': bbox[1],
                                    'x1': bbox[2],
                                    'y1': bbox[3]
                                })
            
            # 병합 셀 좌표 추적
            merged_coords = set()
            for mc in merged:
                for r in range(mc.row_start, mc.row_end + 1):
                    for c in range(mc.col_start, mc.col_end + 1):
                        merged_coords.add((r, c))
                
                # 병합 셀 텍스트 매핑
                merged_text = self._map_words_to_bbox(
                    words, (mc.bbox.x0, mc.bbox.y0, mc.bbox.x1, mc.bbox.y1)
                )
                cell_texts[(mc.row_start, mc.col_start)] = merged_text
            
            # 일반 셀 텍스트 매핑
            for cell in cells:
                if (cell.row_idx, cell.col_idx) not in merged_coords:
                    cell_text = self._map_words_to_bbox(
                        words, (cell.x0, cell.y0, cell.x1, cell.y1)
                    )
                    cell_texts[(cell.row_idx, cell.col_idx)] = cell_text
            
        except Exception as e:
            print(f"[TEXT MAPPING ERROR] {e}")
        
        return cell_texts
    
    def _map_words_to_bbox(
        self,
        words: List[Dict],
        bbox: Tuple[float, float, float, float]
    ) -> str:
        """bbox 영역 내의 단어들을 텍스트로 결합"""
        x0, y0, x1, y1 = bbox
        margin = 2.0
        
        matched_words = []
        for word in words:
            # 단어의 중심점이 bbox 내에 있는지 확인
            word_cx = (word['x0'] + word['x1']) / 2
            word_cy = (word['y0'] + word['y1']) / 2
            
            if (x0 - margin <= word_cx <= x1 + margin and
                y0 - margin <= word_cy <= y1 + margin):
                matched_words.append(word)
        
        # y좌표로 정렬 후 x좌표로 정렬
        matched_words.sort(key=lambda w: (w['y0'], w['x0']))
        
        # 줄 단위로 그룹화
        lines = []
        current_line = []
        current_y = None
        
        for word in matched_words:
            if current_y is None:
                current_y = word['y0']
            
            # 새 줄 판단 (y 좌표 차이가 10 이상)
            if abs(word['y0'] - current_y) > 10:
                if current_line:
                    lines.append(' '.join(w['text'] for w in current_line))
                current_line = [word]
                current_y = word['y0']
            else:
                current_line.append(word)
        
        if current_line:
            lines.append(' '.join(w['text'] for w in current_line))
        
        return ' '.join(lines)
    
    def _build_table_from_cells(
        self,
        cells: List,
        merged: List,
        cell_texts: Dict[Tuple[int, int], str]
    ):
        """셀 정보로부터 Table 객체 생성"""
        from ..table_recovery import Table, TableCell
        
        if not cells:
            return None
        
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
    
    def _calculate_table_confidence(
        self,
        cells: List,
        cell_texts: Dict[Tuple[int, int], str]
    ) -> float:
        """표 복원 신뢰도 계산"""
        if not cells:
            return 0.0
        
        confidence = 0.5  # 기본값
        
        # 셀 수가 충분한지
        if len(cells) >= 4:
            confidence += 0.2
        
        # 텍스트 매핑 비율
        if cells:
            non_empty = sum(1 for t in cell_texts.values() if t.strip())
            mapped_ratio = non_empty / len(cells)
            confidence += mapped_ratio * 0.3
        
        return min(confidence, 1.0)
    
    def _parse_markdown_to_rows(self, markdown: str) -> List[List[str]]:
        """
        마크다운 테이블을 행 데이터로 파싱
        """
        if not markdown:
            return []
        
        rows = []
        lines = markdown.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            
            # 구분선 건너뛰기
            if re.match(r'^\|[\s\-:|]+\|$', line):
                continue
            
            # 테이블 행 파싱
            if line.startswith('|') and line.endswith('|'):
                # 앞뒤 | 제거 후 분할
                inner = line[1:-1]
                cells = [cell.strip() for cell in inner.split('|')]
                rows.append(cells)
        
        return rows
    
    def _is_valid_table(self, table: List[List[str]]) -> bool:
        """
        유효한 표인지 검사 (노이즈 필터링)
        
        Args:
            table: 2D 배열 형태의 표 데이터
            
        Returns:
            bool: 유효한 표 여부
        """
        if not table:
            return False
        
        # 최소 행/열 수 검사
        row_count = len(table)
        col_count = max(len(row) for row in table) if table else 0
        
        if row_count < self.config.pdf.min_table_rows:
            return False
        if col_count < self.config.pdf.min_table_cols:
            return False
        
        # 1셀 표(텍스트 박스) 필터링 - 행 1개 또는 열 1개인 경우 표로 인식하지 않음
        if row_count == 1 and col_count == 1:
            print(f"[TABLE FILTER] 1x1 표(텍스트 박스) 스킵")
            return False
        
        # 1행 표이면서 셀 하나에 모든 텍스트가 있는 경우 (제목 박스)
        if row_count == 1:
            total_text_len = sum(len(str(cell).strip()) for cell in table[0] if cell)
            non_empty_cells = sum(1 for cell in table[0] if cell and str(cell).strip())
            if non_empty_cells == 1 and total_text_len > 20:
                print(f"[TABLE FILTER] 1행 텍스트 박스 스킵 (단일 셀에 긴 텍스트)")
                return False
        
        # 빈 셀이 너무 많은 표 제외
        total_cells = row_count * col_count
        non_empty_cells = sum(
            1 for row in table for cell in row 
            if cell and str(cell).strip()
        )
        
        if total_cells > 0 and non_empty_cells / total_cells < 0.3:
            return False
        
        return True
    
    def _table_to_markdown(self, table: List[List[str]]) -> str:
        """
        2D 배열을 마크다운 테이블로 변환
        
        Args:
            table: 2D 배열 형태의 표 데이터
            
        Returns:
            str: 마크다운 테이블 문자열
        """
        if not table or not table[0]:
            return ""
        
        lines = []
        col_count = max(len(row) for row in table)
        
        # 헤더 행
        header = table[0]
        header_cells = [self._clean_cell(c) for c in header]
        header_cells += [''] * (col_count - len(header_cells))  # 열 수 맞춤
        lines.append('| ' + ' | '.join(header_cells) + ' |')
        
        # 구분선
        lines.append('|' + '|'.join(['---'] * col_count) + '|')
        
        # 데이터 행
        for row in table[1:]:
            cells = [self._clean_cell(c) for c in row]
            cells += [''] * (col_count - len(cells))
            lines.append('| ' + ' | '.join(cells) + ' |')
        
        return '\n'.join(lines)
    
    def _clean_cell(self, cell) -> str:
        """
        셀 데이터 정리 (줄바꿈, 파이프 문자 처리)
        
        Args:
            cell: 셀 데이터 (None, str, 또는 기타)
            
        Returns:
            str: 정리된 셀 문자열
        """
        if cell is None:
            return ''
        text = str(cell).strip()
        text = text.replace('\n', ' ')      # 줄바꿈 제거
        text = text.replace('|', '\\|')     # 파이프 이스케이프
        text = re.sub(r'\s+', ' ', text)    # 연속 공백 정리
        return text
    
    def _merge_text_and_tables(self, text: str, tables: List[TableData]) -> str:
        """
        텍스트와 표를 병합 (RAG 최적화 - 선형화 텍스트 사용)
        
        전략:
        1. 텍스트에서 표 내용으로 보이는 부분을 감지
        2. 해당 부분을 선형화된 표 텍스트로 대체
        3. 대체 불가능한 경우 적절한 위치에 삽입
        
        Args:
            text: 추출된 텍스트
            tables: 추출된 표 목록
            
        Returns:
            str: 병합된 텍스트
        """
        if not tables:
            return text
        
        result_text = text
        tables_inserted = []
        
        for table in tables:
            # semantic_text 사용 (없으면 markdown 폴백)
            table_text = table.semantic_text if table.semantic_text else table.markdown
            if not table.rows or not table_text:
                continue
            
            # 표의 첫 번째 행과 마지막 행에서 고유 키워드 추출
            first_row_text = ' '.join(str(cell) for cell in table.rows[0] if cell)
            last_row_text = ' '.join(str(cell) for cell in table.rows[-1] if cell) if len(table.rows) > 1 else ""
            
            # 표 데이터의 모든 셀 텍스트 추출 (중복 제거용)
            all_table_text = set()
            for row in table.rows:
                for cell in row:
                    if cell and len(str(cell).strip()) > 2:
                        all_table_text.add(str(cell).strip())
            
            # 텍스트에서 표 영역 찾기 (연속된 짧은 줄들)
            replaced = False
            
            # 방법 1: 첫 번째 행 키워드로 위치 찾기
            if first_row_text and len(first_row_text) > 5:
                # 첫 번째 행의 주요 단어들 추출
                key_words = [w for w in first_row_text.split() if len(w) > 2][:3]
                
                if key_words:
                    # 모든 키워드가 가까이 있는 위치 찾기
                    pattern_str = r'(' + r'[^\n]*'.join(re.escape(w) for w in key_words) + r')'
                    match = re.search(pattern_str, result_text, re.IGNORECASE)
                    
                    if match:
                        # 표 영역 시작점 찾기 (매치 이전 줄바꿈부터)
                        start_pos = result_text.rfind('\n', 0, match.start())
                        start_pos = start_pos + 1 if start_pos >= 0 else match.start()
                        
                        # 표 영역 끝점 찾기 (표 데이터 이후)
                        end_pos = match.end()
                        
                        # 표 내용이 있는 동안 확장
                        lines_after = result_text[end_pos:].split('\n')
                        extend_count = 0
                        for i, line in enumerate(lines_after[:len(table.rows) * 2]):
                            line_stripped = line.strip()
                            # 표 데이터에 있는 텍스트가 포함되어 있으면 확장
                            if any(cell_text in line_stripped for cell_text in all_table_text if len(cell_text) > 3):
                                extend_count = i + 1
                        
                        if extend_count > 0:
                            additional_length = sum(len(lines_after[i]) + 1 for i in range(extend_count))
                            end_pos += additional_length
                        
                        # 선형화된 표 텍스트로 대체
                        before = result_text[:start_pos].rstrip()
                        after = result_text[end_pos:].lstrip()
                        result_text = f"{before}\n\n{table_text}\n\n{after}"
                        replaced = True
                        tables_inserted.append(table.table_index)
            
            # 방법 2: 대체 실패 시 적절한 위치에 삽입
            if not replaced:
                # 페이지 구분자나 단락 끝에 삽입
                insert_marker = f"\n\n{table_text}\n"
                
                # 텍스트 중간에 적절한 위치 찾기 (빈 줄 2개 이상)
                double_newline_pos = result_text.find('\n\n\n')
                if double_newline_pos > 0 and double_newline_pos < len(result_text) * 0.8:
                    result_text = result_text[:double_newline_pos] + insert_marker + result_text[double_newline_pos:]
                else:
                    # 끝에 추가
                    result_text = result_text.rstrip() + insert_marker
        
        return result_text.strip()
    
    def _apply_postprocessing(self, text: str) -> Tuple[str, List[dict]]:
        """
        후처리 적용 (설정 기반)
        
        옵션:
        - remove_headers: 머리글 제거
        - remove_page_numbers: 페이지 번호 제거
        - normalize_whitespace: 공백 정규화
        - normalize_special_chars: 특수문자 정규화
        - ocr_error_correction: OCR 오류 교정
        - domain_term_correction: 도메인 용어 교정
        + 인코딩 복구 (encoding 설정 기반)
        """
        corrections = []
        
        # 인코딩 복구 (설정 기반)
        # encoding 설정이 있으면 해당 설정 사용, 없으면 기본값 사용
        encoding_config = getattr(self.config, 'encoding', None)
        if encoding_config:
            text, enc_corrections = apply_encoding_recovery(
                text,
                config_encoding=encoding_config.force_encoding,
                fix_utf16=encoding_config.fix_utf16_errors,
                remove_broken=encoding_config.remove_broken_chars
            )
            corrections.extend(enc_corrections)
        else:
            # 기존 방식 (하위 호환성)
            # UTF-16 인코딩 오류 감지 및 복구 (최우선 처리)
            if detect_utf16_misencoding(text):
                fixed_text, was_fixed = try_fix_utf16_misencoding(text)
                if was_fixed:
                    text = fixed_text
                    corrections.append({
                        "type": "encoding_fix",
                        "description": "UTF-16 인코딩 오류 복구",
                        "fixed": True
                    })
            
            # 바이너리 쓰레기 문자 제거
            original_len = len(text)
            text = clean_binary_garbage(text)
            if len(text) < original_len:
                corrections.append({
                    "type": "binary_cleanup",
                    "removed_chars": original_len - len(text)
                })
        
        # OCR 오류 패턴 교정
        if self.config.postprocessing.ocr_error_correction:
            ocr_patterns = [
                # 주의: 숫자 0을 ㅇ으로 바꾸는 패턴은 제거됨 (잘못된 변환)
                (r'조례([가-힣])', r'조례 \1', "띄어쓰기 교정"),
                (r'l([가-힣])', r'ㅣ\1', "소문자 l을 ㅣ로 교정"),
                (r'([가-힣])ll([가-힣])', r'\1ㅣㅣ\2', "소문자 ll 교정"),
            ]
            
            for pattern, replacement, description in ocr_patterns:
                matches = re.findall(pattern, text)
                if matches:
                    text = re.sub(pattern, replacement, text)
                    corrections.append({
                        "type": "ocr_pattern",
                        "pattern": pattern,
                        "description": description,
                        "count": len(matches)
                    })
        
        # ㅇ → 0 변환 (숫자 문맥에서 ㅇ를 0으로 복구)
        text, jieut_count = fix_jieut_to_zero(text)
        if jieut_count > 0:
            corrections.append({
                "type": "jieut_to_zero",
                "description": "숫자 문맥에서 ㅇ를 0으로 복구",
                "count": jieut_count
            })
        
        # 도메인 용어 교정
        if self.config.postprocessing.domain_term_correction:
            for wrong, correct in self.DOMAIN_CORRECTIONS.items():
                if wrong in text:
                    count = text.count(wrong)
                    text = text.replace(wrong, correct)
                    corrections.append({
                        "type": "domain_term",
                        "from": wrong,
                        "to": correct,
                        "count": count
                    })
        
        # 머리글 제거
        if self.config.postprocessing.remove_headers:
            # 반복되는 짧은 패턴 제거 (페이지 상단)
            lines = text.split('\n')
            if len(lines) > 10:
                # 첫 줄이 여러 페이지에서 반복되면 머리글로 판단
                first_lines = [l.strip() for l in lines[:3] if l.strip()]
                # TODO: 더 정교한 머리글 탐지 로직
        
        # 페이지 번호 제거
        if self.config.postprocessing.remove_page_numbers:
            for pattern in self.PAGE_NUMBER_PATTERNS:
                text = pattern.sub('', text)
            
            # 추가 페이지 번호 패턴
            text = re.sub(r'\n\s*-\s*\d+\s*-\s*\n', '\n', text)
            text = re.sub(r'\n\s*\d+\s*/\s*\d+\s*\n', '\n', text)
        
        # 공백 정리
        if self.config.postprocessing.normalize_whitespace:
            text = re.sub(r' +', ' ', text)  # 연속 공백
            text = re.sub(r'\n{3,}', '\n\n', text)  # 연속 줄바꿈
            text = re.sub(r'^\s+', '', text, flags=re.MULTILINE)  # 줄 시작 공백
        
        # 특수문자 정규화
        if self.config.postprocessing.normalize_special_chars:
            char_map = {
                '．': '.',
                '，': ',',
                '：': ':',
                '；': ';',
                '（': '(',
                '）': ')',
                '［': '[',
                '］': ']',
                '｛': '{',
                '｝': '}',
                '～': '~',
                '！': '!',
                '？': '?',
            }
            for old, new in char_map.items():
                if old in text:
                    text = text.replace(old, new)
        
        return text.strip(), corrections
    
    def _validate_quality(self, text: str) -> QualityDetails:
        """
        텍스트 품질 검증 (quality_validation.enabled 기반)
        
        검증 지표:
        - 한글 비율 (30%)
        - 깨진문자 비율 (25%)
        - 문장 구조 유효성 (15%)
        - 반복 패턴 이상 (10%)
        - 인코딩 오류 감지 (20%)
        """
        if not self.config.quality_validation.enabled:
            return QualityDetails(
                korean_score=1.0, broken_score=1.0, sentence_score=1.0,
                repetition_score=1.0, encoding_score=1.0, overall_score=1.0
            )
        
        if not text or len(text.strip()) < 10:
            return QualityDetails(overall_score=0.0)
        
        # 한글 비율 (문서 유형에 따라 유연하게 평가)
        korean_ratio = self._calculate_korean_ratio(text)
        korean_score = self._score_korean_ratio(korean_ratio, text)
        
        # 깨진 문자 비율
        broken_ratio = self._calculate_broken_ratio(text)
        broken_score = 1.0 - min(broken_ratio * 5, 1.0)  # 20% 이상이면 0점
        
        # 문장 구조 검사
        sentence_score = self._check_sentence_structure(text)
        
        # 반복 패턴 검사
        repetition_score = self._check_repetition(text)
        
        # UTF-16 인코딩 오류 검사
        has_encoding_error = detect_utf16_misencoding(text)
        encoding_score = 0.0 if has_encoding_error else 1.0
        
        # 가중 평균 계산
        weights = {
            "korean": 0.30,
            "broken": 0.25,
            "sentence": 0.15,
            "repetition": 0.10,
            "encoding": 0.20
        }
        
        overall = (
            korean_score * weights["korean"] +
            broken_score * weights["broken"] +
            sentence_score * weights["sentence"] +
            repetition_score * weights["repetition"] +
            encoding_score * weights["encoding"]
        )
        
        return QualityDetails(
            # 원시 값
            korean_ratio=korean_ratio,
            broken_char_ratio=broken_ratio,
            sentence_structure=sentence_score,
            repetition_anomaly=1.0 - repetition_score,  # anomaly는 낮을수록 좋음
            encoding_error=has_encoding_error,
            # 정규화된 점수
            korean_score=round(korean_score, 4),
            broken_score=round(broken_score, 4),
            sentence_score=round(sentence_score, 4),
            repetition_score=round(repetition_score, 4),
            encoding_score=round(encoding_score, 4),
            # 종합 점수
            overall_score=round(overall, 4)
        )
    
    def _calculate_korean_ratio(self, text: str) -> float:
        """한글 비율 계산"""
        text_no_space = re.sub(r'\s', '', text)
        if not text_no_space:
            return 0.0
        korean_chars = len(self.KOREAN_PATTERN.findall(text))
        return korean_chars / len(text_no_space)
    
    def _score_korean_ratio(self, ratio: float, text: str = "") -> float:
        """
        한글 비율 점수화 (문서 유형 고려)
        
        표/숫자/영문 약어가 많은 문서(통계, ICT 보고서 등)는 
        한글 비율이 낮아도 정상일 수 있음
        """
        # 숫자/영문이 많은 문서인지 확인
        if text:
            text_no_space = re.sub(r'\s', '', text)
            if text_no_space:
                digit_count = sum(1 for c in text_no_space if c.isdigit())
                english_count = sum(1 for c in text_no_space if c.isascii() and c.isalpha())
                digit_ratio = digit_count / len(text_no_space)
                english_ratio = english_count / len(text_no_space)
                
                # 숫자/영문이 많은 문서는 한글 비율 기준 완화
                if digit_ratio > 0.15 or english_ratio > 0.20:
                    # 통계/기술 문서로 판단
                    if ratio >= 0.20:
                        return 1.0
                    elif ratio >= 0.10:
                        return 0.8
                    elif ratio >= 0.05:
                        return 0.6
        
        # 기본 점수 기준
        if 0.55 <= ratio <= 0.90:
            return 1.0
        elif 0.40 <= ratio < 0.55 or 0.90 < ratio <= 0.95:
            return 0.7
        elif 0.25 <= ratio < 0.40:
            return 0.5
        elif 0.15 <= ratio < 0.25:
            return 0.3
        return 0.1
    
    def _calculate_broken_ratio(self, text: str) -> float:
        """깨진 문자 비율 계산"""
        if not text:
            return 0.0
        broken_chars = len(self.BROKEN_CHAR_PATTERN.findall(text))
        return broken_chars / len(text)
    
    def _check_sentence_structure(self, text: str) -> float:
        """
        문장 구조 유효성 검사 (목록/표 형식 지원)
        
        일반 문장뿐 아니라 목록 형식(-, •, ○, ※)과 
        마크다운 표(|) 형식도 유효한 구조로 인정
        """
        words = text.split()
        lines = text.split('\n')
        
        if len(words) < 10:
            return 0.5
        
        # 1. 마크다운 표 확인 (| 문자가 있는 줄)
        table_lines = sum(1 for line in lines if '|' in line and line.count('|') >= 2)
        if table_lines >= 3:
            # 마크다운 표가 있으면 높은 점수
            table_ratio = table_lines / max(len(lines), 1)
            if table_ratio >= 0.2:
                return 1.0
            return 0.9
        
        # 2. 목록 형식 확인 (-, •, ○, ※, ㅇ, □, ▶ 등으로 시작하는 줄)
        list_pattern = re.compile(r'^\s*[-•○※ㅇ□▶▷◆◇★☆►◎⦁⦾]\s*\S')
        numbered_pattern = re.compile(r'^\s*(\d+[.)]\s*|\([가-힣\d]+\)\s*|\d+\.\d+\s*)')
        
        list_lines = sum(1 for line in lines if list_pattern.match(line) or numbered_pattern.match(line))
        if list_lines >= 3:
            list_ratio = list_lines / max(len(lines), 1)
            if list_ratio >= 0.2:
                return 1.0
            return 0.85
        
        # 3. 일반 문장 구조 확인
        sentence_endings = re.findall(r'[.!?。]\s', text)
        
        if sentence_endings:
            avg_words_per_sentence = len(words) / len(sentence_endings)
            if 5 <= avg_words_per_sentence <= 30:
                return 1.0
            elif 3 <= avg_words_per_sentence <= 50:
                return 0.7
            return 0.4
        
        # 4. 줄 단위로 구분된 텍스트 (표/목록 없이)
        # 각 줄이 적당한 길이를 가지면 유효
        non_empty_lines = [l for l in lines if l.strip()]
        if len(non_empty_lines) >= 5:
            avg_line_length = sum(len(l.strip()) for l in non_empty_lines) / len(non_empty_lines)
            if 10 <= avg_line_length <= 200:
                return 0.7
        
        return 0.5
    
    def _check_repetition(self, text: str) -> float:
        """반복 패턴 이상 검사"""
        repetitions = self.REPETITION_PATTERN.findall(text)
        if not text:
            return 1.0
        
        repetition_ratio = len(repetitions) / max(len(text) / 100, 1)
        return max(0, 1.0 - repetition_ratio * 0.2)
    
    def _get_primary_method(self, pages: List[PageResult]) -> ExtractionMethod:
        """주요 추출 방법 결정"""
        method_counts = {}
        for page in pages:
            method_counts[page.method] = method_counts.get(page.method, 0) + 1
        
        if not method_counts:
            return ExtractionMethod.TEXT_LAYER
        
        return max(method_counts, key=method_counts.get)
    
    def _count_tokens(self, text: str) -> int:
        """토큰 수 계산 (tiktoken 사용)"""
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except ImportError:
            return len(text) // 2
