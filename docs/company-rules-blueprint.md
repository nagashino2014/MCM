# 사규(취업규칙) 관리 · 개정 비교 · 전자동의 블루프린트 (RB)

> 2026-08-19 설계. 대상 문서: 「한국환경안전연구원 사규(2026.04.08. 개정)」 hwpx.
> 목표: ① 사규 전문을 그룹웨어에 상시 게재(누구나 열람) ② 개정 시 구 조문 ↔ 변경안 비교 화면 ③ 불이익 변경 시 전자서명 동의 절차까지 앱 안에서 완결.

## 0. 현행 업무 흐름과 전산화 범위

현행: 개정안을 별도 문서로 작성 → 전사 게시판 게재 → (불이익 변경 시) 동의서를 종이로 회람·서명 → 스캔 보관.

전산화 후: 사규 원문이 DB에 조문 단위로 적재되어 그룹웨어에서 상시 열람 → 개정안을 조문 편집기로 작성 → 신구조문 비교 화면 자동 생성 → 게시판 공고 연동 → 동의 필요 시 대상자별 전자서명 수집 + **재적 과반수 게이지** → 확정 시 새 버전 발행 + 동의서·신구대비표 PDF 자동 보관.

### 법적 근거 (사규 부칙 제3조 = 근로기준법 §94)
- 변경 시 **사원 과반수의 의견 청취** (유리·중립 변경 포함 — 의견청취 기록도 남겨야 함)
- **불이익 변경 시 사원 과반수의 동의** → 단순 "동의자 수 세기"가 아니라 **재적 인원 대비 과반 달성 추적**이 요건
- 고용노동부 취업규칙 변경 신고 시 첨부물 = 동의서(또는 의견청취서) → 시스템 산출물이 곧 신고 서류
- ⚠ 참고: 판례상 불이익 변경 동의는 "집단적 회의 방식"이 원칙이고 개별 회람 서명의 효력이 다투어질 수 있음. 시스템은 현행 실무(개별 동의서 수집)를 전산화하되, 설명회 개최 기록(일시·방식)을 라운드에 남기는 필드를 두어 보완한다.

## 1. 원문 구조 분석 결과 (2026.04.08. 개정판 실측)

- **본문**: 14개 장(제1장 총칙 ~ 제14장 재해보상), **제1~86조**, 조문 헤더 형식 `제N조 【제목】` 규칙적
- **부칙**: 5개 조(준용규정·비치·변경·시행일·효력)
- **별표**: 실제 수록 **8종**(1 지출증빙, 2 인사(진급), 3 경조휴가, 4 상여금, 5 경조금, 7 징계 양정, 8 자격수당, 9 장기근속 포상휴가). ⚠ **별표 6번은 결번** — 본문 제60조는 "별표 6. 징계 양정 기준"을 인용하는데 말미 표제는 "별표 7"이다. 임포트 검수에서 정정.
- **항·호**: 항은 원문자(①②…, 163개), 호는 `1. 2.` — 기계 파싱 가능 확인
- **별표는 표(hp:tbl) 8개 사용** → 조문 텍스트와 달리 표 구조로 다뤄야 함
- 같은 폴더(V:\업무자료\경리업무\사규\)에 별도 규정 존재: 「육아기 10시 단축제도 관리규정」 등 → **사규 1개가 아니라 "규정(document) 여러 개"를 담는 규정집 모델**로 설계

## 2. 데이터 모델 — 마이그레이션 `193_company_rules.sql` (멱등)

`labor_contract_templates`(156)의 "version 증가 + 기존 행 불변" 모델과 `leave_notices`(088)의 "대상자별 행 선생성 + status 전이" 모델을 조합.

