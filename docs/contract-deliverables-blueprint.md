# 착수계·준공계 작성 블루프린트 (contract deliverables)

계약 이행 서류(착수계·준공계 및 부속 서식)를 **계약 메뉴**에서 작성하고, 완성된 산출물을
**공문의 첨부서류로 연계 발송**하는 기능. 공문(`docs/official-letter-blueprint.md`)·견적서
(`docs/quotation-blueprint.md`)에 이은 세 번째 문서 발송 계열 기능이다.

## 0. 확정 사항 (2026-08-07 사용자 결정)

| 논점 | 결정 |
|---|---|
| 결재 | **공문 결재로 갈음** — 착수계·준공계 자체는 상신하지 않는다. 첨부한 공문이 결재를 받으면 함께 승인된 것으로 본다 |
| 메뉴 위치 | **계약 메뉴**(`/contracts/deliverables`) — 전자결재 아님 |
| 기본 카탈로그 | 착수계 / 준공 3종 세트(준공검사원·정산동의서·감독신청) / 준공내역서·용역결과보고서 = **6종** |
| 산출물 | **PDF + HWPX** 둘 다 |
| 양식 분석 입력 | **HWPX·DOCX(구조 파싱) + 스캔 PDF(Claude 멀티모달)** |

사용자 흐름(사용자 명시):
`착수계/준공계 작성` → `공문 작성 메뉴로 이동` → `공문 본문 작성(템플릿 제공)` → `첨부서류로 자동 첨부` → `발송`

## 1. 실측 근거 — 기본양식(5대 발전사 계열)

### 1-1. 착수계 (`착수계(당진발전본부 …).hwp` 실측)

```
                  착 수 계                     ← 제목, 중앙, 자간 넓힘

 □ 계 약 명 : [당진] 2024년 통합환경허가 변경관리 용역
 □ 계약금액 : 일금 일억칠천일백오십만원정
              (￦171,500,000) VAT포함          ← 금액 2행(한글 / 숫자+VAT표기)
 □ 착수일자 : 2024. 10. 04.
 □ 완료일자 : 2026. 10. 03.

상기와 같이 용역을 착수하였기 신고서를 제출합니다.

                2024.  10.  04.                ← 작성일, 중앙

                          주  소 : 서울 금천구 가산디지털1로 100
                                   에이스골드타워 12층      ← 주소 2행 접힘
                          상  호 : ㈜한국환경안전연구원
                          대표자 : 이 유 억    (인)         ← 인감 날인 위치

  한국동서발전 귀하                              ← 수신, 좌측·굵게
```

### 1-2. 준공 3종 세트 (`준공계(수도권매립지관리공사).hwp` 실측 — 한 파일에 3장)

`준공검사원` / `준공금액 정산동의서` / `준공 감독 신청` 세 장이 **머리 9항목과 준공금액 표를
공유**하고 본문 문구만 다르다.

```
1. 계   약   명 : 2025년도 통합환경허가 사후관리 용역
2. 계 약  금 액 : 일금 구천삼백칠십팔만일천오백 원정(￦ 93,781,500–VAT 포함)
3. 준공기성금액 : 일금 오천삼백팔십이만육천이백일십사 원정(￦ 53,826,214–VAT 포함)
4. 누계준공금액 : 일금 구천일백일십오만사천팔백이십삼 원정(￦ 91,154,823–VAT 포함)
5. 계   약   일 : 2025년  07월  01일
6. 착   수   일 : 2025년  07월  17일
7. 준공  예정일 : 2026년  07월  17일
8. 실  준 공 일 : 2026년  07월  17일
9. 준 공  금 액(단위 : 원)
```

준공금액 표(9번 항목) — 2단 헤더 + 자사 행 + 합계 행:

| 구 분 | 전회(공급가액/부가세) | 금회(공급가액/부가세) | 누계(공급가액/부가세) |
|---|---|---|---|
| ㈜한국환경안전연구원 | 33,935,099 / 3,393,510 | 48,932,922 / 4,893,292 | 82,868,021 / 8,286,802 |
| 합 계 | 37,328,609 | 53,826,214 | 91,154,823 |

> 합계 행은 공급가액+부가세를 **병합 셀 1칸**으로 적는다(실측).

장별 본문 문구:

| 서식 | 본문 |
|---|---|
| 준공검사원 | 위 용역의 도급시행에 있어서 용역 전반에 걸쳐 설계서, 계약문서 및 기타 약정대로 어김없이 준공되었음을 확인하였기에 준공 검사원을 제출하오니 검사하여 주시기 바랍니다. |
| 정산동의서 | 상기 계약명의 이행완료와 관련 귀사의 준공 정산금액에 대하여 이의 없이 동의함을 확인합니다. |
| 감독 신청 | 위 공사에 대하여 `{계약일}`부터 `{실준공일}`까지 설계서, 계약문서 및 기타 약정대로 공사에 준공되어 감독을 신청합니다. |

