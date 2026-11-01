# 용역 제안서 편집·HWPX 발행

2026-10-31 · 디자인 시스템 2.0 · 구현 위치 `/sales/proposals` · 설계 근거 [proposal-design-system.md](proposal-design-system.md)

GPT 작업본(T-050/T-056, 2026-10-30)을 이어받아 지면 어휘·조판기·편집기·원고를 다시 만들었다. 원본 제안서 4종(포스코퓨처엠·한국서부발전·한국중부발전 보령·수도권매립지관리공사)의 장 구성과 개조식 위계를 따르고, 글·표·카드·단계·일정표는 한글에서 그대로 고칠 수 있는 문단과 표로 발행한다.

## 양식

| 양식 | 테마 | 본문 | 원본 |
|---|---|---|---|
| 통합환경허가 · 일반 산업 | 네이비 | 36쪽(G01~G36) | 포스코퓨처엠 2025.10 |
| 통합환경허가 · 발전 신규·변경 | 오션 | 14쪽(W01~W14) | 한국서부발전 건설사업소 2025.09 |
| 통합환경허가 · 정기검사 대응 | 슬레이트 | 13쪽(I01~I13, 요약본 포함) | 한국중부발전 보령발전본부 2025.01 |
| 지속가능경영보고서 발간 | 포레스트 | 15쪽(E01~E15) | 수도권매립지관리공사 2025.06 |

회사 소개·품질·조직·안전처럼 공통인 쪽은 일반형 원고를 재사용한다(`content/kit.ts` `reuse`). 참여인력 실명·등급처럼 입찰마다 확정할 칸만 `[작성 필요]`로 남고, 채우기 전에는 발행되지 않는다. 회사 수치(등록번호·최초허가 99개소·변경 107건·36명)는 2025년 10월 제안서 기준이라 쪽에 기준일을 적었다 — 제출 전에 회사 원장으로 갱신한다. G22~G24 는 **제안 적용 예시**이며 실제 실적이 아니다.

## 구조

- `lib/proposal/types.ts` — 문서 v2. 블록 14종: 제목(3단)·본문·개조식·핵심 메시지·참고/포인트 상자·단계 띠·카드·단계 흐름·큰 숫자·표(격자·간결·양식형)·일정표·인포그래픽(회사소개서 InfoSpec)·도식(제안서 전용 8종)·그림. v1(GPT 작업본) 문서는 저장 검증에서 v2 로 올려 받는다.
- `lib/proposal/design.ts` — 디자인 토큰(테마 5종·발주처 주색 덮어쓰기·글자 크기·간격·글머리). 미리보기 CSS 와 HWPX 가 같은 값을 쓴다.
- `lib/proposal/layout.ts` — 물리 쪽 구성(표지·목차·간지·본문)·쪽 번호·목차·표지/간지 글줄.
- `lib/proposal/diagrams/` — 도식 8종(허브·조직도·전후 비교·피라미드·반원·단계 화살표·중대성 매트릭스·세 원) SVG.
- `lib/proposal/art.tsx` — 표지(모던·클래식)·간지 배경 그림. 글은 HWPX 문단으로 얹는다.
- `lib/proposal/hwpx.ts` — 제안서 전용 조판기. 머리말(로마 숫자 장 띠·절)·꼬리말(사업명·쪽 번호·회사명)·표지/목차/간지 쪽 번호 숨김·이름 붙은 문단 스타일(제안-본문·제안-글머리1~3)을 쓴다.
- `lib/proposal/edit.ts` — 블록 만들기·모양 바꾸기·경로 편집·쪽 넘기기·실행 취소.
- `components/sales/proposal/ProposalStudio.tsx` — 3단 편집기(장·쪽 목록 / A4 미리보기 / 속성). `ProposalPages.tsx` — 미리보기.
- `lib/proposal/content/` — 4개 양식 원고와 원고 작성 도구(`kit.ts`).
- `store.ts`·`handlers.ts`·API 라우트는 GPT 작업본 그대로. 발행 시 받는 그림 목록만 `rasterTargets`(도식·인포그래픽·표지·간지)로 바꿨다.

## HWPX 실측 함정(한글 2020 11.0.0.1623)

- 문단 여백(`hc:intent·left·right·prev·next`)은 **넣은 값의 절반**이 pt 로 적용된다(10000 → 50pt). 조판기는 문단 여백만 pt×200 으로 쓴다. 표·그림·셀 여백은 pt×100 그대로다.
- 줄바꿈 `breakNonLatinWord` 는 이름과 반대다 — `KEEP_WORD` 가 글자 단위(낱말 중간에서 끊김), `BREAK_WORD` 가 어절 단위. 조판기는 `BREAK_WORD` 를 쓴다.
- 테두리·배경(`hh:borderFill`) id 는 1번부터, 글자·문단 서식과 스타일은 0번부터 연속이어야 한다.
- 그림 `imgClip` 은 원본 픽셀 × 75.
- 표지·간지 배경은 PAPER 기준 `BEHIND_TEXT` 그림, 쪽 번호는 꼬리말 표 안의 `autoNum numType="PAGE"`, 본문 첫 쪽에 `newNum` 한 번.

## 설치 및 권한

신규 의존성은 없다(`jszip`·`html-to-image`·`@napi-rs/canvas`·`lucide-react`). DB 변경은 `infra/aws/319_proposal_authoring.sql`(미적용 — GPT 작업본의 317 은 main 의 `317_overtime_form_meal_notice` 와 겹쳐 재번호). 목록·초안·다운로드는 `catalog.manage`, 발행은 추가로 `catalog.publish`.

## 검증

`frontend/`에서 실행한다.

```powershell
node scripts/test-proposal-content.mjs
node scripts/test-proposal-api.mjs
node scripts/test-proposal-hwpx.mjs
node scripts/test-menu-route.mjs
npm run test:manual
```

2026-10-31 결과: 원고 8 + API 16 + HWPX 9 + 메뉴 9 + 매뉴얼 9 = 51/51. 로컬 편집기(인증·저장소만 파일 어댑터로 대체)에서 네 양식을 화면 발행했고, 한글 11.0.0.1623 으로 열어 쪽수를 확인했다 — 일반 38쪽(표지·목차+36), 발전 16쪽, 정기검사 15쪽, ESG 22쪽(간지 5 포함). 블록 선택·더블클릭 글 고치기·모양 바꾸기·블록 추가·쪽 넘침 경고·다음 쪽으로 넘기기·실행 취소를 화면에서 확인했다. 운영 DB·실제 로그인 통합과 배포는 하지 않았다.
