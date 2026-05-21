"""
Cross-page Table Merging E2E 테스트

통합환경관리 계획서 PDF를 사용하여 실제 Cross-page 표 병합 기능을 테스트합니다.

테스트 대상 파일:
- [에이에스이코리아] 제5장 연료원료등 사용물질-페이지.pdf
- 5페이지에 걸친 물질수지 표 포함

테스트 항목:
1. PDF에서 표 추출
2. Cross-page 표 병합
3. 병합 메타데이터 확인
4. 청킹 시 메타데이터 전파
"""
import os
import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Any

# 프로젝트 루트 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.extractors.pdf_extractor import PDFExtractor
from app.extractors.base import TableData, ExtractionStatus
from app.table_merge.cross_page_merger import CrossPageTableMerger
from app.table_merge.config import CrossPageMergeConfig
from app.services.extraction_service import ExtractionService
from app.config import ExtractionConfig, default_config


# ============================================================================
# 테스트 설정
# ============================================================================

# 테스트 PDF 파일 경로
TEST_PDF_PATH = r"C:\Users\nagas\Downloads\[에이에스이코리아] 제5장 연료원료등 사용물질-페이지.pdf"

# 결과 출력 디렉토리
OUTPUT_DIR = Path(__file__).parent / "test_output"


def ensure_output_dir():
    """출력 디렉토리 생성"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def print_section(title: str):
    """섹션 구분선 출력"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def print_result(label: str, value: Any, indent: int = 0):
    """결과 출력"""
    prefix = "  " * indent
    print(f"{prefix}{label}: {value}")


# ============================================================================
# 테스트 1: PDF 표 추출
# ============================================================================

def test_pdf_table_extraction() -> List[TableData]:
    """
    PDF에서 표 추출 테스트
    
    Returns:
        추출된 TableData 목록
    """
    print_section("테스트 1: PDF 표 추출")
    
    if not os.path.exists(TEST_PDF_PATH):
        print(f"[ERROR] 테스트 파일을 찾을 수 없습니다: {TEST_PDF_PATH}")
        return []
    
    print(f"테스트 파일: {TEST_PDF_PATH}")
    
    # PDF 추출기 초기화
    config = default_config
    extractor = PDFExtractor(config)
    
    print("\nPDF 추출 시작...")
    start_time = time.time()
    
    # 추출 실행
    result = extractor.extract(TEST_PDF_PATH)
    
    elapsed = time.time() - start_time
    print(f"추출 완료 (소요 시간: {elapsed:.2f}초)")
    
    # 결과 출력
    print_result("추출 상태", result.status)
    print_result("페이지 수", result.page_count)
    print_result("품질 점수", f"{result.quality_score:.4f}" if result.quality_score else "N/A")
    
    # 추출된 표 수집
    all_tables = []
    for page in result.pages:
        if page.tables:
            for table in page.tables:
                all_tables.append(table)
                print(f"\n  [표 {table.table_index}] 페이지 {table.page_num}")
                print(f"    - 행 수: {table.row_count}")
                print(f"    - 열 수: {table.col_count}")
                print(f"    - 신뢰도: {table.confidence:.2f}")
                print(f"    - 추출 방법: {table.extraction_method}")
    
    print(f"\n총 추출된 표 수: {len(all_tables)}")
    
    return all_tables


# ============================================================================
# 테스트 2: Cross-page 표 병합
# ============================================================================

