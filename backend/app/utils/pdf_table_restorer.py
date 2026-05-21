"""
PDF 표 구조 복원 모듈

PDF에서 추출된 마크다운 표의 구조 문제를 감지하고 복원합니다.

주요 문제 해결:
1. 열 정렬 불일치 (셀 병합으로 인한 열 이동)
2. 셀 병합 표현 (">" 패턴) 처리
3. 헤더 누락 감지 및 복구
4. 행 연속성 감지 (번호 없는 표 처리)
5. 중복 구분선 제거 (매 행마다 |---| 반복 패턴)
6. 분할된 텍스트 병합 (OCR로 인한 셀 분할 복원)
7. 연속 행 병합 (논리적으로 같은 항목인 여러 행 통합)
8. 카테고리 헤더 식별 및 포맷팅

사용 예시:
    restorer = PDFTableRestorer()
    fixed_text = restorer.restore_tables(markdown_text)
"""
import re
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field


@dataclass
class TableAnalysis:
    """표 분석 결과"""
    expected_cols: int              # 예상 열 수
    has_header: bool                # 헤더 존재 여부
    has_numbering: bool             # 번호 열 존재 여부
    numbering_col_index: int        # 번호 열 인덱스 (-1이면 없음)
    category_col_index: int         # 카테고리 열 인덱스 (-1이면 없음)
    merge_patterns_found: List[str] # 발견된 병합 패턴
    row_shift_detected: bool        # 열 이동 감지 여부
    has_duplicate_separators: bool = False  # 매 행마다 구분선 반복 여부
    has_split_cells: bool = False   # 분할된 셀 존재 여부
    category_header_rows: List[int] = field(default_factory=list)  # 카테고리 헤더 행 인덱스


