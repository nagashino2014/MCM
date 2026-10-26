-- 312: 회사소개서 발행·변경 감지(P7) — 전 직원 발행본 열람 권한 + 변경 감지 상태 + 반영 대기 중복 방지 + 배포 기록.
--   (docs/company-catalog-blueprint.md §6-1·§6-6·§6-7·§12 P7, 2026-10-26)
-- 선행: 309(catalog_documents·catalog_editions·catalog_pending_changes·catalog.view), 012(tpl-staff-basic). 멱등.
-- 발행본(catalog_editions.options.stage = 'published')은 PDF·데이터 스냅샷·지문을 고정 보관한다. 이 파일은 표 구조를 바꾸지 않고
--   보조 표·인덱스·권한만 더한다.

-- ── 1) 전 직원 발행본 열람(D3) — 309 주석의 약속대로 발행본 화면(P7)과 함께 연다 ──
--   catalog.view = 발행본 목록·마스킹판 받기·지표 합계. 실명판 받기·생성·차이 보기는 화면·API 가 catalog.manage/publish 로 가린다.
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-staff-' || substr(md5('catalog.view'), 1, 16), 'tpl-staff-basic', 'catalog.view', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM permission_templates pt
  JOIN permissions p ON p.permission_key = 'catalog.view'
 WHERE pt.template_id = 'tpl-staff-basic'
   AND NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = 'tpl-staff-basic' AND g.permission_key = 'catalog.view');

-- ── 2) 변경 감지 상태(문서별) — 발행본이 아직 없을 때의 비교 기준과 알림 중복 방지 ──
--   baseline         : 발행본이 없을 때 첫 점검에서 잡은 지문(그 뒤 바뀐 것만 반영 대기로 남긴다). 발행하면 발행본 지문이 기준이 된다.
--   last_notified_day: 담당자 알림을 보낸 KST 날짜 — 하루 한 번만 알린다.
CREATE TABLE IF NOT EXISTS catalog_refresh_state (
  doc_id            text PRIMARY KEY REFERENCES catalog_documents(doc_id) ON DELETE CASCADE,
  baseline          jsonb,
  baseline_at       text,
  last_checked_at   text,
  last_open_count   int  NOT NULL DEFAULT 0,
  last_notified_day text,
  last_notified_at  text
);

-- ── 3) 반영 대기 — 열린 항목은 (문서, 원천, 항목 키)마다 1건. tick 이 같은 차이를 여러 번 보아도 행이 늘지 않는다 ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_pending_open_key
  ON catalog_pending_changes(doc_id, source, (ref->>'key')) WHERE resolved_edition_id IS NULL;

-- ── 4) 배포 기록 — 발행본을 누구에게 냈는지(§6-6). 한 발행본을 여러 곳에 낼 수 있어 행으로 남긴다 ──
CREATE TABLE IF NOT EXISTS catalog_edition_distributions (
  dist_id     text PRIMARY KEY,
  edition_id  text NOT NULL REFERENCES catalog_editions(edition_id) ON DELETE CASCADE,
  recipient   text NOT NULL,          -- 받은 곳(기관·회사·담당자)
  purpose     text,                   -- 용도(입찰 PQ·수의계약·홍보 등)
  given_on    text,                   -- 낸 날(YYYY-MM-DD)
  note        text,
  created_by  text,
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_edition_dist ON catalog_edition_distributions(edition_id, created_at DESC);
