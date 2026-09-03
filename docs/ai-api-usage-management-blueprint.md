# Claude API 사용량·과금 관리 블루프린트 (AI API 관리 메뉴)

작성일 2026-09-03. 대상 브랜치 `claude/mcm-job-template-editor-pxzyyp`(구현 착수 시 main 재분기).
목적: ① MCM 앱에서 발생하는 **모든 Claude API 호출 지점을 전수조사**하고, ② 호출별 사용량·과금을 **계측·집계·예측·경고**하는 관리자 메뉴 `/admin/ai-usage` 를 설계한다.

---

## 0. 요약 (한 페이지)

| 항목 | 결론 |
|---|---|
| 호출 지점 | **프론트(Next.js) 21개 기능 지점**, 파일 19개. backend(FastAPI)·scraper·converter·apps/mobile 에는 Anthropic 직접 호출 **없음**(모바일은 next API 경유). |
| 호출 방식 | 전부 `fetch("https://api.anthropic.com/v1/messages")` 직접 호출. SDK 미사용. 공용 헬퍼 `lib/ai/llm-json.ts` 경유 9곳 + 개별 fetch 12곳으로 **두 갈래**. |
| 핵심 결함 | 응답의 `usage`(input/output 토큰)를 **읽는 곳이 0곳**. 호출 로그 테이블 **없음**. → 현재는 호출당 과금을 앱 내부에서 알 방법이 없다. Console 청구액만 보인다. |
| 모델 분포 | Haiku 4.5(분류·요약·비전 파싱 11곳), Sonnet 5(양식 분석·브리핑·문서 파싱 9곳), Opus 4.8(사업자등록증 고품질), Opus 5(스캔 양식 재구축). |
| 과금 폭증 후보 | ① 야간 배치 분류(뉴스 키워드×30건 + 언론 + EIASS + DART) ② 업무보고 요약(조회 시 누락분 전부 병렬 생성) ③ 스크래퍼 카탈로그 분석(오퍼레이션 N개 × Sonnet) ④ RAG 브리핑(Sonnet 5, thinking 포함 최대 10k 출력) ⑤ Opus 경로 2곳. **실측 전이라 순서는 추정.** |
| 설계 골자 | 단일 게이트웨이 `lib/ai/claude-client.ts` 로 21곳 통합 → `ai_usage_log` 적재 → 단가표(DB) 기반 비용 산출 → 관리 화면(대시보드·기능별·예산/경고·단가·청구 대조·설정) → Admin API(Usage/Cost)로 실제 청구 대조. |
| 단계 | P0 계측(선행 필수) → P1 화면 → P2 예산·경고·예측 → P3 청구 대조(**법인 조직 계정 전환 후**, 그 전엔 CSV 수동 대조) → P4 절감 레버(캐싱·Batch·모델 오버라이드) → P5 리포트·이상징후. |
| 확정 결정(09-03) | Console 은 **개인 계정·사비 부담**(런칭 후 법인카드·조직 계정 전환 예정). 예산 **USD 기준, 초기 월 $100**, 초과 시 **경고만**(차단·강등은 옵션). **기능별 적용 모델을 화면에서 개별 변경**(§3.6)과 **모델별 평균 호출 단가 입력/출력 분리 표시**(§3.7)를 P1 에 포함. |
| 마이그레이션 | **215부터**(214는 role 일원화 계획이 예약, 213은 로컬 `view_all_template` / 원격 `regulatory_filings` 로 이미 갈라져 있음 → 착수 시 `git fetch` 후 원격 전 브랜치 재확인). |

---

## 1. 전수조사 결과 — Claude API 호출 지점 인벤토리

조사 방법: 루트 전역에서 `anthropic|@anthropic-ai|claude-*|api.anthropic.com|ANTHROPIC_API_KEY` 를 grep(`node_modules`·`.next`·venv·`data/`·스캔 파일 제외), 매치 파일 39개 중 문서·스크립트·인프라를 제외한 실제 호출 코드 19개 파일을 함수 단위로 확인하고 호출자(API 라우트·배치)까지 역추적했다.

### 1.1 호출 지점 표

기능 키(feature_key)는 §4 계측 스키마에서 그대로 쓴다. 비용 등급은 모델×토큰 규모 기준 정성 평가(실측 전).

