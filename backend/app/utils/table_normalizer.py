"""
표 정규화 모듈

마크다운 표의 복잡한 구조(다중 헤더, 계층적 행 구조, 빈 셀)를
LLM이 이해하기 쉬운 정규화된 형태로 변환합니다.

주요 기능:
- 다중 헤더 병합 (Header Flattening)
- 계층 구조 평탄화 (Hierarchy Flattening)
- 빈 셀 처리 (Empty Cell Filling)
- 열 수 정규화 (Column Normalization)
"""
import re
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class NormalizationResult:
    """정규화 결과"""
    original_table: str
    normalized_table: str
    changes_made: List[str]
    header_count: int
    data_row_count: int


class TableNormalizer:
    """
    마크다운 표 정규화기
    
    복잡한 표 구조를 LLM 분석에 적합한 형태로 변환합니다.
    """
    
    # 장식 문자 패턴 (한글 문서에서 자주 사용)
    DECORATION_CHARS = re.compile(r'^[\s]*[ㅇㆍ\-※○●◎◇◆□■△▲▽▼→←↑↓\*·•]+[\s]*')
    
    # 마크다운 표 패턴
    TABLE_PATTERN = re.compile(r'(\|[^\n]+\|\n)+', re.MULTILINE)
    TABLE_SEPARATOR = re.compile(r'^\|[\s\-:|\s]+\|$')
    
    def __init__(
        self,
        flatten_headers: bool = True,
        flatten_hierarchy: bool = True,
        hierarchy_separator: str = " > ",
        fill_empty_cells: bool = True,
        empty_cell_strategy: str = "dash",
        normalize_column_count: bool = True,
        remove_decoration_chars: bool = True,
        min_data_rows: int = 1,
        max_header_rows: int = 3
    ):
        """
        Args:
            flatten_headers: 다중 헤더 병합 여부
            flatten_hierarchy: 계층 구조 평탄화 여부
            hierarchy_separator: 계층 구분자 (기본: " > ")
            fill_empty_cells: 빈 셀 채우기 여부
            empty_cell_strategy: 빈 셀 처리 전략 (inherit, dash, null)
            normalize_column_count: 열 수 정규화 여부
            remove_decoration_chars: 장식 문자 제거 여부
            min_data_rows: 최소 데이터 행 수
            max_header_rows: 최대 헤더 행 수
        """
        self.flatten_headers = flatten_headers
        self.flatten_hierarchy = flatten_hierarchy
        self.hierarchy_separator = hierarchy_separator
        self.fill_empty_cells = fill_empty_cells
        self.empty_cell_strategy = empty_cell_strategy
        self.normalize_column_count = normalize_column_count
        self.remove_decoration_chars = remove_decoration_chars
        self.min_data_rows = min_data_rows
        self.max_header_rows = max_header_rows
    
    def normalize_text(self, text: str) -> str:
        """
        텍스트 내의 모든 마크다운 표를 정규화합니다.
        
        Args:
            text: 마크다운 표가 포함된 텍스트
            
        Returns:
            정규화된 표가 포함된 텍스트
        """
        # 표 주석 패턴 (<!-- 표 N -->)
        table_comment_pattern = re.compile(r'(<!--\s*표\s*\d+\s*-->)\s*\n*')
        
        # 텍스트를 표 단위로 분리
        parts = []
        last_end = 0
        
        for match in table_comment_pattern.finditer(text):
            # 표 주석 이전 텍스트
            if match.start() > last_end:
                parts.append(text[last_end:match.start()])
            
            # 표 주석
            comment = match.group(1)
            comment_end = match.end()
            
            # 표 주석 이후 마크다운 표 찾기
            remaining = text[comment_end:]
            table_match = self._find_markdown_table(remaining)
            
            if table_match:
                table_text = table_match.group(0)
                table_end = comment_end + table_match.end()
                
                # 표 정규화
                try:
                    result = self.normalize_table(table_text)
                    parts.append(comment + "\n\n" + result.normalized_table)
                except Exception as e:
                    # 정규화 실패 시 원본 유지
                    parts.append(comment + "\n\n" + table_text)
                
                last_end = table_end
            else:
                parts.append(comment)
                last_end = comment_end
        
        # 나머지 텍스트
        if last_end < len(text):
            parts.append(text[last_end:])
        
        return "".join(parts)
    
    def normalize_table(self, table_text: str) -> NormalizationResult:
        """
        단일 마크다운 표를 정규화합니다.
        
        Args:
            table_text: 마크다운 표 문자열
            
        Returns:
            NormalizationResult 객체
        """
        changes = []
        
        # 1. 마크다운 표 파싱
        rows = self._parse_markdown_table(table_text)
        if not rows:
            return NormalizationResult(
                original_table=table_text,
                normalized_table=table_text,
                changes_made=[],
                header_count=0,
                data_row_count=0
            )
        
        # 2. 헤더 행과 데이터 행 분리
        header_rows, separator_idx, data_rows = self._detect_headers(rows)
        
        # 3. 장식 문자 제거
        if self.remove_decoration_chars:
            data_rows = self._remove_decoration_chars(data_rows)
            changes.append("장식 문자 제거")
        
        # 4. 열 수 정규화
        if self.normalize_column_count:
            all_rows = header_rows + data_rows
            max_cols = max(len(row) for row in all_rows) if all_rows else 0
            header_rows = self._normalize_columns(header_rows, max_cols)
            data_rows = self._normalize_columns(data_rows, max_cols)
            changes.append(f"열 수 정규화 ({max_cols}열)")
        
        # 5. 헤더 병합
        flat_header = []
        if self.flatten_headers and header_rows:
            flat_header = self._flatten_headers(header_rows)
            changes.append("다중 헤더 병합")
        elif header_rows:
            flat_header = header_rows[-1] if header_rows else []
        
        # 6. 계층 구조 평탄화
        if self.flatten_hierarchy and data_rows:
            data_rows = self._flatten_hierarchy(data_rows)
            changes.append("계층 구조 평탄화")
        
        # 7. 빈 셀 처리
        if self.fill_empty_cells and data_rows:
            data_rows = self._fill_empty_cells(data_rows)
            changes.append(f"빈 셀 처리 ({self.empty_cell_strategy})")
        
        # 8. 마크다운으로 재구성
        normalized_text = self._to_markdown(flat_header, data_rows)
        
        return NormalizationResult(
            original_table=table_text,
            normalized_table=normalized_text,
            changes_made=changes,
            header_count=1 if flat_header else 0,
            data_row_count=len(data_rows)
        )
    
    def _find_markdown_table(self, text: str) -> Optional[re.Match]:
        """텍스트에서 마크다운 표를 찾습니다."""
        # 연속된 | 로 시작하는 줄들을 표로 인식
        pattern = re.compile(r'(\|[^\n]*\|\n)+', re.MULTILINE)
        return pattern.search(text)
    
    def _parse_markdown_table(self, table_text: str) -> List[List[str]]:
        """마크다운 표를 2D 배열로 파싱합니다."""
        rows = []
        lines = table_text.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            if not line or not line.startswith('|'):
                continue
            
            # 구분선 스킵 (|---|---|)
            if self.TABLE_SEPARATOR.match(line):
                continue
            
            # 셀 분리
            cells = line.split('|')
            # 첫/마지막 빈 셀 제거 (| col1 | col2 | 형식)
            if cells and cells[0].strip() == '':
                cells = cells[1:]
            if cells and cells[-1].strip() == '':
                cells = cells[:-1]
            
            cells = [cell.strip() for cell in cells]
            if cells:
                rows.append(cells)
        
        return rows
    
    def _detect_headers(self, rows: List[List[str]]) -> Tuple[List[List[str]], int, List[List[str]]]:
        """
        헤더 행과 데이터 행을 분리합니다.
        
        휴리스틱:
        - 처음 몇 행에서 빈 셀이 많으면 헤더로 간주
        - 숫자가 많이 포함된 행부터 데이터로 간주
        """
        if not rows:
            return [], -1, []
        
        header_rows = []
        data_start = 0
        
        for i, row in enumerate(rows):
            if i >= self.max_header_rows:
                break
            
            # 숫자 비율 계산
            numeric_ratio = self._calculate_numeric_ratio(row)
            
            # 숫자가 50% 이상이면 데이터 행으로 간주
            if numeric_ratio >= 0.5:
                data_start = i
                break
            
            header_rows.append(row)
            data_start = i + 1
        
        data_rows = rows[data_start:]
        
        return header_rows, data_start, data_rows
    
    def _calculate_numeric_ratio(self, row: List[str]) -> float:
        """행에서 숫자 셀의 비율을 계산합니다."""
        if not row:
            return 0.0
        
        numeric_count = 0
        non_empty_count = 0
        
        for cell in row:
            cell = cell.strip()
            if not cell:
                continue
            non_empty_count += 1
            
            # 숫자 패턴 (정수, 소수, 백분율, 괄호 포함)
            cleaned = re.sub(r'[,\s%△▲↑↓\(\)\-]', '', cell)
            if cleaned and (cleaned.replace('.', '').isdigit() or 
                           cleaned.lstrip('-').replace('.', '').isdigit()):
                numeric_count += 1
        
        return numeric_count / non_empty_count if non_empty_count > 0 else 0.0
    
    def _flatten_headers(self, header_rows: List[List[str]]) -> List[str]:
        """다중 헤더 행을 단일 헤더로 병합합니다."""
        if not header_rows:
            return []
        
        max_cols = max(len(row) for row in header_rows)
        flattened = []
        
        # 각 열마다 위에서 아래로 값을 수집
        for col_idx in range(max_cols):
            parts = []
            for row in header_rows:
                if col_idx < len(row):
                    cell = row[col_idx].strip()
                    # 장식 문자 제거
                    cell = self.DECORATION_CHARS.sub('', cell).strip()
                    if cell and cell not in parts:
                        parts.append(cell)
            
            if parts:
                flattened.append("_".join(parts))
            else:
                flattened.append(f"col_{col_idx + 1}")
        
        return flattened
    
    def _flatten_hierarchy(self, rows: List[List[str]]) -> List[List[str]]:
        """계층 구조를 평탄화합니다."""
        if not rows:
            return []
        
        result = []
        hierarchy_stack = []
        
        for row in rows:
            # 빈 셀 수로 계층 레벨 판단
            level = 0
            first_value_idx = 0
            
            for i, cell in enumerate(row):
                if cell.strip():
                    first_value_idx = i
                    break
                level += 1
            
            # 스택을 현재 레벨로 조정
            hierarchy_stack = hierarchy_stack[:level]
            
            # 첫 번째 비어있지 않은 값 찾기
            first_value = ""
            for cell in row:
                cell_stripped = cell.strip()
                if cell_stripped:
                    # 장식 문자 제거
                    first_value = self.DECORATION_CHARS.sub('', cell_stripped).strip()
                    break
            
            if first_value:
                hierarchy_stack.append(first_value)
            
            # 전체 경로로 첫 번째 열 생성
            full_path = self.hierarchy_separator.join(hierarchy_stack) if hierarchy_stack else ""
            
            # 데이터 열 추출 (첫 번째 값 이후의 셀들)
            data_cells = []
            found_first = False
            for cell in row:
                if not found_first:
                    if cell.strip():
                        found_first = True
                    continue
                data_cells.append(cell)
            
            # 새로운 행 생성
            new_row = [full_path] + data_cells
            result.append(new_row)
        
        return result
    
    def _fill_empty_cells(self, rows: List[List[str]]) -> List[List[str]]:
        """빈 셀을 처리합니다."""
        if not rows:
            return []
        
        result = []
        prev_row = None
        
        for row in rows:
            new_row = []
            for i, cell in enumerate(row):
                cell_stripped = cell.strip()
                if not cell_stripped:
                    if self.empty_cell_strategy == "inherit" and prev_row and i < len(prev_row):
                        new_row.append(prev_row[i])
                    elif self.empty_cell_strategy == "dash":
                        new_row.append("-")
                    elif self.empty_cell_strategy == "null":
                        new_row.append("NULL")
                    else:
                        new_row.append("")
                else:
                    new_row.append(cell_stripped)
            
            result.append(new_row)
            prev_row = new_row
        
        return result
    
    def _normalize_columns(self, rows: List[List[str]], target_cols: int) -> List[List[str]]:
        """모든 행의 열 수를 동일하게 맞춥니다."""
        result = []
        for row in rows:
            if len(row) < target_cols:
                row = row + [""] * (target_cols - len(row))
            elif len(row) > target_cols:
                row = row[:target_cols]
            result.append(row)
        return result
    
    def _remove_decoration_chars(self, rows: List[List[str]]) -> List[List[str]]:
        """첫 번째 열의 장식 문자를 제거합니다."""
        result = []
        for row in rows:
            if row:
                new_row = row.copy()
                # 첫 번째 비어있지 않은 셀에서 장식 문자 제거
                for i, cell in enumerate(new_row):
                    if cell.strip():
                        new_row[i] = self.DECORATION_CHARS.sub('', cell).strip()
                        break
                result.append(new_row)
            else:
                result.append(row)
        return result
    
    def _to_markdown(self, header: List[str], data_rows: List[List[str]]) -> str:
        """정규화된 데이터를 마크다운 표로 변환합니다."""
        if not header and not data_rows:
            return ""
        
        lines = []
        
        # 열 수 결정
        max_cols = max(
            len(header) if header else 0,
            max(len(row) for row in data_rows) if data_rows else 0
        )
        
        if max_cols == 0:
            return ""
        
        # 헤더 행
        if header:
            header_padded = header + [""] * (max_cols - len(header))
            lines.append("| " + " | ".join(header_padded) + " |")
            # 구분선
            lines.append("|" + "|".join(["---"] * max_cols) + "|")
        
        # 데이터 행
        for row in data_rows:
            row_padded = row + [""] * (max_cols - len(row))
            # 파이프 문자 이스케이프
            escaped = [cell.replace("|", "\\|") for cell in row_padded]
            lines.append("| " + " | ".join(escaped) + " |")
        
        return "\n".join(lines)


def create_normalizer_from_config(config) -> TableNormalizer:
    """설정 객체로부터 TableNormalizer 인스턴스를 생성합니다."""
    settings = config.table_normalization
    return TableNormalizer(
        flatten_headers=settings.flatten_headers,
        flatten_hierarchy=settings.flatten_hierarchy,
        hierarchy_separator=settings.hierarchy_separator,
        fill_empty_cells=settings.fill_empty_cells,
        empty_cell_strategy=settings.empty_cell_strategy,
        normalize_column_count=settings.normalize_column_count,
        remove_decoration_chars=settings.remove_decoration_chars,
        min_data_rows=settings.min_data_rows,
        max_header_rows=settings.max_header_rows
    )
