"""
HWP/HWPX 표 구조 추출 통합 테스트

이 테스트는 실제 HWP/HWPX 파일로 표 추출 기능을 검증합니다.
테스트 파일이 없으면 스킵됩니다.

사용법:
1. tests/samples/ 디렉토리에 테스트용 HWP/HWPX 파일 배치
2. pytest tests/test_hwp_integration.py -v 실행
"""
import pytest
import sys
import os
from pathlib import Path

# 프로젝트 루트 경로 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.extractors.hwp_extractor import HWPExtractor, HWPXExtractor
from app.extractors.base import ExtractionStatus


# 테스트 샘플 파일 경로
SAMPLES_DIR = Path(__file__).parent / "samples"


class TestHWPIntegration:
    """HWP 파일 통합 테스트"""
    
    @pytest.fixture
    def extractor(self):
        return HWPExtractor()
    
    @pytest.fixture
    def sample_hwp_with_tables(self):
        """표가 포함된 샘플 HWP 파일"""
        sample_path = SAMPLES_DIR / "sample_with_tables.hwp"
        if not sample_path.exists():
            pytest.skip(f"테스트 파일이 없습니다: {sample_path}")
        return str(sample_path)
    
    @pytest.fixture
    def sample_hwp_without_tables(self):
        """표가 없는 샘플 HWP 파일"""
        sample_path = SAMPLES_DIR / "sample_without_tables.hwp"
        if not sample_path.exists():
            pytest.skip(f"테스트 파일이 없습니다: {sample_path}")
        return str(sample_path)
    
    def test_extract_hwp_with_tables(self, extractor, sample_hwp_with_tables):
        """표가 포함된 HWP 파일 추출 테스트"""
        result = extractor.extract(sample_hwp_with_tables)
        
        # 기본 추출 성공 확인
        assert result.status in [ExtractionStatus.COMPLETED, ExtractionStatus.LLM_FALLBACK]
        assert result.text
        assert len(result.text) > 0
        
        # 표 추출 확인
        if result.pages:
            page = result.pages[0]
            if page.has_tables:
                assert len(page.tables) > 0
                for table in page.tables:
                    assert table.row_count >= 2
                    assert table.col_count >= 2
                    assert table.markdown
                    assert "|" in table.markdown
                    
                # 텍스트에 표 마크다운이 포함되어야 함
                assert "<!-- 표" in result.text
        
        print(f"\n추출 결과:")
        print(f"- 상태: {result.status.value}")
        print(f"- 문자 수: {result.char_count}")
        print(f"- 품질 점수: {result.quality_score}")
        if result.pages and result.pages[0].has_tables:
            print(f"- 추출된 표 수: {len(result.pages[0].tables)}")
    
    def test_extract_hwp_without_tables(self, extractor, sample_hwp_without_tables):
        """표가 없는 HWP 파일 추출 테스트"""
        result = extractor.extract(sample_hwp_without_tables)
        
        assert result.status in [ExtractionStatus.COMPLETED, ExtractionStatus.LLM_FALLBACK]
        assert result.text
        
        # 표가 없어야 함
        if result.pages:
            assert not result.pages[0].has_tables or len(result.pages[0].tables) == 0


