"""
표 정규화 모듈 테스트
"""
import pytest
import sys
from pathlib import Path

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.utils.table_normalizer import TableNormalizer, NormalizationResult
from app.config import ExtractionConfig, TableNormalizationSettings


class TestTableNormalizerBasic:
    """기본 기능 테스트"""
    
    def test_normalizer_creation(self):
        """기본 생성 테스트"""
        normalizer = TableNormalizer()
        assert normalizer is not None
        assert normalizer.flatten_headers == True
        assert normalizer.flatten_hierarchy == True
    
    def test_normalizer_with_custom_settings(self):
        """커스텀 설정 생성 테스트"""
        normalizer = TableNormalizer(
            flatten_headers=False,
            hierarchy_separator=" / ",
            empty_cell_strategy="null"
        )
        assert normalizer.flatten_headers == False
        assert normalizer.hierarchy_separator == " / "
        assert normalizer.empty_cell_strategy == "null"


class TestMarkdownTableParsing:
    """마크다운 표 파싱 테스트"""
    
    def test_parse_simple_table(self):
        """단순 표 파싱"""
        normalizer = TableNormalizer()
        table_text = """| A | B | C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |"""
        
        rows = normalizer._parse_markdown_table(table_text)
        assert len(rows) == 3
        assert rows[0] == ["A", "B", "C"]
        assert rows[1] == ["1", "2", "3"]
        assert rows[2] == ["4", "5", "6"]
    
    def test_parse_table_with_empty_cells(self):
        """빈 셀이 있는 표 파싱"""
        normalizer = TableNormalizer()
        table_text = """| A | B | C |
|---|---|---|
| 1 |  | 3 |
|  | 5 | 6 |"""
        
        rows = normalizer._parse_markdown_table(table_text)
        assert len(rows) == 3
        assert rows[1] == ["1", "", "3"]
        assert rows[2] == ["", "5", "6"]


class TestHeaderDetection:
    """헤더 감지 테스트"""
    
    def test_detect_single_header(self):
        """단일 헤더 감지"""
        normalizer = TableNormalizer()
        rows = [
            ["구분", "금액", "증가율"],
            ["반도체", "1000", "10.5"],
            ["디스플레이", "500", "5.2"]
        ]
        
        header_rows, sep_idx, data_rows = normalizer._detect_headers(rows)
        assert len(header_rows) == 1
        assert header_rows[0] == ["구분", "금액", "증가율"]
        assert len(data_rows) == 2
    
    def test_detect_multi_header(self):
        """다중 헤더 감지"""
        normalizer = TableNormalizer()
        rows = [
            ["구분", "2024년", "2025년"],
            ["", "금액", "증가율", "금액", "증가율"],
            ["반도체", "1000", "10.5", "1200", "20.0"],
        ]
        
        header_rows, sep_idx, data_rows = normalizer._detect_headers(rows)
        assert len(header_rows) == 2
        assert len(data_rows) == 1


class TestHeaderFlattening:
    """헤더 병합 테스트"""
    
    def test_flatten_simple_headers(self):
        """단순 다중 헤더 병합"""
        normalizer = TableNormalizer()
        header_rows = [
            ["구분", "2024년", "", "2025년", ""],
            ["", "금액", "증가율", "금액", "증가율"],
        ]
        
        flat = normalizer._flatten_headers(header_rows)
        assert flat[0] == "구분"
        assert flat[1] == "2024년_금액"
        assert flat[2] == "2024년_증가율" or flat[2] == "증가율"  # 빈 셀 처리 방식에 따라
    
    def test_flatten_with_decoration_removal(self):
        """장식 문자 제거 후 헤더 병합"""
        normalizer = TableNormalizer()
        header_rows = [
            ["ㅇ구분", "금액", "비중"],
        ]
        
        flat = normalizer._flatten_headers(header_rows)
        assert flat[0] == "구분"  # ㅇ 제거됨


