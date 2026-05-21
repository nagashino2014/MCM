"""
HWP/HWPX 표 구조 추출 단위 테스트

테스트 항목:
1. 표 유효성 검사 (_is_valid_table)
2. 마크다운 변환 (_table_to_markdown)
3. 셀 데이터 정리 (_clean_cell)
4. 병합 셀 확장 (_expand_merged_cells)
5. 텍스트와 표 병합 (_merge_text_and_tables)
"""
import pytest
import sys
import os

# 프로젝트 루트 경로 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.extractors.hwp_extractor import HWPExtractor, HWPXExtractor
from app.extractors.base import TableData
from app.config import ExtractionConfig


class TestHWPExtractorTableMethods:
    """HWPExtractor 표 관련 메서드 테스트"""
    
    @pytest.fixture
    def extractor(self):
        """테스트용 HWPExtractor 인스턴스"""
        return HWPExtractor()
    
    # ==================== _is_valid_table 테스트 ====================
    
    def test_is_valid_table_empty(self, extractor):
        """빈 표 유효성 검사"""
        assert extractor._is_valid_table([]) is False
        assert extractor._is_valid_table(None) is False
    
    def test_is_valid_table_single_row(self, extractor):
        """단일 행 표 (무효)"""
        table = [["헤더1", "헤더2"]]
        assert extractor._is_valid_table(table) is False
    
    def test_is_valid_table_single_col(self, extractor):
        """단일 열 표 (무효)"""
        table = [["헤더"], ["값1"], ["값2"]]
        assert extractor._is_valid_table(table) is False
    
    def test_is_valid_table_valid_2x2(self, extractor):
        """2x2 표 (유효)"""
        table = [
            ["헤더1", "헤더2"],
            ["값1", "값2"]
        ]
        assert extractor._is_valid_table(table) is True
    
    def test_is_valid_table_valid_3x3(self, extractor):
        """3x3 표 (유효)"""
        table = [
            ["오염물질", "1종", "2종"],
            ["먼지", "30mg/m³", "50mg/m³"],
            ["황산화물", "150ppm", "200ppm"]
        ]
        assert extractor._is_valid_table(table) is True
    
    def test_is_valid_table_too_many_empty_cells(self, extractor):
        """빈 셀이 너무 많은 표 (무효) - 30% 미만 채워진 경우"""
        # 4x4 = 16 cells, 4 filled = 25% < 30%
        table = [
            ["헤더1", "헤더2", "", ""],
            ["", "", "", ""],
            ["", "", "", ""],
            ["값1", "값2", "", ""]
        ]
        assert extractor._is_valid_table(table) is False
    
    def test_is_valid_table_partial_empty(self, extractor):
        """일부 빈 셀이 있는 표 (유효)"""
        table = [
            ["헤더1", "헤더2", "헤더3"],
            ["값1", "", "값3"],
            ["값4", "값5", "값6"]
        ]
        assert extractor._is_valid_table(table) is True
    
    # ==================== _clean_cell 테스트 ====================
    
    def test_clean_cell_none(self, extractor):
        """None 셀 정리"""
        assert extractor._clean_cell(None) == ''
    
    def test_clean_cell_normal_text(self, extractor):
        """일반 텍스트 셀"""
        assert extractor._clean_cell("일반 텍스트") == "일반 텍스트"
    
    def test_clean_cell_with_newline(self, extractor):
        """줄바꿈이 있는 셀"""
        assert extractor._clean_cell("첫줄\n둘째줄") == "첫줄 둘째줄"
    
    def test_clean_cell_with_pipe(self, extractor):
        """파이프 문자가 있는 셀"""
        assert extractor._clean_cell("A|B") == "A\\|B"
    
    def test_clean_cell_with_multiple_spaces(self, extractor):
        """연속 공백이 있는 셀"""
        assert extractor._clean_cell("텍스트   공백") == "텍스트 공백"
    
    def test_clean_cell_with_leading_trailing_spaces(self, extractor):
        """앞뒤 공백이 있는 셀"""
        assert extractor._clean_cell("  텍스트  ") == "텍스트"
    
    # ==================== _table_to_markdown 테스트 ====================
    
    def test_table_to_markdown_empty(self, extractor):
        """빈 표 마크다운 변환"""
        assert extractor._table_to_markdown([]) == ""
        assert extractor._table_to_markdown([[]]) == ""
    
    def test_table_to_markdown_2x2(self, extractor):
        """2x2 표 마크다운 변환"""
        table = [
            ["헤더1", "헤더2"],
            ["값1", "값2"]
        ]
        result = extractor._table_to_markdown(table)
        
        assert "| 헤더1 | 헤더2 |" in result
        assert "|---|---|" in result
        assert "| 값1 | 값2 |" in result
    
    def test_table_to_markdown_3x3(self, extractor):
        """3x3 표 마크다운 변환"""
        table = [
            ["오염물질", "1종 사업장", "2종 사업장"],
            ["먼지", "30mg/m³", "50mg/m³"],
            ["황산화물", "150ppm", "200ppm"]
        ]
        result = extractor._table_to_markdown(table)
        
        lines = result.split('\n')
        assert len(lines) == 4  # 헤더 + 구분선 + 2개 데이터 행
        assert "오염물질" in lines[0]
        assert "---" in lines[1]
        assert "먼지" in lines[2]
    
    def test_table_to_markdown_uneven_cols(self, extractor):
        """열 수가 다른 행이 있는 표"""
        table = [
            ["헤더1", "헤더2", "헤더3"],
            ["값1", "값2"],  # 열 수 부족
            ["값3", "값4", "값5"]
        ]
        result = extractor._table_to_markdown(table)
        
        # 모든 행이 3열로 정규화되어야 함
        lines = result.split('\n')
        for line in lines:
            if line.startswith('|') and '---' not in line:
                assert line.count('|') == 4  # 3열 = 4개 파이프
    
    # ==================== _merge_text_and_tables 테스트 ====================
    
    def test_merge_text_and_tables_no_tables(self, extractor):
        """표가 없는 경우"""
        text = "일반 텍스트 내용"
        result = extractor._merge_text_and_tables(text, [])
        assert result == text
    
    def test_merge_text_and_tables_with_one_table(self, extractor):
        """표가 하나 있는 경우"""
        text = "일반 텍스트 내용"
        tables = [
            TableData(
                table_index=0,
                rows=[["헤더1", "헤더2"], ["값1", "값2"]],
                markdown="| 헤더1 | 헤더2 |\n|---|---|\n| 값1 | 값2 |",
                row_count=2,
                col_count=2
            )
        ]
        
        result = extractor._merge_text_and_tables(text, tables)
        
        assert "일반 텍스트 내용" in result
        assert "<!-- 표 1 -->" in result
        assert "| 헤더1 | 헤더2 |" in result
    
    def test_merge_text_and_tables_with_multiple_tables(self, extractor):
        """표가 여러 개인 경우"""
        text = "일반 텍스트 내용"
        tables = [
            TableData(
                table_index=0,
                rows=[["헤더1", "헤더2"], ["값1", "값2"]],
                markdown="| 헤더1 | 헤더2 |\n|---|---|\n| 값1 | 값2 |",
                row_count=2,
                col_count=2
            ),
            TableData(
                table_index=1,
                rows=[["A", "B"], ["C", "D"]],
                markdown="| A | B |\n|---|---|\n| C | D |",
                row_count=2,
                col_count=2
            )
        ]
        
        result = extractor._merge_text_and_tables(text, tables)
        
        assert "<!-- 표 1 -->" in result
        assert "<!-- 표 2 -->" in result