```
rule_documents            -- 규정 단위 (사규 본체, 육아기 단축규정, …)
  doc_id text PK          -- 'work-rules', 'childcare-shortened' …
  title, category, sort_order, is_active

rule_versions             -- 규정의 판(版). 발행 후 불변
  version_id PK, doc_id FK
  version int             -- UNIQUE(doc_id, version)
  status                  -- draft → in_consent(동의 진행) → published → superseded
  effective_date date     -- 시행일
  body jsonb              -- 구조화 조문 IR (아래 §3)
  source_file_key         -- 원본 hwpx/pdf 저장키 (contract-document-storage)
  pdf_file_key            -- 발행본 PDF
  revision_note text      -- 개정 이유 요약
  published_at, published_by

rule_amendments           -- 개정 라운드 (from → to 버전 전환 절차)
  amendment_id PK, doc_id, from_version_id, to_version_id
  consent_required bool   -- 불이익 변경 여부(라운드 전체 판정)
  briefing_note jsonb     -- 설명회/공고 기록 {board_post_id, held_at, method}
  approval_doc_id         -- (선택) 전자결재 승인 게이트 — labor_contract_rounds 관례
  status                  -- draft → announced(공고) → collecting(동의 수집) → confirmed → cancelled
  headcount_snapshot int  -- 발송 시점 재적 인원(과반수 분모 고정)

rule_amendment_changes    -- 조문 단위 변경 명세 (신구대비표의 행)
  change_id PK, amendment_id FK
  article_key text        -- 'art-33' | 'appendix-3' | 'addendum-3'
  change_type             -- added | amended | removed
  old_text jsonb, new_text jsonb   -- 조문 IR 스냅샷(비교 화면·대비표 근거)
  disadvantage bool       -- 조항별 불이익 플래그
  reason text             -- 개정 사유(조항별)

rule_consents             -- 대상자별 동의 행 (leave_notices 방식: 발송 시 선생성)
  consent_id PK, amendment_id FK, employee_id
  UNIQUE(amendment_id, employee_id)
  status                  -- sent → agreed | disagreed | exempt(서면 사후등록 등)
  signature text          -- 서버 생성: '성명(사번) · ISO시각' (payroll/sign.ts 관례)
  consent_version text    -- 동의 고지문 판 (overtime-consent CONSENT_VERSION 관례)
  opinion text            -- 부동의/의견 텍스트 (의견청취 증빙 겸용)
  submitted_at, sent_at, sent_by

rule_reads                -- (선택) 열람 확인 — board_post_reads 방식
  PRIMARY KEY(version_id, user_id), read_at
```

권한키: `rules.view`(전 직원 기본), `rules.manage`(개정·발송·확정).
⚠ **`111_system_admin_template.sql`의 `tpl-system-admin`에 grant 보충 필수** — 누락 시 관리자도 403 (190 마이그 주석의 교훈).

## 3. 조문 IR(body jsonb) 스키마

```jsonc
{
  "chapters": [
    { "no": 6, "title": "휴일 및 휴가",
      "articles": [
        { "key": "art-33", "no": 33, "title": "연차유급휴가",
          "clauses": [                       // 항 단위
            { "label": "①", "text": "...", "items": ["1. ...", "2. ..."] }
          ],
          "refs": ["appendix-3"] }           // 별표 참조
      ] }
  ],
  "addendum": [ { "key": "addendum-3", "no": 3, "title": "취업규칙의 변경", "clauses": [...] } ],
  "appendices": [                            // 별표 — 설명 문단 + 표(셀 단위, 병합 보존)
    { "key": "appendix-3", "no": 3, "title": "경조휴가",
      "paras": ["..."],
      "tables": [ { "rows": [ [ { "text": "휴가사유", "colSpan": 1, "rowSpan": 1 } ] ] } ] }
  ],
  "history": [                               // 부칙 말미 '개 정' 연혁 — 과거 판 백필 근거
    { "text": "3. 별표 1 … 변경 – 2022. 10. 01.", "date": "2022-10-01", "details": ["…"] }
  ]
}
```

> 실제 타입 정의는 `frontend/lib/rules/types.ts`. 조문에 표가 직접 박힌 경우(제27조)는 `RuleArticle.tables` 로 보존한다.

- 조문 diff의 매칭 키 = `key`(조 번호 기반). 조 번호 개편(전면 개정)은 v1에서는 "삭제+신설"로 처리.
- 별표는 텍스트 diff 대신 **구/신 병렬(side-by-side) 표시** — 표 8개 실측상 셀 단위 diff는 과설계.

## 4. 페이즈

### RB-P0 — 원문 임포트 파이프라인 + 초판 적재 ✅ 구현 완료(2026-08-19, 미배포)
**설계 변경: LLM 미사용 — 결정론적 파서로 확정.** 계약서 분석(`lib/agreement/analyze.ts`)은 발주처마다 서식이
달라 LLM 추출이 필요했지만, 사규 원문은 `제N조 【제목】`·항(①…)·호(1. …) 표기가 규칙적이라 규칙 기반으로
전량 복원된다(실측: 조문 헤더 91 = 본문 86 + 부칙 5 로 정확히 일치). 결정론이라 재현·검증되고 비용도 없다.

