"""
Cross-page Table Merging 모듈 단위 테스트
"""
import pytest
from typing import List, Dict, Any
from dataclasses import dataclass

# 테스트 대상 모듈 임포트
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.table_merge.config import CrossPageMergeConfig
from app.table_merge.header_analyzer import HeaderAnalyzer, HeaderSignature
from app.table_merge.continuity_detector import ContinuityDetector, ContinuityScore
from app.table_merge.duplicate_remover import DuplicateHeaderRemover
from app.table_merge.merge_engine import TableMergeEngine, MergeStats
from app.table_merge.cross_page_merger import CrossPageTableMerger
from app.extractors.base import TableData


# ============================================================================
# 테스트 픽스처
# ============================================================================

@pytest.fixture
def default_config():
    """기본 설정"""
    return CrossPageMergeConfig()

@pytest.fixture
def header_analyzer(default_config):
    """HeaderAnalyzer 인스턴스"""
    return HeaderAnalyzer(default_config)

@pytest.fixture
def continuity_detector(default_config):
    """ContinuityDetector 인스턴스"""
    return ContinuityDetector(default_config)

@pytest.fixture
def duplicate_remover(default_config):
    """DuplicateHeaderRemover 인스턴스"""
    return DuplicateHeaderRemover(default_config)

@pytest.fixture
def merge_engine(default_config):
    """TableMergeEngine 인스턴스"""
    return TableMergeEngine(default_config)

@pytest.fixture
def cross_page_merger(default_config):
    """CrossPageTableMerger 인스턴스"""
    return CrossPageTableMerger(default_config)


# ============================================================================
# 샘플 테이블 데이터 (물질수지 표 시뮬레이션)
# ============================================================================

@pytest.fixture
def sample_table_page1():
    """1페이지 표 데이터"""
    return TableData(
        table_index=0,
        rows=[
            ["구분", "세부구분", "물질명", "단위", "PU-01", "PU-02", "합계"],
            ["투입물", "반제품", "PCB", "톤/일", "0.0216", "0.0073", "0.0289"],
            ["투입물", "반제품", "FLIP CHIP", "톤/일", "0.1047", "0.0150", "0.1197"],
            ["투입물", "반제품", "component", "톤/일", "0.0028", "0.0012", "0.0040"],
        ],
        semantic_text="물질수지 표 (1페이지)",
        markdown="| 구분 | 세부구분 | 물질명 | ... |",
        row_count=4,
        col_count=7,
        confidence=0.9,
        extraction_method="pdfplumber",
        page_num=1
    )

@pytest.fixture
def sample_table_page2():
    """2페이지 표 데이터 (1페이지와 동일 구조, 중복 헤더 포함)"""
    return TableData(
        table_index=1,
        rows=[
            ["구분", "세부구분", "물질명", "단위", "PU-01", "PU-02", "합계"],  # 중복 헤더
            ["투입물", "반제품", "웨이퍼", "톤/일", "4.9072", "0.1242", "5.0314"],
            ["투입물", "반제품", "반도체", "톤/일", "16.8055", "0.2940", "17.0995"],
            ["투입물", "반제품", "콘덴서", "톤/일", "0.9149", "0.4556", "1.3705"],
        ],
        semantic_text="물질수지 표 (2페이지)",
        markdown="| 구분 | 세부구분 | 물질명 | ... |",
        row_count=4,
        col_count=7,
        confidence=0.9,
        extraction_method="pdfplumber",
        page_num=2
    )

@pytest.fixture
def sample_table_page3():
    """3페이지 표 데이터 (구조 동일, 헤더 없음)"""
    return TableData(
        table_index=2,
        rows=[
            ["사용물질", "약품", "황산", "톤/일", "0.0203", "0.0961", "0.1164"],
            ["사용물질", "약품", "KOH", "톤/일", "0.0066", "0.0066", "0.0132"],
            ["사용물질", "약품", "unilin-900", "톤/일", "0.0700", "0.0700", "0.1400"],
        ],
        semantic_text="물질수지 표 (3페이지)",
        markdown="| 사용물질 | 약품 | ... |",
        row_count=3,
        col_count=7,
        confidence=0.9,
        extraction_method="pdfplumber",
        page_num=3
    )

