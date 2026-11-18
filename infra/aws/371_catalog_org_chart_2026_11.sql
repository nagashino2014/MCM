-- 371 회사소개서 조직도 — 회사 조직도(2026.11) PPT 3쪽으로 교체(사용자 지시 2026-11-18).
-- 회사소개서 > 조직도(310 catalog_contents·catalog_content_versions)에 새 확정판을 더하고 편집본(draft)도 같게 둔다.
-- 이전 판은 그대로 남아 [이전 판 불러오기]로 되돌릴 수 있다. 5단(대표이사 → 부사장 → 이사 → 본부 → 팀)은 렌더러가 나무 배치로 그린다(infographics OrgTree).
-- 멱등: 이 메모의 판이 이미 있으면 아무것도 하지 않는다.
DO $$
DECLARE
  doc jsonb := '{"nodes": [{"id": "ppt-ceo", "label": "대표이사", "sub": "", "badge": "", "children": [{"id": "ppt-advisor", "label": "고문", "sub": "", "badge": "촉탁", "children": []}, {"id": "ppt-vp", "label": "부사장", "sub": "", "badge": "", "children": [{"id": "ppt-mgmt", "label": "경영·관리 이사", "sub": "", "badge": "", "children": [{"id": "ppt-hr", "label": "인사·노무팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-sales", "label": "영업·관리팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-it", "label": "IT 개발팀", "sub": "", "badge": "", "children": []}]}, {"id": "ppt-tech", "label": "기술총괄 이사", "sub": "", "badge": "", "children": [{"id": "ppt-env1", "label": "통합환경1본부", "sub": "", "badge": "", "children": [{"id": "ppt-env1-a", "label": "환경배출시설 인·허가팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-env1-b", "label": "폐기물재활용 환경성평가팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-env1-c", "label": "대기총량관리팀", "sub": "저감시설, IoT 설치지원", "badge": "", "children": []}]}, {"id": "ppt-env2", "label": "통합환경2본부", "sub": "", "badge": "", "children": [{"id": "ppt-env2-a", "label": "환경배출시설 인·허가팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-env2-b", "label": "환경피해예방팀", "sub": "비산먼지, 소음·진동", "badge": "", "children": []}, {"id": "ppt-env2-c", "label": "대기총량관리팀", "sub": "저감시설, IoT 설치지원", "badge": "", "children": []}]}, {"id": "ppt-chem", "label": "화학·안전 본부", "sub": "", "badge": "", "children": [{"id": "ppt-chem-a", "label": "화관법·화평법 대응팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-chem-b", "label": "HAPs 관리·지원팀", "sub": "", "badge": "", "children": []}]}, {"id": "ppt-climate", "label": "기후대기본부", "sub": "", "badge": "", "children": [{"id": "ppt-cl-a", "label": "탄소중립 지원팀", "sub": "저감시설 지원", "badge": "", "children": []}, {"id": "ppt-cl-b", "label": "온실가스관리팀", "sub": "목표관리제, 배출권거래", "badge": "", "children": []}, {"id": "ppt-cl-c", "label": "ISO인증 컨설팅팀", "sub": "ISO 14001, 환경경영시스템", "badge": "", "children": []}]}, {"id": "ppt-ulsan", "label": "울산지사", "sub": "", "badge": "", "children": [{"id": "ppt-ul-a", "label": "환경배출시설 인·허가팀", "sub": "", "badge": "", "children": []}, {"id": "ppt-ul-b", "label": "대기총량관리팀", "sub": "저감시설, IoT 설치지원", "badge": "", "children": []}]}]}, {"id": "ppt-lab", "label": "탄소중립 미래연구소", "sub": "", "badge": "", "children": [{"id": "ppt-lab-a", "label": "탄소중립·녹색성장 컨설팅", "sub": "", "badge": "", "children": []}, {"id": "ppt-lab-b", "label": "온실가스 배출권 인증", "sub": "", "badge": "", "children": []}, {"id": "ppt-lab-c", "label": "ESG, LCA 등 환경 R&D", "sub": "", "badge": "", "children": []}]}]}]}]}'::jsonb;
  ts  text  := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  ver int;
BEGIN
  IF EXISTS (SELECT 1 FROM catalog_content_versions WHERE content_key = 'org_chart' AND note = '371 회사 조직도(2026.11) PPT 3쪽') THEN
    RETURN;
  END IF;
  INSERT INTO catalog_contents (content_key, draft, updated_at, updated_by)
  VALUES ('org_chart', doc, ts, NULL)
  ON CONFLICT (content_key) DO UPDATE SET draft = EXCLUDED.draft, updated_at = EXCLUDED.updated_at;
  SELECT COALESCE(MAX(version), 0) + 1 INTO ver FROM catalog_content_versions WHERE content_key = 'org_chart';
  INSERT INTO catalog_content_versions (content_key, version, data, note, saved_at, saved_by)
  VALUES ('org_chart', ver, doc, '371 회사 조직도(2026.11) PPT 3쪽', ts, NULL);
  UPDATE catalog_contents SET published_version = ver WHERE content_key = 'org_chart';
END
$$;