def test_cross_page_merging(tables: List[TableData]) -> List[TableData]:
    """
    Cross-page 표 병합 테스트
    
    Args:
        tables: 추출된 표 목록
        
    Returns:
        병합된 표 목록
    """
    print_section("테스트 2: Cross-page 표 병합")
    
    if not tables:
        print("[SKIP] 추출된 표가 없습니다.")
        return []
    
    # Cross-page 병합기 초기화 (디버그 모드 활성화)
    config = CrossPageMergeConfig(
        enabled=True,
        min_column_match_threshold=0.85,
        header_similarity_threshold=0.90,
        merge_confidence_threshold=0.70,
        enable_header_dedup=True,
        debug_mode=True,  # 디버그 모드 활성화
    )
    merger = CrossPageTableMerger(config)
    
    print(f"입력 표 수: {len(tables)}")
    print("\n병합 설정:")
    print_result("열 일치 임계값", config.min_column_match_threshold, 1)
    print_result("헤더 유사도 임계값", config.header_similarity_threshold, 1)
    print_result("병합 신뢰도 임계값", config.merge_confidence_threshold, 1)
    print_result("중복 헤더 제거", config.enable_header_dedup, 1)
    print_result("디버그 모드", config.debug_mode, 1)
    
    # 표 목록을 페이지별로 그룹화하여 mock ExtractionResult 생성
    from app.extractors.base import ExtractionResult, ExtractionStatus, PageResult, ExtractionMethod
    from app.table_merge.continuity_detector import ContinuityDetector, TableCandidate
    
    # 페이지별로 그룹화
    pages_dict = {}
    for table in tables:
        page_num = table.page_num if table.page_num else 1
        if page_num not in pages_dict:
            pages_dict[page_num] = []
        pages_dict[page_num].append(table)
    
    # PageResult 목록 생성
    page_results = []
    for page_num in sorted(pages_dict.keys()):
        page_tables = pages_dict[page_num]
        page_results.append(PageResult(
            page_num=page_num,
            text="",
            method=ExtractionMethod.TEXT_LAYER,
            has_tables=True,
            tables=page_tables
        ))
    
    # ==== 디버그: 연속성 분석 상세 출력 ====
    print("\n" + "-" * 50)
    print("  연속성 분석 상세 (디버그)")
    print("-" * 50)
    
    # TableCandidate 목록 생성
    candidates = []
    for table in tables:
        candidate = TableCandidate(
            table_index=table.table_index,
            page_num=table.page_num if table.page_num else 1,
            rows=table.rows,
            bbox=table.bbox,
            row_count=table.row_count,
            col_count=table.col_count,
            confidence=table.confidence,
            extraction_method=table.extraction_method,
        )
        candidates.append(candidate)
        print(f"\n[표 {candidate.table_index}] 페이지 {candidate.page_num}")
        print(f"  행/열: {candidate.row_count} x {candidate.col_count}")
        print(f"  bbox: {candidate.bbox}")
        if candidate.rows:
            # 첫 행 (헤더) 출력
            header_preview = [str(c)[:15] for c in candidate.rows[0][:5]]
            print(f"  헤더: {header_preview}...")
    
    # 연속성 분석 수행
    detector = ContinuityDetector(config)
    
    print("\n[연속성 점수 분석]")
    for i in range(len(candidates) - 1):
        table1 = candidates[i]
        table2 = candidates[i + 1]
        
        score = detector.detect_continuity(table1, table2, page_height=None)
        
        print(f"\n  표 {table1.table_index} (p{table1.page_num}) -> 표 {table2.table_index} (p{table2.page_num}):")
        print(f"    column_match_score: {score.column_match_score:.4f}")
        print(f"    header_similarity:  {score.header_similarity:.4f}")
        print(f"    position_continuity: {score.position_continuity:.4f}")
        print(f"    data_pattern_match: {score.data_pattern_match:.4f}")
        print(f"    header_repetition:  {score.header_repetition}")
        print(f"    page_gap:           {score.page_gap}")
        print(f"    ----------------------")
        print(f"    overall_score:      {score.overall_score:.4f}")
        print(f"    is_continuation:    {score.is_continuation}")
        if not score.is_continuation:
            rejection = score.details.get("rejection_reason", "알 수 없음")
            print(f"    거부 사유:          {rejection}")
    
    print("\n" + "-" * 50)
    
    # Mock ExtractionResult 생성
    mock_result = ExtractionResult(
        file_path="test.pdf",
        file_format="pdf",
        status=ExtractionStatus.COMPLETED,
        text="",
        pages=page_results,
        page_count=len(page_results),
        quality_score=0.9
    )
    
    print("\n병합 처리 시작...")
    start_time = time.time()
    
    # 병합 실행
    merged_result = merger.process(mock_result)
    
    elapsed = time.time() - start_time
    print(f"병합 완료 (소요 시간: {elapsed:.4f}초)")
    
    # 결과에서 모든 표 추출
    merged_tables = []
    for page in merged_result.pages:
        if page.tables:
            merged_tables.extend(page.tables)
    
    # 결과 분석
    merged_count = sum(1 for t in merged_tables if getattr(t, 'is_merged', False))
    non_merged_count = len(merged_tables) - merged_count
    
    print(f"\n결과:")
    print_result("출력 표 수", len(merged_tables))
    print_result("병합된 표 수", merged_count)
    print_result("비병합 표 수", non_merged_count)
    
    # 병합된 표 상세 정보
    for table in merged_tables:
        if getattr(table, 'is_merged', False):
            print(f"\n  [병합된 표] 인덱스: {table.table_index}")
            print_result("페이지 범위", getattr(table, 'page_span', None), 2)
            print_result("원본 표 인덱스", getattr(table, 'original_table_indices', None), 2)
            print_result("총 행 수", table.row_count, 2)
            print_result("총 열 수", table.col_count, 2)
            print_result("병합 신뢰도", f"{getattr(table, 'merge_confidence', 0):.4f}", 2)
            sig = getattr(table, 'header_signature', '')
            print_result("헤더 시그니처", sig[:32] + "..." if sig else "N/A", 2)
    
    return merged_tables