구현물:
- `frontend/lib/rules/types.ts` — 조문 IR 타입(§3)
- `frontend/lib/rules/import.ts` — `parseHwpx` → 조문 IR. 목차 스킵 · 장/조/항/호 상태 기계 · 별표(표) ·
  부칙 · **개정 연혁** 추출 + 검증 경고 생성
- `frontend/lib/rules/store.ts` — `rule_documents`/`rule_versions` 접근. 판 불변, 발행 시 직전 판 `superseded`
- API — `POST /api/rules/import`(업로드·파싱·draft 생성·원본 S3 보관) · `GET /api/rules` ·
  `GET|PATCH|DELETE /api/rules/versions/[versionId]` · `POST .../publish`
- 화면 — `/rules/admin`(임포트·검수·발행, `components/rules/RuleAdminBoard.tsx`),
  `/rules`(열람, `RuleReaderBoard.tsx` — 검색·PDF는 P1) · 사이드바 메뉴 등록(`config/menu.ts`)
- 마이그 `infra/aws/193_company_rules.sql` — 전체 스키마 + 권한키 2종 + tpl-system-admin grant

**실원문(2026.04.08. 개정판) 파싱 검증 결과** — 14장 / 86조 / 부칙 5조 / 별표 8종 / 표 8개, 항 163개 복원.
파서가 잡아낸 원문 결함 2건(설계 의도대로 자동 수정하지 않고 검수 화면에 회부):
1. 본문은 「별표 6. 징계 양정 기준」을 인용하는데 말미 표제는 「별표 7」 — 번호 불일치
2. 별표 7을 인용하는 조문이 없음(위와 동일 원인)

파싱 중 발견해 파서에 반영한 원문 특성:
- 한 문단에 여러 항이 눌러붙음(제33조 ①에 ②가, ⑤에 ➅가 포함) → 번호가 직전+1로 이어질 때만 분할
- 원문자 세트 혼용(⑤ 다음이 U+2785 `➅`) → 네 세트(①⑳/❶❿/➀➉/➊➓) 모두 인정
- 한글 자간 벌리기(`목      적`) → 토큰이 모두 1글자일 때만 붙여 `목적`으로 복원
- 조문 본문에 직접 박힌 표(제27조) → `RuleArticle.tables` 로 보존
- 부칙 말미 **개정 연혁 4건**(2020-01-30 / 2021-08-02 / 2022-10-01 / 2026-01-01) → 과거 판 백필 근거

**잔여**: 마이그 193 DB 적용 · 실제 업로드 E2E 실증 · staging 배포.

### RB-P1 — 규정집 열람 화면 `/rules`
- 좌측: 규정 목록 + 장→조 목차 트리. 우측: 조문 본문(항·호 들여쓰기, 별표는 표 렌더). cdash 컨셉(`.cursor/rules/ui-modernize.mdc`).
- 조문 검색(제목+본문 ILIKE), 시행일 기준 **과거 판 선택 열람**(superseded 포함), 발행본 PDF 다운로드(`pdf-lib` — `intel/briefing-pdf.ts`의 `PdfWriter` 관례).
- `rule_reads` 기록(열람 확인). 사이드바 메뉴 등록 + `rules.view` 가드.

### RB-P2 — 개정안 작성기 + 비교 화면
- 관리자: 현행판 복제 → draft 생성 → 조문 트리에서 조 선택 → **수정/신설/삭제** 편집. 저장 시 `rule_amendment_changes` 자동 산출(IR 비교로 변경 조문 자동 감지).
- 조항별 `disadvantage` 플래그 + 개정 사유 입력 → 하나라도 true면 라운드 `consent_required = true`.
- **비교 화면(핵심 UI)**: 신구조문대비표 — 좌 "현행", 우 "개정안" 2열. 텍스트는 **단어 단위 diff 하이라이트**(삭제=적색 취소선, 추가=청색 밑줄 — 정부 입법예고 대비표 관례). diff 유틸은 기성 패키지 미설치이므로 LCS 기반 소형 자체 구현(`lib/rules/diff.ts`, 신규 라이브러리 도입 금지 규칙 준수). 별표는 구/신 병렬 표시.
- 신구조문대비표 PDF 출력(공고문·신고 첨부 겸용).

