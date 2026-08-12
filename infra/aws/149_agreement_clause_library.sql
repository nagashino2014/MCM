-- 149: 계약서 조항 라이브러리 — 발주처가 요구한 추가 조항을 매번 새로 타이핑하지 않도록
-- 과거 계약서·표준 셋의 조문을 모아 두고 작성 화면에서 검색·삽입한다(블루프린트 R3 완성 단계).
-- 축적 경로: ① 표준 셋/자체양식 조문 일괄 수확 ② 작성 중인 조항을 사용자가 저장 ③ 직접 등록.
-- 중복은 body_hash(제목+본문 정규화 해시)로 막는다 — 같은 조문이 여러 템플릿에 있기 때문.
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agreement_clause_library (
  clause_id     text PRIMARY KEY,               -- 'acl-' + nanoid
  title         text NOT NULL,                  -- "계약의 목적", "지체상금" 등 (괄호 안 제목만)
  body          text NOT NULL,                  -- 항·호 포함 본문. {{바인딩}} 토큰 사용 가능
  category      text NOT NULL DEFAULT '기타',   -- 목적·범위·기간·대금·보안·책임·지재권·해지·관할·기타
  tags          text[],                         -- 검색 보조(발주처명·법령 등)
  service_type  text,                           -- 특정 용역 대분류 전용이면 지정(없으면 공통)
  source        text NOT NULL DEFAULT 'manual', -- seed(표준 셋) | harvested(양식 수확) | manual(직접·작성 중 저장)
  source_template_id text REFERENCES agreement_templates(template_id) ON DELETE SET NULL,
  -- 같은 조문 중복 적재 방지 — lower(정규화된 제목+본문)의 md5
  body_hash     text NOT NULL,
  usage_count   integer NOT NULL DEFAULT 0,     -- 작성 화면에서 삽입된 횟수(정렬 가중치)
  last_used_at  text,
  created_by    text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_clause_hash ON agreement_clause_library(body_hash);
CREATE INDEX IF NOT EXISTS idx_agreement_clause_category ON agreement_clause_library(category, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_agreement_clause_service ON agreement_clause_library(service_type);