| # | 기능 키 | 파일 (`frontend/`) | 모델 | max_tokens | 입력 유형 | 트리거 | 볼륨 특성 | 등급 |
|---|---|---|---|---|---|---|---|---|
| **전자결재** ||||||||
| 1 | `approval.doc_summary` | `lib/approval/summarize.ts` | Haiku 4.5 | 700 | 텍스트(필드+전례 통계) | **상신 시 자동 1회**(비차단, `lib/approval/docs.ts:571`) | 상신 문서 수만큼 | 하 |
| 2 | `approval.precheck` | `lib/approval/precheck-llm.ts` | Haiku 4.5 | 900 | 텍스트(문서+유사 문서) | 수동 "AI 검토" 버튼 | 낮음 | 하 |
| 3 | `approval.analytics_ask` | `app/api/approval/analytics/ask/route.ts` | Haiku 4.5 | 600 | 텍스트(NLQ) | 수동 | 낮음 | 하 |
| 4 | `approval.metrics_suggest` | `app/api/approval/metrics/suggest/route.ts` | Haiku 4.5 | 800 | 텍스트 | 수동 | 낮음 | 하 |
| **업무보고** ||||||||
| 5 | `workplan.progress_summary` | `lib/ai/summarize.ts` | Haiku 4.5 | 200 | 텍스트(추진내역) | ① 통합 시 보고서마다 순차(`work-plan/merge.ts:192`) ② **워크스페이스 조회 시 summary 없는 보고서 전부 `Promise.all` 병렬 생성**(`work-plan/workspace.ts:727`) | 보고서 수 비례, 재생성 조건 확인 필요 | 중(횟수) |
| **문서·이미지 파싱 (비전)** ||||||||
| 6 | `receipt.parse` | `lib/finance/receipt-parser.ts` | Haiku 4.5 (`RECEIPT_PARSE_MODEL`) | 500 | JPEG 이미지(sharp 정규화) | 모바일 영수증 촬영(`apps/mobile/src/app/receipt.tsx`)·웹 업로드 | 직원 지출 건수 | 하 |
| 7 | `business_card.parse` | `lib/sales/business-card-parser.ts` | Haiku 4.5 (`BUSINESS_CARD_MODEL`) | 500 | 이미지 | 모바일 명함 촬영(`card.tsx`)·웹 | 낮음 | 하 |
| 8 | `business_certificate.parse` | `lib/ieps/business-certificate-llm.ts` | Haiku 4.5 기본 / **Opus 4.8 고품질**(`highQuality` 플래그) | 3000 | 이미지 또는 PDF document | 사업장 등록 시 업로드·재분석 버튼 | 낮음 | 하 / **상(Opus)** |
| 9 | `yearend.pdf_parse` | `lib/finance/yearend-pdf-parser.ts` | Haiku 4.5 (`YEAREND_PARSE_MODEL`) | 1024 | PDF document(간소화 자료) | 연말정산 시즌, 직원당 | 연 1회 집중 | 중 |
| 10 | `company.credential_parse` | `lib/company/credential-llm.ts` | Sonnet 5 (`CREDENTIAL_PARSE_MODEL`) | 1000 | 이미지/PDF | 회사 프로필 면허·인증 업로드 | 매우 낮음 | 중 |
| 11 | `company.finance_parse` | `lib/company/finance-llm.ts` | Sonnet 5 재무제표 / Haiku 신용등급 | 가변 | PDF | 회사 프로필 업로드 | 매우 낮음 | 중 |
| 12 | `contract.permit_review_parse` | `lib/contracts/permit-review-llm.ts` | Sonnet 5 (`PERMIT_REVIEW_MODEL`) | 4000 | PDF **앞 20페이지** | 계약 상세 > 검토결과서 업로드 | 계약 건수 | 중상 |
| **양식 분석 (HWPX/PDF → 구조)** ||||||||
| 13 | `bid.form_analyze` | `lib/bid/form-analyze.ts` | Sonnet 5 (`SCRAPER_ANALYZE_MODEL`) | 8000 | HWPX 아웃라인 텍스트 | 입찰 패키지 양식 등록·재분석 | 낮음 | 중 |
| 14 | `deliverable.template_analyze` | `lib/deliverable/template-analyze.ts` | Sonnet 5 | 8000 | HWPX 텍스트 | 착수계·준공계 양식 등록 | 낮음 | 중 |
| 15 | `deliverable.template_scan` | `lib/deliverable/template-scan.ts` | Sonnet 5 / **Opus 5**(고품질) | **12000** | PDF document(스캔 양식) | 스캔 양식 등록 | 낮음 | **상** |
| 16 | `agreement.analyze` | `lib/agreement/analyze.ts` | Sonnet 5 | 8000(overlay) / **16000**(hwpx) | HWPX 텍스트 | 계약서 양식 등록 | 낮음 | 중상 |
| **영업 인텔·RAG** ||||||||
| 17 | `intel.news_classify` | `lib/intel/news-classifier.ts` | Haiku 4.5 | 500 | 텍스트(제목·요약+업종+**피드백 블록**) | **야간 배치 03시**(`collect-news.ts:93`, 키워드당 기본 30건) + 언론 보도(`collect-press.ts:148`) | **일 수백 건** 가능 — 키워드 수 × 30 | 중(횟수) |
| 18 | `intel.eiass_classify` | `lib/intel/eiass-classifier.ts` | Haiku 4.5 | 450 | 텍스트 | 야간 배치(`collect-eiass.ts:162`, 키워드 1차 필터 통과분) | 일 수십 건 | 하 |
| 19 | `intel.dart_supply_classify` | `lib/intel/dart-supply-classifier.ts` | Haiku 4.5 | 500 | 텍스트(공시 발췌 2,200자) | 야간 배치(`collect.ts:190`, 기본 상한 30건) | ≤30/일 | 하 |
| 20 | `intel.rag_briefing` | `lib/intel/rag-queries.ts` (`callClaude`) | **Sonnet 5** (`INTEL_RAG_MODEL`) | **10000** | 텍스트(검색 히트 컨텍스트) | 수동 브리핑 생성 + 추가 분석(refine) | 낮음이나 단건 비용 큼 | **상** |
| **스크래퍼 소스 분석** ||||||||
| 21 | `scraper.analyze_source` | `lib/scraper/analyze.ts` | Sonnet 5 | 6000 / **24000** / 8000 / 16000 | 텍스트(API 가이드 원문) | 관리자 "소스 분석" 수동 | 카탈로그 오퍼레이션 **N개 × 호출**(4개 병렬, 실패 시 전체 문서로 재시도) → 1회 클릭에 수십 호출 | **상** |

보조 지점: `frontend/scripts/intel-batch.ts` 는 자체 호출 없이 #17~#19 를 실행하는 ECS RunTask 엔트리(EventBridge `cron(0 18 * * ? *)` = KST 03:00). `components/sales/intel/RagBoard.tsx` 의 매치는 표시 문구.

### 1.2 인프라·키 주입

- `ANTHROPIC_API_KEY` 는 Secrets Manager `mcm-ieps-staging/app` → **next 태스크 정의에만** 주입(`infra/aws/ecs.tf:165`). intel-batch 도 next 이미지·태스크 env 를 재사용한다. backend/worker/converter 에는 키 없음.
- 단일 키 사용 → Console 에서 기능별 분리가 불가능하다. (§3.4 참고: 워크스페이스/키 분리는 선택 사항이고, 앱 내부 계측이 주경로)

### 1.3 조사에서 드러난 문제점

