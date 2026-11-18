-- 370 회사소개서 — 통합허가 완료 사업장 수(외부 수치, 허가 사업장 대비 비율의 분모) 1,307 → 1,344개소(사용자 지시 2026-11-18).
-- 멱등: 같은 값이면 다시 바꾸지 않는다. 표는 310_catalog_data_meta.sql. 화면에서 고치는 곳이 없어 마이그레이션으로 갱신한다.
UPDATE catalog_external_figures
SET value = 1344,
    source = '사용자 지시(2026-11-18) — 회사소개서 기재값',
    as_of = '2026-11',
    note = '원 출처(환경부 통합환경허가시스템) 확인 필요',
    updated_by = 'migration-370',
    updated_at = now()::text
WHERE figure_key = 'permit.sites.total'
  AND value IS DISTINCT FROM 1344;