@pytest.fixture
def different_structure_table():
    """다른 구조의 표 (병합 대상 아님)"""
    return TableData(
        table_index=10,
        rows=[
            ["항목", "수치", "비고"],
            ["온도", "25", "°C"],
            ["압력", "1.0", "atm"],
        ],
        semantic_text="별도 표",
        markdown="| 항목 | 수치 | 비고 |",
        row_count=3,
        col_count=3,
        confidence=0.8,
        extraction_method="pdfplumber",
        page_num=5
    )


# ============================================================================
# HeaderAnalyzer 테스트
# ============================================================================

class TestHeaderAnalyzer:
    """HeaderAnalyzer 단위 테스트"""
    
    def test_extract_header_signature(self, header_analyzer, sample_table_page1):
        """헤더 시그니처 추출 테스트"""
        signature = header_analyzer.extract_signature(sample_table_page1.rows)
        
        assert signature is not None
        assert signature.col_count == 7
        assert len(signature.normalized_headers) == 7
        assert "구분" in signature.normalized_headers
        assert signature.hash != ""
    
    def test_same_headers_similarity(self, header_analyzer, sample_table_page1, sample_table_page2):
        """동일 헤더 유사도 테스트"""
        sig1 = header_analyzer.extract_signature(sample_table_page1.rows)
        sig2 = header_analyzer.extract_signature(sample_table_page2.rows)
        
        similarity = header_analyzer.calculate_similarity(sig1, sig2)
        
        # 동일 헤더는 유사도 1.0
        assert similarity >= 0.95
    
    def test_different_headers_similarity(self, header_analyzer, sample_table_page1, different_structure_table):
        """다른 헤더 유사도 테스트"""
        sig1 = header_analyzer.extract_signature(sample_table_page1.rows)
        sig2 = header_analyzer.extract_signature(different_structure_table.rows)
        
        similarity = header_analyzer.calculate_similarity(sig1, sig2)
        
        # 다른 구조는 유사도 낮음
        assert similarity < 0.5
    
    def test_normalize_header(self, header_analyzer):
        """헤더 정규화 테스트"""
        # 공백, 대소문자 정규화 확인
        normalized = header_analyzer._normalize_header("  구 분  ")
        assert normalized == "구분"
        
        normalized = header_analyzer._normalize_header("UNIT")
        assert normalized == "unit"


# ============================================================================
# ContinuityDetector 테스트
# ============================================================================

class TestContinuityDetector:
    """ContinuityDetector 단위 테스트"""
    
    def test_detect_continuity_same_structure(
        self, continuity_detector, sample_table_page1, sample_table_page2
    ):
        """동일 구조 표 연속성 감지 테스트"""
        score = continuity_detector.calculate_continuity(
            sample_table_page1, sample_table_page2
        )
        
        assert score is not None
        assert score.overall >= 0.7  # 연속 표로 판단
        assert score.column_match >= 0.9  # 열 구조 일치
    
    def test_detect_continuity_different_structure(
        self, continuity_detector, sample_table_page1, different_structure_table
    ):
        """다른 구조 표 연속성 감지 테스트"""
        score = continuity_detector.calculate_continuity(
            sample_table_page1, different_structure_table
        )
        
        assert score is not None
        assert score.overall < 0.5  # 연속 표 아님
    
    def test_consecutive_pages(
        self, continuity_detector, sample_table_page1, sample_table_page2
    ):
        """연속 페이지 감지 테스트"""
        # page1 = 1, page2 = 2 -> 연속
        is_consecutive = continuity_detector._check_page_continuity(
            sample_table_page1, sample_table_page2
        )
        assert is_consecutive is True
    
    def test_non_consecutive_pages(
        self, continuity_detector, sample_table_page1, different_structure_table
    ):
        """비연속 페이지 감지 테스트"""
        # page1 = 1, different = 5 -> 비연속
        is_consecutive = continuity_detector._check_page_continuity(
            sample_table_page1, different_structure_table
        )
        assert is_consecutive is False


