"""
표 구성기 (Table Builder)

최종 표 구조를 구성하고 다양한 형식으로 출력하는 모듈입니다.

주요 기능:
1. 메타데이터와 텍스트로 최종 표 구성
2. 표 구조 유효성 검증
3. Markdown, HTML, JSON 형식 출력
4. 병합 셀 표현

사용 예시:
    from app.table_recovery import TableBuilder, Table
    
    builder = TableBuilder()
    
    # 표 구성
    table = builder.build_table(metadata, cell_texts)
    
    # 출력
    markdown = table.to_markdown()
    html = table.to_html()
    json_data = table.to_json()
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Any
import json
import html as html_module

from .coordinate_manager import TableStructureMetadata


@dataclass
class TableCell:
    """
    최종 표 셀
    
    Attributes:
        row: 행 인덱스 (0-based)
        col: 열 인덱스 (0-based)
        rowspan: 행 병합 수
        colspan: 열 병합 수
        text: 셀 텍스트
        bbox: 셀 경계 (선택)
        is_header: 헤더 셀 여부
    """
    row: int
    col: int
    rowspan: int
    colspan: int
    text: str
    bbox: Optional[Tuple[float, float, float, float]] = None
    is_header: bool = False
    
    @property
    def is_merged(self) -> bool:
        """병합 셀 여부"""
        return self.rowspan > 1 or self.colspan > 1
    
    @property
    def end_row(self) -> int:
        """종료 행 인덱스"""
        return self.row + self.rowspan - 1
    
    @property
    def end_col(self) -> int:
        """종료 열 인덱스"""
        return self.col + self.colspan - 1
    
    def contains(self, row: int, col: int) -> bool:
        """특정 위치가 이 셀에 포함되는지"""
        return (self.row <= row <= self.end_row and
                self.col <= col <= self.end_col)
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        result = {
            'row': self.row,
            'col': self.col,
            'rowspan': self.rowspan,
            'colspan': self.colspan,
            'text': self.text,
            'is_header': self.is_header
        }
        if self.bbox:
            result['bbox'] = list(self.bbox)
        return result
    
    @classmethod
    def from_dict(cls, data: dict) -> 'TableCell':
        """딕셔너리에서 생성"""
        return cls(
            row=data['row'],
            col=data['col'],
            rowspan=data.get('rowspan', 1),
            colspan=data.get('colspan', 1),
            text=data.get('text', ''),
            bbox=tuple(data['bbox']) if 'bbox' in data else None,
            is_header=data.get('is_header', False)
        )


@dataclass
class Table:
    """
    복원된 표
    
    Attributes:
        rows: 총 행 수
        cols: 총 열 수
        cells: 셀 목록
        header_rows: 헤더 행 수
        title: 표 제목 (선택)
        _title_cleaned: 제목 행 정제 완료 플래그
    """
    rows: int
    cols: int
    cells: List[TableCell] = field(default_factory=list)
    header_rows: int = 1
    title: Optional[str] = None
    _title_cleaned: bool = field(default=False, repr=False)
    
    @property
    def cell_count(self) -> int:
        """셀 수"""
        return len(self.cells)
    
    @property
    def merged_cell_count(self) -> int:
        """병합 셀 수"""
        return sum(1 for c in self.cells if c.is_merged)
    
    def get_cell(self, row: int, col: int) -> Optional[TableCell]:
        """특정 위치의 셀 반환"""
        for cell in self.cells:
            if cell.contains(row, col):
                return cell
        return None
    
    def get_row(self, row_idx: int) -> List[TableCell]:
        """특정 행의 모든 셀 반환"""
        return [c for c in self.cells if c.row == row_idx]
    
    def get_column(self, col_idx: int) -> List[TableCell]:
        """특정 열의 모든 셀 반환"""
        return [c for c in self.cells if c.col == col_idx]
    
    def to_2d_grid(self) -> List[List[str]]:
        """2D 텍스트 그리드로 변환"""
        grid = [['' for _ in range(self.cols)] for _ in range(self.rows)]
        
        for cell in self.cells:
            grid[cell.row][cell.col] = cell.text
        
        return grid
    
    def to_markdown(self, include_title: bool = True) -> str:
        """
        마크다운 표로 변환
        
        Note: 마크다운은 병합 셀을 직접 지원하지 않음
        병합 셀은 첫 번째 위치에만 텍스트가 표시됨
        """
        lines = []
        
        # 제목
        if include_title and self.title:
            lines.append(f"**{self.title}**")
            lines.append("")
        
        # 2D 그리드 생성
        grid = self.to_2d_grid()
        
        # 헤더 행
        if self.rows > 0:
            header = '| ' + ' | '.join(self._escape_markdown(c) for c in grid[0]) + ' |'
            lines.append(header)
            
            # 구분선
            separator = '|' + '|'.join(['---'] * self.cols) + '|'
            lines.append(separator)
        
        # 데이터 행
        for row in grid[1:]:
            line = '| ' + ' | '.join(self._escape_markdown(c) for c in row) + ' |'
            lines.append(line)
        
        return '\n'.join(lines)
    
    def to_html(
        self, 
        include_style: bool = True,
        table_class: str = "recovered-table"
    ) -> str:
        """
        HTML 표로 변환
        
        병합 셀을 rowspan/colspan으로 정확히 표현
        """
        lines = []
        
        # 스타일
        if include_style:
            lines.append('<style>')
            lines.append(f'.{table_class} {{ border-collapse: collapse; width: 100%; }}')
            lines.append(f'.{table_class} th, .{table_class} td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}')
            lines.append(f'.{table_class} th {{ background-color: #f2f2f2; }}')
            lines.append('</style>')
        
        lines.append(f'<table class="{table_class}">')
        
        # 셀 위치 매핑
        cell_map = {}
        for cell in self.cells:
            cell_map[(cell.row, cell.col)] = cell
        
        # 이미 병합된 셀 추적
        merged = set()
        
        for row in range(self.rows):
            lines.append('  <tr>')
            
            for col in range(self.cols):
                if (row, col) in merged:
                    continue
                
                cell = cell_map.get((row, col))
                
                if cell:
                    # 병합 영역 마킹
                    for r in range(cell.row, cell.row + cell.rowspan):
                        for c in range(cell.col, cell.col + cell.colspan):
                            if (r, c) != (row, col):
                                merged.add((r, c))
                    
                    # 셀 태그 생성
                    attrs = []
                    if cell.rowspan > 1:
                        attrs.append(f'rowspan="{cell.rowspan}"')
                    if cell.colspan > 1:
                        attrs.append(f'colspan="{cell.colspan}"')
                    
                    attr_str = ' ' + ' '.join(attrs) if attrs else ''
                    tag = 'th' if row < self.header_rows else 'td'
                    text = self._escape_html(cell.text)
                    
                    lines.append(f'    <{tag}{attr_str}>{text}</{tag}>')
                else:
                    tag = 'th' if row < self.header_rows else 'td'
                    lines.append(f'    <{tag}></{tag}>')
            
            lines.append('  </tr>')
        
        lines.append('</table>')
        return '\n'.join(lines)
    
    def to_json(self) -> Dict[str, Any]:
        """JSON 형식으로 변환"""
        return {
            'rows': self.rows,
            'cols': self.cols,
            'header_rows': self.header_rows,
            'title': self.title,
            'cells': [c.to_dict() for c in self.cells],
            'grid': self.to_2d_grid()
        }
    
    def to_json_string(self, indent: int = 2) -> str:
        """JSON 문자열로 변환"""
        return json.dumps(self.to_json(), ensure_ascii=False, indent=indent)
    
    def to_csv(self, delimiter: str = ',') -> str:
        """CSV 형식으로 변환"""
        grid = self.to_2d_grid()
        lines = []
        
        for row in grid:
            # CSV 이스케이프
            escaped = []
            for cell in row:
                if delimiter in cell or '"' in cell or '\n' in cell:
                    cell = '"' + cell.replace('"', '""') + '"'
                escaped.append(cell)
            lines.append(delimiter.join(escaped))
        
        return '\n'.join(lines)
    
    def to_semantic_text(self, include_title: bool = True) -> str:
        """
        스마트 선형화: RAG/임베딩에 최적화된 선형화 텍스트로 변환
        
        표 구조를 자동 분석하여 최적의 선형화 전략을 선택합니다:
        - standard: 표준 표 (첫 행 = 헤더)
        - no_header: 헤더 없는 표 (열 의미 자동 추론)
        - hierarchical: 세로 병합 기반 계층 구조
        - row_header: 첫 열이 레이블인 표
        """
        if self.rows == 0 or self.cols == 0:
            return ""
        
        # 0. 제목 행 감지 및 정제 (제목 박스와 표가 결합된 경우)
        self._clean_title_rows()
        
        if self.rows == 0 or self.cols == 0:
            return ""
        
        # 1. 표 구조 분석
        structure_type = self._detect_table_structure()
        
        # 2. 구조에 따른 선형화 전략 선택
        if structure_type == "hierarchical":
            return self._linearize_hierarchical(include_title)
        elif structure_type == "no_header":
            return self._linearize_no_header(include_title)
        elif structure_type == "row_header":
            return self._linearize_row_header(include_title)
        else:
            return self._linearize_standard(include_title)
    
    def _clean_title_rows(self) -> None:
        """
        제목 행 감지 및 제거
        
        제목 텍스트 박스와 표가 결합된 경우, 제목 행을 식별하여 제거합니다.
        
        제목 행 패턴 (모든 조건 충족 필요):
        1. 단일 셀로 전체 열을 병합 (colspan == cols, 셀 1개)
        2. 나머지 행들의 평균 셀 개수보다 현저히 적음 (30% 미만)
        3. 수치 데이터 패턴 없음 (㎍/㎥, %, 원, 시간 등)
        """
        import re
        
        # 이미 정제된 경우 스킵
        if self._title_cleaned:
            return
        self._title_cleaned = True
        
        if self.rows < 4:  # 최소 4행 이상이어야 제목 행 분리 의미 있음
            return
        
        # 먼저 각 행의 셀 개수 분석
        row_cell_counts = []
        for row_idx in range(self.rows):
            row_cells = [c for c in self.cells if c.row == row_idx]
            row_cell_counts.append(len(row_cells))
        
        # 하위 절반 행들의 평균 셀 개수 계산 (실제 데이터 행 기준)
        # 상위 행들은 제목일 수 있으므로 하위 행들만 참조
        lower_half = row_cell_counts[len(row_cell_counts)//2:]
        if not lower_half:
            return
        data_row_avg_cells = sum(lower_half) / len(lower_half)
        
        if data_row_avg_cells < 2:  # 데이터 행도 셀이 적으면 제목 분리 불필요
            return
        
        rows_to_remove = []
        
        for row_idx in range(self.rows):
            row_cells = [c for c in self.cells if c.row == row_idx]
            
            if not row_cells:
                continue
            
            num_cells = len(row_cells)
            
            # 조건 1: 단일 셀로 전체 열 병합 (가장 엄격한 조건)
            is_single_cell_row = num_cells == 1 and row_cells[0].colspan >= self.cols - 1
            
            # 조건 2: 셀 개수가 데이터 행 평균의 30% 미만
            is_significantly_fewer_cells = num_cells < data_row_avg_cells * 0.3
            
            # 조건 3: 수치 데이터 패턴 없음
            combined_text = ' '.join(c.text.strip() for c in row_cells if c.text)
            
            # 수치/단위 데이터 패턴 (있으면 데이터 행)
            data_patterns = [
                r'\d+\s*㎍/㎥',           # 미세먼지 농도
                r'\d+\s*%',              # 퍼센트
                r'\d+\s*원',              # 금액
                r'\d+\s*시간',            # 시간
                r'①|②|③|④|⑤',           # 번호 매김
                r'\d{2,4}[-.)]\d{3,4}[-.)]\d{4}',  # 전화번호
                r'\d{4}[-./년]\d{1,2}',   # 날짜
            ]
            has_data_pattern = any(re.search(p, combined_text) for p in data_patterns)
            
            # 제목 행 조건: 단일 셀 OR (셀 개수 현저히 적음 + 데이터 패턴 없음)
            is_title_row = is_single_cell_row or (is_significantly_fewer_cells and not has_data_pattern)
            
            if is_title_row:
                rows_to_remove.append(row_idx)
                print(f"[TABLE CLEAN] 제목 행 감지: row {row_idx}, cells={num_cells}, text={combined_text[:50]}...")
            else:
                # 연속된 제목 행만 제거 (데이터 행을 만나면 즉시 중단)
                print(f"[TABLE CLEAN] 데이터 행 발견: row {row_idx}, cells={num_cells} → 제목 행 제거 중단")
                break
        
        if not rows_to_remove:
            return
        
        # 제목 행 제거 및 행 인덱스 재조정
        removed_count = len(rows_to_remove)
        
        # 제목 텍스트를 title로 저장 (옵션)
        title_texts = []
        for row_idx in rows_to_remove:
            row_cells = [c for c in self.cells if c.row == row_idx]
            title_texts.append(' '.join(c.text.strip() for c in row_cells if c.text))
        
        if title_texts and not self.title:
            self.title = ' | '.join(title_texts)
        
        # 셀 필터링 및 행 인덱스 조정
        new_cells = []
        for cell in self.cells:
            if cell.row in rows_to_remove:
                continue
            
            # 행 인덱스 조정
            new_row = cell.row - removed_count
            new_cells.append(TableCell(
                row=new_row,
                col=cell.col,
                rowspan=cell.rowspan,
                colspan=cell.colspan,
                text=cell.text,
                bbox=cell.bbox,
                is_header=cell.is_header
            ))
        
        self.cells = new_cells
        self.rows = self.rows - removed_count
        
        print(f"[TABLE CLEAN] {removed_count}개 제목 행 제거됨, 남은 행: {self.rows}")
    
    def _detect_table_structure(self) -> str:
        """
        표 구조 유형 자동 감지
        
        Returns:
            - "standard": 표준 표 (첫 행 = 헤더)
            - "no_header": 헤더 없는 표
            - "row_header": 첫 열이 레이블 (전치된 표)
            - "hierarchical": 병합 셀 기반 계층 구조
        """
        import re
        
        # 세로 병합 셀 확인
        rowspan_cells = [c for c in self.cells if c.rowspan > 1]
        has_significant_rowspan = any(c.rowspan >= 2 for c in rowspan_cells)
        
        # 첫 열에 세로 병합이 있는지 확인 (계층적 표의 특징)
        first_col_rowspan = any(c.col == 0 and c.rowspan > 1 for c in self.cells)
        
        # 첫 행 헤더 여부 감지
        has_header = self._detect_has_header()
        
        # 구조 판단
        if first_col_rowspan and not has_header:
            return "hierarchical"
        elif not has_header:
            # 첫 열이 레이블인지 확인 (모든 값이 짧고 유니크한 텍스트)
            first_col_values = []
            for row in range(self.rows):
                cell = self.get_cell(row, 0)
                if cell:
                    first_col_values.append(cell.text.strip() if cell.text else "")
            
            # 첫 열이 레이블 특성을 가지는지
            if self._is_label_column(first_col_values):
                return "row_header"
            return "no_header"
        else:
            return "standard"
    
    def _detect_has_header(self) -> bool:
        """
        첫 행이 헤더인지 휴리스틱으로 판단
        
        헤더 특성:
        - 전화번호, 날짜, 금액 등 데이터 패턴 없음
        - 첫 행 값이 다른 행에 반복되지 않음 (헤더는 unique)
        - 첫 행이 다른 행들과 패턴이 다름
        
        Note: 텍스트 길이는 판단 기준에서 제외 (부가 설명이 있는 헤더 대응)
        """
        import re
        
        if self.rows < 2:
            return False
        
        # 첫 행 데이터 수집
        first_row_texts = []
        for col in range(self.cols):
            cell = self.get_cell(0, col)
            if cell and cell.text:
                first_row_texts.append(cell.text.strip())
            else:
                first_row_texts.append("")
        
        # 첫 행이 비어있으면 헤더 아님
        non_empty = [t for t in first_row_texts if t]
        if not non_empty:
            return False
        
        header_score = 0
        data_score = 0  # 데이터일 가능성 점수
        
        # === 데이터 패턴 감지 (있으면 헤더가 아님) ===
        
        # 1) 전화번호 패턴
        phone_pattern = r'\d{2,4}[-.)]\d{3,4}[-.)]\d{4}'
        if any(re.search(phone_pattern, t) for t in first_row_texts):
            data_score += 3  # 전화번호 있으면 거의 확실히 데이터
        
        # 2) 이메일 패턴
        email_pattern = r'[\w.-]+@[\w.-]+\.\w+'
        if any(re.search(email_pattern, t) for t in first_row_texts):
            data_score += 3
        
        # 3) 날짜 패턴 (YYYY-MM-DD, YYYY.MM.DD, YYYY년 MM월 등)
        date_pattern = r'\d{4}[-./년]\d{1,2}[-./월]\d{1,2}'
        if any(re.search(date_pattern, t) for t in first_row_texts):
            data_score += 2
        
        # 4) 금액 패턴 (숫자 + 원/만원/억원 등)
        money_pattern = r'\d{1,3}(,\d{3})*\s*(원|만원|억원|천원)'
        if any(re.search(money_pattern, t) for t in first_row_texts):
            data_score += 2
        
        # 5) 순수 숫자만 있는 셀 (퍼센트, 수량 등)
        if any(re.match(r'^[\d,.\s%]+$', t) for t in non_empty):
            data_score += 1
        
        # 데이터 패턴이 강하면 헤더 아님
        if data_score >= 3:
            return False
        
        # === 헤더 특성 감지 ===
        
        # 6) 첫 행 값이 다른 행들에 반복되는지 확인 (헤더는 unique)
        # 나머지 행들의 모든 값 수집
        other_rows_values = set()
        for row_idx in range(1, self.rows):
            for col_idx in range(self.cols):
                cell = self.get_cell(row_idx, col_idx)
                if cell and cell.text:
                    other_rows_values.add(cell.text.strip())
        
        # 첫 행 값이 다른 행에 반복되면 데이터일 가능성
        repeated_count = sum(1 for t in non_empty if t in other_rows_values)
        if repeated_count == 0:
            header_score += 2  # 첫 행 값이 전혀 반복되지 않음 → 헤더
        elif repeated_count <= len(non_empty) * 0.3:
            header_score += 1  # 30% 이하 반복 → 헤더 가능성
        
        # 7) 첫 행과 두 번째 행의 패턴 비교
        if self.rows >= 2:
            second_row_texts = []
            for col in range(self.cols):
                cell = self.get_cell(1, col)
                if cell and cell.text:
                    second_row_texts.append(cell.text.strip())
                else:
                    second_row_texts.append("")
            
            # 같은 열에서 첫 행과 두 번째 행의 패턴이 다른지 확인
            pattern_diff_count = 0
            for first_val, second_val in zip(first_row_texts, second_row_texts):
                if first_val and second_val:
                    # 첫 행: 짧고 명사형, 두 번째 행: 길고 설명형이면 헤더
                    first_is_short = len(first_val) <= 30
                    second_is_longer = len(second_val) > len(first_val)
                    if first_is_short and second_is_longer:
                        pattern_diff_count += 1
            
            if pattern_diff_count >= len(first_row_texts) * 0.5:
                header_score += 1
        
        # 8) 열 개수가 2개 이상이고 첫 행 셀들이 서로 다른 값인지
        if len(non_empty) >= 2 and len(set(non_empty)) == len(non_empty):
            header_score += 1  # 첫 행 값들이 모두 unique → 헤더 특성
        
        # 최종 판단: 헤더 점수 2 이상이면 헤더
        return header_score >= 2
    
    def _is_label_column(self, values: List[str]) -> bool:
        """첫 열이 레이블 열인지 판단"""
        non_empty = [v for v in values if v]
        if not non_empty:
            return False
        
        # 레이블 특성: 짧고, 유니크하며, 명사형
        avg_len = sum(len(v) for v in non_empty) / len(non_empty)
        unique_ratio = len(set(non_empty)) / len(non_empty)
        
        return avg_len <= 20 and unique_ratio > 0.7
    
    def _infer_column_semantics(self, col_idx: int) -> str:
        """
        열 값들의 패턴을 분석하여 의미 추론
        
        Returns:
            추론된 열 의미 (전화번호, 이름, 직함, 부서, 기타)
        """
        import re
        
        # 해당 열의 모든 값 수집
        values = []
        for row in range(self.rows):
            cell = self.get_cell(row, col_idx)
            if cell and cell.text:
                values.append(cell.text.strip())
        
        if not values:
            return f"열{col_idx + 1}"
        
        # 패턴 매칭
        patterns = {
            "전화번호": r'\d{2,4}[-.)]\d{3,4}[-.)]\d{4}',
            "이름": r'^[가-힣]{2,4}$',
            "직함": r'(과\s*장|팀\s*장|사무관|주무관|국장|차장|부장|대리|실장|계장|담당|책임)',
            "부서": r'(과|국|부|청|실|팀|센터)$',
            "이메일": r'[\w.-]+@[\w.-]+\.\w+',
        }
        
        for semantic, pattern in patterns.items():
            match_count = sum(1 for v in values if re.search(pattern, v))
            if match_count / len(values) >= 0.3:  # 30% 이상 매칭
                return semantic
        
        # 기본값: 열 위치 기반
        return f"열{col_idx + 1}"
    
    def _get_cell_value_map(self) -> Dict[Tuple[int, int], str]:
        """병합 셀을 고려한 셀 값 맵 생성"""
        cell_value_map: Dict[Tuple[int, int], str] = {}
        for cell in self.cells:
            text = cell.text.strip() if cell.text else ""
            for r in range(cell.row, cell.row + cell.rowspan):
                for c in range(cell.col, cell.col + cell.colspan):
                    cell_value_map[(r, c)] = text
        return cell_value_map
    
    def _linearize_standard(self, include_title: bool) -> str:
        """표준 표 선형화 (첫 행 = 헤더)"""
        lines = []
        
        if include_title and self.title:
            lines.append(f"[표 데이터: {self.title}]")
        else:
            lines.append("[표 데이터]")
        
        # 헤더 추출
        headers = []
        for col in range(self.cols):
            header_cell = self.get_cell(0, col)
            if header_cell and header_cell.text:
                headers.append(header_cell.text.strip())
            else:
                headers.append(f"열{col+1}")
        
        cell_value_map = self._get_cell_value_map()
        
        # 데이터 행 선형화
        for row_idx in range(1, self.rows):
            item_num = row_idx
            lines.append(f"\n항목 {item_num}:")
            
            for col_idx in range(self.cols):
                header_name = headers[col_idx]
                value = cell_value_map.get((row_idx, col_idx), "")
                
                if not value:
                    continue
                
                if len(value) > 100:
                    lines.append(f"- {header_name}:")
                    sentences = self._split_into_sentences(value)
                    for sentence in sentences:
                        lines.append(f"  {sentence}")
                else:
                    lines.append(f"- {header_name}: {value}")
        
        return '\n'.join(lines)
    
    def _linearize_no_header(self, include_title: bool) -> str:
        """헤더 없는 표 선형화 (열 의미 자동 추론)"""
        lines = []
        
        if include_title and self.title:
            lines.append(f"[표 데이터: {self.title}]")
        else:
            lines.append("[표 데이터]")
        
        # 열별 의미 추론
        column_semantics = []
        for col in range(self.cols):
            semantic = self._infer_column_semantics(col)
            column_semantics.append(semantic)
        
        cell_value_map = self._get_cell_value_map()
        
        # 모든 행을 레코드로 선형화
        for row_idx in range(self.rows):
            lines.append(f"\n항목 {row_idx + 1}:")
            
            for col_idx in range(self.cols):
                col_label = column_semantics[col_idx]
                value = cell_value_map.get((row_idx, col_idx), "")
                
                if not value:
                    continue
                
                lines.append(f"- {col_label}: {value}")
        
        return '\n'.join(lines)
    
    def _linearize_hierarchical(self, include_title: bool) -> str:
        """계층적 표 선형화 (세로 병합 기반 그룹화)"""
        lines = []
        
        if include_title and self.title:
            lines.append(f"[표 데이터: {self.title}]")
        else:
            lines.append("[표 데이터]")
        
        # 세로 병합 셀로 그룹 식별
        groups = self._identify_row_groups()
        
        # 열별 의미 추론
        column_semantics = []
        for col in range(self.cols):
            semantic = self._infer_column_semantics(col)
            column_semantics.append(semantic)
        
        cell_value_map = self._get_cell_value_map()
        
        item_num = 0
        for group_label, row_indices in groups:
            # 그룹 헤더 (병합 셀 텍스트)
            if group_label:
                lines.append(f"\n[{group_label}]")
            
            for row_idx in row_indices:
                item_num += 1
                lines.append(f"\n항목 {item_num}:")
                
                for col_idx in range(self.cols):
                    value = cell_value_map.get((row_idx, col_idx), "")
                    
                    if not value:
                        continue
                    
                    # 그룹 레이블과 같은 값은 스킵 (중복 방지)
                    if value == group_label:
                        continue
                    
                    col_label = column_semantics[col_idx]
                    lines.append(f"- {col_label}: {value}")
        
        return '\n'.join(lines)
    
    def _linearize_row_header(self, include_title: bool) -> str:
        """첫 열이 레이블인 표 선형화"""
        lines = []
        
        if include_title and self.title:
            lines.append(f"[표 데이터: {self.title}]")
        else:
            lines.append("[표 데이터]")
        
        cell_value_map = self._get_cell_value_map()
        
        # 열 의미 추론 (첫 열 제외)
        column_semantics = ["레이블"]
        for col in range(1, self.cols):
            semantic = self._infer_column_semantics(col)
            column_semantics.append(semantic)
        
        for row_idx in range(self.rows):
            # 첫 열 = 레이블
            row_label = cell_value_map.get((row_idx, 0), "")
            if row_label:
                lines.append(f"\n[{row_label}]")
            else:
                lines.append(f"\n항목 {row_idx + 1}:")
            
            for col_idx in range(1, self.cols):
                value = cell_value_map.get((row_idx, col_idx), "")
                if not value:
                    continue
                
                col_label = column_semantics[col_idx]
                lines.append(f"- {col_label}: {value}")
        
        return '\n'.join(lines)
    
    def _identify_row_groups(self) -> List[Tuple[str, List[int]]]:
        """
        세로 병합 셀 기반으로 행 그룹 식별
        
        Returns:
            [(그룹 레이블, [행 인덱스들]), ...]
        """
        groups = []
        current_label = None
        current_rows = []
        
        # 첫 번째 열의 세로 병합 셀 찾기
        first_col_cells = sorted(
            [c for c in self.cells if c.col == 0],
            key=lambda c: c.row
        )
        
        if not first_col_cells:
            # 병합 셀 없으면 전체를 하나의 그룹으로
            return [(None, list(range(self.rows)))]
        
        processed_rows = set()
        
        for cell in first_col_cells:
            if cell.rowspan > 1:
                # 이전 그룹 저장
                if current_rows:
                    groups.append((current_label, current_rows))
                
                # 새 그룹 시작
                current_label = cell.text.strip() if cell.text else None
                current_rows = list(range(cell.row, cell.row + cell.rowspan))
                processed_rows.update(current_rows)
            else:
                if cell.row not in processed_rows:
                    current_rows.append(cell.row)
                    processed_rows.add(cell.row)
        
        # 마지막 그룹 저장
        if current_rows:
            groups.append((current_label, current_rows))
        
        # 처리되지 않은 행들을 마지막 그룹에 추가
        for row in range(self.rows):
            if row not in processed_rows:
                if groups:
                    groups[-1][1].append(row)
                else:
                    groups.append((None, [row]))
        
        return groups
    
    def to_structured_dict(self) -> Dict[str, Any]:
        """
        스마트 구조화: RAG DB 저장용 구조화된 딕셔너리로 변환
        
        표 구조를 자동 분석하여 최적의 구조화 전략을 선택합니다.
        
        Returns:
            {
                "title": "표 제목",
                "structure_type": "standard|no_header|hierarchical|row_header",
                "column_semantics": ["부서", "이름", "전화번호", ...],
                "rows": [
                    {"부서": "값1", "이름": "값2", ...},
                    ...
                ],
                "groups": [  # hierarchical 구조인 경우
                    {"label": "그룹명", "items": [...]}
                ],
                "metadata": {...}
            }
        """
        if self.rows == 0 or self.cols == 0:
            return {"title": self.title, "structure_type": "empty", "rows": [], "metadata": {}}
        
        # 0. 제목 행 감지 및 정제 (제목 박스와 표가 결합된 경우)
        self._clean_title_rows()
        
        if self.rows == 0 or self.cols == 0:
            return {"title": self.title, "structure_type": "empty", "rows": [], "metadata": {}}
        
        # 표 구조 분석
        structure_type = self._detect_table_structure()
        has_header = self._detect_has_header()
        
        # 열별 의미 추론
        column_semantics = []
        for col in range(self.cols):
            semantic = self._infer_column_semantics(col)
            column_semantics.append(semantic)
        
        cell_value_map = self._get_cell_value_map()
        
        # 구조 유형별 데이터 변환
        if structure_type == "hierarchical":
            return self._structured_dict_hierarchical(
                cell_value_map, column_semantics, structure_type
            )
        elif structure_type == "no_header":
            return self._structured_dict_no_header(
                cell_value_map, column_semantics, structure_type
            )
        else:
            return self._structured_dict_standard(
                cell_value_map, column_semantics, structure_type, has_header
            )
    
    def _structured_dict_standard(
        self, 
        cell_value_map: Dict, 
        column_semantics: List[str],
        structure_type: str,
        has_header: bool
    ) -> Dict[str, Any]:
        """표준 표 구조화"""
        # 헤더가 있으면 첫 행을 헤더로, 없으면 열 의미를 헤더로
        if has_header:
            headers = []
            for col in range(self.cols):
                cell = self.get_cell(0, col)
                if cell and cell.text:
                    headers.append(cell.text.strip())
                else:
                    headers.append(column_semantics[col])
            start_row = 1
        else:
            headers = column_semantics
            start_row = 0
        
        rows = []
        for row_idx in range(start_row, self.rows):
            row_data = {}
            for col_idx in range(self.cols):
                header_name = headers[col_idx]
                value = cell_value_map.get((row_idx, col_idx), "")
                row_data[header_name] = value
            rows.append(row_data)
        
        return {
            "title": self.title,
            "structure_type": structure_type,
            "has_header": has_header,
            "headers": headers,
            "column_semantics": column_semantics,
            "rows": rows,
            "metadata": {
                "row_count": self.rows,
                "col_count": self.cols,
                "data_row_count": len(rows),
                "has_merged_cells": self.merged_cell_count > 0,
                "merged_cell_count": self.merged_cell_count
            }
        }
    
    def _structured_dict_no_header(
        self, 
        cell_value_map: Dict, 
        column_semantics: List[str],
        structure_type: str
    ) -> Dict[str, Any]:
        """헤더 없는 표 구조화"""
        rows = []
        for row_idx in range(self.rows):
            row_data = {}
            for col_idx in range(self.cols):
                header_name = column_semantics[col_idx]
                value = cell_value_map.get((row_idx, col_idx), "")
                row_data[header_name] = value
            rows.append(row_data)
        
        return {
            "title": self.title,
            "structure_type": structure_type,
            "has_header": False,
            "headers": column_semantics,
            "column_semantics": column_semantics,
            "rows": rows,
            "metadata": {
                "row_count": self.rows,
                "col_count": self.cols,
                "data_row_count": len(rows),
                "has_merged_cells": self.merged_cell_count > 0,
                "merged_cell_count": self.merged_cell_count
            }
        }
    
    def _structured_dict_hierarchical(
        self, 
        cell_value_map: Dict, 
        column_semantics: List[str],
        structure_type: str
    ) -> Dict[str, Any]:
        """계층적 표 구조화"""
        groups = self._identify_row_groups()
        
        structured_groups = []
        for group_label, row_indices in groups:
            group_items = []
            for row_idx in row_indices:
                row_data = {}
                for col_idx in range(self.cols):
                    value = cell_value_map.get((row_idx, col_idx), "")
                    # 그룹 레이블과 같은 값은 스킵
                    if value and value != group_label:
                        header_name = column_semantics[col_idx]
                        row_data[header_name] = value
                if row_data:  # 빈 행 제외
                    group_items.append(row_data)
            
            structured_groups.append({
                "label": group_label,
                "items": group_items
            })
        
        # 플랫 rows도 생성 (호환성)
        flat_rows = []
        for group in structured_groups:
            for item in group["items"]:
                item_with_group = item.copy()
                if group["label"]:
                    item_with_group["_group"] = group["label"]
                flat_rows.append(item_with_group)
        
        return {
            "title": self.title,
            "structure_type": structure_type,
            "has_header": False,
            "headers": column_semantics,
            "column_semantics": column_semantics,
            "groups": structured_groups,
            "rows": flat_rows,  # 플랫 버전도 제공
            "metadata": {
                "row_count": self.rows,
                "col_count": self.cols,
                "group_count": len(structured_groups),
                "data_row_count": len(flat_rows),
                "has_merged_cells": self.merged_cell_count > 0,
                "merged_cell_count": self.merged_cell_count
            }
        }
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """텍스트를 문장 단위로 분리"""
        import re
        # 문장 구분 패턴 (마침표, 글머리 기호 등)
        sentences = re.split(r'(?<=[.!?])\s+|(?=[•·▪▸►◆◇○●-]\s)', text)
        return [s.strip() for s in sentences if s.strip()]
    
    def _escape_markdown(self, text: str) -> str:
        """마크다운 이스케이프"""
        if not text:
            return ""
        text = text.replace('|', '\\|')
        text = text.replace('\n', ' ')
        return text
    
    def _escape_html(self, text: str) -> str:
        """HTML 이스케이프"""
        if not text:
            return ""
        return html_module.escape(text).replace('\n', '<br>')


class TableBuilder:
    """
    표 구조 구성기
    
    메타데이터와 셀 텍스트를 결합하여 최종 표를 구성합니다.
    
    사용 예시:
        builder = TableBuilder()
        table = builder.build_table(metadata, cell_texts)
        
        print(table.to_markdown())
    """
    
    def __init__(self, header_rows: int = 1):
        """
        Args:
            header_rows: 기본 헤더 행 수
        """
        self.header_rows = header_rows
    
    def build_table(
        self,
        metadata: TableStructureMetadata,
        cell_texts: Dict[Tuple[int, int], str],
        title: Optional[str] = None
    ) -> Table:
        """
        메타데이터와 텍스트로 최종 표 구성
        
        Args:
            metadata: 표 구조 메타데이터
            cell_texts: 셀별 텍스트 {(row, col): text}
            title: 표 제목 (선택)
            
        Returns:
            Table: 복원된 표
        """
        cells = []
        
        for cell_data in metadata.cells:
            row_span = cell_data.get('row_span', [0, 0])
            col_span = cell_data.get('col_span', [0, 0])
            bbox_data = cell_data.get('bbox')
            
            row = row_span[0]
            col = col_span[0]
            rowspan = row_span[1] - row_span[0] + 1
            colspan = col_span[1] - col_span[0] + 1
            
            # 텍스트 가져오기
            text = cell_texts.get((row, col), "")
            
            # bbox 변환
            bbox = tuple(bbox_data) if bbox_data else None
            
            cells.append(TableCell(
                row=row,
                col=col,
                rowspan=rowspan,
                colspan=colspan,
                text=text,
                bbox=bbox,
                is_header=(row < self.header_rows)
            ))
        
        return Table(
            rows=metadata.total_rows,
            cols=metadata.total_cols,
            cells=cells,
            header_rows=self.header_rows,
            title=title
        )
    
    def build_from_grid(
        self,
        grid: List[List[str]],
        header_rows: int = 1,
        title: Optional[str] = None
    ) -> Table:
        """
        2D 그리드에서 표 구성 (병합 없음)
        
        Args:
            grid: 2D 텍스트 배열
            header_rows: 헤더 행 수
            title: 표 제목
            
        Returns:
            Table: 생성된 표
        """
        if not grid:
            return Table(rows=0, cols=0)
        
        rows = len(grid)
        cols = max(len(row) for row in grid) if grid else 0
        
        cells = []
        for r, row in enumerate(grid):
            for c, text in enumerate(row):
                cells.append(TableCell(
                    row=r,
                    col=c,
                    rowspan=1,
                    colspan=1,
                    text=str(text) if text else "",
                    is_header=(r < header_rows)
                ))
        
        return Table(
            rows=rows,
            cols=cols,
            cells=cells,
            header_rows=header_rows,
            title=title
        )
    
    def validate_structure(self, table: Table) -> Tuple[bool, List[str]]:
        """
        표 구조 유효성 검증
        
        Returns:
            Tuple[bool, List[str]]: (유효 여부, 오류 메시지 목록)
        """
        errors = []
        
        # 1. 모든 셀이 범위 내에 있는지 확인
        for cell in table.cells:
            if cell.row < 0 or cell.row >= table.rows:
                errors.append(f"잘못된 행 인덱스: {cell.row}")
            if cell.col < 0 or cell.col >= table.cols:
                errors.append(f"잘못된 열 인덱스: {cell.col}")
            if cell.row + cell.rowspan > table.rows:
                errors.append(f"rowspan 초과: row={cell.row}, span={cell.rowspan}")
            if cell.col + cell.colspan > table.cols:
                errors.append(f"colspan 초과: col={cell.col}, span={cell.colspan}")
        
        # 2. 셀 중복 확인
        occupied = set()
        for cell in table.cells:
            for r in range(cell.row, cell.row + cell.rowspan):
                for c in range(cell.col, cell.col + cell.colspan):
                    if (r, c) in occupied:
                        errors.append(f"셀 중복: ({r}, {c})")
                    occupied.add((r, c))
        
        # 3. 빈 셀 확인 (경고)
        for r in range(table.rows):
            for c in range(table.cols):
                if (r, c) not in occupied:
                    errors.append(f"누락된 셀: ({r}, {c})")
        
        return len(errors) == 0, errors
    
    def merge_tables(
        self, 
        tables: List[Table], 
        direction: str = 'vertical'
    ) -> Table:
        """
        여러 표를 하나로 병합
        
        Args:
            tables: 병합할 표 목록
            direction: 'vertical' (세로) 또는 'horizontal' (가로)
            
        Returns:
            병합된 표
        """
        if not tables:
            return Table(rows=0, cols=0)
        
        if len(tables) == 1:
            return tables[0]
        
        if direction == 'vertical':
            return self._merge_vertical(tables)
        else:
            return self._merge_horizontal(tables)
    
    def _merge_vertical(self, tables: List[Table]) -> Table:
        """세로 방향 병합"""
        total_rows = sum(t.rows for t in tables)
        max_cols = max(t.cols for t in tables)
        
        merged_cells = []
        row_offset = 0
        
        for table in tables:
            for cell in table.cells:
                merged_cells.append(TableCell(
                    row=cell.row + row_offset,
                    col=cell.col,
                    rowspan=cell.rowspan,
                    colspan=cell.colspan,
                    text=cell.text,
                    bbox=cell.bbox,
                    is_header=cell.is_header
                ))
            row_offset += table.rows
        
        return Table(
            rows=total_rows,
            cols=max_cols,
            cells=merged_cells
        )
    
    def _merge_horizontal(self, tables: List[Table]) -> Table:
        """가로 방향 병합"""
        max_rows = max(t.rows for t in tables)
        total_cols = sum(t.cols for t in tables)
        
        merged_cells = []
        col_offset = 0
        
        for table in tables:
            for cell in table.cells:
                merged_cells.append(TableCell(
                    row=cell.row,
                    col=cell.col + col_offset,
                    rowspan=cell.rowspan,
                    colspan=cell.colspan,
                    text=cell.text,
                    bbox=cell.bbox,
                    is_header=cell.is_header
                ))
            col_offset += table.cols
        
        return Table(
            rows=max_rows,
            cols=total_cols,
            cells=merged_cells
        )


# ==================== 유틸리티 함수 ====================

def create_simple_table(
    data: List[List[str]],
    headers: Optional[List[str]] = None,
    title: Optional[str] = None
) -> Table:
    """
    간단한 2D 데이터로 표 생성
    
    Args:
        data: 2D 데이터 배열
        headers: 헤더 행 (None이면 첫 행이 헤더)
        title: 표 제목
        
    Returns:
        생성된 표
    """
    builder = TableBuilder()
    
    if headers:
        full_data = [headers] + data
    else:
        full_data = data
    
    return builder.build_from_grid(full_data, header_rows=1, title=title)


def table_to_dataframe(table: Table):
    """
    Table을 pandas DataFrame으로 변환
    
    Returns:
        pandas.DataFrame (pandas 설치 시)
    """
    try:
        import pandas as pd
        
        grid = table.to_2d_grid()
        
        if table.header_rows > 0 and len(grid) > 0:
            headers = grid[0]
            data = grid[1:]
            return pd.DataFrame(data, columns=headers)
        else:
            return pd.DataFrame(grid)
    except ImportError:
        raise ImportError("pandas가 설치되지 않았습니다.")


# 직접 실행 테스트용
if __name__ == "__main__":
    print("=" * 60)
    print("표 구성기(Table Builder) 테스트")
    print("=" * 60)
    
    # 테스트 데이터
    data = [
        ["이름", "나이", "직업"],
        ["홍길동", "30", "개발자"],
        ["김철수", "25", "디자이너"],
        ["이영희", "28", "기획자"],
    ]
    
    # 표 생성
    table = create_simple_table(data, title="직원 목록")
    
    print(f"\n표 정보:")
    print(f"  - 크기: {table.rows}x{table.cols}")
    print(f"  - 셀 수: {table.cell_count}")
    print(f"  - 헤더 행: {table.header_rows}")
    
    # Markdown 출력
    print(f"\n=== Markdown ===")
    print(table.to_markdown())
    
    # HTML 출력
    print(f"\n=== HTML ===")
    print(table.to_html(include_style=False))
    
    # CSV 출력
    print(f"\n=== CSV ===")
    print(table.to_csv())
    
    # JSON 출력
    print(f"\n=== JSON ===")
    json_data = table.to_json()
    print(f"rows: {json_data['rows']}, cols: {json_data['cols']}")
    
    # 유효성 검증
    builder = TableBuilder()
    is_valid, errors = builder.validate_structure(table)
    print(f"\n유효성 검증: {'통과' if is_valid else '실패'}")
    
    print("\n테스트 완료!")
