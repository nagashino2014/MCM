-- 121: 예약 자산 관리 — 법인차량·회의실 등 예약 가능 자산 마스터 + 직접 예약.
--   자산 이용 현황의 데이터원 2종:
--     (1) vehicle: 출장신청서(frm-biz-trip-request) 상신 건의 car_name·trip_period에서 자동 파생(테이블 없음)
--     (2) room/etc: asset_reservations 직접 예약(결재 없이 즉시 등록, 본인 취소 가능)
--   조회·본인 예약은 로그인만으로 허용(requireSession), 자산 등록·변경·삭제만 asset.manage.
-- 설계: docs/groupware-ux-overhaul-blueprint.md §7 (일정/캘린더 — 회의실 예약). 멱등.

CREATE TABLE IF NOT EXISTS reservable_assets (
  asset_id    text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('vehicle', 'room', 'etc')),
  name        text NOT NULL,              -- 차종명(니로, K8) / 회의실명
  description text,
  active      integer NOT NULL DEFAULT 1, -- 예약 이력 보존을 위해 삭제 대신 비활성화
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_reservations (
  reservation_id text PRIMARY KEY,
  asset_id       text NOT NULL REFERENCES reservable_assets(asset_id) ON DELETE CASCADE,
  reserved_by    text REFERENCES users(user_id) ON DELETE SET NULL,
  reserved_on    text NOT NULL,           -- YYYY-MM-DD
  start_time     text,                    -- HH:mm (미지정 = 종일)
  end_time       text,                    -- HH:mm
  purpose        text,
  created_at     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_reservations_asset_on ON asset_reservations(asset_id, reserved_on);
CREATE INDEX IF NOT EXISTS idx_asset_reservations_by ON asset_reservations(reserved_by);

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('asset.manage', 'asset', 'manage', '예약 자산(법인차량·회의실) 등록·변경·삭제', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE
  SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
      scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿(tpl-system-admin, 111) grant 보충 — 111 주석의 필수 절차(누락 시 관리자도 403).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('asset.manage'), 1, 16),
       'tpl-system-admin', 'asset.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'asset.manage'
   );

-- 초기 자산 시드 — 보유 법인차량 + 회의실. 명칭·추가분은 자산 관리 화면에서 정비한다.
INSERT INTO reservable_assets (asset_id, kind, name, description, active, sort_order, created_at, updated_at)
VALUES
  ('asset-niro', 'vehicle', '니로', '법인차량', 1, 10, now()::text, now()::text),
  ('asset-k8',   'vehicle', 'K8',   '법인차량', 1, 20, now()::text, now()::text),
  ('asset-meeting-room', 'room', '회의실', '본사 회의실', 1, 30, now()::text, now()::text)
ON CONFLICT (asset_id) DO NOTHING;
