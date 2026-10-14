-- 278: 변경계약 차수(2026-10-14 사용자 요청).
--   변경계약은 여러 번 생길 수 있는데 종전 구조는 변경 이벤트만 쌓여 차수·차수별 변경계약서를 구분하지 못했다
--   (192 이벤트 중 대부분은 분류·사업장 정정, 한 변경계약이 저장 3회로 쪼개진 사례도 있음).
--   차수 = 변경계약서 단위: 변경계약서(amendment)를 올리면 새 차수가 생기고, 변경 이벤트·추가 문서는 차수에 묶인다.
--   차수에 묶이지 않은 이벤트는 '정보 정정'(대행 실적 변경 보고 대상 아님).
--   선행: 004(contracts·contract_change_events·contract_documents). 멱등.

CREATE TABLE IF NOT EXISTS contract_amendments (
  amendment_id text PRIMARY KEY,
  contract_id  text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  round_no     integer NOT NULL CHECK (round_no > 0),
  amended_at   text,                      -- 변경계약일 YYYY-MM-DD (첫 변경계약서의 문서 일자)
  summary      text,                      -- 변경 사유·요약(선택)
  created_by   text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL,
  UNIQUE (contract_id, round_no)
);
CREATE INDEX IF NOT EXISTS idx_contract_amendments_contract ON contract_amendments(contract_id, round_no);

ALTER TABLE contract_change_events
  ADD COLUMN IF NOT EXISTS amendment_id text REFERENCES contract_amendments(amendment_id) ON DELETE SET NULL;
ALTER TABLE contract_documents
  ADD COLUMN IF NOT EXISTS amendment_id text REFERENCES contract_amendments(amendment_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contract_change_events_amendment ON contract_change_events(amendment_id) WHERE amendment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_documents_amendment ON contract_documents(amendment_id) WHERE amendment_id IS NOT NULL;

-- 이관: 이미 올라간 변경계약서는 각각 한 차수(계약별 업로드 순). 이미 차수에 묶인 문서는 건너뛴다(재실행 안전).
WITH docs AS (
  SELECT d.document_id, d.contract_id, d.created_at,
         COALESCE(substring(d.display_name FROM '^\((\d{4}-\d{2}-\d{2})\)'), left(d.created_at::text, 10)) AS amended_at,
         COALESCE((SELECT MAX(a.round_no) FROM contract_amendments a WHERE a.contract_id = d.contract_id), 0)
           + ROW_NUMBER() OVER (PARTITION BY d.contract_id ORDER BY d.created_at::text, d.document_id) AS round_no
    FROM contract_documents d
   WHERE d.document_type = 'amendment' AND d.amendment_id IS NULL
),
ins AS (
  INSERT INTO contract_amendments (amendment_id, contract_id, round_no, amended_at, created_by, created_at, updated_at)
  SELECT 'amd_' || substr(md5(docs.document_id), 1, 16), docs.contract_id, docs.round_no, docs.amended_at,
         'migration_278', docs.created_at::text, docs.created_at::text
    FROM docs
  ON CONFLICT (amendment_id) DO NOTHING
  RETURNING amendment_id
)
SELECT count(*) AS amendments_created FROM ins;

UPDATE contract_documents d
   SET amendment_id = 'amd_' || substr(md5(d.document_id), 1, 16)
 WHERE d.document_type = 'amendment' AND d.amendment_id IS NULL
   AND EXISTS (SELECT 1 FROM contract_amendments a WHERE a.amendment_id = 'amd_' || substr(md5(d.document_id), 1, 16));

-- 변경계약서가 연결된 이벤트, 그리고 같은 계약·같은 변경일의 이벤트(한 변경계약을 나눠 저장한 경우)를 그 차수에 묶는다.
UPDATE contract_change_events e
   SET amendment_id = d.amendment_id
  FROM contract_documents d
 WHERE e.document_id = d.document_id AND d.amendment_id IS NOT NULL AND e.amendment_id IS NULL;

UPDATE contract_change_events e
   SET amendment_id = linked.amendment_id
  FROM contract_change_events linked
 WHERE linked.amendment_id IS NOT NULL
   AND linked.contract_id = e.contract_id
   AND linked.changed_at = e.changed_at
   AND e.amendment_id IS NULL;
