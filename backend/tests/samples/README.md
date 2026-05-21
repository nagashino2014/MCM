# 테스트 샘플 파일

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

## 참고사항

- 테스트 파일이 없으면 해당 테스트는 자동으로 스킵됩니다.
- 테스트 파일은 저작권 문제로 Git에 포함되지 않습니다.
- 실제 테스트를 위해 표가 포함된 HWP/HWPX 문서를 직접 준비하세요.