class TestHierarchyFlattening:
    """계층 구조 평탄화 테스트"""
    
    def test_flatten_simple_hierarchy(self):
        """단순 계층 구조 평탄화"""
        normalizer = TableNormalizer()
        rows = [
            ["전자부품", "1000", "50.0"],
            ["", "반도체", "800", "40.0"],
            ["", "", "메모리", "500", "25.0"],
        ]
        
        flat = normalizer._flatten_hierarchy(rows)
        assert "전자부품" in flat[0][0]
        assert "전자부품 > 반도체" in flat[1][0]
        assert "전자부품 > 반도체 > 메모리" in flat[2][0]
    
    def test_flatten_with_custom_separator(self):
        """커스텀 구분자로 계층 평탄화"""
        normalizer = TableNormalizer(hierarchy_separator=" / ")
        rows = [
            ["A", "100"],
            ["", "B", "50"],
        ]
        
        flat = normalizer._flatten_hierarchy(rows)
        assert "A / B" in flat[1][0]


class TestEmptyCellFilling:
    """빈 셀 처리 테스트"""
    
    def test_fill_with_dash(self):
        """대시로 빈 셀 채우기"""
        normalizer = TableNormalizer(empty_cell_strategy="dash")
        rows = [
            ["A", "B", ""],
            ["", "E", "F"],
        ]
        
        filled = normalizer._fill_empty_cells(rows)
        assert filled[0][2] == "-"
        assert filled[1][0] == "-"
    
    def test_fill_with_inherit(self):
        """위 셀 값 상속"""
        normalizer = TableNormalizer(empty_cell_strategy="inherit")
        rows = [
            ["A", "B", "C"],
            ["", "E", "F"],
        ]
        
        filled = normalizer._fill_empty_cells(rows)
        assert filled[1][0] == "A"
    
    def test_fill_with_null(self):
        """NULL로 빈 셀 채우기"""
        normalizer = TableNormalizer(empty_cell_strategy="null")
        rows = [
            ["A", "", "C"],
        ]
        
        filled = normalizer._fill_empty_cells(rows)
        assert filled[0][1] == "NULL"


class TestColumnNormalization:
    """열 수 정규화 테스트"""
    
    def test_normalize_uneven_columns(self):
        """불균일한 열 수 정규화"""
        normalizer = TableNormalizer()
        rows = [
            ["A", "B", "C"],
            ["1", "2"],
            ["X", "Y", "Z", "W"],
        ]
        
        normalized = normalizer._normalize_columns(rows, 4)
        assert len(normalized[0]) == 4
        assert len(normalized[1]) == 4
        assert len(normalized[2]) == 4


class TestDecorationCharRemoval:
    """장식 문자 제거 테스트"""
    
    def test_remove_korean_markers(self):
        """한글 마커 제거"""
        normalizer = TableNormalizer()
        rows = [
            ["ㅇ전자부품", "1000"],
            ["- 반도체", "800"],
            ["ㆍ 메모리", "500"],
            ["※ 참고", "100"],
        ]
        
        cleaned = normalizer._remove_decoration_chars(rows)
        assert cleaned[0][0] == "전자부품"
        assert cleaned[1][0] == "반도체"
        assert cleaned[2][0] == "메모리"
        assert cleaned[3][0] == "참고"


class TestMarkdownOutput:
    """마크다운 출력 테스트"""
    
    def test_to_markdown_simple(self):
        """단순 표 마크다운 변환"""
        normalizer = TableNormalizer()
        header = ["A", "B", "C"]
        data = [
            ["1", "2", "3"],
            ["4", "5", "6"],
        ]
        
        md = normalizer._to_markdown(header, data)
        assert "| A | B | C |" in md
        assert "|---|---|---|" in md
        assert "| 1 | 2 | 3 |" in md
    
    def test_escape_pipe_character(self):
        """파이프 문자 이스케이프"""
        normalizer = TableNormalizer()
        header = ["Name"]
        data = [["A|B"]]
        
        md = normalizer._to_markdown(header, data)
        assert "A\\|B" in md