class TestHWPXIntegration:
    """HWPX 파일 통합 테스트"""
    
    @pytest.fixture
    def extractor(self):
        return HWPXExtractor()
    
    @pytest.fixture
    def sample_hwpx_with_tables(self):
        """표가 포함된 샘플 HWPX 파일"""
        sample_path = SAMPLES_DIR / "sample_with_tables.hwpx"
        if not sample_path.exists():
            pytest.skip(f"테스트 파일이 없습니다: {sample_path}")
        return str(sample_path)
    
    @pytest.fixture
    def sample_hwpx_with_merged_cells(self):
        """병합 셀이 있는 표가 포함된 샘플 HWPX 파일"""
        sample_path = SAMPLES_DIR / "sample_merged_cells.hwpx"
        if not sample_path.exists():
            pytest.skip(f"테스트 파일이 없습니다: {sample_path}")
        return str(sample_path)
    
    def test_extract_hwpx_with_tables(self, extractor, sample_hwpx_with_tables):
        """표가 포함된 HWPX 파일 추출 테스트"""
        result = extractor.extract(sample_hwpx_with_tables)
        
        # 기본 추출 성공 확인
        assert result.status in [ExtractionStatus.COMPLETED, ExtractionStatus.LLM_FALLBACK]
        assert result.text
        assert len(result.text) > 0
        
        # 표 추출 확인
        if result.pages:
            page = result.pages[0]
            if page.has_tables:
                assert len(page.tables) > 0
                for table in page.tables:
                    assert table.row_count >= 2
                    assert table.col_count >= 2
                    assert table.markdown
                    
                # 텍스트에 표 마크다운이 포함되어야 함
                assert "<!-- 표" in result.text
        
        print(f"\n추출 결과:")
        print(f"- 상태: {result.status.value}")
        print(f"- 문자 수: {result.char_count}")
        print(f"- 품질 점수: {result.quality_score}")
        if result.pages and result.pages[0].has_tables:
            print(f"- 추출된 표 수: {len(result.pages[0].tables)}")
            for i, table in enumerate(result.pages[0].tables):
                print(f"\n  표 {i+1}:")
                print(f"    - 행 수: {table.row_count}")
                print(f"    - 열 수: {table.col_count}")
                print(f"    - 마크다운 미리보기:\n{table.markdown[:200]}...")
    
    def test_extract_hwpx_with_merged_cells(self, extractor, sample_hwpx_with_merged_cells):
        """병합 셀이 있는 표 추출 테스트"""
        result = extractor.extract(sample_hwpx_with_merged_cells)
        
        assert result.status in [ExtractionStatus.COMPLETED, ExtractionStatus.LLM_FALLBACK]
        
        if result.pages and result.pages[0].has_tables:
            for table in result.pages[0].tables:
                # 병합 셀이 처리되어 정규 2D 배열이 되어야 함
                assert all(len(row) == table.col_count for row in table.rows)
                
                print(f"\n병합 셀 처리 결과:")
                print(table.markdown)


class TestTableExtractionQuality:
    """표 추출 품질 테스트"""
    
    def test_markdown_format_validity(self):
        """마크다운 형식 유효성 테스트"""
        extractor = HWPExtractor()
        
        table = [
            ["헤더1", "헤더2", "헤더3"],
            ["값1", "값2", "값3"],
            ["값4", "값5", "값6"]
        ]
        
        markdown = extractor._table_to_markdown(table)
        lines = markdown.split('\n')
        
        # 헤더 행 확인
        assert lines[0].startswith('|')
        assert lines[0].endswith('|')
        assert lines[0].count('|') == 4
        
        # 구분선 확인
        assert '---' in lines[1]
        
        # 데이터 행 확인
        for line in lines[2:]:
            assert line.startswith('|')
            assert line.endswith('|')
    
    def test_special_characters_handling(self):
        """특수 문자 처리 테스트"""
        extractor = HWPExtractor()
        
        table = [
            ["헤더|파이프", "헤더\n줄바꿈"],
            ["값1", "값2"]
        ]
        
        markdown = extractor._table_to_markdown(table)
        
        # 파이프 문자가 이스케이프되어야 함
        assert "\\|" in markdown or "파이프" in markdown
        
        # 줄바꿈이 제거되어야 함
        assert "\n줄바꿈" not in markdown.replace('\n', '')


def create_samples_directory():
    """테스트 샘플 디렉토리 생성"""
    SAMPLES_DIR.mkdir(exist_ok=True)
    
    readme_path = SAMPLES_DIR / "README.md"
    if not readme_path.exists():
        readme_path.write_text("""# 테스트 샘플 파일

이 디렉토리에 다음 테스트용 파일을 배치하세요:

## HWP 파일
- `sample_with_tables.hwp`: 표가 포함된 HWP 파일
- `sample_without_tables.hwp`: 표가 없는 HWP 파일

## HWPX 파일
- `sample_with_tables.hwpx`: 표가 포함된 HWPX 파일
- `sample_merged_cells.hwpx`: 병합 셀이 있는 표가 포함된 HWPX 파일

## 테스트 실행
```bash
cd backend
pytest tests/test_hwp_integration.py -v
```
""", encoding='utf-8')
    
    print(f"샘플 디렉토리 생성됨: {SAMPLES_DIR}")


if __name__ == "__main__":
    # 샘플 디렉토리 생성
    create_samples_directory()
    
    # 테스트 실행
    pytest.main([__file__, "-v", "-s"])
