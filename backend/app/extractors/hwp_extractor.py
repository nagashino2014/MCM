"""
HWP/HWPX 텍스트 추출 모듈
- HWP: olefile 기반 OLE 구조 파싱 + hwp5 라이브러리
- HWPX: zipfile + lxml 기반 OOXML 파싱
"""
import io
import re
import time
import zlib
import struct
import zipfile
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any
from xml.etree import ElementTree as ET

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
    smart_decode_bytes,
    recover_encoding_with_retry,
    fix_jieut_to_zero,
    detect_and_remove_hwp_space_garbage
)
from ..table_recovery.table_builder import TableBuilder, Table, TableCell
from ..config import ExtractionConfig, default_config

# lxml 지연 로딩 (HWPX용)
_etree = None


def get_lxml_etree():
    """lxml.etree 모듈 지연 로딩"""
    global _etree
    if _etree is None:
        try:
            from lxml import etree
            _etree = etree
        except ImportError:
            print("[WARNING] lxml not installed. HWPX table extraction may fail.")
            return None
    return _etree

# olefile 지연 로딩
_olefile = None


def get_olefile():
    """olefile 모듈 지연 로딩"""
    global _olefile
    if _olefile is None:
        try:
            import olefile
            _olefile = olefile
        except ImportError:
            print("[WARNING] olefile not installed. HWP extraction may fail.")
            return None
    return _olefile


