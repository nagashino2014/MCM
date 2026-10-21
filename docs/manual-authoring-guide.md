# 사용 매뉴얼·? 도움말 작성 가이드

> 설계: [manual-help-blueprint.md](manual-help-blueprint.md) · 화면 인벤토리: [manual-help-survey-2026-10-20.md](manual-help-survey-2026-10-20.md)
> 데이터 위치: `frontend/content/manual/` · 검사: `cd frontend && npm run test:manual`

기능을 추가·변경하는 커밋은 **같은 커밋에서** 해당 기사·도움말을 고치고 `reviewedAt`을 갱신하며, 사용자에게 보이는 변화는 `changelog.ts`에 한 줄을 남긴다.

## 1. 무엇을 어디에 쓰나

| 넣을 내용 | 위치 |
|---|---|
| 화면 사용법·흐름·용어·자동 반영 | 기사(`articles/*.ts`의 `ManualArticle`) |
| 헷갈리는 한 항목의 짧은 설명(3~6줄) | ? 도움말(`help-topics*.ts`의 `HelpTopic`) + 화면에 `<CdHelp topic="…" />` |
| 오류·필수 입력·되돌릴 수 없는 동작의 **경고** | 화면에 상시 표시(이미 있으면 그대로). ? 안에만 숨기지 않는다 |
| 기능 변화 소식 | `changelog.ts` |

## 2. 문체

- 사용자 시각, "~합니다"체. 코드·테이블명·API·내부 단계명(P1, 마이그 번호)은 쓰지 않는다.
- 버튼·탭·라벨은 화면 문자열 그대로 `[[ ]]`로 감싼다. 예: `[[변경계약 입력]]`. **소스 파일에 그 문자열이 그대로 있어야 한다**(검사가 대조). 화면에서 `{변수}`로 조합되는 문구는 `[[ ]]`로 감싸지 말고 평문으로 쓴다.
- 강조는 `**굵게**`. 되돌릴 수 없는 동작은 `warn` 블록, 요령은 `tip` 블록.
- 한 문장 한 가지. 표는 "구분 | 뜻" 2~3열로 짧게.
- 산식·한도·기간은 코드(lib·api)에서 확인한 값만 쓴다. 설정으로 바뀌는 값은 "기본 ○○(회사 설정)"으로 쓴다.

## 3. 기사 필드

| 필드 | 규칙 |
|---|---|
| `id` | `영역.화면` 형식의 안정 키(예: `contracts.manage`). 바꾸지 않는다 |
| `chapter` | `chapters.ts`의 id |
| `routes` | 이 기사가 설명하는 화면 경로. 기본=하위 경로 포함, `*`=아무 세그먼트(`/sales/*`), 끝 `$`=정확히 그 경로만(`/contracts$`), query 가능(`/finance?tab=vat`). 화면 없는 시나리오는 `[]` |
| `requires` | 생략하면 `routes[0]`의 메뉴 권한표를 쓴다. 메뉴는 보이지만 API가 따로 막는 화면은 **실제 API 권한키**를 적는다. 빈 배열 = 전원 |
| 절 `requires` | 한 기사 안 관리자 전용 부분만 숨길 때 |
| `audience` | `staff`·`head`·`exec`·`admin` 중 해당 |
| `summary` | "이 화면에서 할 수 있는 일" 3~5줄 |
| `sections` | 절마다 고유 `id`(앵커). 흐름 → 헷갈리는 점 → 주의 순 |
| `keywords` | 직원이 검색할 법한 말(동의어·옛 이름) |
| `sources` | 기사가 설명하는 컴포넌트 파일(`frontend/` 기준). `[[ ]]` 대조와 낡은 기사 보고에 쓰인다 |
| `reviewedAt` | 실제 화면·코드와 대조한 날 |

## 4. ? 도움말 배치 규칙

- `<CdHelp topic="id" />`는 **제목·라벨 텍스트 바로 옆**, 같은 flex 줄에 둔다. 필요하면 감싸는 `div`를 `flex items-center gap-1`로만 바꾼다.
- `<button>`·`<label>`·탭 라벨 **안에 넣지 않는다**(중첩 버튼·라벨 대상 변경). 모달 제목은 `title={<span className="inline-flex items-center gap-1">제목<CdHelp topic="…" /></span>}`.
- 조건부 화면이면 같은 조건으로 렌더한다(`{isX && <CdHelp … />}`).
- 페이지 단위 설명은 `CdPageHeader`에 `helpTopic="…"`. 기존 `help=` 문구가 있으면 지우지 않는다(함께 쓰면 topic 본문 뒤에 붙는다).
- 화면당 헤더 1 + 필드 4~5개 이내. 더 필요하면 매뉴얼 절로 보내고 `more`로 연결한다.
- 도움말 `sources[0]`은 `topic="id"`를 넣은 파일이어야 한다.
- import: `import { CdHelp } from "@/components/cdash/CdHelp";`
- 구조·배치·표 열·탭은 바꾸지 않는다(CLAUDE.md UI 규칙).

## 4.1 화면 캡처(image 블록)

- `{ kind: "image", src: "/manual/shots/<이름>.webp", alt: "무엇을 보여 주는 그림인지", caption?: "…" }` — 파일은 `frontend/public/manual/shots/`.
- **이름·금액·연락처·메일 제목 등 실데이터는 반드시 흐리게** 찍는다(기사는 전 직원이 보고, `public/` 그림은 로그인 없이 열린다).
- 찍는 법: 스테이징에 직접 로그인한 Playwright 프로필로 화면을 열고, 메뉴·버튼·제목·표 머리글만 남기고 나머지 글자와 이름·금액·전화·메일 패턴을 흐린 뒤 1440×900 으로 찍어 WebP(품질 78)로 저장한다. 2026-10-21 첫 캡처 스크립트는 `docs/manual-shots/capture.mjs`.
- 찍은 그림은 커밋 전에 한 장씩 열어 흐림이 빠진 곳이 없는지 확인한다.
- 화면이 바뀌어 그림이 낡으면 같은 커밋에서 다시 찍거나 블록을 뺀다. 캡처는 절 하나에 한 장, 기사의 핵심 화면에만 둔다(그림이 많을수록 낡기 쉽다).
- `test:manual` 이 파일 존재·경로·대체 글(alt)을 확인한다.

## 5. 검사

`npm run test:manual` — 키 중복·링크·`[[ ]]` 대조·topic 사용처·권한 키·경로 매칭을 확인한다. 기사 없는 메뉴·화면이 있으면 **실패**한다(작업 중 임시로 경고만 보려면 `MANUAL_STRICT=0`). 새 화면은 기사를 쓰거나 `content/manual/index.ts`의 `MANUAL_EXCLUDED_ROUTES`에 사유와 함께 등록한다.

`npm run manual:stale` — 기사·도움말의 `sources` 파일이 `reviewedAt` 이후 커밋으로 바뀐 것을 "검토 필요"로 보고한다(실패 아님). 배포 전에 돌려 화면 동작이 바뀐 기사를 고치고, 바뀌지 않았으면 `reviewedAt`만 갱신한다.