class TestFullNormalization:
    """전체 정규화 파이프라인 테스트"""
    
    def test_normalize_complex_table(self):
        """복잡한 표 전체 정규화"""
        normalizer = TableNormalizer()
        table_text = """| 구분 | 2024년 | 2025년 | | |
|---|---|---|---|---|
| | 금액 | 비중 | 금액 | 비중 |
| 정보통신 | 1000 | 100.0 | 1200 | 100.0 |
| | ㅇ전자부품 | 500 | 50.0 | 600 | 50.0 |
| | | - 반도체 | 300 | 30.0 | 400 | 33.3 |"""
        
        result = normalizer.normalize_table(table_text)
        
        assert isinstance(result, NormalizationResult)
        assert result.normalized_table != ""
        assert len(result.changes_made) > 0
    
    def test_normalize_text_with_tables(self):
        """텍스트 내 표 정규화"""
        normalizer = TableNormalizer()
        text = """# 보고서

일부 설명 텍스트

<!-- 표 1 -->

| A | B |
|---|---|
| 1 | 2 |

추가 텍스트"""
        
        normalized = normalizer.normalize_text(text)
        assert "<!-- 표 1 -->" in normalized
        assert "| A | B |" in normalized


class TestConfigIntegration:
    """설정 통합 테스트"""
    
    def test_create_from_config(self):
        """설정으로부터 생성"""
        from app.utils.table_normalizer import create_normalizer_from_config
        
        config = ExtractionConfig()
        config.table_normalization.flatten_headers = False
        config.table_normalization.hierarchy_separator = " -> "
        
        normalizer = create_normalizer_from_config(config)
        assert normalizer.flatten_headers == False
        assert normalizer.hierarchy_separator == " -> "
    
    def test_default_config_settings(self):
        """기본 설정 값 테스트"""
        settings = TableNormalizationSettings()
        assert settings.enabled == True
        assert settings.flatten_headers == True
        assert settings.flatten_hierarchy == True
        assert settings.empty_cell_strategy == "dash"


class TestEdgeCases:
    """엣지 케이스 테스트"""
    
    def test_empty_table(self):
        """빈 표 처리"""
        normalizer = TableNormalizer()
        result = normalizer.normalize_table("")
        assert result.normalized_table == ""
    
    def test_table_with_only_header(self):
        """헤더만 있는 표"""
        normalizer = TableNormalizer()
        table_text = """| A | B | C |
|---|---|---|"""
        
        result = normalizer.normalize_table(table_text)
        assert result.data_row_count == 0
    
    def test_malformed_table(self):
        """잘못된 형식의 표"""
        normalizer = TableNormalizer()
        table_text = """Not a table
Just some text"""
        
        result = normalizer.normalize_table(table_text)
        # 파싱 실패해도 에러 없이 처리
        assert result is not None


class TestRealWorldScenarios:
    """실제 사용 시나리오 테스트"""
    
    def test_korean_ict_table(self):
        """ICT 수출입 표 정규화"""
        normalizer = TableNormalizer()
        table_text = """| 구 분 | 2024년 | 2025년 | | | | | | | |
|---|---|---|---|---|---|---|---|---|---|
| 12월 당월 | 12월 누적 | | | | | | | | |
| 금액 | 증가율 | 비중 | 금액 | 증가율 | 비중 | 금액 | 증가율 | 비중 | |
| 정보통신방송기기 | 58,592 | 8.1 | 100.0 | 5,620 | 13.0 | 100.0 | 61,432 | 4.8 | 100.0 |
| | ㅇ전자부품 | 38,185 | 12.1 | 65.2 | 3,487 | 9.8 | 62.1 | 41,219 | 7.9 |
| | | - 반도체 | 29,082 | 13.8 | 49.6 | 2,559 | 6.1 | 45.5 | 31,350 |"""
        
        result = normalizer.normalize_table(table_text)
        
        # 정규화 적용됨
        assert result.normalization_applied if hasattr(result, 'normalization_applied') else len(result.changes_made) > 0
        
        # 결과에 데이터가 있음
        assert result.data_row_count > 0
        
        # 마크다운 형식 유지
        assert "|" in result.normalized_table


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
