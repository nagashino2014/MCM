-- 130: 삭제 문서번호 승계 풀(사용자 요구 — 테스트 문서 삭제 후 결번 방지).
-- 관리자가 문서를 삭제하면 그 문서번호(rule_key·연도·일련)를 풀에 반납하고,
-- 이후 같은 유형·연도의 다음 상신이 풀의 가장 작은 번호부터 이어받는다(없으면 시퀀스 증가).
-- 기안·승인 시점은 approval_docs.submitted_at/completed_at 이 이미 담당 — 별도 마킹 불필요.
-- 멱등: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS doc_no_pool (
  rule_key    text NOT NULL,
  year        text NOT NULL,
  seq         integer NOT NULL,
  released_at text NOT NULL,
  PRIMARY KEY (rule_key, year, seq)
);