### RB-P3 — 공고 + 전자동의 수집
- **공고**: 라운드 `announced` 전환 시 게시판(`board_posts`) 공지 자동 작성 옵션 — 본문에 비교 화면 딥링크. 설명회 기록(`briefing_note`) 입력.
- **발송**: `LeavePromotionBoard` 패턴의 수집 보드(`/rules/consents`). 대상자(재직 임직원) 선택 → `rule_consents` 행 선생성 + `headcount_snapshot` 고정 → 홈 수신함 위젯 노출.
- **직원 화면**: 홈 위젯(`ContractInboxCard` 패턴, `lib/home/widgets.ts` 등록). 열람 → 비교 화면 확인(필수 스크롤/열람 체크) → 동의 체크박스 + 전자서명법 §3 고지문(`overtime-consent.ts::CONSENT_FOOTER` 재사용) → 제출. 서명은 **서버 생성** `성명(사번) · ISO시각` (`payroll/sign.ts` 관례). **부동의 선택지 + 의견 입력란 필수**(의견청취 증빙 — 유리 변경 라운드에서는 "의견 제출"로 라벨 전환).
- **수집 보드**: 과반수 게이지(agreed / headcount_snapshot), 미제출자 목록 + 리마인드(메신저 DM — `personal-docs/send` 관례), 서면 사후등록(`exempt` + prefix 서명 `'서면 동의 · 사후등록 (...) · 시각'` — leave-promotion 관례).

### RB-P4 — 확정·산출물·보관
- 과반수 달성(또는 의견청취 완료) → 라운드 `confirmed` → to_version `published`, from_version `superseded`, 시행일 반영.
- 산출물 PDF 자동 생성·보관: ① 동의서 집계표(서명 목록·게이지·일시) ② 신구조문대비표 ③ 발행본 전문 → **고용노동부 변경 신고 패키지**. 파일함(`lib/files/library.ts`)에 `rules` 소스 추가(6번째 UNION).
- 감사: `recordAuditLog()` + 접속기록(192) 연동. 동의 데이터는 삭제 불가(append-only) 취급.

### 후속(옵션)
- 모바일 `/m/rules` 열람·서명 (기존 `/m` 문서형 화면 없음 — `MobileShell` 위 신규)
- 챗봇/NLQ에서 사규 조문 답변(시맨틱 위저드 자산 연계)
- 다우오피스 이관 문서 중 과거 사규 개정 이력 백필

## 5. 재사용 자산 매핑 (조사 실측)

| 필요 기능 | 재사용 원천 |
|---|---|
| 버전 불변 모델 | `156_labor_contracts.sql` `labor_contract_templates` |
| 대상자 행 선생성·status 전이 | `088_leave_promotion.sql` `leave_notices` |
| 라운드 + 결재 게이트 | `labor_contract_rounds` |
| 전자서명(서버 생성 텍스트) | `lib/payroll/sign.ts` (+ 동의판 관례 `lib/approval/overtime-consent.ts`) |
| 동의 모달 UI | `components/home/widgets/ContractInboxCard.tsx` |
| 수집 보드 | `components/approval/LeavePromotionBoard.tsx` |
| hwpx 파싱 | `lib/deliverable/hwpx-doc.ts::parseHwpx` |
| LLM 조문 추출 | `lib/agreement/analyze.ts` 선례 |
| 표 추출 | `lib/bid/hwpx-form.ts::parseHwpxForm` (수정 금지 — 기법 복사) |
| PDF | `pdf-lib` + `lib/intel/briefing-pdf.ts` `PdfWriter`/`wrapText` |
| 게시판 공고 | `108_board_core.sql` / `lib/board.ts` |
| 파일 보관 | `lib/storage/contract-document-storage.ts` + `lib/files/library.ts` |
| 조직도 피커·DM 리마인드 | `components/approval/OrgPickerModal.tsx`, `api/personal-docs/send` |

## 6. 열린 결정(착수 전 확인)

1. **동의 방식 라벨**: 부동의 허용을 어디까지 노출할지(부동의 버튼 명시 vs 의견란만). 법적으로는 자유로운 부동의가 보장돼야 증빙력이 생김 → 명시 권장.
2. **과반수 분모**: 발송 시점 재직자 스냅샷으로 고정(설계안) vs 확정 시점 재계산. 스냅샷 고정 권장(수집 중 입퇴사로 게이지가 흔들리지 않도록; 단 확정 직전 재검증 표시).
3. **전자결재 연동**: 개정안 자체를 전자결재(대표이사 승인) 태울지 — `approval_doc_id` 필드는 준비하되 v1에서는 선택 사항.
4. **별도 규정들**(육아기 단축규정 등) 초판 임포트 범위 — 사규 본체 먼저, 나머지는 P1 이후 순차.
