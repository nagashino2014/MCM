"""
텍스트 추출 서비스
- 파일 형식별 추출기 관리
- 배치 처리 (concurrent_files 설정 반영)
- 타임아웃 처리 (timeout_seconds 설정 반영)
- 결과 저장
- 파일 시그니처 기반 형식 감지 (확장자와 실제 형식 불일치 처리)
"""
import json
import asyncio
import tempfile
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from ..extractors.base import ExtractionResult, ExtractionStatus
from ..extractors.pdf_extractor import PDFExtractor
from ..extractors.hwp_extractor import HWPExtractor, HWPXExtractor
from ..extractors.docx_extractor import DOCXExtractor
from ..extractors.xlsx_extractor import XLSXExtractor
from ..extractors.html_extractor import HTMLExtractor
from ..config import ExtractionConfig, default_config, EXTRACTED_DATA_DIR, SCRAPING_DATA_DIR, USE_R2
from ..utils.table_normalizer import TableNormalizer, create_normalizer_from_config
from ..table_merge import CrossPageTableMerger, CrossPageMergeConfig


# 파일 시그니처 (매직 넘버) 정의
FILE_SIGNATURES = {
    b'\xD0\xCF\x11\xE0': 'ole',      # OLE Compound File (HWP, DOC, XLS, PPT)
    b'\x50\x4B\x03\x04': 'zip',      # ZIP archive (HWPX, DOCX, XLSX, PPTX)
    b'\x50\x4B\x05\x06': 'zip',      # ZIP archive (empty)
    b'\x50\x4B\x07\x08': 'zip',      # ZIP archive (spanned)
    b'\x25\x50\x44\x46': 'pdf',      # PDF (%PDF)
}


def detect_file_format(file_path: Path) -> Tuple[str, str]:
    """
    파일 시그니처를 확인하여 실제 파일 형식 감지
    
    Returns:
        Tuple[str, str]: (확장자 기반 형식, 시그니처 기반 실제 형식)
    """
    extension = file_path.suffix.lower().lstrip('.')
    
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
        
        # 시그니처 매칭
        detected_type = None
        for signature, file_type in FILE_SIGNATURES.items():
            if header.startswith(signature):
                detected_type = file_type
                break
        
        # 실제 형식 결정
        if detected_type == 'ole':
            # OLE 파일: HWP 또는 구버전 Office 파일
            if extension in ('hwp', 'hwpx'):
                return extension, 'hwp'  # 실제로는 HWP
            elif extension in ('doc', 'xls', 'ppt'):
                return extension, extension
            else:
                return extension, 'hwp'  # 기본적으로 HWP로 처리
        
        elif detected_type == 'zip':
            # ZIP 기반: HWPX, DOCX, XLSX 등
            if extension == 'hwp':
                return extension, 'hwpx'  # 실제로는 HWPX
            return extension, extension
        
        elif detected_type == 'pdf':
            return extension, 'pdf'
        
        # 시그니처로 판단 불가: 확장자 기반
        return extension, extension
        
    except Exception:
        return extension, extension


def resolve_file_path(file_path_str: str) -> Tuple[Path, str]:
    """
    스토리지 키 또는 로컬 경로를 실제 읽을 수 있는 로컬 경로로 변환.

    R2 모드일 때 로컬에 파일이 없으면 R2에서 임시 파일로 다운로드합니다.

    Returns:
        (local_path, original_key):
            local_path  — 추출기에 전달할 로컬 파일 경로
            original_key — _save_result에서 org/board 파싱에 사용할 원본 키
    """
    original_key = file_path_str
    fp = Path(file_path_str)

    # 1) 절대 경로 + 존재 → 그대로
    if fp.is_absolute() and fp.exists():
        return fp, original_key

    # 2) save/ 아래 로컬 파일 확인
    local_candidates = [
        SCRAPING_DATA_DIR.parent / file_path_str,           # save/{key}
        SCRAPING_DATA_DIR / file_path_str,                   # save/ScrapingData/{key}
    ]
    if file_path_str.startswith("ScrapingData/"):
        local_candidates.insert(0, SCRAPING_DATA_DIR.parent / file_path_str)

    for candidate in local_candidates:
        if candidate.exists():
            return candidate, original_key

    # 3) R2 모드: R2에서 다운로드하여 임시 파일 생성
    if USE_R2:
        try:
            from ..r2_storage import download_from_r2
            data = download_from_r2(file_path_str)
            temp_dir = tempfile.mkdtemp(prefix="extract_r2_")
            temp_path = Path(temp_dir) / fp.name
            temp_path.write_bytes(data)
            print(f"[R2 READ] {file_path_str} → {temp_path} ({len(data)} bytes)")
            return temp_path, original_key
        except Exception as e:
            print(f"[R2 READ FAILED] {file_path_str}: {e}")

    # 4) 폴백: 원래 경로 그대로
    return fp, original_key