class HWPExtractor(BaseExtractor):
    """
    HWP 텍스트 추출기 (한글 97 ~ 한글 2020)
    
    HWP 파일 구조:
    - OLE 복합 문서 형식
    - FileHeader, DocInfo, BodyText 등의 스토리지로 구성
    - BodyText의 Section 스트림에 실제 텍스트 데이터 저장
    - 텍스트는 zlib 압축되어 있을 수 있음
    """
    
    SUPPORTED_FORMATS = ["hwp"]
    
    # HWP 파일 시그니처
    HWP_SIGNATURE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
    
    # 한글 패턴
    KOREAN_PATTERN = re.compile(r'[가-힣]')
    BROKEN_CHAR_PATTERN = re.compile(r'[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]')
    
    def __init__(self, config: Optional[ExtractionConfig] = None):
        self.config = config or default_config
    
    def supports(self, file_format: str) -> bool:
        """HWP 형식 지원 여부"""
        return file_format.lower() in self.SUPPORTED_FORMATS
    
    def extract(self, file_path: str) -> ExtractionResult:
        """
        HWP 파일에서 텍스트 추출
        """
        start_time = time.time()
        file_path = Path(file_path)
        
        if not file_path.exists():
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwp",
                status=ExtractionStatus.FAILED,
                error_message=f"File not found: {file_path}"
            )
        
        try:
            # 1. hwp5 라이브러리 시도
            text, method = self._extract_with_hwp5(file_path)
            
            # 2. hwp5 결과 품질 검증 - 품질이 낮으면 olefile로 폴백
            use_olefile = False
            if not text or len(text.strip()) < 10:
                use_olefile = True
            elif text:
                # hwp5 출력 품질 빠르게 검증
                is_valid, quality, _ = quick_validate_text_quality(text)
                if not is_valid or quality < 0.3:
                    # hwp5 출력이 심하게 깨져있음 - olefile로 재시도
                    print(f"[HWP] hwp5 출력 품질 낮음 ({quality:.2f}), olefile로 재시도")
                    use_olefile = True
            
            if use_olefile:
                text, method = self._extract_with_olefile(file_path)
            
            if not text:
                return ExtractionResult(
                    file_path=str(file_path),
                    file_format="hwp",
                    status=ExtractionStatus.FAILED,
                    error_message="Failed to extract text from HWP file"
                )
            
            # 3. 표 구조 추출 (설정이 활성화된 경우)
            tables = []
            if self.config.hwp.extract_tables:
                tables = self._extract_tables(file_path)
            
            # 4. 표가 있으면 본문에서 표 내용 제거 후 병합
            if tables:
                text = self._remove_table_text_from_body(text, tables)
                text = self._merge_text_and_tables(text, tables)
            
            # 후처리
            text, corrections = self._apply_postprocessing(text)
            
            # 5. 인코딩 품질 검증 및 자동 복구
            is_valid, quality_score, error_reason = quick_validate_text_quality(text)
            
            if not is_valid or quality_score < 0.5:
                # 인코딩 오류 감지 - 복구 시도
                print(f"[HWP] 인코딩 품질 낮음 ({quality_score:.2f}): {error_reason}")
                
                recovered_text, recovery_corrections = recover_encoding_with_retry(text)
                _, new_score, _ = quick_validate_text_quality(recovered_text)
                
                if new_score > quality_score:
                    text = recovered_text
                    corrections.extend(recovery_corrections)
                    print(f"[HWP] 인코딩 복구 성공: {quality_score:.2f} -> {new_score:.2f}")
            
            # 품질 검증
            quality_details = self._validate_quality(text)
            
            # 토큰 수 계산
            token_count = self._count_tokens(text)
            
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            # 상태 결정
            if quality_details.overall_score >= self.config.quality_validation.pass_threshold:
                status = ExtractionStatus.COMPLETED
            elif quality_details.overall_score >= self.config.quality_validation.llm_fallback_threshold:
                status = ExtractionStatus.COMPLETED
            else:
                status = ExtractionStatus.LLM_FALLBACK if self.config.quality_validation.auto_llm_fallback else ExtractionStatus.FAILED
            
            # PageResult에 표 정보 포함
            page_result = PageResult(
                page_num=1, 
                text=text, 
                method=method,
                has_tables=len(tables) > 0,
                tables=tables
            )
            
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwp",
                status=status,
                text=text,
                pages=[page_result],
                page_count=1,
                quality_score=quality_details.overall_score,
                quality_details=quality_details,
                extraction_method=method,
                char_count=len(text),
                token_count=token_count,
                processing_time_ms=processing_time_ms,
                corrections=corrections
            )
            
        except Exception as e:
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwp",
                status=ExtractionStatus.FAILED,
                error_message=str(e),
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _extract_with_hwp5(self, file_path: Path) -> Tuple[str, ExtractionMethod]:
        """hwp5 라이브러리를 사용한 추출 (대용량 파일 지원)"""
        try:
            import subprocess
            
            # 파일 크기에 따른 타임아웃 조정 (최소 60초, MB당 10초 추가, 최대 600초)
            file_size_mb = file_path.stat().st_size / (1024 * 1024)
            timeout_seconds = min(600, max(60, int(60 + file_size_mb * 10)))
            
            print(f"[HWP5] hwp5txt 시작: {file_path.name} ({file_size_mb:.1f}MB), 타임아웃: {timeout_seconds}초")
            
            # hwp5txt 명령어 실행
            result = subprocess.run(
                ['hwp5txt', str(file_path)],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                encoding='utf-8'
            )
            
            if result.returncode == 0 and result.stdout:
                print(f"[HWP5] hwp5txt 성공: {len(result.stdout)}자 추출")
                return result.stdout, ExtractionMethod.TEXT_LAYER
            else:
                print(f"[HWP5] hwp5txt 실패: returncode={result.returncode}")
                if result.stderr:
                    print(f"[HWP5] stderr: {result.stderr[:500]}")
            
        except ImportError:
            print("[HWP5] hwp5 라이브러리가 설치되지 않음")
        except subprocess.TimeoutExpired:
            print(f"[HWP5] hwp5txt 타임아웃 ({timeout_seconds}초)")
        except FileNotFoundError:
            print("[HWP5] hwp5txt 명령어를 찾을 수 없음")
        except Exception as e:
            print(f"[HWP5] Error: {e}")
        
        return "", ExtractionMethod.TEXT_LAYER
    
    def _extract_with_olefile(self, file_path: Path) -> Tuple[str, ExtractionMethod]:
        """olefile을 사용한 직접 파싱 (개선된 버전)"""
        olefile = get_olefile()
        if olefile is None:
            print("[OLEFILE] olefile 모듈이 설치되지 않음")
            return "", ExtractionMethod.TEXT_LAYER
        
        try:
            ole = olefile.OleFileIO(str(file_path))
            
            # FileHeader 읽기
            if ole.exists('FileHeader'):
                header_data = ole.openstream('FileHeader').read()
                # 압축 여부 확인 (offset 36, bit 0)
                if len(header_data) > 36:
                    flags = struct.unpack('<I', header_data[36:40])[0]
                    is_compressed = bool(flags & 0x01)
                else:
                    is_compressed = True
            else:
                is_compressed = True
            
            print(f"[OLEFILE] 파일 압축 상태: {'압축됨' if is_compressed else '비압축'}")
            
            # BodyText 섹션에서 텍스트 추출
            texts = []
            section_idx = 0
            total_chars = 0
            
            while True:
                section_name = f'BodyText/Section{section_idx}'
                if not ole.exists(section_name):
                    break
                
                section_data = ole.openstream(section_name).read()
                original_size = len(section_data)
                
                # 압축 해제
                if is_compressed:
                    try:
                        section_data = zlib.decompress(section_data, -15)
                    except zlib.error:
                        # 압축되지 않은 경우 또는 다른 압축 방식 시도
                        try:
                            section_data = zlib.decompress(section_data)
                        except zlib.error:
                            # 압축되지 않은 것으로 간주
                            pass
                
                decompressed_size = len(section_data)
                
                # 텍스트 파싱
                section_text = self._parse_hwp_section(section_data)
                if section_text:
                    texts.append(section_text)
                    total_chars += len(section_text)
                
                print(f"[OLEFILE] Section{section_idx}: 원본 {original_size}bytes -> 해제 {decompressed_size}bytes -> 텍스트 {len(section_text) if section_text else 0}자")
                
                section_idx += 1
            
            ole.close()
            
            print(f"[OLEFILE] 총 {section_idx}개 섹션 처리, {total_chars}자 추출")
            
            if texts:
                return "\n\n".join(texts), ExtractionMethod.TEXT_LAYER
            
        except Exception as e:
            import traceback
            print(f"[OLEFILE] Error: {e}")
            print(f"[OLEFILE] Traceback: {traceback.format_exc()}")
        
        return "", ExtractionMethod.TEXT_LAYER
    
    def _parse_hwp_section(self, data: bytes) -> str:
        """HWP 섹션 데이터에서 텍스트 파싱 (개선된 버전)"""
        texts = []
        pos = 0
        data_len = len(data)
        record_count = 0
        text_record_count = 0
        error_count = 0
        
        # 레코드 타입 상수
        HWPTAG_PARA_TEXT = 67  # 0x010 + 51
        
        while pos < data_len:
            try:
                # 레코드 헤더 읽기 (4바이트)
                if pos + 4 > data_len:
                    break
                
                header = struct.unpack('<I', data[pos:pos+4])[0]
                tag_id = header & 0x3FF
                level = (header >> 10) & 0x3FF
                size = (header >> 20) & 0xFFF
                
                header_size = 4
                
                # 확장 크기 처리 (size == 0xFFF인 경우)
                if size == 0xFFF:
                    if pos + 8 > data_len:
                        break
                    size = struct.unpack('<I', data[pos+4:pos+8])[0]
                    header_size = 8
                
                # 레코드 크기 유효성 검증
                if size > 10 * 1024 * 1024:  # 10MB 초과는 비정상
                    print(f"[HWP PARSE] 비정상 레코드 크기 ({size}) at pos {pos}, 스킵")
                    pos += header_size
                    error_count += 1
                    if error_count > 100:  # 에러가 너무 많으면 중단
                        print(f"[HWP PARSE] 에러 과다, 파싱 중단")
                        break
                    continue
                
                record_start = pos + header_size
                record_end = record_start + size
                
                # 경계 검사
                if record_end > data_len:
                    # 데이터 끝을 넘어가면 남은 데이터만 처리
                    size = data_len - record_start
                    record_end = data_len
                
                record_count += 1
                
                # 텍스트 레코드 (HWPTAG_PARA_TEXT)
                if tag_id == HWPTAG_PARA_TEXT and size > 0:
                    text_data = data[record_start:record_end]
                    text = self._decode_hwp_text(text_data)
                    if text:
                        texts.append(text)
                        text_record_count += 1
                
                # 다음 레코드로 이동
                pos = record_end
                
            except struct.error as e:
                # 구조체 언팩 오류 - 다음 바이트로 이동하여 재시도
                pos += 1
                error_count += 1
                if error_count > 100:
                    break
                continue
            except Exception as e:
                # 기타 오류 - 다음 바이트로 이동
                pos += 1
                error_count += 1
                if error_count > 100:
                    break
                continue
        
        if record_count > 0:
            print(f"[HWP PARSE] 섹션 파싱 완료: {record_count}개 레코드, {text_record_count}개 텍스트 레코드, {error_count}개 오류")
        
        return "\n".join(texts)
    
    def _decode_hwp_text(self, data: bytes) -> str:
        """HWP 텍스트 데이터 디코딩 (제어 문자만 제거, 확장 데이터는 별도 레코드)"""
        try:
            # HWP 5.0 텍스트 레코드(HWPTAG_PARA_TEXT) 구조:
            # - UTF-16LE 인코딩된 텍스트
            # - 인라인 컨트롤은 2바이트 제어 문자만 포함 (확장 데이터는 별도 레코드)
            # - 제어 문자(0x00-0x1F)는 HWP 특수 기능을 위한 마커
            
            # 단순 UTF-16LE 디코딩
            text = data.decode('utf-16le', errors='ignore')
            
            # 제어 문자 제거 (0x00-0x1F, 단 줄바꿈/탭은 유지)
            result = []
            for char in text:
                code = ord(char)
                
                if code == 0x0000:
                    # NULL - 무시
                    pass
                elif code == 0x0009:
                    # 탭 유지
                    result.append('\t')
                elif code == 0x000A or code == 0x000D:
                    # 줄바꿈 유지
                    result.append('\n')
                elif 0x0001 <= code <= 0x001F:
                    # 기타 제어 문자 - 무시 (HWP 인라인 컨트롤 마커)
                    pass
                else:
                    # 일반 문자
                    result.append(char)
            
            text = ''.join(result)
            
            # 깨진 문자 패턴 제거 (HWP 인코딩 오류)
            broken_patterns = [
                (r'[†‡][\u4E00-\u9FFF]', ''),  # †普, ‡漠 등 (필드 마커 잔여물)
                (r'氠瑢', ''),                  # 공백 인코딩 오류
                (r'漠杳', ''),                  # 공백 인코딩 오류
                (r'[\uF000-\uF8FF]', ''),       # Private Use Area
                (r'[\uFFFC\uFFFD]', ''),        # 대체 문자
            ]
            for pattern, replacement in broken_patterns:
                text = re.sub(pattern, replacement, text)
            
            return text.strip()
            
        except Exception as e:
            # 폴백: 정규식으로 제어 문자 제거
            try:
                text = data.decode('utf-16le', errors='ignore')
                text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
                text = re.sub(r'[†‡][\u4E00-\u9FFF]', '', text)
                text = re.sub(r'[氠漠][瑢杳]', '', text)
                return text.strip()
            except:
                return ""
    
    def _apply_postprocessing(self, text: str) -> Tuple[str, List[dict]]:
        """후처리 적용"""
        corrections = []
        
        # 인코딩 복구 (설정 기반)
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
        
        # 연속 줄바꿈 정리
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        # 연속 공백 정리
        text = re.sub(r' +', ' ', text)
        text = re.sub(r'\t+', '\t', text)
        
        # HWP 특수 문자 및 인코딩 오류 패턴 정리
        hwp_patterns = [
            (r'\uf000', ''),  # 특수 제어 문자
            (r'\uf001', ''),
            (r'\ufffc', ''),  # 개체 대체 문자
            (r'[\uF000-\uF8FF]', ''),  # Private Use Area 전체
            (r'[\uFFFD]', ''),  # 대체 문자 (깨진 문자 표시)
            # HWP 인라인 컨트롤 확장 데이터가 잘못 디코딩된 패턴
            (r'[†‡][\u4E00-\u9FFF]', ''),  # †普, ‡漠 등
            (r'[†‡]\d', ''),  # †1, ‡2 등
            # HWP 필드 마커 잔여물
            (r'[\u2020\u2021]', ''),  # † (dagger), ‡ (double dagger)
            # 깨진 한자 패턴 (단독 한자가 문맥 없이 나타나는 경우)
            (r'(?<=[가-힣])[瑢杳普漠](?=[가-힣\s])', ''),  # 한글 사이의 깨진 한자
            (r'(?<=[가-힣])[氠](?=[가-힣\s])', ''),  # 한글 사이의 깨진 한자
        ]
        
        for pattern, replacement in hwp_patterns:
            if re.search(pattern, text):
                text = re.sub(pattern, replacement, text)
                corrections.append({"type": "hwp_special_char", "pattern": pattern})
        
        # HWP 공백 관련 인코딩 오류 문자 제거 (漠杳, 氠瑢 등)
        text, garbage_removed, garbage_patterns = detect_and_remove_hwp_space_garbage(text)
        if garbage_removed > 0:
            corrections.append({
                "type": "hwp_space_garbage_cleanup",
                "description": "HWP 공백 인코딩 오류 문자 제거",
                "removed_chars": garbage_removed,
                "patterns": garbage_patterns
            })
        
        # ㅇ → 0 변환 (HWP에서 숫자 0이 ㅇ으로 저장된 경우)
        text, jieut_count = fix_jieut_to_zero(text)
        if jieut_count > 0:
            corrections.append({
                "type": "jieut_to_zero",
                "description": "ㅇ → 0 변환 (숫자 문맥)",
                "count": jieut_count
            })
        
        return text.strip(), corrections
    
    def _validate_quality(self, text: str) -> QualityDetails:
        """품질 검증"""
        if not text or len(text.strip()) < 10:
            return QualityDetails(overall_score=0.0)
        
        # 한글 비율
        text_no_space = re.sub(r'\s', '', text)
        korean_chars = len(self.KOREAN_PATTERN.findall(text))
        korean_ratio = korean_chars / len(text_no_space) if text_no_space else 0.0
        
        # 숫자/영문 비율 확인 (통계/기술 문서 판별)
        digit_count = sum(1 for c in text_no_space if c.isdigit())
        english_count = sum(1 for c in text_no_space if c.isascii() and c.isalpha())
        digit_ratio = digit_count / len(text_no_space) if text_no_space else 0
        english_ratio = english_count / len(text_no_space) if text_no_space else 0
        is_technical_doc = digit_ratio > 0.15 or english_ratio > 0.20
        
        # 한글 비율 점수화 (문서 유형 고려)
        if is_technical_doc:
            # 통계/기술 문서는 한글 비율 기준 완화
            if korean_ratio >= 0.20:
                korean_score = 1.0
            elif korean_ratio >= 0.10:
                korean_score = 0.8
            elif korean_ratio >= 0.05:
                korean_score = 0.6
            else:
                korean_score = 0.3
        else:
            # 일반 문서
            if 0.55 <= korean_ratio <= 0.90:
                korean_score = 1.0
            elif 0.40 <= korean_ratio < 0.55 or 0.90 < korean_ratio <= 0.95:
                korean_score = 0.7
            elif 0.25 <= korean_ratio < 0.40:
                korean_score = 0.5
            elif 0.15 <= korean_ratio < 0.25:
                korean_score = 0.3
            else:
                korean_score = 0.1
        
        # 깨진 문자 비율
        broken_chars = len(self.BROKEN_CHAR_PATTERN.findall(text))
        broken_ratio = broken_chars / len(text) if text else 0.0
        broken_score = 1.0 - min(broken_ratio * 5, 1.0)
        
        # 문장 구조 (목록/표 형식 지원)
        lines = text.split('\n')
        words = text.split()
        
        # 마크다운 표 확인
        table_lines = sum(1 for line in lines if '|' in line and line.count('|') >= 2)
        if table_lines >= 3:
            sentence_score = 1.0 if table_lines / max(len(lines), 1) >= 0.2 else 0.9
        else:
            # 목록 형식 확인
            list_pattern = re.compile(r'^\s*[-•○※ㅇ□▶▷◆◇★☆►◎⦁⦾]\s*\S')
            numbered_pattern = re.compile(r'^\s*(\d+[.)]\s*|\([가-힣\d]+\)\s*|\d+\.\d+\s*)')
            list_lines = sum(1 for line in lines if list_pattern.match(line) or numbered_pattern.match(line))
            
            if list_lines >= 3 and list_lines / max(len(lines), 1) >= 0.2:
                sentence_score = 1.0
            else:
                # 일반 문장 구조
                sentences = re.findall(r'[.!?。]\s', text)
                if sentences and len(words) >= 10:
                    avg_words = len(words) / len(sentences)
                    if 5 <= avg_words <= 30:
                        sentence_score = 1.0
                    elif 3 <= avg_words <= 50:
                        sentence_score = 0.7
                    else:
                        sentence_score = 0.4
                else:
                    # 줄 단위 구조
                    non_empty = [l for l in lines if l.strip()]
                    if len(non_empty) >= 5:
                        avg_len = sum(len(l.strip()) for l in non_empty) / len(non_empty)
                        sentence_score = 0.7 if 10 <= avg_len <= 200 else 0.5
                    else:
                        sentence_score = 0.5
        
        # 반복 패턴 점수 (HWP는 반복 패턴 문제 적음)
        repetition_score = 1.0
        
        # UTF-16 인코딩 오류 검사
        has_encoding_error = detect_utf16_misencoding(text)
        encoding_score = 0.0 if has_encoding_error else 1.0
        
        # 종합 점수
        overall = (
            korean_score * 0.30 +
            broken_score * 0.25 +
            sentence_score * 0.15 +
            repetition_score * 0.10 +
            encoding_score * 0.20
        )
        
        return QualityDetails(
            # 원시 값
            korean_ratio=korean_ratio,
            broken_char_ratio=broken_ratio,
            sentence_structure=sentence_score,
            repetition_anomaly=0.0,  # HWP는 반복 이상 없음
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
    
    def _count_tokens(self, text: str) -> int:
        """토큰 수 계산"""
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except ImportError:
            return len(text) // 2
    
    # ==================== 표 구조 복원 관련 메서드 ====================
    
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
        
        if row_count < self.config.hwp.min_table_rows:
            return False
        if col_count < self.config.hwp.min_table_cols:
            return False
        
        # 빈 셀이 너무 많은 표 제외 (30% 미만 채워진 경우 제외)
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
    
    def _remove_table_text_from_body(self, text: str, tables: List[TableData]) -> str:
        """
        본문 텍스트에서 표 내용 제거 (HWP용)
        
        HWP 파일에서 hwp5/olefile로 텍스트 추출 시 표 내용도 함께 추출되므로,
        표가 별도로 추출된 경우 본문에서 표 텍스트를 제거하여 중복을 방지합니다.
        
        Args:
            text: 본문 텍스트
            tables: 추출된 표 목록
            
        Returns:
            str: 표 내용이 제거된 본문 텍스트
        """
        if not tables or not text:
            return text
        
        result = text
        removed_count = 0
        
        for table in tables:
            if not hasattr(table, 'rows') or not table.rows:
                continue
            
            # 표의 각 행에서 셀 텍스트들을 추출
            for row in table.rows:
                # 행의 모든 셀 텍스트를 연결한 패턴 생성
                row_texts = []
                for cell in row:
                    cell_text = str(cell).strip() if cell else ""
                    if cell_text and len(cell_text) >= 2:  # 최소 2글자 이상
                        row_texts.append(cell_text)
                
                if not row_texts:
                    continue
                
                # 각 셀 텍스트가 연속으로 나타나는 패턴 제거
                for i, cell_text in enumerate(row_texts):
                    # 짧은 텍스트나 일반적인 단어는 건너뛰기 (오탐 방지)
                    if len(cell_text) < 3:
                        continue
                    
                    # 숫자만 있는 셀은 건너뛰기
                    if re.match(r'^[\d\s\-\.\(\)]+$', cell_text):
                        continue
                    
                    # 다음 셀과 함께 나타나는 패턴 찾기
                    if i + 1 < len(row_texts):
                        next_text = row_texts[i + 1]
                        if len(next_text) >= 3:
                            # 두 셀이 연속으로 나타나는 패턴
                            pattern = re.escape(cell_text) + r'\s*\n?\s*' + re.escape(next_text)
                            if re.search(pattern, result):
                                result = re.sub(pattern, '', result, count=1)
                                removed_count += 1
        
        # 연속 줄바꿈 정리
        result = re.sub(r'\n{3,}', '\n\n', result)
        result = re.sub(r'^\s+', '', result, flags=re.MULTILINE)
        
        if removed_count > 0:
            print(f"[HWP] 본문에서 표 텍스트 {removed_count}개 패턴 제거")
        
        return result.strip()
    
    def _merge_text_and_tables(self, text: str, tables: List[TableData]) -> str:
        """
        텍스트와 표를 병합 (RAG 최적화 - 선형화 텍스트 사용)
        
        Args:
            text: 추출된 텍스트
            tables: 추출된 표 목록
            
        Returns:
            str: 병합된 텍스트 (semantic_text 포함)
        """
        if not tables:
            return text
        
        result_parts = [text.strip()]
        
        for table in tables:
            result_parts.append(f"\n\n<!-- 표 {table.table_index + 1} -->\n")
            
            # RAG 최적화: semantic_text 우선 사용
            if hasattr(table, 'semantic_text') and table.semantic_text:
                result_parts.append(table.semantic_text)
            elif hasattr(table, 'markdown') and table.markdown:
                # 폴백: 마크다운 사용
                result_parts.append(table.markdown)
            else:
                # 최종 폴백: 2D 그리드에서 직접 생성
                table_builder = TableBuilder()
                table_obj = table_builder.build_from_grid(table.rows, header_rows=1)
                result_parts.append(table_obj.to_semantic_text())
        
        return '\n'.join(result_parts)
    
    def _extract_tables(self, file_path: Path) -> List[TableData]:
        """
        HWP 파일에서 표 구조 추출
        
        Args:
            file_path: HWP 파일 경로
            
        Returns:
            List[TableData]: 추출된 표 목록
        """
        if not self.config.hwp.extract_tables:
            print(f"[HWP TABLE] 표 추출 비활성화됨")
            return []
        
        tables = []
        
        # 방법 1: hwp5html 폴백 (HTML 변환 후 파싱)
        print(f"[HWP TABLE] hwp5html 방식 시도...")
        tables = self._extract_tables_with_hwp5html(file_path)
        print(f"[HWP TABLE] hwp5html 결과: {len(tables)}개 표")
        
        # 방법 2: olefile 직접 파싱 (폴백)
        if not tables:
            print(f"[HWP TABLE] olefile 방식 시도...")
            tables = self._extract_tables_with_olefile(file_path)
            print(f"[HWP TABLE] olefile 결과: {len(tables)}개 표")
        
        return tables
    
    def _extract_tables_with_hwp5html(self, file_path: Path) -> List[TableData]:
        """
        hwp5html로 HTML 변환 후 BeautifulSoup으로 표 파싱 (RAG 최적화)
        
        Args:
            file_path: HWP 파일 경로
            
        Returns:
            List[TableData]: 추출된 표 목록
        """
        import subprocess
        import tempfile
        import os
        
        tables = []
        temp_dir = None
        table_builder = TableBuilder()
        
        try:
            # 임시 디렉토리 생성
            temp_dir = tempfile.mkdtemp(prefix='hwp_table_')
            
            # hwp5html 명령어 실행
            try:
                result = subprocess.run(
                    ['hwp5html', str(file_path), '--output', temp_dir],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    encoding='utf-8'
                )
                
                if result.returncode != 0:
                    print(f"[HWP5HTML] 명령 실패 (code={result.returncode}): {result.stderr[:200] if result.stderr else 'no stderr'}")
                    return []
            except FileNotFoundError:
                print(f"[HWP5HTML] hwp5html 명령어를 찾을 수 없음 - hwp5 패키지 설치 필요")
                return []
            
            # HTML 파일 찾기
            html_files = [f for f in os.listdir(temp_dir) if f.endswith('.html')]
            if not html_files:
                print(f"[HWP5HTML] HTML 파일 없음")
                return []
            
            print(f"[HWP5HTML] HTML 파일 발견: {len(html_files)}개")
            
            # BeautifulSoup으로 파싱
            from bs4 import BeautifulSoup
            
            for html_file in html_files:
                html_path = os.path.join(temp_dir, html_file)
                with open(html_path, 'r', encoding='utf-8') as f:
                    soup = BeautifulSoup(f.read(), 'html.parser')
                
                # 모든 table 요소 추출
                for idx, table_elem in enumerate(soup.find_all('table')):
                    cells_with_span = []
                    
                    for tr in table_elem.find_all('tr'):
                        row_cells = []
                        for td in tr.find_all(['td', 'th']):
                            # 셀 텍스트 추출 (하위 요소 포함)
                            cell_text = td.get_text(separator=' ', strip=True)
                            
                            # colspan, rowspan 추출
                            colspan = int(td.get('colspan', 1) or 1)
                            rowspan = int(td.get('rowspan', 1) or 1)
                            
                            row_cells.append({
                                'text': cell_text,
                                'col_span': colspan,
                                'row_span': rowspan
                            })
                        
                        if row_cells:
                            cells_with_span.append(row_cells)
                    
                    # 단순 rows 형태로 유효성 검사
                    simple_rows = [[c['text'] for c in row] for row in cells_with_span]
                    
                    if simple_rows and self._is_valid_table(simple_rows):
                        # TableBuilder를 사용하여 Table 객체 생성
                        table_obj = self._build_table_from_hwpx_cells(cells_with_span, table_builder)
                        rows = table_obj.to_2d_grid()
                        
                        tables.append(TableData(
                            table_index=len(tables),
                            rows=rows,
                            semantic_text=table_obj.to_semantic_text(),
                            structured_data=table_obj.to_structured_dict(),
                            markdown=table_obj.to_markdown(),  # 호환성용
                            row_count=table_obj.rows,
                            col_count=table_obj.cols,
                            confidence=0.8,
                            extraction_method="hwp5html",
                            page_num=1  # hwp5html은 전체 문서를 한번에 처리하므로 페이지 구분 어려움
                        ))
            
        except subprocess.TimeoutExpired:
            print("[HWP5HTML] Timeout expired")
        except FileNotFoundError:
            # hwp5html이 설치되지 않은 경우
            print("[HWP5HTML] hwp5html command not found. Please install pyhwp.")
        except ImportError:
            print("[HWP5HTML] BeautifulSoup not installed.")
        except Exception as e:
            print(f"[HWP5HTML] Error: {e}")
        finally:
            # 임시 디렉토리 정리
            if temp_dir and os.path.exists(temp_dir):
                import shutil
                try:
                    shutil.rmtree(temp_dir)
                except:
                    pass
        
        return tables
    
    def _extract_tables_with_olefile(self, file_path: Path) -> List[TableData]:
        """
        olefile로 직접 HWP 표 구조 파싱
        
        HWP 파일의 BodyText 섹션에서 HWPTAG_TABLE (tag_id=78) 레코드를 파싱하여
        표 구조를 추출합니다.
        
        Args:
            file_path: HWP 파일 경로
            
        Returns:
            List[TableData]: 추출된 표 목록
        """
        olefile = get_olefile()
        if olefile is None:
            return []
        
        tables = []
        
        try:
            ole = olefile.OleFileIO(str(file_path))
            
            # FileHeader에서 압축 여부 확인
            is_compressed = True
            if ole.exists('FileHeader'):
                header_data = ole.openstream('FileHeader').read()
                if len(header_data) > 36:
                    flags = struct.unpack('<I', header_data[36:40])[0]
                    is_compressed = bool(flags & 0x01)
            
            # BodyText 섹션들 순회
            section_idx = 0
            table_index = 0
            
            while True:
                section_name = f'BodyText/Section{section_idx}'
                if not ole.exists(section_name):
                    break
                
                section_data = ole.openstream(section_name).read()
                original_size = len(section_data)
                
                # 압축 해제
                if is_compressed:
                    try:
                        section_data = zlib.decompress(section_data, -15)
                    except zlib.error:
                        pass
                
                print(f"[HWP OLEFILE] Section{section_idx}: {original_size}bytes -> {len(section_data)}bytes (압축해제)")
                
                # 섹션 인덱스 저장 (표 데이터에 페이지 번호로 사용)
                self._current_section_idx = section_idx
                
                # 섹션에서 표 추출
                section_tables = self._parse_tables_from_section(section_data, table_index)
                if section_tables:
                    print(f"[HWP OLEFILE] Section{section_idx}에서 {len(section_tables)}개 표 발견")
                tables.extend(section_tables)
                table_index += len(section_tables)
                
                section_idx += 1
            
            print(f"[HWP OLEFILE] 총 {section_idx}개 섹션 처리, {len(tables)}개 표 추출")
            ole.close()
            
        except Exception as e:
            print(f"[HWP OLEFILE TABLE] Error: {e}")
        
        return tables
    
    def _parse_tables_from_section(self, data: bytes, start_index: int = 0) -> List[TableData]:
        """
        HWP 섹션 데이터에서 표 구조 파싱 (RAG 최적화, 중첩 표/목록 지원)
        
        HWPTAG_TABLE 및 관련 레코드를 파싱합니다.
        각 셀의 LIST_HEADER에서 col, row 인덱스를 읽어 정확한 위치에 배치합니다.
        레벨(level) 값을 추적하여 중첩 구조를 처리합니다.
        
        Args:
            data: 섹션 바이너리 데이터
            start_index: 시작 표 인덱스
            
        Returns:
            List[TableData]: 추출된 표 목록
        """
        tables = []
        table_builder = TableBuilder()
        pos = 0
        
        # 현재 파싱 중인 표 정보
        in_table = False
        table_row_count = 0
        table_col_count = 0
        table_start_level = -1  # 표 시작 레벨 (중첩 표 감지용)
        
        # 셀 데이터를 (row, col) -> text 매핑으로 저장
        cell_data = {}  # {(row, col): text}
        current_cell_row = -1
        current_cell_col = -1
        cell_start_level = -1  # 셀 시작 레벨 (중첩 목록 감지용)
        
        # 중첩 표 스택 (외부 표 정보 저장)
        table_stack = []
        
        # 레코드 타입 상수 (HWPTAG_BEGIN = 0x010 = 16)
        HWPTAG_PARA_HEADER = 66     # 문단 헤더 (0x010 + 50)
        HWPTAG_PARA_TEXT = 67       # 문단 텍스트 (0x010 + 51)
        HWPTAG_LIST_HEADER = 72     # 리스트 헤더 (0x010 + 56) - 셀 포함
        HWPTAG_TABLE = 77           # 표 시작 (0x010 + 61)
        HWPTAG_CTRL_HEADER = 71     # 컨트롤 헤더 (0x010 + 55)
        
        # 디버그 카운터
        tag_counts = {}
        
        def save_current_table():
            """현재 표를 저장"""
            nonlocal in_table, cell_data, table_row_count, table_col_count
            
            if not cell_data:
                in_table = False
                return
            
            # cell_data를 2D 배열로 변환
            # 실제 행/열 범위 계산
            if cell_data:
                max_row = max(r for r, c in cell_data.keys()) + 1
                max_col = max(c for r, c in cell_data.keys()) + 1
            else:
                max_row = table_row_count
                max_col = table_col_count
            
            # 2D 배열 생성
            rows_data = []
            for r in range(max_row):
                row = []
                for c in range(max_col):
                    cell_text = cell_data.get((r, c), '')
                    row.append(cell_text)
                rows_data.append(row)
            
            if rows_data and self._is_valid_table(rows_data):
                print(f"[HWP TABLE PARSE] 표 저장: {len(rows_data)}행 x {len(rows_data[0]) if rows_data else 0}열")
                # TableBuilder를 사용하여 Table 객체 생성
                table_obj = table_builder.build_from_grid(rows_data, header_rows=1)
                
                tables.append(TableData(
                    table_index=start_index + len(tables),
                    rows=rows_data,
                    semantic_text=table_obj.to_semantic_text(),
                    structured_data=table_obj.to_structured_dict(),
                    markdown=table_obj.to_markdown(),
                    row_count=table_obj.rows,
                    col_count=table_obj.cols,
                    confidence=0.7,
                    extraction_method="hwp_olefile",
                    page_num=self._current_section_idx + 1 if hasattr(self, '_current_section_idx') else 1
                ))
            
            cell_data = {}
            in_table = False
        
        while pos < len(data):
            if pos + 4 > len(data):
                break
            
            # 레코드 헤더 읽기
            header = struct.unpack('<I', data[pos:pos+4])[0]
            tag_id = header & 0x3FF
            level = (header >> 10) & 0x3FF
            size = (header >> 20) & 0xFFF
            
            # 확장 크기 처리
            if size == 0xFFF:
                if pos + 8 > len(data):
                    break
                size = struct.unpack('<I', data[pos+4:pos+8])[0]
                pos += 8
            else:
                pos += 4
            
            record_data = data[pos:pos+size] if pos + size <= len(data) else b''
            
            # 태그 카운팅 (디버그)
            tag_counts[tag_id] = tag_counts.get(tag_id, 0) + 1
            
            # 표 시작 레코드 (HWPTAG_TABLE)
            if tag_id == HWPTAG_TABLE:
                # 중첩 표 감지: 이미 표 안에 있고 레벨이 더 높으면 중첩 표
                if in_table and level > table_start_level:
                    # 중첩 표는 스택에 외부 표 정보 저장하고 중첩 표 처리
                    table_stack.append({
                        'cell_data': cell_data,
                        'table_row_count': table_row_count,
                        'table_col_count': table_col_count,
                        'table_start_level': table_start_level,
                        'current_cell_row': current_cell_row,
                        'current_cell_col': current_cell_col,
                        'cell_start_level': cell_start_level,
                    })
                elif in_table:
                    # 같은 레벨의 새 표 - 이전 표 저장
                    save_current_table()
                
                # 새 표 시작
                in_table = True
                cell_data = {}
                current_cell_row = -1
                current_cell_col = -1
                table_start_level = level
                cell_start_level = -1
                
                # 표 구조 정보 파싱
                # HWP 표 헤더: flags(4bytes) + rows(2bytes) + cols(2bytes)
                if len(record_data) >= 8:
                    try:
                        table_row_count = struct.unpack('<H', record_data[4:6])[0]
                        table_col_count = struct.unpack('<H', record_data[6:8])[0]
                        print(f"[HWP TABLE PARSE] 표 시작: {table_row_count}행 x {table_col_count}열 (레벨 {level})")
                    except:
                        table_row_count = 0
                        table_col_count = 0
            
            # 리스트 헤더 - 셀 시작 (HWPTAG_LIST_HEADER)
            elif tag_id == HWPTAG_LIST_HEADER and in_table:
                # ListHeader 기본 속성 이후 TableCell 확장 속성:
                # ListHeader: paragraphs(2) + textDirection(2) + listflags(4) = 8 bytes
                # TableCell: col(2) + row(2) + colspan(2) + rowspan(2) + ...
                #
                # 표(HWPTAG_TABLE) 내부에서 발견된 LIST_HEADER는 셀로 처리
                # 다만, 셀 좌표가 표 범위 내에 있어야 함 (중첩 목록/표 제외)
                if len(record_data) >= 12:  # 최소 8 + 4 bytes
                    try:
                        # TableCell 확장 속성에서 col, row 읽기
                        cell_col = struct.unpack('<H', record_data[8:10])[0]
                        cell_row = struct.unpack('<H', record_data[10:12])[0]
                        
                        # 셀 좌표가 현재 표 범위 내에 있는지 확인
                        # 범위 내: 새 셀 시작, 범위 밖: 중첩 구조이므로 현재 셀 유지
                        if cell_row < table_row_count and cell_col < table_col_count:
                            # 유효한 셀 좌표 - 새 셀 시작
                            current_cell_col = cell_col
                            current_cell_row = cell_row
                            cell_start_level = level
                            # 셀 초기화
                            if (current_cell_row, current_cell_col) not in cell_data:
                                cell_data[(current_cell_row, current_cell_col)] = ''
                        # else: 범위 밖이면 셀 내 중첩 구조 - 현재 셀 좌표 유지하고 텍스트 추가
                    except:
                        pass
            
            # 셀 내 텍스트 레코드 (HWPTAG_PARA_TEXT)
            elif tag_id == HWPTAG_PARA_TEXT and in_table:
                if current_cell_row >= 0 and current_cell_col >= 0:
                    text = self._decode_hwp_text(record_data)
                    if text:
                        key = (current_cell_row, current_cell_col)
                        if key in cell_data and cell_data[key]:
                            cell_data[key] += ' ' + text
                        else:
                            cell_data[key] = text
            
            # 컨트롤 헤더 - 표 외 컨트롤이면 표 종료
            elif tag_id == HWPTAG_CTRL_HEADER and in_table:
                if len(record_data) >= 4:
                    ctrl_id = record_data[:4]
                    # 표 내부 컨트롤(각주/필드 등)은 무시하고,
                    # 표와 같은 레벨에서만 표 종료 처리
                    if ctrl_id != b'tbl ' and level <= table_start_level:
                        save_current_table()
                        # 스택에서 외부 표 복원
                        if table_stack:
                            outer = table_stack.pop()
                            cell_data = outer['cell_data']
                            table_row_count = outer['table_row_count']
                            table_col_count = outer['table_col_count']
                            table_start_level = outer['table_start_level']
                            current_cell_row = outer['current_cell_row']
                            current_cell_col = outer['current_cell_col']
                            cell_start_level = outer['cell_start_level']
                            in_table = True
            
            pos += size
        
        # 마지막 표 저장
        if in_table:
            save_current_table()
        
        # 스택에 남은 표도 저장
        while table_stack:
            outer = table_stack.pop()
            cell_data = outer['cell_data']
            table_row_count = outer['table_row_count']
            table_col_count = outer['table_col_count']
            save_current_table()
        
        # 디버그: 주요 태그 출력
        table_tag_count = tag_counts.get(HWPTAG_TABLE, 0)
        list_header_count = tag_counts.get(HWPTAG_LIST_HEADER, 0)
        para_text_count = tag_counts.get(HWPTAG_PARA_TEXT, 0)
        print(f"[HWP TABLE PARSE] 태그 통계: TABLE={table_tag_count}, LIST_HEADER={list_header_count}, PARA_TEXT={para_text_count}")
        
        return tables


class HWPXExtractor(BaseExtractor):
    """
    HWPX 텍스트 추출기 (한글 2014 이상)
    
    HWPX 파일 구조:
    - ZIP 압축 파일 (OOXML 형식)
    - Contents/section*.xml에 본문 텍스트
    - Preview/PrvText.txt에 미리보기 텍스트
    """
    
    SUPPORTED_FORMATS = ["hwpx"]
    
    # HWPX XML 네임스페이스 (표 포함)
    NAMESPACES = {
        'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
        'hs': 'http://www.hancom.co.kr/hwpml/2011/section',
        'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
        'hwpml': 'http://www.hancom.co.kr/hwpml/2011/hwpml',
    }
    
    # 표 요소 관련 네임스페이스 (다양한 버전 지원)
    TABLE_NAMESPACES = [
        {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph'},
        {'hp': 'http://www.hancom.co.kr/hwpml/2016/paragraph'},
        {'hp': 'http://schemas.hancom.co.kr/hwp/xml/paragraph'},
        {},  # 네임스페이스 없는 경우
    ]
    
    KOREAN_PATTERN = re.compile(r'[가-힣]')
    BROKEN_CHAR_PATTERN = re.compile(r'[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]')
    
    def __init__(self, config: Optional[ExtractionConfig] = None):
        self.config = config or default_config
    
    def supports(self, file_format: str) -> bool:
        """HWPX 형식 지원 여부"""
        return file_format.lower() in self.SUPPORTED_FORMATS
    
    def extract(self, file_path: str) -> ExtractionResult:
        """
        HWPX 파일에서 텍스트 추출
        """
        start_time = time.time()
        file_path = Path(file_path)
        
        if not file_path.exists():
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwpx",
                status=ExtractionStatus.FAILED,
                error_message=f"File not found: {file_path}"
            )
        
        try:
            # ZIP 파일 열기
            with zipfile.ZipFile(str(file_path), 'r') as zf:
                # 1. 미리보기 텍스트 시도 (빠름)
                preview_text = self._extract_preview_text(zf)
                
                # 2. XML에서 본문 추출 (정확함, 표 텍스트 제외)
                section_texts, pages = self._extract_from_sections(zf)
                
                # 3. 표 구조 추출 (설정이 활성화된 경우)
                tables = []
                if self.config.hwp.extract_tables:
                    tables = self._extract_tables_from_zip(zf)
                
                # 텍스트 선택 전략:
                # - 표 추출이 활성화되고 표가 있는 경우: 본문 텍스트 우선 사용 (표 중복 방지)
                # - 그 외: 미리보기와 본문 중 더 긴 것 선택
                if tables and section_texts:
                    # 표가 있으면 본문 텍스트 사용 (표 텍스트가 제외된 상태)
                    text = section_texts
                    print(f"[HWPX] 표 {len(tables)}개 감지, 본문 텍스트 사용 (미리보기 스킵)")
                elif section_texts and len(section_texts) > len(preview_text or ""):
                    text = section_texts
                else:
                    text = preview_text or section_texts
            
            if not text:
                return ExtractionResult(
                    file_path=str(file_path),
                    file_format="hwpx",
                    status=ExtractionStatus.FAILED,
                    error_message="Failed to extract text from HWPX file"
                )
            
            # 4. 텍스트와 표 병합
            if tables:
                text = self._merge_text_and_tables(text, tables)
            
            # 후처리
            text, corrections = self._apply_postprocessing(text)
            
            # 5. 인코딩 품질 검증 및 자동 복구
            is_valid, quality_score, error_reason = quick_validate_text_quality(text)
            
            if not is_valid or quality_score < 0.5:
                # 인코딩 오류 감지 - 복구 시도
                print(f"[HWPX] 인코딩 품질 낮음 ({quality_score:.2f}): {error_reason}")
                
                recovered_text, recovery_corrections = recover_encoding_with_retry(text)
                _, new_score, _ = quick_validate_text_quality(recovered_text)
                
                if new_score > quality_score:
                    text = recovered_text
                    corrections.extend(recovery_corrections)
                    print(f"[HWPX] 인코딩 복구 성공: {quality_score:.2f} -> {new_score:.2f}")
            
            # 품질 검증
            quality_details = self._validate_quality(text)
            
            # 토큰 수 계산
            token_count = self._count_tokens(text)
            
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            # 상태 결정
            if quality_details.overall_score >= self.config.quality_validation.pass_threshold:
                status = ExtractionStatus.COMPLETED
            elif quality_details.overall_score >= self.config.quality_validation.llm_fallback_threshold:
                status = ExtractionStatus.COMPLETED
            else:
                status = ExtractionStatus.LLM_FALLBACK if self.config.quality_validation.auto_llm_fallback else ExtractionStatus.FAILED
            
            # PageResult에 표 정보 포함
            if pages:
                # 첫 번째 페이지에 모든 표 정보 추가
                pages[0] = PageResult(
                    page_num=pages[0].page_num,
                    text=pages[0].text,
                    method=pages[0].method,
                    has_tables=len(tables) > 0,
                    tables=tables
                )
            else:
                pages = [PageResult(
                    page_num=1, 
                    text=text, 
                    method=ExtractionMethod.TEXT_LAYER,
                    has_tables=len(tables) > 0,
                    tables=tables
                )]
            
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwpx",
                status=status,
                text=text,
                pages=pages,
                page_count=len(pages),
                quality_score=quality_details.overall_score,
                quality_details=quality_details,
                extraction_method=ExtractionMethod.TEXT_LAYER,
                char_count=len(text),
                token_count=token_count,
                processing_time_ms=processing_time_ms,
                corrections=corrections
            )
            
        except zipfile.BadZipFile:
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwpx",
                status=ExtractionStatus.FAILED,
                error_message="Invalid HWPX file (not a valid ZIP archive)",
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
        except Exception as e:
            return ExtractionResult(
                file_path=str(file_path),
                file_format="hwpx",
                status=ExtractionStatus.FAILED,
                error_message=str(e),
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _extract_preview_text(self, zf: zipfile.ZipFile) -> Optional[str]:
        """미리보기 텍스트 추출 (스마트 인코딩 감지)"""
        try:
            # Preview/PrvText.txt 파일 확인
            preview_paths = ['Preview/PrvText.txt', 'preview/PrvText.txt']
            
            for path in preview_paths:
                if path in zf.namelist():
                    data = zf.read(path)
                    
                    # 스마트 디코딩 사용
                    text, encoding, _ = smart_decode_bytes(data, preferred_encoding='utf-16-le')
                    
                    # 품질 검증
                    is_valid, score, error_reason = quick_validate_text_quality(text)
                    
                    if is_valid and score >= 0.5:
                        return text
                    
                    # 품질이 낮으면 인코딩 복구 시도
                    if text and score > 0:
                        recovered_text, corrections = recover_encoding_with_retry(text)
                        _, new_score, _ = quick_validate_text_quality(recovered_text)
                        if new_score > score:
                            return recovered_text
                        return text
            
        except Exception as e:
            print(f"[HWPX Preview] Error: {e}")
        
        return None
    
    def _extract_from_sections(self, zf: zipfile.ZipFile) -> Tuple[str, List[PageResult]]:
        """섹션 XML에서 본문 추출"""
        texts = []
        pages = []
        
        try:
            # Contents 디렉토리 내 section 파일들 찾기
            section_files = sorted([
                name for name in zf.namelist()
                if 'Contents/section' in name.lower() and name.endswith('.xml')
            ])
            
            if not section_files:
                # 대체 경로 시도
                section_files = sorted([
                    name for name in zf.namelist()
                    if 'section' in name.lower() and name.endswith('.xml')
                ])
            
            for idx, section_file in enumerate(section_files):
                section_data = zf.read(section_file)
                section_text = self._parse_section_xml(section_data)
                
                if section_text:
                    texts.append(section_text)
                    pages.append(PageResult(
                        page_num=idx + 1,
                        text=section_text,
                        method=ExtractionMethod.TEXT_LAYER
                    ))
            
        except Exception as e:
            print(f"[HWPX Section] Error: {e}")
        
        return "\n\n".join(texts), pages
    
    def _parse_section_xml(self, data: bytes) -> str:
        """
        섹션 XML 파싱 (표 요소 제외)
        
        표(<tbl>) 요소 안의 텍스트는 별도로 _extract_tables_from_zip에서 처리됩니다.
        """
        try:
            # XML 파싱
            root = ET.fromstring(data)
            
            # 먼저 모든 표(<tbl>) 요소를 제거
            table_tags = [
                './/{http://www.hancom.co.kr/hwpml/2011/paragraph}tbl',
                './/{*}tbl',
                './/tbl'
            ]
            
            for tag in table_tags:
                for tbl in root.findall(tag):
                    parent = self._find_parent(root, tbl)
                    if parent is not None:
                        parent.remove(tbl)
            
            # 모든 텍스트 요소 추출 (표 제외된 상태)
            texts = []
            
            # 다양한 네임스페이스와 태그 시도
            text_tags = [
                './/{http://www.hancom.co.kr/hwpml/2011/paragraph}t',
                './/t',
                './/{*}t',
                './/{http://www.hancom.co.kr/hwpml/2011/core}text',
            ]
            
            for tag in text_tags:
                for elem in root.findall(tag):
                    if elem.text:
                        texts.append(elem.text)
            
            # 대안: 모든 텍스트 콘텐츠 추출 (표 제외)
            if not texts:
                texts = self._extract_all_text_exclude_tables(root)
            
            return "\n".join(texts)
            
        except ET.ParseError as e:
            print(f"[HWPX XML Parse] Error: {e}")
            # XML 파싱 실패 시 텍스트만 추출
            try:
                text = data.decode('utf-8', errors='ignore')
                # XML 태그 제거
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text)
                return text.strip()
            except:
                return ""
    
    def _find_parent(self, root: ET.Element, child: ET.Element) -> Optional[ET.Element]:
        """XML 요소의 부모 찾기"""
        for parent in root.iter():
            if child in parent:
                return parent
        return None
    
    def _extract_all_text_exclude_tables(self, elem: ET.Element) -> List[str]:
        """
        XML 요소에서 모든 텍스트 재귀적으로 추출 (표 요소 제외)
        
        표(<tbl>) 요소 안의 텍스트는 건너뜁니다.
        """
        texts = []
        
        # 요소 태그명에서 표 관련 태그 확인
        tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        
        # 표 관련 태그면 건너뛰기
        if tag_name.lower() in ('tbl', 'tr', 'tc', 'table'):
            return texts
        
        if elem.text:
            text = elem.text.strip()
            if text:
                texts.append(text)
        
        for child in elem:
            texts.extend(self._extract_all_text_exclude_tables(child))
            
            if child.tail:
                tail = child.tail.strip()
                if tail:
                    texts.append(tail)
        
        return texts
    
    def _extract_all_text(self, elem: ET.Element) -> List[str]:
        """XML 요소에서 모든 텍스트 재귀적으로 추출 (하위 호환성 유지)"""
        return self._extract_all_text_exclude_tables(elem)
    
    def _apply_postprocessing(self, text: str) -> Tuple[str, List[dict]]:
        """후처리 적용"""
        corrections = []
        
        # 인코딩 복구 (설정 기반)
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
        
        # XML 엔티티 디코딩
        xml_entities = [
            ('&amp;', '&'),
            ('&lt;', '<'),
            ('&gt;', '>'),
            ('&quot;', '"'),
            ('&apos;', "'"),
        ]
        
        for entity, char in xml_entities:
            if entity in text:
                text = text.replace(entity, char)
        
        # 연속 공백/줄바꿈 정리
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r' +', ' ', text)
        
        # HWPX 공백 관련 인코딩 오류 문자 제거 (漠杳, 氠瑢 등)
        text, garbage_removed, garbage_patterns = detect_and_remove_hwp_space_garbage(text)
        if garbage_removed > 0:
            corrections.append({
                "type": "hwpx_space_garbage_cleanup",
                "description": "HWPX 공백 인코딩 오류 문자 제거",
                "removed_chars": garbage_removed,
                "patterns": garbage_patterns
            })
        
        # ㅇ → 0 변환 (HWP에서 숫자 0이 ㅇ으로 저장된 경우)
        text, jieut_count = fix_jieut_to_zero(text)
        if jieut_count > 0:
            corrections.append({
                "type": "jieut_to_zero",
                "description": "ㅇ → 0 변환 (숫자 문맥)",
                "count": jieut_count
            })
        
        return text.strip(), corrections
    
    def _validate_quality(self, text: str) -> QualityDetails:
        """품질 검증 (문서 유형별 유연한 평가)"""
        if not text or len(text.strip()) < 10:
            return QualityDetails(overall_score=0.0)
        
        # 한글 비율
        text_no_space = re.sub(r'\s', '', text)
        korean_chars = len(self.KOREAN_PATTERN.findall(text))
        korean_ratio = korean_chars / len(text_no_space) if text_no_space else 0.0
        
        # 숫자/영문 비율 확인 (통계/기술 문서 판별)
        digit_count = sum(1 for c in text_no_space if c.isdigit())
        english_count = sum(1 for c in text_no_space if c.isascii() and c.isalpha())
        digit_ratio = digit_count / len(text_no_space) if text_no_space else 0
        english_ratio = english_count / len(text_no_space) if text_no_space else 0
        is_technical_doc = digit_ratio > 0.15 or english_ratio > 0.20
        
        # 한글 비율 점수화 (문서 유형 고려)
        if is_technical_doc:
            if korean_ratio >= 0.20:
                korean_score = 1.0
            elif korean_ratio >= 0.10:
                korean_score = 0.8
            elif korean_ratio >= 0.05:
                korean_score = 0.6
            else:
                korean_score = 0.3
        else:
            if 0.55 <= korean_ratio <= 0.90:
                korean_score = 1.0
            elif 0.40 <= korean_ratio < 0.55 or 0.90 < korean_ratio <= 0.95:
                korean_score = 0.7
            elif 0.25 <= korean_ratio < 0.40:
                korean_score = 0.5
            elif 0.15 <= korean_ratio < 0.25:
                korean_score = 0.3
            else:
                korean_score = 0.1
        
        # 깨진 문자 비율
        broken_chars = len(self.BROKEN_CHAR_PATTERN.findall(text))
        broken_ratio = broken_chars / len(text) if text else 0.0
        broken_score = 1.0 - min(broken_ratio * 5, 1.0)
        
        # 문장 구조 (목록/표 형식 지원)
        lines = text.split('\n')
        words = text.split()
        
        # 마크다운 표 확인
        table_lines = sum(1 for line in lines if '|' in line and line.count('|') >= 2)
        if table_lines >= 3:
            sentence_score = 1.0 if table_lines / max(len(lines), 1) >= 0.2 else 0.9
        else:
            # 목록 형식 확인
            list_pattern = re.compile(r'^\s*[-•○※ㅇ□▶▷◆◇★☆►◎⦁⦾]\s*\S')
            numbered_pattern = re.compile(r'^\s*(\d+[.)]\s*|\([가-힣\d]+\)\s*|\d+\.\d+\s*)')
            list_lines = sum(1 for line in lines if list_pattern.match(line) or numbered_pattern.match(line))
            
            if list_lines >= 3 and list_lines / max(len(lines), 1) >= 0.2:
                sentence_score = 1.0
            else:
                # 일반 문장 구조
                sentences = re.findall(r'[.!?。]\s', text)
                if sentences and len(words) >= 10:
                    avg_words = len(words) / len(sentences)
                    if 5 <= avg_words <= 30:
                        sentence_score = 1.0
                    elif 3 <= avg_words <= 50:
                        sentence_score = 0.7
                    else:
                        sentence_score = 0.4
                else:
                    non_empty = [l for l in lines if l.strip()]
                    if len(non_empty) >= 5:
                        avg_len = sum(len(l.strip()) for l in non_empty) / len(non_empty)
                        sentence_score = 0.7 if 10 <= avg_len <= 200 else 0.5
                    else:
                        sentence_score = 0.5
        
        # 반복 패턴 점수 (HWPX는 반복 패턴 문제 적음)
        repetition_score = 1.0
        
        # UTF-16 인코딩 오류 검사
        has_encoding_error = detect_utf16_misencoding(text)
        encoding_score = 0.0 if has_encoding_error else 1.0
        
        # 종합 점수
        overall = (
            korean_score * 0.30 +
            broken_score * 0.25 +
            sentence_score * 0.15 +
            repetition_score * 0.10 +
            encoding_score * 0.20
        )
        
        return QualityDetails(
            korean_ratio=korean_ratio,
            broken_char_ratio=broken_ratio,
            sentence_structure=sentence_score,
            repetition_anomaly=0.0,
            encoding_error=has_encoding_error,
            korean_score=round(korean_score, 4),
            broken_score=round(broken_score, 4),
            sentence_score=round(sentence_score, 4),
            repetition_score=round(repetition_score, 4),
            encoding_score=round(encoding_score, 4),
            overall_score=round(overall, 4)
        )
    
    def _count_tokens(self, text: str) -> int:
        """토큰 수 계산"""
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except ImportError:
            return len(text) // 2
    
    # ==================== HWPX 표 구조 복원 및 공통 메서드 ====================
    
    def _extract_tables_from_zip(self, zf: zipfile.ZipFile) -> List[TableData]:
        """HWPX 파일에서 표 구조 추출"""
        if not self.config.hwp.extract_tables:
            return []
        
        tables = []
        table_index = 0
        
        try:
            section_files = sorted([
                name for name in zf.namelist()
                if ('Contents/section' in name.lower() or 'section' in name.lower()) 
                and name.endswith('.xml')
            ])
            
            for section_idx, section_file in enumerate(section_files):
                section_data = zf.read(section_file)
                # 섹션 인덱스 저장 (표 데이터에 페이지 번호로 사용)
                self._current_section_idx = section_idx
                section_tables = self._parse_tables_from_hwpx_xml(section_data, table_index)
                tables.extend(section_tables)
                table_index += len(section_tables)
        except Exception as e:
            print(f"[HWPX TABLE] Error: {e}")
        
        return tables
    
    def _parse_tables_from_hwpx_xml(self, data: bytes, start_index: int = 0) -> List[TableData]:
        """HWPX XML 데이터에서 표 구조 파싱"""
        tables = []
        etree = get_lxml_etree()
        
        try:
            if etree is not None:
                root = etree.fromstring(data)
                tables = self._parse_hwpx_tables_with_lxml(root, start_index)
            else:
                root = ET.fromstring(data)
                tables = self._parse_hwpx_tables_with_etree(root, start_index)
        except Exception as e:
            print(f"[HWPX TABLE XML] Error: {e}")
        
        return tables
    
    def _parse_hwpx_tables_with_lxml(self, root, start_index: int = 0) -> List[TableData]:
        """lxml을 사용한 HWPX 표 파싱 (RAG 최적화)"""
        etree = get_lxml_etree()
        if etree is None:
            return []
        
        tables = []
        table_builder = TableBuilder()
        
        for ns in self.TABLE_NAMESPACES:
            if ns:
                tbl_elements = root.xpath('.//hp:tbl', namespaces=ns)
            else:
                tbl_elements = root.xpath('.//*[local-name()="tbl"]')
            
            if tbl_elements:
                for tbl in tbl_elements:
                    table_data = self._parse_hwpx_single_table_lxml(tbl, ns)
                    
                    if table_data and self._is_valid_table(table_data['rows']):
                        # 병합 셀 정보를 포함한 Table 객체 생성
                        table_obj = self._build_table_from_hwpx_cells(
                            table_data['cells_with_span'], 
                            table_builder
                        )
                        
                        # 2D 그리드 추출
                        rows = table_obj.to_2d_grid()
                        
                        tables.append(TableData(
                            table_index=start_index + len(tables),
                            rows=rows,
                            semantic_text=table_obj.to_semantic_text(),
                            structured_data=table_obj.to_structured_dict(),
                            markdown=table_obj.to_markdown(),  # 호환성용
                            row_count=table_obj.rows,
                            col_count=table_obj.cols,
                            confidence=0.8,  # HWPX는 구조화된 형식이므로 신뢰도 높음
                            extraction_method="hwpx_xml",
                            page_num=self._current_section_idx + 1 if hasattr(self, '_current_section_idx') else 1
                        ))
                break
        
        return tables
    
    def _build_table_from_hwpx_cells(
        self, 
        cells_with_span: List[List[Dict]], 
        table_builder: TableBuilder
    ) -> Table:
        """
        HWPX 셀 정보로 Table 객체 생성 (병합 셀 처리)
        
        Args:
            cells_with_span: [[{'text': str, 'col_span': int, 'row_span': int}, ...], ...]
            table_builder: TableBuilder 인스턴스
            
        Returns:
            Table: 구조화된 표 객체
        """
        if not cells_with_span:
            return Table(rows=0, cols=0)
        
        # 전체 행/열 수 계산
        total_rows = len(cells_with_span)
        total_cols = 0
        for row in cells_with_span:
            row_cols = sum(cell.get('col_span', 1) for cell in row)
            total_cols = max(total_cols, row_cols)
        
        # TableCell 객체 생성
        cells = []
        col_offset = [0] * total_rows  # 각 행의 현재 열 오프셋 (병합 셀 고려)
        
        # 병합 셀 추적 (row, col) -> rowspan 남은 수
        rowspan_tracker = {}
        
        for row_idx, row_cells in enumerate(cells_with_span):
            col_idx = 0
            
            for cell_info in row_cells:
                # 이전 행의 rowspan으로 인해 건너뛰어야 하는 열 처리
                while (row_idx, col_idx) in rowspan_tracker:
                    col_idx += 1
                
                text = cell_info.get('text', '')
                col_span = cell_info.get('col_span', 1)
                row_span = cell_info.get('row_span', 1)
                
                # TableCell 생성
                cells.append(TableCell(
                    row=row_idx,
                    col=col_idx,
                    rowspan=row_span,
                    colspan=col_span,
                    text=text,
                    is_header=(row_idx == 0)
                ))
                
                # rowspan > 1인 경우, 다음 행들의 해당 열을 예약
                if row_span > 1:
                    for future_row in range(row_idx + 1, min(row_idx + row_span, total_rows)):
                        for c in range(col_idx, col_idx + col_span):
                            rowspan_tracker[(future_row, c)] = True
                
                col_idx += col_span
        
        return Table(
            rows=total_rows,
            cols=total_cols,
            cells=cells,
            header_rows=1
        )
    
    def _parse_hwpx_single_table_lxml(self, tbl, ns: Dict[str, str]) -> Optional[Dict]:
        """단일 표 요소 파싱 (lxml)"""
        rows = []
        cells_with_span = []
        
        try:
            if ns:
                tr_elements = tbl.xpath('./hp:tr', namespaces=ns)
            else:
                tr_elements = tbl.xpath('./*[local-name()="tr"]')
            
            for tr in tr_elements:
                row_cells = []
                row_cells_with_span = []
                
                if ns:
                    tc_elements = tr.xpath('./hp:tc', namespaces=ns)
                else:
                    tc_elements = tr.xpath('./*[local-name()="tc"]')
                
                for tc in tc_elements:
                    cell_text = self._extract_hwpx_cell_text_lxml(tc, ns)
                    col_span, row_span = 1, 1
                    
                    if ns:
                        tcPr = tc.xpath('./hp:tcPr', namespaces=ns)
                    else:
                        tcPr = tc.xpath('./*[local-name()="tcPr"]')
                    
                    if tcPr:
                        col_span_attr = tcPr[0].get('colSpan') or tcPr[0].get('colspan')
                        row_span_attr = tcPr[0].get('rowSpan') or tcPr[0].get('rowspan')
                        if col_span_attr:
                            try: col_span = int(col_span_attr)
                            except: pass
                        if row_span_attr:
                            try: row_span = int(row_span_attr)
                            except: pass
                    
                    row_cells.append(cell_text)
                    row_cells_with_span.append({'text': cell_text, 'col_span': col_span, 'row_span': row_span})
                
                if row_cells:
                    rows.append(row_cells)
                    cells_with_span.append(row_cells_with_span)
        except Exception as e:
            print(f"[HWPX SINGLE TABLE] Error: {e}")
        
        return {'rows': rows, 'cells_with_span': cells_with_span} if rows else None
    
    def _extract_hwpx_cell_text_lxml(self, tc, ns: Dict[str, str]) -> str:
        """셀 요소에서 텍스트 추출 (lxml)"""
        texts = []
        try:
            xpaths = ['.//hp:t/text()' if ns else './/*[local-name()="t"]/text()', './/text()']
            for xpath in xpaths:
                found = tc.xpath(xpath, namespaces=ns) if ns else tc.xpath(xpath)
                if found:
                    texts = [t.strip() for t in found if t.strip()]
                    if texts: break
        except: pass
        return ' '.join(texts)
    
    def _parse_hwpx_tables_with_etree(self, root: ET.Element, start_index: int = 0) -> List[TableData]:
        """ElementTree를 사용한 HWPX 표 파싱 (RAG 최적화)"""
        tables = []
        table_builder = TableBuilder()
        table_tags = ['.//{http://www.hancom.co.kr/hwpml/2011/paragraph}tbl', './/{*}tbl', './/tbl']
        
        tbl_elements = []
        for tag in table_tags:
            tbl_elements = root.findall(tag)
            if tbl_elements: break
        
        for tbl in tbl_elements:
            cells_with_span = []
            tr_tags = ['./{http://www.hancom.co.kr/hwpml/2011/paragraph}tr', './{*}tr', './tr']
            
            tr_elements = []
            for tag in tr_tags:
                tr_elements = tbl.findall(tag)
                if tr_elements: break
            
            for tr in tr_elements:
                row_cells = []
                row_cells_with_span = []
                tc_tags = ['./{http://www.hancom.co.kr/hwpml/2011/paragraph}tc', './{*}tc', './tc']
                
                tc_elements = []
                for tag in tc_tags:
                    tc_elements = tr.findall(tag)
                    if tc_elements: break
                
                for tc in tc_elements:
                    cell_text = self._extract_hwpx_cell_text_etree(tc)
                    col_span, row_span = self._extract_cell_span_etree(tc)
                    
                    row_cells.append(cell_text)
                    row_cells_with_span.append({
                        'text': cell_text, 
                        'col_span': col_span, 
                        'row_span': row_span
                    })
                
                if row_cells:
                    cells_with_span.append(row_cells_with_span)
            
            # 단순 rows 형태로 유효성 검사
            simple_rows = [[c['text'] for c in row] for row in cells_with_span]
            
            if simple_rows and self._is_valid_table(simple_rows):
                # TableBuilder를 사용하여 Table 객체 생성
                table_obj = self._build_table_from_hwpx_cells(cells_with_span, table_builder)
                rows = table_obj.to_2d_grid()
                
                tables.append(TableData(
                    table_index=start_index + len(tables),
                    rows=rows,
                    semantic_text=table_obj.to_semantic_text(),
                    structured_data=table_obj.to_structured_dict(),
                    markdown=table_obj.to_markdown(),  # 호환성용
                    row_count=table_obj.rows,
                    col_count=table_obj.cols,
                    confidence=0.7,  # ElementTree 파싱은 신뢰도 약간 낮음
                    extraction_method="hwpx_etree",
                    page_num=self._current_section_idx + 1 if hasattr(self, '_current_section_idx') else 1
                ))
        
        return tables
    
    def _extract_cell_span_etree(self, tc: ET.Element) -> tuple:
        """ElementTree로 셀의 colspan, rowspan 추출"""
        col_span, row_span = 1, 1
        
        tcPr_tags = [
            './{http://www.hancom.co.kr/hwpml/2011/paragraph}tcPr',
            './{*}tcPr',
            './tcPr'
        ]
        
        tcPr = None
        for tag in tcPr_tags:
            tcPr_list = tc.findall(tag)
            if tcPr_list:
                tcPr = tcPr_list[0]
                break
        
        if tcPr is not None:
            col_span_attr = tcPr.get('colSpan') or tcPr.get('colspan')
            row_span_attr = tcPr.get('rowSpan') or tcPr.get('rowspan')
            if col_span_attr:
                try:
                    col_span = int(col_span_attr)
                except:
                    pass
            if row_span_attr:
                try:
                    row_span = int(row_span_attr)
                except:
                    pass
        
        return col_span, row_span
    
    def _extract_hwpx_cell_text_etree(self, tc: ET.Element) -> str:
        """셀 요소에서 텍스트 추출 (ElementTree)"""
        texts = []
        text_tags = ['.//{http://www.hancom.co.kr/hwpml/2011/paragraph}t', './/{*}t', './/t']
        
        for tag in text_tags:
            for elem in tc.findall(tag):
                if elem.text:
                    texts.append(elem.text.strip())
            if texts: break
        
        if not texts:
            texts = self._extract_all_text(tc)
        
        return ' '.join(texts)
    
    def _expand_merged_cells(self, cells_with_span: List[List[Dict]]) -> List[List[str]]:
        """병합 셀을 확장하여 정규 2D 배열로 변환"""
        if not cells_with_span:
            return []
        
        max_cols = 0
        for row in cells_with_span:
            row_cols = sum(cell.get('col_span', 1) for cell in row)
            max_cols = max(max_cols, row_cols)
        
        if max_cols == 0:
            return []
        
        max_rows = len(cells_with_span)
        for row_idx, row in enumerate(cells_with_span):
            for cell in row:
                row_span = cell.get('row_span', 1)
                if row_idx + row_span > max_rows:
                    max_rows = row_idx + row_span
        
        grid = [[None for _ in range(max_cols)] for _ in range(max_rows)]
        
        for row_idx, row in enumerate(cells_with_span):
            col_idx = 0
            for cell in row:
                while col_idx < max_cols and grid[row_idx][col_idx] is not None:
                    col_idx += 1
                if col_idx >= max_cols:
                    break
                
                text = cell.get('text', '')
                col_span = cell.get('col_span', 1)
                row_span = cell.get('row_span', 1)
                
                grid[row_idx][col_idx] = text
                
                for r in range(row_span):
                    for c in range(col_span):
                        target_row, target_col = row_idx + r, col_idx + c
                        if target_row < max_rows and target_col < max_cols:
                            if r == 0 and c == 0:
                                continue
                            grid[target_row][target_col] = ''
                
                col_idx += col_span
        
        return [[cell if cell is not None else '' for cell in row] for row in grid]
    
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
        
        if row_count < self.config.hwp.min_table_rows:
            return False
        if col_count < self.config.hwp.min_table_cols:
            return False
        
        # 빈 셀이 너무 많은 표 제외 (30% 미만 채워진 경우 제외)
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
        
        Args:
            text: 추출된 텍스트
            tables: 추출된 표 목록
            
        Returns:
            str: 병합된 텍스트 (semantic_text 포함)
        """
        if not tables:
            return text
        
        result_parts = [text.strip()]
        
        for table in tables:
            result_parts.append(f"\n\n<!-- 표 {table.table_index + 1} -->\n")
            
            # RAG 최적화: semantic_text 우선 사용
            if hasattr(table, 'semantic_text') and table.semantic_text:
                result_parts.append(table.semantic_text)
            elif hasattr(table, 'markdown') and table.markdown:
                # 폴백: 마크다운 사용
                result_parts.append(table.markdown)
            else:
                # 최종 폴백: 2D 그리드에서 직접 생성
                table_builder = TableBuilder()
                table_obj = table_builder.build_from_grid(table.rows, header_rows=1)
                result_parts.append(table_obj.to_semantic_text())
        
        return '\n'.join(result_parts)