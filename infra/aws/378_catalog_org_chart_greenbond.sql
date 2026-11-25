-- 378 회사소개서 조직도 — 녹색채권 검토본부 추가 · 이름 2건 변경(사용자 지시 2026-11-25).
--   ① 녹색채권 검토본부: 대표이사 직속 별도 독립 조직. 표시 '독립'(앱 ORG_BADGES)이라 고문·외부자문위원처럼 대표이사 옆 가지로 그린다(infographics OrgTree).
--   ② 탄소중립 미래연구소 사업 분야 '탄소중립·녹색성장 컨설팅' → '탄소중립·녹색성장 연구'.
--   ③ 경영·관리 이사 둘째 팀 '영업·관리팀' → '회계·관리팀'.
-- 지금 확정판(371 또는 그 뒤 화면에서 확정한 판) 위에 고쳐 새 확정판을 더하고 편집본(draft)도 같게 둔다. 이전 판은 [이전 판 불러오기]로 되돌릴 수 있다.
-- 멱등: 이 메모의 판이 이미 있으면 아무것도 하지 않는다. 확정판이 없거나 맨 위가 대표이사 상자 하나가 아니면 멈춘다.
DO $$
DECLARE
  base jsonb;
  doc  jsonb;
  ts   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  ver  int;
BEGIN
  IF EXISTS (SELECT 1 FROM catalog_content_versions WHERE content_key = 'org_chart' AND note = '378 녹색채권 검토본부 추가·팀 이름 변경') THEN
    RETURN;
  END IF;
  SELECT v.data INTO base
    FROM catalog_contents c
    JOIN catalog_content_versions v ON v.content_key = c.content_key AND v.version = c.published_version
   WHERE c.content_key = 'org_chart';
  IF base IS NULL THEN
    RAISE EXCEPTION '378: 확정된 조직도가 없습니다 — 371 을 먼저 적용하세요.';
  END IF;
  IF jsonb_array_length(base -> 'nodes') <> 1 OR base #>> '{nodes,0,label}' <> '대표이사' THEN
    RAISE EXCEPTION '378: 확정된 조직도 맨 위가 대표이사 상자 하나가 아닙니다 — 화면(회사소개서 > 조직도)에서 고치세요.';
  END IF;
  -- 이름 변경(라벨 값 전체 일치만 — 이미 바뀌었으면 그대로)
  doc := replace(
           replace(base::text, '"label": "영업·관리팀"', '"label": "회계·관리팀"'),
           '"label": "탄소중립·녹색성장 컨설팅"', '"label": "탄소중립·녹색성장 연구"'
         )::jsonb;
  -- 대표이사 직속 독립 조직 — 첫 옆 가지(고문) 다음 자리에
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(doc #> '{nodes,0,children}') c WHERE c ->> 'label' = '녹색채권 검토본부') THEN
    doc := jsonb_insert(doc, '{nodes,0,children,1}', '{"id": "greenbond-review", "label": "녹색채권 검토본부", "sub": "", "badge": "독립", "children": []}'::jsonb);
  END IF;
  UPDATE catalog_contents SET draft = doc, updated_at = ts WHERE content_key = 'org_chart';
  SELECT COALESCE(MAX(version), 0) + 1 INTO ver FROM catalog_content_versions WHERE content_key = 'org_chart';
  INSERT INTO catalog_content_versions (content_key, version, data, note, saved_at, saved_by)
  VALUES ('org_chart', ver, doc, '378 녹색채권 검토본부 추가·팀 이름 변경', ts, NULL);
  UPDATE catalog_contents SET published_version = ver WHERE content_key = 'org_chart';
END
$$;
