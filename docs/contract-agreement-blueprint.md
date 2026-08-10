# 계약서 작성 블루프린트 (contract agreements)

용역 계약서를 **계약 메뉴**에서 작성하고, 전자결재로 임원·부서장 검토를 받은 뒤
발주처 담당자에게 초안을 발송하는 기능. 공문(`docs/official-letter-blueprint.md`)·
견적서(`docs/quotation-blueprint.md`)·착수계/준공계(`docs/contract-deliverables-blueprint.md`)에
이은 네 번째 문서 발송 계열 기능이다.

## 0. 요구사항 (2026-08-10 사용자 제시)

| # | 요구 | 비고 |
|---|---|---|
| R1 | 용역별로 다른 양식을 **업로드/분석** | 발주처 자체 양식 요구 케이스 대응 |
| R2 | 계약별로 달라지는 **업체 정보·용역 범위 입력** | 갑지 슬롯 채움 |
| R3 | 업체가 요구한 **추가 계약 조항 삽입** | 조문 편집 |
| R4 | 초안을 **기안 → 임원/부서장 검토** | 전자결재 연동 |
| R5 | 검토 완료본을 **발주처 담당자에게 발송** | 메일(SES) |
| — | 메뉴 위치: 계약 > **수주/수금/발행 현황 다음** | `config/menu.ts:155` 뒤, 착수계·준공계 앞 |

## 1. 실측 근거 — 제공 양식 6종 분석

| 양식 | 유형 | 구조 |
|---|---|---|
| 코리아써키트 3공장 통합환경 변경 | **A. 표준 도급계약서** | 갑지 표(당사자·계약명·금액 3단·지급조건·기간·체결문·날인) + 별지 「용역계약 조건」 **15개조** |
| 국도화학 경인/부산 허가재검토 (2건) | **A. 표준 도급계약서** | 같은 갑지 + **16개조**. 두 사업소 간 차이는 계약명·금액·지급액뿐(조문 동일) |
| HAPs 변경신고서 양식 | **B. 1장 갑지 계약서** | 표 하나로 완결 — 계약자(갑/을 상세)·용역명·총액·결재조건(계약금/중도금/잔금)·기간·**기타사항(용역범위 서술)**·체결문·날인. 발주자측은 `㈜OOO` 플레이스홀더 |
| 엘에스엠앤엠 (2건) | **C. 발주처 자체양식** | 번호목록식 갑지(계약명/대상/업무범위/기간/금액/지급조건/기타) + 「용역 도급 일반조건」 **14개조**. 관할법원이 발주처 소재지(울산) 기준 |

핵심 관찰:

1. **가변 슬롯은 갑지에 집중** — 발주자 정보, 계약명, 금액(공급가·세액·합계 + 한글 금액),
   지급조건(2~3단계, 비율·금액·지급 시점), 계약기간, 용역범위, 체결일, 날인 블록.
2. **조문도 계약마다 다르다** — 같은 A형이라도 코리아써키트(15조)와 국도화학(16조)은
   착수 조건(용역수행계획서·보안서약서 제출), 보안 조항의 상세도, 지급 단계 수(2단/3단),
   용역 완료의 정의(환경부/기후부 검토결과서), 대금 지급기한(익월말/7일)이 다르다.
   → 고정 본문이 아니라 **조 단위 편집 가능한 구조**여야 한다.
3. **지급조건 ↔ 지급방법 조문 연동** — 갑지의 "대금 지급 조건"과 별지 "제N조 (용역금액의
   지급방법)"이 같은 데이터(단계·비율·금액·시점)의 두 가지 표현이다. 단계 데이터를 한 번
   입력하면 양쪽 문구를 자동 생성할 수 있다.
4. **C형(자체양식)은 구조가 완전히 다르다** — 갑지 레이아웃·조문 번호 체계([제N조] 대괄호)·
   용어(도급인/수급인 vs 발주자/과업수행자)·관할까지 다름. 고정 템플릿으로 커버 불가 →
   업로드/분석 경로 필요(R1).
5. 한글 금액 표기(`일금 이천칠백만 원정`)는 `lib/quote/hangul-amount.ts` 재사용.

## 2. 설계 중심 — `AgreementSpec` (문서 IR)

