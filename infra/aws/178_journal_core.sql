-- 178: 미니 전표 계층(복식부기 자동분개) 코어 (블루프린트: docs/accounting-expansion-blueprint.md §5 P3)
-- 원칙: 전표는 원장(card_transactions·bank_transactions·tax_invoices·approval_docs) 위의 "파생 계층" —
--   regenerateJournal 배치가 언제든 재생성 가능(auto/pending 삭제 후 재생성, confirmed 는 보존).
--   전표입력 화면 없음(U2·U3): 100% 자동 생성 + 계정 미확정 건만 회계담당 확정 큐.
-- 계정과목: 세무법인 결산 자료와의 백테스트 대사(§7 T1-①)를 위해 표준(K-GAAP 중소기업) 계정과목명 기준 시드.
-- 관련: 170(원장·expense_categories), 174(recon reject_reason — 비수금 입금의 계정 힌트), 177(personal_receipts).

-- ── 계정과목 마스터 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_accounts (
  account_code text PRIMARY KEY,          -- 표준 계정코드 근사(3자리) — 시드 후 관리자 조정 가능
  name         text NOT NULL,             -- 계정과목명(세무법인 원장과 이름 매칭에 사용)
  acct_type    text NOT NULL,             -- asset / liability / equity / revenue / expense
  is_active    integer NOT NULL DEFAULT 1,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

-- 계정 체계는 세무법인(우리 결산 담당) 프로그램의 5자리 코드 ÷ 100 = 3자리와 정합(2024·2025 계정원장 실측).
-- 백테스트(§7 T1-①) 대사에서 코드 매칭이 그대로 성립하도록 코드·명칭을 세무 실측에 맞춘다.
-- ⚠ 254=예수금·815=수도광열비가 표준 자리 — 앱 전용 계정(미지급금(직원경비)·경조사비)은 예비 코드(258·849)를 쓴다.
INSERT INTO journal_accounts (account_code, name, acct_type, sort_order) VALUES
  -- 자산
  ('103', '보통예금',         'asset',     10),
  ('105', '정기예.적금',      'asset',     12),
  ('108', '외상매출금',       'asset',     20),
  ('109', '대손충당금',       'asset',     22),
  ('114', '단기대여금',       'asset',     24),
  ('120', '미수금',           'asset',     26),
  ('131', '선급금',           'asset',     28),
  ('133', '선급비용',         'asset',     30),
  ('134', '가지급금',         'asset',     32),  -- 미확정 출금(확정 큐 suspense)
  ('135', '부가세대급금',     'asset',     34),
  ('136', '선납세금',         'asset',     36),
  ('201', '토지',             'asset',     40),
  ('202', '건물',             'asset',     42),
  ('203', '감가상각누계액(건물)', 'asset', 44),
  ('206', '기계장치',         'asset',     46),
  ('207', '감가상각누계액(기계)', 'asset', 48),
  ('208', '차량운반구',       'asset',     50),
  ('209', '감가상각누계액(차량)', 'asset', 52),
  ('212', '비품',             'asset',     54),
  ('213', '감가상각누계액(비품)', 'asset', 56),
  ('232', '특허권',           'asset',     58),
  ('240', '소프트웨어',       'asset',     60),
  ('962', '임차보증금',       'asset',     62),
  ('964', '기타보증금',       'asset',     64),
  ('979', '회원권',           'asset',     66),
  -- 부채·자본
  ('253', '미지급금',         'liability', 110), -- 법인카드 대금
  ('254', '예수금',           'liability', 112), -- 원천세·4대보험 예수
  ('255', '부가세예수금',     'liability', 114),
  ('257', '가수금',           'liability', 116), -- 미확정 입금(확정 큐 suspense)
  ('258', '미지급금(직원경비)', 'liability', 118), -- 앱 전용: 개인카드 경비 환급 채무(별도 이체 정산). 표준·세무 미사용 코드
  ('259', '선수금',           'liability', 120),
  ('260', '단기차입금',       'liability', 122),
  ('261', '미지급세금',       'liability', 124),
  ('293', '장기차입금',       'liability', 126),
  ('294', '임대보증금',       'liability', 128),
  ('331', '자본금',           'equity',    150),
  ('351', '이익준비금',       'equity',    152),
  ('375', '이월이익잉여금',   'equity',    154),
  ('381', '주식할인발행차금', 'equity',    156),
  -- 수익 (세무 실측: 임대료·용역수입은 411·412 영업수익)
  ('411', '임대료수입',       'revenue',   210), -- 회사 소유 부동산 임대 수입(달다봄·서연오토비전 등)
  ('412', '용역수입',         'revenue',   212),
  ('901', '이자수익',         'revenue',   220),
  ('919', '보험차익',         'revenue',   222),
  ('930', '잡이익',           'revenue',   224), -- 세무 93001 잡이익_기타 / 93002 잡이익_지원금
  -- 비용
  ('802', '급여',             'expense',   300), -- 세무 80204 직원_급여
  ('805', '잡급',             'expense',   302),
  ('808', '퇴직급여',         'expense',   304),
  ('811', '복리후생비',       'expense',   310),
  ('812', '여비교통비',       'expense',   320),
  ('813', '기업업무추진비',   'expense',   330),
  ('814', '통신비',           'expense',   340),
  ('815', '수도광열비',       'expense',   342),
  ('816', '전력비',           'expense',   344),
  ('817', '세금과공과금',     'expense',   346),
  ('818', '감가상각비',       'expense',   348),
  ('819', '임차료(리스포함)', 'expense',   350), -- 세무 81901 부동산/81902 차량·중기/81903 기타
  ('820', '수선비',           'expense',   352),
  ('821', '보험료',           'expense',   354),
  ('822', '차량유지비',       'expense',   356),
  ('825', '교육훈련비',       'expense',   360),
  ('826', '도서인쇄비',       'expense',   370),
  ('827', '회의비',           'expense',   372),
  ('828', '포장비',           'expense',   374),
  ('829', '사무용품비',       'expense',   380),
  ('830', '소모품비',         'expense',   390),
  ('831', '지급수수료',       'expense',   400),
  ('833', '광고선전비',       'expense',   402),
  ('835', '대손상각비',       'expense',   404),
  ('837', '건물관리비',       'expense',   406),
  ('840', '무형고정자산상각', 'expense',   408),
  ('848', '잡비',             'expense',   410),
  ('849', '경조사비',         'expense',   412), -- 앱 전용: 임직원 경조(축의·조의·화환). 거래처 경조는 813(건당 20만원 한도). 표준·세무 미사용 코드
  ('852', '외주용역비',       'expense',   414),
  ('931', '이자비용',         'expense',   420),
  ('933', '기부금',           'expense',   422),
  ('960', '잡손실',           'expense',   424)
ON CONFLICT (account_code) DO NOTHING;

-- 경비 분류(expense_categories) → 계정과목 매핑 컬럼
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS account_code text;
UPDATE expense_categories SET account_code = m.code
  FROM (VALUES
    ('travel','812'), ('fuel','822'), ('lodging','812'), ('meal','811'),
    ('supplies','829'), ('consumables','830'), ('printing','826'), ('entertain','813'),
    ('comm','814'), ('fee','831'), ('education','825'), ('etc','848')
  ) AS m(key, code)
  WHERE expense_categories.category_key = m.key AND expense_categories.account_code IS NULL;

-- ── 전표(헤더) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  entry_id     text PRIMARY KEY,          -- 'je-' + sha256 12자리
  entry_date   text NOT NULL,             -- YYYY-MM-DD (매출=계산서 작성일, 카드=승인일, 경비문서=승인일)
  source_kind  text NOT NULL,             -- card / bank_in / bank_out / tax_invoice / expense_doc / import / manual
  source_id    text NOT NULL,             -- 원장 행 ID(card_txn_id/txn_id/invoice_id/doc_id) — 재생성 dedup 키
  description  text,                      -- 적요(상호·입금자·계약명 등)
  party_name   text,                      -- 거래상대(원문)
  status       text NOT NULL DEFAULT 'auto', -- auto(자동 완성) / pending(계정 미확정 — 확정 큐) / confirmed(확정) / excluded(전표 제외: 계좌간 이체 등)
  doc_id       text,                      -- 연관 결재문서(있으면)
  confirmed_by text,
  confirmed_at text,
  memo         text,
  created_at   text NOT NULL,
  updated_at   text,
  CONSTRAINT ux_journal_entries_source UNIQUE (source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);

-- ── 분개 라인(차/대) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_lines (
  line_id      text PRIMARY KEY,          -- 'jl-' + sha256 12자리
  entry_id     text NOT NULL REFERENCES journal_entries(entry_id) ON DELETE CASCADE,
  line_no      integer NOT NULL DEFAULT 1,
  account_code text NOT NULL REFERENCES journal_accounts(account_code),
  debit        numeric NOT NULL DEFAULT 0,
  credit       numeric NOT NULL DEFAULT 0,
  memo         text
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

-- ── 은행 거래상대 → 계정 학습 사전 (card_merchant_links 패턴) ──
-- 출금/비수금 입금의 확정 시 upsert — 같은 상대의 다음 거래는 auto 분개.
CREATE TABLE IF NOT EXISTS journal_party_accounts (
  match_norm     text PRIMARY KEY,        -- 거래상대 정규화(공백 제거·NFKC·대문자)
  account_code   text NOT NULL REFERENCES journal_accounts(account_code),
  label_snapshot text,
  confirm_count  integer NOT NULL DEFAULT 1,
  last_confirmed_at text,
  created_at     text NOT NULL
);

-- ── 백테스트: 과거 계정 원장 임포트 (§7 T1-①) ────────────────
-- 세무법인 결산 자료(시산표/계정별 집계 엑셀)를 적재해 앱 생성 전표와 계정별 대사.
CREATE TABLE IF NOT EXISTS ledger_import_batches (
  batch_id    text PRIMARY KEY,           -- 'lib-' + sha256 12자리
  year_label  text NOT NULL,              -- 대사 대상 연도(YYYY)
  file_name   text,
  uploaded_by text,
  line_count  integer NOT NULL DEFAULT 0,
  created_at  text NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_import_lines (
  import_line_id   text PRIMARY KEY,
  batch_id         text NOT NULL REFERENCES ledger_import_batches(batch_id) ON DELETE CASCADE,
  account_name_raw text NOT NULL,         -- 파일 표기 그대로
  account_code     text,                  -- journal_accounts 정규화 매칭 결과(null=미매칭)
  entry_date       text,                  -- 있으면 YYYY-MM-DD
  description      text,
  debit            numeric NOT NULL DEFAULT 0,
  credit           numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_import_lines_batch ON ledger_import_lines(batch_id);