1. **usage 미캡처**: 21곳 모두 `data.content` 만 읽고 `data.usage` 를 버린다. 호출당 토큰·비용을 알 수 없다.
2. **로그 없음**: 성공/실패/타임아웃/잘림(`stop_reason=max_tokens`)이 `console.warn` 으로만 남는다.
3. **두 갈래 호출 코드**: `anthropicChatJson`(JSON 전용, text 전용) 과 개별 fetch(이미지·document 블록 필요). 게이트웨이 통합 시 두 시그니처를 모두 수용해야 한다.
4. **Sonnet 5 thinking 과금**: Sonnet 5 는 `thinking` 을 생략하면 adaptive thinking 이 켜진다. thinking 토큰은 출력 단가로 과금되며 `max_tokens` 에 합산된다(rag-queries.ts 주석 310행이 이미 인지). 브리핑·양식 분석의 실제 출력 토큰이 체감보다 클 가능성이 크다.
5. **모델 지정이 env var 6종에 흩어짐**(`RECEIPT_PARSE_MODEL`, `BUSINESS_CARD_MODEL`, `BUSINESS_CERT_MODEL(_HIGH)`, `YEAREND_PARSE_MODEL`, `CREDENTIAL_PARSE_MODEL`, `FINANCE_PARSE_MODEL`, `PERMIT_REVIEW_MODEL`, `SCRAPER_ANALYZE_MODEL`, `INTEL_RAG_MODEL`) → 태스크 정의 재등록 없이는 바꿀 수 없다.
6. **Haiku 모델 ID 가 날짜 접미사형**(`claude-haiku-4-5-20251001`). 동작에는 문제없으나 단가표 매핑 시 접미사 정규화가 필요하다.
7. **프롬프트 캐싱·Batch API 미사용**: 분류기 3종은 system 프롬프트가 고정이라 캐싱 대상이고, 야간 배치는 Batch API(50% 할인) 대상이다.

### 1.4 참고 단가 (2026-06 기준, USD / 1M 토큰)

| 모델 | 입력 | 출력 | 비고 |
|---|---|---|---|
| Haiku 4.5 | 1.00 | 5.00 | 200K 컨텍스트 |
| Sonnet 5 | 2.00 | 10.00 | thinking 기본 활성 |
| Opus 4.8 / Opus 5 | 5.00 | 25.00 | |
| 캐시 쓰기 / 읽기 | 입력 ×1.25 / ×0.1 | | 모델별 최소 캐시 길이 확인 필요 |

이미지 토큰 ≈ 가로×세로 / 750 (1000×1300 JPEG ≈ 1,700 토큰). PDF document 는 페이지당 텍스트+이미지 합산 대략 1,500~3,000 토큰.

**호출당 추정 비용 예시**(실측 전 개략치, 화면 구현 후 실값으로 대체):

| 기능 | 가정 | 추정 |
|---|---|---|
| 영수증·명함 파싱 | Haiku, 입력 2.2k(이미지 1.7k+프롬프트), 출력 0.3k | ≈ $0.004 |
| 결재 문서 요약 | Haiku, 입력 2k, 출력 0.5k | ≈ $0.005 |
| 뉴스 분류 1건 | Haiku, 입력 1.5k, 출력 0.3k | ≈ $0.003 → 일 300건이면 **월 $27** |
| RAG 브리핑 1회 | Sonnet 5, 입력 15k, 출력(thinking 포함) 6k | ≈ $0.09 |
| 검토결과서 20p | Sonnet 5, 입력 40k, 출력 2k | ≈ $0.10 |
| 스캔 양식(Opus 5) | 입력 20k, 출력 10k | ≈ $0.35 |
| 사업자등록증 고품질(Opus 4.8) | 입력 3k, 출력 2k | ≈ $0.065 |
| 스크래퍼 카탈로그 40 오퍼레이션 | Sonnet 5, 호출당 입력 20k·출력 2k × 40 | ≈ **$2.4 / 클릭** |

---

## 2. 목표 / 비목표

**목표**
- 모든 Claude 호출을 한 경로로 보내고, 호출 1건 = 로그 1행(토큰·비용·상태·소요시간·기능·사용자·대상)을 남긴다.
- 관리자 화면에서 기능별 호출 수·평균 비용·월 예상·월별 추이·예산·경고를 본다.
- 예산 초과 전에 알린다(푸시·메일·홈 알림벨). 필요 시 비필수 기능을 자동 차단/강등한다.
- Console 실제 청구와 앱 추정치를 일 단위로 대조한다.

**비목표(이번 범위 밖)**
- 개별 프롬프트 원문·응답 원문 저장(영수증·명함·연말정산 등 개인정보 포함 → 저장 금지, 메타만).
- 사용자 대면 기능의 UX 변경. 게이트웨이 통합은 동작 동일성을 유지하는 thin wrapper 로 시작한다.
- Voyage 임베딩·CLOVA OCR·솔라피 등 타 유료 API — 스키마에 `provider` 컬럼만 두고 후속(P5)으로.

---

## 3. 아키텍처

### 3.1 단일 게이트웨이 `lib/ai/claude-client.ts`

```ts
export interface ClaudeCallOpts {
  feature: FeatureKey;            // §4.1 레지스트리 키 (필수)
  model?: string;                 // 미지정 시 기능 기본값(설정 DB → env → 코드 기본) 순
  system?: string;
  messages: MessageParam[];       // text / image / document 블록 그대로
  maxTokens: number;
  timeoutMs?: number;
  thinking?: "adaptive" | "off";  // Sonnet 5 기본 adaptive, 분류기는 off 권장
  cacheSystem?: boolean;          // system 에 cache_control 부착
  subject?: { type: string; id: string }; // 대상 엔티티(문서·영수증·계약…)
  userId?: string | null;
}
export async function callClaude(opts): Promise<{ text: string; raw: MessagesResponse; usage: Usage; costUsd: number; requestId: string | null }>
export async function callClaudeJson<T>(opts): Promise<T>  // 기존 anthropicChatJson 호환
```

- 기존 `anthropicChatJson` 은 `callClaudeJson` 의 별칭으로 남겨 호출부 diff 를 최소화한다. 개별 fetch 12곳은 body 를 `messages` 로 그대로 넘기는 형태로 치환한다.
- 호출 후 **fire-and-forget 로그 적재**(`void logUsage(...)`): 응답 헤더 `request-id`, `usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}`, `stop_reason`, HTTP 상태, 소요 ms. 로그 실패는 본 호출에 영향을 주지 않는다(`console.warn`).
- 예외·타임아웃·`refusal`·`max_tokens` 잘림도 `status` 로 기록한다(실패도 입력 토큰은 과금될 수 있으므로 별도 표기).
- **예산 가드**(P2): 호출 전 `budgetGate(feature)` → 정책이 `block` 이면 `LlmError("llm_budget_exceeded")` 를 던지고 호출부의 기존 폴백(수동 입력·원문 truncate)이 작동한다.
- SDK 도입은 하지 않는다(저장소 규칙: 새 라이브러리 임의 도입 금지, 기존 fetch 관례 유지). 후속에 `@anthropic-ai/sdk` 로 바꾸더라도 게이트웨이 한 곳만 수정하면 된다.