# ============================================================================
# 테스트 3: 병합 메타데이터 검증
# ============================================================================

def test_merge_metadata(merged_tables: List[TableData]) -> bool:
    """
    병합 메타데이터 검증 테스트
    
    Args:
        merged_tables: 병합된 표 목록
        
    Returns:
        테스트 통과 여부
    """
    print_section("테스트 3: 병합 메타데이터 검증")
    
    if not merged_tables:
        print("[SKIP] 병합된 표가 없습니다.")
        return False
    
    all_passed = True
    
    for table in merged_tables:
        if not table.is_merged:
            continue
        
        print(f"\n[표 {table.table_index}] 메타데이터 검증:")
        
        # 필수 필드 확인
        checks = [
            ("is_merged", table.is_merged is True, table.is_merged),
            ("page_span", isinstance(table.page_span, list) and len(table.page_span) > 1, table.page_span),
            ("original_table_indices", isinstance(table.original_table_indices, list), table.original_table_indices),
            ("merge_confidence", 0 <= table.merge_confidence <= 1, table.merge_confidence),
            ("header_signature", isinstance(table.header_signature, str) and len(table.header_signature) > 0, table.header_signature[:16] + "..." if table.header_signature else None),
        ]
        
        for field_name, passed, value in checks:
            status = "PASS" if passed else "FAIL"
            print(f"  {status}: {field_name} = {value}")
            if not passed:
                all_passed = False
    
    print(f"\n전체 결과: {'PASS' if all_passed else 'FAIL'}")
    return all_passed


# ============================================================================
# 테스트 4: ExtractionService 통합 테스트
# ============================================================================

def test_extraction_service_integration() -> bool:
    """
    ExtractionService를 통한 전체 파이프라인 테스트
    
    Returns:
        테스트 통과 여부
    """
    print_section("테스트 4: ExtractionService 통합 테스트")
    
    if not os.path.exists(TEST_PDF_PATH):
        print(f"[ERROR] 테스트 파일을 찾을 수 없습니다: {TEST_PDF_PATH}")
        return False
    
    # ExtractionService 초기화
    config = default_config
    service = ExtractionService(config)
    
    print(f"테스트 파일: {TEST_PDF_PATH}")
    print("\n추출 서비스 실행 중...")
    
    start_time = time.time()
    
    # 추출 실행
    result = service.extract_file(TEST_PDF_PATH)
    
    elapsed = time.time() - start_time
    print(f"완료 (소요 시간: {elapsed:.2f}초)")
    
    # 결과 검증
    print(f"\n추출 결과:")
    print_result("상태", result.status)
    print_result("품질 점수", f"{result.quality_score:.4f}" if result.quality_score else "N/A")
    
    # 표 병합 결과 확인
    merged_tables = []
    for page in result.pages:
        if page.tables:
            for table in page.tables:
                if table.is_merged:
                    merged_tables.append(table)
    
    print(f"\n병합된 표 수: {len(merged_tables)}")
    
    success = result.status == ExtractionStatus.COMPLETED and len(merged_tables) > 0
    
    if success:
        print("\n[PASS] ExtractionService 통합 테스트 성공")
        
        # 병합된 표 정보 출력
        for table in merged_tables:
            print(f"\n  [병합된 표]")
            print_result("페이지 범위", table.page_span, 2)
            print_result("행 수", table.row_count, 2)
            print_result("병합 신뢰도", f"{table.merge_confidence:.4f}", 2)
    else:
        print("\n[FAIL] ExtractionService 통합 테스트 실패")
    
    return success


