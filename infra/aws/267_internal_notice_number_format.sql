-- 267: 내부고시 번호를 연도 없는 통산 번호 '내부고시-NNNN호'로 전환(2026-09-22 사용자 확정).
-- 266 은 '{연도}-내부고시-{NNNNN}호'(연도별 시퀀스)로 시드했다 → 시퀀스 키를 year='ALL' 하나로 합친다.
-- 멱등.

-- 1) 통산 시퀀스 — 수기 발번 마지막 번호(1009) 또는 연도별 시퀀스 최댓값 중 큰 값에서 이어간다
INSERT INTO doc_no_sequences (rule_key, year, last_seq)
SELECT '내부고시', 'ALL', GREATEST(1009, COALESCE(MAX(last_seq), 0))
  FROM doc_no_sequences WHERE rule_key = '내부고시' AND year <> 'ALL'
ON CONFLICT (rule_key, year) DO UPDATE SET last_seq = GREATEST(doc_no_sequences.last_seq, EXCLUDED.last_seq);

-- 2) 연도별 반납 풀·시퀀스 정리 — 풀 번호는 통산 키로 옮긴다
INSERT INTO doc_no_pool (rule_key, year, seq, released_at)
SELECT rule_key, 'ALL', seq, released_at FROM doc_no_pool WHERE rule_key = '내부고시' AND year <> 'ALL'
ON CONFLICT (rule_key, year, seq) DO NOTHING;
DELETE FROM doc_no_pool WHERE rule_key = '내부고시' AND year <> 'ALL';
DELETE FROM doc_no_sequences WHERE rule_key = '내부고시' AND year <> 'ALL';

-- 3) 이미 옛 형식으로 채번된 내부고시 문서가 있으면 새 형식으로 바꾼다('2026-내부고시-01010호' → '내부고시-1010호')
UPDATE approval_docs
   SET doc_no = '내부고시-' || lpad((regexp_replace(doc_no, '^\d{4}-내부고시-0*(\d+)호$', '\1'))::int::text, 4, '0') || '호'
 WHERE form_id = 'frm-internal-notice'
   AND doc_no ~ '^\d{4}-내부고시-\d+호$';

-- 4) 양식 설명 갱신
UPDATE approval_forms
   SET description = '사내 전파용 내부고시 — 전용 작성 화면(/approval/notice) 사용. 상신 시 내부고시-NNNN호 자동 채번(관리자 직접 지정 가능), 결재 완료 문서는 PDF 로 열람.',
       updated_at = now()::text
 WHERE form_id = 'frm-internal-notice';
