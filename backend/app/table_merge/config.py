"""
Cross-page Table Merging Configuration

표 병합 관련 설정을 정의합니다.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CrossPageMergeConfig:
    """Cross-page 표 병합 설정"""
    
    # 기본 설정
    enabled: bool = True
    
    # 연속성 감지 임계값
    min_column_match_threshold: float = 0.85  # 최소 열 일치도 (85%)
    min_width_ratio_tolerance: float = 0.15   # 열 너비 비율 허용 오차 (15%)
    
    # 헤더 분석 설정
    max_header_row_count: int = 3             # 최대 헤더 행 수
    enable_header_dedup: bool = True          # 중복 헤더 제거 활성화
    header_similarity_threshold: float = 0.90 # 헤더 유사도 임계값 (90%)
    
    # 병합 설정
    merge_confidence_threshold: float = 0.70  # 병합 신뢰도 임계값 (70%)
    max_merge_gap_pages: int = 1              # 최대 페이지 간격 (연속되지 않은 페이지 허용)
    
    # 위치 기반 분석 설정 (PDF용)
    pdf_use_bbox_analysis: bool = True        # bbox 기반 연속성 분석 사용
    pdf_position_tolerance: float = 50.0      # 위치 허용 오차 (픽셀)
    pdf_page_bottom_threshold: float = 0.85   # 페이지 하단 기준 (85%)
    pdf_page_top_threshold: float = 0.15      # 페이지 상단 기준 (15%)
    
    # 파일 형식별 설정
    hwp_section_as_page: bool = True          # HWP 섹션을 페이지로 간주
    hwp_detect_page_break_tag: bool = True    # HWP 페이지 브레이크 태그 감지
    docx_detect_page_break: bool = True       # DOCX 페이지 브레이크 감지
    
    # 데이터 패턴 분석 설정
    enable_data_pattern_analysis: bool = True # 데이터 패턴 분석 활성화
    min_data_pattern_match: float = 0.60      # 최소 데이터 패턴 일치도 (60%)
    
    # 디버그/로깅
    debug_mode: bool = False                  # 상세 로깅 활성화
    save_merge_log: bool = True               # 병합 로그 저장
    
    def to_dict(self) -> dict:
        """설정을 딕셔너리로 변환"""
        return {
            "enabled": self.enabled,
            "min_column_match_threshold": self.min_column_match_threshold,
            "min_width_ratio_tolerance": self.min_width_ratio_tolerance,
            "max_header_row_count": self.max_header_row_count,
            "enable_header_dedup": self.enable_header_dedup,
            "header_similarity_threshold": self.header_similarity_threshold,
            "merge_confidence_threshold": self.merge_confidence_threshold,
            "max_merge_gap_pages": self.max_merge_gap_pages,
            "pdf_use_bbox_analysis": self.pdf_use_bbox_analysis,
            "pdf_position_tolerance": self.pdf_position_tolerance,
            "pdf_page_bottom_threshold": self.pdf_page_bottom_threshold,
            "pdf_page_top_threshold": self.pdf_page_top_threshold,
            "hwp_section_as_page": self.hwp_section_as_page,
            "hwp_detect_page_break_tag": self.hwp_detect_page_break_tag,
            "docx_detect_page_break": self.docx_detect_page_break,
            "enable_data_pattern_analysis": self.enable_data_pattern_analysis,
            "min_data_pattern_match": self.min_data_pattern_match,
            "debug_mode": self.debug_mode,
            "save_merge_log": self.save_merge_log,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "CrossPageMergeConfig":
        """딕셔너리에서 설정 생성"""
        return cls(
            enabled=data.get("enabled", True),
            min_column_match_threshold=data.get("min_column_match_threshold", 0.85),
            min_width_ratio_tolerance=data.get("min_width_ratio_tolerance", 0.15),
            max_header_row_count=data.get("max_header_row_count", 3),
            enable_header_dedup=data.get("enable_header_dedup", True),
            header_similarity_threshold=data.get("header_similarity_threshold", 0.90),
            merge_confidence_threshold=data.get("merge_confidence_threshold", 0.70),
            max_merge_gap_pages=data.get("max_merge_gap_pages", 1),
            pdf_use_bbox_analysis=data.get("pdf_use_bbox_analysis", True),
            pdf_position_tolerance=data.get("pdf_position_tolerance", 50.0),
            pdf_page_bottom_threshold=data.get("pdf_page_bottom_threshold", 0.85),
            pdf_page_top_threshold=data.get("pdf_page_top_threshold", 0.15),
            hwp_section_as_page=data.get("hwp_section_as_page", True),
            hwp_detect_page_break_tag=data.get("hwp_detect_page_break_tag", True),
            docx_detect_page_break=data.get("docx_detect_page_break", True),
            enable_data_pattern_analysis=data.get("enable_data_pattern_analysis", True),
            min_data_pattern_match=data.get("min_data_pattern_match", 0.60),
            debug_mode=data.get("debug_mode", False),
            save_merge_log=data.get("save_merge_log", True),
        )
    
    @classmethod
    def create_strict(cls) -> "CrossPageMergeConfig":
        """엄격한 병합 설정 (높은 정확도)"""
        return cls(
            min_column_match_threshold=0.95,
            header_similarity_threshold=0.95,
            merge_confidence_threshold=0.85,
            max_merge_gap_pages=0,
        )
    
    @classmethod
    def create_relaxed(cls) -> "CrossPageMergeConfig":
        """느슨한 병합 설정 (높은 재현율)"""
        return cls(
            min_column_match_threshold=0.70,
            header_similarity_threshold=0.80,
            merge_confidence_threshold=0.55,
            max_merge_gap_pages=2,
        )