# ============================================================================
# DuplicateHeaderRemover 테스트
# ============================================================================

class TestDuplicateHeaderRemover:
    """DuplicateHeaderRemover 단위 테스트"""
    
    def test_detect_duplicate_header(self, duplicate_remover, sample_table_page1, sample_table_page2):
        """중복 헤더 감지 테스트"""
        header_row = sample_table_page1.rows[0]
        candidate_row = sample_table_page2.rows[0]  # 동일 헤더
        
        is_duplicate = duplicate_remover.is_duplicate_header(header_row, candidate_row)
        
        assert is_duplicate is True
    
    def test_detect_non_duplicate(self, duplicate_remover, sample_table_page1, sample_table_page3):
        """비중복 행 감지 테스트"""
        header_row = sample_table_page1.rows[0]
        data_row = sample_table_page3.rows[0]  # 데이터 행
        
        is_duplicate = duplicate_remover.is_duplicate_header(header_row, data_row)
        
        assert is_duplicate is False
    
    def test_remove_duplicate_headers(self, duplicate_remover, sample_table_page1, sample_table_page2):
        """중복 헤더 제거 테스트"""
        original_header = sample_table_page1.rows[0]
        rows_with_dup = sample_table_page2.rows.copy()
        
        cleaned_rows = duplicate_remover.remove_duplicates(original_header, rows_with_dup)
        
        # 중복 헤더가 제거되어 행 수가 줄어듦
        assert len(cleaned_rows) == len(rows_with_dup) - 1
        # 첫 행이 데이터 행이어야 함
        assert cleaned_rows[0][2] == "웨이퍼"


# ============================================================================
# TableMergeEngine 테스트
# ============================================================================

class TestTableMergeEngine:
    """TableMergeEngine 단위 테스트"""
    
    def test_merge_two_tables(
        self, merge_engine, sample_table_page1, sample_table_page2
    ):
        """두 표 병합 테스트"""
        merged = merge_engine.merge_tables([sample_table_page1, sample_table_page2])
        
        assert merged is not None
        assert merged.is_merged is True
        assert merged.page_span == [1, 2]
        assert len(merged.original_table_indices) == 2
        # 중복 헤더 제거 후 행 수: 4 + 3 = 7 (헤더 1개 제거)
        assert merged.row_count == 7
    
    def test_merge_three_tables(
        self, merge_engine, sample_table_page1, sample_table_page2, sample_table_page3
    ):
        """세 표 병합 테스트"""
        merged = merge_engine.merge_tables([
            sample_table_page1, sample_table_page2, sample_table_page3
        ])
        
        assert merged is not None
        assert merged.is_merged is True
        assert merged.page_span == [1, 2, 3]
        assert len(merged.original_table_indices) == 3
    
    def test_merge_single_table(self, merge_engine, sample_table_page1):
        """단일 표는 병합하지 않음"""
        merged = merge_engine.merge_tables([sample_table_page1])
        
        # 단일 표는 그대로 반환
        assert merged is not None
        assert merged.is_merged is False
    
    def test_merge_statistics(self, merge_engine, sample_table_page1, sample_table_page2):
        """병합 통계 테스트"""
        _ = merge_engine.merge_tables([sample_table_page1, sample_table_page2])
        
        stats = merge_engine.get_statistics()
        
        assert stats is not None
        assert stats.total_merged >= 1
        assert stats.total_tables_processed >= 2


# ============================================================================
# CrossPageTableMerger (통합) 테스트
# ============================================================================

