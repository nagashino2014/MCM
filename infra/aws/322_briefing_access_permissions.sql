-- 브리핑 기능 권한만 확장한다. sales.* 권한·사용자 역할·개별 할당은 변경하지 않는다.
-- 비공개 문서 ACL은 소유자 / 프로필 수신자 / 개별 공유 수신자에게만 허용한다.
-- 정기 발행도 shares를 등록한다. 과거 자동 등록을 독립 공유 권한으로 승격하지 않는다.
ALTER TABLE intel_rag_briefing_shares ADD COLUMN IF NOT EXISTS explicit_share boolean NOT NULL DEFAULT false;
INSERT INTO permissions(permission_key,module,action,description,scopes_supported,is_dangerous,created_at)
VALUES
 ('intel.briefing.view','sales','briefing_view','브리핑 — 본인 및 공유받은 보고서 열람','all',0,now()::text),
 ('intel.briefing.create','sales','briefing_create','브리핑 — 본인 보고서 생성 및 관심 설정 관리','all',0,now()::text),
 ('intel.briefing.share','sales','briefing_share','브리핑 — 본인 보고서를 개별 사용자에게 공유','all',0,now()::text)
ON CONFLICT(permission_key) DO UPDATE SET module=EXCLUDED.module,action=EXCLUDED.action,description=EXCLUDED.description,scopes_supported=EXCLUDED.scopes_supported,is_dangerous=EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants(grant_id,template_id,permission_key,scope_kind,effect,created_at)
SELECT 'grant-briefing-'||substr(md5(t.template_id||':'||p.permission_key),1,24),t.template_id,p.permission_key,'all','allow',now()::text
FROM permission_templates t
CROSS JOIN permissions p
WHERE t.template_id IN('tpl-system-admin','tpl-ceo','tpl-exec','tpl-sales','tpl-sales-staff')
  AND p.permission_key IN('intel.briefing.view','intel.briefing.create','intel.briefing.share')
  AND NOT EXISTS(SELECT 1 FROM permission_template_grants g WHERE g.template_id=t.template_id AND g.permission_key=p.permission_key);