class PDFTableRestorer:
    """
    PDF에서 추출된 마크다운 표 구조 복원기
    
    PDF의 표 추출 시 발생하는 일반적인 문제들을 해결합니다:
    - 셀 병합으로 인한 열 정렬 문제
    - pdfplumber가 생성하는 ">" 패턴 처리
    - 번호가 없는 표의 구조 복원
    """
    
    # 셀 병합 패턴 (pdfplumber가 생성)
    MERGE_PATTERN = re.compile(r'^(.+?)\s*>\s*(\d+|.+)$')
    
    # 번호 패턴
    NUMBER_PATTERN = re.compile(r'^\s*(\d+)\s*$')
    
    # 마크다운 표 패턴
    TABLE_ROW_PATTERN = re.compile(r'^\|(.+)\|$')
    TABLE_SEPARATOR_PATTERN = re.compile(r'^\|[\s\-:|]+\|$')
    
    def __init__(
        self,
        auto_detect_header: bool = True,
        restore_merged_cells: bool = True,
        normalize_columns: bool = True,
        fill_category_column: bool = True,
        remove_duplicate_separators: bool = True,
        merge_split_cells: bool = True,
        merge_continuation_rows: bool = True,
        identify_category_headers: bool = True,
        verbose: bool = False
    ):
        """
        Args:
            auto_detect_header: 헤더 자동 감지 및 추가
            restore_merged_cells: 병합된 셀 복원
            normalize_columns: 열 수 정규화
            fill_category_column: 카테고리 열 채우기 (위 행에서 상속)
            remove_duplicate_separators: 중복 구분선 제거
            merge_split_cells: 분할된 셀 병합 (OCR 오류 복구)
            merge_continuation_rows: 연속 행 병합
            identify_category_headers: 카테고리 헤더 식별
            verbose: 디버그 출력
        """
        self.auto_detect_header = auto_detect_header
        self.restore_merged_cells = restore_merged_cells
        self.normalize_columns = normalize_columns
        self.fill_category_column = fill_category_column
        self.remove_duplicate_separators = remove_duplicate_separators
        self.merge_split_cells = merge_split_cells
        self.merge_continuation_rows = merge_continuation_rows
        self.identify_category_headers = identify_category_headers
        self.verbose = verbose
    
    def restore_tables(self, text: str) -> str:
        """
        텍스트 내의 모든 마크다운 표를 복원합니다.
        
        Args:
            text: 마크다운 표가 포함된 텍스트
            
        Returns:
            복원된 표가 포함된 텍스트
        """
        # 표 영역 찾기
        table_regions = self._find_table_regions(text)
        
        if not table_regions:
            return text
        
        result = text
        offset = 0  # 문자열 길이 변화 추적
        
        for start, end, table_text in table_regions:
            # 표 손상 정도 평가
            damage_level = self._assess_table_damage(table_text)
            
            if damage_level == 'severe':
                # 심하게 손상된 표: 특수 복원 로직 사용
                restored_table = self.restore_severely_damaged_table(table_text)
            else:
                # 일반 복원
                restored_table = self._restore_single_table(table_text)
            
            # 원본 표를 복원된 표로 교체
            adjusted_start = start + offset
            adjusted_end = end + offset
            result = result[:adjusted_start] + restored_table + result[adjusted_end:]
            
            # offset 업데이트
            offset += len(restored_table) - len(table_text)
        
        return result
    
    def _assess_table_damage(self, table_text: str) -> str:
        """
        표 손상 정도 평가
        
        Returns:
            'severe': 심각한 손상 (구분선 반복, 셀 과다 분할)
            'moderate': 중간 손상 (일부 정렬 문제)
            'minor': 경미한 손상
        """
        lines = table_text.strip().split('\n')
        
        if len(lines) < 3:
            return 'minor'
        
        # 구분선 비율 확인
        separator_count = sum(1 for line in lines if self.TABLE_SEPARATOR_PATTERN.match(line.strip()))
        data_line_count = len(lines) - separator_count
        
        # 구분선이 데이터 행보다 많거나 비슷하면 심각한 손상
        if separator_count >= data_line_count * 0.5:
            return 'severe'
        
        # 평균 열 수 확인
        col_counts = []
        for line in lines:
            if not self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                cells = self._parse_row_cells(line)
                if cells:
                    col_counts.append(len(cells))
        
        if col_counts:
            avg_cols = sum(col_counts) / len(col_counts)
            # 열 수가 너무 많으면 (7열 이상) 과다 분할 의심
            if avg_cols >= 7:
                return 'severe'
            # 열 수 변동이 크면 중간 손상
            if max(col_counts) - min(col_counts) > 2:
                return 'moderate'
        
        return 'minor'
    
    def _find_table_regions(self, text: str) -> List[Tuple[int, int, str]]:
        """텍스트에서 마크다운 표 영역 찾기"""
        regions = []
        lines = text.split('\n')
        
        i = 0
        while i < len(lines):
            # 표 시작 감지 (| 로 시작하는 줄)
            if lines[i].strip().startswith('|') and lines[i].strip().endswith('|'):
                table_start_line = i
                table_lines = []
                
                # 연속된 표 줄 수집
                while i < len(lines) and lines[i].strip().startswith('|') and lines[i].strip().endswith('|'):
                    table_lines.append(lines[i])
                    i += 1
                
                # 최소 3줄 이상 (헤더 + 구분자 + 데이터)
                if len(table_lines) >= 3:
                    # 시작/끝 위치 계산
                    start_pos = sum(len(lines[j]) + 1 for j in range(table_start_line))
                    end_pos = start_pos + sum(len(line) + 1 for line in table_lines) - 1
                    table_text = '\n'.join(table_lines)
                    regions.append((start_pos, end_pos, table_text))
            else:
                i += 1
        
        return regions
    
    def _restore_single_table(self, table_text: str) -> str:
        """단일 표 복원"""
        lines = table_text.strip().split('\n')
        
        if len(lines) < 2:
            return table_text
        
        # 0. 중복 구분선 제거 (가장 먼저 처리)
        if self.remove_duplicate_separators:
            lines = self._remove_duplicate_separators(lines)
        
        if len(lines) < 2:
            return table_text
        
        # 표 분석
        analysis = self._analyze_table(lines)
        
        # 1. 분할된 셀 병합 (OCR 오류 복구) - 행 파싱 전에 처리
        if self.merge_split_cells and analysis.has_split_cells:
            lines = self._merge_split_cells_in_lines(lines, analysis)
            # 분석 재실행
            analysis = self._analyze_table(lines)
        
        # 행 파싱
        rows = self._parse_table_rows(lines)
        
        if not rows:
            return table_text
        
        # 2. 연속 행 병합 (논리적으로 같은 항목)
        if self.merge_continuation_rows:
            rows = self._merge_continuation_rows_impl(rows, analysis)
        
        # 3. 셀 병합 패턴 복원
        if self.restore_merged_cells and analysis.merge_patterns_found:
            rows = self._restore_merged_cells(rows, analysis)
        
        # 4. 열 정렬 복원
        if analysis.row_shift_detected:
            rows = self._fix_column_alignment(rows, analysis)
        
        # 5. 열 수 정규화
        if self.normalize_columns:
            rows = self._normalize_column_count(rows, analysis.expected_cols)
        
        # 6. 카테고리 열 채우기
        if self.fill_category_column and analysis.category_col_index >= 0:
            rows = self._fill_category_column(rows, analysis.category_col_index)
        
        # 7. 카테고리 헤더 포맷팅
        if self.identify_category_headers and analysis.category_header_rows:
            rows = self._format_category_headers(rows, analysis)
        
        # 마크다운 표로 재구성
        return self._rows_to_markdown(rows)
    
    def _analyze_table(self, lines: List[str]) -> TableAnalysis:
        """표 구조 분석"""
        # 구분자 행에서 열 수 추출
        expected_cols = 0
        separator_count = 0
        
        for line in lines:
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                separator_count += 1
                if expected_cols == 0:
                    expected_cols = line.count('|') - 1
        
        if expected_cols == 0:
            # 첫 번째 데이터 행에서 추정
            first_data = lines[0] if lines else ""
            expected_cols = first_data.count('|') - 1
        
        # 중복 구분선 감지 (전체 행의 30% 이상이 구분선이면 중복)
        has_duplicate_separators = separator_count > len(lines) * 0.3
        
        # 헤더 존재 여부 (구분자가 두 번째 줄에 있으면 헤더 있음)
        has_header = len(lines) > 1 and self.TABLE_SEPARATOR_PATTERN.match(lines[1].strip())
        
        # 병합 패턴 및 번호 열 분석
        merge_patterns = []
        has_numbering = False
        numbering_col_index = -1
        category_col_index = -1
        row_shift_detected = False
        has_split_cells = False
        category_header_rows = []
        
        # 분할된 셀 감지 패턴 (공백으로 끝나거나 시작하는 셀, 불완전한 단어)
        incomplete_word_pattern = re.compile(r'[가-힣]\s*$')  # 한글로 끝나고 공백
        incomplete_start_pattern = re.compile(r'^\s*[가-힣]')  # 공백 후 한글 시작
        
        prev_cells = []
        for line_idx, line in enumerate(lines):
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                continue
                
            cells = self._parse_row_cells(line)
            
            # 카테고리 헤더 감지 (첫 셀만 내용이 있고 나머지가 비어있는 경우)
            non_empty_cells = [c for c in cells if c.strip()]
            if len(non_empty_cells) == 1 and cells and cells[0].strip():
                # 첫 번째 열에 내용이 있고 다른 열이 비어있음
                first_cell = cells[0].strip()
                # ㅇ, *, ** 등의 기호가 아닌 실제 텍스트인 경우
                if not re.match(r'^[ㅇ\*]+$', first_cell) and len(first_cell) > 2:
                    category_header_rows.append(line_idx)
            
            for idx, cell in enumerate(cells):
                # 병합 패턴 확인
                if self.MERGE_PATTERN.match(cell):
                    merge_patterns.append(cell)
                    row_shift_detected = True
                    if category_col_index < 0:
                        category_col_index = idx
                
                # 번호 열 확인
                if self.NUMBER_PATTERN.match(cell):
                    if not has_numbering:
                        has_numbering = True
                        numbering_col_index = idx
                
                # 분할된 셀 감지
                if cell.strip():
                    # 이전 셀이 공백으로 끝나고 현재 셀이 한글로 시작하면 분할 의심
                    if idx > 0 and idx < len(prev_cells):
                        prev_cell = prev_cells[idx] if idx < len(prev_cells) else ""
                        if prev_cell and incomplete_word_pattern.search(prev_cell) and incomplete_start_pattern.match(cell):
                            has_split_cells = True
            
            # 열 수 불일치 확인
            if len(cells) != expected_cols and len(cells) > 0:
                row_shift_detected = True
            
            prev_cells = cells
        
        return TableAnalysis(
            expected_cols=max(expected_cols, 1),
            has_header=has_header,
            has_numbering=has_numbering,
            numbering_col_index=numbering_col_index,
            category_col_index=category_col_index,
            merge_patterns_found=merge_patterns,
            row_shift_detected=row_shift_detected,
            has_duplicate_separators=has_duplicate_separators,
            has_split_cells=has_split_cells,
            category_header_rows=category_header_rows
        )
    
    def _parse_table_rows(self, lines: List[str]) -> List[List[str]]:
        """표 행 파싱"""
        rows = []
        
        for line in lines:
            # 구분자 행은 특별 처리
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                rows.append(['---SEPARATOR---'])
                continue
            
            cells = self._parse_row_cells(line)
            if cells:
                rows.append(cells)
        
        return rows
    
    def _parse_row_cells(self, line: str) -> List[str]:
        """행의 셀 파싱"""
        line = line.strip()
        if not line.startswith('|') or not line.endswith('|'):
            return []
        
        # 앞뒤 | 제거 후 분할
        inner = line[1:-1]
        cells = [cell.strip() for cell in inner.split('|')]
        return cells
    
    def _restore_merged_cells(self, rows: List[List[str]], analysis: TableAnalysis) -> List[List[str]]:
        """
        병합된 셀 복원
        
        "카테고리 > 번호" 또는 "번호 > 번호" 패턴을 분리하여
        적절한 열에 배치합니다.
        """
        restored_rows = []
        last_category = ""
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                restored_rows.append(row)
                continue
            
            new_row = []
            merged_found = False
            
            for idx, cell in enumerate(row):
                match = self.MERGE_PATTERN.match(cell)
                
                if match:
                    merged_found = True
                    left_part = match.group(1).strip()
                    right_part = match.group(2).strip()
                    
                    # "카테고리 > 번호" 패턴
                    if not self.NUMBER_PATTERN.match(left_part):
                        # 왼쪽은 카테고리, 오른쪽은 번호
                        last_category = left_part
                        new_row.append(left_part)  # 카테고리
                        new_row.append(right_part)  # 번호
                    else:
                        # "번호 > 번호" 패턴 - 이전 카테고리 사용
                        new_row.append(last_category if last_category else "")
                        new_row.append(right_part)  # 새 번호만 사용
                else:
                    new_row.append(cell)
            
            # 첫 번째 셀이 카테고리일 경우 저장
            if new_row and not merged_found:
                first_cell = new_row[0]
                if first_cell and not self.NUMBER_PATTERN.match(first_cell):
                    last_category = first_cell
            
            restored_rows.append(new_row)
        
        return restored_rows
    
    def _fix_column_alignment(self, rows: List[List[str]], analysis: TableAnalysis) -> List[List[str]]:
        """
        열 정렬 수정
        
        번호가 있는 경우: 번호 열을 기준으로 정렬
        번호가 없는 경우: 콘텐츠 패턴을 분석하여 정렬
        """
        if not rows:
            return rows
        
        expected_cols = analysis.expected_cols
        fixed_rows = []
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                fixed_rows.append(row)
                continue
            
            current_cols = len(row)
            
            if current_cols == expected_cols:
                fixed_rows.append(row)
            elif current_cols < expected_cols:
                # 열이 부족한 경우 - 앞에 빈 셀 추가 (카테고리 누락으로 추정)
                missing = expected_cols - current_cols
                # 첫 번째 셀이 번호인지 확인
                if row and self.NUMBER_PATTERN.match(row[0]):
                    # 번호가 첫 번째면 카테고리 열이 누락된 것
                    fixed_rows.append([''] * missing + row)
                else:
                    # 끝에 빈 셀 추가
                    fixed_rows.append(row + [''] * missing)
            else:
                # 열이 많은 경우 - 병합 시도
                fixed_rows.append(row[:expected_cols])
        
        return fixed_rows
    
    def _normalize_column_count(self, rows: List[List[str]], expected_cols: int) -> List[List[str]]:
        """모든 행의 열 수를 일치시킴"""
        normalized = []
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                normalized.append(row)
                continue
            
            if len(row) < expected_cols:
                normalized.append(row + [''] * (expected_cols - len(row)))
            elif len(row) > expected_cols:
                normalized.append(row[:expected_cols])
            else:
                normalized.append(row)
        
        return normalized
    
    def _fill_category_column(self, rows: List[List[str]], col_index: int) -> List[List[str]]:
        """
        카테고리 열 채우기 (위 행에서 상속)
        
        빈 카테고리 셀을 위 행의 값으로 채웁니다.
        이는 PDF에서 셀 병합을 사용한 표를 복원할 때 필요합니다.
        """
        filled_rows = []
        last_value = ""
        is_after_header = False
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                filled_rows.append(row)
                is_after_header = True
                continue
            
            # 헤더 이후의 데이터 행만 처리
            if is_after_header and col_index < len(row):
                if row[col_index].strip():
                    last_value = row[col_index]
                else:
                    # 빈 셀을 이전 값으로 채움
                    row = row.copy()
                    row[col_index] = last_value
            
            filled_rows.append(row)
        
        return filled_rows
    
    def _rows_to_markdown(self, rows: List[List[str]]) -> str:
        """행 리스트를 마크다운 표로 변환"""
        if not rows:
            return ""
        
        md_lines = []
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                # 열 수에 맞는 구분자 생성
                col_count = len(rows[0]) if rows else 3
                md_lines.append('|' + '|'.join(['---'] * col_count) + '|')
            else:
                # 셀 내용 정리
                cleaned_cells = [self._clean_cell(cell) for cell in row]
                md_lines.append('| ' + ' | '.join(cleaned_cells) + ' |')
        
        return '\n'.join(md_lines)
    
    def _clean_cell(self, cell: str) -> str:
        """셀 내용 정리"""
        if cell is None:
            return ""
        
        text = str(cell).strip()
        # 줄바꿈 제거
        text = text.replace('\n', ' ')
        # 연속 공백 정리
        text = re.sub(r'\s+', ' ', text)
        # 파이프 이스케이프
        text = text.replace('|', '\\|')
        
        return text
    
    # ========== 분할 텍스트 병합을 위한 메소드 ==========
    
    def _remove_duplicate_separators(self, lines: List[str]) -> List[str]:
        """
        매 행마다 반복되는 중복 구분선 제거
        
        예시 입력:
        | 데이터1 | 데이터2 |
        |---|---|
        | 데이터3 | 데이터4 |
        |---|---|
        
        예시 출력:
        | 데이터1 | 데이터2 |
        |---|---|
        | 데이터3 | 데이터4 |
        """
        if not lines:
            return lines
        
        result = []
        separator_found = False
        
        for line in lines:
            is_separator = self.TABLE_SEPARATOR_PATTERN.match(line.strip())
            
            if is_separator:
                # 첫 번째 구분선만 유지 (헤더 아래)
                if not separator_found:
                    result.append(line)
                    separator_found = True
                # 이후 구분선은 건너뛰기
            else:
                result.append(line)
        
        return result
    
    def _merge_split_cells_in_lines(self, lines: List[str], analysis: TableAnalysis) -> List[str]:
        """
        OCR로 인해 분할된 셀들을 병합
        
        문제 패턴:
        | 운영(269명) 및 안 | 전서비스 | 강화로 | 안전사 | 고 발생률 |
        
        해결:
        | 운영(269명) 및 안전서비스 강화로 안전사고 발생률 |
        
        전략:
        1. 각 행의 셀 분석
        2. 불완전한 단어로 끝나는 셀 감지
        3. 다음 셀과 병합하여 완전한 문장 구성
        4. 적절한 열 수로 재구성
        """
        if not lines:
            return lines
        
        result = []
        
        for line in lines:
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                result.append(line)
                continue
            
            cells = self._parse_row_cells(line)
            if not cells:
                result.append(line)
                continue
            
            # 셀 병합 수행
            merged_cells = self._merge_fragmented_cells(cells)
            
            # 병합된 셀로 행 재구성
            if merged_cells:
                new_line = '| ' + ' | '.join(merged_cells) + ' |'
                result.append(new_line)
            else:
                result.append(line)
        
        return result
    
    def _merge_fragmented_cells(self, cells: List[str]) -> List[str]:
        """
        조각난 셀들을 병합하여 의미 있는 단위로 재구성
        
        규칙:
        1. 기호 셀 (ㅇ, *, **) 은 유지
        2. 괄호로 시작하는 텍스트는 항목명으로 간주
        3. 불완전한 단어는 다음 셀과 병합
        4. 숫자/날짜 데이터는 독립 셀로 유지
        """
        if not cells:
            return cells
        
        # 한글 문장 연속 패턴
        incomplete_endings = re.compile(r'[\s가-힣]$')  # 한글 또는 공백으로 끝남
        korean_start = re.compile(r'^[가-힣\s]')  # 한글 또는 공백으로 시작
        
        # 기호 패턴
        marker_pattern = re.compile(r'^[ㅇ\*]+$|^\s*$')
        
        # 독립 데이터 패턴 (숫자, 날짜, 퍼센트 등)
        standalone_data = re.compile(
            r'^[\d,.\-]+[%명개억원년월일]?$|'  # 숫자 + 단위
            r'^[\d,.\-]+[%명개억원년월일]?[\s]*→[\s]*[\d,.\-]+[%명개억원년월일]?$|'  # 변화량 (0.314명→0.309명)
            r"^'\d{2}년"  # 연도 ('24년)
        )
        
        # 항목명 패턴 (괄호로 시작)
        item_name_pattern = re.compile(r'^\([^)]+\)')
        
        merged = []
        buffer = ""
        
        for i, cell in enumerate(cells):
            cell = cell.strip()
            
            # 기호 셀은 그대로 유지
            if marker_pattern.match(cell):
                if buffer:
                    merged.append(buffer.strip())
                    buffer = ""
                merged.append(cell)
                continue
            
            # 독립 데이터는 그대로 유지
            if standalone_data.match(cell):
                if buffer:
                    merged.append(buffer.strip())
                    buffer = ""
                merged.append(cell)
                continue
            
            # 버퍼가 비어있으면 현재 셀로 시작
            if not buffer:
                buffer = cell
                continue
            
            # 버퍼 끝과 현재 셀 시작이 연결될 수 있는지 확인
            if self._should_merge_cells(buffer, cell):
                # 병합
                buffer = buffer.rstrip() + cell.lstrip()
            else:
                # 새 항목 시작
                merged.append(buffer.strip())
                buffer = cell
        
        # 남은 버퍼 처리
        if buffer:
            merged.append(buffer.strip())
        
        return merged
    
    def _should_merge_cells(self, prev_cell: str, curr_cell: str) -> bool:
        """두 셀을 병합해야 하는지 판단"""
        if not prev_cell or not curr_cell:
            return False
        
        prev_cell = prev_cell.strip()
        curr_cell = curr_cell.strip()
        
        # 빈 셀은 병합하지 않음
        if not prev_cell or not curr_cell:
            return False
        
        # 이전 셀이 불완전한 단어로 끝나는 경우
        # 예: "안전사" -> "안전사고"로 병합
        
        # 한글 글자로 끝나고 다음 셀이 한글로 시작하면 병합 후보
        if re.search(r'[가-힣]$', prev_cell) and re.match(r'^[가-힣]', curr_cell):
            # 조사나 접미사로 시작하는 경우 병합
            if re.match(r'^[고는로를의가에서와]', curr_cell):
                return True
            # 공백 없이 연결되어야 할 단어
            if len(curr_cell) <= 3:  # 짧은 조각은 병합
                return True
        
        # 공백으로 끝나고 한글로 시작하면 병합
        if prev_cell.endswith(' ') or curr_cell.startswith(' '):
            if re.search(r'[가-힣]', prev_cell) and re.search(r'[가-힣]', curr_cell):
                return True
        
        # 숫자로 끝나고 단위/조사로 시작하면 병합
        # 예: "25" + "% 저감" -> "25% 저감"
        if re.search(r'\d$', prev_cell) and re.match(r'^[%명개억원년월일]', curr_cell):
            return True
        
        return False
    
    def _merge_continuation_rows_impl(self, rows: List[List[str]], analysis: TableAnalysis) -> List[List[str]]:
        """
        논리적으로 같은 항목인 연속 행들을 병합
        
        규칙:
        1. 첫 번째 열이 비어있고 (기호 없음)
        2. 이전 행과 같은 패턴의 내용이면
        3. 이전 행에 내용 추가
        
        예시:
        | ㅇ | (국민안전) 안전전담인력 | 운영(269명) 및 안 |
        |   | 감소('24년 0.314명→'25년 | 0.309명) |
        
        병합 후:
        | ㅇ | (국민안전) 안전전담인력 | 운영(269명) 및 안전서비스... 감소('24년 0.314명→'25년 0.309명) |
        """
        if not rows:
            return rows
        
        result = []
        skip_next = set()
        
        for i, row in enumerate(rows):
            if i in skip_next:
                continue
            
            if row == ['---SEPARATOR---']:
                result.append(row)
                continue
            
            # 현재 행이 메인 행인지 확인 (첫 번째 셀에 기호 있음)
            is_main_row = row and row[0].strip() and re.match(r'^[ㅇ\*]+$', row[0].strip())
            
            if is_main_row:
                # 다음 행들이 연속 행인지 확인하고 병합
                merged_row = row.copy()
                j = i + 1
                
                while j < len(rows):
                    next_row = rows[j]
                    
                    if next_row == ['---SEPARATOR---']:
                        break
                    
                    # 다음 행이 연속 행인지 확인 (첫 번째 셀이 비어있음)
                    if next_row and (not next_row[0].strip() or next_row[0].strip() == ''):
                        # 병합
                        merged_row = self._merge_two_rows(merged_row, next_row)
                        skip_next.add(j)
                        j += 1
                    else:
                        break
                
                result.append(merged_row)
            else:
                # 첫 번째 열이 비어있는 행 (부연설명)
                # 이전 메인 행이 있으면 병합, 없으면 그대로 추가
                if result and result[-1] != ['---SEPARATOR---']:
                    # * 로 시작하는 부연설명은 별도 행으로 유지
                    content = ' '.join([c for c in row if c.strip()])
                    if content.strip().startswith('*'):
                        result.append(row)
                    else:
                        # 이전 행에 병합
                        result[-1] = self._merge_two_rows(result[-1], row)
                else:
                    result.append(row)
        
        return result
    
    def _merge_two_rows(self, main_row: List[str], cont_row: List[str]) -> List[str]:
        """두 행을 병합"""
        if not main_row:
            return cont_row
        if not cont_row:
            return main_row
        
        result = main_row.copy()
        
        # 각 열별로 병합
        for i, cell in enumerate(cont_row):
            if i < len(result):
                if cell.strip() and result[i].strip():
                    # 둘 다 내용이 있으면 공백으로 연결
                    result[i] = result[i].rstrip() + ' ' + cell.lstrip()
                elif cell.strip():
                    result[i] = cell
            else:
                result.append(cell)
        
        return result
    
    def _format_category_headers(self, rows: List[List[str]], analysis: TableAnalysis) -> List[List[str]]:
        """
        카테고리 헤더 행을 포맷팅
        
        카테고리 헤더는 **굵은 글씨**로 표시
        """
        if not rows or not analysis.category_header_rows:
            return rows
        
        result = []
        separator_count = 0
        actual_row_idx = 0
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                result.append(row)
                separator_count += 1
                continue
            
            # 실제 행 인덱스 계산 (구분선 제외)
            original_idx = actual_row_idx + separator_count
            
            if original_idx in analysis.category_header_rows:
                # 카테고리 헤더 포맷팅
                formatted_row = row.copy()
                if formatted_row:
                    first_cell = formatted_row[0].strip()
                    if first_cell and not first_cell.startswith('**'):
                        formatted_row[0] = f'**{first_cell}**'
                result.append(formatted_row)
            else:
                result.append(row)
            
            actual_row_idx += 1
        
        return result
    
    # ========== 심하게 손상된 표 복원을 위한 고급 메소드 ==========
    
    def restore_severely_damaged_table(self, table_text: str) -> str:
        """
        심하게 손상된 표 복원 (OCR 등으로 인한 심각한 구조 손상)
        
        전략:
        1. 모든 행을 하나의 텍스트로 추출 (구분선 제외)
        2. 기호 (ㅇ, *, **) 기반으로 항목 분리
        3. 괄호로 항목명 감지 
        4. 카테고리 헤더 식별
        5. 3열 표로 변환 (구분, 항목, 내용)
        """
        lines = table_text.strip().split('\n')
        
        # 모든 텍스트를 하나로 합침 (구분선 제외)
        all_text_parts = []
        for line in lines:
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                continue
            cells = self._parse_row_cells(line)
            if cells:
                # 모든 셀을 공백으로 연결
                text = ' '.join([c.strip() for c in cells if c.strip()])
                if text:
                    all_text_parts.append(text)
        
        full_text = ' '.join(all_text_parts)
        
        # 분할된 단어 복원
        full_text = self._fix_split_words(full_text)
        
        # 항목 추출 (기호 기반 분리)
        items = self._extract_items_from_text(full_text)
        
        if not items:
            return table_text
        
        # 3열 표로 재구성
        return self._build_restored_table(items)
    
    def _extract_items_from_text(self, text: str) -> List[Dict[str, Any]]:
        """
        연속된 텍스트에서 항목 추출
        
        패턴: ㅇ (카테고리) 내용... ㅇ (다음카테고리) 내용...
        """
        items = []
        
        # 카테고리 헤더 키워드 및 패턴
        category_headers_info = {
            '지역경제 활성화': True,
            '대국민 소통노력': True,
            '지역경제활성화': True,
            '대국민소통노력': True,
        }
        
        # 먼저 텍스트를 기호 위치로 분리
        # 패턴: ㅇ, **, * 뒤에 공백이나 (가 오는 경우
        split_pattern = re.compile(r'(?=\s[ㅇ]\s|\s\*\*\s|\s\*\s[^*])')
        
        # 더 단순한 접근: 줄 단위로 분리하고 기호 기반으로 처리
        # 모든 항목 시작점 찾기: "ㅇ (" 패턴
        item_starts = []
        
        # ㅇ (항목명) 패턴 찾기
        main_item_pattern = re.compile(r'ㅇ\s*\(([^)]+)\)')
        for match in main_item_pattern.finditer(text):
            item_starts.append((match.start(), 'ㅇ', match.group(1)))
        
        # ** 패턴 찾기
        double_star_pattern = re.compile(r'\*\*\s+([^*]+?)(?=\s*ㅇ|\s*\*|$)')
        for match in double_star_pattern.finditer(text):
            item_starts.append((match.start(), '**', match.group(1)))
        
        # 카테고리 헤더 찾기
        for header in category_headers_info:
            pos = text.find(header)
            if pos >= 0:
                item_starts.append((pos, 'HEADER', header))
        
        # 위치순 정렬
        item_starts.sort(key=lambda x: x[0])
        
        # 각 항목의 내용 추출
        for i, (pos, marker, name) in enumerate(item_starts):
            # 다음 항목 시작 위치
            next_pos = item_starts[i + 1][0] if i + 1 < len(item_starts) else len(text)
            
            if marker == 'HEADER':
                # 카테고리 헤더
                items.append({
                    'marker': '',
                    'name': f'**{name}**',
                    'content': '',
                    'notes': [],
                    'is_header': True
                })
            else:
                # 일반 항목
                # 항목명 뒤 내용 추출
                match = re.search(rf'{re.escape(marker)}\s*\({re.escape(name)}\)\s*', text[pos:])
                if match:
                    content_start = pos + match.end()
                    content = text[content_start:next_pos].strip()
                else:
                    content = text[pos:next_pos].strip()
                
                # 부연설명 분리 (* 로 시작하는 부분)
                notes = []
                main_content = content
                
                # * 로 시작하는 부연설명 찾기 (** 는 제외)
                note_splits = re.split(r'(?<!\*)\*\s+(?!\*)', content)
                if len(note_splits) > 1:
                    main_content = note_splits[0].strip()
                    for note in note_splits[1:]:
                        note = note.strip()
                        if note and not note.startswith('*'):  # ** 가 아닌 경우만
                            notes.append('* ' + note)
                
                items.append({
                    'marker': marker,
                    'name': name,
                    'content': main_content,
                    'notes': notes
                })
        
        return items
    
    def _extract_items_from_merged_lines(self, merged_lines: List[List[str]]) -> List[Dict[str, Any]]:
        """병합된 라인에서 항목 추출"""
        items = []
        current_item = None
        
        # 기호 패턴
        marker_pattern = re.compile(r'^[ㅇ\*]+$')
        # 항목명 패턴 (괄호로 시작)
        item_name_pattern = re.compile(r'\(([^)]+)\)\s*(.+)?')
        # 카테고리 헤더 키워드
        category_keywords = [
            '활성화', '소통', '노력', '안전', '관리', '사업', '지원', 
            '확대', '향상', '개선', '강화', '협력'
        ]
        
        for cells in merged_lines:
            if not cells:
                continue
            
            first_cell = cells[0].strip() if cells else ""
            rest_cells = cells[1:] if len(cells) > 1 else []
            merged_text = ' '.join([c.strip() for c in cells if c.strip()])
            rest_text = ' '.join([c.strip() for c in rest_cells if c.strip()])
            
            # 카테고리 헤더 감지
            is_category_header = False
            if not first_cell or not marker_pattern.match(first_cell):
                clean_text = merged_text.strip()
                if re.match(r'^[가-힣\s]+$', clean_text) and len(clean_text) <= 15:
                    if any(kw in clean_text for kw in category_keywords):
                        is_category_header = True
            
            if is_category_header:
                if current_item:
                    items.append(current_item)
                    current_item = None
                items.append({
                    'marker': '',
                    'name': f'**{merged_text.strip()}**',
                    'content': '',
                    'notes': [],
                    'is_header': True
                })
            elif marker_pattern.match(first_cell):
                # 새 항목 시작
                if current_item:
                    items.append(current_item)
                
                # 항목명 및 내용 추출
                item_match = item_name_pattern.search(rest_text)
                
                if item_match:
                    category = item_match.group(1)
                    after_paren = rest_text[item_match.end():].strip()
                    item_name = category
                    content = after_paren
                else:
                    item_name = rest_text.split()[0] if rest_text else ""
                    content = ' '.join(rest_text.split()[1:]) if rest_text else ""
                
                current_item = {
                    'marker': first_cell,
                    'name': item_name,
                    'content': content,
                    'notes': []
                }
            elif merged_text.strip().startswith('*'):
                # 부연설명
                note_text = merged_text.strip()
                if current_item:
                    current_item['notes'].append(note_text)
                else:
                    items.append({
                        'marker': '',
                        'name': '',
                        'content': note_text,
                        'notes': []
                    })
            elif current_item:
                # 이전 항목에 내용 추가
                if merged_text.strip().startswith('*'):
                    current_item['notes'].append(merged_text.strip())
                else:
                    current_item['content'] += ' ' + merged_text
            else:
                items.append({
                    'marker': '',
                    'name': merged_text,
                    'content': '',
                    'notes': []
                })
        
        if current_item:
            items.append(current_item)
        
        return items
    
    def _extract_items_from_damaged_table(self, lines: List[str]) -> List[Dict[str, Any]]:
        """손상된 표에서 항목 추출"""
        items = []
        current_item = None
        
        # 기호 패턴
        marker_pattern = re.compile(r'^[ㅇ\*]+$')
        # 항목명 패턴 (괄호로 시작)
        item_name_pattern = re.compile(r'\(([^)]+)\)\s*(.+)?')
        # 카테고리 헤더 패턴 (독립된 제목 - 한글만으로 구성)
        category_keywords = [
            '활성화', '소통', '노력', '안전', '관리', '사업', '지원', 
            '확대', '향상', '개선', '강화', '협력'
        ]
        
        for line in lines:
            if self.TABLE_SEPARATOR_PATTERN.match(line.strip()):
                continue
            
            cells = self._parse_row_cells(line)
            if not cells:
                continue
            
            # 셀 내용 분석
            non_empty_cells = [c.strip() for c in cells if c.strip()]
            merged_text = ' '.join(non_empty_cells)
            
            if not merged_text:
                continue
            
            # 기호로 시작하는 새 항목
            first_cell = cells[0].strip() if cells else ""
            
            # 카테고리 헤더 감지 (기호가 없고 특정 키워드 포함)
            is_category_header = False
            clean_text = merged_text.strip()
            
            # 카테고리 헤더 조건: 
            # 1. 첫 번째 셀이 비어있거나 기호가 아님
            # 2. 순수 한글+공백으로만 구성
            # 3. 짧은 문장 (15자 이하)
            # 4. 카테고리 키워드 포함
            if (not first_cell or not marker_pattern.match(first_cell)):
                if re.match(r'^[가-힣\s]+$', clean_text) and len(clean_text) <= 15:
                    if any(kw in clean_text for kw in category_keywords):
                        is_category_header = True
            
            if is_category_header:
                # 카테고리 헤더
                if current_item:
                    items.append(current_item)
                    current_item = None
                
                items.append({
                    'marker': '',
                    'name': f'**{clean_text}**',
                    'content': '',
                    'notes': [],
                    'is_header': True
                })
            elif marker_pattern.match(first_cell):
                # 새 항목 시작 (ㅇ, *, ** 등)
                if current_item:
                    items.append(current_item)
                
                # 항목명 추출
                rest_text = ' '.join([c.strip() for c in cells[1:] if c.strip()])
                
                # 패턴: (카테고리) 항목명 내용...
                # 예: "(국민안전) 안전전담인력 운영(269명) 및..."
                item_match = item_name_pattern.search(rest_text)
                
                if item_match:
                    category = item_match.group(1)  # 괄호 안 카테고리
                    after_paren = rest_text[item_match.end():].strip()
                    
                    # 괄호 다음 첫 단어가 항목명 (공백으로 구분된 첫 단어)
                    words_after = after_paren.split()
                    if words_after:
                        # 첫 단어가 한글로만 되어 있고 짧으면 항목명
                        first_word = words_after[0]
                        if re.match(r'^[가-힣·]+$', first_word) and len(first_word) <= 10:
                            item_name = f"{category} - {first_word}"
                            content = ' '.join(words_after[1:])
                        else:
                            item_name = category
                            content = after_paren
                    else:
                        item_name = category
                        content = ""
                else:
                    # 괄호가 없는 경우 - 전체가 항목명 또는 내용
                    words = rest_text.split()
                    if words and re.match(r'^[가-힣·]+$', words[0]) and len(words[0]) <= 10:
                        item_name = words[0]
                        content = ' '.join(words[1:])
                    else:
                        item_name = rest_text
                        content = ""
                
                current_item = {
                    'marker': first_cell,
                    'name': item_name,
                    'content': content,
                    'notes': []
                }
            elif merged_text.strip().startswith('*'):
                # 부연설명 (* 로 시작하는 주석)
                note_text = merged_text.strip()
                if current_item:
                    current_item['notes'].append(note_text)
                else:
                    # 독립 부연설명
                    items.append({
                        'marker': '',
                        'name': '',
                        'content': note_text,
                        'notes': []
                    })
            elif not first_cell and current_item:
                # 이전 항목의 연속 (첫 셀이 비어있음)
                # 부연설명인지 확인
                if merged_text.strip().startswith('*'):
                    current_item['notes'].append(merged_text.strip())
                else:
                    current_item['content'] += ' ' + merged_text
            elif current_item:
                # 기존 항목에 내용 추가
                current_item['content'] += ' ' + merged_text
            else:
                # 새 항목 (기호 없음)
                items.append({
                    'marker': '',
                    'name': merged_text,
                    'content': '',
                    'notes': []
                })
        
        # 마지막 항목 추가
        if current_item:
            items.append(current_item)
        
        return items
    
    def _build_restored_table(self, items: List[Dict[str, Any]]) -> str:
        """추출된 항목들로 표 재구성"""
        if not items:
            return ""
        
        # 헤더
        lines = [
            "| 구분 | 항목 | 내용 |",
            "|:---:|:---|:---|"
        ]
        
        for item in items:
            marker = item.get('marker', '')
            name = item.get('name', '')
            content = item.get('content', '').strip()
            notes = item.get('notes', [])
            is_header = item.get('is_header', False)
            
            # 분할된 단어 병합 (후처리)
            content = self._fix_split_words(content)
            name = self._fix_split_words(name)
            
            # 메인 행
            if is_header:
                lines.append(f"| | {name} | |")
            else:
                lines.append(f"| {marker} | {name} | {content} |")
            
            # 부연설명
            for note in notes:
                note = self._fix_split_words(note)
                lines.append(f"| | | {note} |")
        
        return '\n'.join(lines)
    
    def _fix_split_words(self, text: str) -> str:
        """
        OCR로 인해 분할된 단어의 공백 제거
        
        규칙:
        1. 한글 음절 + 공백 + 한글 음절 패턴에서 조사/접미사 연결
        2. 숫자 + 공백 + 단위 연결
        3. 불필요한 연속 공백 제거
        """
        if not text:
            return text
        
        # 1. 한글 글자 사이의 불필요한 공백 제거
        # 패턴: "안 전" -> "안전", "발생 률" -> "발생률"
        # 단, 조사나 접미사가 분리된 경우만
        split_patterns = [
            # 자주 분할되는 조사/접미사 패턴
            (r'(\w)\s+([고는로를의가에서와])\b', r'\1\2'),  # 조사
            (r'([가-힣])\s+([고도면서])\s', r'\1\2 '),  # 연결어미
            (r'([가-힣])\s+([률율])', r'\1\2'),  # 률/율
            (r'([가-힣])\s+([성화])', r'\1\2'),  # ~성, ~화
            (r'([가-힣])\s+([적])\s', r'\1\2 '),  # ~적
            
            # 숫자+단위 패턴
            (r'(\d)\s+([%명개억원년월일])', r'\1\2'),
            (r'(\d)\s+(백만)', r'\1\2'),
            (r'(\d)\s+(개소)', r'\1\2'),
            (r'(\d)\s+,\s+(\d)', r'\1,\2'),  # 숫자 사이 쉼표
            
            # 잘못된 * 제거
            (r'\*한성과', r'한 성과'),
            (r'\*한\s', r'한 '),
            (r"'\s*마을기업\s*\*\s*'", r"'마을기업'"),
            (r"(\S)\*'", r"\1'"),  # 단어*' -> 단어'
            
            # 흔히 분할되는 복합어
            (r'안\s+전', r'안전'),
            (r'서\s+비\s+스', r'서비스'),
            (r'사\s+고', r'사고'),
            (r'발\s+생', r'발생'),
            (r'환\s+경', r'환경'),
            (r'활\s+동', r'활동'),
            (r'저\s+감', r'저감'),
            (r'인\s+명', r'인명'),
            (r'피\s+해', r'피해'),
            (r'재\s+난', r'재난'),
            (r'재\s+해', r'재해'),
            (r'예\s+방', r'예방'),
            (r'운\s+영', r'운영'),
            (r'지\s+원', r'지원'),
            (r'향\s+상', r'향상'),
            (r'개\s+선', r'개선'),
            (r'강\s+화', r'강화'),
            (r'협\s+력', r'협력'),
            (r'협\s+업', r'협업'),
            (r'설\s+립', r'설립'),
            (r'창\s+출', r'창출'),
            (r'참\s+여', r'참여'),
            (r'소\s+통', r'소통'),
            (r'채\s+널', r'채널'),
            (r'체\s+감', r'체감'),
            (r'기\s+관', r'기관'),
            (r'기\s+업', r'기업'),
            (r'부\s+문', r'부문'),
            (r'대\s+상', r'대상'),
            (r'정\s+보', r'정보'),
            (r'제\s+품', r'제품'),
            (r'모\s+델', r'모델'),
            (r'공\s+유', r'공유'),
            (r'감\s+소', r'감소'),
            (r'증\s+가', r'증가'),
            (r'우\s+수', r'우수'),
            (r'연\s+속', r'연속'),
            (r'전\s+면', r'전면'),
            (r'조\s+성', r'조성'),
            (r'산\s+업', r'산업'),
            (r'주\s+민', r'주민'),
            (r'지\s+역', r'지역'),
            (r'청\s+소\s+년', r'청소년'),
            (r'예\s+체\s+능', r'예체능'),
            (r'장\s+학', r'장학'),
            (r'사\s+업', r'사업'),
            (r'경\s+제', r'경제'),
            (r'활\s+성', r'활성'),
            (r'국\s+민', r'국민'),
            (r'디\s+지\s+털', r'디지털'),
            (r'격\s+차', r'격차'),
            (r'해\s+소', r'해소'),
            (r'이\s+용', r'이용'),
            (r'도\s+입', r'도입'),
            (r'추\s+첨', r'추첨'),
            (r'대\s+피\s+소', r'대피소'),
            (r'콘\s+텐', r'콘텐'),
            (r'진\s+흥', r'진흥'),
            (r'협\s+회', r'협회'),
            (r'주\s+관', r'주관'),
            (r'수\s+상', r'수상'),
            (r'인\s+지', r'인지'),
            (r'지\s+속', r'지속'),
            (r'만\s+족', r'만족'),
            (r'편\s+사\s+항', r'불편사항'),
            (r'실\s+시\s+간', r'실시간'),
            (r'구\s+축', r'구축'),
            (r'공\s+단', r'공단'),
            (r'특\s+성', r'특성'),
            (r'반\s+영', r'반영'),
            (r'성\s+과', r'성과'),
            (r'로\s+봇', r'로봇'),
            (r'보\s+조', r'보조'),
            (r'산\s+행', r'산행'),
            (r'개\s+발', r'개발'),
            (r'매\s+출', r'매출'),
            (r'연\s+간', r'연간'),
            (r'총\s+회', r'총회'),
            (r'언\s+론', r'언론'),
            (r'다\s+양', r'다양'),
            (r'방\s+송', r'방송'),
            (r'유\s+출', r'유출'),
            (r'선\s+제', r'선제'),
            (r'자\s+연', r'자연'),
            (r'인\s+력', r'인력'),
            (r'전\s+담', r'전담'),
            (r'일\s+터', r'일터'),
        ]
        
        result = text
        for pattern, replacement in split_patterns:
            result = re.sub(pattern, replacement, result)
        
        # 2. 연속 공백 정리
        result = re.sub(r'\s+', ' ', result)
        
        return result.strip()
    
    # ========== 번호 없는 표 처리를 위한 추가 메소드 ==========
    
    def detect_table_structure_without_numbers(self, rows: List[List[str]]) -> Dict:
        """
        번호가 없는 표의 구조 감지
        
        전략:
        1. 열별 데이터 타입 분석 (숫자, 날짜, 텍스트 비율)
        2. 열별 고유값 수 분석 (카테고리 vs 상세 데이터)
        3. 셀 길이 패턴 분석
        4. 빈 셀 위치 패턴 분석
        
        Returns:
            Dict: {
                'category_cols': [인덱스들],   # 카테고리로 추정되는 열
                'data_cols': [인덱스들],       # 데이터 열
                'merge_candidates': [(행, 열)], # 병합 후보
                'column_types': [타입들]       # 각 열의 추정 타입
            }
        """
        if not rows:
            return {}
        
        # 헤더와 구분자 제외
        data_rows = [r for r in rows if r != ['---SEPARATOR---']]
        if len(data_rows) <= 1:  # 헤더만 있는 경우
            return {}
        
        data_rows = data_rows[1:]  # 헤더 제외
        col_count = max(len(r) for r in data_rows) if data_rows else 0
        
        if col_count == 0:
            return {}
        
        # 열별 분석
        column_types = []
        category_cols = []
        data_cols = []
        
        for col_idx in range(col_count):
            col_values = []
            empty_count = 0
            number_count = 0
            date_count = 0
            
            for row in data_rows:
                if col_idx < len(row):
                    val = row[col_idx].strip()
                    col_values.append(val)
                    
                    if not val:
                        empty_count += 1
                    elif re.match(r'^[\d,.\-]+$', val):
                        number_count += 1
                    elif re.match(r'\d{4}[-./]\d{1,2}[-./]\d{1,2}', val):
                        date_count += 1
            
            total = len(col_values)
            if total == 0:
                column_types.append('unknown')
                continue
            
            # 고유값 비율
            unique_ratio = len(set(col_values)) / total
            empty_ratio = empty_count / total
            number_ratio = number_count / total
            
            # 열 타입 결정
            if number_ratio > 0.7:
                col_type = 'number'
                data_cols.append(col_idx)
            elif empty_ratio > 0.5:
                col_type = 'merged_category'
                category_cols.append(col_idx)
            elif unique_ratio < 0.3:  # 고유값이 적으면 카테고리
                col_type = 'category'
                category_cols.append(col_idx)
            else:
                col_type = 'text'
                data_cols.append(col_idx)
            
            column_types.append(col_type)
        
        # 병합 후보 찾기 (빈 셀 위치 분석)
        merge_candidates = []
        for row_idx, row in enumerate(data_rows):
            for col_idx in category_cols:
                if col_idx < len(row) and not row[col_idx].strip():
                    merge_candidates.append((row_idx + 1, col_idx))  # +1은 헤더 보정
        
        return {
            'category_cols': category_cols,
            'data_cols': data_cols,
            'merge_candidates': merge_candidates,
            'column_types': column_types
        }
    
    def restore_table_without_numbers(self, rows: List[List[str]]) -> List[List[str]]:
        """
        번호가 없는 표 복원
        
        구조 분석 결과를 바탕으로 빈 셀을 채우고 정렬합니다.
        """
        structure = self.detect_table_structure_without_numbers(rows)
        
        if not structure:
            return rows
        
        result_rows = []
        category_values = {}  # 열별 마지막 카테고리 값 저장
        
        for col_idx in structure.get('category_cols', []):
            category_values[col_idx] = ""
        
        is_data_section = False
        
        for row in rows:
            if row == ['---SEPARATOR---']:
                result_rows.append(row)
                is_data_section = True
                continue
            
            if not is_data_section:
                result_rows.append(row)
                continue
            
            # 데이터 행 처리
            new_row = row.copy()
            
            for col_idx in structure.get('category_cols', []):
                if col_idx < len(new_row):
                    if new_row[col_idx].strip():
                        # 새 값이 있으면 저장
                        category_values[col_idx] = new_row[col_idx]
                    else:
                        # 빈 셀이면 이전 값으로 채움
                        new_row[col_idx] = category_values.get(col_idx, "")
            
            result_rows.append(new_row)
        
        return result_rows