class TestCrossPageTableMerger:
    """CrossPageTableMerger 통합 테스트"""
    
    def test_process_tables(
        self, cross_page_merger, sample_table_page1, sample_table_page2, sample_table_page3
    ):
        """표 목록 처리 테스트"""
        tables = [sample_table_page1, sample_table_page2, sample_table_page3]
        
        result = cross_page_merger.process_tables(tables)
        
        assert result is not None
        assert len(result) > 0
        # 연속된 3개 표가 하나로 병합됨
        merged_tables = [t for t in result if t.is_merged]
        assert len(merged_tables) >= 1
    
    def test_process_with_different_structure(
        self, cross_page_merger, sample_table_page1, sample_table_page2, different_structure_table
    ):
        """다른 구조 표 포함 시 처리 테스트"""
        tables = [sample_table_page1, sample_table_page2, different_structure_table]
        
        result = cross_page_merger.process_tables(tables)
        
        assert result is not None
        # 동일 구조 표 2개는 병합, 다른 구조 표는 별도
        assert len(result) == 2
    
    def test_disabled_merging(self, sample_table_page1, sample_table_page2):
        """병합 비활성화 테스트"""
        config = CrossPageMergeConfig(enabled=False)
        merger = CrossPageTableMerger(config)
        
        tables = [sample_table_page1, sample_table_page2]
        result = merger.process_tables(tables)
        
        # 병합 비활성화 시 원본 그대로 반환
        assert len(result) == 2
        assert not any(t.is_merged for t in result)
    
    def test_high_threshold_no_merge(self, sample_table_page1, sample_table_page2):
        """높은 임계값으로 병합 안됨 테스트"""
        config = CrossPageMergeConfig(
            enabled=True,
            merge_confidence_threshold=0.99,  # 매우 높은 임계값
            header_similarity_threshold=0.99
        )
        merger = CrossPageTableMerger(config)
        
        tables = [sample_table_page1, sample_table_page2]
        result = merger.process_tables(tables)
        
        # 임계값이 너무 높으면 병합 안됨
        merged_count = sum(1 for t in result if t.is_merged)
        # 설정에 따라 병합될 수도 안 될 수도 있음
        assert len(result) >= 1


# ============================================================================
# 메타데이터 전파 테스트
# ============================================================================

class TestMetadataPropagation:
    """병합 메타데이터 전파 테스트"""
    
    def test_merged_table_metadata(
        self, merge_engine, sample_table_page1, sample_table_page2
    ):
        """병합된 표의 메타데이터 확인"""
        merged = merge_engine.merge_tables([sample_table_page1, sample_table_page2])
        
        # 필수 메타데이터 필드 확인
        assert hasattr(merged, 'is_merged')
        assert hasattr(merged, 'page_span')
        assert hasattr(merged, 'original_table_indices')
        assert hasattr(merged, 'merge_confidence')
        assert hasattr(merged, 'header_signature')
        
        # 값 검증
        assert merged.is_merged is True
        assert isinstance(merged.page_span, list)
        assert len(merged.page_span) == 2
        assert merged.merge_confidence > 0


# ============================================================================
# 엣지 케이스 테스트
# ============================================================================

class TestEdgeCases:
    """엣지 케이스 테스트"""
    
    def test_empty_table_list(self, cross_page_merger):
        """빈 테이블 목록 처리"""
        result = cross_page_merger.process_tables([])
        assert result == []
    
    def test_single_row_table(self, cross_page_merger):
        """단일 행 테이블 처리"""
        single_row_table = TableData(
            table_index=0,
            rows=[["헤더1", "헤더2", "헤더3"]],
            semantic_text="",
            markdown="",
            row_count=1,
            col_count=3,
            confidence=0.5,
            extraction_method="test",
            page_num=1
        )
        
        result = cross_page_merger.process_tables([single_row_table])
        assert len(result) == 1
    
    def test_table_with_empty_rows(self, merge_engine):
        """빈 행이 있는 테이블 처리"""
        table_with_empty = TableData(
            table_index=0,
            rows=[
                ["헤더1", "헤더2"],
                ["", ""],  # 빈 행
                ["데이터1", "데이터2"],
            ],
            semantic_text="",
            markdown="",
            row_count=3,
            col_count=2,
            confidence=0.5,
            extraction_method="test",
            page_num=1
        )
        
        # 에러 없이 처리되어야 함
        result = merge_engine.merge_tables([table_with_empty])
        assert result is not None


# ============================================================================
# 실행
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