### 3.2 비용 산출

- 단가표는 코드 상수가 아니라 DB `ai_model_prices` (model_family, input, cache_write, cache_read, output, effective_from). 관리 화면 단가 탭에서 수정.
- 모델 ID 정규화: `claude-haiku-4-5-20251001` → `claude-haiku-4-5` (날짜 접미사 제거) 로 단가 매핑.
- `cost_usd = (in − cache_read − cache_create)×p_in + cache_create×p_cw + cache_read×p_cr + out×p_out` (usage 필드 정의에 따라 `input_tokens` 가 캐시 제외 값인지 확인 후 확정).
- 표시 통화: USD 원본 + KRW 환산(환율은 설정값, 기본 수동 입력).

### 3.3 예측 (월 예상 과금)

- 요구: **당일 전후 3일(7일 창) 일평균 × 당월 일수**.
- 보완: `당월 누계 실적 + 잔여일 × 7일 창 일평균` 도 함께 표시(둘 중 후자를 기본 "월 예상"으로, 전자는 "현재 속도 기준"으로 병기).
- 요일 효과(주말 배치만 돎)·시즌 효과(연말정산)는 P5 에서 기능별 가중으로 확장.

### 3.4 실제 청구 대조 (Admin API)

- 엔드포인트: `GET /v1/organizations/usage_report/messages` (토큰, `bucket_width=1d`, `group_by[]=model`) 와 `GET /v1/organizations/cost_report` (USD 센트, 일 단위).
- **Admin API 키(`sk-ant-admin…`) 필요 — Console 조직 계정에서만 발급**. 현재는 **개인 계정**이라 사용 불가 → P3 는 런칭 후 법인 조직 계정으로 전환한 뒤 활성화한다. 데이터 지연 약 5분, 폴링 분당 1회 이하.
- **전환 전 대체안(P1 에 포함)**: Console Cost/Usage 페이지에서 내려받은 CSV 를 탭 ⑤ 에 수동 업로드 → 같은 `ai_usage_billing_daily` 에 적재해 일별 대조. 업로드 파서만 다르고 화면·테이블은 P3 와 공유하므로 전환 시 버릴 코드가 없다.
- **법인 전환 체크리스트**: 조직 생성 → 워크스페이스(운영/배치) → 새 일반 키 발급 후 Secrets Manager `ANTHROPIC_API_KEY` 교체·태스크 정의 재등록 → Admin 키를 별도 시크릿 `ANTHROPIC_ADMIN_API_KEY` 로 추가 → 전환일 전후 로그는 `meta.account`(personal/corp)로 구분해 개인 정산분과 법인 비용을 분리 집계.
- 일 1회 배치(intel-batch 와 같은 EventBridge→RunTask 패턴, 또는 기존 5분 틱 `app/api/internal/*-tick` 에 "하루 1회" 게이트)로 전일분을 `ai_usage_billing_daily` 에 적재 → 화면에서 "앱 추정 vs 실제" 차이율 표시. 차이가 크면 단가표·토큰 계산 방식 점검 신호.
- 선택: 워크스페이스/키를 "배치용"·"대화형" 2개로 분리하면 Console 에서도 대분류가 가능하다. 앱 내부 계측이 주경로이므로 필수는 아니다.

### 3.5 예산·경고

- `ai_budgets`: scope(`org` 전체 / `feature:<key>` / `model:<id>`), `monthly_limit_usd`, `warn_pcts`(기본 50/80/100), `action`(`notify` | `block_noncritical` | `block_all`), 수신자(사용자 ID 목록), 활성 여부.
- 평가 시점: ① 게이트웨이가 로그를 남길 때 당월 누계를 갱신하며 임계 통과 검사 ② 일 1회 배치에서 예측치 기반 "이 속도면 N일 뒤 초과" 사전 경고.
- 알림 채널: 기존 `sendPush`(`lib/notify/push-expo.ts`), `sendNotifyEmail`(`email-ses.ts`), 홈 AlertBell(운영 알림 테이블). 같은 임계는 월 1회만 발송(`ai_budget_alerts` 이력으로 중복 방지).
- 기능 중요도: `critical`(영수증·명함·결재 요약 등 사용자 대면) / `noncritical`(야간 분류·브리핑·소스 분석). `block_noncritical` 은 후자만 차단한다.

### 3.6 기능별 모델 오버라이드 (P1, 09-03 추가 요구)

관리 화면에서 **기능마다 적용 모델을 개별 변경**하고 즉시 반영한다(태스크 정의 재등록 불필요).