착수계의 `DeliverableSpec`처럼, 렌더러(PDF·HWPX)·편집기·AI 분석이 공유하는 단일
중간표현을 둔다. 계약서 특성상 **갑지(cover) + 조문(clauses)** 2부 구조.

```ts
// frontend/lib/agreement/types.ts (클라/서버 공용 — DB import 금지)
export interface AgreementSpec {
  coverStyle: "table" | "list";   // A형 갑지 표 | B·C형 목록식
  hasClausePage: boolean;          // B형(1장 갑지)은 false
  terms: { orderer: string; contractor: string };  // "발주자/과업수행자", "도급인(갑)/수급인(을)" 등
  clauseNoFormat: "제 N 조 (title)" | "제N조 [title]";
  clauses: AgreementClause[];      // 템플릿 기본 조문 세트
  // 갑지 레이아웃은 coverStyle별 렌더러 상수 + 필드 표시 여부 옵션
}

export interface AgreementClause {
  id: string;          // 안정 키(번호 재부여와 무관)
  title: string;       // "계약의 목적"
  body: string;        // 항(①②…)·호(1. 2.…) 포함 본문. {{binding}} 치환 지원
  binding?: "payment" | "scope" | "period" | null;  // 구조 데이터에서 자동 생성되는 조
  locked?: boolean;    // 자동 생성 조는 직접 수정 대신 원천 데이터 수정 유도
}
```

- **필드값(문서별 입력)**은 `approval_docs.field_values`(견적서 패턴)로 관리:
  발주자(사업장 연동)·수급자(당사 상수)·계약명·금액·지급 단계 배열·기간·용역범위·체결일·
  조문 오버라이드(추가/수정/삭제/순서), 수신처(발송용).
- **지급 단계 배열** `{ label: "착수금"|"중도금"|"잔금"|…, ratio, amount, condition }` →
  갑지 "대금 지급 조건" 문구와 "지급방법" 조문을 렌더 시 자동 생성(관찰 3).
- 조문 번호는 렌더 시 순서대로 자동 재부여 — 삽입/삭제해도 번호 안 깨짐(R3).

## 3. 데이터 모델 (마이그 `147_contract_agreements.sql`)

견적서의 2단 모델을 따른다: **문서 원본 = `approval_docs.field_values`**(form `frm-agreement`),
대장 = 발송·산출물 메타.