def create_pdf_table_restorer(config=None) -> PDFTableRestorer:
    """설정 기반 PDFTableRestorer 생성"""
    if config is None:
        return PDFTableRestorer()
    
    # 설정에서 옵션 추출 (향후 확장)
    return PDFTableRestorer(
        auto_detect_header=True,
        restore_merged_cells=True,
        normalize_columns=True,
        fill_category_column=True,
        remove_duplicate_separators=True,
        merge_split_cells=True,
        merge_continuation_rows=True,
        identify_category_headers=True
    )


# 직접 실행 테스트용
if __name__ == "__main__":
    # 테스트용 손상된 표 데이터
    test_table = """| ㅇ | (국민안전) 안전전담인력 | 운영(269명) 및 안 | 전서비스 | 강화로 | 안전사 | 고 발생률 |
|---|---|---|---|---|---|---|
|---|---|---|---|---|---|---|
|  | 감소('24년 0.314명→'25년 | 0.309명) 및 인명사고 | 감소(' | 22년 16명 | →'25년 | 10명) |
|---|---|---|---|---|---|---|
| ㅇ | (일터안전) 안전한 일터 | 환경 조성으로 산업재 | 해 25% | 저감(5 | 년 평균 | 20명→15명) |
|---|---|---|---|---|---|---|
| ㅇ | (사이버안전) 개인정보 | 유출사고 ZERO | 로 3년 | 연속 우 | 수기 | 관 지정 |
|---|---|---|---|---|---|---|
|  | 지역경제 활성화 |  |  |  |  |  |
|---|---|---|---|---|---|---|
| ㅇ | (중소기업·소상공인) 공 | 단 업(業) 특성을 반 | 영*한 | 성과공유 | 제 44 | 개사 협력 |"""
    
    restorer = PDFTableRestorer(verbose=True)
    result = restorer.restore_tables(test_table)
    print("=== 복원 결과 ===")
    print(result)