- **해석 우선순위**: `ai_settings.feature_model_overrides[feature_key]` (DB) → 기존 env var(`RECEIPT_PARSE_MODEL` 등, 과도기 호환) → `AI_FEATURES[key].defaultModel`(코드). 게이트웨이가 호출 시 조회하며 30초 메모리 캐시로 DB 부하를 막는다.
- **슬롯 분리**: 고품질 경로가 따로 있는 기능은 슬롯을 나눈다 — `business_certificate.parse`(기본) / `business_certificate.parse:high`(재분석), `deliverable.template_scan` / `:high`, `company.finance_parse:statement` / `:credit`. 표에서는 한 기능 행 아래 슬롯 행으로 펼친다.
- **선택 가능 모델 = `ai_model_prices` 에 단가가 등록된 모델만**. 단가 없는 모델을 고르면 비용 산출이 깨지므로 목록에서 제외한다(새 모델은 단가표에 먼저 등록).
- **호환성 경고**: 비전 입력 기능(#6~12, #15)에 이미지·PDF 미지원 모델 선택 시 차단. Haiku 4.5 는 200K 컨텍스트라 검토결과서 20p·스크래퍼 24k 출력 같은 대형 입력 기능에는 경고. Fable 계열은 forced `tool_choice` 불가·단가 상위 경고. 모델 ID 는 날짜 접미사 없는 정규형(`claude-haiku-4-5`)으로 저장.
- **변경 전 what-if**: 셀렉트에서 모델을 고르면 저장 전에 "최근 30일 이 기능의 토큰 × 새 단가 = 예상 월 비용(현재 대비 ±)" 을 인라인으로 보여준다(§7-8 시뮬레이터의 최소 버전).
- **감사**: 변경자·시각·이전/이후 모델을 `ai_settings_history` 에 남기고(기존 `lib/auth/audit.ts` 패턴), 로그의 `model` 컬럼은 실제 사용 모델을 그대로 기록하므로 변경 전후 비용 비교가 기능별 표에서 바로 보인다.
- **되돌리기**: 행마다 "기본값으로" 버튼(오버라이드 삭제). 전체 초기화는 `ai.usage.manage` 권한.
- env var 6종은 P1 배포 후 한 달 뒤 제거하고 DB 단일 소스로 정리한다.

### 3.7 모델별 평균 호출 단가 (P1, 09-03 추가 요구)

공시 단가(1M 토큰당)만으로는 "한 번 부르면 얼마인지" 감이 오지 않으므로, **실측 로그로 모델별 호출당 평균 단가를 입력/출력으로 나눠** 보여준다.

- 집계: 모델별 `calls`, 평균 입력 토큰, 평균 출력 토큰(thinking 포함), 캐시 적중 비율, **호출당 평균 입력 비용 / 출력 비용 / 합계**, 입력:출력 비용 비율, 최대 단건.
- 같은 분해를 **기능별 표 ②** 에도 컬럼으로 넣는다(입력비·출력비 분리). Sonnet 5 thinking 처럼 출력 쪽이 비용을 끌어올리는 기능이 한눈에 드러난다.
- 기간 필터(7일/30일/당월)를 공유하고, 값이 5건 미만이면 "표본 부족" 표기.

### 3.8 이상 징후 감지 (P5)

- 시간당 호출 수 또는 비용이 직전 7일 동시간 평균의 3배 초과.
- 단건 비용 상한(기본 $1) 초과 호출.
- 기능별 실패율 20% 초과(키 만료·429·모델 폐기 조기 감지).
- 같은 대상(subject) 에 24시간 내 3회 이상 호출(중복·재시도 루프).

---

## 4. 데이터 모델 (마이그레이션 215~)

### 4.1 기능 레지스트리 `lib/ai/features.ts` (코드)

```ts
export const AI_FEATURES = {
  "approval.doc_summary":   { label: "결재 문서 AI 요약", group: "전자결재", critical: true,  defaultModel: "claude-haiku-4-5" },
  "workplan.progress_summary": { label: "업무보고 추진내역 요약", group: "업무보고", critical: true, defaultModel: "claude-haiku-4-5" },
  "receipt.parse":          { label: "영수증 파싱", group: "문서 파싱", critical: true,  defaultModel: "claude-haiku-4-5" },
  "intel.news_classify":    { label: "뉴스 발주신호 분류", group: "영업 인텔", critical: false, defaultModel: "claude-haiku-4-5" },
  "intel.rag_briefing":     { label: "AI 브리핑", group: "영업 인텔", critical: false, defaultModel: "claude-sonnet-5" },
  // … §1.1 의 21개 전부
} as const;
```

### 4.2 테이블

| 파일 | 테이블 | 핵심 컬럼 |
|---|---|---|
| `215_ai_usage_log.sql` | `ai_usage_log` | `id`, `called_at`, `provider`(기본 anthropic), `feature_key`, `model`, `model_family`, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `cost_usd numeric(12,6)`, `latency_ms`, `status`(ok/error/timeout/refusal/truncated/budget_blocked), `http_status`, `stop_reason`, `request_id`, `user_id`, `subject_type`, `subject_id`, `env`(staging/prod), `meta jsonb`. 인덱스 `(called_at)`, `(feature_key, called_at)`, `(user_id, called_at)`. **프롬프트·응답 원문 컬럼 없음.** |
| 〃 | `ai_usage_daily`(뷰 → 규모 커지면 물리화) | `day`, `feature_key`, `model_family`, `calls`, `ok_calls`, `tokens_*`, `cost_usd` |
| `216_ai_model_prices.sql` | `ai_model_prices` | `model_family`, `input_per_mtok`, `cache_write_per_mtok`, `cache_read_per_mtok`, `output_per_mtok`, `effective_from`, `note`. §1.4 값 시드. |
| `217_ai_budgets.sql` | `ai_budgets` | `budget_id`, `scope`, `monthly_limit_usd`, `warn_pcts int[]`, `action`, `recipients text[]`, `enabled`. **시드: scope=`org`, limit=100, warn 50/80/100, action=`notify`** |
| 〃 | `ai_budget_alerts` | `alert_id`, `budget_id`, `ym`, `pct`, `sent_at`, `channels`, `amount_usd` |
| 〃 | `ai_settings`(kv) | `usd_krw_rate`, `forecast_window_days`(7), `single_call_alert_usd`(1), `feature_model_overrides jsonb`(`{"receipt.parse":"claude-haiku-4-5","business_certificate.parse:high":"claude-opus-4-8"}`), `feature_enabled jsonb`, `feature_thinking jsonb`, `account_kind`(personal/corp) |
| 〃 | `ai_settings_history` | `id`, `changed_at`, `changed_by`, `key`(예 `feature_model:receipt.parse`), `before`, `after` — 모델 변경 감사(§3.6) |
| `216` 에 포함 | `ai_model_prices` 확장 컬럼 | `display_name`, `supports_vision`(이미지·PDF), `context_tokens`, `selectable`(셀렉트 노출 여부), `deprecated_at` — 기능별 모델 셀렉트의 후보·호환성 판정 근거 |
| `218_ai_billing_daily.sql` (P3) | `ai_usage_billing_daily` | `day`, `model_family`, `workspace_id`, `uncached_input`, `cache_creation`, `cache_read`, `output`, `cost_usd`, `fetched_at` |
| 권한 시드(215 에 포함) | `permissions` + `permission_template_grants` | `ai.usage.view`(조회), `ai.usage.manage`(예산·단가·설정 변경, `is_dangerous=1`) → `tpl-system-admin` 에 grant(192 관례) |

로그 보존: 원본 행 13개월, 이후 `ai_usage_daily` 물리화 테이블만 유지(P5 배치).

---

## 5. 화면 설계 `/admin/ai-usage` (cdash · Modernize)

라우트 `frontend/app/(app)/admin/ai-usage/page.tsx` → `components/admin/ai-usage/AiUsageBoard.tsx`. 페이지 루트 `cdash cd-fields-white` + `CdPageHeader`, 차트는 ApexCharts, 날짜는 `CdDateInput`. 관리자 메뉴 등록은 `access-log` 항목이 등록된 곳과 동일 위치(구현 시 확인). 권한 가드 `requirePermission("ai.usage.view")`.

### 5.1 상단 KPI 6종
당월 누계 비용(USD·KRW) · 월 예상 비용(예산 대비 % 게이지) · 오늘 호출 수 · 오늘 비용 · 호출당 평균 비용(30일) · 실제 청구 대비 차이율(P3, 키 없으면 "미연동").

### 5.2 탭 구성

| 탭 | 내용 |
|---|---|
| **① 대시보드** | 월별 추이 12개월(막대=추정 비용, 선=실제 청구, 점선=예산) · 일별 30일 스택(기능 그룹별) · 기능별 도넛 · 모델별 스택 · 시간대 히트맵(배치 vs 업무시간 구분) |
| **② 기능별 현황** | 표: 기능 · 그룹 · **적용 모델(셀렉트, 즉시 변경 §3.6)** · 호출 수 · 성공률 · 평균 입력/출력 토큰 · **호출당 평균 입력비 / 출력비 / 합계** · 기간 합계 · 최대 단건 · 7일 스파크라인 · 마지막 호출 · "기본값으로". 고품질 슬롯은 하위 행. 기간 필터(오늘/7일/당월/사용자 지정). 행 클릭 → **호출 이력 드릴다운**(시각·사용자·대상 링크·모델·토큰·비용·상태·소요·request_id) + CSV 내보내기 |
| **③ 예산·알림** | 예산 카드(전체/기능별/모델별) · 임계 % · 초과 시 정책 · 수신자(조직도 선택) · 알림 이력 · "지금 속도면 N일 뒤 초과" 배너 |
| **④ 단가표·모델 단가** | 상단: 모델별 **공시 단가**(입력/캐시 쓰기/캐시 읽기/출력, 1M 토큰당, 적용일 관리) 편집 · 환율. 하단: 모델별 **실측 평균 호출 단가**(§3.7 — 호출 수·평균 입력/출력 토큰·캐시 적중률·**호출당 평균 입력비/출력비/합계**·입력:출력 비율·최대 단건) · 단가 변경 시 과거 재계산 버튼(선택) |
| **⑤ 청구 대조** | P1: Console CSV 수동 업로드 대조. P3: Cost API 자동. 일별 앱 추정 vs 실제, 모델별 토큰 대조, 차이 원인 힌트(캐시·thinking·미계측 호출) |
| **⑥ 설정** | 모델 변경 이력(§3.6 감사) · 기능별 킬 스위치 · 기능별 thinking on/off·effort · 예산 도달 시 자동 강등 규칙(Sonnet→Haiku) · Admin 키 연동 상태 · 계정 구분(personal/corp) |

### 5.3 부가
- 홈 관리자 위젯 "AI 비용" 미니 KPI(당월 누계·예산 %). 기존 홈 metrics 위젯 규격 재사용.
- 모바일 화면 없음(관리자 웹 전용).

---

## 6. 알림 규칙

| 트리거 | 조건 | 채널 | 빈도 |
|---|---|---|---|
| 예산 임계 | 당월 누계 ≥ limit × pct | 푸시+메일+AlertBell | 임계별 월 1회 |
| 예측 초과 | 월 예상 ≥ limit, 잔여일 ≥ 3 | AlertBell(+주 1회 메일) | 일 1회 |
| 단건 고비용 | cost_usd ≥ 설정값 | AlertBell | 건별 |
| 스파이크 | 시간당 비용 ≥ 7일 동시간 평균 ×3 | 푸시 | 시간당 1회 |
| 실패율 | 기능별 1시간 실패율 ≥ 20% (호출 ≥ 5) | 푸시 | 시간당 1회 |
| 월간 리포트 | 매월 1일 08시 | 메일(PDF 요약) | 월 1회 |

---

## 7. 추가 아이디어 (권장 순)

1. **프롬프트 캐싱**: 분류기 3종(#17~19)·결재 요약·브리핑 system 프롬프트에 `cache_control` → 반복 입력비 최대 90% 절감. 단 `feedbackBlock` 처럼 매 호출 바뀌는 텍스트는 캐시 지점 **뒤**로 옮겨야 한다. 게이트웨이 `cacheSystem` 옵션으로 일괄 적용, 캐시 적중률(`cache_read` 비율)을 화면 ①에 표시.
2. **Batch API**: 야간 배치 분류(#17~19)는 비실시간이라 **50% 할인** 대상. intel-batch 에서 요청을 모아 배치 제출 → 다음 틱에 결과 수거. 가장 큰 구조적 절감.
3. **thinking 제어**: Sonnet 5 호출 중 구조 추출류(#13~16, #21)는 `output_config.effort: "low"` 또는 thinking off 로 출력 토큰 절감을 실측 비교. 브리핑(#20)은 품질 영향이 있으니 A/B 후 결정.
4. **max_tokens 정합성 리포트**: 기능별 `max_tokens` 대비 실제 출력 비율·잘림(`truncated`) 비율을 보여 상한 조정 근거 제공.
5. **모델 강등 자동화**: 예산 80% 도달 시 noncritical 기능을 Haiku 로 자동 강등(설정 ⑥), 100% 도달 시 차단.
6. **사용자·부서별 비용**: `user_id` 로 상위 사용자·부서 순위(성과급·부서 예산 배부 근거). 조직도 데이터 재사용.
7. **대상 엔티티 링크**: 로그의 `subject` 로 "이 계약/문서/영수증에 AI 비용 얼마" 역조회, 중복 호출 감지.
8. **비용 시뮬레이터(what-if)**: 기능별 모델을 바꿨을 때 최근 30일 로그 기준 예상 비용 재계산.
9. **모델 수명 경고**: 사용 중 모델 ID 가 Models API(`GET /v1/models`) 목록에서 사라지거나 deprecated 표기되면 알림.
10. **타 프로바이더 확장**: `provider` 컬럼으로 Voyage(임베딩)·CLOVA(OCR)·솔라피(알림톡)·SES 를 같은 화면에 합산 → "외부 API 비용 총괄".
11. **스크래퍼 카탈로그 분석 상한**: 1회 클릭 최대 호출 수·예상 비용을 실행 전 확인 모달로 제시(#21 의 $2.4/클릭 급 폭증 방지).
12. **환경 태그**: `env` 컬럼으로 staging/로컬 개발 호출을 분리해 실운영 비용만 집계.

---

## 8. 단계별 실행 계획

| 단계 | 내용 | 산출물 | 비고 |
|---|---|---|---|
| **P0 계측** | 게이트웨이 `lib/ai/claude-client.ts` + `features.ts`, 마이그 215(로그·권한), **21개 지점 치환**, usage 캡처, request-id 저장 | 로그 적재 시작. 화면 없이도 SQL 로 즉시 조회 가능 | 동작 동일성 유지(thin wrapper). `tsc` 로 수정 파일 필터 검증 |
| **P1 화면** | `/admin/ai-usage` 대시보드·기능별 표·드릴다운·CSV, 단가표(216)+**모델별 실측 평균 호출 단가(§3.7)**, **기능별 모델 오버라이드(§3.6, 셀렉트·what-if·감사·되돌리기)**, KPI, 예측(7일 창), Console CSV 수동 대조(218 테이블 선반영), 관리자 메뉴·권한 | 요구사항 "호출 수·평균 과금·월 예상·월별 추이·기능별 모델 변경·모델별 단가" 충족 | 데이터가 최소 7일 쌓인 뒤 예측 표시 |
| **P2 예산·경고** | 마이그 217, 예산 CRUD, 게이트웨이 예산 가드, 알림 6종, 알림 이력 | 요구사항 "예산·경고" 충족 | 알림은 기존 push/email/AlertBell 재사용 |
| **P3 청구 대조** | Admin 키 시크릿, 일 배치, 탭 ⑤ 자동화 | 추정 vs 실제 | **법인 조직 계정 전환 후**. 그 전에는 P1 의 CSV 수동 업로드(마이그 218 테이블은 P1 에서 선반영) |
| **P4 절감 레버** | 캐싱·thinking/effort 제어·킬 스위치·자동 강등·스크래퍼 사전 확인 모달·env var 6종 제거 | 탭 ⑥ | 각 레버는 적용 전후 비용을 화면에서 비교 |
| **P5 리포트·확장** | Batch API 전환(야간 분류), 월간 리포트 메일, 이상징후, 로그 보존 배치, 타 프로바이더, 시뮬레이터 | | |

P0 는 다른 모든 단계의 전제라 **가장 먼저 배포**해 데이터를 모은다. P0+P1 이 1차 배포 단위.

### 8.1 P0 구현 현황 (2026-09-03 커밋 cd79e63 · 마이그 215~216 적용 · next:565 배포)

| 산출물 | 파일 | 비고 |
|---|---|---|
| 기능 레지스트리 | `frontend/lib/ai/features.ts` | 29개 키(21 기능 + 슬롯 8). `AiFeatureKey` 타입으로 누락을 컴파일 시점에 잡는다 |
| 게이트웨이 | `frontend/lib/ai/claude-client.ts` | `claudeMessages()` — usage 캡처·비용 산출·`request-id` 저장·fire-and-forget 로그. HTTP 오류는 `ok:false` 반환, 타임아웃은 로그 후 rethrow(기존 폴백 유지) |
| 단가 | `frontend/lib/ai/pricing.ts` | DB `ai_model_prices` 5분 캐시 → 상수 폴백. 모델 ID 날짜 접미사 정규화 |
| 로그 적재 | `frontend/lib/ai/usage-log.ts` | 원문 미저장. 적재 실패는 경고 1회 |
| JSON 헬퍼 | `frontend/lib/ai/llm-json.ts` | 게이트웨이 위에 재구현, `feature` 필수 |
| 호출부 치환 | 19개 파일(§1.1 전부) | 응답 파싱·폴백 로직은 그대로, 전송만 게이트웨이로. 직접 `fetch(api.anthropic.com)` 잔재 0 |
| 마이그레이션 | `infra/aws/215_ai_usage_log.sql`, `216_ai_model_prices.sql` | 로그 테이블·일별 뷰·권한 `ai.usage.view/manage`·단가 시드 6종 |
| 검증 | `tsc --noEmit`(수정 파일 필터 에러 0), `scripts/build-batch.mjs` 번들 OK | 실호출 검증은 스테이징 배포 후 영수증·요약 1건으로 `ai_usage_log` 적재 확인 |

P0 에서 미룬 것: 라우트별 `userId` 전달(현재 결재 분석·지표 제안·브리핑 3곳만), 예산 가드(P2).

### 8.2 P1 구현 현황 (2026-09-03 코드 완료 · 마이그 217 적용 · 스테이징 DB 로 로컬 실측 확인)

| 산출물 | 파일 | 비고 |
|---|---|---|
| 마이그레이션 | `infra/aws/217_ai_settings_budgets.sql` | `ai_settings`(kv)·`ai_budgets`(org $100·notify 시드)·`ai_budget_alerts`·뷰 `ai_model_prices_current` |
| 설정 | `frontend/lib/ai/settings.ts` | 기능별 모델 오버라이드·환율·예측 창. 30초 캐시. 변경은 `audit_log`(action `ai_settings_change`) |
| 모델 해석 | `claude-client.ts` `resolveModel` (async) | **오버라이드 → 호출부(env) → 코드 기본** |
| 집계 | `frontend/lib/ai/usage-stats.ts` | KPI(당월·예상 2종·오늘·30일·창)·기능별(입력비/출력비 분해·스파크)·모델별(캐시 적중률)·일별/월별·이력 |
| 단가 CRUD | `pricing.ts` `listCurrentModelPrices/upsertModelPrice` | 적용일별 이력 보존 |
| API | `app/api/admin/ai-usage/{summary,logs,prices,settings}` | `ai.usage.view` 조회 / `ai.usage.manage` 변경. logs 는 `format=csv` |
| 화면 | `components/admin/ai-usage/*` + `app/(app)/admin/ai-usage/page.tsx` | KPI 6 · 기간 프리셋/직접(`CdDateInput`) · 탭 4(대시보드 차트 4종 / 기능별 표+모델 셀렉트+what-if+되돌리기+이력 드로어 / 단가표 편집+실측 모델 단가 / 설정·변경 이력) |
| 메뉴 | `config/menu.ts` 사용자 관리 하위 "AI API 사용량" | |
| 검증 | 스테이징 DB 터널 + `frontend-dev-aws` 로 실측: 4탭 렌더, 모델 변경 what-if($0.0025→$0.0051)·저장·이력·되돌리기 동작, `ai_settings` 원복 확인 | |

P1 에서 미룬 것: Console CSV 수동 대조(탭 ⑤), 라우트별 `userId` 보강, 시간대 히트맵.

### 8.3 P2 구현 현황 (2026-09-03 코드 완료 · 마이그 218 적용 · 스테이징 DB 로 알림 E2E 확인)

| 산출물 | 파일 | 비고 |
|---|---|---|
| 마이그레이션 | `infra/aws/218_ai_budget_alerts_kind.sql` | `ai_budget_alerts.kind/day/message` + 종류별 유니크 dedup, `ai_budgets.label`. (CSV 대조 테이블은 후속 번호로) |
| 예산 모듈 | `frontend/lib/ai/budget.ts` | CRUD·상태(누계·N일 뒤 도달·예상)·`evaluateBudgets`(임계 월 1회, 초과 전망 일 1회)·`checkSingleCallAlert`(단건 고비용, 설정 `single_call_alert_usd` 기본 $1)·`budgetGate`(60초 캐시)·`afterCallBudgetCheck`(5분 스로틀) |
| 발송 | `dispatch()` | 홈 알림벨(`alerts` source=ai) + 푸시(`ai.budget` 이벤트 신설) + 메일(SES, `BID_NOTIFY_EMAIL_FROM` 필요). 수신자 비면 `tpl-system-admin` 배정자. dedup 은 INSERT 성공 시에만 발송 |
| 게이트웨이 | `claude-client.ts` | 호출 전 `budgetGate` → 차단 시 `budget_blocked` 로그 + throw(호출부 폴백). 성공 로그 후 `afterCallBudgetCheck`. `logAiUsage` 가 `log_id` 반환 |
| 틱 | `app/api/internal/ai-budget-tick` + `instrumentation.ts`(1시간) | KST 09시 이후 일 1회, "오늘 실행" 판정은 메모리 플래그(Aurora auto-pause 보호 규칙) |
| API | `app/api/admin/ai-usage/budgets` GET/PUT/DELETE | 한도 ≥ $0.01(numeric(12,2)), 저장 직후 1회 평가, 감사 기록 |
| 화면 | `components/admin/ai-usage/BudgetsTab.tsx` + Board 배너 | 예산 카드(게이지·임계 칩·정책·수신자·차단 중, **한 줄 3열·최대 3개** — 화면·API 모두 제한)·편집 모달(범위 전체/기능/모델, 수신자 `OrgPickerModal`)·알림 이력(카드 아래). KPI 아래 "N일 뒤 도달 / 초과" 배너. 설정 탭에 단건 고비용 임계 |
| 검증 | 스테이징 DB 로컬 실측 | 한도 $0.01·임계 10/20/50 로 저장 → 10%·20% 알림 2건(bell,push) 발송·이력 표시·배너 표시 확인 후 $100 원복·테스트 행 삭제. 틱 2회 호출 → 1회 실행·1회 done-today |

P2 에서 미룬 것: 스파이크·실패율 알림, 월간 리포트 메일(P5), 자동 강등(P4).

---

## 9. 결정 사항 (2026-09-03 확정)

1. **Console 계정**: 개인 계정, 런칭 전이라 사비 부담. 런칭 후 법인카드·조직 계정으로 전환 → Admin API 대조(P3)는 그때 활성화, 그 전엔 CSV 수동 대조(§3.4).
2. **예산**: USD 기준 관리(KRW 는 참고 병기). **초기 월 예산 $100**.
3. **초과 시 정책**: **경고만**(notify). 자동 차단·강등은 설정 ⑥ 에서 켜는 옵션.
4. **프롬프트 원문 미저장**: `meta` 에 입력 길이·블록 종류·페이지 수만 남긴다(개인정보 컴플라이언스 연계).
5. **마이그레이션 번호**: 215~218. 착수 시 `git fetch` 후 원격 전 브랜치 `infra/aws/` 를 재확인하고 확정한다.
6. **배치 실행 방식**(P3·P5): 인프라 변경 최소화를 위해 기존 5분 틱 라우트에 "하루 1회" 게이트를 두는 방식을 기본으로 한다.

---

## 10. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 로그 INSERT 가 호출 지연을 늘림 | fire-and-forget, 실패는 warn. 로그 1행은 수 ms |
| Aurora auto-pause 창에서 로그 유실 | 게이트웨이 메모리 큐 + 1회 재시도. 유실은 청구 대조(P3)에서 드러남 |
| 21곳 치환 중 회귀 | 응답 파싱 로직은 호출부에 그대로 두고 fetch 만 교체. 기능별 스모크(영수증·명함·요약·브리핑) 수동 확인 |
| 단가표 오류로 추정치 왜곡 | Cost API 대조로 검증. 단가 변경 이력 보관 |
| 예산 차단이 사용자 업무를 막음 | critical 기능은 `block_all` 에서만 차단, 기본 정책은 알림만 |
| 단일 API 키로 기능 분리 불가 | 앱 내부 feature_key 계측이 주경로. 필요 시 배치용 키 분리 |
