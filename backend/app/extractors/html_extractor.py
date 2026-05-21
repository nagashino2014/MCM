"""
HTML 텍스트 추출 모듈
- BeautifulSoup4 기반 HTML 파싱
- 태그 제거 및 텍스트 정규화
"""
import re
import time
from pathlib import Path
from typing import Optional, List, Tuple

from .base import (
    BaseExtractor,
    ExtractionResult,
    ExtractionStatus,
    ExtractionMethod,
    PageResult,
    QualityDetails
)
from ..config import ExtractionConfig, default_config

# BeautifulSoup 지연 로딩
_bs4 = None


def get_beautifulsoup():
    """BeautifulSoup 모듈 지연 로딩"""
    global _bs4
    if _bs4 is None:
        try:
            from bs4 import BeautifulSoup
            _bs4 = BeautifulSoup
        except ImportError:
            print("[WARNING] beautifulsoup4 not installed. HTML extraction will fail.")
            return None
    return _bs4


class HTMLExtractor(BaseExtractor):
    """
    HTML 텍스트 추출기
    
    지원 기능:
    - HTML 태그 제거
    - 스크립트/스타일 제거
    - 테이블 구조 보존
    - 메타데이터 추출 (제목, 설명 등)
    """
    
    SUPPORTED_FORMATS = ["html", "htm", "xhtml"]
    
    # 제거할 태그들
    REMOVE_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio']
    
    # 블록 요소 (줄바꿈 추가)
    BLOCK_TAGS = [
        'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'aside',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'dl', 'dt', 'dd',
        'table', 'tr', 'th', 'td',
        'blockquote', 'pre', 'address', 'figure', 'figcaption',
        'form', 'fieldset', 'legend',
        'br', 'hr'
    ]
    
    KOREAN_PATTERN = re.compile(r'[가-힣]')
    BROKEN_CHAR_PATTERN = re.compile(r'[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]')
    
    def __init__(self, config: Optional[ExtractionConfig] = None):
        self.config = config or default_config
    
    def supports(self, file_format: str) -> bool:
        """HTML 형식 지원 여부"""
        return file_format.lower() in self.SUPPORTED_FORMATS
    
    def extract(self, file_path: str) -> ExtractionResult:
        """
        HTML 파일에서 텍스트 추출
        """
        start_time = time.time()
        file_path = Path(file_path)
        file_format = file_path.suffix.lower().lstrip('.')
        
        if not file_path.exists():
            return ExtractionResult(
                file_path=str(file_path),
                file_format=file_format,
                status=ExtractionStatus.FAILED,
                error_message=f"File not found: {file_path}"
            )
        
        BeautifulSoup = get_beautifulsoup()
        if BeautifulSoup is None:
            return ExtractionResult(
                file_path=str(file_path),
                file_format=file_format,
                status=ExtractionStatus.FAILED,
                error_message="beautifulsoup4 module not available"
            )
        
        try:
            # HTML 파일 읽기
            html_content = self._read_html_file(file_path)
            
            if not html_content:
                return ExtractionResult(
                    file_path=str(file_path),
                    file_format=file_format,
                    status=ExtractionStatus.FAILED,
                    error_message="Failed to read HTML file"
                )
            
            # HTML 파싱
            soup = BeautifulSoup(html_content, 'lxml')
            
            # 메타데이터 추출
            metadata = self._extract_metadata(soup)
            
            # 불필요한 태그 제거
            for tag in self.REMOVE_TAGS:
                for element in soup.find_all(tag):
                    element.decompose()
            
            # 본문 텍스트 추출
            body = soup.find('body')
            if body:
                text = self._extract_text_with_structure(body)
            else:
                text = self._extract_text_with_structure(soup)
            
            # 메타데이터 포함
            if metadata:
                meta_text = "\n".join([f"[{k}] {v}" for k, v in metadata.items() if v])
                if meta_text:
                    text = f"{meta_text}\n\n{text}"
            
            if not text or len(text.strip()) < 5:
                return ExtractionResult(
                    file_path=str(file_path),
                    file_format=file_format,
                    status=ExtractionStatus.FAILED,
                    error_message="No text content found in HTML file"
                )
            
            # 후처리
            text, corrections = self._apply_postprocessing(text)
            
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
            
            return ExtractionResult(
                file_path=str(file_path),
                file_format=file_format,
                status=status,
                text=text,
                pages=[PageResult(page_num=1, text=text, method=ExtractionMethod.TEXT_LAYER)],
                page_count=1,
                quality_score=quality_details.overall_score,
                quality_details=quality_details,
                extraction_method=ExtractionMethod.TEXT_LAYER,
                char_count=len(text),
                token_count=token_count,
                processing_time_ms=processing_time_ms,
                corrections=corrections
            )
            
        except Exception as e:
            return ExtractionResult(
                file_path=str(file_path),
                file_format=file_format,
                status=ExtractionStatus.FAILED,
                error_message=str(e),
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _read_html_file(self, file_path: Path) -> Optional[str]:
        """HTML 파일 읽기 (인코딩 자동 감지)"""
        encodings = ['utf-8', 'euc-kr', 'cp949', 'utf-16', 'iso-8859-1']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    return f.read()
            except (UnicodeDecodeError, UnicodeError):
                continue
        
        # 바이너리로 읽고 최선의 인코딩 시도
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            
            # charset 메타태그에서 인코딩 추출 시도
            charset_match = re.search(rb'charset=["\']?([^"\'\s>]+)', content)
            if charset_match:
                detected_encoding = charset_match.group(1).decode('ascii', errors='ignore')
                try:
                    return content.decode(detected_encoding)
                except:
                    pass
            
            return content.decode('utf-8', errors='ignore')
            
        except Exception:
            return None
    
    def _extract_metadata(self, soup) -> dict:
        """메타데이터 추출"""
        metadata = {}
        
        # 제목
        title_tag = soup.find('title')
        if title_tag:
            metadata['제목'] = title_tag.get_text(strip=True)
        
        # 메타 태그
        for meta in soup.find_all('meta'):
            name = meta.get('name', '').lower()
            content = meta.get('content', '')
            
            if name == 'description' and content:
                metadata['설명'] = content
            elif name == 'keywords' and content:
                metadata['키워드'] = content
            elif name == 'author' and content:
                metadata['작성자'] = content
        
        return metadata
    
    def _extract_text_with_structure(self, element) -> str:
        """구조를 보존하며 텍스트 추출"""
        texts = []
        
        for child in element.children:
            if hasattr(child, 'name'):
                tag_name = child.name
                
                if tag_name is None:
                    continue
                
                # 테이블 처리
                if tag_name == 'table':
                    table_text = self._extract_table(child)
                    if table_text:
                        texts.append(f"\n{table_text}\n")
                
                # 목록 처리
                elif tag_name in ['ul', 'ol']:
                    list_text = self._extract_list(child)
                    if list_text:
                        texts.append(f"\n{list_text}\n")
                
                # 제목 처리
                elif tag_name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                    heading_text = child.get_text(strip=True)
                    if heading_text:
                        texts.append(f"\n\n{heading_text}\n")
                
                # 블록 요소
                elif tag_name in self.BLOCK_TAGS:
                    block_text = self._extract_text_with_structure(child)
                    if block_text.strip():
                        texts.append(f"\n{block_text}")
                
                # 기타 요소
                else:
                    inner_text = self._extract_text_with_structure(child)
                    if inner_text.strip():
                        texts.append(inner_text)
            
            elif hasattr(child, 'string') and child.string:
                # 텍스트 노드
                text = str(child.string).strip()
                if text:
                    texts.append(text)
        
        return ' '.join(texts)
    
    def _extract_table(self, table) -> str:
        """테이블 추출"""
        rows = []
        
        for tr in table.find_all('tr'):
            cells = []
            for cell in tr.find_all(['th', 'td']):
                cell_text = cell.get_text(strip=True)
                cells.append(cell_text if cell_text else "")
            
            if cells and any(cells):
                rows.append(" | ".join(cells))
        
        return "\n".join(rows)
    
    def _extract_list(self, list_elem) -> str:
        """목록 추출"""
        items = []
        
        for idx, li in enumerate(list_elem.find_all('li', recursive=False)):
            item_text = li.get_text(strip=True)
            if item_text:
                # 순서 있는 목록이면 번호 붙이기
                if list_elem.name == 'ol':
                    items.append(f"{idx + 1}. {item_text}")
                else:
                    items.append(f"• {item_text}")
        
        return "\n".join(items)
    
    def _apply_postprocessing(self, text: str) -> Tuple[str, List[dict]]:
        """후처리 적용"""
        corrections = []
        
        # HTML 엔티티 디코딩 (BeautifulSoup이 대부분 처리하지만 누락된 경우)
        html_entities = [
            ('&nbsp;', ' '),
            ('&amp;', '&'),
            ('&lt;', '<'),
            ('&gt;', '>'),
            ('&quot;', '"'),
            ('&apos;', "'"),
            ('&#39;', "'"),
            ('&#x27;', "'"),
        ]
        
        for entity, char in html_entities:
            if entity in text:
                text = text.replace(entity, char)
        
        # 연속 줄바꿈 정리
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        # 연속 공백 정리
        text = re.sub(r' +', ' ', text)
        text = re.sub(r'\t+', ' ', text)
        
        # 줄 시작/끝 공백 제거
        lines = [line.strip() for line in text.split('\n')]
        text = '\n'.join(lines)
        
        # 특수 문자 정리
        special_chars = [
            (r'\u200b', ''),  # Zero-width space
            (r'\u00a0', ' '),  # Non-breaking space
            (r'\ufeff', ''),  # BOM
            (r'\u200e', ''),  # Left-to-right mark
            (r'\u200f', ''),  # Right-to-left mark
        ]
        
        for pattern, replacement in special_chars:
            if re.search(pattern, text):
                text = re.sub(pattern, replacement, text)
                corrections.append({"type": "special_char", "pattern": pattern})
        
        return text.strip(), corrections
    
    def _validate_quality(self, text: str) -> QualityDetails:
        """품질 검증"""
        if not text or len(text.strip()) < 10:
            return QualityDetails(overall_score=0.0)
        
        # 한글 비율
        text_no_space = re.sub(r'\s', '', text)
        korean_chars = len(self.KOREAN_PATTERN.findall(text))
        korean_ratio = korean_chars / len(text_no_space) if text_no_space else 0.0
        
        if 0.55 <= korean_ratio <= 0.90:
            korean_score = 1.0
        elif 0.40 <= korean_ratio < 0.55 or 0.90 < korean_ratio <= 0.95:
            korean_score = 0.7
        elif 0.25 <= korean_ratio < 0.40:
            korean_score = 0.4
        else:
            korean_score = 0.1
        
        # 깨진 문자 비율
        broken_chars = len(self.BROKEN_CHAR_PATTERN.findall(text))
        broken_ratio = broken_chars / len(text) if text else 0.0
        broken_score = 1.0 - min(broken_ratio * 5, 1.0)
        
        # 문장 구조
        sentences = re.findall(r'[.!?。]\s', text)
        words = text.split()
        if sentences and len(words) >= 10:
            avg_words = len(words) / len(sentences)
            if 5 <= avg_words <= 30:
                sentence_score = 1.0
            elif 3 <= avg_words <= 50:
                sentence_score = 0.7
            else:
                sentence_score = 0.4
        else:
            sentence_score = 0.5
        
        # HTML 잔여물 확인
        html_remnants = len(re.findall(r'<[^>]+>', text))
        remnant_score = 1.0 if html_remnants == 0 else max(0.3, 1.0 - html_remnants * 0.1)
        
        overall = (
            korean_score * 0.30 +
            broken_score * 0.25 +
            sentence_score * 0.20 +
            remnant_score * 0.15 +
            1.0 * 0.10  # 기본 점수
        )
        
        return QualityDetails(
            korean_ratio=korean_ratio,
            broken_char_ratio=broken_ratio,
            sentence_structure=sentence_score,
            repetition_anomaly=remnant_score,
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
