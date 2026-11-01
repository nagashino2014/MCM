# 용역 제안서 — 내용 편집 강화 · AI 수정 도입 계획

2026-11-01 · 2차 점검 반영 2026-11-01(§9) · 대상 `/sales/proposals` · 기준 커밋 `eee34443`(PR #81 통합, 스테이징 next:750, DB 324 적용)
관련 문서: [proposal-authoring.md](proposal-authoring.md) · [proposal-design-system.md](proposal-design-system.md) · 회사소개서 LLM 편집 [company-catalog-blueprint.md §7](company-catalog-blueprint.md) · [ai-api-usage-management-blueprint.md](ai-api-usage-management-blueprint.md)

> 이 문서는 계획서다. 본 구현은 사용자가 §8 쟁점을 정하고 P0 착수를 승인한 뒤 시작한다.

## 0. 요약

- **편집 강화**는 "지금 막히는 곳"부터 고친다. 발행이 `[작성 필요]` 때문에 실패해도 어디인지 알려 주지 않고, 찾기·바꾸기가 없으며, 목록 편집기 몇 곳은 '위로'만 있고 표는 행을 끝에만 붙인다. 이 네 가지를 P0 로 묶는다(DB 변경 없음).
- **AI 수정**은 회사소개서 P6 의 원칙(스키마 JSON 패치만 · `<data>` 안 지시 무시 · 숫자 검토 표시 · 원문 미저장 · 게이트웨이 사용량 기록 · 실패 시 규칙 대체)을 그대로 쓰고, 패치 형식만 제안서 블록에 맞게 새로 만든다. 제안서 블록은 이미 정해진 JSON 이라 회사소개서의 노드 트리 개요(`buildOutline`)가 필요 없다 — **미리보기 더블클릭 편집과 같은 경로 문법**(`items.2.text`)으로 op 를 정의한다.
- 채택은 기존 `change()` → `History` 한 단계로 들어가 **Ctrl+Z 한 번으로 되돌린다**. 제안은 미리보기에 임시로 얹어 보되, 넘침 판정은 **쪽 하나만 숨은 틀에 그려 재는 측정 함수**(§3-7)로 한다 — 모달 안에서 결과를 기다릴 수 있고 E8 넘침 정리·원고 점검도 같은 함수를 쓴다.
- `[작성 필요]` 칸과 참여인력 표는 **AI 범위에서 빼고 사람이 채운다**(§3-3). 글 칸 경로 허용 목록을 `lib/proposal/find.ts` 한 곳에 두고 찾기·바꾸기·미리보기 더블클릭·AI `set` 이 같이 쓴다.
- P0~P3 는 **마이그레이션이 필요 없다**(사용량은 `ai_usage_log`, 감사는 `audit_log`, RFP 요구사항·발주처 메모·쪽별 원고 해시는 문서 jsonb 의 선택 필드 — 단, `validate.ts` 가 허용 필드만 복사하므로 필드마다 검증을 같이 고친다). 양식 원고를 DB 로 관리하기로 정하면(P4, 쟁점 D3) 그때 325 를 쓴다.

## 1. 현재 구현 진단(코드 근거)

### 1-1. 편집기 구조

| 자리 | 지금 하는 일 |
|---|---|
| `components/sales/proposal/ProposalStudio.tsx` | 3단(장·쪽 목록 / iframe A4 미리보기 / 속성). 모든 편집은 `change(next, key)` → `History.push`(같은 key 연속 입력은 900ms 안에 한 단계로 묶음). 저장은 수동(`Ctrl+S`·[저장]), `beforeunload` 경고만 있고 자동 저장은 없다. |
| `Canvas`(같은 파일 58~135행) | 클릭 = 블록 선택, 더블클릭 = `data-edit="섹션\|블록\|경로"` 칸 위에 textarea 를 겹쳐 그 칸 하나만 고친다. 쪽 넘침은 `.pp-flow` 높이 > `.pp-body` 로 **문서 전체 쪽을 실측**한다(ResizeObserver). |
| 속성 패널 편집기 | `BulletsEditor`(Enter 새 줄·Tab 단계), `CardsEditor`·`DiagramEditor`·`FigureEditor`(위·아래·삭제), `TableEditor`(열 추가·삭제·폭·행 삭제·**끝에** 행 추가), `GanttEditor`(위로·삭제). |
| `lib/proposal/edit.ts` | 순수 함수: `makeBlock`·`conversions`/`convertBlock`(내용 유지 모양 바꾸기)·`setAtPath`/`getAtPath`·`updateSection`/`updateBlock`/`findBlock`·`cloneBlock`·`pushLastBlockToNextPage`·`History`. |
| `lib/proposal/validate.ts` | 저장 검증(블록 14종 스키마, 900블록·120쪽·30MB), 발행 검증(`{{변수}}`·`[작성 필요]`·필수 칸·도식 항목 수). 블록 검증 `blockOf` 는 내보내지 않는다. |
| `lib/proposal/store.ts` | `proposal_documents`(현재본 1행 + `revision`, 낙관적 잠금 409)·`proposal_editions`(발행 시점 원본·그림·HWPX 스냅샷). **저장마다 판을 남기지 않는다** — 이전 판은 발행본으로만 남는다. |
| `lib/proposal/templates.ts` | 새 문서 = 코드 원고(`content/*.ts`) 복사, `contentVersion: "<양식>-2.1"`. 쪽 id 는 `pageId`(G01…), 블록 id 는 `G01-b1…`로 원고 판이 바뀌어도 같은 자리를 가리킨다(`content/kit.ts` 42~50행). "저장된 원고는 원고를 고쳐도 자동으로 덮어쓰지 않는다." |
| API | `handlers.ts` 한 곳에서 `catalog.manage`(목록·초안·저장·다운로드)·`catalog.publish`(발행) 검사. |

### 1-2. 없거나 불편한 것

| # | 문제 | 근거 | 영향 |
|---|---|---|---|
| F1 | 발행이 `[작성 필요]`·남은 `{{변수}}` 로 막혀도 **위치를 알려 주지 않는다** | `validate.ts` 230·231행 — 문서 JSON 전체 문자열 검사 후 한 줄 오류 | 새 문서 기준 `[작성 필요]` — 일반 12곳(G29·G30)·발전 10곳(W23)·정기검사 6곳(I15·I22)·ESG 7곳(E03·E31), 2026-11-01 원고 실측. 34~36쪽을 눈으로 찾아야 한다 |
| F2 | 찾기·바꾸기 없음 | 문서 단위 문자열 연산이 `materializeDocument` 의 변수 치환뿐 | 이전 입찰의 발주처·사업장 표현, 기준일 같은 반복 표현을 쪽마다 고쳐야 한다 |
| F3 | 목록 편집기 이동이 반쪽 | `BulletsEditor`·`GanttEditor` 는 '위로'·삭제만(281·208행). `TableEditor` 는 행 이동 없음·행 추가는 끝에만·열 이동 없음(180~185행) | 긴 표·개조식 재배열이 삭제 후 다시 입력이 된다 |
| F4 | 미리보기에서 개조식 줄 추가·단계 변경 불가 | 겹친 입력창은 칸 하나(`items.N.text`)만 고치고 Ctrl+Enter 로 닫힌다(127~131행) | 지면을 보며 쓰다가 매번 오른쪽 패널로 가야 한다 |
| F5 | 블록 하나씩만 선택·복제·이동, 클립보드 없음 | `selBlock: string` 하나, 복제는 같은 쪽 바로 아래(526행) | 쪽 사이·문서 사이 재사용이 어렵다 |
| F6 | '다른 쪽으로 옮기기'는 대상 쪽 **맨 끝**에만 붙는다 | 533행 `blocks: [...x.blocks, b]` | 옮긴 뒤 다시 위로 여러 번 눌러야 한다 |
| F7 | 쪽 넘침 해소가 블록 통째 이동 한 번씩 | `pushLastBlockToNextPage` 는 블록 2개 이상일 때 마지막 블록 하나만(edit.ts 186행) | 긴 표·개조식 하나로 넘친 쪽은 해결할 수 없다(블록 나누기 없음) |
| F8 | 끌어 옮기기 없음 | 블록·쪽 모두 화살표 단추 | 쪽 순서 정리가 느리다 |
| F9 | 판 비교·양식 원고 갱신 경로 없음 | 저장마다 덮어씀, `contentVersion` 은 기록만 하고 쓰는 곳 없음 | 원고를 개선해도 기존 문서는 받을 길이 없다 |
| F10 | 표 셀 병합 없음 | `table.rows: string[][]` — 병합 모델 자체가 없다(types.ts) | 원본 제안서의 병합 표를 흉내 내려면 행을 쪼개야 한다 |
| F11 | 회사 수치 갱신 수단 없음 | 원고의 99개소·107건·36명은 2025-10 기준 글자(`content/general.ts` 99행) — 회사소개서 지표 사전(`lib/catalog/metrics.ts`)과 연결되지 않음 | 제출 전 갱신을 사람이 기억해야 한다 |
| F12 | 쪽 하나만 재는 넘침 측정이 없다 | 넘침은 `Canvas` 의 iframe 에 문서 전체를 그린 뒤 ResizeObserver 로 상태(`overflow`)에 올리는 방식뿐(ProposalStudio 69~86행). 결과를 Promise 로 기다릴 수 없다 | AI 제안·블록 나누기처럼 "적용해 보고 재는" 흐름을 만들 수 없다 |
| F13 | 긴 비동기 작업 중 편집 경합 보호가 없다 | `run()` 은 `operation` 깃발로 `change()` 를 막지만(355~365행) 발행·저장처럼 짧은 작업용. 30초 이상 걸리는 AI 응답을 기다리며 편집하면 제안의 원문과 현재 값이 어긋난다 | 채택 시 엉뚱한 칸을 덮어쓸 수 있다 |
| F14 | 검증기가 선택 필드를 버린다 | `validateProposalDocument` 는 아는 필드만 복사(validate.ts 188~206행, `variables` 는 3개 키 고정) | 쪽별 원고 해시·발주처 메모·RFP 를 더하려면 타입·검증·시험을 같이 고쳐야 한다(저장 시 조용히 사라지는 사고 방지) |
| F15 | 글 칸 경로 목록이 미리보기 코드에 흩어져 있다 | `ProposalPages.tsx` 의 `E("…")` 호출 15가지가 유일한 목록 | 찾기·바꾸기·AI 가 각자 목록을 두면 어긋난다 |

### 1-3. 회사소개서 P6 에서 재사용할 것과 새로 만들 것

| 대상 | 판단 | 이유 |
|---|---|---|
| 게이트웨이 `lib/ai/claude-client.ts` `claudeMessages`·`lib/ai/llm-json.ts` `anthropicChatJson` | **그대로 사용** | 모델 해석(관리 화면 재지정)·킬스위치·예산 차단·자동 강등·`ai_usage_log` 기록(형상 메타만)이 이미 적용된다 |
| 기능 레지스트리 `lib/ai/features.ts` | **키 추가** | 그룹 `"용역 제안서"` 신설(`AiFeatureGroup` 유니온에 추가) |
| `lib/catalog/ai/service.ts` `callJson`·`fallbackReason` | **패턴 복제**(파일 import 대신 같은 모양으로) | 회사소개서 렌더 데이터 import 가 딸려 오므로 제안서 서비스에 10줄로 옮겨 쓴다 |
| `lib/catalog/ai/prompts.ts` `DATA_RULE`·`userMessage`·`CONTENT_PRINCIPLES` 일부 | **import 재사용** | 지시/자료 분리와 최상급 금지는 제안서에도 같다. 문체 규칙은 제안서 원칙(개조식 명사형, '~함/~임' 아닌 원본 어미)으로 따로 쓴다 |
| `lib/catalog/ai/patch.ts` `findSuperlatives`·`looseNumbers`·`numbersIn` | **import 재사용** | 클라이언트 안전한 순수 함수. 제안서 검사 표시에 그대로 쓴다 |
| `lib/catalog/ai/template.ts` `ruleShorten` | **import 재사용** | AI 꺼짐·예산 초과 때 '줄이기'의 규칙 대체 |
| `buildOutline`·`validatePatch`·`applyChanges`(노드 트리·편집층) | **재사용 안 함** | 회사소개서는 렌더 트리 노드에 편집층을 얹는 구조, 제안서는 문서 JSON 자체가 편집 대상이다 |
| 검토 화면 `AiEditModal.tsx` | **흐름만 따름** | 지시 → 전·후 → 검토 칩 → 넘침 실측 → 부분 채택. 화면은 `CdModal` 로 제안서용을 새로 만든다(500줄짜리 회사소개서 모달은 트리·일러스트 전용) |
| 지표 사전 `lib/catalog/metrics.ts` | **회사 수치 원장으로 사용** | 제안서 AI 에 "쓸 수 있는 회사 수치 = 지표 값·정의·기준일"로 넘기고, F11 점검의 기준값으로 쓴다 |

## 2. 편집 강화 후보와 우선순위

우선순위 기준: ① 발행·제출을 막거나 실수를 부르는가 ② 매 입찰마다 반복되는가 ③ 구현 크기(조판기·검증까지 바꾸면 큼).

| 순위 | 항목 | 해결 | 단계 | 크기 |
|---|---|---|---|---|
| 1 | **E1 작성 필요·연결 표기 찾기**(F1) | 상태 영역의 `넘침 N쪽` 옆에 같은 모양의 `작성 필요 N` 칩 → 목록(쪽·블록·칸 미리보기) → 누르면 그 쪽으로 이동·블록 선택·칸 강조. 발행 오류도 첫 위치로 이동. `lib/proposal/find.ts` 의 **글 칸 경로 허용 목록**(`TEXT_PATHS`: 블록 종류별 경로 — text·title·label·note·items.N.text/title/body/label/value/unit·columns.N·rows.R.C·periods.N·tasks.N.group/label, 도식 spec 의 items.N.label/desc/a/b·center.label/desc·legend.N·axes.N, 인포그래픽 content.items.N.label/desc·center.label, 쪽의 title·summary·chapter·crumb, 문서의 title·client·projectName·variables.*)로 순회. 열거값(kind·style·variant·type·icon·group·tone·mark·color)과 id·pageId·dataUrl 은 목록에 없으므로 닿지 않는다. `ProposalPages` 의 `E("…")` 도 이 목록을 쓰도록 바꿔 단일 원천으로(F15) | P0 | 소 |
| 2 | **E2 찾기·바꾸기**(F2) | `Ctrl+H`·[찾기·바꾸기] 작은 창: 찾을 말·바꿀 말·대소문자 무시, 일치 목록(쪽·블록·칸), 하나씩/모두 바꾸기 = History 한 단계. `{{…}}` 표기를 가로지르는 바꾸기와 `**굵게**` 표식이 깨지는 바꾸기는 그 일치를 건너뛰고 알린다. `[작성 필요]` 는 같은 값으로 여러 곳을 한 번에 채우는 데 쓰므로 막지 않는다 | P0 | 소 |
| 3 | **E4 목록 편집기 보강**(F3) | 개조식·일정에 '아래로', 표에 행 위·아래·중간 삽입(행 머리 메뉴)·열 좌우 이동(열 폭 함께 이동) | P0 | 소 |
| 4 | **E5 미리보기 개조식 편집**(F4) | 겹친 입력창이 `items.N.text` 일 때: `Alt+Enter` 아래에 새 줄, `Tab`/`Shift+Tab` 단계, 빈 줄에서 `Backspace` 줄 삭제. 안내 문구 갱신 | P0 | 소 |
| 5 | **E3 끌어 옮기기**(F8) | 왼쪽 쪽 목록과 '이 쪽의 블록' 목록에 HTML5 끌기(부모 문서라 iframe 제약 없음). 미리보기 안 끌기는 하지 않는다. 키보드 `Alt+↑/↓`(선택 블록·쪽 이동) | P2 | 중 |
| 6 | **E6 여러 블록 선택·복사·붙여넣기**(F5) | `Shift/Ctrl+클릭` 다중 선택(미리보기·블록 목록), `Ctrl+C/X/V`·삭제·다른 쪽으로 옮기기. 클립보드는 시스템 클립보드에 표식 붙은 JSON 텍스트(다른 문서 탭에도 붙여넣기) — 붙일 때 `validate` 블록 검사·새 id | P2 | 중 |
| 7 | **E7 옮길 위치 고르기**(F6) | '다른 쪽으로 옮기기'에 장 묶음 목록 + 위치(맨 앞·맨 뒤) | P2 | 소 |
| 8 | **E8 넘침 정리·블록 나누기**(F7) | `splitBlock(b, at)` — 개조식·표(머리 행 반복)·카드·단계 흐름을 줄/행 경계에서 둘로. [넘침 모두 정리] = 넘친 쪽마다 실측하며 나누기·넘기기 반복(최대 N회, 결과 미리보기 후 한 단계로 적용) | P2 | 중 |
| 9 | **E12 회사 수치 지표 바인딩**(F11, D10=B 결정) | 회사소개서처럼 글 칸에 `{{metric:<지표 id>}}` 표기를 허용하고 미리보기·발행 때 지표 사전 값으로 바꾼다. 세부 설계는 아래 'E12 설계' | P2 | 중 |
| 10 | **E9 판 비교**(F9) | 발행본(`document_snapshot`) ↔ 현재, 쪽 단위 전·후 글 비교와 [이 쪽 되돌리기]. 저장마다 판 보관은 쟁점 D6 | P4 | 중 |
| 11 | **E10 양식 원고 갱신**(F9) | `contentVersion` 이 최신 원고보다 낮으면 "새 원고: N쪽 바뀜" → 쪽(`pageId`) 단위 비교 → [이 쪽 가져오기](사용자 수정 쪽은 경고). **자동으로 덮어쓰지 않는다**는 원칙 유지 | P4 | 중 |
| 12 | **E11 표 셀 병합**(F10) | `table.merges?: {r,c,rs,cs}[]` — 타입·검증·미리보기·HWPX(`cellSpan`)·편집기 모두 변경. 실측 함정(문단 여백 ×2 등) 재확인 필요 | P5 | 대 |
| — | **E13 쪽별 원고 해시**(F9 준비) | 새 문서를 만들 때 쪽마다 `sourceHash`(원고 쪽 JSON 의 sha-256 앞 16자)와 `contentVersion` 을 기록(타입 선택 필드 + 검증). 지금 넣어 두어야 P4 의 E10 에서 "사용자가 고친 쪽"을 판정할 수 있다(이전 판 원고가 코드에 남지 않으므로). 화면 변화 없음 | P0 | 소 |

### E12 설계 — 회사 수치 지표 바인딩(D10=B, 2026-11-01 결정)

- **표기**: 글 칸·큰 숫자 `value` 에 `{{metric:<id>}}`(회사소개서 `METRIC_TOKEN_RE` 와 같은 형식), 기준일은 `{{metric:<id>:asOf}}`(예: `2026.05.15.`). 지금의 연결 표기 정규식(`[A-Za-z][A-Za-z0-9_]*`)은 `:`·`.` 을 받지 않으므로 `materializeDocument(doc, metrics?)` 에 지표 치환을 따로 더한다.
- **값의 원천**: `lib/catalog/metrics.ts` 지표 사전(`value`·`unit`·`footnote`·`asOf`). 서버 전용이라 `GET /api/sales/proposals/metrics`(`catalog.manage`)로 미리보기에 넘기고, 발행은 서버(`store.publish`)가 다시 계산해 치환한다.
- **제출 판 고정**: 발행본 `document_snapshot` 에는 **치환된 글**과 사용한 지표 값 목록(`metricsUsed: {id, value, asOf}[]`)을 같이 넣는다 — 이후 원장이 바뀌어도 제출 판은 바뀌지 않는다. 지금 발행은 `materializeDocument` 를 거치지 않은 원본을 스냅샷하므로(store.ts publish) 이 부분을 같이 고친다.
- **발행 검증**: 없는 지표 id·값이 비어 있는 지표 → 발행 차단(남은 `{{…}}` 검사로 자연히 걸리게 치환 실패 시 표기를 남긴다). E1 목록에 '지표 없음' 항목으로 위치 표시.
- **원고 4종**: 지표 사전에 있는 회사 수치(최초허가·변경허가·누적 계약·업종·임직원·기술인력 등)를 표기로 바꾸고, `"※ 수치는 2025년 10월 제안서 기준"` 주석은 `{{metric:…:asOf}}` 기준 문구로 바꾼다. 지표 사전에 없는 것(예: 대행업 등록 '제44호')은 글자 그대로. 저장된 문서는 자동 변환하지 않는다(원고 비덮어쓰기 원칙) — 새 문서와 E10 쪽 가져오기로만 들어간다.
- **편집 화면**: 미리보기는 값으로 그리고, 속성 패널 글 칸에서는 표기 그대로 보이며 칸 아래에 "지표: 최초허가 완료 사업장 100개소(2026.05.15.)" 처럼 풀이를 보인다. 지표 넣기는 회사소개서 스튜디오의 `Ctrl+K` 지표 칩 패턴을 참고하되, P2 에서는 [지표 넣기] 목록 하나로 시작한다.
- **AI 연계**: P1 프롬프트의 숫자 규칙을 회사소개서와 같게 — 회사 수치는 `{{metric:id}}` 로만 쓴다. 숫자 검사(`looseNumbers`)가 표기 밖 숫자만 보게 되어 검토 칩이 정확해진다.
- **확인 필요(착수 시)**: 원고의 '최초허가 99개소'와 지표 사전의 현재 값(주석상 보정 후 100개소)이 다르다 — 바인딩하면 값이 바뀌므로 첫 반영 때 쪽별 전·후를 사용자에게 보인다.

## 3. AI 수정 설계

### 3-1. 사용자 흐름(단순함 우선)

화면에 새로 생기는 단추는 **하나**: 속성 패널 머리의 **[AI로 고치기]**(`Sparkles`). 고른 것이 블록이면 그 블록, 쪽 설정이면 그 쪽, 문서 설정이면 문서 단위(P3)를 대상으로 연다.

1. 작은 창(`CdModal`)에 대상 이름(예: "G07 · 개조식")과 **지시 칩**: [다듬기] [개조식으로] [줄이기] [늘리기] [발주처 맞춤] — 칩을 누르면 지시문이 채워지고, 아래 자유 지시 칸에서 고칠 수 있다. 문서 단위에서는 [RFP 반영](P3)이 추가된다.
2. [제안 받기] → 서버가 JSON op 를 받아 검증 → **바꿀 곳 목록**(칸마다 전·후, 바뀐 말 강조, 검토 칩: `숫자 확인`·`과장 표현`·`길어짐`·`작성 필요 유지`).
3. 제안이 오면 창 안에서 바로 **대상 쪽의 넘침을 잰다**(§3-7 `measurePageOverflow` — 제안을 얹은 쪽 하나를 숨은 틀에 그려 측정). 넘치면 "넘침 — [AI로 줄이기]"(copy_fit 0.85·0.7 로 1~2회 자동 축약, 회사소개서와 같음. 표 셀·카드 본문·개조식 줄도 축약 대상).
4. 창 아래 **[미리보기에서 보기]**: 제안을 임시로 얹은 문서를 가운데 미리보기에 그린다. 이때 편집기는 **'제안 보는 중' 상태**(`reviewing`)가 되어 클릭 선택·더블클릭·속성 패널 입력·저장·발행이 막히고, 상단에 "AI 제안 보는 중 — [채택] [거절]" 띠만 남는다. `Canvas` 에는 `reviewDoc ?? doc` 를 넘기고, `onOverflow` 결과는 제안용 상태에 따로 받아 발행 가드의 `overflow` 를 더럽히지 않는다.
5. [채택] = 고른 op 만 적용한 문서를 `change(next, "")`(key 없이 — 900ms 병합을 타지 않도록) 한 번 → 실행 취소 한 단계. 채택 직전에 각 op 의 `before` 를 현재 문서 값과 대조해 **어긋난 op 는 '원문이 바뀜'으로 표시하고 적용하지 않는다**(F13 — 응답을 기다리는 동안 편집한 경우). `remove` 로 지운 블록이 선택돼 있으면 선택을 쪽으로 올린다. 저장은 지금처럼 사용자가 한다.
6. 실패·키 없음·꺼짐·예산 초과: 규칙 대체안이 있는 지시(줄이기 = `ruleShorten`, 개조식으로 = `convertBlock`)는 규칙 결과를 같은 검토 화면에 "규칙으로 만든 제안 — 사유"와 함께 보이고, 없는 지시는 사유만 알린다. 창에는 [다시 받기](지시를 고쳐 재요청)를 둔다.
7. 요청 중에는 창 안에 진행 표시만 두고 편집기는 막지 않는다(기다리며 다른 쪽을 고칠 수 있다 — 5번의 원문 대조가 안전망). 요청은 `AbortController` 로 창을 닫을 때 끊는다.

### 3-2. op 형식(제안서 전용)

LLM 은 아래 JSON 하나만 돌려준다. 경로 문법은 미리보기 더블클릭(`data-edit`)과 같다.

```json
{
  "summary": "무엇을 바꿨는지 한 문장",
  "ops": [
    {"op": "set",    "block": "G07-b2", "path": "items.1.text", "value": "새 글"},
    {"op": "items",  "block": "G07-b2", "items": [{"level": 1, "text": "…"}, {"level": 2, "text": "…", "mark": "note"}]},
    {"op": "table",  "block": "G07-b4", "columns": ["구분", "내용"], "rows": [["…", "…"]]},
    {"op": "replace","block": "G07-b3", "with": {"kind": "cards", "columns": 3, "numbered": true, "items": [{"title": "…", "body": "…"}]}},
    {"op": "insert", "section": "G07", "after": "G07-b3", "block": {"kind": "callout", "variant": "note", "title": "참고", "text": "…"}},
    {"op": "remove", "block": "G07-b5"},
    {"op": "page",   "section": "G07", "title": "…", "summary": "…"}
  ],
  "notes": ["사람이 확인할 점"]
}
```

검증 규칙(`lib/proposal/ai/ops.ts`, 클라이언트·서버 공용 순수 함수):
- 대상 블록·쪽은 요청 범위 안에 있어야 한다(블록 단위면 그 블록만, 쪽 단위면 그 쪽의 블록만). 범위 밖 op 는 버리고 "버린 제안"에 적는다.
- `set` 의 `path` 는 `find.ts` 의 `TEXT_PATHS` 허용 목록에 있어야 한다(E1 과 같은 목록). 그중에서도 `kpis items.N.value|unit`·`gantt periods.N`·도식 `legend/axes` 는 AI 에게 막는다(수치·축은 사람이). `gantt tasks.N.start|end|marks`, 도식·그림의 크기·종류·색·좌표, 블록 `id` 는 허용 목록에 없으므로 자동으로 막힌다.
- `page` op 는 `title`·`summary` 만 바꾼다. `chapter`·`crumb` 는 목차·머리띠·간지에 묶여 있어 AI 가 바꾸지 않는다.
- AI 가 **만들 수 있는 블록**(`insert`·`replace`): 제목·본문·개조식·핵심 메시지·참고/포인트 상자·단계 띠·카드·단계 흐름·표. 큰 숫자·일정표·도식·인포그래픽·그림은 만들거나 지우지 않는다.
- **읽기 전용 칸**: `[작성 필요]` 가 든 칸, 참여인력 표(쪽 `crumb`/제목에 '참여인력'·'인력 이력'이 있는 쪽의 표), '제안 적용 예시' 쪽(G22~G24 처럼 `crumb` 에 '예시')은 AI 에게 `readonly: true` 로 넘기고, 그 칸을 바꾸는 op 는 버린다.
- 각 op 에 `before`(원문)를 붙여 돌려주며, 적용 직전 현재 값과 다르면 적용하지 않는다(§3-1 5번).
- 적용 결과 문서를 `validateProposalDocument` 로 다시 검사해 스키마를 보장한다. 이를 위해 `validate.ts` 의 `blockOf(raw, uniqueId)` 를 내보내고, 블록 하나 검사용 래퍼 `validateBlock(raw)`(id 중복 검사는 문서 단위에서) 를 둔다. 새 블록 id 는 서버가 `newId()` 로 만든다.
- 바꿈은 **칸 단위 변경 목록**(`ProposalChange { op, block, path, before, after, flags }`)으로 펼쳐 검토 화면에 보이고, 부분 채택은 op 단위로 한다. `insert`·`remove`·`replace` 는 `blockSummary()` 전·후로 보인다.

### 3-3. 사실·수치를 지어내지 않게 하는 가드

프롬프트 규칙(서버 전용 `lib/proposal/ai/prompts.ts`)과 **결정적 검사**를 같이 쓴다. 프롬프트만 믿지 않는다.

| 가드 | 프롬프트 | 결정적 검사(op 적용 후) |
|---|---|---|
| 회사 수치 | "회사 수치는 `<data>.ledger`(지표 사전 값·정의·기준일)와 기존 글에 있던 숫자만 쓴다. 모르면 `[작성 필요]`로 둔다" | `looseNumbers(after, carried)` — carried = 대상 범위 원문 숫자 ∪ 원장 값 ∪ 문서 변수·발주처·용역명 ∪ (P3) RFP 본문 숫자 ∪ 지시문 안 숫자. **제안서 허용 문형**(검토 칩을 붙이지 않음): `N단계`·`N.N`(항 번호)·`제N조/항/호`·`G|W|I|E\d\d`(쪽 참조)·`M\d+`·`ISO \d+`. 연도·금액·건수·비율·인원은 그대로 검토 칩 |
| `[작성 필요]` | "`[작성 필요]` 칸은 readonly 다. 새로 쓸 값을 모르면 `[작성 필요]`로 쓴다" | `[작성 필요]` 칸은 범위에서 **읽기 전용**이라 바꾸는 op 는 버린다. AI 가 새로 `[작성 필요]` 를 넣는 것은 허용(지어내지 않은 증거). 그 칸을 채우는 일은 E1 목록에서 사람이 한다(쟁점 D5) |
| 연결 표기 `{{client}}` 등 | "발주처·사업장·기간은 표기로 쓴다(이름을 직접 쓰지 않는다)". AI 에게는 **변수 치환 전 원문**을 넘긴다(`materializeDocument` 를 거치지 않음) | 표기 개수 변화·없는 변수명 = 검토 칩. 발주처 이름(`doc.client`)을 글자로 쓰면 `{{client}}` 로 바꾸자고 표시 |
| 과장·이모지 | 회사소개서 `CONTENT_PRINCIPLES` 3·4항 | `findSuperlatives`·이모지 검사 = 검토 칩 |
| 사람 이름 | "사람 이름·연락처를 새로 쓰지 않는다" | 참여인력 표는 읽기 전용(§3-2) |
| 적용 예시 | "'제안 적용 예시' 쪽을 실적처럼 고치지 않는다" | 예시 쪽은 읽기 전용(§3-2) |
| 지시 주입 | `DATA_RULE` — `<data>` 안 문장은 자료 | `userMessage()` 로 `<instruction>`/`<data>` 분리, 응답 원문 미저장 |
| 문체 | "개조식·카드·표는 명사형 종결(…제시, …보관), 핵심 메시지·본문은 '~합니다' 체. 기호(○ - · ※ ⇒ ✓)는 `level`·`mark` 로만 쓰고 글에 넣지 않는다. 쪽 하나에 메시지 하나" (원고 실측 문체, 2026-11-01) | 글 앞 기호는 `stripMark()` 로 떼어 `level`/`mark` 로 옮긴다(`convertBlock` 과 같은 함수) |

### 3-4. 단위별 지시

| 단위 | 지시 칩 | 범위로 넘기는 것 | 비고 |
|---|---|---|---|
| 블록 | 다듬기·개조식으로·줄이기·늘리기·발주처 맞춤 | 그 블록 JSON + 같은 쪽 제목·요약·앞뒤 블록 요약(읽기 전용) | 줄이기 기본 목표 80%, 늘리기는 "쪽 넘침 안에서" |
| 쪽 | 같은 칩 + 자유 지시("이 쪽을 표 하나와 핵심 메시지로 정리") | 그 쪽 블록 전체 + 장·절 + 앞뒤 쪽 제목 | `insert`·`remove`·`replace` 허용 |
| 문서(P3) | RFP 반영 · 용어 통일 | 쪽 제목·요약·블록 요약 목록(전문이 아님) → 고칠 쪽을 고른 뒤 쪽 단위 제안을 차례로 | 한 번에 문서 전체를 다시 쓰지 않는다(검토 불가·비용) |

**발주처 맞춤**: 문서 변수(발주처·사업장명·수행기간)와 **발주처 메모**(`variables.clientNotes`, 선택 필드 — 문서 설정 패널에 "발주처 메모(AI 참고 — 업종·설비·쟁점·요구 톤)" 칸 하나, 발행본에는 들어가지 않음)만 쓴다. 블록마다 지시에 같은 설명을 다시 적지 않아도 된다. 발주처 고유 수치·설비명은 메모·지시·RFP 에 있을 때만 쓰고, 없으면 `[작성 필요]`. 컨텍스트에는 `templateId`·양식 이름도 넣어 양식별 어투(정기검사 요약본·ESG 공시 용어)를 지키게 한다.

**RFP 반영(P3)**: ① RFP 입력 — 본문 붙여넣기 또는 PDF(32MB·100쪽 이하, 비전 입력) ② `proposal.rfp_extract` 가 요구사항 목록(번호·원문 인용·분류·배점 있으면 배점) 추출 → 사용자가 고친 뒤 확정, 문서 `rfp.requirements` 에 저장(원문 파일은 저장하지 않음, 쟁점 D4) ③ `proposal.rfp_coverage` 가 요구사항 ↔ 쪽 대조표(반영·부분·없음 + 근거 쪽) ④ '없음·부분' 행의 [이 쪽에 반영] → 쪽 단위 제안(같은 검토 화면). 대조표는 문서 설정 패널의 접히는 칸에 두고 `?` 도움말로 설명한다.

### 3-5. 템플릿 원고 개선 흐름(관리자)

- 일반 사용자가 쓰는 것은 **자기 문서의 AI 수정**뿐이다. 양식 원고 개선은 관리자 뒤로 둔다(`catalog.publish`).
- 1단계(P4a, DB 없음): 양식을 '원고 점검 모드'로 열면 [원고 점검] 이 쪽마다 문체·중복·기준일 지난 수치(원장과 다른 값)·과장 표현·`[작성 필요]` 남발을 표로 보여 주고, 쪽 단위 AI 개선 제안을 같은 검토 화면에서 받는다. 결과는 **편집 원본 JSON**으로 내려받아 개발 세션이 `content/*.ts` 에 반영한다(`test-proposal-content.mjs`·HWPX 쪽수 확인 포함).
- 2단계(P4b, 쟁점 D3 에서 B 를 고르면): `325_proposal_template_versions.sql` — 양식 원고판(양식 id·판 번호·문서 jsonb·게시자·게시일). 관리자가 앱에서 고친 원고를 **쪽 넘침 0·`validateProposalDocument` 통과·발행 검증(작성 필요 제외)** 일 때만 게시. 새 문서는 최신 게시판을 쓰고, 기존 문서는 E10 의 쪽 단위 가져오기로만 받는다.
- 쪽 넘침 연계: 넘침 판정은 지금처럼 미리보기 실측이 기준이다. 원고 점검·게시는 문서 전체를 그린 뒤 `overflow` 가 0 이어야 진행한다(HWPX 쪽수는 한글 실측으로 따로 확인 — proposal-authoring.md 검증 절차).

### 3-6. 모델·비용·권한·기록

| 기능 키(그룹 '용역 제안서') | 기본 모델 | 용도 | 1회 추정 비용 |
|---|---|---|---|
| `proposal.rewrite` | `claude-opus-5`(회사소개서 `catalog.section_write` 와 같음, 쟁점 D1) | 블록·쪽 수정, 원고 점검 개선 | 입력 3~6천·출력 1~3천 토큰 → 블록 약 $0.04, 쪽 약 $0.10 |
| `proposal.copy_fit` | `claude-haiku-4-5` | 넘침 줄이기(Sonnet 5 는 기본 생각 모드로 짧은 출력이 잘린 실측 — catalog §7-4) | $0.005 미만 |
| `proposal.rfp_extract` | `claude-opus-5`(vision) | RFP 요구사항 추출 | PDF 30쪽 기준 입력 약 4.5만 토큰 → $0.3 안팎 |
| `proposal.rfp_coverage` | `claude-opus-5` | 요구사항 ↔ 쪽 대조 | 쪽 요약 목록 2~3만 토큰 → $0.2 안팎 |

- 단가는 `lib/ai/pricing.ts` 의 2026-06 공시 값 기준 추정. 모델은 관리 화면(AI 사용량 관리)에서 기능별로 바꿀 수 있고, 예산·킬스위치도 그 화면 그대로다. 4개 모두 `critical: false`.
- 사용량: 게이트웨이가 `ai_usage_log` 에 기록(subject `{type: "proposal_document", id: "<문서 id>:<쪽 id>"}`), 프롬프트·응답 원문은 남기지 않는다.
- 권한: 제안 요청 = `catalog.manage`(편집 권한과 같음), 원고 게시 = `catalog.publish`(쟁점 D2).
- 감사: 채택 시 `audit_log` `proposal_ai_apply`(문서 id·기능·바꾼 칸 수·검토 칩 수, **글 내용 없음**) — 쟁점 D7.
- 요청 본문: 클라이언트가 범위의 블록 JSON 을 보낸다(저장 전 편집·아직 저장한 적 없는 새 문서도 대상 — 서버는 문서 존재를 확인하지 않고 subject 에 받은 id 만 적는다). 그림 블록 `dataUrl` 은 보내기 전에 지워 본문을 작게 둔다. 서버는 받은 범위를 `validateBlock` 으로 다시 검사하고 본문 한도는 2 MB(제안서 저장 한도 30 MB 와 별개 — 그림 없이 글만).
- 시간: 라우트 `maxDuration = 180`(회사소개서 `ai/edit` 와 같음), 스테이징 ALB `idle_timeout = 300`(main.tf 275행) 이라 150초 응답도 끊기지 않는다. 제안서 시스템 프롬프트는 길고 고정이라 `cacheSystem: true` 로 캐시해 입력 비용을 줄인다(게이트웨이 지원 확인).

### 3-7. 쪽 단위 넘침 측정(`lib/proposal/measure.ts`, P1)

- `measurePageOverflow(kit, doc, sectionId): Promise<{ over: boolean; px: number }>` — 해당 쪽만 `physicalPages` 로 구성해 `ProposalPages` 를 `renderToStaticMarkup` 으로 그리고, `frameDocument(kit, "pretendard", { extraCss: proposalFrameCss(pal) })` 숨은 iframe 에 넣어 `fonts.ready` 뒤 `.pp-flow` 높이와 `.pp-body` 높이를 비교한다. 판정식은 `Canvas` 의 넘침 검사(ProposalStudio 74~75행)와 같아야 하므로 그 비교식을 `measure.ts` 로 옮겨 둘 다 쓴다.
- 쓰는 곳: AI 제안 검토(§3-1 3번)·copy_fit 반복·E8 블록 나누기·넘침 모두 정리·P4 원고 점검. 한 번에 쪽 하나라 300ms 안팎.
- 여러 쪽을 재야 하면(E8 '넘침 모두 정리') 순차 실행, 상한 20쪽·30회. 측정 틀은 하나를 재사용한다.

## 4. 단계별 계획

공통: 각 단계는 별도 PR. 커밋 전 `npm run test:manual`·제안서 시험 3종·수정 파일 `tsc` 필터 0건, 화면 변경은 라이트/다크·1024px·키보드 확인 후 보고(UI Precision). 화면 단추·흐름이 바뀌는 커밋은 같은 커밋에서 매뉴얼을 고친다.

### P0 — 편집 기초(DB 없음, AI 없음)

| 범위 | E1 작성 필요·연결 표기 찾기 · E2 찾기·바꾸기 · E4 목록 편집기 보강 · E5 미리보기 개조식 편집 · E13 쪽별 원고 해시 |
|---|---|
| 변경 파일 | 신규 `lib/proposal/find.ts`(`TEXT_PATHS` 허용 목록·`walkText`·찾기·바꾸기·작성 필요 목록) · `lib/proposal/edit.ts`(`moveRow`·`insertRow`·`moveColumn`) · `lib/proposal/types.ts`(`ProposalSection.sourceHash?`) · `validate.ts`(`sourceHash` 16자 hex 검증) · `templates.ts`(생성 시 해시 기록 — 브라우저에서 만드니 `crypto.subtle` 대신 동기 FNV-1a 64비트 hex 로, 서버 시험과 같은 함수 `lib/proposal/hash.ts`) · `ProposalStudio.tsx`(상태 칩·찾기 창·편집기 단추·겹친 입력창 키·발행 오류 시 첫 위치로 이동) · `ProposalPages.tsx`(`E()` 를 `TEXT_PATHS` 로, 찾은 칸 강조 `data-hit`) · `proposal.css` |
| 시험 | 신규 `tests/proposal-edit.test.ts` + `scripts/test-proposal-edit.mjs`(esbuild 패턴 동일, package.json 에 등록하지 않는 기존 관례대로 `node scripts/…` 실행): `TEXT_PATHS` 가 `ProposalPages` 의 모든 `data-edit` 경로를 포함(정적 HTML 에서 경로를 모아 대조), 순회가 id·pageId·dataUrl·열거값에 닿지 않음, 바꾸기 후 `validateProposalDocument` 통과, `{{…}}`·`**` 가로지르는 일치는 건너뜀, 표 행·열 이동 시 폭·행 길이 보존, 원고 4종 작성 필요 위치 수 = 12·10·6·7, 새 문서 모든 쪽에 `sourceHash` 가 있고 저장 검증 뒤에도 남음 |
| 매뉴얼 | `articles/proposals.ts` edit 절에 [[작성 필요]]·[[찾기·바꾸기]]·개조식 단축키, `help-topics/proposals.ts` 한 줄, `changelog.ts` 한 줄, `reviewedAt` 갱신. 기사에 캡처(image 블록)는 없으므로 캡처 갱신은 없다 |
| 완료 기준 | 일반 원고를 열어 칩에서 작성 필요 12곳을 차례로 채우고 발행까지, 찾기·바꾸기 한 번에 실행 취소 한 단계, 라이트/다크·1024px·키보드(찾기 창 Tab 순서·Esc) 확인 |

**P0 구현 기록(2026-11-01)** — 브랜치 `claude/proposal-ai-editing-5cfd82`.
- `lib/proposal/find.ts`(글 칸 목록 `blockTextPaths`·`textFields`·`setField`·`fieldLabel`, `pendingItems`, `findMatches`·`replaceMatches`), `lib/proposal/hash.ts`(FNV-1a 64, 키 정렬 JSON — tsconfig 대상이 ES2020 미만이라 BigInt 리터럴 대신 생성자), `edit.ts`(`moveItem` 이동·`insertTableRow`·`moveTableColumn`·`bulletAction`).
- 계획과 다르게 한 것: `ProposalPages` 의 `E("…")` 는 그대로 두고, 미리보기 HTML 의 모든 `data-edit` 경로가 `textFields` 에 있는지를 시험(4개 양식)으로 대조해 단일 원천을 보장했다 — 렌더러를 고치지 않아 HWPX·미리보기 회귀 위험이 없다. 원고 지문은 저장 검증이 빈 단위(`unit: ""`)를 버려 모양이 달라지므로 `createProposalTemplate` 이 검증한 문서로 지문을 계산하고 그 문서를 돌려준다. `tasks.N.group`(일정표 구분)은 글 칸이다.
- 화면: 상태 옆 '작성 필요 N' 칩 → 목록(쪽·블록·칸 이름, 누르면 이동·칸 강조) · [찾기·바꾸기](Ctrl+H, Enter 다음·Shift+Enter 이전, 표식 가로지르기 건너뜀, 모두 바꾸기 = 실행 취소 한 단계) · 발행 시 남은 칸이 있으면 목록을 열고 첫 자리로 · 미리보기 개조식 Alt+Enter·Tab·Shift+Tab·빈 줄 Backspace · 표 행 위·아래·아래에 넣기, 열 좌우 이동(폭 함께) · 개조식·일정표 '아래로'. 미리보기 이동은 틀 안에서만 굴린다(기존 쪽 이동의 `scrollIntoView` 가 바깥 화면까지 굴려 상단 바를 가리던 것도 같이 고침). 도구 창을 닫으면 초점이 연 단추로 돌아간다.
- 검증: 시험 `test-proposal-edit` 13 + 원고 8 + API 16 + HWPX 11 + 메뉴 10 + 매뉴얼 9 = 67/67, 수정 파일 tsc 0건. 화면은 편집기 컴포넌트를 그대로 묶은 시험용 화면(인증·저장 API 만 메모리 대체)에서 1440×900·1024×768·다크·실제 키 입력(Tab·Esc·Ctrl+H)으로 확인했다. 실제 로그인·DB 통합과 배포는 하지 않았다.

### P1 — AI 블록·쪽 수정

| 범위 | 기능 키 2종(`proposal.rewrite`·`proposal.copy_fit`) · op 검증·가드 · 쪽 단위 넘침 측정(§3-7) · 제안 API · [AI로 고치기] 검토 창 · 미리보기에서 보기·채택·거절 · 넘침 시 자동 축약 · 규칙 대체 · 발주처 메모 |
|---|---|
| 변경 파일 | `lib/ai/features.ts`(그룹 `"용역 제안서"`·키 — 관리 화면은 `AI_FEATURES` 를 읽어 그룹을 그리므로 화면 수정 없음, 확인 2026-11-01) · 신규 `lib/proposal/ai/ops.ts`(op 검증·적용·변경 목록·가드·원문 대조, 공용) · 신규 `lib/proposal/measure.ts` · `lib/proposal/ai/prompts.ts`(서버) · `lib/proposal/ai/service.ts`(컨텍스트 묶음 = 범위 블록(읽기 전용 표시) + 원장 지표 + 변수·발주처 메모 + 양식, `callJson`, 규칙 대체) · `lib/proposal/validate.ts`(`blockOf` 내보내기·`validateBlock`·`variables.clientNotes` 2000자) · `lib/proposal/types.ts`(`clientNotes?`) · 신규 `app/api/sales/proposals/ai/edit/route.ts`(POST 제안, PUT 채택 감사) · `app/api/sales/proposals/ai/fit/route.ts` · 신규 `components/sales/proposal/ProposalAiModal.tsx`(`CdModal`, 지시 칩은 `cd-action` 반경 10px) · `ProposalStudio.tsx`(단추·`reviewDoc` 상태·`reviewing` 잠금·문서 설정의 발주처 메모 칸) · `lib/auth/audit.ts`(`proposal_ai_apply` — `audit_log.action` 에 DB CHECK 없음, TS 유니온만) |
| 시험 | `tests/proposal-ai.test.ts`: 범위 밖 op 버림 · 허용 목록 밖 경로(`kpis value`·`gantt start`·`chapter`) 버림 · 읽기 전용 칸(작성 필요·참여인력·예시 쪽) op 버림 · 새 블록 id 서버 생성 · 숫자 검토(원장·원문·지시문 숫자와 허용 문형은 통과, 새 연도·금액은 표시) · `before` 불일치 op 미적용 · `<data>` 안 지시문 주입 문서에서도 op 가 범위 안 · 적용 결과 `validateProposalDocument` 통과 · `clientNotes` 가 검증 뒤 남고 HWPX 본문에 들어가지 않음 · 규칙 대체(키 없음) 경로. API 는 `handlers.ts` 처럼 의존성 주입(가짜 LLM)으로 권한 403·본문 한도 413 확인. `measure.ts` 는 브라우저 전용이라 자동 시험 대신 로컬 실측 |
| 실측 | 로컬 일회용 PG + 실제 Anthropic 키(⚠ AWS 자격증명 끊고 — 메모리 local-test-aws-creds-leak) — 원고 4종에서 블록·쪽 시나리오 각 2건 + 발주처 메모를 쓴 '발주처 맞춤' 1건 + 응답 대기 중 편집 후 채택(원문 대조) 1건, 숫자 지어냄 0건·넘침 0 확인, 사용량 로그(토큰·비용·캐시 읽기) 기록 확인, 응답 시간 기록(쪽 단위 60초 넘으면 D1 재검토) |
| 매뉴얼 | 새 절 `ai`(AI로 고치기 흐름·검토 칩 뜻·숫자 원칙·작성 필요 칸은 사람이), 도움말 한 줄, changelog. 새 단추 이름 확정: [[AI로 고치기]] [[제안 받기]] [[미리보기에서 보기]] [[채택]] [[거절]] [[AI로 줄이기]] [[다시 받기]] |
| 완료 기준 | 블록 [줄이기]→미리보기에서 보기→채택→Ctrl+Z 한 번으로 원상태, 꺼진 상태에서 규칙 제안, 제안 보는 중 편집·발행 잠김 |

**P1 구현 기록(2026-11-01)** — 브랜치 `claude/proposal-ai-editing-5cfd82`.
- 서버·공용: `lib/proposal/ai/ops.ts`(op 검증 `validateOps`·적용 `applyOps`·검사 `checkText`·읽기 전용 판정), `ai/prompts.ts`, `ai/service.ts`(LLM·원장 주입형 `createProposalAi` — 제안·넘침 줄이기·규칙 대체), `ai/server.ts`(게이트웨이·지표 사전 연결), `measure.ts`(쪽 하나 넘침 실측 + 편집기와 같은 판정 `pageOverflows`). API `POST·PUT /api/sales/proposals/ai/edit`(제안·채택 감사), `POST /api/sales/proposals/ai/fit`. 기능 키 `proposal.rewrite`(Opus 5)·`proposal.copy_fit`(Haiku 4.5), 관리 화면 그룹 순서에 '용역 제안서'. `anthropicChatJson` 에 `cacheSystem` 전달만 추가(기존 호출 영향 없음). `validateBlock`·`blockHash`·`stripMark` 내보내기, `variables.clientNotes`(2000자).
- 화면: 블록·쪽 속성 머리의 [AI로 고치기] → `ProposalAiPanel`(지시 칩 5종·지시 칸 → 제안 → 넘침 실측·줄이기 0.85/0.7 → 전·후·검토 표시·체크 → [미리보기에서 보기](띠: 채택·검토로 돌아가기·거절, 그동안 속성 패널·저장·발행·실행 취소 잠금) → [채택]). 문서 설정에 발주처 메모 칸.
- 계획과 다르게 한 것: ① 검토 창이 `CdModal`(모달)이라 응답을 기다리는 동안 편집할 수 없다 — 원문 대조(base)는 그대로 두어 안전망으로 남겼다. ② 읽기 전용 판정 = `[작성 필요]` 칸·성명/이름/담당자 열이 있는 표·쪽 제목/절에 '예시'가 있는 쪽. 예시 쪽·성명 표를 고르면 LLM 을 부르지 않고 알린다. ③ 숫자 예외 문형은 `N단계·N차·제N조·G01·M3·ISO 14001·Scope 1` 만(소수점 항 번호는 값과 구별이 안 돼 뺐다). ④ 넘침 줄이기·AI 글은 `**` 짝·연결 표기·`[작성 필요]` 보존을 검사한다(시험 화면에서 줄인 글이 `**` 반쪽을 남기는 것을 발견해 추가).
- 검증: `test-proposal-ai` 14 + edit 13 + 원고 8 + API 16 + HWPX 11 + 메뉴 10 + 매뉴얼 9, 수정 파일 tsc 0건. 시험 화면(편집기 그대로 + 실제 `createProposalAi`·검증에 대본 응답의 가짜 LLM)에서 블록 제안 → 검토 칩(근거 없는 숫자) → 미리보기 잠금 → 채택(감사 기록은 개수만) → Ctrl+Z 원복, 쪽 제안 → 넘침 실측 → 줄이기 → 넘침 안내, 도식 지우기 거부, 예시 쪽 거부, 다크·Esc 를 확인했다. **실제 Anthropic 호출·실제 로그인·DB·배포는 하지 않았다** — 실제 모델 응답 품질·시간은 스테이징에서 확인해야 한다.

### P2 — 편집 생산성

| 범위 | E12 회사 수치 지표 바인딩(먼저) · E3 끌어 옮기기 · E6 여러 블록 선택·복사·붙여넣기 · E7 옮길 위치 · E8 블록 나누기·넘침 모두 정리 |
|---|---|
| 변경 파일 | `lib/proposal/edit.ts`(`splitBlock`·`moveBlocks`·`pasteBlocks`) · 신규 `lib/proposal/facts.ts`(원장 대조 규칙표) + 원장 조회 API(`GET /api/sales/proposals/facts`, `catalog.manage`, 지표 사전 재사용 — `lib/catalog/metrics.ts` 는 DB 를 읽는 서버 전용이라 API 가 필요) · `ProposalStudio.tsx`(선택 상태 `string[]`, 끌기, 클립보드) · `ProposalPages.tsx`(다중 선택 표시) · E8 은 `measure.ts` 로 쪽을 재며 반복 |
| 시험 | 나누기 후 내용 손실 0(줄·행 합 = 원래), 표 머리 반복, 붙여넣기 id 중복 없음, 다른 양식 문서로 붙여넣기 검증, 사실 규칙표가 원고 4종 수치를 모두 찾음(단위 '개소'·'건'·'명' 과 지표 단위 대조) |
| 주의 | 끌어 옮기기는 부모 문서(목록)에서만 — iframe 안 미리보기와 교차 끌기는 하지 않는다. `History` 는 문서 전체 스냅샷을 100개까지 쌓으므로 큰 그림(`dataUrl`)이 많은 문서는 메모리가 늘 수 있다(기존 동작, 바꾸지 않음) |
| 매뉴얼 | edit 절 갱신, 새 단추 `[[넘침 모두 정리]]`·`[[회사 수치 점검]]` |

### P3 — RFP 반영(문서 단위)

| 범위 | RFP 입력(붙여넣기·PDF) · 요구사항 추출·확정 · 대조표 · 쪽 단위 반영 제안 |
|---|---|
| 변경 파일 | `lib/proposal/types.ts`(`rfp?: { title, requirements: [{id, text, category, score?}] , checkedAt }` — 선택 필드라 저장된 문서 영향 없음, 요구사항 200개·각 500자 상한) · `validate.ts`(rfp 검증 — 빠뜨리면 저장 때 조용히 사라진다, F14) · `hwpx.ts`·`materialize.ts` 는 `rfp` 를 읽지 않음을 시험으로 고정 · `lib/ai/features.ts`(키 2종) · `lib/proposal/ai/rfp.ts` · `app/api/sales/proposals/ai/rfp/route.ts` · 문서 설정 패널의 RFP 칸 |
| 결정 의존 | D4(원문 보관), 30MB 요청 한도 안에서 PDF 전송(HWPX 발행 본문 한도와 같은 `PROPOSAL_MAX_BYTES`) |
| 시험 | 요구사항 확정본만 저장·HWPX 에 들어가지 않음, 대조표 쪽 id 가 문서에 있는 것만, RFP 숫자가 carried 에 들어가 검토 칩이 줄어듦 |

### P4 — 판 비교·양식 원고 관리

| 범위 | E9 발행본 ↔ 현재 비교·쪽 되돌리기 · E10 양식 새 원고 비교·쪽 가져오기 · 관리자 원고 점검(P4a) · (D3=B) 원고판 게시(P4b) |
|---|---|
| 변경 파일 | 신규 `lib/proposal/diff.ts`(쪽·블록 id 기준 글 비교 — `TEXT_PATHS` 로 칸 단위) · `GET /api/sales/proposals/[id]/editions/[edition]` (스냅샷 원본 조회, `catalog.manage`) · `templates.ts`(`PROPOSAL_CONTENT_VERSION` 내보내기) · E10 판정: 쪽 `sourceHash` ≠ 현재 쪽 해시면 "사용자가 고친 쪽"(E13 으로 P0 부터 기록된 값), 원고 판의 쪽 해시 ≠ 문서 `sourceHash` 면 "새 원고에서 바뀐 쪽" · (P4b) `infra/aws/325_proposal_template_versions.sql`, `store.ts`·API·관리자 화면 |
| 원고 점검(P4a) 산출물 | 앱에서 고친 원고를 코드에 넣는 수고를 줄이기 위해 점검 결과는 **쪽별 개선 제안 목록(JSON: pageId·전·후·사유)**으로 내려받고, 개발 세션이 `content/*.ts` 에 반영 → `test-proposal-content.mjs`·한글 쪽수 확인 |
| DB | P4a 없음. P4b 는 착수 직전 `git fetch` 후 원격 전 브랜치 `infra/aws/` 확인(2026-11-01 기준 최대 324) → 다음 번호 |

### P5 — 표 셀 병합(필요 시)

`table.merges` 타입·검증·미리보기·HWPX(`cellSpan`·`cellAddr`)·편집기(칸 고르기 → 병합/해제). HWPX 는 한글 2020 실측 필수(문단 여백 ×2·테두리 함정 재확인). 원본 제안서 병합 표 3개 이상 재현이 완료 기준.

## 5. DB·마이그레이션

| 단계 | 필요 | 비고 |
|---|---|---|
| P0~P3 | 없음 | 사용량 `ai_usage_log`(기존)·감사 `audit_log`(기존, action 은 TS 유니온만 추가)·RFP 요구사항은 `proposal_documents.document` jsonb 안 |
| P4b | `325_proposal_template_versions.sql`(가칭) | D3 에서 B 를 고를 때만. 번호는 착수 직전 재확인 |
| D6 = 판 보관 | `proposal_revisions`(가칭) | 저장마다 판을 남기기로 정할 때만 |

## 6. 매뉴얼 동기화 요약

- 기사 `frontend/content/manual/articles/proposals.ts`(`sales.proposals`): P0·P2 → `edit` 절, P1 → 새 `ai` 절, P3 → 새 `rfp` 절, P4 → `publish` 절(발행본 비교)과 관리자용 원고 점검(관리자 audience).
- 도움말 `help-topics/proposals.ts`: 단계마다 한 줄. 화면에는 `<CdHelp topic="sales.proposals" />` 키만 둔다.
- `changelog.ts`: 사용자에게 보이는 변화마다 한 줄. 버튼 이름을 바꾸면 `[[버튼 이름]]` 대조가 깨지므로 같은 커밋에서 고친다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| AI 가 그럴듯한 수치·실적을 지어냄 | 결정적 숫자 검사 + `[작성 필요]` 삭제 op 버림 + 원장 값만 허용. 채택 전 검토 칩을 지울 수 없게 표시 |
| 미리보기 임시 적용 중 사용자가 다른 편집 | 제안 보는 중(`reviewing`)에는 `change()`·클릭 선택·더블클릭·저장·발행을 막고 띠에서 채택/거절만. `operation` 깃발과는 별개 상태(그 깃발은 `run()` 이 끝나면 풀린다) |
| 응답을 기다리는 동안 편집해 원문이 바뀜 | op 마다 `before` 대조, 어긋난 op 는 적용하지 않고 표시(§3-1 5번) |
| 숫자 검토 칩 남발(한글 제안서는 단계·항·조항 번호가 많다) | 제안서 허용 문형(§3-3)과 원문·지시문·원장 숫자 허용. 칩은 '검토'일 뿐 채택을 막지 않는다 |
| 쪽 단위 제안이 지면을 넘침 | §3-7 측정 → copy_fit 자동 축약 1~2회 → 그래도 넘치면 "쪽 나누기(E8) 뒤 다시" 안내. 채택은 막지 않는다(발행 가드가 넘침을 막는다) |
| 선택 필드 추가 시 저장에서 사라짐(F14) | 필드마다 타입·검증·"검증 뒤에도 남는다" 시험을 한 묶음으로 |
| 큰 문서 본문(그림) 전송 | `dataUrl` 제거 후 전송, 서버 30MB 한도 유지 |
| 회사소개서 파일 import 로 서버 번들 증가 | `patch.ts`·`template.ts` 의 순수 함수만 import(렌더 데이터 import 금지). 커지면 `lib/ai/copy-guards.ts` 로 옮기는 것을 별도 정리 작업으로 제안 |
| Sonnet 계열 생각 모드로 출력 잘림 | 기본 모델 Opus 5/Haiku 4.5, `maxTokens` 넉넉히, 잘림(`llm_truncated`)은 규칙 대체 |

## 8. 결정이 필요한 쟁점

| # | 쟁점 | 선택지 | 권장 |
|---|---|---|---|
| D1 | `proposal.rewrite` 기본 모델 | A Opus 5(쪽 약 $0.10, 회사소개서와 같음) · B Sonnet 5(약 $0.03) | **A** — 입찰 제안서는 월 몇 건이라 비용보다 품질. 관리 화면에서 언제든 바꿀 수 있다 |
| D2 | AI 사용 권한 | A `catalog.manage`(편집과 같음) · B 새 권한 `proposal.ai` | **A** — 권한 화면을 늘리지 않는다. 원고 게시만 `catalog.publish` |
| D3 | 양식 원고 개선 방식 | A 코드 원고 유지 + 원고 점검 결과를 개발 세션이 반영 · B DB 원고판(325) + 관리자 화면 게시 | **A 로 시작(P4a)**, 실제로 원고를 자주 고치게 되면 B. B 는 관리자 화면·게시 검증이 늘어난다 |
| D4 | RFP 원문 보관 | A 요구사항 목록만 문서에 저장 · B 원문 파일도 파일함에 보관 | **A** — 원문은 공고 시스템에 있고, 보관 범위·권한 문제가 생기지 않는다 |
| D5 | `[작성 필요]` 칸과 AI | A `[작성 필요]` 칸·참여인력 표·예시 쪽은 AI 범위에서 빼고 사람이 채움 · B 지시에 값이 있으면 AI 가 채우도록 허용(값이 지시에 있는지 판정 로직 필요) | **A** — 판정 로직 없이 단순하고, 입찰마다 확정하는 칸은 사람이 채우는 게 맞다. 같은 값 여러 곳은 E2 바꾸기로 |
| D6 | 저장마다 판 보관 | A 발행본 비교만(DB 없음) · B 저장마다 판 스냅샷(테이블 추가) | **A** — 발행본이 제출 판이고, 저장 판까지 두면 용량·화면이 늘어난다 |
| D7 | AI 채택 감사 기록 | A `audit_log` 에 개수만 기록 · B 기록 안 함(사용량 로그 subject 로 충분) | **A** — 누가 AI 문안을 채택했는지는 남기되 글은 남기지 않는다 |
| D8 | 단계 순서 | A P0 → P1 → P2 → P3 → P4 · B AI(P1) 먼저 | **A** — P0 의 찾기·작성 필요 목록이 AI 검토(작성 필요 유지 판정)에도 쓰인다. P0 는 하루 이틀 크기 |
| D9 | 찾기 단축키 | A `Ctrl+H` 만 앱 찾기(`Ctrl+F` 는 브라우저) · B `Ctrl+F` 도 가로챔 | **A** — 브라우저 기본 동작을 빼앗지 않는다 |
| D10 | 회사 수치의 근본 처리 | A 점검표(E12: 규칙표로 원장과 대조, 사람이 [원장 값으로]) · B 원고 수치를 회사소개서처럼 `{{metric:id}}` 바인딩으로 바꾸고 발행 때 값 치환 | **A** — 원고 4종·HWPX·검증을 다 손대지 않고, 제안서 수치는 "기준일 명시"가 관행이라 사람이 확인하는 편이 맞다. B 는 회사소개서와 데이터 연결을 넓힐 때 다시 본다 |
| D11 | 발주처 메모 보관 | A 문서 `variables.clientNotes`(문서마다) · B 발주처(거래처) 마스터에 저장해 다음 입찰에 재사용 | **A** — 지금은 문서 안에. 같은 발주처 입찰이 잦아지면 B |

**결정(2026-11-01, 사용자)**: D1 A(Opus 5) · D2 A(`catalog.manage`) · D3 A(코드 원고 유지로 시작) · D4 A(요구사항 목록만) · D5 A(AI 범위에서 제외) · D6 A(발행본 비교만) · D7 A(개수만 기록) · D8 A(P0 먼저) · D9 A(`Ctrl+H` 만) · **D10 B(지표 바인딩으로 자동 — 권장과 다름, §2 'E12 설계'로 재설계)** · D11 A(문서마다).

## 9. 2차 점검 기록(2026-11-01)

1차 계획을 코드로 다시 대조해 고친 것. 번호는 위 본문에 반영된 자리다.

| 구분 | 내용 | 반영 |
|---|---|---|
| 미비 | 넘침 판정을 `Canvas` 전체 렌더에 기대면 모달 안에서 결과를 기다릴 수 없고 발행 가드 `overflow` 가 제안 문서로 더럽혀진다 | F12 · §3-7 쪽 단위 측정 함수 신설, 제안용 overflow 상태 분리 |
| 미비 | "제안 보는 중 편집 막기"를 `operation` 깃발로 한다고 했으나 그 깃발은 `run()` 종료 시 풀린다 | §3-1 4번 `reviewing` 별도 상태 |
| 미비 | AI 응답(30~60초) 중 편집하면 채택 시 엉뚱한 값을 덮어씀 | F13 · op `before` 대조, 어긋나면 미적용 |
| 미비 | `change(next, "ai:<id>")` 는 900ms 안 같은 key 를 병합해 실행 취소 단계가 합쳐질 수 있음 | key 없이 push |
| 미비 | 검증기가 선택 필드를 버리므로 `rfp`·`clientNotes`·`sourceHash` 가 저장에서 사라질 수 있음 | F14 · 필드마다 검증·시험 묶음 |
| 미비 | `[작성 필요]` 삭제 op 를 "지시에 값이 있을 때만 허용"하려면 판정 로직이 필요하고 구멍이 많다(`[작성필요]`·'추후 기재'로 바꾸는 경우) | D5 를 '읽기 전용 칸' 방식으로 바꿈 |
| 미비 | `blockOf` 는 `uniqueId` 콜백을 요구해 그대로 내보내면 쓰기 불편 | `validateBlock` 래퍼 |
| 미비 | `page` op 가 `chapter`·`crumb` 를 바꾸면 목차·간지·머리띠가 흔들림 | title·summary 만 허용 |
| 미비 | 한글 제안서의 단계·항·조항 번호가 모두 '숫자 확인' 칩이 되어 검토가 무의미해짐 | 제안서 허용 문형 추가 |
| 미비 | 문체 규칙이 회사소개서('~습니다'·명사형 라벨)와 다름 — 원고 실측: 개조식 명사형 종결·핵심 메시지 '~합니다' | §3-3 문체 행 |
| 미비 | E10 '사용자가 고친 쪽' 판정 근거가 없음(이전 판 원고가 코드에 안 남음) | E13 `sourceHash` 를 P0 에서 미리 기록 |
| 미비 | `metrics.ts` 는 DB 를 읽는 서버 전용이라 클라이언트 점검표가 바로 못 씀 | P2 원장 API 명시 |
| 개선 | 글 칸 경로 목록이 `ProposalPages` 에만 있어 찾기·AI 가 각자 목록을 둘 위험 | F15 · `find.ts` `TEXT_PATHS` 단일 원천, `E()` 도 이 목록 사용, 시험으로 대조 |
| 개선 | 발주처 맞춤 지시를 블록마다 다시 적어야 함 | `variables.clientNotes` 발주처 메모 칸(D11) |
| 개선 | E2 가 `[작성 필요]` 바꾸기를 경고하면 같은 값 여러 곳 채우기가 불편 | 막지 않음, `{{…}}`·`**` 가로지르기만 건너뜀 |
| 개선 | 긴 시스템 프롬프트 입력 비용 | `cacheSystem: true` |
| 개선 | P4a 결과를 앱에서 고친 원고 JSON 전체로 내려받으면 코드 반영이 번거로움 | 쪽별 개선 제안 목록(전·후·사유)으로 |
| 추가 | 인프라 확인: ALB `idle_timeout = 300`, 라우트 `maxDuration = 180`, 관리 화면은 `AI_FEATURES` 를 읽어 새 그룹이 자동 표시, `audit_log.action` DB CHECK 없음, 매뉴얼 기사에 캡처 없음 | §3-6 · P1 변경 파일 |
| 추가 | 요청 중 창 닫기 → `AbortController`, [다시 받기], 지운 블록 선택 해제, 요청 본문 2 MB 한도, 새 문서(미저장)도 AI 대상 | §3-1 · §3-6 |
| 추가 | 실측 항목: 발주처 메모·원문 대조·응답 시간 기록, 새 단추 이름 확정 목록(매뉴얼 `[[…]]` 대조용) | P1 실측·매뉴얼 |
| 추가 | 쟁점 D10(수치 바인딩 vs 점검표)·D11(발주처 메모 보관 위치) | §8 |

## 10. 착수 체크리스트(P0)

1. `git fetch origin` → 최신 `origin/main` 에서 세션 브랜치 재분기 확인(이 계획서 커밋 위에서 시작). 이 worktree 에는 `frontend/node_modules` 가 없으므로 시험 전에 `npm ci` 를 하거나 메인 체크아웃의 모듈을 쓴다.
2. `tests/proposal-edit.test.ts` 골격과 `scripts/test-proposal-edit.mjs` 부터 만들고 `find.ts`(`TEXT_PATHS`)·`hash.ts` 를 시험 우선으로 작성. `ProposalPages` 의 `E()` 를 `TEXT_PATHS` 로 바꾼 뒤 `test-proposal-hwpx.mjs`·`test-proposal-content.mjs` 가 그대로 통과하는지 먼저 확인.
3. 화면 작업 후 로컬 편집기에서 원고 4종 열기·작성 필요 위치 이동·찾기·바꾸기·실행 취소, 라이트/다크·1024px·키보드 확인.
4. 매뉴얼 기사·도움말·changelog 갱신 → `npm run test:manual` → 커밋(푸시·배포는 사용자 요청 시).
