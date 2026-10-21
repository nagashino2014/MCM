-- 304: 전사 문서함 폴더 열람 제한 — 인사·회계·성과급·근태 폴더는 관리자·인사/회계·대표이사만(2026-10-21 사용자 결정).
--
-- 배경: 전사 문서함(문서함 > 전자결재 > 전사 문서함)은 양식의 org_folder 가 지정된 승인 완료 문서를 전 직원에게 보여 주고,
--   resolveDocAccess(lib/approval/access.ts)도 "승인 + org_folder 지정"이면 누구나 상세를 열게 했다. 그 결과 퇴직원·휴직원·
--   인사 발령·증명신청·근로계약·지출 결의·구매품의·성과급 계획·초과근무 신청까지 전 직원에게 열려 있었다(2026-10-21 실측).
--   견적·계약·공문 등 과거 대외 문서는 전 직원이 확인해야 하므로 폴더 단위로 열람 범위를 둔다.
-- 규칙: restricted=1 폴더는 approval.manage(시스템 관리자·인사/회계·권한관리) 또는 approval.read_all(대표이사·시스템 관리자)
--   보유자만 전사 문서함에서 보고 상세를 연다. 기안자·결재선·참조자·같은 부서의 기존 열람 경로는 그대로다.
-- 폴더 단위로 두어 양식 빌더로 같은 폴더에 새 양식을 만들어도 제한이 따라간다. 표에 없는 폴더 = 전 직원 열람. 멱등.

CREATE TABLE IF NOT EXISTS approval_org_folder_policies (
  org_folder text PRIMARY KEY,
  restricted smallint NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
  note text,
  updated_at text NOT NULL
);

INSERT INTO approval_org_folder_policies (org_folder, restricted, note, updated_at)
SELECT v.folder, 1, v.note, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('인사 문서',   '인사 발령·퇴직·휴직·증명·근로계약·연차수당 — 304'),
               ('회계 문서',   '지출 결의·구매품의·전문가활용비 — 304'),
               ('성과급 문서', '성과급 지급 계획 — 304'),
               ('근태 문서',   '초과근무·휴가·결근 — 304')) AS v(folder, note)
ON CONFLICT (org_folder) DO NOTHING;

-- 점검(읽기 전용):
--   SELECT f.org_folder, COALESCE(p.restricted, 0) AS restricted, count(*) AS forms
--     FROM approval_forms f LEFT JOIN approval_org_folder_policies p ON p.org_folder = f.org_folder
--    WHERE f.org_folder IS NOT NULL AND f.org_folder <> '' GROUP BY 1, 2 ORDER BY 2 DESC, 1;