class TestHWPXExtractorTableMethods:
    """HWPXExtractor 표 관련 메서드 테스트"""
    
    @pytest.fixture
    def extractor(self):
        """테스트용 HWPXExtractor 인스턴스"""
        return HWPXExtractor()
    
    # ==================== _expand_merged_cells 테스트 ====================
    
    def test_expand_merged_cells_empty(self, extractor):
        """빈 셀 데이터"""
        result = extractor._expand_merged_cells([])
        assert result == []
    
    def test_expand_merged_cells_no_merge(self, extractor):
        """병합 없는 표"""
        cells = [
            [
                {"text": "A", "col_span": 1, "row_span": 1},
                {"text": "B", "col_span": 1, "row_span": 1}
            ],
            [
                {"text": "C", "col_span": 1, "row_span": 1},
                {"text": "D", "col_span": 1, "row_span": 1}
            ]
        ]
        result = extractor._expand_merged_cells(cells)
        
        assert len(result) == 2
        assert result[0] == ["A", "B"]
        assert result[1] == ["C", "D"]
    
    def test_expand_merged_cells_col_span(self, extractor):
        """열 병합이 있는 표"""
        cells = [
            [
                {"text": "헤더", "col_span": 2, "row_span": 1}
            ],
            [
                {"text": "값1", "col_span": 1, "row_span": 1},
                {"text": "값2", "col_span": 1, "row_span": 1}
            ]
        ]
        result = extractor._expand_merged_cells(cells)
        
        assert len(result) == 2
        assert result[0] == ["헤더", ""]  # 병합된 셀은 빈 문자열
        assert result[1] == ["값1", "값2"]
    
    def test_expand_merged_cells_row_span(self, extractor):
        """행 병합이 있는 표"""
        cells = [
            [
                {"text": "A", "col_span": 1, "row_span": 2},
                {"text": "B", "col_span": 1, "row_span": 1}
            ],
            [
                {"text": "C", "col_span": 1, "row_span": 1}
            ]
        ]
        result = extractor._expand_merged_cells(cells)
        
        assert len(result) == 2
        assert result[0] == ["A", "B"]
        assert result[1] == ["", "C"]  # A의 행 병합으로 빈 셀
    
    def test_expand_merged_cells_complex(self, extractor):
        """복잡한 병합이 있는 표"""
        cells = [
            [
                {"text": "헤더1", "col_span": 2, "row_span": 1},
                {"text": "헤더2", "col_span": 1, "row_span": 1}
            ],
            [
                {"text": "데이터", "col_span": 1, "row_span": 2},
                {"text": "A", "col_span": 1, "row_span": 1},
                {"text": "B", "col_span": 1, "row_span": 1}
            ],
            [
                {"text": "C", "col_span": 1, "row_span": 1},
                {"text": "D", "col_span": 1, "row_span": 1}
            ]
        ]
        result = extractor._expand_merged_cells(cells)
        
        assert len(result) == 3
        assert result[0] == ["헤더1", "", "헤더2"]
        assert result[1] == ["데이터", "A", "B"]
        assert result[2] == ["", "C", "D"]
    
    # ==================== 공통 메서드 테스트 (HWPExtractor와 동일) ====================
    
    def test_is_valid_table_valid(self, extractor):
        """유효한 표 검사"""
        table = [
            ["헤더1", "헤더2"],
            ["값1", "값2"]
        ]
        assert extractor._is_valid_table(table) is True
    
    def test_clean_cell_normal(self, extractor):
        """일반 셀 정리"""
        assert extractor._clean_cell("텍스트") == "텍스트"
        assert extractor._clean_cell("텍스트\n줄바꿈") == "텍스트 줄바꿈"
    
    def test_table_to_markdown_basic(self, extractor):
        """기본 마크다운 변환"""
        table = [
            ["헤더1", "헤더2"],
            ["값1", "값2"]
        ]
        result = extractor._table_to_markdown(table)
        
        assert "| 헤더1 | 헤더2 |" in result
        assert "|---|---|" in result


class TestTableDataStructure:
    """TableData 데이터 구조 테스트"""
    
    def test_table_data_creation(self):
        """TableData 생성 테스트"""
        table = TableData(
            table_index=0,
            rows=[["A", "B"], ["C", "D"]],
            markdown="| A | B |\n|---|---|\n| C | D |",
            row_count=2,
            col_count=2
        )
        
        assert table.table_index == 0
        assert table.row_count == 2
        assert table.col_count == 2
        assert len(table.rows) == 2
        assert "| A | B |" in table.markdown
    
    def test_table_data_with_bbox(self):
        """bbox를 포함한 TableData"""
        table = TableData(
            table_index=0,
            rows=[["A", "B"]],
            markdown="| A | B |",
            bbox=(0.0, 0.0, 100.0, 50.0),
            row_count=1,
            col_count=2
        )
        
        assert table.bbox == (0.0, 0.0, 100.0, 50.0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
