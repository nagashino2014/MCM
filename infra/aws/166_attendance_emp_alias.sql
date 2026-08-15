-- 166: 근태 사번 별칭 — 지사(울산) 단말의 독립 사번 체계 수용 (2026-08-15)
--
-- 문제: 울산지사 근태 단말이 본사와 **별개의 사번 체계**를 쓴다(울산 0005=이홍길인데 본사 0005=이일국).
--       지사 파일을 그대로 올리면 (adt_emp_no, work_date) PK 가 겹쳐 본사 직원의 근태를 덮어썼다.
--       실측 오염: 0004(권오종↔신석헌)·0008(한도경↔최태헌) 등 5명.
-- 해결: 파서가 지사 파일(부서 컬럼 없는 개인 조회본)의 사번에 'U' 접두어를 붙여 네임스페이스를 분리하고,
--       이 표로 별칭↔직원을 매핑한다(직원 1명이 본사·지사 사번을 함께 가질 수 있다).
CREATE TABLE IF NOT EXISTS attendance_emp_aliases (
  adt_emp_no  text PRIMARY KEY,                 -- 예: 'U0005'
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  site        text,                             -- 'ulsan' 등 근무지 구분(표시용)
  note        text,
  created_at  text NOT NULL DEFAULT now()::text
);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_aliases_emp ON attendance_emp_aliases(employee_id);

-- 울산지사 단말 사번 시딩(2026-05 기준). 최태헌은 당시 울산 근무 후 본사 복귀 —
-- 복귀 후 본사 사번(0020)은 employee_profiles.adt_emp_no 로 계속 매칭된다.
INSERT INTO attendance_emp_aliases (adt_emp_no, employee_id, site, note)
SELECT v.alias, p.employee_id, 'ulsan', v.note
  FROM (VALUES
    ('U0005', '이홍길', '울산지사'),
    ('U0007', '김민지', '울산지사'),
    ('U0009', '김성은', '울산지사'),
    ('U0008', '최태헌', '2026-05 당시 울산지사 근무(이후 본사 복귀)'),
    ('U0004', '신석헌', '울산지사(퇴사)')
  ) AS v(alias, name, note)
  JOIN employee_profiles p ON p.name = v.name
ON CONFLICT (adt_emp_no) DO NOTHING;

-- 이홍길의 프로필 ADT 사번이 울산 단말 번호(0005)로 잘못 등록돼 본사 0005(이일국) 근태와 섞였다.
-- 본사 통합본 기준 번호(0064)로 정정한다.
UPDATE employee_profiles SET adt_emp_no = '0064'
 WHERE name = '이홍길' AND adt_emp_no = '0005';