# ============================================================================
# 테스트 5: 결과 저장 및 검증
# ============================================================================

def test_save_and_verify(merged_tables: List[TableData]) -> bool:
    """
    병합 결과 저장 및 검증 테스트
    
    Args:
        merged_tables: 병합된 표 목록
        
    Returns:
        테스트 통과 여부
    """
    print_section("테스트 5: 결과 저장 및 검증")
    
    ensure_output_dir()
    
    if not merged_tables:
        print("[SKIP] 저장할 표가 없습니다.")
        return False
    
    # 병합된 표를 JSON으로 저장
    output_file = OUTPUT_DIR / "merged_tables_result.json"
    
    result_data = []
    for table in merged_tables:
        table_dict = {
            "table_index": table.table_index,
            "is_merged": table.is_merged,
            "page_num": table.page_num,
            "page_span": table.page_span,
            "original_table_indices": table.original_table_indices,
            "row_count": table.row_count,
            "col_count": table.col_count,
            "merge_confidence": table.merge_confidence,
            "header_signature": table.header_signature,
            "extraction_method": table.extraction_method,
            # 첫 5행만 샘플로 저장
            "sample_rows": table.rows[:5] if table.rows else [],
        }
        result_data.append(table_dict)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)
    
    print(f"결과 저장 완료: {output_file}")
    
    # 저장된 파일 검증
    with open(output_file, 'r', encoding='utf-8') as f:
        loaded_data = json.load(f)
    
    if len(loaded_data) == len(result_data):
        print("[PASS] 저장된 데이터 검증 성공")
        return True
    else:
        print("[FAIL] 저장된 데이터 검증 실패")
        return False


# ============================================================================
# 메인 실행
# ============================================================================

def run_all_tests():
    """모든 테스트 실행"""
    print("\n" + "=" * 70)
    print("  Cross-page Table Merging E2E 테스트")
    print("  통합환경관리 계획서 PDF 테스트")
    print("=" * 70)
    
    results = {}
    
    # 테스트 1: PDF 표 추출
    tables = test_pdf_table_extraction()
    results["pdf_extraction"] = len(tables) > 0
    
    if not tables:
        print("\n[ERROR] 표 추출 실패로 후속 테스트를 진행할 수 없습니다.")
        return results
    
    # 테스트 2: Cross-page 표 병합
    merged_tables = test_cross_page_merging(tables)
    results["cross_page_merge"] = len(merged_tables) > 0
    
    # 테스트 3: 병합 메타데이터 검증
    results["metadata_validation"] = test_merge_metadata(merged_tables)
    
    # 테스트 4: ExtractionService 통합 테스트
    results["extraction_service"] = test_extraction_service_integration()
    
    # 테스트 5: 결과 저장 및 검증
    results["save_and_verify"] = test_save_and_verify(merged_tables)
    
    # 최종 결과 요약
    print_section("테스트 결과 요약")
    
    all_passed = True
    for test_name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {status}: {test_name}")
        if not passed:
            all_passed = False
    
    print("\n" + "-" * 70)
    if all_passed:
        print("  [SUCCESS] 모든 테스트 통과!")
    else:
        print("  [FAILURE] 일부 테스트 실패")
    print("-" * 70)
    
    return results


if __name__ == "__main__":
    results = run_all_tests()
    
    # 실패한 테스트가 있으면 exit code 1
    if not all(results.values()):
        sys.exit(1)