서명 블록은 3장 공통(`계약상대자 / 주소 / 상호 / 대표자 (인)`) + `{발주처} 귀하`.

### 1-3. 발주처 자체양식 사례 (인천공항에너지 — 스캔 PDF)

`[첨부 1] 준공계` / `[첨부 2] 준공 검사원` / `[첨부 3] 준공 내역서` / `용역결과보고서` 4종.
기본양식과 **항목 구성·순서·번호 체계가 다르다**(예: 준공계는 용역명·용역금액·준공금액·계약일·
착수일·준공예정일·실준공일 7항목이고 준공금액 표가 없음. 준공검사원에는 `용역위치`·`현재 공정율`
항목과 우상단 `감독자 서명` 박스가 있음. 용역결과보고서에는 `발주번호`·`계약기간`·`첨부자료`가 있음).

→ **기본양식으로 대응 불가한 발주처가 실재**한다는 근거. 이 4종이 §6 양식 분석의 검증 케이스다.

## 2. 문서 IR — `DeliverableSpec` (설계의 중심)

렌더러(PDF·HWPX)·편집기·AI 분석이 **공유하는 단일 중간표현**. 기본양식 6종은 이 구조로
코드에 상수 정의하고, 발주처 자체양식은 AI 분석 결과가 같은 구조로 산출돼 DB에 저장된다.
즉 "기본양식 = 코드 상수인 Spec", "자체양식 = DB에 저장된 Spec"으로 **렌더 경로가 하나**다.

```ts
// frontend/lib/deliverable/types.ts (클라/서버 공용 — DB import 금지)
export interface DeliverableSpec {
  docType: string;              // 카탈로그 키 또는 "custom:<slug>"
  title: string;                // 목록·체크박스 표기명
  page?: { marginPt?: Partial<Margins> };
  blocks: DocBlock[];
}

export type DocBlock =
  | { kind: "note"; text: string }                       // 좌상단 "[첨부 1]"
  | { kind: "title"; text: string; fontPt?: number; letterSpacingPt?: number; underline?: boolean }
  | { kind: "fields"; numbering: "none" | "decimal" | "square"; rows: FieldRow[]; labelWidthPt?: number }
  | { kind: "table"; columns: ColSpec[]; rows: CellSpec[][]; caption?: string }
  | { kind: "para"; text: string; align?: Align; indentPt?: number }   // {{binding}} 치환 지원
  | { kind: "dateLine"; binding: string; format: DateFormat; align?: Align }
  | { kind: "signature"; rows: FieldRow[]; align?: Align; stamp?: boolean }
  | { kind: "receiver"; binding: string; suffix: string; fontPt?: number; align?: Align }
  | { kind: "stampBox"; label: string }                   // 우상단 "감독자 서명" 박스
  | { kind: "spacer"; heightPt: number };

export interface FieldRow {
  label: string;                // "계 약 명"(실측 자간 그대로 문자열에 보존)
  binding?: string;             // §3 바인딩 키. 없으면 text 고정 문구
  text?: string;
  format?: FieldFormat;
  suffix?: string;              // "(VAT 포함)" 등
  secondLine?: { binding?: string; text?: string; format?: FieldFormat };  // 착수계 금액 2행
}

export type FieldFormat =
  | "text" | "amountHangul" | "amountNumber" | "amountBoth"   // amountBoth: "일금 …원정(￦93,781,500–VAT 포함)"
  | "dateDotted"    // 2024. 10. 04.
  | "dateKorean"    // 2025년  07월  01일
  | "dateSpaced"    // 2026년    7월     17일 (작성일 표기)
  | "percent" | "period";
```

**한글 금액 표기 주의**: 실물은 `일금 일억칠천일백오십만원정`처럼 **선행 `일`을 붙인다**.
반면 `lib/quote/hangul-amount.ts`의 `toHangulAmount`는 견적서 관행대로 생략형(`억`, `천`)이다.
→ 옵션 `{ leadingOne: true }`를 추가하고 견적서 기본 동작은 유지한다(회귀 금지).

## 3. 바인딩 카탈로그 — 자동 채움

