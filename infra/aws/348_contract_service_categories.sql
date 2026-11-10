-- 348: 계약 용역 대분류·세분류 단일 원천(contract_service_types·contract_service_subtypes) + 관리 화면 권한.
--   (2026-11-10 사용자 요청 — 계약 메뉴의 용역 대분류·세분류를 코드 수정 없이 관리자가 추가·이름 변경·순서 변경·
--    삭제(사용 중지)할 수 있는 설정 메뉴. 관리 화면: /admin/contract-service-categories)
-- 배경: 분류 목록이 frontend 코드 상수 두 벌(lib/contracts/service-options.ts CONTRACT_SERVICE_OPTIONS,
--   lib/quote/types.ts QUOTE_SERVICE_OPTIONS)에 있었다. 계약·견적·계약서 화면은 이 표를 읽고, 표가 없으면(적용 전)
--   코드 기본 목록으로 동작한다.
-- 저장 방식(바꾸지 않음): contracts·quotations·quote_rate_sets·agreement_templates·contract_agreements 는 분류를
--   이름 문자열(service_type·service_subtype)로 저장한다. 이 표는 선택 목록·순서·사용 여부의 원천이다.
-- 결정(2026-11-10 사용자 확정)
--   이름 변경 : 세분류 이름을 바꾸면 위 표들에 저장된 옛 이름을 같은 트랜잭션에서 새 이름으로 바꾸고, 옛 이름은 aliases 에 남긴다.
--   삭제      : 어디에도 쓰이지 않았으면 실제 삭제, 쓰였으면 사용 중지(새 입력 목록에서만 빠짐, 기존 값·표시는 그대로).
--   대분류    : 추가·순서·사용 중지만. 기본 5개는 lock_reason 이 있어 이름을 바꿀 수 없다(견적번호 종류·성과급 부서 귀속·
--              할 일 업무 유형·영업 발굴 매핑·결재 약칭·계약 트리 색이 이름에 묶여 있다). 새로 추가한 대분류는 이름 변경 가능.
--   lock_reason : 이름을 고정하는 이유(NULL 이면 변경 가능). 사용 중지·순서 변경은 막지 않는다.
-- 선행: 012(permissions·permission_templates·tpl-system-admin). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS contract_service_types (
  type_id     text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  lock_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_service_types_label_uq ON contract_service_types (label);

CREATE TABLE IF NOT EXISTS contract_service_subtypes (
  subtype_id  text PRIMARY KEY,
  type_id     text NOT NULL REFERENCES contract_service_types (type_id) ON DELETE CASCADE,
  label       text NOT NULL,
  aliases     jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  lock_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_service_subtypes_type_label_uq ON contract_service_subtypes (type_id, label);

-- ── 1) 기존 목록 시드 — 코드 기본값(lib/contracts/service-options.ts)과 같다. 이미 있는 행은 건드리지 않는다 ──
INSERT INTO contract_service_types (type_id, label, sort_order, lock_reason)
VALUES
  ('integrated-permit', '통합허가', 10, '견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.'),
  ('chem', '장외&화관법', 20, '견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.'),
  ('haps', 'HAPs', 30, '견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.'),
  ('esg', 'ESG탄소중립', 40, '견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.'),
  ('etc', '기타', 50, '견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.')
ON CONFLICT (type_id) DO NOTHING;

INSERT INTO contract_service_subtypes (subtype_id, type_id, label, sort_order, lock_reason)
SELECT s.type_id || '-' || s.ord, s.type_id, s.label, s.ord * 10,
       CASE WHEN s.type_id = 'integrated-permit' AND s.label IN ('최초허가', '변경허가', '재검토')
            THEN '계약 상세의 허가번호 입력이 이 세분류에서만 켜집니다.' END
  FROM (
    SELECT 'integrated-permit' AS type_id, t.label, t.ord
      FROM unnest(ARRAY['최초허가', '변경허가', '변경신고', '통합교육', '사후관리', '재검토']) WITH ORDINALITY AS t(label, ord)
    UNION ALL
    SELECT 'chem', t.label, t.ord
      FROM unnest(ARRAY['영업허가', '화학사고예방관리계획', '설치검사', '화관법기준', '위해관리계획', '배출저감계획',
                        '배출량조사', '판매업허가', '정기검사', '안전진단']) WITH ORDINALITY AS t(label, ord)
    UNION ALL
    SELECT 'haps', t.label, t.ord
      FROM unnest(ARRAY['HAPs', 'HAPs최초', 'HAPs변경', 'HAPs연간', '시설구축', '명판부착', '배출저감', '정기점검대응'])
           WITH ORDINALITY AS t(label, ord)
    UNION ALL
    SELECT 'esg', t.label, t.ord
      FROM unnest(ARRAY['ESG탄소중립', 'ESG경영', 'CBAM', '공급망실사', 'LCA평가', '배출량산정', '배출권관련'])
           WITH ORDINALITY AS t(label, ord)
    UNION ALL
    SELECT 'etc', t.label, t.ord
      FROM unnest(ARRAY['기타', '총량제신고', '매체별인허가', '환경자문', '환경R&D', '기타인허가']) WITH ORDINALITY AS t(label, ord)
  ) s
 WHERE EXISTS (SELECT 1 FROM contract_service_types ty WHERE ty.type_id = s.type_id)
   AND NOT EXISTS (
     SELECT 1 FROM contract_service_subtypes x WHERE x.type_id = s.type_id AND x.label = s.label
   )
ON CONFLICT (subtype_id) DO NOTHING;

-- ── 2) 관리 화면 권한(/admin/contract-service-categories) — 시스템 관리자에게만. 목록 읽기는 로그인 사용자 전원 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('master.contract_service.manage', 'master', 'contract_service_manage', '계약 용역 대분류·세분류 추가·이름 변경·순서·사용 중지(/admin/contract-service-categories)', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('master.contract_service.manage'), 1, 16),
       'tpl-system-admin', 'master.contract_service.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'master.contract_service.manage'
   );