def _parse_org_board_from_key(original_key: str) -> Tuple[Optional[str], Optional[str]]:
    """
    스토리지 키 또는 로컬 경로에서 기관명/보드명을 추출합니다.
    ScrapingData/{org}/{board}/... 패턴을 인식합니다.
    """
    normalized = original_key.replace("\\", "/")
    marker = "ScrapingData/"
    idx = normalized.find(marker)
    if idx == -1:
        return None, None
    remainder = normalized[idx + len(marker):]
    parts = remainder.split("/")
    if len(parts) >= 2:
        return parts[0], parts[1]
    return None, None


class ExtractionService:
    """
    텍스트 추출 서비스
    
    설정 반영:
    - processing.concurrent_files: 동시 처리 파일 수
    - processing.timeout_seconds: 파일당 타임아웃
    - processing.auto_retry: 자동 재시도
    - processing.max_retries: 최대 재시도 횟수
    - retry_strategy: 재추출 전략 설정
    """
    
    # 단계적 재시도 설정 프리셋
    PROGRESSIVE_RETRY_LEVELS = [
        # Level 0: 기본 설정
        {},
        # Level 1: OCR 민감도 높임
        {"ocr": {"det_db_thresh": 0.2, "det_db_box_thresh": 0.4}},
        # Level 2: DPI 높임 + 전처리 강화
        {"preprocessing": {"target_dpi": 400, "binarize": True, "denoise": True}},
        # Level 3: 강제 OCR 모드
        {"pdf": {"force_ocr_mode": True, "prefer_text_layer": False}},
    ]
    
    def __init__(self, config: Optional[ExtractionConfig] = None):
        self.config = config or default_config
        self._init_extractors()
        self._init_executor()
        self._init_cross_page_merger()
    
    def _init_extractors(self):
        """추출기 초기화"""
        self.extractors = {
            "pdf": PDFExtractor(self.config),
            "hwp": HWPExtractor(self.config),
            "hwpx": HWPXExtractor(self.config),
            "docx": DOCXExtractor(self.config),
            "xlsx": XLSXExtractor(self.config),
            "html": HTMLExtractor(self.config),
            "htm": HTMLExtractor(self.config),
        }
    
    def _init_executor(self):
        """스레드풀 초기화 (concurrent_files 설정 반영)"""
        self.executor = ThreadPoolExecutor(
            max_workers=self.config.processing.concurrent_files
        )
    
    def _init_cross_page_merger(self):
        """Cross-page 표 병합기 초기화"""
        # 설정에서 Cross-page 병합 설정 로드
        merge_config = CrossPageMergeConfig()
        
        # ExtractionConfig에 cross_page_merge 설정이 있으면 사용
        if hasattr(self.config, 'cross_page_merge'):
            cfg = self.config.cross_page_merge
            merge_config = CrossPageMergeConfig(
                enabled=getattr(cfg, 'enabled', True),
                min_column_match_threshold=getattr(cfg, 'min_column_match_threshold', 0.85),
                header_similarity_threshold=getattr(cfg, 'header_similarity_threshold', 0.90),
                merge_confidence_threshold=getattr(cfg, 'merge_confidence_threshold', 0.70),
                enable_header_dedup=getattr(cfg, 'enable_header_dedup', True),
                pdf_use_bbox_analysis=getattr(cfg, 'pdf_use_bbox_analysis', True),
            )
        
        self.cross_page_merger = CrossPageTableMerger(merge_config)
    
    def _apply_cross_page_merge(
        self, 
        result: ExtractionResult,
        page_height: float = None
    ) -> ExtractionResult:
        """
        추출 결과에 Cross-page 표 병합 적용
        
        Args:
            result: 추출 결과
            page_height: 페이지 높이 (PDF 위치 분석용)
            
        Returns:
            ExtractionResult: 병합 적용된 결과
        """
        if not hasattr(self, 'cross_page_merger'):
            return result
        
        try:
            merged_result = self.cross_page_merger.process(result, page_height)
            return merged_result
        except Exception as e:
            print(f"[CROSS-PAGE MERGE ERROR] {e}")
            return result
    
    def _apply_progressive_settings(self, level: int) -> None:
        """단계적 재시도 설정 적용"""
        if level >= len(self.PROGRESSIVE_RETRY_LEVELS):
            return
        
        settings = self.PROGRESSIVE_RETRY_LEVELS[level]
        
        for category, values in settings.items():
            if hasattr(self.config, category):
                config_obj = getattr(self.config, category)
                for key, value in values.items():
                    if hasattr(config_obj, key):
                        setattr(config_obj, key, value)
        
        # 추출기 재초기화 (설정 반영)
        self._init_extractors()
    
    def _extract_with_multi_engine(self, file_path: str, actual_format: str, 
                                   progress_callback: Optional[Callable] = None) -> ExtractionResult:
        """
        다중 엔진으로 추출 후 최고 품질 결과 반환
        
        PDF 파일에 대해 여러 OCR 엔진을 시도하고 가장 좋은 결과를 선택합니다.
        """
        if actual_format != "pdf":
            # PDF가 아니면 일반 추출
            extractor = self.extractors.get(actual_format)
            return extractor.extract(str(file_path)) if extractor else None
        
        engines = self.config.retry_strategy.engines_to_compare
        best_result = None
        best_score = -1
        
        original_engine = self.config.ocr.engine
        
        for engine in engines:
            try:
                # 엔진 변경
                self.config.ocr.engine = engine
                self._init_extractors()
                
                extractor = self.extractors.get("pdf")
                result = extractor.extract(str(file_path), progress_callback)
                
                if result and result.quality_score > best_score:
                    best_score = result.quality_score
                    best_result = result
                    
                print(f"[MULTI-ENGINE] {engine}: quality={result.quality_score:.3f}")
                
                # 품질이 충분히 좋으면 조기 종료
                if best_score >= self.config.quality_validation.pass_threshold:
                    break
                    
            except Exception as e:
                print(f"[MULTI-ENGINE] {engine} failed: {e}")
        
        # 원래 엔진으로 복원
        self.config.ocr.engine = original_engine
        self._init_extractors()
        
        return best_result
    
    def _adjust_settings_by_quality(self, quality_details) -> dict:
        """
        품질 점수 항목별로 설정 조정 제안
        
        Returns:
            dict: 조정된 설정
        """
        adjustments = {}
        
        if quality_details is None:
            return adjustments
        
        # 한국어 비율이 낮으면 OCR 언어 확인
        if quality_details.korean_score < 0.5:
            adjustments["ocr"] = {"languages": ["korean", "en", "chi_sim"]}
        
        # 깨진 문자가 많으면 인코딩 복구 강화
        if quality_details.broken_score < 0.7:
            adjustments["encoding"] = {
                "fix_utf16_errors": True,
                "remove_broken_chars": True,
                "try_multiple_encodings": True,
            }
        
        # 인코딩 오류가 감지되면
        if quality_details.encoding_score < 0.5:
            adjustments["encoding"] = {
                "fix_utf16_errors": True,
                "auto_detect": True,
            }
            adjustments["pdf"] = {
                "force_ocr_mode": True,  # 텍스트 레이어 문제일 수 있음
            }
        
        return adjustments
    
    def extract_file(
        self, 
        file_path: str,
        progress_callback: Optional[Callable] = None
    ) -> ExtractionResult:
        """
        단일 파일 텍스트 추출

        file_path는 로컬 절대 경로 또는 스토리지 키(예: ScrapingData/기관/보드/2026-02/file.pdf)
        를 모두 허용합니다. R2 모드에서는 로컬에 파일이 없을 경우 R2에서 자동 다운로드합니다.
        """
        local_path, original_key = resolve_file_path(file_path)
        temp_dir_to_clean: Optional[str] = None

        if str(local_path).startswith(tempfile.gettempdir()):
            temp_dir_to_clean = str(local_path.parent)

        try:
            return self._do_extract(local_path, original_key, progress_callback)
        finally:
            if temp_dir_to_clean:
                try:
                    shutil.rmtree(temp_dir_to_clean, ignore_errors=True)
                except Exception:
                    pass

    def _do_extract(
        self,
        file_path: Path,
        original_key: str,
        progress_callback: Optional[Callable] = None,
    ) -> ExtractionResult:
        """실제 추출 로직. file_path는 로컬에 존재하는 파일 경로."""

        extension, actual_format = detect_file_format(file_path)

        if extension != actual_format:
            print(f"[FORMAT MISMATCH] File '{file_path.name}': extension=.{extension}, actual={actual_format}")

        extractor = self.extractors.get(actual_format)
        if not extractor:
            return ExtractionResult(
                file_path=original_key,
                file_format=actual_format,
                status=ExtractionStatus.FAILED,
                error_message=f"Unsupported file format: {actual_format}"
            )
        
        if self.config.retry_strategy.multi_engine_comparison and actual_format == "pdf":
            result = self._extract_with_multi_engine(str(file_path), actual_format, progress_callback)
            if result:
                result.file_path = original_key
                if result.status != ExtractionStatus.FAILED:
                    self._save_result(result)
                    return result
                else:
                    print(f"[MULTI-ENGINE] 모든 엔진 실패, 재시도 건너뜀: {file_path.name}")
                    return result
        
        max_retries = self.config.processing.max_retries if self.config.processing.auto_retry else 0
        last_error = None
        best_result = None
        best_score = -1
        
        for attempt in range(max_retries + 1):
            try:
                if self.config.retry_strategy.enable_progressive_retry and attempt > 0:
                    level = min(attempt, len(self.PROGRESSIVE_RETRY_LEVELS) - 1)
                    print(f"[PROGRESSIVE RETRY] Applying level {level} settings")
                    self._apply_progressive_settings(level)
                
                if actual_format == "pdf" and hasattr(extractor, 'extract'):
                    result = extractor.extract(str(file_path), progress_callback)
                else:
                    result = extractor.extract(str(file_path))

                result.file_path = original_key
                
                if (self.config.retry_strategy.quality_based_adjustment and 
                    result.quality_details and 
                    result.quality_score < self.config.quality_validation.pass_threshold):
                    
                    adjustments = self._adjust_settings_by_quality(result.quality_details)
                    if adjustments:
                        print(f"[QUALITY ADJUSTMENT] Applying: {adjustments}")
                        for cat, vals in adjustments.items():
                            if hasattr(self.config, cat):
                                for k, v in vals.items():
                                    setattr(getattr(self.config, cat), k, v)
                        self._init_extractors()
                
                if result.quality_score > best_score:
                    best_score = result.quality_score
                    best_result = result
                
                if result.status != ExtractionStatus.FAILED:
                    result = self._apply_cross_page_merge(result)
                    self._save_result(result)
                    return result
                
                last_error = result.error_message
                
            except Exception as e:
                last_error = str(e)
                
            # 마지막 시도가 아니면 잠시 대기 후 재시도
            if attempt < max_retries:
                import time
                time.sleep(1)  # 1초 대기
        
        # 모든 재시도 후에도 임계값 미달
        # best_result가 있으면 품질 점수를 유지하면서 FAILED 상태로 반환
        if best_result and best_result.quality_score > 0:
            # 추출기 결과가 실패가 아닌 경우 그대로 반환
            if best_result.status != ExtractionStatus.FAILED:
                best_result = self._apply_cross_page_merge(best_result)
                self._save_result(best_result)
                return best_result
            # 품질 점수가 있지만 임계값 미달로 실패 처리된 경우
            best_result.status = ExtractionStatus.FAILED
            best_result.error_message = f"Quality score ({best_result.quality_score:.2%}) below threshold ({self.config.quality_validation.pass_threshold:.2%})"
            print(f"[QUALITY FAILED] {file_path.name}: score={best_result.quality_score:.3f}, threshold={self.config.quality_validation.pass_threshold}")
            self._save_result(best_result)
            return best_result
        
        return ExtractionResult(
            file_path=original_key,
            file_format=actual_format,
            status=ExtractionStatus.FAILED,
            error_message=f"Failed after {max_retries + 1} attempts: {last_error}"
        )
    
    async def extract_file_async(
        self, 
        file_path: str,
        progress_callback: Optional[Callable] = None
    ) -> ExtractionResult:
        """
        비동기 단일 파일 추출 (파일 크기, 페이지 수, 이미지 비율 기반 동적 타임아웃)
        """
        loop = asyncio.get_event_loop()
        
        # 파일 크기 확인 (R2 모드에서는 로컬 파일이 없으므로 기본 타임아웃 사용)
        file_size_mb = 0
        total_pages = 0
        image_ratio = 0.0
        
        try:
            if Path(file_path).exists():
                file_size_mb = Path(file_path).stat().st_size / (1024 * 1024)
                
                # PDF인 경우 페이지 수와 이미지 비율 확인
                if file_path.lower().endswith('.pdf'):
                    import fitz
                    doc = fitz.open(file_path)
                    total_pages = len(doc)
                    
                    # 이미지 비율 측정 (처음 10페이지만 샘플링)
                    sample_pages = min(10, total_pages)
                    ocr_needed_count = 0
                    for i in range(sample_pages):
                        page_text = doc[i].get_text("text").strip()
                        if len(page_text) < 50:
                            ocr_needed_count += 1
                    image_ratio = ocr_needed_count / sample_pages if sample_pages > 0 else 0
                    doc.close()
        except:
            pass
        
        # 기본 타임아웃 설정
        large_threshold = getattr(self.config.processing, 'large_file_threshold_mb', 5.0)
        large_timeout = getattr(self.config.processing, 'large_file_timeout_seconds', 900)
        
        if file_size_mb >= large_threshold:
            timeout = large_timeout
        else:
            timeout = self.config.processing.timeout_seconds
        
        # 동적 타임아웃 조정: 페이지 수, 이미지 비율 고려
        if total_pages >= 30:
            timeout += 300
        
        # 이미지 비율에 따른 타임아웃 대폭 조정 (100% 이미지 PDF 지원)
        if image_ratio >= 0.9:
            # 100% 이미지 PDF: 페이지당 30초 + 기본 타임아웃
            timeout = timeout + (total_pages * 30)
            timeout = min(timeout, 3600)  # 최대 1시간
            print(f"[EXTRACTION] 100% 이미지 PDF 감지: {total_pages}페이지, 타임아웃 {timeout}초")
        elif image_ratio >= 0.5:
            # 50% 이상 이미지: 페이지당 15초 추가
            timeout = timeout + (total_pages * 15)
            timeout = min(timeout, 2400)  # 최대 40분
        elif image_ratio >= 0.2:
            timeout = int(timeout * 1.5)
        
        # 추가 버퍼 60초 (PDF extractor 내부 타임아웃보다 여유있게)
        timeout += 60
        
        if file_size_mb >= large_threshold or total_pages >= 30 or image_ratio >= 0.2:
            print(f"[EXTRACTION] 대용량/복잡 파일 ({file_size_mb:.1f}MB, {total_pages}페이지, 이미지{image_ratio:.0%}), 타임아웃: {timeout}초")
        
        try:
            # 타임아웃 적용
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    self.executor, 
                    lambda: self.extract_file(file_path, progress_callback)
                ),
                timeout=timeout
            )
            return result
            
        except asyncio.TimeoutError:
            return ExtractionResult(
                file_path=file_path,
                file_format=Path(file_path).suffix.lower().lstrip('.'),
                status=ExtractionStatus.FAILED,
                error_message=f"Extraction timeout after {timeout} seconds"
            )
        except Exception as e:
            return ExtractionResult(
                file_path=file_path,
                file_format=Path(file_path).suffix.lower().lstrip('.'),
                status=ExtractionStatus.FAILED,
                error_message=str(e)
            )
    
    async def extract_files_batch(
        self, 
        file_paths: List[str],
        progress_callback: Optional[Callable] = None
    ) -> List[ExtractionResult]:
        """
        배치 파일 추출 (concurrent_files 설정 반영)
        
        Args:
            file_paths: 파일 경로 목록
            progress_callback: 진행 상황 콜백 (current, total, result)
            
        Returns:
            List[ExtractionResult]: 추출 결과 목록
        """
        results = []
        total = len(file_paths)
        
        # 동시 처리 제한 (concurrent_files 설정 반영)
        semaphore = asyncio.Semaphore(self.config.processing.concurrent_files)
        
        async def process_file(idx: int, file_path: str) -> ExtractionResult:
            async with semaphore:
                result = await self.extract_file_async(file_path)
                if progress_callback:
                    try:
                        if asyncio.iscoroutinefunction(progress_callback):
                            await progress_callback(idx + 1, total, result)
                        else:
                            progress_callback(idx + 1, total, result)
                    except Exception as e:
                        print(f"[CALLBACK ERROR] {e}")
                return result
        
        # 병렬 실행
        tasks = [
            process_file(idx, fp) 
            for idx, fp in enumerate(file_paths)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 예외 처리
        processed_results = []
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append(ExtractionResult(
                    file_path=file_paths[idx],
                    file_format=Path(file_paths[idx]).suffix.lower().lstrip('.'),
                    status=ExtractionStatus.FAILED,
                    error_message=str(result)
                ))
            else:
                processed_results.append(result)
        
        return processed_results
    
    def _save_result(self, result: ExtractionResult) -> None:
        """
        추출 결과 저장 (JSON 통합 형식 - RAG 최적화)
        
        저장 형식:
        - {파일명}.json: 메타데이터 + 본문 텍스트 + 구조화된 표 데이터
        """
        if not result.text:
            print(f"[SAVE SKIP] 텍스트 없음: {Path(result.file_path).name}")
            return
        
        # 디버그: 저장 시작 로그
        print(f"[SAVE] 저장 시작: {Path(result.file_path).name}, 텍스트 길이: {len(result.text)}")
        
        # 원본 파일 경로 기반으로 저장 경로 생성
        file_path = Path(result.file_path)
        
        # 기관명/보드명 추출: 스토리지 키 패턴 우선, 이후 로컬 경로 폴백
        org_name, board_name = _parse_org_board_from_key(result.file_path)
        
        if org_name is None:
            try:
                relative_path = file_path.relative_to(SCRAPING_DATA_DIR)
                path_parts = relative_path.parts
                if len(path_parts) >= 2:
                    org_name = path_parts[0]
                    board_name = path_parts[1]
            except (ValueError, IndexError):
                pass
        
        # 결과 디렉토리 생성 (기관/보드 폴더 구조)
        date_folder = datetime.now().strftime("%Y-%m")
        if org_name and board_name:
            output_dir = EXTRACTED_DATA_DIR / org_name / board_name / date_folder
        else:
            output_dir = EXTRACTED_DATA_DIR / date_folder
        if not USE_R2:
            output_dir.mkdir(parents=True, exist_ok=True)
        
        # 표 정규화 적용
        text_to_save = result.text
        tables_normalized = 0
        normalization_applied = False
        
        if self.config.table_normalization.enabled:
            try:
                normalizer = create_normalizer_from_config(self.config)
                normalized_text = normalizer.normalize_text(result.text)
                if normalized_text != result.text:
                    text_to_save = normalized_text
                    normalization_applied = True
                    import re
                    tables_normalized = len(re.findall(r'<!--\s*표\s*\d+\s*-->', text_to_save))
            except Exception as e:
                print(f"[TABLE NORMALIZATION ERROR] {e}")
                text_to_save = result.text
        
        # 구조화된 표 데이터 수집
        structured_tables = []
        for page in result.pages:
            for table in page.tables:
                table_entry = {
                    "page_num": page.page_num,
                    "table_index": table.table_index,
                    "row_count": table.row_count,
                    "col_count": table.col_count,
                    "confidence": getattr(table, 'confidence', 0.5),
                    "extraction_method": getattr(table, 'extraction_method', 'unknown'),
                    "semantic_text": getattr(table, 'semantic_text', ''),
                    "structured_data": getattr(table, 'structured_data', None),
                }
                structured_tables.append(table_entry)
        
        # 추출된 표 개수 계산
        tables_extracted = len(structured_tables)
        
        # JSON 통합 파일로 저장
        output_file = output_dir / f"{file_path.stem}.json"
        output_data = {
            # 메타데이터
            "metadata": {
                "source_file": str(file_path),
                "file_format": result.file_format,
                "status": result.status.value,
                "page_count": result.page_count,
                "char_count": result.char_count,
                "token_count": result.token_count,
                "quality_score": result.quality_score,
                "extraction_method": result.extraction_method.value,
                "processing_time_ms": result.processing_time_ms,
                "extracted_at": result.extracted_at,
                "corrections": result.corrections,
                "tables_extracted": tables_extracted,
                "tables_normalized": tables_normalized,
                "normalization_applied": normalization_applied,
                "quality_details": {
                    "korean_ratio": result.quality_details.korean_ratio,
                    "broken_char_ratio": result.quality_details.broken_char_ratio,
                    "sentence_structure": result.quality_details.sentence_structure,
                    "repetition_anomaly": result.quality_details.repetition_anomaly,
                    "overall_score": result.quality_details.overall_score,
                } if result.quality_details else None,
            },
            # 본문 텍스트 (선형화된 표 포함)
            "content": {
                "text": text_to_save,
                "text_length": len(text_to_save),
            },
            # 구조화된 표 데이터 (RAG DB용)
            "tables": structured_tables,
        }
        
        # R2 모드: Cloudflare R2에 업로드 / 로컬 모드: 파일 시스템에 저장
        if USE_R2:
            try:
                from ..r2_storage import upload_json_to_r2
                # R2 키 생성: ExtractedData/{기관}/{보드}/{연도월}/{파일명}.json
                if org_name and board_name:
                    r2_key = f"ExtractedData/{org_name}/{board_name}/{date_folder}/{file_path.stem}.json"
                else:
                    r2_key = f"ExtractedData/{date_folder}/{file_path.stem}.json"
                upload_json_to_r2(r2_key, output_data)
                print(f"[SAVE] R2 업로드 완료: {r2_key}")
            except Exception as e:
                print(f"[SAVE] R2 업로드 실패, 로컬 저장으로 폴백: {e}")
                output_dir.mkdir(parents=True, exist_ok=True)
                output_file = output_dir / f"{file_path.stem}.json"
                output_file.write_text(
                    json.dumps(output_data, ensure_ascii=False, indent=2),
                    encoding="utf-8"
                )
                print(f"[SAVE] JSON 로컬 저장 완료: {output_file}")
        else:
            output_file = output_dir / f"{file_path.stem}.json"
            output_file.write_text(
                json.dumps(output_data, ensure_ascii=False, indent=2), 
                encoding="utf-8"
            )
            print(f"[SAVE] JSON 저장 완료: {output_file}")
    
    def get_supported_formats(self) -> List[str]:
        """지원되는 파일 형식 목록"""
        return list(set(self.extractors.keys()))
    
    def update_config(self, config: ExtractionConfig) -> None:
        """
        설정 업데이트
        
        - 모든 추출기에 새 설정 전파
        - concurrent_files 변경 시 스레드풀 재생성
        - Cross-page 병합기 설정 업데이트
        """
        old_concurrent = self.config.processing.concurrent_files
        self.config = config
        
        # 추출기 설정 업데이트
        for extractor in self.extractors.values():
            if hasattr(extractor, 'update_config'):
                extractor.update_config(config)
            else:
                extractor.config = config
        
        # concurrent_files 변경 시 스레드풀 재생성
        if old_concurrent != config.processing.concurrent_files:
            self.executor.shutdown(wait=False)
            self._init_executor()
        
        # Cross-page 병합기 재초기화
        self._init_cross_page_merger()
    
    def get_current_config(self) -> Dict[str, Any]:
        """현재 설정 반환"""
        return {
            "ocr": {
                "engine": self.config.ocr.engine,
                "use_gpu": self.config.ocr.use_gpu,
                "languages": self.config.ocr.languages,
                "det_db_thresh": self.config.ocr.det_db_thresh,
                "det_db_box_thresh": self.config.ocr.det_db_box_thresh,
                "drop_score": self.config.ocr.drop_score,
            },
            "pdf": {
                "prefer_text_layer": self.config.pdf.prefer_text_layer,
                "enable_ocr": self.config.pdf.enable_ocr,
                "extract_image_text": self.config.pdf.extract_image_text,
                "render_dpi": self.config.pdf.render_dpi,
                "ocr_languages": self.config.pdf.ocr_languages,
            },
            "preprocessing": {
                "enabled": self.config.preprocessing.enabled,
                "adaptive_preprocessing": self.config.preprocessing.adaptive_preprocessing,
                "deskew": self.config.preprocessing.deskew,
                "denoise": self.config.preprocessing.denoise,
                "contrast_enhancement": self.config.preprocessing.contrast_enhancement,
                "target_dpi": self.config.preprocessing.target_dpi,
            },
            "postprocessing": {
                "remove_headers": self.config.postprocessing.remove_headers,
                "remove_page_numbers": self.config.postprocessing.remove_page_numbers,
                "normalize_whitespace": self.config.postprocessing.normalize_whitespace,
                "normalize_special_chars": self.config.postprocessing.normalize_special_chars,
                "ocr_error_correction": self.config.postprocessing.ocr_error_correction,
                "domain_term_correction": self.config.postprocessing.domain_term_correction,
            },
            "quality_validation": {
                "enabled": self.config.quality_validation.enabled,
                "pass_threshold": self.config.quality_validation.pass_threshold,
                "llm_fallback_threshold": self.config.quality_validation.llm_fallback_threshold,
                "auto_llm_fallback": self.config.quality_validation.auto_llm_fallback,
            },
            "processing": {
                "concurrent_files": self.config.processing.concurrent_files,
                "timeout_seconds": self.config.processing.timeout_seconds,
                "auto_retry": self.config.processing.auto_retry,
                "max_retries": self.config.processing.max_retries,
            },
            "table_normalization": {
                "enabled": self.config.table_normalization.enabled,
                "flatten_headers": self.config.table_normalization.flatten_headers,
                "flatten_hierarchy": self.config.table_normalization.flatten_hierarchy,
                "hierarchy_separator": self.config.table_normalization.hierarchy_separator,
                "fill_empty_cells": self.config.table_normalization.fill_empty_cells,
                "empty_cell_strategy": self.config.table_normalization.empty_cell_strategy,
                "normalize_column_count": self.config.table_normalization.normalize_column_count,
                "remove_decoration_chars": self.config.table_normalization.remove_decoration_chars,
            },
        }


# 싱글톤 서비스 인스턴스
_service_instance: Optional[ExtractionService] = None


def get_extraction_service() -> ExtractionService:
    """추출 서비스 인스턴스 반환"""
    global _service_instance
    if _service_instance is None:
        _service_instance = ExtractionService()
    return _service_instance


def reset_extraction_service() -> None:
    """추출 서비스 인스턴스 리셋 (설정 변경 후 호출)"""
    global _service_instance
    if _service_instance:
        _service_instance.executor.shutdown(wait=False)
    _service_instance = None