| binding | 항목 | 소스 |
|---|---|---|
| `contract.title` | 계약명·용역명 | `contracts.contract_title` |
| `contract.amount` | 계약금액 | `contracts.current_amount ?? contract_amount` |
| `contract.date` | 계약일 | `contracts.contract_date` |
| `contract.startDate` | 착수일 | `contracts.started_at` |
| `contract.endDate` | 준공예정일·완료일자 | `contracts.ended_at` |
| `contract.period` | 계약기간 | `started_at ~ ended_at` |
| `contract.orderNo` | 발주번호 | `contracts.legacy_contract_no`(없으면 수동) |
| `site.name` / `site.address` | 사업장명·용역위치 | `facilities` |
| `orderer.name` | 발주처 | `legal_entities.entity_name`(counterparty) |
| `completion.actualDate` | 실준공일 | 입력(기본값 `ended_at`) |
| `completion.currentAmount` | 준공기성금액(금회) | milestones 집계 |
| `completion.cumulativeAmount` | 누계준공금액 | 전회+금회 |
| `completion.prevSupply/prevVat/curSupply/curVat/cumSupply/cumVat` | 준공금액 표 6칸 | milestones 집계 |
| `completion.progressRate` | 공정율 | 입력(기본 `100%`) |
| `company.name/address/ceo/bizNo` | 자사 정보 | `company_profile`(폴백 `lib/letter/types.ts` 상수) |
| `issue.date` | 작성일 | 입력(기본 오늘) |

**기성 집계 규칙**(`contract_payment_milestones`):
- 금회 = 이번 준공 대상 회차(사용자가 선택, 기본 = 미발행 회차 중 마지막)
- 전회 = 금회보다 `stage_order`가 앞선 회차의 합
- 누계 = 전회 + 금회 / 부가세는 `invoice_amount`가 있으면 그 값, 없으면 `공급가액 × 0.1`
- 회차 데이터가 없는 계약은 전액을 금회로 놓고 사용자가 수정(잠금 해제)

## 4. 스키마 — `infra/aws/142_contract_deliverables.sql`

```sql
CREATE TABLE IF NOT EXISTS deliverable_templates (      -- 발주처 자체양식
  template_id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,                                   -- 'start' | 'completion'
  owner_entity_id text REFERENCES legal_entities(entity_id) ON DELETE SET NULL,
  source_kind text, source_key text, source_pages integer,   -- 업로드 원본(S3)
  spec jsonb NOT NULL,                                  -- DeliverableSpec[]
  analyzed_at text, analyze_model text, analyze_note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL, updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_deliverables (      -- 작성된 착수계·준공계
  deliverable_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  kind text NOT NULL,                                   -- 'start' | 'completion'
  template_id text REFERENCES deliverable_templates(template_id) ON DELETE SET NULL,  -- NULL = 기본양식
  doc_types jsonb NOT NULL,                             -- 생성할 서식 키 배열(순서 = 페이지 순서)
  title text NOT NULL,
  field_values jsonb NOT NULL,                          -- 자동채움 + 사용자 확정값(바인딩 키 → 값)
  pdf_key text, hwpx_key text, generated_at text,
  letter_doc_id text, letter_no text,                   -- 연계 공문(approval_docs.doc_id)
  status text NOT NULL DEFAULT 'draft',                 -- draft | ready | attached | sent
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL, updated_at text NOT NULL
);
```
인덱스: `contract_deliverables(contract_id, kind)`, `(status)`, `(letter_doc_id)`,
`deliverable_templates(owner_entity_id, kind)`.

## 5. 화면 — `/contracts/deliverables` (메뉴: 계약 › 착수계·준공계)

`config/menu.ts`의 계약 서브메뉴에 추가. cdash 컨셉(`CdPageHeader` + `useCdashTheme`) 적용.

**탭 1 · 작성**
1. 계약 선택 — 검색(계약명·발주처) → 선택 시 계약 카드(발주처·금액·기간·기성 현황) 표시
2. 종류 — `착수` / `준공` 토글
3. 양식 — `기본양식` / 발주처 등록 양식(해당 발주처 양식이 있으면 자동 추천·우선 선택)
4. 서식 체크 — 카탈로그에서 필요한 것만(착수: 착수계 · 준공: 검사원/정산동의서/감독신청/내역서/결과보고서)
5. 필드 확인 — 자동 채움값 표시, 자물쇠 해제로 수동 수정(초과근무 양식의 자동채움+잠금 UX 답습)
6. 미리보기(PDF) → **저장** → `PDF·HWPX 다운로드` / **`공문으로 발송`**

**탭 2 · 발주처 양식**
등록 목록(발주처·종류·서식 수·분석일) + `양식 업로드`(발주처·종류 지정) → AI 분석 → 편집기 진입.

**탭 3 · 작성 이력**
계약별 작성분 목록(상태·연계 공문번호·발송일), 재생성·복제.

## 6. 발주처 자체양식 분석 (§0 결정: 구조 파싱 + 멀티모달)