```sql
-- 양식(템플릿): 용역 대분류-세분류별 표준 셋 + 업로드 분석 결과(자체양식)
-- 견적 기준 세트(quote_rate_sets, 136:45)와 동일 패턴 — 세분류당 1개 활성 버전,
-- 문서에는 기안 시점 조문이 field_values 로 스냅되므로 템플릿 수정이 기존 문서를 훼손하지 않는다.
CREATE TABLE IF NOT EXISTS agreement_templates (
  template_id     text PRIMARY KEY,          -- 'agt-' + slug
  name            text NOT NULL,             -- "통합환경 도급계약서(표준)", "HAPs 갑지", "엘에스엠앤엠 자체양식"
  kind            text NOT NULL DEFAULT 'standard',  -- standard(분류 축) | custom(발주처 축, 업로드)
  service_type    text,                      -- 계약관리 대분류 (standard 필수)
  service_subtype text,                      -- 계약관리 세분류 (standard 필수)
  version         integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'active',   -- active | draft | archived
  origin_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,  -- custom 출처 발주처
  spec            jsonb NOT NULL,            -- AgreementSpec
  source_key      text,                      -- 업로드 원본 hwpx/docx S3 키
  created_by      text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_type, service_subtype, version)   -- standard: 세분류당 버전 유일
);

-- 계약서 대장
CREATE TABLE IF NOT EXISTS contract_agreements (
  agreement_id    text PRIMARY KEY,
  doc_id          text NOT NULL UNIQUE,      -- approval_docs FK (결재 문서 = 원본)
  template_id     text REFERENCES agreement_templates(template_id) ON DELETE SET NULL,
  contract_id     text REFERENCES contracts(contract_id) ON DELETE SET NULL,   -- 연결 계약(선택)
  quotation_id    text,                      -- 연결 견적(선택)
  counterparty_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  title           text NOT NULL,
  amount_supply   bigint, amount_vat bigint, amount_total bigint,
  field_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 승인 시점 field_values 스냅
  pdf_key         text, hwpx_key text,
  send_status     text NOT NULL DEFAULT 'draft',  -- draft|approved|sending|sent|failed
  send_attempts   int NOT NULL DEFAULT 0,
  sent_at         timestamptz, sent_to jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

> 주의: 133 번호 중복 전례가 있으니 신규는 147 고정(현재 최고 146).

## 4. 메뉴·화면 구성

`config/menu.ts` 계약 submenu, `수주/수금/발행 현황` 다음에 삽입:

```
{ title: "계약서 작성", href: "/contracts/agreements" }
```

| 화면 | 경로 | 내용 |
|---|---|---|
| 작성 보드 | `/contracts/agreements` | 대장 목록(상태·발송 이력) + 신규 작성 진입. `DeliverableBoard` 골격 재사용 |
| 작성/편집 | 보드 내 패널(또는 `?draft=`) | §5 |
| 양식 관리(기준 관리) | `/contracts/agreements/templates` | **견적 기준 관리(`/approval/quote/settings`) 스타일** — 용역 대분류→세분류 목록에 각 세분류의 활성 표준 셋(갑지 스타일·조문 세트)을 매핑해 열람/편집. 표준 셋이 없는 세분류는 목록에서 "미지정"으로 보여 채워 넣도록 유도. 자체양식(custom)은 발주처 축의 별도 탭(업로드/분석/검수). 관리 권한자만 진입, 메뉴 미노출 |

UI는 cdash 컨셉(`.cursor/rules/ui-modernize.mdc`) 준수.

## 5. 작성 화면 흐름

1. **연동 선택** — ① 견적서에서 시작(수주 확정 견적 → 계약명·금액·발주처 자동 채움),
   ② 기존 계약에서 시작(`contracts` 선택 → counterparty·금액·기간 채움), ③ 백지 시작.
   발주처는 `FacilityRecipientPicker`(공문) 재사용.
2. **양식 선택** — 연동 선택으로 용역 대분류·세분류가 잡히면 **해당 세분류의 활성 표준 셋을
   자동 선택**(견적 산정이 세분류로 기준 세트를 찾는 것과 동일). 발주처에 연결된
   자체양식(`origin_facility_id`)이 있으면 함께 추천, 수동 변경 가능.
3. **갑지 입력**(R2) — 계약명·금액(공급가 입력 → 세액·합계·한글금액 자동)·지급 단계
   편집기(비율 입력 → 금액 자동 분배, 시점 문구)·계약기간·용역범위(멀티라인)·체결일.
4. **조문 편집**(R3) — 템플릿 기본 조문 로드 → 조 단위 카드 목록.
   개별 수정 / 삽입(직접 작성 or 조항 라이브러리) / 삭제 / 순서 이동. 번호 자동 재부여.
   `binding` 조(지급방법 등)는 갑지 데이터에서 자동 생성됨을 표시.
   **조항 라이브러리**: 표준 템플릿의 조문 + 과거 계약서에서 저장한 조항을 검색 삽입
   (1차는 템플릿 조문 세트만, 라이브러리 축적은 후속).
5. **미리보기** — 저장 없이 PDF 온디맨드 렌더(공문 `preview` 패턴).
6. **기안**(R4) — 결재선(임원/부서장)+참조자 지정 후 상신. 공문의 `persist()` 패턴 —
   ⚠ save→submit 시 `docIdOverride` 필수(이중 기안 실사고 전례).

## 6. 양식 업로드/분석 (R1)

착수계 D4(`template-analyze.ts` 계열)를 계약서용으로 확장한다. 입력: HWPX·DOCX(구조 파싱),
스캔 PDF(Claude 멀티모달 — 착수계와 동일 경로).

분석 산출 = `AgreementSpec`: ① 갑지에서 슬롯(당사자·금액·지급·기간·범위) 탐지,
② 조문을 `제N조` 경계로 분리해 `clauses[]`로 추출, ③ 용어(갑/을 vs 발주자/수급자)·번호
포맷 감지. → **검수 화면**에서 슬롯 매핑·조문 경계를 사람이 확인/수정 후 저장.

렌더 경로는 착수계처럼 이원화하되 계약서 특성에 맞게:

| 모드 | 동작 | 적합 케이스 |
|---|---|---|
| `spec`(기본) | 분석 결과 Spec으로 재구축 — 조문 수정·삽입 자유 | 대부분. 엘에스엠앤엠처럼 갑지+조문 채움·수정 필요 시 |
| `overlay` | 업로드 HWPX 원본 보존 + 갑지 슬롯 값만 주입(`template-fill.ts` 패턴) | 발주처가 "서식 그대로" 요구하고 조문은 손대지 않는 경우 |

> spec 변환은 원본 서식(들여쓰기·표 스타일)이 당사 표준 렌더로 정규화된다.
> 서식 보존이 계약 성립의 요건인 발주처는 overlay로 대응.

## 7. 산출물 생성 (PDF + HWPX)

- **PDF** — `pdf-lib` 직접 렌더(다페이지). 갑지 표는 착수계 `pdf.ts` table 렌더,
  조문은 문단 렌더 + 페이지 넘김. 공식 검토·보관본.
- **HWPX** — 공문 `hwpx.ts` 템플릿 조립 방식. `public/hwpx/agreement.hwpx` 템플릿에서
  스타일·표 골격 추출 후 본문 프로그램 생성. **계약서는 발주처와 왕복 수정 협의가 전제**라
  편집 가능한 HWPX가 공문보다 중요도 높음.
- S3 키: `agreements/{연도}/{agreement_id}/{계약명}.pdf|.hwpx`
- overlay 모드는 업로드 원본에 값 주입한 HWPX가 원본, PDF는 converter 변환(첨부 미리보기
  파이프라인 재사용) 검토.

## 8. 전자결재 검토 (R4)

- 양식 `frm-agreement` 신설(견적 `frm-quotation` 패턴). 결재 화면에 계약서 전용 뷰
  (`ApprovalDocModal` 공문 분기 패턴) — 갑지 요약 + PDF 미리보기.
- **채번**: 계약서에는 대외 문서번호가 없음 → 공문식 `대외` 채번은 쓰지 않고 전자결재
  일반 문서번호만 사용(제안, §10-③).
- 최종 승인 트랜잭션에서 대장 `send_status='approved'` 마킹 + `field_snapshot`·산출물 생성.
  **공문과 달리 자동 발송하지 않는다**(§10-①).
- 반려 → 재기안: `edit-route.ts`에 `frm-agreement` 분기 추가(공문 패턴).

## 9. 발주처 발송 (R5)

- 승인된 계약서를 보드에서 **[발주처 발송] 버튼으로 수동 발송**. 발송 다이얼로그에서
  수신 담당자(`/api/approval/contacts` 픽커)·안내 문구 확인 후 실행.
- 발송 파이프라인은 공문 `send.ts` 재사용: 개별 raw 발송, 첨부 20MB 직접/초과 시 presigned
  링크(7일), 내부 참조 Cc(watchers), 기본 서명, RFC2231 파일명 인코딩(실사고 전례).
- 첨부: 다이얼로그에서 PDF/HWPX 선택 — **기본 HWPX만**(초안은 발주처 수정 협의용 편집본), PDF는 추가 체크. + 필요 시 동봉 서류.
- 멱등키 `agreement-send:{docId}:{sendAttempts}`, 실패 시 대장 failed → 재발송 버튼.
- 발송 후 발주처 수정 요구 → 재기안(v2) → 재발송. 대장에 회차 이력 표시.

## 10. 확정 사항 (2026-08-10 사용자 결정)

| # | 논점 | 결정 |
|---|---|---|
| ① | 발송 시점 | **승인 후 수동 발송 버튼** — 계약서 초안은 발송 타이밍·수신자·문구를 사람이 정하는 협의 문서 |
| ② | 자체양식 처리 | **spec 기본 + overlay 옵션** 이원화(§6). 1차 구현은 spec, overlay는 후속 |
| ③ | 채번 | 계약서 고유 대외번호 **없음** — 전자결재 일반 채번만 |
| ④ | 발송 포맷 | 발송 다이얼로그에서 **PDF/HWPX 첨부 선택 옵션**. **기본값 = HWPX** — 초안 발송은 발주처 담당자의 수정 요구가 전제라 편집 가능한 한글본이 표준. PDF는 필요 시 추가 체크 |
| ⑤ | contracts 대장 연동 | `contracts` 레코드 **자동 생성 안 함** — 기존 계약/견적 참조 연결만(대장 컬럼). 계약 등록은 현행 수동 등록 유지 |
| ⑥ | 표준 셋 시드 | **용역 대분류-세분류 축으로 목록화**(견적 기준 세트 패턴). 시드는 실측 양식이 있는 세분류부터 — 통합허가 계열(허가재검토·변경허가 등)=A형 도급계약서(국도화학 16개조 기준, 코리아써키트식 문구는 조항 라이브러리로), HAPs 계열=B형 1장 갑지. 나머지 세분류는 관리 화면 "미지정"으로 노출하고 사용자가 기존 hwpx 업로드/분석(§6) 또는 기존 셋 복제로 채움 |

## 11. 구현 단계 (제안)

| 단계 | 내용 | 산출 |
|---|---|---|
| **CA-P0** | 마이그 147 + `lib/agreement/`(types·store) + 메뉴/보드 골격 + 표준 셋 시드(통합허가·HAPs 계열) + 작성 화면(연동 자동채움·세분류→표준 셋 자동 선택·갑지·지급단계 편집기) + PDF 렌더/미리보기 | 초안 작성~PDF 확인 |
| **CA-P1** | 조문 편집(수정·삽입·삭제·순서·자동번호) + 기준 관리 화면(세분류별 표준 셋 목록·편집·복제) + `frm-agreement` 결재 상신/전용 뷰/재기안 | R3·R4 |
| **CA-P2** | HWPX 생성 + 승인 훅(대장·스냅·산출물) + 수동 발송 다이얼로그·발송 파이프라인 + 대장(상태·재발송·회차) | R5 |
| **CA-P3** | 양식 업로드/분석(HWPX·DOCX 파싱 + Claude 분석 + 검수 화면) + 자체양식 spec 렌더 | R1 |
| **CA-P4**(후속) | overlay 모드, 조항 라이브러리 축적(과거 계약서 백필), 계약 체결 완료 처리(날인본 업로드→contracts 연결) | 고도화 |

## 11-1. 구현 현황 (2026-08-10)

CA-P0~P3 1차 구현 완료(미커밋·미배포). 주요 산출:

- `infra/aws/147_contract_agreements.sql` — 템플릿·대장 + `frm-agreement` 양식 시드
- `frontend/lib/agreement/` — types·catalog(표준 셋 시드: 통합허가 A형 16개조·HAPs B형)·compose·store·pdf(다페이지 흐름)·hwpx(`public/hwpx/agreement.hwpx` = 국도화학 실측 템플릿)·generate·send·analyze
- 화면: `/contracts/agreements`(보드: 목록+작성+조문 편집+발송 다이얼로그), `/contracts/agreements/templates`(기준 관리 + custom 업로드/분석/검수)
- 결재: `actOnDoc` 승인 훅(`markAgreementApproved` — 자동 발송 없음), 결재 화면 PDF 지면 심사 분기, 재기안 라우팅
- 구현 노트: 표준 셋 시드는 DB 시드가 아니라 **코드 상수 폴백**(deliverable 기본양식 관례) — DB 활성 셋이 우선하고, 시드 편집 시 DB 로 fork 된다. 자체양식 분석 1차는 HWPX 입력만(DOCX·스캔 PDF 후속). overlay 모드는 P4 잔여.

잔여: staging 마이그 147 적용·배포, 발송 실증, overlay 모드, 조항 라이브러리 축적(P4).

## 12. 재사용 자산 맵

| 필요 기능 | 재사용 원천 |
|---|---|
| 한글 금액 | `lib/quote/hangul-amount.ts` |
| 2단 데이터 모델(결재 문서+대장) | 견적 `lib/quote/store.ts` 패턴 |
| 발주처/담당자 픽커 | `ApprovalLetterBoard.tsx` `FacilityRecipientPicker`·contacts 픽커 |
| PDF 렌더 | `lib/deliverable/pdf.ts`(표·다페이지) + `lib/letter/pdf.ts`(폰트·인장) |
| HWPX 조립 | `lib/letter/hwpx.ts`(템플릿 스타일 추출·표 골격) |
| 양식 분석 | `lib/deliverable/template-analyze.ts`·`template-scan.ts`·`template-fill.ts` |
| 결재 상신·승인 훅 | `lib/approval/docs.ts` `submitDoc`·승인 트랜잭션(공문 분기 패턴) |
| 메일 발송·첨부·링크 | `lib/letter/send.ts`·`lib/mail/{send,mime}.ts` |
| 첨부 업로드(200MB) | `app/api/approval/attachments/route.ts` |