| 입력 | 경로 |
|---|---|
| HWPX | `lib/bid/hwpx-form.ts`의 표·셀 파서 재사용 → 직렬화 → LLM |
| DOCX | 동일 직렬화 포맷으로 변환하는 파서 신설(`docx-form.ts`) |
| PDF(스캔·텍스트) | `type:"document"` base64 직접 입력(`lib/ieps/business-certificate-llm.ts` 패턴) → 멀티모달 분석 |

프롬프트 산출물은 **§2 `DeliverableSpec[]`**(bid의 셀 좌표 profile과 달리 문서를 *재구축*한다).
규칙: ① 페이지/`[첨부 N]` 단위로 문서를 나눈다 ② 라벨 문자열은 **자간 공백까지 원문 그대로**
보존한다 ③ 값 자리는 §3 바인딩 키로 매핑하고, 대응 키가 없으면 `custom:<slug>`로 두어 편집기에서
사용자가 채우게 한다 ④ 확신이 없어도 가장 그럴듯한 구조를 낸다(사용자가 편집기에서 보정).

## 7. 웹 편집기 (2차 다듬기)

3분할: **좌** 원본(스캔 이미지/파싱 텍스트) · **중** 블록 편집 · **우** 실시간 미리보기(PDF).

- 블록: 추가·삭제·순서 이동, 종류 변경
- `fields`: 행 추가·삭제, 라벨 텍스트(자간 포함) 편집, 바인딩 선택(§3 드롭다운), 포맷·접미어
- `table`: 행·열 추가·삭제, 셀 텍스트/바인딩, 병합(합계 행), 열 너비 비율
- `para`: 문구 편집 + `{{바인딩}}` 삽입 버튼
- 미세조정: 제목 자간·글자 크기, 블록 간 여백, 인감 위치(`stampDx/Dy` — 공문 `LetterLayoutOverrides` 답습)
- 저장 시 `deliverable_templates.spec` 갱신(원본 파일은 보존해 재분석 가능)

## 8. 공문 연계 (사용자 명시 흐름)

- `공문으로 발송` → `/approval/letter?deliverable=<id>`로 이동
- 공문 작성 화면(`ApprovalLetterBoard.tsx:923` — 이미 *"추후 준공계·착수계 작성 기능 배치 예정"*
  주석이 있는 자리)에서:
  - 수신처 = 계약 발주처 자동 세팅, 제목 = `「{계약명}」 착수계 제출` 자동 제안
  - **본문 템플릿 2종** 자동 적용(사용자 요청 — 착수계·준공계 공문은 문구가 정형화):
    - 착수: `1. 귀사의 무궁한 발전을 기원합니다.` / `2. 「{계약명}」 계약 체결에 따라 착수계를 붙임과 같이 제출합니다.`
    - 준공: `2. 「{계약명}」 용역이 완료되어 준공계를 붙임과 같이 제출하오니 검사하여 주시기 바랍니다.`
  - 첨부서류에 산출물 PDF(+옵션 HWPX) 자동 등록, **붙임 목록 자동 기입**(`1. 착수계 1부. 끝.`)
- 공문 발송 완료 시 `contract_deliverables.status='sent'` + `letter_no` 기록(역참조 가능)

## 9. 렌더러

- **PDF**: `lib/deliverable/pdf.ts` — `lib/letter/pdf.ts`의 폰트 embed(맑은 고딕)·`wrapRuns`·
  인감(`letter/stamp.png`) 로직 재사용. 서식 1종 = 1페이지, 선택 서식 수만큼 다중 페이지.
- **HWPX**: `lib/deliverable/hwpx.ts` — 공문과 달리 템플릿 토큰 치환이 아니라 **Spec에서 문단·표
  XML을 생성**한다. `lib/letter/hwpx.ts`의 표·문단 XML 빌더와 스타일 헤더 정의를 재사용.

## 10. 단계

| 단계 | 내용 | 산출 |
|---|---|---|
| **D0** | 마이그 142, `lib/deliverable/types.ts`, 기본양식 6종 Spec 상수, 한글금액 `leadingOne` 옵션 | 스키마·IR |
| **D1** | 계약 자동채움 로더(기성 집계 포함) + 작성 화면(탭1) + PDF 렌더 + 저장 API | 착수계·준공계 PDF 생성 |
| **D2** | HWPX 렌더 + 다운로드 | 산출물 2종 |
| **D3** | 공문 연계(본문 템플릿·첨부 자동·붙임·상태 역기록) | **발송까지 일주** |
| **D4** | 발주처 양식 업로드·AI 분석(HWPX/DOCX/PDF) + 템플릿 목록(탭2) | 자체양식 대응 |
| **D5** | 웹 편집기(§7) + 작성 이력(탭3) | 사용자 보정 |

D0~D3이 실사용 최소선(기본양식으로 발송까지). D4~D5는 자체양식 고집 발주처 대응.
